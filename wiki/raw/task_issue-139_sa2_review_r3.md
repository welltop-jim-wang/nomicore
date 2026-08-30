# SA2 攻击评审报告 R3 — Issue #139（apps/yjs-server composition root）

**Date**: 2026-08-30
**Verdict**: **PASS**（NB-1/NB-2 逐行源码核实**全部真实落实**；本轮全新视角重扫 R2 新增机制（`notify-auth-changed` 动词 / blocked-recovery T6 / 换装拨号来源 / A13·A15·A6）未发现新的阻断级缺陷。3 项 advisory 级备注供 SA6/SA4 参考，不阻断实施）

评审对象：`wiki/raw/task_issue-139_design.md`（R2 修订稿）。评审基线：TASK.md issue #139 AC×7、phase-5 文档、ADR 0010、hosting 文档、冻结包源码（本 worktree 实测）。本轮以全新视角重扫，重点：① R2 NB-1 修复（冻结 b+c 恢复路线）的每一处机制声明是否与冻结源码一致；② T6 红测的 green 条件在正确实现下是否**可达**（R2 的核心指控是「结构性永久红」）；③ NB-2 引用修正；④ R2 修订是否引入新缺陷。

## 一、NB-1 落实核实（CRITICAL——逐条源码验证）

R2 要求：修正失实断言 + 选定并冻结一种恢复语义 + 改写 T6/T3。SA1 选择 **b+c 路线**（stdin `notify-auth-changed` 动词 + 部署 runbook）。逐项验证：

| R2 要求 | 落实 | 源码证据（本 worktree 实测） |
|---|---|---|
| §3.4 动词表新增恢复动词 | ✅ | 设计新增 peer 专属 `notify-auth-changed {}`，透传公共 API。核实：`PeerReplication.notifyAuthChanged(): void` 是冻结公共接口成员（`types.ts:178-179`，注释「token/config 显式变化通知缝——blocked 仅在明确变化后恢复拨号」逐字吻合）；`createPeerReplication` 门面（`peer-connection.ts:47`）实装 `notifyAuthChanged`（`:271-274`：`if (stopping) return; if (connStateValue !== 'blocked') return; requestRebuild('auth-change')`）——**仅 blocked 生效、其余态静默 no-op、不抛错**，与设计陈述逐字一致 |
| 回执载荷 `connectionState` 快照「blocked 恢复路径上同步可见 disconnected」 | ✅ 真实 | `requestRebuild`（`peer-connection.ts:842`）**同步**执行 `setState('disconnected')`（`:853`）后才返回（wire 关闭 `:861`、`deferTask(() => dialNow())` `:863-866` 异步）→ `notifyAuthChanged()` 返回后立即调 `getConnectionState()`（门面 `:257`）必得 `disconnected`——T6 断言「载荷 connectionState 离开 blocked」**在稳定 blocked 场景下确定性成立** |
| §3.4 启动序改锚硬崩溃/backoff/首拨 | ✅ | 新论证引用 `peer-connection.ts:694-716,820`：核实 onClose（`:692`）非 1002/1008 close → `onTemporaryFailure('socket-closed')`（`:715`）→ backoff timer → `dialNow`（函数体起 `:820`）。「被优雅停下的 peer 进 blocked 不拨号、不构成自动重连」明示删除旧失实前提 |
| §3.6-1/§3.7-5/A13 失实断言全量改写 | ✅ 逐行属实 | `hub-connection.ts:423`（`drainReason='SERVER_SHUTTING_DOWN'`）/`:428`（GOAWAY 帧字面量）；`peer-connection.ts:518-521`（SHUTTING_DOWN/REAUTH_REQUIRED → `enterBlocked()`）；`:694`（backoff/blocked 态 onClose 早退不重拨）；`:718-742`（`onGoawayClosed` 重拨编排，仅 drain 类可达——SHUTTING_DOWN 在 `:518-523` 提前 return 进 blocked，结构性不可达）；grep 全 src `SERVER_RESTARTING` 仅 `peer-connection.ts:505,529,718`（peer 侧处理）+ `types.ts:286`（联合类型）——**零 hub 发射点**，证实 |
| T6 改写为 blocked-recovery 红测，green 条件可达 | ✅ 结构性可达 | 事件链核实：peer `handleGoaway` 先 emit `goaway-received`（`peer-connection.ts:510-517`）再 `enterBlocked` → setState(blocked) emit `connection-state-changed`（发射点=FSM 唯一迁移 `:908-919`，边沿 exactly-once）——T6「依次出现」断言与发射顺序一致。**负例静默窗口成立**：`armBlockedDeadline`（`:557`）到点仅 `transport.close(1001,'blocked-deadline')`，零事件发射、零状态迁移（blocked 态 onClose `:694` 早退）→ blocked 期间无 dial/backoff/迁移事件。**恢复链成立**：notify → 同步 disconnected → dialNow → hub v2 重启（直引授权「启动即绑定」先于 listen，§3.4 冻结序）→ authorize 命中 → channel 重 OPEN（`peer-namespace.ts:710-716`）→ live。R1 版（无动词）下 peer 永久 blocked → 有界轮询永不达 live = 红；R0 事件序下 authorize miss → 红。**red-then-green 两态均自洽** |
| T3 换装拨号来源显式化 | ✅ | spawn 一次性旧 token 进程/裸 ws 客户端拨 `/replication` → hub `verifyToken` {ok:false} → `emitUpgradeRejected('invalid-credentials')`（`hub-connection.ts:198-205`）+ `rejectUpgrade`——断言锚真实可达（advisory 见三-3）。旧 peer 保持 blocked 负例与源码一致；收尾「notify 后 token 已换 → 拨号被拒回 blocked」与 `:711-713`（1008 → enterBlocked）一致 |
| 部署文档 runbook（c 路线） | ✅ | §8 ALLOW LIST 部署文档条目含：notify/重启/换装三分支 + 硬崩溃自动 backoff 说明 + 「不通知即静默停摆」负例语义 + hub `ready` 后择机时机——运维闭环 |
| 稳定码注册表零新增、零新协议 reason code、零 `packages/**` | ✅ | `notify-auth-changed` 为 app 本地 stdin 动词（非协议帧/reason code）；角色不适用 → `unknown-op`（复用既有码）；设计为纯文档修订 |

