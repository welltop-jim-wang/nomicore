# SA1 实现设计 — issue #314：VFSL 数字字面量拓宽（负号与小数，ADR 0020 决策 3）

- 任务类型：**Feature**（文法纯拓宽，端到端生效）＋回归契约面（既有行为零漂移）。
- 设计输入：`wiki/raw/task_issue-314.md`（Host 简报，Issue 正文 33 行，comments REST
  `[]`）＋ `wiki/raw/task_issue-314_sa6_contract.md`（SA6 验收契约，accepted）＋
  `wiki/raw/task_issue-314_sa2_review.md`（评审修订输入，见下）。
- 设计基线 HEAD：`29ff10f843a4d877866e963cedc8766d60194d33`（分支 `mabf/issue-314`，
  与 SA6 契约、SA2 评审、SA8 复查基线同一提交）。
- 迭代说明：本次为 design iteration 3，对 iteration 2 设计**原位修订**。iteration 2 的
  技术核心（D1–D6 扫描/闸门/零改动结论、锚位矩阵、T1/T2 载体替换、C1–C7 验收映射、
  B15 与 (1,26) 两处勘误）经 SA2 独立攻击评审逐条核验**成立且未被要求变更**，本修订
  原样保留；本次仅落实 SA2 **reject** 评审的唯一 MAJOR finding **F1**（规范文档同步面
  遗漏第六处陈述 `schema-authoring-guide.md:216`，见 §5-D7-6 与 §5-D7-审计），并吸收
  非阻塞观察项中的纯准确性修正（§5-D4/§7/§8/§9/§11/§12/§13-R6）。全文仍为当前唯一
  一致设计，可直接实施，无需理解历史版本。
- 评审输入：`wiki/raw/task_issue-314_sa2_review.md`（iteration 0，verdict **reject**：
  1 × MAJOR F1、0 × BLOCKER、7 项非阻塞观察；评审基线与本设计同为 29ff10f）。
- SA8 设计后冲突复查：`wiki/raw/task_issue-314_design_conflict_report.md`（iteration 0，
  verdict `clear`、`requiresConflictRecheck: true`）。其 §3 行 11 与 §6.1 的「陈述面恰为
  此五处」完备性声明已被 SA2 F1 证伪，本修订以**六处编辑 + 扩充审计**（§5-D7）取代该
  口径；其余裁决（14 项对照、D2 触发器不触发、(1,26) 勘误成立）不受影响。
- 任务前置 SA8 产物（`task_issue-314_relevant_decisions.md` /
  `task_issue-314_conflict_report.md`）本任务实例未生成（SA6 §1、SA8 复查 §1 一致确认）。

---

## 1. 任务类型、目标和非目标

### 目标

把 VFSL 数字字面量文法从 `[0-9]+`（无符号十进制整数）拓宽为
`-? [0-9]+ ('.' [0-9]+)?`，**全局生效**（任何类型位置：联合成员、对象字段类型、
数组元素、Marker 实参、Record 值位、别名 RHS……），端到端可用：

- tokenizer：`-`（仅当紧随 digit）与 `.`（仅当两侧皆 digit）成为 number 记号的一部分；
- parser：字面量分支产出 IR `{ kind: 'literal', value: number }`（f64 值）；
- derived/evaluate：全字面量联合折叠为 `enum`（既有逻辑，零改动）；
- validate：`enumContains` f64 严格相等（既有逻辑，零改动）；
- codegen：`String(number)` 发射合法 TS 字面量类型（既有逻辑，零改动）。

### 负例契约（拓宽后仍 E100，锚位钉死）

裸 `-`（后不接 digit）、`- 1`、`-/*c*/1`、`-.5`、`--1`、`.5`、`1.`、`1..5`、
`1e3` / `-1e3`（指数记号不做）、`-0`（含值为 -0 的小数下溢形态）、
超双精度字面量（含负值，沿既有 §7.3 域闸门）。

### 非目标（本设计明确不做）

| 非目标 | 依据 |
| --- | --- |
| `number & Int` / `number & Range` 语法（ADR 0020 决策 2/4/5/6/7/8） | 简报范围只含字面量拓宽；`Int`/`Range` 仍是普通标识符，其 spec §3/§8 修订属各自 issue |
| 指数记号（`1e3`、`1.5E-2`） | ADR 0020 决策 3「指数记号不做」、决策 10「明确不做」 |
| 运行时 number 基线收窄（NaN/±Infinity/-0 的运行期拒绝） | 归 issue #312 / ADR 0021；#314 只做**文本侧** `-0` 字面量解析期 E100 |
| 方言 v2、`FINGERPRINT_PREFIX` 升版 | ADR 0020 决策 1（不引入 v2）、决策 5（既有指纹不变）；见 §6「D2 指纹升级触发器」裁定 |
| 十六进制 / 其他进制、epsilon 比较、十进制语义 | ADR 0020 决策 10 与 Considered Options 5 |
| 生成文本可被 VFSL 回读 | SA6 契约 §12.5「明确非要求」（`1e-7` 是合法 TS 而 VFSL 指数记号仍 E100） |

---

## 2. 当前行为与证据锚点（HEAD 29ff10f）

| # | 事实 | 锚点 |
| --- | --- | --- |
| B1 | tokenizer 数字分支只扫 `[0-9]+`；`value`=原文、`num = Number(raw)` | `packages/vfsl/src/tokenizer.ts:200-215` |
| B2 | `-` 与 `.` 不在 `PUNCT` 集，落入「未知字符 → E100 延迟错误记号 + `break scan`」 | `tokenizer.ts:47`（PUNCT）、`:276-278`（未知字符分支，注释明列 `-`、`.`） |
| B3 | 词法错误不在 tokenize 期抛出，产出 `kind:'error'` 记号由 parser 消费即败（文本序首错胜出） | `tokenizer.ts:4-8`；`parser.ts:231-236`（errFromToken） |
| B4 | parser 字面量分支：`!Number.isFinite(tok.num)` → E100「超出可序列化数值域」，锚该数字记号；否则 IR literal | `parser.ts:416-421` |
| B5 | tokenDesc 对 number 记号显示 `数字字面量 '${t.value}'`（value 含原文） | `parser.ts:247-248` |
| B6 | evaluate：单字面量 → `enum values:[value]`；全字面量联合 → `enum values`（声明序）；判别键 `String(字面量)` | `evaluate.ts:280-281`、`:301-309`、`:235-272`（detectDiscriminator，键恒 String） |
| B7 | validate：`enumContains` 用 `===` 严格相等（类型形随严格相等自然对齐） | `validate.ts:162-165` |
| B8 | codegen：枚举成员投影 `typeof lit === 'string' ? quoted : String(lit)`；leaf/别名终态共用 `projectUnionMembers` | `packages/vfsl-codegen/src/valuetype.ts:65-77`；`emitter.ts:335-347`、`:240-245` |
| B9 | 指纹：envelope 四键序 / semantic `{domain,lang,version,module}` canonical JSON，前缀 `sha256:v1:`；头注 D2 契约标记登记「v2 方言放开数值字面量语法 ⇒ 重审升 v2」触发器 | `fingerprint.ts:24`、`:37-57`、`:7-13`（D2-CONTRACT-MARKER） |
| B10 | `tokenize`/`Token` 不在 `index.ts` 公共导出面（内部结构，非公共契约） | `packages/vfsl/src/index.ts:48,157`（仅内部 import） |
| B11 | 公共管线：`parseVfsl`（tokenize → parseModule → analyze），未预期异常顶层兜底为单条 E100 | `index.ts:151-177` |
| B12 | E310 缺 ROOT 锚模块起始 (1,1) 硬编码；E311 ROOT 非 map 形锚类型表达式起点；E306 Record 键非 string 形锚键类型起点 | `shapes.ts:610-620`、`:622-640`、`:569-578` |
| B13 | 规范现状：EBNF `NumberLiteral = digit, { digit }`；注记 7「仅无符号十进制整数」；微示例把 `type C = -1 \| 1;` 标为 E100；E100 码表行以「负数 / 小数字面量」为越界示例 | `docs/vfsl/v1-spec.md:63`、`:83-84`、`:118`、`:358` |
| B14 | 指南现状：`:145`「数字字面量仅支持无符号十进制整数」；`:216`「v1 语法护栏」构造白名单句以「字符串或**整数文字**」表述同一契约——SA2 F1 补充发现的第六处规范陈述，单一「无符号」grep 模式探不到，iteration 2 审计遗漏 | `docs/vfsl/schema-authoring-guide.md:145`、`:216`（本设计 iteration 3 扩充 grep 重跑核验，见 §5-D7-审计） |
| B15 | 既有断言负例的测试载体：`parse-vfsl-errors.test.ts:58-63`（`type A = -1;` → E100@(1,10)）与 `parse-vfsl-r3-regression.test.ts:63-65/68-70/78-80`（`/*😀*/ type A = -1;` 等 3 例 → E100@(1,16)/(1,17)/(1,16)，R-1 星面字符列计数回归） | 两测试文件（grep 全仓 `= -`/`: -[0-9]` 型 VFSL 文本仅命中此 4 处断言） |
| B16 | 超域/指数 sentinel：`1e999` 断言仅 `ok:false` + E 码形状；`'9'×400` 断言消息前缀「超出可序列化数值域」 | `compile-schema-envelope-sentinel.test.ts:114-132` |
| B17 | 测试发现面与 CI：`vitest.config.ts` include `packages/*/test/**/*.test.ts`（新文件自动入片）；CI 含 `pnpm typecheck`、`--typecheck.only`、6 分片、`pnpm generate --check` | `vitest.config.ts:15-21`；`.github/workflows/ci.yml` |

