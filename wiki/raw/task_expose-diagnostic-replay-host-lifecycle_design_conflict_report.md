# 冲突门禁报告（设计后复审）

> **SA8 设计后复审**。被审对象：SA1 设计 `wiki/raw/task_expose-diagnostic-replay-host-lifecycle_design.md`（R0，633 行，D1–D12 + §5 per-file 设计）。
> 冲突基准 = `docs/adr/` 全部 **13 个文件**（0001–0012，含两个撞号 0012：ADR-0012-LOG / ADR-0012-INSTANCE）+ 根 `CONTEXT.md`，逐个全读，无抽样。
> 前置门禁（verdict `clear`）见 `…_conflict_report.md`；约束清单 `…_relevant_decisions.md` 本次已追加「设计后复审追加」节（SA1 设计引入的决策点）。
> 设计引用的关键事实锚点已逐项实测复核（见「事实锚点复核」节）。

## Verdict

`clear`

## ADR 盘点（设计后复审视角）

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 单一真相源 | accepted | 低 | 无冲突。设计纯消费 #148 冻结 record schema（经日志包），未建任何仓内 schema 文本通道；replay 工具不触发投影/codegen。 |
| ADR-0002 | 重写定位、authority 出范围 | accepted | 无 | 无冲突。设计不含 authority 规则。 |
| ADR-0003 | 求值器与派生 schema | accepted | 无 | 无冲突。 |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 无 | 无冲突。无 PathAt 写路径消费。 |
| ADR-0005 | 投影生成管线 | accepted | 无 | 无冲突。 |
| ADR-0006 | DocPersistence 与 docstore 布局 | accepted | 中 | 无冲突。replay identity 比对源 `META.docId = namespaceId` 正是本 ADR 条款；日志目录（`{logRoot}/namespaces/…`）与 `{rootDir}/users/{userId}/{namespaceId}.snapshot` 物理分离；persistence 排空窗/dispose 不含日志侧 await（§5.3 顺序）。 |
| ADR-0007 | 逻辑验证与 Yjs bridge | accepted | 低 | 无冲突。replay 构造 detached `new Y.Doc()` 属离线工具行为，不触碰 live 写管线与 observer no-rollback；open-path P0 语义未改。 |
| ADR-0008 | Runtime 读写能力与单序列器 | accepted | 高 | 无冲突。§6.1 emit 调用点全清单：#149/#151 emitSlot 仍在公共方法 `.then`（slot 释放后），本票只注入 emitter、零槽体改动（已实测 `diagnostic.ts:174`）；D6 可选第三参不改 `captureSeamInput`/槽序；internal seam 值导出恰两键不变（已实测）。 |
| ADR-0009 | Registry、租约与 Host 生命周期 | accepted | 高 | 无冲突。Registry v1 公共面（open/create/getStatus/shutdown）零扩张——`runtimeEmitterFor` 是构造 options 注入 seam（#150 已落地族）的可选成员，非公共方法；Runtime generation 语义（close→reopen）纯消费；manager.close 挂在 registry.shutdown 之后，不进 Registry 停止等待链。 |
| ADR-0010 | Hub/Peer WebSocket 复制 | accepted | 中 | 无冲突。ws-replication 在 DENY LIST（wire 零改动 = 「不随 Hub/Peer 复制」结构保证）；停止顺序仅在 Registry shutdown 与 Persistence 排空窗之间插入 O(1) diagnostics close，不重排 Registry→Persistence→Timer/Clock；NDJSON 健康事件携带**受控** namespaceId，非「未经控制的 owner/namespace 进默认日志」（见边界审视 2）。 |
| ADR-0011 | Best-effort namespace 诊断变更日志 | accepted | **核心** | 无冲突。五条重放成功条件逐条由 §5.6 算法兑现（genesis/连续/可解码/无损坏/identity）；业务隔离矩阵（§6.4）与「emit/排队/持久化失败不得改变业务结果」「初始化失败不影响 create」「adapter 违约被隔离」字面对应；replay 工具归 Host 工具面、未扩张 Runtime/Lease/DocPersistence/wire 四接口；disclaimer 承载于契约文档正合本文「任何 UI、CLI 和文档都必须展示 best-effort 与 replay 条件」。边界审视 1 记录一处覆盖范围边界读法。 |
| ADR-0012-LOG（vfsl-validated-jsonl-and-framed-sidecar-change-log） | VFSL 校验 JSONL 与 framed sidecar 诊断日志格式 | accepted | **核心** | 无冲突。首切片 amendment write-slot 红线：§6.1 证明本票不新增任何位于 NamespaceRuntime write sequencer slot 内的同步 emit/fs 调用点（Registry create/open/import 槽内接线沿 #150 冲突报告 #1 裁决——条款主语限定 Runtime slot，已核对裁决原文）；不实现 queue/batch/fsync（§8 非目标 1 = 被否条款遵守）；冻结/可调二分落点（D2：updateCapture/inputPolicy 冻结类、retention 可调类、rotate 经 #153 resume 健康证明）与「影响记录解释的配置在 stream 创建时冻结」一致；strict replay 强制、owned bytes、不自动拼接、无 genesis 流「不得声称完整重放」（open 路径诚实缺席）逐条对应；shutdown O(1) 收口满足「不得无限等待日志 sink 或阻塞 Registry/Persistence 停止」。 |
| ADR-0012-INSTANCE | 实例身份与 WebSocket plugin 所有权 | accepted | 低 | 无冲突。diagnostics manager 由 composition root 创建/关闭（boot/performStop），所有权模型与「Composition root 拥有……创建、配置和最终 teardown」一致；Registry plugin inject 依赖表零改动（已实测：nomicoreInstance/clock/timer/nomicorePersistence）；plugin 第二参 host 是注入通道而非 role/instanceId 配置，不触碰 Instance service 单一真相。 |

