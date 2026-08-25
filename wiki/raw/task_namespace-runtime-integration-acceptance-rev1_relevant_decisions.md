# 相关决议 (Relevant Decisions) — 全链 SA 复用（rev1 / round 2）

> SA8 前置门禁产出（issue #93 修订轮 round 2，Phase 0）。只摘录，不裁决；引用编号与原文，
> 需要时按编号回查 ADR 全文。方向性裁决见同目录
> `task_namespace-runtime-integration-acceptance-rev1_conflict_report.md`。
> 被审对象：PR #114 双轴人工评审 5 项 merge-blocking + 2 项建议（任务简报逐字收录）。
> ADR 全集 0001–0008 已逐一全文读取（无抽样）；CONTEXT.md 术语随附。
> round 1 基础版：`task_namespace-runtime-integration-acceptance_relevant_decisions.md`（仍然有效，本文件只收 round 2 涉及条款）。

## 相关 ADR

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted，含 2026-08-24 稳定码注册修订节）

- 与本轮的关联点：评审项 1（公共面）、2（生产装配）、4（close 停接纳范围）、5（fatal 边界）全部落在本 ADR 辖域。
- 核心条款（原文摘录）：
  - 读取能力（含三 getter 的节归属——项 4 关键）：「Runtime 另提供同步只读投影：`getSchemaEnvelope()` 从顶层 `SCHEMA` Y.Map 投影 `lang/version/id/text` 四个 primitive string，忽略额外键，不 coercion 或补默认值；`getMetadata()` 深拷贝顶层 `META` Y.Map 的全部键……`getActiveSchema()` 返回当前已安装 schema tools 的 `lang/version/id` 与 envelope/semantic fingerprints，不暴露 module、derived 或 validator。」（L28–32，位于「## 读取能力」节内）
  - read 失败形状：「预期路径、载体和 lifecycle 失败使用同步结果联合，只有 internal bug 才抛异常。」（L24）
  - 所有权与公共面（项 1/2 关键）：「Runtime 成功构造后独占一个 `DocHandle`；构造失败时所有权仍归调用方。Runtime 不公开 handle、Y.Doc、ROOT/SCHEMA/META live 引用或生产构造器。**生产工厂保留包内，由未来 Registry 使用；测试通过包内确定性 seam 注入可控 P0、dirty notifier、handle 与 fault。**」（L91）
  - notifyDirty 绑定形（项 2 关键）：「`notifyDirty` 是由构造方绑定 `persistence.saveDoc(handle)` 的窄接缝；Runtime 不依赖整个 `DocPersistence`。」（L45）
  - close 停接纳（项 4 关键）：「`close()` 幂等。首次调用同步进入 `closing`，**立即停止接纳公共 read 和 write**，并在队尾加入 close barrier；此前已接纳任务无条件排空，不取消、不设内部 timeout。barrier 只调用一次 `handle.release()`……」（L93）
  - status 保留（项 4 关键）：「Runtime 提供结构化瞬时 capability status，而不是单一扁平枚举：lifecycle、read、ROOT write、SCHEMA write，以及稳定且不含原始 Error/stack/SCHEMA 全文/ROOT 数据的 schema、fatal、close issue 摘要。」（L95）
  - fatal 通道（项 3/5 关键）：「`@nomicore/doc-runtime` 必须提供 branded `DocRuntimeFatalError`，至少包含 `committed` 与稳定 `phase`。任何 internal fatal——无论 committed 与否——都永久关闭该 Runtime 的全部写能力并**保留读取**：`committed:false` 不调用 dirty notifier；`committed:true` 或未知异常保守视为可能已提交，在当前槽内 best-effort `notifyDirty()`，但始终 reject 原始 fatal；不补偿、不 fallback、不声称 rollback……已排队的后续写仍按 FIFO 取得槽，且不访问输入、零写入返回 `RUNTIME_WRITE_DISABLED`。」（L81–87）
  - P0 修复路径（项 5/6 关键）：「正常 compile result failure 仅使 ROOT write unavailable；**SCHEMA write仍可修复**。P0 抛出结果联合之外的 internal exception 则永久关闭该 Runtime 的所有写。」（L59）
  - 失败通道二分：「普通、可预期且零写入的读取或写入失败使用领域化结果联合；ROOT mutation 与 SCHEMA replacement 使用各自独立的窄 issue 类型，不形成巨型 write issue。」（L79）
  - Registry 边界（项 2 关键）：「随后实现 `@nomicore/namespace-runtime` 的 P0、single sequencer、ROOT/SCHEMA 两类写、fatal/status/close，并以确定性状态机测试和真实 compiler/doc-runtime/Persistence 集成测试共同验收。**Registry 另行设计。**」（L107）
  - 稳定码注册修订节（2026-08-24）：
    - 「**read 停接纳稳定码 `RUNTIME_READ_DISABLED`**：`close()` 进入 `closing`/`closed` 后，公共 read 的 lifecycle 失败……经同步结果联合返回该稳定码分支——lifecycle 失败不是路径缺陷，不借用路径失败码。」（L117）
    - 「**`RUNTIME_WRITE_DISABLED` 码域澄清**：该码是写停接纳/写禁用的统一码族，覆盖四类零写入、零输入访问的拒绝……**区分域靠 issue message 文案，不另设新码**。」（L119）
    - 「**注册表归属**：其余公共面可观测稳定码不逐码入本文，以包内**各稳定码定义处**的 append-only 注册表为准——错误/禁用码族在 `packages/namespace-runtime/src/errors.ts`（`MUTATION_INPUT_NOT_PLAIN_DATA`、`SCHEMA_UNAVAILABLE`、`NSRT-FATAL-P0-INTERNAL`、`NSRT-FATAL-WRITE-INTERNAL`、`NSRT-FATAL-SCHEMA-WRITE-INTERNAL`、`NSRT-SCHEMA-E1`、`NSRT-META-E1/E2`、`HANDLE_NOT_USABLE`）……ADR 记录决策词汇，不复制实现注册表。」（L125）

