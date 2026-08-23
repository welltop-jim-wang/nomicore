/**
 * @nomicore/doc-runtime — materializeRoot(derived, snapshot, doc)：验证后安全物化
 * logical ROOT 到 Yjs（ADR-0007 / issue #74）。extract 的方向反转孪生（JSON→doc，写侧）。
 *
 * 设计 §4.1–§4.8（wiki/raw/task_doc-runtime-materialize-root_design.md）+ 修订轮 rev1
 * （wiki/raw/task_doc-runtime-materialize-root-rev1_design.md，PR #84 owner Review 闭环）+
 * 修订轮 rev2（wiki/raw/task_doc-runtime-materialize-root-rev2_design.md，RD7/RD8/RD9/RD11；
 * SA2 R4 pass）：
 * - 六阶段编排（D1+RD1+RD7+RD8）：⓪ 活动 transaction 语境 guard（rev2 RD7/P1——函数体
 *   第一句、prepare 之前、一切 try/catch 之外；三窗口谓词命中 → throw DOCRT-E202，本函数
 *   零写入）① validateLogicalSnapshot（逻辑宽域，失败 → issues 引用零损透传，不重包装——
 *   AC-1 `toEqual` 契约）② detached 构造（结构窄域，失败 → 单 issue fail-fast）
 *   ③ probeRoot 探针 + ROOT 空置判定（复用 carrier.ts，零修改）④ 单次 doc.transact 安装
 *   ⑤ verifyInstall 事务后 ROOT 顶层完整性校验（rev1/RD1/INV-10：size + 逐键同一性双断言，
 *   偏离 → throw DOCRT-E201——F11，W1 三禁：不返回 ok:false、不补偿修复、不声称已回滚）
 *   ⑥ verifySnapshotIntact 对称重物化校验（rev2 RD8/Medium 出口 1：scratch 同管线安装 +
 *   双侧 extractYjsSnapshot + productEqual 产物比较，偏离 → throw DOCRT-E201 变体 C /
 *   校验未能运行 → 变体 D；INV-11）。
 *   ①②③ 共享崩溃边界（意外异常 → DOCRT-E200 单 issue）；⓪ 在其外；④⑤⑥ 物理上位于一切
 *   try/catch 之外（INV-5）：observer 抛错 → 原样 loud 传播（AC-6），绝不吞并成伪 ok/伪回滚。
 * - 按快照键迭代（D9）：封闭 map 形快照键查不到声明字段 = 单 issue「拒绝静默丢键」；
 *   undefined 值视同缺席（present 惯例）；Record 形判定 = 单字段 '<key>'（与 extract
 *   同款约定）；键写入一律经 defineProperty（own '__proto__' 键不落原型）。
 * - union 构造试验（D5/§4.4）：递归构造尝试、首个成功成员胜、无软拒概念；全拒 → 单
 *   issue 附声明序首真 issue 摘要（R2-M2，对齐 extract walkUnion「首真 issue」纪律）。
 * - copyJsonDomain（D6/§4.5）：leaf 与 plain 同支；六词同表（bigint / non-finite number /
 *   undefined（数组元素）/ non-plain object / function / symbol + 内嵌 Y 类型载体词）——
 *   INV-9 往返域对称：extract 读侧拒绝的值，写侧同表拒绝；一切容器重建新实例（INV-7
 *   输入引用隔离）；原型守卫（Date/类实例 → 拒绝，禁静默投影 {}）。
 * - ROOT 顶层特化 rootEntries（§4.3）：产物是 entries 而非 detached map（安装目标是
 *   doc.getMap('ROOT') 本身，detached 不可读 P2）；全 map 形联合 ROOT 逐成员试验；
 *   非 map/union 成员 → throw → E200（R2-M1 定谳：手造派生物 loud，无跳过分支）。
 */
import * as Y from 'yjs';
import type { DerivedSchema, StructureNode } from '@nomicore/vfsl';
import { validateLogicalSnapshot } from '@nomicore/vfsl';
import { carrierOf, probeRoot } from './carrier.js';
import { makeRefResolver } from './resolve.js';
import { canonicalXmlOf, parseXmlToFragment } from './xml-parse.js';
import { extractYjsSnapshot } from './extract.js';
import type { ExtractResult } from './extract.js';

/** 物化 issue：与 ValidateIssue 同形（message + path 段数组）。logical 失败时数组元素即
 *  validateLogicalSnapshot 原生 issue（引用透传）；materialization 失败恒单条（fail-fast）。 */
