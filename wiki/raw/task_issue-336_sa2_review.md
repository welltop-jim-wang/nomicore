# SA2 设计攻击评审 — Issue #336（T3：readData 五键组合）

> SA2（独立设计攻击评审，iteration 1——对 SA1 iteration 1 修订版的复审）。产物：本文件
> （原位更新 iteration 0 评审）。被审对象：`wiki/raw/task_issue-336_design.md`（SA1
> iteration 1，1070 行——按 iteration 0 reject 的 F1 BLOCKER + N1–N4 MINOR 修订）。
> 只做设计审查，不实现、不运行测试、不启动服务。全部源码锚点经 SA2 本迭代亲自复核
> （见各表 Evidence 列）；F1 修订面（`canonicalReadOptions` 读纪律、A-2b 双出口、A-2c
> 接缝终态成员、F-x1～F-x6 验收夹具）逐行对照 T1 权威源码验证。

## 1. Reviewed inputs

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-336.md`（任务简报，Issue 正文同源） | 已读 |
| `wiki/raw/task_issue-336_design.md`（SA1 设计 **iteration 1**，1070 行） | 已读全文 |
| `wiki/raw/task_issue-336_sa2_review.md`（SA2 iteration 0，verdict reject——本文件前身） | 已读（F1/N1–N4 逐条复核销项） |
| `wiki/raw/task_issue-336_conflict_report.md`（SA8 前置门禁，verdict clear / 16 行 / requiresConflictRecheck=true） | 已读（§9/§10 复核） |
| `wiki/raw/task_issue-336_relevant_decisions.md`（SA8 决议摘录） | 已读 |
| `wiki/raw/task_issue-336_design_conflict_report.md`（SA8 设计后复审 **iteration 2**，verdict clear / 17 行） | 已读 |
| `wiki/raw/task_issue-336_sa6_contract.md` | **不存在**（设计 §5 登记；按技能规则以 Issue AC + ADR 0024 验收节 L120–130 为验收权威，不阻塞） |
| Issue #336 REST comments | 空（任务简报 + SA8 双证 + 本迭代 dispatch 指令三证）——无 Owner 评论要求适用 |
| 源码亲核（本迭代） | doc-runtime read.ts（L74–108 类型/L118–155 重载与定序/L230–238 E100/L250–266 safeSpreadPath/L287–295 okUndefined/L299–377 校验器与失败构造——**F1 权威读纪律 L326–361 逐行比对**）；vfsl resolve-schema-at-path.ts（L72–153 标记/守卫/L194–228 重载/L331–375 校验/L462–546 游走与身份短路）；namespace-runtime runtime.ts（L107–159/L460–504/L668–694）、read-schema-projection.ts（全文）、index.ts、package.json（deps/版本）；registry lease.ts（L65–94/L265–394）、types.ts（L446–450/L663）、index.ts、package.json；T0 三件（readdata-ok-shape.ts 全文 / scanner L55–289 / gate 存在性）；docs 负控 fixture（SCOPE_DOCS/readDataOptionUsages）；root package.json + vitest.config.ts；apps/yjs-server/src/app.ts L590–619；`wiki/raw/task_issue-335_design.md` §6.10 L480；类型导出面（doc-runtime/vfsl index grep）；readData 全仓调用点 grep（含 ws-replication issue287 测试消费点、data-interface 型测、exports-audit 值键面） |

## 2. Verdict

**approve** —— iteration 0 的 **F1（BLOCKER）已按验收条款落实并经源码级验证消除**：
修订版净化器（§7.1-A-2）以 `Object.keys` 键空间 + `getOwnPropertyDescriptor` data-property
取值 + 整体 try 收编 + 仅「在场 ∧ ≥0 有限整数」写入，与 T1 `validateReadOptions`
（read.ts L326–361，本迭代逐行比对）**同一读纪律、零 `[[Get]]`**——F1 三触发路径
（非 enumerable/继承键错位、descriptor/get 分叉 Proxy 静默化、get trap 抛异常裸逃逸）
在结构上全部不可达；净化失败的响亮出路（A-2b 出口① 重派发单源成员 / 出口② A-2c
登记豁免成员）满足 iteration 0 验收的「二选一钉死语义 + 显式登记豁免」；两条失实不变量
论断已删改（required change (e)）；F-x1～F-x6 验收夹具与本轮钉死语义一致且可实现。
N1–N4 全部销项（第 13 节映射）。设计整体架构（T1 单一权威 + 接缝净化、双重载零泄漏、
lease 原样透传、T0 单点修订）维持 iteration 0 已验证成立的形态。残余 2 项新 MINOR
（M1 残余风险措辞精度、M2 门禁命令精度）不阻断安全实施，放入 Required revisions 供
SA1 顺手修订或由实现/验证角色按文钉死。

## 3. 需求覆盖

| Requirement | Design section | Assessment |
|---|---|---|
| 五键恒形（预算 + 无预算空清单；失败分支不动） | §7.2-B-2/B-3、§7.6 | 覆盖（AC1；无 options 分支新鲜 `[]`、禁共享常量的否决记录 §7.7 在场） |
| 两通道同预算一次读内贯通 | §7.1 决议 A（A-1/A-2/A-2b）、§8.2 S2b | 覆盖且**经修订成立**：canonical 与 raw 在 T1 读纪律视图下恒同预算（确定性输入）；视图不稳定响亮失败 |
| 截断清单恒在场、条目三字段语义 | §7.2-B-4（逐引用透传、零合成） | 覆盖（AC4；语义单源 T1，read.ts L80–92 亲核） |
| `READ_OPTIONS_INVALID` 进公共联合（含未知键；同步不抛） | §7.2-B-3、§7.3-C-1 | 覆盖（AC5；Extract 零泄漏派生与 T1 L96–97 注记吻合——本迭代复核该注记在场） |
| registry lease 原样透传 options | §7.5（released 先行、raw 引用直传） | 覆盖（AC6） |
| T0 helper 恰三键 → 五键修订 | §7.6-F-1/F-2 | 覆盖（scanner family B 经 `SUCCESS_SHAPE_KEYS` 常量自动随动——亲核 scanner L191–192 按常量长度+集合比对、family A L254–255 `okTrue∧hasSchema` 超集匹配，论断成立） |
| width 触发时投影与无预算读逐字节相等 | §7.1-A-3、§12-T1-E | 覆盖（AC3；resolver width 忽略 + 身份短路 L476–477/L489 亲核） |
| depth 条目尾段枚举语义 / omitted 直接子项数 | §12-T1-B/C | 覆盖（AC4） |
| 全套包门禁 + root typecheck/test | §12 门禁表 | 覆盖（AC7；root 脚本亲核 = `vitest run --typecheck` + 14 项目 tsc 含 apps/yjs-server；**包级命令精度见 M2**） |
| 非目标不扩大（不动 T1/T2 面、不做 T4/T5、零 wire/诊断/复制） | §1、§11 DENY | 覆盖（见第 11 节） |

未发现需求被静默扩大或收缩。

## 4. Owner评论覆盖

Issue #336 REST comments 为空（任务简报 §Comments；SA8 前置门禁 §2、SA8 设计后复审 §1、
本迭代 dispatch 指令四证一致）。**无 Owner 评论要求适用**——设计 §4 结论与证据一致。

## 5. 上游事实与SA8约束

| Fact or constraint | Design response | Assessment |
|---|---|---|
| SA8 前置门禁 16 行（clear）+ §8 Required actions 1–8 | 设计 §6 两张映射表逐行落实 | 逐行核对无遗漏；行 6 落实方式（决议 A + F1 修订版读纪律）本轮亲核成立 |
| SA8 设计后复审 iteration 2：17 行（clear / no-conflict 6 + implements 11 / 零 hard-conflict）+ §8 实现复查 8 项 | 设计 §7 各节对应；§15 登记复查理由 | 一致；SA8 对修订面（descriptor 净化、双出口、A-2c 豁免、「合法值交替」残余）的独立裁决与本轮源码级复核结论吻合 |
| T1 读纪律权威（read.ts L326–361）：`Object.keys` 键空间（R8）/ descriptor data-property 取值（零 accessor 执行）/ ownKeys 谎报 ≡ 非 own / present-undefined ≡ 缺席（R1）/ ≥0 有限整数 / -0 归一（H10）/ 内层 try 收编 | §7.1-A-2 (a)–(d) 逐字对齐 | **逐行比对成立**：修订版净化器四项纪律 + `-0` 归一（`value === 0 ? 0 : value`）+ 谎报键 continue + present-undefined continue 与权威一一对应；唯一刻意差异 = 不重查宿主原型——经 SA2 独立论证正确（继承键在两通道键空间之外，原型视图漂移不可能改变轴值；少一次 trap 触达） |
| T1 定序与零外抛（G0→options→N0；V2 非法 options 零 doc 触碰先短路；E100 顶层 try INV-R1） | A-2b 出口①三个断言的依据 | 亲核属实（read.ts L132/L140–150/L230–238）——重派发不可能外抛、状态化 trap 复掷由 T1 单源收编成立 |
| T2 规则三处分叉（present-undefined 拒 / 无宿主检查 / `ownOptionValue` 经 `[[Get]]`） | §3-6 登记 + §7.1 决议 A 收口 | 三处分叉亲核属实（resolve L342–344/L350/L357–359）；canonical（全新 plain 字面量）恒在 T2 验收集内——修订版论断经 T2 校验规则（L355–375）独立推演成立 |
| 深拷贝器 9-case 无 default（SA8 §8-4(b)） | §7.4-D-3 显式 `case 'truncated'`（10-case、无 default） | 亲核属实（projection L121–181）；clue 克隆分支与 `SchemaTruncationClue`（resolve L72–74）两成员精确对应 |
| lease `Equal` 锚 + released 单例 | §7.5-E-3 原文保持 + 两新锁 | 亲核属实（lease.ts L383–391/L78–82）；legacy 排最后使 `_readAlias` 原文成立（ReturnType 取末签名） |
| 版本论据（runtime 0.1.12 / registry 0.1.10 / doc-runtime 0.1.13 / vfsl 0.2.4） | §2.7/§13 | 亲核属实（四包 package.json） |
| 类型导出面：`ReadLogicalValueAtPathOptions`/`ReadLogicalValueTruncationEntry`/`ReadLogicalValueAtPathBudgetResult`（doc-runtime index）、`BudgetedReadDataSchemaProjection`/`ResolveSchemaBudgetOptions`/`isSchemaTruncationMarker`（vfsl index） | C-1/C-3/E-1 import 依据 | 亲核全部在场——设计的跨包 import 与 +3/+1 type-only 导出可解析；runtime 已依赖 doc-runtime（package.json deps） |
| SA6 契约缺席 | 设计 §5 登记，以 Issue AC + ADR 验收节替代 | 符合技能规则，不阻塞 |
| 发现的上游事实与源码矛盾 | 设计 §5 称「无」 | SA2 复核：修订版引用的源码锚点**全部准确**（§2 各表本迭代逐项亲核）；iteration 0 的 F1 是实现层读纪律偏离，已消除 |

## 6. 设计内部一致性

- **F1 修订的内部自洽（本轮核心复核项）**：§7.1-A-2 代码 ↔ §8.2 S2b 状态机 ↔ §8.3 R3/R4
  数据流 ↔ §9 错误面 ↔ §12-T1-F F-x 夹具 ↔ §14 映射表——同一套语义在五处表述一致：
  净化仅在值通道成功后执行；ok:true → 投影吃 canonical；ok:false → 出口①（重派发失败
  成员原样返回）或出口②（接缝终态成员）；两出口绝不 throw、绝不 `schema:null`、绝不带
  截断键。iteration 0 指出的「A-2 论断 vs §7.1-β/§9 自拒形态」的内部矛盾已随两条失实
  论断的删除而闭合。
- 修订版不变量表述（§7.1 末）与实现一致：「canonical 仅在确认视图后构造 ⟹ 恒过 T2 二道门」
  经 T2 校验规则独立推演为真（canonical 键集 ⊆ 两轴、值全 ≥0 有限整数、plain 宿主）；
  「descriptor 视图纯净、get trap 从不执行」与净化器代码（零 `[[Get]]）结构对应。
