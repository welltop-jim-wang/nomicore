# SA6 验收契约与红灯证据 — Issue #245（issue #233 切片 4：分块传输 observer 事件）

- Dispatch：`sa-3b74dd17-558d-4d60-a916-1d6f62460e4b`（mabf-sa6 / acceptance-contract / iteration 0）
- 对象：issue #245「ws-replication：分块传输 observer 事件（issue #233 切片 4）」
- 工作区：worktree `nomicore-fix-issue-245`，分支 `mabf/issue-245`，HEAD `733b3a7`（= upstream
  `origin/feat/issue-233-chunked-update-base`；切片 1–3 #242/#243/#244 已在其历史合入）
- 结论：**approve** —— Feature 能力缺口证据可信（三成功型零实现 + 分块路径仍发普通族事件）、
  红灯恰在缺口断言、负控全绿、测试入口真实、断言敏感度经同机制检测已交付 aborted 事件证成。

## 1. Task type and inputs

- 任务类型：**Feature 验收契约**（observer seam 四事件类型中三成功型的能力缺口守卫——不虚构
  Bug 根因；红 = 现行实现尚未具备的目标行为，允许先于修复存在）。
- 输入清单（按 dispatch 指令实读）：
  - Host 简报 `wiki/raw/task_issue-245.md`（AC1–AC6；`## Comments` 空节）。
  - SA8 前置门禁 `artifacts/sa8-conflict-gate-issue-245.md`（**clear**；R20–R25 就绪注意项）。
  - Issue comment REST 快照 = `[]`（dispatch 声明；无 owner 补充要求需并入——见 §2）。
  - 权威规范：ADR 0013（Observer seam L83–94：四事件键集冻结表 + §23.4 引用；消息/ACK/中止
    语义 L29–63）、ADR 0010、`docs/protocols/instance-replication-v1.md` §23.1（L725 三成功型
    「#245 计划项」登记口径）/§23.3（safe-field）/§23.4（隔离与时钟）/§23.7（conformance）。
  - 既有交付面：切片 3（#244）已交付第 23 型 `chunked-update-aborted`（types.ts:664–684、
    hub-namespace.ts:786–804 / peer-namespace.ts:769–789 发射点 + busy 守卫计数不变量、
    protocol L725 接线行 + SA7 动态断言文件在库）。

## 2. Owner comment mapping

- Issue comment REST 复核 = `[]`——零 owner 追加要求/豁免；任务要求源 = issue body 六条
  Acceptance criteria + ADR 0013/§23 冻结面（SA8 C1–C9 逐条同源裁定）。本契约的用例授权 =
  简报 AC1–AC6 + SA8 R20–R23 路由 + 本 dispatch 的 acceptance-contract 阶段。

## 3. SA8 constraints（本契约落实面）

