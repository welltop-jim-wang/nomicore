# SA2 攻击评审报告 R2 — Issue #139（apps/yjs-server composition root）

**Date**: 2026-08-30
**Verdict**: **REJECT**（前轮 4 项阻断级攻击点经源码核实**全部真实落实**；但 R1 新增的重启收敛论证与 T6/T3 换装红测建立在一个与冻结源码相悖的 peer 行为前提上——1 项**新可见 CRITICAL**（窄修）。另 1 项 MINOR 引用残留）

评审对象：`wiki/raw/task_issue-139_design.md`（R1 修订稿，2026-08-30 10:22）。评审基线同 R1：TASK.md AC×7、phase-5 文档、ADR 0010、hosting 文档、冻结包源码。本轮以全新视角重扫，并对 R1 新增的全部机制声明（A12–A14、§3.4 启动序依据、§3.6/§3.7、T6/T7）逐一源码复核。

## 一、前轮阻断点落实核实（R1 #1–#4 逐条）

| R1 攻击点 | 落实核实 | 证据 |
|---|---|---|
| #1 CRITICAL 授权 owner 形状 | ✅ 真实解决 | §3.2 双形式（`namespaceId`/`provisionId` 恰一）+ `ownerUserId` 直引必填/provision 禁止 + `(peerInstanceId, nsId)` 查重；§3.4 authorize 查绑定表 `Map<peerId\u0000nsId,…>`，两形式 localOwner 唯一来源。与 `NamespaceAuthorization` ok:true 必填 `localOwner`（`ws-replication/src/types.ts:84-90`）自洽；T1 四类用例 + T6 端到端齐备 |
| #2 MAJOR provision/listening 竞态 | ✅ 排序本身解决（但见 NB-1） | §3.1/§3.4 冻结「绑定先于 listen」、NDJSON 序 `provisioned→listening→ready`、§3.5/T3 断言锚。该排序对硬崩溃/首拨场景（peer 在 backoff 循环中拨入重启中的 hub）依然必要且正确；但 §3.6-1 给出的「peer 收 GOAWAY 后按 backoff 重连」论证依据失实（NB-1），T6 的 green 条件不可达 |
| #3 MAJOR stdin 错误链 | ✅ 真实解决 | §3.4 每行恰一回执 + 稳定码注册表 7 码 + verify-write 有界等待（30s 缺省/钳位 [1,120000]）+ `namespace-unknown` 即时回执 + provision 失败 `provision-failed`+exit(1)；§3.7 SIGHUP 单飞/先验证后拆卸/坏 config 保旧 ctx/停旧后失败 loud exit；T7 全链覆盖。内部自洽，无静默失败残留 |
| #4 MAJOR AC3 第二分句 | ✅ 计划层闭合（可行性受 NB-1 牵连） | T3 增换装步骤、新增 T6/T7、§9 AC 映射更新；但换装步骤的「旧 token peer 拨号被拒/新 token peer 重连」需显式构造拨号来源（blocked peer 不拨号，NB-1） |

MINOR #5–#10 抽查：锁移入 rootDir 保留名（`file.ts` adapter 仅触 `users/`、`archive/users/`，`service.ts`/`file.ts:203/218` 核实零干扰）✓；wrapWs 5+3 枚举与 `types.ts:58-70` 一致 ✓；404/accept 单验与 `hub-connection.ts:127-136,198-205`（missing-token/invalid-credentials → observer 事件）一致 ✓；hub 拒 backoff（`HubReplicationOptions:113-127` 无该字段）✓；A11 改引 registry `types.ts:592,602`（enableReplication/openReplicationSession 定义，实测行号吻合）✓；provision 累积量化 + 省键零 seeding ✓。

## 二、新可见攻击点

| # | 严重度 | 攻击面 | 具体漏洞（证据） | 建议 |
|---|---|---|---|---|
| NB-1 | **CRITICAL** | R1 重启/换装收敛论证与 T6/T3 红测建立在失实的 peer 重连前提上；app 无 peer blocked 恢复路径 | 设计 §3.6-1 称「peer 收 GOAWAY 后按 backoff 重连——重连命中的必然是授权绑定已完成的新 listener」；A13 假设栏同文「peer 收到后按 backoff 重连」。**源码相反**：`hub.close()` 发的 GOAWAY reasonCode=`SERVER_SHUTTING_DOWN`（`hub-connection.ts:423,428`），而 peer 对 `SERVER_SHUTTING_DOWN`/`REAUTH_REQUIRED` 一律 `enterBlocked()`（`peer-connection.ts:518-521`）——blocked 后 `onClose` 直接 return 不重拨（`:694`），恢复唯一入口是 `notifyAuthChanged()`（仅 blocked 态生效，`:273`；`types.ts:178-179`「blocked 仅在明确变化后恢复拨号」）或 blocked 态 `addTarget`（`:245-246`）。`:718-742` 的 backoff 重拨编排只属 drain 类 GOAWAY，而 hub 包**从不发送** `SERVER_RESTARTING`（grep 全 src 零发射点）。后果链：① §3.4 启动序论证与 §3.7-5 的「重连收敛」叙事机制不存在；② **T6 结构性永久红**：hub SIGTERM → peer 收 `SERVER_SHUTTING_DOWN` → blocked，静态 targets 无 add-target/无 notify → hub 重启后 peer 永不重拨 →「channel 有界轮询达 live」在实现完全正确时也永不成立（意图是 red-then-green，实际 red-forever）；③ T3 换装步骤「旧 token peer 拨号被拒」缺拨号来源（blocked peer 不拨号）；④ app 未接线任何 peer 恢复动词（§3.4 动词表无 `notify-auth-changed`；`request-reauth` 仅 hub）——**hub 一次正常重启即把所有 peer 永久楔死**，只能人工重启 peer 进程，运维语义未设计 | 窄修三选一并冻结：**(a)** T6/T3 改用硬崩溃场景（SIGKILL hub → peer onTemporaryFailure backoff 循环 → hub 回归后收敛——这才命中 bind-before-listen 真正防护的竞态）；**(b)** §3.4 动词表增 `notify-auth-changed`（透传 `peer.notifyAuthChanged()`，blocked 才生效语义明示），T6 在 hub 重启后调用之再断言收敛；**(c)** 部署文档明示「hub 重启 ⇒ 全体 peer 须重启/notify」并同步改写 T6 断言为 peer 重启收敛。无论选哪个：修正 §3.4/§3.6-1/§3.7-5/A13 的失实断言（A13 须补引 `peer-connection.ts:518-521` 与 `:694`，并把风险列改「peer 对 shutdown 类 GOAWAY 进入 blocked 不自动重拨——app 必须显式设计恢复路径」） |
| NB-2 | MINOR | A6 引用失准（残留） | A6 称 persistence 有序 disposer 注释在「plugin.ts:23-32」——`packages/persistence/src/` **无 plugin.ts**（ls：contract/file/index/lifecycle/memory/service/testing）；该注释实际在 `service.ts:57-70`（+ `:107` 实现行）。停机链核心依据引错文件，SA4 按图索骥落空。R1 回应表声称「全部经本 worktree 重新 grep/sed 核实」——此条证明核实不完整 | A6 改引 `persistence/src/service.ts:57-70,107` |

