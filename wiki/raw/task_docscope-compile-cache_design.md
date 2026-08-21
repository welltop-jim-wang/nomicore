# SA1 设计 — DocScope 作用域绑定与编译缓存（H3 / issue #54）

- 任务：功能开发（Feature）· `getCompiled(input)`（信封或文本）→ `{ module, derived }` 的按文本内容哈希编译缓存
- 依据：任务简报 `wiki/raw/task_docscope-compile-cache.md`（含 SA6 测试设计节）；`task_docscope-compile-cache_relevant_decisions.md`（ADR-0001/0003/0005 摘录为约束基准）；`task_docscope-compile-cache_conflict_report.md`（verdict: clear + 四条非阻塞提示）；`task_docscope-compile-cache_design_conflict_report.md`（SA8 设计后复审 verdict: clear，边缘项 #7–#12）；SA6 红灯测试 `packages/vfsl/test/docscope-getcompiled.test.ts`（13 用例，§11 修正后仍为构造性红灯 12F/1P）；SA2 评审 `task_docscope-compile-cache_sa2_review.md`（R1 verdict: reject——A1 CRITICAL / A2–A4 MINOR / N1·N2 NOTE，本版逐条落实，见「SA2 反馈逐条回应」）
- 状态：**R2（SA2 reject 后首修）** · 2026-08-21 · SA1
- 冻结接缝（本设计不改其契约）：`parseVfsl` / `evaluate` / `validateSnapshot` / `validatePatch`（ADR-0003 §1）；`parseSchemaEnvelope`（H1 / issue #52，内部结构微重构、行为逐字节不变，见 D5——SA2 已逐语句比对确认同构）

## 摘要（一页看懂）

在 `@nomicore/vfsl` 公共面新增**同步**函数 `getCompiled(input)`：输入为信封（经 H1 前探门：形状 → 方言断言）或裸文本（隐式 vfsl@1），以 `sha256(text)` 为键查进程级无淘汰 Map——键的**字节化是单射的**：合法码点按 RFC 3629 UTF-8，未配对代理（lone surrogate）按 WTF-8 区别性段 `ED A0 80–ED BF BF` 编码（R2/A1：该段与一切合法码点的规范 UTF-8 输出不相交，键映射在**全 JS 字符串空间单射**——`'\uD800'`/`'\uDC00'`/`'\uFFFD'` 三者键互异，INV-2 的编码层兑现）；命中直接返回缓存的 `{ ok:true, module, derived }` 同一对象引用（零 parse / 零 evaluate）；未命中执行一次 `parseVfsl + evaluate`，**只存 ok 分支**（深冻结后入册），失败经返回值透传、不落缓存（可重试语义）。**getCompiled 全函数体顶层崩溃边界**（R2/A2：与 H1 同结构，ENV-100 单点构造，绝不外抛）。哈希用**包内纯 TS 实现**（零新运行时依赖、零环境绑定），由设计强制的四类守卫测试锚定：FIPS KAT + 键单射性/攻击对（§5.4，RT-1）、崩溃边界（§5.5，RT-2）、冻结条目×校验接缝等价（§5.5，RT-3）。

SA6 红灯测试 R1 期上报的三处 fixture 缺陷（§11）**已由 SA6 按最小修正案执行完毕**（当前测试文件 :111 `TEXT_HIT` / :114 `TEXT_RETRY` / :319 case-3 `lang:'wml'`；SA8 设计后复审登记 + SA2 直读双重核实）；修正后 13 用例在本设计下全绿的逐用例推演见 §11.4。

### 决策总表

| # | 决策 | 一句话理由 | 被否方案 |
|---|---|---|---|
| D1 | **同步**接缝 | 组合的全链条（parseSchemaEnvelope / parseVfsl / evaluate）皆同步纯函数；ADR-0005「async 从第一天起」约束的是 SchemaSource（网络 I/O 上游），不是内存 CPU 编译本体（SA8 边缘项 #11 认同） | async 包装（无 I/O 可等的伪异步） |
| D2 | 缓存键 = `sha256(text)` **纯文本内容**（单射字节化），不含 id/lang/载体 | 简报与 AC1 锚定「键 = 文本内容哈希，非 id/载体」；ADR-0005「id 是标签不是键」；**键映射全字符串空间单射**（R2/A1：WTF-8 兑现，见 D8.2） | id 键控（复活 SCHEMA_REGISTRY 语义）；U+FFFD 替换编码（R1 原案——`'\uD800'`/`'\uDC00'`/`'\uFFFD'` 坍缩同键 → 静默错数据，SA2 A1 否决）；入口预扫响亮拒绝（方案乙——getCompiled 与 parseVfsl 对此类输入行为分叉，见 D8.3） |
| D3 | 包级单册（模块级 Map），v1 无淘汰 + 注释论证 | 编译是文本的纯函数，内容寻址条目跨命名空间共享零污染；进程内命名空间数有界（SA8 边缘项 #7 认可） | per-DocScope 实例（v2 演进项，见 §12）；LRU/TTL（v2 淘汰策略） |
| D4 | **只存 ok 分支** + 入册前**深冻结** | ADR-0003 结果联合的自然投影（AC5 可重试）；共享引用防变异（冲突报告提示 #4，SA8 复核 3 认可），ESM 严格模式下变异即 loud TypeError | 也缓存失败（破坏可重试）；不冻结（纯文档契约——被共享缓存升格的突变后果否决，见 D4.3） |
| D5 | H1 内部抽 `envelopeTextGate`（形状→方言→信封）共享前探门 | 信封路径命中时免重复 parseVfsl（命中 = O(hash)，ADR-0001「性能依赖编译缓存」的忠实执行）；编排单点，杜绝校验决策点分叉（SA2 已逐语句比对确认同构） | 整体委托 parseSchemaEnvelope（信封命中仍要全量重 parse，缓存沦为只省 evaluate 的半吊子）；docscope 自行重组校验（分叉 + 崩溃边界缺口） |
| D6 | 文本路径：`typeof input === 'string'` 直入 parseVfsl（隐式 vfsl@1） | 文本无自述方言，无可断言对象（SA8 边缘项 #8 认可）；parseVfsl 即 vfsl@1 解析器——AC1.3「信封/文本同键」与边界用例 kind:'vfsl' 的机制根基 | 给文本包一层伪信封（造不存在的方言声明） |
| D7 | 失败统一 `SchemaParseIssue[]`（信封拒绝 gate 原样 / parse、evaluate 失败经 `vfslIssues` 包装，message 零损） | 与 H1 issues 域同构；AC4「与 parseSchemaEnvelope 同输入全等」、AC5「注入标记透传」的结构保证 | 各路径异构 issues 类型（消费者穷举负担） |
| D8 | sha-256 包内纯 TS：合法码点 RFC 3629 + **lone surrogate WTF-8 区别性段**（R2/A1），KAT + 单射守卫锚定 | `lib:["ES2022"]` 无 DOM 且 @types/node 不声明全局 `TextEncoder`（§9 #4 实证）；`node:crypto` 会造成引擎包第二个环境绑定面，违 index.ts:24-26「唯一环境绑定面」不变量——仓内 sha-256-of-text 先例在 **codegen 工具包且绑 node**（R2/A3 修正盘点），恰是引擎包须自包含的对照论据；**单射性是键正确性的编码层前提**（A1 攻击链：替换编码下 doc 注释/字符串字面量中相差 lone surrogate 的两条合法文本共享条目 → 静默错数据，违 INV-2） | node:crypto；TextEncoder；不哈希直接用文本作 Map 键（违简报 sha-256 条款）；U+FFFD 替换编码（R1 原案，A1 否决） |
| D9 | 命中返回缓存容器本体（`CompiledOk` 对象即缓存条目） | AC1 断言容器/module/derived 三重引用同一——条目即返回值，无二次包装 | 命中时新建容器（容器引用断言红） |
| D10 | getCompiled 编排落位 index.ts（与 parseVfsl/parseSchemaEnvelope 同址），哈希独立叶子模块 `sha256.ts` | envelope.ts:6-7 既有约定：编排函数在 index.ts 同址，子模块零 index 依赖避免模块环；docscope.ts 单独建文件会引入 docscope↔index 环 | 新建 docscope.ts 导入 index（模块环，违仓例） |
| D11 | **getCompiled 全函数体顶层崩溃边界**（R2/A2 新增）：整体 try/catch → ENV-100 结构化返回 | §4.1「不抛错（崩溃边界同 H1）」从「依赖下游接缝永不缺陷」的隐含前提，升格为与 parseSchemaEnvelope 同款的结构性承诺；当前无可触发输入（SA2 已核查），边界属实现缺陷信号 | 仅包 gate 调用（R1 原案——文本通道与 ②③④ 阶段无兜底，A2 否决）；裁剪 §4.1/INV-6 承诺措辞（让公共契约弱于 H1 无必要） |

---

## §1. 背景、授权链与现状盘点

### 1.1 ADR 授权链（设计必须遵守的约束基准）

| ADR 条款 | 对本设计的约束 |
|---|---|
| ADR-0001 Consequences「引擎必须在运行时解析任意合法方言文本，性能依赖**按内容哈希的编译缓存**」 | 本任务的直接立项依据；缓存必须真实省掉重复编译（→ D5 命中免 parse） |
| ADR-0001「未知方言 loud-fail 只读」「方言只增不改」 | 未知方言经 H1 断言通道拒绝、不进缓存（AC4）；方言断言先于文本解释 |
| ADR-0001「本仓库是纯引擎仓库：代码库不含 schema 文本（测试 fixture 除外）」 | 实现与测试不引入仓内 schema 资产；fixture 文本仅存测试 |
| ADR-0003 §1「`evaluate(module) → { ok: true; derived } \| { ok: false; issues }`」「可失败是前向兼容设计：调用方从第一天写 ok 检查」 | 缓存值只存 ok 分支；getCompiled 失败也走返回值联合（不抛错）——AC5 的语义根基 |
| ADR-0003 §1「`parseVfsl` / `evaluate` … 以各自 Interface 作为公共观察点」+ 被否方案 B「`compile(text)` 单入口：缓存层无法插在 parse 与 evaluate 之间」 | getCompiled 是**组合**冻结接缝的缓存门面（冲突报告边缘项 #1）：不收窄、不替代任何既有接缝；本设计不动 evaluate/parseVfsl 本体 |
| ADR-0003「派生 schema 纯数据、可 JSON 序列化、可内容哈希、不携带行列」 | 缓存值天然可哈希可共享；深冻结不破坏 JSON 往返（AC1 断言） |
| ADR-0005 §1「id 是标签不是键」 | 缓存键 = 文本内容哈希；不同 id 同文本必同条目（AC1 锚） |
| ADR-0005 §1「async 从第一天起：DocSchemaSource 终态走网络；接缝按终态设计」 | async 原则的辖域是 **SchemaSource 加载接缝**（getCompiled 的上游输入获取）；裁定输入见 D1 |
| ADR-0005 §3「输入 = `evaluate` 的派生 schema（不直接吃 IR）」 | 约束**生成器**输入选择；getCompiled 同时返回 `{module, derived}` 双产出是简报明文（codegen 等消费方自 derived 取用），冲突报告边缘项 #5 已裁 no-conflict |
| 冲突报告提示 #2（命名纪律） | API/模块命名避开 registry/compiler 语系：公共面仅 `getCompiled` + 结果类型；模块名 `sha256.ts`；不引入按 id 注册/寻址 |
| 冲突报告提示 #4（缓存值纪律） | 共享引用防变异手段（冻结/拷贝/文档契约）由 SA1 裁定 → D4 |

