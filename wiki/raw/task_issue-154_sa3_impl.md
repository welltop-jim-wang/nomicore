# SA3 实现报告 — Issue #154：Retain, lease, and delete namespace diagnostic logs

- **Worktree**: `/home/wangjian/nomicore-fix-issue-154`（branch `fix/issue-154-on-docs-namespace-diagnostic-change-log`）
- **实现提交**: `c0f6cbc`（`feat(namespace-diagnostic-log): retention, read-session leases, and namespace logical deletion (#154)`；父提交 `722bddf` = #167/#153 链）
- **上游输入**: `wiki/raw/task_issue-154_sa1_analysis.md`（§6 可测试需求）、`wiki/raw/task_issue-154_sa2_design.md`（§2 公共 API/§4 状态机/§5 不变量/§6 矩阵）、`wiki/raw/task_issue-154_sa6_red.md`（45 个红灯/护锚测试 + §4 实现注意事项）

---

## 1. 交付物（改动文件清单）

| 文件 | 性质 | 内容 |
|---|---|---|
| `packages/namespace-diagnostic-log/src/retention.ts` | **新建** | `FileRetentionConfig`、`RetentionSweepReport`、`normalizeRetentionConfig`（loud 值域门：负/NaN/∞/非整数/非数字 → 违规字段；`null`=关、`0`=非无限、缺省=30d/1GiB、双 null 仍卫生）、默认常量。纯 TS 零 fs（绑定面内）。 |
| `packages/namespace-diagnostic-log/src/read-session.ts` | **新建** | `DiagnosticReadSessionRequest/DiagnosticReadSession`、`openDiagnosticReadSession`、模块级租约注册表（`(rootDir,namespaceId)` 分区、`(streamId,segment)` 条目）、`segmentLeased`（sweep 查询；过期惰性判定）、`releaseNamespaceLeasePartition`（删除释放）。纯 TS 零 fs（枚举经 reader 内部导出、路径经 paths.ts）。 |
| `packages/namespace-diagnostic-log/src/reader.ts` | 修改 | ① 新增内部导出 `enumerateSegmentGroups(segmentsDir)`（`.deleting` 标记组整体剔除——jsonl/bin 均不可见；reader/resume/sweep/session 四面同源，防双份漂移）；② `StrictStreamRead` 增 `historyTrimmed` + `earliestRetainedSequence`（全部返回点、字段完整性）；③ `readStreamStrict` 结构化 trim 判定（最低存活段 ≠ `00000001` ⇒ 锚初始化 null——识别锚定不产生 `sequence-gap`；`false` 时行为逐字节等同现状）；④ `analyzeStreamForResume` 同款枚举剔除 + 锚容差（§7.5：防裁剪→rotate 风暴）。 |
| `packages/namespace-diagnostic-log/src/adapters/file.ts` | 修改 | ① config 增 `retention?: FileRetentionConfig \| null \| undefined`；② `FileDiagnosticLog` 增 `sweepRetention(options?: {now?})`；③ 构造期：retention 配置违规 → 恰一次 `retention-config-invalid{field}`（retention 失活、stream 照常）；`deletion.json` marker 门（先于 resume——disabled + 恰一次 `namespace-log-deleted`，零写入）；构造完成自动 sweep（`sweepOnOpen` 默认 true，仅 ready、now=注入钟）；④ sweep 主体：P0 卫生（遗留 `.deleting` S1→S3 续走 + orphan BIN 清理——开组 BIN-first 瞬态绝对豁免）→ P1 年龄（组内 max observedAt 全组扫描 + 末行快速否决；前缀纪律）→ P2 字节（跨 generation Σ 实际字节、候选序 createdAt↑/streamId↑、无可删候选即停）；报告数据面（earliestRetained / historyTrimmedStreams / retainedBytes 扫描重建）；⑤ `deleteNamespaceDiagnosticLog` + 结果联合（deletion.json temp+rename 线性化 → current.json(+tmp) → 逐流 `{s}`→`{s}.deleting`→rm → rm namespaceDir → 租约分区释放；全 ENOENT 幂等、非 ENOENT 失败即 failed{code,step} 可续走）；⑥ 事件规则「有动作才发」。 |
| `packages/namespace-diagnostic-log/src/health.ts` | 修改（只增） | 事件联合 +`retention-swept`（6 计数字段）+`retention-config-invalid`（field 封闭枚举）；`stream-init-failed.reason` +`'namespace-log-deleted'`——词表只增不改。 |
| `packages/namespace-diagnostic-log/src/index.ts` | 修改（只增） | 增量导出：`FileRetentionConfig`、`RetentionSweepReport`、`openDiagnosticReadSession`(+2 类型)、`deleteNamespaceDiagnosticLog`(+2 类型)；既有导出一字不动。 |
| `packages/namespace-diagnostic-log/test/helpers/file.ts` | 修改（SA6 owned 纯增量） | 未改动（SA6 已交付；本票未触碰——fixture 全部沿用）。 |
| `packages/namespace-diagnostic-log/package.json` | 修改 | `0.1.4 → 0.1.5`（逐变更 patch bump 惯例）。 |
| `packages/namespace-diagnostic-log/AGENTS.md` | 修改（文档） | 绑定面增量声明（retention/read-session 纯 TS）、保留字文件名（`{seg}.deleting`/`{s}.deleting`/`deletion.json`，INV-13）、租约进程内注册表声明、事件白名单增量与 `namespace-log-deleted` reason。 |
| `packages/namespace-diagnostic-log/README.md` | 修改（文档） | 「retention、读会话租约与 namespace 逻辑删除」整节（null/0 语义表、删除协议、触发点纪律、劝告锁语义、逻辑删除边界、trim 兼容与全裁剪收敛备案）；`strict ok` 语义边界更新（historyTrimmed 例外）。 |
| SA6 五个红灯测试文件 | 保持 | 零改动（45 个测试原样通过）。 |

