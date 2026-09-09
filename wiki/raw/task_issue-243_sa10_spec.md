# SA10 规格/验收终审 — Issue #243（issue #233 切片 2：协商 CAP_CHUNKED_UPDATE 超限 UPDATE live 分块传输）

- Dispatch：`sa-58bf83c4-8012-4dc3-9b3f-6ecdc425cae5`（mabf-sa10 / spec-review / iteration 0；final-verification 组，与 SA9 并行）
- 审查对象：worktree `nomicore-fix-issue-243`（branch `mabf/issue-243`）工作树交付 diff——12 tracked 修改 + 4 新文件（`src/update-transfer.ts` + 3 测试文件）；base = `feat/issue-233-chunked-update-base@c20aeb09573564b6a8e50681002b7ba9fdba137e`（与 dispatch 声明的权威 base 逐字一致；`git status` 确认分支与该 base 同步，无需 rebase 评估）
- 输入：Host 简报 `task_issue-243.md`（issue body 8 条 AC；`## Comments` 空）、SA6 契约（approve）、SA1 iteration-2 设计（SA2 iteration-2 approve + SA8 r3 定向复核 clear）、SA3 实施报告（recovery iteration 1）、SA4 实现后审查（approve）
- 评论扫描：dispatch 声明 REST 快照 `[]`（dispatch 前即刻刷新）——**无 owner 评论衍生要求或豁免**，需求面 = issue body 8 条 AC
- 结论：**approve** —— 8 条 AC 全部有实现 + 行为测试证据；SA6 契约转绿假设 A1–A3 逐字落实；设计 DD-1–DD-8/F1–F7/D1/D2 与 diff 逐面一致（本轮全部源码实读复核，非转述）；两处测试侧范围偏离均透明披露、语义保持、SA4 已独立复核接受（§4，本席维持）；零 scope creep（DENY 面零实质触碰）。角色纪律：本轮不运行测试——运行证据采信 SA3 报告 + SA4 独立复跑双记录（两者逐命令一致），本席负责规格符合性判定与披露项登记

## 1. 验收标准逐条终审（AC1–AC8）

