# 设计 — fix(vfsl-codegen): 生成物编译级加固（Issue #45）

> **SA1 设计文档 v1.2**（v1 → SA2 verdict **pass** 附 4 项非阻断文字级修订（`_sa2_review.md` 攻击点 #1–#4）→ v1.1；→ SA4 verdict **pass** 附 3 项回流文档债（`_sa4_review.md` 硬门禁 9 附注：ALLOW LIST 增补 `package.json` / §9 bump 必需化 / §12 caller 计数勘误）→ v1.2。处置记录见文末「SA2 反馈逐条回应」与「v1.2 处置记录」；v1.2 零行为决策/零测试锚变动，文件范围仅按硬门禁 9 增补一项）
> 任务类型：Bug 修复（含新行为：恒定 import 行 + 别名碰撞响亮守卫）
> 基点：`5907dc3`（PR #46 merge）；红灯基线：SA6 3 文件 / 13 tests 全红（`packages/vfsl-codegen/test/`）
> 输入：任务简报 `task_vfsl-codegen-hardening.md`（含 SA6 红灯记录节）、SA5 故障分析 `20260821-bug-vfsl-codegen-hardening.md`、SA8 冲突门禁 `task_vfsl-codegen-hardening_conflict_report.md` + 决议摘编 `_relevant_decisions.md`、SA6 红灯测试四文件（已逐行读）
> 设计期实测：本文所有 TS 语义断言均附探针证据（§11），探针脚本在 `/tmp/sa1-i45/`，仓内零写入（`git status` 仅调度器 wiki 暂存 + SA6 未跟踪测试文件）

---

## §1 根因定界（摘 SA5，本设计不重复推演）

三项缺陷同源于 `generateProjection`（`packages/vfsl-codegen/src/emitter.ts:96-142`）的发射清单只有「头注 + 段②别名声明 + 段③协议增广」三段：

| 缺陷 | 根因位点 | 实证形态 |
|---|---|---|
| N1 缺协议 import 行 | 发射清单无 import 位点（`header.ts:35-46` 纯注释块；段②/③ 经 `emitNode`（emitter.ts:190）引用 `PathSchema` 全文无绑定） | 孤立 program TS2304×3 + TS2664（SA5 p1） |
| N2 零别名域 script 退化 | 段② 循环（L126-129）零别名域发零 export → 文件无 top-level import/export → script → `declare module`（L132）退化为整体环境声明遮蔽真实协议模块 | 消费方 TS2305×2（SA5 p2） |
| N3 别名碰撞无守卫 | `emitAlias`（L148-160）对别名名无条件发射；协议导出面 12 名与别名碰撞无人检查 | TS2315/TS2314（SA5 p3）；CLI exit 0 静默产出（SA5 E5） |

Owner 三项裁定（优先于附注原文）：EACCES 项已过期勿动；N3 本票自包含（独立错误码，不依赖 G 票命名规约）；AC-4 尾串三处随票替换。

---

## §2 设计总览

三条修复线，全部落在 `packages/vfsl-codegen` 包内，**CLI/编排/协议包/parse 层零改动**：

```
domains/<d>/schema.vfsl
  → FileSchemaSource.load → assertVfslDialect（不变）
  → parseVfsl → evaluate（不变，输入契约冻结）
  → generateProjection（emitter.ts）              ←── 全部改动落点
      [新增] 段②发射前置守卫：别名名 × 协议导出面(12) 碰撞 → throw（§4）
      [新增] 恒定发射 import type { PathSchema } 行（§3，N1+N2 双愈）
      [改造] 分段装配规范化（§3.1 布局冻结）
      [替换] 三处错误消息尾串 → 见 #44（§5）
  → domains/<d>/generated.ts → CLI 写盘/--check（collect.ts / cli.ts 零改动）
```

新文件 1 个（`src/protocol-surface.ts`，协议导出面事实的内部冻结局域），改动文件 3 个（`emitter.ts`、`README.md`、`package.json`〔v1.2 增补：硬门禁 9 patch bump〕）。

---

## §3 N1+N2：恒定协议 import 行（含零别名域）

### §3.1 发射形态冻结（布局不变式）

**不变式：任意合法域（含零别名域、含 0 字段 ROOT）的生成物 = 四段构成——头注 / import 行 / 段②别名声明（0..n 行）/ 段③增广块；相邻非空段之间恰一个空行；段②为唯一可为空的段，空时连同其分隔空行消失。**

具名别名域（SA6 `ALIAS_FIXTURE` 形态）：

```
 1 |/**
 2 | * GENERATED FILE — DO NOT EDIT.
 3 | * Generator: @nomicore/vfsl-codegen@<version>
 4 | * Source hash: sha256:<hash>
 5 | * Regenerate with: pnpm generate
 6 | */
 7 |                                  ← 空行
 8 |import type { PathSchema } from '@nomicore/vfsl-protocol';
 9 |                                  ← 空行
10 |/** <aliasDocs（如有）> */
11 |export type Box = { 'n': PathSchema<number, 'leaf'> };
12 |                                  ← 空行
13 |declare module '@nomicore/vfsl-protocol' {
14 |  interface VfslPathMap {
15 |    label: PathSchema<string, 'leaf'>;
16 |    box: PathSchema<Box, 'map'>;
17 |  }
18 |}
```

零别名域（SA6 `ZERO_ALIAS_FIXTURE` 形态）：头注 / 空 / import / 空 / `declare module` 块——**无双空行**（现状产物 L7-8 双空行属段②空置残留，本票随装配改造一并规范化；仓内零生成物、零迁移成本，探针实证见 §11-A）。

import 行文本逐字冻结（AC-2 契约锚）：

```ts
import type { PathSchema } from '@nomicore/vfsl-protocol';
```

**满足 SA6 三个断言锚**：首非注释行（`firstCodeLine` 剥头注块后首个非空行）= 该行 ✓；全文恰一条（`/^import type \{ PathSchema \} from '@nomicore\/vfsl-protocol';$/gm` 恰一命中）✓；孤立 program 零诊断（§11-A/B 探针）✓。

### §3.2 「恒定」语义（SA8 提示 3 边界）

