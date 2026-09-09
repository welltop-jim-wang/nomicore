# SA9 Standards 审查报告 — Issue #274（文档同步：typed-access 与 docs/integration 覆盖 readData 语义 schema 投影，ADR 0016）

> SA9（独立 Standards 审查者）standards-review 轮产物。dispatch
> `sa-cf12ff3d-ff33-4f4e-807c-5e4822599cca`，phase standards-review，iteration 0。
> **Worktree**: `/home/wangjian/nomicore-fix-issue-274`（branch `mabf/issue-274`）。
> **被审对象**: 已提交 HEAD `6770ae0164f23d07fec53faa98b7549692fe65a7`
> （`docs: clarify readData schema projection guidance`）的完整交付 diff
> `6ab8c87..6770ae0`——13 文件 +1471/−2（`git show --stat` 本轮亲证）：3 个消费文档
> （+22/−2）、SA6 冻结契约三文件（red/control/fixture，+478）、7 个 wiki/raw 流水线
> 产物。父提交 `6ab8c87b79df063fefe67fc8f357c8066d5bd3cf`（#273 合并提交 = dispatch
> 声明的 authoritative parent base，PR #271 docs/adr-0016-readdata-schema 支系头，
> `git rev-parse HEAD~1` 亲证一致）。工作树除未跟踪简报 `task_issue-274.md` 外干净。
> **Issue 评论输入**: dispatch 明示 REST 当前读 = `[]`；简报 §Comments、SA6 §2、
> SA8 §2.19（双通道实测）、SA2 §5、SA4 §1 五处同口径——无 Owner 追加要求需并入。
> **输入产物（全部亲读）**: `task_issue-274.md`（简报，What to build 六要点 +
> AC1–AC3）、`task_274_dispatch.md`、`task_issue-274_design.md`（SA1，256 行全文，
> D1–D7 + §6–§8 措辞级方案 + §10 ALLOW/DENY）、`task_issue-274_sa2_review.md`
> （approve，0 MAJOR/MINOR，F-1 LOW + N-1~N-3）、`task_issue-274_sa3_impl.md`、
> `task_issue-274_sa4_review.md`（approve，0 BLOCKER/MAJOR，O-1–O-4 非阻断）、
> `task_issue-274_sa6_contract.md`（approve，7 红 + 21 负控 + 夹具）、
> `task_issue-274_design_conflict_report.md`（SA8 设计后复审，clear，A1–A14 +
> 3.2 表共 24 行对照）、母法 `docs/adr/0016-…md` 全文 98 行、`docs/AGENTS.md`、
> 根 `AGENTS.md`、`packages/namespace-registry/AGENTS.md`、行为事实源
> `packages/namespace-runtime/src/runtime.ts` L118–129 与 `packages/vfsl/src/index.ts`
> L126、`CONTEXT.md` L33–39 词条。
> **审查方式**: 独立取证，非结论复用——交付 diff 全文亲读（`git diff 6ab8c87 HEAD`）
> 并对照 SA1 §6–§8 建议措辞逐字核验；全仓陈旧注记扫描（`grep -rEn "// *\{ *ok *: *true"
> --include="*.md"`，排除 wiki/raw）复跑；作用域三文档 `readData(…, …)` 带参扫描；
> 新相对链接文件系统实测；`git diff --check 6ab8c87 HEAD`（exit 0）；契约测试计数清点
> （red 7 / control 21）与 `.only/.skip/.todo` 扫描（零命中）；标题 slug 推导与唯一性
> 核验；提交内容 vs SA4 批准面一致性核对。未运行测试、未启动服务（SA9 纪律）；零
> 代码/设计/测试改动；零 commit/push/PR；唯一写入 = 本文件。
> **职责面**: 只判断实现是否符合仓库 AGENTS、ADR、模块责任、既有架构惯例、单一事实源、
> 生命周期对称性、文件范围与测试质量标准；Issue 需求完整实现归属 SA10。

---

## Verdict

**approve**（`requiresConflictRecheck: false`）

