# 冲突门禁报告 — 设计后复审（issue #93 round 2 / rev1）

- 被审对象：`wiki/raw/task_namespace-runtime-integration-acceptance-rev1_design.md`（SA1 修订设计，749 行，D-1..D-7）
- 冲突基准：`docs/adr/0001`–`0008` 全集（Phase 0 已全读，本轮复核对涉事条款）+ `CONTEXT.md`（含 round 1 停接纳词条）+ SA8 Phase 0 裁决（`…-rev1_conflict_report.md`「SA1 设计约束清单」7 条 + 增补 G/H/I）
- 门禁类型：设计后复审（Phase 2；全维度攻击评审属 SA2，本报告只裁 ADR/裁决一致性与越界）
- 独立核查证据：E 码占用 grep（E100/E200–E205 在用、E206 空闲、ADR 全文零 DOCRT 码）、schema-replace E200 锚面 grep（零）、post-close getter 调用面全集 grep（close-lifecycle:214-221 唯一）、index.js 导入方全集 grep（包外零消费方）、`validateLogicalSnapshot` 消费面核查（validate.ts:650 只读 `derived.values`）、`detached-build.ts:77`「ROOT 结构节点非 map 形」裸 throw 核查、p0-sequencer:180-200 / sync-read-face:85-100 / public-surface-ownership:83-127 / sa7-dynamic:378-380 逐行回读、包级 README/docs 不存在核查。

## Verdict

**`clear`**

D-1..D-7 全部落在 Phase 0 裁决边界内：无越界、无偷工、无静默扩 scope；新码注册（NSRT-SCHEMA-E2 / DOCRT-E206）均在 ADR-0008 L125「码定义处 append-only 注册表、不逐码入本文」机制内，ADR 正文零改动声明成立；CONTEXT.md 停接纳词条新文字逐点兑现裁决 B③。**必修项：无。** 以下 A1–A4 为建议级备注（不阻塞 SA2/SA6/SA3，落实施时随手处置即可）。

## 逐条复核结论

### 1. D-1..D-7 vs Phase 0 约束清单 7 条（逐条）

