# SA9 标准审查 — issue #308 最终 rebase 交付（readData 语义投影 docs 切片并入 memberDocs）

- Dispatch：`sa-021c5f64-762a-4ab6-8228-44a716fc1651`（mabf-sa9 / standards-review / iteration 0）
- 审查对象：最终 rebase 交付 = HEAD `154dd2cfe500a1908dce2e972d67f6f6ee40875d`（`feat(vfsl): merge member docs into read projection`），基线 = 权威 Parent PR #305 head `31da1f08dc168837523d5b314c9b12c5a89c1a91`（`origin/docs/issue-304-vfsl-union-member-docs` tip，与 Host 声明逐字节一致）
- Issue REST comments：`[]`（无 Owner 附加要求，与简报/SA6/SA8 多重一致）
- 裁决：**approve** —— 0 BLOCKER / 0 MAJOR / 0 MINOR 阻断项；4 项非阻断观察（§8）。实现符合仓库 AGENTS、ADR、模块责任、既有架构惯例、单一事实源、生命周期对称性、文件范围与测试质量标准。

---

## 1. Reviewed inputs

| 输入 | 位置 | 状态 |
|---|---|---|
| 任务简报（Issue #308 body） | `wiki/raw/task_issue-308.md` | 已读（AC1–AC3 + 「修订 ADR 0016 切片条款」括注） |
| SA1 设计（iteration 1） | `wiki/raw/task_issue-308_design.md` | 已读（D1–D8、§10/§11/§12） |
| SA2 设计评审 | `wiki/raw/task_issue-308_sa2_review.md`（approve，F-SA2-1 已闭环） | 已读 |
| SA3 实现报告 | `wiki/raw/task_issue-308_sa3_impl.md` | 已读（含 4 项如实记录的实现期偏差） |
| SA4 实现审查 | `wiki/raw/task_issue-308_sa4_review.md`（approve 0-0-0） | 已读 |
| SA6 验收契约 / SA8 冲突门禁 | `wiki/raw/task_issue-308_sa6_contract.md` / `task_issue-308_sa8_conflict.md`（clear） | 已读 |
| SA7 动态验证 | `wiki/raw/task_issue-308_sa7_report.md`（approve，38/38） | 已读（验证对象 = rebase 前 `3fa05f4`） |
| rebase 冲突门禁 | `task_issue-308_rebase_sa8_conflict{,_iter2..5}.md`（iter5 = clear/authorized 终局确认） | 已读 |
| 实际交付 diff | `git diff 31da1f0..HEAD`（11 文件，+2115/−9） | 本轮独立全量核对 |
| 规范基准 | 根 `AGENTS.md`、`packages/vfsl/AGENTS.md`、`docs/AGENTS.md`、`CONTEXT.md`、ADR 0016（118 行含新增节）、ADR 0019（§5/§7 逐字）、`vitest.config.ts`、`packages/vfsl/tsconfig.json`、`.github/workflows/ci.yml`、`scripts/ci-test-shard.mjs` | 已读/实测 |

## 2. Verdict

**approve**。理由五线：

