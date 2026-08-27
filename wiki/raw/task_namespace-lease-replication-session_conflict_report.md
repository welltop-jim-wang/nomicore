# 冲突门禁报告 — issue #134（Phase 5: expose trusted NamespaceLease ReplicationSession）

- 被审对象：`wiki/raw/task_namespace-lease-replication-session.md`（任务简报 round=1，含 7 条 AC 与边界声明）
- 冲突基准：`docs/adr/` 全集 10 份（逐个全读）+ `CONTEXT.md` + 简报点名的 phase-5 切片 3/4 文本
- 基线：ebc5419（worktree /home/wangjian/nomicore-fix-issue-134）
- SA8 前置门禁，2026-08-28

## Verdict

`clear`

无 hard-violation、无未声明演进。7 条 AC 全部有权威文本锚点，无 AC 超出 ADR 0010 / phase-5 切片 3/4 授权范围；AC 之间、AC 与非目标之间无互斥。核对中发现的 4 组「表面张力」均可依据基准文本自身条款和解（逐条裁决见下）；另产出 12 项「设计阶段必须显式裁决的开放点」——非冲突，但设计若遗漏会埋雷。

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 单一真相源 | accepted（含修订节） | 弱 | SCHEMA-as-data 为 scratch-check 背景；无条款交集，无冲突 |
| 0002 | 重写范围、authority 出范围 | accepted | 无 | 无交集 |
| 0003 | 求值器与派生 schema | accepted | 无 | 无交集 |
| 0004 | 类型协议包 | accepted | 无 | 无交集 |
| 0005 | 投影生成管线 | accepted | 无 | 无交集 |
| 0006 | 持久化插件（含 #64/#79 修订） | accepted | 是 | peer-degraded「仍调用 saveDoc」与 #79「degraded 不构成 saveDoc 拒绝理由」直接互证；handle 四态词（disposed>released>degraded/ready）为「handle 失效」判据提供词汇。无冲突 |
| 0007 | 逻辑验证与 Yjs bridge（Runtime 部分被 0008 取代） | accepted | 是 | L42「未来原始 Yjs update 必须另设受控验证通道」的预留已被 ADR 0010 L220 正式决定；L54 observer fatal 条款与 ADR 0010 observer 条款经「未知 vs 已知自有 observer」区分解和（见裁决 T-2）。无冲突 |
| 0008 | Runtime 读写能力与单序列器（含 #93/#132 修订节） | accepted | 高 | 唯一 sequencer、槽序、停接纳、status、#132 构造期复制事实投影均被本任务遵守；「persistence-degraded 阻止未来所有 Y.Doc 写」与 ADR 0010 peer-degraded bypass 的张力经 lex posterior + 通道预留决定和解（见裁决 T-1）。无冲突 |
| 0009 | Registry、Lease 与 Host 生命周期（含 #131 修订节） | accepted | 高 | release 同步失效 / released 逐方法通道 / idle / shutdown 为 AC-7 测试面依据；Lease 代理面由 ADR 0010 L73–79 正式增补 openReplicationSession。无冲突 |
| 0010 | Hub/Peer WebSocket Y.Doc 复制 | accepted（2026-08-27） | 最高 | 本任务第一权威；四节冻结条款与 7 条 AC 逐条对齐（见锚点表）。无冲突 |

无整卷 superseded 的 ADR；0007 仅 Runtime/open/read 部分被 0008 取代，其 logical validation / observer no-rollback 底层条款明文继续有效，本核对已按有效条款执行。

## 7 条 AC 依据锚点

