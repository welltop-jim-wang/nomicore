# SA2 攻击评审报告 — ROOT 约定实现：E310/E311（Issue #19）

**Date**: 2026-08-19
**Verdict**: pass

> 评审对象：`wiki/raw/task_vfsl-root-convention_design.md`（SA1，2026-08-19）。
> 任务类型：功能开发。评审方式：全新视角独立攻击——SA1 全部「源码引用级核对」声明由
> SA2 逐条重查源码 / 规格 / 测试复现，关键实测声明由 SA2 独立重跑（见「协议假设依据审查」）。
> 本报告不修改任何生产代码、测试代码与 SA1 设计文档。

---

## 评审方法与验证深度

SA2 本轮实际执行的独立核验（非转抄 SA1）：

1. **源码全读**：`shapes.ts` / `semantic.ts` / `parser.ts` / `errors.ts` / `index.ts` /
   `tokenizer.ts`（BOM 位）。SA1 §0/§1/§2/§3/§5 的全部行号引用与行为声明逐条比对。
2. **规格与 ADR 全读**：`v1-spec.md` §3（ROOT 约定）/ §4（判定顺序 + 21 码总表）/
   §9.2（BOM）/ §10（修订版 fixture）；`adr/0003` §2/§5。红灯测试 34 用例与锚点逐字符复算。
3. **存量 8 测试文件全读**：逐用例核对 §6 对齐清单的计数、断言形态、append 策略安全性。
4. **独立重跑**：fuzz PRNG 模拟（`/tmp/sa2-fuzz-sim.mjs`，逐字复刻
   `parse-vfsl-sa7-supplementary.test.ts` 的 mulberry32 + 记号汤循环）。
5. **遗漏面扫描**：全仓 `*.test.ts` 清单（9 文件 = 8 存量 + 红灯，无隐藏测试面）、
   `analyze`/`collectShapeCandidates` 全部调用方、`@nomicore/vfsl` 外部消费者（无）、
   `package.json` 版本与依赖字段现状。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| 1 | LOW | §6.7 fuzz fixture 变异用例的确定性论证 | 论证前提过宽：SA1 称「每条 fixture 至少贡献 1 个 ok:true（完整 fixture 含 ROOT）」。实测 **FIXTURES 7 条中 2 条整条本就 ok:false**——第 6 条 `type Doc = YXmlFragment<{ assets: Record<string, M>; … }>` 引用未声明名 `M` → E301；第 7 条 `type B = YPlainArray<A>;`（A 含 YMap）→ E307（经别名间接引入同步标记）。此二者任何前缀截断要么语法残缺要么缺 ROOT（→E310），**贡献 0 个 ok:true**。结论本身仍成立：其余 5 条完整 fixture + ROOT 确定性 ok:true，`okTrue > 0` 不依赖种子——但依据表述与事实不符，SA4/SA7 若按「每条」口径验尸会误判 | SA1 在反馈表追加勘误：改为「FIXTURES 第 1~5 条完整 fixture（含 ROOT）确定性 ok:true ≥ 5 次，保证 `okTrue > 0`；第 6/7 条整条为 ok:false（E301/E307），贡献 ok:false 支路」。纯措辞修订，只增不删 |
| 2 | LOW | §3.2 配套改动遗漏一行过时注释 | `semantic.ts:20-22` 文件头注释明文断言「位置并列在实际文法中不可构造，码号序仅为确定性兜底」。E310@1:1 落地后该断言失效（`/** x */` 单独成模块即构造出 E305@1:1 与 E310@1:1 并列，SA1 自己在 §4.1 R-A 承认「使该断言失效一次」），但 ALLOW LIST 对 semantic.ts 仅登记「补记 E310/E311 一句」，**过时断言原样留驻**，与 §7 R-4 登记的确定性行为自相矛盾，误导后续读者 | ALLOW LIST semantic.ts 条目追加：文件头注释中「位置并列在实际文法中不可构造」一句修订为「位置并列唯一构造位：模块起始悬空文档注释 × 缺 ROOT（E305@1:1 vs E310@1:1，码号 305<310，§4.1 R-A）」。仍是零逻辑改动、注释行内 |
| 3 | INFO | §7 R-4（E305@1:1 并列胜出）零覆盖 | 该裁决是本任务新引入的唯一「无冻结用例、无存量用例、SA7 抽查清单（§10.6）也未含」的确定性行为。§10.6 抽查项只有 `//` 行注释场景（无并列） | §10.6 追加一条 SA7 抽查：`parseVfsl('/** x */')` → E305@1:1（非 E310）；对照 `parseVfsl('/** x */\ntype ROOT = {};')` → ok:true（doc 挂载 ROOT，E305 消失）。SA7 临时探针即可，不要求新增测试用例 |
| 4 | INFO | §6.2 forbidden-matrix 39 处 aliasCount + 1 机械改动量 | 39 处 `expectOk(result, n)` 的 n+1 与 35 处零改动的边界，SA3 手工实施有漏改风险 | SA1 §11 已登记缓解（漏改必红——aliases 长度断言直接失败，不会静默；SA4 按 §6.8 表 set 比对）。SA2 认可该缓解充分，无追加要求 |

