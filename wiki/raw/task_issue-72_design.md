# SA1 设计 — 功能开发：严格编译 SchemaEnvelope：compileSchemaEnvelope（Issue #72）

> R1（2026-08-22）。任务类型 feature（ADR-0007「逻辑层留在 `@nomicore/vfsl`」节的实现票：
> 新增纯函数 `compileSchemaEnvelope`——严格封闭信封 → 五阶段管线 → 双指纹 + 冻结产物五件套）。
> 输入：任务简报 `wiki/raw/task_issue-72.md`（含 SA6 红灯验收锚定节与红灯运行证据）、
> SA8 相关决议摘录 `wiki/raw/task_issue-72_relevant_decisions.md`（约束清单，ADR-0007 直接治理
> + ADR-0001/0003/0005 支撑）与冲突报告 `wiki/raw/task_issue-72_conflict_report.md`（verdict
> `clear`，备注 N1/N2/N3——N2「指纹域分离」为本设计必答收紧点）、SA6 红灯
> `packages/vfsl/test/compile-schema-envelope.test.ts`（28 用例，本会话亲跑复核 26 红 / 2 绿，
> 与简报记录逐字一致）、`packages/vfsl/src/{index,envelope,schemasource,sha256,ir,derived,
> evaluate}.ts` 现状、先例设计 `task_vfsl-schema-envelope_design.md`（H1/#52）与
> `task_docscope-compile-cache_design.md`（H3/#54）。
> 本设计不写代码；SA3 按本文件实现。设计期验证均实跑留证（§12，输出全文贴入文档）。
>
> **R2（2026-08-22，微修订轮）**：按 SA2 R1 攻击评审（verdict **pass** + 2 项 MINOR 设计
> 修订义务 + M1 设计侧论证建议，`wiki/raw/task_issue-72_sa2_review.md`）修订——**零决策
> 变更、零架构变更**，全部为文档加固：
> - **M2**：§6.3 数值确定性论证补两道既有闸门源码引用（tokenizer.ts:200-214 / parser.ts:331-335），
>   并在 D2 升级触发器清单登记「v2 方言放开数值字面量语法 ⇒ semantic 域文档必须重审并升 v2
>   前缀」（与 relevant_decisions D2 节双侧同步）；
> - **M3**：§9 边界表补「Proxy 谎报键集」两向行（隐藏多余键 → 过门但多余数据不可达产物，
>   **重建回显才是数据面安全边界**；伪造多余键 → ENV-5 保守拒绝）；
> - **M1 建议末句（设计侧文档义务）**：§6.3 补「不变式被破坏时的爆炸半径」论证段（前提经
>   SA2 R1 证据 #7/#8 独立验证：同 build 内破坏 ⇒ 仅假失效、永不假共享）。
> 逐条回应表见文末「SA2 反馈逐条回应（R2）」。

## §0. 结论速览

| # | 裁定 | 章节 |
|---|---|---|
| 1 | **对 SA6 测试契约无异议**：`compileSchemaEnvelope(input: unknown)` 同步、纯函数、不抛错，返回 `{ ok: true; envelope; module; derived; envelopeFingerprint; semanticFingerprint } \| { ok: false; issues: SchemaParseIssue[] }`——28 用例逐条复核可转绿（§10.1）；测试文件头设计假设 TH-1/TH-2/TH-3 **全部确认采纳，无需回写测试**（§1.4） | §1.3 / §10.1 |
| 2 | 五阶段管线全复用既有单点资产：envelope（`validateEnvelopeShape` 复用 + 单 issue 坍缩）→ dialect（`dialectIssueOrNull` 复用，ENV-4）→ parse（`parseVfslImplementation`，与 getCompiled 同接缝）→ evaluate（`'./evaluate.js'` 公共接缝——vi.mock 锚定的模块图边）→ internal（顶层 catch ENV-100） | §5 |
| 3 | **严格封闭 = H1 容忍门的严格超集**：新内部函数 `envelopeStrictGate`（envelope.ts），在 `validateEnvelopeShape` 复用之上叠加两个增量——(a) ENV-2/ENV-3 同类聚合结果**坍缩为单条**（首条即全部：ENV-2 优先）；(b) 新码 **ENV-5 多余键**（`Object.getOwnPropertyNames` 字符串自有键差集非空）。`envelopeTextGate`（H1 容忍门）**零改动**——两门共存是 AC 锁定的契约差异，非实现漂移（§3.5） | §3 |
| 4 | 新内部模块 `packages/vfsl/src/fingerprint.ts`（~70 行）：双指纹双域构造**同址单模块**——`envelopeFingerprintOf`（恰四键按 v1-spec §7 表序紧凑 JSON 的摘要）+ `semanticFingerprintOf`（`{domain:'vfsl-semantic', lang, version, module}` 域标签文档的摘要）。编排函数本体落 `index.ts`（沿 H1/H3「编排与 parseVfsl 同址」纪律，~85 行增量） | §2 / §6 |
| 5 | **N2 域分离的构造性落实**：两指纹的哈希输入是两个**字符串层不相交的文档语言**——envelope 域文档键集 `{lang,version,id,text}`、首键恒 `"lang"`；semantic 域文档键集 `{domain,lang,version,module}`、首键恒 `"domain"`。两语言无公共字符串 ⇒ 同输入下双指纹互异是**构造性保证**（非概率性），测试锚恒成立；semantic 侧显式域标签防未来其他哈希用途混域（§6.2） | §6.2 |
| 6 | **semantic 指纹 = `lang + version +` 规范 IR 的直接 JSON**：敏感性全部由 IR 既有纪律承担（trivia 丢弃→忽略空白/普通注释；`docs[]` 原文→保留 JSDoc；数组声明序→保留声明顺序；不含 id→排除谱系标签），零文本重解析、零第二规范化层。canonical = 单一生产者（parseVfsl）插入序 + JSON.stringify 紧凑形，**不引入排序序列化器**（单一生产者不变式论证，§6.3） | §6.3 / §6.4 |
| 7 | 深冻结：**一趟 `deepFreeze(result)`**（index.ts 既有私有助手复用，WeakSet 防环）——容器 + envelope + module + derived 递归**原地**冻结；`Object.freeze` 不复制 ⇒ 共享引用（`index['ROOT'].node === structure` 等）冻结后仍同一；严格模式赋值抛 TypeError（loud） | §7 |
| 8 | **无缓存纯函数**：不读不写 `compiledCache`（与 getCompiled 零交互），无任何新增模块级状态；每次调用全新对象图 ⇒ 同文本两次编译引用互异、值确定（AC6） | §8 |
| 9 | 对既有代码**纯增量**：envelope.ts 加 1 码（ENV-5）+ 1 函数，既有函数逐字不动；index.ts 追加编排 + 类型导出；fingerprint.ts 新建；`getCompiled`/`compiledCache`/`deepFreeze` 行为零变化；公共类型 `SchemaEnvelopeIssueCode` 加法扩展 `'5'`（grep 实证无穷尽消费方，§13）；包版本 0.2.0 → 0.2.1 | §2 / §13 / §14 |

---

## §1. 需求推演（Feature：切入点与契约复核）

### 1.1 定位

Issue #72 是 ADR-0007「逻辑层留在 `@nomicore/vfsl`」一节的直接实现票。该节逐句定义了本票
全部契约（相关决议文档已摘录）：

- 「新增纯函数 `compileSchemaEnvelope(input: unknown)`：输入必须是严格封闭且恰含
  `lang/version/id/text` 的信封；按 envelope、dialect、parse、evaluate、internal 分阶段
  返回结果联合。」
- 「编译成功产物包含冻结的 envelope、IR module、DerivedSchema、`envelopeFingerprint` 与
  `semanticFingerprint`。」
- 「指纹使用 SHA-256、UTF-8、canonical JSON 和带版本的 domain separation
  （`sha256:v1:<hex>`）……」
- 「module/derived 递归深冻结后才允许未来跨 namespace 共享；本阶段不实现编译缓存……」

CONTEXT.md 术语条目进一步锚定命名与定位：`compileSchemaEnvelope` 正是「编译器（compiler）」
条目预留的组合入口（「文本 → IR → 派生 schema 的组合入口（Phase 1 contract 包）」——命名用
compile 合规；行文中 parse/evaluate 各段不得称「编译器」）。下游去处已由 ADR-0006 交会条款
预告（「loadDoc → 读 SCHEMA → DocScope.getCompiled → 可校验」——本票产物即 DocScope 未来
缓存的 value 形态；本票不做缓存）。

**与 H1（#52 parseSchemaEnvelope）/ H3（#54 getCompiled）的关系**：三者是同一信封消费链的
三个逐级收紧入口——

| 入口 | 信封纪律 | 文本处理 | 产物 | 缓存 |
|---|---|---|---|---|
| `parseSchemaEnvelope`（H1） | 形状校验（多余键**容忍**，ENV-2/3 同类聚合至多 2 条） | parseVfsl | envelope + module | 无 |
| `getCompiled`（H3） | H1 容忍门（信封或裸文本入参） | parseVfsl + evaluate | module + derived | 进程级按文本哈希 |
| `compileSchemaEnvelope`（本票） | **严格封闭恰四键，恒单 issue fail-fast** | parseVfsl + evaluate | **五件套**（envelope + module + 派生 schema + 双指纹），**递归深冻结** | **无**（ADR-0007 阶段条款） |

本票不是 H1/H3 的替换者（两者契约各自被测试冻结，一行不动），是 ADR-0007 为 Phase 2
NamespaceRuntime 定义的**第三个、也是最严格的**编译入口：普通 open 管线的第一步
（「普通 open 必须依次完成 schema 编译、META 身份检查……」——schema 编译即调本函数）。

### 1.2 与既有架构的一致性（复用清单）

架构原则：**管线五段全部复用既有单点资产，本票只新增三件**（严格门、指纹双域、编排）。

