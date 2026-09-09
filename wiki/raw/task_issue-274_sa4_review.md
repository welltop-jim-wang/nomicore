# SA4 实现静态审查 — Issue #274 文档同步：typed-access 与 docs/integration 覆盖 readData 语义 schema 投影（ADR 0016）

- 被审对象：SA3 实现（iteration 0，dispatch `sa-843a4a11-e5bf-4dda-93fa-435e5b633e28`，报告 `wiki/raw/task_issue-274_sa3_impl.md`）
- Worktree：`/home/wangjian/nomicore-fix-issue-274`（branch `mabf/issue-274`，HEAD `6ab8c87`）
- 审查人：SA4（mabf-sa4，implementation-review，dispatch `sa-11021070-bd39-4257-af51-78a10eebbe8c`）
- 裁决：**approve**（0 BLOCKER / 0 MAJOR / 0 需修订 finding；4 条 Non-blocking observations，其中 O-1 为必须回流总控的终态验证事项）
- 审查方式：只读静态审查（git diff/status/stat、逐字节文本对照、matcher 正则手工施加于交付文本、全仓扫描、链接与锚点核验）；未运行测试、未修改任何实现/设计/测试文件；唯一写产物 = 本文件

## 1. Reviewed inputs

| 输入 | 状态 |
|---|---|
| 任务简报 `wiki/raw/task_issue-274.md`（What to build 六要点 + AC1–AC3） | 亲读 |
| dispatch `wiki/raw/task_274_dispatch.md`（Issue comments REST = `[]`） | 亲读 |
| SA1 设计 `wiki/raw/task_issue-274_design.md`（D1–D7、§6–§8 措辞级方案、§10 ALLOW/DENY、§12 验收映射） | 全文亲读 |
| SA2 设计评审 `wiki/raw/task_issue-274_sa2_review.md`（approve；F-1 LOW + N-1~N-3） | 全文亲读 |
| SA6 验收契约 `wiki/raw/task_issue-274_sa6_contract.md`（approve；R1–R7 + 21 负控 + 夹具） | 全文亲读 |
| SA8 设计后冲突复审 `wiki/raw/task_issue-274_design_conflict_report.md`（clear；A1–A14 + §8.1–8.5 移交） | 全文亲读 |
| SA3 实现报告 `wiki/raw/task_issue-274_sa3_impl.md` | 全文亲读 |
| 交付 diff（3 个 tracked .md）与 untracked 集 | `git diff` / `git status` 实测 |
| SA6 冻结契约三文件（red 7 / control 21 / fixture） | 全文亲读（含 matcher 正则逐条） |
| 母法亲核：`docs/adr/0016-readdata-semantic-schema-projection.md` 全文 98 行；行为面 `packages/namespace-runtime/src/runtime.ts`（`NamespaceRuntimeReadDataResult`）、`packages/namespace-registry/src/types.ts` L631（`readData(path)` 单参签名）、`packages/namespace-registry/src/lease.ts` L276/L390 | 亲读 |
| Issue comments | **空**（dispatch/简报/SA6 §2/SA2 §5/SA8 §2.19 五处同口径 REST = `[]`；无 owner 要求需并入） |

## 2. Verdict

**approve。**

SA3 交付与批准设计**逐字节一致**：§6 新节、D6 交叉指针、§7 注记替换、§8 可选段均为设计建议文本的原样落位（`diff` 逐字节比对零偏差，见 §4）；改动恰为 ALLOW LIST 三行（两项必改 + 两项可选推荐全部采纳），DENY LIST 零触碰；R1–R7 内容锚与 21 条负控经 matcher 正则手工施加于交付文本全部满足；语义层逐句对照 ADR 0016 无矛盾；`git diff --check` 干净、两处新相对链接实测可达、D6 锚 slug 与标题一致。SA6 冻结契约三文件未被触碰（mtime 序 + 内容三方交叉核对，见 §6 说明）。唯一开放项是 AC3 的全仓 `pnpm test` 终态门尚未在任何会话执行（O-1，回流总控/SA7，见 §11），其静态风险为零（md-only 改动 + 已独立实测 registry 面 412/412），不构成 approve 阻断。

