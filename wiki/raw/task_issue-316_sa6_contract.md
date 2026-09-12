# SA6 诊断与验收契约 — issue #316：Int/Range 叶子的 codegen 与 readData 投影（ADR 0020 决策 7/8）

- Dispatch：`sa-e1abc140-82ee-4577-9b0c-d3adfb05e264`（mabf-sa6 / acceptance-contract / iteration 0）
- 任务类型：**Feature 的验收/回归契约（能力在 HEAD 已整体交付，无剩余能力缺口）**。派工明文「不得实现或编写可执行测试」⇒ SA6 模式 **contract-only**：本报告是唯一交付物；证据由 HEAD 上的最小复现探针（§5/§9）与既有测试/门禁取得，探针已在收尾前删除（§16）。
- 基线 worktree：`/home/wangjian/nomicore-fix-issue-316`，分支 `mabf/issue-316`，HEAD `bd9fb93dd69d6b27f10113cd98d8dfca9184ce8c`（`feat(vfsl): add Int and Range number constraints (#351)`）。
- 结论预告：**`verdict: approve`** —— 诊断稳定、根因链清晰、契约可执行、测试入口真实；但诊断结论是**反向**的：issue #316 要求的 codegen / resolve-schema-at-path 行为在 HEAD 已由前序集成 PR #351（#315 的集成 PR）**全部落地并大部分已有测试锚定**，不存在可诚实建立的红灯契约（Feature 不虚构根因；Refactor 先例「基线可以初始为绿，不伪称红灯」）。本报告把 #316 的 4 条 AC 转成可执行的验收/回归契约（C1~C4），并补齐 4 项**覆盖缺口**（比较型同构、readData 端到端、typed-access 编译级敏感性、codegen 过宽放行负控）与突变敏感性矩阵；这些新增项在 HEAD 即为绿，是防回归哨兵而非待实现红灯。

---

## 1. Task type and inputs

| 输入 | 路径 | 状态 / 关键内容 |
| --- | --- | --- |
| Host 任务简报 | `wiki/raw/task_issue-316.md` | 存在；Issue #316 body（What to build + 4 条 AC + `Blocked by #315`、Parent PR #311；state open） |
| Owner comments | 派工单明示 REST snapshot 为空；简报 §Comments 亦为空 | **无 owner 追加要求**——需求全集 = Issue body 4 条 AC + ADR 0020 决策 7/8（§2） |
| relevant_decisions | `wiki/raw/task_issue-316_relevant_decisions.md` | **不存在**（本任务未生成；非阻塞） |
| conflict_report | `wiki/raw/task_issue-316_conflict_report.md` | **不存在**（本任务未生成；非阻塞） |
| SA8 产物 | `wiki/raw/task_issue-316_*` | **不存在**（除简报与本报告外无 316 产物；§3 以 ADR + 模块 AGENTS.md + CI 为可执行约束） |
| 权威决策 | `docs/adr/0020-vfsl-number-constraints.md` 决策 7（codegen 生成 `number`，品牌类型不做）、决策 8（readData 投影按标量下钻、不新增拒绝路径与失败码）；旁证决策 5（IR/derived `int`/`range` 叶子、既有指纹不变） | 本票全部依据 |
| 相邻契约 | ADR 0005（codegen 确定性/字节稳定）、ADR 0016（readData 语义 schema 投影四件套 + 两枚失败码冻结）、ADR 0019（docs 切片） | 契约硬约束 |
| 模块规约 | 根 `AGENTS.md`（Typed Namespace writes）、`packages/vfsl/AGENTS.md`、`packages/vfsl-codegen/AGENTS.md`、`packages/namespace-runtime/AGENTS.md`、`docs/AGENTS.md` | §3 |
| 既有实现 | HEAD 已含 #315 集成 PR #351 的 codegen / resolve / namespace-runtime 改动（§5 溯源） | 关键：**基线已绿** |
| 既有测试 | `packages/vfsl-codegen/test/generate-int-range.test.ts`（10）、`packages/vfsl/test/resolve-schema-at-path-int-range.test.ts`（7）、`packages/vfsl/test/int-range-fixture-drift.test.ts`（5）、`packages/vfsl/test/parse-vfsl-int-range.test.ts`、`packages/vfsl/test/validate-int-range.test.ts` | §4 实测 22/22 绿 |

**范围界定**：在范围内 = codegen 对 `int`/`range` 叶子生成 `number` + 生成物可编译、`pnpm generate --check` 零漂移、resolve-schema-at-path（与 readData 组合面）对 `int`/`range` 与 `pattern` 叶同构、包测试与 typecheck 全绿。不在范围内 = 品牌类型 codegen（ADR 0020 「明确不做」）、`Int`/`Range` 文本/parser/validate 本体（#315 范围，已交付）、`domains/vfs3-assets/**` 任何改写。

---

## 2. Owner comment mapping

- REST comments snapshot 与简报 §Comments 均为空 ⇒ **无超出 Issue body 的 owner 追加要求**。
- 契约必达项 = Issue body 4 条 AC + ADR 0020 决策 7/8：

| Issue AC | 契约条目 | HEAD 状态 |
| --- | --- | --- |
| AC1 含 Int/Range 字段的 schema 生成 TS 为 `number`，生成物可编译 | C1（§12.2） | **已满足**（既有测试 + 探针 B/D） |
| AC2 `pnpm generate --check` 既有生成物零漂移（字节稳定基线不变） | C2（§12.3） | **已满足**（exit 0 + 字节钉值 + 新鲜度敏感负控） |
| AC3 投影路径落在 int/range 叶子上的行为与 pattern 叶子同构（终态/拒绝分类一致） | C3（§12.4） | **已满足**（既有 C6b + 探针 A/C 比较型同构） |
| AC4 包测试、typecheck 全绿 | C4（§12.5） | **已满足**（typecheck 0；全量 353 文件 / 3863 用例绿） |

---

## 3. SA8 constraints（无 316 专属 SA8 产物，约束来自规范与 CI）

