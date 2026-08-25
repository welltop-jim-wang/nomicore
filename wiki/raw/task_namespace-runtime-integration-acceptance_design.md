# SA1 设计（R1）— @nomicore/namespace-runtime：全链集成验收收口——AC7 文档词汇收口、AC6 exports 审计确认与验收锚定完整性复核（issue #93）

- 任务类型：功能开发（集成验收与阶段收口）
- 前置事实：NamespaceRuntime 全部能力已由 #86–#92 实现并合入本分支；SA6 验收测试 3 文件 8 用例**首次运行即绿**（存量能力，如实标注），全仓基线 90 files / 1101 tests + `pnpm typecheck` 七包全绿（SA6 运行记录，简报 §SA6）。
- 本设计交付物：**纯文档收口修订清单（ADR 0008 修订节 + CONTEXT.md 词条）+ 仓库卫生收尾（`.mabf-done` 删除固化 + `.gitignore` 防复发）+ AC6 公共 exports 审计收口确认 + 验收锚定完整性复核 + SA4/SA7 可执行的静态核对协议**。零生产代码改动。

## §0. 任务定位与交付边界

本任务不是能力开发——能力已在 #89–#92 五连任务中全部交付且验收全绿。本任务是**阶段收口**：把「实现与测试已冻结的最终 API/错误词汇」回写进权威文档面（ADR 0007/0008、CONTEXT.md、package docs），确认公共 exports 审计无残余缺口，并复核 8 条 AC 的验收锚定完整性。

SA6 在静态核对中发现**唯一已知缺口**（简报 L85）：

> 字面量 `RUNTIME_READ_DISABLED` 未出现在 docs/adr/0008 与 CONTEXT.md（仅存在于设计文档 task_namespace-runtime-fatal-status-close_design.md D4 与相关决议）→ 建议 SA1/SA3 在 docs 收口时补入。

设计期独立复核（本设计 §2 全量矩阵）确认：除该缺口外，还存在两处**非矛盾但欠对称/欠注册**的词汇债（`RUNTIME_WRITE_DISABLED` 码域、`NSRT-CLOSE-RELEASE-FAILED` 注册）与一处术语映射注记（「永久关闭」vs「永久禁用」），一并纳入本次收口——它们与 SA6 缺口同源：**ADR 0008 已点名的可观测词汇（`RUNTIME_WRITE_DISABLED`、`RuntimeWriteFatalError`）与实现最终词汇之间存在登记差**。

**边界裁决：生产代码零改动。** `packages/*/src/**` 全部冻结（能力已实现、已验收、全绿）；本任务的代码库内变更仅限：文档 2 文件、卫生 2 项、SA6 已产的 3 个验收测试文件入库。

## §1. 契约来源与证据盘点

### 1.1 输入文档（已全文读取）

| 文档 | 消费方式 |
|---|---|
| `wiki/raw/task_namespace-runtime-integration-acceptance.md`（任务简报 + SA6 验收记录） | 验收映射与缺口清单的基准 |
| `wiki/raw/task_namespace-runtime-integration-acceptance_relevant_decisions.md`（SA8 前置门禁） | ADR 条款约束基准（ADR-0008 全条款 / ADR-0006 #79 修订 / ADR-0007 取代节） |
| `wiki/raw/task_namespace-runtime-integration-acceptance_conflict_report.md` 附注 2 | **ADR 修订流程约束**（见 §1.2） |
| `docs/adr/0001–0008`（ADR 全集） | 词汇核对矩阵对象 |
| `CONTEXT.md` | 词汇核对矩阵对象 |
| `packages/namespace-runtime/src/index.ts` / `errors.ts` / `runtime.ts` / `status.ts` / `write.ts` / `schema-write.ts` | 最终 API/错误词汇的唯一真相源（只读） |
| SA6 三验收测试 + 存量锚测试 | 锚定完整性复核对象（存在性已逐一核实，见 §3.5） |

### 1.2 关键约束：ADR 修订的正当程序（SA8 conflict report 附注 2 处置）

SA8 冲突报告明文：

> AC7 要求 ADR 0007/0008、CONTEXT、package docs 与最终 API/错误词汇一致——这是文档对齐义务，若执行中发现 ADR 文本需要随终态 API 修订，属「ADR 演进」，须走正式 supersede/修订流程并另行裁决，不得在本任务内静默改写 ADR。

**本设计的处置**——修订采用本仓既有正式修订流程，非静默改写：

1. **形式先例**：ADR 0006 的「### createDoc 与 owner 语义修订（2026-08-21，issue #64）」「### DocHandle entry status 与 saveDoc 职责修订（2026-08-22，issue #79；演进经 owner 裁决放行）」、ADR 0001 的「### 命名修订（2026-08-21，owner 决策）」——**带日期、带议题号的追加式修订节，正文零改动**。本设计同款（§3.1）。
2. **裁决链已闭合，不构成新决策演进**：本次登记的三个字面量中，`RUNTIME_READ_DISABLED`、`RUNTIME_WRITE_DISABLED`（closing/closed 复用）、`NSRT-CLOSE-RELEASE-FAILED` 的形状与语义已在 #92 任务被 SA8 **明文让渡给 SA1 裁决**——让渡声明出自 #92 **设计后复审报告**（`wiki/raw/task_namespace-runtime-fatal-status-close_design_conflict_report.md` L39：「SA6 已把三个字面量（RUNTIME_READ_DISABLED / RUNTIME_WRITE_DISABLED 复用 / NSRT-CLOSE-RELEASE-FAILED）明文让渡给 SA1，属任务内授权」），逐条登记落在该任务前置门禁报告的「设计后复审追加」节第 3–6 条（`task_namespace-runtime-fatal-status-close_relevant_decisions.md` L111 起：第 3 条 read 停接纳形状、第 4 条 write 停接纳复用、第 5/6 条 close barrier 与 rejection 形状）。`RUNTIME_WRITE_DISABLED` 的码域来源**逐域锚定**：fatal-queued 域 = ADR 0008 L87 直接条款；writable-gate 域 = handle 状态**非 ready 三态同拒**（persistence-degraded / released / disposed——实现 message 明文：write.ts:97、schema-write.ts:117「DocHandle 状态 … 不可写（persistence-degraded 阻止全部 Y.Doc 写；released/disposed 同拒）」），条款依据 = ADR 0008 L47（persistence-degraded 条款）+ #90 设计 D9 码表（`task_namespace-runtime-write-sequencer_design.md` L505：「fatal 已置位 / handle 非 ready（degraded、released、disposed）/ notifier 未绑定」共用本码）；notifier-未绑定域 = #90 前置门禁报告「设计后复审追加」第 1 条（D6.4 loud gate，`task_namespace-runtime-write-sequencer_relevant_decisions.md` L125）；lifecycle≠ready 域 = #92 同节第 4 条。本修订节是**把这些已裁决词汇回写进 ADR 的收口注册**，不引入任何新行为决策。
3. **任务内授权**：简报 What to build 与 AC7 明文要求「ADR 0007/0008、CONTEXT、package docs 与最终 API/错误词汇一致」；dispatch log 第 3 行明文「设计范围=文档收口+exports 审计确认+验收完整性复核」。

