# SA8 冲突门禁报告 — issue #308 rebase 路线最终门禁资格确认（iteration 4 · final）

- Dispatch：`sa-a9c5b071-d4be-450c-9dc4-e960a4c4e0e7`（mabf-sa8 / conflict-gate / iteration 4）
- 审查路线：对已三轮放行（iteration 1 `sa-02e2d9c7` clear、iteration 2 `sa-b11193b6`
  clear、iteration 3 `sa-cf8e48c6` clear）的 rebase 路线做**最终门禁资格确认**——把
  issue #308 已批准提交 `3fa05f4`（`feat(vfsl): merge member docs into read projection`）
  rebase 到稳定权威 Parent PR #305 head `31da1f0`
  （`origin/docs/issue-304-vfsl-union-member-docs` tip）。
- 门禁类型：终局资格确认（总控指令限定「只报 conflict-gate 发现，不实施」；本轮指令
  额外陈述：Issue #308 REST comments = `[]`，无附加 Owner 要求）。
- 裁决：**clear / eligible**（该 rebase 路线的冲突门禁资格最终成立）——
  **0 阻塞 / 0 低 / 5 信息项**；iteration 3 的 10 项检查（X1–X10）逐条复核仍一致，
  其 I5 设定的三项失效条件（Y1–Y3）经本轮实时双源取证**全部未触发**。
- 冲突基准：`docs/adr/` 全集（17 份：0001–0012、0014、0016–0019；0013/0015 编号空缺，
  状态行全为「已接受/accepted」，无 superseded ADR）+ 根 `CONTEXT.md`；规范正文扩展面
  （`docs/vfsl` v1-spec、`docs/protocols/instance-replication-v1.md`）一并核稳。
- 方法注记：工作区技能目录无 `sa8-conflict-gate` 技能（本轮再次尝试加载，返回
  unknown），按角色章程执行。全程只读：未改任何 tracked 文件、未动分支/工作树/stash、
  未实施 rebase；文本冲突用 `git merge-tree --write-tree --merge-base=4d4208b`（只写
  匿名 tree 对象）干跑判定；基线新鲜度用**实时 `git fetch origin` + `gh pr view 305`
  （headRefOid）**双重确认；Issue 需求面用 `gh api …/issues/308/comments` 与
  `gh issue view 308`（updatedAt）独立复核，另加查 PR #305 的 reviews/comments 面。
  本报告为唯一产出文件（iteration 0–3 报告保持原样，作为历史证据不覆写）。

## 1. 路线前提事实（iteration 4 实时独立重取）

| 项 | 事实 | 出处（本轮实测） |
|---|---|---|
| 被重放提交 | `3fa05f4`（`3fa05f4b079ea6f91ecda6e31e30c7ae7056fe9e`，worktree HEAD，分支 `mabf/issue-308`，tracked 树干净，仅 5 份 untracked wiki/raw 证据文件）：`packages/vfsl/src/resolve-schema-at-path.ts` +50/−9、`docs/adr/0016` +20/−0（append-only 增补节）、3 份新增测试、7 份 wiki 证据 | `git rev-parse HEAD`；`git status --porcelain`；`git show --stat 3fa05f4` |
| 当前权威 PR #305 head | `31da1f0`（`31da1f08dc168837523d5b314c9b12c5a89c1a91`）——本轮实时 `git fetch origin` 后 remote-tracking ref 未动，`gh pr view 305` headRefOid 与之**逐字节相同**；PR OPEN | `git rev-parse origin/docs/issue-304…`；`gh pr view 305 --json headRefOid,state` |
| 基线无漂移 | iteration 1/2/3 所裁决的基线即当前基线：`4d4208b..31da1f0` 恰 2 增量（`31da1f0` #322 codegen、`f63b0a5` root-lock 修复）原样，无新提交加入 → **三轮 clear 结论均未失效** | `git log --oneline 4d4208b..31da1f0` |
| Issue 需求面 | REST comments = `[]`（本轮 `gh api …/issues/308/comments` 实测 length 0，与总控指令陈述一致）；issue OPEN、updatedAt `2026-09-11T06:53:35Z` 与 iteration 3 记录逐字节相同（正文未被编辑）→ AC1–AC3 即需求全集 | gh API 实测 |
| PR 讨论面（本轮加查） | PR #305 `reviews: []`、`comments: []`——PR 元数据 updatedAt（`2026-09-11T07:51:04Z`）晚于 iter3，但 reviews/comments 双空、head OID 未动 → 无任何 PR 级新增要求，元数据更新与门禁对象无关 | `gh pr view 305 --json reviews,comments` |
| 文本合并干跑 | merge-tree（base `4d4208b` × `3fa05f4` × `31da1f0`）exit 0 → 干净树 `37a0f621a87754aded4222b2c9b9b5fe7a77e607`，**0 冲突路径、0 冲突消息**，树 OID 与 iteration 1/2/3 所得逐字节相同 | 本轮复跑 `git merge-tree --write-tree` |
| 两侧文件集零交集 | `3fa05f4` 触碰文件集 ∩ `4d4208b..31da1f0` 增量触碰文件集 = **空**（#308：vfsl/resolve-schema-at-path + 0016 ADR + task_issue-308*；新基线：vfsl-codegen + yjs-server + hub-peer-deployment.md + task_issue-307*） | `comm -12`（输出空） |
| 决策基准面稳定性 | 基线增量对 `docs/adr`/`CONTEXT.md`/`docs/vfsl`/`docs/protocols`/`packages/vfsl` 的 diff **全空**；合并结果树 vs `3fa05f4` 在同面 diff 亦**全空** → rebase 后决策集与全套前序门禁所裁决对象逐字节相同 | `git diff --stat`（双向均空） |
| ADR 状态面 | 全集 17 份状态行全为「已接受/accepted」（0003 带 2026-08-19 修订注记，属正文修订节非取代）；无 superseded ADR——与 iter2/3 X8 核查一致，本轮独立复扫 | `head -6 docs/adr/*.md` 状态行实测 |
| 验证链证据在位 | SA7 报告 `wiki/raw/task_issue-308_sa7_report.md`（dispatch `sa-b9ae6a65`，**approve**，38/38 动态断言全绿，验证对象即本 HEAD `3fa05f4`，上游 SA6/SA4 approve、comments `[]`）存在且头部信息与本轮引用一致 | 文件实测（`head -30`） |
| 前置阻塞 | #306（M4 解析 + IR/derived `memberDocs`）仍 CLOSED——前置持续满足 | `gh issue view 306 --json state` |

