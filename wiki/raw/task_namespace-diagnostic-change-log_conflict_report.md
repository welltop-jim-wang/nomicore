# 冲突门禁报告 — Issue #150: Record the namespace creation lifecycle and genesis

- 被审对象：`wiki/raw/task_namespace-diagnostic-change-log.md`（任务简报，前置门禁）
- 冲突基准：`docs/adr/` 全集 11 份（0001–0009、0011、0012，逐份全读）+ `CONTEXT.md`
- 配套决议清单：`wiki/raw/task_namespace-diagnostic-change-log_relevant_decisions.md`
- SA8 运行轮次：dispatch log 第 2 行（Phase 0 recovery）

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19 / 2026-08-21 修订） | 弱 | no-conflict。任务不改 schema 来源、方言冻结与 SCHEMA 键名；日志默认面不复制 SCHEMA 全文（数据保护归 ADR-0011，任务未要求违反） |
| ADR-0002 | nomicore 全新重写，authority 出范围 | accepted | 无 | no-conflict。create 记录不含 authority 类不变式 |
| ADR-0003 | 求值器与派生 schema | accepted | 弱 | no-conflict。ROOT 物化/detached 构造纪律是 create 路径既有背景；任务不触派生 schema 形状 |
| ADR-0004 | vfsl-protocol 类型协议包 | accepted | 无 | no-conflict。编译期类型投影轨道，零交集 |
| ADR-0005 | 投影生成管线 | accepted | 无 | no-conflict。codegen 管线，零交集 |
| ADR-0006 | 持久化插件与 doc 三条目布局 | accepted（含 #64 createDoc/owner、#79 entry status 修订节） | **高** | no-conflict。AC1「transaction/Persistence」结局事实（`DOC_DUPLICATE`、排他创建、committed create、typed create error、不覆盖已提交内容）均为本文 #64 修订节条款的直接记录面；任务不要求 Persistence 行为变化 |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge 分层 | accepted（Runtime/open/read 条款被 ADR-0008 部分取代；logical validation、detached materialization、零写入、observer no-rollback 继续有效） | **高** | no-conflict。create 路径 schema compile / validation 结局是本文冻结能力（`compileSchemaEnvelope`/`validateLogicalSnapshot`）既有结果的记录，非新语义；与被取代部分（open 编排、schema-aware read）无接触 |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 2026-08-24 #93 稳定码注册修订） | **高** | no-conflict。post-commit Runtime construction 走本文 P0 启动路径与 ADR-0009 create 流程；AC4「不改 Registry lifecycle / Runtime 行为」与本文单 sequencer/fatal/close 契约同向；emit 接线落 slot 外（见 ADR-0012 amendment 与注记 N2） |
| ADR-0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted | **核心** | no-conflict。AC1 全部 create 结局事实与 AC2 committed 事实通道逐条来自本文 Create/Fatal/Shutdown 节（明细见冲突点 #1/#3） |
| ADR-0011 | Best-effort namespace 诊断变更日志 | accepted | **核心** | no-conflict。任务即本文「覆盖范围」第一条（namespace create 含输入、schema、ROOT、duplicate、Persistence、post-commit Runtime construction 结局）的接线落地；AC2/AC3/AC4 与本文 genesis、输入捕获、业务隔离条款逐句对应（明细见冲突点 #2/#4/#5） |
| ADR-0012 | VFSL 校验的 JSONL 与 framed sidecar 诊断日志格式 | accepted（含 2026-08-28 issue #152 first-slice amendment） | **核心** | no-conflict。genesis baseline 尽力语义、初始化失败业务隔离（`LOG_STREAM_INIT_FAILED`）、延迟初始化的诚实 genesis 与 AC2/AC4/AC5 逐句对应；amendment 接线纪律是任务必须满足的约束而非冲突（注记 N2） |
| （ADR-0010） | trusted replication | 文件不在本 worktree `docs/adr/`（ADR-0011/0012 关联节提及） | 无 | 不构成约束。#150 范围不触 `replication-*` 操作（归后续接线票）；无文件即无条款可违反，亦无 superseded 问题 |
| CONTEXT.md | 术语与硬性惯例 | 现行 | **核心** | no-conflict。`genesis baseline record`「emission/sink 公共面无构造路径，由 #152 adapter 内部构造」与 AC2 的供字节表述相容（见冲突点 #2 裁决）；`语义 emission`/`storage projection`/`变更尝试`/`stream generation` 词表均被简报遵守 |

