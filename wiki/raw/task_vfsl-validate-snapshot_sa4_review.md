# SA4 红队静态评审报告 — validateSnapshot 实现（issue #21）

- **评审对象**: SA3 实现 commit `95fade0`（`src/validate.ts` / `src/pattern.ts` / `src/xml.ts` / `src/index.ts` 导出 / 测试修正）
- **设计依据**: `wiki/raw/task_vfsl-validate-snapshot_design.md`（R5，commit `5442cce`）
- **评审链**: SA2 五轮（`_sa2_review.md` … `_sa2_review_r5.md`，终审 pass）
- **评审人**: SA4（红队，静态攻击 + 只读动态探针）
- **日期**: 2026-08-20
- **方法**: 静态走查全量新增源码（validate.ts 630 行 / pattern.ts 921 行 / xml.ts 114 行）+ 设计附录 10 条防走样指令逐条锚定 + 3 批次 vitest 只读探针（26 个断言块，用后即删，git status 已复原）+ 独立复跑全量验收

---

## Verdict: **reject（轻度）—— 仅阻断 F1（连带 F2 同类一行修），其余全部通过**

阻断项唯一且小：判别式快路径的 `byValue[String(raw)]` 原型链污染（F1，MEDIUM）在**合法管线输入**上产出假 E100。修复 1–2 行（`validate.ts:401` 一处，连带 `validate.ts:133` 同类面），不触架构、不触冻结数值、不触测试。修完无新发现即可放行——F3–F9 全部不阻断。

### 独立复跑验收（与总控声明一致）

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | 0 错误 |
| `pnpm test` | **287/287 全绿**（11 个测试文件，含 validate-snapshot 34 条） |

---

## 一、Scope Creep Guard：✅ 通过

commit `95fade0` 触碰 7 个文件，全部落在设计 §13 ALLOW LIST 与 `wiki/raw/task_*` 白名单内：

- 生产代码仅 4 文件：`validate.ts` / `pattern.ts` / `xml.ts`（全新）+ `index.ts`（导出 + 头注释）
- DENY LIST（parser/tokenizer/semantic/shapes/evaluate/derived/resolve/ir/errors、tsconfig、根 package.json）**零触碰**——`evaluate.ts`/`derived.ts` 仅作为静态消费方被读，未被修改
- 测试改动**恰为 §11.1 授权的两处**：YPlainArray 测试文案修正 + 新增双数组锁定负例；既有断言零改动（commit diff 逐行核对）
- `package.json` 版本 0.1.5 → 0.1.6（minor 递增，合规）
- 黑名单模式（TODO/FIXME/hack 绕过语、读 derived.structure/index/aliases、原生 RegExp）grep 全清

## 二、设计附录 10 条防走样指令逐条静态核验：✅ 全部真实兑现（非纸面）

| # | 指令 | 兑现证据 |
|---|---|---|
| 1 | 禁读 `derived.structure/index/aliases` | validate.ts 全文仅消费 `derived.values`（根定位 `validate.ts:597` 一处入口），structure/index/aliases 零引用（grep 证实） |
| 2 | preview 禁全量 stringify、40 字符提前终止 | 有界增量序列化 + 满 40 追加 `…`；探针 P9 实测 100 字符输入截断为 40+`…`；grep 无 `JSON.stringify` 出现在 preview 路径 |
| 3 | 消息格式逐字 | 抽样 6 条与 §4 全景表逐字符比对一致（含 `缺少必填字段 "s"`、`类型不匹配：期望 string，实际 number`、`不匹配任何联合成员（any-of 全拒绝）：…联合成员 i/N（距离 d）`——探针 P6/P1-tie 实测输出在案） |
| 4 | 计数 sink 从不构造消息 + emit thunk 门控 | `emitIssue(path, makeMessage)` 惰性调用（`validate.ts:94-101`），仅物化态（issues.length < 100）执行 thunk；countIssues 计数 sink（`validate.ts:286-306`）零消息产出 |
| 5 | WORK_LIMIT = 2×10⁸ | `validate.ts` 常量逐字核对；探针 P8r：70,000 distinct (节点,值) 对 133ms 正确完成（memo 封顶重建路径真实走通） |
| 6 | 预算公式逐字 | `pattern.ts:761-764` `min(4_000_000, max(8_192, 1_024×len + 512×len² + 16_384))`；探针 P4 实测 len=5000 → 消息携带「预算 4000000」 |
| 7 | lookMemo 稀疏物化、禁稠密预分配 | `pattern.ts:93` `Map<Instr, Map<number, boolean>>`；全文无 `new Array(len`/`Uint8Array` 定长分配（grep 证实；注释提及处均非分配） |
| 8 | 联合三段算法 + 平局声明序 | `validate.ts:392-431` 结构逐段对应 §5.2；`argmin` 严格 `<` 扫描（`validate.ts:434`）；段 0 仅加速静默接受（命中即零 issue return，否则完整流程） |
| 9 | 记忆化封顶清空重建 | `validate.ts:372-384`（详见发现 F8 的量纲注记——更保守，良性） |
| 10 | 菱形联合挂死防护（SA2 #1） | (解析后节点, 值) 双 memo + 全局预算双保险；探针 P5：U_20 菱形链 1ms；P8r 70k 对 133ms |

