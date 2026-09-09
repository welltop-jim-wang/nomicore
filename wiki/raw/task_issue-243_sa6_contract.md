# SA6 验收契约与红灯证据 — Issue #243（issue #233 切片 2：协商 CAP_CHUNKED_UPDATE 超限 UPDATE live 分块传输）

- Dispatch：`sa-7cb53e4e-0b66-43eb-a9e9-351ebb9efbd5`（mabf-sa6 / acceptance-contract / iteration 0）
- 对象：issue #243「ws-replication：超限 UPDATE 分块端到端 live 传输（issue #233 切片 2）」当前任务简报
- 工作区：worktree `nomicore-fix-issue-243`，分支 `mabf/issue-243`，HEAD `c20aeb0`（PR #264 slice 1 merged；base `feat/issue-233-chunked-update-base`）
- 结论：**approve** —— 能力缺口证据可信、验收契约可执行、测试入口真实、负控全绿

## 1. Task type and inputs

- 任务类型：**Feature**（切片 2 能力交付前的验收契约与红灯证据；不存在既有实现 Bug 可归因——按切片分工 wire 面已由 slice 1 冻结，连接层行为仍为 v1）。本报告不虚构 Bug 根因，只证明「协商分块 live 传输」能力在 ws-replication 连接层整体缺失，并把目标行为固化为可执行断言。
- Host 简报：`wiki/raw/task_issue-243.md`（untracked，随 dispatch 注入；`## Comments` 为空）。
- SA8 裁决：`wiki/raw/20260908-sa8-conflict-gate-issue-243.md`（clear；2 项必答决策面 D1/D2，4 项观察项 W1–W4）。
- 权威决策：`docs/adr/0013-chunked-live-update-transfer.md`（发送/接收/协商/ACK/资源上限规则）、`docs/adr/0010-hub-peer-websocket-ydoc-replication.md`、`docs/protocols/instance-replication-v1.md`（wire 面；§10.3 跨帧规则显式标注「属后续切片」）。
- slice 1 交付物（本 HEAD）：`packages/replication-protocol/`（0x42 UPDATE_CHUNK codec、CAP_CHUNKED_UPDATE=0x00000001、decode 协商门控、UPDATE_TRANSFER_VIOLATION/UPDATE_TRANSFER_TOO_LARGE 注册、UPDATE_TRANSFER_EXPIRED reason）+ ws-replication 内两处类型兼容占位（peer-connection.ts:525 / hub-connection.ts:790）+ 冻结刻画测试 `ws-replication-issue233-repro.test.ts`（R1/R2/R3）。
- 前置切片闭环证据：`wiki/raw/task_issue-242_ac_red.log`、`task_issue-242_sa3_impl.md`、`task_issue-242_sa7_report.md`（#242 CLOSED ci-passed；PR #264 已 merge）。

## 2. Owner comment mapping

- dispatch 声明 + SA8 门禁 §1.1 三方一致：issue #243 **零评论**（REST `issues/243/comments` → `[]`）。无 owner 追加约束/豁免。需求面 = issue body（= 简报快照）8 条验收标准（AC1–AC8）。

## 3. SA8 constraints

- 无冲突放行（clear）。本契约必须显式承载的两个必答决策面：
  - **D1（临时期分配上界）**：ADR 0013:59 把 `totalBytes ≤ maxChunkedUpdateBytes`/`chunkCount ≤ maxChunksPerUpdate`/`totalBytes ≤ chunkCount × maxUpdateBytes` 并入首 chunk 校验。slice 2 即应执行上界校验（SA8 建议），违例→两码分类与中止矩阵留给 #244（slice 3）。本契约的红灯只测**不依赖新配置的接收端基本接纳**（合法完整 chunk 必须 apply）；上界校验红灯在配置面落地后补（见 §15）。
  - **D2（配置旋钮切分）**：slice 2 至少引入 `maxChunkedUpdateBytes`；旋钮形状（opt-in 开启协商的位置）归 SA1 裁定。本契约的协商上下文经**测试侧 wire 代理**建立（§12 假设 A1–A3），不依赖未来旋钮名，实现轮按设计接入即可转绿。