## 3. 上游要求落实

| Requirement or finding | Implementation evidence | Assessment |
|---|---|---|
| Issue 正文① 成功读 `schema` 字段形态（四键投影体） | typed-access.md 新节 L110（三键形状）+ L112–116（四键 bullet，同块无空行） | 落实（与 ADR 0016 L19/L30–39 逐义一致） |
| Issue 正文② docs 切片与派生 schema 文档三表同构键规约 | 新节 L118（isomorphic + `'<item>'/'<key>'/'<member N>'` synthetic segments + 别名名锚定） | 落实（贴 ADR 0016 L42 文法） |
| Issue 正文③ 「`schema` 为 `null` 不是读的失败」判读 | 新节 L120（三情形枚举 + "A null schema is not a read failure: `ok` stays true"）+ cordis L340–341 中文说明注释 | 落实（贴 ADR 0016 L22） |
| Issue 正文④ 读后修改凭投影构造合法 mutation | 新节 L122（schema projection + `mutateData()` mutation + 静态类型权威归属） | 落实（贴 ADR 0016 L8/L77） |
| Issue 正文⑤ 范围 = typed-access + docs/integration 消费 readData 文档 | 改动恰 3 文件：typed-access、cordis-plugin-hosting、external-project-vfsl-codegen（grep 实测 docs/integration readData 消费面无第四文件） | 落实 |
| Issue 正文⑥ 现有示例加法兼容、陈述不与 ADR 0016 矛盾 | cordis 示例调用行 L342 与 L362 零改动（diff 上下文行）；external §5/§6 示例零改动；全仓 `// { ok: true` 扫描仅剩 cordis L343（含 schema）+ ADR 0016 自身 L55（规范示例，契约作用域外） | 落实 |
| AC1 typed-access 形态/null/消费 | R1–R6 静态满足（§9 表）；SA3 实测红→绿 7/7（两种终态各 1 次） | 落实 |
| AC2 docs/integration 无矛盾 | R7 静态满足；全仓注记与两键散文扫描无残留矛盾站点 | 落实 |
| AC3 全仓双绿 | `pnpm typecheck` exit 0（SA3 实测）；registry 全套件 412/412（SA3 实测）；**全仓 `pnpm test` 未执行**（SA3 按 skill 边界移交总控/SA7） | typecheck/registry 面落实；全仓 test 待终态验证（O-1，非本审阻断） |
| SA2 F-1（D6 行号 L44→L43 勘误） | SA3 以文本匹配定位子弹，落于实测 L43（grep 确认子弹全仓唯一） | 关闭 |
| SA2 §8 移交 2（两种终态验证） | SA3 终态 A/B 各复跑 red+control 均 7/7 + 21/21（报告 Verification 表） | 落实 |
| SA8 §8.1（行号勘误）/§8.2（纯加法表述分开陈述） | 报告「与纯加法表述的关系」节分开陈述新节/§8 纯加法与 D6 追加式编辑 | 落实 |
| SA8 §8.5 终态复核清单 | ALLOW 外零触碰 ✓、R1–R7 + 负控 ✓、typecheck ✓、`git diff --check` ✓、链接两处 ✓——唯全仓 `pnpm test` 待执行 | 4/5 落实，1 项回流（O-1） |
| Owner 评论 | REST = `[]`（无 comment ID / updated_at 需核对） | 不适用 |

## 4. 设计落实审查

