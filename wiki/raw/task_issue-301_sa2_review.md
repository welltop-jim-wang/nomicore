# SA2 设计攻击评审 — issue #301（#295 切片 3）：分块 snapshot/sync 的 observer 8 型接线

- **dispatch**: sa-694fcf7d-e4fe-4f16-8897-27cd0da46051（mabf-sa2 / design-review / iteration 0）
- **被审对象**: `wiki/raw/task_issue-301_design.md`（SA1 iteration 0，OD1–OD9）
- **裁决**: **approve**（无 BLOCKER / 无 MAJOR；3 条 MINOR 观察不阻断）
- **基线**: `0f3eca5`（与设计/SA6/SA8 声明一致）

---

## 1. Reviewed inputs

| 输入 | 状态 | 用途 |
|---|---|---|
| `wiki/raw/task_issue-301.md` | 实读 | 任务简报（AC1–AC5；comments 空） |
| `wiki/raw/task_issue-301_design.md` | 实读 | 被审设计（§1–§15） |
| `wiki/raw/task_issue-301_sa6_contract.md` | 实读 | 验收契约（approve；8 红 R1–R8 + 9 负控 N1–N9） |
| `wiki/raw/task_issue-301_design_conflict_report.md` | 实读 | **SA8 设计后冲突复查（设计 §15 请求的兑付；verdict `clear`）**——在设计之后产出（02:19 > 02:11），设计头部的「SA8 产物缺失」登记在当时属实 |
| `packages/ws-replication/src/{types,bulk-transfer,hub-namespace,peer-namespace,round-engine,observer,update-transfer}.ts`、`hub-connection.ts`/`peer-connection.ts`（now/emitObserver seam） | 实读 | 逐锚点核验设计 §5 现状声明（见 §6） |
| `packages/ws-replication/test/ws-replication-issue301-chunked-completeness-ac-red.test.ts` | 实读（R1/R2/R5/R7/R8 断言体 + 17 用例清单） | 契约断言与 OD1 字段集逐字段对照 |
| `packages/ws-replication/test/ws-replication-api.test-d.ts`（L240–279 镜像）、`ws-replication-observer-red.test.ts`（assertSafe/ALLOWED_KEYS/limits）、issue300 两文件（事件断言面） | 实读 | 回归风险面独立核验 |
| `apps/yjs-server/src/fatal-policy.ts`（外部 `ReplicationObserverEvent` 消费者） | 实读 | 公共联合加性变更的穷尽消费者排查 |
| `docs/protocols/instance-replication-v1.md` §22/§23.1–23.4/§23.7、`docs/adr/0022-chunked-sync-transfer.md` L72–83 | 实读 | 冻结字段集/side 信封/键集排除/纪律条款逐字比对 |
| `packages/ws-replication/AGENTS.md`（dispatch 附带） | 实读 | 模块契约（导出面、observer 隔离、验证门） |
| `wiki/raw/task_issue-301_relevant_decisions.md` / `_conflict_report.md` | 不存在 | 前置 SA8 门禁缺失——设计 §4 已如实登记替代约束源，且 SA8 设计后报告已补位裁决（clear） |

## 2. Verdict

**approve。** 设计是纯观测面接线（零 wire/状态机/生命周期改动），8 型事件字段集、side 信封、键集排除、计数不变量与协议 §23.1 第 29–36 型冻结行**逐字一致**（本评审独立逐行比对，非仅采信 SA8 D1）；全部发射点落在既有结算结构上（源码锚点全部实测相符）；状态机/并发/错误路径攻击未发现可实现入缺陷；文件范围完整且 DENY 自洽；验收映射与 SA6 契约一一对应。SA8 设计后冲突复查（clear）与设计读法一致，本评审独立复核 OD7/OD3 两处解释决策后**未发现新的 ADR 冲突风险**。

## 3. 需求覆盖