| 既有资产 | 位置 | 本票用法 | 单点价值 |
|---|---|---|---|
| `validateEnvelopeShape` | envelope.ts:97 | envelope 阶段形状扫描（ENV-1/2/3，含单读物化防敌意 getter） | 四键 typeof 判定不分叉 |
| `dialectIssueOrNull` | envelope.ts:180 | dialect 阶段（ENV-4，内部复用 `assertVfslDialect` 单点） | 方言冻结纪律单点（未来 v2 升级一处生效） |
| `makeEnvelopeIssue` + sanitizer | envelope.ts:50 | ENV-1..5/100 全部 issue 唯一构造点（单行保证） | 消息前缀/转义纪律不旁路 |
| `envelopeCrashIssue` | envelope.ts:232 | internal 阶段 ENV-100 构造 | 崩溃边界 detail 守卫复用（F1 修复遗产） |
| `parseVfslImplementation` | index.ts:114 | parse 阶段（与 getCompiled 同接缝，不绕公共壳） | parse 管线单实现 |
| `evaluate`（`'./evaluate.js'` import） | index.ts:49 | evaluate 阶段——**必须走该模块图边**（vi.mock 锚定面，§5.3） | 求值接缝单点（ADR-0003 §1） |
| `sha256Hex` | sha256.ts:65 | 双指纹摘要（FIPS KAT 已被测试锚定） | 纯 TS 单射字节化实现复用 |
| `deepFreeze` | index.ts:272 | 冻结（第二个消费方；getCompiled 行为零变化） | 原地冻结 + WeakSet 防环单实现 |
| `vfslIssues` | envelope.ts:218 | parse/evaluate 原生 issues 的 `kind:'vfsl'` 包装 | 包装语义单点 |
| 类型 `SchemaEnvelope`/`VfslModule`/`DerivedSchema`/`SchemaParseIssue` | schemasource/ir/derived/envelope.ts | 结果联合直接复用 | 不造第二信封/IR/派生 schema 形状 |

领地划分沿 H1 §1.2 错误通道三分：本票失败联合 `SchemaParseIssue[]` 与 H1/H3 完全同型
（`kind:'envelope'` ENV 域 / `kind:'vfsl'` 原生文本域）——「底层能力各自保留领域化结果联合，
不合并成巨型 issue 类型；NamespaceRuntime/Registry 再映射成稳定的上层错误」（ADR-0007
Runtime 编排边界条款）——本票正是该条款的底层侧落法，**不新增第三种 issue 形状**。

### 1.3 SA6 契约复核（结论：无异议，逐条可满足）

| SA6 锚定（28 用例归组） | 本设计落点 | 结论 |
|---|---|---|
| AC1 恰四键 fail-fast：缺键 ENV-2 / 类型错 ENV-3 / 多余键（严于 H1）/ 非对象 ENV-1，各单条；缺+类型并存仍单条；形状先于方言先于文本 | §3 严格门（坍缩 + ENV-5）+ §5 编排顺序 | 满足 |
| AC2 分阶段：dialect 单条 ENV-4 readOnly；parse 原生数组与 parseVfsl 同输入深相等；evaluate mock 注入经返回值通道逐条保留；internal 对抗 Proxy 绝不外抛单条 ENV-100 | §5 编排 + evaluate 接缝边 + 顶层 catch | 满足 |
| AC3 双指纹 `sha256:v1:<hex>`；envelope 精确摘要 = 四键表序 canonical JSON；KAT 防循环；键序打乱归一化；域分离互异 | §6（V8/V9/V12 实证） | 满足 |
| AC4 敏感性：仅 id 变→envelope 变 semantic 不变；仅 trivia 变→envelope 变 semantic 不变；仅 JSDoc 变→semantic 变；仅顺序变→semantic 变 | §6.4 敏感性矩阵（V1/V2/V3 实证机制根源） | 满足 |
| AC5 envelope/module/derived 递归深冻结（WeakSet 防环遍历）；共享引用不被复制破坏；ref 按名不内联；冻结赋值抛 TypeError | §7（V4 系列实证） | 满足 |
| AC6 无缓存：同文本两编引用互异值确定；失败编译无顺序依赖；package.json 零运行时依赖；公共导出可直调 | §8 纯度论证 | 满足 |
| 幸福路径：五件套与 parseVfsl+evaluate 直编一致 | §5 透传（引用直通 + 冻结不改值语义） | 满足 |

### 1.4 测试文件头设计假设裁决（TH-1/TH-2/TH-3）

红灯测试文件头声明了三条设计假设「供 SA1 对照；若设计另有裁决须回写本文件并走修订轮」。
为避免与历史票号 H1/H3 混淆，本文件称之为 **TH-1/TH-2/TH-3**。裁决：**三条全部确认采纳，
设计与之零偏离，无需回写测试文件**。

| 假设 | 裁决 | 落点 |
|---|---|---|
| **TH-1** envelope 指纹 canonical JSON = 四键按 v1-spec §7 冻结表序（lang, version, id, text）紧凑序列化（JSON.stringify 语义），hex 段 = sha256Hex(canonical 文档) | **确认采纳（逐字）**。`envelopeFingerprintOf` 以四键字面量（表序）构造 `JSON.stringify` 输入，摘要即 `sha256:v1:<hex>`。lang/version 两键的覆盖由精确摘要断言间接锚定（成功路径方言门禁只放行 vfsl@1，无法变体验证——测试已自知并如此设计） | §6.1 |
| **TH-2** semantic 指纹不锁精确字节（规范 IR 的 canonical 形态属 SA1 设计自由度），以格式 + 确定性 + 行为敏感性锚定；域分离以两域内容不同源 + 双指纹互异锚定 | **确认采纳**。本设计在该自由度内定式为 `{domain:'vfsl-semantic', lang, version, module}` 的 JSON 文档（§6.2/§6.3），测试对此无字节锚——任何满足敏感性矩阵的形态均绿 | §6.2–§6.4 |
| **TH-3** 失败联合的阶段区分以可观测 issue 内容判别（envelope/dialect/internal 为 `kind:'envelope'` 单 issue + code 区分；parse/evaluate 为原生 VfslIssue 形状数组），不强锁显式 stage 字段 | **确认采纳（不加 stage 字段）**。失败形状与 H1/H3 完全同型（`SchemaParseIssue[]`），阶段判别式 = kind + code（§5.2 判别表）。加 stage 字段会分叉三接缝的失败类型，违「底层领域化结果联合」条款 | §5 / §5.2 |

### 1.5 SA8 备注落实定位

- **N2（收紧点，必答）**：域分离在 §6.2 以「文档语言构造性不相交」落实——超出简报字面
  （`sha256:v1:<hex>` 格式）的显式设计，是本设计核心章节之一。
- **N1**：不实现缓存 → §8 纯度论证 + 不触碰 `compiledCache`。
- **N3**：行文纪律——散文用「派生 schema」，代码类型名沿 ADR-0007 原文 `DerivedSchema`；
  parse/evaluate 各段不称「编译器」，`compileSchemaEnvelope` 是组合入口。

---

## §2. 模块设计：布局与公共面

### 2.1 文件布局与依赖边

```
新增  packages/vfsl/src/fingerprint.ts   （~70 行：双指纹双域构造，单模块同址）
修改  packages/vfsl/src/envelope.ts      （+~45 行：ENV_5 注册 + envelopeStrictGate）
修改  packages/vfsl/src/index.ts         （+~85 行：compileSchemaEnvelope 编排 + 类型导出）
修改  packages/vfsl/package.json         （版本 0.2.0 → 0.2.1）
```

依赖边（全部无环）：

- `fingerprint.ts → sha256.js`（运行时 sha256Hex）+ `schemasource.js`/`ir.js`（仅类型）。
  fingerprint.ts **零 index 依赖**（叶子侧），与 sha256.ts 同级的纯计算件。
- `envelope.ts` 增量零新依赖（ENVELOPE_KEYS 既有、`Object.getOwnPropertyNames` 内建）。
- `index.ts → fingerprint.js`（新 import）+ 既有 envelope/evaluate import 复用。

**为什么编排仍在 index.ts 而非新 compile.ts**：编排需要 `parseVfslImplementation`，其实现与
导出按既定布局在 index.ts（ir.ts:5 注释明示；H1 §2.1 同款论证——envelope.ts 若 import index
即成模块环，H3 的 getCompiled 因此也落在 index.ts）。抽 parseVfslImplementation 到独立模块属
无收益的结构迁移（动 23 个存量测试文件共同锚定的公共面所在文件），本票不做。编排同址纪律
> 文件美学。

**为什么指纹单独成模块而非并入 envelope.ts**：双指纹双域是 N2 收紧点的全部内容——两域构造
同址一个 ~70 行小模块，评审/审计单点（「域分离怎么落实的」一个文件答完）；envelope.ts 的
职责边界是「信封解析与方言路由」（文件头自述），指纹是正交新关注点。且 fingerprint.ts 只依赖
sha256/类型叶子，不携 schemasource 的 node:fs 传递依赖面（index 本就携带，无回归，仅为不
扩散）。

### 2.2 fingerprint.ts（签名级伪代码，实现细节 SA3 自由度内）

```ts
// packages/vfsl/src/fingerprint.ts
import { sha256Hex } from './sha256.js';
import type { SchemaEnvelope } from './schemasource.js';
import type { VfslModule } from './ir.js';

/**
 * 指纹输出前缀（ADR-0007「带版本的 domain separation（sha256:v1:<hex>）」的外显格式，
 * 两域共用）。`v1` = 摘要算法（SHA-256）+ 域文档形态（§6.1/§6.2 冻结形状）的联合版本号；
 * 未来任一者演进 → 升 v2 前缀，旧指纹天然失效不混淆。
 */
const FINGERPRINT_PREFIX = 'sha256:v1:';

/**
 * semantic 域自述标签（域分离 semantic 侧构造件，§6.2）：域文档首键，envelope 域文档
 * 键集不含 domain/module ⇒ 两域文档语言字符串层不相交。
 */
const SEMANTIC_DOMAIN_TAG = 'vfsl-semantic';

/**
 * envelope 域指纹：恰四键按 v1-spec §7 冻结表序（lang, version, id, text）紧凑序列化
 * （JSON.stringify 语义）后的 SHA-256。字面量键序即 canonical——不依赖调用方传入对象
 * 的键序（§6.1 canonical 三层含义）。
 */
export function envelopeFingerprintOf(envelope: SchemaEnvelope): string {
  const canonical = JSON.stringify({
    lang: envelope.lang,
    version: envelope.version,
    id: envelope.id,
    text: envelope.text,
  });
  return `${FINGERPRINT_PREFIX}${sha256Hex(canonical)}`;
}

/**
 * semantic 域指纹：`lang + version +` 规范 IR 组成的域标签文档
 * `{ domain: 'vfsl-semantic', lang, version, module }` 紧凑 JSON 序列化后的 SHA-256。
 * module 恒为本次编译内 parseVfsl 刚产出的 IR（单一生产者不变式，§6.3）；
 * 不含 id（ADR-0005：id 是标签不是键）。
 */
export function semanticFingerprintOf(lang: string, version: number, module: VfslModule): string {
  const canonical = JSON.stringify({ domain: SEMANTIC_DOMAIN_TAG, lang, version, module });
  return `${FINGERPRINT_PREFIX}${sha256Hex(canonical)}`;
}
```

模块内部件（`FINGERPRINT_PREFIX`/`SEMANTIC_DOMAIN_TAG` 不上公共面——指纹**值**是公共契约
（格式+摘要语义），指纹**构造函数**不是接缝；`sha256Hex` 同款先例：KAT 测试直连
`../src/sha256.js`，不走 index）。