export interface MaterializeIssue {
  message: string;
  path: Array<string | number>; // 段数组：map/object/Record 用 string，Y.Array 用 number；[] 即 ROOT 自身
}

export type MaterializeResult =
  | { ok: true } // 成功不携带额外载荷（exactOptionalPropertyTypes：无多余键）
  | { ok: false; issues: MaterializeIssue[] };

/** 遍历内部两结局（构造侧无软拒概念，D5）。 */
type BuildResult = { kind: 'value'; value: unknown } | { kind: 'issue'; issue: MaterializeIssue };
type EntriesResult = { kind: 'ok'; entries: Array<[string, unknown]> } | { kind: 'issue'; issue: MaterializeIssue };
type Path = Array<string | number>;
type Resolver = (node: StructureNode) => StructureNode;

/**
 * 唯一公共物化入口（ADR-0007）：同步、错误经返回值传递（⓪/④/⑤/⑥ 的异常是唯一例外——
 * D1/RD1/RD7/RD8）。
 *
 * ⚠️ 前置条件（**运行时强制**，rev2 RD7/P1）：本函数在入口**运行时检测**活动 transaction
 * 语境——① 未闭合的外层 doc.transact 内（`doc._transaction` 非空）、② 事务 cleanup/observer
 * 派发期间（`doc._transactionCleanups` 非空）——命中 → throw `DOCRT-E202`，本函数零写入；
 * 检测不到可靠事务状态时（yjs 内部字段缺失/形态异常）fail-closed 同码拒绝。`afterAllTransactions`
 * 回调（队列已重置）为明文放行例外。若被外层事务包裹，本函数事务并入外层，observer 与
 * update 延迟至外层 cleanup 才执行：⑤⑥ 完整性校验将空转通过并返回 ok:true，随后 observer
 * 的 ROOT 删改不受检测——检测面失效（owner P1 假成功链）。
 *
 * 成功语义（ok:true 的完整承诺，PR #84 owner Review 修订轮 R1→R4 定谳 / INV-2 + INV-10 +
 * INV-11）：
 * 1. 全部计划 set 已在单次 Y.transact 提交（ADR-0006 单 update 单元）；
 * 2. 本函数返回时，ROOT 顶层恰为计划键集且逐键值与安装值严格同一（⑤，身份级保守）；
 * 3. **INV-11（管线产物投影等价，rev2 RD8/Medium 出口 1）**：本函数返回时
 *    `extractYjsSnapshot(derived, doc)` 的读回投影与**同一输入经同一物化管线在一次性 doc
 *    （零 observer）上的未修改安装读回投影**语义等价（⑥ 对称重物化：scratch 构造 + 双侧
 *    extract + productEqual 产物比较；检测基准 = **语义等价**——XML 经 canonical 归一化，
 *    非身份同一性）；偏离 → throw DOCRT-E201（变体 C）；scratch 构造/提取/比较异常 → throw
 *    DOCRT-E201（变体 D——不代表已检测到偏离，仅代表校验防线未能运行）。
 *
 * 检测面边界（明文）：⑤ 覆盖 ROOT 顶层（exact-by-construction，身份同一性 `===`，语义等价
 * 的异实例重插亦触发 E201——有意保守，rev1 R-8 锁定）；⑥ 以**语义等价基准**覆盖嵌套子树
 * （语义等价的嵌套重写不触发——保证对象是 logical snapshot 投影而非引用身份）；**检测基准
 * = extract 读回输出（D4：结构树未声明的键不入 extract 投影，亦不入检测面）——observer 向
 * 封闭子树注入未声明键不在 ⑥ 可见范围，由 ADR-0007 observer 纪律治理**。仍不覆盖：返回
 * 时点之后的异步修改（契约时点 = 返回时）、observer 在 ④ 内抛错（F10 原样传播，⑤⑥ 不运行）、
 * 前置条件被破坏时（⓪ 已 loud 拒绝）的全部 observer 反应。observer 抛错时错误原样传播（F10），
 * ⑤⑥ 不运行。
 *
 * XML 面（rev2 RD9/Minor-1）：CDATA / 处理指令 / 注释以逐字 `Y.XmlText` span 承载，是
 * **lexical-token（词法记号）round-trip 的载体特征**——它们作为不透明文本段往返，**不是**
 * 结构化 XML 节点（ADR-0003 终态节点 + 不定义结构映射立场）；公共承诺面仍为 ADR-0007 语义
 * 等价 round-trip，**不承诺字符串逐字相同**。
 */
