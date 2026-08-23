# SA2 攻击评审报告

**Date**: 2026-08-22
**Verdict**: reject（核心架构通过攻击验证，无 CRITICAL；但存在 2 项 MEDIUM 实现级修订要求 + 4 项文档级修正，需 SA1 修订设计后快速复审——复审范围仅限本报告 R1–R6）

- **被审对象**：`wiki/raw/task_read-logical-value-at-path_design.md`（SA1 设计，592 行全文 + 全部引用源码逐行核对）
- **任务类型**：feature（Issue #75）
- **评审方法**：全新视角，独立重跑设计期探针、逐行核对 evaluate.ts / pattern.ts / validate.ts / resolve.ts / extract.ts / carrier.ts / index.ts 与 SA6 两份红灯测试
- **ADR 约束基准**：`wiki/raw/task_read-logical-value-at-path_relevant_decisions.md`（SA8 摘录；逐条对照，未发现任何 ADR 条款违反 → 0 条 CRITICAL）

---

## 0. 通过项（攻击未击穿，SA1 可引为定论）

以下核心裁决经独立攻击后**成立**，复审时无需重查：

1. **两阶段模型（D1）正确且必要**。`['notes','x']` 的 presence-independence 论证成立；交织式单趟确实会产生数据在场性依赖的双态不一致。Phase A/B 段类型双检（§4.4「自校验义务」）的异构联合反例（`YMap<{x}> | YArray<leaf>`）真实可达且论证正确。
2. **导航权威弃用 `derived.index`（D2）证据链完整**。SA8 注记 N1 要求攻击探针场景覆盖面——本评审从 evaluate.ts 源码结构性确认：别名物化一律 `path=null`（L51-54）与 union 成员一律 `null`（L120/L155）是**物化规则的必然结果**，任何位于 ref 别名子树或 union 成员内的 Record 都没有索引行——缺口不是六类场景的巧合，是结构性的。探针场景覆盖充分，结论升级为源码级定论。
3. **values 锁步双游标（D3）在合法派生物上不会断裂**。本评审逐形态核对两树物化规则（evaluate.ts structureOf × valueOf 全 8 kinds + optional 包装 + ref 终态 + E309 禁混合联合）：resolve.ts L159-171 的 `fold` 保证 union 成员全 map / 全 container / 全 scalar 三态（混合 → E309 拒绝），因此结构 union 节点与 values union 节点的 `members` 数组在合法派生物上恒 1:1 声明序对齐；标量折叠（structure leaf ↔ values enum/scalar/pattern）只发生在终态，锁步规则表「终态游标不前进」覆盖全部不对称位。vChild/vElement 的 throw→C3 只在手造派生物可达。
4. **pattern 引擎同源消费（D3/INV-9）成立且 no-op charge 声明正确**。pattern.ts L761-773/L895-907 实证：`matchBudget`（8192 起、二次项、4M 绝对封顶）是 `match` **内部**机制，`tick` 在 `steps > budget` 时抛 `PatternBudgetExceeded`，与 charge 回调无关；charge 只是外层全局记账钩子（validate 用它计入 ctx 工作预算）。read 传 no-op **不会**失去单匹配预算封顶。validate.ts L271-279 的 `validateKeyPattern` 与设计 §4.3 `keyAllowed` 调用形态逐字同源（同 compile、同 match、同非锚定搜索语义），INV-9 无分歧窗口。
5. **失败单通道（D6）穷举论证成立**。抛错违 FC-1、`ok:true,undefined` 是立法禁止的伪降级、第三变体超冻结联合——三排除后 `PATH_NOT_ALLOWED + message` 确为唯一落点。C2 在契约语境不可达（open 全量验证）的定性准确。
6. **walk 复用（D7）与 FC-4 继承成立**。extract.ts walk/copyPlainValue/putSnapshotKey 闭环即普通值深拷贝 + `__proto__` 安全写入的全部保证，包内导出不扩大公共 API 面，`message?` 增补不破坏 SA6 任何结构断言（测试逐条核对：无全对象相等断言）。
7. **崩溃边界（D11）**：顶层 try/catch 收编一切（含深递归 RangeError）；合法派生物下 Phase A/B 递归深度被 schema DAG 有界（E301/E106 无环 + MAX_TYPE_NESTING=100），超长 path 在有界深度内被终态拒绝，无栈溢出逃逸面。
8. **SA6 20 用例 + test-d 逐条映射（§5）核对无误**：每条用例的 Phase A/B 路径走查与测试断言一致（含 `-0` 归一、`Infinity/NaN` 拒绝、空 doc `[]`→`{}`、AC6-20 双向坏兄弟隔离）。
9. **§10 caller 审计属实**：本评审重跑 `grep -rln "readLogicalValueAtPath" --include="*.ts" packages/ apps/` 仅命中 SA6 两测试文件。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议修订 |
|---|--------|--------|---------|---------|
| 1 | **MEDIUM** | §4.4 Phase B Record 分支注释 | 注释「pattern 合法性 Phase A 已验（**本成员键空间**）」是**事实错误**。Phase A 的 `members.some()` 验证的是键对 any-of 成员键空间**并集**的隶属（ADR-0003 存在性语义），不是 Phase B 实际下钻成员的键空间。可达反例：`U = Record<StrictId, YXmlFragment<…>> \| Record<string, YLeaf<string>>`，键 `BAD` 违反 StrictId 但被成员 1 许可且 live 值为 Y.XmlFragment——Phase B 按声明序先试成员 0，`get('BAD')` 命中后经 walk 产出 XML 串（成员 1 反而无法产出载体）。本评审推演结论：该行为**恰好与 extractYjsSnapshot 的 walkUnion 一致**（walk/walkUnion 对 keyPattern 零消费，extract D4/B5 明文），即正确行为是「Phase B 不验 pattern」。但按注释字面实现的 SA3（给 Phase B 加回 per-member pattern 检查）会制造与 extract ground truth 的投影分歧，直接击穿 AC6-19 的立论前提——设计文本正在教 SA3 写出错误实现。 | R1：修正 §4.4 注释为「pattern 许可性由 Phase A 按 any-of 键空间并集判定；Phase B **有意零 keyPattern 检查**（与 extract walk/walkUnion 的 keyPattern 零消费纪律同源，成员错位由载体/结构自校验自纠）」，并在 §4.5 补一段「union 成员键空间交叉」论证（含上述反例的 extract 一致性走查）。纯文档修订。 |
| 2 | **MEDIUM** | §4.9 成本模型 / AC6 | 「Phase A = O(路径长 × union 成员扇出)」是**最好情形**表述，最坏情形是**指数级**。可达构造：经 ref 别名链构造 n 层重叠二员联合（每层两个成员都许可前缀 `x` 下钻、只在末段互异），一条长 n+1 的末段被拒路径使 `members.some()` 回溯展开 2^n 次 schema 节点访问；Phase B 成员循环同形。path 长度由调用方控制且不受限；更关键的是 ADR-0001 下 **schema 本身是 doc 数据**（SCHEMA 信封随 doc 走），readLogicalValueAtPath 是接受任意 derived 的公共 API——对抗性但合法的 schema（通过 parse/evaluate 无障碍）+ 30 段路径 = 进程内 CPU 燃烧。§4.9 的线性声明与 AC6「读取成本与目标子树规模相关」的承诺在最坏情形不成立。 | R2：设计增补**每调用局部 memo 表**：Phase A 以（resolve 后结构节点对象引用, i）为键、Phase B 以（节点引用, live 引用, i）为键。合法派生物下同一节点对象与同一 values 游标一一对应（别名表按名共享对象），memo 语义健全，把最坏指数折叠为 O(触及节点数 × 路径长)。§4.9 成本表同步改写为「memo 化后上界」。实现级要求，约 +15 行。 |
| 3 | **MEDIUM-LOW** | §4.1 编排顺序 × §5 AC2-6 行 | `probeRoot(doc)` 先于 Phase A 执行：**schema 已拒绝的路径也会触碰 doc**，且空 doc 上会惰性创建 ROOT Y.Map（写入 `doc.share`）。§5 AC2-6 行声称「零 doc 访问」与编排自相矛盾。副作用经 P4 实证无 update 事件、公共 Yjs API 不可观测，但「被拒路径不触碰 doc」是读取函数更干净的不变量，且重排零成本。 | R3：编排重排——Phase A 谓词先行，通过后才 probeRoot。行为差异仅限「路径非法且 ROOT 载体异型」双坏输入的 message 措辞（同一 code），无契约影响；顺带使被拒路径零 doc 触碰，§5 声明转为真。 |
| 4 | **MEDIUM-LOW** | §3.2 C2 行 × §4.3 × §4.8 分类不一致 | pattern 编译失败/预算耗尽的 C2/C3 归属三处矛盾：§3.2 C2 行列入「pattern 预算耗尽/编译失败」；§4.3 写「→ C2/C3 崩溃边界」；§4.1 顶层 catch 对一切异常统一加 `DOCRT-E100:` 前缀（§3.2 定义为 C3 标记），§4.8 又把 pattern 引擎 throw 列入 E100 收编清单。SA3 无法从文档确定 message 前缀形态。 | R4：统一裁定 pattern 引擎 throw 一律经顶层 catch → C3（DOCRT-E100 前缀，与 §4.1/§4.8 现行伪代码一致，也最诚实——schema 携带不可编译 pattern 属上游缺陷信号）；§3.2 C2 行删去 pattern 两项。纯文档修订。 |
| 5 | **LOW-MEDIUM** | §4.7 vfsl 公共导出形态（SA8 注记 N2 移交项） | `export { match as matchPattern }` 把 3 参签名（必填 `charge: (n:number)=>void`）原样升格为公共契约：charge 是 validate 内部工作预算记账的实现细节，公共消费者被迫传 no-op 才能调用——每个未来调用方都要理解一个不属于其问题域的参数。命名（compilePattern/matchPattern/CompiledPattern）无冲突、无 Yjs 依赖泄漏，唯形态欠公共契约资格。 | R5：改为 index.ts 内 2 参薄包装再导出：`export function matchPattern(compiled: CompiledPattern, input: string): boolean { return match(compiled, input, () => {}); }`（pattern.ts 仍零修改；预算封顶在引擎内部不受影响）。compilePattern/CompiledPattern 维持别名导出。 |
| 6 | **LOW** | §4.3 keyAllowed 伪代码 | `const patternCache = new Map(...)` 在伪代码中的书写位置是模块顶层，注释却声明「每调用局部」。SA3 照抄会得到进程级全局缓存（功能近似等价、增长有界，但违背声明的纪律与 validate compileOrCache 的 per-call ctx 先例，且跨调用共享可变 Map 是多余的全局态）。 | R6：伪代码把 patternCache 移入 readLogicalValueAtPath 函数体（或显式标注为 per-call 闭包捕获）。一行修订。 |

