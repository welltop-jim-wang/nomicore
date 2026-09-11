# SA7 动态验证报告 — issue #307（vfsl-codegen 联合成员 doc 四发射位）

- 派发：`sa-130cbbe5-9e0c-40a0-b9d4-13ee586961ab`（role `mabf-sa7`，phase `final-verification`，iteration 0）
- Worktree：`/home/wangjian/nomicore-fix-issue-307`（branch `mabf/issue-307`，HEAD `4d4208b`，SA3 改动为未提交工作树状态）
- 产出日期：2026-09-11
- 验证对象：SA3 实现（3 个 src 文件 +120/−14）对 SA6 批准契约与 SA4 静态审查结论的**运行时**兑现
- 上游 Verdict：SA4 `approve`（本报告只可维持或独立发现 fail）

## Verdict

**`approve`**

干净环境（全量 `node_modules` 删除后 `pnpm install --frozen-lockfile` 重装）五门全绿；SA6 §12.4 验收判据全部满足：契约 33 例红转绿（包测试 9 文件 **95/95**）、包与根 typecheck exit 0、`pnpm generate --check` exit 0、根 `pnpm test` **316 文件 / 3350 用例**全绿。A/B 动态探针（当前实现 vs `git archive HEAD` 抽取的 HEAD 实现，138 项断言 0 失败）证明：四发射位 doc 字节按设计到达生成物、无 doc/无发射位路线与 HEAD 逐字节相同、坍缩位成员段与单行形态同源、W1 判据按位点独立、键序无关、O1/O2 手造输入行为与 HEAD 一致、CLI 双格式闭环且跨格式 fail-closed 保持。临时诊断已全部删除并复跑确认。

---

## 1. Inputs

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-307.md`（任务简报，Issue 正文 + AC1–AC4，`## Comments` 空） | 实读（REST 快照无评论，与简报一致） |
| `wiki/raw/task_issue-307_sa6_contract.md`（approved 契约：33 例测试 + W1/W2 钉死值 + §12.4 五门） | 实读（验收真相基准） |
| `wiki/raw/task_issue-307_design.md`（SA1 设计 D1–D8、§8 数据流路线表、§12 验证门） | 实读（变更/保持路线清单来源） |
| `wiki/raw/task_issue-307_sa3_impl.md`（SA3 实现报告） | 实读（被验证对象自述） |
| `wiki/raw/task_issue-307_sa4_review.md`（SA4 `approve` + §11 后续动态验证项） | 实读（本报告逐项承接） |
| `wiki/raw/task_issue-307_conflict_report.md`（SA8 `clear`，W1/W2/B1–B3） | 实读（协议边界识别） |
| `packages/vfsl-codegen/src/{emitter,docs,valuetype}.ts` 全文 + `git diff` 逐 hunk、`packages/vfsl-codegen/test/generate-union-member-docs.test.ts`（638 行） | 实读复核（不改） |
| `docs/adr/0019-vfsl-union-member-docs.md` 决策 6 | 实读（规范基准） |
| `wiki/raw/task_issue-307_relevant_decisions.md`、`…_design_conflict_report.md`、前序 `…_sa7_report.md` | 不存在（iteration 0） |

被验证工作树状态（验证前后各核对一次）：`git status --porcelain -uall` 恰为 3 个 modified src 文件 + 未跟踪契约测试与 7 个 wiki 产物；HEAD 仍 `4d4208b`、stash 空、无 staged。契约测试 sha256 `b9c87b9ea0360f04362214a2eaeb769f5d03ec17ac11e158742edf1676189e64` 与 SA4 §2 记录逐字符一致，mtime 14:09:56 早于 src 改动（14:34–14:35）——**SA6 契约未被实现侧改写，验收真相有效**。

## 2. Runtime environment

