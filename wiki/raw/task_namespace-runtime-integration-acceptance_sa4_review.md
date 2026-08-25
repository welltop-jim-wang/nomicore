# SA4 静态验尸报告

> **SUPERSEDED（已取代）**：本报告验证 issue #93 round 1，实现中 testing seam 曾从 package entry 导出；该结论已废止。当前复审见 `task_namespace-runtime-integration-acceptance-rev1_sa4_review.md`。

**Date**: 2026-08-25
**Verdict**: pass

**被审对象**: commit `2cf4879` + `2d5cd8e`（fix/issue-93-on-docs-namespace-runtime，base = `73811cd`，与设计 §5 diff base 裁决一致——本分支 merge-base 实测 = 73811cd ✓）
**审核依据**: SA1 设计 R2 定稿（`task_namespace-runtime-integration-acceptance_design.md`，276 行）/ SA2 R2 pass（含 R2-O1/O2 两项 LOW 随 SA3 处理）/ SA8 设计后复审 clear + N1 已并入 R2 / SA6 验收记录（简报 §SA6）
**审核方法**: 设计 §5 静态核对协议逐条独立复跑 + 落盘文本与 §4.1/§4.2/§4.3 草案程序化逐字比对 + scope/blacklist/版本纪律核对 + 三验收测试质量审查（§1.7 禁令）+ 全仓 test/typecheck 独立进程复跑

---

## 一、§5 静态核对协议执行记录（逐条独立复跑，base=73811cd）

### 断言 1 词汇收口 —— 4/4 ✅

| 命令 | 期望 | 实测 |
|---|---|---|
| `grep -c 'RUNTIME_READ_DISABLED' docs/adr/0008-…` | ≥1 | **1** ✅ |
| `grep -c 'RUNTIME_READ_DISABLED' CONTEXT.md` | ≥1 | **1** ✅ |
| `grep -c 'RUNTIME_WRITE_DISABLED' docs/adr/0008-…` | ≥2 | **2** ✅ |
| `grep -c 'NSRT-CLOSE-RELEASE-FAILED' docs/adr/0008-…` | ≥1 | **1** ✅ |

### 断言 2 追加式修订 —— 3/3 ✅

- `git diff 73811cd -- docs/adr/0008-… \| grep -c '^-[^-]'` → **0**（正文零删除，纯追加 +14 行，2cf4879 stat 证实）✅
- `git diff 73811cd --name-only -- 'docs/adr/000[1-7]-*.md'` → **空**（ADR 0001–0007 零触碰）✅
- `git diff 73811cd --name-only -- docs/adr/` → **仅 0008 一个文件** ✅

### 断言 3 卫生 —— 2/2 ✅

- `git ls-files \| grep -cx '\.mabf-done'` → **0**（bfcb999 误提交的删除已随 2cf4879 固化）✅
- `git check-ignore -q .mabf-done && git check-ignore -q .mabf` → **OK**（防复发两行生效）✅

### 断言 4 全绿 —— 2/2 ✅（独立进程复跑）

- `pnpm test` → **exit 0；90 files / 1101 tests 全绿；Type Errors: no errors**——与 SA6 记录、设计 §5 期望逐字相符（文件数 87+3=90、用例数 1093+8=1101 算术自洽）
- `pnpm typecheck` → **exit 0**（七包 tsc 全绿）

### 断言 5 变更面 —— ✅（明细见第三节 scope）

`git diff 73811cd --name-only | sort` 共 14 文件：3 文档 + 1 删除 + 3 测试 + 7 wiki 档案（后者白名单豁免），无任何越界文件。

### 断言 6 注册清单穷尽性 + R2-O1/O2 —— 4/4 ✅

