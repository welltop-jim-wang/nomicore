# SA3 Implementation Report

- 角色：SA3（mabf-sa3）· 阶段 implementation · 迭代 0 · one-shot dispatch `sa-e3f1c8cb-55cb-4216-96c5-4297a7ee4b2e`
- 任务：Issue #319 number 值域收窄核心（ADR 0021）——按 SA1 设计（SA2 approve 的迭代 1 修订版）实现并让 SA6 红灯契约转绿
- Worktree：`/home/wangjian/nomicore-fix-issue-319`；基线 HEAD `ff2dc6476e758be0f6adda307931d6f5c46e8bc0`（Parent PR #318 head，工作树已基于其）
- Issue #319 REST 评论：读取成功且为空数组 → **无 Owner 评论要求**（与简报 / SA6 §2 / SA8 §4 同证）

## Inputs consumed

| 输入 | 状态 |
| --- | --- |
| `wiki/raw/task_issue-319.md`（任务简报 + AC1~AC5） | 已读全文 |
| `wiki/raw/task_issue-319_design.md`（SA1 迭代 1 修订版，449 行） | 已读全文（D-A~D-H、§11 ALLOW/DENY、§12 验收映射、§14 修订映射） |
| `wiki/raw/task_issue-319_sa2_review.md`（SA2 迭代 1 复审，approve） | 已读全文（F1/F2 已落实、O1~O6 观察） |
| `wiki/raw/task_issue-319_sa6_contract.md`（SA6 契约，approve，294 行） | 已读全文（T1/T2/D1 断言规格、消息规则①–④） |
| `wiki/raw/task_issue-319_conflict_report.md`（SA8，clear，requiresConflictRecheck=true） | 已读全文（Required actions 1–4、冻结面清单） |
| `wiki/raw/task_issue-319_relevant_decisions.md`（SA8 决策摘录） | 已读全文 |
| `docs/adr/0021-vfsl-number-domain-narrowing.md` | 已读决策 1/3/4/5/6/7 相关区段（条款逐字比对） |
| 源码锚点 | `packages/vfsl/src/validate.ts`、`validate-patch.ts`、`doc-runtime` 两测试 + 两源注释、`docs/vfsl/v1-spec.md` §8、changelog `src/testing.ts` / `test/helpers/base.ts` |

设计内部一致、ALLOW/DENY 明确、SA2 BLOCKER/MAJOR 已在设计中落实、红灯契约与设计一致——无阻塞，按设计实施。

## Existing worktree reconciliation

- 起点工作树仅 6 枚 Host 输入 untracked（`wiki/raw/task_issue-319*.md`），`packages/`/`docs/`/`apps/`/`domains/` 零 diff；无既有 `task_issue-319_sa3_impl.md`、无未提交实现——本报告为首版实现状态，无需原位修订前序实现。
- 未发现与设计冲突的既有改动；全部改动为本次新增。

## Changed paths

| Path | Design section | Change |
| --- | --- | --- |
| `packages/vfsl/src/validate.ts` | §7 D-A / D-B / D-C | 唯一生产改动：新增模块局部 `isJsonFaithfulNumber` / `renderNumberValue` / `scalarAccepts` / `scalarRejectMessage` / `NEG_ZERO_MEMO_KEY` / `memoKey`；`validateValue` scalar 分支与 `contradictsInner` scalar 分支改用共享谓词；memo 三触点键归一化（两读一写） |
| `packages/vfsl/test/validate-number-domain-narrowing.test.ts` | §12 T1（AC1-1~AC2-1/AC5/AC6/AC7 + AC1-5） | **新建**红灯行为契约（51 用例） |
| `packages/namespace-diagnostic-log/test/write-path-number-domain-closure.test.ts` | §12 T2（AC3-1~AC3-4） | **新建**观测闭合锁定（12 用例） |
| `docs/vfsl/v1-spec.md` | §7 D-E（SA8 R1） | §8 第 3 条规则后插入「例外条款」引导行 + 「语义收窄例外」条款（ADR 0021 决策 4 逐字），其余零改动 |
| `packages/doc-runtime/test/materialize-root.test.ts` | §7 D-H | RAC-2 CASES 删除 C-7 行 + 原位一行迁移注释；紧邻 RAC-2 新增 R2b 逻辑失败用例（直调 ① 拒 → materialize 同拒 + `issues` toEqual + 0 update + state 字节不变）；RAC-2 头注矩阵行数同步（SA2 O1） |
| `packages/doc-runtime/test/replace-root-content.test.ts` | §7 D-H | G3 L486 用例：前置翻转 `ok:false` + 收窄消息 + 删 `toContain('non-finite number')` + 直调 `issues` toEqual（零损透传）+ 保留零写入/旧内容原封；G5 L630 用例：前置翻转 `ok:false` + 用例名/注释改「同一逻辑失败输入」+ mat/rep `issues` 等价保留；文件头 AC-1 注一行同步 |
| `packages/doc-runtime/src/materialize.ts`（L128） | §7 D-H 裁决 3 | 各 1 行注释更正：`① 逻辑校验（值域宽域）` → `① 逻辑校验（number 值域经 ADR 0021 收窄）`；comment-only |
| `packages/doc-runtime/src/replace.ts`（L120） | §7 D-H 裁决 3 | 同上（comment-only） |

