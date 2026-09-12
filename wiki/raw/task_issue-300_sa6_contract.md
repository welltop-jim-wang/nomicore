# SA6 诊断与验收契约报告 — issue #300（#295 切片 2）：chunked BOOTSTRAP_SNAPSHOT / SYNC_STEP2 端到端

- **dispatch**: sa-02dde9f5-fe47-474a-a2bd-36dcff303cc6（mabf-sa6 / acceptance-contract / iteration 0）
- **任务类型**: **Feature**（`feat(#295 切片 2)`）——不虚构 Bug 根因；本报告证明**能力缺口**（kind=1/2 分块传输链路不存在），并把目标行为固化为红灯验收契约 + 绿负控。
- **裁决**: **approve**（能力缺口可信、契约可执行、测试入口真实；8 条红灯全部因能力缺失而失败，4 条负控当前即绿，既有 485 条包内测试零回归）。
- **契约文件**: `packages/ws-replication/test/ws-replication-issue300-chunked-sync-ac-red.test.ts`（新增，1085 行，12 用例：8 红 + 4 负控）。
- **基线**: `mabf/issue-300` @ `605a48f`（#299/PR #321 合并点，`git rev-parse HEAD` 实测）；刻画文件 `ws-replication-issue233-repro.test.ts` **未改**（`git status --porcelain` 为空）。

---

## 1. Task type and inputs

**类型 = Feature**：issue #300 是 ADR 0022（已接受、docs 已随 `2ca06f6`/`eb380d7` 冻结）的传输层实现票（切片 2/3）；`#299`（切片 1：0x42 单形态 codec + 两聚合上限配置链）已落地，本票要求把 kind=1（snapshot）/kind=2（sync-diff）端到端接通。

输入（全部实读）：

| 输入 | 用途 |
|---|---|
| `wiki/raw/task_issue-300.md` | 任务简报（What to build / AC1–AC5 / Blocked by #299） |
| `wiki/raw/task_issue-300_relevant_decisions.md` | ADR 0022 / ADR 0013 / ADR 0010 / 协议 §5/§8/§9/§10.3/§13.2/§16/§17/§18/§22/§23 摘录 |
| `wiki/raw/task_issue-300_conflict_report.md` | SA8 前置门禁（clear；R42–R47 + N6） |
| `docs/adr/0022-chunked-sync-transfer.md`、`docs/protocols/instance-replication-v1.md` | 规范权威（wire 冻结值唯一权威 = 协议） |
| `packages/ws-replication/src/{hub-namespace,peer-namespace,round-engine,frame-io,update-channel,update-transfer,error-mapping,types,validate}.ts`、`packages/replication-protocol/src/{messages,payloads}.ts` | 现状实现事实（能力缺口定位） |
| 既有测试：`ws-replication-issue233-repro.test.ts`（刻画基线）、`issue243/244/245/246`（kind=0 先例/回归锚）、`issue299-ac-red`（配置链）、`issue256`（observer 回归锚）、`issue137-driver.ts`/`harness.ts`（确定性驱动） | 契约风格、回归面、运行入口 |

**Issue comment REST snapshot = `[]`**（与 dispatch 声明及 SA8 §1 一致）——无 owner 补充要求、无 override 需要并入。

---

## 2. Owner comment mapping

| Owner 输入 | 映射 |
|---|---|
| （无 — issue #300 comments 空；owner 未留补充评论） | 任务要求的唯一来源 = issue body/AC1–AC5 + ADR 0022 + 协议冻结文本。本契约不引入任何额外行为、不发明错误码/字段/事件。 |

---

## 3. SA8 constraints（逐条吸收，含 validation 与 failure-semantic 面）

