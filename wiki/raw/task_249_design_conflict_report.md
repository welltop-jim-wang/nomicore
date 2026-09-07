# 设计冲突门禁报告 — Issue #249（design 后 ADR 冲突复审）

- 被审对象：`wiki/raw/task_249_design.md`（SA1 design，590 行）
- 任务简报：`wiki/raw/task_diagnostic-pump-singleflight-duplicate.md`（AC1–AC8 + SA6 R0 红灯契约固话）
- 前置产物：`task_249_conflict_report.md`（前置门禁 clear）、`task_249_relevant_decisions.md`（条款摘录）、
  `20260906-bug-249.md`（SA5 故障分析）、`task_diagnostic-pump-singleflight-duplicate_sa6_red_verification.md`（R0 验证记录）
- 冲突基准：`docs/adr/` 13 文件中被引 6 份的关键条款**本轮直接回查原文**（ADR-0011 全文；ADR-0014 诊断
  格式版 L14–26/L57–120/L194–252；ADR-0009 全文含 #131/#134 修订节；ADR-0010 L26–39/L151–159；
  ADR-0006 #64 修订 L114–133；ADR-0008 经摘录核对）+ `CONTEXT.md` 日志词条（L144–166）与
  namespaceId 词条（L121–123）
- 独立核验方式：被审设计引用的全部代码锚点亲读源码（diag-pump.ts 151 行全文、observer.ts 96 行全文、
  create-diagnostic.ts 512 行全文、registry.ts L1240–1439、vocabulary.ts 全文、pipeline.ts L55–90/L225–265、
  types.ts、index.ts、registry-surface.test.ts L272–284、apps/yjs-server app.ts L205–228、
  registry-create-diagnostic-red.test.ts（含 L399 clock 锚与 legacy 冻结锚）、registry-create.test.ts L1558–1572、
  两份 #249 契约文件头与关键用例、`task_issue-226_design.md` §3.1 L112–114）；红灯契约独立重跑
  （后台 Job `bash-9`：**6 failed | 7 passed (13)，Type Errors 0**——与 SA6 R0 验证记录一致，红灯稳定）
- 裁决人：SA8 Conflict Gatekeeper（设计后复审轮）
- Worktree：`/home/wangjian/nomicore-fix-issue-249`（branch `mabf/issue-249`，HEAD `ac91a6b`）
- 时间：2026-09-06（UTC）

## Verdict

**clear**（`requiresConflictRecheck: false`）

裁决分两层，结论一致但须分开陈述：

1. **ADR 层：设计合规，0 冲突**。设计的全部决策（§4 单飞位、§5 reportDrop→observer 新事件、§6 候选词表
   映射/归属/legacy no-op/耗尽 observer-only、§6.7 clock 与输入纪律、§9 冻结面）逐条对照被引 ADR 原文
   均为**既有条款的兑现或允许域内的实现强化**，无条款违反、无 override 声明需求、无词表演进触发
   （对照表见 §1）。
2. **契约层：三处对齐需求成立，但均非阻断冲突**。设计 §10 自行发现的三处 SA6 契约对齐（R2a 制造机制、
   R3-2 载荷类型、T-C 耗尽断言）经本轮独立推演全部成立（§2），但其中 R3-2 与 T-C 的对齐通道在契约头
   **明文预留**（「SA1 设计若选不同 seam 形状/命名，须经 SA6 对齐修订本契约」；「耗尽链路……待设计冻结后
   由 SA6 对齐补充」），R2a 属绿灯守护锚在**语义保持**（stale 安全、零丢失、FIFO）前提下的制造机制更换
   ——与 #226 复审裁定的「冻结契约对实现空间封闭、且无预留通道」性质不同。**流程条件**：SA6 对齐必须
   先于 SA3 修绿落地（与设计 §16 顺序一致）。

## 1. 设计决策 × ADR 逐条对照（ADR 层 0 冲突）