export function materializeRoot(derived: DerivedSchema, snapshot: unknown, doc: Y.Doc): MaterializeResult {
  assertOutermostTransactionContext(doc); // ⓪ rev2/RD7/P1：函数体第一句、prepare 之前、try/catch 之外
  const ready = prepare(derived, snapshot, doc); // ①②③ + E200 崩溃边界（唯一 try/catch 所在）
  if (ready.kind === 'fail') return { ok: false, issues: ready.issues }; // INV-3/INV-4
  // ④ 单事务安装 —— 本函数体内没有任何 try/catch（INV-5 的结构性保证）：
  // 事务体内只含对已验证载荷的 set 循环（D10：copyJsonDomain 产物 + detached 类型均不可使
  // yjs set 抛错——唯一抛源 = observer/引擎缺陷 → 原样 loud 传播）。
  doc.transact(() => {
    for (const [key, value] of ready.entries) ready.rootMap.set(key, value);
  });
  verifyInstall(ready); // ⑤ 新增（RD1/INV-10）：顶层完整性校验——只读、无副作用、不在任何
  //                     try/catch 内；observer 抛错时（F10）④ 已 loud 传播，⑤ 不运行
  verifySnapshotIntact(derived, snapshot, doc); // ⑥ rev2/RD8/Medium：对称重物化校验（INV-11）
  return { ok: true }; // ok:true 语义 = INV-2 + INV-10 + INV-11
}

// —— ⓪ 活动 transaction 语境 guard（rev2 RD7 / P1）——

/** E202 变体 A（窗口 A：外层 transact 未闭合）。消息逐字定稿（设计 §3.4）。 */
const E202_MSG_A =
  'DOCRT-E202: 在未闭合的外层 doc.transact 内调用 materializeRoot（运行时检测：doc._transaction 非空）——内部事务将并入外层、observer 延迟至外层 cleanup，成功保证与 DOCRT-E201 检测面失效；已在任何写入前拒绝，本函数零写入（doc 状态不因本调用改变）。请将调用移出外层事务回调后重试';
/** E202 变体 B（窗口 B：cleanup/observer 派发中；末句为 wedge 诊断分支——SA2 E3/R-7）。消息逐字定稿（设计 §3.4）。 */
const E202_MSG_B =
  'DOCRT-E202: 在 Yjs 事务 cleanup/observer 派发期间调用 materializeRoot（运行时检测：doc._transactionCleanups 非空）——本函数安装事务的 observer 将延迟派发，成功保证与 DOCRT-E201 检测面失效；已在任何写入前拒绝，本函数零写入（doc 状态不因本调用改变）。请勿在 observer/事务事件回调内调用，移至事务外重试；若调用点确不在任何回调内：该 doc 的事务 cleanup 队列异常残留（此前 update/afterTransactionCleanup 等回调抛异常所致），事务派发机制已损坏——请勿继续复用该 doc 实例';
/** E202 变体 C（窗口 C fall-through：不可判定 → fail-closed）。消息逐字定稿（设计 §3.4）。 */
const E202_MSG_C =
  'DOCRT-E202: 无法确认 doc 的事务状态（yjs 内部字段 _transaction/_transactionCleanups 缺失或形态异常，疑似 yjs 版本漂移或非 genuine Y.Doc）——按活动事务处置，已在任何写入前拒绝，本函数零写入（doc 状态不因本调用改变）。请核对 @nomicore/doc-runtime 声明的 yjs 版本兼容性（^13.6.30）';

/**
 * ⓪ 活动 transaction 语境 guard（rev2 RD7 / P1）。调用契约：materializeRoot 第一句，
 * 任何 try/catch 之外（绝不落入 E200 崩溃边界被收敛成 ok:false）。窗口模型与字段依据见
 * 设计 §3.1/§3.4/§9（yjs@13.6.32 源码 + 实测）。R2/#3 定稿：只读布尔谓词，无 Transaction
 * 形态嗅探；窗口 C 为 fall-through（fail-closed）。触发即 throw DOCRT-E202（三变体逐字
 * 消息），本函数零写入（先于 ①②③④ 一切 doc 触碰）。
 */
function assertOutermostTransactionContext(doc: Y.Doc): void {
  // yjs 类型面公开声明（dist/src/utils/Doc.d.ts:49/53）：
  //   _transaction: Transaction | null          —— null = 无未闭合 transact（嵌套归并，指针不变）
  //   _transactionCleanups: Array<Transaction>   —— cleanup 队列（observer 派发窗口非空；链尾重置 []）
  const tx = doc._transaction;
  const cleanups = doc._transactionCleanups;
  if (tx !== null && tx !== undefined) {
    throw new Error(E202_MSG_A); // 窗口 A：外层 transact 未闭合（truthy 即命中）
  }
  if (Array.isArray(cleanups)) {
    if (cleanups.length > 0) throw new Error(E202_MSG_B); // 窗口 B：cleanup/observer 派发中
    if (tx === null) return; // 干净语境：tx===null 且队列空 —— 唯一放行口
  }
  throw new Error(E202_MSG_C); // 窗口 C（fall-through）：tx undefined / cleanups 非 Array → fail-closed
}