### 1.3 ADR 0008 正文锚点（本次收口的对照原文）

| 行号 | 正文原文（不动） | 与实现词汇的关系 |
|---|---|---|
| L24 | 「预期路径、载体和 lifecycle 失败使用同步结果联合，只有 internal bug 才抛异常。」 | 已裁决行为；实现命名 `RUNTIME_READ_DISABLED`（缺席 ADR） |
| L47 | 「`persistence-degraded` 阻止 ROOT、SCHEMA 以及未来所有 Y.Doc 写……」 | 已裁决行为；实现以 `RUNTIME_WRITE_DISABLED` 码结算（码域未注册） |
| L86 | 「post-commit fatal 以带 `committed:true` 的稳定 `RuntimeWriteFatalError` reject……」 | ✅ 已点名，一致 |
| L87 | 「已排队的后续写仍按 FIFO 取得槽，且不访问输入、零写入返回 `RUNTIME_WRITE_DISABLED`。」 | ✅ 已点名（仅 fatal-queued 语境）；码域统一语义欠注册 |
| L93 | 「`close()` 幂等。首次调用同步进入 `closing`，立即停止接纳公共 read 和 write……失败时 close Promise reject……」 | 已裁决行为；read 侧码缺席、close rejection 码未定形状 |
| L95 | 七键 status「稳定且不含原始 Error/stack……的 schema、fatal、close issue 摘要」 | ✅ 与 status.ts 七键一致 |

## §2. AC7 词汇一致性核对矩阵（全量，设计期实测）

判据先行（防 SA2 攻击「为什么有的码入 ADR 有的不入」）——**AC7「一致」= 无矛盾 + ADR 已点名词汇的对称完备**，不是「全部稳定码入 ADR」。理由：ADR 是决策记录；实现级稳定码的注册表法定居所为**包内各定义处**——错误/禁用码族在 `src/errors.ts`（append-only，#90 立法），P0 schema issue 摘要派生码在 `src/p0.ts` `toIssueSummary`（#91，@internal）——不集中单文件；把全部码复制进 ADR 会制造「每码一修订」的同步负担（层级错配）。ADR 只登记**正文条款已点名的行为**所对应的公共面可观测词汇。矩阵穷尽性由 §5 断言 6 的 src 全量提取差集守卫（R2 新增，SA2 #1 红灯）。

