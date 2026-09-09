# SA2 设计攻击评审 — Issue #274 文档同步：typed-access 与 docs/integration 覆盖 readData 语义 schema 投影（ADR 0016）

- 被审对象：SA1 设计 `wiki/raw/task_issue-274_design.md`（iteration 0，256 行，D1–D7 + §6–§8 措辞级方案）
- 评审人：SA2（mabf-sa2，design-review，iteration 0，dispatch `sa-efe2c2b5-27aa-45f6-82ab-7a7c860a7a05`）
- Worktree：`/home/wangjian/nomicore-fix-issue-274`（branch `mabf/issue-274`，HEAD `6ab8c87`；评审会话零生产/测试/SA1 文档改动，唯一写产物 = 本文件）
- 裁决：**approve**（0 MAJOR / 0 MINOR；1 × 已确认勘误 LOW（F-1，SA8 已移交 SA3 文本匹配缓解）+ 3 × 观察/可选润饰。设计可在不修订的前提下进入实现）

## 1. Reviewed inputs

| 输入 | 状态 |
|---|---|
| 任务简报 `wiki/raw/task_issue-274.md`（What to build 六要点 + AC1–AC3；Blocked by #273 已合入 HEAD） | 亲读 |
| SA1 设计 `wiki/raw/task_issue-274_design.md` | 全文亲读 |
| SA6 验收契约 `wiki/raw/task_issue-274_sa6_contract.md`（approve；7 红 + 21 负控 + 夹具） | 亲读 |
| SA8 设计后冲突复审 `wiki/raw/task_issue-274_design_conflict_report.md`（clear；焦点表 A1–A14 + 3.2 表；requiresConflictRecheck=false） | 亲读 |
| dispatch `wiki/raw/task_274_dispatch.md` | 亲读 |
| Issue comments | **空**（dispatch 记录 REST = `[]`；无 owner 要求需并入） |
| 母法亲核：`docs/adr/0016-readdata-semantic-schema-projection.md` 全文 98 行（L8/L19/L22/L30–42/L55/L69–70/L77/L81/L91–92）、`docs/adr/0008-…md` 修订节 L167–177、`CONTEXT.md` L33–39（Data + 语义 schema 投影词条含 _Avoid_） | 亲读 |
| 行为面亲核：`packages/namespace-runtime/src/runtime.ts`（`NamespaceRuntimeReadDataResult` 成功分支恰 `{ ok: true; value: unknown; schema: ReadDataSchemaProjection \| null }`）、`packages/vfsl/src/index.ts`（`ReadDataSchemaProjection` 公开导出） | 亲读 |
| 契约面亲核：red（7 tests）/ control（21 tests）/ fixture 三文件全文（matcher 正则逐条） | 亲读 |
| 作用域文档亲核：`typed-access.md`（153 行全文）、`cordis-plugin-hosting.md`（L1–10/L28–75/L300–370/L412）、`external-project-vfsl-codegen.md`（L1–5/L245–295/L345–355 + 4 处「投影」命中） | 亲读 |

评审方式（比 #273 SA2 进一步）：除只读核验外，本评审**复跑了契约基线**并对设计措辞做了**机械化模拟验证**——把 §6 新节（逐字转写）+ D6 子弹 + §7 注记替换 + §8 可选段在内存中应用到三个作用域文档，直接调用 SA6 冻结夹具的 8 个 matcher 断言（脚本置 `/tmp`，仓库文件只读，无工作区写入）。这把「设计措辞是否真能让红转绿、是否会误触负控」从推断变成了实测。

## 2. 独立验证结果（本会话实测）