| SA8 项 | 契约落点 | 证据/断言 |
|---|---|---|
| **R42** 三 kind 共用同一 (连接,方向,namespace) `transferId` 计数器 | **R2**：先 kind=0 transfer（phase A，transferId=a）再 kind=2 transfer（phase B，transferId=b），断言 `b > a` | 断言消息显式写「单计数器共享」；kind=0 由 #243 既有实现提供真值 |
| **R43** 解码侧 0x42 协商门不得因 kind 泛化弱化；未协商端不分 kind **pre-parse** `UNSUPPORTED_MESSAGE_TYPE` | **N3**：未协商连接 + 伪造 payload（首字段 `transferKind=3`，若门控后置必落 `MALFORMED_FRAME`）→ 断言 wire 上 `UNSUPPORTED_MESSAGE_TYPE`、close 1002、`blocked`、**零** namespace 级 `SNAPSHOT_*`/`SYNC_*` | 伪造 payload 是「pre-parse」的敏感探针；当前即绿 → 实现后不得退化 |
| **R44** 首 chunk 校验 = 协议全四条（按 kind 聚合上限 ∧ `chunkCount ≤ maxChunksPerUpdate` ∧ `totalBytes ≤ chunkCount × maxUpdateBytes` ∧ `chunkCount ≥ 1`） | **R4**（kind=1）：聚合超限/计数超限/几何不一致三类违例 + **边界（恰在上界，≤ 含等号）必须接纳**；**R6**（kind=2）：真实 transfer 的后续 chunk `totalBytes` 漂移 | 边界用例（`totalBytes = 64KiB = maxChunkedBootstrapBytes` ∧ `chunkCount = 64 = maxChunksPerUpdate`）是 `≤` 的 off-by-one 敏感锚；`chunkCount ≥ 1` 由 codec 单帧规则（`chunkCount must be >= 1` → `MALFORMED_FRAME`）承载，属 #299 已冻结面，本契约不重复断言 |
| **R45** kind=2 发送端聚合超限分支未逐字冻结（协议只冻结接收端首 chunk 校验 + §23.3 peer `send-failed`） | **R7**：100KB 恢复 diff > `maxChunkedSyncDiffBytes` 32KiB → 断言**冻结错误族码在 wire 可观察**（任向）+ 终局 failed + 零写入 + 不回落 `SYNC_DIFF_TOO_LARGE`；对「发送端预检」与「接收端首 chunk 校验」两种合规落地**同时成立** | 场景 14（hub `send-failed` → `SNAPSHOT_TRANSFER_TOO_LARGE`）的改写义务属实现 ticket；本契约以 R7 + R4 覆盖同类冻结语义，不做文档义务断言 |
| **R46** 切片边界：observer 8 型接线归 #301 | 契约**零** `chunked-snapshot-*`/`chunked-sync-*` 事件断言；断言面 = wire 帧/namespace 状态/live Y.Doc/持久化 dirty 计数 | 全包回归运行中 `ws-replication-issue256-namespace-failed.test.ts` 等 observer 锚保持绿（§13） |
| **R47** append-only 冻结面零顺手改；kind=0 逐字节等价 | **N4**：kind=0 可分块 live update（20KB）→ `transferKind=0`、无绑定块、单 `UPDATE_ACK` 锚末 chunk 帧序、收敛；另加全包 #243–#246 锚回归 | 契约不发 `transferKind` 0/1/2 外的任何值；不改 codec/错误码/配置键 |
| **N6**（环境观察）origin/main `b158f98` 另有一篇 `0019-vfsl-union-member-docs.md` 曾同号 ADR（已消解：本基线篇重编号 0022） | 本报告与契约中「ADR 0022」一律指 `0022-chunked-sync-transfer.md`；该 main 提交不在本基线决策集内（非祖先），不阻塞 | 契约 header 显式引用 ADR 文件路径而非仅编号 |

**规范约束保留**（实现不得偏离、契约负责锁住）：单帧路径保留（触发条件非兼容回落，N1/N2）；聚合上限按 kind 取键（`maxChunkedBootstrapBytes`/`maxChunkedSyncDiffBytes`）；首 chunk 绑定块位置/单形态字段序（#299 冻结，不改 codec）；ACK/导入语义不变（`BOOTSTRAP_ACK`/`SYNC_APPLIED` 单 ACK + `ackedSequence = 末 chunk 帧序`）；chunk 走 data 路径、control reserve 零 chunk（R3 闸门观测）；同一 transfer 内 `chunkIndex`/`chunkCount`/`totalBytes` 逐字节一致。

---

## 4. Environment and baseline

- 环境：Node `v24.13.0`、pnpm `10.28.2`、vitest `3.2.7`、yjs `13.6.30`、TS `5.9.3`；依赖经本地 pnpm store **离线**安装（`pnpm install --frozen-lockfile --offline`，零网络）。
- 基线 HEAD `605a48f`；工作树初始仅 3 个未跟踪简报快照（无未提交漂移）。
- **刻画基线复跑**（改动前）：
  `NODE_OPTIONS=--conditions=nomicore-source npx vitest run packages/ws-replication/test/ws-replication-issue233-repro.test.ts --typecheck.enabled=false` → **3/3 绿**，日志与 issue 正文逐字一致：
  - R1：20KB 写 → 零 UPDATE、1× `RESYNC_REQUIRED`、恢复 diff 以单个 `SYNC_STEP2` 控制帧（20,029B）承载；
  - R2：两轮 resync；
  - R3：100KB 写 + `maxSyncDiffBytes=32_768` → peer→hub `ERROR:SYNC_DIFF_TOO_LARGE` → namespace `failed`，hub 恒 `seed`、连接 `ready`。
- **全包基线（含本契约）**：`npx vitest run packages/ws-replication/test --typecheck.enabled=false` → 69 文件 / 493 用例：**8 failed | 485 passed**；8 条失败**全部且仅为**本契约的红灯用例（§13）。

