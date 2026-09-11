# SA8 冲突门禁报告 — issue #308 rebase 复审（已提交实现 → 当前权威 PR #305 基线）

- Dispatch：`sa-02e2d9c7-669e-4176-b269-ee40b1148fb8`（mabf-sa8 / conflict-gate / iteration 1）
- 审查对象：把 `3fa05f4`（issue #308 已提交实现，"feat(vfsl): merge member docs into read projection"）
  rebase 到 `31da1f0`（`origin/docs/issue-304-vfsl-union-member-docs` tip = 当前权威 Parent PR #305 基线）
- 门禁类型：设计后复审（rebase 冲突门禁；总控指令限定「只报 conflict-gate 发现」）
- 裁决：**clear**（放行 rebase）—— **0 阻塞 / 0 低 / 3 信息项**；11 项检查逐条一致
- 冲突基准：`docs/adr/` 全集（17 份，0001–0012、0014、0016–0019；0013/0015 编号空缺，
  状态行全为「已接受」，无 superseded 文件）+ 根 `CONTEXT.md`。Issue #308 REST comments = `[]`
  （本轮任务简报确认），无附加 Owner 要求。
- 方法注记：全程只读（未改任何被跟踪文件、未动分支/工作树）；文本冲突用
  `git merge-tree --write-tree`（merge-base `4d4208b`）干跑判定，规范面稳定性用
  git 对象树逐字节比对判定。工作区技能目录无 `sa8-conflict-gate` 技能（已尝试加载，
  返回 unknown），按角色章程执行。固定证据已读：`wiki/raw/task_issue-308*.md` 全套 6 份
  （design / sa2_review / sa3_impl / sa4_review / sa6_contract / sa8_conflict）与
  新基线上的 `wiki/raw/task_issue-307*` 套件（含其冲突报告）。

## 1. Rebase 对象与前提事实

