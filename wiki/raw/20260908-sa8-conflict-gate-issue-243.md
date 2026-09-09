# SA8 Conflict Gate Report — Issue #243（issue #233 切片 2）

- Dispatch: `sa-0e0a79f2-3b38-49cf-bb82-b9488db2b5d9`（mabf-sa8 / conflict-gate / iteration 0）
- 对象：issue #243「ws-replication：超限 UPDATE 分块端到端 live 传输（issue #233 切片 2）」当前任务简报（Host-owned brief）
- 裁决基准（仅此二者）：`docs/adr/` ADR 全集（无被 supersede 的相关 ADR）+ 根 `CONTEXT.md`
- 工作区：worktree `nomicore-fix-issue-243`，分支 `mabf/issue-243`（HEAD `c20aeb0`）
- 结论：**无冲突放行（clear）** —— 0 项 ADR/CONTEXT 矛盾、0 项阻塞；2 项必答决策面、4 项观察项

## 1. 输入与证据

| 证据 | 位置 | 状态 |
|---|---|---|
| Host 任务简报快照 | `wiki/raw/task_issue-243.md`（untracked，随 dispatch 注入） | 与 GitHub 实时 issue body 逐字一致（gh `issues/243` 比对） |
| ADR 0013 分块传输 | `docs/adr/0013-chunked-live-update-transfer.md` | 状态「提议」；未被取代；切片系列按其执行（slice 1 已落地），是本特性线的操作性决策 |
| ADR 0010 复制基线 | `docs/adr/0010-hub-peer-websocket-ydoc-replication.md` | 已接受；§10 fan-out/窗口/ACK durability 语义 |
| CONTEXT.md 词汇 | `分块复制传输` / `UPDATE_CHUNK` / `CAP_CHUNKED_UPDATE` 条目 | 与简报一致；明确「切片 1 冻结 wire 面，后续切片承接状态机」＝本切片 |
| 协议文档 wire 面 | `docs/protocols/instance-replication-v1.md` §5/§10.3/§8-capability | slice 1 已注册 0x42 消息、capability bit、codec 级单帧规则；跨帧/assembly/ACK 复用显式标注「属后续切片」 |
| slice 1 代码 | commit `c20aeb0`（PR #264，merged 2026-09-08，base = `feat/issue-233-chunked-update-base`） | `packages/replication-protocol/`（codec、golden vectors、错误码、decode 门控）；连接层 `UPDATE_CHUNK` 分支现为防御性 connectionFatal 占位（peer-connection.ts:525 / hub-connection.ts:790）——正是 slice 2 要替换的挂点 |
| 测试 seam | `packages/ws-replication/test/harness.ts`（fake-duplex）；`ws-replication-sa7-*-real-transport*.test.ts`（真实 WS）；`apps/yjs-server/test/phase5-three-instance-acceptance-red.test.ts`（MemoryPersistence 多实例）；`ws-replication-issue233-repro.test.ts`（R1/R2/R3 刻画基线） | 简报验收标准 7 所引 seam 全部存在 |
| 切片系列 | #242（CLOSED，ci-passed）→ #243 → #244 → #245 → #246（均 OPEN） | 见 §4 分工 |

### 1.1 Owner 反馈 / 评论扫描记录（dispatch 要求）

- **REST 评论扫描：空数组**。本会话执行 `gh api repos/{owner}/{repo}/issues/243/comments` → 返回 `[]`（exit 0，非分页截断）。与 dispatch 声明一致：issue #243 无任何评论，**无额外 owner 要求**。
- 交叉参照：issue #242 评论同为 `[]`。Host 简报快照的 `## Comments` 节为空，三方一致。
- 结论：以 issue body + Host 简报为全部需求面，无评论衍生的追加约束或豁免。

## 2. 简报 vs 决策集逐条裁决

### 2.1 "What to build" 机制声明（8 项检查 — 全部无冲突）