| AC | 锚点（文件 + 节/行） | 结论 |
|---|---|---|
| AC-1 openReplicationSession、每 Lease 一个 session、冻结 role/remote/lineage/epoch | ADR 0010 §NamespaceLease 与 ReplicationSession L73–81（`lease.openReplicationSession(options)`；「每个 Lease 首版最多一个 duplex ReplicationSession。Session 创建时冻结 `localRole`、`remoteInstanceId`、`replicationId` 和 `replicationEpoch`」）；phase-5 §实施切片 3 L69–70；CONTEXT.md `ReplicationSession` 词条 L125–127 | 有据；无越权 |
| AC-2 六项窄能力 + 不暴露 Y.Doc/DocHandle/sequencer/live shared types | ADR 0010 L81–88（窄能力清单原文逐项对应）；phase-5 切片 3 L71–73；ADR 0009 L38（Lease 不公开裸 Runtime/DocHandle/Y.Doc）；CONTEXT `ReplicationSession` _Avoid_ 行 L127；runtime AGENTS.md「Public APIs expose detached projections only」 | 有据；「status」= session 独立状态，见 L87「查询独立复制状态」 |
| AC-3 远端 apply 进唯一 write sequencer、槽内完成 dirty notification | ADR 0010 §Trusted raw update L96–103（六步槽序，第 5 步 `await saveDoc(handle)` 后才释放槽）；ADR 0008 L36/L45；CONTEXT `写序列器` L73–75；phase-5 切片 4 L77 | 有据 |
| AC-4 Hub scratch-check SCHEMA/保留 META；ROOT raw 不做 VFSL 预校验（replication-unvalidated） | ADR 0010 L105（scratch clone 检查）、L107（replication-unvalidated、不得先 apply 再回滚、不得虚假 zero-write）、L115–121（SCHEMA/META 权限）；CONTEXT `复制未校验` L129–131；phase-5 切片 4 L78–81；ADR 0010 §非目标 L211 | 有据；raw 绕 VFSL 是 ADR 0010 L94/L220 明示例外（override-declared 性质，属基准内已声明例外，无需本轮 override） |
| AC-5 peer degraded 只许已认证 hub→peer trusted apply；本地业务写仍禁 | ADR 0010 §Persistence degraded 语义 L131–137、L139（bypass 只属冻结 hub-to-peer session）；phase-5 切片 4 L82、场景 8/9 L164–165；ADR 0006 #79 修订 L192（saveDoc 在 degraded 下仍必须 resolve）互证 | 有据；与 ADR 0008 L47 的张力见裁决 T-1（和解） |
| AC-6 单 Runtime observer 扇出 immutable owned updates、排除源 origin、observer 失败不伤已提交事务 | ADR 0010 L109–113（observer 三条）；phase-5 切片 3 L72–73（origin 与 needs-resync）、切片 6 L99（「Hub单observer多session fan-out」——扇出为结构必然：一 channel 一 Lease 一 session，hub 同 namespace 多 peer = 多 Lease 多 session 共享一 Runtime）；ADR 0007 L54（observer no-rollback 底层条款） | 有据；与 ADR 0007 fatal 条款的区分解和见裁决 T-2 |
| AC-7 release/close/Runtime close/idle/shutdown/apply race/epoch fencing/fatal committed facts 确定性契约测试 | ADR 0010 L90（release 同步停止接纳、channel 关闭先关 session）、L53/L55（epoch fencing）、L179（停止顺序）；ADR 0009 L42–44（release）、L48–50（idle）、L99–101（shutdown）；ADR 0008 #132 修订节 L136（fatal committed facts）；phase-5 §测试 seam L181 | 有据；测试面授权充分 |

**Scope-creep 筛查**：无 AC 超出 ADR 0010 四节 + 切片 3/4 授权。AC-6 的「多 session 扇出」虽字面出现在切片 6 文本，但它是「一 Runtime 多 Lease 多 session」结构（phase-5 L37 交付模型）的必然推论，机制本体（Runtime observer）属切片 3/ADR 0010，不构成越权。

## 核对问题逐项裁决（表面张力 → 和解）

