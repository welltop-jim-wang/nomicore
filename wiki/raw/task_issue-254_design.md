# SA1 设计 — issue #254：周期 reconciliation 超时 failed/needs-resync 僵尸的协议合规自愈

- 任务：`wiki/raw/task_issue-254.md`（issue #254，open；comments REST 读取为空——无 owner 反馈适用）
- 上游：SA6 红灯契约 `wiki/raw/task_issue-254_sa6_contract.md`（已亲跑红 10/10）+ 契约测试
  `packages/ws-replication/test/ws-replication-issue254-ac-red.test.ts`；SA8 冲突门禁
  `wiki/raw/task_issue-254_sa8_gate.md`（verdict `clear`，方向 A 兼容，D1–D5 移交本设计）
- 基线：HEAD `6a005a4`（branch `mabf/issue-254`）；行号锚点均为该基线
- 迭代：0（无 `task_issue-254_sa2_review.md`——首版设计）

---

## 1. 任务类型、目标与非目标

**类型：Bug**（确定性回归修复；SA6 已固化红灯契约，本设计给出生产行为修复）。

**目标**：

1. 周期 reconciliation（以及同构的 open/bootstrap）超时后，系统在 `reconcileTimeoutMs`
   边界自动进入恢复轨道：连接重建 → 新连接 re-OPEN → reconcile → 双侧回 `live`，
   全程零人工干预（AC1/AC2/AC6）。
2. 恢复路径严格遵守 protocol §1 不变量 4 / §7.1：`failed` 在**同一连接内**保持终态，
   复活只能经「终态 → disconnected（连接死投影）→ 新连接 ready → targeted → startOpen」
   （AC3；SA6 §12.2 事件级检查器零违例）。
3. 恢复全程复用既有 §16 断线纪律（session 停接纳、已接纳 apply 排空、Lease release、
   target 保留）与 §15.1 backoff 重拨——零新增 wire 帧、零新增错误码、零 codec 变更。
4. 补齐 SA8 点名的 doc-gap：protocol §16/§18 登记「谁、在何条件下触发连接重建」。

**非目标**：

- 不改变 §13.2 错误码→终态映射（`NAMESPACE_TIMEOUT → failed` 保持）；不新增
  `reconciling → needs-resync` 本地边（方向 B 否决，见 §7）。
- 不修改 Hub 侧任何代码（Hub 无 dial loop；Peer 拥有重拨所有权——ADR 0012 L36）。
- 不处理超时**诱因**（事件循环/写序饥饿——issue「非结论」明确死局与诱因正交）。
- 不在本任务把触发面扩到 wire ERROR 帧驱动的 `retryable=reconnect` 失败族
  （BOOTSTRAP_FAILED/APPLY_FAILED/INTERNAL_ERROR 收到的 ERROR 帧；同构僵尸但未覆盖于
  红灯契约，记为显式 follow-up 决策点，见 §13——非本任务必要条件）。
- 不引入连接级 liveness/watchdog 新机制（SA6 §9 step6/7 已排除该假说）。

---

## 2. 当前行为与证据锚点（源码事实）

### 2.1 死局链条（全部经 SA6 红跑 10/10 复证）

| # | 事实 | 锚点 |
|---|---|---|
| 1 | 非周期 timer（open/bootstrap/reconcile）到期统一走 `onTimerFired` 尾部 `finalize('failed')`（注释自引「timeout 只收口 namespace（零 wire 帧）」） | `peer-namespace.ts` L1505-1522（尾部 L1521） |
| 2 | `finalize` 只收口 namespace：clearAllTimers + setState + settleCloseMemo + 排队 cleanupResources；**不通知连接层**；L1261-1262 存在空 `if (state === 'failed') {}` 死块（历史残留，恰是恢复分派应落位的缝） | `peer-namespace.ts` L1259-1269 |
| 3 | `failed` 是同一连接内终态；入站帧一律静默（`isInboundQuiet` 含 failed）→ Hub 的 `RESYNC_REQUIRED` 被忽略 | `peer-namespace.ts` L1271-1300、L534-540 |
| 4 | 唯一复活点 `onConnectionReady()`/`openActiveTargets()`：`disconnected/failed → targeted → startOpen`，只在**新连接 ready**（`onHelloAck` 尾）执行 | `peer-namespace.ts` L832-838；`peer-connection.ts` L685-697、L457 |
| 5 | reconcile 超时不关闭/重建仍 ready 的连接 → `failed` 无自愈出口（60s 虚拟时间零事件） | SA6 §6 红跑日志；`peer-connection.ts` 无任何「超时后重建」路径 |
| 6 | 连接重建编排**已存在**两个入口：`requestRebuild`（config-change/re-add/auth-change：close(1000,'replication-rebuild') → deferTask → 立即 dialNow，无 backoff）与 §18 R4 `detachCloseTimedOutTransport` + `onTemporaryFailure`（pong/hello-timeout：epoch 先失效 → close(1001) → §15.1 backoff 重拨） | `peer-connection.ts` L939-969、L644-666、L908-937、L229/236/249/277 |
| 7 | `onTemporaryFailure`：停 liveness → 退订 transport → epoch+1 → sender teardown → attempts+1 → setState('backoff') → 逐 controller `onConnectionLost()`（failed→disconnected + cleanup 排队）→ full-jitter backoff timer → `dialNow()` | `peer-connection.ts` L908-937 |
| 8 | Hub 半区：round 恒由 Peer 发起（§9.4）；Hub 出向 ACK 超时 → `declareHubResync('ack-timeout')` → `needs-resync` + `RESYNC_REQUIRED` → 终态 Peer 静默 → 永久互等 | `hub-namespace.ts` L775-800；`peer-namespace.ts` L534-540 |
| 9 | §13.2 注册表（codec 权威）已按码编码 `retryable`：`NAMESPACE_TIMEOUT | yes | reconnect | failed`；`UPDATE_TOO_LARGE/SYNC_DIFF_TOO_LARGE/BOOTSTRAP_TOO_LARGE | config`；`NAMESPACE_STATE_VIOLATION/SYNC_STATE_VIOLATION | no` | `docs/protocols/instance-replication-v1.md` L357-380；`packages/replication-protocol/src/errors.ts` L123-131 |
| 10 | 观测面：`connection-backoff-scheduled.reason` 为 types.ts 内联 append-only 闭联合（7 值）；`PeerBackoffReason` 在 peer-connection.ts 同构镜像（未从 index.ts 导出） | `types.ts` L287-297；`peer-connection.ts` L38-45 |