/**
 * ⑤ 事务后顶层完整性校验（RD1，INV-10）。双断言缺一不可（G5 实证：observer 同轮
 * delete 计划键 + insert 额外键可保持 size 相等而同一性破坏——只查 size 会漏报）。
 * 只读；任何偏离 → throw DOCRT-E201（W1 唯一相容形态：不返回 ok:false——事务已提交，
 * 「失败⟹文档不变」只覆盖验证/构造失败域；不补偿修复——「不覆盖、不合并、不 fallback」；
 * 不声称已回滚——message 明示写入已提交、doc 保持 observer 留下的实际状态）。
 */
function verifyInstall(ready: { rootMap: Y.Map<unknown>; entries: Array<[string, unknown]> }): void {
  const { rootMap, entries } = ready;
  if (rootMap.size !== entries.length) {
    // 覆盖向量：delete 计划键（size 减）/ insert 额外键（size 增）/ 组合
    throw new Error(
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
      throw new Error(
        `DOCRT-E201: ROOT 顶层安装完整性偏离：键 "${key}" 的值在事务提交后与安装值不同一——` +
        `疑似 observer 覆写或删除后重插异值；写入已提交，不回滚、不补偿，doc 保持 observer 留下的实际状态`,
      );
    }
  }
}

// —— ⑥ 对称重物化校验（rev2 RD8 / Medium 出口 1 / INV-11；R4/F-R3-1 定稿）——

/** E201 变体 C（检测到偏离——对照管线读回不等）。消息措辞定稿（设计 §4.2）。 */
function e201C(detail: string): Error {
  return new Error(
    `DOCRT-E201: ROOT 逻辑快照安装后语义校验偏离：${detail}——疑似 observer 修改已安装子树` +
    `（与同一输入经同一管线的未修改安装读回不等）；写入已提交，不回滚、不补偿，doc 保持 observer 留下的实际状态`,
  );
}

/** E201 变体 D（校验未能运行，不代表偏离；触发类枚举设计 §4.2 变体 D）。 */
function e201D(detail: string): Error {
  return new Error(
    `DOCRT-E201: ROOT 安装后完整性校验无法完成（${detail}）——写入已提交，不回滚、不补偿；` +
    `此形态不代表已检测到偏离，仅代表校验防线未能运行`,
  );
}

/** ② 顶层 detached 构造（⑥ scratch 与 prepare 共用；rev2 RD8）：D8 解析器 + rootEntries。
 * 环/缺名 throw → prepare 侧收编 E200；⑥ scratch 侧收编 E201 变体 D（触发类④）。 */
function buildTopEntries(derived: DerivedSchema, snapshot: unknown):
  | { kind: 'ok'; entries: Array<[string, unknown]> }
  | { kind: 'issue'; issue: MaterializeIssue } {
  if (derived.structure.kind !== 'root') {
    // 对齐 extract/materialize B8 loud 边界（手造派生物）：prepare 侧 → E200；⑥ scratch 侧
    // → E201 变体 D（触发类④——real 侧已过，理论不可达，防御性收敛）
    throw new Error('derived.structure 非 root（手造派生物）');
  }
  const resolve = makeRefResolver(derived); // D8 共享解析器（环守卫先于 memo 命中）
  const top = rootEntries(derived.structure.node, snapshot, resolve);
  if (top.kind === 'issue') return { kind: 'issue', issue: top.issue };
  return { kind: 'ok', entries: top.entries };
}

type ScratchInstall =
  | { kind: 'ok'; scratchDoc: Y.Doc }
  | { kind: 'fail'; issue: MaterializeIssue };

/** scratch 侧构造：② 同款 build + ④ 同款单事务安装进一次性 new Y.Doc()（零 observer、
 * 零外发事件、事务后即弃——GC 回收，detached doc 零真实 doc 副作用；yjs 类型单 doc 集成
 * 约束 ⇒ 不能复用 real 侧 entries，必须重建）。不得递归调用 materializeRoot（会触发
 * ⓪/⑤/⑥ 自身——设计 R4 回应表移交注意点）。 */
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

