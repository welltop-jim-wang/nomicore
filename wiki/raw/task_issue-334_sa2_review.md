# SA2 设计攻击评审 — task_issue-334（形状预算 T1：载体投影读取三参化与截断省略）

- **Reviewer**：SA2（mabf-sa2），dispatch `sa-6a478776-0479-49bf-aaa1-c6b498a39bfa`，phase design-review，iteration 0
- **Reviewed subject**：`wiki/raw/task_issue-334_design.md`（SA1，iteration 0）
- **评审日期**：2026-09-12
- **Verdict**：**approve**（无 BLOCKER / 无 MAJOR；2 条非阻塞观察，见 §13/§14）

---

## 1. Reviewed inputs

| 输入 | 路径 | 状态 |
|---|---|---|
| 任务简报 | `wiki/raw/task_issue-334.md`（Issue #334 正文 + AC1–AC5；零评论） | 已读 |
| SA1 设计 | `wiki/raw/task_issue-334_design.md`（463 行） | 已逐节攻击 |
| SA6 验收契约 | `wiki/raw/task_issue-334_sa6_contract.md`（verdict approve；S1–S27/TD1–TD6/NC-1…NC-7/B1–B15/V1–V6/R1–R8/F1–F14/E1–E10） | 已逐条对照 |
| SA8 冲突报告 | `wiki/raw/task_issue-334_conflict_report.md`（verdict clear；D-1/D-2/D-3；requiresConflictRecheck=true） | 已读 |
| SA8 决策摘录 | `wiki/raw/task_issue-334_relevant_decisions.md` | 已读 |
| 直接治理 ADR | `docs/adr/0024-readdata-shape-budget.md` | SA2 亲读全文核对 |
| 源码事实 | `packages/doc-runtime/src/read.ts`、`src/index.ts`、`src/carrier.ts`、`packages/namespace-runtime/src/runtime.ts` | SA2 亲读核对行锚 |
| 测试锚 | `read-logical-value-at-path-schema-independent.test.ts/.test-d.ts`、`read-logical-value-at-path-guards.test.ts`、`public-surface-guard.test.ts`、`public-surface-type-guard.test-d.ts`、`runtime-readdata-schema-projection-{control,red}.test.ts`、`vitest.config.ts`、`tsconfig.base.json`/`tsconfig.typecheck.json` | SA2 亲读核对 |
| Issue 评论快照 | REST 读评论成功、零评论（comment IDs: none） | 无 Owner override |

## 2. Verdict

**approve**。设计可直接进入实施。核心理由：

1. **零偏移采纳已钉死口径**：SA6 §12.4（双结果类型 + 重载）、§12.5（V1–V6 校验定序与失败分支）、§12.3（B1–B15 预算语义）、§12.1（T1-1…T1-8 类型面）、§12.11（R1–R8）逐条落位，SA2 逐条比对未发现静默偏移（E10 义务满足）。
2. **事实锚全部核实**：设计 §2 的 12 条事实（行号、签名、调用方、测试锚、runner 配置）经 SA2 独立对源码核验全部属实（详见 §5/§9）。
3. **递归截断记账手工推演通过**：SA2 将设计 §7.3 `containerBudget` 算法对 SA6 S2–S27 全部场景逐条手推，输出（值形状、条目 `(path,kind,omitted)` 多重集、`truncated` 不变量）与 SA6 钉死期望逐一相符（含 S5/S6 计层、S14 depth×width 复合、S19 ④/S20 ③ 折叠不触子项、S24 直接≠后代）。
4. **兼容论证结构性成立**：双结果类型 + 重载使 `ReadLogicalValueResult` 逐字不动 → `runtime.ts:119` 的 `Extract` 派生输入不变 → `NamespaceRuntimeReadDataResult` 公共失败联合零泄漏；既有 5 个冻结锚（含旧三参 `@ts-expect-error` 自反转锚与两个结构性别名）在重载形态下保持绿——SA2 按类型规则逐锚推演确认。

## 3. 需求覆盖

