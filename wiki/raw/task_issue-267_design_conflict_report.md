# 冲突门禁报告（设计后复审）— issue #267 SA1 设计 vs 决策集

- **被审对象**：`wiki/raw/task_issue-267_design.md`（SA1 设计，iteration 0，自记
  `requiresConflictRecheck: true`，理由 4 项：新公共 API 面 / 新 HTTP 失败语义 / B-1~B-3 边界
  闭合 / 对「提议」状态 ADR 0015 的解释确认）。
- **冲突基准**：`docs/adr/` 全集（0001–0012、0014、0015；0013 编号空洞，共 14 文件）+ 根
  `CONTEXT.md`。被 superseded 的**条款**（ADR 0007 Runtime/open/read 条款、ADR 0009 原调用方
  namespaceId 条款）不构成约束，未参与裁决。
- **复审类型**：设计后复审（SA2 全维度评审**之前**的冲突复核；不判断设计优劣、不判断实现质量、
  不做架构仲裁）。
- **上游证据基线**：HEAD `8fa85d2`（= `fix(#266): VFSL 内容寻址 schema ID（sc1-）… (#276)`，
  branch `mabf/issue-267`；Blocked-by #266 已合入）；SA6 冻结契约
  `packages/namespace-api/test/`（5 文件，35 用例）在场且未被改动（git untracked，逐文件核对）；
  无既有 `task_issue-267_sa2_review.md`（SA2 评审输入不存在，与设计 §14 自记一致）。
- **Issue comments**：REST snapshot 为空（`[]`，简报/SA6/SA8 三方同证）——无 Owner 追加要求、
  无 override 授权；本复审无 Owner 裁决输入。
- **上游链**：SA8 前置门禁 `task_issue-267_conflict_report.md`（iteration 0，verdict `clear`，
  13 项裁决，0 evolution-required / 0 hard-conflict，冻结面 9 项，移交 B-1/B-2/B-3）→
  SA6 契约 `task_issue-267_sa6_contract.md`（verdict `approve`，35 用例红灯固化）→
  SA1 设计（本复审对象）。
- **执行说明**：`sa8-conflict-gate` 技能不在会话技能目录（与迭代 0 同况），按角色章程 + 迭代 0
  已声明的现行四级口径（no-conflict / implements-existing-decision / evolution-required /
  hard-conflict）执行。除本报告外零文件改动。

## Verdict

**`clear`** —— SA1 设计与 ADR 全集 + CONTEXT.md **零冲突**，可进入 SA2 设计评审。

裁决分布（8 个复审面）：**implements-existing-decision 5**（S1/S2/S3/S5/S6）＋
**no-conflict 3**（S4/S7/S8）＝ 8 项；**evolution-required 0；hard-conflict 0；override 0**。
另有 **2 条 advisory 文档精度项（A-1/A-2，纯引用计数勘误，随 SA2 评审修订一并更正即可，
不动任何决策语义）** 与 **3 条范围注记（N-1–N-3，follow-up 边界登记，无需本票动作）**。

一句话理由：设计是 ADR 0015「提议」条款（模块装配 L18–32、受信环境与角色 L38–43、HTTP 契约
L49–90、执行顺序与 Lease L148–161、Observability L186、测试 seam L194）逐条的**兑现型具体化**，
全部可观察行为（路由大小写/无尾随斜杠、405 + `Allow: POST` 先于 role gate、Peer 403 +
`INSTANCE_ROLE_FORBIDDEN` 先于 owner 解析/body 读取、201 恰两键/三键无 `Location`、DTO 复制先于
恰一次 release、release 失败仍 201、replication-disabled 零新增行为）都逐字落在冻结条款内；
延后面（错误映射、limits 执行、observer 事件、signal）以 fail-loud rejection / 参数位保留的
方式**不实现而非错实现**，未发明任何未评审的 HTTP 语义；上游公共面（Registry/Lease/VFSL/
Persistence/Instance）只读消费零修改。

