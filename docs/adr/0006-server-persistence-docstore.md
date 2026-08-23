# ADR 0006：Cordis 持久化插件——DocPersistence 接口与 doc 三条目内容布局

日期：2026-08-21
状态：已接受（Phase 2 server 架构讨论，D-B 持久层决策）

## 背景

NomicoreServer 需要持久层。初稿方案（store 只认 opaque Uint8Array 帧、load/append/replaceWithSnapshot）被 owner 否决：把 Y.Doc 降级为字节会让大量优化不可行（同步 diff 服务、Yjs GC、智能快照、缓存管理），且持久层需要用户信息以支持按用户分区存储。

## 决策

**持久层 = Y.Doc 的存储引擎（store + cache 一体）**，看得见 Y.Doc（结构、update 事件、state vector），看不见 schema 语义（VFSL/校验规则属引擎领地）。

```ts
interface User { userId: string }

interface DocHandle {
  readonly user: User;
  readonly docId: string;
  readonly doc: Y.Doc;
  release(): Promise<void>;
}

interface DocPersistence {
  loadDoc(user: User, docId: string): Promise<DocHandle | null>;
  saveDoc(handle: DocHandle): Promise<void>;
}
```

- **共享 doc，独立 handle**：同一 `(user, docId)` 的所有成功 load 共享同一 live Y.Doc 实例（sync 接入、写入管线、REST 的权威实例），但每次 load 返回独立 DocHandle/lease；
- **并发加载合流**：同一 `(userId, docId)` cache miss 时只创建一个内部 loading Promise；所有并发 load await 同一还原过程，成功后各获得独立 handle，但 `handle.doc` 恒为同一 live Y.Doc 实例；
- **引用计数 + 身份校验**：每个 handle 对应一个不可伪造的 lease；release 幂等且仅释放本次使用权。跨 Adapter/HMR reload 的 foreign handle、已释放 handle 的 saveDoc 都响亮拒绝；引用归零仅使缓存项成为可驱逐候选，不立即释放；
- **saveDoc = 脏状态通知，不是同步落盘**：持有有效 handle 的调用方在 Doc 每次发生变更后调用 saveDoc 通知持久层；saveDoc 返回仅表示脏状态已登记，不构成该次写入已落盘的承诺；
- **持久层内部调度**：不设外部 flush/cron 协调器。第一次 dirty 启动 max-dirty 计时器（默认 5s）；每次 saveDoc 重置 debounce 计时器（默认 500ms）；任一到达即发起 flush。持续高频写入最多 5s 必定尝试一次保存，静止写入约 500ms 后保存。默认值可由插件配置覆写；retry 同属持久层内部，以退避策略重试直到成功或插件停止；
- **创建 = 首个 saveDoc**：loadDoc 不存在返回 null，调用方自建 Y.Doc 写入初始内容后以有效 handle 首次 saveDoc 即完成创建（无独立 createDoc）；
- **save 失败按 doc 只读降级，保留内存事务**：已校验并提交的事务立即进入 live Y.Doc 并正常同步；持久化是内部异步行为，失败不向触发该事务的客户端追溯报错、不通用回滚。失败后 namespace 进入 `persistence-degraded`，保留读/查询与已同步状态，拒绝**后续** REST/WS 写入；失败事务保留在同一 live Y.Doc 中，由持久层内部 retry 持久化，retry 成功后才恢复可写；不关闭整个 server。
- **release = 不再使用通知**：调用方在短 scope 的 finally 中调用 handle.release()；持久层在引用归零后可触发/等待 dirty doc 的 flush，且仅在保存成功、缓存/空闲策略满足后才真正释放实例，调用方不直接控制释放时刻；
- **v1 不提供 list**：per-user 枚举用到再补；
- **user 仅作分区键**：本层不鉴权；userId 与 namespaceId 均由 NomicoreServer 分配，作为受控安全路径段使用（不允许特殊字符/路径分隔符）。存储按用户分区，namespaceId 在用户目录内唯一。

### v1 磁盘布局与持久化格式：全量快照原子覆盖（2026-08-21，owner 决策）

```text
{rootDir}/                    # FilePersistence 插件配置
  users/
    {userId}/                 # NomicoreServer 分配的安全目录名
      {namespaceId}.snapshot  # 用户目录内唯一的 namespace 快照
```