| Requirement | Design section | Assessment |
|---|---|---|
| AC1 预算递归截断省略正确（depth/width 各形态、depth:0 骨架、终态 no-op，doc-runtime 单元面） | §1 目标 1–3、§7.3（决议 C 全文）、§10 行 1（S2–S15/S24/S25） | 覆盖。B1–B15 逐条落位；SA2 手推 S2–S15/S24/S25 全部吻合 |
| AC2 截断事实（位置/裁因/直接子项数）随结果返回、可供 runtime 组合 | §7.1（`truncations` 恒在场四键成功面）、§7.3（条目构造）、§8.3 R2/R4、§10 行 2 | 覆盖。`omitted` raw 口径逐载体钉死（§7.3 槽位表）；组合面为机械加法（T2） |
| AC3 零物化行为哨兵（poison/稀疏空洞预算读 ok:true） | §7.3（折叠/裁减边界零值读零递归，B8）、§7.3 否决备选表、§10 行 3（S19/S20/S21/NC-1/2/7） | 覆盖。裁减在槽位枚举层（先裁后读），哨兵判别机制成立 |
| AC4 缺席吸收与敌意 path 纪律不破（零 throw）；非法 options 新失败分支 | §7.2（V1–V6）、§7.3（B13 导航盲/E1 吸收不变/B15）、§10 行 4（S16–S18 + guards 矩阵） | 覆盖。G0→OPT→N0→N1→P1 定序钉死；零 throw 三层收编（校验内层 try/E100/safeSpreadPath） |
| AC5 无 options 逐字节回归 + 全套门禁 | §7.4（决议 D 三重手段）、§10 行 5（既有锚不改 + S1/S23 + E6/E7/E8） | 覆盖。null 门控 + 构造模式化 + 静态零变化；ALLOW LIST 不含任何既有锚 |
| 简报 What-to-build 五要素（三参形态/递归内生效/同形键省略/封闭 options/直接子项数） | §1 目标 1–6 逐点 | 覆盖，与 ADR-0024 决策 1/2/3/6 一一对应 |

非目标未静默扩大：T2–T5、N-1/N-2、开放问题四项（字节预算/maxTotalNodes/子键列表/L2 透传）全部显式划出（§1 非目标、§12 残余问题）。

## 4. Owner评论覆盖

| Comment ID | Updated at | Design section | Assessment |
|---|---|---|---|
| （无评论） | — | §4（空表 + 说明） | 简报 §Comments：REST 读评论成功、零评论（comment IDs: none）——无 Owner override 需要应用。设计处理正确（显式空表而非遗漏） |

## 5. 上游事实与SA8约束

| Fact or constraint | Design response | Assessment |
|---|---|---|
| SA6 §5/§7 缺口实证（TS2554 ×2、第三参静默忽略、非法 options 静默接受、哨兵必红、3 次 sha256 一致） | §3 缺口链逐条承接；§5 表 | 属实。SA2 复核 `read.ts:53-56` 双参签名与顶层结构一致 |
| `Y.Map.size` 计 undefined 值键（size=3 实证） | §7.3 raw 槽位表：rawTotal = `m.size` | 属实，与 `read.ts:369-371` 现行 keys()/get 吸收行为对齐（raw 口径 ≠ 投影键数） |
| 现行失败读惰性建 ROOT（`carrier.ts` probeRoot → `doc.getMap('ROOT')`） | §7.2 V2 零 doc 触碰锚 | 属实。SA2 亲读 `carrier.ts:53-55`：`getMap` 缺席惰性创建——`share.has('ROOT')` 锚有判别力 |
| SA6 §4 基线全绿（374 tests + tsc exit 0）与冻结锚清单 | §2 事实 #9、§7.4 | 属实。锚文件均在 `packages/doc-runtime/test/` 且 ALLOW 不含 |
| SA8 D-1（三约束：可组合/逐字不变/不借路径码） | §7.1 决议 A（逐字采纳 §12.4） | 落实。`READ_OPTIONS_INVALID` 只进 budget 联合；2 参静态型恰为原联合 |
| SA8 D-2（校验边界三要素成文） | §7.2 决议 B（V1–V6 逐条） | 落实。定序/零 throw/失败字段（path 回显 + 非空 message、禁带截断键）全成文 |
| SA8 D-3（实现后冻结面复查） | §6 表、§10 E6/E7、§14 | 预留证据位（`git diff --stat` 仅允许文件等） |
| SA8 N-1/N-2（docs 债） | §11 DENY + §12 follow-up 登记 | 正确不越界（非 T1 义务） |
| SA8 §10 / SA6 §15 requiresConflictRecheck=true | §14 维持 true 并给理由 | 一致。本评审未发现新增 ADR 冲突风险（见 §14 注） |
| ADR-0024 决策 1/2/3/6 原文 | §7 各决议 | SA2 亲读 ADR 全文逐句比对：决策 1 的 depth:0 骨架句、决策 2 的唯一例外句、决策 3 的 omitted 钉死句、决策 6 的「不新增第二条读路径」均被设计忠实承接；决策 4/5/7 正确划出 T1 范围 |
| ADR-0016 L74 / ADR-0008 L27 修订前原文张力 | §6（按修订后决策集执行） | 与 SA8 §3 裁决一致（显式修订登记消解，非静默矛盾） |

