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
- **saveDoc = 脏状态通知，不是同步落盘**：持有有效 handle 的调用方在 Doc 每次发生变更后调用 saveDoc 通知持久层；持久层内部按自身调度策略决定何时真正写回磁盘。saveDoc 返回仅表示脏状态已登记，不构成该次写入已落盘的承诺；
- **创建 = 首个 saveDoc**：loadDoc 不存在返回 null，调用方自建 Y.Doc 写入初始内容后以有效 handle 首次 saveDoc 即完成创建（无独立 createDoc）；
- **save 失败按 doc 只读降级，保留内存事务**：已校验并提交的事务立即进入 live Y.Doc 并正常同步；持久化是内部异步行为，失败不向触发该事务的客户端追溯报错、不通用回滚。失败后 namespace 进入 `persistence-degraded`，保留读/查询与已同步状态，拒绝**后续** REST/WS 写入；失败事务保留在同一 live Y.Doc 中，由持久层内部 retry 持久化，retry 成功后才恢复可写；不关闭整个 server。
- **release = 不再使用通知**：调用方在短 scope 的 finally 中调用 handle.release()；持久层在引用归零、缓存/脏状态/空闲策略满足后才真正释放实例，调用方不直接控制释放时刻；
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
