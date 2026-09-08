/**
 * issue #237 局部 mutation 管线（普通非空路径 mutation 的 S3–S7/S9 编排）。
 *
 * phase-1 前置假设（本模块内部契约，Owner 2026-09-05T16:01Z/16:08Z + SA8 E1
 * 修订义务）：调用前 committed ROOT 已符合 active schema——logical values 符合值
 * 语义 ∧ carrier topology 符合 `YArray`/`YMap`/plain/leaf 声明。本函数负责证明
 * **本次 mutation 不破坏其触达的 schema 约束**，不扫描、不复制、不校验 mutation
 * 路径与最近必要语义边界之外的既存数据；合法性建立点（create / SCHEMA write /
 * set([]) 全量重装）与归纳维持（合法基线 + 边界合法 ⇒ 全局合法）由调用方契约承载，
 * 本模块不建任何 committed-generation/document-baseline 状态机。
 *
 * 管线（设计 §4 S3–S10；错误分类表见设计 §7.3）：
 *  S3 vfsl.planMutationBoundary（结构侧规划，零 base 读；拒绝 = 领域 ok:false）
 *  S4 live 导航（沿 prefix 逐 hop：union 位经 walkUnion 同款纪律消歧——R1 边界
 *     提取先行；中间 hop 载体/在场/越界域规则；一切 live 状态异常 = 领域 issue，
 *     载体违规不升格 E204——E204 保留给手造派生物两树分歧）
 *  S5 边界提取（kind target 跳过）：walk(boundaryStructureNode, boundaryLive)
 *  S6 vfsl.applyMutationAtBoundary（relPath 域规则 + 拷贝式重建 + validateSubtree
 *     整体判定；批量 values[]/count 一次重建，中间态不参与）
 *  S7 detached 构造（buildDetachedValue；失败 = 领域 issue）
 *  S8 由调用方（mutation.ts）在单 guarded transaction 中提交最小 edit
 *  S9 边界级提交后验证（install-verify.ts verifyBoundaryIntact：O(1) 安装事实核 +
 *     O(boundary) 重投影核；不重新过 schema；偏离 → E201-C / 无法运行 → E201-D）
 *
 * 模块边界：包内 @internal（不经 index.ts 公共入口导出）；全部拒绝先于任何
 * live Y.Doc 写（禁 write-then-undo——Owner 2026-09-05T16:08Z §4）。
 */
import * as Y from 'yjs';
import type { DerivedSchema, StructureNode } from '@nomicore/vfsl';
import { applyMutationAtBoundary, planMutationBoundary } from '@nomicore/vfsl';
import type { BoundaryMutationPayload } from '@nomicore/vfsl';
import type { ValidateResult } from '@nomicore/vfsl';
import { walk } from './extract.js';
import { makeRefResolver } from './resolve.js';
import { carrierOf, probeRoot } from './carrier.js';
import { buildDetachedValue } from './detached-build.js';
import type { PreparedCommit } from './mutation.js';
import { navigateLive } from './mutation.js';
import type { MutationIssue } from './mutation.js';
import { DerivedInvariantError } from './fatal.js';
import type { BoundaryCommitFacts, VerifyBoundaryIntactInput } from './install-verify.js';

/** 本地管线准备结果（@internal；mutation.ts prepareMutation 消费）。 */
export type LocalPreparedResult =
  | { kind: 'fail'; issues: MutationIssue[] }
  | { kind: 'ok'; commit: PreparedCommit; verify: VerifyBoundaryIntactInput };

interface LocalMutation {
  op: 'set' | 'delete' | 'array-insert' | 'array-delete';
  path: Array<string | number>;
  value?: unknown;
  index?: number;
  values?: readonly unknown[];
  count?: number;
}

function failIssue(path: Array<string | number>, message: string): { kind: 'fail'; issues: MutationIssue[] } {
  return { kind: 'fail', issues: [{ message, path }] };
}

function issueAt(path: Array<string | number>, message: string): MutationIssue {
  return { message, path };
}

/** ValidateResult → MutationIssue[]（vfsl ok:true 分支无 issues——调用点已判 !ok）。 */
function issuesOf(result: ValidateResult): MutationIssue[] {
  return result.ok ? [] : result.issues;
}

/** 结构树静态下钻（position 路径不含 union 穿越——R1 边界后由换根导航代替）。
 *  返回原始子节点（可能为 ref/union——消费方各自解析）。 */
