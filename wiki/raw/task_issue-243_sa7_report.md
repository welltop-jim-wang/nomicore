# SA7 动态验证报告 — Issue #243（issue #233 切片 2：协商 CAP_CHUNKED_UPDATE 超限 UPDATE live 分块传输）

- Dispatch：`sa-6a5b997e-da1a-487d-bef5-4dcc1fea4e27`（mabf-sa7 / final-verification / iteration 0）
- 工作区：worktree `nomicore-fix-issue-243`，分支 `mabf/issue-243`，HEAD `c20aeb0` + 工作树交付（SA3：12 tracked 修改 + 4 新文件；本席零触碰交付代码）
- 前置：**SA4 approve**（`task_issue-243_sa4_review.md`）——本席在其 pass 基础上独立动态验证，仅可独立发现 fail
- 结论：**approve** —— 设计声明改变的数据流按设计变化、声明保持的数据流保持不变、状态机转换与关键值正确、禁止状态未出现、错误与清理到达 quiescence、零临时诊断残留

---

## 1. Inputs

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-243.md`（Host 简报） | 零评论（`## Comments` 空；dispatch 亦声明 final-review REST snapshot 为 `[]`，无 owner 追加约束）——需求面 = issue body AC1–AC8 |
| `wiki/raw/task_issue-243_design.md`（SA1 iteration-2，SA2 iteration-2 approve） | DD-1–DD-8 / F1–F7 / D1 / D2 / W1–W4；§12 验收映射为动态行事实源 |
| `wiki/raw/task_issue-243_sa6_contract.md`（approve） | 冻结红灯契约 P1/P2/P3 + NC0/NC1/NC2；转绿假设 A1–A3 |
| `wiki/raw/task_issue-243_sa3_impl.md`（iteration 1 recovery） | 交付面与 K0–K15 + real-transport 证据声明 |
| `wiki/raw/task_issue-243_sa4_review.md`（approve） | 攻击面复核 + 独立复跑记录 |
| SA8 决议（`20260908-sa8-conflict-gate-issue-243.md` clear + r1/r2/r3 复核） | D1/D2 必答已答、O5 解除——协议不可变边界：slice 1 wire 面冻结、零新帧型/零新 reason/零新 observer 类型 |

## 2. Runtime environment

- node v24.13.0；pnpm 10.28.2；vitest 3.2.7（linux-x64）；worktree 现场依赖已安装（SA6 轮 `pnpm install --frozen-lockfile` 产物沿用，本席零新增安装）
- 全部动态证据为进程内运行（fake-duplex 微任务 + fake scheduler 虚拟时钟；real-transport 场景为真实 TCP socket + 真实 timer + 有界 real wait）；零服务进程、零端口占用、零后台 job——无清理面
- 本席新增的唯一产物：`packages/ws-replication/test/ws-replication-issue243-sa7-dynamic.test.ts`（17 用例，S1–S8 发送端跳点级 + A1–A9 接收端跳点级；与 issue169 背压套件同款 `../src/*` 直引纪律）；**未修改任何生产代码与既有测试**

## 3. Changed Data Flow Verification

