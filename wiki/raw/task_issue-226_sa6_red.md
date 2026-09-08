# SA6 红灯验收契约固化与审计报告 — Issue #226 创建诊断覆盖与日志生命周期隔离（acceptance-contract, iteration 0）

- 任务：Issue #226（bugfix）— `wiki/raw/task_issue-226.md`（任务类型 `bugfix`，Parent PR #142）
- Worktree：`/home/wangjian/nomicore-fix-issue-226`（branch `mabf/issue-226`，HEAD `45a22f060eee924e4ed6a2d6fa64fb7cd6b2db08`）
- 本轮：acceptance-contract（SA6）固话/审计轮。关联 dispatch `sa-696664e0`（round 7 / iteration 0），durable correlation state 由 Host 管理。
- 输入产物：既有红灯契约两文件（`packages/namespace-registry/test/registry-issue-226-red.test.ts` 622 行、`packages/namespace-runtime/test/runtime-issue-226-red.test.ts` 165 行，均未跟踪、未入库）、`task_issue-226_sa5.md`、`task_issue-226_conflict_report.md`（SA8 clear）、`20260905-bug-issue-226*.md`（首轮 + verify2–6）。
- 本轮性质：**审计既有契约是否覆盖 AC、在当前基线可执行且确实复现 Issue #226；只在必要时修正。不得实施生产修复。**
- 审计结论（TL;DR）：**契约完整覆盖 AC1–AC5 所需行为面，判据确定、Host 形状忠实、边界有 GREEN 对照、修复可翻绿；基线重跑红灯稳定复现（12 failed | 1 passed），相邻绿灯基线全绿（30 passed）——契约无需任何修正，可作为下游修复验收基线。零产品代码改动、契约零改动。**

## 1. 基线复现证据（本轮后台 Job 实测）

```bash
# 红灯契约（可执行复现载体）
pnpm test packages/namespace-registry/test/registry-issue-226-red.test.ts \
          packages/namespace-runtime/test/runtime-issue-226-red.test.ts
# Test Files  2 failed (2)
#      Tests  12 failed | 1 passed (13)
# Type Errors  no errors        （RED_EXIT=1，预期红灯；Duration 12.19s）

# 相邻绿灯基线（环境健全性对照）
pnpm test packages/namespace-registry/test/registry-create-diagnostic-red.test.ts \
          packages/namespace-runtime/test/runtime-root-schema-diagnostic-red.test.ts
# Test Files  2 passed (2)
#      Tests  30 passed (30)
# Type Errors  no errors        （BASELINE_EXIT=0；Duration 5.04s）
```

失败形态（与既有八轮证据逐项一致，无环境噪声）：

| 用例 | 实测形态 | 缺陷链 |
|---|---|---|
| T1–T6（schema-compile / validation / input-snapshot / Persistence 运营 / Persistence fatal committed:true / create-document-internal fatal） | ns 数据键控通道 `expected +0 to be 1`（`waitNsRecords` L279 1s poll 超时包裹） | A |
| T7 GREEN 对照（#17 committed / #18 runtime-construction fatal 已正确归属） | **通过（28ms）** | 边界证明（缺口 = `initStream` 之前） |
| T8 create 结算不等日志存储 | `expected 6 to be less than 3`（registry L471 顺序锚） | B1 |
| T9 shutdown 不等日志存储 | `expected 6 to be less than 3`（registry L504） | B1 |
| T10 open 结算不等 adapter 构造 | `expected 2 to be less than 1`（registry L531） | B2 |
| T11 被拒 create 零落盘 | 候选 ns 目录 poll `expected false to be true`（registry L615；成功 create 落盘 GREEN 对照先行通过） | A（落盘面，真实 File adapter） |
| T12 下一业务写槽不被慢 emit 推迟 | 墙钟 101ms > 50ms 阈值（runtime L126）＋顺序锚同判据族 | B3 |
| T13 close 不被慢 emit 延长 | 墙钟 102ms > 50ms 阈值（runtime L159） | B3 |

`git status --short` 确认 tracked 树零修改（`git diff --stat` 为空）；红灯归因于 #226 新增用例而非基线损坏——绿灯基线 30/30 佐证环境健全。

## 2. AC 覆盖审计（逐条对照任务简报）

简报 AC 共 5 条；其中 AC5 明文要求契约覆盖的具体行为面逐一有对应红灯用例并实测复现修复前失败：

| AC5 要求面 | 用例 | 断言锚（当前红线） | 状态 |
|---|---|---|---|
| 创建早期拒绝 | T1 schema-compile / T2 validation / T3 input-snapshot / T6 create-document-internal fatal | 结局须以候选 ns 归属到达数据键控通道（`waitNsRecords`），`unattributedDrops === 0` | ✅ 红（复现） |
| Persistence 失败 | T4 运营失败（`NAMESPACE_CREATE_FAILED`）/ T5 fatal committed:true | 同上，T5 另保留 `committed:true, effect:'update'` 事实 | ✅ 红（复现） |
| post-commit fatal | T5（post-commit fatal）、T7(b) runtime-construction fatal（GREEN 对照） | T5 红 = 建流前 fatal 被丢；T7(b) 绿 = 建流后 fatal 已归属 → 边界钉死在 `initStream` 之前 | ✅ 红（复现） |
| 慢同步 adapter（Registry carrier 面） | T8 慢建流+慢 append 不延长 create / T9 不无限延长 shutdown / T10 open 槽 adapter 构造（reopen/repair/retention sweep）不延长 open | 顺序锚：业务结算标记须先于 `initStream/emit/ensure:<ns>:end`（事件迹 `indexOf`），墙钟阈值取注入阻塞一半以下仅旁证 | ✅ 红（复现） |
| 慢同步 adapter（Runtime sequencer 面） | T12 下一业务写槽推进 / T13 close barrier | 顺序锚 + 墙钟（101/102ms > 50ms 阈值；注入阻塞 100ms） | ✅ 红（复现） |
| shutdown | T9（Registry shutdown 等待已接纳 create）/ T13（Runtime close barrier） | T9：shutdown 结算先于日志存储完成；T13：close 结算先于慢 emit 完成 | ✅ 红（复现） |
| 证明修复前行为会失败 | 全表 | 12F\|1P（T7 为唯一绿 = 边界对照） | ✅ |

