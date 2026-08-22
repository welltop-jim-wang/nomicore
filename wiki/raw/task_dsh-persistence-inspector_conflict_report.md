# 冲突门禁报告

> 被审对象：`wiki/raw/task_dsh-persistence-inspector.md`（第 0 阶段前置门禁 · 任务简报）
> 冲突基准：`docs/adr/` 0001–0006 全集（6/6 逐个全读，无抽样）+ `CONTEXT.md`
> 产出者：SA8 Conflict Gatekeeper；配套文档：`task_dsh-persistence-inspector_relevant_decisions.md`

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源，只存在于文档与测试中 | accepted（含 2026-08-19 修订节） | 弱相关 | 无冲突：任务不新增仓内 schema 源文件、不做 codegen；inspector 探针属开发/测试工具，对 SCHEMA 条目的消费属「测试 fixture 除外」与「运行时数据」范畴 |
| ADR-0002 | nomicore 是全新 yjs-server 重写，authority 完全出范围 | accepted | 否 | 无冲突：任务不触及 `__authority__`/旧系统接口 |
| ADR-0003 | 求值器与派生 schema——evaluate 接缝、ROOT 根别名约定、联合的分支列表表示 | accepted | 弱相关 | 无冲突：任务不改求值器/派生 schema 公共契约；仅间接受 ROOT 固定物化 Y.Map 事实约束（探针构造 doc 时） |
| ADR-0004 | vfsl-protocol 类型协议包——编译期路径投影的五个设计决策 | accepted | 否 | 无冲突：类型投影不在本任务改动面 |
| ADR-0005 | 投影生成管线——SchemaSource 接缝、生成器输入契约、生成物入仓 | accepted | 否 | 无冲突：SchemaSource/生成器/CI 新鲜度校验不在本任务改动面 |
| ADR-0006 | Cordis 持久化插件——DocPersistence 接口与 doc 三条目内容布局 | accepted（含 2026-08-21 createDoc/owner 语义修订节） | 直接相关 | 无冲突：本任务即其实施顺序第 4 步「DSH 开发 profile + inspector 探针」；简报 8 条验收逐条与 ADR 条款对应（见下表），无一条违反现行条款（含修订节） |

无整份 superseded 的 ADR；ADR-0006 正文两处早期条款（「创建 = 首个 saveDoc」、旧接口签名）被其自身修订节取代，不再构成约束——简报未依赖任何被取代条款。

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | 无 hard-violation / evolution / override-declared 条目 |

### 验收条款对照明细（可复核）

