/**
 * @nomicore/doc-runtime —— Yjs 桥接包公共入口（ADR-0007，issue #73 / #74 / #75）。
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
 *   doc 零写入；不覆盖、不合并、不 fallback；事务内 observer 抛错 loud 原样传播（不虚假声称
 *   回滚）。成功语义 = INV-2 + INV-10 + INV-11（返回时 extract 读回与同一输入经同一管线在
 *   一次性 doc 上的未修改安装读回投影**语义等价**——XML 经 canonical 归一化；CDATA/PI/注释
 *   为 lexical-token 逐字 span 载体，不承诺字符串逐字相同）；偏离 → throw `DOCRT-E201`
 *   （变体 C）/ 校验未能运行 → 变体 D；同步、错误经返回值传递。
 */
export { extractYjsSnapshot } from './extract.js';
export type { ExtractIssue, ExtractResult } from './extract.js';
export { readLogicalValueAtPath } from './read.js';
export type { ReadLogicalValueResult } from './read.js';
export { materializeRoot } from './materialize.js';
export type { MaterializeIssue, MaterializeResult } from './materialize.js';