| # | 约束来源 | 内容 | 本契约落点 |
| --- | --- | --- | --- |
| S1 | `packages/vfsl-codegen/AGENTS.md` | 生成器消费 evaluator 输出、不重推导语义；输出确定且逐字节稳定；`generate --check` 必须检出任何陈旧生成物；不支持形状响亮失败而非弱化发射 | C1（禁 desync / 禁字符串弱化）、C1d（过宽放行负控）、C2（新鲜度） |
| S2 | `packages/vfsl/AGENTS.md` + ADR 0016 | `resolveSchemaAtPath` 失败码恰两枚（`SCHEMA_PATH_NOT_FOUND` / `SCHEMA_PATH_INVALID`）为冻结契约；int/range 属值级终态，不新增拒绝路径 | C3b（码集合 + 同构）、C3c |
| S3 | `packages/namespace-runtime/AGENTS.md` + ADR 0016 D5 | 公共 API 只暴露 detached 投影；每次读全新 wrapper、不冻结、零缓存；值缺席照常返 schema | C3c（detached 隔离、条件键、docs 切片） |
| S4 | ADR 0020 决策 7 | TS 类型层对 int/range 一律 `number`，品牌类型明确不做；生成物形状不胀、字节稳定基线不变 | C1a（发射文本）、C2（字节钉值） |
| S5 | ADR 0020 决策 8 | 投影按标量叶下钻，终态/下钻规则与 `pattern` 叶同构，**不新增拒绝路径与失败码** | C3a/C3b/C3c |
| S6 | 根 `AGENTS.md`（Typed Namespace writes） | 生成的 `VfslPathMap` 增广必须使 `PathAt`/`PathValue`/`PathPatchValue` 对 int/range 字段成立，写路径类型 fail-closed | C1b（编译级 typed-access + `@ts-expect-error` 负例 + TS2322 敏感性反证） |
| S7 | CI `.github/workflows/ci.yml` | `pnpm typecheck`；`vitest run --typecheck.only`（`*.test-d.ts`）；6 分片 `*.test.ts`；`codegen-freshness` = `pnpm generate --check` | C4（门禁清单） |
| S8 | ADR 0021 决策 3 先例 | 消息文案不进冻结面（只钉码/锚/路径/计数） | §12.8 断言纪律 |

---

## 4. Environment and baseline

| 项 | 值 | 命令 / 证据 |
| --- | --- | --- |
| 环境 | Linux；Node `v24.13.0`；pnpm `10.28.2`；vitest `3.2.7`；typescript `5.9.3`；tsx `4.23.12` | `node -v`、`pnpm -v` |
| 依赖 | `pnpm install --frozen-lockfile --offline` → exit 0（65 包全部 reused 自本地 store，零网络） | job 输出 |
| 生产实现改动 | **无**（起点/终点 `git status --short` 仅 Host 未跟踪简报 + SA6 临时探针目录，探针已删） | §16 |
| 全量类型检查 | `pnpm typecheck`（14 个 tsc 工程）→ **exit 0** | job 输出 |
| 全量测试 | `NODE_OPTIONS=--conditions=nomicore-source vitest run --typecheck` → **exit 0**：`Test Files 353 passed`、`Tests 3863 passed`、`Type Errors no errors`，597.41s | job 输出 |
| 焦点测试 | `vitest run packages/vfsl-codegen/test/generate-int-range.test.ts packages/vfsl/test/resolve-schema-at-path-int-range.test.ts packages/vfsl/test/int-range-fixture-drift.test.ts` → **3 files / 22 tests passed**，Type Errors no errors，1.63s | job 输出 |
| 生成物新鲜度 | `pnpm generate --check` → **exit 0** | 根 `package.json` `generate` 脚本 |
| 域生成物字节 | `domains/vfs3-assets/generated.ts` sha256 = `342d8c1fe0814409f682852c13748260b9d6cbda125afe0e815a8de3298e6707`（与 #315 SA6 §4 钉值逐字节一致） | `sha256sum` |
| 域文本面 | `domains/vfs3-assets/schema.vfsl` 中 `\bInt\b`/`\bRange\b` 出现 **0** 次（既有字节稳定基线不被新构造触发） | `grep -c` |
| 规格机检 | `python3 tests/acceptance/vfsl_spec_acceptance.py` → **GREEN 22/22，exit 0** | 输出 |
| diff 卫生 | `git diff --check` → **exit 0**（无输出） | 命令 |
| 既有指纹哨兵（`int-range-fixture-drift.test.ts` 内钉值，测试绿即成立） | envelope `sha256:v1:7b6c19cbac93cbf104c055c320b5e4a5ba72e0db87342de0853c68bedff53f39`；semantic `sha256:v1:b71be76e3d3579670236b14a36373716db6238d86a15da440f44aecbb9b0631c` | 焦点测试绿 |

**#316 相关实现溯源（HEAD 已交付）**：`git show --stat bd9fb93` 显示 #316 直接相关文件全部落在 #351 集成 PR 内：

```
packages/namespace-runtime/src/read-schema-projection.ts | 14 ++++++++++++++
packages/vfsl-codegen/src/emitter.ts                     | 13 +++++++++++--
packages/vfsl-codegen/src/valuetype.ts                   |  5 +++++
packages/vfsl/src/resolve-schema-at-path.ts              |  4 ++--
4 files changed, 32 insertions(+), 4 deletions(-)
```

其中 `resolve-schema-at-path.ts` 的 4 行是**注释级**改动（`resolve-schema-at-path.ts:290`、`:414` 的 `default` 分支注释补 `int/range`）——即该文件在 #351 之前就已按 kind-agnostic 的「值级终态」处理 `int`/`range`；codegen 与 detached 克隆才是真实逻辑改动（`valuetype.ts:35-39`、`emitter.ts:339-348`、`read-schema-projection.ts:170-183`）。

---

## 5. Positive reproduction（能力已存在：基线绿，无可诚实建立的 HEAD 红灯）