**盘点注记**（沿前置门禁）：
1. 目录存在两个编号 0012 的 ADR（撞号），均 accepted、均计入基准，以文件标题区分；归档治理建议仍登记在案（非本门禁职责）。
2. 无 ADR 处于 superseded 状态；ADR-0007 的 Runtime/open/read 条款被 ADR-0008 部分取代（取代声明在 0007 文内），本设计不触及该被取代部分（replay 为离线读取，非 Runtime open/read 编排）。
3. 设计全文无「取代 ADR-NNNN」类声明（§0–§12 扫描）；非目标节（§8）对 queue/batch、删除联动等均为**顺延既有 amendment 目标态语义**的显式备案，非推翻。

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | 无 | — | D1–D12、§5 per-file 设计、§6 合规性分析、§8 非目标逐条对照 ADR 全集 + CONTEXT.md，未发现直接违反、未发现推翻声明、未发现未走 supersede 的实质演进。 |

## 高敏边界审视（判 no-conflict 的证据链，供 SA2/总控复核）

以下 6 项是设计中最接近冲突边界的读法，逐项给出条款原文与裁决理由：

### 1. D4 被拒 create 的无归属 emission 丢弃（vs ADR-0011 覆盖范围）

- **条款**：ADR-0011 §覆盖范围「首版应记录所有可能修改 namespace Y.Doc 的路径：namespace create，包括输入、schema、ROOT、duplicate、Persistence 与 post-commit Runtime construction 结局」；§产品契约「日志允许缺失、乱失尾部……系统不承诺 exactly-once、at-least-once、无 gap」。
- **设计决策**：acceptance/validation/persistence 拒绝的 create 尝试（发生在 `initStream` 之前、无已建立 stream）→ dispatcher `unattributed` 丢弃 + 计数事件；设计自辩「ADR-0011『日志允许缺失』+ 不存在可归属的 namespace 目录——唯一不伪造归属的诚实选项」。
- **裁决：no-conflict**。三重依据：(a) ADR-0012-LOG 存储模型「每个 namespace 拥有独立日志空间」（`namespaces/{namespaceId}/…`）结构性排除了无 namespace 流的宿位——发明 namespace-less 流反而需要新 ADR；(b) emission 冻结形状（CONTEXT「语义 emission」+ `emission.ts` 实测）不含 namespaceId，归属只能由接收方路由；(c) 现行身份模型（ADR-0010 #131 修订）下 entry/DOC_DUPLICATE 碰撞只是候选内部重试而非公共结局，「duplicate」作为公共 create 结局已不存在；所有**可归属**结局（#17 committed / #18 runtime-construction fatal / 创建后全部写路径）均被记录。覆盖条款的「应记录」受同 ADR best-effort 缺失许可统辖。**注记**：这是覆盖范围的边界读法而非条款违反；SA2 如认为应建全局 unattributed 流，属新 ADR 演进提议，须走正式流程。

