# 冲突门禁报告 — issue #93 round 2（rev1）

- 被审对象：PR #114 双轴人工评审反馈（5 项 merge-blocking + 2 项建议，任务简报逐字收录）+ 总控盘点的冲突点 A–F
- 冲突基准：`docs/adr/0001`–`0008` 全集（8/8 已逐个全文读取，无抽样）+ `CONTEXT.md`（含 round 1 新增「停接纳」词条）
- 门禁类型：前置门禁（Phase 0，任何 SA 派发之前）
- 事实核查源：`packages/namespace-runtime/src/{index,runtime,projection,write,schema-write,p0,errors,status}.ts`、`packages/doc-runtime/src/{schema-replace,mutation,replace,materialize}.ts`、涉事测试锚（exports-audit / close-lifecycle:140-239 / materialize-root-rev2:350-394 / runtime-replace-schema-sa7-dynamic:340-384 / runtime-boundary-supplementary:60-134）、`packages/namespace-runtime/package.json`

## Verdict

**`clear-with-adjudications`**

7 项评审反馈没有一项与 ADR 0001–0008 构成不可调和冲突；其中项 4 与 CONTEXT.md「停接纳」词条的现行文字正面相撞，但该词条自declare「语义权威单源于 ADR 0008」，向 ADR 0008 正文收敛属词条修订义务（AC7），不构成 ADR 演进或 override。裁决分布：**no-conflict × 9（A/C/D/E/F + 增补 G/H/I）；词条收敛 × 1（B）；override-declared × 0；evolution × 0；hard-violation × 0**。前置门禁放行，SA1 可在本文「SA1 设计约束清单」边界内派发。

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 单一真相源（含两修订节） | accepted | 低 | round 2 不新增仓内 schema 文本；fixture 纪律不变。no-conflict |
| 0002 | 重写定位、authority 出范围 | accepted | 无 | 不触碰。no-conflict |
| 0003 | 求值器与派生 schema | accepted | 低 | 不触碰 evaluate/ROOT 约定。no-conflict |
| 0004 | vfsl-protocol 类型协议包 | accepted | 无 | 不触碰类型投影。no-conflict |
| 0005 | 投影生成管线 | accepted | 无 | 不触碰生成管线。no-conflict |
| 0006 | 持久化插件（含 #64/#79 修订） | accepted | 中 | 项 2/3「真实持久化全链」断言面（dirty 计数、fatal 后只读、close、两 Adapter）正是 #79 条款；「持久层仅校验 META.docId」是项 6 可达性事实。no-conflict |
| 0007 | 逻辑验证与 Yjs Runtime Bridge | accepted（Runtime/open/read 由 0008 取代） | 高 | 项 5 边界裁定落在其仍有效条款（L54 零写入边界、L46 结果联合纪律）；被取代条款无对照义务。no-conflict |
| 0008 | NamespaceRuntime 读写能力与单序列器（含稳定码修订节） | accepted | 核心 | 项 1/2/4/5 主基准；「包内 seam」「生产工厂保留包内」「Registry 另行设计」「立即停止接纳公共 read 和 write」「fatal 通道」「RUNTIME_READ/WRITE_DISABLED 码族」逐条支持评审方向。no-conflict |

## 冲突点裁决（A–F + 增补）

### 冲突 A（项 1）：testing seam 从公共入口移除 vs testing 子路径 export

**裁决：seam 构造器（值导出 `createNamespaceRuntimeWithSeam` + 类型导出 `NamespaceRuntimeSeamInput`）从 `index.ts` 彻底移除；不建立 `testing` 子路径 export。测试改经包内相对路径 `'../src/runtime.js'` 导入。`RuntimeWriteFatalError`（值）与其余类型导出保留。exports-audit 测试同步改锚：值导出键集恰 `['RuntimeWriteFatalError']`。**