1. **Rebase 忠实性（本轮独立实测）**：交付补丁 rebase 前后逐字节相同——`diff <(git diff 4d4208b..3fa05f4) <(git diff 31da1f0..154dd2c)` 输出为空；基线增量（`4d4208b..31da1f0` = #307 codegen + root-lock 修复）对 `packages/vfsl`、`packages/namespace-runtime`、`docs/adr`、`CONTEXT.md`、`docs/vfsl`、`docs/protocols` 的 diff **全空**。SA3/SA4/SA7 在 `3fa05f4` 上取得的验证证据对被测面构造性迁移到 `154dd2c`（SA8 iter5 I3 同判）。冻结摘要（录制于 `4d4208b`）的语义基线未被基线增量扰动。
2. **ADR/规范面合规**：ADR 0016 回写为末尾 append-only dated 增补节（`git diff --numstat` = `20 0` 零删除行、`git diff --check` 干净），节内三条款「旧文 → 新文」引文与正文 L35/L42 逐字吻合（本轮实测比对），授权链（ADR 0019 决策 7 + issue 正文括注）与保持句（含「考虑的备选为决策时历史记录」声明）齐备——与全库条款级修订惯例（`6155b51` 对 0008、`2d9dce7` 对 0007、0007 L68–69 模式句）同构，满足 docs/AGENTS.md「Amend or supersede prior decisions explicitly」。增补节条款与 ADR 0019 §5/§7 原文逐条语义一致（本轮重读 §5/§7 对账）。
3. **模块责任与边界**：改动落在事实 Owner（vfsl resolver `sliceDocs`，ADR 0019 §7 明列改动面）；`packages/namespace-runtime/**`、`derived.ts`、`index.ts`、可信域必填六键清单（L109–120）零触碰（diff 实测）；新 `InternalError` 守卫属 packages/vfsl AGENTS.md 的 ADR 0016 可信域例外句既有通道（复用 `./resolve.js` 既有导入，L34），不进结果联合、不降级码——未引入新失败语义类别；公共 API 零新增（无新导出、四件套形状不变）。
4. **文件范围**：交付 commit 内 5 个非 wiki 文件全部落在设计 §11 ALLOW 五行内（1 源码 + 1 ADR + 3 测试）；DENY 全量零触碰；commit 内嵌 6 份 wiki 证据与仓库惯例一致（`wiki/raw` 1097 份 tracked task 工件；#307 交付同形态）。
5. **测试质量**：两份新 `.test.ts` 全部经公共入口 `parseVfsl → evaluate → resolveSchemaAtPath` 断言运行时行为（`toEqual`/`toThrow`/JSON 序列化/sha256 对账），无 skip/only/todo（grep 实测）、无源码字符串断言；fixture 为纯数据（非 `.test.ts`，由包 tsconfig `test/**/*.ts` 覆盖类型检查）；vitest include `packages/*/test/**/*.test.ts` 与 CI shard 脚本（`scripts/ci-test-shard.mjs` 动态枚举全仓 `*.test.ts`）必然收集；红灯基线（13 failed）→ 实现后（25 passed）转绿证据在案，负控 C1–C9 实现前后均绿符合契约性质。

## 3. AGENTS / 模块契约核对

| 标准 | 证据 | 裁决 |
|---|---|---|
| 根 AGENTS.md：模块变更前读最近嵌套 AGENTS.md | packages/vfsl/AGENTS.md 与 docs/AGENTS.md 已纳入本轮审查基准 | ✅ |
| packages/vfsl：同步、确定性；公共畸形输入走可判别结果 | `sliceDocs` 纯同步零 memo；`path` 敌意通道两码结果联合不动 | ✅ |
| packages/vfsl：可信域例外（ADR 0016）——畸形 derived throw `InternalError`，不进结果联合 | D4 窄守卫（在场且 null/非对象/数组 → `InternalError`）；缺席 = 合法形状整遍跳过；不加必填键清单（SA8 F3.1 红线遵守） | ✅ |
| packages/vfsl：公共 API 只经 `src/index.ts` | `index.ts` 零改动；`merged`/守卫均为函数内局部，零新增公共符号 | ✅ |
| packages/vfsl 验证门槛：聚焦变更跑包级 typecheck + VFSL 测试 | SA3 证据：6 files/80 tests（--typecheck 无类型错误）、`tsc -p packages/vfsl` exit 0、根 `pnpm typecheck`（14 tsconfig）exit 0、全包 36 files/644 tests、namespace-runtime 投影 21 tests；公共类型未变，门槛满足（SA9 依规不 rerun） | ✅ |
| docs/AGENTS.md：显式修订而非静默矛盾；行为变更同步规范文档 | ADR 0016 append-only 增补节（显式、dated、逐条登记）；v1-spec §5 滞后属 #309 收官面（SA8 F2 明示的集成支中间态设计）；CONTEXT.md「文档注释表的相关切片」为表数不可知措辞，四表化无需改（本轮实测 L41–42） | ✅ |
| docs/AGENTS.md 验证：`git diff --check` | 交付 diff 干净（本轮实测 exit 0） | ✅ |