`META.docId` 必须等于请求的 namespaceId；不一致视为持久化损坏并响亮失败。`owner` 仍不写入 META（用户归属由目录分区承载）。userId 与 namespaceId 共用安全文法 `^[a-z][a-z0-9-]{0,62}$`：同一标识可直接用于目录、REST path、WS room 与 META，无需额外编码/hash/转义。

持久层内部的 flush 在触发时以 `Y.encodeStateAsUpdate(doc)` 编码**完整 Y.Doc 状态**，写入 `{namespaceId}.snapshot.tmp` 后以原子 rename 覆盖 `{namespaceId}.snapshot`。`loadDoc` 只读取 `.snapshot` 并 `Y.applyUpdate` 还原 Y.Doc；启动发现遗留 `.tmp` 时一律忽略并删除——`.tmp` 可能半写入，只有 `.snapshot` 是提交态。

- 选择简单、可审计、单文件恢复；沿用旧 yjs-server 已验证的 temp+rename 模式；
- **rename 成功即完成一次 flush**：v1 不对每次 flush 做 file/directory fsync，`saveDoc` 本身也不承诺掉电级持久性；
- 数据保障不依赖单机 fsync：需要更强保证时，以副本、异机复制、备份/恢复演练等**冗余机制**提供，另行设计；
- 不引入 WAL、增量水位、帧格式、压缩调度或坏帧截断的实现复杂度；
- **单飞 flush + generation 保序**：每次 saveDoc 递增 dirtyGeneration；同一 doc 同时最多一个 flush。flush 启动时捕获 generation，成功后仅将该 generation 标记为已持久；若 flush 期间有新 saveDoc（dirtyGeneration 更大），doc 保持 dirty 并安排下一轮 flush——旧 snapshot 不得将新状态误标为已保存；
- 代价已知：每次 save 的 CPU/IO 与文档全量大小成正比；规模优化（增量 WAL + 周期快照）留 v2，以不改变 `DocPersistence` Interface 的 Adapter 内部替换实现。

**doc 内容布局（三条目）**：

```
Y.Doc
├── SCHEMA   信封（lang, version, id, text）——遵循哪个 schema
├── META     元信息（Y.Map：docId, createdAt）——我是谁
└── ROOT     数据根——内容本体
```

- `META.docId` = doc 实例身份（寻址键，不随 schema 升级变化）；与信封 `id`（`命名空间@schema版本` 谱系标签）语义不重叠；
- `META.createdAt` 由上层 namespace lifecycle 生成和维护；持久层不生成、不修改、不校验该字段（持久层只校验 META.docId）；
- `owner` 暂不入 META（归属先存于 store 分区路径，避免将来跨用户共享时语义尴尬）；
- META/SCHEMA 作为 ROOT 的兄弟条目，天然在 validateSnapshot/validatePatch 的校验面之外（校验只作用 ROOT 子树）。

## Cordis 插件化修订（2026-08-21，owner 决策）

NomicoreServer 与 DSH 均以 **Cordis** 为宿主内核；持久层先作为宿主无关的 Cordis 插件在 DSH 中开发、调试和验证，之后由 NomicoreServer 加载同一插件实现——不为 server 重写第二份持久化逻辑。

### 核心 seam 与 Adapter

- `DocPersistence` 是 Cordis service Interface；插件通过 Cordis 提供/注入该 service。service 是 Host 长生命周期资源，DocHandle 是请求/命令/WS 连接等短 scope 的 lease；
- `MemoryPersistence` 与 `FilePersistence` 是两个真实 Adapter（两个 Adapter 证明 seam 不是假想抽象）；
- 插件实现只依赖 Cordis、Yjs 与持久化 contracts，**不得 import DSH 或 NomicoreServer app**；
- DSH 与 NomicoreServer 都只是 Cordis Host：前者装调试/inspector 插件，后者只装生产插件集合；
- 插件采用工厂/实例模型而非全局单例，以支持测试隔离、不同 rootDir 与 HMR/reload；
- dispose 时释放文件句柄、后台任务和 Y.Doc 缓存；宿主负责按依赖逆序停止插件。

### 实施顺序

1. persistence contracts + Cordis service 注册；
2. MemoryPersistence 插件 + contract tests；
3. FilePersistence 插件（用户分区、缓存身份、显式 save、手动 evict、恢复与崩溃测试）；
4. DSH 开发 profile + inspector 探针；
5. 上述插件在 DSH 调通后才启动 NomicoreServer 极薄 Cordis Host。