### 2.3 envelope.ts 增量（严格门）

```ts
// packages/vfsl/src/envelope.ts 追加（既有函数/常量逐字不动）：

/** 信封层错误码注册表增量行（并入既有 EnvelopeErrCode）： */
//   ENV_5: '5',  // 多余键（严格封闭：恰含四键——issue #72 compile 入口专属）

/** 恰四键集合（由 ENVELOPE_KEYS 派生，不重复手写键名——四键契约单源）。 */
const ENVELOPE_KEY_SET = new Set(ENVELOPE_KEYS.map((entry) => entry.key));

/**
 * #72 严格编译前缀单点（形状 → 封闭 → 方言）：validateEnvelopeShape 复用（ENV-1/2/3，
 * 同类聚合 + 单读物化）→ 编译入口单 issue 坍缩 → 严格封闭 ENV-5 → dialectIssueOrNull
 * 复用（ENV-4）。与 envelopeTextGate（H1 容忍门）的差异面恰为 #72 的 AC 增量
 * （恰四键 + 恒单条），见设计 §3.5。纯函数；对抗 getter/Proxy 可抛出——由公共入口
 * （compileSchemaEnvelope）顶层崩溃边界收编 ENV-100。
 */
export function envelopeStrictGate(
  input: unknown,
): { ok: true; envelope: SchemaEnvelope } | { ok: false; issues: SchemaParseIssue[] } {
  // ① 形状（ENV-1 早出 / ENV-2+3 同类聚合）——复用 H1 扫描单点
  const shape = validateEnvelopeShape(input);
  if (!shape.ok) {
    // ② 编译入口单 issue 坍缩：首条即全部（ENV-2 优先于 ENV-3，§3.3）；信息不丢——
    //    ENV-2/ENV-3 消息各自列全该类全部问题（envelope.ts 既有聚合消息）
    const first = shape.issues[0] as SchemaEnvelopeIssue;
    return { ok: false, issues: [{ kind: 'envelope', issue: first }] };
  }
  // ③ 严格封闭（ENV-5）：own 字符串键（含不可枚举；symbol 键不在数据面，§3.4）恰为四键
  const extra = Object.getOwnPropertyNames(input as object).filter(
    (key) => !ENVELOPE_KEY_SET.has(key),
  );
  if (extra.length > 0) {
    return {
      ok: false,
      issues: [
        {
          kind: 'envelope',
          issue: makeEnvelopeIssue(
            EnvelopeErrCode.ENV_5,
            `信封多余键: ${extra.join('、')}（严格封闭：恰含 lang, version, id, text 四键）`,
          ),
        },
      ],
    };
  }
  // ④ 方言（ENV-4）——复用断言单点
  const dialect = dialectIssueOrNull(shape.envelope);
  if (dialect !== null) {
    return { ok: false, issues: [{ kind: 'envelope', issue: dialect }] };
  }
  return { ok: true, envelope: shape.envelope };
}
```

### 2.4 index.ts 编排与公共面导出

```ts
// packages/vfsl/src/index.ts 追加（既有导出与函数逐字不动）：
// 头部新增 import：
//   import { envelopeStrictGate } from './envelope.js';        // 严格编译前缀（§2.3）
//   import { envelopeFingerprintOf, semanticFingerprintOf } from './fingerprint.js';

/** compileSchemaEnvelope ok 分支：五件套（ADR-0007）。三者深冻结（§7）；指纹格式 §6。 */
export interface CompileSchemaEnvelopeOk {
  ok: true;
  envelope: SchemaEnvelope;      // 恰四键重建 + 冻结
  module: VfslModule;            // parseVfsl ok 产物（IR）+ 冻结
  derived: DerivedSchema;        // evaluate ok 产物（派生 schema）+ 冻结
  envelopeFingerprint: string;   // sha256:v1:<hex>（§6.1）
  semanticFingerprint: string;   // sha256:v1:<hex>（§6.2）
}

/** 公共返回形状：失败 issues 与 parseSchemaEnvelope/getCompiled 同域（SchemaParseIssue[]）。 */
export type CompileSchemaEnvelopeResult =
  | CompileSchemaEnvelopeOk
  | { ok: false; issues: SchemaParseIssue[] };

/**
 * ADR-0007 组合入口：严格封闭信封 → envelope → dialect → parse → evaluate 五阶段
 * 结果联合；成功返回冻结五件套；internal 崩溃边界 ENV-100 绝不外抛。
 * 同步、纯函数、无缓存（§8）。实现见 §5。
 */
export function compileSchemaEnvelope(input: unknown): CompileSchemaEnvelopeResult;
```

公共面新增 **1 值导出 + 2 类型导出**（`compileSchemaEnvelope` / `CompileSchemaEnvelopeResult` /
`CompileSchemaEnvelopeOk`）。`envelopeStrictGate`/`envelopeFingerprintOf`/
`semanticFingerprintOf` 保持模块内部（沿 H1 对 validateEnvelopeShape 同款裁定：导出无消费方
形状只会冻结尚不存在的接缝）。

---

## §3. 信封严格封闭校验（envelope 阶段规则冻结）

### 3.1 输入门与形状扫描（全复用）

ENV-1（非对象/数组早出）、ENV-2（缺键同类聚合、消息列全）、ENV-3（类型错同类聚合、消息列全）、
typeof 分界线（`version:'1'` 是形状错 ENV-3；`version:2`/`NaN`/`1.5` 是方言域 ENV-4）、
own-key 判定（`Object.hasOwn`，原型链来源拒绝）、单读物化（敌意 getter 两次读值不一致无法
进入回显）——全部由 `validateEnvelopeShape` 既有行为承担（H1 §3 冻结，测试锚定），本票零
重述零改动。

### 3.2 单 issue 坍缩（编译入口的 AC2 明文契约）

编译入口 envelope 阶段**恒单条**：`validateEnvelopeShape` 的同类聚合结果（至多 2 条：
[ENV-2, ENV-3]）取**首条**。

- 优先序 **ENV-2 > ENV-3**：缺键优先于类型错。依据：(a) envelope.ts 构造序（missing 先
  push——坍缩取 `[0]` 即得，无需重排序逻辑）；(b) 语义——缺键时「这份连结构都不完整」，
  类型错误的诊断要以键存在为前提；(c) H1 混合输入对照实测首条恰为 ENV-2（§12 V11）。
- **信息不丢的准确表述**：坍缩丢的是「跨类并存」的并集呈现（AC2 明文要求单条——严于 H1
  的同类聚合），**不丢类内信息**——ENV-2 消息列全全部缺失键、ENV-3 消息列全全部类型错
  （既有聚合消息）。单条 + 类内列全 = fail-fast 与诊断性的平衡点，AC2 亲自裁定。
- 非对象输入：`validateEnvelopeShape` ENV-1 早出单条，坍缩取 `[0]` = ENV-1 本身，天然满足。

### 3.3 严格封闭 ENV-5（本票新增码）

- **判据**：`Object.getOwnPropertyNames(input)`（own **字符串**键，含不可枚举）差集
  `FOUR_KEYS` 非空 → ENV-5 单条，消息列全多余键（`extra.join('、')`，排序 =
  `getOwnPropertyNames` 返回序 = 整数键升序 + 字符串键插入序，确定性）。
- **时机**：形状通过之后、方言之前（形状错误先于封闭错误先于方言裁决——缺键/类型错时
  多余键诊断无意义；封闭错误是「数据面」错误，与方言「自述身份」正交且先于它，测试锚
  `code !== '4'` + 形状先于方言的顺序锚共同锁定本序）。
- **对既有四键的排除**：`ENVELOPE_KEY_SET` 由 `ENVELOPE_KEYS` 派生（`.map`）——四键契约
  单源，未来若 v2-spec 改键集（只增不改方言纪律下不太可能），一处改处处改。

### 3.4 symbol 键裁定（设计自由度，显式记录）

ENV-5 扫描**不含 symbol 键**（`getOwnPropertyNames` 语义即字符串键）。依据：

- 信封是**纯 JSON 数据契约**（v1-spec §7 形状；CONTEXT.md「单字符串值、原子替换、可哈希、
  可 diff」）——symbol 键在 JSON 序列化面不可见、在双指纹面不可见（envelope 指纹只摘要四键
  值、semantic 指纹不摘要信封）、在 `toEqual` 断言面不可见。拒绝一个对一切可观测行为零影响
  的键维度 = 严格性表演，无身份意义。
- H1 容忍门先例（H1 §7 边界表「多余键（含 symbol 键）→ 忽略」）在容忍侧同款排除——两门
  在 symbol 维度行为一致（都不以 symbol 拒绝），差异面收窄到字符串多余键，评审面积更小。
- 不可枚举字符串键**计入**（`getOwnPropertyNames` 含之）：它是自有属性（`Object.hasOwn`
  四键判定同认不可枚举），两侧判据对称——四键判定认的维度，封闭判定也认。

### 3.5 双门共存论证（预防「决策点分叉」攻击）

`envelopeTextGate`（H1 容忍门：多余键放行、ENV-2/3 聚合至多 2 条）与 `envelopeStrictGate`
（本票严格门：ENV-5 拒绝、恒单条）**并存且都保留**：

- 两门共享同一底层决策点：形状扫描（`validateEnvelopeShape`）与方言断言
  （`dialectIssueOrNull`→`assertVfslDialect`）——**语义判定无分叉**。
- 差异面（封闭性 + issue 条数）不是实现漂移，是**两票 AC 各自冻结的契约差异**：H1 测试锚
  「多余键 → ok:true 四键回显」「缺+类型错并存 → 2 条」；#72 测试锚「多余键 → 单条非 ENV-4」
  「缺+类型错并存 → 1 条」。收敛两门 = 必改其一契约 = 必红其一测试。
- 消费方定位不同：容忍门服务 parseSchemaEnvelope（信封解析透传）与 getCompiled（缓存门面，
  键为文本哈希、多余键无身份影响故容忍无害）；严格门服务 compileSchemaEnvelope（ADR-0007
  「输入必须是严格封闭且恰含四键」明文）。未来 v2 若收敛，须 ADR 层裁决，非实现层默认。

---

## §4. 方言路由（dialect 阶段）

全复用 `dialectIssueOrNull`（envelope.ts:180）：内部 `assertVfslDialect` 单点断言
（`lang === 'vfsl' && version === 1`），`SchemaSourceError('dialect-mismatch')` 就地转译
ENV-4（readOnly: true，消息前导「未知方言（只读 loud-fail，不解释 text）」——测试锚
`/^VFSL-ENV-E4: 未知方言/`）。本票零改动、零重述（H1 §4 全部论证——断言单点复用、转译条件
收窄、消息内嵌原消息、sanitizer 后置——原样有效并继承）。