| 约束 | 设计落点 | 复核结论 |
|---|---|---|
| 1 公共面（A/G） | D-1 | **在界内**。值导出恰 `RuntimeWriteFatalError` 一键；类型恰 11 项——与 Phase 0 G 清单**逐一对应**（SA8 清单 11 类型 vs 设计 §1.2 清单 11 类型，人工比对零差）；`NamespaceRuntimeSeamInput` 随值撤出；`package.json` exports 维持 `{"."}`（DENY LIST 锚定，现状核实恰此一键）；seam/生产工厂 runtime.ts 模块级逐字节不动；17 个具名导入文件切换 + exports-audit 仅改锚——对照 SA8 独立 grep 全集（17 具名 + 1 namespace + 2 仅类型 = 20）**无遗漏** |
| 2 close 停接纳（B/H） | D-2 | **在界内**。门禁 key 恰 `state.lifecycle !== 'ready'`（§2.2 伪代码逐字）；同步 throw 稳定码 `RUNTIME_READ_DISABLED`、包内类不导出、message 分 getter 域（L117/L119 码族纪律）；成功返回类型不改、不静默 null；拒绝先于触碰 live Y.Doc；`getStatus` 保留（status.ts 零改动）；CONTEXT 词条 §2.7 兑现 B③ 全部四点（三 getter 入停接纳 / throw 通道说明 / getStatus 保留+「生命周期观测面」定性 / _Avoid_ 收窄），并保留「internal fatal 不触发 read/getter 停接纳」（H） |
| 3 schema-replace 边界（C） | D-3 | **在界内，且选择的是 SA8 C 明文授权的回退路②**（「无可靠判别器则例外整体撤销」逐字兑现，见下节详核）；改动半径恰 = schema-replace.ts catch 分级 + 头注/锚（C 硬边界「只动 catch 分级与其单元锚」逐字满足）；replace.ts / materialize.ts / mutation.ts 零改动（DENY LIST + 零回归锚 #14）；schema-write/write/p0 fatal 机械零改动 |
| 4 载体分流（D） | D-4 | **在界内**。缺席→null 保留（Permissive 锚 #12）；异型 public → `NSRT-SCHEMA-E2` loud throw；p0 模式数据级 unavailable 且机械保证禁 fatal（p0 分支 return null → runP0 catch 结构性不可达 → ENV-1 → unavailable，终点恰为 SA8 D 要求的两合法终点之一）；组合锚（unavailable + getter E2 throw）T4.2 兑现 SA8 D「明示义务」；§4.4 修复路径精确语义是对 SA8 D 的诚实补强（异型不可原地修复、修复=尝试通道不被 fatal 关闭——与 L59 相容） |
| 5 测试形态（E） | D-5/D-6 | **在界内**。生产装配 = 包内 `createNamespaceRuntime` + 真实 createDoc + `() => persistence.saveDoc(handle)`（L45 逐字调用形）+ 真实 compile + 双 Adapter；pre-commit fatal = seam 仅注 compile throw（L91「fault」注入授权）+ 其余全真；U-1 断言面覆盖 SA8 E② 全部七点（notifier 恰 0 / 零 update+字节不变 / fatal 摘要 / fatal 后只读 / 后续写 RUNTIME_WRITE_DISABLED / close release 恰一次）；File 至少覆盖 pre-commit（U-2）+ 建议面 committed（U-3）；两形态分立文件（§5.4）兑现「勿强行合一」；U-3 用生产工厂 + doc 级 observer 注入属构造器覆盖最大化，不违反分立纪律（fault 源是 doc 级而非 seam） |
| 6 walker 共享（F） | D-7 | **在界内**。共享恰三族纯函数原语（descriptor 事实 / 安全写入 / 申报词）；遍历器、失败分级、冻结纪律、循环策略、plain 判据各自保留（§7.2 声明 + `isPlainRecord` 不与 write.ts 共用的差异注记）；查序逐位保留（write ①②③④⑤）；零回归硬验收 = §13 全量 |
| 7 文档对齐（AC7） | §0.2/7 + §10 | **在界内**。ADR 全部 DENY；CONTEXT 仅停接纳词条；新码注册机制见下节；包级 README/docs **不存在**（核查：packages/namespace-runtime 仅 src/test/package.json/tsconfig；全仓 .md 中提及 seam/getter 的只有 ADR 0008 本身）——DENY LIST 的「docs/namespace-runtime*.md 如存在」条款为空集，无 AC7 悬空 |

**越界/偷工/静默扩 scope 扫描**：新增项仅 T1.4（package.json exports 键集审计——读包内配置文件非 docs 文本，不违 round 1「包测试不读仓库根 docs」纪律）、U-3/U-4（SA8 E② 明文「建议同时补 committed File 面」与「P0 fatal 变体可选」授权内）、plain-data.ts（F 授权）。**未发现越界。**

### 2. ADR 一致性（新码注册 + 零改动声明 + CONTEXT 新文字）

- **NSRT-SCHEMA-E2（errors.ts）**：ADR-0008 L125 明文「其余公共面可观测稳定码**不逐码入本文**，以包内各稳定码定义处的 append-only 注册表为准」——枚举括号非穷尽，E2 落 errors.ts 定义处即注册完成，无需 ADR 改动。`SchemaProjectionError` code 宽化 E1\|E2 镜像 `MetaProjectionError`（errors.ts:103-111 既有 E1|E2 双码一类先例，已核对）；类不导出、E1 构造点 message 逐字节不动。**成立。**
- **DOCRT-E206（schema-replace.ts）**：E 码占用 grep 证实 E100 / E200 / E201 / E202 / E203 / E204 / E205 在用、**E206 空闲**——append-only 声明成立。ADR 0001–0008 全文**零 DOCRT 码枚举**（grep 证实）——doc-runtime 码域本就以「码定义处」为注册表（与 L125 哲学同构），E206 注册不触发任何 ADR 条款。Runtime 层 fatal message 仍恒定模板（INV-N7），E206 仅经 rejection `cause` 可观测——`cause` 保留原始异常是 ADR-0008/errors.ts 既有公共契约。**成立。**
- **ADR 0008 正文零改动声明**：涉事条款复核——L91（包内 seam/生产工厂）：设计强化不改写；L93（停接纳公共 read）：设计是**执行**该条款而非修订；L117（RUNTIME_READ_DISABLED）：码已注册，getter 复用属码族内使用；L119（message 分域）：照办；L125（注册表归属）：E2 按机制注册。**零改动声明成立**（DENY LIST 全 docs/adr/ 兜底）。
- **CONTEXT.md 停接纳词条新文字（§2.7）vs 裁决 B③**：三 getter 入停接纳 ✓（「与 read 同属停接纳范围——同步 loud throw 稳定码 RUNTIME_READ_DISABLED…message 区分 getter 域与 lifecycle 值」）；getStatus 保留 ✓（「全生命周期可用（生命周期观测面，非数据投影），不在停接纳范围」）；_Avoid_ 收窄 ✓（第三分句「观测 getter 不可用」→「getStatus 不可用」）；附加保留「internal fatal 只永久禁写并保留读取，不触发 read/getter 停接纳」✓（H 的词条级固化）。**逐点兑现。**