- 备选否决记录（§7.1 (α)–(ε) + §7.7）完备覆盖本轮新增的实现自由度：(δ) canonical 回喂
  T1（洗白敌意输入）与 (ε) 净化先行均被否决且理由成立——「权威先行、成功后净化」是唯一
  同时保住「T1 是调用方原始输入唯一拒绝权威」与「净化器不比权威看得更多」的顺序。
- 重载序（预算前 / legacy 后）在 C-2（runtime interface）、E-1（lease interface）、B-2
  （实现闭包）三处一致；`_readAlias`/`_readOverloadOrder`/`_readBudgetAlias` 三锁与序互证。
- 计数一致性：§2.6/§7.6-F-3/§12-T4/§10 的「10 个消费文件」全部改为 10（iteration 0 N2
  修正到位；SA2 本轮 grep 复核 = 恰 10 文件，逐名与 §2.6 清单一致——runtime 2 + registry 8，
  gate 文件消费 scanner 不在内）。
- 残余风险表述与主体行为一致**除一处措辞精度缺口**（M1，见第 13 节）：「键集漂移」被
  列入可检测集，但仅「漂移至 T1 拒绝视图（未知键显形）」可检测；键在场性在两个 T1 可
  接受视图间交替（如 {depth:5}→{} 或 {}→{depth:1}）与「合法值交替」同属不可检测类，
  字面上未被 §7.1 残余段的例示覆盖且与 §13「键集…已全部响亮拒绝」的断言冲突。
