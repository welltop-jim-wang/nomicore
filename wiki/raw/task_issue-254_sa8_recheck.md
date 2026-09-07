# SA8 冲突门禁报告（设计后复审）— issue #254 SA1 设计 vs ADR/CONTEXT 决议集

- 被审对象：`wiki/raw/task_issue-254_design.md`（SA1 设计，iteration 0，自记 `requiresConflictRecheck: true`）
- 冲突基准：`docs/adr/` 全集 0001–0012 + `CONTEXT.md`；wire/状态机/观测语义按 ADR 0010 L151 并入
  `docs/protocols/instance-replication-v1.md`（下称 protocol，§n 引用）；文档修订纪律按 `docs/AGENTS.md`
- 复审类型：Phase 设计后复审（SA2 全维度攻击评审之前的冲突复核；不判断设计优劣/实现质量）
- 基线：HEAD `6a005a4`（branch `mabf/issue-254`）；SA6 契约
  `packages/ws-replication/test/ws-replication-issue254-ac-red.test.ts` 在场且未被改动（git 未跟踪新文件）
- Issue comments：REST 读取为空（SA6/SA1/SA8 三方同证）——无 owner 反馈适用项
- 上游链：SA8 前置门禁 `wiki/raw/task_issue-254_sa8_gate.md`（verdict `clear`，D1–D5 移交）→ SA6 契约（红 10/10）→ SA1 设计（本复审对象）

## Verdict

**`clear`** —— 设计与 ADR/CONTEXT 决议集零冲突，可进入 SA2 设计评审。

裁决分布：**0 hard-violation、0 evolution 级契约修订、0 override-declared、5/5 派发复查面 no-conflict**；
另有 **2 条 advisory 文档精度项（R1/R2，须并入设计 §8.4/§11 后落地，均不阻塞、不改任何决策语义）**
与 3 条范围注记（N1–N3，无需动作）。

一句话理由：SA1 设计把 SA8 已放行的方向 A 具体化为「failed 终态不动 + 超时收口后由 Peer 控制器
触发整连接重建（§18 epoch-first + close 1001 + §15.1 backoff）」，全部动作都是既有条款
（§1 不变量 4、§13.2 `NAMESPACE_TIMEOUT → failed(reconnect)`、§15.1 temporary-close 边、§16 断线纪律
与「addTarget 触发整连接重建」先例、§18 L525 纪律、§21 无 GOAWAY 1001 = 普通临时断线、ADR 0012 L36
Peer 拥有 dial loop）的实例化——零 wire 字节、零错误码、零注册表/状态机新边；D2 一般化严格按
§13.2 `retryable` 轴划界并显式排除 `config/no` 族（守住 ADR 0010 L165 域界）；文档修订走
protocol 显式修订 + ADR 0010 修订节，符合「显式修订、不静默矛盾」纪律。两处 advisory 均是
**文档登记面的精度缺口**（漏登记 append-only 观测值、两处 normative 文本谓词宽窄不一），
修复只增文字、不动任何决策。

## 派发复查面逐项裁决

### 1. 超时触发的连接恢复（方向 A 的具体化）—— no-conflict