| SA8 注意项 | 本契约落实 |
|---|---|
| R20 ·「四个新增」实为 3 新增 + 1 已交付（aborted 由 #244 注册并实现）；范围 = 校验/保持冻结面 | N4 = aborted 键集逐字冻结（ABORTED_KEYS 八键含 side 信封、无 connectionId——ADR L92 域键集）+ reason ∈ 六值闭集 + 每笔中止恰一（busy 守卫）+ 零成功型事件 + 零部分写入/零 durable 回归锚；红面只有 sent/applied/acked 三型（R1–R5） |
| R21 · 既有族事件改道（唯一可观测行为变化）——#245 将 chunked transfer 的三处普通族事件改道至 chunked 族；普通 UPDATE 帧族键集/时机逐字节不变 | N1 = 限内 UPDATE 单帧构型：update-sent/applied/acked 键集逐字冻结断言 + 三事件面 sequence 闭环 + 零 chunked 族/零 UPDATE_CHUNK 帧（append-only 边界：只增不改）；R1–R5 断言分块 transfer 窗口内普通族三事件归零（改道） |
| R22 · 键集边界：side = 结构信封（全员惯例）；ADR 表缺省冻结域键集；sequence/stages 等扩展须显式设计裁决 + §23.1 登记 | 契约键集 = ADR L89–91 域键 + type/side 信封（connectionId 握手后在场）；无 clock 运行 exact-keyset 断言同时锁「零 sequence/零四段差值/零多余键」；若 SA1 裁决 append-only 加键 = 契约修订 dispatch（§15 记录） |
| R23 · degraded × chunked 交叠欠定（自然落位 = chunked-update-applied 仅「UPDATE_CHUNK 且非 degraded」，degraded 期 degraded-bypass 胜出） | N5 = degraded 窗口 hub→peer 分块 apply：每笔成功 apply **恰一**互斥事件增量（现 = degraded-bypass-applied 单发）+ 零 update-applied/零 chunked-update-applied + 键集冻结（事件型身份断言 = 现行缺省裁决回归；SA1 若改判须显式设计裁决并同步本契约） |
| R24 · 规范文档同步义务（落地轮） | §15 记录义务清单（协议 §23.1 词汇 23→26、L727–729 三选一→四选一、§23.7 增补、observer-red 全事件矩阵加行）；本报告不落文档（实现轮 SA3 承接） |
| R25 · ADR 0013「提议」+ 父 PR #241 OPEN | 方向性返工则复审本契约——非阻塞（同 #244 门禁裁定） |

## 4. Environment and baseline

- HEAD `733b3a7`（PR #280 = #244 合入 + #254 等）；branch `mabf/issue-245`；node v24.13.0；
  pnpm 10.28.2；vitest 3.2.7；typescript 5.9.3。依赖 `pnpm install --prefer-offline`（65 包，
  零网络下载）。
- **实测基线（本契约文件加入前）**：无生产实现改动；既有全包 64 文件 472 用例中 462 项为存量
  （#244 verify 基线后随 #280 合入扩展），全绿。
- 本契约改动面：新增 1 契约文件 + 本报告 + 验证日志；**生产实现零触碰**；临时诊断文件已删除
  （§16）。

## 5. Positive reproduction（能力缺口，红灯 R1–R5）

现行实现中一笔**完成的**协商分块 transfer（3 chunk、~20,029B）的可观测事件面（源码 + 运行
证据，K1 等既有绿灯同构）：
- 发送侧：仅末 chunk 出站发 `update-sent{sequence:末 chunk 帧序, bytes:totalBytes}` 恰一
  （`update-channel.ts:399–445`；L402 注释明文「#245 归 chunked 事件」——中间 chunk 零发射）；
- 接收侧：组装 apply 成功经统一管线发 `update-applied` 恰一（hub-namespace.ts:1192 /
  peer-namespace.ts:1425，isStep2=false 无分块判别）；
- 发送侧 ACK 结算发 `update-acked{bytes:totalBytes}` 恰一（hub-namespace.ts:1061 /
  peer-namespace.ts:1275，bytes 来自 inFlight 记账总长）；
- **chunked-update-sent / applied / acked 三型零事件**（types.ts 判别联合 23 型无成员；协议
  L725「成功路径三型为 #245 计划项，不登记为已实现行为」）。

红灯断言（每个均为运行时事件对象观察，失败消息自述缺口）：
- **R1（AC-sent 语义/AC1 键集/AC4 时机）**：闸门相位证明 chunk0/chunk1 出站后零 chunked 事件
  （非逐 chunk、非起始发射——该段绿），放行末 chunk 收敛后 `chunked-update-sent` 必须恰一且
  键集逐字冻结（transferId/chunkCount/totalBytes = wire 申报）——现 0 → **红**；
- **R2（AC4 互斥第四形态/AC1 键集）**：transfer 窗口恰一 apply-form 增量（绿半边已证）+ 分块
  apply 必须发 `chunked-update-applied`（bytes=totalBytes、chunkCount=wire 申报）且普通族
  `update-applied` 增量归零——现 0/仍 1 → **红**；
