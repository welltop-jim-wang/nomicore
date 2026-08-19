# 任务简报 — Parser 环检测与 §4 fixture 全量解析（Issue #9）

> Worktree: `/home/wangjian/nomicore-fix-issue-9`
> 分支: `fix/issue-9-on-refactor-docs-add-mabf-multi-repo-monito`
> 任务类型: **功能开发**（流程：SA6 验收测试 → SA1 设计 → SA2 评审 → SA3 编码 → SA4 静态 → SA7 动态）
> 前序: Issue #5（最小端到端 parser）、#7（JSDoc 捕获）、#6（容器与标记）均已交付合入
> run_id: `issue-9-1787100197-15896`

## 一、任务目标（来自 Issue #9）

类型别名引用图的环检测（v1 禁止递归）：自引用与互引用（A→B→A）都拒绝并给出结构化错误。设计文档 §4 的 `vfs3.assets` 文本作为 PRD #3 的正例 fixture 完整解析为 IR（含 `AssetId` 的 Pattern 键约束、`Audit`、判别联合 `AssetEntity`、`AssetsDoc` 与 JSDoc 原文）。

## 二、Acceptance Criteria（全部满足才算完成）

- [ ] 自引用别名被拒，错误含行列
- [ ] 互引用环（A→B→A）被拒
- [ ] `vfs3.assets` fixture 全量解析为完整 IR，JSDoc 原文挂载正确
- [ ] 产出的 IR 可 JSON 序列化（内容哈希缓存的前提）

## 三、现状基线（总控 2026-08-19 实测，SA 必读）

- 本分支 HEAD == `origin/refactor/docs-add-mabf-multi-repo-monitoring-note-synthetic`（b076d41，零 diff）；基线 `pnpm typecheck` 通过、`pnpm test` 6 文件 85/85 全绿。
- **注意**：前序任务（#6/#7）交付时已带入部分与 #9 AC 重叠的测试与实现（零 diff 基线即含它们）：
  - `test/parse-vfsl-errors.test.ts` 已有 E106 自引用/互引用用例；
  - `test/parse-vfsl-containers-markers.test.ts` 已有 spec §10 `vfs3.assets` 全量 fixture 端到端解析用例（断言 ok + JSON roundtrip + 五别名 + Pattern 正则原文）；
  - `src/semantic.ts` 已实现 E106 迭代三色 DFS（环路径入消息）。
  - **但**：现有测试未在「§10 全量 fixture」上逐一断言各 JSDoc 原文挂载到正确 IR 节点（AC3 后半句「JSDoc 原文挂载正确」未被该 fixture 用例直接锚定）。
- SA6 的职责是以 **Issue #9 的四条 AC** 为锚独立编写验收测试（不得照抄 #6/#7 既有用例），并如实报告每条 AC 的红/绿状态。若验收测试写出来就是绿的（功能已全部存在），按总控 SKILL 第一阶段规则 3：**停止并汇报，不得伪造红灯**。

## 四、权威输入（必读）

| 输入 | 角色 |
|---|---|
| `docs/vfsl/v1-spec.md` | v1 方言唯一规范来源（frozen）：§4「递归与循环引用检测」（E106 语义：环路径消息 + 再入引用记号行列锚）、§4 错误判定顺序与分相位（E106 属引用/语义相位、模块全量解析成功后才进入、相位内取文本位置最前）、§10 附录 `vfs3.assets` 参考 fixture 全文 |
| `wiki/raw/20260818-prd-vfsl-v1.md` | PRD 归档：公共接缝 `parseVfsl(text)` 冻结、测试决策（正例 fixture = 设计文档 §4 文本、环检测负例自引用+互引用、JSDoc 原文挂载、只测外部行为） |
| `wiki/raw/task_vfsl-parser-containers-markers*.md` | #6 全套档案（设计/评审/验证），E106 机制与 fixture 测试的来历 |
| `wiki/raw/task_vfsl-jsdoc-capture*.md` | #7 全套档案，JSDoc 原文挂载三锚位（别名/属性/标记）与 `docs:string[]` 字段契约 |
| `packages/vfsl/src/` + `packages/vfsl/test/` | 现状代码与 85 个已绿测试（不得破坏） |
| `CONTEXT.md` | 术语规范（标记类型大小写契约、判别联合、封闭对象等） |
| `docs/adr/0001`、`docs/adr/0002` | 架构决策（单一真相源、纯引擎仓库、authority 出范围），不得违反 |

## 五、环境与验证命令

- pnpm 单仓库 + workspace，唯一业务包 `packages/vfsl`（`@nomicore/vfsl`，当前 `0.1.2`）。
- 本仓库**没有** `scripts/test-lock.sh`；命令（在 worktree 根执行）：
  - 全量测试：`pnpm test`（= `vitest run`）
  - 类型检查：`pnpm typecheck`（= `tsc -p packages/vfsl/tsconfig.json`）
