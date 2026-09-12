# SA9 标准评审 — Issue #244（issue #233 切片 3：分块传输有界性加固与中止清理矩阵）

- Dispatch：`sa-9b0fe155-58fb-421c-8f25-35b8523d0fac`（mabf-sa9 / standards-review / iteration 0；final 组）
- 评审对象：worktree `nomicore-fix-issue-244`（branch `mabf/issue-244`，权威 base `feat/issue-233-chunked-update-base@e2178f3743c5dd9bb76f880c87b78ff6c1ec5c6d`，dispatch 声明 freshly fetched 且稳定）**SA4 approve 后的最终未提交 diff**：12 tracked 修改（9 src + 协议文档 + 2 测试文件）+ 2 新测试文件（SA6 契约 14 用例 + SA4-1 回归 3 用例）
- 输入链：SA8 前置门禁（clear，C1–C8/R7–R10）→ SA6 契约 iteration-0（approve，11 用例红灯）→ SA8 设计后复审（clear，R11–R14）→ SA2（approve，R11–R14 裁决 + W1/W2）→ SA3 iteration-0/1（SA4-1 槽位归还修复，62/448 + 根 300/3211）→ SA4 iteration-0（reject：SA4-1 BLOCKER + SA4-2 MAJOR）→ SA1 设计 iteration-1（§7-D1 链生效口径裁决）→ SA8 设计修订复审（clear，R15–R19）→ SA6 契约 iteration-1（approve，+R1c/N5/N6 = 14 用例，红→绿证据链）→ SA3 iteration-2（SA4-2 双键门收口，62/451 + 根 300/3214）→ **SA4 iteration-1（approve，0 BLOCKER/MAJOR）**
- Owner 要求：dispatch 声明 Issue #244 评论 REST 快照 `[]`——**无 owner 衍生要求适用**；需求面 = issue body AC1–AC7（需求完整实现判定归 SA10，本评审只判标准符合性）
- 结论：**approve** —— 0 BLOCKER、0 MAJOR；3 项 MINOR（非阻塞登记，§6）。代码、测试、协议文档与已批准设计/契约全部符合仓库 AGENTS/ADR/模块责任/架构惯例/单一事实源/生命周期对称/文件范围/测试质量标准
- 方法：独立实读全部 14 个交付文件的 diff/全文与两新测试文件关键面（非仅复核上游结论）；静态判据自行 grep 复验（RESYNC 发射点全集、clearInboundAssembly 挂点全集、skip/only、diagnostic 触点、index.ts 导出面）；finalize→收口调用链沿源码实读；`git diff --check` 复跑 exit 0；未运行测试、未启动服务、未改任何文件（SA9 纪律）

## 1. AGENTS 与架构契约符合性

