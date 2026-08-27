# 冲突门禁报告 — issue #133 Phase 5: bootstrap import, archive, and guarded replica reset（Phase 0 前置门禁）

verdict: clear

- 被审对象：`wiki/raw/task_phase5-bootstrap-archive-reset.md`（下称「简报」）
- 冲突基准：`docs/adr/` 全集 10 份（逐个全读）+ `CONTEXT.md`
- 工作区：`/home/wangjian/nomicore-fix-issue-133`（HEAD=ebc5419，git log 实证含 7425164=#131、ebc5419=#132(PR #145)、30cf1aa=#135(PR #144)）
- 裁决词汇：no-conflict / override-declared / evolution / hard-violation（四级）
- 事实核验范围：简报「现有资产盘点」逐条对照 `packages/persistence`、`packages/namespace-registry`、`packages/namespace-runtime`、`packages/replication-protocol` 源码（代码仅作事实核对，不构成冲突基准）

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 单一真相源 | accepted（含 2026-08-19/08-21 修订节） | 否 | 本票不触碰 schema 文本/投影，无交集 |
| ADR-0002 | 重写定位、authority 出范围 | accepted | 否 | 无交集 |
| ADR-0003 | 求值器与派生 schema | accepted | 否 | 无交集 |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 否 | 无交集 |
| ADR-0005 | 投影生成管线 | accepted | 否 | 无交集 |
| ADR-0006 | Server Persistence docstore | accepted（含 issue #64/#79 修订节、#131 对齐说明） | 是 | no-conflict（见 §逐文档核对） |
| ADR-0007 | 逻辑校验与 Yjs runtime bridge | accepted（Runtime/open/read 条款被 0008 部分取代） | 间接 | no-conflict；本票不做 raw apply，0007 zero-write 管线不受触碰 |
| ADR-0008 | NamespaceRuntime 读写能力与 sequencer | accepted（含 2026-08-24 稳定码注册修订、issue #132 修订节） | 是 | no-conflict |
| ADR-0009 | NamespaceRegistry、Lease 与 Host 生命周期 | accepted（identity 节被 ADR 0010 修订；含 issue #131 修订节） | 是 | no-conflict |
| ADR-0010 | Hub/Peer WebSocket Y.Doc 复制 | accepted | 是（核心） | no-conflict |

## 逐文档核对

### 1. ADR 0006（docs/adr/0006-server-persistence-docstore.md）

**兼容点**

- AC-2 排他创建与「绝不覆盖已提交内容」逐字兼容：ADR 0006 issue #64 修订节第 1 条「对 `(owner.userId, docId)` 排他创建……在 duplicate 判定路径上绝不覆盖已提交内容——cache 命中即拒、store 存在性读见快照即拒、并发 claim 即拒」（0006:119-123）。简报 AC-2「Bootstrap creation is exclusive and never overwrites or silently merges an existing local document」（简报:22）不超出也不削减。
- AC-5 File 归档原子 rename 与既有 flush 提交纪律同构：ADR 0006「写入 `{namespaceId}.snapshot.tmp` 后以原子 rename 覆盖」（0006:52）；phase 切片 2「同 rootDir 内受控 archive 路径和原子 rename」（phase:64）被 AC-5（简报:25）原样承接。
- owner 分区/单 rootDir/全量 snapshot/saveDoc=dirty notification 四不变量：简报:49 明文引为设计基准并声明「archive 不得破坏这些不变量」，与 ADR 0010:218「不改变`saveDoc`仅为dirty notification、全量snapshot、owner目录分区或单rootDir owner语义」一致。
- AC-6「independent owner partitions」与 ADR 0006 #131 对齐说明「不同 owner 下相同 docId 属于不同持久化 entry 的既有语义」（0006:205）一致。
- 导入 seam 的 `META.docId === docId` 校验链完整：bootstrap 保留 Hub namespaceId（AC-1），导入文档的 `META.docId` 即 Hub namespaceId，满足 0006:50「`META.docId` 必须等于请求的 namespaceId」；0006:132「持久层仍仅校验 `META.docId === docId`，不校验 VFSL/ROOT/createdAt」不被简报扩张。
- AC-6「crash/error committed facts」与 create fatal phase 词表（probe-read/snapshot-encode/store-write/post-commit，0006 未列而由契约冻结于 `packages/persistence/src/contract.ts:116-131` `DOC_CREATE_FATAL_PHASE_COMMITTED`）同族，简报:56 盘点准确。

