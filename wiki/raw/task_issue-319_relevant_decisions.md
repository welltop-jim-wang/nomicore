# Issue #319 前置门禁：相关决策摘录（relevant decisions）

- 被审对象：task（`wiki/raw/task_issue-319.md`）
- 任务主题：number 值域收窄核心——validate 与 validate-patch 统一判定（裸 `number` 叶子拒绝 NaN / +Infinity / -Infinity / -0）
- 本文件只摘录相关决策、条款与关联点，不重写原义、不做业务设计。裁决见同目录 `task_issue-319_conflict_report.md`。
- Issue 评论：已读取，返回空数组——无 Owner 评论级 override 输入。

## 决策集清单（截至 HEAD `ff2dc64`）

| 决策源 | 状态 | 与本任务关系 |
| --- | --- | --- |
| `docs/adr/0001`–`0018`（除缺号） | accepted，均有效 | 0007 / 0008 / 0010 / 0014 / 0017 有直接相关条款（见下） |
| `docs/adr/0021-vfsl-number-domain-narrowing.md` | accepted（2026-09-11，issue #312） | **本任务的裁决权威**，逐条摘录见下 |
| `docs/adr/0020`（VFSL 数值约束 Int/Range） | **不在当前决策集**：正文仅存于未合并分支 `origin/docs/issue-310-vfsl-number-constraints` / `mabf/issue-314`（commit `dfc7049` 添加、`29ff10f` 加 supersede 标注），非 `HEAD` 祖先 | ADR 0021 对 0020 决策 9 的 supersede 与对决策 3 的修订在本分支暂无约束对象；int/range 三形态与文本侧字面量条款不可在本任务落地 |
| `docs/vfsl/v1-spec.md` | 规范文本（`packages/vfsl/AGENTS.md` 明列 normative） | §8 方言演进「只增不改」是被触碰的冻结纪律（见下） |
| `docs/protocols/instance-replication-v1.md` | 规范 wire 契约 | 任务不触碰复制 wire；Yjs 二进制对四值忠实，与本任务无冲突面 |
| `CONTEXT.md` | 共享词汇表 | 无 number 值域术语条目；无被本任务违反的术语 |

## ADR 0021（裁决权威）相关条款摘录

- **决策 1（L39–51）**：`number` 判定从 `typeof value === 'number'` 收窄为
  `typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)`；
  NaN / +Infinity / -Infinity 由 `Number.isFinite` 排除，-0 由 `Object.is` 单独排除
  （`JSON.stringify(-0) === "0"`）。收窄后值域 = 恰好 JSON 可忠实表示的数，
  ADR 0008 L31 声明值域在语义层落地。适用面为全 number 家族统一基线（裸 `number`
  与 ADR 0020 的 `int` / `range`；后者依赖 0020 落地）。
- **决策 3（L65–73）**：错误消息形态四值细分——`typeof` 非 number 维持现有
  「类型不匹配：期望 number，实际 X」；typeof 是 number 但为四值之一给
  「期望 number（有限数且非 -0），实际 NaN/Infinity/-Infinity/-0」；-0 必须
  `Object.is` 单独识别（`String(-0) === "0"` 误导）；**validate 与
  validate-patch 两条写路径同口径**；消息文案不进冻结面（既有先例：测试只断言前缀）。
- **决策 4（L75–85）**：本决策是语义变更（存量合法值变非法），在 v1-spec §8 增补
  第二类例外「语义收窄例外」，条款全文已在 ADR 中给出（(a) 收窄使执行语义与已声明
  架构契约对齐（ADR 0008 L31）；(b) 影响面显式记录（决策 5）；(c) owner 显式裁决）。
- **决策 5（L87–92）**：存量姿势——不侦察、不迁移、不自动修复；含四值存量 doc 在
  rearm / 重校验触发点 loud 失败视为数据损坏信号；发版说明显式告知 breaking。
- **决策 6（L96–97）**：纯运行时判定收窄——IR 形状、derived 两树、codegen 生成物、
  语义指纹（`sha256:v1:`）全部不变。