| AC | 实现证据（源码实读） | 行为测试证据 | 判定 |
|---|---|---|---|
| **AC1** 超限（≤maxChunkedUpdateBytes）update live 传输 + 单 ACK、零 SYNC round | `update-channel.ts`：`isChunkable`（:248-255）= 已协商 ∧ `maxUpdateBytes < bytes ≤ maxChunkedUpdateBytes` ∧ transferId 域未耗尽；chunkable 项改道入队、`pullAndSendOne` 窥首 `startTransfer` 惰性切片（:386-396）；收齐后 `applyRemoteUpdate(assembled, 末chunk序)` 复用既有管线产生单 UPDATE_ACK；分块路径零 needsResync 边沿 | 红灯契约 P2（零 resync、零新增 SYNC[增量口径]、hub 收敛、save +1、单 ACK=末 chunk 序）；K1/K2（knob-on 双方向镜像）；real-transport（双方向） | **满足** |
| **AC2** 每 wire 帧 ≤ maxUpdateBytes / maxFrameBytes | 切片几何单一事实源 `chunkBounds`/`chunkCountOf`（update-transfer.ts:32-44）：每 chunk 载荷 = `subarray(i·maxUpdateBytes, min((i+1)·maxUpdateBytes, total))` ≤ maxUpdateBytes；帧全长链式 ≤ maxFrameBytes（`validateLimits` 既有 budget 链 + UPDATE_CHUNK 同 envelope 面） | P1/K1/real-transport 逐帧断言载荷 ≤ maxUpdateBytes 且帧全长 ≤ maxFrameBytes（wire 字节级） | **满足** |
| **AC3** 恰一次 sequenced apply + dirty；重组失败先于 apply、live Y.Doc 零写入 | `UpdateChunkAssembler.accept`：全部校验（首 chunk 校验序 1–6、busy 跨帧一致性、收齐 Σ==totalBytes 精确核对）先于 `complete`；`handleAssemblerResult` 仅 complete 分支触达 `applyRemoteUpdate`（恰一次 sequencer 槽 + dirty + ACK + update-applied 全复用既有管线）；违例 → `transferViolation`（ns ERROR + finalize failed）零写入 | P2（save 恰 +1）；P3（恰一次 apply+dirty+ACK）；K4/K5/K12（违例注入 apply 前零写入 + ns failed） | **满足** |
| **AC4** 多 ns RR 穿插；既有 backpressure/公平不回归 | chunk 帧经既有 data 出站点（`tryEmitData` 同一出站 + RR wheel 以 `queuedCount()>0` 留轮——载体留队首方案使 wheel 不摘轮）；零新调度机制（backpressure.ts 零改动） | K15（双 ns 积压释放后逐轮每 ns 恰一帧**严格交替**帧序断言 `[B,B,A0,B,A1,B,A2]` + 全量收敛零 resync）；SA3/SA4 双记录全套 586/586 绿（含 issue169 背压/公平套件） | **满足** |
| **AC5** ACK 计时锚 = 末 chunk 出站；ackTimeoutMs 语义不变 | `sendOneChunk` 末 chunk 分支：`inFlight.set(末chunk序, {bytes: totalBytes, sentAt: 出站时刻})` → `armAckTimer()`（幂等，混合窗口遵循既有「最老在途完成重锚」——设计 N2 措辞校正：计时锚在 timer 未武装时成立）；`ackTimeoutMs` 处理零改动（仅 onAckTimeout 回调签名扩展） | P2/P3/K1/real-transport：`ackedSequence == 末 chunk 帧序`；K1 N2 三事件配对（update-sent 恰一次于末 chunk、bytes=totalBytes） | **满足**（措辞以 N2 校正口径为准，见 §4.3） |
| **AC6** 未协商双端 v1 逐字节（R1/R2/R3 全绿） | 结构门：未协商 ⟹ `chunkedSendEnabled()` false ⟹ `chunkable ≡ false` 且 `activeTransfer` 结构性缺席 ⟹ deliver 直发条件与 v1 逐字节同义（`effectiveInFlightCount` 无 transfer 时 ≡ 裸口径）；decode 门控透传 negotiated=0 时 UPDATE_CHUNK 仍 1002 收口（slice 1 冻结）；F6 新 wire 行为以「transfer 在场」为结构门，未协商不可达 | NC2（零 chunk、resync ×1、SYNC_STEP2 恢复）+ K0（knob-off HELLO optional=0）+ K6（未协商混合队列负控：F4 静默 + update-dropped 恰一 + 零额外 RESYNC）+ K10（未协商 ack-timeout 零 RESYNC 帧）；冻结 `issue233-repro` R1/R2/R3 零触碰且在 586/586 内 | **满足** |
| **AC7** fake-duplex seam + 真实 WS + MemoryPersistence 1 Hub + 2 Peers seam 双绿 | fake-duplex：红灯契约 6/6 + chunked-live 16/16（SA3/SA4 双记录）。真实 seam：`ws-replication-issue243-real-transport.test.ts`——node:net 真实 TCP loopback + 4B 长度前缀成帧 + 真实 timer + 内存 persistence（StubPersistence）1 Hub + 2 Peers：A 超限写分块上行 + 单 ACK=末 chunk 序、hub fan-out 分块下行到 B、回声抑制（hub→A 零数据帧）、双 peer 终态 live | 1/1 绿（SA3 报告 + SA4 独立复跑） | **满足（附披露）**——seam 形态与 AC 字面类名不同（TCP+StubPersistence 而非 `ws` WebSocket+`MemoryPersistence` 类），与仓库 sa7 real-transport 套件既有约定及 SA6 §12 的 seam 引用一致；phase5 进程级 seam 经批准设计 DENY 排除。见 §4.3-D3 |
| **AC8** 首 chunk 基础校验：chunkIndex 从 0 严格递增、transferId/totalBytes/chunkCount 跨 chunk 一致 | 控制器：idle ∧ chunkIndex>0 入残渣判别（不入 assembler）；assembler 首 chunk 要求 chunkIndex===0，busy 路径逐字节核对 transferId/totalBytes/chunkCount 且 `chunkIndex === receivedCount`（严格递增）；两错误码基础映射（结构族 VIOLATION / 上界族 TOO_LARGE），完备化归 #244（切片分工） | P1（帧流自洽）；K5（busy ∧ 异 transferId → VIOLATION、ns 收口、零 apply）；K4（超上界申报 → TOO_LARGE、分配前拒绝） | **满足** |

## 2. SA6 批准契约落实