**冲突点**：无。

**简报遗漏的冻结约束**：无实质遗漏。双 Adapter 平行验收纪律（0006:157-159「两 Adapter 必须通过同一组 createDoc shared contract tests」）由 AC-3「behavior-equivalent」+ phase 切片 2「行为等价、可测试」共同覆盖。

### 2. ADR 0008（docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md）

**兼容点**

- 本票不改写sequencer 纪律：简报:50 引「单 NamespaceRuntime、唯一 write sequencer、lifecycle gate、committed/fatal 事实诚实」为准；ADR 0008:36「同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer」在本票新增的 Registry 编排（close→archive→bootstrap）中不被绕开——归档前置条件「无有效 handle/Runtime generation」（phase:63）正是先关 Runtime 释放 handle 的结果。
- 与 #132 冻结行为无冲突：简报:35 对 `readReplicationFacts` 事实读取单点、`enableReplication()`/`bumpReplicationEpoch()` 经唯一 write sequencer 的描述，与 ADR 0008 issue #132 修订节第 4 条「四者均进入同一严格 FIFO write sequencer，完整槽序……不变」（0008:134）及代码（`packages/namespace-runtime/src/replication-write.ts:6-21` E1–E7 槽序）逐字一致。
- 两态语义不被削减：简报:58「disabled/enabled 两态 + ReplicationMetaCorruptError 损坏判据」= ADR 0008 #132 修订节第 2 条（0008:132）双键真缺席→disabled / 双键合规→enabled / 其余一律持久化损坏拒绝。bootstrap 导入的文档因 AC-1 前置身份核对，进入构造期窄例外时必为 enabled 态，不产生「伪装 disabled」路径。
- 构造期窄例外闭合边界（0008:131「仅允许 Runtime 在构造、对外发布前同步读取两个保留字段」）不被本票扩张：核对发生在 Persistence ownership 转移之前（AC-1），属于 Registry/Persistence 侧动作，不新增 Runtime 读取面。

**冲突点**：无。

**简报遗漏的冻结约束**：无实质遗漏（导入后 Runtime 走同一构造路径由 ADR 0010 §Bootstrap 步骤 4 蕴含，见 N-9）。

### 3. ADR 0009（docs/adr/0009-namespace-registry-leases-and-host-lifecycle.md）

**兼容点**

- 简报:51 正确陈述其 identity 节已被 ADR 0010 修订（0009 修订节 1：entry key 仅 namespaceId、owner 必需、mismatch→`NAMESPACE_NOT_FOUND`，0009:138），未把已作废的复合 key 条款当作约束。
- Registry 归属正确：reset/archive 编排归 Registry——ADR 0010:222「Registry仍负责本地Runtime generation、Lease、reset/archive编排和Host生命周期」；简报 AC-4「Registry resetReplica」（简报:24）与 AC→组件映射（简报:72）归属一致。
- Lease/idle/shutdown/generation 语义不被触碰：简报边界提示（简报:60-66）未要求 per-key admin close、公共 entry status 或 list——与 ADR 0009:114「v1不公开list、entry status、lease count、queue、timer handle、explicit eviction、按key close或公共events」相容（resetReplica 是 ADR 0010 授权的新编排入口，不是按 key close 的通用管理面，见 N-3）。
- entry generation 永不复用 + removeOnlySelf 双守卫（简报:57 盘点）与 reset 的「rejects owner/identity races without partial deletion」（AC-4）同向：旧异步操作只能按 entry identity/generation 清理自己（0009:32），归档守卫同样以身份前置条件拒绝竞态，不产生半删除。

**冲突点**：无。

