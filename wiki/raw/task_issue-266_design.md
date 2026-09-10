# 设计 — issue #266：VFSL 内容寻址 schema ID（sc1-）：窄派生接口与 envelope 校验

> SA1 架构设计（dispatch `sa-35ad400b-ff6d-4e0e-a76a-e1f856131355`，iteration 0，phase design）。
> 输入：任务简报 `wiki/raw/task_issue-266.md`（Issue #266，open，Parent PR #158；Issue 评论
> REST 读取为空，无 Owner 追加要求）；SA6 验收契约 `wiki/raw/task_issue-266_sa6_contract.md`
> （含两个红灯契约测试文件与两份红跑日志）；SA8 冲突门禁
> `wiki/raw/task_issue-266_conflict_report.md`（verdict `clear`，附 B1/B2/B3 三项设计期边界
> 条件）；无 `task_issue-266_relevant_decisions.md`（首次迭代，SA6 §2 已确认不存在）、无
> `task_issue-266_sa2_review.md`（无评审输入）。
> 本设计只产出设计证据，不改任何生产代码或测试。

## 0. 设计结论摘要

1. **窄接口**：`@nomicore/vfsl` 公共面新增单值导出
   `deriveSchemaIdentity(text: string)` → `{ ok: true; semanticFingerprint; schemaId } |
   { ok: false; issues: VfslIssue[] }`，采纳 SA6 H1 假设签名原样（§7 D1）。内部复用
   `parseVfslImplementation` + `semanticFingerprintOf` + 新内部 Base32 编码件，**不跑
   evaluate**（§7 D2），不读不写 `compiledCache`，同步纯函数不抛错。
2. **sc1- 编码**：新内部叶子模块 `packages/vfsl/src/schema-id.ts` 承载
   `sc1-` + 52 位小写 RFC 4648 Base32（无 padding、pad 位为零）的编解码与 canonical
   判定；payload = semantic fingerprint 的完整 256-bit digest（不截断），与
   `sha256:v1:<64 hex>` 同 digest 信息（ADR 0015 L127-133）。不进公共面。
3. **envelope 强校验**：`envelope.ts` 注册表追加 `ENV_6`（sc1- canonical 格式错误）与
   `ENV_7`（sc1- digest 与 text 语义指纹不匹配）两个稳定码；`envelopeStrictGate` 在方言
   断言后追加 sc1- 格式步（envelope 相位、先于 parse）；`compileSchemaEnvelope` 在 parse
   成功后、evaluate 前执行 digest 精确匹配检查。旧式 id（非 `sc<digits>-` 族）路径
   零触及。`parseSchemaEnvelope`/`getCompiled` 义务面外、行为不变（§7 D6）。
4. **保留族触发器**：`sc<digits>-`（大小写不敏感）为内容寻址 ID 保留命名族；族内只有
   精确 `sc1-` + canonical payload 合法，其余（含 `SC1-`/`sc2-` 等仿冒形态）一律 ENV_6
   拒绝（§7 D3）。
5. **SA6 契约文件 1 存在一处 fixture 缺陷（必须修订轮修复，非本设计可落实项）**：
   `sc1-schema-id-envelope-validation.test.ts` L91 的「旧式 id」锚
   `id: 'sc1-fixture-anchor'` 以精确 `sc1-` 前缀开头，与本契约自身的 16 条红灯语义
   （任何 `sc1-` 前缀 id 必须强校验）结构性互斥——实现落地后该文件在模块收集期即失败，
   其 9 条「必须保持绿」的负控/绿锚全部不可满足。生产语义按 ADR 0015 L144 +
   CONTEXT.md L74 的规范义务裁决（任何 `sc1-` id 强校验）；测试侧需一轮 SA6 契约修订
   把锚 id 更名为非 `sc-` 族字符串（如 `fixture-anchor`），由 Controller 路由，SA1 不改
   测试（§14.1）。
6. **requiresConflictRecheck = true**：新增公共 API + envelope 相位新失败语义 + SA8 B1
   边界条件显式要求设计后复审（§16）。

---

## 1. 任务类型、目标和非目标

**类型：Feature**（ADR 0015「内容寻址 schema ID」+「测试决策」的 `@nomicore/vfsl` 包内
兑现切片；SA6 §2 同判）。

**目标**：

1. `@nomicore/vfsl` 新增窄 Module interface：输入 VFSL text（上下文常量 lang=vfsl、
   version=1），复用现有编译 pipeline，返回 semantic fingerprint 与内容寻址 schema ID，
   或 VFSL issues；不接收 provisional envelope ID，不暴露 IR、派生 schema、validator；
   不是 REST endpoint（ADR 0015 L119-125；简报 What to build 第 1 段）。
2. schema ID 冻结格式 `sc1-` + 52 位小写 RFC 4648 Base32（无 padding），payload 为
   semantic fingerprint 完整 256-bit SHA-256 digest，不截断，与 `sha256:v1:<64 lowercase
   hex>` 同 digest 信息（ADR 0015 L127-133）。
3. 完整 envelope 编译（`compileSchemaEnvelope`）对任何使用 `sc1-` 前缀的输入 envelope
   强制验证 canonical 格式及与 text semantic fingerprint 的精确匹配；格式错误与语义
   不匹配各用一个稳定 VFSL issue code（envelope 层注册表分配；SA8 B3）；旧式 SCHEMA id
   继续兼容（ADR 0015 L144）。
4. 敏感度规则继承 ADR 0007 L17 既有语义指纹定义：空白/普通注释不改 ID，JSDoc、声明顺序
   及其他 VFSL 语义变化改 ID——本设计**零指纹算法改动**，`sc1-` 只是同一 digest 的另一
   canonical 编码。

**非目标**：

- REST vertical 本体（HTTP 契约、错误映射、observer、limits、`@nomicore/namespace-api`
  装配）——SA8 范围确认明文不在本票。
- 不改指纹算法/输入（fingerprint.ts 两构造函数语义、D2 单生产者不变式原样）。
- 不触碰方言层 21 码冻结表（errors.ts；SA8 B3）与 `docs/vfsl/v1-spec.md` §4。
- 不给 `parseSchemaEnvelope` / `getCompiled` 增加 sc1- 校验（义务面裁决，§7 D6）。
- 不实现 `sc2-` 或任何未来 ID 格式版本；不引入 prepared-schema seam 或编译缓存变更。
- 不重开 ADR 0015 已决条款；ADR 0015 状态流转（提议 → accepted）属阶段收官事项
  （SA8 B2，移交总控）。

---

## 2. 当前行为与证据锚点

### 2.1 公共面与编译管线（现状）