### 2.2 既有测试对僵尸形态的钉住（修复必红的存量面）

`namespaceState()` 为同步投影轮询；修复后 `failed` 只在 timer 回调同步栈内瞬态存在
（finalize → 触发重建 → `onConnectionLost` 同步投影 disconnected），轮询永远捕不到：

| 测试场景 | 触发源 | 修复后 |
|---|---|---|
| `ws-replication-ac4-reconcile.test.ts` L107-125「§9.3 缺少对端 SYNC_APPLIED …reconcile timeout 收口 failed」 | **reconcile 超时** | 必红：`waitNamespace('failed')` 捕不到瞬态；需按新契约改版 |
| `ws-replication-ac3-bootstrap.test.ts` L120-139「§18 bootstrap timeout：快照丢失 → 收口」 | **bootstrap 超时** | 必红：同上；且重建后新 wire 合法重发快照，`hubFrames` 计数断言需按「同 wire 不重发」口径重述 |
| `ws-replication-sa4-f1-f2-f3-red.test.ts` L68-100「F2 重连超时兜底 → failed」 | **open 超时** | 必红：authorize 持续悬挂时从静态僵尸变为有界重试环；断言需改为事件轨迹 + 环行为 + release 后恢复 |
| 其余 `failed` 断言（ac1-ac2-open 授权/NOT_FOUND/NOT_ENABLED、ac3 L111 BOOTSTRAP_FAILED 本地导入失败、ac4 L152 SYNC_STATE_VIOLATION、ac6 L152 terminal ERROR、ac7-faults L100/113 PERSISTENCE_DEGRADED、r3-r4 L232 INTERNAL_ERROR 帧、auth-lifecycle L320、sa7 系） | 错误帧 / registry 拒绝 / 本地映射 | 不受影响（触发面仅 timer 族，见 §7 D2） |

---

## 3. 根因（承接 SA6 §9，设计视角重述）

`failed` 的既定恢复模态（§16「等待连接重建」、§13.2 `retryable=reconnect`、
`onConnectionReady` 复活点）全部以「连接先死」为前提；而 open/bootstrap/reconcile
超时的直接动作（§18「只收口 namespace」）不触碰连接。于是当连接层事实存活（ready /
TCP ESTABLISHED）而 namespace 已终局时，**「等待连接重建」的等待者与「触发重建」
的执行者都不存在**——这是 SA8 冲突点 #1 定性的基线文本未指明缺口（doc-gap），
当前实现把该缺口走成了死局。修复 = 在唯一缺失的一环（超时收口后的触发者）落笔，
复用全部既有恢复机制（§15.1/§16/§18/§21），不发明新状态、新帧、新所有权。

---

## 4. Owner 要求落实

Issue comments REST 读取返回空（SA6 §3 / SA8 同证）——**无 owner 评论项**。
验收口径 = 简报 AC1–AC6，映射：

| AC（简报原文） | 设计落实节 |
|---|---|
| AC1 周期 reconciliation 超时后无需人工重启即可恢复 | §7 决策 A + §8 状态机（超时边界即触发重建） |
| AC2 不再出现长期稳定 `Peer failed + Hub needs-resync + connection ready` | §8/§9（重建 → Peer 复活开新 round；Hub 半区随旧 channel 消亡、新 channel 回 live） |
| AC3 遵守「同一连接内终态 namespace 不重开」 | §8（复活只经 disconnected → 新代 ready → targeted）+ §12 验收（SA6 §12.2 检查器） |
| AC4 已接纳 apply 排空，session/lease 无泄漏 | §9.4（复用 onConnectionLost/runDisposal 既有纪律，零新清理路径） |
| AC5 确定性超时与自动恢复回归测试 | §12（既有红灯契约转绿 + 新增 timeout-family 场景） |
| AC6 覆盖 Peer/Hub channel 状态、连接重建、最终数据收敛 | §12（契约 A1/A2 断言面 + 新增 multiplex/收敛场景） |

---

## 5. 复现和根因承接