被 superseded 终态的 ADR：无（ADR-0007 仅部分条款被 ADR-0008 取代且取代范围明确，未触本任务面；全集 11 份均为有效约束）。

## 冲突点

（对照明细；全部裁决为 no-conflict，无 override-declared / evolution / hard-violation）

| # | 严重度 | ADR/CONTEXT 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | — | ADR-0011 覆盖范围：「namespace create，包括输入、schema、ROOT、duplicate、Persistence 与 post-commit Runtime construction 结局」；结局/阶段词表（committed/rejected/fatal/unknown + 8 值阶段）+「每条结局记录保留所属模块已有的稳定 code、phase、issues 顺序与 committed 事实；日志层不得发明 retryable、rollback 或成功语义」 | AC1：「emits structured outcomes for acceptance, duplicate, input snapshot, schema compile, validation, transaction/Persistence, and post-commit Runtime construction paths using existing stable facts」 | no-conflict | AC1 的七类结局与 ADR-0011 覆盖范围 create 条款逐词同构，是显式授权面的落地；「using existing stable facts」即「保留所属模块已有的稳定 code……不得发明」的直接兑付。duplicate 是 create 的**结局类别**（ADR-0011 原文明列），映射入 8 值封闭阶段枚举与既有稳定码（`NAMESPACE_ALREADY_EXISTS`/`DOC_DUPLICATE`）属 SA1 设计空间，简报未要求新阶段值或新码 |
| 2 | — | ADR-0011：「创建成功可记录完整初始 Y.Doc update 作为 `genesis`」「底层 transaction 模块应在不暴露 live Y.Doc 的前提下返回或投递 owned bytes」；ADR-0012：「每个新 stream 尽力先记录当前完整 Y.Doc 的 genesis baseline」；CONTEXT.md `genesis baseline record`：「v1 冻结的 emission/sink 公共面无构造路径，由 #152 adapter 内部构造」 | AC2：「Successful creation supplies detached genesis update bytes representing the committed initial Y.Doc」 | no-conflict | 简报要求的是**供 detached/owned update bytes**（=#152 adapter 既有 `genesisUpdateBytes` 接缝的 Host 侧供给），不是在 emission 公共面构造 genesis record——genesis-baseline record 的构造仍独占于 adapter 内部，CONTEXT.md 条款未被触碰。ADR-0011 的「可记录」是能力许可，接线票把许可落地为供给义务，属授权方向内实现，不构成对「尽力/失败不禁用」语义的收紧（AC4/AC5 同时钉死失败与延迟初始化不改业务、不虚称完整） |
| 3 | — | ADR-0011：「`fatal`：……必须携带现有错误通道已知的 `committed` 事实」；ADR-0009：「如果 createDoc 已提交而 Runtime 构造失败……以 `committed:true` Registry fatal reject」；ADR-0008 fatal 通道（post-commit fatal 带 `committed:true`） | AC2 后半：「post-commit fatal outcomes preserve their committed fact」 | no-conflict | 简报要求保持的 committed 事实正是 ADR-0009 既有 `runtime-construction` committed:true fatal 通道的忠实记录；无新分类、无日志层重判 |
| 4 | — | ADR-0011 输入捕获：「capability/acceptance gate 在输入访问前拒绝时，记录 `input.capture = not-accessed`」「对 create 等已有独立快照实现的路径，同样复用该路径的安全快照，不建立第二套序列化规则」；ADR-0009：「create 取得 lifecycle 槽后才读取并冻结输入」 | AC3：「Pre-input failures do not access caller payload, and all later input capture reuses the creation path's existing detached safe snapshot」 | no-conflict | 逐句对应 ADR-0011 输入捕获五条款；「existing detached safe snapshot」即 ADR-0009 create 槽起点的受控冻结快照，简报明示复用而非新建第二套（与被否方案「在方法入口序列化原始请求」反向） |
| 5 | — | ADR-0011：「日志 emit、排队、持久化、背压、丢弃或关闭失败不得改变业务操作的返回值、rejection、提交事实、sequencer 顺序或 Runtime 状态」「日志实现不得因失败将 namespace 标记为 fatal、persistence-degraded 或只读」；ADR-0012：「初始化失败不影响 namespace create；独立健康 observer 上报 `LOG_STREAM_INIT_FAILED`」 | AC4：「Logging disabled, stream initialization failure, queue pressure, and sink failure do not change create success, rejection, Persistence state, or Registry lifecycle behaviour」 | no-conflict | AC4 是两 ADR 业务隔离条款在 create 面的直接重述；「queue pressure」对应 ADR-0011「日志队列溢出可以丢弃记录」（emitter seam 抽象下对有队 adapter 的非干扰要求），无条款被要求放松或收紧 |
| 6 | — | ADR-0012：「后续重试成功时以当时 Y.Doc 建立新 stream，其 genesis 只代表从该时点开始，不能伪称从 namespace 创建时起连续」；ADR-0011：「启用与否在 namespace 创建时确定；启用后，系统从创建尝试开始，尽力记录」 | Objective/AC5：「later logging enablement attempts a current Y.Doc genesis」「delayed stream initialization with an honest current-state genesis」 | no-conflict | 简报的「later logging enablement」经 AC5 钉死为**延迟 stream 初始化/重试**语义（honest current-state genesis =「以当时 Y.Doc 建立新 stream……不能伪称从 namespace 创建时起连续」的逐句兑付），与 ADR-0011「启用与否在创建时确定」不冲突——启用决策与 stream 初始化时点是两个事实，ADR-0012 已显式放行延迟初始化并钉死其诚实性；无「回补伪造自创建起的连续日志」要求（那才是违反项，简报未提出） |
| 7 | — | （无反向约束条款；测试要求与 ADR-0012 验收门槛 5/6、ADR-0011 best-effort 语义同向） | AC5：六类测试场景（成功 genesis / duplicate / validation 拒绝 / persistence 失败 / post-commit 构造失败 / 延迟初始化） | no-conflict | 测试覆盖要求与 ADR-0012 验收门槛（gate 拒绝 input not-accessed、初始化失败不改业务）及 ADR-0011 场景面一致；无 ADR 条款约束测试形态 |
| 8 | — | （流程约束面；ADR-0012 amendment 把接线合规义务显式指派给 #149–#151/#155） | Constraint：「Issue text states it was blocked by #148; implement against the current worktree without waiting for that issue to merge.」 | no-conflict | #148 冻结契约（emission/record/词表/schema）已在当前 worktree（`packages/namespace-diagnostic-log`）落地并有全套验收档案；「不等合并、按 worktree 实施」是流程指令，不与任何 ADR 条款冲突 |