无 CRITICAL / MAJOR 发现。

---

## 死火攻击清单（攻击未果，登记供 SA4/SA7 复用）

以下攻击线全部打完，均未能击穿设计——列出证据链，避免后续相位重复劳动：

1. **ok:true 逃逸狩猎（最重攻击线）**：E311 对 `cycle`/`unknown` 不裁决，是否存在
   「ROOT 形状坏却无任何候选入池 → 模块被静默接受」的路径？
   - `unknown` 原始类型（`type ROOT = unknown;`）：`unknown` 是 primitive
     （parser.ts:88 PRIMITIVE_NAMES、:393）→ localCls(primitive) = scalar（shapes.ts:110-113）
     → **E311 正常触发**，无逃逸。SA1 §2.3 矩阵该行属实。
   - §5 闭环证明逐来源复核：u1（未声明 ref → semantic.ts:98-101 无条件推 E301，不短路）✓；
     u2（generic-diag → semantic.ts:104-111 无条件推 E100/E301）✓；
     u3（computeCls 第 2 步 shapes.ts:292-296 全量入表，bodiesByName 覆盖一切声明名，
     Tarjan 弹出序保证 memo 完备）✓；
     cycle（环 ⇔ E106 DFS 遇灰回边，semantic.ts:160-165 全量收集）✓。
     另补 SA1 未列的反例：`type ROOT = A; type A = A \| { x: string };` ——
     A 的 SCC 合成为 map（环分量被 eff 移除）→ E311 通过，但 A 自环 → E106 在池，
     模块仍拒。**无一逃逸路径**。
2. **E310@1:1 并列面穷举**：语义相位其余各码锚点构造上不可能先于 (1,1)——E301/E106 锚
   引用记号（前必有 `type N = `）、E302 锚次声明名、E304/E307 锚标记记号、E306 锚键起点、
   E308 锚重复字段名、E309 锚异类成员、generic-diag 终判锚 namePos/ltPos（均在体内部）。
   唯一并列位是 E305（模块起始悬空 doc）——排序比较器 `(line, column, code数值)`
   （semantic.ts:182-184）使 305 < 310 确定性胜出，模块仍 ok:false。R-A/R-4 机制成立。
3. **空模块可达性**：`parseVfsl('')` 无早退——index.ts:35 无条件 `analyze(aliases, dangling)`
   → collectShapeCandidates 无条件执行（semantic.ts:174）→ `declared` 空 → E310@1:1 必达。
   红灯锁定用例（空文本 → E310@1:1）实施后可转绿，无结构障碍。
4. **红灯 21 锚点逐字符复算**（Unicode 码点列）：1:13 / 1:30 / 1:42 / 1:47 / 2:3 / 2:13 /
   1:33 全部与实现机制对齐（union.pos = 首成员起点 parser.ts:268；pattern.pos = `string`
   记号 parser.ts:471；E302 锚 namePos semantic.ts:90）。SA1 §0「逐字符重算」声明属实。
5. **G1 append-only 不变量**：`\ntype ROOT = {};` 追加于文件末尾 ⇒ 既有记号行列零变化 ⇒
   期望码与行列零重算。反向扫描全部 8 文件的输入是否以悬空 doc 结尾（append 会被 ROOT
   吸收挂载、E305 消失）——**唯一冲突位是 jsdoc E305 用例**，SA1 §6.6 已正确改道行内插入
   （`'type A = string; type ROOT = {};\n/** 悬空文档注释 */'` 保 E305@2:1 断言零改动，
   机制核对：parseModule EOF 位记账 parser.ts:199-202 保证模块末尾 doc 必入 dangling）。
   其余输入结尾均为 `;` 或行注释/空白，append 安全。
6. **§6 计数交叉验证**（SA2 独立清点 vs §6.8 表）：parse-vfsl 11/11（8 G1 + 3 翻转）✓；
   containers 27/33（正例 13 + 反例 9 + 交叉 ok 2 + 大小写 3）✓；cycle 16/16（E106 9 +
   两份 fixture 副本 6 用例 + kind 文本 1）✓；errors 5/19（E301×2 + E302×1 + E106×2）✓；
   forbidden 44/79（pos 39：E101×8/E102×8/E103×8/E104×8/E105×7，E102-09 无 pos 搭档；
   语义 neg 5；语法 neg 35）✓；jsdoc 7/7 ✓；r3 3/7 ✓；sa7 8/8 ✓。合计 121/180，
   `it` 计数不变，180 + 34 = 214 ✓。