| 契约项 | 落实判定 |
|---|---|
| A1（门控唯一判据 = wire 协商位；hub 单点交集；无实例级 feature-flag） | ✓ `hub-connection.ts` onHello `selectCapabilities(required, optional, HUB_SUPPORTED_CAPABILITIES)` 单点（替代 required!==0 直判）；peer `onHelloAck` 身份校验后、ready 前**逐字捕获** `selectedCapabilities >>> 0`（F5 公式）；发送门 `isChunkedNegotiated()` 与 decode 门共用同一位；连接层 `sendUpdateChunk` 的 negotiated 检查为同判据纵深防御，非第二 feature-flag |
| A2（接收端按 ≤maxChunkedUpdateBytes[缺省 4MiB] 接纳） | ✓ assembler 以 limits 构造（`maxUpdateBytes`/`maxChunkedUpdateBytes`）；校验 4 分配前执行 |
| A3（ACK 锚 = 末 chunk 帧序；收齐恰一次 apply + dirty） | ✓ 见 AC3/AC5 行 |
| P1/P2/P3 红灯转绿 | ✓（SA3 + SA4 双记录 6/6 绿）——**附 3 处断言机制修正**，见 §4.1 |
| NC0/NC1/NC2 负控保持绿 | ✓（同双记录；NC2 + R1/R2/R3 双保险守护 AC6） |
| D1（slice 2 即执行分配前上界校验） | ✓ `validateFirst`（bytes≤maxUpdateBytes → totalBytes≥1 → bytes≤totalBytes → ≤maxChunkedUpdateBytes[TOO_LARGE] → 几何一致[VIOLATION]）全部先于 `new Uint8Array(totalBytes)`（update-transfer.ts:115-174 实读） |
| D2（slice 2 引入 `maxChunkedUpdateBytes`；超此值回退 v1 写明并测试） | ✓ types/defaults(4MiB)/validate（形状门，跨字段链归 #244——不建半套链）/plugin（LIMIT_KEYS + 透传 + 形状门）；`isChunkable` 不含超上界项 → v1 直发时刻判定原样；K3（P4-S）零 chunk + 丢弃 + needs-resync |
| 回归面（38 测联合 + 全套） | ✓ SA3 报告 586/586；SA4 独立复跑 586/586 + issue243 三文件 23/23 + 根 typecheck exit 0（本席角色纪律不运行测试，采信双记录） |

## 3. 当前轮设计行为 vs 实现（实读核对）

