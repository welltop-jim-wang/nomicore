# SA2 攻击评审报告

**Date**: 2026-08-19
**Verdict**: reject（#1 CRITICAL：按现设计实现，红灯测试无法全绿——Record 值位物化规则与测试契约/spec/SA1 自身对账三方冲突；#2~#4 MAJOR 须一并修订后重审）

**审查对象**: `wiki/raw/task_vfsl-evaluator_design.md`（SA1 设计）
**输入**: 任务简报 + SA6 红灯测试（37 条，实测复核 `37 failed` 与记录一致）+ ADR 0003 + spec §2/§3/§10 + `ir.ts`/`shapes.ts`/`semantic.ts`/`parser.ts`/`index.ts` 源码核对

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| 1 | CRITICAL | §4.1 record 行 / §4.2 materializeMapForm 'record' 分支 / §7.1 索引填充 / §8.2 复制点论证 | **Record 值位物化漏 ref 解析，红灯必不转绿且设计自相矛盾**。详见下文「攻击点 #1 展开」 | Record 值位立为第三解析点（resolveChain 后物化），同步修订 §8.2 与「唯二例外」表述 |
| 2 | MAJOR | §3.1 fold throw / §9 I3 | E309 的安全论证链缺环：措辞「同步上下文」比解析层实际检查范围（非 PV 上下文**全域**，shapes.ts:667 `t.kind === 'union' && !inPV` 收集条件）**窄**；且 fold throw 在 ok 模块上输入为空集，实际依赖三条防线（E309 全域拒绝非 PV 混合联合 / structureOf 对 YPlainArray 不递归 / valueOf 不做桶折叠），设计只隐含了第一条的一半 | §3.1 与 §9 I3 改写：E309 范围 = 非 PV 全域（引用 shapes.ts 的 inPV 旗标），并显式立论后两条求值器侧防线 |
| 3 | MAJOR | §5.2 判别式检测条件 (b) | **多候选判别字段的选择规则缺失**：联合同时有多个满足「公共非可选字面量且两两互异」的字段（如成员都带 `kind` 与 `status`）时选哪个 F 未定义。§8.3 确定性纪律只保证「同一实现两次求值相等」，不保证跨实现版本稳定——派生物是编译缓存的缓存值（§1.2），`discriminator.field` 选择漂移 → 内容哈希漂移 → 缓存伪 miss | 钉死确定性规则：「取**首成员字段声明序**中最先满足 (b)+(c) 的字段」 |
| 4 | MAJOR（低触发概率） | §3.1 能力 (1) bodies 构造 / §2.2 前置声明 / §9 I6 | **重名手造 IR 静默后者覆盖**：`bodies: Map` 构造遇 `module.aliases` 重名（ok 模块不可能——E302 已挡；手造可能）不抛错，后者覆盖前者，产出 `ok:true` 的垃圾派生物。这是 §9 不变量表 I1~I6 中**唯一无 loud 处置路径**的条目（重名既不产生结构缺席 TypeError 也不触发显式 Internal），直接违反 §2.2「手工构造的 IR……不静默产出垃圾派生物」的自我声明 | bodies 构造时遇重名 → throw Internal（一个 Set 检查），§9 I6 处置列补「重名 → Internal」 |
| 5 | MINOR | §3.2 顶层 catch | 伪代码 `E100 内部错误（err.message）` 直取 `.message`——内部若 throw 非 Error（string/null），message 变 `'undefined'`。设计声称「与 parseVfsl 的 §15.4 崩溃边界同款」，但 parseVfsl（index.ts:46）有 `err instanceof Error ? err.message : String(err)` 守卫——并不同款。另应复用 `makeIssue`（errors.ts）保持 `VFSL-E100:` 前缀构造一致 | 镜像 instanceof 守卫 + makeIssue 构造 |
| 6 | NOTE | §5.2 byValue 键构造 | `{kind:1}\|{kind:2}` 的判别键 `String(1)='1'`：运行时查表语义自洽（`String(运行时值)` 同样字符串化），但**键无法反推字面量的原始类型**（值树侧 enum values 保真为 number）。后续 validateSnapshot 票消费 byValue 时若从键重建期望值会踩坑 | 设计加一句消费纪律声明：「byValue 键恒为 `String(字面量)`，序号跳转是唯一用途，不得从键反推值类型」 |
| 7 | NOTE | §7.1 索引行与树共享对象引用 | `index[...].node` 与树内节点为**同一对象引用**（设计显式选择，序列化计数已对账）——但消费者突变 `index['ROOT'].node` 会交叉污染 `structure`。纯数据纪律未声明不可变约定 | 显式写明冻结决策（v1 至少文档声明「派生物对消费者不可变」，或评估 Object.freeze 的成本） |

