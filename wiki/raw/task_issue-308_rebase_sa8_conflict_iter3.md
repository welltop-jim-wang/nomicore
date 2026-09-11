# SA8 冲突门禁报告 — issue #308 rebase 路线终局确认（iteration 3）

- Dispatch：`sa-cf8e48c6-5e18-47cc-9253-21743b61b78f`（mabf-sa8 / conflict-gate / iteration 3）
- 审查路线：对**已两轮放行**（iteration 1 `sa-02e2d9c7` clear、iteration 2 `sa-b11193b6`
  clear）的 rebase 路线做终局冲突确认——把 issue #308 提交 `3fa05f4`
  （`feat(vfsl): merge member docs into read projection`）rebase 到**当前稳定权威** Parent
  PR #305 head `31da1f0`（`origin/docs/issue-304-vfsl-union-member-docs` tip）。
- 门禁类型：对既有 clear 结论的增量复核（总控指令限定「只报 conflict-gate 发现，不实施」；
  本轮额外指令：Issue #308 REST comments = `[]`，无附加 Owner 要求）。
- 裁决：**clear**（确认无 ADR / 规范正文 / 架构层面冲突阻塞该 rebase 路线）——
  **0 阻塞 / 0 低 / 5 信息项**；10 项检查逐条一致。
- 冲突基准：`docs/adr/` 全集（17 份：0001–0012、0014、0016–0019；0013/0015 编号空缺，
  状态行全为「已接受」，无 superseded ADR）+ 根 `CONTEXT.md`；规范正文扩展面
  （`docs/vfsl` v1-spec、`docs/protocols/instance-replication-v1.md`）一并核稳。
- 方法注记：工作区技能目录无 `sa8-conflict-gate` 技能（已尝试加载，返回 unknown），
  按角色章程执行。全程只读：未改任何 tracked 文件、未动分支/工作树/stash；文本冲突用
  `git merge-tree --write-tree --merge-base=4d4208b`（只写匿名 tree 对象）干跑判定；
  基线新鲜度用**实时 `git fetch origin` + `gh pr view 305`（headRefOid）**双重确认；
  Issue 需求面用 `gh api …/issues/308/comments` 与 `gh issue view 308`（updatedAt）复核。
  本报告为唯一产出文件（iteration 1/2 报告保持原样，作为历史证据不覆写）。

## 1. 路线前提事实（iteration 3 实时核对）

| 项 | 事实 | 出处（本轮实测） |
|---|---|---|
| 被重放提交 | `3fa05f4`（worktree HEAD，分支 `mabf/issue-308`，tracked 树干净，仅 untracked wiki/raw 证据文件）：`packages/vfsl/src/resolve-schema-at-path.ts`、`docs/adr/0016` append-only 增补节、3 份新增测试、6 份 wiki 证据 | `git rev-parse HEAD`；`git status` |
| 当前权威 PR #305 head | `31da1f0`（`31da1f08dc168837523d5b314c9b12c5a89c1a91`）——本轮实时 `git fetch origin` 后 remote-tracking ref 未动，且 `gh pr view 305` headRefOid 与之**逐字节相同**；PR OPEN | `git log origin/docs/issue-304…`；`gh pr view 305 --json headRefOid,state` |
| 基线无漂移 | iteration 1/2 所裁决的基线即当前基线：`4d4208b..31da1f0` 恰 2 增量（`31da1f0` #322 codegen、`f63b0a5` root-lock 修复）原样，无新提交加入 → **两轮 clear 结论均未失效** | `git log --oneline 4d4208b..31da1f0` |
| Issue 需求面 | REST comments = `[]`（本轮 `gh api` 独立复核，与总控指令陈述一致）；issue OPEN、updatedAt `2026-09-11T06:53:35Z` 与任务简报快照相同（正文未被编辑）→ AC1–AC3 即需求全集 | gh API 实测 |
| 文本合并干跑 | merge-tree（base `4d4208b` × `3fa05f4` × `31da1f0`）exit 0 → 干净树 `37a0f621…`，**0 冲突路径、0 冲突消息**，树 OID 与 iteration 1/2 所得逐字节相同 | 本轮复跑 `git merge-tree --write-tree` |
| 规范/实现面逐字节稳定 | 合并结果树 vs HEAD `3fa05f4` 在 `packages/vfsl`、`docs/adr`、`CONTEXT.md`、`docs/vfsl`、`docs/protocols` 上 diff **全空**；rebase 全量 delta = 17 文件 +2714/−21，恰为新基线两提交自身内容 | `git diff 37a0f62 3fa05f4 -- <基准面>` |
| 新基线增量隔离 | `4d4208b..31da1f0` 对上述全部基准面的 diff 全空：#322 只触 `packages/vfsl-codegen` + task_issue-307 证据；`f63b0a5` 只触 `apps/yjs-server` + `docs/integration/hub-peer-deployment.md` | `git diff --stat`（空） |
| 验证链证据在位 | SA7 报告 `task_issue-308_sa7_report.md`（dispatch `sa-b9ae6a65`，38/38 动态断言全绿，验证对象即本 HEAD `3fa05f4`，上游 SA6/SA4 approve、comments `[]`）存在且未变 | 文件实测 |