关键控制流事实（AC1 顺序锚的机制根源）：未知方言时 `parseVfslImplementation` **根本不被
调用**——「只读 loud-fail、不解释文本」不是注释承诺而是控制流事实；恶意超长 text 在
dialect 阶段零 tokenize 成本。

---

## §5. 编排（index.ts 本体：五阶段管线）

```ts
// packages/vfsl/src/index.ts，紧跟 getCompiled 之后（~85 行含注释）：
export function compileSchemaEnvelope(input: unknown): CompileSchemaEnvelopeResult {
  // 全函数体顶层崩溃边界（internal 阶段）：正常路径无可抛点（严格门/parse/evaluate 各有
  // 自身通道；指纹为纯读取+纯循环；deepFreeze 递归深度被 MAX_TYPE_NESTING=100 结构性
  // 封顶——H3 已论证 SA2 已核查），此 catch 收编对抗 getter/Proxy 与不可达实现缺陷
  // → ENV-100 结构化返回，绝不外抛（AC2-internal 锚：await 不以 rejection 失败）。
  try {
    // ① envelope + ② dialect 阶段：严格编译前缀单点（ENV-1/2/3 坍缩单条 → ENV-5 → ENV-4）
    const gate = envelopeStrictGate(input);
    if (!gate.ok) {
      return { ok: false, issues: gate.issues };
    }
    // ③ parse 阶段：与 getCompiled 同接缝（parseVfslImplementation）；原生 issues 数组
    //    零损保留（kind:'vfsl' 包装，与 parseVfsl 同输入深相等——引用同源）
    const parsed = parseVfslImplementation(gate.envelope.text);
    if (!parsed.ok) {
      return { ok: false, issues: vfslIssues(parsed.issues) };
    }
    // ④ evaluate 阶段：经 './evaluate.js' 公共接缝（本文件顶部既有 import 绑定——
    //    vi.mock 锚定的模块图边，§5.3）；失败原生数组零损透传（AC2-evaluate）
    const evaluated = evaluate(parsed.module);
    if (!evaluated.ok) {
      return { ok: false, issues: vfslIssues(evaluated.issues) };
    }
    // ⑤ 双指纹（成功路径才有；冻结前计算——纯读取，字符串产物冻结无语义）
    const envelopeFingerprint = envelopeFingerprintOf(gate.envelope);
    const semanticFingerprint = semanticFingerprintOf(
      gate.envelope.lang,
      gate.envelope.version,
      parsed.module,
    );
    // ⑥ 递归深冻结：一趟覆盖容器 + envelope + module + derived（§7）；原地冻结保持
    //    共享引用；每次调用全新对象图（不触碰 compiledCache，§8）
    const result: CompileSchemaEnvelopeOk = {
      ok: true,
      envelope: gate.envelope,
      module: parsed.module,
      derived: evaluated.derived,
      envelopeFingerprint,
      semanticFingerprint,
    };
    return deepFreeze(result, new WeakSet<object>());
  } catch (err) {
    return { ok: false, issues: [{ kind: 'envelope', issue: envelopeCrashIssue(err) }] };
  }
}
```

### 5.1 顺序即语义（五阶段的控制流冻结）

1. **envelope（ENV-1/2/3/5）先于一切**：键缺失/类型错/多余键时连「自述什么方言」都谈不上；
2. **dialect（ENV-4）先于 parse**：未知方言不解释文本（§4）；形状错 + 方言错 + 语法错并存
   → 形状错先赢（严格门在 parse 之前短路）——测试混合输入顺序锚的机制根源；
3. **parse 先于 evaluate**：语法错误的 issues（含行列）原生保留，evaluate 根本不被调用；
4. **internal（ENV-100）是横切兜底**：不是第五个串行判定，是全函数体顶层 catch——任何阶段
   的意外异常（对抗 Proxy 的 get trap 在严格门扫描抛出——§12 V7 实证；未来新增件的缺陷）
   统一收编为单条 ENV-100，`await compileSchemaEnvelope(...)` 永不以 rejection 结算。
5. **指纹与冻结仅在成功路径**：失败产物（issues 数组）不冻结、不摘要——失败无缓存无共享
   （ADR-0007「本阶段不实现编译缓存」；H3「失败不落缓存可重试」同款语义在无缓存下的自然
   形态：每次失败调用独立重算）。

### 5.2 阶段 ↔ 可观测 issue 映射（TH-3 判别式）

| 阶段 | ok:false 可观测形态 | 判别式 |
|---|---|---|
| envelope | `issues` 恰 1 条，`kind:'envelope'`，code ∈ {1,2,3,5}，readOnly false | code |
| dialect | `issues` 恰 1 条，`kind:'envelope'`，code = 4，readOnly true | code + readOnly |
| parse | `issues` ≥ 1 条，全 `kind:'vfsl'`，VfslIssue 形状（message/line/column） | kind |
| evaluate | 同 parse（求值期 issues 原生形状） | kind |
| internal | `issues` 恰 1 条，`kind:'envelope'`，code = 100 | code |

### 5.3 evaluate 接缝边（vi.mock 兼容性的结构性保证）

测试以 `vi.mock('../src/evaluate.js')` 包裹求值接缝注入一次性失败——「编译入口无论从哪个
文件组合 evaluate 都必经该接缝」。本设计的结构性保证：index.ts **既有**顶部
`import { evaluate } from './evaluate.js'`（index.ts:49）即被 mock 的模块图边；§5 编排调用
的正是该绑定（不 import evaluate.ts 内部函数、不重复 import、不内联求值逻辑）。
docscope-getcompiled.test.ts 对 getCompiled（同文件同 import）已验证此机制——本票继承同一
证明。**SA3 实现约束：编排内对求值的调用必须用该 import 绑定名，不得另开调用路径。**

---

## §6. 指纹规格（N2 域分离的核心章节）

### 6.1 envelope 域指纹（TH-1 逐字落地）

**摘要输入**（canonical 三层含义逐层冻结）：

1. **键序**：恰四键按 v1-spec §7 冻结表序 `lang, version, id, text`——由
   `envelopeFingerprintOf` 内**字面量键序**构造（不依赖传入对象的键序——键序打乱归一化
   锚的机制根源：严格门回显的 envelope 是重建对象，其键序 = 构造序 = 表序，§12 V9 实证）；
2. **序列化**：`JSON.stringify` 紧凑语义（无空白分隔；字符串值按 ECMAScript JSON 转义
   ——QuoteProduction 冻结，同一字符串恒同一转义）；
3. **字节化**：`sha256Hex` 的 UTF-8 单射字节化（合法码点 RFC 3629 + lone surrogate
   WTF-8 段，sha256.ts §D8.2 冻结——全字符串空间单射，无坍缩）。

**输出**：`sha256:v1:` + 64 位小写 hex。

**覆盖性**：四键全参与摘要——`id`/`text` 可经成功路径变体验证（AC4 前两组锚）；
`lang`/`version` 成功路径恒 `'vfsl'`/`1`（方言门禁），由测试的**精确摘要断言**间接锚定
（摘要算法覆盖全部四键 ⇒ 改任一键必变摘要——SHA-256 雪崩）。这正是 TH-1 声明的锚定策略，
本设计照单落实。

**为什么 envelope 域文档不带域标签**：域身份由其**冻结形状本身**承担——v1-spec §7 恰四键
形状是已冻结的文档语言，其首键恒 `"lang"`；且测试精确摘要锚（TH-1）把摘要输入逐字节锁死
为四键 JSON，加任何标签都会改变摘要、直接红测试。域分离不靠 envelope 侧加标签，靠两域
文档语言的不相交性（§6.2）。

### 6.2 semantic 域指纹与域分离（N2 的构造性落实）

**摘要输入**：域标签文档 `{ domain: 'vfsl-semantic', lang, version, module }` 的
`JSON.stringify` 紧凑序列化（module = 规范 IR 原样参与，见 §6.3）。

**N2 域分离的三层落实**：

| 层 | 机制 | 效果 |
|---|---|---|
| **外显格式层** | 两指纹同用 `sha256:v1:<hex>` 前缀——`v1` 是摘要算法 + 域文档形态的联合版本号（ADR-0007 原文「带版本的 domain separation（`sha256:v1:<hex>`）」即指此格式） | 指纹值一眼可辨算法代际；未来摘要算法或文档形态演进 → v2 前缀，跨代指纹不混淆 |
| **文档域层（核心）** | 两指纹的哈希输入是两个**构造上不相交的文档语言**：envelope 域文档键集 `{lang, version, id, text}`、首键恒 `"lang"`、无 `domain`/`module` 键；semantic 域文档键集 `{domain, lang, version, module}`、首键恒 `"domain"`、domain 恒 `'vfsl-semantic'`、无 `id`/`text` 键 | 两语言**无公共字符串**（首键即异，第二字符起分叉）⇒ 同一输入下 `envelopeFingerprint !== semanticFingerprint` 是**构造性保证**（非概率性）——测试域分离锚恒成立的机制根源（§12 V12 实证）。反向也不可伪造：不存在任何信封使两域摘要相同 |
| **用途层** | envelope 指纹 = 观察命名空间当前信封是否变化（CONTEXT.md 术语条目：覆盖谱系 id 与内容 text）；semantic 指纹 = 共享编译语义产物的身份（覆盖方言身份 + 规范 IR） | 两域消费者不同：仅 id 变时 envelope 指纹变（须重观察）而 semantic 指纹不变（可继续共享语义产物）——ADR-0005「id 是标签不是键」在指纹层的兑付；混用两域会在该场景产生假失效/假共享 |

**semantic 侧显式域标签的理由**：envelope 域文档是 v1-spec §7 既有冻结形状（身份自述，
且被精确摘要锚锁死不能加标签）；semantic 域文档是本票**新定义**的文档语言——从第一天
携带自述标签 `domain:'vfsl-semantic'`，把「这是语义域文档」写进被摘要的内容本身，防未来
任何其他哈希用途（DocScope 缓存键演进、投影指纹等）构造出与 semantic 域同形文档造成跨域
碰撞。标签常量 `SEMANTIC_DOMAIN_TAG` 与两指纹构造同址 fingerprint.ts——N2 的落实单文件
审计。

**与 getCompiled 缓存键的关系（预防混淆攻击）**：H3 缓存键 = `sha256Hex(text)` **裸 hex
无前缀**（H3 冻结契约）；本票双指纹 = `sha256:v1:` 前缀 + 域文档摘要。两者格式命名空间
不同（有无前缀）、摘要输入不同（裸文本 vs 域文档）——三个哈希域（envelope 指纹 / semantic
指纹 / 缓存键）两两不同源，互不冒用。

### 6.3 规范 IR 的 canonical 形态（单一生产者不变式）