### 1.2 既有接缝与代码现状（全部已读）

- `packages/vfsl/src/index.ts`（160 行）：`parseVfsl`（:101，同步纯函数不抛错，E100 崩溃边界）、`parseSchemaEnvelope`（:135，H1 编排：形状 → 方言 → parseVfsl 透传，ENV-100 顶层崩溃边界）；头注 :24-26 明文「FileSchemaSource 读 Node fs——引擎包内**唯一**环境绑定面」。`evaluate` 经 :63 纯 re-export。
- `packages/vfsl/src/envelope.ts`（227 行）：`validateEnvelopeShape`（ENV-1/2/3，单读物化 + 恰四键回显）、`dialectIssueOrNull`（复用 `assertVfslDialect` 单点，ENV-4）、`envelopeCrashIssue`（ENV-100，F1 修复后对抗输入安全）、`makeEnvelopeIssue`（唯一构造点 + 行终止符 sanitizer）。头部 :6-7：「编排函数 parseSchemaEnvelope 本体在 index.ts 与 parseVfsl 同址（本模块零 index 依赖，避免模块环）」。
- `packages/vfsl/src/evaluate.ts:45`：同步纯函数不抛错；「不变更输入 module（只读遍历）」（求值器设计 §8.3）。
- `packages/vfsl/src/ir.ts` / `derived.ts`：`VfslModule { kind:'vfsl-module'; aliases }`；`DerivedSchema { aliases, structure, values, index, aliasDocs, fieldDocs, markerDocs }`——全纯数据。derived.ts:7-12 明文：不可变契约 v1 以 JSDoc + 设计文档承载，**不 Object.freeze**（求值器设计 §8.3 评估）——本设计对缓存条目的冻结是**其逃逸条款（「若后续票出现真实突变事故，再评估冻结」）下的域内再评估**，不动 evaluate 本体输出，见 D4.3。
- `packages/vfsl/package.json`：`dependencies` 无（AC6.1 锁现状），`devDependencies` 仅 typescript/vitest/@types/node；`lib:["ES2022"]`（tsconfig.base.json），**无 DOM lib**。
- `packages/vfsl/src/schemasource.ts:93`：`assertVfslDialect`——方言断言单点冻结资产。
- 仓内 sha-256 资产盘点（R2/A3 修正——R1 误称「全仓不存在」）：**引擎包（packages/vfsl/src）内不存在**任何哈希实现（无现成资产可复用，D8 是必答题）；**仓内先例在 codegen 工具包**——`packages/vfsl-codegen/src/header.ts:10` `import { createHash } from 'node:crypto'`、:37 对 sourceText 做 `sha256` hex 头注（产物见 `domains/vfs3-assets/generated.ts:4` `Source hash: sha256:…`）。codegen 是构建期工具包，其 node:crypto 用法不违引擎包边界——恰为 D8 的对照论据：**仓内 sha-256-of-text 已有先例，但它在工具包且绑 node；引擎包内自包含纯 TS 实现才是既守零依赖（AC6）又守 index.ts:24-26 绑定面唯一性的解**。
- SA6 测试（R2 状态）：`vi.mock('../src/evaluate.js')` 挂在**模块图**上（测试头注 :44-45：「getCompiled 无论从哪个文件组合 evaluate 都必经该接缝」）→ 本设计 evaluate 取值导入进 index.ts 后自动被截获，机制不变（SA2 增量复核确认：`:195 evaluateMock = vi.mocked(evaluate)` 从 `../src/index.js` 取到的即 mock 实例）。§11 三处 fixture 修正已由 SA6 执行（:111/:114/:319）。

### 1.3 现有同类先例（架构一致性参照）

- 编排落位先例：H1 把 `parseSchemaEnvelope` 放 index.ts 与 parseVfsl 同址（envelope.ts:6-7），避免模块环——本设计沿用（D10）。
- 算法自包含先例：`pattern.ts` 包内 NFA 子集模拟（「零运行时依赖」下的 ReDoS 防护）——D8 纯 TS sha-256 同构正当性。
- 测试 mock 接缝先例：SA6 对 `../src/evaluate.js` 的模块图 mock 与本设计 index.ts 值导入兼容（§9 协议假设 #5）。
- 版本纪律先例：求值器设计 §10「改码须 bump patch」→ package.json 0.1.9 → 0.1.10（§9 文件清单）。

## §2. 需求推演（Feature 切入点）

**问题形状**：编译管线 `text → parseVfsl → module → evaluate → derived` 是文本的纯函数（求值器设计 §8.3：无时间/随机/全局态，跨版本确定性冻结清单）。同一文本重复编译产出逐字节相等但引用互异的产物——缓存是把「值相等」提升为「引用同一」的 memoization，正确性由纯函数性保证，收益由引用共享（零重算 + 零分配）兑现。

**切入点**：新公共入口 `getCompiled` 组合既有接缝，插在「文本到手之后、parseVfsl 之前」查表——这正是 ADR-0003 否决接缝候选 B（`compile(text)` 单入口）时明示保留的设计自由：「缓存层无法插在 parse 与 evaluate 之间」是 B 的死因，getCompiled 不吞并 evaluate 接缝，故无此问题（冲突报告边缘项 #1）。

**必须成立的不变式**（推导自 AC + ADR，后文逐条落位）：

| # | 不变式 | 落位 |
|---|---|---|
| INV-1 | 同文本（任意载体/任意 id）→ 同一条目（容器/module/derived 三重引用同一） | D2 键 + D9 条目即返回值 |
| INV-2 | 内容不同（哪怕仅空白、哪怕仅相差未配对代理）→ 不同键、独立条目、正确重算不去重。**单射性辖域（R2/A1）：全 JS 字符串空间**——键的字节化映射单射（合法码点 RFC 3629 + lone surrogate WTF-8 区别性段，证明见 §5.3 末），后续 sha-256 摘要碰撞为唯一残余坍缩源（2^-128 量级，接受） | D2 全文哈希（无规范化）+ D8 单射字节化 + 确定性哈希；RT-1 守卫（§5.4） |
| INV-3 | 未知方言先于文本解释被拒，拒绝零损透传 H1，不产生/不占用缓存项 | D5 gate（H1 同源单点）+ 拒绝路径不触 Map |
| INV-4 | 失败（parse 或 evaluate）永不落缓存，同文本可重试 | D4 只存 ok |
| INV-5 | 缓存条目纯数据、可 JSON 往返、共享引用不被消费者污染 | 源头纯数据（ADR-0003）+ D4 深冻结；RT-3 守卫（§5.5，N1） |
| INV-6 | 引擎公共面不抛错（对抗输入经结构化 issue 返回）——**结构性承诺**（R2/A2）：getCompiled 全函数体顶层崩溃边界，不依赖「下游冻结接缝永不缺陷」的隐含前提 | D11 全函数体 try/catch（envelopeCrashIssue 单点）+ parseVfsl/evaluate 自身不抛错；RT-2 守卫（§5.5） |
| INV-7 | 零新运行时依赖、不新增环境绑定面 | D8 纯 ES2022 |

## §3.（并入决策总表与 §5，避免重复）

## §4. 公共契约

### 4.1 签名与类型（index.ts 新增公共导出）

```ts
/**
 * getCompiled ok 分支：缓存共享的编译缓存条目对（module/derived 双产出）。二者与
 * 返回容器均为深冻结对象（§D4.3）——消费者不得变异共享引用；ESM 严格模式下
 * 变异尝试抛 TypeError（loud，非静默降级）。
 */
export interface CompiledOk {
  ok: true;
  module: VfslModule;      // parseVfsl ok 产物（IR）
  derived: DerivedSchema;  // evaluate ok 产物（派生 schema）
}

/** getCompiled 公共返回形状：失败 issues 与 parseSchemaEnvelope 同域（SchemaParseIssue[]）。 */
export type GetCompiledResult =
  | CompiledOk
  | { ok: false; issues: SchemaParseIssue[] };

/**
 * DocScope 编译缓存门面（H3 / issue #54；ADR-0001「按内容哈希的编译缓存」）。
 * 同步、确定性、不抛错——全函数体顶层崩溃边界（§D11，同 H1 结构，ENV-100）。
 * 缓存键 = sha256(文本内容)（单射字节化：合法码点 UTF-8 + lone surrogate WTF-8 段，
 * §D8.2）——id/载体不参与。同一文本一次 parseVfsl + evaluate、处处取用同一对象
 * 引用；不同文本完全隔离（含仅相差未配对代理的文本）；失败不落缓存（可重试）。
 * v1 进程级无淘汰（§D3 论证）。
 */
export function getCompiled(input: string | SchemaEnvelope): GetCompiledResult;
```

- 入参联合类型 `string | SchemaEnvelope` 表达意图（信封或文本）；运行时以 `typeof input === 'string'` 判别，其余输入交 gate（unknown 姿态校验，ENV-1/2/3 拒绝——与 H1 同源的防御深度，`getCompiled(42)`/`null`/函数 → ENV-1）。
- 类型导入遵守 `verbatimModuleSyntax`：`import type { VfslModule } from './ir.js'` 等既有形态，无新纪律。

### 4.2 可观察契约（与 SA6 测试逐条对齐）