| # | 词汇/字面量 | 最终 API 出处（只读核实） | ADR 0007 | ADR 0008 | CONTEXT.md | package docs | 裁决 |
|---|---|---|---|---|---|---|---|
| 1 | `RuntimeWriteFatalError` | errors.ts:138（index.ts 值导出） | — | ✅ L86 | — | ✅ index.ts 头注点名 | 一致，零改动 |
| 2 | `RUNTIME_WRITE_DISABLED` | errors.ts:38；`disabled()` 四域调用（write.ts:79/97/102、schema-write.ts:105/117/122、runtime.ts:203/212） | — | ⚠️ L87 仅 fatal-queued 语境 | — | — | **码域澄清入修订节第 2 条**（§3.1） |
| 3 | `RUNTIME_READ_DISABLED` | errors.ts:49；runtime.ts `readDisabled()`（L70 类型 / L261 构造） | — | ❌ **缺席** | ❌ **缺席** | △ 类型名 `RuntimeReadDisabledResult` 已在 index.ts 头注 | **SA6 唯一缺口：修订节第 1 条 + CONTEXT 词条（§3.1/§3.2）** |
| 4 | `NSRT-CLOSE-RELEASE-FAILED` | errors.ts:41（`NamespaceRuntimeCloseError.code`；status.close 摘要同码） | — | △ L93 未定 rejection 形状 | — | — | 修订节第 3 条注册（L93 未定形状内的既定最小公共面） |
| 5 | 「永久关闭（写）」→「永久禁用……读取仍保留」 | 可观测 message 词汇（rev1 立法；`runtime-write-fatal-message-rev1.test.ts` 锚） | — | △ L81 行文用「永久关闭」 | — | — | 修订节第 4 条术语纪律注记（行文 vs 可观测词汇映射） |
| 6 | `NSRT-FATAL-P0/WRITE/SCHEMA-WRITE-INTERNAL` | errors.ts:16/23/31（status.fatal 摘要码） | — | —（L95 只要求「稳定摘要」，未点名） | — | ✅ errors.ts 注册表 | 不入 ADR——status 摘要实现词汇，粒度低于 ADR 决策；注册表归属以修订节第 5 条显式声明 |
| 7 | `MUTATION_INPUT_NOT_PLAIN_DATA` / `SCHEMA_UNAVAILABLE` | errors.ts:52/55（issue message 码） | — | — | — | ✅ errors.ts 注册表 | 同上，不入 ADR/CONTEXT |
| 8 | `HANDLE_NOT_USABLE` / `NSRT-SCHEMA-E1` / `NSRT-META-E1/E2` | errors.ts:59/87/104（构造/投影 throw 码） | — | — | — | ✅ errors.ts 注册表 | 同上 |
| 9 | `readLogicalValueAtPath(doc, path)` | doc-runtime index.ts 值导出 | ✅ L26 取代注记 | ✅ L16 | ✅「载体投影读取」词条 | ✅ | 一致，零改动 |
| 10 | `compileSchemaEnvelope` / `applyValidatedMutation` / `validateLogicalSnapshot` / `materializeRoot` / `replaceRootContent` / `replaceSchemaAndRoot` | doc-runtime index.ts 值导出（逐一核实存在） | ✅ L15 等 | ✅（P0 槽 / validated mutation 管线引用） | ✅「逻辑快照校验」词条 | ✅ doc-runtime index 头注 | 一致，零改动 |
| 11 | `mutateRoot` / `replaceSchema` / `getSchemaEnvelope` / `getMetadata` / `getActiveSchema` / `getStatus` / `close` / `owner.userId` / `namespaceId` | runtime.ts 十键（AC2/AC6/AC8 锚） | — | ✅ L36–40 / L28–32 / L95 / L93 / L97 | △（Runtime 术语簇仅四词条，无 close 词条） | ✅ index.ts 头注 | ADR 一致；CONTEXT 以「停接纳」词条补 close 侧概念（§3.2，一句带过不复制 ADR） |
| 12 | 七键 status / lifecycle 三态 `ready|closing|closed` | status.ts（七键恰合） | — | ✅ L95 / L93 | — | ✅ status.ts 头注 | 一致，零改动 |
| 13 | schema-aware `readLogicalValueAtPath(derived, doc, path)`（旧签名） | 已不存在于任何 src | ✅ L26 已标注「已由 ADR 0008 取代」 | ✅ 取代关系节 | ✅ _Avoid_: schema-aware read | — | 一致（历史标注，非遗留引用），零改动 |
| 14 | ADR 0007 L46「NamespaceRuntime/Registry 再映射成稳定的 create/open/mutation 上层错误」 | 实际 v1：create → `NamespaceRuntimeConstructionError`（throw）；mutation → 结果联合 + `RuntimeWriteFatalError`；open/Registry 留待未来 | △ 将来时投影 | — | — | — | **零改动**：该句是 ADR 0007 时点的将来时表述，其辖域（Runtime/open/read）已由 ADR 0008 取代节接管，现存表述不与最终 API 矛盾（create 确实 throw 稳定错误、mutation 确实领域化稳定结算）；为一句将来时投影修订 0007 得不偿失且违反最小修订纪律 |
| 15 | `SCHEMA_TEXT_INVALID`（R2 补，SA2 #1） | **p0.ts:145**（`toIssueSummary`，@internal；schema-write.ts S4' 经 `toReplacementIssue` 消费）——**不在 errors.ts** | — | —（L57/L95 点名「unavailable 与稳定 schema issue 摘要」行为，未点码名） | — | △ p0.ts 定义处注释 | **不入 ADR 正文（摘要实现码粒度低于 ADR），但必须显式登记归属**：修订节第 5 条括注清单补入 + 归属声明改为「包内各稳定码定义处」（errors.ts ∪ p0.ts）。公共可观测路径 = `getStatus().schema.issue.code`（unavailable 期七键 status 的 schema 摘要；`getActiveSchema()` 同期返回 null——五字段身份不可用，摘要不走该 getter） |
| 16 | `SCHEMA_ENVELOPE_<code>` 动态透传族（R2 补，SA2 #1 附带） | p0.ts:137–141（模板字面量 `` `SCHEMA_ENVELOPE_${String(issue.issue.code)}` ``，不透明段透传，运行时不校验码域） | — | — | — | — | **归属上游**：vfsl `compileSchemaEnvelope` envelope 相位 issue code 的透传词汇，namespace-runtime 不注册该码域——修订节第 5 条加一行裁决；非静态码，不进 §5 断言 6 的单引号提取面（模板字面量形态天然排除） |

**矩阵结论**：需修订面 = ADR 0008（追加修订节，登记 #2/#3/#4/#5 + 修订节第 5 条改写的注册表归属声明，覆盖 #15/#16）与 CONTEXT.md（新增词条，承载 #3 与 #2 的码族概念 + #11 的 close 侧概念与 getter 边界）；ADR 0007 **核对零改动**；package docs **核对零改动**（#3 的类型名已在 index.ts 头注，errors.ts 对偶注释已存在——无矛盾即不改生产文件）。**全量性守卫**：src 静态码全集恰 13 个（设计期 `grep -rhoE "'[A-Z][A-Z0-9_-]{6,}'" packages/namespace-runtime/src/*.ts | sort -u` 实测）= 矩阵覆盖集 {#1–#4, #6–#8, #15} ∪ 修订节第 5 条清单——差集为空；§5 断言 6 将此固化为可执行红灯（差集非空即红）。

## §3. 设计决策

### D1 ADR 0008 追加修订节（唯一 ADR 改动；正文 L1–L111 零改动）

- **形式**：沿 ADR 0006 #64/#79 修订节先例——带日期、带议题号、开篇声明「增量注册 + 其余条款维持原文效力」的追加节，置于文末「## 取代关系」节之后。
- **性质声明**（写进修订节首段，回应 SA8 conflict report 附注 2）：本节是**词汇收口注册**——为正文已裁决行为补记公共面可观测稳定码字面量；三个字面量的形状与语义已在 #90/#92 任务经 SA8 裁决并让渡（让渡声明见 #92 设计后复审报告 L39，逐条登记见各前置门禁报告「设计后复审追加」节——§1.2 裁决链），本节不引入新决策。
- **内容**：§4.1 给出 SA3 原样落盘的全文草案（五条：read 停接纳码、write 码域澄清、close 拒绝码注册、术语纪律注记、注册表归属声明）。

**为什么用追加节而不内联插入 L24/L93**：仓内零先例支持改写已接受 ADR 正文；追加节保留决策时间线（正文=2026-08-23 决策原貌，修订节=2026-08-24 收口注册），SA8 前置门禁「ADR 全集逐一全文读取」的后续任务可同时看到两层。

### D2 CONTEXT.md 新增「停接纳（stop-acceptance）」词条

