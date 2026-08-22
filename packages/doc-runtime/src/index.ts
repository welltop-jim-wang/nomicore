/**
 * @nomicore/doc-runtime —— Yjs 桥接包公共入口（ADR-0007，issue #73）。
 *
 * 公共接缝：
 * - `extractYjsSnapshot(derived, doc)` → `{ ok: true; snapshot } | { ok: false; issues }`
 *   ——只读固定 ROOT，严格区分 Y.Map/Y.Array/Y.XmlFragment/plain 载体，fail-fast 单
 *   issue（path/expected/actual 精确锚定首个错位节点），成功返回普通 logical ROOT
 *   snapshot（纯 JSON、与 live doc 解耦）；同步、不抛错。
 */
export { extractYjsSnapshot } from './extract.js';
export type { ExtractIssue, ExtractResult } from './extract.js';