- **决策 7（L99–105）**：合法写路径产出的 doc 不再可能含四值 → changelog 的 JCS
  数值分支 `SnapshotContractViolation` 对合法写入结构性不可达（观测降级闭合）；
  任何 JSON 出口的 `NaN → null` / `-0 → 0` 变形对合法写入结构性不可达（出口腐化
  闭合）；**种子/直构面（`seedForTest`、手工 Yjs 构造）不在收窄覆盖面**，由消费侧
  判据继续兜底。
- **Consequences（L133–134）**：无新增错误码——四值拒绝走 validate 消息，文本侧
  -0 复用 E100（文本侧不在本任务范围）。
- **测试矩阵要点（L146–155）**：与任务验收项逐条对应（validate 四值全拒 + 0/0.0/
  有限小数放行；validate-patch 同口径；changelog 结构性闭合锁定测试；既有 fixture
  指纹逐字节不变）。

## 其他决策源相关条款摘录

- **ADR 0008**
  - L25：「plain subtree 仅允许 JSON-compatible plain value，禁止嵌套 Yjs shared
    type」——声明值域（ADR 0021 引作「L31」口径）。
  - L49：写路径 snapshotter「只接受 primitive、**finite number**、null、plain
    object/array」——写输入面已声明 finite number；-0 是有限数，snapshotter 不挡
    （本任务补 -0 缺口并使校验路径对齐）。
- **ADR 0007 issue #237 修订节（L62–81）**：ordinary mutation 以路径级/边界级校验
  （validate-patch 家族）取代完整 ROOT 校验；完整校验走 validateLogicalSnapshot。
  本任务的「双路径同口径」在既有校验拓扑内实现，不改拓扑。CONTEXT.md「逻辑快照
  校验」「重建校验」「零写入」条目同口径。
- **ADR 0010 R2-4（L273）**：受保护字段判据 primitive 直比用 **SameValue**
  （NaN=NaN、-0≠0）；契约外容器形态「合法写路径结构性不可达，仅种子/直构面」。
  判据本身不动；收窄使四值对合法写入结构性不可达，与 R2-4 的兜底姿势一致
  （ADR 0021 决策 7 同句式引用）。
- **ADR 0014（L120–121）**：快照失败记录 `unavailable/unsafe-input`；digest 对安全
  snapshot 的 RFC 8785 JCS bytes 计算 SHA-256——changelog 数值分支观测降级
  （`capture:'unavailable'`）的契约背景；record schema / JSONL 格式不动。
- **ADR 0017（L124）**：指纹字符串版本化域前缀 `sha256:v1:`，消费方视为不透明——
  指纹输入稳定性是兼容行为（零改动锁定的对照面）。
- **packages/vfsl/AGENTS.md（Boundaries）**：「Stable error codes, issue ordering,
  path reporting, envelope strictness, and fingerprint inputs are compatibility
  behavior」；公共 API 只经 `src/index.ts`。规范基准：root CONTEXT.md、
  `docs/vfsl/v1-spec.md`、ADR 0001/0003/0007/0016。
- **docs/vfsl/v1-spec.md §8（L461–471）**：方言演进「只增不改」——「2. 语义不改：
  既有构造的物化 / 挂载 / 错误语义不得重新解释」。§3/§4 无 number 运行时值域的
  肯定性陈述（`PrimitiveType` 仅列记号，L56）；被触碰的规范文本收敛为 §8 冻结纪律。
  **核查事实：HEAD、`origin/docs/issue-312-vfsl-number-domain`（PR #318）、
  `origin/docs/issue-310-vfsl-number-constraints` 三处的 §8 均未增补任何例外条款**
  ——ADR 0021 决策 4 的 spec 修订义务尚未在任何分支兑现。
- **docs/AGENTS.md（Editing）**：「When code behavior changes, update every
  normative document whose stated contract changed」——行为变更与规范修订同变更集
  的仓库纪律。

## 当前事实（源码核对，仅确认基线，不构成裁决依据）

- `packages/vfsl/src/validate.ts` L458–464：scalar 判定 `typeof value === t.type`——
  裸 `number` 现状放行 NaN / ±Infinity / -0；现行消息
  「类型不匹配：期望 ${t.type}，实际 ${jsonTypeOf(value)}」（L462；`jsonTypeOf` L142）。
- `packages/vfsl/src/validate-patch.ts` L35：复用 `validateSubtree`——两路径共享判定
  核心，「同口径」具备结构基础。
