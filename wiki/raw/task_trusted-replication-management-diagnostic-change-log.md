# Task Brief — Issue #151: Record trusted replication and management writes

## Source

- Repository: `welltop-jim-wang/nomicore`
- Issue: #151 — Record trusted replication and management writes
- Parent: PR #142 (`docs/namespace-diagnostic-change-log`)
- Task type: feature

## What to build

Connect trusted replication apply, replication enablement, and replication epoch bump operations to the namespace diagnostic change log. Investigators must distinguish local and replicated effects and inspect controlled direction and identity context, without changing replication identity gates, ACK timing, transport observability, or business write ordering.

## Acceptance criteria

1. Trusted replication apply, replication enable, and replication epoch bump emit their frozen v1 operation and controlled replication source/context.
2. Identity, epoch, capability, validation, transaction, dirty-notification, and committed-aware fatal outcomes retain existing stable phase, code, issues, and committed facts.
3. Committed replication transactions provide detached owned Yjs update bytes for the exact applied effect, with no-op and update-omitted represented explicitly.
4. Logger failure or queue pressure never changes apply results, replication ACKs, identity/epoch state, write-sequencer order, or transport health reporting.
5. Tests cover both replication directions, identity/epoch rejection, committed apply, management writes, fatal paths, and isolation from transport observability.

## SA6 红灯契约（Phase 1，2026-08-31）

- 详见 `task_trusted-replication-management-diagnostic-change-log_sa6_red.md`（15/15 真实红灯，
  `pnpm exec vitest run packages/namespace-runtime/test/runtime-replication-diagnostic-red.test.ts`）。
- 测试文件：`packages/namespace-runtime/test/runtime-replication-diagnostic-red.test.ts`（新增）。
- 需求拆解与测试设计：AC1 三条 operation + 受控 source/context；AC2 identity/epoch/capability/
  validation/transaction/dirty-notification/committed-aware fatal 保留既有稳定 phase/code/issues/
  committed 事实；AC3 committed 复制事务 detached owned Yjs update bytes（基态链式重放 + 真增量
  空 doc 不物化反向鉴别）+ noop 显式；AC4 emitter 违约 throw/队列满零业务影响（结果/槽序/identity
  状态/transport 健康面）；AC5 双方向字面量 + transport 隔离（session open/close/status 零记录）。
- 基线依赖注记：本 worktree 无 Phase 5 复制业务层（SA8 注记 3）——红灯失败形态为操作面
  TypeError（`enableReplication is not a function`）；操作面形状按主线既有字面取
  （enableReplication/bumpReplicationEpoch/lease.openReplicationSession/session.applyRemoteUpdate
  + 既有稳定拒绝码），SA1 设计须声明依赖落点。