依据：
- ADR-0008 L91 原文「测试通过**包内**确定性 seam 注入」——「包内」的机械含义即包内模块通道（相对路径导入）；seam 保留在 `runtime.ts` 模块级导出、仅撤出公共入口 `index.ts`，与该条款逐字一致。
- AC6「公共 exports 审计确认不暴露……包内 detached/testing seam」——package.json 的 `exports` 映射就是「公共 exports」的可执行定义；新增 `"./testing"` 键等于把 testing seam 重新暴露为包级公共面，与 AC6 直接相悖。private:true 且无包外消费方（grep 证实 seam 仅被 `packages/namespace-runtime` 内 20 个测试文件消费），子路径没有任何兑付对象，只留下须维护的公共契约。
- round 1 相关决议「设计后复审追加 #4」曾把 seam 值导出判读为「ADR-0008 L91 授权的测试注入口」——该判读是 round 1 的任务内放宽解释，评审（项 1）予以纠正；ADR 正文从未要求 seam 经公共入口出现。纠正属回到 ADR 原文，非演进。
- `NamespaceRuntimeSeamInput` 的字段引用 `DocHandle`——类型随值一并撤出，否则公共类型面仍暴露 DocHandle（AC6 列名对象）。`RuntimeWriteFatalError` 是 ADR-0008 L86 点名的稳定 rejection 形状（instanceof 判别 committed/phase），保留值导出。

对 SA1 的约束：公共入口值导出恰一键；seam 输入类型移出公共面；`runtime-public-surface-ownership.test.ts`、`runtime-acceptance-exports-audit.test.ts` 与 18 个值导入测试的 import 路径统一切换为包内相对路径（机械改动，不改任何行为断言）。**裁决分级：no-conflict（评审方向即 ADR 原意）。**

### 冲突 B（项 4）：close 后三数据投影 getter 是否停接纳；拒绝形状；CONTEXT 词条修订

**裁决：①三个数据投影 getter（getSchemaEnvelope / getMetadata / getActiveSchema）属「公共 read」，纳入停接纳——lifecycle ≠ ready（closing/closed）即同步拒绝；getStatus 明文保留全生命周期可用（生命周期/能力观测面，非数据投影）。②拒绝形状：同步 loud throw 稳定码 `RUNTIME_READ_DISABLED`（沿 SchemaProjectionError / MetaProjectionError 包内类先例：类不导出、code+message 字符串消费），message 区分 getter 域与 lifecycle 值——对齐 ADR-0008 L119「区分域靠 message 文案，不另设新码」的码族纪律；不改三 getter 的成功返回类型（ADR-0008 L30–32 冻结 `SchemaEnvelope|null` / `Record` / `ActiveSchemaInfo|null`），不返回静默 null（null 已被「载体缺席」语义占用，混用即虚假降级）。③CONTEXT.md 停接纳词条修订：删去「四个观测/投影 getter……全生命周期可用」句，改为「三个数据投影 getter 与 read 同属停接纳范围（同步稳定码拒绝，通道为 getter 的 loud throw——getter 返回类型非结果联合）；getStatus 全生命周期可用（生命周期观测面）」，_Avoid_ 行同步收窄为「把停接纳误读为 getStatus 不可用」。**

依据：
- ADR-0008 L93「首次调用同步进入 `closing`，**立即停止接纳公共 read 和 write**」；L28–32 把三 getter 明文归入「## 读取能力」节——它们是公共 read 能力的组成部分。
- ADR 全文没有任何条款要求或承诺 close 后 getter 可用；要求该行为的只有 CONTEXT.md 词条（round 1 任务产物）与 `runtime-close-lifecycle.test.ts:212-221` 锚。词条自身声明「语义权威单源于 ADR 0008」，二者分歧时向 ADR 收敛；测试锚不构成门禁依据（技能纪律）。故评审方向与 ADR 相容且更忠实，词条修订是 AC7（「CONTEXT 与最终 API 一致」）义务，非 ADR 演进。
- 拒绝形状的排除法：read() 的结果联合分支（L117 注册）是 read() 自身契约（L24「预期路径、载体和 lifecycle 失败使用同步结果联合」的作用面）；三 getter 的返回形状由 L30–32 冻结、无联合分支，为它们增设联合分支=修订 ADR 冻结的公共契约，超出评审项 4 的要求。getter 面已有 loud 通道先例：NSRT-SCHEMA-E1 / NSRT-META-E1/E2 稳定码 throw，及 F-3 锚的原始 RangeError。生命周期拒绝复用 `RUNTIME_READ_DISABLED` 码族（L117 已注册为 read 域停接纳码）+ getter 域 message，是词汇纪律内的最小形状。
- 语义佐证：close barrier 已调用 `handle.release()`（L93），租约归还后继续从 doc 投影数据与「Runtime 独占一个 DocHandle」（L91）的所有权模型不相容；getStatus 必须保留——close 生命周期自身依赖它观察 closing/closed 与 close 摘要（既有锚 210/222/354 行）。