**无 CRITICAL**：未发现 ADR 条款违反、未发现 SA6 冻结契约收窄、未发现静默失败/伪降级路径、未发现 Yjs 泄漏面、未发现竞态（纯同步进程内函数，无共享可变态）。

---

## 协议假设依据审查

**结论：通过。**

- **章节存在性**：§9 存在，含 8 行假设-依据表；本设计纯进程内同步函数，无 HTTP/WS/端口/进程时序假设（§9 末行显式声明，核对属实）。
- **依据可验证性**：全部依据为「源码引用（文件+行号）」或「设计期实测（命令+输出）」。本评审独立复核：
  - `extract.ts L104-105/L115`（get===undefined 缺失检测）、`L127-128`（array walk）、`carrier.ts L52-54`（惰性创建）、`evaluate.ts L51-54/L120/L155/L89-94/L292-296`（四条物化规则行号）——**全部逐行命中，引用无失真**；
  - 探针脚本 `/tmp/probe75/probe.mts` 存在且**本评审重跑成功**（exit 0）：场景 2 索引仅 `ROOT.assets | ref` 一行（无 `.<key>` 行）、`values['Assets']` 携带 keyPattern、结构树 assets 节点无 keyPattern——三项裁决性证据与 §1.2 声明一致，**SA4 可原样复跑**；
  - `pattern.ts` 非锚定搜索语义与 fail-closed 抛错（match JSDoc + L761-773 matchBudget 内部预算）——核实为真。
