/**
 * ADR-0007 validated mutation bridge. Every operation is simulated against a
 * concrete JSON snapshot and fully validated before a single guarded Yjs
 * transaction applies the corresponding minimal carrier edit.
 */
import * as Y from 'yjs';
import type { DerivedSchema, StructureNode } from '@nomicore/vfsl';
import { validateLogicalSnapshot } from '@nomicore/vfsl';
import { extractYjsSnapshot, walk } from './extract.js';
import { assertOutermostTransactionContext } from './tx-guard.js';
import { buildDetachedValue, buildTopEntries } from './detached-build.js';
import { verifyInstall, verifySnapshotIntact } from './install-verify.js';
import { carrierOf } from './carrier.js';
import { makeRefResolver } from './resolve.js';
import { DerivedInvariantError, DocRuntimeFatalError, transactGuarded } from './fatal.js';

export interface MutationIssue {
  message: string;
  path: Array<string | number>;
}

export type MutationPath = readonly (string | number)[];
export type ValidatedMutation =
  | { op: 'set'; path: MutationPath; value: unknown }
  | { op: 'delete'; path: MutationPath }
  | { op: 'array-insert'; path: MutationPath; index: number; values: readonly unknown[] }
  | { op: 'array-delete'; path: MutationPath; index: number; count: number };

export type ApplyValidatedMutationResult =
  | { ok: true }
  | { ok: false; issues: MutationIssue[] };

type Path = Array<string | number>;
type ParsedMutation = ValidatedMutation & { path: Path };
type PreparedCommit =
  | { kind: 'replace-root'; rootMap: Y.Map<unknown>; entries: Array<[string, unknown]> }
  | { kind: 'set'; parent: Y.Map<unknown>; key: string; value: unknown }
  | { kind: 'delete'; parent: Y.Map<unknown>; key: string }
  | { kind: 'array-insert'; target: Y.Array<unknown>; index: number; values: unknown[] }
  | { kind: 'array-delete'; target: Y.Array<unknown>; index: number; count: number };
type MutationPrepared =
  | { kind: 'ready'; commit: PreparedCommit; proposed: unknown }
  | { kind: 'fail'; issues: MutationIssue[] };
type PlaceResult = { kind: 'ok'; value: unknown } | { kind: 'issue'; issue: MutationIssue };
type StepResult = { kind: 'ok'; value: unknown } | { kind: 'issue'; issue: MutationIssue };
type LiveStep = { live: unknown; node: StructureNode };

/** Apply one ADR-0007 set/delete/array-insert/array-delete operation synchronously. */
export function applyValidatedMutation(
  derived: DerivedSchema,
  doc: Y.Doc,
  mutation: ValidatedMutation | unknown,
): ApplyValidatedMutationResult {
  assertOutermostTransactionContext(doc, 'applyValidatedMutation');
  const ready = prepareMutation(derived, doc, mutation);
  if (ready.kind === 'fail') return { ok: false, issues: ready.issues };
  transactGuarded(doc, () => commitPrepared(ready.commit));
  if (ready.commit.kind === 'replace-root') {
    verifyInstall({ rootMap: ready.commit.rootMap, entries: ready.commit.entries });
  }
  verifySnapshotIntact(derived, ready.proposed, doc);
  return { ok: true };
}

