# 实施轮 ADR 冲突门禁（conflict recheck）— Issue #227 implementation（已提交态）

- 被审对象：commit **`31ff694`**「fix(diagnostics): lease strict replay and fail closed」全部落地改动
  （生产 src 7 文件 + 包 AGENTS.md/README 2 文档 + 测试 5 文件 + wiki/raw 证据 12）——
  即 SA3 实现报告 `wiki/raw/task_issue-227_sa3_impl.md` 所列改动的**已提交形态**（基线 `ac91a6b`）
- 轮次定位：SA8 冲突门禁当前 round 重开——历史材料（`task_issue-227_relevant_decisions.md`
  2026-09-06 摘录基线 + `task_issue-227_design_conflict_report.md` design R1.1 轮 verdict=clear）
  仅作参照，本轮对**实施变更集**独立重验并重新提交结构化结论
- 冲突基准：`docs/adr/` 全部 12 文件（重点 ADR-0011、ADR-0012-LOG——编号消歧：本报告所有
  「ADR-0012-LOG」均指 `0012-vfsl-validated-jsonl-and-framed-sidecar-change-log.md`；两个 0012
  中的 `0012-instance-identity-and-websocket-plugin-ownership.md` 与本任务无关）+ 根 `CONTEXT.md`
  + `packages/namespace-diagnostic-log/AGENTS.md` + `apps/yjs-server/AGENTS.md` + `docs/AGENTS.md`
- 复审方式：**全部独立重验**——不沿用 SA2/SA4/SA7 任何声明：两 ADR 关键条款原文回读
  （L60–95 / L278–320 区段）；DENY 面 zero-diff 亲证（git diff ac91a6b..31ff694）；
  逐 hunk 亲读 file.ts/read-session.ts/index.ts×2/retention.ts diff 全文 + reader.ts 物化谓词与
  segment-vanished 分支 + diagnostic-replay.ts 头注/entryLoop/complete 门/finally 收敛改后全文；
  K-1 pin 改写 diff 逐字亲读；新码词表归属 grep 亲证；定向契约套件后台 Job 独立重跑（§4）
- Worktree：`/home/wangjian/nomicore-fix-issue-227`（branch `mabf/issue-227`，HEAD `31ff694`，
  工作树干净——git status 亲证）
- 边界：零生产代码改动、零测试改动、零 git 写操作（不 commit/push）；唯一写入 = 本文件
- 时间：2026-09-06 21:26 UTC（implementation conflict-gate 轮）

## Verdict

**clear**（`requiresConflictRecheck: false`）

实施变更集对 ADR-0011 / ADR-0012-LOG 及全部模块契约**零冲突**：五缺口（G1–G5）修复全部是
ADR 已决条款（L289/L297/L301–305/L318、ADR-0011 L97–105 条件 3）的**兑现型实施**；
replay 完整性收紧只做必要条件方向的收窄（「只有…才能 complete」框架同向），报告形状与
complete 门表达式冻结面逐字保持；DENY 面（schema/result 联合/写路径/删除协议文法）zero-diff
亲证；历史轮移交项 N-A/N-B/N-C 经 K-2/K-3/K-4 全部闭环。本轮定向契约 68/68 独立重跑绿。
无任何条款要求二次冲突复审。

## 1. 改动面独立盘点（vs 设计 §0.2 ALLOW / §0.3 DENY）

`git diff --name-status ac91a6b..31ff694` 亲证，生产 src 改动恰 7 文件：

