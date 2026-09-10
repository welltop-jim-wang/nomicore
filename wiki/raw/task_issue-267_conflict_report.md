# 冲突门禁报告 — issue #267（前置门禁）

## 1. Reviewed subject

**task** —— GitHub issue #267 任务简报「REST router 骨架：Hub create 成功路径 + Peer role gate +
Lease 生命周期」（`wiki/raw/task_issue-267.md`，State: open，Parent PR #158
`docs/rest-namespace-create`，Blocked by #266）。Issue 评论 REST snapshot 为空（`[]`），
无 Owner 追加要求、无 override 授权。

## 2. Inputs and decision set

- 冲突基准 = `docs/adr/` 全集（14 文件全读：0001–0012、0014、0015；0013 编号空洞、无重号）
  + 根 `CONTEXT.md`。规范协议 `docs/protocols/instance-replication-v1.md` 检索核对（`replication-disabled`
  出现处为 ws 复制 cause 词表，与 REST 无关）。
- ADR 状态盘点：0001–0012、0014 **已接受**；**0015 提议**（随集成 PR #158 在途）。无 superseded
  整册；被取代**条款**（ADR 0007 Runtime/open/read 由 0008 取代、ADR 0009 原 create 身份条款由
  #131 修订节取代）不构成约束，未参与裁决。
- 代码事实（仅确认现状，不替代决策文本）：`packages/namespace-api` **尚不存在**（本票新建）；
  #266 已合入（HEAD `8fa85d2`，`deriveSchemaIdentity` 公共窄接口 + `sc1-` 编码在
  `packages/vfsl`）；`CreateNamespaceInput = { owner; schema; root }`（无 namespaceId）；
  `MemoryPersistence`/`FilePersistence` 公共导出；`InstanceRole = 'hub' | 'peer'`。Blocked-by #266
  依赖已满足。
- 执行说明：`sa8-conflict-gate` 技能不在会话技能目录，按 preset 内 `conflict-gate` SKILL 规程 +
  SA8 角色章程执行；分类口径用现行四级（no-conflict / implements-existing-decision /
  evolution-required / hard-conflict），与 #266 门禁先例的旧四级（no-conflict / override-declared /
  evolution / hard-violation）一一对应（先例本轮全 no-conflict，无换算歧义）。除两份门禁产出外
  零文件改动。

## 3. Decision analysis