- **位置**：`active schema` 词条（L73）之后、`重建校验`（L75）之前——归入 Runtime 术语簇（写序列器/P0/active schema 之后）。
- **承载内容**：close 侧停接纳概念 + `RUNTIME_READ_DISABLED` 字面量（SA6 缺口直接补齐）+ `RUNTIME_WRITE_DISABLED` 码族一句话（对偶完备——只登记读码不登记写码本身就会造成新的不对称）。close 排空语义一句带过，语义权威留在 ADR 0008（防词条与 ADR 双源漂移）。
- **gate 边界锚定（R2 补，SA2 #3）**：词条正文显式声明**停接纳辖域 = capability 三槽**（read / mutateRoot / replaceSchema），四个观测/投影 getter（getSchemaEnvelope / getMetadata / getActiveSchema / getStatus）**全生命周期可用、不在停接纳范围**——锚定 #92 前置门禁报告「设计后复审追加」第 2 条（gate 边界裁决：D7，解释性裁决，收紧须升级总控）；`_Avoid_` 增补「把停接纳误读为观测 getter 不可用」，防后续任务据词条与 #92 裁决互相矛盾地判读。
- **_Avoid_ 行**：防三类误读——lifecycle 失败误借路径失败码（#92 D4 的裁决理由）、把停接纳误解为取消已接纳任务（ADR L93「无条件排空」）、把停接纳误读为观测 getter 不可用（#92 裁决第 2 条）。
- **不新增独立 close 生命周期词条**：close 幂等/排空/barrier 细节是 ADR L93 的领地；CONTEXT 只需停接纳这一个跨面概念（read+write 双侧 + 码族），避免词条与 ADR 条款级重复。
- **全文草案**：§4.2（SA3 原样落盘）。

### D3 package docs：核对零改动（证据固化）

- `packages/namespace-runtime/src/index.ts` 头注已声明「read 结果联合 +`RuntimeReadDisabledResult` 分支（closing/closed 期停接纳）」——类型名与行为均与最终 API 一致；字面量 `RUNTIME_READ_DISABLED` 的注册表法定居所是 `errors.ts:48-49`（「与 RUNTIME_WRITE_DISABLED 对偶的 read 域码」注释已在）。**无矛盾 → 生产文件零改动。**
- **不新建 `packages/namespace-runtime/README.md`**：仓内唯一包级 README 先例是 `packages/vfsl-codegen/README.md`（codegen 使用说明——面向外部消费者的工具文档）；namespace-runtime 是 @private workspace 包，其文档面 = ADR 0008（决策）+ CONTEXT.md（术语）+ index.ts 头注（公共面纪律），三者已覆盖且本次收口后词汇一致。新建 README 属无消费方的增量维护面，记为范围外。
- doc-runtime / persistence / vfsl 包的 index 头注与 ADR 0007/0006/0001-0005 核对（§2 矩阵 #9/#10/#13）零矛盾。

### D4 AC6 公共 exports 审计收口确认

**审计结论：无残余缺口，零代码改动。** 证据三层：

1. **值导出键集精确性**（`runtime-acceptance-exports-audit.test.ts` 运行时探测，首跑即绿）：`Object.keys(entry)` 恰为 `['RuntimeWriteFatalError', 'createNamespaceRuntimeWithSeam']`——任何未文档化值导出都会使断言失败。
2. **类型导出清单**（index.ts 只读核对，11 项）：`NamespaceRuntime`、`NamespaceRuntimeSeamInput`、`NamespaceRuntimeReadResult`、`RuntimeReadDisabledResult`、`NamespaceRuntimeStatus`、`ActiveSchemaInfo`、`RuntimeWriteFatalPhase`、`RootMutationIssue`、`MutateRootResult`、`ReplaceSchemaInput`、`SchemaReplacementIssue`、`ReplaceSchemaResult`。逐一核对：无 DocHandle/Y.Doc/writable Yjs 引用出站——唯一引用 DocHandle 的是 `NamespaceRuntimeSeamInput.handle`（**注入通道类型**：ADR 0008 L91「测试通过包内确定性 seam 注入可控 P0、dirty notifier、handle 与 fault」明文授权；所有权经 seam 转移给 Runtime，「不公开 handle」禁令约束的是 Runtime 实例十键面与值导出面，`runtime-public-surface-ownership.test.ts` 锚定）。
3. **AC6 措辞「不暴露……包内 detached/testing seam」的判读固化**（防后续审计反复）：禁令对象是**包内 seam 的实现模块与运行态**——exports-audit 测试的 forbidden 列表正是其可执行定义（`createNamespaceRuntime` 生产工厂 / `WriteSequencer` / `runP0` / `runRootWriteSlot` / `runSchemaWriteSlot` / `runCloseBarrier` / `buildStatus` / `PersistenceHandle` / `MemoryPersistence` / `FilePersistence` 全部模块级缺席）；而 `@internal` 标注的 seam 构造器导出是 ADR 授权的测试注入口，沿 `@nomicore/vfsl` `getCompiledWith` 的 `@internal` 先例（vfsl/src/index.ts:223-224）。

### D5 验收测试锚定完整性复核（8 AC × 锚点矩阵 + 存在性实测）

SA6 记录与本矩阵引用的全部唯一锚文件（**19 个**，含 `runtime-close-lifecycle-type-guard.test-d.ts`、doc-runtime 2 个、persistence 2 个）已逐一 `ls` 核实存在（设计期实测 **19/19 OK**；计数口径 = 下表 AC1–AC8 行引用的唯一测试文件集合，SA2 R1 附录 E8 独立复核同数——R1 初版误写 13/13，系照抄简报 SA6 引用清单口径未对齐矩阵，R2 更正）。复核矩阵：

