# SA1 设计 — 功能开发：信封解析与方言路由 parseSchemaEnvelope（Issue #52 / H1）

> R1（2026-08-21）。任务类型 feature（Phase 2 前置三票之 H1：新增公共导出 `parseSchemaEnvelope`）。
> 输入：任务简报 `task_vfsl-schema-envelope.md`（含 SA6 红灯验收测试锚定节与红灯运行证据）、
> SA8 相关决议摘录 `task_vfsl-schema-envelope_relevant_decisions.md`（ADR 约束基准）与冲突报告
> （verdict `clear`，备注 N1–N5）、SA6 红灯 `packages/vfsl/test/parse-schema-envelope.test.ts`
> （12 用例，本会话亲跑复核全红）、`docs/vfsl/v1-spec.md` §7/§8/§9、`docs/phases/phase-2-engine-gaps.md`、
> `packages/vfsl/src/{index,ir,errors,schemasource,validate}.ts` 现状。
> 本设计不写代码；SA3 按本文件实现。设计期验证均实跑留证（§10，输出全文贴入文档）。
>
> **R2（2026-08-21）**：按 SA2 R1 攻击评审（reject，两项 MINOR，架构主体通过）修订。
> **#1** 动态值转义缺失（ENV-4 内嵌 `input.lang`、ENV-100 内嵌 `err.message` 可携带换行——
> 本会话实测**通道伪造向量成立**：hostile `lang="x\nVFSL-E999: …"` 经 assertVfslDialect 原消息
> 组合后 `/^VFSL-E\d+:/m` 检出行首伪造，见 §10 R2 证据行）→ `makeEnvelopeIssue` 增设
> **唯一构造点单行 sanitizer**（§2.1，逐字符类定稿——交替分支版 CRLF 误映射缺陷于自检中
> 发现并修正）+ ENV-4 后置转义论证（§4）+ §6.1「单行」措辞升格为结构性保证并列入冻结项 +
> §7 边界表补两行 + §9 风险行 8（转义集完备性）；**#2** 测试文件数改实测口径（runtime
> `.test.ts` = 26 含本票；vitest 汇总 31 = 26 + 5 个 `.test-d.ts`；用例 464 不变）→
> §8.2/§8.4/§10。逐条回应表见文末。

## §0. 结论速览

| # | 裁定 | 章节 |
|---|---|---|
| 1 | **对 SA6 测试契约无异议**：接缝 `parseSchemaEnvelope(input: unknown) → { ok: true; envelope; module } \| { ok: false; issues }`、同步、纯函数、不抛错、issues 恒为 `VfslIssue` 形状（`{message, line, column}` 三字段 number/string）——12 用例逐条复核可转绿（§8.1） | §1.3 / §8.1 |
| 2 | 新增内部模块 `packages/vfsl/src/envelope.ts`（信封形状校验 + 方言路由转译 + ENVELOPE 码构造，~120 行）；编排函数 `parseSchemaEnvelope` 本体落 `index.ts`（与 `parseVfsl` 同址——parseVfsl 的实现与导出本就在 index.ts，ir.ts:5 注释明示；避免 envelope.ts→index.ts 模块环） | §2 |
| 3 | 校验顺序即语义：**形状（typeof 门）→ 方言断言（未知方言只读 loud-fail，先于文本解析）→ parseVfsl 透传**。同一非法文本 + 未知方言 → 方言错误而非文本错误（AC3 顺序锚的机制根源） | §3 / §4 / §5 |
| 4 | 方言断言**复用** `assertVfslDialect`（schemasource.ts:93，断言语义单点冻结的既有资产），`SchemaSourceError('dialect-mismatch')` 就地转译为信封层 issue——语义单点保持，错误通道两制不混 | §4 |
| 5 | **信封层独立错误码空间 `VFSL-ENV-E<码>`**（ENV-1 非对象 / ENV-2 缺键 / ENV-3 类型错 / ENV-4 未知方言 / ENV-100 崩溃边界）：前缀机械上不落入 `/^VFSL-E\d+:/`（`E` 后随 `N` 非 digit）；ENV-100 对齐 parseVfsl E100 兜底口径（errors.ts「100 = catch-all」惯例）；**R2 #1：每条 message 单行是结构性保证**——唯一构造点 `makeEnvelopeIssue` 内置 sanitizer，四种 Unicode 行终止符一律可见转义，动态值（ENV-4 内嵌 lang / ENV-100 内嵌 err.message）无法伪造行首 `VFSL-E<码>:` 文本通道行 | §6.1 |
| 6 | **坐标哨兵**：信封层 issue 恒 `line: 0, column: 0`（非文本锚定）；文本层 issue 恒 `line ≥ 1`（v1-spec 行列 1-based）。前缀 + 哨兵双正交判别器（AC6「明确区分机制」的双保险） | §6.2 / §6.3 |
| 7 | 形状负例**全收集**（缺键归一条 ENV-2 列全 + 类型错归一条 ENV-3 列全，至多 2 条）；方言失败恰 1 条；非对象单条早出。v1-spec §4「单错误冻结」是方言层纪律，不辖信封层（§6.5 论证） | §3 / §6.5 |
| 8 | 对既有代码**纯增量**：12 个引擎内部件 + schemasource.ts 一行不动；`index.ts` 追加 1 个值导出 + 1 个类型导出；`pnpm typecheck` 现状唯一错误 TS2724 随导出落地自愈（本会话亲证）；全量存量测试零回归（§8.2） | §8.2 / §8.3 |
| 9 | 包版本 0.1.8 → 0.1.9（patch，新增公共面沿 F1 先例 Hard Gate 口径）；零新依赖、零 CI 改动（新测试经 vitest include 自动入列） | §8.4 / §12 |

---

## §1. 需求推演（Feature：切入点与契约复核）

### 1.1 定位

H1 是 Phase 2（yjs-server 接入）的引擎前置第一票（`docs/phases/phase-2-engine-gaps.md` 表 H1 行）：
doc 顶层 `SCHEMA` 键（ADR-0001 命名修订）下的信封 `{ lang, version, id, text }` 到达引擎侧后的
**第一个消费动作**——「这份数据是不是它自称的 schema、说的是哪种方言、文本按该方言如何解释」。
v1-spec §7 明言 parser（`parseVfsl`）**只消费 `text`**、「信封解析与方言路由（未知方言 loud-fail
只读）是后续引擎任务」——本票就是那个被预告的引擎任务（PRD #3 同句预告）。

正确性焦点不是「能解析」，而是三件事：

1. **方言冻结纪律的运行时兑付**：未知方言（`lang/version` 不在已实现集）→ 只读 loud-fail，
   **绝不**尝试解释文本（ADR-0001「未知方言 loud-fail 只读」；AC3 顺序锚：同一非法文本 +
   未知方言必须报方言错误而非文本错误——「不解释」的可观测证据）；
2. **错误身份可区分**：信封/方言层拒绝与 schema 文本语法错误是两类故障（前者 = 数据拿错/方言
   不识别，运维动作是换数据或升级引擎；后者 = 文本非法，动作是改文本）——错误通道必须让消费方
   一眼分流（AC6）；
3. **透传零损**：合法信封的 ok/issues 与直接调 `parseVfsl(text)` 完全一致（含行列，AC4）——
   `parseSchemaEnvelope` 在文本解释维度是**透明管道**，不是第二解释器。

现状锚点：仓内已有生产消费方 `packages/vfsl-codegen/src/collect.ts:44-64` 手工组装同款流程
（`assertVfslDialect(env)` → `parseVfsl(env.text)`，注释自称「消费方首动作」）——本接缝把该
流程产品化为引擎侧单一入口（codegen 侧换用属未来演进票，§11/§12 记录，本票不动）。

### 1.2 与既有架构的一致性

- **信封四键**与 v1-spec §7 表、CONTEXT.md「信封」条目、`schemasource.ts:37-42` 的
  `SchemaEnvelope` 逐字一致——**复用该类型**（`import type { SchemaEnvelope } from './schemasource.js'`），
  不另造第二信封形状。`lang: string` 保持方言泛型（不窄化到 `'vfsl'`——方言约束由断言层执行，
  F1 设计 §1.2 同款裁定）。
