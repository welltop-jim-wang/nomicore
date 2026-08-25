# 冲突门禁报告（设计后复审）

- 被审对象：SA1 设计文档 `wiki/raw/task_namespace-runtime-fatal-status-close_design.md`（R1，2026-08-25，697 行，全读：§0–§13，D1–D11 + INV-C1..C12）
- 冲突基准：同 Phase 0——`docs/adr/` 全集 8 份（accepted，无 superseded 终态；Phase 0 已全读，本次按设计触达条款增量对照，不重复全量盘点）+ 根目录 `CONTEXT.md` + SA8 前置门禁产出（`task_namespace-runtime-fatal-status-close_relevant_decisions.md` 及其 N1–N6 注记与关键对照 7 约束）
- 审查范围：设计与 ADR 决策集一致性。设计优劣与攻击面属 SA2（破壁人）；实现质量属 SA4/SA7；代码/测试事实不构成冲突基准。
- 事实抽查（SA8 只为校准对照措辞，非实现评审）：`sequencer.ts`（enqueue 经 `.then` 微任务排程、链尾恒绿、L15-17 close barrier 扩展位注释）、`write.ts` S1（fatal gate + 「[扩展位：lifecycle gate——v1 恒 'ready'，close 属后续 issue]」）、`status.ts`（现行六键、`lifecycle:'ready'` 单值）——设计 §1.2/§12 引用的代码事实属实，D5.2「#90 把 lifecycle 半边留作扩展位」陈述成立。

## Verdict

`clear`

## ADR 盘点（设计触达条款 → 对照结论）

| 编号 | 状态 | 设计触达条款 | 对照结论 |
|---|---|---|---|
| ADR-0008 | accepted | 「生命周期、状态与所有权」节（close 幂等/同步 closing/停接纳/队尾 barrier/无条件排空/不取消不设 timeout/release 恰一次/无论成败 closed/失败 reject/同一已结算 Promise/七键 capability status/不暴露队列长度、任务类型或 sequence/v1 无公共事件订阅/不公开 handle 与 live 引用/身份投影）；「Fatal 与失败通道」节五条 bullet（#90 交付零改写）；「读取能力」节（lifecycle 失败同步结果联合、读取不进 sequencer）；「单一 write sequencer」节（FIFO/槽序/degraded）；「P0 与 active schema」节 | **no-conflict**。D2/D3/INV-C1..C5/C8 与 close 条款逐句对应；D4 是「lifecycle 失败使用同步结果联合」的直接兑付（Phase 0 关键对照 7 约束的设计内遵守）；D6 七键= status 条款明文形状；D8 fatal×close 正交 = fatal「保留读取」与 close「停止接纳 read」两组条款的并读。两处解释性裁决（D5.2 lifecycle gate 位置、D7 gate 边界）均判 no-conflict（见边界对照明细 1/2）；fatal 通道零改写（§0/§8），五 bullet 原样 |
| ADR-0007 | accepted（Runtime/open/read 条款被 ADR-0008 取代，其余有效） | validated mutation 管线、零写入、observer no-rollback、窄结果联合 | **no-conflict**。排空期内已接纳写槽走 #90 原样管线（写槽/快照/事务/notifier 零改写，§0/§8.2/D5.3）；零写入覆盖接纳拒绝路径（INV-C6 零副作用）；被取代部分（schema-aware read / open 编排）零接触——read 停接纳是 Runtime 层 lifecycle gate，非读取语义变更 |
| ADR-0006 | accepted（含 #64、#79 修订节） | release 幂等与 lease 语义、saveDoc=dirty notification、#79 entry 级 getStatus 分层 | **no-conflict**。D3 barrier release 恰一次、无条件（degraded/外部已 release 不阻止——release 幂等 resolve 兜底）；排空期 notifyDirty 全部先于 barrier release（租约有效期内）；D6/INV 分层维持 N6（handle 'released' 不反灌 Runtime lifecycle；closing/closed 期写位由 lifecycle 短路，不依赖 handle 观察）；非 thenable release 收敛为 loud 失败通道 = 本文「响亮拒绝」哲学的执行 |
| ADR-0001 | accepted（含修订节） | 「代码库不含 schema 文本（测试 fixture 除外）」；status 摘要不暴露 SCHEMA 全文/ROOT 数据 | **no-conflict**。INV-C8/D9：close 摘要稳定 {code,message}、message 恒定不插值原始异常、不含 SCHEMA 全文/ROOT 数据/stack 泄漏面 |
| ADR-0002 | accepted | authority 出范围；写管线「结构→值→单事务」 | **no-conflict**。close/status 全部为生命周期编排，未引入任何 authority 类不变式；写路径管线零改写 |
| ADR-0003 | accepted | ROOT 物化/派生 schema 纪律（经 active schema tools 间接消费） | **no-conflict**。本任务零触碰求值链与 ROOT 物化（DENY LIST：doc-runtime/vfsl 零改动） |
| ADR-0004 | accepted | （无触达——编译期类型投影轨道） | **no-conflict**（不适用） |
| ADR-0005 | accepted | （无触达——生成管线轨道） | **no-conflict**（不适用） |