| # | 简报声明 | 基准条款 | 裁决 |
|---|---|---|---|
| B1 | 超限 update 不再丢弃退化为全量 reconciliation（协商前提） | ADR 0013 决策节/后果 | 无冲突 |
| B2 | 出队时刻惰性切片，队列持完整 update | ADR 0013 发送端规则（记账号径不变） | 无冲突 |
| B3 | chunk 逐帧经既有 data 路径：独立 sequence、RR 每轮每 namespace 一帧、dataGateOpen 水位闸门 | ADR 0013 发送端规则；ADR 0010 §17 分层 | 无冲突 |
| B4 | 整笔 transfer 占 1 个 in-flight 窗口槽 | ADR 0013 发送端规则（显式决策） | 无冲突（机制细节归 SA1，见 W2） |
| B5 | 接收端 detached buffer 重组 + 首chunk校验 + 总长核对 | ADR 0013 接收端规则 | 无冲突（边界见 D1） |
| B6 | 唯一 write sequencer 恰一次 trusted apply + dirty notification | ADR 0013 接收端规则；ADR 0010/0008 sequencer 纪律；CONTEXT「写序列器」 | 无冲突 |
| B7 | 单 UPDATE_ACK（末 chunk 帧序）结算；Hub 正常 fan-out、不回送来源 | ADR 0013 消息形态节；协议 §10.1/§10.2；§10.3 已预留「ACK 复用…属后续切片」 | 无冲突 |
| B8 | 未协商双端 v1 逐字节一致（超限丢弃 + needs-resync） | ADR 0013 协商节（UNSUPPORTED_MESSAGE_TYPE 天然 gating，slice 1 已实现） | 无冲突 |

### 2.2 验收标准（8 项 — 7 项无冲突，2 项挂决策面）

| # | 验收标准 | 裁决 |
|---|---|---|
| AC1 | 超限但在 `maxChunkedUpdateBytes` 内 → live 传输 + 单 ACK，零 SYNC round | 无冲突（ADR 0013 后果节原文）；**但该配置的交付归属见 D2** |
| AC2 | 每帧 ≤ `maxUpdateBytes` 与 `maxFrameBytes` | 无冲突（chunk 复用 maxUpdateBytes，链式不变量） |
| AC3 | 恰一次 sequenced apply；重组失败先于 apply，live Y.Doc 零写入 | 无冲突（ADR 0013 接收端规则；CONTEXT「复制未校验」不涉） |
| AC4 | 多 namespace RR 穿插；backpressure/公平调度测试不回归 | 无冲突（ADR 0013 发送端规则 + 后果） |
| AC5 | ACK 计时锚 = 末 chunk 出站时刻；`ackTimeoutMs` 语义不变 | 无冲突（ADR 0013 原文） |
| AC6 | 未协商：R1/R2/R3 刻画测试逐字节全绿 | 无冲突（刻画文件保留为现状基线；`ws-replication-issue233-repro.test.ts` 在位） |
| AC7 | fake-duplex 与真实 WS + MemoryPersistence 1 Hub + 2 Peers 双 seam 绿 | 无冲突（两 seam 均已存在，见 §1） |
| AC8 | 首 chunk 基础校验：chunkIndex 严格递增、transferId/totalBytes/chunkCount 跨 chunk 一致；违例分类切片 3 完备化 | 无冲突（切片分工合法）；**临时期分配上界见 D1** |

### 2.3 依赖与阻塞（0 项阻塞）

- **Blocked by #242：已解除**。#242 CLOSED（ci-passed），PR #264 已 merge（2026-09-08T13:39:12Z），base 为 `feat/issue-233-chunked-update-base`，commit `c20aeb0` 在本 worktree 分支谱系内。slice 1 交付物（codec/golden vectors/capability 协商/两错误码/RESYNC reason/decode 门控）齐全，slice 2 地基完整。
- **Parent PR #241（OPEN，mergedAt null）不构成阻塞**：堆叠 PR 工作流——切片 PR 依次合入 base 分支，#241 为总伞。ADR 0013 与刻画测试（`164eee7`）已在谱系内，本门禁的基准集完整。观察项 W1 记录其生命周期。