- **R3（ACK 改道/时序）**：`chunked-update-acked` 恰一（bytes=totalBytes）、普通族
  `update-acked` 归零、发送侧 sent 先于 acked——现 0/仍 1 → **红**；
- **R4（hub→peer 方向镜像 + side 双侧）**：hub 侧 sent/acked + peer 侧 applied 三型各恰一、
  双侧普通族归零——现全 0 → **红**（镜像覆盖双侧共享/孪生发射点，防单侧落地漏网）；
- **R5（AC3 后半：时钟折叠策略正向）**：clock 注入时分块 applied/acked 的 latency 字段在场且
  ≥ 0（`CountingClock` 确定性单调时源）——事件缺失 → **红**。

## 6. Negative control（绿 N1–N5；实现轮不得误伤）

- **N1（R21 边界）**：协商连接上限内 UPDATE 单帧构型——三事件面键集逐字冻结 + sequence 闭环 +
  bytes===帧载荷长 + 零 UPDATE_CHUNK 帧 + 零四 chunked 型事件 + 全事件 safe-field 深扫/哨兵
  扫描（token/schema 文本/内容前缀零出现）。绿——普通族面「只增不改」的行为锁。
- **N2（AC3 前半）**：无 observer 分块 transfer——hub/peer 注入计数时钟全程 0 调用（含
  stop 收口路径——§23.4 零时钟调用纪律全生命周期）；文档收敛 + dirty 恰一 + 单 ACK + 零
  ERROR/零 RESYNC + ns live。绿。
- **N3（AC2）**：两棵独立 fixture——无 observer 基线 vs 每事件必 throw 破坏 observer；wire
  语义摘要（kind#seq，§23.7 惯例——Yjs payload 含随机 doc client id，跨运行逐字节不可比）
  逐位相等 + 终态/文档内容/apply 结算（dirty 计数）全等 + 零 ERROR + 事件流不熔断。绿。
- **N4（AC5/AC1 aborted 回归 = R20 保持面）**：resync-declared 行（busy 中注入对端
  RESYNC_REQUIRED 的确定性 wire 构型，同 #244 D-RD1）——aborted 恰一 + 键集逐字冻结 +
  reason ∈ 六值闭集 + receivedChunks/receivedBytes = 实收进度 + 零成功型事件 + 零部分写入/
  零 durable + 零 ERROR + 零 failed + 残渣良性丢弃（F3 零 VIOLATION）。绿。
- **N5（AC4 + R23 缺省裁决）**：peer degraded 窗口 hub→peer 分块 apply——apply-form 增量恰一
  （现 = degraded-bypass-applied 单发，键集冻结）+ 互斥负向半边零 update-applied/
  chunked-update-applied + 收敛 + ns live。绿。

## 7. Stability, scale and timing

- 全部用例为真实 yjs / Registry / Runtime + fake-duplex + fake scheduler（虚拟时间；零 real
  sleep）；绿灯用例与红灯用例共用同一 fixture/闸门/收集器形态——红非环境差异所致。
- 红灯文件最终代码 12 次独立运行失败集逐名一致（每次恰 `5 failed | 5 passed`，Type Errors
  no errors）；单文件运行 <2s。此前一次 N3 跨运行 flake（Yjs 编码总长 20027/20029 入摘要——
  随机 doc client id 所致）已定位并归一（§9 对照 5：kind#seq 语义摘要 + 终态内容相等）。
- 闸门相位（R1：chunk0 → drip chunk1 → release 末 chunk）与 #244 SA7 D-SLIDE 同款确定性节奏
  （advance 虚拟时间驱动轮询）；N4 注入构型与 D-RD1 同款；无 real sleep、无超时敏感断言。
- 全包回归：64 files / 472 tests——唯一失败文件 = 本契约文件（5 红）；其余 467 项全绿；
  时长 53.47s（含 typecheck 15.8s）。

## 8. Capability-gap chain（Feature 型；不虚构 Bug 根因）

