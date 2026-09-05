# 冲突门禁报告

> SA8 前置门禁（审任务简报 `wiki/raw/task_expose-diagnostic-replay-host-lifecycle.md`，Issue #155，feature）。
> 冲突基准 = `docs/adr/` 全部 13 个文件 + 根 `CONTEXT.md`，逐个全读，无抽样。
> 配套产出：`wiki/raw/task_expose-diagnostic-replay-host-lifecycle_relevant_decisions.md`（约束清单，全链 SA 复用）。
> **恢复复核对（2026-09-03，总控恢复运行触发）**：`docs/adr/` 13 文件与 `CONTEXT.md` 全量重读（`git diff` 证明基准与 HEAD 一致、worktree 零改动）；本报告原有摘录与裁决逐条比对 ADR 原文无出入。简报在原门禁后追加了「SA6 红灯契约记录」附录——本报告新增该附录的对照覆盖（见「简报附录对照」节）。verdict 不变：`clear`。

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 单一真相源 | accepted | 低 | 无冲突。日志 record schema 属 ADR-0012-LOG 内建冻结 VFSL schema（`nomicore.namespace-diagnostic-change-record@1`），简报未要求仓内 schema 文本通道。 |
| ADR-0002 | 重写定位、authority 出范围 | accepted | 无 | 无冲突。简报不涉及 authority 规则。 |
| ADR-0003 | 求值器与派生 schema | accepted | 无 | 无冲突。 |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 无 | 无冲突。本任务消费面为日志工具/Host 配置，不涉及 PathAt 投影写路径。 |
| ADR-0005 | 投影生成管线 | accepted | 无 | 无冲突。同上。 |
| ADR-0006 | DocPersistence 与 docstore 布局 | accepted | 中 | 无冲突。AC1「不写入 Persistence snapshots」与 snapshot 仅含 SCHEMA/META/ROOT、日志目录独立（ADR-0012-LOG「日志生命周期不与namespace snapshot Persistence自动绑定」）一致。 |
| ADR-0007 | 逻辑验证与 Yjs bridge | accepted | 低 | 无冲突。replay 属离线 strict 工具行为，不触碰 live 写管线；observer no-rollback 与日志隔离同族不冲突。 |
| ADR-0008 | Runtime 读写能力与单序列器 | accepted | 高 | 无冲突。简报未要求 emit 进入 sequencer slot；ADR-0012-LOG amendment 的「slot 外接线」红线对 #155 生效，简报 AC 与之相容（见冲突点表注记 1）。 |
| ADR-0009 | Registry、租约与 Host 生命周期 | accepted | 高 | 无冲突。AC3「多 Runtime generations / bounded drain」与 shutdown 语义（Runtime close 排空已接纳写、Registry shutdown 聚合 close）相容；日志 drain 为 best-effort 旁路，不进 barrier。 |
| ADR-0010 | Hub/Peer WebSocket 复制 | accepted | 中 | 无冲突。AC1「不写入 replication wire state」=「不随 Hub/Peer 复制」原文；Hub/Peer 独立启用 = 每实例本地旁路配置；停止顺序不被日志阻塞为既有条款。 |
| ADR-0011 | Best-effort namespace 诊断变更日志 | accepted | **核心** | 无冲突。AC 的健康面、bounded drain、replay 条件、best-effort disclaimer 均为本文条款的字面对应（详见冲突点表注记）。 |
| ADR-0012（vfsl-validated-jsonl-and-framed-sidecar-change-log，下称 ADR-0012-LOG） | VFSL 校验 JSONL 与 framed sidecar 诊断日志格式 | accepted | **核心** | 无冲突。AC1–AC6 逐条为本文 §Stream / §Writer / §Strict reader / §Segment rolling / 验收门槛的字面复述或直接推论；本任务且被本文首切片 amendment 点名为接线修复票。 |
| ADR-0012（instance-identity-and-websocket-plugin-ownership，下称 ADR-0012-INSTANCE） | 实例身份与 WebSocket plugin 所有权 | accepted | 低 | 无冲突。日志配置/drain 归 composition root/Host 旁路，不改变 Registry/Persistence/WS plugin 所有权与 teardown 分工；不涉及 instanceId/role 配置。 |

**盘点注记**：
1. 目录中存在两个编号为 0012 的 ADR（撞号），两者均 accepted、均计入基准；本报告以文件标题区分。建议后续归档治理修正编号（非本门禁职责，仅登记）。
2. 无任何 ADR 处于 superseded 状态；ADR-0007 的 Runtime/open/read 条款被 ADR-0008 部分取代（其取代声明在 0007 文内），本任务不触及该被取代部分。

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | 无 | — | 任务简报 6 条 AC 与总体描述逐条对照 ADR 全集，未发现直接违反、未发现推翻声明、未发现未走 supersede 的实质演进。 |