### 攻击点 #1 展开（CRITICAL）

**触发条件**：任何 `Record<K, V>` 的 V 为 ref——规格 §10 fixture 的 `assets: Record<AssetId, AssetEntity>` 即命中（V = ref AssetEntity）。`type ROOT = Record<AssetId, AssetEntity>`（E311 允许 Record 形 ROOT，spec §3 ROOT 约定）同样命中。

**设计现状**：
- §4.1 record 行：`map([{ name:'<key>', optional:false, node: structureOf(value) }])`——`structureOf(ref)` 按表内 ref 行产 `{kind:'ref', name}` 终态；
- §4.2 明文「ref 在结构树中的**唯二**非终态位」= 解析点① ROOT 入口、解析点② YMap 实参——**Record 值位不在其中**；materializeMapForm 的 'record' 分支同样 `structureOf(r.value)`；
- §7.1 索引填充：`record '<key>' → node: value 节点`——即上述 ref 节点。

**后果**：`derived.index['ROOT.assets.<key>'].node` = `{kind:'ref', name:'AssetEntity'}`，而红灯测试断言：
- test.ts:559 `expect(entry?.node.kind).toBe('union')` → **必红**；
- test.ts:576 `resolvePath(derived, 'ROOT.assets.<key>')?.kind` 断言 `'union'` → **必红**：`resolvePath` 在 n=3 命中索引条目后调 `walkFrom(entry.node, segments, 3)`，`i >= segments.length` 时**原样返回节点不穿透 ref**（test.ts:221——穿透只发生在还有剩余段的 ref 分支）。

**设计自相矛盾**：SA1 §7.3「fixture 索引全量对账」自己写着 `ROOT.assets.<key>`(pattern, keyPattern=ASSET_ID_REGEX, **node=union**)——与 §4.1 物化规则表的产出直接冲突。SA3 按规则表实现则测试红，按对账实现则违反「唯二解析点」的 O(文本规模) 论证前提——两边都是设计的冻结文本，无所适从。

**规格依据（SA1 漏引）**：spec §3 默认物化规则表第 5 行明文联合三分类「适用于字段类型、数组元素、**Record 值位**与标记实参」；紧随的联合成员形状归类段直接以 fixture 为例：「附录 fixture 的 `Record<AssetId, AssetEntity>` 即此——`AssetEntity` 的每个联合成员按其对象形状物化为 Y.Map」；spec §10 fixture 注「全部容器形成员——按 §3 三分类物化为多态 Y.Map」。

**修订要求**：
1. §4.1 record 行改为 Record 值位物化前先 `resolveChain(value)`（沿 ref 链取终形再物化：union → unionNode、object → map、record → 递归同规则、marker 按标记行、标量形 → Internal E304/语义不变量位）——即**第三解析点**；§4.2「唯二例外」全文更新为三处（或把解析点②一般化为「容器构造实参位：YMap 实参与 Record 值位」）；
2. §8.2 复制点清单补第 3 条（Record 值位每个文本出现位 +1 份终形复制——与 YMap 实参同型论证，总规模仍 ≤ 常数×文本出现位，O(文本规模) 结论保持），菱形测试对账不受影响（菱形文本无 Record）；
3. 显式声明两树在 Record 值位的**不对称**：结构树解析（测试契约要求），值树仍 ref 终态（§6「永不解析 ref」原则不动，`values` 有自己的别名表可穿透）——防止 SA3 在值树侧画蛇添足或漏做结构侧；
4. §7.3 对账与 §4.1/§7.1 规则文本对齐（当前两处一念之差就是本漏洞）。

---

## 协议假设依据审查

**结论：合规（pass）。**

