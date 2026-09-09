# SA1 设计 — issue #244：分块传输有界性加固与中止清理矩阵（issue #233 切片 3）

- Dispatch（iteration 0）：`sa-43e4de98-4adb-41ce-9fde-9144ba5f7257`（mabf-sa1 / design）
- Dispatch（本 iteration）：`sa-ce873f16-ad91-4cae-a370-0292203dd89f`（mabf-sa1 / design / iteration 1）——收口 SA4 评审遗留 MAJOR **SA4-2**（跨字段校验链的生效口径与语义）；SA4-1（BLOCKER）已修复并带回归覆盖，本设计只做伪码保真同步、**不重新设计该修复**
- Worktree：`nomicore-fix-issue-244`，分支 `mabf/issue-244`，基线 HEAD `e2178f3`（切片 2 #243 已合入）；切片 3 实现已在本 worktree 落地（SA3 iteration 0 + iteration 1）
- 输入：
  - 任务简报（Host 刷新）：`wiki/raw/task_issue-244.md`（Issue #244 正文；`## Comments` 空——REST `[]`，见 `wiki/raw/task_issue-244_dispatch.md`）
  - SA6 验收契约（已批准，红灯证据）：`wiki/raw/task_issue-244_sa6_contract.md` + 契约测试 `packages/ws-replication/test/ws-replication-issue244-ac-red.test.ts`（冻结，11 用例）
  - SA8 两轮门禁：`artifacts/sa8-conflict-gate-issue-244.md`（前置，clear；R7–R10）、`artifacts/sa8-conflict-gate-issue-244-design.md`（设计后复审，clear；R11–R14 转交 SA2）
  - SA2 设计评审（approve）：`wiki/raw/task_issue-244_sa2_review.md`（R11–R14 裁决 + W1/W2）
  - SA3 实现报告：`wiki/raw/task_issue-244_sa3_report.md`（iteration 1；含 §6.2 链口径实现裁决与 `artifacts/sa3-issue244-iter1-verify.log` 留痕）
  - SA4 实现红队评审（reject→SA4-1 已闭环）：`wiki/raw/task_issue-244_sa4_review.md`（SA4-1 BLOCKER / SA4-2 MAJOR / O1–O6）
  - 权威决策：ADR 0013（SA8 判定现行约束）、ADR 0010、`docs/protocols/instance-replication-v1.md`
- 设计结论：**可行，无阻塞；SA4-2 本轮收口**。链生效口径裁决 = **分块族链上键显式表达门**：调用方 `limits` partial 显式表达 `maxChunkedUpdateBytes` **或** `maxChunksPerUpdate`（两链不等式的操作数键、均为本切片家族引入）时，对合并结果响亮校验两链；仅显式既有键（下调 `maxQueuedUpdateBytes`/`maxUpdateBytes` 等）不激活链（冻结契约 R2–R5/N2–N4 钉死该族合法、约 21 个既有绿灯套件保持绿）。iteration 0 实现只含单键门（`maxChunkedUpdateBytes`）——需后续轮放宽为双键门 + 契约补 3 用例 + 协议 §17 注记联动（§7-D1/§12）。其余面（count 准入、并发槽位——SA4-1 修复后归还闭环、滑动超时、第 23 型事件六 reason 全接线）均已落地且验证绿。

---

## 1. 任务类型、目标与非目标

**类型**：Feature（切片 3 在切片 1（#242 codec/协商/错误码登记）与切片 2（#243 端到端分块 + detached assembly 基础校验 + 发送端中止机制）之上补齐「有界性 + 中止清理矩阵」面）。

**目标**（= 简报 AC1–AC7，逐条可执行映射见 §12）：

1. 四个新资源上限配置（`maxChunkedUpdateBytes` 已存在只补链、`maxChunksPerUpdate`、`maxConcurrentAssembliesPerConnection`、`assemblyTimeoutMs`）带安全缺省、构造期响亮 TypeError、零运行时 clamp。
2. 恶意 `totalBytes`/`chunkCount` 申报在第一个数据字节流入前被拒绝；buffer 只按已验证上界分配。
3. 元数据违例/并发超额 → `UPDATE_TRANSFER_VIOLATION`；声明超资源上限 → `UPDATE_TRANSFER_TOO_LARGE`（两码均 fatal、terminal failed，均已在 §13.2 注册）。
4. assembly 停滞超 `assemblyTimeoutMs`（进度滑动 deadline）→ 弃 partial + `RESYNC_REQUIRED{UPDATE_TRANSFER_EXPIRED}`，对端按既有 §9.4 收口收敛。
5. 中止矩阵全行丢弃 partial assembly（连接 shed / 队列溢出 / 对端 RESYNC / close / GOAWAY / 断线 / epoch fence）。
6. 发送端中止簿记（zombie 吸收、窗口释放、后续 transfer）——**切片 2 已落地且绿灯（K7/K8/K9/S5/S7），本切片零改动**。
7. 全部中止/违例路径 live Y.Doc 零部分写入——重组失败结构性先于 apply（N3/双跑基线已证，本切片不触碰 apply 管线）。

**非目标**：

- 成功路径三事件 `chunked-update-sent` / `chunked-update-applied` / `chunked-update-acked` → **#245**（本设计 R7 裁决只并入 `chunked-update-aborted`，见 §6/§7-D6）。
- `shed` / `epoch-fence` / GOAWAY / queue-overflow / resync-declared 各行的中止事件**动态断言**（发射 wiring 已全部在本切片落地——SA2 R11/R13 裁决，见 §7-D5 表；动态验证归 SA7，SA6 §15 已记录）。
- replication-protocol codec / 错误码 / 词表改动（切片 1 冻结；本切片只**发射**已登记的 `UPDATE_TRANSFER_EXPIRED`）。
- 发送端任何改动（`update-channel.ts` 不在文件范围）。
- durable partial state / 逐片 apply / `maxUpdateBytes` 提高（ADR 0013 非目标逐条保持）。
- 对「仅显式下调既有键（`maxQueuedUpdateBytes`/`maxUpdateBytes` 等）、未触碰分块族键」的存量合法配置施加链校验（SA4-2 裁决的边界，见 §7-D1——冻结契约与约 21 个存量绿灯套件钉死非追溯性；如未来要收紧须同步修订冻结 fixture 与全部历史套件）。
- ADR 0013 正文修订（SA8 R9：现行约束、无冲突；欠定点 R10 的裁决按简报口径在协议文档 §13.2/§17 落笔，见 §7-D7）。

## 2. 当前行为与证据锚点

### 2.1 配置面（切片 3 已实现态；SA4-2 分歧点在此）

iteration 0/1 后的现行实现（本轮设计的修订对象即此面的链生效口径）：

| 事实 | 锚点 |
|---|---|
| `ReplicationLimits` 含 `maxChunksPerUpdate`/`maxConcurrentAssembliesPerConnection`（必填，缺省 64/4）；`ReplicationTimeouts.assemblyTimeoutMs?`（timeouts 容器，缺省 30_000）+ `ResolvedTimeouts` 必填化 | `packages/ws-replication/src/types.ts:40-70` |
| `DEFAULT_REPLICATION_LIMITS`/`DEFAULT_REPLICATION_TIMEOUTS` 三新键齐备；缺省自洽（4MiB ≤ 4MiB ∧ 4MiB ≤ 64×512KiB=32MiB） | `packages/ws-replication/src/defaults.ts:16-48` |
| 值门（两新上限键 ≥1、`assemblyTimeoutMs` 有限正整数）在 `validateLimits`/`validateTimeouts` **无条件对合并结果**校验（与既有全部值门同纪律） | `packages/ws-replication/src/validate.ts:152-155,239` |
| 跨字段链①② 抽为 `validateChunkedTransferChain`（对传入的合并结果判定两不等式）；**调用被 `hasOwnProperty('maxChunkedUpdateBytes')` 单键门控**——iteration 0 实现裁决（SA3 §6.2），与 iteration 0 设计「合并结果上校验」相悖（SA4-2 根因点） | `validate.ts:205-227`；`hub-connection.ts:195-202`；`peer-connection.ts:109-116` |
| plugin 配置路径：`mergeNested(config.limits, overrides.limits)` 只合并用户 Partial（不填缺省）→ 构造器内 `options.limits` 即用户表达键集，显式性探测在直连与 plugin 两路径语义一致 | `plugin.ts:214,362-363,453-454` |
| 测试侧直接构造 assembler 的既有绿灯套件以 `{maxUpdateBytes, maxChunkedUpdateBytes}` 为构造参数（D2 方案前提，保持不变） | `ws-replication-issue243-sa7-dynamic.test.ts:383`（`ASM_LIMITS`） |
| 冻结契约 fixture `LIMITS` = `{maxUpdateBytes:8KiB, maxQueuedUpdateCount:100, maxQueuedUpdateBytes:1MiB, maxInFlightUpdates:8}`——**不含任何分块族键**且下调既有键；合并缺省 envelope 4MiB 后链①②双违例 → 严格合并值校验将使 R2–R5/N2–N4 九用例构造期 TypeError | `ws-replication-issue244-ac-red.test.ts:104-109` |

### 2.2 接收面（缺口②③④⑤——SA6 红灯基线 @ HEAD `e2178f3`，iteration 0 设计输入；对应能力已全部落地并验证绿，SA3 iteration 1 报告 + SA4 静态核对为现状证据）