**结论：NB-1 真实、完整、与冻结源码逐行自洽地落实。** R2 的核心指控（T6 结构性永久红、app 无恢复动词、hub 正常重启 = peer 楔死且无文档）全部被修复：恢复入口真实存在（公共 API 门面实装）、观测锚真实发射（顺序与 T6 断言一致）、green 条件可达、负例窗口无伪事件干扰、运维语义文档化。

## 二、NB-2 落实核实（MINOR）

✅ **真实落实**。A6 现引 `persistence/src/service.ts:57-72`（有序 disposer 设计注释——`:57`「绑定 persistence adapter 的 Cordis 生命周期」起、`:62` drainStep `await revoke()`、`:72` `finally 兜底 await adapter.dispose()`）与 `:106-112`（实现：`:107` `await revoke()`、`:111-112` `finally { await adapter.dispose() }`）——**逐行核实精确**；`packages/persistence/src/` 实测无 plugin.ts（ls：contract/file/index/lifecycle/memory/service/testing），设计已如实注明。SA4 按图索骥可定位。

## 三、全新视角重扫（R2 修订是否引入新缺陷）

按技能多维扫描（竞态/状态撕裂/异常输入/契约污染/静默失败/虚假降级），未发现阻断级问题。已排查并证伪的攻击尝试：

1. **notify 与 in-flight rebuild 的 rebuildPending 竞态**：若 GOAWAY 与既有 rebuild 并发（`rebuildPending=true` 时收到 SHUTTING_DOWN → state 回 blocked），此时 notify 的 `requestRebuild` 被 `:844` 幂等守卫早退、快照或仍为 blocked——但该窗口中 rebuild **已在队列**且将执行 dialNow，恢复不受损；T6 场景（hub 已停、wire 已被 hub `finishDrain` 1001 收口、稳定 blocked）中 `rebuildPending` 必为 false，断言确定性成立。不构成缺陷。
2. **blocked deadline 定时器 vs T3/T6 静默窗口**：deadline 到点只关 wire（1001）零事件（`:557-565`）→ 窗口断言不会被 deadline 噪声污染。已证伪。
3. **T3 裸 ws 客户端变体的 reason 歧义（advisory，非阻断）**：无 Authorization 头的裸客户端会命中 `missing-token`（`hub-connection.ts:127-133`）而非 `invalid-credentials`。设计文字「（或裸 ws 客户端）」须读作「携带旧 token 头」。**SA6 编写时注意**：该变体必须带 `Authorization: Bearer <旧token>` 才命中断言的 `invalid-credentials`。
4. **§3.4 对 requestRebuild 内部次序的叙述**（advisory，非阻断）：源码实际为 setState('disconnected')（`:853`）先于 transport.close（`:861`），设计括注写作「关旧 wire → 同步 disconnected」；且引用区间 `:842-858` 未覆盖 close/deferTask 两行（实际 `:842-866`）。两处均为叙述性微差——被引函数起点行号精确、机制结论（同步 disconnected 可见于快照 / dialNow 异步）为真、T6 依赖的断言不受影响。SA4 复核可定位，不构成依据失准。
5. **§3.5 括注「发射点 = FSM 唯一迁移点 :908-919」**（advisory，非阻断）：严格说仅适用于 `connection-state-changed`（setState `:908`）；`goaway-received` 发射点在 `handleGoaway`（`:510-517`），A15 对其只引 `types.ts:282` 成员定义。两个锚点各自独立可验证，不误导。
6. **虚假降级 / 静默失败复查**：`notify-auth-changed` 在非 blocked 态的 no-op 是包冻结语义（backoff 态下一次 dial 本就读当前凭据——`:265-270` 注释），且回执携带 `connectionState` 快照使运维可感知，属**文档化 no-op**而非静默失败；恢复闭环（blocked → NDJSON 可观测 → 显式动词 → 收敛）闭合，R2 指出的「可感知但不可恢复」缺口已消除。

