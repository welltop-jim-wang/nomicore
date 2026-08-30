# Final Spec Review — Issue #140 Phase 5 收口（app 黑盒管理动词面）

- **Date**: 2026-08-30
- **Reviewer**: SA2（final independent Issue/Spec review，全新视角）
- **审查对象**: 基线 `469ca36` → HEAD `f310f18`（3 commits：`dbd36d4` 主实现 / `3863a69` SA4 R1–R4 rework / `f310f18` SA7 F1 rework），外加工作树未提交增量盘点
- **输入**: 任务简报（8 条 AC + Phase 1 SA6 记录）、`task_issue-140-phase-5-websocket-replication_relevant_decisions.md`（ADR 0010 全条款 + #134/#133 r2/#161/#172 修订节 = 冲突基准）、SA1 设计（R1–R4）、SA6 红灯报告、SA4 review（R4 pass）、SA7 report（R2 pass）
- **Verdict**: **pass**（附 1 项发布前置收纳条件 F-R1、2 项非阻断观察）

## 0. 一句话结论

三个管理动词（`replace-schema` / `bump-epoch` / `reset-replica`）的接线与编排忠实地把 ADR 0010 已冻结的宿主能力暴露为黑盒控制面：SA6 三红灯全闭合、SA4 四轮 reject 全闭环、SA7 F1 缺口修复经红锚转绿实证；本轮独立攻击审查（角色守卫/参数门禁/竞态交错/引擎假设逐条源码核对）未发现新的 CRITICAL/MAJOR 缺陷，diff 半径恰为设计 ALLOW LIST 的 6 文件、`packages/**` 零改动、typecheck 全绿、锚 6/6 + SA7 5/5 全绿。唯一需要动作的是**发布完备性**：SA4 O-R3-1 必验项的锚定用例仍在工作树未提交（F-R1），发布 commit 必须收纳。

## 1. 验收标准逐项核对（任务简报 8 条 AC）

| AC | 要求 | 本轮 diff 落点 | 判定 |
|---|---|---|---|
| AC1 并发 ROOT 写收敛（双适配器） | hub+双 peer 并发写收敛 | 非本轮改动路径；SA6 锚 ①② 回归锁全绿（memory+file 独立 rootDir） | ✅ |
| AC2 断连 reconcile / absent bootstrap / race | — | 既有绿测域（SA6 §0 落点表），本轮 dispatch 纯加法零触碰 | ✅（既有） |
| AC3 lineage/epoch 冲突、protected-field、**hub schema 传播**、**epoch fencing**、**guarded reset**、archive | 管理动词黑盒可达 | 红灯三缺口已闭合：dispatch +3 case（`app.ts:472-477`）+ 三 handler（G1–G5 守卫链与设计 §3.1–§3.3 逐条一致）；锚 AC3-①②③ 全绿 | ✅ |
| AC4 degraded 家族（双适配器） | — | 既有绿测域，零触碰 | ✅（既有） |
| AC5 backpressure/limits/auth/drain | — | 既有绿测域，零触碰 | ✅（既有） |
| AC6 FilePersistence 独立 root + 重启 + archive/reset + crash recovery | — | 锚 ③ + SA7 第 3 例（file 全周期：归档落盘 + SIGKILL + 同 rootDir 重启恢复收敛）全绿；archive/reset 经 `reset-replica` 黑盒可达 | ✅ |
| AC7 公共导出/稳定错误/文档一致性 | — | `index.ts`/`main.ts`/`config.ts` 零改动；`STABLE_OP_ERROR_CODES` 值 append 8 码（形状不变，E7 成立）；`docs/integration/hub-peer-deployment.md`（动词表 3 行 + 稳定码注册表 + 「管理动词」节 + 事件列表 `replica-reset` + add-target 幂等语义修正）与 `docs/phases/phase-5-websocket-replication.md`（切片 8/9/10 三行 + 未交付边界 AD-1 改写）逐字落地设计 §6；protocol/ADR/CONTEXT 零改动（符合设计 §6.3 裁决） | ✅ |
| AC8 typecheck/全测/diff checks/Node matrix/final review | — | `pnpm typecheck` exit 0（本轮实测）；全量 app 套件 47 例：46 绿 + 1 例基线 flaky（见 F-O3，单跑 3/3 绿、非本轮路径）；CI 触发证据 = 发布后事项（SA7 §5/R2.6 已登记环境阻塞）；本文件即 final review | ✅（CI 证据发布后补） |

