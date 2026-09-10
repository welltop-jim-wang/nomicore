# `@nomicore/namespace-api`

Host-agnostic REST adapter for namespace lifecycle endpoints (ADR 0015). The first version exposes only the REST router; create orchestration stays package-private.

`@nomicore/namespace-api/rest` 暴露 `createRestRouter(options)`：一个**普通 Module（不是 Cordis plugin）**，把标准 Web `Request` 映射为判别结果 `{ matched: false } | { matched: true; response }`。它不拥有 listener、authentication、authorization、CORS、TLS、Request ID、全局并发或 graceful drain——这些属于未来 server / composition root（FR-5）。

## Public API

- `createRestRouter({ role, registry, metricsObserver, diagnosticObserver, limits? })` —— 构造时读取、校验、复制并冻结配置；非法配置抛普通 `TypeError`。`limits` 为 Partial 覆盖七项默认值（body 4 MiB / schemaText 256 KiB / JSON depth 64 / JSON nodes 100,000 / issues 100 / 单条 issue message 1,024 UTF-8 bytes / issues 总预算 64 KiB）；**未知键、非正安全整数、以及合并默认后 `maxSchemaTextBytes > maxBodyBytes`** 一律构造时抛普通 `TypeError`。两个同步 void observer 必须显式注入（no-op 也须显式，ADR 0015 L186）；本版不发射事件（事件契约属 FR-4）。
- `router.handle(request)` —— 成功路径 `POST /v1/owners/{ownerUserId}/namespaces` 返回 `201`，body 恰含 `namespaceId` 与 `schema { lang, version, id }`（`sc1-` 内容寻址 ID），不返回 `Location`。已知 path 的非 POST 返回 `405` + `Allow: POST`。Peer 在匹配 raw path/method 后、解析 owner 或读取 body 前返回 `403` + `INSTANCE_ROLE_FORBIDDEN`。
- 非法请求以 **4xx/422 problem Response** 结算（ADR 0015 §错误契约）：400（非法 owner / query / 空 body / malformed JSON / 请求形状 / 数字范围）、413（body / schemaText / JSON depth / JSON nodes 超限）、415（Content-Type / Content-Encoding 不支持）、422（VFSL schema invalid / ROOT invalid）。problem 为固定 JSON 形状，键集 ⊆ `{code, message, issues?, issuesTruncated?}`，`code` 为稳定 UPPER_SNAKE 供客户端分支；`issues` 仅 422 携带且为受控、可 JSON 序列化、有 byte 上限的 REST issue（不返回 schema/root 片段），截断时显式 `issuesTruncated: true`。请求顺序固定：route/method → role gate → owner/query/媒体层检查 → 有界 body 读取（尊重 `Request.signal`）→ 形状/资源检查 → 派生身份 → Registry create。
- 类型面：`RestRouter`、`RestRouterOptions`、`RestRouterLimits`、`RestHandledResult`。

**role 单真相（ADR 0012）**：注入的 `role` 值必须由 composition root 从 Instance service（`instanceId + role` 唯一生产来源）读取；本包内零 role 默认值、零独立配置源。

## Lease 语义

成功路径先把 `namespaceId` 与 schema identity 复制为 owned plain DTO，再**恰一次**调用并等待 `lease.release()`；`release()` 失败不改变已知创建事实——仍返回 `201`，且不重复调用。`201` 只表示 Persistence create 已提交、`namespaceId` 可用于后续 `open`，不表示 Runtime P0 ready，也不表示复制已启用。

## Deferred scope

本版已落地 HTTP/媒体层检查（owner 文法与 percent-encoding、query 拒绝、Content-Type/Content-Encoding）、有界 body 读取与严格 UTF-8/平台 JSON 解析、顶层形状与解析后资源检查、limits 执行与 `Request.signal`、以及 4xx/422 problem shape（含 403/405 升级）。仍由后续 ticket 叠加：503 `REGISTRY_NOT_ACCEPTING`、500 三族（`NAMESPACE_CREATE_FAILED` / `NAMESPACE_CREATE_OUTCOME_UNKNOWN` / `INTERNAL_ERROR`）与 `NAMESPACE_CREATE_INVALID_INPUT` / `NAMESPACE_ALREADY_EXISTS` 的安全 500、observer 事件契约（FR-4）。**剩余未映射结局**（body 读取阶段的 abort、Registry fatal、上述 503/500 族）仍以 `handle` rejection 结算（fail loud），不发明未评审的 HTTP 映射。首版受信环境前提（localhost / 明确受信网络，ADR 0015 L36）针对的是本版不含 authentication/authorization，与 body 读取无关——读取已受 `maxBodyBytes` 有界（stream 始终执行 byte 上限，`Content-Length` 仅作提前拒绝）。

## Verification

```
NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run --typecheck packages/namespace-api/test
pnpm typecheck
```

`test/` 中的契约测试是冻结的验收契约（SA6），不得为迎合实现而修改。
