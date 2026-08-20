# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出（前置门禁轮，被审对象 = 任务简报 `wiki/raw/task_vfsl-codegen-hardening.md`）。
> 只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> ADR 基准：`docs/adr/0001–0005` 全读（5/5，无抽样、无 superseded）+ `CONTEXT.md`。

## 相关 ADR

### ADR-0001 VFSL 文本是 schema 的唯一真相源，只存在于文档与测试中（accepted，含 2026-08-19 修订节）

- 与本任务的关联点：本任务修改投影生成器（codegen）行为。ADR-0001 正文原文「没有任何形式的 codegen」已被同文 2026-08-19 修订节**在阶段态范围内放行**——codegen 工作的合法性直接来源于该修订节。
- 核心条款（原文摘录）：
  - 正文（背景，已被修订节收窄）：「本仓库是纯引擎仓库：代码库不含 schema 文本（测试 fixture 除外）。……没有作为类型源的 schema 源文件，也没有任何形式的 codegen。」
  - 修订节：「**目标态不变**：nomicore 支持任意运行时 schema，不预设 schema——权威源永远是 doc 的 `__schema__`，引擎必须在运行时解析任意合法方言文本」
  - 修订节：「**阶段态放行**：体系未完全建立之前，允许仓内放置 schema 文件作为**开发脚手架**完成阶段性开发（类型投影、演示、联调）」
  - 修订节：「**脚手架纪律**：一切脚手架消费方必须经 **SchemaSource 接缝**取文本（阶段实现 = 仓内文件源），不得直接读文件——终态切换为 DocSchemaSource（从 server/`__schema__` 拉取）时零消费方改动。脚手架不能长成承重墙」
  - 修订节：「**§8 编译期类型投影回到范围内**：生成器 + CI 新鲜度校验；投影不参与运行时判定、不承担权威（§8 原纪律保留）。「坏代码写不出来」重新成为目标（编译期护栏），与运行时校验的「坏数据进不来」两层分工」
  - 修订节：「本 ADR 的其余条款（无机器标签、方言冻结、编译缓存、演进为运行时管理操作）不变。」

### ADR-0003 求值器与派生 schema（accepted）

- 与本任务的关联点：背景性约束——生成器的输入是 evaluate 的派生 schema（经 ADR-0005 §3）；ROOT 保留名与「其余别名合法」界定 N3 守卫的对象域；parse 层错误表冻结是 AC-3「独立错误码」的对照背景。
- 核心条款（原文摘录）：
  - 「每个模块必须恰好声明一个名为 `ROOT` 的别名（大小写是契约，`root` / `Root` 不算），且必须 **map 形**」
  - 「`ROOT` 可被其他别名引用（既当根又当积木，合法）；其余无人引用的别名是惰性积木——合法、不进数据面。」
  - 「别名引用表示：按名引用（不内联展开）——派生 schema 照搬 IR 的模块形状：别名表 + ref 节点 `{ kind: 'ref'; name }`」
  - 后果：「规格修订：§3 新增 ROOT 约定小节、§4 错误表新增 E310/E311（19 → 21 码）、§10 fixture `AssetsDoc` 改名 `ROOT`」（即：v1 规格 §4 错误表冻结的是 **parseVfsl 层** 的 21 个 E 码）

### ADR-0004 vfsl-protocol 类型协议包——编译期路径投影的五个设计决策（accepted）

- 与本任务的关联点：AC-1 恒定 import 行发射的正是 D3 列出的协议导出（`PathSchema`）；生成物形态受「生成契约 = 类型映射表」约束；D5 锚定路径形状不因本任务改变。
- 核心条款（原文摘录）：
  - D3：「全部内容为类型空间产物（幻影 `unique symbol` 口袋、`PathSchema`/`PathAt`/`PathValue`/`PathKind`/`UnknownPath`、`VfslPathMap` 空表、`VfslTypedAccess` 接口签名）——编译后为空模块，零依赖、零运行时代码」
  - D3：「空 `VfslPathMap` 默认 **fail-closed**：未引入领域包增广时一切路径解析为 `UnknownPath`，任何 patch 即编译错误」
  - D3：「不含生成器（票 F 职责）、不含工厂/默认值、不进引擎包」
  - D4：「vitest typecheck 模式；正例用 `expectTypeOf`（类型相等断言），负例用 `@ts-expect-error`（自我反转断言：该行被错误放行时测试反而失败）」
  - D5：「`VfslPathMap` 顶层键 = ROOT 的字段（`['assets', id, 'name']`，不是 `['ROOT', 'assets', …]`）；ROOT 是 doc 级固定挂载点，挂载知识只出现在绑定实现的 `doc.getMap('ROOT')` 一处。」
  - 后果：「类型树形状 = 生成契约：票 F 生成器的输出规格即本 ADR + 设计文档 §8.3 映射表（Record 通配层 / 标记→kind / Pattern→string / YXmlFragment→string / ref→别名引用 / docs→TSDoc 注释）」
  - 后果：「领域包增广文件受 CI 新鲜度校验（生成物与 SchemaSource 源漂移即失败）」