- **0 BLOCKER / 0 MAJOR / 0 MINOR**。交付在 AGENTS 链与 docs 纪律、ADR 0016 保真、
  模块责任、架构惯例、单一事实源、生命周期对称性、文件范围、测试质量八个 standards
  面全部合规（§1–§8）。
- 交付 diff 与 SA4 批准面**逐字一致**（§8 亲证）：SA1 §6–§8 建议措辞原样落位，
  ALLOW 三行精确兑现（两必改 + 两可选推荐全采纳），DENY 面零触碰。
- SA6 冻结契约三文件**未被修改**地随文档改动一并入库（red 恰 7 tests / control 恰
  21 tests / fixture 无 `.test.ts` 后缀不被收集），兑现 SA4 O-2 的 commit 同纳要求。
- 流程面合规：SA6 契约 approve → SA1 设计（自报复查）→ SA8 设计后复审 clear →
  SA2 approve → SA3 实现 → SA4 approve——审查链完整，无跳级、无未决阻断项。

---

## 1. AGENTS.md 链与 docs/AGENTS.md 编辑纪律

| 规约 | 本轮亲证 | 判定 |
|---|---|---|
| docs/AGENTS「Use repository vocabulary exactly」 | 新文本词形取自既有词条：英文正文 "semantic schema projection" = CONTEXT.md L37 词条名原文（`语义 schema 投影（semantic schema projection）`，亲读）；"A null schema is not a read failure" = ADR 0016 L22 规范判读语英译；中文注记「语义 schema 投影」「不是读的失败」= CONTEXT/ADR 词形。零新术语发明（CONTEXT 同改义务不触发，SA8 3.2 行 6 同裁） | ✅ |
| docs/AGENTS「Link to the authoritative source instead of copying its rules」 | typed-access 新节首段即挂 `[ADR 0016](../../../docs/adr/0016-readdata-semantic-schema-projection.md)`；external 新段挂 `[ADR-0016](../adr/0016-…md)`（该文件首个 ADR 链接，风格取自同目录 cordis `[ADR-0006](../adr/…)` 先例）。两相对路径均实测可达（`test -f` 亲证目标存在；上溯层级正确）。规范陈述以链接挂接、转述从简，无整段规则复制 | ✅ |
| docs/AGENTS「documentation-only wording changes must not invent implementation behavior」 | 全部新陈述逐句可追溯至 ADR 0016（§2 表）与行为事实源 runtime.ts L123–127（成功分支恰 `{ ok: true; value: unknown; schema: ReadDataSchemaProjection \| null }`，亲读）；cordis 新注记键集与 SA6 行为锚实测（own keys 恰四键、非 null）一致——非虚构。Completion gate（typed-access L167）零改动，未给宿主发明新验证义务（设计 D1 否决项保持） | ✅ |
| docs/AGENTS 验证面「Check links / search stale terminology / `git diff --check`」 | 链接两处实测可达；全仓 `// { ok: true` 扫描（排除 wiki/raw）恰 2 命中 = cordis L343（已修正、含 schema）+ ADR 0016 L55（规范自身示例，契约扫描面外）——零残留矛盾站点；`git diff --check 6ab8c87 HEAD` exit 0 | ✅ |
| docs/AGENTS「Amend or supersede prior decisions explicitly instead of silently contradicting」 | cordis L341 旧两键全等注记（被 ADR 0016 修订掉的旧事实陈述、全仓唯一矛盾站点）被显式同步为三键形状；规范面（ADR 0016/0008、CONTEXT）零改动——文档向决策对齐，非反向修订 | ✅ |
| 根 AGENTS.md「Typed Namespace writes — mandatory」节 | typed-access 的生成/接线/负向夹具/mutation 纪律全文保留（diff 上下文行亲证：`VfslPathMap`、`--check`、`PathAt`/`PathPatchValue` 等核心内容在场；负控「核心内容保持」锁定的正是此面）；新节为纯加法插入，并明示「Static `PathAt` / `PathPatchValue` types remain the compile-time authority」——与根纪律同向，无稀释 | ✅ |
| `.agents/` 嵌套指引 | `.agents/` 下无 AGENTS.md（实测仅 `skills/` 与 `WORKTREES.md`）——typed-access.md 由根 AGENTS.md 管辖，无更细粒度规约被触犯 | ✅ |

