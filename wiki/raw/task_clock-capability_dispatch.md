# Dispatch Log — clock：通用 Cordis wall-clock capability（issue #106, round 1）

- run_id: issue-106-1787654097-603033
- branch: fix/issue-106-on-docs-namespace-registry
- worktree: /home/wangjian/nomicore-fix-issue-106

## 设计裁决（总控）

依据 issue #106 验收条件、issue #104 Implementation/Testing Decisions、ADR-0009 与 phase-4 文档：

- 范围限界：本 issue 只交付 `@nomicore/clock` 新包；Persistence service 更名与 Clock/Timer 迁移属 issue #107，Registry 属 #110-#112，不在本 round 触碰 `packages/persistence` 等既有代码。
- 服务模式对齐 `packages/persistence/src/contract.ts`：`CLOCK_SERVICE = 'clock'`、Context augmentation、`provideClock`/`requireClock`（缺失即 loud throw，无系统时间 fallback）。
- 生产 provider：`systemClock`（`now: () => Date.now()`，冻结对象）+ `createSystemClockPlugin()`（`ctx.effect` 注册，fiber dispose 自动注销，对齐 MemoryPersistence.apply 模式）。
- 受控 manual testing provider 走独立 `./testing` 子路径（`createManualClock`/`createManualClockPlugin`/`ManualClock`），主入口零 re-export —— 呼应 issue #104「受控 testing subpath」纪律。
- Clock 能力边界：接口仅 `now(): number`（Unix epoch ms，明确不承诺单调）；不提供 timeout/interval/cron，不与 Cordis Timer 重叠；以静态审计测试锚定。
- `Clock.now()` 输出校验不在 Clock 包内做：ADR-0009 规定非法 Clock 输出是消费方（Registry create-document）的 internal fatal；manual clock 只对 set/advance 输入做 loud 校验（TypeError 非 number / RangeError 非有限、负 advance、advance 溢出）。

## Dispatch 记录

| 时间 | 执行者 | 动作 | 产出 |
|---|---|---|---|
| round 1 | 总控（brief 授权可自行实现） | 红灯测试 + 实现 + 接线 | packages/clock |
| round 1 | review subagent ×2（并行） | 基线→HEAD diff 双轴审查 | 待补 |