| 事实（基线态） | 锚点 |
|---|---|
| 首 chunk 校验只有 `totalBytes ≤ maxChunkedUpdateBytes` + 几何一致两维度上界；**无 `chunkCount` 上界**；全部先于分配（D1 纪律已成立） | `update-transfer.ts:161-174`（`validateFirst`） |
| assembler 纯状态机：无时间字段、无 timer；`reset()` 幂等清零；无进度快照访问器 | `update-transfer.ts:69-96` |
| 每 (ns, 方向) 一个 inbound assembler（hub peer→hub / peer hub→peer），构造时注入两上限 | `hub-namespace.ts:126-128,198-201`；`peer-namespace.ts:163-165,237-240` |
| 入站首 chunk 管线：quiet 门 → busy/残渣判别 → 状态接纳门 + submit 门（镜像 onUpdate）→ `assembler.accept` → 收齐恰一次 sequenced apply + ACK | `hub-namespace.ts:651-708`（`onUpdateChunk`/`handleAssemblerResult`）；`peer-namespace.ts:637-692`（`onHubUpdateChunk`） |
| 违例动作单点：清 assembly + ns ERROR + 终局 failed | `hub-namespace.ts:710-717`；`peer-namespace.ts:694-702`（`transferViolation`） |
| DD-4 清理挂点全集（零事件、零 timer）：违例复位 / 收 RESYNC 边 / 本端 wire 声明漏斗（记忆化门后）/ 恢复 round 结算（resyncEpisode 门）/ 通道收口（hub `closeSessionAndRelease`、peer `runDisposal`）/ peer 新连接会话建立 | `hub-namespace.ts:719-724,779,927,1178-1181,1310-1312`；`peer-namespace.ts:594,1098,1027-1030,1560-1562,446` |
| hub/peer 通道 timer 族（bootstrap/close / open/bootstrap/reconcile/periodic-reconcile/close）均无 assembly 超时 | `hub-namespace.ts:91,111-114,1426-1451`；`peer-namespace.ts:92,96-102,143-149,1699-1746` |
| 连接级无任何并发 assembly 计数（hub `channels` map / peer `controllers` map 只有逐 ns 通道） | `hub-connection.ts:436`；`peer-connection.ts:59` |
| observer 事件联合 22 型，无 `chunked-update-*` 型 | `types.ts:328-636` |
| 收口入口（本设计 reason 接线点）：hub `onCloseRequest`（收 CLOSE_NAMESPACE）:745-770、`onConnectionClosed`:827-835（`cleanupAll` 逐通道调用，hub-connection.ts:896-905）；peer `onCloseRequest`:722-747、`removeTarget`:812-873、`onConnectionLost`:919-938、`onConnectionFatal`:959-971、`onConnectionStopped`:974-982 | 如左 |
| `RESYNC_REQUIRED.reasonCode` 为自由安全字符串（非空即收）；`UPDATE_TRANSFER_EXPIRED` 已在 §9.4 登记、codec roundtrip 已锁 | `replication-protocol/src/messages.ts:212-214`；`docs/protocols/instance-replication-v1.md:262`；`codec-issue242-ac-red.test.ts:507-508` |
| 两错误码已注册（fatal / terminal failed；retryable no/config） | `replication-protocol/src/errors.ts:138-139`；协议 §13.2（L410-413 注记「发射点属后续接收端 assembly 切片」） |

### 2.3 发送面（基线绿，零改动依据）

| 事实 | 锚点 |
|---|---|
| 中间 chunk 不注册 inFlight、不挂 ack timer；仅末 chunk `inFlight.set` + 计时锚 | `update-channel.ts:396-440`（`sendOneChunk` 注释 :402） |
| `markResyncReceived` → `discardQueued` → `clearActiveTransfer`（弃置 + 槽释放单点）；`zombieSeqs` 吸收迟至 ACK | `update-channel.ts:96,177-207,211-237,241-243` |
| `effectiveInFlightCount()` = 裸在途 + 在途 transfer 槽（唯一口径） | `update-channel.ts:118-120` |
| teardown（连接收口/新连接会话建立）transferId 归 1 | `update-channel.ts:105-107` |
| 由此：接收端发起中止（本切片超时行）后，发送端 `maybeStartRecovery` 的 `inFlightCount` 门不被滞留——中间 chunk 未占裸在途，`markResyncReceived` 已清 transfer 槽 → round 立即可开（R3 收敛的机制保证） | `peer-namespace.ts:1056-1063` + 上三行 |

## 3. 根因 / 能力缺口（承接 SA6 §8，全部「高」置信；为 iteration 0 设计输入的基线陈述——五项缺口已由本切片落地闭合，SA3 iteration 1 验证 + SA4 静态核对）

切片 3 的有界性面整体不存在：count 维度上界、连接级并发上界、时间上界、配置跨字段链、中止可观测性五项全缺；现状只封了 `totalBytes` 单维度（K4 绿 / R2 红对照），丢弃语义结构性成立但零事件（R5 丢弃面绿 / 事件面红对照）。发送端簿记与多行丢弃语义为切片 2 既有绿（§2.3）。

## 4. Owner 要求落实

Issue comment REST 快照 = `[]`（`task_issue-244_dispatch.md`）→ **无 owner 评论要求**，需求面 = Issue 正文 AC1–AC7（SA6 §2 同判）。映射：

| 来源 | 要求 | 设计章节 |
|---|---|---|
| Issue 正文 AC1 | 四配置缺省 + 启动期校验链 + 零运行时 clamp | §7-D1 |
| Issue 正文 AC2 | 恶意申报分配前拒绝 | §7-D2（count 维度）；totalBytes 维度切片 2 已封 |
| Issue 正文 AC3 | 两错误码分类（含并发超额 → VIOLATION 的显式裁决） | §7-D2/D3 |
| Issue 正文 AC4 | 滑动超时 → 弃 partial + RESYNC{EXPIRED} + 收敛 | §7-D4 |
| Issue 正文 AC5 | 中止矩阵全行丢弃 | §7-D5（事件 wiring 表；丢弃面基线） |
| Issue 正文 AC6 | 发送端中止簿记 | 非目标（基线绿，§2.3） |
| Issue 正文 AC7 | 零部分写入 | §9（apply 只在 complete 后，既有管线不动） |

## 5. 复现和根因承接

| 上游事实（SA6 契约） | 证据位置 | 设计响应 |
|---|---|---|
| R1a/R1b：非法跨字段/非法新键构造静默成功；三缺省键 undefined | 契约 §5/§13（`7 failed \| 4 passed`，5 次复跑逐名一致） | §7-D1 配置链（R1a 的 6MiB > 缺省 4MiB 落 `≤ maxQueuedUpdateBytes` 链；`0` 落正整数门） |
| 冻结 fixture `LIMITS`（L104-109）下调既有键（queued 1MiB/update 8KiB）且**不含任何分块族键**——R2–R5/N2–N4 九用例依赖该构型**构造成功**；与 iteration 0 D1「合并结果上校验（无条件）」不可同时满足（SA4-2 判定的设计内部矛盾，实现期显形） | 契约测试 L104-109 构造前置；SA4 §9-SA4-2；全仓取证：该口径下另约 20 个存量绿灯文件同样构造违例（见 §7-D1 被否方案 (b)） | §7-D1 修订：链生效口径 = 分块族链上键显式表达门（`maxChunkedUpdateBytes ∨ maxChunksPerUpdate`），裁决理由、边界语义表与被否方案见 D1 |
| R2：chunkCount=65_536 首 chunk 静默接纳滞留（count 维度无上界）；N2：chunkCount=64 接纳 | 契约 §5/§9 对照 1/2 | §7-D2 控制器层准入门（`>` 判定保 64 边界） |
| R3：停滞 31s 零 RESYNC/零事件；N4：20s 零动作 + 释放后整笔收敛 | 契约 §5/§6/§9 对照 3 | §7-D4 进度滑动 timer（虚拟时钟经注入 timer seam 驱动） |
| R4：5 ns 并发首 chunk 全部滞留、零违例 | 契约 §5/§9 对照 4 | §7-D3 连接级槽位（第 5 个首 chunk → VIOLATION） |
| R5a/R5b：CLOSE/断线丢弃面绿（hub closed、文档 'seed'）、事件面红（零 chunked-* 帧） | 契约 §5/§9 对照 5、§11 | §7-D5 事件 wiring（busy 守卫保证恰一事件） |
| 转绿假设 A1–A5 | 契约 §12 | A1→D2（分类 TOO_LARGE）；A2→D4（含 peer 侧对称）；A3→D3；A4→D5+R7 裁决（并入 #244）；A5→D1（**容器裁决 = timeouts**） |
| 基线绿面：22/22（#243 套件）+ 60 文件/434 测试 + `tsc -p packages/ws-replication` exit 0 | 契约 §4/§13 | §12 验证映射含全量回归门；D2 的控制器层方案即为此保持 `issue243-sa7-dynamic` 直接构造面不变 |

## 6. SA8 约束落实

