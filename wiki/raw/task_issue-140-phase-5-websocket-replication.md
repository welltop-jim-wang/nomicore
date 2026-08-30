# Issue #140 — Phase 5: verify three-instance convergence and close integration

- Repository: `welltop-jim-wang/nomicore`
- Task type: feature
- Issue: #140
- Branch: `fix/issue-140-on-docs-phase-5-websocket-replication`
- Round: 1

## What to build

Close Phase 5 with black-box one-Hub/two-Peer acceptance across MemoryPersistence and FilePersistence, exercising concurrency, disconnection, recovery, security, limits, restart, reset, and ordered shutdown while aligning all public contracts and normative documents.

## Acceptance criteria

- Concurrent ROOT writes on Hub and two Peers converge to equivalent Y.Doc state.
- Disconnected Peer writes reconcile after reconnect; absent Peer bootstrap and bootstrap-race repair succeed.
- Lineage/epoch conflict, protected-field mutation, Hub schema propagation, epoch fencing, guarded reset, and archive behavior match the accepted contracts.
- Hub degraded rejection and Peer degraded in-memory following, retry persistence, stale-snapshot restart, and Hub diff recovery pass on both adapters.
- Backpressure, frame/update/channel limits, dropped ACK, malformed frames, auth/authz/revocation, secret-free logs, and graceful drain remain isolated and deterministic.
- FilePersistence tests use independent roots and cover process restart, archive/reset, and crash recovery.
- Public exports, stable errors, package docs, ADR 0010, protocol v1, Phase 5, CONTEXT, application config, and third-party hosting guidance are consistent.
- Typecheck, full tests, aggregate no-emit compilation, diff checks, supported Node matrix, and Standards/Spec final review pass before Phase 5 merge.

## Blocked by

- #133
- #134
- #135
- #139

## Phase 1 — SA6 acceptance anchor（2026-08-30，完成）

- **结论**：红灯成立（3 failed / 3 passed，1 文件 6 用例）。三个红灯 = Phase 5 管理动词验收缺口（app 黑盒控制面无 `replace-schema` / `bump-epoch` / `reset-replica`，一律回执 `unknown-op`）；三个绿灯 = 已交付验收证据（AC1 双适配器三实例并发收敛 + AC6 FilePersistence crash recovery）。
- **产出**：`apps/yjs-server/test/phase5-three-instance-acceptance-red.test.ts`（6 用例；详见 `wiki/raw/task_issue-140_sa6_red.md`——AC 逐条落点、失败证据、取舍与边界）。
- **红灯命令**：`npx vitest run apps/yjs-server/test/phase5-three-instance-acceptance-red.test.ts --no-typecheck`
- **红灯证据**：`AC3-① expected false to be true`（`replace-schema` → `unknown-op`）；`AC3-② expected false to be true`（`bump-epoch` → `unknown-op`）；`AC3-③ expected 'unknown-op' to be 'NAMESPACE_RESET_IDENTITY_MISMATCH'`。
- **SA3 实现方向**：app 控制面新增三管理动词（hub `replace-schema`/`bump-epoch`、peer `reset-replica`），接线已交付底层能力（hub lease `replaceSchema`/`bumpReplicationEpoch`、registry `resetReplica` + peer `removeTarget`/`addTarget` 重开通道），并同步 `docs/integration/hub-peer-deployment.md` 动词表（AC7）。
