# ADR 0006：Cordis 持久化插件——DocPersistence 接口与 doc 三条目内容布局

日期：2026-08-21
状态：已接受（Phase 2 server 架构讨论，D-B 持久层决策）

## 背景

NomicoreServer 需要持久层。初稿方案（store 只认 opaque Uint8Array 帧、load/append/replaceWithSnapshot）被 owner 否决：把 Y.Doc 降级为字节会让大量优化不可行（同步 diff 服务、Yjs GC、智能快照、缓存管理），且持久层需要用户信息以支持按用户分区存储。

## 决策

**持久层 = Y.Doc 的存储引擎（store + cache 一体）**，看得见 Y.Doc（结构、update 事件、state vector），看不见 schema 语义（VFSL/校验规则属引擎领地）。

```ts
interface User { userId: string }

interface DocPersistence {
  loadDoc(user: User, docId: string): Promise<Y.Doc | null>;
  saveDoc(user: User, doc: Y.Doc): Promise<void>;
  evict(user: User, doc: Y.Doc): Promise<void>;
}
```

- **身份保证**：同一 `(user, docId)` 恒返回同一 Y.Doc 实例——sync 接入、写入管线、REST 共享权威实例，这是正确性前提而非优化；
- **显式 saveDoc，调度与请求解耦**：saveDoc 是持久化协调器显式调用的操作，但可由定时器/脏状态策略触发，不构成某一次 REST/WS 写入请求的同步提交承诺（否决隐式插桩：迁移等管理操作需要控制落盘时机）；
- **创建 = 首个 saveDoc**：loadDoc 不存在返回 null，调用方自建 Y.Doc 写入初始内容后 saveDoc 即完成创建（无独立 createDoc）；
- **save 失败按 doc 只读降级，保留内存事务**：已校验并提交的事务立即进入 live Y.Doc 并正常同步；save 是内部异步行为，失败不向触发该事务的客户端追溯报错、不通用回滚。失败后 namespace 进入 `persistence-degraded`，保留读/查询与已同步状态，拒绝**后续** REST/WS 写入；失败事务保留在同一 live Y.Doc 中，由后台 retry 持久化，retry 成功后才恢复可写；不关闭整个 server。
- **evict 纯手动**：驱逐策略（连接归零、空闲计时）属上层，本层只提供能力；
- **v1 不提供 list**：per-user 枚举用到再补；
- **user 仅作分区键**：本层不鉴权；存储按用户分区（如 `data/users/{userId}/{docId}.snapshot`）。

### v1 持久化格式：全量快照原子覆盖（2026-08-21，owner 决策）

v1 的 `saveDoc` 直接以 `Y.encodeStateAsUpdate(doc)` 编码**完整 Y.Doc 状态**，使用临时文件 + 原子 rename 覆盖该 doc 的单个 snapshot 文件。`loadDoc` 读取该 snapshot 并 `Y.applyUpdate` 还原 Y.Doc。

- 选择简单、可审计、单文件恢复；沿用旧 yjs-server 已验证的 temp+rename 模式；
- **rename 成功即返回**：v1 不对每次 save 做 file/directory fsync，`saveDoc` 不承诺掉电级持久性；
- 数据保障不依赖单机 fsync：需要更强保证时，以副本、异机复制、备份/恢复演练等**冗余机制**提供，另行设计；
- 不引入 WAL、增量水位、帧格式、压缩调度或坏帧截断的实现复杂度；
- 代价已知：每次 save 的 CPU/IO 与文档全量大小成正比；规模优化（增量 WAL + 周期快照）留 v2，以不改变 `DocPersistence` Interface 的 Adapter 内部替换实现。

**doc 内容布局（三条目）**：

```
Y.Doc
├── SCHEMA   信封（lang, version, id, text）——遵循哪个 schema
├── META     元信息（Y.Map：docId, createdAt）——我是谁
└── ROOT     数据根——内容本体
```

- `META.docId` = doc 实例身份（寻址键，不随 schema 升级变化）；与信封 `id`（`命名空间@schema版本` 谱系标签）语义不重叠；
- `owner` 暂不入 META（归属先存于 store 分区路径，避免将来跨用户共享时语义尴尬）；
- META/SCHEMA 作为 ROOT 的兄弟条目，天然在 validateSnapshot/validatePatch 的校验面之外（校验只作用 ROOT 子树）。

## Cordis 插件化修订（2026-08-21，owner 决策）

NomicoreServer 与 DSH 均以 **Cordis** 为宿主内核；持久层先作为宿主无关的 Cordis 插件在 DSH 中开发、调试和验证，之后由 NomicoreServer 加载同一插件实现——不为 server 重写第二份持久化逻辑。

### 核心 seam 与 Adapter

- `DocPersistence` 是 Cordis service Interface；插件通过 Cordis 提供/注入该 service；
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
