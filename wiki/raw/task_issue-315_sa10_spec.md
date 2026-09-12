# SA10 Spec Review — issue #315：VFSL 三约束形态核心链（number & Int / Int<min,max> / Range<min,max>，ADR 0020）

- Reviewer：SA10（mabf-sa10 / spec-review / iteration 0，dispatch `sa-bf5036c3-4b57-4a40-ac7e-14e119482384`）
- 审查对象：**已提交最终 diff** `08569f20942e4750ff9fe695133a14be78e7fbc6`（feat(vfsl): add Int and Range number constraints），父基 = 权威刷新基 `7b92af0048ee58817aada54efdb581b24a760a93`（已核对 `git log`：单提交、父恰为该基；工作树干净，唯一未跟踪项为 Host 简报 `wiki/raw/task_issue-315.md`——committed 状态即审查状态）
- 需求全集：Issue #315 正文（What to build + 5 条 AC）+ ADR 0020/0021 规范决策；**Issue comments 为空**（REST snapshot 空，无 Owner 追加要求）
- 契约与上游产物：SA6 验收契约 `task_issue-315_sa6_contract.md`（§12 C1–C8）、设计 `task_issue-315_design.md`（§7.2 B1–B6 冻结、§8 逐层设计、§11 ALLOW/DENY）、SA2 评审（approve）、SA3 实现报告（iteration 1）、SA4 复审（**approve**，F-SA4-1 已闭合）、SA8 冲突复审 R2（**clear**，`requiresConflictRecheck: false`）
- 审查方式：静态 diff 走查 + 源码终态逐行核对（parser/validate/ir/derived/evaluate/semantic/shapes/resolve/codegen/投影/文档/全部新测试）；按 SA10 纪律未运行测试、未修改任何文件；AC5 绿证采纳 SA3/SA4 报告的自洽证据链（焦点 273 passed、全仓 353 files/3863 tests、typecheck/generate --check/spec 机检 22/22 全 exit 0）

---

## 1. Verdict

**approve** — Issue 正文全部构建项与 5 条 AC 在 committed diff 中逐条落实；SA6 契约 C1–C8 与 设计 B1–B6 冻结值与实现一致；无遗漏、无错误实现、无 scope creep；仅存 4 项已登记的非阻断披露项（§5），不构成本轮 reject 条件。

## 2. Issue 正文「What to build」逐项核对

| # | 正文要求 | 实现落点（committed diff） | 判定 |
| --- | --- | --- | --- |
| 1 | `Int`/`Range` 进保留名集合；别名占用 → E303 | `parser.ts:90` RESERVED_NAMES 16→18（注释同步）；E303 经既有声明名检查自动生效（测试 B10/B11 @ (1,6)） | ✅ |
| 2 | 裸用/脱离 `number &` 语境 → E100（镜像裸 Pattern） | `parser.ts:485-491` 裸 `Int`/`Range`（含带参形态）→ E100 锚该记号（测试 B1–B4 @ (1,23)）；`number & Range` 无实参 → E100 锚 `Range` 记号（A5 @ (1,32)） | ✅ |
| 3 | 交叉白名单 1 例扩 4 例（E100 文案更新） | `CROSS_WHITELIST_MSG` 模块常量（四例表述），两处生产点共用（`parser.ts:99`、`:504`、`:523`）；spec §2 同步四例化 | ✅ |
| 4 | arity 严格（`Int<5>` / `Int<1,2,3>` / 裸 `Range` → E100） | `parseConstraintArgs` 形状扫描先行：零参/单参/第三参/无实参 `Range` → E100 锚构造起点（测试 A1–A5 @ (1,32)） | ✅ |
| 5 | Int 端点限整数字面量（`Int<0.5, 1.5>` → E100） | `parser.ts:687` `Number.isInteger(tok.num)` 值判定（B1 冻结：`Int<1.0, 2>` 合法且 IR 同 `Int<1, 2>`），锚首个违规端点记号（A6 @ (1,36)、A7 @ (1,39)） | ✅ |
| 6 | 空区间（min > max，f64 比较）解析期 E100 | `parser.ts:693` `!(min <= max)` → E100 锚构造起点（A8/A9 @ (1,32)；`min==max` 单点区间合法，P8/P9 正例） | ✅ |
| 7 | IR/derived 新增 `int`/`range` 叶子（条件键纪律，既有指纹零变更） | `ir.ts`/`derived.ts` 两叶子（裸 `int` 两键整键缺席、带参两键必在场，键序 kind→min→max）；`semantic.ts`/`evaluate.ts` 条件键构造；C5 漂移测试钉死既有指纹逐字节不变 | ✅ |
| 8 | validate 三形态逐值判定（O(1)，纳入全收集与工作预算计费） | `validate.ts` `intRangeReject` 级联（typeof→四值→整数性→区间，常数比较零引擎）+ `validateValue` case（经 `ctx.emit` thunk 门控，charge 在 `validateValue` 入口既有位）+ C4e 101 元素全收集（100 条 + 截断标记） | ✅ |
| 9 | 运行时越界值被 validate 真判定报错 | C4b 失配矩阵 26 例逐例钉 path（含 f64 相邻值越界、负端点、数组元素位） | ✅ |