**确认未触碰**（DENY/冻结面零 diff 验证通过）：`src/schema.ts`（指纹冻结——`schema-freeze.test.ts` 13 tests 原样绿）、`src/adapters/memory.ts`、`docs/adr/**`、`packages/namespace-runtime/**`、`packages/namespace-registry/**`、`src/testing.ts`（零新接缝）。

---

## 2. 关键实现裁决（含 SA6 报告 §4 歧义消解）

1. **T-C5 renew 判定时点（SA6 §4.1）**：采用「越界即拒」——`leasedUntil + ttl > openAt + maxLifetimeMs` ⇒ `renew()===false`；另加 `now > openAt + maxLifetimeMs` 防御（同向）。注册表条目随 renew 同步更新（sweep 惰性读取 leasedUntil——续租必须生效）。
2. **`.deleting` 组枚举规则（SA6 §4.2）**：标记存在 ⇒ 组整体从 reader/resume/session 枚举剔除（jsonl 与 bin 均不可见）——`enumerateSegmentGroups` 单点实现。注意：`isSegmentName` 对 `00000001.deleting` 天然为 false（文法力），本实现显式识别 `*.deleting` 后缀并按标记组剔除，避免「bin 残留被枚举为 bin-only 段」在 W1 下引发 roll-target/连续性误判。
3. **删除完成时序（SA6 §4.3）**：构造期续走与显式 sweep 均满足「任一触发点完成 ⇒ 终态一致」——构造期自动 sweep（sweepOnOpen）统一执行 P0 卫生（含遗留 `.deleting` 完成）；窗口测试只断终态。
4. **T-B9 等价替代（SA6 §4.4）**：`skipIf(root)` + 构造成功后 chmod 0555 segments 目录再 sweep——sweep 绝不 throw、failedSteps 计数、恢复后 emit 照常（本实现无需任何改动即满足：rename/unlink 失败 → failedSteps++ 止步该流，不升级异常）。
5. **T-B10 字节口径（SA6 §4.7）**：字节核算/候选序跨 generation 合计——sweep 扫描 `streams/` 全部合法流（manifest createdAt ↑, streamId ↑），非本实例流的**全部组皆闭**（sealed generation 无开组概念）。
6. **orphan 判定边界**：closed 判定对 orphan 清理采用「非本 writer 开组（segment ≠ currentSegment）」而非「segment < currentSegment」——否则 T-A4 中段号 4（> currentSegment 3）的 bin-only 孤儿不会被清。开组（=currentSegment 的组，含 BIN-first 瞬态）绝对豁免（T-B5/T-E7 双形态照妖镜）。
7. **年龄口径**：组内全部可解析 record 的 `max(observedAt)`（回拨钟安全，T-A2）；末行 observedAt > cutoff 快速否决（sound：max ≥ 末行值）；零 record/空 JSONL/ENOENT → 恒过期（SA2 §4.5 明文）；读失败（非 ENOENT）→ failedSteps++ + 保守未过期（宁少删）。含等号边界（now−max == maxAgeMs 即删，T-A1 钉死）。
8. **非法配置**：`retention-config-invalid` 恰一次（构造期、任何磁盘访问前）；失活 = 两限制皆 null；**零删除 + 零 `retention-swept` 事件**（SA6 §4.6）——卫生遍历有动作才会发事件，T-A6 全链路无动作 → 零事件。
9. **事件字段**：`retention-swept` 只带计数（deletedGroups/reclaimedBytes/orphanBinsDeleted/deletingMarkersCompleted/leaseBlockedGroups/failedSteps）——streamId/segment/offset 刻意不进事件（低基数纪律）；`RetentionSweepReport` 为数据面含 streamId。
10. **租约与固定语法坑**：`isSafeStreamId` 是 `value is string` 类型谓词——在 else-if 链上直接调用会把 else 分支窄化为 `never`（TS 4.4 aliased-condition narrowing），`deleteNamespaceDiagnosticLog` 的 stream 循环改为把 predicate 应用于 slice 表达式（`.deleting` 分支先行）。

---

## 3. 验证结果（真实命令 + 输出）