- **无据推断**：依据栏无「应该/通常/预计」类措辞；两条标「已消除」的风险（索引缺口、双引擎分歧）均有实测/源码闭环。
- 附带核实：§10 caller 审计的 grep 命令重跑结果与声明一致（仅 SA6 两测试文件）；`packages/vfsl/src/index.ts` 现有导出与 `compilePattern/matchPattern/CompiledPattern` 无命名冲突。

## 错误处理链路审查

（本任务为纯同步只读引擎函数，无 UI/异步任务；按立法逐项对照）

- **静默失败检查**：✅ 无静默失败路径。全部失败汇入 `{ok:false, code:'PATH_NOT_ALLOWED', path, message}`，`notAllowed` 恒构造非空 message；无「无请求发出 + 无反馈」形态（无 I/O）。特别核对：required 缺席 → loud C2（**不**冒充吸收式 undefined）——这正是伪降级立法要求的形态，D8 的吸收式严格限定在 optional/合法 Record 键/非负越界三类白名单。
- **状态闭环**：✅ 不适用（无状态机；per-call 局部态）。唯一全局态风险见攻击点 #6。
- **降级路径**：✅ 无外部依赖（进程内、零 I/O），不存在依赖服务不可用场景。C2/C3 防御映射穷举论证成立（§3.2 四方案排除）。
- **虚假降级识别**：✅ 未发现伪降级。重点排查的三处候选均判定为真降级或真拒绝——① 空 doc 惰性 map（D12/P4 实证零事件，extract 同款先例）；② C2「契约外不可达」定性（ADR-0007 不变量条款背书，且仍 loud 返回而非吞错）；③ lockstep 断裂 throw→C3（loud 崩溃边界，符合「溯源上流」要求——断裂只可能来自手造派生物，上游 evaluate 已保证合法派生物不断裂）。**唯一残留**：C2/C3 与 C1 同码的可诊断性完全押在 `message?` 上，而 message 被声明为「非契约字段，消费者不得依赖」——这是冻结联合约束下的最优解，但设计应（随 R4 一并）明确 SA4/SA7 需在日志面消费 message 而非应用面。
- **用户可感知性**：✅ 每种失败模式携带 code + 整条 path 回显 + 非空 message。

