# 冲突门禁报告（设计后复审 · Phase 2）

> 被审对象：`wiki/raw/task_dsh-persistence-inspector_design.md`（SA1 架构设计，首轮 R0）
> 冲突基准：`docs/adr/` 0001–0006 全集（Phase 0 已全读；本次不重复全量盘点，基准条款见 `task_dsh-persistence-inspector_relevant_decisions.md`）+ `CONTEXT.md`
> 专项裁决请求（总控）：设计 §9 提出修订 SA6 两条测试断言（断言目标值不变，仅修时序基础设施）是否违反 ADR-0006 任何条款
> 产出者：SA8 Conflict Gatekeeper

## Verdict

`clear`

## 专项裁决：设计 §9 的 SA6 测试修订（R1）

**裁决：no-conflict——不违反 ADR-0006 任何条款；亦不构成 evolution（测试修订无修订 ADR 决策之意图，被修正的两个时序假设从来不是 ADR 条款）。**

逐条款核对（修订后测试仍验证的语义 ↔ ADR-0006 现行条款）：

| ADR-0006 条款（现行原文摘录） | 修订后测试行为 | 核对 |
|---|---|---|
| 「失败后 namespace 进入 `persistence-degraded`，保留读/查询与已同步状态，拒绝**后续** REST/WS 写入」 | AC4-file 用例两处 `getStatus()` 断言前插入 `settleRealIo()`（真实事件循环轮转），断言目标值 `toBe('persistence-degraded')` / `toBe('ready')` **一字未改**（test 372/378 行）；`saveDoc` 拒绝与恢复断言（373/379 行）原样 | ✓ 仍逐字验证 degraded→拒绝→恢复语义；等待只是让 libuv 线程池上的真实文件 I/O 在断言前结算 |
| 「retry 同属持久层内部，以退避策略重试直到成功或插件停止」 | 测试推进**虚拟时钟**让内部 retry 计时器到期；无任何外部重试/flush 指令 | ✓ retry 仍由持久层内部调度驱动 |
| 「持久层内部调度：不设外部 flush/cron 协调器。……每次 saveDoc 重置 debounce 计时器……任一到达即发起 flush」 | AC6 修复配方 `advanceBy(debounceMs)` 让 debounce 计时器**自然到期**发起 flush——走 ADR 定义的正典内部调度路径；非强制 flush | ✓ 不引入外部协调器 |
| 「dispose 时释放文件句柄、后台任务和 Y.Doc 缓存」 | AC6 修复在 dispose **前**让调度完成提交；dispose 本身语义零改动（SA1 §9 明确拒绝「core dispose 加 flush-dirty」黑帽路径）；`pending=0`/`isDestroyed`/service undefined/无 `.tmp`/无 fd 断言全部保留 | ✓ dispose 仍只清理资源；ADR 对 dispose 无 flush 义务条款 |
| 「release = 不再使用通知：……仅在保存成功、缓存/空闲策略满足后才真正释放实例」 | AC6 走 dispose 路径（非 release 归零路径），与该条款正交 | ✓ 无触碰 |

- **断言目标值核实**（test 文件实测读取）：`dsh-profile-acceptance.test.ts` 372 行 `toBe('persistence-degraded')`、378 行 `toBe('ready')`、439 行 `get('rev')).toBe(1)` 等目标断言原样；371/377 行（缺陷 1）与 400–401 行（缺陷 2）为纯插入的时序基础设施；文件头 21–24 行 R1 注释声明「仅修测试时序基础设施，断言目标值一字未改；修订后本文件仍整体红灯」——与设计 §9 配方逐字一致。
- **不可满足性证明的反向核验**：设计 §9 排除的三条黑帽路径若被采用**才会**违反 ADR——给 core dispose 加 flush-dirty（改 P3 行为契约）、写路径同步预检（改公共面）、包装调用方 timer（外部 flush 协调器，违反「不设外部 flush/cron 协调器」）。设计选择修测试，恰是唯一不触碰 ADR 的路径。
- **流程合规**（事实记录，裁决权在总控）：简报 §2 明文「SA6 固定，改动须与 SA6 协调」；R1 修订已按该条款经总控协调落盘（test 头注释记录 2026-08-22）。

## ADR 盘点（设计改动面对照；全量条款见 Phase 0 报告）

| 编号 | 状态 | 设计触碰面 | 对照结论 |
|---|---|---|---|
| ADR-0001 | accepted（含修订节） | 探针构造的 SCHEMA 信封为运行时 fixture 数据，不入仓（设计 §10） | no-conflict：「代码库不含 schema 文本（测试 fixture 除外）」 |
| ADR-0002 | accepted | 无触碰（探针零 authority 语义，§10） | no-conflict |
| ADR-0003 | accepted | ROOT 物化 Y.Map（`getMap('ROOT')` 消费，§6.2/§5） | no-conflict：不改求值器/派生 schema 契约 |
| ADR-0004 | accepted | 无触碰 | no-conflict |
| ADR-0005 | accepted | 无触碰 | no-conflict |
| ADR-0006 | accepted（含 2026-08-21 修订节） | 直接治理 ADR：宿主/插件边界、lease、调度、降级、evict、dispose、三条目、createDoc/owner | no-conflict：逐决策对照见下表；设计 DENY `packages/persistence/src/**` 与 `docs/adr/**`/`CONTEXT.md` 零改动，**无任何 override/supersede 声明** |

## 设计决策对照明细（ADR-0006 现行条款）

