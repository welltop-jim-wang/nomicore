# MABF Task: doc-runtime：committed-aware transaction fatal 契约

- run_id: issue-87-1787469258-378585
- branch: fix/issue-87-on-docs-namespace-runtime
- base: docs/namespace-runtime（PR #85 head）
- worktree: /home/wangjian/nomicore-fix-issue-87

## Issue #87

## Parent

PR #85（docs/namespace-runtime）

## What to build

为 doc-runtime 的 transaction fatal 冻结 committed-aware 异常契约，使上层 Runtime 能区分零写入 internal failure 与 transaction/observer 已提交后的 fatal，而不猜测或虚假声称回滚。

## Acceptance criteria

- [ ] 提供稳定 branded fatal error，至少包含 committed 与稳定 phase
- [ ] observer cleanup throw、post-transaction verification 与明确 pre-commit internal failure 可被准确区分
- [ ] 普通 logical/path/materialization/mutation 失败继续使用领域结果联合，不进入 fatal 通道
- [ ] committed fatal 不执行补偿写、不 fallback、不声称 rollback
- [ ] 未识别 transaction 异常采用保守语义并有回归测试
- [ ] materializeRoot 与 applyValidatedMutation 的相关测试覆盖 exact error identity、commit 状态和 Y.Doc 最终状态
- [ ] 全量 typecheck/test 和 Node 20/24 CI 通过

## Blocked by

- #74
- #76

---

## SA6 Phase 1 验收锚定记录（红灯测试；SA6 run 于 2026 流水线）

### 产出（红灯验收测试）

1. `packages/doc-runtime/test/transaction-fatal-materialize-contract.test.ts`（16 用例）
   —— materializeRoot 侧 committed-aware fatal 契约主锚（AC-1/AC-2/AC-4/AC-5/AC-6）。
2. `packages/doc-runtime/test/apply-validated-mutation-fatal-contract.test.ts`（4 用例）
   —— applyValidatedMutation 的 fatal 契约面锚（AC-6；落地方式见下「O1 范围治理」）。

### 需求拆解与测试设计（逐 AC）

- **AC-1（branded fatal 形状）**：公共入口必须导出 `DocRuntimeFatalError` 构造函数（ADR-0008
  原文命名，W2'）；fatal 实例带 `committed: boolean` 与稳定 `phase: string`。
  测试锚 = 导出面函数断言 + 场景实例的 instanceof / committed / phase 断言；
  phase 不锁具体取值（ADR 留白、归 SA1 定稿），只锁可观察性质：非空字符串、同场景重复
  触发稳定、三相两两互异（AC-2 可机读区分）。附加 W2'/W4 模块级断言：doc-runtime 公共面
  **不得**导出 Runtime 层 `RuntimeWriteFatalError`（两层命名互不侵占，fatal 只携带事实）。
- **AC-2（三相可区分）**：observer cleanup throw（observer 抛 Error 实例）→ committed:true；
  post-transaction verification（⑤ 顶层偏离三变体：delete 计划键 / insert 额外键 / 覆写值
  不同一 + ⑥ 嵌套语义偏离）→ committed:true；明确 pre-commit internal failure（手造派生物：
  derived.structure 非 root——合规调用者不可达、属 internal/意外异常类）→ committed:false。
  三相的 phase 两两互异（1 条专用用例）。
- **AC-3（领域联合不吞并，护栏）**：logical 校验失败 / 目标 ROOT 非空 / PATH_NOT_ALLOWED
  均必须保持 ok:false + issues 联合（未 throw、非 fatal 形态）——本组用例当前为**绿**
  （fatal 通道尚不存在，领域失败本未被吞并）；守护的是「SA3 引入 fatal 通道后不得反向
  吞并领域联合」（W5），实现走样即变红，不是主红灯锚。
- **AC-4（不补偿 / 不 fallback / 不声称 rollback）**：行为面 = fatal 后 Y.Doc 保持
  observer 留下的实际状态（删键不补回、插键不撤销、覆写值不恢复、嵌套修改不还原）——
  基线实现已满足行为面（E201 消息「不回滚、不补偿」+ 实际不补偿）；缺失面是 branded
  形状（见 AC-1/AC-2）。文本面 = message 不得匹配「已回滚/自动回滚/rolled back」声称
  模式（负词「不回滚、不补偿」不违反）。
