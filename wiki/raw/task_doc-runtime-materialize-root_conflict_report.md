# 冲突门禁报告

- 被审对象：`wiki/raw/task_doc-runtime-materialize-root.md`（任务简报——第 0 阶段前置冲突门禁）
- 冲突基准：`docs/adr/0001`–`0007` 全集（7 份，逐个全读，无抽样）+ `CONTEXT.md`
- 门禁：SA8（run_id: issue-74-1787396362-3288866）
- 任务类型：feature（功能开发）——实现 `materializeRoot(derived, snapshot, doc)`

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR 0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19 目标态/阶段态修订、2026-08-21 `SCHEMA` 命名修订） | 中 | 一致：任务只写 `ROOT` 子树，不触碰 `SCHEMA` 信封；具名条目命名契约（`SCHEMA`/`ROOT`）未被触碰 |
| ADR 0002 | nomicore 是全新 yjs-server 重写，authority 完全出范围 | accepted | 中 | 一致：单次 transaction 安装符合「结构 → 值 → 单事务提交」三步纪律；无 authority 规则复活迹象 |
| ADR 0003 | 求值器与派生 schema | accepted | 高 | 一致：ROOT 固定物化为 Y.Map（`doc.getMap('ROOT')`）、YXmlFragment 为结构树终态节点（XML 字符串投影）、联合 any-of 匹配——均为物化构造的既有依据，任务未偏离 |
| ADR 0004 | vfsl-protocol 类型协议包 | accepted | 低 | 无涉：编译期类型投影轨道，不约束运行时物化；仅共享「ROOT 挂载点知识收敛于 `doc.getMap('ROOT')`」纪律 |
| ADR 0005 | 投影生成管线 | accepted | 无 | 无涉：SchemaSource/生成器/CI 管线与本任务无交集 |
| ADR 0006 | Cordis 持久化插件与 doc 三条目内容布局 | accepted（含 2026-08-21 createDoc/owner、2026-08-22 getStatus 修订节） | 中 | 一致：SCHEMA/META/ROOT 三条目布局及「校验只作用 ROOT 子树」界定物化边界；任务不向持久层引入 VFSL 语义、不改持久化行为 |
| ADR 0007 | 逻辑验证与 Yjs Runtime Bridge 分层 | accepted | **直接** | 完全一致：任务 What-to-build 与 AC-1~AC-6 逐条对应本 ADR `materializeRoot` 条款、结果联合纪律与失败边界，无任何条款被违反或要求推翻 |

无任何 ADR 处于 superseded 状态；ADR 0001/0006 的修订节均为 owner 裁决放行的内部演进，已按修订后文本对照。

## 冲突点

无（0 条 hard-violation / 0 条 evolution / 0 条 override-declared）。

逐条对照明细（全部判 no-conflict，供复核）：