- 其余一致性核对（T0 helper 缺省参数与 10 消费文件零改动、N3 纯面钉死与预算断言纪律、
  §11/§12 fixture 措辞、JSDoc 重写入 ALLOW）均成立。

## 7. 状态机与并发攻击

单次调用编排（§8.2）无持久状态、零 sequencer 槽位、全同步——并发面干净。iteration 0
的 SM-3/SM-4/SM-5 三个缺口（F1 触发路径）复核销项；本轮对修订面新增触发逐一攻击：

| ID | Initial state | Trigger | Expected behavior | Design gap | Required revision |
|---|---|---|---|---|---|
| SM-1 | lifecycle closing/closed | `readData(path, 敌意 options)` | `RUNTIME_READ_DISABLED`（B-1 钉死，gate 先于一切 options 触达——敌意 trap 停接纳期零执行） | 无 | 无 |
| SM-2 | lease released | `lease.readData(path, options)` | `NAMESPACE_LEASE_RELEASED` 冻结单例（E-2 released 先行，零 options 触达） | 无 | 无 |
| SM-3 | ready，T1 已接受的抛错 get trap Proxy | 净化器读 descriptor（零 `[[Get]]`） | 五键 ok、get trap 零执行（F-x4） | 无——descriptor 读不触达 get trap，结构保证 | 无 |
| SM-4 | ready，非 enumerable own `depth` / 继承 `depth` | 两通道各自经 `Object.keys` 键空间 | 双盲 → 无预算成功、schema 与无 options 读逐字节相等（F-x1/F-x2） | 无 | 无 |
| SM-5 | ready，descriptor/get 分叉 Proxy（desc 5 / get 1.5） | T1 与净化器各读 descriptor → 5；T2 只吃 canonical（plain {depth:5}） | 两通道按 5 对齐；无 `ok∧schema:null∧truncated` 静默组合（F-x3） | 无 | 无 |
| SM-6 | ready，状态化 descriptor trap（首次过、其后掷） | 净化失败 → 出口① 重派发 | 恰四键 `READ_OPTIONS_INVALID`（T1 单源收编）、零 throw（F-x5） | 无——重派发触达的 trap 面 ⊆ T1 校验触达面（keys/descriptor ⊂ keys/descriptor/proto），复掷必被 T1 V3 捕获 | 无 |
| SM-7 | ready，交替 trap（净化失败而重派发又成功） | 出口② | 恰四键接缝终态成员（A-2c）、零 throw（F-x6） | 无 | 无 |
| SM-8 | ready，非确定性敌意体在**两个 T1 可接受视图间交替**（键出现/消失或 5↔1） | 净化器读到第二个合法视图 → canonical 构造成功 | （理想）响亮失败 | **有（M1 措辞层）**：该输入类不可检测（需 `ValidatedBudget`，read.ts L303 非导出——SA2 亲核属实），设计已在 §7.1/§13 诚实登记同类残余（「两个合法值之间的交替」+ follow-up 路径），但「键集漂移已全部响亮拒绝」的措辞未把「键在场性交替」归入不可检测类 | M1（措辞修订，非行为修订） |
| SM-9 | ready，schemaState ≠ ready | 预算读值成功 | `schema:null` + `truncated:true` 合法共存（B-5；D3a 先行结构不动） | 无 | 无 |
| SM-10 | 任意 | 同参重复调用 | 逐字节确定（§9；敌意非确定性 options 除外——已登记） | 无 | 无 |
| SM-11 | 任意 | JS 调用 `readData(path, undefined)` | 运行时 ≡ 无 options（B-2/E-2 同判据）；TS 面编译错（镜像 T1，C-2） | 无 | 无 |

