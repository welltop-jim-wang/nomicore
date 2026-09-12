# SA8 设计后冲突复核（design consistency recheck）— Issue #243（issue #233 切片 2）

- Dispatch：`sa-8dc04e6f-db3d-4d36-90c2-97cd05c2b26c`（mabf-sa8 / conflict-gate / iteration 1）
- 复核对象：`wiki/raw/task_issue-243_design.md`（SA1 设计，dispatch `sa-bfff17a8`，自评 `requiresConflictRecheck: true`，理由见其 §15）
- 裁决基准（仅此二者）：`docs/adr/` ADR 全集（无被 supersede 的相关 ADR）+ 根 `CONTEXT.md`；`wiki/raw/task_issue-243_sa6_contract.md`（approve）与 `docs/protocols/instance-replication-v1.md` 作为 dispatch 点名的对照契约参与核验（protocol 经 ADR 0013「接受后以该文档修订为唯一 wire 权威」条款纳入）
- 工作区：worktree `nomicore-fix-issue-243`，分支 `mabf/issue-243`，HEAD `c20aeb0`（与设计/前置门禁/SA6 三方 header 一致；`git status` 仅 5 个 untracked 产物文件，零 tracked 改动——SA6 §16「未改生产实现文件」保持）
- 结论：**无冲突（clear）** —— 45 项检查 0 项 ADR/CONTEXT 矛盾、0 项阻塞、0 项需 override；4 项观察（O1/O2 需 SA1 一段式澄清，O3/O4 登记性）

## 1. 输入与证据

| 证据 | 位置 | 状态 |
|---|---|---|
| SA1 设计 | `wiki/raw/task_issue-243_design.md`（357 行） | 本复核对象；其 §2 代码锚点经本轮实读抽验全部属实（见 §6 核验记录） |
| SA6 红灯契约 | `wiki/raw/task_issue-243_sa6_contract.md` + `packages/ws-replication/test/ws-replication-issue243-ac-red.test.ts` | approve；P1/P2/P3 红 + NC0/NC1/NC2 绿（SA6 §13 双跑一致） |
| 前置 SA8 门禁 | `wiki/raw/20260908-sa8-conflict-gate-issue-243.md` | clear；D1/D2 必答回查面 + W1–W4 观察项——本轮逐项回查（§2/§5） |
| ADR 0013 | `docs/adr/0013-chunked-live-update-transfer.md` | 状态「提议」（W1）；发送端规则 L48-54 / 接收端规则 L56-63 / 配置链 L65-76 / 错误码 L78-81 |
| ADR 0010 | `docs/adr/0010-hub-peer-websocket-ydoc-replication.md` | ACK durability / fan-out / 背压分层基线（ADR 0013 明示不改其语义） |
| CONTEXT.md | 「分块复制传输」L141-143 /「UPDATE_CHUNK」L145-147 /「CAP_CHUNKED_UPDATE」L149-151 | Avoid 清单全程有效 |
| 协议文档 | `docs/protocols/instance-replication-v1.md` §5（L111-113）/§6.1-6.3（L117-157）/§10.2-10.3（L288-313）/§13.2（L386-416） | slice 1 已登记 0x42/capability bit/两错误码；跨帧规则显式「属后续切片」 |

### 1.1 Owner 评论扫描（dispatch 要求复验）

`gh api repos/welltop-jim-wang/nomicore/issues/243/comments` → `0`（exit 0）。与 dispatch 声明、Host 简报 `## Comments` 空、SA6 §2、前置门禁 §1.1 四方一致：**无 owner 要求**，需求面 = issue body 8 条 AC。

## 2. 必答决策面回查（前置门禁 §5「设计复审时回查」）

### D1 临时期分配上界 —— 已按建议作答，无冲突

ADR 0013:59 首 chunk 校验四条与设计 §7-DD-4 校验序（0–6，全部先于分配）逐条对照：