上游事实与源码矛盾：**未发现**（SA2 独立核对 `read.ts`/`index.ts`/`carrier.ts`/`runtime.ts`/`vitest.config.ts`/`tsconfig.*` 与设计引用一致）。

## 6. 设计内部一致性

| 检查项 | 结论 |
|---|---|
| §7.1 类型形状 vs SA6 §12.1 | 逐字段一致（含 `omitted ≥ 1` 注释、budget 失败面双成员、`message` 必填差异与现行 `message?` 并存合法） |
| §7.2 定序 vs §8.2 编排状态机 | 一致（G0→OPT→N0→N1→P1；E100 兜底原样） |
| §7.3 归一化（Infinity 填充）vs §7.3 算法（`d === 0`/`min(rawTotal, K)` 纯算术） | 自洽：`Infinity - 1 === Infinity`、`rawTotal > Infinity` 恒 false，无双轴分支（见 §14 观察 O-2 的措辞冗余，非矛盾） |
| §7.4 门控 vs §8.3 R1/R2 数据流 | 一致：legacy 模式 `ctx.budget === null`，`truncations` 恒空零写入，成功构造按模式 2/4 键 |
| §7.1 重载 vs §2 事实 #1/#6 与既有类型锚 | 一致且经 SA2 推演保持锚绿（§9） |
| §10 验收映射 vs SA6 §12.7/§12.10 | 场景编号一一沿用；E5 变异清单与 SA6 一致（m1–m6） |
| 死引用 / 旧 API / 前后相反 | 未发现。设计引用的全部文件、行号、测试名目经核实在库 |
| 「附录承认但正文未改」式伪修订 | 未发现 |

## 7. 状态机与并发攻击

现读路径为同步纯函数、零模块级可变态（`read.ts` 头注 INV-R9/R10）；设计不引入状态。针对单次调用阶段序与可重入面的攻击：

| ID | Initial state | Trigger | Expected behavior | Design gap | Required revision |
|---|---|---|---|---|---|
| C1 | 任意 | `read(doc, null, {depth:-1})`（path 与 options 双非法） | G0 优先 → `PATH_NOT_ALLOWED`（V1 钉死） | 无（§7.2 V1 显式） | — |
| C2 | fresh doc（`share.has('ROOT') === false`） | 非法 options | N0 前短路，`share.has('ROOT')` 保持 false、update 计数 +0 | 无（§7.2 V2；`carrier.ts` 惰性建事实保证判别力） | — |
| C3 | 任意 | options 为敌意 Proxy（ownKeys/getOwnPropertyDescriptor/getPrototypeOf trap 抛） | 校验内层 try 收编为 `READ_OPTIONS_INVALID`，绝不外抛、绝不执行 accessor | 无（§7.2 V3 策略 A） | — |
| C4 | 任意 | 同一调用内投影中途失败（保留槽位含不可表示值） | fail-fast 单错透传；失败面不带 `truncated`/`truncations` | 无（§7.3 算法、§7.2 V5） | — |
| C5 | 任意 | 并发/重复调用（含同 options 对象复用） | 调用级新鲜累加器；深等、身份互异；options 前后深等（零变异） | 无（§7.3 条目路径构造、§8.3 R2、S27） | — |
| C6 | 任意 | 迟到的 E100（内部 bug）出现在 budget 读 | E100 返回 `PATH_NOT_ALLOWED` 成员（budget 联合含该成员形状），message 带 DOCRT-E100 前缀 | 无（§7.2 V4） | — |
| C7 | 循环引用 plain 结构 + depth 预算 | 折叠先于无限递归 → 成功返回（与 legacy E100 不同） | 设计 §7.3 已成文为预算自然结果，legacy 路径不变 | 无 | — |
| C8 | 导航中途遇 detached 载体（含末段目标为 detached） | 中途下钻：navClassify detached 前置 → `PATH_NOT_ALLOWED`（现行不变）；目标节点在 depth:0 下折叠 vs detached 守卫的先后 | S19 ④ 已钉子项折叠先于 detached 判别（B15）；**目标节点自身**该角落设计未显式点名（见观察 O-1） | 小缺口（无任何钉死场景被违反，两读法皆 fail-safe） | 非阻塞；建议补一句钉死 + 一条锚（§14 O-1） |

