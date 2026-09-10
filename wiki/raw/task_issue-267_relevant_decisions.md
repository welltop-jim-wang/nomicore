# 相关决策摘录 — issue #267（REST router 骨架：Hub create 成功路径 + Peer role gate + Lease 生命周期）

> SA8 前置门禁配套产出（iteration 0）。只摘录与本任务简报相关的决策、条款与关联点，
> 不重写原义、不作业务设计。冲突裁决见 `task_issue-267_conflict_report.md`。
> 决策集 = `docs/adr/` 全集（14 文件；0013 编号空洞）+ 根 `CONTEXT.md`；代码仅用于确认当前事实。

## 1. 权威决策：ADR 0015《纵向 REST namespace create 与内容寻址 schema ID》

状态：**提议**（2026-08-28，随集成 PR #158 在途；工作分支 HEAD `8fa85d2`（#266 经 PR #276 合入）
← `a1ca2d7`「docs: specify vertical REST namespace create」即本 ADR 引入 commit）。
本票 Parent = PR #158，挂同支实现，属 `docs/agents/issue-tracker.md` L16–18 集成 PR 纪律既定模式
（设计文档 PR 转任集成 PR、ticket 挂其下同支累积）——#266 门禁先例（B2）同款裁决。

### 1.1 模块与装配（L18–32）——本票「What to build」第 1 段的直接来源

- 建 `@nomicore/namespace-api`，REST Adapter 由 `@nomicore/namespace-api/rest` 暴露；
  **首版只公开 REST router；create 编排保持包内私有**，待第二个真实 Adapter 出现再决定公共 seam。
- REST router 是 **Host 无关的普通 Module，不是 Cordis plugin**；composition root 构造 REST 与
  WebSocket Module 时注入并共享**同一个 `NamespaceRegistry` 引用**；核心 Module 不读 Cordis
  Context、不按请求重新查找 Registry、不运行时静默替换 Registry。
- router 构造注入五项：静态实例 role（`hub | peer`）、`NamespaceRegistry`、metrics-safe observer、
  敏感 diagnostic observer、可选资源 limits。
- 配置构造时读取、校验、复制并冻结；首版无动态更新；**构造配置错误用普通 `TypeError`**。
- 标准Web `Request → Response` + **判别结果表达 route 是否匹配**；server 先按 raw path 选 route
  family；router **不拥有** listener、authentication、authorization、CORS、TLS、Request ID、
  全局并发、graceful drain。

### 1.2 受信环境与角色（L36–43）

- 首版无 authentication / owner authorization；只可暴露 localhost 或明确受信网络。
- **只有 Hub 可创建 namespace**。Peer 保持相同 route 形状，在**匹配 method/raw path 后、解析
  owner 或读取 body 前**返回 HTTP 403 + 稳定 code **`INSTANCE_ROLE_FORBIDDEN`**（该 code 全决策集
  仅此处定义）。
- **创建成功的 namespace 默认 `replication-disabled`**；启用复制必须由 Hub 独立管理操作显式决定。

### 1.3 HTTP 契约（L49–90）

- endpoint：`POST /v1/owners/{ownerUserId}/namespaces`，`Content-Type: application/json`；
  body 恰含 `schemaText` + `root` 两键。
- route **大小写敏感**、只接受**无尾随斜杠 canonical path**；owner 用 Registry 既有安全文法、path
  不允许 percent-encoding；首版不接受 query；**已知 path 非 POST → 405 + `Allow: POST`**；
  415/413/400 等校验分支（本票明确延后的部分）。
- 成功 **201，v1 response 恰含** `namespaceId` + `schema { lang, version, id }`；**不返回 `Location`**
  （首版无 GET resource）；201 表示 Persistence create 已提交、namespaceId 可用于后续 open，
  **不表示 Runtime P0 ready、不表示复制已启用**。

### 1.4 执行顺序与 Lease（L148–161）——Hub 固定顺序

1. raw route 与 method 匹配；2. role gate；3. owner/query/Content-Type/Encoding 检查；
4. 有界读取与标准 JSON 解析；5. 顶层形状与解析后资源检查；6. 派生 schema identity；
7. `Registry.create({ owner, schema, root })`；8. 成功后**立即复制 namespaceId 与 schema identity
为 owned plain DTO**；9. **恰一次**调用并等待 `lease.release()`；10. 返回 Response。
release 失败不改变已知创建事实：仍 201、经 diagnostic observer 上报、**不重复调用 release**。

### 1.5 内容寻址 schema ID（L119–144）

- REST 经 `@nomicore/vfsl` 窄接口（**#266 已交付**：`packages/vfsl/src/index.ts` 公共
  `deriveSchemaIdentity(text)` → `{ ok:true; semanticFingerprint; schemaId } | VfslIssue[]`）
  派生身份，**再组装完整 SCHEMA envelope，后调用现有 Registry create**；Registry 仍按安全入口
  重新编译并校验 ROOT，首版有意接受两次编译。
- `sc1-` + 52 位小写 RFC 4648 Base32（无 padding），payload = semantic fingerprint 完整 256-bit
  SHA-256 digest；REST 先派生后组装；本决策只要求**新 REST create** 生成 `sc1-`。

### 1.6 Observability（L186–190）