## 被否方案

- **opaque 字节接口**：持久层只认 Uint8Array——同步 diff、GC、缓存管理全部不可行（owner 裁决）；
- **批量 flush / 隐式插桩落盘**：旧系统的「内存脏 doc + 定期 flush」有崩溃窗口；隐式插桩剥夺管理操作的落盘时机控制；
- **docId 放 JS 属性**：不落盘、不随同步走、WAL 脱离 store 上下文不可识别——违反自包含原则（doc 应完整自述：遵循哪个 schema、是谁、内容本体）。

## 后果

- v1 限制：单进程（无文件锁）、load 全量入内存；
- WAL 帧格式（length+crc、坏帧截断、Yjs 重放幂等）不进入 v1；作为 v2 增量持久化 Adapter 的内部实现候选，不进 API；
- 与 DocScope（schema 编译产物缓存，H3）正交汇合：loadDoc → 读 SCHEMA → DocScope.getCompiled → 可校验；
- 事务原子性由 Y.transact（单 update 单元）保证，store 无需多写事务。

## 关联

- ADR 0001（自包含、变更历史与数据同源）、ADR 0003（ROOT 约定）、设计文档 §10（作用域隔离）、§11（schema 变更管理操作）
- 旧 yjs-server 借鉴清单：fs 原子写（temp+rename）、flush/cleanup 调度经验（归属上层 cron 而非 store）

### createDoc 与 owner 语义修订（2026-08-21，issue #64；演进经 owner 裁决放行）

本节修订上方两处早期决策条款，取代关系如下；未提及的条款维持原文效力。

**1. 创建语义（取代「创建 = 首个 saveDoc（无独立 createDoc）」）**：`DocPersistence` 提供
`createDoc(owner, docId, doc): Promise<DocHandle>`，对 `(owner.userId, docId)` 排他创建：

- cache/store 已存在或并发创建 → 拒绝 `DocDuplicateError`（稳定错误码 `DOC_DUPLICATE`）；
  **在 duplicate 判定路径上绝不覆盖已提交内容**——cache 命中即拒、store 存在性读见快照即拒、
  并发 claim 即拒，三条判定都在进入写路径之前；并发 create 恰好一个成功，落败者在进入写路径前被拒；
- 创建成功前初始完整 snapshot 已提交（`Y.encodeStateAsUpdate(doc)` 直写；FilePersistence 以
  temp→rename 完成为提交点；不新增 fsync 保证）；成功签发有效 lease 且 `handle.doc === doc`，
  持久层接管该 doc 生命周期（eviction/dispose 时销毁）；
- 失败时不返回 handle、不缓存、不销毁传入 doc，所有权仍归调用方；原始 I/O 错误原样上抛；
- create/create 与 create/load 共享 per-key coordination；若同 key 的 load 已在读取 store，
  create 必须等待该 read 的存在性证据：读到 snapshot 则拒绝 `DocDuplicateError`，读到 missing
  才能进入写路径。pending load 按自己的 read 结果完成；实现不得以 supersede 或事后告警替代
  duplicate 判定，更不得覆盖已提交 snapshot；
- 持久层仍仅校验 `META.docId === docId`，不校验 VFSL/ROOT/createdAt；`saveDoc` 的
  「脏通知 + 内部调度」语义不变，首个 saveDoc 仍是合法写入路径。

**2. 接口契约（取代本文上方接口代码块的 `DocHandle.user` 与二方法签名）**：

```ts
interface User { userId: string }

interface DocHandle {
  readonly owner: User;   // 文档的存储所有者（分区键），非当前访问者
  readonly docId: string;
  readonly doc: Y.Doc;
  release(): Promise<void>;
}

interface DocPersistence {
  createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle>;
  loadDoc(owner: User, docId: string): Promise<DocHandle | null>;
  saveDoc(handle: DocHandle): Promise<void>;
}
```

`owner` 仅作分区键，本层不鉴权（与「user 仅作分区键」条款同义，术语对齐）；访问者授权
不进入 Persistence Interface。内部 Entry、契约测试与文档随接口统一 owner 语义。

**3. 实施注记**：create/load 同键协调与 flush 调度收敛为 adapter 共享的 persistence
lifecycle core（MemoryPersistence 与 FilePersistence 共用，不得复制状态机）；两 Adapter
必须通过同一组 createDoc shared contract tests。

