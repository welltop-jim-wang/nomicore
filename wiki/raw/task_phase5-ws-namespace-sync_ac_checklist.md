# AC 逐条确认清单 — issue #136（Phase 5: synchronize one namespace over WebSocket）

- run_id: issue-136-1787888033-8367 / round: 1
- 核对时间：2026-08-28 18:2x（评审双清后：SA4 R3 pass + SA7 R2 pass）
- 验证基线：总控亲跑 `pnpm typecheck && pnpm test` → 163 文件 / 1945 测试全绿、零类型错误、exit 0（.mabf-bg/verify3.log）

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC1 | Peer target 含 namespaceId + Peer-local owner；Hub 授权结果提供独立 Hub-local owner 与 read/submit 权限 | ✅ | `ws-replication-ac1-ac2-open.test.ts`：幸福路径（wire 永不携带 owner；HUB_OWNER 独立于 localOwner）、AC1 提交权限（submit:false → Hub 拒 UPDATE 零写入零 ACK 零泄漏）、AC1 幂等 addTarget/removeTarget；契约类型面 `ws-replication-api.test-d.ts`（ReplicationTarget{namespaceId,localOwner} / NamespaceAuthorizer §19 形状） | 实现 packages/ws-replication（24642a9） |
| AC2 | OPEN 正确选择 bootstrap/reconcile；拒绝未授权/缺失/禁用/谱系不符/epoch 不符且不泄露 owner | ✅ | 同文件：AC2 未授权（含缺失不泄露存在性）/缺失/禁用/谱系不符→conflicted 不覆盖/epoch 不符→conflicted/读权限缺失/重复 OPEN 合流/closed·conflicted 后重开拒绝/未知 target TARGET_NOT_REQUESTED；mode 选择见 ac3（mode 0 bootstrap）与 ac4（mode 1 reconcile）幸福路径 | 同上 |
| AC3 | Bootstrap 单帧有界全快照、排他导入、安装确认、随后强制双向 reconcile | ✅ | `ws-replication-ac3-bootstrap.test.ts`：完整链路（恰一帧 BOOTSTRAP_SNAPSHOT → BOOTSTRAP_ACK → 立即 round 1）/超限 TOO_LARGE 不分块/并发 duplicate BOOTSTRAP_FAILED 不覆盖既有副本/bootstrap timeout 收口 | 同上 |
| AC4 | Peer 发起的 sync round 须双方向 Step2 apply + SYNC_APPLIED 才进 live | ✅ | `ws-replication-ac4-reconcile.test.ts`：幸福路径双方向 Step1/Step2/Applied 后 live/缺一 SYNC_APPLIED 不进 live + timeout failed/错序 STEP2→SYNC_STATE_VIOLATION/重复 Step1→SYNC_STATE_VIOLATION/空 diff 完整流程进 live | 同上 |
| AC5 | Live UPDATE/UPDATE_ACK 语义符合协议；每个远端 update 经 ReplicationSession 排序 + dirty 通知 | ✅ | `ws-replication-ac5-live.test.ts`：UPDATE→单槽 apply+dirty→ACK(ackedSequence)/saveDoc 门闩时序锚（ACK 只在 sequenced apply+dirty 后发出）/单 observer 多 session fan-out/滑动窗口抑制/重复 update 幂等 ACK/ACK_STATE_VIOLATION fatal/UPDATE_TOO_LARGE 零写入 | 同上 |
| AC6 | RESYNC_REQUIRED、ACK timeout、正常 close、终态 ERROR、身份变更、断线、重连全部到达指定 namespace 状态，无 durable outbox | ✅ | `ws-replication-ac6-resync-close.test.ts` 7 用例（RESYNC 溢出恢复/ACK timeout 不重发跨连接收敛/正常 close CLOSE_OK/terminal ERROR→failed/IDENTITY_CHANGED→conflicted/socket 断开 disconnected 无 outbox + 重连 round 修复/bootstrap 中断线重连重新 bootstrap）；+ `ws-replication-sa4-f1-f2-f3-red.test.ts` F1（hub 溢出 RESYNC 同连接收敛）/F2（重连 open 超时兜底 failed）；+ r3-r4 ②⑧（bump 竞态确定性 conflicted） | 实现 + SA4 回流修复（ade002c） |
| AC7 | Fake-duplex 确定性测试覆盖完整 namespace 与 sync 状态机、错序帧、重复控制、apply 失败、degraded、cleanup 竞态 | ✅ | `ws-replication-ac7-faults.test.ts` 12 用例（错序 OPEN 前 UPDATE/重复 SYNC_APPLIED/不可解码 update→APPLY_FAILED 零写入/degraded 双侧/cleanup 竞态×2/合流/§17 构造校验/§20 保护检查×2/错误 round）+ r3-r4-regressions 11 用例 + sa7-dynamic 4 用例（W1/W2/G1/G2）；fake-duplex 内存双端 + 全虚拟时间，零 real sleep；合计 74 IT | 同上 + SA7 补充（f175e3e） |

## 结论

7/7 AC 全部 ✅，每条均有可执行测试证据（文件/用例级）+ 总控亲跑全绿证据 + SA4/SA7 双清 verdict。无 ❌ 条目，无总控亲自处理项。