## 四、协议假设依据审查（2026-06-13 立法）

- 章节存在，A1–A15 均有依据类型/内容/风险 ✓。
- **A13（R2 全量重写）**：全部行号本轮逐行复核为真（见上表）；风险列已按 R2 要求改写为「peer 对 shutdown 类 GOAWAY 进入 blocked 不自动重拨——app 必须显式设计恢复路径」并列明消解手段 ✓。
- **A15（新增）**：`types.ts:261`（connection-state-changed）/`:268`（connection-backoff-scheduled）/`:282`（goaway-received）与 `peer-connection.ts:908-919`（setState 唯一迁移点）全部精确 ✓。
- **A6（NB-2 修正）**：`service.ts:57-72,106-112` 精确 ✓。
- 抽查既有条目维持可定位：A3（`types.ts:58-70` 5 必填+3 可选）、A12（`peer-namespace.ts:671-684,710-716`、`hub-connection.ts:487`）、A14（`hub-connection.ts:127-136,198-205`、`types.ts:365-377`）、A10、registry `types.ts:592,602`、sa7 realTimer（`ws-replication-sa7-r1-transport-auth.test.ts:68-71`）、根 `vitest.config.ts:5`（include 仅 packages/domains，apps 缺席属实）、`ws` 不在 lockfile（grep 零命中）✓。
- 无「应该/通常/预计」类无据推断；唯一叙述性微差见三-4/三-5，低于依据失准门槛（函数可定位、结论为真）。

## 五、错误处理链路审查

- R1 #3 stdin 错误链维持闭合；新增动词遵守「每行恰一回执 + 稳定码零新增 + 进程不因控制输入退出」✓。
- **R2 指出的状态闭环缺口（blocked 可观测不可恢复）已闭合**：恢复动词（app 层）→ 冻结 seam（包层）→ 收敛断言（T6）→ runbook（文档层）四层对齐 ✓。
- 降级路径：`notify-auth-changed` 非 blocked 态 no-op 属包设计语义且回执可感知，非虚假降级 ✓。
- 竞态：绑定先于 listen 的保护对象已改锚为真实存在的竞态主体（硬崩溃 backoff 重拨/首拨/显式恢复重拨）；in-flight rebuild 幂等守卫（`rebuildPending`）+ `deferTask` 单飞已排查，无双重拨号窗口 ✓。

## 六、红线测试思路（确认 + advisory，供 SA6/SA4）

1. **T6（blocked-recovery）按 R2 版执行**：断言链（goaway-received → to:blocked → 静默窗口 → notify 回执 connectionState≠blocked → 有界轮询达 live → verify-write/read 收敛）全部经源码核实可达；红条件（R1 版永久红 / R0 序 authorize-miss 红）定义明确。**advisory**：静默窗口断言建议同时容许 `connection-backoff-scheduled` 之外的零事件（blocked 期 armBlockedDeadline 仅关 wire 零事件，无需特殊处理）。
2. **T3 换装步骤按 R2 版执行**：advisory——裸 ws 客户端变体必须携带旧 token 的 Authorization 头（否则 reason=missing-token ≠ 断言值 invalid-credentials，见三-3）。
3. T1/T2/T4/T5/T7 维持 R1/R2 版本（本轮无新发现）。

## 七、结论

**PASS——实施可以开始。**

- NB-1（CRITICAL）：b+c 恢复路线已冻结且**逐行源码落实**——恢复动词实装于公共门面、仅 blocked 生效、回执快照同步可见 disconnected、T6 green 条件结构可达且负例窗口无噪声、T3 换装拨号来源显式化、A13 如实重写、runbook 文档化。R2 指控的三个后果（T6 永久红 / 拨号来源缺失 / peer 楔死无恢复）全部消除。
- NB-2（MINOR）：A6 改引 `service.ts:57-72,106-112` 精确落实。
- 全新视角重扫未发现新的阻断级缺陷；3 项 advisory（三-3/三-4/三-5）为 SA6 测试编写与 SA4 复核的注意事项，不要求设计返工。
- 零 `packages/**` 改动、零新协议 reason code、ALLOW LIST 只增不删——R2 修订纪律遵守。

`pass` 的边界声明：本 PASS 仅覆盖**设计层**（机制声明与冻结源码逐行自洽、测试计划可达性、AC 映射闭合）。实现与活链路验证仍属 SA4（静态门禁+实测复核）与 SA7（活链路冒烟）的职责；advisory 三项应随设计文档传递给 SA6/SA4。