**SA2 历轮红灯思路兑现复核**（任务书点名五项）：

1. **菱形联合挂死** → ✅ 真实兑现（P5 实测毫秒级；countMemo 键 = resolveValues 后节点，共享子图命中）
2. **转义子集** → ✅ §6.2 转义全集逐项落地（IdentityEscape Annex B 立场、`\x`/`\u` 非完整形降级、`\p{`/`\k<` loud、类内数字 loud——探针 P3 实测 `\01` 类外按 NUL+`1` 读，与设计行文一致）；边界角见 F3/F4/F5（不阻断）
3. **空循环守卫** → ✅ 闭包 pc 去重（`pattern.ts:776-844`）；探针 P4：`(a?)*b`/`(a*)*b` × `'b'` 均 true，空迭代不挂死
4. **(pc,pos) 记忆化** → ✅ lookMemo 稀疏 Map 真实存在且被消费；探针 P4：`(?=.*;)z` × 202 字符 14ms（SA2 R2-1 构造在实现面不复发）、× 5000 不匹配 94ms loud 预算耗尽
5. **契约包络** → ✅ WORK_LIMIT 2×10⁸ + 全计费行（键/元素访问、纯遍历、emit/overflow、preview 48/次仅物化态）落地；计费遗漏面攻击见 F7/F9（均设计同盲区，INFO 级）

## 三、R5-1 澄清建议（⟺ 读法）落实：✅ 已落实

SA2 终审 R5-1（LOW，非阻断）建议改为单向蕴含或标注 64/256 码元角点。设计文档已落实：⟺ 处标注 256 码元角点（m ≤ 136）、×135 → ×136、合计 188,691,600 ≤ 2×10⁸——算术逐项复核无误。属设计侧（SA1）修订，SA3 无实现动作项，确认无欠账。

## 四、测试面攻击（34 条 validate-snapshot 测试伪绿检查）：✅ 全部真绿

- `.skip` / `.only` / `.todo` / `it.fail`：**零存在**（grep 证实）
- 断言强度：全部为运行时行为断言（`expect(r.ok)`、issue 计数、message 逐字、path 深比较）；无 `readFileSync` 源码 grep 式断言、无恒真断言
- 关键锚点在案：union「恰 4 条」精确计数（测试 289–297 行：u 缺失不报告——与 §11 对账句一致）
- 授权修正未越界：commit diff 仅两处——YPlainArray 文案（§11.1 授权原文）+ 新增双数组锁定负例；其余 34 条断言与 SA6 冻结版逐字一致
- 独立复跑 287/287（见上表）

**测试覆盖缺口**（SA6 冻结面所有，非 SA3 责任，转 SA7 动态清单）：无 WorkBudgetExceeded 触发样例、无 E100 路径样例、四类 pattern loud 消息仅间接覆盖两类。

## 五、静态 + 探针攻击发现清单

### F1 【MEDIUM｜阻断】判别式快路径 `byValue[String(raw)]` 原型链污染 → 合法输入上假 E100