| Requirement | Design section | Assessment |
|---|---|---|
| AC1（chunk 丢失/重复/错序/超时/close/GOAWAY/断线/epoch fence 矩阵 + 零 durable 残留） | §1 非目标「零 wire 变化」+ §3（生命周期面已由 slice 2 交付）+ §12（N1–N9/R3/R4/R5/R8 保持绿/转绿） | **覆盖**。SA6 §6/§11 + E3/E4 实测证明生命周期/丢弃面已交付且被 9 条负控锁绿；本票在观测面补齐 aborted 可见性（R3/R4/R5/R8 红半），不重复实现。issue「chunk 丢失」的忠实模型（尾部停滞→超时 / 序列缺口→SEQUENCE_VIOLATION）与 SA6 E5 裁决一致 |
| AC2（超时两向收口） | §3（kind=1 终局族行）+ OD7 + §12（N1 + R5 绿半） | **覆盖**。两向收口为既有实现（§5.3 实测锚点），本票只决定 kind=1 超时的 aborted 缺席（OD7，§23.1 L783 直接读法，SA8 D5 裁定 no-conflict，本评审复核 §18 L628 一致） |
| AC3（恶意声明不致无界分配） | §1 非目标 + §12（N5 保持绿） | **覆盖**（负控锁绿即回归门；分配前校验为 slice 2 已交付面） |
| AC4（多 ns 公平调度 + control reserve） | §1 非目标 + §9.3（N8 零改动）+ §12（N8） | **覆盖**。观测发射不进调度路径（per-controller 内存字段/同步回调） |
| AC5（observer 8 型：发射点、改道归零、互斥、safe-field/secret-free/throw isolation） | OD1–OD9 + §12（R1–R8 + N6/N7） | **覆盖**。8 型字段集/side 逐字 = §23.1 L749–754/L783–784；发射点接线结构（结算记录/settle 返回值/form 参数化/kind 选路）与源码现状锚点一一对应 |
| 非目标边界（互通矩阵、kind=0、observer.ts 白名单） | §1 非目标 + §11 DENY | **未扩大**。三处非目标均有 ADR 0022/issue body/#287 复审的显式依据 |

## 4. Owner评论覆盖

| Comment ID | Updated at | Design section | Assessment |
|---|---|---|---|
| （无——issue #301 comments 为空；任务简报 §Comments 与 SA6 §2/dispatch 一致） | — | 设计 §2（同一登记） | **一致**。无 owner 补充要求；任务要求唯一来源 = issue 正文 + ADR 0022 + 协议冻结文本，设计未虚构 owner 义务 |

## 5. 上游事实与SA8约束

| Fact or constraint | Design response | Assessment |
|---|---|---|
| SA6 §8 四个直接故障点（类型面止于 28 型 / 发送侧零结算回调面 / 接收侧抑制无替代 + chunkCount 断链 / aborted kind=0 门） | OD1/OD2/OD3/OD4/OD5/OD6 逐点兑付 | **一致且实测相符**：types.ts 联合现止于 `chunked-update-acked`（实测）；`onLastChunkSent: (lastChunkSequence: number) => void`（bulk-transfer.ts L50 实测）；`settle(kind): void`（L198 实测）；`UpdateChunkAcceptResult.complete.chunkCount` 在 hub L942/peer L906 被丢弃（实测）；`clearInboundAssembly` 的 `busyKind === 0` 门与「归 #301」注释（双侧实测） |
| slice 2 源码 deferral 注释（hub L993–994 / peer L953–954） | §4 登记为本票施工面 | **实测相符**（注释原文在位） |
| ADR 0022 L78–81 + 协议 §23.1 L749–754/L783–784 字段集冻结 | OD1 逐字落地（含 side 信封：snapshot 成功三型 hub/peer/hub 字面量、sync 四型与两 aborted 为 ReplicationObserverSide；aborted 无 connectionId；sync-acked 无 sequence/syncRoundId/transferId/chunkCount；sent 恒无 latency） | **逐字一致**（本评审逐行比对协议表行；R1/R2 的 required/forbidden 断言与 OD1 键集一一对应） |
| §23.1 计数不变量（sent 恰一非逐 chunk / acked 单 ACK 结算恰一 / applied 六选一互斥 / aborted busy 边沿恰一 / 与成功型互斥） | §9.1 不变量表（结构性单点论证） | **成立**（见 §7 攻击表逐条验证） |
| §23.3/§23.4 纪律（safe-field、secret-free、throw 隔离、决策落定后发射、无 observer 逐字节等价、clock 缺省整键缺失） | OD8 | **落实**：发射全部经 `emitObserver` → `dispatchReplicationObserver`（observer.ts L36–46 实测 try/catch 静默、无 per-type 白名单）；`host.now` 连接层 observer 门控 + safeNow 折叠（hub-connection L554/peer-connection L177 实测）；latency 条件展开两态 |
| SA6 §12.3 四条解释边界（kind=1 超时 aborted / epoch-fence reason last-writer-wins / GOAWAY 归 connection-teardown / aborted 无 connectionId） | OD7 + §13-1/§13-5 + §5.3 | **一致**：四条边界设计与契约读法逐条对齐；OD7 读法经 SA8 D5 独立裁定为冻结文本唯一相容读法，本评审复核 §23.1 L783 + §18 L628（「snapshot → BOOTSTRAP_FAILED 语义族 terminal failed」）后同意 |
| SA8 设计后冲突报告（14 项对照全 no-conflict/implements-existing；evolution-required 0；`requiresConflictRecheck: true` 限于**实现后**复查） | 设计 §15（设计后复查请求——已由该报告兑付并 clear） | **闭合**。SA8 Required actions 1–3 均为实现期核对项，不要求设计修订；设计无需因 SA8 报告改动任何 OD |

