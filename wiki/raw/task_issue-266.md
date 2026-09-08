# MABF Task Brief

Repository: welltop-jim-wang/nomicore
Issue: #266
Title: VFSL 内容寻址 schema ID（sc1-）：窄派生接口与 envelope 校验
State: open
Issue updated at: 2026-09-08T14:20:37Z

## Issue body

## Parent

PR #158（docs/rest-namespace-create）

## What to build

`@nomicore/vfsl` 新增窄 Module interface：输入 VFSL text（lang=vfsl、version=1），复用现有编译 pipeline 返回 semantic fingerprint 与内容寻址 schema ID，或 VFSL issues。接口不接收 provisional envelope ID，不暴露 IR、派生 schema 或 validator；它不是 REST endpoint。

schema ID 格式冻结为 `sc1-` + 52 位小写 RFC 4648 Base32（无 padding），payload 是 semantic fingerprint 的完整 256-bit SHA-256 digest，不截断。空白与普通注释不改变 ID，JSDoc、声明顺序及其他 VFSL 语义变化会改变 ID。

同时扩展完整 envelope 编译：任何使用 `sc1-` 前缀的输入 envelope 必须验证 canonical 格式及其与 text semantic fingerprint 的精确匹配；格式错误与语义不匹配各使用一个稳定 VFSL issue code（编号由实施时按错误注册表分配）。旧式 SCHEMA id 继续兼容。

## Acceptance criteria

- [ ] 窄接口可从 VFSL text 确定性派生 semantic fingerprint 与 `sc1-` schema ID，或返回 VFSL issues
- [ ] schema ID 为完整 256-bit SHA-256 digest 的 52 位小写 Base32 表示，与 `sha256:v1:<64 lowercase hex>` 携带相同 digest 信息
- [ ] 包级契约测试覆盖：fingerprint 与 `sc1-` 一一重编码、空白/普通注释稳定、JSDoc 变化改变 ID、canonical Base32、旧 ID 兼容、`sc1-` 格式错误与语义不匹配各产生稳定 issue code
- [ ] 接口不暴露 IR、派生 schema、validator，不接受 provisional envelope ID

## Blocked by

- None (can start immediately)

## Comments