CONTEXT.md 术语对照：写序列器（barrier = 队尾节点，P0「不写 Y.Doc」队列节点先例——Phase 0 已裁定不违例；D3 重申）、零写入（INV-C6 接纳拒绝零副作用）、载体投影读取（ready 期透传逐字节不变；lifecycle 拒绝是 Runtime 层 gate，不改 readLogicalValueAtPath 语义）、P0（已接纳任务无条件排空于 barrier 前，§6.1 场景 C）、active schema（status.schema 观察对象，close 不交叉）——全部一致，无术语漂移。

## 冲突点

无。逐条对照（D1–D11、INV-C1..C12、§0–§13）未发现任何 hard-violation、override-declared 或 evolution 级冲突：

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | 无冲突点（0 hard-violation / 0 override-declared / 0 evolution） |

## 边界对照明细（最接近冲突的三处，均裁决 no-conflict）

1. **D5.2「lifecycle gate 住在接纳层、槽内不设」vs ADR-0008 槽序条款「每个真正写任务的槽依次执行：lifecycle/fatal gate、……」 → no-conflict（两条款的联合满足，非条款修订）**。表面张力：槽序首步列有「lifecycle gate」，设计把该半边移到公共方法接纳层（D5.1），槽内只留 fatal gate（S1 原样）。裁决论证：(a) 同一 ADR 的 close 条款「立即停止接纳公共 read 和 write」**强制**接纳时点拒绝——否则 close 后新写将入队于 barrier 之后（barrier 在 close 时已是队尾），违反 barrier 终节点性质与「排空后零副作用」（简报红灯锚 case 3 明文「不入队」）；(b) 在接纳门存在的前提下，槽内 lifecycle gate 唯一可能命中的对象恰是「close 前已接纳任务」——对它们拒绝将直接违反「此前已接纳任务无条件排空」；字面双置会使 ADR 自相矛盾，联合阅读下接纳层兑现是唯一自洽实现；(c) 槽序首步的**可观测语义**完整保留——fatal 半边在槽内 S1 逐字节不变，lifecycle 半边由接纳门结构性保证（任何槽任务必在 lifecycle==='ready' 期入队，槽执行时 lifecycle 变化只可能是 close 排空，而排空任务恰不得拒绝）。无既有条款被修订或废止，不构成 evolution；已在 relevant_decisions 追加节第 1 条登记，SA3/SA4/SA7 按此对照。
2. **D7「仅 gate read/mutateRoot/replaceSchema 三能力槽；四个 getter 全生命周期可用」vs ADR-0008「立即停止接纳公共 read 和 write」 → no-conflict（ADR 未覆盖面的解释性裁决）**。表面张力：「公共 read」若广义解读为全部读取类方法，则 getSchemaEnvelope/getMetadata/getActiveSchema/getStatus 应一并停用。裁决论证：(a) ADR 自身的 status 模型恰命名四个能力槽「lifecycle、read、ROOT write、SCHEMA write」——「read」是能力名（路径投影读取，读取能力节唯一公共读方法），与「另提供同步只读投影」段的 getter 分列；(b)「接纳」是排队概念，仅对进入 sequencer 或产生副作用的能力操作有意义，getter 是零副作用瞬时投影；(c) getStatus post-close 可用是 ADR close 语义的必要条件（'closed' 仅经 status 可观测，简报 AC/红灯锚全依赖）；(d) getter 契约无失败通道（`SchemaEnvelope | null` / 同步返回），gate 它们只能发明 throw（违反读取面「只有 internal bug 才抛异常」的纪律延伸）或静默 null（虚假降级）；(e) #89 R3 边界先例（外部违约 release 后投影面继续观察 live Y.Doc）+ ADR-0006「引用归零仅使缓存项成为可驱逐候选」——post-close 纯内存读不违反 lease 语义（lease 约束的是持久层操作，非 doc 对象读取）。**裁决性质**：ADR 对 getter post-close 行为无明文条款——这不是对既有决策的修订（无条款可违反），而是未覆盖面的收口；设计自标为开放问题 O2 并声明「若复审判定应收紧须升级总控」，处置正确。已登记 relevant_decisions 追加节第 2 条；后续任何收紧属新决策，须走总控，不得由 SA 擅断。
3. **D3/D9 close 失败通道形状（thenable 守卫、`NamespaceRuntimeCloseError` 不导出、NSRT-CLOSE-RELEASE-FAILED 码）vs ADR-0008「失败时 close Promise reject」+「稳定且不含原始 Error/stack……的 close issue 摘要」 → no-conflict（ADR 未定形状内的最小公共面选择）**。ADR 只规定 reject 事实与 status 摘要的稳定纪律，未定 rejection 值类型与稳定码字面量。设计：恒定 message 的包内 branded 类 + `cause` 零信息损失 + 摘要冻结 {code,message}——满足「稳定」「不含原始 Error/stack」；分类消费走 ADR 明文提供的 `getStatus().close`；不导出沿「Runtime 不公开……」窄面纪律与 NamespaceRuntimeConstructionError 先例（RuntimeWriteFatalError 导出的依据是 ADR 点名其为 rejection 值形状且「上层不得自动重试非幂等写」需要判别面；ADR 对 close rejection 无同名条款，二者不对称有据）。非 thenable release → loud 失败通道而非静默成功，与 ADR-0006「响亮拒绝」哲学一致（契约违背不虚假降级）。SA6 已把三个字面量（RUNTIME_READ_DISABLED / RUNTIME_WRITE_DISABLED 复用 / NSRT-CLOSE-RELEASE-FAILED）明文让渡给 SA1，属任务内授权。已登记 relevant_decisions 追加节第 3–6 条。

