# SA10 Spec 审查 — Issue #274 文档同步：typed-access 与 docs/integration 覆盖 readData 语义 schema 投影（ADR 0016）

- 被审对象：committed HEAD `6770ae0164f23d07fec53faa98b7549692fe65a7`（branch `mabf/issue-274`，单提交「docs: clarify readData schema projection guidance」）
- 权威母基线：PR #271 docs/adr-0016-readdata-schema @ `6ab8c87b79df063fefe67fc8f357c8066d5bd3cf`（实测 `git merge-base --is-ancestor` 成立，HEAD = base + 恰 1 提交）
- 审查人：SA10（mabf-sa10，spec-review，iteration 0，dispatch `sa-cd4eb4b9-3309-4102-9fb8-7b6a30777da4`）
- 裁决：**approve**（AC1/AC2 全满足且有终态实测证据；AC3 typecheck 直接实证、test 面按套件实证 + 零代码改动静态论证；0 关键未达成项；2 条 PR 披露项 + 2 条 MINOR 观察）
- 审查方式：只读静态审查（final diff 逐字节亲读、SA6 matcher 正则手工施加于交付文本、全仓扫描、链接与锚点核验、行为面源码对证）；未修改任何非审查文件、未运行测试、未启动服务

## 1. Reviewed inputs

| 输入 | 状态 |
|---|---|
| 任务简报 `wiki/raw/task_issue-274.md`（What to build 六要点 + AC1–AC3） | 亲读 |
| dispatch `wiki/raw/task_274_dispatch.md`（Issue comments REST = `[]`） | 亲读 |
| SA6 验收契约 `wiki/raw/task_issue-274_sa6_contract.md`（approve；R1–R7 红 + 21 负控 + 夹具） | 全文亲读 |
| SA1 设计 `wiki/raw/task_issue-274_design.md`（D1–D7、§6–§8 措辞级方案、ALLOW/DENY） | 全文亲读 |
| SA2 设计评审 `wiki/raw/task_issue-274_sa2_review.md`（approve；F-1 LOW + N-1~N-3） | 全文亲读 |
| SA8 设计后冲突复审 `wiki/raw/task_issue-274_design_conflict_report.md`（clear；A1–A14） | 全文亲读 |
| SA3 实现报告 `wiki/raw/task_issue-274_sa3_impl.md`（完成；7/7 转绿 + 21/21 保持 + 412/412 + typecheck exit 0） | 全文亲读 |
| SA4 实现审查 `wiki/raw/task_issue-274_sa4_review.md`（approve；0 BLOCKER/MAJOR/MINOR；O-1~O-4） | 全文亲读 |
| 母法 `docs/adr/0016-readdata-semantic-schema-projection.md`（98 行全文）+ ADR 0008 L167–178 修订节 + `CONTEXT.md` L33–39 词条 | 亲读/亲核 |
| 行为面 `packages/namespace-runtime/src/runtime.ts` L121–128（`NamespaceRuntimeReadDataResult` 成功分支恰 `{ ok: true; value: unknown; schema: ReadDataSchemaProjection \| null }`）、`packages/vfsl/src/index.ts` L126 公开导出 | 亲核 |
| 最终 diff（`git diff 6ab8c87..HEAD`，13 文件 +1471/−2）与 `git diff --check`（clean） | 实测 |
| Issue comments | **空**（dispatch 记录 REST = `[]`；SA6 §2/SA2 §5/SA8 §2.19 多处同口径；无 owner 要求需并入） |

## 2. 验收标准逐条裁决

### AC1 — typed-access 指引说明成功读的 `schema` 字段形态、null 语义与典型消费方式 → **满足**

交付：`.agents/skills/nomicore/typed-access.md` 新增 `## Read result: value plus semantic schema projection` 小节（L108–122，位于 Activation guards 末段 L106 与 `## Mutation policy` L124 之间，设计 D1 落点精确），外加 L43 Process item 6 子弹交叉指针（D6）。六要点逐项对证：

