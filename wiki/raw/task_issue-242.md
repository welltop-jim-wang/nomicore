# MABF Task Brief

Repository: welltop-jim-wang/nomicore
Issue: #242
Title: 复制协议：UPDATE_CHUNK codec 与 CAP_CHUNKED_UPDATE 协商（issue #233 切片 1）
State: open
Issue updated at: 2026-09-08T01:15:03Z

## Issue body

## Parent

PR #241（feat/issue-233-chunked-update-base）

## What to build

复制协议获得分块传输的 wire 地基：新增自描述 `UPDATE_CHUNK` 消息（namespaceId / transferId / chunkIndex / chunkCount / totalBytes / bytes）的编解码与 golden vectors；HELLO 协商新增 `CAP_CHUNKED_UPDATE` capability bit（交集生效，envelope version 与 flags 不变）；append-only 注册两个 namespace 错误码（`UPDATE_TRANSFER_VIOLATION`、`UPDATE_TRANSFER_TOO_LARGE`）与一个 RESYNC reason（`UPDATE_TRANSFER_EXPIRED`）。未协商的一端收到 UPDATE_CHUNK 时按既有未知消息码规则响亮关闭连接——新旧实现互不破译。本票只交付协议包能力，不改变任何发送/接收行为。

## Acceptance criteria

- [ ] UPDATE_CHUNK 全字段 golden vectors 提交并锁定（字段顺序以 ADR 0013 为准）；encode/decode canonical roundtrip 通过
- [ ] 逐 byte offset 截断、非 canonical 数值、非法 UTF-8、非法 namespaceId、尾随字节、超声明 count/bytes 全部被 decoder 响亮拒绝，无越界分配
- [ ] HELLO optionalCapabilities/selectedCapabilities 支持 CAP_CHUNKED_UPDATE 交集协商；未协商端收到 UPDATE_CHUNK 按 UNSUPPORTED_MESSAGE_TYPE connection fatal 处理
- [ ] 两个新 namespace 错误码的 scope/fatal/retryable/terminalState 由 registry 单点导出（VIOLATION：fatal/no/failed；TOO_LARGE：fatal/config/failed）；RESYNC reason 词表 append-only 追加
- [ ] 协议包全量测试与 typecheck 绿

## Blocked by

- None (can start immediately)

## Comments

- None. Issue comments were last read via REST at final verification (SA7 dispatch sa-958585a4) and returned `[]` — no owner requirements apply. This matches the empty Comments section captured at task-brief creation and the `[]` REST refreshes recorded in the SA2/SA4/SA9/SA10 review headers.