/** 产物比较两结局（首个差异诊断：path + 两侧摘要 + 键集/值支区分——设计 §4.2 变体 C）。 */
type ProductComparison =
  | { equal: true }
  | { equal: false; kind: 'value' | 'keyset'; path: Path; real: unknown; scratch: unknown };

/**
 * ⑥ 安装后完整逻辑快照校验（rev2 RD8 / Medium 出口 1；R4/F-R3-1 对称重物化）。
 * 比较基准 = extract(real) ≡ extract(scratch)——scratch 是同一输入经同一物化管线在一次性
 * doc 上的**未修改**安装；两侧构造性对称，仲裁在两侧一致（§4.2/§4.2.1 双向论证）。
 * 写后检测面 → W1 唯一相容形态 throw（E201 变体 C=检测到偏离 / D=校验未能运行）。
 */
function verifySnapshotIntact(derived: DerivedSchema, snapshot: unknown, doc: Y.Doc): void {
  // (1) scratch 侧构造/安装。构造/安装异常（throw 或 issue 返回）→ E201 变体 D（触发类④
  //     ——理论不可达，防御性收敛；对抗 Proxy 双读使第二次 build **发散但不抛**时落在
  //     (3) 的 C 支——R-5，loud 绝不假成功）。
  let scratch: ScratchInstall;
  try {
    scratch = buildScratchInstall(derived, snapshot);
  } catch (err) {
    throw e201D(`scratch 构造异常（触发类④）：${errDetail(err)}`);
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
    throw e201D(`提取异常（触发类④）：${errDetail(err)}`);
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
    throw e201D(`产物比较异常（触发类①/②/③）：${errDetail(err)}`);
  }
  if (!cmp.equal) throw e201C(detailOf(cmp));
}

/**
 * productEqual —— 同管线产物相等判定（R4 新规；替代退役的三值 cmp/无损谓词）。两侧均为
 * extract 产物（纯 JSON 逻辑快照、出自同一确定性管线），比较**可观测产物整体**——投影过滤
 * 语义随 input-vs-product 基准一并退役（R2/R3 掩盖机理结构性不可达：无投影即无「被投影滤掉
 * 的键」）。逐 kind 规则见设计 §4.2 表：map 全键集（undefined 值视同缺席，双侧同规）+ 逐
 * 共有键递归（封闭 map 未声明键按值深度相等兜底——不做声明字段过滤，键集差异本身即偏离）；
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
        // canonical 扫描失败（任一侧）→ throw → ⑥ 变体 D（设计 §4.3/R2/#7：防线未运行
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
      // 成员下都能看见键集与值差（R-8 残余仅涉 string 位 canonical 角色边角，设计 §4.2）。
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

/** 差异 detail（设计 §4.2 变体 C 措辞例：值支 / 键集支）。 */
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

/** 值摘要（设计 R2/#8(b)：截断 120 字符有界）。 */
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

type Prepared =
  | { kind: 'ready'; rootMap: Y.Map<unknown>; entries: Array<[string, unknown]> }
  | { kind: 'fail'; issues: MaterializeIssue[] };

/** ①②③ 共享崩溃边界（D1）：任何意外异常 → DOCRT-E200 单 issue（F9）。 */
function prepare(derived: DerivedSchema, snapshot: unknown, doc: Y.Doc): Prepared {
  try {
    if (derived.structure.kind !== 'root') {
      throw new Error('derived.structure 非 root（手造派生物）'); // 对齐 extract B8 loud 边界
    }
    // ① 逻辑校验（值域宽域）：失败 → 引用零损透传（D2，INV-4；validateLogicalSnapshot
    //    自身不抛错，其 E100/预算截断形态原样返回）
    const logical = validateLogicalSnapshot(derived, snapshot);
    if (!logical.ok) return { kind: 'fail', issues: logical.issues };

    // ② detached 构造（结构域窄域）：任何失败 → 单 issue（INV-3）；产物全是 detached
    //    类型与新克隆（对 doc 零触碰）；与 ⑥ scratch 构造共用 buildTopEntries（rev2 RD8）
    const top = buildTopEntries(derived, snapshot);
    if (top.kind === 'issue') return { kind: 'fail', issues: [top.issue] };

    // ③ ROOT 探针 + 空置判定（D3）：只读触碰 'ROOT'（INV-6）
    const probe = probeRoot(doc);
    if (probe.carrier !== 'Y.Map') {
      return { kind: 'fail', issues: [makeIssue([], `ROOT 载体不是 Y.Map（期望 Y.Map，实际 ${probe.carrier}）——无法安装物化子树`)] };
    }
    if (probe.map.size > 0) {
      return { kind: 'fail', issues: [makeIssue([], `目标 ROOT 非空（现有 ${probe.map.size} 个键）——不覆盖、不合并、不 fallback`)] };
    }
    return { kind: 'ready', rootMap: probe.map, entries: top.entries };
  } catch (err) {
    // 崩溃边界（①②③ 范围）：实现缺陷 / 手造派生物 / 对抗输入（getter/Proxy 抛出）
    const detail = err instanceof Error ? err.message : String(err);
    return { kind: 'fail', issues: [{ message: `DOCRT-E200: materialize 内部错误（意外异常）: ${detail}`, path: [] }] };
  }
}

