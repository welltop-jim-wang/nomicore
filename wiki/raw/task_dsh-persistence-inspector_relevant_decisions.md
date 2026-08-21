# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 被审任务：DSH 持久化开发 profile 与 inspector 探针（Issue #59，功能开发）
> 冲突基准快照：`docs/adr/` 0001–0006（6 份全部 accepted，无整份 superseded 的 ADR）+ `CONTEXT.md`
> 注意：ADR-0006 内部有「createDoc 与 owner 语义修订（2026-08-21）」节，**取代正文两处早期条款**（见下文明示）；引用时以修订节为准。

## 相关 ADR

### ADR-0006 Cordis 持久化插件——DocPersistence 接口与 doc 三条目内容布局（accepted；本任务的直接治理 ADR）

- 与本任务的关联点：本任务即该 ADR「实施顺序」第 4 步「DSH 开发 profile + inspector 探针」；DSH 是持久化插件的开发宿主，NomicoreServer 之后加载同一插件实现。
- 核心条款（原文摘录）：

#### 宿主与插件边界（Cordis 插件化修订节）

- 「NomicoreServer 与 DSH 均以 **Cordis** 为宿主内核；持久层先作为宿主无关的 Cordis 插件在 DSH 中开发、调试和验证，之后由 NomicoreServer 加载同一插件实现——不为 server 重写第二份持久化逻辑。」
- 「`DocPersistence` 是 Cordis service Interface；插件通过 Cordis 提供/注入该 service。service 是 Host 长生命周期资源，DocHandle 是请求/命令/WS 连接等短 scope 的 lease；」
- 「`MemoryPersistence` 与 `FilePersistence` 是两个真实 Adapter（两个 Adapter 证明 seam 不是假想抽象）；」
- 「插件实现只依赖 Cordis、Yjs 与持久化 contracts，**不得 import DSH 或 NomicoreServer app**；」
- 「DSH 与 NomicoreServer 都只是 Cordis Host：前者装调试/inspector 插件，后者只装生产插件集合；」
- 「插件采用工厂/实例模型而非全局单例，以支持测试隔离、不同 rootDir 与 HMR/reload；」
- 「dispose 时释放文件句柄、后台任务和 Y.Doc 缓存；宿主负责按依赖逆序停止插件。」

#### 接口契约（「createDoc 与 owner 语义修订」节，2026-08-21——取代正文早期 `DocHandle.user` 与二方法签名代码块）

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

- 「`owner` 仅作分区键，本层不鉴权（与「user 仅作分区键」条款同义，术语对齐）；访问者授权不进入 Persistence Interface。」
- 「cache/store 已存在或并发创建 → 拒绝 `DocDuplicateError`（稳定错误码 `DOC_DUPLICATE`）」
- 「**在 duplicate 判定路径上绝不覆盖已提交内容**——cache 命中即拒、store 存在性读见快照即拒、并发 claim 即拒，三条判定都在进入写路径之前；并发 create 恰好一个成功，落败者在进入写路径前被拒；」
- 「失败时不返回 handle、不缓存、不销毁传入 doc，所有权仍归调用方；原始 I/O 错误原样上抛；」
- 「create/create 与 create/load 共享 per-key coordination；若同 key 的 load 已在读取 store，create 必须等待该 read 的存在性证据：读到 snapshot 则拒绝 `DocDuplicateError`，读到 missing 才能进入写路径。……实现不得以 supersede 或事后告警替代 duplicate 判定，更不得覆盖已提交 snapshot；」
- 「持久层仍仅校验 `META.docId === docId`，不校验 VFSL/ROOT/createdAt；`saveDoc` 的「脏通知 + 内部调度」语义不变，首个 saveDoc 仍是合法写入路径。」
- 「create/load 同键协调与 flush 调度收敛为 adapter 共享的 persistence lifecycle core（MemoryPersistence 与 FilePersistence 共用，不得复制状态机）；两 Adapter 必须通过同一组 createDoc shared contract tests。」
- 修订节声明：「本节修订上方两处早期决策条款，取代关系如下；未提及的条款维持原文效力。」（被取代的早期条款：「创建 = 首个 saveDoc：loadDoc 不存在返回 null，调用方自建 Y.Doc 写入初始内容后以有效 handle 首次 saveDoc 即完成创建（无独立 createDoc）」——**该旧条款不再构成约束**）
- 修订节 4「supersede 裁决撤销」（2026-08-21，PR #67 review 修订）：「此前 task archive 中关于 create supersede pending load、early adoption 与 lost-update 事后告警的设计/测试记录已被撤销，不构成当前契约。」「当前语义以本节第 1 条的等待 read 证据规则为准。跨 Adapter 实例的原子 create-if-absent 仍需由后续 FilePersistence 工作在 store seam 落实，不能由单实例内存协调替代。」——SA1/SA3 不得从 task archive 复活已撤销的 supersede / early-adoption / 事后告警设计。