- **位置**: `validate.ts:398-407`（消费侧 `:401`）；成因配合 `evaluate.ts:229` `byValue = {}`（普通对象，含 Object.prototype 原型）
- **机理**: `kind` 值字符串化后命中 Object.prototype 继承属性名 → `byValue['constructor']` 返回**函数**（≠ undefined）→ `members[函数]` = undefined → `countIssues(undefined, …)` 读 `undefined.kind` 抛 TypeError → 顶层 catch 收编 E100
- **子面 b（同行同因）**: `kind` 为带抛异常 `toString` 的对象 → `String(raw)` 直接抛 TypeError → E100
- **可达性**: **合法管线完全可达**——任务 fixture（kind: image/text/file 联合）快照中任一资产 `kind: "constructor"` 即触发；判别式仅要求全部成员为内联对象字面量 + 字面量判别字段（evaluate 端 detectDiscriminator 条件），不限于 fixture
- **复现**（探针 P1/P1r/P11，三批次全中）:

  ```
  kind="constructor" → VFSL-E100: 内部错误（意外异常）: Cannot read properties of undefined (reading 'kind')
  kind="toString"/"valueOf"/"__proto__"/"hasOwnProperty" → 同上 E100
  两成员平局联合（kind:"a"|"b"）× kind="constructor" → 同上 E100
  kind={toString(){throw}} → VFSL-E100: …: boom
  对照：kind=Symbol() / {} / null / 0 / true → 正常 no-match（ok:false 无 E100）✓
  ```

- **影响**: ① 单个字段值将**整次校验**塌缩为 E100（顶层 catch 丢弃已收集的全部 issue——违反全收集语义）；② E100 语义污染——设计 §10 冻结「E100 仅限内部缺陷」，此处为**合法输入的常规 no-match 路径**；③ 错误方向 fail-closed（不产生错接受、不崩溃逃逸——严重度因此非 HIGH）
- **路由**: **SA3**，1–2 行修复：消费侧守卫 `Object.hasOwn(byValue, String(raw))`（或 `typeof hit === 'number'` 双断言）；子面 b 建议将快路径收敛为 `typeof raw === 'string' | 'number' | 'boolean'` 才进入（判别键本就只来自这三类字面量，`String()` 在其上永不抛）

### F2 【LOW｜建议随 F1 同修】`ctx.values[node.name]` 同类原型链污染 → 手造派生物静默 ok:true

- **位置**: `validate.ts:133`（`resolveValues`）
- **机理**: ref 名 ∈ Object.prototype 继承属性名时 `ctx.values['constructor']` 返回函数对象（≠ undefined），绕过 `:134` 的未知名 loud 防线；函数无 `kind` 字段，下游按未知节点静默接受
- **复现**（探针 P2）: 手造 `values['ROOT'] = {kind:'ref', name:'constructor'}` → `{"ok":true}`；对照：环引用 → 专用 loud `VFSL-E100: …值树引用环: A` ✓、真未知名（如 `zzz`）→ `值树未声明别名` loud ✓
- **影响**: 仅手造/篡改 DerivedSchema 可达（合法管线中 evaluate 保证 ref 名已声明；`type constructor = string` 显式声明时为 own 属性、工作正常）——但设计 §10:81 明言「手造/篡改派生物导致的……未知名」应 E100 收编，此处违反该承诺且方向是**静默错接受**（fail-open）
- **路由**: **SA3**，随 F1 一行同修（`Object.hasOwn(ctx.values, node.name)` 守卫）

### F3 【LOW｜不阻断】`[]]` 按 POSIX 式读首位 `]` 为字面量；`[]` 空类 loud 拒——与 ECMAScript 基线分歧，设计未冻结该角

- **位置**: `pattern.ts:445-449`（`if (!negated && this.peek() === ']')` 首位 `]` 作字面量成员）；`[]` 走「字符类未闭合」编译错
- **复现**（探针 P3）: `/[]]/`×`']'`：native=false（ECMAScript：空类+字面 `]`），impl=**match**；`/[]/`：native=合法永不匹配（Annex B），impl=**编译错 loud**
- **影响**: 接受语言分歧（`[]]` 在两侧接受不同字符串集）；`[]` 实用价值趋零。设计 §6.2 引用「与 ECMAScript 无标志行为一致」立场多处，但未显式冻结此角
- **路由**: **SA1** 设计注记冻结立场（对齐 ECMAScript 或显式声明 POSIX 式偏离，二选一）；SA3 随注记对齐。非阻断：fixture/红灯零涉及

