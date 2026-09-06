# 冲突门禁报告 — Issue #249 diagnostic pump 单飞竞态与 duplicate 诊断

## 任务标识

- 任务：Issue #249 — 修复 diagnostic pump 单飞竞态并补齐 duplicate 诊断（Bug 修复）
- 简报：Issue #249 正文 + `wiki/raw/task_diagnostic-pump-singleflight-duplicate.md`（AC1–AC8 同源）
- Worktree：`/home/wangjian/nomicore-fix-issue-249`（branch `mabf/issue-249`，HEAD `ac91a6b`）
- 阶段：前置冲突门禁（SA1 派发前）
- 裁决人：SA8 Conflict Gatekeeper
- 关联产物：`wiki/raw/task_249_relevant_decisions.md`（条款摘录与行号锚）

## 检查范围

- 冲突基准：`docs/adr/` 全集 **13 个文件（编号 0001–0012，其中 0012 为两份不同主题文档）逐个全读，无抽样** + 根目录 `CONTEXT.md` 全读。
- 被审对象：任务简报 Problem/Scope 与 Acceptance Criteria 1–8 全文（Issue #249 正文与 `wiki/raw/task_diagnostic-pump-singleflight-duplicate.md` 逐条比对，二者一致）。
- 辅助核验（不构成独立冲突基准）：`packages/namespace-diagnostic-log/src/vocabulary.ts`（v1 冻结词表：operation 6 值 / stage 8 值 / sourceModule 4 值）与两包 `AGENTS.md`（schema 指纹钉死、公共面冻结、registry-surface 静态守卫）——均系 ADR-0011/0012 条款的落地载体，按收录关系核验；`packages/namespace-registry/src/diag-pump.ts`、`create-diagnostic.ts`（PR #248 现状缺陷定位，仅佐证简报事实，不作为阻塞依据）。
- `wiki/raw/` 历史工件（含 #226 设计「泵满静默丢弃」决策）按 docs/AGENTS.md 属证据而非规范契约，不构成冲突基准。
- 被任一 ADR 标注 superseded 的条款（ADR-0007 的 open/read 编排与 schema-aware read，已被 ADR-0008 取代）不计入约束。

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19/08-21 修订） | 否 | 任务不触及 schema 文本/信封/方言；无冲突 |
| ADR-0002 | nomicore 全新重写，authority 出范围 | accepted | 否 | 任务不涉及旧 authority 规则；无冲突 |
| ADR-0003 | 求值器与派生 schema | accepted | 否 | 任务不触及求值/ROOT/联合表示；无冲突 |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 否 | 任务不触及类型投影；无冲突 |
| ADR-0005 | 投影生成管线 | accepted | 否 | 任务不触及生成管线/SchemaSource；无冲突 |
| ADR-0006 | 持久化 DocPersistence 与 docstore | accepted（含 #64/#79/#131/#133 修订） | 是（duplicate 事实源） | #64 修订：`createDoc` 排他创建、稳定码 `DOC_DUPLICATE`、duplicate 判定路径绝不覆盖已提交内容——AC4 只是观察并记录该既有结局；无冲突 |
| ADR-0007 | 逻辑校验与 Yjs Runtime Bridge | accepted（open/read 条款被 ADR-0008 取代） | 否 | 残余零写入/observer no-rollback 条款与本任务无交集；无冲突 |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 #93/#132 修订） | 是（槽边界） | 单 write sequencer 槽序是 ADR-0012 amendment「slot 外 emit」所引用的定义；泵 drain 在业务槽外、任务不改写路径；无冲突 |
| ADR-0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted（含 #131/#134 修订） | 是（lifecycle 槽/observer/公共面/shutdown） | create 全流程同槽（L62）、内部结构化 observer seam（L95）、公共面冻结 open/create/getStatus/shutdown（L107–114）、shutdown 停接纳→排空→close→聚合（L99–101）、#131 跨候选重试受 carrier 串行化（L140）——AC3 上报通道与 AC6/AC4 边界的既有纪律；无冲突 |
| ADR-0010 | Hub/Peer WebSocket Y.Doc 复制与最终一致 | accepted（含 #133/#134/#161 修订） | 是（create 碰撞预算 + 数据保护） | L28「最多重试 8 次，耗尽 committed:false Registry fatal」为 AC4 前半原文；L159 token/SCHEMA/ROOT/owner/namespace 不入默认日志或高基数标签——健康上报基数红线；其余 transport 条款无交集；无冲突 |
| ADR-0011 | Best-effort namespace 诊断变更日志 | accepted | 是（核心母法） | 有界/非抛/隔离 emitter seam（L24–25）、结局与 stage 词表（L33–49）、稳定 code 保留与零发明（L51）、create 覆盖含 duplicate/Persistence 结局（L57）、输入零访问（L69–77）、低基数 label 红线（L87）、有界内部队列允许（L117）、无第二业务排序机构 + shutdown 不无限等待（L123–129）——AC1–AC6 全部为既有条款的兑现；无冲突 |
| ADR-0012（诊断格式） | VFSL 校验的 JSONL 与 framed sidecar 诊断日志格式 | accepted（含 issue #152 R2 amendment） | 是（核心：词表 + queue 纪律 + slot 隔离） | operation 封闭词表与演进通道（L69–80）、result 判别联合（L80–87）、stage 封闭枚举 + code/sourcePhase Pattern（L89）、queue 满 drop-newest/不占同队列/低基数 metrics（L240）、amendment「emit 须在 write slot 外」（L246–252）——AC3 逐字来源、AC4 词表约束来源；泵≠adapter writer queue；无冲突 |
| ADR-0012（实例身份） | 实例身份单一真相与 WebSocket plugin 所有权 | accepted（issue #204 已实现） | 否 | Instance/WS plugin 生命周期与本任务无交集；无冲突。⚠ 与诊断格式 ADR 同号异文，引用须带主题限定词 |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | 无冲突项（hard-violation 0 / override-declared 0 / 需 Jim 裁决的演进项 0） |