## 3. 必答决策面（不阻塞派发，SA1 设计必须显式回答）

- **D1 — slice 2 临时期分配上界**：ADR 0013:59 将资源上界校验（`totalBytes ≤ maxChunkedUpdateBytes`、`chunkCount ≤ maxChunksPerUpdate`、`totalBytes ≤ chunkCount × maxUpdateBytes`）**并入首 chunk 校验**，并决定「恶意声明不可能导致无界分配」（按已验证上界一次性分配）。而 #244（slice 3）才交付「恶意申报在首个数据字节流入前拒绝 + 有界分配」与两错误码分类。若 slice 2 的接收端按申报 `totalBytes` 直接分配而延迟全部上界校验，将在切片间窗口**临时违反该已决定的安全不变量**。SA1 必须给出临时期答案（建议：slice 2 即执行 totalBytes/chunkCount 上界校验——AC1 本就引用该配置；仅把违例→两码的分类完备化与中止矩阵留给 #244）。终态与 ADR 一致，故为决策面而非冲突。
- **D2 — 配置旋钮交付切分**：AC1 引用 `maxChunkedUpdateBytes`，但 #244 声明四个新配置（含启动期响亮校验链）为其交付物。slice 2 至少须引入 `maxChunkedUpdateBytes`（发送端分块上界 + 接收端首 chunk 上界；隐含发送端超此值回退 v1 行为——ADR 仅由后果节隐含，未显式陈述，设计需写明并测试）。归属需 owner/SA1 裁定，避免双切片各建半套校验链。

## 4. 观察项（切片系列已显式管理，无需 override）

- **W1 — ADR 0013 状态「提议」**：转「已接受」显式归属 #246（slice 5，其验收标准原文含状态翻转与协议权威登记）。slice 1 已按其执行且协议文档已引用，本特性线内其为操作性决策；不构成对简报的阻塞。
- **W2 — 协议文档暂时滞后**：`instance-replication-v1.md` §10.3 已声明跨帧规则/assembly/ACK 复用「属后续切片」，§10.2 现行文字（每 namespace 32 in-flight UPDATE）尚未承载「整笔 transfer 占 1 槽」语义；文档修订归属 #246。slice 2 不得引入 #246 无法追认的偏离（transfer 槽语义恰为 ADR 0013 已决定内容，可追认）。
- **W3 — 观测面与中止矩阵后置**：ADR 0013 的 4 个 observer 事件归属 #245；中止清理矩阵/zombie 簿记/中止时窗口槽释放归属 #244。简报对二者沉默是切片分工而非 ADR 违反；slice 2 的 abort 临时路径以连接拆除为界自然收敛，不留 durable partial state（CONTEXT「分块复制传输」Avoid 清单仍全程有效）。
- **W4 — 诊断日志纪律**：chunked apply 复用 `ReplicationSession.applyRemoteUpdate` 既有路径，ADR 0011/0014 无新增触发面；若 SA1 设计在分块路径新增诊断 emission，调用点必须在 write sequencer slot 之外（ADR 0014-LOG 纪律）。

## 5. 裁决汇总

- 检查项合计：**24**（B1–B8、AC1–AC8、阻塞 1、PR 谱系 1、D1、D2、W1–W4 中切片分工 3、诊断 1）
- 分布：无冲突/对齐 **22**；必答决策面 **2**（D1、D2）；阻塞 **0**；与 ADR/CONTEXT 矛盾需 override **0**
- 门禁结论：**clear** —— 可进入 SA1 设计与后续派发；D1/D2 须在设计中显式回答并在设计复审时回查。