- §13 章节存在，声明「无协议级假设」并给出理由（纯函数库 + 类型定义，无 HTTP/WS/端口/进程/第三方库假设）——与代码事实相符（新增三个 `src/` 内部件 + index re-export，无任何 IO）。
- 设计中的关键依据均**可定位可复核**：`MAX_TYPE_NESTING = 100`（parser.ts:24 实测确认）、红灯现状 37 failed（本评审重跑 `pnpm vitest run packages/vfsl/test/evaluate-derived-schema.test.ts` 复核一致）、`exactOptionalPropertyTypes` 纪律与负例断言位置（test.ts:442/449 确认）、E304/E306/E309/E310/E311 语义（shapes.ts 逐行核对）。
- 未发现「应该/通常/预计」类无据推断承担设计承重的情况。**唯一近似项**：§1.1「shapes.ts 的 clsOf/memo 体系……只能复用其算法模式」成立，但 §3.1 对 E309 范围的转述与 shapes.ts 实际行为有措辞偏差（攻击点 #2）——属论证精度问题，非无据假设。

## 错误处理链路审查

- **静默失败**：无网络/UI/异步链路（纯同步函数库），主路径无静默失败形态。唯一静默路径 = 攻击点 #4（重名手造 IR 静默后者覆盖后产出 `ok:true` 垃圾）——已列 MAJOR。
- **状态闭环**：一切内部异常（Internal 不变量 / TypeError 解构失败 / RangeError 深度）经顶层 catch 收编为 `{ok:false, issues:[E100]}`，无绕过路径 ✓。
- **降级路径**：无外部依赖，N/A ✓。
- **虚假降级识别**：E100 崩溃边界设计为「命中 = 实现缺陷，不得视为通过」（ok:false 可观测、可测试）——**非伪降级**，与 parseVfsl §15.4 同精神 ✓。「前置检查不做形状校验」的决策由 §9 不变量表兜底，除 I6 重名缺口（#4）外各条目均有 loud 处置 ✓。
- **用户可感知性**：issues 结构化（message/line/column），E100 前缀冻结 ✓。
- 附：#5（catch 的 `.message` 直取）是错误信息质量缺口，不构成静默失败。

## 红线测试思路

> 原则：SA6 已有 37 条覆盖主路径；以下为**针对本评审漏洞的增量红灯构思**，供 SA1 修订设计后、SA3 实现前补入测试蓝图（红灯位置/断言目标已写明，无需本评审亲自写码）。

1. **（#1）Record 值位解析直达**：
   - 存量即红锚：fixture 求值后 `derived.index['ROOT.assets.<key>'].node.kind === 'union'` 且三成员均为 map（字段名集 `['kind','url','width','height','audit']` 等，与 test.ts:599-602 同源但锚在**索引条目**而非别名表）；`resolvePath('ROOT.assets.<key>')?.kind === 'union'`（walkFrom 终态返回语义）。
   - 增量反例（防 SA3 用「联合特判」绕过）：`type ROOT = { m: Record<string, Audit> }; type Audit = { x: string };` → 断言 `index['ROOT.m.<key>'].node.kind === 'map'` 且字段 x 在场（**非** ref）——钉死「Record 值位一律解析」而非「仅联合解析」。
   - 增量正例（ROOT 直接为 Record，E311 允许）：`type ROOT = Record<string, Audit>;` → `asRoot(derived.structure).node.kind === 'map'`、`index['ROOT.<key>']` 存在且 node 为 Audit 的 map 物化。
2. **（#2）PV 混合联合不触 fold**：`type ROOT = { items: YPlainArray<string | { a: number }> };` → 断言 `ok:true`、结构树 `items` 为 `{kind:'plain'}`、值树 `values['ROOT']` 中 items 为 `{kind:'array', element:{kind:'union', members:[scalar, object]}}`（两树正交 + PV 物化不递归 + 值树无桶判定的三防线一次钉死）。
3. **（#3）判别式多候选确定性**：`type ROOT = { m: { kind: "a"; status: "x" } | { kind: "b"; status: "y" } };` → 断言 `m.discriminator.field === 'kind'` 且 `byValue` 为 `{a:0,b:1}`（首成员字段声明序最先满足者；若实现取了 status 则红）。
4. **（#4）重名手造 IR loud 拒绝**：直接调 `evaluate({ kind:'vfsl-module', aliases:[{…name:'ROOT',type:对象A},{…name:'ROOT',type:对象B}] })` → 断言 `ok:false` 且 `issues[0].message` 含 `VFSL-E100`（不产出 ok:true 垃圾派生物）。
5. **（#5）非 Error throw 的 message 不丢**：难以从公共面注入非 Error throw（内部件不导出）——降级为设计评审项即可；若 SA3 以 Internal 类统一抛 Error，此测试可豁免。
6. **（#6/#7）设计声明项**：属文档修订，无行为测试可锚（byValue 键 String 化与引用共享均为既定选择），随设计文本落实即可。