| Step | Fact | Evidence | Confidence |
|---|---|---|---|
| 症状 | 分块 transfer 的成功三面对观测面不可按 transfer 区分：只有普通族三事件（sent{末序,总长}/applied/acked{bytes=总长}），无 transferId/chunkCount 词表、无 transfer 级观测语义 | 运行：K1 既有绿灯断言即此形态；R1–R5 红灯「事件缺失 + 普通族仍在」 | 高（运行+源码） |
| 直接缺口 | 三成功型事件类型零注册（判别联合 23 型，仅第 23 型 aborted）+ 发射点零实现——末 chunk 出站记账 `noteUpdateSent` 无 transfer 上下文（update-channel.ts:440 传 sequence/bytes/sendQueueMs），组装 apply 成功发射点无「分块来源」判别（hub-namespace.ts:1192 / peer-namespace.ts:1425 仅 isStep2 判别），ACK 结算同理发普通族 | 源码直读 + grep 全库 chunked-update-sent/applied/acked 零命中（aborted 族除外）+ 协议 L725 计划项登记 | 高（源码+运行） |
| 目标语义（ADR 冻结） | 成功三型 = ADR 0013 L89–91 键集 + §23 envelope；sent 在「transfer 完成出站时恰一、非逐 chunk」；applied 纳入 apply 成功路径互斥第四形态（每笔成功 apply 恰一）；acked 单 ACK 语义（末 chunk 帧序）不变；safe-field/throw 隔离/决策落定后发射/无 observer 逐字节等价全部沿用 | ADR L83–94 + §23.1/§23.3/§23.4/§23.7 + SA8 C1–C9 | 高（三方一致） |
| 已交付面（不构成缺口） | chunked-update-aborted 第 23 型键集/六 reason/计数不变量已实现并有动态断言 | N4 回归绿 + #244 套件（R3/R5a/R5b + SA7 D-* 行） | 高（运行） |
| 观测纪律基线（不构成缺口） | 无 observer = 零事件/零时钟调用；throw 隔离；clock 缺省 latency 字段缺失 | N2（零时钟含收口）、N3（throw 等价）、N1（latency 键缺席 exact-keyset）全绿 | 高（运行） |

## 9. Causal experiments

- **对照 1（断言敏感度——同机制正检）**：N4 用与红断言完全相同的收集/键集/字段断言机制检测
  **已交付**的 `chunked-update-aborted`（恰一 + ABORTED_KEYS 逐字 + 数值）——证明事件流观察、
  键集冻结断言与「count===1」形态对真实 chunked 族事件有效，红灯的 0 计数不是机制空转。
- **对照 2（窗口基线变量）**：R2/N5 先取 boot 期 apply-form 基线（live 边存在一次空 diff 恢复
  round → sync-diff-applied），断言改取窗口增量——红/绿语义不依赖 boot 噪声；对照失败曾暴露
  整窗计数伪误报（双事件），修正后红恰落在第四形态缺口断言。
- **对照 3（方向变量）**：peer→hub 为主红（R1–R3），hub→peer 镜像（R4）锁定 side 双侧与孪生
  发射点——单侧落地即红。
- **对照 4（时钟变量）**：无 clock exact-keyset（R1–R4 运行面 + N1）锁「latency 字段缺失（非
  undefined 值）」；注入 clock（R5）锁「在场且 ≥ 0」——时钟折叠策略两态各自可观测。
- **对照 5（跨运行等价变量）**：N3 初版把 Yjs 编码总长（20027 vs 20029——随机 doc client id
  的 varUint 宽度）纳入 wire 摘要导致跨运行 flake；归一为 kind#seq 语义摘要 + 终态内容相等后
  12/12 稳定——等价断言口径与 §23.7 惯例对齐（观测零 wire 扰动以帧语义/序判定）。

## 10. Impact surface

