# SA3 Implementation Report — issue #315：VFSL 三约束形态核心链（number & Int / Int<min,max> / Range<min,max>，ADR 0020）

- Dispatch：`sa-675d4104-65c6-4a2c-b84a-f09e73763d6a`（mabf-sa3 / implementation / **iteration 1：修复 SA4 F-SA4-1**）
- 前序：`sa-ea311275-9d2b-489f-9861-40490f651375`（iteration 0 全链实现，其报告结构与本文件同源，已原位更新）
- Worktree：`/home/wangjian/nomicore-fix-issue-315`，分支 `mabf/issue-315`，基线 HEAD `7b92af0048ee58817aada54efdb581b24a760a93`
- 权威输入：设计 `wiki/raw/task_issue-315_design.md`（§7.2 B1-B6 冻结值、§8 逐层设计、§11 ALLOW/DENY、§12 映射）；SA6 契约 `wiki/raw/task_issue-315_sa6_contract.md`（§12 C1-C8 细则权威）；SA2 评审 `wiki/raw/task_issue-315_sa2_review.md`（approve；N-1/N-2 + O-1..O-4）；**SA4 实现静态审查 `wiki/raw/task_issue-315_sa4_review.md`（reject：F-SA4-1 MAJOR）**；SA8 `relevant_decisions.md` / `conflict_report.md` / `implementation_conflict_report.md`
- 本报告描述**当前实现与当前验证结果**（含 iteration 1 rework）；历史红灯证据单独标注来源。

---

## Inputs consumed

| 输入 | 状态 | 用法 |
| --- | --- | --- |
| `wiki/raw/task_issue-315.md`（Issue body 5 AC；Comments 空） | 已读 | 需求全集 |
| `wiki/raw/task_issue-315_design.md`（564 行） | 已读 | ALLOW/DENY、§8 逐文件设计（**§8.4 消息模板为本次修复权威**）、B1-B6 冻结、§10.2 测试面 |
| `wiki/raw/task_issue-315_sa6_contract.md`（643 行） | 已读 | C1-C8 断言细则（C4d 消息不变量 R1/R2/R3；文案不冻结纪律） |
| `wiki/raw/task_issue-315_sa2_review.md` | 已读 | N-1（翻转锚列）、N-2（内联抛）、O-1..O-4 |
| **`wiki/raw/task_issue-315_sa4_review.md`** | 已读 | **F-SA4-1 修复指令（§10 Required revisions）+ §11 重验项 + N-1..N-6 非阻塞观察** |
| `wiki/raw/task_issue-315_relevant_decisions.md` / `_conflict_report.md` / `_implementation_conflict_report.md` | 已读 | SA8 冻结面、F-1 处置 (a)/(b) 边界、§10 重开复查的边界条件 |
| 源码独立核验（parser/ir/semantic/shapes/resolve/derived/evaluate/validate/validate-patch/resolve-schema-at-path/fingerprint/tokenizer；vfsl-codegen emitter/valuetype；namespace-runtime read-schema-projection；vitest.config；spec 机检脚本） | 已读 | 实现锚点逐条落在设计行号 |

无 Owner 评论（REST comments snapshot 空）；SA4 唯一阻断项为 F-SA4-1（MAJOR），修复指令明确、范围在 ALLOW 内（`validate.ts` 消息构造 + `validate-int-range.test.ts` 回归断言）——**可实施，未触发 reject 条件**。

## Existing worktree reconciliation

- 起点：工作树含 iteration 0 的完整未提交实现（18 modified + 5 新测试文件）与 SA4 审查产物（`task_issue-315_sa4_review.md`）。
- 核对最新设计/契约后，iteration 0 实现与设计一致的部分**原样保留**（parser/IR/derived/全链接线/codegen/投影/文档/测试均未回退）；仅按 F-SA4-1 做外科手术级 rework：
  1. `packages/vfsl/src/validate.ts`：`intRangeRejectMessage` 分支重排（`'integer'` 维先行 + 设计 §8.4 模板条件后缀），删除先于 `'integer'` 的 `min === undefined || max === undefined` 守卫；同步更正两处注释（`intRangeReject` 第 ④ 步「双键同在场」+ 单键手造叶实际放行语义；`intRangeRejectMessage` 分支次序/undefined 可达面）。
  2. `packages/vfsl/test/validate-int-range.test.ts`：C4d 补 1 条 F-SA4-1 内容断言 + C4g 补 1 条联合候选下钻同款断言。