| What-to-build 要点 | 交付位置 | 本审核验 |
|---|---|---|
| ① 成功读 `schema` 字段形态（四键投影体） | L110 三键形状 + L112–116 四键 bullet（valueSchema/aliases/docs/aliasDocs，同块无空行） | 与 ADR 0016 L19/L30–39 逐义一致；与 runtime.ts L126 成功分支类型逐字同形 |
| ② docs 切片与派生 schema 文档三表同构键规约 | L118（isomorphic + `'<item>'/'<key>'/'<member N>'` synthetic segments + 别名名锚定） | 与 ADR 0016 L42 文法逐字对应 |
| ③ 「`schema` 为 `null` 不是读的失败」判读 | L120（三情形枚举 + "A null schema is not a read failure: `ok` stays true" + "not as an error"） | 与 ADR 0016 L22 三情形穷尽单义一致；无 null 误读、无 `schemaIssue` 子通道暗示 |
| ④ 读后修改凭投影构造合法 mutation | L122（schema projection + `mutateData()` mutation + 静态类型编译期权威归属） | 与 ADR 0016 L8 动机 + L77 加法兼容一致；未抬升运行时投影为类型替代品 |
| 挂接权威源 | L110 `[ADR 0016](../../../docs/adr/0016-readdata-semantic-schema-projection.md)` + CONTEXT 词条提及 | 链接目标实测存在（8409 bytes）；满足 docs/AGENTS「链接权威源而非复制规则」 |
| 深拷贝告诫（SA6 §15.4 允许的可选增值） | L120 末句「detached deep copy; do not cache or share projections across reads」 | 与 ADR 0016 L70 / CONTEXT _Avoid_ 同向 |

既有核心内容保持：L34/L77/L169 `--check`、L42/L89 `VfslPathMap` 等全部在场（grep 实测）——同步未吞掉既有指引（负控项满足）。

### AC2 — docs/integration 下涉及 readData 的示例与契约陈述同步，无与 ADR 0016 矛盾的描述 → **满足**

- **矛盾站点修复**：`docs/integration/cordis-plugin-hosting.md` 原 L341 两键全等注记 `// { ok: true, value: 'first' }`（全仓唯一与 ADR 0016 矛盾站点，SA6/SA2/SA8 三处 grep 互证）已替换为 L343 含 `schema` 的三键注记 + L340–341 两行中文说明（三键恰形 + null 判读 + ADR 0016 指向）。注记键集 `{ valueSchema, aliases, docs, aliasDocs }` 与负控行为锚对该示例的实测（own keys 恰四键、非 null）精确一致，非虚构。
- **加法兼容保持**：同页 L362 `readData(['count'])` 调用行零改动（无注记，原样）；`external-project-vfsl-codegen.md` §5/§6 示例代码零改动（`.ok`/`.value` 消费者不受影响，ADR 0016 L77 明文允许）；external L288 新增一句加法说明段（含 `[ADR-0016](../adr/…)` 链接，风格取自同目录 cordis `[ADR-0006](../adr/…)` 先例，路径实测可达）。
- **全仓无残留矛盾**：本审复扫 `grep -rEn "// *\{ *ok *: *true" --include="*.md"`（排除 wiki/raw）→ 仅余 cordis L343（已含 `schema`，合规）与 ADR 0016 自身 L55（规范示例，作用域外）；全仓 readData 消费面（typed-access L43/L110、replication L90、根 AGENTS.md L31、CONTEXT、cordis L340/L342/L362、external L253/L288/L351、ADR 0008/0016）逐处亲核——无两键形状断言残留、无 `readData(path, …)` 带参（opt-in）发明（always-on，ADR 0016 L69/L81）。

### AC3 — 全仓 `pnpm typecheck`、`pnpm test` 绿 → **满足（附披露项 D-1）**

| 半门 | 证据 | 评估 |
|---|---|---|
| `pnpm typecheck`（14 个 package/app tsconfig 顺序 tsc） | SA3 终态实测 **exit 0**（含全部文档改动在位） | 直接实证 ✓；且本票 diff 的 3 个 .md 不进任何 tsc Program、3 个新测试文件被各包 tsconfig（`include: ["src/**/*.ts"]`，实测 namespace-registry tsconfig）排除——结果确定 |
| `pnpm test`（`vitest run --typecheck`） | 终态**全仓聚合跑未在任何会话执行**（SA3 按 skill 边界移交、SA4 O-1 回流总控/SA7）；已执行面：registry 全套件 **35 files / 412 tests 全绿**（SA3 终态实测，含本票红契约 7 + 负控 21）、红契约两种终态各 7/7 绿 + 负控 21/21 绿（SA3）、基线面（SA6 §4：runtime readData 契约 21/21、registry 405 passed） | 按套件实证 ✓；本票对可执行面的全部改动 = 3 个新测试文件（均在 namespace-registry，已随全套件实测绿）；其余全部包的代码与测试与 base `6ab8c87` **逐字节相同**（diff 实测），md 改动不影响任何套件——聚合跑失败的静态风险为零 |

