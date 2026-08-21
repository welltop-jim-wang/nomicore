# SA2 攻击评审报告

**Date**: 2026-08-21（R1）· 2026-08-21（R2 复审，见文末「R2 复审」段）
**Reviewer**: SA2（Wallfacer，全新视角独立审查）
**Target**: `wiki/raw/task_vfsl-validate-patch_design.md`（R1 391 行 → R2 435 行）
**Verdict**: **R1: reject → R2: pass**（R2 复审：F1–F7 全部真实消除、R2 不变性核验成立、未引入新缺陷——终裁 **pass**，放行 SA3。R1 reject 理由存档于下）

> **R1 裁决存档**：reject——3 项需修订设计缺陷 F1–F3 + 3 项低severity补漏 F4–F6 + 事实勘误 F7。修订均为定点文本修订，不推翻架构。36 用例转绿推演经逐条机械复核无误，架构选择——两段正交 / 一算法三透镜 / interpret() 抽取——成立。

## 评审方法与证据基线

- 实读：`validate.ts`（635 行全文）、`resolve.ts`（238 行全文）、`evaluate.ts`（401 行全文）、`derived.ts`、`index.ts`、SA6 测试（524 行全文）、任务简报、相关决议（含 SA8 冻结决策点）。
- 运行证据：
  - `npx vitest run packages/vfsl/test/validate-patch.test.ts` → **36 failed (36)**，红灯真实（全量根因 = 四函数未导出），与简报记录一致；
  - 基线全绿：validate-snapshot 35 + validate-snapshot-sa7 **14** + fullchain-e2e 16 = 65 passed（零行为变化门禁的「绿基座」成立）；
  - 派生物探针（tsx 只读脚本，`evaluate(parseVfsl(...))` 实测）：合法 schema `type P = { displayName: string }; type ROOT = { profile: P };` 的 `values['ROOT'].fields[profile].value = {kind:'ref',name:'P'}` 且结构树同位同为 ref（F1/F2 证据）；map|array 混合联合、`U2 = U1 | {c…}` 嵌套 union-of-ref 链均为 ok:true 可达（F3/F4 证据）。

## 36 用例转绿推演复核（设计自证的可信度）