---

## 5. Positive reproduction（能力缺口复现）

复现全部经真实 yjs / Registry / Runtime / fake-duplex wire，`chunkedUpdate: true`（同版本部署假设下已协商 `CAP_CHUNKED_UPDATE`，否则 0x42 被 pre-parse 拒绝），零 real sleep。以下为诊断探针（临时文件，已删，§16）逐帧观测：

**(a) 超限 snapshot（R1 构型：`maxBootstrapBytes=8KiB`，hub 初始 100KB 文档，peer 全新）**
```
hub→peer: OPEN_OK#2, ERROR:BOOTSTRAP_TOO_LARGE#3
peerToHub: OPEN_NAMESPACE#2
peer namespace = failed；kind=1 chunk 数 = 0；peer 无副本
```
→ 单帧 `BOOTSTRAP_TOO_LARGE` 终局，namespace 永久失同步（ADR 0022 L98 要消除的路径）。

**(b) 超限恢复 diff（R2/R3 构型：`maxUpdateBytes=8KiB`，100KB 写不可分块 → F4 丢弃 → resync）**
```
peerToHub: UPDATE_CHUNK k0/t1/i0..2 (20KB 可分块 live，phase A 收敛)
           RESYNC_REQUIRED#10, SYNC_STEP1#11, ERROR:SYNC_DIFF_TOO_LARGE#12
peer namespace = failed；hub 停在 20KB 旧值；kind=2 chunk 数 = 0
```
→ 恢复 diff（≈100KB > `maxSyncDiffBytes`）在发送端编码面终局；ADR 0022 要求的 kind=2 改道不存在。

**(c) 双向镜像（hub→peer 超限 diff）**
```
hubToPeer: RESYNC_REQUIRED#7（live 路径不可分块）, SYNC_STEP1#8, ERROR:SYNC_DIFF_TOO_LARGE#9
peer namespace = failed
```
→ hub 侧 Step2 编码同样终局；「双向 SYNC_STEP2 diff」两向均缺。

**(d) data 路径绕行（R3 构型：hub transport `bufferedAmount = 600KiB > highWater`，data 闸门关闭）**
→ 现实现仍以控制帧 `ERROR:BOOTSTRAP_TOO_LARGE` 直接决定 bootstrap 结局（控制帧不受 data 闸门约束），peer `failed`；R1 揭示的 control 路径绕行未消除。

**(e) 接收端 kind=1 校验（crafted 帧注入：丢单帧 `BOOTSTRAP_SNAPSHOT` 把 peer 悬在 `bootstrapping`，再按被丢帧序注入合法编码的 kind=1 首 chunk，绑定块取 OPEN_OK 真值）**

| case | 注入声明 | 现状观测 | 期望（冻结契约） |
|---|---|---|---|
| aggregate | `totalBytes=128KiB > maxChunkedBootstrapBytes 64KiB` | `NAMESPACE_STATE_VIOLATION` | `SNAPSHOT_TRANSFER_TOO_LARGE` |
| count | `chunkCount=65 > maxChunksPerUpdate 64` | 同上 | `SNAPSHOT_TRANSFER_TOO_LARGE` |
| geometry | `totalBytes=48KiB > 2 × 8KiB` | 同上 | `SNAPSHOT_TRANSFER_VIOLATION` |
| boundary | `totalBytes=64KiB` ∧ `chunkCount=64`（恰在上界） | 同上（被误判） | **接纳**（assembly 悬置，零 ERROR） |
| binding-id | `replicationId ≠ OPEN_OK` | 同上 | `REPLICATION_ID_MISMATCH` |
| binding-epoch | `replicationEpoch ≠ OPEN_OK` | 同上 | `REPLICATION_EPOCH_MISMATCH` |

（6/6 case 均 `peer state → failed`、`peerDocPresent=false`：违例先于导入，零写入。）

**(f) 接收端 kind=2 校验（真实 transfer 无法产生）**
- 跨帧 `totalBytes` 漂移 / 首 chunk `syncRoundId` 漂移 / 声明超聚合上限三种构型下，`kind=2 chunk 数 = 0`；现实现一律在发送端编码面落 `SYNC_DIFF_TOO_LARGE`，hub 值恒 `seed`、零 dirty、peer `failed` —— 接收端校验面（`SYNC_TRANSFER_VIOLATION`/`SYNC_STATE_VIOLATION`/`SYNC_TRANSFER_TOO_LARGE`）**结构性不可达**。

**(g) 敏感性反证（同一注入面在 kind=0 上成立）**：把同一「改写第 1 个 chunk `totalBytes`」的发送代理施加到 kind=0 transfer → hub 立即 `ERROR:UPDATE_TRANSFER_VIOLATION`、零写入。证明注入机制真实生效，且 kind=2 的红**不来自注入/环境**而来自 kind=2 路径缺失。

