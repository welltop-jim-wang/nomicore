# 冲突门禁报告（设计后复审）

> SA8 设计后复审（Phase 2）。被审对象：`wiki/raw/task_root-schema-diagnostic-change-log_design.md`（SA1，2026-08-29，Issue #149 round=1，Bug 修复；父 PR #142）。
> 冲突基准：`docs/adr/` 全集（11 个文件，逐个全读：0001–0009、0011、0012）+ `CONTEXT.md`。代码与 wiki 其他档案不构成自动阻塞依据。
> 复审方法：以前置门禁报告（`task_root-schema-diagnostic-change-log_conflict_report.md`，verdict `clear`）七条钉死语义逐条复核 + 对设计新引入决策点（D-A/D-B/D-C、seam 扩展、映射表、依赖层）作全量 ADR 对照；不重复前置门禁的全量盘点论证。
> 盘点注记（沿前置门禁）：`docs/adr/` 无 0010 文件——ADR-0011/0012 引用的「ADR 0010 trusted replication」不在基准内；本票不涉 replication 路径。ADR-0012 的 2026-08-28 首切片 amendment 为现行条款且点名 #149 为接线责任票。

## Verdict

`clear`

设计是前置门禁七条钉死语义的忠实落地：owned bytes 走事务投递面而非公共返回形状（钉死 #1）；emit 调用点结构性位于 write slot 之外（钉死 #2，amendment C）；词表零新造——25 个结局点的 stage/code/result 全取冻结词表与既有稳定码注册表（钉死 #3）；输入零额外读取——not-accessed / 单一冻结快照 / unsafe-input 四态映射（钉死 #4）；日志故障全隔离、零接触能力态（钉死 #5）；P0/close 零 emit（钉死 #6）；emission 纯语义面、无物理字段、无 genesis 路径、live Y.Doc 不逃逸（钉死 #7）。无 override 声明、无未走正式 supersede 的演进意图、无直接违反。下列 10 条均为 info 级裁决记录（no-conflict），其中 3 条附边界注记移交后续票/SA2。

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19/08-21 修订） | 间接 | no-conflict——设计不改 record schema 版本/指纹、不新增 operation（§10.1 词表保真） |
| ADR-0002 | nomicore 重写，authority 出范围 | accepted | 否 | no-conflict |
| ADR-0003 | 求值器与派生 schema（ROOT 约定） | accepted | 间接 | no-conflict——ROOT 固定 Y.Map 是操作对象前提，设计不触碰 |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 否 | no-conflict |
| ADR-0005 | 投影生成管线 | accepted | 否 | no-conflict |
| ADR-0006 | Cordis 持久化插件 | accepted（含两轮修订） | 间接 | no-conflict——notifyDirty→saveDoc 脏通知槽序不动（S6 先于槽外 emit）；persistence 包在 DENY 清单 |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge | accepted；open/read 条款被 0008 取代 | 是 | no-conflict——`{ok:true}` 公共返回形状冻结（doc-runtime 零改动）；捕获 handler 无可抛点（observer 不向事务调用栈抛异常）；零写入承诺不触碰（冲突点 #1） |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 2026-08-24 稳定码注册修订） | 是（接线宿主） | no-conflict——S1–S7 槽序零重排；稳定码零新增（errors.ts/p0.ts 既有注册表）；「已排队后续写零输入访问」由 R2/S2′a not-accessed 镜像；seam 扩展为加法可选字段（冲突点 #6）；公共导出面零变化 |
| ADR-0009 | NamespaceRegistry/租约/Host 生命周期 | accepted | 间接 | no-conflict——Registry 零改动（接线属后续票）；clock 缺省 `Date.now()` 的 No-fallback 纪律辖 Registry/Persistence 而非 namespace-runtime（冲突点 #4 边界注记） |
| （0010） | trusted replication（被引用） | 文件不存在于 docs/adr/ | 否 | 不在基准内 |
| ADR-0011 | Best-effort namespace 诊断变更日志 | accepted | 是（主规范之一） | no-conflict——§A 业务隔离四道防线；§B 结局/阶段词表保真（冲突点 #8）；§C 输入四态（钉死 #4 复核通过）；§D owned bytes（冲突点 #1）；§E 接口依赖（冲突点 #7）；§F 时序（冲突点 #2/#9）；producer 防御吞没（冲突点 #5） |
| ADR-0012 | VFSL JSONL 与 framed sidecar 日志格式 | accepted（含 2026-08-28 首切片 amendment） | 是（主规范之二） | no-conflict——operation/stage/result 词表、observedAt 注入 Clock、attemptId 委托 CSPRNG、semantic/storage 分工、amendment C emit 调用点纪律全部满足（冲突点 #2/#3/#4/#8） |