**结论先行**：在 HEAD 上逐一执行 #316 的全部目标断言，**没有一条红**。这不是「红在错误原因」或「测试入口失效」，而是因为 #316 的实现范围已由基线提交 #351 整体交付；SA6 不做伪红（Feature 不虚构根因；Refactor 先例允许基线绿）。为排除自欺，本报告用四条独立证据链交叉验证「已交付」：源码溯源（§4）、既有测试（§4）、新增独立探针（§9 E2~E8）、真实产品入口 CLI（§9 E8）。

| # | #316 目标行为 | HEAD 实测 | 证据 |
| --- | --- | --- | --- |
| P1 | `int`/`range` 叶发射 `number` | `a/b/c/d → PathSchema<number, 'leaf'>`；数组元素位 → `PathSchema<Record<\`${number}\`, PathSchema<number, 'leaf'>>, 'array'>`；union 成员 → `number \| string`；别名 → `export type Count = number;` | 既有 `generate-int-range.test.ts`；探针 B；探针 D（CLI） |
| P2 | 生成物可编译 | 生成文本（单文件孤立 program）`preEmitDiagnostics` **0 条**；generated + typed-access consumer 联合 program **0 条** | 既有 C6a；探针 B |
| P3 | pattern 叶保持 `string`（同构对照，不得被 number 泛化） | `p → PathSchema<string, 'leaf'>`；`q → PathSchema<Record<\`${number}\`, PathSchema<string, 'leaf'>>, 'array'>` | 探针 B/D |
| P4 | resolve-schema-at-path 按标量叶终态处理、不新增拒绝路径 | `['b'] → ok {kind:'int',min:1,max:100}`；`['c'] → ok {kind:'range',...}`；`['e',0] → ok int 叶`；`['r','k'] → ok int 叶`；`['bare'] → {kind:'int'}` 且 `Object.keys === ['kind']` | 既有 C6b；探针 A |
| P5 | 下钻/拒绝分类与 pattern 叶同构 | 7 组配对路径（标量下钻 string/number 段、数组元素叶、union 终点、Record 值叶、敌意段）**逐组同 ok 性、同失败码**：`SCHEMA_PATH_NOT_FOUND`（内容级）×6，`SCHEMA_PATH_INVALID`（敌意段）×1；失败码集合 ⊆ {两枚冻结码} | 探针 A |
| P6 | readData 组合面（投影四件套 + detached）对 int/range 成立 | `readData(['b']) = {ok:true, value:50, schema:{valueSchema:{kind:'int',min:1,max:100},…}}`；裸 Int 键恰 `['kind']`；数组元素 `['e',1]`；docs `{'ROOT.b':[' 库存计数 ']}`；变异返回值后重读不受污染；`['b','x']` 与 `['p','x']` 同为 `PATH_NOT_ALLOWED` | 探针 C |
| P7 | `pnpm generate --check` 零漂移 | 仓根 exit 0；未改任何既有生成物（`generated.ts` sha256 = 基线钉值） | §4 |
| P8 | 真实 CLI 入口对含 Int/Range 领域成立 | 临时领域（表头 + ROOT 含三形态）`pnpm generate --domains <tmp>` exit 0，生成文本含 `number` 叶，编译 0 诊断；新鲜 `--check` exit 0，追加陈旧标记后 `--check` exit 1 | 探针 D |

**反证「不是环境/夹具/入口问题」**：探针装置与仓内既有测试同源（`NODE_OPTIONS=--conditions=nomicore-source` + 源码入口 `packages/*/src/index.ts`）；同一探针里 pattern 对照面绿、int/range 面也绿（而非「全绿因测试空转」——探针 B 的 TS2322 敏感性反证与 tampered desync 负控证明断言在错误实现下会红，§9/§12.7）。

---

## 6. Negative control（相近负例 / 不变面，HEAD 已绿，必须保持）

| # | 控制 | HEAD 实测 | 实现后必须 |
| --- | --- | --- | --- |
| N-1 | pattern 叶投影 | `string`（`PathSchema<string, 'leaf'>`），编译通过 | 保持（不得被 int/range 的 `number` 泛化） |
| N-2 | 叶子闸门过宽放行负控：手造 derived（leaf 结构 + `{kind:'xml'}` 值） | `generateProjection` **响亮抛错**：`structure/value desync at ROOT.b (structure=leaf, value=xml)` | 保持（白名单是显式集合，非「全盘放行」） |
| N-3 | 域文本面与指纹 | `vfs3-assets@1` 编译 ok、双指纹/`generated.ts` 字节 = 钉值；`schema.vfsl` 无 Int/Range | 逐字节保持 |
| N-4 | `generate --check` 新鲜度语义 | 新鲜 exit 0；陈旧 exit 1 且**不写盘**（既有 `generate-cli-check.test.ts`＋探针 D） | 保持 |
| N-5 | 小写 `int`/`range` 非保留名 | `type int = number;` / `type range = number;` 保持 ok（#315 既有测试） | 保持（#316 不得扩大保留面） |
| N-6 | 失败码集合 | int/range 相关失败只出现两枚冻结码（探针 A 逐例断言） | 保持（ADR 0016 / ADR 0020 决策 8） |
| N-7 | readData 失败分支形状 | 失败对象不带 `schema` 键；`PATH_NOT_ALLOWED` / `RUNTIME_READ_DISABLED` 不变（既有负控） | 保持 |
| N-8 | 消息文案不冻结 | 探针只断言码/路径/键集，不钉文案 | 保持断言纪律 |

---

## 7. Stability, scale and timing

- 全链路为同步纯函数（parser/evaluate/validate/resolve/codegen）；readData 组合面经 memory persistence + Y.Doc，但读路径仍为同步快照投影。无并发/时钟/规模敏感断言。
- **确定性**：探针 A/B/C 各自连续两轮运行 `diff` 为空（`PROBE_A_DETERMINISTIC=yes`、`PROBE_B_DETERMINISTIC=yes`、`PROBE_C_DETERMINISTIC=yes`）；`generateProjection` 两次调用逐字节相等（探针 B 内断言）。
- **规模**：全量测试 353 文件 / 3863 用例 597.41s（maxWorkers=1），无超时/抖动；`generate --check` 对仓内单领域 <2s。
- **时序面**：readData 探针以状态轮询等待 `schema.state === 'ready'`（有界 5s，实测即时 ready），与仓内 `expect.poll` 同款纪律，不引入额外时序假设。

