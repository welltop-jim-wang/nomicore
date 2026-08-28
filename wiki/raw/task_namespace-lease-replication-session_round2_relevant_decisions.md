# 相关决议 — Round 2 增量（issue #134 修订轮，PR #146 评审 12 项）

> SA8 前置门禁（Round 2）产出。**只写增量**，round-1 全量约束清单见
> `task_namespace-lease-replication-session_relevant_decisions.md`（O-1..O-12 与设计后复审追加节，继续有效）；
> 本轮裁决依据见 `task_namespace-lease-replication-session_round2_conflict_report.md`（verdict: clear）。
> 行号锚定本 worktree 当前基线（ADR 0010 含 issue #134 修订节共 263 行）。

## Round 2 新增 ADR 条款摘录（round-1 清单未覆盖或本轮重点）

### ADR-0010（含 issue #134 修订节）本轮重点条款原文

- §复制谱系与 epoch（L53）：「hub 提供 `bumpReplicationEpoch()`，它不替换 Y.Doc 内容，但使旧 epoch 的 peer 必须显式 reset/bootstrap。」
- §复制谱系与 epoch（L55）：「身份与 epoch 相同才允许双向 state-vector reconciliation；缺失或不同进入稳定 `conflicted` 状态，绝不自动覆盖或合并。」
- §Trusted raw update 六步（L101，第 4 步）：「Runtime observer 产出 owned update 与受控 origin」——产出（同步）与投递（可异步）是两个动作，异步投递不改变六步结构。
- §Trusted raw update observer 三条（L109–113）：「只交付复制需要的 owned bytes 和受控 origin，不暴露 live Y.Doc；observer 失败不得回滚 transaction 或使 Runtime fatal；队列溢出只把 channel 标记为 `needs-resync`，不得阻塞 write sequencer。」（L113 = R2-3 合同原文出处）
- §Persistence degraded（L139）：「状态必须区分『内存已追上』与『磁盘未追上』，不得声称 peer 副本已经 durable。」
- §WebSocket 协议（L151）：「Per-namespace 有界队列溢出时丢弃未发送增量并进入 needs-resync；connection按namespace round-robin公平发送，control/ACK保留额度，网络背压不得进入Runtime sequencer。」（WS 发送队列域——与 R2-3 fanout 投递队列分界）
- §停止顺序（L179）：「复制插件停止接纳连接/target，关闭 channels，等待已被 Runtime 接纳的 apply 槽完成但不无限等待网络 ACK，释放 replication leases，随后 Registry shutdown、Persistence dispose，最后停止 Timer/Clock。」
- 修订节·apply 拒绝码注册（L237）：「写管线 internal fatal（getStatus adapter 违约 / apply 未知 throw / notify-dirty 失败）经 `RuntimeWriteFatalError` rejection（`committed` 诚实），slot 词 `replication-apply` → fatal 码 `NSRT-FATAL-REPLICATION-APPLY-INTERNAL`。」
- 修订节·Session 独立状态词汇（L241，O-11）：「`rootValidation('none'|'replication-unvalidated')`（raw apply 成功后置位、生命周期内永不清除）」「`durability`（`memoryCaughtUp` 初值冻结 false……首次 apply 成功置 true 后不回落）」「`observerFailures`（扇出 listener 自捕获计数；无界纯计数、不熔断不自动退订——熔断/背压属切片 6 队列属主）」。
- 修订节·生命周期词义（L245–247，O-9）：「`closed`（显式 close 或 Lease release 同步调用 `session.close()`）与 `conflicted`（epoch fence）皆终态并释放槽位；终态后同 Lease 可再 open（新 open 冻结新 epoch）」；「`close()`：幂等 same-promise；首次调用同步段停接纳 + 摘除扇出 channel；Promise 结算为 barrier 语义……永不 reject」；「两种终态（close 首调 / apply 槽 R2 conflicted 转换）共用同一 `fanout.detach` 摘除点：存量 listener 即刻停止投递」。
- 修订节·受保护字段判据（L251，O-12）：「判据 = (a) 内容投影相等……原始值直比（string/number/boolean/null），非 primitive 形态（Yjs 容器/对象——契约外值域）保守判『已改变』→ 拒绝。」
- 修订节·O-4（L260）：「实例静态角色经 Registry 构造 `options.role`……生产 composition root（切片 9）必须显式传 role。」

