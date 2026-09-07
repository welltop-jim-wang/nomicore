# 设计冲突复核（design 后置复核）— Issue #238 分段观测与 sent/applied/acked 关联

## 任务标识

- 复核对象：`wiki/raw/task_238_design_2026-09-06.md`（MABF round 1 design 阶段产出，Verdict: approve）
- 任务：Issue #238 — BUG investigation: Hub→Peer UPDATE apply 延迟呈阶梯累积，最高 11 秒
- Worktree：`/home/wangjian/nomicore-fix-issue-238`（branch `mabf/issue-238`，HEAD `9e3f0bf` 实读复核）
- 复核基准：
  - `docs/adr/` 全部现存 11 文件（0001–0010、0012；0011 编号空缺）— 本轮对核心四件（0006/0007/0008/0009/0010/0012）全读，其余经前置产出盘点核对
  - 根 `CONTEXT.md` 全读（「写序列器」L77-79、「ReplicationSession」L133-135、「复制未校验」L137-139）
  - `docs/protocols/instance-replication-v1.md` §3（L46-62）/§10.1（L256-272）/§10.2（L274-283）/§23 全节（L598-748）——经 ADR-0010 L151/L167 收录为核验基准
  - 前置门禁产出：`wiki/raw/task_238_relevant_decisions.md`、`wiki/raw/task_238_conflict_report.md`（verdict clear；条件性演进门 G1–G4；红线清单 L71）
- Owner 评论实读（gh，本轮）：`IC_kwDOT8JVvs8AAAABS2CyWg`（welltop-jim-wang，2026-09-06T13:39:25Z）——当前唯一评论，无新增。其「结论边界」原文与设计 R1–R3 逐字对应：「这已经稳定复现了生产症状背后的 sequencer 排队机制，但还没有证明生产环境中造成 11 秒长占槽的具体阶段。当前仍需增加分段观测，以区分 event-loop stall、sequencer queue wait、protected check/live apply 和 dirty notification；同时还缺 sent/applied/acked 跨阶段可靠关联 ID。」

## 复核方法

1. 设计全部规范性断言（file:line 锚点、冻结面、wire 字段、槽结构）对照 HEAD `9e3f0bf` 实读代码逐条核验（§4 表）。
2. G1–G4 四门**独立重验**（不采信设计自评，以代码 + ADR/protocol 原文重新推导）。
3. Owner 要求 R1–R5 逐条对照设计条款与 Issue AC。
4. 工作树状态核对：冲突报告注记 1（基线复现不在 HEAD）已由后续红灯契约轮消解——`ws-replication-issue238-repro.test.ts`（新增未跟踪）与 `issue137-driver.ts` 的 `hubClock/peerClock` dormant seam（driver L65-66/L127/L160）现均在 worktree；设计 R1「字节不动」的对象真实在场。

## 一、四门独立重验（G1–G4）

### G1 槽序变更 —— 未触发

- 证据（代码实读）：
  - `packages/namespace-runtime/src/sequencer.ts` L38-42：`enqueue<T>(run)` 现为单参；FIFO 链形 `settled = this.tail.then(run, run)` + `this.tail = settled.then(noop, noop)`。设计加性 `label?` 参 + 私有深度计数 + 槽样本缓冲不改该链形（设计 §3.1 明示逐字节保持）。
  - `packages/namespace-runtime/src/replication-session.ts` 槽体实读：R4 `protectedContentEvaluated` → R5 `Y.applyUpdate` → R5.5 标记 → R6 `await notifyDirty()` → R7 `return { ok: true }`。设计四戳（admission/slotStart/applyStart/dirtyStart/dirtyDone）全部为**纯同步时钟读**，插在既有同步边界之间，零新增 await/调度点；`await notifyDirty()` 位置与 ADR-0008 L51「然后才释放给下一任务」、ADR-0010 L96-103 六步逐位保持。
  - 槽级样本「槽内只入有界环形缓冲、槽释放后续体 flush、sink 槽外调用、sink throw 自捕获」——与 ADR-0010 #134 round-2「listener 调用全部移出 transaction 栈」既有先例同纪律；ADR-0008 L40（唯一严格 FIFO）不受影响。