其余关键对照（佐证无冲突，摘要）：

- **D2/INV-C1/C2 vs close 幂等条款**：「首次调用同步进入 closing」（同步段写 state，`close()` 返回前可观测）、「幂等」（closePromise 缓存——并发/已结算后同一实例，是「后续 close 返回同一个已结算 Promise」的强化满足）、「队尾 barrier」（enqueue 经 .then 排程，thunk 绝不在 close() 调用栈内同步执行——「同步进 closing」与「barrier 后置」同时成立，§12 #1 依据属实）逐句对应。
- **D4 read 联合宽化** = ADR「预期路径、载体和 lifecycle 失败使用同步结果联合，只有 internal bug 才抛异常」的兑付（Phase 0 关键对照 7 预言的约束被设计显式遵守：非抛、非 Promise、不触碰 live Y.Doc）；gate 先于透传，「read 拒绝不等待 P0」与「读取不等待 P0……也不进入 sequencer」纪律同构。
- **D5.1 即时结算 `Promise.resolve(disabled)`**：「立即停止接纳」的执行器——接纳拒绝不是排队任务；#90「不同步 throw、不同步结算」纪律的辖域是**已接纳路径**的 FIFO 定序（ADR「写方法调用时同步决定接纳顺序」），不约束拒绝路径；拒绝仍经返回 Promise settle 领域联合（ADR「普通、可预期且零写入的……写入失败使用领域化结果联合」），两纪律并存不冲突。
- **D5.3 fatal gate 原样**：fatal 后（lifecycle 仍 ready）新写照常入队 → S1 拒绝 = ADR「已排队的后续写仍按 FIFO 取得槽，且不访问输入、零写入返回 RUNTIME_WRITE_DISABLED」逐字节维持；接纳门先判 lifecycle、槽内先判 fatal，两域正交（D8 表）。
- **D6 七键/三态/短路**：键集恰 ADR 明文七能力面；closing/closed 期三能力位恒 false 是「立即停止接纳」的真话投影；read.enabled 与 fatal 无关（fatal 保留读取）；「不暴露队列长度、任务类型或 sequence」「无数组值字段」维持；`closeIssue ?? null` 无 undefined 值键。
- **D8 fatal×close 正交表**：fatal 摘要不受 close 影响 / close 后 read 由 true 转 false / 排空期 fatal 照常 settle 且链尾恒绿保证 barrier 不断裂——ADR fatal 五 bullet 与 close 条款在交叉场景下无一条被违反。
- **INV-C10 术语分域**：fatal 域零字节改动——Phase 0 注记 N3（非 ADR 基准纪律）在设计内显式维持；close 域 message 无原始异常/stack 泄漏面。
- **INV-C11 十键面**：+close 恰为 ADR「close() 幂等」公共方法的落位；无事件键 = 「v1 不提供公共事件订阅」。§0「内部日志/metrics 面也不建设」不违反「队列进度……属于日志、metrics 与 trace」（ADR 定归属，未定工期）。
- **D10 seam 守卫**：ADR-0008「测试通过包内确定性 seam 注入可控 P0、dirty notifier、handle 与 fault」授权 seam 注入；V1 形状守卫家族扩展（INV-N4）非 ADR 事项，grep 实证零回归。
- **§8/§11 零回归与 DENY LIST**：写槽/sequencer/projection/fatal 通道全部 DENY 或零改动；`docs/adr/**`、`CONTEXT.md` 明列 DENY——与 Phase 0 N1「兑付非演进」一致，无 ADR 修订意图。
- **D11 导出面**：+2 类型导出（read 结果联合名名化）不触碰「Runtime 不公开 handle、Y.Doc、ROOT/SCHEMA/META live 引用或生产构造器」；版本 bump 属 HG #9（Phase 0 注记 N4，非基准）。