| 标准面 | 证据（本席独立实读/grep 复验） | 判定 |
|---|---|---|
| 根 AGENTS「Instance replication」（ADR 0010 + 协议文档为权威） | 实现逐条对齐 ADR 0013（SA8 三轮判定的现行约束）：接收端规则（L58 清理集/L59 首 chunk 校验/L62 并发上限/L63 滑动超时）全部落地——D2 count 门（hub-namespace.ts:707-709 / peer-namespace.ts:688-692，`>` 保 ==64 边界）+ D3 连接级槽位 + D4 滑动 deadline + D5 中止事件；配置表（L69-74 名/缺省/约束逐字）；错误码族（L80）；observer seam（L92 域键集逐字 + §23 side 信封）；非目标（零 durable partial/零逐片 apply/零 maxUpdateBytes 提高）逐条保持 | 符合 |
| ADR 0013 L71 链约束执行口径 | 链①②在 `validateChunkedTransferChain`（validate.ts:220-231）对**合并结果**判定；激活 = 双构造器 `hasOwnProperty('maxChunkedUpdateBytes') \|\| hasOwnProperty('maxChunksPerUpdate')` 显式表达门（hub-connection.ts:200-206 / peer-connection.ts:114-120）——ADR 未冻结激活语义，SA8 design-recheck §2 判该解释为相容执行口径（缺省自洽 4MiB ≤ 4MiB ∧ ≤ 64×512KiB=32MiB；唯一替代读法与冻结契约逻辑不相容的反向验证在册）；冻结契约 R1a/N1/R1c/N5/N6 五用例钉死边界 | 符合 |
| 包 AGENTS「Route namespace ownership…transport layer never reaches into Runtime」 | 收齐后 `void this.applyRemoteUpdate(result.bytes, sequence)`（hub:749 / peer 同构）复用既有管线；diff 全文零 Runtime/Persistence/Y.Doc 内部触达 | 符合 |
| 包 AGENTS「Keep admission bounded」 | D2/D3 两门均先于 `assembler.accept`（分配点）；分配只按已验证上界（`new Uint8Array(totalBytes)` 在 validateFirst 全过后，update-transfer.ts:128-143）；内存上界 = `maxConcurrentAssembliesPerConnection × maxChunkedUpdateBytes`（count 门 + totalBytes 门 + 槽位三合成，ADR L76） | 符合 |
| 包 AGENTS「Preserve protocol ordering and FSM invariants」 | 零状态机迁移新增：超时行复用 `needs-resync` + `resyncEpisode`（hub:1563-1564 / peer:1845-1847）；违例行复用 `finalize('failed')`；terminal 通道重开仍只经 addTarget 重建（既有不变量未动） | 符合 |
| 包 AGENTS「injected transport/scheduler/observer seams」 | assembly timer 经注入 `host.timer`（虚拟时钟可驱动，hub:1534 / peer TIMER_DELAY_FIELD:110）；事件经 `dispatchReplicationObserver` 隔离单点（hub-connection.ts:535 / peer-connection.ts 同构）；`observerOn` 门——无 observer 零快照零构造（hub:787-789 / peer:767-769 实读） | 符合 |
| 包 AGENTS「Export production APIs through src/index.ts」 | `index.ts` 零改动（git status 实证）；事件联合经既有导出携带；**别名 `ChunkedUpdateAbortReason` 未经 index 重导出**（与 #256 `ReplicationNamespaceFailedCause` 先例不一致——见 §6 M1） | 符合（M1 登记） |
| 包 AGENTS 验证门（wire/lifecycle 变更 → 包 tsc + 根 typecheck + 根 test） | SA3 iter2 日志在册：全包 62 文件/451 测试绿、包 tsc exit 0、根 typecheck（14 项目）exit 0、根 test 300 文件/3214 测试绿；与 SA6 iter1（450/451 唯一失败 = R1c 红守卫）数字链自洽（448 → 451 → 451） | 符合 |
| 根 AGENTS 诊断日志纪律 | `git diff` 全文 grep `diagnostic` 零命中——零新增 emission 调用点、零 adapter/retention 触面 | 符合 |
| docs/AGENTS（规范文档随行为变更同步；措辞不虚构行为） | 协议文档五处全落：§9.4 `UPDATE_TRANSFER_EXPIRED` 发射点注记、§13.2 两码发射点（含并发超额 → VIOLATION 的简报裁决固化）、§17 四配置清单 + 链块 + **双激活键口径句**（与实现门逐字语义一致）、§18 `assemblyTimeoutMs` 行、§23.1 第 23 型登记（字段/reason 词表/计数不变量/failed 族 carve-out/接线行全集）；成功路径三型措辞为「#245 计划项，本切片不登记为已实现行为」（计划非行为） | 符合 |
| CONTEXT.md 词条 | 零新域词（「分块复制传输/UPDATE_CHUNK/CAP_CHUNKED_UPDATE」切片 1 已在册）；CONTEXT.md 零改动（git status 实证） | 符合 |

## 2. 单一事实源