- **恒定 = 无条件**：不判断域形态、别名数、字段数、是否引用 `PathSchema`——一律发射。理由：
  1. **N2 治愈需要**：零别名域（ADR-0003 最小合法域）段② 为空，任何 top-level import（含 `import type`）是令文件成为 module 的最小充分手段；module 内 `declare module '<已解析模块>'` 才恢复增广语义（SA5 p2-fixed exit 0 实证）。
  2. **增广目标入 program 需要（与字段数无关）**：0 字段 ROOT（`type ROOT = YMap<{}>` / `type ROOT = {}`，探针实证 parse/evaluate 放行）的生成物仅剩头注 + 空增广块，仍需 import 行提供模块性与增广目标——探针实测三形态 post-N1 全部零诊断（§11-A）。
  3. **script 形遮蔽与 PathSchema 引用无关**：script 内 `declare module '@nomicore/vfsl-protocol'` 整体遮蔽 paths 解析的真实协议模块——同 program 一切协议消费方 TS2305，**不需要**生成物自身引用任何协议名（SA5 p2 的 consumer 侧证据）。
- **恒定的边界（SA8 提示 3）**：锚定的仅是 import 行的恒定存在这一**模块级接线**。类型树形状零变化——不触 ADR-0004 §8.3 映射表任何一项（Record 通配层 / 标记→kind / Pattern→string / YXmlFragment→string / ref→别名引用 / docs→TSDoc），不触 D5 路径形状（顶层键 = ROOT 字段、无 ROOT 前缀）。import 行不参与任何类型计算（探针：无碰撞基线域 post-N1 零诊断 + 段③ 成员类型解析不变，§11-A/C）。

**`import type` 且仅导入 `PathSchema` 一个名的理由**：生成物当前唯一引用的协议名是 `PathSchema`（emitter 全部引用位 L190 单点）；type-only + 单名 = 最小文件作用域占用（其余 11 名不进入文件作用域，把 N3 碰撞面压到最小——守卫仍全量覆盖，见 §4.2）；type-only 保证零运行时发射，与 ADR-0004 D3「编译后为空模块」对齐，verbatimModuleSyntax 安全。

### §3.3 双愈机理

同一行 import 同时治愈 N1/N2：

- **N1**：`PathSchema` 名字绑定到协议导出（TS2304 消除）；import 使增广目标模块进入 program（TS2664 消除）。
- **N2**：文件恒为 module → `declare module` 恒为增广（非整体环境声明）→ 不遮蔽真实协议模块 → 同 program 消费方正常解析。

### §3.4 确定性与 CI 保鲜（SA8 提示 1 落实）

- 新增发射为**常量行**，装配为纯字符串分段 join——同（输入, 包版本）→ 逐字节同输出，原 F2 设计（`task_vfsl-codegen_design.md`）§3.0 纯发射器纪律与 CI regen-diff 前提不破（既有确定性断言 `expect(emit()).toBe(emit())` 不受影响）。
- **SA8 提示 1（生成器行为变更须与既有生成物再生成同票原子提交）**：本仓**现无任何入仓生成物**（`find . -name 'generated.ts' -not -path './node_modules/*'` → 空；`domains/` 目录不存在）→ 再生成步骤为空操作，原子提交要求空转成立。AC-5 的 `pnpm generate --check --allow-empty-domains`（零领域集 + flag → exit 0，cli.ts:63-64 机制）即机制兜底。**SA3 无需再生成任何仓内文件**；若实现时仓内出现 domains/（不应发生），按 ALLOW LIST 外文件报阻塞而非静默扩 scope。

### §3.5 伪代码（generateProjection 装配改造）

