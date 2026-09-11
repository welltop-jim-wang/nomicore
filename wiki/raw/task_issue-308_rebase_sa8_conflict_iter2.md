# SA8 冲突门禁报告 — issue #308 rebase 路线确认（SA7 approve 后 · iteration 2）

- Dispatch：`sa-b11193b6-d62f-478e-9c24-ec42bd0b7d53`（mabf-sa8 / conflict-gate / iteration 2）
- 审查路线：SA7 approve 之后，把已批准的 issue #308 提交 `3fa05f4`
  （`feat(vfsl): merge member docs into read projection`）rebase 到**当前权威** Parent
  PR #305 head `31da1f0`（`origin/docs/issue-304-vfsl-union-member-docs` tip）。
- 门禁类型：前置门禁 + 对 iteration 1 rebase 复审（`sa-02e2d9c7`，clear）的增量复核——
  总控指令限定「只报 conflict-gate 发现，不实施」。
- 裁决：**clear**（确认放行该 rebase 路线）—— **0 阻塞 / 0 低 / 4 信息项**；9 项检查逐条一致。
- 冲突基准：`docs/adr/` 全集（17 份：0001–0012、0014、0016–0019；0013/0015 编号空缺，
  状态行全为「已接受」，无 superseded ADR）+ 根 `CONTEXT.md`。Issue #308 REST comments
  经本轮独立 REST 复查 = `[]`（与任务简报陈述一致），无附加 Owner 要求。
- 方法注记：工作区技能目录无 `sa8-conflict-gate` 技能（已尝试加载，返回 unknown），
  按角色章程执行。全程只读：未改任何 tracked 文件、未动分支/工作树/stash；文本冲突用
  `git merge-tree --write-tree --merge-base=4d4208b`（只写匿名 tree 对象）干跑判定；
  基线新鲜度用**实时 fetch + `gh pr view 305`（headRefOid）**双重确认。本报告为唯一产出文件
  （iteration 1 报告 `task_issue-308_rebase_sa8_conflict.md` 保持原样，作为历史证据不覆写）。

## 1. 路线前提事实（iteration 2 增量核对）

| 项 | 事实 | 出处（本轮实测） |
|---|---|---|
| 被重放提交 | `3fa05f4`（worktree HEAD，分支 `mabf/issue-308`，未变）：`packages/vfsl/src/resolve-schema-at-path.ts` +50/−9、`docs/adr/0016` +20/−0（append-only 增补节）、3 份新增测试、6 份 wiki 证据 | `git rev-parse HEAD`；`git show --stat 3fa05f4` |
| SA7 批准状态 | **approve 已到位**：`wiki/raw/task_issue-308_sa7_report.md`（dispatch `sa-b9ae6a65`，38/38 动态断言全绿），验证对象即本 HEAD `3fa05f4`，上游 SA6/SA4 approve、comments `[]` | 报告文件 §11 |
| 当前权威 PR #305 head | `31da1f0`（`31da1f08dc168837523d5b314c9b12c5a89c1a91`）——本轮实时 `git fetch origin` 后 remote-tracking ref 未动，且 `gh pr view 305` headRefOid 与之逐字节相同；PR OPEN | `git log origin/docs/issue-304…`；`gh pr view 305 --json headRefOid` |
| 基线无漂移 | iteration 1 所裁决的新基线即当前基线：`31da1f0`（#307/#322 codegen）+ `f63b0a5`（root-lock 修复）两增量原样，无新提交加入 → **iteration 1 的 clear 结论未失效，无需重裁** | `git log 3fa05f4..31da1f0` 恰 2 项 |
| Issue 附加要求 | REST comments `[]`（本轮 `gh api …/issues/308/comments` 独立复核返回 `[]`）→ 任务简报 AC1–AC3 即需求全集 | gh API 实测 |
| 文本合并干跑 | merge-tree（base `4d4208b` × `3fa05f4` × `31da1f0`）exit 0 → 干净树 `37a0f621…`，**0 冲突路径、0 冲突消息**，与 iteration 1 所得树 OID 逐字节相同 | 本轮复跑 `git merge-tree --write-tree` |
| 规范/实现面逐字节稳定 | 合并结果树 vs HEAD `3fa05f4` 在 `packages/vfsl`、`docs/adr`、`CONTEXT.md`、`docs/vfsl`、`docs/protocols` 上 diff **全空**；rebase 全量 delta = 17 文件 +2714/−21，恰为新基线两提交自身内容 | `git diff 37a0f62 3fa05f4 -- <基准面>` |
| 新基线增量隔离 | `4d4208b..31da1f0` 对 `docs/adr`/`CONTEXT.md`/`docs/vfsl`/`docs/protocols`/`packages/vfsl` 的 diff 全空：#322 只触 `packages/vfsl-codegen`（docs/emitter/valuetype + 638 行测试）+ task_issue-307 证据；`f63b0a5` 只触 `apps/yjs-server`（lifecycle/test）+ `docs/integration/hub-peer-deployment.md` | `git show --stat`；`git diff --stat`（空） |

