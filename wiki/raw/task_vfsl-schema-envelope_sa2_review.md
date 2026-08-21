# SA2 攻击评审报告

**Date**: 2026-08-21（R1 首轮）；同日 R2 复审（追加节见文末）
**Verdict（当前，R2）**: **pass**
**Verdict（R1 历史）**: reject（无 CRITICAL/MAJOR；两项 MINOR 修订——均为局部、明确、一轮可落实。架构主体（模块布局、编排顺序、方言断言单点复用、ENV 独立码空间、坐标哨兵、恰四键回显、DENY LIST）经攻击后全部站住。修订落实后可直接 pass，无需重审架构。）

**被审对象**：`wiki/raw/task_vfsl-schema-envelope_design.md`（R1，Issue #52 / H1 `parseSchemaEnvelope`）
**ADR 约束基准**：`task_vfsl-schema-envelope_relevant_decisions.md`（ADR-0001 含 08-19/08-21 修订、ADR-0003、ADR-0005；ADR-0002/0004 登记不相关）
**审查方法**：全新视角独立复核——SA1 全部源码引用、行号、实测证据逐条独立重跑或 grep 核对（见文末「验证证据」），非背书式通读。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议（可执行修订要求） |
|---|--------|--------|---------|------|
| 1 | MINOR | §6.1 冻结性质「每条 message 单行、无内嵌换行」+ 行级前缀判别可被敌意输入证伪 | ENV-4 消息模板嵌入**未经转义的原始 `input.lang`**（`…实际 lang='${input.lang}'…`，schemasource.ts:96 原样内插），ENV-100 嵌入原始 `err.message`。`lang` 是任意字符串（形状门只查 `typeof === 'string'`，无词法约束）——**触发条件**：`{lang: "x\nVFSL-E42: fake", version: 1, …}` 形状完好、走方言断言 → ENV-4 消息含换行且第二行以 `VFSL-E42:` 开头。**影响**：(a) §6.1 白纸黑字声称的「每条 message 单行、无内嵌换行」性质为假——该性质正是 AC3#2 `/^VFSL-E\d+:/m` 行级断言的支撑论据（SA6 测试自身演示的判别模式，消费方（H3 DocScope / Phase 2 server）照抄即中招）；(b) 敌意/损坏数据可将「换数据/升级引擎」的信封层故障伪装成「改文本」的方言层故障——诊断误路由。对照：方言层消息嵌入的动态内容（标识符、标点描述）**在词法上不可能含换行**，单行性由词法结构天然保证；信封层把文本层的天然性质当成了免费性质。非崩溃、非正确性缺陷，故 MINOR 而非 MAJOR | §2.1 `makeEnvelopeIssue` 构造规则补一条冻结项：**嵌入的动态值（ENV-4 的 lang/version、ENV-100 的 err message）必须转义**——`JSON.stringify(value)` 或将 `\n`（及 `\r`）替换为可见记号（如 `⏎`），保证构造产物恒单行、恒无伪造前缀行；§6.1 措辞由「每条 message 单行」的经验陈述升格为 makeEnvelopeIssue 的**结构性保证**。ENV-2/ENV-3/ENV-1 只嵌入固定集合（键名/typeof 名/数组长度），无需变更 |
| 2 | MINOR | §8.2/§8.4/§10 证据数字错误：测试文件数「25」与实测不符 | **实测**（本会话独立复核）：runtime `*.test.ts` = **26** 个（含本票 1 个：domains/vfs3-assets 1 + packages/vfsl 18 + vfsl-codegen 6 + vfsl-protocol 1）；vitest 汇总口径 **31 个 Test Files = 26 runtime + 5 个 `.test-d.ts` typecheck 文件**（vitest.config.ts typecheck.enabled 计入汇总）。设计三处写「25 文件」（§8.2「全仓 25 文件 464 用例」、§8.4「25 文件全绿」、§10「仓内实测 25 个测试文件（含本票 1 个）」）。用例数 464 正确，文件数差 1（runtime 口径）或差 6（vitest 汇总口径）。**影响**：SA4 按 §8.4 字面执行 `pnpm test` 对照「25 文件全绿」→ 实际显示 31 → 门禁口径混乱/误判回归 | §8.2/§8.4/§10 文件数改为实测口径：**26 runtime + 5 typecheck = 31 Test Files、464 用例**（基线 12 红 + 452 绿不变，本会话已复核）；或改为相对口径「相对基线零新增失败文件、零新增失败用例，464 → 464 全绿」。SA3 验收命令预期同步改 |