## 6. 设计内部一致性

- **锚点抽查全部命中**（基线 `0f3eca5` 实测）：hub `startBootstrap` kind=1 enqueue/单帧分支（L573–626）、`onBootstrapAck` 状态门+seq 核对+settle+setState（L632–652）、双侧 `sendStep2` kind=2（hub L697–731 / peer L1538–1572）、双侧 `onSyncApplied` quiet 门+settle(2)（hub L679–688 / peer L664–673）、`pullOne` 末 chunk 同一同步栈 `onLastChunkSent`（L188–193）、peer `finishBootstrapImport` 及其两调用点（L544–547 单帧 true / L900 分块 false）、双侧 `applyRemoteUpdate` 第 5 参判别联合与 syncChunked 抑制点（hub L1446–1458 / peer L1728–1741）、peer degraded 外层先行（L1713 起）、round-engine `applyStep2`/`completeChunkedStep2`/`applyStep2Safely`（L52–57/L221–229/L265–277）与双侧接线（hub L218–219 / peer L271–272）、双侧 `clearInboundAssembly` 与 `onAssemblyTimeout`、reason 置位点全集（resync-declared/shed/channel/connection/epoch-fence/timeout 逐条在源码定位）。
- **正文 ↔ 伪代码 ↔ 接口表 ↔ 调用方矩阵 ↔ 验收映射互相一致**：OD2/OD3 的「结算记录」单一事实源贯穿 §8.1 接口表、§10 调用方矩阵、§9.1 不变量；OD4-3 的 chunkCount 穿线链（assembler `complete.chunkCount` → `completeChunkedStep2` 第 3 参 → `applyStep2Safely` → `RoundHost.applyStep2` 结构化 form → `applyRemoteUpdate` 第 5 参 → 事件字段）每一跳与源码现状吻合。
- **无死引用/旧 API/前后矛盾**：设计引用的 `observerOn`/`cidField`/`emitObserver`/`host.now`/`bootstrapSnapshotSeq`/`teardownAbortReason`/`chunkedStep2RoundId` 全部真实存在且语义相符；api.test-d 标题「26 型」滞后（实际 28 型）的判断正确（实测）。
- **无「附录承认但正文未改」的伪修订**：OD4-4（svBefore 捕获跳过）在正文明确为可选且观测等价，非伪修订。

## 7. 状态机与并发攻击