### 2. D8 健康事件携带 namespaceId 进 stdout NDJSON（vs ADR-0011/0010 数据保护）

- **条款**：ADR-0011「日志字段不得进入默认低基数 metrics label」；ADR-0010「Token、Yjs update、SCHEMA/ROOT 内容以及**未经控制的** owner/namespace 不得出现在默认日志或高基数指标标签中」。
- **设计决策**：NDJSON 生命周期事件 `{event:'diagnostic-log', type, namespaceId, …冻结白名单字段}`；自辩 NDJSON 是组合根既有结构化生命周期面、非 metrics label。
- **裁决：no-conflict**。(a) 两条禁令的主语分别是「metrics label」与「高基数指标标签」——NDJSON stdout 事件流两者皆非；(b) ADR-0010 禁令限定「**未经控制的**」namespace——namespaceId 是受控安全文法身份（`ns-`+32hex），经结构化白名单字段输出；(c) 先例已实测：`app.ts` 既有 `provisioned`/`target-added`/`replica-reset` 事件同款携带 namespaceId；(d) 包侧冻结白名单（health.ts 23-117）刻意排除 streamId/segment/offset，设计照抄不扩。**注记**：设计已把 JSDoc 声明 logRoot 继承 namespace 数据同级访问控制列为运维责任面（ADR-0011「`full` 输入与 committed Yjs update 必须由 Host 明确启用」由缺省 `updateCapture:false`/`inputPolicy:'digest'` 兑付）——文档承载而非运行时推断，与 ADR-0011 后果节「数据保护成为显式配置责任」一致。

### 3. open 路径建流无 genesis（vs ADR-0012-LOG「每个新 stream 尽力先记录 genesis baseline」）

- **条款**：「每个新 stream 尽力先记录当前完整 Y.Doc 的 genesis baseline……**genesis 未成功写入时 stream 仍可记录诊断事实，但不得声称完整重放**」。
- **设计决策**：open/import 路径 `ensureAdapter` 不带 genesisBytes（#150 seam 仅 create 槽供给），无 genesis 流 replay 报 `genesis-missing` ≠ complete。
- **裁决：no-conflict**。「尽力」受同句容忍条款统辖（无 genesis 流合法存在、代价仅是不可声称完整重放——设计逐字兑付）。管理器不接触 Y.Doc 的结构隔离（§6.2）本身是 ADR-0011 业务隔离偏好的加强。正常重启（E5）走 current.json 续写既有 stream，genesis 保留首条，不落入本边界。

### 4. Registry create/open/import 槽内的同步 File adapter fs（vs ADR-0012-LOG amendment write-slot 红线）

- **条款**：「任何将 File adapter 的 `emit` 接入 namespace 生命周期的调用点，必须位于 **NamespaceRuntime write sequencer slot** 之外，或在该 slot 已释放之后」；#153 纪律「构造期同步 fs 必须在 write sequencer slot 外」（包 AGENTS 冻结面）。
- **设计决策**：`initStream`→adapter 构造（mkdir/manifest/genesis append/current.json rename + O(stream) reopen 健康分析）位于 Registry create/open/import 槽（Runtime sequencer 尚不存在）。
- **裁决：no-conflict**。条款主语精确限定 Runtime write sequencer slot；Registry lifecycle slot 与 Runtime write sequencer 是 ADR-0011「继续由现有 Registry lifecycle slot 或 namespace write sequencer 决定」明文并列的两个排序机构。此读法非本设计新创——#150 设计后冲突报告 #1 已以同等条款裁决同款接线 no-conflict（裁决原文已核对）；本票对 create 槽接线零改动。open 槽构造的 O(stream) 成本已被设计 D3 显式备案（每 ns 每进程一次）。