/**
 * ROOT 顶层特化（§4.3）：产物是 entries 而非 detached map——安装目标是 doc.getMap('ROOT')
 * 本身（ADR-0003），不能把 detached map「换上去」；detached 不可读（P2），entries 必须
 * 构造期随身携带，④ 直接消费。全 map 形联合 ROOT 逐成员试验（声明序，首个成功胜）。
 * 非 map/union 成员 → throw → E200（R2-M1 定谳：ADR-0003「ROOT 必须 map 形」是派生物
 * 合法性约束，非 map 形成员只可能来自手造派生物——loud 收编，无跳过分支）。
 */
function rootEntries(node: StructureNode, snap: unknown, resolve: Resolver): EntriesResult {
  const n = resolve(node); // root 内层（恒非 ref；手造 ref 链在此收敛，环/缺名 → E200）
  if (n.kind === 'map') return mapEntries(n, snap, [], resolve);
  if (n.kind === 'union') {
    let firstIssue: MaterializeIssue | undefined; // 声明序首真 issue（R2-M2）
    for (const member of n.members) { // 成员声明序（INV-8）；成员只允许 map/union 形——
      // 非 map/union 成员落入函数末尾 throw → E200（R2-M1 定谳：不跳过）
      const r = rootEntries(member, snap, resolve);
      if (r.kind === 'ok') return r; // 首个成功成员胜（实证 T12：两种成员形状各自成功）
      if (firstIssue === undefined) firstIssue = r.issue;
    }
    return issue([], `联合 ROOT 无可构造成员（全 map 形联合的 ${n.members.length} 个成员均拒；首个失败：${firstIssue!.message}）`);
  }
  throw new Error('ROOT 结构节点非 map 形（手造派生物）'); // ADR-0003「ROOT 必须 map 形」→ E200
}

/**
 * 节点构造遍历（§4.3 全景表唯一分发点）：八 kinds 与 extract 对称。
 * map/array/xml-fragment 位有形状断言（D4）；leaf/plain 同支走 copyJsonDomain（D6）；
 * union 递归试验；ref 经共享解析器（D8）。
 */
function buildValue(node: StructureNode, v: unknown, path: Path, resolve: Resolver): BuildResult {
  switch (node.kind) {
    case 'root':
      return buildValue(node.node, v, path, resolve); // 嵌套 root = 手造 → E200 路径同 extract 透传语义
    case 'ref':
      return buildValue(resolve(node), v, path, resolve); // 环/缺名 → throw → E200
    case 'map': {
      const r = mapEntries(node, v, path, resolve);
      if (r.kind === 'issue') return r;
      const ymap = new Y.Map<unknown>();
      for (const [key, value] of r.entries) ymap.set(key, value);
      return { kind: 'value', value: ymap };
    }
    case 'array': {
      if (!Array.isArray(v)) return shapeIssue(path, '数组', v);
      const items: unknown[] = [];
      for (let i = 0; i < v.length; i++) {
        const r = buildValue(node.element, v[i], [...path, i], resolve); // i = number 段
        if (r.kind === 'issue') return r;
        items.push(r.value);
      }
      const yarr = new Y.Array<unknown>();
      yarr.insert(0, items); // 一次 insert 整装（P1）
      return { kind: 'value', value: yarr };
    }
    case 'xml-fragment': {
      if (typeof v !== 'string') return shapeIssue(path, 'XML 字符串', v);
      const parsed = parseXmlToFragment(v);
      if (!parsed.ok) return issue(path, `XML 解析失败（${renderPath(path)}）：${parsed.reason}`); // F8
      return { kind: 'value', value: parsed.fragment };
    }
    case 'leaf':
    case 'plain':
      return copyJsonDomain(v, path, ''); // 同支（D6：yjs 存储层同载体，往返域对称）
    case 'union':
      return buildUnion(node, v, path, resolve);
  }
}