- W2 观察：协议文档 §10.2/§10.3 修订归属 #246；slice 2 不得引入 #246 无法追认的偏离——本契约 ACK 结算锚断言（ackedSequence=末 chunk 帧序）恰为 ADR 0013 已冻结内容，可追认。
- W3：observer 四事件（chunked-update-*）归属 #245（slice 4），不在本契约断言面。
- W4：诊断日志纪律——本契约零新诊断面。

## 4. Environment and baseline

- HEAD `c20aeb0`；branch `mabf/issue-243`；node v24.13.0；pnpm 10.28.2；vitest 3.2.7（fresh `pnpm install --frozen-lockfile` in worktree，exit 0）。
- 基线（全部绿，HEAD 实测）：
  - `packages/ws-replication/test/ws-replication-issue233-repro.test.ts` — 3 passed（R1/R2/R3 冻结刻画；未协商超限 = 丢弃 + needs-resync + 完整 SYNC round；R3 终局 failed）。
  - `packages/replication-protocol/test/codec-issue242-ac-red.test.ts` — 28 passed（slice 1 codec/协商门控全绿，切片 1 无回归）。
  - `packages/ws-replication/test/ws-replication-ac5-live.test.ts` — 7 passed（live UPDATE/ACK 语义面无回归）。
- 联合回归运行：`3 passed (3 files), 38 passed (38 tests)`（exit 0，日志见 §13）。

## 5. Positive reproduction（红灯 P1/P2/P3）

测试文件：`packages/ws-replication/test/ws-replication-issue243-ac-red.test.ts`（本地组装与 `issue137-driver.bootMulti` 同构：真实 yjs / Registry / Runtime，fake-duplex 微任务投递，fake scheduler，零 real sleep）。

**协商上下文**：ws-replication 当前无任何开启协商的配置（HELLO `optionalCapabilities: 0` 硬编码 peer-connection.ts:337；HELLO_ACK `selectedCapabilities: 0` 硬编码 hub-connection.ts:707）。测试以 transport 代理在 **wire 层**置位 HELLO.optionalCapabilities 与 HELLO_ACK.selectedCapabilities 的 `CAP_CHUNKED_UPDATE`（NC0 绿证自证：帧上确实携带 bit；代理只改写握手帧、其余逐字节透传——canonical roundtrip 稳定性为 slice 1 冻结性质）。此语境下目标行为应触发，当前实现仍全量 v1 回退：

- **P1（AC2/AC8 帧流形状，红灯）**：`maxUpdateBytes=8KiB`、写 20KB blurb 于协商连接 → 期望 ≥2 帧 UPDATE_CHUNK、每 chunk 载荷 ≤ maxUpdateBytes、每帧全长 ≤ maxFrameBytes、transferId 唯一、chunkCount/totalBytes 跨帧一致、chunkIndex 从 0 严格递增、Σbytes==totalBytes。实测：**0 帧 UPDATE_CHUNK**；wire 序 `…RESYNC_REQUIRED, SYNC_STEP1, SYNC_STEP2, SYNC_APPLIED…`（v1 丢弃 + 完整 state-vector round 恢复），hub 最终收敛但代价为整轮 resync。
- **P2（AC1/AC3/AC5 传输结果，红灯）**：同场景期望零 SYNC round、零 `resync-required`、hub 收敛且 dirty 恰一次、单 UPDATE_ACK（ackedSequence=末 chunk 帧序）。实测：**resync-required ×1**、双方向各出现第二轮 SYNC_STEP1/2/APPLIED（hub 收敛经由该轮 diff）；连接健康（peer ns 终态 reconciling/live、conn ready）——失败纯粹因分块机制缺失而非链路故障。
- **P3（AC3/AC8 接收端，红灯）**：协商连接 live 后注入**合法完整单 chunk transfer**（真实 CRDT 增量：hub 与 peer 同态 'seed' → 目标 'via-chunk'；transferId=1/chunkIndex=0/chunkCount=1/totalBytes=增量长度；envelope sequence=该方向下一期望值）。期望：hub 收齐→恰一次 sequenced apply + dirty→单 UPDATE_ACK、连接保持 ready、零 SYNC。实测：hub 在 decode 层即收口——**peer 侧观察到 `{"code":1002,"reason":"protocol-error"}`**（hub→peer 先发 connection ERROR 再 close），hub blurb 仍 'seed'（零写入零 dirty 零 ACK）。