## 红线测试思路

（SA6 已冻结 20 用例不可改；以下为 R 修订对应的**新增**测试构想，供 SA1 修订设计时纳入 §5 映射表、SA4/SA7 验证时落地）

1. **R1 — union 成员键空间交叉一致性锁**（防 SA3 按 #1 错误注释实现）：
   fixture `type StrictId = string & Pattern<"^[a-z]+$">; type Mixed = Record<StrictId, YXmlFragment<{p: YArray<YLeaf<string>>}>> | Record<string, YLeaf<string>>; type ROOT = YMap<{items: Mixed}>`，live `items = {BAD: <xml fragment>}`。
   断言：`read(derived, doc, ['items','BAD'])` → `{ok:true, value: <XML 串>}`，且 `extractYjsSnapshot(derived, doc).snapshot.items.BAD` 与之逐字相等（extract ground truth 双向锁）；对照断言 `['items','ok-key']`（两成员都许可）与 `['items','BAD','x']`（成员 1 leaf 下钻拒）行为。
2. **R2 — 重叠联合最坏路径成本护栏**：
   经 ref 别名构造 ~14 层重叠二员联合（每层 `{x: <下一层>, t1: YLeaf} | {x: <下一层>, t2: YLeaf}`），路径 `['x'×14, 'absent']`（末段全拒）。断言：调用在宽松时间预算内返回 `PATH_NOT_ALLOWED`（vitest 默认 5s 即可；无 memo 的 2^14≈16K 尚可过、层级调到 22 便超时——建议直接以 22 层构造使无 memo 实现确定性超时、memo 实现毫秒级完成）。