- **判定级联（`intRangeReject`）逐字节未变**（`typeof → four-value → integer → range` 四步与第 ④ 步双键谓词保持）；错误码/锚位/指纹/IR/投影/文档零变化——与 SA8 F-1 处置边界「不得改变文本可达形态的判定/消息/锚位」不冲突（消息模板回归设计即修复目标本身）。
- N-2（SA8 F-1）按**处置 (b)** 落实：保持实现（双键同在场才启区间步），把 `:231-234` 不准确注释改为准确描述——SA4 §10 明确要求「同步更正 `:231-234/:244` 注释」，且 F-SA4-1 验收含「判定级联零变化」，故不动谓词。
- 临时探针 `packages/vfsl/test/tmp-f-sa4-1-probe.test.ts`（消息原文打印 + 突变对照）已在收尾删除；`git status` 复核无残留。

## Changed paths

| Path | Design section | Change |
| --- | --- | --- |
| `packages/vfsl/src/parser.ts` | §8.1(a)-(h) | `RESERVED_NAMES` 16→18（+`Int`/`Range`）；`AstType` +`int`/`range`；裸用 E100 分支；`number &` 主层识别；`parseIntType`/`parseRangeType`/`parseConstraintArgs`（arity → 源序端点 → 空区间）；`CROSS_WHITELIST_MSG` 常量 |
| `packages/vfsl/src/ir.ts` | §8.2 | `VfslType` +`int`/`range` 条件键叶子 |
| `packages/vfsl/src/semantic.ts` | §8.2 / §8.1(h) | `toIRType` +2 case；walk 注释 |
| `packages/vfsl/src/shapes.ts` | §8.3 | `localCls` int/range → `'scalar'`；注释 |
| `packages/vfsl/src/resolve.ts` | §8.3 | `localCls` int/range → `'scalar'` |
| `packages/vfsl/src/derived.ts` | §8.3 | `ValueSchema` +同形两叶子 |
| `packages/vfsl/src/evaluate.ts` | §8.3 | `structureOf`/`valueOf`/`walkDocs` +case；`isNoChildTerminal` 非 switch 手改 |
| `packages/vfsl/src/validate.ts` | §8.4 | `intRangeReject` 级联（**本次未改判定**）+ `intRangeRejectMessage`（**本次重排分支：integer 维先行、设计模板条件后缀，裸 Int 不再渲染 undefined 端点**）+ `validateValue` +2 case + `contradictsInner` +2 case（B6） |
| `packages/vfsl/src/resolve-schema-at-path.ts` | §8.6 | 两处 default 终态注释（零行为） |
| `packages/vfsl-codegen/src/emitter.ts` | §8.5 | 叶子闸门放行 int/range |
| `packages/vfsl-codegen/src/valuetype.ts` | §8.5 | `projectValue` +2 case → `'number'` |
| `packages/namespace-runtime/src/read-schema-projection.ts` | §8.6 | `cloneValueSchema` +2 case（条件键逐键） |
| `docs/vfsl/v1-spec.md` | §8.7 | §2/§3/§4 修订（§5/§8 零编辑） |
| `docs/vfsl/schema-authoring-guide.md` | §8.7 | §6 数值约束 + 护栏四例化 |
| `CONTEXT.md` | §8.7 | 「值 schema」词条一行 |
| `packages/vfsl/test/validate-number-domain-narrowing.test.ts` | §10.2（SA8 Required action 2） | AC7 拆分翻转（`Int`/`Range` → E100 @ (1,18)） |
| `packages/vfsl/test/parse-vfsl-containers-markers.test.ts` | §10.2（可选） | describe 标题四例化（断言零变化） |
| `packages/vfsl/test/evaluate-derived-schema.test.ts` | **ALLOW 外（Deviation #1，同 iteration 0）** | 文件内自持镜像类型 additive 同步（+int/range，纯类型、零断言变化） |
| `packages/vfsl/test/parse-vfsl-int-range.test.ts`（新） | §10.2 C1/C2 | 67 tests |
| `packages/vfsl/test/validate-int-range.test.ts`（新） | §10.2 C3/C4 | 51 tests + **本次 +2 F-SA4-1 回归断言（C4d 裸 Int 消息 / C4g 联合候选下钻消息）= 53 tests** |
| `packages/vfsl/test/int-range-fixture-drift.test.ts`（新） | §10.2 C5 | 5 tests |
| `packages/vfsl/test/resolve-schema-at-path-int-range.test.ts`（新） | §10.2 C6b | 7 tests |
| `packages/vfsl-codegen/test/generate-int-range.test.ts`（新） | §10.2 C6a | 10 tests |
| `wiki/raw/task_issue-315_sa3_impl.md` | — | 本报告（原位更新） |