### ADR-0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted；Runtime/open/read 条款由 0008 部分取代）

- 与本轮的关联点：项 5（schema-replace catch-all 边界）、项 6（SCHEMA 载体异型）落在本 ADR 仍有效条款辖域。
- 核心条款（原文摘录，均为仍有效条款）：
  - 零写入边界（项 5 关键）：「零写入承诺覆盖**所有验证失败和 detached 构造失败**。Yjs observer 不得向事务调用栈抛异常；Runtime 自有 observer 必须记录或异步上报。**事务开始后**若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback。」（L54）
  - 结果联合纪律：「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型……逻辑校验保留完整 issues，Yjs 结构与路径/操作错误 fail-fast。」（L46）
  - compileSchemaEnvelope：「新增纯函数 `compileSchemaEnvelope(input: unknown)`：输入必须是严格封闭且恰含 `lang/version/id/text` 的信封；按 envelope、dialect、parse、evaluate、internal 分阶段返回结果联合。」（L15）

### ADR-0006 Cordis 持久化插件（accepted，含 issue #64/#79 修订节）

- 与本轮的关联点：项 2/3 的「真实持久化全链」断言面（dirty notification 计数、fatal 后只读、close）。
- 核心条款（原文摘录）：
  - 「saveDoc 是 **mutation 后的 dirty notification**：只要租约有效……saveDoc 必须递增 dirtyGeneration 并 resolve」（#79 修订）
  - 「release = 不再使用通知：调用方在短 scope 的 finally 中调用 handle.release()；持久层在引用归零后可触发/等待 dirty doc 的 flush……」（L37）
  - doc 三条目布局：`SCHEMA`／`META`（docId, createdAt）／`ROOT`；「持久层仍仅校验 `META.docId === docId`，不校验 VFSL/ROOT/createdAt」（#64 修订节）——SCHEMA 载体形态不进持久层校验面（项 6 的可达性事实来源）。

### ADR-0001（accepted）/ ADR-0003（accepted）

- 与本轮的关联点：低。round 2 不新增仓内 schema 承重文本；fixture 纪律不变（「代码库不含 schema 文本（测试 fixture 除外）」）。

### ADR-0002 / 0004 / 0005（accepted）

- 与本轮的关联点：不相关。round 2 不触碰 authority、类型投影与生成管线。

## CONTEXT.md 相关术语与惯例

