# 相关决议 (Relevant Decisions) — 全链 SA 复用（修订轮 rev2）

> SA8 前置门禁产出（修订轮 rev2）。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 任务：union 仲裁回归测试变异判别力补缺——三态仲裁抽包内纯函数 seam + 表驱动测试 + R1/R2/R3 措辞改写 + mutation proof（Issue #75 rev2 / PR #83 owner 第二轮 Review，**深度重构（可测性重构 + 测试硬化）**，run_id `issue-75-rev-1787397220`）。
> 冲突基准：`docs/adr/` 全集（0001–0007，共 7 份，逐份全文读取，无抽样）+ `CONTEXT.md`。
> **与 rev1 的关系**：ADR 与 CONTEXT.md 自 rev1 门禁后零变更（7 份 ADR + CONTEXT.md 同批 2026-08-22 15:28 落盘，`git log -- docs/adr/ CONTEXT.md` 最新提交 `ee3643c` 早于 rev1 全部工作提交，`git status` 干净）——rev1 `task_read-logical-value-at-path_rev1_relevant_decisions.md`（含其复用的首轮全量摘录）**原样复用**。本文件不重复全量盘点，聚焦 rev2 差异：**包内纯函数 seam 与 INV-14 的相容性事实**、D17 声明序与短路惰性、D13 memo 护栏、DENY 面延续；补充 owner 第二轮 Review 引入的新约束（标注出处，非 ADR）。

## 相关 ADR（rev2 聚焦条目；完整摘录见 rev1/首轮文档）

### ADR-0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted，2026-08-22）

**与本修订轮的关联点**：rev2 改动全部位于本 ADR 定义的 `@nomicore/doc-runtime` 包内部——`read.ts` union 分支的仲裁循环抽取为包内纯函数 seam；公共条款与公共接缝零改动。

核心条款（原文摘录）：

- 「`readLogicalValueAtPath(derived, doc, path)`：同步按路径读取，只转换目标子树；依赖 create/open/update 已建立并维持的结构不变量，普通读取不重复验证。空路径表示显式读取整个 ROOT；合法 optional/Record/数组缺失返回 `undefined`。」
- 「`@nomicore/vfsl` 继续保持无 Yjs 依赖；持久层继续不理解 VFSL。新包 `@nomicore/doc-runtime` 依赖 `@nomicore/vfsl + yjs`，提供：」——其后列出的四个公共能力（`extractYjsSnapshot` / `materializeRoot` / `readLogicalValueAtPath` / `applyValidatedMutation`）即包的公共提供面；包内内部结构（helper、内部类型、内部函数）属其下实现粒度，ADR 未设额外条款。
- 「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型；NamespaceRuntime/Registry 再映射成稳定的 create/open/mutation 上层错误。逻辑校验保留完整 issues，Yjs 结构与路径/操作错误 fail-fast。」——`NavOutcome` 三态即 read 领域的**包内**结果联合；「不合并成巨型 issue 类型」同时禁止把 missing/reject 并入 issues 体系。
- 「普通读取成本与目标 path 子树规模相关；首版 mutation 为正确性执行完整 ROOT 提取与逻辑校验，性能优化必须在行为等价测试下后续引入。」——seam 抽取后读取成本仍须与目标 path 子树规模相关（H-a 护栏锚点）。
- 「加载和更新负责验证，读取按 path 快速执行，不重复全树验证。」
- 「成功只返回 `{ ok:true }`，不返回 snapshot、Yjs update 或内部类型。」（mutation 条款；家族级原则佐证：公共接缝不泄漏内部类型——与 INV-14 同精神。）

### ADR-0003 求值器与派生 schema（accepted，2026-08-19）

**与本修订轮的关联点**：seam 抽取不改 union 仲裁语义（D17 四规则原样）；派生 schema 形状不动。

核心条款（原文摘录）：