| SA8 注意项 | 设计位置 | 处理方式 | 是否需要设计后冲突复查 |
|---|---|---|---|
| R7 · ADR 0013 observer seam（`chunked-update-aborted` reason 词表 6 值与中止矩阵一一平行；代码零命中） | §7-D5、§12（R3/R5a/R5b 行） | **显式裁决：并入 #244**——契约红灯断言 R3/R5 事件面即本切片转绿判据；成功路径三事件（sent/applied/acked）登记 **#245** 承接（类型联合本切片只加 `chunked-update-aborted` 第 23 型） | 已履行：SA8 设计后复审 clear（`artifacts/sa8-conflict-gate-issue-244-design.md` §3-R7） |
| R8 · 协议 §17 配置清单/校验链块文档义务（+事件并入则 §23） | §7-D8（五处文档落点） | 落地四配置 + 链时同步修订 §17 清单与校验链块、§18 timeout 清单一行、§9.4 `UPDATE_TRANSFER_EXPIRED` 行注记（发射点已落地）、§13.2 两错误码发射点注记、§23.1 登记第 23 型事件——iteration 0 已五处落地（SA4 §3 逐块核实与实现一致） | 已履行：同上 §3-R8；**SA4-2 联动**：§17 链生效口径注记须随 §7-D1 修订再改一轮（见 §7-D8） |
| R9 · ADR 0013「提议」状态 / 父 PR #241 OPEN | §1 非目标 | 按 SA8 基准视为现行约束；本设计逐条按 ADR 落地、零冲突 → **不改 ADR**。若 #241 方向性返工需复审本设计（残余项 §13） | 否（无触面；条件性复审记录于风险） |
| R10 · 「并发 assembly 超额」错误码归属（简报显式裁决 → `UPDATE_TRANSFER_VIOLATION`） | §7-D3 | 准入门超额 → `transferViolation('UPDATE_TRANSFER_VIOLATION')`（fatal / terminal failed / retryable no）；协议 §13.2 注记落笔固化（iteration 0 已落地） | 否（简报裁决 + 语义族相容，SA8 已判无冲突） |
| R11 · shed/epoch-fence 两行事件 wiring 实现归属（SA8 → SA2 裁决 (a)：拉回 #244） | §7-D5 接线表、§8.3 表 | iteration 0 已落地：两漏斗 cause 判别（hub-namespace.ts:1022 / peer-namespace.ts:1201 `cause==='connection-shed' ? 'shed' : 'resync-declared'`）；epoch-fence 三入口置位（hub:980-982 / peer:861-863、peer applyOutcome case 'fence':1505-1506）；非 live shed 分支只置 `pendingResync` = 设计裁决（合法跨 round 流量，非矩阵缺口）；**动态断言归 SA7** | 已履行：SA2 §5-R11 裁决落在 SA8 预清理的非冲突包络内（SA2 判 `requiresConflictRecheck: false`） |
| R12 · 第 23 型补 `side` 字段（SA8 → SA2 裁决：补） | §7-D5 类型字面量 | iteration 0 已落地：`types.ts:677-680` 第 23 型含 `side: ReplicationObserverSide`（域键集仍逐字 ADR L92、无 connectionId）；hub/peer 发射分别 `'hub'`/`'peer'`；test-d 精确断言同步 | 已履行：同上（SA2 §5-R12） |
| R13 · GOAWAY 行口径统一（SA8 → SA2 裁决：connection-teardown 已接线，断言归 SA7） | §1 非目标、§7-D5 表 | iteration 0 已落地：peer `onConnectionLost`/`onConnectionFatal`/`onConnectionStopped` + hub `onConnectionClosed` 全部置 `connection-teardown`（GOAWAY drain/stop 经失联与收口入口归并）；协议 §23.1 登记行明示归并 | 已履行：同上（SA2 §5-R13） |
| R14 · R3 恢复断言措辞精度（SA8 → SA2 裁决：按契约实文收紧） | §7-D4 括注 | 措辞改为三层组合（见 D4 收敛链句）；契约文件冻结不改 | 已履行：同上（SA2 §5-R14） |

## 7. 设计决策

### D1 配置面：三新键、缺省与跨字段响亮链——**链生效口径裁决（SA4-2 收口）**（AC1；R1a/R1b/N1 转绿 + 契约补例）

**已落地部分（iteration 0，验证绿，不再改动）**：`ReplicationLimits` 追加必填 `maxChunksPerUpdate: number`（缺省 64）/ `maxConcurrentAssembliesPerConnection: number`（缺省 4）；`ReplicationTimeouts` 追加可选 `assemblyTimeoutMs?: number`（**A5 容器裁决 = timeouts**——时长上界，与 `ackTimeoutMs` 同族；ADR 0013 配置表只冻结名/缺省/约束，容器未冻结）、`ResolvedTimeouts` 必填化（`pingIntervalMs` 先例）；`DEFAULT_REPLICATION_LIMITS`/`DEFAULT_REPLICATION_TIMEOUTS` 三缺省（64/4/30_000）；值门（两新上限键 ≥1、`assemblyTimeoutMs` 有限正整数）**无条件对合并结果**校验；`plugin.ts` `LIMIT_KEYS`+2、`TIMEOUT_KEYS`+1；全部构造期 throw、运行期只读 resolved 值（零运行时 clamp）。

**链生效口径（iteration 1 裁决，SA4-2）**：

跨字段链①`maxChunkedUpdateBytes ≤ maxQueuedUpdateBytes`、②`maxChunkedUpdateBytes ≤ maxChunksPerUpdate × maxUpdateBytes`（ADR 0013 L71 配置表约束列逐字）——校验对象恒为**合并结果**（`resolveLimits` 后的 effective 值，与既有全部链式不变量同口径）；**校验的激活条件 = 调用方 `limits` partial 显式表达任一「分块族链上键」**：

```ts
// 双构造入口（hub-connection.ts / peer-connection.ts 构造器）：
validateLimits(limits);      // 值门无条件（含两新键 ≥1；显式 undefined 合并后落值门 TypeError）
validateTimeouts(timeouts); // 同上
// issue #244（SA4-2 裁决）：分块族链上键显式表达门——两链不等式的操作数键均为本切片
// 家族引入（slice 2/3）；表达其一即对合并结果响亮校验两链。仅显式既有键不激活
// （缺省自洽由 DEFAULT 构造成立：4MiB ≤ 4MiB ∧ 4MiB ≤ 64×512KiB=32MiB——见被否方案 (b)）。
if (
  options.limits != null &&
  (Object.prototype.hasOwnProperty.call(options.limits, 'maxChunkedUpdateBytes') ||
   Object.prototype.hasOwnProperty.call(options.limits, 'maxChunksPerUpdate'))
) {
  validateChunkedTransferChain(limits);  // 链①②，合并结果上判定
}
```

- **顺序**：值门先于链（构造器内既有调用序 `validateLimits` → `validateChunkedTransferChain`）——`{maxChunksPerUpdate: 0}` 报值门错误（更精确），链违例报链错误；两者同为构造期 TypeError。
- **plugin 路径对称**：`mergeNested(config.limits, overrides.limits)` 只合并用户 Partial（不填缺省，plugin.ts:214,362-363）→ 构造器内 `options.limits` 即用户表达键集，同一探测两路径语义一致；`LIMIT_KEYS` 已含两键（可达性既有）。

**边界语义表（唯一权威口径）**：

| 调用方 `limits` partial | 链①②是否校验 | 依据 |
|---|---|---|
| 显式 `maxChunkedUpdateBytes`（任意值，含 =缺省 4MiB） | **是** | 冻结契约 R1a（6MiB vs 缺省 4MiB → TypeError）/N1（256KiB + 下调既有键 → 通过）逐字钉死 |
| 显式 `maxChunksPerUpdate`（无 chunked 字节键） | **是（本裁决新增，现行实现尚未含）** | AC1「非法配置构造期 TypeError」对新键族最大化成立：`{maxChunksPerUpdate: 4}` + 缺省 → 4MiB > 4×512KiB=2MiB → TypeError；`{maxChunksPerUpdate: N}`（N≤7）同。存量绿面零影响（经 `validateLimits` 的现存构造点中显式该键的只有契约 R1b 非法值用例——值门先抛，同为 TypeError；其余含该键的字面量不经 `validateLimits`：observer-red L742 `ConnectionSenderHost` 直构、issue243-sa7-dynamic `ASM_LIMITS` 直构 assembler、api.test-d 类型面——与门无关） |
| 仅显式既有键（下调 `maxQueuedUpdateBytes`/`maxUpdateBytes` 等，如冻结 fixture `LIMITS`） | **否** | 冻结契约 R2–R5/N2–N4（+SA3 回归文件）依赖该构型构造成功；非追溯性（见下） |
| 显式 `maxConcurrentAssembliesPerConnection` / `assemblyTimeoutMs`（无链上键） | **否** | 非链操作数——只有无条件值门；避免「调并发/超时钮触发分块字节链错误」的惊讶面（新契约负控 N6 锁定） |
| peer `chunkedUpdate` 旋钮 = true | **否**（不激活链） | 能力激活 ≠ 配置表达；冻结契约全部场景 knob-on + `LIMITS` 构造成功 |

**裁决理由**：

1. **契约一致（contract-consistent）**：冻结契约三条腿唯一可同时满足的口径族即「显式表达分块族键才校验」——R1a（显式 6MiB → throw）要求显式 chunked 键激活；R2–R5/N2–N4（`LIMITS` 下调既有键、缺省 envelope → 必须构造成功）要求仅显式既有键不激活；N1（显式 256KiB + 下调既有键 → 通过）要求激活时对合并结果判定。iteration 0 设计 D1「合并结果上校验（无条件）」与 §12「契约原样转绿」本不可同时满足（SA4-2 判定的内部矛盾）——修正设计文本，不破坏契约。
2. **非追溯性（append-only 演化纪律）**：`maxQueuedUpdateBytes`/`maxUpdateBytes` 是 slice-3 之前既有键；任何 slice-3 前部署/存量套件不可能预见新键缺省会反噬其合法配置。全仓取证：严格合并值校验将使 **约 21 个存量绿灯文件构造期 TypeError**——ws-replication 内 `ac5-live`、`issue137-ac1-ac7-red`、`issue137-r2-red`、`issue172-contract-anchors`、`issue231-send-failure`、`plugin.test`、`review-revisions-r1-r7-red`、`sa7-hardening-dynamic`、`sa7-issue137-dynamic`、`sa7-r2-supplement`、`sa7-round2-dynamic`、冻结契约本体、SA3 回归文件，**含 DENY 面 5 个受保护套件**（`issue233-repro`、`issue243-ac-red`、`issue243-chunked-live`、`issue243-real-transport`、`issue243-sa7-dynamic`），以及 `apps/yjs-server/test/issue164-sa7-dynamic.test.ts:268-269`（maxUpdateBytes 1KiB）——存量合法配置被新键缺省追溯性非法化，不可接受。
3. **新键族内对称**：`maxChunksPerUpdate` 与 `maxChunkedUpdateBytes` 同为本切片家族引入、同为链②操作数；只认后者（现行实现的单键门）会留下「显式收紧 `maxChunksPerUpdate`（如 4）+ 缺省 envelope 4MiB = 链②违例却静默」的族内缺口——SA4-2 对 AC1 的批评模式（「链对整族配置静默失效」）在该族原样复现，故裁决补入（该族运行期有 TOO_LARGE 兜底但构造期应响亮——AC1「启动期校验链生效」）。

**被否方案**：