## SA2 Finding落实

| Finding ID | Implementation | Result |
| --- | --- | --- |
| N-1（MINOR：翻转锚列混用脚手架） | 翻转用例按实际脚手架 `type ROOT = { n: X };` 钉 **(1,18)** 并注释来源；`int`/`range` E301 负控加锚断言 | 落实；翻转块 51/51 绿 |
| N-2（MINOR：内联抛 vs dispatchContinuation） | `number` 分支内联抛 `CROSS_WHITELIST_MSG`（镜像 `string` 分支）；`dispatchContinuation` 只承接第二段 `&` | 落实；B9 实测 (1,41) |
| O-1（单键手造 int 叶失败形态） | 判定侧保持双键谓词（单键手造叶有限整数放行——文本层构造性不可达）；注释按 SA8 F-1 处置 (b) **改为准确描述**（原「fail-closed / 无伪 ok 路径」声明已删除） | 落实（注释更正，判定零变化） |
| O-2（合并 case 消息模板 `undefined` 风险） | **本次修复**：`intRangeRejectMessage` 分支重排，`'integer'` 维先行并按设计 §8.4 模板条件渲染区间后缀——裸 `number & Int` 恒得 `期望整数，实际 …`，`undefined` 端点仅单键手造叶可达 | 落实（iteration 0 的「实现层消除」声明不成立，已按 F-SA4-1 修正并使声明成立） |
| O-3（裸用 vs A5 文案略异） | 未统一（非义务；文案不进冻结面） | 记录不处理理由 |
| O-4（契约/设计双层权威） | 以 SA6 C1-C8 为断言细则权威、设计 §12 为映射权威 | 落实 |

## SA4 Finding落实

| Finding ID | Severity | Implementation | Result |
| --- | --- | --- | --- |
| **F-SA4-1** | MAJOR | `validate.ts::intRangeRejectMessage` 由「`undefined` 守位先于 `'integer'` 维」改为「`'type'` → `'four-value'` → **`'integer'`（设计 §8.4 模板：`` `期望整数${kind === 'int' && min !== undefined ? `（${min} ≤ v ≤ ${max}）` : ''}，实际 …` ``）** → `'range'`（双键同在场才可达，渲染真实端点）」；删除旧 fail-closed 守位；`intRangeReject` 第 ④ 步与 `intRangeRejectMessage` 两处 JSDoc 同步更正。回归覆盖：`validate-int-range.test.ts` C4d 新增 `a=1.5` 断言（message 含「整数」且不含 `undefined`）+ C4g 新增联合候选下钻断言（`number & Int | string` + `{v:1.5}` 全部 issue 消息不含 `undefined`） | **落实**。修复后实测消息：`a=1.5 → 期望整数，实际 1.5`；`b=1.5 → 期望整数（1 ≤ v ≤ 100），实际 1.5`（R3 零变化）；`b=101 → 期望整数区间 [1, 100]，实际 101`（R3 零变化）；`c=2 → 期望区间 [0.5, 1.5]，实际 2`；联合下钻 `→ 联合成员 1/2：期望整数，实际 1.5`。突变对照（临时恢复旧分支次序）：2 条新断言均红，实得 `期望整数区间 [undefined, undefined]，实际 1.5` / `联合成员 1/2：期望整数区间 [undefined, undefined]，实际 1.5`——回归可检出 |
| N-2（MINOR，承接 SA8 F-1） | MINOR | 按 SA8 处置 **(b)**：保持双键谓词，注释改为准确描述（「双键同在场才启区间步；单键手造叶有限整数放行，文本层构造性不可达」） | 落实（非阻断项，判定级联零变化） |