### ADR-0008 本轮重点条款原文

- 读取投影·META 值域（L31）：「META 是开放键空间，但值只允许 JSON-compatible plain value，不允许嵌套 Yjs shared type；v1 不提供 META 写。」（R2-4 路径 (b) 的值域红线出处）
- Fatal 通道（L84/L86）：「`committed:true` 或未知异常保守视为可能已提交，在当前槽内 best-effort `notifyDirty()`，但始终 reject 原始 fatal」「不补偿、不 fallback、不声称 rollback」。（R2-6 保守诚实同构先例）
- 生命周期（L93）：「`close()` 幂等。首次调用同步进入 `closing`，立即停止接纳公共 read 和 write，并在队尾加入 close barrier；此前已接纳任务无条件排空，不取消、不设内部 timeout。」（R2-2 排空/barrier 锚点）
- #132 修订节（L134）：bump 槽序「lifecycle/fatal gate → `DocHandle.getStatus()` writable gate → 输入校验 → 领域事实读取 → 单 Yjs transaction → 同步投影 → `await notifyDirty()`」。（R2-1 主动 fence 落点 = 「同步投影」步）

### ADR-0009 本轮重点条款原文

- release 纪律（L42）：「首次 `release()` 在调用栈内同步将 lease 标记为 released，之后不再接纳新操作。重复 release 返回 exact same Promise。」（R2-5 hostile seam 锚点）
- #134 修订节（L150）：「release 同步段调用既有活跃 session 的 `close()`（停接纳 + 退订 + 释放 slot；零新增方法面）；release 不追踪/取消已接纳 apply 槽。」

### phase-5 文档本轮重点原文

- 切片 3（L73）：「Observer failure 隔离和 `needs-resync` 通知；不暴露 Y.Doc、DocHandle 或 live shared type。」（本切片原文即要求 needs-resync 通知面）
- 验收场景（L175）：「慢消费者触发 `needs-resync`，不阻塞本地业务 write sequencer。」（R2-3 直接验收锚点）
- 切片 3 落地对账注记（L81，round-1 C-1 产物，本轮需更新）：「本切片无队列 ⇒ ADR 0010 L113 唯一触发面（队列溢出）结构性不可达；needs-resync 与队列属主 = 切片 6」——R2-3 落地后该注记改写为「needs-resync 于本切片（R2-3）落地」。
- 切片 9（L132）：「生产 composition root（本切片）必须显式向 Registry 构造传 `role`……缺省 `'hub'` 只是未声明时的一致性零回归面，不作为生产配置遗漏的豁免。」（R2-8 边界）

## Round 2 裁决增量（全链 SA 执行约束；裁决依据见冲突报告 #1–#7）