| 事实 | 锚点 |
|---|---|
| 公共 API 仅经 `src/index.ts`（包 exports 只有 `.`） | `packages/vfsl/package.json` exports；`packages/vfsl/AGENTS.md` Boundaries |
| `parseVfsl(text)` → `{ok:true; module} \| {ok:false; issues: VfslIssue[]}`，同步纯函数不抛错，顶层崩溃边界 E100 | `packages/vfsl/src/index.ts` L140-166 |
| `compileSchemaEnvelope(input)` 五阶段编排：`envelopeStrictGate`（ENV-1/2/3 坍缩单条 → ENV-5 → ENV-4）→ `parseVfslImplementation` → `evaluate` → 双指纹 → 深冻结；顶层崩溃边界 ENV-100；无缓存 | `packages/vfsl/src/index.ts` L313-357 |
| `envelopeStrictGate` 只被 `compileSchemaEnvelope` 消费；`envelopeTextGate` 被 `parseSchemaEnvelope`/`getCompiledWith` 消费——两门共享 `validateEnvelopeShape` + `assertVfslDialect` 决策点 | `packages/vfsl/src/envelope.ts` L207-268；`index.ts` L184/L251/L320 |
| envelope 形状门对 `id` 只查 `typeof === 'string'`，无任何值域规则；`id` 全程不参与编译判定（仅进 envelope 指纹与回显） | `packages/vfsl/src/envelope.ts` L82-87（ENVELOPE_KEYS）；SA6 §9 Step 2 |
| envelope 层错误注册表 `EnvelopeErrCode`：ENV_1–ENV_5、ENV_100；`makeEnvelopeIssue` 唯一构造点（冻结前缀 `VFSL-ENV-E<码>: ` + 单行 sanitizer）；`readOnly` 仅 ENV-4 为 true | `packages/vfsl/src/envelope.ts` L22-39、L51-79 |
| 方言层 21 码冻结注册表（`VFSL-E<编号>:` message 前缀通道，公共 `VfslIssue` 无独立 code 字段） | `packages/vfsl/src/errors.ts` L11-33 |
| 双指纹：`sha256:v1:<hex>` 域分离；semantic 域 = `{domain:'vfsl-semantic', lang, version, module}` canonical JSON 的 SHA-256；module 恒为本次编译内 parseVfsl 刚产出者（D2 单生产者）；排除 id | `packages/vfsl/src/fingerprint.ts` L24-58；ADR 0007 L17 |
| `sha256Hex` 包内纯 TS 零依赖实现（无 node:crypto、无 TextEncoder 依赖） | `packages/vfsl/src/sha256.ts` 文件头注 + L65 |
| `evaluate` 唯一 ok:false 路径是 E100 崩溃边界（无领域级求值失败；资源预算失败为预留） | `packages/vfsl/src/evaluate.ts` L76；CONTEXT.md L56 |
| `getCompiled` 缓存键 = sha256(文本)，id 不参与；`compiledCache` 进程级 Map | `packages/vfsl/src/index.ts` L229-283、L366 |

### 2.2 sc1- 现状（能力缺口事实面）

- 全仓 grep：`sc1-` 仅出现于 `CONTEXT.md` 与 `docs/adr/0015`；`packages/vfsl/src` 零实现，
  无 Base32 参考、无格式常量（SA6 §5，本轮复核一致）。
- `semanticFingerprintOf` / `envelopeFingerprintOf` 为模块内部导出，index.ts 只内部消费，
  不进公共面；公共面无「text → fingerprint/ID」函数（SA6 §9 Step 3）。
- 生产代码、`domains/`、既有测试中**零** `sc<digits>-` 族 id（本轮 grep
  `id['\"]?\s*[:=]\s*['\`\"]sc[0-9]+` 于 packages/domains/apps/tests：仅 SA6 两个新契约
  文件命中）——保留族触发器对既有绿测试零回归面。域内唯一真实 id：
  `domains/vfs3-assets/schema.vfsl` `// @id: vfs3-assets@1`（族外）。

### 2.3 规范基准

| 规范 | 条款 | 与本设计的关系 |
|---|---|---|
| ADR 0015（提议，governing，随 PR #158 在途） | L117-144 内容寻址 schema ID；L196 测试决策 | 逐字兑现源；不重开条款（SA8 B2） |
| ADR 0007（已接受） | L15 分相位结果联合（envelope、dialect、parse、evaluate、internal）；L17 指纹语义 | sc1- 校验落在既有 envelope 相位框架内（加法规则）；指纹语义零改 |
| ADR 0005 D1 | 「id 是标签不是键：引擎正确性不依赖 id 唯一性……信封 id ≠ doc 地址」 | SA8 B1：sc1- 使 id 获得可校验内容地址身份，是已登记扩展；本设计只校验**真实性**（与 text 匹配），不引入唯一性依赖、不进入 doc/复制身份 |
| ADR 0008 L131 | `SCHEMA_ENVELOPE_<code>` 动态族为 vfsl envelope 相位码的不透明透传，码域归上游注册表 | 新码 ENV_6/ENV_7 经 runtime 零改动自动流过（§11） |
| CONTEXT.md L70-75 | 「语义指纹」「内容寻址 schema ID」词条 | 词条已把两制整合（「旧式 SCHEMA id 继续兼容，但任何 `sc1-` id 都必须与同信封 text 的 semantic fingerprint 精确匹配」）——本设计是该义务的引擎侧落实；无需改词条 |
| `docs/vfsl/v1-spec.md` §7 | `id`：字符串，文档标识；**对 parser 不透明**（不解析、不校验唯一性——引擎层职责，出范围） | 语言规格只约束 parser；sc1- 值域规则是引擎层（完整 envelope 编译）规则，规格陈述的契约不变 → 无需改规格（B3②：新码不记入 docs/vfsl/，注册表维持 source-resident 既有模式） |

---

## 3. 能力缺口（Feature 的「正复现」）

SA6 已用最小输入探针（经公共入口 `compileSchemaEnvelope`）实证（§6 P1–P6）：

| # | 输入 | 当前行为 | 目标行为 |
|---|---|---|---|
| P1 | `id` = TEXT_B digest 的 canonical `sc1-`，text = TEXT_A | ok:true（放行） | ok:false，ENV_7 语义不匹配 |
| P2 | `id` = TEXT_A digest 的 canonical `sc1-`，text = TEXT_A + JSDoc | ok:true（放行） | ok:false，ENV_7（JSDoc 保留在指纹） |
| P3 | `id` = `sc1-NotABase32Id!!!!` 等非 canonical 形态 | ok:true（放行） | ok:false，ENV_6 格式错误 |
| P4 | `id` = `sc1-<大写 payload>` / 51/53 字 / `=` / 非法字符 / pad 位非零 / `SC1-`/`sc2-` 前缀变体 | ok:true（放行） | ok:false，ENV_6 |
| P5 | 旧式 id（`vfs3-assets@1` / `compile-fixture` / `命名空间@schema版本` / 任意旧标签） | ok:true | ok:true（兼容不变，负控） |
| P6 | canonical `sc1-` id + 同 digest text（含 trivia 变体） | ok:true | ok:true（匹配正例） |

窄接口方向缺口 = 公共导出不存在（SA6 文件 2 构造性红 8 例 + tsc TS2305 ×1）。红灯契约
已固化：文件 1 `16 failed | 9 passed`（3/3 连跑逐位一致）、文件 2 `8 failed`、全仓既有
557 绿零波及（SA6 §13，原始日志 `task_issue-266_sa6_red.log` /
`task_issue-266_sa6_narrow_red.log`）。

**缺口链**（SA6 §9，设计确认采纳）：症状（任意 `sc1-` id 放行）→ 直接缺口点（envelope
形状门只查 id 的 typeof=string，无值域规则；id 不参与任何判定）→ 缺口二（指纹计算已存在
但无 text→身份的公共窄接口）→ 缺口三（sc1- 编解码/canonical 校验全仓零实现）→ 义务面
（ADR 0015 L144 挂「完整 envelope 编译」= `compileSchemaEnvelope`；H1 `parseSchemaEnvelope`
/`getCompiled` 不在义务面）→ 排除项（旧式 id 恒 ok、指纹算法独立于 id——#72 契约 AC4 已证
id 排除在语义指纹外）。

---

## 4. Owner 要求落实

Issue 评论 REST 读取为空；派发注记 `wiki/raw/task_266_dispatch.md`：「comments: none
(REST read); owner requirements: none」。

| Comment ID | Updated at | Requirement | Design section |
|---|---|---|---|
| —（无评论） | — | 无适用 Owner 评论 | 验收口径 = Issue 正文 AC1–AC4 + ADR 0015 L119-144/L196，映射见 §13 |

---

## 5. 复现和根因承接