3. **R3 — 被拒路径零 doc 触碰**：
   `const doc = new Y.Doc(); read(derived, doc, ['nope'])` → `PATH_NOT_ALLOWED` 后，断言 `doc.getMap('ROOT').size === 0` 且（若重排落实）`!( 'ROOT' in (doc as any).share )`——后者触内部字段，可降级为断言「重排后 `doc.destroy()` 前无任何可观测变化」；至少锁 `['nope']` 与 `[]` 两次调用幂等。
4. **R4 — pattern 失败的 message 前缀稳定性**：
   fixture 携带不可编译 keyPattern（如 `Pattern<"("`）且 Record 零键，`read(…, ['recs','any'])` → `PATH_NOT_ALLOWED`，断言 `result.message` 以 `DOCRT-E100:` 开头（若 SA1 采纳 R4 裁定）——防止 SA3 按 §3.2 C2 行产出无前缀 message 造成分类漂移。
5. **R5/R6 — 无新增行为面**：R5 由 `tsc` 签名断言覆盖（`matchPattern(compiled, 'k')` 双参可调）；R6 靠 SA4 代码审查（per-call 缓存无模块级可变态）。

---

## 复审指引

- **驳回范围**：仅 R1–R6 对应的 §4.4 注释、§4.5 补论证、§4.9 成本表 + memo 要求、§4.1 编排顺序、§3.2 C2 行、§4.7 导出形态、§4.3 伪代码位置。其余 592 行中 SA1 已论证充分的部分（§0 通过项清单）复审时不再重查。
- **严重度对照**：#1/#2 为 MEDIUM（SA3 照现文档实现会产生错误行为/DoS 面）；#3–#6 为文档级一致性修正。无任何修订触碰冻结契约、公共签名（FC-1/FC-2/FC-6）或 ADR 条款——修订后架构与本次被验证通过的形态完全一致。

## 附：本评审验证证据（命令 + 结果）

| 验证 | 命令 | 结果 |
|---|---|---|
| 探针可复现 | `./node_modules/.bin/tsx /tmp/probe75/probe.mts`（worktree 内） | exit 0；场景 2 索引仅 `ROOT.assets \| {"match":"exact","nodeKind":"ref"}` 一行；`values['Assets']` 携带 keyPattern；与 §1.2 声明一致 |
| caller 审计 | `grep -rln "readLogicalValueAtPath" --include="*.ts" packages/ apps/` | 仅 SA6 两测试文件（与 §10 一致） |
| pattern 预算内部性 | pattern.ts L761-773（matchBudget/tick）、L895-907（match 构造 MatchCtx 含 budget） | 预算引擎内部、charge 仅记账；no-op charge 不失封顶 |
| validate 同源 | validate.ts L271-279（compileOrCache + match 直调） | 与 §4.3 keyAllowed 同 compile/match/语义 |
| E309 禁混合联合 | resolve.ts L159-171（fold throw） | union 成员键空间/形态对齐有不变量背书 |
| evaluate 行号引用 | L51-54 / L89-94 / L120 / L155 / L292-296 逐行读 | 与设计 §1.2 引用零失真 |
| extract 设计文档引用 | `sed -n '550,560p' wiki/raw/task_doc-runtime-extract-yjs-snapshot_design.md` | P7「插入序稳定、覆写不换位」在 §4.9 表内（约 L553-555） |

