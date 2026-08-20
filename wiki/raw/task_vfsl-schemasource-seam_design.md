# SA1 设计 — 功能开发：SchemaSource 接缝与脚手架文件格式（Issue #25 / F1）

> R1（2026-08-20）。任务类型 feature（ADR 0005 票拆分 F1：接缝 + FileSchemaSource + 方言断言 + 脚手架校验 CI）。
> 输入：任务简报 `task_vfsl-schemasource-seam.md`（含 SA6 红灯测试记录与 R2 真红灯证据）、
> SA6 红灯 `packages/vfsl/test/schemasource-seam.test.ts`（13 用例，12 红 1 绿——本会话亲跑复核）、
> ADR 0001 修订节 / 0005 §1/§2/§5 / 0004 D3、`CONTEXT.md`、`docs/vfsl/v1-spec.md` §5/§7。
> 本设计不写代码；SA3 按本文件实现。设计期验证均实跑留证（见 §0 与 §10）。
>
> **R2（2026-08-20）**：按 SA2 攻击评审（reject，`task_vfsl-schemasource-seam_sa2_review.md`）修订。
> 主路径结构决策零推翻，规格缺口语义写死。攻击点 → 章节：**#1** ENOTDIR 虚假降级 → §4.5；
> **#2** 二级回退多文件错分类 → §4.2；**#3** CI 删除盲区 → §6.1；**#4** 重复 id 数据结构 → §4.2；
> （同轮吸收）**#5** base 单段校验 → §4.2、**#6** 顶层散放处置 → §4.1/§4.4；**#8** 隐藏目录 → §4.1、
> **#9** 重复 @id 键落点 → §4.5、**#10** ALLOW LIST → §12、**#11** 文字 → §0/§6.1/§8.3、
> **#7** 证据留存纪律 → §10（本 R2 新实测输出已贴入文档）。逐条回应表见文末；
> SA6 13 用例落点逐一复核**全部不变**（§8.1 R2 自检）。

## §0. 结论速览

| # | 裁定 | 章节 |
|---|---|---|
| 1 | **对 SA6 测试契约无实质异议**：包布局（`packages/vfsl`，经 `src/index.ts` 公共面导出）与构造入参 `new FileSchemaSource(root)`（root 含 `domains/`）均确认；但发现 SA6 测试文件 **2 处类型层缺陷会挡 `pnpm typecheck`**，需按 §8.3 协调修复（类型层修复，断言零改动） | §1.3 / §8.3 |
| 2 | 新增**单模块** `packages/vfsl/src/schemasource.ts`：`SchemaSource` 接口 + `SchemaEnvelope` 类型 + `SchemaSourceError` + `FileSchemaSource` + `assertVfslDialect`；`index.ts` 追加 **3 个值导出 + 4 个类型导出（共 7 项——R2 #11a 修正计数，原误记 5 项）**，既有导出零变动 | §2 |
| 3 | 头部指令解析：**前导 trivia 区扫描**（空行/行注释/完整块注释组成的极大前缀，遇首行代码即停）；三键大小写敏感、空值=缺失、重复键=响亮拒绝、未知键容忍忽略、块注释内伪指令不计 | §3 |
| 4 | id→文件寻址为**两级**：一级 = 头部 `@id` 精确入册（id 的权威来源，文件自述）；二级 = `@<digits>` 后缀剥离后按目录名**诊断回退**——这是「缺 `@id` 报 missing-directive 而非 unknown-id」的机制（`broken.id@1` 用例的隐含约束）。每次 `load`/`list` 现扫描，无缓存（**R2 #2/#4/#5**：回退决策树、扫描数据结构、base 单段校验均已写死，见 §4.2） | §4 |
| 5 | `list()` **绝不静默跳过损坏文件**：任一领域文件头部损坏/方言不符 → reject（AC5 可见性的运行时根基） | §4.4 |
| 6 | 方言断言 = **双层防御**：`assertVfslDialect` 独立导出（消费方首动作，ADR 0005 §1）+ `FileSchemaSource` 信封组装点内建同款断言（盘上错误文件当场爆炸） | §5 |
| 7 | AC5 落地为**双保险**：新测试 `packages/vfsl/test/domains-scaffold.test.ts`（vitest include 命中 → 普通 `pnpm test` 自动跑；经接缝消费，脚手架纪律的 dogfood）+ ci.yml 显式步骤点名跑该文件（**R2 #3**：步骤带 `--passWithNoTests=false`，防测试文件被删后静默假绿）。**本票不种首个领域 `.vfsl`**；空集 = pass + 显式 notice | §6 |
| 8 | 版本 0.1.7 → 0.1.8；`packages/vfsl` devD 新增 `@types/node@^20`（SA6 测试已 import `node:fs/promises` 而 `pnpm typecheck` 现状即红——本会话亲证 3 条 TS2307） | §7 |
| 9 | 12 红转绿逐 describe 推演 + typecheck 6 错清零路径 + 全量零回归论证；SA1 设计期原型 30/30 实跑验证寻址算法 | §8 / §10 |

---

## §1. 需求推演（Feature：切入点与契约复核）

### 1.1 定位

F1 是 ADR 0005 投影管线的**第一块承重接缝**：一切脚手架消费方（F2 生成器、G dogfood、CI 校验）今后
经 `SchemaSource` 取文本，终态切 `DocSchemaSource` 时零消费方改动（ADR 0001 修订节「脚手架纪律」）。
因此本票的正确性焦点不是「能读到文件」，而是：

1. **接缝按终态设计**（async from day one、完整信封、list 枚举）——不是文件读封装；
2. **响亮拒绝的分类正确**——三种结构化错误各自出现在语义正确的场景（拿错文件 = 当场报错，ADR 0005 §2
   「防错冗余」）；
3. **信封 `text` 与盘上原文逐字节一致**——内容哈希直接（ADR 0005 §2），不得剥头、不得规范化。

### 1.2 与既有架构的一致性

- 信封形状 `{ lang, version, id, text }` 与 v1-spec §7、CONTEXT.md「信封」条目逐字一致；`version` 数值、
  `lang: string`（方言泛型，不窄化到 `'vfsl'`——信封类型是方言中立的载体，方言约束由断言层执行）；
- `@` 前缀指令注释是**文件格式约定**（ADR 0005 §2），不是语义层机器标签——ADR 0001「无机器标签」条款
  不触及，本设计不往语义层/JSDoc 体系里塞任何东西；
- 行注释是词法 trivia（v1-spec §2 注记 9/10）→ 带头部的 `.vfsl` 文件 `parseVfsl` 直接 ok，**零预处理**。
  FileSchemaSource 不做任何文本变换，`text` 即原文（AC4 逐字节一致的自然推论）；
- 头部解析属**接缝/文件格式层**，不是方言层——三键校验失败的结构化错误（`kind: 'schema-source'`）
  与 parser 的 `VfslIssue`（`{message,line,column}`，错误码走 message 前缀）是**两套互不相干的错误通道**：
  前者管「这份数据是不是它自称的 schema」，后者管「这段文本是否合法方言」。不混用、不复用 `ErrCode`
  注册表（`errors.ts` 的 21 个 VFSL-E 码是方言层冻结资产，接缝层不沾）。

