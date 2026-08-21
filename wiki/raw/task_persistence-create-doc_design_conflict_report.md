# 冲突门禁报告（Phase 2 设计后复审）

- 被审对象：`wiki/raw/task_persistence-create-doc_design.md`（SA1 设计文档，issue #64）
- 冲突基准：`docs/adr/` 全集（6 篇，逐篇全读，禁止抽样）+ `CONTEXT.md`
- 前置报告：`wiki/raw/task_persistence-create-doc_conflict_report.md`——其 C1/C2 两条
  evolution 已由 owner 裁决放行（dispatch 记录：「均为 issue #64 本身的有意演进诉求，
  daemon 恢复指令即放行裁决；不停机」）
- 复审范围：①设计对 C1/C2 演进的引用是否正确（二次核对）；②是否引入前置门禁之外的新冲突
- 产出时间：2026-08-21；SA8 除本报告与 `_relevant_decisions.md` 的追加节外未改动任何被审文件

## Verdict

`clear`

**裁决分布：0 hard-violation、0 新增 evolution、0 待裁决 override-declared；C1/C2 演进引用
核对无误（§12 为已放行演进的正式落地文本，非新冲突）；设计新引入决策点 10 项逐条对照全部
no-conflict。总控可继续派发 SA2 全维度攻击评审。**

## 复审重点一：C1/C2 演进引用核对（逐字比对）

| # | 核对项 | 设计出处 | 基准原文 | 结果 |
|---|---|---|---|---|
| K1 | C1 旧条款引文 | §0.C1「创建 = 首个 saveDoc：loadDoc 不存在返回 null……（无独立 createDoc）」 | ADR-0006 L35 决策节原文（仅去粗体标记） | ✅ 逐字一致 |
| K2 | C2 旧条款引文 | §0.C2「interface DocHandle { readonly user: User; … }」与 loadDoc(user, …) | ADR-0006 L14–28 接口代码块 | ✅ 逐字一致 |
| K3 | C1 演进后条款 | §0.C1：createDoc 排他创建 / DOC_DUPLICATE+DocDuplicateError / 不覆盖 / 首快照先提交（temp→rename、不新增 fsync）/ lease + handle.doc===doc / 失败无 handle·不缓存·不销毁 / per-key 协调 / supersede-load 不返回 null | 简报 Required semantics + 前置报告 C1 行（含「load 侧并发边角」的放行范围） | ✅ 一致，未超出放行范围 |
| K4 | C1 保留条款 | §0.C1「保留不变：loadDoc 对不存在 key 仍返回 null（用例 7）；saveDoc 仍仅登记 dirty……首个 saveDoc 仍是合法写入路径」 | ADR-0006 L33–35 未被演进触及的部分 | ✅ 与前置报告 C1 依据的边角描述一致 |
| K5 | C2 演进后条款 | §0.C2：owner = 存储所有者（分区键）非访问者；访问者授权不入 Persistence Interface；`User` 接口名保留 | ADR-0006 L39「user 仅作分区键：本层不鉴权」；前置报告 C2 行（术语对齐式演进） | ✅ 一致 |
| K6 | C2 引证核实 | §0.C2 引「owner 仍不写入 META」；§9 引 owner 术语收敛 | ADR-0006 L50「`owner` 仍不写入 META（用户归属由目录分区承载）」、L72「`owner` 暂不入 META」 | ✅ 均为 ADR 原文 |
| K7 | §0 锚定的 7 条 no-conflict 条款引文 | 「仅校验 META.docId」「temp→rename 提交点、不新增 fsync」「saveDoc = 脏通知 + debounce 500ms / max-dirty 5s 内部调度 + 内部 retry」「单飞 flush + generation 保序」「共享 doc 独立 handle + lease 身份校验」「插件工厂/实例模型、dispose 释放后台任务与缓存」「v1 单进程无文件锁」 | ADR-0006 L71 / L52+L55 / L33–34 / L58 / L30+L32 / L85–86 / L104 | ✅ 逐条核实为 ADR 原文摘录 |
| K8 | 演进引用方式 | §0「不以 ADR-0006 旧接口文本为现行契约，而以演进后条款为基准」+ §12 修订节草案（显式取代声明：「取代『创建 = 首个 saveDoc（无独立 createDoc）』」「取代本文上方接口代码块的 DocHandle.user 与二方法签名」） | 前置报告结论 2：「SA1 设计文档须引用修订后的条款而非旧接口文本」+ 建议落地正式修订节 | ✅ 要求满足；§12 即建议的落地形式 |
| K9 | 「13 项 no-conflict」计数引用 | §0「冲突门禁已逐条判定 13 项 no-conflict」 | 前置报告结论 3「其余 13 项对照全部 no-conflict」 | ✅ 计数一致 |