- **(a-min) 原样固化现行单键门（仅 `maxChunkedUpdateBytes`）**：SA4-2 路线 (a) 的字面最小形态，零生产改动；被否——理由 3 的族内缺口原样留存（`{maxChunksPerUpdate: 4}` + 缺省静默构造），AC1 对本切片自引入键仍未生效，收口不完整。
- **(b) 无条件合并值校验（iteration 0 原表述）**：语义最简、与既有链式不变量纪律完全同构；被否——冻结契约 9 用例构造失败 + 理由 2 的约 21 文件存量破坏 + 用户配置非追溯性破坏（SA4 路线 (b) 须 SA6/owner 同步修订冻结 fixture 与受保护套件——代价证据链如上，收益仅为构造期前置的 fail-fast，运行期各路径本就有界且响亮）。
- **(b′) 以 `chunkedUpdate` 旋钮激活链**：能力激活即校验；被否——冻结契约场景全部 knob-on + `LIMITS` 构造成功，破坏契约。
- **(b″) 下调缺省 `maxChunkedUpdateBytes` 使合并恒自洽**：被否——ADR 0013 L71 冻结缺省 4 MiB。

**SA4-2 语义残余（显式登记，非遗漏）**：「仅显式下调既有键 + 缺省 envelope」族有意合法。运行期后果有界：接收侧 admission 仍受 envelope（totalBytes）/count/槽位三上界封顶（D2/D3 + K4），超 `maxQueuedUpdateBytes` 的逻辑 update 在发送侧被既有 bounded 拒纳/shed（needs-resync 收口）——链在该族不提供构造期信号是接受的残余；如未来收紧，须同步修订冻结 fixture 与全部历史套件（方案 (b) 代价证据链）。

### D2 首 chunk `chunkCount` 准入门（AC2/AC3 分类；R2/N2 转绿）

- **落点 = 控制器入站首 chunk 管线**（hub `onUpdateChunk` / peer `onHubUpdateChunk` 的 idle∧chunkIndex===0 分支），紧随状态接纳门 + submit 门之后、并发槽获取与 `assembler.accept` 之前：

```ts
// issue #244（AC2/AC3）：count 维度声明上界——分配前拒绝（D1 纪律；totalBytes 维度
// 已在 assembler validateFirst 封顶，K4）。分类 = 声明超资源上限族（ADR 0013:80）。
if (message.chunkCount > this.host.limits.maxChunksPerUpdate) {
  this.transferViolation('UPDATE_TRANSFER_TOO_LARGE');
  return;
}
```

- 判定用 `>`：`chunkCount === 64` 恰在上限 → 接纳（N2 off-by-one 守卫）；`65_536` → TOO_LARGE（R2）。
- 分类依据（A1）：与 K4 的 `totalBytes` 超限同族（`UPDATE_TRANSFER_TOO_LARGE`，fatal/config-retryable/terminal failed），非 VIOLATION；动作复用 `transferViolation` 单点（清 assembly + ns ERROR + 终局 failed + `namespace-failed{protocol-violation}` 恰一）。
- **busy 路径不需要此门**：跨帧 `chunkCount` 逐字节一致已由 assembler 强制（漂移 → VIOLATION，update-transfer.ts:135）。
- **被否方案：把该检查放进 `UpdateChunkAssembler.validateFirst` 并给构造参数加必填 `maxChunksPerUpdate`**。行为等价且更贴 ADR L59 校验清单，但 `ws-replication-issue243-sa7-dynamic.test.ts:383` 以两键字面量直接构造 assembler（`ASM_LIMITS as const`），必填化使该切片 2 绿灯套件 typecheck 失败，违背「绿灯套件不改、保持回归绿」（SA6 §10 未触碰面）。控制器层方案与既有分层一致：通道持有 limit 准入先例（hub `onUpdate` 在通道层判 `maxUpdateBytes`，hub-namespace.ts:632-636；assembler 内同判仅纵深）；assembler 仍为几何/一致性唯一事实源。残余面：包外直接构造 `UpdateChunkAssembler` 不获 count 门——该类不经 `src/index.ts` 导出（包内私有），生产调用点仅 hub/peer 两通道，均已设门。

### D3 连接级并发 assembly 槽位（AC3 + R10；R4 转绿）

- `HubChannelHost` / `PeerNamespaceHost` 各追加两 facet（连接实现方持有，通道只调用）：

```ts
/** issue #244：连接级入站并发 assembly 准入（ADR 0013:62；缺省 4/每连接每入站方向）。 */
tryBeginInboundAssembly(namespaceId: string): boolean;
/** issue #244：槽位归还（busy→idle 全部路径经通道 endAssemblyScope 汇入）。 */
endInboundAssembly(namespaceId: string): void;
```

- 实现（`HubConnectionImpl` / `PeerConnectionImpl`）：`private readonly inboundAssemblySlots = new Set<string>()`。
  - `tryBegin`：`has(ns) → true`（幂等防御）；`size ≥ limits.maxConcurrentAssembliesPerConnection → false`；否则 `add(ns) → true`。R4：第 1–4 个首 chunk `add`（size 1–4），第 5 个 `size=4 ≥ 4` → false。
  - `end`：`delete(ns)`（幂等）。集合随连接对象生命周期消亡，无独立清理面。
- 通道侧调用序（idle 首 chunk，D2 门之后）：`if (!this.host.tryBeginInboundAssembly(ns)) { this.transferViolation('UPDATE_TRANSFER_VIOLATION'); return; }` ——超额 ns 收 ERROR `UPDATE_TRANSFER_VIOLATION` + terminal failed，其余 4 ns 零影响（各自通道独立，R4 断言）；违例为 ns 级，连接保持 ready。
- **准入序裁决（W2 单一权威口径）**：准入序 = D2（count 声明门）→ D3（并发槽门）→ accept（§8.1 伪码）；双违例帧（既超 count 上限又遇槽满）按 D2 分类 `UPDATE_TRANSFER_TOO_LARGE`——声明维度先判，与 K4 totalBytes 维度同族先例一致。R2/R4 断言对该序不敏感（构型互斥：R2 槽空闲、R4 count 合法）。可选锁序用例见 §12。
- 内存上界兑现：`maxConcurrentAssembliesPerConnection × maxChunkedUpdateBytes`（每连接每入站方向，ADR 0013:76）——count 门（D2）+ totalBytes 门（既有）保证单 assembly ≤ `maxChunkedUpdateBytes`，槽位（本条）保证并发数。

### D4 进度滑动 assembly 超时（AC4；R3/N4 转绿）

- timer 所有权 = 通道（hub/peer 各自），经注入 `host.timer`（ReplicationTimer seam；虚拟时钟可驱动）。
- `TimerKind` 追加 `'assembly'`；`timers` Record 追加槽；hub `armTimer` 延迟选择追加 `timeouts.assemblyTimeoutMs`；peer `TIMER_DELAY_FIELD` 追加 `assembly: 'assemblyTimeoutMs'`；双侧 `clearAllTimers` 清单追加 `'assembly'`。
- 武装/重置/清除：
  - **武装**：assembler idle→busy（首 chunk 被接纳且未即刻完成/违例）；
  - **重置**：每收一个使 assembly 仍 busy 的 chunk（进度滑动 deadline，ADR 0013:63）；
  - **清除**：busy→idle 的全部出口（`endAssemblyScope` 单点，见 §8）+ 通道既有 `clearAllTimers` 各收口入口（closing/终态/断线同步段先杀 timer，防静默期 fire——§D8.5 既有纪律）。
- fire 动作（hub 版；peer 版差异在尾行）：

```ts
private onAssemblyTimeout(): void {
  if (!this.inboundAssembler.busy) return;           // clear 后 stale fire 零副作用
  this.clearInboundAssembly('timeout');              // 弃 partial + 归还槽 + 清 timer + aborted{timeout} 事件
  if (this.isQuietState()) return;                   // 防御（closing 已杀 timer，结构性不可达）
  this.sendChecked({                                  // 出向收口帧（hub→peer 方向）
    kind: 'RESYNC_REQUIRED',
    namespaceId: this.namespaceId,
    reasonCode: 'UPDATE_TRANSFER_EXPIRED',            // 切片 1 已登记词表；codec 自由安全字符串
  });
  this.setState('needs-resync');
  this.resyncEpisode = true;                          // round 结算回 live 时的幂等清理标记（既有语义）
}
// peer 版尾行追加：this.maybeStartRecovery();
```

- **独立发射点而非并入既有 resync 漏斗**（关键裁决）：`declareHubResync`/`declareLocalResync` 硬编码 `reasonCode:'send-queue-overflow'` 且被 `resyncDeclared` 记忆化（每恢复周期一帧）；超时行需要 (a) 冻结词表 `UPDATE_TRANSFER_EXPIRED`，(b) 到达即发——busy assembly 存在时前序声明可能已消耗本周期记忆位（needs-resync 期可再接纳新首 chunk）。超时行自成一帧（`sendChecked` 收口路径直发语义与漏斗一致）；**不**触碰 `resyncDeclared`、**不**发射 `resync-required` observer 事件（ADR 0013 未为该行定义 cause，本行可观测信号 = `chunked-update-aborted{timeout}` + wire 帧；如需 cause 扩展归 #245/SA7 append-only，见 §13 残余）。R3 断言（R14 口径，按契约实文三层组合）= hubToPeer reason 列表 `toContain('UPDATE_TRANSFER_EXPIRED')` + peer 侧 `resync-required{cause:'remote-declared'}` 恰一（传递性约束帧数恰一）+ transferId=1 续传 chunk 恰一（零续传）。
- 收敛链（R3 尾，全既有机制零新码）：peer 收 RESYNC → `onResyncReceived`（`markResyncReceived` 弃残余队列 + 清 transfer 槽；中间 chunk 不占裸 inFlight → `maybeStartRecovery` 立即开 round）→ 双向 diff 回灌（BIG 20KB ≤ `maxSyncDiffBytes` 2MiB 经 Step2 控制帧）→ 双侧回 live、零 failed；中止后新写正常收敛（AC6 自愈尾）。hub 侧超时后 `needs-resync` 等 peer 新 round（round 恒 peer 发起，§10.6）。

