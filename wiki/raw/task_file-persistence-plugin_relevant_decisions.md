# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 被审对象：`wiki/raw/task_file-persistence-plugin.md`（Issue #58，FilePersistence Cordis 插件，功能开发）。
> ADR 全集：`docs/adr/` 共 6 份（0001–0006），全部 accepted，无 superseded。

## 相关 ADR

### ADR-0006 Cordis 持久化插件——DocPersistence 接口与 doc 三条目内容布局（accepted，2026-08-21）

**本任务的核心 ADR。任务简报自述「实现 ADR 0006 的生产 Adapter」，以下条款全部构成本任务的直接约束。**

#### 持久层定位（看不见 schema 语义）

- 与本任务的关联点：任务要求「持久层看 Y.Doc、不了解 VFSL/业务数据」即本条款的直接复述。
- 核心条款（原文摘录）：
  - 「**持久层 = Y.Doc 的存储引擎（store + cache 一体）**，看得见 Y.Doc（结构、update 事件、state vector），看不见 schema 语义（VFSL/校验规则属引擎领地）。」

#### 接口契约

- 核心条款（原文摘录）：

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

- 「**共享 doc，独立 handle**：同一 `(user, docId)` 的所有成功 load 共享同一 live Y.Doc 实例（sync 接入、写入管线、REST 的权威实例），但每次 load 返回独立 DocHandle/lease；」
- 「**并发加载合流**：同一 `(userId, docId)` cache miss 时只创建一个内部 loading Promise；所有并发 load await 同一还原过程，成功后各获得独立 handle，但 `handle.doc` 恒为同一 live Y.Doc 实例；」
- 「**引用计数 + 身份校验**：每个 handle 对应一个不可伪造的 lease；release 幂等且仅释放本次使用权。跨 Adapter/HMR reload 的 foreign handle、已释放 handle 的 saveDoc 都响亮拒绝；引用归零仅使缓存项成为可驱逐候选，不立即释放；」
- 「**saveDoc = 脏状态通知，不是同步落盘**：持有有效 handle 的调用方在 Doc 每次发生变更后调用 saveDoc 通知持久层；saveDoc 返回仅表示脏状态已登记，不构成该次写入已落盘的承诺；」
- 「**创建 = 首个 saveDoc**：loadDoc 不存在返回 null，调用方自建 Y.Doc 写入初始内容后以有效 handle 首次 saveDoc 即完成创建（无独立 createDoc）；」

#### 持久层内部调度与降级（P2 lifecycle core 的契约来源）

- 核心条款（原文摘录）：
  - 「**持久层内部调度**：不设外部 flush/cron 协调器。第一次 dirty 启动 max-dirty 计时器（默认 5s）；每次 saveDoc 重置 debounce 计时器（默认 500ms）；任一到达即发起 flush。持续高频写入最多 5s 必定尝试一次保存，静止写入约 500ms 后保存。默认值可由插件配置覆写；retry 同属持久层内部，以退避策略重试直到成功或插件停止；」
  - 「**save 失败按 doc 只读降级，保留内存事务**：……失败后 namespace 进入 `persistence-degraded`，保留读/查询与已同步状态，拒绝**后续** REST/WS 写入；失败事务保留在同一 live Y.Doc 中，由持久层内部 retry 持久化，retry 成功后才恢复可写；不关闭整个 server。」
  - 「**release = 不再使用通知**：调用方在短 scope 的 finally 中调用 handle.release()；持久层在引用归零后可触发/等待 dirty doc 的 flush，且仅在保存成功、缓存/空闲策略满足后才真正释放实例，调用方不直接控制释放时刻；」
  - 「**v1 不提供 list**：per-user 枚举用到再补；」
  - 「**user 仅作分区键**：本层不鉴权；userId 与 namespaceId 均由 NomicoreServer 分配，作为受控安全路径段使用（不允许特殊字符/路径分隔符）。存储按用户分区，namespaceId 在用户目录内唯一。」

#### v1 磁盘布局与持久化格式（本任务验收的直接来源）

