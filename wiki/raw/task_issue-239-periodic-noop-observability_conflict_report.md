# 冲突门禁报告

- 被审对象：`wiki/raw/task_issue-239-periodic-noop-observability.md`（issue #239，bug，labels: bug / in-progress，评论数 0）
- 阶段：前置门禁（任务简报 vs ADR 全集 + CONTEXT.md）
- 基准：`docs/adr/` 全部 **11 个 ADR**（0001–0010、0012；全读，无抽样）+ `CONTEXT.md`。`docs/protocols/instance-replication-v1.md` §9/§16/§18/§21/§23 经 ADR-0010 L151「唯一 wire contract」收录为约束（§23 并自我登记为 local seam append-only 注册表）；issue #231（commit 4323118/#240）已确立「§23 append-only 演进直接改协议文档、无需 ADR 修订节」先例。除此之外的代码与 wiki 文档未作为基准。
- SA8 产出：本报告 + `task_issue-239-periodic-noop-observability_relevant_decisions.md`（全链复用约束清单）

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19 修订节） | 否 | 任务不触碰 schema/信封/投影域，无接触点 |
| ADR-0002 | nomicore 是全新重写，authority 出范围 | accepted | 否 | 无接触点 |
| ADR-0003 | 求值器与派生 schema | accepted | 否 | 无接触点 |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 否 | 无接触点 |
| ADR-0005 | 投影生成管线 | accepted | 否 | 无接触点 |
| ADR-0006 | Cordis 持久化插件 | accepted | 否 | 任务不动 Persistence/存储布局，无接触点 |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge | accepted（Runtime/open/read 条款由 ADR-0008 取代） | 是（负向） | L54 observer no-rollback 纪律的传输层对应物即 §23.4 隔离；任务全部位于 ws-replication 层、不触碰 Runtime 事务栈 → no-conflict |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 #93/#132/#134 修订节） | 是（负向） | L40 唯一 FIFO = §23.4「发射点永不位于 sequencer 槽内」所指；L101 只约束 Runtime capability status（非 ws-replication 事件）；任务不进槽、不扩 Runtime status → no-conflict |
| ADR-0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted（含 #131/#134 修订节） | 弱 | L95 Registry observer seam 同款 Adapter 纪律（脱敏/采样归 Adapter）；任务不改 Registry/Lease 公共面 → no-conflict |
| ADR-0010 | Hub/Peer WebSocket Y.Doc 复制与最终一致 | accepted（含 #134/#133-r2/#161-r2/#172/#229 修订节） | 是（直接） | 任务即其 L167「最小观测面」（下限清单）内的 reconcile 观测语义扩展；wire/状态机零变化由 §23「local，非 wire 契约」明文承接 → no-conflict |
| ADR-0012 | 实例身份单一真相与 WebSocket plugin 所有权 | accepted（issue #204 已实现） | 是（负向） | L22「status、observer 与错误不得泄漏 token、Authorization、owner 完整值、Schema/Data、Yjs bytes 或 stack」与 issue 泄漏禁令同向；被否决方案禁止暴露 raw session/live Y.Doc → no-conflict |

## 冲突点

无。逐条对照未发现直接违反任何 accepted ADR 条款或 CONTEXT.md 惯例的冲突点：

| 裁决 | 数量 |
|---|---|
| hard-violation | 0 |
| evolution（需 ADR 修订/推翻） | 0 |
| override-declared | 0 |
| no-conflict | 11/11 ADR（直接相关 1、负向相关 3、弱相关 1、无关联 6） |

### 任务要求 ↔ 基准条款对照（复核用）