**含义**：SA7 的动态验证证据采集自 `3fa05f4`；由于 rebase 对被验证面
（`packages/vfsl` 实现 + 全部 ADR/CONTEXT 规范面）逐字节不变，**SA7 approve 连同其上游
SA2/SA4/SA6/SA8(iter1) 结论可构造性迁移到 rebase 后提交**——路线在门禁层面闭合。

## 2. 逐项裁决（rebase 路线 vs 决策集）

| # | 检查项 | 事实与证据 | 裁决 |
|---|---|---|---|
| X1 | 文本合并冲突 | 干跑 0 冲突；两侧文件集零交集（#308：vfsl/resolve-schema-at-path + 0016 ADR + task_issue-308*；新基线：vfsl-codegen + yjs-server + hub-peer-deployment.md + task_issue-307*） | ✅ 无冲突 |
| X2 | 决策基准面稳定性 | 基准增量对 ADR 全集、CONTEXT.md、v1-spec、protocols 的 diff 全空 → rebase 后决策集与 iteration 1（及此前全套门禁）所裁决对象逐字节相同 | ✅ 一致 |
| X3 | 母决策授权 | ADR 0019（已接受）§7「readData 语义投影切片并入（修订 ADR 0016）」+ Consequences 点名交付物 `resolve-schema-at-path.ts（sliceDocs 第三来源）`——决策集**期待** #308 的改动 | ✅ 一致 |
| X4 | ADR 0016 修订机制 | `3fa05f4` 对 0016 = append-only dated 增补节（+20/−0），授权链完整（0019 决策 7 显式修订 + issue 正文括注），正文一字未动；新基线未触 0016，增补节原样落位 | ✅ 一致 |
| X5 | `memberDocs` 契约双消费 | #322（codegen `memberDocsAt`）与 #308（sliceDocs 第三来源）都**只读消费**同一 conditional-sparse 表（ADR 0019 决策 5/§5），生产者 `packages/vfsl` 未被新基线触碰 → 无契约漂移、无双写 | ✅ 一致 |
| X6 | 「逐字节不变」不变量共存 | #308 AC2（M4-free 投影输出不变）与 #322 纪律（无成员 doc 生成物不变）作用于不相交输出面（readData 投影 vs 生成 TS），同源于 0019 §5 条件稀疏性质，构造性共存 | ✅ 一致 |
| X7 | root-lock 增量隔离 | `f63b0a5` 与 #308 触碰面零文件/零依赖/零生命周期交集；hub-peer-deployment.md 属 integration 文档，不在 ADR+CONTEXT 冲突基准内 | ✅ 一致 |
| X8 | superseded / 取代关系核查 | 全集 17 份状态行全为「已接受」，无 superseded ADR（0003「取代同号草稿」指未入库草稿；0007「由 0008 部分取代」为运行时条款面，与 #308 读投影切片零交集；0006 的 "supersede" 字样为 pending-load 语义与已撤销设计记录，非 ADR 状态） | ✅ 一致 |
| X9 | 姊妹票边界互认 | 冻结于 `31da1f0` 的 #307 冲突报告 B1 原文划界：「readData docs 切片并入第三来源属 #308（ADR 0019 决策 7，涉 `resolve-schema-at-path.ts` 与 ADR 0016 修订）」——与 `3fa05f4` 实际触碰面逐项吻合，无越界、无认领冲突 | ✅ 一致 |

## 3. 发现项（均信息级，非冲突）

### I1（信息）— 既有证据的谱系引用将随 rebase 成为历史陈述

`task_issue-308` 套件多处引用旧谱系（`4d4208b` 基线、旧 SHA）。docs/AGENTS.md 明示
「Historical `wiki/raw/` artifacts are evidence, not normative contracts」——不构成冲突，
不改写历史证据；iteration 1 报告与本报告共同构成 rebase 前后的门禁记录。建议（可选）：
rebase 提交信息注明证据文件引用的 HEAD/SHA 为 rebase 前谱系。

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

## 4. 结论

- **verdict：clear**。SA7 approve 后执行「`3fa05f4` rebase 到当前权威 PR #305 head
  `31da1f0`」的路线在冲突门禁层面确认放行：文本 0 冲突（X1）；决策基准面
  （ADR 全集 + CONTEXT.md + v1-spec + protocols）rebase 前后逐字节不变（X2/X4/X8）；
  新基线增量与 #308 触碰面要么零交集（X7），要么是同一 `memberDocs` 契约的只读共同
  消费方且行为不变量构造性共存（X5/X6）；母决策（ADR 0019 §7）明确期待本改动（X3）；
  姊妹票证据互认（X9）。无需 override，无需设计修订。
- 冲突点数与分布：**0 阻塞 / 0 低 / 4 信息（I1 谱系引用、I2 规范中间态、I3 跨域
  tip 内容、I4 验证面移交）；9 项检查逐条一致**。iteration 1 三项信息（R1–R3）状态
  不变，本轮分别对应 I1–I3 保持成立。
- 增量结论（iteration 2 特有）：实时 fetch + `gh pr view 305` 证实权威 head 自
  iteration 1 以来未移动（仍 `31da1f0`），iteration 1 的 clear 未失效；SA7 approve
  到位后路线前提完整，rebase 可执行。`requiresConflictRecheck: false`——本 rebase
  不新增任何决策记录触碰面。
