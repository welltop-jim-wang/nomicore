# 冲突门禁报告

- 被审对象：`wiki/raw/task_doc-runtime-atomic-root-replace.md`（Issue #88，功能开发，Phase 0 前置门禁）
- 冲突基准：`docs/adr/0001`–`0008` 全集（8 份，逐个全读）+ `CONTEXT.md`
- 门禁阶段：前置门禁（SA 派发之前）
- 产出日期：2026-08-23（SA8）

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19 目标态/阶段态修订、2026-08-21 SCHEMA 命名修订） | 弱相关（SCHEMA/ROOT 顶层具名条目命名） | no-conflict：任务只作用 ROOT 子树，不触及 schema 文本/真相源条款 |
| ADR-0002 | nomicore 是全新重写，authority 出范围 | accepted | 无关 | no-conflict：任务不含 authority 规则内容 |
| ADR-0003 | 求值器与派生 schema（ROOT 约定、联合表示、XML 不透明） | accepted | 相关（ROOT 固定物化 Y.Map、`doc.getMap('ROOT')`、YXmlFragment 终态不透明） | no-conflict：AC「顶层 `doc.getMap('ROOT')` identity 保持」「全部载体种类」与 ROOT 物化/载体语义一致 |
| ADR-0004 | vfsl-protocol 类型投影五决策 | accepted | 弱相关（D5：ROOT 是 doc 级固定挂载点） | no-conflict：保留顶层 identity 与固定挂载点模型同构 |
| ADR-0005 | 投影生成管线 | accepted | 无关 | no-conflict：编译期投影轨道与本任务无交集 |
| ADR-0006 | 持久化插件与 doc 三条目布局 | accepted（含 issue #64、#79 owner 裁决演进修订） | 弱相关（ROOT 数据根定位；Y.transact 单事务原子性；save 失败不回滚） | no-conflict：单 transaction 清空并安装与「事务原子性由 Y.transact（单 update 单元）保证」一致 |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge 分层 | accepted（Runtime/open/read 条款被 ADR-0008 部分取代；logical validation、detached materialization、validated mutation、零写入、observer no-rollback 继续有效） | **核心相关** | no-conflict：见下方逐条对照 |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器 | accepted | **核心相关**（任务即其「必要的底层演进」第 3 条的直接落实，并触及第 2 条契约合规） | no-conflict：见下方逐条对照 |
| CONTEXT.md | 术语与硬性惯例 | 现行 | 相关（ROOT、零写入、逻辑快照校验、标记类型拼写契约、写序列器、active schema 等） | no-conflict：术语用法与任务描述一致 |

## 冲突点

（无——逐条对照未发现任何冲突点；裁决分布：no-conflict × 全部，override-declared × 0，evolution × 0，hard-violation × 0）

逐条对照明细（被审对象验收标准 → 冲突基准条款）：