- **`SCHEMA` 键名**是 doc 侧概念（ADR-0001 命名修订：信封在 doc 中的键名，内部结构不变）。
  本接缝入参是**信封对象本身**（从 `SCHEMA` 键取出的值），不感知 doc、不感知键名——
  键名路由是 Phase 2 yjs-server 侧职责。设计全文不出现 `__schema__`。
- **接缝纪律**与 PRD #3 / ADR-0003 全家同款：同步、纯函数、不抛错、ok-union 可失败、错误经
  返回值传递（issue #20 evaluate / issue #21 validateSnapshot / issue #25 SchemaSource 均同款；
  N3 备注已裁「同步纯函数 vs async 接缝互不约束」）。
- **错误通道三分，互不相干**（本设计最重要的领地划分）：

  | 通道 | 形状 | 归属层 | 管什么 |
  |---|---|---|---|
  | 方言层 | `VfslIssue {message,line,column}`，前缀 `VFSL-E<码>:`（errors.ts 21 码冻结注册表） | 文本解释（tokenize/parse/analyze/evaluate/validate） | 这段**文本**是否合法方言 |
  | 信封层（本票新增） | `VfslIssue` 同形状，前缀 `VFSL-ENV-E<码>:`，坐标哨兵 0/0 | 信封形状 + 方言路由 | 这份**数据**是不是它自称的 schema、方言认不认识 |
  | 接缝层 | `SchemaSourceError`（throw，三码语义域） | SchemaSource 取数（盘上/网络） | 这份**来源**能不能交出信封 |

  与 F1 设计 §1.2「接缝层与方言层两套通道」一脉相承；本票在两套之间补第三套（信封层），同样
  不复用 `errors.ts` 的 VFSL-E 注册表。为什么信封层要用 `VfslIssue` **形状**而不学 validate.ts
  自立 `ValidateIssue`（`{message, path}`，validate.ts:48-53 明言「不复用 VfslIssue——无行列」）：
  **本接缝的 ok:false 分支是混合通道联合**——信封拒绝与 parseVfsl 文本错误都落在同一个
  `issues: VfslIssue[]` 字段里，单一同构 issue 类型是联合分支的类型前提；通道区分交给消息前缀 +
  坐标哨兵（§6.3），而非类型分叉。SA6 红灯测试的 `expectRejected` 辅助函数（每条 issue 必有
  number 型 line/column）已把这个形状锚死——形状选择同时是测试锚定项。

- **id 仅标签**（ADR-0005 §1「id 是标签不是键」）：形状校验只查 `typeof id === 'string'`，
  **零格式校验、零唯一性记忆、零注册表**——空串、路径分隔符、中文、emoji、撞名全部放行且
  各自独立解析（AC5）。函数无任何模块级状态（§7 纯度论证），撞名场景自然满足。
- **多键不拒**（AC2，向前兼容加法）：未知键容忍忽略——与方言「只增不改」加法演进精神一致
  （冲突报告 N2 已裁 no-conflict）。但**信封回显恰四键**（§3.4）：多余键不进 `envelope`
  返回值（`SchemaEnvelope` 类型本就「恰四键，不夹带成员」，schemasource.ts:36 注释）。

### 1.3 SA6 契约复核（结论：无异议，逐条可满足）

| SA6 锚定（测试文件） | 本设计落点 | 结论 |
|---|---|---|
| AC1 合法信封 → 同步 `{ok:true, envelope, module}`、非 thenable、不抛、两调一致 | §5 编排 + §3.4 恰四键回显 + parseVfsl 引用直通 | 满足 |
| AC1 九种对抗输入（undefined/null/42/'string'/true/[]/[1,2]/{}/函数）→ 结构化拒绝非抛错 | §3.1 输入门：ENV-1 ×8、`{}` → ENV-2 | 满足 |
| AC2 缺键（四键各缺 + 空对象）/ 类型错（version:'1'、text:42、lang:1、id:42）→ 结构化拒绝 | §3.2 四键契约表：ENV-2 / ENV-3 | 满足 |
| AC2 多键不拒 → ok:true 四键原值透传 | §3.4：未知键忽略 + 恰四键回显 | 满足 |
| AC3 `{vfsl,2}` / `{other,1}` → 拒绝且消息匹配 `/方言\|dialect/i`、不落 VFSL-E 码空间 | §4：ENV-4 消息含「未知方言」 | 满足 |
| AC3 顺序锚：同非法文本 + 未知方言 → 方言错误；vfsl@1 → 文本错误原样透传且两通道不等 | §5 编排顺序（形状→方言→文本） | 满足 |
| AC4 ok 透传 `module` 与 `parseVfsl(text).module` 全等；issues 全等 + `line:3, column:7` + `^VFSL-E\d+:` | §5 引用直通；锚点本会话 tsx 实测复证（§10） | 满足 |
| AC5 id 空串/特殊字符不影响判定；同 id 不同 text 各自解析、两 module 不等 | §1.2 id 仅标签 + 无状态 | 满足 |
| AC6 五种拒绝每条 message `not.toMatch(/^VFSL-E\d+:/)`；文本错误透传保留 VFSL-E 前缀 | §6.1 前缀 `VFSL-ENV-E`（E 后随 N） | 满足 |

---

## §2. 模块设计：布局与公共面

### 2.1 文件布局

新增单模块 `packages/vfsl/src/envelope.ts`（预估 ~120 行含注释），内聚信封层全部概念；
编排函数 `parseSchemaEnvelope` 本体落 `index.ts`（`parseVfsl` 之后），追加 ~30 行。

**为什么编排不在 envelope.ts**：编排需要调 `parseVfsl`，而 `parseVfsl` 的实现与导出按既定
布局就在 `index.ts`（ir.ts:5 注释明示「`parseVfsl` 的实现与导出在 `index.ts`」）。envelope.ts
若 `import { parseVfsl } from './index.js'`，而 index.ts 又从 envelope.ts 取导出——模块环。
ESM 函数体引用虽可侥幸工作，但环是结构性坏味（SA2 必攻点）。拆法：**纯校验件归 envelope.ts
（零 index 依赖），编排归 index.ts（与 parseVfsl 同址同款）**——与 parseVfsl 编排
tokenize→parse→analyze 的既有形态完全同构。