| Route | Design change | Runtime driver | Observed hops | Expected result | Actual result | Verdict |
|---|---|---|---|---|---|---|
| ① 协商 | knob-on → HELLO.optional 位；hub `selectCapabilities` 单点交集 → HELLO_ACK.selected；peer 逐字捕获（F5）；decode 透传 | K0/K1（真握手 wire）；ac-red NC0（wire 代理置位路径）；源码锚点 peer-connection.ts:349/:437/:304、hub-connection.ts:683-692 | K0：knob-off HELLO.optional=0；K1：HELLO.optional 含 0x1 ∧ HELLO_ACK.selected 含 0x1；NC0：代理只改写两握手帧后 P1/P2/P3 即转绿（证明 peer 消费 wire 位、不与本地 offered 求交） | 位建立后发送/解码门开启；缺省 0 = v1 | 逐字一致；dialNow 复位 0（peer-connection.ts:304） | pass |
| ② 发送分块（惰性切片） | chunkable 项不进直发、改道有界队列；载体留 queued[0] 至末 chunk；每帧独立 sequence；中间 chunk 零 inFlight/零 timer/零 update-sent | **SA7-S1/S2/S8**（单元跳点级：fake host 全回调记账）；K1/K15（wire）；ac-red P1 | S1：deliver(3000B) 零 UPDATE 直发 → 入队（queued=1/3000B）+ 单点 requestDataDrain；pull×3 → chunk0/1/2（1024/1024/952B，transferId=1，chunkCount=3，seq=1/2/3）；**中间 chunk 后 queuedCount 仍=1、inFlight=0、effective=1、零 timer 零 update-sent**；末 chunk 后 queued=0、inFlight={seq3:bytes=3000}、update-sent 恰一 {seq:3,bytes:3000}、timer 武装 1 次 | 改道 + 载体守恒 + 1 槽（有效占用口径）+ 槽位 1→1 | 逐项吻合（含 R4 保守记账：transfer 期间 queuedBytes 恒 3000） | pass |
| ③ 接收重组（detached assembly） | 首 chunk 分配前全校验（D1）→ 一次性分配 → 严格递增追加 → 收齐 Σ 核对 → 恰一次 sequenced apply + dirty + 单 UPDATE_ACK{末 chunk 序} + fan-out（回声抑制） | **SA7-A1–A9**（assembler 跳点级）；K1/K2（saveDoc +1、单 ACK）；ac-red P3；real-transport（真实 TCP 1 Hub + 2 Peers） | A6：3-chunk more/more/complete（字节逐段相等、complete 后回 idle 可接纳新 transfer）；A2–A5/A8：TOO_LARGE/几何/超限/零长/Σ 不符全部违例且 **busy 保持 false（零分配残留）**；K1：hub save +1、UPDATE_ACK.ackedSequence == 末 chunk 帧序、update-applied{bytes=totalBytes,sequence=末序}；real-transport：hub→B 分块下行 ≥2 chunk ∧ hub→A 零数据帧（回声抑制） | 校验先于分配/apply；恰一次 apply；fan-out 不回送来源 | 逐项吻合；A3 双违例组态实测校验序 #4（TOO_LARGE）先于 #5（几何）——与设计校验序一致 | pass |
| ④ ACK 结算 | 末 chunk 出站注册 inFlight{bytes=totalBytes}；onAck ok/zombie/violation 三分支复用 | **SA7-S1/S2/S5**；K1 | S1：onAck(末序)='ok' + update-acked{bytes:3000,sequence:3} + timer 拆除；S5：abandon 后迟至 ACK → 'zombie'（v1 原体） | 单 ACK 锚 = 末 chunk 帧序；bytes = totalBytes | 吻合 | pass |
| ⑤ ack-timeout 弃置-恢复（F6 新增面） | abandonInFlight 入口捕获 abortedTransfer（显式清除前）→ peer true 时经单漏斗发 wire RESYNC_REQUIRED；载体保留；恢复后新 transferId 整笔重传 | **SA7-S4**（信号 + 载体保留 + 新 transferId 重切）；K8（peer→hub live）/K9（hub→peer live）/K10（未协商负控） | S4：transfer 在场 abandon → onAckTimeout(**true**) ∧ queuedCount 仍=1（v1 冻结队列语义）∧ needsResync；resetForLive 后 pull×3 → transferId=2 从 offset 0 整笔 3 chunk 收齐。K8：wire 恰 1 帧 RESYNC_REQUIRED、observer resync-required{ack-timeout} 恰一次、hub doomed assembly 清理（零 failed）、T2=transferId 2 整笔 3 chunk；K9 对偶；K10：未协商零 RESYNC 帧（PN6b 原体） | 两方向对称闭合；仅协商连接可触达（结构门） | 逐项吻合 | pass |
| ⑥ 公平调度（chunk 经既有 data 路径 + RR） | chunk 逐帧经 tryEmitData；RR 每轮每 ns 一帧；wheel 以 queuedCount>0 留轮（载体方案使零新调度机制） | **K15**（双 ns 严格帧序断言）+ 全套背压/公平回归 | K15：wire 数据帧序逐帧断言 = `[B-UPDATE, B-UPDATE, A-CHUNK, B-UPDATE, A-CHUNK, B-UPDATE, A-CHUNK]`（ns 序 B,B,A,B,A,B,A）——chunk 与他 ns UPDATE 逐轮交替无饥饿；双 ns 收敛零 resync；S1 证明 chunk 走 host 同一 send 回调形状（独立 sequence 由宿主分配） | 穿插不饿死；backpressure.ts 零改动（DENY 面 git status 实测未触碰） | 吻合 | pass |

