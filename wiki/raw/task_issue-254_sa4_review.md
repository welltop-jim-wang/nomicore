# SA4 实现评审报告 — issue #254：周期 reconciliation 超时 failed/needs-resync 僵尸的协议合规自愈

**Date**: 2026-09-08
**Verdict**: **approve** —— 方向 A 修复经逐行源码核对与设计（SA1 §8.1 草图逐字比对）、SA6 契约、SA8 门禁/复审条款、SA2 必改项全部闭合；无 BLOCKER/MAJOR finding。2 个超出 ALLOW LIST 的测试文件改动经独立核查为「设计硬门必然牵连 + 设计 §13 风险 1 预登记口径内的确定性收敛」，纯增量、零断言弱化、透明申报，判为可接受偏离（Non-blocking observations N1/N2）。4 条 MINOR 观察项与 3 项后续动态验证项登记如下。

---

## 1. Reviewed inputs

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-254.md`（简报，issue #254 open；AC1–AC6） | 已读 |
| `wiki/raw/task_issue-254_sa6_contract.md`（红灯契约，红 10/10）+ `packages/ws-replication/test/ws-replication-issue254-ac-red.test.ts`（冻结） | 已读，契约文件完整性核验（见 §9） |
| `wiki/raw/task_issue-254_design.md`（SA1 iteration 0，方向 A） | 已读 |
| `wiki/raw/task_issue-254_sa2_review.md`（approve 有条件；F1/F2 P1、F3 P2、F4/F5 P3） | 已读 |
| `wiki/raw/task_issue-254_sa8_gate.md` / `task_issue-254_sa8_recheck.md`（clear / clear；R1/R2 advisory） | 已读 |
| `wiki/raw/task_issue-254_sa3_impl.md`（SA3 实现报告） | 已读 |
| `wiki/raw/task_issue-254_ac_red.log` / `_ac_red_stability.log`（SA6 红灯原始日志） | 已读（tail 核验：`2 failed | 3 passed` ×10，Type Errors: no errors） |
| 实际 diff：`git diff`（10 个已修改文件）+ 2 个未跟踪测试文件 | 全量逐行审查 |
| 相关基线源码：`peer-namespace.ts`、`peer-connection.ts`、`types.ts`、`index.ts`、`defaults.ts`、`testing.ts`、`test/driver.ts`、`test/harness.ts` | 按锚点复核 |
| 规范：`docs/protocols/instance-replication-v1.md`（§1/§13.2/§14/§15.1/§16/§18/§21/§23.1）、`docs/adr/0010`（L90/L151/L165/L179 + 修订节）、`docs/adr/0012` L36、`CONTEXT.md`、root/`packages/ws-replication` AGENTS.md、`vitest.config.ts`、`.github/workflows/ci.yml` | 已读 |

Issue comments REST 读取为空（SA6/SA1/SA8/SA3 四方同证）——无 owner 反馈项适用。

评审方法：静态实现审查（SA4 不运行测试/服务）；全部结论以源码、diff、配置与已归档日志为证据；无法静态确认者入 §11 后续动态验证项。

## 2. Verdict

**approve**。理由概述：

1. **设计落实零缺项**：SA1 §8.1 接口草图与实际 diff 逐字一致（facet 声明/装配、`onTimerFired` 尾部 `intent==='active'` 门分派、三门 `onNamespaceRecoveryRequested`、`detachCloseTimedOutTransport` reason 闭合第三调用点、`onTemporaryFailure('namespace-recovery', true)`、死块删除、types.ts 双镜像追加）。
2. **协议不变量保持**：§13.2 `NAMESPACE_TIMEOUT → failed` 映射零变更；复活唯一入口 `openActiveTargets`（新代 ready）零改动；恢复触发分派在生产代码中**恰有一个调用点**（`peer-namespace.ts` L1531，timer 族尾部）——错误帧/registry 拒绝路径结构性排除，SA2 F2 的 timer 族谓词与实现行为逐字同域。
3. **SA2 五项 finding 全部落实**（F1/F2 于 normative 文本、F3 场景 5 负控、F4 双环形 ADR 注记、F5 属设计文件勘误不涉实现）。
4. **测试面增强而非弱化**：SA6 冻结契约未动（mtime + 断言完整性核验）；三个改版存量测试把「轮询僵尸态」升级为「事件轨迹 + 重建恢复 + 收敛 + 零 unhandled rejection」；新文件 5 场景含上下界双向 dialCount 断言（对「无动作」与「无界重拨」两类回归均敏感）。
5. **验证证据链自洽**：SA6 基线 368（含契约 5）+ 新文件 5 = SA3 报告 373；54 files = 53 个 `.test.ts` + 1 个 typecheck 面 `.test-d.ts`（root `vitest.config.ts` `typecheck.enabled: true`）；`git diff --check` 本席复验干净；typecheck 覆盖面（package tsconfig `include: test/**/*.ts`）静态核验成立。

## 3. 上游要求落实

| Requirement or finding | Implementation evidence | Assessment |
|---|---|---|
| AC1 超时后无需人工重启即可恢复 | `peer-namespace.ts` L1524-1532（finalize 后 intent 门分派）→ `peer-connection.ts` L991-1000（三门 → detach-close 1001 → `onTemporaryFailure` backoff → dialNow → 新代 `openActiveTargets` re-OPEN）；契约 A1/A2 转绿（SA3 报告 + 机制推演） | 落实 |
| AC2 不再出现 `Peer failed + Hub needs-resync + connection ready` 长期停摆 | 超时边界 peer 主动 close(1001) → hub 对称 teardown（§16），僵尸组合结构性不形成；A1/A2 断言 hub 侧回 live | 落实 |
| AC3 同一连接内终态 namespace 不重开 | 复活只经 `onConnectionLost` failed→disconnected（L772-784）→ 新代 ready → `openActiveTargets` targeted→startOpen（L690-702）；新文件/改版测试 4 处 AC3 检查器零违例断言 | 落实 |
| AC4 已接纳 apply 排空 / session-lease 无泄漏 | 恢复 = 一次受控断线，复用 `onConnectionLost` → `cleanupResources`（claim 幂等）既有纪律，零新清理路径；全部新/改测试带零 unhandled rejection + 双向收敛哨兵 | 落实 |
| AC5/AC6 确定性回归测试 + 状态/重建/收敛覆盖 | 契约文件（冻结）+ 新文件 5 场景 + 3 个改版存量场景，全部 fake duplex + 注入 timer、零 real sleep | 落实 |
| SA6 §15-4：契约只许因生产变更转绿 | 契约文件未跟踪未修改（mtime 00:33 早于全部 SA3 改动 01:14-01:24；A1/A2 恢复断言逐行在场，无 skip/only/断言改动） | 落实 |
| SA8 D1 附带义务（protocol 登记：谁触发/close code/epoch-first） | protocol §16 词条扩写 + §18 伴随句 + §15.1 注记 + ADR 0010 修订节（6 条） | 落实 |
| SA8 D2/D5（timer 族一般化划界、multiplex 风暴界） | 触发面 = `onTimerFired` 尾部单点（非 periodic 非 close 全集）；场景 3 multiplex + 场景 1/4 环率上下界 + ADR 双环形注记 | 落实 |
| SA2 F1（P1）§23.1 reason 枚举登记 | protocol §23.1 L627 行追加 `**namespace-recovery**`（标 issue #254、7→8、append-only、21 型不变）+ ADR 修订节第 4 条同款引语 | 落实（四处一致性：types.ts / peer-connection.ts / §23.1 / ADR 齐备） |
| SA2 F2（P1）§16 谓词收窄至 timer 族 | §16 新句按 SA8 复审口径 (a)：「源于 open/bootstrap/reconcile timer 超时（§13.2 NAMESPACE_TIMEOUT，本地映射）」+ wire ERROR reconnect 族显式 follow-up 声明；与 §18/§15.1/ADR 修订节第 1 条同域 | 落实（场景 5 负控实证界外零动作） |
| SA2 F3（P2）界外显式负控 | 新文件场景 5：NOT_FOUND 错误帧 → failed + ready → 60s 虚拟窗口 wires==1/dials 不变/零 `namespace-recovery` 事件 | 落实（核心形态；config 族变体未实施，见 N3） |
| SA2 F4（P3）双环形风暴界表述 | ADR 修订节第 5 条：open-timeout 环 attempts 单调至 cap（周期 →~35s）vs reconcile-timeout 环 attempts 每环清零（周期 ≈10.1s），统一上界「重拨率 ≤ 1/min(超时窗, backoff 界)」+ 告警阈值分设 | 落实 |
| SA2 F5（P3）设计文本勘误（26→25 调用点等） | 属 SA1 设计文件修订（SA3 无权改设计）；实现侧无对应代码面（仅新增 1 个分派点，未触 finalize 其他调用点） | 记录不处理（正确归属；见 N1） |

## 4. 设计落实审查

| Design decision | Implementation location | Assessment | Finding |
|---|---|---|---|
| 决策 1（方向 A：failed 终态保持 + 超时点触发重建，零 wire 字节） | `peer-namespace.ts` L1524-1532；`peer-connection.ts` L976-1000；`git diff` 无 replication-protocol/hub 触碰 | 逐字一致；`finalize('failed')` 映射不动，新增仅为 failed 之后的恢复触发 | — |
| 决策 2（触发面 = timer 族一般化；错误帧/config 族排除） | `onTimerFired` 三分支结构保持（periodic L1511-1514 早退 / close L1515-1523 收口 closed / 尾部 open·bootstrap·reconcile）；分派调用点全仓恰 1 处（grep 实证）；`onErrorFrame`（L642-661）等其余 25 个 finalize 调用点零分派 | 边界结构性成立，不依赖运行时判断 | — |
| 决策 3（走 §18 R4 detach-close + §15.1 backoff，close 1001，非 requestRebuild） | `onNamespaceRecoveryRequested` → `detachCloseTimedOutTransport(transport,'namespace-recovery')` → `onTemporaryFailure('namespace-recovery', true)`；与 pong-timeout（L455-456）/hello-timeout（L1019-1020）既有调用点同构 | 复用既有轨道零新编排；`epochAlreadyInvalidated=true` 防重复递增与先例一致 | — |
| 决策 4（触发落点 = PeerNamespaceHost facet） | `peer-namespace.ts` L58-66 接口声明 + L110 装配；`index.ts` 未导出（全文件核验）| 内部缝保持；非公共 API 变更 | — |
| 决策 5（观测面零新增事件类型，reason append-only） | `types.ts` L296-301 与 `PeerBackoffReason`（peer-connection.ts L37-47）各 7→8 值双镜像；protocol §23.1 登记 | append-only；先例 #231/#238 同款 | — |
| §8.1 顺带清理：finalize 空 `if (state==='failed'){}` 死块删除 | diff 实证（L1264-1266 删 2 行，finalize 其余行为不变） | 落实 | — |
| §8.2 状态机：`ready ├─ namespace-recovery → backoff`（既有边新实例）+ 非 ready 态 no-op | L993-996 三门（stopping/`connStateValue !== 'ready'`/transport 缺失或已关） | 与 §15.1 状态机一致，无新边 | — |
| §8.3 路线①-⑤（收口/重建/backoff/复活/旧代兑付） | 全部复用既有机制；`onConnectionLost` failed→disconnected（L772-784）、`openActiveTargets`（L690-702）、cleanup claim 幂等 | 数据流与设计表逐行对齐 | — |
| §8.4 文档变更 4 条 + SA2 F1 增补第 5 条 | protocol §16/§18/§15.1/§23.1 + ADR 0010 修订节（6 条，含双环形与 §23.1 引语） | 全部落位 | — |
| §12 验收映射（新文件四场景 + 负控 + 全量门） | `ws-replication-issue254-timeout-recovery.test.ts` 5 场景；全量/typecheck 门见 §9 | 落实（场景 3 注入形态偏离已申报，见 §10 Deviations 评估） | — |

**设计明确但实现缺失**：未发现。**实现必要偏离设计**：2 处测试文件超出 ALLOW（见 §6）；场景 3 以 open 超时实例替换 reconcile 超时注入（harness 信封洞约束，SA3 Deviations-2 已申报；断言面与设计原文一致——兄弟 ns churn 可恢复 + 双向收敛，触发族同为 timer 族）。评估：均为可接受偏离，无需设计回流。

## 5. 架构一致性与惯例

### 责任归属

| Behavior | Expected owner | Actual location | Assessment |
|---|---|---|---|
| 超时收口（namespace 域） | PeerNamespaceController | `onTimerFired` 尾部 `finalize`（既有） | 正确 |
| 重建触发判据（连接态/stopping/transport 身份） | PeerConnectionImpl（拥有连接生命周期） | `onNamespaceRecoveryRequested` 三门 | 正确（facet 由 ns 控制器请求、连接层裁决——与 `requestDataDrain`/`connectionFatal` 同族） |
| 恢复编排（detach-close/backoff/dial） | PeerConnectionImpl（ADR 0012 L36 Peer 拥有 dial loop） | `detachCloseTimedOutTransport`/`onTemporaryFailure` 既有单点 | 正确（零第二编排） |
| Hub 半区 teardown | hub-connection/hub-namespace（未改动） | close(1001) → hub `onClose` 对称收口（§16 既有） | 正确（零 Hub 变更） |

### 相似能力对照

| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
|---|---|---|---|---|
| 本端检测临时失败的连接重建 | pong-timeout（L455-456）/ hello-timeout（L1019-1020）经 detach-close + `onTemporaryFailure(_, true)` | namespace-recovery 第三调用点，逐字同构 | 一致 | 同族本地超时路径，§18 R4 纪律单点承载 |
| 配置类重建 | `requestRebuild`（close 1000 + 立即重拨） | 未复用（设计决策 3 明确选择带退避轨道） | 有意分叉（设计裁定） | 超时为可复现本端故障，需风暴界；已在 ADR 修订节登记区分 |
| observer 词表 append-only 扩展 | issue #231（`PeerBackoffReason` 7 值）/ #238（§23.1 显式登记纪律） | 8 值 + §23.1 标号登记 + api.test-d fixture 同步 | 一致 | 仓库既定三件套同步模式 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| backoff reason 词表 | protocol §23.1（规范）+ types.ts/`PeerBackoffReason`（双镜像）+ api.test-d fixture（精确闭集断言） | — | 低（四处一致；fixture `toEqualTypeOf` 精确匹配使漂移在 typecheck 即红） |
| 连接代际 | `connectionEpochValue` | 订阅闭包 epoch 门 / `isConnectionDead()` | 既有，未新增 |
| 触发面边界 | `onTimerFired` 尾部单点调用 | §16/§18/ADR 文本登记（同域） | 低（分派不可从其他 finalize 路径到达） |

### 生命周期对称性

| Start or acquire | Stop or release | Failure recovery | Assessment |
|---|---|---|---|
| 新代 HELLO_ACK → `openActiveTargets`（registry.open → 新 Lease/session） | `onConnectionLost`/`onConnectionFatal` → `cleanupResources`（session.close → lease.release，claim 幂等） | 每 ring 一受控断线；场景 2/3 多代环零 unhandled rejection + 数据收敛实证 | 对称；无新增不对称面 |
| backoff timer 武装 | `clearBackoff`/stopping 守卫/到期自清 | `onTemporaryFailure` 重入门 | 既有 |

### 平行机制检查

| Candidate duplicate | Existing path | Actual path | Disposition |
|---|---|---|---|
| 第二套 cleanup/重试编排 | detach-close + onTemporaryFailure | 完全复用 | 无平行机制 |
| 新连接级 watchdog/liveness | 无（SA6 §9 step6/7 排除） | 未引入 | 正确（设计非目标） |
| 新 wire 帧/错误码 | replication-protocol 注册表 | 零字节变更（git status 实证） | 正确 |

## 6. 文件范围审查

| Changed path | ALLOW entry | Purpose | Assessment |
|---|---|---|---|
| `packages/ws-replication/src/peer-namespace.ts` | ALLOW 行 1 | facet 声明 + 尾部分派 + 死块删除 | ✅ 界内，与预期改动逐项一致 |
| `packages/ws-replication/src/peer-connection.ts` | ALLOW 行 2 | reason 追加 + 装配 + 新私有方法 | ✅ 界内 |
| `packages/ws-replication/src/types.ts` | ALLOW 行 3 | reason 闭联合追加 | ✅ 界内 |
| `packages/ws-replication/test/ws-replication-ac4-reconcile.test.ts` | ALLOW 行 4 | §9.3 场景改版 | ✅ 界内（改版口径 = 设计 §2.2 预判） |
| `packages/ws-replication/test/ws-replication-ac3-bootstrap.test.ts` | ALLOW 行 5 | §18 bootstrap 场景改版 | ✅ 界内 |
| `packages/ws-replication/test/ws-replication-sa4-f1-f2-f3-red.test.ts` | ALLOW 行 6 | F2 场景改版 | ✅ 界内 |
| `packages/ws-replication/test/ws-replication-issue254-timeout-recovery.test.ts`（新） | ALLOW 行 7 | 5 场景验收扩展 | ✅ 界内 |
| `docs/protocols/instance-replication-v1.md` | ALLOW 行 8（含 SA2 F1 的 §23.1） | §16/§18/§15.1/§23.1 登记文本 | ✅ 界内 |
| `docs/adr/0010-hub-peer-websocket-ydoc-replication.md` | ALLOW 行 9 | issue #254 修订节 | ✅ 界内 |
| `packages/ws-replication/test/ws-replication-api.test-d.ts` | **不在 ALLOW** | 事件 union 精确匹配 fixture 单值追加 | 可接受必然牵连（见下） |
| `packages/ws-replication/test/ws-replication-issue170-r1-r4-red.test.ts` | **不在 ALLOW** | 5 处 ns-live 同步点（纯增量 6 行） | 可接受预登记收敛（见下） |

**两个超出 ALLOW 项的独立核查**：

1. `api.test-d.ts`：该 fixture 以 `expectTypeOf<ReplicationObserverEvent>().toEqualTypeOf<…精确联合…>` 钉死 21 型闭集——types.ts 追加 reason 值后不同步则 package typecheck / root `pnpm typecheck` / CI 必红（package tsconfig `include: test/**/*.ts` 已核验），与设计 §12 硬门直接冲突。改动为单一联合成员追加，零行为断言变更。仓库先例实证：#231（4323118）、#238（6a005a4）等历次 types.ts 变更均同 commit 同步本 fixture（git log 核验）。判定：ALLOW 行 3（types.ts）授予面的机械牵连完成，非范围越界；SA3 已透明申报。
2. `issue170-r1-r4-red.test.ts`：设计 §13 风险 1 预登记「存量测试爆炸半径可能大于 §2.2 枚举……未知命中者按同口径收敛即可，不需设计变更」，且全量 suite 为硬验收门。命中机理成立（本席独立复核）：5 个 liveness 场景在 `ready` 后单步大推进 30s+ 虚拟时间，open 链在途即越过 openTimeoutMs(5s)——修复前 open 超时仅静默收口 ns（连接保持，测试无感）；修复后按设计触发重建，wire1 时间线前提被破坏。收敛方式 = 在 liveness 时间线前加 `settleUntil(ns==='live')` 同步点（fail-loud，预算耗尽即 throw；harness.ts L257-266 核验），diff 纯 6 行增量、零断言增删改。判定：设计预授权口径内的确定性收敛，非弱化（原 #170 断言全部保留，且隐式增加 ns-live 前置约束）。

**DENY LIST 核验（全部未触碰）**：`ws-replication-issue254-ac-red.test.ts`（未跟踪、mtime 00:33 早于全部实现改动、断言完整）、`hub-connection.ts`/`hub-namespace.ts`、`packages/replication-protocol/**`、registry/runtime/persistence 各包、`frame-io/backpressure/round-engine/update-channel/liveness/fence-watchdog/validate/defaults`、`ws-replication-periodic-reconcile.test.ts`、`CONTEXT.md`、`wiki/raw/task_issue-254*.md` 上游产物——`git status --porcelain` 全集核验，无越界。

## 7. 契约连锁审查

| Contract | Caller | Actual handling | Risk | Finding |
|---|---|---|---|---|
| `PeerNamespaceHost` 新增 facet | 唯一实现 = `PeerConnectionImpl` constructor 装配（L110）；接口未从 index.ts/testing.ts 导出（grep 实证） | 装配齐全；无第二实现需迁移 | 无 | — |
| `ReplicationObserverEvent` reason 联合 append-only（7→8） | observer 订阅方（按值匹配的既有测试）、api.test-d 精确 fixture | fixture 已同步；按旧值匹配的消费者不受 append-only 影响 | 无 | — |
| `onTemporaryFailure` reason 参数（`PeerBackoffReason`） | emitBackoffScheduled 直通 reason 字段 | 新值经类型系统闭环（typecheck 绿） | 无 | — |
| 存量 21 处 `failed` 断言（SA2 §三穷尽清点） | 错误帧/registry 拒绝驱动族（ac1-ac2/ac3 L85/ac4 L152/ac6/ac7/r3-r4/auth-lifecycle/sa7 系） | 触发面仅 timer 族（单点分派实证）→ 行为不变；全量 suite 绿佐证 | 无 | — |
| issue #170 liveness 5 场景 | H1/P1-P3/P4/P4a | ns-live 同步点确定性收敛（见 §6） | 无 | — |
| Hub 侧（hub-connection/hub-namespace/plugin） | peer 1001 close → `onClose` 对称 teardown | 零改动；与网络断线同观测面（N3 实证同轨道） | 无 | — |
| Cordis 插件层（plugin.ts） | 组装 createPeerReplication | 未耦合内部 facet，零改动 | 无 | — |

## 8. 错误、恢复与并发

1. **静默失败排查**：无吞错新增。触发不满足时连接维持现状 = `retryable=config/no` 族既定等待语义（场景 5 负控钉住）；恢复全程事件可观测（`channel-state-changed …→failed`、`connection-state-changed ready→backoff`、`connection-backoff-scheduled{reason:'namespace-recovery',attempt,delayMs}`、新代轨迹）。
2. **并发/幂等**（逐门走栈核验）：
   - 同 tick 多 ns 超时：首个触发同步离开 ready（`onTemporaryFailure` 内 `setState('backoff')` 先于 backoff timer），后续触发被 `connStateValue !== 'ready'` 门吸收；兄弟 ns timer 被 `onConnectionLost` 的 `clearAllTimers`（L775）同步清除——双防线。
   - 迟到 timer 残角（已出队、clear 无效）：`onTimerFired` L1510 `isTerminal()` 早退（终态）或尾部 finalize 落在 disconnected 态（无害投影，新代复活同轨道）——存量语义，非本变更引入（SA2 §2.2 已推演同款）。
   - transport.close() 同步重入：`detachCloseTimedOutTransport` 序列 = 停 liveness → **退订先行** → epoch+1 → close——§18 纪律单点承载，与 pong/hello-timeout 逐字同构；close 抛错 → `emitConnectionFailed('INTERNAL_ERROR',1011)` + `enterBlocked()`（detach 返回 false → 不进 backoff，既有防御，设计 §8.3 路线②登记一致）。
   - 与 `requestRebuild`/stop()/GOAWAY drain 交错：ready 门 + stopping 门；draining 期 timer 已被 `onConnectionQuiesce` 清除（L801），门为纵深——设计 §9.2 逐项成立。
3. **重试幂等与风暴界**：复用 full-jitter + attempts 记账 + `resetAfterMs` 稳定清零（`onTemporaryFailure` L928-941、`armResetCheck`）；场景 1（open 环：attempts 严格递增、delay [25,50,100,200] 公式断言、dialCount ∈[8,32]）与场景 4（reconcile 环：dialCount ∈[15,27]、每 wire 恰一次丢帧）双向钉住「静态僵尸」与「无界重拨」两类回归。
4. **AC4 生命周期**：每 ring 一次受控断线，session.close → lease.release 顺序（ADR 0010 L90）复用；claim 身份守卫防跨代误杀（L1328-1344 既有）；多代场景（场景 2 三代、场景 3/4 多环）零 unhandled rejection + 双向收敛为功能级哨兵。
5. **静态无法确认者**：见 §11（生产 real-WebSocket 异步 close、real-transport 负载抖动、hub 半区 wire 级时序交织）。

## 9. 测试质量审查

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
|---|---|---|---|---|
| `ws-replication-issue254-ac-red.test.ts`（冻结契约，5 场景） | A1/A2：60s 虚拟窗内回 live + `wires≥2`/`dials≥2` + 新 wire OPEN_NAMESPACE+SYNC_STEP1 + hub 回 live + 双向收敛 + AC3 检查器零违例；N1：timeout−1ms 零动作；N2：健康 round 零 churn；N3：手工断线恢复 + AC3 零误报 | root vitest config `packages/*/test/**/*.test.ts` 自动发现；CI `pnpm test` | 无弱化（文件未动：mtime 00:33 + 断言逐行在场 + 无 skip/only/todo——grep 实证）；A1/A2 转绿只能来自生产变更 | — |
| `ws-replication-issue254-timeout-recovery.test.ts`（新，5 场景） | S1 open 超时自愈环（瞬态 failed 轨迹 + failed→disconnected 投影 + backoff 公式/单调 attempts + release 后 live + AC3/收敛/零 rejection）；S2 bootstrap 双停（每 wire 恰一次快照尝试 + 新 wire 恰一次重发/ACK + dials=3 + 数据/身份核对）；S3 multiplex（兄弟 ns 每轮 churn 后 live ≥3 + 环窗口 hub 写零丢失 + 双 ns 双向收敛 + AC3 双侧零违例）；S4 reconcile 持续故障环（dialCount 上下界 + namespace-recovery 事件 ≥10 + attempts 单调 + 每 wire 恰一次丢帧 + 故障消失自愈）；S5 界外负控（NOT_FOUND → 60s 零重建/零重拨/零 namespace-recovery 事件） | 同上；typecheck 经 package tsconfig | 无弱化；上下界双向断言对两类回归均敏感；全部行为断言（事件轨迹/帧种类/计数），零源码字符串断言；fixture 每场景独立 boot + finally stop + unhandled-rejection 哨兵 dispose | — |
| `ws-replication-ac4-reconcile.test.ts` §9.3 改版 | 原「missing SYNC_APPLIED 不进 live + timeout 收口 failed」保留（事件轨迹形态更强）+ 新增 failed→disconnected 投影、wires/dials ≥2、同 wire 单 round（wire1 恰一轮 SYNC_STEP1）、新 wire re-OPEN+SYNC_STEP1、hub 回 live、零 rejection | 同上 | 无弱化（原断言语义全部保留且增强）；finally 清理补齐 | — |
| `ws-replication-ac3-bootstrap.test.ts` §18 改版 | 原「不重发、不无限等待」以 wire1 断言保留（零快照投递/零 ACK/恰一次丢弃）+ 新增瞬态 bootstrapping→failed 轨迹、新 wire 恰一次快照重发 + 恰一次 ACK、收敛 + 身份核对（replicationId） | 同上 | 无弱化；droppedFrames 断言保留 | — |
| `ws-replication-sa4-f1-f2-f3-red.test.ts` F2 改版 | 原「openTimeout 收口 failed 无 everBeenLive 豁免」保留（事件轨迹）+ 新增有界重试环（dialCount ∈[6,30]、namespace-recovery ≥3、attempts 严格递增、首退避 50ms 公式、非 blocked）、release 后 live、零 rejection | 同上 | 无弱化（僵尸钉住 → 环行为钉住 = 设计 §2.2 预判口径） | — |
| `ws-replication-api.test-d.ts` | 21 型精确联合闭集（reason 追加后同步） | root config typecheck include + package tsconfig | 无弱化（精确匹配强度不变） | — |
| `ws-replication-issue170-r1-r4-red.test.ts` | 原 #170 全部断言保留；6 行增量 ns-live 同步点（fail-loud） | 同上 | 无弱化；确定性增强 | — |

**负控/敏感性**：场景 5 = 触发面边界负控（SA2 F3）；场景 1/4 的 dialCount 上界 = 「实现退化为恒速重拨」负控；契约 N1/N2 = 「提前动作/误伤正常轮询」负控；N3 与 A1 单变量对照 = 断言敏感性实证（SA6 §9 因果实验）。
**SA6 红灯断言保持**：是（文件冻结核验）。
**skip/only/todo/env override/超时软化**：无（全目录 grep 实证）。

## 10. Required revisions

无 BLOCKER/MAJOR finding，无必改项。

## 11. 后续动态验证项

| Risk | Driver | Expected observation | Failure condition |
|---|---|---|---|
| SA3 绿跑结论未附原始日志（SA6 红灯有归档、绿灯仅报告表格）；按 package AGENTS 验证门复跑 ws-replication 全量 + 契约 + 新文件 | Controller/验证环节 `pnpm exec vitest run packages/ws-replication/test` | 54 files / 373 tests 全绿（含 A1/A2 转绿）；`pnpm typecheck` + `pnpm test`（--typecheck）exit 0 | 任一失败（尤其 real-transport 抖动族按 SA6 §14 口径单独复跑后仍失败） |
| 生产 real-WebSocket adapter 的 close(1001) 为异步回调（fake transport 同步）；epoch+退订双门为同步重入设计，异步迟到 close 的吸收依赖既有 epoch 门 | 集成/E2E 面（real-transport 系测试 + 部署冒烟） | namespace-recovery 重建后无第二条并行连接、无重复 backoff、旧代零迟到帧出站 | 出现双活连接/重复重拨/旧代帧 |
| hub 半区时序交织（ackTimeout 与 reconcileTimeout 同为缺省 10s、武装起点不同）：hub 先入 needs-resync 发 RESYNC_REQUIRED 时 peer 尚 reconciling（非终态，§9.4 合并规则处置）——修复后两种次序均应收敛 | 延迟注入场景（SA6 §15-2 预登记的改写形态：hub 侧 apply 门闩延迟而非丢帧） | 无论何侧超时先到，窗口内重建 + 双侧回 live，无长期 needs-resync 残留 | 停滞或 RESYNC_REQUIRED 后无新 round |

## 12. Non-blocking observations

| # | 严重度 | 观察 | 建议 |
|---|---|---|---|
| N1 | MINOR | 设计文件 `task_issue-254_design.md`（iteration 0）未回填 SA2 F1（§8.4-5/§11 §23.1 增补）与 F2（§8.4-1 谓词收窄）及 F5 勘误——normative 落点（protocol/ADR）已是正确文本，设计文件呈历史滞后态 | 后续设计归档轮由 SA1 回填（纯文字；不影响实现正确性） |
| N2 | MINOR | SA2 F3 的 config 族变体（UPDATE_TOO_LARGE 界外负控）未实施（原文「可加」可选项，SA3 已申报理由：双侧 limits 注入构造成本） | 可随 follow-up（wire ERROR 族扩面决策）一并落 |
| N3 | MINOR | 场景 4 以 `resetAfterMs=4000`（非缺省）配置钉 attempts 单调环形；SA2 F4 缺省值 reconcile 环（attempts 每环清零、周期 ≈10.1s）仅有 ADR 文档表述、无测试面 | 可选：加一例缺省参数环形断言 `attempt` 恒 1（守护运营告警口径） |
| N4 | MINOR | SA3 报告 Verification 表未归档绿灯原始日志（见 §11 第 1 行动态项）；「54 files」= 53 `.test.ts` + 1 `.test-d.ts`（typecheck 面）口径未注明 | 后续实现轮惯例：绿灯运行附原始日志或在表内注明口径 |
| N5 | 说明 | 场景 3 注入形态偏离设计原文（open 超时实例替代 reconcile 超时）——harness 信封洞约束下不可注入，触发族同为 timer 族、断言面与设计 §12 场景 3 一致；SA3 Deviations-2 已申报 | 无需动作（记录在案） |
| N6 | 说明 | 两个超出 ALLOW 的测试文件（api.test-d.ts / issue170）判为可接受偏离：前者为 ALLOW 行 3 的机械牵连（typecheck 硬门 + #231/#238 先例），后者为设计 §13 风险 1 预授权口径内的确定性收敛（纯增量 6 行、零断言变更）；均已透明申报 | 无需动作；后续设计可将「types.ts 变更连带 api.test-d fixture」写入 ALLOW 模板 |

---

**评审边界声明**：本报告为静态实现审查；未运行任何测试/服务/进程，未修改任何实现、设计或测试文件；唯一写入产物为本文件。绿灯复跑与生产面动态项见 §11，路由由 Controller 决定。