7. **SA1 对 SA6 §8.3 的两处纠错复核**：(a) `E102-07-neg`（`Box<string>` 已声明名带实参）
   确为 generic-diag 终判 E100@ltPos、发生在 semantic.ts:104-111 语义相位——SA6 漏分类，
   SA1 纠正正确；(b) cycle 文件 7 用例挂旧版 §10 fixture 确认（:174-204 / :326-356 两副本
   + kind 覆盖文本）。SA3 应以 §6 清单为准。
8. **§10 修订版 fixture 三方一致**：规格 §10（v1-spec.md:496-526）≡ 红灯 canonical 副本
   （parse-vfsl-root-convention.test.ts:246-276）逐字一致（含 `\\\\-` 转义口径）；
   ROOT 声明确在末位 → `[…,'ROOT']` 名字数组断言次序正确；`DOC_ROOT` 文本含首尾空格
   与既有 `DOC_ASSETSDOC` 常量口径一致；`members[1].body` 的 YXmlFragment 降位断言与
   fixture text 成员结构吻合；新 fixture 自身全绿（红灯正例第 11 条现即通过）。
9. **资源界**：E310 一次 Set 查询、E311 每 ROOT 体一次 clsOf（ref 查表 O(1)、union 深度
   ≤ 2——members 恒非联合，parser 无括号分组）；T-l 20k 链渐近不变。无新递归、无新分配。
10. **接缝与调用链**：`analyze` 仅 index.ts:35 调用、`collectShapeCandidates` 仅
    semantic.ts:174 调用；`RESERVED_NAMES`（parser.ts:77-82）确不含 `ROOT`（无 E303 风险）；
    `add` 助手签名 `(code, message, line, column)`（shapes.ts:650-652）与 §3.2 蓝本吻合；
    `nodePos`/`clsOf`/`declared`/`aliases` 在插入点全部在域。`parseVfsl` 返回形状、
    message 前缀（errors.ts:34-36）、issues 恰 1 条——零契约改动，只增不改成立。
11. **fuzz 记号汤实测复现**：见下节。

---

## 协议假设依据审查

- **§8 章节存在** ✓，且「无协议级假设」的定性正确：本任务纯解析器语义逻辑，无 HTTP/WS
  端点、端口/进程时序、第三方库行为假设（vitest 为既有开发依赖，行为面无新假设）。
- **依据可验证性**：SA2 对 §8 表逐行复核——
  - 「聚合 = (line, column, 码号)」→ semantic.ts:182-184 ✓；
  - 「clsOf 六值 + union 行 + 别名链」→ shapes.ts:108-129 / 136-160 / 301-312 ✓；
  - 「候选全量收集不短路」→ semantic.ts:96-124, 160-165；shapes.ts:553, 593-597 ✓；
  - 「fuzz 种子 20260819 下 okTrue > 0 确定性恢复（实测）」→ **SA2 独立重跑**：
    逐字复刻 mulberry32 + 49 记号字母表 + `length = floor(rand()*121)` 循环，
    `node /tmp/sa2-fuzz-sim.mjs` 输出 **length===0 共 26 次 / 3000 迭代**——与 SA1
    声明的 26 精确一致。空汤 + `'\ntype ROOT = {};'` 后缀 = 仅含 ROOT 的合法模块
    （红灯正例已锁定 `type ROOT = {};` → ok）→ `okTrue ≥ 26` 确定性成立；
    `okFalse > 0` 由垃圾汤平凡成立。TOKENS 字母表确无 `ROOT` 记号（无后缀则纯随机汤
    不可能 ok:true——「隐藏反向锁」判断正确）。**该项依据成立**。
  - 「fuzz 变异用例 okTrue > 0 确定性（源码引用）」→ 前缀截断循环含
    `end === fixture.length`（test:259）引用属实，但「每条 fixture」的量化表述有误
    （见攻击点 #1）——**结论成立、依据措辞需勘误**，不构成无据推断。
  - 基线 180 全绿 / typecheck EXIT=0 → 简报 §三 + SA2 用例计数复核一致 ✓。

**审查结论**：无「应该/通常/预计」类无据推断；唯一实测声明可重跑且 SA2 已重跑吻合。
依据整体达到「可被 SA4 验证」标准。

---

## 错误处理链路审查