function prepareMutation(derived: DerivedSchema, doc: Y.Doc, mutation: unknown): MutationPrepared {
  try {
    const parsed = parseMutation(mutation);
    if (parsed.kind === 'fail') return parsed;
    if (derived.structure.kind !== 'root') {
      throw new DerivedInvariantError('derived.structure 非 root（手造派生物）');
    }
    const ex = extractYjsSnapshot(derived, doc);
    if (!ex.ok) return { kind: 'fail', issues: ex.issues };
    const logical = validateLogicalSnapshot(derived, ex.snapshot);
    if (!logical.ok) return { kind: 'fail', issues: logical.issues };

    const proposed = cloneJson(ex.snapshot);
    const placed = applyToJson(proposed, parsed.mutation);
    if (placed.kind === 'issue') return { kind: 'fail', issues: [placed.issue] };

    const validated = validateLogicalSnapshot(derived, placed.value);
    if (!validated.ok) return { kind: 'fail', issues: validated.issues };
    const commit = prepareCommit(derived, doc, parsed.mutation, ex.snapshot, placed.value);
    if (commit.kind === 'issue') return { kind: 'fail', issues: [commit.issue] };
    return { kind: 'ready', commit: commit.commit, proposed: placed.value };
  } catch (err) {
    if (err instanceof DerivedInvariantError) {
      throw new DocRuntimeFatalError(
        'pre-commit-internal',
        false,
        `DOCRT-E204: 写前 internal 不变量破坏（${err.message}）——合规调用者不可达（派生物仅可由 evaluate 产出，此处为 internal 缺陷类）；本调用零写入（doc 状态不因本调用改变）；不补偿、不 fallback`,
        { cause: err },
      );
    }
    return failIssue([], `DOCRT-E205: applyValidatedMutation 内部错误（意外异常）:「${errDetailOf(err)}」`);
  }
}

function prepareCommit(
  derived: DerivedSchema,
  doc: Y.Doc,
  mutation: ParsedMutation,
  current: unknown,
  proposed: unknown,
): { kind: 'ok'; commit: PreparedCommit } | { kind: 'issue'; issue: MutationIssue } {
  const rootMap = doc.getMap<unknown>('ROOT');
  if (mutation.op === 'set' && mutation.path.length === 0) {
    const top = buildTopEntries(derived, proposed);
    if (top.kind === 'issue') return top;
    return { kind: 'ok', commit: { kind: 'replace-root', rootMap, entries: top.entries } };
  }

  const resolve = makeRefResolver(derived);
  if (mutation.op === 'array-insert' || mutation.op === 'array-delete') {
    const target = navigateLive(rootMap, rootStructureNode(derived), current, mutation.path, resolve);
    if (carrierOf(target.live) !== 'Y.Array') return issueOf(mutation.path, 'array mutation 目标 live 载体不是 Y.Array');
    if (mutation.op === 'array-delete') {
      return {
        kind: 'ok',
        commit: { kind: 'array-delete', target: target.live as Y.Array<unknown>, index: mutation.index, count: mutation.count },
      };
    }
    const logicalTarget = navigate(proposed, mutation.path);
    if (logicalTarget.kind === 'issue') return logicalTarget;
    const node = resolveNode(target.node, target.live, logicalTarget.value, resolve);
    if (node.kind !== 'array') throw new DerivedInvariantError('array mutation 目标结构节点非 array');
    const values: unknown[] = [];
    for (let i = 0; i < mutation.values.length; i++) {
      const built = buildDetachedValue(derived, node.element, mutation.values[i], [...mutation.path, mutation.index + i]);
      if (built.kind === 'issue') return built;
      values.push(built.value);
    }
    return {
      kind: 'ok',
      commit: { kind: 'array-insert', target: target.live as Y.Array<unknown>, index: mutation.index, values },
    };
  }

  const parentPath = mutation.path.slice(0, -1);
  const parent = navigateLive(rootMap, rootStructureNode(derived), current, parentPath, resolve);
  const key = mutation.path[mutation.path.length - 1];
  if (carrierOf(parent.live) !== 'Y.Map' || typeof key !== 'string') {
    return issueOf(mutation.path, `${mutation.op} 终态必须是 Y.Map 的字符串键`);
  }
  if (mutation.op === 'delete') {
    return { kind: 'ok', commit: { kind: 'delete', parent: parent.live as Y.Map<unknown>, key } };
  }
  const parentLogical = navigate(current, parentPath);
  if (parentLogical.kind === 'issue') return parentLogical;
  const targetNode = childNodeOf(parent.node, key, parent.live, parentLogical.value, resolve);
  const built = buildDetachedValue(derived, targetNode, mutation.value, mutation.path);
  if (built.kind === 'issue') return built;
  return { kind: 'ok', commit: { kind: 'set', parent: parent.live as Y.Map<unknown>, key, value: built.value } };
}

