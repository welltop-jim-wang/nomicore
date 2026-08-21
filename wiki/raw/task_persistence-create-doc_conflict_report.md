# 冲突门禁报告

- 被审对象：`wiki/raw/task_persistence-create-doc.md`（MABF Task: DocPersistence createDoc
  ——排他创建、owner 语义与首快照提交；Issue #64）
- 冲突基准：`docs/adr/` 全集（6 篇，逐篇全读）+ `CONTEXT.md`
- 门禁类型：第 0 阶段前置门禁（SA 派发前）
- 产出时间：2026-08-21；SA8 只读裁决，未改动任何被审文件

## Verdict

`conflict`

**裁决分布：2 条 evolution（上报 Jim 裁决）、0 条 hard-violation、0 条 override-declared、
其余全部 no-conflict。无自动停止项——按四级裁决表，evolution 不停机，但 C1/C2 须 Jim 裁决
后方可视为放行。**

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0006 | Cordis 持久化插件——DocPersistence 接口与 doc 三条目内容布局 | accepted | **是（核心）** | 2 条冲突点（C1、C2，均 evolution）；其余条款逐条对照为 no-conflict（见下） |
| ADR-0001 | VFSL 文本是 schema 的唯一真相源（含 2026-08-19 修订节） | accepted | 是（边界） | no-conflict：本任务不涉仓内 schema 文本，SCHEMA 信封按数据原样存取 |
| ADR-0002 | nomicore 是全新 yjs-server 重写，authority 完全出范围 | accepted | 是（边界） | no-conflict：Out of scope 明确排除 accessor/ACL/sharing/auth，与「不保留接口」一致 |
| ADR-0003 | 求值器与派生 schema（evaluate 接缝、ROOT 约定） | accepted | 是（弱） | no-conflict：「不校验 VFSL/ROOT」与持久层看不见 schema 语义互为印证 |
| ADR-0004 | vfsl-protocol 类型协议包 | accepted | 否 | no-conflict：编译期投影领地，与本任务无交集 |
| ADR-0005 | 投影生成管线（SchemaSource/生成器） | accepted | 否 | no-conflict：Phase 1 生成管线领地，与本任务无交集 |

无 superseded ADR（ADR-0003 所「取代」的是未入库的同号草稿，不构成基准豁免项）。

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| C1 | high | ADR-0006：「**创建 = 首个 saveDoc**：loadDoc 不存在返回 null，调用方自建 Y.Doc 写入初始内容后以有效 handle 首次 saveDoc 即完成创建（**无独立 createDoc**）」 | 简报 What to build：「扩展 `DocPersistence`：`createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle>`」；Required semantics：「`createDoc` 对 `(owner.userId, docId)` 排他创建；cache/store 已存在或并发创建时稳定地返回 duplicate 错误，不覆盖」「创建成功前初始完整 snapshot 已提交；FilePersistence 以 temp → rename 完成为提交点」 | **evolution** | 本任务的意图就是修订「无独立 createDoc」这条决策（新增独立 createDoc API、排他/错误码/同步提交点语义），且 load 侧配套「create 取得创建权后 load 不得错误返回 null」改变了「loadDoc 不存在返回 null」的并发边角；但简报全文未出现任何「取代 ADR-0006 / supersede」声明，也未给出推翻理由——不满足 override-declared，又属有意修订决策而非无意识违反，落 evolution |
| C2 | medium | ADR-0006 接口定义（决策节原文代码块）：`interface DocHandle { readonly user: User; readonly docId: string; readonly doc: Y.Doc; release(): Promise<void>; }` | 简报 What to build：「同时将 `DocHandle.user` 改为 `DocHandle.owner`」；Required semantics：「`DocHandle.user`、内部 Entry 参数/字段、契约测试和文档统一迁移为 owner 语义」 | **evolution** | 对 ADR 冻结的公共接口契约做字段级改名并全链迁移，是对该 ADR 接口条款的直接修订；但语义主张（owner=存储所有者、仅分区键、本层不鉴权）与 ADR-0006「user 仅作分区键：本层不鉴权」完全一致，且 ADR-0006 自身存储节已改用 owner 术语（「`owner` 仍不写入 META（用户归属由目录分区承载）」「`owner` 暂不入 META」）——属术语对齐式的契约演进，未走正式修订声明，落 evolution |

### 逐条 no-conflict 对照（ADR-0006 其余条款，供 SA1/SA2/SA3 复用）