| AC | 锚类型 | 锚点（存在性已核实） | 复核结论 |
|---|---|---|---|
| 1 端到端全能力 | 运行时 | `runtime-acceptance-fullchain.test.ts`（Memory+File 真实链）+ 存量 `runtime-mutate-root-persistence` / `runtime-replace-schema-persistence` | 完整 |
| 2 P0/早期写序 | 运行时 | `runtime-sync-read-face`（AC8 读面）+ `runtime-mutate-root-sequencer`（AC4 FIFO）+ `runtime-p0-sequencer`（AC5/AC7 队首） | 完整 |
| 3 单 sequencer 契约 | 运行时 | `runtime-mutate-root-sequencer` + `runtime-replace-schema-sequencer` + `runtime-replace-schema-sa7-dynamic`（AC9 时序） | 完整 |
| 4 两 Adapter degraded | 运行时 | `runtime-acceptance-degraded-two-adapter`（Memory+File 平行）+ `packages/persistence/test/issue-79-{,file-}entry-status` | 完整 |
| 5 fatal/close 全链 | 运行时 | fullchain fatal 用例 + `runtime-close-lifecycle` / `runtime-close-sa7-dynamic` / `runtime-write-fatal-message-rev1` / `runtime-replace-schema-sa7-dynamic` / doc-runtime `apply-validated-mutation-fatal-contract` | 完整 |
| 6 exports 审计 | 运行时 | `runtime-acceptance-exports-audit` + `runtime-public-surface-ownership` + `runtime-close-lifecycle`（十键/无事件键）+ doc-runtime `public-surface-guard` | 完整（D4 收口确认） |
| 7 文档词汇一致 | 可执行面 + **静态面** | 可执行：`runtime-write-fatal-message-rev1`（message 术语纪律）+ `runtime-close-lifecycle-type-guard`（lifecycle 三态/close 摘要键）。静态：**本任务交付物本身**（§3.1/§3.2 修订 + §2 矩阵）+ §5 静态核对协议 | 收口后完整 |
| 8 CI/全绿 | 证据 | `ci.yml` matrix node [20,24]（typecheck+test+persistence-contract 等）；SA6 全仓 90 files/1101 tests + typecheck 七包绿实测 | 完整（CI 观察期走 Host 流程） |

**复核结论：无漏锚。** AC7 静态面是唯一非运行时可测面，其防线见下。

**不新增「文档词汇回归测试」的裁决**：不写读取 docs/adr/0008 文本断言字面量的测试。理由：(a) 包测试依赖仓库根 docs 路径，破坏包自包含隔离；(b) 仓内测试纪律明确拒绝 readFileSync 文本形状断言（#90 SA4 §1.7 先例：「断言面 = 运行时结果对象……非源码文本形状」）；(c) 防线替代 = §5 静态核对协议（SA4 Phase 3 + SA7 执行）+ 后续任务 SA8 前置门禁的 ADR 全文读取义务。

### D6 仓库卫生收尾（简报「现状摘要」明示义务）

1. **`.mabf-done` 删除固化**：该文件曾误提交（commit bfcb999）；当前 `git status` 为 ` D .mabf-done`（工作树已删、未暂存）——收尾 commit **必须包含此删除**（staged），否则误提交文件回流主干。
2. **`.gitignore` 追加 `.mabf-done` 与 `.mabf/`**：防复发。`.gitignore` 已有 MABF 段先例（`TASK.md` / `.mabf-bg/`，注释明引「design §12 DENY LIST」），追加两行是同一防线的补洞；当前 `?? .mabf/` untracked 目录（调度器工作区）随之不再出现在 git status 噪音中。
3. **不清理 `.mabf/` 目录本身**：调度器活跃工作区，非 git 对象。

## §4. 修订文本全文草案（SA3 原样落盘）

### 4.1 `docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md` —— 文末追加（「## 取代关系」节之后），正文零改动

```markdown
### 稳定码注册修订（2026-08-24，issue #93 全链集成验收收口）

本节为**词汇收口注册**：为正文已裁决的行为补记公共面可观测稳定码字面量，并澄清一个跨任务已裁定的码域统一语义。三个字面量的形状与语义已在 issue #90/#92 中经 SA8 裁决并让渡——issue #92 的 SA8 设计后复审报告明文「SA6 已把三个字面量……明文让渡给 SA1，属任务内授权」，逐条登记见两任务 SA8 前置决议的「设计后复审追加」节（#92 第 3–6 条、#90 第 1 条）。本节不引入新决策；除下列明示条款外，正文其余条款维持原文效力。

1. **read 停接纳稳定码 `RUNTIME_READ_DISABLED`**：`close()` 进入 `closing`/`closed` 后，公共 read 的 lifecycle 失败（正文「读取能力」节「预期路径、载体和 lifecycle 失败使用同步结果联合」）经同步结果联合返回该稳定码分支——lifecycle 失败不是路径缺陷，不借用路径失败码。

2. **`RUNTIME_WRITE_DISABLED` 码域澄清**：该码是写停接纳/写禁用的统一码族，覆盖四类零写入、零输入访问的拒绝——fatal 已置位后的排队写（正文「Fatal 与失败通道」节）、写前 writable gate 拒绝（handle 状态非 ready：persistence-degraded / released / disposed 三态同拒——正文「单一 write sequencer」节 persistence-degraded 条款为直接依据，released/disposed 同属租约失效下的非 ready 拒绝）、notifyDirty 未绑定的构造方义务 loud gate、close 后 lifecycle≠ready 的接纳拒绝（正文「生命周期、状态与所有权」节「立即停止接纳公共 read 和 write」）；区分域靠 issue message 文案，不另设新码。

3. **close 拒绝稳定码 `NSRT-CLOSE-RELEASE-FAILED`**：release 失败时 close Promise 的 rejection 携带该稳定码（包内 branded rejection 类，`cause` 保留原始异常；status 的 close issue 摘要同码）——正文「失败时 close Promise reject」未定 rejection 值形状，此为既定最小公共面注册。

4. **术语纪律注记**：本文行文「永久关闭（写能力）」在可观测 message/status 词汇中表述为「永久禁用……读取仍保留」——避免与 close 生命周期域词（closing/closed）碰撞；该纪律由 `runtime-write-fatal-message-rev1.test.ts` 锚定。

5. **注册表归属**：其余公共面可观测稳定码不逐码入本文，以包内**各稳定码定义处**的 append-only 注册表为准——错误/禁用码族在 `packages/namespace-runtime/src/errors.ts`（`MUTATION_INPUT_NOT_PLAIN_DATA`、`SCHEMA_UNAVAILABLE`、`NSRT-FATAL-P0-INTERNAL`、`NSRT-FATAL-WRITE-INTERNAL`、`NSRT-FATAL-SCHEMA-WRITE-INTERNAL`、`NSRT-SCHEMA-E1`、`NSRT-META-E1/E2`、`HANDLE_NOT_USABLE`），P0 schema issue 摘要派生码在 `packages/namespace-runtime/src/p0.ts` 的 `toIssueSummary`（`SCHEMA_TEXT_INVALID`——正文「P0 与 active schema」节「unavailable 与稳定 schema issue 摘要」的实现词汇，经 status 的 schema 摘要键可观测）。`SCHEMA_ENVELOPE_<code>` 动态族是 vfsl `compileSchemaEnvelope` envelope 相位 issue code 的不透明段透传（本包不校验、不注册该码域），归属上游注册表。ADR 记录决策词汇，不复制实现注册表。
```