function rootStructureNode(derived: DerivedSchema): StructureNode {
  if (derived.structure.kind !== 'root') throw new DerivedInvariantError('derived.structure 非 root（手造派生物）');
  return derived.structure.node;
}

function commitPrepared(commit: PreparedCommit): void {
  switch (commit.kind) {
    case 'replace-root':
      commit.rootMap.clear();
      for (const [key, value] of commit.entries) commit.rootMap.set(key, value);
      return;
    case 'set':
      commit.parent.set(commit.key, commit.value);
      return;
    case 'delete':
      commit.parent.delete(commit.key);
      return;
    case 'array-insert':
      commit.target.insert(commit.index, commit.values);
      return;
    case 'array-delete':
      commit.target.delete(commit.index, commit.count);
      return;
  }
}

function navigateLive(
  rootMap: Y.Map<unknown>,
  rootNode: StructureNode,
  logicalRoot: unknown,
  path: Path,
  resolve: (node: StructureNode) => StructureNode,
): LiveStep {
  let live: unknown = rootMap;
  let logical: unknown = logicalRoot;
  let node = rootNode;
  for (const seg of path) {
    const resolved = resolveNode(node, live, logical, resolve);
    if (resolved.kind === 'map') {
      if (carrierOf(live) !== 'Y.Map' || typeof seg !== 'string') {
        throw new DerivedInvariantError('validated map path 与 live Y.Map 载体不一致');
      }
      const parentLive = live;
      const parentLogical = logical;
      live = (parentLive as Y.Map<unknown>).get(seg);
      logical = plainObjectOf(parentLogical)?.[seg];
      node = childNodeOf(resolved, seg, parentLive, parentLogical, resolve);
      continue;
    }
    if (resolved.kind === 'array') {
      if (carrierOf(live) !== 'Y.Array' || !strictNonNegativeInteger(seg)) {
        throw new DerivedInvariantError('validated array path 与 live Y.Array 载体不一致');
      }
      live = (live as Y.Array<unknown>).get(seg);
      logical = Array.isArray(logical) ? logical[seg] : undefined;
      node = resolved.element;
      continue;
    }
    throw new DerivedInvariantError('validated path 穿越不可下钻结构终态');
  }
  return { live, node: resolveNode(node, live, logical, resolve) };
}

function resolveNode(
  node: StructureNode,
  live: unknown,
  logical: unknown,
  resolve: (node: StructureNode) => StructureNode,
): StructureNode {
  let current = resolve(node);
  if (current.kind === 'root') current = resolve(current.node);
  if (current.kind !== 'union') return current;
  for (const member of current.members) {
    const candidate = resolveNode(member, live, logical, resolve);
    if (!carrierCompatible(candidate, live)) continue;
    const trial = walk(candidate, live, [], resolve);
    if (trial.kind !== 'issue' && logicalValuesEqual(trial.snapshot, logical)) return candidate;
  }
  throw new DerivedInvariantError('validated union 无 live/logical 匹配成员');
}

function logicalValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => logicalValuesEqual(value, b[index]));
  }
  const ao = plainObjectOf(a);
  const bo = plainObjectOf(b);
  if (ao === null || bo === null) return false;
  const aKeys = Object.keys(ao).filter((key) => ao[key] !== undefined);
  const bKeys = Object.keys(bo).filter((key) => bo[key] !== undefined);
  return aKeys.length === bKeys.length
    && aKeys.every((key) => bo[key] !== undefined && logicalValuesEqual(ao[key], bo[key]));
}

function carrierCompatible(node: StructureNode, live: unknown): boolean {
  switch (node.kind) {
    case 'map': return live === undefined || carrierOf(live) === 'Y.Map';
    case 'array': return live === undefined || carrierOf(live) === 'Y.Array';
    case 'xml-fragment': return live === undefined || carrierOf(live) === 'Y.XmlFragment';
    case 'leaf':
    case 'plain': return live === undefined || carrierOf(live) === 'plain value';
    default: return true;
  }
}

