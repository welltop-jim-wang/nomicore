# ADR 0006：NomicoreServer 持久层——DocStore 接口与 doc 三条目内容布局

日期：2026-08-21
状态：已接受（Phase 2 server 架构讨论，D-B 持久层决策）

## 背景

NomicoreServer 需要持久层。初稿方案（store 只认 opaque Uint8Array 帧、load/append/replaceWithSnapshot）被 owner 否决：把 Y.Doc 降级为字节会让大量优化不可行（同步 diff 服务、Yjs GC、智能快照、缓存管理），且持久层需要用户信息以支持按用户分区存储。

## 决策

**持久层 = Y.Doc 的存储引擎（store + cache 一体）**，看得见 Y.Doc（结构、update 事件、state vector），看不见 schema 语义（VFSL/校验规则属引擎领地）。

```ts
interface User { userId: string }

interface DocStore {
  loadDoc(user: User, docId: string): Promise<Y.Doc | null>;
  saveDoc(user: User, doc: Y.Doc): Promise<void>;
  evict(user: User, doc: Y.Doc): Promise<void>;
}
```

- **身份保证**：同一 `(user, docId)` 恒返回同一 Y.Doc 实例——sync 接入、写入管线、REST 共享权威实例，这是正确性前提而非优化；
- **显式 saveDoc**：写入管线在「校验 → 事务 → 提交」的提交点显式落盘（否决隐式插桩：迁移等管理操作需要控制落盘时机）；
- **创建 = 首个 saveDoc**：loadDoc 不存在返回 null，调用方自建 Y.Doc 写入初始内容后 saveDoc 即完成创建（无独立 createDoc）；
- **evict 纯手动**：驱逐策略（连接归零、空闲计时）属上层，本层只提供能力；
- **v1 不提供 list**：per-user 枚举用到再补；
- **user 仅作分区键**：本层不鉴权；存储按用户分区（如 `data/users/{userId}/{docId}.wal`）。

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

## 被否方案

- **opaque 字节接口**：持久层只认 Uint8Array——同步 diff、GC、缓存管理全部不可行（owner 裁决）；
- **批量 flush / 隐式插桩落盘**：旧系统的「内存脏 doc + 定期 flush」有崩溃窗口；隐式插桩剥夺管理操作的落盘时机控制；
- **docId 放 JS 属性**：不落盘、不随同步走、WAL 脱离 store 上下文不可识别——违反自包含原则（doc 应完整自述：遵循哪个 schema、是谁、内容本体）。

## 后果

- v1 限制：单进程（无文件锁）、load 全量入内存；
- WAL 帧格式（length+crc、坏帧截断、Yjs 重放幂等）退为实现细节，不进 API；
- 与 DocScope（schema 编译产物缓存，H3）正交汇合：getDoc → 读 SCHEMA → DocScope.getCompiled → 可校验；
- 事务原子性由 Y.transact（单 update 单元）保证，store 无需多写事务。

## 关联

- ADR 0001（自包含、变更历史与数据同源）、ADR 0003（ROOT 约定）、设计文档 §10（作用域隔离）、§11（schema 变更管理操作）
- 旧 yjs-server 借鉴清单：fs 原子写（temp+rename）、flush/cleanup 调度经验（归属上层 cron 而非 store）