| ADR 0013:59 条款 | 设计落点 | 裁决 |
|---|---|---|
| `totalBytes ≤ maxChunkedUpdateBytes` | 校验 4，分配前，→ `UPDATE_TRANSFER_TOO_LARGE` | 一致（TOO_LARGE 码族对齐 ADR:80「retryable config」语义族） |
| `totalBytes ≤ chunkCount × maxUpdateBytes` | 校验 5，分配前，→ `UPDATE_TRANSFER_VIOLATION` | 一致 |
| `chunkCount ≥ 1` | 校验 0（slice 1 codec decode 已强制，MALFORMED_FRAME） | 一致 |
| `chunkCount ≤ maxChunksPerUpdate` | **切片 2 不执行**（配置本身归 #244） | 见下判定 |

**`chunkCount ≤ maxChunksPerUpdate` 延后判定：无冲突。** 三层论证：①分配尺寸只由 `totalBytes` 决定（`new Uint8Array(totalBytes)`，DD-4 校验 6）——有界分配不变量「恶意声明不可能导致无界分配」（ADR:59 显式动机）由校验 4 **在 slice 2 即完全守住**；`chunkCount` 纯计数字段，逐 chunk 追加受 `offset+len ≤ totalBytes` 与每 chunk 非空约束，结构性上界 = totalBytes，无内存放大面；②前置门禁 D1 建议原文「slice 2 即执行 totalBytes/chunkCount 上界校验」的可执行读法 = 不依赖 #244 配置的两项上界校验（校验 4/5，均在场）；纯 `chunkCount ≤ maxChunksPerUpdate` 校验须先落地 `maxChunksPerUpdate` 配置 + 启动链——恰是 D2 明令避免的「双切片各建半套校验链」；③停摆型残余（声明大 chunkCount 后断流）= 设计 R2 已登记，系统性修复归 #244 `assemblyTimeoutMs`（前置门禁 W3 切片边界）。终态与 ADR 收敛。

**附加严于 ADR 的校验（无冲突）**：校验 2（首 chunk `bytes ≤ maxUpdateBytes` → VIOLATION）为 ADR:60「后续 chunk」规则向首 chunk 的自然延伸——合格 v2 发送端恒满足（ADR:36 wire 形态），无误拒面；分类为 ns 级 VIOLATION 与 ADR:60 字面一致（协议 §10.3 的 codec 级 `UPDATE_TOO_LARGE` 仅在 decode 传 FieldLimits 时适用，而连接层既有先例即不传 + `namespaceFieldViolation` 手工判——设计 §10 已如实声明不扩该函数）。

**不做 `totalBytes > maxUpdateBytes` 前置校验（R6）：与 SA6 契约相容的必要选择。** limit 是端点配置不保证对称（ADR 无对称性条款）；SA6 P3 注入的合法单 chunk transfer 其 totalBytes=增量长度可小于 maxUpdateBytes——加该校验将误拒 P3 并破坏 ADR「合法 chunk 必须接纳」的接收端规则。裁决：无冲突。

### D2 配置旋钮交付切分 —— 已按建议作答，无冲突