| ID | Initial state | Trigger | Expected behavior | Design gap | Required revision |
|---|---|---|---|---|---|
| S1 | kind=1/2 载体 awaiting-ack | zombie 迟到 BOOTSTRAP_ACK/SYNC_APPLIED（ACK 超时弃置后） | 零 acked（settle → undefined） | 无——`settle` 仅在 awaiting-ack ∧ kind 匹配时返回记录（bulk-transfer L198–201 实测）；kind=1 路径状态门先拒 | 无 |
| S2 | 载体 active（中段 chunk） | 出站被拒（M5） | 零 sent/零 acked + BOOTSTRAP_FAILED/resync 族互补信号 | 无——拒绝分支在末 chunk 结算点之前 dispose（L178–185） | 无 |
| S3 | 末 chunk 出站（pullOne 同步栈） | sent 发射恰一；重复触发不可能 | 恰一 | 无——awaiting-ack 后 pullOne 早退（L152），无重试循环 | 无 |
| S4 | 单槽 `chunkedAckT0` 持旧载体 t0 | 载体弃置（teardown/shed/resync/超时）后新载体结算 | 新事件不得消费旧 t0 | 无——不变量「awaiting-ack ⟹ 本载体 onLastChunkSent 已触发（同一转移）」成立（L188–192 实测：phase 置位与回调同一同步栈，槽在新载体末 chunk 时被覆写）；per (ns,方向) 单载体仲裁（模块头 L25–26 + `enqueue` 非 idle 防御重置实测）排除交错 | 无 |
| S5 | partial assembly busy | 同一 assembly 多清理挂点汇合/重复 clear | aborted 恰一（busy 守卫） | 无——busy 才快照、reset 后零快照（双侧实测）；fire 后竞态由 stale 零副作用吸收 | 无 |
| S6 | kind=1 assembly 停滞 | assemblyTimeoutMs 到期 | 零 aborted + BOOTSTRAP_FAILED 终局（OD7） | 无——`kind` 先捕获后 clear（双侧 L1841/L2253 实测）；kind=0/2 超时仍发 aborted{timeout}（R5 红半对应） | 无 |
| S7 | chunked apply 进行中 | 连接收口/epoch 变更/导入迟到 | 零 applied（互补信号终局/静默回收） | 无——applied 发射在 `importResult.ok`、epoch 判别之后（peer L585–618 实测）；applyRemoteUpdate 失败/quiet 路径先于发射 return；该窗口与既有 `bootstrap-imported` 先例行为同构（非本票新引入语义） | 无 |
| S8 | SYNC_APPLIED 违例（round 校验失败） | 载体 settle 释放但零 acked（OD3 quiet 门） | 载体释放 + 零事件 | 无——`onViolation` 不 throw、settle(2) 照常执行（实测 onApplied 违例路径）；quiet 复核在 onApplied 之后捕获 finalize 结果；kind=0 `onUpdateAck` violation 先例同构；SA8 D6 no-conflict | 无 |
| S9 | observer throw / clock throw | 发射时 | 协议状态/关闭分类零影响 | 无——dispatch 单点 try/catch（实测）；safeNow 折叠（实测） | 无 |
| S10 | 双 ns 同连接并发分块 | 公平调度 | N8 面零改动 | 无——新状态仅 per-controller 内存字段，不进调度/账本 | 无 |

## 8. 错误与恢复攻击

| ID | Failure | Current design behavior | Risk | Required revision |
|---|---|---|---|---|
| E1 | 分块 snapshot 导入失败/迟到/代际不符 | 零 applied；BOOTSTRAP_FAILED 族或静默回收（§23.1 互补不重复） | 无伪成功——发射点严格在成功结算之后 | 无 |
| E2 | 出站被拒/ACK 超时 | 零 sent（被拒在中段）/零 acked（zombie）；载体由既有 teardown/弃置路径收口 | 无资源泄漏（本票零新增 acquire） | 无 |
| E3 | 违例族（transfer/binding violation） | clear 无 reason → 零 aborted（终局失败族条款） | 与 §23.1 L783 一致（实测 `transferViolation` 不带 reason） | 无 |
| E4 | observer 缺省 | 零事件构造/零时钟调用/逐字节等价（N7） | `sampleAckT0` 的 observerOn 门 + 连接层 now 门控（实测）双保险 | 无 |
| E5 | clock 缺省 | latency 整键缺失（条件展开） | R7 断言 `'applyLatencyMs' in event === false` 与设计两态写法精确对应（实测契约断言体） | 无 |

## 9. 契约影响审查