| 输入 | 结果 |
|---|---|
| 信封（形状/方言合法 + 文本合法 + 求值成功） | `{ ok:true, module, derived }`（缓存命中或新建） |
| 裸文本（合法 + 求值成功） | 同上，且与同文本信封形式命中**同一条目**（D2 键无关载体） |
| 信封形状坏（ENV-1/2/3） | `{ ok:false, issues:[{kind:'envelope',…}] }`（gate 构造，与 parseSchemaEnvelope 同输入深度相等） |
| 未知方言（ENV-4） | 同上；`evaluate`/`parseVfsl` 均零调用；不触缓存 |
| 文本语法错误（信封或裸文本两形式） | `{ ok:false, issues:[{kind:'vfsl',…}] }`，message 保持 `VFSL-E<码>:` 前缀与行列；不落缓存 |
| 求值失败（ok parse + fail evaluate） | `{ ok:false, issues:[{kind:'vfsl',…}] }`，注入标记零损透传；不落缓存；同文本重试即重新求值 |
| 含未配对代理的合法文本（R2/A1） | 正常编译入册（语义按码元保留）；其键与仅相差该代理字符（如换 `U+FFFD`）的同形文本**互异**——独立条目、各自派生物正确 |
| 对抗 getter/Proxy 或内部意外异常（任何通道，R2/A2） | `{ ok:false, issues:[{kind:'envelope', code:'100',…}] }`（ENV-100，全函数体顶层崩溃边界，envelopeCrashIssue 单点）——**永不外抛** |

## §5. 实现设计（伪代码）

### 5.1 envelope.ts：共享前探门 `envelopeTextGate`（D5）

从 `parseSchemaEnvelope` 抽出「形状 → 方言」前缀为单点，两个公共入口共用。**既有函数零改动**，只新增：

```ts
/**
 * H1 编排前缀（形状 → 方言）单点（H3 / D5）：validateEnvelopeShape（ENV-1/2/3）
 * → dialectIssueOrNull（ENV-4）→ 成功交回**恰四键回显信封**（含 text）。
 * parseSchemaEnvelope（index.ts）与 getCompiled 编译缓存前探共用——校验决策点
 * 单源，信封命中路径得以免重复 parseVfsl（ADR-0001「性能依赖编译缓存」）。
 * 纯函数；可能因对抗 getter/Proxy 抛出（由各公共入口的崩溃边界收编 ENV-100）。
 */
export function envelopeTextGate(input: unknown):
  | { ok: true; envelope: SchemaEnvelope }
  | { ok: false; issues: SchemaParseIssue[] } {
  const shape = validateEnvelopeShape(input);            // ENV-1 / ENV-2+3（单读物化）
  if (!shape.ok) {
    return { ok: false, issues: shape.issues.map((issue) => ({ kind: 'envelope' as const, issue })) };
  }
  const dialect = dialectIssueOrNull(shape.envelope);    // ENV-4（assertVfslDialect 单点复用）
  if (dialect !== null) {
    return { ok: false, issues: [{ kind: 'envelope', issue: dialect }] };
  }
  return { ok: true, envelope: shape.envelope };
}

/** kind:'vfsl' 包装单点（原 index.ts:153 内联 map 提出共用，语义零变）。 */
export function vfslIssues(issues: VfslIssue[]): SchemaParseIssue[] {
  return issues.map((issue) => ({ kind: 'vfsl' as const, issue }));
}
```

`index.ts` 的 `parseSchemaEnvelope` 内部改用（**行为逐字节不变**，H1 既有 60+ 用例应原样绿）：

```ts
export function parseSchemaEnvelope(input: unknown): ParseSchemaEnvelopeResult {
  try {
    const gate = envelopeTextGate(input);          // §5 前缀单点（envelope.ts，H3 D5 抽出）
    if (!gate.ok) {
      return { ok: false, issues: gate.issues };
    }
    const parsed = parseVfsl(gate.envelope.text);  // §5：透传（VFSL-E*）
    return parsed.ok
      ? { ok: true, envelope: gate.envelope, module: parsed.module }
      : { ok: false, issues: vfslIssues(parsed.issues) };
  } catch (err) {
    return { ok: false, issues: [{ kind: 'envelope', issue: envelopeCrashIssue(err) }] };
  }
}
```

### 5.2 index.ts：getCompiled 主流程（D1/D2/D4/D6/D7/D9/D11）

```ts
import { evaluate } from './evaluate.js';            // 值导入（原 :63 纯 re-export 拆两行）
export { evaluate };                                  // 公共面不变（vi.mock 模块图截获机制不变）
import { envelopeTextGate, vfslIssues, envelopeCrashIssue } from './envelope.js';
import { sha256Hex } from './sha256.js';

/**
 * v1 无淘汰论证（简报明文策略）：进程内命名空间数有界（每 Y.Doc 恰一份 SCHEMA
 * 信封，yjs-server 进程承载的活文档集有限），条目 = 纯数据编译缓存条目（O(文本
 * 规模)，ADR-0003 §4），总量 ≈ 活命名空间数 × 单文本规模——有界。淘汰（LRU/
 * 弱引用/per-DocScope 生命周期）留 v2（§12 checklist）：届时引入 DocScope 实例
 * 工厂，本函数退化为默认实例薄壳，公共契约不变。
 */
const compiledCache = new Map<string, CompiledOk>();

export function getCompiled(input: string | SchemaEnvelope): GetCompiledResult {
  // 全函数体顶层崩溃边界（R2/A2 · D11——与 parseSchemaEnvelope 同结构）：正常路径
  // 无可抛点（parseVfsl/evaluate 各有自身 catch；sha256Hex 纯循环；deepFreeze 递归
  // 深度被 MAX_TYPE_NESTING=100 结构性封顶——SA2 已核查），此 catch 收编的是
  // 「不可达的实现缺陷信号」与对抗 getter/Proxy——ENV-100 结构化返回，绝不外抛。
  // kind 裁定：统一走 kind:'envelope'（ENV-100）——envelopeCrashIssue 单点构造优先，
  // 且崩溃点无行列语义（kind:'vfsl' 的 VfslIssue 形状不匹配）。
  try {
    // ① 形式判别（D6）：string → 文本通道（隐式 vfsl@1——文本无自述方言，无可断言
    //    对象）；否则信封通道，经 H1 前探门（形状 → 方言断言，未知方言先于文本解释）。
    let text: string;
    if (typeof input === 'string') {
      text = input;
    } else {
      const gate = envelopeTextGate(input);          // 对抗 getter 抛出 → 顶层 catch（ENV-100）
      if (!gate.ok) {
        return { ok: false, issues: gate.issues };   // ENV-1/2/3/4 —— H1 同源构造，零损透传
      }
      text = gate.envelope.text;
    }

    // ② 内容哈希键（D2，单射字节化 §D8.2）+ 命中即返（D9：条目即返回值；
    //    命中 = O(sha256)，零 parse/零 evaluate）
    const key = sha256Hex(text);
    const hit = compiledCache.get(key);
    if (hit !== undefined) {
      return hit;
    }

    // ③ miss → 一次 parseVfsl + evaluate（简报：「同一文本一次 parseVfsl + evaluate」）
    const parsed = parseVfsl(text);
    if (!parsed.ok) {
      return { ok: false, issues: vfslIssues(parsed.issues) };   // 不落缓存（幂等重拒，可重试）
    }
    const evaluated = evaluate(parsed.module);
    if (!evaluated.ok) {
      return { ok: false, issues: vfslIssues(evaluated.issues) }; // message 零损透传；不落缓存（AC5 可重试）
    }

    // ④ 只存 ok 分支（D4）；深冻结后入册（D4.3——共享引用防变异），返回同一冻结对象
    const entry: CompiledOk = { ok: true, module: parsed.module, derived: evaluated.derived };
    compiledCache.set(key, deepFreeze(entry, new WeakSet<object>()));
    return entry;
  } catch (err) {
    return { ok: false, issues: [{ kind: 'envelope', issue: envelopeCrashIssue(err) }] };
  }
}
```

`deepFreeze`（index.ts 私有助手，~15 行；**D4.3 深冻结细则**：只冻 getCompiled 入册的编译缓存条目（容器 + module + derived 引用图，一次 O(条目规模)，被命中摊薄）；evaluate 接缝本体的直接输出**不冻结**——求值器设计 §8.3 的 v1 不冻结决策在其自身辖域内原样有效，本细则只是其逃逸条款「共享引用升格突变后果时再评估」的域内执行；RT-3 锚定冻结对校验接缝零行为差异）：

```ts
/** 深冻结（D4.3）：递归冻结纯数据产物（含数组与嵌套对象）；WeakSet 防御环（IR/派生物
 *  按契约为无环 DAG，防御性收口而非预期路径）；幂等（重复访问已冻对象即返回）。 */
function deepFreeze<T>(value: T, seen: WeakSet<object>): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    return value;
  }
  seen.add(value);
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child, seen);
  }
  return value;
}
```

### 5.3 sha256.ts：纯 TS 参考实现（D8，SA3 照此实现即正确）

**以下算法为 SA1 设计期已对 `node:crypto` 逐向量验证的实现**（验证记录与可重跑命令原文见 §9 协议假设 #3；含一处设计期自查纠错：长度编码字节必须 `Math.floor(bitLen / 2**(8j)) & 0xff`，除法不取整在非整除位会出错——空文本巧合全零掩盖该错，KAT 的 `'abc'` 向量可捕获之）。SA2 已独立逐行转写对拍（6 KAT + 17 条边界向量全一致）确认压缩循环、K 表、长度编码可靠——**R2 修订仅动 `utf8Bytes` 的 lone surrogate 分支（A1），其余零改动**。

**D8.2 单射字节化（R2/A1 方案甲）**：合法码点按 RFC 3629 编码；**未配对代理（lone surrogate）不做任何替换**，落入通用 3 字节分支直接编码（0xD800–0xDFFF → `ED A0 80`–`ED BF BF`，即 WTF-8 的代理段）。R1 原案的 WHATWG U+FFFD 替换（`EF BF BD`）使 `'\uD800'`、`'\uDC00'`、`'\uFFFD'` 三种不同字符串坍缩为同一字节序列 → 同一缓存键——而 lone surrogate 能藏身 doc 注释与字符串字面量走完 parse+evaluate 入缓存（tokenizer.ts:131-178 块注释任意码点 + 码元级切片、:218-266 字面量 `value += cc` 任意码点，SA2 与 SA1 双重直读证实），两条仅相差 lone surrogate 的合法文本将静默共享条目（错误的成功，违 INV-2）。WTF-8 段与一切合法码点的规范 UTF-8 输出不相交，天然恢复单射。