## B-1/B-2/B-3 边界条件闭合核验（前置门禁移交义务）

| 义务 | 设计落实（章节） | 复核结论 |
|---|---|---|
| **B-1 role 单真相**：注入 router 的 role 值必须同源自 composition root 的 Instance identity，不得成为第二份独立 role 配置（ADR 0012；CONTEXT.md「实例角色」Avoid） | §7 D8、§8.1、§11（AGENTS.md + JSDoc 钉住「值必须由 composition root 从 Instance service 读取后注入，禁止环境变量/第二份配置」）；类型层只认 `InstanceRole` 联合，自 `@nomicore/namespace-registry` 公共 re-export 导入（实证：`packages/namespace-registry/src/index.ts` L40 在类型导出白名单内，与 `packages/instance/src/index.ts` L4 同一联合）；包内零 role 默认值、零独立配置源 | ✓ **设计层闭合**。类型取自 re-export 是同一联合的结构性投影，不构成第二真相源——B-1 约束的是**值的生产来源**，设计已以类型 + 文档钉死并登记 FR-5（server 装配票）落地消费者侧接线；本票无 composition root 消费者（实证：`git grep namespace-api` 于受控源/配置零命中），无违约面。复审面 S4 裁决 no-conflict |
| **B-2 observer 构造面**：ADR 0015 L186「构造时必须显式注入两个同步 void observer；传 no-op 也必须是显式决定」；延后范围限定为**事件发射契约** | §7 D2/D7、§8.3：`metricsObserver` / `diagnosticObserver` 必选、缺失/非函数 → 普通 `TypeError`；零参 `() => void` 签名（后续事件化收窄不破坏少参调用方）；本票零事件发射；release 失败的业务不变量（仍 201、恰一次）保持，仅丢失 best-effort 诊断信号（FR-4 登记） | ✓ **闭合**。构造面与 L186 逐字一致；事件延后口径与 ADR 0011「emit 不改变业务结局」的观测定位相容，不构成静默 fallback。SA6 冻结契约已按同口径断言（缺任一 observer → `TypeError`），实测在案。复审面 S5 裁决 implements-existing-decision |
| **B-3 固定顺序不被骨架 reorder**：role gate 先于 owner 解析/body 读取；DTO 复制先于 release；method gate 先于 role gate | §8.2（path → method 405 → role 403 → owner 捕获 → body 读取）、§8.4（派生 → envelope → create → DTO 复制 → 恰一次 release → settle 后构造 201）、§6 逐行登记 | ✓ **闭合**。顺序逐字落 ADR 0015 step 1→2→（3–5 无分支）→4→6→7→8→9→10：Hub 侧延后的 step 3–5 在骨架中不产生任何 Response（无从反序）；Peer 侧 role gate 前零 owner 解码、零 body 成员调用、零 Registry 触达（poison registry / trapped body 契约在案）；Response 构造点在 `await release()` settle 之后。复审面 S6/S2/S3 裁决 implements-existing-decision |

## 复审面逐项裁决

### S1 包/公共 seam/manifest —— implements-existing-decision

| 设计动作 | 基线条款 | 复核 |
|---|---|---|
| 新建 `@nomicore/namespace-api`，exports `.` + `./rest` 三条件（`nomicore-source`/`types`/`import`） | ADR 0015 L18「REST Adapter 由 `@nomicore/namespace-api/rest` 暴露。首版只公开 REST router」 | ✓ manifest 镜像 `packages/namespace-registry/package.json` 既有惯例（实测逐字段同款：三条件 exports、scripts、devDeps 版本、打包字段）；接线锚断言 `exports['./rest']['nomicore-source']` → 存在的 `src/rest.ts`，设计 manifest 满足 |
| `src/create-namespace.ts` 编排私有，不进 exports 白名单，仅 `rest.ts` 相对导入 | ADR 0015 L18「create 编排保持包内私有」 | ✓ 由打包面结构性保证（subpath 白名单外的模块对包外消费者不可达），比注释更强的落实 |
| `RestHandledResult = {matched:false} \| {matched:true; response}` | ADR 0015 L32「以判别结果表达 route 是否匹配。server 先按 raw path 选择 route family」 | ✓ 判别结果语义与 SA6 冻结契约 H2 一致；`{matched:false}` 交还 server 正是 route family 选择配套 |
| `src/index.ts` 只 re-export `./rest.js` 公共面；不建 `./testing` 子路径 | 包惯例（13 既有包 `.` + `./testing` 款） | ✓ 本票无 testing 入口需求（契约测试用 Registry/Persistence 既有 testing 面），不预建空 seam |