- `停接纳（stop-acceptance）`（round 1 新增词条，L75–77，**round 2 修订对象**）：「close 首次调用同步进入 `closing` 后，capability 三槽立即停止接纳新调用（read / mutateRoot / replaceSchema）：read 同步结果联合返回 `RUNTIME_READ_DISABLED` 分支……close 前已接纳任务仍无条件排空。internal fatal 只永久禁写并保留读取，不触发 read 停接纳。**四个观测/投影 getter（getSchemaEnvelope / getMetadata / getActiveSchema / getStatus）全生命周期可用，不在停接纳范围。**」_Avoid_: 把 lifecycle 失败伪装成路径失败码、把停接纳误解为取消已接纳任务、把停接纳误读为观测 getter 不可用
- `写序列器（write sequencer）`：「每个 NamespaceRuntime 独有的严格 FIFO：P0 与同一 namespace 的全部受控 Y.Doc 写共享顺序，前项完成 dirty notification 后下一项才执行；读取不进入该序列。」
- `P0（schema preparation）` / `active schema`：P0「只投影并编译 SCHEMA、构造 active schema tools，不读取或验证 ROOT」；active schema「SCHEMA write 的 transaction 成功后同步切换」。
- `求值器（evaluator）`：「可失败（结果联合）——方言合法性与 ROOT 完整性在解析层已收口，**求值期失败为资源预算等模式预留**。」（资源极限 → 结果联合的仓级哲学先例）
- `载体投影读取（readLogicalValueAtPath）`：「从 live Y.Doc 的固定 ROOT 按实际 Yjs/plain 载体和路径同步投影普通逻辑值……持久化文件被其他程序错误修改不在运行时读取契约范围内。」
- `零写入（zero-write）`：「校验失败 → 400 且文档不变；所有写入口走同一条管线。」

## 评审项 ↔ 条款映射（中性索引）

| 评审项 | 主条款 | 辅条款 |
|---|---|---|
| 1 seam 泄漏（High） | ADR-0008 L91「生产工厂保留包内……测试通过**包内**确定性 seam 注入」；AC6 | ADR-0008 L95 status；errors.ts 注册表（L125） |
| 2 生产装配路径（High） | ADR-0008 L45 notifyDirty 绑定形、L91 生产工厂、L107 Registry 另行设计；AC1 | ADR-0006 createDoc/saveDoc |
| 3 pre-commit fatal 全链（Medium） | ADR-0008 L81–87 fatal 通道（committed:false 不调 notifier）；AC5 | ADR-0006 #79 |
| 4 close 后停读（High） | ADR-0008 L93「立即停止接纳公共 read 和 write」、L28–32（三 getter 属「读取能力」节）、L95 status；CONTEXT 停接纳词条 | ADR-0008 L117 read 停接纳码 |
| 5 未知异常进 fatal（Medium） | ADR-0008 L79/L81–87；ADR-0007 L54 零写入边界 | ADR-0008 L59 修复路径 |
| 6 载体异型明确错误（建议） | ADR-0008 L30 四键投影、L59 unavailable 可修复；ADR-0006「持久层仅校验 META.docId」 | errors.ts E1/E2 注册先例 |
| 7 walker 去重（建议） | 无直接 ADR 条款（包内结构） | — |

## 设计后复审追加（SA1 修订设计引入的新决策点）

> SA8 设计后复审（Phase 2）从 `task_namespace-runtime-integration-acceptance-rev1_design.md`（D-1..D-7）识别出的新增决策点，供 SA2/SA3/SA4/SA6/SA7 对照；一致性裁决见 `task_namespace-runtime-integration-acceptance-rev1_design_conflict_report.md`。以下为设计引入的任务内决策（非 ADR 新条款）。