## 结论

**Verdict: `clear` —— 放行。**

- 冲突点 8 项对照，**0 条 hard-violation、0 条 evolution、0 条 override-declared**：任务简报是 ADR-0011「覆盖范围：namespace create」条款与 ADR-0012 genesis/初始化隔离条款的显式授权落地，全部结局事实复用 ADR-0006/0007/0008/0009 既有通道，未要求推翻或实质修订任何既有决策。
- 给 SA1 的边界钉子（均为**约束提醒**，非冲突，详见 relevant_decisions）：
  - **N1（genesis 构造路径）**：producer 只供 detached owned update bytes；genesis-baseline record 的构造仍由 #152 adapter 内部独占（CONTEXT.md 词条），不得在 emission/sink 公共面增设 genesis 构造路径或新 recordKind。
  - **N2（接线纪律，ADR-0012 amendment 规范性条款）**：同步 File adapter `emit` 与 adapter 构造必须位于 NamespaceRuntime write sequencer slot 之外或释放后——create 路径（Runtime 构造前）天然在 slot 外，post-commit 段（P0/Runtime construction）须保持该性质；emitter 不被 `await`、不延长 lifecycle/写槽、不阻塞 close/shutdown。
  - **N3（词表封闭）**：stage 8 值 / operation 6 值（`namespace-create` 在列）/ result 判别联合 / update-omitted reason 三值为 #148 冻结词表（ADR-0011/0012 逐字）；简报的「duplicate」是结局类别，映射入既有阶段与稳定码，不得新增词表值（新增属词表演进，须过设计评审）。
  - **N4（诚实性）**：延迟启用/初始化的 genesis 只代表当时 Y.Doc，不得伪称自创建时连续（AC5 已内嵌该要求，设计须维持）。
- 无需 Jim 裁决事项；无 override 需要登记。