---

## 复审要求

SA1 修订设计时须：
1. **#1 必修**：Record 值位解析点 + §8.2 论证更新 + 两树不对称显式声明 + §7.3/§4.1 文本对齐；
2. **#2/#3/#4 必修**（论证完备性 / 确定性规则 / I6 处置补全——均为文本级修订，成本低）；
3. #5 建议随做（实现期一行守卫）；#6/#7 加声明即可。
4. 修订后 SA2 复审仅核对上述条目，无需全量重攻。

---

# 【R2 Verdict】（2026-08-19，第 2 轮复审）

**Date**: 2026-08-19
**Verdict**: **pass**（R1 全部 7 项攻击点经独立源码核对确认真正消除；SA1 自寻 #8（F4）必要且正确；全新视角补扫未发现新的 CRITICAL/MAJOR，3 项 NOTE 级观察不阻断）

**审查对象**: `wiki/raw/task_vfsl-evaluator_design.md`（R2 修订版，含文末逐条回应表与 R2 修订记录）
**输入**: 任务简报 + SA6 红灯测试（`packages/vfsl/test/evaluate-derived-schema.test.ts`，37 条，锚点逐一实测核对）+ ADR 0003 + spec §2/§3/§10 + `shapes.ts` / `ir.ts` / `errors.ts` / `index.ts` / `parser.ts` 源码逐行核对
**方法**: 按 R1 复审要求第 4 条仅逐条核对攻击点消除情况 + 对 R2 新增内容（F4、解析点③、三防线）以全新视角补扫 + fixture/菱形全链路模拟（37 条断言逐一过）

## 逐条核对（R1 攻击点 → R2 落实，独立验证）

