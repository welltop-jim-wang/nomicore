# 冲突门禁报告（设计后复审，rev1 第二阶段门禁）

- **被审对象**：`wiki/raw/task_read-logical-value-at-path_rev1_design.md`（SA1 rev1 修订设计，403 行，commit `25d6bb5`；核心增量：D16 NavOutcome 三态化 / D17 union value-first 仲裁四规则 + mixed 优先级 / D18 优先级成文与两层仲裁调和 / D13 memo 重述 / §3.5 观测等价定理）
- **冲突基准**：`docs/adr/` 全集（0001–0007，共 7 份，本轮逐份全文重读，无抽样）+ `CONTEXT.md`。基准自首轮门禁后零变更（同前置门禁结论，未发现新增 ADR 或修订节）。
- **复审性质**：设计后复审（轻量）——只裁设计与 ADR/CONTEXT 一致性 + 前置门禁注记 1–5 义务履行 + AC-R3 成文义务；全维度攻击评审属 SA2，不在本报告范围。
- **门禁人**：SA8（Conflict Gatekeeper）
- **日期**：2026-08-22（worktree `/home/wangjian/nomicore-fix-issue-75`，branch `fix/issue-75-on-docs-doc-runtime-validation`，run_id `issue-75-rev-1787397220`）

## Verdict

`clear`

SA1 rev1 设计与 ADR 全集（0001–0007）+ CONTEXT.md **零冲突**：不推翻、不演进、不 override 任何 ADR 条款；前置门禁注记 1–5 义务全部履行；AC-R3 成文义务全部履行。总控可放行进入 SA2 攻击评审。

## ADR 盘点（7 份逐份对照设计）

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted（2026-08-19 修订节） | 间接 | 无冲突。设计改动面仅 `packages/doc-runtime/src/read.ts` + version bump（§8.1），不触 schema 文本、方言冻结、SchemaSource 接缝、脚手架纪律；§8.3 DENY 明文排除 `packages/vfsl/src/**`、`packages/vfsl-protocol/**`、`packages/vfsl-codegen/**`。ADR-0001 前提「引擎必须在运行时解析任意合法方言文本」⇒ `readLogicalValueAtPath` 须对任意合法 derived 正确——设计的归谬论证与 value-first 硬化不依赖特定 schema 形状，对任意合法 derived 成立，与该前提同向 |
| ADR-0002 | nomicore 是全新重写，authority 出范围 | accepted | 无关 | 无冲突。纯读取导航内部仲裁与缺席编码修订；不涉 authority、不触「结构 → 值 → 单事务提交」写入管线 |
| ADR-0003 | 求值器与派生 schema | accepted（取代同号草稿，无对外 supersede） | **直接** | 无冲突，逐条款见下表。要点：value-first 是「路径存在性为**任一成员出现即存在**」的构造性兑付（设计 §1.3 第 3 点明文援引）；any-of / 重叠成员合法性保留（value 重叠平局按声明序取首者）；判别式零读取维持（INV-4）；派生 schema 形状零触碰（DENY）；swap 限域是「重叠成员不构成错误」+ 声明序平局裁决的必然推论而非违反 |
| ADR-0004 | vfsl-protocol 类型协议包 | accepted | 间接 | 无冲突。协议包「零运行时代码」不构成运行时约束；设计不触类型投影（DENY `packages/vfsl-protocol/**`）；D5 空路径 `[]` 分支的跨层参照由 D12 空路径零改动（§3.6）保持 |
| ADR-0005 | 投影生成管线 | accepted | 无关 | 无冲突。codegen 管线与运行时读取无交集 |
| ADR-0006 | Cordis 持久化插件与 doc 三条目布局 | accepted（含 createDoc/owner 修订节） | 间接 | 无冲突。读取面仍止于 ROOT 子树（Phase B 自 `derived.structure.node` 起导航，SCHEMA/META 兄弟条目不在读取面）；不触持久层 |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge 分层 | accepted | **直接** | 无冲突，逐条款见下表。要点：公共 `readLogicalValueAtPath` 契约零改动（签名/两态结果联合/同步不抛错）；合法缺席三源语义逐字保持（仅包内编码迁移）；「不合并成巨型 issue 类型」被 INV-14 显式援引并遵守；成本条款由 D13 同式上界重述继续满足 |