## 冲突点

无阻塞冲突。以下为逐条裁决记录（均 no-conflict；#1–#3 含移交项）：

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | info（seam 归属） | ADR-0011 §D：「底层 transaction 模块应在不暴露 live Y.Doc 的前提下返回或投递 owned bytes」「日志不能通过事务后编码整个文档来冒充“该次 transaction update”」；（Consequences）「doc-runtime/replication transaction seam 未来需要提供 owned update bytes；该演进不得暴露 live Y.Doc」；ADR-0007：「- 成功只返回 `{ ok:true }`，不返回 snapshot、Yjs update 或内部类型」 | 设计 D-B（§6）：S5 外围 `doc.on('update')` 订阅窗口捕获事务增量；`applyValidatedMutation`/`replaceSchemaAndRoot` 零改动；从不调用 `Y.encodeStateAsUpdate(doc)`；doc 引用不出 runtime 闭包，对外只交 `Uint8Array` | **no-conflict** | 前置钉死 #1 的三项不变量全部成立：公共业务返回形状不动（doc-runtime 在 DENY 清单）；live Y.Doc 不暴露（捕获在 runtime 闭包内，emission 只含 owned bytes）；payload 是 `writeUpdateMessageFromTransaction` 的**事务增量**（yjs@13.6.32 Transaction.js:362-367，设计 P1），非整文档编码。「transaction seam」的授权点是事务层的投递面——yjs 事务 cleanup 的 update 事件即该投递面的原生实现，捕获点与事务同调用栈；ADR-0011 Consequences 的 doc-runtime 演进句是前向预期（「未来需要提供」），不排除 runtime 侧订阅同一投递面，设计（§6.3）明示若 replication 需要同能力可提升共享层。捕获 handler 单赋值闭包无可抛点，符合 ADR-0007「Yjs observer 不得向事务调用栈抛异常」。 |
| 2 | info（接线纪律） | ADR-0012 amendment C（规范性，点名 #149）：「任何将 File adapter 的 `emit` 接入 namespace 生命周期的调用点，必须位于 NamespaceRuntime write sequencer slot 之外，或在该 slot 已释放之后；不得在 slot 内执行同步 File adapter `emit`」；ADR-0011 §F：「emitter 不被 `await`」「adapter 慢、失败或队列满都不得延长 write slot」 | 设计 D-A（§7.1）：emit 挂 `enqueue()` 返回 promise 的 `.then` 链——settled 后微任务（slot 已终止）；acceptance 拒绝在公共方法调用栈同步 emit（零入队路径，无 slot） | **no-conflict** | 两条 emit 路径均结构性位于 slot 之外：settled promise 微任务在槽终止后执行（设计 §7.1 注册序证明：内部 `tail.then(noop)` 先注册、外部 `.then(emit)` 后注册、下一任务 thunk 挂 tail 产物之后）；acceptance 路径发生在 enqueue 之前，根本无槽。slot（thunk→settled）不因 emit 延长；sequencer.ts 零改动（DENY）。本票即 amendment 点名的接线修复票，合规。 |
| 3 | info（时序语义） | ADR-0011 §A：「日志 emit……不得改变业务操作的返回值、rejection、提交事实、sequencer 顺序或 Runtime 状态」；§F：「但 emitter 不被 `await`」 | 设计 §7.1 推论③：调用方 promise 的结算时点包含有界 emit（`await mutateRoot()` 恢复时 emit 必已执行）；§3：emit 后原值/原 rejection 原样传播 | **no-conflict** | 返回值、rejection、提交事实、槽序、能力态五项保护清单逐一不变（§3 四道防线：onOk `emit(); return r`、onErr `emit(); throw e`）。「emitter 不被 await」辖业务槽/提交事实不等待日志——emit 不在槽内、不参与提交判定，成立。调用方恢复时点含一次有界同步 emit 是微任务排程的自然结果，且为任务自身冻结的红灯契约所要求（AC4「两次尝试恰好各 emit 一次」同步断言）；该时点不在任何 ADR 保护清单内。**移交 SA2**：File adapter 未来装配时该时点含一次有界同步 append（amendment 已接受的成本），评审时按此基线评估。 |
| 4 | info（Clock 注入） | ADR-0012 §A：「`observedAt` 由完成操作的 producer 使用注入 Clock 生成 UTC ISO 8601」；ADR-0009：「缺失任何依赖均在 plugin 启动时响亮失败，不 fallback 到 `Date.now()` 或全局 timer」「Persistence 和 Registry 都依赖外部 Clock……不各自实现或 fallback 到系统 timer」 | 设计 §5.1：seam 新增 `clock?: () => number`（结构兼容 `@nomicore/clock` `Clock.now`），**缺省 `() => Date.now()`**；observedAt 经 `observedAtFrom(env.clock)` 生成 | **no-conflict**（附边界注记） | 注入接缝已建立且被一切受测/受审计组装使用（红灯契约明文「observedAt 必须来自注入 Clock」，测试注入 clock；AC1 锚点含 Clock 断言）。ADR-0009 的 No-Date.now-fallback 纪律明文辖 Registry plugin 依赖与 Persistence/Registry 两层，**不辖 namespace-runtime**；本票生产工厂不装配 emitter（`createNamespaceRuntime` 传参不变），「装配 emitter 而不注入 clock」的形态在本票生产面不可达。**边界注记（移交后续 Registry 接线票）**：生产接线时必须注入 `ctx.clock`（届时属 Registry 域，落入 ADR-0009 纪律），不得依赖 `Date.now()` 缺省——否则偏离 ADR-0012「注入 Clock」措辞。 |
| 5 | info（防御义务半径） | ADR-0011 §A：「Runtime/Registry/复制实现仍防御 adapter 违约；adapter 同步 throw 或异步失败均被隔离，并只进入独立的日志健康 metrics/observer」「实现应尽力上报 dropped count、sink failure 和 queue health……」 | 设计 §7.2：`emitAttempt` try/catch 全吞（敌意 emitter throw、违约 clock 的 throw）；「producer 侧健康通道……留待未来票，本票不扩张公共面」 | **no-conflict** | 隔离是硬义务、已满足（emit 路径零接触 `state.fatal`/`state.lifecycle`/handle；AC4 四不变锚点）。「只进入独立的日志健康 metrics/observer」读作**去向限定**（日志故障不得漏入业务面），非本票必须建成 producer 侧 observer 的义务；上报义务措辞为「尽力」（best-effort），且 adapter 侧 stats/健康面已由 #156 冻结交付（memory adapter dropped/accepted 统计，AC4 锚点用之）。producer 侧健康通道缺口记为观察项，不扩张公共面（ADR-0011 §E「不扩张 `NamespaceRuntime`……interface」同向）。 |
| 6 | info（构造期校验） | ADR-0008：「测试通过包内确定性 seam 注入可控 P0、dirty notifier、handle 与 fault」「构造失败时所有权仍归调用方」 | 设计 §5.2：`diagnosticEmitter` 提供时条件性校验 `doc.on/off`，缺失即构造期 loud `TypeError`（不静默降级）；未装配路径零新校验 | **no-conflict** | seam 校验前置于构造完成是既有纪律（设计引 INV-N4/N14 先例）；条件半径仅限「装配了 emitter」的组装（全部既有生产/测试路径零变化，§11 末行）；构造 throw 时所有权归调用方，与 ADR-0008 条款一致。该选择（loud 拒绝而非静默降级为 noop/omitted）保护 ADR-0011 §D 语义诚实性（「应有 update 的记录」不得伪饰），无条款相抵触。 |
| 7 | info（依赖方向） | ADR-0011 §E：「业务模块依赖一个小的内部 emitter interface，而不依赖日志存储实现」 | 设计 §4：dependencies 增 `@nomicore/namespace-diagnostic-log: workspace:*`；type-only import + 运行期唯一值级调用 `emitter.emit(...)`；依赖无环 | **no-conflict** | 依赖面 = emitter 接口（`import type` + `emit` 方法调用），非存储实现——正是 §E 条款要求的形态；诊断包不依赖 runtime（无环），其 adapter/VFSL 内部对 runtime 不可见。该依赖是任务简报冻结契约（SA6 Phase 1「SA3 落地时需把该包加入 dependencies」）的直接执行。 |
| 8 | info（词表保真） | ADR-0011 §B：「`rejected` 不得折叠成统一 `failed`。至少保留下列阶段：acceptance……capability-gate（已接纳但被 fatal、handle 状态、schema unavailable 等能力 gate 拒绝）……validation……transaction、dirty-notification」「每条结局记录保留所属模块已有的稳定 code、phase、issues 顺序与 committed 事实；日志层不得发明 retryable、rollback 或成功语义」「`unknown`：仅用于缺少可判定结局的诊断记录……」；ADR-0012：「result 使用严格判别联合：committed+`noop`；committed+`update`；committed+`update-omitted`；rejected；fatal+`committed:false`；fatal+`committed:true`，effect 为 `update \| update-omitted \| unknown`。rejected 与 fatal committed:false 禁止携带 update。」；ADR-0008 稳定码注册修订 5（append-only 注册表） | 设计 §9：25 结局点映射表；stage 七值（identity 为 replication 域不用）；code 全复用 errors.ts/p0.ts 既有注册表（零新码、零改文案）；R9/S5′a/S3′b 领域与形状失败无顶层 code（模块通道无码）；R11 effect `unknown` 仅在 fatal committed:true 分支 | **no-conflict** | 前置钉死 #3 逐项复核通过：无新 stage/operation/code/reason；「保留所属模块已有的稳定 code」对无码结局忠实表现为无码（issues `{message,path}` 顺序透传，ADR-0012 `DiagnosticIssue` 的 `code?` 可选）；fatal 落 capability-gate（getStatus throw/结构不可达）有 §B 明文依据（「被 fatal……拒绝」）；结局分类 `unknown` 在正常路径零使用——设计使用的 `unknown` 是 ADR-0012 result 判别联合中 fatal committed:true 的 **effect** 显式分支（前置报告已钉死两者不得混用）；「fatal committed:false 禁止携带 update」由 §7.3 裁决表结构保证（该分支不带 bytes）。 |
| 9 | info（排序机构） | ADR-0011 §F：「变更尝试的业务排序继续由现有……namespace write sequencer 决定，日志不得引入第二个业务排序机构」「adapter 慢、失败或队列满都不得延长 write slot 或阻塞 close/shutdown；Host shutdown 可 best-effort drain 日志，但 Registry/Persistence 的停止不得无限等待日志 sink」 | 设计 §7.1/§11：emit 顺序 ≡ 槽完成顺序 ≡ FIFO（微任务注册序）；全部写的 emit 微任务先于 close barrier thunk；每 attempt 独立 SlotDiag 与捕获窗口，槽间串行窗口永不交叠 | **no-conflict** | emission 顺序是业务槽序的**从动**投影（挂在既有 sequencer 的 promise 链上，无第二排序状态机）；close 不因日志无限等待——emit 为每槽一次有界同步调用，无 drain 语义、无常驻队列（首切片 amendment 形态）；close barrier 前全部 emit 已完成，无「close 后 emit 挂起」窗口。P0 与 close 零 emit（ADR-0011 §B 排除面）——p0.ts/close.ts 在 DENY 清单。 |
| 10 | info（emission 面） | CONTEXT.md「语义 emission」：「不含 streamId/sequence/segment/frameOffset/Base64/CRC 等物理表示……快照与 updateBytes 所有权移交后不得再变异」；「genesis baseline record」：「v1 冻结的 emission/sink 公共面无构造路径」；ADR-0012 §B：「业务 producer 只提交 semantic emission，不构造 segment/offset/Base64 等物理表示」 | 设计 §7.2/§10.2：emission 仅 operation/stage/observedAt/source `{kind:'local'}`/code+sourceModule 成对/issues/input/result；attemptId 委托 emitter CSPRNG；durationMs/context 省略（不发明字段）；input.snapshot ≡ S3 同一 frozen 快照引用；updateBytes 为 encoder 新分配副本；无 genesis 构造；update-omitted reason 由 adapter 既有守卫产生 | **no-conflict** | 前置钉死 #7 复核通过：零物理字段、零 genesis 路径、live Y.Doc 不逃逸；所有权移交对象为 frozen 快照（ADR-0008 snapshotter 递归冻结）与新分配 bytes，移交后不可变异；省略字段与 ADR-0012「`durationMs` 只在存在可靠 monotonic duration 来源时可选记录」「首版不定义 actor」一致；数据保护面无 token/stack/cause 文本（issues 为既有领域文案）。 |

