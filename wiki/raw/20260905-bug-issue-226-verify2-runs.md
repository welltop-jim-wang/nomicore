# Issue #226 第二轮独立复核 — 完整运行输出（2026-09-05 UTC）

复核人：SA5 恢复核验子代理（review + re-run only；零产品代码、零测试文件改动）。
环境：node v24.13.0 / pnpm 10.28.2 / vitest 3.2.7；worktree `mabf/issue-226` @ `45a22f060eee924e4ed6a2d6fa64fb7cd6b2db08`；`git status --porcelain` 无任何 tracked 修改（仅本任务未跟踪文件）。
运行方式：bash 后台 Job（`run_in_background: true`），命令与首轮/§7 复核轮完全一致。

## 1. 红灯契约重跑（复现验证）

命令：

```bash
pnpm test packages/namespace-registry/test/registry-issue-226-red.test.ts \
          packages/namespace-runtime/test/runtime-issue-226-red.test.ts
```

输出（vitest 摘要，逐字）：

```text
 ❯ packages/namespace-registry/test/registry-issue-226-red.test.ts (11 tests | 10 failed) 7479ms
   × T1 schema-compile 拒绝 … 1035ms   → Matcher did not succeed in time.
   × T2 validation 拒绝 … 1011ms       → Matcher did not succeed in time.
   × T3 input-snapshot 失败 … 1002ms   → Matcher did not succeed in time.
   × T4 Persistence 运营失败 … 1015ms  → Matcher did not succeed in time.
   × T5 Persistence fatal（post-commit，committed:true）… 1018ms → Matcher did not succeed in time.
   × T6 create-document-internal fatal … 1010ms → Matcher did not succeed in time.
   ✓ T7 GREEN 对照：initStream 之后的结局（#17 committed / #18 runtime-construction fatal）已正确归属 13ms
   × T8 慢建流 + 慢同步 append … 248ms → expected 6 to be less than 3
   × T9 慢建流不得无限延长 Registry shutdown … 203ms → expected 6 to be less than 3
   × T10 open 槽内 adapter 构造 … 155ms → expected 2 to be less than 1
   × T11 被拒 create 的结局零落盘 … 761ms → Matcher did not succeed in time.
 ❯ packages/namespace-runtime/test/runtime-issue-226-red.test.ts (2 tests | 2 failed) 404ms
   × T12 慢同步 emitter 不得阻塞下一业务写槽 … 291ms
     → 下一业务写槽被慢日志 emission 推迟 101ms: expected 101 to be less than 50
   × T13 慢同步 emitter 不得阻塞 close barrier … 108ms
     → close 结算被慢日志 emission 延长至 101ms: expected 101 to be less than 50

 Test Files  2 failed (2)
      Tests  12 failed | 1 passed (13)
Type Errors  no errors
   Duration  12.03s
EXIT=1（预期红灯退出码）
```

失败根因（Caused by，逐字）：

- T1–T6（poll 包裹）：`AssertionError: expected +0 to be 1`——候选 ns（`ns-…01`）数据键控通道 0 条记录（`waitNsRecords` L279 触发）。
- T11（poll 包裹）：`AssertionError: expected false to be true`——`namespaces/<候选ns>/` 目录 600ms 内从未建立（L615 触发）；前半 GREEN 对照（成功 create 落盘 genesis+attempt）先行通过。
- T8/T9/T10：顺序断言 `expected 6 to be less than 3` / `expected 2 to be less than 1`（L471/L504/L531 触发）。
- T12/T13：墙钟旁证先触发（101ms vs 阈值 50，L126/L159）；顺序锚在其后未到达。

## 2. 相邻既有诊断契约基线（环境健全性对照）

命令：

```bash
pnpm test packages/namespace-registry/test/registry-create-diagnostic-red.test.ts \
          packages/namespace-runtime/test/runtime-root-schema-diagnostic-red.test.ts
```

输出（逐字）：

```text
 ✓ packages/namespace-registry/test/registry-create-diagnostic-red.test.ts (16 tests) 614ms
 ✓ packages/namespace-runtime/test/runtime-root-schema-diagnostic-red.test.ts (14 tests) 467ms

 Test Files  2 passed (2)
      Tests  30 passed (30)
Type Errors  no errors
   Duration  5.93s
EXIT=0
```

## 3. 结论

- 红灯复现维持：12 红 / 1 绿对照，失败形态与 §3.2（首轮）及 §7.3（复核轮）一致；T12/T13 墙钟 101ms vs 首轮 103ms / 复核轮 102ms，属正常抖动（顺序断言为主判据，不受影响）。
- 环境健全：相邻既有契约 30 绿（0 失败），红灯归因于 #226 新增用例而非环境劣化。
- `--typecheck` 通过（`Type Errors: no errors`），排除类型面噪声。