## 8. 错误与恢复攻击

| ID | Failure | Current design behavior | Risk | Required revision |
|---|---|---|---|---|
| E1 | 路径/载体缺陷（段型/空洞/终态下钻/detached 展开/值域违规/敌意 path） | 现行 `PATH_NOT_ALLOWED` 通道原样（G0/N0/N1/P1），预算不掩盖（NC-4） | 无——options 分支在 N0 前短路，不可能吞路径失败 | — |
| E2 | options 域缺陷（非对象/非 plain 宿主/未知键/值域/accessor/敌意） | 新 `READ_OPTIONS_INVALID`，同步不抛、零 doc 触碰、path 新鲜回显、非空 message | 无——不借 `PATH_NOT_ALLOWED`/`RUNTIME_READ_DISABLED`/E100（V4/V6） | — |
| E3 | 「先物化再裁剪」退化实现 | 被哨兵锚（S19/S20）+ 变异 m2 击杀；且为设计明文禁止手法（F-反例 1） | 设计已结构性排除 | — |
| E4 | 保留槽位外仍 `get`（如先 `entries()` 再切片） | 槽位表钉死「前 kept 后断」；E5 m1/m2 变异击杀 | 设计已钉死 | — |
| E5 | 截断通道伪成功（失败结果带截断键 / 条件在场） | 失败面禁带截断键；成功面恒四键（S7 空清单在场锚） | 无 | — |
| E6 | message 被当契约 | V5 明示非契约字段；测试不断言精确文本 | 无 | — |
| E7 | 清单规模失控 | 每节点至多一条（B3/B11），规模随预算间接约束（ADR 决策 3 同款论证） | 无 | — |

静默失败/部分成功伪成功/回滚真实性：本切片无持久化副作用（纯读、零写零事件），无回滚面；失败分类三态表（§9）与调用方可见性（结果联合）完备。

## 9. 契约影响审查

