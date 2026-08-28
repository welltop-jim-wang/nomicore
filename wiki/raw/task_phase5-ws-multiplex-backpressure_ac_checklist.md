# AC 逐条门禁核对表 — Phase 5: multiplex namespaces with bounded fair backpressure（issue #137）

- run_id: issue-137-1787922674-8367 / round: 1
- 核对时间: 2026-08-29 01:33（SA4 R2 pass + SA7 pass 双清之后）
- 核对方式: 证据核对（引用测试文件/用例、SA 报告章节、落盘退出码）；总控未重复执行已被 SA4/SA7 覆盖的套件
- AC 来源: issue #137 原文（简报 §Acceptance criteria 逐字收录）

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC-1 | One connection multiplexes namespace frames directly by namespaceId and forbids reopening a closed namespace in the same connection. | ✅ | 已绿域（#136 交付态探针实测：双 namespace 单连接双向 live——简报 §AC 覆盖映射）；重开禁止矩阵既有套件 `ws-replication-ac1-ac2-open.test.ts`（§7.1 NAMESPACE_REOPEN_REQUIRES_RECONNECT）；本任务守卫：`ws-replication-issue137-ac1-ac7-red.test.ts` bootMulti 单连接 multiplex 全部 target；84/84 全绿（sa7-r137-full3/full4-vitest.exit=0） | 无需新实现（SA6 移交标注），守卫断言随红锚文件入库 |
| AC-2 | Each namespace has bounded queued count/bytes, configurable in-flight UPDATE window, ACK timeout, and unsent-update merging. | ✅ | 未发送增量合并=本任务新实现：红锚 `AC-2:` 转绿（UPDATE 帧数 2<4，Y.mergeUpdates 一帧——SA3 证据 + SA7 基线复证）；有界 count/bytes + 滑动窗口（默认 32）+ ACK timeout 既有 #136 套件（`ws-replication-ac5-live.test.ts`、`ws-replication-spec-b1-b2-red.test.ts`）+ 本任务守卫 | SA3 实现（update-channel.ts pullAndSendOne 贪心合并，核减=入账字节之和） |
| AC-3 | Overflow discards only unsent increments for the affected namespace, enters needs-resync, and preserves already accepted local Y.Doc state. | ✅ | 已绿域（探针实测：A 终态失败 B 不受影响、A 的 per-ns 溢出不入 B——简报 §AC 覆盖映射）；本任务连接级 shed 同构语义：红锚 `AC-5:` 转绿（恰 A needs-resync / B live / 连接 ready / 恢复 round 补齐——SA3+SA7 证据）；处置 = §10.2 同构（D6：discardQueued + needsResync + 停发新 UPDATE，已接受本地状态保留） | SA3 实现（backpressure.ts shed + peer/hub-namespace 分派 declareLocalResync/declareHubResync/pendingResync） |
| AC-4 | Connection scheduling prioritizes control/error/ACK and round-robins data with at most one frame per namespace per turn. | ✅ | 红锚 `AC-6a+AC-4:` 转绿：恢复段帧序恰 [a,b,a,b,a,b]（插入序 wheel + 旋转游标，每轮每 ns 至多一帧——SA3 证据；SA7 复证）；control 优先：红锚 `AC-6b:` 转绿（hub 高压下 UPDATE_ACK 照常出、fan-out UPDATE 暂停） | SA3 实现（backpressure.ts ConnectionSender RR wheel + control 恒先） |
| AC-5 | Connection total-pressure recovery selects queued namespaces for resync while preserving a control-frame reserve; reserve exhaustion is a classified connection failure. | ✅ | 红锚 `AC-5:` 转绿（maxQueuedBytesPerConnection 运行时记账首次落地，按最大 queued ns 依次收口至 Σ≤cap）；control 保留额度耗尽 = CONNECTION_BACKPRESSURE（§13.1 注册表既有条目，1011）：SA7 D3 三互补面复证（lowWater=1 首控制帧即触发 / 缺省 64KiB 大 BOOTSTRAP 帧不上 wire / lowWater=100 精确锁定谓词 used+frame>lowWater）——sa7_report.md §D3 | SA3 实现（backpressure.ts 记账+shed+保留额度；peer/hub connectionFatal/close(1011) 路径） |
| AC-6 | WebSocket bufferedAmount high/low-water gating uses the Cordis scheduler and never blocks the Runtime sequencer. | ✅ | 红锚 `AC-6a+AC-4:`/`AC-6b:` 转绿（高水位 0 data 帧、低水位恢复）；闸门读 bufferedAmount 鸭子类型属性（缺省 0 恒开——既有 73 IT 结构性零回归）；恢复检查经注入 ReplicationTimer poll 1000ms（协议 §17 字面、ADR 0009 Cordis Timer 纪律）；SA7 D5：GOAWAY teardown poll timer 零泄漏（pending 恰回退 1、stale 零副作用）；不进 Runtime sequencer 为结构属性（连接级调度完全位于 sequencer 外——设计 §4.2 + ADR 0008/#132 边界，SA8 设计复审 clear 复核） | SA3 实现（backpressure.ts 水位闸门）；SA7 D5 动态复证 |
| AC-7 | Tests demonstrate fairness, no starvation, independent namespace failure, queue/window limits, reconnect repair, and bounded memory under adversarial traffic. | ✅ | fairness/no-starvation：红锚恢复段恰 [a,b,a,b,a,b] + SA7 D4 R2-N1 活性守卫（超限项 F4 消费即进展→合法项同一 drain 收敛，零滞留）；independent failure：探针实测 + #136 套件 + 红锚守卫（A needs-resync/B live）；queue/window limits：per-ns 上限（既有 ac5-live/spec-b1-b2）+ 连接级 cap（AC-5 锚）；reconnect repair：探针实测（断线重连双双 live 收敛）+ #136 ac6-resync-close 套件；bounded memory：全部队列有界（maxQueuedUpdateBytes/Count、连接 cap 运行时记账）+ 溢出丢弃语义测试 + 设计 §11.3 三套记账一致性（SA2 R1 #1 修复后核减口径互逆） | 演示面 = SA6 红锚 4 用例 + SA7 新增 7 IT（ws-replication-sa7-issue137-dynamic.test.ts）+ 既有 #136 套件，84/84 绿 |

## 结论

**AC-1~AC-7 全部 ✅，无 ❌ 条目，无需追加派发。**

- 验证基线：commit 6f2676f..98ffafc（SA3 实现 9d4d0e2 + F1 修复 8f9751e + SA7 补充测试 98ffafc）。
- 关键退出码（.mabf-bg/ 落盘）：sa7-r137-full3-vitest.exit=0 / sa7-r137-full4-vitest.exit=0（13 文件 84 IT 两轮全绿）、sa7-r137-tsc5.exit=0；SA4 R2 独立复跑吻合（sa4_review.md §8）。
- 非阻断留痕（不阻塞 AC 门禁，随 REPORT.md 登记）：SA4 F2–F5 NOTE；SA7 N1（advanceUntilReady 测试范式注记）/N2（F4 墓碑超限边界，建议下轮设计修订补 B-2 运维登记）。
- CI 触发证据：分支未 push（立法禁止总控 push），CI run log 摘录发布后可得；本地证据 = 84/84 两轮 + tsc exit 0 + CI wiring 复核（sa7_report.md §6.3）。