function descendStructureNode(derived: DerivedSchema, path: readonly (string | number)[]): StructureNode {
  if (derived.structure.kind !== 'root') {
    throw new DerivedInvariantError('derived.structure 非 root（手造派生物）');
  }
  const resolve = makeRefResolver(derived);
  let node = resolve(derived.structure.node);
  for (const seg of path) {
    const r = resolve(node);
    if (r.kind === 'map') {
      if (typeof seg !== 'string') throw new DerivedInvariantError('两树分歧: 结构下钻 map 位置收到非 string 段');
      let child: StructureNode | undefined;
      for (const f of r.fields) {
        if (f.name === seg) {
          child = f.node;
          break;
        }
      }
      if (child === undefined) {
        for (const f of r.fields) {
          if (f.name === '<key>') {
            child = f.node;
            break;
          }
        }
      }
      if (child === undefined) throw new DerivedInvariantError(`两树分歧: 结构树缺少字段 "${seg}"`);
      node = child;
    } else if (r.kind === 'array') {
      if (typeof seg !== 'number' || !Number.isSafeInteger(seg) || seg < 0) {
        throw new DerivedInvariantError('两树分歧: 结构下钻 array 位置收到非法段');
      }
      node = r.element;
    } else {
      throw new DerivedInvariantError('两树分歧: 结构下钻穿越不可下钻终态');
    }
  }
  return node;
}

/**
 * S4 阶段一：从 ROOT 沿 hops 逐跳导航（域规则面）——每 hop 先按当前结构节点做
 * 载体检查（map → Y.Map / array → Y.Array），再取子并做在场/越界检查；返回终点
 * live 与结构节点。union 不在 hops 中出现（否则边界规划已在该位冻结为 R1 并只
 * 导航到 union 之前）。一切失败 = 领域 issue（零写入）。
 */
function navigateHops(
  derived: DerivedSchema,
  doc: Y.Doc,
  hops: Array<string | number>,
  resolve: (node: StructureNode) => StructureNode,
): { kind: 'ok'; live: unknown; node: StructureNode } | { kind: 'issue'; issue: MutationIssue } {
  if (derived.structure.kind !== 'root') {
    throw new DerivedInvariantError('derived.structure 非 root（手造派生物）');
  }
  const probe = probeRoot(doc);
  if (probe.carrier !== 'Y.Map') {
    return {
      kind: 'issue',
      issue: issueAt([], `Yjs 载体错位（ROOT）：期望 Y.Map，实际 ${probe.carrier}`),
    };
  }
  let live: unknown = probe.map;
  let node = resolve(derived.structure.node);
  for (let i = 0; i < hops.length; i++) {
    const seg = hops[i]!;
    const prefix = hops.slice(0, i);
    const resolved = resolve(node);
    if (resolved.kind === 'map') {
      if (typeof seg !== 'string') {
        return { kind: 'issue', issue: issueAt([...hops], '导航段型错误：对象位置需要 string 键段') };
      }
      if (carrierOf(live) !== 'Y.Map') {
        return {
          kind: 'issue',
          issue: issueAt(
            [...hops.slice(0, i)],
            `mutation 导航载体违规（${renderSeg(prefix, seg)}）：结构树声明 Y.Map，实际 ${carrierNameOf(live)}——不实例化不匹配载体`,
          ),
        };
      }
      const childLive = (live as Y.Map<unknown>).get(seg);
      if (childLive === undefined) {
        return { kind: 'issue', issue: issueAt([...prefix, seg], '中间容器缺失——不自动创建中间容器') };
      }
      node = mapChildNode(resolved, seg);
      live = childLive;
      continue;
    }
    if (resolved.kind === 'array') {
      if (carrierOf(live) !== 'Y.Array') {
        return {
          kind: 'issue',
          issue: issueAt(
            [...hops.slice(0, i)],
            `mutation 导航载体违规（${renderSeg(prefix, seg)}）：结构树声明 Y.Array，实际 ${carrierNameOf(live)}——不实例化不匹配载体`,
          ),
        };
      }
      if (typeof seg !== 'number' || !Number.isSafeInteger(seg) || seg < 0 || seg >= (live as Y.Array<unknown>).length) {
        return { kind: 'issue', issue: issueAt([...prefix, seg], '数组下标越界或非整数下标') };
      }
      live = (live as Y.Array<unknown>).get(seg);
      node = resolved.element;
      continue;
    }
    throw new DerivedInvariantError('validated path 穿越不可下钻结构终态（两树分歧）');
  }
  return { kind: 'ok', live, node };
}