- 实现轮（SA3 承接，本报告**不设计最终修复**；行为锚已由契约冻结）：
  - 发送侧：末 chunk 出站结算处需携带 transfer 上下文（transferId/chunkCount/totalBytes 在
    `UpdateChannel.activeTransfer` 全程在场）并以 `chunked-update-sent` 取代普通 `update-sent`
    发射（R1/R4）；中间 chunk 继续保持零事件（R1 相位绿断言）。
  - 接收侧：组装 apply 成功点需「分块来源」判别（assembler complete 路径已知
    transferId/chunkCount/totalBytes），非 degraded 发 `chunked-update-applied`（R2/R4）、
    degraded 期维持 degraded-bypass 胜出（N5）；ACK 结算发 `chunked-update-acked`（R3/R4）。
  - 时钟纪律：chunked applied/acked 的 latency 字段沿用 clock 折叠（R5 + N1/N2 纪律面）。
- **预期红翻转存量（实现轮随改道同步更新，非本契约红）**：`ws-replication-issue243-chunked-
  live.test.ts` K1（三普通族事件在分块路径的断言——改道后需指向 chunked 族；#243 实现轮测试，
  非冻结契约）及同文件/套件内引用该三事件形态的实现轮断言；`ws-replication-observer-red.test.ts`
  全事件矩阵 key-set 表需 append 三新行（§23.7 义务，R24）。冻结契约文件（各 *-ac-red /
  *-sa7-dynamic / observer-red）断言不变（N4/N5 已证互斥面与 aborted 面语义连续）。
- 未触碰面：生产实现、replication-protocol codec、DENY 面、ADR 文本、其他契约文件。

## 11. Ruled-out hypotheses

- 「红 = fixture/构造错误」：同一 fixture 形态下 N1–N5 全绿（含分块传输、中止、degraded 全谱）；
  红断言均为事件数组长度/字段观察——不依赖任何红侧专有 fixture 分支。
- 「红 = 观察机制失效」：N4 以同一机制检测到已交付 aborted 事件（恰一 + 冻结键集）——机制健康。
- 「事件其实存在但命名/词表不同」：types.ts 联合 23 型 + 全库 grep + 协议登记口径三方一致；
  红断言消息按目标词表自述（R1–R5 分别锁定 sent/applied/acked）。
- 「红 = 时序/竞态 flake」：最终代码 12/12 次失败集逐名一致（一次 N3 跨运行 flake 属摘要
  口径、经对照 5 定位归一，非红断言时序问题）；虚拟时间驱动零 real sleep；闸门相位内嵌
  零事件绿断言先行通过再遇红（R1 相位 1/2 绿、相位 3 红）。
- 「方向不对称漏测」：R4 镜像显式覆盖 hub→peer（hub 出站 + peer 入站 apply）。
- 「时钟纪律缺失/时钟注入干扰」：N2 零时钟调用（含收口）绿；R5 确定性单调时源 diff=0 ≥ 0 绿面
  内断言；N1 exact-keyset 已锁普通族无 clock 缺面形态。

## 12. Acceptance contract and test paths

测试文件（真实包测试入口；根 `vitest.config.ts` include `packages/*/test/**/*.test.ts` 自动发现；
package tsc 干净）：`packages/ws-replication/test/ws-replication-issue245-ac-red.test.ts` —— 10 用例。