SA6 契约在 HEAD 上实测的锚位矩阵（正例现红、负例现绿、下游链已具备能力）见契约
§5/§6/§8/§9，本设计直接承接，不重复复现。

---

## 3. 能力缺口（根因链承接）

**缺口定位在文本记号层，且只在记号层。**

- 症状：`type ROOT = YMap<{ v: -1 | 0.5 }>;` → E100「未知记号: -」@(1,23)。
- 直接故障点：tokenizer 数字分支不收 `-`/`.`（B1/B2）。
- 最深根因：v1-spec §2 注记 7 当时冻结「仅无符号十进制整数」（B13），tokenizer/parser
  据此实现；ADR 0020 决策 3 已裁决拓宽，实现未落地。
- 缺口边界（SA6 E1/E3/E5 已证）：post-parse 链（IR literal 数值、enum 折叠、validate
  严格相等、codegen `String(number)`）**已支持**负值与小数的 f64 表示——手工构造含
  `[-1, 0.5, 2]` 枚举的 IR 全链绿，`PathSchema<-1 | 0.5 | 2, 'leaf'>` 经仓内 TS 编译器
  0 诊断。因此 IR/derived/validate/codegen **零语义改动**是设计结论，不是偷懒。
- 放大因素（SA6 §8）：若 `-0` 被放过，`JSON.stringify(-0) === "0"` 会在 IR/指纹层把
  -0 静默坍缩为 0（假失效方向）——故 `-0` 必须解析期 loud 拒绝（见 D4）。

---

## 4. Owner 要求落实

Issue #314 comments REST 读取返回 `[]`，简报 `## Comments` 为空——**无超出正文的 owner
追加要求**；验收基线 = 简报 5 条 Acceptance criteria + 正文 What-to-build 约束。

| 来源 | 要求 | 设计落实位置 |
| --- | --- | --- |
| 正文 | 文法 `-? [0-9]+ ('.' [0-9]+)?` 全局生效 | §5-D1/D2、§8（扫描算法） |
| 正文 | 负号紧邻数字、作为 number 记号一部分扫描 | §5-D1（单 token 方案 + 单字符前看） |
| 正文 | 裸 `-` 维持未知字符 E100 路径 | §5-D1（分支入口条件保证）；C2 锚位钉死 |
| 正文 | `.5` / `1.` / `1e3` 维持 E100 | §5-D2 + §8 边界表；C2 |
| 正文 | 超双精度（含负值）沿 §7.3 判 E100 | §5-D5（既有闸门原样覆盖负值） |
| 正文 | `-0`（含 `-0.0` 等值为 -0 的形态）解析期 E100、消息引导写 `0` | §5-D4（值判定闸门） |
| AC1 | 负整数/小数作联合成员并通过 validate f64 严格相等枚举判定 | §12 C1/C3 |
| AC2 | 四类负例维持 E100 及正确锚位 | §12 C2（含 `-1e3` 锚位变化登记） |
| AC3 | 超双精度（含负值）E100 | §12 C2 |
| AC4 | fixture 语义指纹零漂移；codegen 发射合法 TS | §12 C5/C4；§5-D6 |
| AC5 | 包测试、typecheck、`git diff --check` 全绿 | §12 C7 |

---

## 5. 设计决策与主要备选方案

### D1 — 负号进 number 记号：tokenizer 单 token 方案（选定）

数字分支入口从「当前码点是 digit」扩为「当前码点是 digit，**或** 当前码点是 `-`（0x2D）
且 `text` 中紧随其后的**下一个码元**是 digit」。进入分支后：先消费可选 `-`，再消费
`[0-9]+`。

- 负号紧邻性由**单码元前看**保证：`- 1`、`-/*c*/1`、`-\n1` 中 `-` 的下一码元不是
  digit → 不进分支 → 落入既有未知字符 E100 路径，锚位、消息（`未知记号: -`）、
  trivia 语义全部不变。前看发生在**原始文本码元**上，不跳过任何 trivia——「吞空白/
  注释」类弱实现被构造性排除。
- 裸 `-`（含 `-` 在 EOF 前一位，`charCodeAt(i+1)` 为 NaN）同路径。
- **备选（拒绝）**：parser 层处理符号（`-` 作 punct、parsePrimary 拼接）。拒绝理由：
  (a) 违反 ADR 0020 决策 3「负号作为 number 记号一部分扫描」；(b) 需要把 `-` 加进
  PUNCT，会改变所有「未知记号: -」负例的锚点/消息通路；(c) parser 拼接需处理
  `-` 与 digit 之间的 trivia 归属，制造上下文特判（决策 3 明令禁止）。
- **备选（拒绝）**：正则引擎扫描整段数字。仓库 tokenizer 是手写码点循环（B1），
  行列按码点推进的记账与正则 lastIndex 管理易错，且引入无必要的状态。

### D2 — 小数点：单字符前看的最大咀嚼（选定）

整数部扫完后，**当且仅当** `text[i] === '.'` 且 `text[i+1]` 是 digit 时消费 `.` 与
随后的 `[0-9]+`；每 token 至多一个 `.`。

- `.5`：`.` 不在数字分支入口（`.` 非 digit 也非 `-`）→ 未知字符 E100，锚 `.`，不变。
- `1.` / `1..5`：整数部后 `.` 的下一码元分别是 EOF / `.`，非 digit → 不消费 → number
  记号 `1` 先行产出，`.` 落未知字符 E100，锚位与 HEAD 完全一致（(1,24) 家族）。
- `1.5.5`、`-1.`（未钉死契约、自然 fallout）：第二个 `.` 不再消费 → `.` 未知字符
  E100，与 `1.` 家族同构。
- `00.5`：前导零本就合法（文法 `[0-9]+` 未禁止，HEAD `00` 即 ok），`00.5` → 0.5。
- **备选（拒绝）**：宽松正则 `-?[0-9]*\.?[0-9]*` 一把吞——会放过 `.5`/`1.`/`-.5`/
  `--1` 等负例（SA6 §12.9 突变矩阵点名），且无法维持既有锚位。

### D3 — 值语义：`num = Number(raw)`，f64 归一是语义而非拒绝（选定）

记号 `value` 保留**原文**（含 `-` 与 `.`），`num = Number(value)`。

- 精度丢失是 f64 语义：`9007199254740993` → `9007199254740992`、
  `0.99999999999999999` → `1`、`-0.` + `'0'×322` + `1` → `-1e-323`（次正规、非 -0）
  ——全部**接受**，与无符号既有口径同规则（B4 闸门只看有限性）。
- 枚举成员相等语义 = f64 严格相等（B7 现状即此），零 epsilon；spec 注记同步注明
  （§5-D7），消解十进制直觉落差（ADR 0020 Considered Options 5 拒绝特制口径）。