## 2. ADR 0016 保真（交付文本逐句对照决策节）

| 交付断言（committed 文本） | ADR 0016 锚 | 判定 |
|---|---|---|
| 「Every successful `readData(path)` returns `{ ok: true, value, schema }`」（typed-access L110） | L19 结果形状；"Every successful" 限定准确，失败分支（L23）未被触碰或误述 | ✅ |
| 四键 bullet：valueSchema「refs kept by name, not inlined」/ aliases「transitive closure … self-contained, recursion-safe」/ docs+aliasDocs「relevant slices」（L112–116，同块无空行） | L30–39 投影体接口逐义对应；ref 按名保留 = ADR 0003 §4 同款纪律 | ✅ |
| 「keys of `docs` and `aliasDocs` are isomorphic … absolute syntax paths plus `'<item>'/'<key>'/'<member N>'` synthetic segments … anchored by alias name」（L118） | L42 键规约文法逐字一致 | ✅ |
| null 三情形（no active schema / path strays outside / static resolution fails）+「A null schema is not a read failure: `ok` stays true」+「not as an error」（L120） | L22 三情形穷尽单义 + ok 恒真；无 `schemaIssue` 子通道暗示（被否备选 L87 未回潮） | ✅ |
| 「Every read returns a detached deep copy; do not cache or share projections across reads」（L120 末） | L70 交付纪律；与 CONTEXT L39 _Avoid_ 同向 | ✅ |
| 「construct a legal `mutateData()` mutation」+「Static types remain the compile-time authority; runtime projection serves dynamically read values and agent-style consumers」（L122） | L8 动机原文 + L77 加法兼容；未把运行时投影抬升为类型替代品（ADR 0005 SSOT 纪律不触） | ✅ |
| cordis L340–341 中文说明（三键恰形 + null 判读 + ADR 0016 指向）+ L343 注记 `// { ok: true, value: 'first', schema: { valueSchema, aliases, docs, aliasDocs } }` | L19/L22/L30–39；键集与行为锚实测精确一致（SA8 §8.3/SA2 N-2 已裁示意注记非虚构） | ✅ |
| external L288 段「`null` 不是读的失败」「加法兼容的演进，不改变本页示例」 | L22 + L77 逐义转述 | ✅ |
| 全作用域无 `readData(path, …)` 带参/opt-in 形式 | L69 always-on + L81 备选否决；本轮 grep 亲证三文档零命中 | ✅ |
| ADR 0008 D8 修订节无回退表述 | 交付不重述旧两键形状、不暗示 live 引用出站（A5 深拷贝告诫恰为修订后语义的消费方转述） | ✅ |

## 3. 模块责任与既有架构惯例

| 检查项 | 本轮亲证 | 判定 |
|---|---|---|
| 改动性质 | 纯 Markdown 文档同步 + SA6 契约测试入库；`packages/**` 生产代码、`apps/**`、`domains/**` 零改动（diff 亲证）——本票零行为义务（#273/#272 已交付行为面） | ✅ |
| 契约测试放置 | `packages/namespace-registry/test/`：行为锚按 cordis 示例真实装配 `registry.create → lease.readData`，归属 registry 包「host-level owner of namespace runtimes, leases」责任面（包 AGENTS 亲读）；#273 SA6 同址先例；vitest `include: ['packages/*/test/**/*.test.ts']` 真实收集 | ✅ |
| 文档风格惯例 | cordis「说明 + 精确注记」对齐同文件 L320–321 先例；typed-access 新节为既有 8 个 `##` 小节同构结构，标题无 slug 冲突（`^## ` 清单亲证唯一）；插入位置 Process/Program wiring → **Read result** → Mutation policy 阅读流与设计 D1 一致 | ✅ |
| 流水线惯例 | wiki/raw 产物随票入库与 #273 合并提交先例一致（`git show 6ab8c87 --stat` 含 10 个 wiki 产物，亲证）；简报 `task_issue-274.md` 未跟踪与 #273 简报同款终态（`git ls-files` 亲证 273 简报亦未入库） | ✅ |

