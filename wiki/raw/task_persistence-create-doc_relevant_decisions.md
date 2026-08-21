# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出（被审对象：`wiki/raw/task_persistence-create-doc.md`，Issue #64）。
> 只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> ADR 基准：`docs/adr/`（0001–0006，全部 accepted，无 superseded）。

## 相关 ADR

### ADR-0006 Cordis 持久化插件——DocPersistence 接口与 doc 三条目内容布局（accepted，2026-08-21）

- 与本任务的关联点：**本任务的全部领地**——DocPersistence 接口扩展、handle 语义、lease、
  flush/commit 语义、磁盘布局、Adapter/contract tests 结构均由本 ADR 定义。

- 核心条款（原文摘录）：

  层定位与接口：

  - 「持久层 = Y.Doc 的存储引擎（store + cache 一体），看得见 Y.Doc（结构、update 事件、
    state vector），看不见 schema 语义（VFSL/校验规则属引擎领地）。」
  - 接口定义（原文代码块）：

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

  handle / 并发 / 调度语义：

  - 「共享 doc，独立 handle：同一 `(user, docId)` 的所有成功 load 共享同一 live Y.Doc 实例
    （sync 接入、写入管线、REST 的权威实例），但每次 load 返回独立 DocHandle/lease」
  - 「并发加载合流：同一 `(userId, docId)` cache miss 时只创建一个内部 loading Promise；
    所有并发 load await 同一还原过程，成功后各获得独立 handle，但 `handle.doc` 恒为同一
    live Y.Doc 实例」
  - 「引用计数 + 身份校验：每个 handle 对应一个不可伪造的 lease；release 幂等且仅释放本次
    使用权。跨 Adapter/HMR reload 的 foreign handle、已释放 handle 的 saveDoc 都响亮拒绝；
    引用归零仅使缓存项成为可驱逐候选，不立即释放」
  - 「saveDoc = 脏状态通知，不是同步落盘：持有有效 handle 的调用方在 Doc 每次发生变更后
    调用 saveDoc 通知持久层；saveDoc 返回仅表示脏状态已登记，不构成该次写入已落盘的承诺」
  - 「持久层内部调度：不设外部 flush/cron 协调器。第一次 dirty 启动 max-dirty 计时器
    （默认 5s）；每次 saveDoc 重置 debounce 计时器（默认 500ms）；任一到达即发起 flush。……
    默认值可由插件配置覆写；retry 同属持久层内部，以退避策略重试直到成功或插件停止」

  创建语义（本任务的直接对照条款）：

  - 「创建 = 首个 saveDoc：loadDoc 不存在返回 null，调用方自建 Y.Doc 写入初始内容后以有效
    handle 首次 saveDoc 即完成创建（**无独立 createDoc**）」

  失败降级与释放：

  - 「save 失败按 doc 只读降级，保留内存事务：……失败后 namespace 进入
    `persistence-degraded`，保留读/查询与已同步状态，拒绝**后续** REST/WS 写入；……由持久层
    内部 retry 持久化，retry 成功后才恢复可写；不关闭整个 server」
  - 「release = 不再使用通知：调用方在短 scope 的 finally 中调用 handle.release()；持久层在
    引用归零后可触发/等待 dirty doc 的 flush，且仅在保存成功、缓存/空闲策略满足后才真正
    释放实例，调用方不直接控制释放时刻」

  范围与鉴权边界：

  - 「v1 不提供 list：per-user 枚举用到再补」
  - 「user 仅作分区键：本层不鉴权；userId 与 namespaceId 均由 NomicoreServer 分配，作为受控
    安全路径段使用（不允许特殊字符/路径分隔符）。存储按用户分区，namespaceId 在用户目录内
    唯一。」

  v1 磁盘布局与提交点（2026-08-21 owner 决策，原文）：

  ```text
  {rootDir}/                    # FilePersistence 插件配置
    users/
      {userId}/                 # NomicoreServer 分配的安全目录名
        {namespaceId}.snapshot  # 用户目录内唯一的 namespace 快照
  ```

  - 「`META.docId` 必须等于请求的 namespaceId；不一致视为持久化损坏并响亮失败。`owner`
    仍不写入 META（用户归属由目录分区承载）。userId 与 namespaceId 共用安全文法
    `^[a-z][a-z0-9-]{0,62}$`：同一标识可直接用于目录、REST path、WS room 与 META，无需
    额外编码/hash/转义。」
  - 「持久层内部的 flush 在触发时以 `Y.encodeStateAsUpdate(doc)` 编码**完整 Y.Doc 状态**，
    写入 `{namespaceId}.snapshot.tmp` 后以原子 rename 覆盖 `{namespaceId}.snapshot`。
    `loadDoc` 只读取 `.snapshot` 并 `Y.applyUpdate` 还原 Y.Doc；启动发现遗留 `.tmp` 时一律
    忽略并删除——`.tmp` 可能半写入，只有 `.snapshot` 是提交态。」
  - 「rename 成功即完成一次 flush：v1 不对每次 flush 做 file/directory fsync，`saveDoc`
    本身也不承诺掉电级持久性」
  - 「数据保障不依赖单机 fsync：需要更强保证时，以副本、异机复制、备份/恢复演练等**冗余
    机制**提供，另行设计」
  - 「单飞 flush + generation 保序：每次 saveDoc 递增 dirtyGeneration；同一 doc 同时最多一个
    flush。flush 启动时捕获 generation，成功后仅将该 generation 标记为已持久；若 flush 期间
    有新 saveDoc（dirtyGeneration 更大），doc 保持 dirty 并安排下一轮 flush——旧 snapshot
    不得将新状态误标为已保存」
  - 「规模优化（增量 WAL + 周期快照）留 v2，以不改变 `DocPersistence` Interface 的 Adapter
    内部替换实现」

  doc 内容布局（三条目，原文）：

  ```
  Y.Doc
  ├── SCHEMA   信封（lang, version, id, text）——遵循哪个 schema
  ├── META     元信息（Y.Map：docId, createdAt）——我是谁
  └── ROOT     数据根——内容本体
  ```

  - 「`META.docId` = doc 实例身份（寻址键，不随 schema 升级变化）；与信封 `id`
    （`命名空间@schema版本` 谱系标签）语义不重叠」
  - 「`META.createdAt` 由上层 namespace lifecycle 生成和维护；持久层不生成、不修改、不校验
    该字段（持久层只校验 META.docId）」
  - 「`owner` 暂不入 META（归属先存于 store 分区路径，避免将来跨用户共享时语义尴尬）」
  - 「META/SCHEMA 作为 ROOT 的兄弟条目，天然在 validateSnapshot/validatePatch 的校验面之外
    （校验只作用 ROOT 子树）」

  Cordis 插件化（原文）：

  - 「`DocPersistence` 是 Cordis service Interface；插件通过 Cordis 提供/注入该 service。
    service 是 Host 长生命周期资源，DocHandle 是请求/命令/WS 连接等短 scope 的 lease」
  - 「`MemoryPersistence` 与 `FilePersistence` 是两个真实 Adapter（两个 Adapter 证明 seam
    不是假想抽象）」
  - 「插件实现只依赖 Cordis、Yjs 与持久化 contracts，**不得 import DSH 或 NomicoreServer
    app**」
  - 「插件采用工厂/实例模型而非全局单例，以支持测试隔离、不同 rootDir 与 HMR/reload」
  - 「dispose 时释放文件句柄、后台任务和 Y.Doc 缓存；宿主负责按依赖逆序停止插件」
  - 实施顺序（原文）：「1. persistence contracts + Cordis service 注册；2. MemoryPersistence
    插件 + contract tests；3. FilePersistence 插件……」

  v1 限制（原文）：

  - 「v1 限制：单进程（无文件锁）、load 全量入内存」
  - 「WAL 帧格式……不进入 v1；作为 v2 增量持久化 Adapter 的内部实现候选，不进 API」