## 8. 错误与恢复攻击

| ID | Failure | Current design behavior | Risk | Required revision |
|---|---|---|---|---|
| ER-1 | 值通道成功、投影通道 options 失败 | canonical 为全新 plain 字面量且仅含确认合法的轴 → `SCHEMA_OPTIONS_INVALID` 对 canonical **结构性不可达**（经 T2 校验规则 L355–375 独立推演成立）；防御纵深第二道门对直接 resolver 调用方保留 | 无——iteration 0 ER-1 的静默化路径（L57 收敛）对预算缺陷不可达；净化失败在投影调用之前短路（B-5 分界注记） | 无 |
| ER-2 | 净化读期间敌意 trap 抛异常 | 净化器整体 try 收编 → ok:false → 出口①/② 响亮失败；T1 E100 顶层 try 双保险 | 无——iteration 0 ER-2 的裸逃逸通道关闭；`InternalError` 仍是唯一逃逸 throw（D-1 结构不动） | 无 |
| ER-3 | T1 接受、T2 视图更大的输入（非 enumerable / 继承键） | 两通道对 T1 own-enumerable 键空间**双盲** → 无预算成功（F-x1/F-x2 钉死） | 无——iteration 0 ER-3 的分叉路径消除 | 无 |
| ER-4 | 可信域畸形 derived | `InternalError` 直通逃逸（唯一 throw 通道） | 无（既有语义，D-4 保持；projection 模块头注亲核） | 无 |
| ER-5 | 三个既有失败分支 | 形状零变化、不带新键（B-3） | 无（`PATH_NOT_ALLOWED` 透传 / readDisabled 四键 / released 三键亲核） | 无 |
| ER-6 | 净化失败的重派发开销 | 出口②伴随一次被丢弃的完整值读（敌意-only；读路径零副作用使丢弃安全） | 无（§7.1-A-2b 诚实登记）；出口①失败于 options 校验时零 doc 触碰（V2 短路亲核） | 无 |
| ER-7 | 敌意 trap 在校验期执行任意 JS（含变异 doc） | 一切 readData 调用既有暴露面（path Proxy 同理）；重派发最坏返回 T1 的合法失败成员（含 PATH_NOT_ALLOWED——诚实） | 无——非新增暴露类；返回面仍是预算联合合法成员 | 无 |
| ER-8 | 调用方 mutate 返回的 truncations/投影 | T1 每调用新鲜累加器 + detach 全量深拷贝（含标记 clue 全新副本，D-3） | 无 | 无 |

