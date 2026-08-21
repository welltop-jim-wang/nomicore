# SA2 攻击评审报告 — DocScope 作用域绑定与编译缓存（H3 / issue #54）

- **Date**: 2026-08-21（R1 轮）｜ 2026-08-21（R2 复审轮，见文末追加章节）
- **Reviewer**: SA2（Wallfacer / 设计攻击评审）
- **被审对象**: `wiki/raw/task_docscope-compile-cache_design.md`（R1 → R2，698 行）
- **约束基准**: `task_docscope-compile-cache_relevant_decisions.md`（ADR-0001/0002/0003/0004/0005 摘录）；任务简报含 SA6 测试设计与修正记录 R1
- **参考**: SA8 设计冲突报告（Verdict: clear，边缘项 #7–#12）
- **最终 Verdict（R2 复审）**: **pass**（R1 reject 的 A1/A2/A3/A4/N1/N2 已逐条闭合并经独立复核，见文末「R2 复审」章；pass 仅指设计通过审查，不替代 SA4/SA7 对实现与活链路的验证）
- **R1 Verdict（历史记录）**: **reject**（A1 必须修订设计；A2/A3/A4 随 R2 一并修订；N1/N2 建议采纳。修订面收敛、局部，D1–D10 的决策骨架无需推翻）

## 评审方法与证据基础

以全新视角独立重放了设计的全部关键现状声称与算法声称，未采信任何未经验证的断言：

| 验证项 | 方法 | 结果 |
|---|---|---|
| §5.3 SHA-256 参考实现正确性 | 逐行转写设计伪代码，与 `node:crypto` 对拍 6 条 KAT + **17 条自选边界向量**（55/56/63/64/119/120 字节块边界、1000 字节多块、1/2/3/4 字节 UTF-8、lone surrogate、`U+07FF`/`U+0080`） | **全部一致（ALL OK）**——SA1 §9 #3 的「已实证」声称属实且可复现 |
| §7 AC2 声称的 fixture 哈希（e9fbe2b3/fd099a71/1f2e536e） | node:crypto 复算三变体 | 属实，且三者互异 |
| D5 重构「行为逐字节不变」 | 对照 `packages/vfsl/src/index.ts:135-160` 现行实现逐语句比对 gate 抽出前后执行序与构造点 | 同构成立（ENV-1/2/3 map、ENV-4 单条、parseVfsl 透传、顶层 catch 全等） |
| §1.2 代码现状盘点 | 直读 index.ts / envelope.ts / evaluate.ts / tokenizer.ts / derived.ts / ir.ts / schemasource.ts / package.json / tsconfig.base.json / vitest.config.ts | 大部分属实；**两处不实（A3、§9 #3 命令缺贴）**，其余（lib ES2022、noUncheckedIndexedAccess、verbatimModuleSyntax、版本 0.1.9、无 dependencies 字段、vitest 无 isolate:false/setupFiles、evaluate 顶层 catch→E100、envelope.ts:6-7 约定、schemasource.ts:93 断言单点）全部核实 |
| §11 修正案与当前测试锚点一致性 | 直读 `packages/vfsl/test/docscope-getcompiled.test.ts` 当前版本（SA6 修正后） | TEXT_HIT（:111）/TEXT_RETRY（:114）/AC4.1 case-3 `lang:'wml'`（:319）均与设计 §11 一致；AC6.1 `dependencies ?? {}` 语义与现状（字段缺席）相容；AC5/AC1.2 计数推演在 §5.2 控制流下逐条成立 |
| 深冻结有效性前提 | derived.ts / ir.ts 类型族 | 全部纯 JSON 数据（Record/数组/原始值），无 Map/Set/Date——`Object.freeze` 冻结有效；parser/tokenizer/semantic 无模块级共享对象单例（无跨解析内化污染面）；`parser.ts:24 MAX_TYPE_NESTING=100` 封顶嵌套深度，deepFreeze 递归栈安全 |
| **A1 攻击链** | node:crypto 实测哈希等价 + tokenizer.ts 直读 | 见下文——攻击链闭合 |

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| A1 | **CRITICAL** | D2/D8 缓存键单射性（INV-2） | UTF-8 替换编码使 lone surrogate 与 `U+FFFD`（及彼此）坍缩为同一键：两条**均可成功 parse+evaluate 的不同文本**共享缓存条目，后者静默命中前者的 module/derived——**静默错数据**，违反设计自立的 INV-2「内容不同 → 不同键」 | 修订 D2/D8/§5.3/§5.4/§6：单射编码或入口响亮拒绝（二选一，见详述），补 KAT 向量与红灯测试 |
| A2 | MINOR | INV-6 崩溃边界 | getCompiled 的 try/catch 只包裹 `envelopeTextGate`；文本通道（及两通道的 ②③④ 阶段）无顶层兜底，与 §4.1 JSDoc「不抛错（崩溃边界同 H1）」的结构性承诺不符（H1 包整个函数体）。当前无可触发输入（已核查），但承诺应收口 | 全函数体包 try/catch → ENV-100 同款结构化返回，或在设计中显式裁剪承诺范围并论证 |
| A3 | MINOR | §1.2 现状盘点事实性 | 「仓内 sha-256/哈希：不存在（grep 全仓 `createHash\|sha256` 仅本设计新增面）」**不实**：`packages/vfsl-codegen/src/header.ts:10,37` 已用 `node:crypto` 对 sourceText 做 sha-256 头注（`domains/vfs3-assets/generated.ts:4` 即其产物） | R2 修正盘点：改为「引擎包内不存在；仓内 codegen 包有 node:crypto 先例（构建期工具包，不违引擎包唯一环境绑定面不变量）」——这反而给 D8 提供更准确的对照论据 |
| A4 | MINOR | §9 #3 依据形式 | 声称「设计期实测验证」并贴了全部对拍结果（摘要），但**未贴命令原文**（SKILL 立法：实测验证须贴命令+输出）。实质为真（SA2 已独立复算确认），仅形式缺口 | R2 在 §9 #3 补贴可重跑的命令原文（node:crypto 对拍 one-liner），供 SA4 静态门禁重放 |
| N1 | NOTE | D4.3 × 冻结校验接缝交互 | `validateSnapshot`/`validatePatch` 文档承诺对派生物只读消费，但**无任何测试锚定「缓存命中条目（已深冻结）喂给校验接缝」与新鲜 derived 行为全等**。若校验器某路径存在就地变异（如原地 sort），冻结条目会在校验器内部抛 TypeError→E100，缓存路径与新鲜路径行为分叉且无人察觉 | 建议红线 IT（见测试思路 N1）；非阻塞 |
| N2 | NOTE | D2 前瞻义务 | SA8 边缘项 #9（第二方言版本引入时必须升级缓存键域，否则跨方言串味）设计内已登记（D2 注），建议 R2 将其固化为 v2 演进 checklist 明细项 | 非阻塞登记 |

