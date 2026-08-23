/**
 * @nomicore/doc-runtime — ⑤⑥ 写后校验收敛 seam（issue #88 设计 §3.1 / D2 / §4.4）。
 *
 * 自 materialize.ts 纯移动（issue #88 设计 §3.1，resolve.ts 先例纪律）：签名与实现逐字
 * 不变——verifyInstall（⑤ 顶层 size + 逐键同一性双断言）/ verifySnapshotIntact（⑥
 * 对称重物化）+ buildScratchInstall / productEqual / deepEqualValue / valueDiff /
 * detailOf / keysetOf / summarize / errDetail + e201C / e201D + 内部类型
 * ScratchInstall / ProductComparison。移动使 materializeRoot 与 replaceRootContent
 * 共享同一写后校验实现（W1 唯一相容形态：偏离 → throw DOCRT-E201 家族）。
 *
 * import 面（R2 显式化，issue #88 设计 §3.1）：detached-build 的 `@internal`
 * plainObjectOf / recordSlotOf / declaredFieldOf + 类型 Path / Resolver / BuildIssue
 * （productEqual map 分支 / deepEqualValue / keysetOf 消费辅助；ScratchInstall /
 * ProductComparison 消费类型）+ `buildTopEntries`（scratch 构造与 real 侧 ② 同一
 * seam）——DAG 单向边（install-verify → detached-build），无环。
 * 两个导出均不点名 API（E201 文案本为 generic，天然两用——D8）。
 *
 * 注：renderPath（诊断辅助）在本模块内私有重定义（同文 6 行）——detached-build 的导出面
 * 按设计 §3.1 写死（不含 renderPath），detailOf 的渲染依赖由此闭合；仅 message 文本渲染，
 * 不属构造规则共享面（AC-1 零复制纪律对象）。
 */
import * as Y from 'yjs';
import type { DerivedSchema, StructureNode } from '@nomicore/vfsl';
import {
  buildTopEntries,
  plainObjectOf,
  recordSlotOf,
  declaredFieldOf,
} from './detached-build.js';
import type { BuildIssue, Path, Resolver } from './detached-build.js';
import { extractYjsSnapshot } from './extract.js';
import type { ExtractResult } from './extract.js';
import { DocRuntimeFatalError } from './fatal.js';
import { makeRefResolver } from './resolve.js';
import { canonicalXmlOf } from './xml-parse.js';

/**
 * ⑤ 事务后顶层完整性校验（RD1，INV-10）。双断言缺一不可（G5 实证：observer 同轮
 * delete 计划键 + insert 额外键可保持 size 相等而同一性破坏——只查 size 会漏报）。
 * 只读；任何偏离 → throw DOCRT-E201（W1 唯一相容形态：不返回 ok:false——事务已提交，
 * 「失败⟹文档不变」只覆盖验证/构造失败域；不补偿修复——「不覆盖、不合并、不 fallback」；
 * 不声称已回滚——message 明示写入已提交、doc 保持 observer 留下的实际状态）。
 */
export function verifyInstall(ready: { rootMap: Y.Map<unknown>; entries: Array<[string, unknown]> }): void {
  const { rootMap, entries } = ready;
  if (rootMap.size !== entries.length) {
    // 覆盖向量：delete 计划键（size 减）/ insert 额外键（size 增）/ 组合
    throw new DocRuntimeFatalError(
      'post-commit-verification',
      true,
      `DOCRT-E201: ROOT 顶层安装完整性偏离：期望 ${entries.length} 个键，事务提交后实际 ` +
      `${rootMap.size} 个（实际键集：${JSON.stringify([...rootMap.keys()])}）——疑似 observer ` +
      `同步重入修改 ROOT；写入已提交，不回滚、不补偿，doc 保持 observer 留下的实际状态`,
    );
  }
  for (const [key, value] of entries) {
    if (rootMap.get(key) !== value) {
      // 覆盖向量：overwrite 计划键（值不同一）/ delete 后重插异值 / delete 单键（size 断言亦会抓，
      // 此处兜底）。严格同一性（===）对标量（不可变）与引用类型（yjs set 按引用存储，A19/G5 实证
      // 集成后 get 返回同一实例）均正确：同值重插（G4）不误报。
      throw new DocRuntimeFatalError(
        'post-commit-verification',
        true,
        `DOCRT-E201: ROOT 顶层安装完整性偏离：键 "${key}" 的值在事务提交后与安装值不同一——` +
        `疑似 observer 覆写或删除后重插异值；写入已提交，不回滚、不补偿，doc 保持 observer 留下的实际状态`,
      );
    }
  }
}