semantic 指纹直接摘要 `parseVfsl` 产出的 module（`JSON.stringify(module)`），
**不引入第二规范化层**（不排序键、不重排数组、不剥离字段）。合法性论证：

- **单一生产者不变式**：被摘要的 module 恒为**本次编译内 `parseVfslImplementation` 刚产出**
  的对象（§5 编排第 ③→⑤ 步直通）——从不哈希任何外部传入的 IR。对象的键插入序由
  parser/semantic 的构造点字面量固定（如每个 `VfslAlias` 恒 `{kind, name, docs, type}` 序），
  与输入文本的排版无关 ⇒ 同语义文本恒同 JSON（§12 V1c 实证：trivia 三变体 JSON 逐对相等）。
- **拒绝排序序列化器的成本收益论证**：RFC 8785 式排序 canonical 需要 ~40 行自研递归序列化
  （`JSON.stringify` 不能排序键），引入新 bug 面与 O(n log n) 成本；其唯一收益——多生产者
  场景的键序归一——被单一生产者不变式结构性排除。**不变式的守卫**：semanticFingerprintOf
  签名收 `module: VfslModule` 且唯一调用点在 §5 编排（同文件可见）；若未来出现第二生产者
  （如 IR 反序列化入指纹），必须先升域文档版本（v2 前缀）——由 §6.2 格式层的版本语义兜底。
- **数值与转义确定性（R2/M2 加固——安全性由两道既有闸门结构性保证，非依赖 stringify 宽容）**：
  IR 的数值域 = **有限非负双精度**，两道闸门把 `JSON.stringify` 的数值坍缩类挡在域外：
  - **闸门一（词法）**：数字记号 = `[0-9]+` 无符号十进制整数（`tokenizer.ts:200-214`——
    分支头注释明示「数字字面量（[0-9]+，无符号十进制整数）」，无负号/小数点/指数记号面；
    emit 行注释自述「超域为 Infinity，parser 判 E100」，超域值交下游闸门）；
  - **闸门二（语法）**：`Number.isFinite(tok.num)` 为假 → **E100 拒绝**
    （`parser.ts:331-335`——「数字字面量超出可序列化数值域」锚该记号，超双精度**不进 IR**）。
  ⇒ `JSON.stringify` 的三个坍缩类在 IR 数值域**不可达**：NaN/Infinity → `"null"`（被闸门二
  排除——有限值才会进 IR literal）、`-0` → `"0"`（被闸门一排除——v1 无符号记号面产不出
  -0）。literal `value: string | number` 的序列化在该域单射；`80` 与 `80.0` 同串是唯一
  归一，且二者在 v1 方言不可同时产生（`80.0` 根本不是合法记号）。字符串经 well-formed
  JSON 转义（ES2019+ lone surrogate → `\udXXX` 定转义，规范冻结）——确定性无实现自由度。
  - **D2 升级触发器（R2 登记，与 relevant_decisions D2 节同步）**：v2 方言若放开数值
    字面量语法（负号/小数点/指数任一），坍缩类（`-0`、NaN/Infinity）进入可达域、parser
    归一化语义（如 `1e2` → `100`、`-0` 字面量）被 semantic 指纹层**静默继承**——semantic
    域文档必须重审并升 `v2` 前缀，不得静默沿用 v1 摘要。
- **不变式被破坏时的爆炸半径（R2 按 SA2 M1 建议末句补论证；前提经 SA2 R1 评审证据 #7/#8
  独立验证）**：
  - **假共享方向结构性不存在（同 build 内）**：IR 类型族无 Record 键位（alias 名不进字符串
    键）、无 optional 字段、docs 恒数组必填 + 数值域单射（上文两道闸门）+ 字符串转义单射
    + 键集/结构固定 ⇒ 两个语义不同的 IR 不可能 `JSON.stringify` 出同一字符串——第二
    生产者即便出现，**不会**造成「不同语义共享同一指纹」的危险方向；
  - **实际风险是假失效方向（安全但隐性）**：`JSON.parse` 按文本序建键且 IR 键均非整数样
    字符串 ⇒ round-trip 恰好保插入序——反序列化第二生产者**无声兼容**（指纹相同，测试全
    绿，D2「须先升 v2」规则空转）；异序构造者则同值 module 指纹漂移 → 同语义文本得到
    不同指纹 → 未来缓存票语义共享失效/命中率隐性腐蚀——**无人察觉的 miss-only 腐蚀，
    非正确性事故**；
  - **处置分工**：M1 三项可执行加固把「约定快照」升格为「可执行门禁」——(a) fingerprint.ts
    头注写入可 grep 的 D2 契约标记（SA3 实现票硬约束）；(b) 两构造函数名全仓 grep 静态
    门禁（SA4 验证命令）；(c) RT-1b round-trip 保序哨兵 + RT-1c 异序边界钉死（总控排队，
    SA6 修订轮或新内部测试文件）。本设计 R2 承接文档侧论证与登记，加固项不在本文件辖域。

### 6.4 敏感性矩阵（AC4 逐行机制映射）

| 变化 | envelope 指纹 | semantic 指纹 | 机制（设计期实证，§12） |
|---|---|---|---|
| 仅 `id` 变 | **变** | **不变** | envelope 文档含 id 值；semantic 文档无 id 键（ADR-0005） |
| 仅空白变 / 仅普通注释（`//`、`/* */`）变 | **变**（text 字节不同） | **不变** | tokenizer 视 trivia 丢弃，IR 相同 ⇒ JSON 相同（V1c：三变体逐对相等） |
| 仅 JSDoc 变 | **变** | **变** | `docs[]` 原文数组进 IR（ADR-0001 JSDoc 保留），JSON 含原文（V2：doc-a/doc-b/裸文本三互异） |
| 仅声明顺序变（字段序/别名序） | **变** | **变** | `aliases`/`fields` 数组保序，JSON 数组序敏感（V3） |
| `lang`/`version` 变 | 变* | 变* | *成功路径不可达（方言门禁只放行 vfsl@1）；结构上两域文档均含该二键——v2 方言时代同文本不同方言身份 ⇒ semantic 指纹不同，正是 ADR-0007「semantic 覆盖 lang + version +」条款的前向兑付 |
| 键序打乱（同内容） | **不变** | 不变 | 严格门重建四键表序（V9）+ IR 单一生产者 |

### 6.5 canonical JSON 术语的范围声明

ADR-0007「canonical JSON」在本设计的兑付 = §6.1 三层（冻结键序 + 紧凑序列化 + 单射字节化）
+ §6.3 单一生产者插入序——**不是** RFC 8785 完整规范（其排序/数值规范化条款在单生产者域
内无观测差异）。此范围声明本身是设计裁决：若未来需要跨实现指纹互认（如外部工具复算 semantic
指纹），须升级域文档版本并引入完整 JCS——v2 前缀语义已预留（§6.2）。

---

## §7. 递归深冻结与共享引用（AC5）

### 7.1 冻结策略：一趟 `deepFreeze(result)`

复用 index.ts 既有私有助手 `deepFreeze`（index.ts:272；getCompiled 第二消费方，实现零
改动）：以 result 容器为根**一趟递归**——容器自身 + `envelope` + `module` + `derived`
的全部嵌套对象/数组原地 `Object.freeze`，`WeakSet` 防环（IR/派生 schema 按契约为无环 DAG，
防御性收口；测试的 `expectDeepFrozen` 同款 WeakSet 遍历在冻结图上可重入）。

- **为什么冻结容器**：五件套全部不可变（消费者不得改挂 `envelopeFingerprint` 字段）；
  容器冻结使产物整体成为可安全跨 namespace 共享的值（ADR-0007「module/derived 递归深冻结
  **后才允许**未来跨 namespace 共享」——本票产出即冻结形态，未来缓存票直接入册）。
- **递归深度封顶**：module/derived 嵌套深度 ≤ MAX_TYPE_NESTING=100（parser 结构性预算，
  H3 已论证 SA2 已核查）；envelope 恒扁平四原始值。无栈溢出面。

### 7.2 共享引用不被复制破坏（原地冻结的语义保证）

`Object.freeze` 是**原对象操作**（改 [[Writable]]/[[Configurable]]，不搬迁不复制）——
求值器既有共享引用图在冻结后逐点保持：

- `derived.index['ROOT'].node === derived.structure`（ROOT 入口行与结构树同一 rootNode）；
- `derived.index['ROOT.b'].node === 树内字段 node`（路径行内嵌树内节点）；
- 菱形引用链靠 `{kind:'ref', name}` 按名共享（ADR-0003 §4「引用不内联展开」），ref 节点
  是小字面量对象，冻结后仍按名可寻。

设计期实证（§12 V4 系列）：冻结后 `index['ROOT'].node === structure` 仍同一、条目
`isFrozen` 为真、`ROOT.a` 三处（结构树/index/IR）均 `{kind:'ref', name:'A'}` 不内联。
**任何复制式冻结（clone-then-freeze）会破坏上述同一性——本设计明确禁止**（SA3 不得引入
结构化克隆/手写深拷贝中转）。

### 7.3 冻结是行为事实（loud，非静默）

引擎包 ESM 严格模式下，对冻结产物的赋值/删除/重定义属性抛 `TypeError`——AC5 第四用例四
处赋值的机制根源（§12 V4h 严格模式实证）。这是「冻结纪律」从类型 JSDoc 约定（求值器设计 §8.3 的 v1 不冻结决策旧辖域——
derived.ts:11-12 注释自述「v1 以类型 JSDoc + 设计文档声明承载，不 Object.freeze」）升格为运行时
loud 边界的兑付——消费方误变异在开发期即刻爆炸，
不静默交叉污染（对比：未冻结时突变 `index['ROOT'].node` 会交叉污染 structure——
derived.ts:9-12 注释自述的旧风险就此关闭）。

### 7.4 与 getCompiled 缓存条目的隔离

每次 `compileSchemaEnvelope` 调用的对象图（envelope 重建对象 / parse 新 module / evaluate
新 derived / 新 result 容器）全部**本次新建**，不读不写 `compiledCache`——编译产物与缓存
条目零共享、零串扰（AC6 引用互异锚；§8 纯度论证）。`deepFreeze` 本身幂等且每次调用独立
`WeakSet`，第二个消费方不改变其对 getCompiled 的行为。

---

## §8. 纯度与无缓存（AC6）

