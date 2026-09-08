# 冲突门禁报告

- 被审对象：GitHub issue #237 任务简报（优化 Namespace mutation：用路径级校验替代完整 ROOT 复制与全量校验）+ Owner 全部 3 条评论（welltop-jim-wang：2026-09-05T16:01Z 范围收敛「旧文档合法性作为前置条件」、2026-09-05T16:08Z「Yjs carrier 正确性与校验架构」follow-up 记录、2026-09-06T02:55:36Z「生产证据补充：高频小 UPDATE」benchmark 要求）
- 冲突基准：`docs/adr/` 全集 11 份（0001–0010、0012，无 0011；逐个全读，含 `1c8b907` 2026-09-05 修订后的 ADR-0007/0008 最新文本）+ `CONTEXT.md`
- 门禁阶段：前置门禁（SA 派发之前）
- 产出日期：2026-09-06（SA8，dispatch `sa-aa083ca1-9ef4-4f55-924d-a3ce278a2579`）
- 配套决议清单：`wiki/raw/task_237_relevant_decisions.md`

## Verdict

`clear`

**放行进入后续 SA 派发**；附带 4 条 evolution（演进）登记项与强制 ADR/CONTEXT 修订义务（见冲突点 E1–E4 与结论）。无 hard-violation，无需停止协议。

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 单一真相源 | accepted（含 2026-08-19/08-21 修订） | 弱相关 | no-conflict：不触及 schema 文本、信封、方言冻结、编译缓存与 SCHEMA/ROOT 命名 |
| ADR-0002 | 全新重写，authority 出范围 | accepted | 弱相关 | no-conflict：「结构 → 值 → 单事务提交」三步管线形状保持；无 authority 内容 |
| ADR-0003 | 求值器与派生 schema | accepted | 相关（ROOT map 形、载体区分、联合表示、最近结构边界重建） | no-conflict：路径级校验复用其结构树/联合语义；「最近的结构边界重建整值」本就是其关联的统一写入管线设计（§7） |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 弱相关（D1 数组写入校验入口、D5 ROOT 挂载点） | no-conflict：编译期投影轨道无交集 |
| ADR-0005 | 投影生成管线 | accepted | 无关 | no-conflict |
| ADR-0006 | 持久化插件与 doc 三条目 | accepted（含 #64/#79/#133 修订） | 相关（saveDoc=脏通知、Y.transact 单事务原子性） | no-conflict：benchmark「保持 dirty notification」与该两条款同向；持久层继续不理解 VFSL |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge | accepted（Runtime/open/read 条款被 0008 部分取代；含 1c8b907 修订） | **核心相关** | **evolution（E1）**：`applyValidatedMutation` 管线明文要求完整 ROOT 校验与提交后完整一致性校验，本任务以路径级/边界级校验取代；但 ADR-0007 后果条款本身预告该优化并设定等价性测试前置 |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 #93/#132 修订） | **核心相关** | **evolution（E2）**：§ROOT write 管线文本镜像 ADR-0007 完整校验措辞，需同步修订；公共 interface、slot 顺序、fatal、封装边界全部保持 |
| ADR-0009 | Registry、租约与 Host 生命周期 | accepted（含 #131/#134 修订） | 相关（唯一 Runtime/sequencer；create 路径全量校验） | no-conflict：sequencer 不变量保持；create/replaceSchema 的全量校验（合法性建立点）不动 |
| ADR-0010 | Hub/Peer WS Y.Doc 复制 | accepted（含 #134/#133/#161/#172 修订） | **核心相关**（L107 replication-unvalidated 后备句） | **evolution（E3）**：「后续普通业务写仍按现有完整 ROOT 校验，可能被拒绝」的后备语义随本任务收窄为路径级；Owner 评论明示 replication 合法性重建另票处理 |
| ADR-0012 | 实例身份与 WS plugin 所有权 | accepted | 无关 | no-conflict |
| CONTEXT.md | 术语与硬性惯例 | 现行 | **核心相关** | **evolution（E4）**：「复制未校验」「逻辑快照校验」两词条的后果/用法清单需同步修订；其余词条与本任务同向 |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| E1 | evolution | ADR-0007「`applyValidatedMutation`……同步完成当前 ROOT 结构/逻辑检查、在普通 JSON 副本中模拟 mutation、完整 ROOT 逻辑校验……transaction 返回后重新提取 live ROOT，并与已校验的 proposed logical ROOT 做完整一致性校验」；「当前 ROOT 已损坏时普通 mutation 失败」；后果「validated mutation 为正确性继续执行完整 ROOT 提取与逻辑校验」（含 1c8b907 修订文本） | Issue #237 + Owner 评论 1：删除 ordinary-write 热路径旧完整 ROOT `validateLogicalSnapshot`；不建 committed-generation/document-baseline 状态机；只沿 mutation path 提取、重建、校验最近必要语义边界（schema 必要时可退化到 ROOT）；AC「提交后 internal invariant 检查不会无条件重新提取并校验完整 ROOT」 | evolution | 冲突是实质性的（现文逐字要求完整 ROOT 校验/完整一致性校验），但演进意图与授权链完备：(a) ADR-0007 后果条款原文「继续优化完整校验成本时必须保留行为等价测试」预告了本优化并把等价性测试设为前置（issue AC 已含等价性测试）；(b) `1c8b907`（2026-09-05，Jim Wang）刚把「提交阶段只修改目标 carrier」落档，同一演进方向；(c) Owner 2026-09-05T16:01Z 评论明文改范围：「删除写入热路径中对旧完整 ROOT 的 validateLogicalSnapshot()；不为第一阶段引入 committed generation / document validation baseline 状态机」并重写验收标准。按 docs/AGENTS.md「Amend or supersede prior decisions explicitly instead of silently contradicting them」与本仓既有修订节模式（ADR-0006 #64/#79、ADR-0008 #93/#132 均为 owner 授权 + 显式修订节），**本任务必须随代码交付 ADR-0007 显式修订节**，逐条登记：热路径旧 ROOT 全量校验删除、新写合法性前置假设（含 logical values + carrier topology）、边界级 proposed 校验、提交后局部验证替代全量一致性校验、损坏条款「当前 ROOT 已损坏时普通 mutation 失败」收窄为 mutation 路径/边界内损坏 |
| E2 | evolution | ADR-0008 §ROOT write：「每笔写按 ADR 0007 的 validated mutation 管线检查当前 ROOT、在普通 JSON 副本中模拟并校验完整 proposed ROOT……事务后验证 live ROOT 与 proposed ROOT 一致」 | 同上（同一演进在该 ADR 的镜像条款） | evolution | 与 E1 同源同授权；修订 ADR-0007 时必须同步修订 ADR-0008 该句，保持两文一致（ADR-0008 明文以「按 ADR 0007 的 validated mutation 管线」引用，单一真相源纪律）。该节其余约束不变：ROOT write 用槽开始时 active schema、单 guarded transaction、非空路径不重建完整 ROOT、SCHEMA write 全量校验不动 |
| E3 | evolution | ADR-0010 §Trusted raw update：「Raw merge 后 ROOT 可能不符合当前 SCHEMA……后续普通业务写仍按现有完整 ROOT 校验，可能被拒绝。」；CONTEXT.md「复制未校验」词条同义句「它可能导致后续普通业务写因当前完整 ROOT 不合法而失败」 | Owner 评论 1：「replication、损坏存量数据和不可信恢复状态如何重新建立合法性，不属于本 Issue 第一阶段范围，可后续单独处理」；「不再要求本 Issue 建立'不可信旧文档状态'的全局基线机制；应增加测试证明 mutation 不会访问、复制或校验无关 ROOT 分支」 | evolution | 现文把「后续普通业务写全量校验」登记为 replication-unvalidated 状态的可观测拒绝通道；本任务第一阶段后该通道收窄为「mutation 触达路径/边界内的非法数据仍响亮拒绝，无关分支不再被普通写发现」。这正是 Owner 明示让渡并另票处理的面。**任务必须**：(a) 在 ADR-0010 该句登记修订（后续普通业务写按路径级/边界级校验，全局重建合法性另行处理）；(b) 在修订文本中显式登记 follow-up 义务（replication/corrupt-存量/不可信恢复的合法性重建 + carrier 覆盖面审计，Owner 评论 2 第 6 节已列拆分方向），不得静默留白；(c) 测试需锚定「无关分支非法数据不再导致普通写失败」是**已声明的语义**而非疏漏。注意 ADR-0010 同段「不得采用先 apply、失败再回滚」与 Owner「校验失败必须在接触 live Y.Doc 前决定，禁止 live-doc write 后 undo」完全同向，无冲突 |
| E4 | evolution | CONTEXT.md「逻辑快照校验」词条：「创建前校验、写入前校验、迁移后体检、测试与管理端点共用该入口」；「复制未校验」词条（见 E3）；「载体投影读取」词条：「创建与受控写入负责建立并维持数据不变量」 | 同 E1/E3（词汇层登记） | evolution | 词汇是共享权威（docs/AGENTS.md：改变域术语须更新 CONTEXT.md）。「写入前校验」用法在 ordinary-write 热路径删除后需改为「创建前校验、SCHEMA replacement/迁移后体检、管理端点与测试共用；ordinary write 用路径级/边界级校验」一类措辞；「复制未校验」后果句与 E3 同步收窄；「载体投影读取」的不变量维持职责需注明以 phase-1 前置假设为条件（归纳维持：合法基线 + 边界合法 ⇒ 全局合法）。本任务交付必须含 CONTEXT.md 词条修订 |

