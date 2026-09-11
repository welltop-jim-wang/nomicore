# SA10 Spec 审查 — issue #306（M4 联合成员文档注释：解析挂载 + IR/derived `memberDocs`）

- **Dispatch**: sa-651741f1-9659-4a7b-af15-7ca3b65681a2（mabf-sa10 / spec-review / iteration 0）
- **审查对象**: 最终已提交 diff `91c4add..78b2bdd`（branch `mabf/issue-306`，HEAD `78b2bdd`「feat(vfsl): attach documentation to union members」）；base `91c4add` = Parent PR #305 权威 head（dispatch 明示已 fetch 并保持 `91c4addab4493cd9c3333d2ee17590d718ead23e`，与提交前 base 一致，本审查经 `git log` 独立复核成立）
- **Owner feedback**: issue #306 无适用评论（dispatch「REST comment read returned an empty array」；SA6 §2 / SA8 两报告 / SA2 / SA4 / SA7 六方独立复核一致）→ 需求面 = issue 正文 What-to-build + AC1~AC6
- **Verdict**: **approve**（AC1~AC6 全部满足；ADR 0019 决策 1/2/3/4/5/8/9.3/10 逐条落实；无遗漏、无部分实现、无错误实现、无 scope creep；PR 必须披露的未达成项见 §6）

---

## 1. 审查输入

| 输入 | 状态 |
| --- | --- |
| `wiki/raw/task_issue-306.md`（Host 简报：issue 正文 + AC1~AC6） | 已读 |
| `wiki/raw/task_issue-306_design.md`（SA1 设计，§7 D1~D7 / §11 ALLOW-DENY） | 已读 |
| `wiki/raw/task_issue-306_sa6_contract.md`（批准验收契约：19 用例、金样本六值、E-1~E-5） | 已读 |
| `wiki/raw/task_issue-306_sa3_impl.md` / `sa4_review.md` / `sa7_report.md`（均 approve） | 已读 |
| `wiki/raw/task_issue-306_sa2_review.md` / `task_issue-306_design_conflict_report.md` / `.scratch/sa8-conflict-report-issue-306.md`（均 clear/approve） | 已读 |
| `docs/adr/0019-vfsl-union-member-docs.md`（规范权威，已接受、未被取代；显式修订 ADR 0003 docs 表条款） | 已读，决策逐条对照 diff |
| 提交 diff（5 源文件 + 3 测试文件 + 7 wiki 产物，2048 insertions / 14 deletions） | 逐行核读 |
| SA3 证据日志 `.scratch/sa3-{red-baseline,contract-green,pkg-vfsl-run,root-typecheck}.log` | 已核（本角色不运行测试，以留存证据 + 静态复核为准） |

## 2. Issue 正文与 AC 逐条验收