| 路径 | 与 ALLOW 对照 | 本轮亲读要点 |
|---|---|---|
| `packages/.../src/read-session.ts` | ✅ 列名 | 冻结常量 `DEFAULT_READ_SESSION_TTL_MS=15_000`/`READ_SESSION_RENEW_MARGIN_MS=1_000` 单源导出；`renewIfDue`（margin 内到期才续、closed/拒续→false、非法 margin 视同 0 不 throw）；`enumerationFailed` 事实承载（枚举失败不 throw、空快照+标志） |
| `packages/.../src/reader.ts` | ✅ 列名 | `StrictReadRequest.session?`（传入=快照即枚举+调用方持生命周期，缺省=自开自关）；逐段续租检查点；`segment-vanished` 检测；`StrictRecordUpdate` 增 `unknown` 第五成员 + 物化谓词收窄（§2.3） |
| `packages/.../src/adapters/file.ts` | ✅ 列名 | `deleteGroupIfUnleased`（S0′ 提交点复查）+ P0 orphan-BIN 租约门 + P1/P2 双门；`deleteGroup` S1–S3 本体无任何 hunk（未动） |
| `packages/.../src/retention.ts` | ✅ 列名（仅 JSDoc） | `leaseBlockedGroups` 语义扩写注释，字段形状零变更 |
| `packages/.../src/index.ts` | ✅ 列名 | +3 行：两冻结常量导出（既有导出一字不动） |
| `apps/yjs-server/src/diagnostic-replay.ts` | ✅ 列名 | session 生命周期 + ④ 单源化重写 + K-3 收敛 + K-4 头注 |
| `apps/yjs-server/src/index.ts` | ⚠️ ALLOW 未逐字列名（+1 行 `DiagnosticReplayReadSessionOptions` 类型 re-export）——SA4 O-1/SA7 已裁「接受」：纯加性类型导出、DENY 零涉，本轮维持该裁定 | |

**DENY 面 zero-diff 亲证**：`git diff ac91a6b..31ff694 -- src/schema.ts src/record.ts
src/emission.ts src/pipeline.ts src/sink.ts src/adapters/memory.ts CONTEXT.md docs/**` → **空**；
`deleteNamespaceDiagnosticLog`/`releaseNamespaceLeasePartition` 本体未动（grep 锚 :1584/:1663 仅
既有引用）。

## 2. ADR 逐条款合规（本轮原文回读 + 代码亲证）

### 2.1 ADR-0012-LOG §Retention 与删除（L280–299）

| 条款 | 本轮独立核验 | 裁决 |
|---|---|---|
| **L289**「retention 只删除已关闭且没有 reader lease 的 segment group，绝不删除当前 open group」 | P1（初查 :1240 区 + S0′ 复查 :1265 区）/P2（初查 + S0′ 复查）双门亲读；lease-blocked → 计数 + **break**（前缀纪律不跳洞）；P2 `progressed` 守卫防活锁；P0 orphan-BIN unlink 前租约门（跳过计入 `leaseBlockedGroups`）；open-group 保护与 `openProtectedStops` 既有面未动。设计轮 C3 解释性裁定（L289 租约安全句统辖含 L295 orphan 步骤在内的全部删除面）在代码面兑现 | ✅ 兑现型 |
| **L291–295** 删除协议 S1（原子 rename `.deleting`）/S2/S3/启动续走/orphan 清理 | `deleteGroup` 本体 diff 无 hunk（S1–S3 步序与 `.deleting` 文法逐字保持）；`.deleting` 续走循环**正确不加**租约门（marker 组对一切会话枚举不可见——无持约视图）；P0 门仅加在 orphan unlink 前 | ✅ 协议文法冻结保持 |
| **L297**「reader 通过 `openReadSession()` 获得短期 segment lease…长期 reader 必须有最大 lease 时长**或**显式续租」 | reader/replay 缺省 `maxLifetimeMs=null`（**显式续租臂**——ADR 明文两臂之一）+ 冻结常量 + `renewIfDue` 检查点（每段读前 / 每条物化前 / genesis 物化前）；bounded 供参续租被拒 → `lease-expired` 诚实中止保留前缀 | ✅ 明文允许臂 |
| **L299** Host 数据删除须同时调用日志删除 | INV-12 面未动（§1 DENY 亲证） | ✅ 保留 |

### 2.2 ADR-0012-LOG §Strict reader 与诊断性 replay（L301–318）