### F4 【LOW｜不阻断】`{2,1}` min>max 量词被接受（ECMAScript SyntaxError）

- **位置**: `pattern.ts:261-285`（`tryParseBraceQuantifier` 无 min≤max 校验）
- **复现**（探针 P3）: `/a{2,1}/`×`'aa'`：native=SyntaxError，impl=**match**
- **影响**: JS 中抛编译错的模式在此被接受且语义未冻结（实测表现为按 min 展开）；宽容方向分歧，无资源风险
- **路由**: **SA1** 量词行补一句冻结（建议对齐 ECMAScript loud 拒）；SA3 随注记补一行校验

### F5 【INFO｜在案分歧，不行动】`\01` 类外 = NUL + 字面量 `1`（原生为 legacy 八进制 \x01）

- **复现**（探针 P3）: `/\01/`×`'\x01'`：native=true，impl=no-match；×`'\x001'`：native=false，impl=match
- **判读**: 与设计 §6.2 读法**一致**（`\0` 列入控制转义；类内数字 loud「legacy 八进制不进子集」；类外反向引用 `\1`~`\9` 收窄——`\0`+数字 角未显式冻结但可由行文推出实现读法）。属「有意收窄出基线」家族，与 `\p{`/`\k<` 同类，建议 SA1 在 §6.2 补一词注记即可

### F6 【INFO｜不阻断】required-unknown 字段跳过 vs §4.1 伪码字面——设计内部不一致，SA3 选择了与冻结语义一致的一侧

- **位置**: `validate.ts:560-564`
- **判读**: §4.1 伪码字面要求对未知键在必填字段上做在场断言，实现跳过；但 §4 标量行「unknown（含 undefined）」、§11 对账句「恰 4 条」（u 缺失不报告）与 SA6 锁定测试一致支持实现侧行为。设计两处自相矛盾，实现与**冻结的测试契约**对齐——正确取舍
- **路由**: **SA1** 下轮修文档（§4.1 伪码补一句），无需 SA3 动作

### F7 【INFO｜设计同盲区】refMemo 记 next-step 而非 resolved-final——每条目 O(链长) 未计费 Map 查询

- **位置**: `validate.ts:126-135`（`ctx.refMemo.set(node, next)` 存**下一跳**，非最终解析节点；设计 §3.1 说 memo「ref → resolved」）
- **影响**: 深别名链下每跳一次 Map 查询，均未计入 charge——wall-clock 放大向量（非工作量放大，Map 查询 O(1)）；构造极限：链长 L 的菱形网格可造 ~10⁶ 次未计费 Map 查询，毫秒级。**设计自身同盲区**（§3.4 计费表无此行）
- **路由**: **SA1** 计费表注记（下轮）；**SA7** 动态清单抽查

### F8 【INFO｜良性】memoEntries 共享计数器合计封顶 65,536——比设计「各 65,536」更保守，但源码头注释与代码不符

- **位置**: `validate.ts:372-384`（单计数器，countMemo+contraMemo **之和** ≤ 65,536）；对照 `validate.ts:15` 头注释「**各** 65,536 条封顶」与设计 §3.4 同款表述
- **影响**: 封顶更早触发 → 重建更频 → 行为更保守，正确性无虞（P8r 实测 70k 对仍正确）；仅注释/文档与代码量纲不符
- **路由**: **SA3** 顺手改头注释一词（「合计」），或 SA1 修设计侧措辞——二选一即可

### F9 【INFO｜设计同盲区】`setHas` O(ranges) 每计费步线性扫描未计费

- **位置**: `pattern.ts:126`（CharSet 区间线性探测）、消费点 `:857`
- **影响**: 单计费步内部成本 = 区间数（字符类转义叠加可造几十区间）；预算按步计数对此失明。实测无感知（P4 全部毫秒级），与 F7 同属「计费单位粒度之下」的 wall-clock 面，设计 §3.4 同盲区
- **路由**: **SA7** 动态清单（大区间字符类 × 长输入抽查耗时曲线即可）

### 探针证实的正面行为（攻击不破，记录在案）