| # | 设计决策 | ADR 条款（本轮回查原文） | 裁决 | 依据 |
|---|---|---|---|---|
| 1 | **§4 `inflight` 单飞位**（scheduled+running 合一；排定点置位、回调末尾 finally 清除；drainNamespace/runTask 逐字节保持） | ADR-0011 L24（emitter seam 有界接收）/ L117（模块内部有界队列明文允许）/ L123（不得引入第二个业务排序机构——泵只序诊断投递） | no-conflict | 纯实现级调度修复，不改 seam、不改业务面。#226 设计 §3.1 L114「入队后若该 ns 未在 drain，则 setImmediate(drainNs) 一次（单飞）」语义引文本轮逐字核对；AC1 明文「至多一个 **scheduled/running** drain」——合一位是简报语义本体，现实现 running-only 是窄化偏差。AC2 交错不变量由 §4.3 时序论证保持（break→queues.delete→inflight.delete 之间零 Host 可执行代码，本轮按源码结构复核成立） |
| 2 | **§5.2 `reportDrop` 泵依赖**（判别联合载荷、每被丢任务恰一次、drop 点同步直报、不占同一队列、泵侧 try/catch 收编） | ADR-0011 L25（溢出可丢弃，「实现应尽力上报 dropped count、sink failure 和 queue health」）/ ADR-0014 L240（drop newest、保序、「不得为了记录 drop 再挤占同一队列。按 operation/reason 增加低基数 dropped metrics，并走独立 observer」）/ ADR-0010 L159 | no-conflict | 与 L240 逐字同构；`kind` 判别 + `operation?` 诚实缺席（init-stream 无词表位）不发明第 7 个 operation 值；reason `'queue-full'` 是 observer 健康事件维度而非 record schema 字段，不触 update-omitted reason 词表（CONTEXT L157 演进纪律不被触发）。#226「泵满静默」历史立场按前置门禁裁定让位——wiki/raw 属证据非规范（docs/AGENTS.md），裁决一致 |
| 3 | **§5.3 observer 新事件 `diag-pump-drop`**（载荷只有 type/taskKind/operation?/reason 四封闭维度，无 identity） | ADR-0009 L95（「Registry 核心通过内部结构化 observer seam 上报**生命周期与故障**；event **可携带**受控 identity 和 exact cause……v1 不提供公共事件订阅」）/ ADR-0011 L87 + ADR-0010 L159（双基数红线） | no-conflict | 「可携带」为许可而非义务——无 identity 的低基数健康事件合规；丢弃健康属 L25/L240 明文要求的故障/健康面。联合按票增量是该 seam 既定演进（observer.ts 头注 + #111 +2、#112 +3、phase-5、#133、R2 +1 增量史本轮亲证）。公共面保持：index.ts 不导出 observer 类型（本轮 grep 亲证，仅注释提及）；生产装配未注入 observer（app.ts L214–221 亲证——仅 idleTimeoutMs + diagnosticLog）；测试 seam 注入面为 ADR-0009 L114 明文允许项 |
| 4 | **§6.1/§6.2 两发射点 + `emitCandidateOutcome`**（retry return 之前、槽内 O(1) 纯内存；复用 assembleEmission/seed/enqueue 既有基础设施） | ADR-0009 L62（create 全流程同 lifecycle 槽——入队只能是槽内 O(1) 纯内存）/ ADR-0011 L20（诊断失败零业务外溢）/ L123–129 | no-conflict | 发射点位置（registry.ts L1311/L1410 两 retry 分支，本轮亲证现为静默 `return {kind:'retry'}`）在槽内 O(1)；新方法与既有 `emitOutcome`/`emitEarlyOutcome` 同构（create-diagnostic.ts L462–482 亲证），零新机制 |
| 5 | **§6.3 词表映射**（entry collision→identity/NAMESPACE_ALREADY_EXISTS/registry；DOC_DUPLICATE→transaction/DOC_DUPLICATE/persistence） | ADR-0011 L40–49（8 值 stage 含 L47 `identity`「namespace identity 不满足」、L48 `transaction`）/ L51（保留所属模块已有稳定 code，不发明）/ ADR-0014 L69–89（operation 6 值封闭；result 判别联合 rejected 禁带 update；code+sourceModule 成对标注 source module）/ ADR-0006 #64 L121–123（`DOC_DUPLICATE` 稳定码、duplicate 判定路径绝不覆盖） | no-conflict（零词表演进） | 全部取自既有冻结值（vocabulary.ts 亲证：stage 8 值、sourceModule 4 值含 persistence）；两码均匹配 intake `RE_STABLE_CODE`（pipeline.ts L64–77 亲证，不会在 intake 丢弃）；`NAMESPACE_ALREADY_EXISTS` 是 Registry 既有冻结结果码（types.ts L65/L292/L330 亲证）；code↔sourceModule 成对由管线强制（pipeline.ts L239–255 亲证：单侧缺失丢字段+健康事件）——设计新增可选 `sourceModule` 参数（缺省 'registry'，既有调用点零漂移）是兑现成对纪律的必要通道。**不触发** `@2`/新 stream generation/指纹钉死/设计评审演进通道（SA8 红线 1 的「既有词表」合规路径） |
| 6 | **§6.4 归属与建流**（归候选 id 流=既有 namespace 流；已建流不重复建流；未建流 genesis-less 补建恰一次；unattributed 恒零） | ADR-0014 L22（「genesis 未成功写入时 stream 仍可记录诊断事实」）/ CONTEXT.md L121–123（Registry 以 namespaceId 排他索引）/ ADR-0011 L57（create 覆盖含 duplicate/Persistence 结局——**既有要求**） | no-conflict | `streamedNamespaces` seed 语义与 `seedRejectedStreamIfAbsent` 本轮亲证（create-diagnostic.ts L440–449）——设计推演（T-A 不补建/T-B 恰一次）与代码结构一致；per-ns FIFO 保证 initStream 先于其后 emission（#150 DC-2 次序保持）。候选结局以候选 id 数据键控投递，不经共享通道（与 #226 C1 修复同构） |
| 7 | **§6.5 legacy 形状 no-op（D-1）** | ADR-0011 L23（日志允许缺失）/ L57（覆盖义务在生产装配形状兑现） | no-conflict（边界裁决登记） | #150 冻结绿锚本轮亲证（registry-create-diagnostic-red.test.ts ~L528–552：legacy 形状 + DOC_DUPLICATE 内部重试断言 attempt 恰 1 条最终结局）——no-op 裁决使其零漂移；legacy 共享通道无「namespace 的诊断流」概念，AC4 语义在该形状无承载；L23 best-effort 允许域内的保守选择 |
| 8 | **§6.6 耗尽终局不发诊断记录（D-2）** | ADR-0011 L57（首版覆盖枚举「输入、schema、ROOT、duplicate、Persistence 与 post-commit Runtime construction 结局」**不含** id 生成耗尽）/ L23（允许缺席）/ ADR-0010 L28（耗尽 committed:false fatal——业务终局原文） | no-conflict（边界裁决登记） | 扩域属新决策非本票义务；归属不可用（终局无归属 id，归最后候选流=语义发明）；可见性双通道既有：observer 事件 `create-id-generation-failed`（observer.ts 本轮亲证存在）+ 公共 branded fatal。**同时关闭 #226 设计冲突复审 §3-8 登记的「id 耗尽 fatal 零诊断发射」待复核边界项——两票裁决一致，该登记项就此结案**。链内碰撞候选照常发 rejected（候选级覆盖统一）与 T-A 同发射点，无特例分支 |
| 9 | **§6.7 clock/输入纪律**（collision 候选侧读一次 clock；DOC_DUPLICATE 复用 `p.createdAt`；input not-accessed / 复用 detached frozen snapshot） | ADR-0011 L69–77（输入零访问/单一安全快照/不建第二套序列化）+ CONTEXT.md L148–150（被拒请求也属变更尝试——每候选=一次变更尝试，DC-3 逐尝试单读保持） | no-conflict | 碰撞判定只读 entries map（registry.ts L1311 亲证）零输入访问；两个既有 clock 计数锚本轮亲证均不受影响：registry-create.test.ts L1565（无 diagnosticLog 场景——NOOP_DIAG 零侧读）与 registry-create-diagnostic-red.test.ts L399（有日志、无碰撞成功场景——emitCandidateOutcome 不触发）。业务路径 clock 读数零变化 |
| 10 | **§4.2/§9 调度原语与守卫面**（恒为裸 `setImmediate`，不引入被守卫原语） | registry-surface.test.ts 三正则（本轮逐字核对 L283–284：bare/globalThis `setTimeout/setInterval/clearTimeout/clearInterval` + `Date.now`，**不含 setImmediate**）+ #226 R4 注释契约（L275–282「本条注释只授权 diag-pump 一处」） | no-conflict（守卫面） | 修复后 setImmediate 仍只出现于 diag-pump.ts 单一调用点（enqueue 内），R4 许可范围不扩大；无新增 setImmediate 消费者 |
| 11 | **§10 契约对齐三处（SA6 owned）** | 契约预留通道（本轮亲读两契约文件头） | no-conflict（流程条件） | R3-2：pump-red 头 L27–34 明文「SA1 设计若选不同 seam 形状/命名，须经 SA6 对齐修订本契约」——判别联合属预授权通道。T-C：duplicate-red 头明文「耗尽链路……本票登记不预裁——待设计冻结后对齐」——D-2 即被等待的设计冻结。R2a：无同款明文条款（见 §3-N3），属守护锚语义保持下的机制更换，语义（stale 安全、零丢失、FIFO）保持。**条件：SA6 对齐先于 SA3 修绿**（设计 §16 顺序，本轮背书） |