- 结论：**否，G1 未触发**。

### G2 受保护判据/成本优化 —— 未触发

- 设计仅对 R4 计时（applyStart 戳取在 R4 通过后），`protectedContentEvaluated` 判据（ADR-0010 #134 O-12 冻结：scratch clone 内容投影相等）零改动。
- §8.2 H3 修复支路明示须先设计评审 + ADR-0010 修订节 + 行为等价测试（ADR-0007 L59 先例），不在本任务预写——与 ADR-0010 L255「不得在未评审情况下预写」逐字一致。
- 结论：**否，G2 未触发**。

### G3 wire 变更 —— 未触发

- 关联键 = protocol §3 L56 envelope `sequence`（uint32，正常 frame 从 1 严格递增）+ §10.2 L279 `UPDATE_ACK.ackedSequence`——两者已在 wire 契约冻结文本中；发送侧 `seq`（peer-namespace sendUpdateFrame `host.sendData` 返回值）、接收侧 `onHubUpdate(message.sequence)` / `onUpdateAck(message.ackedSequence)`、channel `inFlight` Map 键（update-channel.ts L66）均为**已在域的值**，设计只把它们放进事件对象。
- `sendQueueMs`/四段差值/`delayMs` 全为 local 计算；wire 字节全等断言列入契约测试（§11.2-6）。protocol §23 L601「不改变任何 wire 字节」保持。
- ADR-0010 L213 非目标（跨重连 update ID 表）不受触碰——sequence 连接局部、不持久化。
- 结论：**否，G3 未触发**。

### G4 冻结公共面扩形 —— 未触发（含一项保守读法 watch item）

- `session.getStatus()`（O-11 十一字段）：设计零触碰（§9 无任何 getStatus 变更；观测字段全部走事件面/注入 sink）。
- `NamespaceRuntime.getStatus()` `replication` 两态域（#132 修订 5）：零触碰；ADR-0008 L101「status 不暴露队列长度、任务类型或 sequence；队列进度和内部事件属于日志、metrics 与 trace」——槽级样本落注入 metrics/log sink 正是该句指定的落点。
- `applyRemoteUpdate` 拒绝码闭集：refusal 分支逐字节不动（设计 §3.1①/§4.2）。
- `lease.openReplicationSession` 2 键输入校验：`lease.ts` parseOpenSessionOptions 实读核验（own 键集恰含 `{localRole, remoteInstanceId}`，keys.length !== 2 即拒）；设计对 lease.ts **零改动**，观测参数走 registry 构造 options 而非 session open 输入——刻意避开该冻结面。
- runtime 十二键公共面：实数 12 键（`runtime.ts` runtime 对象键计数复核）；设计仅经 seam 输入可选项，公共面零改。
- internal subpath 值导出两键冻结（`createNamespaceRuntimeForRegistry` + `openReplicationSessionCoreForRegistry`，internal.ts 实读核验）：设计为前者加**第三可选参**——参数加性不扩导出键集、不触 import 图审计谓词、既有调用点零变化；ADR-0010 #134 L261 冻结的是导出键集与消费边界，非签名不可加性。
- **保守读法 watch item（设计 §13 watch 1 复核确认）**：`RuntimeReplicationSessionApplyResult` ok 分支加性可选 `stages?` 若被维护者读作整体冻结——已核 `lease.ts` `Equal<RuntimeReplicationSessionCore, ReplicationSession>`（L143-144/L384）为**镜像一致性锁**（两侧同改即保持绿），非不可变锁；且该联合不在冲突报告 G4 成员清单内。设计 prescribed 的「ADR-0010 修订节一行登记」是消歧的合规路径，**实现 PR 必须包含该登记**（本复核将此从建议升为随附要求）。
- 结论：**否，G4 未触发**（上述登记要求随附）。