## 9. 契约影响审查

| API or contract | Missing or weak caller handling | Evidence | Required revision |
|---|---|---|---|
| `NamespaceRuntime.readData` 双重载 | 类型面/重载序/零泄漏推导经探针与 Equal 锁钉死，成立；`ReadLogicalValueBudgetFailure` 使接缝成员形状单源锁定 | read.ts L118–131 先例同形；lease.ts L389–391 亲核；E1/E5/E6 探针 | 无 |
| 五键信封破坏性修订（仓内消费方） | `apps/yjs-server` opRead 已补列（N1）；**另发现 `packages/ws-replication/test/ws-replication-issue287-real-transport.test.ts` L325 `peerLease.readData(['note'])`**——单参 legacy、仅属性读 `read.ok`/`read.value`，加法键零影响（root test 覆盖该包），但 §10 矩阵未列 | 本轮 grep 亲核；调用点 L324–328 属性读 | 观测 1（矩阵补一行，非阻断） |
| registry 测试替身（`makeRuntime`，10 文件） | 双参重载后 `() => readDataOk(...)` 仍可赋值：五键 ReadDataOkShape（schema 纯面）⊆ legacy 成功成员 ∧ ⊆ budget 成功成员（E4 单向：纯 ⊆ Budgeted）；单签名源对重载目标的逐签名可赋值性成立 | readdata-ok-shape.ts L16–46 亲核；scanner/gate 不消费 helper（grep） | 无 |
| 型测（`runtime-data-interface.test-d.ts` / `registry-data-interface.test-d.ts` / `registry-readdata-schema-red.test-d.ts` / `runtime-readdata-schema-red.test-d.ts`） | Extract 探针按「成员存在性」构造——五键成功成员仍 extends 三键谓词（加键不破坏结构子类型）；单参调用命中 legacy 联合 | 各文件亲核（Extract 谓词 `{ok:true; value; schema}` 形态） | 无（§12-T3 已注记 #273 锚保持绿，复核成立） |
| `projectReadDataSchema`/`detach`/`cloneValueSchema` 加宽 | 唯一消费方 runtime.ts（grep 亲核）；D-1 显式分支无 cast 过重载；联合实参经 E4 单向命中预算重载，legacy 调用侧静态纯度经纯重载保住 | grep 全仓唯一调用点；projection L42–59 现状 | 无 |
| 值键审计 / registry surface | runtime index 值导出面仍恰 `RuntimeWriteFatalError`（`Object.keys(publicEntry)` 审计亲核）；type-only 加导出不影响 | runtime-acceptance-exports-audit.test.ts L21–29 亲核 | 无 |
| wire / 诊断日志 / 复制面 | 不经 readData，零改动 | ADR-0016 L77；SA8 行 15 | 无 |

## 10. 架构一致性与惯例审查

### 责任归属