function mapChildNode(mapNode: Extract<StructureNode, { kind: 'map' }>, key: string): StructureNode {
  for (const f of mapNode.fields) {
    if (f.name === key) return f.node;
  }
  for (const f of mapNode.fields) {
    if (f.name === '<key>') return f.node;
  }
  throw new DerivedInvariantError(`两树分歧: 结构 map 缺少字段 "${key}"`);
}

function carrierNameOf(v: unknown): string {
  const c = carrierOf(v);
  return c === null ? 'undefined/不可名状值' : c;
}

function renderSeg(prefix: Array<string | number>, seg: string | number): string {
  const p = [...prefix, seg];
  return p.length === 0 ? 'ROOT' : p.map((s) => (typeof s === 'number' ? `[${s}]` : String(s))).join('.');
}

/** 导航结果 → 领域失败（S4/S5 共用出口）。 */
function walkResultIssues(issue: { message: string; path: Array<string | number> }): { kind: 'fail'; issues: MutationIssue[] } {
  return { kind: 'fail', issues: [{ message: issue.message, path: [...issue.path] }] };
}

/**
 * 本地管线主入口（S3–S7 编排 + S9 验证输入构造）。同步、不抛错（除手造派生物
 * DerivedInvariantError → 由调用方 prepareMutation 收编 E204）。
 */
