# 修订轮 R1 验收核对表 — issue #87 / PR #96（owner Request changes 回归要求逐条确认）

核对时间：2026-08-23 22:16。核对人：总控（证据来源：SA6 锚定记录、SA4 rev1_sa4_review、SA7 rev1_sa7_report、总控亲跑 .mabf-bg/rev1-*.log）。

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| R1 | 公共入口不存在 set-only 半成品 `applyValidatedMutation`（含 MutationIssue / ApplyValidatedMutationResult 类型名目） | ✅ | index.ts 三名目导出已删（SA4 §1：17 行枚举白名单、无换名/旁路、exports 仅 "."）；守卫测试 public-surface-guard.test.ts 3 用例 + public-surface-type-guard.test-d.ts 全绿；SA4 无侵入红向探针独立复现守卫真实红（防自欺） | SA3 实现 + SA6 守卫锚定 |
| R2 | fatal contract 仍覆盖 pre-commit internal / observer cleanup throw / post-commit verification / 未知异常保守分类 | ✅ | 三迁移测试改走内部 seam `../src/mutation.js`；SA4 §3 机械证明：it() 数 4/2/8、expect 行 25/11/69 HEAD↔WT 完全相等、断言零弱化；SA7 §2 复跑全绿、无 skip/todo | SA3 迁移 + SA4/SA7 双清 |
| R3 | 普通领域失败继续留在结果联合 | ✅ | 领域结果联合断言随迁移文件原样保留（SA4 §3）；全量 974 用例绿 | 同上 |
| R4 | DocRuntimeFatalError / 稳定 phase / committed 分类 / cause 保留 / materializeRoot fatal 改造交付范围不变 | ✅ | 保留名目守卫（5 值导出 typeof function + 8 类型名目 import 锚）绿；SA4 §2 零误删；fatal.ts / materialize.ts 零 diff | SA6 守卫 + SA4 复核 |
| R5 | 全量 typecheck/test 绿 | ✅ | 总控亲跑（后台独立进程）：pnpm typecheck exit 0；vitest run --typecheck 72 文件 / 974 用例 / Type Errors none（.mabf-bg/rev1-typecheck.log、rev1-test.log）；SA4、SA7 各自独立复跑双源一致 | 总控验收 + SA7 复跑；CI Node 20/24 腿移交 runner |
| R6 | doc-runtime patch 版本 bump | ✅ | packages/doc-runtime/package.json 0.1.6 → 0.1.7（SA4 §5 复核在位） | SA3 |

结论：6/6 ✅，可进入 commit + push（修订轮允许 push；严禁提交 .mabf/**、.mabf-bg/**、REPORT.md、.mabf-done）。

非阻塞 findings 登记（SA4）：F-1 guard 用例 3 注释“防换名”超出正则实际能力（SA6 未来加固，本轮 diff 已逐行验证无换名）；F-2 fatal-contract L70 红灯期注释残留（cosmetic）；F-3 commit 排除 runner 产物（本轮 commit 指令已覆盖）。