对 SA1 的约束（三条硬边界）：
1. 门禁**只** keyed on `state.lifecycle !== 'ready'`，绝不 keyed on fatal——internal fatal「保留读取」（ADR-0008 L81–87；CONTEXT「internal fatal 只永久禁写并保留读取，不触发 read 停接纳」）。fatal 期（lifecycle 仍 ready）三 getter 必须照常可用。
2. 拒绝必须发生在触碰 live Y.Doc 之前（与 read() 停接纳分支同款「本调用不触碰 live Y.Doc」纪律）。
3. closing 期已接纳任务排空期间 getStatus 必须持续可用（既有排空观察锚依赖它）；审计既有 closing-drain 场景中对三 getter 的断言（如 schema-write「notifier 挂住窗口内 getActiveSchema 可观测——锚 9」均在 ready 期，不受影响；close-lifecycle:184-221 的闭前捕获/post-close 可用断言改锚为稳定码拒绝）。

**裁决分级：no-conflict at ADR 层 + CONTEXT 词条收敛修订（AC7 义务）；round 1 测试锚解除。**

### 冲突 C（项 5）：schema-replace.ts catch-all 的精确新边界

**裁决：schema-replace.ts `prepareSchemaReplace` 的 catch 分级改为三层——①`DerivedInvariantError` sentinel → E204 pre-commit-internal committed:false（现状保留，A4 红线）；②可判别的「输入驱动资源极限」类（递归栈溢出 RangeError，发生于 extract/build 对输入成比例深度的递归）→ 保留 E200 领域结果联合（零写入）；③其余一切未知异常 → `DocRuntimeFatalError('pre-commit-internal', committed:false)`。「资源极限例外」的存续以**可靠判别器**为条件：若 SA1/SA2 无法给出把「深输入递归溢出」与「内部 bug 恰抛 RangeError」区分开的判别器（如 V8 call-stack RangeError 的消息特征 + 抛点位于输入成比例递归帧），则例外整体撤销——catch 命中除 sentinel 外一律 fatal（过报方向是 ADR 钦定的保守方向，ADR-0008「未知异常保守视为」哲学；committed:false 仍兑付零写入承诺）。replace.ts / materialize.ts 的同款 E200 catch-all 本轮不动（scope 纪律）。**

依据：
- 评审方向的 ADR 基础：ADR-0008 L79「普通、可预期且零写入的……失败使用领域化结果联合」的反面——不可预期、非领域失败的异常不是结果联合材料；L81 internal fatal 永久禁写。现行 catch-all 把内部 bug（TypeError 等）降级为 ok:false，调用方收到「验证失败」而 Runtime 保持可写——这正是 A4 红线（sa7-dynamic:365 锚）已为 DerivedInvariantError 裁定禁止的「internal 缺陷伪装成调用方领域失败」分级漂移，评审项 5 是该红线的类推推广。
- 例外保留的 ADR 基础：ADR-0007 L54「零写入承诺覆盖**所有验证失败和 detached 构造失败**」——detached 构造的输入成比例失败（深树装配溢出）在领域通道内有先例与测试锚（materialize-root-rev2:369-393，materializeRoot 面）；CONTEXT「求值器」词条「求值期失败为资源预算等模式预留」同为仓级哲学。fatal 化该类同样不违反 ADR（零写入仍成立），但会永久禁写一个只因输入深的 Runtime——保留例外的价值在避免该过报。
- 结构性可达性判定（任务简报问点）：经 Runtime 公共面，provided-root 过深输入先在 `snapshotMutation` 受控快照闸（copyFrozen 递归冻结）炸掉 → `MUTATION_INPUT_NOT_PLAIN_DATA` ok:false（write.ts S3）；keep-root 分支的 doc 深度由既往全部经受控写入建立（每笔都过快照闸）。因此 schema-replace prepare 的资源极限残余可达面是**边际的**（copyFrozen 与 extract/build 递归帧深差），撤销例外的代价有限——这授权「无可靠判别器则整体 fatal」的回退方向。
- replace.ts / materialize.ts 不动的依据：二者不在 Runtime 写路径上（核查：`mutation.ts` 直接消费 `buildTopEntries` 且自带 sentinel→E204 处理；`schema-write.ts` 只调 `replaceSchemaAndRoot`）；materialize-root-rev2 锚继续有效；评审未点名；ADR-0007 L54 为其现行为提供直接条款。本轮改动它们=无评审授权地破坏已锚定行为。
- 事实④（S5 catch 透传）与改动自洽：schema-replace 抛出的 `DocRuntimeFatalError` 经 schema-write.ts:167-174 instanceof 分支透传 committed/phase → RuntimeWriteFatalError(phase='pre-commit-internal', committed=false) → 永久禁写保读——通道已存在，改动只在 schema-replace 侧改分类。