**结论：设计对 C1/C2 的引用正确、完整、未越出放行范围；§12 将已放行演进正式化为 ADR 修订
文本，属放行的执行动作而非新冲突。**

## 复审重点二：新冲突扫描（前置门禁之外，设计新引入决策点逐条对照）

| # | 设计决策（出处） | 相关 ADR 条款 | 对照结论 |
|---|---|---|---|
| N1 | createDoc 首快照**直写** io.write：fail-fast、无 debounce/retry，成功后 entry clean、无 timer（§4.2/§6，U4） | ADR-0006 L33–34 调度条款仅约束 saveDoc 触发的 flush；首快照「创建成功前已提交」是被放行 C1 的固有语义（同步提交 ⟹ 不走异步调度） | no-conflict |
| N2 | create 初始写失败：原始 I/O 错误原样上抛，**不进 retry、不进 persistence-degraded**（§8/U2） | ADR-0006 L36 降级条款限定「save 失败按 doc 只读降级」（已提交内存事务的异步持久化失败）；create 失败是同步调用方拒绝，无相反条款；§4.3 明示「degraded 是 flush 失败语义，不得滥用」——与条款边界一致 | no-conflict |
| N3 | supersede 线性化 + lost-update loud 告警 + 调用方模式指引（§4.3） | 无 ADR 条款相反；跨实例不保证声明与 L104「v1 限制：单进程（无文件锁）」一致；告警非静默（无虚假降级） | no-conflict（内部张力备注见下「备注 2」，属 SA2 领地） |
| N4 | 共享 `PersistenceLifecycle` core + `PersistenceIO` seam；MemoryPersistence 瘦壳化；#58 复用不复制（§5） | ADR-0006 L82「MemoryPersistence 与 FilePersistence 是两个真实 Adapter」、L88–92 实施顺序保留（本票 = 步骤 2 领地 + contracts；file.ts 入 DENY LIST 不偷渡步骤 3）；共享 core 前置门禁已判「实现组织决策，ADR 不约束」 | no-conflict |
| N5 | `lifecycle.ts` 不进公共导出；`MemoryPersistenceStatus = PersistenceStatus` 别名保持导出形状（§5.1/§5.3） | 无 ADR 条款触及；L83「插件实现只依赖 Cordis、Yjs 与持久化 contracts」——core 在 contracts 包内 | no-conflict |
| N6 | META.docId **创建期前置同步校验**（任何 I/O 之前；不校验 SCHEMA/ROOT/createdAt）（§6） | ADR-0006 L50「META.docId 必须等于请求的 namespaceId；不一致视为持久化损坏并响亮失败」、L71「持久层只校验 META.docId」——同类校验向创建入口延伸，方向一致（更严不更松），未扩校验面 | no-conflict |
| N7 | dispose 对 in-flight create 的传入 doc 不销毁（未注册 entry 不属 Y.Doc 缓存）；in-flight 以含 disposed 的真实 rejection 收束（§8） | ADR-0006 L86「dispose 时释放文件句柄、后台任务和 Y.Doc 缓存」——仅覆盖已缓存实例；传入 doc 从未入缓存，与简报「失败不销毁传入 doc」一致 | no-conflict |
| N8 | 「并发加载合流」泛化为 ReadTicket/driver（恰一次 io.read、恰一个 driver、completion 恰 settle 一次，I2）（§4/§7） | ADR-0006 L31「并发加载合流……只创建一个内部 loading Promise」——语义保留并推广到 create 侧 | no-conflict |
| N9 | `DocDuplicateError` 新增导出（additive；code 恒 DOC_DUPLICATE，U5）（§10） | 无 ADR 条款相反（duplicate 错误码为 C1 演进自带语义） | no-conflict |
| N10 | §12 对 ADR-0006 追加修订节（SA3 逐字落地）（§12） | 已放行演进的正式落地（前置报告结论 2 的建议形式）；「未提及的条款维持原文效力」保证其余条款不动 | no-conflict（记录性条目） |