**含义**：权威 head 自 iteration 1 以来未移动、被重放提交未变、需求面未增——本路线与
iteration 1/2 所裁决对象是**同一组 git 对象**。本轮不依赖旧报告转述，全部关键事实
（head OID、comments 空集、merge-base、干跑树、基准面 diff、ADR 状态、母决策授权、
0016 增补节、CONTEXT.md 词条）已在当前 HEAD 上独立重取并复现。

## 2. 逐项裁决（rebase 路线 vs 决策集）

| # | 检查项 | 事实与证据 | 裁决 |
|---|---|---|---|
| X1 | 文本合并冲突 | 干跑 exit 0、0 冲突路径、干净树 `37a0f62`（与 iter1/2 同 OID）；两侧文件集零交集（#308：vfsl/resolve-schema-at-path + 0016 ADR + task_issue-308*；新基线：vfsl-codegen + yjs-server + hub-peer-deployment.md + task_issue-307*） | ✅ 无冲突 |
| X2 | 决策基准面稳定性 | 基线增量对 ADR 全集、CONTEXT.md、v1-spec、protocols 的 diff 全空；合并树 vs `3fa05f4` 同面 diff 亦空 → rebase 后决策集与全套前序门禁所裁决对象逐字节相同；CONTEXT.md「语义 schema 投影」词条用表数不可知措辞（「文档注释表的相关切片」），四表化无需词条改动 | ✅ 一致 |
| X3 | 母决策授权 | ADR 0019（已接受）§7「readData 语义投影切片并入（修订 ADR 0016）」+ Consequences 点名交付物 `resolve-schema-at-path.ts（sliceDocs 第三来源）`——决策集**期待** #308 的改动（本轮在当前 HEAD 上重读原文核对：§7 行 132–140、Consequences 行 190） | ✅ 一致 |
| X4 | ADR 0016 修订机制 | `3fa05f4` 对 0016 = append-only dated 增补节（+20/−0，行 100 起），授权链完整（0019 决策 7 显式修订 + issue 正文括注），正文一字未动；新基线未触 0016，增补节原样落位 | ✅ 一致 |
| X5 | `memberDocs` 契约双消费 | #322（codegen `memberDocsAt`）与 #308（sliceDocs 第三来源）都**只读消费**同一 conditional-sparse 表（ADR 0019 决策 5/§5），生产者 `packages/vfsl` 未被新基线触碰 → 无契约漂移、无双写 | ✅ 一致 |
| X6 | 「逐字节不变」不变量共存 | #308 AC2（M4-free 投影输出不变）与 #322 纪律（无成员 doc 生成物不变）作用于不相交输出面（readData 投影 vs 生成 TS），同源于 0019 §5 条件稀疏性质，构造性共存 | ✅ 一致 |
| X7 | root-lock 增量隔离 | `f63b0a5` 与 #308 触碰面零文件/零依赖/零生命周期交集；hub-peer-deployment.md 属 integration 文档，不在 ADR+CONTEXT 冲突基准内 | ✅ 一致 |
| X8 | superseded / 取代关系核查 | 全集 17 份状态行全为「已接受」，无 superseded ADR 文件（0003「取代同号草稿」指未入库草稿；0007「由 0008 部分取代」为运行时条款面，与 #308 读投影切片零交集；0006 的 "supersede" 字样为 pending-load 语义与已撤销设计记录，非 ADR 状态；0002 无独立状态行，系定位性决策文档，未被任何后续 ADR 取代，且与 #308 零交集） | ✅ 一致 |
| X9 | 姊妹票边界互认 | 冻结于 `31da1f0` 的 #307 冲突报告 B1 原文划界：「readData docs 切片并入第三来源属 #308（ADR 0019 决策 7，涉 `resolve-schema-at-path.ts` 与 ADR 0016 修订）」——与 `3fa05f4` 实际触碰面逐项吻合，无越界、无认领冲突 | ✅ 一致 |
| X10 | 路线前提时效性（本轮特有） | 权威 head（fetch + gh 双源）、被重放提交、merge-base、Issue comments 空集、issue 正文 updatedAt 全部与 iter1/2 裁定时点一致 → 「当前稳定权威 head」陈述成立，两轮 clear 对象即本轮对象 | ✅ 一致 |

