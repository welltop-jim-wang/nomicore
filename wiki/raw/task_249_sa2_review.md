# SA2 独立攻击评审 — Issue #249 设计（task_249_design.md）

- 被审对象：`wiki/raw/task_249_design.md`（SA1 design，590 行）
- 任务简报：`wiki/raw/task_diagnostic-pump-singleflight-duplicate.md`（AC1–AC8 + SA6 R0 红灯契约固话）
- 输入产物：SA5 故障分析 `wiki/raw/20260906-bug-249.md`（clear）；SA6 契约两文件
  `packages/namespace-registry/test/registry-issue-249-pump-red.test.ts`（374 行全文）、
  `registry-issue-249-duplicate-red.test.ts`（279 行全文）+ R0 验证记录
  `wiki/raw/task_diagnostic-pump-singleflight-duplicate_sa6_red_verification.md`；前置 SA8
  `wiki/raw/task_249_conflict_report.md`（clear）；设计后 SA8
  `wiki/raw/task_249_design_conflict_report.md`（clear，卫生注记 N1–N5）；决议摘录
  `wiki/raw/task_249_relevant_decisions.md`
- 独立核验方式：设计引用的全部代码锚点亲读源码（diag-pump.ts 151 行全文、create-diagnostic.ts
  512 行全文、observer.ts 96 行全文、registry.ts L202/L818–870/L1240–1449、vocabulary.ts 全文、
  schema-patterns.ts、pipeline.ts intake 与 code↔sourceModule 成对段、types.ts、index.ts、
  testing.ts、registry-surface.test.ts 三正则与 R4 注释、apps/yjs-server app.ts 与 diagnostics.ts、
  五套件 + sa7-dynamic 关键锚、`task_issue-226_design.md` §3.1 L110–116）；ADR 六份关键条款
  原文回查（0011 L20–26/L40–49/L57、0012 L238–242、0009 L95、0010 L28）；**红灯契约独立后台重跑**
  （Job `bash-10`：`6 failed | 7 passed (13)`，`Type Errors: no errors`，Duration 3.71s——
  与 SA6 R0 / SA8 bash-9 逐项一致，红灯稳定非环境噪声）
- 评审人：SA2 Design Attack Reviewer；Worktree `/home/wangjian/nomicore-fix-issue-249`
  （branch `mabf/issue-249`，HEAD `ac91a6b`）；日期 2026-09-06（UTC）
- 本轮边界：零产品代码改动、零测试改动（全部只读）；唯一写入 = 本评审文件；测试经后台 Job 独立进程

## Verdict

**approve**（`requiresConflictRecheck: false`）

1. **特派焦点——SA8 标出的三项 SA6 契约对齐需求，本轮全部独立复算成立，且确为 SA3 修绿的
   硬前置**：R2a 与 T-C 是**运行时击穿**（绿锚被修复本身变红），R3-2 是**类型级击穿**
   （`.test.ts` 文件类型坏死，经 `pnpm test` 的 typecheck 程序暴露）。逐项复算见 §1。
2. 设计本体攻击面（单飞状态机时序、reportDrop 载荷与落点、候选词表映射、归属/建流、legacy
   no-op、耗尽 observer-only、clock/输入纪律、冻结面清单）经源码与 ADR 逐条独立核验**全部命中**，
   未发现阻断缺陷（§2）。
3. 新发现 7 项观察/勘误 **O1–O7（均非阻断、零规范冲突）**，其中 O1（§15-2 计数锚扫描面不全）
   与 O2（§10.3 门禁机制描述不准）建议随 SA6 对齐落地修正（§3）。
4. SA8 两轮报告（前置 clear / 设计后 clear）的事实主张与卫生注记 N1–N5 逐条独立复核**成立**（§4）。
5. 路由背书：**SA6 契约对齐（含 N4 形状定夺）→（建议）修订契约轻量复检（N5）→ SA3 修绿 →
   SA4/SA7 双清；SA3 不得先于 SA6 对齐进入**。