### ADR-0001 VFSL 文本是 schema 的唯一真相源（accepted，含 2026-08-19 修订节）

- 与本任务的关联点：持久层按 SCHEMA 信封**原样存储/还原** schema 数据，不解释、不重构、
  不在仓内镜像 schema 文本；本任务 Out of scope 的「SCHEMA/META/ROOT 初始化」归上层。
- 核心条款（原文摘录）：
  - 「schema 用 VFSL……以信封 `{ lang, version, id, text }` 作为数据存进 doc 的
    `__schema__`；解释行为由信封自述的方言版本决定，方言只增不改，未知方言 loud-fail
    只读。」
  - 「**本仓库是纯引擎仓库：代码库不含 schema 文本（测试 fixture 除外）。**」
  - 「schema 演进是运行时管理操作……变更历史在 Yjs update WAL 里，与数据同源。」

### ADR-0002 nomicore 是全新 yjs-server 重写，authority 完全出范围（accepted）

- 与本任务的关联点：本任务 Out of scope 的「accessor/ACL/sharing/auth」与之一致——持久层
  不可长出任何 authority/鉴权语义。
- 核心条款（原文摘录）：
  - 「旧系统既有的 authority 规则体系（`__authority__` manifest：enum / range / conditional /
    state-machine）**完全排除在范围外，不保留接口**——统一写入管线收敛为『结构 → 值 →
    单事务提交』三步。」
  - 「设计文档未覆盖旧服务端的其余职责（同步协议细节、持久化、presence 等），PRD 必须
    显式划定新服务端的功能边界。」