SA4 §10 验收明细逐条对本实现成立：焦点测试全绿（273 passed）；`a=1.5` 消息无 `undefined`；b 字段各维消息（R2/R3 断言）零变化；指纹/锚位/判定级联零变化。N-1/N-3/N-4/N-5/N-6（范围追认、注释措辞、非规范面、文案引用、可选类型 fixture）为 SA4 非阻塞观察，不属本 dispatch 的 F-SA4-1 修复范围；N-3（`parser.ts` EOF 注释）本次未改（超出 F-SA4-1 范围，留 SA4/SA7 裁量）。

## File scope check

| Changed path | ALLOW entry | Purpose |
| --- | --- | --- |
| `packages/vfsl/src/parser.ts` | ✅ | §8.1 文本层 |
| `packages/vfsl/src/ir.ts` | ✅ | §8.2 IR 两叶子 |
| `packages/vfsl/src/semantic.ts` | ✅ | §8.2 |
| `packages/vfsl/src/shapes.ts` | ✅ | §8.3 |
| `packages/vfsl/src/resolve.ts` | ✅ | §8.3 |
| `packages/vfsl/src/derived.ts` | ✅ | §8.3 |
| `packages/vfsl/src/evaluate.ts` | ✅ | §8.3 |
| `packages/vfsl/src/validate.ts` | ✅ | §8.4（判定 + **消息构造（本次 F-SA4-1）** + 类型级矛盾） |
| `packages/vfsl/src/resolve-schema-at-path.ts` | ✅ | §8.6（零行为） |
| `packages/vfsl-codegen/src/emitter.ts` | ✅ | §8.5 |
| `packages/vfsl-codegen/src/valuetype.ts` | ✅ | §8.5 |
| `packages/namespace-runtime/src/read-schema-projection.ts` | ✅ | §8.6 |
| `docs/vfsl/v1-spec.md` | ✅ | §8.7 |
| `docs/vfsl/schema-authoring-guide.md` | ✅ | §8.7 |
| `CONTEXT.md` | ✅ | §8.7 |
| `packages/vfsl/test/validate-number-domain-narrowing.test.ts` | ✅ | SA8 Required action 2 翻转（义务） |
| `packages/vfsl/test/parse-vfsl-containers-markers.test.ts` | ✅（可选） | describe 标题四例化 |
| `packages/vfsl/test/evaluate-derived-schema.test.ts` | ⚠️ **ALLOW 外** | Deviation #1（typecheck 机械强制的镜像类型同步，SA4 N-1 建议追认） |
| `packages/vfsl/test/parse-vfsl-int-range.test.ts`（新） | ✅ | C1/C2 |
| `packages/vfsl/test/validate-int-range.test.ts`（新） | ✅ | C3/C4 + **F-SA4-1 回归 2 例** |
| `packages/vfsl/test/int-range-fixture-drift.test.ts`（新） | ✅ | C5 |
| `packages/vfsl/test/resolve-schema-at-path-int-range.test.ts`（新） | ✅ | C6b |
| `packages/vfsl-codegen/test/generate-int-range.test.ts`（新） | ✅ | C6a |
| `wiki/raw/task_issue-315_sa3_impl.md` | —（报告产物） | 本报告 |

**DENY LIST 零改动**：`tokenizer.ts` / `fingerprint.ts` / `pattern.ts` / `validate-patch.ts` / `index.ts` / `vfsl-protocol/**` / `domains/vfs3-assets/**` / `doc-runtime/**` / ADR / `spec §5/§8` / `tests/acceptance/vfsl_spec_acceptance.py` / CI 配置——`git status --short` 逐条核对无命中；无临时文件残留（探针已删）。

## Verification

### ReWork 红灯→绿灯（F-SA4-1，本次）

