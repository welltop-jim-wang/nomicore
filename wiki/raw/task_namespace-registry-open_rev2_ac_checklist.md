# Round 2 AC 核对表 — issue #110 修订轮（PR #119 评审反馈）

核对基准：owner 评审意见三条（1 阻断 + 2/3 合并前清理）+ 两条非阻断建议。核对时间：2026-08-26（round 2）。核对者：总控（证据来自 SA6/SA3/SA4/SA7 档案与总控亲跑验证）。

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| R2-1a | `handle.release()` 仍恰调用一次 | ✅ | registry-open.test.ts never-settle 用例断言 `releaseCalls===1`；L572/L610 锚保持绿；SA4 确认 fire-and-forget 同步发起恰一次 | SA6 锚定 + SA3 修复（registry.ts `await`→`void` fire-and-forget） |
| R2-1b | release rejection 仍经 observer 上报且不替换 factory cause | ✅ | L610 锚（release reject → handle-release-failed exact cause、主 fatal 仍 factory cause）SA7 定向复跑 exit 0；SA4 确认内部 try/catch 全包、dispatchObserver 隔离 | SA3 保持 releaseHandleBestEffort 语义不变 |
| R2-1c | 清理 Promise 不得阻塞 factory fatal 交付 | ✅ | SA6 红灯（await 版 pending 断言失败）→ SA3 修复后转绿；SA7 变异抽查：改回 await 精确变红（`expected 'pending' not to be 'pending'`，11ms 非超时）、还原复绿、RESTORE_DIFF_MATCH=0 | SA3 修复核心 |
| R2-1d | 确定性回归测试：release 永不 settle 时 open() 仍 reject 原 factory branded fatal | ✅ | 新用例「factory throw 且 handle.release 永不 settle：open() 仍 reject 原 factory branded fatal（清理不阻塞交付）」（registry-open.test.ts:659）：NamespaceRegistryFatalError 实例、operation='open'、phase='runtime-construction'、committed=false、cause===factoryCause、零回显、releaseCalls===1、observer 收 open-runtime-construction-failed；零 real sleep（flushMicrotasks(20)+setImmediate 探针） | SA6 编写 |
| R2-2 | 删除 testing.ts 不可用 overrides（createDocumentFactory/scheduler never 字段）并同步清理引用 | ✅ | testing.ts 两字段及注释删除、docstring 同步；全仓 grep 无引用残留（registry-open.test.ts:286 scheduler 属 createMemoryPersistence 参数）；聚合 tsc exit 0 | SA3 执行 |
| R2-3 | 修复 `git diff --check`（三个 wiki 文档 trailing whitespace） | ✅ | 总控 sed 清理（文档类小改动例外，dispatch log R2-0 留痕）；SA7 核验 `git diff --check 1a7154e -- wiki/` exit 0 | 总控亲自 |
| R2-4 | 验证三件套：定向测试 / 聚合 typecheck / diff --check | ✅ | 总控亲跑定向 `vitest run packages/namespace-registry`：4 files / 50 tests 全绿 EXIT=0；SA3/SA7 双跑聚合 tsc exit 0；全仓 pnpm test 106 files/1274 tests 绿（SA3）；diff --check clean | 总控+SA3+SA7 交叉 |
| N-1 | 非阻断建议：registry-seam-audit.ts 抽共享测试工具 | 📝 记录不实现 | 本轮切片外；记入 REPORT.md 遗留事项 | 后续 issue 跟踪 |
| N-2 | 非阻断建议：closing/closePromise/lifecycleTail 不可达预留结构收敛 | 📝 记录不实现 | #112 close/shutdown 落地时再收敛；记入 REPORT.md 遗留事项 | 后续 issue 跟踪 |

结论：三条评审反馈全部闭环，无 ❌ 项；两条非阻断建议按 owner 要求仅记录。