裁决分布：no-conflict × 8 份 ADR/条款群 + 4 项补充对照；**evolution × 4（E1–E4，同一授权链）**；override-declared × 0；hard-violation × 0。

## 逐条对照明细（被审对象要求 → 冲突基准条款，无冲突部分）

| # | 被审对象要求 | 对照基准条款 | 裁决 | 依据 |
|---|---|---|---|---|
| 1 | `mutateData()` 公共 interface 与结果联合不变 | ADR-0008「v1 公开两个窄方法」+ 稳定码注册修订节；CONTEXT「Data」 | no-conflict | 任务明文承诺不改公共面 |
| 2 | ordinary mutation 继续走唯一严格 FIFO write sequencer | ADR-0008「单一 write sequencer」；ADR-0009「同一 namespace 的所有受控写保持唯一 Runtime 和唯一 sequencer」；CONTEXT「写序列器」 | no-conflict | 与安全不变量同向 |
| 3 | 校验失败零 Y.Doc 写入、零 dirty notification | ADR-0007 失败边界「零写入承诺覆盖所有验证失败和 detached 构造失败」；ADR-0008 槽序（校验在 transaction 前）；CONTEXT「零写入」 | no-conflict | 局部校验仍属槽内「领域校验」步，失败点前移不改零写入语义 |
| 4 | 校验失败在接触 live Y.Doc 前决定；禁止 live-doc write 后 undo | ADR-0007 失败边界 + observer no-rollback；ADR-0008「不补偿、不 fallback、不声称 rollback」；ADR-0010「不得采用'先 apply、失败再回滚'」 | no-conflict | 三处条款与 Owner 要求逐字同向；detached 预演 + 单次 guarded transaction 即既有形状 |
| 5 | 成功写入保持最小 edit、单 guarded transaction、同槽 dirty notification、保留不相关 carrier identity | ADR-0007（1c8b907）「只修改目标 carrier……不重建无关 carrier」；ADR-0008 槽序「一次 Yjs transaction、`await notifyDirty()`」；ADR-0006「saveDoc = 脏状态通知」「事务原子性由 Y.transact 保证」 | no-conflict | benchmark「保持 dirty notification 与 wire update count」正是对这些条款的行为锚定 |
| 6 | 沿导航路径检查 carrier 类型；carrier 正确性 = carrier topology + logical value；不实例化不匹配 carrier | ADR-0007 分层（vfsl 无 Yjs 依赖；doc-runtime 消费结构树与 live carrier）；「extractYjsSnapshot……严格验证实际 Yjs 载体」；ADR-0003 结构树/标记类型；CONTEXT「结构树」「标记类型」 | no-conflict | 局部 carrier check 是既有分层职责的局部化，不是新语义；Owner 提议的 `validateDocument`/`validateMutationBoundary` 内部接口保持 vfsl 纯净，与「不应仅为 carrier 校验而让 VFSL 核心直接依赖 Yjs」一致 |
| 7 | 判别联合、Record、optional、数组边界、嵌套引用与完整快照校验行为一致；批量 array-insert/array-delete 整体校验（不逐元素独立校验） | CONTEXT「重建校验」（最近结构边界合并当前值后按完整子 schema 校验）；ADR-0003 §3（判别式、any-of）；`docs/phases/phase-2-engine-gaps.md` H2（validatePatch 家族既定能力） | no-conflict | 复用/扩展 `packages/vfsl/src/validate-patch.ts` 属既定轨道；issue 明令优先复用而非在 doc-runtime 重复实现 schema 解释 |
| 8 | schema 语义要求更大上下文时安全退化到更高边界直至 ROOT | ADR-0007 validated mutation 概念（set([]) 全量路径仍存在）；ADR-0008 replaceSchema 全量校验不动 | no-conflict | 退化上限即既有全量管线，行为覆盖闭包 |
| 9 | 不建 committed-generation/document-baseline 状态机；槽开始时用当时 active schema | ADR-0008「ROOT write 在自己的槽开始时使用当时 active schema；它不绑定调用时 schema generation」；P0 词条（P0 不读不验 ROOT，本就不是合法性建立点） | no-conflict | 现决策集无任何基线状态机要求；不建状态机与「不绑定 generation」同向 |
| 10 | 合法性建立点保持：create 全量校验、SCHEMA replacement 全量校验（含载体证明） | ADR-0009 create「按 proposed schema 原样封闭校验完整 ROOT」；ADR-0008 SCHEMA write「严格提取并验证当前 ROOT，证明逻辑值与实际载体均已兼容」 | no-conflict | phase-1 前置假设的归纳基点在 create/replaceSchema，均不在本任务改动面 |
| 11 | benchmark/instrumentation：大 ROOT、连续五笔叶子 mutation（fake clock 压缩 30s 周期）、证明无关分支不访问/复制/校验、保持 dirty notification 与 wire update count；不把 #238 replication latency 归因于本 issue | ADR-0007 后果「owned Yjs update 与实际变更规模相关」；ADR-0006 脏通知；ADR-0008 status「不暴露队列长度……队列进度和内部事件属于日志、metrics 与 trace」；ADR-0010 以 `docs/protocols/instance-replication-v1.md` 为唯一 wire contract | no-conflict（附约束） | 证据要求与既有条款同向；**约束**：instrumentation 不得借机扩大公共 API/事件订阅面（测试内部 seam 可以）；#238 归因纪律是报告层要求，无 ADR 冲突 |
| 12 | 提交后 fatal 分类与 post-write invariant 保障不削弱 | ADR-0007「偏离属于已提交 fatal，不回滚、不补偿」；ADR-0008 committed-aware fatal 契约 | no-conflict | 局部验证仍须区分可预期零写入失败与 committed fatal；E1 修订不得触碰 fatal 语义 |

