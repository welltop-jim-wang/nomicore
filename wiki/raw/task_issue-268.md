# MABF Task Brief

Repository: welltop-jim-wang/nomicore
Issue: #268
Title: REST create：请求形状校验、资源 limits 与 4xx/422 错误契约
State: open
Issue updated at: 2026-09-10T22:21:45Z

## Issue body

## Parent

PR #158（docs/rest-namespace-create）

## What to build

在 REST router 骨架上叠加完整的入站校验与资源保护，使 endpoint 达到 ADR 0015 的完整 4xx/422 错误契约：

**HTTP/媒体层**：owner 使用 Registry 既有安全文法（path 中不允许 percent-encoding，非法 400）；首版不接受 query 参数；缺失或不兼容 Content-Type 返回 415（接受 `application/json` 与仅带 `charset=utf-8` 的形式）；Content-Encoding 只接受缺失或 `identity`；CORS/OPTIONS 由外层 server/gateway 截获，否则按方法不匹配处理。

**JSON 处理**：不实现独立 JSON parser——有界收集 body bytes → 严格 UTF-8 解码 → 平台标准 JSON 解析 → 顶层形状与解析后资源检查。重复 key 遵循 last-key-wins；malformed JSON 只返回通用错误（400），不返回源码位置。body 读取用 Content-Length 仅作提前拒绝优化，stream 始终执行 byte 上限。

**形状与领域校验**：顶层必须是非数组 object 且解析后恰有 `schemaText` 与 `root` 两个 own keys；`root` 必须显式提交；`schemaText` 必须是 string（空字符串交给 VFSL 领域校验）；ROOT 领域合法性由 Registry/VFSL 校验（invalid → 422）。

**资源 limits**（默认：body 4 MiB、schemaText 256 KiB UTF-8 bytes、JSON depth 64、nodes 100,000、issues 100 条、单条 message 1,024 UTF-8 bytes、issues 总预算 64 KiB）：Host 可用 Partial 配置覆盖，未知键和越界值构造时 `TypeError`；`maxSchemaTextBytes` 不得大于 `maxBodyBytes`；超限返回 413。depth/nodes/不安全整数检查以迭代方式执行，避免递归栈溢出；REST 不为 `-0` 建立额外语义。

**错误契约**：错误 response 使用固定 problem shape；客户端只按稳定 `code` 分支，message 供人阅读。validation issues 映射为受控、可 JSON 序列化的 REST issue（稳定 code、可选 line/column 或 path、有 byte 上限的安全 message），不返回 schema/root 片段；数量或 byte 预算截断时显式 `issuesTruncated: true`。

## Acceptance criteria

- [ ] 非法 owner / query / 空 body / malformed JSON / 请求形状 / 数字范围 → 400；媒体类型不支持 → 415；输入规模超限 → 413；schema 或 ROOT invalid → 422
- [ ] 全部默认 limits 生效且可被 Host Partial 覆盖，未知键与越界值构造时 TypeError，`maxSchemaTextBytes > maxBodyBytes` 被拒绝
- [ ] depth/nodes 检查为迭代实现，深嵌套输入不触发栈溢出
- [ ] 错误 response 为固定 problem shape，issues 受控安全（不泄露 schema/root 片段），截断时携带 `issuesTruncated: true`
- [ ] REST 不为重复 key、`-0` 建立额外语义；malformed JSON 不返回源码位置

## Blocked by

- #267

## Comments