| # | 任务简报要求 | 基准条款（ADR-0010 及其收录协议） | 一致性 |
|---|---|---|---|
| 1 | append-only 增加 observer 字段 / 按 append-only 更新 protocol §23 | §23 开头「Seam 是**追加式（append-only）**：事件类型、reason/cause/via 词表、稳定码表只增不改」；issue #231 先例（追加 `resync-required` 子因字段 + 第 20 型 `update-dropped`，直接改协议文档，ADR-0010 无需修订节） | 一致——任务走的是 §23 自身登记的注册演化机制，非决策变更 |
| 2 | 不改变 wire bytes、不改变 periodic reconciliation 状态机 | §23 开头「属于 local seam：**不改变任何 wire 字节**，不新增帧/字段/错误码；事件词汇只描述既有协议事实的观测投影」；§9.4 周期 timer 规则与 §16 状态机不动 | 一致 |
| 3 | `syncRoundId` 作 trace/log 关联、avoid default metrics label | §9.1/§9.2/§9.3 wire 已携带 `syncRoundId`（uint32、连接内不回绕）——事件新增该字段是既有 wire 事实的观测投影，零 wire 变化；§23.6「namespaceId/connectionId 是事件 payload……默认不绑 metric label」同款高基数处理 | 一致 |
| 4 | `stateVectorChanged`（preferred low-cardinality signal）、`applyEffect: changed\|noop`（由 before/after vector 派生，非 byteLength） | §23.3 允许「稳定字面量」（闭联合字面量先例：channelState/connectionState——issue #231）与低基数 label（§23.6 label ∈ {side,type,code,cause,reason} 可扩同族字面量）；§9.2「允许空 diff」+ 编码非规范零长 ⇒ bytes>0 不证明逻辑变化（issue 现象的协议层根因） | 一致 |
| 5 | `stateVectorBeforeHash` / `stateVectorAfterHash`（keyed or documented safe digest; trace-only if needed） | §23.3 禁止 Yjs bytes（raw state vector 即 Yjs bytes，事件树深扫不得出现 `Uint8Array`）与「不受控高基数字段」；digest 不在现行允许清单——需按 append-only 把「documented safe digest」（算法/编码/截断固定）注册进 §23.3；issue 自身提供退路「至少提供 `stateVectorChanged` 和 round-local correlation」 | 一致——两条路径（注册 digest 或退回 boolean）均在 append-only 机制内，非冲突 |
| 6 | 不得泄漏 raw state vector、Yjs bytes、ROOT/SCHEMA、owner、绝对时间戳 | ADR-0010 L159「Token、Yjs update、SCHEMA/ROOT 内容以及未经控制的 owner/namespace 不得出现在默认日志或高基数指标标签中」；ADR-0012 L22 同款；§23.3 禁止清单；§23.4「绝对时间戳不入事件」 | 一致——任务要求与基准同向（强化而非偏离） |
| 7 | observer throw isolation、无 observer 热路径测试 | §23.4「throw 被隔离（静默……）」「无 observer = 零事件、零状态投影读取、零时钟调用（行为与现状逐字节等价）」；ADR-0010 L112「observer 失败不得回滚 transaction 或使 Runtime fatal」；§23.7 conformance（每事件必 throw 与无 observer 基线全等） | 一致 |
| 8 | sent/applied 以 roundId、sequence 或等价安全字段可靠关联 | §9.1–9.3 syncRoundId / §3 envelope direction-local sequence / §10.2 `ackedSequence` 均为既有 wire 事实；ADR-0008 L101 只约束 Runtime capability status，不约束 ws-replication 事件 | 一致 |
| 9 | `bytes` 字段名/文档明确表示 encoded update length（`encodedUpdateBytes` rename/new field） | §23「只增不改……GA 后字段语义冻结」——见注记 2：满足方式必须 add-only（新增澄清字段 + 文档化 `bytes`），不得 rename/删除既有 `bytes` | 一致（以注记 2 的 add-only 形式满足） |
| 10 | 低基数 metrics；safe-field 测试 | §23.6 metrics 默认 label 白名单 + 高基数 payload 不绑 label；§23.7 key-set 冻结白名单断言 + 哨兵深扫 | 一致 |
| 11 | deterministic periodic reconciliation 集成测试：相同副本起步、受控推进 `reconcileIntervalMs`、断言 round 前后 state vector 不变、namespace 回 live、静默漂移修复 round 报 changed 且收敛 | §18 `reconcileIntervalMs` 独立配置；§9.4 timer 规则（live 后武装、无重叠 round）= 测试断言的状态机事实；§22/§23.7 conformance 面要求 fake duplex transport 状态迁移与真实收敛测试 | 一致——见注记 5（复现在本 worktree 缺失，需 SA5/SA6 重建） |

## 结论