## 3. Acceptance criteria 逐条核对

| AC | 契约映射 | 证据 | 判定 |
| --- | --- | --- | --- |
| AC1 三形态正例（整数/小数/负端点）解析→IR→derived→validate 全链贯通，边界含端点 | C1/C3/C4a | `parse-vfsl-int-range.test.ts`（11 正例 + 全局位置 G1–G4/可选字段/联合成员/trivia/跨行）；`validate-int-range.test.ts` C3（derived 两树、字段名序、index 引用同一性、docs 空表、JSON 往返）+ C4a（闭区间含双端点逐值）；判定 `min <= v && v <= max`（`validate.ts:231`） | ✅ met |
| AC2 各负例错误码与锚位正确 | C2 | A 组 12 例（arity/浮点端点/空区间/-0 端点/超双精度）+ B 组 14 例（裸用/E303/字段名位/E311/E306/第二段 `&`）逐例钉码 + line/column；复合违规优先级 B3（arity 先行）与非数字实参锚 B4 均有测试；负控组（小写/近似名/既有白名单）保持绿 | ✅ met |
| AC3 NaN/±Infinity/-0 入三形态均拒绝，入裸 number 同样拒绝 | C4b/C4c | 级联第 ② 步复用 `isJsonFaithfulNumber`（`Number.isFinite` + `Object.is(-0)`）且**先于**区间步（`Range<-40,85>` 不放过 -0，`validate.ts:229`）；裸 number 负控测试（`validate-int-range.test.ts` C4b 末例 + 既有 `validate-number-domain-narrowing.test.ts` AC1–AC6 未弱化） | ✅ met |
| AC4 无 Int/Range 的既有 fixture 指纹逐字节不变；含 Int/Range 新 fixture 指纹稳定 | C5 | `int-range-fixture-drift.test.ts` 逐字节钉 SA6 §4 基线（envelope/semantic 指纹 + `generated.ts` sha256）+ 新 fixture 两次编译指纹相等且 `sha256:v1:` 前缀 + IR JSON 往返；diff 零触碰 `domains/vfs3-assets/**`、`tokenizer.ts`、`fingerprint.ts`（已核 `git diff` 为空） | ✅ met |
| AC5 包测试、typecheck 全绿 | C8 | SA3 报告：`pnpm typecheck` exit 0（14 工程）、`pnpm test` 353 files/3863 tests/0 type errors、`pnpm generate --check` exit 0、`git diff --check` exit 0、spec 机检 22/22、`vitest --typecheck.only` 150 passed；SA4 复审以 mtime + hunk 清单静态互证。SA10 不复跑（纪律），证据链自洽且与 diff 内容一致（新测试文件均在 vitest include 面、零 skip/only/todo 已 grep 复核） | ✅ met（据上报证据） |

## 4. 规范决策与设计冻结值一致性抽查

