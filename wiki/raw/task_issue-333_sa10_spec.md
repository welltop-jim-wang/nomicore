# SA10 Spec 审查 — issue #333（T0：readData 成功分支形状断言 helper 化 prefactor）

- 审查角色：SA10（独立 Spec 审查者；只判实现是否忠实满足 Issue 正文 AC、适用 Owner 评论与已批准验收契约；不评审通用架构风格/仓库规范——属 SA9）
- 审查对象：**已提交最终 diff** `ba11f32..HEAD`（HEAD = `4258f3e` "test(namespace): consolidate readData success assertions"）
- 上游产物：Issue #333 正文（AC1–AC3，brief `task_issue-333.md`）；SA6 验收契约（approve）；SA1 设计；SA2 评审（approve）；SA3 实现报告；SA4 静态审查（approve）；SA7 最终动态验证（approve）
- Owner 评论：**无**（dispatch 记录 REST comments 返回空数组；SA6 §2 / 设计 §4 / SA3 / SA4 / SA7 五方同证）→ 无映射项
- 审查方法：不信任转述——独立只读复核 committed diff 全量 hunk、helper 全文、base（`ba11f32`）字面量计数、HEAD 残留 grep、范围门命令。按角色约束**不运行测试**；动态证据采信 SA3/SA7 报告并核对 committed tree 与 SA7 验证态一致（`git status --porcelain` 空 → HEAD 即 SA7 验证过的树 + 同期写就的 wiki 产物）。
- **Verdict：`approve`**

---

## 1. Issue AC 逐条核对

| AC | 要求 | 独立核验证据 | 判定 |
|---|---|---|---|
| AC1 | runtime 与 registry 测试中 readData 成功分支深等断言全部经统一 helper 表达（或等价的集中化形状构造） | 新增统一模块 `packages/namespace-runtime/test/helpers/readdata-ok-shape.ts`（三导出：`expectReadDataOk` / `expectReadDataOkKeys` / `readDataOk` + `READDATA_OK_KEYS` / `ReadDataOkShape`）。HEAD grep 计数：family A 站点 24（idle 11 / create 3 / open 2 / rev1 3 / sa7-hostile 1 / hostile-guard 4）全部经 `expectReadDataOk`；family B 站点 3（docs-sync-control 2 / projection-red 1）全部经 `expectReadDataOkKeys`；9 处替身制造点全部经 `readDataOk`。两树残留 grep：无任何「恰三键」断言实参字面量（剩余 `{ok:true}` 单键为 mutate/validate/delete 等他类操作；`{ok:true,value}` 两键为 DENY 保护的 control 负控与 doc-runtime 分层，均正确地不在 scope） | **met** |
| AC2 | 断言语义零变化：改写前后测试对同一实现的判定一致，全套包门禁绿 | 语义面：helper 用 `toStrictEqual` 三键全等（严格性只增不减，契约 C2.2 允许方向；设计 §8.4 逐点等价论证——actual 侧全为普通对象字面量，唯一显式 `value: undefined` 用例两侧键均在场）。行为面（SA3/SA7 双跑）：C2.1 十二文件 178 tests 绿；突变探针反向证明判定一致且敏感——M1（生产成功分支 +2 键）恰 6 红（4A+1B+1B）、M2（构造面 +2 键）恰 19 红且 hostile 对照 4/4 绿（反伪绿分离动态成立）；还原后逐字节洁净。全套门禁：root `pnpm test` 339 文件 / 3608 tests 全绿 exit 0（SA7，602s）；`pnpm typecheck` exit 0 | **met** |
| AC3 | 无产品代码 / 公共类型变化；root typecheck 与 test 通过 | SA10 独立复跑范围门：`git diff ba11f32..HEAD -- 'packages/*/src' 'domains' 'apps' 'docs' 'package.json' 'pnpm-lock.yaml'` → **空**。committed 文件集 = 13 个 `packages/(namespace-runtime\|namespace-registry)/test/**` 文件（10 改写 + 1 新 helper + 2 个 SA6 仪器新文件）+ 7 个 wiki/raw Host-owned 产物。零 src/公共类型/依赖面变化 | **met**（一处口径说明见 §4-N1） |

## 2. SA6 验收契约条款核对（§12.2）