| # | 被审对象要求 | 对照基准条款 | 裁决 | 依据 |
|---|---|---|---|---|
| 1 | 「materializeRoot 与新替换能力复用同一个 detached builder，不复制 Y.Map/Y.Array/XML/plain 构造规则」 | ADR-0008「3. SCHEMA replacement 可复用 detached builder 与原子 ROOT-content replacement helper，不复制 materialization 逻辑。」 | no-conflict | 任务要求即 ADR 原文的直接落实 |
| 2 | 「detached builder 保持包内能力，不作为业务公共 API 或可跨时间执行的 prepared mutation 暴露」 | ADR-0007「不公开可跨时间执行的 prepared mutation，避免 TOCTOU」；ADR-0007「`materializeRoot`……唯一公共物化入口」；ADR-0008「Runtime 不公开 handle、Y.Doc、ROOT/SCHEMA/META live 引用或生产构造器」 | no-conflict | 与封装边界条款完全同向；materializeRoot 仍是唯一公共物化入口 |
| 3 | 「完整验证和 detached 构造成功后，才允许 transaction 内清空并安装 ROOT 内容」 | ADR-0008「提供 `root` 时，将其视为最终完整 logical ROOT snapshot，验证并 detached 构造完整新内容；」「新 SCHEMA 的编译、最终 ROOT 校验或 detached 构造失败均发生在 transaction 前，SCHEMA/ROOT 零写入」；ADR-0007 materializeRoot「内部先执行 `validateLogicalSnapshot`，再构造……detached Yjs 子树」 | no-conflict | 验证/构造前置与 ADR 管线顺序一致 |
| 4 | 「顶层 doc.getMap('ROOT') identity 保持，旧子类型 identity 可失效」 | ADR-0008「提供完整 ROOT 时保留顶层 `doc.getMap('ROOT')` identity，在同一 transaction 内清空并安装已 detached 构造的内容；其下旧 Yjs 子类型 identity 可失效。」；CONTEXT.md ROOT「ROOT 固定物化为 Y.Map，Yjs 映射为 doc 根 `getMap('ROOT')`」 | no-conflict | AC 措辞即 ADR-0008 原文；（注：ADR-0007 mutation `set([])`「旧 Yjs 子类型引用失效，不做 identity-preserving diff」针对子类型 identity，与本条顶层保留要求不矛盾，二者作用对象不同） |
| 5 | 「前置验证/构造失败时 Y.Doc state/update 零变化」 | ADR-0007「零写入承诺覆盖所有验证失败和 detached 构造失败」「验证或构造失败时目标 doc 零写入」；CONTEXT.md 零写入「校验失败 → 400 且文档不变」 | no-conflict | 与零写入条款逐字同向 |
| 6 | 「transaction observer/fatal 服从 committed-aware no-rollback 契约」 | ADR-0008「2. transaction helper 提供 committed-aware branded fatal contract」「不补偿、不 fallback、不声称 rollback」；ADR-0007「Yjs observer 不得向事务调用栈抛异常……不虚假声称自动回滚，也不尝试 fallback」 | no-conflict | 任务承诺服从既有契约，非推翻 |
| 7 | 「行为测试覆盖空/非空 ROOT、全部载体种类、构造失败和 observer 边界」 | 无反向约束条款（ADR-0007 失败边界、ADR-0003 载体语义为测试对象定义） | no-conflict | 测试要求不与任何 ADR 条款冲突 |
| 8 | 「全量 typecheck/test 和 Node 20/24 CI 通过」 | 无冲突条款 | no-conflict | 工程纪律类要求 |

补充核对（无冲突）：

- 新替换能力「清空并安装到非空 ROOT」**不违反** ADR-0007 materializeRoot 的「确认目标 ROOT 为空后……不覆盖、不合并、不 fallback」——该条款约束 materializeRoot 自身（创建路径）；清空-安装到非空 ROOT 是 ADR-0008 明文授权的独立 helper 职责（「在同一 transaction 内清空并安装已 detached 构造的内容」），materializeRoot 契约保持不变。
- ADR-0007 已被取代的仅是 Runtime/open/read 条款（被 ADR-0008 取代）；本任务依赖的 detached materialization / 零写入 / observer no-rollback 条款属继续有效部分，且 ADR-0008 无一 superseded。
- 无任何 ADR 处于 superseded-by 状态（ADR-0007 仅为部分条款被取代，取代范围已在报告中显式圈定）。

## 结论

**Verdict：`clear`——放行，可进入 SA 派发。**

- 冲突点数：0；裁决分布：no-conflict × 8 项验收标准 + 3 项补充核对，override-declared × 0，evolution × 0，hard-violation × 0。
- 无需 override 声明，无演进（evolution）条目上报 Jim 裁决。
- 定性注记：本任务是 ADR-0008「必要的底层演进与实施顺序」第 3 条（复用 detached builder 的原子 ROOT-content replacement helper）的直接实现票，其全部验收标准均可在 ADR-0007（继续有效部分）/ ADR-0008 / CONTEXT.md 中找到同向条款，无一处要求推翻既有决策。
- 全链 SA 复用的约束清单见：`wiki/raw/task_doc-runtime-atomic-root-replace_relevant_decisions.md`。
