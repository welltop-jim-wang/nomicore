# SA10 Spec 符合性评审 — issue #245：ws-replication 分块传输 observer 事件（issue #233 切片 4）

- Dispatch：`sa-aa6a732b-85a2-4ec6-8094-57cfa41c7bb2`（mabf-sa10 / spec-review / iteration 0）
- 评审对象：committed HEAD `a7c1add7b06c6023d84a674e73df4cec0f99fa05`（`feat(ws-replication): observe chunked update lifecycle`）
- 父基线：PR #241 head `feat/issue-233-chunked-update-base` @ `733b3a757f37459838bd88bf7952b7215540a1d9`——`git merge-base --is-ancestor` 实测为 HEAD 直系祖先（HEAD~1）
- Owner 评论：`GET /issues/245/comments` 本轮复核 = `[]`（长度 0）——零 owner 评论要求需并入，与简报/SA6 §2/SA8 两门禁/SA2/SA4 五方一致
- 方法说明：SA10 权限内**不重跑测试、不启动服务**——运行证据以 SA3 验证日志（`artifacts/sa3-issue245-verify.log` (a)–(h)）与 SA4 独立重跑（`wiki/raw/task_issue-245_sa4_review.md` §4，两轮逐名一致、零漂移）为据；本轮全部结论以 HEAD 逐 hunk diff 审读 + 源码/测试/文档现文本结构性核验独立做出。

## 1. Verdict

**approve** —— 六条 AC 全部满足且各有可执行验收锚；SA6 契约（R1–R5/N1–N5）与批准设计（iteration 1，SA2 approve）的裁决面逐项吻合；observer safety、throw 等价、互斥第四形态、abort 覆盖、§23.7 时钟折叠五个聚焦面均闭合。0 × BLOCKER / 0 × MAJOR；1 × MINOR 披露项（D1 = SA4 F1 契约脚手架 facilitation 的 SA6 追认治理债，非 AC 缺口、非弱化——PR 必须披露）。

## 2. 逐 AC 符合性核验