| API or contract | Missing or weak caller handling | Evidence | Required revision |
|---|---|---|---|
| `ReplicationObserverEvent` +8 成员（公共，index.ts 已导出） | 无遗漏——穷尽镜像仅 `ws-replication-api.test-d.ts`（ALLOW 内同步扩展）；外部消费者 `apps/yjs-server/src/fatal-policy.ts` 的 switch 带 `default: return false`（实测 L65–73），加性成员零破坏；其余消费者按 type 过滤 | grep 全仓 `ReplicationObserverEvent`；api.test-d `toEqualTypeOf` 全联合精确断言（L240–279 实测）；包 tsconfig include `test/**/*.ts` → 不同步即 `tsc` 红 | 无 |
| `BulkTransferRequest.onLastChunkSent` 参数加宽（包内私有） | 调用点恰三个（hub startBootstrap / hub sendStep2 / peer sendStep2），全部在 ALLOW 且设计 §10 逐点给出改法 | bulk-transfer.ts 不经 index.ts（实测 grep 零导出）；三回调体现状与设计描述一致 | 无 |
| `settle(kind)` 返回结算记录（包内私有） | 调用点恰三个（onBootstrapAck / 双侧 onSyncApplied），返回值当前被忽略——设计的消费语义（undefined → 零事件）覆盖全部现状分支 | L197–202 实测 + 调用点实测 | 无 |
| `RoundHost.applyStep2`/`completeChunkedStep2`/`applyStep2Safely` 形态结构化 | 实现者仅 hub/peer 两控制器（round-engine 宿主 seam 接线点实测 L218–219/L271–272），随 ALLOW 文件同步改 | grep `syncChunked` 全量命中即设计所列位置 | 无 |
| peer `finishBootstrapImport` form 参数化 | 调用点恰两个（实测 L544/L900），boolean 的非法组合态被 form 判别联合消除（设计备选分析正确） | 实测 | 无 |
| `applyRemoteUpdate` 第 5 参 `{syncChunked:true}` → 携 chunkCount | `{syncChunked:true}` 的构造点恰两个（双侧 applyStep2，实测 L1351/L1616），无第三调用方 | grep 实测 | 无 |

## 10. 架构一致性与惯例审查

### 责任归属

| Behavior | Expected owner | Design location | Assessment |
|---|---|---|---|
| 发射点（sent/acked/applied/aborted） | 控制器（hub/peer namespace）——`onUpdateSent`/`onUpdateAcked` 先例 | OD2/OD3 在控制器回调体；OD4/OD5 在控制器 apply/导入结算点；OD6/OD7 在控制器清理/超时点 | **正确**（机制模块 `BulkTransferSender` 保持零观测面——备选①拒绝理由与既有分层一致） |
| 结算字段事实源 | 发送器自身状态（totalBytes/chunkCount/transferId） | OD2 `BulkTransferOutboundSettlement` 由 `settle`/`onLastChunkSent` 从发送器状态构造 | **正确**（控制器不自记第二份——备选④拒绝理由成立） |
| 进度快照事实源 | assembler `snapshot()`（kind 无关，实测） | OD6 复用 | **正确** |
| round 归属事实源 | `chunkedStep2RoundId`（admit 时捕获，实测） | OD4 复用（`syncRoundId` 投影） | **正确** |

### 相似能力对照

