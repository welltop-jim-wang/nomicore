# SA4 实现后红队审查 — Issue #243（issue #233 切片 2：协商 CAP_CHUNKED_UPDATE 超限 UPDATE live 分块传输）

- Dispatch：`sa-13a04846-b7ab-49a0-871f-f3bb9e3abbf7`（mabf-sa4 / implementation-review / iteration 0）
- 审查对象：worktree `nomicore-fix-issue-243`（branch `mabf/issue-243`，base HEAD `c20aeb0`）工作树中 SA3 交付的完整 diff（12 tracked 修改 + 4 新文件：`update-transfer.ts` + 3 测试文件）
- 输入：SA1 iteration-2 设计（`wiki/raw/task_issue-243_design.md`）、SA2 iteration-2 approve（`task_issue-243_sa2_review.md`）、SA6 契约（`task_issue-243_sa6_contract.md`，approve）、SA8 门禁 + r1/r2/r3（clear，D1/D2 必答已答、O5 解除）、SA3 报告（`task_issue-243_sa3_impl.md`）
- 结论：**approve** —— 实现与设计 DD-1–DD-8/F1–F7/D1/D2/W1–W4 逐面一致，攻击面（ALLOW/DENY、协议假设、caller ripple、测试行为质量、CI 触发性）未发现可否定 pass 的缺陷；两处测试侧范围偏离（红灯契约 3 处断言修正 + observer-red 1 行机械涟漪）经逐条独立复核为**正当且语义保持**（§4）；全部验证命令本席独立复跑通过（§3）。

程序披露：`skills/exploit-vulnerability/SKILL.md` 在本环境不存在（agent 目录、`.agents/skills/`、`~/.dsh/skills/` 均无该项）；本审查按 SA4 角色纪律（可复核证据、攻击错误处理与测试质量、reject 必附可复现证据）以最接近的仓库纪律（`.agents/skills/code-review` 边界 + ws-replication AGENTS.md 验证门）执行。未发现漏洞，故未新增复现测试（角色纪律：仅在发现漏洞时新增）。

## 1. 攻击面 1：ALLOW/DENY 范围与 changed-path 评估

changed-path 全集（`git status` 实测）与设计 §11 的映射：