| 验证项 | 方法 | 结果 |
|---|---|---|
| 契约基线复现 | `vitest run …sync-red.test.ts …sync-control.test.ts` | **7/7 红 + 21/21 绿**，与 SA6 §13/SA8 §2 一致 |
| 设计措辞 → R1–R7 | 内存模拟（§6+§7 必改面；§8 省略） | **全绿**（R1–R6 由新节满足，R7 违规清空） |
| 设计措辞 → 负控保持 | 同上 + 全推荐终态（§6+D6+§7+§8） | **全绿**：三文档 stale 注记 0、`readData(…,…)` 带参 0、`VfslPathMap`/`--check` 在场 |
| 锚真实性（非既有内容偶然满足） | 变异探针：删除 aliasDocs bullet | R3 转红——锚是承重的，且失败是**响亮**的（SA3 立即看见），非静默漂移 |
| 相对链接可达 | 文件系统实测 | `../../../docs/adr/0016-…`（自 `.agents/skills/nomicore/`）与 `../adr/0016-…`（自 `docs/integration/`）均存在 |
| D6 锚 slug | GitHub slug 规则推导 | `Read result: value plus semantic schema projection` → `read-result-value-plus-semantic-schema-projection`，与设计 proposed anchor 逐字一致 |
| D6 子弹定位唯一性 | 精确文本计数 | 全文恰 1 处（文本匹配可作可靠定位器） |
| 插入点/替换点行号 | 逐行核对 | §6 插入点 L106（"Use paths and values…"）/L108（`## Mutation policy`）✓；§7 L340–341 ✓、L360 不动 ✓；§8 L286 段 ✓；cordis L320–321「说明 + 注记」先例 ✓ |
| 作用域完备性 | 全仓 grep（md，排除 wiki/） | `readData` 消费面 = typed-access L43、replication L90（无形状断言）、根 AGENTS.md L31（无形状断言）、CONTEXT L34/L38/L92、cordis L340/L360、external L253/L349、ADR 0008 L14/L167–173、ADR 0016——**无漏列站点**；hub-peer-deployment / local-package-linking 0 命中 ✓ |
| 过时注记全仓扫描 | `grep -rEn "// *\{ *ok *: *true" --include="*.md"`（排除 wiki/raw） | 恰 2 命中：cordis L341（矛盾站点）+ ADR 0016 L55（规范自身示例，不在契约扫描面）——设计 §2 行 6「全仓唯一」陈述属实 |
| 两键全等**散文**残留（注记之外的矛盾陈述） | `grep "ok: true, value }"` | 恰 ADR 0008 L173（「演进为」历史句，正确）+ ADR 0016 L8（动机历史句，正确）——消费文档无残留 |
| md lint / 格式化 CI 门 | `.github/workflows`（仅 ci.yml）+ package.json scripts | 无 markdown lint/prettier 门——新文本无隐藏风格门风险 |
| 文档敏感测试面 | grep `cordis-plugin-hosting|typed-access` 于 *.ts | 恰 SA6 三文件——无第四个消费这些文档的测试会被新节意外影响 |
| 冻结面 | `git status` | 仅 SA6 契约 3 文件 + wiki 输入/产物 untracked；生产/规范面零改动 ✓ |
| 环境入口 | vitest.config.ts include / package.json L11/L13 | 与设计 §2/§12 引用一致 ✓ |

## 3. Verdict

**approve。** 设计主线（新增「Read result」小节 + cordis 注记同步 + 两项可选加法）在三个独立层面全部成立：

1. **机械层（实测）**：设计逐字措辞让 R1–R7 全绿、负控全绿，且在「省略 §8」与「全采纳 §8/D6」两种终态下同样成立——精确兑现 SA6 §15 的措辞/修法/可选项自由度承诺，无「设计说能绿、实测不能绿」的缺口。
2. **语义层（逐句对照 ADR 0016）**：§6 五段/§7 注记/§8 段对 L8（agent 解读 + 读后 mutation 动机）、L19（恰三键）、L22（null 三情形穷尽单义 + ok 恒真）、L30–39（四键：ref 按名保留/传递闭包自包含递归安全/切片）、L42（键规约三表同构 + `'<item>'/'<key>'/'<member N>'` 文法逐字一致）、L69–70（always-on/detached 深拷贝零缓存）、L77（加法兼容）逐义转述，无 opt-in 暗示、无 null 误读、无 ADR 0008 D8 修订节回退、无「live 引用可共享」暗示（与 CONTEXT _Avoid_ 三条同向）。
3. **范围层**：ALLOW ⊆ Issue 范围且覆盖全部 readData 消费站点；DENY 正确冻结规范面/行为面/SA6 契约；docs/AGENTS 四项纪律（词汇精确、链接权威源、不发明实现行为、验证面）全部入设计。

## 4. 需求覆盖（验收义务逐条）