### 复议项裁定（设计 §6.5 自留「SA2 可复议空间」：形状负例全收集 vs 单错误）

**SA2 裁定：维持 SA1 的全收集，不要求改**。理由复核成立：(a) v1-spec §4「issues 恰含 1 条」的原文语境是**文本解释的恢复策略**（「首个错误即失败」，规格 §4 line 284 亲核），不辖数据形状校验层；(b) 全收集上限有界（ENV-2 一条 + ENV-3 一条 = 至多 2 条），不产生错误风暴；(c) 先例已在（schemasource missing-directive「头部缺少指令: @lang、@id、@version」同款聚合，schemasource.ts 亲核）；(d) 透传阶段 parseVfsl issues 原样恰 1 条——方言层纪律未被本接缝破坏。SA8 D-N3 no-conflict 裁定与本裁定一致。

### 通过项（攻击后站住的设计决策，防 SA1 修订时误伤）

1. **编排顺序（形状→方言→文本）**：AC3 顺序锚的机制根源成立，「未知方言不解释文本」为控制流事实（parseVfsl 不被调用）——ADR-0001「未知方言 loud-fail 只读」的运行时兑付。
2. **方言断言复用 `assertVfslDialect` 单点**：schemasource.ts:93-103 亲核（单一 if-throw、消息含实际自述值）；try/catch 转译条件收窄到 `code === 'dialect-mismatch'`，非方言异常落 ENV-100——语义单点不分叉。
3. **ENV 前缀机械可区分**：`VFSL-ENV-E4:` 中 `E` 后随 `N` 非 digit，`/^VFSL-E\d+:/` 恒不匹配——对五种受测拒绝逐一成立。
4. **坐标哨兵 0/0 的前提不变式「文本层 line ≥ 1」亲证成立**：tokenizer 起始 `line=1, column=1`、换行重置 `column=1`（tokenizer.ts:64-65 等 17 处亲核）；src 全量 grep 无 `line: 0`/`column: 0` 字面量；E310 锚模块起始 1:1（semantic.ts 注释 + `parseVfsl('')` 实测 `line:1,column:1`）；parseVfsl/evaluate 崩溃边界 E100 均 1/1（index.ts:88-90、evaluate.ts:76 亲核）。哨兵判别式成立。
5. **纯增量/零回归**：无符号冲突（`parseSchemaEnvelope`/`EnvelopeErrCode`/`ParseSchemaEnvelopeResult` 全仓 grep 仅命中本票测试）；schemasource.ts 十三内部件 DENY LIST 合理；模块环论证正确（envelope.ts→schemasource.js，index.ts→envelope.js，无环）；node:fs 传递非回归论证成立（index.ts:62 本就 re-export FileSchemaSource，亲核）。
6. **恰四键回显 + 防御性副本**：AC1 `toEqual`/AC2#3 语义满足；`as` 收窄有 typeof 前置判定背书（对抗变值 getter 场景见 NOTE-a）。
7. **F1 版本先例引用属实**：0be8c11（origin/adr/vfsl-protocol，F1 #37）0.1.7→0.1.8 patch + 新公共导出；本分支 526ee4f 同款 bump（parent 0.1.7 亲核）。0.1.8→0.1.9 patch 口径有据。
8. **SA6 十二用例逐条映射**（§8.1）与测试文件逐行核对无遗漏、无曲解；AC6 五种拒绝（null/缺 text/version:'1'/version:2/lang:'other'）与 ENV-1/2/3/4/4 映射一一对应。

## 协议假设依据审查