### 3.1 红灯→绿灯（SA6 五个新文件）

```bash
$ npx tsc -p packages/namespace-diagnostic-log/tsconfig.json
# exit 0（原 49 条错误全消；SA6 报告 §2.3 基线 = exit 2 / 49 errors）

$ npx vitest run packages/namespace-diagnostic-log/test/file-adapter-retention.test.ts \
    packages/namespace-diagnostic-log/test/file-adapter-retention-deletion-windows.test.ts \
    packages/namespace-diagnostic-log/test/file-adapter-read-session.test.ts \
    packages/namespace-diagnostic-log/test/file-adapter-namespace-deletion.test.ts \
    packages/namespace-diagnostic-log/test/file-adapter-retention-history.test.ts
# Test Files  5 passed (5)
#      Tests  45 passed (45)
# Type Errors  no errors
```

### 3.2 包级全量（非回归门：381 既有 + 45 新 = 426）

```bash
$ npx vitest run packages/namespace-diagnostic-log/
# Test Files  27 passed (27)     # SA6 基线 22 files（381 tests）→ 27 files（426 tests）
#      Tests  426 passed (426)
# Type Errors  no errors
```

钉死面单品（§10 命令 3）：`schema-freeze`（13）/`file-adapter-r2-supplemental`（22）/`file-adapter-reopen-roll-repair` 全部绿（含于 3.2 全量）。

### 3.3 仓库门（CI 同款）

```bash
$ pnpm test
# Test Files  147 passed (147)
#      Tests  1861 passed (1861)
# Type Errors  no errors

$ pnpm typecheck
# exit 0（10 个包全部 tsc 通过；含 packages/namespace-diagnostic-log）
```

---

## 4. 与设计的偏差（deviation）与备案

1. **`readStreamStrict` 早期返回（manifest 门失败前）的 `historyTrimmed`/`earliestRetainedSequence` 取值**：一律 `false`/`null`——此时尚无枚举信息；契约只对「枚举成功」的流定义 trim 语义（T-E2/T-E3 的最低段=00000001 流全部正常通过）。
2. **`earliestRetained` 的「仍有文件」判定**：以 `enumerateSegmentGroups().live` 非空为准（含零 record 组 → sequence null）；空 segments 目录的流不入列（SA6 §4.8 留白，未钉死——取自然实现）。
3. **`sweptStreams` 计数** = 本次枚举到的合法流（manifest 可解析 + createdAt 可定序）数；manifest 缺失/不可读的流保守跳过（不判不裁）。SA6 未断言该字段。
4. **`deleteNamespaceDiagnosticLog` 对非 `.deleting` 文法残物**（如未知文件）一律忽略（INV-13 文法门），不报错——与「绝不猜测」纪律一致；SA6 未覆盖。
5. **扫除 `current.json.tmp` 残留**在删除步骤 3（unlink current.json 之后、streams 之前）——与 SA2 §2.4 协议的「步骤 3」一致；T-D1 的 tmp 残留由本步或步骤 5 兜底移除。

## 5. 风险与后续（remaining risks）

- **多实例并发 sweep**（同进程重叠期）：协议幂等（rename/unlink ENOENT 容忍）+ `currentSegment` 单调 ⇒ 仅欠保护方向、无洞（SA2 §12-AT7）；v1 无跨进程锁（ADR 0012 部署约束内）。
- **`.deleting` 目录占位**（测试注入的人工态）：卫生遍历对其 unlink 失败 → failedSteps++ 且下轮重试；P1 把它排除在 live 之外——无洞风险但有 failedSteps 噪声（人工态，生产不可达）。
- **全裁剪收敛**：`(streamId, sequence)` 字面量跨裁剪可复用（SA2 §7.4 已接受、T-E6 钉死）；earliest retained 恒扫描重建（无持久 retention 状态——ADR 明文禁止）。
- **Host 责任面**：retention 触发点（构造期/显式调用）由 Host 在 write-slot 外接线（#149–#151/#155）；删除前置条件「该 namespace 无存活 writer」由 Host 保证——本票只交付被调能力。
- **1 GiB 默认字节上限**只做了 「total ≪ 1 GiB 零删除」间接覆盖（SA6 §4.5）：实现把默认钳错成 0 会大面积红——已绿灯即证明默认 = 1 GiB 正确。

## 6. 提交记录

- **实现提交**: `c0f6cbc` `feat(namespace-diagnostic-log): retention, read-session leases, and namespace logical deletion (#154)`
- 提交内容 = §1 全部 business/package 改动（src 6 文件 + 新建 2 文件、SA6 5 个测试文件 + helpers 增量、package.json、README.md、AGENTS.md）；**未提交**：`wiki/raw/task_issue-154_*.md`（任务元数据，含本文件）与 `REPORT.md`——按任务简报「不提交 REPORT.md/wiki 任务元数据」执行。
- 提交后工作树：`wiki/raw/task_issue-154_*.md` 5 个文件为唯一未跟踪残留（预期内）。