```ts
// packages/vfsl/src/envelope.ts（签名级伪代码，实现细节 SA3 自由度内）

import { assertVfslDialect, SchemaSourceError } from './schemasource.js';
import type { SchemaEnvelope } from './schemasource.js';
import type { VfslIssue, VfslModule } from './ir.js';

/** 信封层错误码注册表（ENVELOPE 码空间——与 errors.ts 方言层 21 码互斥，见设计 §6.1）。 */
export const EnvelopeErrCode = {
  ENV_1: '1',      // 非对象（原始值 / null / undefined / 函数 / 数组）
  ENV_2: '2',      // 必需键缺失（一条列全）
  ENV_3: '3',      // 键类型错误（一条列全）
  ENV_4: '4',      // 未知方言（只读 loud-fail）
  ENV_100: '100',  // 崩溃边界（意外异常——对齐 parseVfsl E100 兜底口径）
} as const;

/**
 * 信封层 issue 构造——**唯一构造点**（R2 #1 冻结）：冻结前缀 `VFSL-ENV-E<码>: ` +
 * 坐标哨兵 0/0（§6.2）+ **单行结构性保证**：正文先经 sanitizeEnvelopeMessage，
 * 任何动态值（ENV-4 内嵌 assertVfslDialect 原消息、ENV-100 内嵌 err.message）都无法
 * 令 message 出现行终止符，从而无法伪造行首 `VFSL-E<码>:` 的文本通道行（§6.1/§10 R2）。
 */
export function makeEnvelopeIssue(code: string, message: string): VfslIssue {
  return {
    message: `VFSL-ENV-E${code}: ${sanitizeEnvelopeMessage(message)}`,
    line: 0,
    column: 0,
  };
}

/**
 * R2 #1 冻结的单行 sanitizer（模块内部）：四种 Unicode 行终止符（\n、\r、\u2028、\u2029
 * ——ECMAScript 行终止符全集，也是 `/m` 正则 `^` 的分行边界）一律替换为可见转义
 * `\\n` / `\\r` / `\\u2028` / `\\u2029`。**逐字符类映射**（非交替分支——CRLF 整体匹配在
 * 相等分支下会误映射，逐字符处理则 `\r\n` 忠实转义为 `\\r\\n`）。纯函数、确定性、
 * 逐字符 1→2 无长度放大风险。在唯一构造点**后置**执行：ENV-4 的动态值插值发生在冻结
 * 资产 assertVfslDialect 内部（DENY LIST，不可预转义），后置组合整串净化是唯一可行的
 * 单点（§4）。设计期实测（CRLF/四终止符/伪造行/正常消息四类用例）见 §10 R2 输出块。
 */
const LINE_TERMINATOR_ESCAPES: Record<string, string> = {
  '\n': '\\n',
  '\r': '\\r',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};
function sanitizeEnvelopeMessage(body: string): string {
  return body.replace(/[\n\r\u2028\u2029]/g, (c) => LINE_TERMINATOR_ESCAPES[c] as string);
}

/** 四键契约（v1-spec §7 表序冻结：lang, version, id, text）。 */
const ENVELOPE_KEYS = [
  { key: 'lang',    expect: 'string' },
  { key: 'version', expect: 'number' },
  { key: 'id',      expect: 'string' },
  { key: 'text',    expect: 'string' },
] as const;

export type EnvelopeShapeResult =
  | { ok: true; envelope: SchemaEnvelope }
  | { ok: false; issues: VfslIssue[] };

/** §3 形状校验：输入门 → 四键 own-key + typeof 扫描 → 恰四键回显。 */
export function validateEnvelopeShape(input: unknown): EnvelopeShapeResult;

/** §4 方言路由：复用 assertVfslDialect，dialect-mismatch 就地转译 ENV-4；非方言异常原样上抛。 */
export function dialectIssueOrNull(envelope: SchemaEnvelope): VfslIssue | null;

/** §6.1 崩溃边界 issue（顶层 catch 收编用）。 */
export function envelopeCrashIssue(err: unknown): VfslIssue;

/** 公共接缝返回形状（index.ts 经此 re-export）。 */
export type ParseSchemaEnvelopeResult =
  | { ok: true; envelope: SchemaEnvelope; module: VfslModule }
  | { ok: false; issues: VfslIssue[] };
```

模块依赖边：`envelope.ts → schemasource.js`（运行时：assertVfslDialect/SchemaSourceError；
类型：SchemaEnvelope）与 `envelope.ts → ir.js`（仅类型）。前者把 schemasource.ts 的
`node:fs/promises` import 传递进 envelope 消费方——**非回归**：index.ts 本就 re-export
FileSchemaSource（index.ts:62），任何经公共入口的消费者今天已携带该绑定；若未来需要
浏览器零 node 绑定子入口，属 package.json `exports` 拆分票（F1 设计 §6.1 被否方案同款论证），
不在本票。

实现注意（tsconfig 既有开关，SA3 须过 `pnpm typecheck`）：`Object.hasOwn` 需 lib ES2022
（tsconfig.base.json `target/lib: ES2022` ✓）；`verbatimModuleSyntax` 下类型导入用
`import type`；`noUncheckedIndexedAccess`/`exactOptionalPropertyTypes` 均不构成障碍
（本设计无数组索引取值、无可选字段）。

### 2.2 公共面导出（index.ts 追加）

```ts
// packages/vfsl/src/index.ts 追加（既有导出一行不动）：
export type { ParseSchemaEnvelopeResult } from './envelope.js';
// + parseSchemaEnvelope 函数本体（§5 伪代码）紧跟 parseVfsl 之后
```

公共面新增 **1 个值导出 + 1 个类型导出**。`validateEnvelopeShape`/`dialectIssueOrNull`/
`envelopeCrashIssue`/`makeEnvelopeIssue`/`EnvelopeErrCode` 保持模块内部（不是接缝，是编排的
实现细节，导出只会冻结尚无消费方的形状——F1 对 parseHeaderDirectives 同款裁定）。
`SchemaEnvelope` 已是公共导出（index.ts:63-68），零变动。

---

## §3. 信封形状校验（规则冻结）

### 3.1 输入门（早出，单条 ENV-1）

| 判定 | 消息 | 码 |
|---|---|---|
| `typeof input !== 'object' \|\| input === null`（undefined/null/42/'string'/true/函数） | `信封必须是对象（{ lang, version, id, text } 四键），实际收到 ${null 或 typeof 名}` | ENV-1 |
| `Array.isArray(input)`（[]、[1,2]） | `信封必须是对象（{ lang, version, id, text } 四键），实际收到数组（长度 N）` | ENV-1 |

数组单列消息（不并入「缺四键」）：`[]` 的确定性诊断是「形状类型错了」而非「键缺失」——
消费方拿到消息即知该去查取数路径，而不是去补键。

### 3.2 四键契约表（typeof 门 + 值域归属）

对四个冻结键逐一扫描：**own-key 存在性**（§3.3）→ **typeof 匹配**。

| 键 | 期望 typeof | 值语义归属 |
|---|---|---|
| `lang` | string | 任意字符串过形状门；`!== 'vfsl'` → 方言域（ENV-4） |
| `version` | number | **typeof 门只认 number**；`NaN`/`1.5`/`-1`/`Infinity` 是 number → 过形状门 → `!== 1` → 方言域（ENV-4） |
| `id` | string | 任意字符串（含空串）——**零格式校验**（id 仅标签，§1.2） |
| `text` | string | 任意字符串（含空串——空文本交给 parseVfsl 报 E310 缺 ROOT，不是信封层的事） |

**关键裁定——「类型错误」与「方言不符」的分界线 = typeof**：`version: '1'`（string）是
**形状错误**（ENV-3，这份数据连方言自述都不是结构完好的）；`version: 2` / `NaN` / `1.5`
（number）是**方言自述完好但不认识**（ENV-4，只读 loud-fail）。与 FileSchemaSource 的
§3.3 校验树「先完整性后方言」同构（schemasource.ts 设计：「键都没有谈不上方言」）；
`NaN !== 1` 走方言断言与 assertVfslDialect 的 Number 解析语义（F1 §3.2：`'abc'` → NaN →
dialect-mismatch）对齐。包装对象（`new String('vfsl')`、`new Number(1)`）typeof 为
`'object'` → ENV-3——信封是**纯数据**（JSON/structuredClone/Yjs 物化形态恒 primitive），
包装对象不是数据形态，拒之无虚假降级。

缺键与类型错**并行全收集**：一次扫描中缺 `lang` 且 `version: '1'` → 两条 issue
（先 ENV-2 后 ENV-3，§6.5）。不存在「缺键即短路不看类型」——键各有独立判定，信息不丢。

### 3.3 own-key 判定（`Object.hasOwn`，不用 `in`）

四键存在性判定冻结为**自有属性**（`Object.hasOwn(input, key)`）：

- 信封是**纯数据契约**：JSON.parse / structuredClone / Yjs toJSON 物化产物恒为自有键；
  类实例/原型链来源不是信封的物化形态；
- 免疫原型链意外：`Object.create({lang:'vfsl', version:1, id:'x', text:'…'})`（误传原型
  而非实例）不因 `in` 命中而被误收——宁可响亮拒绝，不静默按半份数据解释（拒绝虚假降级立法
  的标准适用）；
- `Object.create(null)` 无原型四键对象：hasOwn 命中，照常接受（合法数据形态，不歧视）。

### 3.4 信封回显（恰四键重建）

形状通过后**重建新对象**而非引用输入：