### 1.3 SA6 契约复核（结论：无实质异议）

逐条对照 SA6「契约定形说明」六条：

| SA6 定形 | SA1 复核 | 结论 |
|---|---|---|
| 接缝 `load/list` 均 async，信封四键 | 与 ADR 0005 §1 一致 | 确认 |
| 响亮失败走 Promise rejection（非 `{ok:false}` 联合） | `load` 签名是 `Promise<SchemaEnvelope>`，reject 是唯一失败渠道；与 `parseVfsl`「不抛错、错误走返回值」并行不悖——两条接缝各按各自签名定渠道 | 确认 |
| 错误形状 `Error` 子类 + `{kind:'schema-source', code, id?}` | 实现为 `SchemaSourceError extends Error`；额外附 `path?`（文件定位，诊断必需；`toMatchObject` 子集匹配不受影响） | 确认（增可选字段） |
| 构造 `new FileSchemaSource(domainsRoot)`，扫描 `domains/*/` 全部 `.vfsl` | 入参语义定形为「**包含 `domains/` 的根目录**」（fixture：`mkdtemp root` + `root/domains/<d>/schema.vfsl` + `new FileSchemaSource(fx.root)`）——仓内使用即传 repo 根。与 ADR 0005 §5「顶层 `domains/`」一致 | 确认 |
| id/version/lang 解析自头部；`list()` 返回全部已注册 id | 两级寻址设计（§4）满足全部 13 用例（SA1 原型实跑复核，§10） | 确认 |
| fixture hermetic（mkdtemp 内联生成） | FileSchemaSource 不依赖仓内 `domains/` 真实存在；`domains/` 缺失行为已定形（§4.5） | 确认 |

**包布局异议：无。** 信封与方言断言是语言层概念（v1-spec §7 本就定义信封），文件源是方言感知的组装器，
与 `packages/vfsl` 既有职责同域；为单一类另起包属过度打包。SA6 选址理由成立，本设计沿用。

**但有一项工程缺陷必须上报**（非契约异议）：SA6 测试文件存在 2 处类型层缺陷（`:242` 多余 `as unknown`
cast 触发 TS2345；fixture 返回类型谎报触发 `:329` TS2339），**即使 SA3 落地接缝后 `pnpm typecheck`
仍红、CI Typecheck 步骤必挂**。修法与协调路径见 §8.3（类型层最小修复，断言语义零改动）。

---

## §2. 模块设计：布局与公共面

### 2.1 文件布局

新增单模块 `packages/vfsl/src/schemasource.ts`（预估 ~260 行含注释，R2 规则增量），内聚接缝全部概念：

```ts
// packages/vfsl/src/schemasource.ts（伪代码级签名，实现细节 SA3 自由）

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** ADR 0005 §1 冻结的接缝形状。 */
export interface SchemaSource {
  load(id: string): Promise<SchemaEnvelope>;
  list(): Promise<string[]>;
}

/** CONTEXT.md / v1-spec §7 信封形状（方言中立载体；恰四键）。 */
export interface SchemaEnvelope {
  lang: string;
  version: number;
  id: string;
  text: string;
}

export type SchemaSourceErrorCode = 'missing-directive' | 'dialect-mismatch' | 'unknown-id';

/** 接缝层结构化错误（与方言层 VfslIssue 两套通道，见 §1.2）。 */
export class SchemaSourceError extends Error {
  readonly kind = 'schema-source';
  readonly code: SchemaSourceErrorCode;
  readonly id?: string;     // 请求的 id（可知时）
  readonly path?: string;   // 涉事文件绝对/相对路径（诊断定位）
  constructor(code: SchemaSourceErrorCode, message: string, context?: { id?: string; path?: string }) { /* … */ }
}

/** 方言断言输入：信封方言两键 + 可选 id（错误上下文）。SchemaEnvelope 结构可赋值于此。 */
export interface DialectAssertionInput { lang: string; version: number; id?: string; }

/** 消费方首动作 = 方言断言（ADR 0005 §1）。不符即抛 SchemaSourceError('dialect-mismatch')。 */
export function assertVfslDialect(input: DialectAssertionInput): void { /* … */ }

/** 阶段态仓内文件源：扫描 <root>/domains/<domain>/*.vfsl。 */
export class FileSchemaSource implements SchemaSource {
  constructor(root: string);          // 同步、无 I/O——仅记 root（见 §4.3）
  async load(id: string): Promise<SchemaEnvelope>;
  async list(): Promise<string[]>;
}
```

实现注意（tsconfig 既有开关的约束，SA3 须过 `pnpm typecheck`）：
`exactOptionalPropertyTypes` 下可选字段不得显式赋 `undefined`（`context?.id !== undefined` 判后再赋）；
`noUncheckedIndexedAccess` 下数组/索引访问须收窄；`useDefineForClassFields`（target ES2022 默认开）下
类字段初始化即 defineProperty——`kind`/`code` 为可枚举自有属性，`rejects.toMatchObject({kind, code})`
直接可见（AC2 断言形态依赖此点）。

### 2.2 公共面导出（index.ts 追加）

```ts
// packages/vfsl/src/index.ts 追加（既有导出一行不动）：
export { FileSchemaSource, assertVfslDialect, SchemaSourceError } from './schemasource.js';
export type { SchemaSource, SchemaEnvelope, SchemaSourceErrorCode, DialectAssertionInput } from './schemasource.js';
```

理由：与既有纪律一致（公共面只经 `index.ts`，tokenizer/parser 等内部件不导出）；头部指令解析器
（`parseHeaderDirectives`）保持模块内部——它不是接缝，是 FileSchemaSource 的实现细节，导出只会冻结
一个尚无消费方的形状。测试 import 自 `../src/index.js`（SA6 契约），ESM `.js` 后缀指 `.ts` 源，
与既有 15 个测试文件同惯例。

---

## §3. 头部指令注释解析（规则冻结）

### 3.1 扫描区：前导 trivia 区

指令只在文件的**前导 trivia 区**识别：自文件首行起，由「空白行 / `//` 行注释 / 完整 `/* */` 块注释」
组成的极大前缀；**遇首个不属于上述三者的行（即首行代码）即停**。该区内：

- 行注释按 §3.2 的指令模式匹配，命中三键则登记；散文性行注释（不匹配模式）跳过、继续扫；
- 块注释（单行 `/* … */` 或跨行）**整体跳过，内部各行一律不计为指令**——防止散文示例里的
  `// @id: …` 被误读；
- 代码行之后的 `// @id:` **不识别**（头部区已结束）——防止模块正文散文注释劫持身份声明。

与 ADR 0005 §2 的格式示例自洽（指令 → 空行 → `/** */` 文档注释 → `type ROOT = …`）：文档注释是完整
块注释，属前导 trivia 区，指令在其之前已被全部捕获。

### 3.2 指令行模式与键规则