---

## 6. Negative control

| 负控 | 断言 | 现状 | 实现后义务 |
|---|---|---|---|
| **N1** | 未超 `maxBootstrapBytes` 的 snapshot → 恰 1 帧 `BOOTSTRAP_SNAPSHOT`、零 0x42、单 `BOOTSTRAP_ACK`（`ackedSequence` = 该帧序）、收敛 | ✅ 绿 | 保持（触发条件边界：不得对界内载荷改道分块） |
| **N2** | 16KB 恢复 diff ≤ `maxSyncDiffBytes` → 恢复 round **恰 1 帧** `SYNC_STEP2`（`8KiB < len ≤ 32KiB`）、零 kind=2 chunk、收敛 | ✅ 绿 | 保持（单帧路径不是兼容回落） |
| **N3**（R43） | 未协商端 + 伪造 0x42 → pre-parse `UNSUPPORTED_MESSAGE_TYPE`、close 1002、`blocked`、零 namespace 级码 | ✅ 绿 | 保持（kind 泛化不得弱化协商门） |
| **N4**（R47） | kind=0 可分块 live update → `transferKind=0`、无绑定块、单 `UPDATE_ACK` 锚末 chunk 帧序、收敛、反向零 chunk | ✅ 绿 | 保持（kind=0 逐字节等价；#243–#246 锚另有全包回归） |

负控同时证明红不来自环境/入口/断言敏感度：N1/N2 与 R1/R2 共用同一 boot helper/额度链，只改载荷规模；N3 与 R4/R5 共用同一注入函数，只改协商位；N4 与 R2 phase A 共用同一 kind=0 路径。

---

## 7. Stability, scale and timing

- **稳定性**：契约连跑 3 次（`--typecheck.enabled=false`）→ 每次 `8 failed | 4 passed (12)`，失败集合与失败断言逐字相同（零抖动）；全包运行复现同一 8 条。
- **规模**：载荷 20KB（≈3 chunk）/ 100KB（≈13 chunk，`maxUpdateBytes=8KiB`）；`maxInFlightUpdates=8`；无窗口溢出路径依赖；内存上界判据用 `maxChunkedBootstrapBytes/maxChunkedSyncDiffBytes = 512KiB`（= 64 × 8KiB 链②边界内）。
- **时序**：全部为微任务/假调度器驱动（`settle`/`settleUntil` ≤3000 微任务迭代；`advance(1000)` 仅用于 R3 释放闸门后的 drain）；**未推进虚拟时间**，故 `assemblyTimeoutMs`(30s)/`bootstrapTimeoutMs`(10s)/`ackTimeoutMs`(60s) 等计时器不可能触发——红灯不可能是超时/预算产物（R1/R2 的红改为先 `settle()` 再断言状态，避免 `settleUntil 预算耗尽` 形态的伪红）。
- **竞态**：无真实并发；跨方向顺序用 `timeline` 语义的 wire 数组断言，不依赖真实时间。

---

## 8. Capability gap（能力缺口链，替代 Bug 根因链）