| 项 | 值 |
|---|---|
| 运行目录 | `/home/wangjian/nomicore-fix-issue-307`（任务 worktree，全部命令显式使用该目录） |
| Node / pnpm | v24.13.0 / 10.28.2（与 SA6 基线同版本） |
| 干净化 | 验证前删除全部 `node_modules`（根 + 14 个包目录）→ `pnpm install --frozen-lockfile` → **exit 0**（resolved 65 / reused 65 / downloaded 0；`packages/vfsl-codegen/node_modules/@nomicore/vfsl` 软链在场） |
| 构建产物 | 零（vitest + tsx 现场转译，`NODE_OPTIONS=--conditions=nomicore-source`） |
| 起始基线 | 无本任务残留进程/端口；唯一监听 8899 端口的 pid 540320 属 MABF Runner Host（`mabf-runner-jim-dev`），**非本任务进程，未触碰**；收尾复查本任务零残留进程/端口 |
| 未运行面 | 不等待 PR CI、不读远端 CI 日志（SA7 边界）；CI Node 20/24 矩阵一致性由 CI 门承担（SA4 §11 第 2 项登记为 CI 侧，本机仅 v24 可用） |

## 3. Changed Data Flow Verification

驱动 = 临时 A/B 探针（公共入口 `parseVfsl` → `evaluate` → `generateProjection`，当前实现 vs `git archive HEAD` 抽取实现；fixture 与 SA6 契约同源）+ 契约测试 + CLI 子进程。设计 §8 路线表逐条对照：

| Route | Design change | Runtime driver | Observed hops | Expected result | Actual result | Verdict |
|---|---|---|---|---|---|---|
| 1 schema→derived：M4 成员 doc 经 parse → IR → derived `memberDocs` 条件稀疏表 | 输入链零改动（#306 已并），生成器只消费 | 探针 G1（15 个含 doc fixture） | hop1：派生键清单实测在场——`Entity.<member 0/1>`、`Status.<member 0..2>`、`Maybe.<member 0/1>`、`ROOT.u.<member 0/1>`、`ROOT.s.<member 0/1>`、`ROOT.v.<member 0/1>`、`ROOT.e.<member 0/1>`、`ROOT.tags.<item>.<member 0/1>`、多 doc/多行体键 | 与 SA6 §5 键空间表一致 | 全部一致（15/15 fixture 键在场） | PASS |
| 2 derived→生成物·发射位 1（别名判别联合块位） | doc 块位于对应 `  \| ` 成员行上方，成员文本不变 | 探针 G1/G3 `aliasUnionDoc`、`aliasRefUnionDoc` + 契约 C1 组 3 例 + CLI | hop2：当前输出含 `/**  图片变体  */` 等块位字节；hop3：HEAD 对同 derived **零发射**；hop4：按派生值机械剥除 doc 字节后与 HEAD 输出**逐字节相同**（插入型无布局漂移） | 输入在场→输出按设计新增、其余字节零漂移 | 三跳全部命中（map 成员与 ref 成员两形态） | PASS |
| 3 derived→生成物·发射位 2（坍缩别名多行切换，W1） | 有成员 doc 条目 → `export type X =` 换行 + `  \| ` 逐成员；判据 = `<member N>` 键非空条目在场，不按值侧 kind | 探针 G4（6 组重排型）+ 契约 C3/C4 组 4 例 + 判据独立 1 例 | hop1：`Status.<member 1>` 单条目（部分 doc）；hop2：全成员多行、仅 doc 成员行上方有 doc 行；hop3：成员段按 `' \| '` 重拼 === HEAD 单行 RHS（`'draft' \| 'submitted' \| 'archived'`、`string \| null` 等 6/6）；hop4：同模块 `Status`（无 doc）单行与 HEAD 相同行并存 | 部分 doc → 全成员多行；成员文本 = 单行形态逐段；位点独立 | 全部命中 | PASS |
| 4 derived→生成物·发射位 3/4（内联行内前置） | 前缀 `/** d */ ` 紧跟成员起点，`\|` join 文法不变 | 探针 G1/G3（内联 ref/枚举/标量联合/map 判别/数组元素位/部分 doc）+ 契约 C5/C6 组 7 例 | hop2：`ROOT.tags.<item>.<member N>` 深层键命中（数组元素位一处接线全覆盖路径面）；hop3：HEAD 零发射；hop4：剥除前缀后与 HEAD 逐字节相同（9/9 Family A） | 行内前置只动 doc 字节 | 全部命中 | PASS |
| 5 W2 多 doc / 多行 doc 体渲染 | 块位逐块逐行叠加、行内位单空格串联、多行体逐字 | 探针 G1（multiDocBlock/multiDocInline/multilineDocBody）+ 契约 W2 组 4 例 | hop2：`/**  第一条  */\n  /**  第二条  */` 叠加与 `/**  第一条  */ /**  第二条  */ ` 串联在场；多行体默认模式 `/** ` 行尾空格保留；两次发射逐字节一致 | 确定性渲染、零新规范化 | 命中（双发一致 15/15 fixture） | PASS |
| 6 semicolonFree 同布局 | doc 行/前缀位置不变、全文零分号、无行尾空格 | 契约 C8 组 + CLI sf 闭环（本报告 §6 命令 8–10） | sf 生成物含同位 doc 字节、`grep -q ';'` 零命中、`grep -Eq ' +$'` 零命中、`--check --semicolon-free` exit 0 | 两模式各自闭环 | 命中 | PASS |
| 7 生成物→写盘→新鲜度（CLI 编排） | CLI/collect 零改动，derived 透传自然到达 | CLI 子进程（临时 domain，含四发射位 fixture） | hop1：`pnpm generate` exit 0 且写盘含 `  /**  草稿  */\n  \| 'draft'`、`  /**  图片变体  */\n  \| { …`、`PathSchema</**  内联草稿  */ 'a' \| …`；hop2：同格式 `--check` exit 0；hop3：再 generate 一次 sha256 不变（幂等） | 写盘→检查→再生成同字节闭环 | 命中 | PASS |

