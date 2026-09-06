# 设计 ADR 冲突复审（conflict recheck）— Issue #227 design R1.1

- 被审对象：`wiki/raw/task_issue-227_design.md`（SA1 **R1.1**——F-1 窄修 + N-1/N-2/N-3 备案；536 行全文）
- 触发事由：SA1 R1 声明 `requiresConflictRecheck: true`，两项语义面——
  1. **`StrictRecordUpdate` 公共分类演进**（包公共导出类型加 `unknown` 第五成员、`none` 域收窄）；
  2. **replay complete 可达性语义变更**（fatal-committed-unknown / effect 缺席形状从「推进→complete 可达」改为「issue+break→partial/failed」，废止 SA7 重点 4 pin）。
- 冲突基准：`docs/adr/0012-vfsl-validated-jsonl-and-framed-sidecar-change-log.md`（下称 ADR-0012-LOG）、
  `docs/adr/0011-best-effort-namespace-diagnostic-change-log.md`（下称 ADR-0011）、
  `packages/namespace-diagnostic-log/AGENTS.md`、`apps/yjs-server/AGENTS.md`、根 `CONTEXT.md`、
  `docs/AGENTS.md`（文档权威层级）；ADR 摘录基线见 `wiki/raw/task_issue-227_relevant_decisions.md`（本轮随附产出）
- 复审方式：**全部独立重验**——两 ADR 全文重读；设计引用的源码锚点逐处亲读比对
  （schema.ts `AttemptResult` 八成员联合、reader.ts:755–859 `StrictRecordUpdate`/`materializeStrictRecordUpdate`/
  `materializeCarrier`、reader.ts:358–375 `enumerateSegmentGroups`、reader.ts:495–520 步骤④、reader.ts:566–571 ENOENT 分支、
  read-session.ts 全文、file.ts:1067–1160 `deleteGroup`/`hygieneStream`、file.ts:1192–1347 `sweepNow` P0/P1/P2/
  `emitRetentionSweptIfAction`、pipeline.ts:108–150 `resultShapeValid`/`canonicalResult`、
  diagnostic-replay.ts:1–235 头契约与④循环）；`StrictRecordUpdate`/`DiagnosticReadSession`/`openDiagnosticReadSession`
  消费面全仓 grep；retention-swept / leaseBlockedGroups 既有测试 pin 逐个核对（T-A6 / T-C1..C8 / T-E8）；
  `docs/**` 与 README 扫描旧 complete 语义/码表成文面
- Worktree：`/home/wangjian/nomicore-fix-issue-227`（branch `mabf/issue-227`，HEAD `ac91a6b`）
- 时间：2026-09-06（conflict-gate 轮）

## Verdict

**clear**（`requiresConflictRecheck: false`）

两项触发语义面经独立核验均判 **ADR 合规的加性/收紧演进，零冲突**：

- 公共分类演进不触碰任何 ADR 冻结面（ADR-0012-LOG L307–316 冻结的是 replay **报告形状**，非 materialize 原语联合）；
- complete 可达性变更只做**必要条件方向的收紧**（从不 complete 误报的方向关闭漏洞），与两 ADR 的
  「只有…才能 complete」规范性框架同向，且正是简报总纲（"任何无法证明必要 committed update 完整的记录
  都不会被评为 complete"）的要求。

设计可进入 SA2 窄域复审 → SA6 红灯阶段。三条**非阻断**登记项（N-A/N-B/N-C，§4）移交后续轮次，
其中 N-A 建议随 SA2 窄域复审一并备案。

## 1. 触发面一：`StrictRecordUpdate` 公共分类演进 — 无冲突