### 3. D-3「例外整体撤销」闭环复核（四问）

- **① E200 分支零合法领域流量 / 零既有锚**：源码复核——prepare 全部领域失败（①b envelope 形状 / ①c 载体探针 / ①d extract·validate·build issues / ①d' ROOT 载体）均以 `{kind:'fail', issues}` **return**、不经 catch（schema-replace.ts:147/151/161/163/170/172/175 逐行核实）；catch 只承接 sentinel、裸 throw、探针第五态。锚面 grep——**无任何测试断言 schema-replace 的 E200**（sa7-dynamic:20/365 仅注释性「非 E200」否定表述；replaceSchemaAndRoot 全仓消费方 = doc-runtime index re-export + schema-write.ts:162，无 doc-runtime 直接单测）。**成立。**
- **② 残余可达面论证**：provided-root 过深 → `snapshotMutation`/copyFrozen 递归先炸 → `MUTATION_INPUT_NOT_PLAIN_DATA` ok:false（write.ts S3 先于 doc-runtime——源码序核实）；keep-root doc 深度由既往经受控写入建立；残余带 = copyFrozen 与 extract/build 的帧成本差。**论证成立**（帧成本差「约 2–4 倍」为未实测估计，见 A4 备注——结论不依赖该常数）。补充独立佐证：`validateLogicalSnapshot` 只消费 `derived.values`（validate.ts:650），深输入的 struct 面与 validate 面正交，进一步收窄意外入口。
- **③ 零写入承诺字面成立**：E206 从 prepare 抛出，物理位置在 `transactGuarded`（唯一事务）之前；prepare 全路径只读（唯一「创建」是 ①c 缺席时 `getMap` 惰性建空 map——yjs 零 update，既有注释锚定）；`committed:false` → Runtime 不调 notifier（U-1 断言 4/5 锁定 0 次 + 字节不变）。ADR-0007 L54 零写入承诺在 fatal 形状下同样兑付（SA8 C 已裁定）。**成立。**
- **④ 与裁决 C 回退条款逐字一致性**：SA8 C原文「若 SA1/SA2 无法给出…判别器，则例外整体撤销——catch 命中除 sentinel 外一律 fatal」；设计 §3.2 结论「选 ②。catch 命中除 `DerivedInvariantError` 外一律 `DocRuntimeFatalError('pre-commit-internal', false)`」。**逐字一致。** 判别器否决论证（V8 消息串非契约 / 栈溢出截断 stack / 深度探针三重新机械 + 魔法阈值 / 输入伪造面永久暴露）达到 SA8 C 设定的「确定性且可对抗审查」否决标准。**成立。**
- **附加核查（T3.1 δ 注入路径可达性）**：`structure.node = 42` 过 namespace-runtime `assertCompiledShape`（只查 envelope/指纹/module/derived 对象性，不查 structure——源码核实）→ ①a `kind==='root'` 过 → validateLogicalSnapshot 不读 structure（② 佐证）→ `buildTopEntries` → `rootEntries(derived.structure.node…)` → detached-build.ts:77「ROOT 结构节点非 map 形」**裸 throw**（非 sentinel，源码核实）→ catch → E206。**δ 路径结构性可达，红灯可造。**

### 4. 增补 H 复核（门禁 key 仅 lifecycle）