旧路径证伪：HEAD 实现对全部含 doc derived 的输出**零 doc 字节**（G1 hop3 逐条断言）——变更真实发生且只发生在四发射位。

## 4. Preserved Data Flow Verification

| Route | Preserved invariant | Runtime driver | Baseline observation | Current observation | Verdict |
|---|---|---|---|---|---|
| 无 doc 联合/坍缩/内联 fixture | 生成物逐字节不变 | 探针 G2（A/B 对照 HEAD） | HEAD 输出（金样本） | 当前实现输出与 HEAD **逐字节相同**（noDocAliasUnion / noDocCollapsed / noDocInline 3/3） | PASS |
| YPlainArray 纯值子树 | 表在场但零发射（决策 6 末段） | 探针 G2 `plainSubtreeDoc` | HEAD：`p: PathSchema<'a' \| 'b'[], 'plain'>;` 零 doc | 当前与 HEAD 逐字节相同；派生键 `ROOT.p.<item>.<member 0/1>` 在场而 doc 文本零出现 | PASS |
| YXmlFragment 实参 | 不透明终态零发射 | 探针 G2 `xmlFragmentDoc` | HEAD：`x: PathSchema<string, 'xml-fragment'>;` | 当前逐字节相同；键 `ROOT.x.u.<member 0/1>` 在场、doc 零出现 | PASS |
| M3 优先位（标记联合） | `memberDocs` 整键缺席 → 单行不切换、标记 doc 不泄漏 | 探针 G2 `markerOnly` | HEAD：`export type X = string \| number;` | 当前逐字节相同；`derived.memberDocs === undefined` 实测 | PASS |
| 存量 domain `vfs3-assets` | 生成物与仓内 `generated.ts` 逐字节相等、`--check` 不报过期 | 探针 G2 三方对照 + 仓根 CLI | 仓内 `generated.ts` | 当前实现 === HEAD 实现 === 仓内文件（三方逐字节）；`derived.memberDocs === undefined`；仓根 `pnpm generate --check` exit 0 | PASS |
| 既有 8 测试文件 62 例金样本 | alias/field/marker doc 字节与单行布局不变 | 门 1（包测试） | SA6 基线 62/62 绿 | 95 = 62 既有 + 33 契约全绿（保形重构 D6/D7 无漂移） | PASS |
| 双格式互斥 fail-closed | 生成与 `--check` 必须同取值，混用必报过期 | CLI 交叉检查 | 既有 `generate-semicolon-free.test.ts` 断言 | 默认产物用 `--check --semicolon-free` → exit 1；sf 产物用默认 `--check` → exit 1（双向） | PASS |
| 错误分类与消息 | 既有 desync/命名化异常触发条件与顺序零变化 | 探针 G6（O2 手造异形配对） | HEAD：`structure/value desync at Status (structure=union, value=enum)` | 当前实现同输入抛**逐字相同**异常（闸门对非 leaf 结构形恒闭合）；CLI 无效参数 exit 非零用例在 95 内绿 | PASS |

