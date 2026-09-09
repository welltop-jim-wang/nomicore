# SA8 冲突门禁报告 — issue #244（设计后复审）

- **dispatch**: sa-cf2356e5-7a3b-4796-83cc-8c63df84cecf（mabf-sa8 / conflict-gate / iteration 1）
- **审查对象**: SA1 设计 `wiki/raw/task_issue-244_design.md`（dispatch sa-43e4de98…，SA1 自判 `requiresConflictRecheck=true`，触发本复审）
- **门禁类型**: 设计后复审（轻量：SA1 设计 vs ADR 全集 + CONTEXT.md；R7/R8 取舍核对为主）
- **输入**: 任务简报 `wiki/raw/task_issue-244.md`（AC1–AC7）；SA6 已批准红灯契约 `wiki/raw/task_issue-244_sa6_contract.md` + `packages/ws-replication/test/ws-replication-issue244-ac-red.test.ts`（11 用例全文核读）；前置门禁 `artifacts/sa8-conflict-gate-issue-244.md`（R7–R10）
- **Issue comment REST snapshot**: `[]`（`wiki/raw/task_issue-244_dispatch.md`）——无 owner 要求需要并入，需求面 = issue 正文 AC1–AC7
- **裁决**: **通过（clear）——0 阻塞冲突 / 0 轻微冲突 / 4 条非阻塞就绪注意项（R11–R14，转交 SA2）**；可进入 SA2 设计评审

## 1. 冲突基准与效力判定

基准 = `CONTEXT.md` + `docs/adr/` 全集（14 篇，无 superseded——与前置门禁一致，本轮设计零 ADR 触改，DENY LIST 含 `docs/adr/**`）。代码与 `docs/protocols/` 仅作事实佐证。ADR 0013 仍为现行约束（R9 维持：状态「提议」、父 PR #241 OPEN，无方向性返工迹象——条件性复审未触发）。

## 2. 逐决策对照（设计 → 基线）

| # | 设计决策 | 基线依据（逐字核对） | 裁决 |
|---|---|---|---|
| D1 | 三新键（64 / 4 / 30_000）+ 跨字段链（≤ maxQueuedUpdateBytes ∧ ≤ maxChunksPerUpdate × maxUpdateBytes）+ 构造期 TypeError + 零运行时 clamp；`assemblyTimeoutMs` 容器裁决 = timeouts；plugin 键表增补 | ADR 0013 L69–74 配置表：名/缺省/约束逐字一致；**容器在 ADR 未冻结**（表无容器列）——SA1 裁决权在契约 A5 显式保留（契约断言两容器任一，测试 L665–672 实测如此）；协议 §17「响亮验证/不得运行时 clamp」；`pingIntervalMs?` 可选先例（types.ts:48–50）支撑 timeouts 容器形态；`LIMIT_KEYS`/`TIMEOUT_KEYS` 现状核对（plugin.ts:154–155 确无新键） | 无冲突 |
| D2 | 首 chunk `chunkCount > maxChunksPerUpdate` 控制器层准入门（分配前）→ TOO_LARGE；`>` 保 ==64 边界；assembler 构造签名不变 | ADR 0013 L59「首 chunk 校验」清单未冻结校验落点（模块位置自由）；`chunkCount ≥ 1` 维度已由 codec 单帧规则承接（replication-protocol/messages.ts:229–231 注释 + 协议 §10.3）；totalBytes 维度切片 2 已封（update-transfer.ts `validateFirst` 核对属实）；分类族对齐 ADR L80（TOO_LARGE = SYNC_DIFF_TOO_LARGE 语义族，config-retryable）；控制器层方案保住 SA6 §10「未触碰面」（issue243-sa7-dynamic.test.ts:383 两键直构核对属实） | 无冲突 |
| D3 | 连接级 `inboundAssemblySlots` Set（幂等 try/end）+ 超额 → VIOLATION（fatal/terminal failed，ns 级、连接 ready）+ 准入序 D2→D3→accept | ADR 0013 L62（每 (ns,方向) 至多 1 assembly——现状既有；连接级缺省 4）+ L76 内存上界公式（count 门 + totalBytes 门 + 槽位三者合成兑现）；超额归 VIOLATION = 简报显式裁决（R10），语义族与 L60 违例族相容；准入序 ADR 无冻结，设计已显式记录裁决 | 无冲突 |
| D4 | 进度滑动 assembly 超时（每 chunk 重置）→ 弃 partial + 出向 `RESYNC_REQUIRED{UPDATE_TRANSFER_EXPIRED}` + needs-resync +（peer 侧）maybeStartRecovery；**独立发射点，不入 resync 漏斗** | ADR 0013 L63 逐字对应（滑动 deadline、丢弃、冻结 reason 码、§9.4 收口）；协议 §9.4 L264「任一端可声明……始终由 Peer 发起下一轮」——hub 侧超时出向声明合法、peer 版尾行立即开 round 与之一致；词表已登记（§9.4 L262「发射点 = 后续切片的 assembly timeout」即本切片）；**独立发射为 ADR 相符所必需**：漏斗硬编码 `reasonCode:'send-queue-overflow'`（hub-namespace.ts:932）且被 `resyncDeclared` 记忆化（:922–923，round 结算清零 :1174/:1022）——并入即错码或被吞；timer 生命周期（busy 武装/每 chunk 重置/busy→idle 与 clearAllTimers 全清）符合既有 TimerKind seam 纪律（hub-namespace.ts:91/:1426–1451 核对属实） | 无冲突 |
| D5 | 第 23 型 `chunked-update-aborted`（字段逐字 ADR L92：namespaceId/transferId/reason∈6 值闭集/receivedChunks/receivedBytes，无 connectionId）；发射端 = 丢弃方；busy 守卫恰一事件；`observerOn` 门 + 决策落定后发射 + throw 隔离；reason 接线 4 行（timeout/channel-teardown/connection-teardown/resync-declared），shed/epoch-fence 留残差 | ADR 0013 L92 键集逐字一致；safe-field 合规（§23.3：计数/长度/有界标识）；§23 头部 append-only 纪律 + §23.4 隔离/发射纪律沿用（`dispatchReplicationObserver` 既有 facet 核对属实）；中止矩阵 7 行全覆盖（丢弃面结构既有 + R5a/R5b/超时行事件 wiring；队列溢出行经 resync-declared 接线覆盖）；shed/epoch-fence 延后见 R11（非冲突：ADR 冻结词表未冻切片分配，简报 AC5 只要求丢弃面） | 无冲突（延后承接见 R11） |
| D6 | 发送端/codec/状态机迁移零改动 | AC6 基线绿（契约 §4 K7/K8/K9/S5/S7）；`update-channel.ts` 簿记锚点（markResyncReceived→clearActiveTransfer、effectiveInFlightCount 含 transfer 槽、teardown 归 1）与 maybeStartRecovery 的 inFlightCount 门（peer-namespace.ts:1056–1063）核对属实——R3 收敛链机制成立 | 无冲突 |
| D7 | R10 分类落笔协议 §13.2 注记 | 前置门禁 R10 已判「简报显式裁决、语义族相容」；协议 §13.2 L413 现注记即「发射点属后续接收端 assembly 切片」——更新为已落地属事实对齐 | 无冲突 |
| D8 | 协议文档五处落点（§17/§18/§9.4/§13.2/§23.1） | 五处均实测存在且现状缺项属实：§17 L526–555 清单/校验链块无四配置与两链；§18 L559–568 无 assemblyTimeoutMs；§9.4 L262、§13.2 L410–413 注记待更新；§23.1 L654 现为 22 型。ADR 0013 L109 落地修订义务（消息注册表/§13.2/§17/§23）全覆盖（消息注册表切片 1 已完成） | 无冲突 |