**简报遗漏的冻结约束**：无实质遗漏。`NamespaceRegistryFatalError` operation/phase 词表扩展属授权演进（见 N-3）。

### 4. ADR 0010（docs/adr/0010-hub-peer-websocket-ydoc-replication.md）

**兼容点**

- AC-1 逐字兼容 §Namespace identity + §Bootstrap 步骤 3：「复制 bootstrap 使用内部受信任导入保留 Hub namespaceId，不是普通 create」（0010:28）、「peer 在 detached Y.Doc 应用基线、严格核对 META 身份，再通过 Persistence 的受控复制导入能力排他创建」（0010:65）。简报 AC-1「preserves the Hub namespaceId, applies a full update to a detached Y.Doc, and verifies META replication identity before persistence ownership transfers」（简报:21）三要素齐备、顺序一致（核对先于排他创建=ownership 转移；ADR 0006:126「成功签发有效 lease……持久层接管该 doc 生命周期」定义了转移点）。
- AC-2 兼容「peer 不得普通 create 一个准备从 hub 复制的同 key namespace；首次 bootstrap 继承 hub 的完整 META 身份」（0010:54）：导入 seam 以「detached、已核对身份的完整 Y.Doc」（phase:62）为输入，完整继承含 `META.replicationId/replicationEpoch` 在内的全部 META；不与 #131 冻结的 owner-only create 接纳冲突（普通 create 仍不接受调用方 namespaceId——简报:35 上游状态准确，代码 `packages/namespace-registry/src/identity.ts:22-24` 注释印证「create 接纳改 owner-only」）。
- AC-3/AC-4 逐字兼容 §复制谱系与 epoch 的 resetReplica 段：「Registry 先关闭本地 Runtime generation，再通过 Persistence 归档旧副本，最后允许重新 bootstrap。Persistence 为此增加受身份前置条件保护的归档 seam；WS 层不得直接读写 snapshot 文件」（0010:57）。简报 AC-4 的 close→archive→bootstrap eligibility 串行化与 owner/identity race 拒绝即该段操作化；「without partial deletion」是身份前置守卫的保守推论（守卫拒绝 ⇒ 未删），非语义超出。
- AC-5 兼容 WS 禁令：「WS 层不得直接读写 snapshot 文件」（0010:57）与 phase 切片 2「不得由 WS 插件直接操作文件」（phase:65）；简报:66 对 AC-5 后半句的解释（文件访问封闭在 Persistence 包内，WS 后续切片只能经 seam 间接操作）是对禁令的正确读法，未削弱。
- §取代与关联的 Persistence 能力边界逐字在场：「它为Persistence增加复制导入与归档所需的受控能力；namespaceId的概率全局唯一由生成策略负责，Persistence不增加跨owner catalog或原子唯一约束」（0010:218）→ 简报:43 引用 + 简报:65「不新增 Persistence 跨 owner catalog 或原子唯一约束；owner 分区语义不变」。
- §Bootstrap 第 5 步（reconciliation 补齐竞态窗口，0010:67）被简报:42 明示为后续切片、本票只交付本地生命周期——与 issue #133 What to build「complete local lifecycle」和切片划分一致，不构成削减。
- §Persistence degraded 语义（0010:123-139）不在本票范围（简报:64 正确排除 degraded bypass 复制写）。

**冲突点**：无。

**简报遗漏的冻结约束**：无。核对要点列出的四项硬约束——①bootstrap 保留 Hub namespaceId 不是普通 create（简报:40/70）；②archiveDoc 身份前置条件（简报:41/45/71）；③WS 层不得直接读写 snapshot 文件（简报:41/45/66/73）；④Persistence 不增加跨 owner catalog（简报:43/65）——全部在简报中显式在场。

### 5. docs/phases/phase-5-websocket-replication.md

**兼容点**