| Step | Fact | Evidence | Confidence |
|---|---|---|---|
| 症状 | 超单帧上限、未超聚合上限的合法文档在 bootstrap / 恢复同步路径永久失败 | §5(a)(b)(c)；`ws-replication-issue233-repro.test.ts` R1/R3 绿（刻画） | 高 |
| 直接故障点 ①（snapshot 发送端） | hub 对超 `maxBootstrapBytes` 的快照直接 `sendNsError('BOOTSTRAP_TOO_LARGE')` + `finalize('failed','send-failed')`，零分块出站 | `hub-namespace.ts` L521–529；§5(a) 逐帧 | 高 |
| 直接故障点 ②（diff 发送端/接收端） | `RoundEngine.sendStep2` 恒以单帧 `SYNC_STEP2` 出站，编码经 codec 字段限额 `maxSyncDiffBytes`；超限 → 发送端 `sendNsError(code)` 终局 | `round-engine.ts` L184–194；`frame-io.ts` L86–87；§5(b)(c) | 高 |
| 直接故障点 ③（接收端 assembler） | `ChunkedTransferPiece`/`UpdateChunkAssembler` **无 kind 字段**，只按 `maxChunkedUpdateBytes` 单一上界组装，无绑定块内容核对；hub/peer 的 `onUpdateChunk` 对任何 0x42 都走 kind=0 语义与 ns 状态门（`bootstrapping` 期被 `NAMESPACE_STATE_VIOLATION` 拒绝） | `update-transfer.ts` L23–29/L85–88/L184–197；`hub-namespace.ts` L669–723；`peer-namespace.ts` L661+；§5(e)(f) | 高 |
| 直接故障点 ④（发送端分片器） | `UpdateChannel.startTransfer/sendOneChunk` 恒发 `transferKind: 0`，`sendUpdateChunkFrame` 无 kind/绑定块参数 | `update-channel.ts` L400–472；`hub-connection.ts` L1019–1030；`peer-connection.ts` L805–820 | 高 |
| 直接故障点 ⑤（记账/调度） | 分块载荷只有 kind=0 的 data 路径接线；snapshot/diff 仍由 control 路径承载（R1 绕行） | `frame-io.ts` `OutboundQueue.sendControl/drain`；§5(d) 闸门实验 | 高 |
| 触发条件 | 载荷 > `maxBootstrapBytes`/`maxSyncDiffBytes` 且 ≤ `maxChunkedBootstrapBytes`/`maxChunkedSyncDiffBytes`；同版本部署（`CAP_CHUNKED_UPDATE` 已协商，否则 0x42 pre-parse 拒绝） | 协议 §8.1 L200–202、§9.2 L236–238、§10.3 L345；N3 绿 | 高 |
| 放大因素 | sync 段恢复 diff 以控制帧出站 → 绕过 data 路径水位/窗口记账并占用 control 保留额度（R1 结构性绕行） | `ws-replication-issue233-repro.test.ts` R1 注释与日志；§5(d) | 高 |
| 最深根因 | 切片划分：#299（切片 1）只交付 codec 单形态 + 配置链；**切片 2（本票）的传输层路由/kind 泛化/接收端校验尚未实现**——四新错误码与两聚合上限键已注册但无发射点 | `defaults.ts` 已有两键；`error-mapping`/registry 已有四码（#299 契约绿）；源码零 `transferKind` 出站（除 kind=0） | 高 |
| 未证实假设 | kind=2 发送端是否做聚合预检（协议未冻结，R45）→ 契约对两种落地均成立（§12 R7） | SA8 R45 | — |
| 已排除 | 环境/依赖/入口/配置链/codec/协商门缺陷（§11） | — | 高 |

---

## 9. Causal experiments（控制变量/反证）

| 实验 | 变量 | 结果 | 结论 |
|---|---|---|---|
| E1 | 同一 hub 文档（100KB）下 `maxBootstrapBytes` 8KiB vs 64KiB（界内） | 超限 → `BOOTSTRAP_TOO_LARGE` 终局；界内 → 单帧 snapshot 收敛（N1 绿） | 触发条件 = 单帧上限；界内路径与超限路径分离，断言对边界敏感 |
| E2 | 同一 100KB 写在 `maxChunkedUpdateBytes` 64KiB vs 4KiB | 可分块 → kind=0 3 chunk 收敛；不可分块 → F4 丢弃 → resync → `SYNC_DIFF_TOO_LARGE` | 复现入口（恢复 diff）与 kind=2 缺失解耦清晰 |
| E3 | hub data 闸门 开 vs 关（`bufferedAmount` 注入） | 闸门关：控制帧 `OPEN_OK` 通过、`BOOTSTRAP_TOO_LARGE` 仍决定终局；闸门开：单帧 snapshot 通过 | 证明「chunk 必须走 data 路径」的可观察判据成立（R3），control 绕行为当前事实 |
| E4 | kind=1 首 chunk 注入：绑定块真值 vs 伪造 payload（`transferKind=3`） | 合法帧进入 ns 层并被状态门判 `NAMESPACE_STATE_VIOLATION`；伪造 payload 在未协商连接被 pre-parse 拒绝 | 注入面真实（帧被正确处理/分类），红来自 kind 语义缺失而非注入造假 |
| E5 | 同款发送代理改写：kind=0 chunk1 `totalBytes` | hub 回 `UPDATE_TRANSFER_VIOLATION`、零写入 | 代理机制有效；kind=2 上「前置 chunk 数 = 0」的红确由发送路径缺失造成 |
| E6 | 未协商 vs 已协商（`chunkedUpdate` 旋钮） | 未协商：任何 0x42 连接级拒绝；已协商：kind=0 正常分块 | 协商门与 kind 语义正交，R43 负控有效 |

---

## 10. Impact surface（实现面，仅信息，非设计）