| # | Decision | Clause | Subject behavior | Classification | Evidence | Required action |
|---|---|---|---|---|---|---|
| 1 | ADR 0015（提议） | §模块与装配 L18–32 | 简报：建 `@nomicore/namespace-api`、`/rest` 子路径、首版只公开 router、create 编排包内私有、普通 Module 非 Cordis plugin、`Request → Response` + 判别 route 匹配、不拥有 listener/auth/CORS/TLS/RequestID/并发/drain、配置构造时冻结 + `TypeError` | **implements-existing-decision** | 简报 L17 与 L18–32 逐条对应（五项构造注入中 observers/limits 的延后见 B-2）；「共享同一 Registry 引用」与 ADR 0009 单 Runtime 不变量同源 | 无——按 ADR 0015 实施 |
| 2 | ADR 0015（提议） | §受信环境与角色 L38–43；CONTEXT.md「Hub/Peer/实例角色」 | 简报：只有 Hub create；Peer 在匹配 method/raw path 后、解析 owner/读 body 前返回 403 + `INSTANCE_ROLE_FORBIDDEN`；新建 namespace 默认 `replication-disabled` | **implements-existing-decision** | `INSTANCE_ROLE_FORBIDDEN` 全决策集仅 ADR 0015 L41 定义，简报 L19 逐字一致；405（方法不匹配）先于 role gate 的顺序由 §执行顺序 step 1→2 保持，简报 AC2「匹配 method/raw path 后」与 AC6 相容；`replication-disabled` 的已接受机制落点见行 7 | 无 |
| 3 | ADR 0015（提议） | §HTTP 契约 L49–90 | 简报：`POST /v1/owners/{ownerUserId}/namespaces` 成功 201 恰含 `namespaceId` + `schema{lang,version,id}`、不返回 `Location`；route 大小写敏感、无尾随斜杠 canonical；已知 path 非 POST → 405 + `Allow: POST` | **implements-existing-decision** | 简报 L19 + AC1/AC6 与 L65–L90 逐字对应；「恰含」= v1 冻结 response 形状；201 语义不含 P0 ready 承诺（简报亦未声称） | 无 |
| 4 | ADR 0015（提议） | §执行顺序与 Lease L148–161；ADR 0009 §NamespaceLease（已接受） | 简报：成功后先复制 namespaceId + schema identity 为 owned plain DTO，再恰一次调用并等待 `lease.release()`；release 失败仍 201、不重复调用 | **implements-existing-decision** | 简报 L21 + AC4 = L157–161 逐字对应；与 ADR 0009「首次 release 同步标记 released、重复 release 返回 exact same Promise」相容（简报『恰一次不重复』是更严的使用纪律，不改变 Lease 契约） | 无 |
| 5 | ADR 0015（提议） | §内容寻址 schema ID L119–144；CONTEXT.md「内容寻址 schema ID/语义指纹」 | 简报：派生 schema identity → 组装完整 SCHEMA envelope → `Registry.create({owner, schema, root})`；AC1 要求 `sc1-` id | **implements-existing-decision** | 依赖接口已由 #266 交付（`deriveSchemaIdentity`，HEAD `8fa85d2`）；Blocked-by 已满足；「先派生后组装再经 Registry 安全入口、接受两次编译」= L142 原文 | 无 |
| 6 | ADR 0009（已接受，+#131 修订节）+ ADR 0010 L28–30（已接受） | create 输入与 namespaceId 生成；entry key 仅 namespaceId | 简报：`Registry.create({ owner, schema, root })`（不带 namespaceId） | **no-conflict** | ADR 0009 原文「调用方传 namespaceId」已被 #131 修订节明文取代（以 ADR 0010 为唯一权威）；代码 `CreateNamespaceInput` 三键事实一致；CONTEXT.md「namespaceId」Avoid 清单（调用方任意指定）未被触碰 | 无 |
| 7 | ADR 0010（已接受）L120 + #134 修订节 O-7/L241 | 复制身份只能由 Hub 显式管理操作安装；未安装 = `{state:'disabled'}`，open → `REPLICATION_NOT_ENABLED` | 简报 AC5：新建 namespace 为 `replication-disabled` | **no-conflict** | 已接受机制自然导出：普通 create 不装 `replicationId/epoch` ⇒ 状态 `disabled`；ADR 0015 L43 只是显式复述；REST 侧无需新增行为 | 无 |
| 8 | ADR 0012（已接受） | Instance service 是 `instanceId + role` 唯一生产来源；被否决「Registry 与 transport 分别配置 role」 | 简报：router 为普通 Module、构造期 role gate（role 来源未细说） | **no-conflict**（附边界条件 B-1） | REST router 非 Cordis plugin，不在 0012 的 plugin 强制域内；ADR 0015 L22 明文「静态实例 role 注入」为后来设计。相容条件：注入 router 的 role 值必须同源自 composition root 的 Instance identity，不得成为第二份独立 role 配置（CONTEXT.md「实例角色」Avoid 清单） | 设计后复审核对 B-1 |
| 9 | ADR 0015（提议） | §测试决策 L194–210；ADR 0009 testing subpath 纪律 | 简报 AC3：相同 create 契约在 MemoryPersistence 与 FilePersistence 上运行，断言 HTTP 结果、持久化事实、Lease 释放与 Registry 后续 open；不读取 Registry 内部 entry map、Runtime 或 Y.Doc 私有对象 | **implements-existing-decision** | 简报 AC3 = L194 逐字；两 Persistence 为公共导出（ADR 0006 域）；「不读内部结构」与 ADR 0009「测试 seam 只在受控 testing subpath、不允许读取内部 entry」同源 | 无 |
| 10 | ADR 0015（提议） | §执行顺序 step 3–5（owner/query/media 检查、有界读取、形状/limits）+ §HTTP 错误契约 + §Observability L186 | 简报：本票只做成功路径与 role gate；请求形状校验、limits、Registry 失败映射、observer 契约由后续 ticket 叠加 | **no-conflict**（切片，附边界条件 B-2/B-3） | 层积切片不 reorder 已实现面的可观察顺序：Peer 403 在解析 owner/读 body 前（简报明文）= step 1→2 先于 3–4；Hub 成功路径上 step 3–5 为直通。B-2：ADR 0015 L186「构造时必须显式注入两个同步 void observer（no-op 须显式）」是构造面冻结条款——骨架若整体省略 observer 参数，后续 ticket 将被迫改公共构造签名 | 设计后复审核对 B-2/B-3 |
| 11 | `docs/agents/issue-tracker.md` L16–18 + `docs/AGENTS.md`（Authority） | 集成 PR 纪律：设计文档 PR 转任集成 PR、ticket 挂其下同支累积；`docs/adr/` 记录 accepted 决策 | 简报 Parent = PR #158；ADR 0015 状态「提议」 | **no-conflict** | 与 #266 门禁 B2 同款裁决：挂 PR #158 分支实现正是既定流程（分支事实：`mabf/issue-267` @ `8fa85d2` ← `a1ca2d7` 即 ADR 0015 commit）；「提议」状态非冲突，收官翻「已接受」属流程义务 | 移交总控：收官清单登记状态翻转（延续 #266 B2） |
| 12 | 根 AGENTS.md「Typed Namespace writes — mandatory」 | Namespace 数据变更必须走生成投影 + typed adapter over `mutateData()` | 简报：REST 经 `Registry.create({owner, schema, root})` 整体提交 | **no-conflict**（不适用） | Router 不持有 lease、不执行 `mutateData()` 类型化写；写者是 Registry 自身 create 管线（ADR 0009 §Create）；该强制条款针对应用侧 Namespace 数据写路径 | 无 |
| 13 | ADR 0006（已接受 + 修订节）/ ADR 0007 / ADR 0008 / ADR 0011 / ADR 0014 | Persistence 布局、Runtime/P0、诊断日志 | 简报：不触持久化格式、Runtime 内部、诊断日志 | **no-conflict** | 本票为 Registry 之上的新消费者：不改 Persistence 布局/owner 分区，不触碰 Runtime 公共面与 P0 语义（201 ≠ P0 ready），diagnostic change log 域零触及（REST diagnostic observer 属 ADR 0015 域且本票延后） | 无 |