## 1. 三项 SA6 契约对齐需求的独立复算（评审特派焦点）

### 1.1 §10.2 R2a —— 成立（运行时击穿，对齐是硬前置）

**独立推演**（按设计 §4.2 修复后伪码逐符号执行 R2a 场景，对照 pump-red L243–258 与手工调度器
L77–82）：

| 步骤 | 旧泵（running-only `draining`） | 修复后（`inflight` 合一位） |
|---|---|---|
| enqueue(emission(1)) | 排 S1（`draining` 空） | 排 S1，`inflight.add` |
| enqueue(emission(2)) | **排 S2（缺陷：窗口重复调度）** | 位已置 → 不排 |
| flushOne #1 | S1 投递 1、2 | S1 投递 1、2，回调 finally 清位 |
| enqueue(emission(3)) | 排 S3 | 排 S2 |
| flushOne #2 | S2 stale 空转 no-op | S2 投递 3 |
| flushOne #3 | S3 投递 3（绿） | `pending` 空 → **throw `no pending immediate to flush`（红）** |

- 修复后全场景恰 **2 次调度**——设计主张精确成立；第三次 `flushOne` 必抛（调度器
  `flushOne` 对空 `pending` 无条件 throw，pump-red L77–82）。
- R2a 现为绿锚、修复后必红 → **SA6 对齐是 SA3 修绿的必要条件，非可选**。除非不修 AC1
  （保留重复调度），否则无任何实现路径可让现行 R2a 编排保持绿——穷尽性成立。
- **N4 勘误独立复核：正确**。设计 §10.2 示例字面次序（flushOne 投递 1 → 入队(2) → 重调旧回调）
  下，重调时队列**已含任务 2**，stale 回调将消费 2、其后活回调空转——`delivered === [0001, 0002]`
  仍绿、零丢失/零重复/保序仍被锁定，但探针性质变为「stale 回调消费待投任务时仍安全」而非
  「空队 stale no-op」。本轮对 SA6 两个候选形状按修复前/后**双向推演均绿**（双向绿要求成立）：
  - (a) 重调置于入队(2) **之前**：队列真空，真「空队 no-op」——旧泵/新泵均绿；
  - (b) 保持字面次序：stale 消费 2、活回调空转——旧泵/新泵均绿，`delivered` 断言不变。
  - **建议 SA6 取 (a)**（保原 R2a 语义「stale duplicate callback … is a no-op」），并按 N3 在
    契约头**显式登记机制更换的授权性质**：R2a 头（pump-red L17–19）只有「现实现成立，修复不得
    破坏——以『持续绿』验收」条款、**无** R3-2/T-C 那样的明文预留通道（本轮亲读契约头复核
    N3 准确）；其修订合法性唯一锚是「守护锚语义保持（stale 安全、零丢失、FIFO）前提下的制造
    机制更换」——须落字为契约头注释，且修订版须声明双向绿（旧泵/新泵）已验证。
- **O7（判别力登记，移交 SA6）**：修订后 R2a 不再覆盖「重复调度产生第二个 pending 回调后触发」
  形态——该形态在修复后结构性不可达（正是缺陷本体），覆盖域收窄为「已触发回调的重复触发」
  违约域。与 R2b/R2c/R2d 联合仍锁定设计 §4.3-4 全部坏修复反例（本轮逐形推演：位清除时序错位
  → R2b 红；循环外缓存队列引用 → R2a/R2b 红；位不提前到排定点 → R1a/b/c 红）。SA6 应在契约头
  如实标注覆盖域。

### 1.2 §10.3 R3-2 —— 成立（类型级击穿；门禁机制描述需修正 = 本轮 O2）