```ts
return {
  ok: true,
  envelope: {
    lang: src.lang as string,
    version: src.version as number,
    id: src.id as string,
    text: src.text as string,
  },
};
```

三个理由：(a) **恰四键**——多余键不夹带（`SchemaEnvelope` 类型契约「恰四键，不夹带成员」；
AC1 `toEqual` 全等断言与 AC2 多键用例的回显语义）；(b) **防御性副本**——纯函数不向调用方
泄漏内部引用，调用方事后改输入对象不影响已返回的 envelope（反之亦然）；(c) 值语义安全——
四值恒 primitive（typeof 门已保证），复制无别名问题。`as` 收窄由前置 typeof 判定背书。

---

## §4. 方言路由（断言复用 + 通道转译）

```ts
export function dialectIssueOrNull(envelope: SchemaEnvelope): VfslIssue | null {
  try {
    assertVfslDialect(envelope);   // 断言语义单点（schemasource.ts:93-103 冻结资产）
    return null;
  } catch (err) {
    if (err instanceof SchemaSourceError && err.code === 'dialect-mismatch') {
      return makeEnvelopeIssue(EnvelopeErrCode.ENV_4,
        `未知方言（只读 loud-fail，不解释 text）: ${err.message}`);
    }
    throw err;   // 非方言断言异常 → 上抛，落 §5 顶层崩溃边界（ENV-100）
  }
}
```

- **复用而非重写判定**：`assertVfslDialect` 是方言断言语义的**单点冻结**（schemasource.ts:87-92
  注释明示 FileSchemaSource 层 1 与消费方层 2 共用，「双层防御非冗余」）——本接缝是该断言的
  第三个共方（引擎侧消费方对到手信封的首动作，ADR-0005 §1「消费方首动作 = 方言断言」）。
  在 envelope.ts 重写 `if (lang !== 'vfsl' || version !== 1)` 会分叉决策点：将来 v2 引入时
  （方言只增不改）需同步改两处，漏一处即静默错误解释——违「断言语义单点」纪律。try/catch
  转译是显式适配器（throw 通道 → 返回值通道），语义零漂移。
- **转译条件收窄**：只转译 `SchemaSourceError && code === 'dialect-mismatch'`；assertVfslDialect
  理论上不可能抛其他（函数体单一 if-throw），但守卫使「方言拒绝」与「意外异常」两通道泾渭
  分明，后者落 ENV-100 崩溃边界（该路径命中 = 实现缺陷，不得视为通过——与 parseVfsl E100
  同款 loud 纪律）。
- **消息内容**：ENV-4 模板自带「未知方言（只读 loud-fail，不解释 text）」前导——AC3 的
  `/方言|dialect/i` 锚由本模板直接满足；内嵌 assertVfslDialect 原消息（`方言不符: 期望
  lang='vfsl'、version=1，实际 lang='other'、version=1`，schemasource.ts:95-96）带实际自述值，
  诊断零重复实现。
- **R2 #1 动态值转义（后置、单点）**：内嵌原消息里的 `lang` 是**未经消毒的任意字符串**
  （形状门只查 typeof——hostile `lang = "x\nVFSL-E999: …"` 会原样进入原消息，本会话实测
  `/^VFSL-E\d+:/m` 在组合后消息中检出伪造行，§10 R2 证据行）。预转义不可行：插值点在
  冻结资产 assertVfslDialect 内部（DENY LIST，改它 = 动 schemasource.ts）。故转义**后置**
  于 `makeEnvelopeIssue` 唯一构造点（§2.1 sanitizer：四种行终止符 → 可见转义）——组合
  完成后整串净化，对 ENV-4/ENV-100（err.message 可含栈式多行）乃至未来任何新增动态值
  统一生效，无需逐插值点设防。
- **`SchemaEnvelope` 可赋值 `DialectAssertionInput`**（lang/version/id 超集，schemasource.ts:80-85
  注释明示此赋值关系）；id 仅作错误上下文随行，不参与判定。

---

## §5. 透传与编排（index.ts 本体）

```ts
// packages/vfsl/src/index.ts，紧跟 parseVfsl 之后（~30 行含注释）：
// 头部追加：import { validateEnvelopeShape, dialectIssueOrNull, envelopeCrashIssue }
//            from './envelope.js';   // 三个内部件（§2.1），公共面不 re-export
//          import type { ParseSchemaEnvelopeResult } from './envelope.js';
/**
 * Issue #52 / H1：信封解析与方言路由公共接缝。
 * 形状校验（ENV-1/2/3）→ 方言断言（ENV-4，未知方言只读 loud-fail，先于文本解析）
 * → parseVfsl(text) 透传（VFSL-E* 原样，含行列）。同步、纯函数、不抛错。
 */
export function parseSchemaEnvelope(input: unknown): ParseSchemaEnvelopeResult {
  try {
    const shape = validateEnvelopeShape(input);           // §3：ENV-1 / ENV-2+3
    if (!shape.ok) {
      return { ok: false, issues: shape.issues };
    }
    const dialect = dialectIssueOrNull(shape.envelope);   // §4：ENV-4
    if (dialect !== null) {
      return { ok: false, issues: [dialect] };
    }
    const parsed = parseVfsl(shape.envelope.text);        // §5：透传（VFSL-E*）
    return parsed.ok
      ? { ok: true, envelope: shape.envelope, module: parsed.module }
      : { ok: false, issues: parsed.issues };
  } catch (err) {
    // 崩溃边界（对齐 parseVfsl E100 最终防线，index.ts:82-94 同款）：getter/Proxy 对抗
    // 输入等意外异常 → 结构化 ENV-100，绝不外抛。命中 = 实现缺陷/对抗输入，非通过。
    return { ok: false, issues: [envelopeCrashIssue(err)] };
  }
}
```

**顺序即语义**（AC3 顺序锚的机制根源）：

1. **形状先于方言**：键缺失/类型错时连「自述什么方言」都读不出——`{lang:'other'}` 缺 text
   报 ENV-2（缺键）而非 ENV-4；
2. **方言先于文本**：未知方言 → ENV-4 单条返回，**parseVfsl 根本不被调用**——「只读
   loud-fail、不解释文本」不是注释承诺而是控制流事实（同一 BAD_TEXT + `{lang:'other'}` →
   方言错误；+ `{lang:'vfsl'}` → 文本错误，两 issues 必然不等，AC3 第二用例）；副作用收益：
   未知方言的恶意超长 text 零 tokenize 成本；
3. **透传零损**：`parsed.module`/`parsed.issues` **引用直通**（不深拷贝、不重包装）——
   `toEqual(parseVfsl(text).module)` 与「与 parseVfsl 完全一致」（AC4）由同源性结构性保证；
   parseVfsl 每次调用产新对象，纯函数两次调用一致（AC1）不受影响。

---

## §6. 错误模型（码空间、坐标哨兵、双通道判别）

### 6.1 信封层码空间 `VFSL-ENV-E<码>`

| 码 | 触发 | 消息模板（正文措辞供 SA3 直用；冻结项见注） | 条数 |
|---|---|---|---|
| ENV-1 | 非对象（含数组） | `信封必须是对象（{ lang, version, id, text } 四键），实际收到 …` | 恰 1 |
| ENV-2 | 必需键缺失 | `信封缺少必需键: lang、text（信封四键契约: lang, version, id, text）` | 恰 1（列全） |
| ENV-3 | 键类型错误 | `信封键类型错误: version 应为 number，实际 string`（多键以「；」连接） | 恰 1（列全） |
| ENV-4 | 未知方言 | `未知方言（只读 loud-fail，不解释 text）: 方言不符: …（assertVfslDialect 原消息，动态 lang 经 sanitizer 单行化）` | 恰 1 |
| ENV-100 | 崩溃边界 | `内部错误（意外异常）: ${detail}`（detail = err.message/String(err)，经 sanitizer 单行化） | 恰 1 |