- 判别式键 `String(字面量)`（B6）：负数/小数成键为 `"-1"`/`"0.5"` 字符串，JSON 安全、
  两两互异判定照常；f64 等值的两个字面量（如 `1` 与 `1.0`）键相同 → 判别式候选被
  互异检查排除——与既有重复值语义（`1 | 01`）一致，非新语义。

### D4 — `-0` 解析期 E100：parser 值判定闸门（选定）

在 parser 数字字面量分支（B4）既有有限性闸门旁**并列**增加：

```ts
case 'number': {
  // 既有：超双精度（Number.isFinite 为假）→ E100 锚该数字记号（§7.3 域闸门，不变）
  if (tok.num === undefined || !Number.isFinite(tok.num)) {
    throw this.err(ErrCode.E100,
      '数字字面量超出可序列化数值域（双精度上限 ≈1.8e308；实现值域上限，非方言判定）', tok);
  }
  // 新增：-0 字面量（ADR 0020 决策 3 的 ADR 0021 决策 2 修订句）→ E100，值判定
  if (Object.is(tok.num, -0)) {
    throw this.err(ErrCode.E100,
      '数字字面量 -0 不在可写值域（运行时值域排除 -0，ADR 0021 决策 2）；请写 0', tok);
  }
  return { kind: 'literal', value: tok.num, pos: posOf(tok) };
}
```

- **值判定而非文本判定**：`Object.is(num, -0)` 同时命中 `-0`、`-0.0`、`-00` 与
  小数下溢形态（`-0.` + `'0'×323` + `1` → f64 下溢为 -0；`-0.` + `'0'×400`）。
  文本判定（`raw === '-0'`）会被下溢用例杀死（SA6 §12.9）。用 `=== 0` 或
  `Number.isNaN` 代替 `Object.is` 会把非零次正规 `-1e-323` 误拒（正例红）。
- 两闸门值域不相交（-0 有限、±Infinity 非 -0），先后次序不影响可观察结果；实现可
  合并为单闸门，但 C2 断言按**两类消息**分别钉死（超域消息既有、-0 消息新增）。
- 消息正文措辞不冻结（v1-spec §4 仅冻结 `VFSL-E<编号>: ` 前缀）；上例文案含 `-0`
  并引导写 `0`（Issue 正文与 ADR 0020 决策 3 要求），SA3 可微调措辞，码与锚不可变。
  落地建议（SA2 观察 2 / SA8 复查 §8.5 同见）：示例文案中的「ADR 0021 决策 2」宜改引
  仓内权威——修订后的 v1-spec 注记 7（D7-2 目标文本含 `-0` 条款）或 ADR 0020 决策 3
  修订句——或直接去 ADR 引用；ADR 0021 正文不在本仓，用户可见错误消息引用未随仓
  分发的文档易生困惑。
- 锚 = number 记号起点（`-` 所在列），MODULE 形状下 `-0` @ (1,23)。
- 依据：ADR 0020 决策 3 修订句（初稿「-0 合法 ≡ 0」已被 ADR 0021 决策 2 翻转为
  解析期 E100）；防 `JSON.stringify(-0)→"0"` 在 IR/指纹层静默坍缩（§3 放大因素）。
- **备选（拒绝）**：放行 `-0` 按 f64 与 0 严格相等——ADR 0020 已明文修订否定；
  且与运行时值域（ADR 0021 排除 -0）矛盾，属 H5 已排除假设。

### D5 — 超双精度（含负值）：既有闸门原样覆盖（零新增）

`Number('-' + '9'×309)` = -Infinity → `!Number.isFinite` → E100，消息与无符号版逐字
相同（B4 单一消息字符串）。负号只改符号不改量级判定（SA6 §7）。 `'9'×308` /
`'-'+'9'×308` 有限 → 接受。既有 sentinel（B16）维持绿。

### D6 — IR / derived / validate / codegen / 投影：零语义改动（选定）

- IR 类型族零新增（`literal.value: string | number` 既有；负/小数只是新的 number 值）
  ⇒ ADR 0020 决策 5：**既有语义指纹全部不变**；新文本得到新指纹（v1 方案内的新值，
  见 §6「D2 指纹升级触发器」裁定）。
- `enumContains` 的 `===`、`valueOf` 的 enum 折叠、`String(number)` 投影、判别式
  `String` 键、readData 按标量下钻——全部为现状语义（B6/B7/B8），对新值天然正确。
- codegen 对 `0.0000001` 发射 `1e-7`：合法 TS、值等价；不要求 VFSL 回读（非目标）。
- **备选（拒绝）**：为负/小数增加 IR 归一化层或 codegen 记法特判——违反
  vfsl-codegen AGENTS「不得在生成器里重新推导 VFSL 语义」且无必要（SA6 E5）。

### D7 — 规范文档与实现同 PR（ADR 0020 决策 10）：六处编辑 + 扩充陈述面审计

只改 #314 辖域内的**六处**陈述（B13/B14；iteration 2 为五处，SA2 F1 增补第六处），
**不预写** Int/Range 的 §3 保留名 / §8 例外条款 / 交叉白名单四例（属各自 issue，见非目标）：

1. `docs/vfsl/v1-spec.md:63` EBNF：
   `NumberLiteral = [ "-" ], digit, { digit }, [ ".", digit, { digit } ] ;`
   （该候选文本已经 SA6 E4 送 `tests/acceptance/vfsl_spec_acceptance.py` 的
   EbnfValidator 验证 0 错误；与现行 EBNF 的 `[ … ]` 可选记法风格一致。）
2. 注记 7（`:83-84`）改写为：可选负号 + digits + 可选小数部；负号/小数点两侧 digits
   必填且负号须紧邻（`裸 -`、`- 1`、`.5`、`1.` → E100）；指数记号与其他进制不做
   （`1e3`、`1.5E-2` → E100）；字面量按 IEEE-754 双精度解释与归一（举例
   `9007199254740993` ≡ `9007199254740992`、`0.99999999999999999` ≡ `1`、前导零合法）；
   枚举成员相等语义为 f64 严格相等；超双精度（含负值）E100（实现值域上限，非方言
   判定）；`-0` 字面量（含值为 -0 的下溢形态）E100、引导写 `0`（ADR 0021 决策 2）。
3. 微示例（`:118`）：`type C = -1 | 1;` 从非法块移除，同时在合法块增补
   `type Level = -1 | 0.5 | 2;` 一行（两块一删一增、意图对仗保持）；非法块保留
   A/B/D 三例。已核验无机检依赖两个微示例块的行数（python 脚本只取首个代码块；
   M4 Suite D 只读 §5/指南 §7–§8，不含 §2 微示例）——删 C 行本身改变非法块行数，
   iteration 2 「行数结构不变」的措辞自相矛盾，已废弃（SA2 观察 5）。spec §5/§10 与
   机检面（章节标题、EBNF LHS/终元、§4 禁止清单六项、信封、附录）均不受这些编辑
   影响；§5 不动 ⇒ M4 文档锚测试（Suite D）不动。
4. E100 码表行（`:358`）：越界示例清单中「负数 / 小数字面量」移除，代之以
   `-0 字面量`、`.5` / `1.` 形态、指数记号（表格单元格内避免未转义 `|`，用 `/` 分隔）。
5. `docs/vfsl/schema-authoring-guide.md:145` 改写为同口径一句（支持可选负号与十进制
   小数；负号须紧邻；`.5` / `1.` / 指数记号 / `-0` E100；小数按 f64 严格相等）；§6
   示例块可选择性增补 `type Level = -1 | 0.5 | 2;`（可选，非必须）。
6. **`docs/vfsl/schema-authoring-guide.md:216`（「v1 语法护栏」构造白名单句——SA2 F1
   增补的第六处）**：句中「字符串或整数文字」改为「字符串或数字文字（可选负号与
   十进制小数；负号须紧邻数字）」。整句目标文本：

   > 只使用以下构造：类型别名、封闭对象、可选字段、原始类型、字符串或数字文字
   > （可选负号与十进制小数；负号须紧邻数字）、联合、数组、`Record`、六个标准标记
   > 和注释。

   「数字文字」与 `:145`、spec 注记 7 同口径（NumberLiteral 的中文指称，涵盖负数与
   小数形态）；句中其余构造项与「六个标准标记」表述零变化。该句距 `:145` 仅 71 行、
   与实现改动同文件同 PR（ADR 0020 决策 10），是构造白名单的规范陈述——不修订则
   读者会据它判定 `type Level = -1 | 0.5 | 2;` 越出 v1，与拓宽后的实现直接矛盾。