- **章节存在**：§10 存在，表列七项假设，每项标注依据类型（设计期实测/源码引用/规格引用）——**合规**。
- **依据可验证性（SA2 独立重跑抽检）**：
  - `pnpm typecheck` 恰 1 错 TS2724（本会话复跑，逐字一致）✓；
  - 全量 vitest `Tests 12 failed | 452 passed (464)`、`Duration ~28s`、`Errors 1 error`（本会话复跑：27.90s，逐字一致）✓；
  - BAD_TEXT → `VFSL-E100: 类型位置意外记号: 标点 ';'` @ `line:3, column:7`（本会话 tsx 复跑，与 §10 及测试断言逐字一致）✓；
  - 源码引用行号抽检全部命中（schemasource.ts:93-103/36-42/80-85、index.ts:62/73/82-94、ir.ts:4-5、errors.ts 21 码注册表、evaluate.ts:76、schemasource.ts:392 validateHeader、collect.ts:44-64「消费方首动作」注释）✓；
  - v1-spec §7「parser 只消费 text / 信封解析与方言路由是后续引擎任务」（v1-spec.md:457 亲核）✓。
- **无据推断**：未发现「应该/通常/预计」类裸推断；全部为可重跑命令或可定位引用。**唯一缺陷即攻击点 #2 的文件数**（依据栏声称「仓内实测 25 个测试文件」——实测为 26/31，实测行为真、计数为误）。
- 本设计无 HTTP/WS 端点、端口/进程时序、第三方库行为假设（纯函数 + 模块内编排）——协议面无假设负担。

## 错误处理链路审查

| 检查项 | 结论 |
|---|---|
| 静默失败 | **无**。全部失败路径 → `{ok:false, issues}` 结构化返回（ENV-1/2/3/4/100 + VFSL-E 透传五通道全覆盖）；顶层 catch 兜底保证「绝不外抛」与 parseVfsl 同款；不存在「无请求发出 + 无反馈」类路径（同步纯函数，无 I/O） |
| 状态闭环 | **成立**。ok:false 是唯一失败表达；不存在失败被吞成 ok:true 的路径；ENV-100 明示「命中 = 实现缺陷/对抗输入，不得视为通过」——错误不降级为成功 |
| 降级路径 | 无外部依赖可降（零 I/O/零网络）；唯一兜底 ENV-100 对齐 parseVfsl E100 先例（index.ts:82-94 亲核），口径一致 |
| 虚假降级 | **未发现伪降级**。逐项检查：包装对象（`new String`）→ ENV-3 响亮拒绝非容忍；原型链来源（`Object.create({四键原型})`）→ ENV-2 响亮拒绝非静默半份解释；`Object.create(null)` 四自有键 → 接受（合法物化形态，非遗漏——JSON/structuredClone 产物恒自有键，该条件在正常流程总是满足且接受是正确行为）；多键忽略 → AC2 明令的向前兼容加法（ADR-0005 文件格式层「未知键容忍忽略」同款），非 bug 掩盖；`text:''` 放行交 parseVfsl E310 → 领地划分正确（实测 E310@1:1，非信封层越权拦截） |

## 红灯测试思路

1. **攻击点 #1 红灯（换行注入，最关键）**：
   - 用例 A：`parseSchemaEnvelope({lang: 'x\nVFSL-E42: fake', version: 1, id: 'x', text: 'type ROOT = {};'})` → 断言 `ok:false`，且 `issues.map(i=>i.message).join('\n')` **不匹配** `/^VFSL-E\d+:/m`、每条 message **不含** `\n`（当前设计实现此用例必红——ENV-4 内嵌原始 lang，转义规则落地后转绿）；
   - 用例 B（ENV-100 同性质）：构造 getter 抛 `new Error('boom\nVFSL-E9: x')` 的四键对象 → 断言 ENV-100 message 恒单行、无伪造前缀行。
2. **攻击点 #2 红灯（口径对照，SA4 静态执行）**：`pnpm exec vitest run` 汇总应读 `Test Files 31（26 runtime + 5 test-d）/ Tests 464`，与修订后的 §8.4 逐字对照；`find packages/*/test domains/*/test -name '*.test.ts' | wc -l` = 26。
3. **NOTE-a 佐证（可选，若 SA1 采纳单读物化）**：getter 首读返回 `'vfsl'`、次读返回 `42` 的 lang → 断言结果确定且 envelope.lang 与 typeof 门判定一致（当前两次读取设计下 envelope 回显可能撒谎类型）。
4. **既有 12 用例**：零改动即应转绿（§8.1 映射复核成立）；攻击点 #1/#2 修订**不得**触碰 12 用例任何断言（ALLOW LIST 中 SA6 owned 纪律）。