- 核心条款（原文摘录）：

  ```text
  {rootDir}/                    # FilePersistence 插件配置
    users/
      {userId}/                 # NomicoreServer 分配的安全目录名
        {namespaceId}.snapshot  # 用户目录内唯一的 namespace 快照
  ```

  - 「`META.docId` 必须等于请求的 namespaceId；不一致视为持久化损坏并响亮失败。`owner` 仍不写入 META（用户归属由目录分区承载）。userId 与 namespaceId 共用安全文法 `^[a-z][a-z0-9-]{0,62}$`：同一标识可直接用于目录、REST path、WS room 与 META，无需额外编码/hash/转义。」
  - 「持久层内部的 flush 在触发时以 `Y.encodeStateAsUpdate(doc)` 编码**完整 Y.Doc 状态**，写入 `{namespaceId}.snapshot.tmp` 后以原子 rename 覆盖 `{namespaceId}.snapshot`。`loadDoc` 只读取 `.snapshot` 并 `Y.applyUpdate` 还原 Y.Doc；启动发现遗留 `.tmp` 时一律忽略并删除——`.tmp` 可能半写入，只有 `.snapshot` 是提交态。」
  - 「选择简单、可审计、单文件恢复；沿用旧 yjs-server 已验证的 temp+rename 模式；」
  - 「**rename 成功即完成一次 flush**：v1 不对每次 flush 做 file/directory fsync，`saveDoc` 本身也不承诺掉电级持久性；」
  - 「数据保障不依赖单机 fsync：需要更强保证时，以副本、异机复制、备份/恢复演练等**冗余机制**提供，另行设计；」
  - 「不引入 WAL、增量水位、帧格式、压缩调度或坏帧截断的实现复杂度；」
  - 「**单飞 flush + generation 保序**：每次 saveDoc 递增 dirtyGeneration；同一 doc 同时最多一个 flush。flush 启动时捕获 generation，成功后仅将该 generation 标记为已持久；若 flush 期间有新 saveDoc（dirtyGeneration 更大），doc 保持 dirty 并安排下一轮 flush——旧 snapshot 不得将新状态误标为已保存；」
  - 「代价已知：每次 save 的 CPU/IO 与文档全量大小成正比；规模优化（增量 WAL + 周期快照）留 v2，以不改变 `DocPersistence` Interface 的 Adapter 内部替换实现。」

#### doc 三条目内容布局（save→load 完整还原的验收面）

- 核心条款（原文摘录）：

  ```
  Y.Doc
  ├── SCHEMA   信封（lang, version, id, text）——遵循哪个 schema
  ├── META     元信息（Y.Map：docId, createdAt）——我是谁
  └── ROOT     数据根——内容本体
  ```

  - 「`META.docId` = doc 实例身份（寻址键，不随 schema 升级变化）；与信封 `id`（`命名空间@schema版本` 谱系标签）语义不重叠；」
  - 「`META.createdAt` 由上层 namespace lifecycle 生成和维护；持久层不生成、不修改、不校验该字段（持久层只校验 META.docId）；」
  - 「`owner` 暂不入 META（归属先存于 store 分区路径，避免将来跨用户共享时语义尴尬）；」
  - 「META/SCHEMA 作为 ROOT 的兄弟条目，天然在 validateSnapshot/validatePatch 的校验面之外（校验只作用 ROOT 子树）。」

#### Cordis 插件化条款（插件形态与依赖边界，硬性）

- 核心条款（原文摘录）：
  - 「NomicoreServer 与 DSH 均以 **Cordis** 为宿主内核；持久层先作为宿主无关的 Cordis 插件在 DSH 中开发、调试和验证，之后由 NomicoreServer 加载同一插件实现——不为 server 重写第二份持久化逻辑。」
  - 「`DocPersistence` 是 Cordis service Interface；插件通过 Cordis 提供/注入该 service。service 是 Host 长生命周期资源，DocHandle 是请求/命令/WS 连接等短 scope 的 lease；」
  - 「`MemoryPersistence` 与 `FilePersistence` 是两个真实 Adapter（两个 Adapter 证明 seam 不是假想抽象）；」
  - 「插件实现只依赖 Cordis、Yjs 与持久化 contracts，**不得 import DSH 或 NomicoreServer app**；」
  - 「插件采用工厂/实例模型而非全局单例，以支持测试隔离、不同 rootDir 与 HMR/reload；」
  - 「dispose 时释放文件句柄、后台任务和 Y.Doc 缓存；宿主负责按依赖逆序停止插件。」
