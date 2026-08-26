---
status: complete
issue: 113
branch: fix/issue-113-on-docs-namespace-registry
base: docs/namespace-registry
---

# Phase 4 NamespaceRegistry 全链验收与最终收口

## 验收结论

Phase 4 implementation tickets #106–#112 均已关闭。MemoryPersistence 与 FilePersistence 运行同一套 Registry acceptance contract；FilePersistence 额外覆盖 dispose 后重新构造 adapter/Registry 并 reopen 已提交 namespace。真实 Cordis 组合、缺失依赖 loud fail、open/create/lease/idle/fatal/degraded/shutdown、exports/module graph 与 service/error vocabulary 由既有专项套件覆盖。

Node 20/24 CI 矩阵执行 `registry-node-dispose.test.ts`；测试现将 `Symbol.asyncDispose` 与原生 `await using` 解析能力作为硬断言，不再条件 skip。

## Standards 轴

最终审查发现并修复：

- integration diff 中的尾随空格与文件末尾空行；
- Node dispose 验收可被 skip；
- 缺少 Registry package README 与准确验证命令。

保留的 judgement-call 风险：`registry.ts` 体量较大；Registry/Runtime plain-data snapshot 逻辑存在相似形状；create document 路径存在防御性重复校验。这些不改变 ADR 0009 行为，建议后续在独立重构票处理。

`packages/dsh-persistence/src/clock.ts` 的真实时间 file-probe settle 轮询是既有 ticket 产物；它与模块规范的“注入 clocks/timers”表述存在张力，但不属于 Registry production fallback。该风险不阻断 Phase 4 合并，后续应单独收口 probe seam。

## Spec 轴

Issue #113 的关键缺口已补齐：

- 新增 Memory/File 共用 Registry acceptance contract，并覆盖 File restart/reopen；
- Node 20/24 `await using` 行为测试由可跳过改为硬门禁；
- 补齐 package docs、精确命令与最终双轴结论。

完整并发、idle、degraded/recovery、fatal read-only、typed load/create error、committed create fatal、ordered shutdown、failure aggregation、Cordis dependency 与 module graph 行为继续由 `packages/namespace-registry/test/`、`packages/namespace-runtime/test/` 和 `packages/persistence/test/` 的专项测试覆盖。

## 验证

本地 Node 24：

- `pnpm typecheck`：通过；
- `pnpm test`：通过（新增验收前 117 files / 1403 tests；新增 focused suite 2 files / 4 tests 通过）；
- `./node_modules/.bin/tsc -p tsconfig.typecheck.json --noEmit`：通过；
- `git diff --check origin/main` 与 working diff check：通过。

Node 20/24 最终结果由 PR CI 矩阵门禁确认。

## 合并建议

**建议在本 PR CI 的 Node 20 与 Node 24 jobs 全绿后，将本 PR 合入 base PR #105；随后 PR #105 可合入 `main`。** 若任一 Node job 失败或出现未解决 review blocker，则暂缓 #105 合并。