## 2. ADR / 规范契约核对（冲突基准 = relevant_decisions 摘录）

| 条款（ADR 0010 为主） | 实现核对 | 判定 |
|---|---|---|
| 「SCHEMA 只允许 hub 的本地 `replaceSchema()` 修改」 | `opReplaceSchema` G1 角色守卫（peer → `unknown-op`）+ 复用 hub lease 写槽（`schema-write.ts` FIFO 槽序，ADR 0008 四槽之一） | ✅ |
| 「`bumpReplicationEpoch()` 不替换 Y.Doc 内容，使旧 epoch peer 必须显式 reset」 | `opBumpEpoch` 复用 epoch 管理槽；fence 链零新代码（`FenceWatchdog` → `IDENTITY_CHANGED` → 双侧 conflicted，控制面传播）——**META 管理写字节不经 raw 回灌**（#134 修订节） | ✅ |
| #133 r2「`resetReplica(expectedLocalIdentity)` 严格前置核对……任一不匹配 → `NAMESPACE_RESET_IDENTITY_MISMATCH`，零破坏性动作」 | `opResetReplica` G4 mismatch 即 return（**在 G5a `peerOwners.delete` 之前**——代码序核对：`app.ts:726` 早于 `:730`），channel 全程不动；与 AD-2 方案 B 次序冻结一致 | ✅ |
| 「Hub 丢失只能从 hub 自身备份恢复」/「WS 层不得直接读写 snapshot 文件」 | reset 归档经 registry→persistence seam，app 层零 persistence 触达（ADR 0006 纪律） | ✅ |
| 「本地业务写成功仍只表示 live Y.Doc 已提交且本地 dirty notification 已登记」 | 回执诚实语义落地：replace-schema ok ≠ 传播/落盘、bump ok ≠ fence 已广播、reset ok = 归档 + 收口结算完成 + 重引导**已入队**（F1 修复后「全部交错下为真」）——三处文档逐字一致 | ✅ |
| secret-free 纪律（token/bytes/SCHEMA/ROOT 内容不入回执） | 三动词请求/回执/事件字段集核对：仅 namespaceId/ownerUserId/32hex replicationId/epoch 数值；registry message 不透传（仅 code） | ✅ |
| #172「`wiki/raw` 非规范」 | 源码与规范公共表述无 wiki/raw 引用；行为依据指向 CONTEXT/ADR/protocol | ✅ |
| 修改半径（DENY LIST） | `git diff 469ca36..HEAD --name-only` 恰 6 文件全在 ALLOW LIST；`packages/**`、`main.ts`、`config.ts`、`index.ts`、protocol、ADR、CONTEXT 零触碰 | ✅ |

## 3. 攻击点清单（本轮独立攻击）