| Requirement（简报六要点/AC/契约） | Design section | Assessment |
|---|---|---|
| 要点① 成功读 `schema` 字段形态（四键投影体） | §6 段 1–2（R2/R3） | 落实（模拟实测绿；三 bullet 同块满足 R3，设计自带「不插空行」实现注意） |
| 要点② docs 切片与派生 schema 文档三表同构键规约 | §6 段 3（R4） | 落实（isomorphic/synthetic 锚 + 文法段逐字贴 ADR L42） |
| 要点③ 「null 不是读的失败」判读 | §6 段 4（R5）+ §7 说明注释 | 落实（三情形枚举 + "not as an error"） |
| 要点④ 读后修改凭投影构造合法 mutation | §6 段 5（R6） | 落实（schema projection + mutateData 同段；衔接 Mutation policy 词汇） |
| 要点⑤ 范围 = typed-access + docs/integration 消费文档 | §10 文件范围 | 落实（grep 复核无漏列；作用域外零改动有据） |
| 要点⑥ 现有示例加法兼容、陈述不与 ADR 0016 矛盾 | §5 D4/D5、§7、§12 负控行 | 落实（示例代码零改动；唯一矛盾站点 L341 修正为 R7 明令；`.ok`/`.value` 消费者不受影响——ADR L77） |
| AC1 typed-access 形态/null/消费 | §6 + §12 R1–R6 | 落实（模拟实测） |
| AC2 docs/integration 无矛盾 | §7 + §8 + §12 扫描行 | 落实（全仓注记/散文扫描复跑，无残留站点遗漏） |
| AC3 全仓双绿 | §12 AC3 行 | 落实（md-only 改动不进 tsc Program；红契约转绿后 `pnpm test` 不再有本票失败项） |
| SA6 §15.1–15.5 五项自由度 | D2/D3/D4/D6/§6 深拷贝告诫 | 全部落在留白内（英文规范词形、三键注记修法、external 可选、根 AGENTS 不动） |
| SA8 移交 §8.1–8.5 | — | F-1 确认（见下）；其余观察项与本评审 N-2/N-3 重合，无新增义务 |

目标/非目标无静默扩大：非目标 3 条（不改代码/规范、不发明宿主义务、不越作用域）与 docs/AGENTS「documentation-only 不得发明行为」及 Issue 范围一致。

## 5. Owner 评论覆盖

Issue comments 经 REST 当前读取为空（dispatch 记录 `[]`；SA6 §2 / SA8 §2.19 三处同口径）。**无 owner 评论要求需并入，本表无行。** 设计 §4 处理正确：执行标准唯一来源 = 简报六要点 + AC1–AC3。

## 6. 攻击记录（尝试攻破设计的角度与结果）

| # | 攻击角度 | 结果 |
|---|---|---|
| A1 | 措辞不足攻击：建议文本某锚不满足 matcher → 实现期才发现转不了绿 | **失败**。模拟实测 R1–R6 全绿；四个匹配器段落锚（shape/fourKey/keyConvention/nullSemantics/consumption）逐正则对照，含 `\b` 边界与反引号容忍的边界情形（bullet 内 `` `valueSchema`` `` 词边界成立） |
| A2 | 负控绊线攻击：新文本误触 `staleAnnotationViolations` / `readDataOptionUsages` → 实现把负控改红 | **失败**。行内 `{ ok: true, value, schema }` 无 `//` 前缀（该 matcher 未锚定行首但要求 `//` 前导，模拟 0 违规）；`readData()`/`readData(path)` 无逗号第二实参；§7 中文说明注释的全角括号（）不匹配 ASCII `\(`；链接 URL 无 `//`+`{ok:true` 复合形 |
| A3 | 段落结构攻击：bullet 被空行切开 → R3 锚分离且静默 | **失败（攻不破）**。设计 §6 实现注意 1 + §13 已列；变异探针证明失败形态是 R3 红（响亮），契约会当场拦截 |
| A4 | 语义漂移攻击：opt-in 暗示 / null 误读 / D8 回退 / live 共享暗示 / 载体词汇混入 | **失败**。逐句对照 ADR 0016 L19/L22/L69–70/L81/L91 与 CONTEXT _Avoid_ 三条，全部避让；「值缺席照常返 schema」「空路径 ROOT」等次级语义未被误述（未被陈述 ≠ 被错述，最小同步边界内可接受） |
| A5 | 范围遗漏攻击：存在设计未列的 readData 消费/矛盾站点 | **失败**。全仓 grep（含 case-insensitive 复核、两键散文扫描、packages README）无漏列；唯一命中偏差 = D6 行号 L44→L43（F-1，勘误级） |
| A6 | 链接/锚攻击：相对路径错层或 slug 拼错 → 死链或锚漂移 | **失败**。两链接实测可达；slug 推导与 D6 anchor 逐字一致；typed-access 无 TOC、无他文锚引本节（根 AGENTS.md 引用无锚） |
| A7 | 隐藏 CI 门攻击：md lint/format/prettier 拒绝新文本 | **失败**。仅 ci.yml，无 md lint；`git diff --check` 已入 §12 验证面 |
| A8 | 加法兼容性攻击：示例行为或消费面被改变 | **失败**。cordis 代码行不动（仅注记替换 + 注释新增）；L360/external 示例零改动；`.ok`/`.value` 消费路径不受影响 |
| A9 | 冻结面攻击：设计触碰契约/规范/行为文件 | **失败**。ALLOW 全为 `.md` 消费文档 + 设计产物自身；git status 实测冻结面零改动 |
| A10 | 义务遗漏攻击：AC/要点/SA6 自由度/SA8 移交项有未映射者 | **失败**。§4 映射表逐条对上；SA8 §8 五条移交项全部被设计文本或本评审吸收 |

