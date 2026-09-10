# `@nomicore/namespace-api`

Host-agnostic REST adapter for namespace lifecycle endpoints (ADR 0015). The first version exposes only the REST router; create orchestration stays package-private.

`@nomicore/namespace-api/rest` 暴露 `createRestRouter(options)`：一个**普通 Module（不是 Cordis plugin）**，把标准 Web `Request` 映射为判别结果 `{ matched: false } | { matched: true; response }`。它不拥有 listener、authentication、authorization、CORS、TLS、Request ID、全局并发或 graceful drain——这些属于未来 server / composition root（FR-5）。

## Public API

- `createRestRouter({ role, registry, metricsObserver, diagnosticObserver, limits? })` —— 构造时读取、校验、复制并冻结配置；非法配置抛普通 `TypeError`。两个同步 void observer 必须显式注入（no-op 也须显式，ADR 0015 L186）；本版不发射事件（事件契约属 FR-4）。
- `router.handle(request)` —— 成功路径 `POST /v1/owners/{ownerUserId}/namespaces` 返回 `201`，body 恰含 `namespaceId` 与 `schema { lang, version, id }`（`sc1-` 内容寻址 ID），不返回 `Location`。已知 path 的非 POST 返回 `405` + `Allow: POST`。Peer 在匹配 raw path/method 后、解析 owner 或读取 body 前返回 `403` + `INSTANCE_ROLE_FORBIDDEN`。
- 类型面：`RestRouter`、`RestRouterOptions`、`RestRouterLimits`、`RestHandledResult`。

**role 单真相（ADR 0012）**：注入的 `role` 值必须由 composition root 从 Instance service（`instanceId + role` 唯一生产来源）读取；本包内零 role 默认值、零独立配置源。

## Lease 语义

成功路径先把 `namespaceId` 与 schema identity 复制为 owned plain DTO，再**恰一次**调用并等待 `lease.release()`；`release()` 失败不改变已知创建事实——仍返回 `201`，且不重复调用。`201` 只表示 Persistence create 已提交、`namespaceId` 可用于后续 `open`，不表示 Runtime P0 ready，也不表示复制已启用。

## Deferred scope

本版只做成功路径与 role gate。请求形状校验（owner 文法 / percent-encoding / query / Content-Type / Encoding / body 上限）、limits 执行与 `Request.signal`、Registry 失败映射与 problem shape、observer 事件契约均由后续 ticket 叠加。**未映射结局一律以 `handle` rejection 结算（fail loud），不发明任何 HTTP 错误 Response**——后续错误契约票以 Response 替换 rejection 是纯加法。首版受信环境前提（localhost / 明确受信网络）仍适用，body 读取暂未设上限。

## Verification

```
NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run --typecheck packages/namespace-api/test
pnpm typecheck
```

`test/` 中的契约测试是冻结的验收契约（SA6），不得为迎合实现而修改。
