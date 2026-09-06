# 冲突门禁报告 — Issue #226 修复创建诊断覆盖与日志生命周期隔离

## 任务标识

- 任务：Issue #226 — 修复创建诊断覆盖与日志生命周期隔离（Bug 修复）
- 简报：`wiki/raw/task_issue-226.md`
- Worktree：`/home/wangjian/nomicore-fix-issue-226`（branch `mabf/issue-226`，父链 PR #142 `docs/namespace-diagnostic-change-log`）
- 阶段：前置冲突门禁（SA 派发前；dispatch log 第 1 行 R5 强制门禁）
- 裁决人：SA8 Conflict Gatekeeper
- 时间：2026-09-05T08:20Z（首判）；2026-09-05T09:25Z R5 复核（recovery 重派，见「复核记录」）

## 检查范围

- 冲突基准：`docs/adr/` 全部 **12 个文件（编号 0001–0010 与两个 0012），逐个全读，无抽样** + 根目录 `CONTEXT.md` 全读。
- 被审对象：任务简报「What to build」全文与 Acceptance Criteria 1–5 全文。
- 辅助核验（不构成独立阻塞依据）：生产接线点核对——`packages/namespace-registry/src/create-diagnostic.ts`（create 路径 emit/initStream）、`packages/namespace-registry/src/registry.ts`（`diagnosticLog` 装配与 lifecycle carrier）、`packages/namespace-runtime/src/{runtime,write,schema-write,replication-write,replication-session,diagnostic}.ts`（write-sequencer 槽内诊断）、`packages/namespace-diagnostic-log/src/adapters/{file,memory}.ts`（同步 append / 内存实现）。`wiki/raw` 既有任务产物仅作历史证据（ADR-0010 #172 修订 2：wiki/raw 非规范）。
- 被取代条款不计入约束：ADR-0012 正文「每 stream 至多一个逻辑 writer queue」「默认周期 batch flush」两句在首切片 File adapter 范围内被 2026-08-28 amendment 明文取代；ADR-0007 的 open/read 编排条款被 ADR-0008 取代。
- 编号消歧：两个 ADR-0012 并存（诊断日志格式 / 实例身份）。本报告「ADR-0012」均指 `0012-vfsl-validated-jsonl-and-framed-sidecar-change-log.md`。

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted | 否 | 任务不触及 schema 文本/信封/方言；无冲突 |
| ADR-0002 | nomicore 全新重写，authority 出范围 | accepted | 否 | 无冲突 |
| ADR-0003 | 求值器与派生 schema | accepted | 否（边缘） | create 管线 schema 编译失败的语义上游在 vfsl 包；本任务只消费结局不改求值；无冲突 |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 否 | 无冲突 |
| ADR-0005 | 投影生成管线 | accepted | 否 | 无冲突 |
| ADR-0006 | 持久化（含 #64/#79/#131/#133 修订） | accepted | 是（结局事实） | AC1 的 duplicate/Persistence 结局沿用其 typed/committed 事实；日志不成为 Persistence 真相源；无冲突 |
| ADR-0007 | 逻辑校验与 bridge（open/read 被 0008 取代） | accepted | 否（边缘） | 残余条款（validateLogicalSnapshot/detached 管线/零写入）本任务只消费结局；无冲突 |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器（含 #93/#132/#134 修订） | accepted | 是（核心边界） | AC3/AC4 即「日志 I/O 不进 slot、不延长槽」的兑现；slot 结构/fatal/close/FIFO 不变；无冲突 |
| ADR-0009 | Registry、租约与 Host 生命周期（含 #131/#134 修订） | accepted | 是（核心边界） | AC3/AC4 与 lifecycle carrier 串行、create 槽内清单、shutdown 契约一致；建流不在 create 槽内清单中，搬移不改变槽语义；无冲突 |
| ADR-0010 | Hub/Peer 复制（含 #131/#133/#134/#161/#172 修订） | accepted | 是（归属锚） | namespaceId 生成时序支撑 AC1 归属；复制诊断词表不动；无冲突 |
| ADR-0012（诊断日志格式，含 first slice amendment） | VFSL 校验 JSONL 与 framed sidecar | accepted | 是（核心） | 任务 = amendment 预留的「后续接线票」；全部 AC 是兑现而非修订；无冲突 |
| ADR-0012（实例身份） | 实例身份单一真相与 WS plugin 所有权 | accepted | 否 | 与日志生命周期无交集；无冲突（卫生注记 1） |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | 无冲突项（hard-violation 0 / override-declared 0 / evolution 0） |

