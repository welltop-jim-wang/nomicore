# SA8 冲突门禁报告 — issue #308 rebase 最终授权证据确认（iteration 5 · final confirmation）

- Dispatch：`sa-4259b40f-bdb8-4d96-a877-92991c4f2840`（mabf-sa8 / conflict-gate / iteration 5）
- 审查路线：对已四轮成立（iteration 0 `sa-d1327417` 前置 clear、iteration 1 `sa-02e2d9c7`
  clear、iteration 2 `sa-b11193b6` clear、iteration 3 `sa-cf8e48c6` clear、iteration 4
  `sa-a9c5b071` clear/eligible 终局闭合）的 rebase 路线做**最终授权证据确认**——把
  issue #308 已批准提交 `3fa05f4`（`feat(vfsl): merge member docs into read projection`）
  rebase 到当前权威 Parent PR #305 head `31da1f0`
  （`origin/docs/issue-304-vfsl-union-member-docs` tip）。
- 门禁类型：终局授权证据复核（总控指令限定「只报 conflict-gate 发现，不实施」；本轮
  指令陈述：Issue #308 REST comments = `[]`，无附加 Owner 要求——已独立实测确认）。
- 裁决：**clear / authorized**（该 rebase 路线的最终授权证据完整、闭合且实时有效）——
  **0 阻塞 / 0 低 / 4 信息项**；iteration 3 十项检查（X1–X10）经本轮实时取证逐条复核
  仍一致，iteration 4 终局闭合所依赖的三项失效条件（Y1–Y3）**全部未触发**。
- 冲突基准：`docs/adr/` 全集（17 份：0001–0012、0014、0016–0019；0013/0015 编号空缺，
  状态行全为「已接受/accepted」，零 superseded 文件）+ 根 `CONTEXT.md`；规范正文扩展面
  （`docs/vfsl` v1-spec、`docs/protocols/instance-replication-v1.md`）一并核稳。
- 方法注记：工作区技能目录无 `sa8-conflict-gate` 技能（本轮再次尝试加载，返回
  unknown），按角色章程执行。全程只读：未改任何 tracked 文件、未动分支/工作树/stash、
  未实施 rebase；文本冲突用 `git merge-tree --write-tree --merge-base=4d4208b`（只写
  匿名 tree 对象）干跑判定；基线新鲜度用**实时 `git fetch origin` + `gh pr view 305`
  （headRefOid）**双源确认；Issue 需求面用 `gh api …/issues/308/comments`（REST 长度）
  与 `gh issue view 308`（updatedAt/labels）独立复核；PR 讨论面（reviews/comments）加查。
  本报告为唯一产出文件（iteration 0–4 报告保持原样，作为历史证据不覆写）。

## 1. 路线前提事实（iteration 5 实时独立重取）