- **ADR 0020 决策 1/2/4/5/6/7/8/10**：保留名 §8 例外首例（16→18，spec §4 同步 18 名表述）；三形态与四例白名单；arity 锚构造起点（未照搬 Pattern 实参锚）；零新增错误码（diff 只用 E100/E303，E 码枚举未动）；IR/derived 条件键；validate 同层标量叶 + 全收集 + 预算；codegen 原样 `number`（`valuetype.ts`，无品牌类型）；投影零新增拒绝路径（`resolve-schema-at-path-int-range.test.ts` 锁透传 + 既有 `SCHEMA_PATH_NOT_FOUND`）；spec/guide/CONTEXT 同 PR 修订。**明确不做**（开放/半开区间、指数记号、品牌类型、其它字面量形态）在 diff 中零出现。✅
- **ADR 0021 决策 1/2/3**：四值基线为 number 家族统一判定（`isJsonFaithfulNumber` 单一事实源）；端点 `-0` 文本侧 E100（`parser.ts:683`）；消息 `-0` 经 `renderNumberValue` 不渲染为 "0"（C4d R2 断言）。✅
- **设计 B1–B6 冻结值**：B1 值判定（`Int<1.0, 2>` ok、IR `{min:1,max:2}` 有测试）；B2 空区间锚构造起点；B3 形状→源序端点→空区间（`Int<0.5>` 报 arity 有复合用例）；B4 非数字实参锚该实参记号；B5 文案单常量双生产点；B6 类型级硬矛盾（`contradictsInner` `typeof !== 'number'`；C4g `{v:5}` 恰 1 条 / `{v:true}` 恰 2 条判别性用例在位）。✅
- **SA4 F-SA4-1（iteration 0 MAJOR）**：已修复——`intRangeRejectMessage` 分支按级联次序重排，`'integer'` 维先行且区间后缀条件渲染（`validate.ts:248-253`），裸 `number & Int` 非整数恒得 `期望整数，实际 …` 零 `undefined` 槽；回归断言（C4d/C4g 各 1 例）在 committed 测试中在位。✅
- **非 switch 手改位点**：`evaluate.ts isNoChildTerminal`、`emitter.ts` 叶子闸门均已含 int/range（各有判别性测试：C3 别名链两树同步、C6a desync 不抛）。✅

## 5. 披露项（PR 必须披露；全部非阻断）

1. **SA8 F-1 处置 (b)（已授权偏离）**：单键手造 `int` 叶（min/max 恰一在场）的区间步跳过、有限整数放行，与设计 §8.4 伪码 fail-closed 分叉。该形态**文本层构造性不可达**（parser 二值构造 + evaluate 归一），SA8 两轮复审裁处置 (b) 合规（保持谓词 + 注释准确化，`validate.ts:220-222`），F-1 已闭合。
2. **ALLOW 外改动 1 处（SA4 N-1，建议总控追认为 ALLOW 修订）**：`packages/vfsl/test/evaluate-derived-schema.test.ts` 文件内自持镜像类型 additive 同步（+5 行纯类型、零断言变化），由 `pnpm typecheck`（TS2322）机械强制。已核 diff：确为类型联合 +int/range 两行，无断言改动。
3. **既有测试语义翻转 1 处（契约义务，非弱化）**：`validate-number-domain-narrowing.test.ts` AC7——裸 `Int`/`Range` 由 E301 翻转为 E100 @ (1,18)（保留名收窄的必然结果；SA6 §10 明列必达项），小写/近似名 E301 负控保持。
4. **登记备查的 MINOR 项（行为均合规，无需本 PR 处理）**：F-2/N-3 `parser.ts:643` EOF 锚注释措辞陈旧（注释面）；F-3/N-5 非规范面（`tests/acceptance/exemplar/`、`.scratch/`）旧白名单措辞残留（非规范面）；F-4/N-4 `-0` 端点消息引「ADR 0020 决策 3」（精确归属 ADR 0021 决策 2，文案不进冻结面）；设计 §10.2 可选 `.test-d.ts` 类型 fixture 未新增（C6a 已用真实 tsc 证明 `number` 投影可编译，非缺口）。

## 6. Scope creep 检查

- 生产面改动 12 文件全部落在 SA6 §10 预期实现面与设计 ALLOW 内；DENY LIST（`tokenizer.ts`/`fingerprint.ts`/`pattern.ts`/`validate-patch.ts`/`index.ts`/`vfsl-protocol/**`/`domains/vfs3-assets/**`/ADR/spec §5/§8/CI）经 `git diff` 逐一核对**零触碰**。
- `resolve-schema-at-path.ts` 仅 2 处注释更新（零行为）；`CONTEXT.md` 仅「值 schema」词条一行同步（docs/AGENTS.md 术语纪律要求）；`parse-vfsl-containers-markers.test.ts` 仅 describe 标题四例化（SA6 §10 明列可选、断言零变化）。
- 无未授权公共 API 新增（`index.ts` 未动；类型联合拓宽即本特性本体、ADR 授权）；无指纹前缀升版、无 `ISSUE_LIMIT`/错误码集合改动、无 env 开关/fallback。
- wiki 产物（SA2/SA3/SA4/SA6/SA8 报告）随同一提交归档，非代码面。

## 7. 结论

committed diff `08569f2` 对 Issue #315 正文、5 条 AC、SA6 契约 C1–C8、设计 B1–B6 冻结值与 ADR 0020/0021 规范决策实现**完整且忠实**；iteration 0 唯一 MAJOR（F-SA4-1）已在 committed 状态内修复闭合；无 partial/unmet/unachievable 的关键 AC；披露项 4 条均为已登记的非阻断 MINOR/授权偏离。**verdict: approve**。