| 上游事实（SA6 契约） | 证据位置 | 设计响应 |
|---|---|---|
| 红灯 10/10：A1/A2 恰 2 failed，失败断言全部且仅为本契约恢复/不变量断言；N1–N3 恒绿 | `task_issue-254_ac_red.log` / `_ac_red_stability.log` | 设计的生产行为变更以 A1/A2 转绿、N1–N3 保持绿为硬验收（§12） |
| 根因链 step1-7（直接故障点 = onTimerFired 尾部 finalize('failed')；最深根因 = failed 同连接终态 × 唯一复活点在新连接 ready × 超时不重建连接） | SA6 §9；源锚点见本设计 §2 | 触发点落在 timer 收口之后、复用 requestRebuild 同族编排（§7/§8） |
| N3 控制变量实验：僵尸形成后手工断线即全绿（重建 → re-OPEN → 双侧 live，AC3 检查器零误报） | SA6 §7/§9 | 证明恢复机制本身完好、缺口仅为触发者——本设计把该手工动作变为超时路径的自动动作，走同一 `onTemporaryFailure` 轨道 |
| 排除项：liveness/连接级路径、Hub 侧独立死因、事件循环饥饿必要性 | SA6 §9 step6/7、§11 | 非目标（§1）；不新增 liveness 机制 |
| fake-wire 信封洞：丢帧后同连接再发帧 → SEQUENCE_VIOLATION，故该注入形态下任何合规修复都必须重置连接 | SA6 §11-4/§15-1 | 与方向 A 一致：重建 = 序列归零（§7 D1） |
| open/bootstrap 超时同构死局（同一 onTimerFired 尾部） | SA6 §10；SA8 冲突点 #4 | 本设计裁决为 timer 族一般化（§7 D2），配新增场景测试（§12） |
| 生产修复前契约测试保持红；不得以 skip/only/改断言转绿 | SA6 §15-4 | 文件范围 DENY LIST 明确冻结该文件（§11）；新增场景一律放新文件 |

上游事实与源码矛盾：未发现（SA6/SA8 全部行号锚点经本设计逐一复核成立）。

---

## 6. SA8 约束落实

| SA8 裁决/义务（D1–D5 + 实证注记） | 设计位置 | 处理方式 | 是否需要设计后冲突复查 |
|---|---|---|---|
| D1 方向二择：A（failed + 触发连接重建，零 wire 字节）完全落在现行条款内；B 属 evolution 级契约修订 | §7 决策 1 | **选 A**：保持 §13.2 `NAMESPACE_TIMEOUT → failed` 映射与 §1 不变量 4 不动；恢复 = 既有断线纪律的自动执行 | 本身不需要（SA8 已 clear 方向 A） |
| D1 附带义务：方向 A 落地时以 protocol §16（或 §18）补登记性文本：谁触发重建、close code、§18「epoch 必须在可能同步重入的 transport close() 前失效」纪律 | §8.4（文档变更） | §16 failed 词条扩写 + §18 L527 句补伴随句；close code 1001（§14 临时类）；epoch-first 复用 `detachCloseTimedOutTransport` 单点 | **是**（规范文档修订需复查，§15） |
| D2 一般化 vs 专项（open/bootstrap 同构死局；一般化与 §13.2 retryable=reconnect 对齐度更高） | §7 决策 2 | **timer 族一般化**（open/bootstrap/reconcile 共用同一 onTimerFired 尾部 + 同一 NAMESPACE_TIMEOUT 分类）；错误帧驱动的 reconnect 族不纳入（边界与理由见 §7/§13） | **是**（超出 issue 点名路径的裁决） |
| D3 回归场景第 6 步措辞内嵌方向 A 预期 | §12 | 契约已按方向 A 固化，设计不改写；选 B 才需改写——未选 | 否 |
| D4 勿混淆 channel 级 needs-resync 与 ReplicationSession sticky needs-resync | 全文 | 只在 channel 域叙述；Hub 半区 needs-resync 随旧 channel 消亡，新 channel 经 round 回 live | 否 |
| D5 整连接重建波及同连接其他 live namespace（churn/风暴风险属设计质量域） | §9.3/§13 | 走 §15.1 backoff（full jitter + attempts 增长 + ready 稳定 `resetAfterMs` 才清零）而非 requestRebuild 的立即重拨——风暴界有界；multiplex 影响配专项测试（§12） | 否（属设计质量，已内化） |
| 「§18 timeout 只收口 namespace」与方向 A 的字面张力：唯一自洽解读 = 超时本身不拆连接，但 failed 终态的既定恢复路径是连接重建；§16 已有「addTarget 触发整连接重建」先例 | §7 决策 3 | 采用该解读并在 §18 补伴随句登记（收口对象 ≠ 恢复触发者） | **是**（同 D1 文档义务） |
| ADR 0010 L165「普通超限关单 channel」仅辖资源超限域，不得援引否定方向 A；反向亦然 | §7 决策 2 | 触发面**不得**扩到 `retryable=config/no` 族（UPDATE_TOO_LARGE 等）——避免对稳定错误制造重连风暴，守住 L165 域界 | 否 |

---

## 7. 设计决策与主要备选方案

### 决策 1（D1）：方向 A —— `failed` 终态保持，超时路径自动触发连接重建

超时 → `finalize('failed')`（映射与终态语义不动）→ **同一点**上通知连接层执行重建。
零 wire 帧、零错误码、零 codec/注册表变更；SA6 契约断言形态（重建 + re-OPEN +
reconcile + 双侧 live）与 N3 控制实验证明的轨道完全一致。

**否决方向 B（非终态恢复 round，同连接续 round）**：需要 §13.2 重映射或 append-only
新错误码 + §16 新增 `reconciling → needs-resync` 本地边 + protocol 同步修订并以 ADR
修订节登记（SA8 冲突点 #2：静默落地 = hard-violation）；且 fake-wire 信封洞注入形态下
同连接续帧必然 SEQUENCE_VIOLATION，B 在契约场景内不可达（SA6 §15-1）。工程收益
（少一次重连）不抵契约修订成本与风险。

### 决策 2（D2）：触发面 = timer 族一般化（open/bootstrap/reconcile），按 §13.2 分类轴划界