- **前缀机械可区分**（AC6 锚）：`VFSL-ENV-E4:` 中 `VFSL-E` 之后随 `N` 非 digit，
  `/^VFSL-E\d+:/` 恒不匹配；AC3 的多行 join + `/m` 检查同理——**R2 #1 升格：「每条
  message 单行」不再是措辞性描述，而是结构性保证**：全部五码 issue 经唯一构造点
  `makeEnvelopeIssue` 产出，其内置 sanitizer（§2.1）把正文四种 Unicode 行终止符
  （`\n` `\r` `\u2028` `\u2029`——`/m` 正则 `^` 的分行边界全集）一律替换为可见转义，
  message 含行终止符在构造上不可达。对抗输入（ENV-4 内嵌 hostile lang、ENV-100 内嵌
  多行 err.message）因此**无法伪造行首 `VFSL-E<码>:` 的文本通道行**——通道判别式
  （§6.3）对对抗数据同样成立（向量实证与转义效果见 §10 R2 证据行）。
- **ENV-100 对齐 E100 兜底口径**：方言层 `100` 是「越界语法 catch-all」（v1-spec §4）兼
  「内部错误」兜底（index.ts:82-94、evaluate.ts:76 同款措辞「内部错误（意外异常）」）——
  信封层沿「100 = 兜底」惯例，两码空间内各守其位。备选「顺序编号 ENV-5」被否：跨通道
  语义对齐（100 = catch-all/崩溃边界）比编号紧凑更有诊断价值。
- **ENV 码不进 errors.ts 注册表**：errors.ts 是方言层 21 码冻结资产（v1-spec §4 总表），
  信封码入注册表 = 通道混叠；envelope.ts 自持 `EnvelopeErrCode`（§2.1），归属即文档。
- **冻结项 vs 措辞自由**（沿 errors.ts 惯例「前缀是冻结项，消息正文措辞不冻结」）：
  冻结 = 前缀格式、**message 单行（sanitize 规则入冻结项，R2 #1——§2.1 的行终止符→可见
  转义映射表逐字冻结）**、ENV-4 含「方言/dialect」字样（AC3 锚）、全部 ENV 消息不匹配
  `/^VFSL-E\d+:/`（AC6 锚）；正文措辞 SA3 可微调（模板即建议稿）——但**微调后的正文仍经
  sanitizer 净化**（构造点强制，绕不过）。

### 6.2 坐标哨兵 `line: 0, column: 0`

信封层 issue 恒 `line: 0, column: 0`。依据：

- 信封错误**不在 text 坐标系内**——错误对象是信封结构/方言自述，不是文本位置。若借 1/1
  （parseVfsl E100 崩溃边界的写法），消费者会误读为「文本 1:1 处有错」——文本可能完全合法；
- 0 值在文本坐标系**不可达**：v1-spec 行列 1-based（tokenizer/parser 全部 1-based 产出），
  `line ≥ 1 ⟺ 文本坐标` 恒成立 → `line === 0 && column === 0 ⟺ 信封层 issue` 可作机器判别式；
- 与 6.1 前缀构成**双正交判别器**（一个看 message 头、一个看坐标）——消费方任取其一即可
  分流，两个都在场互为冗余审计点（AC6「独立前缀或明确区分机制」的双保险落法）。

SA6 红灯仅锚 `typeof line/column === 'number'`（形状门）；哨兵值是设计层冻结，SA3 照此实现。

### 6.3 通道判别总表（消费方视角）

| 判别器 | 信封层 | 方言层（parseVfsl 透传） |
|---|---|---|
| message 前缀 | `VFSL-ENV-E<码>:` | `VFSL-E<码>:` |
| line | 恒 0 | 恒 ≥ 1 |
| column | 恒 0 | 恒 ≥ 1 |
| 语义 | 数据不是它自称的 schema / 方言不认识（换数据或升级引擎） | 文本非法（改文本） |
| 运维动作 | 只读 loud-fail，不解释文本 | 按码修文本 |

### 6.4 ok:false 分支的混合通道说明

`ParseSchemaEnvelopeResult` 的 ok:false 是**混合通道联合**：信封拒绝（ENV-\*）与文本错误
（VFSL-E\*，透传）共用 `issues: VfslIssue[]` 字段——**单次调用永不同时含两通道**（编排顺序
短路保证：形状败不方言、方言败不解析），通道判别按 §6.3 逐条进行。这是「单一 issue 类型 +
前缀判别」联合（本设计）相对「判别联合 `{kind:'envelope'|'text', …}`」（被否）的取舍：
后者类型面更花但会把 `issues` 的形状分叉成两制，SA6 已锚死 VfslIssue 同构形状 + parseVfsl
issues 原样全等（AC4 `toEqual(parseVfslIssues(BAD_TEXT))`——分叉类型无法引用直通），且
ok:false 消费方（H3 DocScope / Phase 2 server）真实诉求只是「能不能分流」——前缀 + 哨兵
两个现成判别器足够。被否方案零收益高成本，记录在案。

### 6.5 为什么信封层不全收集到底 / 不单错误

v1-spec §4「v1 冻结单错误——issues 恰含 1 条」是**方言层**冻结（文本解释的恢复策略），
不辖信封层。信封层的裁定：**形状阶段同类聚合（ENV-2 一条列全缺键、ENV-3 一条列全类型错，
至多 2 条），方言阶段恰 1 条，非对象早出 1 条**。理由：(a) 诊断最优——一次报全缺键，调用方
补齐即过，不用逐键试错；(b) 先例已在——schemasource.ts missing-directive 消息「头部缺少
指令: @lang、@id、@version」同款聚合；(c) 方言是单一判定点（自述身份只有一个），无聚合对象；
(d) 不与 parseVfsl 冻结冲突（不同层，且透传阶段 issues 原样保持恰 1 条——方言层自身纪律
未被本接缝破坏）。

---

## §7. 边界条件与对抗输入（总表）

| 场景 | 行为 | 依据/锚点 |
|---|---|---|
| `undefined`/`null`/`42`/`'string'`/`true`/`() => 0` | ENV-1 单条（typeof 名入消息） | AC1#2 |
| `[]`/`[1,2]` | ENV-1 单条（数组 + 长度入消息） | AC1#2 |
| `{}` | ENV-2 单条（四键列全） | AC1#2 / AC2#1 |
| 各单键缺失 / 组合缺失 | ENV-2（列全所缺键） | AC2#1 |
| `version:'1'` / `text:42` / `lang:1` / `id:42` | ENV-3（typeof 实际值入消息） | AC2#2 |
| `new String('vfsl')` / `new Number(1)`（包装对象） | ENV-3（typeof object） | §3.2 纯数据裁定 |
| `version: NaN/1.5/-1/Infinity` | 形状过（number）→ ENV-4（`!== 1`，方言域） | §3.2 分界线 |
| `lang: ''`（空串） | 形状过 → ENV-4（`'' !== 'vfsl'`） | §3.2 |
| `id: ''` / 路径分隔符 / 中文 / emoji / 撞名 | 零校验零记忆，各自独立解析 | AC5（ADR-0005 id 仅标签） |
| `text: ''`（空文本） | 信封层放行 → parseVfsl 报 E310（缺 ROOT）透传 | §3.2（文本域归方言层） |
| 多余键（extra/flag/任意未知键，含 symbol 键） | 忽略，不进回显 | AC2#3（向前兼容加法） |
| `Object.create(null)` + 四自有键 | 接受（合法数据形态） | §3.3 |
| `Object.create({四键原型})`（误传原型） | ENV-2（own-key 不命中）——不静默按半份数据解释 | §3.3 |
| getter/Proxy 抛异常的对抗对象 | 顶层 catch → ENV-100（不外抛；命中 = 对抗输入/缺陷） | §5 崩溃边界 |
| **R2 #1**：hostile `lang` 内嵌行终止符 + 伪造 `VFSL-E<码>:` 行（如 `"x\nVFSL-E999: …"`） | ENV-4 照常拒绝（方言不符）；message 经 sanitizer 单行化——伪造行变成字面 `x\nVFSL-E999:` 可见转义，`/^VFSL-E\d+:/m` 不再检出（向量实证 + 转义效果实测见 §10 R2 行） | §2.1/§4/§6.1 |
| **R2 #1**：ENV-100 的 `err.message` 含多行（栈式消息、对抗 getter 抛的多行 Error） | 同上——唯一构造点后置净化对 ENV-100 同样生效，message 恒单行 | §2.1/§6.1 |
| 纯函数 | 无模块级可变态、无 Date/random/网络；同输入两次调用结构全等；不修改输入对象 | AC1#1 |
| 并发/重入 | 无共享状态，天然线程安全（单线程 JS 下即重入安全） | §1.2 |
| 资源 | 未知方言零 tokenize（§5 顺序收益）；合法超长 text 的深度/预算防护是 parseVfsl 既有三层（index.ts:6-9），本接缝不新增预算点 | v1-spec §9/既有 |