| Command | Result | Evidence |
| --- | --- | --- |
| 突变对照（临时把 `intRangeRejectMessage` 恢复为旧分支次序，仅跑 2 条新断言）`... vitest run <probe> packages/vfsl/test/validate-int-range.test.ts -t "F-SA4-1" --typecheck.enabled=false` | **红：2 failed \| 1 passed \| 51 skipped** | 实得 `期望整数区间 [undefined, undefined]，实际 1.5`（C4d）与 `联合成员 1/2：期望整数区间 [undefined, undefined]，实际 1.5`（C4g），与 SA4 F-SA4-1 静态推演逐字一致；随后恢复修复版并复核 `git diff`/源码 |
| 修复后同选择器（probe + 断言） | **绿**：probe 实测 `a=1.5 → 期望整数，实际 1.5`、`b=1.5 → 期望整数（1 ≤ v ≤ 100），实际 1.5`、`b=101 → 期望整数区间 [1, 100]，实际 101`、`c=2 → 期望区间 [0.5, 1.5]，实际 2`、`union v=1.5 → 联合成员 1/2：期望整数，实际 1.5` | 判定级联/区间维消息逐字与 iteration 0 相同（仅裸 Int 非整数维变化）；probe 收尾删除 |

### 焦点契约（当前实现，最终）

| Command | Result | Evidence |
| --- | --- | --- |
| 焦点 10 文件（5 新契约 + 翻转 + containers-markers + spec-docs-anchor + evaluate-derived-schema + number-literals-drift） | **exit 0**：`Test Files 10 passed (10)`、`Tests 273 passed (273)` | iteration 0 为 271；+2 = 本次 F-SA4-1 回归断言；C1/C2/C3/C4a-g/C5/C6a/C6b 全绿 |
| 受影响 package 回归：`packages/vfsl/test` + `packages/vfsl-codegen/test` | **exit 0**：`54 files / 988 tests passed` | 消息变更零外溢（仓内无第二处钉死该文案——`grep 期望整数|整数区间` 仅命中 `validate.ts` 自身） |

### 门禁（设计 C8 / SA6 §12.9）

| Command | Result | Evidence |
| --- | --- | --- |
| `pnpm typecheck`（14 工程） | **exit 0** | 全 switch 接线与本次消息改动类型面全绿 |
| `pnpm generate --check` | **exit 0** | `domains/vfs3-assets/generated.ts` 零漂移（指纹纪律） |
| `python3 tests/acceptance/vfsl_spec_acceptance.py` | **exit 0，GREEN 22/22** | spec 机检不受消息面影响 |
| `git diff --check` | **exit 0**（stdout 空） | diff 卫生 |
| `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run --typecheck.only` | **exit 0**：`28 files / 150 tests`、`Type Errors no errors` | 类型级门禁 |
| `pnpm test`（全仓 `vitest run --typecheck`） | **见下「全仓」行** | C8 第 2 条 |

### 全仓（`pnpm test`，rework 后）

| Command | Result | Evidence |
| --- | --- | --- |
| `pnpm test` | **exit 0**：`Test Files 353 passed (353)`、`Tests 3863 passed (3863)`、`Type Errors no errors` | HEAD 基线 348 files / 3721 tests；iteration 0 为 353 files / 3861 tests（+2 = 本次 F-SA4-1 回归断言）；全仓零回归 |

### 历史证据（iteration 0，保留可复核；当前实现已 supersede 相关消息面）

| Command | Result | Evidence |
| --- | --- | --- |
| 实现前红灯（5 新契约文件 + 翻转文件） | **红**：`5 failed`、`49 failed \| 14 passed`；翻转文件 `2 failed \| 49 passed` | 红因逐例登记于 iteration 0 报告原文（E100 @ `&` / E301） |
| 突变敏感性自检 5 项（`isNoChildTerminal`/`contradictsInner`/emitter 闸门/四值步/端点闸门） | 全部**杀死** | 对应断言：C3 别名链、C4g 条数、C6a desync、C4b -0、C2 A6/A7 |

## Deferred verification