| 面 | 证据 | 判定 |
|---|---|---|
| 切片几何/跨帧一致性 | `chunkCountOf`/`chunkBounds`/`geometryConsistent` + assembler 跨帧逐字节一致强制仍单模块（update-transfer.ts）；本切片唯一新增 = `snapshot()` 只读投影（:88-99，safe-field 计数/长度，非内容） | 符合 |
| 跨字段链判据 | `validateChunkedTransferChain` 单一函数；激活探测（构造器读 `options.limits` 用户表达键集）与链判据（对 resolved 合并结果）两层事实分离干净；plugin 路径 `mergeNested` 纯 spread 用户 Partial（plugin.ts:214-217 实读）→ 两路径探测语义一致，`LIMIT_KEYS`/`TIMEOUT_KEYS` 已含新键 | 符合 |
| 连接级槽位事实源 | 连接实现侧 `inboundAssemblySlots` Set 单一（hub-connection.ts:469 / peer-connection.ts:99）；通道侧 `assemblySlotHeld` 为对称镜像旗标——获取（首 chunk 准入成功后、accept 前置位，hub:721/peer:704）与归还（`endAssemblyScope` 单点复位 + delete）**SA4-1 修复后对称闭合**；`has`→true / `delete` 双侧幂等 | 符合 |
| RESYNC_REQUIRED 发射点全集 | 本席独立 grep `kind: 'RESYNC_REQUIRED'`（src/）：**恰 4 处** = 两既有漏斗（hub:1025 / peer:1204，记忆化门后）+ 两新超时独立发射点（hub:1558 / peer:1838）——超时独立发射为 ADR 相符所必需（漏斗硬编码 `send-queue-overflow` 且被 `resyncDeclared` 记忆化，并入即错码或被吞；SA2 §3/SA8 设计后复审 D4 独立证实）；零隐藏第三路径 | 符合 |
| timer 延迟口径 | peer `TIMER_DELAY_FIELD` 单映射追加 `assembly: 'assemblyTimeoutMs'`（:110，`satisfies Record<TimerKind, keyof ResolvedTimeouts>` 编译期锁）；hub `armTimer` 单延迟选择（:1528-1533）；`ResolvedTimeouts.assemblyTimeoutMs` 必填化（types.ts:714，DEFAULT 提供缺省） | 符合 |
| 中止事件构造 | `clearInboundAssembly(reason?)` 每侧单点：快照先于 reset、`endAssemblyScope` 汇入、决策落定后发射、busy 守卫恰一（hub:786-804 / peer:769-787）；无第二事件构造路径 | 符合 |

## 3. 生命周期对称性

| 面 | 证据（调用链实读） | 判定 |
|---|---|---|
| 槽位获取-归还闭环 | 获取唯一点 = 首 chunk 准入（D2→D3→置位→accept，W2 单一序）；归还唯一点 = `endAssemblyScope`（清 timer + 守卫幂等归还）。出口封闭枚举：complete/首 chunk 即违例（`afterAssemblyAccept` !busy 分支，assembler 自复位或从未 busy）→ busy 违例（`transferViolation`→clear 兜底）→ 超时（`onAssemblyTimeout`→clear）→ 全部 DD-4 挂点（clearInboundAssembly）→ **全部终局路径**（hub `finalize`→`settleClose`→`closeSessionAndRelease` 同步段 :1409-1411；peer `finalize`→`cleanupResources`→排队前 claim→`runDisposal` 身份守卫段 :1668-1670——含 remote-ERROR 等矩阵外终局）→ peer 新代际（`tryOpenReplicationSession` :465 代际卫生） | 对称闭合 |
| timer 与槽同生共死 | `endAssemblyScope` 先清 timer 再还槽；`clearAllTimers` 双侧含 `'assembly'`（hub:1576 / peer:1850）；closing/终态同步段先杀 timer（既有纪律延伸）；stale fire 由 `timers[kind]=undefined` + busy 守卫双层吸收（hub:1554 / peer:1832） | 符合 |
| `teardownAbortReason` 记忆位 | 置位点 = 收口入口同步段（hub `onCloseRequest`:827 / `onConnectionClosed`:916 / fence `oneShotTerminal`:982；peer `onCloseRequest`:801 / `removeTarget`:900 / `onConnectionLost`:1010 / `onConnectionFatal`:1055 / `onConnectionStopped`:1072 / `onIdentityChanged`:863 / `applyOutcome` fence:1506）；消费点 = 收口链 clear（一次性、消费即清）；last-writer-wins 文档化；failed 族不置位（carve-out）——**一处窄边**：peer `onConnectionLost` 置位先于 closed/conflicted 早退（:1010→:1012），已终局通道的置位无消费点（见 §6 M3） | 符合（M3 登记） |
| 六 reason 接线（设计 §8.3 表逐行核对） | 本席 grep `clearInboundAssembly` 挂点全集与设计逐行一致：hub :766（无 reason，failed 族）/:863/:1022（cause 判别 shed）/:1276/:1411（消费记忆位）/:1555（timeout）；peer :465（代际卫生，无 reason）/:614/:749（无 reason）/:1128/:1201（cause 判别 shed）/:1670（消费记忆位）/:1833（timeout）；三 fence 入口置位齐 | 符合 |
| hub/peer 镜像 | D2 门、D3 调用、置位、`afterAssemblyAccept`/`endAssemblyScope`/`clearInboundAssembly`/`onAssemblyTimeout` 双侧逐字镜像（peer 版超时尾行 +`maybeStartRecovery`——§9.4「round 恒 peer 发起」语义）；peer 无 submit 门（W1 口径）忠实 | 符合 |
| 发送端簿记 | `update-channel.ts` 零 diff（git status 实证）；AC6 基线绿（K7/K8/K9/S5/S7）未触碰 | 符合 |

