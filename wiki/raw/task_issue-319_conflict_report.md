# Issue #319 冲突报告（SA8 前置门禁）

1. **Reviewed subject**: task（`wiki/raw/task_issue-319.md`——number 值域收窄核心：validate 与 validate-patch 统一判定）
2. **Inputs and decision set**
   - 输入：任务简报 `wiki/raw/task_issue-319.md`；Issue #319 REST 评论已读取且为空数组（无 Owner 评论要求）；决策集 `CONTEXT.md` + `docs/adr/**` + 规范文本（`docs/vfsl/v1-spec.md`、`docs/protocols/`）+ 模块 `AGENTS.md` 明确收录的决策。
   - 决策集状态：ADR 0001–0018（除缺号）与 **ADR 0021（accepted，2026-09-11，issue #312）** 有效；**ADR 0020 不在当前决策集**（正文仅存于未合并分支 `origin/docs/issue-310-vfsl-number-constraints` / `mabf/issue-314`，非 HEAD `ff2dc64` 祖先）——0021 对 0020 决策 9 的 supersede 在本分支暂无约束对象。无被 superseded 的在集 ADR 参与本对照。
   - 摘录依据见 `wiki/raw/task_issue-319_relevant_decisions.md`。

3. **Decision analysis**

   | Decision | Clause | Subject behavior | Classification | Evidence | Required action |
   | --- | --- | --- | --- | --- | --- |
   | ADR 0021 决策 1 | number 判定收窄为 `typeof === 'number' && Number.isFinite && !Object.is(v,-0)`（L39–51） | 任务核心请求即该公式在裸 `number` 叶子的落地（task L17） | **implements-existing-decision** | 0021 L39–51；task L17；现状事实 `packages/vfsl/src/validate.ts` L458–464（`typeof value === t.type` 放行四值） | 无——按 ADR 执行 |
   | ADR 0021 决策 3 | 四值细分消息；validate 与 validate-patch 同口径；文案不进冻结面（L65–73） | 任务消息规格逐字一致：typeof 失配维持现有消息、四值给新消息、-0 经 `Object.is` 识别（task L17、L21–22） | **implements-existing-decision** | 0021 L65–73；task L17；`validate.ts` L462 现行消息；`validate-patch.ts` L35 复用 `validateSubtree` | 无 |
   | ADR 0021 决策 7 | 合法写入对观测降级与出口腐化结构性闭合；种子/直构面排除（L99–105） | 验收项 3「changelog 结构性闭合锁定测试」即该义务的锁定测试（task L23） | **implements-existing-decision** | 0021 L99–105；ADR 0014 L120–121（`unavailable` capture / RFC 8785 JCS digest） | 无 |
   | ADR 0021 决策 6 | IR / derived / codegen / 语义指纹零影响（L96–97） | 验收项 4 逐字节零改动锁定（task L24） | no-conflict（任务主动锁定） | 0021 L96–97；ADR 0017 L124；task L24 | 无 |
   | ADR 0021 决策 5 | 不侦察、不迁移、不自动修复（L87–92） | 验收项无任何迁移/扫描工具 | no-conflict | 0021 L87–92；task L19–25 | 无 |
   | ADR 0021 决策 2 | 文本侧 `-0` 字面量 E100（L58–63） | 任务不含文本侧改动——**正确出界**：该条款依赖 ADR 0020 字面量拓宽，0020 不在本分支决策集 | no-conflict | 0021 L58–63、L151–152（「ADR 0020 落地后」措辞）；0020 缺席事实（git：`dfc7049` 非 HEAD 祖先） | 不得在本任务顺带实现文本侧 E100 或 int/range 判定 |
   | ADR 0008 | L25「plain subtree 仅允许 JSON-compatible plain value」；L49 snapshotter 只接受 finite number | 收窄使执行语义与声明值域对齐，并补 snapshotter 不挡的 -0 缺口 | **implements-existing-decision** | 0008 L25、L49；0021 L9–11、L50–51 | 无 |
   | ADR 0007（issue #237 修订节） | ordinary 写路径级/边界级校验（validate-patch 家族）+ validateLogicalSnapshot 完整校验（L62–81） | 双路径同口径在既有校验拓扑内实现，不改拓扑、不改零写入管线 | no-conflict | 0007 L62–81；CONTEXT.md「逻辑快照校验」「重建校验」「零写入」 | 无 |
   | docs/vfsl/v1-spec.md §8 | 「只增不改」之「2. 语义不改：既有构造的物化/挂载/错误语义不得重新解释」（L461–471） | 语义收窄改变既有构造（裸 number）的校验/错误语义——触碰冻结纪律；合法路径是 §8 例外条款，而该条款**尚未落入 spec**（HEAD、PR #318 分支、issue-310 分支均已核查，均未修订）且任务简报验收项不含此修订 | **evolution-required**（修订计划完整，见 §6） | v1-spec L461–471；0021 决策 4 L75–85；`git show` 三分支核查（`ff2dc64` 仅添加 ADR 本体，156 行，无 spec 改动） | 同变更集在 v1-spec §8 增补「语义收窄例外」条款（条款全文已在 0021 决策 4 给出） |
   | ADR 0010 R2-4 | 受保护字段 SameValue 判据（NaN=NaN、-0≠0）；契约外形态「仅种子/直构面」（L273） | 判据不动；四值对合法写入变为结构性不可达，种子/直构面由消费侧判据兜底——与 0021 决策 7 完全同构 | no-conflict | 0010 L273；0021 L104–105 | 无 |
   | packages/vfsl/AGENTS.md | 「Stable error codes, issue ordering, path reporting, envelope strictness, and fingerprint inputs are compatibility behavior」；公共 API 只经 `src/index.ts` | 四值拒绝复用 validate 消息通道（非新错误码）；新消息须保持既有 emit 锚位与 issue 顺序；不新增公共 API | no-conflict（附实现期核对义务） | packages/vfsl/AGENTS.md Boundaries；0021 L133–134（无新增错误码） | 实现期逐项核对（见 §8） |