| 项 | 事实 | 出处（本轮实测） |
|---|---|---|
| 被重放提交 | `3fa05f4`（`3fa05f4b079ea6f91ecda6e31e30c7ae7056fe9e`，worktree HEAD，分支 `mabf/issue-308`，tracked 树干净，仅 untracked wiki/raw 证据文件）：11 文件 +2115/−9——`packages/vfsl/src/resolve-schema-at-path.ts` +50/−9、`docs/adr/0016` +20/−0（numstat 实测：零删除行 ⇒ append-only 增补节）、3 份新增测试、6 份 wiki 证据 | `git rev-parse HEAD`；`git status --porcelain`；`git show --stat/--numstat 3fa05f4` |
| 当前权威 PR #305 head | `31da1f0`（`31da1f08dc168837523d5b314c9b12c5a89c1a91`）——本轮实时 `git fetch origin` 后 remote-tracking tip 即此，`gh pr view 305` headRefOid 与之**逐字节相同**；PR OPEN | `git rev-parse origin/docs/issue-304…`；`gh pr view 305 --json headRefOid,state` |
| 基线无漂移 | iteration 1–4 所裁决的基线即当前基线：`4d4208b..31da1f0` 恰 2 增量（`31da1f0` #322 codegen、`f63b0a5` root-lock 修复）原样，无新提交加入 → **四轮 clear 结论均未失效** | `git log --oneline 4d4208b..31da1f0` |
| Issue 需求面 | REST comments 长度实测 **0**（`[]`，与总控指令陈述逐字一致）；issue OPEN、updatedAt `2026-09-11T06:53:35Z` 与 iteration 3/4 记录**逐字节相同**（正文未被编辑）；labels `in-progress`/`feature` 无新增 → AC1–AC3 即需求全集 | `gh api …/issues/308/comments`；`gh issue view 308` |
| PR 讨论面 | PR #305 `reviews: []`、`comments: []`；updatedAt `2026-09-11T07:51:04Z` 与 iteration 4 记录相同 → 无任何 PR 级新增要求 | `gh pr view 305 --json reviews,comments,updatedAt` |
| 文本合并干跑 | merge-tree（base `4d4208b` × `3fa05f4` × `31da1f0`）exit 0 → 干净树 `37a0f621a87754aded4222b2c9b9b5fe7a77e607`，**0 冲突路径、0 冲突消息**，树 OID 与 iteration 1/2/3/4 所得**逐字节相同** | 本轮复跑 `git merge-tree --write-tree` |
| 两侧文件集零交集 | `3fa05f4` 触碰 11 文件 ∩ `4d4208b..31da1f0` 增量触碰 17 文件 = **空**（`comm -12` 输出空）：#308 面为 vfsl/resolve-schema-at-path + 0016 ADR + 3 测试 + task_issue-308 证据；增量面为 vfsl-codegen 三源文件 + codegen 测试 + apps/yjs-server + hub-peer-deployment.md + task_issue-307 证据 | `comm -12`（输出空） |
| 决策基准面稳定性 | 基线增量对 `docs/adr`/`CONTEXT.md`/`docs/vfsl`/`docs/protocols`/`packages/vfsl` 的 diff **全空**；合并结果树 vs `3fa05f4` 在同面 diff 亦**全空** → rebase 后决策集与全套前序门禁所裁决对象**逐字节相同** | `git diff --stat`（双向均 0 行） |
| ADR 状态面 | 全集 17 份状态行全为「已接受/accepted」（0003 带 2026-08-19 修订注记，属正文修订节非取代；0007「由 0008 部分取代」为运行时条款面，与 #308 零交集）；`grep -li superseded` 命中 **0** 文件——与 iteration 2/3/4 X8 核查一致 | `ls docs/adr/*.md \| wc -l`；状态行逐份实测 |
| 母决策授权 | ADR 0019（已接受）§7「readData 语义投影切片并入（修订 ADR 0016）」明确给出 #308 的交付语义：`docs[k] = [...fieldDocs[k], ...markerDocs[k], ...memberDocs[k]]`、选键规则不变、`<member N>` 路径落在既有规则内——决策集**期待** #308 的改动 | `docs/adr/0019-vfsl-union-member-docs.md` §7 |
| 验证链证据在位 | SA7 报告 `wiki/raw/task_issue-308_sa7_report.md`（dispatch `sa-b9ae6a65`，**approve**，38/38 动态断言全绿，验证对象即本 HEAD `3fa05f4`，上游 SA6 契约 approve / SA4 实现审查 approve 0-0-0，Issue comments `[]`）存在且头部信息与本轮引用一致 | 文件实测（`head -32`） |
| 前置阻塞 | #306（M4 解析 + IR/derived `memberDocs`）仍 **CLOSED**——前置持续满足 | `gh issue view 306 --json state` |

**含义**：权威 head 自 iteration 1 以来四次独立取证实测未移动、被重放提交未变、需求面
未增、PR 讨论面为空——本路线与 iteration 1–4 所裁决对象是**同一组 git 对象**
（`3fa05f4` × `31da1f0` × merge-base `4d4208b` ⇒ 干净树 OID 逐字节复现）。iteration 3
I5 设定、iteration 4 复核的再门禁触发条件（Y1–Y3），本轮第三次实时取证**一项都未发生**。

## 2. 逐项裁决