| AC | 判定 | 证据（HEAD 现文本，行号为本轮实读） |
|---|---|---|
| **AC1** 四型键集冻结 + 白名单断言 + safe-field 深扫 | **满足** | (a) 类型面：`types.ts` L686–742 append-only 第 24–26 型，域键集与 ADR 0013 L89–91 **逐字零差集**（sent = type/side/connectionId?/namespaceId/transferId/chunkCount/totalBytes；applied = …/bytes/chunkCount/applyLatencyMs?；acked = …/bytes/ackLatencyMs?）；第 23 型 aborted（#244 交付）零 diff 保持。(b) 白名单断言：§23.7 正典 `ws-replication-observer-red.test.ts` T9 `ALLOWED_KEYS` +3 行（键集逐字），矩阵 chunked 腿 `waitFor` 三型齐备（非死行自证）+ `expectedTypes` 追加三型；aborted 不入矩阵白名单 = R26/DD0 批准裁定（其键集冻结由契约 N4 `ABORTED_KEYS` exact-keyset + #244 SA7 动态面承担——见 §5 注 1）。(c) 冻结断言：契约 `SENT/APPLIED/ACKED_KEYS`（L174–176）在 R1/R2/R3/R4/R5 共 8 处 `expectKeysExactly`。(d) safe-field 深扫：契约 `sweepEvent`（L525–544：零 Uint8Array/ArrayBuffer/DataView/Error、仅 primitive/普通对象/数组）+ `assertNoSentinels`（L551–562：JSON.stringify 哨兵扫描——TEST_TOKEN/SCHEMA 文本/内容前缀/schema id），N1/N4/N5 全事件面调用；§23.7 `assertSafe` 对矩阵全事件（含三新腿）同构深扫。 |
| **AC2** observer 每事件必 throw ⇒ wire 帧序列/终态/文档内容/apply 结算逐字节全等 | **满足** | (a) 隔离机制零改动：`observer.ts` 不在 diff 中——`dispatchReplicationObserver` try/catch 静默吞（L34–44）单点沿用；三新发射点全部经 `host.emitObserver`。(b) 决策落定后发射：sent = `inFlight.set` 后、`armAckTimer` 前（update-channel.ts L450–464 实读）；acked = `inFlight.delete` + timer 重挂后、`requestDataDrain` 前（onAck L192–215）；applied = apply 结算 `observerOn` 块内、`UPDATE_ACK` 发送之前（hub L1234–1246/1253–1259、peer L1467–1480/1490–1497 实读）。(c) 契约 N3：基线（无 observer）vs 破坏（每事件必 throw）双 fixture——wire kind#seq 摘要双向全等 + 终态 live/ready + 文档内容 + dirty 计数全等 + 零 ERROR。「逐字节」按 §23.7 惯例归一为 kind#seq 语义摘要（Yjs payload 含随机 doc client id，跨运行逐字节不可比——SA6 §9 对照 5 批准口径，见 §5 注 2）。 |
| **AC3** 无 observer 零事件/零投影/零时钟；latency 两态 | **满足** | (a) 零事件：facet 分支首行 `if (!this.observerOn) return;`（hub L1063/L1094、peer L1278/L1310 实读——chunked 分支在门内）；apply 发射在 `observerOn` 块内。(b) 零投影：chunked 字段源 = 通道/assembler 既有记账（`activeTransfer`/inFlight/declaredChunkCount），无新增 live 读取；`degradedBypassActive()` 仅 peer observerOn 块内调用（L1431）；连接层时钟门控零 diff（`hub-connection.ts:543`/`peer-connection.ts:166`：`now` 在无 observer 时恒 undefined、不触 clock）。(c) 零时钟：t0 采样 `observerOn ? host.now?.() : undefined` 双侧同构（hub L1171/peer L1389）；契约 N2 计数时钟全程 0 调用（含 stop 收口）。(d) 两态：latency 键条件附着展开（`...(x !== undefined ? {k:x} : {})`）——无 clock 整键缺失（非 undefined 值），契约 R1–R4 exact-keyset 锁缺场态、R5 锁在场 ≥ 0；§23.7 T12 (d-i)/(d-ii) 两腿为正典证据（见 AC6 行）。末 chunk 无条件构造 `chunked{transferId,chunkCount}` 组 = 常驻标量 O(1) 对象，设计 §9.2 明文裁定非采样（批准面）。 |
| **AC4** 互斥第四形态（每笔成功 apply 恰一事件） | **满足** | (a) 判别全序实读：peer = degraded（外层先行，L1431–1443）→ isStep2 → chunked（L1467）→ update；hub = isStep2 → chunked（L1234）→ update（hub 结构性无 degraded——L1167 注释在库）。`isStep2 ∧ chunked` 结构性不可达：调用点穷举实测双侧各 3 处（hub L661/L751/L1131、peer L637/L733/L1347），仅 handleAssemblerResult 'complete' 传第 5 参（传 false + chunked），applyStep2 传 true 不传第 5 参——两入口不相交。(b) chunked 分支独立字段组、不展开 base（零 sequence/stages 泄漏——DD1）。(c) 契约锚：R2（窗口恰一 apply-form 增量 + chunked-update-applied 恰一 + update-applied 增量归零）、N5（degraded 窗口恰一增量 = degraded-bypass-applied 胜出 + 零双发）；协议 L727–729 三选一→四选一已同步（含 isStep2∧chunked 不可达注记）。 |
| **AC5** aborted reason 闭集 ↔ 切片 3 全部中止路径一一对应 + 计数不变量 | **满足（保持面，零改动 + 回归锚）** | (a) 生产面零 diff：第 23 型类型/双侧发射点/busy 守卫/六 reason 接线均不在 HEAD diff 中（DD0/R20 遵守）；协议 aborted 行唯一改动 = 尾句「#245 计划项」→「已由 issue #245 落地」措辞清理（R24 授权），接线行逐字不变。(b) 闭集对应：`ChunkedUpdateAbortReason` 六值（timeout/shed/resync-declared/channel-teardown/connection-teardown/epoch-fence）与中止矩阵一一平行（协议行逐项列示接线）；契约 N4（resync-declared 确定性构型）断言 aborted 恰一 + ABORTED_KEYS 逐字（含 receivedChunks/receivedBytes = 实收进度）+ reason ∈ 闭集 + 零成功型 + 零部分写入/零 durable + 残渣良性零 VIOLATION。(c) 计数不变量：busy 守卫每笔中止恰一（#244 交付面）；zombie 迟到 ACK 先于 `onUpdateAcked` 返回（onAck L217–220）——弃置 transfer 零 acked，中止与成功三型互斥成立。 |
| **AC6** §23.7 conformance 增补（事件矩阵 key-set 冻结 + 时钟折叠策略） | **满足（两具名子项均在正典文件内可执行）** | (a) 矩阵子项：`ws-replication-observer-red.test.ts` T9——`ALLOWED_KEYS` +3 行（L1238–1243）、数值有限非负键清单 +transferId/chunkCount/totalBytes（L1288–1290）、`observedBoot` + chunked 选项（协商位 opt-in + 8KiB 限）、矩阵腿真实激发三型（`waitFor` sent/acked/applied 齐备，L1359–1370）+ `expectedTypes` +3（L1385–1388）——非死行；R26 纪律遵守：chunked 腿位于 GOAWAY 注入/wire close 1006/stop 收口相位**之前**收敛（diff 行序实证）。(b) 时钟折叠子项（F1 修订升格必交付）：T12「注入 clock」用例分块腿 (d-i)——saveGate 门闩确定性，`applyLatencyMs`/`ackLatencyMs` 在场（`in === true`）、有限、≥ 0 且 = 25，sent 键集恒无 latency 键（两个 `in === false`）；T12「无 clock」用例分块腿 (d-ii)——三 chunked 型仍发 + 两 latency 键整键缺失（`in === false`）。两腿均在 §23.7 正典文件 T12 describe 内——未以契约文件替代 AC 指名位置（F1 教训核验通过）。协议 §23.7 增补文本与实现同变更落地（R24/R28：三新行显式携带「普通族事件归零（改道）」措辞）。 |