#### D7-审计 — 规范文档陈述面审计（扩充口径，iteration 3 重审）

**方法论修正（F1 根因）**：iteration 2 仅用单一 grep 模式「无符号」审计全仓，该模式
结构性探不到 `:216` 的「整数文字」式表述。本次把模式组扩为
`无符号|整数文字|数字字面量|负数|小数|负号|十进制|字面量|NumberLiteral|digit`（并对
`整数`/`integer`/`[0-9]` 交叉复核），范围 `docs/**/*.md` 全量（v1-spec、指南、protocols、
integration、phases、agents、why-nomicore、docs/AGENTS.md）。SA1 在 HEAD 29ff10f 上
只读重跑，与 SA2 评审的独立 grep 复核**结论一致**。穷尽结果：

| 类别 | 位置与陈述 | 处置 |
| --- | --- | --- |
| **矛盾陈述——须同 PR 修订，穷尽恰六处** | v1-spec `:63`（EBNF）、`:83-84`（注记 7）、`:118`（微示例 C 行）、`:358`（E100 码表行）；guide `:145`、`:216`（护栏白名单句） | 六处全入 §9 ALLOW LIST，目标文本见上 1–6 |
| 同文件一致面，不改 | v1-spec `:55`（`LiteralType = StringLiteral \| NumberLiteral`，成员**种类**仍两类）、注记 8（`:85-89`：联合字面量成员冻结为字符串/数字两类——负数/小数仍是数字字面量，种类面不受拓宽影响）、`:37`（`digit` 词法元符号）、`:386`（Ident 词法）、`:495`（信封 `version` 整数） | 与拓宽一致或无关，零编辑 |
| 其他文档一致/无关命中，不改 | guide `:70`（`<domain>@<digits>` source id）、`:184`/`:207`（JSDoc 领域示例「非负整数」——字段语义示范，非文法约束）；`docs/integration/hub-peer-deployment.md:136`（retention 配置整数）；`docs/integration/external-project-vfsl-codegen.md:404/:415`（TS 路径字面量语义）；`docs/protocols/instance-replication-v1.md` 其余「整数/十进制」命中（wire 编码与配置） | 配置/TS 语义/wire 编码，非 VFSL 文法契约 |
| 排除：非规范陈述 | `docs/protocols/instance-replication-v1.md:506`「无符号 64-bit」（WS ping 关联凭据编码）；`docs/why-nomicore.md:71-81`（动机叙事散文） | wire 凭据与叙事文本，不陈述字面量文法契约 |
| 排除：ADR 史料句 | `docs/adr/0020:10-11`（决策制定前的现状引述「schema 文本侧则只有无符号十进制整数字面量」）；ADR 0010/0014 的「十进制」（序列/日志编码） | ADR 是 append-only 决策记录，`docs/adr/**` 在 DENY LIST；史料句描述决策前状态，不随实现改写 |

**修订后验收判据（并入 C6）**：以同一扩充模式组对 `docs/` 重跑 grep（排除
`docs/adr/`），**不再存在**与拓宽矛盾的字面量限制陈述——人工评审（六处目标文本逐句
核对）+ grep 机检证据双确认。

---

## 6. 复现和根因承接 + SA8 约束落实

### 复现和根因承接

| 上游事实（SA6 契约） | 证据位置 | 设计响应 |
| --- | --- | --- |
| 正例矩阵全红：`-1`/`0.5`/`-0.5`/`00.5`/舍入形态/边界形态在所有类型位置 E100 @ 首字符 | 契约 §5（P1/P4/P6 双跑逐字节一致） | §5-D1/D2 扫描算法覆盖全部位置（全局规则无上下文特判） |
| 下游链已具备能力（手工 IR → evaluate → validate → codegen 全绿；无符号等价矩阵 HEAD 全绿） | 契约 §5「下游链」、§9 E1/E3/E5 | §5-D6 零改动结论及其依据 |
| 负例对照全绿须保持：`.5`/`1.`/`1e3`/`1..5`/`-`/`- 1`/`-/*c*/1`/`-.5`/`--1`/`-0` 家族/超域 | 契约 §6 | §5-D1/D2/D4/D5 的分支条件与锚位推导；C2 钉死 |
| 已登记锚位变化（唯一一处）：`-1e3` 锚从 `-`@(1,23) 移到 `e3`@(1,25)，与 `1e3` 同构 | 契约 §6 末段、H4 | §8 边界表 `-1e3` 行；C2 断言按 (1,25) 钉死，禁止特判拉回 |
| `-0` 家族目标行为：E100 @ (1,23)、消息含 `-0` 且引导写 `0`、**值判定** | 契约 §6/§9 E2/E6 | §5-D4 |
| f64 归一矩阵（`-9007199254740993`→`-9007199254740992` 等） | 契约 §9 E2 | §5-D3 |
| 放大因素：`JSON.stringify(-0)→"0"` 坍缩 | 契约 §8 | §3、§5-D4（解析期拒绝使 -0 不可达 IR） |
| 基线指纹/生成物哈希与门禁全绿 | 契约 §4 | §12 C5 钉死同值 |
| **SA6 影响面清单的补充（非矛盾）**：SA6 §10「必须修改」仅列 `parse-vfsl-errors.test.ts:58`；本设计源码审计发现 `parse-vfsl-r3-regression.test.ts` 另有 **3 处断言**（B15）以 `type A = -1;` 为 E100 载体，拓宽后同样语义翻转（→E310@(1,1)） | 本设计 B15（grep 全仓 VFSL 文本级 `-` 用法仅此 4 处断言） | §9 文件范围 ALLOW LIST 增列该文件，§9-T2 给出保锚位载体替换方案（`-1` → `- 1`，锚列不变） |
| **B-补 2（契约目标表勘误，非 HEAD 事实矛盾）**：契约 §5/§12.2 把 `type ROOT = YMap<{ v: -1 & string }>;` 的目标锚写为 (1,25)。锚机制为 `dispatchContinuation` 锚 `&` 记号（`parser.ts:388-393`），锚位随首成员字符数右移：本设计在未改动 HEAD 上的窄只读探针实测 `1 & string` → E100@(1,25)、`12 & string` → E100@(1,26)、`Record<1, string>` → E306@(1,30)。故 `-1 & string`（`-1` 占 23-24 列，`&` 在 26 列）的正确目标锚为 **(1,26)**；(1,25) 系沿无符号形误抄 | `parser.ts:388-393`（锚 `&`）；本设计探针（`parseVfsl` 三例，HEAD 29ff10f，输出 `E L1:C25`/`E L1:C26`/`E L1:C30`） | §8 边界表按 (1,26) 钉死；C1 全局位置断言落测试时须用 (1,26)，若按契约原文 (1,25) 落地将对正确实现产生**假红** |

### SA8 约束落实（任务前置 SA8 产物未生成，以下为替代证据的硬约束；设计后 SA8 冲突复查已存在且 `clear`，见头注与 §15）