| 设计动作 | 基线条款 | 复核结论 |
|---|---|---|
| 超时仍 `finalize('failed')`，映射与终态语义零变更；新增的只是 failed 之后的恢复触发 | §13.2 `NAMESPACE_TIMEOUT \| yes \| reconnect \| failed`；§16「`failed`：等待连接重建或配置变化」 | ✓ 收口语义逐字保持；`retryable=reconnect` 蕴含重连为既定恢复模态，触发者落在 Peer 控制器正是前次门禁定性的 doc-gap 收口 |
| 复活只经 终态 → disconnected（连接死投影）→ 新代 ready → targeted → startOpen | §1 不变量 4（同一连接内终态不得重开）；§16 socket 断开投影纪律 | ✓ 代码实证：`openActiveTargets()`/`onConnectionReady()` 仅复活 `disconnected/failed` 且 `intent==='active'`，`closed/conflicted` 等显式 re-add；同代内终态→活跃迁移不存在，AC3 检查器口径成立 |
| 重建 = `detachCloseTimedOutTransport` 单点（停 liveness → 退订 → **epoch 先失效** → close(1001)）+ `onTemporaryFailure` backoff 重拨 | §18 L525「先停止旧 liveness、退订旧 transport listener 并使 connection epoch 失效，再关闭传输（close code 1001）并经 backoff 重连；epoch 必须在调用可能同步重入的 transport `close()` 前失效」 | ✓ 逐字复用既有 normative 纪律（pong-timeout 同族代码路径，含 close 抛错 → `INTERNAL_ERROR`/1011 + blocked 既有防御）；无新编排义务 |
| `ready ├─ namespace-recovery → backoff` | §15.1 `ready ├─ temporary-close → backoff` | ✓ 新触发实例而非新边；设计 §8.4-3 以注记登记（不新增边）——与状态机冻结文本一致 |
| close code 1001（而非 requestRebuild 的 1000 + 无退避立即重拨） | §14 粗分类；§15.1「网络断开或无明确 GOAWAY 的 1001：普通 backoff」；§21 issue #229（无 GOAWAY 的 1001 = 普通临时断线，Peer 保有重拨所有权） | ✓ 本端检测临时失败关 1001 已由 §18 pong-timeout 规则确立为先例；Hub 侧按 §16 对称 teardown。注记：§14 字面枚举未列「本端检测的临时失败」，登记文本应如设计所做锚定 §18 纪律而非 §14 枚举（设计已如此） |
| 触发落点 = namespace 控制器 → `PeerNamespaceHost.requestConnectionRecovery` facet（内部缝） | ADR 0012 L36（Peer plugin 拥有 dial loop、连接/channel、进程内 targets） | ✓ Peer 侧本地发起重建属既定所有权；facet 为本包既有模式（`requestDataDrain`/`connectionFatal` 同族，实证接口在场且未从 index.ts 导出）；DENY LIST 冻结 Hub 半区与 replication-protocol 包——零 Hub 变更、零 wire 字节成立 |
| 与 GOAWAY drain/blocked/stop/重入竞态：ready 门 + stopping 门 + 既有守卫 | §6.3（drain deadline 拥有连接）；§15.1 各态出边 | ✓ 非 ready 态一律 no-op：draining 由 deadline 收口（§15.1 draining → stopped\|backoff）、blocked 等配置变化、backoff 既有轨道接管——无任何状态机出边被绕过 |

### 2. 一般化超时触发面（D2：timer 族）—— no-conflict

- **纳入集 = open/bootstrap/reconcile 三种 timer**：代码实证 `onTimerFired` 尾部对非 periodic、
  非 close 的 timer 一律 `finalize('failed')`——恰为本地映射 §13.2 `NAMESPACE_TIMEOUT`（retryable=reconnect）
  的全集。一次落笔修复 issue 点名路径与 SA6 §10 实证的同构死局，与 §13.2 分类轴对齐度更高
  （前次门禁 D2 预判成立）。无冻结条款限定「恢复触发只许 reconcile 专项」。
- **排除 close timeout —— 范围注记 N1（无需动作）**：close 分支收口 `closed`（代码注释自引 §12/§13
  语义：close 不再等待），`closed` = 正常生命周期完结（§16「正常 remove 或 connection drain」），
  非 `retryable=reconnect` 终态；进入 closing 的活跃 intent 场景（GOAWAY drain）连接本身正被
  deadline 收口，存在恢复出口。排除不产生新僵尸，亦不与 §18「close timeout 只收口 namespace」矛盾。
- **排除 ACK timeout**：映射 `needs-resync`（非终态），同连接新 round 即恢复（§9.4 Peer 以新
  roundId 发起）——恢复轨道已存在，无需重建。✓
- **排除 wire ERROR 帧驱动的 reconnect 族**（BOOTSTRAP_FAILED/APPLY_FAILED/INTERNAL_ERROR 收帧）
  并记 follow-up：§16「等待连接重建」未规定触发时限，延迟实现不构成违约；该族僵尸为存量状态、
  本设计不使其恶化。显式排除 + follow-up 登记是合规的范围裁决。
- **`retryable=config/no` 族硬排除**（UPDATE_TOO_LARGE/SYNC_DIFF_TOO_LARGE/BOOTSTRAP_TOO_LARGE/
  NAMESPACE_STATE_VIOLATION 等）：守住 ADR 0010 L165「普通超限以稳定错误关闭单个 channel」的
  资源超限域界，避免对稳定错误制造无界重连风暴——与前次门禁「L165 不得援引否定方向 A；反向亦然」
  的双向域界声明一致。✓

### 3. backoff 行为 —— no-conflict

- 复用 §15.1 full-jitter（`cap = min(maxBackoffMs, baseBackoffMs * 2^attempt)`、`delay = random(0, cap)`）
  与「只有 ready 稳定超过 `backoffResetAfterMs` 才清零 attempt」，缺省不变（代码实证：
  base 100ms / max 30s / reset 10s；open 5s / reconcile 10s；`defaults.ts` 在 DENY LIST）。