- 发送端：hub snapshot 路径（`hub-namespace.startBootstrap`）、round Step2 路径（`round-engine.sendStep2` + 宿主 `send`/`encode` 回调）、`UpdateChannel`（kind 感知切片 + 三 kind 共用 `nextTransferId` + 单 in-flight 槽 + data 路径调度）、`hub-connection`/`peer-connection` 的 `sendUpdateChunk`。
- 接收端：`UpdateChunkAssembler`（kind 作用域、按 kind 聚合上限、四条几何校验、跨帧一致、收齐精确核对）→ 一次 sequenced apply / 排他复制导入；bootstrap 期无 Lease 记账（namespaceId + 连接级并发上限）；绑定块核对（kind=1 → 既有两码；kind=2 → `SYNC_STATE_VIOLATION`）。
- 错误/终局映射：四新码发射点（`SNAPSHOT_/SYNC_TRANSFER_{VIOLATION,TOO_LARGE}`）+ 发送端聚合超限收口（R45；含 §23.3 场景 14 改写）。
- 文档同步义务（R47）：协议 §22 L701 测试资产措辞、§23.3 场景 14 锚——属实现 ticket；本契约不触碰 `docs/`。
- 不改：codec 单形态/字段序、消息码/错误码注册表、capability 协商与 v1 回落、配置键，kind=0 既有行为（N4 + 全包回归锚）。

---

## 11. Ruled-out hypotheses

| 假设 | 排除证据 |
|---|---|
| 环境/依赖/入口问题 | 全包 69 文件 485 绿（含刻画文件 3/3）；同一 helper 上负控 4/4 绿；离线安装成功 |
| 配置链缺失（聚合上限/错误码未注册） | #299 契约 `ws-replication-issue299-ac-red.test.ts` 全绿；`DEFAULT_REPLICATION_LIMITS` 含两键、`§13.2` 四码已注册（源码/协议核对） |
| codec 缺陷（0x42 三 kind 不可编解码） | crafted kind=1/2 帧经 `encodeMessage`/`decodeMessage` 往返成功并被连接层接收（E4/E5）；#299 golden 全绿 |
| 协商门过严（导致 kind=2 结构不可达） | 本契约全部正例构型 `chunkedUpdate: true`（wire 已协商）；N3 证明未协商时拒绝是正确行为 |
| 序列/注入造假 | crafted 帧使用接收端期望 sequence（被丢帧序）并被正确分类；探针逐帧可见 |
| 「测试预算/超时」伪红 | 红灯断言为状态/码直接断言，非 `settleUntil` 预算耗尽；未推进虚拟时间 |
| observer 拼接导致红 | 契约零 observer 事件断言（R46）；既有 observer 锚全绿 |
| 这是 Bug（现实现应有行为） | 现实现行为与 #233 刻画一致（预期现状）；ADR 0022/协议冻结的是**目标契约**，属能力缺口而非缺陷回归 |

---

## 12. Acceptance contract and test paths

**文件**：`packages/ws-replication/test/ws-replication-issue300-chunked-sync-ac-red.test.ts`（新入口经真实包入口 `@nomicore/ws-replication` + `@nomicore/replication-protocol`，真实 yjs/Registry/Runtime，wire 断言无源码字符串/正则）。

### 12.1 红灯契约（实现前必须失败，实现后转绿）

| 用例 | 锚点 | 最小输入 | 可观察断言（目标实现） |
|---|---|---|---|
| **R1** | AC1/AC3；协议 §8.1/§8.2；ADR 0022 L47–48 | hub 100KB 文档，peer 全新；`maxBootstrapBytes=8KiB`、`maxUpdateBytes=8KiB`、`maxChunkedBootstrapBytes=512KiB` | peer→`live` 且副本值逐字等于快照；hub→peer ≥2 个 `transferKind=1` chunk（单 transferId、`chunkIndex` 0..n-1、Σbytes=totalBytes、几何一致、每 chunk ≤8KiB、每帧 ≤maxFrameBytes）；**零** `BOOTSTRAP_SNAPSHOT` 单帧；恰 1 个 `BOOTSTRAP_ACK` 且 `ackedSequence`=末 chunk 帧序；零 ERROR |
| **R2** | AC2/AC3/R42；协议 §9.2/§9.3 | 两 phase：20KB 可分块写（kind=0）→ 100KB 不可分块写（触发 resync → 恢复 diff ≈100KB），`maxSyncDiffBytes=32KiB` | hub 收敛到 100KB 且 peer `live`；≥2 个 `transferKind=2` chunk（同结构断言；`totalBytes>32KiB ∧ ≤512KiB`）；`kind=2 transferId > kind=0 transferId`；首 chunk `syncRoundId`=本 round；恰 1 个 `SYNC_APPLIED` 且 `ackedSequence`=末 chunk 帧序；phase B 无超限 `SYNC_STEP2` 单帧；零 ERROR |
| **R2b** | AC2 双向；协议 §9.2 | hub 100KB 写（不可分块）→ hub 声明 RESYNC → peer round | peer 收敛到 hub 值且 `live`；hub→peer ≥2 个 `transferKind=2` chunk + 结构断言；首 chunk 绑定 round 一致；恰 1 个 `SYNC_APPLIED` 锚末 chunk 帧序；零 ERROR |
| **R3** | AC3（control reserve 零 chunk / data 路径记账） | hub 100KB 文档 + hub transport 起始 `bufferedAmount=600KiB` | 闸门关：`OPEN_OK` 已出站、peer ∈{opening,bootstrapping}（**非 failed**）、零 0x42、零单帧 snapshot；释放 → ≥2 个 kind=1 chunk、收敛、连接 `ready` |
| **R4** | AC4/R44 前半（kind=1 声明/几何 + 边界） | crafted kind=1 首 chunk（peer 悬 `bootstrapping`；绑定块取 OPEN_OK 真值） | aggregate/count 超限 → `SNAPSHOT_TRANSFER_TOO_LARGE`；几何不一致 → `SNAPSHOT_TRANSFER_VIOLATION`；**边界（恰在上界）→ 零 ERROR、assembly 悬置、零写入**；违例均 peer `failed` + `peerDocPresent=false` |
| **R5** | AC4 前半（kind=1 绑定块） | crafted kind=1 首 chunk，`replicationId`/`replicationEpoch` 分别与 OPEN_OK 不符 | `REPLICATION_ID_MISMATCH` / `REPLICATION_EPOCH_MISMATCH`（既有码）；peer `failed`；零写入 |
| **R6** | AC4/R44（kind=2 跨帧 + 绑定块） | 真实 100KB kind=2 transfer + 发送代理改写（chunk1 `totalBytes+1` / chunk0 `syncRoundId+1`） | 前置：≥2 个 kind=2 chunk 上 wire；→ `SYNC_TRANSFER_VIOLATION` / `SYNC_STATE_VIOLATION`；hub 值不变、零 dirty、peer `failed`、连接 `ready` |
| **R7** | AC4/R45（kind=2 声明超聚合上限） | 100KB 恢复 diff，`maxChunkedSyncDiffBytes=32KiB` | wire 任向出现 `SYNC_TRANSFER_TOO_LARGE`、**不出现** `SYNC_DIFF_TOO_LARGE`；hub 零写入；peer `failed`；连接 `ready` |