**逐 AC 对照明细**（无冲突的证据链，供复核）：

| 被审对象条款 | 对照 ADR 条款（原文关键句） | 结论 |
|---|---|---|
| 总述「independently enable Hub and Peer logging」 | ADR-0012-LOG「日志启用与配置是本地 Host/Registry 旁路状态……也不随 Hub/Peer 复制」+ ADR-0010 每实例独立 Persistence/Registry | no-conflict（各实例本地旁路的自然推论） |
| 总述「tune non-format policy, inspect health」 | ADR-0012-LOG「retention、queue容量、batch/flush策略、fd cache与metrics sampling可动态调整」+ ADR-0011「尽力上报 dropped count、sink failure 和 queue health」 | no-conflict |
| 总述「drain best-effort during shutdown」 | ADR-0011「Host shutdown 可 best-effort drain 日志，但 Registry/Persistence 的停止不得无限等待日志 sink」 | no-conflict |
| 总述「owned snapshot bytes with an honest complete, partial, or failed report」 | ADR-0012-LOG「replay不暴露live Y.Doc，只返回owned snapshot bytes与结构化报告 { status: 'complete' \| 'partial' \| 'failed' … }」 | no-conflict |
| AC1 启用从创建起、不写入 SCHEMA/META/ROOT/snapshot/wire | ADR-0011「启用与否在 namespace 创建时确定」+ ADR-0012-LOG「不写入 namespace `SCHEMA`、`META` 或 `ROOT`，也不随 Hub/Peer 复制」「初始化失败不影响 namespace create」「日志生命周期不与namespace snapshot Persistence自动绑定」 | no-conflict（字面复述） |
| AC2 格式策略→新 generation；非格式可调不改解释 | ADR-0012-LOG「影响记录解释的配置在stream创建时冻结……冻结项改变时新建stream generation。retention、queue容量、batch/flush策略、fd cache与metrics sampling可动态调整」 | no-conflict（字面复述；见注记 1） |
| AC3 多 Runtime generations 共享单 writer；shutdown 有界 drain | ADR-0012-LOG「多 Runtime generation 共享 namespace stream 的同一 writer queue，stream不绑定 Runtime generation」+ 验收门槛 12/13 + ADR-0011 时序节 | no-conflict（字面复述；见注记 2） |
| AC4 strict replay、有效 genesis、连续 committed updates、detached owned bytes、不暴露 live Y.Doc、不自动拼接 generations | ADR-0012-LOG「replay强制strict」「工具不自动串联多个generation」+ ADR-0011 重放五条件 + CONTEXT「各 generation 不自动拼接重放」 | no-conflict |
| AC5 complete 仅限冻结连续性条件；七类缺陷→partial/failed；保留 disclaimer | ADR-0012-LOG「只有存在有效genesis、records连续、所有必要updates可解码且校验通过、无已知gap/截断/损坏/不兼容，并且重放后受控identity匹配时才能返回complete。retention裁剪、update omitted、缺genesis或generation断裂只能返回partial/failed。即便complete也只证明……不证明与生产namespace完全一致」 | no-conflict（七类逐项覆盖：missing genesis / omitted updates / retention cuts / gaps / corruption / identity mismatch / incompatible formats） |
| AC6 E2E 场景组合（create、ROOT/SCHEMA、replication、restart、retention、logging failure、Host shutdown、三态 replay） | ADR-0012-LOG 验收门槛 1–15 + ADR-0011 覆盖范围（create/ROOT/SCHEMA/replication/management） | no-conflict |
| Blocked by #149/#150/#151/#153/#154 | 非约束冲突项；ADR-0012-LOG amendment 点名「#149–#151/#155」为接线修复票 | no-conflict（依赖声明，符合切片顺序） |

**简报附录「SA6 红灯契约记录」对照（2026-09-03 恢复核对新增；该附录为原门禁后简报追加段）**：