| 维度 | 论证 |
|---|---|
| 模块级状态 | **零新增**。fingerprint.ts 仅两个模块级 const 字符串（immutable 字面量）；envelope.ts 增量为纯函数 + 派生 Set（immutable 用法）；index.ts 编排为纯函数。既有 `compiledCache`（getCompiled 辖域）不被本函数读/写 |
| 确定性 | 无 Date/random/网络/环境读取；同输入 → 同控制流 → 同输出（指纹确定性 = SHA-256 + canonical 确定性，§6；值确定性 = 管线确定性） |
| 引用互异 | 严格门每次重建 envelope、parse/evaluate 每次新建对象图 ⇒ 同文本两次编译五件套引用互异而值全等（AC6 第一用例锚——**与 getCompiled 的缓存语义相反**，两接缝各自 AC 锁定，§3.5 同款共存论证） |
| 无调用顺序依赖 | 无共享可变态 ⇒ 失败编译（任何阶段）不改变后续任何调用的可观测结果（AC6 第二用例锚） |
| 零新依赖 | fingerprint.ts 只 import 既有内部模块；package.json dependencies 恒 `{}`（测试清单锚，已绿） |
| 并发/重入 | 单线程 JS 下无共享状态即重入安全；冻结产物只读可任意共享 |

ADR-0001「性能依赖按内容哈希的编译缓存」为目标态表述，ADR-0007（更晚、更具体）明文
「本阶段不实现编译缓存，缓存生命周期留给 NamespaceRuntime/Registry」——阶段化条款优先
（冲突报告 N1 裁定）。本票产物的**冻结五件套**正是未来缓存值的既定形态：缓存票届时只需
以 semanticFingerprint（或 envelopeFingerprint）为键存本票产物，无需再加工。

---

## §9. 边界条件与对抗输入（总表）

| 场景 | 行为 | 依据/锚点 |
|---|---|---|
| `null`/`undefined`/`42`/`'text'`/`[]`/函数 | ENV-1 单条（validateEnvelopeShape 早出） | AC1#4 |
| 四键各缺 / 组合缺失 | ENV-2 单条（消息列全所缺键） | AC1#1 |
| `lang:42`/`version:'1'`/`id:null`/`text:{…}` | ENV-3 单条（消息列全类型错） | AC1#2 |
| 缺键 + 类型错并存 | 恒单条：ENV-2（首条优先序） | AC1#5（严于 H1 的 2 条聚合） |
| 多余字符串键（含不可枚举） | ENV-5 单条（消息列全多余键）——严于 H1 容忍 | AC1#3 |
| 多余 **symbol** 键 | 忽略（不在 JSON 数据面；不进回显；两门行为一致） | §3.4 裁定 |
| `version: NaN/1.5/-1/Infinity` | 形状过（number）→ ENV-4（readOnly true） | H1 typeof 分界线继承 |
| `lang:'wml'` / `version:2` | ENV-4 单条 readOnly true，`/^VFSL-ENV-E4: 未知方言/` | AC2-dialect |
| 形状错 + 方言错 + 语法错并存 | 形状错先赢（严格门短路于 parse 前） | AC1#6 顺序锚 |
| 方言错 + 语法错并存 | ENV-4 先赢（parse 不被调用，零 tokenize） | AC1#6 |
| `Object.create({四键原型})` | ENV-2（own-key 不命中；不静默按半份数据解释） | H1 §3.3 继承 |
| `Object.create(null)` + 四自有键（+无多余） | 接受（合法数据形态） | H1 §3.3 继承 |
| 键序打乱的同内容输入 | 指纹归一化（重建表序回显） | AC3#4 |
| 语法错误文本 | parse 原生 VfslIssue 数组零损（与 parseVfsl 同输入深相等，含行列） | AC2-parse |
| 求值失败（含测试注入） | evaluate 原生 issues 数组零损透传，经返回值通道不抛错 | AC2-evaluate |
| 对抗 getter/Proxy（get trap 抛出） | 严格门扫描期抛出 → 顶层 catch → ENV-100 单条，绝不外抛（§12 V7 实证抛出点） | AC2-internal |
| **Proxy 谎报键集·隐藏向**（R2/M3：getOwnPropertyNames trap 不抛而隐藏多余键） | **过严格门**（ENV-5 扫描被骗），但多余数据**不可达一切产物**——`validateEnvelopeShape` 单读物化重建回显只抄四键自有值，envelope/module/derived/双指纹全部不含隐藏键 ⇒ **重建回显才是数据面安全边界；ENV-5 扫描是对诚实输入的契约检查，不对抗谎报者**（谎报者的损失仅是自己的隐藏键不参与编译——无信息泄入、无污染面） | §3.1/§3.3（R2 登记；RT-3 隐藏向锚） |
| **Proxy 谎报键集·伪造向**（R2/M3：getOwnPropertyNames 返回伪造的多余键） | ENV-5 单条**保守拒绝**（own 键差集非空即拒——不探真、不比对 get trap 结果，杜绝「扫描面与读取面不一致」的二次对抗面），不外抛 | §3.3（R2 登记；RT-3 伪造向锚） |
| thrown 值不可字符串化 | `envelopeCrashIssue` detail 守卫（F1 修复遗产）→ 确定性占位正文 | envelope.ts 既有 |
| hostile 动态值内嵌行终止符伪造 `VFSL-E<码>:` 行 | `makeEnvelopeIssue` 唯一构造点 sanitizer 单行化（ENV-1..5/100 全经此点） | envelope.ts 既有（H1 R2 冻结） |
| text 含 lone surrogate / 巨长文本 | sha256 单射字节化无坍缩；深度预算是 parseVfsl 既有三层 | sha256.ts §D8.2 |
| 冻结产物赋值/删除/重定义 | 严格模式抛 TypeError（loud） | AC5#4 |
| 同文本重复编译 | 五件套引用互异、值全等、双指纹稳定 | AC6#1 |
| 失败后重编译 | 结果与无失败历史时全等（无状态） | AC6#2 |
| 与 getCompiled 并存调用 | 零交互（不读不写缓存；对象图不相交） | §7.4 |

---

## §10. 测试通过策略（SA3）

### 10.1 SA6 28 用例逐条机制映射（7 describe）

| # | describe / it 要点 | 走的路径 | 转绿手段 |
|---|---|---|---|
| 1 | 缺失任一四键 → ENV-2 单条 + `/^VFSL-ENV-E2: /` + readOnly false | 严格门①② 坍缩首条 | §3.2 |
| 2 | 四键类型错误逐一 → ENV-3 单条 + `/^VFSL-ENV-E3: /` | 同上（无缺键时首条即 ENV-3） | §3.2 |
| 3 | 多余键 → 单条、readOnly false、code≠'4'；H1 对照 ok:true | 严格门③ ENV-5；H1 对照走 envelopeTextGate（不动） | §3.3 |
| 4 | 非对象六例 → ENV-1 单条 + `/^VFSL-ENV-E1: /` | 严格门① ENV-1 早出 | §3.1 |
| 5 | 缺 lang + version 类型错并存 → 恒单条；H1 对照 2 条 | 坍缩取 [0]=ENV-2 | §3.2 |
| 6 | 混合顺序：mixedShape→ENV-3；mixedDialect→ENV-4 readOnly | 严格门短路序 | §5.1 |
| 7 | dialect 两例（lang/version）→ ENV-4 + `/^VFSL-ENV-E4: 未知方言/` | 严格门④（dialectIssueOrNull 复用） | §4 |
| 8 | parse：TEXT_BAD → 解包后 `toEqual(native.issues)` + 每条 `/^VFSL-E\d+:/` + line/column number | parse 接缝 + vfslIssues 包装（引用同源） | §5 ③ |
| 9 | evaluate：mock 一次性注入失败 → 解包 `toEqual(injected)` | evaluate 模块图边（§5.3）+ 零损透传 | §5 ④ |
| 10 | internal：对抗 Proxy → ENV-100 + `/^VFSL-ENV-E100: /`、await 不 reject | 顶层 catch（V7 实证抛出点在扫描期） | §5 internal |
| 11 | sha256Hex FIPS KAT | 既有实现（已绿锚，SA3 零动作） | — |
| 12 | 双指纹格式 `/^sha256:v1:[0-9a-f]{64}$/` | §6 前缀 + sha256Hex 输出形态 | §6.1/§6.2 |
| 13 | envelope 指纹精确摘要（表序 canonical） | `envelopeFingerprintOf` 字面量键序（V8 自证同构） | §6.1 |
| 14 | 键序打乱归一化 + 重复编译双指纹稳定 | 严格门重建 + canonical 确定性（V9） | §6.1/§6.3 |
| 15 | 域分离：双指纹互异 | 两域文档语言不相交（V12）——构造性 | §6.2 |
| 16 | 仅 id 变 → env 变 / semantic 不变 | semantic 文档无 id 键 | §6.4 |
| 17 | trivia 三变体 → env 变 / semantic 不变 | IR trivia 丢弃（V1c） | §6.4 |
| 18 | JSDoc 三对比 → semantic 变 | docs[] 进 IR（V2） | §6.4 |
| 19 | 顺序变 → semantic 变 + derived 对照不等 | 数组保序（V3） | §6.4 |
| 20 | envelope/module/derived 深冻结全遍历 | 一趟 deepFreeze(result)（V4g） | §7.1 |
| 21 | 共享引用保持（index ROOT/b 两处同一性） | 原地冻结不复制（V4f） | §7.2 |
| 22 | ref 不内联三处 `{kind:'ref', name:'A'}` | 求值器/IR 既有行为（V4c-e），冻结不改结构 | §7.2 |
| 23 | 四处冻结赋值抛 TypeError | ESM 严格模式 + 原地冻结（V4h） | §7.3 |
| 24 | 同文本两编引用互异 + 值全等 | 无缓存全新对象图 | §8 |
| 25 | 失败编译无顺序依赖 | 无状态 | §8 |
| 26 | package.json dependencies `{}` | 既有（已绿锚，SA3 零动作——**不得加任何 dependencies**） | §8 |
| 27 | 公共导出可直调 + derived `toEqual` 直编 | index 导出 + 引用直通（冻结不改 toEqual） | §2.4/§5 |
| 28 | 幸福路径五件套与直编一致 | 透传 + 冻结不改值语义 | §5/§7 |

### 10.2 存量零回归论证

对 src 是**纯增量**：envelope.ts 既有函数/常量逐字不动（+1 码 +1 函数 +1 派生 Set）；
index.ts 既有导出与函数（含 getCompiled/compiledCache/deepFreeze）逐字不动（+import +编排
+类型）；fingerprint.ts 新建无环叶子。既有 23 个测试文件（packages/vfsl，本票文件外）的
被测公共面与行为零变化 → 全量预期零回归（SA6 红灯验证已实测其余 23 文件全绿基线）。
类型层：`SchemaEnvelopeIssueCode` 加法扩展 `'5'`——grep 实证该类型仅在 envelope.ts 内部
消费 + index re-export，仓内无 exhaustive switch/字面量穷举消费方（§13），类型层加法对
既有消费方零破坏。

### 10.3 typecheck 清零路径