**单射性证明**（键映射 `bytesOf: string → byte[]` 在全 JS 字符串空间单射）：扫描器把字符串切成符号序列（配对代理 = 一个星面码点符号；其余每码元一个符号），每符号独立编码：(a) 1 字节 `0xxxxxxx`（cp<0x80）、(b) 2 字节 `110xxxxx…`（<0x800）、(c) 3 字节 `1110xxxx…`（<0x10000，含 lone surrogate 的 `ED A0 80`–`ED BF BF`）、(d) 4 字节 `11110xxx…`（星面）。四类的**首字节前缀互斥** ⇒ 符号编码自定界（唯一可解码）；每类内部编码对值域双射（标准 base-64 续字节）；lone surrogate 值域（0xD800–0xDFFF）与合法码点值域不相交且仅落在 (c) 的 `ED A0 80`–`ED BF BF` 子段，而合法码点的 (c) 编码永不进入该子段（RFC 3629 排除代理值）。故符号序列不同 ⇒ 字节序列不同；字符串不同 ⇒ 符号序列不同（扫描器确定性）。设计期已实证（§9 #7）：`'\uD800'`/`'\uDC00'`/`'\uFFFD'`/`'\uDBFF'`/`'\uDFFF'` 五者摘要互异，反向代理对 `\uDE00\uD83D`、双高代理 `\uD800\uDBFF`、高代理+尾字符、配对星面四类畸形边角两两互异。**合法文本（无 lone surrogate）的字节化与 R1 逐字节相同**——全部既有 KAT 原样绿，行为零变化。

**D8.3 方案乙（入口响亮拒绝）否决理由**：O(n) 预扫 lone surrogate → 结构化拒绝会令 `getCompiled(text)` 与 `parseVfsl(text)` 对同类输入行为分叉（前者拒、后者 ok）——缓存门面引入了底层接缝不存在的拒绝语义，违背「组合而非取代冻结接缝」的定位（冲突报告边缘项 #1）；且 lone surrogate 文本在 v1 引擎内是**合法可编译**输入（doc/字面量语义按码元保留进 IR/derived），拒绝会把可达输入域收窄为引擎定义域的子集。方案甲零行为变化、零分叉、实现更简（删一个替换分支），是唯一的「修坍缩而不引入新语义」解。

```ts
/**
 * 字符串 → 字节序列（键的单射字节化，§D8.2/R2-A1）。合法码点：RFC 3629 UTF-8；
 * 未配对代理（lone surrogate）：不替换，走通用 3 字节分支编码为 WTF-8 代理段
 * （ED A0 80–ED BF BF）——该段与一切合法码点的规范 UTF-8 不相交 ⇒ 全字符串空间
 * 单射（INV-2）。R1 的 U+FFFD 替换编码会使 '\uD800'/'\uDC00'/'\uFFFD' 坍缩同键
 * （SA2 A1），已废弃。纯 ES2022（lib 无 DOM、@types/node 无全局 TextEncoder——
 * §D8/§9 #4）。使用 codePointAt 规避 noUncheckedIndexedAccess 索引访问。
 */
export function utf8Bytes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i) as number;   // i < length ⇒ 非 undefined
    i += cp > 0xffff ? 2 : 1;                    // 星面码点跨代理对（配对时 codePointAt 返回星面值）
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      // 含 lone surrogate（0xD800–0xDFFF，codePointAt 对未配对者原样返回该值）：
      // 编码为 ED A0 80–ED BF BF（WTF-8 段）——不替换、不坍缩（§D8.2 单射证明）
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f),
               0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
  }
  return out;
}

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/** FIPS 180-4 §4.2.2 K 表（64 常量；表值以 FIPS 原文为准，KAT 失败 = 抄录错误探测器）。 */
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** sha256(text) → 64 字符小写 hex。纯函数、确定性（同文本恒同键——缓存正确性根基）。 */
export function sha256Hex(text: string): string {
  const bytes = utf8Bytes(text);
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
             0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const bitLen = bytes.length * 8;
  const msg = [...bytes, 0x80];                       // FIPS 180-4 §5.1.1 padding
  while (msg.length % 64 !== 56) msg.push(0);
  for (let j = 7; j >= 0; j--) {                      // 64 位大端位长（低 32 位即够，
    msg.push(Math.floor(bitLen / 2 ** (8 * j)) & 0xff); // 文本 < 2^32 bit ≈ 512 MB；除法必须取整）
  }
  for (let off = 0; off < msg.length; off += 64) {
    const w = new Array<number>(64);
    for (let i = 0; i < 16; i++) {
      w[i] = (msg[off + 4 * i] << 24) | (msg[off + 4 * i + 1] << 16)
           | (msg[off + 4 * i + 2] << 8) | msg[off + 4 * i + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15] as number, 7) ^ rotr(w[i - 15] as number, 18) ^ ((w[i - 15] as number) >>> 3);
      const s1 = rotr(w[i - 2] as number, 17) ^ rotr(w[i - 2] as number, 19) ^ ((w[i - 2] as number) >>> 10);
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + (K[i] as number) + (w[i] as number)) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = ((H[i] as number) + v) | 0; });
  }
  return H.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}
```

（`as number`/`as const` 断言位为 noUncheckedIndexedAccess 的 TS 层适配，SA3 可用局部变量消除断言，行为不变。）

### 5.4 守卫测试 A：`test/docscope-sha256.test.ts`（设计强制，SA3 实现；R2/A1 扩展 RT-1 两层）

SA6 验收测试**无法**观察哈希正确性与键单射性（键不外露——正确但非单射的错误哈希照样过 AC1/AC2，正是 A1 的教训）。本测试把哈希钉死在标准答案上、把单射性钉死在攻击对上（SA1 已用 `node:crypto` 独立复核全部期望值，命令与输出见 §9 #3/#7）：

```ts
import { describe, expect, it } from 'vitest';
import { evaluate, getCompiled, parseVfsl } from '../src/index.js';
import { sha256Hex } from '../src/sha256.js';

describe('sha256Hex — KAT（FIPS 180-4 / RFC 3629 标准答案，设计 §5.3 锚定）', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
     '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
    ['ä', '33e6d73fee82904c8d7afb78de1154d1e8dc2a0edb08120e63df5b9385c2d9cc'],          // 2 字节 UTF-8
    ['中文abc', '0f3f66d4223ba850a775f6fac666ed7265eba9c88c9867c03679a1c28125b89f'],      // 3 字节
    ['aä𝐀🙂', '2485e7c89fa37590f1654be2b9489d351208ece915011e65047d063313c1f693'],      // 星面（代理对路径）
  ])('sha256Hex(%j) === 标准答案', (input, expected) => {
    expect(sha256Hex(input)).toBe(expected);
  });

  it('确定性：同文本两次调用恒等；相邻文本（仅空白差异）键必异（AC2 机制根基）', () => {
    const t = 'type ROOT = { a: string; };';
    expect(sha256Hex(t)).toBe(sha256Hex(t));
    expect(sha256Hex(t)).not.toBe(sha256Hex(`${t}\n`));
    expect(sha256Hex(t)).not.toBe(sha256Hex('type  ROOT = { a: string; };'));
  });
});

// RT-1 KAT 层（R2/A1，SA2 红线锚点——R1 的 U+FFFD 替换编码下必红、WTF-8 下绿）：
// lone surrogate 与 U+FFFD、lone surrogate 彼此——键必须互异（WTF-8 期望摘要经
// 手构字节序列 + node:crypto 复核，§9 #7）。
describe('sha256Hex — 键单射性（WTF-8 代理段，设计 §D8.2 锚定 / SA2 A1）', () => {
  it.each([
    ['\uD800', '91a681b998555fb475479817b126c94e57e52011fa1842c5d188795a4a05226b'],  // ED A0 80
    ['\uDC00', 'b2d612a08bec1f41120ebd961f62ef19678375b5788c70d3f8f4c02e345ed412'],  // ED B0 80
    ['\uFFFD', '83d544ccc223c057d2bf80d3f2a32982c32c3c0db8e2674820da5064783fb097'],  // EF BF BD（对照）
  ])('WTF-8 单射向量 sha256Hex(%j) === 期望', (input, expected) => {
    expect(sha256Hex(input)).toBe(expected);
  });

  it('lone surrogate / U+FFFD / 彼此键互异（INV-2 单射辖域；R1 替换编码下坍缩同键 → 红）', () => {
    expect(sha256Hex('\uD800')).not.toBe(sha256Hex('\uFFFD'));
    expect(sha256Hex('\uD800')).not.toBe(sha256Hex('\uDC00'));
    expect(sha256Hex('\uFFFD')).not.toBe(sha256Hex('\uDC00'));
    expect(sha256Hex('\uDBFF')).not.toBe(sha256Hex('\uDFFF'));
  });
});

// RT-1 集成层（R2/A1）：攻击对走完整 getCompiled——doc 注释与字符串字面量两个
// 「藏身处」各一对（tokenize/parse/evaluate 均接受 lone surrogate，fixture 先自检）。
// R1 设计下第二成员命中第一成员条目（引用互异断言 + 深相等断言双红）；R2 下全绿。
describe('getCompiled — 键单射性集成锚（SA2 A1 攻击对）', () => {
  /** 新鲜直编对照（不经缓存）。 */
  function freshDerived(text: string): unknown {
    const p = parseVfsl(text);
    expect(p.ok).toBe(true);
    if (!p.ok) throw new Error('fixture 自检失败（parseVfsl）');
    const e = evaluate(p.module);
    expect(e.ok).toBe(true);
    if (!e.ok) throw new Error('fixture 自检失败（evaluate）');
    return e.derived;
  }
  type Ok = { ok: true; module: unknown; derived: unknown };
  function okOf(r: ReturnType<typeof getCompiled>): Ok {
    expect(r.ok).toBe(true);
    return r as Ok;
  }
  // 藏身处 1：doc 注释（块注释任意码点 + 码元级切片，tokenizer.ts:131-178）
  // 藏身处 2：字符串字面量（value += cc 任意码点，tokenizer.ts:218-266）
  const PAIRS: Array<[string, string]> = [
    ['/** note \uD800 */ type ROOT = { a: string; };', '/** note \uFFFD */ type ROOT = { a: string; };'],
    ['type ROOT = { a: "\uD800"; };', 'type ROOT = { a: "\uFFFD"; };'],
  ];
  it.each(PAIRS.map((pair, i) => [`藏身处-${i + 1}`, pair] as const))(
    '%s：仅相差 lone surrogate vs U+FFFD 的两条合法文本 → 独立条目、各自派生物正确',
    (_label, [textP, textQ]) => {
      const p = okOf(getCompiled(textP));
      const q = okOf(getCompiled(textQ));
      expect(p).not.toBe(q);                 // 容器引用互异（R1 坍缩下红）
      expect(p.module).not.toBe(q.module);
      expect(p.derived).not.toBe(q.derived);
      expect(p.derived).toEqual(freshDerived(textP));  // 各自派生物对应自身文本
      expect(q.derived).toEqual(freshDerived(textQ));  // （R1 下 Q 命中 P 条目 → 红）
    },
  );
});
```

