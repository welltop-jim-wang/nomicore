# SA2 攻击评审报告 — 严格编译 SchemaEnvelope：compileSchemaEnvelope（Issue #72）

- **Date**: 2026-08-22（R1 轮）
- **Reviewer**: SA2（Wallfacer / 设计攻击评审）
- **被审对象**: `wiki/raw/task_issue-72_design.md`（R1，852 行）
- **约束基准**: `wiki/raw/task_issue-72_relevant_decisions.md`（ADR-0001..0007 摘录 + 设计后复审追加 **D1–D5**——按总控指令作为 ADR 级约束基准对照，违反条款 = CRITICAL）
- **参考**: SA8 设计后复审 `task_issue-72_design_conflict_report.md`（verdict: clear；移交重点 **O1**：canonical JSON「单一生产者插入序」守卫强度——§6.3 签名约束是否足以防第二生产者，本评审首要攻击面）
- **红灯锚**: `packages/vfsl/test/compile-schema-envelope.test.ts`（28 用例，SA6 owned）
- **Verdict**: **pass**（附 1 项 MAJOR 非阻塞加固义务 + 2 项 MINOR + 2 项 NOTE；无 CRITICAL、无 ADR/D1–D5 违反、无行为级缺陷触发链。MAJOR 即 O1 攻击面命中——守卫「约定化而非可执行」+ 爆炸半径论证缺位，三项加固不推翻任何设计决策，处置见文末「结论与处置表」。pass 仅指设计通过审查，不预支 SA4/SA7 对实现与活链路的验证。）

---

## 评审方法与证据基础（独立复核，未采信任何未验证断言）

以全新视角重放了设计的全部关键现状声称。逐项验证（命令均相对 worktree 根）：