### S2 Peer role gate + 405/路由语义 —— implements-existing-decision

| 设计动作 | 基线条款 | 复核 |
|---|---|---|
| Peer 匹配 method/raw path 后、解析 owner/读 body 前返回 403 + `INSTANCE_ROLE_FORBIDDEN`（逐字常量） | ADR 0015 L38–41；code 全决策集唯一出现点（实证：`grep -r docs/` 仅 ADR 0015 一处） | ✓ 逐字一致；契约测试 poison registry + trapped body + 无 body + `text/plain` + percent-encoded owner 五路证明 gate 前零触达 |
| 已知 path 非 POST（含 HEAD/OPTIONS）→ 405 + `allow:'POST'` 恰值，**先于 role gate** | ADR 0015 L68「已知 path 的非 POST 方法返回 405，并携带 `Allow: POST`」；L69「CORS/OPTIONS 可由外层截获，否则按方法不匹配处理」；step 1（route+method）先于 step 2（role gate） | ✓ OPTIONS 不特判 = 「按方法不匹配处理」分支的逐字落实；顺序与冻结契约 M10 变异口径一致 |
| 单一冻结匹配器：大小写敏感（无 `i` 旗标）、`$` 锚无尾随斜杠、段数恰 5、空 owner 段 fail closed、owner 段 raw 捕获不 decode、query 不参与匹配 | ADR 0015 L65–68「route 大小写敏感，只接受无尾随斜杠 canonical path」；L66 percent-encoding 拒绝、L67 query 拒绝属 step 3 延后项 | ✓ 路由层只做 L65 的 canonical 形状判定；percent-encoded owner 段在 route 层视为合法段而把**拒绝**留给 step 3 后续票——与冻结契约「Peer 对 percent-encoded owner 仍 403」用例同口径，非路由层越权 |
| `URLPattern` 备选被否决（默认大小写不敏感） | — | ✓ 否决理由直接守住冻结面（大小写敏感是 L65 冻结条款） |

### S3 Hub 成功路径 + Lease 编排 —— implements-existing-decision

