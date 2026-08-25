/**
 * 【控制组】specifier 只出现在注释中——审计不得误判（AST 遍历天然不采注释文本；
 * 旧文本正则反而会命中 `from '…'` 形态→误报——本控制组同时是反误报锚点）。
 */

// 注释中的伪消费（不得被检测）：
// import '@nomicore/namespace-runtime/internal';
// export * from '@nomicore/namespace-runtime/internal';
export {};
