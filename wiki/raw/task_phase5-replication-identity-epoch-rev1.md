# 修订轮任务简报 — Phase 5 replication identity/epoch（issue #132，round=2）

- **repositoryId**: nomicore
- **issue**: 132
- **round**: 2（发布后修订轮 — PR #145 人工 review Request changes）
- **branch**: fix/issue-132-on-docs-phase-5-websocket-replication
- **run_id**: issue-132-1787809226-3529662
- **基线 commit**: 3841aff（round 1 封口）；round 1 全部档案见 `task_phase5-replication-identity-epoch_*`
- **任务类型自判**：修订轮（无标签）→ 按 §发布后修订轮 裁剪工作流：SA1 设计 → SA8 设计复审 → SA2 攻击评审 → SA3 实现 → 总控亲验 → SA4 静态 → SA7 动态 → AC 门禁 → 双轴终审 → 收尾。SA5/SA6 省略（非 bug 复现；反馈 3 的新增用例属验收锚定性质，由 SA1 设计测试矩阵、SA3 落位，行为已存在故用例应直接绿）。

## 评审反馈原文（welltop-jim-wang @ 2026-08-27T14:33:17Z，issue #132 评论）

### 反馈 1（高优先级）：普通 open 的 META 校验与 ADR 0008 冲突

`packages/namespace-runtime/src/runtime.ts:203-216` 在 Runtime 构造期调用 `readReplicationFacts(doc)`；复制字段损坏会导致普通 open 构造失败。

这与 `docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md:14` 当前约定冲突：普通 open 不执行载体/logical validation，且外部持久化损坏不在该契约范围。

请二选一并落实：

- 若构造期校验是预期设计：显式修订/增补 ADR 0008，说明复制保留字段是普通 open 规则的例外，并记录损坏时拒绝构造的语义；
- 若不是预期设计：将复制事实校验移至复制管理或 session 接缝，保持普通 Runtime open 可读。

### 反馈 2（中优先级）：同步 Runtime 公共契约文档

PR 新增 `enableReplication()`、`bumpReplicationEpoch()` 和 `status.replication`，但 ADR 0008 仍在第 36–41 行称 Runtime 只公开两个写方法，第 95 行的 status 字段清单也没有 replication。

请更新所有受影响的规范文档。`wiki/raw` 是历史证据，不能替代 ADR/phase 等规范合同的修订。

### 反馈 3（中优先级）：补齐 AC-6 恢复测试矩阵

现有测试已覆盖大部分路径，但仍需补充：

- File Persistence 中 bump 后 replicationEpoch 的落盘与重启恢复；
- fatal 后 reopen/recovery 对 committed replication facts 的保留。

当前 Memory 路径已有 degraded retry 与 bump 恢复，File 路径主要覆盖 enable 后 epoch 1 的恢复，因此 AC-6 仍属部分完成。

### 反馈 4（低优先级判断项）：收敛复制写槽重复 gate

`packages/namespace-runtime/src/replication-write.ts:160-184` 与 `:284-307` 重复 fatal/writable/notifier gate。建议提取共享 gate，降低未来策略漂移风险；此项可按维护成本判断是否在本 PR 处理。

### 验证记录（评审时基线）

- `git diff --check`：通过
- `pnpm typecheck`：通过
- `pnpm test`：126 个测试文件、1478 个测试全部通过，Type errors 0
- GitHub CI：通过

## 本轮验收门槛

- 四项反馈逐项有处置方式与证据（文件/行号/测试名）；
- `git diff --check` / `pnpm typecheck` / `pnpm test`（全量）通过并记录；
- 若反馈 1 选择改代码而非改 ADR，或反馈 4 选择不处理，REPORT.md 必须给出明确理由；
- 规范文档修订落在 `docs/adr/` 与 `docs/phases/`（wiki/raw 仅作历史证据）。