### ADR-0003 求值器与派生 schema——evaluate 接缝、ROOT 根别名约定（accepted）

- 与本任务的关联点：doc 三条目布局中的 ROOT 条目即本 ADR 的 ROOT 约定；本任务简报明确
  「不校验 VFSL/ROOT/createdAt」，与层边界条款互为印证。
- 核心条款（原文摘录）：
  - 「每个模块必须恰好声明一个名为 `ROOT` 的别名（大小写是契约……）……ROOT 固定物化为
    Y.Map……Yjs 映射为 `doc.getMap('ROOT')`。」
  - （ADR-0006 关联节亦引证本 ADR 的 ROOT 约定与作用域隔离。）

### ADR-0004 vfsl-protocol 类型协议包（accepted）；ADR-0005 投影生成管线（accepted）

- 与本任务的关联点：**无**。二者冻结编译期类型投影与 SchemaSource/生成器管线
  （Phase 1 领地），不触及持久化接口与存储布局。全链 SA 无需在本任务中引用。

## CONTEXT.md 相关术语与惯例

- `命名空间（namespace）`：「一个 Y.Doc 连同自带的 `__schema__` 与数据；schema 随数据走，
  不依赖代码模块。」——持久层存储单元即命名空间 doc（ADR-0006 三条目布局）。
- `ROOT`：「命名空间根别名的保留名（大小写是契约）……ROOT 固定物化为 Y.Map，Yjs 映射为
  doc 根 `getMap('ROOT')`。」——持久层只存储不校验（本任务简报与之对齐）。
- `信封（envelope）`：「`__schema__` 里的 `{ lang, version, id, text }`；单字符串值，原子
  替换、可哈希、可 diff。」
- `authority 规则`：「旧系统的 `__authority__` manifest……**本仓库范围外**（ADR-0002）。」
- `作用域绑定（DocScope）`：「每个命名空间绑定自己的方言解释器、规则集与编译缓存……」
  ——ADR-0006 后果节：「与 DocScope（schema 编译产物缓存，H3）正交汇合：loadDoc → 读
  SCHEMA → DocScope.getCompiled → 可校验」。
- `零写入（zero-write）`：「校验失败 → 400 且文档不变；所有写入口走同一条管线。」——属
  引擎/写入管线语义，持久层不参与判定（save 失败降级语义见 ADR-0006）。

## 设计引入的新决策点（Phase 2 设计后复审追加，2026-08-21）