| 简报要求 | ADR-0006 条款 | 结论 |
|---|---|---|
| 「Persistence 仅校验 `META.docId === docId`，不校验 VFSL/ROOT/createdAt」 | 「持久层……看不见 schema 语义（VFSL/校验规则属引擎领地）」「`META.createdAt` 由上层 namespace lifecycle 生成和维护；持久层不生成、不修改、不校验该字段（持久层只校验 META.docId）」 | no-conflict（逐字对齐） |
| 「FilePersistence 以 temp → rename 完成为提交点，不新增 fsync 保证」 | 「写入 `{namespaceId}.snapshot.tmp` 后以原子 rename 覆盖 `{namespaceId}.snapshot`」「rename 成功即完成一次 flush：v1 不对每次 flush 做 file/directory fsync」 | no-conflict |
| 「成功时签发有效 lease，`handle.owner === owner` 且 `handle.doc === doc`，Persistence 接管 doc 生命周期」 | 「引用计数 + 身份校验：每个 handle 对应一个不可伪造的 lease……」「共享 doc，独立 handle」 | no-conflict（lease 框架沿用；「接管 doc 生命周期」为 C1 新 API 的从属语义） |
| 「失败时不返回 handle、不缓存、不销毁传入 doc，所有权仍归调用方」 | 无相反条款（flush 失败降级条款不触及 create 失败路径） | no-conflict（新增语义，无基准条款相反） |
| 「duplicate 必须有稳定 error code 或专用错误类型」 | 无相反条款 | no-conflict（新增语义） |
| 「create/create 与 create/load 共享 per-key coordination」 | 「并发加载合流：同一 `(userId, docId)` cache miss 时只创建一个内部 loading Promise……」 | no-conflict（per-key 合流框架既有，create 侧为 C1 扩展） |
| 「不同 key 的操作不互相串行」 | 无相反条款（ADR 未规定全局串行） | no-conflict |
| 「A owner / B accessor 场景中 Persistence 只接收 A；A/doc1 与 B/doc1 保持隔离」「访问者授权不进入 Persistence Interface」 | 「user 仅作分区键：本层不鉴权……存储按用户分区，namespaceId 在用户目录内唯一」 | no-conflict |
| 「共享 lifecycle core……MemoryPersistence 与 FilePersistence 通过同一组 createDoc shared contract tests，不得复制并发状态机」 | 「`MemoryPersistence` 与 `FilePersistence` 是两个真实 Adapter」「实施顺序……2. MemoryPersistence 插件 + contract tests」 | no-conflict（contract tests 机制既有，共享 core 为实现组织决策，ADR 不约束） |
| 「保持 `saveDoc` 仅登记 dirty、异步调度的现有语义」 | 「saveDoc = 脏状态通知，不是同步落盘」「持久层内部调度……max-dirty 5s / debounce 500ms」 | no-conflict（明确保留） |
| Out of scope：list | 「v1 不提供 list：per-user 枚举用到再补」 | no-conflict |
| Out of scope：SCHEMA/META/ROOT 初始化、owner transfer、persistence health events | 「`owner` 暂不入 META」；v1 无相关条款 | no-conflict |

## 结论

1. **Verdict = `conflict`，但无 hard-violation**：不触发自动停机。冲突实质是本票对
   ADR-0006 的两处**有意演进**：
   - **C1（high）**：以独立 `createDoc` 取代「创建 = 首个 saveDoc（无独立 createDoc）」；
   - **C2（medium）**：`DocHandle.user` → `owner` 契约改名（语义不变，ADR 自身术语已漂移）。
2. **需 Jim 裁决的条目**：C1、C2。建议裁决形式：确认演进意图后，随本票（或先行）对
   ADR-0006 落正式修订节（如 2026-xx-xx「createDoc 与 owner 语义修订」）或以新 ADR
   supersede 对应条款；SA1 设计文档须引用修订后的条款而非旧接口文本，否则 SA2 复审会再次
   撞上同一冲突。
3. **无需 override 的条目**：其余 13 项对照全部 no-conflict，其中「仅校验 META.docId」
   「temp→rename 提交点、不新增 fsync」「saveDoc 语义保留」「分区隔离/不鉴权」与 ADR-0006
   逐字一致，全链 SA 可直接按 `_relevant_decisions.md` 摘录执行。
4. **输入完整性备注（非冲突）**：简报引用的 PRD `docs/prd/persistence-create-doc.md`
   在本 worktree 不存在（`docs/` 下无 `prd/` 目录）。本裁决仅覆盖简报正文；若 PRD 补入且
   含超越简报的要求（尤其触及 C1/C2 的语义细节），需对本报告做增量对照。