## 4. Preserved Data Flow Verification

| Route | Preserved invariant | Runtime driver | Baseline observation | Current observation | Verdict |
|---|---|---|---|---|---|
| 限内 update 单帧路径 | 协商连接上限内写仍单 UPDATE + 单 ACK、零 chunk（NC1） | NC1（ac-red）+ K1（20KB 大写前后无多余 UPDATE）+ K11（3 UPDATE 直发帧形状） | SA6 轮 NC1 绿 | NC1/K1/K11 绿（本席复跑 23/23） | pass |
| 未协商超限 v1（deliver 时刻） | 超限判定仍在 sendAndRegister 直发时刻：队列空 → 丢弃 + needs-resync + send-failed{update-too-large} 响亮 | **SA7-S6(a)** + K3（协商但超 maxChunkedUpdateBytes 的 P4-S 回退同形）+ R1/R2/R3 冻结 + NC2 | SA6 §13：NC2/R1-R3 绿（v1 逐字节） | S6(a)：零 UPDATE 零 chunk、needsResync、declare{send-failed}.detail.reason='update-too-large'；K3：resync ×1、cause=send-failed、reason=update-too-large、零 chunk；NC2/R1/R2/R3 本席复跑绿 | pass |
| 未协商超限 v1（drain 时刻混合队列窗） | 队列非空 → F4 静默丢弃 + update-dropped{update-too-large}、排队项 FIFO 照发、零 RESYNC | **SA7-S6(b)** + K6 | SA6 §6 F4 语义（issue #231 冻结） | S6(b)：闸门关积压 1 项 → 闸门开超限写 → dropped reason='update-too-large'、零声明、排队项随后照发（pull → 1 UPDATE）；K6 wire 级同形 | pass |
| 未协商 ack-timeout（PN6b 原体） | 无 transfer 的 ack-timeout：零 wire 帧、本地边沿 + 恢复 round | **SA7-S5**（abortedTransfer=false + zombie）+ K10 | v1 语义（peer-namespace PN6b） | S5：onAckTimeout(**false**)、迟至 ACK='zombie'；K10：零 RESYNC_REQUIRED 帧、observer 恰一次、round 收敛回 live | pass |
| apply 管线/事实源 | 收方 apply 复用既有 `applyRemoteUpdate`（Runtime 唯一 write sequencer + dirty + update-applied）；零新事实源、零持久化新增 | K1/K2（saveDoc 恰 +1）、real-transport | ac5-live 7 测（既有 UPDATE apply 面） | K1/K2 save +1 恰一次；ac5-live 绿（复跑）；namespace-runtime/** DENY 面零触碰（git status） | pass |
| transferId 作用域 | resync/终态不复位（单调）；teardown（连接收口/新会话）归 1 | **SA7-S2/S3/S4/S7**；K8（T2=2） | ADR 0013:32 | S2/S3/S4：恢复重传 transferId=2（不复位）；S7：teardown 后归 1；K8 live 同证 | pass |
| 溢出/背压既有机制 | overflows 判据、shed、水位闸门、RR wheel、takeItems 合并零改动 | 全套 69 文件回归（含 issue169 背压记账、fairness、watchdog/recovery） | SA6 §4 基线 38 测 | 本席复跑 586/586 绿（+SA7 17 = 603/603）；backpressure.ts/round-engine.ts/observer.ts git status 零触碰 | pass |

## 5. State Machine Verification

| Initial state | Trigger | Expected transitions | Observed transitions | Forbidden transitions absent | Verdict |
|---|---|---|---|---|---|
| 发送 idle | deliver(chunkable) → drain 窥首 | idle → slicing{transferId,offset} →（末 chunk 出站）settled→idle（inFlight 持末序至 ACK） | S1：三段全部观测（含 settle 后 inFlight→ACK→effective=0）；S2 第二笔 transferId=2 | 末 chunk 前载体被 shift（S1 中间态 queuedCount=1 实证）；中间 chunk 注册 inFlight（零） | pass |
| 发送 slicing | markResyncReceived / discardQueued 族（9 路径汇聚单点） | aborted（clearActiveTransfer 内联）；needsResync ⇒ 无 activeTransfer | S3：queued=0、effective=0、恢复后从 offset 0 新 transferId 重切；K7（queue-overflow live：无续传 chunk、对端零 failed） | 僵尸续传（恢复后续发旧 transfer 后半段）——S3/K7/K14 均实证重传从 chunkIndex 0 起 | pass |
| 发送 slicing | ack-timeout（abandonInFlight） | aborted + abortedTransfer=true 上抛；**载体保留** | S4：queuedCount=1、onAckTimeout(true)；K8/K9 wire 级（声明 + 新 transferId 整笔重收） | abandon 连带清队列（破坏 v1 冻结语义）——S4 排除 | pass |
| 接收 idle | 首 chunk（校验 1–6 全过） | idle → assembling{buffer(totalBytes)} →（收齐 ∧ Σ==totalBytes）apply 恰一次 → idle | A6/A9；K1/K2（apply+ACK）；real-transport | 违例后残留半成品 buffer（A2–A5/A8：busy=false 零分配残留；A8 Σ 不符 reset） | pass |
| 接收 assembling | 后续 chunk（跨帧一致 ∧ 严格递增 ∧ 上界） | 追加 → more/complete；任一不符 → VIOLATION | A7：transferId/totalBytes/chunkCount 漂移、跳号、重复、overrun、per-chunk 超限全部 VIOLATION；K5（busy∧异 transferId live ns failed） | 错序/丢失被静默吞掉（WS 有序可靠 ⇒ 响亮） | pass |
| 接收 idle ∧ chunkIndex>0（残渣） | 按 ns 状态判别 | quiet 静默 / needs-resync∧reconciling 良性丢弃 / live 响亮 VIOLATION | K13（needs-resync 行：零 ERROR/零 failed/零 apply/零新增 SYNC）；K12（live 行：VIOLATION + ns failed + apply 前零写入 + 零 ACK） | 残渣触发 apply 或吞错 | pass |
| resyncEpisode 标记 | 置位 = 收帧边（onResyncReceived）+ 两漏斗（记忆化门后）；清除 = 恢复 round 结算回 live；**周期 round 不置不清** | needs-resync 期夭折 assembly 由结算边收口；周期 round 期下行 transfer assembly 跨 round 存活 | K13（收帧边置位消费）；K14（漏斗边置位 → 结算后 hub 新 transferId=2 首 chunk 正常收齐、peer ns 零 failed）；源码锚点 peer-namespace.ts:1027-1030 / hub-namespace.ts:1178-1181（settle-live-only） | 周期 round 误清并行 assembly；标记泄漏到下一周期 | pass |
| 连接协商 | dial → HELLO → HELLO_ACK → ready；dialNow 重建复位 0 | negotiated 生命周期 = 连接作用域 | K0/K1/NC0；peer-connection.ts:304 复位点源读 | 旧代协商位残留到新握手 | pass |

## 6. Error and Cleanup Flow

- **错误分类（运行时实测）**：上界族 → `UPDATE_TRANSFER_TOO_LARGE`（A2；K4：ns 级 ERROR + 终局 failed + apply 前零写入 + 分配前拒绝——D1）；结构族 → `UPDATE_TRANSFER_VIOLATION`（A3–A5/A7/A8；K5/K12）；状态族 → 既有 `NAMESPACE_STATE_VIOLATION`（首 chunk 镜像门，源读 peer/hub onUpdateChunk）；未协商收 chunk → 既有 decode `UNSUPPORTED_MESSAGE_TYPE` 连接级 1002（slice 1 冻结，ac-red P3 红灯期证据 + NC0 转绿路径）。
- **失败先于 apply（AC3）**：A2–A5/A8 违例后 busy=false（零分配残留）；K4/K12 live 级「hub 值不变 + saveDoc 零增量 + 零 ACK」；assembler 校验全部位于 `new Uint8Array(totalBytes)` 与 `applyRemoteUpdate` 之前（源序 + 运行双向证据）。
- **清理到达 quiescence**：发送侧单点 `clearActiveTransfer`（discardQueued 内联——S3；abandonInFlight 显式——S4；teardown 含队列清空 + transferId 归 1——S7）；接收侧挂点全集 = 收帧边（K13）+ 两漏斗记忆化门后（K14 经 `declareLocalResync`；hub 对偶）+ 恢复结算边（resyncEpisode 门控，K14）+ 终态/收口（源读 tryOpen/runDisposal/closeSessionAndRelease 调用点）。**F7 静态判据本席独立 grep 复核：生产 src `kind: 'RESYNC_REQUIRED'` sendChecked 发射点恰 2 处 = peer `declareLocalResync`（peer-namespace.ts:1101）+ hub `declareHubResync`（hub-namespace.ts:930）**，连接层出现均为收帧 dispatch 分支——发射点全集 == 挂点全集成立。
- **retry/restart 不复活旧路径**：S3/S4/K8/K9/K14——恢复后一律新 transferId 从 offset 0 整笔重传，落点为已被清理的干净 assembly（对端零 UPDATE_TRANSFER_VIOLATION、ns 零 failed）。

## 7. Temporary Diagnostics

- **零临时日志**：全部观察经既有/新增测试的返回值、wire 帧捕获、observer 事件、saveDoc 计数与 fake host 回调记账获得；未向生产代码添加任何 `[SA7-DATAFLOW]` 日志。
- 收尾核验：`git diff` 中 `SA7-DATAFLOW` 出现次数 = 0；工作树相对本席启动时的增量 = 新增测试文件 1 个（`ws-replication-issue243-sa7-dynamic.test.ts`）+ 本报告；关键场景在无任何诊断代码的状态下复跑结果不变（17/17 × 3 次、全套 603/603）。
- 新增测试文件为**永久补充动态测试**（仓库既有 sa7-* 测试文件同族），非临时诊断，列入 artifactPaths。

## 8. Dynamic Evidence Matrix

| Source | Requirement or risk | Driver | Expected | Actual | Evidence | Result | Suggested routing |
|---|---|---|---|---|---|---|---|
| SA6 AC1/AC2/AC8 | 超限 live 传输零 SYNC、帧上限、首 chunk 校验 | ac-red P1/P2（冻结契约）+ K1 + S1/A6 | 零 resync/零新增 SYNC、每帧 ≤ 上限、帧流自洽 | 23/23 绿；S1 三 chunk 1024/1024/952 | §10 命令 1/4 | pass | — |
| SA6 AC3 | 恰一次 sequenced apply；失败先于 apply | K1/K2（save +1）+ A2–A5/A8 + K4/K12 | 恰一次；违例零写入 | 吻合 | 命令 1/4 | pass | — |
| SA6 AC5 | ACK 锚 = 末 chunk 帧序 | K1/K2 + real-transport + S1 | ackedSequence == 末 chunk 序 | 吻合（三事件面配对 sequence=末序、bytes=totalBytes） | 命令 1/4 | pass | — |
| SA6 AC4 | 多 ns RR 穿插不回归 | K15 + 全套背压/公平回归 | 逐轮交替、既有 suite 绿 | 帧序逐帧断言吻合；586→603 绿 | 命令 2/5 | pass | — |
| SA6 AC6 | 未协商 v1 逐字节一致（全部组态） | R1/R2/R3 + NC2 + K0/K6/K10 + **S6（新增双窗口单元负控）** | 零漂移 | 全绿 | 命令 1/2/4 | pass | — |
| SA6 AC7 | 双 seam 收敛 | fake-duplex（23 测）+ real-transport（真实 TCP + MemoryPersistence 1 Hub + 2 Peers，仓内 real-transport 测试族既定 idiom） | 双绿 | 1/1 绿（分块上行 + fan-out 分块下行 + 回声抑制） | 命令 1 | pass | — |
| Design F1 | 未协商改道等价（deliver/drain 双时刻） | S6(a)/(b) + K6 + K3 | 同刻同形、分类词表零漂移 | 吻合 | 命令 4 | pass | — |
| Design F2 | deliver 溢出等清队列路径同步终止 transfer | S3 + K7 | 单点终止、无僵尸 | 吻合 | 命令 1/4 | pass | — |
| Design F3 | 残渣判别 + resyncEpisode 恢复结算边 | K12/K13/K14 + A 系 | live 响亮/恢复期良性/结算清 assembly | 吻合 | 命令 1 | pass | — |
| Design F4 | 有效占用口径（1 槽、末 chunk 槽位 1→1） | S1/S8 + K11 | 任意时刻 ≤ max；裸 inFlight ≤ max | S8（max=1 组态）：直发在途时 transfer 不启动；末 chunk 注册后 effective=1 | 命令 4 | pass | — |
| Design F5 | peer 逐字捕获协商位 | NC0（wire 代理路径转绿）+ K1（旋钮路径） | 代理与旋钮双路可建立协商 | 双绿 | 命令 1 | pass | — |
| Design F6 | ack-timeout 中止 transfer 的 wire 声明（双向 + 仅协商可达） | S4 + K8/K9/K10 | 恰一帧声明、doomed assembly 清理、新 transferId 整笔重收、对端零 failed | 吻合 | 命令 1/4 | pass | — |
| Design F7 | 发射点全集 == 两漏斗 | 独立 grep + K14 动态（session 边沿经漏斗） | sendChecked RESYNC 发射点恰 2 处 | peer:1101 + hub:930，无第三发射点 | §10 命令 6 | pass | — |
| Design D1 | 分配前上界校验（有界分配） | A2/A3（含双违例校验序实测）+ K4 | 违例零分配；TOO_LARGE 先于几何（序 #4→#5） | 吻合 | 命令 4 | pass | — |
| Design D2 | 超上限回退 v1（P4-S）+ 旋钮缺省关 | K3 + K0 + S6 | 零 chunk、v1 同刻同形 | 吻合 | 命令 1/4 | pass | — |
| SA4 §4.1 | 红灯契约 3 处断言修正的绿灯可达性 | 本席复跑 ac-red 6/6（修正后断言面全绿） | 语义保持 | 6/6 | 命令 1 | pass | — |

## 9. Commands and Evidence

worktree 根（全部本席现场独立运行；exit 0 除注明外）：

```
1  NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run \
     packages/ws-replication/test/ws-replication-issue243-ac-red.test.ts \
     packages/ws-replication/test/ws-replication-issue243-chunked-live.test.ts \
     packages/ws-replication/test/ws-replication-issue243-real-transport.test.ts
   → Test Files 3 passed (3)；Tests 23 passed (23)；Type Errors no errors
2  NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run \
     packages/ws-replication/test packages/replication-protocol/test
   → Test Files 69 passed (69)；Tests 586 passed (586)（SA7 文件加入前基线）
3  pnpm typecheck
   → exit 0（13 包 + apps/yjs-server；SA7 文件加入前后各一次）
4  NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run \
     packages/ws-replication/test/ws-replication-issue243-sa7-dynamic.test.ts
   → 17/17 passed（×3 次独立复跑，失败集/通过集逐名一致——确定性）
5  （最终合并）命令 2 + 4 同跑
   → Test Files 70 passed (70)；Tests 603 passed (603)；Type Errors no errors；root typecheck exit 0
6  grep -n "kind: 'RESYNC_REQUIRED'" packages/ws-replication/src/*.ts
   → hub-namespace.ts:930（declareHubResync 漏斗内）/ peer-namespace.ts:1101（declareLocalResync 漏斗内）——恰两处
```

## 10. Deviations

1. **DD-3.8（peer 周期 reconcile 延后判据扩 `effectiveInFlightCount()`）无专属 live 动态行**：设计 §12 验收映射未列该行；本席证据 = 源读（peer-namespace.ts:1070 单点消费包内访问器）+ S8 对访问器语义的动态证明（无 transfer ≡ 裸口径；transfer 在场 +1）。风险残余为零面（判定为单行消费既有口径）。
2. **DD-5 hub `drainActive` 名单 +`UPDATE_CHUNK` 无专属动态行**：设计 §12 未列；证据 = 源读（hub-connection.ts:755-758 UPDATE_CHUNK 与 UPDATE 同列丢弃）。reauth drain 窗口注入属 #244/后续切片可再补。
3. **AC7「真实 WebSocket」以真实 TCP transport（node:net + 4B 长度前缀成帧）+ MemoryPersistence 实现**：仓内 real-transport 测试族（sa7-issue170/171、r2-transport）既定 idiom，SA4 已按此复核接受；协议帧流与传输载体正交，动态证据（分块上行/fan-out 下行/回声抑制/单 ACK）不受影响。
4. **本席新增测试的两次自 fixture 修正（非实现缺陷）**：A3 初版误选 totalBytes=5000（同时超 maxChunkedUpdateBytes）→ 实测返回 TOO_LARGE，恰为校验序 #4 先于 #5 的运行时证据（已保留为断言）；A7 初版 overrun 组态算术错误（1024+1024 ≤ 3000 非越界）→ 改为 totalBytes=2000 组态。修正后 17/17。
5. SA3 报告 §7 / SA4 §4.3 登记项（K6 hub save 门闩持久化投影怪异性、AC5 措辞与混合窗口重锚关系、混编部署 R9）维持登记，不属本席验证范围的缺陷。

## 11. Verdict

**approve**（`requiresConflictRecheck: false`）：

- 设计声明改变的五条路线（协商/发送分块/接收重组/ACK 结算/F6 弃置-恢复）+ 公平调度面全部按设计变化，关键中间跳点（载体守恒、有效占用口径、分配前校验序、末 chunk 结算与三事件配对、中止信号与载体保留）均有运行时证据；
- 设计声明保持的路线（限内单帧、未协商 v1 双窗口、PN6b ack-timeout、apply 管线、transferId 作用域、溢出/背压机制）保持不变；
- 状态机合法转换与关键值正确，禁止状态（僵尸续传、末 chunk 前载体消失、违例后分配残留、残渣触发 apply、周期 round 误清 assembly）均未出现；
- 错误分类与清理符合设计并到达 quiescence；F7 发射点全集静态判据独立复核成立；
- 零临时诊断；本席唯一新增 = 补充动态测试 + 本报告；未修改交付代码，未 commit/push。