- 切片 2 四条 bullet 逐一映射：受控导入 seam（phase:62）→ AC-1/AC-2 + AC→组件映射（简报:70）；`archiveDoc(owner, docId, expectedReplicationIdentity)` 仅在无有效 handle/Runtime generation 时执行（phase:63）→ AC-3 + AC-6「active handle rejection」；File 同 rootDir 受控 archive 路径 + 原子 rename、Memory 行为等价（phase:64）→ AC-3/AC-5；稳定分类（duplicate、identity mismatch、operational failure、committed-aware fatal）+ WS 不直接操作文件（phase:65）→ AC-5/AC-6 + 简报:66「稳定错误词汇与测试面」。
- 切片 8 首条：「Peer `resetReplica(owner, namespaceId, expectedLocalIdentity)` 编排 close→archive→允许 bootstrap」（phase:113）→ AC-4 原样承接（简报:24、72）。
- 场景 15b（phase:173「replication identity conflict 与 `resetReplica` archive 流程」）本票交付其本地部分（简报:47）——15b 标注「后续切片 3–8」，本地 archive/reset 部分恰属本票，wire 侧稳定冲突留切片 6，划分诚实。
- 测试 seam（phase:183「FilePersistence 做进程重启、归档和恢复验收」）→ AC-6「archive recovery」（简报:26、48 引用一致）。
- 非目标（phase:190-202）无一被触碰：无自动覆盖 identity/epoch 冲突（AC-2「never silently merges」同向）、无 WS transport、无 namespace list/discovery、无第二种 transport。
- 边界提示的切片归位基本准确：ReplicationSession=切片 3、trusted apply/角色权限=切片 4、wire 状态机=切片 6、认证授权=切片 7、apps/yjs-server=切片 9（简报:62-63）。

**冲突点**：无。

**简报遗漏的冻结约束**：无实质遗漏（切片 8 其余两条 bullet 的排除归位见 N-7）。

### 6. CONTEXT.md

**兼容点**

- 复制谱系（CONTEXT:117-119「由 `META.replicationId` 标识……只有 namespaceId、replicationId 与 replication epoch 全部匹配的副本才允许直接执行 Yjs state-vector reconciliation」）：本票不做 reconciliation，只做身份核对前置与归档守卫，不冲突。
- 复制代际（CONTEXT:121-123「相同复制谱系但 epoch 不同的副本进入冲突状态，必须显式 reset/bootstrap，不自动覆盖或合并」）：AC-2「never overwrites or silently merges」与 resetReplica 编排正是「显式 reset」路径，同向。
- namespaceId（CONTEXT:113-115「Registry 在当前进程内只以 namespaceId 排他索引。Persistence 仍用 owner.userId 分区……不同实例可为同一 namespaceId 使用不同 owner」）：AC-6「independent owner partitions」与简报:65「owner 分区语义不变」一致。
- ReplicationSession（CONTEXT:125-127）：不在本票范围（简报:62），词汇不被误用。
- 简报:52 对词汇行号（117-126 行）的指引覆盖复制谱系+复制代际+ReplicationSession 首行，无实质偏差。

**冲突点**：无。

**简报遗漏的冻结约束**：无。

### 7. 与本分支已交付 #131/#132/#135 冻结行为的核对（简报「上游状态」「现有资产盘点」）

