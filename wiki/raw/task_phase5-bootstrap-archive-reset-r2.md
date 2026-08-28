# 任务简报（修订轮 round=2）— Phase 5: bootstrap import, archive, and guarded replica reset

- **Issue**: #133 (welltop-jim-wang/nomicore)
- **Task Type**: 功能开发修订轮（post-publish revision；含代码变更 → SA6→SA1→SA2→SA3→SA4→SA7 全流程）
- **Branch**: fix/issue-133-on-docs-phase-5-websocket-replication
- **Worktree**: /home/wangjian/nomicore-fix-issue-133
- **run_id**: issue-133-1787847735-3529662
- **round**: 2
- **slug**: phase5-bootstrap-archive-reset-r2（全部 round-2 流水线档案以 `wiki/raw/task_phase5-bootstrap-archive-reset-r2_*` 命名）
- **round-1 档案**: `wiki/raw/task_phase5-bootstrap-archive-reset_*`（设计/评审/实现/AC 全档，作为本轮基线证据）

## 修订触发

round=1 已交付并通过 CI（PR #147）。人工 review（welltop-jim-wang @ 2026-08-27T21:53:35Z）给出 3 项后续修改要求，本轮必须全部处置。

## 反馈全文（逐字）

### 反馈 1：Reset 身份校验顺序与竞态测试
- `resetReplica` 在关闭活动 Runtime generation、强制释放 lease 或执行归档前，先将 live/persisted replication identity 与 `expectedLocalIdentity` 做可靠核对。
- 身份不匹配时不得破坏当前 generation，原 lease/runtime 应保持可用。
- 补充 dirty identity/epoch 尚未 flush、持久化仍为旧 identity 时的竞态测试，确保不会关闭或归档错误 generation。

### 反馈 2：Bootstrap 绑定 Hub 广告身份
- Bootstrap/import 接口应接收或以其他可靠方式绑定 Hub 广告的 expected `{ replicationId, replicationEpoch }`。
- 在 persistence ownership 转移前，不仅校验 META 格式，还必须校验其与 Hub 广告身份完全一致。
- 补充「格式正确但 lineage 或 epoch 错误」的拒绝测试。

### 反馈 3：同步规范 ADR
- 修订 ADR 0006 与 ADR 0010，正式记录本次新增的 Persistence 与 Registry 生命周期契约，包括 `importDoc`/`archiveDoc`、归档布局与原子语义、`importReplica`/`resetReplica` 的身份前置条件和操作顺序。
- `wiki/raw/*` 仅作为历史证据，不能替代规范 ADR。

## 当前实现基线（HEAD = 6784645，round-1 close-out）

- `packages/namespace-registry/src/registry.ts`：
  - `runImportSlot`（~L1362-1441）：① owner 核对 → ②a META.docId 核对 → ②b 复制事实两键格式守卫（`readImportedReplicaFacts`，仅格式/在场性判据）→ ③ capability gate → ④ `importDoc` 排他创建（ownership 转移点）→ ⑤ Runtime 构造。**现状缺口（反馈 2）**：②b 只校验 META 内复制事实的格式与完整性，从未与外部 Hub 广告的 expected `{replicationId, replicationEpoch}` 比对——`importReplica(owner, namespaceId, doc)` 签名不接收 expected identity。
  - `runResetSlot`（~L1468-1577）：① owner 核对 → capability gate → ② forceReleaseOutstandingLeases + cancelIdleArm + close（关闭 Runtime generation）→ ③ loadDoc 探针 → ④ `archiveDoc(owner, docId, expected)`（身份守卫在 persistence 层、**close 之后**才执行）→ ⑤ bootstrap 资格。**现状缺口（反馈 1）**：身份核对发生在 generation 已关闭、lease 已强制释放之后；不匹配时 generation 已被破坏。
- `packages/persistence/src/lifecycle.ts`：`archiveDoc` 内含 settle 排空 + guard-read + 单一身份谓词（`DOC_ARCHIVE_IDENTITY_MISMATCH`）；`importDoc` 复用 exclusiveCreate 排他管线。
- 测试基线：142 文件 / 1711 用例全绿、零类型错误（`.mabf-bg/final-test.log` @ round-1）。