---

## 8. Root-cause chain / capability gap

| Step | Fact | Evidence | Confidence |
| --- | --- | --- | --- |
| 症状（Issue 视角） | 票面要求「codegen 与 readData 投影适配 int/range 叶子」 | `wiki/raw/task_issue-316.md` §What to build / AC1~AC4 | 确定 |
| 直接事实 | HEAD 的 codegen 已把 `int`/`range` 叶投影为 `number`：`valuetype.ts:35-39`（`case 'int': case 'range': return 'number'`），叶子闸门显式放行（`emitter.ts:339-348`） | `git show bd9fb93 -- packages/vfsl-codegen/src/{valuetype,emitter}.ts`；探针 B/D | 确定 |
| 直接事实 | `resolveSchemaAtPath` 已把 `int`/`range` 按值级终态处理（`resolve-schema-at-path.ts:289-291`、`:413-414` 的 `default` 分支），#351 对该文件仅改注释 | `git show bd9fb93 -- packages/vfsl/src/resolve-schema-at-path.ts`（4 行 = 2 处注释）；探针 A | 确定 |
| 直接事实 | readData 组合面的 `cloneValueSchema` 已含 `int`/`range` case（`read-schema-projection.ts:170-183`，条件键逐键携带） | `git show bd9fb93 -- packages/namespace-runtime/src/read-schema-projection.ts`；探针 C | 确定 |
| 触发条件 | 无失败触发条件——HEAD 上不存在令 #316 目标断言变红的输入 | §5 P1~P8 全绿 | 确定 |
| **最深根因（能力缺口 = 0）** | #316 是 #315 的后续票，但 #315 的集成 PR #351 已按 #315 SA6 契约 C6a/C6b/C6c **整体交付**了 codegen + 投影 + detached 克隆，并随附测试；#316 的 AC 被前序 PR 吸收 | §4 溯源 + §5；`generate-int-range.test.ts` / `resolve-schema-at-path-int-range.test.ts` 已存在于 HEAD | 确定 |
| 剩余缺口（**非生产**） | 仅 **验收覆盖缺口**：缺（a）与 pattern 叶的**比较型**同构断言、（b）readData 端到端（`cloneValueSchema` 现为零测试覆盖）、（c）typed-access 编译级投影、（d）codegen 过宽放行负控 | §12.6 覆盖缺口；`grep` 全仓 namespace-runtime 测试无 Int/Range | 确定 |
| 放大因素 | 若实现者误以为「#316 还需改代码」，可能重新改 `valuetype`/`emitter`，反而打破 `generate --check` 字节稳定基线 | §4 钉值 + §12.7 M1/M2/M7 | 高 |
| 未证实假设 | 无关键假设。唯一开放项是 Host 对「#316 应关闭为已交付，还是转为覆盖补票」的处置（§15 U1） | — | — |

**能力缺口（Feature 口径）= 无。** 本票的可交付价值因此转为：把 #316 的 AC 固化为**可执行验收/回归契约** + 补齐 4 项覆盖缺口，防止后续重构把已交付行为改回 `string`/新增拒绝码/丢失 detached 条件键。

---

## 9. Causal experiments

| # | 实验 | 控制变量 | 观察（HEAD 实测） | 结论 |
| --- | --- | --- | --- | --- |
| E1 | 溯源：`git show bd9fb93 -- <4 个 316 相关文件>` | 只看基线提交 | codegen/克隆为真实逻辑改动；resolve 为注释级 | #316 范围已随 #351 落地 |
| E2 | 探针 B：规范 FIXTURE（裸 Int / Int 区间 / Range 小数 / Range 负端点 / 数组 / 可选 / union / Record / 嵌套别名 / 别名 / pattern 对照）→ `generateProjection` | 只换值形状 | 全部 int/range 位 `PathSchema<number, 'leaf'>`；pattern 位 `string`；两次生成逐字节相等 | 发射面完整、确定性 |
| E3 | 探针 B：生成物写临时 `generated.ts` → `preEmitDiagnostics`；再加 consumer（`PathValue`/`PathPatchValue` 读 + `access.patch` 写 + `@ts-expect-error` 写字符串/布尔） | 只换 program 组成 | 孤立 0 诊断；consumer 0 诊断；负例文件 `PathValue<['b']> = '42'` 恰 **1 条 TS2322** | 生成物可编译、类型投影 = `number`、写路径 fail-closed；TS2322 是断言敏感性的反证（若投影为 `any`/`string` 则 0 条） |
| E4 | 探针 B 负控：JSON 克隆 derived 后把 `b` 的值改为 `{kind:'xml'}`（leaf 结构位）→ `generateProjection` | 只换值 kind | 抛 `structure/value desync at ROOT.b (structure=leaf, value=xml)` | 叶子白名单是显式集合，未被 #316 类改动放成「全盘放行」 |
| E5 | 探针 A：配对 fixture（`b/bare/c/e/r/u` vs `p/pe/pr/pu`）→ `resolveSchemaAtPath` | 只换 kind | 终点全部 `ok` 且 valueSchema 深等透传（含 `Object.keys(['kind'])` 条件键哨兵）；7 组下钻配对**同 ok 性、同码、同 path 回显** | 与 pattern 叶同构（ADR 0020 决策 8） |
| E6 | 探针 A：失败码集合扫描 | 全部失败例 | 仅出现 `SCHEMA_PATH_NOT_FOUND`（内容级）与 `SCHEMA_PATH_INVALID`（敌意段） | **零新增拒绝路径/失败码** |
| E7 | 探针 C：memory persistence + Y.Doc + runtime ready → `readData` | 只换字段 kind | `['b']` 三键 ok、value=50、schema int 叶；裸 Int 键恰 `['kind']`；`['e',1]` int 叶；docs 切片 `{'ROOT.b':[…]}`；变异投影后重读不污染；`['b','x']`/`['p','x']` 同 `PATH_NOT_ALLOWED`（同文案「标量不可作为容器」） | readData 组合面（含 `cloneValueSchema`）对 int/range 完整、detached、与 pattern 同码 |
| E8 | 探针 D：临时领域（`// @lang/@id/@version` + ROOT 含三形态）→ 真实 `pnpm generate --domains <tmp>` | 走产品入口 | generate exit 0、生成文本含 number 叶、编译 0 诊断；新鲜 `--check` exit 0；追加陈旧标记后 `--check` exit 1 | AC1/AC2 在 CLI 入口成立且新鲜度闸门敏感 |
| E9 | 仓根门禁 | 全量 | `pnpm generate --check` exit 0；`generated.ts` sha256 = 基线；`git diff --check` 0 | 字节稳定基线不变 |
| E10 | 测试入口 | 全量 | 焦点 3 文件 22 用例绿；全量 353 文件 3863 用例绿、Type Errors 0；spec 机检 22/22 | AC4 成立 |