| Design decision | Implementation location | Assessment | Finding |
|---|---|---|---|
| D1 落点：新节插于「Activation guards」末段（现 L106）与 `## Mutation policy`（现 L124）之间 | typed-access.md L108–122，前接 L106 `Use paths and values…`、后接 L124 标题 | 精确落实 | — |
| D2 语言/词形：英文正文 + 规范词形 "semantic schema projection" / "A null schema is not a read failure" | 新节全英文；两词形均在场（L110/L120） | 落实 | — |
| D3 cordis 修法：L341 注记替换为三键形状 + 上方两行中文说明；L360 不动 | L340–341 两行说明 + L343 三键注记；L362 `readData(['count'])` 原样（无注记） | 落实 | — |
| D4 external 可选单句增补（采纳） | external-project-vfsl-codegen.md L288（§5 L287 段之后）；示例代码零改动 | 落实 | — |
| D5 作用域外文档零改动 | git status 无根 AGENTS.md / replication.md / 其余 skill 文档改动 | 落实 | — |
| D6 Process item 6 交叉指针（采纳） | typed-access.md L43 追加式编辑（原文保留 + 括注锚链接） | 落实（SA8 §8.1 文本匹配定位） | — |
| §6 建议文本逐字采用 | **逐字节一致**：`sed` 抽取设计 L89–103 与交付 L108–122 `diff` 零输出（`SECTION-VERBATIM-MATCH`）；D6 子弹、§7 四行、§8 段同样逐字比对一致 | 落实（消除 SA3 改写丢锚风险） | — |
| §6 实现注意 1–3（单参形式/无行首两键注记/既有内容零删改） | 作用域三文档全部 `readData(` 用法无逗号第二实参（L43/L110/L342/L362/external L253/L351）；新注记 L343 含 schema；diff 为 +22/−2，唯一删除行 = D6 子弹与 L341 旧注记的替换 | 落实 | — |
| 非目标：不改代码/测试/规范面、不发明宿主验证义务 | Completion gate（L169）零改动，无 schema 投影条款混入；packages/apps/domains/tests 零改动 | 落实 | — |

## 5. 架构一致性与惯例

### 责任归属

| Behavior | Expected owner | Actual location | Assessment |
|---|---|---|---|
| readData 结果形状的规范陈述 | ADR 0016（母法） | 文档以相对链接挂接权威源，未复制规则整段 | 正确（docs/AGENTS「Link to the authoritative source」） |
| 形状的行为事实源 | `packages/namespace-runtime/src/runtime.ts` | 文档三键/四键陈述与 `NamespaceRuntimeReadDataResult` 成功分支及行为锚实测一致，未发明行为 | 正确 |

### 相似能力对照

| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
|---|---|---|---|---|
| cordis 文档「说明 + 精确注记」风格 | 同文件 L320–321 先例 | L340–341 说明 + L343 键名示意注记 | 一致 | 设计 D3 明确对齐该先例；键集与行为锚实测 own keys 恰四键一致（SA8 §8.3/SA2 N-2 已裁非虚构） |
| external 文档 ADR 链接风格 | 同目录 cordis L3/L159 `[ADR-0006](../adr/…)` 先例 | L288 `[ADR-0016](../adr/…)` | 一致 | 该文件首个 ADR 链接（SA8 §8.4 移交项），路径实测可达 |
| typed-access 小节结构 | 既有 8 个 `##` 小节 | 新节标题 slug 与既有标题无冲突；阅读流 Process → 新节 → Mutation policy | 一致 | 设计 D1 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| 读结果形状/null 语义/键规约 | ADR 0016 + runtime.ts | 消费文档为链接挂接的转述，非第二规则副本 | 无（无平行规范文本；负控「权威源健全性」常驻锁 ADR 0016 在场） |

### 生命周期对称性

不适用（纯 Markdown 文档改动，无 acquire/release、无后台任务、无状态机）。

### 平行机制检查

| Candidate duplicate | Existing path | Actual path | Disposition |
|---|---|---|---|
| 无 | — | — | 零新增抽象/worker/缓存/第二文档面（diff +22/−2 全为文本） |

## 6. 文件范围审查

| Changed path | ALLOW entry | Purpose | Assessment |
|---|---|---|---|
| `.agents/skills/nomicore/typed-access.md`（M，+17/−1） | ALLOW 第 1 行（必改 §6 新节 + 可选 D6） | AC1 六要点（R1–R6） | ALLOW 内 |
| `docs/integration/cordis-plugin-hosting.md`（M，+3/−1） | ALLOW 第 2 行（必改 §7；L360 不动） | R7/AC2 矛盾注记修正 | ALLOW 内 |
| `docs/integration/external-project-vfsl-codegen.md`（M，+2/−0） | ALLOW 第 3 行（可选推荐 §8） | 加法闭合指引缺口 | ALLOW 内 |
| `wiki/raw/task_issue-274_sa3_impl.md`（??） | SA3 固定报告产物 | 实现记录 | 惯例产物 |