## 二、Owner 要求逐条核验（评论 2026-09-06T13:39:25Z + Issue 正文）

| # | Owner 要求 | 设计落点 | 复核结论 |
|---|---|---|---|
| R1 | 确定性复现基线保留 clock/gate 性质 | §11.1：repro 测试与 driver `hubClock/peerClock` seam 字节不动；新观测全走生产 seam + 新可选注入 | **满足**。基线对象经实读确认在场（红灯契约轮产物）；设计 §9 受影响文件清单对两文件标注「零改动」 |
| R2 | 复现不构成生产 11 秒长占槽阶段的证明 | §1 R2 / §4 / §8.1-8.2：慢 dirty 在复现中是 saveGate 测试替身（ADR-0008 L97 认可 seam），登记为「机制锚，非生产缺陷证据」；生产归因须分段字段首窗口数据（§8.2 决策树） | **满足**。设计全文无「复现已证明生产根因」断言；§5.3/§14.4 另将跨侧减法降级为 triage 近似，防止过度声明 |
| R3 | 分段观测区分 event-loop stall / sequencer queue wait / protected check+live apply / dirty notification | §4 四段差值（queueWait/protectedCheck/liveApply/dirtyNotify——Owner 的「protected check+live apply」一类 = 本设计两字段之和，§4.1 显式声明口径兼容）+ §6 event-loop 探针（H1 唯一可判别面，锚定 liveness ping 周期，dormant 等价）+ §7 槽级记账（H4 判别） | **满足**。四类均可判别且互斥可分（H1 vs H4 判别语义 §6/§7）；观测确定性由注入单调时钟 + 手动时钟测试（§11.2-1/2/7/8）保证 |
| R4 | 可靠 sent/applied/acked 跨阶段关联 ID | §5：帧级 wire sequence 在三事件面全程可见；SA5 §6 实证按时间/字节长度猜关联在贪心合并下结构性失效、sequence 逐位配对成功；合并帧粒度显式文档化 | **满足**。零 wire 变更实现（见 G3）；§11.2-3 配对断言入契约 |
| R5 | 无 ADR/protocol 修订 + 冲突复核时不得 wire/槽序/判据/冻结注册表变更 | §13 逐门核验 + 本复核独立重验 | **满足**。G1–G4 全部未触发；protocol §23 事件面扩展走其自身 append-only 条款（L603-604）+ 显式修订（§9 docs 行，标 issue #238）——**非**「无修订而变更」 |

Issue AC 1–7 与设计 §10 映射逐条核对成立（AC7「更新 protocol §23」由 §9/§3.4 的 append-only 修订承载，方式为 §23 自我声明的唯一合法演进路径）。

## 三、设计锚点事实核验（HEAD `9e3f0bf` 实读抽检）