4. **Overrides**

   | Old decision | Override authority | Scope | New obligation |
   | --- | --- | --- | --- |
   | docs/vfsl/v1-spec.md §8「只增不改」（语义不改条款） | ADR 0021 决策 4——已接受 ADR 修订冻结纪律；issue #312 owner 显式裁决（ADR 文本 (c) 项记载） | number 家族运行时值域收窄为 JSON 可忠实表示数（本任务仅裸 `number`） | 同变更集在 v1-spec §8 落地「语义收窄例外」条款（文本见 0021 L80–83）；override 不得扩大到 int/range 或文本侧（那属 0020 落地时） |
   | （记录性，本分支惰性）ADR 0020 决策 9 supersede / 决策 3 修订 | ADR 0021（accepted） | int/range 三形态基线与 `-0` 字面量翻转 | 0020 不在当前决策集——其落地分支（`docs/issue-310-vfsl-number-constraints`）已含 0021 标注（`29ff10f`）；本任务不得引用 0020 作为依据或义务 |

   Owner 评论 override：无（评论为空数组）。

5. **Frozen surfaces**

   | Surface | Must remain unchanged | Evidence | Actual result |
   | --- | --- | --- | --- |
   | 语义指纹（`sha256:v1:`）与既有 fixture 指纹 | 逐字节不变 | 0021 决策 6；ADR 0017 L124；task L24 | 任务锁定零改动——待实现期 diff 核对 |
   | IR 形状 / derived 两树 / codegen 生成物 | 零改动 | 0021 决策 6；task L24 | 同上 |
   | 错误码集合 | 无新增码；四值拒绝走 validate 消息 | 0021 L133–134；packages/vfsl/AGENTS.md | 任务消息设计不引入新码——待核对 |
   | issue 顺序与路径报告锚位 | 不变（新消息须在原 emit 位发出） | packages/vfsl/AGENTS.md Boundaries | 任务未声明改动——待核对 |
   | 复制 wire / Yjs 二进制载体 | 不动（核心权威链对四值忠实，非本任务面） | 0021 背景 L17、L33–34；ADR 0010 | 任务不触碰 |
   | changelog record schema / JSONL 格式 | 不动（仅数值分支可达性变化 + 锁定测试） | ADR 0014；0021 决策 7 | 任务只加测试 |
   | validate 失败零写入管线 | 收窄经同一管线拒绝，无旁路 | CONTEXT.md「零写入」；ADR 0007 | 任务在管线内实现 |
   | 公共 API 面（`src/index.ts`） | 不新增 | packages/vfsl/AGENTS.md | 任务未声明新增——待核对 |