| 约束 | 来源 | 设计位置 | 处理方式 | 需设计后冲突复查 |
| --- | --- | --- | --- | --- |
| 错误码、issue 顺序、行列定位、指纹输入是兼容性行为不得变更；畸形输入返回判别结果不抛出 | `packages/vfsl/AGENTS.md` | §5-D4/D5、§8 | 零新增错误码（-0 复用 E100，条件属「首次发布前评审修订」范畴且由 ADR 0020 显式裁决）；全部锚位保持（唯一登记变化 `-1e3`） | 否 |
| IR/derived 环境无关、可 JSON 序列化纯数据 | 同上 | §5-D6 | IR 类型族零新增；-0/±Infinity 解析期拒 ⇒ 可达 IR 值域 JSON 忠实 | 否 |
| codegen 输出确定、逐字节稳定；`generate --check` 检出陈旧生成物；不得重推导 VFSL 语义 | `packages/vfsl-codegen/AGENTS.md`、ADR 0005 | §5-D6、§12 C4/C5 | codegen 零改动；`domains/vfs3-assets/generated.ts` 逐字节不变 | 否 |
| 行为变化须同步更新所有陈述该契约的规范文档；不得发明实现行为 | `docs/AGENTS.md`、ADR 0020 决策 10 | §5-D7（六处编辑）+ §5-D7-审计 + §12 C6 | spec 四处 + 指南两处（`:145`、`:216` 护栏白名单句）；文档陈述面审计已从单一「无符号」模式扩为 `无符号\|整数文字\|数字字面量\|负数\|小数\|负号\|十进制\|字面量\|NumberLiteral\|digit` 模式组重审，docs/ 内矛盾陈述穷尽清单**恰六处**（SA1 iteration 3 重跑 + SA2 独立复核一致；instance-replication「无符号 64-bit」为 wire 凭据、ADR 0020:10-11 为史料句，均排除） | 否 |
| ADR 0020 决策 3（文法、紧邻、负例、f64、超域、-0 E100）、决策 5（指纹不变）、决策 7（codegen `number`）、决策 10（同 PR、指数不做） | `docs/adr/0020-vfsl-number-constraints.md` | 全文 | 逐条落实；决策 9 supersede 标注（ADR 0021）按修订句执行 | 否 |
| **D2 指纹升级触发器**：`fingerprint.ts` 头注登记「**v2 方言**若放开数值字面量语法 ⇒ semantic 域文档必须重审并升 v2 前缀」 | `fingerprint.ts:7-13`、`wiki/raw/task_issue-72_design.md` §6.3（SA6 §15-U2 判为决策悬置） | §13-R3、§15 | **裁定：不触发**。触发器条件是「**v2 方言**放开数值字面量语法」——ADR 0020 决策 1 明确不引入 v2、以 §8「只增不改」在 v1 内落地纯拓宽；semantic 域文档**形态**（`{domain,lang,version,module}` canonical JSON 结构）零变化，IR 类型族零新增；触发器所防的跨实现/坍缩风险被三道解析期闸门（-0 值判、有限性、指数不做）封死。故保持 `sha256:v1:`、既有指纹零漂移。**该裁定触碰已登记契约触发器，按 skill 触发条件提交 `requiresConflictRecheck: true`**（§15） | **是** |
| CI 门禁：typecheck / `--typecheck.only` / 6 分片 / `generate --check` | `.github/workflows/ci.yml`、SA6 §14 | §12 C7 | 新测试文件经 vitest include 自动入片；`.test-d.ts` 由 typecheck 作业执行 | 否 |

---

## 7. 接口、状态机与数据流

### 接口变化

**公共 API 零变化。** `parseVfsl`/`evaluate`/`validateLogicalSnapshot`/
`compileSchemaEnvelope`/`FileSchemaSource`/`generateProjection` 的签名、返回类型、
错误联合全部不变；`tokenize`/`Token` 本就是内部结构（B10）。唯一「接口性」变化是
**可解析文本集合**扩大（原 E100 文本 → ok:true），及其在 IR `literal.value` 上新增
可达 number 值（负数、小数）——两者都是纯拓宽方向：既有全部文本的**错误码与锚位**
零收窄、零改义（既有负例仍 E100 且锚位一致，唯一登记锚位变化 `-1e3`，见 §8）。
**自然 fallout（已登记、非兼容性漂移，SA2 观察 4）**：原 E100 文本族中存在码+锚不变、
消息正文变化的用例——如 `1 -1`/`1-1`，错误从「未知记号: -」变为
「期望 ';'，实际 数字字面量 '-1'」（码同 E100、锚同列，正文按 v1-spec §4 不冻结）；
`Record<-0, string>` 将在 parse 期先命中 D4（E100）先于 E306。均为「全局规则、不特判」
的必然后果，B15 审计面内无既有测试断言它们，故不构成验收义务（如需可作 C2 可选
增补，非必须）。

### tokenizer 数字分支目标算法（伪代码，替换 B1 分支）

```
入口条件: isDigit(cp) 或 (cp === '-' 且 isDigitCodeUnit(text.charCodeAt(i + 1)))
  注: isDigitCodeUnit 对 NaN（i+1 越界）返回 false ⇒ 末位 `-` 走未知字符路径

startLine/startCol 记当前行列
raw = ''
if cp === '-': raw += '-'; i += 1; column += 1        // 负号：1 列，记号起点
while i < len 且 isDigit(text 码点): raw += 该数字; i += 1; column += 1   // [0-9]+
if text[i] === '.' 且 isDigitCodeUnit(text.charCodeAt(i + 1)):            // 两侧 digits 必填
  raw += '.'; i += 1; column += 1
  while i < len 且 isDigit(text 码点): raw += 该数字; i += 1; column += 1  // 小数部 [0-9]+
emit({ kind:'number', value: raw, num: Number(raw), line: startLine, column: startCol })
```

- 记号不可跨行（分支内字符全为 ASCII 数字/`.`/`-`，遇 `\n` 即停）。
- 列记账按码点、每字符 1 列，与既有分支一致（数字字符皆 ASCII 单码元）。
- 文件头注释（`:200` 分支标题「[0-9]+，无符号十进制整数」）与未知字符分支注释
  （`:276` 例举 `-`、`.`）同步改写：未知字符示例改为「未随 digit 的 `-` / `.`」口径。

### parser 字面量分支目标算法

见 §5-D4 代码块（既有有限性闸门 + 新增 `Object.is(tok.num, -0)` 值闸门，均锚
`tok`）。`parser.ts:416-417` 的分支注释同步补记 -0 闸门与依据。

### 状态机

无状态机变化：全链同步纯函数、单错误即失败（issues 恰 1 条）、无恢复分支。
词法「延迟错误记号」机制（B3）不变——`-`/`.` 未入数字分支时仍产出 error 记号并
`break scan`，文本序首错胜出语义保持。

### 数据流路线（唯一变化路线：解析期文本 → IR 数值）

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚点 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 字面量值流 | `parseVfsl(text)`（schema 作者文本） | tokenizer number 记号（value=原文、num=f64） | parser 域/‑0 双闸门 → AST literal → IR `{kind:'literal', value:number}` | IR 为内存纯数据（可 JSON 序列化；envelope/semantic 指纹经 canonical JSON） | `evaluate`→derived enum values；`validateLogicalSnapshot`（`===`）；codegen `String(number)`；readData 投影按标量叶 | 新文本 ok:true 且全链端到端可用；非法形态单条 E100 带行列 | 解析期 loud 拒绝，无部分状态、无需清理（纯函数） | C1/C2/C3/C4 |
| 既有 fixture 流 | `FileSchemaSource.load('vfs3-assets@1')` | 无新写入 | IR/derived 形态零变化 | 指纹与 `generated.ts` 逐字节不变（C5 钉死值） | 同上 | 零漂移 | 不适用 | C5 |

无跨进程/持久化边界变化；无缓存键变化（内容哈希输入 = canonical JSON，形态不变）。

---

## 8. 边界与锚位对照表（实现与评审共用）

MODULE(FORM) := `type ROOT = YMap<{ v: ${FORM} }>;`，类型表达式起点 (1,23)。

| 输入形态 | 拓宽后行为 | 锚位 | 机制归因 |
| --- | --- | --- | --- |
| `-1` / `0.5` / `-0.5` / `00.5` | ok，IR literal `-1`/`0.5`/`-0.5`/`0.5` | — | D1/D2/D3 |
| `9007199254740993`（负形同） | ok，literal `±9007199254740992` | — | D3 f64 归一 |
| `0.99999999999999999` | ok，literal `1` | — | D3 |
| `-0.`+`'0'×322`+`1` / `'9'×308`（负形同） | ok，literal `-1e-323` / `±1e+308` | — | D3/D5 |
| `.5` / `1.` / `1..5` / `-.5` / `1.5.5` / `-1.` | E100 `未知记号: .`（`-.5`/裸 `-` 族为 `未知记号: -`） | `.`（或 `-`）所在列 | D2 前看不满足 → 未知字符 |
| `1e3` / `1.5e3` | E100 字段分隔符错，锚 `e3` 记号 | `e3` 起列 | D2 停于非 digit，指数自然 fallout |
| `-1e3` | E100 同上，锚 `e3` | **(1,25)**（登记变化） | `-1` 合法记号 + `e3` 同构 |
| `-` / `- 1` / `-/*c*/1` / `--1` | E100 `未知记号: -` | `-` 所在列 (1,23) | D1 单码元前看，不吞 trivia |
| `-0` / `-0.0` / `-00` / `-0.`+`'0'×323`+`1` / `-0.`+`'0'×400` | E100，消息含 `-0` 且引导写 `0` | 记号起点 (1,23) | D4 值判定 `Object.is` |
| `'9'×309` / `-`+`'9'×309` | E100 `数字字面量超出可序列化数值域…`（消息同无符号版） | (1,23) | D5 既有闸门 |
| `Record<-1, string>` 值位 | E306 | (1,30) 键类型起点 | B12 既有形状规则，非 E100 |
| `type ROOT = -1 \| 0.5;` | E311 | (1,13) 表达式起点 | B12 既有 ROOT 形状规则 |
| `type A = -1;`（无 ROOT） | **E310 @ (1,1)**（旧 E100@(1,10) 消失） | (1,1) | B12；测试载体替换见 §9-T1/T2 |
| `-1 & string` | E100 交叉白名单，锚 `&` 记号 | **(1,26)** | 既有 `dispatchContinuation`（`parser.ts:388-393` 锚 `&` 记号）；SA6 契约目标表写 (1,25) 系沿无符号形误抄，探测证据见 §6「B-补 2」 |