**交叉 ADR 检查**：设计触面 = ws-replication 接收端准入/超时/事件 + 配置校验 + 协议文档——与 ADR 0009（Registry/Lease）、0011/0014（诊断日志——本 seam 为 ReplicationObserver，非 namespace diagnostic change log）、0012（实例身份/插件所有权——仅增配置键表，无 pluginId 假设）、0001–0008（VFSL 域）零交集。CONTEXT.md 词汇契约（transferId 连接域、逐片 apply 禁止、提高 maxUpdateBytes 禁止、partial 恒易失）设计全部遵守；零新域词、CONTEXT.md 零改动成立。

## 3. SA8 约束 R7–R10 落实核对

| 约束 | 设计落实 | 复核结论 |
|---|---|---|
| R7 observer seam 取舍 | 显式裁决：`chunked-update-aborted` 并入 #244（契约 R3/R5a/R5b 红灯即转绿判据，字段/reason 映射与契约 A4 三映射逐字一致——测试 L757–765/L881–887/L911–917 核对）；成功路径三型归 **#245**——实测 #245 存在（OPEN，"issue #233 切片 4"，Blocked by #244，body 明确三型 + aborted reason 闭集与切片 3 路径一一对应的验收） | **落实**（登记真实、承接闭环；shed/epoch-fence 两行 wiring 承接见 R11） |
| R8 规范文档义务 | §7-D8 五处落点 + §12 验证行（文档随附 + git diff --check） | **落实**（落点存在性、现状缺项实测属实；§23.1 措辞纪律见 R11 附带项） |
| R9 ADR 0013 状态/父 PR | §1 非目标 + §13 条件复审记录；设计零 ADR 触改 | **维持**（无新触面；条件未触发） |
| R10 并发超额错误码 | §7-D3（准入门超额 → VIOLATION）+ §7-D7（协议注记固化） | **落实**（简报裁决，无冲突） |

## 4. 完备性与就绪核对