### 5.5 守卫测试 B：`test/docscope-guards.test.ts`（设计强制，SA3 实现；R2 新增——SA2 A2 + N1）

```ts
import { describe, expect, it } from 'vitest';
import { evaluate, getCompiled, parseVfsl, validatePatch, validateSnapshot } from '../src/index.js';

// RT-2（SA2 A2）：getCompiled 崩溃边界结构性承诺——任意输入（含对抗面）永不 throw，
// 恒返回 ok 联合。正常路径无可抛点，此测试锚定的是全函数体兜底的结构存在性
// （R1「仅包 gate」形态下，文本通道兜底缺席——对抗面用例即结构回归锚）。
describe('getCompiled — 崩溃边界（INV-6 / D11，SA2 A2）', () => {
  it('深嵌套边界（MAX_TYPE_NESTING=100 上下）不外抛：合法侧 ok、越界侧 ok:false', () => {
    const nest = (n: number): string =>
      `type ROOT = ${'{ a: '.repeat(n)}number${'}'.repeat(n)};`;
    for (const n of [98, 100, 120]) {        // 合法/边界/越界三档
      const r = getCompiled(nest(n));        // 断言「要么 ok 要么 ok:false」，绝不 throw
      expect(r === null || r === undefined).toBe(false);
      expect(typeof (r as { ok?: unknown }).ok).toBe('boolean');
    }
  });
  it('超长文本（~64KB 混合注释与字段）不外抛', () => { /* 构造同款断言 */ });
  it('lone surrogate 文本（RT-1 fixture）不外抛', () => { /* 构造同款断言 */ });
  it('对抗 getter 信封（读取即抛）→ ENV-100 结构化返回（kind:envelope / code:100），绝不外抛', () => {
    const r = getCompiled({ get lang() { throw new Error('adversarial'); } } as never);
    expect(r.ok).toBe(false);
    const first = (r as { ok: false; issues: [{ kind: string; issue: { code: string } }] }).issues[0];
    expect(first.kind).toBe('envelope');
    expect(first.issue.code).toBe('100');    // ENV-100（H1 §6 同款崩溃边界）
  });
});

// RT-3（SA2 N1）：深冻结缓存条目喂给校验接缝 ≡ 新鲜 derived——锚定「冻结对校验器
// 零行为差异」。若校验器存在就地变异（如原地 sort），冻结条目会在其内部抛
// TypeError → E100 → 与新鲜路径结果分叉，本测试即红。
describe('getCompiled — 冻结条目 × 校验接缝等价（D4.3 / SA2 N1）', () => {
  const TEXT = 'type ROOT = { a: string; b?: number; };';
  const SNAPSHOT_OK = { a: 'x' };
  const SNAPSHOT_BAD = { a: 1 };             // 值类型违例（拒绝分支）
  it('validateSnapshot(缓存条目.derived) ≡ validateSnapshot(新鲜 derived)（ok 与拒绝两分支）', () => {
    const cached = getCompiled(TEXT);
    expect(cached.ok).toBe(true);
    const fresh = (() => {
      const p = parseVfsl(TEXT); expect(p.ok).toBe(true);
      const e = evaluate(p!.module); expect(e.ok).toBe(true);
      return e!.derived;
    })();
    for (const snap of [SNAPSHOT_OK, SNAPSHOT_BAD]) {
      expect(validateSnapshot((cached as { derived: unknown }).derived, snap))
        .toEqual(validateSnapshot(fresh, snap));
    }
  });
  it('validatePatch 同款等价（结构守卫 + 重建校验路径，拒绝分支含）', () => {
    /* 同构断言：validatePatch(cached.derived, base, 'a', <合法/非法值>) 与新鲜路径 toEqual */
  });
});
```

（fixture 具体值 SA3 可微调，断言形态（永不 throw / ENV-100 / 冻结≡新鲜 toEqual）为设计冻结项。）

## §6. 边界与防御性分析

| 场景 | 行为 | 依据 |
|---|---|---|
| 对抗 getter/Proxy 信封（读取即抛） | gate 内抛出 → getCompiled 全函数体顶层 catch → ENV-100 结构化返回，不外抛（RT-2 锚定） | envelopeCrashIssue 单点（含不可字符串化守卫，F1 修复后资产）；与 parseSchemaEnvelope 同口径 |
| getCompiled 内部意外异常（正常路径无可抛点——SA2 已核查；命中即实现缺陷信号） | 全函数体顶层 catch 收编 → ENV-100（kind:'envelope'，envelopeCrashIssue 单点；崩溃点无行列语义，kind:'vfsl' 的 VfslIssue 形状不匹配） | D11（R2/A2）：承诺不再依赖「下游冻结接缝永不缺陷」的隐含前提 |
| `getCompiled(42)` / `null` / `undefined` / 函数 / 数组 | 非 string → gate → ENV-1（单条，消息含实收 typeof/数组长度） | H1 §3.1 同源 |
| 键缺失/类型错信封 | ENV-2/ENV-3（聚合全收集） | H1 §3.2/§3.3 同源 |
| 未知方言 + 语法错误文本并存 | ENV-4 先拒绝，`parseVfsl`/`evaluate` 零调用，不触缓存 | gate 顺序即语义（方言断言先于文本解释）——AC4「evaluate 零调用」控制流事实 |
| 求值失败后同文本重试 | miss → 重新 parseVfsl + evaluate（计数 +1）→ ok 后入册；再后命中 | D4 只存 ok |
| 坏文本反复调用 | 每次重新 parse → 幂等重拒（不落缓存，无负缓存） | D4；简报无负缓存要求，负缓存会破坏「重试可成功」对称性 |
| 未配对代理文本（lone surrogate，R2/A1 如实改写） | **能合法 tokenize/parse/evaluate 并入缓存**（doc 注释/字符串字面量按码元保留语义——tokenizer.ts:131-178/:218-266，藏身处经 SA2 与 SA1 双重直读证实）；其键经 **WTF-8 区别性段编码（ED A0 80–ED BF BF）与 U+FFFD 及其他 lone surrogate 互异**——R1 的 U+FFFD 替换会使 `'\uD800'`/`'\uDC00'`/`'\uFFFD'` 坍缩同键、两条仅相差 lone surrogate 的合法文本静默共享条目（错误的成功），已废弃（单射证明 §5.3 D8.2；RT-1 两层守卫） | D8.2（方案甲）；方案乙（入口拒绝）否决理由见 D8.3 |
| 消费者变异缓存条目 | 深冻结 → ESM 严格模式抛 TypeError（loud） | D4.3；RT-3 锚定冻结对校验接缝零行为差异 |
| 并发 | getCompiled 同步（D1）：JS 单线程内一次调用原子完成，无 in-flight 去重需求；Map 只在④单点写 | D1；若 v2 出现 async 编译接缝再引入 in-flight Promise 去重（届时设计） |
| 内存 | v1 无淘汰，注释论证（§5.2 代码块内注释为准） | D3 |
| 哈希碰撞（异文本同摘要） | 理论概率 2^-128 量级，接受（内容寻址标准风险；与 git/内容哈希存储同级） | D2 |

**虚假降级审查**（SKILL 立法）：本设计无任何「应恒真条件」的静默 fallback——失败路径全部经结构化 issues 返回值（loud、可测试、可观察）；唯一「降级形态」是 ENV-100/ENV-1 对抗输入边界，那是真实的防御边界而非上游缺陷掩盖。

## §7. 验收标准 ↔ 设计落位映射

| AC | 简报表述 | 设计落位 | 机制证明 |
|---|---|---|---|
| AC1 | 同文本两次调用返回同一对象引用 | D2 + D9 + §5.2②④ | 命中返回 Map 值本体；miss 构造后即入册返回同一对象——三重引用同一由「条目即返回值」结构性保证；命中不重算由②在 parse/evaluate 之前早出保证（SA6 evaluate spy 计数断言的机制根基） |
| AC2 | 仅空白差异 = 不同键（正确重算不去重） | D2 全文哈希（无任何规范化/trim/AST 键控）+ D8 单射字节化 | §5.4 KAT 已实证：`'type ROOT…'`、`'…\n'`、`'type  ROOT…'` 三者摘要互异（e9fbe2b3… / fd099a71… / 1f2e536e…）；语义深相等由 tokenizer 空白 trivia 保证（同 token 流 → 同派生物）；单射辖域扩至 lone surrogate（R2/A1，RT-1 攻击对锚定——「不去重」对含未配对代理的合法文本同样成立） |
| AC3 | 多文本并存互不影响 | D2 + D3 单册内容寻址 | 不同文本不同键 → 条目对象图不相交；无进程级「当前版本」全局态（CONTEXT.md DocScope 术语） |
| AC4 | 未知方言经 H1 通道拒绝、不产生缓存项 | D5 gate + §5.2①（拒绝路径不触 Map） | gate 与 parseSchemaEnvelope 共用单点（同源构造 ⇒ 同输入 issues 深度相等）；ENV-4 在 parseVfsl 之前（evaluate 零调用的控制流事实） |
| AC5 | evaluate 失败不污染缓存（可重试） | D4 + §5.2③④ | 失败分支在 `Map.set` 之前 return；重试走完整 parse+evaluate；成功才入册 |
| AC6 | 纯引擎、零新运行时依赖、同步/async 由 SA1 定 | D8（纯 ES2022 零依赖）+ D1（**裁定：同步**） | package.json `dependencies` 保持空集；sha256.ts 零 import、index.ts 新增 import 均为包内模块 |
| 边界 | 语法错误拒绝、不落缓存、幂等 | §5.2③ + D4 | parse 失败在 evaluate/入册之前 return |