注：表未穷举的 `1 -1` / `1-1` / `Record<-0, string>` 等自然 fallout（码+锚不变、消息
正文变化或错误相位前移，见 §7 登记）不新增验收义务，无既有测试断言。

---

## 9. 文件范围

### ALLOW LIST

| 路径 | 预期改动 | 原因（正文对应） |
| --- | --- | --- |
| `packages/vfsl/src/tokenizer.ts` | 数字分支按 §5-D1/D2 重写（入口条件、负号消费、单 `.` 前看消费、raw 含符号）；`:200` 分支注释与 `:276` 未知字符注释同步改写 | 核心缺口（B1/B2） |
| `packages/vfsl/src/parser.ts` | 字面量分支（`:416-421`）新增 `-0` 值闸门（§5-D4）+ 注释补记 | -0 解析期拒绝（Issue 正文/ADR 0020 决策 3 修订句） |
| `docs/vfsl/v1-spec.md` | 仅四处：`:63` EBNF、`:83-84` 注记 7、`:118` 微示例、`:358` E100 码表行（§5-D7） | ADR 0020 决策 10 同 PR |
| `docs/vfsl/schema-authoring-guide.md` | `:145` 一句改写（§5-D7-5）＋ **`:216`「v1 语法护栏」白名单句「字符串或整数文字」→「字符串或数字文字（可选负号与十进制小数；负号须紧邻数字）」（§5-D7-6，SA2 F1 增补）**；§6 示例增补可选 | ADR 0020 决策 10 + docs/AGENTS「更新**所有**陈述该契约的规范文档」义务——D7-审计确认矛盾陈述恰六处、本文件占两处 |
| `packages/vfsl/test/parse-vfsl-errors.test.ts` | `:58-63` 用例替换（T1） | 语义翻转面（B15/SA6 §10） |
| `packages/vfsl/test/parse-vfsl-r3-regression.test.ts` | 三处载体替换（T2，本设计新增于 SA6 清单） | 语义翻转面（B15 补充） |
| `packages/vfsl/test/parse-vfsl-number-literals.test.ts` | 新建：C1 正例 + C2 负例（§12） | 验收 AC1/AC2/AC3 |
| `packages/vfsl/test/validate-number-literals.test.ts` | 新建：C3 validate 严格相等（§12） | AC1 |
| `packages/vfsl/test/number-literals-fixture-drift.test.ts` | 新建：C5 指纹/生成物零漂移钉死（§12） | AC4 |
| `packages/vfsl-codegen/test/generate-number-literals.test.ts` | 新建：C4 codegen + 真实 tsc 诊断（§12，复用 `tsc-helper.ts`） | AC4 |
| `packages/vfsl-codegen/test/generate-number-literals.test-d.ts` | （可选，建议）类型级正/负例，风格对齐 `generate-discriminated-narrow.test-d.ts` | AC4 加固 |

**T1（parse-vfsl-errors.test.ts:58-63）替换方案**：保留同位 E100 锚，载体由 `-1` 换
`-0`——`parseVfsl('type A = -0;')` → E100 @ (1,10)（列不变：`-` 仍在第 10 列），用例名
与注释改为「-0 字面量被拒（注记 7 / ADR 0021 决策 2），锚记号起点」。负号/小数正例
与 `.5`/`1.`/裸 `-` 负例的完整矩阵由新建 C1/C2 文件承载，不在本文件扩散。

**T2（parse-vfsl-r3-regression.test.ts）替换方案**：三例载体 `type A = -1;` →
`type A = - 1;`（插一个空格）。`-` 不再紧邻 digit → 仍走未知字符 E100
`未知记号: -`，且 `-` 所在列**逐位不变**（(1,16)/(1,17)/(1,16)），R-1 回归意图
（星面字符按码点计列）完整保留；仅用例标题里的 `-1` 字样同步为 `- 1`。断言数值
零改动。

### DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
| --- | --- | --- |
| `packages/vfsl/src/ir.ts` / `evaluate.ts` / `derived.ts` / `validate.ts` / `resolve-schema-at-path.ts` / `semantic.ts` / `shapes.ts` / `resolve.ts` / `envelope.ts` / `schemasource.ts` / `index.ts` / `errors.ts` / `pattern.ts` | 下游链 | SA6 E1/E3/E5 已证现状语义对新值正确；改动即引入指纹/行为漂移风险（§5-D6） |
| `packages/vfsl/src/fingerprint.ts` | 指纹构造 | `FINGERPRINT_PREFIX`/域文档形态是 v1 冻结输入（D2 标记）；升版须另立 ADR（§6「D2 指纹升级触发器」裁定） |
| `packages/vfsl-codegen/src/**` | 生成器 | 输出逐字节稳定契约；`String(number)` 现状即正确（B8、SA6 E5） |
| `domains/vfs3-assets/**`（含 `schema.vfsl`、`generated.ts`） | 参考 fixture | 零漂移红线（AC4、C5、`generate --check`、`domains-scaffold` 门禁） |
| `docs/adr/**` | 决策记录 | ADR 0020 决策 3 已裁决本设计；无新决策产生；若 owner 对 §6「D2 指纹升级触发器」裁定异议，另立 ADR 后再动 |
| `docs/vfsl/v1-spec.md` 的 §3/§5/§7/§8/§10 及 §2/§4 未列出的行 | 规范其余面 | Int/Range 保留名、交叉白名单四例、§8 例外条款属各自 issue；§5 动了会破坏 Suite D 文档锚 |
| `tests/acceptance/**` | 规范机检脚本 | G4/G5/G6 现行结构合法（SA6 §4/§12.7）；候选 EBNF 已验证可通过，脚本本身无需改 |
| `vitest.config.ts` / `.github/workflows/**` / `scripts/**` | 发现与门禁 | 新测试文件自动入片（B17、SA6 §14） |
| `wiki/raw/**`（除本设计产物） | 流水线证据 | Host/其他角色产物只读 |

---

## 10. 错误、恢复、并发和幂等

- **错误语义**：零新增错误码。新增可观察错误条件一个（`-0` 字面量 → E100，锚记号
  起点，消息含 `-0` 且引导写 `0`）；既有 E100 消息两条（未知记号、超域）原文不变。
  message 前缀冻结格式（`VFSL-E100: `）不变；单错误即失败（issues 恰 1 条）不变。
- **失败即诚实**：非法形态全部解析期 loud 拒绝并携带行列；不存在静默 fallback、
  部分解析或宽松接受路径（分支条件穷尽：要么完整 `-?digits(.digits)?` 记号，要么
  既有未知字符/语法错路径）。
- **恢复/重试/回滚**：纯函数无状态可回滚；实现 PR 整体 revert 即完全回退（无持久化、
  无 wire、无生成物变化）。
- **并发/幂等**：全链同步、确定、无 IO/时钟/共享状态（SA6 §7 双跑 diff 为空）；
  同文本恒同结果，天然幂等。
- **资源**：扫描仍是 O(文本长度) 单遍、无回溯（每字符至多一次前看）；403 字符长
  字面量实测无异常（SA6 §7）；不引入正则引擎或预算路径。