---

# SA2 复审（R2 轮）— R1–R6 修订验收

**Date**: 2026-08-22
**复审范围**：R1 轮约定——仅限 R1–R6 对应节（§3.1 消费面约定 / §3.2 / §4.1 / §4.3 / §4.4 / §4.5 / §4.7 / §4.8 / §4.9 / §4.10 / §5.1 / §6 INV-10·11 / §10 / §11 / 决策总表 D13–D15 / 回应表）；R1 轮 §0 通过项不再重查
**被审版本**：`wiki/raw/task_read-logical-value-at-path_design.md`（592 → 703 行，含「SA2 反馈逐条回应」表）

**Verdict: pass** ✅（六项修订全部落实且技术核验通过；放行进入 SA3 实现）

## 逐项验收

| 要求 | 验收结论 | 独立核验依据 |
|---|---|---|
| **R1**（#1 MEDIUM）§4.4 注释修正 + §4.5 键空间交叉论证 | ✅ 落实 | §4.4 Record 分支注释改为「any-of 键空间并集 + Phase B 有意零 keyPattern 检查」并显式警告照抄旧注释的后果；§4.5 新增整节（D15），反例 fixture（`Mixed = Record<StrictId, YXmlFragment> \| Record<string, YLeaf>` + live `{BAD: <xml>}`）为合法 schema（两成员均 map 形，E309 通过），Phase A/B/extract ground truth 三方走查与本评审 R1 轮独立推演**逐字一致**——成员 0 经 walk `toString()` 胜出与 extract walkUnion「Record 形成员试验 = 直接 walk + 零 pattern 消费」（extract.ts L195-199/L100-110，R1 轮逐行核实）同源；反事实分歧论证正确；「非 union 位单 Record（AC2-5）键空间唯一、并集 = 自身」边界补注正确；SUP-1 锚点（extract 双向锁）正确收纳本评审红灯构想 1 |
| **R2**（#2 MEDIUM）per-call memo + §4.9 memo 化上界 | ✅ 落实 | D13 入表；memoA/memoB 在函数体内创建；isPathAllowed/resolveLive 重构为 memo 挂点 + decide/navigate 内函数（下钻一律回 memo 入口，声明正确）；**健全性论证独立核验通过**——单次调用内 `segs[i]` 由 i 唯一决定，(node, i) 纯函数的前提「同节点 ⟹ 同 values 游标」成立（节点共享仅可能经别名表：evaluate 每语法位置物化新对象 L51-54/L120/L172-181；同名 ref 两树解析到同一对别名条目）；Phase B 键含 live 引用、`fullPath` 仅影响 issue 渲染且 issue 坍缩为 `{ok:false}` 不影响值语义、Map SameValueZero 对 -0/NaN live 值行为安全；`hit !== undefined` 正确区分缓存 false 与未命中（经典 memo 陷阱已避）；§4.9 成本表改写为多项式上界并保留 2^n 反例可达性论证，「SA3 强制项」措辞明确；§4.10 memo 确定性注记正确（不改判定路径/声明序/首产出者裁决）；SUP-2 锚点收纳构想 2 |
| **R3**（#3 MEDIUM-LOW）Phase A 先行、probeRoot 后置 | ✅ 落实 | §4.1 伪代码重排核实：被拒路径返回点在 probeRoot 之前（「此刻 doc 未被触碰」）；行为差异分析正确（仅「路径非法且 ROOT 异型」双坏输入的 message 措辞，同 code）；D14/INV-10/§4.8/§5 AC2-6 行（「零 doc 触碰……字面为真」）全链一致；AC1-3（空 doc + `[]`）路径不受影响（Phase A 放行后才 probe）核实无误；SUP-3 锚点收纳构想 3（断言经测试侧 getMap 触发的惰性创建不破坏 `size === 0`，可观测面成立） |
| **R4**（#4 MEDIUM-LOW）pattern throw 统一 C3 + message 消费面 | ✅ 落实 | §3.2 C2 行已删 pattern 两项、C3 行增列（「上游缺陷信号」定性准确——evaluate 只存 regex 不编译，不可编译 pattern 经 parse/evaluate 无障碍携带，compile 只在 read/validate 触达时发生）；§4.3/§4.7/§10 三处统一为 C3 + `DOCRT-E100:` 前缀，本评审 grep 复核**全文档无 C2 残留**（D6 行「引擎预算耗尽」为跨 C2/C3 的映射层举例且显式指向 §3.2 权威表，非矛盾）；§3.1「消费面约定」（应用逻辑只依赖 code/path；message 归日志/诊断面）回应了本评审错误处理链路节的附注；SUP-4 锚点可行性核实（`Pattern<"("` 经 parseVfsl/evaluate 无障碍，derived 携带坏 regex 至 read 编译点） |
| **R5**（#5 LOW-MEDIUM）matchPattern 双参薄包装 | ✅ 落实 | §4.7 导出块为 index.ts 内 `(compiled, input) => boolean` 包装（charge no-op 封装），pattern.ts 零修改，引擎内部 matchBudget 封顶不受影响（R1 轮已核实预算为 match 内部机制）；D3/A6/§8/§10（拆两行）/ALLOW LIST（≤14 行）全链一致，本评审 grep 复核**全部引用均为双参形态**、无 3 参残留；SUP-5 锚点收纳构想 5 |
| **R6**（#6 LOW）patternCache per-call | ✅ 落实 | §4.1 在函数体内创建并注释「禁模块级可变态」；keyAllowed 改经参数接收 `pc`；§4.10/INV-11 模块级零可变态；SUP-6 归 SA4 审查项——书写位置与声明矛盾消除 |

