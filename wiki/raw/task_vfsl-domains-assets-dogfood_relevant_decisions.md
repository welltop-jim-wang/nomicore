# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出（任务：domains/vfs3-assets 领域包 dogfood，issue #27）。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。

## 相关 ADR

### ADR-0005 投影生成管线（accepted）—— 本任务的直接依据

- 与本任务的关联点：本任务 = ADR 0005 后果中的票 G（domains/vfs3-assets dogfood，blocked by F2）；§5 定领域包位置与组成，§2 定脚手架文件格式，§4 定生成物入仓与 CI 保鲜。
- 核心条款（原文摘录）：
  - §2：「三键全部必需，缺失或方言不符 → 响亮拒绝（防错冗余：拿错文件 = 当场报错，不是静默按错规则处理）」
  - §2：「`@` 前缀标记机器指令，与散文注释视觉隔离；这是**文件格式约定**，不是语义层机器标签（ADR 0001 的无机器标签条款不触及）」
  - §2：「FileSchemaSource 组装信封：`text` = 整个文件原文（含头部），内容哈希直接」
  - §4：「生成文件入仓（纯类型文本，无构建期排除的理由），头注 `GENERATED … DO NOT EDIT` + 源文本哈希」
  - §4：「CI `generate --check`：全量重新生成 → diff 为空；**源漂移与生成器逻辑漂移双抓**」
  - §4：「schema 改动与重新生成同一原子提交」
  - §5：「`packages/` = 可复用库，`apps/` = 可执行体，`domains/` = 业务 schema 包（schema.vfsl + generated.ts + 挂载点 + dogfood 测试）。按可独立发布标准组织——终态可迁至产品仓，阶段态与生成器同仓保证 CI 原子校验。」
  - §1：「**消费方首动作 = 方言断言**（`lang==='vfsl' && version===1`，否则响亮失败）——方言冻结纪律焊进生成管线」

脚手架文件头部指令格式（ADR 0005 §2 样例原文）：

```vfsl
// @lang: vfsl
// @id: vfs3.assets@1
// @version: 1
```

### ADR-0004 vfsl-protocol 类型协议包（accepted）—— typecheck 测试与生成物的类型机制依据

- 与本任务的关联点：AC「§8.4 正负例 typecheck 测试」与「迁移演示旧路径 → UnknownPath」直接落在 D3/D4/D5；generated.ts 的类型树形状 = ADR 0004 + 设计文档 §8.3 映射表（ADR 0004 后果）。
- 核心条款（原文摘录）：
  - D3：「全部内容为类型空间产物（幻影 `unique symbol` 口袋、`PathSchema`/`PathAt`/`PathValue`/`PathKind`/`UnknownPath`、`VfslPathMap` 空表、`VfslTypedAccess` 接口签名）——编译后为空模块，零依赖、零运行时代码」
  - D3：「空 `VfslPathMap` 默认 **fail-closed**：未引入领域包增广时一切路径解析为 `UnknownPath`，任何 patch 即编译错误」
  - D4：「vitest typecheck 模式；正例用 `expectTypeOf`（类型相等断言），负例用 `@ts-expect-error`（自我反转断言：该行被错误放行时测试反而失败）；设计文档 §8.4 的正负例矩阵原样复刻为编译断言。」
  - D5：「`VfslPathMap` 顶层键 = ROOT 的字段（`['assets', id, 'name']`，不是 `['ROOT', 'assets', …]`）；ROOT 是 doc 级固定挂载点，挂载知识只出现在绑定实现的 `doc.getMap('ROOT')` 一处。」
  - 后果：「类型树形状 = 生成契约：票 F 生成器的输出规格即本 ADR + 设计文档 §8.3 映射表（Record 通配层 / 标记→kind / Pattern→string / YXmlFragment→string / ref→别名引用 / docs→TSDoc 注释）」
  - 后果：「领域包增广文件受 CI 新鲜度校验（生成物与 SchemaSource 源漂移即失败）。」

### ADR-0003 求值器与派生 schema（accepted）—— fixture 形态与 TSDoc docs 来源

- 与本任务的关联点：schema.vfsl 采用规格 §10 修订版 fixture，其 ROOT 形态由本 ADR 冻结；generated.ts 的 TSDoc 依赖派生 schema 携带 docs。
- 核心条款（原文摘录）：
  - §2：「每个模块必须恰好声明一个名为 `ROOT` 的别名（大小写是契约，`root` / `Root` 不算），且必须 **map 形**（clsOf = map：裸对象 / `YMap` / `Record` / 全 map 形联合）——ROOT 固定物化为 Y.Map，`YArray` / `YXmlFragment` 与标量形一律拒绝。」
  - §2：「Yjs 映射为 `doc.getMap('ROOT')`。`ROOT` 可被其他别名引用（既当根又当积木，合法）；其余无人引用的别名是惰性积木——合法、不进数据面。」
  - §5：「`xml-fragment` 是结构树的**终态节点**：无 children、路径下钻守卫到此为止；JSON 快照中其值为 XML 字符串……」
  - 后果：「规格修订：§3 新增 ROOT 约定小节、§4 错误表新增 E310/E311（19 → 21 码）、§10 fixture `AssetsDoc` 改名 `ROOT`」

### ADR-0001 VFSL 单一真相源（accepted，2026-08-19 修订）—— 脚手架纪律边界