1. **SA6 C8 的 CI 面**：6 分片 shard、`codegen-freshness` 作业、PR 门禁、真实环境验收——本 worktree 未执行（Host/CI/SA7 职责）。
2. **SA8 冲突复查**：F-SA4-1 修复改变了**文本可达形态**的消息文本（写入 SA8 §10 边界条款的触发面：「若后续对 F-1 的处置改变了文本可达形态的判定级联/消息/锚位…须重开 SA8 冲突复查」）。本次未改判定级联/锚位/指纹，但消息面变更在字面上触及该边界条款，故本 dispatch 提交 `requiresConflictRecheck: true` 交回门禁裁决（SA4 报告亦以 `requiresConflictRecheck: true` 为依据提出）。事实层面：消息文案在设计/契约中均属**非冻结面**（ADR 0021 决策 3；SA6 §12.4 第 4 条），修复方向即回归设计 §8.4 冻结模板，预计无决策冲突。
3. **SA4 N-1 / N-3 / N-5 / N-6 非阻塞项**：`evaluate-derived-schema.test.ts` ALLOW 外改动的追认（N-1）、`parser.ts` EOF 注释（N-3）、非规范面旧措辞（N-5）、可选 `.test-d.ts` 类型 fixture（N-6）——均超出 F-SA4-1 范围，留 SA4/SA7/总控裁量。
4. **SA4 §11 的其它重验项**：C5 钉值逐字节不变已由 `int-range-fixture-drift.test.ts`（5 tests 绿）与 `pnpm generate --check` 覆盖；突变复核（裸 int `"3"`/`null` → type 维、`-0`/NaN/±Inf → four-value 维、`1.5` → integer 维）本次由 probe 实测 `a=1.5`/`a=0` 两维消息可分，其余值维未逐一打印（断言面 C4b 已覆盖 path/计数）。

## Deviations or blockers

1. **ALLOW 外改动 1 处（同 iteration 0，MINOR）**：`packages/vfsl/test/evaluate-derived-schema.test.ts` 文件内自持镜像类型 additive 同步（+int/range，纯类型、零断言变化）。`pnpm typecheck` 机械强制（TS2322），SA4 N-1 已建议总控追认为 ALLOW 修订。本次 rework 未触碰该文件。
2. **判决面与设计伪码的单键手造叶分叉（MINOR，SA8 F-1 / SA4 N-2）**：实现保持「双键同在场才启区间步」；按 SA8 处置 (b) 只更正注释，不改判定（F-SA4-1 验收要求判定级联零变化）。文本可达形态（双缺/双在）与设计/契约完全一致。
3. **消息文案变更的影响面（已核）**：仅裸 `number & Int` 的有限非整数失配消息由 `期望整数区间 [undefined, undefined]，实际 …` 变为 `期望整数，实际 …`；其余各维（type / four-value / 带界整数性 / 区间）逐字不变——仓内无第二处钉死该文案（`grep` 复核），b 字段 R2/R3 断言零变化。
4. **无阻塞项**：未使用 env override、fallback、skip/only/todo、软断言；未改指纹前缀、未动 `domains/vfs3-assets/**`、未新增错误码、未执行 `git add/commit/push`。

## Suggested commit message

```
fix(#315): 裸 number & Int 非整数失配消息回归设计 §8.4 模板（修复 SA4 F-SA4-1）

- validate：intRangeRejectMessage 分支重排——'integer' 维先于区间后缀判定，按设计 §8.4
  模板条件渲染（裸形 → `期望整数，实际 1.5`）；删除先于 integer 维的 undefined 守位，
  undefined 端点仅单键手造叶（文本层构造性不可达）可达；两处 JSDoc 同步更正
  （判定级联/锚位/指纹零变化；SA8 F-1 处置 (b) 保持双键谓词 + 注释准确）
- tests：validate-int-range.test.ts C4d/C4g 补 F-SA4-1 回归断言（a=1.5 消息含「整数」
  且不含 "undefined"；联合候选下钻同款），旧分支次序下两条断言实测红

验证：焦点 10 文件 273 passed；受影响 package 54 files / 988 tests；
pnpm typecheck exit 0；pnpm test 353 files / 3863 tests / 0 type errors；
pnpm generate --check exit 0；spec 机检 22/22；vitest --typecheck.only 150 passed / 0 errors；
git diff --check exit 0
```