- **纳入**：`onTimerFired` 非 periodic、非 close 尾部（三种 timer 共用）——全部映射
  §13.2 `NAMESPACE_TIMEOUT | retryable=reconnect`。一次落笔同时修复 issue 点名的
  reconcile 路径与 SA6 §10 实证的 open/bootstrap 同构死局；SA8 明示该一般化与
  §13.2 分类对齐度更高。
- **不纳入**：错误帧/本地映射驱动的 failed 终局（含同为 reconnect 分类的
  BOOTSTRAP_FAILED/APPLY_FAILED/INTERNAL_ERROR wire 族）。理由：(a) 不在红灯契约与
  issue AC 覆盖内；(b) 各路径存量测试钉住「收口后连接保持」（§2.2 表右列），逐一
  改版的爆炸半径需要独立的契约扩展与评审轮次；(c) 其中 `retryable=config/no` 族
  （UPDATE_TOO_LARGE、NAMESPACE_STATE_VIOLATION 等）按 ADR 0010 L165 属稳定错误，
  自动重连会制造无界风暴——**必须**排除。该边界以 §13.2 `retryable` 轴为准绳登记
  （protocol 文本修订一并写明），剩余 reconnect 族扩面记为 follow-up（§13）。

### 决策 3：重建走 §18 R4 detach-close + §15.1 backoff（close 1001），不复用 requestRebuild（close 1000 + 立即重拨）

对比两条既有重建编排：

| 维度 | requestRebuild（L939-969） | detachCloseTimedOutTransport + onTemporaryFailure（L644-666/L908-937） |
|---|---|---|
| 既有语义 | 外部刺激（config-change/re-add/auth-change）：立即生效 | 本端检测的临时失败（pong/hello-timeout）：恢复性 |
| close code | 1000 'replication-rebuild' | 1001（§14 临时类；§21 将无 GOAWAY 的 1001 视为普通临时断线） |
| 重拨 | deferTask → 立即 dialNow，**无退避** | §15.1 full-jitter backoff，attempts 增长，ready 稳定 `resetAfterMs` 才清零 |
| 风暴界 | 无（持续故障 → 恒速重连环） | 有界（稳态环周期 ≈ maxMs + 握手 + 超时窗） |

超时是**本端检测到的可复现故障**（事件循环饥饿/网络抖动可能持续），与 pong-timeout
同族；SA8 D5 的 churn/风暴风险由 backoff 界承担；§18 L525 已给出本端 close 的完整
纪律（停 liveness → 退订 → **epoch 先失效** → close(1001) → backoff 重连），逐字适用。
`onTemporaryFailure` 内建的 `stopping/backoff/blocked` 重入守卫与 attempts 记账同时
成为触发面的并发/幂等防线（§9）。N3 的恢复轨道（closeHubSide → backoff → 重拨 →
re-OPEN → live）与本路径在 peer 侧完全同构——契约断言面对齐。

### 决策 4：触发落点 = namespace 控制器 → 新增宿主面（PeerNamespaceHost facet）

`onTimerFired` 尾部 `finalize('failed')` 之后调用新宿主面
`requestConnectionRecovery(namespaceId)`；连接层实现（§8.2）持有全部连接态判据
（ready 门、stopping 门、transport 身份）。不选「在 finalize 内部无条件分派」：
finalize 的 26 个调用点覆盖 `retryable=config/no/recovery/reset` 各族，无条件重建
违反决策 2 的分类边界（UPDATE_TOO_LARGE 会风暴）；不选「连接层事后扫描」：
需要在每个可收口事件后轮询 controller 状态，落点多且漏检面大。facet 是本包既有
模式（`connectionFatal`/`requestDataDrain` 同族），`PeerNamespaceHost` 未从 index.ts
导出（内部缝，非公共 API 变更）。

### 决策 5：观测面零新增事件类型

恢复可观测性由既有事件完备承载：`channel-state-changed reconciling→failed`（终局）、
`connection-state-changed ready→backoff`（重建触发）、`connection-backoff-scheduled
{reason:'namespace-recovery'}`（新 reason 值，append-only——先例 #231）、新代
`connection-state-changed →ready` + `targeted/opening/…/live` 通道轨迹。新 reason 值
需同步 `PeerBackoffReason`（peer-connection.ts）与 types.ts 内联 reason 闭联合（镜像，
append-only）。

---

## 8. 接口、状态机和数据流

### 8.1 接口变更（全部内部缝 + append-only 观测值）

```ts
// peer-namespace.ts —— PeerNamespaceHost 新增（内部接口，未公共导出）：
/** issue #254：namespace 以 §13.2 retryable=reconnect 类失败收口（timer 族
 *  NAMESPACE_TIMEOUT）且 target 仍活跃时，请求连接层执行恢复性重建。 */
requestConnectionRecovery(namespaceId: string): void;

// peer-namespace.ts —— onTimerFired 尾部（L1520-1521 区域）：
//   §5.1：timeout 只收口 namespace（零 wire 帧）
this.finalize('failed');
//   §13.2 NAMESPACE_TIMEOUT retryable=reconnect × §16「failed 等待连接重建」：
//   target 仍活跃而连接仍存活时，重建触发者是本端（issue #254）。
if (this.intent === 'active') {
  this.host.requestConnectionRecovery(this.namespaceId);
}

// peer-connection.ts —— PeerBackoffReason 与 detachCloseTimedOutTransport 的
//   reason 闭联合各追加 'namespace-recovery'（close code 保持 1001）；
//   宿主装配（constructor host 字面量）新增：
requestConnectionRecovery: (namespaceId) => this.onNamespaceRecoveryRequested(namespaceId),

// peer-connection.ts —— 新私有方法（触发面单点）：
private onNamespaceRecoveryRequested(namespaceId: string): void {
  void namespaceId; // 不按 ns 分流：任一 recoverable failed 即整连接重建（§16 先例）
  if (this.stopping) return;                        // stop() 轨道自有收口
  if (this.connStateValue !== 'ready') return;      // 断线/重连/backoff/blocked/draining
                                                    // 已有既定恢复轨道（幂等门）
  const transport = this.transport;
  if (transport === undefined || transport.closed) return; // onClose 竞态防御
  if (this.detachCloseTimedOutTransport(transport, 'namespace-recovery')) {
    this.onTemporaryFailure('namespace-recovery', true); // epoch 已失效 → true
  }
}

// types.ts —— connection-backoff-scheduled.reason 闭联合追加 'namespace-recovery'
```