- **R2-3（fanout 异步化）**：owned bytes 复制（observer 内同步产出，满足六步之 4 与 L111）→ 有界异步队列投递 → 溢出标 channel `needs-resync`（L113 字面）→ 零阻塞 write sequencer。round-1 设计断言「同步扇出天然不阻塞 sequencer」（design L24）与「事务内同步扇出 = 六步之 4 结构性满足」（design L370）**作废**——同步扇出是实现缺陷（评审阻断 3），非 ADR 读法。`observerFailures` 仍为无界纯计数（listener throw 自捕获，不熔断不自动退订）；「切片 6 属主」收窄为 WS 发送队列/连接背压（L151 域）。ADR 0010 修订节与 phase-5 L81 注记须按登记义务 D-1 增补。
- **R2-1（epoch 主动 fence）**：fence 效力在 bump 槽「同步投影」步（#132 L134 槽边界）主动触发；旧 session → 终态 `conflicted`（L245 词义复用）+ `fanout.detach`（L247 摘除点复用）；新 epoch session 重建 = 终态后同 Lease 再 open（L245）。修订节 L245/L247 追加 bump 槽触发面（D-2a）。
- **R2-2（Runtime close 摘除 sessions）**：close 同步段终止/detach 现存 sessions（ADR 0008 L93「立即停止接纳」的 session 面等价物）；已接纳 apply 槽无条件排空（L93 + ADR 0010 L179）；close barrier 队尾结算（在途 apply 先于 barrier，FIFO 确定）。session 终态词汇（closed vs conflicted）由 SA1 冻结。修订节追加 Runtime close 触发面（D-2b）。
- **R2-4（受保护字段结构值）**：**放行方向 = 路径 (a) 规范化深比较**（内容投影相等判据在 ADR 0008 L31 全部合法值域上执行完整；真变化仍拒）。若选 (a)：ADR 0010 修订节 L251 增补判据细化（D-3），规范化语义（键序/类型/Yjs 容器投影规则）由 SA1 冻结 + 锁定测试。若选：维持 L251 原文 + 登记「受保护字段**投影比对域** primitive 不变量」+ 锁定测试；**禁止把 META 整体值域收窄为 primitive-only**（与 ADR 0008 L31 字面冲突——「允许 plain value」含 object/array）。
- **R2-5（release hostile seam）**：不先查状态、直接幂等 `session.close()`（L246「永不 reject」）；`onReleased()` 在 guaranteed cleanup 路径执行/隔离；hostile seam（getStatus/close 抛错）不得造成半释放、漏 idle cleanup 或首次 release 同步抛出（ADR 0009 L42 same-Promise 稳定面）。
- **R2-6（committed 诚实）**：精确可判则判（beforeTransaction 前 ⇒ `committed:false` 零 mutation）；不可判则保守 `committed:true` + best-effort notifyDirty + 明文规范「不宣称精确」（ADR 0008 L84 同构纪律；ADR 0010 L107「不得虚假声称」字面）。
- **R2-7（no-op 置位）**：**放行方向 = 「成功接纳即置位」**——no-op/重复 update 的成功 apply 同样置 `rootValidation='replication-unvalidated'` 与 `memoryCaughtUp=true`（修订节 L241「raw apply 成功后置位」无「且推进」限定；CONTEXT「复制未校验」词条「已提交并登记 dirty」字面覆盖；ADR 0010 L107「仍被接受……标记」）。补明文规范 + 测试（评审项 7 自带 ADR 文字要求）。「实际推进才置位」路径需改写 L241 冻结词——不推荐。
- **R2-8（plugin role 贯通）**：两路均放行——贯通（plugin config `role` → 校验 → Registry 构造 `options.role` → README → hub/peer 装配测试，提前履行切片 9 义务）或收窄完成声明（诚实登记生产 peer 支持延后）。校验错误形状沿 O-4 既有词汇。
- **R2-12（空占位）**：`PEER_ALLOWED_META_KEYS` 空占位可删除——空集是语义冻结（修订节 L253「peer 允许的 META 白名单首版 = 空集 ⟺ META 全键保护」），非代码常量义务；受保护字段集合仍为冻结常量（L121）。
- **既有纪律不变**：公共面纪律（Runtime 十二键、index 值导出恰一键、session 恰十键 Equal 锁、seam 类型跨包断言）、全量测试保持绿、改码包 bump patch 版本、round-1 T-1..T-7 和解与 O-1..O-12 裁决继续有效。

---

## Round 2 设计后复审追加（SA1 R2 设计增补引入的新决策点；供 SA2/SA3/SA4/SA7 复用）

> SA8 设计后复审 2026-08-28 追加（verdict clear，见 `task_namespace-lease-replication-session_round2_design_conflict_report.md`）。
> 以下为 R2 设计（`_round2_design.md`，618 行）冻结、且经复审确认与 ADR/CONTEXT 一致的**新约束**。