DENY 核验（`git status --porcelain` 实测）：

- SA6 三契约文件（red/control/fixture）：仍 untracked、**未被修改**。证据：① mtime 序——契约文件 18:12/18:12/18:13 早于 SA6 契约报告 18:15，均远早于 SA3 文档编辑 18:45:31–18:45:56 与 SA3 报告 18:47:32；② 内容三方交叉核对——red 恰 7 tests（R1–R7，逐条以 fixture matcher 断言文档内容，非源码字符串断言）、control 恰 21 tests、fixture matcher 正则位于 L55–115，与 SA6 契约 §12–14、SA2 §2、SA8 §3.1 A9 三处独立引用一致；③ 无 `.only`/`.skip`/`.todo`（grep 零命中）。untracked 文件无 git 基线可 diff，此为可用的最强静态证据（残余局限见 O-3）。
- `docs/adr/**`、`CONTEXT.md`、`packages/**`、`apps/**`、`domains/**`、`tests/**`、根 `AGENTS.md`、其余 skill/integration 文档、README：git status 零改动。
- `wiki/raw/**` untracked 集恰为各角色固定产物（简报/dispatch/设计/SA8/SA2/SA6/SA3），无临时 marker 或脚本残留。

## 7. 契约连锁审查

| Contract | Caller | Actual handling | Risk | Finding |
|---|---|---|---|---|
| `readData(path)` 单参公共 API（types.ts L631） | typed-access 新节/文档全部用法 | 文档仅 `readData(path)`/`readData()` 形式，无带参发明 | 无 | — |
| 成功分支三键（runtime.ts） | 文档三键陈述 + cordis 注记 | 与运行时类型逐字同形；"Every successful" 限定准确，未触碰失败分支语义 | 无 | — |
| `schema: ReadDataSchemaProjection \| null`（ADR 0016 L19/L22） | 新节 null 判读段 + cordis 说明注释 | 三情形单义、ok 恒真，无 null 误读、无 `schemaIssue` 子通道暗示 | 无 | — |
| always-on 交付纪律（ADR 0016 L69/L81） | 作用域三文档 | 无 `readData(…, …)` 带参用法（负控 matcher 正则手工施加 = 0 违规） | 无 | — |
| detached 深拷贝（ADR 0016 L70） | 新节 L120 末句 | 「do not cache or share projections across reads」告诫在场 | 无 | — |
| 加法兼容（ADR 0016 L77/L92） | cordis L342/L362、external §5/§6 示例 | 示例代码零改动；`.ok`/`.value` 消费者不受影响 | 无 | — |
| 其他文档消费方（根 AGENTS.md L31、replication skill L90、hub-peer-deployment、local-package-linking） | 无形状断言（SA2/SA8 grep + 本次复扫） | 零改动、无矛盾残留 | 无 | — |
| CI（ci.yml 分片按磁盘枚举） | 契约测试文件 | 文件在 vitest include 面内；**当前 untracked，commit 前不进 CI** | 低（流程性，见 O-2） | — |

## 8. 错误、恢复与并发

不适用面：纯文档改动，无错误路径、重试、回滚、并发与生命周期代码。唯一「失败模式」= 文档与 ADR 0016 矛盾，由 R1–R7 + 21 负控常驻契约与评审捕获；回滚 = `git revert` 文档提交（设计 §13，与交付一致——改动纯文本、无耦合）。SA3 报告的「终态 B 临时移除 §8 段再恢复」流程未留下中间态残留（交付 diff 含 §8 段且完整；`git diff --check` 干净）。

## 9. 测试质量审查