- **AC-5（未识别异常保守语义 + 回归锚）**：observer 抛非 Error 值（string，未识别形态）
  → fatal 且 committed 保守为 **true**（W3：不得降格 false）；同一场景重复 3 次提交
  恒为 true（回归锚）。已识别形态（observer 抛 Error 实例）同归 committed:true
  （yjs 实证：observer 抛错不触发事务回滚，update 已发出、值已落盘——场景验证
  SCN-E：updateCount=1、title='t'）。
- **AC-6（exact identity / commit 状态 / Y.Doc 最终状态）**：所有 fatal 场景断言
  instanceof 同一 `DocRuntimeFatalError` 类 + 构造器名恒为 'DocRuntimeFatalError'；
  committed 字段与场景真实提交状态一致；Y.Doc 最终状态逐场景断言（提交后状态 /
  observer 状态 / 零写入态）。applyValidatedMutation 侧：fatal 必须与 materializeRoot
  共享**同一构造器**（exact identity，1 条专用用例）。
- **O2 治理（E202 归类不预设）**：现行 E202（写前活动 transaction 语境拒绝）是调用方
  契约破坏而非引擎 internal failure，是否 fatal 化归 SA1/SA2（O2）；本测试**不锚**
  E202 的 fatal 化（避免锁死归类决策）。「明确 pre-commit internal failure」锚定
  手造派生物（E200 崩溃边界现收敛为 ok:false 单 issue——SA1 按冲突报告重点裁决三 3
  归类为 internal 性质时，本测试即要求 committed:false fatal 交付；W3 零写入锚：
  0 update + state 字节不变 + ROOT 空置，基线已验证满足）。
- **O1 治理（applyValidatedMutation 落地方式）**：生产代码未实现（grep 0 命中），AC-6
  对它的覆盖按 O1 只锚 **fatal 契约面**（导出面 + shared DocRuntimeFatalError exact
  identity + committed:true + Y.Doc 最终状态 + 领域失败面不吞并），**不扩范围到完整
  validated mutation 管线语义**（set/delete/array-insert/array-delete 语义属独立任务面）。
  mutation 参数形状 ADR 未逐字冻结：测试采用对 ADR-0007 冻结语义的最小直译
  `{ op: 'set', path: ['title'], value: 't2' }`；若 SA1 设计对字段命名有不同定稿，
  SA1 应在设计中登记本测试的对齐方式。
- **既有 U13 冲突登记**：materialize-root.test.ts 的 U13 断言「observer 抛错
  message 精确匹配 'observer-boom'（原样传播）」与本任务「branded fatal 交付」（包装
  才能携带 committed/phase）存在面冲突——按 AC-1/AC-2/AC-6 以 branded fatal 为准；
  U13 演进方式列为 **SA1 设计输入 + AC 门禁复核项**，本文件不动 U13（避免在 SA1 定稿
  包装形态前锁死实现）。

### 红灯运行证据（2026 流水线；独立进程：`npx vitest run` 于 worktree）

**命令**：
```
npx vitest run packages/doc-runtime/test/transaction-fatal-materialize-contract.test.ts \
  packages/doc-runtime/test/apply-validated-mutation-fatal-contract.test.ts
```
**结果**：`Test Files 2 failed | Tests 17 failed | 3 passed (20)`；`Type Errors no errors`。
- 17 红 = 全部主锚用例（AC-1/AC-2/AC-4/AC-5/AC-6）+ applyValidatedMutation 全部 4 用例；
- 3 绿 = AC-3 护栏（预期绿，见上）；
- 红因抽样（真实断言失败信息）：`expected undefined to be type of 'function'`
  （`DocRuntimeFatalError` / `applyValidatedMutation` 未从公共入口导出——全仓 grep 0 命中）。

**场景触发器正确性证据**（`.mabf/sa6-red-verify/scenario-verify.test.ts`，基线运行，
7/7 通过——证明红因 = 契约缺失，非 fixture 缺陷 / 非「无法复现」）：
- SCN-A（5 偏离 delete）→ 基线抛裸 `Error`（message 前缀 DOCRT-E201；`constructor.name
  = 'Error'`；`committed = undefined`；`phase = undefined`）；doc = `{"count":7}`（不补偿）；