| 设计断言 | 实读结果 |
|---|---|
| sequencer 包内私有、FIFO 链形 `tail.then(run, run)` | ✓ sequencer.ts L38-42；index.ts 不导出 WriteSequencer |
| 槽结构 R4→R5→R5.5→R6 `await notifyDirty()`→R7 `{ok:true}` | ✓ replication-session.ts 实读逐位对应 |
| `lease.ts` 2 键严格校验 | ✓ parseOpenSessionOptions（own 键集恰两键、长度≠2 即拒） |
| internal.ts 值导出恰两键、factory 现两参 | ✓ 实读；加性第三参不扩导出面 |
| registry options `...(x !== undefined ? {x} : {})` 模式 + :746 默认 factory | ✓ createNamespaceRegistry / createRegistryInternal 实读 |
| peer `applyRemoteUpdate` t0（apply 前）/t1 与事件发射位于 `await pending` 结算续体 | ✓ peer-namespace.ts 实读（发射在槽外续体——§23.4 既有 conformance 模式，非新纪律风险） |
| `update-sent` 在 `seq > 0 && observerOn` 发射、`seq` 已在域 | ✓ sendUpdateFrame 实读 |
| `onUpdateAcked` info = `{bytes, latencyMs?}`（channel 内部 host 接口） | ✓ update-channel.ts L44-46/L133-142；加性 `sequence` 属内部接口扩展 |
| channel 贪心合并（合并帧共享一 sequence） | ✓ mergeItems / §5 合并策略实读——§5.1「关联粒度 = wire 帧」的结构性事实成立 |
| liveness 缺面 dormant 先例（L5）+ `pingIntervalMs` 缺省 30 s | ✓ liveness.ts 头注 / defaults.ts |
| ws-replication `clock?: ReplicationClock`（单调、禁原生时钟回退、safeNow 折叠） | ✓ types.ts hub/peer options 实读——stageClock 注入沿同款纪律 |
| `@nomicore/clock` 只有可跳变 epoch 源（system.ts = `Date.now()`） | ✓ 实读——D3「组合根注入同一单调实例」的前提成立 |
| persistence `saveDoc` = 同步登记（dirtyGeneration += 1 + scheduleFlush，resolve 前零重活） | ✓ lifecycle.ts 实读——§8.1「H2 在树不可复现」的审计事实成立 |
| runtime 十二键冻结 | ✓ 实数 12 键（注：internal.ts 头注「十键」为陈旧注释，非设计错误） |
| `applyLatencyMs` 语义只增不改 | ✓ 设计全部以新增差值字段表达分解，既有字段语义零重定义（冲突报告红线 7） |

## 四、复核发现（均非冲突，登记转实现）

1. **（随附要求）ADR-0010 修订节一行登记**：设计 watch item 1 的保守读法消歧登记（ok 分支加性可选 `stages`，issue #238 观测导出）必须出现在实现 PR 的 docs 变更中（设计 §15 步骤 6 已列，本复核确认其必要性并要求不省略）。
2. **slotMetrics sink 的标识纪律**：§7 槽级样本携带 `namespaceId` 进宿主注入 sink——ADR-0008 L101 指定落点合法；实现期 sink adapter 须沿 ADR-0010 L159 / protocol §23.6 同款原则保持 namespaceId 不作默认 metric label（设计未显式重述此句，为实现期提醒，非设计缺口性冲突）。
3. **event-loop 探针边界已诚实声明**：`delayMs` 为停停下界信号（含 timer 后端粒度噪声）、非精确测量；判别依赖多窗口对比（§6/§14.2）——满足 Owner「确定性观测」要求的同时未越界声明测量精度。
4. **#233 交互**（设计 watch 2）：chunked live update 合入时帧级 sequence 关联需在彼任务内复核——登记恰当，不属本设计义务。
5. 冲突报告注记 1（基线不在 HEAD）已被红灯契约轮消解：repro + driver clock seam 现均在工作树；「保留基线」有了真实可保留对象，R1 可执行。

## 结论

- 设计以**零 wire 变更、零槽序变更、零受保护判据变更、零冻结注册表扩形**实现 Owner 四段观测 + 帧级 sent/applied/acked 关联：G1–G4 经独立重验全部未触发；唯一协议文档演进（§23 append-only：字段增补 + 第 21 事件型 + §23.3 允许清单 + §23.4 捕获纪律 + §23.7 conformance）走 §23 自我声明的演进条款并显式修订，属「有修订的演进」而非禁止的静默变更。
- Owner 要求 R1–R5 逐条满足；「复现 = 机制证明、非生产 11 秒阶段证明」的边界在设计内一贯保持（R1/R2 及 §5.3/§8.1/§14.4 的诚实声明链）。
- 设计锚点经 HEAD 实读抽检全部成立；两处 watch item 处置正确（其一升为随附要求，见 §四-1）。
- **不需要重跑冲突门禁**；设计可进入实现（SA3）阶段。

Verdict: clear
