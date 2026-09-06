# 红灯验收契约重新固话报告 — Issue #226（acceptance-contract 修订轮，SA8 conflict 裁决 R1/R2/R3 落地）

- 任务：Issue #226（bugfix）— `wiki/raw/task_issue-226.md`（Parent PR #142）
- Worktree：`/home/wangjian/nomicore-fix-issue-226`（branch `mabf/issue-226`，HEAD `45a22f0`）
- 输入：`task_issue-226_design.md`（SA1 design iteration 4，§10 修订集 R1–R4）、`task_issue-226_design_conflict_report.md`（SA8 conflict gatekeeper：C1/C2/C3 成立，R1/R2/R3 阻断、R4 推荐；路由 = SA6 重新固话 → SA8 conflict recheck → SA3）
- 本轮性质：**只修订/固化可执行的红灯验收契约**（含随票翻转的 #155 SA7 C1 应用层 E2E 锚）；零生产代码改动、零绿灯基线改动（#149/#150 未触碰）。
- 时间：2026-09-06（本地会话轮）

## Verdict

**clear**（修订后契约自洽、仍准确覆盖 #226：修复前全红证据见 §4；修复后翻绿的机制证明见 §2 各锚修订说明 + SA8 §10.4 证明保持；#149/#150 相邻绿灯基线零漂移）。`requiresConflictRecheck: false`（移交 SA8 对本报告 §2 修订锚与冲突报告 N2/N4 的 recheck 属下游例行门禁，非本轮遗留冲突）。

## 1. 修订清单（对照 SA8 裁决）

| # | 对象 | 修订内容 |
|---|---|---|
| R1 | `packages/namespace-registry/test/registry-issue-226-red.test.ts` T8/T9/T10 | 顺序锚改「到达 poll + 顺序」：先 `expect.poll` 等存储完成标记**到达**（poll 让出事件循环 → macrotask drain 执行），再断言 `indexOf(结算标记) < indexOf(存储完成标记)`；墙钟降旁证保留。修复前（槽内同步存储）标记先于结算标记 → 仍红 |
| R2 | T12/T13 迁入 registry 红契约（原 `runtime-issue-226-red.test.ts` 删除） | 原 runtime 红契约把慢 emitter 直注 Runtime 冻结 seam——「Runtime 零生产改动 + #149 AC4 `emitCalls===2` 同步锚」下同一 Runtime 代码不可同时满足（SA1 §10.2 / SA8 C2），且其顺序锚在任意实现下不可满足（SA1 §10.1 / SA8 C1）。修订：改经 **Registry 生产装配全链路**注入（默认 runtimeFactory = `createNamespaceRuntimeForRegistry` + resolver 产出的 emitter——#226 修复的实际改动面，即「生产 wiring 同构」）；判据同 R1 形状 + 墙钟旁证。Runtime 红契约文件删除（Runtime 零改动前提下其直注用例永不可翻绿，保留即永不绿的不满足契约） |
| R3 | `apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts` C1 用例 | 三锚改 #226 后语义：B（Persistence 运营失败，建流前结局）以 NS_B 归属落 B 自己的流（1 条 attempt：stage `transaction`、code `NAMESPACE_CREATE_FAILED`、result `rejected`）、`namespaces/NS_B` 目录存在、全程 unattributed 丢弃 0；A 流干净面（恰 genesis+#17、segment 无 B marker、replay complete/issues=[]）保持。C1 现为 #226 全量门必红面（修复前红、修复后绿） |
| R4 | `registry-surface.test.ts` §2.M 注释固化 setImmediate 许可 | **本轮未落地**（推荐项、零正则改动、守卫不命中 setImmediate——不构成剩余冲突）；移交 SA3 泵实现轮随实现一并补注释 |

## 2. 修订锚的判定机制与「修复前仍红」证明（逐锚）