/** E201 变体 C（检测到偏离——对照管线读回不等）。消息措辞定稿（rev2 设计 §4.2）。 */
function e201C(detail: string): Error {
  return new DocRuntimeFatalError(
    'post-commit-verification',
    true,
    `DOCRT-E201: ROOT 逻辑快照安装后语义校验偏离：${detail}——疑似 observer 修改已安装子树` +
    `（与同一输入经同一管线的未修改安装读回不等）；写入已提交，不回滚、不补偿，doc 保持 observer 留下的实际状态`,
  );
}

/** E201 变体 D（校验未能运行，不代表偏离；触发类枚举 rev2 设计 §4.2 变体 D）。 */
function e201D(detail: string, cause?: unknown): Error {
  return new DocRuntimeFatalError(
    'post-commit-verification',
    true,
    `DOCRT-E201: ROOT 安装后完整性校验无法完成（${detail}）——写入已提交，不回滚、不补偿；` +
    `此形态不代表已检测到偏离，仅代表校验防线未能运行`,
    cause === undefined ? undefined : { cause },
  );
}

type ScratchInstall =
  | { kind: 'ok'; scratchDoc: Y.Doc }
  | { kind: 'fail'; issue: BuildIssue };

/** scratch 侧构造：② 同款 build + ④ 同款单事务安装进一次性 new Y.Doc()（零 observer、
 * 零外发事件、事务后即弃——GC 回收，detached doc 零真实 doc 副作用；yjs 类型单 doc 集成
 * 约束 ⇒ 不能复用 real 侧 entries，必须重建）。不得递归调用 materializeRoot（会触发
 * ⓪/⑤/⑥ 自身——rev2 设计 R4 回应表移交注意点）。 */
function buildScratchInstall(derived: DerivedSchema, snapshot: unknown): ScratchInstall {
  const top = buildTopEntries(derived, snapshot); // ② 同款（fresh detached 实例 + fresh resolver）
  if (top.kind === 'issue') return { kind: 'fail', issue: top.issue };
  const scratchDoc = new Y.Doc();
  const rootMap = scratchDoc.getMap('ROOT');
  scratchDoc.transact(() => {
    for (const [key, value] of top.entries) rootMap.set(key, value); // ④ 同款单事务安装
  });
  return { kind: 'ok', scratchDoc };
}

/** 产物比较两结局（首个差异诊断：path + 两侧摘要 + 键集/值支区分——rev2 设计 §4.2 变体 C）。 */
type ProductComparison =
  | { equal: true }
  | { equal: false; kind: 'value' | 'keyset'; path: Path; real: unknown; scratch: unknown };

/**
 * ⑥ 安装后完整逻辑快照校验（rev2 RD8 / Medium 出口 1；R4/F-R3-1 对称重物化）。
 * 比较基准 = extract(real) ≡ extract(scratch)——scratch 是同一输入经同一物化管线在一次性
 * doc 上的**未修改**安装；两侧构造性对称，仲裁在两侧一致（rev2 §4.2/§4.2.1 双向论证）。
 * 写后检测面 → W1 唯一相容形态 throw（E201 变体 C=检测到偏离 / D=校验未能运行）。
 */
export function verifySnapshotIntact(derived: DerivedSchema, snapshot: unknown, doc: Y.Doc): void {
  // (1) scratch 侧构造/安装。构造/安装异常（throw 或 issue 返回）→ E201 变体 D（触发类④
  //     ——理论不可达，防御性收敛；对抗 Proxy 双读使第二次 build **发散但不抛**时落在
  //     (3) 的 C 支——R-5，loud 绝不假成功）。
  let scratch: ScratchInstall;
  try {
    scratch = buildScratchInstall(derived, snapshot);
  } catch (err) {
    throw e201D(`scratch 构造异常（触发类④）：${errDetail(err)}`, err);
  }
  if (scratch.kind === 'fail') {
    throw e201D(`scratch 构造失败（触发类④）：${scratch.issue.message}`);
  }
  // (2) 双侧提取：exReal = extractYjsSnapshot(derived, doc)（公共读入口，INV-6 不外抛）；
  //     exScratch = extractYjsSnapshot(derived, scratchDoc)。
  //     exReal 失败 → E201 变体 C（提取失败支——已安装子树载体被 observer 改坏）；
  //     exScratch 失败 / 任一 throw → E201 变体 D（触发类④——理论不可达，防御性收敛）。
  let exReal: ExtractResult;
  let exScratch: ExtractResult;
  try {
    exReal = extractYjsSnapshot(derived, doc);
    exScratch = extractYjsSnapshot(derived, scratch.scratchDoc);
  } catch (err) {
    throw e201D(`提取异常（触发类④）：${errDetail(err)}`, err);
  }
  if (!exReal.ok) {
    throw e201C(`提取失败（${exReal.issues[0]?.message ?? '未知'}）——已安装子树载体与结构树不符`);
  }
  if (!exScratch.ok) {
    throw e201D(`scratch 侧提取失败（触发类④）：${exScratch.issues[0]?.message ?? '未知'}`);
  }
  // (3) 比较：productEqual —— 两个**同管线产物**的相等判定（全键集 + 逐元素 + XML
  //     canonical；union 角色分发 any-of）。不相等 → E201 变体 C（detail 报首个差异 path +
  //     两侧摘要；措辞涵盖 observer 修改与输入对抗性双读发散——R-5）。比较器异常（ref
  //     环/缺名、canonical 扫描失败、深栈溢出）→ E201 变体 D（触发类②/③/①）。
  let cmp: ProductComparison;
  try {
    if (derived.structure.kind !== 'root') {
      // 对齐 ② B8 loud 边界（real 侧 prepare 已过，理论不可达——防御性收敛归 ⑥ 变体 D）
      throw new Error('derived.structure 非 root（手造派生物）');
    }
    const resolve = makeRefResolver(derived);
    cmp = productEqual(derived.structure.node, exReal.snapshot, exScratch.snapshot, resolve, []);
  } catch (err) {
    throw e201D(`产物比较异常（触发类①/②/③）：${errDetail(err)}`, err);
  }
  if (!cmp.equal) throw e201C(detailOf(cmp));
}