## 4. ADR 一致性核对

| 检查项 | 结果 |
|---|---|
| 增补节 vs ADR 0019 §7（母决策） | 三来源并入、`docs[k] = [...fieldDocs[k], ...markerDocs[k], ...memberDocs[k]]`（member 末位）、选键不变、空过滤不变、四件套不变、detached 克隆零改动——逐字一致 |
| 增补节 vs ADR 0019 §5（条件稀疏） | 条款 2「memberDocs 条件稀疏（在场时只含非空条目…ADR 0019 决策 5）」与 §5 原文语义一致；决策编号引用正确（§5=决策 5、§7=决策 7，本轮逐字核对） |
| 被修订正文保留 | 正文 L35–36/L42/L84 旧措辞一字未动（diff 纯新增）；「哪段文字在效力」判定方式与全库惯例统一（读 dated 节条款清单），未引入第二种判定方式 |
| ADR 状态面 | 无 superseded 关系变更；0016 仍「已接受」，增补节为条款级修订登记（SA8 iter5 X8 全库扫描 0 命中 superseded，本轮未复跑全量扫描——对象同一性 + diff 纯新增构造性成立） |

## 5. 架构惯例 / 单一事实源 / 生命周期

| 维度 | 结论 | 证据 |
|---|---|---|
| 单一事实源 | 成员 doc 事实源 = `derived.memberDocs`（evaluate 产物）；投影每次读现算（零缓存、逐调用新鲜数组）；合并规则单点 = `merged(k)` 闭包（消除三份复制漂移面） | `resolve-schema-at-path.ts` L467–472；C7 确定性断言 |
| 平行机制 | 无第二套合并/过滤逻辑（三遍扫描共用单点 `merged` + 同一 `want()` + 同一空过滤）；无新测试通道 | L474–489 |
| 生命周期对称性 | 不适用（纯函数、无 register/dispose/后台任务/订阅）；回滚 = 单文件 revert + 删三测试文件 + revert 纯新增增补节，无残留 | 设计 §9/§13 与 diff 形态一致 |
| 相似能力同族性 | 守卫与 evaluate 侧 `guardMemberDocs`「缺席合法、在场才校验」同族；条件稀疏键消费与 evaluate L74 条件展开对称 | SA4 §5 对照表，本轮抽验一致 |
| 错误诚实性 | 无静默 fallback（键缺席 = 规格行为非降级）；裸 TypeError 泄漏点（`Object.keys(null)`）已堵；条目级信任与 fieldDocs/markerDocs 同级（存量姿势，follow-up 已登记独立小票） | L454–465；设计 §13 残余 4 |

## 6. 文件范围审查

| 交付 commit 内路径 | ALLOW/DENY 核对 | 裁决 |
|---|---|---|
| `packages/vfsl/src/resolve-schema-at-path.ts`（+50/−9） | ALLOW 行 1（sliceDocs 第三来源 + 单点合并 + D4 守卫 + D7 注释同步） | ✅ 内容全部在 ALLOW 描述内 |
| `docs/adr/0016-….md`（+20/−0） | ALLOW 行 2（末尾追加、正文零改动、纯新增） | ✅ numstat 实测 |
| 三份新测试文件（fixture 201 + 红契约 281 + 负控 222 行） | ALLOW 行 3–5 | ✅ |
| 6 份 wiki 证据（design/sa2/sa3/sa4/sa6/sa8） | 非 ALLOW/DENY 路径；仓库工件惯例（1097 份 tracked 先例；#307 交付同形态） | ✅ |
| DENY 面 | `derived.ts`/管线四文件/必填键清单/`namespace-runtime/**`/既有测试与 fixture/`index.ts`/codegen/v1-spec/编写指南/CONTEXT.md/ADR 0019/0003/ADR 0016 正文——diff 全量核对零触碰 | ✅ |