**「一次 apply / 排他导入」的观察口径说明**：本切片无公共 apply 计数访问器（`chunked-snapshot-applied` 等 8 型 observer 发射点归 #301，R46），故契约以三个可观察合取逼近：①成功路径值逐字收敛（apply 的最终效应）；②恰一次单 ACK 且锚末 chunk 帧序（§8.2/§9.3）；③违例路径 `live Y.Doc` 零写入 + 零 dirty 登记（重组失败先于 apply）。实现后若 #301 前引入事件计数，可平移为直接断言而不改语义。

### 12.2 绿负控（当前即绿，实现后必须保持绿）

N1（界内 snapshot 单帧）/ N2（界内恢复 diff 单帧）/ N3（R43 协商门 pre-parse）/ N4（R47 kind=0 等价）。

### 12.3 触发与纪律

- 触发方式：`packages/ws-replication/test/**/*.test.ts` 被 `vitest.config.ts` include 命中；无 `skip/only/todo`、无 env override、无 fallback、不断言源码字符串。
- 契约 header 逐条登记 ADR/协议条款与 R42–R47 落点，供 SA1 设计/SA3 实现对照。

---

## 13. Red / green evidence

命令（worktree 根，`NODE_OPTIONS=--conditions=nomicore-source`）：

```bash
npx vitest run packages/ws-replication/test/ws-replication-issue300-chunked-sync-ac-red.test.ts --typecheck.enabled=false
npx vitest run packages/ws-replication/test --typecheck.enabled=false
npx tsc -p packages/ws-replication/tsconfig.json
pnpm typecheck
```

| 运行 | 结果 |
|---|---|
| 契约单跑 ×1 | **8 failed | 4 passed (12)** |
| 契约单跑 ×2（稳定性） | **8 failed | 4 passed (12)**，失败集合/断言逐字相同 |
| 契约单跑 ×3（稳定性） | **8 failed | 4 passed (12)** |
| 全包（69 文件） | **8 failed | 485 passed (493)**，8 条失败**全部**为本契约红灯；既有测试零回归（含刻画文件、#243–#246、#256、#299 锚） |
| `tsc -p packages/ws-replication/tsconfig.json` | exit 0（契约文件类型干净） |
| 根 `pnpm typecheck`（13 个 tsconfig） | exit 0 |

**8 条红灯的失败原因（全部为能力缺失，非环境/fixture/超时/入口）**：