- SCN-B/C（insert / 覆写值）→ 同上，doc 保持 observer 状态；
- SCN-D（⑥ 嵌套偏离）→ 基线抛裸 Error（DOCRT-E201 变体 C）；
- SCN-E（observer 抛 Error）→ 基线原样传播裸 Error('observer-boom')；updateCount=1、
  title='t'（已提交，不虚假回滚）；
- SCN-F（observer 抛 string）→ 基线原样传播原始 string（typeof string，非 branded）；
- SCN-G（手造派生物）→ 基线**不 throw**：返回 ok:false + DOCRT-E200 单 issue；
  updateCount=0（零写入）。

**全量回归**：`npx vitest run packages/doc-runtime` → `2 failed | 14 passed (16)`，
`Tests 17 failed | 218 passed (235)`，Type Errors no errors——既有 218 用例零回归
（仅 2 个新红灯文件失败）。

### 修订轮记录（SA1 设计期新发现；§8 fixture 时序对齐）

SA1 设计（`wiki/raw/task_doc-runtime-transaction-fatal_design.md` §8）登记：
apply-validated-mutation-fatal-contract.test.ts **用例 2/3 的 observer 挂载时序缺陷**——
observer 挂在 seed（materializeRoot 铺底事务）**之前**，node+yjs@13.6.32 实证 seed
事务本身即触发 one-shot 抛错 → `materializeRoot` 在 seed 行直接 throw →
`expect(seed.ok).toBe(true)` 恒不可达 → 任何正确实现下恒红（Phase 4/7 卡死点）。

- **修订**（SA6 owned 文件，按 §8 修法，断言零变化）：用例 2/3 的
  `root.observe(...)` 三行移至 `expect(seed.ok).toBe(true);` 之后（各约 6 行位移）+
  时序纪律注释。materialize 文件 16 用例未动（场景触发器已 7/7 实证）。
- **修订后验证**（独立进程）：
  - fixture 时序实证（临时验证用例，跑完即删）：`seed.ok = true`（修订后可达）；
    observer 恰在**后续事务**触发（observeCalls=1，Error('mutation-observer-boom')）；
    已提交值保留（title='t2'、count=7）——§8 修法有效；
  - 两个红灯文件重跑：`Tests 17 failed | 4 passed (21)`（4 绿 = materialize 护栏 3 +
    fixture 验证 1）；apply 文件 **4 用例红因全部为** `expected 'undefined' to be
    'function'`（`applyValidatedMutation` 未导出——**实现缺失红**，非 fixture 缺陷恒红），
    用例 2/3 的 seed 前置现已可达；
  - 全量 `npx vitest run packages/doc-runtime` → `Tests 17 failed | 218 passed (235)`、
    Type Errors no errors——与修订前一致（既有 218 零回归、新红灯 17 不变）。

### 写死清单（SA3 修绿方向，黑盒锚点）

- `DocRuntimeFatalError` 经 `packages/doc-runtime/src/index.ts` 公共入口导出；
  实例带 `committed: boolean`、`phase: string`（非空；同场景稳定；三相互异）；
- materializeRoot 写后偏离（⑤/⑥）与 observer 抛错（含非 Error 值）改以
  `DocRuntimeFatalError` 交付（committed:true）；可在 E201/E202 系列消息前缀基础上
  保留兼容（既有 /DOCRT-E201/ 正则断言不破坏）；
- 明确 pre-commit internal failure（E200 崩溃边界内的 internal/意外异常类，锚 =
  手造派生物）改以 committed:false fatal 交付（写前仍须 0 update / state 字节不变）；
- 领域失败面（logical / ROOT 非空 / PATH_NOT_ALLOWED / mutation 领域失败）保持
  ok:false + issues 联合，不进 fatal 通道；
- applyValidatedMutation 面世后其 committed fatal 必须与 materializeRoot 同一
  branded 类（本任务不要求完整 mutation 管线，O1）；
- doc-runtime 公共面不导出 RuntimeWriteFatalError（W4）。