6. **Evolution requirements**

   唯一 evolution-required 项：v1-spec §8「语义收窄例外」条款修订。修订计划完整性核对（计划载体 = 已接受的 ADR 0021）：
   - 修订文件：`docs/vfsl/v1-spec.md` §8——✅（0021 决策 4 明示增补位置，条款全文逐字给出）；
   - 新旧语义：`typeof` 全放行 → 四值拒绝——✅（决策 1 公式 + 决策 3 消息形态）；
   - 兼容与迁移：不迁移、loud 失败、发版说明 breaking 告知——✅（决策 5）；
   - 失败语义：双路径同口径、四值细分消息——✅（决策 3）；
   - 版本：无新错误码、方言 `version` 不动——✅（Consequences L133–134）；
   - 验证：测试矩阵与任务验收项一一对应——✅（0021 L146–155；task L19–25）；
   - 冻结面清单：决策 6 逐项——✅。

   结论：**计划完整**（accepted ADR 即修订权威，非待起草方案）。缺口仅在执行侧：任务简报验收项未包含 §8 修订——列 §8 Required action 1，并在实现后复查时核对「文档与代码同变更集、语义一致、override 未扩大、旧引用已更新」。

7. **Hard conflicts**

   无。任务方向与全部在集决策兼容；唯一触碰冻结纪律的路径已由 accepted ADR 0021 提供合法 override（§8 例外条款），剩余工作是把条款落入 spec 文本。

8. **Required actions**

   1. **（必须，随实现同变更集）** 在 `docs/vfsl/v1-spec.md` §8 增补「语义收窄例外」条款，文本采用 ADR 0021 决策 4 已给出的表述；依据：ADR 0021 决策 4 + `docs/AGENTS.md`「code behavior changes 须同步修订 stated contract 变化的规范文档」。当前 HEAD 无此修订（三分支核查均无）。
   2. **（实现期核对项）** 新四值消息保持原 emit 锚位、issue 顺序与单错误量契约（packages/vfsl/AGENTS.md 兼容行为）；消息文案本身自由（0021 决策 3「文案不进冻结面」）。
   3. **（边界纪律）** 本任务不得顺带实现文本侧 `-0` 字面量 E100、int/range 三形态判定或对 `seedForTest` / 手工 Yjs 直构面收窄（ADR 0020 不在集；0021 决策 7 明示排除）。
   4. **（非阻塞建议）** SA1 可评估是否在 CONTEXT.md 增补 number 值域术语条目（「JSON 可忠实表示数」）；当前 CONTEXT 无既有术语被违反，此为可选。

9. **Verdict**: **clear**
   - 全部对照项为 no-conflict 或 implements-existing-decision，唯一样本 evolution-required（v1-spec §8 修订）已有完整修订计划（accepted ADR 0021，条款全文在案）并列入 Required actions 随实现兑现；无 hard-conflict、无缺失的裁决权威、无证据不足。

10. **requiresConflictRecheck**: **true**
    - 触发理由：(a) 失败语义（validate / validate-patch 双路径四值拒绝消息）尚待实现核对；(b) 正式 override（v1-spec §8 例外条款）尚待同变更集落文核对；(c) 冻结面（指纹逐字节、IR/codegen 零改动、错误码集合、emit 锚位/顺序）尚待实际 diff 核对。