| 要求 | 实现落点（committed diff） | 裁决 |
| --- | --- | --- |
| doc 紧邻 `\|` 之前挂后继成员 | `parser.ts` `recordPipeAnchor()`（`\|` next() 后记录尾部区间 + DocLead 引用）；`parseUnionType` 前导 `\|` 与分隔 `\|` 两处调用 | ✅ met（契约用例 1/3 绿） |
| 首成员无前导 `\|` 时挂成员起始记号 | `recordStartAnchor()`（peek 记号 `leadDocs ?? []` + 消费前下标快照） | ✅ met（用例 2 绿；SA7 探针补证 `{`/`Record<` 非字面量起始两形态） |
| 连续多条 doc 按序同挂一成员 | tokenizer pending 零改动 + 结算整段逐字挂载 | ✅ met（用例 4 逐字 `toEqual` 绿） |
| IR 条件 `memberDocs` 键，与 members 等长对齐 | AST 必填等长（`parser.ts:43` 变体）；`semantic.ts` `some(d=>d.length>0)` 条件展开，键序 kind→members→memberDocs | ✅ met（用例 5/6 绿） |
| derived 条件稀疏 `memberDocs` 表，`<member N>` 键 | `derived.ts` 可选键 + 差异注；`evaluate.ts` DocsTables 第四表、`walkDocs` 收非空条目、第八键居末条件展开 | ✅ met（用例 12/13/14 绿） |
| 单成员坍缩维持 E305 | `members.length === 1` 早退不结算 → doc 留 dangling → E305 @(2,10) 逐字节维持 | ✅ met（用例 8 绿） |
| `\|` 夹缝 doc：非标记 E305 / 标记按 M3 不双挂 | 夹缝 doc 不入 A/B 记录；M3 抢先回收 → 结算引用失配 → 该成员 `[]`（不双挂） | ✅ met（用例 7/9/10 绿） |
| E305 消息措辞补「联合成员」 | `semantic.ts:76` 正文枚举追加，前缀 `VFSL-E305: ` 冻结 | ✅ met（用例 11 `/联合.{0,6}成员/` 绿） |
| 纯文档性质，不进校验与物化 | `validate.ts`/`validate-patch.ts`/物化路径零改动（diff name-only 复核为空）；契约用例 15 七路全等 | ✅ met |
| **AC1** 两布局 + 连续 doc | 上四项 | ✅ met |
| **AC2** 坍缩/夹缝维持 + M3 不双挂 | 上三项 | ✅ met |
| **AC3** derived 条件稀疏（`<member N>` 逐字收集 / 无 doc 模块不含键） | evaluate 测试用例 1~3 | ✅ met |
| **AC4** 存量 IR JSON 与 semantic 指纹逐字节不变（`sha256:v1:` 前缀不变） | 金样本 A/B 六常量（IR sha `325cf923…f3ffc`/`78332590…be71`、指纹 `b71be76e…0631c`/`55095e88…144d`、derived sha `2335a023…375b`/`547748b6…492f`）与 SA6 §12 录制值逐字节一致；契约断言含前缀与「JSON 不含 memberDocs 串」 | ✅ met（SA7 另以 15 语料 A/B baseline 逐字节相等动态补强） |
| **AC5** 手造 IR 畸形（非等长数组的数组）→ ok:false E100 | `guardMemberDocs()`：在场非「等长数组的数组」→ TypeError → 顶层 catch → 恰一条 E100、无 derived；缺席合法；4 类畸形 + 良性正控全覆盖 | ✅ met（用例 16/17 绿） |
| **AC6** `packages/vfsl` 包测试与 typecheck 绿 | SA3 日志：契约 19/19 绿（`sa3-contract-green.log`）、包 34 files / 619 tests 全绿（`sa3-pkg-vfsl-run.log`）、`tsc -p packages/vfsl/tsconfig.json` + 根 `pnpm typecheck` 14 tsconfig 链 exit 0（`sa3-root-typecheck.log`）；SA7 复跑一致 | ✅ met（证据留存，本角色不重跑） |

## 3. 规范符合性（ADR 0019 逐决策）

| ADR 0019 决策 | 符合性 |
| --- | --- |
| 1（M4 两锚位子规则 + 连续 doc + 夹缝不属 M4） | ✅ 逐子句落实（§2 前四行） |
| 2（坍缩维持 E305，逐字节一致） | ✅ 早退不结算；锚点/前缀冻结 |
| 3（M3 优先不双挂，冻结约束） | ✅ 引用同一性核对实现「M3 已回收 → M4 放弃」；双向断言（marker 恰一次 + 成员表不含） |
| 4（IR 条件键强制项；AST 必填等长；记录位置+终局核对、≥2 成员、逆序、引用同一性、核对失败=M3 已回收、坍缩不回收） | ✅ 机制六要素逐要素在场；`ir.ts` 指纹纪律注在场；`sha256:v1:` 不升级、D2 触发器不命中 |
| 5（derived 条件稀疏表，显式修订 ADR 0003；手造 IR loud 边界） | ✅ 类型注常态写明与三表差异；守卫与 put/appendDocs 同族、缺席合法的有意不对称符合明文边界 |
| 8（纯文档性质） | ✅ validate/物化零读取零改动 |
| 9.3（E305 正文枚举补「联合成员」，前缀冻结） | ✅ 全仓既有断言仅前缀正则，无正文锁定（SA2/SA4 已 grep 复核） |
| 10（不改 tokenizer 侧通道；不为坍缩发明挂载目标；不在校验回带成员 doc） | ✅ tokenizer.ts diff 为空；坍缩不结算；validate 零改动 |
| 6/7（codegen 四发射位 / 投影第三来源） | 出 #306 范围 → #307/#308（SA8 C-5 中间态豁免；见 §6 披露项 1） |

