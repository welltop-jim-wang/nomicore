# 冲突门禁报告 — issue #228（前置门禁）

> SA8 前置门禁产出（round 1，dispatch `sa-47405c2e-83f2-4a33-a59e-31fdf29b6904`；此前恢复的
> SA1/conflict-gate dispatch 已由 Host 标记 verified-lost，不作为完成证据，本报告为该门禁的全新执行）。
> 冲突基准 = `docs/adr/` 全集（13 文件全读，无抽样）+ 根 `CONTEXT.md`。被审对象 = GitHub issue #228
> 任务简报（`wiki/raw/task_228.md` 不存在，见相关决议文档「被审对象」节；Issue 评论已读，为空，无
> Owner 追加要求）。

## Verdict

`clear`

任务要求与 ADR 决策集 + CONTEXT.md **无冲突**：核心交付是既有 ADR 条款的**兑现型义务**（ADR-0012-LOG
L299 的 Host 联动条款）与**整改型对齐**（首切片同步 append amendment 的文档一致性），无任何条款被违反、
无 override 声明需求、无未走正式声明的决策演进。附 3 项设计期边界条件（不阻塞放行，移交设计后 SA8 复审
重点核对）。

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 单一真相源 | accepted（+2026-08-19 目标态/阶段态修订） | 否 | 无约束面（本任务不改 schema 文本/投影消费） |
| 0002 | 重写权威、authority 出范围 | accepted | 否 | 不适用 |
| 0003 | 求值器与派生 schema | accepted | 否 | 不适用 |
| 0004 | vfsl-protocol 类型投影 | accepted | 否 | 不适用 |
| 0005 | 投影生成管线 | accepted | AC4 | 一致：生成物新鲜度（`generate --check`、源漂移双抓）是既有纪律，AC4 为执行而非变更 |
| 0006 | Persistence DocPersistence | accepted（+#64/#79/#131/#133 修订节） | **AC1** | 一致 + 边界条件 B1：接口闭集无删除 seam（`createDoc/loadDoc/saveDoc/getStatus` + #133 `importDoc/archiveDoc/readPersistedReplicationIdentity`）；**archive（归档移除主键）≠ delete**，若设计需新增持久层删除能力属 ADR-0006 演进，须显式修订节 |
| 0007 | 逻辑验证与 Yjs bridge | accepted（Runtime/open/read 条款由 0008 部分取代） | 否 | 不适用 |
| 0008 | Runtime 读写能力与单序列器 | accepted（+#93/#132 修订节） | **AC3** | 一致：write sequencer slot 概念是「调用位置」条款的锚（slot 序 L38-53 / #132 四方法同槽） |
| 0009 | Registry、租约与 Host 生命周期 | accepted（+#131/#134 修订节） | **AC1/AC2** | 一致 + 边界条件 B1：v1 公共面闭集（open/create/getStatus/shutdown；「不公开……explicit eviction、按 key close」），shutdown 有界聚合语义是 AC2 bounded shutdown 的基线 |
| 0010 | Hub/Peer WS 复制 | accepted（+#134/#133R2/#161R2/#172 修订节） | AC2/AC5 | 一致：trusted apply 覆盖面互证；#172 §2「`wiki/raw` 非规范」约束 AC5 验收材料措辞 |
| 0011 | best-effort namespace 诊断变更日志 | accepted（2026-08-28） | **AC1/AC2/AC3** | 一致：best-effort 隔离、覆盖范围、重放五条件、shutdown drain 上界是 AC2 验收矩阵的语义基线；L24「非阻塞 emitter seam」与首切片 amendment 的张力由 AC3 整改收敛（见冲突点 #2） |
| 0012-LOG | VFSL 校验 JSONL 与 framed sidecar 日志格式 | accepted（+2026-08-28 issue #152 R2 首切片 amendment） | **AC1/AC2/AC3 核心** | 一致：AC1 = L299 Host 联动义务的兑现（#155 门禁顺延票）；AC3 = 向首切片 amendment 的对齐；retention/segment/replay 三态契约为 AC2 验收提供判据 |
| 0012-ID | 实例身份与 WS plugin 所有权 | accepted（#204 已实现） | AC2 | 一致：composition root 停机顺序（Registry → Persistence → Timer/Clock）与 ADR-0010 停止顺序互证 |

无 superseded ADR。仓库卫生注记：**两个 ADR 共用编号 0012**（instance-identity 与 vfsl-validated-jsonl，
领域不同、均 accepted、非取代关系）；本链引用沿用先例消歧写法 `ADR-0012-LOG`（诊断日志）/`ADR-0012-ID`
（实例身份）。issue #228 正文所称「ADR 0011/0012」按上下文指 0011 + 0012-LOG。

## 冲突点

