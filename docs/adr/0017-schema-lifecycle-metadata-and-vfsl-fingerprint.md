# ADR 0017：Schema 生命周期元数据（META.schema.updatedAt）与 VFSL 指纹对比

日期：2026-09-10
状态：已接受

## 背景与动机

消费方经常需要回答两个不同的问题（issue #282）：

1. namespace 中存储的 schema 是否与项目本地 `.vfsl` schema **语义**不同？
2. namespace 当前 schema generation 是**何时**安装的？

对问题 1，比较 VFSL 源文本不成立：格式与普通注释不是 schema 变化。Nomicore 的
`compileSchemaEnvelope` 已产出 `semanticFingerprint`，但从本地 VFSL 文件计算同一
值的外部工程工作流缺少规范文档。对问题 2，namespace 状态此前没有权威的 schema
安装时间：`META.createdAt` 是 namespace 创建时间，不得复用。

本决策在 `META` 下保留嵌套的 schema 生命周期元数据对象，并规范公共投影、复制
保护规则与本地 `.vfsl` 指纹对比文档。

## 决策

### META.schema 形状

```text
META
└── schema (Y.Map)
    └── updatedAt: string   // UTC ISO 8601（toISOString 产物）
```

- `META.schema` 是**嵌套 Y.Map**（不是 `META.schemaUpdatedAt` 式平铺键）——为后续
  schema 生命周期事实预留扩展位，且避免开放 META 键空间的平铺命名冲突。
- `SCHEMA` 仍是严格四键信封 `{ lang, version, id, text }`（ADR 0007 冻结）；生命
  周期元数据不进入信封，也不进入 ROOT。
- `updatedAt` 记录**当前 schema generation 成功安装**的时间，使用仓库既有的生命
  周期时间戳表示（UTC ISO 8601 字符串），不用 Unix 时间戳。

### 时钟权威

- 单时钟权威 = Registry 注入的 Instance Clock（与 `META.createdAt`、诊断
  `observedAt` 同源）。Registry 生产装配**恒**把该 Clock 注入 Runtime；Runtime
  SCHEMA 写槽在槽内单点读取（compile 成功之后、事务之前），转换成 ISO 字符串。
  Runtime 包内 seam 直构且未注入时钟时以 `Date.now` 兜底（updatedAt 是安装时间的
  诚实记录，不是验证输入）。
- 时钟读数非法（非有限 number / 超出 Date 可表示域）或时钟抛出 → SCHEMA 写槽按
  internal fault 结算（`write-slot-internal`，committed:false），零写入。

### Namespace 创建（genesis）

- `createInitialDocument` 在同一事务安装 `META.schema`（嵌套 Y.Map）并写入
  `updatedAt`。
- genesis 的 `updatedAt` **等于** `META.createdAt`：两者取自 Registry 槽内同一次
  捕获的时钟读数（同一字符串复用，零额外读数），不做第二次时钟调用。

### Schema 替换

- 成功的 `replaceSchema()` 在**同一 Yjs 事务**内提交 SCHEMA 四键、可选 ROOT
  generation 与 `META.schema.updatedAt`（doc-runtime `replaceSchemaAndRoot` 组合
  seam 唯一写入口；既有嵌套 Y.Map 原实例复用保持载体身份，缺席/异型原值修复性安装）。
- **每次提交都推进 `updatedAt`**——包括语义等价、仅格式/普通注释差异的替换：
  时间戳描述的是「提交的 SCHEMA generation」，以替换事务是否提交为准，绝不据
  `semanticFingerprint` 相等推断跳过。
- 验证失败与其他零写入结局（compile 失败、ROOT 校验失败、角色权限拒绝、capability
  gate 拒绝）不推进 `updatedAt`，也不消耗时钟读数。
- 替换提交后 dirty notification 失败（`notify-dirty-failed`，committed:true）时，
  时间戳作为已提交 generation 的一部分保留——与既有「不回滚、不卸载」行为一致。