| 条款 | 本轮独立核验 | 裁决 |
|---|---|---|
| **L301–305** strict 逐条校验；未知形状「不得近似解释、跳过未知记录后继续声称连续」 | ①′ 防御门（身份不符→`locator-invalid`、closed→`lease-expired`，零 fs）；`segment-vanished` 检测亲读（:675–699）：jsonl ENOENT 时 bin 在 ∧ 无 marker → **BIN-first 合法窗口零行零 issue 逐字保留**（L240/L272–278 崩溃窗口语义）；marker 在 ∨ bin 缺 → `segment-vanished`；stat 失败按消失 fail-closed——零静默空读且不虚构 issue | ✅ 同向收紧 |
| **L307–316** replay 报告形状冻结 `{status:'complete'\|'partial'\|'failed', lastAppliedSequence, issues, snapshot?}` | `DiagnosticReplayResult`（diagnostic-replay.ts:44–50）逐字段一致，零变更 | ✅ 冻结面未触碰 |
| **L318**「只有存在有效 genesis、records 连续、**所有必要 updates 可解码且校验通过**、无已知 gap/截断/损坏/不兼容、identity 匹配才能 complete；retention 裁剪、update omitted、缺 genesis、generation 断裂只能 partial/failed」 | complete 门表达式 `issues===[] ∧ applied>0 ∧ readStatusOk ∧ !historyTrimmed`（:288–293）与 #155 逐字相同（INV-227-7）；收紧全部经分类/issue 通道发生（§2.3 谓词）——语义单向「更少 complete」，无任何新形状 complete 可达。omitted/断链/pre-genesis/裁剪各成因均走 partial/failed + 稳定 issue（定向套件 68/68 佐证，§4） | ✅ 必要条件框架兑现 |

### 2.3 ADR-0012-LOG result 联合（L69–89）与 ADR-0011 L97–105 条件 3 — 物化谓词穷举

schema `AttemptResult` 八成员联合（DENY 面零改动）× 实施后 `materializeStrictRecordUpdate`
谓词（reader.ts:946–972 本轮亲读）逐成员求值：

| schema 成员 | 变体 | 分类 | complete 可达 |
|---|---|---|---|
| committed/noop | — | none → 推进 | 可（合法 noop） |
| committed/update | 合法/畸形 | update/invalid → break | 可/否 |
| committed/update-omitted | — | omitted → break | 否 |
| rejected | — | none → 推进 | 可（自证无提交） |
| fatal（无 effect） | committed:true / **committed:false** | **unknown → issue+break** / none（R-4 残差） | **否**/可 |
| fatal/update | committed:true / committed:false | update / none（R-4 残差，G-227-2 维持） | 可/可 |
| fatal/update-omitted | committed:true / committed:false | omitted / omitted（K-2/N-A 备案臂） | 否/否 |
| fatal/unknown | committed:true / committed:false | **unknown → issue+break** / none | **否**/可 |
| 联合外怪形 | — | 落 fatal 成员 ⇒ unknown；或 VFSL 拒 ⇒ invalid | 否 |

- **不存在任何 `committed:true` 形状落入 `none` 推进面**（ADR-0011 条件 3「每个非-noop
  committed record 都携带可解码的 Yjs update」对 fatal-committed-unknown/effect 缺席不可证 ⇒
  按 L318 必要条件框架不允许 complete）——旧实现推进至 complete 属实施偏差，本票纠偏。
- L87 枚举的 effect 缺席形状（schema 第 5 成员，emitter 不可达、盘面可达经手拼/第三方 writer）
  落 ADR 枚举联合之外，strict reader fail-closed 处置（→ unknown 通道）是 L305 纪律的正当延伸。
- **L89**「rejected 与 fatal committed:false 禁止携带 update」：写侧 `resultShapeValid`/
  `canonicalResult` 强制面（pipeline.ts DENY 零改动）未触碰；读侧对 committed:false 族
  `'update'` 残差维持 none（G-227-2 裁定）、`'update-omitted'` 取 N-A 方案 A 备案臂（K-2 手拼
  pin D4c 钉死 `partial + update-omitted` 不推进）——两臂均不可能假 complete，与
  「禁止携带」的写侧规范不冲突。