**含义**：权威 head 自 iteration 1 以来未移动、被重放提交未变、需求面未增、PR 讨论面
为空——本路线与 iteration 1/2/3 所裁决对象是**同一组 git 对象**。iteration 3 I5 设定的
再门禁触发条件（head 再移动 / 新 Owner 评论 / 决策集新提交）一项都未发生。

## 2. 逐项裁决

### 2.1 失效条件核查（iteration 3 I5 设定，本轮实时取证）

| # | 失效条件 | 本轮实测 | 裁决 |
|---|---|---|---|
| Y1 | PR #305 head 再移动 | 实时 fetch 后 remote tip 仍 `31da1f0`；`gh pr view 305` headRefOid 逐字节相同；PR OPEN | ✅ 未触发 |
| Y2 | issue #308 出现新 Owner 评论 | REST comments 实测 length 0（`[]`）；issue updatedAt 与 iter3 记录逐字节相同（正文未编辑）；labels 无新增 | ✅ 未触发 |
| Y3 | 决策集（ADR/CONTEXT.md）发生新提交 | 基线仍恰 2 增量且对决策面 diff 全空；`31da1f0` 树即 iter3 已裁决树（同 OID ⇒ 同树）⇒ 决策集逐字节未变 | ✅ 未触发 |

### 2.2 十项检查连续性复核（沿袭 iteration 3 编号）

| # | 检查项 | 本轮复核 | 裁决 |
|---|---|---|---|
| X1 | 文本合并冲突 | 干跑 exit 0、0 冲突路径、干净树 `37a0f621`（与 iter1/2/3 同 OID）；两侧文件集交集实测为空 | ✅ 无冲突 |
| X2 | 决策基准面稳定性 | 双向 diff（增量对决策面、合并树 vs `3fa05f4` 对决策面）均空；CONTEXT.md「语义 schema 投影」词条表数不可知措辞无需改动 | ✅ 一致 |
| X3 | 母决策授权 | ADR 0019（已接受）§7「readData 语义投影切片并入（修订 ADR 0016）」+ Consequences 点名交付物 `resolve-schema-at-path.ts（sliceDocs 第三来源）`——决策集期待 #308 的改动 | ✅ 一致 |
| X4 | ADR 0016 修订机制 | `3fa05f4` 对 0016 = append-only dated 增补节（+20/−0），授权链完整（0019 决策 7 显式修订 + issue 正文括注），正文一字未动；新基线未触 0016 | ✅ 一致 |
| X5 | `memberDocs` 契约双消费 | #322（codegen `memberDocsAt`）与 #308（sliceDocs 第三来源）均为同一 conditional-sparse 表的只读消费方（ADR 0019 决策 5/§5），生产者 `packages/vfsl` 未被新基线触碰 | ✅ 一致 |
| X6 | 「逐字节不变」不变量共存 | #308 AC2（M4-free 投影输出不变）与 #322 纪律作用于不相交输出面（readData 投影 vs 生成 TS），同源于 0019 §5 条件稀疏性质 | ✅ 一致 |
| X7 | root-lock 增量隔离 | `f63b0a5` 只触 `apps/yjs-server` + `docs/integration/hub-peer-deployment.md`，与 #308 触碰面零文件/零依赖/零生命周期交集；integration 文档不在 ADR+CONTEXT 冲突基准内 | ✅ 一致 |
| X8 | superseded / 取代关系核查 | 17 份全为「已接受/accepted」，无 superseded（0003「取代同号草稿」指未入库草稿、带修订节注记；0007「由 0008 部分取代」为运行时条款面，与 #308 零交集） | ✅ 一致 |
| X9 | 姊妹票边界互认 | 冻结于 `31da1f0` 的 #307 冲突报告 B1 划界与 `3fa05f4` 实际触碰面逐项吻合（readData docs 切片并入第三来源属 #308：ADR 0019 决策 7、`resolve-schema-at-path.ts`、ADR 0016 修订） | ✅ 一致 |
| X10 | 路线前提时效性 | 权威 head（fetch + gh 双源）、被重放提交、merge-base、Issue comments 空集、issue 正文 updatedAt、PR 讨论面双空——全部与 iter1/2/3 裁定时点一致 | ✅ 一致 |