### 5. replay 工具在 app 侧解析 current.json locator（vs CONTEXT「storage projection 归 adapter」）

- **条款**：CONTEXT「storage projection：日志 adapter 独占的**物理表示决策**——先决定 inline/sidecar 并构造最终 record……emitter 只做语义投影，不构造物理字段」。
- **设计决策**：§5.6 ① 在 app 工具内读 `{rootDir}/namespaces/{namespaceId}/current.json`；但**逆向物化**（frame/inline carrier → owned bytes）作为存储投影的逆面收口在日志包（D10 `materializeStrictRecordUpdate` 增量导出，实现只消费包内原语）。
- **裁决：no-conflict**。CONTEXT 词条定义的是**写路径** emission→record 的物理构造归属（emitter 不构造物理字段——设计零触碰）；逆向读取冻结布局是 ADR-0012-LOG 明文预期的离线工具用途（后果节「manifest 自描述有利于离线工具解释旧日志」，current.json 是「可重建 locator 而非完整性证明」），无条款保留 locator 解析独占权。真正的高危双源（Base64 canonical/frame 25 字节/CRC 输入域）已由 D10 收口包内。**注记**：locator 文法成为 app 第三消费点属设计质量议题（SA2 可攻击是否应导出包内 locator 原语），非 ADR 冲突。

### 6. §5.6 算法边界：genesis 前置被跳过的 update 记录（供 SA2 攻击的边界注记，非冲突）

- D12 的 `genesis-misplaced` 触发条件为「genesisSeen 或 applied > 0」；若篡改流形如 [update(1..k), genesis(k+1), …] 且 k 条 update 均因 genesisSeen=false 被跳过（applied 恒 0、lastSeq 不动、expectedNext 为 null），mid-stream genesis 将被当作合法基线应用，终态可能 `issues === []` → complete。**终态正确性**由 CRDT 幂等兜底（genesis 是后于 update(1..k) 的全量基线，效果包含其增量，最终 doc 状态与逐条应用等价）；且该流形只能由人为篡改/adapter bug 产生（合法 writer 只在 stream 建立时写首条 genesis）。ADR 五条件的字面（genesis 有效/连续/可解码/未观察到损坏/identity）在该读法下均可主张成立。**裁决：no-conflict**——设计的已声明意图（misplaced genesis → partial）与 ADR 一致，此处是触发条件边界完备性问题，属 SA2/SA3 攻击面（建议：触发条件并入「存在前置 attempt 记录」或在设计中补 CRDT 等价性论证），不构成对任何条款的推翻或违反。

### 其他核对项（简记）

- **AC2 目标态措辞**：AC 的「queue、batching、flush、fd、metrics tuning 可调」不要求暴露配置面——amendment 明文「（首切片未提供即可调整项，仅指未来切片）」；设计只暴露 retention（可调类），§8 非目标 1 拒绝 queue/batch = 被否条款「现在直接实现异步 queue/batch 以回避文本修订」的遵守。
- **D9 三态仲裁**：ADR 只冻结「七类缺陷 ≠ complete」；failed=无基 / partial=有基不完整的细分属 SA6 注记 2 显式让渡给设计的裁决权；R11=failed 钉死被遵守。
- **D12 新 issue 码**：CONTEXT 冻结的是 **update-omitted reason** 词表（v1 三值）——设计的 ReplayIssue `code` 是另一词表域，物理类零新码、语义类逐条溯源 ADR 条款；update-omitted reason 仅透传不发明。
- **Host 数据删除联动顺延**（§8 非目标 4）：ADR-0012-LOG「Host 执行数据删除请求时必须同时调用日志删除能力」是条件条款，app 现无数据删除面 → 前件不成立；设计显式备案待相应票，非违反。
- **术语纪律**：stream generation（D2/AC2）与 Runtime generation（D3/AC3）全程分用（§6.3 显式）；无 WAL/审计账本/event-sourcing 误称；genesis baseline 公共面未新增构造路径（D10 只做逆向读取）。