无冲突项。逐项对照说明（非冲突，供 SA1/SA2 参考）：

1. **AC1（per-namespace 同时至多一个 scheduled/running drain；首 drain 前 burst 不无界重复 `setImmediate`）vs ADR-0011 L24/L117**：emitter seam 的「有界」接收与「日志模块可在其实现内部使用有界队列」明文允许泵形态；单飞调度是把既允许的有界队列做正确（PR #248 现状以 `!draining.has(ns)` 判定调度，burst 窗口重复排任务），不新增决策、不触碰业务面。调度原语仍为 `setImmediate`（registry-surface 静态守卫有意不含该原语，#226 R4 注释契约）。裁决 no-conflict。
2. **AC2（交错不丢已接纳任务；同 ns FIFO；`initStream` 先于对应 emission）vs ADR-0011 L23–24**：L23 允许 best-effort 缺失但**不要求**丢失——消灭 drop-newest 策略之外的意外丢失属允许域内强化；诊断面 FIFO 与「initStream 先行」不构成「第二个业务排序机构」（L123 约束的是**业务**排序，诊断保序是该条款允许的日志内部秩序）。裁决 no-conflict。
3. **AC3（内存/调度有界；queue 满 drop-newest 保序；按既有低基数 metric/独立 observer 健康语义上报，不静默，不为记录 drop 占同一队列）vs ADR-0011 L24–25/L87 + ADR-0012 L240 + ADR-0010 L159 + ADR-0009 L95/L107–114**：AC 与 ADR-0012 L240 逐字同款（drop newest、保序、不占同队列、按 operation/reason 低基数 metrics、独立 observer）；ADR-0011 L25 要求尽力上报 dropped/queue health。基数红线双锚（日志字段不入低基数 label；owner/namespace 不入默认日志或高基数标签）。⚠ 设计注记：PR #248 泵现为静默丢弃（#226 设计「Registry 不代发」）——该决策属 wiki 历史证据非规范契约，AC3 强化不构成 ADR 冲突；但上报必须走 ADR-0009 L95 既有内部结构化 observer seam，**不得新增 Registry 公共 API/公共事件**（L107–114 公共面冻结），metrics label 不得含 namespaceId/streamId。裁决 no-conflict。
4. **AC4（entry collision 与 `DOC_DUPLICATE` 候选结局进正确 namespace 诊断流；不改 8 次 retry/单一最终 create 结果/耗尽 committed:false fatal/稳定词表；词表不够则先规范演进）vs ADR-0011 L57/L51/L33–49 + ADR-0010 L28 + ADR-0006 #64 修订 L121 + ADR-0012 L69–89**：duplicate 诊断是 ADR-0011 L57 的**既有覆盖要求**（「namespace create，包括……duplicate、Persistence……结局」），本任务为兑现缺口而非新增决策；8-retry/committed:false fatal 为 ADR-0010 L28 原文；`DOC_DUPLICATE` 稳定码与「绝不覆盖」为 ADR-0006 原文；「保留所属模块已有稳定 code、不发明语义」为 ADR-0011 L51 原文。词表侧：operation `namespace-create`、result `rejected`（预期失败零提交）与 code/sourcePhase（Pattern 字符串 + sourceModule）可承载 duplicate 事实；唯一判断点是 stage 8 值枚举对「Registry entry collision / Persistence duplicate」的映射（如 `identity`/`transaction`）是否无损——简报已内置正确纪律：「若既有冻结词表无法无损表达 duplicate，先形成并落实必要的规范演进，不得临时发明字段或枚举值」，与 ADR-0012 L80「新增 operation 需新 record schema 版本与 stream generation」、CONTEXT.md「新增 reason 属词表演进，须过设计评审」及 diagnostic-log 包冻结纪律（schema 指纹钉死、id 升 `@2`、新 generation、CONTEXT.md 同步）完全一致。是否触发演进由 SA1 设计判断，属门禁允许的两条合规路径之一，非冲突。裁决 no-conflict。
5. **AC5（acceptance/capability gate 输入零访问；create 路径只消费既有 detached safe snapshot，不新增原始输入读取/序列化/hash）vs ADR-0011 L69–77**：AC 是该节逐句的复述（not-accessed / 单一 detached snapshot / 不重读敌意输入 / 复用 create 既有快照不建第二套序列化）。裁决 no-conflict。
6. **AC6（initStream throw / runtimeEmitterFor throw 或畸形 / emitter/storage throw / 初始化失败不改变业务结果、提交事实与顺序，不无限延长 shutdown）vs ADR-0011 L20–24/L129 + ADR-0012 L22/L24/L242 + ADR-0009 L99–101**：逐句对应——日志失败不得改变业务结果/提交事实/sequencer 顺序（L20）；adapter 违约隔离只进独立健康面（L24）；初始化失败不影响 create、`LOG_STREAM_INIT_FAILED` 走独立 observer（L24）；streamId 碰撞重试耗尽只使日志能力不可用（L22）；shutdown 可 best-effort drain 但不无限等待（L129/L242）；Registry shutdown 聚合契约不变（ADR-0009）。裁决 no-conflict。
7. **AC7（确定性红→绿契约测试覆盖 burst/交错/queue-full/health/collision/duplicate/retry 成功与耗尽/异常隔离，且证明 PR #248 实现会失败）**：测试要求，无 ADR 条款禁止；与仓库测试先行纪律一致；观测走既有 observer/testing seam。裁决 no-conflict。
8. **AC8（运行 namespace-registry open/create、concurrency、shutdown、diagnostic、public-surface 测试 + 根 `pnpm typecheck`、`pnpm test`、`git diff --check`）**：验证要求，与两包 AGENTS.md 验证门一致；无冲突。