- **DD-1 协商面**：peer knob（`chunkedUpdate?: boolean`，缺省 false）→ HELLO optional 置位单点；hub 支持集冻结常量 + 单点交集 + HELLO_ACK.selected + 会话捕获；peer 逐字捕获 + dialNow 复位 0；decode 两调用点透传。✓（含 plugin 三封闭键集扩展：chunkedUpdate 入 PEER_CONFIG_KEYS/PEER_OVERRIDE_KEYS、maxChunkedUpdateBytes 入 LIMIT_KEYS——N1 防生产组合根启动期 TypeError）
- **DD-2 分派矩阵（F1 收窄）**：仅「已协商 ∧ 可分块」项改道；未协商/不可分块项保持 deliver/drain 两时刻 v1 判定（K6/K3 双负控）。✓
- **DD-3 发送状态机**：载体留队首（守恒不变量：activeTransfer ⇒ queued[0]===载体）、末 chunk 出站才 shift+核减+inFlight 注册+armAckTimer+清 transfer（槽位 1→1）；中间 chunk 零 inFlight/零 timer/零 update-sent；`effectiveInFlightCount()` 包内访问器（deliver 直发前置、pullAndSendOne 初始化前置、peer 周期 reconcile 延后判据三消费点，不经 index.ts 导出——index.ts 实测零改动）；chunkable 项「闸门开 ∧ 窗口空位」入队后 `requestDataDrain` 单点请求出队。✓
- **DD-4 接收端**：新模块 `update-transfer.ts`（不经 index.ts 导出）；校验序全在分配前；busy 路径无 ns 状态门（仅 quiet 静默前置）——周期 round 跨 round 存活成立；残渣表（quiet 静默 / needs-resync∧reconciling 良性 / live fail-loud）双端对称实现；hub submit 门在首 chunk（分配前）镜像 onUpdate；清理挂点 = onResyncReceived 收帧边（双端）+ 两漏斗内（记忆化门后）+ onRoundSettled 回 live（resyncEpisode 门控；peer `pendingResync→round+1` 分支 early-return 保持标记——实读 :1013-1018）+ tryOpen/runDisposal（peer）/closeSessionAndRelease（hub）+ 违例复位。✓
- **DD-5**：peer drain 白名单不含 UPDATE_CHUNK（实读 :404-414，零改动，静默丢弃）；hub `drainActive` 名单显式 +UPDATE_CHUNK（:755-758）。✓
- **DD-6 fan-out**：零新机制（session owned-update 广播 + applyOrigin 回声抑制）；real-transport 实证 B 收敛 + hub→A 零数据帧。✓
- **DD-7（F6）**：`abandonInFlight` 入口捕获 `abortedTransfer`（显式清除前）、载体保留（v1 冻结队列语义不动）；peer `onAckTimeoutFired(abortedTransfer)` 在既有 `live || needs-resync` 外层门**内**分派（N13/O7 守门满足）：true → `declareLocalResync('ack-timeout')` 漏斗（恰一帧 wire RESYNC_REQUIRED{send-queue-overflow}——零新帧型/零新 reason/零新 observer cause）；false → PN6b 原体逐字节；hub 侧既有漏斗行为不变（签名适配 `_abortedTransfer` 丢弃，行为零变化）。✓ K8/K9/K10 动态闭合
- **DD-8（F7）**：peer `onWatchdogEdge` 内联声明收敛入 `declareLocalResync('session-fanout-overflow')`（markSessionResyncEdge 幂等前置保持；指令序与漏斗逐行等价）；**本席独立静态核验：生产 `kind: 'RESYNC_REQUIRED'` sendChecked 发射点恰 2 处 = peer-namespace:1101（declareLocalResync）+ hub-namespace:930（declareHubResync）== 挂点全集**——F7 静态判据成立。✓ K14 动态闭合（漏斗 cause 恰一次、恰一帧、busy assembly 清除 + episode 置位、恢复后新 transferId=2 整笔收齐、peer ns 零 failed；K14 构型按 SA2 N12 澄清——round 收敛后注入新超限写产生 T2）
- **transferId 生命周期**：单调递增不复位；`teardown()` 归 1（teardown = 连接收口/新会话标记；peer tryOpen :441 代际重置即调 channel.teardown——「dialNow 重建归 1 = 新连接作用域」落实）。✓ K8 实证 T2=2
- **W1–W4**：ADR/协议文档/CONTEXT 零触碰（#246）；零新 observer 事件类型（#245）；零新诊断 emission（apply 复用既有管线）。✓

## 4. 范围偏离与披露项（PR 必须披露）

### 4.1 红灯契约文件 3 处断言机制修正（DENY「断言面冻结」触碰——维持 SA4 接受裁定）

SA3 §6 透明披露（文件内 inline「实现轮修正注」标注）；SA4 §4.1 逐条独立复核「绿灯不可达」论证成立并接受；本席复核同意：

1. **P2 零 SYNC 计数 → 增量口径**（`syncBaseline` 前后差）：原断言含新建连接必经 boot round 6 帧，任何正确实现绿灯不可达；断言消息「超限 update 不得触发任何 SYNC round」语义逐字保持。
2. **P2 ACK 时序并入 settleUntil 谓词**（NC1 既有 idiom）：消除「收敛谓词先于 ACK 出站」的微任务序竞态；恰一次 ACK 断言保持。
3. **P3 `hubSideClosed===false` → 通道面断言**（无 ns 终局 failed、零 UPDATE_TRANSFER_* 违例帧、ACK 先行于任何 hub ERROR/close、恰一次 apply+dirty+ACK、零新增 SYNC）：注入帧占真实 peer 连接级序列号空间，hub 按冻结 ACK 关联纪律（#238/ac5-live）必收口、其 ERROR 复用同序触发 hub SEQUENCE_VIOLATION——两级均实现无关，字面不可达成立。

性质：测试断言面**机制**修正，非实现语义 fallback；红灯失败面（P1 零 chunk / P2 resync / P3 decode 1002 收口）未触碰且全部按承诺转绿；AC 映射语义逐字保持。

### 4.2 `ws-replication-observer-red.test.ts` +1 行（ALLOW 表外——维持接受）

`ReplicationLimits` 新增必填字段的唯一既有完整字面量构造点补 `maxChunkedUpdateBytes: 4MiB`（缺省值）——机械类型涟漪；替代方案（字段可选化）弱化限额契约，未取。零断言/行为改动。

### 4.3 登记性披露（非缺陷，不阻断 approve）

