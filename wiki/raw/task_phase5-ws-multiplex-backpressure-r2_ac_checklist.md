# AC 逐条门禁核对表 — issue #137 Phase 5（Revision Round 2：质量复审 5 项修复）

- run_id: issue-137-1787922674-8367 / round: 2
- 核对时间: 2026-08-29 12:47（SA4 pass + SA7 pass 双清之后）
- 核对方式: 证据核对（引用测试文件/用例、SA 报告章节、落盘退出码）；总控未重复执行已被 SA4/SA7 覆盖的套件
- AC 来源: issue #137 原文（round-1 简报逐字收录，round-1 AC 清单已核）；本轮追加 R2-1~R2-5 五行（质量复审反馈逐条）

## A. 原验收标准 AC-1~AC-7（语义保持核对——本轮修复不得回归）

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC-1 | One connection multiplexes namespace frames directly by namespaceId and forbids reopening a closed namespace in the same connection. | ✅ | 本轮 diff 零状态机/零 OPEN/close 迁移改动（SA4 §1.1 scope 精确核对）；`ws-replication-ac1-ac2-open.test.ts` 等既有套件 17 文件/106 测试全绿（sa7-r2-full-vitest.exit=0） | 无需新实现（守卫回归） |
| AC-2 | Each namespace has bounded queued count/bytes, configurable in-flight UPDATE window, ACK timeout, and unsent-update merging. | ✅（本轮强化） | **R2-3 修复 = AC-2 字面归位**：queued count/bytes 判据不再计入 in-flight（update-channel.ts overflows 只计 queued；协议 §17 分列）；红锚 R2-3(count)/(bytes) 转绿——合法满窗口 + 空队列下第一笔未发送 UPDATE 正常入队、零误 resync；合并/窗口/ACK timeout 语义不动 | SA3 实现（34bbfba）+ SA6 红锚 + SA4 复现 + SA7 复证 |
| AC-3 | Overflow discards only unsent increments for the affected namespace, enters needs-resync, and preserves already accepted local Y.Doc state. | ✅ | 溢出处置（discardQueued + needsResync + live/deferred 分派）逐字不动——只纠正**触发边界**（R2-3）；编码了缺陷边界的 3 个既有用例（ac6/F1/⑧a）按 review 强制蕴含各 +1 笔写适配，溢出后断言（RESYNC=1/needs-resync/round 修复）全部保持（SA1 §4.3 数值走查 + SA2 独立复核 + 106/106 绿） | SA3 实现 + 测试适配 |
| AC-4 | Connection scheduling prioritizes control/error/ACK and round-robins data with at most one frame per namespace per turn. | ✅ | RR wheel/control 恒先零改动（SA4 scope）；R2-5 对抗测试（hot 永久积压下 normal 6/6 获发并到达）转绿（sa6-r2-final-vitest exit 0） | 守卫回归 |
| AC-5 | Connection total-pressure recovery selects queued namespaces for resync while preserving a control-frame reserve; reserve exhaustion is a classified connection failure. | ✅（本轮强化） | **R2-4 修复 = 独立保留额度归位**：controlReserveBytes 契约面四点（types/defaults/validate/backpressure 判据），缺省 64KiB 与旧 lowWater 缺省逐值相等（零漂移，SA7 真实 TCP 受控差分实证 B 用例旧实现同绿）；耗尽 = CONNECTION_BACKPRESSURE(1011)（红锚 R2-4 生效转绿：ERROR×1 + 1011 + backoff + 区间守卫三重钉死）；连接 shed 不动 | SA3 实现 + SA7 真实链路复证 |
| AC-6 | WebSocket bufferedAmount high/low-water gating uses the Cordis scheduler and never blocks the Runtime sequencer. | ✅ | lowWater/highWater 水位迟滞语义纯化保留（backpressure.ts observeWater/poll 两处读取不动——§17 L492 字面）；poll 1000ms 经注入 ReplicationTimer、不进 sequencer 结构属性不变；R2-5 阶段 2 断言本地写全接受（peer n=208，sequencer 不阻塞） | 守卫回归 |
| AC-7 | Tests demonstrate fairness, no starvation, independent namespace failure, queue/window limits, reconnect repair, and bounded memory under adversarial traffic. | ✅（本轮补缺口） | **R2-5 = 本 AC 的覆盖缺口补齐**：fake scheduler 持续对抗生产测试落盘（永久 hot vs normal：no-starvation + 有界 queue/connection memory + 溢出收口 + 恢复 round 收敛）；SA7 抽查点 3 补 R2-1 直发 in-flight>0 变体；既有演示面（D1–D5、红锚 4 例）全绿 | SA6 落盘（直绿）+ SA7 加固 |