## 7. Findings

### F-1（LOW，勘误确认，非阻塞）— D6 行号 off-by-one

设计 D6 称适配器子弹位于「现 L44」，实测为 **L43**（`grep -n` + 亲读；SA8 §8.1 已发现并移交 SA3）。本评审补充两点使其确认为非阻塞：

- 子弹原文全仓唯一（机械计数恰 1 处），文本匹配是可靠定位器；
- D6 本身为可选推荐项，即使 SA3 误置，红/负控面不受影响（交叉指针不承载任何 matcher 锚——模拟 E1/E2 双终态绿已含此分离验证）。

**Required action**：无（设计不必修订；SA3 落位以文本匹配为准——SA8 移交指令已覆盖）。

### N-1（nit，可选润饰）— §6 段 1 对 CONTEXT.md 词条提及未加链接

「see the 语义 schema 投影 entry in `CONTEXT.md`」为纯文本提及。docs/AGENTS「链接权威源」的硬对象是规则复制，ADR 0016（规则权威源）已链接，故**不构成违规**；但补 `../../../CONTEXT.md` 相对链接是一行成本的可用性增益。**Required action**：无（SA3 可选采纳；若采纳须与 §12 链接检查行一并核验）。

### N-2（observation，与 SA8 §8.3 重合）— §7 注记为键名示意而非字面序列化

`schema: { valueSchema, aliases, docs, aliasDocs }` 是键名示意。与同文件 L320–321「说明 + 精确注记」先例风格一致，且键集与行为锚实测（own keys 恰四键、非 null）精确一致、非虚构；R7 只锁「注记含 schema」。对读者无实质误导风险。**Required action**：无。

### N-3（observation，与 SA8 §8.1 重合）— 行号区间端点舍入

设计引 ADR 0008 修订节 L167–178（SA6 作 L167–177）、SA6 引 CONTEXT「Data」L34（实测 L33–35）。内容锚本评审逐字亲核一致，端点舍入无语义影响。**Required action**：无。

## 8. 残余风险与测试构想（移交 SA3/SA4）

1. **SA3 改写句式丢锚**（设计 §13 已列）：红契约逐条断言消息点名缺失锚——建议 SA3 逐字采用 §6/§7 建议文本，任何改写后立即复跑 red 文件（秒级）。
2. **两种终态都须验证**（§12 已列）：含/不含 §8 各跑一次 red+control（模拟已证明两者皆绿，实现后实测确认即可）。
3. **SA4 语义评审焦点**：§6 段 1 括注「(value domains, literal unions, constraints)」是对 ADR L8/L10「值约束 + 文档注释」的举例式转述（文档注释维度由四键 bullet 承载）——确认无「语义仅限值约束」的窄化误读即可。
4. **链接与空白终检**：两处新相对链接可达 + `git diff --check` 干净（docs/AGENTS 验证面，§12 已映射）。

## 9. requiresConflictRecheck

**false**（SA2 侧）。

- SA8 设计后冲突复审已裁定 **clear**（0 hard-conflict / 0 override / 0 evolution-required），其焦点表 A1–A14 即设计 §15 所请「措辞保真复查」的完整闭合；
- 本评审以独立逐句对照 + 机械模拟复核同一谓词，未发现任何语义漂移或新决策面接触；设计不触碰任何冻结面；
- 实现期漂移由常驻机械门兜底（R1–R7 + 21 负控 + AC3 双绿）——若实现偏离至负控反向区（带参读面、两键注记、null 误读），契约直接红灯，届时再触发复查（与 SA8 §10 结论一致）。

## 10. 评审环境与清理

- 基线复跑与模拟全部进程内完成（vitest 单次 1.37s；模拟脚本 `/tmp/sa2-sim/sim.mjs` 置工作区外，仓库文件只读）；无后台进程、无临时 repo 内文件。
- `git status` 终态 = 评审前状态 + 本文件（`wiki/raw/task_issue-274_sa2_review.md`）；零生产/测试/SA1 文档改动。