- 零运行时依赖红线：`packages/vfsl/package.json` 不得引入任何 `dependencies`。
- 若本任务产生 `packages/vfsl` 代码/测试改动，须 bump patch 版本号（Hard Gate #9）。

## 六、产出文件命名约定（均写入 `<worktree>/wiki/raw/`）

| 文件 | 来源 |
|---|---|
| `task_vfsl-parser-cycle-detection.md` | 本简报（已存在） |
| `task_vfsl-parser-cycle-detection_design.md` | SA1 设计 |
| `task_vfsl-parser-cycle-detection_sa2_review.md` | SA2 评审 |
| `task_vfsl-parser-cycle-detection_sa4_review.md` | SA4 静态验尸 |
| `task_vfsl-parser-cycle-detection_sa7_report.md` | SA7 动态验证 |
| `task_vfsl-parser-cycle-detection_dispatch.md` | 派遣日志（总控维护） |

功能开发任务**不产出** `YYYYMMDD-bug-<slug>.md`（那是 SA5 故障分析，仅 Bug 修复任务）。

## 七、约束与红线

1. 发布与远程操作（push、开 PR、CI 跟踪）全部由外部 `check.sh` 负责；总控与所有 SA 均不得执行任何远程写操作。
2. `parseVfsl` 返回形状（`{ ok: true; module } | { ok: false; issues }`）、issues 字段形状（`{ message, line, column }`）、错误码消息前缀（`VFSL-E<三位>: `）按 #5 冻结契约延续，只增不改。
3. 基线 85 个已绿测试不得破坏。
4. 测试文件为 vitest `*.test.ts`：若 SA1 design 涉及 `*.test.ts` 新增/改动，SA4 review 须含「1.4 vitest 触发性自检」结论、SA7 report 须含「vitest 触发证据」段落（Hard Gate #14）。
5. 评审 verdict 行格式约定：dispatch log 中 verdict 单独成格（`| pass |`）；SA4/SA7 报告主 verdict 行 `**Verdict**: pass` 且为文件最后一条 verdict。

---

## 八、SA6 红灯测试记录（2026-08-19，验收锚定）

### 测试文件

`packages/vfsl/test/parse-vfsl-cycle-detection.test.ts`（新增，14 条用例，4 个 describe 各锚一条 AC）。

设计要点（以 issue #9 四条 AC 为锚独立编写，输入形状不与 #6/#7 既有用例重复）：

- **AC1 自引用被拒（含行列）**：spec §4 明示的容器包裹形态 `type A = { x: A[] };`；多行对象自引用（锚 (2,6)）；标记实参自引用 `type A = YArray<A>;`（锚 (1,17)）。
- **AC2 互引用环被拒**：经标记传递的两节点环（锚 (2,20)）+ **消息含环路径 `A → B → A`**（#6/#7 既有用例未锚定消息环路径）；三节点环 `A → B → C → A` 完整路径；边界：纯别名链环 `type A = B; type B = A;`（无容器）；经 Record 值位成环。
- **AC3 §10 fixture 全量解析 + JSDoc 原文逐节点挂载**：fixture 逐字复刻；五别名按声明顺序；六标记全部进入 IR（Pattern/YMap/YLeaf/YArray/YPlainArray/YXmlFragment，含嵌套位）；**七条 JSDoc 原文逐字断言挂载到正确节点**——AssetId 连续两条同挂（出现序）、Audit/AssetEntity/Attachments/AssetsDoc 各一条挂别名、`/** @semantic 可选说明字段 */` 挂 `notes?` 字段且同对象其他字段 docs 为空（无泄漏）；判别联合三成员 kind 字面量 `["image","text","file"]`；`Record<AssetId, AssetEntity>` 键/值引用进 IR。
- **AC4 IR JSON 可序列化**：fixture IR JSON 往返无损；**确定性**（同一文本两次独立解析序列化逐字符相同——内容哈希前提，#6 未锚定）；全部 kind（primitive/literal/ref/object/union/array/record/marker/pattern）覆盖往返。

### 红灯验证（实际运行，2026-08-19）

```bash
pnpm vitest run packages/vfsl/test/parse-vfsl-cycle-detection.test.ts
# → Test Files 1 passed (1) / Tests 14 passed (14)，EXIT=0
pnpm test   # 全量 → 7 files / 99 passed (85 基线 + 14 新增)，EXIT=0
pnpm typecheck  # EXIT=0
```

### 四条 AC 红/绿状态（如实报告）