无任何 ADR 处于 superseded 状态（同前置门禁结论：ADR-0003 取代同号未定稿草稿、ADR-0006 修订节取代本 ADR 内部早期条款，均按现行有效文本对照）。设计附 A「条款对照表」所取代/精确化的全部是**首轮设计文档条款**（D4/§4.4/D13 等）与任务族不变量（INV-7），**无一涉及 ADR**；附 B 明文「不推翻任何 ADR 与首轮决策」——无 override-declared、无 evolution 项。

## 设计决策逐条对照（直接相关 ADR 条款）

| # | 设计决策（rev1） | ADR 条款（原文） | 裁决 | 依据 |
|---|---|---|---|---|
| 1 | D16：`NavOutcome` 三态 `{kind:'value'} \| {kind:'missing'} \| {kind:'reject'}`，包内私有 | 「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型」（0007） | no-conflict | 三态化为 read.ts 包内私有类型（现行两态 read.ts:261 已核实）；公共 `ReadLogicalValueResult` 两态冻结（§6 审计：契约零改动）；INV-14 明文禁止 missing/reject 泄漏公共联合与 issues 体系，test-d 形态锁在案 |
| 2 | D17 规则 1：首个真实 value 胜出（声明序迭代不变） | 「路径存在性为**任一成员出现即存在**」（0003 §3）；「匹配语义 **any-of**……重叠成员不构成错误」（0003 §3） | no-conflict | 任一成员可产出值即不得判缺失——value-first 是该条款的构造性兑付；any-of 活导航与声明序迭代（INV-7）原样保留；value 重叠平局按声明序取首者，重叠合法性不被收窄 |
| 3 | D17 规则 2：missing 不胜出、继续后序成员 | 同上（0003 §3 存在性条款） | no-conflict | 「首个 ok（含 missing）短路」若可达恰是对存在性条款的违反；修订封死该病态——收紧而非推翻（前置门禁对照 #2 结论在设计层兑现） |
| 4 | D17 规则 3：无 value 且有 missing → `{ok:true, value:undefined}`（value 键显式构造） | 「合法 optional/Record/数组缺失返回 `undefined`」（0007 readLogicalValueAtPath 条款） | no-conflict | 合法缺席三源（M1 Record 缺键 / M2 optional 缺席 / M3 非负整数越界）语义归属逐字不变，仅包内编码从 `{ok:true,value:undefined}` 迁移为 `{kind:'missing'}`，顶层映射后公共形态逐字复原（FC-3）；AC3 缺键形态（value 键显式存在）保持 |
| 5 | D17 规则 4：全体成员 reject → `PATH_NOT_ALLOWED` | 「Yjs 结构与路径/操作错误 fail-fast」（0007） | no-conflict | reject 单通道收束 `notAllowed`（D6 失败单通道零改动）；PATH_NOT_ALLOWED 保持 doc-runtime 领域化错误码，不并入 issues 体系 |
| 6 | D17 mixed 优先级：missing > reject（reject 成员非可行成员，不否决 missing 结局） | 「合法 optional/Record/数组缺失返回 `undefined`」（0007）+「至少一个成员接受即接受」（0003 §3） | no-conflict | 前置门禁注记 2 指定的开放点已落定：可行成员 = 产出 value 或 missing 的成员（§3.3.2 形式化）；missing 成员为合法缺席接受者，any-of 满足；两序 mixed（missing 先/后）均与现行首 ok 胜行为一致（观测等价 Case 2；SA5 实证 5a/5c 锚定）；fail-fast 约束错误处理风格，不要求放弃 any-of 成员试探，无抵触 |
| 7 | D18 三分法 M1–M10（M4 required 缺席 → reject；M5 载体错位 → reject；M1-M3 合法缺席 → missing） | 「合法 optional/Record/数组缺失返回 `undefined`」（0007，白名单不含 required）；CONTEXT.md「封闭对象：子集内对象类型默认封闭：未声明字段拒绝」 | no-conflict | required 缺席维持 C2 拒绝（拒绝虚假降级立法，不因三态化软化，H-4 风险条目在案）；M7 封闭成员无此字段 → reject 让位后序成员，与非 union 场景 Phase A 拒绝（封闭对象条款）及 any-of 键空间并集语义相容；「数组缺失」以格式合法越界为白名单（M3），负数/非整数下标仍拒（M6，D9 不变） |
| 8 | D18 两层仲裁调和表 + INV-7 精确化（「可产出 = 产出真实 value；missing 不构成胜出」） | 「平局按声明序」（0003 §3 no-match 诊断条款的平局裁决精神；该条款本身属校验相位移交，不约束读取仲裁） | no-conflict | 两层以路径耗尽为唯一接缝各自闭合：中段仲裁归 `navigate`，终点仲裁归 `walk → walkUnion`（逐字继承 extract，SUP-1 ground truth 锚维持）；两层同用声明序 tie-breaker，无策略分歧面；软拒/reject 不对称被论证为问题差异的忠实反映（提交层须产出整子树投影 vs 导航层只回答本路径能否产出） |
| 9 | D18 swap 限域：swap 不变仅对终点=叶子/标量成立；终点=union 重叠投影交换序合法改变结果 | 「重叠成员不构成错误」（0003 §3）；「平局按声明序」（0003 §3） | no-conflict | 前置门禁注记 2 的强制限域已按建议落成文（§3.3.3 normative 措辞 + SA6 R5 组已限域落测）；设计明文「任何实现不得对终点=union 的重叠投影承诺 swap 不变」——这是 ADR-0003 重叠合法性的必然推论，若反之承诺全称 swap 不变才会与该 ADR 相抵 |
| 10 | D13 重述：memo 键形不变、值域扩至三态、健全性论证原样成立、上界 O(触及节点数 × 路径长 × 成员扇出) 同式 | 「普通读取成本与目标 path 子树规模相关」（0007 后果节） | no-conflict | 前置门禁注记 4 义务履行：健全性条件「键完全决定值」与结局编码无关的论证成文（§3.4）；试探集扩大仅常数因子、每 (节点, live, i) 至多计算一次；SUP-2 护栏（22 层重叠联合 <2s）维持有效并论证其最坏路径不含 missing 短路受益 |
| 11 | §3.5 观测等价定理：合法输入上修订前后公共结果逐字相同；边界（手造派生物 E100 域）诚实成文 | 「readLogicalValueAtPath……同步按路径读取」（0007）；首轮冻结契约「同步、不抛错」 | no-conflict | 定理支撑「契约零改动」主张（AC-R5 全绿护栏的行为锚）；E100 域分叉仅在非法派生物上发生，属 C3 防御域非契约面，顶层 catch（D11）维持结构化返回、不新增公共 throw 路径（§6 五类契约改动逐项为零） |
| 12 | §8 文件清单：ALLOW = read.ts（~50 行）+ doc-runtime package.json version bump + SA6 owned 测试（已入库 `23851e1`）+ 可选 hardening 测试；DENY 含 `packages/vfsl/src/**`、extract.ts/carrier.ts/index.ts 的 rev1 新增改动、Phase A 全部 | 无对应 ADR 条款（版本 bump 为流水线门禁 #9 惯例，非 ADR；测试属任务族纪律） | no-conflict | 改动半径与被裁缺陷域精确重合；工作树实证：`git diff 23851e1..HEAD -- packages/vfsl packages/doc-runtime/src` 为空（设计入库提交 `25d6bb5` 仅触 wiki），注记 5 当前状态成立 |