---

## §8. 测试通过策略（SA3）

### 8.1 SA6 十二用例逐条机制映射

| # | describe / it | 走的路径 | 转绿手段 |
|---|---|---|---|
| 1 | AC1#1 合法信封 → `{ok:true,envelope,module}` 同步/不抛/纯 | 形状过 → 方言过 → parseVfsl ok → 引用直通 | §3/§4/§5 实现 |
| 2 | AC1#2 九种对抗输入 → 结构化拒绝 | ENV-1 ×8；`{}` → ENV-2 | §3.1/§3.2 |
| 3 | AC2#1 缺键五例 → 拒绝 | ENV-2（空对象四键列全 / 单键缺失列该键） | §3.2 |
| 4 | AC2#2 类型错四例 → 拒绝 | ENV-3（version:'1' / text:42 / lang:1 / id:42） | §3.2 |
| 5 | AC2#3 多键 → ok:true 四键原值 | 未知键忽略 + §3.4 恰四键回显 | §3.4 |
| 6 | AC3#1 `{vfsl,2}`/`{other,1}` → `/方言\|dialect/i` | ENV-4 模板自带「未知方言」+ 内嵌原消息 | §4 |
| 7 | AC3#2 顺序锚（未知方言先于文本；两通道不等） | 编排短路：ENV-4 单条 vs VFSL-E 透传，必不等 | §5 顺序 |
| 8 | AC4#1 ok 透传 module 全等 | `parsed.module` 引用直通 | §5 |
| 9 | AC4#2 issues 全等 + `line:3,column:7` + `^VFSL-E\d+:` | `parsed.issues` 引用直通；锚点本会话 tsx 实测复证（§10 第 3 行） | §5 |
| 10 | AC5#1 id 空串/特殊字符 → ok 不受影响 | id 零格式校验 | §3.2 |
| 11 | AC5#2 同 id 不同 text 各自解析、两 module 不等 | 无状态无注册表，逐次独立 | §1.2/§7 |
| 12 | AC6 五种拒绝不落 VFSL-E 码空间 + 透传保留前缀 | 前缀 `VFSL-ENV-E`（E 后随 N）；透传通道原样 | §6.1 |

### 8.2 存量零回归论证

对 src 是**纯增量**：新模块 `envelope.ts` + `index.ts` 追加 1 值导出 + 1 类型导出 + 1 函数；
tokenizer/parser/semantic/ir/derived/evaluate/validate/resolve/shapes/pattern/xml/errors/
schemasource 十三内部件一行不动；package.json 仅版本号；vitest.config.ts / tsconfig 零改动。
存量测试（vitest include `packages/*/test/**` + `domains/*/test/**`；**R2 #2 实测口径**：
runtime `.test.ts` = **26** 文件——packages 25 + domains 1（`domains/vfs3-assets/test/
vfs3-assets-tsdoc.test.ts`，R1 误漏 domains 维度），含本票 1 个；vitest 汇总 **Test Files 31
= 26 runtime + 5 个 `.test-d.ts` 类型测试文件**（vfsl-protocol 2 / vfsl-codegen 1 /
domains 2）；**用例数 464 为 runtime 用例计数，正确不变**）的被测对象
（parseVfsl/evaluate/validateSnapshot/FileSchemaSource 及类型）公共面与行为零变化
→ 全量预期：**vitest 汇总 Test Files 31 全绿、Tests 464 全绿**（基线 = 452 绿 + 本票 12 红，
本会话实测见 §10）。**SA4 对照口径（字面）**：`Test Files 31`、`Tests 464`——文件数按
vitest 汇总含类型测试，勿与 runtime 26 混用。

### 8.3 typecheck 清零路径

本会话亲跑 `pnpm typecheck` 现状恰 1 错：`parse-schema-envelope.test.ts(31,10): TS2724
'"../src/index.js"' has no exported member named 'parseSchemaEnvelope'`——SA3 落地 §2.2
导出即自愈，测试文件其余部分类型干净（与 SA6 红灯附注一致，本会话复核）。无 SA6 文件协调项。

### 8.4 SA3 验证命令（实跑留证）

```bash
pnpm typecheck                                                      # 0 错（TS2724 自愈）
pnpm exec vitest run packages/vfsl/test/parse-schema-envelope.test.ts   # 12 passed
pnpm test                                                           # Test Files 31 全绿（26 runtime + 5 .test-d），Tests 464 全绿，零回归
```

零 CI 改动：新测试文件落 vitest include（`packages/*/test/**/*.test.ts`）自动入列，无 F1 式
显式步骤诉求（本票 AC 无 CI 可见性条款）。

---

## §9. 风险与权衡

| # | 风险/权衡 | 处置 |
|---|---|---|
| 1 | envelope.ts 运行时依赖 schemasource.js（node:fs 传递） | 非回归（index 本就导出 FileSchemaSource）；浏览器子入口属未来 exports 拆分票，§2.1 记录 |
| 2 | try/catch 转译 assertVfslDialect（异常当控制流） | 语义单点优先于控制流洁癖；转译守卫收窄到 dialect-mismatch，其余异常落 ENV-100 崩溃边界（§4） |
| 3 | 坐标哨兵 0/0 依赖「文本层 line ≥ 1」不变式 | v1-spec 行列 1-based 冻结 + tokenizer/parser 产出亲证；若未来方言层引入 0 行（无计划），哨兵判别式需同步复审——记入 §6.2 |
| 4 | 形状全收集 vs 方言层单错误纪律的表面不一致 | §6.5 论证分层归属 + 透传阶段保持原样恰 1 条；如 SA2 仍持异议可改单条聚合（ENV-2/3 合一），对 AC 无影响——预留修订空间 |
| 5 | 消息正文中文措辞与国际消费方 | 沿仓内全量先例（errors.ts/schemasource.ts 全中文消息）；错误码前缀（机器判别面）与正文（人类可读面）分离，正文可读性不阻机器分流 |
| 6 | 未来 v2 方言（`version: 2`）引入时的路由演进 | ENV-4 判定单点在 assertVfslDialect——升级该函数（或引入路由表）即全链生效，本接缝零改动；正是 §4 复用决策的回报 |
| 7 | `Object.hasOwn` 需要 ES2022 运行时 | tsconfig target/lib ES2022 冻结；node ≥ 20 引擎下限覆盖（root package.json engines） |
| 8 | **R2 #1**：sanitizer 只转义四种行终止符，其他控制字符（`\t`、`\u000B` 等）原样透传——是否漏防 | 转义集与分行边界集**严格相等**：ECMAScript LineTerminator 定义恰为 LF/CR/LS(U+2028)/PS(U+2029) 四种，`/m` 正则 `^` 只在这四处分行；`\t`/`\u000B` 不产生新行、不参与 `^` 匹配，透传不影响任何行首判别式。不多转（保可读性）不少转（保证单行）——设计期四类用例实测见 §10 |

---

## §10. 协议假设依据 (Protocol Assumption Evidence)