| 设计动作 | 基线条款 | 复核 |
|---|---|---|
| `request.json()` 最小读取 → 机械提取（顶层 object、`schemaText` string、`root` 键存在）→ `deriveSchemaIdentity` → 组装四键 envelope → `registry.create({owner:{userId}, schema, root})` | ADR 0015 step 4→5（最小）→6→7（L150–156）；L142「REST 先派生身份、组装完整 SCHEMA envelope，再调用现有 Registry create」；L75「root 的领域合法性由 Registry/VFSL 校验，REST 不预设其具体形状」 | ✓ envelope 恰 `{lang:'vfsl', version:1, id, text}` 四键（CONTEXT.md「信封」L15 四键投影；冻结契约断言 `text` 含原文）；机械提取只查键存在与 string 类型、null root 原样透传由 Registry 窄 issue 拒绝——不预设 root 形状，逐字对齐 L75；输入恰三键（实证 `CreateNamespaceInput` types.ts L252–256、`NamespaceOwner` L134–136）；`owner` 不触 META（CONTEXT.md「createdAt」：REST 只传 schema + root） |
| DTO 复制（string 值 + frozen 两键/三键 DTO）→ `await lease.release()` 恰一次（try/catch 吞失败、绝不重试/二次调用）→ settle 后从 DTO 构造 201（不设 `location`） | ADR 0015 step 8–10（L157–159）+ L161「release 失败不改变已知创建事实：仍返回 201……不重复调用 release」+ L90「v1 成功 response 恰含这些字段……不返回 `Location`」 | ✓ 201 恰 `{namespaceId, schema{lang,version,id}}`（不从含 `text` 的 envelope 展开）；release 恰一次由调用纪律保证（不依赖 Lease 幂等，与 ADR 0009「重复 release 同一 Promise」相容的更严使用纪律）；诊断上报延后（见 S7）而业务不变量完整 |
| `sc1-` 只消费不重算 | ADR 0015 L127–133 格式冻结；#266 交付 `deriveSchemaIdentity`（实证 vfsl/src/index.ts L225–272，`{ok:true; semanticFingerprint; schemaId} \| {ok:false; issues}`） | ✓ 零重算、零格式耦合 |
| `replication-disabled` 默认 = 零新增行为 | ADR 0010 L120（复制身份仅 Hub 显式管理操作安装）+ #134 修订节 O-7（未安装 → `{state:'disabled'}`、open → `REPLICATION_NOT_ENABLED`）；ADR 0015 L43 | ✓ REST 恒三键输入无 META 通道，Registry 既有机制自然导出；201 不声明复制状态（L90） |
| 无状态 router、无内部串行化；并发 create 各自成 namespace | ADR 0015 L208「并发请求不在 router 全局串行」；L180「普通 REST create 不应返回 `NAMESPACE_ALREADY_EXISTS`」 | ✓ registry 内部 CSPRNG 碰撞重试（至多 8 次）是 Registry 契约，REST 不感知 |

### S4 role 单真相（B-1）—— no-conflict

见上表 B-1 行。补充裁决依据：ADR 0012 的强制域是「Registry plugin 不再接受独立 role，必须注入
Instance service」（L14）；REST router 非 Cordis plugin（ADR 0015 L20 明文），其「构造注入静态
role」是 ADR 0015 L24 的后来明文设计——两 ADR 的相容条件即 B-1 的值来源纪律。设计以类型
（`InstanceRole` 联合，无本地字面量联合）+ AGENTS.md/JSDoc 文档义务钉住，包内无任何
role 默认值或第二配置读取点；消费者侧接线归 FR-5（server composition root 票，届时按流程
另行门禁）。无冲突。

### S5 observer 构造面（B-2）—— implements-existing-decision

见上表 B-2 行。构造签名 `metricsObserver: () => void` / `diagnosticObserver: () => void`
必选 + `TypeError` 与 ADR 0015 L186 逐字一致；零参签名是「同步 void」的合法具体化，其
「后续事件化收窄不破坏既有调用方」的演进论证类型学成立（少参函数可赋给多参签名）。
ADR L188/L190 的事件内容契约（低基数/三类事件/字段隔离）随 FR-4 落地，本票零发射——
与简报「observer 契约由后续 ticket 叠加」及前置门禁 B-2 划定的延后边界（事件发射契约）
一致。冻结契约按同口径不断言事件。无越权冻结、无静默降级。

### S6 固定顺序（B-3）—— implements-existing-decision

见上表 B-3 行。补充：D5 的「机械提取前置失败抛内部 Error」不是 step 5 的 400 Response 策略
（那属延后的形状校验票），而是拒绝在缺输入时编造成功的 fail-loud 防线——其失败面以 rejection
结算，**不产生任何 HTTP 可观察顺序**，因此不可能与 step 3–5 的既定顺序相反；这也是骨架对
「不 reorder」义务的最强满足方式（未实现的分支无从反序）。

### S7 延后切片边界（D5 fail-loud / limits 参数位 / signal / 错误映射）—— no-conflict