## 3. 发现项（均信息级，非冲突）

### I1（信息）— 既有证据的谱系引用将随 rebase 成为历史陈述

`task_issue-308` 套件多处引用旧谱系（`4d4208b` 基线、rebase 前 SHA）。docs/AGENTS.md
明示「Historical `wiki/raw/` artifacts are evidence, not normative contracts」——不构成
冲突，不改写历史证据；iteration 0–4 五份 SA8 报告共同构成门禁全程记录。建议（可选）：
rebase 提交信息注明证据文件引用的 HEAD/SHA 为 rebase 前谱系。

### I2（信息）— 规范正文中间态保持，未被 rebase 加重

v1-spec §5 仍述三挂载锚位（新基线未触 `docs/vfsl`）；ADR 0016 正文旧措辞已由
`3fa05f4` 的 dated 增补节条款级修订覆盖。规范落地票 #309 与 PR #305 收官人工合并的
核对清单不变——rebase 既不消除也不加重该欠账。

### I3（信息）— 权威基线 tip 携带跨域内容（root-lock 修复）

PR #305 集成支在特性族之外携带 `f63b0a5`（apps/yjs-server root-lock 竞态修复）。按
Ticket Parent「同支累积、收官人工合并」惯例属预期形态；与 #308 冲突基准与触碰面零
交集（X7）。收官合并时 PR #305 交付面叙述宜涵盖该跨域修复——非冲突，无行动项。

### I4（信息）— 验证面移交（SA7 证据迁移 + 落地后例行 CI）

SA7 38/38 动态断言（approve，验证对象即 `3fa05f4`）、SA4 记录的绿态因被测面逐字节
不变而构造性迁移到 rebase 后提交；rebase 落地后由实现流程照常跑一次 CI 确认即可
（属 SA4/SA7 面，非门禁义务）。

### I5（信息，iteration 4 特有）— 门禁资格终局闭合：可直接实施

三项失效条件（Y1 head 再移动 / Y2 新 Owner 评论 / Y3 决策集新提交）经本轮实时双源
取证全部未触发，iteration 0（前置）、1/2/3（rebase 路线）的 clear 结论对同一路线
连续有效并随本轮**终局闭合**：冲突门禁层面**无任何遗留义务**，rebase `3fa05f4` →
`31da1f0` 可直接交由实施流程执行。此后唯一需要再行冲突门禁的情形仍是上述三项失效
条件之一实际发生。

## 4. 结论

- **verdict：clear（eligible，终局确认）**。「`3fa05f4` rebase 到稳定权威 PR #305
  head `31da1f0`」的路线最终具备冲突门禁资格：文本 0 冲突（X1）；决策基准面（ADR
  全集 + CONTEXT.md + v1-spec + protocols）rebase 前后逐字节不变（X2/X4/X8）；新基线
  增量与 #308 触碰面要么零交集（X7），要么是同一 `memberDocs` 契约的只读共同消费方
  且行为不变量构造性共存（X5/X6）；母决策（ADR 0019 §7）明确期待本改动（X3）；
  姊妹票证据互认（X9）；路线前提时效性双源复核成立且三项失效条件全未触发
  （X10/Y1–Y3）；验证链证据（SA7 approve）在位且随被测面逐字节稳定而构造性迁移。
  **无任何 ADR、规范正文或架构层面的冲突阻塞该 rebase**。无需 override，无需设计
  修订，无遗留门禁义务。
- 冲突点数与分布：**0 阻塞 / 0 低 / 5 信息（I1 谱系引用、I2 规范中间态、I3 跨域
  tip 内容、I4 验证面移交、I5 门禁终局闭合）**；iteration 3 十项检查逐条复核仍一致，
  iteration 0–3 的全部信息项状态不变、无一被加重。
- `requiresConflictRecheck: false`——本 rebase 不新增任何决策记录触碰面；三轮 clear
  连同本终局结论对同一路线连续有效，除非 Y1–Y3 任一失效条件实际发生。
