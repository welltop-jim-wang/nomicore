# SA3 Implementation Report

- Dispatch：`sa-2a810e4e-b676-449e-91d9-5c7629c247cb`（mabf-sa3 / implementation / iteration 0）
- Worktree：`/home/wangjian/nomicore-fix-issue-316`（分支 `mabf/issue-316`，HEAD `bd9fb93` = #315 集成 PR #351，未漂移）
- 实现范围：**测试 only**（生产零改动，落实 SA1 设计 §7 D-1~D-4 硬性结论）

## Inputs consumed

| 输入 | 路径 | 关键内容 |
| --- | --- | --- |
| 任务简报 | `wiki/raw/task_issue-316.md` | Issue body：AC1~AC4 + Blocked by #315；§Comments 空（REST snapshot 空，无 owner 追加要求） |
| 最新批准设计（iteration 1） | `wiki/raw/task_issue-316_design.md` | 生产零改动硬性结论；§7 T-1~T-4（+可选 T-5）测试设计；§10 ALLOW/DENY；§12 验收映射 |
| SA2 设计评审（iteration 1，approve） | `wiki/raw/task_issue-316_sa2_review.md` | F1 已解决（T-4 自包含装置）；F2~F5 修订映射；N1~N3 非阻断观察 |
| SA6 验收契约（iteration 0，approve） | `wiki/raw/task_issue-316_sa6_contract.md` | §12.2~12.4 C1a~C4e；§12.6 覆盖缺口 (a)~(d)；§12.0 断言纪律；§13「HEAD 即绿，不伪红」 |
| SA8 产物 | `wiki/raw/task_issue-316_relevant_decisions.md` / `_conflict_report.md` | 不存在（与 SA1/SA2/SA6 同认，非阻塞；以 ADR 0020 决策 7/8 + ADR 0016 + 模块 AGENTS.md + CI 替代） |
| 既有实现/测试 | `packages/vfsl-codegen/src/{valuetype,emitter}.ts`、`packages/vfsl/src/resolve-schema-at-path.ts`、`packages/namespace-runtime/src/read-schema-projection.ts`、既有 3 个 int/range 测试文件 | 只读核验（未改动） |

**红灯契约现状**：SA6 明文「能力已在 HEAD 由 #351 整体交付，不存在可诚实建立的红灯」；本 dispatch 的红灯契约即 SA6 §12.6 的四项覆盖缺口（C1c/C1e/C3b/C3c），在 HEAD 即为绿，属防回归哨兵。SA3 未伪造红灯、未弱化任何断言、未改验收语义。

## Existing worktree reconciliation

- 起始工作区：`git status --short` 仅 4 件未跟踪 Host/上游 wiki 产物（`task_issue-316{,_design,_sa2_review,_sa6_contract}.md`），无未提交实现，无既有 `task_issue-316_sa3_impl.md` ⇒ 本次为首次实现，无待修订状态。
- 生产实现完整（`valuetype.ts:35-39` int/range→`'number'`；`emitter.ts:335-348` leaf 白名单 + desync；`resolve-schema-at-path.ts` kind-agnostic 终态；`read-schema-projection.ts:170-183` int 条件键/range 双键）⇒ 按设计保持**零改动**；本次仅新增/扩展测试文件。
- 既有测试文件 3 件（`generate-int-range.test.ts` 10 用例、`resolve-schema-at-path-int-range.test.ts` 7 用例、`int-range-fixture-drift.test.ts` 5 用例）全部保留：既有断言/字段逐条零改动（resolve 文件仅 FIXTURE 首行注释替换 + 字段追加，见下）。

## Changed paths

| Path | Design section | Change |
| --- | --- | --- |
| `packages/vfsl-codegen/test/generate-int-range.test.ts` | §7 T-1（C1c）、T-2（C1e） | 纯加法：新增 `TYPED_ACCESS_CONSUMER`/`TYPED_ACCESS_NEGATIVE` 文本与 2 个 `describe`（3 用例）；10 → 13 用例，既有 10 条零改动 |
| `packages/vfsl/test/resolve-schema-at-path-int-range.test.ts` | §7 T-3（C3b） | 纯加法：FIXTURE 末尾追加 `u`/`r`/`pp`/`ppe`/`ppr`/`ppu` 六字段（既有 a~e/p/q 原样）；新增 `FROZEN_CODES`/`failureCode`/`PAIRED_FAILURES` 与 1 个 `describe`（3 用例，含 7 组 `it.each` 配对）；7 → 16 用例，既有 7 条零改动 |
| `packages/namespace-runtime/test/runtime-readdata-int-range.test.ts` | §7 T-4（C3c） | 新增文件：文件内自包含装置（`TXT_316`/`ENV_316`/`seedRoot316`/`makeHandle316`/`makeReadyRuntime316` + `oracle`/`readOk`），只读 import `./real-persistence-scheduler.js`；10 用例 |
| `wiki/raw/task_issue-316_sa3_impl.md` | 技能固定产物 | 本报告（原位新建） |

