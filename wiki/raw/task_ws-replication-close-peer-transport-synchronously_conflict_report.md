# 冲突门禁报告

**被审对象**：任务简报 `wiki/raw/task_ws-replication-close-peer-transport-synchronously.md`（issue #168，Bug 修复：peer 侧 HELLO 超时同步关闭旧 transport）
**门禁类型**：前置门禁（SA 派发前）
**产出时间**：2026-08-30（SA8）

## Verdict

`clear`

## ADR 盘点

> 基准来源：worktree `docs/adr/0001–0009` 全文逐份读取；**ADR-0010 及其引用的 wire contract、
> CONTEXT.md 复制术语块不在本 worktree 基线**（main @ `b264aae`），读取自 phase-5 分支线最新版
> `origin/docs/phase-5-websocket-replication`（head `ffca4f6` = PR #185；ADR-0010 末次修订
> `e653adf` = PR #180）。已核对 origin/main 与基线同点，仓内无更新的 ADR 版本。

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 单一真相源 | accepted（2026-08-19/21 修订） | 否 | schema 引擎域；hello-timeout transport 关闭不触及 |
| 0002 | 重写定位、authority 出范围 | accepted | 弱 | 后果实明「同步协议细节…PRD 必须显式划定」——ws-replication 行为由 phase-5/ADR-0010 管辖，本 ADR 无约束条款；无冲突 |
| 0003 | 求值器与派生 schema | accepted | 否 | 无关联 |
| 0004 | vfsl-protocol 类型投影 | accepted | 否 | 无关联 |
| 0005 | 投影生成管线 | accepted | 否 | 无关联 |
| 0006 | 持久化 DocPersistence | accepted（#64/#79 两节增补修订） | 否 | DocHandle/lease/flush 域；transport close 不经 persistence seam；无冲突 |
| 0007 | 逻辑校验与 Yjs runtime bridge | accepted（Runtime/open/read 条款被 0008 取代） | 否 | 剩余有效条款（零写/校验/detached 构造）与 transport 生命周期无交集；无冲突 |
| 0008 | NamespaceRuntime 读写能力与单序列器 | accepted（#93 稳定码注册修订） | 否 | 其 close()/停接纳/`RUNTIME_*` 码域是 **Runtime** 生命周期词汇；peer WS transport 非该域，任务未借用/未冲突这些码；无冲突 |
| 0009 | Registry、租约与 Host 生命周期 | accepted（entry key 条款被 0010 修订为仅 namespaceId） | 否 | 无关联（含被 supersede 的条款亦无关）；无冲突 |
| 0010 | Hub/Peer WebSocket Y.Doc 复制 | accepted（修订至 issue #172；**worktree 基线缺失，自 phase-5 分支读取**） | **是** | 唯一管辖 ADR。逐条对照见下——任务要求与其正文、#161 round 2 修订节及经「唯一wire contract」条款纳入的 `docs/protocols/instance-replication-v1.md` 一致；无冲突 |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| （无） | — | — | — | — | — |

无冲突点。关键正向核对（修复方向 = 对齐既有决策，而非推翻）：

1. **wire contract §18 明文支持**：`docs/protocols/instance-replication-v1.md` §18（经 ADR-0010
   正文「以…为唯一wire contract」纳入基准）明文「**HELLO/pong timeout关闭连接**」。现状实现
   （peer hello 超时进 backoff 但不关旧 transport、依赖 hub 侧 HELLO_TIMEOUT 回挡收口）是与该
   条款的偏差；本修复使实现对齐条款。
2. **R4 detach 序列是已登记决策**：ADR-0010 #161 round 2 修订节登记「peer pong 超时
   close(1001) + 代际安全脱离后重连」。任务要求「经既有 pong-timeout detach-close 序列（或等价
   guarded helper）同步关闭」是**复用已登记机制**，不新增决策面、不改 wire 冻结值。
3. **状态机迁移不变**：协议 §15.1 peer 状态机「handshaking ├─ timeout/temporary-close →
   backoff」保持——修复只关 transport，不改变状态迁移与 backoff 语义；「确保恢复仍可用」与
   「关键恢复纪律为：连接断开即close sessions/release Leases…重连重新OPEN并reconcile」同向。
4. **无 superseded 冲突**：被部分取代的 ADR-0007（Runtime/open/read 条款）/ADR-0009（entry
   key 条款）中与任务可能沾边的条款均不构成约束。
5. **观测词表零新增**：backoff reason `hello-timeout` 已在协议观测面注册，修复沿用既有词。

## 结论

**放行（clear）。** 任务要求与 ADR 全集 + CONTEXT.md 无任何冲突；四级裁决分布：
no-conflict × 全部条目、override-declared × 0、evolution × 0、hard-violation × 0。

### 需总控注意的非冲突事项

1. **【重要·工作区基线错位】本 worktree 检出基线（main @ `b264aae`）不含
   `packages/ws-replication/`**（该包及其测试只存在于 phase-5 分支线，最新 head
   `origin/docs/phase-5-websocket-replication` = `ffca4f6`/PR #185），也不含 ADR-0010、
   CONTEXT.md 复制术语块与 `docs/protocols/instance-replication-v1.md`。SA1/SA3 在当前基线上
   无法工作（`peer-connection.ts`、`onPongTimeoutDetached`、SA7 D5 锚测试均不存在）。任务分支
   `refactor/ws-replication-close-peer-transport-synchronously-` 需先重定基到 phase-5 分支线，
   或由 Host 重建 worktree。本事项属工作区状态，**不构成 ADR 冲突**，故不影响 verdict。
2. **SA1 设计注意点（非冲突，已录入相关决议文档）**：
   - detach 序列次序纪律（§18）：epoch 必须在调用可能同步重入的 transport `close()` **前**失效；
   - peer 本地 hello 超时是无 wire 帧的内部路径（同 `PONG_TIMEOUT` 注册姿势）；错误注册表
     `HELLO_TIMEOUT→1002` 属连接级 wire ERROR（hub 侧回挡）码域——若复用 pong 序列则 close(1001)
     与「临时失败→backoff」分类一致，设计文档应显式陈述该码域归属，避免 SA2 误判；
   - 「dial-throw / onClose 冻结行为」是 PR #165 round 2 任务域冻结（wiki/raw，非规范），按
     ADR-0010 #172 修订第 2 条以任务约束对待即可；
   - 恢复路径（重拨 → HELLO → ready → live）不得改变 §15.1 状态机迁移与「不保留outbox」纪律。

### 产出文件

- 相关决议（全链 SA 复用）：`wiki/raw/task_ws-replication-close-peer-transport-synchronously_relevant_decisions.md`
- 本报告：`wiki/raw/task_ws-replication-close-peer-transport-synchronously_conflict_report.md`