| 上游事实 | 证据位置 | 设计响应 |
|---|---|---|
| 任意 `sc1-` 前缀 id（含格式垃圾与语义不匹配）被完整 envelope 编译放行 ok:true | SA6 §6 P1–P4；红灯日志 `expected true to be false` ×16 | §8.3/§8.4：envelope 相位追加 sc1- 格式步（ENV_6）+ parse 后 digest 精确匹配步（ENV_7） |
| envelope 形状门只校验 `id` 的 typeof=string（`ENVELOPE_KEYS`），无值域规则 | `packages/vfsl/src/envelope.ts` L82-87 | §7 D3/D5：保留族触发器 + canonical 判定落在 `envelopeStrictGate` 步骤⑤ |
| semantic fingerprint 计算已存在（fingerprint.ts，经 index.ts 内部消费）但无「text → fingerprint/ID」公共窄接口 | `packages/vfsl/src/fingerprint.ts` L55-58；index.ts 导出清单 | §8.1：`deriveSchemaIdentity` 公共导出，复用 `parseVfslImplementation` + `semanticFingerprintOf` |
| `sc1-` 编码/解码与 canonical 校验在全仓零实现 | SA6 §5 grep；本轮复核 | §8.2：新内部叶子模块 `schema-id.ts`（纯 TS，零依赖——AC6 清单契约） |
| 窄接口契约 8 红为构造性红（导出缺失），未来绿灯模拟 28/28 PASS | SA6 §13/§10.3 | §8.1 签名与 SA6 H1 逐字一致（H1–H4 全部采纳，见 §7 D1），落地后文件 2 整体转绿 |
| 旧式 id 恒 ok、parse 失败文本原生 vfsl issues 先出（N1/N3 绿锚） | SA6 §7 | §8.4 编排序：族外 id 零触及；mismatch 判定在 parse 成功之后（parse 失败文本天然先出 vfsl 问题） |
| 既有 557 vfsl 测试绿（含 #72 契约 28/28） | SA6 §5/§13 | §11/§13：零 sc 族 id 存在于既有测试/生产/domains（本轮 grep）；指纹/门既有语义不动 |
| **SA6 文件 1 fixture 锚 `sc1-fixture-anchor`（L91）与自身 16 红语义互斥** | `packages/vfsl/test/sc1-schema-id-envelope-validation.test.ts` L89-97（helper）、L100-105（模块作用域 fixture） | **§14.1**：生产语义按规范义务裁决；测试侧需 SA6 契约修订轮更名锚 id（一处字符串），SA1 不改测试，不因 fixture 缺陷扭曲生产规则（§7 D3 论证） |

上游事实与源码无其他矛盾。SA6 §15 移交的 5 项设计自由度裁决见 §7（D1 签名、D4 编号、
D5 组合序、D6 义务面边界、pad 位推论并入 D3 编码规则）。

---

## 6. SA8 约束落实

| 决议或义务 | 设计位置 | 处理方式 | 是否需要设计后冲突复查 |
|---|---|---|---|
| 冲突点 1/SA6 H1：窄接口形状（text-only、四不暴露、非 REST endpoint、复用 pipeline） | §8.1 | 逐字采纳 SA6 H1 签名 `deriveSchemaIdentity(text)`；ok 分支恰三键；`fn.length===1` | 是（公共 API 新增，§16） |
| 冲突点 2：`sc1-<52 小写 Base32 无 padding>` = 完整 256-bit digest 不截断、与 `sha256:v1:<hex>` 同 digest | §8.2 | `schema-id.ts` 编码件 + `fingerprint.ts` 内部 digest 提取件；测试侧独立参考件双向重编码（SA6 已固化） | 是（schema ID 格式为新增冻结面，§16） |
| 冲突点 3：敏感度规则（空白/普通注释稳定、JSDoc/顺序敏感）全继承 ADR 0007 | §1 目标 4、§8.1 | 零指纹算法改动；`sc1-` 只是同一 digest 的另一编码 | 否（无决策修订） |
| 冲突点 4/B3：两新码落 envelope 层 `VFSL-ENV-E<码>:` 注册表，不触方言层 21 码冻结表；「编号由实施时按错误注册表分配」 | §8.3 | `ENV_6`（格式）/`ENV_7`（语义不匹配）append 式追加；`readOnly=false`（不变式：仅 ENV-4 true）；不触 errors.ts/v1-spec §4 | 是（新稳定失败语义，§16） |
| 冲突点 5：六场景包级契约测试 | §13 | SA6 两文件逐项映射；文件 1 需先修 fixture 锚（§14.1） | 否 |
| B1：id「标签→可校验内容地址」不得外溢为「引擎正确性依赖 id」或「信封 id 参与 doc/复制身份」 | §7 D3、§9 | 校验的是**真实性**（格式 + 与同信封 text digest 相等），非全局唯一性；同一 sc1- id 可合法出现于多 namespace（内容寻址要义）；doc/复制身份仍是 namespaceId/replicationId；`getCompiled` 缓存键仍纯文本哈希 | **是（SA8 明文要求设计后复核本条）** |
| B2：ADR 0015 为 governing、不重开已决条款；状态流转归收官 | §1 非目标、§14.3 | 本设计零 ADR 改动；收尾清单登记翻 accepted（总控） | 否 |
| B3②：若新码记入规范文档须同步 | §2.3、§12 DENY | 新码不记入 docs/vfsl/（envelope 注册表维持 source-resident 既有模式——v1-spec 全文零 ENV 码记载）；无规范文档陈述的契约变化 | 否 |
| 冲突点 9/工程纪律：公共 API 仅经 `src/index.ts`；稳定码/排序/严格性/指纹输入为兼容行为；变更须跑根 `pnpm typecheck` + `pnpm test` | §8.1、§12、§13 | 新导出仅经 index.ts；`schema-id.ts`/digest 提取件不进公共面；既有码/排序/严格性零改（负控 N1/N2 + 557 绿守护）；验收含根门禁 | 否（执行面） |

---

## 7. 设计决策与主要备选方案

### D1 窄接口签名：采纳 SA6 H1 原样

```ts
export function deriveSchemaIdentity(text: string): DeriveSchemaIdentityResult;
export type DeriveSchemaIdentityResult =
  | { ok: true; semanticFingerprint: string; schemaId: string }
  | { ok: false; issues: VfslIssue[] };
```

- 命名沿用包内动词风格（`parseVfsl` / `compileSchemaEnvelope`），语义 = ADR 0015
  「派生 schema 身份」；SA6 契约文件 2 已按此名固化 8 条断言（含 `fn.length === 1`、
  ok 分支精确键集 `['ok','schemaId','semanticFingerprint']`、失败分支键集
  `['issues','ok']`），采纳即零修订成本。
- lang=vfsl、version=1 是接口上下文常量（简报「输入 VFSL text（lang=vfsl、version=1）」
  的最窄读法），不进参数表；两常量进入 semantic 域文档（`{domain, lang, version,
  module}`），因此 schema ID 隐式钉住方言与版本。
- **备选拒收**：(a) 显式 `lang`/`version` 参数——更宽，违背「窄」意图且方言族目前只有
  vfsl@1，出现第二方言时再升接口版本；(b) 接收 envelope/provisional id——简报与 ADR
  0015 L125 明文禁止；(c) 返回 module/derived——违反四不暴露（AC4）。

### D2 窄接口相位：parse-only（不跑 evaluate）

`deriveSchemaIdentity` = `parseVfslImplementation(text)` → 失败透传原生 `VfslIssue[]`；
成功则 `semanticFingerprintOf('vfsl', 1, module)` → digest → Base32 编码。

- 依据：semantic fingerprint 的定义输入 = `lang + version +` 规范 IR（ADR 0007 L17；
  `fingerprint.ts` L55-58 只消费 module）；evaluate 不是身份的输入。求值器失败面现状
  只有 E100 崩溃边界（`evaluate.ts` L76——领域级求值失败为预留），parse-ok ⇒
  evaluate-ok 在当前引擎内除内部缺陷外恒成立，两方案无可观察分歧。