| # | 验证项 | 方法 | 结果 |
|---|---|---|---|
| 1 | 设计全部源码行号引用 | 直读 `packages/vfsl/src/{envelope,index}.ts` 等 | **全部属实**：envelope.ts:50（makeEnvelopeIssue）/97（validateEnvelopeShape）/180（dialectIssueOrNull）/218（vfslIssues）/232（envelopeCrashIssue）；index.ts:49（evaluate import）/114（parseVfslImplementation）/262（compiledCache）/272（deepFreeze）；`docs/vfsl/v1-spec.md:439-448`（§7 四键表序）**精确到行** |
| 2 | H1 测试不锁 ENV 码空间全集（ENV-5 扩码安全前提） | 直读 `test/parse-schema-envelope.test.ts` | 属实：:85 `typeof entry.issue.code === 'string'`（不穷举码值）、:377 ENV-100 专属锚、:213-223「多余键 → ok:true」容忍锚（设计 §3.5 双门论证的对端契约真实存在） |
| 3 | `SchemaEnvelopeIssueCode` 加法扩展零破坏 | `grep -rn "SchemaEnvelopeIssueCode\|EnvelopeErrCode" -- packages apps` | 属实：仅 envelope.ts（注册表+构造点）与 index.ts:104 re-export，**零外部消费方、零 exhaustive switch** |
| 4 | 新导出无既有 caller | `grep -rn "compileSchemaEnvelope"` | 属实：仅 SA6 测试文件引用（§13 声称成立） |
| 5 | vi.mock 模块图边先例 | 直读 `test/docscope-getcompiled.test.ts:89-93` | 属实：同款 mock 工厂（importOriginal 透传 + vi.fn 包裹），同文件同 import 绑定的 getCompiled 已验证该机制 |
| 6 | **§6.3 数值确定性的事实链（O1 关联）** | 直读 tokenizer.ts / parser.ts / ir.ts | tokenizer.ts:203-214 数字记号 = **`[0-9]+` 无符号十进制整数**（无负号/小数点/指数）；parser.ts:331-335 `Number.isFinite(tok.num)` 为假 → **E100 拒绝**（超双精度不进 IR）；ir.ts literal `value: string \| number`。⇒ **IR 数值域 = 有限非负双精度，`JSON.stringify` 在该域单射**。设计结论安全，但未引用这两道闸门（→ M2） |
| 7 | **单 build 内指纹单射性（O1 核心前提）** | 直读 ir.ts 类型族 | `VfslModule = {kind, aliases[]}` 无 Record 键、无 optional 字段、docs 恒数组必填、alias 名不进字符串键位。两个语义不同的 IR 不可能 `JSON.stringify` 出同一字符串（数值域单射 #6 + 字符串转义单射 + 键集/结构固定）⇒ **同 build 内不存在假共享方向** |
| 8 | **JSON round-trip 保插入序（第二生产者主路径）** | ECMAScript 语义推演 + ir.ts 键形核查 | `JSON.parse` 按文本序建键、`JSON.stringify` 按插入序发射；IR 键均非整数样字符串（无 0/1/42 形键）⇒ round-trip 保插入序 ⇒ 反序列化第二生产者与 parseVfsl 生产者**指纹兼容但无声**（→ M1 论据） |
| 9 | 包现状 | cat package.json | version 0.2.0（→0.2.1 bump 前提成立）；无 `dependencies` 字段（测试 `pkg.dependencies ?? {}` 兼容，AC6#3 已绿） |
| 10 | 深冻结栈安全前提 | parser.ts:24 `MAX_TYPE_NESTING=100` + evaluate.ts ref 不内联 | 类型表达式深度预算封顶 + ref 按名终态不展开 ⇒ module/derived 图深度有界；H3 getCompiled 已对同形图在产深冻结（同款先例）⇒ deepFreeze 第二消费方无栈溢出面 |
| 11 | 28 用例逐条走查（§10.1 映射复核） | 测试文件与设计控制流逐条对照 | 全部用例可在 §5 编排 + §3 严格门 + §6 指纹 + §7 冻结控制流下转绿；**无任何锚点与设计冲突**；TH-1/2/3 裁决与测试头假设逐字一致 |
| 12 | 敌意输入路径 | envelope.ts 单读物化 + crashDetail 守卫（:242-248）直读 | get trap 抛出→顶层 catch→ENV-100（V7 可达性成立）；thrown 值不可字符串化→确定性占位正文（F1 遗产）⇒ catch 块自身无外抛面 |

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| M1 | **MAJOR**（非阻塞，必须落实的加固） | **O1 移交重点：§6.3 单一生产者不变式的守卫强度** | 守卫三件套中「签名收 `module: VfslModule`」是**结构类型**——不能区分 parseVfsl 新鲜产物与 JSON 反序列化/手工构造/异序构造的 IR；「唯一调用点在 §5 编排（同文件可见）」是**设计时快照**而非运行时/CI 约束；v2 升级规则（D2）住在 wiki 不在代码。且设计**未论证不变式被破坏时的爆炸半径方向**。触发链（未来路径，ADR-0007 明文预告缓存票）：未来 NamespaceRuntime 缓存票对**持久化**编译产物重算 semantic 指纹 = 引入第二生产者——round-trip 保序（证据 #8）使其**无声通过** D2 的「必须先升 v2」规则，规则形同虚设；若第二生产者以不同键序构造（手工/异构 parser/对象合并），同语义文本得到不同指纹——**假失效方向**（安全但无人察觉，缓存命中率为隐性腐蚀）。 | 三项加固（均不推翻 D1 单文件审计布局）：(a) fingerprint.ts 头注写入**可 grep 的 D2 契约标记**（「第二生产者/跨实现互认出现前必须升 v2 前缀」）；(b) **SA4 静态门禁**：两构造函数名全仓 grep 仅许 fingerprint.ts（定义）+ index.ts（唯一调用点）出现，第三文件即红；(c) round-trip 保序哨兵测试（RT-1b）。设计 §6.3 补一段爆炸半径论证（本评审已代为验证前提：同 build 内破坏 ⇒ 仅假失效、永不假共享——证据 #7/#8）。 |
| M2 | MINOR | §6.3 数值确定性论证缺口 | 「IR 无浮点歧义面」只论证了 `80` vs `80.0`，未提 `JSON.stringify` 对 NaN/Infinity（→ `"null"`）与 `-0`（→ `"0"`）的坍缩。安全性实际由 tokenizer `[0-9]+`（tokenizer.ts:203-214）与 parser `Number.isFinite` E100（parser.ts:331-335）两道**既有闸门**结构性保证，设计未引用——SA7 活链路验证时缺锚；且 v2 方言若放开数值语法（负号/小数点/指数），指纹层会**静默继承** parser 的归一化语义而 D2 触发器清单未登记该情形。 | §6.3（或 R2 微修订）补两处源码引用；D2 升级触发器清单登记「方言放开数值字面量语法 ⇒ semantic 域文档必须重审并升 v2」。 |
| M3 | MINOR | §9 边界表的对抗输入覆盖缺口 | §9 只列「Proxy get trap 抛出 → ENV-100」，未列「Proxy **谎报键集**」（getOwnPropertyNames trap 不抛而隐藏/伪造键）：隐藏多余键的输入可过严格门（ENV-5 扫描被骗），但 `validateEnvelopeShape` 重建回显只抄四键单读物化值——**真正的数据面安全边界是「重建回显」而非「ENV-5 扫描」**。该论断正确但未文档化，SA7 活链路验证无从对照。 | §9 补一行：谎报键集两向（隐藏→过门但多余数据不可达产物；伪造→ENV-5 保守拒绝）；SA7 对照 RT-3。 |
| N1 | NOTE | D1 前缀耦合的运营后果未记录 | 两域共用 `FINGERPRINT_PREFIX`：envelope 域文档形态单侧演进 ⇒ semantic 域指纹**全体失效**（miss-only 安全方向）。D1 已声明「任一演进须升 v2」的保守选择，但未记录该耦合的代价权衡——未来缓存票做失效预算时需要这个事实。 | 登记 relevant_decisions D1 附注即可，无需改设计。 |
| N2 | NOTE | §3.4 承诺的不可枚举多余键无测试锚 | 「不可枚举字符串自有键计入 ENV-5」（`getOwnPropertyNames` 语义）是设计契约（§3.4/§9 明文），28 用例未锚——SA6 文件 owned/断言禁改，非本票缺口，但契约缺锚即缺回归防线。 | 经总控排队：SA6 修订轮或 SA7 活链路补 RT-4。 |

