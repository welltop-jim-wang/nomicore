# Task Brief — issue #108 persistence：typed load/create 错误与 committed-aware create fatal

- run_id: issue-108-1787670535-603033
- worktree: /home/wangjian/nomicore-fix-issue-108
- branch: fix/issue-108-on-docs-namespace-registry
- base: docs/namespace-registry（PR #105，stacked）
- slug: persistence-typed-errors
- 任务类型: feature（issue label: feature）
- 阻塞依赖: #107（已 closed，#117 合入本分支基线）

## Issue 原文（What to build）

为 Persistence load/create 冻结可供 NamespaceRegistry 诚实映射的 typed operational error 与 committed-aware create fatal，使上层无需根据裸异常文本猜测运营失败、Adapter bug 或文档是否已经提交。

## Acceptance criteria（验收锚）

- AC1 提供稳定 typed load operational error，保留原始 cause 且稳定 message 不拼接 cause
- AC2 提供稳定 typed create operational error，并明确 `committed:false`
- AC3 提供 committed-aware create fatal，至少携带稳定 phase、`committed` 与原始 cause
- AC4 duplicate 保持独立稳定类型，不与 operational/fatal 混合
- AC5 FilePersistence 的 create 提交点与可能 post-commit failure 分类准确，不虚假声称 rollback
- AC6 unknown Adapter/internal exception 不被降级为 operational error
- AC7 Memory/File 两 Adapter 通过同一组 load/create 错误契约、exact cause 与敏感文本负锁测试
- AC8 通过全量 typecheck/test 与 Node 20/24 CI

## 设计上下文（ADR-0009 §Persistence 错误演进，docs/adr/0009 L72–L83）

- typed load operational error；
- typed create operational error，明确 `committed:false`；
- committed-aware create fatal，携带稳定 phase、committed 与原始 cause；
- duplicate 继续使用稳定 duplicate 类型（DocDuplicateError / DOC_DUPLICATE，ADR-0006）；
- 稳定 message 不拼接 cause；
- Registry 只把 typed operational error 映射为公开 load/create issue；duplicate 映射 already exists；Persistence fatal 的 committed 事实原样传播；unknown exception 不能伪装为运营失败。

## 现状摸底（总控亲读，供 SA 参考，不构成设计）

- `packages/persistence/src/contract.ts`：现有唯一 typed error = `DocDuplicateError`（code DOC_DUPLICATE 自有可枚举类字段）。
- `packages/persistence/src/lifecycle.ts`：
  - load 路径 `io.read` 拒绝 → `ReadError` 值路由 → `routeOwnedRead` 原样 rethrow（裸异常）；
  - restore/validate 失败（Y 损坏 / META.docId 不匹配）→ 裸 Error；
  - create 路径：claim 段 probe read 拒绝裸传；`Y.encodeStateAsUpdate` → `io.write` → `assertCurrentEpoch` → entry 注册；任何失败 `cells.delete` 后裸 rethrow；
  - **提交点歧义**：Memory `write` 在 signal aborted 时早退 resolve（不执行 mirror set，提交未发生但 write resolved）；File `writeCommittedSnapshot` 以 `rename(tmp→snapshot)` 为提交点、resolve 即已提交。「write resolved ⇒ committed」对两 Adapter 不一致 —— SA1 必须裁决 commit-fact 的诚实来源。
  - create 成功后 dispose 竞态（`assertCurrentEpoch` 抛裸 'createDoc rejected: persistence is disposed'）时文档可能已提交 —— 当前错误不携带 committed 事实。
- `packages/persistence/src/testing.ts`：共享契约套件 `describeDocCreateContract` / `describeDocPersistenceContract`，Memory/File 各跑同一 fixture；现有用例「does not cache, commit, or destroy…」断言 `err.message` 含 `'io down'`（裸异常透传）——与 AC1/AC6「稳定 message 不拼接 cause」冲突，须随新契约同步修订（cause 经 `error.cause` exact identity 保留）。
- `packages/dsh-persistence/src/probe.ts:376` 消费 `DocDuplicateError`；新类型导出须保持 additive，probe record 确定性不受影响。

## 工作流（功能开发路由）

SA8 前置门禁 → SA6 验收锚定（红灯）→ SA1 设计 → SA8 设计复审 → SA2 攻击评审 → SA3 TDD 实现 → SA4 静态 → SA7 动态 → AC 门禁 → 双轴终审 → 收尾

## 测试策略

本仓库无 scripts/test-lock.sh；以 package.json 为准：
- `pnpm typecheck`（八包 tsc）
- `pnpm test`（vitest run --typecheck，全仓）
一律后台独立进程（setsid nohup & disown），exit code 落 `.mabf-bg/*.exit`。

## 环境事实

- Node 版本以仓库 engines >=20 为准；CI Node 20/24 矩阵属外层门禁，本地门槛 = 全量 typecheck/test 绿。
- REPORT.md/.mabf-done 不 commit；wiki/raw/*.md 亦不 commit（本地元数据）。