**Verdict = `clear`，冲突点 0，裁决分布：no-conflict ×11（hard-violation 0 / evolution 0 / override-declared 0）。放行，无停止原因、无需 override、无需 Jim 裁决条目。**

任务简报在事实上是 ADR-0010 L167「最小观测面」（下限清单、非闭集）所登记 reconcile 观测能力的**语义细化**：以 §23 自我登记的 append-only 机制扩展事件字段（既有 wire 事实 `syncRoundId` 的观测投影 + state vector 派生低基数信号），不修订、不推翻任何 ADR 决策，不触碰 wire 字节与 §9.4/§16 状态机。

对照注记（非冲突，供 SA1/SA2/SA5/SA6 参考）：

1. **`applyEffect: noop` ≠ 「apply 未发生」（正交两维）**：ADR-0010 #134 修订节 R2-7 明文「no-op / 重复 / 空效果 update 的成功 apply 同样置 `rootValidation = 'replication-unvalidated'` 与 `memoryCaughtUp = true`」。语义 no-op round 的 Step2 仍被 sequenced apply + dirty + 置 unvalidated；设计/测试不得断言 noop round 无 dirty 或不置 unvalidated，也不得把 `applyEffect` 塞进 session status 形状（#134 O-11 冻结面）。
2. **`bytes` 字段冻结纪律**：§23「只增不改；GA 后字段语义冻结」。AC「bytes 的文档和字段名明确表示 encoded update length」必须以 add-only 形式满足——保留既有 `bytes` 字段名与语义（文档化其为 encoded update length），新增 `encodedUpdateBytes` 澄清字段；**禁止 rename/删除/重解释 `bytes`**。同理，事件型数（现 20 型）与 §23.1 分类清单、§23.7 conformance 键集需同步 append-only 更新。
3. **state vector 摘要的条件**：若落地 hash 字段，§23.3 需 append-only 注册「documented safe digest」形态（固定算法/编码/截断），conformance 深扫断言事件树无 `Uint8Array`/`ArrayBuffer`/`DataView`（raw state vector = Yjs bytes，禁止）；hash 仅入事件/trace payload，默认不入 metric label。issue 已授权退路：只提供 `stateVectorChanged` + round-local correlation 亦满足验收。
4. **捕获成本与发射点纪律（§23.4）**：before/after state vector 捕获、比较、摘要化是「状态投影读取」，必须 observer 注入门控（无 observer = 零捕获、热路径逐字节等价）；before 捕获位于帧分发同步段、after 捕获位于 apply 结算续体，永不位于 Registry write sequencer 槽内；捕获/计算路径的 throw 按 observer 隔离纪律静默折叠。捕获只能经 ReplicationSession `encodeStateVector` 等受控能力（ADR-0010 L81–88、ADR-0012 被否决方案），不得暴露 live Y.Doc。另注：`syncRoundId` 关联域 = 单连接代际（§21 进程重启即丢弃），不得设计跨重启关联。
5. **复现在本 worktree 缺失**：issue「Deterministic local reproduction」所述 `packages/ws-replication/test/ws-replication-issue239-repro.test.ts` 与 driver Peer-factory 注入 seam 存在于报告者本地 main 工作树，**本 worktree 无该测试文件**（`driver.ts` 存在，`makePeer` 构造 seam 在 L666 起）；生产证据日志路径亦不在本机。SA5/SA6 须在本 worktree 重建确定性复现（相等副本 no-op round + 静默漂移修复 round 两场景），漂移注入只能用受控测试 seam（testing surface / session 能力），不得要求生产代码暴露 live Y.Doc（包边界）。
6. **协议文档是权威**（ADR-0010 #172 修订节 2：`wiki/raw/` 非规范）：observer contract 演进落点为 `docs/protocols/instance-replication-v1.md` §23 的 append-only 更新 + 相应 conformance 招募；实现须同步 `packages/ws-replication` 的包级验证门（observer isolation、periodic reconciliation 全路径）。
7. **范围切割**：Hub/Peer 状态迁移不对称（Hub 为响应方无对称 channel-state 转移）已被 issue 明示不视为缺陷，与 §15.2/§16 相容；#232（apply 回声是否为普通 UPDATE）与 #231（send-failure 分类）不在本任务面内，均无需本任务处理。