| 简报条款 | 对应 ADR-0006 条款（现行） | 结论 |
|---|---|---|
| 「DSH 作为 Cordis 开发宿主加载 P1–P3 的同一持久化插件实现」 | 「持久层先作为宿主无关的 Cordis 插件在 DSH 中开发、调试和验证，之后由 NomicoreServer 加载同一插件实现——不为 server 重写第二份持久化逻辑」 | no-conflict |
| 「inspector 只消费 DocPersistence service，不得成为核心插件依赖」 | 「`DocPersistence` 是 Cordis service Interface……」「DSH 与 NomicoreServer 都只是 Cordis Host：前者装调试/inspector 插件，后者只装生产插件集合」 | no-conflict |
| ①「DSH profile 可选择 MemoryPersistence 或 FilePersistence Adapter（同一 contracts、零条件分支）」 | 「`MemoryPersistence` 与 `FilePersistence` 是两个真实 Adapter（两个 Adapter 证明 seam 不是假想抽象）」 | no-conflict |
| ②「load → saveDoc 标脏 → 受控时钟/可观察调度触发 flush → release；重复 load 同 doc、不同 handle」 | 「共享 doc，独立 handle……每次 load 返回独立 DocHandle/lease」「saveDoc = 脏状态通知，不是同步落盘」「持久层内部调度：不设外部 flush/cron 协调器……默认值可由插件配置覆写」 | no-conflict（「受控时钟」与「默认值可由插件配置覆写」相容；探针须止于观察，不得成为外部 flush 协调器——见结论提示 3） |
| ③「userA/doc1 与 userB/doc1 隔离、META.docId 校验、SCHEMA/META/ROOT 三条目可观察」 | 「存储按用户分区，namespaceId 在用户目录内唯一」「`META.docId` 必须等于请求的 namespaceId；不一致视为持久化损坏并响亮失败」「doc 内容布局（三条目）」 | no-conflict（标识取值须符合安全文法——见结论提示 2） |
| ④「save 失败后 `persistence-degraded`、后续写拒绝、retry 成功恢复的探针记录完整」 | 「失败后 namespace 进入 `persistence-degraded`，保留读/查询与已同步状态，拒绝**后续** REST/WS 写入……由持久层内部 retry 持久化，retry 成功后才恢复可写；不关闭整个 server」 | no-conflict（观测面映射见结论提示 4） |
| ⑤「release 后由持久层内部决定真实 evict，probe 可观察引用归零与最终释放」 | 「release = 不再使用通知……仅在保存成功、缓存/空闲策略满足后才真正释放实例，调用方不直接控制释放时刻」「引用归零仅使缓存项成为可驱逐候选，不立即释放」 | no-conflict（简报为该条款的同义复述） |
| ⑥「插件 reload/dispose 后无文件句柄、timer、监听器、Y.Doc cache 残留」 | 「dispose 时释放文件句柄、后台任务和 Y.Doc 缓存」「插件采用工厂/实例模型……以支持测试隔离、不同 rootDir 与 HMR/reload」 | no-conflict |
| ⑦「持久化核心插件源码不 import DSH；DSH wrapper/profile 保持薄 Adapter」 | 「插件实现只依赖 Cordis、Yjs 与持久化 contracts，**不得 import DSH 或 NomicoreServer app**」 | no-conflict（同义复述） |
| ⑧「探针结果形成可复制的命令 + 输出记录（供后续 NomicoreServer Host 复用验收）」 | 实施顺序「4. DSH 开发 profile + inspector 探针；5. 上述插件在 DSH 调通后才启动 NomicoreServer 极薄 Cordis Host」 | no-conflict（复用的是记录文档，非把 inspector 装入生产 Host，不违反「后者只装生产插件集合」） |

裁决分布：no-conflict × 11（含 3 条简报正文要求），override-declared × 0，evolution × 0，hard-violation × 0。

## 结论

**Verdict: clear，放行进入 SA1 设计。** 无需 override 声明，无需上报 Jim 裁决的条目。

以下为对照中发现的**非冲突落地提示**（简报措辞与 ADR 现行条款存在映射缝隙，属 SA1 设计需覆盖的问题，不构成阻塞）：

1. **创建路径**：简报流程「load → saveDoc 标脏 → …」默认 doc 已存在。「创建 = 首个 saveDoc（无独立 createDoc）」旧条款已被 ADR-0006 修订节**取代**——新建 doc 须走 `createDoc(owner, docId, doc)` 排他创建（`DOC_DUPLICATE`、绝不覆盖已提交 snapshot）。探针 setup 不得按旧条款用首个 saveDoc 建新 doc。
2. **标识安全文法**：userId/namespaceId 共用 `^[a-z][a-z0-9-]{0,62}$`。简报中「userA/userB」为示意名（含大写，不合文法）；落地应取 `user-a`/`user-b` 等合规标识。
3. **受控时钟边界**：计时器默认值（max-dirty 5s / debounce 500ms）「可由插件配置覆写」支持受控观察；但「不设外部 flush/cron 协调器」是现行条款——inspector 不得引入强制 flush 命令面或外部调度器，只观察内部调度。
4. **`persistence-degraded` 观测面**：ADR 将「拒绝后续写入」表述在 namespace/REST/WS 层；DSH 无 REST/WS 面。探针如何在仅消费 DocPersistence service 的前提下记录「后续写拒绝 → retry 恢复可写」由 SA1 设计（例如经 saveDoc/lease 拒绝路径观察），须与「持久层内部 retry 直到成功或插件停止」条款相容。
5. **术语并置**：CONTEXT.md 以 `__schema__` 指称信封所在，ADR-0006 三条目布局将顶层条目命名为 `SCHEMA`（简报沿用后者，为该领域现行决策）；探针实现引用条目名时以 ADR-0006 布局为准。

—— SA8 Conflict Gatekeeper，第 0 阶段前置门禁完成。