## 5. State Machine Verification

实现为纯函数（无状态、无缓存、无 IO），无运行时状态机；对可观察的时序/重复触发等价面验证：

| Initial state | Trigger | Expected transitions | Observed transitions | Forbidden transitions absent | Verdict |
|---|---|---|---|---|---|
| 同一 derived 输入 | 连续两次 `generateProjection` | 输出逐字节一致（确定性） | 15/15 含 doc fixture 双发一致；契约 W2 双发断言绿 | 无 nondeterminism | PASS |
| 同一 derived、`memberDocs` 键插入序反转 | 一次发射 | 输出与原键序逐字节相同（查键 only、无表枚举） | `aliasEnumDoc` 键序反转 → 输出逐字节相同 | 无键序依赖/表遍历副作用 | PASS |
| 新 domain 目录 | `generate` → `--check` → 再 `generate` | 写盘 → fresh（exit 0）→ 再生成同 sha256（幂等，无状态累积） | 实测三者成立 | 无「再生成后漂移」 | PASS |
| 手造 derived（空数组条目 / 异形配对） | 发射 | 空条目 ≡ 表缺席 ≡ HEAD；异形配对走既有 desync | 三方逐字节相同 / 异常逐字相同（G5/G6） | 无孤立空格字节、无静默多行化、无新异常类 | PASS |

## 6. Error and Cleanup Flow

- **O1（SA2 精化）**：手造 `memberDocs = { 'Status.<member 0>': [], … }` → 当前输出与「表缺席」输出、与 HEAD 对同手造输入输出**三方逐字节相同**；无孤立单空格字节。空条目不开 W1 闸门、不产行内前缀。
- **O2（SA2 精化）**：手造「结构 union × 值 enum + `Status.<member 0>` 键」→ 当前与 HEAD 均抛 `structure/value desync at Status (structure=union, value=enum)`（逐字相同），未发生多行发射——畸形坍缩配对保留既有响亮失败，闸门条件 `node.kind === 'leaf'` 动态证实。
- **`projectUnionMembers` 内部误用守卫**：两个调用点均被 enum/union 分支条件约束，合法与本次手造输入均不可达（未触发）；SA4 静态证实 + 本报告 O2 路径旁证，无新增静默降级面。
- **CLI 失败面**：无效参数（`--domain`/`--out` 误用、missing domain）exit 非零用例在门 1 内绿；跨格式 `--check` 双向 exit 1（fail-closed 不复活旧格式路径）。
- **清理时序**：探针/临时 fixture 删除后复跑关键场景结果不变（见 §7）；无进程/端口残留（§2）。

## 7. Temporary Diagnostics

| 项 | 内容 |
|---|---|
| 添加 | `packages/vfsl-codegen/.sa7-tmp/`（`probe307.mts` A/B 探针 138 项断言 + `git archive HEAD packages/vfsl-codegen/src` 抽取的 HEAD 实现与其 `package.json`——header.ts 版本自同步所需）；`/tmp/sa7-307-cli-*`（CLI 闭环临时 domain）。均只读调用公共入口，**未修改任何生产/测试文件**，未改变控制流、未吞错、无 fallback、无 secret/payload 打印（日志仅 route/键清单/字节比对结果，`[SA7-DATAFLOW]` 前缀） |
| 删除 | 上述全部（`rm -rf packages/vfsl-codegen/.sa7-tmp /tmp/sa7-307-cli-* …`）；`ls packages/vfsl-codegen/` 复核仅剩 AGENTS/package/README/src/test/tsconfig/node_modules |
| Post-removal 验证 | 重跑 `vitest run packages/vfsl-codegen` → **95/95 绿、Type Errors: no errors、exit 0**（与删除前一致）；`pnpm generate --check` → exit 0；`git diff` 中 `[SA7-DATAFLOW]` 零命中；worktree grep 仅命中 HEAD 既有 tracked 文件 `wiki/raw/task_issue-306_sa7_report.md`（前任务历史产物，非本次添加） |
| artifactPaths | 临时诊断不进入（仅本报告） |