## 3. 发现项（均信息级，非冲突）

### I1（信息）— 既有证据的谱系引用将随 rebase 成为历史陈述

`task_issue-308` 套件多处引用旧谱系（`4d4208b` 基线、旧 SHA）。docs/AGENTS.md 明示
「Historical `wiki/raw/` artifacts are evidence, not normative contracts」——不构成冲突，
不改写历史证据；iteration 1/2/3 三份报告共同构成 rebase 前后的完整门禁记录。建议
（可选）：rebase 提交信息注明证据文件引用的 HEAD/SHA 为 rebase 前谱系。

### I2（信息）— 规范正文中间态保持，未被 rebase 加重

v1-spec §5 仍述三挂载锚位（新基线未触 `docs/vfsl`）；ADR 0016 正文旧措辞已由
`3fa05f4` 的 dated 增补节条款级修订覆盖。规范落地票 #309 与 PR #305 收官人工合并的
核对清单不变——rebase 既不消除也不加重该欠账。

### I3（信息）— 权威基线 tip 携带跨域内容（root-lock 修复）

PR #305 集成支在特性族之外携带 `f63b0a5`（apps/yjs-server root-lock 竞态修复）。
按 Ticket Parent「同支累积、收官人工合并」惯例属预期形态；与 #308 冲突基准与触碰面
零交集（X7）。收官合并时 PR #305 交付面叙述宜涵盖该跨域修复——非冲突，无行动项。

### I4（信息）— 验证面移交（SA7 证据迁移 + 落地后例行 CI）

SA7 38/38 动态断言、SA4 记录的聚焦 80 / 包级 644 / 根 typecheck 绿态因被测面
逐字节不变而构造性迁移；rebase 落地后由实现流程照常跑一次 CI 确认即可
（属 SA4/SA7 面，非门禁义务）。

### I5（信息，iteration 3 特有）— 结论连续性已闭合，无需再次门禁

本轮以实时双源证据证实：权威 head 自 iteration 1 以来未移动、被重放提交未变、
需求面未增——iteration 1/2 的 clear 与本轮 clear 裁决的是同一组 git 对象。除非
PR #305 head 再移动、issue #308 出现新 Owner 评论、或决策集（ADR/CONTEXT.md）发生
新提交，否则本路线**无需再行冲突门禁**，可直接实施 rebase。

## 4. 结论

- **verdict：clear**。「`3fa05f4` rebase 到当前稳定权威 PR #305 head `31da1f0`」的
  已放行路线在冲突门禁层面终局确认：文本 0 冲突（X1）；决策基准面（ADR 全集 +
  CONTEXT.md + v1-spec + protocols）rebase 前后逐字节不变（X2/X4/X8）；新基线增量与
  #308 触碰面要么零交集（X7），要么是同一 `memberDocs` 契约的只读共同消费方且行为
  不变量构造性共存（X5/X6）；母决策（ADR 0019 §7）明确期待本改动（X3）；姊妹票证据
  互认（X9）；路线前提时效性双源复核成立（X10）。**无任何 ADR、规范正文或架构层面的
  冲突阻塞该 rebase**。无需 override，无需设计修订。
- 冲突点数与分布：**0 阻塞 / 0 低 / 5 信息（I1 谱系引用、I2 规范中间态、I3 跨域
  tip 内容、I4 验证面移交、I5 结论连续性）；10 项检查逐条一致**。iteration 1/2 的
  信息项（R1–R3 / I1–I4）状态不变，本轮逐项复核均仍成立、无一被加重。
- `requiresConflictRecheck: false`——本 rebase 不新增任何决策记录触碰面；且本轮证实
  权威 head 与需求面自前两轮以来零漂移，前序 clear 连同本结论对同一路线连续有效。