| 检查项 | 独立核验事实 | 裁决 |
|---|---|---|
| 是否触碰 ADR 冻结的 replay 报告形状 | ADR-0012-LOG L307–316 冻结 `{status, lastAppliedSequence, issues, snapshot?}`；实现面 `DiagnosticReplayResult`（diagnostic-replay.ts:31–38）与之逐字段一致。设计 §4.2 明示 #155 报告形状零变更，INV-227-7 钉 complete 门表达式 `issues===[] ∧ applied>0 ∧ readStatusOk ∧ !historyTrimmed` 与 diagnostic-replay.ts:227–232 现状逐字相同（本轮亲读比对） | ✅ 不触碰 |
| 加 `unknown` 成员是否属 ADR 词表冻结面 | ADR 层面冻结的是 **record result 联合**（L69–89）与 operation 封闭六值——均在 schema.ts/DENY 面，本票零改（§0.3 首行）。`StrictRecordUpdate` 是 #155 引入的**包内物化投影原语**（reader.ts:755–759 现状恰四成员），无 ADR 条款枚举或冻结其成员集 | ✅ 非冻结面 |
| 加性演进的消费面封闭 | 全仓 grep：`materializeStrictRecordUpdate` 消费方 = diagnostic-replay.ts:143/:194 两处 + index.ts:77 再导出；`StrictRecordUpdate` 类型引用无其他生产文件。穷举 switch 同步面封闭（设计 §4.2 声明成立，本轮复核成立） | ✅ 封闭 |
| 包 AGENTS.md 词表演进纪律 | 「新增 update-omitted reason 属词表演进，须过设计评审并同步 CONTEXT.md」——设计 INV-227-10 零新增 reason；新码 `update-unknown` 属 **replay 工具域**（app 侧），不是包 reason 词表；§5 以本文档所在的设计评审链为载体，且 §0.2 ALLOW 已列包 AGENTS.md + 根 CONTEXT.md 增量段（同 #153/#154 先例）。CONTEXT.md「语义 emission」词条的 reason 三值词表不动 | ✅ 纪律满足 |
| `DiagnosticReadSession` 接口加成员（`enumerationFailed`/`renewIfDue`） | 接口仅由包内 `DiagnosticReadSessionImpl` 实现；仓内无外部 implementor（grep 亲证：apps/packages 生产代码零引用，仅 index.ts:92–95 再导出 + 包内测试）。加性、无破坏 | ✅ 无冲突 |

## 2. 触发面二：replay complete 可达性语义 — 无冲突（收紧方向）

**规范性框架**：两 ADR 的 complete 条款均为**必要条件**列表（「只有…才能返回 complete」）：

- ADR-0012-LOG L318：「只有存在有效 genesis、records 连续、所有必要 updates 可解码且校验通过、无已知 gap/截断/损坏/不兼容，并且重放后受控 identity 匹配时才能返回 complete。retention 裁剪、update omitted、缺 genesis 或 generation 断裂只能返回 partial/failed。」——后半句是**非穷举**的 partial/failed 成因列举（「只能返回」约束这些成因的出口，并非穷尽成因清单）。
- ADR-0011 L97–105 五条件：有效 genesis / committed records 连续 / **每个非-noop committed record 都携带可解码的 Yjs update** / 无已知 gap·截断·损坏·不兼容 / 受控 identity 匹配。

**裁决链**：

1. `fatal ∧ committed:true ∧ effect:'unknown'`（含 effect 字段缺席残差）自证「已提交但效应不可证」——它**无法证明自己不是非-noop committed 效应记录**，因此条件 3 的「可解码 update 在场」对它不可证；按 L318「所有必要 updates 可解码」的必要条件框架，**不允许** complete。旧实现（diagnostic-replay.ts:171/:183–188/:208–212，本轮亲读）把它按无更新推进使 complete 可达——是与 ADR 必要条件框架的**实施偏差**，本票是纠偏而非违约。
2. effect 缺席形状与 ADR-0012-LOG L87 文本（「fatal + `committed:true`，effect 为 `update | update-omitted | unknown`」）的关系：L87 枚举的是 result 联合的规范成员；VFSL 无法机器锁死 committed:true ⇒ effect 存在（schema.ts `AttemptResult` 第 5 成员 `{kind:"fatal"; committed:boolean}` 无 effect——本轮亲读），writer 侧由 pipeline.ts:108–125 `resultShapeValid` + `canonicalResult`（committed:false 一律剥落 effect）三重强制。盘面可达的 effect 缺席形状落在 **ADR 枚举联合之外**，strict reader 对联合外形状的 fail-closed 处置（→ `unknown` 通道 → issue + partial）是 ADR 纪律（L305「不得近似解释、跳过未知记录后继续声称连续」）的正当延伸；归类 `unknown` 而非 `invalid` 与字面 `'unknown'`（AC3 点名形状）同级处理，判断一致性好。
3. complete 门表达式冻结（INV-227-7）+ 收紧只经分类/issue 通道发生——语义变更全部单向朝「更少 complete」；不存在任何新形状变得 complete 可达（§4.1 表「可达 complete？」列逐行核对：仅 noop/rejected/fatal-committed:false（及其 effect 放宽残差 R-4）与可证物化成功的 update 族保持 complete 可达——与现状完全一致）。
4. SA7 重点 4 pin（sa7.test.ts:445–470，本轮亲读：`complete`+`issues:[]`+`lastAppliedSequence:'4'`）钉死的是 #155 实施期行为，**无任何 ADR 条款要求该行为**；issue AC3 逐字否定之，废止改写经 SA6（测试 owner）同 change 完成（设计 R-5/§8.4/§8.5）——符合包 AGENTS.md「改实现不改测试断言」纪律的合法演进路径（断言变更由测试 owner 随语义票落地，非实现轮偷改）。
5. N-1（omitted×断链 issue 码翻转）/ N-2（pre-genesis 物化前置）两个已备案增量均不改变三态与 complete 门；断链报告前置与 ADR-0012-LOG「无已知 gap」条件的诚实报告义务一致。✅

