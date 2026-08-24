# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出（round 2 修订轮，issue #91）。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 被审对象：`wiki/raw/task_namespace-runtime-replace-schema-rev1.md`。

## 相关 ADR

### ADR 0008 NamespaceRuntime 读写能力与单序列器（accepted）

- 与本任务的关联点：本任务修复 `replaceSchema` provided-root 路径的静默投影偏差，核心基准即本 ADR 的 SCHEMA write 第 3 条。
- 核心条款（原文摘录）：
  - §ROOT write 与 SCHEMA write，第 3 条（:69）：「提供 `root` 时，将其视为最终完整 logical ROOT snapshot，验证并 detached 构造完整新内容；」
  - 同节失败语义（:75）：「新 SCHEMA 的编译、最终 ROOT 校验或 detached 构造失败均发生在 transaction 前，SCHEMA/ROOT 零写入，active tools 不变。」
  - §单一 write sequencer，槽序（:45）：「每个真正写任务的槽依次执行：lifecycle/fatal gate、`DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务。」
  - 同节快照时点（:43）：「写方法调用时同步决定接纳顺序。输入引用在排队期间可以变化；任务取得槽后立即用受控 snapshotter 复制并递归冻结 plain data，之后编译、校验、构造和提交只使用该内部快照。」
  - §Fatal 与失败通道（:79）：「普通、可预期且零写入的读取或写入失败使用领域化结果联合；ROOT mutation 与 SCHEMA replacement 使用各自独立的窄 issue 类型，不形成巨型 write issue。」
- 注意：第 2 条「未提供 `root` 时，按 proposed derived 严格提取并验证当前 ROOT」的提取投影**仅限 keep-root 分支**，不构成 provided-root 分支的投影授权；ADR 0008 全文无任何 provided-root 投影条款。

### ADR 0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted；Runtime/open/read 条款由 ADR 0008 部分取代）

- 与本任务的关联点：ADR 0008 明示沿用的底层决策是本任务失败契约的下层依据。
- 沿用条款（原文摘录）：
  - ADR 0008 §取代关系（:111）：「ADR 0007 关于 logical validation、detached materialization、validated mutation、零写入和 observer no-rollback 的底层决策继续有效。」
  - 0007 :14：「`validateSnapshot` 直接更名为 `validateLogicalSnapshot`，不保留兼容 alias；它只接受普通 JSON logical ROOT snapshot，不接受 Y.Doc/Y.Map/Y.Array。」
  - 0007 :25：「`materializeRoot(derived, snapshot, doc)`：唯一公共物化入口；内部先执行 `validateLogicalSnapshot`，再构造未集成到任何 doc 的 detached Yjs 子树，确认目标 ROOT 为空后以一次 `Y.transact` 安装。验证或构造失败时目标 doc 零写入；不覆盖、不合并、不 fallback。」
  - 0007 §失败边界（:54）：「零写入承诺覆盖所有验证失败和 detached 构造失败。Yjs observer 不得向事务调用栈抛异常；Runtime 自有 observer 必须记录或异步上报。」

## CONTEXT.md 相关术语与惯例

- `封闭对象`（:90-91）：「子集内对象类型默认封闭：未声明字段拒绝。」
- `零写入`（:81-82）：「校验失败 → 400 且文档不变；所有写入口走同一条管线。」
- 修订目标条目 `顶层声明域投影`（:17-19，现行文本）：「`replaceSchema` 提供 `root` 时，root 先投影到 proposed schema 结构树**顶层**声明键集：未声明顶层键不进入新 generation（静默剥离……）；嵌套层未声明键保持响亮拒绝……」——该条目按简报第 5 条属本轮修改对象（删除或改写为「provided root 原样封闭校验、未声明键响亮拒绝」），其裁决见冲突报告，不作为本轮的约束基准。

## 设计引入的新决策点（第 2 阶段设计后复审追加，待 SA3 实现落盘后生效）

> 来源：`wiki/raw/task_namespace-runtime-replace-schema-rev1_design.md`。摘录供 SA2/SA3/SA4 复用；其与 ADR 基准的一致性裁决见 `task_namespace-runtime-replace-schema-rev1_design_conflict_report.md`。

- **单形态喂值纪律（设计 D1/D2/D3）**：①d replace-root 分支的 validate（`validateLogicalSnapshot`）、detached 构造（`buildTopEntries`）与 ④ ⑥ `verifySnapshotIntact` 三处消费**同一原样 (derived, snapshot) 输入对**（`PreparedSchemaReplace` 字段 `narrowed` 更名 `snapshot`，语义从投影形态翻转为原样引用）。取代 round 1「⑥ 必须喂 narrowed」推论（其论证依赖旧管线 validate/build 消费 narrowed 的前提，随投影废止失效）。
- **CONTEXT.md 术语更替（设计 D7）**：「顶层声明域投影」条目（:17-19）改写为「原样封闭校验（provided-root as-is closed validation）」，`_Avoid_` 显式标记旧术语为 round 1 自创已废止语义；round 1 登记的「被剥离键 advisory 上报」随剥离语义消亡作废。
- **公共 JSDoc 契约段（设计 D6）**：`packages/namespace-runtime/src/schema-write.ts` `ReplaceSchemaInput.root` 的「未声明顶层键被剥离且 ok:true」段改写为「未声明键一律响亮拒绝（顶层与嵌套同族），ok:false + path=[<k>]，零写入、SCHEMA/ROOT/active tools 不变」。