> 出处：`wiki/raw/task_persistence-create-doc_design.md`（SA1 设计）。C1/C2 两条 evolution 已由
> owner 裁决放行（dispatch 记录：daemon 恢复指令即放行、不停机）。以下摘录设计在已放行演进
> 与前置 no-conflict 条款之外**新增/细化**的决策点，供 SA2/SA3/SA4/SA7 复用；冲突裁决见
> `wiki/raw/task_persistence-create-doc_design_conflict_report.md`（verdict: `clear`）。

- **演进条款为现行契约基准**（design §0/§12）：「本设计不以 ADR-0006 旧接口文本为现行契约，
  而以如下演进后条款为基准」；SA3 须将 §12 修订节草案**逐字追加**到
  `docs/adr/0006-server-persistence-docstore.md` 末尾（含对「创建 = 首个 saveDoc」与接口
  代码块的正式取代声明；「未提及的条款维持原文效力」）。注意：worktree 内 ADR-0006 文件当前
  仍为演进前文本，演进效力在落地前来自 dispatch 放行 + §12 草案。
- **初始提交直写**（design §4.2/§6，不变式 U4）：createDoc 首快照以 `Y.encodeStateAsUpdate(doc)`
  直写 `io.write`，fail-fast、无 debounce/retry（成功后 `timer.pending()===0`）；flush 机器仅
  服务 saveDoc 链路且逐字保留（§11 微任务同深约束）。
- **supersede 线性化**（design §4.3）：create 遇 load 发起的同 key in-flight 读——不等、不重发、
  不删 read，凭内存协调状态取得创建权；create 成功 → pending load 立即采纳 created entry；失败 →
  回退自身读证据；被取代读晚归且非空 → loud `lost-update anomaly` 告警（不静默、不进 degraded）；
  跨实例共享 store 不做保证（v1 单进程无文件锁）。规范调用方模式：先 create、duplicate 再 load，
  禁止同 key 并发 load+create。
- **共享 lifecycle core / IO seam**（design §5）：`src/lifecycle.ts`（包内共享，不进公共导出）
  承载 cell 状态机 + flush/eviction/dispose 机器；MemoryPersistence 瘦壳化仅做 IO wiring + 委托；
  #58 FilePersistence 以同一 `PersistenceIO` seam（read/write 尊重 signal）实例化同一 core——
  「不得 fork 状态机、不得复制 flush 机器」，两 Adapter 过同一 `describeDocCreateContract`。
- **create 失败零残留**（design §8，不变式 U2）：原始 I/O 错误原样上抛（不进 retry/degraded）；
  不缓存、不销毁传入 doc、无 timer、claim 回滚后同 key 可重试；dispose 竞态以含 `disposed` 的
  真实 rejection 收束。
- **META.docId 创建期前置校验**（design §6）：任何 I/O 之前同步校验
  `doc.getMap('META').get('docId') === docId`；不校验 SCHEMA/ROOT/createdAt；restore 侧校验
  消息原文保留（`/META\.docId/` 断言锚定）。
- **owner 迁移边界**（design §9）：`User` 接口名保留（host-issued 分区键语义）；仅
  `DocHandle.owner`、`loadDoc(owner,…)`、`createDoc(owner,…)`、内部 Entry 字段与测试 kit 参数名
  迁移；`toKey(owner.userId, docId)` 分区不变（用例 7 锚定）。
- **DocDuplicateError 契约**（design §10，不变式 U5）：duplicate 的唯一拒绝类型，
  `code: 'DOC_DUPLICATE'` 为自有可枚举属性，从 `@nomicore/persistence` 导出；调用方以
  instanceof/code 分支，无需解析 message。
- **测试种子语义**（design §5.3）：`seedForTest` 撞上 reading/creating cell → loud 抛错
  （`'test seed requires an idle key cell'`），不静默覆盖。

## 输入完整性备注（非 ADR 冲突，供总控知悉）

- 任务简报引用的 PRD `docs/prd/persistence-create-doc.md` 在本 worktree
  （分支 `fix/issue-64-on-adr-server-design`）不存在——`docs/` 下无 `prd/` 目录。
  本门禁仅以任务简报正文为被审对象；若 PRD 后续补入且含有超越简报的要求，需补一次对照。