| 路径 | 状态 | 判定 |
|---|---|---|
| src：update-channel / update-transfer(新) / peer-connection / hub-connection / peer-namespace / hub-namespace / frame-io / types / defaults / validate / plugin | 全部在 ALLOW，各文件改动均有 DD 归因 | 一致 |
| src/index.ts | 零改动（设计允许「仅当需要时补」；typecheck 绿证明不需要） | 一致 |
| test：chunked-live（新，1300 行）/ real-transport（新，306 行）/ api.test-d | 全部在 ALLOW | 一致 |
| test：ws-replication-observer-red.test.ts（+1 行） | **ALLOW 表外** | 机械类型涟漪，见 §4.2——接受 |
| test：ws-replication-issue243-ac-red.test.ts（3 处断言修正） | **DENY 面触碰**（「断言面冻结」） | 逐条复核为正当，见 §4.1——接受（附裁定） |
| DENY：replication-protocol/**、issue233-repro、docs/protocols、docs/adr/0013、CONTEXT.md、backpressure.ts、round-engine.ts、observer.ts、namespace-runtime/registry、apps 契约文件 | `git status` 实测零触碰 | 一致 |

## 2. 攻击面 2：协议假设与设计逐面复核（源码实读）

对设计全部关键决策做了对抗式核对（不仅读注释，核对指令序与不变量）：

| 面 | 攻击问题 | 复核结果 |
|---|---|---|
| DD-1/F5 协商 | peer 是否逐字捕获（不与本地 offered 求交）？dialNow 是否复位？ | `peer-connection.ts:437` `negotiatedCapabilitiesValue = message.selectedCapabilities >>> 0`（身份校验后、ready 前，单点）；`:304` dialNow 复位 0。hub `onHello` 以 `selectCapabilities`（`negotiation.ts:26-29`，required⊄supported→ok=false）单点交集，HELLO_ACK 携带 selected。与 F5 裁决逐字一致 |
| DD-2 chunkable 判据 | 未协商连接是否恒 false（AC6 结构保证）？ | `update-channel.ts:248-255`：`bytes>maxUpdateBytes ∧ ≤maxChunkedUpdateBytes ∧ nextTransferId≤0xffffffff ∧ chunkedSendEnabled()`；`chunkedSendEnabled = negotiated & CAP_CHUNKED_UPDATE`。未协商 ⇒ 恒 false ⇒ deliver 直发条件与 v1 逐字节同义（`effectiveInFlightCount` 无 transfer 时 ≡ 裸口径） |
| DD-3 发送状态机 | 载体守恒、1 槽、末 chunk 结算、ACK 锚 | 载体不 shift 直至末 chunk（`sendOneChunk` isLast 分支 ：433-445：shift→核减→inFlight{bytes=totalBytes}→清 transfer→noteUpdateSent→armAckTimer）；中间 chunk 零 inFlight/零 timer/零 update-sent（K1 断言 sent.length===1 实证）；`deliver` gate→window 求值序保持 F1 修复的先闸门后窗口次序（重入安全）；takeItems 贪心合并以累计 ≤maxUpdateBytes 为上界，结构性吞不下 chunkable 项 |
| DD-3.7/F2 单点清除 | 全部清队列路径是否同步终止 transfer？ | `discardQueued` 内联 `clearActiveTransfer`（结构性单点）；`abandonInFlight` 入口捕获 `abortedTransfer` 后显式清除（载体保留，v1 冻结队列语义）——指令序逐行核对正确 |
| DD-3.8 有效口径 | 周期 round 延后判据；maybeStartRecovery 守卫 | `startPeriodicReconcile` 用 `effectiveInFlightCount()>0`；`maybeStartRecovery` 保持裸口径（设计明示无需改：needsResync ⇒ 无 activeTransfer）——与设计钉死一致 |
| DD-4 接收管线 | 首 chunk 校验序是否全部分配前？残渣表？Σ 核对？hub submit 门？ | `update-transfer.ts`：`validateFirst`（bytes≤maxUpdateBytes→totalBytes≥1→bytes≤totalBytes→≤maxChunkedUpdateBytes[TOO_LARGE]→几何一致[VIOLATION]）全部先于 `new Uint8Array(totalBytes)`（D1 有界分配）；busy 严格递增+跨帧一致+`receivedBytes+len≤totalBytes`；收齐 `completeIfExact` Σ 精确核对（含单 chunk 短申报收口）。残渣表：quiet 静默 / needs-resync∧reconciling 良性 / 其余（live 等）fail-loud VIOLATION——peer/hub 对称实现；首 chunk 状态门逐字镜像 `onHubUpdate`/`onUpdate`（`live | needs-resync | reconciling∧wasLive`）；hub submit 门在首 chunk 判（分配前） |
| DD-5 dispatch/drain | peer drain 是否静默丢 chunk？hub drain 名单 +1？ | peer `:404-414` drain 白名单不含 UPDATE_CHUNK→静默丢弃（零改动，与 UPDATE 同列）；hub `drainActive` 名单显式 +`UPDATE_CHUNK`（`:758`）；未知 ns 双侧回 NAMESPACE_STATE_VIOLATION（既有单点） |
| F6 分派 | 是否收窄在 live‖needs-resync 门外？记忆化不吞声明？ | `onAckTimeoutFired` ：1042 门内分派：true→`declareLocalResync('ack-timeout')` 漏斗（wire RESYNC + observer cause='ack-timeout' + 同步 maybeStartRecovery）；false→PN6b 原体（含 deferTask）逐字节。SA8 r3 O7 守门要求满足 |
| F7 漏斗收敛 | 发射点全集静态判据？零行为变化？ | 本席独立 grep：生产 `kind:'RESYNC_REQUIRED'` 恰 2 处 = peer `declareLocalResync`（peer-namespace:1101）+ hub `declareHubResync`（hub-namespace:930）；`onWatchdogEdge` 收敛后指令序与漏斗逐行等价（markSessionResyncEdge 幂等前置保持、同帧同 reason、cause 透传）——零行为变化声明成立，K14 动态实证 |
| assembly 生命周期 | 挂点是否闭合？周期 round 是否误清？ | 置位/清除点全枚举核对：onResyncReceived（双端）、两漏斗（记忆化门后）、onRoundSettled 回 live 分支（`resyncEpisode` 门控；peer `pendingResync→round+1` 分支在清除点之前 early-return——标记保持，与设计一致）、tryOpen/新会话、runDisposal/closeSession、违例复位。周期 round 不置不清（hub onSyncStep1 零 setState 既有锚点） |
| 协议纪律 | 零新帧型/零新 reason/零新 observer 类型？ | F6 复用 `RESYNC_REQUIRED{send-queue-overflow}`（漏斗既有 reason）；observer cause 'ack-timeout' 既有联合类型；update-sent/acked/applied 既有三事件面（N2）。W4 零新诊断面（apply 复用 `applyRemoteUpdate`） |
| ADR 0013:32 transferId 作用域 | resync/终态不复位、新连接归 1？ | `teardown()` 归 1（teardown=连接收口/新会话标记，tryOpen/runDisposal 均经此）；needs-resync 路径零复位——K8 实证 resync 后 T2=transferId 2 |

## 3. 攻击面 3：运行验证（本席独立复跑，全部 exit 0）

| 命令（worktree 根） | 结果 |
|---|---|
| `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/ws-replication/test packages/replication-protocol/test` | **69 files / 586 tests passed**（含冻结 issue233-repro R1/R2/R3、codec-issue242 28、ac5-live 7、watchdog/recovery/backpressure/fairness 全套）；Type Errors no errors |
| 同 runner 单跑 issue243 三文件（verbose） | ac-red **6/6**（NC0/P1/P2/P3/NC1/NC2 全绿）+ chunked-live **16/16**（K0–K15）+ real-transport **1/1**；Type Errors no errors |
| `pnpm typecheck`（根，13 包 + apps/yjs-server） | exit 0 |
| 静态核验（F7 判据） | grep `kind: 'RESYNC_REQUIRED'` sendChecked 发射点 == 两漏斗（§2 表） |

CI 触发性：根 `vitest.config.ts` include `packages/*/test/**/*.test.ts` 自动发现三个新文件；`.github/workflows/ci.yml` 分片作业（:80）+ typecheck（:39）+ test-d（:44）全部触达——新测试为 CI 守门测试，非本地-only。

## 4. 范围偏离逐条裁定

### 4.1 红灯契约文件 3 处断言修正（DENY「断言面冻结」触碰——**接受**）

SA3 透明披露（报告 §6 + 文件内「实现轮修正注」inline 标注）。本席逐条独立复核其「绿灯不可达」论证：

1. **P2 零 SYNC 计数含 boot round**：任何正确实现的新建连接在 live 前必跑初始 sync round（红灯日志自身双方向各 3 帧 SYNC_* 为证）。修正 = 增量口径（写前基线差分）——断言消息「超限 update 不得触发任何 SYNC round」语义逐字保持（写后零新增 SYNC 仍被断言，K1 同款）。红灯相位该断言位于首个失败断言（resync=1，SA6 §13 verbatim 日志）之后从未执行——修正只影响绿灯相位断言机制，不动红灯失败面。
2. **P2 ACK 时序**：收敛谓词（hub blurb）在 apply 微任务序内可先于 ACK 帧出站为真 → 帧级计数存在竞态。修正 = 「单 ACK 到达」并入 settleUntil 谓词（NC1 既有 idiom）——恰一次 ACK 断言保持。
3. **P3 hubSideClosed===false**：注入帧占用真实 peer 连接级序列号空间 → hub 按 ADR 冻结语义必须 ACK 该序 → peer 按冻结 #238 语义（ac5-live：未知 ackedSequence → ACK_STATE_VIOLATION connection fatal）必须收口 → peer ERROR 复用同序 → hub SEQUENCE_VIOLATION——两级均实现无关（任何正确实现含零编辑假想实现均收口），字面不可达成立。替换断言（无 ns 终局、零 UPDATE_TRANSFER_*、ACK 先行于任何 ERROR、恰一次 apply+dirty+ACK、零新增 SYNC）保持 AC3/AC8 接收端接纳证据面。

裁定：三处均为「测试断言面机制修正」而非实现语义 fallback；AC 映射语义逐字保持；红灯失败面（P1 零 chunk / P2 resync / P3 decode 收口）未被触碰且全部转绿。接受，并建议 Controller 将本节作为对 SA3 §6 裁定请求的正式回执（无需 SA6/SA8 重开轮次——不可达论证已由本席独立复核闭环）。

### 4.2 observer-red.test.ts +1 行（ALLOW 表外——**接受**）

`ReplicationLimits` 新增必填字段的唯一既有完整字面量构造点补 `maxChunkedUpdateBytes: 4MiB`（缺省值）。替代方案（字段可选化）会弱化限额契约——未取。机械类型涟漪，非断言/行为改动。

### 4.3 登记项（非缺陷）

- K6 注记的「hub save 门闩 + 多笔排队 apply 持久化投影怪异性」：SA3 声明 v1 基线探针复现、非本改动引入；K6 断言面已绕开该投影（wire 帧 + observer 事件断言）。维持登记，归 #244/backlog 核实。
- AC5 字面措辞（「计时锚=末 chunk 出站」）与混合窗口下既有「最老在途完成重锚」语义的关系：设计 N2 已校正（timer 未武装时成立），K8/K9 断言面为 ackedSequence 关联键——不受影响，维持。
- 混编部署（协商 hub fan-out 单帧 UPDATE 到未协商 peer 触发其 v1 超限路径）：R9 已登记，文档化归 #246。

## 5. 测试行为质量评估

- K0–K15 + real-transport 全部为行为断言（wire 帧序/帧形状/observer 事件/持久化 saveDoc 计数/ns 终态投影），零源码 grep 断言、零 skip/only/todo、零 real sleep（real-transport 有界 real wait 属 sa7 既有纪律）；K8/K9/K10/K14 覆盖 F6 双向 + 未协商负控 + F7 动态行；K15 以严格帧序数组断言 RR 逐轮交替（真实公平性断言，非烟雾）；K14 附 unhandled-rejection 探针。负控面（K0/K6/K10/NC0-2/R1-R3）对「协商默认翻恒开」「未协商 v1 漂移」双保险在位。
- fake-duplex 下「声明后发送端仍续出」有机残渣窗口结构性不可构造的限制已如实头注（K13 以对齐序列注入表达判别行）——诚实标注，非掩饰。

## 6. 裁决汇总

| 检查项 | 数 | 结果 |
|---|---|---|
| 设计决策面对抗复核（DD-1–DD-8/F1–F7/D1/D2/W1–W4/ADR 0013 条款） | 14 面 | 全部一致，零锚点漂移 |
| ALLOW/DENY/changed-path | 全部 tracked+untracked 文件 | DENY 零实质触碰；2 测试侧偏离（§4，均裁定接受） |
| 独立复跑验证 | 4 组命令 | 586/586 + 23/23 + typecheck exit 0 |
| 测试行为质量/CI 触发性 | 17 用例逐条 + CI wiring | 行为断言、CI 全触达 |
| 可否定 pass 的缺陷 | — | **未发现** |

**verdict：approve**（无 requiresConflictRecheck——实现未引入 SA8 r3 未覆盖的语义偏离；F6/F7 落地与已复核设计逐字一致）。