### NOTE（非阻塞观察，不要求修订，供 SA1/SA3 斤两自酌）

- **a) §3.4 二次读取**：typeof 门与恰四键重建各读一次输入属性——敌意 getter 可两次返回不同值（首读过门、次读入回显 → `envelope.lang` 可为 `42` 而 `as string` 撒谎）或触发昂贵副作用两次。建议实现层单读物化（读入局部变量→校验→回显局部变量）。非阻塞：正常数据无 getter，AC 不覆盖，函数纯度不受影响。
- **b) 类实例四自有键被接受**（own-key + typeof 判定）——纯数据裁定下的宽容面，与 §3.3 论证自洽，记录在案。
- **c) parseVfsl E100 同样内嵌原始 err.message**（index.ts:88）——攻击点 #1 若立转义规则，方言层同款问题属独立票（本票 DENY LIST 不动 index.ts 既有行为，仅要求**新增**的 ENV 侧不复制该弱点）。

---

## 验证证据（SA2 独立复跑，全部本会话实测）

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | 恰 1 错：`parse-schema-envelope.test.ts(31,10): error TS2724 … 'parseSchemaEnvelope'`，exit 2——与 §8.3/§10 一致 |
| `pnpm exec vitest run`（全量，后台 27.90s） | `Test Files 1 failed \| 30 passed (31)`；`Tests 12 failed \| 452 passed (464)`；`Errors 1 error`——用例数与 §10 一致；**文件数 31 ≠ 设计声称 25**（攻击点 #2） |
| `find packages/*/test domains/*/test -name '*.test.ts' \| wc -l` | **26**（含本票 1；分布 18/6/1/1）；`.test-d.ts` = 5 → 26+5=31 与 vitest 汇总吻合 |
| `pnpm exec tsx`（/tmp 脚本）`parseVfsl(BAD_TEXT)` | `{"ok":false,"issues":[{"message":"VFSL-E100: 类型位置意外记号: 标点 ';'","line":3,"column":7}]}`——§10 锚点逐字复证 |
| `pnpm exec tsx` `parseVfsl('')` / `parseVfsl('type ROOT = {};')` | `E310 缺 ROOT @ 1:1` / `ok:true`——§7 空文本边界与 fixture 前提复证 |
| `grep -rn "parseSchemaEnvelope\|EnvelopeErrCode\|ParseSchemaEnvelopeResult" packages/ domains/` | 仅命中本票测试文件——零符号冲突 |
| 源码行号抽检（read/grep） | schemasource.ts:37-42/80-85/93-103/392、index.ts:62/73/82-94、ir.ts:4-5/11-20、errors.ts（21 码 + makeIssue 前缀模板）、evaluate.ts:76、tokenizer.ts:64-65、v1-spec.md:272/284/439/457、collect.ts:44-64——全部命中 |
| `git show 0be8c11{,~1}:packages/vfsl/package.json` | F1 先例 0.1.7→0.1.8 patch + 新公共导出——「沿 F1 先例」引用属实（0be8c11 不在本分支祖先，但本分支 526ee4f 同款 bump 亦亲核） |

## 结论

设计主体质量高：ADR 兑付关系真实、源码引用零虚报、测试映射零曲解、实测证据可复现（本 SA2 独立重跑全中）。**reject 仅因两项 MINOR**：(1) ENV-4/ENV-100 消息嵌入未转义动态值，使 §6.1 自命的「单行无换行」冻结性质可被敌意 lang 证伪、行级前缀判别可被伪造（修订：makeEnvelopeIssue 转义规则 + §6.1 措辞升格为结构性保证）；(2) §8.2/§8.4/§10 测试文件数 25 与实测 26/31 不符（修订：改实测口径或相对口径）。两项均不动架构、不动 12 用例断言、不动 DENY LIST；SA1 出 R2 落实后即可 pass。§6.5 复议项裁定：维持全收集。

---
---

# R2 复审（2026-08-21）

**Verdict: pass**