顺带清理：`finalize` 内 L1261-1262 空 `if (state === 'failed') {}` 死块删除（其位置
语义由 onTimerFired 尾部的显式分派承接；不改变 finalize 其余行为）。

### 8.2 状态机（新增触发边，全部为既有边的实例化）

```text
peer namespace:  reconciling/opening/bootstrapping
                  └─ timer(open|bootstrap|reconcile) 到期 @reconcileTimeoutMs 边界
                     → finalize('failed')                      [§13.2 NAMESPACE_TIMEOUT，不变]
                     → host.requestConnectionRecovery          [新增：唯一落笔点]
peer connection:  ready
                  ├─ namespace-recovery（本端）→（epoch 失效 → close 1001）→ backoff
                     └─ timer → connecting → handshaking → ready（新代）
                  其余状态收到触发 → no-op（幂等门）
复活（既有，零改动）：新代 ready → openActiveTargets → disconnected/failed → targeted
                     → startOpen → OPEN_NAMESPACE → … → live
```

AC3 合法性：终态 → `disconnected`（`onConnectionLost`，非活跃态）→ **新代 ready** →
`targeted`——SA6 §12.2 检查器以 ready 代际为尺，同代内终态→活跃迁移不存在。

### 8.3 数据流路线（运行时恢复流——控制面 + 资源生命周期）

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚点 |
|---|---|---|---|---|---|---|---|---|
| ①超时收口 | peer scheduler：reconcile/open/bootstrap timer 到期 | — | `onTimerFired` → `finalize('failed')`：clearAllTimers、setState、settleCloseMemo、排队 cleanupResources（claim 于同步段捕获） | 零 wire 帧 | observer `channel-state-changed …→failed` | Peer ns 瞬态 failed | cleanup 队列幂等兑付 | 契约 A1/A2 轨迹 |
| ②重建触发 | ①尾部分派 `requestConnectionRecovery` | epoch += 1（代际作废） | `detachCloseTimedOutTransport('namespace-recovery')`：停 liveness → 退订 transport → **epoch 先失效** → close(1001)（§18 L525 纪律单点承载） | WS close(1001)（粗分类临时；reason 串为本地诊断，非协议字节） | observer `connection-state-changed ready→backoff`；hub 侧 onClose → 对称 teardown（§16：session/Lease cleanup，不影响其他 Peer） | 连接层离开 ready；迟到续体被 epoch/退订双门吸收 | adapter close 抛错 → `emitConnectionFailed('INTERNAL_ERROR',1011)` + `enterBlocked()`（既有防御，复用） | N3 同轨道实证；A1/A2 `wires≥2/dials≥2` |
| ③backoff 重拨 | ②的 `onTemporaryFailure('namespace-recovery', true)` | attempts += 1；backoffHandle 武装 | full jitter（§15.1）；控制器逐个 `onConnectionLost()`：failed→disconnected、活跃→disconnected，cleanup 排队（§16：停接纳、排空已接纳 apply、release Lease、target 保留） | — | observer `connection-backoff-scheduled{reason:'namespace-recovery'}` + 逐 ns `…→disconnected` | 退避后 `dialNow()`：新 transport、新 OutboundQueue（peer 序列自 1 重置；hub expectedSeq 随新连接重置） | stopping 守卫；重入守卫（backoff/blocked 早退） | 契约 N1（边界前零动作）；新 churn-bound 场景 |
| ④复活收敛 | 新代 HELLO_ACK → `openActiveTargets()` | registry.open → 新 Lease；openReplicationSession → 新 session | disconnected/failed → targeted → startOpen；OPEN_NAMESPACE → hub authorize → OPEN_OK（身份匹配）→ reconciling | OPEN/SYNC_STEP1/2/APPLIED（新 wire，序列从 1） | observer 新代 ready + 通道轨迹；hub 侧新 channel opening→…→live | 双侧 `live`；Hub 旧 needs-resync channel 随旧连接消亡，新 channel 经 round 回 live（§9.4 Peer 发起新 roundId） | 途中再次超时 → 回到①（有界环） | 契约 A1/A2 终态 + 双向写收敛 |
| ⑤旧代资源兑付 | ①/③ 排队的 runDisposal | — | session.close → lease.release（ADR 0010 L90 顺序）；身份守卫（`this.session === claim.session`）防跨代误杀 | — | — | gen-N session/lease 零泄漏；aux（watchdog/round/channel）teardown | 各步局部吞错（R1 #7 纪律） | 契约 AC4 哨兵（零 unhandled rejection + 收敛） |

业务数据面无新路径：断线期间不维持 outbox（§16 既有），未发送队列按既有 teardown
丢弃、恢复由 state-vector round 修复；双侧均为全量本地副本，重连即收敛。