### D5 `chunked-update-aborted` 事件 seam（AC5 + R7；R3/R5a/R5b 事件面转绿）

- `ReplicationObserverEvent` 追加第 23 型（append-only；域键集逐字 ADR 0013:92——无 `connectionId`；`side` 为 §23 结构信封字段——22 型全体惯例 + ADR L85「对齐 §23 纪律」条款，SA2 R12 裁决）：

```ts
| {
    readonly type: 'chunked-update-aborted';
    readonly side: ReplicationObserverSide;   // R12：hub/peer 发射侧字面量
    readonly namespaceId: string;
    readonly transferId: number;
    readonly reason: 'timeout' | 'shed' | 'resync-declared' | 'channel-teardown'
      | 'connection-teardown' | 'epoch-fence';
    readonly receivedChunks: number;
    readonly receivedBytes: number;
  }
```

- **发射端 = 丢弃 partial assembly 的一端**（A4 接收方语义）；`receivedChunks/receivedBytes` = 已收进度（safe-field：长度/计数非内容）。`UpdateChunkAssembler` 追加唯一改动——进度快照访问器：

```ts
snapshot(): { readonly transferId: number; readonly receivedChunks: number; readonly receivedBytes: number } | undefined
// idle → undefined；busy → 当前进度（事件构造前捕获）
```

- 通道侧统一辅助：`clearInboundAssembly(reason?)` 升级为 reason 感知（快照先于 reset；`endAssemblyScope` 归还槽/清 timer；**决策落定后发射**，§23.4 纪律；`observerOn` 门——无 observer 零构造零快照）+ `emitChunkedUpdateAborted` helper（hub/peer 对称私有）。busy 守卫保证每 assembly 至多一事件（重复 clear 幂等零事件）。
- reason 接线表（本切片 wiring 面）：

| reason | 触发行 | 接线点（hub / peer） | 契约门控 |
|---|---|---|---|
| `timeout` | assembly 滑动超时 | `onAssemblyTimeout`（D4） | R3（红灯断言） |
| `channel-teardown` | CLOSE_NAMESPACE 收口（对端发起或本端 removeTarget） | hub `onCloseRequest` 入口 / peer `onCloseRequest` + `removeTarget` 入口置 `teardownAbortReason`，`closeSessionAndRelease` / `runDisposal` 的 clear 消费 | R5a（红灯断言，hub 侧） |
| `connection-teardown` | 断线 / hub 连接 close / GOAWAY drain deadline / stop（**R13 口径：GOAWAY 无独立 reason，经失联与收口入口归并本行**） | hub `onConnectionClosed` 入口（`cleanupAll` 逐通道调用，hub-connection.ts:896-905；hub `close()` 同经 `cleanupAll` 汇入）/ peer `onConnectionLost` + `onConnectionFatal` + `onConnectionStopped` 入口置 reason，收口 clear 消费 | R5b（红灯断言，hub 侧） |
| `resync-declared` | 收对端 RESYNC 边 / 本端 wire 声明边 / 恢复 round 结算（doomed 残余） | `onResyncReceived` / 两漏斗记忆化门后 / `onRoundSettled` resyncEpisode 分支的 clear 传 reason | 非门控（完备性 wiring，SA7 动态面承接验证；单 helper 零新状态） |
| `shed`（R11 裁决：拉回 #244，iteration 0 已落地） | 连接 shed（live 通道声明边） | 两漏斗 clear 调用点按 cause 判别：`clearInboundAssembly(cause === 'connection-shed' ? 'shed' : 'resync-declared')`（hub-namespace.ts:1022 / peer-namespace.ts:1201） | SA7 动态断言 |
| `epoch-fence`（R11 裁决：拉回 #244，iteration 0 已落地） | epoch fence 终局 | hub `oneShotTerminal()`（hub-namespace.ts:980-982）/ peer `onIdentityChanged()`（peer-namespace.ts:861-863）与 `applyOutcome` case `'fence'`（peer-namespace.ts:1505-1506）入口置位，`closeSessionAndRelease`/`runDisposal` 消费 | SA7 动态断言 |

- **非 live shed 分支 = 设计裁决而非矩阵缺口**（R11 澄清）：hub `sendFacet.discardForConnectionPressure` 对非 live 通道只置 `pendingResync`（hub-namespace.ts:143-145），不清 assembly——needs-resync/reconciling 期接纳的入站 transfer 是合法跨 round 流量，此时丢弃反而错误；矩阵「连接 shed → partial 丢弃」在接收侧经 live 路径的 RESYNC 声明漏斗兑现（声明边即清）。

- reason 字段消费语义：`teardownAbortReason` 为通道私有一次性记忆位——置位于收口入口（同步段），由收口链上的 clear 消费后置 undefined；CLOSE 在途时连接先断 → 后置位覆盖（实际执行丢弃的 teardown 即归类，last-writer-wins）。终局**failed** 族（违例/远端 ERROR/revoke → `finalize('failed', …)`）的 clear **不**发事件：这些行的可观测信号是 `namespace-error`/`namespace-failed`（互补不重复，#256 口径先例）；ADR 六词表无对应行。**carve-out（R11-2）**：终局 **conflicted** 族的 fence 入口经 `teardownAbortReason = 'epoch-fence'` **发射**（ADR 词表要求，与 `identity-conflicted` 互补不重复）——「终局族不发事件」规则只覆盖 failed 族，不得误读到 fence 行。
- **R7 裁决（显式）**：`chunked-update-aborted` 并入 #244（契约 R3/R5 红灯即转绿判据）；`chunked-update-sent`/`-applied`/`-acked` 三型**不并入**，登记 #245（类型面本切片不加，避免无发射点的类型登记——docs/AGENTS「不得虚构实现行为」）。

### D6 零发送端/零 codec/零状态机迁移改动

发送端中止簿记（停发、zombie、窗口释放、teardown 归位）全部切片 2 已落地（§2.3）；本切片对 `update-channel.ts`、`replication-protocol` 包零改动。通道状态机迁移点不变（超时行复用 `needs-resync`；违例行复用 `failed`）。

### D7 R10 分类固化（协议文档落笔）

§13.2 两错误码注记更新为「发射点已落地（#244）：首 chunk 声明超限（totalBytes/count 两维度）→ TOO_LARGE；跨帧元数据违例与连接级并发 assembly 超额 → VIOLATION（简报对 ADR 0013 L62 欠定点的显式裁决）」。ADR 0013 正文不改（L62 只设限未命名，无冲突面）。

### D8 规范文档义务（R8；五处落点——§9.4/§13.2/§18/§23.1 四处 iteration 0 已落地且 SA4 §3 逐块核实与实现一致；**§17 需随 SA4-2 收口做第二轮修订**）

`docs/protocols/instance-replication-v1.md`：
1. **§17**（第二轮，随 SA4-2 门放宽联动）：配置清单与校验链块保持 iteration 0 落地形态；链生效口径注记（现 L569「调用方**显式配置** `maxChunkedUpdateBytes` 时响亮生效」= iteration 0 单键门口径的如实登记）改为双激活键口径——「调用方显式配置 `maxChunkedUpdateBytes` **或** `maxChunksPerUpdate`（两链不等式的分块族操作数键）时对合并配置响亮生效；缺省值自洽由配置表缺省构造成立（4 MiB ≤ 4 MiB ∧ 4 MiB ≤ 64 × 512 KiB）；仅下调既有键、未表达分块族键的存量配置不把缺省误判为用户配置错误（非追溯性）」。改句须与 §7-D1 边界语义表一致；与实现门放宽（§11/§12 路由）同轮落地，避免文档-行为漂移窗口。
2. **§18**（已落地）：timeout 清单追加 `assemblyTimeoutMs`（缺省 30_000；进度滑动 deadline；超时 → 弃 partial + `RESYNC_REQUIRED{UPDATE_TRANSFER_EXPIRED}`）。
3. **§9.4**（已落地）：`UPDATE_TRANSFER_EXPIRED` 行「现状登记」更新为发射点已落地（接收端 assembly timeout，#244）。
4. **§13.2**（已落地）：两错误码发射点注记（D7）。
5. **§23.1**（已落地）：登记第 23 型 `chunked-update-aborted`（side 列 = hub/peer；字段/reason 词表/发射端语义/`observerOn` 门与决策落定后发射纪律；注记成功路径三型归 #245 计划——措辞为计划非行为）。
CONTEXT.md 零改动（「分块复制传输」词汇已覆盖，无新域词）。

## 8. 接口、状态机与数据流（实现规格）

### 8.1 入站首 chunk 管线（hub `onUpdateChunk` / peer `onHubUpdateChunk` 改造后）

```ts
// 既有前置不动（W1 口径——两侧不对称）：hub：quiet 门 → busy 分支 → 残渣判别 → 状态接纳门
// → submit 门；peer：quiet 门 → busy 分支 → 残渣判别 → 状态接纳门（无 submit 门）。
// idle ∧ chunkIndex===0 尾段（新序）：
if (message.chunkCount > this.host.limits.maxChunksPerUpdate) {   // D2（分配前）
  this.transferViolation('UPDATE_TRANSFER_TOO_LARGE'); return;
}
if (!this.host.tryBeginInboundAssembly(this.namespaceId)) {        // D3（分配前）
  this.transferViolation('UPDATE_TRANSFER_VIOLATION'); return;
}
this.assemblySlotHeld = true;   // SA4-1 修复：镜像旗标随槽获取同步置位（accept 前）——
                                // endAssemblyScope 归还守卫因此可达（获取-归还闭环）
const result = this.inboundAssembler.accept(message);              // 既有（含 totalBytes 门/几何门/分配）
this.afterAssemblyAccept(result, sequence);                        // 槽/timer 收尾 + 结果分派

private afterAssemblyAccept(result, sequence): void {
  if (!this.inboundAssembler.busy) this.endAssemblyScope();        // complete / 首 chunk 即违例（assembler 已自复位或从未 busy）
  else this.armTimer('assembly');                                  // more → 武装/重置滑动 deadline
  this.handleAssemblerResult(result, sequence);                    // 既有（violation→transferViolation；complete→applyRemoteUpdate）
}
```