| 核验点 | 事实核验 | 裁决 |
|---|---|---|
| slice 2 全量拥有 `maxChunkedUpdateBytes` | DD-2.1：`ReplicationLimits` +1 字段、缺省 4 MiB（= ADR:71 配置表值；`defaults.ts` 实读现 11 字段、Partial 整值合并先例在）+ `positiveSafeInteger` 形状校验；发送上界（DD-2 矩阵行 3）与接收首 chunk 上界（DD-4 校验 4）双侧消费 | 一致 |
| 跨字段响亮链整体归 #244、不建半套 | DD-2.2 理由 (a) D2 明令；(b) **本轮实读证实**：SA6 红灯 fixture（test :86-91）显式 `maxQueuedUpdateBytes: 1 MiB` + 缺省 `maxChunkedUpdateBytes: 4 MiB`——slice 2 若加 `≤ maxQueuedUpdateBytes` 链，六条契约用例构造期即 TypeError，已批准红灯契约被击穿；deferral 不仅是许可更是契约相容的必然；(c) `replication-protocol/limits.ts` 头注「未传字段不参与跨字段校验」Partial 先例实读在 | 一致 |
| 绝不运行时 clamp | DD-2.4 有效发送上界 = 队列接纳预算 ∧ 显式判定复合，无 clamp；R5 登记 #244 前的缺口（仅显式覆写可触发——缺省下 4 MiB == 4 MiB，ADR:71 约束在缺省组态天然成立） | 一致（ADR:67 字面） |
| 旋钮形状 | peer 侧 `chunkedUpdate?: boolean` 缺省 false（HELLO optional 位置位单点 :337 实读现为硬编码 0）；hub 侧支持集冻结常量 + `selectCapabilities` 交集（函数已导出于 `negotiation.ts:26`）；`requiredCapabilities: 0` 不变 | 一致（协议 §6.1「v1 为 0」/§6.2「required 满足后的交集」字面；SA6 §15 未知项以「无需刷新注入」方向消解——hub 不做配置门，与 ADR「取交集」字面一致） |

## 3. dispatch 点名四面对照上游契约

### 3.1 bounded receiver allocation（有界接收端分配）

- 校验序 0–6 全部先于分配 ✓（DD-4 表逐行）；busy 冲突判先（校验 1）为 ADR 未排序的自由度。
- 后续 chunk 五判据（transferId 一致 / totalBytes/chunkCount 逐字节一致 / chunkIndex===已收数量 / bytes ≤ maxUpdateBytes / offset+len ≤ totalBytes → VIOLATION）与 ADR:60 逐条对齐；「错序/丢失结构不可达 ⇒ 响亮 violation」= ADR 拒绝理由 3 原文。
- 收齐 `Σbytes === totalBytes` 精确核对 → 恰一次 sequenced apply + dirty + 单 ACK（末 chunk 帧序）→ ADR:61 字面；「重组失败一律先于 apply、live Y.Doc 零写入」→ ADR:61 + CONTEXT「分块复制传输」词条 + AC3 三方一致。
- 状态接纳门镜像 onUpdate/onHubUpdate（`live | needs-resync | reconciling∧wasLive`；quiet 静默；违例 NAMESPACE_STATE_VIOLATION+failed）——本轮实读 peer-namespace/hub-namespace 两处门逐字核对属实；hub submitPermission 门镜像（hub-namespace 实读在场）。
- 内存上界：slice 2 每 (ns,方向) 至多 1 assembly（ADR:62 前半在）；连接级 `maxConcurrentAssembliesPerConnection` 聚合上界随配置归 #244（W3 边界，设计 R2 已登记暴露上界）。
- **裁决：无冲突。**

### 3.2 cleanup boundaries（清理边界）

ADR 0013:58 枚举的五条丢弃边 vs 设计 DD-4 挂点表：

| ADR 枚举边 | 设计挂点 | 实读核验 |
|---|---|---|
| 连接断开 | 终态/静默单点（`finalize` + `quiesceConnection`/`quiesceSync`） | hub-connection :517/:864/:892/:919 四处 `channel.quiesceConnection()`；peer `quiesceSync` 族在场 |
| namespace close/终态 | 同上 | 同上 |
| GOAWAY drain 收口 | 同上 + DD-5 hub `drainActive` 丢弃名单 +`'UPDATE_CHUNK'` | `finishDrain → close(1001)`；drain 名单实读现含 `UPDATE`（:718-732）——0x42 加入是同族扩充，协议 §6.3「其余会启动新工作的迟到 namespace frame 静默丢弃」类条款覆盖，#246 可追认（W2 ✓） |
| epoch fence | 同上 | conflicted 终态族 |
| 收到 RESYNC_REQUIRED | `onResyncReceived` 挂点 | peer :561-567 / hub :661-666 实读在场 |