---

## 11. 调用方影响矩阵

| 调用方 | 当前处理 | 设计后处理 | 所需改动 | 证据 |
| --- | --- | --- | --- | --- |
| `parseSchemaEnvelope` / `getCompiled` / `compileSchemaEnvelope`（vfsl 内编排） | 透传 parseVfsl 结果 | 同——原 E100 文本变 ok:true，其余不变 | 无 | `index.ts:193-208`、`getCompiled` 缓存键=canonical JSON（形态不变） |
| `FileSchemaSource`（schema 文件装载） | 读文件→envelope→编译 | 同；`vfs3-assets@1` 文本不含新形态 ⇒ 零漂移 | 无 | C5 钉死 |
| `packages/vfsl/src/schema-check-cli.ts` | 包装公共接缝 | 同 | 无 | 包内 CLI，透传（iteration 2 误写 `packages/vfsl/schema-check-cli.ts`，SA2 观察 1 勘误） |
| `doc-runtime` / `namespace-registry` / apps（消费 derived + validate） | enum `===` 判定、判别键 String | 负/小数枚举成员按 f64 严格相等工作；判别键 `"-1"`/`"0.5"` 合法且互异 | 无（仅在 schema 使用新形态时出现新值，纯加法） | B6/B7；SA6 E1 |
| `vfsl-codegen`（`generateProjection` / CLI / `--check`） | `String(number)` | 发射 `-1 \| 0.5`、`1e-7` 等合法 TS；既有域零变化 ⇒ `--check` 绿 | 无 | B8；SA6 E5（tsc 0 诊断） |
| 生成物 TS 消费方（`PathSchema<-1 \| 0.5, 'leaf'>`） | — | 负/小数字面量类型是合法 TS；写路径类型随之可用 | 无 | SA6 E5、C4 `.test-d.ts`（可选） |
| 断言旧行为的测试（B15 4 处断言 / 2 文件） | 期望 E100 | 期望翻转（E310 或 ok） | T1/T2 载体替换（§9） | 本设计 B15 补充审计 |
| 文档读者（spec/指南） | 「仅无符号整数」/「字符串或整数文字」 | 拓宽后口径 + f64 语义注记 | §5-D7 六处编辑（spec 四处 + 指南 `:145`/`:216` 两处） | B13/B14（含 SA2 F1 第六处） |

无未覆盖调用方；无「调用方应自行适配」项——公共签名与错误联合零变化。

---

## 12. 验收与验证映射

契约文件锚点：`wiki/raw/task_issue-314_sa6_contract.md` §12（C1–C7 全量断言矩阵、
§12.9 突变敏感性矩阵）。本表给需求 → 证据映射；SA3 落地、SA4 复核，本设计不指定执行者。

| 需求或风险 | 现有证据 | 所需行为测试或动态场景 | 预期观察 |
| --- | --- | --- | --- |
| AC1 正例解析（C1） | 契约 §5（HEAD 全红） | `packages/vfsl/test/parse-vfsl-number-literals.test.ts`：MODULE(FORM) 全形态矩阵 + 全局位置矩阵（别名 RHS/对象字段/数组元素/YLeaf/YArray/Record 值位/Record 键位 E306@ (1,30)/交叉 E100@ **(1,26)**——后者为 §6「B-补 2」勘误值，勿按契约原文 (1,25) 落地），断言 ok:true 与 IR 字面量**值** | 实现前红（ok:false）、实现后绿；值断言按 f64 归一（`-9007199254740993`→`-9007199254740992` 等） |
| AC2 负例锚位（C2） | 契约 §6（HEAD 绿） | 同文件 `describe('invalid number forms')`：码 + 行列双钉（`.5`@23、`1.`@24、`1e3`@24、`-1e3`@**25**、`-`@23、`- 1`@23、`-/*c*/1`@23、`-.5`@23、`--1`@23、`-0` 家族@23 消息含 `-0` 且引导 `0`、下溢值判定两例@23、超域两例@23 前缀「超出可序列化数值域」） | 实现前后均绿；杀死 §12.9 全部弱实现（宽松正则、吞 trivia、文本判定 -0、`===0` 代 `Object.is`、负值跳过有限闸门） |
| AC1 validate 严格相等（C3） | SA6 E1（手工 IR 绿） | `packages/vfsl/test/validate-number-literals.test.ts`：文本 fixture `type ROOT = YMap<{ v: -1 \| 0.5 \| 2; d: 0.1 \| 0.2 }>;` → derived enum 声明序断言 + 命中/失配矩阵（含 `0.5000000000000001`、`0.1+0.2` 形失配、path 断言） | 实现前红（parse 失败）、后绿；**禁止**断言运行期 -0/NaN 语义（非目标，H6） |
| AC4 codegen（C4） | SA6 E5（tsc 0 诊断） | `packages/vfsl-codegen/test/generate-number-literals.test.ts`：fixture 含 `v: -1 \| 0.5 \| 2; tiny: 0.0000001; neg: -1.5 \| -0.25;` → 生成文本含 `PathSchema<-1 \| 0.5 \| 2, 'leaf'>` 等；写临时 `.ts` 经 `tsc-helper.preEmitDiagnostics` 0 诊断；成员值 `Number(段) === IR 值`；可选 `.test-d.ts` 正/负例（`@ts-expect-error` 反转） | 实现前红、后绿；`1e-7` 记法合法不要求回读 |
| AC4 零漂移（C5） | 契约 §4 基线值 | `packages/vfsl/test/number-literals-fixture-drift.test.ts`：`FileSchemaSource.list() === ['vfs3-assets@1']`；envelope/semantic 指纹全值钉死（§4 两串）；指纹以 `sha256:v1:` 开头；`generate --check` exit 0 | 实现前后均绿；任何 IR 键序/前缀升版/生成物再生成即红 |
| AC5 文档（C6） | 契约 §13（部分红）＋本设计 §5-D7-审计（iteration 3） | `python3 tests/acceptance/vfsl_spec_acceptance.py` exit 0（G4 候选文法已验证）；人工评审项 = 注记 7 / 微示例 / E100 码表行 / 指南 `:145` / **指南 `:216` 护栏白名单句（SA2 F1 增补）**，逐句对照 §5-D7 六处目标文本；机检补充：以 §5-D7-审计 的扩充模式组对 `docs/`（排除 `docs/adr/`）重跑 grep | 脚本 22/22 绿；文档与实现无矛盾陈述；扩充 grep 后 docs/ 内不再存在与拓宽矛盾的字面量限制陈述 |
| AC5 门禁（C7） | 契约 §4（全绿基线） | `pnpm test`、`pnpm typecheck`、`pnpm generate --check`、`git diff --check`、焦点红灯→绿序列（契约 §12.8 命令逐条） | 全 exit 0；焦点文件实现前红在目标断言、后绿；负控前后均绿 |
| 回归翻转面（本设计补充） | B15 | T1/T2 载体替换后，`parse-vfsl-errors.test.ts` 与 `parse-vfsl-r3-regression.test.ts` 焦点运行 | 两文件全绿；R-1 三锚位数值不变 |

---

## 13. 风险、回滚和残余问题