### 8.4 文档变更（SA8 D1 附带义务的落实）

1. `docs/protocols/instance-replication-v1.md` §16：`failed` 词条扩写为——「`failed`：
   等待连接重建或配置变化。当 failed 源于 §13.2 `retryable=reconnect` 分类（如
   NAMESPACE_TIMEOUT）且 target 仍被需要而连接仍存活时，由 Peer 控制器触发整连接
   重建：先使 connection epoch 失效再关闭传输（close code 1001，§18 纪律），经
   §15.1 backoff 重连后重 OPEN/reconcile。」
2. 同文件 §18 L527 句后补伴随句：「Open/bootstrap/reconcile timeout 收口 namespace
   为 `failed` 后，若 target 仍活跃且连接仍存活，Peer 必须按上句触发连接重建——
   超时的直接收口对象是 namespace，重建是 `failed` 终态的既定恢复路径（§16）。」
3. 同文件 §15.1 ready 出边注记：`namespace-recovery` 为 `temporary-close → backoff`
   的本端触发实例（不新增边）。
4. `docs/adr/0010-hub-peer-websocket-ydoc-replication.md` 追加修订节
   「issue #254 修订（recoverable namespace timeout 的连接重建触发）」：登记触发
   谓词（§13.2 timer 族 + target 活跃 + 连接存活）、close code 1001 与 epoch-first
   纪律、backoff 风暴界、以及「L165 资源超限域不受影响」的域界声明。

---

## 9. 错误、恢复、并发和幂等

1. **失败语义不变**：超时仍 `failed`（§13.2 映射零变更）；新增的只是 failed 之后
   的恢复触发。异常路径显式失败类型 = 既有 `connection-backoff-scheduled` +
   close(1001)；无静默 fallback（触发条件不满足时连接维持现状——那正是
   `retryable=config/no` 族的既定等待语义）。
2. **并发/幂等**：
   - 同 tick 多 namespace 超时：首个触发使 connState 离开 ready，后续触发被
     `connStateValue !== 'ready'` 门吸收（零重复 close/重拨）；`onTemporaryFailure`
     自带 backoff/blocked 重入守卫。
   - 与 `requestRebuild` 交错：backoff 期收到 config-change/re-add → 既有编排
     clearBackoff 后接管；disconnected 重建编排期触发 → ready 门 no-op
     （`rebuildPending` 轨道已排队 dialNow）。
   - 与 stop() 竞态：stop 同步清 timer + `stopping` 门双保险。
   - 与 GOAWAY drain 竞态：draining 态触发 → ready 门 no-op（drain deadline 拥有
     连接；drain 期 timer 已被 `onConnectionQuiesce` 清除，正常不可达，门为纵深）。
   - timer 回调内同步重入：transport.close() 同步回调 onClose 被「先退订 + epoch
     先失效」双门吸收（§18 R4 既有纪律，`detachCloseTimedOutTransport` 单点承载）。
3. **在途异步续体**：超时重建后，旧代 registry.open / importReplica /
   openReplicationSession 续体由既有 epoch 门 + `isConnectionDead()` 静默回滚
   （`releaseLeaseOrNoop`）；round/channel/watchdog 由 runDisposal 身份守卫处置
   （L1328-1344）——全部既有纪律，零新增。
4. **AC4 生命周期**：恢复 = 一次受控断线；`onConnectionLost` → `cleanupResources`
   → `runDisposal`（session.close → lease.release，claim 排队前捕获）与任何真实
   网络断线逐字同构；契约的零 unhandled rejection + 双向收敛哨兵即功能级验证。
5. **风暴界（D5 落实）**：持续故障下环周期 = 握手 + 超时窗 + backoff(attempts↑，
   cap→maxMs=30s 缺省；ready 稳定 `resetAfterMs`=10s 才清零)。openTimeout(5s) <
   resetAfterMs(10s) ⇒ attempts 单调增长至 cap，稳态重试率有界且低频；每次尝试的
   `connection-backoff-scheduled{reason:'namespace-recovery'}` 提供告警面。

---

## 10. 调用方影响矩阵

| 调用方 | 当前处理 | 设计后处理 | 所需改动 | 证据 |
|---|---|---|---|---|
| `PeerNamespaceHost` 实现（唯一：`PeerConnectionImpl` constructor 装配） | 无该面 | 新增 `requestConnectionRecovery` 装配 | peer-connection.ts 装配 + 新私有方法 | peer-connection.ts L94-117；index.ts 未导出该接口 |
| `detachCloseTimedOutTransport` 调用点 | pong-timeout / hello-timeout | + namespace-recovery（第三调用点；身份守卫冗余断言已内建，fail-loud） | reason 闭合并追加 | peer-connection.ts L644-666、L451、L988 |
| `onTemporaryFailure` 调用点 | dial-failed/socket-closed/hello/pong/backpressure/goaway | + namespace-recovery（既有重入/停止守卫直接复用） | reason 闭合并追加 | peer-connection.ts L908-937 |
| `PeerBackoffReason` / types.ts 内联 reason 消费者（observer 订阅方、现有断言特定 reason 的测试） | 7 值闭集合 | 8 值（append-only；既有消费者按值匹配不受影响） | types.ts + peer-connection.ts 同步追加 | types.ts L287-297；先例 issue #231 |
| 存量测试 3 场景（ac4 §9.3 / ac3 §18 / sa4 F2） | 钉住静态僵尸（`waitNamespace('failed')`） | 按新契约改版：事件轨迹断言瞬态 failed + 重建/恢复行为（口径见 §12） | 三文件局部改版 | §2.2 表 |
| 其余 `failed` 断言测试（错误帧/registry 拒绝驱动） | 收口后连接保持 | 行为不变（触发面仅 timer 族） | 无 | §2.2 表右列 |
| Hub 侧（hub-connection/hub-namespace/plugin） | close → 对称 teardown | 不变（peer 发起 1001 与网络断线同观测面） | 无 | §8.3 路线②；N3 |
| Cordis 插件层（plugin.ts） | 组合 createPeerReplication | 不变（未耦合内部 facet） | 无 | plugin.ts 装配面 |