**未改动**（DENY 落实）：`packages/vfsl-codegen/src/**`、`packages/vfsl/src/**`、`packages/namespace-runtime/src/**`、`domains/vfs3-assets/**`、`docs/**`、CI/vitest/根 `package.json`、`readdata-schema-projection-fixture.ts`、`real-persistence-scheduler.ts` 及其余既有测试/fixture。

## SA2 Finding落实

| Finding ID | Implementation | Result |
| --- | --- | --- |
| F1（MAJOR，T-4 装置范围自洽，方案 (b)） | 新文件**文件内自包含装置**：私有 `TXT_316`/`ENV_316`/`seedRoot316`/`makeHandle316`/`makeReadyRuntime316`（配方镜像 `readdata-schema-projection-fixture.ts:73-98`：memory persistence + META docId/createdAt → seedRoot → `createDoc` → seam + 有界 `expect.poll` 5s）；`git status` 证 `readdata-schema-projection-fixture.ts` 与其余 readData 测试零 diff | 已落实；`readData(['b'])` 可观察预写值 50（T-4 前置用例 + b 用例），F1 验收三条件全满足 |
| F2（命名碰撞：既有 FIXTURE 已占 `p`/`q`） | pattern 配对面改用 `pp`/`ppe`/`ppr`/`ppu`，容器侧补 `u`/`r`；既有字段与 7 条断言原样 | 已落实；无碰撞，评测 16/16 绿 |
| F3（类型来源措辞：类型 import 自 `@nomicore/vfsl-protocol`，生成文本只做 `VfslPathMap` 增广） | `TYPED_ACCESS_CONSUMER` 首行 `import type { PathAt, PathElementValue, PathPatchValue, PathValue, VfslPathMap, VfslTypedAccess } from '@nomicore/vfsl-protocol'`；`M := 同 program 中经生成文本增广的 VfslPathMap` | 已落实；consumer program 0 诊断，负例恰 1×TS2322 |
| F4/F5（设计锚点细分/行号精度） | 测试实现不依赖行号锚点；T-4 失败面按**修正后的机制**断言（doc-runtime 值读终态 `PATH_NOT_ALLOWED`，`runtime.ts:485` 透传；不断言 resolve 侧 `SCHEMA_PATH_NOT_FOUND` 进入失败联合） | 已落实（无测试行为偏差） |
| N1（非阻断：readData 失败机制归因） | 采纳修正：失败面配对只断言 `PATH_NOT_ALLOWED` + 无 `schema` 键 + path 回显；文件注释说明 resolve 侧失败在组合面收敛 `schema:null`、不进失败联合 | 已采纳；断言与源码一致 |
| N2/N3（措辞/行号精度） | 属设计文本级观察，无测试落点 | 无需实现动作 |

## File scope check

| Changed path | ALLOW entry | Purpose |
| --- | --- | --- |
| `packages/vfsl-codegen/test/generate-int-range.test.ts` | §10 ALLOW「扩展：T-1（typed-access program 级编译断言，类型 import 自 `@nomicore/vfsl-protocol`）、T-2（desync 负控）」 | 覆盖缺口 (c)(d) |
| `packages/vfsl/test/resolve-schema-at-path-int-range.test.ts` | §10 ALLOW「扩展：T-3（FIXTURE 增补 … 7 组配对同构 + 码集合断言；既有 7 断言与既有字段零改动）」 | 覆盖缺口 (a) |
| `packages/namespace-runtime/test/runtime-readdata-int-range.test.ts` | §10 ALLOW「新增：T-4（readData 端到端；文件内自包含装置 … 只读复用 `./real-persistence-scheduler.js`；不修改 `readdata-schema-projection-fixture.ts`）」 | 覆盖缺口 (b) |
| `wiki/raw/task_issue-316_sa3_impl.md` | 技能固定产物（实现报告） | 证据留痕 |

无 ALLOW 外路径改动；无 DENY 触碰（`git status --short` 仅上表 3 个测试路径 + Host 既有 4 件 wiki 产物）。

## Verification

| Command | Result | Evidence |
| --- | --- | --- |
| `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/vfsl-codegen/test/generate-int-range.test.ts --passWithNoTests=false` | **13 passed**（10 既有 + 3 新增） | `Test Files 1 passed`；`Type Errors no errors` |
| `… vitest run packages/vfsl/test/resolve-schema-at-path-int-range.test.ts` | **16 passed**（7 既有 + 9 新增：1 前提 + 7 配对 + 1 码集合） | 同上 |
| `… vitest run packages/namespace-runtime/test/runtime-readdata-int-range.test.ts` | **10 passed** | 同上 |
| `… vitest run <上述 3 文件> packages/vfsl/test/int-range-fixture-drift.test.ts` | **4 files / 44 tests passed**；`Type Errors no errors` | 焦点契约集（含既有指纹漂移哨兵）全绿 |
| `pnpm typecheck` | **exit 0**（14 个 tsc 工程） | 输出尾 `[typecheck exit: 0]` |
| `pnpm exec tsc --noEmit --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --verbatimModuleSyntax … packages/namespace-runtime/test/runtime-readdata-int-range.test.ts` | **exit 0** | 冗余核验：`packages/namespace-runtime/tsconfig.json` 只 include `src/**`（包测试默认不进 `pnpm typecheck`），新文件按 base 配置严格档单独过检 |
| `pnpm generate --check` | **exit 0** | AC2 新鲜度闸门（生产零改动的直接哨兵） |
| `sha256sum domains/vfs3-assets/generated.ts` | `342d8c1fe0814409f682852c13748260b9d6cbda125afe0e815a8de3298e6707` | 与 SA6 §4 / SA1 / SA2 钉值逐字节一致（AC2） |
| `git diff --check` | **exit 0**（无输出） | diff 卫生 |
| `git status --short` | 仅 2 个 ` M` 测试文件 + 1 个 `??` 新测试文件 + 4 件既有 wiki 产物 | 生产实现零改动 |