## 4. 单一事实源

| 事实 | 权威源 | 派生面 | 漂移风险 |
|---|---|---|---|
| 读结果形状 / null 语义 / 键规约 / 交付纪律 | ADR 0016（规范）+ runtime.ts L123–127（行为） | 三消费文档为链接挂接的转述，非第二份规范文本；负控「权威源健全性」常驻锁 ADR 0016 在场 | 无（无平行规范副本；R1–R7 + 21 负控常驻防回潮） |
| 仓库词汇 | CONTEXT.md L37 词条 | 文档词形逐字取自词条/ADR | 无 |

## 5. 生命周期对称性

**不适用**——纯文档改动，无 acquire/release、无后台任务、无状态机、无资源面。文档面
「失败模式 = 与 ADR 矛盾」由常驻契约 + 评审捕获，回滚 = `git revert`（纯文本、零耦合）。

## 6. 文件范围（ALLOW/DENY 对照交付 diff）

| 交付路径 | 设计 ALLOW/DENY | 本轮亲证 | 判定 |
|---|---|---|---|
| `.agents/skills/nomicore/typed-access.md`（+17/−1） | ALLOW 第 1 行（必改 §6 新节 + 可选 D6） | 新节 L108–122 + L43 子弹交叉指针；既有内容零删改（唯一删除行 = D6 子弹替换） | ✅ |
| `docs/integration/cordis-plugin-hosting.md`（+3/−1） | ALLOW 第 2 行（必改 §7；L360 不动） | L340–341 两行说明 + L343 注记替换；调用行 L342 与 L362 `readData(['count'])` 原样（diff 上下文亲证） | ✅ |
| `docs/integration/external-project-vfsl-codegen.md`（+2/−0） | ALLOW 第 3 行（可选推荐 §8） | L288 新增一段；§5/§6 示例代码零改动 | ✅ |
| SA6 契约三文件（red/control/fixture，新增入库） | DENY「实现不得改契约」+ SA4 O-2「commit 同纳」 | 内容未被修改地入库：red 恰 7 tests（R1–R7 四 describe）、control 恰 21 tests、fixture 无 `.test.ts` 后缀；`.only/.skip/.todo` 零命中；与 SA6 §12–14、SA2 §2、SA8 §3.1 A9 三方引用一致 | ✅ |
| wiki/raw 7 产物（dispatch/设计/SA8/SA2/SA6/SA3/SA4） | 流水线固定产物 | 与 #273 入库先例一致 | ✅ |
| DENY 面：`docs/adr/**`、`CONTEXT.md`、`packages/**` 生产码、`apps/**`、`domains/**`、`tests/**`、根 `AGENTS.md`、其余 skill/integration 文档、README | 冻结 | 交付 diff 零命中（`git diff --name-only` 亲证） | ✅ |

## 7. 测试质量标准

| 检查项 | 本轮亲证 | 判定 |
|---|---|---|
| 红契约断言对象 | red 7 tests 对仓库真实文档内容施加 fixture matcher（段落级内容锚），断言消息逐条点名缺口——非源码字符串断言、非空转扫描（fixture 头注 +  matcher 正则亲读） | ✅ |
| matcher 敏感性 | control 含正样本 6 / 负样本 9（含 typed-access 现状段回归负样本，防初版伪绿回潮）双向校验；行为锚断言 `Object.keys` 排序精确集合（非弱化 toMatchObject） | ✅ |
| 行为锚真实性 | control 行为锚按 cordis 示例真实装配 Registry（Cordis Context + stub persistence），实测三键 + 四键投影体——R7 矛盾钉在真实运行时输出上 | ✅ |
| 削弱标记 | 三契约文件 `.only`/`.skip`/`.todo` 零命中 | ✅ |
| 收集入口真实性 | 两 `.test.ts` 命中根 vitest include；fixture 无后缀不收集（vfsl/readdata 夹具命名先例） | ✅ |
| 执行证据 | SA3 实测：基线 7/7 红 → 两种终态（含/不含 §8）各 7/7 绿 + 21/21 绿；registry 全套件 412/412；`pnpm typecheck` exit 0。SA9 按纪律不复跑测试，静态面（matcher × 交付文本手工施加、链接、扫描）本轮独立复核全部成立 | ✅ |

