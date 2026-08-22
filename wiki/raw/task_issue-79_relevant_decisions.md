# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出（Phase 0，设计前）。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 任务：issue #79 —— Persistence：DocHandle entry status 与 degraded 期间 dirty registration（feature）。
> 冲突裁决见同目录 `task_issue-79_conflict_report.md`（Verdict: `conflict`——0 hard-violation、1 条 evolution 上报 Jim，非阻塞）。

## 相关 ADR

ADR 0001–0005 已逐一全读（7/7，无抽样），经对照与本任务范围（持久层 entry 状态查询 / saveDoc 职责 / Runtime 写前 gate）无关联条款，不在本清单摘录。本任务的相关约束集中在 ADR 0006 与 ADR 0007。

**引文纪律（防引用已作废条款）**：ADR 0006 内部有两处早期条款已被其自身「createDoc 与 owner 语义修订」节（2026-08-21，文末）明文取代，**不构成现行约束，全链禁止引用**：

- 「创建 = 首个 saveDoc（无独立 createDoc）」——已被 `createDoc(owner, docId, doc)` 排他创建语义取代；
- 决策节接口代码块的 `DocHandle.user` 与 loadDoc/saveDoc 二方法签名——已被修订节接口代码块取代（现行冻结契约见下方摘录）。

### ADR 0006 Cordis 持久化插件——DocPersistence 接口与 doc 三条目内容布局（accepted）

- 与本任务的关联点：本任务要给 DocHandle 补 entry 级 `getStatus()`、界定 saveDoc 在 degraded 状态下的行为（只登记 dirty）、并按验收项补充本 ADR 的职责条款
- 核心条款（原文摘录）：
  - 「**持久层 = Y.Doc 的存储引擎（store + cache 一体）**，看得见 Y.Doc（结构、update 事件、state vector），看不见 schema 语义（VFSL/校验规则属引擎领地）。」
  - 「**共享 doc，独立 handle**：同一 `(user, docId)` 的所有成功 load 共享同一 live Y.Doc 实例（sync 接入、写入管线、REST 的权威实例），但每次 load 返回独立 DocHandle/lease；」
  - 「**并发加载合流**：同一 `(userId, docId)` cache miss 时只创建一个内部 loading Promise；所有并发 load await 同一还原过程，成功后各获得独立 handle，但 `handle.doc` 恒为同一 live Y.Doc 实例；」
  - 「**引用计数 + 身份校验**：每个 handle 对应一个不可伪造的 lease；release 幂等且仅释放本次使用权。跨 Adapter/HMR reload 的 foreign handle、已释放 handle 的 saveDoc 都响亮拒绝；引用归零仅使缓存项成为可驱逐候选，不立即释放；」
  - 「**saveDoc = 脏状态通知，不是同步落盘**：持有有效 handle 的调用方在 Doc 每次发生变更后调用 saveDoc 通知持久层；saveDoc 返回仅表示脏状态已登记，不构成该次写入已落盘的承诺；」
  - 「**持久层内部调度**：不设外部 flush/cron 协调器。第一次 dirty 启动 max-dirty 计时器（默认 5s）；每次 saveDoc 重置 debounce 计时器（默认 500ms）；任一到达即发起 flush。持续高频写入最多 5s 必定尝试一次保存，静止写入约 500ms 后保存。默认值可由插件配置覆写；retry 同属持久层内部，以退避策略重试直到成功或插件停止；」
  - 「**save 失败按 doc 只读降级，保留内存事务**：已校验并提交的事务立即进入 live Y.Doc 并正常同步；持久化是内部异步行为，失败不向触发该事务的客户端追溯报错、不通用回滚。失败后 namespace 进入 `persistence-degraded`，保留读/查询与已同步状态，拒绝**后续** REST/WS 写入；失败事务保留在同一 live Y.Doc 中，由持久层内部 retry 持久化，retry 成功后才恢复可写；不关闭整个 server。」
  - 「**release = 不再使用通知**：调用方在短 scope 的 finally 中调用 handle.release()；持久层在引用归零后可触发/等待 dirty doc 的 flush，且仅在保存成功、缓存/空闲策略满足后才真正释放实例，调用方不直接控制释放时刻；」
  - 「**单飞 flush + generation 保序**：每次 saveDoc 递增 dirtyGeneration；同一 doc 同时最多一个 flush。flush 启动时捕获 generation，成功后仅将该 generation 标记为已持久；若 flush 期间有新 saveDoc（dirtyGeneration 更大），doc 保持 dirty 并安排下一轮 flush——旧 snapshot 不得将新状态误标为已保存；」
  - 磁盘布局与 flush 格式：「持久层内部的 flush 在触发时以 `Y.encodeStateAsUpdate(doc)` 编码**完整 Y.Doc 状态**，写入 `{namespaceId}.snapshot.tmp` 后以原子 rename 覆盖 `{namespaceId}.snapshot`。」「**rename 成功即完成一次 flush**：v1 不对每次 flush 做 file/directory fsync，`saveDoc` 本身也不承诺掉电级持久性；」
  - 接口契约（owner 修订节，取代早期 `DocHandle.user` 与二方法签名；当前冻结契约）：

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
  - createDoc 修订节：「`DocPersistence` 提供 `createDoc(owner, docId, doc): Promise<DocHandle>`，对 `(owner.userId, docId)` 排他创建」「**在 duplicate 判定路径上绝不覆盖已提交内容**——cache 命中即拒、store 存在性读见快照即拒、并发 claim 即拒，三条判定都在进入写路径之前」「create/load 同键协调与 flush 调度收敛为 adapter 共享的 persistence lifecycle core（MemoryPersistence 与 FilePersistence 共用，不得复制状态机）；两 Adapter 必须通过同一组 createDoc shared contract tests。」「`saveDoc` 的『脏通知 + 内部调度』语义不变，首个 saveDoc 仍是合法写入路径。」
  - Cordis 插件条款：「`DocPersistence` 是 Cordis service Interface……service 是 Host 长生命周期资源，DocHandle 是请求/命令/WS 连接等短 scope 的 lease」「`MemoryPersistence` 与 `FilePersistence` 是两个真实 Adapter（两个 Adapter 证明 seam 不是假想抽象）」「插件实现只依赖 Cordis、Yjs 与持久化 contracts，**不得 import DSH 或 NomicoreServer app**」「dispose 时释放文件句柄、后台任务和 Y.Doc 缓存；宿主负责按依赖逆序停止插件。」