| Behavior | Expected owner | Design location | Assessment |
|---|---|---|---|
| options 校验（拒绝语义） | doc-runtime（T1 单源） | §7.1-A-1 raw 原样入 T1 三参；A-2b 出口① 失败语义亦单源 T1 | 正确——iteration 0 加上的「净化器不得比权威看得更多」本轮已兑现 |
| 接缝净化 | runtime 组合层（T2 §6.10 许可） | §7.1-A-2/A-2b/A-2c | 正确——读纪律逐字对齐 T1；A-2c 豁免三层锁定（Extract 类型注解 / echoReadPath 复用 readDisabled L671–679 纪律 / message 恒非空），先例（runtime 自构 `RUNTIME_READ_DISABLED`）亲核在位 |
| 截断清单 | 值通道载体计数（T1） | §7.2-B-4 逐引用透传 | 正确（零合成、零第二清单） |
| lease | 纯代理（零预算解释） | §7.5 | 正确（raw 引用直传、released 先行、敌意 trap 零 lease 层触达） |

### 相似能力对照

| Similar capability | Existing implementation | Proposed design | Consistent or divergent | Reason |
|---|---|---|---|---|
| 双结果联合 + 重载（零泄漏） | read.ts L94–131（T1） | C-1/C-2 同款 Extract + 重载序 | 一致 | 直接复用先例形态 |
| 敌意输入收编纪律 | read.ts L326–361（descriptor 读 + try 收编）/ read-schema-projection.ts L79–97（敌意 path 收敛 null） | A-2 净化（同款 descriptor 读 + try 收编）+ A-2b 判别结果返回 | **一致（iteration 0 的偏离已修正）** | 净化器与两处先例同用「以与校验同一的访问纪律收编」；异常不作跨函数控制流（判别联合返回）与 T1 `{ok:false,msg}` 同款 |
| 形状断言集中化 | T0 helper/scanner/gate | F-1/F-2 单点修订 | 一致 | 正是 T0 交付目的 |
| 投影三参入口 | resolve-schema-at-path.ts L194–228（T2） | D-1 显式分支调两参/三参 | 一致 | 无 cast 过重载的常规形态 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| options 合法性 | T1 校验 | canonical（派生视图，同一读纪律重读） | 确定性输入下零漂移；非确定性输入的不可检测交替 = 已登记残余（M1 措辞精度）；漂移锁 = T1-F 差分矩阵测试持续锁定「runtime 接受集 ≡ T1 接受集」+ 注释互指锚定（§13 风险表） |
| 截断清单 / truncated | T1 结果 | 无（逐引用透传） | 无 |
| 失败成员形状 | doc-runtime（READ_OPTIONS_INVALID 四键） | A-2c 接缝终态成员（唯一豁免点） | 低——`ReadLogicalValueBudgetFailure`（Extract 单源类型）编译锁：T1 加必填键即红 |
| 形状断言 | T0 helper 常量 | 10 消费文件 | 无（单点修订即全随动） |

### 生命周期对称性

读路径无资源获取/释放（零 sequencer、零缓存、零订阅）；lifecycle gate 与 released 短路
对称前置（B-1/E-2）。无不对称项。

### 平行机制检查

| Candidate duplicate | Existing path | Proposed path | Disposition |
|---|---|---|---|
| 第二读路径 / `readDataBudgeted` | — | §7.7 明文否决 | 无平行（SA8 行 3 对重派发的裁决复核成立：非公共 API、敌意-only、非事后裁剪） |
| runtime 复制校验器 / purify-then-forward / canonical 回喂 T1 | read.ts 校验器（非导出） | §7.1 (α)/(γ)/(δ)/(ε) 否决 | 无平行 |
| 清单合成 / 投影侧清单 | resolver 标记带内 | §7.7 否决 | 无平行 |
| 第二份手写失败联合 | doc-runtime 失败构造 | §7.7 否决 + A-2c 豁免登记 | 无平行（豁免经三层锁定） |
| lease 层净化/解释 | runtime 接缝 | §7.5 明确归 runtime | 无平行 |

## 11. 文件范围审查