/**
 * union 构造试验（D5/§4.4）：试验 = 完整递归构造尝试，首个成功成员胜（any-of + 声明序，
 * INV-8）；失败产物是可丢弃的 detached 垃圾（未集成任何 doc，GC 回收，INV-1 不受影响）。
 * 无软拒概念——必填性是值域概念归 ① 校验；试验只有二值结局。全拒 → 单 issue 附声明序
 * 首真 issue 摘要（R2-M2，对齐 extract walkUnion「首真 issue」纪律）。判别式零读取（死数据）。
 */
function buildUnion(node: Extract<StructureNode, { kind: 'union' }>, v: unknown, path: Path, resolve: Resolver): BuildResult {
  let firstIssue: MaterializeIssue | undefined;
  for (const member of node.members) { // 成员声明序（INV-8）
    const r = buildValue(resolve(member), v, path, resolve);
    if (r.kind === 'value') return r; // 首个构造成功者胜
    if (firstIssue === undefined) firstIssue = r.issue; // 丢弃的是其余成员的细节，首成员细节保留
  }
  return issue(path, `联合节点无可构造成员（${renderPath(path)}）：${node.members.length} 个成员的结构形状均不符（首个失败：${firstIssue!.message}）`); // F6
}

/**
 * map 节点键值收集（D9 核心）：按快照键迭代（Object.keys 枚举序，INV-8）——写侧若按声明
 * 字段迭代，快照中「声明外的键」会被静默丢弃（数据丢失伪降级）；封闭形快照键查不到声明
 * 字段 = 单 issue（F7，诚实快照不可达——可达向量 = 对抗 Proxy 双读发散 / 手造派生物）。
 * Record 形（单字段 '<key>'）：一切键都是动态键。undefined 值视同缺席（present 惯例）。
 */
function mapEntries(node: Extract<StructureNode, { kind: 'map' }>, snap: unknown, path: Path, resolve: Resolver): EntriesResult {
  const obj = plainObjectOf(snap); // D4 原型守卫：typeof object && 非 null && 非数组 && 原型为 Object.prototype/null
  if (obj === null) return shapeIssue(path, 'map 形普通对象', snap);
  const slot = recordSlotOf(node); // Record 形判定：fields 恰一且 name === '<key>'（与 extract.ts:100 同款约定）
  const entries: Array<[string, unknown]> = [];
  for (const key of Object.keys(obj)) { // 快照键枚举序（INV-8；与 validate §9.2 同一 JS 语义）
    const v = obj[key]; // own 数据属性遮蔽原型 accessor（实证 T10：own '__proto__' 键可经此读到）
    if (v === undefined) continue; // present 惯例：undefined 视同缺席（validate L158 同款）
    const childNode = slot !== undefined ? slot : declaredFieldOf(node, key);
    if (childNode === undefined) {
      return issue([...path, key], `快照含结构树未声明字段 "${key}"——拒绝静默丢键`); // F7
    }
    const r = buildValue(childNode, v, [...path, key], resolve);
    if (r.kind === 'issue') return { kind: 'issue', issue: r.issue };
    entries.push([key, r.value]);
  }
  return { kind: 'ok', entries };
}

/**
 * JSON 域深拷贝（D6/§4.5，extract copyPlainValue 的输入向孪生）：六词同表（INV-9 落文）
 * bigint / non-finite number / undefined（数组元素）/ non-plain object / function / symbol
 * （+ 内嵌 Y 类型用载体词）——与 extract.ts:261-308 逐词对齐；全部可达（unknown 位实证：
 * Y.Map 实例 / bigint / function / NaN / Date / 数组内 undefined 均通过 ①）。一切容器
 * （数组/对象）重建新实例（INV-7：yjs set 按引用存储，A19——不拷贝即共享）。
 */