| 条款 | 要求 | 核验 | 判定 |
|---|---|---|---|
| C1a | family A 归零（24→0） | base `ba11f32` 独立计数 = 24（23 单行 + hostile-guard L69 多行）；HEAD 全部经 helper、零残留 | **met** |
| C1b | family B 归零（3→0） | base 3 处键集字面量（docs-sync L143/154、red L102）；HEAD 经 `expectReadDataOkKeys`，同测试体其余断言（`JSON.stringify` toContain、四键投影键集、分字段）原样保留。设计 §7.5 按契约预留的显式决策口确认纳入，非隐性豁免 | **met** |
| C2.1 | 行为零变化套件绿 | SA3/SA7：12 文件 / 178 tests 绿（含两个制造点套件 concurrency/shutdown） | **met** |
| C2.2 | helper 判定语义五条 | helper 全文与设计 §7.1 代码块逐行一致：`ok===true`、恰三键全等（无 toMatchObject/子集）、value 深等含显式 undefined、schema 深等（null + 四键投影体）、ok:false 必红 | **met** |
| C2.3 | 突变敏感性保持（反伪绿） | SA7 独立重跑：M1 恰 6 红（registry 5 文件同批绿，区分钉生产/钉替身）；M2 恰 19 红（11/2/2/1/3）+ hostile 对照绿 → 断言面/构造面互不派生动态得证。两探针 `diff` IDENTICAL 还原、`runtime.ts` git diff 空、`truncated/truncations` 残留 NONE（SA10 对 committed packages diff 复核：0 处残留、0 处 skip/only/todo） | **met** |
| C2.4 | 反向边界不收紧 | SA10 复核：`runtime-readdata-schema-projection-control.test.ts` 在 committed diff 中**零改动**；red 文件 diff 仅 import 行 + L102→103 一处（`readOk`/`oracle`/`PROJ`/分字段断言零改动） | **met** |
| C3a | 零生产/公共类型变化 | 第二条门命令（src/domains/apps/docs）SA10 复跑 = 空。第一条门命令在**提交粒度**下非空：7 个 wiki/raw 产物进入提交——见 §4-N1（口径说明，非违反） | **met（substance）** |
| C3b | 公共面/类型面锚保持绿 | 3 个 `.test-d.ts` 零 diff（SA10 复核）；SA7：3 文件 / 5 tests 绿、`Type Errors: no errors`；4 个公共面套件在全量中绿 | **met** |
| C3c | `pnpm typecheck` / `pnpm test` 绿 | SA7：exit 0；339 文件 / 3608 tests 全绿（口径吻合 SA2-O3：pristine 338/3588 + 门 20）。committed tree 与 SA7 验证态逐文件一致（worktree clean） | **met** |

门自身：20 tests 结构复核（作用域覆盖 + family A/B 归零 + 7 正样本 + 8 负样本 + 2 生产者自控），与 SA6 §12.1 交付面一致；门/扫描器在 commit 中为**新增**（SA6 时未跟踪），内容未经 T0 实现侧修改（DENY 遵守；SA4 已逐条比对其规则与契约描述）。

## 3. 收敛完整性核对（dispatch 焦点）

- **success-shape assertion consolidation**：27 处断言（24A+3B）逐点对照 SA6 附录 file:line 清单全部收敛；改写为表达式对表达式原位替换——subject 单次求值、期望值、行尾注释（idle 4 条）、后随断言（`'schema' in r`、`Object.isFrozen` 抽检）全部保留。9 处制造点收敛为 `readDataOk` 单点，D7 类型锁注释随改写指向 `ReadDataOkShape` 精确返回类型。
- **反伪绿结构**：`expectReadDataOk` 期望对象（L39）与 `readDataOk` 构造体（L29）各自独立内联、互不派生；不变量写入模块头注；SA7 动态证明（M2 只改构造面 → 19 红 + 对照绿）。
- **零行为变化证据链**：SA3（自跑）→ SA4（静态独立复核）→ SA7（独立动态复跑，含探针生命周期）三层一致；SA10 复核 committed tree == 验证态。
- **required scope**：改动集与设计 §10.1 ALLOW LIST 11 行一一对应；DENY 面（src、control 负控、test-d 锚、SA6 仪器、doc-runtime、docs、package.json）零触碰。9 处制造点收敛是 AC1 括号条款 + SA6 §10/§15 显式授权的设计裁定（设计 §7.2），**非 scope creep**。无 T3 预演（五键零残留）。

## 4. 披露项（非阻断，PR/后续任务应知悉）

| ID | 级别 | 项 | 说明 |
|---|---|---|---|
| N1 | MINOR（口径） | C3a 第一条门命令在提交粒度下非空 | SA6 门命令按提交前工作树校准（wiki 产物当时未跟踪）；committed diff 含 7 个 `wiki/raw/task_issue-333*` Host-owned 过程产物。提交 wiki 产物是本仓既定惯例（历史集成提交同式），且不属「产品代码/公共类型」——AC3 实质完全满足，第二条门命令（src/domains/apps/docs）为空。PR 描述若引用 C3a 第一条命令应按「排除 wiki/raw」口径表述 |
| N2 | MINOR（注释漂移） | 门文件 L41 注释「108 个 .ts（HEAD 实测）」 | helper 加入后实测 110（SA7 报告）；断言阈值为 `>= 80` 的下界保护，注释数字不影响判定；属 SA6 仪器内部注释 |
| N3 | 信息（follow-up 登记） | 契约将 C2.3 重跑指派「SA5」，实际由 SA7 执行 | 无 SA5 产物；SA7 dispatch 焦点明示覆盖 M1/M2 独立重跑且已留证，要求实质达成 |
| N4 | 信息（T3 风险点，承 SA4-O3） | `registry-phase5-bootstrap-reset-r2-internal.test.ts:271` 两键 legacy fake（`unknown` 返回类型） | pre-existing、正确地不在 T0 scope；T3 五键修订时无类型锁保护，应登记进 T3 任务简报 |

无 unmet / partial / unachievable 的 AC 或契约条款；无未披露的未达成项。

## 5. 结论

**`approve`。** Issue #333 三条 AC 全部 met；SA6 验收契约 C1a/C1b/C2.1–C2.4/C3a–C3c 全部 met（C3a 第一条命令的提交粒度口径差异已如实披露，实质满足）；无 Owner 评论未映射；无 scope creep（9 处制造点收敛为显式授权的设计裁定）；零行为变化证据链完整（静态 + 动态 + 突变探针反伪绿）；改动严格限于两测试树 + Host-owned wiki 产物。4 条 MINOR/信息项不阻断 approve。