| 设计决策 | 对应 ADR-0006 条款 | 结论 |
|---|---|---|
| A 双层结构；探针不包装/不装饰 service，`ctx.get` 与 `profile.persistence` 同一身份 | 「service 是 Host 长生命周期资源」「插件通过 Cordis 提供/注入该 service」「插件采用工厂/实例模型而非全局单例」 | no-conflict |
| B memory 走 `memoryIo` 公开 dev/test 注入缝（简报 §2 明文认可）；file 走「受控时钟边界 + 提交态文件外部观察 + getStatus」；**不为 file 加 I/O 注入缝** | 「只有 `.snapshot` 是提交态」；不改 P3 公共面 =「插件实现只依赖 Cordis、Yjs 与持久化 contracts」边界精神 | no-conflict |
| B（失败注入）memory 钩子 throw / file `.tmp` 占目录 → EISDIR；内核自行 degraded + 内部退避 retry | 「save 失败按 doc 只读降级」「retry 同属持久层内部，以退避策略重试直到成功或插件停止」 | no-conflict：注入的是 I/O 失败，语义迁移全在内核内部 |
| C generation/refs 自持模型推演（数自己发的 saveDoc；`destroyed` 公共事件观察 evict） | 「每次 saveDoc 递增 dirtyGeneration」「引用归零仅使缓存项成为可驱逐候选」 | no-conflict：模型是公共行为的镜像，不窥探内部 |
| D `ProbeClock` 可推进契约；不可推进 timer → loud TypeError；探针只推进时钟，无 flush 命令面 | 「默认值可由插件配置覆写」「不设外部 flush/cron 协调器」 | no-conflict：推进时钟触发的是内部调度计时器，非外部协调 |
| E profile 配置冲突 loud-reject | 无对应 ADR 条款（DSH 侧装配校验）；与 ADR loud-fail 精神一致 | no-conflict |
| F dispose 顺序 adapter 先、Cordis fiber 后；幂等 | 「dispose 时释放文件句柄、后台任务和 Y.Doc 缓存；宿主负责按依赖逆序停止插件」 | no-conflict：profile 即宿主装配点，履行宿主停止职责；dispose 本身语义未变 |
| G release 间 1-tick 时钟推进 | 无对应 ADR 条款（场景脚本时序细节） | no-conflict |
| H create-commit 写不算 flush；retry 与首发同 generation | 修订节「创建成功前初始完整 snapshot 已提交（`Y.encodeStateAsUpdate(doc)` 直写）」＋「单飞 flush + generation 保序」 | no-conflict：与两条款逐字对应 |
| I 拒绝 core dispose 加 flush-dirty / 写路径同步预检 / 包装 timer 三条黑帽路径 | 分别会触碰 dispose 条款、公共面、「不设外部 flush/cron 协调器」 | no-conflict：设计明确排除违规路径 |
| §5 场景 S1–S4：createDoc 排他创建、`DOC_DUPLICATE`、meta-mismatch 响亮拒绝、degraded→write-rejected→recovered、evict 由内部 `maybeEvict`（clean 前置）决定、标识 user-a/user-b/doc-alpha/doc-degraded | 修订节 createDoc 语义、「META.docId 必须等于请求的 namespaceId；不一致视为持久化损坏并响亮失败」、「retry 成功后才恢复可写」、「仅在保存成功、缓存/空闲策略满足后才真正释放实例」、安全文法 `^[a-z][a-z0-9-]{0,62}$` | no-conflict：Phase 0 门禁提示 1/2/4 全部落实 |
| §6.2 外科式 `.tmp` 阻塞注入 | 「启动发现遗留 `.tmp` 时一律忽略并删除」是 adapter 对**遗留** `.tmp` 的处理规则；探针注入的是在途 flush 写入失败，不改变该规则 | no-conflict |
| §7–§8 模块面/记录规范/CLI | 无对应 ADR 条款；记录无环境痕迹支撑 AC8 复用验收 | no-conflict |
| §12 DENY `packages/persistence/src/**`、`docs/adr/**`、`CONTEXT.md` 零改动 | 「不得 import DSH 或 NomicoreServer app」（AC7 方向：依赖 dsh→persistence 单向） | no-conflict：设计未声明任何 ADR 修订意图 |

CONTEXT.md 对照：SCHEMA/META/ROOT 条目名（提示 5）、ROOT 物化 Y.Map、信封四键 fixture（lang/version/id/text）均一致；无冲突。

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | 无 hard-violation / evolution / override-declared 条目 |

裁决分布：no-conflict × 20（含专项裁决 §9 测试修订 1 条），override-declared × 0，evolution × 0，hard-violation × 0。

## 结论

**Verdict: clear，设计放行（SA2 全维度攻击评审照常进行，不因本报告减免）。**

1. 设计的全部架构决策落在 ADR-0006 现行条款框架内，零 override/supersede 声明，零 ADR/CONTEXT 改动意图（§12 DENY 自我约束与之一致）。
2. **专项裁决（总控点名）**：§9 SA6 测试修订（R1，两处时序基础设施插入 + 断言目标值不变）**不违反 ADR-0006 任何条款**——被修正的「真实文件 I/O 在纯微任务排空内结算」「dispose 前 flush 脏数据」两个假设均非 ADR 条款内容（ADR 从未规定 dispose 须 flush；flush 仅由内部调度触发）；修订后测试仍逐字验证 degraded→拒绝→retry→恢复、dispose 卫生、已提交快照 reload 还原等 ADR 语义。不构成 evolution（无修订 ADR 决策的意图）。断言目标值经实测读取核实未变（test 372/378/439 行）。
3. Phase 0 门禁提示 1–5 在设计中全部落实（§10 映射表逐条核实属实）。

—— SA8 Conflict Gatekeeper，Phase 2 设计后复审完成。相关决议文档已同步追加设计引入的新决策点（见 `task_dsh-persistence-inspector_relevant_decisions.md` 末节）。
