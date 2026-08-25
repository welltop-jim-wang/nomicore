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
 *
 * 收敛登记（issue #88 设计 §3 / 本节为按资产性质切面的薄编排）：
 * - ⓪ guard → `tx-guard.ts`（assertOutermostTransactionContext(doc, api)，A/B 消息
 *   `${api}` 插值——api='materializeRoot' 渲染与 rev2 §3.4 逐字定稿字节相同，D7）；
 * - ② detached 构造全量（builder + 形状/域/issue 辅助 + 内部遍历类型）→
 *   `detached-build.ts`（纯移动逐字不变；`@internal` 共享辅助/类型面见该文件头，含
 *   `makeIssue`——留守 prepare 载体/非空 ROOT issue 两处的构造依赖，R3/SA2 R2-A1）；
 * - ⑤⑥ 写后校验全量 → `install-verify.ts`（纯移动逐字不变，verifyInstall /
 *   verifySnapshotIntact；E201 文案 generic 不点名，两入口天然两用，D8/§4.4）。
 * 公共契约零变化：签名、返回类型、E202/E201/E200 消息、行为逐位不变（回归面 = 既有用例全绿）。
 */
import * as Y from 'yjs';
import type { DerivedSchema } from '@nomicore/vfsl';
import { validateLogicalSnapshot } from '@nomicore/vfsl';
import { probeRoot } from './carrier.js';
import { assertOutermostTransactionContext } from './tx-guard.js';
import { buildTopEntries, makeIssue } from './detached-build.js';
import { verifyInstall, verifySnapshotIntact } from './install-verify.js';
import { DerivedInvariantError, DocRuntimeFatalError, transactGuarded } from './fatal.js';

/** 物化 issue：与 ValidateIssue 同形（message + path 段数组）。logical 失败时数组元素即
 *  validateLogicalSnapshot 原生 issue（引用透传）；materialization 失败恒单条（fail-fast）。 */
export interface MaterializeIssue {
  message: string;
  path: Array<string | number>; // 段数组：map/object/Record 用 string，Y.Array 用 number；[] 即 ROOT 自身
}

export type MaterializeResult =
  | { ok: true } // 成功不携带额外载荷（exactOptionalPropertyTypes：无多余键）
  | { ok: false; issues: MaterializeIssue[] };

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
  assertOutermostTransactionContext(doc, 'materializeRoot'); // ⓪ rev2/RD7/P1：函数体第一句、prepare 之前、try/catch 之外
  const ready = prepare(derived, snapshot, doc); // ①②③ + E200 崩溃边界（唯一 try/catch 所在）
  if (ready.kind === 'fail') return { ok: false, issues: ready.issues }; // INV-3/INV-4
  // ④ 单事务安装 —— 本函数体内没有任何 try/catch（INV-5 的结构性保证）：
  // 事务体内只含对已验证载荷的 set 循环（D10：copyJsonDomain 产物 + detached 类型均不可使
  // yjs set 抛错——唯一抛源 = observer/引擎缺陷 → 原样 loud 传播）。
  transactGuarded(doc, () => {
    for (const [key, value] of ready.entries) ready.rootMap.set(key, value);
  });
  verifyInstall(ready); // ⑤ 新增（RD1/INV-10）：顶层完整性校验——只读、无副作用、不在任何
  //                     try/catch 内；observer 抛错时（F10）④ 已 loud 传播，⑤ 不运行
  verifySnapshotIntact(derived, snapshot, doc); // ⑥ rev2/RD8/Medium：对称重物化校验（INV-11）
  return { ok: true }; // ok:true 语义 = INV-2 + INV-10 + INV-11
}

type Prepared =
  | { kind: 'ready'; rootMap: Y.Map<unknown>; entries: Array<[string, unknown]> }
  | { kind: 'fail'; issues: MaterializeIssue[] };

/** ①②③ 共享崩溃边界（D1）：任何意外异常 → DOCRT-E200 单 issue（F9）。 */
function prepare(derived: DerivedSchema, snapshot: unknown, doc: Y.Doc): Prepared {
  try {
    if (derived.structure.kind !== 'root') {
      throw new DerivedInvariantError('derived.structure 非 root（手造派生物）');
    }
    // ① 逻辑校验（值域宽域）：失败 → 引用零损透传（D2，INV-4；validateLogicalSnapshot
    //    自身不抛错，其 E100/预算截断形态原样返回）
    const logical = validateLogicalSnapshot(derived, snapshot);
    if (!logical.ok) return { kind: 'fail', issues: logical.issues };

    // ② detached 构造（结构域窄域）：任何失败 → 单 issue（INV-3）；产物全是 detached
    //    类型与新克隆（对 doc 零触碰）；与 ⑥ scratch 构造共用 buildTopEntries（rev2 RD8；
    //    issue #88 收敛后自 detached-build.js 共享 seam 引入）
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
    if (err instanceof DerivedInvariantError) {
      throw new DocRuntimeFatalError(
        'pre-commit-internal',
        false,
        `DOCRT-E204: 写前 internal 不变量破坏（${err.message}）——合规调用者不可达` +
          `（派生物仅可由 evaluate 产出，此处为 internal 缺陷类）；本调用零写入` +
          `（doc 状态不因本调用改变）；不补偿、不 fallback`,
        { cause: err },
      );
    }
    // 对抗输入与资源极限仍留在领域结果联合。
    const detail = err instanceof Error ? err.message : String(err);
    return { kind: 'fail', issues: [{ message: `DOCRT-E200: materialize 内部错误（意外异常）: ${detail}`, path: [] }] };
  }
}