### ADR-0005 投影生成管线（accepted）

- 与本任务的关联点：**最高相关**——本任务的全部改动落在本 ADR 冻结的生成管线内（生成器行为、生成物形态、CI 保鲜、错误响应模式）。
- 核心条款（原文摘录）：
  - §1：「**消费方首动作 = 方言断言**（`lang==='vfsl' && version===1`，否则响亮失败）——方言冻结纪律焊进生成管线」（管线内「响亮失败」模式的既有先例）
  - §2：「三键全部必需，缺失或方言不符 → 响亮拒绝（防错冗余：拿错文件 = 当场报错，不是静默按错规则处理）」（同上先例）
  - §3：「**输入 = `evaluate` 的派生 schema**（不直接吃 IR）：物化折叠、联合三分类、判别式检测只计算一次（单一真相），生成器是纯发射器」
  - §3：「**派生 schema 必须携带 `docs`**（从 IR 节点继承）——TSDoc 发射（IDE hover 中文说明）与 Phase 4 AI namespace card 都依赖它」
  - §4：「生成文件入仓（纯类型文本，无构建期排除的理由），头注 `GENERATED … DO NOT EDIT` + 源文本哈希」
  - §4：「CI `generate --check`：全量重新生成 → diff 为空；**源漂移与生成器逻辑漂移双抓**（纯哈希比对抓不了后者）」
  - §4：「schema 改动与重新生成同一原子提交」
  - §5：「`packages/` = 可复用库，`apps/` = 可执行体，`domains/` = 业务 schema 包（schema.vfsl + generated.ts + 挂载点 + dogfood 测试）」
  - 后果：「生成器包：`@nomicore/vfsl-codegen`（协议包按 ADR 0004 D3 不含生成器）」（本任务改动的 emitter.ts 所在包）

### ADR-0002 nomicore 是全新 yjs-server 重写，authority 完全出范围（accepted）

- 与本任务的关联点：无——本任务不触 authority 规则、旧系统兼容与统一写入管线；收录于此仅为盘点完备。
- 核心条款（原文摘录）：
  - 「旧系统既有的 authority 规则体系（`__authority__` manifest：enum / range / conditional / state-machine）**完全排除在范围外，不保留接口**」

## CONTEXT.md 相关术语与惯例

- `VFSL`：「受限 TypeScript 子集 + 标记类型构成的 schema 语言；同一段文本既是编译期类型源、又是运行期解释器输入。」_Avoid_: PathSchemaNode DSL、schema DSL
- `方言（dialect）`：「`lang + version` 决定的 VFSL 语法子集与语义规格；一经发布冻结，引擎只增不改，未知方言 loud-fail 只读。」
- `ROOT`：「命名空间根别名的保留名（大小写是契约）：每个模块必须恰好声明一个 map 形的 `type ROOT = …`……其余无人引用的别名是惰性积木，不进数据面。」_Avoid_: 隐式根、汇点推导
- `标记类型（marker types）`：「`YMap` / `YArray` / `YPlainArray` / `YLeaf` / `YXmlFragment` / `Pattern`；tsc 视角恒等别名，引擎视角是 Yjs 物化语义标记。」_Avoid_: `YLEaf`、`yleaf` 等变体拼写——大小写是契约的一部分
- `求值器（evaluator）`：把 IR 求解为派生 schema 的步骤。_Avoid_: 「编译器（compiler）——该词留给『文本 → IR → 派生 schema』的组合入口（Phase 1 contract 包）」（本任务通篇用「生成器」，与该惯例一致）
- `派生 schema（derived schema）`：「与 IR 同纪律——纯数据、可 JSON 序列化、可内容哈希；别名按名引用（`ref`）保留，不内联展开（ADR-0003 §4）。」