## 4. 文件范围（ALLOW/DENY）复核

- **ALLOW 内（12 tracked + 2 新测试文件）**：9 src + 协议文档 + api.test-d + observer-red + 2 新测试文件——与设计 §11（含 iteration-1 补登的三测试文件行）逐路径一致；每文件均有 D1–D8/SA4-1/SA4-2 归因。
- **DENY 零实质触碰**（`git status` 逐名实证）：`replication-protocol/**`、`update-channel.ts`、`docs/adr/**`、`CONTEXT.md`、`apps/**`、`src/index.ts`、issue243/233 套件、`test/harness.ts`——全部未触达。协议纪律随之成立：零新帧型、零新错误码、零新 reasonCode（`UPDATE_TRANSFER_EXPIRED` 切片 1 已登记，本切片只发射）；事件面 append-only 第 23 型一型。
- **契约文件** `ws-replication-issue244-ac-red.test.ts`（SA3 侧 DENY）：由 SA6 iteration-1 dispatch 落笔（SA6 §14：diff = 头部注记 + 3 新用例，冻结 11 用例断言零改动；SA4 §5 逐名核对 11 用例名逐字一致；本席复核 14 用例结构与 SA6 §12 表一致）——owner/SA6 路由合规。

## 5. 测试质量标准

| 标准 | 证据 | 判定 |
|---|---|---|
| 行为断言（非源码 grep/字符串断言） | 契约 14 用例 + REG 3 用例全部为 wire 帧序/错误码/observer 事件/持久化 saveDelta/状态投影断言（R2 :772-780、R3 :809-839、R4 :887-918、R5a/R5b :938-978、REG1 :340-349 等实读）；本席 grep 两新文件零 `readFileSync`、零 `src/` 字符串断言 | 符合 |
| 零 skip/only/todo | 本席 grep 两新文件零命中 | 符合 |
| 确定性 | fake-duplex + 虚拟时钟 advanceBy；零 real sleep（grep 实证）；`settleUntil`/`awaitReconnected` 均有预算耗尽即 Error（防伪红挂起，REG :303-311）；R1a/R1b/R1c/N5/N6 同步构造断言零时序因素；SA3 iter2 契约+REG ×3 连续 17/17 | 符合 |
| 反空转守卫 | R1c 内嵌敏感度反证（同合并结果双键显式 → 现行门即抛，证红精确落在激活键集）+ 冻结缺省自检；N5 合并违链①探针自检 + LIMITS 零分块族键逐键断言；REG 每 ns 恰 3 chunk 断言（chunked 路径真实走通，否则 D3 门不触发、回归失效） | 符合 |
| CI 触发性 | 根 `vitest.config.ts` include `packages/*/test/**/*.test.ts` 真实发现两新文件；typecheck include `*.test-d.ts` | 符合 |
| 类型面 | api.test-d 联合 22→23 型精确字面量 + 第 23 型 reason 六值/side/receivedChunks 精确断言；observer-red 唯一 `ResolvedLimits` 完整字面量补两必填键（编译强制涟漪，断言语义零变化） | 符合 |
| 红→绿证据链 | R1c 在单键门下红（SA6 iter1 ×4 + SA3 iter2 改前复跑一致）→ 门放宽后 14/14；REG1–REG3 修复前红于第 5 个 distinct ns 误 VIOLATION（iter1 日志 [1]）→ 修复后 3/3；全量回归 448→451 零存量翻转 | 符合 |

## 6. Findings

**0 BLOCKER / 0 MAJOR。3 项 MINOR（非阻塞，不阻断 approve）：**

