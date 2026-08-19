# ADR 0005：投影生成管线——SchemaSource 接缝、生成器输入契约、生成物入仓

日期：2026-08-19
状态：已接受（grill 定稿，Phase 1 前置；与 ADR 0004 互补——0004 定「类型长什么样」，本 ADR 定「类型怎么被生产并保持新鲜」）

## 背景

ADR 0001 修订节放行阶段态脚手架（仓内 schema 文件），纪律是「一切消费方经 SchemaSource 接缝取文本，脚手架不长成承重墙」。本 ADR 冻结该接缝的形状、生成器的输入契约与生成物的保鲜机制。

## 决策

### 1. SchemaSource 接缝

```ts
interface SchemaSource {
  load(id: string): Promise<SchemaEnvelope>;  // { lang, version, id, text }
  list(): Promise<string[]>;                  // CI 枚举全部领域
}
```

- **async 从第一天起**：DocSchemaSource 终态走网络；接缝按终态设计，不按脚手架现状设计；
- **返回完整信封**而非裸文本：`lang`/`version` 是方言身份；
- **消费方首动作 = 方言断言**（`lang==='vfsl' && version===1`，否则响亮失败）——方言冻结纪律焊进生成管线；
- **id 是标签不是键**：引擎正确性不依赖 id 唯一性（自包含设计消灭了注册表）；id 的用途是人读标签、管理端谱系追踪、工具链寻址。信封 id ≠ doc 地址（终态 doc 寻址键是房间名/guid）。

### 2. 脚手架文件格式：`.vfsl` 单文件 + 头部指令注释

```vfsl
// @lang: vfsl
// @id: vfs3.assets@1
// @version: 1

/** vfs3.assets — … */
type ROOT = …
```

- 行注释是方言 trivia → 整个文件 `parseVfsl` 可直接解析，零预处理、零微格式；
- 三键全部必需，缺失或方言不符 → 响亮拒绝（防错冗余：拿错文件 = 当场报错，不是静默按错规则处理）；
- `@` 前缀标记机器指令，与散文注释视觉隔离；这是**文件格式约定**，不是语义层机器标签（ADR 0001 的无机器标签条款不触及）；
- FileSchemaSource 组装信封：`text` = 整个文件原文（含头部），内容哈希直接；
- 被否：信封 JSON 嵌文本（`\n`/`\"` 转义汤，不可读不可 diff）、YAML block scalar（新格式 + 解析依赖）、frontmatter（`---` 微格式，工具须记得剥头）。

### 3. 生成器输入契约

- **输入 = `evaluate` 的派生 schema**（不直接吃 IR）：物化折叠、联合三分类、判别式检测只计算一次（单一真相），生成器是纯发射器；
- **派生 schema 必须携带 `docs`**（从 IR 节点继承）——TSDoc 发射（IDE hover 中文说明）与 Phase 4 AI namespace card 都依赖它；此要求写入 #20 验收；
- 反方（吃 IR + 导出分类助手）：同一语义被两个公共面分别消费，冻结成本翻倍。

### 4. 生成物入仓 + CI regen-diff

- 生成文件入仓（纯类型文本，无构建期排除的理由），头注 `GENERATED … DO NOT EDIT` + 源文本哈希；
- CI `generate --check`：全量重新生成 → diff 为空；**源漂移与生成器逻辑漂移双抓**（纯哈希比对抓不了后者）；
- schema 改动与重新生成同一原子提交；
- 可评审性红利：PR diff 同时呈现 schema 改动与类型投影改动（§8.5 迁移清单价值在评审环节先兑现）；
- 被否：构建时生成（包间构建顺序依赖、干净 clone 后 IDE 全红、生成器版本漂移）。

### 5. 领域包位置：顶层 `domains/`

`packages/` = 可复用库，`apps/` = 可执行体，`domains/` = 业务 schema 包（schema.vfsl + generated.ts + 挂载点 + dogfood 测试）。按可独立发布标准组织——终态可迁至产品仓，阶段态与生成器同仓保证 CI 原子校验。

## 后果

- #20（求值器）验收追加：派生 schema 携带 docs；
- 票拆分：F1（接缝 + FileSchemaSource + 方言断言 + 脚手架校验 CI，无依赖可即发）；F2（生成器，blocked by #20 + F1）；G（domains/vfs3-assets dogfood，blocked by F2）；
- 生成器包：`@nomicore/vfsl-codegen`（协议包按 ADR 0004 D3 不含生成器）。

## 关联

- ADR 0001 修订节（目标态/阶段态二分、脚手架纪律）、ADR 0003（派生 schema 契约）、ADR 0004（类型机制与映射表）
- 设计文档 §6（信封）、§8（类型投影）、§15（Phase 1）