| 攻击面 | 结果 |
|---|---|
| P4 ReDoS `(a+)+$` × 500 字符 | no-match，**1ms**（朴素回溯需 ~2³¹ 步——八个数量级差） |
| P4 前瞻二次 `(?=.*;)z` × 202 字符（SA2 R2-1 构造） | match，**14ms**（R2 必红构造在实现面不复发） |
| P4 前瞻预算耗尽 × 5000 字符 | loud `Pattern 匹配步数预算耗尽（输入长度 5000，预算 4000000）：无法在预算内判定匹配性`——格式逐字含真实预算值，**94ms** |
| P5 菱形 U_20 | string/number 双向命中 1ms，boolean 正确拒绝 |
| P6 `__proto__` 作 Record 键（JSON.parse own 属性） | 正确下钻报告 path `['m','__proto__','v']`，无 E100 无逃逸 |
| P6 integer-like 键序 | `{"2","1","b"}` → issues 按 `['1'],['2'],['b']`——整数键升序在前、字符串键插入序在后，确定性与 §9 一致 |
| P6 NaN / 5000 字符长键 | `期望 string，实际 number` 正确；长键入 path 无崩溃 |
| P6/P7 undefined 在场语义 | 可选字段 `s: undefined` 按缺席处理（ok:true）；必填缺失报 `缺少必填字段 "s"` |
| P7 截断标记 | 150 错 → **恰 101 条**（100 实 + 1 标记），标记消息逐字：`校验问题超出 100 条上限，输出已截断（truncated）：另有 50 处问题未报告` |
| P7 深嵌套 100k 层数组快照 | `{"ok":true}` **2ms**——遍历深度受 **schema 深度**（MAX_TYPE_NESTING=100）钳制而非快照深度，未命中的深层结构在叶子类型处一次判型终止。RangeError 面实际不可达（我探针预期错误，非实现缺陷；SA7 可再攻 schema 深度×每层多帧构造） |
| P8r memo 封顶 | 70,000 distinct 对 → 正确 no-match、101 条截断、133ms |
| P10 纯度 | 校验后快照逐字节不变（含 `a.b\|c[d]` 特殊键） |

## 六、动态审核重点（SA7）

1. **F1/F2 修复回归**（若 SA3 已修）：14 个 Object.prototype 继承属性名 + 抛异常 toString + Symbol/对象/null kind 全部 no-match 无 E100；手造 ref 名 constructor → loud E100
2. **WorkBudgetExceeded 首次动态触发**：静态与探针均未走通该路径（P8r 133ms 远未触顶）——构造 >1.1×10⁸ 键封闭对象（设计 §3.4 R3 行的刀锋口径）或大乘积联合，验证 loud 消息格式与「不伪装成功」
3. **四类 pattern loud 消息补样**：编译错/子集外/程序超限/预算耗尽——现有测试+探针只覆盖编译错与预算耗尽两类，补「子集外构造」（如 `\1` 反向引用）与「程序规模超限」触发样例
4. **RangeError 收编面可达性**：P7 表明快照深嵌套不可达（schema 深度钳制）；尝试 schema 深度逼近 100 × 每层多栈帧（联合嵌套 + countIssues 递归叠加）验证 §10 R3 兜底是否实际存在触发面
5. **ReDoS 耗时曲线**：`(a+)+$`/`(?=.*;)z` 从 500 → 10⁵ 字符抽样实测，验证线性/二次形状与 4M 钳制的毫秒级声明
6. **lookMemo 内存抽样**：200 条空前瞻 × 10⁷ 码元（附录 10 存储禁令的对抗构造）实测 RSS——静态已核无稠密分配，动态补内存证据
7. **F7/F9 wall-clock 面**：深别名链（10³ 跳）× 大量引用点 / 大区间字符类（30+ 区间）× 长输入，抽样耗时确认无感知级放大

## 七、结论

实现**忠实兑现**了 R5 设计的全部冻结承诺：附录 10 条防走样指令无一条纸面应付，SA2 五轮红灯思路（菱形挂死/转义子集/空循环守卫/(pc,pos) 记忆化/契约包络）全部在代码中找到真实机构而非注释；接缝、消息格式、截断契约、资源纪律逐项与设计/SA6 冻结一致；34 条测试真绿，287/287 独立复跑通过。

