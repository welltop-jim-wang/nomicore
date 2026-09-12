# SA8 冲突门禁报告 — issue #244（前置门禁）

- **dispatch**: sa-3195a0ad-f551-47a5-afbe-49b6c8c76647（mabf-sa8 / conflict-gate / iteration 0）
- **审查对象**: issue #244 任务简报「ws-replication：分块传输有界性加固与中止清理矩阵（issue #233 切片 3）」
- **门禁类型**: 前置门禁（SA 派发前：任务简报 vs ADR 全集 + CONTEXT.md）
- **Issue comment REST snapshot**: `[]`（空）——无 owner 补充要求需要并入；本报告仅以 issue body 为任务要求来源
- **裁决**: **通过（clear）——0 阻塞冲突 / 0 轻微冲突 / 3 条非阻塞就绪注意项**

## 1. 冲突基准与效力判定

基准 = `CONTEXT.md` + `docs/adr/` 全集（14 篇）。全库扫描 supersede/废止标记：**无任何 ADR 处于被取代状态**（grep 命中均为 ADR 正文的节内历史修订记录，非 ADR 级取代）。代码与 `docs/protocols/`、`docs/phases/`、wiki 不构成自动阻塞依据，仅作就绪性佐证。

- **ADR 0013（chunked live update transfer）**：状态「提议（issue #233 base PR #241）」。该 ADR 文本已提交入 `docs/adr/`（commit 164eee7），CONTEXT.md 已并入其词汇（「分块复制传输」「UPDATE_CHUNK」「CAP_CHUNKED_UPDATE」三条目），切片 #242/#243 已按其合并落地。按 SA8 基准规则（ADR 全集 + CONTEXT.md）其为**现行约束**；「提议」状态与父 PR #241 未合并仅作就绪注意项 R9 记录，不构成阻塞。
- ADR 0010 为复制架构权威；ADR 0013 自述「扩展 ADR 0010 的 live UPDATE 路径，不改变其 ACK durability 语义、identity fencing、backpressure 分层或停机顺序」——简报全部落在此扩展域内。

## 2. 逐条对照（简报 → 基线）

| # | 简报要求 | 基线依据 | 裁决 |
|---|---|---|---|
| C1 | 四个新资源上限配置（maxChunkedUpdateBytes / maxChunksPerUpdate / maxConcurrentAssembliesPerConnection / assemblyTimeoutMs）安全缺省、启动期响亮校验、绝不运行时 clamp | ADR 0013「资源上限与配置链」表：同名四配置、缺省 4 MiB / 64 / 4 / 30_000、约束逐字一致；protocol §17「配置启动时响亮验证……不得运行时 clamp」纪律；ADR 0010「资源限制」（插件配置 + 安全缺省） | 无冲突 |
| C2 | 校验链：maxChunkedUpdateBytes ≤ maxQueuedUpdateBytes 且 ≤ maxChunksPerUpdate × maxUpdateBytes 等；非法配置构造期 TypeError | ADR 0013 配置表约束列逐字对应；跨字段链自切片 2 显式移交本切片（`packages/ws-replication/src/validate.ts:152` 注释「slice 2：形状门；跨字段链归 #244」） | 无冲突 |
| C3 | 恶意 totalBytes/chunkCount 申报在首数据字节流入前被拒绝；buffer 只按已验证上界分配 | ADR 0013 L41（「恶意声明在第一个字节流入前即可拒绝」）+ L59（首 chunk 校验四条件通过后一次性分配 detached buffer）——简报措辞与 ADR 逐字同源 | 无冲突 |
| C4 | 元数据违例（transferId 不一致、总量字段漂移、错序/重复 chunk、并发 assembly 超额）→ UPDATE_TRANSFER_VIOLATION（fatal，terminal failed）；声明超上限 → UPDATE_TRANSFER_TOO_LARGE（fatal，config-retryable，terminal failed） | ADR 0013「错误码与词表」逐字对应；两码已由切片 1 登记入 wire 契约错误注册表（`docs/protocols/instance-replication-v1.md` L410–413，含「发射点属后续接收端 assembly 切片」= 本切片）；语义族对齐 SYNC_STATE_VIOLATION / SYNC_DIFF_TOO_LARGE 先例（L401） | 无冲突 |
| C5 | assembly 滑动超时（每 chunk 重置）→ 丢弃 partial + RESYNC_REQUIRED{UPDATE_TRANSFER_EXPIRED}，对端按既有规则收口收敛 | ADR 0013 L63 逐字对应（进度滑动 deadline、丢弃 + reason 码）；UPDATE_TRANSFER_EXPIRED 已登记（protocol L262「发射点 = 后续切片的 assembly timeout」）；收口走 protocol §9.4 既有 pending-resync 合并规则 | 无冲突 |
| C6 | 中止矩阵：连接 shed / 队列溢出 / 对端 RESYNC / close / GOAWAY drain / 断线 / epoch fence → 丢弃纯易失 partial assembly | ADR 0013 L58（接收端清理集）+ L54（发送端中止集）+ CONTEXT.md「分块复制传输」（「中断即丢弃并回退 state-vector reconciliation」）；GOAWAY/epoch fence 为 ADR 0010 既有机制（§21 停机纪律、复制代际） | 无冲突 |
| C7 | 发送端中止：停发后续 chunk、末 chunk 序入 zombie 簿记并释放窗口槽，后续 transfer 正常发起 | ADR 0013 L54（「停发后续 chunk、末 chunk 序入 zombie 簿记、needs-resync 同构处置」）+ L51（「整笔占 1 个 in-flight 窗口槽直至 ACK」）；zombie 簿记机制已在 `update-channel.ts:96,178–204,502` 落地 | 无冲突 |
| C8 | 任何中断后双方由既有 state-vector reconciliation 修复收敛，零 durable partial state；全部中止/违例路径 live Y.Doc 零部分写入 | ADR 0013 L58/L61（「零 durable 残留」「重组失败一律发生在 apply 之前：live Y.Doc 零写入」）+ 非目标（不持久化 partial chunks）+ 父 issue #233 Goals/Non-goals 逐条对应 | 无冲突 |