未提交任何 commit / push / PR；未触碰 DENY LIST 路径（`validate-patch.ts`、`index.ts`、parser/tokenizer/evaluate/derived、changelog `src/**`、`input-capture.test.ts`、namespace-runtime、persistence、ADR、§8 以外章节、CONTEXT.md、生成物/fixtures/lockfile 零 diff）。

## SA2 Finding落实

| Finding ID | Implementation | Result |
| --- | --- | --- |
| F1（BLOCKER，3 处旧四值语义断言 + 两失准注释） | 按 D-H 逐用例规格迁移：C-7 迁出构造失败矩阵（原位注释 + R2b 逻辑失败用例，保留 loud 失败 + 零写入 + 零损透传锚）；replace L486 前置翻转 + 收窄消息 + 删构造域词断言 + 直调 toEqual；L630 前置翻转 + mat/rep 等价保留；materialize.ts/replace.ts 各 1 注释行更正。不放宽任何拒绝、不删除覆盖 | 三用例在新语义下绿（doc-runtime 聚焦 72/72）；doc-runtime diff 仅 ALLOW 列出路径 |
| F2（MAJOR，AC1-5 schema 非法） | AC1-5 全部使用 v1 合法形：`type U = number \| string; type ROOT = { xs: U[]; };`（TypeRef + `[]` 后缀）与 `Record<string, number \| string>`；经 parser 实测无 E100（测试前置 `parseVfsl`/`evaluate` ok 即证） | AC1-5 ①~⑤ 全绿，且经 mutation 探针证明对 memo 修复敏感（见 Verification） |
| O1（materialize-root 头注失准） | RAC-2 头注矩阵行数/内容同步为「8 行矩阵 + C-7 已迁移」；`replace-root-content` 文件头 AC-1 注一行同步 | 注释与用例现状一致 |
| O6（L486 用例直调 issues 引用需在 replace 调用前捕获） | 实现按此写法：`const direct = validateLogicalSnapshot(...)` → `directIssues` 捕获于 `replaceRootContent` 之前 | 零损透传断言 `toEqual` 绿 |

核心机制面（D-A 共享谓词 / D-B 双点同步收窄 / D-C 哨兵键 / D-D 消息规则 / D-E §8 落文 / D-G 枚举排除）逐条照设计落地，无设计偏离、无范围扩张。

## File scope check

| Changed path | ALLOW entry | Purpose |
| --- | --- | --- |
| `packages/vfsl/src/validate.ts` | ALLOW 行 1 | 谓词收窄 + 四值消息 + memo 键归一化（唯一生产改动点） |
| `packages/vfsl/test/validate-number-domain-narrowing.test.ts` | ALLOW 行 2 | T1 红灯契约（新建） |
| `packages/namespace-diagnostic-log/test/write-path-number-domain-closure.test.ts` | ALLOW 行 3 | T2 观测闭合锁定（新建） |
| `docs/vfsl/v1-spec.md` | ALLOW 行 4 | §8 语义收窄例外条款（ADR 0021 决策 4 逐字；§8 单点插入） |
| `packages/doc-runtime/test/materialize-root.test.ts` | ALLOW 行 5（用例级） | D-H：C-7 迁移 + R2b 新增用例 + 头注同步 |
| `packages/doc-runtime/test/replace-root-content.test.ts` | ALLOW 行 6（用例级） | D-H：L486/L630 两用例迁移 + 文件头注一行 |
| `packages/doc-runtime/src/materialize.ts`（L128） | ALLOW 行 7（comment-only） | 失准注释更正（1 行） |
| `packages/doc-runtime/src/replace.ts`（L120） | ALLOW 行 7（comment-only） | 失准注释更正（1 行） |
| `wiki/raw/task_issue-319_sa3_impl.md` | 报告产物（skill 固定输出） | 本报告 |