- 实施顺序（原文摘录）：「3. FilePersistence 插件（用户分区、缓存身份、显式 save、手动 evict、恢复与崩溃测试）；」——注意「手动 evict」在该步描述中列出。

#### 后果（v1 边界，实现不可越界）

- 核心条款（原文摘录）：
  - 「v1 限制：单进程（无文件锁）、load 全量入内存；」
  - 「WAL 帧格式（length+crc、坏帧截断、Yjs 重放幂等）不进入 v1；作为 v2 增量持久化 Adapter 的内部实现候选，不进 API；」
  - 「与 DocScope（schema 编译产物缓存，H3）正交汇合：loadDoc → 读 SCHEMA → DocScope.getCompiled → 可校验；」
  - 「事务原子性由 Y.transact（单 update 单元）保证，store 无需多写事务。」

### ADR-0001 VFSL 文本是 schema 的唯一真相源（accepted）

- 与本任务的关联点：SCHEMA 条目（信封）随 Y.Doc 整体持久化；持久层按 Y.Doc 状态透明编码/还原，不解释信封。
- 核心条款（原文摘录）：
  - 「schema 用 VFSL（受限 TypeScript 子集 + 标记类型）+ JSDoc 语义标签描述，以信封 `{ lang, version, id, text }` 作为数据存进 doc 的 `__schema__`；」
  - 「**本仓库是纯引擎仓库：代码库不含 schema 文本（测试 fixture 除外）。**」
  - 「解释行为由信封自述的方言版本决定，方言只增不改，未知方言 loud-fail 只读。」

### ADR-0002 nomicore 是全新 yjs-server 重写，authority 完全出范围（accepted）

- 与本任务的关联点：持久层不做任何 authority/校验（与 ADR-0006「看不见 schema 语义」互证）；仓库从零起步，无旧代码可依赖。
- 核心条款（原文摘录）：
  - 「nomicore 从零实现新版 yjs-server——`apps/` 下长出完整服务端，旧系统逐步退役；」
  - 「旧系统既有的 authority 规则体系（`__authority__` manifest：enum / range / conditional / state-machine）**完全排除在范围外，不保留接口**。」

### ADR-0003 求值器与派生 schema——ROOT 根别名约定（accepted）

- 与本任务的关联点：三条目布局的 ROOT 条目物化形态；FilePersistence 还原整个 Y.Doc，无需了解 ROOT 语义，但「SCHEMA/META/ROOT 完整还原」的验收措辞锚定于此。
- 核心条款（原文摘录）：
  - 「每个模块必须恰好声明一个名为 `ROOT` 的别名（大小写是契约，`root` / `Root` 不算），且必须 **map 形**……ROOT 固定物化为 Y.Map……Yjs 映射为 `doc.getMap('ROOT')`。」

### ADR-0004 vfsl-protocol 类型协议包（accepted）——无直接关联

- 与本任务的关联点：编译期类型投影包（纯类型 + 接口，零运行时）。持久层不触及类型投影；已对照，无约束落入本任务。

### ADR-0005 投影生成管线——SchemaSource 接缝（accepted）——无直接关联

- 与本任务的关联点：schema 文本脚手架与 codegen 管线。持久层不读取 `.vfsl` 文件、不依赖 SchemaSource；已对照，无约束落入本任务。

## CONTEXT.md 相关术语与惯例

- `命名空间（namespace）`：「一个 Y.Doc 连同自带的 `__schema__` 与数据；schema 随数据走，不依赖代码模块。」——namespaceId 即本任务快照文件名与 META.docId 的取值来源。
- `信封（envelope）`：「`__schema__` 里的 `{ lang, version, id, text }`；单字符串值，原子替换、可哈希、可 diff。」——SCHEMA 条目内容；持久层透传不解释。
- `ROOT`：「命名空间根别名的保留名（大小写是契约）……ROOT 固定物化为 Y.Map，Yjs 映射为 doc 根 `getMap('ROOT')`。」
- `方言（dialect）`：「`lang + version` 决定的 VFSL 语法子集与语义规格；一经发布冻结，引擎只增不改，未知方言 loud-fail 只读。」——「响亮失败」惯例同构于 META.docId 不一致的响亮失败。
- `作用域绑定（DocScope）`：「每个命名空间绑定自己的方言解释器、规则集与编译缓存；多方言并存不需要进程级"当前版本"。」——与持久层正交（ADR-0006 后果条款）。
- `authority 规则`：「旧系统的 `__authority__` manifest（enum / range / conditional / state-machine 等不变式）。**本仓库范围外**（ADR-0002）。」——持久层不做校验的术语依据。