| API or contract | Missing or weak caller handling | Evidence | Required revision |
|---|---|---|---|
| `readLogicalValueAtPath` 2 参重载 | 无：现存全部生产/测试调用均为 2 参（SA2 全仓 grep：生产仅 `runtime.ts:484`；`vfsl/src/index.ts:86` 为注释；其余为测试），重载 1 精确承接，静态型恰为原 `ReadLogicalValueResult` | grep 160 命中逐一归类 | — |
| `ReadLogicalValueResult` 类型 | 无：成员逐字不动；`runtime.ts:119` `Extract<…,{ok:false}>` 输入不变 → `NamespaceRuntimeReadDataResult` 零泄漏（SA2 亲核 runtime.ts:119/126-129/484-486） | runtime.ts:119 | — |
| 旧三参 `@ts-expect-error` 自反转锚（`schema-independent.test-d.ts:44`） | 无：`(derived, doc, [])` 对重载 2 首参 `DerivedSchema` ↛ `Y.Doc` 仍编译错误、对重载 1 三参仍 TS2554——directive 保持消费，锚绿 | test-d:42-47 + SA2 类型推演 | — |
| 单参 `@ts-expect-error`（test-d:46） | 无：重载 1 双参必选 → TS2554 保持 | test-d:45-46 | — |
| 结果联合结构性别名（`schema-independent.test.ts:81-83`、`guards.test.ts:29-31`、`runtime-readdata-schema-projection-red.test.ts:50-53`） | 无：`ReadLogicalValueResult` 不动则别名不动（设计 §7.1 否决表关于单联合加宽会迫使这些改动 + Extract 泄漏的论据，经 SA2 核实成立） | 三文件亲读 | — |
| `public-surface-guard.test.ts`（值面） | 无：仅断言值导出（`typeof ns.readLogicalValueAtPath === 'function'` 等），新增类型导出不受影响；T1-7 零新值导出 | 该文件 33-50 亲读 | — |
| `public-surface-type-guard.test-d.ts` | 无：加法导入 3 新名目（TS2305 锚机制既有先例）；既有名目不动 | 该文件亲读 | — |
| runtime 负控（`runtime-readdata-schema-projection-control.test.ts:25`「成功恰两键」） | 无：2 参路径逐字节不变 → 原样绿 | 该文件亲读 | — |
| registry lease / wire / persistence | 零接触（DENY + 范围纪律） | SA8 §4 冻结面 | — |
| T2 runtime 组合面（未来） | 已在调用方矩阵单列（机械消费四键成功面），不与本切片耦合 | §9 矩阵行 | — |

未覆盖调用方：**无**（全仓引用枚举完备）。

## 10. 架构一致性与惯例审查

### 责任归属

| Behavior | Expected owner | Design location | Assessment |
|---|---|---|---|
| 预算递归 + 截断事实 | `@nomicore/doc-runtime` 载体投影（ADR-0024 决策 6） | `read.ts` 贯通现有双递归（§7.3 F10） | 正确，无越位 |
| runtime 组合五键 | `@nomicore/namespace-runtime`（T2） | 显式非目标 + 调用方矩阵 | 正确，未抢先 |
| options 校验 | 读域内部（不新增公共校验器） | `read.ts` 内部非导出 `validateReadOptions` | 正确 |

### 相似能力对照

| Similar capability | Existing implementation | Proposed design | Consistent or divergent | Reason |
|---|---|---|---|---|
| 槽位读取纪律 | `readableOwnDataValue`/`readableArrayElement`（descriptor 读零 accessor 执行） | 预算模式复用同一助手读保留槽位（§7.3 槽位表） | 一致 | 键空间纪律单源 |
| plain 判据 | `isPlainRecord`（数据载体侧，容忍 plain 中继原型链） | options 宿主判据**刻意更严**（仅 `Object.prototype`/null 原型） | 有据分叉 | 控制面输入 vs 数据载体面的显式分野，设计 §7.2 已成文理由（SA6 §12.2 R7 同源） |
| plain 域拷贝 | `copyPlainStrict`（与 `extract.ts copyPlainValue` 显式分叉先例） | 预算贯通同一条 `copyPlainStrict`，不分叉 | 一致 | F10「不新增第二条读路径」 |
| 失败构造 | `notAllowed`/`safeSpreadPath`/E100 收编 | `optionsInvalid` 复用同款 path 回显纪律 | 一致 | R5 仓内先例（E100 亦回显 path） |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| 截断事实 | 投影递归内的单次遍历（`ctx.truncations` 调用级累加） | `truncated = truncations.length > 0`（构造点派生） | 无（无第二份清单、无模块级缓存、无 memo） |
| 预算值 | 调用方 options（校验后归一化一次） | `ValidatedBudget` 调用局部 | 无（零驻留；S27 深等锚） |
| 读语义 | ADR-0024（+0008/0016 修订后） | 设计/CONTEXT 词条 | 无（设计零 docs 改动，N-2 已登记） |

### 生命周期对称性

纯同步读、无 register/dispose、无订阅、无后台任务——`truncations`/`p`/条目全部调用局部，调用结束即可回收（§8.3「无清理责任」成立）。无不对称面。

### 平行机制检查