## 6. Negative control

- **NC0（绿）**：协商代理生效自证——wire 上 HELLO.optionalCapabilities 与 HELLO_ACK.selectedCapabilities 均含 CAP_CHUNKED_UPDATE；连接 ready、ns live、基线零 chunk 帧。**fixture 正确性哨兵：P 系列红灯不可能是「测试从未协商」造成的假红。**
- **NC1（绿）**：协商连接上**限内** update（100B blurb）仍单 UPDATE 帧 + 单 UPDATE_ACK、零 chunk、零 resync——分块不得为限内 update 开启（ADR 发送端规则一），实现轮防「无差别分块」回归。
- **NC2（绿，AC6 守护）**：**未协商**连接上超限 write 保持 v1 逐字节行为——零 UPDATE_CHUNK、零 UPDATE、resync-required ×1（channelState=needs-resync）、hub 经 >maxUpdateBytes 的 SYNC_STEP2 diff 恢复收敛（与冻结 R1 同构）。实现轮若把协商默认翻成「恒开」，NC2 与冻结 R1/R2/R3 文件将同时红——双保险守护 AC6「不改刻画文件」。
- 独立负控组：既有 R1/R2/R3 冻结文件、slice 1 codec 28 测、ac5-live 7 测全绿（§13）。

## 7. Stability, scale and timing

- 全部场景确定性：微任务 + 门闩驱动，零 real sleep、零随机（受控 nonce 源与现有 driver 一致）。红灯文件两次独立运行失败集逐名一致（`3 failed | 3 passed (6)`，P1/P2/P3 红灯、NC0/NC1/NC2 绿灯；耗时 ~1.3s/次）。
- 规模：20KB 单笔（编码 ≈20,029B）、8KiB 分块上界 → 目标 chunkCount=3；远小于 maxChunkedUpdateBytes 缺省（4MiB），无内存/超时边界参与。ACK 计时（ackTimeoutMs=60s 虚拟）不在本迭代断言面（见 §12 AC5 注）。
- 复现率：v1 回退为确定性代码路径（`UpdateChannel.sendAndRegister` 超限分支直判），非竞态；两次运行 100% 复现。

## 8. Root-cause chain / capability gap

Feature 缺口（不是既有 Bug 的因果链；每步给源码符号 + 运行证据）：