其余 AC 的行为锚定：

- **AC1（归属不丢）**：T1–T6 覆盖 Registry 建流前全部发射面（emission site 共享、阶段不敏感——任一建流前结局都只走无归属共享通道），T11 以真实 File adapter 覆盖磁盘落盘面（被拒 create 零文件 vs 成功 create genesis+attempt 落盘的 GREEN 对照）。`duplicate` 结局在 AC1 明文中与 input/schema/validation/Persistence 并列——按既有裁决（SA5 §6 / verify6 §3 登记面）：entry 碰撞候选重试与 Persistence `DOC_DUPLICATE` 重试零发射（#150「恰一条最终结局」覆盖重试成功场景），id 预算耗尽 fatal 仅 observer 事件、零诊断发射——二者均非「被无归属通道丢弃的发射」，属登记面而非红灯对象；若下游设计为耗尽时发射终局拒绝，其发射面与 T1–T6 同一共享通道，机制上已被覆盖。审计维持该登记，不需为 duplicate 增写场景用例。
- **AC2（输入零访问 / detached snapshot 纪律）**：行为红灯可锚的发射面部分已在 T1（`e.input.snapshot` = 接纳时 detached 快照、`observedAt` 同源注入 Clock）、T3（cycle-safe 拒绝 → `status:'unsafe-input'`，发射面不读回敌意输入）锚定；创建路径 acceptance/capability gate 侧的「输入零访问」是生产代码纪律，属设计（SA1）与静态审查（SA4）把关面，非修复前失败可复现的行为面——契约边界如实登记，不越界增锚。
- **AC3/AC4（隔离 + 业务结果隔离）**：T8–T10、T12–T13 锚定「日志 I/O 不在业务关键路径」；每个红用例的业务面 GREEN 锚先行通过（ok lease / 稳定窄 issue / branded fatal + committed 事实 / FIFO 与终值 3 / shutdown 正常聚合）——证明业务结果不被日志缺陷影响，红灯只锚「归属到达」与「关键路径不延长」两个行为面。

## 3. 契约有效性独立判定（六项，均成立）

1. **判据确定性**：主判据为事件迹顺序断言与 ns 通道到达 poll，免定时器抖动；墙钟仅旁证（阈值 = 注入阻塞一半以下，余量 ≥2×）。
2. **Host 形状忠实**：registry 红测试 `makeProductionShapedHost`（L191–238）复刻生产供应方 `apps/yjs-server/src/diagnostics.ts` 语义（共享通道恒丢弃+计数 / `runtimeEmitterFor(ns)` 数据键控 / `initStream(ns, bytes)` 建流）；runtime 红测试以冻结 seam `diagnosticEmitter`+`clock` 成对注入慢同步 emitter；慢存储模拟位于 Host 供应方侧，与生产分层一致。
3. **边界有 GREEN 对照**：T7 与 T11 前半钉住缺口边界 =「`initStream` 之前」，不误伤已工作面。
4. **业务隔离面被守护**：各红用例业务面锚先行执行并通过。
5. **poll 消除合法延后伪红**：`waitNsRecords` 1s poll 允许修复后 emission 合法延后（ADR-0011「emitter 不被 await」）。
6. **修复可翻绿**：断言面 = AC 明文行为面，不锚定实现形态；延迟同步 append 或 queue/batch 载体的合规修复均可翻绿。

实现约束（移交下游，维持既有登记）：T9/T13 顺序断言要求日志 I/O 排程不先于 shutdown/close 结算续段——微任务级 deferral 不足，须 macrotask/queue 级搬移或异步化。另维持 SA5 §7 六条红线（seam 字段名冻结 / 词表与 schema 冻结、早结局补记不得冒充 genesis 或伪称重放连续 / 早结局归属通道形态与隔离载体形态为核心设计点 / shutdown 公共契约不变 / 不得引入第二个业务排序机构）。

## 4. 本轮边界与产出

- **零产品代码改动**：`src/**` 与既有测试零改动（tracked 树 clean）；红灯契约两文件本轮零改动（审计结论：无需修正）。
- **未派发新 SA**：本轮为 acceptance-contract 固话/审计轮；durable records 中无新增 dispatch。
- 运行证据：后台 Job `bash-1`（红灯 12F|1P，RED_EXIT=1）与 `bash-2`（基线 30P，BASELINE_EXIT=0）完整输出；关键摘录见 §1。
- 本文件：`wiki/raw/task_issue-226_sa6_red.md`。
- 派发日志已补记一行。