## SA2 反馈逐条回应

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|---|---|
| A1（CRITICAL）：lone surrogate 经 U+FFFD 替换编码与 U+FFFD 键坍缩，两条均可成功编译的不同文本共享缓存条目 → 静默错数据，违 INV-2；修订 D2/D8/§5.3/§5.4/§6，单射编码或入口响亮拒绝二选一，补 KAT 向量与红灯测试 RT-1 | ✅ | 摘要/D2/D8（决策总表）；§2 INV-2；§4.1 JSDoc；§5.3（D8.2 单射字节化 + 单射证明 + D8.3 方案乙否决理由 + utf8Bytes 伪代码改 WTF-8）；§5.4（RT-1 KAT 层 3 个 WTF-8 期望摘要向量 + 互异断言 + 集成层攻击对，doc 注释/字符串字面量两藏身处各一对）；§6（lone surrogate 行如实改写）；§7 AC2 | 采**方案甲（单射编码，SA2 推荐项）**：lone surrogate 不再替换，走通用 3 字节分支编码为 WTF-8 段 `ED A0 80–ED BF BF`（与一切合法码点的规范 UTF-8 不相交）；合法文本字节化与 R1 逐字节相同（9 向量对拍零变化，§9 #7），删除替换分支使实现更简；§5.3 内嵌首字节前缀互斥 + 类内双射 + 代理段不相交的三段式单射证明 + 五向量 + 四畸形边角实证；方案乙（入口预扫拒绝）否决理由固化于 D8.3（getCompiled 与 parseVfsl 行为分叉、收窄可达输入域）；压缩循环/K 表/长度编码（SA2 已验证面）零改动 |
| A2（MINOR）：文本通道（及 ②③④ 阶段）无顶层兜底，与 §4.1「不抛错（崩溃边界同 H1）」结构性承诺不符 | ✅ | 摘要（D11 新增）；决策总表 D11；§2 INV-6；§5.2（getCompiled 改**全函数体**单 try/catch，原 gate 内层 try/catch 移除——外层 catch 同构覆盖）；§6（新增「内部意外异常」行 + kind 裁定）；§5.5（RT-2 永不 throw 守卫 + 对抗 getter ENV-100 回归） | 采「函数体整体包 try/catch → ENV-100」方案（SA2 给出的第一选项）；kind 裁定明文：统一 kind:'envelope'/ENV-100——envelopeCrashIssue 单点构造优先，且崩溃点无行列语义（kind:'vfsl' 的 VfslIssue 形状不匹配）；未采「裁剪承诺措辞」备选（让公共契约弱于 H1 无必要） |
| A3（MINOR）：§1.2「仓内 sha-256 不存在」不实——codegen 包 `header.ts:10,37` 已有 node:crypto sha-256 先例 | ✅ | §1.2（盘点 bullet 重写） + 决策总表 D8 | 改为「引擎包内不存在；仓内先例在 codegen 工具包且绑 node」，并按 SA2 建议把它转化为 D8 的对照论据：引擎包内自包含纯 TS 才是既守零依赖又守绑定面唯一性的解 |
| A4（MINOR）：§9 #3 实测依据缺命令原文（SKILL 立法：实测验证须贴命令+输出） | ✅ | §9 #3 | 补可重跑命令原文（heredoc node 对拍脚本，含 R2 WTF-8 分支）+ 输出摘录；§9 #7 新增单射性专项实证（命令 + 输出） |
| N1（NOTE）：无测试锚定「深冻结条目喂校验接缝 ≡ 新鲜 derived」 | ✅ 采纳 | §5.5（RT-3）；INV-5 落位；§8 ALLOW LIST（新文件 docscope-guards.test.ts，标注 R2 追加 / SA2 A2+N1） | `validateSnapshot`/`validatePatch` 各覆盖 ok 与拒绝分支，断言缓存条目路径与新鲜 derived 路径结果 toEqual；校验器若存在就地变异 → 冻结条目抛 TypeError → E100 → 分叉即红 |
| N2（NOTE）：SA8 边缘项 #9 方言 v2 键域升级义务固化为 v2 演进 checklist | ✅ 采纳 | §12（新增「v2 演进义务 checklist」：方言键域升级（#9 前瞻义务，引入第二方言版本的票必须同步、且应为其验收项）、淘汰策略、per-DocScope 实例（#7 演进选项）、async 编译接缝 in-flight 去重） | 由 D2 散注升格为显式 checklist 条目 |
| （SA8 设计后复审措辞观察：正式文档以「编译缓存条目」指称 `{module, derived}`，避 CONTEXT.md _Avoid_「编译产物」） | ✅ 顺带采纳 | §4.1/§5.2 JSDoc 注释两处 | 设计自身措辞统一为「编译缓存条目」；简报原文引用保持原样 |

## §8. 文件清单（File Scope）

### ALLOW LIST

- `packages/vfsl/src/sha256.ts` — **新建**（~105 行）：utf8Bytes（**R2/A1：WTF-8 单射字节化**）+ sha256Hex 纯 TS 实现（§5.3 参考实现逐行锚定；零 import 叶子模块；压缩循环与 R1 逐字节一致——SA2 已验证面不波及）
- `packages/vfsl/src/envelope.ts` — **修改**（+~30 行，既有函数零改动）：新增 `envelopeTextGate` + `vfslIssues`（§5.1，D5 编排单点）
- `packages/vfsl/src/index.ts` — **修改**（净 +~105 行）：`getCompiled`（**R2/A2：全函数体顶层崩溃边界**）+ `compiledCache` + `deepFreeze` 私有助手 + `CompiledOk`/`GetCompiledResult` 类型导出 + evaluate 改值导入并 re-export + `parseSchemaEnvelope` 内部改用 gate（§5.1/§5.2；头注释补 H3 段）
- `packages/vfsl/test/docscope-sha256.test.ts` — **新建**（~85 行；R2/A1 扩展）：设计强制守卫测试 A——FIPS KAT + 确定性 + **键单射性两层（RT-1：WTF-8 期望摘要向量 + lone surrogate/U+FFFD 互异断言 + getCompiled 攻击对集成锚，两藏身处各一对）**（§5.4；SA3 按设计实现，期望值由 §9 #3/#7 实证）
- `packages/vfsl/test/docscope-guards.test.ts` — **新建**（~70 行，R2 追加——SA2 A2 + N1）：设计强制守卫测试 B——**RT-2 崩溃边界（永不 throw / 对抗 getter ENV-100 回归）+ RT-3 冻结条目×校验接缝等价**（§5.5；SA3 按设计实现）
- `packages/vfsl/test/docscope-getcompiled.test.ts` — **`[SA6 owned]`** SA6 验收测试。**R2 状态：§11.1–11.3 三处最小修正案已由 SA6 执行完毕**（:111 TEXT_HIT / :114 TEXT_RETRY / :319 case-3 `lang:'wml'`，SA8 与 SA2 双重核实）——本任务后续**预期零改动**；RT-1/RT-2/RT-3 守卫全部落在上述两个设计强制文件，SA3 不得以任何理由改本文件断言
- `packages/vfsl/package.json` — **修改**（1 行）：`version: 0.1.9 → 0.1.10`（仓例「改码须 bump patch」，求值器设计 §10 先例；`dependencies` 维持空集——AC6.1）

### DENY LIST

- `packages/vfsl/src/evaluate.ts` / `parser.ts` / `tokenizer.ts` / `semantic.ts` / `shapes.ts` / `resolve.ts` / `pattern.ts` / `xml.ts` / `errors.ts` — 冻结接缝与内部实现，本任务零改动（getCompiled 组合它们，不改它们）
- `packages/vfsl/src/ir.ts` / `derived.ts` / `validate.ts` / `validate-patch.ts` — 类型族与校验接缝，零改动
- `packages/vfsl/src/schemasource.ts` — SchemaSource 接缝（ADR-0005 辖域），零改动；方言断言经 envelope.ts 既有单点间接复用
- `packages/vfsl-protocol/**` / `packages/vfsl-codegen/**` — 协议包/生成器不在本任务（ADR-0004 D3 边界）
- `vitest.config.ts` / `tsconfig.base.json` / `packages/vfsl/tsconfig.json` — 构建/测试配置不动
- `packages/vfsl/test/` 下除上述三个 docscope 测试文件（sha256 / guards / getcompiled[SA6 owned]）外的全部既有测试文件 — H1/H2/evaluate 等验收锚（gate 重构行为不变，应原样绿——RT-4 回归护栏：`parse-schema-envelope.test.ts` 零改动全绿是 D5「行为逐字节不变」的活体证明，任何为让 docscope 测试通过而动 H1 测试的行为都是红线）
- `apps/**` / `domains/**` / `tests/**` — 引擎外资产，零改动

## §9. 协议假设依据 (Protocol Assumption Evidence)