| # | 严重度 | 攻击面 | 结论 |
|---|--------|--------|------|
| F-R1 | **IMPORTANT（发布前置，非代码缺陷）** | 发布完备性：SA4 R3 移交、SA7 R2 必验的 **O-R3-1 用例（终态通道 + peerOwners 在册 → add-target 放行分支）只存在于工作树未提交增量**（`git status`: `M apps/yjs-server/test/phase5-mgmt-verbs-sa7.test.ts`，HEAD 4 例 / 工作树 5 例）。SA7 R2 的 pass 证据（5/5 全绿）基于工作树版本；若发布仅 push HEAD 3 commits，该放行分支在 CI 中**无锚定**，F1 修复的恢复入口面（add-target 状态感知门）只被 F1 用例间接覆盖 | **要求**：发布 commit 必须收纳该未提交增量（文件为 `[SA7 owned]`，增量 = O-R3-1 describe + 头注 R2 复验措辞，符合 SA4 R4 登记的 ALLOW 边界）。发布前 `git status` 须干净 |
| F-A1 | 攻击未遂（解除） | `waitPeerTargetSettled` 预算取 `this.config.timeouts?.closeTimeoutMs`——若 app config 无该键则恒用缺省 5s，与引擎实际 closeTimeout 脱钩 → 配置非缺省时伪超限 | 解除：`config.ts:119` `TIMEOUT_KEYS` 白名单含 `closeTimeoutMs`（`Partial<ReplicationTimeouts>` 透传块），测试/部署可覆写，预算与引擎时钟同源 |
| F-A2 | 攻击未遂（解除） | settle-wait 状态词汇与引擎状态机不匹配 → 死等或早退 | 解除：`PeerNamespaceState`（`types.ts:194-205`）11 态词汇与 `waitPeerTargetSettled` 判据（closed/conflicted/failed/disconnected/undefined）精确对齐；`needs-resync`/`closing` 等非终态正确落人等待侧 |
| F-A3 | 攻击未遂（解除） | disconnected 分支返回 settled 后 `addTarget` 合流零动作 → 重引导静默丢失 | 解除：disconnected 投影仅来自连接断开（`peer-namespace.ts:748-767`），连接重建 ready 时 `openActiveTargets`（`peer-connection.ts:619-629`）对 `intent='active'` 的 disconnected/failed controller 必 `setState('targeted')+startOpen()`；addTarget 合流将 intent 翻回 'active'，自愈链闭合（SA7 探针 H 实证 19.3s） |
| F-A4 | 攻击未遂（解除） | hub 直引（direct-reference）重启后 `knownNamespaces` 缺席 → 新动词 G3 门禁误拒 `namespace-unknown` | 解除：`bootHub`（`app.ts:217`）对直引 authorization 条目启动即 `knownNamespaces.set`；provision 路径 L303。两条启动形态 G3 均可达 |
| F-A5 | 攻击未遂（解除） | `opReplaceSchema` 重建 schema 对象 → 额外键静默剥离（SA4 R2 缺陷复发） | 解除：实现为 cast 透传（`{ schema: schema as …, root: args.root }`），额外键直达 runtime ENV-5 封闭门 → `write-failed`（SA7 第 2 例动态实证） |
| F-A6 | 攻击未遂（解除） | G5a–G5c 窗口并发 `add-target`/`remove-target`/`read` 交错撕裂幂等集 | 解除：与设计 §3.3 竞态表 w1/w2/w3 逐行核对代码序（G4 resolve 前/中/后三窗），F1 修复后 add-target 短路门为状态感知（`app.ts:567-573`：`peerOwners.has && state ∉ 终态`），终态放行 re-add——伪 ok 零动作面已消除（O-R3-1 锚定） |
| F-A7 | 攻击未遂（解除） | `removeTarget` reject → G5b catch 吞真实失败 | 解除：`peer-namespace.ts:644-705` 全状态矩阵分支均 resolve（targeted/disconnected 本地收口、opening…needs-resync CLOSE/本地、closing memo、closed memo、conflicted/failed 立即）——catch 保持结构性防御边界定位正确 |

**无 CRITICAL / MAJOR 级新发现。** F-R1 为发布流程完备性条件，不构成对 HEAD 代码本身的否决。

## 4. 协议假设依据审查（skill 立法项）