---

## 10. Impact surface

**承载 #316 行为的实现面（只读证据；本票无需改动，改动即回归风险）**

| 文件 | 关键点 |
| --- | --- |
| `packages/vfsl-codegen/src/valuetype.ts:35-39` | `int`/`range` → `'number'`（ADR 0020 决策 7） |
| `packages/vfsl-codegen/src/emitter.ts:335-357` | `leaf` 结构位显式白名单：scalar/enum/pattern/int/range/union；其余 → `desync` |
| `packages/vfsl/src/resolve-schema-at-path.ts:289-291`、`:413-414` | 值级终态 `default`（含 int/range）；失败分类复用 `classifyStructureReject`（leaf/plain/xml-fragment → 有终态 → 内容级 `SCHEMA_PATH_NOT_FOUND`） |
| `packages/namespace-runtime/src/read-schema-projection.ts:170-183` | `cloneValueSchema` 的 int（条件键）与 range case；detached/memo 纪律继承 |
| `packages/vfsl/src/{ir,derived,semantic,evaluate,validate,shapes,resolve,parser}.ts` | 上游 `int`/`range` 叶子（#315 已交付；本票回归面） |

**测试面（建议路径，命名可调但须被真实入口发现）**

- 复用/扩展（已存在，保持绿）：`packages/vfsl-codegen/test/generate-int-range.test.ts`（C1a）、`packages/vfsl/test/resolve-schema-at-path-int-range.test.ts`（C3d）。
- 扩展（覆盖缺口，HEAD 即绿）：`packages/vfsl-codegen/test/generate-int-range.test.ts`（+C1b 编译敏感性、+C1c CLI 领域端到端、+C1d 过宽放行负控）；`packages/vfsl/test/resolve-schema-at-path-int-range.test.ts`（+C3a/C3b 比较型同构与码集合）。
- 新增：`packages/namespace-runtime/test/runtime-readdata-int-range.test.ts`（C3c，沿 `readdata-schema-projection-fixture.ts` 装置）；可选 `packages/vfsl-codegen/test/generate-int-range.test-d.ts`（C1b 的 `.test-d.ts` 镜像形态，沿 `generate-number-literals.test-d.ts` 先例）。

**必须不变（回归红线）**：`domains/vfs3-assets/**` 逐字节；指纹前缀 `sha256:v1:`；错误码集合（不增不减）；`ISSUE_LIMIT`/预算语义；parser/validate 本体（#316 只涉及生成与投影消费面）。

---

## 11. Ruled-out hypotheses

| # | 假设 | 排除证据 |
| --- | --- | --- |
| H1 | 「codegen 仍拒绝 int/range（抛 desync）」 | 探针 B/E2 发射成功；既有 C6a 绿；`emitter.ts:339-348` 白名单含 int/range |
| H2 | 「resolve-schema-at-path 会对 int/range 新增拒绝路径或失败码」 | 探针 A/E5/E6：终态 ok 透传、下钻与 pattern 同码、码集合 ⊆ 两枚冻结码 |
| H3 | 「readData 投影会因 `cloneValueSchema` 缺 case 而崩/丢 schema」 | 探针 C/E7：ok 三键、schema 深等、detached；`read-schema-projection.ts:170-183` 在场 |
| H4 | 「#316 需要新的生产实现（红→绿）」 | `git show bd9fb93` 溯源 + 8 条目标行为 HEAD 全绿 ⇒ 实现范围已被 #351 吸收（§5/§8） |
| H5 | 「生成物/指纹字节漂移」 | `pnpm generate --check` exit 0；`generated.ts` sha256 = #315 钉值；域文本无 Int/Range；drift 哨兵绿 |
| H6 | 「包测试/typecheck 有既有红」 | typecheck 0；焦点 22/22；全量 3863/3863；spec 22/22 |
| H7 | 「绿是因为断言空转/测试入口失效」 | 探针 B 的 TS2322 敏感性反证（投影非 number 则诊断数变 0）、E4 过宽放行负控、E8 陈旧 `--check` = 1；探针均经真实源码入口执行 |
| H8 | 「pattern 叶也应投影 number / 可被泛化」 | ADR 0020 决策 7 只针对数值约束叶；探针 B/D 的 pattern 对照保持 `string`，既有测试同款 |

---

## 12. Acceptance contract and test paths

### 12.0 契约测试总则（防伪绿）