- 「复用现有编译 pipeline」（ADR 0015 L125）的读法约束的是**机制**（不得出现第二套
  parser/指纹路径——D2 单生产者不变式保持），不是相位广度。
- 失败面恰为「VFSL issues」（ADR 0015 L125），与 SA6 H3 锁定的「issues 与 parseVfsl 同
  输入深相等」一致。
- 诚实边界（记录于 §9）：derive ok **不**承诺 evaluate ok；可求值性的权威门仍是完整
  envelope 编译（Registry create 消费）。REST 流派生身份后组装 envelope、Registry 全量
  重编译（ADR 0015 L142 明文接受两次编译），不可求值文本在 Registry 侧被拒——身份派生
  与可编译性是两个正交关注点。
- **备选拒收**：parse + evaluate——多付一次 O(schema) 求值且结果弃置；失败面掺入与身份
  无关的求值 issue；与「窄」意图相反。

### D3 保留族触发器：`sc<digits>-`（大小写不敏感）→ 族内仅精确 `sc1-` + canonical 合法

- 触发器：`/^sc[0-9]+-/i.test(id)`。族外 id（含 `mysc1-provisional-id`、`schema-1`、
  `sc-`（无数字）、全部旧式标签）走旧式路径，**零触及**。
- 族内 canonical 判定：恰 `sc1-`（大小写敏感）+ 52 位 `[a-z2-7]` + pad 位为零
  （RFC 4648 §3.2；52 字末字符只能 `a`/`q`）。族内其余一切形态（`SC1-`/`Sc1-`/`sC1-`、
  `sc2-`、`sc10-`、空 payload、51/53 字、大写、`=`、字母表外字符、内嵌空白、pad 位
  非零）→ ENV_6 单条拒绝。
- 依据：SA6 红灯矩阵明文要求拒绝前缀大小写变体与 `sc2-`（仅精确 `sc1-` 前缀触发无法
  覆盖它们）；ADR 0015 L144「任何使用 `sc1-` 前缀的输入 envelope 必须验证 canonical
  格式」+ CONTEXT.md L74「任何 `sc1-` id 都必须与同信封 text 的 semantic fingerprint
  精确匹配」的防仿冒意图——`SC1-<52 字>` 视觉上冒充内容地址，必须拒绝。`sc<digits>-`
  是内容寻址 ID 的保留命名族（`sc1-` 的 `1` 是格式版本，ADR 0015 L133）。
- 回归面：全仓生产/domains/既有测试零 `sc<digits>-` 族 id（§2.2）。
- **备选拒收**：(a) 仅精确 `sc1-` 前缀触发——`SC1-`/`sc2-` 仿冒形态漏网，违反 SA6 红灯；
  (b) 「payload 空 或 长度 ≥ 50 或 含大写才校验」之类内容启发式——本设计显式排查过：
  该规则能同时满足 SA6 文件 1 全部断言（含把 `sc1-fixture-anchor` 判为旧式），但它是
  fixture 迎合而非规范义务：`sc1-<短小写标签>` 恰是内容寻址仿冒的最大敞口，ADR 0015
  「任何使用 sc1- 前缀」与 CONTEXT.md「任何 sc1- id」均不容忍；SA2 攻击评审必判 MAJOR。
  正确处置是修 fixture（§14.1），不是给生产规则开洞。

### D4 两稳定码：`ENV_6`（格式）/ `ENV_7`（语义不匹配），envelope 注册表 append

- 编号依据（ADR 0015 L144「具体编号由实施时按错误注册表分配」授权）：沿 `EnvelopeErrCode`
  append 式注册表既有次序（1/2/3/4/5/100），取未占用的 `6`/`7`；管线序 = 注册表序
  （格式检查在 envelope 相位先出，mismatch 在 parse 后出）。
- 契约面只锁（SA6 describe 4）：两模式各自稳定（重复调用相等）、互不相同、纯数字
  envelope 码、非 ENV_1–5/100 别名、冻结 message 前缀 `VFSL-ENV-E<码>: `。message 正文
  措辞不冻结（envelope.ts 既有纪律），建议正文：
  - ENV_6：`sc1- 内容寻址 schema ID 非 canonical 格式（期望 sc1- + 52 位小写 RFC 4648 Base32，无 padding、pad 位为零）: <id>`
  - ENV_7：`sc1- schema ID digest 与 text 语义指纹不匹配（内容寻址校验失败）: id=<idDigest> text=<expectedDigest>`
- `readOnly = false`（模块不变式：仅未知方言 ENV-4 为 true，envelope.ts L34-39）。
- 单条纪律：两码均以 `{kind:'envelope', issue}` **单条**返回（#72 AC2 envelope 阶段恒
  单条先例延伸）。

### D5 相位放置：格式步在方言断言后（envelope 相位末步）；mismatch 步在 parse 成功后、evaluate 前

- 格式步入 `envelopeStrictGate` 步骤⑤（形状 → 封闭 → 方言 → **sc1- 格式**），仍属
  envelope 相位、先于 parse——SA6 H2 同判；#72 既有 fail-fast 顺序锚
  （compile-schema-envelope.test.ts L270「形状 → 方言 → 文本解释」）不受扰（新步在方言
  之后）。`SC1-` 族 + 未知方言组合：ENV-4 先出（未知方言 = 全盘拒收的只读 loud-fail，
  先于对 id 值域的任何裁定）——既有 ENV-4 测试面零扰动。
- mismatch 步：digest 比较需要 text 规范 IR → 最早可判定点是 parse 成功后；置于
  evaluate 前可（a）省去注定失败的求值，（b）避免文本域 issue 掩盖信封完整性违规。
- 组合序裁决（SA6 §15.3 未锁项）：malformed `sc1-` + 坏文本 → **ENV_6 单条**（envelope
  相位先于 parse，parse 不运行）；canonical-but-mismatched `sc1-` + 求值失败文本 →
  **ENV_7 单条**（parse 已成功，mismatch 在 evaluate 前裁定）。parse 失败文本 + canonical
  id → 原生 vfsl issues（SA6 N3 绿锚，mismatch 不可达）。
- sc1- envelope 的 semantic fingerprint 在 mismatch 步**算一次**并在成功路径步骤⑤复用
  （不重算）；legacy id 路径保持现状（步骤⑤才算）——既有成本剖面不变。

### D6 义务面边界：仅 `compileSchemaEnvelope`

`parseSchemaEnvelope`（H1）与 `getCompiled`（DocScope 门）**不加** sc1- 校验。依据：
ADR 0015 L144 义务主语是「VFSL 完整 envelope 编译」（含 evaluate 与双指纹的成功路径）；
SA6 §15.4 同读并明言不加锁防过度约束。`getCompiled` 缓存键纯文本哈希（id 不参与）的
既有语义一并保持（B1：id 不成为引擎正确性输入）。未来若需扩面，走新决策。

### D7 模块布局：新叶子 `schema-id.ts` + `fingerprint.ts` 内部 digest 提取 + `envelope.ts` issue 构造 + `index.ts` 编排

- `packages/vfsl/src/schema-id.ts`（新，零 import 叶子）：`SC1_ID_PREFIX`、
  `isInScIdFamily`、`isCanonicalSc1Id`、`digestHexFromCanonicalSc1Id`、
  `sc1IdFromDigestHex`。不进公共面（SA6 §11「实现侧内部件，公共面不暴露」）。
- `packages/vfsl/src/fingerprint.ts` 追加内部导出 `digestHexFromFingerprint(fp): string |
  null`（剥离 `FINGERPRINT_PREFIX` + 64 小写 hex 校验）——指纹格式知识单源（前缀常量
  已在文件内），避免第二处硬编码。不违反 RT-1a 静态守卫（守卫只覆盖两个构造函数名；
  本设计不新增第三文件对它们的引用——`deriveSchemaIdentity` 与 mismatch 检查都在
  index.ts 内调用，与既有唯一调用点一致）。
