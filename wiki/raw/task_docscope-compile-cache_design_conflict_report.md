# 冲突门禁报告（设计后复审）

- 被审对象：SA1 设计 `wiki/raw/task_docscope-compile-cache_design.md`（R1，2026-08-21，D1–D10 十项决策）
- 冲突基准：`docs/adr/0001–0005` + `CONTEXT.md`（全量盘点与 superseded 状态核查见前置门禁报告 `task_docscope-compile-cache_conflict_report.md`，本次不重复；代码与 wiki 其他文档不构成阻塞依据，仅作设计现状声称的抽查验证）
- 门禁类型：设计后复审（SA1 产出后；全维度攻击评审属 SA2，本报告只裁 ADR/CONTEXT 一致性）
- 报告：SA8（Conflict Gatekeeper），只读裁决，未改动设计与任务简报
- 边缘项编号接续前置门禁报告（#1–#6），本报告新增 #7–#12

## Verdict

`clear`

## 指定重点复核项（续传任务点名三项）

### 复核 1：前置门禁边缘项 #1 —— getCompiled 是否组合而非取代冻结接缝 → **维持 no-conflict**

证据链（设计 R1 全文 + 代码现状抽查）：

1. **冻结承诺明文**：设计头注「冻结接缝（本设计不改其契约）：`parseVfsl` / `evaluate` / `validateSnapshot` / `validatePatch`（ADR-0003 §1）」；DENY LIST 将 evaluate.ts / parser.ts 等 9 个源文件列为「冻结接缝与内部实现，本任务零改动（getCompiled 组合它们，不改它们）」。
2. **组合事实**：§5.2 实现以值导入调用 `parseVfsl(text)` 与 `evaluate(parsed.module)`——两接缝以原签名、原语义被组合，未被吞并；§10 契约改动连锁审计结论「无公共契约改动」，evaluate 在 index.ts 的导入形态调整（re-export 拆两行）「公共面不变（同名同源 re-export）」——ADR-0003「以各自 Interface 作为公共观察点」的地位不动。
3. **被否方案 B 所保护的设计自由保留**：缓存插入位在「文本到手之后、parseVfsl 之前」（组合层外层）；parse 与 evaluate 之间插缓存的可能性完整无损（两接缝仍可被独立调用与加层）。设计 §2 自述与此一致：「getCompiled 不吞并 evaluate 接缝，故无此问题」。
4. **现状抽查属实**：`index.ts:63` 现为 `export { evaluate } from './evaluate.js'`；`evaluate.ts:45` 为 `export function evaluate(module: VfslModule): EvaluateResult`（同步签名）——设计引用的接缝形态与代码一致。

延伸复核（D5 对既有公共接缝 `parseSchemaEnvelope` 的内部重构）：抽出 `envelopeTextGate` 前探门、`parseSchemaEnvelope` 内部改用，设计承诺「行为逐字节不变」且以执行序同构论证（§9 #6）、H1 验收测试零改动为回归承诺（DENY LIST 明列）。公共签名 / 返回类型 / 抛错行为均不变——内部重构不触碰公共观察点条款。no-conflict。

### 复核 2：前置门禁提示 #2 —— 命名避开 registry/compiler 语系 → **已遵守**

- 公共面新名：`getCompiled` / `CompiledOk` / `GetCompiledResult`；内部名：`compiledCache` / `envelopeTextGate` / `vfslIssues` / `deepFreeze` / `sha256Hex` / `utf8Bytes`；模块名 `sha256.ts`。全文检索无 registry/compiler 命名使用（「SCHEMA_REGISTRY」仅出现于 D2 被否方案栏，作为否决论证而非命名）；设计自检节同样声明「未出现 registry/compiler 语系」。
- 无按 id 注册/寻址：D2 键 = 纯文本哈希，「id 键控（复活 SCHEMA_REGISTRY 语义）」列为被否方案——CONTEXT.md 命名空间条目 _Avoid_ 的机制性禁令未被触碰。
- 未把求值器称作编译器；「编译缓存」即 CONTEXT.md 作用域绑定条目自身用词；`compiler` 预留词（Phase 1 contract 包组合入口）未被侵占——getCompiled 不以 compiler 命名。
- 观察项（非冲突，措辞层）：CONTEXT.md 派生 schema 条目 _Avoid_「编译产物」（指 derived 的别称）；设计散文以「编译产物」指 `{module, derived}` 双产出组合（任务简报同款用法，指称对象不同，且「编译缓存」为认可词）。建议正式文档措辞统一为「编译缓存条目」以彻底避嫌。

### 复核 3：前置门禁提示 #4 —— 缓存值纪律裁定（D4.3 深冻结）→ **no-conflict**

