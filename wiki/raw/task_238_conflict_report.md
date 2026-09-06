# 冲突门禁报告 — Issue #238 Hub→Peer UPDATE apply 阶梯延迟：分段观测与关联 ID

## 任务标识

- 任务：Issue #238 — BUG investigation: Hub→Peer UPDATE apply 延迟呈阶梯累积，最高 11 秒（bug / in-progress，OPEN）
- 简报：`TASK.md` + Issue #238 正文 + Owner 评论 `IC_kwDOT8JVvs8AAAABS2CyWg`（welltop-jim-wang，2026-09-06T13:39:25Z）
- Worktree：`/home/wangjian/nomicore-fix-issue-238`（branch `mabf/issue-238`，HEAD `9e3f0bf`）
- 阶段：前置冲突门禁（SA 派发前）
- 裁决人：ADR Conflict Gatekeeper（SA role，conflict-gate phase）

## 检查范围

- 冲突基准：`docs/adr/` 全部现存文件 **11 个（0001–0010、0012），逐个全读，无抽样**（ADR-0011 编号空缺，全仓无该文件与引用）+ 根目录 `CONTEXT.md` 全读。
- 被审对象：Issue #238 正文（Problem / Required feedback loop / Observability requirements / Acceptance criteria）+ Owner 评论要求——已有确定性复现为基线（不作为生产 11 秒阶段的证明）；后续工作 = ① 分段观测区分 event-loop stall / sequencer queue wait / protected check+live apply / dirty notification；② 可靠 sent/applied/acked 跨阶段关联 ID；③ 确认并修复至少一个根因，修复后连续小 UPDATE 不再出现随序号单调累积的本地 apply latency。
- 辅助核验（不构成独立基准）：`docs/protocols/instance-replication-v1.md`（§3/§10/§17/§23）——被 ADR-0010 正文明文收录为唯一 wire contract，其 §23 observability seam 亦为 ADR-0010 L167 的落地契约。代码与 `wiki/raw` 未作为阻塞依据。
- 被任一 ADR 标记 superseded 的条款（ADR-0007 的 open/read 编排与 schema-aware read，已被 ADR-0008 取代）不计入约束。

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted | 否 | 任务不触及 schema 文本/信封/方言；无冲突 |
| ADR-0002 | nomicore 是全新重写，authority 出范围 | accepted | 否 | 任务不涉及旧 authority 规则；无冲突 |
| ADR-0003 | 求值器与派生 schema | accepted | 否 | 任务不触及求值/ROOT/联合表示；无冲突 |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 否 | 任务不触及类型投影；无冲突 |
| ADR-0005 | 投影生成管线 | accepted | 否 | 任务不触及生成管线；无冲突 |
| ADR-0006 | 持久化 DocPersistence 与 docstore | accepted（含 #64/#79/#131/#133 修订） | 是（dirty 语义基准） | 「saveDoc = 脏状态通知，返回仅表示已登记」+ 内部 flush 调度——观测 dirty-notification 时长不改语义；若生产慢 dirty 源自 resolve 前重活，修复=回归本契约；无冲突 |
| ADR-0007 | 逻辑校验与 Yjs Runtime Bridge | accepted（open/read 条款被 ADR-0008 取代） | 是（observer 纪律） | 残余有效条款「observer 不得向事务调用栈抛异常」「优化完整校验成本必须保留行为等价测试」与分段探针/潜在优化方向一致；无冲突 |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 #93/#132/#134 修订） | 是（核心） | 复现机制=冻结槽序（「`await notifyDirty()`，然后才释放给下一任务」）的字面行为；观测落点「队列进度和内部事件属于日志、metrics 与 trace」与任务一致；任务未要求扩 status/改槽序；无冲突 |
| ADR-0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted（含 #131/#134 修订） | 是（时钟纪律） | 注入 Clock/Timer、manual Clock + fake timer 确定性测试、内部结构化 observer seam——手动时钟注入与单调时源要求的既有纪律；无冲突 |
| ADR-0010 | Hub/Peer WebSocket Y.Doc 复制与最终一致 | accepted（含 #134/#133/#161/#172 修订） | 是（核心） | 任务全部要求是对六步 trusted apply 管线 + observer seam（L167）+ 安全字段清单（L159）既有框架的兑现/扩展；关联 ID 可由收录 protocol 既有 sequence 派生（§3/§10.2），不触 wire；无冲突 |
| ADR-0011 | ——（编号空缺，文件不存在） | —— | —— | 盘点完备性注记：`docs/adr/` 无 0011，0001–0010 之后即 0012，全仓无引用 |
| ADR-0012 | 实例身份单一真相与 WebSocket plugin 所有权 | accepted（issue #204 已实现） | 是（边界） | 「status、observer 与错误不得泄漏 token、Authorization、owner 完整值、Schema/Data、Yjs bytes 或 stack」与任务安全要求同向；observer 属插件配置域；无冲突 |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | 无冲突项（hard-violation 0 / override-declared 0 / evolution 0；条件性演进门 G1–G4 另登记于下，当前均未被任务简报强制触发） |

无冲突项。逐项对照说明（非冲突，供 SA1/SA2 参考）：