**红→绿结论（TDD 口径）**：SA6 契约在基线即为绿（能力由 #351 交付，SA6 §13 明示不伪红）；本次四条覆盖缺口契约项 C1c/C1e/C3b/C3c 落地后**在真实门禁入口全绿**，且带非空转反证：C1c 的 `@ts-expect-error` 自我反转 + 负例恰 1×TS2322（投影退化 `any`/`string` 即红）、C1e 的篡改派生物必须响亮 `structure/value desync`（白名单放成 catch-all 即红）、C3b 的 7 组配对 + 两枚冻结码集合（新增第三码/特判分支即红）、C3c 的条件键/range 双键/detached/同码配对（补 `undefined` 槽或不 detached 即红）。

## Deferred verification

| 项 | 归属 | 说明 |
| --- | --- | --- |
| 全量 `vitest run --typecheck`（353+ 文件）与 SA7 动态验收 | SA7 / 最终验证 | SA3 按技能范围只跑 SA6 指定的焦点契约 + 受影响 typecheck + 设计指定静态 check；全量门禁与活链路验证不属 SA3 |
| T-5（C1d）CLI 领域端到端 | 设计 §7 T-5 **明确可选** | 未实现：设计明示「若 Host 只要求最小集可缓做」，且既有 `generate-cli-check.test.ts` 已覆盖新鲜度语义本体；本 dispatch 只要求批准计划的最小必要集，故记录为可选项而非遗漏 |
| `.test-d.ts` 镜像形态 | 设计 §7 T-1 备选（二择一） | 主落点选 program 级（直接编译真实生成物、免镜像漂移），未新增镜像文件；若后续需要冗余哨兵可补 |
| 突变注入实证（回退 `number`→`string` 等） | SA4/SA7 复核面 | SA3 不改生产代码，不做破坏性突变实验；敏感性由上述非空转反证 + SA6 §12.7 矩阵承接 |

## Deviations or blockers

| 项 | 类型 | 处置 |
| --- | --- | --- |
| T-1 首版用 `PathValue<PathAt<VfslPathMap, ['e', 0]>>` 锚数组元素 | 测试装置精度偏差（非验收语义变化） | 实测该形态编译得 1 条 TS2322（`UnknownPath<[0]>`）：访问面 path 段限 `readonly string[]`、数字字面量段不落入 `` `${number}` `` 成员键空间。改为协议包既有元素投影 `PathElementValue<PathAt<VfslPathMap, ['e']>>`（= `number`）锚定数组元素叶；`b`/`c` 标量与 `patch` 读写断言按设计原样保留。生产零改动、断言强度不降 |
| T-3 野段 `{}` 需绕过公共签名 | 测试装置（既有仓内先例） | 用 `const WILD_SEG = {} as unknown as string`（同 `runtime-readdata-hostile-path-guard.test.ts` 的 `as unknown as readonly (string|number)[]` 先例）驱动形状守卫分支，断言 `SCHEMA_PATH_INVALID` 配对同码 |
| T-4 与 #273 共享 fixture 的平行构造 | 设计已显式声明（F1 方案 (b) + 备选 6） | 新文件仅私有镜像配方；被复用共享件只有 `real-persistence-scheduler.ts`（只读 import），无第二套调度器/持久化实现 |
| 无阻塞项 | — | 设计可实施、范围充足、红灯契约自洽（基线绿为契约明文事实，非矛盾） |

## Suggested commit message

```
test(#316): int/range 叶子 codegen 与 readData 投影覆盖补齐 / add coverage sentinels

- C1c：typed-access 编译级投影（generated + consumer 同 program；PathAt/PathValue/
  PathPatchValue/PathElementValue）+ 负例恰 1×TS2322 敏感性反证
- C1e：叶子闸门过宽放行负控（结构 leaf + 值侧未知 kind → structure/value desync）
- C3b：int/range ↔ pattern 7 组配对同构 + path 新鲜回显 + 失败码集合 ⊆ 两枚冻结码
- C3c：readData 端到端（自包含装置：预写值/条件键/range 双键/元素叶/Record 值叶/
  union 叶/docs 切片/detached 隔离/与 pattern 同码失败配对）

生产实现零改动（ADR 0020 决策 7/8 已在 HEAD 满足）；pnpm generate --check exit 0，
generated.ts sha256 钉值 342d8c1f…e6707 不变。
```

（建议提交信息仅供 Controller 选择；SA3 不执行 `git add`/commit/push。）
