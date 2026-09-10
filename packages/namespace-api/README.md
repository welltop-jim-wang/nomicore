# `@nomicore/namespace-api`

Host-agnostic REST adapter for namespace lifecycle endpoints (ADR 0015). The first version exposes only the REST router; create orchestration stays package-private.

`@nomicore/namespace-api/rest` 暴露 `createRestRouter(options)`：一个**普通 Module（不是 Cordis plugin）**，把标准 Web `Request` 映射为判别结果 `{ matched: false } | { matched: true; response }`。它不拥有 listener、authentication、authorization、CORS、TLS、Request ID、全局并发或 graceful drain——这些属于未来 server / composition root（FR-5）。

## Public API

- `createRestRouter({ role, registry, metricsObserver, diagnosticObserver, limits? })` —— 构造时读取、校验、复制并冻结配置；非法配置抛普通 `TypeError`。`limits` 为 Partial 覆盖七项默认值（body 4 MiB / schemaText 256 KiB / JSON depth 64 / JSON nodes 100,000 / issues 100 / 单条 issue message 1,024 UTF-8 bytes / issues 总预算 64 KiB）；**未知键、非正安全整数**一律构造时抛普通 `TypeError`；`maxSchemaTextBytes <= maxBodyBytes` 对有效值恒成立——两键都被显式给出且矛盾时抛 `TypeError`，只给出一键时另一键的默认值按不变量向显式值收敛（`{maxBodyBytes: 16}` 因此可构造）。两个同步 void observer 必须显式注入（no-op 也须显式，ADR 0015 L186），并接收类型化事件 `RestMetricsEvent` / `RestDiagnosticEvent`：失败映射拥有的每条终局路径恰一个低基数 metrics 事件（`operation` 常量；`outcome` 取五值词表；非 2xx/非 abort 终局带稳定 `code`；存在 Response 时带 `status`），diagnostic 至多一个且仅三类 kind（`registry-fatal` / `unknown-exception` / `lease-release-failure`，`cause` 为 exact 对象引用）；4xx/422 problem 族与 403/405 门当前零 metrics 事件（`rejected` 发射策略归后续票）。observer throw 一律隔离，不改变 HTTP 结果。Host 须把 diagnostic observer 视为敏感运维接口，自行负责访问控制、采样与脱敏。
- `router.handle(request)` —— 成功路径 `POST /v1/owners/{ownerUserId}/namespaces` 返回 `201`，body 恰含 `namespaceId` 与 `schema { lang, version, id }`（`sc1-` 内容寻址 ID），不返回 `Location`。已知 path 的非 POST 返回 `405` + `Allow: POST`。Peer 在匹配 raw path/method 后、解析 owner 或读取 body 前返回 `403` + `INSTANCE_ROLE_FORBIDDEN`。
- 非法请求以 **4xx/422 problem Response** 结算（ADR 0015 §错误契约）：400（非法 owner / query / 空 body / malformed JSON / 请求形状 / 数字范围）、413（body / schemaText / JSON depth / JSON nodes 超限）、415（Content-Type / Content-Encoding 不支持）、422（VFSL schema invalid / ROOT invalid）。problem 为固定 JSON 形状，键集 ⊆ `{code, message, issues?, issuesTruncated?}`，`code` 为稳定 UPPER_SNAKE 供客户端分支；`issues` 仅 422 携带且为受控、可 JSON 序列化、有 byte 上限的 REST issue（不返回 schema/root 片段），截断时显式 `issuesTruncated: true`。请求顺序固定：route/method → role gate → owner/query/媒体层检查 → 有界 body 读取（尊重 `Request.signal`）→ 形状/资源检查 → 派生身份 → Registry create。
- Registry 失败映射（ADR 0015 L175–L182，body 为最小 `{"code":…}`）：`REGISTRY_NOT_ACCEPTING` → `503`（明确零提交、可稍后重新请求）；窄 issue `NAMESPACE_CREATE_FAILED`（typed operational）→ `500`；`NamespaceRegistryFatalError` 且 `committed:true` → `500 NAMESPACE_CREATE_OUTCOME_UNKNOWN`（**不得自动重试**）；fatal 且 `committed:false`、unknown exception、内部契约违例（`NAMESPACE_CREATE_INVALID_INPUT` / `NAMESPACE_ALREADY_EXISTS`）→ `500 INTERNAL_ERROR`（后两者上报 diagnostic）。未映射的窄 issue（如 `NAMESPACE_INVALID_IDENTITY`）仍以 `handle` rejection 结算（fail loud），不发明未评审的映射。
- 取消边界：body 读取阶段显式观察 `Request.signal`，中断以有界 `handle` rejection 结算（不伪造 HTTP 状态；固定 message + `signal.reason` 作 `cause`）、metrics `outcome:'aborted'`、Registry 零触达；读取段内 abort 优先于该段任何结局（含 `413`），入口 signal 判定先于任何读取期校验。`Registry.create` 一经调用即不再观察 signal——客户端中断不传播，等待 create settle 并恰一次 release（仍 `201`）。
- 类型面：`RestRouter`、`RestRouterOptions`、`RestRouterLimits`、`RestHandledResult`、`RestMetricsEvent`、`RestDiagnosticEvent`。

**role 单真相（ADR 0012）**：注入的 `role` 值必须由 composition root 从 Instance service（`instanceId + role` 唯一生产来源）读取；本包内零 role 默认值、零独立配置源。

## Lease 语义

成功路径先把 `namespaceId` 与 schema identity 复制为 owned plain DTO，再**恰一次**调用并等待 `lease.release()`；`release()` 失败不改变已知创建事实——仍返回 `201`，且不重复调用。`201` 只表示 Persistence create 已提交、`namespaceId` 可用于后续 `open`，不表示 Runtime P0 ready，也不表示复制已启用。

## Deferred scope

本版已落地：成功路径与 role gate、HTTP/媒体层检查（owner 文法与 percent-encoding、query 拒绝、Content-Type/Content-Encoding）、有界 body 读取与严格 UTF-8/平台 JSON 解析、顶层形状与解析后资源检查、limits 执行（含 `Request.signal` 观察）、4xx/422 problem shape（含 403/405 升级）、Registry 失败映射（503/500 族）与双 observer 事件契约。仍由后续 ticket 叠加：metrics `rejected` outcome 的发射策略（4xx/422 族）、5xx body 的 `message` 字段，以及 server/composition root 的 listener、连接级取消与 graceful drain（#270）。未映射的窄 issue（如 `NAMESPACE_INVALID_IDENTITY`）仍以 `handle` rejection 结算（fail loud），不发明未评审的 HTTP 映射；共享读取 seam 内「abort 优先于 `413`」的不变量由 `src/create-namespace.ts` 锁定（C5 契约）。首版受信环境前提（localhost / 明确受信网络，ADR 0015 L36）针对的是本版不含 authentication/authorization，与 body 读取无关——读取已受 `maxBodyBytes` 有界（stream 始终执行 byte 上限，`Content-Length` 仅作提前拒绝）。

## Verification

```
NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run --typecheck packages/namespace-api/test
pnpm typecheck
```

`test/` 中的契约测试是冻结的验收契约（SA6），不得为迎合实现而修改。