- **F-1 needs-resync 形状（D-1 落地）**：status 第 11 字段 `needsResync: boolean`（初值 false、sticky——置位后永不清除、无清除 API；清零路径 = 新 session）；**标记后继续投递**（ADR 0010 L113「**只**把 channel 标记」字面——观测信号非行为切换，与 L241「不熔断不自动退订」同构）；队列容量 = 每 channel（= 每 session）16 项冻结常量 `FANOUT_CHANNEL_QUEUE_CAPACITY`（不可配置——沿 L121「raw caller 不得逐次自定义」同款纪律）；溢出 = 丢弃**新**项（保序）+ 置位，容量检查先于字节复制。
- **F-2 Runtime close 终态词汇 = `closed`**（非冲突性终态；conflicted 保留给 epoch fence——修订节 L245 词义不污染）；内部记账 `closedBy: 'runtime-close'` 不进 status 形状（apply 拒绝码映射专用：该分支 → `RUNTIME_WRITE_DISABLED`，ADR 0008 #93 修订节第 (4) 类域；显式 close → `REPLICATION_SESSION_CLOSED` 不变）。
- **F-3 bump 写对旧 session 零投递**：fence 落点 = bump 槽 E5.5（同步投影步，事务后、notifyDirty 前）；`finalize('conflicted')` 取消该 channel 全部未投递排队项 ⇒ bump 自身 META 写零投递——依据 ADR 0010 修订节 L262 踩坑注记「管理写字节不得经 raw 回灌对端」；round-1 T-3 锚 `afterBump===1` 演进 `===0`（SA3 owned + 注释同步）。
- **F-4 committed 精确二分（D-4 升级形式）**：R5 内 beforeTransaction 探针——`txStarted===false` ⟹ 事务函数从未执行 ⟹ `committed:false`；`txStarted===true` ⟹ 保守 `committed:true`（ADR 0008 L84 保守分支保留）。精确性条件 = yjs 事务钩子域注入（Yjs 13.6.32 实测：beforeTransaction emit 先于事务函数、按注册序派发）；复合敌意（beforeTransaction 内先变异后抛）属 ADR 0007 L54 契约破坏域不承诺——例外注记随 D-4 入 ADR。
- **F-5 hostile 注入面**：lease.ts 包内 `createLeaseController` deps（第 4 参）注入敌意 session core——行为契约与注入面分离，不触 internal subpath import 图。
- **F-2/F-6 排空与联动**：Runtime close 顺序冻结 = lifecycle 翻转 → `terminateAll('runtime-close')` → barrier 入队（同一同步段）；已接纳 apply 槽无条件排空（ADR 0008 L93 + ADR 0010 L179——close.ts/sequencer.ts 零改动）；registry #11/#12 用例随 R2-1/R2-2 修复自然转绿（F-6：无语义分歧）。
- **§1 round-1 断言作废五处（全部合法）**：O-10「同步扇出天然不阻塞 sequencer」、R5「结构性满足」（SA8 D-1 指定）+「Registry 不主动终态化 session」（评审阻断 2）+ T-3 锚值 1→0（L262 依据）+「SV/diff best-effort」收窄为终态确定 throw（O-9 终态纪律统一）。
- **§5.2 深比较规则表（D-3 落地，冻结）**：primitive SameValue（NaN=NaN、-0≠0）；Y.Map/Y.Array（含嵌套）`toJSON()` 递归投影后深比较；plain array 有序、plain object 键序无关（键集 sort 先行）；契约外形态（undefined/bigint/symbol/function/其它实例/Y.Text 等异构容器投影分叉）保守判「已改变」；**META 值域零收窄**（ADR 0008 L31 红线显式遵守——深比较只在受保护字段投影比对域内执行）。
- **§4 泵模型**：observer 内只做回声抑制谓词→容量检查→owned bytes 复制→入队→调度泵；泵 = 每 channel 独立自延伸微任务链（让步 20 = `FANOUT_DELIVERY_DEFERRAL_MICROTASKS`，单挂起续体公平性）；投递时逐 listener `item.slice()`（两级副本——INV-S4 逐字保持）；零订阅者 channel 泵照常消费；`observerFailures` 语义不变（捕获点从 transaction 栈内移到栈外）。
- **§13.2 Equal 锁格架**：三处声明收敛为「runtime core + registry types 两点 + 编译器强制」（registry.ts 跨包 Equal ×2 + lease.ts 自锁 + deps 注入口转置锁均保留不删）；status/能力面字段演进 = 恰改两个声明点。
- **§16 版本**：namespace-runtime 0.1.9→0.1.10、namespace-registry 0.1.5→0.1.6（仅 version；exports/dependencies 冻结）。
- **执行注意（复审放行条件/风险指针）**：C-1' §14 文档登记必须实际落盘（ADR 0010 修订节 round-2 增补 + phase-5 L81 改写 + CONTEXT 句 + 两 README）；C-2' 三处测试演进面按 §15.2/§15.3 登记执行、不得越界改锚；R-3' closedBy 码映射说明须随 D-2b 文字入 ADR（勿漏）；R-1'/R-2'（Yjs 次序假设、跳数推演）→ SA7 动态复核。