裁决理由：AC3 是终态卫生门，其可被本票影响的全部面已直接实测绿；未执行的全仓聚合跑属流程性披露项（D-1），非关键 AC 未达成——无任何 diff 成分可能使未触碰的套件转红。

## 3. ADR 0016 语义投影契约保真核验（本审独立逐句对照）

| 文档断言 | ADR 0016 条款 | 裁决 |
|---|---|---|
| 「Every successful `readData(path)` returns `{ ok: true, value, schema }`」（typed-access L110；cordis L340） | L19 结果形状 | 一致；「successful」限定准确，失败分支（PATH_NOT_ALLOWED/RUNTIME_READ_DISABLED/released）未被触碰或误述 |
| 四键 bullet（refs by name / transitive closure, self-contained, recursion-safe / docs+aliasDocs slices）（L114–116） | L30–39 投影体接口 | 逐义对应；ref 按名保留与 ADR 0003 §4 同款纪律 |
| 键规约同构 + `'<item>'/'<key>'/'<member N>'` 合成段 + 别名名锚定（L118） | L42 | 逐字互译，无新结构发明 |
| null 三情形 + not a read failure + ok 恒真 + "not as an error"（L120；cordis L341） | L22 | 穷尽、单义、无误读 |
| detached 深拷贝、不跨读缓存共享（L120 末） | L69–70 + CONTEXT _Avoid_ | 同向；无 live 引用暗示 |
| 凭投影构造合法 `mutateData()` mutation；静态 PathAt/PathPatchValue 仍是编译期权威（L122） | L8 + L77 | 一致；无 opt-in 暗示、无 D8 修订节回退 |
| external L288「加法兼容的演进，不改变本页示例」 | L77「adapter 可忽略新字段，亦可在其后消费」 | 逐义转述 |

另核 ADR 0008 L167–178 修订节与 CONTEXT L34/L37–39 词条：交付措辞为消费文档转述，规范面零触碰（diff 实测 `docs/adr/**`、`CONTEXT.md` 无改动）——文档向母法对齐，未反向修订。

## 4. SA6 红验收契约核验

- **冻结面未改**：HEAD 中 red = 恰 7 tests（R1–R7）、control = 恰 21 tests、fixture matcher 位于 L55–115——与 SA6 §12–14、SA2 §2、SA8 §3.1 A9、SA4 §6 四处独立引用一致；无 `.only`/`.skip`/`.todo`（grep 零命中）。
- **R1–R7 终态满足**（本审将 fixture matcher 正则手工施加于 HEAD 交付文本，与 SA3 两种终态实测 7/7 绿、SA4 静态施加三方一致）：
  - R1：L110 "ADR 0016" + URL `0016-readdata-…` 命中 `adr0016Refs` ✓
  - R2：L110 段同段含 `readData` + 「schema projection」相邻词形 ✓
  - R3：L114–116 bullet 块（无空行切分）同段含 `valueSchema` + `aliasDocs` ✓
  - R4：L118 含 `aliasDocs` + `isomorphic`/`synthetic` ✓
  - R5：L120 含 `null` + "not a read failure" ✓
  - R6：L122 含「schema projection」+ `mutateData()`/mutation ✓
  - R7：cordis L343 注记含 `schema` → `staleAnnotationViolations` = 0 ✓
- **负控 21 条保持**（静态核验 + SA3 实测 21/21）：行为锚断言与 runtime.ts 成功分支类型互证属实；external/typed-access 无两键注记（实测 0）；三作用域文档无 `readData(…, …)` 带参（逐行核：D6 子弹 `readData()` 后紧邻 `)`，中文注释全角括号不匹配 ASCII 正则）；typed-access 核心内容 `VfslPathMap`/`--check` 在场；ADR 0016 权威源词汇健全（文件未动）。
- **锚是承重的**：R1–R6 的满足全部来自本票新增小节（base 上 typed-access 对投影/ADR-0016/null 零命中，SA6 §4 预扫描），非既有内容偶然满足；SA2 变异探针已证明缺锚即响亮转红。

