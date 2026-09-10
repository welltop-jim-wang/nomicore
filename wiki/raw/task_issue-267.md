# MABF Task Brief

Repository: welltop-jim-wang/nomicore
Issue: #267
Title: REST router 骨架：Hub create 成功路径 + Peer role gate + Lease 生命周期
State: open
Issue updated at: 2026-09-10T17:00:20Z

## Issue body

## Parent

PR #158（docs/rest-namespace-create）

## What to build

建立 `@nomicore/namespace-api` 包，REST Adapter 由 `/rest` 子路径暴露，首版只公开 REST router；create 编排保持包内私有。router 是 Host 无关的普通 Module（非 Cordis plugin），使用标准 Web `Request → Response` 接口，以判别结果表达 route 是否匹配；不拥有 listener、authentication、authorization、CORS、TLS、Request ID、全局并发或 graceful drain。配置在构造时读取、校验、复制并冻结，构造配置错误用普通 `TypeError`。

本票交付 `POST /v1/owners/{ownerUserId}/namespaces` 的纵向骨架：Hub 上完整走通 route/method 匹配 → role gate → 派生 schema identity → 组装完整 SCHEMA envelope → `Registry.create({ owner, schema, root })` → 成功 201（恰含 `namespaceId` 与 `schema`（lang/version/id），不返回 `Location`）。Peer 保持相同 route 形状，在匹配 method/raw path 后、解析 owner 或读取 body 前返回 403 + 稳定 code `INSTANCE_ROLE_FORBIDDEN`。新建 namespace 默认 `replication-disabled`。

Lease 语义：成功后先把 namespaceId 与 schema identity 复制为 owned plain DTO，再恰一次调用并等待 `lease.release()`；release 失败不改变已知创建事实——仍返回 201，不重复调用 release。

本票只做成功路径与 role gate；请求形状校验、limits、Registry 失败映射与 observer 契约由后续 ticket 叠加。

## Acceptance criteria

- [ ] Hub 上 POST create 完整走通并返回 201，response 恰含 namespaceId 与 schema identity（`sc1-` id）
- [ ] Peer 在 route 匹配后立即返回 403 + `INSTANCE_ROLE_FORBIDDEN`，不解析 owner、不读取 body
- [ ] 相同 create 契约在 MemoryPersistence 与 FilePersistence 上运行，断言 HTTP 结果、持久化事实、Lease 释放与 Registry 后续 open；不读取 Registry 内部 entry map、Runtime 或 Y.Doc 私有对象
- [ ] success DTO 在 release 前复制；release 恰一次；release 失败仍 201
- [ ] 新建 namespace 为 `replication-disabled`
- [ ] route 大小写敏感，只接受无尾随斜杠的 canonical path；已知 path 的非 POST 方法返回 405 并携带 `Allow: POST`

## Blocked by

- #266

## Comments