| Step | Fact | Evidence | Confidence |
|---|---|---|---|
| 症状 | wire 已协商 CAP_CHUNKED_UPDATE 的协商连接上，超限 update 仍零 chunk 帧、走 resync | P1/P2 红灯日志（wire kinds 含 RESYNC_REQUIRED + 双 SYNC round） | 高（运行） |
| 直接缺口①发送端 | `UpdateChannel.sendAndRegister`/`pullAndSendOne`（update-channel.ts:210-236/285-318）无分块分支：bytes>maxUpdateBytes → 丢弃 + needsResync，无「出队时刻惰性切片」 | update-channel.ts 源码 + P1 运行证据 | 高 |
| 直接缺口②协商 | HELLO.optionalCapabilities 硬编码 0、HELLO_ACK.selectedCapabilities 硬编码 0；会话无 negotiated 状态；`decodeInbound`（frame-io.ts:60-68）不传 `selectedCapabilities` → UPDATE_CHUNK 无法 decode | peer-connection.ts:337 / hub-connection.ts:707 / frame-io.ts | 高（源码） |
| 直接缺口③接收端 | UPDATE_CHUNK dispatch 为防御性 connectionFatal 占位（peer-connection.ts:525 / hub-connection.ts:790）；无 detached assembly / 首 chunk 校验 / 总长核对 / 收齐 apply | P3 红灯：合法 chunk → close 1002、hub 零 apply | 高（运行） |
| decode 门控（slice 1 有意为之） | 未协商端 UPDATE_CHUNK 在 payload 解析前抛 UNSUPPORTED_MESSAGE_TYPE（payloads.ts:830-835）；连接层缺 selectedCapabilities 透传 | P3 close code 1002 + hub→peer ERROR 帧 | 高 |
| 最深缺口 | slice 2 全部接收/发送状态机尚未存在——现状即「协商位在 wire 上出现也没有任何代码消费它」 | NC0 绿（位已置）∧ P1-P3 红（无任何行为差） | 高（对照实验） |

## 9. Causal experiments

- **对照 1（协商变量）**：同一 20KB 写、同一装配，仅 wire 协商位有/无 → 有协商（P1/P2 红：零 chunk）+ 无协商（NC2 绿：v1 逐字节）——行为对协商位完全无响应，证明缺口在消费侧（发送/解码/接收），不在「协商建立」本身。
- **对照 2（负载大小变量）**：协商连接上 100B 写（NC1 绿：单 UPDATE + 单 ACK）vs 20KB 写（P1/P2 红）——链路健康、窗口/ACK 机制正常，唯独超限项无分块路径。
- **对照 3（fixture 变量）**：P3 注入帧 sequence = 该方向下一期望值，若为序列错乱应报 SEQUENCE_VIOLATION 且 ERROR 帧先行于 decode 门控之外；实测 close 1002 与 decode 门控分类（UNSUPPORTED_MESSAGE_TYPE 的 wsCloseCode=1002，issue #242 冻结）一致——失败点确为 capability 门控，非注入序列错误。
- **对照 4（收口侧）**：P3 hub→peer 帧末为 ERROR（connection scope）而后 close(1002)，peer 投影 disconnected/blocked；hub 文档零变化（'seed' 未动）——接收端缺口路径与 ADR「重组失败先于 apply / 零 Y.Doc 写入」的目标边界在同一挂点，目标语义清晰。

## 10. Impact surface

- 发送侧：`update-channel.ts`（超限分支 → 惰性切片 + transfer 记账）、控制器 facet（sequence/出队）、`ConnectionSender`/RR 轮转（chunk 帧逐帧经既有 data 路径；整笔 1 in-flight 槽——ADR 已冻结，代码未实现）。
- 接收侧：连接层 decode 透传 negotiated selectedCapabilities（frame-io.ts:60-68 + peer/hub-connection 入站路径）；UPDATE_CHUNK dispatch 占位替换为 assembly（detached buffer、首 chunk 校验、收齐 apply + dirty + 单 ACK）。
- 协商面：peer-connection.ts:337 / hub-connection.ts:707 的硬编码 0 → 配置化 optional 位（D2 裁定形状）。
- 未触碰面（本契约红线内）：replication-protocol codec（slice 1 已冻结，零修改）；R1/R2/R3 刻画文件（不改）；backpressure/公平调度既有机制（AC4 回归面=既有 suite 全绿）。
- 与相邻切片分界：#244（slice 3）违例分类/中止矩阵/四配置完整链；#245（slice 4）observer 事件；#246（slice 5）协议文档修订与 ADR 0013 转正。

## 11. Ruled-out hypotheses

