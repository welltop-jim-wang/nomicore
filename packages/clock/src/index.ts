/**
 * @nomicore/clock —— 公共入口（issue #106；ADR-0009 wall-clock capability）。
 *
 * 公共面纪律：
 * - Clock 接口 + CLOCK_SERVICE + Context augmentation + provide/require +
 *   production provider（systemClock / createSystemClockPlugin）；
 * - 受控 manual testing provider 仅从 `./testing` 子路径导出
 *   （issue #104「受控 testing subpath」纪律），本入口零 re-export；
 * - 无 timeout/interval/cron——延迟调度是 Cordis Timer 的职责。
 */
export { CLOCK_SERVICE, provideClock, requireClock, type Clock } from './contract.js'
export { createSystemClockPlugin, systemClock } from './system.js'