裁决分布：**implements-existing-decision 6**（行 1–5、9）＋ **no-conflict 7**（行 6–8、10–13）＝ 13 项；
**evolution-required 0；hard-conflict 0**。

## 4. Overrides

| Old decision | Override authority | Scope | New obligation |
|---|---|---|---|
| —（无） | — | — | — |

无任何条款需要 override。合法 override 来源核查：Issue 评论为空（无 Owner 授权）；无新 ADR 修订/
废弃；无协议版本升级；ADR 0015 自身为被审对象的 governing 设计而非被推翻对象。

## 5. Frozen surfaces

| Surface | Must remain unchanged | Evidence | Actual result |
|---|---|---|---|
| `sc1-` schema ID 格式 | `sc1-` + 52 位小写 RFC 4648 Base32（无 padding），payload = semantic fingerprint 完整 256-bit SHA-256 digest | ADR 0015 L127–133；CONTEXT.md 词条；#266 已实现（`packages/vfsl/src/schema-id.ts`） | 简报仅消费（AC1 要求 `sc1-` id），不改格式 — 一致 |
| SCHEMA 信封四键 | `lang/version/id/text` 严格四键投影 | CONTEXT.md「信封」；ADR 0001/0007 | REST 组装完整 envelope 交 Registry — 一致 |
| namespaceId 生成 | 普通_create 由 Registry 受控 CSPRNG 生成 `ns-` + 32 位小写 hex；调用方不指定 | ADR 0010 L28；CONTEXT.md「namespaceId」 | 简报不传 namespaceId — 一致 |
| v1 成功 response 形状 | 恰含 `namespaceId` + `schema{lang,version,id}`；无 `Location` | ADR 0015 L77–90 | AC1 同款 — 一致 |
| 稳定 code `INSTANCE_ROLE_FORBIDDEN` | 命名与 403 映射冻结 | ADR 0015 L41 | AC2 同款 — 一致 |
| 方法错误语义 | 已知 path 非 POST → 405 + `Allow: POST`；route 大小写敏感、无尾随斜杠 canonical | ADR 0015 L65–68 | AC6 同款 — 一致 |
| Registry 公共面与 Lease 契约 | `open/create/getStatus/shutdown`（+#228 `deleteNamespace`）不变；首次 release 同步 released、重复 release 同一 Promise | ADR 0009 §公共 Interface/§NamespaceLease + 修订节 | REST 为新消费者，不扩 Registry、不改 release 语义 — 一致 |
| 复制身份安装权 | `META.replicationId/epoch` 只能由 Hub 显式管理操作修改；新 namespace 无复制身份 | ADR 0010 L120、#134 O-7 | 简报默认 `replication-disabled`，零新增行为 — 一致 |
| 实例角色单真相 | role 值同源自 Instance identity composition | ADR 0012；CONTEXT.md「实例角色」Avoid | 简报未指定来源 — 待设计后复审（B-1） |