**被审对象**：`wiki/raw/task_vfsl-schema-envelope_design.md`（R2——文档头 R2 标注、攻击点→章节映射、文末 SA2 回应表齐备）。
**复审方法**：不采信 SA1 自贴实测输出——两项修订的机制由 SA2 按 §2.1 设计逐字重实现并独立攻击（伪造向量/四终止符/CRLF/控制字符集完备性/正常消息零损伤），口径数字独立 find 复核，全文残留一致性 grep 复核，R1 通过项逐一 diff 确认未被触碰。

## R1 两项 MINOR 落实核验

### MINOR #1（动态值转义）——✅ 落实，机制独立复证通过

| SA2 R1 要求 | R2 落点 | SA2 独立验证结果 |
|---|---|---|
| makeEnvelopeIssue 增加转义冻结项 | §2.1：`makeEnvelopeIssue` 定为**唯一构造点**，内置 `sanitizeEnvelopeMessage`（模块内部、映射表逐字冻结）；ENV-1/2/3/4/100 五码全经此点 | 构造点唯一性在 §2.1/§6.1/§4/§7/§0 行 5 全文一致声明；§6.1 冻结项扩容含「微调后正文仍经 sanitizer（构造点强制，绕不过）」——堵死 SA3 改措辞绕过 的口子 ✓ |
| 四 Unicode 行终止符 | `\n` `\r` `\u2028` `\u2029`（ECMAScript LineTerminator 全集）→ 可见转义 | **SA2 独立实证**（按 §2.1 逐字符类版重实现，tsx 实跑）：(a) R1 攻击向量复现——hostile `lang="x\nVFSL-E999: …"` 组合原消息后 `/^VFSL-E\d+:/m` 检出 **true**，经 sanitize 后 **false** 且恒单行；(b) 四终止符逐一转义、CRLF 忠实转义为 `\r\n`（char-class 版正确；SA1 自检发现并修正的交替分支 CRLF 缺陷与 SA2 实现结论一致）；(c) **转义集=分行边界集的完备性攻击通过**：VT `\u000B`/FF `\u000C`/NEL `\u0085`/TAB 实测**不构成** JS `/m` `^` 分行边界（不转义正确，§9 行 8 声称成立）；LS/PS 实测**确为**分行边界且转义后被消除；(d) 正常消息零损伤——`/方言\|dialect/i` 锚保持、无转义噪声 |
| ENV-4 内嵌 lang / ENV-100 内嵌 err.message 均转义 | §4 后置论证：插值点在冻结资产 assertVfslDialect 内部（DENY LIST 不可预转义）→ 后置组合整串净化是唯一可行单点，对 ENV-4/ENV-100 及未来新增动态值统一生效 | 论证成立（schemasource.ts 仍在 DENY LIST，R1 亲核其消息模板原样内插 lang）；§7 边界表补 2 行（hostile lang 行终止符伪造 / ENV-100 多行 err.message）✓ |
| §6.1「单行」升格结构性保证 | §6.1：「不再是措辞性描述，而是结构性保证——message 含行终止符在构造上不可达，对抗输入无法伪造行首 `VFSL-E<码>:` 文本通道行」+ sanitize 规则入冻结项 | 升格到位；grep「单行」×16 处全部指向同一 sanitizer 机制，无「措辞性单行」残留 ✓；JSON.stringify 制式被否理由（ENV-4 不可预转义 + 引号噪声）成立，SA2 接受「换行替换」制式 |

### MINOR #2（证据数字实测口径）——✅ 落实，数字独立复核逐字一致

| 位置 | R2 口径 | SA2 独立复核 |
|---|---|---|
| §8.2 | runtime `.test.ts` = 26（packages 25 + domains 1，含本票）；vitest 汇总 Test Files 31 = 26 + 5 `.test-d.ts`；Tests 464；并加「SA4 字面对照：`Test Files 31`、`Tests 464`，勿与 runtime 26 混用」 | `find packages domains -name '*.test.ts' -not -name '*.test-d.ts'` = **26** ✓（R1 实测同值）；`.test-d.ts` 分布 = domains/vfs3-assets 2 + vfsl-codegen 1 + vfsl-protocol 2 = **5** ✓ 与 §8.2/§10 声称「vfsl-protocol 2 / vfsl-codegen 1 / domains 2」逐字一致；R1 会话 vitest 汇总 `Test Files 1 failed \| 30 passed (31)`、`Tests 12 failed \| 452 passed (464)` ✓ |
| §8.4 | `pnpm test` 注释 →「Test Files 31 全绿（26 runtime + 5 .test-d），Tests 464 全绿」 | 与实测口径一致 ✓ |
| §10 | 基线行改双维 find 命令 + vitest 汇总行输出；R1「25 文件」标注为 find 漏扫 domains 维度的口径错误（勘误注记有意保留） | grep「25 文件/25 个」仅余 3 处勘误/回应表引用，无活体声称 ✓ |