- **AC 映射**：AC1→D1、AC2→D2（+既有 totalBytes 维度）、AC3→D2/D3/D7、AC4→D4、AC5→D5 wiring + 结构性丢弃（7 行全映射）、AC6→基线绿（非目标有据）、AC7→结构性（apply 仅 complete 后，既有管线不动）——**无遗漏**。
- **契约对齐**：R1a/R1b/R2/R3/R4/R5a/R5b 红灯断言与设计 D1–D5 逐条对上（含边界细节：N2 off-by-one `>` 判定、N1 合法链 256KiB ≤ 1MiB ∧ ≤ 64×8KiB、A5 容器无关断言、R4 victim=第 5 个首 chunk 且连接 ready、R3 收敛链 + remote-declared 恰一 + 零续传）；转绿假设 A1–A5 全部由 D1–D5 + R7 裁决承接。**11/11 用例的转绿路径在设计内闭合**。
- **结构性事实核验**（抽样）：onUpdateChunk idle 分支前置序（quiet→残渣→状态门→submit 门）与 D2 插入点吻合；`transferViolation` 单点、`clearInboundAssembly` DD-4 挂点、channelHost/host facet 对象（hub-connection.ts:484–511 / peer-connection.ts:102–131）、assembler 两键构造——设计 §2 证据锚点**全部属实**。槽位不变量（获取/归还唯一入口、busy→idle 出口封闭枚举）在 §8.1/§8.2 伪码下自洽（complete/首违例/后续违例/超时/清理挂点五类出口均达 endAssemblyScope）。

## 5. 就绪注意项（非阻塞，转交 SA2）

- **R11 · shed/epoch-fence 两行事件 wiring 的承接角色错位（完备性缺口）**：D5 表裁「本切片不接线」，§13 残差把「wiring + 动态断言」指给 **SA7**——SA7 是验证角色而非实现角色，两行发射 wiring 由此失去实现归属；而 #245 的验收（实测 body）要求「aborted reason 闭集与切片 3 的全部中止路径一一对应」，#244 不接线则该验收在 #245 侧无从成立。附带项：D8 §23.1 登记须把两未接线 reason 的措辞限定为计划非行为（docs/AGENTS「不得虚构实现行为」；对三成功型的同款纪律设计已自持）。**非 ADR 冲突**（词表/键集已冻结并被遵守，切片分配不在冻结面；简报 AC5 只要求丢弃面=结构既有；SA6 §15 亦留该三行断言于 SA7）。SA2 须二选一收口：(a) 两行 wiring 拉回 #244 实现面（设计自析代价=per-facet 上下文穿透，面小）；(b) 显式改登记到实现票（如 #245，并同步其 body 措辞）。
- **R12 · 第 23 型缺 `side` 字段的 seam 一致性**：设计按 ADR L92 键集逐字落地（无 side/connectionId——对 ADR 忠实），但既有 22 型联合成员**全部**携带 `side: ReplicationObserverSide`（types.ts:328–636 实测）且 §23.1 登记表每行有 side 列；按设计现状第 23 型将成为唯一无 side 成员。ADR 只冻结域键集，side 属 seam 结构惯例——SA2 裁定补 side（建议，惯例一致）或明文豁免。
- **R13 · GOAWAY 行表述内部不一致（设计文本）**：§1 非目标称三行「发射 wiring 见 §7-D5 表」，D5 的 connection-teardown 行实际把 GOAWAY drain deadline 经 onConnectionClosed/onConnectionFatal 接线（即本切片覆盖），§13 残差却又把「三行（含 GOAWAY）wiring」整体归 SA7。须统一口径（建议：GOAWAY 行=connection-teardown 已接线、断言归 SA7；shed/epoch-fence 按 R11 收口）。ADR 未冻结行→reason 映射，非冲突。
- **R14 · R3 断言强度措辞**：设计称 R3 断言「恰含 EXPIRED」；实测为 `toContain`（peer 侧 remote-declared 恰一间接约束帧数）。纯措辞精度项，无符合性后果。

## 6. 结论

**设计后复审通过（clear）**。SA1 设计与 ADR 0013（含配置表/接收端规则/错误码/observer seam 冻结面）、ADR 0010 及其余 ADR/CONTEXT.md **零冲突**；R7/R8 取舍按前置门禁预留口径正确落地且登记闭环（#245 实测在册）；R9 维持条件性、R10 已固化；任务简报 AC1–AC7 与 SA6 契约 11 用例的转绿路径完备闭合；设计证据锚点抽样全部属实。R11–R14 为非阻塞就绪注意项（R11 最实，属完备性/承接归属，非基线冲突），连同本报告转交 SA2 设计评审处理；实现轮不需要新的冲突复查（`requiresConflictRecheck: false`——R11 若裁决「拉回 #244」仍落在已核对的 ADR 0013 observer seam 冻结面内，不新增语义面；R9 条件项照旧）。