## 三、协议假设依据审查（2026-06-13 立法）

- 章节存在，A1–A14 均有依据类型/内容/风险 ✓。
- **A13 为失实假设**：假设栏断言「peer 收到（SERVER_SHUTTING_DOWN GOAWAY）后按 backoff 重连」，所引 `peer-connection.ts:505,529,718` 均不支持该断言——`:505` 是 reasonCode 稳定化、`:718` 的重拨编排仅 drain 类可达，而 `:518-521` 明确将 `SERVER_SHUTTING_DOWN` 路由进 `enterBlocked`（不重拨）。**依据与结论相悖 = 按立法必须 reject 修正**（NB-1）。
- A11/A3/A8/sa7-r1 引用（R1 #9 修正项）本轮重跑全部可定位 ✓；A12（`peer-namespace.ts:671-684,710-716`、`hub-connection.ts:487`）、A14（`hub-connection.ts:127-136,198-205`、`types.ts:365-377`）逐行核实为真 ✓；A6 引用失准（NB-2）。

## 四、错误处理链路审查

- R1 #3 的 stdin 错误链（每行一回执/稳定码/有界等待/SIGHUP 语义）闭合 ✓；SIGHUP「先验证后拆卸」把配置错误挡在破坏性动作之前 ✓。
- **新发现状态闭环缺口（NB-1 的运维面投影）**：hub 正常重启后 peer 进入 `blocked`，无事件驱动的恢复路径、无 stdin 动词、部署文档无指引——一次常规运维动作导致全体 peer 静默停摆（有 NDJSON 状态迁移可观测，但**无恢复手段**），属「失败模式用户可感知但不可恢复」。
- 虚假降级：未发现新实例（R1 结论维持）。

## 五、红线测试思路（NB-1 修复后供 SA6/SA4）

1. **blocked-recovery-red**：hub SIGTERM → 断言 peer NDJSON 出现 connection `blocked` 投影 → hub 同 rootDir 重启（直引 authorization）→ 按修复所选语义：**(b)** 路线向 peer stdin 注 `{"op":"notify-auth-changed"}` → 断言 channel 有界轮询达 `live` 且 verify-write/read 收敛；**(a)** 路线改 SIGKILL hub → 断言 peer `backoff-scheduled` 事件流 → hub 回归后达 `live`。当前设计下两断言均不可达（修复前红）。
2. **T3 换装步骤改造**：旧 token 拨号来源显式化（spawn 一次性旧 token peer 进程或裸 ws 客户端拨 `/replication`）→ 断言 `auth-upgrade-rejected(invalid-credentials)`；新 token peer 用**新进程**（并断言旧 peer 若未 notify 则保持 blocked，作为文档化语义的负例）。
3. T1/T2/T5/T7 维持 R1 版本不变（本轮无新发现）。

## 六、结论

**REJECT**（仅 1 项阻断级，窄修）。R1 对前轮 4 项阻断点的落实全部经源码核实为真且质量高（授权双形式/绑定表、绑定先于 listen、stdin 错误链全冻结、AC3 覆盖闭合）；R1 新引的 A12/A14 及 #5–#10 修正也逐行属实。但 **NB-1** 是硬伤：设计的重启收敛机制论证（「peer 收 GOAWAY 后按 backoff 重连」）被冻结源码直接证伪——`SERVER_SHUTTING_DOWN` 使 peer 进入 blocked 且永不自动重拨，hub 包也从不发送 drain 类 `SERVER_RESTARTING`；由此 T6 在正确实现下永久红、T3 换装步骤缺拨号来源、app 无 peer 恢复动词（hub 正常重启 = 全体 peer 楔死）。修复为设计文档级窄修（改 4 处陈述 + 选定并冻结一种恢复语义 + 改写 T6/T3 两步），不动骨架。NB-2 一并修正。修完可直接重审。