- 裁定内容：入册前对 `CompiledOk` 条目（容器 + module + derived 引用图）递归 `Object.freeze`；消费者变异共享引用在 ESM 严格模式下抛 TypeError（loud，非静默）。
- 对照 ADR-0003 纪律「纯数据、可 JSON 序列化、可内容哈希、不携带行列位置」：冻结不改值形状、不改 `JSON.stringify` 行为、不影响哈希计算、不添加属性——四项纪律全部保持；「不得变异」以可观测的 loud 方式被执行，与「未知方言 loud-fail」的响亮失败哲学同向。
- ADR 全集无「禁止冻结」或「必须冻结」条款。`derived.ts:7-12` 既有「不 Object.freeze」是代码现状注释（求值器设计的域内决策，非 ADR 基准、不构成自动阻塞依据）；设计 D4.3 论证为「逃逸条款下的域内再评估」——只冻 getCompiled 入册条目，evaluate 本体输出不动（DENY LIST 承诺 evaluate.ts 零改动）。基准层面无约束冲突。
- 手段选择（深冻结 vs 防御性拷贝 vs 纯文档契约）的优劣权衡属 SA2 领地；门禁只登记：该裁定未违反任何 ADR/CONTEXT 条款。

## 设计引入新决策的对照（新边缘项 #7–#12，均 no-conflict）

| # | 严重度 | 条款（ADR/CONTEXT） | 设计决策 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 7 | — | CONTEXT.md 作用域绑定（DocScope）：「每个命名空间绑定自己的方言解释器、规则集与编译缓存；多方言并存不需要进程级“当前版本”」 | D3 包级单册（进程级模块 Map），per-DocScope 实例留 v2 | no-conflict | 条目第二句自述目的是消灭进程级「当前版本」单例方言态（SCHEMA_REGISTRY 病根），规范核心是隔离性而非缓存物理实例拓扑；缓存值是纯函数产物（ADR-0003 纯函数接缝），内容寻址下跨命名空间共享无任何可观测差异，AC3 隔离性语义成立；任务简报「处处取用同一对象引用」唯进程级单册可全局兑付（per-scope 册将「处处」退化为「同 scope 内」）；条目无 _Avoid_ 机制禁令；设计自我登记 v2 实例工厂演进路径且公共契约不变。若 owner 对该术语取强字面（物理 per-scope 册），属演进选项而非当前约束——登记供 SA2/owner 复核 |
| 8 | — | ADR-0001「解释行为由信封自述的方言版本决定」 | D6 裸文本路径隐式 vfsl@1 直入 parseVfsl | no-conflict | 条款辖域是信封内文本的解释行为；裸文本无信封即无自述对象，条款不适用。设计明确拒绝伪信封（「给文本包一层伪信封（造不存在的方言声明）」列被否方案）——不伪造方言声明正是对自述原则的尊重；parseVfsl 本体即 vfsl@1 解析器，「隐式 vfsl@1」是函数定义域事实而非方言断言。文本输入为任务简报明文授权（「信封或文本」） |
| 9 | — | ADR-0001「方言只增不改」 | D2 键 = sha256(纯文本)，不含方言域（v1） | no-conflict（附前瞻登记） | v1 引擎仅存在 vfsl@1 一种解释器（信封路径经 gate 全部收窄为 vfsl@1、文本路径亦然），同文本跨方言串味在当前不可能发生；设计自我登记「方言前缀域分离 v1 无收益」。**登记未来义务**：引入第二个方言版本的票必须同步升级缓存键域（含方言维度），否则内容寻址键将跨方言串味——建议固化为后续票验收项 |
| 10 | — | ADR-0003 §1 evaluate 可失败结果联合 | D4 只存 ok 分支；D7 失败统一 `SchemaParseIssue[]`（kind:'vfsl' 包装、message 零损） | no-conflict | 只存 ok 是结果联合在缓存层的自然投影（前置门禁边缘项 #2 结论维持）；getCompiled 自身返回形状无 ADR 冻结条款，包装复用 H1 issues 域不触碰 evaluate 契约本体 |
| 11 | — | ADR-0005 §1「async 从第一天起：DocSchemaSource 终态走网络；接缝按终态设计」 | D1 裁定 getCompiled 同步 | no-conflict | 条款辖域为 SchemaSource **加载**接缝（`load`/`list` 返回 Promise）；getCompiled 不做加载（消费已到手的信封/文本），其组合链条现状全部同步纯函数（parseSchemaEnvelope / parseVfsl / evaluate，抽查属实）。async 原则未被违反亦未被裁废——设计已留 v2 演进位（§6「若 v2 出现 async 编译接缝再引入 in-flight 去重」）；前置门禁提示 #3 的条件（「若 getCompiled 输入经 SchemaSource 加载而来」）在 v1 不成立，加载是上游接缝职责 |
| 12 | — | ADR-0001「未知方言 loud-fail 只读」+ ADR-0005 §1「消费方首动作 = 方言断言」 | D5 经 envelopeTextGate 复用 H1 单点（assertVfslDialect 间接复用），拒绝路径不触 Map | no-conflict | 方言断言先于文本解释、断言单点复用、未知方言零缓存项——与两条款完全同向（前置门禁边缘项 #6 结论维持）；schemasource.ts 零改动（DENY LIST），SchemaSource 辖域未被侵入 |