四级裁决口径：no-conflict / override-declared / evolution / hard-violation。本轮**无 hard-violation、无
override、无 evolution 级裁决**；以下为逐条对照记录（含 2 项兑现/整改型裁定与 3 项边界条件）。

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | 核心兑现 | ADR-0012-LOG §Retention 与删除 L299：「提供按 namespace 彻底删除日志的管理能力，覆盖 current locator、manifests、JSONL、BIN 与 adapter 索引。该能力只承诺活跃存储中的逻辑删除，不承诺……物理 secure erase……**Host 执行数据删除请求时必须同时调用日志删除能力**」；删除协议 L289-295（`.deleting` marker、启动收尾、orphan BIN） | AC1：Host 的 namespace 数据删除工作流同步触发诊断日志删除，清理 active locator、stream manifests、JSONL/BIN、deletion markers 与 adapter indexes，只承诺活跃存储逻辑删除不暗示 secure erase | **no-conflict（兑现型）** | 逐字对应：AC1 是 L299 条件条款的**兑现**而非新决策。被调能力 `deleteNamespaceDiagnosticLog` 已由 #154 交付（含 INV-12 租约分区释放）；Host 侧接线是 #155 前置门禁显式顺延的义务（「app 现无数据删除面 → 前件不成立……待相应票」，`task_expose-diagnostic-replay-host-lifecycle_design_conflict_report.md:84`）——issue #228 即该票。「deletion markers」与 L289-295 协议吻合；「逻辑删除/不暗示 secure erase」与 L299 第二句吻合 |
| 2 | 整改对齐 | ADR-0012-LOG 首切片 amendment L244-252：「有界……不表示底层文件系统延迟有时间上界，亦不表示 `emit` 可在任意调用点不阻塞。任何将 File adapter 的 `emit` 接入 namespace 生命周期的调用点，必须位于 NamespaceRuntime write sequencer slot 之外……不得在 slot 内执行同步 File adapter `emit`」「不维护 writer queue、不做 batch flush、不提供 fsync 开关，也不保持常驻 file descriptor」 | AC3：ADR 0011/0012、CONTEXT.md 与 package README 对同步 File adapter 的阻塞特性、调用位置和首切片 queue/batch/fsync/fd 范围保持一致，不再存在「绝不阻塞」等矛盾表述或陈旧版本说明 | **no-conflict（整改型）** | AC3 是**消除文档漂移**：现存矛盾文本亲证于 `packages/namespace-diagnostic-log/README.md:312`（「绝不阻塞」）、`CONTEXT.md:157`（「不阻塞」）、`packages/namespace-diagnostic-log/AGENTS.md:16`（同款，且同文件 §Boundaries 已正确陈述首切片纪律——自相矛盾）。对齐方向 = 向**已接受**的 2026-08-28 amendment 收敛（后决优先），符合 docs/AGENTS.md「update every normative document whose stated contract changed」。ADR-0011 L24「非阻塞的 emitter seam」指 interface 语义（void、不 throw、无 durability promise——amendment 明言「ADR 0011 emitter seam 不变」）；AC3 落地时若触及 ADR 原文，必须走**显式修订节**而非静默改写 |
| 3 | 边界条件 B1 | ADR-0009 公共 Interface（v1 不公开 explicit eviction、按 key close 等）；ADR-0006 接口闭集（无 `deleteDoc`；#133 `archiveDoc` = 归档移除主键，语义为 archive ≠ delete）；apps/yjs-server/AGENTS.md「Consume only package public exports」 | AC1 前件：「Host 的 namespace 数据删除工作流」——该工作流**现不存在**（app op 闭集 11 个无删除 op；Registry/Persistence 无删除 seam） | **no-conflict（简报层）→ 设计期重点复核** | 无任何 ADR **禁止** namespace 数据删除；ADR-0012-LOG L299 明文预期「Host 执行数据删除请求」存在。但若 SA1 设计为兑现 AC1 需要：新增 Persistence/Registry 公共删除能力、扩展 Host NDJSON op 集、或绕过包公共导出直接操作存储布局——其中「扩展冻结 v1 公共面」属 ADR-0006/0009 演进，**必须以显式 ADR 修订节/新 ADR 备案**（docs/AGENTS.md「Amend or supersede prior decisions explicitly」）；「直接文件操作」违反 app AGENTS.md 包边界。设计后 SA8 复审须核对该演进已正式化 |
| 4 | 边界条件 B2 | ADR-0011 §产品契约 L20-24（日志失败不得改变业务操作返回值/提交事实）；ADR-0012-LOG 首切片 slot 外纪律（同步 fs 操作的调用点限制，#153 起扩展到构造期全部同步 fs 操作） | AC1「**同步**触发」+ AC2「logging failure」场景 | **no-conflict（简报层）→ 设计期注意** | 「同步触发」与 best-effort 隔离的并存语义（日志删除失败是否/如何影响数据删除工作流的结局与重试收敛——先例：#154 设计「重入调用 `deleteNamespaceDiagnosticLog` 是唯一完成路径，Host 数据删除工作流重试即完成」）以及 `deleteNamespaceDiagnosticLog` 这类同步重 fs 操作自身的调用点纪律，属 SA1 设计裁量，无简报层冲突；设计须显式裁决并过 SA2/设计后 SA8 |
| 5 | 边界条件 B3 | ADR-0010 #172 修订 §2：「`wiki/raw` 非规范：源码与规范中的公共行为表述必须指向 `CONTEXT.md`、ADR 或 `docs/protocols/`」；docs/AGENTS.md Authority 节 | AC5：根 REPORT.md 汇总 + PR #142 title/body 与 tracking issue #141 验收材料更新 | **no-conflict（备注型）** | REPORT/PR/issue 措辞属流程产物，无 ADR 约束面；但验收材料中的**公共行为表述**必须指向权威文档（CONTEXT.md/ADR/docs/protocols），不得把 wiki/raw 或 REPORT 当规范源引用。PR title/body 与 issue 评论的发布动作归 publication/runner 流程，不属本门禁 |
| 6 | 验收矩阵 | ADR-0011 覆盖范围 L55-63（create/ROOT/SCHEMA/trusted apply/management）+ 重放五条件 L97-105 + shutdown drain 上界 L129；ADR-0012-LOG strict replay 三态 L307-318 + retention L280-297 + segment 耗尽 L254-268 | AC2：阶段级 Host 验收组合覆盖 create、ROOT/SCHEMA、trusted replication、restart、retention、logging failure、bounded shutdown、complete/partial/failed replay | **no-conflict（验收型）** | AC2 场景清单逐项落在 ADR 已裁决行为面上（验收**执行**既定契约，不引入新行为）；「complete/partial/failed」三态与 L311-318 判据一致；「bounded shutdown」与 L129/ADR-0012-LOG L242「不得无限等待日志 sink 或阻塞 Registry/Persistence 停止」一致 |
| 7 | 工程门禁 | ADR-0005 §4（生成物入仓 + regen-diff） | AC4：PR 全量 typecheck、test、生成物/发布检查、`git diff --check`、尾随空格清理 | **no-conflict** | 既有仓库纪律的执行；无 ADR 变更面 |