- **穷尽性差集**：`grep -rhoE "'[A-Z][A-Z0-9_-]{6,}'" packages/namespace-runtime/src/*.ts | tr -d "'" | sort -u` → **恰 13 码**；与期望并集（修订节第 1/2/3 条 3 码 ∪ 第 5 条 errors.ts 9 码 ∪ p0.ts 1 码）双向 `comm` 差集**均为空**——SA2 R2 #1 红灯守卫在本轮落盘后依然闭合 ✅
- **`grep -c 'released/disposed'` ADR8** → **1**（≥1 ✅）。**R2-O1 复核**：落盘文本同时保留三态枚举主处（带空格「persistence-degraded / released / disposed 三态同拒」）与附注句紧凑形（「released/disposed 同属租约失效下的非 ready 拒绝」）——设计 §5 断言（紧凑形）当前命中附注句，通过；若按 SA2 建议放宽为 `'released ?/ ?disposed'` 则计 2，同样 ≥1。两形态并存使断言在两种模式选择下均成立。R2-O1 的遗留健壮性观察（「未来若删附注句仅留枚举主处，紧凑形断言将意外红」）是**设计协议侧属性**，非本轮落盘缺陷——不阻塞（见观察 2）✅
- **`grep -c 'getStatus'` CONTEXT.md** → **1**（≥1 ✅，基线 0，断言有判别力；命中停接纳词条 getter 边界句）✅
- **R2-O2 并入真实性**：落盘修订节第 5 条「经 status 的 schema 摘要键可观测，**亦经 replaceSchema 编译失败 issues 可观测**」——实现链核验属实：`schema-write.ts:145`（S4 编译失败 `r.issues.map(toReplacementIssue)`）→ `:243–244`（`toReplacementIssue` 调 `toIssueSummary`）→ `p0.ts:145`（`code: 'SCHEMA_TEXT_INVALID'`）→ `schema-write.ts:245`（`` `${summary.code}: ${summary.message}` `` 嵌入 issue message 公共面）。且落盘措辞是「经 … issues 可观测」，**未**声称存在不存在的 `issues[].code` 字段（实际类型 `SchemaReplacementIssue = { message; path }`，码嵌 message 前缀）——并入表述准确，无虚假陈述进入已接受 ADR ✅

## 二、落盘文本与设计草案一致性（§4.1/§4.2/§4.3）

程序化逐字比对（非目测）：

| 草案 | 比对结果 |
|---|---|
| §4.1 ADR 0008 修订节（13 行） | **唯一差异 = 第 5 条补入「，亦经 replaceSchema 编译失败 issues 可观测」**——恰为 dispatch #8 明文授权的 R2-O2 并入（SA2 R2：「建议 SA3 落盘时在该句补…或等效表述」），其余 12 行逐字相同。修订节位置正确：「## 取代关系」（L109）内容之后（L113），标题带日期+议题号，与 ADR 0006 #64/#79 先例同款 ✅ |
| §4.2 CONTEXT.md 停接纳词条（3 行） | **逐字相同（VERBATIM IDENTICAL）**；插入位置正确：`active schema`（L72）之后、`重建校验`（L79）之前，归入 Runtime 术语簇；词条格式（`**词条**:` + 正文 + `_Avoid_:`）与全文件既有词条一致 ✅ |
| §4.3 .gitignore | **精确 +2 行**（`.mabf-done`、`.mabf/`），追加于 MABF 段（`TASK.md`/`.mabf-bg/` 之后），段注释与既有行零改动 ✅ |

「SA3 原样落盘」承诺成立：唯一偏离即授权偏离（R2-O2），无任何未授权改写。

## 三、Scope 审查（§7 ALLOW/DENY LIST + blacklist）

- **ALLOW LIST 存在性**：设计 §7 有完整 ALLOW/DENY 结构 ✅（硬门禁满足）
- **actual（14 文件）⊆ ALLOW（8 项）∪ wiki 白名单**：`.gitignore`✓ / `.mabf-done`（删除）✓ / `CONTEXT.md`✓ / `docs/adr/0008-…`✓ / 3 个 `[SA6 owned]` 验收测试✓ / 7 个 `wiki/raw/task_namespace-runtime-integration-acceptance*.md`（白名单豁免）✓ —— **无 creep**
- **DENY LIST 零触碰**：`packages/namespace-runtime/src/` 改动文件数 = **0**（生产代码冻结，D4/§9「零契约改动」声明实测为真）；其余六包 src / `apps/**` / ADR 0001–0007 / `packages/namespace-runtime/package.json` / `packages/vfsl-codegen/README.md`（未新建 namespace-runtime README）全部零触碰；`.mabf/` 未入库（gitignore 生效）；TASK.md/REPORT.md 不在 diff
- **blacklist 终验**：`package-lock.json` / `yarn.lock` / `.DS_Store` / `TASK.md` / `*.bak` —— **零命中**
- **commit 划分**：2cf4879 = 交付物本体（3 文档 + 2 卫生 + 3 测试 + wiki 档案入库）；2d5cd8e = 仅 dispatch log 1 行更新——无夹带

## 四、测试质量审查（技能 §1.7 + 触发性）

