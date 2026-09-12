# SA9 标准符合性审查 — issue #333（T0：readData 成功分支形状断言 helper 化 prefactor）

- 审查对象：已提交最终 diff `4258f3e`（`test(namespace): consolidate readData success assertions`），base `ba11f32`
- 审查人：SA9（独立 Standards 审查；只读静态复核，不修改代码/设计/测试，不运行测试）
- 仓库 / worktree：`welltop-jim-wang/nomicore` @ `/home/wangjian/nomicore-fix-issue-333`
- 上游产物：task brief、SA6 契约（approve）、SA1 设计、SA2 评审（approve，O1–O5）、SA3 实现报告、SA4 静态审查（approve，O1–O4）、SA7 动态验证（approve）
- Owner 评论：**无**（dispatch 记录 REST comment read 返回空数组；SA6 §2 / SA2 §4 / SA3 / SA4 / SA7 五方同证，本审查再次确认 `gh issue view 333 --json comments` 为空数组）
- **Verdict：`approve`**（无 BLOCKER / MAJOR；3 条 MINOR 观察见 §8，均不阻断）

---

## 1. 审查方法与独立核验范围

不信任任何上游 SA 转述，对**已提交 commit** 独立执行只读核验：

- `git diff ba11f32..HEAD --stat/--name-only` 全集逐文件核对（13 个代码面文件 + 7 个 wiki 产物）；
- 逐 hunk 读完全部 packages diff（13 文件全部 hunk）；
- 独立 grep 复扫：family A/B 字面量残留、helper 调用点计数、skip/only/todo、五键预演残留（`truncated|truncations`）、tab/行尾空白（editorconfig）；
- 只读 git 命令复核范围门：`src/**`、`docs/`、`domains/`、`apps/`、`package.json`、lockfile、`doc-runtime/**`、control 负控、`*.test-d.ts` 全部零 diff；
- 工作树洁净度：`git status --porcelain` 为空（交付已全部提交，无半成品/探针残留）。

## 2. 范围确认：test-only、零公共/产品变化（dispatch 焦点项）

| 检查 | 命令/方法 | 结果 |
|---|---|---|
| 变更集全部落在两测试树 | `git diff ba11f32..HEAD --name-only -- packages/` | **13 文件**，全部匹配 `packages/namespace-runtime/test/**` 或 `packages/namespace-registry/test/**` |
| 产品代码零变化 | `git diff --name-only -- 'packages/*/src/**'` | **空**（`runtime.ts` 成功字面量 L486 原文在树，M1 探针无残留） |
| 公共类型/导出面零变化 | `git diff` 无 `src/index.ts`、`internal.ts`、`testing.ts`、任何 `.test-d.ts` 改动 | **空** |
| 文档/schema/app/依赖面零变化 | `git diff --name-only -- docs domains apps '*/package.json' package.json pnpm-lock.yaml` | **空** |
| 负控面零收紧（C2.4） | `runtime-readdata-schema-projection-control.test.ts` 零 diff；其 L28 两键键集断言（doc-runtime 分层形状 `['ok','value']`）原样保留 | ✓ |
| 五键零预演 | `grep -rn 'truncated\|truncations' 两测试树+runtime/src` | **NONE**（ADR-0024 T3 本体未提前落地） |
| wiki 产物入库惯例 | `wiki/raw/*` 7 文件随交付 commit 入库 | 符合仓库先例（`f79b4cc docs(mabf): record delivery reviews`、`e96694d docs(#301): 入库 SA4/SA9/SA10 最终审查产物`、`019229c` 混合入库）——见 §8-O2 口径说明 |

**结论：scope 确为 test-only，无公共/产品变化。** 13 个代码面文件 = 设计 §10.1 ALLOW 11 行（1 新 helper + 10 改写）+ SA6 验收仪器 2 文件（扫描器 + 门，设计 §10.1 明示「已在树，不修改」，原样入库）。

## 3. AGENTS.md / 模块责任符合性

| 标准 | 要求 | 核验结果 |
|---|---|---|
| 根 AGENTS.md「Module guidance」 | 改动 `packages/**` 前读最近 AGENTS.md 并守其边界 | 两包 AGENTS.md 已读；边界全部满足（下两行） |
| `namespace-runtime/AGENTS.md` | 公共 API 只暴露 detached 投影；test seam 不外泄；readData 契约归本包 | helper 落 `test/helpers/`（测试树内部模块），不进 `src/`、不进公共导出面；readData 形状单点面归 readData 契约 Owner 包——**责任归属正确** |
| `namespace-registry/AGENTS.md` | 公共 API 只经 `src/index.ts`；hostile/test 控制留在显式 testing 面 | registry `src/**` 与 `testing.ts` 零 diff；registry 测试经既有跨包相对 import 先例消费 runtime 测试 helper |
| 跨包测试 import 先例 | `../../namespace-runtime/test/...` | 先例实证在树：`durable-snapshot-wait.js` 被 registry 4+ 文件 import（`registry-phase5-bootstrap-reset-red`、`registry-phase5-replication-red`、`registry-sa7-phase5-replication-dynamic` 等）——**同向同款，非新发明** |

