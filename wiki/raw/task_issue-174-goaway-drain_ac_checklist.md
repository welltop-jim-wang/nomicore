# Issue #174 Acceptance Criteria Checklist

| AC# | 描述 | 状态(✅/❌) | 证据 | 处理 |
|---|---|---|---|---|
| 1 | Hub shutdown 首先停止接纳新连接、新 namespace OPEN 和新 sync round。 | ✅ | SA7 report §2.4 S3 confirms one GOAWAY/no duplicate drain; SA6 R3 contract green; SA4 review L14 confirms OPEN→ERROR and SYNC_STEP1 drop. | Implemented and independently reviewed. |
| 2 | GOAWAY 在 transport close 之前发送，且 peer 可观测。 | ✅ | SA6 R1 contract green; SA7 report L23 and L73 D4 real TCP confirms GOAWAY then 1001 close. | Verified by SA7. |
| 3 | deadline 前允许已接纳的 namespace apply 排空和自然收口。 | ✅ | SA6 R2/R4 green; SA7 report L56–65 S2 verifies close handshake and apply behavior through deadline. | Verified by SA7. |
| 4 | 不等待未完成的网络 ACK 超过 drain deadline。 | ✅ | SA6 R1/R4 green; SA7 S2 report L61–65 observes 1001 at deadline while Runtime apply remains pending. | Verified by SA7. |
| 5 | drain 完成或 deadline 到达后，以 WS 1001 关闭 transport。 | ✅ | SA6 R1/R2 green; SA7 report L62 and L69 observes deadline and early-close 1001 outcomes. | Verified by SA7. |
| 6 | session close、lease release 与 transport close 顺序符合 v1 协议。 | ✅ | SA4 review L20 validates protocol §21 natural/deadline paths; SA6 R2 green covers CLOSE→CLOSE_OK/natural closure. | Static + dynamic evidence accepted. |
| 7 | 增加动态测试，覆盖 pending apply、GOAWAY 可见性、deadline、提前完成和迟到回调。 | ✅ | Issue174 red contract has R1–R4; SA7 added dynamic S1–S3. SA7 report L23, L46–69; 7 new tests all green. | Tests collected by vitest. |
| 8 | Node 20/24 CI、typecheck 和 ws-replication 全量测试通过。 | ✅ (local) | SA7 report L83–91: 26 files/182 tests, Type Errors none; SA3/SA4 typecheck pass. CI Node 20/24 pending Host publication and is not locally observable. | Local completion evidence complete; Host will publish/observe CI. |
