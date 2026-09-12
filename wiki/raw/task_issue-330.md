# MABF Task Brief

Repository: welltop-jim-wang/nomicore
Issue: #330
Title: nomicore 服务表面 getter 化：冻结服务可被 Proxy 包装消费（ADR 0023 落地）
State: open
Issue updated at: 2026-09-12T04:48:31Z

## Issue body

## Parent

PR #329（adr-0023-proxy-consumable-service-surfaces）

## What to build

DSH 动态插件沙箱（cordis-host-runner）用 Proxy 包装注入的 Cordis 服务、`get` 陷阱为函数成员返回包装闭包；nomicore 的冻结对象字面量服务以数据属性承载方法，触发 ECMA-262 Proxy `[[Get]]` 不变量，会话级插件每次成员访问即抛 TypeError，`ctx.get('nomicoreRegistry')` 等完全不可用（tracking issue #328）。

本 ticket 按 ADR 0023 落地机械变换：把四个服务对象（`nomicoreRegistry`、`nomicoreHubReplication`、`nomicorePeerReplication`、`clock`/`systemClock`）外加 testing 导出的 `ManualClock` 的函数成员从数据属性改为访问器属性——方法体提为稳定闭包、getter 返回该闭包、`Object.freeze` 保留、方法与状态机实现一行不动。冻结姿态不弱化（无 setter 拒绝赋值、non-configurable 拒绝重定义、枚举性与 TS 类型面不变）。每个服务配一款"guard-proxy 合法消费"回归测试，把该契约锁死。

明确不改：`nomicoreInstance`（纯数据）、`nomicorePersistence`（class 原型方法）、`timer`（上游 class）、lease/session 等方法返回值与 issue/status 信封。

## Acceptance criteria

- [ ] `nomicoreRegistry`（namespace-registry）全部函数成员为访问器属性形态；新增回归测试：经 Cordis 组合取得 registry 后套上"get 陷阱返回包装闭包"的 Proxy，访问并调用每个方法不抛 TypeError、行为直通
- [ ] `HubReplicationService` 与 `PeerReplicationService`（ws-replication）同款改造 + 各一款 guard-proxy 消费回归测试（既有插件测试 seam），覆盖 `status`/`requestReauth`/`stop` 与 `status`/`addTarget`/`removeTarget`/`notifyAuthChanged`/`waitForLive` 全部成员访问
- [ ] `systemClock` 与 `ManualClock`（clock 包，后者为 testing 导出）同款改造 + guard-proxy 消费用例；既有 `Object.isFrozen` 断言保持绿灯
- [ ] 三包内凡断言方法为数据属性形态（如 `writable === false`）的冻结测试更新为访问器形态断言（`configurable === false`、`typeof get === 'function'`、`set === undefined`）；无此类断言则审计结论记录在案
- [ ] `Object.freeze` 保留，赋值与 `defineProperty` 重定义仍被拒绝（姿态对照见 ADR 0023）；TS 公共类型面零变化
- [ ] 测试 helper 为包内复制的 guard-proxy 构造（每包约 10 行），不新建共享测试设施
- [ ] `namespace-registry`、`ws-replication`、`clock` 包门禁 + root `pnpm typecheck` 与 `pnpm test` 全绿
- [ ] 三包 local tarball 可正常构建（发布物就绪，供 DSH 侧 `nomicore-host` 重建 + live reload 联动）

## Blocked by

- None (can start immediately)

## Comments