## 4. ADR 符合性

| ADR | 契约 | 核验结果 |
|---|---|---|
| ADR-0016 | 成功分支恰三键 `{ ok: true; value: unknown; schema: ReadDataSchemaProjection \| null }` | helper `ReadDataOkShape` 与之**精确同构**（readonly 修饰不影响可赋值性）；27 处断言改写后语义逐点保留（`toStrictEqual` 三键全等）；value 键恒在场、显式 `undefined` 用例（hostile-guard L62）保留并因 `toStrictEqual` 获得键在场性 fail-loud |
| ADR-0024 决策 4 | 恰三键 → 恒五键的破坏性修订「全线修订」 | T0 正是该修订的合规前置 reducer：36 处形状知识（27 断言 + 9 制造点）收敛至单模块，T3 调用式不变；**零预演五键**（grep 证） |

## 5. 架构惯例、单一事实源、生命周期对称性

| 维度 | 核验结果 |
|---|---|
| 测试树内非测试 helper 惯例 | kebab-case、无 `.test.ts` 后缀、不被 vitest 收集（include = `**/*.test.ts`）——同 `durable-snapshot-wait.ts`、`readdata-schema-projection-fixture.ts`、registry `test/helpers/registry-seam-audit.ts` 先例；`test/helpers/` 目录亦有 registry 包先例 |
| `import { expect } from 'vitest'` 于非测试模块 | 先例 ×2 在树（`durable-snapshot-wait.ts:25`、`readdata-schema-projection-fixture.ts:12`） |
| `import type` 纪律 | helper L14 `import type { ReadDataSchemaProjection } from '@nomicore/vfsl'`——verbatimModuleSyntax 安全，运行时擦除 |
| 单一事实源 | 形状知识单点化：断言面（L39）/构造面（L29）/键集常量（L17）三处内联是**反伪绿不变量要求的有意双写**（模块头注明文：任一侧派生另一侧会使 M2 探针伪绿）；该不变量经 SA3/SA7 两轮 M2 突变探针动态证明成立（恰 19 红 + hostile 对照绿）。helper 不 import 扫描器 `SUCCESS_SHAPE_KEYS`——验收仪器与永久基建的有意分层，理由在设计 §7.1 写明。**非 SSOT 违反，属有文档的刻意结构** |
| 生命周期对称性 | 无资源获取/释放、无订阅、无后台任务、无计时器；`readDataOk` 无状态每次新鲜对象——对称性不适用且无隐藏生命周期 ✓ |
| 平行机制 | 无第二套形状 helper/断言面（SA6 H3 已证不存在既有 helper；本次补齐的是缺失单点面） |
| editorconfig | 新文件无 tab、无行尾空白、2 空格缩进 ✓ |

## 6. 文件范围与测试质量标准

| 标准 | 核验结果 |
|---|---|
| ALLOW/DENY 逐行符合 | 13 文件与设计 §10.1 逐一对应；DENY 面（src、SA6 仪器本体、control 负控、3 个 test-d、doc-runtime、docs/package.json、无命中测试文件）**全部零触碰** |
| 收敛完整性（独立计数） | `expectReadDataOk(` **24 处 / 6 文件**；`expectReadDataOkKeys(` **3 处 / 2 文件**；`readDataOk(` 真实制造点 **9 处**（另 2 个 grep 命中为扫描器 doc-comment 与门负样本字符串，非制造点）——与 SA6 附录 27+9 清单**逐点吻合** |
| 残留扫描 | 两测试树再无 `toEqual/toStrictEqual({...ok:true...schema...})` 断言实参字面量（仅存命中为门内正样本**字符串**，属仪器自控输入）；无三键键集数组字面量断言（control L28 为两键 doc-runtime 形状，刻意保留） |
| 断言强度 | `toEqual → toStrictEqual`：严格性只增不减，方向经 SA6 C2.2 授权（恰三键严查 + undefined 键在场 fail-loud）；无 `toMatchObject`/子集匹配弱化 |
| 改写保真 | 主语单次求值保留（`leaseN.readData(['x'])` 原位）、期望值逐键保留、行尾注释保留（idle ×4）、后随断言保留（`'schema' in r`、`Object.isFrozen` 抽检、`JSON.stringify` toContain、分字段断言、`readOk`/`oracle`/`PROJ`） |
| skip/only/todo/env override | 提交 diff 中 **NONE** |
| 收敛门质量 | 门含：作用域覆盖防空转断言（≥80 文件 + 4 锚文件 + scope 声明同源）、family A/B 归零（失败消息带 file:line 清单 + 按文件分布）、**7 正 / 8 负仪器自控**（正样本必中防漏报、负样本防误伤含 toMatchObject/两键/失败分支/hoisted/构造调用形态）——结构门 + 行为面（既有套件 + M1/M2 探针）分层正确，非文本断言替代行为验证 |
| 提交卫生 | 单 commit、conventional `test(namespace):` 前缀（仓库有先例）、工作树洁净、探针逐字节还原（SA7 diff IDENTICAL ×2） |