- `envelope.ts`：注册表两条 + `sc1FormatIssueOrNull`（模块内部，门步骤⑤消费）+
  `sc1MismatchIssueOrNull`（内部导出，index.ts 消费）——issue 构造继续经
  `makeEnvelopeIssue` 唯一构造点（单行 sanitizer 单点纪律保持）。
- 模块图：`envelope.ts → {schemasource, ir(types), schema-id, fingerprint}`；
  `fingerprint.ts → {sha256, schemasource(types), ir(types)}`；`schema-id.ts → ∅`。
  无环。不共享测试侧参考件 `test/sc1-base32-ref.ts` 任何代码（防循环论证，SA6 §1）。
- **备选拒收**：(a) Base32 并入 fingerprint.ts——模糊 D2-CONTRACT-MARKER 模块辖域；
  (b) codec 公共导出——违反窄面纪律；(c) mismatch 逻辑放 schema-id.ts——会把 issue
  构造引出 envelope.ts 唯一构造点。

### D8 编码算法：MSB-first 5-bit 组、小写字母表 `a–z2–7`、无 `=`、pad 位必须为零

32 bytes = 256 bits → 52 组（末组 1 数据位 + 4 pad 位）；末字符 ∈ {a,q} 是 pad 位为零
的数学推论（RFC 4648 §3.2），非独立校验条款（SA6 §15.5 同判）。生产实现与测试侧独立
参考件（`sc1-base32-ref.ts`，已与 Python `base64.b32encode` 跨验）无共享代码路径；
RFC 4648 §6/§3.2/§10 为规范依据。

---

## 8. 接口、注册表与编排变化

### 8.1 公共接口（`src/index.ts` 新增）

```ts
/** deriveSchemaIdentity ok 分支：恰两值（AC4 可观察锚 = ok 分支精确键集）。 */
export interface DeriveSchemaIdentityOk {
  ok: true;
  semanticFingerprint: string; // sha256:v1:<64 lowercase hex>（ADR 0007 域分离格式）
  schemaId: string;            // sc1-<52 位小写 RFC 4648 Base32>（ADR 0015 冻结格式）
}

export type DeriveSchemaIdentityResult =
  | DeriveSchemaIdentityOk
  | { ok: false; issues: VfslIssue[] };

/**
 * ADR 0015 L119-125 窄 Module interface：VFSL text（上下文常量 lang=vfsl、version=1）
 * → semantic fingerprint + sc1- schema ID，或 VFSL issues。
 * 同步、纯函数、无缓存（不读不写 compiledCache）、不抛错（顶层崩溃边界，E100 镜像）。
 * 不接收 provisional envelope ID；不暴露 IR/派生 schema/validator；不是 REST endpoint。
 */
export function deriveSchemaIdentity(text: string): DeriveSchemaIdentityResult {
  try {
    const parsed = parseVfslImplementation(text); // 复用：既有崩溃边界（E100 通道）
    if (!parsed.ok) {
      return { ok: false, issues: parsed.issues }; // 原生 VfslIssue[] 零损透传
    }
    const semanticFingerprint = semanticFingerprintOf('vfsl', 1, parsed.module);
    const digest = digestHexFromFingerprint(semanticFingerprint);
    if (digest === null) { // 不可达：指纹格式冻结不变式破坏 = 实现缺陷，loud
      throw new Error(`semantic fingerprint 格式异常: ${semanticFingerprint}`);
    }
    return { ok: true, semanticFingerprint, schemaId: sc1IdFromDigestHex(digest) };
  } catch (err) {
    // 崩溃边界镜像 parseVfsl 最终防线（index.ts L153-165 同款 E100 结构化 issue）
    return {
      ok: false,
      issues: [{
        message: `VFSL-E100: 内部错误（意外异常）: ${err instanceof Error ? err.message : String(err)}`,
        line: 1,
        column: 1,
      }],
    };
  }
}
```

实现注记：(a) 参数类型 `string`（运行时姿态与 `parseVfsl` 同源——非 string 输入落入既有
崩溃边界，不新增前置 typeof 检查，避免发明契约外失败模式）；(b) E100 镜像构造建议与
`parseVfslImplementation` 抽共享内部 helper 或内联复制（SA3 自由度，语义必须同款）；
(c) 返回容器为全原始值新对象，无共享引用别名问题，不要求深冻结（与 `parseVfsl` 姿态
一致；冻结无害可选）；(d) index.ts 文件头公共接缝清单同步补一段（工程纪律：头注是
公共面文档）。

### 8.2 内部编码件（`src/schema-id.ts`，新文件）

```ts
/** sc1- schema ID 格式版本前缀（ADR 0015 L130：'sc1-'，大小写敏感）。 */
export const SC1_ID_PREFIX = 'sc1-';

/** 保留族触发器：/^sc[0-9]+-/i（内容寻址 ID 命名族；族外 = 旧式路径，零触及）。 */
export function isInScIdFamily(id: string): boolean;

/** canonical 判定：恰 'sc1-' + 52 位 [a-z2-7] + pad 位为零（RFC 4648 §3.2）。 */
export function isCanonicalSc1Id(id: string): boolean;

/** canonical sc1- id → 64 位小写 hex digest；非 canonical 返回 null。 */
export function digestHexFromCanonicalSc1Id(id: string): string | null;

/** 64 位小写 hex digest → canonical sc1- id；非法 hex 抛错（内部不变式违反，loud）。 */
export function sc1IdFromDigestHex(digestHex: string): string;
```

算法（D8）：字节流 → MSB-first 位串 → 5-bit 组映射 `abcdefghijklmnopqrstuvwxyz234567`；
解码反向并校验 pad 位为零。纯函数、确定性、零依赖（满足 #72 AC6「编译入口零新运行时
依赖」清单契约——`package.json` 不动）。

### 8.3 envelope 注册表与门（`src/envelope.ts`）

```ts
export const EnvelopeErrCode = {
  ENV_1: '1', ENV_2: '2', ENV_3: '3', ENV_4: '4', ENV_5: '5',
  ENV_6: '6',   // sc1- 内容寻址 id 非 canonical 格式（#266：格式错误稳定码）
  ENV_7: '7',   // sc1- id digest 与 text 语义指纹不匹配（#266：语义不匹配稳定码）
  ENV_100: '100',
} as const;
```

`envelopeStrictGate` 追加步骤⑤（方言断言后）：

```ts
// ⑤ sc1- 格式（#266）：保留族内非 canonical → ENV_6 单条；族外零触及
const sc1Format = sc1FormatIssueOrNull(shape.envelope.id);
if (sc1Format !== null) {
  return { ok: false, issues: [{ kind: 'envelope', issue: sc1Format }] };
}
```

`sc1FormatIssueOrNull`（模块内部）与 `sc1MismatchIssueOrNull`（内部导出，供 index.ts）：

```ts
function sc1FormatIssueOrNull(id: string): SchemaEnvelopeIssue | null {
  if (!isInScIdFamily(id)) return null;   // 旧式路径：零触及
  if (isCanonicalSc1Id(id)) return null;  // canonical：放行至语义匹配步
  return makeEnvelopeIssue(EnvelopeErrCode.ENV_6,
    `sc1- 内容寻址 schema ID 非 canonical 格式（期望 sc1- + 52 位小写 RFC 4648 Base32，无 padding、pad 位为零）: ${id}`);
}

/** 仅在 envelopeStrictGate 放行后调用（canonical 已保证）；digest 相等 → null。 */
export function sc1MismatchIssueOrNull(
  id: string,
  semanticFingerprint: string,
): SchemaEnvelopeIssue | null {
  if (!id.startsWith(SC1_ID_PREFIX)) return null; // 旧式 id：无匹配义务
  const idDigest = digestHexFromCanonicalSc1Id(id);
  const expected = digestHexFromFingerprint(semanticFingerprint);
  if (idDigest === null || expected === null) {
    throw new Error('sc1- mismatch 检查前置不变式破坏（门未保证 canonical / 指纹格式异常）');
    // → 由 compileSchemaEnvelope 顶层崩溃边界收编 ENV-100（实现缺陷通道，非 ENV_6 静默降级）
  }
  if (idDigest !== expected) {
    return makeEnvelopeIssue(EnvelopeErrCode.ENV_7,
      `sc1- schema ID digest 与 text 语义指纹不匹配（内容寻址校验失败）: id=${idDigest} text=${expected}`);
  }
  return null;
}
```