- 「红灯是测试入口/装配错误」：NC0 绿证明协商上下文真实建立；NC1/NC2 与冻结 R1-R3、codec slice1 全套绿证明装配、driver、观察面正确。
- 「codec 层不支持 chunk」：slice 1 文件 28 测绿；P3 中 `encodeMessage(UpdateChunkMsg)` 成功出帧并被对端 decode 门控按预期拒绝（非 MALFORMED/未分类）——codec 就绪，缺口在连接层。
- 「是 transport 丢帧/改写破坏」：代理对非握手帧逐字节透传；P1/P2 wire 捕获显示正常帧序完整送达。
- 「与序列纪律混淆」：P3 注入序列为期望值；收口分类=capability 门控（1002），非 SEQUENCE_VIOLATION。
- 「环境/定时 flake」：两次运行失败集逐名一致；零 real sleep、零随机。
- 「需在协议层发明 ACK 语义」：ADR 0013 已冻结「单 UPDATE_ACK（ackedSequence=末 chunk 帧序）」；P2/P3 断言即其可执行形态，非新设计。

## 12. Acceptance contract and test paths

测试文件（真实包测试入口，vitest include `packages/*/test/**/*.test.ts` 自动发现）：
`packages/ws-replication/test/ws-replication-issue243-ac-red.test.ts`

| AC | 可执行断言 | 用例 | 当前 HEAD | 实现后 |
|---|---|---|---|---|
| AC1 超限 live 传输 + 单 ACK、零 SYNC | 零 resync-required；两方向零 SYNC_STEP1/2/APPLIED；hub 收敛；单 UPDATE_ACK | P2 | 红 | 绿 |
| AC2 每帧 ≤ maxUpdateBytes/maxFrameBytes | chunk 载荷与帧全长上限逐帧断言 | P1 | 红（0 帧） | 绿 |
| AC3 恰一次 apply+dirty；失败先于 apply | hub saveDoc 计数 +1（恰一次）；P3 合法 chunk → apply + dirty + 连接不失败；零写入由「hub 值不变 + 无 dirty」反向证明（红期） | P2/P3 | 红 | 绿 |
| AC4 RR 穿插 + 既有 backpressure 不回归 | 既有公平/背压 suite 保持绿（本迭代回归面）；chunk 跨 ns RR 断言留实现轮（见 §15） | （回归运行） | — | 绿 |
| AC5 ACK 锚=末 chunk 出站 | UPDATE_ACK.ackedSequence == 末 UPDATE_CHUNK 帧 envelope sequence | P2/P3 | 红 | 绿 |
| AC6 未协商 v1 逐字节一致 | NC2（零 chunk、resync ×1、SYNC_STEP2 恢复）+ 冻结 R1/R2/R3 文件不改仍绿 | NC2 + 冻结文件 | 绿 | 绿 |
| AC7 fake-duplex 与真实 WS 双 seam | fake-duplex seam 红灯已建；真实 WS + MemoryPersistence 1 Hub+2 Peers 镜像留实现轮（sa7 期既有 `ws-replication-sa7-*-real-transport*.test.ts`/`phase5-three-instance-acceptance-red.test.ts` seam） | P1–P3（fake） | 红/绿 | 双绿 |
| AC8 首 chunk 基础校验 | 正向：合法 chunk 必须被接纳（P1 帧流自洽 + P3 接收端接纳）；违例分类归 slice 3，违例红灯留配置面落地后（§15） | P1/P3 | 红 | 绿 |

**转绿假设（实现轮验证点，均为 ADR 0013 冻结语义）**：
- A1：发送/解码门控以 **wire 协商位**（HELLO optional ∩ HELLO_ACK selected）为判据，hub 对已置位 optional 的 peer 选择该位（不另加实例级 feature-flag 门）——与切片默认-off（AC6）自洽：未协商（0/0）即 v1。
- A2：接收端按缺省/配置上限接纳 ≤4MiB（maxChunkedUpdateBytes 缺省，ADR 表）的声明；本测试载荷远低于所有上界。
- A3：ACK 结算锚 = 末 chunk 帧序；收齐后恰一次 `applyRemoteUpdate` + dirty（既有 sequencer 纪律）。
- 若 SA1 落地的旋钮/门控形状与 A1–A3 相左：在 SA1/SA2 轮刷新本文件的协商注入点（单点改动，断言面不动）——红灯文件在实现轮前保持为设计输入。