## 4. 范围与契约完整性

- **文件范围**：生产改动恰为设计 §11 ALLOW LIST 五条（`parser.ts` +100/-7、`ir.ts`、`semantic.ts`、`derived.ts`、`evaluate.ts`）；DENY LIST 全量未触碰（`git diff 91c4add..78b2bdd --name-only` 对 tokenizer/fingerprint/validate*/resolve/shapes/resolve-schema-at-path/index/envelope/schemasource/docs/vfsl-codegen/tests/domains 复核为空）。测试改动恰为 SA6 冻结契约三件（新增 = 验收交付物）。**无 scope creep。**
- **契约零软化**：工作树与 HEAD 一致（`git diff HEAD` 空）；三个测试文件无 `skip/only/todo`（grep 0 命中）；金样本六常量与 SA6 §12 逐字节一致（未重录）；红灯基线日志（实现 stash 剥离后 12 failed / 7 passed，失败集合逐条 = SA6 §13 红表）证明断言对「无实现」真红、非恒真。
- **SA2/SA4/SA7 finding 核销**：SA2 O-1~O-5、SA8 复查 O-1/O-2 实现红线、SA4 N-1~N-4 全部已核销或登记为不阻断观察；残留项（N-1 全仓 test、N-2 B 锚非字面量起始显式用例）经 SA7 动态落证/路由，见 §6。

## 5. 未发现项（reject 判据逐项排查）

- 无关键 AC partial / unmet / unachievable；
- 无错误实现（M4 机制经 SA2 15+ 对抗场景独立重推、SA4 六条独立重推、SA7 211 项探针断言三路交叉验证；本审查对 diff 逐行复核与设计伪代码逐要素一致）；
- 无静默丢 doc / 双挂 / 假 E305 通道（`claimed + dangling.length === docTotal` 不变量保持，失败模式恒 loud）；
- 无对冻结行为面的未授权变更（存量 IR/derived/指纹逐字节稳定由构造性条件附加 + 金样本双重锁定；E305 触发面只缩小；无新错误码）。

## 6. PR 必须披露的未达成项（不阻断 approve）

1. **#307 / #308 / #309 不在本票交付面**（SA8 C-5 预期中间态）：codegen 四发射位与 `generate --check`、`resolveSchemaAtPath` docs 切片 memberDocs 第三来源、v1-spec §5 / schema-authoring-guide / 检查表 / `tests/acceptance/vfsl_spec_acceptance.py` 的「三锚位」措辞同步——均由 Parent PR #305 之下的姊妹票承接，PR #305 收官清单须含三者；当前 v1-spec §5 仍写三锚位（预期中间态，非缺陷）。
2. **`evaluate` 失败语义的有授权扩展**：手造 IR 携畸形 `memberDocs` 由「静默忽略 ok:true」变为「ok:false 恰一条 E100、无 derived」（ADR 0019 决策 5 明文授权；生产链路 IR 恒为 parseVfsl 产物，构造性不可达畸形）。
3. **根 `pnpm test` 全仓未在本票运行**（SA4 N-1 / SA7 偏差 1）：`packages/vfsl/AGENTS.md` 建议公共类型变更时跑根 typecheck + test；本票公共类型为加性可选键，根 14 tsconfig typecheck exit 0、包 619 绿、定向跨包消费方（vfsl-codegen/doc-runtime/namespace-runtime）798 绿作为替代证据，全仓分片留 CI。issue AC6 验收面（包测试 + typecheck）已满足，此项属流程披露。

## 7. 结论

**approve**。已提交 diff 忠实满足 issue #306 正文与 AC1~AC6、ADR 0019 授权面全部适用决策与 SA6 批准验收契约；无遗漏、无部分实现、无错误实现、无 scope creep；§6 三项为 PR 披露义务而非缺陷。

— SA10（Spec Reviewer），唯一产物为本文件（未修改任何代码/设计/测试，未运行测试/服务，未 commit/push/建 PR）。