- 设计 §9 章节存在，E1–E16 全数带源码引用（文件:行号可定位）。本轮独立抽查复核实属：E2（removeTarget 有界结算 = closeTimeoutMs，`peer-namespace.ts:670-688`/`defaults.ts:38`）、E3（re-add 分支，`peer-connection.ts:228-233`）、E11（add-target 短路门）、E12（controllers map 无 delete 路径）、E13（恒 resolve/无 throw）、E16（非终态合流分支——F1 根因依据）。
- 依据栏零「应该/通常/预计」类无据推断；E15（keep-root × schema 演进）为 SA4 R1 缺口补证后的修正条目（`schema-replace.ts:181-188` 双证 + vfsl optional 语法锚），本轮确认锚测试 `SCHEMA_V2` 已改用 `note?: string`（`phase5-three-instance-acceptance-red.test.ts:56-59`）。
- **结论：通过。**（SA4 R1 曾抓到共享假设失误，已闭环——这正是该门禁的价值记录）

## 5. 错误处理链路审查（skill 立法项）

- **静默失败**：无。三 handler 每分支有回执（ok / 8 类稳定码）；`replica-reset` 事件仅 G5c 成功分支；G5b 超限/防御 catch → `reset-replica-failed` 诚实回执。
- **状态闭环**：replace-schema/bump-epoch 失败折叠 `write-failed`（AD-3 与 `opVerifyWrite` 先例一致）；reset 七码透传 + fatal 折叠——`ResetReplicaIssue` 联合（`types.ts:372-399`）与 `lifecycle.ts` 注册表逐字一致（顺序亦一致）。
- **降级路径**：bump 后 epoch 投影防御分支 = 省略字段（不虚构数值）——设计 §4.1 裁定的结构性防御，非降级。停机窗口伪回执（E14）= 已登记的时序边界（数据零丢失 + 重启按配置 targets 重引导 + SA7 5/5 实证 + 文档明示），接受。
- **虚假降级识别**：无伪降级。G5b 收口结算超限是**真实可达失败面**（F1 修复引入）且诚实回执；未被当作降级掩盖。

## 6. 测试覆盖核对

| 文件 | 用例 | 覆盖 | 本轮结果 |
|---|---|---|---|
| `phase5-three-instance-acceptance-red.test.ts`（SA6） | 6 | AC1×2（双适配器三实例并发收敛）+ AC6（file crash recovery）+ AC3-①②③（schema 传播 / epoch fencing + 不传播断言 / guarded reset 双向） | 全量套件内全绿 |
| `phase5-mgmt-verbs-sa7.test.ts`（SA7，工作树 5 例） | 5 | ①bump 回执值三方交叉验证 + fence 时延实测（<30s 断言）②extra-key 响亮拒绝 + 零破坏 + 干净重提传播 ③file 全周期（归档落盘 + 崩溃重启）④F1 红锚（两轮 bump→fence→reset 重引导 + add-target 恢复入口）⑤O-R3-1（终态 + peerOwners 在册 → add-target 放行 + `target-added` + 重建收敛） | 全量套件内全绿 |
| 回归 | 既有 8 文件 | 基线行为锁 | 42 例中 41 绿 + smoke T3 时序 flaky（F-O3） |

覆盖判定：SA6 三红灯的原始断言语义（动词名/参数名/回执码/事件名）逐字兑现，零测试妥协；F1 与 O-R3-1 把 SA7 动态发现的缺口转为永久 CI 锚——AC3 的动态覆盖达到「多轮运维循环 + 恢复入口」深度，超出单轮黑盒验收的最低要求。**缺口（登记，非阻断）**：G5b settle-wait 预算超限分支无动态锚（SA7 O-G2：需 controller 卡 closing 超 closeTimeout+2s，引擎 closeTimeout 兜底保证不可达，黑盒无故障注入面）——诚实登记，可接受。

## 7. 观察项（非阻断，移交）