## 前置门禁注记 1–5 义务履行核对

前置报告：`task_read-logical-value-at-path_rev1_conflict_report.md`（verdict clear，注记 1–5 指定义务）。

| 注记 | 义务 | 设计履行 | 判定 |
|---|---|---|---|
| 1 | 缺陷可达性由 SA5/SA6 落定；AC-R4 前三类竞争测试若不可构造 → 降级为论证性覆盖并成文，不得虚构 fixture、不得放宽结构系统 | §1.2 收录 SA5 四步归谬（结构性不可达）为设计地基；§4 将 R1–R3 组落为**绿灯行为锁**（SA6 18 例已入库 `23851e1`，本报告核实 18 个 `it(`），明文「竞争在结构系统内不可构造红灯，不得虚构 fixture、不得放宽结构系统」；§8.3 DENY 补充「结构系统不得为凑红灯测试虚构可达性而放宽（E309 等禁令是归谬成立的前提事实，必须保持）」 | ✅ 履行 |
| 2 | INV-7 精确化成文；mixed missing+reject 优先级显式落定；swap 测试限域 | §3.3.3 INV-7 精确化逐字采纳建议措辞（「可产出 = 产出真实 value；missing 不构成胜出」）；§3.3.2 mixed 裁决 missing > reject + 「可行成员」形式化定义；swap 限域 normative 成文且 SA6 R5 组按限域落测 | ✅ 履行 |
| 3 | 公共接缝冻结：三态限包内；公共两态联合与同步不抛错签名不变；missing/reject 不并入公共 issues 体系 | §3.2 顶层三态→两态映射（missing → `{ok:true,value:undefined}` FC-3 显式构造；reject → notAllowed）；§6 契约审计五类改动逐项为零 + Caller 清单；INV-14（三态不泄漏）+ test-d 冻结形态锁；ADR-0007「不合并成巨型 issue 类型」被显式援引 | ✅ 履行 |
| 4 | memo 健全性重述 + 多项式成本上界 + ADR-0007 成本条款继续满足 | §3.4 专节重述：键形不变（`Map<StructureNode, Map<unknown, Map<number, NavOutcome>>>`）、健全性零新假设、上界同式对照表、SUP-2 护栏维持论证、0007 条款显式引注 | ✅ 履行 |
| 5 | DENY 保持：`packages/vfsl` 零改动；compilePattern/matchPattern 消费方式不变 | §2「不动」清单含 `packages/vfsl` 一切源码；§8.2 标注 vfsl index.ts/package.json rev1 零改动（无 bump 义务）；§8.3 DENY 首条 `packages/vfsl/src/**`；Phase A（keyPattern 消费面）一字不动（§3.6）；工作树 git diff 实证零改动 | ✅ 履行 |

