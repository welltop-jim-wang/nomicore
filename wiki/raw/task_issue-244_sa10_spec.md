# SA10 独立 Spec 审查报告 — issue #244：分块传输有界性加固与中止清理矩阵（issue #233 切片 3，最终未提交 diff 态）

- **阶段**：spec-review（SA10，iteration 0）| **Dispatch**：`sa-30c54186-bebf-4b31-8aea-74c10eff87c5`（mabf-sa10 / spec-review / iteration 0）
- **审查对象**：worktree `nomicore-fix-issue-244` 当前**未提交**工作树 diff（12 tracked 修改文件 + 2 新测试文件 untracked），基线 HEAD = `e2178f3743c5dd9bb76f880c87b78ff6c1ec5c6d`（`git rev-parse HEAD` 与 `origin/feat/issue-233-chunked-update-base` 实测一致——父 PR #241 权威基线，与 dispatch 声明逐字相符）；分支 `mabf/issue-244`。
- **Issue 评论快照**：REST `[]`（`wiki/raw/task_issue-244_dispatch.md` 实测）——**零 owner 要求**，需求面 = Issue 正文 AC1–AC7。
- **Verdict**：**approve**
- **输入（全部实读）**：Host 简报 `task_issue-244.md`（AC1–AC7 原文）；SA1 设计 `task_issue-244_design.md`（iteration 1，507 行全文）；SA2 `task_issue-244_sa2_review.md`（approve；R11–R14/W1/W2）；SA6 `task_issue-244_sa6_contract.md`（iteration 1，14 用例）+ 契约测试全文（1134 行逐段核读）；SA3 `task_issue-244_sa3_report.md` + `_r2.md`；SA4 `task_issue-244_sa4_review.md`（iteration 1 复审 approve）；SA8 三轮 clear（`artifacts/sa8-conflict-gate-issue-244{,-design,-design-recheck}.md`）；三方验证日志（`artifacts/sa3-issue244-iter{1,2}-verify.log`、`artifacts/sa6-issue244-iter1-verify.log`）；ADR 0013 冻结面 + `docs/protocols/instance-replication-v1.md` 现行 diff；最终 diff 全量逐文件（9 src + 1 协议文档 + 2 tracked 测试 + 2 untracked 测试）。
- **独立性声明**：未采信任一上游结论为前提。AC1–AC7 逐条回源至简报正文与最终 diff 源码；SA4 所引锚点（hub-namespace.ts:721 / peer-namespace.ts:704 置位、hub-connection.ts:200-206 / peer-connection.ts:114-120 双键门、validate.ts 链函数）逐点实测复核零漂移；双键门兼容性经全仓独立 grep 重验（不依赖 SA8 Q2 取证）；动态证据仅引用既有留盘日志并标注基准态——本角色不运行测试、不启动服务、不改动任何非评审输入。

---

## 1. 验收标准逐条判定（Issue #244 正文 AC1–AC7）