1. R1 — `超限 snapshot 不得以单帧 BOOTSTRAP_TOO_LARGE 终局；peer 必须经 kind=1 分块传输完成初始同步（当前 failed）`
2. R2 — `超 maxSyncDiffBytes 的恢复 diff 不得以单帧 SYNC_DIFF_TOO_LARGE 终局；peer 必须经 kind=2 分块传输收敛（当前 failed）`
3. R2b — `hub→peer 超限 diff 不得以单帧 SYNC_DIFF_TOO_LARGE 终局；peer 必须经 kind=2 分块传输收敛（当前 failed）`
4. R3 — `data 闸门关闭时 bootstrap 不得被控制帧判定为终局失败（当前 failed：BOOTSTRAP_TOO_LARGE 经 control 路径直达）`
5. R4 — `totalBytes 超聚合上限（128KiB > maxChunkedBootstrapBytes 64KiB）：必须映射 SNAPSHOT_TRANSFER_TOO_LARGE（当前 kind=1 在 bootstrap 期落 NAMESPACE_STATE_VIOLATION）`
6. R5 — `replicationId 不符：必须映射既有码 REPLICATION_ID_MISMATCH`（当前 `NAMESPACE_STATE_VIOLATION`）
7. R6 — `后续 chunk totalBytes 漂移：前置——真实 kind=2 chunk 序列必须已上 wire（当前 0：kind=2 发送路径缺失）`
8. R7 — `SYNC_TRANSFER_TOO_LARGE（fatal/config/failed）必须在 wire 可观察：expected ['SYNC_DIFF_TOO_LARGE'] to include 'SYNC_TRANSFER_TOO_LARGE'`

转绿判据（供 SA1/SA3/SA7 核对）：上述 8 条全部转绿，且 N1–N4 与全包 485 条既有断言保持绿。

---

## 14. Runner trigger evidence

- `vitest.config.ts`：`test.include = ['packages/*/test/**/*.test.ts', ...]` → 契约路径命中；根 `pnpm test` = `NODE_OPTIONS=--conditions=nomicore-source vitest run --typecheck` 会执行该文件。
- 实测发现：单文件运行与全包运行（69 文件）均实际执行 12 个用例（`8 failed | 4 passed (12)`），非「文件未收集」。
- 契约文件不含 `describe.skip`/`it.only`/`it.todo`/`process.env`/正则源码断言（源码自检另见 `grep -c "it("` = 12）。
- 全包运行同时证明既有 runner 链路（含 typecheck 配置）未受影响。

---

## 15. Unknowns and blockers

| 项 | 状态 | 处置 |
|---|---|---|
| kind=2 发送端是否预检聚合上限（协议未逐字冻结） | 未知但**不阻塞** | R7 只断言冻结错误族码在 wire 可观察 + 终局 failed + 零写入，两种合规落地均通过（SA8 R45 已预告） |
| chunked 结算点 observer 行为（8 型发射） | 归 #301 | 契约不断言事件；实现可自由选择零事件/维持现状（R46），只需不使既有 observer 锚红 |
| 「恰一次 apply」无公共计数访问器 | 已知限制 | 以收敛值 + 单 ACK + 违例零写入合取观察（§12.1 说明）；如需直接计数由 #301 提供 |
| 场景 14（hub `send-failed`）改写义务 | 归实现 ticket | 本契约 R4（kind=1 接收端超限）+ R7（kind=2）覆盖冻结错误族的 wire 可观察性；文档同步（§22 L701/§23.3）属实现票 |
| origin/main 同号 ADR（N6，已消解：本基线篇 0019→0022） | 环境观察，非本票冲突 | 报告/契约引用 `0022-chunked-sync-transfer.md` 全路径消歧 |
| 阻塞项 | **无** | — |

---

## 16. Temporary diagnostics cleanup

- 临时探针文件 `packages/ws-replication/test/ws-replication-issue300-probe.test.ts`（P1–P11 诊断/矩阵探针）**已删除**；`git status --porcelain` 现仅含：新增契约文件 + 3 个 Host 简报快照（`wiki/raw/task_issue-300*.md`，非本 SA6 产出但为固定输入）。
- 未修改任何生产实现文件（`packages/**/src/**` 零改动）；未改刻画文件 `ws-replication-issue233-repro.test.ts`（`git status` 空）。
- 未启动常驻服务、无后台作业遗留（后台 vitest/typecheck 作业均已完成并回收）；未使用 nohup/setsid/PID 文件；无环境变量 override 遗留。
- 报告仅为固定产物 `wiki/raw/task_issue-300_sa6_contract.md`（本文件），未 commit/push。

---

## Verdict

**approve。** issue #300 的能力缺口经真实双端 harness 稳定复现（8/8 红灯，3 次连跑零抖动），根因定位到切片 2 未交付的传输层 kind 泛化/路由/接收端校验（§8）；验收契约把 AC1–AC5 与 SA8 R42–R47（含 validation 全四条与失败语义四码/既有码映射）转成可执行的最小输入 + 运行时行为断言，红灯全部因能力缺失而失败、负控（含 R43/R47 回归锚）当前即绿、既有 485 条包内断言零回归，测试入口真实（`packages/*/test/**/*.test.ts`）。未见阻塞项；转绿判据已显式给出（§13）。
