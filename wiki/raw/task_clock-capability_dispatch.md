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
| round 1 | 总控（brief 授权可自行实现） | 红灯测试 + 实现 + 接线 | packages/clock（commit ffb12a0） |
| round 1 | 总控亲跑 | pnpm typecheck && pnpm test && 聚合 tsc --noEmit | exit 0（97 文件 / 1169 测试全绿，Type Errors 0） |
| round 1 | review subagent 536331f3（Standards 轴）+ c5f3d709（Spec 轴）并行 | 基线 3451eca→HEAD(ffb12a0) diff 双轴审查 | 双轴 **NON-BLOCKING** |
| round 1 | 总控 | Standards nit 修复：移除 requireClock 冗余 `as Clock`（对齐 persistence 模式）；复验 clock 包 | 见收尾 commit |

## 双轴审查结论（round 1，commit ffb12a0）

- **Standards 轴（NON-BLOCKING）**：无文档标准违例——contract/plugin/生命周期测试/静态审计/test-d 均对齐 persistence 与 namespace-runtime 事实标准；Fowler 基线仅 3 个判断项（两个 plugin 工厂同形可辩护、surface 测试复用剥离正则无共享落点、`as Clock` 冗余强转——已修）。
- **Spec 轴（NON-BLOCKING）**：AC1–AC7 全部落实且锚点真实——AC4 loud-fail 双锚（稳定错误消息 + 无 fallback 安装 + 依赖 plugin apply 失败）；AC5 三锚（类型层 @ts-expect-error + 运行时键面 + 静态源码审计）；AC6 生命周期真锚（fiber dispose 恰一次注销、幂等）。AC2 非单调承诺属文档锚（负承诺不可行为测试）。范围纪律：未触碰 persistence/registry（#107+ 后续 ticket）。