## 7. 测试质量标准审查

| 标准 | 结论 |
|---|---|
| 行为断言经公共入口 | ✅ 全部经 `../src/index.js` 导出的 `parseVfsl`/`evaluate`/`resolveSchemaAtPath`；不读生产源码、不 grep 文本 |
| 无弱化 | ✅ 无 skip/only/todo/`it.if`（grep 实测）；SA3 偏差 1（C4 收窄为仅断言缺席）系按 SA6 §12.5 原文口径执行，presence 由 M1 锚定——未弱化任何契约断言 |
| 红→绿证据 | ✅ 红灯基线 13 failed（全落 docs 断言处）→ 实现后 25 passed；控制文件实现前后均绿（负控性质符合 SA6 §13） |
| Runner 入口真实 | ✅ vitest include + CI shard 动态枚举 + 包 tsconfig 覆盖 fixture 类型检查（三处实测） |
| 冻结摘要基线 | 录制于 `4d4208b`；基线增量（#307/root-lock）对 vfsl 面零触碰（本轮实测 diff 为空）→ 摘要语义基线在 rebase 后成立；CI 首跑为最终确认（SA4 §11 已登记） |

## 8. Non-blocking observations（不阻断 approve）

1. **Commit message 缺 issue 引用**：交付提交题 `feat(vfsl): merge member docs into read projection` 未带 `(#308)` 引用，也未采用 SA3 建议的含验证证据的富文本信息；姊妹交付 #306/#307 题带 issue/PR 号。仓库历史本为混合惯例（多条无号提交在场），且 PR 号通常 squash-merge 时由维护者补齐——属记录层小差异，不影响代码/文档标准合规。
2. **wiki 工件提交集与 #307 不完全对齐**：本交付 commit 内嵌 6 份证据，但简报（`task_issue-308.md`）、SA7 报告与 5 份 rebase 门禁报告仍为 Host 拥有的未跟踪文件（#307 交付曾提交简报 + SA7 + SA9）。docs/AGENTS.md 定位 wiki/raw 为证据而非法约，提交集取舍属 Host 流程决定——提示收官时按集成支惯例补齐归档即可。
3. **内嵌证据引用 rebase 前谱系**：commit 内 6 份 wiki 工件锚点指向 `4d4208b`/`3fa05f4`（rebase 前 SHA）；SA8 iter5 I2 已裁定「历史证据不改写」且交付补丁逐字节迁移——留档注记，无需动作。
4. **SA4 §12 三项观察承认为有效留档**：D4 守卫条目级信任边界（follow-up 独立小票）、C9 镜像形态（本体 = 文件零改动 + runner 记录）、深读路径语义留白（SA6 §15.1 明示不冻结）——均为明示设计/登记项，非缺口。

## 9. 结论

- **verdict：approve**。最终 rebase 交付（`154dd2c` on `31da1f0`）在 AGENTS 合规、ADR 一致（0019 §7 授权 → 0016 append-only 登记）、模块责任、架构惯例、单一事实源、生命周期对称性、文件范围与测试质量八个维度全部符合仓库工程标准；rebase 内容忠实性经补丁级实测确认，上游验证证据（SA3 绿态、SA4 approve、SA7 38/38）对被测面构造性迁移有效。0 BLOCKER / 0 MAJOR / 0 MINOR 阻断项；§8 四项为非阻断观察。
- `requiresConflictRecheck: false`——本审查未引入/发现任何决策触碰面变化；SA8 五轮 clear（含 iter5 终局确认）对同一组 git 对象连续有效。