- #131：entry key=namespaceId、owner-only create 接纳、注入式 `RegistryRandomBytes`、`ns-`+32hex 与 8 次重试——代码实证（`registry.ts:145` `MAX_NAMESPACE_ID_RETRIES = 8`、`registry.ts:545-560`、`identity.ts:22-24/56`）；简报:35/57 盘点准确。受信 bootstrap 路径作为内部导入保留 Hub namespaceId（0010:28 授权），不与「普通 create 不接受调用方 namespaceId」冲突——二者是并行的两个入口，简报:40/70 已区分。
- #132：`readReplicationFacts` 两态 + `ReplicationMetaCorruptError`（`replication-write.ts:206-228`）、enable/bump 四写共享唯一 sequencer（`replication-write.ts:6-21`、`lease.ts:14-19/154-167`）、`REPLICATION_ID_PATTERN = /^[0-9a-f]{32}$/` 双守卫副本（`replication-write.ts:59` + `registry.ts:152-153`）——简报:35/58 盘点逐条属实。
- #135：`@nomicore/replication-protocol` 纯 codec 包存在（`packages/replication-protocol/package.json:2`、src/ 十文件）——简报:35 属实。
- Persistence 盘点：`DocPersistence` 受控导出（`index.ts:1-40`）、`PersistenceLifecycle` cell 协调器（`lifecycle.ts` 全文）、错误家族与 phase 词表（`contract.ts:45-151`）、`PersistenceIO` seam（`index.ts:21`、`testing.ts:671-678` wrapIo）、File `mkdir→writeFile tmp→rename` + `SAFE_PATH_SEGMENT` + `users/<userId>/<docId>.snapshot`（`file.ts:48/119-142`）、`seedForTest`（`file.ts:101-103`）——简报:56 盘点逐条属实。
- Registry 盘点：open/create/getStatus/shutdown、LifecycleCarrier FIFO、三相（`registry.ts:210-231`）、removeOnlySelf 双守卫（`registry.ts:291-300`）、testing 注入面（`testing.ts:28-31`）、`NamespaceRegistryFatalError(operation, phase, committed, cause)`（`errors.ts:21-25`）——简报:57 盘点逐条属实。
- `archiveDoc`/`resetReplica` 在 src/test/docs 全仓零命中（grep 实证）——与简报将其列为本票待建目标一致，无「已交付行为被改写」风险。

## 冲突点

无。

（verdict: clear。未发现 no-conflict 之外的任何裁决项：简报无 hard-violation，无需 override 声明，亦无需提请 Jim 裁决的 evolution 项——简报的全部要求都能在 ADR 0010 §Namespace identity/§复制谱系与 epoch/§Bootstrap 与重连/§取代与关联、phase-5 切片 2/8、ADR 0006 排他创建与原子提交纪律、ADR 0008 #132 修订节、ADR 0009 #131 修订节的既有授权内落位。）

## 非阻断观察项（供 SA1 设计时注意，不阻塞开工）