## 8. Dynamic Evidence Matrix

| Source | Requirement or risk | Driver | Expected | Actual | Evidence | Result | Suggested routing |
|---|---|---|---|---|---|---|---|
| SA6 §12.4 | 包测试 95/95（含契约 33 例红转绿） | 门 1（clean env） | 全绿 | 9 文件 95 passed、no type errors、exit 0 | §9 命令 1 输出 | PASS | — |
| SA6 §12.4 | 包 typecheck exit 0 | 门 2 | exit 0 | exit 0 | §9 命令 2 | PASS | — |
| SA6 §12.4 / AC3 | 生成物新鲜（`generate --check` exit 0） | 门 3（删除诊断后复跑一次） | exit 0 | exit 0（两次） | §9 命令 3/11 | PASS | — |
| SA6 §12.4 / AC4 | 根 `pnpm typecheck` exit 0 | 门 4 | exit 0 | exit 0（14 tsconfig 串行） | §9 命令 4 | PASS | — |
| SA6 §12.4 / 包 AGENTS | 根 `pnpm test`（SA7 收官门） | 门 5 | 全绿 | 316 文件 / 3350 passed、no type errors、exit 0（592s） | §9 命令 5 | PASS | — |
| SA6 §5/§12.1 C1–C8 | 四发射位文案 + W1/W2 布局 | 门 1 契约例 + 探针 G1–G4 | 逐例绿 / 跳点命中 | 33/33 绿；138 断言含 hop1 键在场、hop2 发射、hop3 HEAD 零发射、剥离/重拼等价 | §9 命令 1/6 | PASS | — |
| SA6 §6 负控 / AC3 | 无 doc 逐字节不变 + 无发射位零字节 + 存量域 | 探针 G2（A/B HEAD） | 逐字节相同 | 6 fixture + vfs3-assets 三方逐字节相同；仓根 check exit 0 | §9 命令 6 | PASS | — |
| SA6 §12.2 W1 | 判据按位点独立 / 部分 doc 全多行 / 整键缺席永不切换 | 探针 G4/G5 + 契约判据独立例 | 独立切换 | `mixedPresence` 无 doc 别名单行 + 有 doc 别名多行并存；`markerOnly` 整键缺席单行 | §9 命令 6 | PASS | — |
| SA6 §12.3 W2 / 设计 §9 | 确定性（双发一致、键序无关） | 探针 G1/G5 | 逐字节一致 | 15/15 双发一致；键序反转输出不变 | §9 命令 6 | PASS | — |
| SA6 C11 | CLI 双格式写盘 + 新鲜闭环 | CLI 子进程（独立于契约复跑） | 写盘含 doc、check 0、幂等、跨格式 fail-closed | 全部命中（含双向 exit 1） | §9 命令 7–10 | PASS | — |
| SA4 §11-1 | SA3 声称绿运行需干净环境复现 | 本报告全部五门（clean env 重装后） | 复现 | 与 SA3 报告数字逐项一致（95/95、3350/3350、双 typecheck、check 0） | §9 | PASS | — |
| SA4 §11-3 | O1/O2 探针结论（手造 derived）复核 | 探针 G5/G6 | 与 HEAD 逐字节/逐字相同 | 三方逐字节相同 / 异常逐字相同 | §9 命令 6 | PASS | — |
| SA4 §11-2 | Node 20/24 矩阵一致性 | CI test 分片（CI 侧） | 双版本绿 | 本机仅 v24.13.0；CI 观察不在 SA7 职责内（不等待 PR CI） | — | 不适用 | CI 门（Runner Host 观察） |
| SA4 N1/N2/N3 | 非阻断观察（契约文件权限 600 / 发射位 1 部分 doc 用例缺 / R3 行内多行体） | 本报告未发现新事实 | 维持登记 | 与 SA4 一致（权限位仍 600，git 仅跟踪可执行位） | `ls -l` | 维持 | 无（SA6 后续修订面） |