## 6. Evolution requirements

无 `evolution-required` 项。本票不改变任何既有契约：REST router 是 ADR 0015 已设计的**新增**消费面，
Registry/Lease/Persistence/VFSL 公共面零修改。ADR 0015「提议 → 已接受」是状态流转义务（流程项，
见行 11），非契约语义演进，不需要修订计划。

## 7. Hard conflicts

无。

## 8. Required actions（移交下链，均不阻塞）

1. **B-1（role 单真相）**：SA1 设计须明确 router 构造期注入的 `hub | peer` 来源于 composition
   root 的 Instance identity（同一事实源），不得引入第二份独立 role 配置（ADR 0012 意图 +
   CONTEXT.md「实例角色」Avoid 清单）；设计后复审核对。
2. **B-2（observer 构造面）**：ADR 0015 L186 冻结「构造时必须显式注入两个同步 void observer
   （no-op 须显式）」。简报把「observer 契约」延后——SA1 应把延后范围限定为**事件发射契约**，
   构造签名保留两 observer 参数（显式 no-op），避免后续 ticket 被迫改公共构造面；设计后复审核对。
3. **B-3（固定顺序不被骨架 reorder）**：骨架只实现 step 1–2、6–10 的成功路径，须保持
   「role gate 先于 owner 解析/body 读取」「success DTO 复制先于 release」的既定相对顺序；
   已实现面不得产生与 step 3–5 相反的可观察顺序（如 Hub 在 owner 校验前读 body 的错误分支）。
   设计后复审核对。
4. **流程项**：阶段收官把 ADR 0015 状态由「提议」翻「已接受」（延续 #266 门禁 B2 移交；
   `docs/AGENTS.md` Authority 条款）。新包 `packages/namespace-api` 落地时按 12 个既有包惯例建立
   包级 `AGENTS.md` 契约（根 AGENTS.md 模块纪律）。

## 9. Verdict

**`clear`**

任务简报与 ADR 决策集 + CONTEXT.md **无冲突**：#267 是 ADR 0015（模块装配 / 角色门 / HTTP 成功
契约 / Lease 编排 / 测试 seam）在 REST vertical 本体上的**兑现型切片**，六项核心条款逐字对应；
Registry/Lease/Persistence/VFSL 既有公共面零修改；Blocked-by #266 已合入。无 hard-conflict、
无 override 需求、无未声明的决策演进。放行，按任务类型路由继续（SA1 设计 → SA2 全维度评审 →
实现链；设计后 SA8 复审按惯例执行，重点核对 B-1/B-2/B-3）。

## 10. requiresConflictRecheck

**true**。理由：本票将新建公共 REST API 面（`@nomicore/namespace-api/rest` router 构造签名与
`Request → Response` 契约）、新增 HTTP 失败语义落地（403 `INSTANCE_ROLE_FORBIDDEN`、405 +
`Allow: POST`、release 失败仍 201）与 Lease 编排时序——公共 API、失败语义与生命周期面尚待
设计/实现核对；且 B-1/B-2/B-3 三项边界条件须在设计后复审逐项闭合。

---

非阻断登记（供总控知悉，不构成冲突）：

- **Git 配置残留**：worktree 本地 `mabf.issue=74`、`mabf.branch=fix/issue-109-...`、
  `mabf.base-branch=docs/namespace-diagnostic-change-log`、`mabf.tasktype=unspecified` 与本任务
  不符（疑建仓残留，与 #266/#228 门禁所见同款）；当前分支 `mabf/issue-267` 正确。发布/base 推导
  属 runner 职责，本门禁不改 git 配置。
- **历史对象库局部缺损**：`git log` 遍历远期历史时报 commit-graph/object database 不一致
  （`860729c…` 缺失）；近期链（HEAD → a1ca2d7 → …）遍历正常，不影响本门禁证据。
- **技能可用性**：`sa8-conflict-gate` 技能不在会话技能目录；按 preset `conflict-gate` SKILL 规程
  与角色章程执行，裁决口径与先例一致。

审查日期：2026-09-10（dispatch `sa-1ef64b6c-f2ab-4823-946a-2808cfc15b48`，iteration 0，前置门禁）。