**扫描结论：设计未引入任何前置门禁之外的 ADR 冲突。**

## ADR 盘点（状态与前置门禁一致，无变化）

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0006 | Cordis 持久化插件——DocPersistence 接口与 doc 三条目内容布局 | accepted | 是（核心） | C1/C2 已放行演进引用无误（K1–K8）；其余条款含 §0 锚定引文（K7）no-conflict；磁盘文件当前仍为演进前文本，修订节待 SA3 按 §12 落地（备注 1） |
| ADR-0001 | VFSL 文本是 schema 的唯一真相源（含 2026-08-19 修订节） | accepted | 是（边界） | no-conflict：createDoc 以 `Y.encodeStateAsUpdate` 全量编码三条目（SCHEMA 信封按数据原样），不解释不重构；不涉仓内 schema 文本 |
| ADR-0002 | nomicore 全新重写，authority 完全出范围 | accepted | 是（边界） | no-conflict：owner = 存储所有者/分区键，访问者授权明确不入 Persistence Interface（§0.C2/§9）；未长出任何 authority 语义 |
| ADR-0003 | 求值器与派生 schema（ROOT 约定） | accepted | 是（弱） | no-conflict：仅校验 META.docId、不校验 ROOT（用例 9/§6），持久层不见 schema 语义 |
| ADR-0004 | vfsl-protocol 类型协议包 | accepted | 否 | no-conflict：DENY LIST 明确排除 `packages/vfsl*`、`domains/**` |
| ADR-0005 | 投影生成管线 | accepted | 否 | no-conflict：同上，零交集 |

无 superseded ADR（ADR-0003「取代」的是未入库同号草稿，与前置门禁判定一致）。
CONTEXT.md：术语面零触碰（namespace/ROOT/信封/authority 等均未被重定义）；三条目布局按数据存取。

## 备注（非冲突，移交对应环节）

1. **措辞前瞻提醒（移交 SA4 对账）**：设计头部「ADR 基准： docs/adr/0006（含下述 C1/C2 已
   放行演进）」——本报告逐行核实 worktree 内 ADR-0006 文件**当前仍为演进前文本**（无修订节）；
   演进效力在落地前来自 dispatch 放行 + §12 草案。不构成冲突；SA3 按 §12 逐字落地后 ADR 文件
   方自洽，SA4 对账应以「§12 是否逐字落地」为验收项。
2. **lost-update 窗口与「绝不覆盖」的字面张力（移交 SA2）**：§4.3 披露 supersede 窗口内 create
   理论上可覆盖既有快照，与 §0/§12「绝不覆盖已提交内容」存在字面张力。该窗口是简报用例 5 强制
   的 supersede 语义之固有边角（触发前提 = 调用方对同 key 并发 load+create，规范模式已明示），
   设计已诚实披露 + loud 告警。**ADR 基准无任何条款被违反**（「不覆盖」本身是 C1 演进的新语义，
   非既有 ADR 条款），不构成本门禁冲突；其内部一致性与措辞强度属 SA2 全维度评审领地。§12 落地
   文本同时包含两者且自洽（「绝不覆盖」作用于 duplicate 判定路径，supersede 路径单独成文并附
   异常告警语义）。
3. **输入完整性（维持前置备注）**：PRD `docs/prd/persistence-create-doc.md` 复查仍不存在
   （`docs/` 下无 `prd/` 目录）——无增量对照对象，维持前置门禁第 4 条备注。

## 结论

**Verdict = `clear`。**

1. C1/C2 两条已放行演进的引用经逐字核对**正确、完整、未越出放行范围**（K1–K9）；§12 修订节
   是前置报告结论 2 要求的正式落地形式，SA3 须逐字追加到 ADR-0006。
2. 设计在前置门禁之外新引入的 10 项决策点（N1–N10）逐条对照 ADR 全集 + CONTEXT.md，
   **全部 no-conflict**；无新增 evolution、无 hard-violation、无需 Jim 再裁决条目。
3. 三条备注均为非阻塞移交项（措辞前瞻→SA4 对账；lost-update 张力→SA2 评审；PRD 缺失→维持
   备案）。总控可继续 Phase 2 流程（SA2 全维度攻击评审）。