> 章节编号按立法要求连续（文件清单 §8 之后）。

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险等级 |
|---|---|---|---|---|
| 1 | vitest 同一测试文件内，模块级可变状态跨 `it` 块存续（无 resetModules/setupFiles 时） | 设计期实测验证 | SA1 于 /tmp 草稿（仓库零写入，已清理）用**本仓 vitest**（`node_modules/.bin/vitest --root`）复现：模块导出对象在第一个 `it` 内置 42，第二个 `it` 断言收到 **42≠0 失败**（输出：`Tests 1 failed \| 1 passed (2)`，Received 42）。辅证：`vitest.config.ts` 无 `isolate:false`/`setupFiles`/`mockReset`（默认按文件隔离、文件内共享模块图）；SA6 测试文件无 `vi.resetModules`/`beforeEach`（grep 实证） | 低（已实证） |
| 2 | ESM 严格模式下对 `Object.freeze` 对象的属性赋值抛 TypeError | 官方文档引用 | ECMA-262：模块代码恒为 strict mode；strict mode 赋值到不可写属性抛 `TypeError`（ES2022 §Assignments/ValidateAndApplyPropertyDescriptor 路径）；vitest 经 esbuild 转 ESM 执行，测试同为模块代码 | 低 |
| 3 | 本设计 §5.3 的 SHA-256 参考实现（含 K 表、合法码点 UTF-8 编码、长度编码）正确，且 **R2 WTF-8 分支不改变合法文本字节化** | 设计期实测验证 | SA1 以 `node:crypto` 为基准逐一对拍（R1 初验 9 向量；R2 换 WTF-8 分支后**复跑同一命令**全量通过，证明合法文本行为零变化）。**可重跑命令原文**（SA4 门禁可重放；R2 版即 §5.3 参考实现逐行转写）：`node <<'EOF'` + 内嵌 §5.3 的 `rotr/K/sha256/utf8Bytes`（WTF-8 版）+ 尾部对拍循环 `for (const s of ['','abc','abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq','ä','中文abc','aä𝐀🙂','type ROOT = { a: string; };','type ROOT = { a: string; };\n','type  ROOT = { a: string; };']) { const mine = sha256(utf8(s)); const ref = require('node:crypto').createHash('sha256').update(Buffer.from(s,'utf8')).digest('hex'); console.log(mine===ref?'OK':'MISMATCH', JSON.stringify(s).slice(0,30)); }` + `EOF`。**输出**（R2，2026-08-21）：9 行全 `OK`（`legal-ALL: true`）；期望摘要：`''`→e3b0c442…、`'abc'`→ba7816bf…、多块→248d6a61…、`'ä'`→33e6d73f…、`'中文abc'`→0f3f66d4…、`'aä𝐀🙂'`→2485e7c8…、fixture 三变体 e9fbe2b3…/fd099a71…/1f2e536e… 互异。SA2 独立逐行转写复算追加 17 条边界向量（55/56/63/64/119/120 字节块边界、1000 字节多块、1–4 字节 UTF-8）全部一致（其报告「验证证据」节）。设计期还捕获并修正一处草稿错误（位长编码除法未取整——空文本全零巧合掩盖），佐证 KAT 必要性 | 低（已实证） |
| 4 | 包内无可用 `TextEncoder` **类型**（运行时全局存在但类型层缺失） | 源码引用 | `tsconfig.base.json`：`"lib": ["ES2022"]`（无 DOM）；`node_modules/@types/node` 全量 grep `var TextEncoder` **零命中**（exit 2）。故 `new TextEncoder()` 无法通过 `pnpm typecheck`——D8 弃用、纯 TS UTF-8 的直接动因 | 低（已实证） |
| 5 | `vi.mock('../src/evaluate.js')` 对「index.ts 值导入 evaluate」同样截获 | 现有测试引用 + 源码引用 | mock 挂在**模块图**（SA6 测试头注 :44-45 自述）；index.ts 当前 `export { evaluate } from './evaluate.js'`（:63）本就经该模块解析——改为 `import` + `export` 不改变解析目标模块；SA2 增量复核：`:195 evaluateMock = vi.mocked(evaluate)` 从 `../src/index.js` 取到的即 mock 实例，拦截对 re-export 与值导入等价 | 低 |
| 6 | `parseSchemaEnvelope` 内部改用 gate 后行为逐字节不变 | 源码引用 + 类比已有验证 | 重构前后执行序完全同构：`validateEnvelopeShape →（issues 同序同构造）→ dialectIssueOrNull →（ENV-4 同构造）→ parseVfsl(text) → 同款 map 包装`；envelope/ENV 构造点全部单源复用；SA2 逐语句比对现行实现（index.ts:135-160）确认同构；H1 验收测试 `parse-schema-envelope.test.ts` 不改一行即为回归证明（RT-4，DENY LIST 承诺） | 低 |
| 7 | **WTF-8 单射字节化（R2/A1）**：lone surrogate 编码至 ED A0 80–ED BF BF 段后，lone surrogate / U+FFFD / 彼此、畸形边角两两摘要互异；期望摘要值正确 | 设计期实测验证 | 命令：`node:crypto` 对**手构字节序列**求参照摘要（绕开 `Buffer.from(string)` 的替换语义）——`createHash('sha256').update(Buffer.from([0xed,0xa0,0x80])).digest('hex')` 等，与 §5.3 实现（WTF-8 分支）的 `sha256Hex('\uD800')` 等对拍。**输出**（R2，2026-08-21，全 `OK`/`true`）：`'\uD800'`（ED A0 80）→91a681b998555fb4…、`'\uDC00'`（ED B0 80）→b2d612a08bec1f41…、`'\uFFFD'`（EF BF BD）→83d544ccc223c057…、`'\uDBFF'`→70f1c475…、`'\uDFFF'`→8a8821b2…；`D800 vs FFFD / D800 vs DC00 / FFFD vs DC00 distinct: true ×3`；攻击对 `TEXT_P`（doc 注释+字面量含 \uD800）→0150e7d3… vs `TEXT_Q`（同形含 \uFFFD）→9d96376c… **distinct: true**；畸形边角（反向代理对 `\uDE00\uD83D` / 双高 `\uD800\uDBFF` / 高+尾字符 `\uD800x` / 配对星面 `\uD83D\uDE00`）4 摘要两两互异。对照实证（SA2 报告「lone surrogate '\uD800' vs '\uFFFD' same digest: true」）：**R1 替换编码下三者同键——A1 攻击链闭合；R2 下互异** | 低（已实证） |

## §10. 契约改动连锁审计 (Contract Change Caller Audit)

**结论：无公共契约改动。** 本设计新增函数（getCompiled）+ 内部重构（不改任何既有函数的签名、返回类型、抛错行为）。逐项审计如下：

### 改动函数

| 函数 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `getCompiled` | `packages/vfsl/src/index.ts` | （不存在） | 新增：`(input: string \| SchemaEnvelope) → GetCompiledResult`；同步、不抛错（**R2/A2：全函数体顶层崩溃边界 ENV-100**，结构性承诺） |
| `parseSchemaEnvelope` | `packages/vfsl/src/index.ts:135` | `(unknown) → ParseSchemaEnvelopeResult`；同步、纯、不抛错 | **不变**（仅内部经 envelopeTextGate 编排，构造点单源，见 §9 #6） |
| `evaluate`（index.ts 导入形态） | `packages/vfsl/src/index.ts:63` | 纯 re-export，公共导出名 `evaluate` | **公共面不变**（同名同源 re-export）；内部新增值绑定供 getCompiled 调用 |
| `envelopeTextGate` / `vfslIssues` | `packages/vfsl/src/envelope.ts` | （不存在） | 新增**模块内部导出**（不经 index.ts 公共面暴露，沿 envelope.ts 既有内部导出惯例——validateEnvelopeShape 等同为模块级导出） |
| `sha256Hex` / `utf8Bytes` | `packages/vfsl/src/sha256.ts` | （不存在） | 新增叶子模块导出；仅 KAT 测试直连 `../src/sha256.js`（沿 SA6 mock `../src/evaluate.js` 的测试直连内部模块先例），不进公共面 |

### Caller 清单（全部既有 caller，`git grep` 实证）

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| `evaluate` ← codegen 采集器 | `packages/vfsl-codegen/src/collect.ts:71` | 否（同步调用） | 是（result 联合分支处理，codegen 任务落地） | N/A | **零影响**：evaluate.ts 本体与公共导出均不改 |
| `evaluate` ← SA6 docscope 测试（mock 面） | `packages/vfsl/test/docscope-getcompiled.test.ts:57,183` | 否 | N/A（测试自身） | N/A | **零影响**：mock 挂模块图，值导入同被截获（§9 #5） |
| `evaluate` ← index.ts re-export（既有消费者经 `@nomicore/vfsl` 取用） | `packages/vfsl/src/index.ts:63` | N/A | N/A | N/A | 导入形态调整，公共绑定不变 |
| `parseSchemaEnvelope` ← H1 验收测试 | `packages/vfsl/test/parse-schema-envelope.test.ts`（全文件） | 否 | N/A（断言返回值联合） | N/A | **零影响**：行为逐字节不变（§9 #6），该测试零改动应全绿 |
| `parseSchemaEnvelope` ← SA6 docscope 测试（AC4 对照基准） | `packages/vfsl/test/docscope-getcompiled.test.ts:308` | 否 | N/A | N/A | 同上；getCompiled 拒绝 issues 与其深度相等由 gate 同源构造保证 |
| `shapes.ts` 内局部 `evaluate(scc: string[])` | `packages/vfsl/src/shapes.ts:283` | 否 | N/A | N/A | **同名不同物**（语义相位局部助手，签名 `string[]`≠`VfslModule`），零关联 |

### 风险评估

- 无「return→throw」「同步变 async」类改动；getCompiled 是**纯新增**——不存在既有 caller 需要适配。
- 未来 caller（Phase 2 yjs-server、codegen 管线）：消费 `GetCompiledResult` 联合，从第一天写 ok 检查（与 ADR-0003 前向兼容措辞同构）。
- 抓全方法留档：`git grep -n "\bparseSchemaEnvelope\s*(\|\bevaluate\s*(" -- 'packages/**/*.ts' 'apps/**/*.ts'`（已执行，结果即上表）。

## §11. SA6 红灯测试复核——三处与任何正确实现不相容的缺陷（R1 上报；**R2 状态：已由 SA6 修正执行完毕**）

> 红灯记录（12F/1P）中 12 条全部失败于 `TypeError: getCompiled is not a function`——**构造性红灯掩盖了断言层缺陷**：任何断言从未被执行过。SA1 逐用例模拟（依据：本设计 §5.2 控制流 + 既有 H1 语义）发现以下三处在**任何**正确实现下都无法通过。它们不是实现自由度问题，而是测试文件内部的逻辑矛盾，证据充分、修正极小。SA1 依修订协议如实上报，不自行修改 SA6 文件。
>
> **R2 状态更新**：三处最小修正案已由 SA6 执行（任务简报「修正记录」R1；当前测试文件 :111 `TEXT_HIT` / :114 `TEXT_RETRY` / :319 case-3 `lang:'wml'`，与下文修正案逐字一致）——SA8 设计后复审登记 + 总控逐条核实 + SA2 直读复核三重确认；修正后仍为构造性红灯 12F/1P（`tsc` 仅剩预期缺失导出错误）。本节保留作为修正依据与回归参照；SA6 文件在 ALLOW LIST 中转为「预期零改动」。

### 11.1 缺陷 A：AC4.1 case-3 期望与自身对照基准矛盾（不可满足）

```ts
// docscope-getcompiled.test.ts:302
{ lang: 'vfsl', version: 1, id: 'x', text: TEXT_BAD }, // 未知方言先于文本拒绝
```