---

## M1 详述（O1 攻击闭环——为什么是 MAJOR 而非 CRITICAL/MINOR）

**SA8 移交问题**：「§6.3 签名约束是否足以防第二生产者？」

**SA2 裁定：不足以——但缺口性质是「守卫可执行性」而非「决策缺陷」。**

1. **签名约束防不了**：`module: VfslModule` 是开放结构类型，任何同形对象（`JSON.parse` 产物、手工字面量、异构 parser 输出）都满足。TS 编译器不会、也无法阻止第二个调用点传入非 parseVfsl 产物。
2. **调用点可见性防不了**：设计期「唯一调用点同文件可见」是快照事实。fingerprint.ts 是模块级导出（为 index.ts import 服务，包 exports 封装挡住了**包外**消费者——这一点设计正确），但**包内**任何未来文件都可 import。
3. **D2 规则没有探测器**：「第二生产者出现前必须升 v2」是纯流程规则。最可能的第一违规者恰是**无害**的（round-trip 保序，指纹兼容，测试全绿）——违规无声，规则空转；等到**有害**违规者（异序构造）出现时，症状只是缓存命中率下降，无红灯、无告警。
4. **为什么不是 CRITICAL**：本票范围内行为无缺陷——单一调用点真实存在（证据 #4：全仓仅 SA6 测试引用 compileSchemaEnvelope，包内无第二入口）；28 用例锚定确定性与敏感性，能捕获**同 build 内**插入序不稳定（AC4 全部敏感性锚 + AC6 重复编译稳定性锚）；失败方向安全（证据 #7：同 build 内语义不同 ⇒ JSON 不同 ⇒ 指纹不同，**假共享方向结构性不存在**）；跨 build 假共享需要持久化跨版本指纹共享的消费方——当前不存在，且那正是 D2/v2 门禁管辖的未来票。
5. **为什么不是 MINOR**：SA8 以 O1 点名移交此面，D2 已把「SA3/SA7 守卫点」写成**契约**——契约没有可执行的守卫机制，SA7 届时无物可验。这不是润色，是把既定契约做实。