- 「基础表示：`{ kind: 'union'; members: StructureNode[] }`；匹配语义 **any-of**（至少一个成员接受即接受——重叠成员不构成错误）；路径存在性为**任一成员出现即存在**；」——value-first 仲裁（含「前序 missing 后继续、后序真实 value 胜出」）是该条款在读取维度的兑付；表驱动首行 `[missing, value('v')] → value('v')` 锁的正是它。
- 「判别式检测（派生）：存在一字面量字段在全体成员中两两互异 → 附非契约缓存 `discriminator`，O(1) 跳转；**缓存的缺失/存在不得改变任何可观测行为（含错误输出）**——映射未命中回流同一诊断生成器；」——读取零判别式消费（INV-4/D5），seam 不触。
- 「派生 schema 照搬 IR 的模块形状：别名表 + ref 节点 `{ kind: 'ref'; name }`；引用**不内联展开**，解析动作由**包内共享解析器**完成（复用 shapes.ts 的 clsOf/memo 模式）。」——「包内共享/导出、不经公共 barrel」是任务族既有模式先例（另见下文 extract.ts `walk`/`makeRefResolver` 先例）。
- 派生 schema 纪律：「纯数据、可 JSON 序列化、可内容哈希、不携带行列位置」——rev2 不要求改 `packages/vfsl` 派生物形状（DENY 延续）。

### ADR-0004 vfsl-protocol 类型投影（accepted，2026-08-19）

- D3「全部内容为类型空间产物……编译后为空模块，零依赖、零运行时代码」——不构成 doc-runtime 运行时约束（沿首轮/rev1 注记 C）。
- D4「vitest typecheck 模式；正例用 `expectTypeOf`……负例用 `@ts-expect-error`」——test-d 冻结形态锁的方法学出处；rev2 要求该锁保持绿（AC-R2-1）。

### ADR-0006 Cordis 持久化插件与 doc 三条目布局（accepted，含修订节）

- 「META/SCHEMA 作为 ROOT 的兄弟条目，天然在 validateSnapshot/validatePatch 的校验面之外（校验只作用 ROOT 子树）。」——rev2 读取面仍止于 ROOT 子树，不触。

### ADR-0001 / ADR-0002 / ADR-0005（accepted）

与本修订轮无新增关联（同 rev1 结论：背景约束 / 写入管线无交集 / codegen 无交集）。摘录与首轮文档一致，不重复。

## rev2 新增关联：任务族内规（非 ADR 冲突基准，出处标注）

> 以下规则属既有设计/实现层，**不构成 ADR 冲突基准**（SA8 只以 ADR + CONTEXT.md 为基准）；但 rev2 简报 AC-R2-1 明确以其为约束（「INV-14 不破坏」）——SA1 设计必须显式调和。

### INV-14 三态不泄漏（rev1 设计 §6 不变量表；裁决见冲突报告）

- 原文：「INV-14（rev1）| 三态不泄漏：`NavOutcome` 包内私有；missing/reject 不进公共联合、不进 issues 体系；顶层映射恒收束到冻结两态 | test-d 冻结形态；SA8 注记 3」
- rev1 风险清单 H-3（§3.5）：「三态泄漏公共联合（实现者诱惑：把 missing/reject 加进 `ReadLogicalValueResult` 或 issues 体系）| 契约面禁止 | INV-14（§6 不变量表）；SA8 注记 3；test-d 冻结形态锁」
- 现行代码注记（read.ts `NavOutcome` 声明处 JSDoc）：「包内私有类型——公共结果联合冻结为两态，missing/reject 不得泄漏（INV-14，SA8 注记 3）」
- **关键语义辨析（供 SA1/SA2/SA3 对照）**：INV-14 的约束单位是**包边界**（`packages/doc-runtime/src/index.ts` 公共导出面），不是**模块边界**（src/ 内单文件）。「包内私有」= 不经 index.ts 转出口；模块级 `export`（如从 `read.ts` 或包内新文件导出 `arbitrateUnion` / `NavOutcome` 供同包测试 deep import）仍属包内私有。**先例**：rev1 设计 §8.2——「`packages/doc-runtime/src/extract.ts` — 首轮落地（`walk`/`makeRefResolver` **包内导出**，≤8 行）；rev1 零改动」——经 SA2/SA4 评审与 owner rev1 Review 确认的同一模式。
- 现行公共面事实（2026-08-22 实测）：`packages/doc-runtime/src/index.ts` 全部导出为 `extractYjsSnapshot` / `ExtractIssue` / `ExtractResult` / `readLogicalValueAtPath` / `ReadLogicalValueResult` 五项——零 `NavOutcome`、零仲裁函数。test-d 冻结形态锁（`read-logical-value-at-path.test-d.ts`）从 `../src/index.js` 导入并锚定签名与两态联合。