## 7. 交付产物评估（dispatch 焦点项）

| 产物 | 状态 | 质量评估 |
|---|---|---|
| `task_issue-333.md`（brief） | 在库 | Issue 正文 + AC1–AC3 完整，comments 空数组记录准确 |
| `task_issue-333_sa6_contract.md` | 在库 | 契约可执行：C1a/C1b/C2.1–C2.4/C3a–C3c 条款完整，M1/M2 探针规格精确到施加点与期望红数，仪器语义与在树扫描器/门逐条吻合 |
| `task_issue-333_design.md` | 在库 | 14 节 + 27+9 逐点改写附录；ALLOW/DENY、反伪绿结构决策（§7.2/§7.3）、过门证明（§8.3）、等价论证（§8.4）完整；与最终实现逐点一致 |
| `task_issue-333_sa2_review.md` | 在库 | approve；独立源码级核验记录充分；O1–O5 观察均有后续处置记录 |
| `task_issue-333_sa3_impl.md` | 在库 | changed paths / file scope check / verification 三表齐全；C3c 全量口径按 SA2-O3 显式化（339/3608）；无偏差声明与证据一致 |
| `task_issue-333_sa4_review.md` | 在库 | approve；独立 hunk 级复核 + 扫描规则静态复演；§11 后续动态验证项全部被 SA7 承接 |
| `task_issue-333_sa7_report.md` | 在库 | approve；M1 恰 6 红 / M2 恰 19 红 + hostile 对照绿（反伪绿动态证明）、探针还原逐字节洁净、门 20/20、全量 339 文件/3608 tests/exit 0 证据链完整 |
| verdict 链一致性 | SA6→SA2→SA3→SA4→SA7 全 approve，owner 空评论五方同证 | 与本审查独立核验结论一致；SA3/SA4/SA7 成文于未提交态，其描述的「10 M + 1 新 helper + 2 仪器」变更集与 commit `4258f3e` 实 content **逐文件吻合**（本审查 §1 复核），无 review-then-change 间隙 |

## 8. Non-blocking observations（MINOR，均不阻断 approve）

| ID | 观察 | 建议 |
|---|---|---|
| O1 | 门文件注释「108 个 .ts（HEAD 实测）」相对终态（SA7 实测 110 文件）为写作时点快照；断言阈值 `>= 80` 为刻意保守下界，判定不受影响 | 无需动作；T3 扩展仪器时可顺带刷新注释数字 |
| O2 | SA6 C3a 第一条范围门命令（`grep -vE '^packages/(namespace-runtime\|namespace-registry)/test/'` 须为空）若以**已提交 diff** 字面求值，会列出 7 个 `wiki/raw/*` 路径；第二条门（src/domains/apps/docs）实测为空。wiki 产物随交付入库是 MABF 既定惯例（`f79b4cc`/`e96694d`/`019229c` 先例），C3a 的实质意图（零产品/公共类型变化）完全满足 | 后续契约书写可把 wiki 产物显式列入允许面，消除字面口径差 |
| O3 | 验证日志留存于 `/tmp`（SA3/SA7 报告内联全部命令输出），未按部分前例（issue #330）额外入库 `artifacts/*.log` | 非强制惯例；报告内联证据已自足。若 Controller 要求日志级留存，可后续补入库 |

## 9. 结论

**approve。** 已提交最终 diff 严格符合仓库工程标准：scope 确为 test-only（13/13 代码面文件在两测试树内），零公共 API/产品代码/文档/依赖变化；模块责任归属正确（readData 形状面归 namespace-runtime 测试树，registry 经既存先例消费）；ADR-0016 现状逐点保留、ADR-0024 T3 仅前置不预演；单一事实源经有文档的反伪绿双写达成且经两轮突变探针动态证明；文件范围与设计 ALLOW/DENY 逐行吻合；测试质量（断言强度、门自控、保真度、提交卫生）全部达标。交付产物链完整、verdict 一致、证据可复跑。3 条 MINOR 观察不阻断。