## 结论

**Verdict：`clear`——放行，可进入 SA 派发（功能开发/性能优化管线）。**

- 冲突点数：4 项 evolution（E1–E4，同根同源：ordinary write 校验范围从完整 ROOT 收窄到 mutation 路径 + 最近必要语义边界，前置假设「mutation 开始前 committed ROOT 已符合 active schema（含 logical values 与 carrier topology）」）；override-declared × 0；hard-violation × 0。
- 授权链完备，无需额外 Jim 裁决即可推进：ADR-0007 后果条款（「继续优化完整校验成本时必须保留行为等价测试」）本就预告本优化；`1c8b907`（Jim Wang，2026-09-05）完成同向第一步（提交阶段最小化）；Owner 于 issue #237 三条评论（2026-09-05/06）明文授权范围收敛、carrier 前置、benchmark 证据面。
- **随任务交付的强制义务**（SA1 设计必须纳入、SA3 实现、SA4 复核）：
  1. ADR-0007 显式修订节（E1）+ ADR-0008 §ROOT write 同步修订（E2）+ ADR-0010 L107 句修订与 follow-up 登记（E3）+ CONTEXT.md 词条修订（E4）——按本仓「owner 授权 + 显式修订节」既有模式，引用 issue #237 Owner 评论为授权来源；
  2. 行为等价测试（合法 base/mutation 上增量判定 ≡ 完整 proposed ROOT 全量校验）为 ADR-0007 明文前置，属硬验收；
  3. follow-up 显式登记（不在本票静默留白）：replication/损坏存量/不可信恢复的合法性重建；carrier validation 覆盖面正确性审计（Owner 评论 2 第 1、6 节）；上层同值重复写/五笔合并需 MABF 集成方 origin/path instrumentation 另行确认（Owner 评论 3）。
- 全链 SA 复用的约束清单见：`wiki/raw/task_237_relevant_decisions.md`。