## 3. SA6 契约符合性

- 契约文件 `ws-replication-issue245-ac-red.test.ts`（1053 行现文本逐节实读）：R1–R5 红断言面（恰一计数 + exact-keyset + 字段=wire 申报 + 普通族归零 + sent 先于 acked + 方向镜像 side 双侧 + clock 在场 ≥ 0）与 N1–N5 负控面（普通族逐字不变/零时钟含收口/throw 等价/aborted 冻结/degraded×chunked 互斥）全部在库且与 SA6 §12 表逐条对应；SA3 日志 (c)(d) 与 SA4 §4 独立重跑：契约 10/10 绿、焦点七套件 117/117 绿。
- 转绿假设（契约 §12：三处改道、键集按 ADR L89–91、latency 两态、普通族仅剩非分块路径）与实现逐点吻合；契约未锁实现形态，实现 Option A（条件字段组）属契约许可自由度。
- **披露项 D1（= SA4 F1，MINOR/流程债）**：SA3 修改了 DENY 冻结的契约文件两处**脚手架锚**（R3 等待锚 L917–921：普通族 `update-acked` → `chunked-update-acked`；N5 全型零断言 L800–813 收窄为目标语义 + 新增 hub 侧 sent/acked 恰一正断言）。SA4 红队核验结论（本轮抽查复核一致）：结构性被迫（旧锚断言目标世界结构性不存在的事件，不改即 R3 永不转绿/N5 与同文件 R4 结构性互斥）、断言零弱化（验收断言原样保留且 N5 反向增强）、反向仍红（等待预算耗尽即响亮红，非造假方向）。代码内注释自曝 + SA3 日志 §6 披露在库。**残余治理债：SA6 追认（ratification）产物尚未在库**——按 `task_228_sa6_f1_ratification.md` 先例回流 SA6 或由总控派契约修订 dispatch；PR 描述必须披露该两处 facilitation 与追认状态。此为流程债，非 AC 缺口，不阻断 approve。

## 4. 批准设计（iteration 1）裁决面逐项对照

| 裁决 | 实现核验 |
|---|---|
| DD0 aborted 保持面 | 生产零 diff（见 AC5 行） ✓ |
| DD1 键集 = ADR L89–91 逐字 + §23 信封；无 sequence/四段差值/效果组/sendQueueMs；sent 恒无 latency | types.ts/契约键集/白名单三方一致；K1 与 T12(d-i) 均有 `sequence`/`latency` 键缺席负断言 ✓ |
| DD2 degraded 胜出（全序） | peer 外层 degraded 先行实读（L1431）；N5 锚 ✓ |
| DD3 Option A 条件字段组；R27 定死 | `noteUpdateSent`/`onUpdateAcked` 信息可选 `chunked` 组/标记；末 chunk 分支 `sendQueueMs` 死代码已删、`sentAt` 保留；普通路径 `sendAndRegister` 零 diff（N1/N3 锚绿——SA3/SA4 日志） ✓ |
| DD4 assembler complete 携带 chunkCount | `completeIfExact` reset 前捕获 `declaredChunkCount`（L175–181 实读；complete 仅在首 chunk 校验后可达，字段恒已赋值）；Σbytes === totalBytes 不变量保持 ✓ |
| DD5 第 5 可选参 + 唯一新调用点 | 调用点穷举实测（§AC4 行） ✓ |
| DD6 发射位置 = 决策落定后 | 三处实读（§AC2 行） ✓ |
| R20–R25（SA8 前置门禁） | R20/R21/R22/R23 见上；R24 文档同步已落地（§23.1 23→26 + 三行登记含改道归零措辞 + aborted 行尾句清理 + 互斥四选一 + §23.7 增补）；R25 条件项维持（ADR 0013 文本零 diff、状态「提议」未动） ✓ |
| R26–R28（设计后复审注意项） | R26 矩阵腿收口前收敛（行序实证）；R27 删除态定死；R28 措辞已入协议三新行 ✓ |
| SA2 F1 修订（AC6 时钟折叠必交付） | (d-i)/(d-ii) 两腿在正典文件内存在（见 AC6 行） ✓ |