### 4.2 `CONTEXT.md` —— `active schema` 词条（L73）之后插入

```markdown
**停接纳（stop-acceptance）**:
close 首次调用同步进入 `closing` 后，capability 三槽立即停止接纳新调用（read / mutateRoot / replaceSchema）：read 同步结果联合返回 `RUNTIME_READ_DISABLED` 分支（lifecycle 失败不是路径缺陷，不借用路径失败码）；mutateRoot/replaceSchema 经 Promise settle 含 `RUNTIME_WRITE_DISABLED` 的零写入结果——该码与 fatal 后排队写、写前 writable gate（handle 非 ready：persistence-degraded / released / disposed）、notifyDirty 未绑定共用同一码族，message 文案区分域；close 前已接纳任务仍无条件排空。internal fatal 只永久禁写并保留读取，不触发 read 停接纳。四个观测/投影 getter（getSchemaEnvelope / getMetadata / getActiveSchema / getStatus）全生命周期可用，不在停接纳范围。
_Avoid_: 把 lifecycle 失败伪装成路径失败码、把停接纳误解为取消已接纳任务、把停接纳误读为观测 getter 不可用
```

### 4.3 `.gitignore` —— MABF 段追加两行（段注释与既有行不动）

```diff
 # MABF scheduler workspace files (must not enter branch commits; design §12 DENY LIST)
 TASK.md
 .mabf-bg/
+.mabf-done
+.mabf/
```

## §5. 静态核对协议（SA4 Phase 3 / SA7 执行；worktree 根目录）

**diff base 裁决**：base = `73811cd`（issue #93 轮起点 = #92 合入点，`git log --oneline -1` 确认为本分支当前 HEAD）。本分支（fix/issue-93-on-docs-namespace-runtime）对 `main` 是**含 #86–#92 全部前置工作的 stacked PR**（`git diff main..73811cd --name-only | wc -l` = 658，含 docs/adr/0001–0008 与 CONTEXT.md 的前置轮改动）——前置文件的辖域由各前置任务档案（task_namespace-runtime-{skeleton-p0,write-sequencer,replace-schema-rev1,fatal-status-close}_*）的 ALLOW LIST 覆盖，**本协议与本设计 §7 ALLOW LIST 只针对 #93 轮增量**（73811cd 之后的变更）。SA4 scope 比对同用此 base。

```bash
BASE=73811cd   # issue #93 轮起点（#92 合入点）

# 1) 词汇收口断言（期望值见行尾注释）
grep -c 'RUNTIME_READ_DISABLED' docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md   # ≥1（修订节第 1 条）
grep -c 'RUNTIME_READ_DISABLED' CONTEXT.md                                                                # ≥1（停接纳词条）
grep -c 'RUNTIME_WRITE_DISABLED' docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md  # ≥2（正文 L87 + 修订节第 2 条）
grep -c 'NSRT-CLOSE-RELEASE-FAILED' docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md # ≥1（修订节第 3 条）

# 2) 追加式修订断言（ADR 0008 正文零删除；ADR 0001–0007 本轮零改动）——工作树口径（R2 统一，SA2 #4）：
#    落盘后、commit 前即有效（防空转通过），commit 后同样成立
git diff $BASE -- docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md | grep -c '^-[^-]'  # 0
git diff $BASE --name-only -- 'docs/adr/000[1-7]-*.md'   # 空（本轮 0001–0007 零触碰）
git diff $BASE --name-only -- docs/adr/                        # 仅 docs/adr/0008-*.md

# 3) 卫生断言
git ls-files | grep -cx '\.mabf-done'                                    # 0（删除已固化）
git check-ignore -q .mabf-done && git check-ignore -q .mabf && echo OK  # OK

# 4) 全绿断言（SA6 基线 + 收口零回归）
pnpm test        # 90 files / 1101 tests 全绿（含 3 个验收测试文件），Type Errors: no errors
pnpm typecheck   # 七包 tsc 全绿

# 5) 变更面断言（scope 对照；覆盖已提交+工作树）
git diff $BASE --name-only | sort  # 逐行对照 §7 ALLOW LIST（wiki 任务档案行由 Host 流程豁免）

# 6) 注册清单穷尽性断言（R2 新增，SA2 #1 红灯；差集非空即红）
grep -rhoE "'[A-Z][A-Z0-9_-]{6,}'" packages/namespace-runtime/src/*.ts | tr -d "'" | sort -u
#   期望恰 13 码 = 修订节第 1/2/3 条点名 3 码（RUNTIME_READ_DISABLED / RUNTIME_WRITE_DISABLED /
#   NSRT-CLOSE-RELEASE-FAILED）∪ 第 5 条 errors.ts 清单 9 码（MUTATION_INPUT_NOT_PLAIN_DATA、
#   SCHEMA_UNAVAILABLE、NSRT-FATAL-P0-INTERNAL、NSRT-FATAL-WRITE-INTERNAL、
#   NSRT-FATAL-SCHEMA-WRITE-INTERNAL、NSRT-SCHEMA-E1、NSRT-META-E1、NSRT-META-E2、HANDLE_NOT_USABLE）
#   ∪ 第 5 条 p0.ts 清单 1 码（SCHEMA_TEXT_INVALID）——设计期 R2 实测 13/13 命中、差集空；
#   SCHEMA_ENVELOPE_<code> 为模板字面量，天然不在单引号提取面（归属上游，见第 5 条）
grep -c 'released/disposed' docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md  # ≥1（修订节第 2 条三态枚举；SA2 #2 红灯）
grep -c 'getStatus' CONTEXT.md   # ≥1（停接纳词条 getter 边界句；当前基线 0——SA2 #3 红灯）
```

