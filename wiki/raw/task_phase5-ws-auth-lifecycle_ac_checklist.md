# Acceptance Criteria Checklist — issue #138

| AC# | 描述 | 状态(✅/❌) | 证据 | 处理 |
|---|---|---|---|---|
| AC-1 | Upgrade 前 Bearer 认证与 Peer 解析；无效凭证零协议连接 | ✅ | SA6/SA7 red contract #1–#5; SA7 report Step 1; SA4 review §1 | 已实现并独立验证 |
| AC-2 | HELLO/ACK 绑定认证 Peer、Hub、版本、能力与 nonce，之后才 open | ✅ | Red #1/#6; SA4 review design consistency; SA7 Step 1 21/21 | 已实现并验证 |
| AC-3 | v1 sequence/ACK/timeout/ERROR scope/close-code 契约 | ✅ | Existing #136/#137 regression suite plus red #6/#7 and SA4 review §1 | 既有契约保持，身份/撤销关闭映射新增验证 |
| AC-4 | 深层 Hub authorization，revoke/reauth 仅关闭所需 scope | ✅ | Red #1/#7/#8; SA4 review D3; SA7 Step 1 | revoke 实现并独立验证 |
| AC-5 | 注入 scheduler/random 的 full-jitter、blocked、stable reset、GOAWAY retry | ✅ | Red #9/A2-a/A2-c; SA4 review D4; SA7 report Step 1/2 | 已实现并动态验证 |
| AC-6 | GOAWAY 停新 open、排空已接纳 apply、不无限等待网络 ACK、按序关闭 | ✅ | Red #9/#10/A2-b; SA7 TCP order test D4; SA4 review D5 | 已实现并真实 TCP 验证 |
| AC-7 | 日志/observer 不泄露 token、owner、Yjs、SCHEMA/ROOT、causes/高基数标签 | ✅ | Red #1/#6; SA4 AC-7/security review; SA7 D2 static transport-boundary confirmation | 无新增泄露面 |

## Gate decision

All seven acceptance criteria have direct implementation, test, and independent SA4/SA7 evidence. **Pass.**