- **源码 grep 断言禁令**：三文件均**无** `readFileSync`/`readFile`；4 处 `toContain` 全部作用于 `JSON.stringify(运行时结果联合对象)`（fullchain:177/299、degraded:193——断言 `RUNTIME_WRITE_DISABLED` 在结算结果中可观测），属运行时行为断言而非源码文本形状断言 ✅。exports-audit 头注自证「不读源码文本」且实测相符 ✅
- **exports-audit 探测方式与简报声明一致**：`Object.keys(publicEntry).sort()` **toEqual 穷尽断言**（恰 `['RuntimeWriteFatalError','createNamespaceRuntimeWithSeam']`）+ forbidden 十项运行时 `toBeUndefined` 探测——静态侧独立复核 `src/index.ts` 值导出确为恰两键（L17–18），测试断言与实现互证 ✅
- **用例计数与 SA6 记录一致**：fullchain 3 / degraded 2 / exports 3 = 8，`it(` 计数逐一相符；本轮全仓复跑 8/8 含于 1101 全绿——SA2 E6 落盘前 8/8 与落盘后内容一致（计数+断言形状+导出键集三点对齐），无断言篡改迹象 ✅
- **CI 触发性（技能 §1.4）**：`.github/workflows/ci.yml` test job 于 **pull_request 触发、matrix node [20,24]**，步骤 `pnpm test`（root = `vitest run --typecheck`，收集全 workspace 含 `packages/namespace-runtime/test/`）+ `pnpm typecheck`（含 namespace-runtime tsc）——三个新测试文件全部落在 runner 触发范围内，无孤儿 spec ✅（§1.3 E2E spec 门禁：本轮无 `*.spec.ts`，N/A）

### 1.4 vitest 触发性自检（Hard Gate #14）

**判定标记：`all-vitest-packages-triggered`** —— 本任务新增的 3 个 `*.test.ts` 所在 workspace package **`@nomicore/namespace-runtime`** 的 vitest 面**同时被本地 `pnpm test` 与 CI workflow 触发**，不存在「测试存在但从未被 CI 运行」的黑洞。

证据（命令 + 结果，2026-08-25 实测）：

| 层 | 命令 / 位置 | 结果 |
|---|---|---|
| ① package 定位 | `grep -m1 '"name"' packages/namespace-runtime/package.json` | `@nomicore/namespace-runtime`（三个新文件均在该包 `test/` 目录） |
| ② 收集面 | `vitest.config.ts` L5：`include: ['packages/*/test/**/*.test.ts', 'domains/*/test/**/*.test.ts']` | `packages/namespace-runtime/test/runtime-acceptance-*.test.ts` 命中 `packages/*/test/**/*.test.ts` glob；配置无 `--filter`/`--project`/exclude 将该包排除 |
| ③ 本地触发实测 | root `pnpm test`（= `vitest run --typecheck`，根 `package.json` L11）独立进程复跑日志（§5 断言 4 同一次运行） | 三文件均被收集且绿：`✓ packages/namespace-runtime/test/runtime-acceptance-fullchain.test.ts (3 tests)` / `✓ …runtime-acceptance-degraded-two-adapter.test.ts (2 tests)` / `✓ …runtime-acceptance-exports-audit.test.ts (3 tests)`——8/8，整体 exit 0（90 files / 1101 tests，Type Errors: no errors） |
| ④ CI 触发链 | `.github/workflows/ci.yml`：`on: pull_request`（L6）→ test job matrix `node: [20, 24]`（L18）→ 步骤 `run: pnpm test`（L39）+ `run: pnpm typecheck`（L36，含 `tsc -p packages/namespace-runtime/tsconfig.json`） | 每个 PR 在 **Node 20 与 Node 24 两格**运行与本地完全相同的 root 命令（同一收集面 ②）——无旁路、无 `continue-on-error`、无 `passWithNoTests` 掩蔽（该旗标仅用于三个显式单文件步骤，均与本包无关） |

结论：新增测试的双触发链（本地 + CI matrix）闭环实证，判定 **`all-vitest-packages-triggered`** 成立；本自检未发现任何未触发问题，**不改变已给出的 verdict: pass**。SA7 动态侧仅需按「动态审核重点」第 1 条在 CI 观察期摘录 Node 20/24 两格的测试运行日志作为终证。

## 五、版本号纪律核验（任务简报指定核验项）

**「不 bump」判定成立** ✅：

- `git diff 73811cd HEAD --name-only -- '**/package.json'` → **0 文件**（全仓零 package.json 触碰）
- `packages/namespace-runtime` version 基线与 HEAD 均 `0.1.5`（未变）
- 判定理由与变更性质相符：本轮交付 = 纯文档（ADR 修订节 + CONTEXT 词条）+ 测试锚点 + 仓库卫生，**公共 API/错误词汇/行为零变化**（src 冻结、值导出面不变）——符合设计 §7 DENY LIST 明文「无公共面/行为变化（纯文档+测试+卫生），不 bump 版本」，亦符合语义化版本最小纪律（文档与测试变更不动版本号）

## 六、非阻塞观察（3 项 LOW，均无需回流；记录供后续任务知悉）