### 2.1 失效条件核查（iteration 3 设定、iteration 4 复核，本轮第三次实时取证）

| # | 失效条件 | 本轮实测 | 裁决 |
|---|---|---|---|
| Y1 | PR #305 head 再移动 | 实时 fetch 后 remote tip 仍 `31da1f0`；`gh pr view 305` headRefOid 逐字节相同；PR OPEN | ✅ 未触发 |
| Y2 | issue #308 出现新 Owner 评论 | REST comments 实测长度 0（`[]`）；issue updatedAt 与 iter3/4 记录逐字节相同（正文未编辑）；labels 无新增 | ✅ 未触发 |
| Y3 | 决策集（ADR/CONTEXT.md）发生新提交 | 基线仍恰 2 增量且对决策面 diff 全空；`31da1f0` 树即 iter3/4 已裁决树（同 OID ⇒ 同树）⇒ 决策集逐字节未变 | ✅ 未触发 |

### 2.2 十项检查连续性复核（沿袭 iteration 3 编号；关键项本轮重取实测，其余经对象同一性构造性成立）

| # | 检查项 | 本轮复核 | 裁决 |
|---|---|---|---|
| X1 | 文本合并冲突 | 干跑 exit 0、0 冲突路径、干净树 `37a0f621`（与 iter1–4 同 OID）；两侧文件集交集实测为空 | ✅ 无冲突 |
| X2 | 决策基准面稳定性 | 双向 diff（增量对决策面、合并树 vs `3fa05f4` 对决策面）均空；CONTEXT.md「语义 schema 投影」词条随树逐字节不变 | ✅ 一致 |
| X3 | 母决策授权 | ADR 0019（已接受）§7 命名 readData 语义投影切片并入并修订 ADR 0016——决策集期待 #308 的改动（本轮重读 §7 原文核对） | ✅ 一致 |
| X4 | ADR 0016 修订机制 | `3fa05f4` 对 0016 numstat = +20/−0（零删除 ⇒ append-only dated 增补节），授权链完整（0019 决策 7 显式修订 + issue 正文括注），正文一字未动；新基线未触 0016 | ✅ 一致 |
| X5 | `memberDocs` 契约双消费 | #322（codegen `memberDocsAt` 四发射位）与 #308（sliceDocs 第三来源）均为同一 conditional-sparse 表的只读消费方（ADR 0019 §5/§7），生产者 `packages/vfsl` 未被新基线触碰 | ✅ 一致 |
| X6 | 「逐字节不变」不变量共存 | #308 AC2（M4-free 投影输出不变）与 #322 纪律作用于不相交输出面（readData 投影 vs 生成 TS），同源于 0019 §5 条件稀疏性质 | ✅ 一致 |
| X7 | root-lock 增量隔离 | `f63b0a5` 只触 `apps/yjs-server` + `docs/integration/hub-peer-deployment.md`（本轮文件集实测复核），与 #308 触碰面零文件/零依赖/零生命周期交集；integration 文档不在 ADR+CONTEXT 冲突基准内 | ✅ 一致 |
| X8 | superseded / 取代关系核查 | 17 份全为「已接受/accepted」，`superseded` 关键词零命中；0003/0007 注记均为非取代性（修订节 / 运行时条款面，与 #308 零交集） | ✅ 一致 |
| X9 | 姊妹票边界互认 | 冻结于 `31da1f0` 的 #307 冲突报告随树 OID 逐字节不变（构造性成立）；其 B1 划界与 `3fa05f4` 实际触碰面吻合（readData docs 切片并入第三来源属 #308：0019 决策 7、resolve-schema-at-path.ts、0016 修订） | ✅ 一致 |
| X10 | 路线前提时效性 | 权威 head（fetch + gh 双源）、被重放提交、merge-base、Issue comments 空集、issue 正文 updatedAt、PR 讨论面双空——全部与 iter1–4 裁定时点一致 | ✅ 一致 |

## 3. 发现项（均信息级，非冲突）

### I1（信息）— 最终授权证据链闭合清单