### D17 union value-first 仲裁四规则（rev1 设计 §3.2；rev2 seam 必须逐字保持的语义）

- 「(1) 首个真实 value 胜（声明序）；(2) missing 不胜出、继续后序成员；(3) 无 value 且有 missing → missing → 顶层 `{ok:true, value:undefined}`（value 键显式构造）；(4) 全 reject → `PATH_NOT_ALLOWED`（D6 单通道）。」
- 现行实现位（owner 指认被测核心）：`packages/doc-runtime/src/read.ts` `case 'union'` 分支（约 351–360 行）——`sawMissing` 标记 + 声明序 `for (const m of node.members)` 循环 + 首 `kind:'value'` 即 return。
- mixed 优先级（§3.3）：**value > missing > reject**——表驱动六行中 `[missing, reject] → missing` 与 `[reject, missing] → missing` 锁该规则。

### INV-7 精确化（rev1 设计 §3.3.3，normative）

- 「可产出 = 产出真实 value（`kind:'value'`）；missing 不构成胜出，仅记入可行缺席集合；value 平局按声明序取首者。提交层（extract `walkUnion`/INV-8）『首个接受者胜』语义不变。」
- rev2 简报 AC-R2-1 尾句「声明序迭代与首 value 短路惰性（不预先消费后序成员）语义不变」即本条 + D17 的可测性重述：`Iterable<NavOutcome>` 形态的 seam 必须**惰性消费**（首 value 短路时不拉取后序成员）——预先物化数组（如 `Array.from(outcomes)`）即破坏短路惰性。

### D13 memo 健全性与成本护栏（rev1 设计 §3.4）

- 「memo 语义成立的条件是『键完全决定值』。Phase B 键 = `(resolve 后节点引用, live 引用, 深度 i)`……union 节点自身的组合结局（value-first 聚合）同样只依赖成员结局的确定序列 → 仍是纯函数 → memo 命中返回等价结果。**结论：健全性论证原样成立，零新假设。**」
- 成本上界（不变）：O(触及节点数 × 路径长 × 成员扇出)；H-a 护栏（26 层链 × 中段 optional 缺席 <2s）为锚点。
- rev2 约束：seam 抽取不得破坏 per-call memo 挂点（入口/出口仍锚在 `resolveLive`）；仲裁函数纯化不改变成员试探序列 ⟹ 上界同式。

### INV-13 观测等价定理（rev1 设计 §3.5）

- 「对一切合法输入（合法 derived（parseVfsl+evaluate 产物）× 任意 live doc）且不触发崩溃边界（E100）的调用，修订前后 `readLogicalValueAtPath` 返回**逐字相同**的结果。」
- rev2 是纯可测性重构：对合法输入零可观测行为变更（AC-R2-1「语义不变」+ AC-R2-5 不回归锁共同兑付）。

### 首轮冻结契约（SA6 Phase 1 锚定；rev2 不得收窄）