## 结论

- Verdict 为 **clear**：任务简报 Scope 与 AC1–AC8 对 `docs/adr/` 全集（0001–0012，含两份 0012）及 `CONTEXT.md` 无任何直接违反；无 override 声明需求、无需 Jim 裁决的演进项（AC4 的条件性词表演进指令本身即演进纪律的正确表述，是否触发由 SA1 设计阶段判定）。
- 任务性质：在 ADR-0011/0012（诊断日志产品语义 + 冻结格式）既有框架内修复 PR #248 遗留的投递正确性缺口——单飞调度、交错不丢、丢弃健康上报均是对既有条款的兑现；duplicate 诊断是 ADR-0011 L57 明文覆盖范围的补齐。
- 给下游 SA 的红线提醒（非冲突）：
  1. **词表冻结**：operation/stage/result/code/sourceModule/update-omitted reason 不得临时发明；若判定既有词表无法无损表达 duplicate，必须走完整演进通道（新 record schema 版本 `@2` + 新 stream generation + 旧 stream 只读 + `test/schema-freeze.test.ts` 指纹钉死 + 设计评审 + CONTEXT.md 同步），v1 不写 `result:'unknown'`。
  2. **泵 ≠ adapter writer queue**：修复不得触发 ADR-0012 L252 的 queue/batch/flush/fsync 语义义务——每 record 仍由 drain 内一次同步单-record append 落盘，storage projection（segment/offset/Base64/CRC）一字不动归 adapter；drain 保持业务槽外（macrotask），入队点保持 O(1) 非抛；不得引入被 registry-surface 守卫的裸 `setTimeout`/`setInterval`/`Date.now`。
  3. **健康上报纪律**：drop/health 只按 operation/reason 等封闭低基数维度；namespaceId/streamId/token/SCHEMA/ROOT/owner 不得进 metrics label 或默认日志；不为记录 drop 占用同一队列；通道走 ADR-0009 L95 内部结构化 observer seam，不新增公共面。
  4. **归属与业务不变量**：collision/`DOC_DUPLICATE` 诊断归属既有 namespace 的诊断流；目标 namespace 未启用日志时按 best-effort 缺席，不得为补记录强行建流或改变业务状态；不得改变最多 8 次候选重试、成功重试单一最终 create 结果、耗尽 `committed:false` fatal（ADR-0010 L28）、`DOC_DUPLICATE` 判定不覆盖已提交内容（ADR-0006 #64）及 create lifecycle 槽串行化（ADR-0009 L62/#131 L140）。
- 信息充分性：ADR 全集 13 文件与 `CONTEXT.md` 已全读；任务简报完整（Issue 正文与 wiki 摘要一致）；冻结词表与包级纪律已按 ADR 收录关系核验。无信息不足。

Verdict: clear