## 设计引入的新决策点（设计后复审追加，供 SA2/SA3/SA4 复用）

> 以下为 SA1 设计（`wiki/raw/task_file-persistence-plugin_design.md`）新增的实现层决策，非 ADR 立法；与 ADR 的一致性裁决见 `wiki/raw/task_file-persistence-plugin_design_conflict_report.md`。

- **决策 A（共享内核继承模型）**：P2 lifecycle core 自 `src/memory.ts` 抽取为包内内部模块 `src/lifecycle.ts`（抽象基类 `PersistenceLifecycleCore`，不经 index.ts 导出）；`MemoryPersistence` 与 `FilePersistence` 均继承，Memory/File 保持两个真实 Adapter。可审计判据（设计原文）：「`src/file.ts` 中不允许出现任何 debounce/max-dirty/retry/generation/degraded/eviction/WeakMap-lease 逻辑；这些代码在 `src/lifecycle.ts` 中只存在一份。」
- **决策 B（内核 I/O 缝形态）**：内核缝 `readCommittedSnapshot`/`writeCommittedSnapshot` 以 `(user, docId, signal)` 三参；`MemoryPersistenceOptions.readSnapshot/writeSnapshot` 公共回调的 `(key, signal)` 签名逐字不变（桥接层 `toPersistenceKey` 折叠回 key）。
- **决策 C（身份文法钩子）**：`validateIdentity` 为内核默认 no-op 钩子（memory 不启用）；`FilePersistence` 覆写为对 userId/namespaceId 各做一次 `^[a-z][a-z0-9-]{0,62}$` 断言，违例 loud throw；`resolveSnapshotPaths()` 内部再次校验后才 `path.join`（纵深防御）。
- **决策 D（公共面零增项）**：公共导出 = `FilePersistence` / `createFilePersistencePlugin` / `FilePersistenceOptions` / `FilePersistenceStatus`；不加 `createFilePersistence`（YAGNI）；`createFileHandleForTest`（async 形态）仅 `src/file.js` 模块路径导出，不入包公共面。
- **决策 E（.tmp 惰性清扫）**：`loadDoc` cache-miss 还原路径中，无论 `.snapshot` 命中与否，一律 best-effort 删除该 namespace 的 `.tmp`；不做启动全树扫描（设计理由：避免 list 能力与插件就绪/dispose epoch 竞态）；每次 flush 的 `writeFile(tmp, {flag:'w'})` 截断同名遗留 tmp；tmp 删除失败不阻断 load。
- **决策 F（v1 边界贯彻）**：无 fsync、无文件锁、无目录预热；`users/{userId}` 目录首次 flush 时 `mkdir recursive` 惰性创建；load 路径只读不留痕迹；多实例同 rootDir 属调用方错误，显式不处理；多实例不同 rootDir 完全隔离。
- **错误处理矩阵（设计 §4.5）**：文法违例 / META.docId 不一致 / `.snapshot` 字节损坏 / 非 ENOENT 读错误 / disposed 后调用 / foreign-released handle 全部 loud throw；ENOENT → `loadDoc` 返回 null；flush 链路失败 → `persistence-degraded` + 指数退避 retry 至恢复 `ready`；tmp 清扫失败 best-effort 吞掉；空/非字符串 rootDir 构造期 TypeError。
- **文件清单（设计 §9）**：ALLOW = `src/lifecycle.ts`（新）/ `src/file.ts`（新）/ `src/memory.ts`（瘦身为子类，公共面逐字不变）/ `src/index.ts`（追加 4 个 re-export）/ `test/file-persistence.test.ts`（SA6 owned，不改断言）；DENY = `src/testing.ts`、P1/P2 测试与 testkit、`package.json`、构建配置、`packages/vfsl*`、`domains/**`、`apps/**`、`docs/adr/**`。