busy 分支（后续 chunk）：`accept` 后同样经 `afterAssemblyAccept` 包装（busy→idle 出口唯一化；busy 路径违例时 assembler 不自复位 → `transferViolation → clearInboundAssembly` 兜底归还）。

### 8.2 assembly 作用域状态（通道私有，双侧对称）

```ts
private assemblySlotHeld = false;                    // 本通道是否占用连接级槽
private teardownAbortReason: ChunkedUpdateAbortReason | undefined;

private endAssemblyScope(): void {                   // busy→idle 唯一收尾点
  this.clearTimer('assembly');
  if (!this.assemblySlotHeld) return;
  this.assemblySlotHeld = false;
  this.host.endInboundAssembly(this.namespaceId);
}

private clearInboundAssembly(reason?: ChunkedUpdateAbortReason): void {
  const snap = reason !== undefined && this.observerOn && this.inboundAssembler.busy
    ? this.inboundAssembler.snapshot() : undefined;  // 快照先于 reset
  this.endAssemblyScope();
  this.inboundAssembler.reset();                     // 既有幂等清零
  if (snap !== undefined) this.emitChunkedUpdateAborted(snap, reason);  // 决策落定后发射
}
```

不变量：槽获取唯一点 = 首 chunk 准入（D3 门通过后、`accept` 前同步置位镜像旗标 `assemblySlotHeld`——SA4-1 修复项，hub-namespace.ts:721 / peer-namespace.ts:704）；槽归还唯一点 = `endAssemblyScope`（经 `afterAssemblyAccept` 或 `clearInboundAssembly`）；timer 句柄与槽同生共死。漏置位/漏归还即未来合法 transfer 误 VIOLATION——busy→idle 出口枚举见 §8.1/§8.2（complete/首违例经 afterAssemblyAccept；busy 违例/超时/全部清理挂点经 clearInboundAssembly），获取-归还闭环由回归套件 REG1–REG3 锁定（§12）。

### 8.3 清理挂点 reason 接线（既有挂点 × 新参数）

| 既有挂点（DD-4 表） | 调用改形 |
|---|---|
| hub `transferViolation` / peer 同名 | `clearInboundAssembly()`（无 reason——**failed 族**信号互补，见 §7-D5 carve-out） |
| hub/peer `onResyncReceived` | `clearInboundAssembly('resync-declared')` |
| hub `declareHubResync` / peer `declareLocalResync`（记忆化门后） | `clearInboundAssembly(cause === 'connection-shed' ? 'shed' : 'resync-declared')`（R11：shed 行经 live 声明边接线；hub-namespace.ts:1022 / peer-namespace.ts:1201） |
| hub/peer `onRoundSettled` resyncEpisode 分支 | `clearInboundAssembly('resync-declared')` |
| hub `closeSessionAndRelease` | `clearInboundAssembly(this.teardownAbortReason)` 并消费（置 undefined） |
| peer `runDisposal` | 同上 |
| peer `tryOpenReplicationSession`（新连接会话建立） | `clearInboundAssembly()`（代际卫生清残留，非矩阵行；busy 守卫下与 runDisposal 至多一处发事件） |
| hub `onCloseRequest` / peer `onCloseRequest`+`removeTarget` 入口 | `this.teardownAbortReason = 'channel-teardown'`（同步段置位） |
| hub `onConnectionClosed` / peer `onConnectionLost`+`onConnectionFatal`+`onConnectionStopped` 入口 | `this.teardownAbortReason = 'connection-teardown'`（R13：GOAWAY drain/stop 经失联与收口入口归并） |
| hub `oneShotTerminal()` fence 分支（hub-namespace.ts:980-982）/ peer `onIdentityChanged()`（peer-namespace.ts:861-863）/ peer `applyOutcome` case `'fence'`（peer-namespace.ts:1505-1506） | `this.teardownAbortReason = 'epoch-fence'`（R11：conflicted 族 fence 终局**发射**；置位先于 finalize，保证 claim 求值点前已置位） |

### 8.4 数据流路线

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚点 |
|---|---|---|---|---|---|---|---|---|
| 恶意 count 申报 | 对端首 chunk（chunkCount>64） | 无分配（拒绝先于 `new Uint8Array`） | 通道准入门（进程内） | ns ERROR 帧（wire） | peer `onErrorFrame` → failed | `UPDATE_TRANSFER_TOO_LARGE` + terminal failed + `namespace-failed`×1 | assembly 保持 idle、槽未占/即还 | R2/N2 |
| 并发超额 | 第 5 个并发首 chunk | 无分配 | 连接级 Set 判满（进程内） | ns ERROR 帧 | 同上 | `UPDATE_TRANSFER_VIOLATION` + victim failed、连接 ready | 槽不获取；其余 4 槽不动 | R4 |
| 停滞超时 | 注入 timer fire（>30s 无进度） | 弃 partial（内存释放） | 通道超时处理器 | `RESYNC_REQUIRED{UPDATE_TRANSFER_EXPIRED}`（wire，hub→peer 或 peer→hub） | 对端 `onResyncReceived`（既有） | aborted{timeout, receivedChunks, receivedBytes} 事件；双侧零 failed；round 回灌收敛 | 槽归还 + timer 清 + `needs-resync` + resyncEpisode | R3/N4 |
| 通道收口中止 | 对端 CLOSE_NAMESPACE | 同上 | reason 记忆位→收口链 clear | 无新 wire（既有 CLOSE_OK） | — | aborted{channel-teardown} 恰一、零 failed | 同上 | R5a |
| 连接断线中止 | transport onClose | 同上 | hub `cleanupAll`/peer 失联入口 → clear | 无新 wire（连接已死/收口中） | — | aborted{connection-teardown} 恰一、零 failed、文档 'seed' | 同上 | R5b |
| 健康 transfer（对照） | 合法 3-chunk | 首 chunk 后一次性 detached buffer | assembler 重组 | 末 chunk 后恰一次 apply + 单 ACK | live Y.Doc | 收敛、零 RESYNC、零事件 | complete → 槽/timer 清 | N3 |

跨模块/跨持久化边界：唯一 wire 新形态 = 既有帧型 `RESYNC_REQUIRED` 携带已登记 reasonCode（append-only，未协商端不可达——超时行只在有 busy assembly 时可达 ⇒ 必已协商）；事件为 local seam 零 wire。零持久化新面（partial 恒易失）。

## 9. 错误、恢复、并发与幂等

- **失败分类**：声明超限（totalBytes 既有/count 新）→ TOO_LARGE（config-retryable——改配置可解）；元数据违例/并发超额 → VIOLATION（retryable no）；两码 fatal/terminal failed，ns 级、连接不拆（R4 断言连接 ready）。
- **超时恢复**：非终局——`needs-resync` + 既有 round 修复（R3 双侧零 failed）；进度恢复（窗内续收）免超时（N4）。
- **并发/幂等**：槽获取/归还各有唯一入口、幂等防御（`has` 短路 / `delete` / 获取侧同步置位镜像旗标——SA4-1 修复后旗标-集合镜像对称）；`reset()` 幂等；`clearInboundAssembly` 多路径重复调用至多一事件（busy 守卫）；timer 句柄可清（fire 前清 = 零动作；fire 后 clear 竞态由 busy 守卫吸收）。
- **零部分写入**：apply 仍只在 `complete`（Σbytes 精确核对）后经既有 sequenced 管线发生；全部新拒绝/中止路径先于分配/apply（AC7，R2–R5 内嵌断言 + N3 哨兵）。
- **资源所有权**：partial buffer 归 (连接, 方向, ns) 通道作用域；槽归连接；timer 归通道；事件 throw 由 `dispatchReplicationObserver` 隔离（既有，绝不改变协议状态）。

## 10. 调用方影响矩阵

| 调用方 | 当前处理 | 设计后处理 | 所需改动 | 证据 |
|---|---|---|---|---|
| `createHubReplication` / `createPeerReplication` 调用方（含 plugin 组装与 apps） | 新键非法值已构造期 TypeError；链 = 单键门（仅显式 `maxChunkedUpdateBytes` 校验，iteration 0 实现） | 链 = **双键门**（显式 `maxChunkedUpdateBytes` ∨ `maxChunksPerUpdate` → 合并结果校验两链，§7-D1）；值门无条件不变；显式表达分块族链上键但链违例 → 构造期 TypeError；仅显式既有键/缺省零变化（非追溯性） | hub-connection.ts / peer-connection.ts 构造器门条件放宽（+`validate.ts` 注释、协议 §17 注记——SA4-2 后续轮） | hub-connection.ts:195-202；peer-connection.ts:109-116；plugin.ts:214,362-363（Partial 保留 → 两路径探测一致） |
| plugin 配置宿主（`HubReplicationPluginConfig.limits/timeouts` 等） | 新键可配置（键表已增补） | 同上（`mergeNested` 保留用户 Partial → 显式性探测与直连路径语义一致） | 无（键表/合并零改动） | plugin.ts:150-156,214,289-329 |
| `ReplicationObserver` 消费方 | 23 型（含 `chunked-update-aborted{side,…}`） | 不变（append-only 加宽维持） | 无强制（联合型加宽；ws-server 为转发型 adapter，非穷举 switch） | types.ts:677-690；apps/yjs-server/src/transport/ws-server.ts:133-147 |
| `HubChannelHost` / `PeerNamespaceHost` 实现方（仅包内 HubConnectionImpl/PeerConnectionImpl） | 两 facet 已实现（含 SA4-1 修复后归还闭环） | 不变 | 无 | hub-connection.ts:462-467,517-531；peer-connection.ts:94-101,142-153 |
| `UpdateChunkAssembler` 直接使用方（仅 `issue243-sa7-dynamic` 测试） | 构造签名不变（仅 +`snapshot()`） | 不变 | 无 | update-transfer.ts:69-96；issue243-sa7-dynamic.test.ts:383 |
| 协议文档读者（§17/§18/§23 配置与事件面） | 四处已更新；§17 注记 = 单键门口径 | §17 注记改双激活键口径（与实现同轮） | 协议文档 §17 一处（§7-D8） | instance-replication-v1.md:558-569 |