## 结论

**Verdict: `clear`** —— 放行，按任务类型路由继续（本任务为功能开发/阶段验收复合型：验收组合 + Host 级
联动实现 + 文档收口；含代码变更面故全链 SA3+SA4+SA7 必备）。

移交下链的三项边界条件（均不阻塞，设计后 SA8 复审与 SA2 重点核对）：

1. **B1（公共面演进正式化）**：Host namespace 数据删除工作流现为空白面；若设计扩展 ADR-0006/0009 冻结
   v1 公共接口（或新增 Host 控制通道 op），必须以显式 ADR 修订节/新 ADR 备案，不得静默扩面；app 侧只
   消费包公共导出。落点选择（Persistence seam / Registry seam / Host 编排组合既有 seam）是 SA1 的首要
   架构决策。
2. **B2（同步联动 + 隔离语义）**：「同步触发日志删除」的失败语义与重入收敛路径、以及
   `deleteNamespaceDiagnosticLog` 同步重 fs 操作的调用点纪律（write sequencer slot 外），须在设计中
   显式裁决并锚定 ADR-0011 隔离条款。
3. **B3（文档对齐方向与措辞纪律）**：AC3 对齐方向 = 向 ADR-0012-LOG 首切片 amendment（后决优先）；
   CONTEXT.md 词条修订走领域术语更新正道；触及 ADR 原文必须显式修订节；文档不得把 queue/batch/fsync/
   常驻 fd 描述为现行特性（amendment 明言其为目标演进形态）。

另附两项非阻断登记（供总控/下链知悉，不构成冲突）：

- **ADR 编号重复（0012）**：引用需消歧（`ADR-0012-LOG` / `ADR-0012-ID`）；issue #228 正文「ADR 0011/0012」
  按上下文指诊断日志对。
- **Git 配置残留**：worktree 本地 `git config mabf.branch=fix/issue-137-on-docs-phase-5-websocket-replication`、
  `mabf.base-branch=docs/phase-5-websocket-replication`，与本任务（issue #228 / parent PR #142
  `docs/namespace-diagnostic-change-log`）不符，疑为建仓残留；发布/base 推导属 runner 职责，建议总控在
  收尾阶段向 runner 核对（本门禁不改 git 配置）。