## 2. 契约层三处对齐的独立推演（全部成立）

| # | 设计主张 | 本轮独立核验 | 结论 |
|---|---|---|---|
| §10.2 R2a | 修复后全场景仅 2 次调度，第三次 `flushOne` 将抛 no pending immediate，绿锚被修复击穿 | 契约 L243–253 亲读：三次 flushOne 的编排隐含旧泵重复调度（enqueue(2) 在 S1 执行前排 S2）。修复后 enqueue(1)→S1+inflight；enqueue(2) 见位不排；flushOne#1 投递 1、2 并清位；enqueue(3)→S2；flushOne#2 投递 3；flushOne#3 无 pending → 抛 | ✅ 成立 |
| §10.3 R3-2 | 测试本地 `DropReport {operation: string; reason}` 与判别联合的 `satisfies` 组合在 `--typecheck` 下必失败 | 契约 L343–368 亲读 + 逆变推演：需 `DiagPumpDropReport`（init-stream 分支无 operation、两分支带 kind）可赋给 `DropReport`——init-stream 分支缺 `operation` → 不成立 → type error。当前 HEAD「Type Errors 0」恰因现 `DiagPumpDeps` 尚无 reportDrop | ✅ 成立 |
| §10.4 T-C | 现断言 `nsARecords.length === 1` 将按 D-2 转红（1 committed + 9 rejected = 10） | 契约 L273–277 亲读：`expect(nsARecords.length).toBe(1)` 且 `[0].result.kind === 'committed'`；D-2 下 9 条碰撞候选 rejected 必然入 NS_A 流 | ✅ 成立 |