## 5. 范围与 scope creep 核验

最终 diff 非 wiki 文件恰 6 个：3 个消费文档（= 设计 ALLOW LIST 第 1–3 行，两项必改 + 两项可选推荐全部采纳）+ 3 个 SA6 冻结契约文件（总控 commit 收纳，SA4 O-2 要求随改动一并提交——已在 HEAD 兑现）。DENY LIST 零触碰：无生产代码（`packages/**` src/`apps/**`/`domains/**`/`tests/**`）、无规范面（ADR/CONTEXT）、无根 AGENTS.md、无作用域外 skill/integration 文档。wiki/raw 7 个新增文件均为流水线固定产物。**无 scope creep、无遗漏站点**（docs/integration readData 消费面恰 cordis + external 两文件，本审 grep 复证；hub-peer-deployment/local-package-linking 零命中）。

## 6. Owner 评论核验

Issue REST comments = `[]`（dispatch 记录；SA6 §2/SA2 §5/SA8 §2.19 双通道多处同口径）。**无适用 owner 要求**，执行标准唯一来源 = 简报六要点 + AC1–AC3，已在本审 §2 全量映射。

## 7. PR 必须披露的未达成/待办项

| # | 事项 | 性质 | 建议处置 |
|---|---|---|---|
| D-1 | 终态全仓聚合 `pnpm test`（`vitest run --typecheck`）未在任何会话执行；证据 = `pnpm typecheck` exit 0（终态实测）+ registry 全套件 412/412（终态实测，含本票 28 条契约测试）+ 其余包与 CI-green base 逐字节相同 | 流程性证据缺口，静态风险为零 | PR 描述披露该口径；合并前由总控/SA7 或 CI 完成聚合跑（CI test 分片按磁盘枚举自动纳入 3 个新测试文件） |
| D-2 | 红契约 R1–R7 为内容锚**最低门**（词形正则），非语义充分门；语义保真由 SA2 模拟、SA8 焦点表 A1–A14、SA4 静态施加与本审 §3 逐句对照共同背书 | 验收口径说明 | PR 描述可引本审 §3 作为语义层证据 |

## 8. MINOR 观察（不阻断 approve）

- M-1：新增的 3 个 `.test.ts` 契约文件不被任何 `pnpm typecheck` tsconfig 覆盖（各包 `include` 仅 src），vitest typecheck 亦只对 `*.test-d.ts` 报告诊断——其类型层正确性由真实运行器执行绿（28/28，导入解析/断言全部通过）间接保证。与仓库既有测试文件同等待遇，非本票引入的缺口，无需动作。
- M-2：SA6 报告 §4 称 typecheck 覆盖「16 个 tsconfig」，实测根 package.json 为 14 个 `tsc -p`（SA3/SA4 口径正确）——上游产物计数微瑕，无语义影响，无需动作。

## 9. requiresConflictRecheck

**false。** SA8 设计后复审已裁定 clear（0 hard-conflict / 0 override / 0 evolution-required），SA2/SA4 均 false；交付文本与已裁清的设计建议措辞逐字节一致（SA4 §4 diff 比对零偏差），规范面零触碰，未引入任何新决策面接触；本审 §3 独立对照 ADR 0016 全决策节无矛盾。

## 10. Verdict

**approve。** Issue #274 全部三条验收标准在 HEAD `6770ae0` 上满足：AC1（typed-access 六要点新节 + 交叉指针）与 AC2（全仓唯一矛盾注记修复 + 加法兼容保持 + 无残留矛盾）有终态实测与静态双重证据；AC3 的 typecheck 半门直接实证、test 半门按受影响套件全量实证 + 零代码改动静态论证。SA6 红契约 7/7 转绿、21 条负控保持，冻结面未被修改；diff 恰落在 ALLOW LIST 内，无 scope creep；Issue 无 owner 评论需并入。两条披露项（D-1/D-2）须随 PR 说明，均非关键 AC 未达成。