- **N-1（两个身份参数的关系未定义）**：phase 切片 8 用 `expectedLocalIdentity`（resetReplica，phase:113；ADR 0010:57 同词），切片 2 用 `expectedReplicationIdentity`（archiveDoc，phase:63）。权威文档未定义二者形状与推导关系（Registry 是否在 close 前读取本地复制事实、再将其作为 Persistence 归档守卫值传递；若 close 后 Runtime 已不可读，事实取自何处——持久快照重读还是调用方声明）。简报 AC-4 同时使用「identity races」而 AC→组件映射（简报:71-72）保留了两个参数名，未混同，是正确的；SA1 需给出显式映射与核对时点，且判据应复用 `readReplicationFacts` 单点（`replication-write.ts:213`），不得另立第二套判据。
- **N-2（「允许重新 bootstrap / bootstrap eligibility」的机制未定义）**：ADR 0010:57 只冻结顺序「最后允许重新 bootstrap」。reset 后 entry 去留（旧 generation 清理？idle 语义是否被显式终止？是否需要显式 eligibility 标记，还是「本地副本已归档 + Runtime 已关」即天然可 bootstrap）权威文档未定。SA1 不得引入 wire 可见或公共面可见的新状态枚举（ADR 0009:114 v1 公共面纪律），建议以「归档完成 + entry 清理」作为资格判据的最小实现。
- **N-3（稳定词表与公共面扩展的授权链）**：`NamespaceRegistryFatalError.operation` 当前为 `'open' | 'create' | 'shutdown'`（`errors.ts:23`）；resetReplica/受信 bootstrap 将新增 operation/phase 值。授权链是 ADR 0010:222（Registry 负责 reset/archive 编排）对 ADR 0009:107-114 v1 公共面枚举的扩展，类比 ADR 0009 #131 修订节 2 增补 `namespace-id-generation` phase 的先例——扩展须 append-only 且在 SA1 设计中明示授权出处；Persistence 侧 archive/import 的新稳定分类同理（phase:65 要求 duplicate/identity mismatch/operational/committed-aware fatal 四类稳定分类）。
- **N-4（受信 bootstrap 路径的暴露面）**：ADR 0010:28 称「内部受信任导入」。它是 Registry 公共方法、internal subpath（类比 `createNamespaceRuntimeForRegistry`，ADR 0009:18）还是 testing 注入面，权威未定。设计上必须防止普通调用方借该入口指定任意 namespaceId 绕过 #131 的 owner-only create 接纳与 CSPRNG 生成纪律——「受信任」的边界（仅 Host/复制插件装配方可达）应由 seam 位置而非运行时参数表达。
- **N-5（persistence-degraded entry 与 reset/archive 的交互未定义）**：ADR 0006/0010 未规定 entry 处于 `persistence-degraded` 时 `resetReplica`/`archiveDoc` 的行为（归档读快照是否受 degraded 影响、degraded 下归档失败应分类为 operational failure 还是 fatal）。简报:49 只说「archive 不得破坏 degraded/retry 语义」。SA1 需裁定并给稳定分类；无论结论如何，不得以 reset 之名绕过 retry 或虚报 committed 事实。
- **N-6（归档路径与启动 `.tmp` 清理规则的协调）**：ADR 0006:52「启动发现遗留 `.tmp` 时一律忽略并删除」目前作用于 snapshot 布局。File 归档的「同 rootDir 内受控 archive 路径 + 原子 rename」（phase:64）若使用 tmp 中间态，需明确启动清理规则的作用域（归档区临时文件不得被误删一半写入态、也不得无限残留）；归档目录命名属 SA1 设计自由，但须维持 `SAFE_PATH_SEGMENT`（`file.ts:48`）同级的安全文法纪律。
- **N-7（切片归位的细小偏差，非冲突）**：简报:62 把排除项统称「（切片 3–7）」，但切片 8 的第 2/3 条（targets 运行时 add/remove、结构化 observer seam，phase:114-116）同样不在本票范围且未被简报点名——它们属 ws-replication 插件域，留待后续票。总控应知悉切片 8 并未随本票整体关闭；SA1 不得顺手实现。同理，场景 15b 的完整闭环（wire 侧 identity/epoch 稳定冲突、不覆盖本地副本）依赖切片 6，本票验收只应覆盖其本地部分。
- **N-8（Memory 归档「行为等价」的验收解释权）**：phase:64 只冻结「行为等价、可测试」。Memory 侧归档的可观察语义（归档后 loadDoc 行为、重复归档、身份守卫拒绝路径与 File 侧一致）需 SA1 操作化，并沿用 ADR 0006:157-159 双 Adapter 平行验收纪律（同一组 shared contract tests），避免「等价」退化为各自表述。
- **N-9（导入后 Runtime 构造路径的复用）**：ADR 0010 §Bootstrap 步骤 4「Registry 打开新 Runtime generation」意味着导入完成后走既有 open 式构造路径（含 ADR 0008 #132 修订节的构造期复制事实窄例外：导入文档必为 enabled 态，若损坏则 `runtime-construction`、committed:false fatal）。简报未展开此步，但 AC-1 前置核对已保证可达前置成立；SA1 设计应明示导入→构造的衔接走单一 Runtime 构造路径（类比 ADR 0009:68 create 后走普通 P0 启动路径的先例），不新增旁路。

## 结论

verdict: clear。放行。

- 冲突点数：0；裁决分布：no-conflict × 全部对照项，hard-violation/override-declared/evolution 均为 0。
- 简报 AC-1..AC-6、「现有资产盘点」、「边界提示」与 ADR 0006/0008/0009/0010（含各修订节）、phase-5 切片 2/8、CONTEXT.md 词汇逐条兼容；对本 slice 已冻结的四项硬约束（受信导入保留 Hub namespaceId、archiveDoc 身份前置、WS 禁触 snapshot 文件、Persistence 无跨 owner catalog）零遗漏；与 #131/#132/#135 已交付冻结行为零冲突（代码事实逐条核验属实）。
- N-1..N-9 为 SA1 设计输入，不构成开工阻断。