export function prepareLocalMutation(derived: DerivedSchema, doc: Y.Doc, mutation: LocalMutation): LocalPreparedResult {
  const resolve = makeRefResolver(derived);
  // ── S3：结构侧边界规划（纯结构；零 base 读）────────────────────────────
  const planned = planMutationBoundary(derived, mutation.path, mutation.op);
  if (!planned.ok) return { kind: 'fail', issues: issuesOf(planned.result) };
  const plan = planned.plan;

  switch (plan.kind) {
    case 'target': {
      // R6：整值替换边界 = 目标位；旧值（载体与内容）一律不读取、不诊断——
      // 合法 payload 写入即修复（SA2 裁决二 (b) 修复语义）
      if (mutation.op !== 'set' || mutation.path.length === 0) {
        throw new DerivedInvariantError('plan target 只服务于非空路径 set（两树分歧）');
      }
      const parentNav = navigateHops(derived, doc, mutation.path.slice(0, -1), resolve);
      if (parentNav.kind === 'issue') return { kind: 'fail', issues: [parentNav.issue] };
      const parentResolved = resolve(parentNav.node);
      const key = mutation.path[mutation.path.length - 1]!;
      if (parentResolved.kind !== 'map' || typeof key !== 'string' || carrierOf(parentNav.live) !== 'Y.Map') {
        return failIssue([...mutation.path], 'set 终态必须是 Y.Map 的字符串键');
      }
      const parentMap = parentNav.live as Y.Map<unknown>;
      // S6：payload 过目标位子 schema（整值替换；边界 base 不被消费）
      const applied = applyMutationAtBoundary(derived, plan, mutation.value, { op: 'set', value: mutation.value });
      if (!applied.ok) return { kind: 'fail', issues: issuesOf(applied.result) };
      // S7：detached 构造（目标位结构节点可能为 union/map/array/leaf/plain/xml——统一构造）
      const targetNode = descendStructureNode(derived, mutation.path);
      const built = buildDetachedValue(derived, targetNode, mutation.value, mutation.path);
      if (built.kind === 'issue') return failIssue(built.issue.path, built.issue.message);
      const facts: BoundaryCommitFacts = { kind: 'set', parent: parentMap, key: key as string, installed: built.value };
      return {
        kind: 'ok',
        commit: { kind: 'set', parent: parentMap, key: key as string, value: built.value },
        verify: {
          derived,
          structureNode: targetNode,
          proposedBoundary: applied.proposedBoundary,
          facts,
        },
      };
    }

    case 'parent':
    case 'record': {
      // R5（delete 父 map 位）/ R2（Record map 位 set/delete）：边界 = 父位 map
      const boundaryNav = navigateHops(derived, doc, mutation.path.slice(0, -1), resolve);
      if (boundaryNav.kind === 'issue') return { kind: 'fail', issues: [boundaryNav.issue] };
      const boundaryLive = boundaryNav.live;
      const boundaryNode = boundaryNav.node;
      // S5：边界局部提取（边界内既有载体/值域非法在此响亮拒绝）
      const walked = walk(boundaryNode, boundaryLive, [], resolve);
      if (walked.kind === 'issue') return walkResultIssues(walked.issue);
      // S6：relPath 域规则 + 重建 + 整体校验
      const payload: BoundaryMutationPayload = mutation.op === 'delete'
        ? { op: 'delete' }
        : { op: 'set', value: mutation.value };
      const applied = applyMutationAtBoundary(derived, plan, walked.snapshot, payload);
      if (!applied.ok) return { kind: 'fail', issues: issuesOf(applied.result) };
      const key = mutation.path[mutation.path.length - 1]!;
      const parentMap = boundaryLive as Y.Map<unknown>; // S5 已证 Y.Map 载体
      let commit: PreparedCommit;
      let facts: BoundaryCommitFacts;
      if (mutation.op === 'delete') {
        commit = { kind: 'delete', parent: parentMap, key: key as string };
        facts = { kind: 'delete', parent: parentMap, key: key as string };
      } else {
        const childNode = descendStructureNode(derived, mutation.path);
        const built = buildDetachedValue(derived, childNode, mutation.value, mutation.path);
        if (built.kind === 'issue') return failIssue(built.issue.path, built.issue.message);
        commit = { kind: 'set', parent: parentMap, key: key as string, value: built.value };
        facts = { kind: 'set', parent: parentMap, key: key as string, installed: built.value };
      }
      return {
        kind: 'ok',
        commit,
        verify: {
          derived,
          structureNode: boundaryNode,
          boundaryLive,
          proposedBoundary: applied.proposedBoundary,
          facts,
        },
      };
    }

    case 'array': {
      // R4：array-insert/delete 目标数组位（批量一次重建 + 整体校验）
      if (mutation.op !== 'array-insert' && mutation.op !== 'array-delete') {
        throw new DerivedInvariantError('plan array 只服务数组操作（两树分歧）');
      }
      const targetNav = navigateHops(derived, doc, mutation.path, resolve);
      if (targetNav.kind === 'issue') return { kind: 'fail', issues: [targetNav.issue] };
      const boundaryLive = targetNav.live;
      const boundaryNode = targetNav.node;
      const walked = walk(boundaryNode, boundaryLive, [], resolve);
      if (walked.kind === 'issue') return walkResultIssues(walked.issue);
      const payload: BoundaryMutationPayload = mutation.op === 'array-insert'
        ? { op: 'array-insert', index: mutation.index!, values: mutation.values! }
        : { op: 'array-delete', index: mutation.index!, count: mutation.count! };
      const applied = applyMutationAtBoundary(derived, plan, walked.snapshot, payload);
      if (!applied.ok) return { kind: 'fail', issues: issuesOf(applied.result) };
      // 提交目标解析（union 位经换根导航以提取逻辑值消歧；数组操作目标必须为 array）
      const resolvedTarget = navigateLive(boundaryLive as Y.Map<unknown>, boundaryNode, walked.snapshot, [], resolve);
      const resolvedNode = resolve(resolvedTarget.node);
      if (resolvedNode.kind !== 'array') {
        throw new DerivedInvariantError('array mutation 目标结构节点非 array（两树分歧）');
      }
      const target = resolvedTarget.live as Y.Array<unknown>;
      const beforeLength = target.length;
      let commit: PreparedCommit;
      let facts: BoundaryCommitFacts;
      if (mutation.op === 'array-insert') {
        const values = mutation.values!;
        const builtValues: unknown[] = [];
        for (let i = 0; i < values.length; i++) {
          const built = buildDetachedValue(derived, resolvedNode.element, values[i]!, [...mutation.path, mutation.index! + i]);
          if (built.kind === 'issue') return failIssue(built.issue.path, built.issue.message);
          builtValues.push(built.value);
        }
        commit = { kind: 'array-insert', target, index: mutation.index!, values: builtValues };
        facts = { kind: 'insert', target, index: mutation.index!, built: builtValues, beforeLength };
      } else {
        commit = { kind: 'array-delete', target, index: mutation.index!, count: mutation.count! };
        facts = { kind: 'delete-range', target, index: mutation.index!, count: mutation.count!, beforeLength };
      }
      return {
        kind: 'ok',
        commit,
        verify: {
          derived,
          structureNode: boundaryNode,
          boundaryLive,
          proposedBoundary: applied.proposedBoundary,
          facts,
        },
      };
    }

    case 'union': {
      // R1：路径首次穿越 union 位 → 边界 = union 值；relPath 覆盖 union 内剩余段
      const boundaryNav = navigateHops(derived, doc, plan.prefix, resolve);
      if (boundaryNav.kind === 'issue') return { kind: 'fail', issues: [boundaryNav.issue] };
      const boundaryLive = boundaryNav.live;
      const boundaryNode = boundaryNav.node;
      const walked = walk(boundaryNode, boundaryLive, [], resolve);
      if (walked.kind === 'issue') return walkResultIssues(walked.issue);
      const boundaryLogical = walked.snapshot;
      const payload: BoundaryMutationPayload =
        mutation.op === 'set'
          ? { op: 'set', value: mutation.value }
          : mutation.op === 'delete'
            ? { op: 'delete' }
            : mutation.op === 'array-insert'
              ? { op: 'array-insert', index: mutation.index!, values: mutation.values! }
              : { op: 'array-delete', index: mutation.index!, count: mutation.count! };
      const applied = applyMutationAtBoundary(derived, plan, boundaryLogical, payload);
      if (!applied.ok) return { kind: 'fail', issues: issuesOf(applied.result) };
      // S7：换根导航取提交位（union 位经 resolveNode 以 boundaryLogical 等值消歧——
      // 算法与全量快照导航零改动，logical 输入 = 边界提取值对应下钻）
      let commit: PreparedCommit;
      let facts: BoundaryCommitFacts;
      const rootLive = boundaryLive as Y.Map<unknown>;
      if (mutation.op === 'array-insert' || mutation.op === 'array-delete') {
        const resolvedTarget = navigateLive(rootLive, boundaryNode, boundaryLogical, plan.relPath, resolve);
        const resolvedNode = resolve(resolvedTarget.node);
        if (resolvedNode.kind !== 'array') {
          throw new DerivedInvariantError('array mutation 目标结构节点非 array（两树分歧）');
        }
        const target = resolvedTarget.live as Y.Array<unknown>;
        const beforeLength = target.length;
        if (mutation.op === 'array-insert') {
          const values = mutation.values!;
          const builtValues: unknown[] = [];
          for (let i = 0; i < values.length; i++) {
            const built = buildDetachedValue(derived, resolvedNode.element, values[i]!, [...mutation.path, mutation.index! + i]);
            if (built.kind === 'issue') return failIssue(built.issue.path, built.issue.message);
            builtValues.push(built.value);
          }
          commit = { kind: 'array-insert', target, index: mutation.index!, values: builtValues };
          facts = { kind: 'insert', target, index: mutation.index!, built: builtValues, beforeLength };
        } else {
          commit = { kind: 'array-delete', target, index: mutation.index!, count: mutation.count! };
          facts = { kind: 'delete-range', target, index: mutation.index!, count: mutation.count!, beforeLength };
        }
      } else {
        const parentNav = navigateLive(rootLive, boundaryNode, boundaryLogical, plan.relPath.slice(0, -1), resolve);
        const parentMap = parentNav.live as Y.Map<unknown>;
        const key = plan.relPath[plan.relPath.length - 1]!;
        if (mutation.op === 'delete') {
          commit = { kind: 'delete', parent: parentMap, key: key as string };
          facts = { kind: 'delete', parent: parentMap, key: key as string };
        } else {
          const targetStep = navigateLive(rootLive, boundaryNode, boundaryLogical, plan.relPath, resolve);
          const built = buildDetachedValue(derived, targetStep.node, mutation.value, mutation.path);
          if (built.kind === 'issue') return failIssue(built.issue.path, built.issue.message);
          commit = { kind: 'set', parent: parentMap, key: key as string, value: built.value };
          facts = { kind: 'set', parent: parentMap, key: key as string, installed: built.value };
        }
      }
      return {
        kind: 'ok',
        commit,
        verify: {
          derived,
          structureNode: boundaryNode,
          boundaryLive,
          proposedBoundary: applied.proposedBoundary,
          facts,
        },
      };
    }
  }
}