SA4 未运行/未编写测试；以下为对冻结测试源码与真实触发入口的静态审查。

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
|---|---|---|---|---|
| red `readdata-docs-adr0016-sync-red.test.ts`（7 tests） | R1–R7：对仓库真实文档内容施加 fixture matcher（adr0016Refs/shape/fourKey/keyConvention/nullSemantics/consumption/staleAnnotation），断言消息逐条点名缺口 | 根 vitest `include: ['packages/*/test/**/*.test.ts']`（实测命中路径模式）；CI 分片按磁盘枚举 | 无 skip/only/todo；断言对象为文档行为面（内容锚）而非源码字符串；SA6 已做正/负样本敏感性双向校验（含现状段回归负样本） | — |
| control `…-sync-control.test.ts`（21 tests） | 行为锚（真实 Registry 装配实测三键 + 四键投影体）+ matcher 正/负样本（6+9）+ 内容负控扫描（external/typed-access 无过时注记、无 opt-in、核心内容保持、权威源健全） | 同上 | 红灯断言保持（SA6 冻结后未被修改，见 §6 证据）；行为锚断言 `Object.keys` 排序与 own keys 精确集合，非弱化 toMatchObject | — |
| fixture `…-contract-fixture.ts` | 共享 matcher/文档路径；无 `.test.ts` 后缀不被收集 | 不收集（设计意图） | — | — |
| 交付文本 → matcher 静态施加 | R1：L110 "ADR 0016"+URL 命中；R2：段 1 含 `readData`+「schema projection」；R3：L114–116 bullet 块含 `valueSchema`+`aliasDocs`（块内无空行）；R4：L118 含 `aliasDocs`+isomorphic/synthetic；R5：L120 含 null+「not a read failure」；R6：L122 含「schema projection」+mutateData/mutation；R7：L343 注记含 schema 被滤除 → 0 违规 | — | 全部满足（与 SA2 内存模拟、SA3 两种终态实测三方一致） | — |
| AC3 全仓 `pnpm test` | 全仓 `vitest run --typecheck` | 根 package.json `test` script | **尚未在终态执行**（SA3 按 skill 边界移交）——见 §11 动态验证项 1 | — |

## 10. Required revisions

无。0 BLOCKER / 0 MAJOR / 0 MINOR 修订项。

## 11. 后续动态验证项

| Risk | Driver | Expected observation | Failure condition |
|---|---|---|---|
| AC3 后半：全仓 `pnpm test`（`vitest run --typecheck`）未在终态执行——静态风险为零（md-only 改动不进 tsc Program；registry 全套件已 412/412；契约 28 tests 已单独实测绿），但验收条款明文要求全仓绿 | 总控路由终态验证（建议 SA7/final verification；SA3 报告 Deferred verification 同请求） | 全仓测试全绿，含本票 28 条契约测试 | 任一套件回归，或 R1–R7/负控在聚合运行中失败 |
| SA6 三契约文件 untracked：commit 前常驻防回潮门不进 CI | 总控（commit 收纳时） | commit 同时包含 3 文档改动 + 3 契约文件；CI 分片运行且绿 | 契约文件被遗漏出 commit，或 CI 分片失败 |

## 12. Non-blocking observations

- **O-1（流程，回流总控）**：全仓 `pnpm test` 终态门待执行（见 §11 行 1；本审不因此阻断 approve——已执行面 typecheck exit 0 + registry 412/412 + 契约双终态绿覆盖了全部可受影响面）。
- **O-2（流程，回流总控）**：SA6 契约三文件须随本次改动一并 commit（SA3 报告已声明；SA4 复述以防遗漏——否则 R1–R7 防回潮门不落 CI）。
- **O-3（证据局限说明）**：untracked 冻结文件无 git 基线，「SA3 未改契约」由 mtime 序 + 内容与 SA6/SA2/SA8 三方引用交叉核对佐证——可用最强静态证据，置信度高；commit 后即有永久基线。
- **O-4（nit，上游产物）**：SA6 契约 §4 称 typecheck「16 个 package/app tsconfig」，根 package.json 实为 14 个 `tsc -p`（SA3 报告「14」正确）；计数口径差异无语义影响，无需动作。

## 13. requiresConflictRecheck

**false。** 交付文本与 SA8 已裁定 clear（焦点表 A1–A14）的设计建议措辞逐字节一致，未引入任何新决策面接触；规范面（ADR 0016/0008、CONTEXT）零触碰；无新 ADR 冲突风险。