**无网络协议/端口/进程生命周期类假设**：本设计是纯函数 + 模块内编排，零 I/O、零新依赖、
零 CI 拓扑变化。以下为设计期实测证据（本会话 2026-08-21 实跑，输出全文贴入，沿 R2 #7 证据
留存纪律不依赖 /tmp 易失路径）：

| 假设 | 依据类型 | 依据内容 | 风险等级 |
|---|---|---|---|
| 红灯基线 = 12 用例全红、失败模式唯一为缺导出 | 设计期实测 | 本会话亲跑 `pnpm exec vitest run packages/vfsl/test/parse-schema-envelope.test.ts`：`Test Files 1 failed (1) / Tests 12 failed (12) / Type Errors no errors`；失败逐条 `(0, parseSchemaEnvelope) is not a function`（构造性红灯）——与 SA6 红灯运行证据一致 | 低 |
| `pnpm typecheck` 现状恰 1 错且随导出自愈 | 设计期实测 | 本会话亲跑：`parse-schema-envelope.test.ts(31,10): error TS2724 '"../src/index.js"' has no exported member named 'parseSchemaEnvelope'. Did you mean 'SchemaEnvelope'?`，exit 2——SA6 附注复核成立，§8.3 清零路径成立 | 低 |
| BAD_TEXT 透传锚点 = `VFSL-E100` @ line 3, column 7（AC4/AC6 对照通道的行列与前缀前提） | 设计期实测 | 本会话以仓内 tsx 直跑 src：`parseVfsl('type ROOT = {\n  a: string,\n  b?: ;\n};')` → `ok:false`，issues = `[{"message":"VFSL-E100: 类型位置意外记号: 标点 ';'","line":3,"column":7}]`——与测试断言 `toMatchObject({line:3, column:7})` + `toMatch(/^VFSL-E\d+:/)` 逐字一致 | 低 |
| 测试全部 fixture 文本按预期可解析（VALID/VALID2/AC4 文本 ok；撞名两 module 不等） | 设计期实测 | 同上 tsx 会话：`VALID ok: true`、`VALID2 ok: true`、AC4 双别名文本 `ok: true` 且 module 含 T/ROOT 两别名；两文本 module 结构互异——AC5#2 `not.toEqual` 前提成立 | 低 |
| 方言断言语义与消息形态（ENV-4 转译源） | 源码引用 | `packages/vfsl/src/schemasource.ts:93-103`：`input.lang !== 'vfsl' \|\| input.version !== 1` → 抛 `SchemaSourceError('dialect-mismatch')`，消息 `方言不符: 期望 lang='vfsl'、version=1，实际 lang='…'、version=…`（含实际自述值）；`SchemaEnvelope` 可赋值 `DialectAssertionInput`（schemasource.ts:80-85 注释） | 低 |
| E100 = 「100 系兜底」口径（ENV-100 对齐依据） | 源码引用 + 规格引用 | `docs/vfsl/v1-spec.md:272`「语法 E100~E106（E100 为越界语法 catch-all）」；`index.ts:82-94` 未预期异常 → `VFSL-E100: 内部错误（意外异常）`；`evaluate.ts:76` 同款 | 低 |
| 全量存量基线（零回归论证的分母） | 设计期实测 | 本会话后台全量 `pnpm exec vitest run`：`Tests 12 failed \| 452 passed (464)`、`Duration 27.96s`（12 红 = 本票文件；452 绿 = 全部存量）；**R2 #2 实测口径**：runtime `.test.ts` 26（packages 25 + domains 1，含本票；`find packages domains -name '*.test.ts' -not -name '*.test-d.ts' \| wc -l` 逐维复核），vitest 汇总 **Test Files 31 = 26 + 5 个 `.test-d.ts`**（`find … -name '*.test-d.ts'`：vfsl-protocol 2 / vfsl-codegen 1 / domains 2）；R1「25 文件」系 find 漏扫 domains 维度的口径错误，已全文改正 | 低 |
| **R2 #1**：ENV-4 通道伪造向量成立（转义必要性） | 设计期实测（R2，输出全文贴下） | 本会话 tsx 直跑 src：`assertVfslDialect({lang:"x\nVFSL-E999: 伪造文本错误", version:1, id:'evil'})` 抛出的原消息含 `\n`；组合 `VFSL-ENV-E4: 未知方言: <原消息>` 后 `/^VFSL-E\d+:/m.test(...)` === **true**（第二行行首伪造出文本通道码）；同串经 §2.1 sanitizer（四行终止符→可见转义）后 `includes('\n')` === false、`/m` 检出 === **false**，消息仍可读（输出见下块） | 低 |

**全量基线 + R2 #1 伪造向量实测（本会话输出全文，SA3/SA4 对照口径）**：

```
# 全量 vitest（R1 后台作业，Tests 行；R2 补跑 Test Files 汇总行见下）
Tests  12 failed | 452 passed (464)
Type Errors  no errors
   Errors  1 error          ← 缺导出导入失败的登记项，随导出落地消失
Duration  27.96s

# R2 #2 文件数实测（find 双维复核 + vitest 汇总行）
$ find packages domains -name '*.test.ts'  -not -name '*.test-d.ts' -not -path '*/node_modules/*' | wc -l   → 25+1 = 26
$ find packages domains -name '*.test-d.ts' -not -path '*/node_modules/*' | wc -l                            → 5
$ pnpm exec vitest run   →  Test Files  1 failed | 30 passed (31)   ← 31 = 26 runtime + 5 .test-d
                            Tests       12 failed | 452 passed (464)

# R2 #1 通道伪造向量（tsx 直跑 src；sanitize 前后对照）
$ tsx /tmp/env-forge-check.ts
原始消息是否含换行: true
/m 正则下是否伪造出 ^VFSL-E\d+: 行: true
--- 原始消息 ---
方言不符: 期望 lang='vfsl'、version=1，实际 lang='x
VFSL-E999: 伪造文本错误'、version=1
--- 转义后 ---
含换行: false | /m 伪造检出: false
VFSL-ENV-E4: 未知方言: 方言不符: 期望 lang='vfsl'、version=1，实际 lang='x\nVFSL-E999: 伪造文本错误'、version=1

# R2 #1 定稿 sanitizer（§2.1 逐字符类版）四类用例复验——含 CRLF 忠实转义
$ tsx /tmp/env-sanitize-final.ts
{"singleLine":true,"forge":false,"out":"方言不符: lang='x\\nVFSL-E999: 伪造'"}
{"singleLine":true,"forge":false,"out":"cr:\\r lf:\\n ls:\\u2028 ps:\\u2029 end"}
{"singleLine":true,"forge":false,"out":"crlf:\\r\\nVFSL-E100: 伪造"}
{"singleLine":true,"forge":false,"out":"正常消息无终止符——含中文与 emoji 🎉"}
```

SA3 验收对照：存量 452 绿一个不减；本票 12 红转 12 绿 → **vitest 汇总 Test Files 31 全绿、
Tests 464 全绿**（SA4 字面对照口径；R1 的「25 文件」口径已废）。

---

## §11. 契约改动连锁审计 (Contract Change Caller Audit)

**无契约改动**：本设计仅涉及**新增**（新模块 envelope.ts、index.ts 新增导出与函数、版本号、
新测试已由 SA6 落地）。`parseVfsl`/`evaluate`/`validateSnapshot`/`FileSchemaSource`/
`assertVfslDialect` 及全部既有类型导出**逐字不动**；无任何既有函数的签名/返回/throw 行为
变化；无 caller 需要迁移。既有 caller 面貌（本会话 grep 实测，供 SA4 抽查）：
`parseVfsl` caller = **23 个存量测试文件**（packages/vfsl 17 + vfsl-codegen 5 + domains 1）+
**1 个生产 caller** `packages/vfsl-codegen/src/collect.ts:64`；`assertVfslDialect` caller =
`FileSchemaSource.validateHeader`（schemasource.ts:392，层 1）+ 生产 caller
`vfsl-codegen/src/collect.ts:44`（层 2「消费方首动作」注释与 ADR 0005 §1 逐字对齐）+
两个测试锚点（domains-scaffold.test.ts:58-61 / vfs3-assets-tsdoc.test.ts:81）。本设计是
**新增第三生产共方**（envelope.ts，引擎侧），对既有 caller 零影响（只读复用，函数本身零改动）。
新导出 `parseSchemaEnvelope` 的 caller 现仅 SA6 测试文件。