/**
 * productEqual —— 同管线产物相等判定（R4 新规；替代退役的三值 cmp/无损谓词）。两侧均为
 * extract 产物（纯 JSON 逻辑快照、出自同一确定性管线），比较**可观测产物整体**——投影过滤
 * 语义随 input-vs-product 基准一并退役（R2/R3 掩盖机理结构性不可达：无投影即无「被投影滤掉
 * 的键」）。逐 kind 规则见 rev2 设计 §4.2 表：map 全键集（undefined 值视同缺席，双侧同规）+
 * 逐共有键递归（封闭 map 未声明键按值深度相等兜底——不做声明字段过滤，键集差异本身即偏离）；
 * array 长度 + 逐元素（顺序敏感）；xml-fragment 两侧 string → canonical 语义等价
 * （canonicalXmlOf；扫描失败 → throw → ⑥ 变体 D，不谎报偏离）；leaf/plain 深度结构相等；
 * union 角色分发 any-of（成员仅决定子位 canonical/exact 角色，无准入游戏）；root/ref
 * resolve 下钻（环/缺名 → throw → ⑥ 变体 D）。
 */
function productEqual(node: StructureNode, a: unknown, b: unknown, resolve: Resolver, path: Path): ProductComparison {
  switch (node.kind) {
    case 'root':
      return productEqual(node.node, a, b, resolve, path);
    case 'ref':
      return productEqual(resolve(node), a, b, resolve, path); // 环/缺名 → throw → ⑥ 变体 D
    case 'map': {
      const ao = plainObjectOf(a);
      const bo = plainObjectOf(b);
      if (ao === null || bo === null) return valueDiff(path, a, b);
      const aKeys = Object.keys(ao).filter((k) => ao[k] !== undefined); // undefined 视同缺席
      const bKeys = Object.keys(bo).filter((k) => bo[k] !== undefined);
      if (aKeys.length !== bKeys.length || !aKeys.every((k) => bo[k] !== undefined)) {
        return { equal: false, kind: 'keyset', path, real: a, scratch: b }; // 键集差即偏离（D1/插入翻转）
      }
      const slot = recordSlotOf(node); // Record 形：单字段 '<key>'（与 extract.ts 同款约定）
      for (const k of aKeys) {
        const child = slot ?? declaredFieldOf(node, k);
        let r: ProductComparison;
        if (child === undefined) {
          // 封闭 map 未声明键：不做声明字段过滤——按值深度相等兜底（无准入游戏），
          // 攻击值差在任意成员下立判（Shape B 掩盖向量在方案 b 下天然 diff）
          r = deepEqualValue(ao[k], bo[k]) ? { equal: true } : valueDiff([...path, k], ao[k], bo[k]);
        } else {
          r = productEqual(child, ao[k], bo[k], resolve, [...path, k]);
        }
        if (!r.equal) return r; // 首个差异（fail-fast 诊断）
      }
      return { equal: true };
    }
    case 'array': {
      if (!Array.isArray(a) || !Array.isArray(b)) return valueDiff(path, a, b);
      if (a.length !== b.length) return valueDiff(path, a, b);
      for (let i = 0; i < a.length; i++) {
        const r = productEqual(node.element, a[i], b[i], resolve, [...path, i]); // i = number 段
        if (!r.equal) return r;
      }
      return { equal: true };
    }
    case 'xml-fragment': {
      if (typeof a !== 'string' || typeof b !== 'string') return valueDiff(path, a, b);
      const ca = canonicalXmlOf(a);
      const cb = canonicalXmlOf(b);
      if (!ca.ok) {
        // canonical 扫描失败（任一侧）→ throw → ⑥ 变体 D（rev2 §4.3/R2/#7：防线未运行
        // 或 observer 注入不可扫描内容——绝不假成功；RT-5 主锚）
        throw new Error(`XML canonical 扫描失败（${ca.reason}）`);
      }
      if (!cb.ok) {
        throw new Error(`XML canonical 扫描失败（${cb.reason}）`);
      }
      return ca.canonical === cb.canonical ? { equal: true } : valueDiff(path, a, b);
    }
    case 'leaf':
    case 'plain':
      return deepEqualValue(a, b) ? { equal: true } : valueDiff(path, a, b);
    case 'union': {
      // 角色分发 any-of：按声明序取首个使 productEqual(member, a, b) 为真的成员即等价；
      // 全拒 → 不等（成员仅决定子位 canonical/exact 角色——无准入游戏）。诚实路径两侧
      // 同管线产物逐位一致，任意成员判定一致；攻击使产物分歧时，全键集/逐元素比较在任意
      // 成员下都能看见键集与值差（R-8 残余仅涉 string 位 canonical 角色边角，rev2 §4.2）。
      let firstDiff: ProductComparison | undefined;
      for (const member of node.members) {
        const r = productEqual(resolve(member), a, b, resolve, path);
        if (r.equal) return r;
        if (firstDiff === undefined) firstDiff = r; // 声明序首成员差异（诊断保留）
      }
      return firstDiff ?? valueDiff(path, a, b);
    }
  }
}