| # | R1 要求 | 落实核对（本评审独立验证的证据） | 结论 |
|---|---|---|---|
| #1 CRITICAL | Record 值位立第三解析点 + §8.2 论证 + 两树不对称 + 文本对齐 | ① §4.1 record 行改为 `structureOf(resolveChain(value))`，materializeMapForm record 分支同源修复；② §4.2 解析点③伪代码显式「一律解析，非联合特判」，含 object→map 增量反例锚（对齐 R1 红线构思 #1 第二条）；③「唯二」表述全文消灭（§4.2 改为「三个解析点 + 无子终态内联」四类闭合枚举，并声明「除此之外不存在第五种 ref 行为」）；④ §8.2 补复制点第 3 条（每出现位 +1 份），菱形对账不受影响——本评审复核 §8.1 计数（ref 35 / map 17 / 索引 3 行）与 test.ts:478-497 断言界一致；⑤ 两树在 Record 值位的不对称显式声明（§4.2 末段 + §6 原则行，防 SA3 两侧画蛇添足/漏做）；⑥ §4.1/§4.2③/§7.1/§7.3 四处 node=union 同源；⑦ spec 依据实测核对：v1-spec.md:135「适用于字段类型、数组元素、Record 值位与标记实参」+ :143-144「`Record<AssetId, AssetEntity>` 即此——每个联合成员按其对象形状物化」，引据准确 | ✅ 消除 |
| #2 MAJOR | E309 范围改写为非 PV 全域 + 显式立论后两条防线 | D1 引据逐行复核属实：shapes.ts:660（`walkModule(a.type, false, …)` 起点）、:667（`t.kind === 'union' && !inPV` 收集条件）、:67（inPV 仅 YPlainArray 分支置真——Record 键/值、标记实参、别名身体全在非 PV 全域内）、:691（逐联合 checkE309）；「非纯值全域」措辞与实际检查范围一致。D2（§4.1 YPlainArray 行不递归）/ D3（§6 值树 union 行只认全字面量→enum，不咨询 typeCls/fold）为求值器侧显式立论并各配红灯锚 | ✅ 消除 |
| #3 MAJOR | 判别多候选字段选定规则钉死 | §5.2 选定规则入伪代码：首成员字段声明序最先满足 (b)+(c) 者（E308 在 errors.ts:29 在册，保证首成员字段无重名 → 序确定）；§8.3 新增「跨版本确定性」冻结清单（选择点一经冻结永不漂移，改写即破坏性变更走版本协商）；锚点例 `{kind,status}` → field='kind' 正确（与 R1 红线构思 #3 同形） | ✅ 消除 |
| #4 MAJOR | 重名手造 IR loud 化 | §3.1（1）bodies 构造期 seen 名集合 → throw Internal；§9 I6 处置列补「重名 → Internal」——I1~I6 现全部 loud，无静默 ok:true 垃圾派生物路径，与 §2.2 自我声明一致 | ✅ 消除 |
| #5 MINOR | catch 镜像 instanceof 守卫 + 复用 makeIssue | index.ts:46 逐字确认 `err instanceof Error ? err.message : String(err)`；§2.2/§3.2 伪代码同款；makeIssue（errors.ts:36-38）产出 `VFSL-E100: 内部错误（意外异常）: <detail>` 与 parseVfsl 内联构造的字符串同形——前缀同源成立；§12 DENY LIST 澄清 errors.ts 仅 import 不改 | ✅ 消除 |
| #6 NOTE | byValue 键消费纪律 | §5.2「byValue 键的消费纪律」段成文：键恒 `String(字面量)`、序号跳转是唯一用途、不得从键反推值类型、值树 enum values 保真——作为 validateSnapshot 票的输入契约 | ✅ 消除 |
| #7 NOTE | 不可变约定声明 | §2.1 DerivedSchema JSDoc（不可变契约 + index 行与树共享引用的交叉污染警示）+ §8.3「不可变契约与 Object.freeze 评估」（v1 文档纪律；深冻结 O(派生物) 常数代价与 TS deep-readonly 破坏 §2.3 可赋值性的评估结论已记录；后续出真实事故再冻结） | ✅ 消除 |
| #8（SA1 R2 自寻，R1 未列） | F4：字段位 ref 按链终点分流（无子终态内联 / 结构形按名） | 本评审独立验证其「三锚联立强制解」推理成立：test.ts:221 `i >= segments.length` 先于 ref 穿透分支——「字段位 ref 一律终态」→ test.ts:581 `resolvePath('ROOT.attachments')` 必红（返回 ref 节点 ≠ 'plain'）；「一律解析」→ test.ts:550（`ROOT.audit` 必须 ref Audit）与 test.ts:478-481（菱形 l/r 必须 ref A1）必红；唯一一致解 = 按链终点形状分流。判别实现按 IR kind 完备列出（primitive/literal/pattern/YLeaf→leaf；YPlainArray→plain；YXmlFragment→xml-fragment；object/record/array/union/YMap/YArray→ref 终态），与 ir.ts `VfslType` 形状对齐、无遗漏无重叠；O(1) 复制论证（§8.2 第 4 条）成立；「漏此项则恰 1 条永红」的定量声明与本评审逐条模拟一致（plain 形态另有 `aliases['Attachments']` 兜底，八形态检查不红） | ✅ 必要且正确 |

## 全新视角补扫（R2 新增内容）

按 fixture 与菱形文本对 R2 设计做了全链路模拟（structure / values / index / resolvePath / 序列化计数，37 条断言逐一过）：**无一条因设计落红**。补扫发现 3 项 NOTE 级观察，均无测试冲突、无 O(文本规模) 违反、无实现分歧风险，**不构成阻断**：