对 §6 全表逐条做了独立推演（不采信设计结论，从 validate.ts 解释器行为正向计算）：AC1×6 / AC2×9 / AC3×6（含 `联合成员 1/3` 的候选过滤+argmin 路径、AC3#2 双侧全等的消息/路径/顺序同源性）/ AC4×11（D2 闭区间、D3 `path++[index]`、重建后下标）/ AC5 / AC6×2（100+截断=101、`['items',1]` 在列）——**全部与测试断言吻合，未发现推演错误**。§4.3 walkRefChain 伪代码与 validate.ts:122-139 现状逐位比对（memo next-hop 语义、in-flight 时机、报错工厂）——行为等价成立。问题出在测试未覆盖、且设计文本自相矛盾或缺失的缝隙上（下表）。

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议修订 |
|---|--------|--------|---------|---------|
| F1 | **HIGH** | 值树游标 V 的中途 ref 解析未规定（§3.2/§3.4） | V 推进规则只列「object 字段精确名 / `'<key>'` 槽 / array element / optional 解包」，**不含 ref 解析**；而 §3.2 又规定「结构树放行而值树无对应 → InternalError → E100」。实测（探针）：合法 schema `type ROOT = { profile: P }` 的值树在 `['profile']` 处是 `{kind:'ref',name:'P'}`——按字面实现，`validatePatch(derived, base, ['profile','displayName'], v)` 这类**最普通的字段写入**在合法派生物上产出 E100（假内部错误， loud 但错误）。36 用例的三个 fixture（GUARD 内联对象 / FIXTURE 在 union 边界冻结于 ref / UNION 无别名）系统性绕开了该形态，**红灯测试无法拦截** SA3 的字面实现。§3.4 括号「ref 不解析——解释器内部 resolveValues 负责」仅覆盖边界产出位，对中途推进是暗示而非规定。 | §3.2 V 推进规则补一句冻结：「V 每步推进前先经共享值树透镜（walkRefChain 值树透镜，`derived.values` 查表 + refMemo）解析 ref 至非 ref 节点，再按 object/`'<key>'`/array/optional 规则取子；仅边界产出节点保持 ref 不解析（委托解释器）」。SA3 注意事项同步。 |
| F2 | **MEDIUM** | 守卫 base 检查自相矛盾：矩阵行承诺「类型不符拒绝」vs 伪代码对象位只查 presence（§3.2） | 拒绝矩阵行「中间位 base 缺失/**类型不符** → 拒绝」与伪代码「对象位 present(b, seg)（hasOwn 且 ≠undefined）」直接矛盾：对象位中间段**不查类型**（数组位查「b 为 Array」，双标）。后果（推演闭合）：`type ROOT = { assets: Record<string, number> }`，base=`{assets: 42}`，patch `['assets','k']` 1 → 守卫全放行（present ✓、终段不查）→ 规则 2 边界合并 `{...42, k:1}` = `{k:1}`（spread 静默丢弃垃圾基值）→ Record 校验通过 → **ok:true**。这违反 §3.6 自己的承诺「不存在静默 ok:true 路径」，且与零写入管线下游语义撕裂（验证过的重建值 ≠ 实际 path-set 在 42 上的效果）。规则 5 叶位替换（`base.profile=42` 时写 `['profile','displayName']`）同理 ok:true。 | 二选一，必须显式冻结不得两头不写：(a) 补类型判定——非终段对象位要求 `b[seg]` 为 plain object（与数组位「b 为 Array」对齐），规则 1/2 边界的合并基值要求 plain object，否则按「路径穿越缺失容器」行 loud 拒绝（推荐，与矩阵行措辞自洽）；或 (b) 显式采纳「可信文档」豁免——矩阵行删去「类型不符」字样、§3.5 rebuildOp 注明「非对象基值经 spread 静默塌缩为空对象、由后续整体校验兜底」并把「垃圾 base → 可能 ok:true」写成文档化行为。 |
| F3 | **MEDIUM** | 守卫节点集未冻结去重语义 → 无去重实现存在指数爆炸（§3.2） | 「节点集」未规定 Set 语义。实测（探针）：`type U2 = U1 \| {c…}` 使**单个 drill 步**内发生 ref→union→ref→union 多级展开；union 成员可为 ref（文法禁内联联合、ref 合法），故列表式（不去重）实现的候选集按步乘法增长，最坏 O(M^L)（L=路径长）。validatePatch 是公共 API：输入 O(L) 路径 + O(文本) 派生物即可放大出超线性工作量——DoS 面。去重后每步 O(去重候选数)、总计 O(L×N) 有界。 | §3.2 冻结一句：「候选集为按节点对象身份去重的集合（Set 语义）；每步工作 ≤ 去重后候选数 × 单候选分支数，总界 O(路径长 × 结构树规模)」。SA3 注意事项列入。 |
| F4 | LOW | 混合候选集下的守卫拒绝消息不唯一（§3.2 拒绝矩阵） | E309 折叠允许 map+container 混合联合（探针实测 ok:true：`m: A \| B`，A=map、B=array）。此时「S' 为空 → 消息按失败形态查矩阵」不唯一（map 候选报「需要 string 键段」、array 候选报「需要整数下标」）。36 用例零覆盖。另外混合集存活候选的对象/数组 presence 检查归属（按存活候选任一满足即过）也未写明。 | 冻结消息取序（建议：按候选首个失败形态、平局按 leaf>plain>xml-fragment>array>map 的 kind 序）；presence 检查补一句「按存活候选的容器形态判定，任一存活候选被满足即放行」。 |
| F5 | LOW | 三操作「目标在场但非 Array」的拒绝无矩阵行（§3.2/§3.5） | 伪代码有「数组三操作要求在场且为 Array」，拒绝矩阵无对应行（消息/issue path 未冻结）。`validateAppendToArray(derived, {items:42}, ['items'], 1)` 的输出 SA3 自由发挥，SA7 无锚。 | 矩阵补一行（终段、三操作、目标在场但非 Array → 拒绝，path = 完整目标路径，冻结消息措辞）。 |
| F6 | LOW | validatePatch 的 E100 issue path 未冻结（§3.6） | validateSnapshot 的 E100 用 `path: []`；本设计的 E100（规整段 InternalError 与顶层 catch）path 取值未写明。AC1 断言 issue 恰含 message+path 但不涉 E100 场景，SA3 可能取完整尝试路径或 []。 | 一句话冻结（建议 `[]`，与 validateSnapshot 同款）。 |
| F7 | LOW（事实性勘误，不阻断） | §4.2/§7.1 与 §10 的计数漂移 | 实测：validate-snapshot-sa7.test.ts 为 **14** 例（设计写 10）；evaluate.ts 的 `R.resolveChain(` 调用点为 **5** 处（行 57/91/106/143/330，设计 §10 写「7 处」）。零行为变化门禁本身（「全仓既有测试全绿」）不受影响，但契约审计表的数字应以实测为准。 | 勘误即可。 |

另附一条观察（不计severity）：validate.ts 头注「结构树零消费（读取即设计违约，SA4 静态锚点）」在本票后语义收窄为「validate.ts 文件内零消费」——SA4 静态门禁若以全仓 grep「structure 消费」实现会误伤合法的 validate-patch.ts；建议 SA1 在 §8 的 validate.ts 修改说明中注明头注措辞随票更新（属 ALLOW 内文档性修订）。

## 协议假设依据审查

- **章节存在**：§9 存在，声明「无协议级假设」——本设计纯引擎层，判断成立（无 HTTP/WS/端口/进程/第三方库假设）。
- **依据可验证性**：抽验全部关键源码引用——`resolve.ts:67 resolveChain` ✓、`validate.ts:122 resolveValues` ✓（报错文案「引用环: X / 未声明别名 X」无冒号 vs「值树引用环: X / 值树未声明别名: X」有冒号逐字属实 ✓）、`index.ts:57` validateSnapshot 重导出行号 ✓、F4 内联/Record→`'<key>'`/全标量联合折叠 leaf（evaluate.ts:89-93/102-114/117-118）✓、resolveValues 的 Object.hasOwn 守卫（F2）✓。
- **无据推断**：未发现「应该/通常/预计」类断言；「实测验证」类声明（36 红灯、基座绿）经本评审复跑属实。
- 唯一瑕疵即 F7 的两处计数漂移（10→14、7→5），属事实性勘误级别。

## 错误处理链路审查

- **静默失败**：主链路无（守卫拒绝=1 issue、值校验=rebase issues、异常=E100，全部经返回值）。**例外 = F2**：垃圾合并容器经 spread 塌缩可产出无 issue 的 ok:true——这是全设计唯一的静默接受路径，必须按 F2 修订消除或显式豁免文档化。
- **状态闭环**：纯函数无外置状态；一切失败路径均产出 `{ok:false,issues}`，无「无请求发出 + 无反馈」形态 ✓。
- **降级路径**：无降级路径（不依赖外部服务）；顶层 try/catch → E100 是崩溃边界不是降级 ✓。
- **虚假降级识别**：未发现「前提条件缺失被当降级」的伪降级——D8 的「可信文档」是显式声明的契约模型且仅用于豁免存量键 Pattern 复检（性能），守卫对未知路径/终态下钻仍 loud 拒绝，不属于掩盖 bug 的降级。E100 对篡改派生物是 loud 断言不是吞错 ✓。
- F1 的 E100-on-legit-schema 属「把合法输入误判为内部错误」——loud 但错，按 F1 修订。

## 红线测试思路（供 SA7/后续票补测；SA6 36 用例已冻结不追加）

1. **F1 红灯**：fixture `type P = { d: string }; type ROOT = { p: P; po?: P };`——① `validatePatch(derived, {p:{d:'x'}}, ['p','d'], 'y')` 断言 `ok:true`；② 同值与 `validateSnapshot(applyPath(...))` issue 全等（AC5 同款）；③ `['po','d']`（optional ref）同样通过；④ 双层 ref 链 `type A = B; type B = {d:string}` 深层写入。字面错误实现（不解析 ref）在这些用例上产 E100 → 红。
2. **F2 红灯**：按修订选项分叉——(a) 方案下：`type ROOT = { assets: Record<string, number> }`，base `{assets:42}`，`validatePatch(…,['assets','k'],1)` 断言 `ok:false` 且恰 1 issue；probe1 schema base `{profile:42}` 写 `['profile','displayName']` 断言拒绝。(b) 方案下：断言 `ok:true` 并在测试注释引用冻结的豁免条款编号。
3. **F3 红灯**：嵌套 union-of-ref 链 fixture（探针 3 形态，叠 3–4 层）+ 构造 50–100 段、每段命中多成员的路径，断言同步返回且不抛错（vitest 默认超时兜底）——无去重实现将超时红。
4. **F4 红灯**：`type A = {x:string}; type B = string[]; type ROOT = {m: A|B}`——`['m',0]` 数组候选放行、`['m','x']` map 候选放行、`['m',1.5]` 双拒断言恰 1 issue 且 message 匹配冻结的取序规则。
5. **F5 红灯**：`validateAppendToArray(derived, {items:42}, ['items'], 1)` 断言 `ok:false`、path=`['items']`、message 含冻结措辞。
6. **F6 红灯**：手造派生物（删 `values['ROOT']`）→ 断言 `ok:false` 且 `issues[0].path` deep-equal 冻结值。

## 裁决理由小结

架构骨架（两段正交、一算法三透镜、interpret() 单一来源、拷贝式重建、D1–D12 决策表）经攻击后**全部站得住**，36 用例转绿推演经独立复核无一错判。reject 的全部重量落在三处**设计文本自身**的缝隙：F1（合法输入 E100 的规定缺失，且测试盲区）、F2（矩阵行与伪代码自相矛盾 + 唯一的静默 ok:true 路径）、F3（公共 API 的指数 DoS 面未封顶）。三者均为定点修订（合计约十行设计文本 + 对应 SA3 注意事项），修订后无需重审全部章节——SA1 回应 F1–F3（F4–F6 顺手）后本评审可直接复审放行。

---

# R2 复审（2026-08-21 · SA2 对 SA1 R2 修订的逐项核验）

**R2 输入**：`task_vfsl-validate-patch_design.md` R2（435 行，R2 冻结①–④ + 矩阵行 11/12 重写 + D13–D18 + §6 不变性核验 + §8 条目④）。
**R2 Verdict: pass**——F1–F7 全部真实消除；「R2 不变性核验」（36 用例判定不变）经独立复核成立；红线 fixture 家族 R2 预期行为逐条成立；对 R2 新文本做了二次攻击扫描，未发现新缺陷。

## F1–F7 逐项核验

| # | R2 修订位置 | 核验方法与证据 | 结论 |
|---|---|---|---|
| F1 (HIGH) 值树游标 ref 解析 | §3.2 R2 冻结① / §3.4 步骤 1 / D13 | 修订采「恒归一化」而非我建议的「边界保持 ref」——**等价性成立且更强**：归一化后边界节点恒非 ref/optional，解释器入口 `resolveValues` 对其为恒等操作（validate.ts:122-139 while 循环不执行）；归一化解析到的 union 节点与解释器自查 `derived.values` 解析到的是**同一对象**（探针 A：`values['ROOT']` 即 ref 节点，别名表单次物化），故 AC3#2/AC5 全等性不受影响。覆盖三处：中途取子（解 optional（仅字段位）→ 值树透镜解 ref 链）、memo 调用局部（纯函数契约）、**初始化**（`type ROOT = M` 形——探针 A 实证合法且 `values['ROOT']` 为 ref，R1 连这处都没覆盖，R2 补上了）。E100 收口正确性独立验证：值树 union 无结构树 union 对应位的唯一家族 = 全标量联合折叠（探针 B：结构 leaf / 值 union——YPlainArray 在 typeCls 为 scalar 但 valueOf 产 array 节点），该家族结构侧恒为终态 leaf、拒绝下钻 → V 永不需要推进穿越它 → E100 条款只对手造派生物触发。optional(ref) 嵌套实证（探针 C：`{kind:'optional',value:{kind:'ref'}}`）与 D13 归一化次序（先解 optional 后解 ref）逐位对应。 | **真实消除** ✅ |
| F2 (MEDIUM) base 检查两段式 | §3.2 R2 冻结② / 矩阵行 11 / §3.3 R2 补注 / D14 | 采纳我推荐方案 (a)。逐跳推演验证：① `base={assets:42}` 写 `['assets','k']`——步 1 终段父形态检查命中（'k' string 段 → 父须 plain object → 42 是 number）→ 行 11 loud 拒绝 ✓；② `base={profile:42}` 写 `['profile','displayName']` 同理 ✓；③ union 边界合并基值（`['assets','img1','body']` 的 img1=42）在步 2 作为终段父容器被同一检查覆盖 ✓；④ §3.3 补注「边界位值必为被下一段消费过的父容器」经全五条边界规则逐一验证成立（规则 3 数组基值由终段 number 段父形态=Array 保证；规则 4 由行 12 保证；规则 5 relPath 空不合并无此约束——补注措辞准确）；⑤ R1 矛盾闭合：矩阵行 11 重写为「缺失或形态不符」且消息冻结（含期望形态 + jsonTypeOf），伪代码 ①形态②在场 与之行序一致。**静默 ok:true 路径清零**（R1 指出的唯一路径被入口封死）。 | **真实消除** ✅ |
| F3 (MEDIUM) 节点集去重 | §3.2 R2 冻结③ / D15 | Set 身份去重 + drill 内 union 递归展开带每步 visited + 总界 O(路径长 × N) + 列表式实现明文禁止——全部要求的要素齐备。身份共享前提核实：derived.ts JSDoc「index 条目 node 与树内节点为同一对象引用」、`aliases[a.name]` 单次物化——同节点重复解析返回同一对象，去重有效。 | **真实消除** ✅ |
| F4 (LOW) 混合候选消息取序 | §3.2 R2 冻结④ / 矩阵注 / D16 | 取序冻结 leaf > plain > xml-fragment > array > map（采纳建议序）。归属消歧采「同一步接受候选恒同形态」结构性论证——我独立验证该论证**成立且确实强于「任一满足」**：map/Record 只收 string 段、array 只收整数 number 段（D7 + drill 规则），对任一给定 seg 接受者必然全 map 形或全 array 形（探针 D：Record\|string[] 混合联合的结构 union 实证可达）；无接受者时 S' 空、按取序定消息，无歧义。`['m',0]`/`['m','x']`/`['m',1.5]` 行为已冻结进 §6。 | **真实消除** ✅ |
| F5 (LOW) 非 Array 目标行 | 矩阵行 12 / §3.5 / D17 | 行 12 入矩阵：path = 完整目标路径（= path 参数原样，与 D3 一致）、消息冻结含 jsonTypeOf。与 §3.2 伪代码终段三操作分支「缺失或非 Array → 拒绝（行 12）」闭环；§3.3 穿透 union 的 append 闭合段同步改引行 11/12（精确命中行 12：img1 无 tags 时终段三操作在场检查拒绝）✓。 | **真实消除** ✅ |
| F6 (LOW) E100 path 总表 | §3.6 R2 冻结 / D18 | 总表冻结：E100 = `[]`（与 validateSnapshot 同款）、规整拒绝 = 完整尝试路径（path 非法时 `[]`）、守卫拒绝 = 完整尝试路径；规整表各行 path 列逐行补齐。与 AC1 断言（issue 恰含 message+path）无冲突。 | **真实消除** ✅ |
| F7 (LOW) 计数勘误 | §4.2 / §7.1 / §10 | sa7 10→14（65 例绿基座）✓；resolveChain 7→5 处（行 57/91/106/143/330，与我 R1 grep 实测一致）+ typeCls 2 处另注 ✓。 | **真实消除** ✅ |
| 观察项 | §8 ALLOW validate.ts 条目④ | 头注收窄为「validate.ts 文件内零消费」并注明动机（防 SA4 全仓 grep 误伤）✓。 | **落实** ✅ |

## 「R2 不变性核验」的独立复核（36 用例判定不变）

不采信设计自证，对 R2 三处行为性修订与 36 用例的每个交点独立推演：

1. **冻结①归一化**：三 fixture 的 V 推进路径上，归一化均为行为等价操作——GUARD_FIXTURE 全内联无 ref；FIXTURE 的 ref（`AssetEntity` 于 `'<key>'` 槽、`Attachments` 于字段位）要么恰在边界产出位（R1「ref 不解析」与 R2「恒归一化」在该位语义等价——解释器 resolveValues 恒等作用/解析到同一对象，探针 A 证别名表单次物化），要么在守卫拒绝路径上不触达（`['attachments',0]` 步 1 结构拒绝）；UNION_FIXTURE 无别名。AC3#6 stripDiscriminators 深拷贝派生物上归一化照常（克隆别名表自洽）。
2. **冻结②两段式**：结构段判定先于一切 base 检查的次序保留（R2 伪代码明文），故 `['name','deep']`/`['attachments',0]`/`['zzz']` 仍在结构段拒绝、不误触行 11；36 用例全部合法基座（validSnapshot/BASE/badBase）的每一跳父容器形态均正确（对象位全 plain object、数组位全 Array），零新增拒绝；`['items',5]` 仍走行 4（父形态 Array ✓、越界归行 4 不归行 11）。
3. **冻结③去重 / ④⑤⑥冻结**：去重纯性能语义（候选集合不变）；消息取序与 path 冻结不触碰任何断言锚定字段（36 用例对守卫消息只锚 AC3/AC6 的值级 message，对守卫级只锚 path 与 ok）。
4. **walkRefChain / interpret() 抽取**：R2 未改动 R1 已核验的伪代码（§4.2/§4.3 逐字比对 R1）——行为等价结论延续。

**结论：§6 全表判定不变成立。**

## 红线 fixture 家族 R2 行为核验（36 用例外，供 SA7 对账）

§6 R2 段列出的六条预期行为逐条独立推演：`['p','d']`/`['po','d']`（mid-walk ref + optional ref）归一化后放行且与 validateSnapshot 全等 ✓（D10 optional 声明即存在 + D13 归一化）；Record 垃圾基座行 11 ✓；`{profile:42}` 行 11 ✓；混合联合三态 ✓（恒同形态论证）；`{items:42}` append 行 12 path=`['items']` ✓；手造派生物 E100 path=`[]` ✓（D18）。**注**：本 R1 评审红灯思路中的「双层 ref 链（`type A = B`）」fixture 未列入 §6 家族清单——非缺陷（walkRefChain 按构造走链，D13 已覆盖），SA7 补测时可自行纳入。

## R2 新文本二次攻击扫描（防修订引入新缺陷）

- **恒归一化的 E100 收口过宽？** 否——见 F1 行：合法 schema 下 V 推进位的值节点恒为 object/array（值 union 无结构 union 的唯一家族被结构终态封路），E100 只打手造派生物 ✓。
- **两段式的形态检查误伤？** 否——见不变性复核第 2 条；且 number 段 + Array 父、string 段 + object 父的判定与 D7 段类型严格性同构，无双标准残留 ✓。
- **行 11 消息 `<plain object|数组>` 占位**：形态依据=接受候选（恒同形态）→ 期望形态唯一，占位可确定性展开 ✓。
- **行 12「path 参数原样」与 D3「完整尝试路径」的一致性**：三操作的 path 即完整尝试路径，二措辞同指 ✓。
- **D13–D18 与 D1–D12/SA8 冻结项的冲突**：无——R2 只在 ADR/SA8 未冻结处行使（SA8 冻结的 §3.3 五规则、D1–D12、文件范围逐字未动；文件范围仅 validate.ts 行数估计 +55→+60 与新增头注条目④，ALLOW/DENY 集合不变）✓。
- **§4.1 值树透镜行「#31 SA4 F2 原型链守卫」注记**：R2 顺带澄清了 R1 可能混淆的两个「F2」编号（#31 SA4 评审的 F2 ≠ 本评审 F2）——准确 ✓。

## R2 终裁

**pass**。R1 全部攻击点（F1–F7 + 观察项）在 R2 中真实消除，且修订质量高于最低要求（F1 连 R1 未点名的初始化 ref 位一并冻结；F4 用结构性论证替代补丁条款；F2 附合并基值容器性推演）。36 用例转绿约束、SA8 冻结决策、ADR 条款（0002/0003/0004/0005）零违反。设计冻结放行 SA3 实现；SA4/SA7 后续验证按本报告 + 设计 §6 R2 段的红线 fixture 家族对账。本 pass 仅覆盖设计审查——实现与活链路验证仍属 SA4/SA7 职责。