**逆变推演独立复核：成立**。修复后 `DiagPumpDeps.reportDrop?: (drop: DiagPumpDropReport) => void`
（判别联合：`init-stream` 分支无 `operation`）。现契约 L347–361 的
`satisfies DiagPumpDeps & { reportDrop: (drop: DropReport) => void }`（`DropReport = {operation:
string; reason:'queue-full'}`）要求 lambda 参数同时满足交目两签名——函数参数逆变要求
`DiagPumpDropReport` 可赋给 `DropReport`，而 init-stream 分支缺 `operation` → 不成立 → 该
`.test.ts` 文件类型坏死。当前 HEAD「Type Errors: no errors」恰因现 `DiagPumpDeps` 尚无
`reportDrop`（本轮独立重跑亦然）。

**O2（新发现——设计依据表述勘误，结论不变）**：设计 §10.3 括注「sa6 运行日志含 Type Errors
面板——typecheck 开启」作为击穿通道**不准确**：

- `pnpm typecheck` = 逐包 `tsc -p packages/<pkg>/tsconfig.json`，而
  `packages/namespace/tsconfig.json` 的 include **仅 `src/**/*.ts`**（本轮亲读）——测试文件
  永不进入该门禁的编译面；
- vitest `typecheck.include` **仅 `*.test-d.ts`**（vitest.config.ts L18–21）——两契约 `.test.ts`
  不是 vitest typecheck 的测试文件面（「Type Errors」面板计数的是 test-d 面）；
- 击穿的**真实通道**：`pnpm test`（= `vitest run --typecheck`）的 tsc 程序按
  `tsconfig.typecheck.json`（include 覆盖 `packages/*/test/**/*.ts`）编译全程序，非 test-d
  文件的类型错误默认（`ignoreSourceErrors: false`）作为 unhandled/source error 报告并使运行失败。

结论（对齐必行、错位会使 AC8 的 `pnpm test` 转）不变，但 **SA6 不得以「CI 会替我们发现」为
兜底理由**，应按既定顺序主动对齐；SA6 定形时另注意「既有断言全数保留」是**语义级**成立——
联合形状下 `r.operation` 访问需先按 `kind === 'emit'` 收窄（或等价 type guard），语法上必有调整。

### 1.3 §10.4 T-C —— 成立（运行时击穿；算术、归属与建流逐项复算）

- **算术**：`MAX_NAMESPACE_ID_RETRIES = 8`（registry.ts L202，注释「首生成 + 至多 8 次重试 =
  总生成 ≤ 9」）；循环 `for (retry = 0; ; retry += 1)` 在 `retry > 8` 时 fatal（L1268–1273）→
  T-C 恒碰撞编排（scripted ids 恒 NS_A）共 **9 个碰撞候选**。D-2「链内每个碰撞候选照常发
  rejected」→ NS_A 流 = 1 committed（create#1）+ 9 rejected = **10 ≠ 1** → 现断言
  `expect(nsARecords.length).toBe(1)`（duplicate-red L276）与 `[0].result.kind === 'committed'`
  的组合必红。设计主张精确成立。
- **归属/建流复算**：`streamedNamespaces` 为**入队时登记**（create-diagnostic.ts L440–444：
  `enqueueInitStreamTask` 先 `add` 再入泵）——create#1 成功路径已登记 NS_A → create#2 的 9 次
  `emitCandidateOutcome` 全部经 `seedRejectedStreamIfAbsent` no-op（L446–449）→ **initStream
  恒恰 1 次（零补建）**，§10.4 对齐版断言与代码结构逐项吻合。候选结局以候选 id 数据键控入泵
  （与 `emitOutcome` 同构，L462–467）→ `unattributedDrops` 恒零成立。
- **clock 侧读**：碰撞候选未过 Clock 步（L1311 判定在 `preparedBox` 初始化之前）→ 每候选
  `readEarlyObservedAt` 侧读一次（9 次）；T-C 测试 clock 为 `{now: () => NOW_MS}` 无计数断言，
  不受影响。DC-3「每尝试恰一次」语义保持（每候选 = 一次变更尝试，一次读数）。