| 语义面（简报 AC） | 可执行断言 | 用例 | 现行实现 | 目标实现 |
|---|---|---|---|---|
| AC1+AC2-sent：完成出站恰一、非逐 chunk、键集冻结 | 闸门相位零事件（绿）→ 收敛后 `chunked-update-sent` 恰一 + SENT_KEYS 逐字 + 字段=wire 申报 + 普通族 update-sent 归零 | **R1** | **红**（0 事件；仍发 update-sent） | 绿 |
| AC4+AC1-applied：互斥第四形态 + 键集 | 窗口恰一 apply-form（绿半边）→ `chunked-update-applied` 恰一 + APPLIED_KEYS + bytes/chunkCount=wire + update-applied 增量归零 | **R2** | **红**（0；仍发 update-applied） | 绿 |
| AC1-acked + 时序 | `chunked-update-acked` 恰一 + ACKED_KEYS + bytes=total + update-acked 归零 + sent 先于 acked | **R3** | **红** | 绿 |
| 方向镜像 + side 双侧 | hub→peer：hub sent/acked + peer applied 各恰一、side 断言、双侧普通族归零 | **R4** | **红**（全 0） | 绿 |
| AC3 后半：时钟在场 latency ≥ 0 | clock 注入：applied.applyLatencyMs / acked.ackLatencyMs 在场且 ≥ 0；sent 无 latency 键 | **R5** | **红**（事件缺失） | 绿 |
| R21 边界：普通族只增不改 | 限内 UPDATE：普通族三事件键集逐字 + sequence 闭环 + 零 chunked 族/零 chunk 帧 + safe-field 深扫/哨兵 | **N1** | 绿 | 绿（不得误伤） |
| AC3 前半：无 observer 零事件零采样 | 无 observer 分块 transfer：计数时钟 0 调用（含收口）+ 收敛 + dirty 恰一 + 单 ACK | **N2** | 绿 | 绿 |
| AC2：throw 隔离逐字节等价 | 每事件必 throw vs 无 observer：wire kind#seq 摘要全等 + 终态/内容/结算全等 + 零 ERROR | **N3** | 绿 | 绿 |
| AC5/AC1 aborted 保持面（R20） | resync-declared 行：aborted 恰一 + ABORTED_KEYS + reason ∈ 六值闭集 + 零成功型 + 零部分写入/durable + 残渣良性 | **N4** | 绿 | 绿（不得误伤） |
| AC4+R23：degraded × chunked | degraded 窗口分块 apply：apply-form 增量恰一（degraded-bypass-applied 单发）+ 互斥负向半边零双发 | **N5** | 绿 | 绿（改判须显式裁决） |

**转绿假设（实现轮）**：分块成功三面改道——末 chunk 出站记 transfer 上下文发 sent、组装
apply（非 degraded）发 applied、ACK 结算发 acked；键集按 ADR L89–91 + §23 envelope；latency
键随 clock 在场/缺省两态；普通族三事件仅剩非分块 UPDATE 帧路径。契约断言不锁实现形态（发射点
写法/上下文传递方式自由），只锁行为。

## 13. Red/green or baseline evidence

精确可复现命令（worktree 根；证据日志 `artifacts/sa6-issue245-verify.log`）：

```
# 契约文件（最终代码 12/12 次独立运行失败集逐名一致；以下为单次 verbose 输出）
$ NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/ws-replication/test/ws-replication-issue245-ac-red.test.ts --reporter=verbose
  ✓ 绿 N1/N2/N3/N4/N5
  × 红 R1 → AC-sent：transfer 完成出站必须恰一发 chunked-update-sent（当前 0……）expected +0 to be 1
  × 红 R2 → AC4：分块 apply 必须发 chunked-update-applied 恰一（当前 0……）expected +0 to be 1
  × 红 R3 → AC-acked：末 chunk ACK 收妥必须恰一发 chunked-update-acked（当前 0……）expected +0 to be 1
  × 红 R4 → 方向镜像：hub 出站 transfer 完成必须恰一发 chunked-update-sent{side:hub}（当前 0）expected +0 to be 1
  × 红 R5 → AC3：clock 在场时 chunked-update-applied 必须恰一（当前 0）expected +0 to be 1
  Test Files  1 failed (1)   Tests  5 failed | 5 passed (10)   Type Errors  no errors
  （最终代码 12/12 次连续运行失败集逐名一致；此前一次 N3 跨运行 flake 已定位归一——§9 对照 5）

# 类型面
$ NODE_OPTIONS=--conditions=nomicore-source pnpm exec tsc -p packages/ws-replication/tsconfig.json   # exit 0

# 全包回归（唯一失败 = 本契约红 R1–R5；既有 462 项全绿，零存量翻转）
$ NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/ws-replication/test
  Test Files  1 failed | 63 passed (64)    Tests  5 failed | 467 passed (472)   Type Errors  no errors
```