无冲突项。逐项对照说明（非冲突，供 SA1/SA2 参考）：

1. **AC1（建流前创建结局归属入流）vs ADR-0011 L57 / ADR-0012 L24 / ADR-0010 L28**：ADR-0011 覆盖范围明文要求 create 记录「输入、schema、ROOT、duplicate、Persistence 与 post-commit Runtime construction 结局」——AC1 是该条款的实现缺口修复，非新决策。ADR-0012 L24「后续重试成功时以当时 Y.Doc 建立新 stream，其 genesis 只代表从该时点开始，不能伪称从 namespace 创建时起连续」约束的是 **genesis/重放连续性声明**，不禁止把更早的 attempt 记录补记进 stream；两者兼容，条件是补记记录保持自身 observedAt/attempt 语义、不得冒充 genesis 或声称完整重放。namespaceId 由 Registry 在 create 接纳后 CSPRNG 生成（ADR-0010 L28），归属锚存在。裁决 no-conflict（重放诚实性与 id 耗尽边界 case 列为 SA1 红线/设计点）。
2. **AC2（输入零访问/单快照纪律保持）vs ADR-0011 L69–77**：任务要求即 ADR 原文（gate 前拒绝 `input.capture = not-accessed`；复用既有 detached safe snapshot；不建第二套序列化规则）。裁决 no-conflict。
3. **AC3（建流/reopen/repair/retention/同步 append 不在业务关键路径）vs ADR-0012 amendment L250 / ADR-0011 L123–129 / ADR-0008 L51 / ADR-0009 L62**：amendment 把「slot 内同步 File emit」明文定为不合规接线并预留「#149–#151/#155 或后续接线票」修复——本任务即该票，属兑现。ADR-0009 L62 的 create 槽内清单（snapshot/compile/validate/detached construction/Persistence create/Runtime construction）不含日志建流——把日志活动移出 carrier/slot 不改变任何业务步骤的槽归属。ADR-0011 L123 同时要求日志不得成为第二个业务排序机构——隔离实现须保持 emitter 接收时点不产生新的业务顺序语义。裁决 no-conflict。
4. **AC4（慢/挂起存储不阻塞下一业务槽、不无限延长 create/shutdown；throw/初始化失败/storage failure 与业务结果隔离）vs ADR-0011 L20–25/L129、ADR-0012 L24/L242、ADR-0009 L97–101**：条款与 AC4 逐句对应（不得延长 write slot、不得无限等待日志 sink、初始化失败不影响 create、`LOG_STREAM_INIT_FAILED` 走独立健康 observer、shutdown 聚合契约不变）。裁决 no-conflict。
5. **AC5（契约测试覆盖创建早期拒绝、Persistence 失败、post-commit fatal、慢同步 adapter、后续写入推进、shutdown，并证明修复前失败）**：测试要求；无 ADR 条款禁止；观测走既有 observer/testing seam（`diagnosticLog` / `diagnosticEmitter`+`clock`）。裁决 no-conflict。
6. **CONTEXT「emit 同步、不 throw、不阻塞」vs 任务的 I/O 搬移**：该词条冻结的是 emitter seam 的公共语义（同步接收 detached record、不抛、无 durability promise），不规定物理 I/O 发生在哪个调用栈；ADR-0012 amendment 恰恰要求把同步 I/O 移出业务槽。seam 形状不变。裁决 no-conflict（seam 冻结列为红线）。

## 卫生注记（非冲突，建议登记）

1. **ADR 编号碰撞**：`docs/adr/` 存在两个 0012（`0012-vfsl-validated-jsonl-and-framed-sidecar-change-log.md` 2026-08-28 / `0012-instance-identity-and-websocket-plugin-ownership.md` issue #204）。按 `docs/AGENTS.md`「Amend or supersede prior decisions explicitly」纪律，建议 owner 后续重编号或在索引中消歧；不属于本任务范围，不构成阻塞。本任务所有引用一律带文件名。
2. **ADR-0012 amendment 的演进分支**：SA1 设计将在「slot 外延迟同步 append」与「queue/batch 切片」之间选择；后者被 amendment 明文要求「另行定义 close/shutdown、flush、队列满与 fsync 配置语义」。这是任务内授权的设计点，不是 ADR 冲突，但属设计后复审必查项。

## 复核记录（R5，2026-09-05T09:25Z）

recovery 重派后由新任 SA8 对首判报告做独立二次核验，不接受未复核的沿用：