1. **公共面终态（D-1）**：`index.ts` 值导出恰一键 `RuntimeWriteFatalError`；类型导出恰 11 项（NamespaceRuntime / NamespaceRuntimeReadResult / RuntimeReadDisabledResult / NamespaceRuntimeStatus / ActiveSchemaInfo / RuntimeWriteFatalPhase / RootMutationIssue / MutateRootResult / ReplaceSchemaInput / SchemaReplacementIssue / ReplaceSchemaResult）；seam 值 + `NamespaceRuntimeSeamInput` 类型撤出公共入口，`runtime.ts` 模块级导出逐字节不动；`package.json` exports 维持 `{"."}`。
2. **getter 停接纳形状（D-2）**：`errors.ts` 新增包内类 `RuntimeReadDisabledError`（不导出），code 复用 `RUNTIME_READ_DISABLED`（errors.ts:49 既有常量），message 插值仅两闭集（getter 名三值、lifecycle 两值）；门禁位于 runtime.ts 三 getter 方法体首行（先于投影/state 读取）；`status.ts`/`close.ts`/`sequencer.ts` 零改动。
3. **资源极限例外整体撤销（D-3）**：SA8 C 授权的两条路中选回退路②——判别器三候选（V8 消息特征 / 抛点帧特征 / 深度先验探针）逐一否决 + 输入伪造面补查；catch 命中除 `DerivedInvariantError` sentinel 外一律 `DocRuntimeFatalError('pre-commit-internal', false)`。
4. **DOCRT-E206 注册（D-3）**：schema-replace 写前未知异常 fatal 的稳定码，注册于码定义处（schema-replace.ts 消息，append-only；E100/E200–E205 已占用、E206 空闲已核实）；ADR 全文无 DOCRT 码枚举（grep 证实），注册不触发 ADR 改动；Runtime 层 fatal message 仍恒定模板（INV-N7），E206 仅经 rejection `cause` 可观测。
5. **NSRT-SCHEMA-E2 注册（D-4）**：`SchemaProjectionError` code 宽化 `'NSRT-SCHEMA-E1' | 'NSRT-SCHEMA-E2'`（镜像 `MetaProjectionError` E1|E2 先例，不新建第二类）；E1 构造点加首参、message 逐字节不动。
6. **载体异型修复路径精确语义（D-4）**：异型 SCHEMA 载体上 SCHEMA write 走 S5 探针 `carrier!=='Y.Map'` → ok:false 单 issue（现行行为）——v1 不能原地清除顶层异型载体（doc 级重建属带外）；「修复路径保留」指写路径不被 fatal 永久关闭、修复尝试得到诚实领域 issue。
7. **测试落点（D-5/D-6）**：新建 `runtime-acceptance-production-assembly.test.ts`（生产装配，文件内零 seam 依赖可 grep 检）与 `runtime-schema-carrier-split.test.ts`（载体分流）；pre-commit fatal 全链 U-1..U-4 落 fullchain AC5 块；U-3（File × committed fatal）经生产工厂 + doc 级 observer 注入组合。
8. **共享原语层（D-7）**：`src/plain-data.ts` 五原语（`ownDataFact` 五分结果 / `isPlainRecord` / `putPlainKey` / `yjsFamilyWord` / `describePlainValue`）；`isPlainRecord` 不与 write.ts 共享（write 用更严的单级原型判据）；write.ts 消费时 undefined-value 查维持值读取期次序。
9. **CONTEXT.md 停接纳词条新文字（D-2 §2.7）**：三数据 getter 入停接纳（同步 throw、RUNTIME_READ_DISABLED 码族、message 分域）；getStatus 全周期可用；_Avoid_ 第三分句收窄为「getStatus 不可用」；internal fatal 不触发 read/getter 停接纳。

## 既有测试锁定事实（非门禁依据；SA3/SA7 须处置的锚）

> 技能纪律：代码与测试不构成自动阻塞依据。以下锚在 round 2 中凡与裁决方向冲突者，随设计修订同步改锚，不属于行为回归。

- `runtime-close-lifecycle.test.ts:212-221`：锁定 round 1 行为「close 后三 getter 不 throw、值不变」（项 4 将改锚）。
- `runtime-acceptance-exports-audit.test.ts:24`：锁定值导出键集 `['RuntimeWriteFatalError', 'createNamespaceRuntimeWithSeam']`（项 1 将改锚）。
- `materialize-root-rev2.test.ts:369-393`：锁定「极深 XML 树装配栈溢出 → DOCRT-E200 ok:false + 零写入」（materializeRoot 面；本轮不触碰）。
- `runtime-replace-schema-sa7-dynamic.test.ts:365-384`：锁定 A4 红线「DerivedInvariantError → pre-commit-internal branded rejection（E204），非 ok:false E200」。
- `runtime-boundary-supplementary.test.ts:66-96`（F-3）：锁定「循环 META 值 → getMetadata() 抛原始 RangeError（登记态、无稳定 code、fatal 零污染）」——getter 面已有非联合 loud 通道的先例。
- 20 个测试文件经 `'../src/index.js'` 导入 seam（18 个值导入 + 2 个仅类型导入）；seam 无 namespace-runtime 包外消费方。
