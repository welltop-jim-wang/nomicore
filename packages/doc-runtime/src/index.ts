/**
 * @nomicore/doc-runtime —— Yjs 桥接包公共入口（ADR-0007，issue #73 / #74 / #75 / #87）。
 *
 * 公共接缝：
 * - `extractYjsSnapshot(derived, doc)` → `{ ok: true; snapshot } | { ok: false; issues }`
 *   ——只读固定 ROOT，严格区分 Y.Map/Y.Array/Y.XmlFragment/plain 载体，fail-fast 单
 *   issue（path/expected/actual 精确锚定首个错位节点），成功返回普通 logical ROOT
 *   snapshot（纯 JSON、与 live doc 解耦）；同步、不抛错。
 * - `readLogicalValueAtPath(derived, doc, path)` → `{ ok: true; value } | { ok: false;
 *   code:'PATH_NOT_ALLOWED'; path }`（issue #75 / ADR-0007）——同步按路径读取目标子树
 *   逻辑值：只转换目标子树（不重复全树验证）；合法 optional/Record 缺键与非负整数数组
 *   越界 → ok:true, value:undefined；schema 不允许的路径 → PATH_NOT_ALLOWED + 整条尝试
 *   路径回显；同步、不抛错（失败一律经返回值传递，含崩溃边界 DOCRT-E100 message）。
 * - `materializeRoot(derived, snapshot, doc)` → `{ ok: true } | { ok: false; issues }`
 *   ——extract 的方向反转孪生（issue #74，rev2 修订）：**运行时强制**活动 transaction 语境
 *   （外层 transact 未闭合 / cleanup·observer 派发中 / 状态不可判定 fail-closed）→ throw
 *   `DOCRT-E202`、本函数零写入；先 validateLogicalSnapshot（逻辑失败保留完整 issues 引用
 *   透传），再构造 detached Yjs 子树，确认 ROOT 空置后单次 Y.transact 安装；验证/构造失败
 *   doc 零写入；不覆盖、不合并、不 fallback；事务调用栈异常逃逸包装为 branded
 *   `DocRuntimeFatalError`（committed:true，phase `observer-cleanup-throw`，cause/message
 *   原样携带原始异常，绝不吞并成伪 ok/伪回滚形态、不虚假声称回滚）。成功语义 = INV-2 + INV-10 + INV-11（返回时 extract 读回与同一输入
 *   经同一管线在一次性 doc 上的未修改安装读回投影**语义等价**——XML 经 canonical 归一化；
 *   CDATA/PI/注释为 lexical-token 逐字 span 载体，不承诺字符串逐字相同）；偏离 → throw
 *   `DOCRT-E201`（变体 C）/ 校验未能运行 → 变体 D（**branded 交付**，committed:true，
 *   phase `post-commit-verification`）；同步、错误经返回值传递。
 * - `DocRuntimeFatalError` + `DocRuntimeFatalPhase`（issue #87 / ADR-0008 演进条目 2）——
 *   committed-aware branded fatal 事实契约：`committed: boolean`（诚实提交事实）+
 *   稳定 `phase: string`（三相：`observer-cleanup-throw` / `post-commit-verification` /
 *   `pre-commit-internal`，v1 冻结只增不改）。只携带事实（W4）：不调用 notifyDirty、
 *   不关闭写能力、不执行任何 Runtime 层动作；本包公共面**不导出** Runtime 层
 *   `RuntimeWriteFatalError`（两层命名互不侵占）。内部构件（`DerivedInvariantError` /
 *   `transactGuarded`）为包内接缝，不经本入口导出。
 * - `applyValidatedMutation(derived, doc, mutation)` → `{ ok: true } | { ok: false; issues }`
 *   （issue #87 最小落地，O1）——ADR-0007/PRD §6 冻结管线骨架 + 仅 `set` 操作（含
 *   `set([])` 整体替换）：⓪ 活动 transaction 语境拒绝（throw `DOCRT-E202`，零写入）→
 *   信封校验（闭环 {op,path,value} / op==='set' / path 段 string|number / value 非
 *   undefined，逐项领域单 issue 响亮拒绝）→ 当前 ROOT 载体+逻辑校验（损坏/错位 →
 *   ok:false + issues，不承担 recovery）→ concrete-JSON 放置（own-key 纪律：
 *   defineProperty 终段 + hasOwn 导航）→ 完整逻辑校验 → detached 构造 → 写前响亮预检
 *   （live 顶层键集 ⊄ 重建键集 → 领域单 issue 拒绝静默丢键）→ 单次 Yjs transaction
 *   （clear+重建；observer 逃逸 → branded E203 committed:true）→ ⑤ 复用校验（偏离 →
 *   branded E201 committed:true）。领域失败（含 hostile value 意外异常 → E205 单 issue）
 *   一律 ok:false + issues 联合，不进 fatal 通道；delete/array-insert/array-delete 属
 *   validated mutation 独立任务面（本切片单 issue 响亮拒绝）。
 */
export { extractYjsSnapshot } from './extract.js';
export type { ExtractIssue, ExtractResult } from './extract.js';
export { readLogicalValueAtPath } from './read.js';
export type { ReadLogicalValueResult } from './read.js';
export { materializeRoot } from './materialize.js';
export type { MaterializeIssue, MaterializeResult } from './materialize.js';
export { DocRuntimeFatalError } from './fatal.js';
export type { DocRuntimeFatalPhase } from './fatal.js';
export { applyValidatedMutation } from './mutation.js';
export type { MutationIssue, ApplyValidatedMutationResult } from './mutation.js';
