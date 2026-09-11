# MABF Task Brief

Repository: welltop-jim-wang/nomicore
Issue: #269
Title: REST create：Registry 失败语义、取消边界与双 observer 契约
State: open
Issue updated at: 2026-09-10T22:21:52Z

## Issue body

## Parent

PR #158（docs/rest-namespace-create）

## What to build

在 REST router 骨架上叠加 Registry 失败映射、取消语义与 observability：

**失败映射**：`REGISTRY_NOT_ACCEPTING` → 503（明确零提交，可稍后重新请求）；Registry typed operational failure → 500 `NAMESPACE_CREATE_FAILED`（code 语义保证 `committed:false`）；Registry fatal 且 `committed:true` → 500 `NAMESPACE_CREATE_OUTCOME_UNKNOWN`（不得自动重试）；unknown exception 或内部契约违例 → 500 `INTERNAL_ERROR`。REST 自行构造合法 Registry 输入，因此 `NAMESPACE_CREATE_INVALID_INPUT` 与 `NAMESPACE_ALREADY_EXISTS` 均视为内部契约违例，返回安全 500 并上报 diagnostic observer（普通 REST create 不应返回 `NAMESPACE_ALREADY_EXISTS`，namespaceId 碰撞由 Registry 内部处理）。

**取消边界**：body 读取阶段尊重 `Request.signal`，中断后 Registry 零触达；调用 Registry 后不传播客户端取消，必须等待 create settle 并 release Lease。

**Observability**：构造时必须显式注入两个同步 void observer（传 no-op 也必须是显式决定）；observer throw 一律隔离，不改变 HTTP 结果。metrics-safe observer 只有统一低基数事件：operation、`succeeded | rejected | unavailable | failed | aborted` outcome、稳定 code 与可选 HTTP status；不携带 owner、namespaceId、issues、schema/root 或 cause。diagnostic observer 只接收三类事件：Registry fatal、unknown exception、Lease release failure；可携带已验证 owner、错误本身已知的 namespaceId、Registry operation/phase/committed 与 exact cause，但不得携带 schema/root 或完整 validation issues。Host 须把该 Adapter 视为敏感运维接口并负责访问控制、采样和脱敏。

## Acceptance criteria

- [ ] 503 / 500 三分支（FAILED / OUTCOME_UNKNOWN / INTERNAL_ERROR）按 Registry 结果类型精确映射，committed 语义正确
- [ ] `NAMESPACE_CREATE_INVALID_INPUT` 与 `NAMESPACE_ALREADY_EXISTS` 从 REST 路径返回安全 500 并触发 diagnostic 事件
- [ ] body 读取中断时 Registry 零触达；Registry 接纳后客户端中断不取消 create，仍等待 settle 并 release
- [ ] 两个 observer 构造时强制显式注入；metrics 事件低基数且无敏感字段；diagnostic 仅三类事件且不带 schema/root/完整 issues
- [ ] observer throw 不改变 HTTP 结果
- [ ] 测试覆盖：not accepting、operational failure、fatal committed 二分、中断语义、observer 隔离

## Blocked by

- #267


## Comments
