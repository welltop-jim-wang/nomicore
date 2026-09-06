# Task Brief — Issue #227: 保证 strict replay 的读取租约与完整性判定

## Parent

PR #142（docs/namespace-diagnostic-change-log）

## What to build

让生产 strict reader 与诊断 replay 在整个检查和物化期间持有短期、可续租的 read-session lease，避免 retention 并发删除正在读取的 segment；同时收紧 replay 完整性判定，使任何无法证明必要 committed update 完整的记录都不会被报告为 complete。

## Acceptance criteria

- [ ] 生产 strict read/replay 在枚举、读取、校验和 update 物化期间取得并最终释放 read-session lease，长读取按冻结策略续租或诚实失败。
- [ ] retention sweep 只删除无有效 lease 的 closed segment group，且 replay 与 sweep 并发时不存在枚举后删除、读取前丢失的 TOCTOU 窗口。
- [ ] `fatal`、`committed:true`、`effect:'unknown'` 不再被当作无更新的连续记录推进至 complete。
- [ ] 缺失、omitted、unknown 或无法解码的必要 update 返回稳定且可解释的 partial/failed 状态和 issue；complete 仅在冻结连续性条件全部可证明时返回。
- [ ] 测试覆盖 replay/retention 并发、lease 到期与续租、unknown committed effect、omitted update，以及合法 complete replay 的保真回归。

## Blocked by

None (can start immediately).