- **M1（MINOR，导出惯例不一致）**：`ChunkedUpdateAbortReason` 别名经 types.ts 模块级导出但**未经 `src/index.ts` 重导出**（本席 grep index.ts 实证：#256 先例 `ReplicationNamespaceFailedCause` 在册而本别名不在）。消费侧类型信息经事件联合结构完整可达（api.test-d 即按结构展开比对并如实注释），零行为影响；但与包 AGENTS「Export production APIs through src/index.ts」的既有先例不一致，纯 TS 消费方无法按名引用该闭联合。设计 §11 将 index.ts 入 DENY（理由「新类型成员随既有导出自动可见」——对联合成员成立、对别名不成立）。建议后续触及 index.ts 时补一行重导出，本任务不阻断。
- **M2（MINOR，镜像漂移——issue-243 SA9 M2 延续）**：`test/harness.ts` 本地镜像 `WsReplicationLimits`（11 字段）现缺 `maxChunkedUpdateBytes`（#243 遗留）+ `maxChunksPerUpdate`/`maxConcurrentAssembliesPerConnection`（本切片）；`WsReplicationTimeouts`（7 字段）缺 `pingIntervalMs`/`pongTimeoutMs`（既往）+ `assemblyTimeoutMs`。零功能影响：无 CONTRACT↔DEFAULT 平价断言（grep 实证）、全部消费经 `Partial<>`、SA3 iter2 根 typecheck exit 0。设计 §13 已登记对齐注释为 follow-up；建议后续触及该文件时补齐镜像字段，本任务不阻断。
- **M3（MINOR，记忆位窄边残余——生命周期对称边例）**：peer `onConnectionLost` 在 closed/conflicted 早退**之前**无条件置位 `teardownAbortReason='connection-teardown'`（peer-namespace.ts:1010→:1012）——已终局通道早退后无 `cleanupResources` 调用，该置位无消费点而残留；若同一控制器后经外部 `addTarget` 复用重开（peer-connection.ts:282-287 重建路径），新代 assembly busy 时遇 failed 族终局（如收对端 ERROR → `onErrorFrame`→`finalize('failed','remote-error')`，:885-887 实读——该入口不预清 assembly），处置链消费残留位 → 多发一例 `chunked-update-aborted{connection-teardown}`，违反设计 D5/协议 §23.1「终局失败族不发本事件」carve-out（正确信号 = `namespace-error`/`namespace-failed` 互补不重复）。触发需「hub 主动 CLOSE → 断线 → 外部 re-add → 新代传输中途 remote-error」四步序列；影响仅为观测面一例误标 reason 的事件（observer 经 `dispatchReplicationObserver` 隔离；槽/timer/内存上界等资源不变量不受影响——`endAssemblyScope` 与 reason 值无关；协议状态零污染）。正常断线路径（R5b peer 镜像）与非终局 failed 路径（:1020-1023 防御性 cleanup 会消费）均正确。建议 follow-up（如 :1012 早退分支清位、或 `tryOpenReplicationSession` 代际重置时一并清位）+ SA7 动态面酌情构造该场景，本任务不阻断。

## 7. 裁决汇总

| 检查项 | 结果 |
|---|---|
| AGENTS（根 + 包 + docs）/ ADR 0010/0013 / 协议条款 / CONTEXT 词条 | 逐面符合（§1，含独立抽核与 grep 复验） |
| 单一事实源（几何/链判据/槽位/发射点全集/timer 口径/事件构造） | 全部符合（§2，RESYNC 发射点 grep 复验恰 4 处 = 2 漏斗 + 2 超时独立点，与设计 D4 一致） |
| 生命周期对称（槽位闭环/timer 共生/记忆位/六 reason 接线/hub-peer 镜像/发送端零改动） | 对称闭合（§3，finalize→收口调用链实读；M3 窄边登记） |
| 文件范围 ALLOW/DENY | DENY 零实质触碰；契约文件经 owner/SA6 路由合规（§4） |
| 测试质量（行为断言/确定性/反空转/CI 触达/类型面/红→绿证据链） | 全部符合（§5） |
| SA4-1（前轮 BLOCKER）修复面 | 置位-归还闭环成立 + REG1–REG3 红→绿锁定（§2/§3） |
| SA4-2（前轮 MAJOR）收口面 | 设计-契约-实现-文档四方口径一致（§1 ADR 行 + §2 链判据行 + §5 红→绿行） |
| BLOCKER / MAJOR | **0 / 0** |

**verdict：approve**。`requiresConflictRecheck: false`——实现与 SA8 三轮 clear（前置/设计后/设计修订复审）覆盖的语义面逐字一致，SA4-2 的 ADR 0013 L71 执行口径解释已经 SA8 design-recheck 专项裁决（无冲突），无新增冻结面冲突。M1/M2/M3 为非阻塞登记项：M1/M2 由后续触及机会承接，M3 登记 follow-up 硬化点与 SA7 动态面酌情场景。