## 事实锚点复核（设计 P1–P7 与关键自证，SA8 实测）

| 锚点 | 验证方式 | 结果 |
|---|---|---|
| P4 create 槽同步窗（initStream→factory→#17/#18 同步续段、零 await） | `sed -n '1410,1440p' packages/namespace-registry/src/registry.ts` | ✅ `encodeDetachedState → diag.initStream(id.namespaceId, state?.slice()) → try { factory → makeEntry → diag.emitOutcome(#17) } catch { diag.emitOutcome(#18) }`，`await createDoc` 之后同一同步续段 |
| emission 不携带 namespaceId（D4 前提） | `read packages/namespace-diagnostic-log/src/emission.ts:33-51` | ✅ `NamespaceDiagnosticChangeEmission` 字段表无 namespaceId |
| D8 NDJSON 携 namespaceId 先例 | `grep "event: 'provisioned'|'target-added'|'replica-reset'" apps/yjs-server/src/app.ts` | ✅ 三事件均携 namespaceId（:328/:583/:762） |
| #149/#151 emitSlot 槽外纪律 | `grep emitSlot packages/namespace-runtime/src/diagnostic.ts` | ✅ 文件头明文「emitSlot 由公共方法的 `.then` 回调调用」（ADR-0012 amendment C）；本票零改动该文件（DENY） |
| #150 冲突报告 #1 裁决（Registry create slot 合规） | `grep create slot wiki/raw/task_namespace-diagnostic-change-log_design_conflict_report.md` | ✅ 裁决原文逐字支持「条款主语限定 NamespaceRuntime write sequencer slot」读法 |
| internal seam 恰两键值导出 | `cat packages/namespace-runtime/src/internal.ts` | ✅ 值导出恰 `createNamespaceRuntimeForRegistry` + `openReplicationSessionCoreForRegistry`；工厂现两参（设计加可选第三参不改键集） |
| plugin config 键集冻结 + 三处 factory 调用点 | `sed plugin.ts:160-185`、`grep "factory(handle" registry.ts` | ✅ 单参工厂 + `{idleTimeoutMs}`；调用点 :1211/:1420/:1557 与设计 §12 审计一致 |
| file.ts 工厂不抛 + locator 三分支 | `sed file.ts:240-296` | ✅ 「绝不向 Host 抛」契约注释 + explicit/locator/recovered/fresh/ambiguous 分支 |

## 结论

**Verdict：`clear`——放行（设计后复审通过，交 SA2 全维度攻击评审）。**

- 冲突点数：**0**；裁决分布：no-conflict × 全部对照项（含 6 项高敏边界审视），override-declared × 0，evolution × 0，hard-violation × 0。
- 前置门禁 4 条强约束提示逐条核销：(1) emit 调用点位置——§6.1 全清单证明零新增 slot 内调用点；(2) queue/batch 演进条件——未引入（§8 非目标 1），retention 可调类暴露合规；(3) 术语纪律——全程分用、reason 词表未动；(4) shutdown 有界——O(1) 结构性收口，Registry/Persistence 等待链零日志侧 await。
- 设计的红线清单 10 条（`…_relevant_decisions.md`）全部满足；对红灯契约（SA6 PROPOSAL 面）逐字采纳（D1），仲裁偏离面为零。
- 无需 override；无需 Jim 裁决条目。
- **移交 SA2 的注记**（不构成冲突）：边界审视 6（genesis-misplaced 触发条件完备性）与边界审视 5（locator 解析第三消费点）建议 SA2 优先攻击；边界审视 1（无归属 create 丢弃）如未来需全局流属新 ADR 演进，须走正式流程。

---

*SA8 设计后复审完——控制权交回总控。*