- **D3（AC7 第二 seam 形态）**：交付为 node:net 真实 TCP + 长度前缀成帧 + StubPersistence（Map 内存 DocPersistence），非字面 `ws` WebSocket 类 + `packages/persistence` MemoryPersistence 类。依据：(a) 仓库 ws-replication「真实链路集成抽样」既有约定（sa7 issue170/171/r2 全部同形态——DuplexTransport seam 下 WS 仅为适配器之一，wire 帧字节 identical）；(b) SA6 §12 将该 seam 引用为 sa7 real-transport 套件同款；(c) phase5 进程级真 WS + MemoryPersistence 三实例 seam 经批准设计 DENY 显式排除（「属于其自身 issue 的契约文件；本任务以新文件承载镜像」）。AC7 实质内容（真实传输动态 + 内存持久化 + 1 Hub + 2 Peers + 收敛 + fan-out 到第二 Peer + 回声抑制）已完整证明。
- **AC5 措辞**：混合窗口下既有「最老在途完成重锚」语义保持（armAckTimer 幂等）；「计时锚 = 末 chunk 出站」在 timer 未武装时成立——设计 N2 已校正，断言面（ackedSequence 关联键）不受影响。
- **K6 注记的 v1 基线怪异性**：「hub save 门闩 + 多笔排队 apply 的持久化投影怪异性」经 SA3 在 HEAD 基线探针复现、非本改动引入；K6 断言面不读该投影（wire 帧 + observer 事件断言）。维持登记，归 #244/backlog 核实。
- **混编部署**（协商 hub fan-out 单帧 UPDATE 到未协商 peer 触发其 v1 超限路径）：ADR 互通矩阵自然后果（R9），文档化归 #246。
- **切片分工残余**（明确非本任务）：违例分类完备化/中止矩阵/三配置+全链（#244）；chunked-update-* observer 四事件（#245）；协议 §10.2/§10.3 修订 + §9.4 发射点登记（含 F6 peer ack-timeout 发射点追认）+ ADR 0013 转正（#246）。

## 5. 否定性核查（遗漏/部分实现/错误实现/scope creep）

- **AC 遗漏**：无——8/8 有实现 + 行为断言证据（§1）。
- **设计面遗漏**：无——DD-1–DD-8/F1–F7/D1/D2/W1–W4/SA2 N1–N13 全部落实或显式登记（§3；N12 构型澄清已在 K14 体现；N13 门保持已落实）。
- **部分实现**：未发现。F6 双向闭合 + 未协商负控（K8/K9/K10）、F7 动态行（K14）、AC4 严格交替（K15）均在套件内，非仅设计承诺。
- **错误实现**：未发现——本轮对全部关键不变量实读源码复核（chunkable 结构门、守恒不变量、校验序先于分配、漏斗记忆化门后置位、pendingResync 分支标记保持、emit 发射点全集）。
- **scope creep**：无——DENY 面（replication-protocol、issue233-repro、docs/ADR/CONTEXT、backpressure/round-engine/observer、namespace-runtime/registry、apps 契约文件）`git status` 实测零触碰；两处测试侧偏离已披露并裁定（§4.1/§4.2）；`index.ts` 零改动（公开 API 面 additive 字段随既有导出携带，无新公开类）。

## 6. 裁决汇总

| 检查项 | 结果 |
|---|---|
| issue body 8 条 AC | 8/8 满足（AC7 附 seam 形态披露 D3；AC5 以 N2 校正口径） |
| SA6 契约（A1–A3/P1–P3/NC0–NC2/D1/D2/回归面） | 全部落实；红灯文件 3 处断言机制修正维持 SA4 接受裁定 |
| 当前轮设计行为（DD-1–DD-8/F1–F7/D1/D2/W1–W4/N1–N13） | 逐面实读一致，零锚点漂移 |
| 运行证据 | SA3 报告 + SA4 独立复跑双记录一致（586/586 + 23/23 + typecheck exit 0）；本席角色纪律不运行测试 |
| Owner 评论衍生要求 | 无（REST 快照 `[]`） |
| 关键 AC partial/unmet/unachievable | **无** |
| 未达成项披露 | §4 全量登记（2 处测试侧偏离裁定 + 5 项登记性披露/切片分工残余） |

**verdict：approve**

## 附：artifactPaths（worktree-relative）

1. `wiki/raw/task_issue-243_sa10_spec.md` —— 本报告。