| # | 张力描述 | 双方锚点 | 裁决 | 依据 |
|---|---|---|---|---|
| T-1 | ADR 0008 L47「`persistence-degraded` 阻止 ROOT、SCHEMA 以及未来所有 Y.Doc 写」 vs ADR 0010 L131–139「peer degraded 仍允许已认证 hub→peer session 将 update 应用到内存……该 bypass 只属于创建时已冻结为 `hub-to-peer` 的可信 session」 | ADR 0008 L47 ↔ ADR 0010 L131–139 | **no-conflict** | ADR 0007 L42 把 raw update 语义显式预留为「另设受控通道」；ADR 0010（2026-08-27，晚于 0008 的 2026-08-23）L220 明文对该预留作出决定并声明 trusted raw update 不继承业务写保证族；degraded 矩阵（hub 拒 / peer 限 hub→peer）是该决定的自带内容，且 L139 以「bypass 只属于冻结 session、不能由普通业务写或 peer→hub update 获得」自限边界。后法 + 特别法 + 预留决定三重依据，非演进、非违规。遗留精确 gate 谓词 → 开放点 O-1 |
| T-2 | ADR 0007 L54「事务开始后若未知 observer 抛错，视为 Runtime internal/fatal」 vs ADR 0010 L111「observer 失败不得回滚 transaction 或使 Runtime fatal」 | ADR 0007 L54 ↔ ADR 0010 L109–113 | **no-conflict** | 两条款对象不同：0007 管「未知 observer 向事务栈抛错」（防御性 fatal）；0010 管「Runtime 自有复制 observer」——恰属 0007 同句「Runtime 自有 observer 必须记录或异步上报」的执行面。和解条件：fan-out observer 必须自捕获全部失败、异步上报、永不向 Yjs transaction 调用栈抛异常。该隔离机制是设计义务 → 开放点 O-10 |
| T-3 | ADR 0008 #132 修订节 L134「四者（mutateRoot/replaceSchema/enableReplication/bumpReplicationEpoch）……完整槽序……不变」 vs 本任务 trusted apply 使用 ADR 0010 L96–103 的另一种槽序（gate 集不同：lifecycle/角色/身份/epoch + 受保护字段检查） | ADR 0008 L134 ↔ ADR 0010 L96–103 | **no-conflict** | #132 槽序冻结限定于四方法族；ADR 0010 为 trusted apply 单独定义槽序并明文「仍必须进入该 namespace 的唯一 write sequencer」。同一 FIFO、按操作族各自的槽体，两文互不否定。设计须写明 apply 槽如何挂接 sequencer（不新增第二队列）→ 开放点 O-2 |
| T-4 | AC-2「status」+ 简报非目标「不给 Runtime status 增加 session/网络/队列/sync 状态」 vs ADR 0010 L90「查询独立复制状态」 | AC-2 ↔ ADR 0010 L87/L90、ADR 0008 #132 L135、phase-5 切片 1 L55 | **no-conflict** | 三处权威一致：session/网络/队列/sync 状态属 ReplicationSession 独立查询面，Runtime status 的 replication 域仅含持久 identity/epoch 两态。自洽，无互斥 |
| T-5 | 现行代码纪律（runtime 值导出恰一键、公共入口零 Y.Doc/DocHandle/sequencer；registry 结构性复制 alias + Equal 断言 + 类型白名单） vs 必须新增的公共面 `openReplicationSession` / `ReplicationSession` 类型 | `packages/namespace-runtime/src/index.ts` 头注、`packages/namespace-registry/src/types.ts`/`index.ts`/`lease.ts` 头注 ↔ ADR 0010 L73–88、ADR 0009 L18/L38 | **no-conflict** | 代码纪律不构成 ADR 级阻塞依据；且 ADR 0008 L91（生产工厂/seam 保留包内）与 ADR 0009 L18（internal subpath 先例）已授权包内 seam 模式。新增面属「经设计显式裁决的扩展」，简报验收门槛已预设该裁决位。落点清单 → 开放点 O-2/O-3 |
| T-6 | ADR 0008 #132 构造期复制事实预投影（L131–132） vs session open 冻结 replicationId/epoch（ADR 0010 L81） | ADR 0008 L131–135 ↔ ADR 0010 L81/L98（「身份和 epoch gate」） | **no-conflict**，但有一致性要求 | 单一事实源要求：session 冻结的事实应取自 Runtime 投影链（#132 构造期预投影 + enable/bump 槽内「同步投影」，基线 `readReplicationFacts` 单点），apply 时 gate 重读当前事实比对冻结值，bump 后冻结 epoch 过期必须被 fence（ADR 0010 L53/L55）。机制细节未冻结 → 开放点 O-7/O-8 |
| T-7 | ADR 0010 内部：peer degraded 允许 hub→peer apply（L134）vs「Runtime closing/fatal 或 handle 失效时不得绕过」（L136） | ADR 0010 L134 ↔ L136 | **no-conflict** | 同节自洽：bypass 仅限 persistence-degraded 一种 handle 状态；「handle 失效」可由 ADR 0006 #79 L187 四态词精确化（released/disposed 仍拒）。内部无矛盾，谓词待设计冻结 → 开放点 O-1 |