| 延后面 | 设计行为 | 基线核对 | 复核 |
|---|---|---|---|
| Registry `ok:false` 窄 issue / fatal reject / body·JSON 异常 / 派生 `ok:false` / 顶层形状不合规 | 一律 `handle` rejection（携带 cause），不发明 4xx/5xx | ADR 0015 §错误契约（L163–182）定义终局映射（422/503/500 族）；简报明文「Registry 失败映射……由后续 ticket 叠加」 | ✓ **不实现而非错实现**：不映射 = 未冻结任何未评审 code/形状；后续以 Response 替换 rejection 是纯加法（B-3 无反序面）。R1 风险已登记 + AGENTS.md 明示「骨架仅成功路径」。503 `REGISTRY_NOT_ACCEPTING`、500 族同样延后，无选择性提前实施造成的口径分裂 |
| `limits` 参数位保留、本票不校验不执行 | D2 表 + D7 | ADR 0015 L28「可选资源 limits」为第 5 项构造注入；L113 的 limits 校验/413/signal 属 §JSON 处理与资源限制域（简报明文延后） | ✓ 参数位保留避免后续票改公共构造签名（与 B-2 同款逻辑）；**边界注记 N-1**：L113「未知键和越界值在构造时 TypeError」义务随 FR-1 落地，届时须复审 |
| `Request.signal` 不接；Registry 接纳后取消不传播 | §9.7 | ADR 0015 L113 前半（body 读取阶段尊重 signal）属 limits 票；后半「调用 Registry 后不传播客户端取消，必须等待 create settle 并 release Lease」 | ✓ 后半句逐字落实（无条件 await create + release）；前半句延后与简报切片一致 |
| 405 body `code:'METHOD_NOT_ALLOWED'` 标注临时值 | D4 表 | ADR 0015 只冻结 405 状态 + `Allow` 头（L68）；错误 body problem shape 属延后错误契约（L165） | ✓ 非冻结面；向 body 增键是加法演进（「恰含」只冻结 201 成功面，L90 原文域）；FR-3 定稿。范围注记 N-3 |

### S8 工程接线与流程项 —— no-conflict

| 事项 | 设计处理 | 复核 |
|---|---|---|
| 根 `package.json` typecheck 链 +1 项 + `pnpm-lock.yaml` 再生成 | §7 D1 接线配套 + ALLOW LIST 两行 + R3 风险 | ✓ 实证：CI 五处 `--frozen-lockfile`（ci.yml L36/72/101/144/166）+ `pnpm typecheck`（L39）——漏配则 CI 安装/类型门即断；设计把两处列入 ALLOW LIST 与验证命令，属必要工程闭环，非决策冲突 |
| Typed Namespace writes 强制条款 | §9.6 不适用（router 不持 lease 写数据，`root` 经 `Registry.create` 整体提交） | ✓ 与前置门禁行 12 裁决一致：条款针对应用侧 `mutateData()` 类型化写路径；写者是 Registry 自身管线 |
| ADR 0015 状态翻转（提议→已接受） | DENY LIST 排除 ADR 文件 + FR-2 归 Controller 收官清单 | ✓ 与 `docs/AGENTS.md` Authority（docs/adr/ 记录 accepted 决策）及 #266 先例（B2）一致；实现链不自行翻转 |
| 新包 `AGENTS.md` 随包建立 | ALLOW LIST | ✓ 根 AGENTS.md 模块纪律（改 `packages/` 前最近嵌套 AGENTS.md 定义契约边界） |
| CONTEXT.md / SA6 契约 / 上游包 / vitest.config.ts 全部 DENY | §11 DENY LIST | ✓ 零新域词（owner/namespaceId/信封/内容寻址 schema ID/Hub·Peer/lease 均既有词条，实测在案）；契约测试零回写（H1–H4 仲裁与冻结假设一致，见实证表）；上游公共面只读；alias 既有正则已覆盖 `@nomicore/namespace-api` → `src/index.ts`，契约测试相对导入 `../src/rest.js`，确无需改 `vitest.config.ts` |