- 与本任务的关联点：仓内 schema.vfsl 属修订节放行的「阶段态脚手架」，受脚手架纪律约束；本任务自身是脚手架的生产方而非消费方，纪律要点供下游 SA 知悉。
- 核心条款（原文摘录）：
  - 修订节：「**阶段态放行**：体系未完全建立之前，允许仓内放置 schema 文件作为**开发脚手架**完成阶段性开发（类型投影、演示、联调）」
  - 修订节：「**脚手架纪律**：一切脚手架消费方必须经 **SchemaSource 接缝**取文本（阶段实现 = 仓内文件源），不得直接读文件——终态切换为 DocSchemaSource（从 server/`__schema__` 拉取）时零消费方改动。脚手架不能长成承重墙」
  - 「语义层**不设机器标签**……全部 JSDoc 标签……为文档性质，未识别仅 warn」（§2 头部指令是文件格式约定，不触及本条——见 ADR 0005 §2）

### ADR-0002 nomicore 重写 / authority 出范围（accepted）—— 背景约束

- 与本任务的关联点：仅范围确认——本任务不触及 authority 规则体系。
- 核心条款（原文摘录）：
  - 「旧系统既有的 authority 规则体系（`__authority__` manifest：enum / range / conditional / state-machine）**完全排除在范围外，不保留接口**」

## CONTEXT.md 相关术语与惯例

- `ROOT`：「命名空间根别名的保留名（大小写是契约）：每个模块必须恰好声明一个 map 形的 `type ROOT = …`（裸对象 / `YMap` / `Record`），ROOT 固定物化为 Y.Map，Yjs 映射为 doc 根 `getMap('ROOT')`。其余无人引用的别名是惰性积木，不进数据面。」（Avoid: 隐式根、汇点推导）
- `标记类型（marker types）`：「`YMap` / `YArray` / `YPlainArray` / `YLeaf` / `YXmlFragment` / `Pattern`；tsc 视角恒等别名，引擎视角是 Yjs 物化语义标记。」（Avoid: `YLEaf`、`yleaf` 等变体拼写——大小写是契约）
- `信封（envelope）`：「`__schema__` 里的 `{ lang, version, id, text }`；单字符串值，原子替换、可哈希、可 diff。」
- `方言（dialect）`：「`lang + version` 决定的 VFSL 语法子集与语义规格；一经发布冻结，引擎只增不改，未知方言 loud-fail 只读。」
- `语义层（semantic layer）`：「JSDoc 首行自由文本 + `@tag` 半结构化标签；全部为文档性质，未识别仅 warn（无机器标签）。」
- `判别联合（discriminated union）`：「字面量联合字段（如 `kind`）区分的变体；引擎自动识别判别字段并按变体验证。」（fixture 的 AssetEntity 即此形态）
- `封闭对象（closed object）`：「子集内对象类型默认封闭：未声明字段拒绝。」

## 既有 CI 阶段门背景（wiki 证据，非约束）

- `.github/workflows/ci.yml` 当前 regen-diff 步骤为 `pnpm generate --check --allow-empty-domains`（F2 阶段门，带 TODO(#27) 注记「G 票种植首领域后移除」）；本任务 AC 要求移除该 flag、零领域集复为响亮失败——此为 F2 设计的既定交接项，与 ADR 0005 §4「双抓」方向一致。

## 设计后复审追加（SA1 R1 设计引入的新决策点，2026-08-21）

> 以下为 SA1 设计引入、ADR 未直接冻结的决策点；SA8 已逐项裁决（见 `_design_conflict_report.md`），摘录于此供 SA2/SA3 复用。

- **D4 id 取值 `@id: vfs3-assets@1`**：ADR 0005 §2 冻结的是「三键全部必需 + 响亮拒绝」，样例 `vfs3.assets@1` 是格式示例非冻结值；§1「id 是标签不是键」；规格 §7「id 对 parser 不透明（不解析、不校验唯一性）」。目录名 `vfs3-assets` 由简报/包名钉死，F2 `collect.ts` `assertIdBaseDir`（idBase==目录名，违者 exit 2）迫使 id 迁就目录名。裁决：no-conflict。
- **D2 协议包三处内部类型修复**（`MemberKeys` 改 distributive `keyof`；`VfslValueOf`/`PathPatchUnwrap` 同态 keyof 映射）：修复 `Record<infer Key, unknown>` 对含可选成员表推断坍缩的缺陷，恢复 ADR 0004 D2 联合键空间并集本意；D3 fail-closed 方向不变（`keyof {}` = never）；导出面 12 名冻结名单无增删；ADR 0004 后果「协议包独立演进节奏：类型规则变更 → 消费方重编译即见」。裁决：no-conflict（缺陷修复，非 ADR 演进）。
- **D3 AC5 选 (a)**：schema.vfsl 保持规格 §10 逐字（ADR 0001 单一真相源），标记位 TSDoc 臂空转 + 守门链（fixture 驱动自动激活 + F1 `evaluate-derived-docs-audit.test.ts` 性质断言）；缺口路由规格轴 follow-up（#46）。ADR 0005 §3「派生 schema 必须携带 docs」约束对象是 evaluate 产物（#20 验收，已闭环），非本票 fixture 数据。裁决：no-conflict（证据缺口非条款违反；完整性判断归 SA2/总控）。