## 13. Red/green or baseline evidence

精确可复现命令（worktree 根；exit code 见文末）：

```
$ NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/ws-replication/test/ws-replication-issue243-ac-red.test.ts --reporter=verbose
```

verbatim 输出（节选；完整日志见 /tmp/issue243-red-verbose.log，二次复跑 /tmp/issue243-red-r2.log）：

```
 ✓ …绿负控 NC0：wire 协商代理生效——HELLO.optional / HELLO_ACK.selected 携带 CAP_CHUNKED_UPDATE…
 × …红灯 P1（AC2/AC8）…
   → 超限 update 必须以分块帧出站（当前 0 帧）：
P1
peer ns state=live conn=ready
peer→hub kinds: HELLO,OPEN_NAMESPACE,BOOTSTRAP_ACK,SYNC_STEP1,SYNC_STEP2,SYNC_APPLIED,RESYNC_REQUIRED,SYNC_STEP1,SYNC_STEP2,SYNC_APPLIED
hub→peer kinds: HELLO_ACK,OPEN_OK,BOOTSTRAP_SNAPSHOT,SYNC_STEP1,SYNC_STEP2,SYNC_APPLIED,SYNC_STEP1,SYNC_STEP2,SYNC_APPLIED
hub blurb=zzzzzzzzzzzzzzzzzzzzzzzz…: expected 0 to be greater than or equal to 2
 × …红灯 P2（AC1/AC5/AC3）…
   → 超限 update 必须以 live 分块传输，零 SYNC/resync（当前 resync=1）：
P2
peer ns state=reconciling conn=ready
peer→hub kinds: HELLO,OPEN_NAMESPACE,BOOTSTRAP_ACK,SYNC_STEP1,SYNC_STEP2,SYNC_APPLIED,RESYNC_REQUIRED,SYNC_STEP1,SYNC_STEP2
hub→peer kinds: HELLO_ACK,OPEN_OK,BOOTSTRAP_SNAPSHOT,SYNC_STEP1,SYNC_STEP2,SYNC_APPLIED,SYNC_STEP1,SYNC_STEP2
hub blurb=zzzzzzzzzzzzzzzzzzzzzzzz…: expected 1 to be +0
 × …红灯 P3（AC3/AC8 接收端）…
   → 合法 chunk 不得导致连接收口（当前 hubSideClosed=true；peer 侧观察到 {"code":1002,"reason":"protocol-error"}——decode 门控 connection fatal）：
P3
peer ns state=disconnected conn=blocked
peer→hub kinds: HELLO,OPEN_NAMESPACE,BOOTSTRAP_ACK,SYNC_STEP1,SYNC_STEP2,SYNC_APPLIED,UPDATE_CHUNK
hub→peer kinds: HELLO_ACK,OPEN_OK,BOOTSTRAP_SNAPSHOT,SYNC_STEP1,SYNC_STEP2,SYNC_APPLIED,ERROR
hub blurb=seed…: expected true to be false
 ✓ …绿负控 NC1：协商连接上限内 update 仍以单 UPDATE 帧 + 单 UPDATE_ACK…
 ✓ …绿负控 NC2（AC6）：未协商连接上超限 update 保持 v1 逐字节行为…
 Test Files  1 failed (1)
      Tests  3 failed | 3 passed (6)
 Type Errors  no errors
==== 退出码：1（vitest：存在失败用例——红灯契约如设计红在缺口断言处）====

==== 红灯确定性复跑（默认 reporter）====
 Tests  3 failed | 3 passed (6)   ==== 退出码：1；失败集与首跑逐名一致（P1/P2/P3），NC0/NC1/NC2 双跑全绿 ====

==== 相关绿灯套件（无回归；exit 0）====
$ NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/replication-protocol/test/codec-issue242-ac-red.test.ts packages/ws-replication/test/ws-replication-issue233-repro.test.ts packages/ws-replication/test/ws-replication-ac5-live.test.ts
 ✓ codec-issue242-ac-red.test.ts (28 tests)  ✓ issue233-repro.test.ts (3 tests)  ✓ ac5-live.test.ts (7 tests)
 Test Files  3 passed (3)   Tests  38 passed (38)
```