- **D-2 裁决复核（规范依据）**：ADR-0011 L57 原文枚举「输入、schema、ROOT、duplicate、
  Persistence 与 post-commit Runtime construction 结局」**确不含** id 生成耗尽（本轮逐字回查）；
  ADR-0010 L28「撞到…最多重试 8 次，耗尽以 committed:false Registry fatal 失败」为业务终局
  原文；可见性双通道（observer `create-id-generation-failed` 恰一次——observer.ts L40–45 亲证
  + 公共 branded fatal）既有。保守裁决、零词表/归属发明——成立。契约头「耗尽链路……待设计冻结
  后由 SA6 对齐」（duplicate-red L20–23 亲读）明文预留该对齐通道。

**小结**：三项对齐需求真实性、必要性、顺序性（先于 SA3）全部独立成立；SA8 设计后报告的
流程条件「SA3 不得先于 SA6 对齐进入」本轮背书。

## 2. 设计其余主张的独立核验（全部命中）

| 设计主张 | 本轮独立证据 | 判定 |
|---|---|---|
| §4.1 现缺陷机制（running-only 位；容量早退先于调度） | diag-pump.ts L83/L107/L117/L128–132/L134 逐行吻合 | ✅ |
| §4.3 AC1/AC2 时序论证（break→queues.delete→inflight.delete 间零 Host 代码；drain 期位恒置 → 重入同轮消费） | 修复后伪码结构推演：同步直线无回调点；R1d/R2b/R2c/R2d 修复后逐用例推演绿（scheduleCount=1 / delivered 序 / initStreams 序 / pending=0 全部满足） | ✅ |
| §4.3-3 stale 重调降级态「降级但安全」（记录不丢不重保序） | 双向交错推演成立；不引入代际 token（A3 否决）合理——真实原语不产生该交错 | ✅ |
| §5.2 `DiagPumpDeps` 现仅 initStream/resolveEmitter 两面 | L60–65 亲证 | ✅ |
| §5.3 observer 落点：联合按票增量先例、dispatchObserver 缺席 no-op + try/catch 隔离、index.ts 零导出 | observer.ts L21–53（#111/#112/phase-5/#133/R2 增量注释）+ L73–83；index.ts grep 零 observer/pump 导出（仅 L9 排除性注释） | ✅ |
| §5.4 接线可行（testing seam 已有 observer 注入面） | testing.ts L37/L123/L145–146 `observer?: RegistryObserver` —— §13.3-b 零新公共面即可落地 | ✅ |
| §6.1 两发射点现状（L1311/L1410 静默 retry；L1248–1254 头注释立场） | registry.ts 亲证逐字 | ✅ |
| §6.3 词表映射（stage 8 值含 identity/transaction；sourceModule 4 值含 persistence；两码匹配 intake Pattern；code↔sourceModule 成对由管线强制） | vocabulary.ts L15–33/L53–66；schema-patterns.ts L25 `^[A-Za-z0-9_.:-]{1,128}$`；pipeline.ts L64–77（RE_STABLE_CODE intake）+ L238–255（单侧缺失丢字段+健康事件）；assembleEmission 现 hardcode `sourceModule:'registry'`（create-diagnostic.ts L248）→ 增可选 `sourceModule` 是兑现成对纪律的必要通道 | ✅（O5 见 §3） |
| §6.4 归属与建流（seed 入队时登记；T-A 不补建/T-B 恰一次 genesis-less） | create-diagnostic.ts L440–449 亲证；T-A NS_A 队列 FIFO 序 [init, committed, rejected]、T-B [init(genesis-less), rejected] 推演与断言逐条对上 | ✅ |
| §6.5 legacy no-op（D-1）：L529 冻结锚 + 生产形状覆盖义务 | registry-create-diagnostic-red L527–552（binding `{emitter}` 无 runtimeEmitterFor → legacy，断言 attempt 恰 1 条）亲证；生产装配 runtimeEmitterFor 在场（apps/yjs-server diagnostics.ts L129）→「义务在生产形状兑现」成立 | ✅（另见 O1：D-1 还保护 sa7-dynamic 的 10-emit 锚） |
| §6.7 clock/输入纪律（两个既有 clock 锚均不受影响） | registry-create.test.ts **全文件无 diagnosticLog 注入**（grep 亲证）→ 其全部 `clock.calls` 锚（L423/L1565 族）在 NOOP 场景；registry-create-diagnostic-red L399 有日志但无碰撞成功场景——N2 的补全表述正确 | ✅ |
| §15-3 生产 Host 零 observer 注入 | app.ts L214–221（仅 idleTimeoutMs + diagnosticLog）亲证 | ✅ |
| 守卫面（三正则不含 setImmediate；修复后仍单点） | registry-surface.test.ts L283–284 + R4 注释契约亲证；设计不新增 setImmediate 消费者 | ✅ |
| #226 §3.1 L112–114 冻结文引用 | 逐字核对一致（另见 O4 措辞注） | ✅ |
| 红灯基线（6 红 / 7 绿，Type Errors 0） | **本轮独立后台重跑（Job bash-10）逐项复现**：R1a/R1b/R1c（256≠1）、R3-2（0≠44）、T-A（1≠2）、T-B（0≠1）红；R1d/R2a–d/R3-1/T-C 绿 | ✅ |
| 指纹/schema 冻结（§14） | namespace-diagnostic-log 零改动 → 指纹不变平凡成立；schema-freeze/test-d 面不受触碰 | ✅ |

