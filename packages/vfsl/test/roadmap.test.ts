import { describe, it } from 'vitest';

/**
 * Phase 0 路线图（设计文档 §15）。
 * 每条 todo 是一个 TDD 锚点：fixture 取自设计文档 §4 的 vfs3.assets 示例，
 * 负例取自 §7 的三个拒绝用例。
 */
describe('VFSL Phase 0（POC）', () => {
  it.todo('parseVfsl 解析 §4 的 vfs3.assets fixture（Pattern 键 / 判别联合 / 封闭对象 / YLeaf）');
  it.todo('封闭对象拒绝未知字段：写 /assets/byId/a1/extra → unrecognized-key（§7）');
  it.todo('键约束拒绝 "." 与 "|"：/assets/byId/a.b/name → key-pattern-mismatch（§7）');
  it.todo('判别联合重建校验：kind=scene 时写 portraitResourceId 被拒（§7）');
  it.todo('validateSnapshot 输出结构化 issues，错误信息回带 JSDoc 语义（§12）');
  it.todo('@invariant / @ref 解析失败时 schema 编译被拒，其余未知标签仅 warn（§5）');
  it.todo('未知方言版本 → DocScope 只读，不拖垮同进程其他作用域（§10）');
});