简报记录现状：`tsc -p packages/vfsl/tsconfig.json` 恰 1 错——TS2724 缺
`compileSchemaEnvelope` 导出（构造性红灯）。SA3 落地 §2.4 导出即自愈；测试文件其余部分
类型干净（SA6 已附注，简报转述）。无 SA6 文件协调项。

### 10.4 SA3 验证命令（实跑留证）

```bash
pnpm --filter @nomicore/vfsl typecheck                                   # 0 错（TS2724 自愈）
pnpm exec vitest run packages/vfsl/test/compile-schema-envelope.test.ts  # 28 passed
pnpm test                                                                # 全量全绿零回归
```

零 CI 改动：测试文件已在 vitest include 内（SA6 已落且基线实测）。

---

## §11. 风险与权衡

| # | 风险/权衡 | 处置 |
|---|---|---|
| 1 | 双门并存（envelopeTextGate 容忍 / envelopeStrictGate 严格）被攻「决策点分叉」 | §3.5：语义判定共享底层单点（validateEnvelopeShape + assertVfslDialect）；差异面是两票 AC 各自冻结的契约，收敛须 ADR 裁决 |
| 2 | ENV-5 扩码对公共类型 `SchemaEnvelopeIssueCode` 的加法扩展 | grep 实证无穷尽消费方（§13）；加法类型扩展非破坏；ENV 码空间自持于 envelope.ts（不入 errors.ts 方言层注册表——H1 §6.1 纪律继承） |
| 3 | 插入序 canonical（非 RFC 8785 排序）被攻「非规范 canonical」 | §6.3 单一生产者不变式 + 拒绝排序序列化器成本论证 + v2 前缀兜底（跨实现互认需求出现时升版本）；§6.5 范围声明 |
| 4 | envelope 域文档无显式域标签被攻「域分离不完整」 | §6.2：域身份由 v1-spec §7 冻结形状承担 + 精确摘要锚锁死输入不可加标签；分离靠两域文档语言构造性不相交（首键即异），非靠单侧标签 |
| 5 | semantic 指纹今天 lang/version 恒定（'vfsl'/1），被攻「两键形同虚设」 | 结构性前向兑付：v2 方言时代同文本不同方言身份 ⇒ 指纹必变（§6.4 末行）；今天从 ADR-0007 条款原文逐字落实（「覆盖 lang + version + 规范 IR」） |
| 6 | deepFreeze 递归深度/性能 | MAX_TYPE_NESTING=100 结构性封顶（H3 已论证）；O(产物规模) 单趟，无缓存摊薄诉求（每调用一次，产物即返回值） |
| 7 | 冻结产物进入未来缓存后的共享语义 | 本票不缓存（§8）；产物冻结形态即 ADR-0007 为跨 namespace 共享预设的形态——缓存票直接以本票产物入册，无二次冻结/复制 |
| 8 | index.ts 体量增长（~285 → ~370 行） | 编排同址纪律（parseVfsl 实现在 index.ts 的既定布局）优先于文件美学；H1/H3 同款裁定先例 |
| 9 | ENV-2>ENV-3 坍缩优先序在跨类并存时隐藏类型错细节 | AC2 明文单条契约（严于 H1 是本票增量而非缺陷）；类内信息不丢（消息列全）；H1 入口仍可获取聚合双条诊断（消费方自选入口） |
| 10 | `Object.getOwnPropertyNames` 含不可枚举字符串键——比 JSON 数据面更严 | §3.4 对称性论证：四键判定（Object.hasOwn）认不可枚举，封闭判定同认；严格方向的不对称（多拒不少拒）符合「严格封闭」条款精神 |
| 11 | 包版本 0.2.0 → 0.2.1 是否必要 | 新增公共面沿 F1/H1 先例 patch 口径；private 包无发布面，版本号是仓内变更记录纪律 |

---

## §12. 协议假设依据 (Protocol Assumption Evidence)

**无网络协议/端口/进程生命周期/第三方库行为类假设**：本设计是纯函数 + 模块内编排，零 I/O、
零新依赖、零 CI 拓扑变化、零进程/端口假设。以下为设计期实测证据（本会话 2026-08-22 实跑，
脚本 `/tmp/issue72-design-check.mts`（tsx），输出全文贴入，沿 H1 §10 证据留存纪律；含一次
模式差异复核 `/tmp/v4h-strict.mts`）：

| 假设 | 依据类型 | 依据内容（具体引用） | 风险等级 |
|---|---|---|---|
| 红灯基线 = 26 红 / 2 绿，红因唯一缺导出 | 设计期实测 | 本会话亲跑 `pnpm exec vitest run packages/vfsl/test/compile-schema-envelope.test.ts`：`Test Files 1 failed (1) / Tests 26 failed \| 2 passed (28)`，失败逐条 `compileSchemaEnvelope is not a function`（构造性红灯）——与简报 SA6 记录逐字一致 | 低 |
| trivia（空白/`//`/`/* */`）不改变 IR ⇒ semantic 指纹不变（AC4 机制根源） | 设计期实测 | tsx 直跑 src：`parseVfsl(TEXT_A)` 与三变体（TEXT_A_WS / COMMENT_SLASH / COMMENT_BLOCK）module 的 `JSON.stringify` **逐对相等**（长度均 210）——V1c 输出行 | 低 |
| JSDoc 原文进 IR 且变体互异（AC4 机制根源） | 设计期实测 | `parseVfsl(TEXT_JSDOC_1/2)` 与裸文本三者 JSON 互异；`docs: [" doc-a "]` 原文在 IR 字段上——V2 输出行 | 低 |
| 声明顺序保留进 IR 与派生 schema（AC4 机制根源） | 设计期实测 | ORDER_1/ORDER_2 的 module JSON 互异、derived JSON 互异——V3 输出行 | 低 |
| 求值器共享引用现状 + 原地冻结保持同一性（AC5 机制根源） | 设计期实测 | TEXT_REF：`index['ROOT'].node === structure` = true；`index['ROOT.b'].node === 树内 b 字段 node` = true；ROOT.a 三处均 `{"kind":"ref","name":"A"}`；对 derived 整图就地冻结后前两同一性仍 true、条目 isFrozen true——V4 系列输出行 | 低 |
| 冻结产物赋值抛 TypeError（严格模式） | 设计期实测 | 初测 V4h false 系 /tmp 脚本被 tsx 按 CJS 非严格模式执行（非严格模式静默失败）；以 `.mts`（ESM 严格模式）复核：赋值抛 TypeError = **true**——`/tmp/v4h-strict.mts` 输出。vitest 测试文件经 ESM 转换恒严格模式 | 低 |
| 对抗 Proxy 在严格门扫描期抛出（ENV-100 收编前提） | 设计期实测 | throwing-get Proxy 输入 `validateEnvelopeShape` 即抛出 = true（V7）——顶层 catch 可达性实证 | 低 |
| envelope 指纹摘要输入 = 测试 TH-1 公式（表序字面量 JSON） | 设计期实测 | `JSON.stringify({lang:'vfsl',version:1,id:'compile-fixture',text:TEXT_A})` = `{"lang":"vfsl","version":1,"id":"compile-fixture","text":"type ROOT = { a: string; };"}`，sha256 = `a4ece53d…974ce`（V8）；键序打乱输入经 validateEnvelopeShape 重建后 canonical 不变 = true（V9） | 低 |
| H1 容忍门现状（多余键 ok / 混合输入聚合 2 条、首条 ENV-2） | 设计期实测 | `validateEnvelopeShape({...四键, extra:true}).ok` = true（V10）；混合输入 issues.length = 2、首条 code = '2'（V11）——严格门坍缩规则的输入形态实证 | 低 |
| 双指纹互异（域分离锚） | 设计期实测 | envelope canonical 与 semantic 域文档（`{"domain":"vfsl-semantic",…}`）字符串不等、双指纹不等 = true（V12）；首键即异 ⇒ 构造性不相交 | 低 |
| TEXT_BAD 原生失败形态（AC2-parse 透传前提） | 设计期实测 | `parseVfsl(TEXT_BAD)` → `[{message:"VFSL-E100: 类型位置意外记号: 标点 ';'",line:1,column:18}]`（V5）——`/^VFSL-E\d+:/` 与 number 行列满足测试锚 | 低 |
| TEXT_EVAL_FAIL 合法（mock 注入前提） | 设计期实测 | parse ok + evaluate ok = true（V6）——一次性失败武装可达 evaluate | 低 |
| vi.mock 模块图边对 index.ts 内 evaluate 调用生效 | 现有测试引用 | `packages/vfsl/test/docscope-getcompiled.test.ts:90-93` 对同文件同 import 的 getCompiled 已验证该机制（AC5 失败注入 + 命中计数均依赖它）；本票编排复用同一 import 绑定 | 低 |
| v1-spec §7 四键表序 = lang, version, id, | 源码引用 | `docs/vfsl/v1-spec.md:439-448`（§7 信封形状 JSON 块与字段表的键序） | 低 |
| H1 测试不锁 ENV 码空间全集（ENV-5 扩码安全） | 现有测试引用 | `parse-schema-envelope.test.ts` 对 envelope issue 仅锚 `typeof code === 'string'`（:85）与 ENV-100（:377）；仓内 grep `SchemaEnvelopeIssueCode|EnvelopeErrCode` 无测试与生产 exhaustive 消费（§13 grep 输出） | 低 |

**实测输出全文（SA3/SA4 对照口径）**：

```
$ pnpm exec tsx /tmp/issue72-design-check.mts
V1a parse ok: [true,true,true,true]
V1b module JSON 等长: [210,210,210,210]
V1c JSON 逐对相等: [true,true,true]
V2 JSDoc 变体 JSON 互异 + 与裸文本互异: [true,true,true]
V2b JSDoc 原文在 IR: [" doc-a "]
V3a 顺序变体 IR JSON 互异: [true]
V3b 顺序变体 derived JSON 互异: [true]
V4a index[ROOT].node === structure: [true]
V4b index[ROOT.b].node === 树内字段 node: [true]
V4c ROOT.a 结构树 ref 不内联: ["{\"kind\":\"ref\",\"name\":\"A\"}"]
V4d index[ROOT.a] ref: ["{\"kind\":\"ref\",\"name\":\"A\"}"]
V4e IR ROOT.a ref: ["{\"kind\":\"ref\",\"name\":\"A\"}"]
V4f 冻结后 index[ROOT].node === structure 仍同一: [true]
V4g index[ROOT] 条目 isFrozen: [true]
V4h 冻结产物赋值抛 TypeError: [false]        ← /tmp 脚本 CJS 非严格模式伪阴，下行复核
V5 TEXT_BAD issues: [{"message":"VFSL-E100: 类型位置意外记号: 标点 ';'","line":1,"column":18}]
V6 TEXT_EVAL_FAIL parse+evaluate ok: [true]
V7 对抗 getter 在形状扫描抛出（顶层 catch 可收编）: [true]
V8a canonical 形态: ["{\"lang\":\"vfsl\",\"version\":1,\"id\":\"compile-fixture\",\"text\":\"type ROOT = { a: string; };\"}"]
V8b sha256: ["a4ece53d99cb2a5a2aad61dfa5d2148107455aa5708ce95e2b263b8a64f974ce"]
V9 键序打乱→重建 canonical 不变: [true]
V10 H1 validateEnvelopeShape 多余键容忍（ok）： [true]
V10b own-key 差集（ENV-5 判据）： [["extra"]]
V11 H1 混合输入聚合条数: [2]
V11b 首条 code（ENV-2 优先序）: ["2"]
V12a semantic 文档前缀: ["{\"domain\":\"vfsl-semantic\",\"lang\":\"vfsl\",\"version\":1,\"module\""]
V12b 两域文档恒不等（键集互斥→构造性）: [true]
V12c 双指纹互异: [true]

$ pnpm exec tsx /tmp/v4h-strict.mts
V4h(strict ESM .mts) 冻结产物赋值抛 TypeError: true

$ pnpm exec vitest run packages/vfsl/test/compile-schema-envelope.test.ts
Test Files  1 failed (1)
     Tests  26 failed | 2 passed (28)
Type Errors  no errors
```

