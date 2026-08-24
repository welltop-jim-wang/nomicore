# 冲突门禁报告（设计后复审）

- 被审对象：SA1 设计文档 `wiki/raw/task_namespace-runtime-write-sequencer_design.md`（R1 初版，2026-08-24，769 行，全读）
- 冲突基准：同 Phase 0——`docs/adr/` 全集 8 份（accepted，无 superseded 终态；Phase 0 已全读，本次按设计触达条款增量对照，不重复全量盘点）+ 根目录 `CONTEXT.md` + SA8 前置门禁产出（relevant_decisions 清单及其 N1–N5 注记）
- 审查范围：设计与 ADR 决策集一致性。设计优劣与攻击面属 SA2（破壁人）；实现质量属 SA4/SA7。

## Verdict

`clear`

## ADR 盘点（设计触达条款 → 对照结论）

| 编号 | 状态 | 设计触达条款 | 对照结论 |
|---|---|---|---|
| ADR-0008 | accepted | 单一 write sequencer 节（槽序/快照/notifyDirty/degraded）、ROOT write 节、Fatal 与失败通道节（ROOT 部分）、读取能力节、生命周期节、必要底层演进节 | **no-conflict**。D2 槽体 S1–S7 与「每个真正写任务的槽依次执行：lifecycle/fatal gate、`DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务」逐位对应；两处实施细化（D6.4 notifier gate、D5 fatal phase 扩充）经裁决为条款执行器而非条款修订（见对照明细 1/2） |
| ADR-0007 | accepted（Runtime/open/read 条款被 ADR-0008 取代，其余有效） | validated mutation 管线、零写入、observer no-rollback、「业务调用方不得取得可写 Yjs 引用或绕过该入口」、`{ok:true}` 成功形状、窄结果联合映射、公共入口名目 | **no-conflict**。S5 唯一 Y.Doc 写入口 = `applyValidatedMutation`（INV-W6 无旁路）；MutateRootResult 成功分支恰 `{ok:true}`；D8 恢复 index.ts 导出兑现公共入口条款（Phase 0 注记 N2）；§6.2 #18 以「不得取得可写 Yjs 引用」条款界定 E202 窗口 B 外部违约者出局；被取代部分（schema-aware read / open 编排）零接触 |
| ADR-0006 | accepted（含 #64、#79 修订节） | saveDoc=dirty notification、degraded 不构成拒绝理由、gate 后降级仍登记、getStatus entry 级瞬时观察、released/disposed 状态词 | **no-conflict**。§6.2 #4/#12 与 #79「gate 检查通过后才转为 degraded 的 mutation 不属『后续』写入：其内存事务保留、saveDoc 正常登记」逐句对应；S2 瞬时观察（「`getStatus()` 只表示调用瞬间状态」）；S6 在 degraded 窗口照常登记（saveDoc 契约） |
| ADR-0003 | accepted | ROOT 固定物化 Y.Map / `doc.getMap('ROOT')`（经 doc-runtime 管线间接消费，本层零触碰） | **no-conflict** |
| ADR-0001 | accepted | 「代码库不含 schema 文本（测试 fixture 除外）」 | **no-conflict**。设计 §0 禁止事项明列「不在 src 运行时代码内置 schema 文本」 |
| ADR-0002 | accepted | authority 出范围、写管线「结构→值→单事务提交」 | **no-conflict**。写槽校验全部经 VFSL 值语义管线，无 authority 类不变式 |
| ADR-0004 | accepted | （无触达——编译期类型投影轨道） | **no-conflict**（不适用） |
| ADR-0005 | accepted | （无触达——生成管线轨道） | **no-conflict**（不适用） |

CONTEXT.md 术语对照：写序列器（「前项完成 dirty notification 后下一项才执行；读取不进入该序列」→ INV-W7/W10）、active schema（「SCHEMA write 的 transaction 成功后同步切换」→ SCHEMA write 延后、activeTools 切换机构不动，§0/D4）、零写入（INV-W6/W8 disabled 路径）、P0（「不读取或验证 ROOT」→ p0.ts 零改动）——全部一致，无术语漂移。

## 冲突点

无。

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | 无冲突点（0 hard-violation / 0 override-declared / 0 evolution） |

## 边界对照明细（最接近冲突的三处，均裁决 no-conflict）

1. **D6.4「notifier 未绑定 = loud gate」是 ADR-0008 槽序未列的增补步骤 → no-conflict（实施细节，非决策演进）**。ADR 槽序七步未含「notifyDirty 绑定检查」；设计在 S2 gate 簇增补。裁决依据：ADR 明文「notifyDirty 是由构造方绑定 `persistence.saveDoc(handle)` 的窄接缝」——绑定是 ADR 自身规定的构造方义务，设计只是把该义务从「假设已履行」变为「loud 执行器」（未绑定 → `RUNTIME_WRITE_DISABLED` 零写入），未重排槽序、未跳过任何 ADR 步骤、未修改 notifyDirty 语义。反面方案（缺省 no-op）会击穿 ADR「成功只表示 live commit 与 dirty notification 已登记」的完成信号定义——设计的增补恰是维持该条款的必要措施。ADR 槽序的七步在设计中全部原序保留。不构成 evolution（无修订既有决策内容的意图），已在 relevant_decisions 追加节第 1 条登记，供 SA3/SA4 对照。
2. **D5 fatal phase 新增三相位与 notify-dirty-failed 场景 → no-conflict（ADR-0008 fatal 框架内的场景细化）**。ADR-0008 只点名 doc-runtime 三相位 branded 契约与 post-commit 场景，未枚举 runtime 侧全部相位；设计注册 `'unknown-pipeline-throw'`（保守 committed:true，直接对应 ADR「未知异常保守视为可能已提交」）、`'notify-dirty-failed'`（S6 notifier rejection：事务已提交、登记通道损坏——ADR 槽序要求 await notifyDirty 后才释放，rejection 下成功语义（commit+登记两者）不可能成立，唯一诚实出路是 fatal reject；ADR「不补偿、不 fallback」排除重试）、`'write-slot-internal'`（gate 段零 doc 写，committed:false 与「`committed:false` 不调用 dirty notifier」一致）。全部行为均在 ADR-0008「Fatal 与失败通道」节五条 bullet 的语义域内，无一条与 bullet 冲突；notifier 预算 ≤1 是「best-effort 恰一次」的定量化而非重定义。
3. **D3 snapshotter 拒绝细则超出 ADR-0008 字面列举清单 → no-conflict（「其他非 plain data」兜底授权内的保守展开）**。ADR 字面列举拒绝 accessor、class instance、特殊对象、symbol key、循环引用；设计额外明确 undefined 值、bigint、function、稀疏数组空洞、数组元素 undefined、非索引 own 键、子类数组原型、非 Object.prototype/null 原型、非枚举 own 键。裁决依据：ADR 接受集是**上限**（「只接受 primitive、finite number、null、plain object/array」），该四类正面清单设计全部照收；新增拒绝项全部落入「及其他非 plain data」兜底授权（JSON-compatible 值域外），拒绝侧保守展开不违反上限约束。输入缺陷归 `ok:false` 领域失败（ADR「普通、可预期且零写入的……写入失败使用领域化结果联合」），不误触 fatal 关写。

其余关键对照（佐证无冲突，摘要）：

- **S4/S5 与 active schema**：D4「槽开始时读取当时 activeTools、不绑定调用时 generation」= ADR「ROOT write 在自己的槽开始时使用当时 active schema」直译；unavailable → 零写入 `ok:false` 且 `schemaWrite.enabled` 不受影响 = ADR「正常 compile result failure 仅使 ROOT write unavailable；SCHEMA write仍可修复」直译。
- **S1/S2 gate 段零输入访问**（INV-W3）：是 ADR 槽序「gate 先于输入快照」顺序性质与「已排队的后续写……不访问输入、零写入返回 `RUNTIME_WRITE_DISABLED`」的可观测化，非新增义务。
- **D1 接纳/执行分离**（任何状态可调用、不同步 throw、拒绝一律槽内结算）：ADR「写方法调用时同步决定接纳顺序」+「已排队的后续写仍按 FIFO 取得槽」的忠实展开。
- **INV-W7 notifier 屏障与完成信号**：「事务成功后在同一槽内 await notifyDirty()，resolve 后槽才释放」= CONTEXT.md 写序列器定义「前项完成 dirty notification 后下一项才执行」+ ADR「成功只表示……已登记，不表示已经落盘」。
- **INV-W8/W9 fatal 永久关写 + 队列不毒死并存、committed 诚实分类、cause 保留原始 fatal**：与 ADR「Fatal 与失败通道」节五条 bullet 逐句映射（Phase 0 对照 4 的显式相容性裁决在设计结构中成立——`markWriteFatal` 置位后队列经 S1 持续流转返回 RUNTIME_WRITE_DISABLED）；「始终 reject 原始 fatal」与「以稳定 RuntimeWriteFatalError reject」经 D5.1 cause 载体定约同时成立（relevant_decisions 追加节第 7 条）。
- **§0 延后项态度**（replaceSchema/close/公共事件订阅不实现、只留扩展位）：与 Phase 0 注记 N1 一致——范围切分非条款违反；设计对槽体七步「同样适用于 SCHEMA write」的引用（「每个真正写任务」）与 ADR 原文相符。
- **D8 恢复导出 + mutation.ts 冻结不碰**：Phase 0 注记 N2 的设计内兑现；set-only 直通 = 注记 N3。
- **公共面**：第八键 `mutateRoot` 为方法增广，`RuntimeWriteFatalError` 值导出是 ADR「上层不得自动重试非幂等写」判别面的依赖，不触碰「Runtime 不公开 handle、Y.Doc……或生产构造器」（生产工厂仍包内，D6.3）；status 投影零改动维持「不暴露队列长度、任务类型或 sequence」。
- **§6.2 #8 notifier 挂住无 timeout/无取消**：类比 ADR close「无条件排空、不取消、不设内部 timeout」哲学，ADR 对写槽未设相反条款，无冲突。

## 结论

**Verdict: `clear`，冲突点 0，裁决分布：no-conflict ×8（ADR 层面）+ 0 evolution + 0 override-declared + 0 hard-violation；CONTEXT.md 术语无漂移。**

设计 R1 是 ADR-0008 写侧条款 + ADR-0007 管线条款 + ADR-0006 #79 持久层条款的直接兑付：槽体 S1–S7 与 ADR 槽序逐位对应，fatal 通道五条 bullet 逐句映射，snapshotter 正面接受清单完整保留。三处最接近边界的实施细化（notifier gate、fatal phase 扩充、snapshotter 细则）均裁决为条款执行器/框架内细化而非决策修订，已作为「设计引入的新决策点」7 条追加至 `task_namespace-runtime-write-sequencer_relevant_decisions.md`，供 SA3/SA4/SA7 对照；后续设计修订若反转其中任何一条的语义方向需回 SA8 复审。

**无需 override、无需 Jim 裁决条目，设计放行**——可交 SA2 全维度攻击评审（设计优劣不在本门禁范围）。