## 3. 其余 ADR/契约条款逐项（均通过）

| # | 条款 | 与设计的关系 | 裁决 |
|---|---|---|---|
| C1 | ADR-0012-LOG L289「retention 只删除已关闭且没有 reader lease 的 segment group」/ L297「reader 通过 `openReadSession()` 获得短期 segment lease」 | G1/G2 正是该条款的实施缺口；§3.2/§3.4 全程持约 + §3.3 S0′ 提交点复查是兑现 | ✅ 兑现型 |
| C2 | L297「长期 reader 必须有最大 lease 时长**或**显式续租」 | G-227-4 缺省 `maxLifetimeMs=null`（显式续租臂）+ `renewIfDue` 检查点——ADR 明文允许的两臂之一（SA2 R0 §5 同裁） | ✅ 明文允许 |
| C3 | L295「无对应 JSONL 的孤立 BIN 按 orphan 清理」vs P0 加租约门 | L289 租约句统辖**全部** retention 删除面（含 orphan 步骤）；`hygieneStream` 注释「P0 无条件」指不受 P1/P2 的年龄/字节**限制条件**约束（ADR 步骤 4/5 无条件执行），非租约豁免——租约安全句优先级更高，且 issue AC2 逐字要求。bin-only 组进 `live`（enumerateSegmentGroups :369，亲证）⇒ 会话可租用 ⇒ 门有真实保护对象 | ✅ 合规（解释性裁定已记录） |
| C4 | L240/L272–278 BIN-first 崩溃窗口 + 尾部恢复 | §3.2.4 豁免矩阵保留「bin 在 ∧ marker 不在 → 零行零 issue」（W 系 pin 保留，§8.5）；仅 marker 在/bin 缺新出 `segment-vanished` | ✅ 正交保留 |
| C5 | ADR-0012-LOG §VFSL record schema + 包 AGENTS.md schema 指纹冻结 | §0.3 DENY `schema.ts`/`record.ts`；F-1 修消费侧判定而非 schema——避开「id 升 @2 + 新 generation + 旧 stream 只读」的版本雪崩，是正确的冲突规避路径 | ✅ 冻结面零触碰 |
| C6 | ADR-0012-LOG L214「VFSL 校验失败 = writer bug」+ emission/pipeline 零涉及 | 写路径 DENY（§0.3）；reader 消费侧分类不与 writer 侧校验语义混同 | ✅ 无涉 |
| C7 | ADR-0012-LOG L218 单进程独占 rootDir / INV-9 | 进程内注册表维持；跨 worker 为部署违约（R-2 备案）——不试图在代码层解决，与 ADR 一致 | ✅ 一致 |
| C8 | INV-12（namespace 逻辑删除压过租约，`releaseNamespaceLeasePartition`） | §0.3 DENY `deleteNamespaceDiagnosticLog`/分区释放——L299「Host 执行数据删除请求时必须同时调用日志删除能力」语义不动 | ✅ 保留 |
| C9 | ADR-0011 L20–24 best-effort 隔离 / L123 不得引入第二排序机构 | 本票纯读路径 + retention 内部；零 emit 接线、零 sequencer 触碰、replay 为离线只读工具（其文件头契约自证） | ✅ 无涉 |
| C10 | 包 AGENTS.md 健康事件白名单（#154 `retention-swept` 计数类成员） | N-3 备案：白名单字段/形状零变更，仅发波频率语义（P0 租约跳过计入 `leaseBlockedGroups` → 纯卫生跳过可触发事件）。既有 pin 亲证无冲突：T-A6 零事件场景无活跃会话（emit 落盘后 jsonl 在 → P0 orphan 分支 `continue`，租约恒 false）；T-C1..C8 断言 `leaseBlockedGroups ≥ 1` 语义保持。ADR-0012-LOG 对该事件无成文条款 | ✅ 备案充分 |
| C11 | apps/yjs-server AGENTS.md「Consume only package public exports」 | §4.3 删除 app 侧 result 联合手工推导、改以包公共投影 `materializeStrictRecordUpdate` 为单源——**强化**该边界纪律（现状 app 侧复制品已与包内判定漂移，见 N-A） | ✅ 强化 |
| C12 | docs/AGENTS.md「code behavior 变更须同步每一份成文契约文档」 | §0.2 ALLOW 列包 AGENTS.md + 根 CONTEXT.md；`docs/**` 全扫无旧 complete 语义/码表成文面（仅 ADR 原文）；包 README 码表示例同步义务已在 §5 声明。补充项见 N-C | ✅ 覆盖（+N-C） |