#### handle / lease 语义（正文决策条款，未被修订节触及）

- 「**共享 doc，独立 handle**：同一 `(user, docId)` 的所有成功 load 共享同一 live Y.Doc 实例（sync 接入、写入管线、REST 的权威实例），但每次 load 返回独立 DocHandle/lease；」
- 「**并发加载合流**：同一 `(userId, docId)` cache miss 时只创建一个内部 loading Promise；所有并发 load await 同一还原过程，成功后各获得独立 handle，但 `handle.doc` 恒为同一 live Y.Doc 实例；」
- 「**引用计数 + 身份校验**：每个 handle 对应一个不可伪造的 lease；release 幂等且仅释放本次使用权。跨 Adapter/HMR reload 的 foreign handle、已释放 handle 的 saveDoc 都响亮拒绝；引用归零仅使缓存项成为可驱逐候选，不立即释放；」

#### saveDoc 与持久层内部调度

- 「**saveDoc = 脏状态通知，不是同步落盘**：持有有效 handle 的调用方在 Doc 每次发生变更后调用 saveDoc 通知持久层；saveDoc 返回仅表示脏状态已登记，不构成该次写入已落盘的承诺；」
- 「**持久层内部调度**：不设外部 flush/cron 协调器。第一次 dirty 启动 max-dirty 计时器（默认 5s）；每次 saveDoc 重置 debounce 计时器（默认 500ms）；任一到达即发起 flush。持续高频写入最多 5s 必定尝试一次保存，静止写入约 500ms 后保存。默认值可由插件配置覆写；retry 同属持久层内部，以退避策略重试直到成功或插件停止；」

#### save 失败降级

- 「**save 失败按 doc 只读降级，保留内存事务**：已校验并提交的事务立即进入 live Y.Doc 并正常同步；持久化是内部异步行为，失败不向触发该事务的客户端追溯报错、不通用回滚。失败后 namespace 进入 `persistence-degraded`，保留读/查询与已同步状态，拒绝**后续** REST/WS 写入；失败事务保留在同一 live Y.Doc 中，由持久层内部 retry 持久化，retry 成功后才恢复可写；不关闭整个 server。」

#### release 语义

- 「**release = 不再使用通知**：调用方在短 scope 的 finally 中调用 handle.release()；持久层在引用归零后可触发/等待 dirty doc 的 flush，且仅在保存成功、缓存/空闲策略满足后才真正释放实例，调用方不直接控制释放时刻；」

#### 分区与鉴权

- 「**user 仅作分区键**：本层不鉴权；userId 与 namespaceId 均由 NomicoreServer 分配，作为受控安全路径段使用（不允许特殊字符/路径分隔符）。存储按用户分区，namespaceId 在用户目录内唯一。」

#### v1 磁盘布局与持久化格式（FilePersistence）

```text
{rootDir}/                    # FilePersistence 插件配置
  users/
    {userId}/                 # NomicoreServer 分配的安全目录名
      {namespaceId}.snapshot  # 用户目录内唯一的 namespace 快照
```

- 「`META.docId` 必须等于请求的 namespaceId；不一致视为持久化损坏并响亮失败。`owner` 仍不写入 META（用户归属由目录分区承载）。userId 与 namespaceId 共用安全文法 `^[a-z][a-z0-9-]{0,62}$`：同一标识可直接用于目录、REST path、WS room 与 META，无需额外编码/hash/转义。」
- 「持久层内部的 flush 在触发时以 `Y.encodeStateAsUpdate(doc)` 编码**完整 Y.Doc 状态**，写入 `{namespaceId}.snapshot.tmp` 后以原子 rename 覆盖 `{namespaceId}.snapshot`。`loadDoc` 只读取 `.snapshot` 并 `Y.applyUpdate` 还原 Y.Doc；启动发现遗留 `.tmp` 时一律忽略并删除——`.tmp` 可能半写入，只有 `.snapshot` 是提交态。」
- 「**单飞 flush + generation 保序**：每次 saveDoc 递增 dirtyGeneration；同一 doc 同时最多一个 flush。flush 启动时捕获 generation，成功后仅将该 generation 标记为已持久；若 flush 期间有新 saveDoc（dirtyGeneration 更大），doc 保持 dirty 并安排下一轮 flush——旧 snapshot 不得将新状态误标为已保存；」
- 「rename 成功即完成一次 flush：v1 不对每次 flush 做 file/directory fsync，`saveDoc` 本身也不承诺掉电级持久性；」