## 3. 新发现（观察/勘误，均非阻断、零规范冲突）

- **O1（§15-2 扫描面不全——结论不变，陈述须修正）**：设计称「已扫描诊断 5 套件 + create +
  surface：唯一计数锚为 L529」。本轮全测试树扫描发现 `registry-create-diagnostic-sa7-dynamic.test.ts`
  另有**诊断计数锚位于 duplicate 场景**：重点 1 test 4「合法形状 emitter 但 emit 恒 throw」断言
  `emitCalls === 10`（10 次 create 尝试恰 10 次 emit——其中 P3 即 DOC_DUPLICATE 内部重试路径，
  今日该候选零发射；若候选也发射将变 11 → 红）以及重点 2/3 的 stream 记录数锚（`records.length`
  2/3）。**全部安全的原因**：该文件全部 diagnosticLog 绑定均无 `runtimeEmitterFor`（grep 亲证）
  → legacy 形状 → 由 **D-1 no-op 裁决**保护，零破坏。但正确陈述应为「受候选 emission 影响的
  计数锚不存在——L529 与 sa7-dynamic `emitCalls===10` 均由 legacy no-op 保护」。两点价值：
  (i) D-1 的必要性再添独立一证（若当初选 C1，sa7-dynamic 即破）；(ii) §15-2 的扫描证据链有漏，
  实际兜底是 AC8 全量 `pnpm test` + SA4/SA7——建议 SA3/SA4 将 sa7-dynamic 列入显式观察面。
- **O2（§10.3 门禁机制描述——见 §1.2）**：`pnpm typecheck` 不看测试文件（逐包 tsconfig 仅
  include src）；vitest typecheck 仅 test-d 面；击穿经 `pnpm test` 的 tsc 程序 unhandled error
  报告。结论不变，依据表述须修正。
- **O3（§4.2 自述矛盾——文字勘误）**：「`drainNamespace` 本体与 `runTask` 逐字节保持」与同节
  (a)/(b) 变更自相矛盾——`draining` 簿记（`draining.add` / try/finally `draining.delete`）移出
  后本体必然少三行。真正逐字节保持的是**循环结构（每轮重取引用、空判 break、排空 delete）+
  `runTask`**。SA3 实现按结构等价理解，勿按字面逐字节。