`git status --porcelain` 全量核对：上述 8 条 + Host 的 6 枚 `wiki/raw/task_issue-319*.md` 输入（untracked，非本实现产物）——**无 ALLOW 外改动、无 DENY 触碰**。

## §8 落文 diff（SA8 复查项 (b) 证据）

`docs/vfsl/v1-spec.md` §8（插入后 L468–472；三条既有规则与「对历史文本的解释」段逐字未动）：

```diff
@@ -466,6 +466,10 @@ v1 冻结后的演进规则：**只增不改**。
 2. 语义不改：既有构造的物化 / 挂载 / 错误语义不得重新解释；
 3. 错误码稳定：已发布错误码的条件与含义不变（新条件用新码）。

+例外条款（逐一经 ADR 显式裁决；语义收窄例外首例 = ADR 0021，issue #312）：
+
+- 语义收窄例外：缩小既有合法值域/文本域的变更，仅当满足下列全部条件时允许，且须逐一经 ADR 显式裁决：(a) 收窄使执行语义与已声明的架构契约对齐（本次：ADR 0008 L31「JSON-compatible plain value」）；(b) 影响面与存量姿势在 ADR 中显式记录（本次：决策 5）；(c) owner 显式裁决。
+
 对历史文本的解释，永远以**文本自述**的方言版本为准（即信封 `version` 字段）；
```

- 条款正文与 `docs/adr/0021-vfsl-number-domain-narrowing.md` 决策 4（L80–83）逐字一致（仅去 blockquote 换行）；引导行为结构标签 + ADR「首例」事实陈述，无新增规范性内容。
- 只增不改：规则 1–3 与「只增不改」表述、解释段、`version`、错误码全部未动；未引入 ADR 0020 保留名例外（0020 不在决策集）。
- `git diff --check` exit 0（无空白错误）。

## Verification

| Command | Result | Evidence |
| --- | --- | --- |
| 红灯确认（实现前）：`NODE_OPTIONS=--conditions=nomicore-source pnpm vitest run packages/vfsl/test/validate-number-domain-narrowing.test.ts packages/namespace-diagnostic-log/test/write-path-number-domain-closure.test.ts` | **32 failed / 31 passed（63）** —— 失败全部为四值目标断言（`期望 ok:false…实际 ok:true`、AC1-4 仅 2 条、AC3-1/AC3-3 写路径放行），无夹具/入口错误 | `/tmp/sa3-red.txt`（要点：AC1-1 四值 `ok:true`；AC1-4 `expected length 3 but got 2`；AC1-5 ①~⑤ 全红；AC2-1 四入口放行；AC3-1/AC3-3 放行） |
| 红灯契约转绿（实现后）：同命令 | **2 files / 63 tests passed / Type Errors no errors（662ms）** | `/tmp/sa3-green2.txt` |
| D-H 迁移用例：`pnpm vitest run packages/doc-runtime/test/materialize-root.test.ts packages/doc-runtime/test/replace-root-content.test.ts` | **2 files / 72 tests passed / no type errors（720ms）** | `/tmp/sa3-docrt.txt` |
| 全仓 `pnpm test`（`vitest run --typecheck`） | **exit 0 —— Test Files 315 passed / Tests 3361 passed / Type Errors no errors（598.36s）** | `/tmp/sa3-fulltest.txt`；对照基线 313 files / 3298 tests：增量恰为两枚新测试文件（51 + 12 = 63）；无第 4 处旧语义断言（SA2 §9 triage 实证成立） |
| `pnpm typecheck`（14 包 tsc） | **exit 0** | `/tmp/sa3-typecheck.txt` |
| `pnpm generate --check`（投影生成物新鲜度） | **exit 0** | `/tmp/sa3-generate.txt`；`git status` 对 `packages/vfsl-codegen`/`vfsl-protocol`/`domains`/`apps` 零 diff（生成物/fixtures 逐字节不变） |
| `git diff --check` | **exit 0**（无空白错误） | 命令输出为空 |
| 变更集核对：`git status --porcelain` + `git diff --stat` | 恰为 §12 AC6 枚举变更集（6 modified + 2 new + 报告） | `git diff --stat`：`docs/vfsl/v1-spec.md +4`、`materialize.ts ±1`、`replace.ts ±1`、`materialize-root.test.ts +52/-…`、`replace-root-content.test.ts ±…`、`validate.ts +66/-…` |
| memo 修复敏感性（mutation 探针，全仓套件结束后执行，探针后源码经 sha256 校验恢复） | **移除 memoKey 归一化 → AC1-5 `4 failed / 1 passed`（红）：① `{xs:[0,-0]}` `ok:true`（-0 静默接受）；② `{xs:[-0,0]}` 伪汇总注入 `['xs',1]`；④ 混序静默接受；⑤ Record 位 `['rec','k2']` 伪报 —— 与设计 D-C 预言的**两类错误逐条吻合**；恢复后 63/63 绿、`sha256sum -c` OK** | `/tmp/sa3-mutation.txt`；`sha256sum packages/vfsl/src/validate.ts` = `cab40cee…5841b`（探针前后一致） |