1. **分段观测（event-loop stall / sequencer queue wait / protected check+live apply / dirty notification）vs ADR-0010 L96–103 六步管线 + ADR-0008 L51 槽序**：被审要求的四个阶段与冻结管线一一对应（gate→受保护字段检查→`Y.applyUpdate`→`await saveDoc`→释放槽；queue wait = 槽序 FIFO 排队的既有事实）。纯观测性分解不改变管线语义。裁决 no-conflict。**红线**：分段采样/探针不得改变槽执行顺序或 FIFO 语义；observer 回调发射点不得进入 Registry write sequencer 槽内（protocol §23.4「永不位于 Registry write sequencer 槽内」——槽内只允许捕获时差样本，事件在 apply 结算续体发射）。
2. **queue wait / queue depth 字段 vs ADR-0008 L101**：「status 不暴露队列长度、任务类型或 sequence……队列进度和内部事件属于日志、metrics 与 trace」——任务的观测字段落点正是该句指定的日志/metrics/trace seam（ADR-0010 L167 observer seam / protocol §23），而非 `Runtime.getStatus()` 或 `session.getStatus()` 公共面。任务未要求扩 status。裁决 no-conflict。**红线**：不得向 `NamespaceRuntime.getStatus()`（含 `replication` 两态域，#132 修订 5）或 `ReplicationSession.getStatus()`（#134 O-11 十一字段冻结形状）添加队列/时延/关联字段。
3. **sent/applied/acked 关联 ID vs ADR-0010 非目标 L213 + protocol §3/§10.2**：wire 已有 per-direction uint32 sequence（envelope §3），UPDATE_ACK 显式回带 `ackedSequence`（§10.2）——跨阶段关联可由既有 sequence + 连接局部记账派生，**零 wire 字节变更**；Owner 要求「connection-local」关联与 ADR-0010 非目标（「durable outbox、增量 WAL 或跨重连 update ID 表」）不冲突；安全落点=事件 payload/受控 trace（§23.3/§23.6：默认不绑 metric label）。裁决 no-conflict。**红线**：若设计提出任何新 wire 帧/字段（含 ACK 回带扩展），构成演进门 G3。
4. **event-loop delay 探针 + 单调时差 vs ADR-0009 L26/L83 + protocol §23.4**：「确定性测试使用 manual Clock 状态与 fake timer协调推进」「实现内禁止 `Date.now()`/`performance.now()` 回退」；`ReplicationClock` 单调、只作差、绝对时间戳不入事件；「无 observer = 零事件、零状态投影读取、零时钟调用（行为与现状逐字节等价）」。Owner 的手动时钟注入复现与此纪律同源；分段字段均为差值（任务明文「单调时差」「不得记录……绝对业务时间戳」）。裁决 no-conflict。**红线**：event-loop delay 采样必须走注入时源/seam，且仅在 observer 已注入时启用（无 observer 热路径逐字节等价，Issue AC 已明文要求）。
5. **apply source（live UPDATE / sync Step2）vs protocol §23.1 互斥规则**：既有事件型 `update-applied` / `sync-diff-applied` / `degraded-bypass-applied` 三选一互斥已承载该区分；分段字段不得破坏「每笔成功 apply 恰一事件」计数不变量。裁决 no-conflict。
6. **安全字段要求 vs ADR-0010 L159 / ADR-0012 L22 / protocol §23.3**：任务「不得记录 Yjs bytes、ROOT/SCHEMA 内容、token、owner、原始异常或绝对业务时间戳」与三处权威清单逐条同向强化。裁决 no-conflict。
7. **「更新 protocol §23 observability 契约」AC vs §23 append-only 纪律**：§23 自我声明「append-only：事件类型、reason/cause/via 词表、稳定码表只增不改；GA 后字段语义冻结」且为「local，非 wire 契约」。新增分段字段/事件型走 append-only + §23.7 conformance 扩充是文档自身规定的演进方式，不触碰 ADR 决策面。裁决 no-conflict。**红线**：`applyLatencyMs` 语义（§23.4「含 write sequencer 排队等待」）已冻结——分解必须以**新增字段**表达，不得重定义既有字段剔除 queue wait。
8. **根因修复 + 「不再随序号单调累积」AC vs ADR-0008 槽序 / CONTEXT「写序列器」词条**：CONTEXT L77–79 明文「前项完成 dirty notification 后下一项才执行」——复现的排队机制是**词汇层已文档化的不变量**，阶梯延迟本身不是契约违反；合法修复空间=缩短槽内各阶段时长（如使 saveDoc 回归 ADR-0006「登记即返回」、降低 O(doc) 阶段成本），而非打破 FIFO/移动 `await notifyDirty()`。Issue 未指定任何与冻结条款相悖的修复手段。裁决 no-conflict（条件性演进门见 G1/G2）。
9. **确定性反馈循环（真实 Runtime + Session + fake duplex + 慢任务注入）vs ADR-0008 L97 / ADR-0009 L83**：「测试通过包内确定性 seam 注入可控 P0、dirty notifier、handle 与 fault」——saveGate 式注入与手动时钟是既有契约认可的测试模式。裁决 no-conflict。