**三项加固的成本**：头注标记 ~3 行；SA4 grep 门禁一条命令；哨兵测试一个用例。零决策变更、零架构变更。

---

## 协议假设依据审查（2026-06-13 立法）

- **§12 章节存在** ✓，且开篇显式声明「无网络协议/端口/进程生命周期/第三方库行为类假设」——与本票纯函数性质相符，声明本身即合规。
- **依据栏无「应该/通常/预计」类无据推断** ✓：15 行依据逐条给出依据类型（设计期实测 / 现有测试引用 / 源码引用）与具体引用。
- **实测验证均贴命令与输出全文** ✓（`$ pnpm exec tsx /tmp/issue72-design-check.mts` 等，V1a–V12c + v4h-strict 复核 + vitest 基线 26红/2绿 全文贴入）——沿 H1 §10 证据留存纪律。V4h 初测伪阴（CJS 非严格模式）**诚实留痕并以 `.mts` 复核闭合**，这是证据纪律的正面样本。
- **SA2 独立复核抽样**：行号引用 11/11 属实（证据表 #1–#5）；两处形式小瑕疵（均不触发 reject）：
  - 「vitest 测试文件经 ESM 转换恒严格模式」为断言而非实证——风险低（测试 #23 四处赋值锚在 SA3 落地时活验证，若假则红灯而非静默）；
  - V10/V11 等实测脚本位于 `/tmp`（DENY LIST 已声明不进 commit）——SA4 重放需自行重构脚本，建议未来票把设计期验证脚本随 wiki 存档（非本票义务）。
- **可被 SA4 验证** ✓：vitest/tsx 命令可重跑、行号引用可定位、grep 口径已给（§13）。

---

## 错误处理链路审查（2026-05-07 立法）

- **静默失败检查**：无。五阶段全部失败路径返回结构化 `issues`（§5.2 判别表：kind + code + readOnly 三元组可区分全部五阶段，无不可观测失败形态）；成功路径五件套全量返回。库函数无 UI 面，返回值联合即反馈通道。
- **状态闭环检查**：每条 `ok:false` 分支就地构造 issues 数组（envelope/dialect 单条、parse/evaluate 原生数组零损透传、internal 单条 ENV-100）；无「无请求发出 + 无反馈」路径。
- **降级路径检查**：零外部依赖（`dependencies {}` 已被 AC6#3 锚定）、零 I/O、零环境读取——不存在依赖不可用场景，无降级面需要设计。
- **虚假降级识别（三度立法重点）**：**未发现虚假降级**。逐项核对：
  - ENV-100 顶层 catch 是**崩溃边界**而非降级——返回 `ok:false` 结构化失败，不吞错续跑、不返回假成功；
  - 正常路径的每一类前提缺失（形状/封闭/方言/语法/求值）各有**专属阶段码**（ENV-1/2/3/5、ENV-4、VfslIssue×2），无一被 ENV-100 掩盖——ENV-100 只收编对抗输入与不可达实现缺陷，与 parseVfsl/evaluate 既有 E100 崩溃边界（index.ts:123-135、evaluate.ts:74-77）同款口径。若实现 bug 使正常路径落入 ENV-100，28 用例的幸福路径/分阶段锚即刻红灯——loud，非静默。
  - 「失败产物不冻结、不摘要」是失败语义的自然形态（失败无缓存无共享），非降级。