红灯契约独立重跑（后台 Job `bash-9`，本工作区 HEAD `ac91a6b`）：**6 failed | 7 passed (13)，Type Errors 0**——
与 SA6 R0 验证记录逐项一致（R1a/R1b/R1c、R3-2、T-A、T-B 红；R1d/R2a–R2d/R3-1/T-C 绿），红灯稳定非环境噪声。

## 3. 卫生注记（非冲突，登记移交）

- **N1（引用行号勘误）**：设计 §6.3 引「types.ts L470 既有冻结稳定码」——`NAMESPACE_ALREADY_EXISTS` 冻结码
  实际位于 types.ts **L65/L292/L330**（L460–480 区间为 replication session 码族）。码存在且冻结，结论不变；
  SA2 评审/SA3 实现注释引用时更正行号。
- **N2（clock 锚表述补全）**：设计 §6.7/§15-4 称「唯一 clock 锚在无日志场景」——另有
  `registry-create-diagnostic-red.test.ts` **L399** `clock.calls === 1`（有日志、无碰撞成功场景）。因
  `emitCandidateOutcome` 仅在碰撞/duplicate 分支触发，该锚不受影响（本轮亲证场景为单候选成功 create）。
  结论不变；建议 SA2 评审时把表述补全为「唯一受影响面锚 = L1565（无日志）+ L399（无碰撞）均不受影响」。
