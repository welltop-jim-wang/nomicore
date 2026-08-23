/**
 * @nomicore/doc-runtime — ⓪ 活动 transaction 语境 guard 收敛 seam（issue #88 设计 §3.1 / D7）。
 *
 * 自 materialize.ts 纯移动（issue #88 设计 §3.1，resolve.ts 先例纪律）：谓词逐字不变
 * （rev2 RD7/P1 定稿——三窗口模型），唯一变化 = A/B 消息 `api` 插值（D7）：现行 A/B
 * 消息中 API 名只出现于前导短语「内调用 materializeRoot（运行时检测…」，以 `${api}`
 * 替换该 token，`api='materializeRoot'` 时渲染结果与原逐字定稿**逐字节相同**——既有
 * 测试文本锚（`doc._transaction 非空` / `派发期间` / `队列异常残留` / `无法确认` /
 * `版本兼容性`）全部保留；`replaceRootContent` 侧同模板渲染自有 API 名——异常归因诚实。
 *
 * 调用契约：公共写入口（materializeRoot / replaceRootContent）函数体第一句、任何
 * try/catch 之外（绝不落入 E200 崩溃边界被收敛成 ok:false）。窗口模型与字段依据见
 * rev2 设计 §3.1/§3.4/§9（yjs@13.6.32 源码 + 实测）。R2/#3 定稿：只读布尔谓词，无
 * Transaction 形态嗅探；窗口 C 为 fall-through（fail-closed）。触发即 throw
 * DOCRT-E202（三变体逐字消息），本函数零写入（先于 ①②③④ 一切 doc 触碰）。
 */
import * as Y from 'yjs';

/** E202 变体 A（窗口 A：外层 transact 未闭合）。消息逐字定稿（rev2 设计 §3.4），
 * 唯一变化 = API 名 `api` 插值（D7）。 */
const E202_MSG_A = (api: string) =>
  'DOCRT-E202: 在未闭合的外层 doc.transact 内调用 ' + api +
  '（运行时检测：doc._transaction 非空）——内部事务将并入外层、observer 延迟至外层 ' +
  'cleanup，成功保证与 DOCRT-E201 检测面失效；已在任何写入前拒绝，本函数零写入（doc ' +
  '状态不因本调用改变）。请将调用移出外层事务回调后重试';
/** E202 变体 B（窗口 B：cleanup/observer 派发中；末句为 wedge 诊断分支——SA2 E3/R-7）。
 * 消息逐字定稿（rev2 设计 §3.4），唯一变化 = API 名 `api` 插值（D7）。 */
const E202_MSG_B = (api: string) =>
  'DOCRT-E202: 在 Yjs 事务 cleanup/observer 派发期间调用 ' + api +
  '（运行时检测：doc._transactionCleanups 非空）——本函数安装事务的 observer 将延迟' +
  '派发，成功保证与 DOCRT-E201 检测面失效；已在任何写入前拒绝，本函数零写入（doc 状态' +
  '不因本调用改变）。请勿在 observer/事务事件回调内调用，移至事务外重试；若调用点确不在' +
  '任何回调内：该 doc 的事务 cleanup 队列异常残留（此前 update/afterTransactionCleanup ' +
  '等回调抛异常所致），事务派发机制已损坏——请勿继续复用该 doc 实例';
/** E202 变体 C（窗口 C fall-through：不可判定 → fail-closed）。消息逐字定稿（rev2 设计
 * §3.4）；C 变体不含 API 名 → 共享常量，原文逐字不变。 */
const E202_MSG_C =
  'DOCRT-E202: 无法确认 doc 的事务状态（yjs 内部字段 _transaction/_transactionCleanups ' +
  '缺失或形态异常，疑似 yjs 版本漂移或非 genuine Y.Doc）——按活动事务处置，已在任何写入' +
  '前拒绝，本函数零写入（doc 状态不因本调用改变）。请核对 @nomicore/doc-runtime 声明的 ' +
  'yjs 版本兼容性（^13.6.30）';

/** ⓪ 活动 transaction 语境 guard（rev2 RD7 / P1）。三窗口谓词逐字保持：窗口 A
 * `doc._transaction` truthy throw → 窗口 B `_transactionCleanups` 非空 throw → 干净语境
 * （tx===null 且队列空）唯一放行口 → 窗口 C fall-through fail-closed。`afterAllTransactions`
 * 队列重置例外放行（rev2 §9 PA-1/2/9 定谳，零改动复用）。 */
export function assertOutermostTransactionContext(doc: Y.Doc, api: string): void {
  // yjs 类型面公开声明（dist/src/utils/Doc.d.ts:49/53）：
  //   _transaction: Transaction | null          —— null = 无未闭合 transact（嵌套归并，指针不变）
  //   _transactionCleanups: Array<Transaction>   —— cleanup 队列（observer 派发窗口非空；链尾重置 []）
  const tx = doc._transaction;
  const cleanups = doc._transactionCleanups;
  if (tx !== null && tx !== undefined) {
    throw new Error(E202_MSG_A(api)); // 窗口 A：外层 transact 未闭合（truthy 即命中）
  }
  if (Array.isArray(cleanups)) {
    if (cleanups.length > 0) throw new Error(E202_MSG_B(api)); // 窗口 B：cleanup/observer 派发中
    if (tx === null) return; // 干净语境：tx===null 且队列空 —— 唯一放行口
  }
  throw new Error(E202_MSG_C); // 窗口 C（fall-through）：tx undefined / cleanups 非 Array → fail-closed
}
