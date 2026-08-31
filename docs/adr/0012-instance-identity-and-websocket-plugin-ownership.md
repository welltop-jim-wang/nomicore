# ADR 0012：实例身份单一真相与 WebSocket plugin 所有权

状态：已接受（issue #204 已实现）

Nomicore 将 `instanceId + role` 建模为独立、不可变的 Instance identity service，由 composition root 配置一次，并由 Namespace Registry 与角色专用的 Hub/Peer WebSocket plugins 共同消费。WebSocket plugins 只拥有 listener/dialer、认证与授权适配、replication controller、连接和自身 service；它们可以引用但不得创建、shutdown 或 dispose Clock、Timer、Persistence、Namespace Registry。Standalone yjs-server 继续作为上层 composition root，显式组装 Instance → Clock → Timer → Persistence → Registry → role-specific WebSocket plugin。

## 决策理由

把 Registry/Persistence 放进 WebSocket plugin 会反转依赖所有权，使 DSH/Cordis 宿主无法复用既有 plugins，并产生重复 teardown。让 Registry 和 transport 分别配置 role/instanceId 又会制造身份多真相源。独立 Instance service 让角色检查、HELLO 身份、可信认证绑定、实例授权与 observability 使用同一事实；按角色拆分 WebSocket plugins 则保持配置和生命周期窄而明确。

## 配置与运行语义

- Instance plugin 的配置域拥有 `instanceId` 与 `role`；factory 可提供可选 overrides，最终合并结果必须严格校验。instanceId 和 role 都是 restart-only。
- Registry plugin 不再接受独立 role，必须注入 Instance service。
- Hub 与 Peer 使用不同 plugin factories 和 services。两者都依赖 Instance、Clock、Timer 与 Registry，并在 side effects 前 loud fail role mismatch。
- Hub 配置拥有 listen、authentication、authorization、limits、timeouts、observer 与 adapter overrides；Peer 配置拥有 Hub endpoint、`expectedHubInstanceId`、credential/dial adapter、initial targets、limits、timeouts、backoff、observer 与 adapter overrides。
- 静态 tokens、authorization entries、targets 在 overrides 中整体替换；limits/timeouts/backoff 按字段合并；`undefined` 表示未覆盖；未知键拒绝。
- Hub ready 表示 listener 已接纳且认证/授权已接线。Peer ready 表示 controller/dial loop 已启动，不等待 Hub live。
- Fiber dispose 只 drain/close WebSocket plugin 自身资源并撤 service；上游 Registry/Persistence 生命周期由其拥有者处理。
- Peer targets 的持久真相属于宿主；plugin 只维护当前进程内目标集。
- 第一版静态网络、认证、授权、limits/timeouts/backoff 配置 restart-only；仅 targets 支持运行期 add/remove。
- status、observer 与错误不得泄漏 token、Authorization、owner 完整值、Schema/Data、Yjs bytes 或 stack。

## 被否决方案

- 自包含 yjs-server plugin：隐藏创建 Registry/Persistence，导致浅 adapter、重复生命周期和错误所有权。
- 单一 role-switching WebSocket plugin：产生大量可选字段和运行期分支，削弱配置门禁。
- Registry 与 WebSocket 分别配置 role/instanceId：允许静默不一致。
- WebSocket plugin 暴露 raw Registry、ReplicationSession 或 live Y.Doc：扩大可信能力面。

## 最终服务所有权

- Composition root 拥有 Instance、Clock、Timer、Persistence 与 Namespace Registry 的创建、配置和最终 teardown；Instance service 是 `instanceId + role` 的唯一生产来源。
- Namespace Registry plugin 只拥有 Registry 实例与 `nomicoreRegistry` service；它读取 Instance role，但不拥有或销毁 Instance、Clock、Timer、Persistence。
- Hub WebSocket plugin 只拥有 listener、Hub replication controller、连接/channel 与 `nomicoreHubReplication` service。
- Peer WebSocket plugin 只拥有 dial loop、Peer replication controller、连接/channel、进程内 targets 与 `nomicorePeerReplication` service。
- WebSocket plugin Fiber dispose 先停止自身网络接纳并 drain/close controller，再撤自身 service；它不调用 Registry shutdown 或 Persistence dispose。上游资源随后由 composition root 按 Registry → Persistence → Timer/Clock 的顺序释放。

## 后果

DSH/Cordis 宿主必须显式组装上游 plugins，再挂角色专用 WebSocket plugin；standalone composition root 复用完全相同的 plugins。该变化会破坏 Registry plugin 的旧 role 配置方式，但 Nomicore 尚未正式发布，因此不提供兼容双配置面。