1. **[LOW-计数精度]** 设计 D4（L111）「类型导出清单（index.ts 只读核对，**11 项**）」——实际列举并实测均为 **12 项**类型导出（枚举本身完整且与 `src/index.ts` L19–29 逐项相符，仅计数 off-by-one）。该计数未进入任何落盘产物（ADR/CONTEXT/测试），纯 wiki 设计文档内部笔误——不影响验收；后续若修订设计档案可顺手更正，无需专门回流。
2. **[LOW-协议健壮性，R2-O1 残留]** 设计 §5 断言 6 第二式仍为紧凑形 `grep -c 'released/disposed'`（SA2 建议的「放宽 grep 模式或统一字面形态」未采纳任一）；本轮落盘文本含紧凑形附注句故断言通过，但「未来编辑删附注句仅留带空格枚举主处 → 断言意外红」的脆弱性仍在**协议侧**留存。属 SA2 已定级 LOW 的可选建议，非本轮义务——留待后续触达 ADR 0008 的任务按需收紧。
3. **[LOW-断言风格]** fullchain/degraded 两文件以 `JSON.stringify(结果).toContain('RUNTIME_WRITE_DISABLED')` 断言码可观测——比字段级断言（如 `result.issue.code === …`）略宽，但属运行时行为断言且与仓内既有先例（`runtime-write-fatal-message-rev1` 的 message containment）同款，可接受；仅作风格注记。

## 审核结论（技能模板八项）

1. **设计一致性**：✅ 一致——§4.1/§4.2/§4.3 逐字落盘（唯一偏离 = dispatch 授权的 R2-O2 并入，且并入声明经实现源码核验属实）；SA8 N1 的 issue 号引用修正已随 R2 落盘（修订节序言无 wiki 路径、无行号）
2. **读写路径一致性**：N/A——零生产代码改动，无数据路径；文档写入面（ADR/CONTEXT）与读取面（后续 SA8 门禁/全链 SA 对照）单一真相源结构未破坏（语义单源 ADR 0008，CONTEXT 仅概念词条）
3. **静默失败**：✅ 无——§5 六组断言任一失败即显式红（本轮全部独立复跑有判别力：断言 1/6 在基线计数 0/0、落盘后 1/1/2/1/13/1，证明非空转）
4. **降级方案**：N/A——纯文档收口，无降级设计面
5. **极端攻击**：✅ 安全——穷尽性差集双向为空（13/13）；SCHEMA_ENVELOPE_\<code\> 模板字面量确认不在单引号提取面（防未来穷尽断言误报）；R2-O2 措辞与实际 issue 形状（无 code 字段）精确相容
6. **错误处理**：✅ 完整——`.mabf-done` 删除有 `git ls-files`=0 硬门禁兜底且已固化；无静默路径
7. **架构评估**：✅ 可行——追加式修订节沿仓内 ADR 0006 先例，裁决链（#90/#92 让渡 + AC7 义务 + SA8 专裁一）闭合，无架构制约信号
8. **过度设计**：✅ 精简——交付物 = ADR +14 行 / CONTEXT +4 行 / .gitignore +2 行 / 1 个文件删除 / 3 个已验收测试入库，零多余抽象、零生产面触碰，与「阶段收口」任务半径严格一致

## 动态审核重点（交 SA7）

本轮交付为纯静态面（文档+卫生+测试入库），SA4 已独立复跑全部可执行断言。SA7/CI 观察期仅需确认以下运行时面：

1. **CI matrix 复现**：`.github/workflows/ci.yml` push 后 PR 上 **Node 20 与 Node 24** 两格均绿（typecheck + test + persistence-contract + domains-scaffold + materialize-root + regen-diff）——本地仅 Node 24 复跑（90/1101 + 七包 tsc exit 0），Node 20 格为 CI 观察期待证项
2. **FilePersistence 真实磁盘用例的 CI 环境稳定性**：`runtime-acceptance-degraded-two-adapter.test.ts` 的 ENOTDIR 占位注入与 `runtime-acceptance-fullchain.test.ts` 的 mkdtemp/crash-restart 链在 ubuntu-latest runner 磁盘上的可重复性（本地绿 ≠ runner 文件系统语义全同）
3. **exports-audit 跨 Node 版本稳定性**：`Object.keys(module namespace)` 键序在 Node 20/24 下排序行为一致（断言已 `.sort()`，理论稳定——CI 绿即终证）

## 最终判定

**Verdict: pass** —— §5 协议六组断言独立复跑全过、落盘文本与 R2 定稿逐字一致（R2-O2 授权并入且并入事实经源码核验属实）、scope 零越界零黑名单、生产代码冻结与「不 bump」判定均成立、三验收测试质量合规且 CI 触发闭环。3 项 LOW 观察均不回流、不阻塞。可进入 Host CI 观察期。