| AC | 状态 | 证据 |
|---|---|---|
| AC1 自引用被拒，错误含行列 | 🟢 绿 | 3/3 通过（E106 + 精确行列锚点：容器包裹/多行/标记实参） |
| AC2 互引用环（A→B→A）被拒 | 🟢 绿 | 4/4 通过（E106 + 锚点 + 消息含环路径） |
| AC3 fixture 全量解析为完整 IR，JSDoc 原文挂载正确 | 🟢 绿 | 4/4 通过（五别名/六标记/七条 JSDoc 逐节点逐字挂载） |
| AC4 产出 IR 可 JSON 序列化 | 🟢 绿 | 3/3 通过（往返无损 + 确定性 + 全 kind 覆盖） |

**结论**：四条 AC 的验收测试写出来即全绿——功能已由前序 #6/#7 交付的实现完整覆盖（基线零 diff 即含 E106 迭代三色 DFS 与 fixture 解析），本任务无未实现的契约缺口。按总控 SKILL 第一阶段规则 3：**停止并汇报，不伪造红灯**。SA6 不产出修复；建议总控将该测试文件纳入本次交付（新增测试，满足 Hard Gate #14 的 vitest 证据），并在发布时按 Hard Gate #9 bump `packages/vfsl` patch 版本（测试文件属包内改动）。

## 九、总控裁决（2026-08-19 09:05）— 规则 3 中断

SA6 验收结论经总控独立复核成立：

- `pnpm typecheck` EXIT=0；`pnpm test` **7 文件 99/99 全绿**（85 基线 + 14 新验收测试，无 skip）；
- `git diff` 证产品 `packages/vfsl/src/` **零改动**；分支 vs `origin/refactor/docs-add-mabf-multi-repo-monitoring-note-synthetic` 零 diff；
- **四条 AC 全部已由 #6/#7 交付的实现满足**（E106 自引/互引拒绝含行列与环路径消息、§10 fixture 全量解析、七条 JSDoc 原文逐节点挂载、IR JSON 序列化与确定性）。

按 orchestrate-bugfix SKILL 第一阶段规则 3「验收测试写出来就是绿的（功能已存在）→ 停止并汇报」：**流水线在此中断**，不派 SA1/SA2/SA3/SA4/SA7（对零产品 diff 伪造完整攻防评审违反 HG12 verdict 真实性原则），**不写 `.mabf-done`**（避免 check.sh 推送无产品改动的 PR）。SA6 验收测试与全部 wiki 档案已本地 commit 存档。等待 Jim 决策：关闭 #9 为已交付，或指明仍缺失的具体子行为。

## 十、总控裁决补充（2026-08-19 09:20）— 受控恢复后转入验证型交付

- supervisor 以同一 run_id 受控恢复并明确指令：完整执行 SA 链（功能开发路由：SA6→SA1→SA2→SA3→SA4→SA7，SA5 仅 Bug 修复不适用）并完成完成事务；未完成退出会被继续恢复。规则 3 中断报告已完整归档（第九节 + dispatch log），供 Jim 事后审阅。
- **裁决**：转入验证型交付路径。交付物 = ① SA6 已绿的 14 条 AC 验收测试（`packages/vfsl/test/parse-vfsl-cycle-detection.test.ts`，回归锁）② HG9 版本 bump `packages/vfsl` 0.1.2 → 0.1.3（SA3 执行）。**无产品代码改动** — 这不是缺陷，是 #9 的 AC 已被 #6/#7 交付的实现满足的必然结果；验证证据本身即 #9 的交付物。
- **SA1 设计任务（验证型交付设计）**：枚举 issue #9 全部子行为（spec §4 E106 语义 × AC1/AC2 —— 自引/互引/容器包裹/标记传递/环路径消息/行列锚；§10 fixture 全量 × AC3 —— 五别名/六标记/七条 JSDoc 逐节点挂载/判别联合/Record 键约束；序列化与确定性 × AC4），逐项映射到 14 条测试用例或显式裁定「不在 #9 范围/已由前序覆盖」；论证测试锚定强度（删改实现任意一处是否必然红灯——防假绿）；裁定 HG9 bump 值；如实声明 TDD 红绿循环不适用于无产品变更的交付及替代证据标准；给出风险与完成标准。
- **SA2 攻击面**：测试是否假绿（mutation 式追问）、#9 是否存在未覆盖子行为、test-only 交付是否足以关闭 #9、bump 决策正确性、证据链有效性。
- 红线不变：HG12 verdict 真实性、HG14（design 含 `*.test.ts` → SA4 须「1.4 vitest 触发性自检」、SA7 须「vitest 触发证据」）、HG9、零运行时依赖、85 基线不破坏、总控与 SA 均不做任何远程发布操作。