| # | 风险 | 等级 | 缓解 | 残余 |
| --- | --- | --- | --- | --- |
| R1 | 遗漏其它以负/小数字面量为 E100 载体的既有断言 → 实现后测试意外红 | 中 | 本设计已全仓 grep VFSL 文本级 `-` 用法（B15：恰 4 处断言 / 2 文件，均已入 ALLOW LIST）；C7 全量 `pnpm test` 兜底 | 低——若仍有漏网，红灯暴露的是断言载体而非语义，按 T1/T2 同型处置并记录 |
| R2 | `-0` 用文本判定实现 → 下溢形态漏拒或次正规误拒 | 高（若发生） | C2 下溢判别对（`'0'×322` vs `'0'×323`）+ 正例 `-1e-323` 双向钉死（§12.9） | 无 |
| R3 | D2 指纹触发器解释分歧：owner 若按字面「放开数值字面量语法即触发」裁决升 v2 | 中 | 本设计按「v2 **方言**」限定词 + ADR 0020 决策 1/5 裁定不触发并钉死零漂移（§6）；**提交冲突复查**（§15） | 复查若翻案 ⇒ 需另立 ADR + 全仓指纹重估（破坏性），本设计的 C5/前缀部分随之失效重开 |
| R4 | `-1e3` 锚位变化被实现者用特判「修正」回 `-` 锚 | 中 | C2 钉死 (1,25)；契约 H4 已排除该做法（违反全局规则） | 无 |
| R5 | spec 编辑波及机检脚本或 Suite D 文档锚 | 低 | §5-D7 已核对：脚本机检面（章节/EBNF LHS/终元/禁止清单六项/信封/附录）与 §5 M4 锚均不在编辑范围；候选 EBNF 已过 EbnfValidator | 无 |
| R6 | 文档与实现不同 PR 落地 → main 出现「规范已改、代码未跟」中间态 | 中 | C6/AC5 将 spec 四处 + 指南两处（`:145`、`:216`）共**六处**编辑全部纳入本任务 ALLOW LIST 与验收（ADR 0020 决策 10；SA2 F1） | 无 |
| R7 | 重复值联合（`1 \| 1.0`）或判别键字符串化引出的语义疑问 | 低 | 既有语义（f64 等值即同值、判别键互异检查），非本任务新规则；设计已注明（§5-D3） | 纯文档性，无需动作 |
| R8 | 实现者顺手「归一化」生成器记法或 IR 形态 | 中 | DENY LIST + C4/C5 双钉（tsc 诊断 + 指纹） | 无 |

**回滚**：单 PR revert 即完全回退（无迁移、无持久化、无 wire、无生成物差异）。
**任务内必要条件**：T1/T2 测试载体替换是**本任务必要交付**（不是 follow-up）——不做
则 C7 全量测试必红。
**明确的 follow-up（非本任务）**：Int/Range 语法（各自 issue）；指数记号纯拓宽；
运行时 number 基线（issue #312/ADR 0021）；ADR 0021 正文归档不在本仓（U1）。

---

## 14. 评审修订映射

评审输入：`wiki/raw/task_issue-314_sa2_review.md`（iteration 0，verdict **reject**：
1 × MAJOR F1、0 × BLOCKER、7 项非阻塞观察）。评审确认技术核心（D1–D6、锚位矩阵、
T1/T2、C1–C7、B15 与 (1,26) 勘误）逐条攻击核验成立——本修订**原样保留**全部技术
决策，仅落实 F1 与纯准确性观察项：

| Finding / 观察 | 修订位置 | 处理结果 |
| --- | --- | --- |
| **F1（MAJOR）**：规范文档同步面遗漏第六处陈述——`schema-authoring-guide.md:216`「v1 语法护栏」以「字符串或整数文字」表述同一契约，位于设计已编辑的同一文件内（距 `:145` 71 行）；iteration 2 的 D7/ALLOW 仅列 `:145`，§6 行 4 与 SA8 复查 §3 行 11 均以单一「无符号」grep 声称「恰五处」——模式不完备致审计遗漏；违反 docs/AGENTS「更新所有陈述该契约的规范文档」与 ADR 0020 决策 10，且令 C6「文档与实现无矛盾陈述」判据失败 | (1) §5-D7-6：`:216` 目标文本（「字符串或数字文字（可选负号与十进制小数；负号须紧邻数字）」）；(2) 新增 §5-D7-审计：模式组 `无符号\|整数文字\|数字字面量\|负数\|小数\|负号\|十进制\|字面量\|NumberLiteral\|digit` + 穷尽六处清单 + 排除项逐类登记；(3) §9 ALLOW guide 行增列 `:216`；(4) §2-B14、§6 行 4、§12-C6、§13-R6、头注同步改写 | **已落实**。SA1 已在 HEAD 29ff10f 只读重跑扩充 grep，与 SA2 独立复核一致：矛盾陈述恰六处、无第七处；C6 人工评审项含护栏句，并以扩充 grep 为机检证据 |
| 观察 1（非阻塞）：§11 行 3 证据路径笔误 | §11 调用方矩阵行 3 | 已勘误：`packages/vfsl/src/schema-check-cli.ts` |
| 观察 2（非阻塞）：D4 示例消息引用仓外 ADR 0021 | §5-D4 消息措辞 bullet | 已增落地建议：改引仓内权威（修订后 v1-spec 注记 7 / ADR 0020 决策 3 修订句）或去 ADR 引用；码与锚不可动 |
| 观察 3（非阻塞）：C5 与 `parse-vfsl-union-member-docs.test.ts:34` 既有指纹 pin 轻微重叠 | §12 C5（设计不改动） | 登记不改：任务域独立哨兵符合仓惯例（sentinel 先例，SA2 §10 亦裁「保留」）；若 fixture 将来合法演进，两处需同步——供 SA4 复核与后续演进知悉 |
| 观察 4（非阻塞）：§7「无既有调用方文本被收窄或改义」措辞偏宽；自然 fallout 未登记 | §7 接口变化段 + §8 表后注 | 已收窄为「码+锚不变」口径，并登记 `1 -1` 族消息正文变化与 `Record<-0, string>` 相位前移为自然 fallout（无既有断言、非验收义务） |
| 观察 5（非阻塞）：§5-D7-3「非法块保留 A/B/D 三例，行数结构不变」自相矛盾 | §5-D7-3 | 已改写：C 行移除 + 合法块增补 `type Level = -1 \| 0.5 \| 2;` 一删一增；明确无机检依赖微示例块行数 |
| 观察 6（非阻塞）：C1 全局位置表在「ok:true」表头下混列 E306/E100 期望 | §12 C1 行（断言集不改动） | 登记为 SA3 落地指引：按期望结果分组断言，避免表头误读；每行期望值已显式，无安全风险 |
| 观察 7（非阻塞）：T1 与 SA6 §10 建议的重组偏离 | §9-T1（维持原方案） | 维持已登记偏离：`-0` 一锚留守 + 其余移入 C2 双钉矩阵，完整性不弱化、文件意图保持；本表再登记供 SA4 复核知悉 |

---

## 15. 是否需要设计后 ADR 冲突复查

**结论：需要（`requiresConflictRecheck: true`）**，理由收敛为三点：

1. **触碰已登记的指纹契约触发器**（`fingerprint.ts:7-13` D2-CONTRACT-MARKER 与
   `task_issue-72_design.md` §6.3 升级触发器清单；SA6 §15-U2 亦判为「需 SA1/ADR
   owner 明示」的决策悬置）。本设计裁定其条件（「**v2 方言**放开数值字面量语法」）
   在 ADR 0020 决策 1（不引入 v2、§8 只增不改例外内纯拓宽）下不成立，故保持
   `sha256:v1:` 且既有指纹零漂移；该裁定是对冻结面登记条款的解释性适用，应由
   冲突复查确认，而非由设计静默生效。
2. **编辑 v1-spec 冻结文法面**（§2 EBNF / 注记 7 / §4 E100 码表行）**及指南护栏句
   （`:216`，iteration 3 增补）**。修订本身有 ADR 0020 决策 3 + §8「只增不改」授权
   （指南两处属决策 10 文档同步义务），但属「触碰 ADR 冻结面」类目，按规则应复查
   确认纯拓宽（无收窄、无错误码条件改写——`-0` 条件为 ADR 0021 决策 2 显式引入的
   新条件且发生在首次发布冻结轮次语义内，同样宜经复查背书）。
3. **一处已登记锚位变化 + 既有断言语义翻转**（`-1e3` 锚迁移；4 处测试断言翻转，
   其中 3 处为 SA6 影响面清单遗漏、由本设计补充）。锚位是兼容性行为（vfsl AGENTS），
   变化清单应经复查确认穷尽。

iteration 3 补充：F1 修订把文档编辑面从五处扩为六处（同一决策 10 义务内的完备性
修正，未新增决策语义）；SA8 iteration 0 复查报告 §3 行 11 / §6.1 的「恰为此五处」
声明据此**作废**，下一轮冲突/实现复查应把「六处穷尽清单 + §5-D7-审计 扩充 grep
证据 + 指南 `:216` 护栏句落地」纳入核对范围。SA8 报告其余裁决（14 项对照、D2
触发器不触发、(1,26) 勘误成立、`clear` 结论）不受本修订影响。

普通局部实现细节（扫描算法、消息措辞、测试文件组织）不要求复查。