| 项 | 事实 | 出处 |
|---|---|---|
| 被重放提交 | `3fa05f4`（本 worktree HEAD，分支 `mabf/issue-308`）：`packages/vfsl/src/resolve-schema-at-path.ts` +41/−9、`docs/adr/0016` +20/−0（append-only 增补节）、3 份新增测试、6 份 wiki 证据 | `git show --stat 3fa05f4` |
| 旧基线（merge-base） | `4d4208b`（#306 M4 解析 + IR/derived `memberDocs`，经 PR #313 合入） | `git merge-base` |
| 新基线增量 ① | `31da1f0`（#322，实现 #307）：`packages/vfsl-codegen` 三文件（docs.ts/emitter.ts/valuetype.ts）+ 638 行 codegen 测试 + task_issue-307 证据套件。消费 `derived.memberDocs`（ADR 0019 §5/§6 四发射位），未触 `packages/vfsl`、未触任何 ADR | `git show --stat 31da1f0`；`git diff 4d4208b 31da1f0 -- packages/vfsl docs/adr CONTEXT.md docs/vfsl docs/protocols` = 空 |
| 新基线增量 ② | `f63b0a5`（root-lock owner 发布窗口竞态修复，消息尾注 (#305)）：`apps/yjs-server/src/lifecycle.ts` + 回归测试 + `docs/integration/hub-peer-deployment.md` 增补。与 vfsl 读投影零交集 | `git show --stat f63b0a5` |
| 文本合并结果 | `git merge-tree`（base `4d4208b` × `3fa05f4` × `31da1f0`）→ 干净树 `37a0f62`，**0 冲突路径** | 本轮实测（只读干跑） |
| 规范面逐字节稳定 | 合并结果树 vs 当前 HEAD：`packages/vfsl`、`docs/adr`、`CONTEXT.md` **全部差异为空**；rebase 全量 delta（17 文件 +2714/−21）恰为新基线两提交的内容本身 | `git diff 37a0f62 HEAD -- packages/vfsl docs/adr CONTEXT.md` |

**含义**：rebase 后，#308 已实现并经全套门禁（SA8 clear / SA2 approve / SA6 approve / SA4
approve，含 AC3 的 80 聚焦测试 + 包级 644 测试 + 根 typecheck 全绿记录）的全部代码面与
规范面**逐字节不变**；rebase 引入的唯一新内容就是新基线自身。因此本门禁的实质问题收窄为：
新基线增量是否与决策集（ADR 全集 + CONTEXT.md）冲突、是否与 #308 的触碰面发生语义互扰。

## 2. 逐项裁决（rebase 风险 vs 决策集）

| # | 检查项 | 事实与证据 | 裁决 |
|---|---|---|---|
| X1 | 文本合并冲突 | merge-tree 干跑 0 冲突；两侧文件集零交集（#308：vfsl/resolve-schema-at-path + 0016 ADR + task_issue-308*；新基线：vfsl-codegen + yjs-server + hub-peer-deployment.md + task_issue-307*） | ✅ 无冲突 |
| X2 | 规范面稳定性 | `4d4208b..31da1f0` 对 `packages/vfsl`、`docs/adr`、`CONTEXT.md`、`docs/vfsl`（v1-spec）、`docs/protocols` 的 diff 全空 → rebase 后这些面与已裁决实现逐字节相同，前序 SA2/SA4/SA6/SA8 结论原样可迁移 | ✅ 一致 |
| X3 | 母决策授权不变 | 新基线上 ADR 0019（2026-09-11，已接受）§7 即 #308 母决策，Consequences 原文点名 `resolve-schema-at-path.ts（sliceDocs 第三来源）`为本特性交付物——决策集**期待**该改动 | ✅ 一致 |
| X4 | ADR 0016 修订机制 | `3fa05f4` 对 0016 的修订 = append-only dated 增补节（+20/−0），授权链完整（0019 决策 7 显式修订 + issue 正文括注），正文一字未动——符合 docs/AGENTS.md「amend explicitly」、ADR 0008 dated 增补节先例与 SA2 F-SA2-1 收口形态；新基线未触 0016，增补节原样落位 | ✅ 一致 |
| X5 | `memberDocs` 契约双消费一致性 | #322（emitter.ts `memberDocsAt`，单点查键 `${path}.<member ${i}>`，缺席/空数组视同缺席）与 #308（sliceDocs 第三遍扫描，条件稀疏、缺席整遍跳过）**都只读消费**同一张 conditional-sparse 表（ADR 0019 决策 5），键文法与缺席语义两侧逐字同构；契约生产者（`packages/vfsl` 的 evaluate/derived）未被新基线触碰 → 无契约漂移、无双写 | ✅ 一致 |
| X6 | 「逐字节不变」不变量共存 | #308 AC（不使用 M4 的投影输出逐字节不变）与 #322 纪律（无成员 doc 生成物逐字节不变，ADR 0005 D3 纯发射器/D4 regen-diff freshness）作用于**不相交输出面**（readData 投影 vs 生成 TS），且同源于 0019 §5 条件稀疏性质 → 构造性共存，不互扰 | ✅ 一致 |
| X7 | 架构分层与兼容面 | 依赖单向 `vfsl-codegen → @nomicore/vfsl`（emitter.ts import 实测）；#308 零导出类型变化（interface 仅注释改动 + sliceDocs 内部函数）→ 新版 codegen 与新版 vfsl 组合无类型面风险；namespace-runtime 投影克隆器对 docs 表条目泛化深拷贝、零改动（ADR 0016「交付纪律」）；ADR 0016「typed-access 投影与 codegen 加法兼容（adapter 可忽略新字段，亦可在其后消费）」恰好预告 #322 的消费形态 | ✅ 一致 |
| X8 | root-lock 增量隔离 | `f63b0a5` 只触 `apps/yjs-server`（lifecycle/test）与 `docs/integration/hub-peer-deployment.md`（owner 发布窗口契约增补）；与 #308 面（vfsl 读投影 / ADR 0016 / wiki 证据）零文件、零依赖、零生命周期交集；hub-peer-deployment.md 属 integration 文档，不在 ADR+CONTEXT 冲突基准内，其条款亦与 #308 无任何相抵触处 | ✅ 一致 |
| X9 | superseded ADR 核查 | 全集状态行无 superseded（0007「Runtime/open/read 条款由 0008 部分取代」为运行时条款面，与 #308 读投影切片无交集）；ADR 0003 docs 表条款的修订链（0019 §5 条款级修订：三表→四表）在两侧树上文本一致 | ✅ 一致 |
| X10 | CONTEXT.md 词条 | 「语义 schema 投影」词条用表数不可知措辞（「文档注释表的相关切片」）；新基线未改 CONTEXT.md，四表化无需词条改动（前次 SA8 已核，状态不变） | ✅ 一致 |
| X11 | 姊妹票边界互认 | 新基线上的 #307 冲突报告（SA8，`sa-3ae26e00`）边界义务 B1 原文划界：「#307 = `packages/vfsl-codegen` only……readData docs 切片并入第三来源属 #308（ADR 0019 决策 7，涉 `resolve-schema-at-path.ts` 与 ADR 0016 修订）」——与 `3fa05f4` 实际触碰面逐项吻合，姊妹票证据互相背书，无越界、无认领冲突 | ✅ 一致 |

## 3. 发现项（均信息级，非冲突）

### R1（信息）— 既有固定证据的谱系引用将随 rebase 成为历史陈述

`task_issue-308` 套件内多处引用旧谱系（SA8 报告「截至本支 HEAD `4d4208b`」；SA2 报告
「HEAD `4d4208b`（实测核对）」；SA8 报告集成支描述「本支含设计提交 `91c4add` + #306 实现」）。
rebase 后 `3fa05f4` 换新 SHA、分支中部进入 `f63b0a5`+`31da1f0`，这些引用从「现状」变为
「写作时点事实」。docs/AGENTS.md 明示「Historical `wiki/raw/` artifacts are evidence, not
normative contracts」——**不构成冲突，不需要改写历史证据**；本报告即 rebase 后的门禁记录。
建议（可选）：rebase 提交信息里注明「证据文件引用的 HEAD/SHA 为 rebase 前谱系」，方便收官
审阅者对齐。

### R2（信息）— 集成支「实现先于规范正文」中间态保持，未被 rebase 加重

v1-spec §5 仍述三挂载锚位（`docs/vfsl` 在新基线上未动）；ADR 0016 正文两处旧措辞已由
`3fa05f4` 的增补节条款级修订记录覆盖（前次 F1 已闭环）。规范落地票 #309（blocked by
#306+#307+#308）与 PR #305 收官人工合并时的核对清单不变——rebase 既不消除也不加重该欠账。

### R3（信息）— 权威基线 tip 携带跨域内容（root-lock 修复）

PR #305 集成支在联合成员文档特性族之外携带 `f63b0a5`（apps/yjs-server root-lock 竞态修复，
消息尾注 (#305)）。按 Ticket Parent「同支累积、收官人工合并」惯例属预期形态；与 #308 的
冲突基准与触碰面均零交集（见 X8）。仅提示收官合并时 PR #305 的交付面将同时含该跨域修复，
scope 叙述宜涵盖之——非冲突，无行动项。

## 4. 结论

- **verdict：clear**。把 `3fa05f4` rebase 到 `31da1f0` 在文本、规范、架构三个层面均无冲突：
  文本 0 冲突（X1）；决策基准面（ADR 全集 + CONTEXT.md + v1-spec + protocols）rebase 前后
  逐字节不变（X2/X4/X9/X10）；新基线增量与 #308 触碰面要么零交集（X8），要么是同一
  `memberDocs` 契约的只读共同消费方且行为不变量构造性共存（X5/X6/X7），姊妹票证据互认
  （X11）。无需 override，无需设计修订。
- 冲突点数与分布：**0 阻塞 / 0 低 / 3 信息（R1 谱系引用、R2 规范中间态、R3 跨域内容）；
  11 项检查逐条一致**。
- 验证面移交：AC3（packages/vfsl 测试 + typecheck 绿）的已记录绿态（SA4：聚焦 80、包级
  644、根 typecheck exit 0）因 `packages/vfsl` 逐字节不变而构造性迁移；rebase 落地后由
  实现流程照常跑一次 CI 确认即可（属 SA4/SA7 面，非门禁义务）。`requiresConflictRecheck:
  false`——本 rebase 不新增任何决策记录触碰面。