对 SA1 的约束：新边界只动 `packages/doc-runtime/src/schema-replace.ts` 的 catch 分级与其单元锚；schema-write/write/p0 的 fatal 机械零改动；E204 分支与既有 sa7-dynamic 锚零回归；若保留资源极限例外，判别器必须是 SA2 可对抗审查的确定性判据（禁止宽泛 `instanceof RangeError` 一刀切——`new Array(-1)` 同抛 RangeError）。

**裁决分级：no-conflict（评审方向与 ADR 相容且补齐 A4 红线类推；既有 D8 头注是设计产物非 ADR，按新边界改写）。**

### 冲突 D（项 6）：SCHEMA 载体缺席 vs 异型分流

**裁决：分流。①载体**缺席**（share 无 'SCHEMA' 键）→ 保留 null（合法态：schema 尚未写入；P0 经 ENV-1 收编为 unavailable 数据级失败；SCHEMA write ①c 缺席→惰性创建是修复路径）。②载体**异型**（同名 Y.Text/Y.Array/Y.XmlFragment）：public 模式 → loud throw 新稳定码 `NSRT-SCHEMA-E2`（载体异常），镜像 NSRT-META-E1（值域）/E2（载体）的既有双码先例，注册于 errors.ts append-only 注册表（ADR-0008 L125 归属条款），类沿 SchemaProjectionError 先例不导出；p0 模式 → **维持数据级 unavailable，禁止 fatal**（不允许经 p0.ts:120 catch 收编为 NSRT-FATAL-P0-INTERNAL）。**

依据：
- 分流判据沿 projection.ts 既有单一判据「生产不可达 → loud / 生产合法可达 → 可观测缺席信号」的精确化：缺席经生产路径合法可达（createDoc/loadDoc 只校验 META.docId，ADR-0006 #64 修订节明文），异型同可达但性质是**载体损坏**——把损坏静默映射为 null 与「缺席」不可区分，是虚假降级（本包反复立法拒绝的形态：NSRT-META-E2 同款理由）。
- p0 模式禁 fatal 的依据：ADR-0008 L59「正常 compile result failure 仅使 ROOT write unavailable；**SCHEMA write 仍可修复**」——载体异型是 doc 数据缺陷（坏 schema 数据），不是「结果联合之外的 internal exception」（L59 后句指的是编译通道的机械违约）。fatal 化将永久禁写并消灭 SCHEMA write 修复路径，与修复哲学相悖。p0 模式的处置是数据级收编（保持 null→ENV-1，或 SA1 选择在 p0 模式给出可区分的载体 issue 摘要——设计自由，但终点必须是 unavailable，不是 fatal）。
- 评审原文「不构成自动阻塞依据」属性：项 6 是建议项，但「缺席 vs 异型」若不分流，public 模式的 loud 化会破坏合法缺席宽容（persistence 共享套件「Permissive: correct docId, no SCHEMA」锁定的正是缺席宽容；核查确认无测试锁定「异型→null」）。分流是满足评审意图且零合法行为回归的唯一方向。
- 双模式一致性约束：public 模式 throw 的 NSRT-SCHEMA-E2 与 p0 模式的数据级收编并存时，P0 unavailable 后调用 `getSchemaEnvelope()` 将稳定收到 E2 throw——诊断面自洽（loud），SA1 须在设计中明示该可观测组合。

**裁决分级：no-conflict（projection.ts 头注是设计注释非 ADR；新码注册走 errors.ts 既有归属条款）。**

### 冲突 E（项 2/3）：生产装配路径测试形态 + pre-commit fatal 注入点