- **加性挂点「本端 resync 声明边」**：ADR 未枚举，但闭合性必需（本端声明送达后对端 `markResyncReceived` 弃置其队列含在途 transfer → 本端 assembly 必然残缺）；与 CONTEXT「中断即丢弃并回退 state-vector reconciliation」同向。裁决：加性安全，无冲突。
- **不挂 `resetForLive`**：round 期间 transfer 合法暂停（pull 门非 live 关闭）、结算回 live 续传——`resetForLive` 非 ADR 丢弃边（实读仅清 needsResync + 请求 drain）；DD-3.8 延后判据进一步消除常态交叠。裁决：一致。
- **发送端中止（DD-3.7）**：五路径复用既有机制 + 每路径单点清 `activeTransfer` + 末 chunk 已出站走既有 zombie/teardown 簿记 = ADR:54「停发后续 chunk、末 chunk 序入 zombie 簿记、needs-resync 同构处置」逐字对齐。裁决：无冲突。
- CONTEXT Avoid 清单核验：无逐片 apply、无跨重连 partial 保留、transferId 不作跨连接持久标识（作用域=连接内，拆除即弃）。「零 durable 残留」（ADR:58）满足——assembly 纯内存新模块。
- slice 2 无 assembly timeout：ADR:63 归 #244（W3 已记录）；设计 R2 残余登记 + 测试覆盖（resync 边沿/拆除丢弃）。裁决：切片边界，非偏离。
- **裁决：无冲突。**

### 3.3 configuration ownership（配置归属）

见 §2-D2 表。补充核验：缺省值 4 MiB 与 ADR:71 一致；`PeerReplicationOptions.chunkedUpdate` 形状门（validatePeerOptions 非 boolean → TypeError）符合「启动期响亮验证」族；plugin.ts 透传为生产组合根加性；DENY 清单正确隔离 #244/#245/#246 交付物（`replication-protocol/**` 冻结、协议文档/ADR 0013/CONTEXT 零改动）。**裁决：无冲突。**

### 3.4 sender fallback matrix（发送端回退矩阵）

| DD-2.3 行 | 上游依据 | 裁决 |
|---|---|---|
| `bytes ≤ maxUpdateBytes` → 既有单 UPDATE 路径逐字节不变 | ADR:50「其余路径不变」；SA6 NC1 | 一致 |
| `maxUpdateBytes < bytes ≤ maxChunkedUpdateBytes ∧ 已协商 ∧ live` → 分块 | ADR:50 进入条件逐字 | 一致 |
| `bytes > maxChunkedUpdateBytes`（含 transferId 耗尽）→ v1 超限语义原样 | 前置门禁 D2「隐含回退须写明并测试」；ADR:59 接收端上界使直发必被拒，回退 v1 是唯一可恢复路径；P4 测试落实 | 一致（显式分派矩阵，非静默降级——CONTEXT/ADR 纪律满足） |
| 超限 ∧ 未协商 → v1 原样 | ADR:23「未协商 ⇒ 不得分块，超限行为保持 v1」；NC2+R1/R2/R3 | 见 O1（结果层一致；微观时序窗观察项） |

- 回退路径复用 #231 既有可观测量：本轮实读 `update-channel.ts` sendAndRegister 超限分支——`declareLocalResync('send-failed', captureFailureDetail('update-too-large', …))` / `noteUpdateDropped(…'update-too-large'…)` 与矩阵行 3 书写逐字对应，零新 reason 词表。
- 切片几何 `chunkCount = ceil(totalBytes/maxUpdateBytes)`、每 chunk ≤ maxUpdateBytes、帧全长链式 ≤ maxFrameBytes = ADR:36/76 字面；SA6 P1（20KB/8KiB → 3 chunk）可满足。
- ACK 锚 = 末 chunk 出站（`armAckTimer` 于末 chunk 记账后挂）= ADR:53 字面；中间 chunk 不注册 inFlight、不挂 timer = ADR:51「整笔 1 槽」+ ADR:46「整笔 transfer 一次 ACK」的实现面。
- **裁决：无冲突**（O1 观察项见 §4）。