#### doc 内容布局（三条目）

```
Y.Doc
├── SCHEMA   信封（lang, version, id, text）——遵循哪个 schema
├── META     元信息（Y.Map：docId, createdAt）——我是谁
└── ROOT     数据根——内容本体
```

- 「`META.docId` = doc 实例身份（寻址键，不随 schema 升级变化）；与信封 `id`（`命名空间@schema版本` 谱系标签）语义不重叠；」
- 「`META.createdAt` 由上层 namespace lifecycle 生成和维护；持久层不生成、不修改、不校验该字段（持久层只校验 META.docId）；」
- 「META/SCHEMA 作为 ROOT 的兄弟条目，天然在 validateSnapshot/validatePatch 的校验面之外（校验只作用 ROOT 子树）。」

#### 实施顺序（原文）

1. persistence contracts + Cordis service 注册；
2. MemoryPersistence 插件 + contract tests；
3. FilePersistence 插件（用户分区、缓存身份、显式 save、手动 evict、恢复与崩溃测试）；
4. DSH 开发 profile + inspector 探针；
5. 上述插件在 DSH 调通后才启动 NomicoreServer 极薄 Cordis Host。

#### v1 限制与关联后果

- 「v1 限制：单进程（无文件锁）、load 全量入内存；」
- 「与 DocScope（schema 编译产物缓存，H3）正交汇合：loadDoc → 读 SCHEMA → DocScope.getCompiled → 可校验；」

### ADR-0001 VFSL 文本是 schema 的唯一真相源，只存在于文档与测试中（accepted，含 2026-08-19 修订节；弱相关）

- 与本任务的关联点：探针观察 doc 的 SCHEMA 条目（信封为运行时数据）；inspector 属开发/测试工具，其使用的 schema 文本属测试 fixture 性质。
- 核心条款（原文摘录）：
  - 「**本仓库是纯引擎仓库：代码库不含 schema 文本（测试 fixture 除外）。** VFSL 文本只作为运行时数据存在于文档的 `__schema__` 中」
  - 「schema 的创建与升级只能通过运行时管理操作完成。」
  - 「全部 JSDoc 标签（`@format` / `@role` / …）为文档性质，未识别仅 warn」

### ADR-0003 求值器与派生 schema（accepted；弱相关）

- 与本任务的关联点：ROOT 条目的物化形状由本 ADR 约定，探针构造/观察 doc 时适用。
- 核心条款（原文摘录）：
  - 「每个模块必须恰好声明一个名为 `ROOT` 的别名……且必须 **map 形**……ROOT 固定物化为 Y.Map……Yjs 映射为 `doc.getMap('ROOT')`。」

### ADR-0002 / ADR-0004 / ADR-0005

- ADR-0002（accepted）：边界约束——inspector/探针不得引入 authority 语义。原文摘录：「旧系统既有的 authority 规则体系（`__authority__` manifest：enum / range / conditional / state-machine）**完全排除在范围外，不保留接口**——统一写入管线收敛为"结构 → 值 → 单事务提交"三步。」
- ADR-0004 / ADR-0005（accepted）：与本任务无直接约束关联——类型投影与生成管线不在本任务改动面；若 DSH profile/inspector 需要持久化类型，来源是持久化 contracts 包本身（ADR-0006「插件实现只依赖 Cordis、Yjs 与持久化 contracts，**不得 import DSH 或 NomicoreServer app**」），不触发 SchemaSource / CI 新鲜度纪律。盘点结论见冲突报告。

## CONTEXT.md 相关术语与惯例

- `信封（envelope）`：「`__schema__` 里的 `{ lang, version, id, text }`；单字符串值，原子替换、可哈希、可 diff。」
- `命名空间（namespace）`：「一个 Y.Doc 连同自带的 `__schema__` 与数据；schema 随数据走，不依赖代码模块。」（ADR-0006 三条目布局将承载信封的顶层条目命名为 `SCHEMA`——两条摘录并置供回查）
- `ROOT`：「命名空间根别名的保留名（大小写是契约）：每个模块必须恰好声明一个 map 形的 `type ROOT = …`（裸对象 / `YMap` / `Record`），ROOT 固定物化为 Y.Map，Yjs 映射为 doc 根 `getMap('ROOT')`。」
- `方言（dialect）`：「`lang + version` 决定的 VFSL 语法子集与语义规格；一经发布冻结，引擎只增不改，未知方言 loud-fail 只读。」
- `作用域绑定（DocScope）`：「每个命名空间绑定自己的方言解释器、规则集与编译缓存；多方言并存不需要进程级“当前版本”。」