- **N3（R2a 对齐的授权性质）**：R3-2/T-C 的对齐通道在契约头**明文预留**；R2a 无同款条款（契约头只写
  「现实现成立，修复不得破坏——红→绿契约以『持续绿』验收」）。其修订属守护锚**语义保持**前提下的制造
  机制更换（原机制结构性依赖被修复消灭的重复调度）。SA6 修订须**显式覆盖 R2a**，且修订版须在修复前
  （旧泵）与修复后（新泵）**双向均绿**——本轮已按设计 §10.2 的形状完成双向推演，成立。
- **N4（R2a 示例机制勘误）**：设计 §10.2 示例的中间态描述「手动重调捕获的旧回调（stale：**空队 no-op、
  不吞 2**）」与其次序不自洽——按字面次序（flushOne 投递 1 → 入队(2) → 重调旧回调），重调时队列**已含
  任务 2**，旧回调将消费 2，其后 flushOne 的活回调空转。最终 `delivered === [0001, 0002]` 断言仍绿、
  被锁不变量（不丢/不重/保序）仍被锁定，但探针性质变为「重复触发已触发回调的**安全性**」而非「空队
  stale no-op」。SA6 定形时二选一：(a) 重调置于入队(2) **之前**（队列真空，探针=空队 no-op——更贴合原
  R2a 语义）；(b) 保持字面次序并把断言语义显式标注为「stale 回调消费待投任务时仍零丢失/零重复/保序」。
  两种形状修复前后均绿（本轮双向推演）。
- **N5（修订后契约的轻量复检——流程卫生）**：与设计 §14 建议一致：SA6 完成三处对齐后，依 #226 先例
  （`task_issue-226_red_contract_rev1_conflict_recheck.md`）对**修订后的契约**做一次轻量契约级复检
  （触发面仅 §10.2/§10.3/§10.4 三处测试力学，含本报告 N3/N4 的落地核验）。该复检属流程卫生，非本设计
  的规范冲突信号，不改变本报告 `requiresConflictRecheck: false`。

## 4. 裁决与移交

1. **Verdict：clear**；`requiresConflictRecheck: false`。ADR 层 0 冲突；契约层三处对齐属预留通道/守护锚
   语义保持，非阻断。
2. **设计自身主张复核**：设计 §14「无需冲突复审」的判断成立——其全部决策确在 SA8 前置门禁 clear 所覆盖
   的 ADR-0011/0012（诊断格式）/0009/0006/0010 既有条款兑现域内；无新规范决策、无词表演进、无公共面
   变更、无 ADR 文本修改（本轮逐条独立验证，非沿用设计自述）。
3. **路由**：SA2 design review（知悉 N1/N2/N4 勘误）→ SA6 契约对齐（§10 三处，含 N3 授权性质与 N4 形状
   定夺）→（建议）修订后契约轻量复检（N5）→ SA3 修绿 → SA4/SA7 双清。**SA3 不得先于 SA6 对齐进入**
   （否则修绿运行被 R2a/T-C 绿锚击穿——设计 §15-1 风险成立，本轮推演背书）。
4. **本轮边界**：零产品代码改动、零测试/守卫改动（全部只读）；唯一写入 = 本报告文件；测试运行经后台
   Job（`bash-9`），关键计数摘录于 §2。

Verdict: **clear** — `requiresConflictRecheck: false`