「`3fa05f4` → `31da1f0`」rebase 的授权证据由五个环节构成，本轮逐一在位且实时复核：
①需求面（issue #308 AC1–AC3，REST comments `[]`）；②决策面授权（ADR 0019 §7 母决策
+ 0016 append-only 增补节 + 17 ADR 全 accepted 零 superseded）；③验证面（SA7 approve
38/38，对象即 `3fa05f4`；上游 SA6/SA4 approve）；④前置面（#306 CLOSED）；⑤对象面
（双源 head OID 一致、干跑 0 冲突、决策面双向 diff 空、两侧文件集零交集）。链条完整，
无缺环。

### I2（信息）— 谱系引用时效与历史计数勘误

`task_issue-308` 套件多处引用旧谱系（`4d4208b` 基线、rebase 前 SHA）；docs/AGENTS.md
明示「Historical `wiki/raw/` artifacts are evidence, not normative contracts」——不构成
冲突，不改写历史证据。另记一处**无害计数勘误**：iteration 4 报告称 `3fa05f4` 含
「7 份 wiki 证据」，本轮 `--stat` 实测为 **6 份**（11 文件总数两侧报告一致）；该差异
不影响任何检查项（两侧文件集交集在任一口径下均为空）。建议（可选）：rebase 提交信息
注明证据文件引用的 HEAD/SHA 为 rebase 前谱系。

### I3（信息）— 验证面移交（SA7 证据迁移 + 落地后例行 CI）

SA7 38/38 动态断言（approve，验证对象即 `3fa05f4`）、SA4 记录的绿态因被测面
（`packages/vfsl` + `docs/adr` + 测试）在 rebase 前后逐字节不变而**构造性迁移**到
rebase 后提交；rebase 落地后由实现流程照常跑一次 CI 确认即可（属 SA4/SA7 面，
非门禁义务）。

### I4（信息）— 门禁资格维持闭合：可直接实施，唯 Y1–Y3 可再开

三项失效条件（Y1 head 再移动 / Y2 新 Owner 评论 / Y3 决策集新提交）经本轮（iteration 5）
实时双源取证**全部未触发**，iteration 0（前置）与 1–4（rebase 路线）的 clear 结论对
同一路线连续有效：冲突门禁层面**无任何遗留义务**，rebase `3fa05f4` → `31da1f0` 可直接
交由实施流程执行。此后唯一需要再行冲突门禁的情形仍是上述三项失效条件之一实际发生。

## 4. 结论

- **verdict：clear（authorized，最终授权证据确认）**。「`3fa05f4` rebase 到当前权威
  PR #305 head `31da1f0`」的最终授权证据经本轮实时独立取证完整闭合：文本 0 冲突、
  干净树 OID 与前四轮逐字节复现（X1）；决策基准面（ADR 全集 + CONTEXT.md + v1-spec +
  protocols）rebase 前后逐字节不变（X2/X4/X8）；新基线增量与 #308 触碰面零交集
  （X5–X7）；母决策（ADR 0019 §7）明确期待本改动（X3）；姊妹票证据互认（X9）；
  路线前提时效性双源复核成立且三项失效条件全未触发（X10/Y1–Y3）；验证链证据
  （SA7 approve）在位且随被测面逐字节稳定而构造性迁移。**无任何 ADR、规范正文或
  架构层面的冲突阻塞该 rebase**。无需 override，无需设计修订，无遗留门禁义务。
- 冲突点数与分布：**0 阻塞 / 0 低 / 4 信息（I1 授权链闭合清单、I2 谱系引用 +
  历史计数勘误、I3 验证面移交、I4 门禁维持闭合）**；iteration 3 十项检查逐条复核
  仍一致，iteration 0–4 的全部发现项状态不变、无一被加重（iteration 4 的「7 份 wiki
  证据」计数勘误见 I2，属记录层非门禁层）。
- `requiresConflictRecheck: false`——本 rebase 不新增任何决策记录触碰面；五轮 clear
  连同本最终确认对同一路线连续有效，除非 Y1–Y3 任一失效条件实际发生。