**交叉 ADR 检查**：ADR 0009（Registry/Lease）、0011/0014（诊断日志）、0012（实例身份/插件所有权）、0001–0008（VFSL/求值/投影/持久化/校验/运行时）与本简报无交集或无抵触；简报不触碰 SCHEMA/META 权限、session 信任模型、sequencer 语义。CONTEXT.md 词汇契约（transferId 非跨连接持久标识、逐片 apply 禁止、以提高 maxUpdateBytes 代替分块禁止）简报全部遵守。

## 3. 依赖评估

- **Blocked by #243（切片 2）**：CLOSED（ci-passed），经 PR #275 合并（commit e2178f3），且已在本工作分支 `mabf/issue-244` 历史中——**满足**。切片 2 明示「违例分类在切片 3 完备化」（#243 验收末条），本简报即其承接，切片边界无重叠、无空洞。
- **#242（切片 1，codec + capability）**：CLOSED（ci-passed，PR #264），wire 面 0x42 帧与 CAP_CHUNKED_UPDATE 协商已冻结并登记错误码/词表——**满足**。
- **父 issue #233**：OPEN（enhancement 伞票，正常）；**父 PR #241**：OPEN（ADR 0013 + 现状刻画，内容已提交）——见 R9。
- **运行基线**：`packages/ws-replication` 具备模块契约 AGENTS.md 与验证门（focused tests + package typecheck + 根 `pnpm typecheck` / `pnpm test`）；`maxChunkedUpdateBytes` 已在 `defaults.ts`/`types.ts`/`plugin.ts` 就位（形状门），其余三配置待本切片新增；接收端 `update-transfer.ts`（切片 2）已含首 chunk 基础校验骨架。

## 4. 就绪注意项（非阻塞，转交 SA1）

- **R7 · ADR 0013 observer seam 未列入本简报验收**：ADR 0013 §Observer seam 冻结 4 个 chunked-update 事件，其中 `chunked-update-aborted` 的 reason 词表 {timeout, shed, resync-declared, channel-teardown, connection-teardown, epoch-fence} 与本简报中止矩阵一一平行；当前代码与 #243/#244 简报均未覆盖（grep 零命中）。属 ADR 对特性整体的义务，非简报矛盾。SA1 设计须显式决定：并入 #244 或登记 follow-up。
- **R8 · 规范文档同步义务**：ADR 0013「后果」要求落地时修订 `docs/protocols/instance-replication-v1.md`（§17 等）；当前 §17 配置清单与校验链块**尚无**四个分块配置（切片 1 仅登记了消息/错误码/词表）。docs/AGENTS.md 要求契约变更同步规范文档。本切片落地配置时须一并修订 §17（如 R7 事件并入则含 §23）。
- **R9 · ADR 0013 状态与父 PR 未合并**：状态「提议」、PR #241 OPEN。按 SA8 基准规则其为现行约束（正文入 corpus、CONTEXT.md 并词、切片已按其落地），不阻塞；仅提示总控：若 #241 后续发生方向性返工，本门禁结论需复审。
- **R10 · 欠定点备注（非冲突）**：「并发 assembly 超额」归入 UPDATE_TRANSFER_VIOLATION 是简报对 ADR 欠定点的显式裁决（ADR 0013 L62 设限但未命名错误码）；与违例族语义相容、无抵触。SA1 设计按简报口径固化即可。

## 5. 结论

**门禁通过（clear）**。issue #244 任务简报与 ADR 0013 逐条同源、与 ADR 0010 及其余 ADR/CONTEXT.md 无任何抵触；依赖 #243 已满足；切片边界清晰。可进入 SA1 设计。设计产出后如触及 R7/R8 的取舍，属设计后复审（轻量）核对项。