1. 公共接缝：`readLogicalValueAtPath(derived: DerivedSchema, doc: Y.Doc, path: readonly (string | number)[])` 经 `packages/doc-runtime/src/index.ts` 导出；同步、不抛错。
2. 结果联合两态：`{ ok: true; value: unknown } | { ok: false; code: 'PATH_NOT_ALLOWED'; path: readonly (string | number)[] }`（+D5 `message?` 非契约诊断字段）。
3. AC3 缺键形态：`{ ok: true; value: undefined }`——value 键必须显式存在且为 undefined（禁省略键）。
4. 无 Yjs 泄漏；XML 字符串投影只承诺语义等价。
5. AC6 行为锚点：目标子树读取只返回目标子树；坏兄弟子树不影响目标读取；返回值修改不影响 live doc。

### DENY 面（rev1 延续，rev2 简报明文重申）

- `packages/vfsl/src/**`（pattern.ts / evaluate.ts / derived.ts / validate.ts / envelope.ts 等）——派生 schema 冻结形状与校验语义不动；**不得为「凑测试」虚构可达性而放宽结构系统**。
- `packages/doc-runtime/src/extract.ts` / `carrier.ts` / `index.ts` 的行为变更（rev1 表述为「rev1 新增改动」禁止；rev2 收紧表述为「行为变更」禁止——index.ts 叠加「公共导出零新增」，AC-R2-1）。
- `packages/doc-runtime/src/read.ts` 中 Phase A 全部（`isPathAllowed`/`decide`/`makeValuesResolver`/`vChild`/`keyAllowed`）、`notAllowed`（含 SA4-F2 守卫）、顶层 try/catch 编排。
- 例外注记：extract.ts 首轮已落地的 `walk`/`makeRefResolver` 包内导出属首轮已评审范围，rev2 对 extract.ts 的禁止是「本轮新改动为零」，不要求回退既有包内导出。

### SA6 owned 测试文件纪律（rev2 简报末条）

- rev1 已入库测试（含 `read-logical-value-at-path-rev1-union-arbitration.test.ts` 18 绿灯行为锁，commit `23851e1`）的行为断言 SA3 不得改；rev2 措辞勘误（AC-R2-3：文件头注释 + describe/it 措辞）由 SA6 执行，行为断言零改动。

## CONTEXT.md 相关术语与惯例（同 rev1 摘录，rev2 无新增触点）

- **判别联合（discriminated union）**：「字面量联合字段（如 `kind`）区分的变体；引擎自动识别判别字段并按变体验证。」
- **封闭对象（closed object）**：「子集内对象类型默认封闭：未声明字段拒绝。」
- **结构树（structure tree）**：「Yjs 物化语义（kind / storage / opaque），供路径下钻守卫；与值语义正交。」
- **路径索引（path index）**：「路径 → 子 schema 的下钻索引，键匹配（exact / pattern）为标准能力。」_Avoid_: resolveChild 三级前缀匹配
- 其余术语（标记类型 / ROOT / 派生 schema / 逻辑快照校验 / 命名空间 / 信封）：摘录与首轮/rev1 文档逐字一致，不重复；rev2 不新命名任何公共术语。

## rev2 验收要求速览（摘自 rev2 简报，供 SA1/SA2/SA6 对照；裁决见 `…_rev2_conflict_report.md`）