function childNodeOf(
  node: StructureNode,
  key: string,
  live: unknown,
  logical: unknown,
  resolve: (node: StructureNode) => StructureNode,
): StructureNode {
  const resolved = resolveNode(node, live, logical, resolve);
  if (resolved.kind !== 'map') throw new DerivedInvariantError('validated map child 的结构节点非 map');
  const record = resolved.fields.length === 1 && resolved.fields[0]?.name === '<key>'
    ? resolved.fields[0].node
    : undefined;
  const child = record ?? resolved.fields.find((field) => field.name === key)?.node;
  if (child === undefined) throw new DerivedInvariantError(`validated map child 缺少结构字段（${key}）`);
  return child;
}

function parseMutation(input: unknown):
  | { kind: 'ok'; mutation: ParsedMutation }
  | { kind: 'fail'; issues: MutationIssue[] } {
  const env = plainObjectOf(input);
  if (env === null) return failIssue([], `mutation 信封形状错误：期望普通对象，实际 ${wordOf(input)}`);
  const op = env.op;
  const specs: Record<string, readonly string[]> = {
    set: ['op', 'path', 'value'],
    delete: ['op', 'path'],
    'array-insert': ['op', 'path', 'index', 'values'],
    'array-delete': ['op', 'path', 'index', 'count'],
  };
  if (typeof op !== 'string' || !Object.hasOwn(specs, op)) return failIssue([], `未知操作 "${String(op)}"`);
  const operation = op as ValidatedMutation['op'];
  const allowed = specs[operation]!;
  const unknown = Object.keys(env).find((k) => !allowed.includes(k));
  if (unknown !== undefined) return failIssue([], `未知信封键 "${unknown}"（操作 ${op}）`);
  const missing = allowed.find((k) => !Object.hasOwn(env, k));
  if (missing !== undefined) return failIssue([], `信封缺少必需键 "${missing}"（操作 ${op}）`);
  if (!Array.isArray(env.path)) return failIssue([], 'path 必须是数组（段为 string|number）');
  const path = [...env.path] as Path;
  for (const seg of path) {
    if (typeof seg !== 'string' && typeof seg !== 'number') return failIssue([], `path 段类型错误：期望 string|number，实际 ${typeof seg}`);
  }
  if (op === 'set') {
    if (env.value === undefined) return failIssue([], 'set 需携带非 undefined value');
    return { kind: 'ok', mutation: { op, path, value: env.value } };
  }
  if (op === 'delete') return { kind: 'ok', mutation: { op, path } };
  if (!strictNonNegativeInteger(env.index)) return failIssue(path, `${op} index 必须是严格非负整数`);
  if (op === 'array-insert') {
    if (!Array.isArray(env.values) || env.values.length === 0) return failIssue(path, 'array-insert values 必须是非空数组');
    if (env.values.some((v) => v === undefined)) return failIssue(path, 'array-insert values 不得包含 undefined');
    return { kind: 'ok', mutation: { op, path, index: env.index, values: [...env.values] } };
  }
  if (op !== 'array-delete') return failIssue([], `未知操作 "${String(op)}"`);
  if (!strictPositiveInteger(env.count)) return failIssue(path, 'array-delete count 必须是严格正整数');
  return { kind: 'ok', mutation: { op, path, index: env.index, count: env.count } };
}

function applyToJson(root: unknown, mutation: ParsedMutation): PlaceResult {
  switch (mutation.op) {
    case 'set': return placeSet(root, mutation.path, mutation.value);
    case 'delete': return placeDelete(root, mutation.path);
    case 'array-insert': return placeArrayInsert(root, mutation.path, mutation.index, mutation.values);
    case 'array-delete': return placeArrayDelete(root, mutation.path, mutation.index, mutation.count);
  }
}