| Path or scope issue | Evidence | Required revision |
|---|---|---|
| ALLOW 15 项与正文改动点一一对应（runtime.ts 含 A-2/A-2b/A-2c/echoReadPath/B-2/C-1 与 JSDoc 重写；projection 四函数加宽 + case 'truncated'；两 index；T0 三件；新测试 6 文件）；DENY 所列文件全部真实存在（projection fixture / 三键锚套件 / p0.ts 等 ls 亲核） | §11 | 无 |
| N4 钉死措辞落地：ALLOW 新 fixture 行「复制其构造形态（MemoryPersistence + seam）、零编辑该既有文件」+ DENY 点名 `readdata-schema-projection-fixture.ts` + §12-T1 括注同款——无双向解读空间 | §11/§12 | 无 |
| DENY「既有 readData 行为套件」与 ALLOW「T0 修订」边界清晰；既有套件经 T0 集中化自动随动（gate 保证 family A/B 归零——scanner 判定逻辑亲核）；`runtime-sync-read-face`/`runtime-boundary-supplementary` 等属性读/`toMatchObject` 消费面不受加法键影响（亲核） | §11；本轮源码亲核 | 无 |
| `apps/yjs-server/**` 点名 DENY（N1 对应——单参 legacy + 只读 ok/value，零改动成立） | §2.8/§10/§11 | 无 |
| 无 ALLOW 无理由扩张；follow-up（T4/T5/L2 接线/残余闭合）不掩盖本票必要项 | §13 | 无 |

## 12. 验收设计审查

| Requirement or risk | Proposed evidence | Gap | Required revision |
|---|---|---|---|
| 五键恒形 / B14 / 失败键集 | T1-A、T2、T4（helper 自锚 + gate 归零 + 10 文件零手改全绿） | 无 | 无 |
| 两通道对齐（AC2） | T1-D（T2 §6.10 归一 recipe + **F-x1/F-x2/F-x3 敌意夹具延拓**：「位置集相等 ∨ 响亮失败」二择一钉死） | 无——iteration 0 缺口（敌意夹具缺席）已补 | 无 |
| READ_OPTIONS_INVALID 矩阵 + 定序 + 差分 | T1-F 基础矩阵（未知键/非对象/类实例/自定义原型/accessor/抛错 Proxy + 优先级锚 + 接受集差分）+ **F-x1～F-x6 敌意净化面** | 无——iteration 0 缺口（「T1 接受但双读分叉」集缺席）已补全且语义钉死与修订实现一致（本轮逐夹具推演：F-x1/x2 双盲对齐、F-x3/x4 零 `[[Get]]` 对齐、F-x5 出口①、F-x6 出口②，全部可实现、断言可判定） | 无 |
| F1 验收三项（iteration 0 §13 F1 Acceptance） | (1)→F-x1（钉死「对齐成功」——二选一之第一项）；(2)→F-x3（负断言「无 ok∧schema:null∧truncated 组合」+ 零执行计数锚）；(3)→F-x4（钉死「同款语义 = 五键 ok、get trap 零执行」——验收文本明示的允许项）；三组上 T1-D 对齐断言保持 | 无 | 无 |
| 无 options 逐字节回归 | T2 独立预言机（#273 oracle 形态）+ 存量套件 | 无 | 无 |
| width 零操作 / `{}`·`{depth:undefined}` 等价 | T1-E、T1-F | 无 | 无 |
| 零物化哨兵 / schema:null 共存 | T1-G、T1-H | 无 | 无 |
| lease 透传（同一引用）+ released 先行 | T5（stub 捕获 + 敌意构造器直传零 lease 触达 + 真实装配 + 单参 legacy） | 无 | 无 |
| 类型面（五键/零泄漏/重载面/Equal 三锁） | T3、T6（`*.test-d.ts` 经 `vitest --typecheck` 收集——root 脚本与 vitest.config typecheck.include 亲核覆盖 `packages/*/test/**/*.test-d.ts`） | 无 | 无 |
| detach 纪律（含标记 clue） | T2（连续读引用互异 / mutation 不污染 / 不冻结） | 无 | 无 |
| 红灯机理可信（当前实现忽略第二参返回三键 → 五键断言红；类型面红） | §12 序言 | 无 | 无 |
| 门禁命令 | §12 门禁表：包级行写 `pnpm --filter @nomicore/namespace-runtime test`——**两包 package.json 均无 `test` script（亲核：仅 typecheck/build）**，该命令按字面执行会报「无脚本」；表内已附「（或 vitest 定向）」避险且 root 门禁（AC7 权威）正确 | M2（命令精度，非阻断） | M2 |

## 13. Required revisions

iteration 0 的 F1（BLOCKER）与 N1–N4（MINOR）全部销项（销项核验见 §5/§6/§9/§11/§12
各行）；本轮新发现如下（无 BLOCKER / MAJOR）：