## B. 本轮复审反馈 R2-1~R2-5（修复验收）

| # | 反馈（摘要） | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| R2-1 | HIGH：超大 UPDATE 静默丢失且不触发 resync | ✅ | sendAndRegister 入口超限判别 + 队尾（队列空）响亮收口（needsResync + declareLocalResync → RESYNC_REQUIRED{send-queue-overflow} + 恢复 round 收敛）；红锚 R2-1(队列)/(直发) 双例转绿；SA4 回退复现恰 8 红（失败锚 = RESYNC 缺席）实证闭环；D4 活性测试零适配保持绿（队非空 F4 语义钉死） | SA1 设计 §2（三路径抉择：resync 路径）+ SA3 实现 + SA4/SA7 复证 |
| R2-2 | MEDIUM：sequence 耗尽发送重复序列号 ERROR | ✅ | 双侧 onSequenceExhausted 删 0xffffffff ERROR 直发、仅 close(1008)（§14「framing 不可信→直接 close」字面）；红锚 R2-2(peer)/(hub) 转绿（序列严格递增 + 零 ERROR + close 1008 + blocked/closed）；encodeMessage/codecFieldLimits grep 门禁通过（SA4 §E3） | SA1 设计 §3 + SA3 实现 |
| R2-3 | HIGH：queued limits 错误计入 in-flight UPDATE | ✅ | overflows() 只计 queued.length/queuedByteCount + incoming（§17 L479-486 分列 + L488「未发送队列」字面）；红锚 R2-3(count)/(bytes) 转绿；3 个编码缺陷边界的既有测试适配（review 强制蕴含，非软化——溢出后断言全保持） | SA1 设计 §4 + SA3 实现 |
| R2-4 | MEDIUM：control-frame reserve 错用 lowWater | ✅ | ReplicationLimits +controlReserveBytes（缺省 64KiB 零漂移）+ validate 构造期响亮校验（零 clamp）+ sendControl 谓词换独立字段；lowWater 收窄为纯水位迟滞（§17 L492）；红锚 R2-4(独立性)/(生效) 转绿（含 §5.6 区间守卫锚修正——SA2 R1 CRITICAL → SA1 钉死 → SA2 R2 接受偏差）；D3a/D3c 各 +1 行适配；SA7 真实 TCP 零漂移差分实证 | SA1 设计 §5 + SA3 实现 + SA7 真实链路 |
| R2-5 | MEDIUM：AC7 缺持续对抗流量测试 | ✅ | R2-5 用例落盘（fake scheduler；三阶段：永久 hot 积压下 normal 全获发 / 超上界对抗生产溢出收口有界 / 释放后恢复 round 收敛）；当前实现直绿（RR 公平已满足——缺口是覆盖而非实现）；106/106 全绿 | SA6 落盘即修复 |

## 结论

**AC-1~AC-7 全部 ✅（语义保持/强化），R2-1~R2-5 全部 ✅，无 ❌ 条目，无需追加派发。**

- 验证基线：commit 58150ad → HEAD（34bbfba 修复 + c95c088 守卫修订）；工作区另有 SA7 新增 2 测试文件（transport/supplement，106/106 绿含其 3 用例）待随收尾 commit 入库。
- 关键退出码（.mabf-bg/ 落盘）：sa6-r2-final-vitest=0（15/103）、sa7-r2-full-vitest=0（17/106）/sa7-r2-tsc=0/sa7-r2-diffcheck=0/sa7-r2-r24-hubn=0/sa7-r2-transport=0；SA4 红绿复现（回退 58150ad → 恰 8 红）。
- 事故留痕：SA4 红绿复现实验的暂态恢复窗口缺陷（无 trap）→ 总控巡查发现 → SA4 restore 修复 + 复跑 + 报告追记（sa4_review.md「状态事故与修复」节 / sa7_report.md 第〇节）；SA7 verdict 仅依据干净态证据。
- 非阻断移交：push 后需补 CI run 的 Tests/Test Files 摘录完成动态触发闭环（sa7_report.md 抽查点 4；CI 到绿由 Host/runner 接管）。