- **引用核验**：ADR-0011、ADR-0012（诊断日志版，含 2026-08-28 amendment）全文重读；ADR-0006（全文，含 #64/#79/#131/#133 修订）、ADR-0008（L40–109 槽/fatal/close 段）、ADR-0009（L25–109 lifecycle/create/shutdown 段）、ADR-0010（L22–33 身份段、L155–163 数据保护段、#172 修订段）被引条款逐条比对；CONTEXT.md 六个日志词条（L144–166）与「写序列器」（L77–79）复核。首判全部裁决依据的条款引用属实。
- **发现并修正一处归属错误**（不改裁决）：`_relevant_decisions.md` ADR-0006 节第 2 条原将「Persistence 错误演进」节（typed create operational error `committed:false`、committed-aware create fatal、Registry 只做映射传播）挂于 ADR-0006 名下；该节实际位于 **ADR-0009 L72–81**，ADR-0006 全文无此节。已在该文件内更正归属并留痕。该条款同时被 ADR-0009 节正确引用，故对「无冲突」结论与下游红线无影响。
- **辅助核验重跑**：`packages/namespace-registry/src/registry.ts` L1316–1463——`emitEarlyOutcome`/`emitOutcome`/`initStream`/`emitStreamOutcome` 全部位于 create lifecycle 路径内（carrier 内建流与 emit，与缺口描述一致）；`packages/namespace-diagnostic-log/src/adapters/file.ts` L16–17/L684/L699——每 record `appendFileSync` 同步落盘、无队列/batch/fsync（首切片形态，与 amendment 一致）。与首判「生产代码接线核对」记录一致。
- **结论**：首判事实基础与裁决经独立复核成立；无新增冲突项；verdict 维持 **clear**。

## 结论

- Verdict 为 **clear**（首判 2026-09-05T08:20Z；R5 复核 2026-09-05T09:25Z 维持）：任务简报 What-to-build 与 AC1–AC5 与 ADR 全集（12 文件）及 CONTEXT.md 无任何直接违反；无 override 声明需求、无需 owner 裁决的演进项。
- 任务性质：在 ADR-0011/0012（含 File adapter first slice amendment）既有框架内兑现两处**已登记缺口**——(a) ADR-0011 L57 创建结局覆盖的实现缺口（建流前早结局被无归属通道确定性丢弃）；(b) ADR-0012 amendment L250 预留的接线修复票（同步 File 日志 I/O 位于 Registry lifecycle carrier / Runtime write-sequencer 业务关键路径内）。生产代码接线核对与该缺口描述一致（`create-diagnostic.ts` 建流与 emit 在 carrier 内、Runtime 各写路径槽内诊断、file adapter 同步 append）。
- 给下游 SA 的红线提醒（非冲突）：
  1. emitter 公共 seam（同步、non-throwing、不阻塞、无 durability promise）与 record schema / manifest policy 冻结不变（ADR-0011 L117、CONTEXT「语义 emission」）；
  2. 日志不得成为第二个业务排序机构（ADR-0011 L123）；notifyDirty 槽序不包裹不替代（L128）；
  3. 日志故障不得把 namespace 标记 fatal/persistence-degraded、不得触发业务重试（ADR-0011 L22）；
  4. 词表（operation / stage / result 判别联合 / update-omitted reason）冻结——新增值 = record schema 版本 + 新 stream generation + 设计评审（ADR-0012 L70–89、L268）；
  5. 补记的建流前早结局不得冒充 genesis、不得伪称重放连续（ADR-0012 L24；CONTEXT「genesis baseline record」）；
  6. Registry shutdown 公共契约（同 Promise、`NamespaceRegistryShutdownError` 聚合、停止接纳）不变，日志 drain 有界（ADR-0009 L97–101、ADR-0011 L129）；
  7. 测试 seam 既有字段名（Registry `diagnosticLog`、Runtime `diagnosticEmitter`+`clock` 成对、testing subpath）为契约锚点，不得漂移；
  8. 设计中公共行为表述必须指向 CONTEXT.md / ADR / docs/protocols，不得以 wiki/raw 为契约来源（ADR-0010 #172 修订 2）。
- 信息充分性：ADR 全集与 CONTEXT.md 已全读；生产接线位置已核对。无信息不足。
- 复审建议：SA1 设计将触碰「隔离执行载体形态（延迟同步 append vs queue/batch 切片）」「shutdown drain 预算归属」「建流前早结局缓冲与 namespaceId 耗尽归属」三个新决策点（详见 `_relevant_decisions.md` §设计敏感点登记），建议设计后执行 conflict recheck。

Verdict: clear