### 8.4 `compileSchemaEnvelope` 编排（`src/index.ts` 修改）

```ts
// ① envelope + ② dialect（含新步骤⑤ sc1- 格式）：envelopeStrictGate —— 不变（门内新增步）
const gate = envelopeStrictGate(input);
if (!gate.ok) return { ok: false, issues: gate.issues };
// ③ parse —— 不变
const parsed = parseVfslImplementation(gate.envelope.text);
if (!parsed.ok) return { ok: false, issues: vfslIssues(parsed.issues) };
// ③b（新增）sc1- 语义匹配：parse 成功后、evaluate 前（D5）
let semanticFingerprint: string | undefined;
if (gate.envelope.id.startsWith(SC1_ID_PREFIX)) {        // 门已保证 canonical
  semanticFingerprint = semanticFingerprintOf(
    gate.envelope.lang, gate.envelope.version, parsed.module,
  );
  const mismatch = sc1MismatchIssueOrNull(gate.envelope.id, semanticFingerprint);
  if (mismatch !== null) return { ok: false, issues: [{ kind: 'envelope', issue: mismatch }] };
}
// ④ evaluate —— 不变
const evaluated = evaluate(parsed.module);
if (!evaluated.ok) return { ok: false, issues: vfslIssues(evaluated.issues) };
// ⑤ 双指纹 + ⑥ 深冻结 —— semanticFingerprint 复用 ③b 已算值；legacy 路径现算（现状不变）
```

### 8.5 状态机

无新状态机：全部改动是纯函数内的加法判定步。`compileSchemaEnvelope` 相位序（可观察
失败优先级）固化为：

```
ENV-1/2/3（形状，坍缩单条）→ ENV-5（封闭）→ ENV-4（方言）→ ENV-6（sc1- 格式，新）
  → vfsl parse issues → ENV-7（sc1- 语义不匹配，新）→ vfsl evaluate issues
  → ENV-100（崩溃边界，任意相位）→ ok 五件套
```

`deriveSchemaIdentity`：`vfsl parse issues → E100（崩溃边界）→ ok 三键`。

---

## 9. 错误、恢复、并发和幂等

- **不抛错纪律保持**：两公共路径均结果联合返回。`deriveSchemaIdentity` 顶层 catch 镜像
  `parseVfsl` E100；`compileSchemaEnvelope` 新增步全部位于既有 try 块内（codec/regex/
  字符串比较无可抛面；不变式破坏 throw → ENV-100 收编，见 §8.3 注）。
- **诚实失败**：ENV_6/ENV_7 是明确失败类型（稳定码 + 单条 + `kind:'envelope'`）；无静默
  fallback——族外 id 不触发校验是**规范定义的旧式兼容路径**（P5 负控），不是降级。
- **恢复/重试**：纯函数无部分状态；失败可幂等重试（同输入同结果——SA6 稳定性断言）。
  调用方修正 id（重派生或改旧式标签）即可转换结果。
- **并发**：无共享可变状态；不读不写 `compiledCache`（两新路径均保持 compile 入口「无
  缓存」纪律，index.ts L35 注记辖域延伸至 derive）。
- **幂等/确定性**：tokenize→parse→analyze→指纹→Base32 全链确定性；同 text 重复调用逐
  字节一致（SA6 文件 2 describe 1 第 4 用例）。
- **B1 纪律**：sc1- 校验不引入 id 唯一性依赖、不进入 doc/复制身份；`getCompiled` 缓存键
  保持纯文本哈希。同一 sc1- id 合法出现于多 namespace（内容寻址要义）。
- **资源**：sc1- 路径多付一次「指纹提前计算」（复用于步骤⑤，总次数不变）；mismatch 早出
  反而省去注定失败的 evaluate。无新分配热点（52 字符串 + 64 hex）。

---

## 10. 数据流路线

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚点 |
|---|---|---|---|---|---|---|---|---|
| R1 窄接口派生 | 调用方（未来 REST vertical / 工具链）持 VFSL text | 每调用新建结果对象（无缓存写入） | text → tokenize/parse/analyze（既有）→ IR → `{domain:'vfsl-semantic', lang:'vfsl', version:1, module}` canonical JSON → sha256Hex → `sha256:v1:<hex>` → digest hex → Base32(52) → `sc1-<52>` | 无（纯内存；不落盘、不进 compiledCache） | 调用方读 `{semanticFingerprint, schemaId}` | ok 三键或原生 `VfslIssue[]` | 纯函数零清理；E100 崩溃边界 | SA6 文件 2（8 用例） |
| R2 envelope 格式校验 | 调用方持 `{lang,version,id,text}` unknown | 无写入 | envelopeStrictGate 步骤⑤：id → 保留族判定 → canonical 判定（Base32 解码 + pad 位检查） | 无 | compileSchemaEnvelope 返回 | 族内非 canonical → ENV_6 单条；族外 → 放行（旧式兼容） | 纯函数；失败即返，无清理 | SA6 文件 1 describe 2/3/4（13 红）+ N1（2 绿） |
| R3 envelope 语义匹配 | 同上（格式已过） | 无写入 | parse → IR → semanticFingerprint（提前算，复用）→ digest hex ⇔ id 解码 digest 字符串相等比较 | 无 | 同上 | 不等 → ENV_7 单条；相等 → 继续求值/冻结 | 同上；指纹单次计算复用 | SA6 文件 1 describe 1（2 红）+ 匹配正例（3 绿）+ N3（1 绿锚） |
| R4 下游透传（跨模块边界，零改动） | namespace-runtime P0 / replaceSchema 持久化 SCHEMA | runtime 状态机（既有） | `SchemaParseIssue{kind:'envelope'}` → `toIssueSummary` → `SCHEMA_ENVELOPE_6` / `SCHEMA_ENVELOPE_7`（不透明透传，ADR 0008 L131） | Persistence（既有路径） | schemaState='unavailable' 摘要 / 422 族映射（未来 REST） | 既有 unavailable/fatal 语义不变 | 既有 | p0.ts L143-155 既有映射；557 绿回归 |

跨边界说明：R1–R3 全部进程内纯函数，无缓存/最终一致性面；R4 为唯一跨模块跳（vfsl →
namespace-runtime），数据形态为冻结 issue 结构，事实源 = envelope.ts 注册表，runtime 侧
零注册零改动（SA8 冲突点 8/ADR 0008 L131）。无运行时数据流变化的路径：`parseVfsl` /
`evaluate` / `validateLogicalSnapshot` / `validatePatch` / `getCompiled` / SchemaSource
（依据：§2.1 锚点 + §7 D6 义务面裁决）。

---

## 11. 调用方影响矩阵