## 4. 非阻断登记项（移交，不构成 ADR 冲突）

### N-A【建议随 SA2 窄域复审备案】`fatal ∧ committed:false ∧ effect:'update-omitted'` 残差的 replay 行为翻转未备案

- **事实链（本轮逐环亲验）**：schema 第 7 成员 `{kind:"fatal"; committed:boolean; effect:"update-omitted"; reason}` 允许 committed:false；emitter 不可达——pipeline.ts `resultShapeValid` 对 fatal-committed:false **不看 effect** 直接 `return true`，但 `canonicalResult` 对 committed:false 一律归一为 `{kind:'fatal', committed:false}`（effect 剥落）——盘面可达仅经手拼/第三方 writer。该形状同时落在 ADR-0012-LOG L87 枚举联合之外（L87 只给 committed:true 配 effect）。
- **未备案的翻转**：现状 replay 的 app 侧推导要求 `committed` 合取（diagnostic-replay.ts:171/:173）→ 该形状**静默推进**（complete 可达）；§4.3 单源化后走 materialize 的无条件 `effect==='update-omitted' → omitted`（现状即如此，reader.ts:794–796，"不变"）→ `update-omitted` issue + break → partial。属删除 app 侧联合复制品的连带增量，与 N-1/N-2 **同 genus**（SA2 R0 要求该类增量显式备案），R1.1 备案集漏此一条。
- **为何非阻断**：方向 fail-closed（不会新制造任何 complete）；与包内 materialize 单源一致；对该 ADR-联合外形状保守处置与 L305/L318 纪律同向。处置建议：设计 §4.3/§8 加一句备案 + D4 加一个手拼变体 pin（或如追求与 G-227-2 完全对称，把 materialize omitted 分支收窄为要求 committed 析取——两者皆可，择一备案即可）。

### N-B【SA3 实现守卫】replay 新增 `readSession` 选项的不可抛契约保持

- `replayNamespaceDiagnosticLog` 头契约「纯同步、绝不抛——一切错误收敛进 issues」（#155 冻结语义；ADR-0012-LOG L307「只返回 owned snapshot bytes 与结构化报告」同旨）。§3.4 把调用方 `readSession.ttlMs/maxLifetimeMs` 直通 `openDiagnosticReadSession`，而后者的非法值面 **throw**（read-session.ts:162–171 亲证）。设计 §3.2.2 的「两个 throw 面被冻结常量与前置门排除」论证只覆盖 reader 自开路径，未覆盖 replay 的调用方供参路径。SA3 须将 open 失败收敛为 `failed` + 稳定 issue（或入口校验后拒绝），不得让工具新生长 throw 面。

### N-C【SA3 文档守卫】replay 工具头注释的五条件措辞同步

- `diagnostic-replay.ts:4–17` 头注释成文记载「五条件 complete」语义；分类收紧落地时须同步该注释（含 fatal-committed-unknown 不再推进的语义行），与 §5 已列的 reader.ts 码表计数 29→31、包 README 同属一次 change 内的文档义务（docs/AGENTS.md「documentation-only wording changes must not invent implementation behavior」——反向亦然：行为变了措辞必须跟）。

## 5. 边界声明

- 本轮**零生产代码改动、零测试改动、零 git 操作**（git status 亲证：仅四个既有未跟踪 wiki 任务文件）；唯一写入 = 本文件 + `wiki/raw/task_issue-227_relevant_decisions.md`（随附产出的 ADR 摘录基线，供 SA2/SA6/SA4/SA7 复用）。
- 未运行测试套件（被审对象为设计文档，无代码增量可跑；SA2 R0 §7 同例）。
- 编号消歧：`docs/adr/` 存在两个 0012，本文所有「ADR-0012-LOG」均指 `0012-vfsl-validated-jsonl-and-framed-sidecar-change-log.md`；`0012-instance-identity-and-websocket-plugin-ownership.md` 与本任务无关。

Verdict: **clear** — `requiresConflictRecheck: false`