/**
 * 深度结构相等（leaf/plain 分支 + 封闭 map 未声明键兜底）：标量 `===`；plain object 全键集
 * + 递归（undefined 值视同缺席，双侧同规）；array 逐元素。extract 产物为纯 JSON（non-finite
 * number / undefined / bigint 等已被 extract 读侧拒绝）——`===` 即全值域判定。
 */
function deepEqualValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqualValue(a[i], b[i])) return false;
    }
    return true;
  }
  const ao = plainObjectOf(a);
  const bo = plainObjectOf(b);
  if (ao !== null && bo !== null) {
    const aKeys = Object.keys(ao).filter((k) => ao[k] !== undefined);
    const bKeys = Object.keys(bo).filter((k) => bo[k] !== undefined);
    if (aKeys.length !== bKeys.length || !aKeys.every((k) => bo[k] !== undefined)) return false;
    for (const k of aKeys) {
      if (!deepEqualValue(ao[k], bo[k])) return false;
    }
    return true;
  }
  return false;
}

function valueDiff(path: Path, a: unknown, b: unknown): ProductComparison {
  return { equal: false, kind: 'value', path, real: a, scratch: b };
}

/** 差异 detail（rev2 设计 §4.2 变体 C 措辞例：值支 / 键集支）。 */
function detailOf(cmp: Extract<ProductComparison, { equal: false }>): string {
  const p = renderPath(cmp.path);
  const seg = cmp.path.length > 0 ? String(cmp.path[cmp.path.length - 1]) : 'ROOT';
  if (cmp.kind === 'keyset') {
    return `键 "${seg}" 读回键集 ${JSON.stringify(keysetOf(cmp.real))} 与对照安装读回键集 ` +
      `${JSON.stringify(keysetOf(cmp.scratch))} 不等——疑似 observer 删除（或插入后仲裁翻转）（${p}）`;
  }
  return `键 "${seg}" 读回 ${summarize(cmp.real)} 与对照安装读回 ${summarize(cmp.scratch)} 不等价（${p}）`;
}

/** 键集摘要（map 分支键集支；undefined 值视同缺席）。 */
function keysetOf(v: unknown): string[] {
  const o = plainObjectOf(v);
  if (o === null) return [];
  return Object.keys(o).filter((k) => o[k] !== undefined);
}

/** 值摘要（rev2 设计 R2/#8(b)：截断 120 字符有界）。 */
function summarize(v: unknown): string {
  let s: string | undefined;
  try {
    s = JSON.stringify(v);
  } catch {
    s = String(v);
  }
  if (s === undefined) s = String(v);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

/** 错误详情（message 或 String 兜底——仅诊断文本）。 */
function errDetail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** path 渲染仅用于 message 文本（ADR-0007 禁的是 issue.path 的点号表示，不禁文本渲染）；
 *  与 extract.ts renderPath 同款实现思路。 */
function renderPath(path: Path): string {
  return path.length === 0 ? 'ROOT'
    : path.reduce<string>(
      (acc, seg) => (typeof seg === 'number' ? `${acc}[${seg}]` : `${acc}.${String(seg)}`),
      'ROOT',
    );
}