function copyJsonDomain(v: unknown, path: Path, loc: string): BuildResult {
  if (typeof v === 'number') { // number 拆支（对齐 extract R2.3）
    if (!Number.isFinite(v)) return domainIssue(path, loc, 'non-finite number'); // NaN/±Infinity 可达（§2.2）
    return { kind: 'value', value: v }; // 有限 number 直通
  }
  if (v === null || typeof v === 'string' || typeof v === 'boolean') {
    return { kind: 'value', value: v }; // JSON 标量直通（标量不可变，无引用隔离问题）
  }
  const c = carrierOf(v); // carrier.ts 粗判复用
  if (c !== null && c !== 'plain value') {
    return domainIssue(path, loc, c); // 内嵌 Y 类型：跨 doc 集成 live 引用会移动/劫持源类型，必须拒绝
  }
  if (typeof v === 'bigint') return domainIssue(path, loc, 'bigint');
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (let i = 0; i < v.length; i++) {
      const el = v[i];
      if (el === undefined) return domainIssue(path, `${loc}[${i}]`, 'undefined');
      const r = copyJsonDomain(el, path, `${loc}[${i}]`);
      if (r.kind === 'issue') return r;
      out.push(r.value); // 新数组——INV-7 引用隔离
    }
    return { kind: 'value', value: out };
  }
  if (typeof v === 'object') { // 走到此处必非 Y 家族（粗判已滤）
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) {
      // 原型守卫（对齐 extract R2/#3 判例）：Date/RegExp/Map/Set/类实例 → 拒绝，禁静默投影 {}
      const ctorName = (proto as { constructor?: { name?: string } }).constructor?.name ?? 'unknown';
      return domainIssue(path, loc, 'non-plain object', `constructor: ${ctorName}`);
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) {
      const val = (v as Record<string, unknown>)[k];
      if (val === undefined) continue; // present 惯例（与 mapEntries/validate 三方一致）
      const r = copyJsonDomain(val, path, `${loc}.${k}`);
      if (r.kind === 'issue') return r;
      // defineProperty 安全写入（对齐 extract putSnapshotKey/D13：own '__proto__' 键
      // 不落原型、不触发原型 setter）
      Object.defineProperty(out, k, { value: r.value, writable: true, enumerable: true, configurable: true });
    }
    return { kind: 'value', value: out };
  }
  // undefined（数组元素位已拦截；防 buildValue 直入防御）与 function/symbol 尾支
  if (v === undefined) return domainIssue(path, loc, 'undefined');
  return domainIssue(path, loc, typeof v === 'function' ? 'function' : 'symbol');
}

// —— 形状/域断言与 issue 构造（单点定义，SA3 防走样）——

/** D4 原型守卫：map 形普通对象（typeof object && 非 null && 非数组 && 原型为 Object.prototype 或 null）。 */
function plainObjectOf(v: unknown): Record<string, unknown> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return null;
  return v as Record<string, unknown>;
}

/** Record 形判定：fields 恰一且 name === '<key>'（与 extract.ts:100 同款约定，两侧逐字相同）。 */
function recordSlotOf(node: Extract<StructureNode, { kind: 'map' }>): StructureNode | undefined {
  const first = node.fields[0];
  if (node.fields.length === 1 && first !== undefined && first.name === '<key>') return first.node;
  return undefined;
}

/** 封闭 map 形：查声明字段（字段声明序）。 */
function declaredFieldOf(node: Extract<StructureNode, { kind: 'map' }>, key: string): StructureNode | undefined {
  for (const f of node.fields) {
    if (f.name === key) return f.node;
  }
  return undefined;
}

/** issue 构造器（统一出口）：shapeIssue / domainIssue / makeIssue 全部收敛到此。 */
function issue(path: Path, message: string): { kind: 'issue'; issue: MaterializeIssue } {
  return { kind: 'issue', issue: makeIssue(path, message) };
}

function makeIssue(path: Path, message: string): MaterializeIssue {
  return { message, path };
}

/** 形状词（D4）：null / array / object / string / number / boolean / bigint / function /
 *  symbol；object 子类附（constructor: Date）式申报（对齐 extract D9② 申报词纪律）。
 *  词只进 message 文本，不进结构化字段。 */
function wordOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) {
      const ctorName = (proto as { constructor?: { name?: string } }).constructor?.name ?? 'unknown';
      return `object（constructor: ${ctorName}）`;
    }
    return 'object';
  }
  return typeof v; // string / number / boolean / bigint / function / symbol / undefined
}

/** F4 形状错位 issue（恒 issue 变体——可同时赋给 BuildResult 与 EntriesResult）。 */
function shapeIssue(path: Path, expected: string, v: unknown): { kind: 'issue'; issue: MaterializeIssue } {
  return issue(path, `快照形状错位（${renderPath(path)}）：期望 ${expected}，实际 ${wordOf(v)}`);
}

/** F5 纯值域违规 issue（六词同表；位置线进 message，path 锚定声明节点位——与 extract 同纪律）。 */
function domainIssue(path: Path, loc: string, word: string, extra?: string): { kind: 'issue'; issue: MaterializeIssue } {
  const at = loc === '' ? '' : `，内部位置 ${loc}`;
  const extraPart = extra === undefined ? '' : `（${extra}）`;
  return issue(path, `纯值域违规（${renderPath(path)}${at}）：期望 plain value（JSON 值域），实际 ${word}${extraPart}`);
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