1. **NOTE — 锚点行号漂移**：F4 论证引用 test.ts:553-555（audit ref 断言实际在 548-551）、497-501（菱形 l/r 断言实际在 478-489；497 是 `refs < 200` 计数断言）。锚点本身存在且语义无歧义（581/559/576/402/405-421/442/449 等其余引用实测准确），SA3 以断言内容定位即可，无须为此改文档。
2. **NOTE — §4.1 union 行括注措辞精度**：「纯值形成员使联合全标量……内联分支实际不可达」仅对 scalar 桶成员成立；YXmlFragment 为 container 桶但结构上无子——合法联合 `X | { a: string }`（X 为 YXmlFragment 别名）中，ref 成员按 ref 行判别实现会内联为 xml-fragment。这与 F4 全局规则一致、走同一 structureOf 代码路径，无实现分歧风险，仅括注可再精确。
3. **NOTE — Record 值位为 map/array 时的索引续行政策未明说**：§7.2 停止表按节点类型裁决，Record 值位解析为 map（如 `Record<string, {x: string}>`）时 `ROOT.m.<key>.x` 类续行是否产生，设计未显式钉死（fixture 不受影响——union 值位即停，§7.3 的 8 行对账不变）。O(文本规模) 不受影响（每出现位线性）。建议 SA6 以增量红线钉死其一（见下），非阻断。

## R2 协议假设依据审查

**结论：合规（pass）。** §13 在场，「无协议级假设」声明与代码事实相符（纯函数库 + 类型定义，无 IO）。R2 新增引用依据抽查全部可定位可复核：shapes.ts:660-667/44-67/691、index.ts:46、errors.ts:29/36-38、parser.ts:24（`MAX_TYPE_NESTING = 100` 实测确认）、ir.ts `VfslType` 形状（record 的 key/value、marker 的 marker/arg 等字段名与伪代码引用一致）、v1-spec.md:133/135/143-144/255、package.json 0.1.4（bump 0.1.5 的前提成立）。未发现「应该/通常/预计」类无据推断承担设计承重。

## R2 错误处理链路审查

- **静默失败**：R1 唯一静默路径（#4 重名后者覆盖 → ok:true 垃圾）已 loud 化；补扫未发现新增静默路径。
- **状态闭环**：Internal 不变量 / TypeError 解构失败 / RangeError 一经顶层 catch → E100 `ok:false`，无绕过 ✓。
- **降级路径**：无外部依赖，N/A ✓。
- **虚假降级识别**：E100 为 loud 崩溃边界（命中 = 实现缺陷，可观测可测试）；「不为不可能输入写防御分支」由 §9 不变量表兜底且 I1~I6 处置已全 loud（I6 缺口补全）——无伪降级 ✓。
- **用户可感知性**：issues 结构化，E100 前缀经 makeIssue 与 parseVfsl 同源构造 ✓。

## R2 增量红线测试思路（可选，SA6 owned，非阻断）

1. **F4 内联正交拼写**（存量 581/550/478-481 已覆盖主路径）：`type Title = YLeaf<string>; type ROOT = { t: Title };` → 断言 `resolveStructureField(derived.structure, 't')` toEqual `{kind:'leaf'}`——钉死「ref 内联与直接拼写同形」（一致性语义依据的直锚）。
2. **观察项 3 的索引续行钉死**（若 SA6 想冻结政策）：`type ROOT = { m: Record<string, { x: string }> };` → 已有 R1 构思 #1 断言 `index['ROOT.m.<key>'].node.kind === 'map'`；可选再断言 `ROOT.m.<key>.x` 行的在/缺场（两政策都不违既有测试，钉死哪个由 SA6 决定后写入测试契约）。
3. **观察项 2 的行为锚**（可选）：`type X = YXmlFragment<{ p: string }>; type ROOT = { m: X | { a: string } };` → 断言 m 为 union 且 members[0] toEqual `{kind:'xml-fragment'}`（内联）、members[1] 为 map——把 F4 在 union 成员位的落点也钉进测试。

## 裁定

R1 的 7 项攻击点全部**真正消除**（逐条核对显示为规则文本、伪代码、对账与论证链的实质改写，非注释式承认）；SA1 自寻的 #8（F4 分流）是 R2 修订正确性的必要组成，推理经独立验证成立。全新视角补扫未发现新的 CRITICAL/MAJOR 漏洞。**Verdict: pass——同意放行，进入 SA3 实现阶段。**

边界提醒：pass 仅表示设计通过审查。F4 分流 / 解析点③ / 判别选定规则等冻结判据的落地正确性、37 条红灯转绿、`pnpm typecheck` 由两条预期红转绿且无新增错误、版本 bump——均属实现与活链路验证，由后续 SA4（静态门禁）与 SA7 验证，本裁定不能替代。