红灯归因（对照 §6/§9）：P1/P2 失败于「零 chunk 帧 + v1 resync 恢复」——缺口断言；P3 失败于「合法 chunk 触达 decode 门控 1002 收口」——与 slice 1 冻结门控分类一致，且 NC0 证明 wire 已协商，失败点无可争议地在连接层消费侧。

## 14. Runner trigger evidence

- 测试入口真实：文件位于 `packages/ws-replication/test/`，被根 `vitest.config.ts` include（`packages/*/test/**/*.test.ts`）发现；两命令逐字运行成功（vitest 收集 6 用例，`Type Errors no errors`）。
- 无 skip/only/todo；无 env override；无源码 grep/字符串断言（全部 wire 帧 / 状态投影 / 持久化 saveDoc 计数 / observer 事件断言）。
- 未实施树即本 HEAD（c20aeb0）：红灯运行于**无任何 slice 2 代码**的树上，证据即缺口基线。

## 15. Unknowns and blockers

- **D2 旋钮形状（设计必答）**：本契约经 wire 代理建立协商，绕过旋钮；SA1 冻结旋钮后，实现轮把「开启协商」接到装配即可（断言面零改动）。若 SA1 决定 hub 侧支持集也做配置门（超出 ADR「取交集」字面），需在 NC0/P 系列刷新注入方式——如实记录，不构成当前阻塞。
- **D1 上界校验红灯**：`totalBytes ≤ maxChunkedUpdateBytes` 等首 chunk 上界校验需要 slice 2 配置面落地后才能构造超界注入；违例→两码分类归 #244。实现轮补 P4（超界声明拒绝：apply 前、Y.Doc 零写入、namespace 级收口而非连接级）。
- **AC4 chunk × RR 穿插断言**：等 round-engine 的 chunk 出队语义冻结后，以「双 ns 持续写 + 单 ns 大写」构造轮转穿插/不饿死断言（断言面见文件头注释）；既有 backpressure/公平 suite 本迭代已确认全绿。
- **AC7 真实 WS + MemoryPersistence 1 Hub + 2 Peers seam**：真实 WS 进程级 seam（`apps/yjs-server/test/phase5-three-instance-acceptance-red.test.ts`）与 ws-replication sa7 real-transport seam 在 SA7/实现轮补齐镜像红灯；fake-duplex 面已红证。
- 非阻塞项：无环境缺失、无无法复现现象、无未证实关键假设（A1–A3 已在文件头文档化并映射 SA8 W2 可追认性）。

## 16. Temporary diagnostics cleanup

- 零临时诊断改动：未改任何生产实现文件（`git status` 仅新增测试文件与简报/门禁注入文件）；未启动服务/长驻进程；无 PID 文件、无 marker 轮询。
- 环境安装（`pnpm install`）为 worktree 标准依赖安装，产物在 node_modules（gitignore）。
- 运行日志存放 /tmp（非 worktree），证据核心内容已内嵌 §13。

## 附：artifactPaths（worktree-relative）

1. `packages/ws-replication/test/ws-replication-issue243-ac-red.test.ts` —— 可执行验收契约（P1/P2/P3 红灯 + NC0/NC1/NC2 绿负控；真实包测试入口）。
2. `wiki/raw/task_issue-243_sa6_contract.md` —— 本报告。