| Similar capability | Existing implementation | Proposed design | Consistent or divergent | Reason |
|---|---|---|---|---|
| kind=0 chunked 族四型（issue #245） | types.ts L775–856；`chunked-update-sent/applied/acked` 键集与发射纪律 | 8 型为逐字结构克隆（sent 无 latency、applied 无 transferId/sequence/效果组、acked 无 sequence、aborted 六值 reason 复用） | **一致** | §23.1 各行明文「字段集对齐既有 chunked-update-* 四型」；设计零新词零新键 |
| acked latency t0 锚 | kind=0：update-channel `sentAt`（末帧出站时刻，§23.1 L748） | kind=1/2：控制器 `chunkedAckT0`（末 chunk 出站时刻） | **一致** | 同一冻结语义（「ACK 处理时刻 − 末 chunk 出站时刻」）；机制差异仅记账位置（channel per-frame vs 控制器单槽），由单载体仲裁支撑 |
| observer 分发/隔离/cidField/safeNow | observer.ts 单点 + 连接层 seam | 全部复用，零新通道 | **一致** | 实测 |
| 协议 §22 资产锚惯例 | 每票一段验收资产登记（#242/#246/#295/#300 实测在位） | OD9-2 补记一句 | **一致** | 登记性加法非契约修订（SA8 D10 同判） |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| transferId/chunkCount/totalBytes | 发送器载体状态（pullOne/settle 时构造） | 事件字段（同源投影） | 无（备选④明确拒绝控制器平行记账） |
| bytes（applied/acked） | wire totalBytes（assembler Σbytes 精确核对 / 结算记录 totalBytes） | 事件字段 | 无 |
| syncRoundId | round 引擎（绑定块/admit 捕获；sendStep2 闭包实参同源） | sent/applied 事件字段 | 无（同源值，R2 断言 wire 相等可锁） |
| assembly 进度 | assembler receivedChunks/receivedBytes | aborted 事件字段 | 无（快照先于 reset，既有纪律） |
| ack t0 | 控制器 `chunkedAckT0`（末 chunk 出站覆写） | ackLatencyMs 差值 | 低——单槽仅在被结算载体上消费（S4 论证）；无第二记账 |

### 生命周期对称性

| Start or acquire | Stop or release | Failure recovery | Assessment |
|---|---|---|---|
| `chunkedAckT0` 写入（onLastChunkSent） | 覆写式（新载体）/ 弃置（不消费） | 无需清理——不可消费即不可错发 | **对称充分**（纯覆写单槽，无 acquire/release 语义） |
| 观测发射（同步回调） | 无异步资源 | dispatch 隔离吞 throw | **对称**（零新增异步/持久资源） |

### 平行机制检查

| Candidate duplicate | Existing path | Proposed path | Disposition |
|---|---|---|---|
| 第二 observer 分发/白名单 | `dispatchReplicationObserver` 单点 | 复用 | 无平行（observer.ts 零改动，#287 域分离） |
| 第二时钟采样通道 | `host.now`（连接层 safeNow+门控） | 复用 | 无平行 |
| 第二发送结算账本 | `BulkTransferSender` 状态 | 结算记录单点 | 无平行（备选④拒绝） |
| 第二清理/中止函数 | `clearInboundAssembly` 单点 | kind 选路泛化（置位点零改动） | 无平行（备选「另立清理函数」拒绝，六类 reason 挂点免复制） |
| 仅服务单 Issue 的通用抽象 | — | `BulkTransferOutboundSettlement` 为 kind 无关最小记录 | 无过度抽象（三字段供给三类事件） |

## 11. 文件范围审查

| Path or scope issue | Evidence | Required revision |
|---|---|---|
| ALLOW 七文件（types/bulk-transfer/hub-namespace/peer-namespace/round-engine/api.test-d/协议 §22） | 与 OD1–OD9 的全部改动面逐一对账：无 ALLOW 外文件需要改动（emitObserver/cidField/safeNow/assembler snapshot/busyKind 全部复用现状；index.ts 零新导出——实测 grep；镜像文件在包 tsconfig include 内） | 无 |
| DENY：SA6 契约文件冻结 | SA6 §16 冻结 + 设计 DENY 显式禁止；本票验收 = 该文件 8 红转绿，无需改契约 | 无 |
| DENY：`ws-replication-observer-red.test.ts` 零改动 | **独立核验通过**：`assertSafe` 仅两处调用（L1404 matrix / L1541 sentinel，实测 grep）；两场景 `maxBootstrapBytes/maxSyncDiffBytes` 保持 4MiB/2MiB 缺省（chunked 选项只压 `maxUpdateBytes`，实测 L192–196）⇒ 8 型不在其可达面，`ALLOWED_KEYS` 不见未知型即不红；与 SA8 D14 独立核验互证 | 无 |
| DENY：issue300/299/244/245/246/256/239/231/137 等既有测试 | **独立核验通过**：issue300 契约零 observer 引用（实测 grep）；bulk-edge 事件断言全部按 type 过滤（实测 L463–476）；`toEqual([])` 空流探针位于 observer 缺席/握手前场景（新事件同受 observer 门控）⇒ 实现后既有 499 用例零回归的论证成立 | 无 |
| DENY：wire/配置/ADR/CONTEXT 面 | §1 非目标 + §8.1 状态机零变化 + ALLOW 全在观测面；git 基线无决策文档改动 | 无 |
| follow-up（observer-red 全 36 型覆盖、SA7 动态面 shed/epoch-fence/GOAWAY 行、双侧覆盖） | §13-9 登记；§23.1 L782 明文「动态断言归 SA7」——非本票验收必要条件，无掩盖 | 无 |