**4. supersede 裁决撤销（2026-08-21，PR #67 review 修订）**：此前 task archive 中关于
create supersede pending load、early adoption 与 lost-update 事后告警的设计/测试记录已被撤销，
不构成当前契约。它允许在 read 尚未返回时写入，无法满足「store 已存在则拒绝且不覆盖」；当前
语义以本节第 1 条的等待 read 证据规则为准。跨 Adapter 实例的原子 create-if-absent 仍需由
后续 FilePersistence 工作在 store seam 落实，不能由单实例内存协调替代。

### DocHandle entry status 与 saveDoc 职责修订（2026-08-22，issue #79；演进经 owner 裁决放行——issue #79 AC1/AC8 明文授权）

本节为**增量演进**：扩展 DocHandle 接口形状（新增 `getStatus()`），并修订「save 失败按 doc 只读降级」条款中 degraded 拒绝面的归属。除下列明示条款外，未提及的条款（含「createDoc 与 owner 语义修订」节全部条款）维持原文效力。

**1. 接口契约（在「createDoc 与 owner 语义修订」节的接口代码块上追加 `getStatus` 成员，其余成员不变）**：

```ts
type DocHandleStatus = 'ready' | 'persistence-degraded' | 'released' | 'disposed'

interface DocHandle {
  readonly owner: User;   // 文档的存储所有者（分区键），非当前访问者
  readonly docId: string;
  readonly doc: Y.Doc;
  /** 同步返回本 handle 所属 (owner.userId, docId) entry 的持久层状态。 */
  getStatus(): DocHandleStatus;
  release(): Promise<void>;
}
```

- 状态查询是 **entry 级**的：恒答该 handle 自己的 `(owner.userId, docId)` entry 状态，不得以 Adapter 聚合状态代替（Adapter 级 `getStatus` 是粗粒度健康汇总，仅供运维观测，不构成写前 gate 依据）；
- 状态词与优先级冻结：`disposed`（签发方已 dispose）> `released`（本租约已释放）> entry 状态（`persistence-degraded`：该 entry 最近一次 flush 失败且尚未 retry 成功；`ready`：其余情形，含 flush 在途）；
- `getStatus()` 只表示**调用瞬间**状态，不承诺后续 flush 成功——写前状态检查不是持久化成功保证（与「saveDoc 返回仅表示脏状态已登记」「rename 成功即完成一次 flush，不承诺掉电级持久性」同款无承诺纪律）。

**2. saveDoc 职责（修订「saveDoc = 脏状态通知」与「save 失败按 doc 只读降级」条款的边界）**：

- saveDoc 是 **mutation 后的 dirty notification**：只要租约有效（未 released、非 foreign、身份匹配、Persistence 未 disposed），saveDoc 必须递增 dirtyGeneration 并 resolve——entry 处于 `persistence-degraded` **不构成拒绝理由**；已提交进 live Y.Doc 的事务由持久层内部 retry 以完整 Y.Doc 状态最终持久化；
- 「失败后 namespace 进入 `persistence-degraded`……拒绝**后续** REST/WS 写入」的拒绝面归属**业务编排层**：Runtime（ADR 0007 NamespaceRuntime 写前 gate）在业务 mutation 前读取 `handle.getStatus()`，已 degraded 则拒绝开始新写入（零写入：文档不变、响亮拒绝）。持久层自身仅在租约身份失效（foreign/released/身份失配）或 disposed 时响亮拒绝；
- gate 检查通过后才转为 degraded 的 mutation 不属「后续」写入：其内存事务保留、saveDoc 正常登记、由 retry 覆盖最新完整 live Y.Doc；
- 降级等待期内（任一可观察时刻）retry 退避即该 entry 的唯一 flush 调度源（退避上限 max-dirty 间隔；flush 记账的 catch→finally 同步续体内允许瞬态并存，无外部可观察后果），「不设外部 flush/cron 协调器」不变。

**3. 实施注记**：entry 状态解析收敛于 adapter 共享的 persistence lifecycle core（两 Adapter 不得复制状态机）；MemoryPersistence 与 FilePersistence 以平行验收套件覆盖同一状态契约（`issue-79-entry-status.test.ts` / `issue-79-file-entry-status.test.ts`）。