## 5. 解释口径记录（批准面，非缺口）

1. **AC1「四个新事件类型…白名单断言」的 approved 映射**：三成功型入 §23.7 `ALLOWED_KEYS`；第四型 aborted 按 R26/DD0/SA6 §3 R20 裁定**不入矩阵白名单**（矩阵无中止场景；`assertSafe` 对无白名单类型响亮红——若未来矩阵覆盖收口后在途中止须同步补行），其键集冻结/闭集/恰一断言由契约 N4 + #244 SA7 动态套件承担。该解释为 SA6/SA1/SA2/SA8 四方批准的口径。
2. **AC2「逐字节全等」的归一**：wire 等价以 kind#seq 语义摘要 + 终态/内容/结算全等判定（Yjs payload 含随机 doc client id，跨运行逐字节不可比）——§23.7 惯例，SA6 §9 对照 5 批准。

## 6. 范围与 scope creep 核验

- HEAD diff 全量 18 文件：src 5（types/update-channel/update-transfer/hub-namespace/peer-namespace）+ test 4（契约 facilitation + K1 授权翻转 + observer-red §23.7 增补 + api 型断言）+ 协议 1 + wiki/artifacts 产物 7——生产/测试/文档面 ⊆ 设计 §11 ALLOW LIST。
- DENY 面零 diff（本轮 `git diff --stat` 逐项核验为空）：`replication-protocol/**`、`hub/peer-connection.ts`、`docs/adr/**`、`src/index.ts`/`testing.ts`、`harness.ts`、#244/#239 等冻结套件、`ws-replication-issue243-sa7-dynamic.test.ts`（S1 fake host 形状兼容零改动）。
- 唯一 DENY 越界 = 契约文件两处脚手架锚（D1，已披露）；零 wire 变化、零公共 API 新符号、零状态机/窗口/背压改动——无 scope creep。

## 7. PR 必须披露的未达成/债务项

1. **D1（MINOR）**：契约文件两处脚手架 facilitation 的 SA6 追认（ratification）尚未落库——治理债未清偿，非验收缺口（SA4 裁定：结构性被迫、零弱化、反向仍红）。
2. **R25 条件项（非阻断）**：ADR 0013 维持「提议」、父 PR #241 OPEN——若 #241 observer seam 表方向性返工，本实现连同设计/契约须复审。
3. **Follow-up（设计 §13 批准记录，非本任务必要条件）**：chunked 族的帧级关联键（`sequence`）与效果字段扩展 = append-only 键追加，须显式设计裁决 + §23.1 登记 + SA6 契约修订 dispatch——本切片按 DD1 明确不做。

## 8. 证据链（本轮实读 + 上游两轮独立运行一致）

- SA3 日志 (a)–(h)：契约 5 红 → 10/10 绿（×5 次一致）、焦点七套件 117 绿、全包 64 文件 472 绿、根 302 文件 3235 绿、包 tsc + 根 typecheck exit 0。
- SA4 §4 独立重跑：契约 10/10、observer-red 32/32（T9 矩阵 chunked 腿 + T12 (d-i)/(d-ii) 逐名核验）、全包 472、根 3235、`git diff --check` 零空白——与 SA3 逐项一致零漂移。
- 本轮（SA10）：18 文件 diff 逐 hunk 审读；AC1–AC6 锚点源码/测试/文档现文本核验（上文行号）；ADR 0013 L89–91 键集逐字比对；调用点穷举；DENY 面零 diff 核验；issue comments REST = `[]` 复核；ancestor 关系实测。SA10 权限内不重跑测试——运行面采信上述两轮一致证据。

## 附：artifactPaths（worktree-relative）

1. `wiki/raw/task_issue-245_sa10_spec.md` —— 本报告。