| Candidate duplicate | Existing path | Proposed path | Disposition |
|---|---|---|---|
| 第二投影递归族 | `projectValue`/`projectYMap`/`projectYArray`/`copyPlainStrict` | ctx/d/p 尾参贯通同族 | 无平行（F10 结构性满足；否决备选表明文拒绝复制族） |
| 第二读入口 | `readLogicalValueAtPath` 唯一 | 重载不新增值导出（T1-7） | 无平行 |
| 第二校验管线 | 无（options 为全新输入域） | `validateReadOptions` 内部函数 | 合理新增，非重复 |
| 第二失败通道 | `PATH_NOT_ALLOWED` 单码 | 新码只进新联合 | 无混用（V5/V6） |

阻断项检查（错误 Owner / 绕过既有能力 / 双事实源 / 生命周期不对称 / 无迁移方案的分叉协议 / 「改动更少」式架构偏离）：**全部未命中**。

## 11. 文件范围审查

| Path or scope issue | Evidence | Required revision |
|---|---|---|
| ALLOW LIST = `read.ts` + `index.ts`（加法类型导出）+ 3 新测试文件 + `public-surface-type-guard.test-d.ts`（仅加法） | 与 SA6 §10 允许面逐行一致，无一行超出 | — |
| DENY：既有 5 读锚不改 | 锚文件在库且 ALLOW 不含；F13/E4 | — |
| DENY：`runtime.ts`（:119/:484）、namespace-runtime/registry/vfsl/vfsl-protocol 其余、wire/协议、`docs/adr/*`、`CONTEXT.md`、`docs/integration/**`、runner/tsconfig 根配置 | 与 SA8 §4 冻结面、T2–T5 切分、N-1/N-2 登记一致；runner include 经 SA2 核实已覆盖新测试路径（`vitest.config.ts` include/typecheck include） | — |
| 头注更新（`read.ts` 模块头注补预算段）属 ALLOW 内文档性改动 | §8.1 明示 | — |
| follow-up 清单（T2–T5/N-1/N-2/L2/发布）不掩盖本任务必要项 | AC1–AC5 + E1–E10 + 包门禁全部在「任务内必要条件」（§12） | — |

无 ALLOW 无理由扩张；无 DENY 与正文冲突。

## 12. 验收设计审查

| Requirement or risk | Proposed evidence | Gap | Required revision |
|---|---|---|---|
| AC1 | 新套件 S2–S15/S24/S25（F-CANON 夹具，`(path,kind,omitted)` 多重集断言） | 无。SA2 手推全部场景与设计算法输出一致（含 S6 ROOT depth:1 的 5 条条目 4/3/2/2/3、S14 复合预算恰 1 条 width、S13 plain 载体） | — |
| AC2 | S2/S4/S7/S14（恒在场、空清单为数组、`truncated === (length>0)`） | 无 | — |
| AC3 | S19（depth）/S20（width）/S21 反证/NC-1/NC-2/NC-7 | 无。哨兵夹具有效性由 NC-1 自证、非宽松由 NC-2/NC-7 反证 | — |
| AC4 | S16/S17/S18 + guards 文件（§12.2 矩阵全类别 + V2 零触碰 + V3 零副作用） | 无 | — |
| AC5 | 既有 5 锚不改全绿 + S1/S23 + E6/E7/E8（diff 面/typecheck/root test） | 无 | — |
| 类型面 | TD1–TD6 + public-surface-type-guard 加法锚 | 无。`exactOptionalPropertyTypes`/`strict` 已核实在 `tsconfig.base.json`（TD4/H11 前提成立） | — |
| 红→绿节奏 | E1（红 = TS2554 + 目标行为断言）→ E2 → E3 | 无。红因是缺口本身 | — |
| 变异敏感 | E5 m1–m6 逐条红/还原绿 | 无 | — |
| 测试入口真实性 | `vitest.config.ts` include `packages/*/test/**/*.test.ts`、typecheck include `**/*.test-d.ts`；SA6 §14 探针实证 | 无。SA2 复核 include 规则属实 | — |
| 观察行为而非源码文本 | 全部经 `src/index.ts` 公共接缝；唯一例外（accessor 计数、`share.has('ROOT')`）为载体可观测面 | 无 | — |
| detached 目标 + depth:0 角落 | 无钉死场景（SA6 S 清单亦无） | 小：两读法皆可通过全部既有钉死场景（见 O-1） | 非阻塞建议（§14） |