- **O4（#226 条款语义框架——措辞级）**：#226 §3.1 冻结文「入队后若该 ns 未在 drain，则
  setImmediate(drainNs) 一次……完毕置 draining=false」**未言明置位时点**，「未在 drain」的
  自然读法在 scheduled-vs-running 上两可（PR #248 实现取 running 读法并非无据）。设计/SA5 将
  合一位表述为 #226 的无歧义冻结语义略有过度；**本票 AC1（「同时至多一个 scheduled/running
  drain」）才是无歧义规范源**，结论不受影响。
- **O5（stage 释义张力——登记给 SA3/SA4）**：ADR-0011 L48 `transaction` 释义「已进入事务/应用
  阶段并**产生 committed 或 fatal 事实**」不逐字覆盖零提交的 rejected 结局；DOC_DUPLICATE→
  transaction 的正当性锚是**先例**而非释义（registry.ts L1413–1416 既有 `transaction` +
  `NAMESPACE_CREATE_FAILED` + `rejected`；#150 映射同款）。T-B 契约不锁 stage，无冲突；建议
  SA3 注释引用先例（既有码族同 stage）而非 ADR 释义句。
- **O6（敌意 setImmediate 回滚——正向改进 + 残留边界登记）**：现泵 `setImmediate` 裸调用无
  catch（diag-pump.ts L137）——敌意全局 throw 将沿 `enqueue` 外溢进业务槽，是**既有的潜在
  非抛契约违约**；设计 §4.2 的位回滚是严格改进。残留边界：若 throw 持续且该 ns 再无入队，
  已接纳任务滞留队列（≤256/ns 有界、不外溢、不重复投递）——可接受降级，建议 SA3 在 catch
  注释中登记该滞留语义。
- **O7（R2a 修订契约的判别力收窄——见 §1.1，移交 SA6 落字）**。

## 4. SA8 两轮报告复核

- **前置门禁（clear）**：检查范围与逐项说明的事实锚（ADR 条款原文、vocabulary 冻结值、
  #226 历史立场属证据非规范、两条合规路径）本轮抽查全部成立。
- **设计后门禁（clear + N1–N5）**：11 项 ADR 对照与 3 项契约推演的事实主张逐条复核成立：
  - N1 勘误亲证：`NAMESPACE_ALREADY_EXISTS` 实际位于 types.ts **L65/L292/L330**；L455–480
    区间确为 replication session 码族（`OpenReplicationSessionIssueCode` 等）——设计 §6.3
    「types.ts L470」引用行号错、码存在且冻结、结论不变。SA3/SA4 注释引用时按 N1 更正。
  - N2 亲证：L399 `clock.calls === 1` 在有日志、无碰撞的单候选成功场景；`emitCandidateOutcome`
    仅在碰撞/duplicate 分支触发 → 不受影响。
  - N3 亲证：R2a 契约头无预留通道条款（与 R3-2 L27–34、T-C L20–23 的明文预留对照成立）。
  - N4 亲证：见 §1.1（双向推演成立）。
  - N5 认可：轻量契约级复检（触发面仅三处测试力学 + N3/N4/O2/O7 落地核验）值得执行。
- **流程条件**：「SA6 对齐先于 SA3 修绿」本轮以三重独立确认（R2a/T-C 运行时击穿 + R3-2 类型
  坏死）背书。

## 5. 残余风险与路由

| # | 风险 | 本轮评估 |
|---|---|---|
| §15-1 对齐未先行 → 修绿被击穿 | 三重独立确认成立；顺序硬门 | 维持 |
| §15-2 未扫描到的计数锚 | **O1 修正**：sa7-dynamic 另有锚但均被 D-1 保护；兜底 = AC8 全量 + SA4/SA7 | 维持（陈述修正） |
| §15-3 observer 穷尽 switch | 生产零注入（app.ts 亲证）+ testing 注入为数据回调；加法变体 | 维持 |
| §15-4 clock 读数放大 | 每候选一次、无既有锚受影响（L1565 无日志 / L399 无碰撞） | 维持 |
| §15-5 stale 重调降级态 | 推演成立；文档化已知降级域 | 维持 |
| O2 | 类型门禁认知偏差 → 对齐被动等 CI | 由 SA6 主动对齐消解 |