## 4. 观察项（不阻塞；O1/O2 需 SA1 澄清一段，SA2 评审承接）

- **O1（未协商超限项的统一改道时序窗）**：DD-3.3 使超限项「无论协商与否」不再进入 live 直发分支而先入有界队列。对未协商连接，这把丢弃判定从 deliver 时刻推迟到 drain 时刻：单写场景（R1/R2/R3、NC2 的全部刻画面）经本轮逐步推演与 v1 **逐字节等价**（两种形态下丢弃时队列均为空 → 同走 `send-failed` declare 分支、同出 RESYNC_REQUIRED；v1 本身在窗口满时也已是 drain 时刻丢弃）；但混合队列窗（live ∧ 窗口有空位 ∧ 队列已有项）中，`send-failed` declare（wire RESYNC 帧）与 F4 `noteUpdateDropped`（静默）的选择可能随判定时刻漂移，且超限项改道后先过 `overflows()` 预算检查——预算不足时分类从 `update-too-large` 族变为 `queue-overflow` 族（仅显式小预算组态可触发，即 R5 窗）。AC6 的规范等价面（刻画测试）保持全绿；ADR:23「丢弃 + needs-resync，#231 观测不变」在结果层全部成立、可观测量词表零变化。**要求**：SA1 以一段文字显式给出未协商改道的等价性论证，或将改道范围收窄到「已协商」连接（后者平凡逐字节等价）；实现轮补一条未协商混合队列负控。属设计完备性而非 ADR 矛盾——若 SA1 选择收窄改道范围，该修订属 ADR:23 面语义微调，建议随附一次定向 SA8 复核。
- **O2（activeTransfer 在场时 deliver 直发前置的窗口口径）**：DD-3.6 定义内部口径「窗口占用 = inFlight.size + (activeTransfer ? 1 : 0)（供窗口前置与 DD-3.8 延后判据）」，而 DD-3.3 称限内项「直发路径逐字节不变」（现有前置 = 裸 `inFlight.size < max`）。两处并存存在读法歧义：若直发前置用裸口径，transfer 进行中穿插发送可使末 chunk 注册时 `inFlight.size` 超 cap 一格，与 ADR:52「window 空位允许时……穿插」及协议 §10.2「窗口满只暂停该 namespace 发送」相悖；若用有效口径（DD-3.6 自身定义的自然延伸，且「逐字节不变」在无 transfer 的 v1 组态下仍然成立），则与 ADR 完全一致。**要求**：SA1 一句话钉死——activeTransfer 在场时 deliver 直发前置采用有效占用口径。唯此读法与 ADR 0013:52 相容；若 SA1 坚持裸口径即构成冲突，须回设计。
- **O3（transferId 计数器的连接重建生命周期未钉死）**：DD-3.2 定「任何 resync/终态不复位」，未明说 peer `dialNow()` 重建（新连接 = ADR:32 新作用域）时 `nextTransferId` 是否归 1。两向皆安全（拆除即弃 assembly、codec 仅要求 ≥1、不回绕保持），请 SA1/SA3 落一句。登记性。
- **O4（"P4" 标号碰撞）**：设计 §12 D2 行以 P4 指发送端超上限回退（>maxChunkedUpdateBytes → v1 同形），SA6 §15 D1 以 P4 指接收端超界申报注入（→ TOO_LARGE、ns 级收口）。两场景在设计 §12 均已覆盖（AC8 行 + D2 行），仅标标号复用易在实现轮引起混淆。登记性。

## 5. W1–W4 与 SA6 契约相容性回查