- replay 侧（diagnostic-replay.ts:196–271 亲读）：app 侧 result 联合手工推导整体删除，
  `materializeStrictRecordUpdate` 为唯一分类源（apps AGENTS.md「Consume only package public
  exports」强化）；switch `'unknown'` → `update-unknown` + `break entryLoop`，lastSeq/expectedNext
  不动（INV-227-6）；连续性复核先于物化/omitted（N-1）。

### 2.4 其余条款与模块契约

| 条款 | 核验 | 裁决 |
|---|---|---|
| ADR-0012-LOG **L196–212** record schema 单源 + 指纹冻结 | schema.ts/record.ts zero-diff；schema-freeze.test.ts 在 68/68 定向集外围但 SA7 CMD3 包级 448/448 内绿——修消费侧而非 schema，避开「id 升 @2 + 新 generation」版本雪崩 | ✅ |
| ADR-0012-LOG **L214**「VFSL 校验失败 = writer bug」+ **L20–24**（ADR-0011）best-effort 隔离 | 写路径（emission/pipeline/sink）zero-diff；本票纯读路径 + retention 内部，零 emit 接线、零 sequencer 触碰 | ✅ 无涉 |
| ADR-0012-LOG **L218** 单进程独占 rootDir（INV-9） | 租约注册表维持进程内共享结构，未引入跨进程锁 | ✅ |
| 包 AGENTS.md 词表纪律 | 新码恰四且归属正确（本轮 grep 亲证）：reader 域 `lease-expired`/`segment-vanished`（reader 稳定码表 29→31，头注成文）；replay 工具域 `update-unknown`/`lease-expired`（app 侧）。**零新增 update-omitted reason**（CONTEXT.md「语义 emission」三值词表零触碰——O-2 裁定维持）；零 health 事件成员变更（`emitRetentionSweptIfAction` 仅注释，N-3 频率语义备案） | ✅ |
| 包 AGENTS.md「改实现不改测试断言」（SA6 owned） | K-1 pin 改写 diff 逐字亲读：旧断言（complete/issues:[]/lastSeq'4'/count=9）废止，新断言（partial/[update-unknown]/lastSeq'2'/count=5）+ 头注 4 号条目同步改写并显式标注「K-1，SA6 同 change 废止旧 pin」——issue AC3 逐字要求的**收紧方向**改写，经设计 R-5/SA2 K-1 binding 预授权路径，同 change 由测试 owner 落地 | ✅ 合法演进 |
| 包 AGENTS.md #227 增量段（+20 行）/ README（+23 行） | 本轮亲读：文档只描述已实现行为（与 §1/§2 代码锚点逐点相符），无虚构行为；承载 N-3/K-2/新码词表备案——docs/AGENTS.md「文档不得虚构实现行为；行为变更 ⇔ 成文契约互跟」双向满足（K-4 头注同步亦在场，:12–15/:22–27） | ✅ |
| apps AGENTS.md 边界 | app 侧只消费包公共导出（materialize 单源化）；`DiagnosticReplayReadSessionOptions` 纯加性类型导出（O-1 维持接受） | ✅ 强化 |

## 3. 历史轮移交项闭环核验