## 13. Required revisions

无 BLOCKER、无 MAJOR finding。设计可安全进入实施。

（阻断表为空——本设计的全部关键口径均有 SA6/SA8 钉死来源且逐字采纳，SA2 独立攻击未击穿任何一面。）

## 14. Non-blocking observations

| ID | 观察 | 建议 | 不阻断理由 |
|---|---|---|---|
| O-1 | **detached 载体作为 P1 目标节点 + `depth:0`** 的折叠先后：设计 §7.3 的通则（「detached 判别不前置到折叠判定」，B15 同款）覆盖递归子项（S19 ④ 钉死），但目标节点自身（如 `['holder','ys'],{depth:0}`，detached Y.Map 经 plain 属性可达为终点）未被任何 S 场景钉死；伪代码锚「containerBudget（进入任一容器分支时）」与「projectValue 的 detached 守卫原样生效」并读时，目标入口处的先后存在实现自由度。按设计通则应折叠（ok:true + `{}` + depth 条目）；按守卫字面则 `PATH_NOT_ALLOWED` | 实施阶段在设计/实现注释中补一句钉死目标入口折叠先于 detached 守卫（与 B15 通则一致），并在 shape-budget 套件加一条 `['holder','ys'],{depth:0}` 锚（两读法择一锚定即可） | 无任何 SA6 钉死场景被两读法之一违反；两读法均 fail-safe（折叠 = 零物化一致；守卫 = 现行 fail-loud）；ADR 对该角落沉默 |
| O-2 | §8.2 编排式 `d₀ = ctx.budget?.depth ?? ∞` 与 §7.3 归一化（缺席轴已填 `Number.POSITIVE_INFINITY`）冗余——`budget.depth` 恒为 number，`?? ∞` 永不触发，易让实现者误以为 legacy 模式也传数值深度 | 实施时按归一化不变式直接取 `ctx.budget.depth`（legacy 模式该形参不被使用），或注明 `?? ∞` 仅为防御性书写 | 纯措辞冗余，无数值或行为后果 |

**requiresConflictRecheck**：本评审**不提交**（未发现需要重新执行 ADR 冲突检查的新风险）。SA8 §10 / SA6 §15 / 设计 §14 已登记的 conflict recheck（公共 API 加性扩展 + 新失败语义面）继续按原计划在实现后执行（D-3）。

---

## 评审方法附注（证据可追溯性）

- 源码事实核验：SA2 亲读 `packages/doc-runtime/src/read.ts`（全文 454 行）、`src/index.ts`、`src/carrier.ts`、`packages/namespace-runtime/src/runtime.ts`（Extract 与 readData 调用点）；设计 §2 事实 #1–#12 的行锚全部命中。
- 调用方枚举：全仓 `readLogicalValueAtPath` grep（160 命中）逐条归类——生产 2 参唯一消费方 `runtime.ts:484`；注释 1 处（`vfsl/src/index.ts:86`）；其余为测试（全部 2 参）。`ReadLogicalValueResult` grep（31 命中）确认跨包消费面（runtime.ts:119 Extract、red test-d 导入、两处本地结构性别名）。
- 算法推演：`containerBudget` 对 S2–S27 逐场景手推（含 F-CANON 9 键 ROOT 的 S6/S14 计层与条目多重集、S19 ④/S20 ③ 折叠零接触、S21 反证、S24 直接≠后代、S12 Y.Map 现场序派生、S22 规模形状、S25 空容器、S26 值内形态、S27 新鲜性）。
- 兼容推演：重载形态下既有 4 类锚（正例双参、旧三参 expect-error、单参 expect-error、结果联合 narrowing）与 public-surface 两文件的绿性按 TS 重载/弱类型/exactOptionalPropertyTypes 规则逐锚推演。
- ADR 比对：`docs/adr/0024-readdata-shape-budget.md` 全文亲读，决策 1/2/3/6、修订节、验收节与 SA8 摘录、SA6 契约、SA1 设计三方一致性核对。

—— 评审结束 ——