| 规则 | 冻结内容 | 违反时的分类 |
|---|---|---|
| 行模式 | `/^\s*\/\/\s*@(\w+)\s*:\s*(.*?)\s*$/`（行首空白容忍；键为 `[A-Za-z0-9_]+`；恰一个冒号；值 trim） | 不匹配 = 散文注释，忽略 |
| 键集 | `lang` / `id` / `version`，**大小写敏感**（`@LANG` 不识别 → 等效缺失） | — |
| 未知键（`@foo:` 等） | **容忍忽略**——文件格式开放扩展点，与方言「只增不改」演进纪律一致；三键才是契约（ADR 0005 §2 仅冻结三键必需） | — |
| 重复键 | **响亮拒绝**：`missing-directive`（消息明示 duplicate + 键名 + 出现数）。身份声明块的歧义不得静默任选赢家——「拿错文件当场报错」的同一纪律 | `missing-directive` |
| 空值（`// @lang:` / `// @lang:   `） | **视为缺失**：指令未承载值，语义上不存在 | `missing-directive` |
| `version` 值 | trim 后 `/^\d+$/` → `Number`；非数字（`abc`、`1.0`、负数、全角）→ 值存在但 ≠ 1 → 方言断言失败。`01` → 1（前导零容忍，无害） | 数值≠1 → `dialect-mismatch` |
| `lang` 值 | 精确 `=== 'vfsl'`（大小写敏感；`vfsl ` 带尾内容如 `vfsl extra` 亦 ≠） | ≠ → `dialect-mismatch` |
| BOM | 文件按 utf8 读入，串首 U+FEFF 被 `\s` 覆盖（ECMAScript `\s` 含 U+FEFF），首行指令天然容忍 | — |
| CRLF | 行按 `\n` 切分，尾 `\r` 被行模式的 `\s*$` 吸收 | — |

### 3.3 错误分类决策树（load 路径，一次走完）

```
解析头部（§3.1/§3.2）
├─ 重复键 或 三键任一缺失/空值 ──────────→ reject missing-directive（消息指明键与文件路径）
├─ 三键齐 → assertVfslDialect({lang, version: Number(version值), id})
│   ├─ lang !== 'vfsl' || version !== 1 ─→ reject dialect-mismatch
│   └─ 通过 → 组装信封 { lang, version, id, text: 原文 }（恰四键）
└─ （寻址阶段在前，见 §4：无候选 → unknown-id）
```

顺序即语义：**先完整性后方言**——键都没有就谈不上方言；**先寻址后校验**——文件都没找到就谈不上
键校验。三个 code 各守其位，无交叉。

---

## §4. id→文件寻址（两级）与扫描策略

### 4.1 扫描范围（冻结）

`<root>/domains/<domain>/*.vfsl`——**深度恰为 1+1**：`domains/` 下第一层目录 × 各目录内第一层
`.vfsl` 文件。目录名与文件名均 `sort()` 保证确定性。明确排除：

| 排除项 | 理由 |
|---|---|
| `domains/*.vfsl`（顶层散放） | 领域必须归属目录（ADR 0005 §5 领域包形态）；散文件是布局错误，不静默收纳——**R2（#6）处置定形：不再静默忽略，`list()` 检测到即整体 reject（原生 Error 含路径，见 §4.4/§4.5）** |
| **R2（#8）`.` 开头条目**（`domains/.bak/`、`domains/.staging/` 等点开头目录；两层扫描同规则，点开头 `.vfsl` 文件同排除） | 备份/暂存目录非领域包形态——排除（不入册、不进 list、不参与 CI 校验、不与正式 id 重复声明）；与深层递归排除同款理由。`readdir` 不返回 `.`/`..` 自身，无规则冲突 |
| `domains/<d>/**/深层 .vfsl` | **防 dogfood 测试 fixture 混入**——ADR 0005 §5 领域包含 dogfood 测试，深层递归会把测试 fixture 注册成 schema（本设计最重要的防御性排除） |
| 非 `.vfsl` 同目录文件（`generated.ts`、挂载点、测试） | 扩展名过滤天然忽略 |
| 无 `.vfsl` 的 domain 目录 | 未成形的领域包，不报错、不入 list（不把「还没写」当缺陷） |

### 4.2 两级寻址（本设计的核心机制）

SA6 测试的隐含约束：`domains/broken.id/schema.vfsl` 缺 `@id` 时，`load('broken.id@1')` 必须报
**missing-directive** 而非 unknown-id——即「**存在但其声明损坏**」必须与「**不存在**」可区分。
纯索引方案（**被否**：扫描时仅按头部 id 建键值索引，load 查表，miss 即 unknown-id——单级、无
目录回退）**必然**把 broken.id 报成
unknown-id，不满足契约。故设计两级：

**R2（#4）扫描产物与数据结构（冻结）**：每次 `load`/`list` 现扫（§4.3）的产物是**条目数组**而非
键值表——「入册」一律指数组追加，**不存在任何按键去重或后写覆盖**（Map 入册天然去重且后写覆盖，
与本节「首胜 + 重复可见」语义直接冲突，禁用）：

```
scan() → {
  entries: Array<{ dir, file, path, header }>,  // 每个 domains/<d>/<f>.vfsl 一条；
                                                // 序 = 目录名 sort → 文件名 sort（确定性）
  strays:  string[]                              // domains/ 顶层散放 .vfsl 路径（#6，仅 list() 消费，见 §4.4）
}
```

- **一级查表 = 首胜（first-win）**：`load(id)` 自数组头起取**首个**声明 id 与请求精确相等的条目——
  重复 id 时排序在先者胜出，后来者不覆盖、不删除；
- **`list()` = entries 的派生视图**：按序取各条目的声明 id，**重复项原样保留**（两文件同声明
  `dup@1` → list 含两个 `'dup@1'`）——重复可见，暴露而非隐藏；
- **入册资格 = 「`@id` 恰出现一次且值非空」**：`@id` 重复出现（y@1/z@1）= 身份声明歧义 = 不入册
  （按损坏文件处理，落点见 §4.5 #9 行）；缺 lang/version 但 `@id` 良好者**照常入册**——一级命中
  后走 §3.3 完整性树，报出精确缺失键（诊断优于二级的「首个损坏文件」）。

**一级（权威寻址）**：`load(id)` 按 entries 首胜命中 → 读文件、走 §3.3 校验树、组装或按其缺陷
拒绝。**头部 `@id` 是身份的权威来源**（id 是标签、文件自述，ADR 0005 §1「id 是标签不是键」）——
目录名与 `@id` 背离时（`domains/foo/` 声明 `@id: bar@1`），`load('bar@1')` 命中、`load('foo@1')`
落二级后报 unknown-id（消息附背离提示：目录内实际声明的 id）。

**二级（诊断回退，R2 #2/#5 重写）**：一级未中且 id 形如 `<base>@<digits>`（尾部 `@\d+` 后缀）→
剥后缀得 base，先过**单段校验**，再走分类决策树。两步均**零额外文件系统访问**——判定全基于
scan() 产物，目录匹配是与扫描所得目录条目**按名精确相等**的比较：

