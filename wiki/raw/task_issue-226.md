# Issue #226 — 修复创建诊断覆盖与日志生命周期隔离

## Task Type
bugfix

## Parent
PR #142 (`docs/namespace-diagnostic-change-log`)

## What to build
让 namespace 创建从首次可观察尝试起完整进入诊断变更日志，同时把同步 File diagnostic-log I/O 从 Registry lifecycle carrier 与 Runtime write-sequencer 的业务关键路径中隔离。duplicate、输入快照、schema 编译、validation、Persistence 与 post-commit construction 等结局应可诊断；日志存储变慢、挂起或失败不得改变业务结果、提交事实、后续写入顺序或无限延长 create/shutdown。

## Acceptance criteria
- 建流前发生的 duplicate、输入快照、schema 编译、validation 和 Persistence 等创建结局不再被无归属通道确定性丢弃，并以正确 namespace 归属进入诊断流。
- 创建路径继续保持 acceptance/capability gate 的输入零访问，以及后续路径只消费既有 detached safe snapshot 的纪律。
- 建流、reopen/repair、retention sweep 和同步 append 不在 Registry lifecycle carrier 或 NamespaceRuntime write-sequencer 的业务关键路径内执行。
- 慢或挂起的日志存储不阻塞下一业务槽，且不能无限延长 Registry shutdown；日志 throw、初始化失败与 storage failure 继续与业务结果隔离。
- 契约测试覆盖创建早期拒绝、Persistence 失败、post-commit fatal、慢同步 adapter、后续写入推进和 shutdown，并证明修复前行为会失败。

## Blocked by
None (can start immediately).