**顺带架构观察（非本票范围，记录在案）**：collect.ts:44-64 今天手工组装的恰是本接缝产品化的
同一流程（方言断言 → parseVfsl）——`parseSchemaEnvelope` 落地后，codegen 消费方未来可把手工
两步换成一个接缝调用（属独立演进票；本票 DENY LIST 不动 collect.ts，见 §12）。

---

## §12. 文件清单（File Scope）

### ALLOW LIST

- `packages/vfsl/src/envelope.ts` — 新建，§2.1/§3/§4/§6 全部实现（码注册表 + issue 构造 + 形状校验 + 方言路由转译 + 崩溃边界构造 + 结果类型，~120 行）
- `packages/vfsl/src/index.ts` — 修改，§2.2/§5：追加 `parseSchemaEnvelope` 函数本体（~30 行）+ 1 个类型 re-export + 头注释公共面清单补一行；既有导出零变动
- `packages/vfsl/package.json` — 修改，版本 0.1.8 → 0.1.9（新增公共面 patch，沿 F1 先例）；依赖零变化
- `packages/vfsl/test/parse-schema-envelope.test.ts` — `[SA6 owned]` 验收红灯测试。SA3 **零改动**（TS2724 随导出落地自愈，§8.3；如需动仅限测试基础设施且须总控知会，断言逻辑禁改）
- `wiki/raw/task_vfsl-schema-envelope_design.md` — 本设计文档（随分支 commit）
- `wiki/raw/task_vfsl-schema-envelope.md` — 任务简报（含 SA6 红灯证据，随分支 commit——F1 R2 #10 纪律）
- `wiki/raw/task_vfsl-schema-envelope_dispatch.md` — 本票调度日志（同上纪律）
- `wiki/raw/task_vfsl-schema-envelope_conflict_report.md` — SA8 冲突门禁报告（同上纪律）
- `wiki/raw/task_vfsl-schema-envelope_relevant_decisions.md` — SA8 相关决议摘录（同上纪律）

### DENY LIST

- `packages/vfsl/src/schemasource.ts` — 方言断言/信封类型/错误类**只读复用零改动**（§4 语义单点决策的直接推论；改动即分叉风险）
- `packages/vfsl/src/{tokenizer,parser,semantic,ir,derived,evaluate,validate,resolve,shapes,pattern,xml,errors}.ts` — 引擎十二内部件零改动（AC4 透传与存量全绿的行为根基；errors.ts 21 码冻结注册表不混入 ENV 码）
- `packages/vfsl/tsconfig.json`、`tsconfig.base.json`、`tsconfig.typecheck.json`、`vitest.config.ts` — 编译开关与测试拓扑不动
- `pnpm-lock.yaml`、`pnpm-workspace.yaml` — 零新依赖零 workspace 变化
- `.github/workflows/**` — 无 CI 步骤诉求（§8.4）
- `docs/adr/*`、`docs/vfsl/v1-spec.md`、`docs/phases/*` — 冻结契约文档
- `CONTEXT.md` — 术语（信封/方言/命名空间）均已存在，无新术语；公共接缝登记若需补录属收尾票，非本票 ALLOW
- `tests/acceptance/**` — Python 验收脚本与 fixture 不动
- `TASK.md`、`.mabf-bg/`、`.scratch*`、`/tmp/**` — 调度器/草稿产物，不进分支 commit

---

## SA2 反馈逐条回应（R2）

评审输入：SA2 R1 攻击评审（verdict: reject，两项 MINOR，架构主体通过）。修订不是建议，
逐条落实如下；每条均先实测核实再改设计（证据入 §10）。

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| MINOR #1：makeEnvelopeIssue 增加动态值转义冻结项（JSON.stringify 或换行替换）；ENV-4 内嵌 `input.lang`、ENV-100 内嵌 `err.message` 均须转义；§6.1「每条 message 单行」措辞升格为结构性保证 | ✅ | §2.1（sanitizer 实现）/ §4（后置转义论证）/ §6.1（升格 + 冻结项扩容 + 表行标注）/ §7（边界表 +2 行）/ §9（风险行 8：转义集完备性）/ §0 行 5 / §10（向量实证行 + 输出块 ×2） | `makeEnvelopeIssue` 定为**唯一构造点**并内置 `sanitizeEnvelopeMessage`：四种 Unicode 行终止符（`\n` `\r` `\u2028` `\u2029`——ECMAScript LineTerminator 全集 = `/m` 正则 `^` 分行边界全集）→ 可见转义 `\\n` `\\r` `\\u2028` `\\u2029`（SA2 给的两选项中取「换行替换」制式，映射表逐字冻结；JSON.stringify 制式被否：对组合句引号噪声大且对 ENV-4 不可行——插值点在冻结资产 assertVfslDialect 内部，只能后置净化，见 §4 新增 bullet）。实现定稿为**逐字符类映射**（`/[\n\r\u2028\u2029]/g` + 查表）而非交替分支——交替版在 CRLF 整体匹配下会误落 `\u2029` 分支，逐字符版 `\r\n` 忠实转义为 `\\r\\n`（缺陷于 R2 自检中发现并修正，四类用例实测含 CRLF 见 §10 输出块 2）。选**后置组合整串净化**而非逐值 JSON.stringify：单点覆盖 ENV-4/ENV-100 及未来任何新增动态值。§6.1「每条 message 单行、无内嵌换行」→「结构性保证：message 含行终止符在构造上不可达，对抗输入无法伪造行首 `VFSL-E<码>:` 文本通道行」，sanitize 规则列入冻结项；正文措辞自由保留但「微调后仍经 sanitizer（构造点强制，绕不过）」。必要性实证：tsx 复现 hostile lang 伪造向量（`/m` 检出 true）与转义后消除（false），输出全文贴 §10 |
| MINOR #2：§8.2/§8.4/§10 测试文件数改实测口径（runtime `.test.ts` = 26 含本票；vitest 汇总 31 = 26 + 5 个 `.test-d.ts`；用例数 464 正确），确保 SA4 按字面对照不 mismatch | ✅ | §8.2 / §8.4 / §10（基线表行 + 输出块）/ 文档头 R2 注 | 全部「25 文件」口径改正：R1 的 find 漏扫 `domains/*/test/**` 维度（vitest include 双模式而 find 只扫了 packages）。实测口径冻结：runtime `.test.ts` = **26**（packages 25 + domains 1，含本票）；vitest 汇总 **Test Files 31 = 26 + 5 个 `.test-d.ts`**（vfsl-protocol 2 / vfsl-codegen 1 / domains 2）；Tests **464**（runtime 用例计数，不变）。§8.4 验证命令注释、§10 基线行与输出块、SA3 验收对照行统一改为「Test Files 31 全绿 / Tests 464 全绿」并加 SA4 字面对照提示（文件数按 vitest 汇总含类型测试，勿与 runtime 26 混用）；find 双维命令 + vitest 汇总行补跑输出贴 §10 |

**R2 一致性自检**：单行保证相关表述全文一致（§0 行 5 / §2.1 构造点注释 / §4 后置论证 /
§6.1 升格与冻结项 / §6.3 判别总表前提 / §7 边界行均指向同一 sanitizer 机制，无「措辞性单行」
残留——grep `单行` 复核）；文件数口径全文统一为 26/31/464 三值制（grep `25 文件\|25 个` 仅余
§10 基线行的「口径错误已改正」历史注记，属有意保留的勘误说明）。**SA6 契约影响：零**
（sanitizer 不触碰 12 用例任何断言路径——SA6 用例值均无行终止符，转义仅在对抗输入下改变
message 形态；§8.1 映射表逐行不变）。