## 实证核验（设计 §2/§8 主张逐项对 HEAD `8fa85d2` 独立复核）

| 设计主张 | 独立证据 | 结论 |
|---|---|---|
| `packages/namespace-api/` 仅有 5 个 test 面文件，无 package.json/src/AGENTS.md | `ls` + `git status`（untracked） | ✓ |
| 红灯基线 `3 failed \| 1 passed`、`Type Errors: no errors` | 本轮复跑 `NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run packages/namespace-api/test`：**`Test Files 3 failed \| 1 passed (4)`、`Type Errors no errors`**，红灯两源 = `Cannot find module '../src/rest.js'`（2 行为 suite）+ `package.json 不存在`（接线锚） | ✓ 逐位复现 |
| `deriveSchemaIdentity` 同步纯窄接口，`{ok:true; semanticFingerprint; schemaId} \| {ok:false; issues}` | `packages/vfsl/src/index.ts` L225–272（L240–242 结果联合逐字） | ✓ |
| `CreateNamespaceInput` 恰三键无 namespaceId；issue 联合含 `NAMESPACE_SCHEMA_INVALID` 等且均有 `code`；fatal 以 branded `NamespaceRegistryFatalError` reject；构造期 TypeError 门禁 | `packages/namespace-registry/src/types.ts` L252–256、L275–310、L307/L675 注释、`NamespaceRegistry.create` L691 | ✓（D5 示例 code 真实存在） |
| `NamespaceLease.namespaceId: string` / `release(): Promise<void>` / 幂等 exact same Promise | types.ts L628–661 | ✓ |
| `InstanceRole = 'hub' \| 'peer'`；registry 公共 re-export | `packages/instance/src/index.ts` L4；`packages/namespace-registry/src/index.ts` L40 | ✓ |
| `NamespaceOwner = {userId: string}` | types.ts L134–136 | ✓（§8.4 `owner: {userId}` 形状正确） |
| 契约 H1–H4 与设计 D1–D4 一致、零测试回写 | 冻结测试实读：`createRestRouter({role, registry, metricsObserver, diagnosticObserver, limits?})`（H1）、`handle → {matched:false}\|{matched:true;response}`（H2）、`../src/rest.js` 相对导入（H3）、201 schema identity 取派生 envelope（H4，hub test L24 注释） | ✓ 设计公共面与冻结契约逐字段同形 |
| 35 用例 = 17（hub 8×2+1）+ 12（role）+ 5（support）+ 1（wiring） | 逐 suite 实数（见 A-2 勘误的仅设计引用计数） | ✓ 总数 35 与 SA6 §0 一致 |
| envelope 四键含原文 `text` 传入 create | hub 契约 L131 `schema: {lang:'vfsl', version:1, id, text: SCHEMA_TEXT}` | ✓ |
| `INSTANCE_ROLE_FORBIDDEN` 全决策集唯一定义点 | `grep -rn docs/` → 仅 ADR 0015（1 处） | ✓ |
| manifest/tsconfig 惯例镜像 | `packages/namespace-registry/package.json`（三条件 exports/scripts/devDeps 同款）、`tsconfig.json`（extends base + include src/**） | ✓ |
| CI 需 lockfile 再生成 + typecheck 链 +1 | ci.yml 五处 `--frozen-lockfile`；根 package.json typecheck 逐包链 | ✓ |
| 无既有 ts 源引用 `namespace-api`（无调用方破坏面） | `git grep -l namespace-api` → 仅 docs/adr/0015 + wiki/raw | ✓ |
| harness 只走公共/testing 面 | `rest-contract-harness.ts` imports：`@nomicore/persistence`(+`/testing`)、`@nomicore/namespace-registry`(+`/testing`)，无内部路径 | ✓（ADR 0015 L194「不读取内部 entry map/Runtime/Y.Doc」） |
| Blocked-by #266 已合入 | HEAD `8fa85d2` = `fix(#266) … (#276)` | ✓ |

## Advisory 精度项（不阻塞；随 SA2 评审修订更正，不动决策语义）

- **A-1（计数口径勘误）**：设计 §2 锚点 8 称根 typecheck「逐一列出 13 个 tsconfig」——实际链为
  **14 项**（13 个 `packages/*` + `apps/yjs-server`）；§11 ALLOW LIST 称「12 包惯例」——实际
  `packages/` 下 **13 个既有包**（「12」沿自前置门禁 §8-4 同款措辞）。两处操作性结论（逐包
  列出、每包建 AGENTS.md）均真，仅数字引用不精；建议 SA2 修订轮更正为「13 包 + 1 app」/「13 包」。
- **A-2（用例引用计数勘误）**：设计 §8.5/§12 把 12 用例的 role suite 引作「前 7 + 后 6」——实际
  结构为 **7（role gate 顺序）+ 3（route/method）+ 2（构造门）= 12**，即「后 5」；SA6 §0 自记
  12 正确，总数 35 不受影响。纯引用勘误。

## 范围注记（follow-up 边界登记，本票无需动作）

- **N-1**：`limits` 构造校验义务（ADR 0015 L113「未知键和越界值在构造时 TypeError」+
  `maxSchemaTextBytes ≤ maxBodyBytes`）随 FR-1 落地；在彼之前参数位不校验是设计明示的切片边界，
  非违约。FR-1 落地设计应再经门禁核对校验语义与 L103–115 逐字对齐。
- **N-2**：B-1 消费者侧闭环（role 值实际取自 Instance service 的装配代码）随 FR-5 server
  composition root 票落地；该票作为新任务派发时按流程另行前置门禁，届时以本报告 B-1 行为核对基线。
- **N-3**：405 body `code:'METHOD_NOT_ALLOWED'` 为临时值（D4 已标注），FR-3 错误契约票定稿；
  冻结面仅 405 状态 + `Allow: POST`（L68），契约测试未断言该 code，改名无破坏面。

## requiresConflictRecheck

**false** —— 前提：SA2 评审修订若仅落入 A-1/A-2 文字勘误或本报告已裁定的设计边界内微调，属
纯文档/实现细节变更，无需再开 SA8 冲突门禁。

**重开条件**（任一命中即须新门禁）：

1. 冻结面任何变化：201 成功形状（键集/`Location`）、`INSTANCE_ROLE_FORBIDDEN`、405 +
   `Allow: POST`、路由匹配语义（大小写/尾随斜杠/段数）、`sc1-` 消费方式、Registry/Lease
   公共面任何扩展或修改；
2. 本票提前实现任何延后的 HTTP 错误映射（4xx/5xx problem shape、500 族 code）或 observer 事件
   发射 / limits 执行——将冻结未经评审的语义；
3. role 值来源偏离 Instance identity 单真相（如从环境变量/独立配置读取）；
4. 文件范围越过 §11 ALLOW/DENY 边界：触碰 `packages/namespace-api/test/*`、上游 13 包、
   `CONTEXT.md`（域词增改）、`docs/adr/*`（含 ADR 0015 状态自行翻转）、`vitest.config.ts`；
5. 对「提议」状态 ADR 0015 条款的解释性偏离（如「判别结果」形状、`./rest` 布局、observer 签名
   的既裁解释被推翻重设计）。

---

非阻断登记（延续迭代 0，本轮未复审、不构成冲突基准）：worktree git 配置残留与历史对象库局部
缺损两项仓库级观察维持原登记；发布/base 推导属 runner 职责。

审查日期：2026-09-11（dispatch `sa-e18ba1d8-4d28-4c0a-96d3-8d1015b41056`，iteration 1，
设计后复审，SA2 评审前）。