**裁决：①「生产装配路径」合规形态 = 测试经包内相对路径导入 `createNamespaceRuntime(handle, notifyDirty)`（runtime.ts:240-245，包内生产工厂），handle 来自真实 `persistence.createDoc(...)` 产物，`notifyDirty = () => persistence.saveDoc(handle)`（可外套计数器观察 dirty 次数）——这恰是 ADR-0008 L45「由构造方绑定 `persistence.saveDoc(handle)`」与 runtime.ts:236-238 注释明文的未来 Registry 确切调用形。真实 compiler（不注入 compile）+ 真实 doc-runtime + Memory 与 File 双 Adapter 端到端。②pre-commit fatal 真实持久化全链 = seam 构造器**只注入 compile throw**（→ SCHEMA 写槽 S4 `schema-compile-throw` committed:false；或 P0 期 compile throw → `NSRT-FATAL-P0-INTERNAL` 作补充变体），其余一切全真（真实 createDoc handle、notifyDirty 绑真实 saveDoc+计数、Memory+File 双 Adapter）；断言面：notifier 恰 0 次、零 update/字节不变、fatal 摘要置位、fatal 后读取照常 + 后续写 `RUNTIME_WRITE_DISABLED`、close 正常排空 release 恰一次。FilePersistence 覆盖至少落 pre-commit fatal 场景（建议同时补 committed fatal 的 File 面）。**

依据：
- ①的排除法：公共导出生产工厂违反 AC6/ADR-0008 L91（「不公开……生产构造器」）；实现 Registry 违反 L107「Registry 另行设计」。包内导入 + 真实绑定是唯一同时满足评审意图（证明生产构造链而非 seam 注入链）与两条 ADR 边界的形态。
- ②的授权：ADR-0008 L91 明文列举 seam 注入物含「**fault**」——「测试通过包内确定性 seam 注入可控 P0、dirty notifier、handle 与 fault」。真实组件下 pre-commit fatal 公共面结构性不可达（真实 compileSchemaEnvelope 一切输入返回结果联合；E204 需手造派生物），评审要求的「真实持久化全链」只能解读为**故障注入点之外的整链全真**，seam compile throw 即最小注入。committed fatal 的既有 fullchain 场景（observer 逃逸）走 doc 级注入，与生产工厂兼容；pre-commit fatal 走 seam compile 注入——两条腿合起来覆盖 AC5「committed/pre-commit fatal」双形态。
- 生产装配测试与 fault 注入测试是两个互补测试（seam 与生产工厂不同构造器），不是同一实例的两段——SA1 勿试图强行合一。

**裁决分级：no-conflict（形态均在 ADR 边界内）。**

### 冲突 F（项 7）：walker 共享基础设施方向

**裁决：提取**共享 descriptor-safe 原语层**（own-enumerable-data 读取三分结果、数组元素 descriptor 守卫、plain-record 原型链判据、defineProperty 安全写入、Yjs 家族申报词等纯函数原语），供 projection.ts（loud-throw、不冻结、skip-accessor 语义）与 write.ts（issue 语义、递归冻结、祖先集循环检测）**各自消费**；不强行统一遍历器——两 walker 的失败语义（throw vs 收编 issue）、冻结纪律（不冻结 vs 后序冻结）、循环策略（原型链上限 vs 祖先路径集）是各自契约面，统一即其中一方行为回归。模块归属包内（SA1 定名，如 `src/plain-data.ts`）；零行为回归是硬验收（全部既有锚绿，含 F-3「循环 META → 原始 RangeError、无稳定 code」锚与 snapshotter 四查次序锚）。**

依据：ADR 对包内模块结构沉默（无条款可冲突）；建议项价值在消除漂移风险（projection 与 write 的 descriptor 守卫逻辑确有重复）。排除「统一遍历器」的依据是两 walker 的语义差异各自被测试锚锁定（F-3 锚 vs snapshotter R2 四查锚），统一必然改写其一。

**裁决分级：no-conflict（纯包内结构建议，方向=共享原语而非统一语义）。**

### 增补裁决 G/H/I（总控未点名、SA8 补充）