| 调用方 | 当前处理 | 设计后处理 | 所需改动 | 证据 |
|---|---|---|---|---|
| `compileSchemaEnvelope` 直接调用方：`packages/namespace-runtime`（runtime.ts 默认编译 seam → P0 与 replaceSchema） | 任意 `sc1-` id 编译 ok:true | 族内非 canonical/不匹配 → ok:false 单条 envelope issue → P0 `unavailable`（`SCHEMA_ENVELOPE_6/7` 摘要）/ replaceSchema 拒绝 | **零改动**（码透传不透明；结果联合形状不变） | runtime.ts L337、p0.ts L104-155；ADR 0008 L131；SA8 冲突点 8 |
| `parseSchemaEnvelope` 调用方（doc-runtime/projection 消费面） | 不校验 id 值域 | 不变（义务面外，D6） | 零 | index.ts L182-197；SA6 §15.4 |
| `getCompiled` 调用方（DocScope 门） | 缓存键纯文本哈希；不校验 id | 不变 | 零 | index.ts L229-283 |
| `FileSchemaSource` / `domains/` / codegen / dogfood | 旧式 id（`vfs3-assets@1`） | 族外零触及 | 零 | schemasource.ts；domains grep（§2.2） |
| `schema-check-cli` | 读 domains 信封做检查 | 族外零触及 | 零 | src/schema-check-cli.ts（不消费 compile 入口） |
| 未来 REST vertical（本票外，ADR 0015 编排） | 不存在 | 派生（R1）→ 组装 sc1- envelope → Registry create 全量重编译：digest 由同 pipeline 派生 ⇒ 格式与匹配由构造保证 | 本票外 | ADR 0015 L142 |
| 既有 vfsl 测试（557 绿） | 断言既有码/排序/严格性/指纹 | 行为零变化（族外 id + 指纹算法不动 + 门既有步骤序不动） | 零 | SA6 §13 回归面；compile-schema-envelope.test.ts L270 顺序锚 |
| SA6 契约文件 2（窄接口） | 8 红（导出缺失） | 8 绿 | 零（契约即本设计 §8.1） | SA6 §13 |
| SA6 契约文件 1（envelope） | 16 红 + 9 绿 | 16 红→绿；**9 绿全部受 fixture 锚缺陷影响**（锚在模块作用域初始化即失败 → 整文件收集期 error；其中 7 条直接依赖该 helper/派生基准，§14.1） | 测试侧一处字符串更名（SA6 修订轮） | §14.1 |

---

## 12. 文件范围

### ALLOW LIST

| 路径 | 预期改动 | 原因 |
|---|---|---|
| `packages/vfsl/src/schema-id.ts` | **新建**：SC1_ID_PREFIX、保留族触发器、canonical 判定、Base32 编解码（§8.2） | sc1- 编码件零实现（缺口三）；内部件不进公共面 |
| `packages/vfsl/src/envelope.ts` | 注册表追加 ENV_6/ENV_7；`envelopeStrictGate` 步骤⑤；`sc1FormatIssueOrNull`（内部）+ `sc1MismatchIssueOrNull`（内部导出）（§8.3） | envelope 相位值域规则 + 两稳定码唯一落点（SA8 B3） |
| `packages/vfsl/src/fingerprint.ts` | 追加内部导出 `digestHexFromFingerprint`（§7 D7） | 指纹格式知识单源的 digest 提取件；两消费点（index.ts 两处编排） |
| `packages/vfsl/src/index.ts` | 新增 `deriveSchemaIdentity` + `DeriveSchemaIdentityOk/Result` 导出；`compileSchemaEnvelope` ③b 步与⑤复用；文件头公共接缝清单补注（§8.1/§8.4） | 公共 API 仅经 index.ts（包 AGENTS）；编排单点 |
| `packages/vfsl/test/sc1-schema-id-envelope-validation.test.ts` | **仅一处**：L91 锚 id `'sc1-fixture-anchor'` → 非 `sc<digits>-` 族字符串（建议 `'fixture-anchor'`）；**由 SA6 契约修订轮执行，非 SA3 实现轮**（§14.1） | fixture 锚与本契约 16 红语义结构性互斥；不修则文件无法转绿 |

### DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
|---|---|---|
| `packages/vfsl/src/errors.ts` | 方言层错误码 | 21 码冻结表（SA8 B3/v1-spec §4）；新码属 envelope 码空间 |
| `packages/vfsl/src/sha256.ts`、`parser.ts`、`tokenizer.ts`、`semantic.ts`、`ir.ts`、`evaluate.ts`、`validate.ts`、`validate-patch.ts`、`pattern.ts`、`xml.ts`、`resolve.ts`、`shapes.ts`、`derived.ts` | 编译管线本体 | 复用而非改动（ADR 0015 L125）；指纹敏感度已由 #72 契约冻结 |
| `packages/vfsl/src/schemasource.ts` | 信封形状/方言断言单点 | sc1- 是 id **值域**规则，落 envelope 门；SchemaSource 接缝零涉 |
| `packages/vfsl/src/schema-check-cli.ts` | CLI 检查工具 | 消费旧式 domains id，零触及 |
| `packages/vfsl/package.json` | 包清单 | 零新运行时依赖（#72 AC6 清单契约）；公共面仅经 index.ts |
| `packages/vfsl/test/sc1-base32-ref.ts` | SA6 独立参考件 | 独立验证器——与生产实现共享代码即循环论证（SA6 §1） |
| `packages/vfsl/test/sc1-derive-schema-identity.test.ts` | SA6 窄接口契约 | 本设计 §8.1 逐字采纳 H1–H4，无需修订 |
| `packages/vfsl/test/`（其余全部既有测试） | 兼容性守护 | 断言禁改；557 绿是回归锚 |
| `packages/namespace-runtime/**`、`packages/doc-runtime/**`、其余 packages | 下游消费者 | 码透传不透明（ADR 0008 L131）；零改动（§11） |
| `docs/vfsl/v1-spec.md` | 语言规格 | §7 id 行「对 parser 不透明」陈述的契约不变；envelope 注册表 source-resident 既有模式（B3②） |
| `docs/adr/0015-vertical-rest-namespace-create.md` | governing 决策 | 不重开条款（SA8 B2）；状态翻 accepted 属收官（总控） |
| `CONTEXT.md` | 共享词汇 | 「内容寻址 schema ID」词条已是目标态（L73-75） |
| `domains/**` | 仓内 schema 资产 | 旧式 id；本票不改资产 |
| `apps/**`、`tests/**`、根配置 | 无消费面 | grep 零 compileSchemaEnvelope/derive 消费 |

---

## 13. 验收与验证映射