| # | 被审对象条款 | ADR 依据（原文） | 裁决 | 依据 |
|---|---|---|---|---|
| 1 | What-to-build：「实现唯一公共入口 `materializeRoot(derived, snapshot, doc)`……确认目标 ROOT 为空后以一次 transaction 安装」 | ADR 0007：「`materializeRoot(derived, snapshot, doc)`：唯一公共物化入口；内部先执行 `validateLogicalSnapshot`，再构造未集成到任何 doc 的 detached Yjs 子树，确认目标 ROOT 为空后以一次 `Y.transact` 安装。」 | no-conflict | 签名、流程、顺序逐句同义 |
| 2 | What-to-build：「任何验证或构造失败都不得留下目标 doc 部分写入」 | ADR 0007：「验证或构造失败时目标 doc 零写入」「零写入承诺覆盖所有验证失败和 detached 构造失败」；CONTEXT.md 零写入条目 | no-conflict | 零写入承诺原样重述 |
| 3 | AC-1：「logical 失败保留完整 issues；materialization 失败返回单 issue」 | ADR 0007：「逻辑校验保留完整 issues，Yjs 结构与路径/操作错误 fail-fast」「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型」 | no-conflict | 「materialization 单 issue」是 fail-fast 纪律在物化路径上的具体化（ADR 未另作多 issue 规定），结果联合仍按域分离，无条款被触碰 |
| 4 | AC-2：「目标 ROOT 非空响亮失败，不 overwrite、merge 或 fallback」 | ADR 0007：「确认目标 ROOT 为空后以一次 `Y.transact` 安装……不覆盖、不合并、不 fallback」 | no-conflict | 逐词对应 |
| 5 | AC-3：「detached 构造正确区分 Y.Map、Y.Array、Y.XmlFragment 与 plain deep clone」 | ADR 0007：「live Y.Doc 中 `Y.Map` / `Y.Array` / `Y.XmlFragment` / plain value 的实际载体是否符合派生结构树」；CONTEXT.md 标记类型；ADR 0003：「ROOT 固定物化为 Y.Map」「`xml-fragment` 是结构树的**终态节点**」 | no-conflict | 载体四分类、ROOT=Y.Map、XML 终态均为既有契约 |
| 6 | AC-4：「全部构造成功后才执行单次 transaction；前置失败时 Y.Doc state/update 不变」 | ADR 0007 单次 `Y.transact` + 零写入承诺；ADR 0002：「统一写入管线收敛为“结构 → 值 → 单事务提交”三步」 | no-conflict | 单事务安装 + 前置失败零写入即三步纪律 |
| 7 | AC-5：「XML string 物化后提取可再次通过逻辑校验，不要求字符串逐字相同」 | ADR 0007：「XML string 与 Y.XmlFragment 只承诺语义等价 round-trip，不承诺字符串逐字相同」；ADR 0003 §5 XML 字符串投影条款 | no-conflict | 语义等价承诺原样重述（提取侧 `extractYjsSnapshot` 亦为 ADR 0007 既有入口） |
| 8 | AC-6：「observer 抛错边界按 ADR 0007 处理，不虚假承诺事务回滚」 | ADR 0007 失败边界：「Yjs observer 不得向事务调用栈抛异常……事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback」 | no-conflict | 显式援引并遵守该 ADR 条款 |
| 9 | 附带核对：任务未要求持久层行为变更、未触碰 SCHEMA/META | ADR 0006 三条目布局与「看不见 schema 语义」；ADR 0007「持久层继续不理解 VFSL」 | no-conflict | 任务范围收敛于 doc-runtime 物化入口本身 |

## 结论

**verdict = clear，放行。** 无 hard-violation（无需停止）、无 override-declared（无 ADR 被声明推翻）、无 evolution（任务未试图修订任何 ADR 决策，属 ADR 0007 既定条款的实现落地）。本任务简报实质上是 ADR 0007 `materializeRoot` 条款的直接实现票。

非冲突注意事项（转达 SA1/SA3，来自相关决议文档，不构成门禁阻塞）：

1. 实现落位必须在 `@nomicore/doc-runtime` 包（ADR 0007），依赖仅 `@nomicore/vfsl + yjs`；`@nomicore/vfsl` 保持无 Yjs 依赖，持久层不得理解 VFSL。
2. logical 校验入口名为 `validateLogicalSnapshot`（ADR 0007 更名后无兼容 alias；CONTEXT.md _Avoid_: validateSnapshot）。
3. ROOT 顶端固定物化为 Y.Map（`doc.getMap('ROOT')`，ADR 0003/CONTEXT.md），只写 ROOT 子树，不触碰 SCHEMA/META（ADR 0006 布局）。
4. 结果联合按域分离：logical 保留完整 issues、materialization fail-fast 单 issue，不得合并成巨型 issue 类型（ADR 0007）。
5. XML 叶子为结构树终态：物化仅承诺语义等价 round-trip（ADR 0003 §5 / ADR 0007），AC-5 不得收紧为逐字相同断言。
6. observer 边界：不得虚假承诺事务回滚（ADR 0007 失败边界），AC-6 已正确对齐。