## 结论

**Verdict: `clear`，设计通过 ADR 一致性复审，放行进入 SA2 全维度攻击评审。** 无 hard-violation、无 override-declared、无 evolution。前置门禁七条钉死语义逐条复核全部满足（见冲突点 #1/#2/#8/#10 与盘点表）。

移交项（非冲突，供总控分发）：

1. **移交后续 Registry 接线票（冲突点 #4 边界注记）**：生产装配 emitter 时必须注入 `ctx.clock`（Registry 域受 ADR-0009「不 fallback 到 `Date.now()`」纪律约束），不得依赖 namespace-runtime seam 的 `Date.now()` 缺省——否则偏离 ADR-0012「`observedAt`……使用注入 Clock 生成」措辞。本票生产面未装配 emitter，该形态不可达，故不构成本票冲突。
2. **移交 SA2（冲突点 #3/#1）**：调用方 promise 恢复时点含一次有界同步 emit（含未来 File adapter 的有界同步 append）是设计明示接受的时序基线，评审按此基线评估，勿作违规项；yjs 协议假设 P1–P5（事件派发时机/payload 语义/微任务序）与 §7.1 FIFO 顺序证明属实现正确性，归 SA2/SA4 攻击面，非 ADR 一致性问题。
3. **观察项（冲突点 #5）**：producer 侧防御吞没（敌意 emitter/违约 clock）后记录缺失即最终表现，健康上报通道留待未来票——ADR-0011「尽力上报」为 best-effort、adapter 侧 stats 已冻结交付，缺口不阻塞；后续票补 producer 侧 observer 时不扩公共面（ADR-0011 §E）。

设计后复审追加的相关决议（设计引入的新决策点 D-A/D-B/D-C、seam 扩展、映射表裁决、依赖层、否决面）已写入 `task_root-schema-diagnostic-change-log_relevant_decisions.md`「设计后复审追加（round 1）」节，供 SA2/SA3/SA4/SA7 复用。
