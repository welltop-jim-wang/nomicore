# 冲突门禁报告

> SA8 前置门禁（Phase 0）。被审对象：任务简报 `wiki/raw/task_diagnostic-log-stream-roll-repair.md`（Issue #153 round=1，功能开发）。
> 冲突基准：`docs/adr/` 全集（11 个文件，逐个全读）+ `CONTEXT.md`。代码与 wiki 其他档案（#148/#152 契约、R2 设计）不构成自动阻塞依据。
> 盘点注记：ADR-0011/0012 正文引用「ADR 0010 trusted replication」，但 `docs/adr/` 无 0010 文件——不构成本门禁基准的一部分；#152 R2 冲突报告的 evolution 项（同步 append 取代 queue/batch）已由 2026-08-28 amendment 以正式修订节落入 ADR-0012 正文（「取代」关系明示），现为现行条款，不再是未落地演进。

## Verdict

`clear`

五个范围项（续写 reopen / segment 滚动 / 启动尾部修复 / 耗尽 / 崩溃窗口测试）逐条对照：全部是 ADR-0012（含 amendment）已接受条款的直接实施，无 override 声明、无未走正式 supersede 的演进意图、无直接违反。简报对仅有的两处 ADR 留白（roll targets 冻结归类、健康事件词表演进）均显式声明了按 ADR 判定的路径，属门禁放行、设计钉死范畴。

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted（2026-08-19 修订） | 间接（record schema 冻结纪律的根源） | no-conflict |
| ADR-0002 | nomicore 是重写，authority 出范围 | accepted | 否 | no-conflict |
| ADR-0003 | 求值器与派生 schema | accepted | 否 | no-conflict |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 否 | no-conflict |
| ADR-0005 | 投影生成管线 | accepted | 否 | no-conflict |
| ADR-0006 | Cordis 持久化插件 | accepted（含两轮 owner 修订） | 间接（日志≠Persistence；snapshot 面不得触碰） | no-conflict |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge | accepted；open/read 部分被 0008 取代 | 否（被取代范围不构成约束） | no-conflict |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含稳定码注册修订） | 是（amendment write-slot 纪律的依据） | no-conflict |
| ADR-0009 | NamespaceRegistry/租约/Host 生命周期 | accepted | 间接（Runtime generation 更迭下 stream 存续；shutdown 不等日志） | no-conflict |
| （0010） | trusted replication（被 0011/0012 引用） | **文件不存在于 docs/adr/** | 否 | 不在基准内（盘点注记） |
| ADR-0011 | Best-effort namespace 诊断变更日志 | accepted | 是（业务隔离、健康 observer、数据保护） | no-conflict |
| ADR-0012 | VFSL JSONL 与 framed sidecar 日志格式 | accepted（含 2026-08-28 首切片 amendment） | 是（本票主规范，逐节对应） | no-conflict（含 7 条钉死语义，见下） |

## 冲突点

无阻塞冲突。以下为逐条裁决记录（均为 no-conflict，其中 #1/#2/#4 为设计必须钉死的语义约束，SA1/SA2 重点核验）：

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | info（留白归类） | ADR-0012 §Segment rolling：「影响记录解释的配置在stream创建时冻结；包括record/schema/frame版本、committed update capture、input capture policy、inline threshold与line上限。冻结项改变时新建stream generation。retention、queue容量、batch/flush策略、fd cache与metrics sampling可动态调整。」；§File adapter 布局：「manifest.json 创建后不可变，**至少保存**：……」 | 简报范围 2：「三个 target 可配置并进 manifest 冻结面（如属『影响记录解释的配置』须按 ADR 判定）」 | **no-conflict** | roll targets 未出现在 ADR 任一清单中（冻结清单与动态清单均为「包括」式非穷举），manifest 保存项为「至少」式非穷举——把 targets 写入 manifest 并归入冻结面是**清单空间的扩展**而非违反：更保守（多冻结一项、变更即新建 generation），与「冻结项改变时新建stream generation」机制自洽。简报已显式声明按 ADR 判定，非擅断。SA1 须给出归类结论与依据；若改选动态调整分支，亦须论证不落入「影响记录解释」范畴且与动态清单同类。两分支都不构成 hard-violation。 |
| 2 | info（析取收窄） | ADR-0012 §JSONL record：「达到 uint64 最大值后 stream 进入 exhausted，后续日志 emission 丢弃并上报，业务不受影响。」；§Segment rolling：「达到`99999999`后stream进入exhausted，后续日志丢弃并上报，业务不受影响。」 | Issue 正文："exhaustion … move future logging to an honest new generation **or** disabled stream"；简报范围 4：「两条路径的显式行为」（未择支） | **no-conflict**（钉死 disabled 分支） | issue 的析取被 ADR 收窄：两条耗尽路径（sequence uint64 / segment 99999999）的现行条款均为「丢弃并上报」＝disabled stream，**不是**新建 generation。简报未择支、要求「显式行为」，遵 ADR 即得唯一解。SA1 若将耗尽设计为新建 generation 续写，将直接违反上述两条款原文——那才是 hard-violation；新建 generation 仅适用于 corrupt/incompatible/冻结配置改变/无法安全续写（§Stream 与 generation、§打开与尾部恢复）。 |
| 3 | info（被取代条款） | ADR-0012 amendment（2026-08-28）：「每个 `emit` 在调用栈内执行至多一条 final JSONL record 的有界同步 append……该首切片不维护 writer queue、不做 batch flush、不提供 fsync 开关，也不保持常驻 file descriptor。」；「任何将 File adapter 的 `emit` 接入 namespace 生命周期的调用点，必须位于 NamespaceRuntime write sequencer slot 之外……不得在 slot 内执行同步 File adapter `emit`。」 | 简报 AC1："one logical writer per namespace stream"；明确排除：「不引入 writer queue/batch/fsync/常驻 fd（ADR-0012 amendment 首切片边界）」 | **no-conflict** | 修正前「内部每个 stream 同时最多一个逻辑 writer queue」句已被 amendment 在首切片范围内明示取代，不构成约束；AC1 的单逻辑 writer 是语义要求（stream 不绑定 Runtime generation、跨 Runtime generation 有序 append，对应门槛 12），与同步有界 append 并行不悖。简报排除 queue/batch 是忠实执行 amendment 而非推翻它；queue/batch 为「目标演进形态」，本票不实施属范围选择。**钉死**：reopen 健康检查与尾部修复中的任何同步文件操作同样不得置于 namespace write sequencer slot 内（amendment 接线纪律为规范性条款）。 |
| 4 | info（词表演进路径） | ADR-0012 §打开与尾部恢复：「自动修复通过observer上报。」；§VFSL record schema：「observer只包含稳定 code、schema id/fingerprint、operation、source module、VFSL issue codes/paths与 projected record byte size；不包含原 record、input、Base64、update bytes、底层 message、Error/cause或stack。」；ADR-0011：「日志字段不得进入默认低基数 metrics label。」 | 简报 AC3："reporting each repair through logger health observability"；明确排除：「新增健康事件成员须走 #148 §10-J13 式预授权路径，由 SA1 设计、SA8 对照 ADR 裁决」 | **no-conflict** | 修复经健康 observer 上报是 ADR-0012 的**强制**要求，新增健康事件成员是该要求的落实而非违反；#148 冻结面是任务/代码层契约（wiki 档案），按技能边界不构成自动阻塞基准，但简报已自设预授权路径，且 ADR 侧约束齐备：稳定码、受控字段、无敏感内容、低基数。SA1 设计的新事件形状须满足上述 observer 内容纪律（设计后复审逐条核验）。 |
| 5 | info（隐含义务） | ADR-0012 §Stream 与 generation：「每个新 stream 尽力先记录当前完整 Y.Doc 的 genesis baseline……genesis 未成功写入时 stream 仍可记录诊断事实，但不得声称完整重放。」 | 简报范围 3：中间损坏等「旧 stream 只读 + 确定性新 generation 或 disabled stream」——未明写 genesis | **no-conflict** | 简报未提议省略 genesis；新建 generation 时尽力写 genesis baseline 是 ADR 既有义务（#152 已有内部构造路径，CONTEXT.md「由 #152 adapter 内部构造」）。列为相关决议供 SA1 显式覆盖，防遗漏。 |
| 6 | info（处置选项） | ADR-0012 §File adapter 布局：「locator 损坏时不得按 wall clock 静默猜测最新 stream；扫描 manifests 后必须作确定性恢复或要求显式处置。」；§Stream 与 generation：「碰撞时有限重试；耗尽只使日志能力不可用并上报健康故障，不改变 namespace 业务结果。」 | 简报 AC4："unsafe locator ambiguity never rewrite history… a new generation is selected deterministically **where allowed**"；范围 1：「locator（current.json）确定性解析与歧义处置」 | **no-conflict** | 「disabled stream」是 ADR 明文支持的终态（显式处置／日志能力不可用+健康上报），且符合 ADR-0011 业务隔离（禁用日志而非影响业务）。"where allowed" 与「确定性恢复**或**显式处置」一一对应。**钉死**：禁止按 wall clock 猜测（mtime/目录序等均为 wall clock 变体）；「确定性」指恢复/选择过程，新 streamId 取值本身是 CSPRNG（§Stream 与 generation）。 |
| 7 | info（措辞精度） | ADR-0012 §打开与尾部恢复：「只自动修复可以证明的最终尾部：」（原文为三条列表项）「截断**最终**不完整 JSONL 行；」「截断**最终**不完整 frame；」「截断完整但未被任何完整 JSONL record引用的**尾部** orphan frames。」 | AC3（逐字）："truncates only incomplete **final** JSONL lines, incomplete final frames, and complete unreferenced tail frames" | **no-conflict** | AC 与 ADR 语义一致（复数为泛指措辞）。以 ADR 文本为准钉死可修复集为**后缀性质**：不完整行/帧只能是文件最末一个；orphan frames 必须是尾部连续未被引用的后缀——夹在已引用帧之间的孤儿帧、其后还有完整数据的「不完整行」均属中间损坏，不修复、旧 stream 只读 + 新 generation。SA1 须给出「可证明尾部」的严格判定式。 |

## 结论

**Verdict: `clear`，放行进入 SA1 设计。** 无 hard-violation、无 override-declared、无 evolution。

随报告移交 SA1/SA2 的钉死约束（均已在冲突点表与相关决议文档中给出原文依据）：

1. **耗尽＝丢弃并上报（disabled）**，不得新建 generation 续写（冲突点 #2）；
2. **roll targets 冻结归类**须给出结论与 ADR 依据，manifest 追加字段合法且创建后不可变（冲突点 #1）；
3. **write-slot 纪律**覆盖 reopen 检查与尾部修复的一切同步文件操作；不引入 queue/batch/fsync/常驻 fd（冲突点 #3）；
4. **修复上报事件**走预授权路径设计，内容限于稳定码与受控字段，遵守 observer 数据纪律与低基数要求（冲突点 #4）；
5. **新建 generation 尽力写 genesis baseline**；不按 wall clock 猜测 locator；「可证明尾部」按后缀性质严格判定（冲突点 #5/#6/#7）；
6. AC1「across Runtime generations」指 stream 跨 Runtime generation 存续（stream 不绑定 Runtime generation），不得与 stream generation 概念混同（CONTEXT.md _Avoid_ 项）。

设计后复审（SA1 产出后）将按本报告七条钉死语义逐条复核，并追加设计引入的新决策点到相关决议文档。
