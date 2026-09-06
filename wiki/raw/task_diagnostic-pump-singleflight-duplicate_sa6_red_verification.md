# SA6 红灯复现验证证据 — Issue #249（acceptance-contract R0）

- Worktree：`/home/wangjian/nomicore-fix-issue-249`（branch `mabf/issue-249`）
- HEAD：`ac91a6bf17ae7661df3f6461456e7ca4e8e81526`（= PR #248 合入后的任务起点）
- 日期：2026-09-06（UTC）
- 运行方式：bash 后台独立进程（`run_in_background: true`，Job 服务持有）；root vitest 配置
  （`NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run <两契约文件> --reporter=verbose`）
- 完整日志：`.scratch/249/sa6-contract-final-run.log`（exit=1：6 个失败均为预期红灯断言失败，非环境噪声）

## 结果总表

```text
Test Files  2 failed (2)
      Tests  6 failed | 7 passed (13)
Type Errors  no errors
Duration 3.74s
```

## 红灯（6）—— 逐一命中缺陷链断言

| 用例 | 断言 | 实测 | 期望 | 缺陷链 |
|---|---|---|---|---|
| R1a | burst 1000 只调度一次 | scheduleCount=256 | 1 | AC1 单飞违约（每被接纳任务一个 setImmediate） |
| R1b | 排空后 drain 恰一次 | fired=256（255 空转） | 1 | AC1 重复调度空转放大 |
| R1c | 持续入队待触发 drain 有界 | scheduleCount=256 | 1 | AC1 跨窗口累积待处理 drain |
| R3-2 | 44 条丢弃逐条上报（低基数 operation/reason） | dropReports=0 | 44 | AC3 满队列静默丢弃零上报 |
| T-A | entry-collision 候选结局落碰撞 ns 流（rejected） | nsA 流 1 条 | 2 条 | AC4 碰撞候选零诊断（registry.ts L1311） |
| T-B | DOC_DUPLICATE 候选结局 + genesis-less 建流 | nsA 流 0 条、建流 0 次 | 1 条 + 1 次 | AC4 duplicate 候选零诊断（registry.ts L1410） |

## 绿灯守护锚（7）—— 现实现成立、修复不得回退

| 用例 | 锚 |
|---|---|
| R1d | drain 运行中重入入队不超调度、同轮消费（AC1 running 态门有效） |
| R2a/R2b/R2c/R2d | AC2 交错不丢失四探针：stale 回调 no-op、回调间入队、末任务期 Host 重入、resolver/emitter 违约隔离（AC7 stale-interleave 回归锁） |
| R3-1 | AC3 有界丢弃本体：drop-newest、保序（delivered 前 256 条 FIFO） |
| T-C | AC4 业务不变量：重试预算耗尽 frozen fatal（`NamespaceRegistryFatalError` committed:false / phase='namespace-id-generation'），create #1 committed 恰 1 条 |

## 契约载体（artifact paths）

- `packages/namespace-registry/test/registry-issue-249-pump-red.test.ts`（R1/R2/R3，确定性手工调度器，
  零真实定时器；imports 真实 `src/diag-pump.ts`）
- `packages/namespace-registry/test/registry-issue-249-duplicate-red.test.ts`（T-A/T-B/T-C，真实 registry
  testing seam 全链路 + 生产形状 Host binding；scripted randomBytes）
- 契约设计记录：`wiki/raw/task_diagnostic-pump-singleflight-duplicate.md`（SA6 节）

## 注记

- R3-2 的 AC3 上报 seam 锚 = `DiagPumpDeps.reportDrop?`（每被丢任务恰一次
  `{operation, reason:'queue-full'}`；低基数红线：不含 namespaceId/streamId/token）。若 SA1 设计选不同
  seam 形状，须经 SA6 对齐修订本契约；通道落点（→ ADR-0009 L95 observer）为 SA1/SA3 接线决策。
- T-A/T-B 只锚归属/条数/rejected 语义与业务不变量；stage/code/sourceModule 精确映射留 SA1（SA5 §4.3
  建议组合），耗尽链路诊断断言待设计冻结后由 SA6 对齐补充。
- 修复前全量 `pnpm test` 因本批契约处于收集面内而为红（预期）；SA3 修绿 + SA4/SA7 双清后转绿。