本任务是纯函数解析器，无 UI/异步/网络依赖。按 2026-05-07 立法四项对本域做同构审查：

- **静默失败检查**（本域等价物：「应拒绝却被接受」的 ok:true 逃逸）：见死火攻击 #1，
  六值 Cls 全来源穷举 + 补充反例，无一逃逸。E310 侧唯一悬念（空模块是否可达语义相位）
  已验证无早退（index.ts:35 / semantic.ts:174）。
- **状态闭环检查**：聚合机制保证返回恒为二态之一——候选空 → ok:true + module；
  候选非空 → 恰 1 条 issue（semantic.ts:178-185）。E310/E311 入池不改变该闭环。
- **降级路径检查**：E311 对 cycle/unknown 的「不裁决」是**真分层**而非降级——该条件下
  错误身份由更根本的 E106/E301/E100 承载且必在池（闭环证明）。顶层兜底 catch
  （index.ts:40-52）语义不变，「内部错误」通道不因本改动新增可达性。
- **虚假降级识别**：逐项套用判据——「cycle/unknown 在正常流程中是否总应满足？」否：
  二者分别是环引用与未声明名/generic-diag 的派生态，出现即意味着池内必有更根本错误的
  输入，**不是被降级掩盖的 bug**。与 E304（shapes.ts:553）/E309（:594）既有纪律同构。
  未发现伪降级。

---

## 红线测试思路

- **攻击点 #1（fuzz 依据勘误）**：无需新增测试——现有用例本身确定且 SA2 已复现其机制。
  SA7 验证时在「fuzz 确定性复核」段落登记实测 `okTrue` 计数（预期 ≥ 26 + ≥ 5 两源合计，
  断言口径仍为 > 0），以运行时输出佐证勘误后的依据表述。
- **攻击点 #2（注释勘误）**：SA4 静态验尸时 diff 核对 semantic.ts 该行注释已修订
  （零逻辑改动不变式同时核对）。
- **攻击点 #3（R-4 探针）**：SA7 抽查两行——`parseVfsl('/** x */')` 断言 E305 前缀 + 1:1
  （E310 被码号压制但模块仍拒）；`parseVfsl('/** x */\ntype ROOT = {};')` 断言 ok:true
  （doc 挂载 ROOT、E305 消失）。若走红灯形态：新增用例「模块仅一条悬空 doc 且无 ROOT →
  E305@1:1 胜出（非 E310）」即可锁定 R-A。
- **攻击点 #4**：既有缓解即测试——漏改 aliasCount 必红（`expect(m.aliases).toHaveLength(n)`
  直接失败），不会静默通过。
- **对 §6.1 T2~T4 语义翻转的 SA2 背书**（SA4/SA7 将消费此裁决）：空文本/纯空白/仅行注释
  三输入无法以「补 ROOT」对齐（文本内不可能含声明），仅有的两种处置是翻转期望或删除用例；
  删除被红线 4 显式禁止，故翻转是唯一保断言意图的路径。SA1 的意图守恒论证成立——E310
  是语义相位码，其出现本身证明 tokenize+parse 全程通过，原「语法层容忍」意图仍被证明且
  断言强度增加（从 ok:true 收窄为 ok:false + 精确码 + 1:1）。简报 §8.4 亦已明示此建议。
  **裁定：翻转合规，非删除断言**。
- **其余红线**：21 码注册表 ↔ 规格 §4 总表一一对应（SA7 §10.4 已登记）；版本 bump
  0.1.4、零 dependencies（§10.5 已登记）；红灯测试 34 用例 SA3 零改动 + 13 锁定绿用例
  前后同绿（§12 已标注）。SA2 复核红灯用例与 AC 九条映射完整，无 AC 缺口。

---

## 裁决

**pass**。

- 设计的判定算法、聚合交互、不裁决闭环、存量对齐清单、边界裁决全部经 SA2 独立攻击
  验证成立，无 CRITICAL/MAJOR 漏洞；SA1 的事实性声明（源码行号、锚点算术、用例计数、
  fixture 逐字源、fuzz 实测）经抽查与重跑**全部属实**，含对 SA6 扫描的两处正确纠错。
- 放行附带两项非阻塞勘误（攻击点 #1、#2）：SA1 在设计文档「SA2 反馈逐条回应」表追加
  落实（只增不删），随 SA3 派发一并生效；SA4 验尸时按上节核对。攻击点 #3 为 SA7 抽查
  建议，攻击点 #4 认可既有缓解。
- `pass` 仅覆盖设计审查；实现与活链路验证仍由 SA4（静态 + 1.4 vitest 触发性自检）与
  SA7（动态 + vitest 触发证据，Hard Gate #14）承担。