## 8. SA4 批准面 == 已提交 HEAD（一致性核验）

SA4 于 6ab8c87 工作树批准未提交改动（§4 自述与设计建议文本逐字节一致）；本轮核验
`git diff 6ab8c87 HEAD`：三文档 +22/−2 与 SA4 §4/§6 计数一致；§6 新节五段、D6 子弹
（L43 文本匹配落位，SA8 §8.1 勘误已兑现）、§7 四行、§8 一段均为设计 §6–§8 建议措辞
原样；D6 锚 slug `#read-result-value-plus-semantic-schema-projection` 与 L108 标题
GitHub slug 推导逐字一致。**批准面与提交面零偏差；契约文件按 O-2 要求同纳。**

## 9. Findings 与 Non-blocking observations

**0 BLOCKER / 0 MAJOR / 0 MINOR 修订项。** 以下为非阻断观察（无 Required action）：

- **O-1（nit，流程）**：提交消息 `docs: clarify readData schema projection guidance` 未携带
  `(#274)` 引用（SA3 建议消息为 `docs(#274): …`；近期 `fix(#273)…(#278)`、`fix(#272)…(#277)`
  有引用惯例，但 `docs(adr): ADR 0016 …`（a6b2a79）亦无引用）。根/docs AGENTS 均未规定
  提交消息格式——非文档化标准违规，仅记观察。
- **O-2（流程，SA4 O-1 同项回流）**：AC3 全仓 `pnpm test` 终态门未在任何会话执行（SA3 按
  skill 边界移交总控/SA7；已执行面 = typecheck exit 0 + registry 412/412 + 契约双终态绿，
  覆盖全部可受影响面；md 改动不进 tsc Program，静态风险为零）。SA9 纪律不运行测试；
  该项属 SA7/总控终态验证面，非 standards 阻断。
- **O-3（观察）**：简报 `wiki/raw/task_issue-274.md` 仍未跟踪——与 #273 简报终态同款
  （`git ls-files` 亲证 273 简报亦未入库）；wiki/raw 为证据面非规范契约（docs/AGENTS），
  收纳节奏属总控。
- **O-4（观察）**：SA2 N-1（CONTEXT 词条提及可补相对链接）SA3 未采纳——nit 级可选项，
  SA2 自判不构成违规；维持不处理。

## 10. requiresConflictRecheck

**false。** 交付文本与 SA8 已裁定 clear（焦点表 A1–A14 + 3.2 表 24 行全对照）的设计建议
措辞逐字一致；规范面（ADR 0016/0008、CONTEXT）零触碰；无新决策面接触；SA2 §9 与
SA4 §13 同裁 false。实现期防回潮由常驻机械门兜底（R1–R7 + 21 负控 + AC3 终态门）。

## 11. 本轮独立取证命令留痕

```
git show --stat HEAD                                  # 13 文件 +1471/−2
git rev-parse HEAD~1                                  # 6ab8c87… = dispatch 声明 base
git diff 6ab8c87 HEAD -- <三文档>                      # 交付措辞全文亲读
git diff --check 6ab8c87 HEAD                         # exit 0
grep -rEn "// *\{ *ok *: *true" --include="*.md" .    # 恰 2 命中（修复站点 + ADR 自身）
grep -nE "readData\s*\([^)]*," <三文档>                # 0 命中（无 opt-in 带参）
test -f docs/adr/0016-readdata-semantic-schema-projection.md  # 链接目标存在
grep -n "语义 schema 投影" CONTEXT.md                  # L34/L37 词条在场
git show HEAD:<契约三文件> | 计数/扫描                  # red 7 / control 21 / 无 only·skip·todo
sed -n '118,129p' packages/namespace-runtime/src/runtime.ts   # 行为事实源三键形状亲读
git ls-files wiki/raw/                                # 入库先例与简报终态核对
```