- **矛盾证明**：case-3 的 `lang='vfsl', version=1` 是**已知方言**，`TEXT_BAD` 是语法错误文本。按 H1 语义（`parseSchemaEnvelope` 即测试自身的对照基准 `:308`）：形状过 → 方言过 → `parseVfsl(TEXT_BAD)` 失败 → issues = `[{kind:'vfsl', …}]`。而测试 :314-318 断言 `first.kind === 'envelope'` 且 `code === '4'`（ENV-4）。于是 :311 的 `expect(issues).toEqual(h1.issues)`（要求 kind:'vfsl'）与 :314（要求 kind:'envelope'）**逻辑合取不可满足**——即便让 getCompiled 偏离 H1 返回 ENV-4，:311 的 toEqual 也会失败。任何实现二选一必红。
- **成因推断**：注释「未知方言先于文本拒绝」表明意图是「未知方言 + 坏文本 → 方言拒绝先赢」——fixture 把 `lang` 误写为 `'vfsl'`。
- **最小修正案**：case-3 改为 `{ lang: 'wml', version: 1, id: 'x', text: TEXT_BAD }`（1 token）。修正后三个 case 依次验证 wml@1 / vfsl@2 / wml@1+坏文本，语义完整。

### 11.2 缺陷 B：AC1.2 假设冷缓存，与 AC1.1 的必然写缓存矛盾（跨测试状态耦合）

- **推导**：AC1.1（:190-203）断言两次调用（不同 id、独立信封对象）返回**同一对象引用**。同引用只能来自 memoization——AC1.1 执行后 `TEXT_A` 必然已在缓存。AC1.2（:205-220）第一个调用 `compiledOf(envelopeOf(TEXT_A))` 后断言 `expect(evaluateMock).toHaveBeenCalledTimes(1)`——**要求该次调用是 miss**。缓存已有 `TEXT_A` ⇒ 命中 ⇒ 计数 0 ≠ 1 ⇒ 红。
  - 「命中路径仍然调用 evaluate 但丢弃结果」的绕法不成立：AC1.2 末尾再次断言计数为 1（:219），武装的一次性失败若在第二次调用被消费会推高计数/或需「第一次命中算、第二次命中不算」的无原则状态机——不存在有原则的实现。
- **机制证据**：同文件模块级缓存跨 `it` 存续（§9 #1 实证 + vitest 按文件隔离/文件内共享的默认语义；测试文件无任何 reset 机制）。
- **最小修正案**：AC1.2 改用**本用例专属文本**（如 `const TEXT_HIT = 'type ROOT = { hit: string; };';`，或等价唯一变体）。该用例全部断言语义（miss→evaluate 1 次 → 武装失败 → 命中同引用不重算）不受文本内容影响。同理确认其余用例（AC1.1/1.3/2.x/3/4.2/6.2/边界）对 TEXT_A 冷热**均**通过（SA1 已逐用例模拟，见 §11.4），无需改动。

### 11.3 缺陷 C：AC5 同根因（TEXT_A 已被前序用例缓存）

- **推导**：AC5（:346-368）武装一次性求值失败后调 `compiledOf(envelopeOf(TEXT_A))`，期望 `ok:false`。此时 `TEXT_A` 已被 AC1.1 缓存（AC4.2 亦再命中）⇒ 该调用**直接命中缓存返回 ok** ⇒ `expectRejected` 红；后续 `toHaveBeenCalledTimes(2)` 的重算断言同样落空。
- **最小修正案**：AC5 改用专属文本（如 `const TEXT_RETRY = 'type ROOT = { retry: number; };';`）。该用例三段式（注入失败→重试成功→第三次命中同引用）在唯一文本下语义完整成立。

### 11.4 修正后全量模拟结果（SA1 依本设计 §5.2 控制流逐用例推演）

| 用例 | 修正前（本设计实现下） | 修正后 |
|---|---|---|
| AC1.1 / 1.3、AC2.1 / 2.2、AC3、AC4.2、AC6.1 / 6.2、边界 1 / 2 | **绿**（对 TEXT_A/TEXT_B 冷热均通过——已逐用例验证） | 绿（无改动） |
| AC4.1（缺陷 A） | 红（逻辑不可满足） | 绿（case-3 lang 改 'wml'） |
| AC1.2（缺陷 B） | 红（命中计数 0≠1） | 绿（专属文本） |
| AC5（缺陷 C） | 红（命中即 ok） | 绿（专属文本） |

### 11.5 已评估并否决的「让测试原样通过」的引擎侧方案（防止 SA2 要求走弯路）

| 方案 | 否决理由 |
|---|---|
| 每测试作用域缓存（AsyncLocalStorage 等） | 依赖 vitest 内部 ALS 语境的未文档化行为；生产语义错误（缓存退化为请求级，ADR-0001「性能依赖编译缓存」落空）；`node:async_hooks` 又是一处环境绑定（违 D8/INV-7） |
| 命中仍调 evaluate 但丢弃结果 | 违反缓存语义本身（命中不重算是 AC 的可观察断言）；AC1.2 末尾计数断言仍无法满足（见 11.2） |
| TTL/返回次数上限等花式淘汰 | 对测试执行时序的过拟合，非原则设计；生产无此需求 |
| 引擎导出测试专用 reset 钩子 | 公共面污染（测试机制渗入引擎 API）；SA6 文件亦未调用任何 reset，不解决 |
| 负缓存（缓存 parse 失败） | 不解决 B/C（它们卡在 ok 条目）；且破坏「重试可成功」对称性（AC5 明文要求失败不落缓存） |

**结论**：三处修正是测试侧 1-token + 两个 fixture 常量的最小改动，全部落在 SA6 owned 文件内（ALLOW LIST 已标注「由 SA6/总控执行」）。SA1 建议总控在 SA3 实现前先行路由 SA6 微修正，避免 Phase 3/7 阶段在已知缺陷上空转。（**R2：建议已被采纳并执行**——见本节头部状态更新。）

## §12. v2 演进义务 checklist（R2 新增——N2 固化，含 SA8 设计后复审边缘项 #7/#9 登记）

> 本节把散落于 D2/D3/§5.2 注释中的前瞻义务收拢为显式 checklist：**触发票必须逐项对照**，防「当年登记、来年失忆」。

| # | 触发条件 | 义务 | 来源 |
|---|---|---|---|
| V2-1 | 引入第二个方言版本（如 vfsl@2 / 其他 lang） | **缓存键域必须同步升级为 (方言身份, 文本内容) 二元组哈希**——纯文本键在多解释器并存下会跨方言串味（同文本、异解释 → 共享错误条目）；本设计 v1 单解释器下该风险为零（信封路径经 gate 全收窄为 vfsl@1、文本路径亦然），升级属破坏性缓存语义变更，须按 ADR-0001「方言只增不改」走增量方言票并列为该票**验收项**（SA8 边缘项 #9 的前瞻义务原文登记） | SA8 设计后复审 #9 + SA2 N2 |
| V2-2 | 进程内命名空间规模/文本规模实测触顶（内存压力） | 评估淘汰策略（LRU / 弱引用 / 按 DocScope 生命周期回收）；当前 §5.2 Map 声明处注释即论证锚点 | 简报 v1 条款 |
| V2-3 | CONTEXT.md「每个命名空间绑定自己的编译缓存」若被 owner 取强字面（物理 per-scope 册） | 引入 DocScope 实例工厂（每实例独立 Map），`getCompiled` 退化为默认实例薄壳，公共契约不变（SA8 #7：术语规范核心是隔离性与消灭进程级「当前版本」，单册为 v1 实现自由，强字面属演进选项） | SA8 设计后复审 #7 |
| V2-4 | 编译接缝出现 async 形态（如预算化求值/异步 parse） | 缓存须加 in-flight Promise 去重（并发同文本 miss 合并），并重审 D1 同步裁定与 §6 并发行 | §6 并发行 + D1 |

---

## 附：设计自检（SKILL 一致性要求）

- 关键术语全文一致性：`getCompiled`（唯一公共入口名）/ `envelopeTextGate`（唯一前探门名）/ `sha256Hex`（唯一哈希入口）/ `utf8Bytes`（唯一字节化入口，R2 起 WTF-8 单射语义）/ `compiledCache`（唯一缓存标识）/ `deepFreeze`（唯一冻结助手）——全文检索无别名漂移；未出现 registry/compiler 语系（冲突报告提示 #2；SA8 复核 2 认可）。
- 死引用检查：伪代码引用的 `validateEnvelopeShape` / `dialectIssueOrNull` / `envelopeCrashIssue` / `assertVfslDialect` / `parseVfsl` / `evaluate` 均为既有源码实名实位（§1.2 盘点，R2/A3 已修正 codegen sha-256 先例条目）。
- 断层检查：公共契约（§4）↔ 实现伪代码（§5.1/§5.2）↔ 守卫测试（§5.4/§5.5）↔ AC 映射（§7）↔ 文件清单（§8）五点闭环，每个 ALLOW 文件在正文有对应章节与行数估算；RT-1/RT-2/RT-3 守卫与 SA2 红线测试思路一一对应（RT-4 回归护栏落在 DENY LIST 承诺）。
- SA2 已验证面零波及自检：SHA-256 压缩循环/K 表/长度编码逐字节未动（仅 utf8Bytes 代理分支变更，合法文本字节化不变——§9 #3 R2 复跑实证）；D5 gate 伪代码未动；deepFreeze 未动；§11 分析与修正案未动（仅追加状态更新）；§11.5 否决清单未动。
- 一致性反扫（修订协议要求）：全文检索「U+FFFD」共现处均以「坍缩风险已废弃/对照实证/互异要求」语境出现（R1 的「良性行为」表述已全部清除）；「崩溃边界」共现处均为全函数体口径（R1「仅包 gate」的现行设计表述已清除，残留三处均为被否方案/守卫注释/本自检的历史对照语境）；「编译产物」设计正文零残留（仅存于 SA8 措辞观察引用与本自检行），设计自身措辞已统一「编译缓存条目」。
- 修订历史：R1（首版）→ **R2（本版：SA2 reject 修订——A1 CRITICAL 单射字节化 / A2 全函数体崩溃边界 / A3 盘点修正 / A4 命令原文 / N1 RT-3 / N2 §12 / SA8 措辞观察顺带采纳）**。