| # | 验收标准（简报原文口径） | 判定 | 独立核验证据（最终 diff 锚点） |
|---|---|---|---|
| AC1 | 四配置缺省 + 启动期校验链（`maxChunkedUpdateBytes ≤ maxQueuedUpdateBytes` 且 `≤ maxChunksPerUpdate × maxUpdateBytes` 等）生效，非法配置构造期 TypeError，零运行时 clamp | ✅（按 SA4-2 批准口径，见 §3-D1 披露） | 缺省 4MiB/64/4/30_000 在册（defaults.ts:28-31,47）；值门无条件对合并结果（validate.ts:152-155 两键 ≥1、:243 timeout 有限正整数——`positiveSafeInteger` 构造期 throw）；跨字段链①②抽为 `validateChunkedTransferChain`（validate.ts:220-231）对 **resolved 合并结果**判定；激活 = **双键显式表达门**（hub-connection.ts:200-206 / peer-connection.ts:114-120，`hasOwnProperty('maxChunkedUpdateBytes') \|\| hasOwnProperty('maxChunksPerUpdate')`，实测逐字在码）；构造器调用序值门先于链（两构造器实测）；`resolveLimits/resolveTimeouts` 整值替换合并、零 clamp（defaults.ts:58-67）；plugin 路径 `mergeNested` 只合并用户 Partial（plugin.ts:214-217 实读）→ 显式性探测两路径语义一致。契约 R1a/R1b/R1c（抛）+ N1/N5/N6（不抛）六用例锁定边界 |
| AC2 | 恶意 totalBytes/chunkCount（巨大/不一致声明）不导致无界分配；分配只发生在首 chunk 校验通过之后 | ✅ | count 维度 = D2 控制器门（hub-namespace.ts:707-709 / peer-namespace.ts:690-692，`>` 判定保 ==64 边界，先于槽获取与 accept）；totalBytes 维度 = assembler `validateFirst`（update-transfer.ts:180-182，切片 2 既有）+ 几何一致（:183-185）；全部校验先于 `new Uint8Array(totalBytes)`（:133）；跨帧逐字节一致由 assembler busy 分支强制（:146-149，漂移 → VIOLATION）。R2（65_536 拒）/N2（==64 纳）契约在案 |
| AC3 | 元数据违例与并发超额 → UPDATE_TRANSFER_VIOLATION（fatal，terminal failed）；声明超资源上限 → UPDATE_TRANSFER_TOO_LARGE（fatal，config-retryable，terminal failed） | ✅ | D2 → TOO_LARGE；D3 并发槽 `tryBeginInboundAssembly` false → VIOLATION（hub-namespace.ts:714-716 / peer-namespace.ts:697-699）；两码经 `transferViolation` 单点 → ns ERROR + `finalize('failed','protocol-violation')`（hub:763-769 / peer 同构）；准入序 D2→D3→置位→accept 符 W2 单一权威口径；两码注册表语义（fatal / retryable no·config / terminal failed）在 slice-1 冻结面（replication-protocol/errors.ts:138-139）零 diff |
| AC4 | assembly 停滞超 assemblyTimeoutMs（进度滑动 deadline）→ 弃 partial + RESYNC_REQUIRED{UPDATE_TRANSFER_EXPIRED}，对端按既有规则收口并收敛 | ✅ | TimerKind +`'assembly'`（hub:99 / peer:100,110）；每 chunk 经 `afterAssemblyAccept` 重置滑动 deadline（hub:728-734 / peer 同构，busy 分支亦包装——hub:676 / peer:665）；`onAssemblyTimeout`（hub:1548-1565 / peer:1825-1848）：busy 守卫 → `clearInboundAssembly('timeout')`（弃 partial + 还槽 + 清 timer + aborted{timeout}）→ quiet 防御 → 独立发射点 `sendChecked RESYNC_REQUIRED{UPDATE_TRANSFER_EXPIRED}`（不并入硬编码 send-queue-overflow 的 resync 漏斗——正确裁决）→ needs-resync + resyncEpisode；peer 尾行 `maybeStartRecovery()`；`clearAllTimers` 双侧含 'assembly'（hub:1576 / peer:1851）；peer `onTimerFired` 终态防御先于分派（peer:1855）。R3（三层组合断言：EXPIRED toContain + peer remote-declared 恰一 + 零续传）/N4（20s 前窗零误报 + 释放后收敛）契约在案 |
| AC5 | 中止矩阵全覆盖：连接 shed、队列溢出、收 RESYNC_REQUIRED、CLOSE_NAMESPACE、GOAWAY drain、断线、epoch fence——partial assembly 全部丢弃，恢复经 reconciliation 收敛 | ✅ | 丢弃面七行全部经 `clearInboundAssembly(reason?)` 单点（hub:786-804 / peer:769-787）：收 RESYNC → `'resync-declared'`（hub:862 / peer:613）；本端 wire 声明漏斗按 cause 判别 `'shed'/'resync-declared'`（hub:1022 / peer:1201——queue-overflow/send-failed/ack-timeout 归 resync-declared，connection-shed 归 shed）；round 结算残渣（hub:1276 / peer:1128）；CLOSE_NAMESPACE → `teardownAbortReason='channel-teardown'`（hub:828 / peer:802+901）；断线/GOAWAY/stop → `'connection-teardown'`（hub:916 `onConnectionClosed` / peer:1010,1055,1072 三入口）；epoch fence → `'epoch-fence'` 三入口（hub:982 oneShotTerminal / peer:863 onIdentityChanged / peer:1506 applyOutcome fence）；收口链消费一次性记忆位（hub:1408-1411 / peer:1667-1670）。R5a/R5b 契约红灯面在案；非 live shed 只置 pendingResync = SA2-R11 批准的设计裁决（合法跨 round 流量非缺口） |
| AC6 | 发送端中止簿记：zombie seq 吸收迟至 ACK，窗口槽正确释放，后续 transfer 可正常发起 | ✅（基线面，零改动） | `update-channel.ts` **零 diff**（git diff --name-only 实测不在改动集）——zombie/discardQueued→clearActiveTransfer/effectiveInFlightCount 全部切片 2 既有绿；R3 自愈尾断言（中止后新写正常收敛）覆盖 AC6 联动面 |
| AC7 | 全部中止/违例路径下 live Y.Doc 零部分写入 | ✅ | 结构性：apply 只在 assembler `complete`（Σbytes 精确核对，update-transfer.ts:164-172）后经既有 sequenced 管线（hub:744-750）；全部新拒绝/中止路径先于分配（D2/D3）或先于 apply（clear 只 reset 不 apply）；R2–R5 内嵌 'seed'/saveCount 断言 + N3 恰一次 apply 哨兵 + REG saveDelta===1 |