## 结论

**Verdict: `clear`，冲突点 0，裁决分布：no-conflict ×8（ADR 层面）+ 0 evolution + 0 override-declared + 0 hard-violation；CONTEXT.md 术语无漂移。**

设计 R1 是 ADR-0008「生命周期、状态与所有权」+「Fatal 与失败通道」条款的直接兑付：close 条款逐句映射（D2/D3），七键 status 即 ADR 明文形状（D6），fatal 通道零改写（D5.3/§8），read/write 停接纳分别走 ADR 指定的同步结果联合与领域化结果联合（D4/D5.1——Phase 0 关键对照 7 的两条约束均被显式遵守）。三处最接近边界的裁决（D5.2 lifecycle gate 位置、D7 getter 边界、D3/D9 close 失败通道形状）均判为条款联合满足/未覆盖面收口/未定形状内的实施选择，非决策修订；其中 D7（getter post-close 可用）为 ADR 未覆盖面的解释性裁决，设计已自标 O2 并预留升级通道。设计引入的新决策点 9 条已追加至 `task_namespace-runtime-fatal-status-close_relevant_decisions.md`「设计后复审追加」节，供 SA3/SA4/SA7 对照；后续设计修订若反转其中任何一条的语义方向需回 SA8 复审。

**无需 override、无需 Jim 裁决条目，设计放行**——可交 SA2 全维度攻击评审（设计优劣与攻击面不在本门禁范围）。