## 复审中的新增观察（非阻塞，供 SA3/SA4/SA7 参考）

1. **SUP-2 层数调参**：2^22 ≈ 4.2M 次节点访问在 V8 上约 0.5–4s，对 vitest 默认 5s 超时未必「确定性超时」。SA4/SA7 落地时建议 24–26 层（2^24–2^26 = 17M–67M）+ 断言完成时间上限（如 <1s），使无 memo 基线确定性出局、memo 实现毫秒级通过。测试构造细节，不影响设计裁决。
2. **§4.7 导出块小冗余**：`import { compile, match }` 行中 `compile` 仅经再导出行使用，import 行可只留 `match`。SA3 落笔时自然消除，无需设计修订。
3. **D6 行措辞**：摘要级举例含「引擎预算耗尽」而权威分类在 §3.2（已统一 C3）——D6 是「映射到单一 code」的决策行，跨类举例 + 「详见 §3.2」指针不构成矛盾，维持现状可接受。

## 结论

六项修订全部按 R1 轮要求落实，且两项技术核心（R1 的 extract 一致性走查、R2 的 memo 健全性论证）经本评审独立重推演确认无误；修订未触碰冻结契约（§3.1 签名与结果联合逐字不变、SA6 双文件仍 SA6 owned）、未引入新的矛盾或行为回归；新增 ALLOW LIST 项（supplementary 测试文件，SA4/SA7 owned、SA3 不编写）是本评审红灯构想的合规落地载体，无范围越界。

**R2 轮裁决：pass——设计放行，进入 SA3 实现。** 后续验证责任移交：SUP-1–SUP-6 锚点归 SA4（静态 + 补充测试落地）与 SA7（活链路）；`pass` 不替代实现层验证。
