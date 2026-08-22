/**
 * @nomicore/doc-runtime —— Yjs 桥接包公共入口（ADR-0007，issue #73 / #75）。
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
 */
export { extractYjsSnapshot } from './extract.js';
export type { ExtractIssue, ExtractResult } from './extract.js';
export { readLogicalValueAtPath } from './read.js';
export type { ReadLogicalValueResult } from './read.js';