| Finding ID | Severity | Evidence | Problem | Required change | Acceptance |
|---|---|---|---|---|---|
| M1 | MINOR | 设计 §7.1「确定性与残余缺口」段（「接缝可检测并响亮拒绝的漂移 = 键集漂移、accessor 显形、值非法化、trap 抛异常」）；§13 残余行（「可检测漂移面——键集/accessor 显形/值非法/trap 抛——已全部响亮拒绝」）；§9 幂等注（敌意非确定性 options「其本身即被 A-2b 响亮拒绝的对象」）；净化器代码 §7.1-A-2（未知键 → ok:false，已知键合法值 → 写入） | 「键集漂移」的可检测性断言过宽：仅漂移至 **T1 拒绝视图**（未知键显形）会被检测；键在场性在**两个 T1 可接受视图间交替**（{depth:5}→{} 或 {}→{depth:1}）净化器读到第二个合法视图即构造 canonical 并成功——与已登记的「两个合法值之间的交替」（5↔1）同属不可检测类、同样产生静默错位，但字面未被该例示覆盖，且与「键集…已全部响亮拒绝」的表述冲突。行为本身无缺陷（检测需 `ValidatedBudget` 暴露，follow-up 已登记，SA8 行 4 同裁），风险仅在表述层：SA4/SA7 若按字面验证「键集漂移被拒」会得到与设计行为不符的假失败 | 三处措辞收敛：(i) §7.1 残余段可检测集改写为「未知键显形（键集漂移至 T1 拒绝视图）」；(ii) §7.1 不可检测类扩为「两个 T1 可接受视图之间的交替（合法值交替或键在场性交替）」；(iii) §13 残余行与 §9 幂等注同步（幂等例外措辞改为「敌意非确定性 options 的不可检测交替除外——已登记残余」） | 修订后全文不存在「键在场性交替被拒绝」的可读解；F-x 夹具与行为规格零变化；follow-up 路径（doc-runtime 暴露已校验预算，走 ADR-0003 L46 流程）保持 |
| M2 | MINOR | 设计 §12 门禁表包级两行；`packages/namespace-runtime/package.json` 与 `packages/namespace-registry/package.json` scripts（亲核：仅 `typecheck`/`build`，无 `test`） | `pnpm --filter @nomicore/namespace-runtime test` 按字面执行报错（脚本不存在）；表内「（或 vitest 定向）」已提供工作替代且 root 门禁正确，但验收命令应逐条可执行 | 包级行改为可执行形式：`pnpm vitest run packages/namespace-runtime`（或 `pnpm exec vitest run <路径>`）+ `tsc -p packages/namespace-runtime/tsconfig.json`；registry 行同款；或径直声明包级证据由 root `pnpm test`/`pnpm typecheck` 覆盖（vitest.config include 覆盖两包 test/test-d） | 门禁表每条命令按字面可运行；AC7 覆盖面不缩小 |

## 14. Non-blocking observations

1. **F1 修订质量高且自洽**：净化器与 T1 `validateReadOptions`（read.ts L326–361）逐项
   对齐经本迭代逐行比对确认；刻意省略 `getPrototypeOf` 的论证（继承键在两通道键空间
   之外）经 SA2 独立推演成立；A-2b 出口①的「净化器 trap 面 ⊆ T1 校验 trap 面」论断
   属实（keys/descriptor ⊂ keys/descriptor/proto）。iteration 0 的三条触发路径在结构上
   关闭，残余的不可检测类有诚实的登记与合规 follow-up 路径。
2. **调用方矩阵可再补一行**（观测，同 N1 性质但为零影响测试消费方）：
   `packages/ws-replication/test/ws-replication-issue287-real-transport.test.ts` L325
   `peerLease.readData(['note'])`——单参 legacy、仅属性读、加法键零影响；建议 §10 补
   一行完备化「已知消费方可枚举」论据（ADR L69）。
3. **F-x2 夹具卫生**：临时 `Object.prototype.depth = 7` 的还原建议钉死为 try/finally
   （断言失败不向同文件后续用例泄漏原型污染）；fixture 规格补一句即可。
4. **差分矩阵边界**：T1-F 的「runtime 接受集 ≡ T1 接受集」差分应显式只用于确定性夹具
   （基础矩阵）；状态化/交替 trap（F-x5/F-x6）属接缝独有检测面，T1 直调行为依赖 trap
   计数状态、不可作差分基准——设计以「基础矩阵 / 敌意净化面」分段已隐含此边界，建议
   一句明示防实现者误并入。
5. requiresConflictRecheck：本评审未发现需要**新增** ADR 冲突复查面的风险——M1/M2 均为
   措辞与命令精度，不触决策面；F1 修复路线落在 ADR-0024 既有授权内（SA8 iteration 2
   §4 同裁）。SA8 既有 requiresConflictRecheck=true 的实现期核对（§8 八项）继续适用，
   其中 A-2b 双出口与 A-2c 豁免触发点唯一性仍为实现 diff 重点。