**AC 互斥筛查**：AC-1（每 Lease 一 session）与 AC-6（多 session 扇出）经「多 Lease 共享一 Runtime」结构自洽（phase-5 L37）；AC-2 status 与非目标自洽（T-4）；AC-4「不做 VFSL 校验」与 phase-5/ADR 0010 非目标为同一命题的两侧，非互斥。未发现互斥对。

## 开放点清单（非冲突；设计阶段必须显式裁决，遗漏即埋雷）

- **O-1 degraded bypass 的精确 gate 谓词**：hub→peer trusted apply 的 writable-gate 例外只覆盖 `persistence-degraded`；`released`/`disposed`（ADR 0006 #79 四态词）、Runtime `closing`/`closed`/fatal 仍拒绝（ADR 0010 L136）。设计须写出完整谓词与拒绝稳定码归属（`RUNTIME_WRITE_DISABLED` 码族是否复用，message 文案区分域——ADR 0008 #93 修订节第 2 条），并建议在设计文档中显式陈述 T-1 的和解（文档同步步核对 ADR 0008 是否需指针注记——非阻塞）。
- **O-2 Runtime↔Session 包内 seam**：session 的 doc 访问、sequencer 挂接、owned-update 订阅只能经 namespace-runtime 包内/internal subpath seam（先例：`createNamespaceRuntimeForRegistry`）；不得出现第二个写队列（ADR 0010「唯一 write sequencer」+ CONTEXT 写序列器 _Avoid_「让 SCHEMA/META 管理写建立旁路」同理由禁止 apply 旁路）。seam 形状、命名与模块边界测试面需设计冻结。
- **O-3 ReplicationSession 公共类型落位与锁面**：registry types.ts 声明纪律（不得出现 Runtime 命名类型/内部 subpath 字面量）下，`ReplicationSession`/`openReplicationSession` 无 Runtime 对应成员可镜像——Equal 断言锁不适用，需新的类型面冻结机制（结构性定义 + test-d）；若引入新值导出（错误类等），须按简报验收门槛「值导出恰一键或经设计显式裁决」显式裁决；`NamespaceLease` 接口的 released 逐方法通道表须增补 `openReplicationSession`（released → `NAMESPACE_LEASE_RELEASED` 通道，「一切拒绝经返回的 Promise 结算」纪律——同步 throw 还是 Promise 结算需按方法族裁定）。
- **O-4 角色感知来源**：ADR 0010 L118 / 切片 4 L80「peer 本地 `replaceSchema()` 以稳定角色权限错误拒绝」需要实例静态角色（hub/peer）进入 Runtime/Lease/Registry 层，而现行 Runtime 无角色概念、openReplicationSession 的 role 是 session 级冻结值。角色注入点（Registry/Runtime 构造配置？）与错误形状（`ReplaceSchemaIssue` 扩展 or 新稳定码，归属 errors.ts append-only 注册表）未定——ADR 授权行为，机制完全留白。
- **O-5 AC 覆盖缺口（SA6 锚定注意）**：两项 ADR/切片 4 授权行为未出现在 7 条 AC 字面中：(a) **hub persistence-degraded 拒绝 peer→hub raw apply**（ADR 0010 L125–129）；(b) **peer 本地 `replaceSchema()` 角色权限拒绝**（L118）。SA6 锚定与 AC 门禁需为二者补验收锚，否则授权行为无测试依据。
- **O-6 「authenticated hub-to-peer」的本切片等价物**：认证属切片 6/7（本切片非目标）。AC-5 的「authenticated」在本切片约化为「冻结为 `hub-to-peer` 的可信 session + Host 只把 Lease 交给可信代码」（ADR 0010 L79）；设计须写明契约测试中的认证等价物，避免把 WS 层语义提前拖入。
- **O-7 session open 的事实来源与 disabled 行为**：冻结 replicationId/epoch 取自 Runtime status 投影链（单一事实源，同 T-6 裁决）；**replication disabled（两态 `{state:'disabled'}`）的 namespace 上 openReplicationSession 的行为未定义**（ADR 0010 L81 预设事实存在才可冻结）——稳定错误 or 允许开？需裁决。
- **O-8 epoch fencing 语义**：session 冻结 epoch 因 `bumpReplicationEpoch()` 过期后，后续/在途 apply 的拒绝行为与 session 状态转移（conflicted？closed？仅稳定错误？）未定；须与 ADR 0010 L53/L55「旧 epoch 必须显式 reset/bootstrap」「缺失或不同进入稳定 conflicted」对齐。
- **O-9 每 Lease 一个 session 的生命周期词义**：「最多一个 duplex session」（ADR 0010 L81）vs「每 Lease 最多一个 session 的生命周期」（切片 3 L69）——close 后同 Lease 能否再 open（并发 vs 终身解释）？以及 **Lease release 时未先 close session** 的确切语义：「同步停止 session 接纳」（ADR 0010 L90）是自动 close、还是仅拒新操作？在途 apply 槽如何结算（release 不追踪已接纳写——ADR 0009 L42）？两者皆无明文，需设计冻结。
- **O-10 observer 隔离与 origin 语义**：fan-out observer 自捕获/异步上报/永不抛入 transaction 栈（T-2 和解条件）；「immutable owned updates」的拷贝纪律（Uint8Array 快照）；「本地 transaction origin 与远端 connection/channel origin」（切片 3 L72）的区分规则与**回声抑制排除谓词**（AC-6「excludes the source origin」的精确含义：按 origin 标识过滤远端回声，本地业务写必须仍被订阅）需冻结；队列溢出→`needs-resync` 的队列形状不得阻塞 sequencer（ADR 0010 L113）。
- **O-11 session status 词汇**：AC-2「status」的形状未冻结：`needs-resync`（channel 级）、`replication-unvalidated`（复制状态）、「内存已追上 vs 磁盘未追上」区分（ADR 0010 L139）如何在 session 独立查询面投影，需设计定义稳定词汇（并按简报验收门槛同步 CONTEXT.md/ADR 0010/phase-5 文档）。
- **O-12 scratch-check 判据词义**：「不改变 SCHEMA」（ADR 0010 L105）的判据需冻结——(a) 四键信封内容投影相等（允许产生等值操作）vs (b) 对 SCHEMA 容器零操作 vs (c) 字节级相等；Yjs applyUpdate 可整合「同值重写」item 使内容投影不变而历史变化，判据选择直接决定测试面。META 侧对象明确（`replicationId`/`replicationEpoch` 两保留字段值不变），但同判据问题并存；受保护字段集合必须是冻结常量（L121「raw caller 不得逐次自定义受保护字段集合」）。scratch clone 的构造方式亦需设计定义。Peer 侧「允许的 META 字段」白名单（L105/L121「未来其他非保留 META 字段可另行决定双向语义」）首版是否为空集需明示。

## 结论

**verdict: clear，放行。** 7 条 AC 全部锚定于 ADR 0010 四节冻结条款 + phase-5 切片 3/4 + CONTEXT 词条；无 AC 越权、无 AC 互斥、无与非目标冲突；4 组表面张力（T-1/T-2/T-3/T-7）均经基准文本自身条款和解，无需 override，无需 Jim 裁决演进项。SA1 设计必须逐条消化 O-1…O-12（尤其 O-1 gate 谓词、O-2 seam、O-4 角色注入、O-12 scratch 判据与 O-5 AC 覆盖缺口——后者须回传 SA6/AC 门禁补锚）；O-3/O-11/O-12 产生的新公共 API 与稳定词汇须按简报验收门槛执行文档同步。