1. 断言只观察公共接缝的运行时输出：`parseVfsl`/`evaluate`（前置判别）、`generateProjection`（**发射文本即产品**，允许文本断言）、真实 TS 编译器诊断（`preEmitDiagnostics`，不用正则冒充「可编译」）、`resolveSchemaAtPath`、`NamespaceRuntime.readData`。禁止对实现源码做字符串/正则断言。
2. 正例必须先用前置判别证明 fixture 确实走到了目标叶子（`derived.values.ROOT.fields[i].value` 深等 int/range），否则发射/投影断言可能空转。
3. 禁止 `skip`/`only`/`todo`/`failing`、env 开关、fallback、吞错、软化断言；不得为过测试改写 `domains/vfs3-assets/**`、指纹前缀、错误码集合、`ISSUE_LIMIT`。
4. **文案不冻结**（ADR 0021 决策 3 先例）：只钉错误码、路径、键集、计数与「生成文本中的 TS 类型段」。
5. 生成器是纯发射器，无法在编译期 import 运行输出：编译级断言须用「生成文本写临时文件 + consumer 同 program」或沿 `generate-number-literals.test-d.ts` 的镜像 `declare module` 形态，并在注释中说明镜像来源（发射文本断言在上一条）。
6. **本契约全部条目在 HEAD 即为绿**（Feature 已交付；无红灯）。新增项的价值由 §12.7 突变矩阵证明非空转。

### 12.1 规范 fixture

```
FIXTURE_PAIRED（C3）:
type ROOT = YMap<{
  b: number & Int<1, 100>;      bare: number & Int;
  c: number & Range<0.5, 1.5>;  e: number & Int<0, 9>[];
  r: Record<string, number & Int<0, 9>>;
  u: number & Int<1, 3> | string;
  p: string & Pattern<"^a+$">;  pe: string & Pattern<"^a+$">[];
  pr: Record<string, string & Pattern<"^a+$">>;
  pu: string & Pattern<"^a+$"> | number;
}>;

FIXTURE_CODEGEN（C1，沿 #315 §12.1 扩展）:
type Count = number & Int<0, 1000>;
type Inner = YMap<{ inner: number & Range<0, 1> }>;
type ROOT = YMap<{
  a: number & Int; b: number & Int<1, 100>;
  c: number & Range<0.5, 1.5>; d: number & Range<-40, 85>;
  e: number & Int<0, 9>[]; f?: number & Int<1, 3>;
  g: number & Int<1, 3> | string;
  h: Record<string, number & Int<0, 9>>;
  nested: Inner; count: Count;
  p: string & Pattern<"^a+$">; q: string & Pattern<"^a+$">[];
}>;
```

### 12.2 C1 — codegen 发射与编译（AC1）

| 项 | 断言 | HEAD |
| --- | --- | --- |
| C1a 发射文本 | `emittedFieldEntry('a'|'b'|'c'|'d')` 逐字等于 `PathSchema<number, 'leaf'>`；`e` = `` PathSchema<Record<`${number}`, PathSchema<number, 'leaf'>>, 'array'> ``；`f` 成员带 `?:`；`g` = `PathSchema<number \| string, 'leaf'>`；`h` 含 `Record<string, PathSchema<number, 'leaf'>>` 且外壳 kind `'map'`；别名行 `export type Count = number;`；pattern 对照 `p` = `PathSchema<string, 'leaf'>`；两次生成逐字节相等 | 绿（既有 C6a + 探针 B） |
| C1b 生成物可编译 | 生成文本写临时 `.ts` → `preEmitDiagnostics` **0 诊断**（不得抛 `structure/value desync`） | 绿（既有 C6a） |
| C1c **typed-access 编译级**（新增） | 同 program 加载 generated + consumer：`PathValue<PathAt<M,['b']>>`/`PathPatchValue<…>` 赋 `number` 通过、`access.patch(['b'], 42)` 通过；`access.patch(['b'], '42')` 与 `(…, true)` 各由 `@ts-expect-error` 反转锁定；**敏感性反证**：独立负例文件 `const bad: PathValue<PathAt<M,['b']>> = '42'` 必须恰产生 1 条 `TS2322`（若投影退化为 `any`/`string` 则 0 条 ⇒ 本项红） | 绿（探针 B 实测 1×TS2322） |
| C1d **CLI 领域端到端**（新增，可选强化） | 临时领域（表头 + ROOT 含三形态）`pnpm generate --domains <tmp>` exit 0；生成文本含 `number` 叶；`preEmitDiagnostics` 0；新鲜 `--check` 0 / 追加陈旧标记后 `--check` ≠ 0 | 绿（探针 D） |
| C1e **过宽放行负控**（新增） | 手造 derived（leaf 结构 + `{kind:'xml'}`）→ `generateProjection` 抛错且消息匹配 `structure/value desync`（不得静默发射弱化类型） | 绿（探针 B/E4） |

### 12.3 C2 — 字节稳定与新鲜度（AC2）

| 项 | 断言 | HEAD |
| --- | --- | --- |
| C2a | 仓根 `pnpm generate --check` exit 0 | 绿 |
| C2b | `domains/vfs3-assets/generated.ts` sha256 = `342d8c1f…e6707`；`schema.vfsl` 无 `Int`/`Range` | 绿 |
| C2c | `compileSchemaEnvelope(vfs3-assets@1)` 双指纹 = §4 钉值、前缀 `sha256:v1:`；两次全新编译新 fixture 指纹相等、IR JSON 往返无 `undefined` | 绿（drift 哨兵） |
| C2d | 新鲜度闸门敏感性：新鲜 = 0、陈旧/缺失 = 1 且不写盘（仓根领域由 `generate-cli-check.test.ts`；含 Int/Range 领域由 C1d 覆盖） | 绿 |

### 12.4 C3 — 投影同构与 readData（AC3）