## 9. Commands and Evidence

全部在 `/home/wangjian/nomicore-fix-issue-307` 执行；退出码以 `[exit N]`/显式 echo 记录：

| # | Command | Result |
|---|---|---|
| 0 | `rm -rf node_modules packages/*/node_modules apps/*/node_modules domains/*/node_modules` → `pnpm install --frozen-lockfile` | exit 0（resolved 65 / reused 65 / downloaded 0；453ms） |
| 1 | `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/vfsl-codegen` | Test Files 9 passed (9)、Tests 95 passed (95)、Type Errors no errors、exit 0 |
| 2 | `pnpm --filter @nomicore/vfsl-codegen typecheck` | exit 0 |
| 3 | `pnpm generate --check` | exit 0 |
| 4 | `pnpm typecheck` | exit 0（14 tsconfig 串行） |
| 5 | `pnpm test`（根，`vitest run --typecheck`） | Test Files 316 passed (316)、Tests 3350 passed (3350)、Type Errors no errors、exit 0、592.23s |
| 6 | `NODE_OPTIONS=--conditions=nomicore-source pnpm exec tsx packages/vfsl-codegen/.sa7-tmp/probe307.mts`（已删除） | `[SA7-DATAFLOW] SUMMARY pass=138 fail=0`、exit 0 |
| 7 | 临时 domain `pnpm generate --domains <tmp>`（默认格式） | exit 0；写盘含四发射位 doc 字节（别名枚举多行/别名联合块位/内联行内） |
| 8 | 同域 `pnpm generate --check --domains <tmp>` → 再 generate → `sha256sum -c` | check exit 0；再生成 sha256 OK（幂等） |
| 9 | 跨格式：默认产物 `--check --semicolon-free`；sf 产物默认 `--check` | 双向 exit 1（fail-closed 保持） |
| 10 | `pnpm generate --domains <tmp> --semicolon-free` + `--check --semicolon-free` | exit 0 / exit 0；零分号（`grep -q ';'` 无命中）、无行尾空格（`grep -Eq ' +$'` 无命中）、doc 字节在场 |
| 11 | 诊断删除后复跑：命令 1 + 命令 3 | 95/95 绿 + check exit 0（与删除前一致） |
| 12 | `git status --porcelain -uall` / `git stash list` / 契约 sha256 | 恰 3 modified src + 未跟踪契约与 wiki 输入；stash 空；sha256 与 SA4 记录一致 |

## 10. Deviations

- 无验收偏差。五门与 A/B 动态证据全部按 SA6 §12.4 / 设计 §12 / 包 AGENTS Verification 预期通过。
- 范围备注（非偏差）：CI Node 20/24 矩阵与 PR CI 观察不在 SA7 职责内（skill 边界），已在 Evidence Matrix 标注路由；SA4 §11-1/§11-3 两项动态验证项已全部承接并 PASS。
- 本验证未修改任何生产/测试/DENY 路径文件；唯一写入产物 = 本报告（skill 固定位）。

## 11. Verdict 判据核对

- 所有设计声明改变的数据流按设计变化（§3 路线 1–7：输入在场 → 四发射位 doc 字节 → 写盘/新鲜闭环，含 semicolonFree 与 W2）✔
- 所有声明保持的数据流保持不变（§4 八条：无 doc 三族、plain/xml、M3、存量域三方逐字节、62 金样本、双格式互斥、错误分类）✔
- 状态机等价面正确（§5：确定性、键序无关、幂等、手造输入不产生禁止行为）✔
- 错误与 cleanup 符合设计（§6：O1/O2 与 HEAD 逐字一致，无伪成功、无新失败类）✔
- 临时诊断已安全清理并复跑确认（§7）✔

**`approve`** —— issue #307 实现在干净可复现环境下通过全部动态验收；`requiresConflictRecheck = false`（无协议边界新事实：纯注释字节发射，类型形状/公共面/wire 零变化，与 SA4 结论一致）。