## R2 新增内容攻击（防修订引入新漏洞）

- **sanitizer 本身**：纯函数、冻结查表、确定性；转义产物 `\n`/`\r`/`\u2028`/`\u2029` 为字面文本（backslash + 可见字符），不可能复活行终止符；无状态、无模块级可变态——纯度论证（§7）不受影响。
- **透传通道不受影响**：sanitizer 只作用于信封层构造点，parseVfsl issues 引用直通零改动——AC4 `toEqual(parseVfslIssues(BAD_TEXT))` 不受影响（BAD_TEXT 的 E100 issue 本就无换行且非 ENV 构造）✓。
- **SA6 契约影响 = 零**：12 用例的信封值均无行终止符（SA2 读测试文件亲核），转义仅在对抗输入下改变 message 形态；§8.1 映射表逐行与 R1 相同 ✓。
- **R1 通过项 diff 复核**：§1/§3/§5（编排伪代码）/§6.2-§6.5/§11/§12（DENY LIST 含 schemasource.ts 只读）与 R1 逐字相同——R1 攻击后站住的 8 项决策未被修订触碰 ✓。

## R2 遗留 NOTE（非阻塞，不要求修订）

- **nit**：§2.1 注释「逐字符 1→2 无长度放大风险」对 `\n`/`\r` 为 1→2、对 `\u2028`/`\u2029` 实为 1→6——表述不精确，但「有界放大、无病态增长」的实质成立（无缓冲/截断逻辑依赖该数字），SA3 照抄映射表即可，无需改设计。
- R1 NOTE-a（单读物化）/b（类实例四自有键）/c（parseVfsl E100 同款嵌入）维持原判：非阻塞观察，R2 未采纳亦无碍。

## R2 验证证据（SA2 独立实跑）

| 命令/方法 | 结果 |
|---|---|
| `find packages domains -name '*.test-d.ts' \| sed … \| uniq -c` | domains/vfs3-assets **2** + vfsl-codegen **1** + vfsl-protocol **2** = 5 ✓ |
| `find … -name '*.test.ts' -not -name '*.test-d.ts' \| wc -l` | **26** ✓ |
| tsx `/tmp/sa2-r2-sanitize-check.ts`（按 §2.1 逐字重实现 + 四类攻击用例） | 向量复现 `/m` 检出 **true** → sanitize 后 **false** 且单行；CRLF → `\r\n` 忠实；VT/FF/NEL/TAB 不构成 `/m` 分行边界（**false**×4）；LS/PS 构成且转义后消除（true→false ×2）；正常消息含「未知方言」、零噪声——全部与设计 §10 R2 自贴输出及 §9 行 8 声称一致 |
| grep `25 文件\|25 个` / `单行`（设计文档全文） | 25 残留仅 3 处勘误注记 ✓；「单行」×16 全部结构性表述 ✓ |
| R1→R2 diff 通读 | 架构章节（§1/§3/§5/§6.2-6.5/§11/§12）零变动 ✓ |

## R2 结论

**Verdict: pass。** R1 两项 MINOR 均已按修订要求落实：#1 的唯一构造点 + 四行终止符转义机制经 SA2 独立重实现与完备性攻击验证成立（转义集与分行边界集严格相等，不多转不少转），§6.1 升格为结构性保证且堵死措辞绕过；#2 三值口径（26/31/464）全文统一且与 SA2 独立实测逐字一致，SA4 字面对照锚明确。R2 新增内容未引入新攻击面，R1 通过的架构决策未被触碰，SA6 契约影响为零。**同意放行，交 SA3 实现。** 提醒：pass 仅覆盖设计层——「唯一构造点」纪律、sanitizer 映射表逐字冻结、坐标哨兵 0/0、恰四键回显等仍需 SA4 静态验证与 SA7 活链路验证兜底。
