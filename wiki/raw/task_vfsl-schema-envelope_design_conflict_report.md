# 冲突门禁报告（设计后复审）

> SA8 Phase 2 设计后复审。被审对象：`wiki/raw/task_vfsl-schema-envelope_design.md`（SA1 设计 R1，Issue #52 `parseSchemaEnvelope`）。
> 冲突基准：`docs/adr/` 全集 5 份 + `CONTEXT.md`——本轮已复核与 Phase 0 前置门禁时**完全一致**（同 5 文件、状态均为 accepted、关键冻结条款逐条 grep 原样：ADR-0001 信封四键/`SCHEMA` 命名修订/「未知方言 loud-fail 只读」、ADR-0003「两个公共观察点」、ADR-0005「消费方首动作 = 方言断言」/「id 是标签不是键」），无新增 ADR、无 supersede。
> 关联产出：`task_vfsl-schema-envelope_relevant_decisions.md`（已追加「设计引入的新决策点」10 条）；前置门禁报告 `task_vfsl-schema-envelope_conflict_report.md`（verdict clear，备注 N1–N5）。
> 依技能纪律，本报告不重复前置门禁全量盘点，ADR 行只记设计层对照增量。

## Verdict

`clear`

## ADR 盘点（设计对照）

| 编号 | 标题 | 状态 | 相关 | 对照结论（设计层增量） |
|---|---|---|---|---|
| ADR-0001 | VFSL 唯一真相源（含 2026-08-19/08-21 修订） | accepted | 是 | 一致。设计 §1.2 定位「`SCHEMA` 键下的信封是引擎侧第一个消费动作」、全文不出现 `__schema__`（遵命名修订）；§5 未知方言 → `parseVfsl` 不被调用，「loud-fail 只读」落为控制流事实；测试 fixture 属「测试 fixture 除外」放行项，无新增仓内 schema 文本 |
| ADR-0002 | nomicore 全新重写、authority 出范围 | accepted | 否 | 不触及（设计无 authority 内容） |
| ADR-0003 | 求值器与派生 schema | accepted | 是 | 一致。接缝纪律同款复用（同步/纯函数/不抛错/ok-union）；ENV 码不进 `errors.ts` 21 码冻结注册表（§6.1），方言层 E 码表不受触碰；「两个公共观察点」为记录性条款，设计新增第三公共导出沿 PRD #3 预告轨道（前置门禁 N1 裁定沿用） |
| ADR-0004 | vfsl-protocol 类型协议包 D1–D5 | accepted | 否 | 不触及（设计全部落在引擎包 `packages/vfsl`，协议包零改动，D3 领地不受影响） |
| ADR-0005 | 投影生成管线（SchemaSource 接缝） | accepted | 是 | 一致。§4 复用 `assertVfslDialect` 作方言断言单点（`lang==='vfsl' && version===1`）＝「消费方首动作 = 方言断言」的第三个共方；§1.2 id 零格式校验/零注册表＝「id 是标签不是键」；§1.2 复用 `SchemaEnvelope` 类型不另造第二信封形状；schemasource.ts 入 DENY LIST 零改动；collect.ts 手工流程保持（纪律仍在），迁移留未来票 |

## 冲突点

无冲突点。四级裁决分布：**no-conflict × 全部对照项；override-declared × 0；evolution × 0；hard-violation × 0。**

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | （无） |

### 备注（设计最近边界项，均裁 no-conflict）

- **D-N1 公共接缝面扩展**（沿用前置 N1）：设计新增第三公共值导出 + 1 个类型导出。ADR-0003「两个公共观察点」为 evaluate 立票时的 PRD 措辞修订记录、非封闭禁增清单；设计 §1.1 明引 PRD #3/v1-spec §7 对本任务的预告。no-conflict。
- **D-N2 错误码双注册表**：信封层 `VFSL-ENV-E<码>` 自持于 envelope.ts，不混入 `errors.ts` 方言层 21 码冻结表——与 ADR-0003 冻结的 E 码表边界同向加固，而非相抵。no-conflict（前置 N4 在设计层的落法核验通过）。
- **D-N3 形状阶段全收集（至多 2 条）vs 单错误纪律**：「issues 恰含 1 条」出自 v1-spec §4（方言层/文本解释恢复策略），无任何 ADR 对非文本接缝冻结条数；透传阶段 parseVfsl issues 原样保持（单条纪律未破坏）。v1-spec 非 ADR、代码与规格文档不构成自动阻塞依据。no-conflict（设计 §6.5 已自留 SA2 复议空间）。
- **D-N4 坐标哨兵 `line:0, column:0`**：ADR 全集无信封层 issue 坐标条款；哨兵依赖的「文本层行列 1-based」不变式与既有规格纪律同向，无条款相抵。no-conflict（设计 §9-3 已自记失效条件）。
- **D-N5 多键容忍 + 恰四键回显**：输入宽容（向前兼容）与输出规范化（重建恰四键对象）并行——后者反而严格贴合 ADR-0001/CONTEXT.md 的四键信封结构定义。no-conflict（前置 N2 的设计层落法核验通过）。
- **D-N6 同步纯函数 vs SchemaSource async**：不同接缝（解析函数 vs 取数接口），设计 §1.2 显式援引前置 N3 裁定，互不约束。no-conflict。

## 结论

**Verdict: `clear`。** SA1 设计 R1 的全部裁定（模块布局、编排顺序、方言断言单点复用、ENV 独立码空间、坐标哨兵、恰四键回显、id 仅标签、混合通道联合、DENY LIST 冻结既有资产）与 ADR-0001（含两次修订）/ ADR-0003 / ADR-0005 及 CONTEXT.md 既有决策**一致且多处是对这些决策的直接兑付**：未知方言不解释文本＝ADR-0001 方言冻结条款的控制流落法；断言复用＝ADR-0005「消费方首动作」的第三共方；id 零校验零注册表＝「id 是标签不是键」。设计未推翻任何 ADR（无 override 诉求）、未暗度修订任何冻结决策（无 evolution 上报项）、无 hard-violation。**设计后复审通过。** 设计层新冻结点 10 条已登记至 `task_vfsl-schema-envelope_relevant_decisions.md`「设计引入的新决策点」节，供 SA2 评审与 SA3 实现回查。