## 11. 文件范围

iteration 0/1 已落地改动全部在本清单内（SA4 §5 文件范围审查核实）。**SA4-2 后续轮**（门放宽 + 契约补例 + 文档联动）只触碰带 ★ 的四行 + SA6 契约文件（后者不属本清单——契约修订经 owner/SA6 dispatch，见 §12 路由）。

### ALLOW LIST

| 路径 | 预期改动 | 原因 |
|---|---|---|
| `packages/ws-replication/src/types.ts` | 已落地：`ReplicationLimits` +2 键、`ReplicationTimeouts`/`ResolvedTimeouts` +`assemblyTimeoutMs`、事件联合 +`chunked-update-aborted{side,…}`（R12） | D1/D5 |
| `packages/ws-replication/src/defaults.ts` | 已落地：三缺省值 | D1 |
| `packages/ws-replication/src/validate.ts` | 已落地：两键正整数门 + timeout 门 + `validateChunkedTransferChain`；★ 后续轮：函数头注释「调用契约」段改双键门口径（L205-215） | D1 / SA4-2 |
| `packages/ws-replication/src/plugin.ts` | 已落地：`LIMIT_KEYS`+2、`TIMEOUT_KEYS`+1（SA4-2 零改动——Partial 保留使门放宽两路径自动对称） | D1（配置可达性） |
| `packages/ws-replication/src/hub-namespace.ts` | 已落地：TimerKind/`assembly` 槽、D2 门、D3 调用、`afterAssemblyAccept`/`endAssemblyScope`/`clearInboundAssembly(reason)`/`onAssemblyTimeout`/`emitChunkedUpdateAborted`、reason 全接线（含 R11 shed/fence）；SA4-1 置位修复（:721） | D2–D5 / SA4-1 |
| `packages/ws-replication/src/hub-connection.ts` | 已落地：`inboundAssemblySlots` Set + channelHost 两 facet + 构造期链门；★ 后续轮：门条件 OR `maxChunksPerUpdate`（L197-202） | D3 / SA4-2 |
| `packages/ws-replication/src/peer-namespace.ts` | 已落地：hub 侧对称 + `TIMER_DELAY_FIELD`/`onTimerFired` assembly 分支 + peer 特有收口入口置位（含 R11 fence 两入口）；SA4-1 置位修复（:704） | D2–D5 / SA4-1 |
| `packages/ws-replication/src/peer-connection.ts` | 已落地：对称槽位 + host 两 facet + 构造期链门；★ 后续轮：门条件 OR `maxChunksPerUpdate`（L111-116） | D3 / SA4-2 |
| `packages/ws-replication/src/update-transfer.ts` | 已落地：仅新增 `snapshot()` 访问器 | D5（构造签名不变是 D2 方案前提） |
| `docs/protocols/instance-replication-v1.md` | 已落地：§9.4/§13.2/§17/§18/§23.1 五处；★ 后续轮：§17 链生效口径注记改双激活键（L569） | R8（D8）/ SA4-2 |
| `packages/ws-replication/test/ws-replication-api.test-d.ts` | 已落地（iteration 0）：联合字面量 22→23 + 第 23 型字段（含 `side`）精确断言——类型面加宽的强制编译联动（SA4 O2 补登） | D5 类型锁定 |
| `packages/ws-replication/test/ws-replication-observer-red.test.ts` | 已落地（iteration 0）：1 处 `ResolvedLimits` 字面量补两新必填键——必填化强制编译修复、零断言语义变化（SA4 O2 补登） | D1 类型联动 |
| `packages/ws-replication/test/ws-replication-issue244-slot-reclaim-regression.test.ts` | 已落地（iteration 1，新增文件）：REG1–REG3 槽位归还回归（SA4 §9 SA4-1 Required change + dispatch 授权；SA4 O2 同款补登） | SA4-1 验收面 |

### DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
|---|---|---|
| `packages/ws-replication/test/ws-replication-issue244-ac-red.test.ts` | 验收契约本体 | SA6 冻结的转绿判据；实现轮不得改写断言——SA4-2 契约补例（R1c/N5/N6，§12）须经 owner/SA6 契约修订 dispatch 落笔，SA3 不得自行触碰 |
| `packages/ws-replication/test/ws-replication-issue243-*.test.ts`、`ws-replication-issue233-repro.test.ts` | 切片 2 绿灯套件/现状刻画 | 契约 §10「未触碰面」；D2 方案与 §7-D1 非追溯性裁决均以此保持其直接构造面不变（严格合并值校验将使其中 5 文件构造期 TypeError——被否方案 (b) 证据） |
| `packages/replication-protocol/**` | codec/错误码/词表 | 切片 1 冻结；`UPDATE_TRANSFER_EXPIRED` 已登记，本切片只发射 |
| `packages/ws-replication/src/update-channel.ts` | 发送端中止簿记 | AC6 基线绿（K7/K8/K9/S5/S7）；零需求 |
| `docs/adr/**`（含 0013） | 权威决策 | SA8 clear、无冲突；R10 裁决落协议文档即可；缺省 4MiB 冻结（§7-D1 被否方案 b″） |
| `CONTEXT.md` | 共享词汇 | 「分块复制传输」已覆盖，无新域词 |
| `packages/ws-replication/test/harness.ts` | CONTRACT_* 常量 | 仅字段读取用途、无全量比较（自 slice 2 已不含 maxChunkedUpdateBytes）；对齐注释可作 follow-up |
| `apps/**` | 组合根 | 新配置全有缺省，零宿主适配必需；`apps/yjs-server/test/issue164-sa7-dynamic.test.ts` 为 §7-D1 非追溯性证据（不动） |
| `packages/ws-replication/src/index.ts` | 公共导出面 | 新类型成员随既有导出自动可见，零导出改动 |

## 12. 验收与验证映射

| 需求或风险 | 现有证据 | 所需行为测试或动态场景 | 预期观察 |
|---|---|---|---|
| AC1 配置链/缺省/零 clamp（iteration 0 面） | R1a/R1b/N1 已转绿（SA3 iteration 1 实测 11/11，`artifacts/sa3-issue244-iter1-verify.log` §[4]） | 契约保持绿：`NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/ws-replication/test/ws-replication-issue244-ac-red.test.ts` | 11/11 绿（R1a/R1b/R2/R3/R4/R5a/R5b + N1–N4；后续契约补例后 14/14，见下 row） |
| **AC1 链生效口径（SA4-2 收口，需契约补例）** | 现行实现 = 单键门（§7-D1 边界表第 2 行族为静默缺口） | 契约文件补 3 用例（**SA6/owner 契约修订 dispatch 落笔，SA3 不得触碰冻结文件**；顺序 = 先契约后实现，保红→绿）：**R1c**（红灯）hub+peer 双入口 `{maxChunksPerUpdate: 4}`（其余缺省）→ 构造期 TypeError（链②：4MiB > 4×512KiB=2MiB）；**N5**（负控）`{...LIMITS}`（显式下调既有键、零分块族键）双入口构造不抛（非追溯边界显式锁定）；**N6**（负控）`{...LIMITS, maxConcurrentAssembliesPerConnection: 2}` 构造不抛（非链操作数键不激活链） | R1c 在现行单键门下红（恰证其锁的是本裁决口径）、SA3 门放宽（§11 ★）后绿；N5/N6 全程绿；R1a/R1b/N1 保持绿；补例后契约 14/14 |
| SA4-1 槽位归还闭环 | REG1–REG3 已落地且修复前红/修复后绿（SA3 iteration 1 §1.2/§4；`ws-replication-issue244-slot-reclaim-regression.test.ts`） | 回归文件保持绿：hub 入站 6 distinct ns 串行整笔（第 5/第 6 个 ns 正常收敛）/ peer 入站镜像 / peer 断线重连跨代际新 ns 收敛 | 6/6 收敛、零 VIOLATION、零 failed；REG 文件 3/3 绿 |
| AC2/AC3 count 分类与边界 | R2/N2 绿、K4 绿（totalBytes 维度既有） | 同上（R2/N2） | TOO_LARGE + failed + 零写入；==64 接纳 |
| AC3 并发超额（R10）+ W2 锁序（可选） | R4 绿 | 同上（R4）；可选：实现轮新增非契约用例注入「chunkCount>64 且 4 槽已满」帧 | victim VIOLATION+failed、4 健康 ns 收齐恰一次 apply、连接 ready；锁序用例断言 TOO_LARGE |
| AC4 滑动超时 + R7 timeout 事件 | R3/N4 绿（O1：两条停滞期断言前移至 deadline 前，文本逐字保留——SA4 实质审查不构成弱化） | 同上（R3/N4） | RESYNC{EXPIRED}（R14 三层组合断言）+ aborted{timeout,1 chunk} + 收敛 + 新写自愈；20s 前窗零误报 |
| AC5 + R7 teardown 事件 | R5a/R5b 绿（含 `side`） | 同上（R5a/R5b）；`side` 双侧断言与 shed/epoch-fence/GOAWAY/queue-overflow/resync-declared 五行动态断言归 SA7 | aborted{channel/connection-teardown} 恰一、零 failed、零写入 |
| AC6 发送端簿记 | K7/K8/K9、S5/S7 基线绿（契约 §4） | 全量回归保持绿（下 row） | 无回归 |
| AC7 零部分写入 | R2–R5 内嵌 + N3 哨兵绿 | 契约内嵌断言 | 文档 'seed'、saveEvents 差零 |
| 全局回归门 | SA3 iteration 1 实测：62 文件/448 测试全绿 + 包 tsc exit 0（verify.log §[5]/§[6]） | `pnpm exec vitest run packages/ws-replication/test` + `pnpm exec tsc -p packages/ws-replication/tsconfig.json`（SA4-2 门放宽后复跑——边界表取证为零存量绿面翻转） | 全绿（补例后 62 文件/451 测试）、typecheck 干净 |
| 根门（模块 AGENTS 验证纪律：wire/lifecycle 变更） | SA3 iteration 1 实测：根 `pnpm typecheck` exit 0、`pnpm test` 300 文件/3211 测试绿（verify.log §[7]/§[8]） | 根 `pnpm typecheck` + `pnpm test`（SA4-2 后续轮复跑） | 全绿 |
| R8 文档义务 + SA4-2 文档联动 | §9.4/§13.2/§18/§23.1 已落地；§17 注记现 = 单键门口径 | 实现随附 §17 L569 口径句改双激活键（§7-D8 第 1 条，与门放宽同轮）；`git diff --check` | 文档与行为一致（口径句与 §7-D1 边界表一致） |