红灯归因：五个红断言全部失败于「目标成功型事件必须存在恰一」——失败点 = 现行实现能力缺口
（三成功型零实现 + 分块路径仍发普通族改道未落地），同 fixture 的绿负控与同机制 aborted 正检
（N4）排除 fixture/机制/环境伪红；实现允许（且要求）在修复前红。

## 14. Runner trigger evidence

- 测试入口真实：文件位于 `packages/ws-replication/test/`，被根 `vitest.config.ts` include 发现
  （`packages/*/test/**/*.test.ts`）；§13 命令逐字运行成功（vitest 收集 10 用例，Type Errors
  no errors）。
- 无 skip/only/todo；无 env override；零源码 grep/字符串断言（全部为运行时事件对象键集/字段/
  计数断言与 wire/文档行为断言；fixture 自检断言防场景漂移）。
- 契约文件在 `tsc -p packages/ws-replication` 下干净（TSC_OK）；**不引用未实现类型**——三成功型
  期望以本地冻结键集字面量与 `ContractEvent`（运行时对象形状）表达，判别联合未含成员时仍可编译
  （`exactOptionalPropertyTypes` 兼容）。
- 纪律：对既有套件零改动（新增文件）；生产代码零改动（git status 核对）。

## 15. Unknowns and blockers

- **R22 键扩展裁决（非阻塞，已路由 SA1）**：契约按 ADR L89–91 逐字冻结键集（无 sequence/四段
  差值键）。若 SA1 裁决 chunked 族需 sequence/效果字段关联（#238 三事件面对齐），属 append-only
  键扩展——须显式设计裁决 + 协议 §23.1 登记，并经契约修订 dispatch 同步本文件（exact-keyset
  断言会先红——即分歧信号，非伪红）。
- **R23 degraded 胜出裁决（非阻塞）**：N5 断言 degraded 窗口分块 apply 的恰一事件现为
  `degraded-bypass-applied`；SA1 若改判 chunked 型胜出，须显式裁决并修订 N5（契约默认 = SA8
  自然落位）。
- **实现轮义务（SA3）**：R1–R5 转绿 + N1–N5 保持绿；预期红翻转存量（#243 实现轮 K1 等三普通族
  断言、observer-red 矩阵加行）随改道同步；文档同步（R24：§23.1 23→26 型、L727–729 三选一→
  四选一、§23.7 增补、ADR 0013 状态）。
- **R25 条件项**：ADR 0013「提议」与父 PR #241 OPEN——方向性返工则复审本契约。
- 无环境缺失、无无法复现现象、无阻塞。

## 16. Temporary diagnostics cleanup

- 临时诊断文件 `packages/ws-replication/test/zz-diag-clock.test.ts`（clock 调用栈追踪 + N5
  degraded 事件流打印）已创建、使用、**删除**；工作树核对无残留。
- 运行日志入 `artifacts/sa6-issue245-verify.log`（worktree evidence）；过程输出存 /tmp。
- 生产实现零改动（SA6 权限线内）；未启动服务/长驻进程；无 PID 文件/marker 轮询；无后台任务
  残留（全包回归已自然结束）。
- 工作树仅含：`wiki/raw/task_issue-245.md`（host 简报）、`artifacts/sa8-conflict-gate-issue-245.md`
  （host 门禁）、本契约文件 + 本报告 + 验证日志（git status 核对）。

## 附：artifactPaths（worktree-relative）

1. `packages/ws-replication/test/ws-replication-issue245-ac-red.test.ts` —— 可执行验收契约
   （10 用例：红 R1–R5 能力缺口 / 绿 N1–N5 负控与已交付面回归；tsc 干净；最终代码 12/12 次失败集稳定）。
2. `wiki/raw/task_issue-245_sa6_contract.md` —— 本报告。
3. `artifacts/sa6-issue245-verify.log` —— 验证证据日志（TSC_OK、契约文件 5红/5绿 ×12 次（最终代码）、
   全包 64 文件 472 用例唯一失败 = 本契约 5 红）。