- 时间戳与 active 身份同事务外观测：transaction 返回后立即安装的新
  `ActiveSchemaInfo` 携带同一字符串，post-transaction/pre-dirty-notification
  观测窗内公共投影即对应新 committed generation。

### Legacy 兼容（无 META.schema 的存量 namespace）

- 本特性前创建的 namespace 没有 `META.schema` 载体。公共投影对缺失（以及损坏形态：
  `schema` 非 Y.Map、`updatedAt` 非 string）一律给出 `updatedAt: null`——**诚实
  缺席**，绝不伪造派生（不复用 `createdAt`：它是 namespace 创建时间，不是 schema
  安装时间的可信代理）。
- 不做一次性受控元数据升级。存量 namespace 的首次成功 `replaceSchema()` 由同一
  事务**修复性安装** `META.schema` 并写入当次时间戳，自此进入正常生命周期。

### 公共投影

`getActiveSchema()` 的 `ActiveSchemaInfo` 由五键加性扩展为六键：

```ts
{
  lang, version, id,
  envelopeFingerprint, semanticFingerprint,
  updatedAt: string | null,
}
```

- 兼容性论证：`getActiveSchema()` 是 detached 返回值投影，消费方向为读取；加性
  第六键不破坏既有读取者（不删除、不改型既有键）。`null` 只在 legacy/损坏情形
  出现，语义为「无可信安装时间」。
- `getMetadata()` 的 META 值域规则修订（ADR 0008 增补）：嵌套 **Y.Map** 合法化，
  递归深拷贝为 plain object（`metadata.schema` 读作 `{ updatedAt }`）；其余嵌套
  Yjs shared type（Y.Array/Y.Text/Y.Xml* 等）维持 loud 拒绝。

### 复制与角色

- `META.schema` 是 schema 生命周期元数据，**随 schema generation 同行复制**：hub
  的 SCHEMA 写事务同时触碰 SCHEMA 与 `META.schema`，peer 必须整体接纳，否则
  SCHEMA 与其 `updatedAt` 在 peer 侧结构性分叉。
- ADR 0010 的 peer 侧 META 白名单由空集修订为 **`{ 'schema' }`**：peer 接收
  hub→peer update 时，`META.schema` 键的增/改/删不参与受保护相等判据；其余 META
  键（docId/createdAt/replicationId/replicationEpoch/任意自定义键）维持全键保护。
  hub 侧（接收 peer→hub）SCHEMA 全容器 + META 全键保护**不变**。
- **Peer 永不以本地接收时刻盖戳**：peer 的 `replaceSchema()` 在 Lease 接纳段即被
  角色权限拒绝（ADR 0010），peer 写路径不存在任何读取本地时钟产生 `updatedAt`
  的通道；收敛值与 hub 起源时间戳逐字节一致。
- 持久化重启与 reset/bootstrap：`META.schema` 是普通 Yjs 内容，随完整 Y.Doc 状态
  持久化与复制，逐字节保留，无特殊路径。

### 本地 `.vfsl` 指纹对比（消费方文档契约）

消费方用 `@nomicore/vfsl` 的**公共编译 API** 计算本地 schema 指纹并与 namespace
对比，规范示例与全部注意义务见
`docs/integration/external-project-vfsl-codegen.md`「本地 .vfsl 指纹对比」节。
要点（规范性）：

- 比较 `semanticFingerprint` 判定 VFSL 语义变化：它忽略格式与普通注释、排除信封
  `id`，但包含 JSDoc、声明顺序与其他 VFSL 语义。
- 只有需要精确信封同一性时才比较 `envelopeFingerprint`（含源文本与 `id`）。
- 指纹字符串含版本化域前缀（`sha256:v1:`），消费方必须把完整字符串视为不透明，
  不得自行实现 SHA/canonical-IR 逻辑。