---

## §13. 契约改动连锁审计 (Contract Change Caller Audit)

**无契约改动**：本设计仅涉及**新增**（fingerprint.ts 新建；envelope.ts/index.ts 追加；
版本号；SA6 测试已落地）。全部既有函数（`parseVfsl`/`parseSchemaEnvelope`/`getCompiled`/
`evaluate`/`validateLogicalSnapshot`/`validateEnvelopeShape`/`dialectIssueOrNull`/
`envelopeTextGate`/`makeEnvelopeIssue`/`envelopeCrashIssue`/`sha256Hex`/`deepFreeze`/
`assertVfslDialect`）的签名、返回类型、throw 行为**逐字不动**；无任何 caller 需要迁移。

唯一的类型层变化（加法、非契约变更）与既有 caller 面貌：

| 项 | 变化 | 既有消费方审计（grep 实测） |
|---|---|---|
| `SchemaEnvelopeIssueCode`（envelope.ts:31，经 index.ts:104 re-export） | 并入 `ENV_5: '5'` → 联合类型加 `'5'` | grep `SchemaEnvelopeIssueCode\|EnvelopeErrCode` 全仓：仅 envelope.ts 自身（注册表定义 + issue 接口 + 构造点）与 index.ts re-export 行；**零外部消费方、零 exhaustive switch**——加法扩展零破坏 |
| `deepFreeze`（index.ts:272，模块私有） | 第二消费方（compileSchemaEnvelope） | 私有函数无外部 caller；getCompiled 行为零变化（幂等 + 每调用独立 WeakSet，§7.4） |
| `compiledCache`（index.ts:262，模块私有） | **零交互**（不读不写） | getCompiled 辖域隔离不变（§8） |

新导出 `compileSchemaEnvelope` / `CompileSchemaEnvelopeResult` / `CompileSchemaEnvelopeOk`
的 caller 现仅 SA6 测试文件（`compile-schema-envelope.test.ts`）；下游消费方（NamespaceRuntime
的 open 管线第一步）属 Phase 2 后续票。抓全 caller 复核命令（SA4 抽查口径）：

```bash
git grep -n "\bcompileSchemaEnvelope\b" -- 'packages/**/*.ts' 'apps/**/*.ts'
```

---

## §14. 文件清单（File Scope）

### ALLOW LIST

- `packages/vfsl/src/fingerprint.ts` — 新建，§2.2/§6：双指纹双域构造单模块（前缀常量 + 域标签 + 两个指纹函数，~70 行）
- `packages/vfsl/src/envelope.ts` — 修改，§2.3/§3：追加 `ENV_5` 注册行 + `ENVELOPE_KEY_SET` 派生集合 + `envelopeStrictGate`（~45 行）；**既有函数/常量逐字不动**
- `packages/vfsl/src/index.ts` — 修改，§2.4/§5：追加 2 个 import + `CompileSchemaEnvelopeOk`/`CompileSchemaEnvelopeResult` 类型 + `compileSchemaEnvelope` 编排（~85 行）+ 头注释公共面清单补一行；**既有导出与函数（含 getCompiled/compiledCache/deepFreeze）逐字不动**
- `packages/vfsl/package.json` — 修改，版本 0.2.0 → 0.2.1（新增公共面 patch，沿 F1/H1 先例）；依赖零变化
- `packages/vfsl/test/compile-schema-envelope.test.ts` — `[SA6 owned]` 验收红灯测试。SA3 **零改动**（TS2724 随导出落地自愈，§10.3；如需动仅限测试基础设施且须总控知会，断言逻辑禁改）
- `packages/vfsl/test/compile-schema-envelope-sentinel.test.ts` — `[SA6 owned]`（**F1 登记追加**）哨兵补锚：SA2 R1 评审 M1(c)/RT 排队项的新内部测试文件承载（RT-1b round-trip 保序 / RT-1c 异序边界 / RT-2 数值闸门 / RT-3 谎报键集两向 / RT-4 不可枚举键，五锚——派发链见 dispatch 第 7/9 行），SA4 F1 闭合登记
- `wiki/raw/task_issue-72_design.md` — 本设计文档（随分支 commit）

### DENY LIST

- `packages/vfsl/src/schemasource.ts` — `SchemaEnvelope`/`assertVfslDialect`/`SchemaSourceError` 只读复用零改动（方言断言单点决策的直接推论）
- `packages/vfsl/src/sha256.ts` — 摘要实现只读复用（FIPS KAT 测试锚定；任何改动即红锚）
- `packages/vfsl/src/evaluate.ts` — 求值接缝零改动（vi.mock 锚定的模块图边；ADR-0003 §1 冻结契约）
- `packages/vfsl/src/{tokenizer,parser,semantic,ir,derived,resolve,shapes,pattern,xml,errors,validate,validate-patch}.ts` — 引擎十二内部件零改动（trivia 丢弃/docs 保序/ref 不内联等指纹敏感性行为根基 + 存量全绿根基）
- `packages/vfsl/src/index.ts` 既有内容 — 文件在 ALLOW 但**既有函数与导出逐字不动**（getCompiled/compiledCache/deepFreeze/parseVfsl/parseSchemaEnvelope——行为级护栏，SA4 diff 应只见追加）
- `packages/vfsl/tsconfig.json`、`tsconfig.base.json`、`tsconfig.typecheck.json`、`vitest.config.ts` — 编译开关与测试拓扑不动
- `pnpm-lock.yaml`、`pnpm-workspace.yaml` — 零新依赖零 workspace 变化（AC6 清单锚）
- `.github/workflows/**` — 无 CI 步骤诉求（§10.4）
- `docs/adr/*`、`docs/vfsl/v1-spec.md`、`docs/phases/*`、`CONTEXT.md` — 冻结契约与术语文档
- `packages/vfsl-codegen/**`、`packages/vfsl-protocol/**` — 消费方/协议包轨道，生命周期分离（ADR-0004；codegen 换用编译入口属未来演进票）
- `tests/acceptance/**` — Python 验收脚本不动
- `TASK.md`、`.mabf-bg/`、`.scratch*`、`/tmp/**` — 调度器/草稿产物，不进分支 commit

---

## SA2 反馈逐条回应（R2）

R1 初版（2026-08-22）无 SA2 评审反馈；R2（2026-08-22）按 `task_issue-72_sa2_review.md`
（verdict **pass**）逐条落实。修订时 ALLOW LIST 只增不删（2026-06-08 立法写入规则）。

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| **M2-a**：§6.3 数值确定性论证补 tokenizer/parser 两处源码引用 | ✅ | §6.3 | 「数值与转义确定性」升格为「两道既有闸门的结构性保证」：闸门一 `tokenizer.ts:200-214`（数字记号 `[0-9]+` 无符号十进制整数，无负号/小数点/指数记号面）+ 闸门二 `parser.ts:331-335`（`Number.isFinite` 假值 → E100 拒绝，超双精度不进 IR）；补齐坍缩类不可达推理链（NaN/Infinity→`"null"` 被闸门二排除、`-0`→`"0"` 被闸门一排除）——SA7 活链路验证（RT-2）有锚可对 |
| **M2-b**：D2 升级触发器清单登记「v2 方言放开数值字面量语法 ⇒ semantic 域文档必须重审并升 v2 前缀」 | ✅ | §6.3「D2 升级触发器」条 + relevant_decisions.md D2 节 | 双侧同步登记：设计侧新增触发器条目（放开负号/小数点/指数任一 ⇒ 坍缩类入可达域 + parser 归一化语义被指纹层静默继承 ⇒ 必须重审并升 v2）；relevant_decisions D2 节追加同款行（含 v1 安全性的两闸门行号依据） |
| **M3**：§9 边界表补「Proxy 谎报键集」两向行 | ✅ | §9 | 新增两行：**隐藏向**（getOwnPropertyNames 隐藏多余键 → 过门但多余数据不可达一切产物，**重建回显才是数据面安全边界**，ENV-5 扫描是对诚实输入的契约检查）；**伪造向**（伪造多余键 → ENV-5 单条保守拒绝，不探真以免二次对抗面）——均标注 SA2 建议的 RT-3 两向红灯锚编号 |
| **M1 建议末句**（设计侧文档义务，非处置表 M1(a)(b)(c) 实现项）：§6.3 补不变式破坏时的爆炸半径论证 | ✅ | §6.3「爆炸半径」条 | 三段论证：假共享方向结构性不存在（IR 类型族无 Record 键位/无 optional + 数值域单射 + 转义单射——SA2 证据 #7）；实际风险为假失效方向（round-trip 保序无声兼容 / 异序构造指纹漂移 → 缓存 miss-only 隐性腐蚀——SA2 证据 #8）；M1 三项可执行加固承接方分工（(a) SA3 头注标记 / (b) SA4 grep 门禁 / (c) 总控 RT-1b/1c 排队）记录在案 |
| M1(a)(b)(c) 实现侧加固、N1（D1 前缀耦合附注）、N2（RT-4 不可枚举键锚） | 不在本文件辖域 | — | M1(a) fingerprint.ts 头注 D2 契约标记 → SA3 实现票硬约束（§2.2 伪代码随附）；M1(b) 构造函数 grep 静态门禁 → SA4 验证命令；M1(c) RT-1b/1c 与 N2 RT-4 → 总控排队（SA6 修订轮或新内部测试文件）；N1 → 已由总控录入 relevant_decisions「D1 附注」节（本会话复核在案） |