## Acceptance criteria（本轮编号 R2-AC-1..R2-AC-6）

- [ ] R2-AC-1: `resetReplica` 在任何破坏性动作（forceRelease/close/archive）之前，先将 live（Runtime/META 当前值）与 persisted replication identity 对 `expectedLocalIdentity` 做可靠核对；不匹配 → 领域拒绝，且当前 generation/lease/runtime 完全保持可用（零破坏）。
- [ ] R2-AC-2: 竞态测试：dirty identity/epoch（已 enableReplication/bumpReplicationEpoch 但尚未 flush、持久化仍为旧 identity）场景下 reset 不得关闭或归档错误 generation；身份核对必须读取正确的真相源并对核对口径有明确定义（live vs persisted 的判定规则写进设计）。
- [ ] R2-AC-3: Bootstrap/import 路径（`importReplica` 及必要的下层 seam）接收或可靠绑定 Hub 广告的 expected `{replicationId, replicationEpoch}`；在 persistence ownership 转移（importDoc resolve）之前校验 META 复制事实与该广告身份完全一致（不止格式校验）。
- [ ] R2-AC-4: 拒绝测试：META 格式正确但 replicationId（lineage）错误或 replicationEpoch 不符 → 拒绝，且零持久化写入、零 entry 登记。
- [ ] R2-AC-5: 修订 `docs/adr/0006-server-persistence-docstore.md` 与 `docs/adr/0010-hub-peer-websocket-ydoc-replication.md`：正式记录 importDoc/archiveDoc 契约、归档布局与原子语义、importReplica/resetReplica 的身份前置条件与冻结操作顺序（演进经 owner 裁决放行体例，与两 ADR 既有修订段格式一致）。
- [ ] R2-AC-6: 全部既有 1711 用例保持绿（零回归），新增测试全部绿，`pnpm typecheck` 零错误，`git diff --check` 干净。

## 设计约束（不变红线）

- 反馈 1/2 涉及的行为变更必须保持 round-1 已冻结的分类学与映射矩阵语义（`RESET_IDENTITY_MISMATCH_ISSUE` 等冻结词汇、committed 事实诚实 INV-12、零存在性泄露），除非 SA1 设计明确提出并经 SA2 评审通过。
- ADR 0010 既有「§复制谱系与 epoch」「§Bootstrap 与重连」的 resetReplica/importReplica 次序描述若与新前置校验次序冲突，由反馈 3 的 ADR 修订一并解决（本轮授权修订 ADR 0006/0010——owner review 明文要求）。
- 接口签名变更（如 importReplica 增加 expected identity 参数）属公共 API 演进：需保持 type-level surface 测试（`*.test-d.ts`）同步，并评估对 Hub 侧调用方（切片 3-7 未来集成点）的兼容注释。

## 设计基准（相关文档）

- round-1 设计：`wiki/raw/task_phase5-bootstrap-archive-reset_design.md`（§4.2 import 槽次序、§4.8 reset 槽次序、§4.7 期望身份纯传递、§4.8.x 映射矩阵）
- `docs/adr/0010-hub-peer-websocket-ydoc-replication.md`（§复制谱系与 epoch、§Bootstrap 与重连）
- `docs/adr/0006-server-persistence-docstore.md`（全量快照原子覆盖、degraded/retry、既有修订段体例）
- `docs/phases/phase-5-websocket-replication.md`（§实施切片 2/8、场景 15b）
- ADR 0008（单 Runtime、唯一 write sequencer、lifecycle gate、committed/fatal 诚实）
- ADR 0009（Registry lease 与 host 生命周期）

## 流水线要求

按功能开发修订轮全流程：SA8 前置门禁 → SA6 红灯锚定（反馈 1 竞态 + 反馈 2 拒绝用例）→ SA1 设计 → SA8 设计复审 → SA2 攻击评审 → SA3 TDD 实现 → SA4 静态验尸 → SA7 动态验证 → AC 门禁 → 双轴终审。