```ts
// emitter.ts —— L105-120 的 ROOT 形态/值校验块【不变】之后：

// N3 守卫（§4）：段② 发射前置检查——别名名 × 协议导出面碰撞 → 命名化响亮失败
assertNoProtocolNameCollision(derived.aliases);

// 段② 具名别名声明（声明序 = aliases 键序；ROOT 除外；未引用的别名也发射【既有行为不变】）
const aliasLines: string[] = [];
for (const name of Object.keys(derived.aliases)) {
  if (name === 'ROOT') continue;
  aliasLines.push(emitAlias(name, tables));
}

// 段③ 增广载体（D5：顶层键 = ROOT 的字段，路径无 ROOT 前缀【逐行搬移，逻辑不变】）
const augmentationLines: string[] = [];
augmentationLines.push(`declare module '@nomicore/vfsl-protocol' {`);
const rootDoc = tsdocLines(derived.aliasDocs['ROOT'], '  ');
if (rootDoc !== '') augmentationLines.push(rootDoc);
augmentationLines.push('  interface VfslPathMap {');
for (const field of root.fields) {
  augmentationLines.push(emitInterfaceMember(field, rootValue, tables));
}
augmentationLines.push('  }');
augmentationLines.push('}');

// §3.1 布局冻结：头注 / import 行 / 段② / 段③，相邻非空段恰一空行（段②空时连空行消失）
const sections = [
  [buildHeader(opts?.sourceText)],
  [PROTOCOL_IMPORT_LINE],
  aliasLines,
  augmentationLines,
].filter((section) => section.length > 0);
return `${sections.map((section) => section.join('\n')).join('\n\n')}\n`;
```

---

## §4 N3：别名 × 协议导出面碰撞守卫

### §4.1 守卫对象域 = 协议包实测导出面（冻结 12 名）

`packages/vfsl-protocol/src/index.ts` 实测导出（grep `^export` 与 SA6 `protocolExportNames()` checker 枚举逐名一致，probe5/probe12 双源核实）：

```
VfslKind, PathSchema, UnknownPath, RootSchema, PathAt, VfslValueOf,
PathValue, PathKind, PathPatchValue, PathElementValue, VfslTypedAccess, VfslPathMap
```

**冻结名单而非运行时枚举**：协议包是纯类型模块（ADR-0004 D3「全部内容为类型空间产物……零运行时代码」）——运行时无可枚举面（`Object.keys` 取不到，SA6 头注实证），生产发射器不得依赖 typescript 编译器 API（devDependency，引入即破坏包依赖纪律）。**同步锚（增名方向单向，v1.1 披露——SA2 #4）**：SA6 `generate-alias-collision-guard.test.ts` 用 checker 实测枚举导出面逐一作碰撞别名断言必抛——协议导出面**增名**而冻结名单未跟 → 实测新名不抛 → silent 清单非空 → 测试红；**删名方向不红**（名单残留 → 守卫过度拦截，fail-closed 无害——单向性完整披露见 §4.5）。名单更新点 = `protocol-surface.ts` 单点。

**名单数据源纪律（SA5 锚点 2）**：以实测 12 名为准，不凭 D3 段落回忆——ADR-0004 D3 原文仅列 **7 名**（`PathSchema/PathAt/PathValue/PathKind/UnknownPath/VfslPathMap/VfslTypedAccess`），未列全者实为 **5 名**：`VfslKind/RootSchema/VfslValueOf/PathPatchValue/PathElementValue`（v1 误作 4 名、漏 `VfslKind`——v1.1 勘误，SA2 #1）。

### §4.2 为什么全 12 名——两作用域完备性 + 实证分层

生成物引入自由标识符的作用域恰有两个，协议导出面在两个作用域里**全部在场**。碰撞面完备性按「**生成物发射的全部自由标识符 × 两作用域**」枚举——v1.1 按 SA2 #2/#3 重写论据链（结论不变，v1 论据部分失实）：

- **别名名**（领域作者唯一可控的自由标识符）——本守卫域（× 协议导出面 12 名）。
- **生成器内建标识符**（映射表层自带、非领域可控）：`Record` 与标量名 `string/number/boolean` 等——别名撞它们由 **parse 层保留名集合 `RESERVED_NAMES` 在方言层封死**（`packages/vfsl/src/parser.ts:77`，16 名：`type/Record/Pattern/string/number/boolean/null/unknown/any/extends/interface` + 六标记名；命中即 `parser.ts:232-233` → E303「别名名占用保留名」。SA2 复证：别名 `Record/string/number/boolean/unknown` 逐一拒收）。注意 **`ROOT` 不在该集合**——ROOT 是 ADR-0003 的独立根别名约定（每模块恰一个 map 形 ROOT，非别名侧可声明名）。
- **字段/成员名**：顶层接口成员 identifier 形**不加引号**（emitter.ts:172 条件引号——`label: PathSchema<…>`），嵌套成员恒加引号（emitter.ts:260）——但成员名处于**属性名声明位**而非类型引用位，不进入类型标识符解析作用域，两种引号形态均无碰撞面（v1「字段名一律发射为带引号字符串键」措辞失实——SA2 #2②/#3，结论侥幸不受影响）。
- **parse 放行的其余全局名**（`Array/Object/Function/Symbol/Partial/ReadonlyArray` 等）：生成器从不发射这些名 → 别名撞它们无碰撞面（SA2 探针实证：引用形态 post-N1 孤立编译零诊断）。此「无害性」前提锚定于**当前映射表不发射新的全局标识符**——未来映射表若新增全局名发射（如 `Partial<…>`），前提被击穿，须重开设计（守护锚构想见 SA2 评审红灯思路 #2，本票不纳入）。

故守卫域 = 别名名 × 协议导出面，覆盖领域可控侧全部碰撞面；生成器侧标识符或被 parse 层保留名封死（`Record`/标量名）、或与守卫域重合（`PathSchema` import 绑定 ∈ 12 名）、或处于非类型引用声明位（成员名）、或生成器根本不发射（`Array` 等）——**无第三碰撞面**：

| 作用域 | 协议名在场方式 | 碰撞机理 |
|---|---|---|
| 文件作用域 | import 绑定 `PathSchema`（§3.2 最小化后仅 1 名） | 别名 `export type PathSchema` 与 import 绑定同声明空间 → **TS2440** |
| 段③ 增广作用域（`declare module '@nomicore/vfsl-protocol' {}` 体内） | 被增广模块的**全部 12 个导出**（TS 语义：增广体内标识符解析优先命中被增广模块的导出） | 段③ 引用别名名解析到协议导出：泛型名实参位数不符 → **TS2314**；非泛型名位数恰好匹配 → **编译干净但静默绑错符号** |

**设计期探针实证（post-N1 形态 = 生成物前置 import 行，模拟修复后产物；12 名逐一 + 基线，§11-B/C 全表）**：

| 碰撞名（引用形态，SA6 fixture 同构） | post-N1 孤立编译 | 机理 |
|---|---|---|
| `PathSchema` | ✗ TS2440（Import declaration conflicts with local declaration） | 文件作用域 import 绑定 vs 本地 export 冲突 |
| `PathAt` `VfslValueOf` `PathValue` `PathKind` `PathPatchValue` `PathElementValue` `VfslTypedAccess` `UnknownPath` `RootSchema`（9 泛型名） | ✗ TS2314（`Generic type '<名><…>' requires N type argument(s)`，段③ 行） | 增广作用域解析优先绑协议泛型导出 |
| `VfslKind` `VfslPathMap`（2 非泛型名） | ✓ 编译干净，**但 checker 实证段③ 类型实参声明于 `packages/vfsl-protocol/src/index.ts` 而非本地别名** | 同上作用域优先级；非泛型 → 位数匹配 → 编译过、成员类型静默指向协议类型，路径投影语义损坏 |
| 对照：`Box`（非碰撞名） | ✓ 且绑定本地别名（声明于生成物自身） | 正常基线 |
| 对照：无碰撞基线域 | ✓ 零诊断 | §3 形态基线 |

**结论：12/12 全部有害——10 名硬编译错误 + 2 名静默语义损坏**。后两名是最险类：`tsc` 看不见、`--check` regen-diff 只比内容不审语义、显影在 G 票消费接线的下游类型行为里。守卫域「别名名 × 全部 12 名」= 两个作用域碰撞面的**完备**覆盖，无冗余、无遗漏——这是全量拦截的架构依据（而非仅「未来-proofing」）；SA6 红灯（12 名逐一必抛）恰锚定此完备域。

**未引用形态（惰性积木，ADR-0003 合法）同样按声明名拦截**（探针 §11-D）：未引用的 `PathSchema` 仍 TS2440（import 绑定冲突与引用无关）；未引用的其余 11 名编译干净但域生成物导出面与协议导出同名遮蔽，且一旦 schema 演进把该别名接进 ROOT 子树（合法演进、零文本警示）即落入上表 12/12 有害面。声明期拦截 = 演进安全 + 遮蔽消除，且是 SA6 引用形态断言的超集（引用形态含于声明形态，测试绿灯不受影响）。

### §4.3 错误类与独立错误码（SA8 提示 2 落实）

```ts
// emitter.ts —— 与既有三类发射期错误（UnsupportedRootShapeError 等）同构、相邻放置
export class AliasProtocolExportCollisionError extends Error {
  /** 独立错误码（AC-3）：生成器发射层命名空间，见 §4.3 三码族隔离表 */
  readonly code = 'alias-protocol-export-collision';
  /** 全部碰撞别名（声明序，确定性） */
  readonly aliases: readonly string[];

  constructor(aliases: readonly string[]) {
    super(
      `领域别名与协议导出名碰撞：${aliases.map((a) => `'${a}'`).join('、')}` +
        '——生成物以模块增广方式接线协议，增广体内别名名会解析到协议导出' +
        '（泛型名 → 生成物编译错误；非泛型名 → 静默绑定协议类型、路径投影语义损坏）；' +
        `'@nomicore/vfsl-protocol' 的导出名不得作领域别名，请重命名领域别名`,
    );
    this.name = 'AliasProtocolExportCollisionError';
    this.aliases = aliases;
  }
}
```

三码族隔离（SA8 提示 2「与 parse 层 E 码空间可区分」）：

| 层 | 码载体 | 形态 | 例 | 与新码可区分依据 |
|---|---|---|---|---|
| parse 层（v1 规格 §4，21 码冻结） | `VfslIssue.message` 冻结前缀（PRD #3：无独立 code 字段） | `VFSL-E<3位数字>` | `VFSL-E106: …` | 新码为 kebab 短语：无 `VFSL-` 前缀、无 `E<数字>` 形态段——正则与词形双重不相交 |
| SchemaSource 接缝层（@nomicore/vfsl） | `SchemaSourceError.code`（3 值闭合联合 `SchemaSourceErrorCode`） | 2 词 kebab | `missing-directive` / `dialect-mismatch` / `unknown-id` | 新码 ∉ 三值（SA6 断言硬锚 `EXISTING_SCHEMA_SOURCE_CODES`）；语义域不同（接缝 = 信封/装载，新码 = 发射期命名守卫） |
| **生成器发射层（本票新增，本层首个码）** | `Error.code`（生成器抛错对象属性） | 完整短语 kebab `<主体>-<对象>-<病症>` | `alias-protocol-export-collision` | —（码值全仓唯一，CLI stderr 可 grep） |

命名规约注记（写入 `protocol-surface.ts`/错误类文档注释）：生成器层后续新码沿用「完整短语 kebab」形态并须与既有两族错开——三族词形可机械判别（`VFSL-E\d+` 前缀 / 接缝闭合联合 / 发射层短语）。

**消息要求**（SA6 断言）：`err.message` 含碰撞别名名（`toContain('PathSchema')`）✓；`code` 为非空 string ✓；`∉` 接缝三码 ✓。多重碰撞一次性全列（声明序 join `、`）——优于首错即抛的单点诊断，且确定性保持。

### §4.4 守卫位置与检查次序（冻结）

```
generateProjection:
  1. ROOT 形态/值校验（L105-120，不变）        ← 入口合法性优先（既有次序零重排）
  2. assertNoProtocolNameCollision(aliases)   ← 新增：命名合法性，先于一切发射（失败零产出）
  3. 装配（§3.5）
```

- 次序理由：入口形态错误（ROOT 不可投影）先于命名错误（投影产物不合法）——与既有检查序一致，不引入新的次序语义；碰撞与 ROOT 形态错误并存的域得到 ROOT 形态诊断（确定性）。
- 守卫体：

```ts
/** N3（§4）：段② 发射前置守卫。ROOT 不在协议导出面（ROOT 是 ADR-0003 根别名约定、非别名侧可声明名），集合成员测试天然排除，无需特判。 */
function assertNoProtocolNameCollision(aliases: Record<string, StructureNode>): void {
  const collisions = Object.keys(aliases).filter((name) => PROTOCOL_EXPORT_NAMES.has(name));
  if (collisions.length > 0) throw new AliasProtocolExportCollisionError(collisions);
}
```

- 不重复检查 parse 层保留名：别名撞方言保留名在解析层已拒（`RESERVED_NAMES` 16 名——六标记 + `Record`/`Pattern`/`type`/`extends`/`interface`/原始类型名，parser.ts:232-233 → E303，单一真相；`ROOT` 不在集合，属 ADR-0003 独立根约定，非别名侧可声明名），发射层不二次裁决——守卫对象域仅协议导出面（Owner 裁定 2 字面）。（v1 括注「ROOT + 标记类型」双重失实——v1.1 修正，SA2 #2③）

### §4.5 新内部模块 `src/protocol-surface.ts`（伪代码全文）

```ts
/**
 * 协议包导出面事实（issue #45 冻结快照）——发射器接线行与碰撞守卫名单的单一数据源。
 *
 * - 冻结依据：packages/vfsl-protocol/src/index.ts 实测导出 12 名（2026-08-21 基点 5907dc3）。
 * - 为何冻结名单：协议包是纯类型模块（ADR-0004 D3，零运行时导出），运行时不可枚举；
 *   生产发射器不得依赖 typescript 编译器 API。
 * - 同步锚（单向，v1.1 披露——SA2 #4）：test/generate-alias-collision-guard.test.ts 经
 *   checker.getExportsOfModule 实测枚举导出面逐一作碰撞别名断言必抛——协议导出面
 *   【增名】而本名单未跟 → 实测新名不抛 → silent 清单非空 → 该测试红。
 *   【删名】方向不红：名单残留条目 → 守卫过度拦截（fail-closed 方向，无害）。
 *   可选双向锚（protocolExportNames() 实测面 ⊆ 本名单，一行断言）见 SA2 评审
 *   红灯思路 #4——本票不纳入（避免测试锚/文件范围变动），SA4/SA7 可评估。
 *   名单更新只改本文件一处。
 */
export const PROTOCOL_EXPORT_NAMES: ReadonlySet<string> = new Set([
  'VfslKind', 'PathSchema', 'UnknownPath', 'RootSchema', 'PathAt', 'VfslValueOf',
  'PathValue', 'PathKind', 'PathPatchValue', 'PathElementValue', 'VfslTypedAccess', 'VfslPathMap',
]);

/** N1+N2 恒定接线行（AC-1）：头注之后第一行代码，任意域（含零别名域）无条件发射（§3）。 */
export const PROTOCOL_IMPORT_LINE = "import type { PathSchema } from '@nomicore/vfsl-protocol';";
```

`emitter.ts` 顶部：`import { PROTOCOL_EXPORT_NAMES, PROTOCOL_IMPORT_LINE } from './protocol-surface.js';`（仓内 ESM 相对导入惯例，同 `./header.js`）。

### §4.6 CLI 通道零改动论证

新错误沿既有冒泡通道直达：`generateProjection` throw → `collect.ts:78 projectionText` 裸调用（无 catch）→ `collectProjections` → CLI `main()` → 顶层 `.catch`（cli.ts:159-164）→ `printStructuredError`。非 `SchemaSourceError` → 泛 Error 分支（cli.ts:150-153）读 `err.code`（string）打印 `vfsl-codegen: [alias-protocol-export-collision] <消息>` + **exit 2**——SA6 CLI 断言（exit 2、`/\[[A-Za-z0-9_-]+\]/`、含 `PathSchema`）全部由既有代码满足，**cli.ts / collect.ts 零改动**。

**被否决的替代方案**（SA2 预答辩）：
1. ~~parse 层新 E 码~~——v1 规格 §4 错误表冻结 21 码（ADR-0003 后果），加 E312 违反冻结；且碰撞是投影产物关注点，协议名对 parse 层无语义（关注点分层）。
2. ~~生成物侧静默改名/加前缀规避碰撞~~——违反「ref → 别名引用（按名）」映射契约（ADR-0004 后果：类型树形状 = 生成契约）与拒绝虚假降级立法：产物名是消费方契约面，静默改名 = 假装合法；正确职责切分是协议名固定（ADR-0004 冻结）、领域别名是自由变量，由 schema 作者改名（错误消息即此指引）。
3. ~~仅拦可编译破坏子集（10 名）~~——放走 2 名静默语义损坏（最险类，§4.2），且 SA6 红灯锚定 12 名全量。

---

## §5 AC-4：三处错误消息尾串替换

`emitter.ts` 内 `由总控开后续票登记` 共 4 处（grep 实证）——三处消息串 + 一处文档注释：

| 位点 | 归属 | 现文本（尾段） | 新文本（尾段） |
|---|---|---|---|
| emitter.ts:39 | `UnsupportedRootShapeError` 消息串 | `…成员并集语义，由总控开后续票登记` | `…成员并集语义，见 #44` |
| emitter.ts:58 | `UnsupportedRootReferenceError` 消息串 | `…引用目标语义，由总控开后续票登记` | `…引用目标语义，见 #44` |
| emitter.ts:76 | `UnsupportedUnionKindError` 消息串 | `…联合语义，由总控开后续票登记` | `…联合语义，见 #44` |
| emitter.ts:50 | `UnsupportedRootReferenceError` 的 JSDoc 文档注释 | `…扩展由总控开后续票登记。` | `…扩展见 #44。` |

- **AC-4 字面 = 上表前三行**（Owner 裁定 3「三处」；SA5 E8 定位）。L50 为注释非消息、零行为面，**设计裁定一并同步**：同一 stale 引用（后续票已存在 = #44）留一半不换会使消息与文档自相矛盾——SA3 顺带完成，验证判据 `grep -c '由总控开后续票登记' packages/vfsl-codegen/src/emitter.ts` = 0。
- **尾串必为消息最后字符**（无句号/引号尾随）——SA6 `endsWith('见 #44')` 与 CLI `stderr.trim().endsWith(TAIL)` 锚定。
- **前缀零触碰**：既有契约断言 `/ROOT 形态不支持/`、`/ROOT 不可被引用/`、`/联合成员结构 kind 异形/`（generate-discriminated-emission.test.ts:106/121/150，前缀正则）不受影响——SA5 锚点 3「尾串替换零既有测试风险」经本设计逐条核对成立。

---

## §6 既有测试冲击面（AC-5 零回归论证，逐文件断言风格实测核对）

| 测试文件（现状绿） | 断言风格（实测） | import 行影响 | 守卫影响 |
|---|---|---|---|
| `generate-mapping-table.test.ts`（13） | 全部 `toContain`/`toMatch` 正则/布尔 helper；负例 `/^\s*['"]?ROOT['"]?\s*:/m`（import 行不匹配）；`/**`/`*/` 配平计数（import 行无注释记号） | 零破坏 | fixture 别名 `Entity/Id/Meta` ∉ 12 名 → 不可达 |
| `generate-discriminated-emission.test.ts`（10） | 头注正则 + 确定性自相等（`expect(emit()).toBe(out)` / `.toBe(emit())`，同输入自相等不受常量行影响）+ 字段正则 + 三错误**前缀**正则 | 零破坏 | fixture 别名 `Entity/A/B/U/Node` ∉ 12 名 → 不可达 |
| `generate-cli-check.test.ts`（3） | 退出码断言；generate→--check 两侧同走新发射器（import 行两侧一致 → diff 空） | 零破坏 | fixture 别名 `Extra` ∉ 12 名；`demo` 零别名域 → 守卫空过 |
| `generate-discriminated-narrow.test-d.ts` | **静态手写参照样板**，不消费生成物输出（SA5 未读项，本设计已读核实闭合） | 零关联 | 零关联 |
| 其余 371（vfsl / vfsl-protocol 包） | 不触 codegen | 零关联 | 零关联 |

AC-5 其余两条：`pnpm typecheck`（三包 tsc -p）——emitter 新增常量/类/文件为平凡类型安全代码，SA6 已实证当前测试文件集下 `tsc -p packages/vfsl-codegen/tsconfig.json` exit 0；`pnpm generate --check --allow-empty-domains`——零领域集 + flag → exit 0（§3.4）。

---

## §7 验收锚定：AC ↔ SA6 红灯 → 绿灯机理

| AC | SA6 红灯（文件/条数） | 设计章节 | 绿灯机理（红灯断言 → 本设计供给） |
|---|---|---|---|
| AC-1 | `generate-protocol-import.test.ts` ① 5 条 | §3 | 首非注释行 = import 行（§3.1 布局冻结）；孤立 program 零诊断（import 绑定 + 增广目标入 program）；零别名 + consumer 同 program 零诊断（module 性 → 增广语义恢复） |
| AC-2 | 同①（文案锚即契约断言：恒定存在 + 恰一条） | §3.1/§3.5 | 常量行单点发射（`PROTOCOL_IMPORT_LINE`），装配结构保证恰一条 |
| AC-3 | `generate-alias-collision-guard.test.ts` ② 4 条 | §4 | 12 名逐一必抛（§4.1 守卫域 = 实测导出面全集）；独立 `code`（§4.3，∉ 接缝三码）；消息含别名名；CLI exit 2 + `[<code>]` + 别名（§4.6 既有通道零改动） |
| AC-4 | `generate-error-message-tail.test.ts` ③ 4 条 | §5 | 三消息尾串 `见 #44`（前缀零触碰）；CLI stderr 尾串同锚 |
| AC-5 | 全量回归（408 既有 + 13 新）+ typecheck 三包 + generate --check | §3.4/§6 | 冲击面逐文件零破坏论证 + 确定性保持 + 零领域集 exit 0 机制 |

---

## §8 SA8 三项非阻塞提示逐条回应

| # | 提示（conflict_report.md「给下游 SA 的非阻塞提示」） | 落实 |
|---|---|---|
| 1 | ADR-0005 §4 一致性：生成器行为变更与既有生成物再生成同票原子提交；SA3 勿漏再生步骤 | §3.4：仓内零生成物（find 实证）→ 再生步骤空转成立；AC-5 `--check` = 机制兜底；SA3 若见仓内 domains/ 出现即报阻塞（ALLOW LIST 外） |
| 2 | AC-3 错误码与 parse 层 E 码空间（21 码）可区分 | §4.3 三码族隔离表：`alias-protocol-export-collision` 为 kebab 短语，与 `VFSL-E<nnn>` 前缀/词形、接缝层闭合联合三重不相交；SA6 断言硬锚 ∉ 接缝三码 |
| 3 | AC-1/AC-2「恒定」语义：锚定 import 行恒定存在，不触 ADR-0004 §8.3 映射表与 D5 路径形状 | §3.2：恒定 = 无条件发射这一模块级接线；类型树形状零变化（探针基线零诊断 + 成员类型解析不变，§11-A/C）；ADR-0004 §8.3 六项映射逐项未触 |

---

## §9 边界条件与风险自检

| 边界/风险 | 判定 | 依据/处置 |
|---|---|---|
| 零别名域（ADR-0003 最小合法域） | 恒定 import 治愈 | §3.2；SA5 p2-fixed + 探针零别名 post-N1 零诊断（§11-A） |
| 0 字段 ROOT（`YMap<{}>` / `{}`） | 同上（增广块空仍需模块性 + 增广目标） | 探针三形态 post-N1 零诊断（§11-A） |
| 多重碰撞（≥2 别名同撞） | 一次全列（声明序，确定性），不首错即抛 | §4.3 消息构造 |
| 碰撞 + ROOT 形态错误并存 | ROOT 形态诊断先出（次序冻结） | §4.4 |
| 未引用碰撞别名（惰性积木） | 按声明名拦截（超集）：`PathSchema` 未引用仍 TS2440；其余名构成导出面遮蔽 + 演进不安全 | §4.2；探针 §11-D |
| `--check` 对碰撞域行为变化：exit 0（E5 实测）→ exit 2 | **有意的行为增强，本设计披露**：新鲜度比较一个不该存在的产物无意义；内容缺陷先于 diff 判定（守卫在生成路径上，`--check` 同走 `collectProjections`） | §4.6；SA6 CLI 断言仅锚生成路径，`--check` 碰撞域无既有断言（grep 实测） |
| 协议导出面未来**增名**（+第 13 名） | 冻结名单未跟 → SA6 实测枚举出新名不抛 → 红；更新点单点（protocol-surface.ts） | §4.1 同步锚（增名方向） |
| 协议导出面未来**删名** | 名单残留 → 守卫过度拦截（fail-closed 无害），测试**不红**——单向性已披露；可选双向锚（SA2 红灯思路 #4）归 SA4/SA7 评估 | §4.5 头注（v1.1） |
| 确定性 / regen-diff | 常量行 + 纯分段 join，同输入同输出；仓内零生成物零迁移 | §3.4 |
| 包版本 bump | **必需——硬门禁 9：行为变更包 patch bump**：`0.1.0` → `0.1.1`；头注 Generator 行经 header.ts 自同步随之变化，零入仓生成物 → regen-diff 零迁移；无测试硬编码版本串（SA4 grep 实证零命中）。〔v1「非必需」与硬门禁 9 矛盾——v1.2 更正，SA4 回流项〕 | header.ts 自同步机制；SA4 硬门禁 9 复核（Generator 行随 bump 更新探针实证 + `--check` exit 0） |
| 新 throw 的未捕获面 | 无：生产唯一 caller 链终点 = CLI 顶层 catch（§12 全集审计） | §12 |
| `import type` 与 `verbatimModuleSyntax` / `isolatedModules` | type-only 导入不受两开关限制 | 仓 tsconfig 现行 + 协议包自身同款用法 |

---

## §10. 文件清单（File Scope）

### ALLOW LIST

- `packages/vfsl-codegen/src/emitter.ts` — 修改：§3.5 分段装配 + import 行接线、§4.3/§4.4 错误类 + 守卫、§5 三尾串 + L50 注释同步（净增约 +40 行）
- `packages/vfsl-codegen/src/protocol-surface.ts` — 新建：协议导出面事实内部模块（12 名冻结名单 + import 行常量，约 35 行，§4.5）
- `packages/vfsl-codegen/README.md` — 修改：工具层限制节补碰撞守卫一行（错误码 + 重命名指引）、生成物形态提恒定 import 行（≤6 行，行为变更的文档同步）
- `packages/vfsl-codegen/package.json` — 修改：version `0.1.0` → `0.1.1`（**硬门禁 9：行为变更包 patch bump**。v1.2 增补——v1 漏列，SA4 回流项：SA3 的 bump 合规且经复核零风险——头注 Generator 行自同步、零入仓生成物零迁移、无测试硬编码版本串）
- `packages/vfsl-codegen/test/generate-protocol-import.test.ts` — `[SA6 owned]` 红灯契约①。SA3 仅可修测试基础设施（fixture 隔离/清理），断言逻辑禁改
- `packages/vfsl-codegen/test/generate-alias-collision-guard.test.ts` — `[SA6 owned]` 红灯契约②。同上纪律
- `packages/vfsl-codegen/test/generate-error-message-tail.test.ts` — `[SA6 owned]` 红灯契约③。同上纪律
- `packages/vfsl-codegen/test/tsc-helper.ts` — `[SA6 owned]` 三契约共享辅助。同上纪律

### DENY LIST

- `packages/vfsl-protocol/src/index.ts` — 协议导出面是守卫数据源，禁止为绕守卫增删导出；D3 纯类型纪律（零运行时代码）禁止加运行时名单
- `packages/vfsl/src/**` — parse/evaluate 契约冻结（21 E 码 + 派生 schema 七槽输入形状），本票缺陷全在发射层
- `packages/vfsl-codegen/src/cli.ts` — CLI 通道零改动（§4.6：printStructuredError 已具 code 前缀分支 + 顶层 catch exit 2）
- `packages/vfsl-codegen/src/collect.ts` — 编排层零改动（新错误沿既有冒泡通道）
- `packages/vfsl-codegen/src/header.ts` — 头注形态与版本自同步机制不变
- `packages/vfsl-codegen/src/index.ts` — 公共导出面保持最小（`generateProjection` + options；错误类不进公共面——与既有三类错误一致的处理）
- `docs/adr/**`、`docs/vfsl/v1-spec.md` — 冻结面
- `tests/acceptance/**` — 本票不动

---

## §11. 协议假设依据 (Protocol Assumption Evidence)

设计期探针（tsx 直驱仓内真管线 `parseVfsl → evaluate → generateProjection`，生成物前置 import 行模拟 post-N1 形态，仓内 typescript `createProgram` + `getPreEmitDiagnostics`，编译选项与 SA6 `tsc-helper.ts` 同款）：

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险 |
|---|---|---|---|---|
| A | 任意 top-level import（含 `import type`）使文件成 module；module 内 `declare module` 为增广；0 字段/零别名形态同样需要且充分 | 设计期实测验证 | `/tmp/sa1-i45/probe-edge.mjs`：zero-alias / `YMap<{}>` / `{}` 三形态 post-N1 孤立编译均零诊断；SA5 p1-fixed/p2-fixed（子进程 tsc）exit 0 | 低 |
| B | 增广体内标识符解析优先命中被增广模块导出（本地别名被遮蔽）：9 泛型名 → TS2314；`PathSchema` → TS2440；`VfslKind`/`VfslPathMap` → 编译干净 | 设计期实测验证 | `/tmp/sa1-i45/probe12.mjs`：12 名逐一 + 基线，诊断码/行号全表（§4.2 已摘） | 低 |
| C | 两非泛型名编译干净但**绑错符号** | 设计期实测验证 | `/tmp/sa1-i45/probe-bind.mjs`：checker symbol 声明源——`VfslKind` 段③ 实参声明于 `packages/vfsl-protocol/src/index.ts`（TypeAliasDeclaration）；对照 `Box` 声明于生成物自身 | 低 |
| D | 未引用碰撞别名：`PathSchema` 仍 TS2440（import 绑定冲突与引用无关）；其余名编译干净 | 设计期实测验证 | `/tmp/sa1-i45/probe-unref.mjs`：三名未引用形态编译结果 | 低 |
| E | script 形（无 import/export）内 `declare module` 为整体环境声明，遮蔽 paths 解析的真实协议模块 | 现有测试引用 + 设计期实测 | SA5 p2（consumer TS2305×2）；SA6 红灯①零别名形态 3 诊断（本 worktree 基点复现） | 低 |
| F | 协议包实测导出面 = 12 名（冻结名单数据源） | 源码引用 + 现有测试引用 | `grep '^export' packages/vfsl-protocol/src/index.ts`（12 行逐名）；SA6 `tsc-helper.ts protocolExportNames()` checker 枚举 probe5 实测一致 | 低 |
| G | `createProgram` + `getPreEmitDiagnostics` ≡ `tsc --noEmit` 诊断面 | 现有测试引用 | `tsc-helper.ts` 头注（SA5 子进程 tsc 与 API 逐码一致，probe3）；SA6 红灯①编译锚即此载体 | 低 |
| H | CLI 对带 `code` 的 Error 打印 `[<code>]` 前缀并 exit 2 | 源码引用 | `packages/vfsl-codegen/src/cli.ts:150-153`（code 分支）、`:159-164`（顶层 catch exit 2） | 低 |

无进程/端口/时序类协议假设；本设计不含网络与跨进程资源生命周期假设。

---

## §12. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数

| 函数 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `generateProjection` | `packages/vfsl-codegen/src/emitter.ts:96` | `(derived, opts?) → string`；已含多类 throw 路径（UnsupportedRootShapeError ×2、ROOT 值缺失 Error、desync 家族、UnsupportedRootReferenceError、UnsupportedUnionKindError）；**碰撞别名 → 静默产出不可编译/静默损坏生成物** | 签名不变；**新增 throw 路径**：别名名 ∈ 协议导出面（12 名）→ `AliasProtocolExportCollisionError`（`code='alias-protocol-export-collision'`）；正常域输出文本新增恒定 import 行（返回值内容变化，类型不变） |

### Caller 清单

（`git grep -n '\bgenerateProjection\s*(' -- 'packages/**/*.ts'`（含未跟踪测试文件）全集；生产侧 1 + re-export 1 + 测试侧 **5 文件**——v1 前言误作 6，v1.2 勘误〔SA4 实测；下表 5 行测试 caller 即全集，表体本即正确〕）

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| CLI 编排 `projectionText` | `packages/vfsl-codegen/src/collect.ts:78` | 同步调用（外层 `collectProjections` 被 `main` await，cli.ts:59） | ❌ 裸调用 | ✅ `cli.ts:159-164` `main().catch` → `printStructuredError` → exit 2 | 既有通道零改动：非 SchemaSourceError → 泛 Error 分支打印 `[alias-protocol-export-collision]`（cli.ts:150-153 已具，§4.6） |
| 包公共导出 re-export | `packages/vfsl-codegen/src/index.ts:7` | N/A（导出语句） | N/A | N/A | 签名不变，零影响 |
| SA6 契约②测试 `captureCollisionError` | `test/generate-alias-collision-guard.test.ts:58` | 同步 | ✅ try/catch（断言必抛） | N/A | 新 throw 即期望行为（红灯→绿灯） |
| SA6 契约①测试 | `test/generate-protocol-import.test.ts:88/94/101` | 同步 | ❌（断言不抛） | N/A | fixture 别名 `Box`/零别名 ∉ 12 名 → 新 throw 不可达 |
| SA6 契约③测试 `captureError` | `test/generate-error-message-tail.test.ts:58` | 同步 | ✅ try/catch | N/A | fixture 别名 `X` ∉ 12 名；触发的是既有三错误（尾串断言对象） |
| 既有 mapping-table 测试 | `test/generate-mapping-table.test.ts`（3 处直调） | 同步 | ❌（断言不抛） | N/A | fixture 别名 `Entity/Id/Meta` ∉ 12 名 → 不可达 |
| 既有 emission 测试 | `test/generate-discriminated-emission.test.ts`（6 处直调） | 同步 | 部分（toThrow/not.toThrow） | N/A | fixture 别名 `Entity/A/B/U/Node` ∉ 12 名 → 不可达 |

### 风险评估

- **新 throw 触发面** = 「别名名 ∈ 冻结 12 名」：既有全部测试 fixture 别名逐一核对不在集合内（上表）；仓内零 `domains/` → 生产不可达。唯一新触发 = 用户声明碰撞别名——此前得到不可编译/静默损坏产物（exit 0 假绿），此后得到 exit 2 + 结构化 stderr，净改善。
- **无未捕获冒泡面**：生产唯一 caller 链终点为 CLI 顶层 catch（非 Promise 上下文 throw，无 unhandledRejection 面；`projectionText` 同步 throw 直接被 `main()` 返回 Promise 之外的调用栈…… 实为 async 函数体内 throw → Promise reject → `.catch` 捕获，通道同一）。
- **返回值内容变化**（import 行）：消费方 = 生成物文本的下游（CI regen-diff / 未来 G 票 dogfood）；仓内零入仓生成物 → 零迁移；既有测试断言风格逐文件核对零破坏（§6）。

---

## SA2 反馈逐条回应

**v1.1（2026-08-21）**：SA2 verdict = **pass**（`task_vfsl-codegen-hardening_sa2_review.md`），附 4 项非阻断文字级修订（攻击点 #1–#4，2 MINOR + 2 LOW），逐条落实如下。零行为决策/文件范围/测试锚变动（ALLOW LIST / DENY LIST / §12 caller 清单 / §11 证据表均未动）。

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| #1（MINOR）§4.1 D3 未列全名数勘误：v1 称 4 名，实测 D3 原文仅列 7 名、未列全者 5 名（漏 `VfslKind`） | ✅ | §4.1「名单数据源纪律」 | 改为 5 名并补 `VfslKind`；同时列明 D3 原文 7 名清单，消除「未列全」基数歧义（冻结名单 12 名本身不动） |
| #2（MINOR）「无第三碰撞面」论据链修正：未点名 parse 层 `RESERVED_NAMES` 封堵层；「字段名一律带引号」「ROOT + 标记类型」两处措辞失实 | ✅ | §4.2 完备性论证重写 + §4.4 括注 + §4.4 守卫 JSDoc | 论据链改为四类枚举：别名名（守卫域）/ 生成器内建名（`Record`/标量名——parse 层 `RESERVED_NAMES` 16 名、parser.ts:77/232-233 → E303 封死；`ROOT` 不在集合、属 ADR-0003 独立根约定）/ 字段成员名（顶层 identifier 形**不加引号** emitter.ts:172、嵌套恒加引号 emitter.ts:260——属性名声明位不进类型引用作用域）/ parse 放行全局名（`Array` 等——生成器不发射故无害，前提 = 映射表不新增全局名发射） |
| #3（LOW）§3.1/§4.2 内部一致性：「字段名一律带引号」与 §3.1 样例（顶层 `label:` 不加引号）自相矛盾 | ✅ | 随 #2 一并修正（§4.2 第三枚举项） | 删除「一律」措辞，如实区分顶层条件引号（identifier 形不加）/ 嵌套恒引号，附两处源码位点；与 §3.1 样例不再矛盾 |
| #4（LOW）§4.5 同步锚单向性未披露：增名方向红、删名方向不红（过度拦截 fail-closed 无害）且测试不红 | ✅ | §4.5 头注 + §4.1 同步锚句 + §9 边界表（拆增/删两行） | protocol-surface.ts 伪代码头注披露单向性 + 可选双向锚引注（SA2 红灯思路 #4，本票不纳入——避免测试锚变动，SA4/SA7 评估）；§4.1「同步锚（增名方向单向）」、§9 拆分增名/删名两行同步修正 |

（后续若再有 SA2 评审轮，按 SKILL §「SA2 反馈修订协议」在此表追加；ALLOW LIST 只增不删，caller 清单只增不删。）

## v1.2 处置记录（SA4 回流项，2026-08-21）

来源：SA4 评审 `task_vfsl-codegen-hardening_sa4_review.md` 硬门禁 9 附注「随附发现（回流 SA1，非阻断）」+ §1.1 文件比对附注（`package.json` 为唯一 ALLOW 外文件，属硬门禁 9 强制项，非 SA3 扩权）+ caller 计数实测。**SA4 verdict = pass**；SA3 实现已含 patch bump（`0.1.0` → `0.1.1`，git diff 实证）——本节为文档债清偿，零行为/零测试锚变动。

| # | 回流项 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|:--:|------|------|
| 1 | `packages/vfsl-codegen/package.json` 不在 §10 ALLOW LIST（SA3 bump 合规但设计文档滞后） | ✅ | §10 ALLOW LIST + §2 改动文件计数 | 增补该文件条目，标注「硬门禁 9：行为变更包 patch bump」（`0.1.0` → `0.1.1`）；§2「改动文件 2 个」同步更正为 3 个 |
| 2 | §9「包版本 bump 非必需」与总控硬门禁 9 直接矛盾 | ✅ | §9 边界表「包版本 bump」行 | 更正为「必需——硬门禁 9：行为变更包 patch bump」；保留自同步/零迁移/无硬编码版本串的安全性论证（SA4 复核结论随注），标注 v1 表述矛盾来源 |
| 3 | §12 caller 前言「测试侧 6 文件」计数失实（SA4 实测 git grep：生产 1 + re-export 1 + 测试直调 **5**） | ✅ | §12 Caller 清单前言 | 勘误为 5（v1 前言计数与表体 5 行不一致，表体本即全集）；注明 grep 口径含未跟踪测试文件 |