| 移交项（来源） | 本轮独立核验 | 状态 |
|---|---|---|
| **N-A**（SA8 design 轮）：fatal∧committed:false∧omitted 残差翻转未备案 | SA2 §3.1 裁定方案 A（维持无条件 omitted 分支 + 备案 + K-2 pin）；实施谓词 `effect==='update-omitted'` 无条件（:947–951，注释明示 K-2）；D4c pin `partial + update-omitted + lastSeq='3'` 在 68/68 绿集内 | ✅ 闭环 |
| **N-B**（SA8 design 轮）：replay `readSession` 供参 throw 面 | K-3 落地：open 位于内层 try/finally 之外、顶层 catch 之内（:129–136 vs :309–320 亲读）；非法供参 → `failed` + 既有 `replay-internal-error`（grep 亲证零新码）；K-3a/b pin 绿 | ✅ 闭环 |
| **N-C**（SA8 design 轮）：头注五条件措辞同步 | K-4 落地：diagnostic-replay.ts:12–15「（#227 K-4 措辞同步）必要条件收紧」段 + :22–27 租约生命周期段亲读，与实现语义一致 | ✅ 闭环 |
| **N-1/N-2/N-3**（SA2 R0 备案） | N-1 连续性复核前置（:221–224 + D4d）；N-2 pre-genesis 物化前置（D9）；N-3 P0 跳过计入 `leaseBlockedGroups` + AGENTS.md/README 双备案 | ✅ 闭环 |
| SA2 **K-1..K-4 binding** | 逐项见上；K-1 见 §2.4 | ✅ 全兑现 |
| SA4 **O-1..O-4** / SA7 **V-1** | O-1（类型 re-export）/O-2（CONTEXT.md 未改——词表义务经 AGENTS.md 满足）/O-3（marker `isFileSync` 理论边界）/O-4（设计 §9 命令笔误）均维持「接受/备案」，非 ADR 冲突；V-1（版本 bump 缺位）见 §5 | ✅ 维持 |

## 4. 本轮独立重跑证据（后台 Job，2026-09-06 21:26 UTC）

| 套件 | 结果 |
|---|---|
| 定向契约 6 文件（strict-reader-lease / file-adapter-retention-lease-gate / strict-reader-materialize-unknown / file-adapter-read-session / diagnostic-replay-lease-completeness-red / diagnostic-replay-host-lifecycle-red，含 E1–E5 真实进程 E2E） | **Test Files 6 passed (6) / Tests 68 passed (68) / Type Errors no errors / exit 0**（39.29s）——与 SA7 CMD1 独立复现一致 |

（冲突门禁以静态 ADR 比对为主证；本套件为租约/完整性契约面的动态佐证。SA7 已另亲跑
包级 448/448、typecheck 14/14、全量 2906/2906 与 SA5 故障翻转证明，本轮无重复必要。）

## 5. 非阻断观察项（非 ADR 冲突，移交总控知悉）

- **V-1 继承（版本 bump 缺位）**：`packages/namespace-diagnostic-log`（0.1.6）与
  `apps/yjs-server`（0.1.3）src 变更未 bump patch 版本。SA7 已引 repo CI 立法
  （`.github/workflows/ci.yml` L68–73：版本提升属 release 流程非 PR 门禁）裁为不阻断；
  本轮确认该事项**不属任何 ADR 条款**（冲突门禁面无涉），维持移交 release 流程裁量。
- **派发日志稀疏**：`task_issue-227_dispatch.md` 仅 SA1 一行，后续派发未补记——总控职权
  域，不影响本门禁证据链（各 SA 证据文件齐全且已随 `31ff694` 入库）。

## 6. 结论与边界

- 实施变更集（`31ff694`）与 ADR-0011 / ADR-0012-LOG 全部被引条款、包/app AGENTS.md 契约、
  根 CONTEXT.md 词条**零冲突**；五缺口修复为兑现型实施，replay 收紧为必要条件方向加严，
  冻结面（报告形状、complete 门、schema/result 联合、删除协议文法）逐字保持。
- 历史轮全部移交项（N-A/N-B/N-C、N-1..N-3、K-1..K-4）闭环；定向契约 68/68 本轮独立重跑绿。
- 本轮零生产代码、零测试、零 git 写操作；测试经后台 Job 执行；唯一写入 = 本文件。

结构化结果：verdict **clear**、`requiresConflictRecheck: false`；
artifactPaths = 本文件 + 历史冲突报告/决议基线 + SA3/SA4/SA7 证据 + 提交 diff 可复现锚
（`git diff ac91a6b..31ff694`）。

Verdict: **clear** — `requiresConflictRecheck: false`