- **竞态/死锁**：纯函数、零共享可变态（`compiledCache` 零读写、每调用独立 `WeakSet`、fingerprint.ts 仅两个模块级 const 字符串）——单线程 JS 下无竞态面、无锁、无死锁。
- **缓存/状态撕裂**：N/A（本票无缓存；与 getCompiled 对象图不相交由 AC6#1/#2 锚定）。
- **极端异常输入**：深度 ≤100 封顶（#10）、sha256 < 2^32 bit、敌意 Proxy 两类行为（抛出→ENV-100；谎报→M3 文档缺口但行为安全）、thrown 值不可字符串化→F1 守卫占位正文（#12）、hostile 动态值→sanitizer 单行化（envelope.ts:70-78 既有）——**无 panic 外逃面**。
- **Feature 污染检查**：`envelopeTextGate`/`getCompiled`/`deepFreeze`/既有导出逐字不动（§10.2/§13/§14 三处一致承诺 + 双门差异面经 H1 既有锚 :213-223 核实为两票契约而非漂移）；`SchemaEnvelopeIssueCode` 加法扩展经 grep 实证零破坏（#3）；`input: unknown` + 结果联合的签名姿态与 H1/H3 完全一致——调用方无易错面。

---

## ADR / D1–D5 合规复核（约束基准对照——违反即 CRITICAL）

| 基准条款 | 设计落点 | 结论 |
|---|---|---|
| D1 双指纹双域构造（字面量键序/域标签/前缀常量同址/构造函数不上公共面/三哈希域隔离） | §2.2/§6.2 逐项落实；包 exports 封装使构造函数包外不可达（SA2 核实 package.json 无子路径导出） | ✓ |
| D2 canonical 兑付范围（四层确定性/不引入 RFC 8785/第二生产者须先升 v2） | §6.1/§6.3/§6.5 | ✓（守卫可执行性缺口 → M1；数值触发器缺登记 → M2） |
| D3 envelope 严格封闭定式（ENV-5 own 字符串键/坍缩单条 ENV-2>ENV-3/symbol 排除/阶段序/双门并存） | §3 全项 | ✓ |
| D4 internal 与失败联合形态（顶层 catch/单条 ENV-100/不加 stage 字段/失败不冻结） | §5/§5.2 | ✓ |
| D5 深冻结与实现约束（一趟原地冻结/禁 clone-then-freeze/evaluate 走 index 顶部 import 绑定/不触 compiledCache/纯增量） | §5.3/§7/§13 | ✓ |
| ADR-0007 全部直接治理条款（签名/严格封闭/五阶段/五件套/指纹四要素/深冻结/无缓存/无 Yjs） | 逐条兑付（SA8 报告 no-conflict 全表，SA2 抽查认同） | ✓ |
| ADR-0001/0003/0005 支撑条款（JSDoc 进 IR/ref 不内联/id 是标签） | §6.4 敏感性矩阵机制映射 + V1c/V2/V3 实测 | ✓ |
| ADR-0002/0004/0006 边界 | §14 DENY LIST 显式冻结 | ✓ |

**无条款违反 ⇒ 无 CRITICAL。**

---

## 红线测试思路（每漏洞对应的红灯 IT 编写方向）

> SA6 文件 owned/断言禁改——RT-1a 归 SA4 静态门禁；RT-1b/1c、RT-2、RT-3、RT-4 建议经总控排入 SA6 修订轮、新增内部测试文件（vitest include 已覆盖 `packages/vfsl/test/**`）或 SA7 活链路；不阻塞本票。