| 项 | 断言 | HEAD |
| --- | --- | --- |
| C3a 终态透传 | `['b']`→`{kind:'int',min:1,max:100}`；`['bare']`→`{kind:'int'}` 且 `Object.keys` 恰 `['kind']`（`min`/`max` 整键缺席）；`['c']`→range 叶；`['e']`/`['e',0]`；`['r','k']`；`['u']` 值叶为 union 且首成员 int 叶 | 绿（既有 C6b + 探针 A） |
| C3b **比较型同构 + 码集合**（新增） | 配对路径逐组断言：`['b','x']↔['p','x']`、`['b',0]↔['p',0]`、`['e',0,'x']↔['pe',0,'x']`、`['e',1,0]↔['pe',1,0]`、`['u','x']↔['pu','x']`、`['r','k','x']↔['pr','k','x']` 均 `ok:false` 且**同码** `SCHEMA_PATH_NOT_FOUND`；`['b',{}]↔['p',{}]` 同码 `SCHEMA_PATH_INVALID`；失败 `path` 为调用方入参的新鲜回显；全局失败码集合 ⊆ {两枚冻结码} | 绿（探针 A 实测 7/7 同构） |
| C3c **readData 端到端**（新增） | memory persistence + ready runtime：`readData(['b'])` ok 恰三键、`value` 正确、`schema.valueSchema` 深等 int 叶；裸 Int 条件键；`['e',1]` 元素叶；`docs` 含 `ROOT.b` 字段注释；**detached**：变异返回投影后重读不污染、每次读全新 wrapper、未冻结；失败面：`['b','x']↔['p','x']` 同码（`PATH_NOT_ALLOWED`） | 绿（探针 C） |
| C3d | 既有 `resolve-schema-at-path-int-range.test.ts` 保持绿（含 `['b','x']`/`['e',0,'x']` → `SCHEMA_PATH_NOT_FOUND`） | 绿 |

### 12.5 C4 — 验证门禁（AC4）

| # | 命令 | 期望 | HEAD |
| --- | --- | --- | --- |
| C4a | `pnpm typecheck` | exit 0（新 union 成员已在 #351 接线） | 绿（exit 0） |
| C4b | `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run --typecheck` | exit 0；基线 353 文件 / 3863 用例；`Type Errors no errors` | 绿（597.41s） |
| C4c | 焦点：`vitest run packages/vfsl-codegen/test/generate-int-range.test.ts packages/vfsl/test/resolve-schema-at-path-int-range.test.ts packages/vfsl/test/int-range-fixture-drift.test.ts --passWithNoTests=false` | exit 0；22 用例 | 绿（1.63s） |
| C4d | `pnpm generate --check`；`git diff --check` | 双 exit 0 | 绿 |
| C4e | 若加 `.test-d.ts`：`vitest run --typecheck.only --passWithNoTests=false` | exit 0（CI typecheck 作业同款） | 待新增项落地后适用 |

### 12.6 覆盖缺口与建议测试路径

| 缺口 | 现状 | 建议落点 |
| --- | --- | --- |
| (a) 与 pattern 叶的**比较型**同构（AC3 字面表述） | 既有 C6b 只测 int/range 侧，无 pattern 配对、无码集合断言 | 扩展 `packages/vfsl/test/resolve-schema-at-path-int-range.test.ts`（C3a/C3b） |
| (b) readData 端到端（`cloneValueSchema` 零测试覆盖） | 全仓 `packages/namespace-runtime/test/**` 无 `Int<`/`Range<` | 新增 `packages/namespace-runtime/test/runtime-readdata-int-range.test.ts`，沿 `readdata-schema-projection-fixture.ts` 装置（C3c） |
| (c) typed-access 编译级投影 | 既有 C6a 只编译生成物本身，未锚 `PathAt/PathValue/PathPatchValue` | 扩展 `generate-int-range.test.ts`（generated+consumer 同 program）或 `.test-d.ts` 镜像（C1c） |
| (d) codegen 过宽放行负控 | 无 | 扩展 `generate-int-range.test.ts`（手造 leaf+xml derived，断言 desync）（C1e） |

### 12.7 突变敏感性矩阵（杀死弱化/回退实现）

| 弱实现 / 回退 | 变红的契约项 |
| --- | --- |
| `projectValue` 把 int/range 改回 `string`/`unknown` | C1a（发射文本）、C1c（`PathValue` 不再为 number ⇒ TS2322 消失 / `@ts-expect-error` 反噬）、C2（若影响既有输出则 `generate --check`） |
| `emitter` 白名单删去 int/range | C1a/C1b（生成即抛 desync；既有 C6a 红） |
| `emitter` 白名单放成 catch-all（未知 kind 不再抛） | C1e（tampered leaf+xml 负控红） |
| `resolveSchemaAtPath` 为 int/range 新增拒绝分支/新失败码 | C3a/C3b（与 pattern 不同构、码集合越界）、C3d（既有 C6b 红） |
| `cloneValueSchema` 裸 Int 补 `min: undefined`/`max: undefined` 槽 | C3c（`Object.keys === ['kind']` 红；JSON 往返哨兵红） |
| readData 返回活 schema（不 detached） | C3c（变异污染重读、wrapper 同一性红） |
| codegen 改动波及既有生成物（格式/键序/指纹） | C2a/C2b/C2c（`generate --check` 红 + 字节钉值红） |
| `generate --check` 退化为恒 0 | C2d（陈旧 = 1 断言红；既有 CLI 测试红） |
| 为过测试 skip/软化/删既有用例 | §12.0 纪律 + C4 门禁 + SA4 复核 |

### 12.8 边界与不变量

- **失败码恰两枚**（`SCHEMA_PATH_NOT_FOUND` / `SCHEMA_PATH_INVALID`），int/range 不新增第三枚（ADR 0016 + ADR 0020 决策 8）。
- **品牌类型不做**（ADR 0020 决策 7）；TS 层 int/range = `number`，生成物形状不得因本票胀大。
- **条件键纪律**：裸 `Int` 的 `min`/`max` 是整键缺席（`Object.keys === ['kind']`；JSON 往返无 `undefined` 槽）。
- **消息文案不冻结**：不断言 `desync`/校验消息全文，只匹配稳定片段（`structure/value desync`）与码/路径。
- **`int`/`range` 保持非保留名**、`Int`/`Range` 保留名判定（#315 范围）回归面保持绿。

### 12.9 与 #315 契约的关系

