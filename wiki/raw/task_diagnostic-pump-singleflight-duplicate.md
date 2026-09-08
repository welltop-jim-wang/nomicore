# Task Brief — Issue #249

- Repository: `welltop-jim-wang/nomicore`
- Issue: [#249](https://github.com/welltop-jim-wang/nomicore/issues/249)
- Title: 修复 diagnostic pump 单飞竞态并补齐 duplicate 诊断
- Task type: Bug fix

## Scope

修复 `namespace-registry` 中 per-namespace diagnostic pump 的单飞、有界调度与 enqueue/drain 交错正确性；为 Registry entry collision 与 Persistence `DOC_DUPLICATE` 候选结局补齐正确 namespace 的诊断事实。保持 ADR 0011/0012 的 best-effort、业务隔离、输入零访问和既有 retry/结果/词表约束。

## Acceptance Criteria

1. 每个 namespace 同时至多一个 scheduled/running drain；首个 drain 前 burst enqueue 不会无界重复 `setImmediate`。
2. stale callback 与 enqueue/drain 清理交错不丢已接纳任务；同 namespace FIFO 且 `initStream` 先于对应 emission。
3. 内存与调度有界；满队列 drop newest，保留顺序并以既有低基数 metric/observer 健康语义报告。
4. entry collision 与 `DOC_DUPLICATE` 到正确 namespace 的诊断流，不影响最多 8 次 retry、最终 create 结果或稳定词表。
5. acceptance/capability gate 输入零访问，后续仅用 detached safe snapshot。
6. initStream/resolver/emitter/storage 异常不改变业务结果/顺序，不无限延长 shutdown。
7. 新增确定性红→绿测试，覆盖 burst、stale interleave、queue-full/health、collision、duplicate、retry 成功/耗尽、异常隔离，且 PR #248 实现会失败。
8. 运行指定 namespace-registry 测试、根 `pnpm typecheck`、`pnpm test` 与 `git diff --check`。

## SA6 红灯验收契约（2026-09-06，acceptance-contract R0）

契约载体（本任务的红→绿验收测试，SA3 修绿对象；HEAD `ac91a6b` 实测 6 红 / 8 绿）：

| 文件 | 覆盖 AC | 用例 | 当前 HEAD 判定 |
|---|---|---|---|
| `packages/namespace-registry/test/registry-issue-249-pump-red.test.ts` | AC1/AC2/AC3/AC7 | R1a/R1b/R1c **红**（单飞违约：burst 窗口每被接纳任务一个 setImmediate，256 调度 / 256 空转 drain）；R1d、R2a–R2d **绿守护锚**（AC2 交错不丢失回归锁）；R3-1 **绿**（有界 drop-newest 保序）；R3-2 **红**（44 条丢弃零上报） | 4 红 / 6 绿（10） |
| `packages/namespace-registry/test/registry-issue-249-duplicate-red.test.ts` | AC4/AC7 | T-A **红**（entry-collision 候选零诊断，期望 nsA 流 2 条含 rejected）；T-B **红**（DOC_DUPLICATE 候选零诊断零建流，期望 1 条 rejected + 1 次 genesis-less initStream）；T-C **绿业务锚**（耗尽 fatal 冻结语义 + 候选诊断登记待设计裁决） | 2 红 / 1 绿（3） |

- 复现验证（root vitest 配置，后台独立进程；`pnpm exec vitest run` 两文件）：**6 failed | 7 passed (13)**，
  红灯断言逐一命中缺陷链：`expected 256 to be 1`（R1a/R1b/R1c）、`expected +0 to be 44`（R3-2）、
  `expected 1 to be 2`（T-A）、`expected +0 to be 1`（T-B）；绿灯锚全过（R1d/R2a–d/R3-1/T-C）。
  完整运行日志：`.scratch/249/sa6-contract-final-run.log`（exit=1，6 失败为预期红灯）；证据摘要见
  `wiki/raw/task_diagnostic-pump-singleflight-duplicate_sa6_red_verification.md`。
- 契约 seam 锚注：R3-2 以 `DiagPumpDeps.reportDrop?`（可选，`{operation, reason:'queue-full'}` 每被丢任务恰一次）
  为 AC3 上报面锚点（#150「字段名即本契约锚点」先例）；SA1 设计若选不同 seam 形状须经 SA6 对齐修订。
  上报通道最终落点 = ADR-0009 L95 Registry 内部 observer seam（SA8 裁定），低基数红线：载荷不含
  namespaceId/streamId/token。T-A/T-B 只锚归属/条数/rejected 语义与业务不变量，stage/code/sourceModule
  精确映射留 SA1（SA5 §4.3 建议组合供参考），耗尽链路诊断断言待设计冻结后由 SA6 对齐补充。
- 既有绿灯基线零感知断言不变：本批契约在 `pnpm test` 全量收集面内（`packages/*/test/**/*.test.ts`），
  修复前全量 suite 因此为红（预期）；修复（SA3）+ SA4/SA7 双清后转绿。