SA1 不指定执行角色、不运行验证（实现/验证由后续角色承接）；SA4-2 的契约补例路由 = owner/SA6（契约文件 owner），门放宽/文档联动路由 = 实现轮，动态面路由 = SA7。

## 13. 风险、回滚和残余问题

**风险与缓解**

1. **新 30s timer 对既有虚拟时间测试的扰动**：已消解——iteration 0/1 全包回归绿（62 文件/448 测试）+ 根门绿（300 文件/3211）；timer 仅 busy 在场武装、每 chunk 重置、busy→idle 即清。后续若个别用例受影响，按用例语义复核（停滞即应中止——修期望不改机制）。
2. **槽位泄漏 → 未来合法 transfer 误 VIOLATION**：iteration 0 曾实际发生（SA4-1：镜像旗标漏置位 → 归还死代码）；**已修复**——获取侧同步置位（hub:721/peer:704）+ REG1–REG3 回归锁定（修复前红/修复后绿，含 hub/peer 两方向与 peer 跨拨号代际）；busy→idle 出口封闭枚举不变（§8.2 不变量）。
3. **链生效口径的口径漂移**（SA4-2 后续轮执行期）：门放宽须与契约补例（R1c/N5/N6）、协议 §17 注记**同轮或先契约后实现**落地——任何一方单方推进都会重现「设计-实现-文档-契约」四方口径劈叉（本轮 SA4-2 的教训本身）；缓解：§11 ★ 行 + §12 路由与顺序已写死，R1c 在单键门下红即为顺序守卫。
4. **事件双发/漏发**：busy 守卫 + 一次性 reason 记忆位（conflicted 族 fence 发射/failed 族不发——carve-out §7-D5）；R5a/R5b 断言恰一；五行动态断言归 SA7。
5. **超时帧与收口竞态**：closing/终态同步段先杀 timer（既有 clearAllTimers 纪律延伸到新 kind）；fire 后通道已 quiet → 只丢弃零 wire。
6. **公共类型面加宽**：append-only（§23 纪律）；消费方无穷举 switch 破坏面（§10 已核）；test-d 精确联合锁定。

**回滚**：改动面内聚于接收端准入/超时/事件与配置校验；任一子面可独立 revert（配置键缺省自洽；事件/超时/门互不依赖持久化或 wire 兼容性——新 reasonCode 已登记，旧对端按未知 reason 通用收口处理，§9.4 既有规则）。SA4-2 门放宽本身可独立 revert（revert 后 R1c 红、N5/N6/R1a/R1b/N1 仍绿——不破坏其他面）。

**残余（非本切片必要条件）**

- **SA4-2 执行残余（本轮设计已收口、实现待后续轮）**：门放宽（hub/peer 构造器 + validate.ts 注释）、契约补例 R1c/N5/N6（owner/SA6）、协议 §17 口径句（§11 ★/§12 路由）。
- **语义残余（有意接受，§7-D1 登记）**：「仅显式下调既有键 + 缺省 envelope」族构造期不校验链——运行期各路径有界且响亮（TOO_LARGE/既有 shed/needs-resync），构造期信号为非目标（非追溯性）。
- `shed`/`epoch-fence`/GOAWAY/queue-overflow/resync-declared 五行事件**动态断言** + `side` 双侧覆盖 + 跨窗滑动形态（chunk1@T+20s、chunk2@T+40s）→ SA7（wiring 已全部落地）。
- `resync-required` observer 事件是否为超时行扩 cause（append-only；本行信号 = aborted 事件 + wire 帧，非缺口）。
- `chunked-update-sent/applied/acked` 三型 → #245（R7 裁决）。
- #245 body 措辞同步（四型 → 三型 + 引用 #244 aborted；owner/总控域，SA2 R11-d 移交项）。
- harness `CONTRACT_*` 常量注释对齐（无测试依赖）。
- 若父 PR #241 方向性返工 → 复审本设计与契约（SA8 R9 条件项）。

**任务内无未解决的必要条件**（无阻塞；SA4-2 的实现/契约/文档联动为已路由的后续轮工作，非设计缺口）。

## 14. 评审修订映射（iteration 1；SA2 设计评审 + SA4 实现评审逐条）

| Finding | 修订位置 | 处理结果 |
|---|---|---|
| SA2-R11（shed/epoch-fence wiring 拉回 #244 + 非 live shed 分支澄清 + conflicted 族 carve-out + #245 措辞移交） | §1 非目标、§6 表 R11 行、§7-D5 接线表 + carve-out、§8.3 表、§13 残差 | 已落地（iteration 0 实现锚点：hub:1022/peer:1201、hub:980-982、peer:861-863+1505-1506——SA4 静态核对成立）；设计文本同步收口（删「本切片不接线」） |
| SA2-R12（第 23 型补 `side`） | §7-D5 类型字面量、§10 事件行 | 已落地（types.ts:677-680 + test-d 精确断言）；设计字面量同步 |
| SA2-R13（GOAWAY = connection-teardown 口径统一） | §1 非目标、§7-D5 表、§8.3 表 | 已落地；三处文本统一为单一口径（断言归 SA7） |
| SA2-R14（R3 断言措辞按契约实文） | §7-D4 独立发射点段 | 措辞改为三层组合断言 |
| SA2-W1（peer 无 submit 门） | §8.1 首行注释 | hub/peer 前置序分列 |
| SA2-W2（准入序口径矛盾） | §7-D3 准入序裁决段 | 单一权威口径：D2→D3→accept、双违例帧按 D2 分类；§12 增可选锁序用例 |
| **SA4-1（BLOCKER：`assemblySlotHeld` 永不置位 → 归还死代码 → 槽只增不减）** | §8.1 伪码、§8.2 不变量段、§11/§12 回归行 | **已修复**（SA3 iteration 1：hub:721/peer:704 置位 + REG1–REG3 修复前红/修复后绿）；设计 §8.1 伪码补 `this.assemblySlotHeld = true;` 一行、§8.2 不变量补获取侧置位——**仅保真同步，不重新设计该修复（dispatch 指令）** |
| **SA4-2（MAJOR：链生效口径与批准设计相悖且 AC1 链对整族配置静默失效）** | **§7-D1（核心裁决）、§2.1、§5、§7-D8、§10、§11（★ 行）、§12（R1c/N5/N6 + 路由）、§13、§15** | **本轮收口**：裁决 = 分块族链上键显式表达门（`maxChunkedUpdateBytes ∨ maxChunksPerUpdate`，合并结果校验）；现行单键门为不完整实现（族内缺口 = 被否方案 a-min）；路由 = 契约补例（owner/SA6，先行）→ 门放宽 + validate 注释 + 协议 §17 口径句（实现轮，同轮）→ SA4/SA7 复核 |
| SA4-O1（R3 断言重排） | §12 AC4 行 | 登记为 SA3 裁决（SA4 实质审查不构成弱化；断言文本逐字保留） |
| SA4-O2（测试文件超 ALLOW 补登） | §11 ALLOW LIST | 补登三文件（api.test-d / observer-red / slot-reclaim-regression）及理由 |
| SA4-O3（验证留痕缺口） | §12 各行证据列 | SA3 iteration 1 已附 `artifacts/sa3-issue244-iter1-verify.log` 逐命令输出 |
| SA4-O4（死代码注释失实） | — | SA4-1 修复后注释自然转真（peer-connection.ts:95-98 等随置位修复成立），零设计动作 |
| SA4-O5/O6（移交面 / 文档联动） | §13 残差、§7-D8 第 1 条 | O6 = §17 口径句随 SA4-2 联动（本轮已规格化）；O5 移交项在 §13 登记 |

## 15. 是否需要设计后 ADR 冲突复查

**需要（`requiresConflictRecheck: true`）——一项窄复查**。iteration 0 的 R7/R8 取舍复查已由 SA8 设计后复审履行且 clear；本轮新增需复查面只有：**§7-D1 对 ADR 0013 L71 配置表约束列的执行口径解释**——ADR 约束列无条件表述「`maxChunkedUpdateBytes` ≤ `maxQueuedUpdateBytes`；≤ `maxChunksPerUpdate × maxUpdateBytes`」，本轮裁决把其构造期强制执行限定在「显式表达分块族链上键」时生效（缺省自洽由 DEFAULT 构造成立、仅显式既有键不激活——非追溯性，冻结契约钉死）。该解释不改变约束本身（缺省值满足两链、表达即受约束），但属对既有已批准决策（iteration 0 D1）的修订 + 协议 §17 规范文本口径句改写，请 SA8 核对：与 ADR 0013 L69-76 配置表的执行语义是否构成口径冲突；若判冲突，出路 = 修订 ADR 0013 约束列措辞（owner 域）或回到被否方案 (b)（须同步修订冻结契约与约 21 个存量套件——代价证据链见 §7-D1）。