- **G（A 的子约束）**：`NamespaceRuntimeSeamInput` 类型随 seam 值一并撤出 `index.ts`——只删值不删类型会在公共类型面继续暴露 DocHandle（AC6 点名对象）。公共类型导出保留：`NamespaceRuntime`、`NamespaceRuntimeReadResult`、`RuntimeReadDisabledResult`、`NamespaceRuntimeStatus`、`ActiveSchemaInfo`、`RuntimeWriteFatalPhase`、`RootMutationIssue`、`MutateRootResult`、`ReplaceSchemaInput`、`SchemaReplacementIssue`、`ReplaceSchemaResult`。裁决分级：no-conflict。
- **H（B 的子约束）**：三 getter 停接纳门禁的 key **只有 lifecycle**；任何以 `state.fatal`、`schemaState`、handle 状态为 key 的 getter 门禁都是违规（fatal 保读是 ADR-0008 L81–87 明文；unavailable/preparing 期 getter 照常——getActiveSchema 在 preparing/unavailable 返回 null 是 D8 既有契约）。裁决分级：no-conflict（约束显式化）。
- **I（scope 观察，非阻断）**：replace.ts / materialize.ts 的 E200 catch-all 与 schema-replace 新边界形成**doc-runtime 直接调用面 vs Runtime 写面**的分级不对称——前者有 ADR-0007 L54 直接条款与 materialize-root-rev2 锚，合规；后者由 ADR-0008 fatal 通道收紧。不对称是分层的自然结果（两层失败哲学不同：doc-runtime 验证/构造层输入驱动失败走联合；Runtime 面上结果联合之外的异常一律 fatal），**不构成本轮冲突**；登记供未来任务（如 doc-runtime E200 边界统一票）参考，本轮严禁顺手改动。

## 结论

verdict = **clear-with-adjudications**。7 项评审反馈全部与 ADR 0001–0008 + CONTEXT.md 相容：无 hard-violation、无 override、无需 Jim 裁决的演进条目；唯一正面文本冲突（项 4 vs CONTEXT 停接纳词条现行文字）经词条自身「语义权威单源于 ADR 0008」声明收敛为 AC7 修订义务。前置门禁放行，SA1 依下述清单设计。

### SA1 设计约束清单（方向级，不可越界）

1. **公共面（A/G）**：`index.ts` 值导出恰 `RuntimeWriteFatalError` 一键；seam 值 + `NamespaceRuntimeSeamInput` 类型移出公共入口；不新增 package.json exports 键；seam 保留 `runtime.ts` 模块级导出；测试统一改 `'../src/runtime.js'` 相对导入；exports-audit 与 public-surface-ownership 测试改锚新键集。
2. **close 停接纳（B/H）**：三数据投影 getter 以 lifecycle≠ready 为唯一 key 同步 loud 拒绝，稳定码 `RUNTIME_READ_DISABLED`、包内类、message 分 getter 域；不触碰 live Y.Doc；getStatus 全周期可用；fatal 期 getter 照常；成功返回类型不改；CONTEXT.md 停接纳词条同步修订（三 getter 入停接纳、getStatus 保留、_Avoid_ 行收窄）。
3. **schema-replace 边界（C）**：catch 三层分级（sentinel→E204 保留；可判别资源极限→E200 保留，判别器须确定性且 SA2 可审；其余未知→`DocRuntimeFatalError('pre-commit-internal', false)`；无可靠判别器则例外整体撤销）；replace.ts/materialize.ts 零改动。
4. **载体分流（D）**：缺席→null 保留；异型→public 模式 `NSRT-SCHEMA-E2` loud throw（errors.ts 注册）、p0 模式数据级 unavailable（禁 fatal、保 SCHEMA write 修复路径）；设计中明示「unavailable + getSchemaEnvelope throw」的可观测组合。
5. **测试形态（E）**：生产装配 = 包内 `createNamespaceRuntime` + 真实 createDoc + `() => persistence.saveDoc(handle)` + 双 Adapter + 真实 compile；pre-commit fatal = seam 仅注 compile throw、其余全真、断言 notifier 恰 0 次/零写入/fatal 后只读/写禁用/close；两形态分立测试；FilePersistence 至少覆盖 pre-commit fatal。
6. **walker 共享（F）**：共享 descriptor-safe 原语层、不统一遍历器、零行为回归（F-3 锚与 snapshotter 四查锚必须原样绿）。
7. **文档对齐（AC7）**：ADR 0008 正文零改动（本轮全部裁决都在其既有条款与 L125 注册表归属机制内兑现——新码 NSRT-SCHEMA-E2 落 errors.ts，不修 ADR）；CONTEXT.md 仅停接纳词条按裁决 2 修订；round 1 相关闭合锚（close-lifecycle getter 锚、exports-audit 键集锚）随设计同步改锚并在设计中列明改锚清单。