- **构造时必须显式注入两个同步 void observer；传 no-op 也必须是显式决定**；observer throw 一律
  隔离、不改变 HTTP 结果。metrics-safe observer 只低基数事件；diagnostic observer 只收 Registry
  fatal / unknown exception / Lease release failure 三类（含已验证 owner、namespaceId、exact cause，
  不含 schema/root/完整 issues）。

### 1.7 测试决策（L194–210，本票 AC3 来源）

- 最高测试 seam = 标准Web `Request → Response` 的 REST router；**相同 create 契约在
  MemoryPersistence 与 FilePersistence 上运行，断言 HTTP 结果、持久化事实、Lease 释放与 Registry
  后续 open；不读取 Registry 内部 entry map、Runtime 或 Y.Doc 私有对象**。
- REST 测试清单含：Hub 成功创建与 Peer role 拒绝；success DTO release 前复制、release 恰一次、
  release 失败仍 201 等（本票范围内的子集已入 AC）。

## 2. 支撑性已接受决策

### 2.1 ADR 0009（已接受；+#131/#134/#228 修订节）——Registry/Lease 语义

- 原文「create 输入含调用方 namespaceId」条款**已被 #131 修订节明文取代**，以 ADR 0010 身份条款
  为唯一权威；被取代条款不构成约束。
- Lease：成功 open/create 返回独立 `NamespaceLease`，是调用方唯一能力入口；**首次 `release()`
  同步标记 released，重复 release 返回 exact same Promise**；release 不追踪已接纳写。
- 公共面 v1：`open`/`create`/`getStatus`/`shutdown`（+#228 `deleteNamespace`）；测试 seam 只在受控
  testing subpath，**不允许读取内部 entry 结构**。
- 代码事实：`packages/namespace-registry/src/types.ts` L252 `CreateNamespaceInput =
  { owner; schema: unknown; root: unknown }`（无 namespaceId）。

### 2.2 ADR 0010（已接受）——namespace 身份与 replication-disabled 落点

- L28：Registry entry key 仅 `namespaceId`；普通 `Registry.create()` **不再接受调用方指定
  namespaceId**，由注入受控 128-bit CSPRNG 生成 `ns-` + 32 位小写 hex；Persistence 不维护跨
  owner 全局 catalog。
- L120：`META.replicationId` / `META.replicationEpoch` **只能由 hub 显式复制管理操作修改** ⇒
  新建 namespace 无复制身份。
- #134 修订节 O-7（L259）：复制身份未安装（`{state:'disabled'}`）的 namespace 上 open → 稳定
  拒绝 `REPLICATION_NOT_ENABLED`；L241：Runtime status replication 域只含 `disabled | enabled`
  两态。⇒ 「新建 namespace 默认 replication-disabled」的已接受机制落点。

### 2.3 ADR 0012（已接受）——实例身份单一真相

- `instanceId + role` 由独立 Instance service 承载，composition root 配置一次，Registry 与
  Hub/Peer WS plugins 共同消费；被否决方案含「Registry 与 transport 分别配置 role/instanceId」。
- 代码事实：`packages/instance` `InstanceRole = 'hub' | 'peer'`（静态、restart-only）。
- REST router 非 Cordis plugin、构造注入静态 role 属 ADR 0015 L22 明文设计；与 0012 的相容条件
  见冲突报告 B-1（role 值须同源自 Instance identity composition）。

### 2.4 ADR 0006（已接受 + 修订节）——Persistence

- DocPersistence 接口与 owner 目录分区不变；Memory/File 两 adapter 为公共测试事实
  （代码：`@nomicore/persistence` 导出 `MemoryPersistence` / `FilePersistence`）。

## 3. CONTEXT.md 相关键（逐字约束）

- **Hub / Peer / 实例角色**：peer 不能本地修改 SCHEMA 或复制身份；Avoid：Registry 与 transport
  分别配置角色、运行期切换身份。
- **namespaceId**：普通 create 由受控 CSPRNG 生成 `ns-` + 32 位小写 hex；Avoid：调用方任意指定。
- **内容寻址 schema ID**：`sc1-` canonical 形式、语义敏感度、旧式兼容；Avoid：截断 digest、把
  namespaceId/replicationId 当 schema ID。
- **信封（envelope）**：顶层 `SCHEMA` Y.Map 的 `lang/version/id/text` 四键投影严格对象。
- **createdAt**：生命周期层生成，调用方不提供（REST 只传 schema + root，不触 META）。
- **语义指纹**：`lang + version +` 规范 IR，忽略空白/普通注释、保留 JSDoc/声明顺序、排除 `id`。

## 4. 工程与流程门（非冲突基准，实施须遵守）

- 根 `AGENTS.md`：Typed Namespace writes 强制条款**不适用**于本票路径——REST 经
  `Registry.create()` 整体提交 schema/root，Writer 是 Registry 自身管线，router 不执行
  `NamespaceLease.mutateData()` 类型化写。改 `packages/` 前读最近嵌套 `AGENTS.md`（新包
  `packages/namespace-api` 落地时应随包建立该契约文件，12 个既有包同款惯例）。
- `docs/AGENTS.md`：`docs/adr/` 记录 accepted 决策——ADR 0015 现为「提议」，阶段收官应翻
  「已接受」（#266 门禁 B2 移交项延续）。
- `docs/agents/issue-tracker.md` L16–18：Parent = 集成 PR #158 纪律（本票既定挂靠）。

审查日期：2026-09-10（dispatch `sa-1ef64b6c-f2ab-4823-946a-2808cfc15b48`，iteration 0）。