---

## 11. 文件范围

### ALLOW LIST

| 路径 | 预期改动 | 原因 |
|---|---|---|
| `packages/ws-replication/src/peer-namespace.ts` | `PeerNamespaceHost` 新增 facet 声明；`onTimerFired` 尾部 finalize 后分派（intent 门）；删除 finalize 内空 `if (state==='failed'){}` 死块；注释 | 触发落点（决策 4） |
| `packages/ws-replication/src/peer-connection.ts` | `PeerBackoffReason`/detach reason 追加 `'namespace-recovery'`；宿主装配；新私有方法 `onNamespaceRecoveryRequested` | 触发面单点 + §18 纪律复用（决策 3） |
| `packages/ws-replication/src/types.ts` | `connection-backoff-scheduled.reason` 追加 `'namespace-recovery'` | 观测闭联合镜像（append-only） |
| `packages/ws-replication/test/ws-replication-ac4-reconcile.test.ts` | §9.3 场景改版：事件轨迹断言 `reconciling→failed` + 重建后回 live；保留同 wire 单 round 纪律 | 僵尸钉住面改版（§2.2） |
| `packages/ws-replication/test/ws-replication-ac3-bootstrap.test.ts` | §18 bootstrap timeout 场景改版：瞬态 failed 轨迹 + 新 wire 合法重发快照 + 收敛 live；`droppedFrames` 断言保留 | 同上 |
| `packages/ws-replication/test/ws-replication-sa4-f1-f2-f3-red.test.ts` | F2 改版：瞬态 failed 轨迹 + 有界重试环（dialCount 增长）+ release 后恢复 live | 同上 |
| `packages/ws-replication/test/ws-replication-issue254-timeout-recovery.test.ts`（新文件） | open/bootstrap 超时自愈、双 ns multiplex、churn 有界性四类场景 | D2 一般化的验收扩展（SA6 §15-3 邀请的同款断言形态） |
| `docs/protocols/instance-replication-v1.md` | §16/§18/§15.1 登记性文本（§8.4-1/2/3） | SA8 D1 附带义务（doc-gap 收口） |
| `docs/adr/0010-hub-peer-websocket-ydoc-replication.md` | 追加 issue #254 修订节（§8.4-4） | docs/AGENTS.md 修订登记纪律 |

### DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
|---|---|---|
| `packages/ws-replication/test/ws-replication-issue254-ac-red.test.ts` | SA6 冻结红灯契约 | SA6 §15-4：只有生产行为变更可使其转绿；不得以改断言/skip/only 方式变绿；新增场景放新文件 |
| `packages/ws-replication/src/hub-connection.ts`、`hub-namespace.ts` | Hub 半区 | 零 Hub 侧变更：Peer 拥有重拨所有权（ADR 0012 L36）；Hub 需要区分静默终态 Peer 势必引入新 wire 字节 |
| `packages/replication-protocol/**` | wire 契约 | 决策 1：零 wire 字节变更；§13.2 注册表不动 |
| `packages/namespace-registry/**`、runtime、persistence 各包 | Lease/session/apply 纪律 | 全部复用既有编排（ADR 0010 L90），无新义务 |
| `packages/ws-replication/src/frame-io.ts`、`backpressure.ts`、`round-engine.ts`、`update-channel.ts`、`liveness.ts`、`fence-watchdog.ts`、`validate.ts`、`defaults.ts` | 邻接机制 | 恢复不触碰帧编解码/背压/round 结构/liveness；timeout 与 backoff 缺省值不变 |
| `packages/ws-replication/test/ws-replication-periodic-reconcile.test.ts` | issue 点名盲区测试 | 修复后仍绿（推进量 < 超时）；盲区已由契约 N1 补完，无需改 |
| `wiki/raw/task_issue-254*.md`（sa6/sa8/简报/日志） | 上游产物 | 只读输入 |
| `CONTEXT.md` | 词汇表 | 未引入/更改域术语（D4 两域词汇已存在且不混淆） |

---

## 12. 验收与验证映射