设计面：§2.1 硬边界 1 明文「绝不 keyed on fatal / schemaState / handle 状态」；§2.2 伪代码 key 恰 `state.lifecycle !== 'ready'`；§2.2 getActiveSchema 注释「preparing/unavailable/fatal 期 null 照常」。测试面：T2.3（fatal×close 用例内显式负向锚——fatal 置位、lifecycle 仍 ready → 三 getter 照常，close 后才 throw）+ T2.5（unavailable/preparing 期 getter 照常绿锚：p0-sequencer:183-197 与 sync-read-face:87-97，两处 SA8 逐行回读证实现状确实如此）+ 既有隐式负向锚 sa7-dynamic:378-379（E204 fatal 后 getter 照常，回读证实）。**设计陈述与测试锚双侧齐备。**

### 5. 改锚清单与测试矩阵完备性

- exports-audit:21-49 ✓（§9.1 四行覆盖 :21-24 键集 / :27-43 forbidden 增补 seam / :45-49 删 typeof 断言 / :10-12 头注）。
- public-surface-ownership:84-88 ✓（§9.2；SA8 回读证实 :87 即 `toBeTypeOf('function')` 断言，:55 import 行；另 :21-24 头注一并覆盖）。
- close-lifecycle:184-221 ✓（§9.3 三行：import 拆分 / 闭前捕获语义反转注释 / post-close not.toThrow→toThrow(code)，:216 envBefore 四键断言保留的处理明确）。
- 19 个 import 涉及文件：§1.5 表 18 行 + §9.5 的 14 文件枚举，与 SA8 独立 grep 全集（17 个具名 seam 导入切换 + exports-audit 仅改锚 + 2 个仅类型零改动）**完全一致，无遗漏**；包外导入方 grep **零**（tests/ 根目录与 apps 均无）。
- SA8 补查设计未点名的潜在受影响锚：**post-close getter 调用面**——设计 caller audit 声称 close-lifecycle:185-221「唯一」，SA8 独立 grep 证实（close-sa7-dynamic 全文零 getter 调用；fullchain 的 getter 调用 :110/142/145/213/222 全部先于各自 close :163/242/307）——**声明属实，无漏锚**。closing-drain 窗口内 getter 调用：零（既有锚不受影响，T2.2 新增覆盖）。
- 零回归 18 项抽查证实：#2（F-3:66-96）、#4（γ:333-388）、#8（read 联合）、#10（p0-sequencer/sync-read-face 行号属实）、#14（materialize-root-rev2:369-393）、#18（两 type-guard 文件仅导入 NamespaceRuntime 类型——grep 证实）。**完备。**

## 建议级备注（A1–A4，非必修）

- **A1（§1.5 计数表述）**：「19 个文件中的 18 个值导入」算术口径含混——实况为 20 个 index.js 导入文件 = 17 个具名 seam 导入切换 + 1 个 namespace 导入仅改锚（exports-audit）+ 2 个仅类型零改动。枚举表本身完整正确，无执行风险；建议 SA3/SA6 以表为准、勿按Header 口径计数。
- **A2（T3.1 δ 注入的隐性依赖）**：δ 可达性依赖「validateLogicalSnapshot 不读 derived.structure」（今日为真，validate.ts:650）与「assertCompiledShape 不查 structure」（今日为真）——若未来任一守卫加严，δ 静默失效（不再落入 catch）。SA6 造红灯时如发现 δ 未达 catch，备选注入：aliases 表 accessor 陷阱。非必修（今日两点均经源码证实）。
- **A3（T4.1 措辞）**：「ready 期 `getSchemaEnvelope()`」的「ready」指 lifecycle（异型载体 doc 的 P0 必结算 unavailable，schema.state≠ready）——建议 SA6 落锚时措辞用「lifecycle ready」消歧。
- **A4（§3.2.2 常数）**：「约 2–4 倍帧成本差」为未实测估计；撤销决策的稳健性不依赖该值（残余带窄的结论由 snapshotter 前置闸结构性保证），无需补测。

## 结论

verdict = **clear**。设计后复审放行：D-1..D-7 与 Phase 0 裁决 A–F+G/H/I 及 ADR 0001–0008 + CONTEXT.md 零冲突，新码注册合法、零改动声明成立、改锚与测试矩阵完备（SA8 独立 grep 三项关键「唯一/零/全集」声明全部证实）。无必修项（N 清单空）；A1–A4 为建议级备注，交 SA2/SA6/SA3 顺带处置。设计可进入 SA2 全维度评审。