- 风暴界推导成立：持续悬挂环内 ready 驻留 ≈ openTimeout(5s) < resetAfterMs(10s) ⇒ attempts
  单调增长至 cap=30s，稳态环周期有界且低频，每次尝试有 `connection-backoff-scheduled` 告警面——
  与 §15.1 公式及 1011「连续失败后降为低频」的既有低频化精神一致。F2 形态从静态僵尸变为有界环
  属 AC1「无需人工重启」的语义内变化，已在 ADR 修订节登记运营知悉义务。
- 选择 §18 R4 detach-close 轨道而非 `requestRebuild`（1000 + deferTask 立即重拨、无退避）：
  两者均为既有编排；恢复性场景走带退避轨道属设计质量域（SA2），无基线冲突。`onTemporaryFailure`
  自带 stopping/backoff/blocked 重入守卫与 attempts 记账（代码实证）成为触发面的幂等防线。✓

### 4. multiplex 波及（D5）—— no-conflict

- 整连接重建使同连接兄弟 live namespace 经 disconnected 投影 → 新代 re-OPEN/reconcile：与任一
  真实网络断线逐字同构，全部落在 §16 断线纪律内（「控制器投影为 disconnected……target 保留」
  「断线期间不维持 outbox……重连后从当前 Y.Doc state vector 恢复」；ADR 0010 L151「不保留
  outbox」）。Hub 侧对称 cleanup「不影响其他 Peer」（§16）。
- 数据收敛由 §9 state-vector round 保证（双侧全量本地副本）；设计配双 ns multiplex + 收敛专项
  场景（新文件场景 3）。churn 频度受 checkpoint 3 的 backoff 界约束。✓
- 同 tick 多 ns 超时的并发吸收（首个触发离开 ready，后续 no-op）：零重复 close/重拨，与 §18
  单次 close 语义一致。✓

### 5. protocol/ADR 文档修订 —— no-conflict（含 2 条 advisory 精度项）

修订纪律本身合规：protocol §16/§18/§15.1 显式修订 + ADR 0010 追加「issue #254 修订节」，
满足 docs/AGENTS.md「显式修订、不静默矛盾」与前次门禁 D1 附带义务；§18 伴随句采用门禁已
裁定的「唯一自洽解读」（收口对象 ≠ 恢复触发者），消除而非制造基线内部张力。

**R1（advisory，登记面缺口——须补入设计 §8.4 与 §11 ALLOW LIST）**：
设计决策 5 向代码闭集合（`types.ts` 内联 reason 合 + `peer-connection.ts` `PeerBackoffReason`，
各 7 值→8 值）追加 `'namespace-recovery'`，但 §8.4 文档变更清单与 §11 ALLOW LIST **未包含
protocol §23.1 的 reason 枚举修订**。§23.1 将 `connection-backoff-scheduled.reason` 的 7 值
闭集合登记为规范观测契约（append-only：「reason/cause/via 词表……只增不改」）；仓库先例
（issue #238，ADR 0010 修订节明文）要求此类追加「由 §23.1 显式修订登记，标 issue 号」；
docs/AGENTS.md 要求「code behavior changes 时更新每一份 stated contract 变更的 normative
document」。**修复**：§8.4 增补一条——protocol §23.1 `connection-backoff-scheduled.reason`
枚举追加 `'namespace-recovery'`（标注 issue #254，append-only），并同步 §11 ALLOW LIST 的
protocol 行预期改动描述。只增文字，不动任何决策语义，不构成阻塞。

**R2（advisory，谓词宽窄不一——须对齐两处 normative 文本）**：
§8.4-1 拟写的 §16 登记文本以「failed 源于 §13.2 **retryable=reconnect 分类**（如
NAMESPACE_TIMEOUT）」为触发谓词（类宽读法），而 §8.4-4 的 ADR 修订节与实现（决策 2/4：
timer 族单点落笔 + finalize 内无条件分派被明确否决）均以「**§13.2 timer 族**」为界，wire
ERROR 驱动的 reconnect 族显式记 follow-up。按 §8.4-1 现文落地，protocol 将登记 implementation
不具备的行为（BOOTSTRAP_FAILED/APPLY_FAILED/INTERNAL_ERROR 收帧后即重建），违反 docs/AGENTS.md
「documentation-only wording changes must not invent implementation behavior」，且两份 normative
文档谓词不一致。**修复**：§8.4-1 措辞收窄至 timer 族（本地 NAMESPACE_TIMEOUT 超时），或与
§8.4-4 同款地在两处文本一致登记「reconnect 族剩余路径为未实现 follow-up」。同样只动文字，不阻塞。

**范围注记 N2（无需动作）**：§23.3 Safe-field 允许 reason 稳定字面量——`namespace-recovery`
为低基数闭集合字面量，合规；`PeerBackoffReason`/types.ts 双镜像 append-only 同步与先例 #231
同构。CONTEXT.md 无需变更（`namespace-recovery` 是观测字面量，非域术语；D4 两域
needs-resync 词汇未被触碰——设计全文只在 channel 域叙述，合规）。