## §6. 风险登记与开放问题

| # | 风险 | 等级 | 处置 |
|---|---|---|---|
| 1 | 修订节被质疑「ADR 演进未经裁决」 | 中 | §1.2 裁决链三重锚（#92 SA8 设计后复审 L39 明文让渡 + 简报 AC7 + dispatch #3）；修订节首段自我声明为词汇注册、非新决策，并引设计后复审报告为让渡出处；追加式零改正文 |
| 2 | CONTEXT 词条与 ADR 双源漂移 | 低 | 词条只承载概念+码族（§3.2 约束），排空/barrier 细节一句带过，语义权威单源于 ADR 0008 |
| 3 | `.gitignore` 追加被质疑 scope creep | 低 | 简报现状摘要明示卫生义务；.gitignore 既有 MABF 段即同类防线（注释引用 design DENY LIST 先例） |
| 4 | 未来新稳定码再次造成「文档-实现词汇差」 | 低 | 修订节第 5 条显式声明注册表归属（errors.ts ∪ p0.ts 各定义处）与粒度原则 + §5 断言 6 穷尽性差集红灯（src 全量提取 vs 注册清单并集，差集非空即红）——后续审计有可执行判定基准，不会漏报也不会把实现注册码误报为 ADR 缺口 |
| 5 | AC7 静态面无自动化回归防线 | 低 | §5 协议 + 后续任务 SA8 前置门禁 ADR 全文读取义务；显式拒绝 docs 文本断言测试（§3.5 裁决，防包隔离破坏） |
| 6 | `.mabf-done` 删除未随收尾 commit 固化 | 中 | §5 协议第 3 组断言硬门禁（`git ls-files` 计数 = 0） |

无并发/数据一致性/时序面（纯文档与卫生收口，生产代码冻结）。

## SA2/SA8 反馈逐条回应

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| SA8 设计后复审 N1（R1 修订，SA3 落盘前置）：①「明文让渡给 SA1，属任务内授权」引文误归 #92 前置门禁报告——实出自 #92 **设计后复审报告**（`task_namespace-runtime-fatal-status-close_design_conflict_report.md` L39）；②「degraded 域在 #90 追加节第 1 条」映射错位——该条实为 **notifier 未绑定域**，degraded 域锚 = #90 设计 D9 码表 L505 + ADR 0008 L47 直接条款 | ✅ | §1.2 第 2 点 / §3.1 D1 / §4.1 序言 / §6 风险 1（+本表） | ①出处改分层表述：让渡声明 = #92 设计后复审报告 L39，逐条登记 = 前置门禁报告「设计后复审追加」节第 3–6 条（§1.2/§3.1/§4.1 三处同步，消除「前置门禁中让渡」的时点错位）；②码域来源改逐域锚定：fatal-queued=ADR L87、degraded=ADR L47+#90 设计码表 L505、notifier=#90 追加节第 1 条、lifecycle=#92 追加节第 4 条。**实质决策零改动（纯引文精度）**（注：§4.1 序言的路径+行号引用后再按 SA2 #6 裁改为 issue 号引用，见下行） |
| SA2 R1 #1 [HIGH]：`SCHEMA_TEXT_INVALID`（p0.ts:145，经 `getStatus().schema.issue` 公共可观测）漏出「全量」矩阵与修订节第 5 条穷尽清单；「以 errors.ts 注册表为准」归属声明对它失效；`SCHEMA_ENVELOPE_${…}` 动态透传族（p0.ts:137–141）欠归属裁决 | ✅ | §2 判据段+新增行 #15/#16+矩阵结论 / §4.1 第 5 条 / §5 断言 6（新增）/ §6 风险 4 | 矩阵补 #15（SCHEMA_TEXT_INVALID：不入 ADR 正文但显式登记归属——公共可观测路径 `getStatus().schema.issue.code`，getActiveSchema 同期返回 null 故摘要不走该 getter）与 #16（动态族裁归上游 vfsl 注册表）；判据段「法定居所」改「包内各稳定码定义处（errors.ts ∪ p0.ts）」；修订节第 5 条改写：括注清单分 errors.ts 9 码与 p0.ts 1 码（SCHEMA_TEXT_INVALID）两处定义地 + SCHEMA_ENVELOPE_\<code\> 上游归属一句；§5 新增断言 6 穷尽性红灯（src 全量提取恰 13 码 vs 注册清单并集，设计期实测差集空） |
| SA2 R1 #2 [MEDIUM]：修订节第 2 条 writable-gate 域被收窄为单一 persistence-degraded，released/disposed 写拒绝落不进「四类」（实现 write.ts:97 / schema-write.ts:117 message 明文三态同拒） | ✅ | §4.1 第 2 条 / §1.2 码域锚定 / §4.2 词条码族句 / §5 断言 6 第二式 | 第 2 条该域措辞改「写前 writable gate 拒绝（handle 状态非 ready：persistence-degraded / released / disposed 三态同拒）」，并注明条款依据（ADR L47 degraded 条款 + released/disposed 同属租约失效非 ready 拒绝）；§1.2 锚定同步改 writable-gate 三态域（引实现 message 原文行号）；§4.2 词条码族句同步三态；§5 增 `grep -c 'released/disposed'` ≥1 红灯 |
| SA2 R1 #3 [MEDIUM]：CONTEXT「停接纳」词条未锚定 #92 gate 边界裁决（追加节第 2 条：四观测 getter 全生命周期可用），总起句过宽、_Avoid_ 不防 getter 误读 | ✅ | §4.2 词条（总起句+边界句+_Avoid_）/ §3.2 D2（新增 gate 边界锚定 bullet + _Avoid_ 三误读） | 词条总起句改「capability 三槽立即停止接纳新调用（read / mutateRoot / replaceSchema）」；正文补边界句「四个观测/投影 getter（getSchemaEnvelope / getMetadata / getActiveSchema / getStatus）全生命周期可用，不在停接纳范围」（锚 #92 追加节第 2 条解释性裁决）；_Avoid_ 增第三项「把停接纳误读为观测 getter 不可用」；语义单源仍归 ADR 0008 + #92 裁决 |
| SA2 R1 #4 [LOW]：§5 断言 2 用 `$BASE..HEAD`（仅已提交）与断言 5 `$BASE`（含工作树）口径不一致——commit 前断言 2 空转通过 | ✅ | §5 断言 2 | 两处 `git diff $BASE..HEAD` 统一为 `git diff $BASE`（工作树口径），加注释「落盘后、commit 前即有效（防空转通过），commit 后同样成立」——与断言 5 口径一致 |
| SA2 R1 #5 [LOW]：§3.5「13/13」与矩阵实际 19 个唯一锚文件不符（计数口径未声明） | ✅ | §3.5 首句 | 更正为 19/19 并声明计数口径（= 矩阵 AC1–AC8 行引用的唯一测试文件集合，含 type-guard .test-d.ts；R1 初版 13 系照抄简报 SA6 引用清单口径未对齐矩阵——如实注明更正缘由） |
| SA2 R1 #6 [LOW]：修订节序言把 wiki 路径+行号 L39 写入将落盘的 ADR（行号漂移风险；ADR 修订节先例只引 issue 号） | ✅ | §4.1 序言 | 改为 issue 号引用：「已在 issue #90/#92 中经 SA8 裁决并让渡——issue #92 的 SA8 设计后复审报告明文『SA6 已把三个字面量……明文让渡给 SA1，属任务内授权』，逐条登记见两任务 SA8 前置决议的『设计后复审追加』节」——无路径、无行号，与 ADR 0006 #64/#79、ADR 0001 先例对齐；裁决链细节（路径+行号）保留在 §1.2 wiki 侧 |