| 需求或风险 | 现有证据 | 所需行为测试或动态场景 | 预期观察 |
|---|---|---|---|
| AC1 窄接口确定性派生 fingerprint + sc1- ID 或 issues | SA6 文件 2（8 红，构造性） | 同文件（SA3 落地导出后无需新增） | 8/8 绿；`tsc -p packages/vfsl/tsconfig.json` TS2305 消除 |
| AC2 ID = 完整 256-bit digest 的 52 位小写 Base32，与 `sha256:v1:<hex>` 同 digest | SA6 文件 2 describe 1（独立参考件双向重编码 + 与既有 pipeline 指纹相等）；文件 1 参考件自检 3 绿 | 同上 | 双向重编码逐字一致；`/^sc1-[a-z2-7]{52}$/`、长度 56、末字符 ∈ {a,q} |
| AC3·fingerprint ↔ sc1- 一一重编码 | 文件 1 匹配正例（绿）+ 文件 2（红） | 同上 | 解码 = digest；重编码 = payload |
| AC3·空白/普通注释稳定 | 文件 1 trivia 正例（绿）+ 文件 2 describe 2（红） | 同上 | WS/`//`/`/* */` 变体 ID 逐字节一致 |
| AC3·JSDoc 变化改变 ID | 文件 1 红灯 1 P2 + JSDoc 自洽正例；文件 2 describe 2 | 同上 | docs 原文不同 ⇒ ID 不同 |
| AC3·canonical Base32（含声明顺序） | 文件 1 格式矩阵 12 形态（红）+ KAT；文件 2 顺序用例 | 同上 | 12 形态全拒；顺序变 ⇒ ID 变 |
| AC3·旧 ID 兼容 | 文件 1 N1（2 绿） | 同上（负控恒绿） | 旧式 id + `mysc1-provisional-id` ok:true 且指纹不变 |
| AC3/ADR L144·两稳定 issue code | 文件 1 describe 4（红：稳定/互异/码空间） | 同上 | 同模式重复调用 code 相等；两码互异；`/^\d+$/` 且非 {1,2,3,4,5,100} |
| ADR L144·完整 envelope 编译强校验 | 文件 1 describe 1/2/3 + 正例 + N3 锚 | **前置：SA6 修订轮更名 fixture 锚（§14.1）**，随后同文件 | 16 红→绿、9 绿保持（更名后） |
| AC4 不暴露 IR/派生/validator、不接受 provisional envelope ID | SA6 文件 2 describe 1（键集 + `fn.length===1`） | 同上 | ok 分支恰三键；单参签名 |
| 既有行为零回归 | SA6 §13：`packages/vfsl/test/` 557 绿 | 定向 `vitest run packages/vfsl/test/` + 根 `pnpm test` | 557 绿保持；两契约文件转绿（文件 1 需先修订锚） |
| 公共类型面 | tsc TS2305 ×1（现状） | `pnpm typecheck`（包）+ 根 `pnpm typecheck`（包 AGENTS：公共类型变更须跑根门禁） | 零错 |
| 零新运行时依赖 | #72 AC6 清单契约 | `packages/vfsl/package.json` 无 dependencies（既有用例持续守护） | 持续绿 |

---

## 14. 风险、回滚和残余问题

### 14.1 【关键诚实报告】SA6 契约文件 1 fixture 锚缺陷（阻塞该文件转绿，需契约修订轮）

**事实**：`packages/vfsl/test/sc1-schema-id-envelope-validation.test.ts` L89-97 的 helper
`semanticFingerprintOf(text)` 以 `id: 'sc1-fixture-anchor'`（注释自称「任意旧式 id」）经
`compileSchemaEnvelope` 取参照指纹；L100-105 在**模块作用域**调用它构造 `FP_A/ID_B/
FP_JSDOC` 基准，L168/L320 等绿锚用例亦直呼它。该锚以精确 `sc1-` 前缀开头且 payload
非 canonical。

**矛盾**：本契约自身的 16 条红灯（含 `'sc1-'` 空 payload、`'sc1-NotBase32!!'`）要求任何
`sc1-` 前缀 id 强校验拒绝——与「`sc1-fixture-anchor` 编译 ok:true」结构性互斥。实现落地
后 L92 `expect(r.ok).toBe(true)` 在模块收集期失败 → 整文件 error（含 9 条「必须保持绿」
的负控/绿锚与 16 条目标红全部不可用）。SA6 §10.3 的未来绿灯模拟只覆盖文件 2（28 断言），
未模拟文件 1 的实现后绿态——缺陷因此漏检。

**设计裁决**：生产语义按规范义务（ADR 0015 L144「任何使用 `sc1-` 前缀的输入 envelope
必须验证」；CONTEXT.md L74「任何 `sc1-` id 都必须……精确匹配」）= §7 D3 保留族强校验。
本设计显式评估并**拒收**能豁免该锚的唯一规则形态（「payload 空 或 ≥50 字 或 含大写才
校验」类内容启发式）：它使 `sc1-<短小写标签>`（内容寻址仿冒最大敞口）逃逸校验，违反
上述两条规范文义，属 fixture 迎合而非设计。

**所需决策/路由**：Controller 排一轮 SA6 契约修订：文件 1 L91 锚 id 更名为非 `sc<digits>-`
族字符串（建议 `'fixture-anchor'`，与文件 2 的 `'narrow-interface-anchor'` 同风格），
一处字符串、零断言语义变化；修订后文件 1 方可在实现轮转绿（16 红→绿 + 9 绿保持）。
SA1 不改测试（硬门禁 1）；本设计不因 fixture 缺陷阻塞——文件 2 与生产实现不受影响，
可先行。**此项是任务内必要条件（对文件 1 验收而言），不是 follow-up。**

### 14.2 其余风险

| 风险 | 评估 | 缓解 |
|---|---|---|
| 保留族触发器未来与外部 id 方案碰撞（第三方选 `sc<digits>-` 作标签） | 低——`sc` 族已被 ADR 0015 保留为内容寻址命名空间；旧式谱系标签惯例是 `名@版本` | CONTEXT.md 词条已登记；拒绝信息（ENV_6）自解释 |
| `deriveSchemaIdentity` ok 但完整编译失败（evaluate E100 类内部缺陷文本） | 理论分歧、双通道都是「实现缺陷」语义 | §9 诚实边界记录；权威门仍是完整编译/Registry |
| ENV_6/ENV_7 进入 runtime `SCHEMA_ENVELOPE_<n>` 动态族的兼容面 | 既有透传契约覆盖（ADR 0008 L131），无 runtime 注册 | §11 矩阵；557 绿回归 |
| 指纹提前计算改变 sc1- 路径成本 | 复用于步骤⑤，总计算次数不变；mismatch 早出省 evaluate | §8.4/§9 |
| 门步骤⑤插入扰动既有 fail-fast 锚 | 步骤在方言后；既有测试零 sc 族 id | L270 顺序锚 + 557 绿 |
| ADR 0015 仍「提议」（随 PR #158 在途） | 既定集成 PR 纪律（SA8 冲突点 7） | 收官翻 accepted（总控收尾清单） |

**回滚**：纯加法包内变更——移除 index.ts 导出与 ③b 步、门步骤⑤、注册表两条、
schema-id.ts 即回到现状；无持久化/缓存/状态残留（不触 compiledCache，无落盘）。

### 14.3 Follow-up（非本票必要条件）

- ADR 0015 翻 accepted 时补一行对 ADR 0005 D1 的交叉注记（SA8 B1 遗留卫生点）+ 状态
  流转（B2）——总控收尾清单。
- 未来 REST vertical 票消费 `deriveSchemaIdentity` 并落地 422 映射（ADR 0015 错误契约）。
- 出现第二 ID 格式版本（`sc2-`）或第二指纹生产者时：升 FINGERPRINT_PREFIX v2 /
  扩保留族判定——均需新决策，本设计不含。

---

## 15. 评审修订映射

`wiki/raw/task_issue-266_sa2_review.md` 不存在（首次设计迭代，无评审输入）。SA2 攻击
评审对 D3（保留族触发器，含 14.1 的启发式拒收论证）与 D5（组合序裁决）的核对建议列为
优先项。

---

## 16. 是否需要设计后 ADR 冲突复查及理由

**需要（`requiresConflictRecheck: true`）**：

1. **新增公共 API**（`deriveSchemaIdentity` + 两类型导出）——公共接缝面变化。
2. **envelope 相位新失败语义**（ENV_6/ENV_7 两稳定码 + 保留族值域规则）——envelope
   strictness 是包声明的兼容行为；失败联合新增两个可观察分支。
3. **SA8 B1 明文要求**：门禁报告移交条件第一条即「设计后复审核对 SA1 设计未把
   『id 可校验』外溢为『引擎正确性依赖 id』或『信封 id 参与 doc/复制身份』」——本设计
   §7 D3/§9 已按 B1 纪律表述（真实性校验而非唯一性依赖；缓存键/doc 身份零涉），需 SA8
   复核确认。
4. schema ID 格式（`sc1-` canonical 形状 + 保留族）是新增冻结面，与 ADR 0015/0005/0007
   的交叉一致性属 SA8 复审辖域。

无已识别的 ADR 违反或条款重开；本设计是 ADR 0015 的兑现型切片（SA8 verdict `clear`
的同向延伸）。