| 项 | 设计落点 | 回查结论 |
|---|---|---|
| W1 ADR 0013 状态「提议」 | §11 DENY（零改动；转正归 #246） | 遵守 |
| W2 协议文档滞后 | §11 DENY；transfer 1 槽、单 ACK 末 chunk 序、drain 名单扩充均为 ADR 0013 已决内容或 §6.3 类条款自然延伸，#246 可追认 | 遵守（无不可追认偏离） |
| W3 observer 四事件/中止矩阵后置 | DD-3.6 中间 chunk 零 `update-sent`；`update-acked` 经既有 inFlight 结算恰一次；零新事件类型 | 遵守（R7 语义推广已自标记 SA2 裁定——事件键集不变，无 ADR 面） |
| W4 诊断纪律 | apply 复用 `ReplicationSession.applyRemoteUpdate`，零新 emission 调用点 | 遵守（ADR 0011/0014 无新触发面） |
| SA6 A1（wire 协商位唯一门控、无实例级 feature-flag） | DD-1.5 字面采纳 | 相容——红灯文件「零编辑转绿」可行性成立（协商经 wire 代理置位，旋钮形状与之解耦） |
| SA6 A2（按缺省 4 MiB 接纳申报） | DD-2.1 缺省 + DD-4 校验 4 | 相容 |
| SA6 A3（ACK 锚/恰一次 apply+dirty） | DD-3.6/DD-4 | 相容 |
| SA6 §15 D2 未知项（hub 配置门需刷新注入） | DD-1 备选否决：hub 支持集为编译期常量 | 相容——无需刷新注入方式 |
| SA6 红灯六用例构造可行性 | fixture 显式 `maxQueuedUpdateBytes=1MiB` + 缺省 4 MiB | 相容——设计 DD-2.2 的链延后是保持该 fixture 存活的必要条件（本轮实读取证） |

## 6. 设计 §2 代码锚点抽验记录（本轮实读）

`peer-connection.ts`（HELLO 硬编码 0 / draining 允许名单 / UPDATE_CHUNK 占位）、`hub-connection.ts`（onHello HELLO_ACK selected=0 / drainActive 名单含 UPDATE / UPDATE_CHUNK 占位 / finishDrain→close(1001) / quiesceConnection 四挂点）、`update-channel.ts`（deliver 直发前置 / overflows 分支 / sendAndRegister 超限双分支及 #231 观测量 / onAck 三分支 / pullAndSendOne 四前置 / takeItems 贪心上界（超限首项恒单独成帧）/ resetForLive / armAckTimer）、`backpressure.ts`（drainData 每轮每 ns 一帧 + `queuedCount()===0` 摘轮——DD-3 备选否决理由属实 / tryEmitData 严格接纳）、`frame-io.ts`（decodeInbound 现无 selectedCapabilities / namespaceFieldViolation 先例）、`peer-namespace.ts`（onHubUpdate 状态门/尺寸门 / startPeriodicReconcile `inFlightCount>0` 延后 / declareLocalResync / quiesceSync）、`hub-namespace.ts`（onUpdate 状态门+submit 门 / quiesceConnection）、`defaults.ts`（11 字段）/`limits.ts`（DecodeOptions.selectedCapabilities 已在 + Partial 跨字段语义）/`negotiation.ts`（selectCapabilities 已导出）——**抽验全数属实，设计与 HEAD 无锚点漂移**。

## 7. 裁决汇总

- 检查项合计：**45**（D1 面 6、D2 面 4、§3 四面 23、W1–W4 + SA6 相容 9、锚点抽验归档 2、评论扫描复验 1）
- 分布：无冲突/对齐 **41**；观察项 **4**（O1/O2 需 SA1 一段式澄清——O2 含条件性冲突警示：仅当 SA1 坚持裸窗口口径时升级；O3/O4 登记性）；阻塞 **0**；与 ADR/CONTEXT 矛盾需 override **0**
- 门禁结论：**clear** —— 设计放行进入 SA2 攻击评审；O1/O2 的澄清应随 SA2 轮或 SA1 勘误轮落实；若 SA1 为回应 O1/O2 修订 DD-3.2/DD-3.3 语义（改道范围收窄或窗口口径钉死），该修订建议随附定向 SA8 复核（本次结论不自动延伸到该修订）。