**R2（#5）base 单一路径段校验**：base 含 `/` 或 `\`、或**恰为** `.` / `..` / 空串（整串相等；
`broken.id` 这类含点**子串**的合法段不受影响）→ **直接 unknown-id**。禁止 `join(root,'domains',
base)` 直译探盘——校验是显式早出（`'../secret@1'` 这类 id 在触碰文件系统之前即出局），按名匹配
是结构性防穿越，双保险。理由：`/` 跨平台、`\` 在 Windows 皆为分隔符，含分隔符的 base 超出
`domains/` 领域包形状（ADR 0005 §5）的既定范围，跨平台一致拒绝；「宁可不存在，不可拿错文件」
与 §1.1 焦点 №2 同纪律。

**R2（#2）二级分类决策树**：

```
目录条目 domains/<base>/ 不存在，或存在但无 .vfsl 文件
  → unknown-id（消息：domains/<base>/ 下无 schema 文件）
目录内存在「头部完整（三键齐、无重复键）且声明 id 的 base 与请求 base 一致」的文件
  → unknown-id（消息附实际声明 id——版本打错（请求 vfs3.assets@2 vs 盘上完好 vfs3.assets@1）
    一眼可诊）
无上述健康同 base 声明，但目录内存在损坏文件（缺键/空值/重复键）
  → missing-directive（排序首个损坏文件，消息含路径与所缺键）
无健康同 base 声明，且目录内文件头部全部完整（声明的全是别的 base——目录名↔id 背离）
  → unknown-id（消息附目录内实际声明的 id）
```

一句话冻结：**missing-directive 仅当「目录内有损坏文件可指」且「无健康同 base 声明」**。R1 的
「目录内有损坏文件即 missing-directive」在多文件目录下把「版本打错」（`domains/foo/` 内
a.vfsl 完好声明 foo@1 + b.vfsl 无关损坏，`load('foo@2')`）误诊为「声明损坏」——本决策树修正之。
SA6 的 broken.id / broken.all 落点不变：两目录内均无健康同 base 声明，走第 3 分支（SA2 原型实测
两场景可共存，见其评审附录 A）。注：「头部完整」= 三键齐且无重复键（§3.2），**不含方言有效性**
——声明 `foo@1` 但 `@lang: yaml` 的文件仍是「健康声明 foo@1」：load('foo@1') 一级命中报
dialect-mismatch，load('foo@2') 落二级报 unknown-id 附 foo@1（循迹即见方言问题），各得其所。

无 `@<digits>` 后缀的 id 仅走一级（后缀剥离是回退的启发式，不是 id 的语法义务——一级按头部原文
精确匹配，任意形状 id 均可入册寻址）。

**目录名↔id 的关系就此定形**：`domains/<domain>/` ↔ `@id: <domain>@<version>` 是 ADR 0005 §2/§5
示意的**惯例布局**，一级寻址不依赖它（权威是头部 `@id`）；它只作为二级回退的启发式存在，服务于
「损坏文件的诊断保真」。两个用例的机制归属：`broken.id@1` → 二级（missing-directive）；
`no.such.domain@1` → 两级皆 miss（unknown-id）。

**重复 id 跨文件**（两文件声明同一 `@id`）：**容忍不报错**——ADR 0005 §1 明言「引擎正确性不依赖
id 唯一性」；语义即 R2（#4）数据结构的直接推论：load **首胜**（排序首个，确定性），list() 从
entries 数组派生、**重复保留**（暴露而非隐藏）。此为 ADR 对齐决策，非测试锚定项。

### 4.3 扫描时机：每次调用现扫（无缓存）

- **构造函数同步且零 I/O**（仅记 root）——SA6 契约 `new FileSchemaSource(fx.root)` 后立即调用方法，
  异步初始化（async factory / 后台预热）不可行也不必要；
- `load`/`list` 每次现扫 `domains/`：脚手架规模（个位数领域文件、本地盘、CI/dev 时点）性能无虞；
  换来**零状态、恒新鲜**——盘上文件在两次调用间变更即时可见（CI regen-diff 语义友好），无陈旧
  缓存失效问题。加缓存（mtime 失效等）属「脚手架长成承重墙」的反面教材，F1 不做；若未来领域数
  增长到扫描成为热点，属 F2+ 的显式优化票。

### 4.4 list() 语义：绝不静默跳过损坏文件

`list()` = 枚举 + 逐文件完整校验（§3.3 全树）：任一文件头部损坏或方言不符 → **整体 reject**（结构化
错误，含 path）。CI 与 F2 生成器以 list() 枚举领域——静默跳过损坏文件会让 CI 对坏文件失明（AC5 的
反面），这是「拒绝虚假降级」立法的标准适用场景：仓内脚手架文件头部不完整**不是运行时降级场景，
是缺陷**，必须响亮。副作用是「一个坏文件拖死整个枚举」——正是想要的：修好它。

**R2（#6）顶层散放 `.vfsl` 同款响亮**：scan() 产物 `strays` 非空 → `list()` 整体 reject（原生
`Error` 而非 `SchemaSourceError`——布局错误不在三码语义域，同 §4.5「不臆造第 4 个 code」纪律；
消息含散放文件完整路径 + 「领域 schema 应位于 `domains/<domain>/`（ADR 0005 §5）」提示）。
R1 的「散放静默忽略」使坏布局对 CI 完全隐形，与「一坏全拒」哲学自相矛盾——就此消除。`load()`
不受散放影响：散放文件不入册、不可寻址（请求其 id → unknown-id）——与「无关文件损坏不阻塞
load」同款标定：**list() 是可见性通道（一坏全拒），load() 是寻址通道（指谁验谁）**。

### 4.5 边界行为总表

| 场景 | 行为 | 测试锚点 |
|---|---|---|
| `domains/` 目录不存在（仓内现状） | 扫描入口 `readdir(<root>/domains)` 判 **ENOENT** → 合法空集（设计内状态，非降级）：`list()` → `[]`；`load` → unknown-id | §6 空集行为的根基 |
| **R2（#1）root 指向文件 / `domains` 是文件（readdir 判 ENOTDIR）** | **响亮，二选一显式定形为「原样冒泡」**：Promise rejection（原生 I/O Error），**绝不** resolve `[]` 或 unknown-id 静默空集。ENOTDIR 在正常使用流程（SA6 fixture、repo 根）**不可能出现**——出现即调用方 bug 或仓内异常状态，视同缺失属虚假降级（把 bug 伪装成合法空集，CI 假绿）。选冒泡而非结构化错误的理由：与下行 EACCES 同域（环境级故障，非三码语义域），且不臆造第 4 个 code | — |
| 其余环境级 I/O 异常（EACCES 等） | **原样冒泡**（非结构化错误）——环境级故障，非三码语义域；不臆造第 4 个 code 破坏冻结契约 | — |
| 同目录多 `.vfsl` 文件 | 各自独立入册（entries 数组条目，§4.2 R2 #4）；二级回退按 §4.2 R2 #2 决策树——有健康同 base 声明 → unknown-id（附实际声明 id），否则排序首个损坏者 missing-directive | — |
| **R2（#9）头部重复 `@id` 键**（如 y@1/z@1 同现、目录名 x） | 该文件不入册（身份声明歧义，§4.2 入册资格）；`load('x@1')` → 二级：目录 x 有损坏文件且无健康同 base 声明 → **missing-directive**（duplicate 消息含出现数）；`load('y@1')` / `load('z@1')` → 二级：目录 `domains/y/`、`domains/z/` 不存在 → **unknown-id（冻结落点）**——重复键文件的全部出现值不参与寻址：身份声明歧义的文件不提供任何权威 id，宁可「不存在」不「拿错」（§1.1 焦点 №2 同纪律） | — |
| **R2（#6）顶层散放 `domains/*.vfsl`** | `list()` → 整体 reject（原生 Error 含路径，§4.4）；`load` → 散放不入册不可寻址，请求其 id → unknown-id | — |
| **R2（#8）`.` 开头目录/文件** | 两层扫描一律排除（§4.1 表）——不入册、不进 list、不触发任何错误 | — |

---

## §5. 方言断言助手：双层防御

**层 1（接缝内建）**：`FileSchemaSource` 在信封组装点调用 `assertVfslDialect`——盘上文件方言不符
（`@lang: yaml` / `@version: 2`）在 load 时当场爆炸（AC2b 两用例锚定）。这是「拿错文件 = 当场报错」
（ADR 0005 §2 防错冗余）在文件源侧的执行。

**层 2（消费方首动作）**：`assertVfslDialect` 独立导出，F2 生成器、CI、终态 `DocSchemaSource` 的
消费方对**到手信封**执行同一断言（ADR 0005 §1「消费方首动作 = 方言断言」——方言冻结纪律焊进管线）。

双层不是冗余：层 1 挡「盘上是什么」（文件源的责任边界），层 2 挡「信封是什么」（接缝不信任原则——
DocSchemaSource 从网络/`__schema__` 拉的信封不经过 FileSchemaSource，层 2 是唯一防线）。两处共用
同一函数实现，断言语义单点冻结：`lang === 'vfsl' && version === 1`（version 经 `Number` 解析后
比较——`NaN !== 1`、`2 !== 1` 同归 dialect-mismatch）。

---

## §6. AC5：CI 脚手架校验步骤

### 6.1 实现形态：vitest 载体 + 工作流显式步骤（双保险）

**载体**：新测试 `packages/vfsl/test/domains-scaffold.test.ts`（落在 vitest include
`packages/*/test/**/*.test.ts` 内 → 普通 `pnpm test` 自动跑到；亦可行内点名）。要点：

- **经接缝消费**：`new FileSchemaSource(repoRoot)`（**R2 #11b 写死 API**：repoRoot =
  `fileURLToPath(new URL('../../..', import.meta.url))`——自 `packages/vfsl/test/` 上溯三级到仓根；
  必须用 `node:url` 的 `fileURLToPath`，**不得直取 `URL.pathname`**——百分号编码路径下 pathname
  产出错误路径），先
  `list()`（任一领域损坏即 reject → 红），再对每个 id `load(id)` + `parseVfsl(env.text).ok === true`
  ——「全部领域文件可解析 + 头部三键齐备」恰是 load 内建校验 + parseVfsl 的组合，**CI 也是消费方，
  经接缝取文本**（脚手架纪律的 dogfood，零解析逻辑重复实现）；
- 顺带锚定导出的断言助手（SA6 测试未直接覆盖该导出）：`assertVfslDialect({lang:'vfsl',version:1})`
  不抛、`{lang:'yaml',version:1}` 抛 `dialect-mismatch`——消费方首动作的最小运行时锚点；
- **空集行为**：`domains/` 不存在或 0 文件 → **pass + console.log 显式 notice**（
  `[domains-scaffold] 0 domain schemas found …`，CI 日志可见）。不 fail：F1 先于 G 合入，fail 会
  卡死本票自己的 CI（G 票才种首个领域）；notice 保证「忘了建 domains/」在日志里不静默。

**工作流**：`.github/workflows/ci.yml` 的 `Test` 步骤后追加（同一 matrix job、零新依赖零新服务）：

```yaml
      - name: Domain scaffolds check
        run: pnpm exec vitest run packages/vfsl/test/domains-scaffold.test.ts --passWithNoTests=false