- 编译失败必须显式处理，不得退化为文本散列对比。
- 本地信封必须使用与安装目标一致的方言（`lang`/`version`）；`id` 不参与语义
  同一性，关心 schema 谱系的项目须把 `id` 对比作为独立策略检查。
- 对比结果只用于决策提示，绝不静默触发替换。

**不新增指纹 helper API**：`compileSchemaEnvelope` 已是公共入口且直接产出双指纹，
任何 helper 都只能是它的薄转发；评估结论是文档化现有 API 优于增加第二个公共面。

### Issue #282 开放问题裁决记录

1. 存量 namespace 缺 `META.schema` → 公共投影返回 `updatedAt: null`（不做一次性
   升级；首次成功替换修复性安装）。
2. 语义等价/仅格式差异的替换**推进** `updatedAt`（以事务提交为准）。
3. 扩展恰键 `ActiveSchemaInfo` 为六键**可接受**（加性读取方向兼容），不另设
   第二投影面——单一权威来源。
4. 嵌套 `META.schema` 形状与替换事务语义归 ADR 0008（本 ADR 增补），复制保护
   规则归 ADR 0010（本 ADR 增补）；两份 ADR 以增补节修订，不废止。

## 考虑的备选

- **平铺 `META.schemaUpdatedAt` 键**：拒绝。嵌套 Y.Map 为生命周期事实族预留结构
  化扩展位，且与「SCHEMA 四键信封冻结、元数据归 META」的分层一致（issue #282
  指定形态）。
- **Unix 毫秒时间戳**：拒绝。仓库生命周期时间戳的既定表示是 UTC ISO 8601 字符串
  （`META.createdAt`、诊断 manifest），不引入第二种表示。
- **语义等价替换不推进 `updatedAt`**：拒绝。「是否构成新 generation」若以语义指纹
  推断，会让「提交了一个替换事务」与「时间戳未变」并存，消费者无法区分「没换过」
  与「换了但等价」；以提交为准更诚实且实现更简单。
- **一次性受控元数据升级**：拒绝。`null` + 首次替换修复性安装以零迁移成本达到
  同等诚实性，且不存在「升级事务本身该写什么时刻」的自指问题。
- **新增 `@nomicore/vfsl` 指纹 helper**：拒绝。只能是 `compileSchemaEnvelope` 的
  薄转发，徒增公共面；文档化现有 API（本 ADR + integration 文档）。

## Consequences

- 新 namespace 的 `META` 顶层由二键变三键（`docId`/`createdAt`/`schema`）；
  `createInitialDocument` 的写后核验同步升级为三键 + 嵌套载体核验。
- `getMetadata()` 对含 `META.schema` 的文档多返回一个 `schema` 键（plain object）；
  legacy 文档输出不变。
- peer 侧保护字段判据出现首个非空白名单键；`REPLICATION_PROTECTED_FIELDS_CHANGED`
  的覆盖面随之收窄一格（仅 `META.schema`，hub→peer 方向）。
- 混版本滚转窗口：旧版本 peer 收到新版本 hub 的 SCHEMA 替换更新（触碰
  `META.schema`）会按旧规则以 `REPLICATION_PROTECTED_FIELDS_CHANGED` 拒绝并标记
  needs-resync；升级 peer 后收敛。Hub/Peer 部署应先升级 peer 侧或同时升级。

## 取代关系

- 增补 ADR 0008：`getMetadata()` 值域（嵌套 Y.Map 合法化）、`getActiveSchema()`
  六键投影、SCHEMA write 事务语义（`META.schema.updatedAt` 同事务提交）、
  genesis META 三键形状。
- 增补 ADR 0010：peer 侧 META 白名单 `{ 'schema' }`（「peer 允许的 META 白名单
  首版 = 空集」句被本 ADR 修订）。
- 其余 ADR 0007/0008/0010 条款维持原文效力。