| 被审对象条款 | 对照 ADR 条款（原文关键句） | 结论 |
|---|---|---|
| PROPOSAL `AppConfig.diagnostics`（enabled/rootDir/retention?/updateCapture?/inputPolicy?；hub/peer 通用、本地旁路） | ADR-0012-LOG「日志启用与配置是本地 Host/Registry 旁路状态，不写入 namespace `SCHEMA`、`META` 或 `ROOT`，也不随 Hub/Peer 复制」+ 冻结/可调二分「committed update capture、input capture policy、inline threshold与line上限」冻结 / 「retention、queue容量、batch/flush策略、fd cache与metrics sampling可动态调整」 | no-conflict（暴露面落点与二分类目逐项对应：updateCapture/inputPolicy 冻结类、retention 可调类；键名仲裁权简报显式让渡 SA1/SA2，属授权非冲突） |
| PROPOSAL `replayNamespaceDiagnosticLog` 报告形状 `{ status; lastAppliedSequence; issues; snapshot? }` | ADR-0012-LOG「replay不暴露live Y.Doc，只返回owned snapshot bytes与结构化报告 `{ status: 'complete' \| 'partial' \| 'failed'; lastAppliedSequence: string \| null; issues: ReplayIssue[]; snapshot?: Uint8Array }`」 | no-conflict（逐字段取冻结形状） |
| replay 工具归 yjs-server 入口（Host 工具面） | ADR-0011「完整查询、导出、重放、保留与健康检查属于日志存储/工具模块的 interface，不扩张 `NamespaceRuntime`、`NamespaceLease`、`DocPersistence` 或 replication wire interface」 | no-conflict（归属提案与本文一致；最终仲裁 D1/D10 见设计后复审，verdict 亦 `clear`） |
| 红灯形态（22/22 FAIL、零生产代码改动；夹具探针已删除） | 非约束冲突项——测试文件与运行命令不触及任何 ADR 条款 | no-conflict |
| 覆盖矩阵锚点：E3 重启 streamId 不变/单 writer/genesis 首条；R10 冻结策略改变→rotate；R11 无日志=failed | ADR-0012-LOG「正常重启继续健康 stream」「多 Runtime generation 共享 namespace stream 的同一 writer queue，stream不绑定 Runtime generation」「冻结项改变时新建stream generation」「工具不自动串联多个 generation」+ 三态报告条款（缺 genesis → partial/failed） | no-conflict（E5 重启链路 fixture 复核风险为 SA6 注记 3 显式让渡项，已由 SA3 最终回归吸收，见 `…_sa3_final_regression.md`） |
| 依赖/风险注记 2「partial/failed 精确取值未冻结」 | ADR 只冻结「七类缺陷 ≠ complete、complete 仅限五条件」（ADR-0011 五条件 + ADR-0012-LOG strict reader）；细分语义让渡设计裁决 | no-conflict（让渡声明，非推翻；D9 已裁决 failed=无基/partial=有基不完整） |

## 结论

**Verdict：`clear`——放行。**

- 冲突点数：**0**；裁决分布：no-conflict × 全部对照项，override-declared × 0，evolution × 0，hard-violation × 0。
- 任务简报实质是 ADR-0011 + ADR-0012-LOG 的 Host/Registry 暴露与接线收口票（issue #155 被 ADR-0012-LOG 首切片 amendment 明文点名），所有 AC 均为既有决策的字面复述或直接推论，无推翻任何 ADR 的意图。
- 无需 override；无需 Jim 裁决条目。
- **恢复复核对结论（2026-09-03）**：ADR 全集（13 文件，含两个撞号 0012）+ `CONTEXT.md` 全量重读，基准与 HEAD 一致（worktree 零改动）、无新增/被取代状态变化；原有对照项与新增「SA6 红灯契约附录」对照项均维持 no-conflict；冲突点数仍为 **0**，verdict `clear` 复核成立。链路一致性：设计后复审（`…_design_conflict_report.md`）verdict 亦为 `clear`，与本前置门禁无裁决分歧。

**给 SA1/SA2 的强约束提示**（不构成冲突，但违反即会在设计后复审判 hard-violation，摘自 `task_expose-diagnostic-replay-host-lifecycle_relevant_decisions.md` 红线清单）：

1. **emit 调用点位置**（ADR-0012-LOG amendment，点名 #155）：任何将 File adapter `emit` 接入 namespace 生命周期的调用点，必须位于 NamespaceRuntime write sequencer slot 之外或 slot 已释放之后；不得在 slot 内执行同步 `emit`。简报 AC 未显式重述此条，SA1 设计必须显式满足。
2. **queue/batch 演进条件**（ADR-0012-LOG amendment）：AC2/AC3 的「queue、batching、flush tuning」与「bounded drain」属目标态语义；若 SA1 设计引入异步 writer queue / batch flush，须保持 emitter 公共 seam、record schema、manifest policy 与 write-slot 隔离不变，并另行定义 close/shutdown、flush、队列满语义——否则违反 amendment「现在直接实现异步 queue/batch 以回避文本修订」被否条款。
3. **术语纪律**（CONTEXT）：stream generation（AC2）≠ Runtime generation（AC3）≠ replication epoch；replay 不自动跨 generation 拼接；update-omitted reason 词表 v1 冻结三词，新增须过设计评审。
4. **shutdown 有界**（ADR-0011/0012-LOG/0009/0010 叠加）：drain 为 best-effort、不得无限等待日志 sink、不得阻塞 Registry shutdown / Persistence dispose，也不得进入 Runtime close barrier 排空路径。