## 2. SA6 十四用例可执行契约核对（`ws-replication-issue244-ac-red.test.ts`，1134 行全文核读）

- **用例集闭合**：R1a/R1b/**R1c**/R2/R3/R4/R5a/R5b + N1/N2/N3/N4/**N5**/**N6** = 恰 14 用例（`it(` 逐一核名），与 SA6 iteration-1 契约 §12 表逐行一致；iteration-0 的 11 用例断言层与契约报告描述逐字相符（补例 diff = 头注记 + 3 新用例，冻结面零改动）。
- **断言质量**：全行为断言（wire 帧码/observer 事件/持久化计数/状态机态）；零源码 grep/字符串断言；**无 skip/only/todo**（`.skip(/`.only(/`.todo(` 模式零命中实测）；R1c 内嵌期望值自检（冻结缺省 4MiB>4×512KiB 关系）+ 双键显式反证——红精确落在激活键集、防 fixture 漂移伪红；N5 内嵌零分块族键逐键断言 + 合并违链①探针（防空转）；fixture 逐测试 stop 收尾。
- **运行入口真实**：文件在 `packages/ws-replication/test/`，根 `vitest.config.ts` include 自动发现；SA6/SA3 日志均示 vitest 实际收集 14 用例（`Type Errors no errors`）。
- **回归面**：`ws-replication-issue244-slot-reclaim-regression.test.ts`（442 行，REG1–REG3）全文核读——6 distinct ns 串行整笔（hub 入站）/ peer 入站镜像 / peer 断线重连跨代际三面；每笔断言 ≥2–3 帧 + 单 transferId（chunked 路径真实走通，否则槽位门不被触发）；谓词以「收敛或违例」终止防伪红挂起。

## 3. SA1/SA2 设计决策与 SA4 批准落实（逐决策 diff 实证）

| 决策 | 判定 | 证据 |
|---|---|---|
| D1 配置面（含 **SA4-2 双激活键门口径**） | ✅ 忠实 | §1-AC1 行；边界语义表五行逐行有契约锁定（R1a/R1c/N1/N5/N6）；validate.ts:205-219 函数头注释与协议 §17 L569 口径句均双键表述（grep 实测 src/协议文档零单键残留） |
| D2 count 准入门（`>` 保 ==64；控制器层落点保 issue243-sa7-dynamic 直构面） | ✅ 忠实 | hub:707 / peer:690；`UpdateChunkAssembler` 构造签名不变（update-transfer.ts:79 两键字面量） |
| D3 连接级槽位（Set + 两 facet + 幂等）+ **SA4-1 置位修复** | ✅ 忠实 | hub-connection.ts:466-469,521-533 / peer-connection.ts:95-99,146-155（`has`→true / 满额 false / `delete` 幂等）；**置位锚点实测：hub-namespace.ts:721 / peer-namespace.ts:704 逐字在码**（SA4 复审锚点零漂移）；归还单点 `endAssemblyScope`（hub:774-779 / peer:754-760）；出口封闭枚举（complete/首违例经 afterAssemblyAccept；busy 违例/超时/全挂点经 clearInboundAssembly；**全部终局路径**经 finalize→settleClose/cleanupResources→收口体同步段——hub:1306-1355→1387+ / peer finalize→cleanupResources→runDisposal:1662+ 实测链路） |
| D4 滑动超时（独立发射点、不触碰 resyncDeclared、不发 resync-required 事件） | ✅ 忠实 | §1-AC4 行；hub 版尾行零 `maybeStartRecovery`、peer 版有之——与设计伪码差异逐字一致；超时后第二重 quiet 防御（sendChecked 失败已 finalize）为纯防御加固（严格更保守，SA4 已核） |
| D5 第 23 型事件 + 六 reason 接线 + busy 守卫 + observerOn 门 + 快照先于 reset + 决策落定后发射 + failed 族 carve-out（fence 发射/failed 不发） | ✅ 忠实 | types.ts:660-683（联合第 23 型 + `side: ReplicationObserverSide`——R12）；update-transfer.ts:88-99 `snapshot()`（idle→undefined）；clearInboundAssembly 快照门 = `reason!==undefined && observerOn && busy`（hub:787-790 / peer 同构）；发射侧字面量 hub:'hub' / peer:'peer'；failed 族 clear 无 reason（transferViolation 调用点实测） |
| D6 发送端/codec/状态机迁移零改动 | ✅ 成立 | `git diff --name-only`：update-channel.ts、replication-protocol/**、src/index.ts、docs/adr/** 零命中 |
| D7/D8 协议文档五处 + §17 二轮口径句 | ✅ 忠实 | §9.4 EXPIRED 行发射点注记 / §13.2 两码发射点注记 / §17 配置块+链块+**双激活键口径句**（与设计 §7-D8 第 1 条逐字一致）/ §18 timeout 清单行 / §23.1 第 23 型登记行（含 GOAWAY 归并、恰一计数不变量、#245 计划项措辞为计划非行为）——diff 全文核读 |
| SA2 R11（shed/epoch-fence 拉回 #244）/ R12（side）/ R13（GOAWAY=connection-teardown）/ R14（R3 三层断言措辞）/ W1（peer 无 submit 门）/ W2（D2→D3→accept 单一序） | ✅ 全落实 | 接线点 §1-AC5 行逐一在码；R3 契约断言 = toContain(EXPIRED)+remote-declared 恰一+续传恰一（测试 :809-839 实读）；peer 侧首 chunk 管线实测无 submit 门（peer:685-705） |

## 4. 双键校验兼容性独立复核（dispatch 专项）

- **全仓构造点 grep（独立重验，不引 SA8 取证）**：经构造器表达分块族链上键的现存调用点 = `issue243-chunked-live` K3（`{...LIMITS, maxChunkedUpdateBytes: 6KiB}`：6KiB ≤ 1MiB ∧ ≤ 64×8KiB=512KiB，链满足）、K4（hub 10KiB 同满足）；`issue243-sa7-dynamic:72-79` 经 `resolveLimits` 直构（不过构造器门）；observer-red:748-750 为 `ConnectionSenderHost` 直构字面量（不过门，且已补两新必填键 = 必填化编译联动）。**零现存绿面被双键门翻转**——与 SA3 iter2 全包 62/451 绿日志互证。
- **apps/ 面**：`apps/**` 四分块族键 grep 零命中——零宿主适配必需，组合根零破坏。
- **非追溯边界**：N5（`{...LIMITS}` 零分块族键不抛）/N6（并发键不激活）锁定；表达式语义固有性质（显式 =缺省值亦激活）已在设计 §7-D1 边界表行 1/2、SA8 R17、SA4 O2 三方登记——响亮方向非静默。

## 5. 验证证据链（留盘日志交叉核对；SA10 自身不运行测试）

| 日志 | 关键记录 | 一致性 |
|---|---|---|
| `artifacts/sa3-issue244-iter1-verify.log` | REG 修复前 3 failed（逐例 ns-e 误 VIOLATION）→ 修复后 3/3；契约 11/11；全包 62/448；根 300/3211；包/根 tsc exit 0 | 数字链自洽（448 = 445 + REG 3） |
| `artifacts/sa6-issue244-iter1-verify.log` | 基线 11/11 → 补例后 1 failed(R1c)/13 passed ×3 确定性；全包 450/451 唯一失败 = R1c | 448+3=451 衔接 ✓；R1c 红 = 落地序守卫，与现行码单键门历史态吻合 |
| `artifacts/sa3-issue244-iter2-verify.log` | 修复前红自证 1/13 → 契约+REG 17/17 ×3；全包 62/451；根 300/3214（3211+3 衔接 ✓）；包/根 tsc exit 0；`git diff --check` 0 | 三方日志闭环；本评审 `git diff --check` 独立复跑 = clean |

## 6. 必须披露的未达成/残留项（PR 披露义务）

- **D1（AC1 生效口径，批准内裁决——须披露不得呈现为疏漏）**：跨字段链①②的构造期强制执行限定于「调用方显式表达 `maxChunkedUpdateBytes` **或** `maxChunksPerUpdate`」时激活（SA4-2 → SA1 iteration-1 §7-D1 → SA8 design-recheck clear → SA6 R1c/N5/N6 → SA4 approve 的完整授权链）。「仅显式下调既有键 + 缺省 envelope」族构造期**不**校验链——有意接受的非追溯性残余（严格合并值校验将使冻结契约 9 用例 + 约 21 个存量绿灯文件构造期 TypeError，被否方案 (b) 代价证据链在案）；该族运行期仍受 envelope/count/槽位三上界与发送侧既有拒纳/shed 封顶，无有界性缺口。协议 §17 口径句与实现逐字一致。
- **D2（已路由动态面，wiring 已完整落地）**：shed / epoch-fence / GOAWAY / queue-overflow / resync-declared 五行的 aborted 事件**动态断言**、`side` 双侧覆盖、跨窗滑动形态（chunk1@T+20s/chunk2@T+40s）归 SA7（设计 §13 / SA6 §15 / SA4 §10 一致登记）；本切片契约已动态覆盖 timeout/channel-teardown/connection-teardown 三行（R3/R5a/R5b）。
- **D3（流程披露）**：SA10 不运行测试——§5 动态证据全部为上游留盘日志（基准态 = 当前工作树，SA3 iter2 为最终态证据）；PR/CI 必须重跑根级 `pnpm test` + `pnpm typecheck` 收口。
- **D4（owner/总控域移交项）**：#245 body 措辞同步（四型 → 三型 + 引用 #244 已交付的 aborted；SA2 R11-d）；父 PR #241 方向性返工则复审本设计与契约（SA8 R9 条件项，当前 #241 基线稳定未触发）。

## 7. 非阻断观察（MINOR，不阻断 approve）

- **O1**：`ChunkedUpdateAbortReason` 别名经 types.ts 模块级导出但不经 `src/index.ts` 重导出（#256 的 `ReplicationNamespaceFailedCause` 先例做了重导出）——设计 DENY 显式裁决「index.ts 零导出改动」、消费方经 `ReplicationObserverEvent` 联合结构性获得全类型；test-d 按结构展开比对已锁定。纯 API 人体工学备注。
- **O2**：hub/peer `onAssemblyTimeout` 在 `sendChecked` 后追加第二重 quiet 防御（设计伪码未含）——严格更保守的加固（send 失败已 finalize 时零复活），SA4 复审已核，非偏离。
- **O3**：中止型槽位归还 caller（timeout/teardown）后「新 distinct ns 首 chunk 接纳」无专属回归用例（SA4 §11-O1 同款登记）——中止型与完成型 caller 汇入同一 `clearInboundAssembly → endAssemblyScope` 单点（同一守卫、同一 Set.delete），REG1–REG3 锁定完成型 + 跨代际；建议随 SA7 动态面补一例，非本轮阻断。
- **O4**：表达式语义固有性质（显式 =缺省值亦激活链，如 `{...LIMITS, maxChunksPerUpdate: 64}` 将抛）——hasOwnProperty 触发的固有性质，设计边界表行 1/2 + SA8 R17 + SA4 O2 三方文档化；误伤方向为响亮（构造期 TypeError）非静默。

## 8. Scope 与文件范围核对（scope creep 判定）

- 12 个 tracked 修改文件全部在设计 §11 ALLOW LIST 在册（9 src + 协议文档 + api.test-d + observer-red——后两者经 iteration-1 §11 补登）；2 个 untracked 新测试文件 = SA6 契约（owner/SA6 dispatch 路由，对 SA3 为 DENY 而 SA6 落笔合规）+ SA4-1 回归文件（dispatch + SA4 §9 授权 + §11 补登）。
- **DENY 面零触碰实测**：`git diff --name-only -- packages/replication-protocol packages/ws-replication/src/update-channel.ts docs/adr CONTEXT.md apps packages/ws-replication/src/index.ts packages/ws-replication/test/harness.ts packages/ws-replication/test/ws-replication-issue{233,243}-*.test.ts` = 0 行。
- 无越权调度、无未授权 ADR/CONTEXT 改动、无 scope creep。

## 9. 结论

**Verdict：approve。** Issue #244 正文 AC1–AC7 在当前未提交 diff 中忠实达成（AC1 按 SA4-2 完整授权链批准的双激活键口径）；SA6 十四用例可执行契约逐条在案且断言面无弱化；SA1/SA2 全部设计决策（D1–D8、R11–R14、W1/W2）与 SA4 两项前轮 finding（SA4-1 槽位归还闭环 / SA4-2 链生效口径）的实现落点逐一实测在码、锚点零漂移；超时/中止行为、有界准入（分配前二维声明门 + 连接级槽位）、槽位回收（获取-归还闭环 + 全终局路径兜底 + 跨代际卫生）、双键校验兼容性（零存量绿面翻转独立重验）四面均成立；文件范围全在批准 ALLOW 内、DENY 零触碰。残留项均为披露性质（§6-D1/D2/D3/D4）或非阻断 MINOR（§7），无 unmet/partial 的关键 AC。

- 产物：`wiki/raw/task_issue-244_sa10_spec.md`（本报告）；证据引用——`artifacts/sa3-issue244-iter1-verify.log`、`artifacts/sa3-issue244-iter2-verify.log`、`artifacts/sa6-issue244-iter1-verify.log`（留盘日志，基准态 = 当前工作树）。
