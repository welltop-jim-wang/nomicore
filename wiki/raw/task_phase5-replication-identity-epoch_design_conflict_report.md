# 冲突门禁报告（设计后复审）

- 被审对象：SA1 设计 R1 `wiki/raw/task_phase5-replication-identity-epoch_design.md`（701 行，通读）
- 冲突基准：ADR 全集（10 份）+ CONTEXT.md——经前置门禁报告 `task_phase5-replication-identity-epoch_conflict_report.md` 与相关决议 `task_phase5-replication-identity-epoch_relevant_decisions.md` 复用；按技能要求不重复全量盘点，聚焦设计引入的决策点
- 专项确认：SA6 红灯记录 `task_phase5-replication-identity-epoch_sa6_red.md` 末尾「overflow 拒绝通道」提示（见专节）
- 复审日期：2026-08-27（run_id: issue-132-1787809226-3529662，round 1）

## Verdict

`clear`

## 设计决策点 × ADR 条款对照

| # | 设计决策（D-x/章节） | 相关 ADR/CONTEXT 条款（摘录锚点） | 对照结论 |
|---|---|---|---|
| 1 | D-2：第三类写槽 `replication` 与 mutateRoot/replaceSchema 共享同一 `WriteSequencer`，槽序 E1–E7 镜像 S1–S7（fatal gate → writable+notifier gate → 输入校验 → 领域事实读取 → 单 transaction → 同槽 await notifyDirty → 释放） | ADR 0008：「同一 namespace 内所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer」「每个真正写任务的槽依次执行：lifecycle/fatal gate、`DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务」 | 一致。E3 对不可变 string 输入以平面形状门替代深快照（string 无快照语义），槽序语义逐位等价；接纳层同步定序落实 ADR 0008「写方法调用时同步决定接纳顺序」 |
| 2 | D-2/E2：degraded / released / disposed / notifier 未绑定 / fatal 已置位 / lifecycle≠ready → `RUNTIME_WRITE_DISABLED` 零写入 | ADR 0008：「`persistence-degraded` 阻止 ROOT、SCHEMA 以及未来所有 Y.Doc 写」（「未来所有」明文预留新写类）+ 稳定码注册修订 #2 四类码域 | 一致。四类拒绝逐类落入既有码族，域区分靠 message（修订 #2 原文纪律） |
| 3 | D-6：overflow = 结果面 `ok:false`（`REPLICATION_EPOCH_OVERFLOW`），判据 `epoch >= MAX` 先于任何 +1，MAX+1 永不被计算/存储 | ADR 0010：「达到 `Number.MAX_SAFE_INTEGER` 后拒绝继续提升，不回绕」；ADR 0008：「普通、可预期且零写入的读取或写入失败使用领域化结果联合」；CONTEXT.md「复制代际」Avoid「可回绕版本号」 | 一致（专项确认见下节；判据先于 +1 ⇒ 无回绕面、无出域值） |
| 4 | D-9：transaction throw → 保守 `committed:true`；notify-dirty 失败 → `RuntimeWriteFatalError('notify-dirty-failed', true)` + E5.5 已提交事实不回滚；fatal 后续写零写入、读取保留 | ADR 0008：「committed:true 或未知异常保守视为可能已提交，在当前槽内 best-effort `notifyDirty()`，但始终 reject 原始 fatal」「不补偿、不 fallback、不声称 rollback」「任何 internal fatal……都永久关闭该 Runtime 的全部写能力并保留读取」 | 一致。committed 事实、fatal 语义、后续 `RUNTIME_WRITE_DISABLED`、读保留逐条镜像 |
| 5 | D-3：META 保留字段「部分存在 / 格式违约 / 载体异型」→ loud（构造 throw 零副作用 / 槽内 internal fatal committed:false），拒绝虚假降级 | ADR 0006：「`META.docId` 必须等于请求的 namespaceId；不一致视为持久化损坏并响亮失败」（同族先例） | 一致。无任何 ADR 条款要求保留字段损坏静默降级；loud 属 docId 损坏纪律同族 |
| 6 | D-4：status 增第八键 `replication`（两态联合、无第三态、每次全新冻结、全生命周期投影） | ADR 0008：「Runtime 提供结构化瞬时 capability status……status 不暴露队列长度、任务类型或 sequence」「稳定且不含原始 Error/stack/SCHEMA 全文/ROOT 数据」；CONTEXT.md「停接纳」：getStatus 不在停接纳范围；ADR 0010：「网络状态保留在 ReplicationSession/复制插件，不塞入 Runtime 的业务 capability status」 | 一致（注记 2）。全部负面约束逐条满足；域内容为身份/epoch 持久事实，非网络状态，不预留 conflicted/bootstrap 键位 |
| 7 | D-1：随机源 = Registry 已注入 `randomBytes` 在 Lease 接纳段同步抽取，值输入传入 Runtime 写槽；Runtime 零随机依赖、`/internal` 2 参不变 | ADR 0009 修订节 3：「Registry 的构造能力增加必需的 `randomBytes(length): Uint8Array` 注入，生产 Host Adapter 使用 `node:crypto`，核心不得回退到全局随机源」；ADR 0010：replicationId「128-bit 随机值，编码为 32 个小写十六进制字符」 | 一致。零新注入点、零全局 fallback；编码无 `ns-` 前缀（该前缀仅属 namespaceId 生成面） |
| 8 | D-7：Lease 暴露两方法（ADR 0010 冻结名）；released → 既有 `RELEASED_ISSUE` 通道；随机源运行期违约 = 结果面 issue | ADR 0009：「Lease 是调用方唯一能力入口，代理 Runtime 除 `close()` 外的……」「release 后，除 `getStatus()` 外的操作通过其既有同步/异步结果通道返回稳定 `NAMESPACE_LEASE_RELEASED`」 | 一致（注记 5）。随机源违约通道归属（结果面 vs 编排级 fatal）无 ADR 强制条款，设计已文档化区分（§4.9-8），属设计裁量非冲突 |
| 9 | D-10：普通业务写 zero-touch 复制字段 = 结构性保证（mutateRoot 读写面钉死 ROOT 子树） | ADR 0006：「META/SCHEMA 作为 ROOT 的兄弟条目，天然在 validateSnapshot/validatePatch 的校验面之外（校验只作用 ROOT 子树）」；ADR 0010：「`META.replicationId` 与 `META.replicationEpoch` 只能由 hub 的显式复制管理操作修改」 | 一致。独占写面成立：唯一修改入口 = 两复制管理槽 |
| 10 | §4.1(d)：Hub-only 锚定 = 独占写面（与 replaceSchema 同层级暴露）；peer 角色拒绝属后续切片 | ADR 0010：「SCHEMA 只允许 hub 的本地 `replaceSchema()` 修改」；「Hub 检查 peer 对每个 namespace 的读取和提交权限」（授权面属 WS/复制插件，后续切片） | 一致（注记 3）。replaceSchema 同为 ADR 0010 明文 hub-only 且在既有基线即以同层级暴露——分阶段切片下架构同构 |
| 11 | D-5：幂等再 enable = `{ok:true}` 零事务零通知、身份/epoch 不变；bump 前置于 disabled → 结果面拒绝 | ADR 0006：「在 Doc **每次发生变更后**调用 saveDoc」（条件性义务）；ADR 0010：「`replicationId` 是 namespace 不可变的复制谱系身份」 | 一致。无变更无通知义务；幂等路径为 AC-3 二选一之合法取值（SA6 锚点 1 明文兼容） |
| 12 | §4.4：构造期 V2.5 纯读预投影（open 即诚实）；损坏 → open 响亮失败（`runtime-construction` fatal） | ADR 0008：「普通 open 不执行 schema、ROOT 载体或 logical validation」（排除面未被触碰——META 身份是读取投影非校验）；「P0 只读取 SCHEMA 标准四键……不读取、提取或验证 ROOT」（P0 职责不变）；ADR 0009：初始 fatal phase 含 `runtime-construction` | 一致。构造 throw 零副作用与既有构造序不变量同构；预启用种子文档 open 即 enabled（SA6 AC-1/overflow 用例依赖）由纯读满足 |
| 13 | §4.2：复制写与 schema 状态正交（preparing/unavailable 期照常接纳，排 P0 后） | ADR 0008：「早期写排在 P0 后」「正常 compile result failure 仅使 ROOT write unavailable；SCHEMA write仍可修复」 | 一致。schema 依赖仅系于 ROOT write；META 层写不在此依赖面，排队纪律照用 |
| 14 | D-12：ADR/CONTEXT/phase 文档零修订（纯落地）；Persistence/doc-runtime/vfsl 零改动 | ADR 0006 #131 对齐说明：「不修改本 ADR 任何 Persistence 契约条款……不新增跨 owner catalog」；ADR 0010 取代节：「不改变`saveDoc`仅为dirty notification、全量snapshot、owner目录分区」 | 一致（注记 4）。META 两键为 plain JSON 值随全量 snapshot round-trip，无 Persistence 面 changes |

## 冲突点

未发现 hard-violation、override-declared 或 evolution 级冲突。以下 5 条为对照中最接近冲突的注记（全部 no-conflict，不影响 Verdict）：

| # | 严重度 | ADR 条款 | 设计内容 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | 注记（前置门禁注记 1 的设计级复验） | ADR 0008：「v1 不提供 META 写」「v1 公开两个窄方法」 | Runtime 新增 `enableReplication`/`bumpReplicationEpoch` 两个公共写方法（写 META） | no-conflict | ADR 0010（更晚接受，Phase 5 权威）明文命名并授权两操作：「hub 对现有 namespace 通过显式 `enableReplication()` 原子写入复制身份并登记 dirty」「只能由 hub 的显式复制管理操作修改」——专用窄操作而非通用 META 写 API；设计同时保持零通用 META 写面（SA6 保持性守卫锚定）。前置门禁的 reconciliation 在设计级逐点兑现 |
| 2 | 注记（status 面扩展的条款张力，已消解） | ADR 0008 status 域枚举：「lifecycle、read、ROOT write、SCHEMA write，以及……schema、fatal、close issue 摘要」 | status 新增第八键 `replication` | no-conflict | 枚举是 v1 描述性清单而非封闭契约（同款措辞「v1 公开两个窄方法」亦为 v1 描述）；域内容由 ADR 0010 身份体系与任务 AC-5 驱动；ADR 0010「网络状态……不塞入 Runtime 的业务 capability status」反向蕴含非网络复制事实属 status 领地；全部负面约束（无队列/任务/sequence、无原始 Error、全生命周期可用）逐条满足。#92 加 close 键为同款 append-only 先例 |
| 3 | 注记（Hub-only 的分阶段锚定） | ADR 0010：「`META.replicationId` 与 `META.replicationEpoch` 只能由 hub 的显式复制管理操作修改」；CONTEXT.md「Peer」：「不能本地修改 SCHEMA 或复制身份」 | 本票无 peer 角色拒绝面（角色概念尚未进入代码库） | no-conflict | ADR 0010 的角色权限执行面在 WS/复制插件/authorization Adapter（「Hub 检查 peer 对每个 namespace 的读取和提交权限」），均属后续切片；本票可锚定面 = 独占写面，与 replaceSchema（ADR 0010 明文 hub-only、基线即存在）完全同层级——分阶段切片的一致锚定，非语义缺失 |
| 4 | 注记（前置门禁注记 2 的设计级复验） | ADR 0006 三条目布局：「META 元信息（Y.Map：docId, createdAt）」 | META 增两保留字段（AC-1） | no-conflict | ADR 0010 明文「`META` 增加两个复制层保留字段」；设计经 plain string/number 值 + getMetadata 深拷贝投影 + 全量 snapshot round-trip 落地，Persistence 契约与校验边界（仅 docId）零改动——与 DENY LIST 声明一致 |
| 5 | 注记（设计裁量的边界确认） | ADR 0010：「`replicationId` ……它不同于 namespaceId 和 SCHEMA 信封 `id`」（定义性区分）；CONTEXT.md「复制谱系」Avoid「用 SCHEMA id 充当文档实例身份」 | §4.9-1：不做 id ≠ namespaceId / ≠ SCHEMA id 的运行时强制（生成面结构性保证） | no-conflict | 该表述是三个身份空间的定义性区分，不是待强制的运行时不变量；wire 身份核对同时携带两者（ADR 0010/CONTEXT.md「只有 namespaceId、replicationId 与 replication epoch 全部匹配……」）；SA6 AC-1 的 `not.toBe` 断言由生成面（无 `ns-` 前缀 + CSPRNG）满足。是否值得加防御性校验属 SA2 设计优劣议题，非 ADR 冲突 |

## 专项确认：overflow 拒绝通道（SA6 记录末尾提示）

SA6 记录「SA1/SA3 对齐提示」末条：「**overflow 拒绝通道**：锚定为结果面 `ok:false`（写域失败经结果联合的仓库既有惯例，对照 mutateRoot/replaceSchema）；若 SA1 论证走 rejection 通道，需回流修订本记录与对应用例（SA8 设计复审时同步确认）。」

**确认结论：设计取结果面 `ok:false` 通道，与 ADR 语义一致（no-conflict）；无需回流修订 SA6 记录与用例。**

逐层依据：

1. **ADR 0010 只冻结语义，不规定通道**：「`replicationEpoch` 是 hub 显式提升的权威代际；达到 `Number.MAX_SAFE_INTEGER` 后拒绝继续提升，不回绕」——「拒绝继续提升」+「不回绕」是行为契约；实现通道（结果联合 vs rejection）留给下层。
2. **通道归属由 ADR 0008「Fatal 与失败通道」节明文裁决**：「普通、可预期且零写入的读取或写入失败使用领域化结果联合；……结果联合外 internal failure使用……fatal」。overflow 满足全部三要件：普通且可预期（epoch 到达确定性域边界，非基础设施故障）；零写入（设计 E4 判据 `epoch >= MAX` 先于任何 +1 运算与 transaction——INV-R4 保证 epoch 永不出域）；写入失败（bump 是写操作）。→ 结果联合是 ADR 明文规定的通道。
3. **反向验证（rejection 通道反而违 ADR）**：结果联合外的 rejection 载体是 `RuntimeWriteFatalError`（internal fatal），而 ADR 0008 规定「任何 internal fatal——无论 committed 与否——都永久关闭该 Runtime 的全部写能力并保留读取」。把预期的域边界拒绝走 fatal 通道，会把一次普通的 overflow bump 升格为该 namespace 永久禁写——与 ADR 0008 fatal 语义直接矛盾。因此结果面不仅是兼容选择，而且是**唯一**与 ADR 0008 一致的选择。
4. **不回绕的实现性兑现**：判据先于 +1 ⇒ `MAX+1` 永不被计算、永不入存储（无浮点精度回绕面）；MAX-1 → bump 写 MAX（安全整数）→ 再 bump 拒——与 ADR 0010「达到 MAX 后拒绝继续提升」逐字对齐，与 CONTEXT.md「复制代际」Avoid「可回绕版本号」一致。
5. **与 SA6 锚定的对齐**：设计 D-6 与 SA6 锚点 1（「overflow 领域拒绝以 `ok:false` 结算（结果面拒绝，绝不回绕）」）及 AC-4 两条 overflow 用例（MAX 拒升 / MAX-1 边界）完全同向——SA6 预设的「若走 rejection 需回流」分支未触发，红灯用例与记录零回流。

## 结论

**Verdict: clear —— 设计与 ADR 决策集一致，可进入 SA2 全维度攻击评审。**

- 冲突点统计：5 条对照注记，裁决分布 = no-conflict × 5；hard-violation 0、override-declared 0、evolution 0。前置门禁 4 条注记全部在设计级复验兑现。
- 专项确认：overflow 拒绝通道（结果面 `ok:false`）与 ADR 0010 语义 + ADR 0008 失败通道条款一致；SA6 红灯记录与用例无需回流。
- 两条条款张力（注记 1/2：写面扩展、status 扩域）均由 ADR 0010 明文授权或蕴含，且设计保持 ADR 0008 全部负面约束与安全不变量（唯一 sequencer、committed 事实、不回滚、读保留、码域纪律）。
- 设计引入的新决策点已追加登记至 `task_phase5-replication-identity-epoch_relevant_decisions.md`「设计后复审追加」节（10 条，含 ADR 锚定原文），供 SA2/SA3/SA4 复用。
- 边界确认：设计不触碰 WS transport / ReplicationSession / bootstrap / archive / 角色权限（后续切片），不新增 Persistence 面——与任务简报边界提示及 ADR 0010 切片划分一致。
- 越界声明：replicationId ≠ namespaceId 是否加防御性运行时校验、随机源违约通道的 fatal-vs-issue 取舍等属设计优劣判断，归 SA2；本报告仅裁决 ADR 一致性。