唯二缺陷集中在同一根因——**普通对象作字典查表未做 own-property 守卫**（`validate.ts:401` 与 `:133` 两处，`{}` 字面量原型链），其中 F1 在合法管线输入上以假 E100 塌缩整次校验，构成阻断；F2 为同修顺手项。合计修复 ≤ 4 行、零测试改动、零冻结面触碰。**修完 F1（含 F2）即可放行。**

---

## R3 终轮结论（doc-only 落档）

- **日期**: 2026-08-20
- **落档性质**: 本轮为 doc-only 格式落档（多轮同文件惯例：r1 正文 + r2 分文件 + 终轮结论回写主文件），未重跑静态审查、未新增攻击探针、未触碰任何生产代码。R1 的 reject（轻度）历史与全部证据**原样保留在上文**，未做任何改写。

**Verdict**: pass

终轮依据（两源闭环，均为可复核一手报告）：

1. **R2 修复复审 pass** —— `wiki/raw/task_vfsl-validate-snapshot_sa4_review_r2.md`（2026-08-20 03:18）对 SA3 修复 commit `236f271` 确认 F1（判别式快路径原型链污染 → 合法输入假 E100）与 F2（ref 解析同类面）修复真实、完整、零越界：diff 恰为两处 own-property 守卫（+4/−3，仅 `packages/vfsl/src/validate.ts`），r1 §六.1 回归清单 16/16 探针全绿，守卫角点攻击未击穿，typecheck 0 错误 + 287/287 全量绿。兑现 r1 预告「修完 F1（含 F2）即可放行」。
2. **SA7 R2 动态验证 pass** —— `wiki/raw/task_vfsl-validate-snapshot_sa7_report.md`（2026-08-20 08:56，verdict pass）确认 SA4 移交清单 **8 项全部闭环**（1 项销项复核 + 6 项新取证 + 1 项现状钉住转路由），遗留草稿 14/14 断言经一手复跑采纳固化，无新阻断发现（2 条 INFO 均已在 r2 立案转路由）。

综上，SA4 终轮 verdict 为 **pass**：R1 阻断项 F1/F2 已由 `236f271` 修复并经静态复审 + 动态验证双确认，无未闭环风险残留。

### 1.4 vitest 触发性自检（终轮补档）

按 SKILL §1.4 门禁对本任务 CI 触发性做静态核验（只读 worktree 配置文件，未运行测试）：

- **workflow 证据**: `.github/workflows/ci.yml` 的 `test` job（`pull_request` 任意 PR 触发，matrix node 20/24）末步 `run: pnpm test`（`ci.yml:38-39`）——无 `--filter` / `--project` / `working-directory` 收窄，在**仓库根**执行。
- **根脚本**: 根 `package.json` `"test": "vitest run"`（`package.json:11`）——根级单 vitest 进程，非 per-package 过滤递归。
- **测试发现面**: 根 `vitest.config.ts` `include: ['packages/*/test/**/*.test.ts']`（`vitest.config.ts:5`）——glob 覆盖全部 workspace 包测试目录，无 exclude 排除任何包；全仓 12 个测试文件均落在 `packages/vfsl/test/`。
- **改动面比对**: 本任务实现 commit（`95fade0`）+ 修复 commit（`236f271`）+ SA7 固化 commit 的改动全部落在唯一 workspace 包 **`packages/vfsl`**（src 4 文件 + test），其测试（含 `validate-snapshot.test.ts`、`validate-snapshot-sa7.test.ts`）均在根 vitest include 范围内。

结论行：`all-vitest-packages-triggered` —— 唯一改动包 `@nomicore/vfsl` 的全部 vitest 测试均被 CI `test` job 的仓库根 `pnpm test` 覆盖，不存在「测试存在但从未被触发」的 CI 黑洞。

边界声明：PR 尚未建立属**环境态**（本 worktree 无远端 PR，静态自检止于 workflow 配置证据）；CI 实跑核验（run 日志中的 vitest 触发证据）按 SKILL 与 SA7 的联动惯例，移交总控在 PR 建立后执行——SA7 R2 报告已同款钉住该环境态（「无 PR 无 run，禁 push」）。