#315 SA6 契约的 C6a（`generate-int-range.test.ts`）与 C6b（`resolve-schema-at-path-int-range.test.ts`）已随 #351 落地并保持绿；本契约不重复其条目，只做两件事：把 #316 的 AC 显式对齐到既有锚点（C1a/C1b/C3a/C3d/C4），并补齐 #315 未覆盖的 4 项（C1c/C1d/C1e/C3b/C3c）。**本票不预期任何生产实现改动**；若 Host 判定需要新增行为，本报告无证据支持任何具体缺口，需另行给出需求。

---

## 13. Red/green or baseline evidence

| 契约项 | HEAD 状态 | 支撑 |
| --- | --- | --- |
| C1a/C1b（发射 number + 编译） | **绿（既有 + 探针）** | `generate-int-range.test.ts` 10/10；探针 B |
| C1c（typed-access 编译级） | **绿（新增项，HEAD 即绿）** | 探针 B：consumer 0 诊断；负例恰 1×TS2322 |
| C1d（CLI 领域端到端） | **绿（新增项，HEAD 即绿）** | 探针 D：generate 0 / fresh check 0 / stale check 1 |
| C1e（过宽放行负控） | **绿（新增项，HEAD 即绿）** | 探针 B：`structure/value desync at ROOT.b (structure=leaf, value=xml)` |
| C2（字节稳定/新鲜度） | **绿** | `generate --check` 0；sha256 钉值；指纹哨兵；CLI 陈旧 = 1 |
| C3a/C3d（透传） | **绿** | 既有 C6b 7/7；探针 A 终点表 |
| C3b（比较型同构 + 码集合） | **绿（新增项，HEAD 即绿）** | 探针 A：7 配对全同码；码集合 ⊆ 两枚 |
| C3c（readData 端到端） | **绿（新增项，HEAD 即绿）** | 探针 C |
| C4（门禁） | **绿** | typecheck 0；全量 353/3863；焦点 22；spec 22/22 |

**为何没有红灯**：基线提交即 #315 集成 PR #351（§4 溯源），#316 的实现范围在其中已整体交付；任何「红灯」都只能靠伪红（改生产代码制造失败、或断言不存在的第三失败码）得到，本报告拒绝该做法。

---

## 14. Runner trigger evidence

| 入口 | 触发方式 | 实测 |
| --- | --- | --- |
| `packages/*/test/**/*.test.ts` | `pnpm test` = `vitest run --typecheck`（`vitest.config.ts` include；CI 6 分片 `scripts/ci-test-shard.mjs`） | 353 文件 / 3863 用例通过；既有 `generate-int-range.test.ts`、`resolve-schema-at-path-int-range.test.ts` 均在其列（焦点复跑 22/22） |
| `packages/*/test/**/*.test-d.ts` | `vitest run --typecheck.only`（CI typecheck 作业；`tsconfig.typecheck.json`） | 全量 `--typecheck` 运行中 `Type Errors no errors`；`.test-d.ts` 纳入同一 include |
| `pnpm generate --check` | 根 `package.json` 脚本 → `tsx packages/vfsl-codegen/src/cli.ts --check`（CI `codegen-freshness`） | exit 0；陈旧夹具 = 1 |
| `pnpm typecheck` | 14 个 tsc 工程（CI typecheck 作业） | exit 0 |
| `python3 tests/acceptance/vfsl_spec_acceptance.py` | 本地/评审机检 | GREEN 22/22，exit 0 |

新增测试文件无需改配置：`*.test.ts` 由磁盘枚举自动落入 CI 分片（`--passWithNoTests=false` 防空跑），`*.test-d.ts` 由 typecheck include 自动纳入。

---

## 15. Unknowns and blockers

| # | 项 | 影响 | 处置建议 |
| --- | --- | --- | --- |
| U1 | **票面语义与基线的错位**：#316 作为 #315 的后续票，其实现已随 #315 集成 PR #351 交付；基线 worktree 起点即在 #351 之后，故 SA6 无法（也不应）产出红灯 | 下游若按「红契约 → 实现」流程推进会空转 | Host 将 #316 关闭为「已交付」并附本报告，或转为「覆盖补票」（§12.6 四项）交由测试侧落地；两种处置都不需要生产改动 |
| U2 | 比较型同构与 readData 端到端的**具体断言形状**（如是否断言 `aliases`/`aliasDocs` 细节） | 仅影响新增测试规模 | 契约给最小判别集（§12.4）；实现者可加不可减 |
| U3 | 无 316 专属 SA8 产物 / relevant_decisions / conflict_report | 无 | 已以 ADR + 模块 AGENTS.md + CI 作为可执行约束（§3） |
| U4 | 全量测试 597s（maxWorkers=1）在门禁负载下可能更长 | 无功能影响 | 建议新增用例落焦点文件，避免放大全量时长；CI 分片自动均衡 |

无阻塞项：环境完整、探针可重复、契约可执行。

---

## 16. Temporary diagnostics cleanup

- 临时探针（均未进入任何生产路径、未改生产实现）：
  - `.sa6-tmp/probe-a-resolve-isomorphism.ts`（resolve 同构）
  - `.sa6-tmp/probe-b-codegen.ts`（codegen 发射/编译/typed-access/过宽放行负控）
  - `.sa6-tmp/probe-d-cli-e2e.ts`（CLI 领域端到端 + 新鲜度）
  - `.sa6-tmp/{a1,a2,b1,b2,c1,c2}.txt`（确定性两轮输出）
  - `packages/namespace-runtime/.sa6-tmp/probe-c-readdata.ts`（readData 端到端；置于包内以与 runtime 同源解析 yjs）
- 清理动作：`rm -rf .sa6-tmp packages/namespace-runtime/.sa6-tmp`；复核 `ls` 报 `No such file or directory`。
- 清理后 `git status --short` 仅 `?? wiki/raw/task_issue-316.md`（Host 简报）+ 本报告；`git diff --check` exit 0；生产实现零改动（无 tracked 改动）。
- 未启动任何常驻服务（探针内的 memory persistence/runtime 在探针结束时 `runtime.close()`，无 nohup/后台残留）；后台长命令（install/typecheck/全量测试）均已 `job_output` 收敛，无运行中作业。
