# 任务简报 — Phase 5: generate namespaceId and migrate Registry identity

- **Issue**: #131 (welltop-jim-wang/nomicore)
- **Task Type**: 功能开发 (feature)
- **Branch**: fix/issue-131-on-docs-phase-5-websocket-replication
- **Worktree**: /home/wangjian/nomicore-fix-issue-131
- **run_id**: issue-131-1787792522-3529662
- **round**: 1

## Parent

PR #130（docs/phase-5-websocket-replication）— 当前 branch 已基于该分支最新提交。

## What to build

Make namespaceId the sole in-process Registry entry identity while preserving owner as a required local create/open property and Persistence partition. Ordinary namespace creation generates a probability-globally-unique ID from an injected random source instead of accepting a caller-supplied ID.

## Acceptance criteria

- [ ] AC-1: Ordinary create generates a `ns-`+32 lowercase hex ID from an injected 128-bit CSPRNG and does not accept a caller-selected namespaceId.
- [ ] AC-2: A collision with an active/idle/closing Registry entry or target-owner Persistence duplicate regenerates and retries at most eight times; exhaustion raises a committed:false Registry fatal.
- [ ] AC-3: Registry lifecycle serialization and Runtime reuse are keyed only by namespaceId.
- [ ] AC-4: Open/create still validate and project owner; an owner mismatch returns the existing not-found result without exposing another owner's namespace.
- [ ] AC-5: Persistence continues storing by owner partition and does not add a cross-owner namespace catalog.
- [ ] AC-6: Memory/File/Registry contract tests cover generation, retry exhaustion, owner mismatch, concurrency, shutdown, and public-surface compatibility.
- [ ] AC-7: ADR 0006/0009 implementation-facing docs and package contracts are aligned with ADR 0010 vocabulary.

## 设计基准（相关文档）

- `docs/phases/phase-5-websocket-replication.md` §实施切片 1：Namespace identity、复制身份与受控随机源
- ADR 0006：Persistence、DocHandle、owner 分区
- ADR 0009：NamespaceRegistry、NamespaceLease、Runtime generation 与 Host 生命周期
- ADR 0010：namespace identity、复制谱系词汇
- `CONTEXT.md`：namespaceId、owner 等词汇

## Blocked by

None (can start immediately).

## SA6 红灯锚定（第一阶段产出，2026-08-27）

- 验收测试文件：
  - `packages/namespace-registry/test/registry-phase5-identity-red.test.ts`（15 条运行时行为用例，AC-1..AC-6）
  - `packages/namespace-registry/test/registry-phase5-identity-surface.test-d.ts`（5 条类型面契约，AC-1/AC-6/AC-7）
- 红灯锚定记录全文：`wiki/raw/task_phase5-namespaceid-registry-identity_sa6_red.md`
  （含 AC→用例映射、基线失败签名与运行证据）。
- 实测：基线 all-green；锚定后运行时 15/15 红、类型 3 红 + 2 保持性守卫绿；
  既有测试（含 registry-surface.test.ts 的 9/2 export 冻结面）全部保持绿。
- 契约要点：三键 create 输入 {owner,schema,root}；注入 `randomBytes(length): Uint8Array`
  （缺失 → 构造期 TypeError）；`ns-`+32 小写 hex；碰撞重试至多 8 次、耗尽
  committed:false fatal（新 phase 不在 ADR 0009 初始三 phase 内）；entry 仅按
  namespaceId 索引，owner mismatch → NOT_FOUND 零暴露；Persistence 继续按 owner 分区。