- **T8（create 结算不等日志存储）**：`create:settled` 在 `await create` 续段同步 push；poll 等 `initStream:<ns>:end` 与 `emit:<ns>:1:end`（成功 create 的 #17 committed = 通道第 1 条 emission）到达后断言顺序。修复前：两标记在槽内先于 `create:settled` → 顺序红（`indexOf` 反序）；墙钟 `createMs < 120` 红（≥240）。修复后：槽内仅 O(1) 入队 → 标记由 drain 迟到产生 → poll 通过后顺序绿、墙钟绿。**红→绿翻转由 drain 是否存在决定——槽内同步（红）vs macrotask 延迟（绿）是 #226 隔离载体语义本体。**
- **T9（shutdown 不等日志存储）**：`shutdown:settled` 在 `await shutdown` 续段 push；poll 等 `initStream:<ns>:end` 到达后断言顺序。修复前：已接纳 create 槽内 200ms 建流先于 shutdown 结算 → 红。修复后：drain 与 shutdown 零耦合（ADR-0011 L129）→ 迟到 → 绿。
- **T10（open 不等 adapter 构造）**：修复后 open 槽对日志只做 O(1) 捕获，ensure（reopen/repair/retention sweep）推迟到首个 emission 的投递 drain——用例先经一次 lease 写驱动该 emission，poll 等 `ensure:<ns>:end` 到达后断言 `open:settled` 在前。修复前：ensure 在 open 槽内（factory 第三参现场解析）→ 先于 `open:settled` → 红；`openMs < 75` 红（≥150）。
- **T12（下一业务写槽不被慢 emit 推迟；B3 write-sequencer 窗口隔离）**：成功 create 后 `lease.mutateData` ×2（#17 = 通道第 1 条 emission → w1 = `emit:<ns>:2:*`、w2 = `emit:<ns>:3:*`——序号与投递批次无关，poll 容忍合法延后）；`writes:settled` 在 w2 续段同步 push；poll 等 `emit:<ns>:2:start` 到达后断言顺序；墙钟 `gap < 50`。修复前：emit 在 w1 槽结算链内同步执行 → 先于 w2 结算 → 顺序红、gap ≥100 红。修复后：生产 wiring 的 wrapper 使 emitSlot 调用为 O(1) 入队 → drain 迟到执行 → 绿。**#149 AC4（直连注入计数 emitter、零 yield 同步断言）不经 wrapper → 零漂移（本轮实测 14P，§4）。**
- **T13（shutdown/close barrier 不被慢 emit 延长）**：在途 lease 写 + 立即 `registry.shutdown()`（Runtime close barrier 排空已接纳写槽）；`shutdown:settled` 在续段同步 push；poll 等 `emit:<ns>:2:end`（在途写的 emission 完成）到达后断言顺序；墙钟 `shutdownMs < 50`。修复前：emit 在写槽结算链内先于 barrier → 红。修复后：wrapper O(1) + drain 与 shutdown 零耦合 → 绿。
- **C1（#155 SA7，R3）**：B 的 drop 计数断言（恰 0）与投递到达时机正交（drop 只会多不会少）；A/B 流的目录/记录断言全部 poll 化（修复后建流与落盘异步到达——poll 让出事件循环驱动 drain）。修复前：B 落 1 条 unattributed drop 且无目录 → 红（确定性、首个断言即红）。修复后：B 归属落盘 → 绿。

## 3. 修订后契约形态（13 用例全集，全部在 registry 红契约文件）

| 用例 | 修复前（本轮实测） | 修复后（机制证明） |
|---|---|---|
| T1–T6 建流前早结局归属 | 红（ns 通道 0 条） | 绿（泵以候选 ns 数据键控投递 + 内容锚同位） |
| T7 GREEN 对照（#17/#18） | 绿（唯一通过） | 保持绿（poll 容纳延迟投递） |
| T8/T9/T10 隔离（create/shutdown/open） | 红（顺序反序 + 墙钟） | 绿（drain 迟到 → poll 后顺序成立） |
| T11 File adapter E2E（被拒 create 落盘） | 红（无目录） | 绿（initStream(ns, undefined) 建流 + attempt 落盘） |
| T12/T13 写路径隔离（迁移） | 红（墙钟 ≥100 + 顺序反序） | 绿（生产 wiring wrapper → 槽间窗口 O(1)） |

## 4. 本轮运行证据（后台 Job）

| 套件 | 命令 | 结果 |
|---|---|---|
| 修订后红灯契约 | `pnpm test packages/namespace-registry/test/registry-issue-226-red.test.ts` | **12 failed \| 1 passed (13)**，Type Errors 0（T7 唯一绿）。失败形态：T1–T6/T11 到达 poll 超时（ns 通道 0 条 / 无目录）；T8 `expected 6 to be less than 3`（顺序锚——poll 即刻通过后反序）；T9 `expected 6 to be less than 3`；T10 `expected 2 to be less than 1`；T12 墙钟 `146ms > 50`；T13 墙钟 `105ms > 50`。Duration 23.82s |
| #149+#150 相邻绿灯基线 | `pnpm test registry-create-diagnostic-red.test.ts runtime-root-schema-diagnostic-red.test.ts` | **30 passed (30)**，Type Errors 0（零漂移——#149 AC4 `emitCalls===2` 同步锚保持） |
| #155 SA7 应用套件 | `pnpm test apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts` | **1 failed \| 5 passed (6)**，Type Errors 0——C1 在新红锚 `dropsEarly length 0` 处确定性失败（修复前恰 1 条 unattributed drop）；C1b/M2/mirror/fatal/D8 全绿（C1 属 #226 全量门必红面，修复后翻绿） |
| yjs-server typecheck | `tsc -p apps/yjs-server/tsconfig.json` | exit 0，无类型错误（含 test 目录——C1 修订类型面） |

## 5. 本轮边界与移交

- **零产品代码改动**（`src/**`、`apps/yjs-server/src/**` 未触碰）；#149/#150/其余绿灯测试零改动；git 操作零执行（两个红契约文件与 #155 SA7 测试文件均未跟踪——本轮只改这三个文件 + 本 wiki 文件 + dispatch 日志）。
- **结构性变更登记**：`packages/namespace-runtime/test/runtime-issue-226-red.test.ts` 删除（T12/T13 迁入 registry 红契约；§1 R2 理由）。
- **移交下游**：
  1. SA8 conflict recheck：对修订后契约（本报告 §2 各锚 + 冲突报告 N2「T13 单锚证明精度勘误在 poll 形状下免疫」、N4「genesis-less 流只锚目录 + attempt 可读」复核——C1 已按该边界落锚）。
  2. SA3 实现门：修订后红契约 13 用例全绿 + 相邻基线保持 + C1 翻绿；R4 注释随泵实现一并落地。
- 结构化结果：verdict `clear`、`requiresConflictRecheck: false`；artifactPaths = 本文件 + 三个修订测试文件。