## 条件性演进门（当前未触发；一旦下游设计/修复选择下列路径，即构成对冻结条款的修订，必须先修订 ADR/protocol 并重跑冲突门禁）

- **G1 槽序变更**：从槽内移除/移动/并行化 `await notifyDirty()`、绕过唯一 sequencer、或以任何方式改变「前项完成 dirty notification 后下一项才执行」——需修订 ADR-0008（L51 正文 + #132 修订 4「完整槽序……不变」）、ADR-0010（L96–103）与 CONTEXT.md「写序列器」词条。
- **G2 受保护字段判据/成本优化**：将 scratch clone「内容投影相等」判据（#134 O-12 冻结）改为增量/diff 触达式检查——ADR-0010 #134 修订已明文「留作后续演进，非过早优化，**不得在未评审情况下预写**」；须显式设计评审 + ADR-0010 修订节，并按 ADR-0007 L59 先例保留行为等价测试（「删后同值重写=允许」等冻结语义不得漂移）。
- **G3 wire 变更**：新增任何帧/字段（含关联 ID 上 wire、ACK 回带扩展）——protocol v1 为唯一 wire contract，append-only 消息码注册表之外的结构变更需协议修订；任务简报与 Owner 要求均为 local seam，本门按「wire 字节保持不变」放行。
- **G4 冻结公共面扩形**：向 `ReplicationSession.getStatus()`（O-11 十一字段冻结）、`NamespaceRuntime.getStatus()` `replication` 域（两态联合）、`applyRemoteUpdate` 拒绝码闭集等注册表添加成员——只能按各注册表自身 append-only 纪律演进或以修订节显式登记，不得静默扩形。

## 事实性注记（信息充分性）

1. **基线复现不在本 worktree HEAD**：Owner 评论列出的复现文件 `packages/ws-replication/test/ws-replication-issue238-repro.test.ts` 与 `issue137-driver.ts` 的「可选 clock 注入」均不存在于本 worktree（HEAD `9e3f0bf`，branch `mabf/issue-238`；`issue137-driver.ts` 现有 `saveGates` 门闩但无 clock 注入，全仓无 `238` 匹配）。后续工作须移植/重建该基线；按 Owner 要求，该复现仅证明 sequencer 排队机制，**不构成生产 11 秒长占槽阶段的证明**——生产根因判定仍缺分段证据，正是本任务观测面要补的缺口。
2. ADR-0011 编号空缺（`docs/adr/` 0001–0010 之后即 0012），盘点以现存 11 文件为全集。
3. 相邻议题不在本基准内：#237（普通 mutation 完整 ROOT 复制/校验——#134 已知成本域的另一面）、#232（reconciliation 回声）、#233（chunked live update，仅存在于其他分支 `dd2f17a`，未进入本 worktree 基线）；#231 send-failure 观测已在本 HEAD（`4323118`）。若 #233 合入，其分帧传输与本任务关联 ID/分段观测的交互需在设计期复核。
4. 观测落点包边界：跨阶段关联横跨 `@nomicore/ws-replication`（receive/ACK enqueue/socket write/ACK match）与 `@nomicore/namespace-runtime`（sequencer start/protected check/live apply/dirty completion，经 `ReplicationSession.applyRemoteUpdate` 管线）——两包 AGENTS.md 均要求 transport 不得伸入 Runtime 内部，故槽内阶段的时差样本须经 session/内部 seam 结构化导出（emit 仍在槽外），不得由 transport 层直探 Runtime 内部。此为实现边界约束，非冲突。

## 结论

- Verdict 为 **clear**：Issue #238 正文与 Owner 评论的全部要求（分段观测、跨阶段关联 ID、根因修复、安全字段、protocol §23 append-only 更新、确定性反馈循环）与 ADR-0001–0010、0012 全集及 CONTEXT.md 无任何直接违反；无 override 声明需求、无需 Owner 裁决的演进项。
- 任务性质是在 ADR-0010 六步 trusted apply 管线 + ADR-0008 唯一 write sequencer + ADR-0006 dirty notification 契约的既有框架内，补全 observability 缺口并消除造成阶梯占槽的根因——复现机制本身是词汇层已文档化的不变量行为，观测扩展走 §23/ADR-0010 L167 指定的 seam，关联走既有 wire sequence 的连接局部派生。
- 给下游 SA 的红线提醒（非冲突）：观测数据只落 observer/metrics/trace seam，不进 Runtime/Session 公共 status（G2/G4 演进门）；槽序与 FIFO 不动（G1）；受保护判据优化须先评审（G2）；wire 字节不变（G3）；`applyLatencyMs` 既有语义只增不改；无 observer 热路径逐字节等价；探针走注入单调时源、差值入事件；observer throw 隔离与「发射点不入 sequencer 槽」纪律保持。
- 信息充分性：ADR 全集与 CONTEXT.md 已全读；Owner 唯一评论已核（无新增评论）；protocol 相关条款已按 ADR 收录关系核验。唯一缺口为注记 1 的基线复现文件不在 worktree——属任务输入交接事实，已登记，不构成本门禁的信息不足。

Verdict: clear