- **RT-1（M1 守卫可执行化）**：
  - **RT-1a（SA4 静态门禁）**：`git grep -nE "semanticFingerprintOf|envelopeFingerprintOf" -- 'packages/vfsl/src'` 结果仅许 fingerprint.ts（定义）与 index.ts（唯一调用点）两文件——第三文件出现即红（D2 违反，须先升 v2）。
  - **RT-1b（round-trip 保序哨兵）**：直连 `../src/fingerprint.js`（同 sha256Hex KAT 直连先例），对 corpus（TEXT_A / TEXT_REF / TEXT_JSDOC_1）断言 `semanticFingerprintOf('vfsl', 1, m) === semanticFingerprintOf('vfsl', 1, JSON.parse(JSON.stringify(m)))`——未来换序列化器或引入非保序第二生产者时先红，先于任何跨生产者不一致出厂。
  - **RT-1c（边界钉死）**：手工以异序键构造同值 module（如 `{name, kind, docs, type}` 插入序）断言其指纹 **≠** parser 产物指纹——把「不支持跨序归一」从隐式变显式契约（若未来有人误以为有归一化，此锚先红）。
- **RT-2（M2 数值闸门锚）**：`parseVfsl('type ROOT = { a: 1e999; };')` → `ok:false`（当前 tokenizes 为 number(1)+ident(e999) 落语法错；若未来 tokenizer 静默接受指数记号，parser isFinite E100 仍应拦截 Infinity）；可再加超双精度向量（400 位数字串）锚 E100 拒绝路径——防「非有限值进 IR → JSON "null" 坍缩面」被未来方言票无声打开。
- **RT-3（M3 谎报键集两向）**：
  - 隐藏向：`new Proxy({…四键, evil: 1}, { getOwnPropertyNames: () => ['lang','version','id','text'] })` → 编译 `ok:true` 且 `JSON.stringify(result.envelope)` 恰四键无 `evil`——锚「重建回显 = 数据面安全边界」；
  - 伪造向：getOwnPropertyNames 返回含假键数组 → ENV-5 单条保守拒绝、不外抛。
- **RT-4（N2 不可枚举键）**：`Object.defineProperty(input, 'hidden', {value: 1, enumerable: false})` → ENV-5 单条且消息含 `hidden`——锚 §3.4「不可枚举字符串键计入」契约。

---

## 结论与处置表

**Verdict: pass。** 架构骨架（五阶段全复用既有单点 / 双域构造性分离 / 一趟原地深冻结 / 纯增量零回归）经独立攻击后屹立：28 用例逐条映射可转绿（#11）、单 build 内指纹单射性成立（#7）、D1–D5 与 ADR 全条款合规、错误处理链无静默失败无虚假降级。O1 攻击面命中一处 MAJOR——**§6.3 的守卫是「约定快照」而非「可执行门禁」，且爆炸半径方向未论证**——但其不产生本票行为缺陷、失败方向安全（假失效不假共享）、三项加固零决策变更，故不构成 reject 理由（对照 H3 先例：reject 门槛是带触发链的行为级缺陷）。

| 发现 | 处置 | 承接方 |
|---|---|---|
| M1(a) fingerprint.ts 头注 D2 契约标记 | 实现票硬约束（随 §2.2 伪代码落地） | SA3 |
| M1(b) grep 静态门禁 | 纳入验证命令清单 | SA4 |
| M1(c) RT-1b/1c 哨兵测试 | 排队（SA6 修订轮或新内部测试文件） | 总控调度 |
| M2 §6.3 补 tokenizer/parser 引用 + D2 触发器登记 | R2 微修订（或由 relevant_decisions 追加节承载） | SA1（总控裁量是否开 R2） |
| M3 §9 补谎报键集两向 | 随 M2 同批微修订 | SA1 |
| N1 D1 前缀耦合代价附注 | relevant_decisions 登记 | 总控 |
| N2 RT-4 不可枚举键锚 | 排队（同 M1(c)） | 总控调度 |

本 pass 不替代 SA4 对实现 diff（§14 ALLOW/DENY LIST 逐字不动项）与 SA7 对活链路（指纹确定性/冻结 loud/五阶段可观测性 + 本报告 RT 系列）的验证。