## 12. 验收设计审查

| Requirement or risk | Proposed evidence | Gap | Required revision |
|---|---|---|---|
| AC5 八型发射/字段/计数（R1/R2） | 契约红灯（真实双端 harness + clock 注入）转绿；本评审逐字段核对 R1/R2 断言与 OD1 键集完全对应（含 forbidden sequence/latency/transferId/syncRoundId 逐项） | 无 | 无 |
| AC1 aborted 面（R3/R4/R5/R8） | 契约红灯转绿（reason/进度/零写入/零 dirty 断言体实测） | 无 | 无 |
| AC5 safe-field（R6）/两态 latency（R7）/等价（N7） | 契约深扫 + 整键缺失断言 + wire 逐字节全等 | 无 | 无 |
| AC1–AC4 回归（N1–N9 + 全包 499 + typecheck） | §12 验证命令 = SA6 §13 同款（包 tsc / 根 pnpm typecheck / 根 pnpm test）；全包零回归论证经本评审独立核验（§11） | 无 | 无 |
| api 型镜像防漂移 | `toEqualTypeOf` 全联合精确断言 + 包 tsconfig 含 test 目录 → 加成员不改镜像即 typecheck 红（实测配置） | 无 | 无 |
| 红灯真实性 | SA6 §13：8 红全部在对应前置断言通过之后失败（事件计数 0 ≠ fixture 空转）；连跑 3 次零抖动 | 无 | 无 |

## 13. Required revisions

无（无 BLOCKER / 无 MAJOR）。

## 14. Non-blocking observations

| ID | Severity | Observation | 建议处理 |
|---|---|---|---|
| O-1 | MINOR | OD3 伪代码将双侧 `onSyncApplied` 的门统一写作 `!this.isQuietState()`；源码实测 peer 侧方法名为 `isInboundQuiet()`（peer-namespace.ts L662）、hub 侧为 `isQuietState()`。语义等价（同为 quiet 域判别），但 SA3 实现须按侧取正确方法名，避免在 peer 上引用不存在的方法 | SA3 落地时按侧映射；无需设计改版 |
| O-2 | MINOR | OD9-1 的 8 型字段精确性断言清单为示例性（「含……等」）；硬门是全联合 `toEqualTypeOf` 镜像，但该文件既有 per-type `Extract` 断言先例（namespace-failed/update-applied 等）建议对 8 型逐一补齐（尤其 `chunked-snapshot-applied.applyLatencyMs: number \| undefined` 与 `chunked-sync-acked` 无 syncRoundId 键） | SA3 按 OD9-1 示例全覆盖 8 型，保持文件内先例密度 |
| O-3 | MINOR | §1 目标 2 表述「接通 8 个发射点」为按事件型计数的宽口径（物理调用点约 11 处：sent 3 / acked 3 / applied 3 / aborted 2）；§10 调用方矩阵与源码逐点对应无歧义 | 无需修订；SA3 以 §10 矩阵为准 |

---

## 结论

设计将 ADR 0022/协议 §23.1 已冻结的 29–36 型事件从零发射点接通到既有结算结构上：字段集与冻结行逐字一致（本评审独立逐行比对）、发射点归属正确（控制器层，机制模块零观测面）、计数不变量由结构单点保证、全部 reason/chunkCount/syncRoundId 事实源单点复用、文件范围与 DENY 论证经源码独立核验成立、验收映射与 SA6 契约逐字段对应。SA6（approve）与 SA8 设计后冲突复查（clear）与本评审结论三方一致。可进入实现。

*SA2 只读评审：未修改设计、生产代码或测试；唯一产出为本文件。*