function placeSet(root: unknown, path: Path, value: unknown): PlaceResult {
  if (path.length === 0) return { kind: 'ok', value };
  const parent = navigateToParent(root, path);
  if (parent.kind === 'issue') return parent;
  const seg = path[path.length - 1]!;
  const obj = plainObjectOf(parent.value);
  if (obj === null) {
    if (Array.isArray(parent.value)) return issueOf(path, 'set 终态不支持数组下标');
    return issueOf(path, `路径穿越不可下钻终态——终段父节点非普通对象（实际 ${wordOf(parent.value)}）`);
  }
  if (typeof seg !== 'string') return issueOf(path, '终段键段非字符串');
  Object.defineProperty(obj, seg, { value, writable: true, enumerable: true, configurable: true });
  return { kind: 'ok', value: root };
}

function placeDelete(root: unknown, path: Path): PlaceResult {
  if (path.length === 0) return issueOf([], 'delete 禁止删除 ROOT');
  const parent = navigateToParent(root, path);
  if (parent.kind === 'issue') return parent;
  if (Array.isArray(parent.value)) return issueOf(path, 'delete 禁止数组下标；请使用 array-delete');
  const obj = plainObjectOf(parent.value);
  const seg = path[path.length - 1]!;
  if (obj === null || typeof seg !== 'string') return issueOf(path, 'delete 终段必须是普通对象的字符串键');
  if (!Object.hasOwn(obj, seg)) return issueOf(path, 'delete 目标键不存在（拒绝 no-op）');
  delete obj[seg];
  return { kind: 'ok', value: root };
}

function placeArrayInsert(root: unknown, path: Path, index: number, values: readonly unknown[]): PlaceResult {
  const target = navigate(root, path);
  if (target.kind === 'issue') return target;
  if (!Array.isArray(target.value)) return issueOf(path, 'array-insert 目标必须是数组');
  if (index > target.value.length) return issueOf(path, 'array-insert index 越界（不 clamp）');
  target.value.splice(index, 0, ...values);
  return { kind: 'ok', value: root };
}

function placeArrayDelete(root: unknown, path: Path, index: number, count: number): PlaceResult {
  const target = navigate(root, path);
  if (target.kind === 'issue') return target;
  if (!Array.isArray(target.value)) return issueOf(path, 'array-delete 目标必须是数组');
  if (index >= target.value.length || index + count > target.value.length) return issueOf(path, 'array-delete 范围越界（不 clamp、不接受越界 no-op）');
  target.value.splice(index, count);
  return { kind: 'ok', value: root };
}

function navigateToParent(root: unknown, path: Path): StepResult {
  return navigate(root, path.slice(0, -1));
}

function navigate(root: unknown, path: Path): StepResult {
  let cur = root;
  for (let i = 0; i < path.length; i++) {
    const next = stepInto(cur, path[i]!, path, i);
    if (next.kind === 'issue') return next;
    cur = next.value;
  }
  return { kind: 'ok', value: cur };
}

function stepInto(parent: unknown, seg: string | number, path: Path, at: number): StepResult {
  const prefix = path.slice(0, at);
  const obj = plainObjectOf(parent);
  if (obj !== null) {
    if (typeof seg !== 'string') return issueOf(prefix, '中间容器导航键段非字符串');
    if (!Object.hasOwn(obj, seg)) return issueOf(prefix, '中间容器缺失——不自动创建中间容器');
    return { kind: 'ok', value: obj[seg] };
  }
  if (Array.isArray(parent)) {
    if (!strictNonNegativeInteger(seg) || seg >= parent.length) return issueOf(prefix, '数组下标越界或非整数下标');
    return { kind: 'ok', value: parent[seg] };
  }
  return issueOf(prefix, `路径穿越不可下钻终态（实际 ${wordOf(parent)}）`);
}

function cloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function strictNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function strictPositiveInteger(value: unknown): value is number {
  return strictNonNegativeInteger(value) && value > 0;
}

function plainObjectOf(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null ? value as Record<string, unknown> : null;
}

function wordOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function failIssue(path: Path, message: string): { kind: 'fail'; issues: MutationIssue[] } {
  return { kind: 'fail', issues: [{ message, path }] };
}

function issueOf(path: Path, message: string): { kind: 'issue'; issue: MutationIssue } {
  return { kind: 'issue', issue: { message, path } };
}

function errDetailOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