| 需求或风险 | 现有证据 | 所需行为测试或动态场景 | 预期观察 |
|---|---|---|---|
| AC1/AC2/AC6 超时自愈 + 重建 + 收敛 | 契约 A1/A2 红（SA6 亲跑 10/10） | 既有 `ws-replication-issue254-ac-red.test.ts`（不改） | A1/A2 转绿：`wires≥2`/`dials≥2`、新 wire 含 OPEN_NAMESPACE + SYNC_STEP1、双侧 live、双向写收敛 |
| AC3 终态不重开 | 契约 §12.2 检查器（N3 零误报实证） | 同上（全场景执行检查器） | 零违例：终态→disconnected→新代 ready→targeted |
| 边界纪律（不提前动作） | 契约 N1 绿 | 同上 | timeout−1ms 处 reconciling、wires==1、dials==1 |
| 正常轮询零 churn | 契约 N2 绿 | 同上 | 健康 round 完成、cadence 再武装、零重建 |
| AC4 排空/无泄漏 | 契约哨兵 + 既有 cleanup 纪律 | 同上（零 unhandled rejection + 双向收敛） | 哨兵通过 |
| D2 一般化（open 超时） | 本设计 §2.1-1（同尾部） | 新文件场景 1：authorize 悬挂 → openTimeout → 瞬态 failed（事件轨迹）→ 重建环有界（dialCount 增长）→ release → live | 自愈且环率受 backoff 界 |
| D2 一般化（bootstrap 超时） | ac3 §18 现场景（改版） | 新文件场景 2：丢 BOOTSTRAP_SNAPSHOT → 超时 → 重建 → 新 wire 快照到达 → live；同 wire 不重发纪律保留 | 收敛 |
| D5 multiplex 影响 | §16 断线纪律（源证据） | 新文件场景 3：双 ns live，ns-A reconcile 超时 → 整连接重建 → 双 ns 均回 live、双向数据收敛 | 兄弟 ns churn 可恢复、无数据丢失 |
| 风暴有界性 | §9.5 推导 | 新文件场景 4：持续悬挂窗口内 dialCount 增长率 ≤ backoff 界（虚拟时间窗内有限次） | 有界重试、零 unhandled rejection |
| 存量回归 | 全量 suite 基线 366 passed（SA6 §14） | `pnpm exec vitest run packages/ws-replication/test` + 根 `pnpm typecheck` + `pnpm test`（模块 AGENTS 验证门） | 3 个改版场景绿；其余零回归（含 real-transport 已知抖动项按 SA6 §14 口径单独复跑） |
| 文档登记 | SA8 D1 义务 | 评审核对 §8.4 文本落位 | §16/§18/§15.1/ADR 0010 修订节齐备 |

SA1 不编写/运行测试；上表为后续实现与验证轮次的可执行验收口径。

---

## 13. 风险、回滚和残余问题

**风险**：

1. **存量测试爆炸半径可能大于 §2.2 枚举**（timer 到期与长推进交错的隐性场景）。
   缓解：全量 suite 为硬验收门；改版口径已定型（瞬态 failed 用事件轨迹断言、恢复
   行为按新契约断言），未知命中者按同口径收敛即可，不需设计变更。
2. **持续故障下的重试环**（F2 形态从静态僵尸变为有界环）。这是 AC1「无需人工重启」
   的有意语义变化：故障源恢复后通道自动恢复；环率被 backoff 界压制并有
   `connection-backoff-scheduled` 告警面。运营侧需知悉（ADR 修订节登记）。
3. **multiplex churn**（D5）：同连接兄弟 namespace 每次恢复都重 OPEN/reconcile。
   数据无丢失（全量副本 + state-vector round）；频繁超时的部署应先治理诱因
   （issue「非结论」：事件循环/写序饥饿）。属可接受代价，非本设计缺陷。
4. **close code 1001 选择**：与 requestRebuild 的 1000 并存。已在 §18/§16 文本登记
   分类依据（临时/恢复性 vs 配置变化）；Hub 粗分类处理，无兼容风险。

**回滚**：变更面收敛于 3 个源文件的单一边缘路径 + 3 处测试改版 + 文档。回滚 =
revert 提交即可恢复基线行为（僵尸回归但无数据损坏面：恢复路径本身无持久化变更）。

**任务内解决项**：§8 全部（含文档与测试）。

**残余问题 / follow-up（非本任务必要条件）**：

1. wire ERROR 帧驱动的 `retryable=reconnect` failed 族（BOOTSTRAP_FAILED/
   APPLY_FAILED/INTERNAL_ERROR 收帧）同构僵尸未纳入触发面——需独立红灯契约扩展
   + 存量「收口后连接保持」断言的逐场景评审（决策 2 边界，已按 §13.2 轴登记）。
2. `NAMESPACE_REOPEN_REQUIRES_RECONNECT`（terminalState=closed）防御路径的重建
   触发语义未动（现不可达：Peer 不在同连接重 OPEN）。
3. 事故报告原始日志（`/tmp/mabf-*`，报告方保留）未入库——验收以确定性契约为准，
   不阻塞。

---

## 14. 评审修订映射

`wiki/raw/task_issue-254_sa2_review.md` 不存在（iteration 0 首版设计）——无适用
finding。后续评审输入到达时按 skill §10 逐条落实并在此表登记。

---

## 15. 是否需要设计后 ADR 冲突复查及理由

**需要（`requiresConflictRecheck: true`）**。理由：

1. **规范文档修订**：protocol §16/§18（及 §15.1 注记）将被追加登记性文本——虽为
   SA8 预先定性为 doc-gap 收口（非契约修订），但落地文本（触发谓词、close code
   1001、§18 伴随句）是对既有「timeout 只收口 namespace」句的显式澄清，应经冲突
   复核确认不与 ADR 0010 L147/L165 等冻结面产生新张力。
2. **状态机语义变化**：`ready ├─ namespace-recovery → backoff` 是既有 temporary-close
   边的新触发实例 + 新 backoff reason 值（公共观测类型 append-only 扩展）——按
   skill 标准（wire/状态机语义变化 → 复查）提交。
3. **裁决越出 issue 点名路径**：D2 timer 族一般化（open/bootstrap）是 SA8 显式留给
   SA1 的开放裁决（冲突点 #4），其与 §13.2 分类的对齐性应由设计后复查背书。

SA8 已 `clear` 方向 A 本体（含零 wire 字节结论）；上述复查针对本设计的具体化与
一般化边界，不阻塞实现轮次启动。
