# @nomicore/clock

通用 Cordis wall-clock capability（issue #106 / ADR-0009）。

## 能力边界

- `Clock.now()` 返回 Unix epoch milliseconds，**不承诺单调**（wall clock 允许回跳）。
- Clock 只负责当前时间观察；**延迟调度（timeout/interval/cron）由 Cordis Timer 负责**，本包不提供任何调度成员。
- 依赖 plugin 缺失 Clock service 时必须 loud fail（`requireClock` 抛错），**不 fallback 到系统时间**。

## 用法

完整的 Clock → Timer → Persistence → Registry 第三方宿主装配与停止顺序见 [`docs/integration/cordis-plugin-hosting.md`](../../docs/integration/cordis-plugin-hosting.md)。

```ts
import { createSystemClockPlugin, requireClock } from '@nomicore/clock'

// Host 装配：production wall clock
createSystemClockPlugin().apply(ctx)

// 消费方：loud require，不 fallback
const clock = requireClock(ctx)
clock.now() // Unix epoch ms
```

测试使用受控 manual provider（`@nomicore/clock/testing`）：

```ts
import { createManualClock, createManualClockPlugin } from '@nomicore/clock/testing'

const clock = createManualClock() // 默认从 0 起，确定性
createManualClockPlugin(clock).apply(ctx)
clock.advance(500)
clock.set(1_700_000_000_000) // 允许回跳（不承诺单调）
```

## Exports

- `@nomicore/clock`：`Clock`、`CLOCK_SERVICE`、`provideClock`、`requireClock`、`systemClock`、`createSystemClockPlugin`
- `@nomicore/clock/testing`：`ManualClock`、`createManualClock`、`createManualClockPlugin`