## 设计引入的新决策点（设计后复审追加 — SA1 设计 v1）

> 来源：`wiki/raw/task_vfsl-codegen-hardening_design.md`。以下为设计层冻结的新事实/新约定，供 SA2 评审、SA3 实现与后续链路复用；每条附 ADR 锚点（锚点仅为一致性依据，非新增 ADR 约束——ADR 全集未变）。

1. **协议导出面冻结名单（12 名）**：`packages/vfsl-codegen/src/protocol-surface.ts` 单点持有 `PROTOCOL_EXPORT_NAMES`（issue #45 冻结快照，基点 `5907dc3` 实测导出：`VfslKind` / `PathSchema` / `UnknownPath` / `RootSchema` / `PathAt` / `VfslValueOf` / `PathValue` / `PathKind` / `PathPatchValue` / `PathElementValue` / `VfslTypedAccess` / `VfslPathMap`）。锚点：ADR-0004 D3「零运行时代码」→ 协议包运行时不可枚举、生产发射器不得依赖编译器 API → 冻结快照 + SA6 checker 实测同步锚（导出面漂移而名单未跟 → 契约②测试红）；协议包 src 本身入 DENY（禁为绕守卫增删导出、禁加运行时名单）。
2. **生成器发射层错误码族**：完整短语 kebab `<主体>-<对象>-<病症>` 形态，首码 `alias-protocol-export-collision`（本层首个码）；与 parse 层 `VFSL-E<nnn>`（v1 规格 §4，21 码冻结）及接缝层闭合三码（`missing-directive` / `dialect-mismatch` / `unknown-id`）三族词形机械隔离。锚点：ADR-0003 后果（错误表冻结）——设计显式否决「parse 层加 E312」选项。
3. **生成物四段布局不变式**：头注 / import 行 / 段②别名声明（唯一可为空的段，空时连同分隔空行消失）/ 段③增广块；相邻非空段之间恰一个空行；零别名域无双空行（现状残留随装配改造规范化）。import 行文本逐字冻结（AC-2 契约锚）：`import type { PathSchema } from '@nomicore/vfsl-protocol';`。
4. **import 行边界界定**：恒定 = 无条件发射的**模块级接线**（名字绑定 + 模块性，N1+N2 双愈机理）；类型树形状零变化——不触 ADR-0004 §8.3 六项映射（Record 通配层 / 标记→kind / Pattern→string / YXmlFragment→string / ref→别名引用 / docs→TSDoc）、不触 D5 路径形状。
5. **守卫次序与形态冻结**：ROOT 形态/值校验（既有，不变）→ `assertNoProtocolNameCollision(derived.aliases)`（新增，先于一切发射，失败零产出）→ 装配；多重碰撞按声明序一次全列；未引用（惰性积木）碰撞别名按**声明名**拦截（引用形态的超集）；ROOT 无需特判（保留名不在协议导出面）。
6. **`--check` 对碰撞域行为增强**：exit 0（历史 E5 实测静默产出）→ exit 2——碰撞产物不该存在，内容缺陷判定先于 diff 比较；守卫在生成路径上，`--check` 同走 `collectProjections`。
7. **File Scope（ALLOW/DENY）**：ALLOW = `emitter.ts`（修改）、`protocol-surface.ts`（新建）、`README.md`（文档同步）+ SA6 owned 四测试文件（断言逻辑禁改，仅可修测试基础设施）；DENY = `packages/vfsl-protocol/src/index.ts`、`packages/vfsl/src/**`（parse/evaluate 契约冻结）、`cli.ts`、`collect.ts`、`header.ts`、codegen 公共导出面（错误类不进公共面）、`docs/adr/**`、`docs/vfsl/v1-spec.md`、`tests/acceptance/**`。仓内零入仓生成物（find 实证）→ ADR-0005 §4 再生成步骤空操作成立；SA3 若见仓内出现 `domains/` 即按 ALLOW LIST 外文件报阻塞。