R2 修订完成（SA8 N1 + SA2 R1 #1–#6 全部落实，2026-08-25）；后续 SA2 反馈轮在此表继续追加。

## §7. 文件清单（File Scope）

### ALLOW LIST

- `docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md` — 修改：文末追加修订节（§4.1 全文，约 +14 行）；正文 L1–L111 零改动（D1）
- `CONTEXT.md` — 修改：`active schema` 词条后新增「停接纳」词条（§4.2 全文，约 +4 行）（D2）
- `.gitignore` — 修改：MABF 段追加 `.mabf-done` / `.mabf/` 两行（§4.3）（D6）
- `.mabf-done` — 删除：固化误提交文件的删除（简报现状摘要明示义务）（D6）
- `packages/namespace-runtime/test/runtime-acceptance-fullchain.test.ts` — `[SA6 owned]` 验收测试（AC1+AC5），SA6 已产且全绿，随收尾 commit 入库；SA3 不改断言逻辑
- `packages/namespace-runtime/test/runtime-acceptance-degraded-two-adapter.test.ts` — `[SA6 owned]` 验收测试（AC4），同上
- `packages/namespace-runtime/test/runtime-acceptance-exports-audit.test.ts` — `[SA6 owned]` 验收测试（AC6），同上
- `wiki/raw/task_namespace-runtime-integration-acceptance*.md` — 任务档案文件（简报/冲突报告/决议已入库；dispatch log 与本轮 design/review 随轮更新，Host 流程管辖）

### DENY LIST

- `packages/namespace-runtime/src/**` — **生产代码冻结**：能力已由 #86–#92 实现且全绿，本任务零生产改动（含 index.ts/errors.ts 头注——§2 矩阵判定无矛盾，D3）
- `packages/doc-runtime/**`、`packages/persistence/**`、`packages/vfsl/**`、`packages/vfsl-protocol/**`、`packages/vfsl-codegen/**`、`packages/dsh-persistence/**`、`apps/**`、`tests/**`、`domains/**` — 本任务不触碰
- `docs/adr/0001-*.md` … `docs/adr/0007-*.md` — §2 矩阵审计结论零矛盾零改动（0007 的将来时投影 #14 显式裁决不修）
- `README.md`、`docs/agents/**`、`docs/phases/**`、`docs/vfsl/**`、`docs/mabf-poller.md` — 与本收口无词汇交集（设计期 grep 核实零 namespace-runtime API 提及）
- `packages/namespace-runtime/package.json` — 无公共面/行为变化（纯文档+测试+卫生），不 bump 版本
- `packages/vfsl-codegen/README.md` — 唯一包级 README 先例，不扩散（D3 裁决不新建 namespace-runtime README）
- `.mabf/**` — 调度器活跃工作区，untracked，不入库（gitignore 后自然隐去）
- `TASK.md`、`REPORT.md` — Host 任务文件（TASK.md 已在 .gitignore），任何 SA 不动

## §8. 协议假设依据 (Protocol Assumption Evidence)

无协议级假设：本设计仅涉及纯文档修订、仓库卫生与静态核对协议，不含 HTTP/WS 端点行为、端口/进程生命周期、跨 job 资源假设或第三方库行为假设。§5 协议中的 `grep` / `git diff` / `git check-ignore` / `pnpm test|typecheck` 为本地确定性文本与既有脚本操作，其行为依据为设计期实测：grep 计数（§2 矩阵「设计期实测」列）与 SA6 运行记录（`pnpm test` 90 files/1101 tests exit 0、`pnpm typecheck` 七包 exit 0，简报 §SA6 运行结果）。

## §9. 契约改动连锁审计 (Contract Change Caller Audit)

无契约改动：本设计零生产代码改动（`src/**` 全冻结，§7 DENY LIST），不触碰任何函数签名、返回类型、throw 契约或模块导出。代码库内变更仅为：文档/卫生文件（非代码）与 SA6 已产的测试文件（新增，不改既有测试）。caller 集合无变化，故无 caller 清单可列——本节为显式声明而非省略。
