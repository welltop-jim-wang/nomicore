/**
 * @nomicore/clock/testing —— 受控测试子路径（issue #104 Testing Decisions）。
 * 仅暴露 manual testing provider；生产宿主请使用主入口的 systemClock/plugin。
 */
export { createManualClock, createManualClockPlugin, type ManualClock } from './manual.js'