**路由**：SA2 本评审（approve）→ **SA6 契约对齐**（§10 三处：R2a 建议取 N4-(a) 形状并显式登记
授权性质与双向绿验证；R3-2 判别联合化（含 `kind` 收窄后的断言语法）；T-C 按 D-2 对齐）→
（建议）修订契约轻量冲突复检（N5，含 O2/O7 落地核验）→ SA3 修绿（§13.4 命令，后台进程执行）
→ SA4/SA7 双清。

## 6. 结论

- 设计覆盖 AC1–AC8 全部验收面且经独立攻击核验无阻断缺陷；三项 SA6 契约对齐需求全部真实、
  必要且必须先于 SA3 落地；新发现 O1–O7 均为勘误/观察级，无一构成规范冲突或实现阻塞。
- **Verdict: approve**；`requiresConflictRecheck = false`（三项对齐均属契约力学/预留通道/
  守护锚语义保持域，无新规范决策；O1–O7 亦无规范演进触发——与 SA8 两轮 clear 一致）。

## 附录 A — 红灯契约独立重跑证据（本轮，Job `bash-10`）

```text
命令：NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run \
  packages/namespace-registry/test/registry-issue-249-pump-red.test.ts \
  packages/namespace-registry/test/registry-issue-249-duplicate-red.test.ts --reporter=verbose
结果：Test Files 2 failed (2)；Tests 6 failed | 7 passed (13)；Type Errors no errors；Duration 3.71s
红灯逐项：R1a/R1b/R1c（expected 1, received 256 族）、R3-2（expected 44, received 0）、
          T-A（expected 2, received 1）、T-B（expected 1, received 0）
绿灯锚：R1d、R2a–R2d、R3-1、T-C —— 与 SA6 R0 验证记录及 SA8 bash-9 重跑逐项一致
```

## 附录 B — 关键行号锚对照（本轮亲证）

| 锚 | 位置 | 用途 |
|---|---|---|
| running-only 调度门 | diag-pump.ts L83/L107/L117/L128–140 | §4 缺陷机制 |
| 手工调度器 throw 点 | registry-issue-249-pump-red.test.ts L77–82 | R2a 击穿机制 |
| R3-2 satisfies 组合 | 同上 L343–361 | §10.3 类型击穿 |
| T-C 计数断言 | registry-issue-249-duplicate-red.test.ts L273–277 | §10.4 击穿 |
| 重试预算 | registry.ts L202/L1268–1273 | 9 候选算术 |
| 静默 retry 分支 | registry.ts L1311/L1410 | §6 发射点 |
| seed 入队时登记 | create-diagnostic.ts L440–449 | 归属/建流 |
| sourceModule hardcode | create-diagnostic.ts L248 | §6.2 参数必要性 |
| 成对纪律 | pipeline.ts L238–255 | 词表成对 |
| legacy 冻结锚 | registry-create-diagnostic-red.test.ts L527–552 | D-1 依据 |
| clock 锚（无日志/无碰撞） | registry-create.test.ts L423/L1565 族；registry-create-diagnostic-red.test.ts L399 | §6.7 |
| emitCalls===10 锚 | registry-create-diagnostic-sa7-dynamic.test.ts（重点 1 test 4） | O1 |
| 三正则 + R4 | registry-surface.test.ts L272–290 | 守卫面 |
| 生产装配 | apps/yjs-server/src/app.ts L214–221；src/diagnostics.ts L129 | §6.5/§15-3 |
| observer 注入面 | packages/namespace-registry/src/testing.ts L37/L123/L145–146 | §13.3-b 可行性 |
| tsconfig 编译面 | packages/namespace-registry/tsconfig.json（仅 src）；vitest.config.ts L18–21（test-d only）；tsconfig.typecheck.json（test 全量） | O2 |

Verdict: approve — `requiresConflictRecheck: false`
