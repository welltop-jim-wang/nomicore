# Dispatch Log — issue #107 persistence 迁移 nomicorePersistence 与外部 Clock/Timer

- run_id: issue-107-1787656954-603033
- worktree: /home/wangjian/nomicore-fix-issue-107
- branch: fix/issue-107-on-docs-namespace-registry
- slug: persistence-timer-service-migration

| 时间 (UTC) | SA | 任务 | 状态 |
|---|---|---|---|
| 2026-08-25 (round 1) | SA1 | 迁移设计（service 更名 + Clock/Timer 强依赖 + ctx.timeout 调度） | delivered ✅（wiki/raw/task_persistence-timer-service-migration_design.md，565 行） |
| 2026-08-25 (round 1) | SA2 | 设计攻击评审（对照 AC1–AC8 + ADR-0009 破壁） | FAIL（3 阻断 B1/B2/B3 + 12 minor）→ 打回 SA1 R1 |
| 2026-08-25 (round 1) | SA1 | R1 修订（闭合 B1/B2/B3 + minor #4–#15） | delivered ✅（R1，651 行） |
| 2026-08-25 (round 1) | SA2 | R1 快速复审（B1–B3 + #7/#8/#9） | PASS ✅（遗留非阻断 L-1 转 SA3） |
| 2026-08-25 (round 1) | SA3 | 实现迁移（设计 R1 §8 十二步） | delivered（前任总控中绝后由继任总控核验：实现与设计逐点对齐；全量 typecheck ✅ / 文档 sweep ✅ 恰 1 行 / `pnpm test` 15 文件 53 红 → 两阻断缺陷） |
| 2026-08-25 (round 1，继任总控) | SA3 | 修复 A：vitest 经 persistence/testing 拖进探针 CLI 子进程（dsh-probe-cli 6 红 + determinism 1 红）→ 裁定抽取 createFakeTimerPlugin 至 vitest-free `src/fake-timer.ts` + `./fake-timer` subpath，testing.ts re-export | delivered ✅（CLI exit 0 events=28；dsh 21/21、persistence 三文件 49/49 绿） |
| 2026-08-25 (round 1，继任总控) | SA6 | 修复 B：namespace-runtime 13 测试文件 29 构造点运行时消费方同步（AC1）——设计 DENY 误判「仅 type-only」（src 成立、test 不成立）→ 裁定共享 real-persistence-scheduler 显式注入 | delivered ✅（nsr 22 文件 118/118 绿；全仓 tsc typecheck EXIT=0） |