### ADR 0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted）

- 与本任务的关联点：本任务的「Runtime 写前 gate + mutation 通过后 saveDoc 标脏」正是本 ADR Runtime 编排边界条款的具体化；Persistence 职责边界条款约束 `getStatus()` 的归属
- 核心条款（原文摘录）：
  - 「NamespaceRuntime 将来按 namespace 串行化所有业务写入：轮到 mutation 时先检查 writable gate，同步调用 `applyValidatedMutation`，成功后立即调用 persistence `saveDoc` 标脏。业务调用方不得取得可写 Yjs 引用或绕过该入口；未来原始 Yjs update 必须另设受控验证通道。」
  - 「普通 open 必须依次完成 schema 编译、META 身份检查、ROOT 载体提取和逻辑校验；任一失败都不注册 Runtime，并释放底层 DocHandle。Registry 中存在的 Runtime 因而始终满足完整不变量。」
  - 「Persistence 仍只管理 Y.Doc 存储、cache、flush 与 retry；VFSL 仍是纯逻辑引擎；Server/NamespaceRuntime 负责组合二者。」

## 设计引入的新决策点（Phase 2 设计后复审追加，SA8）

> 摘自 `wiki/raw/task_issue-79_design.md`（SA1 R0）。这些是设计新增、将随 §6 修订节落回 ADR 0006 的契约面；SA2/SA3/SA4 以设计文档原文为准，本节只摘录索引。

- **DocHandleStatus 词表与优先级**（设计 §2.1/§2.2）：`'ready' | 'persistence-degraded' | 'released' | 'disposed'`；优先级「`disposed` > `released` > entry 状态」；`ready` 含 flush 在途；`getStatus()`「只表示调用瞬间状态，不承诺后续 flush 成功」。措辞随 ADR 0006 修订节一并冻结。
- **saveDoc 职责收窄**（设计 §3.2）：degraded 不再是 saveDoc 拒绝理由——「只要租约有效（未 released、非 foreign、身份匹配、Persistence 未 disposed），saveDoc 必须递增 dirtyGeneration 并 resolve」；拒绝面仅剩租约身份失效与 disposed（AC6 四类护栏不变）。
- **降级窗口调度纪律**（设计 §3.4，边界判读）：「任一时刻一个 entry 至多有一个活跃调度源——健康态 = debounce+maxDirty 对；降级等待态 = retry 计时器；单飞态 = flush 持锁」；retry 退避上限 `maxDirtyMs`，5s 尝试上界不降级；已写入 §6 修订节第 2 条末款。
- **ADR 0006 修订节草案落点与体例**（设计 §6）：文末追加于「supersede 裁决撤销」节之后；节标题「DocHandle entry status 与 saveDoc 职责修订（2026-08-22，issue #79；演进经 owner 裁决放行）」——owner 裁决标注的记录准确性见设计复审报告 R1 备注。
- **探针观察面演进**（设计 §4，非 ADR 冻结面）：dsh-persistence 事件词表 `write-rejected` → `save-degraded`；S4 哨兵改以 entry 级 `getStatus()` + degraded 窗口 saveDoc resolve 为断言面。
- **seedForTest 收窄**（设计 §3.3，测试 seam，不在 ADR 接口面内）：degraded entry 上签发租约从 throw 改为正常签发（handle 报 degraded）。

设计后复审裁决：`wiki/raw/task_issue-79_design_conflict_report.md` — **Verdict: `clear`**（hard-violation 0 / override 0 / 新 evolution 0；前置冲突点 #1 已放行且落地合规）。

## CONTEXT.md 相关术语与惯例

- `命名空间（namespace）`：「一个 Y.Doc 连同自带的 `SCHEMA` 信封与数据；schema 随数据走，不依赖代码模块。」——ADR 0006「save 失败按 doc 只读降级 / namespace 进入 `persistence-degraded`」在此语义下即 per-`(owner, docId)` entry 粒度；任务要求「状态查询对应具体 entry，不以 Adapter 聚合状态代替」与该粒度对齐。
- `零写入（zero-write）`：「校验失败 → 400 且文档不变；所有写入口走同一条管线。」——写前 gate 的拒绝路径发生在任何 Y.Doc 写入之前，应延续该纪律（文档不变、响亮拒绝）。
- `信封（envelope）`：「`SCHEMA` 键（doc 顶层具名条目，原 `__schema__`——与 ROOT 统一命名）里的 `{ lang, version, id, text }`；单字符串值，原子替换、可哈希、可 diff。」——ADR 0006 三条目布局（SCHEMA/META/ROOT）中的 SCHEMA 条目；本任务不改动其内容，flush 以完整 Y.Doc 状态整体持久化。
- `作用域绑定（DocScope）`：「每个命名空间绑定自己的方言解释器、规则集与编译缓存；多方言并存不需要进程级『当前版本』。」——ADR 0006「与 DocScope 正交汇合」条款所指的邻接能力；本任务不触及。