- **F-O1/F-O2（已在 pre-merge 复审闭环）**：部署文档已将停机窗口更正为 peer；SA7 F1 用例已改为现绿回归锁措辞。
- **F-O3（基线 flaky 登记）**：`smoke-skeleton-red.test.ts` T3 的「peer verify-write ok → 立即 hub read == 1」断言存在最终一致窗口（ADR 0010：写成功不等待 hub 确认）——高负载下 hub read 可抢在传播前（本轮全量并行 334s 时 1/47 失败；单跑 3/3 绿；SA7 R2 同套件 47/47 绿；相关代码路径本轮零改动）。属基线测试时序脆弱性，建议后续加有界收敛等待（与 `waitConverged` 同款），不属本任务。
- **O-F2（SA7 移交，确认非本任务缺陷）**：peer 本地写新 schema 字段在增量传播后仍 `write-failed`（引擎「活动 schema 仅在（重）物化时切换」，ADR 0010 L107 已登记原则）；设计文档 L140「→ peer installActive」表述与实现不符的文档卫生票维持 SA7 建议并行处理。

## 8. 红线测试思路（对 F-R1 的验证构想）

- **发布前置检查（可直接执行）**：发布前 `git status --short` 输出不含 `apps/yjs-server/test/phase5-mgmt-verbs-sa7.test.ts` 的 M 条目；PR diff 中该文件含 O-R3-1 describe（grep `O-R3-1`）；CI `Test` 步骤 log 摘录两测试文件的 `Running N tests`（N=6 与 N=5）。
- （F-O3 若修）红灯思路：在全量并行负载下复现 T3 失败 → 给 hub read 加 `waitConverged` 式有界轮询（复用锚测试 helper）→ 单跑 + 全量双绿。

## 9. 验证证据（命令 + 结果）

| 命令 | 结果 |
|---|---|
| `git diff 469ca36..HEAD --name-only` | 恰 6 文件（app.ts / lifecycle.ts / 两测试 / 两 docs），全在 ALLOW LIST |
| `git diff 469ca36..HEAD -- packages/` | 空（`packages/**` 零改动） |
| `git status --short` | `M apps/yjs-server/test/phase5-mgmt-verbs-sa7.test.ts`（F-R1 证据）+ wiki/raw untracked |
| `pnpm typecheck` | exit 0（12 个 tsconfig 全过） |
| `npx vitest run apps/yjs-server/test/ --no-typecheck` | 47 例：46 绿 + smoke T3 1 失败（高负载时序） |
| `npx vitest run apps/yjs-server/test/smoke-skeleton-red.test.ts --no-typecheck` | **3 passed (3)**，exit 0——T3 单跑绿，flaky 定性成立 |
| 源码核对（grep/sed 只读） | `peer-connection.ts:216-254/619-629`、`peer-namespace.ts:644-705`、`types.ts:194-205/372-399`、`config.ts:119`、`app.ts:217/303/472-477/567-573/726-756/818-845`、`lifecycle.ts:98-120` |
| 文档核对 | `hub-peer-deployment.md` 动词表/稳定码 8 码/管理动词节/replica-reset 事件/add-target 幂等语义；`phase-5-websocket-replication.md` 切片 8/9/10 + 未交付边界 AD-1 改写——与代码逐字一致 |

## 10. 结论

**Verdict: pass。**

- 设计（R1–R4 终版）与实现（`f310f18`）在 ADR 0010 全部冲突基准下自洽；SA2 攻击面七处全部核实解除；无虚假降级、无静默失败、无 CRITICAL/MAJOR 新发现。
- 三轮多 SA 制衡（SA2 reject → SA1 R1、SA4 R1–R3 reject → SA3 `3863a69`、SA7 F1 fail-needs-fix → SA3 `f310f18`）全部闭环，且每轮修复均有永久 CI 锚（F1 红锚、O-R3-1、AC3-①②③、extra-key、file 全周期）。
- **发布前置（必须）**：收纳工作树中 SA7 测试文件的 O-R3-1 增量（F-R1）——否则 SA4 R3 必验项的放行分支锚定缺席于 CI。
- 发布后补：CI run log 摘录（SA7 §5/R2.6 移交）；F-O1/F-O2/F-O3/O-F2 文档卫生票并行。
- 本 pass 仅覆盖「HEAD diff + 设计契约 + 静态/活链路测试」维度；CI 矩阵（Node versions、`vitest run --typecheck` 全仓）以发布后 run log 为准（AC8 尾项）。