## 攻击点详述

### A1（CRITICAL）：缓存键等价类坍缩——lone surrogate ↔ U+FFFD，INV-2 被自己的编码层打破

**触发条件**（全部经源码/实测证实，链路闭合）：

1. 设计 §5.3 `utf8Bytes` 对未配对代理（lone surrogate）按 WHATWG 语义替换为 `U+FFFD`（`EF BF BD`）。实测（node:crypto，与设计实现逐字节一致）：

   ```
   sha256('\uD800') === sha256('\uDC00') === sha256('\uFFFD')   →  true（三者同为 EF BF BD 字节序列）
   ```

   即：**键空间 = sha256(utf8(text)) 在含 lone surrogate 的字符串上丧失单射性**。这是唯一的不单射来源（合法码点的 UTF-8 编码单射；已穷尽检查 §5.3 全部分支）。

2. 这类文本**能成功走完 parse + evaluate 并进入缓存**——攻击载荷的藏身处（tokenizer.ts 直读证实）：
   - **doc 注释**（tokenizer.ts:131-178）：块注释扫描接受任意码点（仅 `*`+`/` 终结），lone surrogate 按 `codePointAt` 单码元推进不报错；doc body 经 `text.slice(open+3, close)` **码元级逐字切片**（:176）入 `DocLead.body` → IR `VfslAlias.docs` → derived 的 `aliasDocs`/`fieldDocs` **逐字继承**（derived.ts:78-82）。
   - **字符串字面量**（tokenizer.ts:218-266）：`value += cc` 接受除 `"`、`\`、行终止符外的任意码点；字面量值进入 IR `kind:'literal'` → derived `values` 的枚举值集。

3. **攻击对**（两条文本仅在同一位置相差 lone-surrogate vs `U+FFFD`，或相差两个不同 lone surrogate）：

   ```
   TEXT_P = '/** note \uD800 */ type ROOT = { a: "\uD800"; };'   // 原生 lone surrogate
   TEXT_Q = '/** note \uFFFD */ type ROOT = { a: "\uFFFD"; };'   // U+FFFD（乱码替换符，现实中极常见）
   ```

   两者均 tokenizes fine → parseVfsl ok → evaluate ok；两者 IR 的 literal value 与 derived 的 aliasDocs/枚举值集**不同**；两者 utf8 字节序列**相同** → 同一 sha256 键。

**影响**：`getCompiled(TEXT_Q)` 命中 `TEXT_P` 的缓存条目，返回 `TEXT_P` 的 module/derived——**派生 schema 的枚举值与文档注释静默错配，无任何错误信号**。对以「编译是文本的纯函数，正确性由纯函数性保证」（§2）立身的缓存，这是最坏失败类：不是拒绝、不是降级，而是**错误的成功**。违反 INV-2 原文（「内容不同（哪怕仅空白）→ 不同键」），也架空 AC2 的纪律表述（「正确重算，不去重」——此类输入被错误去重）。触发概率评估：需要成对出现的病态文本，概率低；但 reachability 零门槛（JSON.parse `"\ud800"` 转义即产生 lone surrogate，Yjs 文本可含任意 UTF-16 码元，`U+FFFD` 是现实乱码输入），且后果不可检测。

**对设计自辩的预先反驳**：

- 「§5.3 已声明 U+FFFD 替换、§6 已列『未配对代理文本 → 替换，确定性』」——设计只登记了**确定性**，未登记**单射性丧失**；确定性 ≠ 不坍缩。§6 该行把边界描述为良性行为，恰恰掩盖了 INV-2 被打破的事实。
- 「简报 mandates sha-256，无自由度」——简报 mandates 的是「按文本内容哈希（sha-256）」；**JS 字符串 → 字节序列的编码是 D8 自己的裁定**（D8 选择了「UTF-8 RFC 3629 + WHATWG 替换」）。node:crypto `.update(string)` 同款行为不构成辩护——被否方案与既选方案同错不消灭错误。
- 「这类文本不现实」——见上；且 INV-2 是设计以绝对语气自立的硬不变式，审查以不变式为准，不以输入概率打折。

**修订要求**（SA1 二选一，修订 D2/D8/§5.3/§5.4/§6 对应条目）：

- **方案甲（推荐）：单射编码**。`utf8Bytes` 对 lone surrogate 采用区别性编码（如 WTF-8 风格 `ED A0 80`–`ED BF BF` 段，该段与任何合法码点的规范 UTF-8 不相交，天然单射；或私有转义方案）。合法文本行为零变化（KAT 全部原样绿），仅 lone surrogate 键位分离。§5.4 KAT 必须补向量：`sha256Hex('\uD800') !== sha256Hex('\uFFFD')`、`sha256Hex('\uD800') !== sha256Hex('\uDC00')`。
- **方案乙：入口响亮拒绝**。getCompiled 两通道（信封 text 与裸文本）在哈希前 O(n) 预扫 lone surrogate，命中即返回结构化 issue（loud、不落缓存）。代价：`getCompiled(text)` 与 `parseVfsl(text)` 对此类输入行为分叉（前者拒、后者 ok），设计必须明文登记该分叉及其理由（lone surrogate 是传输层腐坏信号）。
- 无论甲乙：§6 表「未配对代理文本」行改写为如实描述（坍缩风险 + 处置）；INV-2 补一句单射性辖域（方案甲：全字符串空间单射；方案乙：接受域内单射）。

### A2（MINOR）：文本通道无顶层崩溃边界，§4.1「不抛错（崩溃边界同 H1）」结构性超售

`§5.2` 的 try/catch 仅包 `envelopeTextGate(input)`（信封通道的对抗 getter/Proxy 面）。文本通道（`typeof input === 'string'`）与两通道的 ② 哈希 ③ parse+evaluate ④ 冻结入册 均无兜底；而 H1 的 `parseSchemaEnvelope`（index.ts:136-159）try 包**整个函数体**。SA2 已核查当前不存在可触发输入：parseVfsl/evaluate 各有顶层 catch→E100（index.ts:106-122、evaluate.ts:74-77）；`sha256Hex` 纯循环无递归；`deepFreeze` 递归深度被 `parser.ts:24 MAX_TYPE_NESTING=100` 结构性封顶；无 Map/Set 冻结盲区。**故这是承诺-实现结构偏差，非现实漏洞**。但 §4.1 JSDoc 写的是「不抛错（崩溃边界同 H1）」——设计不应让公共契约的成立依赖于「下游冻结接缝永不出现实现缺陷」这一未声明的隐含前提。修订要求：函数体整体包 try/catch（信封通道 throw → ENV-100 已有先例；文本通道可用同款 ENV-100 或对齐 E100 措辞，由 SA1 裁定并写明），或裁剪 §4.1/INV-6 措辞、在 §6 显式论证无抛出面的完备清单。一行结构性修改即可闭合，成本可忽略。

### A3（MINOR）：§1.2 现状盘点「仓内无 sha-256 资产」不实

实测 `grep -rn "createHash|sha256" packages apps domains tests`：`packages/vfsl-codegen/src/header.ts:10` `import { createHash } from 'node:crypto'`、:37 对 sourceText 做 sha-256 hex 头注（`Source hash: sha256:…`，产物见 `domains/vfs3-assets/generated.ts:4`）。设计 §1.2「grep 全仓仅本设计新增面」错误。**不影响 D8 结论**——D8 的实质论证（引擎包唯一环境绑定面不变量、`lib:["ES2022"]` 无 DOM、AC6 零依赖）独立成立且经 SA2 核实为真；codegen 是构建期工具包，其 node:crypto 用法不违引擎包边界。但现状盘点是 SA4 静态门禁的核对基准，错误声称必须修正；且该先例其实是 D8 更准确的论据（「仓内 sha-256-of-text 已有先例，但在工具包且绑 node——引擎包内自包含实现才是既守零依赖又守绑定面唯一性的解」）。

### A4（MINOR）：§9 #3 实测依据缺命令原文

依据栏贴了全部对拍结果（9 向量摘要 + 三变体摘要）但未贴命令。SA2 已独立复算：逐行转写 §5.3 与 `node:crypto` 对拍，6 条 KAT + 17 条边界向量（含块边界 55/56/63/64/119/120 字节、多块、1–4 字节 UTF-8、lone surrogate）**全部一致**——实质为真、SA4 可重放。按 SKILL 立法（实测验证须贴命令+输出），R2 补贴命令原文即可，非实质缺陷。

## 协议假设依据审查（SKILL 立法项）

- **章节存在性**：§9 存在，6 项假设逐项给出依据类型与具体引用。✅
- **依据可验证性**：#1（模块级状态跨 it 存续）贴了复现输出（`Tests 1 failed | 1 passed (2)`、Received 42）+ vitest.config.ts 反证（无 isolate:false/setupFiles，SA2 核实属实）；#2（ESM 严格模式 freeze 赋值抛 TypeError）引 ECMA-262；#4（TextEncoder 类型缺失）引 tsconfig + @types/node grep exit 2；#5（vi.mock 模块图截获）引 SA6 头注 + vitest 语义 + index.ts:63 现状（SA2 核实：改值导入不改变解析目标）；#6（gate 重构行为不变）引执行序同构 + H1 回归承诺——均可定位、可重跑。✅（#3 缺命令原文，见 A4）
- **「应该/通常/预计」类无据推断**：全文检索未见以推测语气充当依据的条目。✅
- **SA2 增量复核**：#5 的 mock 语义 SA2 追加了机制确认——SA6 mock 的是 `../src/evaluate.js` 模块图节点，index.ts 无论 re-export 还是值导入都解析同一模块说明符，vitest 拦截对两者等价；当前测试文件 `evaluateMock = vi.mocked(evaluate)`（:195）从 `../src/index.js` 取到的就是 mock 实例，与设计假设一致。

## 错误处理链路审查（SKILL 立法项）

- **静默失败**：无。全部失败路径经 `{ ok:false, issues }` 结构化返回值（§5.2 控制流逐分支核实：gate 拒绝 / parse 失败 / evaluate 失败均在 `Map.set` 之前 return）；无「无请求发出+无反馈」路径（本任务为纯引擎函数，无 UI 面）。**唯一例外是 A1——比静默失败更糟的静默错误成功**，已在 A1 单列。
- **状态闭环**：`ok:false` 恒携带非空 issues（gate 同源构造 / vfslIssues 包装零损）；拒绝不落缓存、不占键（AC4.2 断言路径核实）；失败→重试→成功→入册的状态迁移闭合（AC5 三段式与 §5.2 ③④ 逐句对得上）。✅
- **降级路径**：ENV-100/ENV-1 是对抗输入的真实防御边界（非上游缺陷掩盖），与 parseSchemaEnvelope 同口径（envelopeCrashIssue 单点、crashDetail 二次异常守卫——F1 修复资产直读核实）。✅
- **虚假降级识别**：设计 §6 自检声明「无任何应恒真条件的静默 fallback」——SA2 独立扫描全部失败分支，**未发现伪降级**（没有把应恒真前提缺失当降级处理的路径）。但 §5.3/§6 的「U+FFFD 替换」**虽未被包装成降级、却同样起到掩盖作用**：以「确定性」话术掩盖单射性丧失（A1），性质上属于「良性行为话术掩盖正确性缺口」，按立法精神必须以 loud 手段（单射编码或入口拒绝）取代。

## 红线测试思路

- **RT-1（对应 A1，必加）**：KAT 层——`sha256Hex('\uD800') !== sha256Hex('\uFFFD')`、`sha256Hex('\uD800') !== sha256Hex('\uDC00')`（落 §5.4 KAT 文件；方案甲下绿、现状设计下红——正是红灯锚点）。集成层——构造 `TEXT_P`/`TEXT_Q` 攻击对（doc 注释与字符串字面量两个藏身处各一对）：先各自 `parseVfsl`+`evaluate` fixture 自检 ok，再 `getCompiled(TEXT_P)`、`getCompiled(TEXT_Q)`：断言两者容器/module/derived 引用互异，且各自 `derived` 与 `freshDerived` 深相等（现状设计下 TEXT_Q 命中 TEXT_P 条目 → 深相等断言红）。
- **RT-2（对应 A2）**：对抗性输入不外抛——对文本通道喂极端输入（超深嵌套至 `MAX_TYPE_NESTING` 边界、超长文本、lone surrogate 文本），断言 getCompiled 要么 ok 要么 `ok:false+issues`，永不 throw（信封通道已有 ENV-100 面可顺带回归）。
- **RT-3（对应 N1）**：`validateSnapshot(getCompiled(TEXT).derived, snapshot)` 与 `validateSnapshot(freshDerived(TEXT), snapshot)` 结果全等（含 ok 分支与拒绝分支各一）；`validatePatch` 同款。锚定「深冻结条目对冻结校验接缝零行为差异」。
- **RT-4（回归护栏，随 §11 修正已就位）**：现行 13 用例在实现后应全绿；`parse-schema-envelope.test.ts`（H1）零改动全绿是 D5「行为逐字节不变」的活体证明——SA4/SA7 必须保留该回归锚，任何为让 docscope 测试通过而动 H1 测试的冲动都是红线。

## 已验证为可靠的设计面（R2 修订时请勿波及）

以下攻击线经 SA2 独立验证后**排除**，列出以防 R2 修订时误伤：

1. **D8 参考实现本体**：逐行转写对拍 node:crypto，6 KAT + 17 边界向量全部一致（含设计自查纠错点——位长编码 `Math.floor` 取整，`'abc'` 向量确可捕获未取整错）。K 表抄录正确。
2. **D5 gate 抽出**：与 index.ts:135-160 现行实现执行序/构造点完全同构，「行为逐字节不变」论证成立；`vfslIssues` 提出为单点不改变语义。
3. **深冻结有效性与安全性**：module/derived 全纯 JSON 数据形状（无 Map/Set/Date），Object.freeze 生效；parser 链无跨解析共享对象单例（无内化污染面）；嵌套深度被 `MAX_TYPE_NESTING=100` 封顶（递归栈安全）；WeakSet 防环幂等。
4. **vi.mock 模块图截获**（§9 #5）：SA6 现行 mock 与「值导入 + re-export」形态兼容，AC1.2/AC5 计数断言在 §5.2 控制流下逐条推演成立（TEXT_HIT/TEXT_RETRY 冷启动前提已在当前测试文件落实）。
5. **AC2 机制**：' '/'\t'/'\n' 均 trivia（tokenizer.ts:93-115），IR/derived 无行列——空白变体语义深相等、引用互异成立；前缀共享变体经全文哈希分离。
6. **D1（同步）/D6（文本隐式 vfsl@1）/D9（条目即返回值）/D10（落位 index.ts）**：与冻结接缝现状、仓例（envelope.ts:6-7）、SA6 断言形态（三重引用同一、thenable 统一 await）全部自洽；SA8 边缘项 #8/#11 裁定 SA2 认同。
7. **§8 文件清单/DENY LIST**：与现状一致（版本 0.1.9→0.1.10 准确；`dependencies` 字段缺席与 AC6.1 `?? {}` 语义相容；codegen evaluate caller 审计属实）。
8. **§11 上报的 SA6 三处 fixture 缺陷**：分析正确、修正案已被 SA6 执行且与当前测试文件逐字一致（总控核实记录 + SA2 直读复核）。§11.5 否决的引擎侧「让测试原样通过」方案清单理由充分，SA2 背书——A1 的修订同样不得走「过拟合测试」路线。

## 验证证据（命令与结果摘录）

1. **SHA-256 独立对拍**（逐行转写设计 §5.3，`node --input-type=module` + `node:crypto`）：
   - `KAT 6 vectors vs FIPS-expected AND node:crypto: ALL OK`
   - `fixture base sha=e9fbe2b3 OK` / `trailing-nl sha=fd099a71 OK` / `double-space sha=1f2e536e OK` / `three mutually distinct: true`
   - `edge vectors (55/56/63/64/119/120B, multiblock, 1/2/3/4-byte UTF-8, lone surrogates): ALL OK`
   - `lone surrogate '\uD800' vs '\uFFFD' same digest: true`；`'\uD800' vs '\uDC00' same digest: true`（A1 实证）
2. **tokenizer 攻击面直读**：doc 注释任意码点接受 + 码元级逐字切片（tokenizer.ts:131-178，:176 `text.slice(open+3, close)`）；字符串字面量 `value += cc` 任意码点（:218-266）；标识符 ASCII 冻结（:53-59）。
3. **A3 盘点复核**：`grep -rn "createHash|sha256" …` → `packages/vfsl-codegen/src/header.ts:10,37`（node:crypto sha-256 头注）+ `domains/vfs3-assets/generated.ts:4`（产物）。
4. **配置核实**：tsconfig.base.json `lib:["ES2022"]`/`noUncheckedIndexedAccess`/`verbatimModuleSyntax`；vitest.config.ts 无 isolate/setupFiles；package.json version 0.1.9、无 dependencies 字段。
5. **当前测试锚点**：docscope-getcompiled.test.ts :111 `TEXT_HIT`、:114 `TEXT_RETRY`、:319 case-3 `lang:'wml'`、:401 `pkg.dependencies ?? {}`——与设计 §11/AC6 语义一致。

---

**结论**：D1–D10 骨架与绝大部分机制论证经独立攻击后屹立（SHA-256 实现、D5 同构、深冻结、mock 截获、AC 映射均实证可靠），但 A1 是带完整触发链与静默错数据后果的 INV-2 违反，必须修订设计后方可放行 SA3。A2/A3/A4 为低成本收口项，随 R2 一并处理。**Verdict: reject。**

---

# R2 复审（2026-08-21，SA2 第二轮）

- **被审对象**：`wiki/raw/task_docscope-compile-cache_design.md` **R2**（698 行；「SA2 反馈逐条回应」表七行已填）
- **复审范围**：R1 全部攻击点的修订闭合性 + R2 修订自身引入的新攻击面 + 总控点名三项重点（WTF-8 单射证明闭合、RT-1/2/3 锚可执行、R1 已验证面零波及）
- **方法**：不采信 R2 自述，全部关键声称独立重验——WTF-8 参考实现逐行转写对拍（手构字节序列绕开 node 规范 UTF-8 的替换语义做参照）、fixture 语法/语义可达性直读 parser/semantic/evaluate 源码、validate 接缝签名核对
- **终稿说明**（续跑会话全量重验）：本节初稿由前一会话写入，本会话以全新转写独立重跑了全部数值锚（KAT 三向量、五互异向量、畸形边角、9 合法向量、攻击对摘要、§9 #7 值），并新增三项初稿未做的实证——真实引擎 tsx 执行攻击 fixture（证据 7）、30,000 条随机单射 fuzz（证据 8）、§9 #3 命令 CJS 自洽性实测（证据 9）。全部数值与初稿一致；初稿唯一实质错误「R2-N1 不可复现」经复现证伪并撤回（见下「勘误」）。结论维持 **pass**。

## R2 修订闭合性总表

| R1 项 | R2 修订声称 | SA2 独立复核结果 |
|---|---|---|
| A1（CRITICAL）| 方案甲：WTF-8 单射字节化（D8.2 三段式证明 + D8.3 方案乙否决理由 + §5.4 RT-1 两层 + §6/INV-2/§7 AC2 改写） | **✅ 闭合**（证明逐段核验 + 全数值独立复算，见下「重点 1」） |
| A2（MINOR）| D11：getCompiled 全函数体单 try/catch → ENV-100（原 gate 内层 try 移除，外层同构覆盖）；kind 裁定 kind:'envelope'（崩溃点无行列语义）；RT-2 守卫 | **✅ 闭合**（§5.2 控制流核验：非抛出路径返回值与 R1 逐点一致，gate 抛出→外层 catch→ENV-100 覆盖面 ⊇ R1 内层；RT-2 断言 kind:'envelope'/code:'100' 与实现一致） |
| A3（MINOR）| §1.2 盘点重写：引擎包内不存在 / 仓内先例在 codegen 工具包且绑 node，转为 D8 对照论据 | **✅ 属实**（与 SA2 R1 的 grep 证据一致：header.ts:10,37） |
| A4（MINOR）| §9 #3 补可重跑命令原文（heredoc node 对拍，`node <<'EOF'` stdin 默认 CJS，`require('node:crypto')` 可用——命令自洽可跑）+ §9 #7 单射性专项实证 | **✅ 闭合**（#7 全部可复现数值经 SA2 复算证实——含组合形 fixture `0150e7d3…/9d96376c…` 的精确复现，见下「勘误」；stdin CJS 语义经本仓实测） |
| N1（NOTE）| §5.5 RT-3（validateSnapshot/validatePatch × 冻结条目 ≡ 新鲜 derived）+ ALLOW LIST 新增 docscope-guards.test.ts | **✅ 采纳且可执行**（签名核对：validate.ts:642 `(derived, snapshot)` 相符；validate-patch.ts:611 的 `path: Array<string\|number>`——设计速写用了标量 'a'，见 R2-N2） |
| N2（NOTE）| §12 v2 演进义务 checklist（V2-1 方言键域升级=SA8 #9 义务原文登记并列为触发票验收项；V2-2 淘汰；V2-3 per-scope 册；V2-4 async in-flight 去重） | **✅ 采纳**（V2-1 表述与 SA8 #9 义务等价且加了验收项绑定，超出 R1 要求） |
| SA8 措辞观察 | 「编译缓存条目」统一（§4.1/§5.2 JSDoc） | ✅ 顺带采纳 |

## 重点 1：WTF-8 单射证明是否闭合 → **闭合**

对 §5.3 D8.2 三段式证明逐段核验，并补充 SA2 自己的论证视角：

1. **扫描层（字符串 → 符号序列）单射**：`codePointAt` 把「高代理+低代理」并读为一个星面符号、其余每码元一个符号。星面符号唯一展开回该代理对（`0xD800+((cp-0x10000)>>10)` / `0xDC00+…`），非星面符号即单码元——符号序列 → 码元序列是全函数，与扫描方向互逆 ⇒ 字符串不同 ⇒ 符号序列不同。设计未显式陈述互逆性，但「扫描器确定性」+ 星面符号编码双射已蕴含；SA2 以畸形边角实测补强（见下）。
2. **编码层（符号 → 字节）**：四类首字节前缀（`0xxxxxxx`/`110xxxxx`/`1110xxxx`/`11110xxx`）互斥且续字节恒 `10xxxxxx` ⇒ 拼接流从首字节起唯一可解码（每个前缀唯一确定符号长度）；类内 5/11/16/21 位载荷双射。**代理段不相交性实测**：合法侧边界 `U+D7FF → ed9fbf`、`U+E000 → ee8080`，代理段端点 `U+D800 → eda080`、`U+DBFF → edafbf`、`U+DC00 → edb080`、`U+DFFF → edbfbf`——合法 (c) 类编码止于 `ed9fbf`、续于 `ee8080`，`eda080–edbfbf` 仅由 lone surrogate 产生。三段证明闭合。
3. **实测矩阵**（SA2 逐行转写 R2 §5.3 实现独立复算）：
   - **RT-1 KAT 三条期望摘要全部正确**：`sha256Hex('\uD800') === 91a681b9… === node:crypto(Buffer[ed a0 80])`、`'\uDC00' → b2d612a0… === node(Buffer[ed b0 80])`、`'\uFFFD' → 83d544cc… === node(Buffer[ef bf bd])`；§9 #7 前缀声称 `\uDBFF → 70f1c475`、`\uDFFF → 8a8821b2` 亦复算属实。
   - **五向量互异**（D800/DC00/FFFD/DBFF/DFFF）+ **10 条畸形边角两两互异且与五向量全不相交**（反向代理对 `\uDE00\uD83D`、双高 `\uD800\uDBFF`、高代理+尾字符、配对星面、`a\uD800b`/`a\uFFFDb`、`x\uD83D`、`\uDFFFy`、`\uD800\uD800\uFFFD`、`\uFFFD\uD800`）。
   - **攻击对字节级正确**（非仅互异）：§5.4 两对 fixture（doc 注释对、字符串字面量对）+ SA2 自构组合形，实现摘要与「ASCII 段 + 手构 WTF-8/UTF-8 字节段」拼接的 node:crypto 参照**逐字节全等**（`P==splice:true / Q==splice:true` ×3 组）。
   - **红绿极性验证**：R1 替换编码下 `sha256Hex('\uD800')` 将产出 `83d544cc…`（=U+FFFD），RT-1 KAT 向量与互异断言必红；R2 下全绿——锚点方向正确。

## 重点 2：RT-1/RT-2/RT-3 锚是否可执行 → **可执行**

对每个锚做「fixture 可达性」核查（锚红/绿的前提是 fixture 本身能走到被测分支，否则红错原因）：

- **RT-1 集成层**：两攻击对均**语法+语义+求值全链可达**——① parser.ts `parsePrimaryType` `case 'string'` → `{kind:'literal', value}`（:328-329）：字符串字面量在类型位置即合法字面量类型，`type ROOT = { a: "\uD800"; };` 语法合法；semantic.ts:63/:207-208 与 evaluate.ts:85-222/:277 literal 分段全链支持，ROOT 本体为 map 形（E311 无涉）。② doc 注释对：tokenizer.ts:175 `/**…*/` 判定 + :176 码元级切片，body 含 lone surrogate 逐字入 `aliasDocs`。断言 `not.toBe` ×3 + `toEqual(freshDerived)` 在 R2 下绿、R1 下双红。✅
- **RT-2**：① 深嵌套 fixture 语法合法——parser.ts 对象字段循环「末字段无分隔符合法」（`}` 直接闭合），`nest(n)` 各层合法；`parseObjectType` 深度预算 `depth > MAX_TYPE_NESTING(100)` 在第 101 个 `{` 触发 E100 ⇒ n=98/100 合法（100 为最大合法边界，恰是「边界」档）、n=120 拒绝——三档均落入断言的「要么 ok 要么 ok:false」辖域，永不 throw 由测试本体承载（throw 即败）。② 对抗 getter 流核验：`Object.hasOwn` 不触发 getter（存在性检查），首次读取在 `src[key]`（envelope.ts:137）抛出 → R2 外层 catch → `envelopeCrashIssue` → kind:'envelope'/code:'100'，与断言逐字段一致。✅（两处 `/* 构造同款断言 */` 占位为设计明示的 SA3 填充位，断言形态冻结，可接受。）
- **RT-3**：validateSnapshot 签名 `(derived, snapshot: unknown)`（validate.ts:642）与速写相符；SNAPSHOT_OK/BAD 的 ok/拒绝两分支构造成立（TEXT 必填 a:string / 可选 b?:number）。✅（validatePatch 实参 path 应为数组 `['a']`，见 R2-N2。）

## 重点 3：R1 已验证面零波及 → **零波及**

- **SHA-256 压缩循环/K 表/长度编码**：R2 §5.3 与 R1 逐字节一致（仅 `utf8Bytes` 删替换分支）；SA2 重新逐行转写对拍：**9 条合法向量（6 KAT + SA6 fixture 三变体）字节化与 node 规范 UTF-8 完全一致（ALL OK）**——「合法文本行为零变化」声称成立，SA6 现行 13 用例的键值不受任何影响。
- **D5 gate 伪代码 / parseSchemaEnvelope 重构**：与 R1 逐字一致，未动。**deepFreeze**：未动。**§11/§11.5**：内容保留，仅追加状态横幅（与 SA6 当前文件 :111/:114/:319 一致性经 R1 直读已确认，R2 表述无漂移）。
- **决策骨架**：D1–D7/D9/D10 未变；新增 D11 与 D8.2 修订均在 R1 reject 指定的修订辖域内，无越界改动。

## R2 残留项（均非阻塞，不构成新一轮 reject 依据）

| # | 级别 | 事项 | 处置建议 |
|---|---|---|---|
| R2-N2 | NOTE（SA3 实现提示） | §5.5 RT-3 validatePatch 速写实参 `'a'` 为标量，实际签名 `path: Array<string \| number>`（validate-patch.ts:611），落地须用 `['a']`；RT-2 对抗 getter 的 `as never` 建议改 `as unknown` 中转变量（均可编译，纯风格） | SA3 实现时按实际签名落地；设计已声明 fixture 可调、断言形态冻结，无需设计轮次 |
| R2-N3 | NOTE（已知即可） | RT-2 注释「合法/边界/越界」三档中 n=100 为**最大合法**边界（第 101 个 `{` 才触发 E100）；断言形态对此不敏感 | 无需动作 |

### 勘误：R2 复审初稿的「R2-N1」指控不成立，撤回

R2 复审初稿曾列「§9 #7 的 TEXT_P/TEXT_Q 摘要值（`0150e7d3…`/`9d96376c…`）不可第三方复现」为 MINOR 残留项。**该指控错误，已撤回**：初稿只拿 §5.4 的两对分离 fixture（doc 注释对 `6c1e4331…/6efeb41a…`、字面量对 `f7f835e1…/6bb2e001…`）去比对，漏试了 §9 #7 自述的构造——「TEXT_P（**doc 注释+字面量**含 \uD800）」即**组合形**（两藏身处同文）。终稿复核（2026-08-21，续跑会话全量重验）：

```
P = '/** note \uD800 */ type ROOT = { a: "\uD800"; };'
  → sha256Hex(P) = 0150e7d3228ff5b56fd12590da16e0b6ed0faf4993bc76331858c38537c9e8ca  （前缀 = §9 #7 声称 0150e7d3…）
Q = '/** note \uFFFD */ type ROOT = { a: "\uFFFD"; };'
  → sha256Hex(Q) = 9d96376cfe0a256a0cf2a2ad3f93fe59c7b1f629e8a8f67242349c1555a2e3a2  （前缀 = §9 #7 声称 9d96376c…）
```

即 §9 #7 的两个证据值**可第三方精确复现**（32 bit 前缀双命中，非巧合），其与 §5.4 分离 fixture 摘要的差异只是「证据 fixture（组合形）≠ 守卫 fixture（分离两对）」的正常分工，**不构成任何设计缺陷**。残留项相应由三项收敛为两项（R2-N2/R2-N3）。此勘误同时说明：§5.4 分离两对 + §9 #7 组合形，三种构造在 R2 编码下全部互异、在 R1 替换编码下全部坍缩——攻击面的覆盖反而更完整。

## R2 复审验证证据（命令与结果摘录）

1. **WTF-8 KAT 三向量**（逐行转写 R2 §5.3 + node:crypto 手构字节参照）：`KAT "\ud800": impl==claimed=true | nodeRef(handBytes)==claimed=true | bytes=eda080`；`"\udc00": …true…edb080`；`"\ufffd": …true…efbfbd`；`DBFF prefix: 70f1c475 (claimed 70f1c475)`；`DFFF prefix: 8a8821b2 (claimed 8a8821b2)`。
2. **合法文本零变化**：`legal 9 vectors == node utf8 (R1 行为不变): ALL OK`。
3. **单射实测**：`five digests distinct: YES`；`corners pairwise distinct + disjoint-from-surs: YES`（10 边角）；类 (c) 边界 `0xD7FF: ed9fbf | 0xE000: ee8080 | DBFF: edafbf | DFFF: edbfbf`。
4. **攻击对**：`pair1-doc | distinct=true | P==splice:true | Q==splice:true`；`pair2-lit | …true…`；`combined-doc+lit | …true…`（手构 ASCII+WTF-8 拼接参照）。
5. **fixture 可达性源码直读**：parser.ts:328-329（string→literal 类型）、parseObjectType 字段循环（末字段无分隔符合法 + `depth > 100` → E100）、semantic.ts:63/207-208、evaluate.ts:85/222/277（literal 全链分支）、validate.ts:642 / validate-patch.ts:611（RT-3 签名）、envelope.ts:137（getter 首读点）。
6. 转写过程自查记录：SA2 首次复算脚本报 KAT 全 FAIL，溯源为**SA2 自己的转写笔误**（K 表第三项漏抄一位 + mj 表达式抄错），修正后全过——设计 §5.3 原文无误；此插曲反向印证设计 §5.3「KAT 失败 = 抄录错误探测器」论断。
7. **引擎侧执行实证**（续跑会话，`node_modules/.bin/tsx /tmp/sa2r2/engine-check.ts` 直驱仓内 `packages/vfsl/src/index.ts`）：RT-1 四条 fixture（doc 注释/字面量 × \uD800/\uFFFD）`parseVfsl + evaluate` **全部 ok**；P/Q 派生物 JSON 不相等（doc 对 590 vs 585 字符、lit 对 577 vs 572——R1 坍缩下 Q 将错拿 P 的派生物，错数据后果实证）；派生物 JSON 含 `\ud800` 转义（lone surrogate 确实进入 aliasDocs/枚举值）；JSON 往返相等（ADR-0003 纯数据纪律在 lone surrogate 下成立）；`nest(98/100)` parse+evaluate ok、`nest(120)` parse 拒绝（RT-2 三档 fixture 行为与设计预期一致）。
8. **单射性随机 fuzz**（续跑会话）：30,000 条随机代理密集字符串（码元 45% 代理区 / ASCII / BMP 中文 / 星面混排，长度 1–8），设计实现逐行转写版 vs SA2 **独立另写**的参照字节化器（显式高低代理配对检测，与 codePointAt 不同构）——**逐字节全等（cross-impl match: true）且互异字符串间零摘要碰撞**。与 §5.3 三段式证明互为印证。
9. **§9 #3 命令自洽性**：`node <<'EOF'` 在本仓（package.json `"type":"module"`）下 stdin 仍默认 CJS（实测 `typeof require === 'function'`），内嵌 `require('node:crypto')` 的对拍命令原样可跑；SA2 以等价脚本复现其 9 向量全 `OK` 输出。§9 #7 组合形 fixture 复现见上「勘误」。

---

## R2 结论

R1 的 CRITICAL 攻击点 A1 已由方案甲（WTF-8 单射字节化）完整闭合：三段式单射证明经逐段核验成立（另经 30,000 条随机代理密集字符串 fuzz 与独立参照实现交叉印证）、全部测试锚定数值独立复算属实（含 §9 #7 组合形 fixture 的精确复现，见勘误）、合法文本行为零变化（9 向量对拍全 OK）、攻击对红绿极性正确且 fixture 经真实引擎执行证明确实合法可编译（错数据后果链闭合）；A2（D11 全函数体崩溃边界）、A3（盘点修正）、A4（命令原文 + §9 #7）、N1（RT-3）、N2（§12 checklist）全部落地且可执行；R1 已验证面（压缩循环/K 表/D5/deepFreeze/§11）零波及。R2 修订自身未引入新攻击面；残留两项（R2-N2/R2-N3）均为 SA3 实现提示级别，无一项需要设计轮次。

**Verdict（R2）：pass。** 同意放行 SA3 实现阶段；SA4/SA7 后续按 RT-1/RT-2/RT-3 + SA6 13 用例 + H1 回归（RT-4）验收，本 pass 不预支其对实现与活链路的验证。