超出 ADR 基准的事项（门禁辖域外，仅登记状态）：设计 §11 上报的 SA6 红灯测试三处 fixture 缺陷（AC4.1 case-3 方言字段、AC1.2/AC5 fixture 唯一化）**已由 SA6 按设计 §11 最小修正案执行完毕**（任务简报「修正记录」2026-08-21 R1，总控逐条核实，修正后仍为构造性红灯 12F/1P，`tsc` 仅剩预期缺失导出错误）。测试文件不构成 ADR 冲突基准，本门禁不裁决其是非；该事项不影响本报告 Verdict。

## ADR 盘点（增量：仅设计触点条款）

| 编号 | 设计触点条款 | 对照结论 |
|---|---|---|
| 0001 | 编译缓存条款、方言冻结/loud-fail、信封自述、纯引擎仓库 | no-conflict（复核 1 + 边缘项 #7/#8/#9/#12；纯引擎与零仓内 schema 资产由 ALLOW/DENY LIST 兑现） |
| 0002 | authority 完全出范围 | 未触及（设计未引入任何 authority 概念或旧 manifest 接口） |
| 0003 | §1 公共观察点 + 被否方案 B、结果联合、纯数据纪律 | no-conflict（复核 1/#10；深冻结不破坏纯数据纪律——复核 3） |
| 0004 | D3 协议包边界（零运行时、不含工厂、不进引擎包反向隔离） | no-conflict（DENY LIST 明列 `packages/vfsl-protocol/**` 零改动；`package.json` 现状无 `dependencies` 字段——零依赖承诺与现状一致，AC6.1 可兑付） |
| 0005 | §1 id 标签不是键 / async 辖域 / 方言断言首动作、§3 生成器输入契约 | no-conflict（边缘项 #9/#11/#12；§3 双产出消费方式维持前置门禁边缘项 #5 结论——codegen 自 derived 取用） |

全量盘点与 superseded 状态见前置门禁报告，本次无变化（5/5 accepted、无 superseded）。

## 结论

**Verdict: clear，放行。** R1 设计的 D1–D10 逐项对照 ADR-0001~0005 与 CONTEXT.md，未发现直接违反；续传任务点名的水三项重点复核（边缘项 #1 组合性、提示 #2 命名、提示 #4 缓存值纪律）全部通过，且设计的现状声称经代码抽查属实。新增六个边缘项（#7–#12）均裁 no-conflict；无 override-declared、无 evolution。最接近冲突的是 #7（进程级单册 vs「每个命名空间绑定自己的编译缓存」）——经论证属术语规范语义（隔离性、消灭进程级当前版本）之内的实现自由，设计并已自我登记 v2 演进路径；若 owner 对该术语取强字面物理隔离，为演进选项而非当前硬约束。

非阻塞登记（供 SA2 评审与后续票）：

1. **#9 未来方言义务**：引入第二个方言版本时必须同步升级缓存键域（含方言维度），否则纯文本内容寻址键将跨方言串味——建议作为 v2 注或后续票验收项固化。
2. **措辞观察**（复核 2）：CONTEXT.md 中「编译产物」是派生 schema 的 _Avoid_ 别称，设计散文以之指 `{module, derived}` 组合——建议正式文档统一用「编译缓存条目」，避免术语混淆。
3. **§11 SA6 测试缺陷**为门禁辖域外事项：三处 fixture 修正已由 SA6 执行完毕（简报修正记录 R1，总控核实），不阻塞本设计进入 SA2 评审。
4. **简报增量复核（设计后复审补充）**：任务简报在本前置门禁后追加了「SA6 测试设计」节（What to build 与 6 项 AC 原文逐字未变，前置门禁 verdict 不受影响）。新增节逐项对照：H1 通道拒绝全等/零缓存、evaluate spy 命中不重算、零依赖清单守卫、thenable 不预锁形态——与 ADR-0001（loud-fail/编译缓存）、ADR-0003（公共观察点/结果联合）全部同向，无新冲突面。