## 前次门禁 D1–D5 义务落实核验

| 义务 | 设计落实 | 复核 |
|---|---|---|
| D1 方向 A/B 二择 + 方向 A 的 protocol 登记（谁触发、close code、epoch-first） | 选 A；§8.4-1/2/3 + ADR 修订节 | ✓（R2 对齐谓词后完备） |
| D2 一般化 vs 专项 | timer 族一般化，按 §13.2 `retryable` 轴划界，config/no 族硬排除 | ✓（见复查面 2） |
| D3 回归场景第 6 步内嵌方向 A | 契约不改写（选 A 无需改写） | ✓ |
| D4 两域 needs-resync 勿混淆 | 只在 channel 域叙述；CONTEXT.md 词汇零变更 | ✓ |
| D5 multiplex churn/风暴 | §15.1 backoff 界 + 专项场景测试 | ✓（复查面 3/4） |

## 实证核验（前置事实，非阻塞依据；行号 = 基线 6a005a4）

| 设计主张 | 证据 | 结论 |
|---|---|---|
| 非周期、非 close timer 到期统一 `finalize('failed')`；close 分支收口 `closed`；periodic 分支重武装 | `peer-namespace.ts` `onTimerFired`（L1505-1522 区域）逐分支核验 | ✓ |
| `finalize` 内空 `if (state === 'failed') {}` 死块存在 | `peer-namespace.ts` L1259-1269 | ✓ |
| 终态 namespace 入站静默（`onResyncReceived` quiet 门） | `peer-namespace.ts` L534-540 | ✓ |
| `detachCloseTimedOutTransport`：身份守卫 → 停 liveness → 退订 → epoch+1 → close(1001) → 抛错防御（INTERNAL_ERROR/1011 + blocked）；reason 现为二值闭合 | `peer-connection.ts` L644-666 | ✓ |
| `onTemporaryFailure`：stopping/backoff/blocked 守卫、epoch 条件失效、attempts+1、setState('backoff')、逐 controller `onConnectionLost()`、full jitter、`emitBackoffScheduled`、timer→`dialNow` | `peer-connection.ts` L908-937 | ✓ |
| `requestRebuild`：close(1000,'replication-rebuild') + deferTask 立即 dialNow、无退避 | `peer-connection.ts` L939-969 | ✓ |
| `PeerBackoffReason` 与 types.ts 内联 reason 合各 7 值镜像 | `peer-connection.ts` L38-45；`types.ts` L287-297 | ✓ |
| backoff 缺省 base 100ms / max 30s / reset 10s；open 5s、reconcile 10s、close 5s、ack 10s | `defaults.ts` | ✓ |
| 复活谓词：`openActiveTargets`/`onConnectionReady` 仅 `disconnected/failed` + `intent==='active'`；closed/conflicted 等显式 re-add | `peer-connection.ts` L685-697；`peer-namespace.ts` L832-838 | ✓ |
| `PeerNamespaceHost` facet 模式在场且未公共导出（index.ts 仅导出 `createPeerReplication`） | `peer-namespace.ts` L39；`peer-connection.ts` L55；`index.ts` L6 | ✓ |
| SA6 冻结契约在场、未改；SA2 评审文件不存在（iteration 0） | git status + `wiki/raw/` 清点 | ✓ |

## 结论与后续门禁判定

**`clear`。** SA1 设计的五 个派发复查面（超时触发恢复、一般化触发面、backoff 行为、
multiplex 波及、protocol/ADR 文档修订）全部落在既有决议（ADR 0010/0012 + protocol v1 +
CONTEXT.md）条款之内或为其显式 append-only/登记性扩展：零 wire 字节、零错误码与注册表变更、
零状态机新边、零所有权越界、零 Hub 侧变更。R1/R2 两条 advisory 仅涉及文档登记面的完整与
一致，修复为纯文字增改，已具名到设计章节，随 SA2 评审修订一并落实即可。

**`requiresConflictRecheck: false`** —— 前提：设计若按本报告落入 R1（补 §23.1 reason 登记）
与 R2（§16 登记文本谓词收窄至 timer 族或双文本一致登记 follow-up 边界），该等修订属
append-only/收窄性文字变更，无需再开 SA8 门禁。**重开条件**（任一即须新门禁）：方向由 A
改为 B 或任何 §13.2 映射/错误码/帧字节变更；触发面越过 §13.2 reconnect/timer 族边界
（如纳入 config/no 族或 wire ERROR 族）；close code 分类变更；Hub 侧或 replication-protocol
包出现改动；CONTEXT.md 域术语增改。