```

显式步骤的价值：AC5 在工作流文件里**评审可见**（可审计的合规锚点），且不随未来 include 收窄而失效；
普通 `pnpm test` 里的自动运行为本地开发提供同一校验。两路径跑同一文件，无双重实现。

**R2（#3）`--passWithNoTests=false` 的由来（删除盲区消除）**：`vitest.config.ts:7` 设
`passWithNoTests: true`（仓内既有配置，本票不动），SA2 与本 R2 均实测：点名**不存在**的文件 →
`No test files found, exiting with code 0`——即该测试文件被删/改名时，显式步骤**静默假绿**、
include 自动跑路径也不收集（文件不在即不跑），双保险两翼同时失明，「可审计锚点」自毁。追加 CLI
覆盖 `--passWithNoTests=false`（优先级高于 config 值）后本 R2 亲测：点名不存在文件 → **非零
退出（exit 1）**；文件存在且用例过 → 照常 exit 0，行为零变化（证据贴 §10，#7 纪律：输出入文档）。

**被否方案**：独立 `node scripts/check-domains.mjs`——`packages/vfsl` 的 `exports` 直指
`src/index.ts`（TS 源直出、无构建产物，`package.json:6-8`），脚本 import 解析器需以下之一：node 20
无 strip-types（matrix 下限，不可用）/ 引入 tsx（违反零依赖原则）/ 增设构建步骤（scope creep）。
vitest 是仓内既有的 TS 执行器（SA6 R2 与本会话均以 `pnpm exec vitest run <file>` 形态实跑成功，
见 §10），零新增依赖。

### 6.2 本票不种首个领域 `.vfsl` 文件

ADR 0001 修订节放行仓内脚手架，但**首个领域包是 G 票的交付物**（domains/vfs3-assets + generated.ts
+ dogfood 测试整包落地）；F1 种文件会产出「只有 schema 没有生成物与挂载点」的半成品领域包，且与
G 的 fixture 选型耦合。F1 保持 `domains/` 不存在，CI 空集 pass + notice（§6.1），G 合入后集合自然
非空。`pnpm-workspace.yaml` 相应**零改动**：领域包入 workspace 与否是 G 票建包时的事（届时领域包
带 package.json 才有入 workspace 的主体资格）；F1 的文件源按文件系统路径扫描，不依赖 workspace
解析。

---

## §7. 版本与依赖

- `packages/vfsl/package.json`：`"version": "0.1.7"` → `"0.1.8"`（Hard Gate 9，patch）；
- devDependencies 追加 `"@types/node": "^20"`：SA6 测试已 `import { mkdir, mkdtemp, writeFile } from
  'node:fs/promises'` 等三个 node 内置模块，而 workspace 未装 `@types/node`（root 与
  `packages/vfsl` 的 node_modules 均无、`.pnpm` 无 `@types+node*`）——**`pnpm typecheck` 现状即红**
  （3 条 TS2307，本会话亲跑证据见 §10）。`src/schemasource.ts` 的 `node:fs/promises`/`node:path`
  import 同样依赖它。版本对齐 engines 下限 node 20（matrix 20/24 兼容）；
- `pnpm-lock.yaml` 随 `pnpm install` 同步（ALLOW LIST 列入）。

---

## §8. 测试通过策略（SA3）

### 8.1 12 红转绿逐 describe 推演

| describe / it（13 用例） | 机制归属 | 红转绿手段 |
|---|---|---|
| AC1 #1 load/list 返回 Promise | 接缝方法 async 声明 | §2 实现 |
| AC1 #2 信封恰四键 + 值 | load 返回四键字面量（不多不少） | §2 实现 |
| AC1 #3 list 枚举 ≥2 id | 扫描 + 头部 id 入册（一级） | §4.2 实现 |
| AC2a 缺 lang → missing-directive | 一级命中（@id 在）+ §3.3 完整性 | §3 实现 |
| **AC2a 缺 id → missing-directive（非 unknown-id）** | **二级目录回退** | §4.2 二级实现（核心） |
| AC2a 缺 version → missing-directive | 一级命中 + 完整性 | §3 实现 |
| AC2a 三键全缺 → kind:schema-source（missing 或 unknown 均可） | 二级回退 → missing-directive（落在允许集内） | §4.2 实现 |
| AC2b lang≠vfsl → dialect-mismatch | 层 1 内建断言 | §5 实现 |
| AC2b version≠1 → dialect-mismatch | 层 1 内建断言（`'2'` → 2 ≠ 1） | §5 实现 |
| AC2c 未知 id → unknown-id | 两级皆 miss | §4.2 实现 |
| AC3 parseVfsl 直接 ok | **既有行为**（行注释 = trivia，v1-spec 注记 9/10） | 已绿保持——parser 零触碰 |
| AC4 #1 text 逐字节一致（含头部） | readFile utf8 直通、零变换 | §2 实现 |
| AC4 #2 id/version 解析自头部、version 为 number | 头部值组装 | §3 实现 |

SA1 已以 `/tmp` 原型（与本设计算法逐条同构）实跑复刻 SA6 全部 fixture 场景：**30/30 通过**（13 个
契约场景 + 17 个边界定形，含 broken.id 的二级回退路径）——算法满足契约有实跑证据，非纸面推演（§10）。
（**R2 注**：该 /tmp 原型已失存不可复跑——SA2 #7 亲查指认；算法结论已由 **SA2 独立原型**
（`/tmp/sa2-attack-proto.mjs`，独立同构复写）复证：SA6 12 分类场景全过 + 边界 7 项逐项复现，
且其 23 场景实跑恰好暴露 R1 未冻结点 #2/#4/#5——均已由本 R2 写死。）

**R2 推演自检（#2/#4/#5 新语义 × SA6 13 用例逐一核对；broken.id / broken.all 落点不得变）**：

| SA6 用例 | 新规则路径 | 落点 | vs R1 |
|---|---|---|---|
| AC1#1/#2（Promise / 信封恰四键） | 不涉寻址 | — | 不变 |
| AC1#3 list 枚举 ≥2 id | fixture 两目录健康、无散放/隐藏条目 | 扫描序两 id | 不变 |
| AC2a 缺 lang | 一级命中（@id 良好者入册）→ §3.3 完整性 | missing-directive | 不变 |
| AC2a 缺 id（`broken.id@1`） | 一级 miss → 二级：base `broken.id` 单段合法；目录存在、**无健康同 base 声明**、有损坏文件 → 决策树第 3 分支 | **missing-directive** | **不变（核心锚点）** |
| AC2a 缺 version | 一级命中 → §3.3 | missing-directive | 不变 |
| AC2a 三键全缺（`broken.all@1`） | 同 broken.id 路径（无健康同 base 声明 + 有损坏文件） | missing-directive（用例允许 missing \| unknown，仍落 missing） | 不变 |
| AC2b lang=yaml / version=2 | 一级命中 → 方言断言 | dialect-mismatch | 不变 |
| AC2c `no.such.domain@1` | 一级 miss → 二级：base 单段合法、目录不存在 → 决策树第 1 分支 | unknown-id | 不变 |
| AC3 parseVfsl ok | parser 零触碰 | ok | 不变 |
| AC4 text / id / version | readFile 直通 + 头部组装 | — | 不变 |

#4 数组化不改变 fixture（无重复 id）任何寻址结果；#5 单段校验不触及任何 fixture base
（`broken.id`、`no.such.domain` 均为合法单段——含点子串不是 `.`/`..` 整串）。**对 SA6 契约影响 = 零。**

### 8.2 存量零回归论证

F1 对 src 是**纯增量**：新模块 `schemasource.ts` + `index.ts` 追加导出；tokenizer/parser/semantic/
ir/derived/evaluate/validate/resolve/shapes/pattern/xml/errors 十二个引擎内部件**一行不动**；
vitest.config.ts、tsconfig 零改动。存量 15 文件的被测对象（parseVfsl/evaluate/validateSnapshot 及
类型）公共面与行为无任何变化 → 341 存量用例 + AC3 不受影响。全量预期：F1 后 16 文件全绿 + 新增
scaffold 测试文件 → 17 文件全绿（354 → 355+ 用例）。

### 8.3 typecheck 6 错清零路径（含 SA6 文件协调点，总控裁决项）

本会话亲跑 `pnpm typecheck` 现状 6 错（证据 §10）：

| 错误 | 行 | 清零手段 | 归属 |
|---|---|---|---|
| TS2307 ×3（`node:fs/promises`/`node:os`/`node:path`） | :29-31 | §7 devDep `@types/node` + install | SA3 |
| TS2305 缺导出 `FileSchemaSource` | :32 | §2 实现 | SA3 |
| TS2345：`rejects.toMatchObject({kind:…} as unknown)`——`unknown` 不可赋 `object \| any[]` | :242 | **去掉多余 `as unknown`**（字面量本就可赋参；cast 是致错项）。运行时同对象，断言语义零变化 | **SA6 owned，需协调** |
| TS2339：`fx.files.assets` 不存在——fixture 返回类型谎报为单对象数组形 | :329（根因 :103 cast） | fixture 返回 cast 改为 `Record<'assets' \| 'audit', { id: string; rel: string; body: string }>`（运行时本就是此形状，类型谎言修正）。断言零变化 | **SA6 owned，需协调** |

**协调路径**：按 skill 立法（PR #254），SA6 owned 测试文件进 ALLOW LIST 且 SA3 可修**测试基础设施**
（类型 cast）而不改断言逻辑——上两处均为纯类型层修复（去 cast / 修类型标注），运行时行为与断言
对象逐字节不变。建议总控知会 SA6 备案；若总控裁定不许动 SA6 文件，则 CI Typecheck 步骤在该两错下
必挂，F1 无法全绿——此为阻塞项，须总控明示取舍。

（**R2 #11c 备案**：SA6 测试文件头注释引「v1-spec §1 注记 9/10」实为 **§2**（语法注记所在节；
本设计 §1.2 引 §2 正确）。若上述类型修复开动该文件，可顺手把注释引用 §1 → §2——纯注释、
零断言影响，改与不改均不阻塞。）

### 8.4 SA3 验证命令（实跑留证）

```bash
pnpm install                                  # @types/node 落 lock
pnpm typecheck                                # 0 错（6 错清零）
pnpm exec vitest run packages/vfsl/test/schemasource-seam.test.ts   # 13 passed
pnpm exec vitest run packages/vfsl/test/domains-scaffold.test.ts    # 1-2 passed（空集 notice）
pnpm test                                     # 17 文件全绿，零回归
```

---

## §9. 风险与权衡

| # | 风险/权衡 | 处置 |
|---|---|---|
| 1 | `list()` 严格拒绝（一坏全拒）可能被未来消费方视为过刚 | F1 消费方 = CI/F2 生成器，严格即正确（§4.4）；终态 DocSchemaSource 另有服务端语义，不在本票冻结范围 |
| 2 | 二级回退按目录名启发式——目录名与 id 背离时行为较难一眼理解 | §4.2 显式定形权威关系（头部 id 权威、目录名仅回退），unknown-id 消息附「目录内实际声明的 id」提示 |
| 3 | SA6 文件类型缺陷协调失败 → typecheck 永红 | §8.3 已列精确修法与阻塞上报路径；ALLOW LIST 以 [SA6 owned] 标注放行类型层修复 |
| 4 | 空集 pass + notice 存在「domains/ 被误删而 CI 仍绿」的残余窗口 | notice 进 CI 日志可查；G 票合入后集合非空，窗口期有限；如需硬门禁属后续票（非 F1 范围） |
| 5 | 每 load 全扫描在大领域数下变慢 | 脚手架规模无虞（§4.3）；缓存属 F2+ 显式优化票，不预建（脚手架不长成承重墙） |
| 6 | `@types/node` 新依赖的版本漂移（20/24 矩阵） | ^20 对齐 engines 下限；lockfile 冻结实际版本；类型面仅用 fs/path/os 稳定 API |
| 7 | 重复 id 跨文件容忍（§4.2）可能掩盖复制粘贴错误 | ADR 0005 §1「不依赖唯一性」是对齐决策；list() 保留重复项使其可见；如需响亮检测属后续票 |

---

## §10. 协议假设依据 (Protocol Assumption Evidence)

本设计含以下可执行机制类假设，均以本会话（2026-08-20，shell 已恢复）实跑取证。
**R2（#7）证据留存纪律**：自 R2 起，设计期实测输出全文贴入本设计文档，不依赖 /tmp 易失路径
（R1 原型 `/tmp/sa1-seam-proto/` 已失存致 SA4 不可复跑——教训吸收；后续轮次新实测一律同款持久化）。

| 假设 | 依据类型 | 依据内容 | 风险等级 |
|---|---|---|---|
| SA6 红灯基线 = 12 红 1 绿、失败模式唯一为缺导出 | 设计期实测 | 本会话亲跑 `pnpm exec vitest run packages/vfsl/test/schemasource-seam.test.ts`：`Tests 12 failed \| 1 passed (13)`，12/12 均 `TypeError: FileSchemaSource is not a constructor`（与 SA6 R2 记录一致） | 低 |
| 两级寻址 + 头部解析算法满足全部 13 用例期望与 17 项边界定形 | 设计期实测 | SA1 `/tmp/sa1-seam-proto/prototype.mjs`（与本设计 §3/§4 算法同构）复刻 SA6 fixture 场景 + 边界用例实跑：`TOTAL 30 \| PASS 30 \| FAIL 0`（**R2 注**：该 /tmp 产物已失存不可复跑——SA2 亲查；算法结论由 SA2 独立原型复证，23 场景实跑全文见 SA2 评审附录 A） | 低 |
| `pnpm typecheck` 现状即红（@types/node 缺失 + SA6 两类型缺陷） | 设计期实测 | 本会话亲跑 `pnpm typecheck`：6 错（TS2307×3 :29-31 / TS2305 :32 / TS2345 :242 / TS2339 :329），exit 2 | 中（驱动 §7/§8.3 两项决策） |
| `exports` 直指 TS 源、无构建产物 → 独立 node 脚本不可行 | 源码引用 | `packages/vfsl/package.json:6-8`（`"exports": { ".": "./src/index.ts" }`，无 build script、无 dist）；root `engines: node >=20`（`package.json:14`）限死 strip-types 方案 | 低 |
| vitest 可点名单文件运行（CI 步骤形态可行性） | 设计期实测 + 既有测试引用 | SA6 R2 与本会话均以 `pnpm exec vitest run packages/vfsl/test/schemasource-seam.test.ts` 实跑成功（vitest include `packages/*/test/**/*.test.ts` 命中该路径，`vitest.config.ts:5`） | 低 |
| vitest 全量现状 16 文件 354 用例、唯一红即本票文件（12 红 / 342 绿，存量 = 341 + AC3） | 设计期实测 | 本会话亲跑 `pnpm exec vitest run`：`Test Files 1 failed \| 15 passed (16)`、`Tests 12 failed \| 342 passed (354)`——与 SA6 R2 记录逐字一致 | 低 |
| **R2（#3）`--passWithNoTests=false` 令点名不存在文件非零退出（AC5 锚点防自毁）** | 设计期实测（R2，输出全文贴此） | 本会话亲跑（2026-08-20，worktree 根）：`pnpm exec vitest run packages/vfsl/test/DOES-NOT-EXIST.test.ts --passWithNoTests=false` → `No test files found, exiting with code 1`，**exit 1**；同命令去 flag → `No test files found, exiting with code 0`，exit 0（复现 SA2 附录 B 盲区）。config 依据：`vitest.config.ts:7` `passWithNoTests: true`（源码亲读） | 低 |

无网络协议/端口/进程生命周期类假设（纯库 + 文件系统 + 既有 CI job 内追加一步）。

---

## §11. 契约改动连锁审计 (Contract Change Caller Audit)

**无契约改动**：本设计仅涉及**新增**（新模块、新导出、新测试、新 CI 步骤、devD 新增）。
`index.ts` 既有导出（parseVfsl/evaluate/validateSnapshot 及类型）逐字不动；无任何既有函数的
签名/返回/throw 行为变化；无 caller 需要迁移。既有 caller 面貌（供 SA4 抽查）：`parseVfsl` 的
caller 为 15 个存量测试文件与 `tests/acceptance/vfsl_spec_acceptance.py`（经 CLI 之外的断言
fixture，不在本票触碰面）；`evaluate`/`validateSnapshot` 的 caller 为对应存量测试。F1 对它们的
调用路径零影响。

---

## §12. 文件清单（File Scope）

### ALLOW LIST

- `packages/vfsl/src/schemasource.ts` — 新建，§2/§3/§4/§5 全部实现（接口/信封/错误类/FileSchemaSource/断言助手/头部解析 + R2 §4.2 决策树/单段校验/数组扫描，~260 行）
- `packages/vfsl/src/index.ts` — 修改，§2.2 追加 3 个值导出 + 4 个类型导出（~7 行），既有导出零变动
- `packages/vfsl/package.json` — 修改，§7：版本 0.1.7→0.1.8 + devD `@types/node@^20`
- `pnpm-lock.yaml` — 修改，install 同步 @types/node（自动生成）
- `packages/vfsl/test/schemasource-seam.test.ts` — `[SA6 owned]` 仅 §8.3 两处**类型层**修复（:242 去 `as unknown`、:103 fixture 返回 cast 改 `Record<'assets'|'audit', …>`）；断言逻辑与用例结构零改动
- `packages/vfsl/test/domains-scaffold.test.ts` — 新建，§6.1 AC5 仓内脚手架校验（经接缝消费 + 断言助手锚点 + 空集 notice）
- `.github/workflows/ci.yml` — 修改，§6.1 追加 `Domain scaffolds check` 一步（~3 行）
- `wiki/raw/task_vfsl-schemasource-seam_design.md` — 本设计文档（随分支 commit）
- `wiki/raw/task_vfsl-schemasource-seam.md` — **R2（#10）补列**：任务简报（含 SA6 R2 真红灯证据）——纪律「wiki/raw/ 产出文件必须随分支 commit」（简报 §纪律），R1 漏列有红灯证据漏出分支之险
- `wiki/raw/task_vfsl-schemasource-seam_dispatch.md` — **R2（#10）补列**：本票调度日志，同上纪律
- `wiki/raw/task_vfsl-schemasource-seam_sa2_review.md` — **R2（#10）补列**：SA2 攻击评审文件（本 R2 修订的输入证据），同上纪律

### DENY LIST

- `packages/vfsl/src/{tokenizer,parser,semantic,ir,derived,evaluate,validate,resolve,shapes,pattern,xml,errors}.ts` — 引擎十二内部件零改动（AC3 已绿的行为根基）
- `packages/vfsl/tsconfig.json`、`tsconfig.base.json`、`vitest.config.ts` — include 与编译开关不动（编译开关变动波及全包，非本票议题）
- `pnpm-workspace.yaml` — §6.2：domains/ 不入 workspace，G 票再议
- `domains/**` — 本票不种首个领域文件（G 票交付物）
- `docs/adr/*`、`docs/vfsl/v1-spec.md`、`CONTEXT.md` — 冻结契约文档
- `tests/acceptance/**` — Python 验收脚本与 fixture 不动
- `TASK.md`、`.mabf-bg/`、`.scratch*` — 调度器/草稿产物，不进分支 commit

---

## SA2 反馈逐条回应（R2）

评审输入：`task_vfsl-schemasource-seam_sa2_review.md`（verdict: reject，攻击点清单 §1）。

| 攻击点 | 严重度/处置 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|:--:|---|---|
| #1 ENOTDIR「视同缺失」虚假降级 | CRITICAL / 必修 | ✅ | §4.5 表第 2 行 | 扫描入口 readdir 按错误码分流：**ENOENT → 合法空集（保持）**；**ENOTDIR → 原样冒泡**（Promise rejection，绝不 resolve `[]`/unknown-id）——二选一显式定形为「冒泡」并附理由（与 EACCES 同域、不臆造第 4 码、正常流程不可能出现即响亮报 bug） |
| #2 二级回退多文件目录错分类 | HIGH / 必修 | ✅ | §4.2「二级分类决策树」 | 「有健康同 base 声明 → **unknown-id（附实际声明 id）**」提到 missing-directive 之前；missing-directive 收窄为仅当「有损坏文件可指 且 无健康同 base 声明」；「头部完整 = 三键齐无重复键、不含方言有效性」明示；broken.id/broken.all 落点不变（§8.1 自检） |
| #3 CI 点名步骤删除盲区 | HIGH / 必修 | ✅ | §6.1 yaml 步骤 + 说明段 | 步骤追加 `--passWithNoTests=false`；R2 亲跑实证贴 §10：无 flag 点名不存在文件 exit 0（盲区复现）、有 flag **exit 1**；文件存在时行为零变化 |
| #4 重复 id 数据结构语义矛盾 | HIGH / 必修 | ✅ | §4.2「扫描产物与数据结构（冻结）」 | 注册表 = **条目数组**（非 Map，明示禁用）+ 一级**首胜**查表；list() 从数组派生、**重复保留**；入册资格 =「@id 恰一次且非空」；矛盾句「按头部 id 入册」已重写为数组语义 |
| #5 base 未冻结路径段校验（穿越窗口） | MEDIUM / 同轮吸收 | ✅ | §4.2「base 单一路径段校验」 | base 含 `/`/`\` 或恰为 `.`/`..`/空串 → **直接 unknown-id，零文件系统访问**；目录匹配冻结为「与扫描条目按名精确相等」，禁止 join 直译——校验早出 + 结构性防穿越双保险 |
| #6 顶层散放静默忽略 | MEDIUM / 同轮吸收 | ✅（采纳推荐项 a） | §4.1 表 + §4.4 + §4.5 | scan() 产出 `strays`；`list()` 检测非空 → **整体 reject**（原生 Error 含路径 + 应位于 `domains/<domain>/` 提示）；load 不受影响（散放不可寻址）——「坏布局无声」消除，与一坏全拒哲学一致 |
| #7 设计期证据不可复跑 | MEDIUM / 流程 | ✅（纪律） | §10 头部 + 新实测行 | 纪律条款入 §10（实测输出贴文档，不依赖 /tmp）；本 R2 新实测（#3 flag 行为）已全文贴入 |
| #8 隐藏目录静默入册 | LOW / 边界表补行 | ✅ | §4.1 表 + §4.5 表 | `.` 开头目录/文件两层扫描一律排除（.bak/.staging 不入册、不进 list/CI、不与正式 id 重复） |
| #9 重复 @id 键文件寻址落点未冻结 | LOW / 边界表补行 | ✅ | §4.2 入册资格 + §4.5 表 | 重复 @id → 不入册（身份歧义）；`load('x@1')` → missing-directive（duplicate 消息）；`load('y@1')`/`load('z@1')` → **unknown-id（冻结落点）**，附「宁可不存在不拿错」理由 |
| #10 ALLOW LIST 漏列 wiki/raw 产物 | LOW / 同轮吸收 | ✅ | §12 ALLOW LIST | 补任务简报 / 调度日志（`_dispatch.md`）/ SA2 评审文件三件（随分支 commit 纪律）；只增不删 |
| #11 杂项文字 | LOW / 顺手改 | ✅ | §0 / §6.1 / §8.3 | (a) §0 导出计数 5 → 3 值 + 4 类型 = 7；(b) repoRoot 写死 `fileURLToPath(new URL('../../..', import.meta.url))`，禁直取 `URL.pathname`；(c) §8.3 备案 SA6 注释 §1→§2（随类型修复顺手改，不阻塞） |

**SA6 契约影响自检**：零（§8.1 R2 推演自检表——13 用例逐一核对新规则路径，broken.id/broken.all
落点均为 missing-directive 不变；#4 数组化与 #5 单段校验不触及任何 fixture 形状）。