- AC-R2-1: 三态仲裁抽为包内纯函数（如 `arbitrateUnion(outcomes: Iterable<NavOutcome>): NavOutcome`）或等价可控包内测试 seam；`read.ts` union 分支经该 seam 仲裁；INV-14 不破坏——seam 与 `NavOutcome` 保持包内私有（index.ts 公共导出零新增，test-d 冻结形态锁保持绿）；声明序迭代与首 value 短路惰性语义不变。
- AC-R2-2: 表驱动包内仲裁测试六行全齐（首行 `[missing, value('v')] → value('v')` 必须证明前序 missing 后仲裁继续、后序真实 value 胜出）。
- AC-R2-3: R1/R2/R3 测试说明改写为「现行合法 schema/live 模型下不可构造竞争场景的行为一致性锁」，删除「动态覆盖 missing → later value」宣称；行为断言零改动。
- AC-R2-4: mutation proof 留证——临时变异「首 missing 即返回」→ 新增纯仲裁测试转红（并记录 R1/R2/R3 仍全绿的对照事实）→ 还原 → 全量复绿；证据入 SA7 报告。
- AC-R2-5: 不回归既有测试（rev1 五组绿灯锁 + H-a/H-b/H-c 护栏 + SUP 系列 + 全仓其余套件）；`packages/doc-runtime` patch bump 0.1.3 → 0.1.4（硬门禁 #9）；DENY 面零改动。

## SA1 rev2 设计引入的新决策点（设计后复审追加；出处 `…_rev2_design.md`，非 ADR——供 SA2/SA3/SA4/SA7 复用）

- **D19（seam 落位）**：`arbitrateUnion(outcomes: Iterable<NavOutcome>): NavOutcome` 与 `NavOutcome` 自 `read.ts` **模块级导出**（签名逐字冻结；落位紧随 `NavOutcome` 声明）；备选「包内新文件 + 转出口」「经 index.ts 公共导出」均被显式否决（后者违 INV-14）。INV-14 判据精确化成文：约束单位 = **包边界**（不经 index.ts 转出口），模块级 export 属包内私有。deep import 破例仅限同包测试（SA8 注记 R2-1 批准），**包外零授权**，未来任何测试 deep import 包内模块须同等明文授权。
- **D20（惰性仲裁管线）**：union 分支经包内私有 generator `memberOutcomes`（不导出）喂 seam；**normative 禁物化禁令**——seam 内与调用点均禁 `Array.from` / 数组展开 `[...]` / `.map()`；调用点惰性纯测试锁不到（观测等价必然的诚实缺口），以 normative 伪代码 + SA4 静态 grep（union 分支区域 `Array.from|\.map\(|\[\.\.\.` 零命中）+ 评审三重防御。
- **D21（mutation proof 协议）**：M-A「首 missing 即返回」唯一必做（施于 seam 内 ≤2 行，ALLOW 面内），预期红 = rev2 纯测试行 1/3/5，对照 R1/R2/R3 及全包其余套件仍全绿；Phase 2 `git checkout` 还原 + `git diff --stat` / `git status --porcelain` **空输出硬验收** + 全量复绿；**变异态严禁 commit/push**（中断恢复第一步 `git status`）；证据入 SA7 报告。M-B/M-C/M-D 可选（SA7 裁量，同款还原纪律）。
- **INV-15（仲裁单点权威）**：read.ts union 分支成员结局聚合**唯一**经 `arbitrateUnion`；seam 零 doc / 零 memo / 零模块级状态访问；惰性契约由纯测试拉动断言锚定。验证锚：rev2 纯测试行 1-6、SA4 静态验尸（无第二仲裁实现、无物化调用形）、M-A 单点变异全路径转红。
- **H-d（可选负锁，非 AC 义务）**：`read-logical-value-at-path-rev2-inv14-negative.test-d.ts` 新建（SA4/SA7 裁量、SA3 不编写）——`@ts-expect-error` 断言 seam 不在公共 barrel（方法学出处 ADR-0004 D4）；不改既有 test-d 冻结文件。
- **版本面**：`packages/doc-runtime` 0.1.3 → 0.1.4（仅 version 字段）；diff 基线 = `7f77384`（SA6 红灯锚定入库点）。
- 设计后复审裁决（`…_rev2_design_conflict_report.md`，verdict **clear**）：上述决策点与 ADR 全集 + CONTEXT.md 零冲突；「载体迁移、零语义变更」经代码逐行对照成立（seam 函数体 = read.ts:351-360 现行内联循环逐行同构）。