## AC-R3 成文义务核对

简报 AC-R3：「明确 required-missing / 载体错位 / 合法缺席的优先级，并与现有 extract/union 声明序规则一致（在设计文档中成文）」。

| 义务成分 | 设计落点 | 判定 |
|---|---|---|
| required-missing 优先级 | §3.3.1 M4：**reject**（C2 不变量外；拒绝虚假降级立法援引）+ H-4 风险条目 + SUP-2 Phase B 既有锁 | ✅ |
| 载体错位优先级 | §3.3.1 M5：**reject**（非 union 场景 C2 / union 场景成员回退信号，D9） | ✅ |
| 合法缺席优先级 | §3.3.1 M1–M3：**missing**（三源白名单）+ §3.3.2 组合优先级 **value > missing > reject**（normative） | ✅ |
| 「可行成员」语义形式化 | §3.3.2：可行成员 = 产出 value 或 missing 的成员；规则 3 严格化为 `∃ missing ∧ ¬∃ value → missing` | ✅ |
| 与 extract 声明序规则调和 | §3.3.3 六维调和表（extract.ts `walkUnion` 提交层 vs read `navigate` 导航层）+ 三层一致性论证（平局精神同源 / 接缝单一=路径耗尽 / 软拒-reject 不对称=问题差异忠实反映） | ✅ |
| INV-7 精确化立法 | §3.3.3 normative 措辞（行为不变，SA5 (b)2） | ✅ |
| swap 不变式限域 | §3.3.3 normative：仅终点=叶子/标量成立；终点=union 重叠投影合法改变（ADR-0003 重叠合法性推论） | ✅ |

AC-R3 全部成文义务履行，且成文内容与 ADR-0003 声明序/重叠合法性条款一致（对照 #8/#9）。

## 冲突点

无。

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | （空表：0 冲突点） |

裁决分布：no-conflict ×12（设计决策逐条）＋7（ADR 盘点）＋5/5（注记义务）＋7/7（AC-R3 成分）；override-declared ×0；evolution ×0；hard-violation ×0。

## 结论

**Verdict = clear，放行。** SA1 rev1 设计（D16/D17/D18/D13 重述/§3.5 定理）与 ADR 全集 + CONTEXT.md 零冲突：ADR-0007 公共条款零改动（契约审计五类改动逐项为零）、ADR-0003 存在性/any-of/重叠合法/判别式缓存条款逐条同向收紧、派生 schema 形状与 `packages/vfsl` 零触碰。前置门禁注记 1–5 义务全部履行，AC-R3 成文义务全部履行。无需 override，无 Jim 裁决项，无 ADR 演进。

**非冲突移交注记（不阻塞，供 SA2 攻击评审聚焦）**：

- 定理与归谬的有效性裁决属 SA2（观测等价定理证明、四步归谬、INV-12 完备性论证的攻击面）；SA8 仅裁其结论与 ADR 不冲突。
- §8.1 可选测试文件（`-rev1-hardening.test.ts`，SA4/SA7 裁量）与 doc-runtime version bump（0.1.2→0.1.3，流水线门禁 #9）为任务族纪律项，非 ADR 约束，SA2/SA4 按既有惯例处置。
- 设计对现行代码的三处行号引注（read.ts:261 / 323-334 / 343-349）经本门禁 grep 逐字核实相符；SA6 18 例测试在库（`23851e1`）核实。