**红灯真实性**：实现前红=四值被放行（SA6 已实证根因），非夹具/超时/入口错误；实现后同一断言集 63/63 绿。断言全部走公共面（`ValidateResult` 联合 / issue message+path / emitter `input.capture`+digest / 包入口导出面），无源码 grep、无字符串形态断言、无 skip/only/todo、无 env override、无 fallback。

## Deferred verification

- **SA4 复核**：D-H 断言修订与新失败面一致性（R2b 迁移锚、L486/L630 前置翻转）、`toContain('non-finite number')` 删除裁决、两注释行 diff；`packages/vfsl/src/validate.ts` 改动面与设计 D-A/D-C 伪代码逐行比对。
- **SA8 三项复查**（`requiresConflictRecheck=true`）：(a) 消息面——新消息 emit 锚位/issue 顺序/单条量（本报告与 T1-AC1-4/AC1-1 证据在案）；(b) §8 落文——条款在场、与 ADR 0021 决策 4 语义一致、三条既有规则未被改写、无 0020 保留名条款、`version` 不升；(c) 冻结面 diff——枚举变更集（本报告 File scope check 行）。
- **SA7 活链路验证**：doc-runtime / namespace-runtime 端到端写路径（NaN/±Inf 仍由 S3 `copyFrozen` 既有拒绝、`-0` 在 vfsl 新拒点被拒）；runtime 级零写入断言（设计 D-F Q6 判定为非必需，未做）。
- **AC6 全仓套件已闭合**（315/3361 绿 + `generate --check` exit 0 + fixtures 零 diff）；SA6 §15 Q6 的 runtime 端到端与 Q5 的强哈希 fixture 均按设计不新增。
- 环境绑定说明：本 worktree 无 `node_modules/@nomicore` 根链接，包内 workspace link 存在；测试经 vitest alias + `customConditions: nomicore-source` 解析源码，无需构建。

## Deviations or blockers

- **无阻塞、无设计偏离**。两处纯注释同步（`materialize-root.test.ts` RAC-2 头注行数、`replace-root-content.test.ts` 文件头 AC-1 注一行）为 SA2 O1 建议的「用例级修订合理延伸」，同属 ALLOW 两测试文件内 comment-only，不涉及任何断言语义。
- `docs/vfsl/v1-spec.md` §8 条款按 ADR 0021 决策 4 **逐字**落文（blockquote 换行合并为单段，语义零变化）；ADR 引「ADR 0008 L31」的行号偏差随逐字要求传播（SA2 O2 已知，不在本任务修订）。
- 未执行 commit / push / PR / finalize（SA3 边界）。

## Suggested commit message

```
fix(#319): 裸 number 值域收窄为 JSON 可忠实表示数（ADR 0021）

- validate.ts：共享标量谓词 scalarAccepts（NaN/±Infinity/-0 全拒）+ 四值细分消息
  （-0 经 Object.is 识别，typeof 失配文案逐字节不变）；contradictsInner 与
  validateValue 双判定点同源，validate-patch 经 validateSubtree 自动同口径
- memo 键消歧：-0 与 0 在 SameValueZero 下不得共键（哨兵键，两读一写）
- 新增红灯契约：validate-number-domain-narrowing.test.ts（AC1/AC2/AC5/AC6/AC7，
  含 memo 序独立性 AC1-5）、write-path-number-domain-closure.test.ts（AC3 观测闭合）
- doc-runtime：3 处旧四值语义断言按 D-H 用例级迁移至 ① 逻辑失败面（不放宽拒绝、
  不删除覆盖）+ materialize.ts/replace.ts 各 1 行失准注释更正
- docs/vfsl/v1-spec.md §8：增补「语义收窄例外」条款（ADR 0021 决策 4 原文，SA8 R1）
```
