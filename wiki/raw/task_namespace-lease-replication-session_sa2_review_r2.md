# SA2 复审报告 R2（R1 修订核验）— issue #134（Phase 5 切片 3/4：expose trusted NamespaceLease ReplicationSession）

- **Date**: 2026-08-28
- **被审对象**: `wiki/raw/task_namespace-lease-replication-session_design.md`（SA1 R1，771 行；R0 评审报告 `task_namespace-lease-replication-session_sa2_review.md`，verdict reject：HIGH×2 / MEDIUM×3 / LOW×5 / INFO×6）
- **复审范围**: 仅核 R1 修订点（总控限定）——R0 已背书面（O-1..O-12 骨架、槽序/seam/扇出/scratch/生命周期机制、SA6 20+5 锚点映射、ADR 六步对应、词汇注册）不重开；经全文复读确认机制层与 R0 一致（§0/§1/§2/§4.2/§4.4–4.6/§4.5/§5.1–5.4/§6/§9/§12 DENY 零未声明改动；INV-S2/S11 仅措辞随修订点更新、新增 S15/S16 为修订点对应）。
- **Verdict**: **pass**（16/16 项落实并实证；无新阻断；1 项 INFO 级落位注记移交 SA3，不构成阻断）

---

## 1. HIGH-1 复核：三处码联合一致性（probe5 路径）——✅ 成立

| 核验点 | 结果 |
|---|---|
| §3.1 公共联合（L119–125） | 6 码（含 `NAMESPACE_LEASE_RELEASED`），R0 原状 ✓ |
| §3.2 core 联合（L226–235） | **R1 并入第 6 码** `'NAMESPACE_LEASE_RELEASED'`，注释明示「core 结构性永不结算——唯一产出点 = registry 包装层 wrapCore 的 `revoked()` 前置检查（§5.1/§5.3）；并入纯粹是类型层锁面要求」——与 SA2 建议修法逐字吻合 ✓ |
| §3.3 Equal 锁（L269） | 十键逐字段相等断言保持 ✓ |
| **实证复跑** | `npx tsc --noEmit --strict`（TS 5.9.3）以 R1 字面联合构造全十键 `Core`/`Public`（含 `close(): Promise<void>`、`getStatus(): Readonly<Status>`；两侧码顺序按设计原文对调）→ `Equal<Core, Public>` **exit 0**（probe6；R0 probe4 的 5 码版 TS2344 红为对照组）——顺序差异不影响联合恒等 ✓ |
| 残留扫描 | 全文 grep「5 码/五码/不经 core」：3 处命中（L233/L674/L770）全部是对 R0 缺陷与实证的**描述性引用**（「SA2 实证：5 码版 TS2344 红」），非残留旧裁决；R0 §3.2 旧注释「不经 core」已被改写，零残留 ✓ |
| 产出点一致性 | `NAMESPACE_LEASE_RELEASED` 在 apply 语境的全部出现点：§3.2 类型成员（+注释）、§5.3 表 A0 行（包装层）、§5.1 wrapCore revoked 分支——**core 槽内（R1–R7/§4.4）零产出点**，与「结构性永不结算」自洽 ✓ |

## 2. HIGH-2 复核：§10 phase-5 行 needs-resync 对账注记（C-1）——✅ 原文级落实

L657 phase-5 行新增原文：

> 「**切片 3「needs-resync 通知」对账注记（SA8 放行条件 C-1，SA2 R1 HIGH-2）：本切片无队列 ⇒ ADR 0010 L113 唯一触发面（队列溢出）结构性不可达；needs-resync 与队列属主 = 切片 6**」

对照 SA8 C-1 的两分支要求（「在 phase-5 文档增补中显式登记（切片 3『needs-resync 通知』→ 切片 6 队列属主），**或**设计补充『切片 3 无队列 ⇒ 空实现不可达』的明示声明」）：**两分支同时满足**（属主登记 + 不可达声明），且与 relevant_decisions「设计后复审追加」文档同步条目字面要求一致。SA3 文档同步阶段照此执行即闭合 C-1。✓

## 3. MEDIUM×3 / LOW×5 / INFO×6 共 11 项逐条对照——✅ 16/16 落实

| #（R0 编号） | R1 落点（设计行） | 核验结论 |
|---|---|---|
| MEDIUM-1（#3）A2 敌意子类 | §4.4 A2（L352–357）冻结 `bytes = new Uint8Array(update)` + 明令禁用 `update.slice()` + 理由；INV-S15；§3.1 applyRemoteUpdate JSDoc；§13 新证据行（如实引 SA2 复跑输出）；T-2 红灯 | ✅ 与 SA2 实证修法逐字一致。补充回归核验：`new Uint8Array(update)` 的可防御 throw 面完备——typed array 整型索引与 length 均为内部槽（原型 getter/子类覆写/own-property defineProperty 均不可截获构造器路径）；detached buffer 场景产出全零字节 → 下游 scratch 预演拒（`REPLICATION_RAW_UPDATE_INVALID` 良性闭环）；内存量级与 slice 等价。A1 先于 A2（终态 session 不触拷贝）次序合理 |
| MEDIUM-2（#4）conflicted 摘除 | §4.3（L341）「两种终态共用同一摘除点」；§4.4 R2 行内「同步执行 fanout.detach(channel)」；INV-S2 更新；§8 决策序「不等 → conflicted + fanout.detach」；T-3 红灯 | ✅ 机制闭合。回归核验：R2 的 detach 发生在槽内、事务之外（R5 之前），与 fanout 快照迭代无重入交集；与 INV-S10 槽位释放判据（`state==='open'`）自洽 |
| MEDIUM-3（#5）close 语义 | §3.1 close JSDoc（L183–188）+ §4.3（L342）+ INV-S11 + §8 close 决策序：冻结 **barrier 语义**（首调同步停接纳+摘除，恒绿空槽体入队，resolve = 先于 close 接纳的任务排空后）+ **永不 reject** | ✅ 二择一已冻结（选 barrier——SA2 建议的方向）。回归扫描见 §4.b（12 个交互场景全过） |
| LOW-1（#6）status 新鲜冻结 | §3.1 getStatus JSDoc「全新深冻结对象」+ INV-S16；T-5 | ✅ |
| LOW-2（#7）memoryCaughtUp 初值 | §3.1 durability JSDoc「初值冻结 false + 语义注记」+ §0 O-11 同步更新 + INV-S16 + §10 ADR 登记项；T-6 | ✅ 三处（O-11/§3.1/INV-S16）一致 |
| LOW-3（#8）敌意 SV/非函数 listener | §3.1 encodeDiff JSDoc（照实抛 Yjs 原生错误——可信域契约，同步编码面不经结果联合）+ subscribe JSDoc（订阅时同步 TypeError；运行期 throw 由扇出自捕获）；T-7 | ✅ 同步 throw 面与既有 getter throw 先例一致，不与「一切拒绝经 Promise 结算」（仅约束异步 apply/open 面）冲突 |
| LOW-4（#9）close 后 SV 断言软化 | §5.5：getStatus 照常（**零 doc 访问**——经逐字段核验属实：state/direction/四域冻结常量/currentEpoch←state.replication/rootValidation/durability/observerFailures 均不读 doc）；encodeStateVector best-effort + shutdown+dispose 后调用属停止序违约声明 + 指向 ADR 0010 L179 | ✅ 软化方向与 SA2 建议一致；SA6 用例 12（degraded 期 SV）不受影响（degraded ≠ closed，doc 存活） |
| LOW-5（#10）命名笔误 | §14 表 L755 已统一为 `openReplicationSessionCoreForRegistry` | ✅ 全文无旧名残留（grep 确认） |
| INFO-1（#11）同值重写边界 | §10 ADR 0010 增补节登记项：「删后同值重写 = 内容未变 = 允许」+ 历史膨胀注记 | ✅ |
| INFO-2（#12）O(doc) 成本登记 | §10 ADR 登记项 + §4.6 性能注记保持 | ✅ |
| INFO-3（#13）管理写字节回灌踩坑 | §10 ADR 注记：「META 触碰的管理写字节不得经 raw 回灌对端；epoch 传播走控制面（切片 6 IDENTITY_CHANGED）」 | ✅ |
| INFO-4（#14）observerFailures 显式化 | §4.2 新增 bullet（O-10 显式选择；熔断/背压属切片 6） | ✅ 接受现状 + 显式化，与 SA2 结论一致 |
| INFO-5（#15）§4.1 时点精化 | fanout+host 于 V3d 后 V3e 前；WeakMap 登记 V3e 后、返回前 | ✅ 伪代码与对象构造序自洽 |
| INFO-6（#16）P0 preparing 期 open 显式裁决 | §3.2 open 门序注释（「不含 schemaState 检查——有意行为……SA3 不得自行追加 schema gate」）+ §8 + T-8 | ✅ |

「SA2 反馈逐条回应」表 16 行与 R0 攻击点清单 #1–#16 一一对应、mapping 到具体章节，无遗漏、无答非所问。✓

## 4. 回归风险扫描：R1 新表述——未发现新矛盾

**a. fanout.detach 共用摘除点**：R2 槽内 detach 位于 R5 事务之前、槽外无迭代交集；close() 首调同步段 detach 与 §4.2 代码（listeners 快照迭代）相容；conflicted-后-close 幂等分支（§8「状态保持 conflicted」）与 barrier 语义无冲突（重入队空槽体无害，或已终态直取 resolved promise——两实现均满足「幂等无害 + 永不 reject」）。✓

**b. close() barrier + never-reject（12 场景扫描）**：① session-barrier 与 runtime.close-barrier 两次入队——FIFO 顺序确定、恒绿空槽无死锁；② 在途 apply 先于 barrier 排空（INV-S11「照常排空」保持）；③ close 后接纳的 apply 在 A1 拒（不入队）；④ fatal 后 sequencer 链继续运转，barrier 照常 resolve；⑤ Runtime closing 后调 session.close()——barrier 经 sequencer 排空 resolve（close 后 sequencer 仍运转），never-reject 保持；⑥ listener 内重入 close()——enqueue 微任务化，无同步重入死锁；⑦ notifier 永挂 ⇒ close Promise 永挂——与 runtime.close「不设内部 timeout」契约同款（runtime.ts close JSDoc 先例明文此类自等待属契约行为）；⑧ `void activeSession.close()`（§5.2）fire-and-forget——恒绿空槽结构性无 reject ⇒ 零 unhandled rejection 前提成立；⑨ release Promise 不等 barrier（doRelease 用 void）——「release 不追踪已接纳写」（ADR 0009 L42）保持；⑩ SA6 用例 4（close 幂等 + close 后 apply 拒）相容（barrier 微任务内 resolve，两次 settle 同值 undefined）；⑪ SA6 用例 16（shutdown 后 apply 拒）无交互；⑫ transport 停止序（session close → lease release → registry shutdown）下 barrier 排序 [session-barrier, …, runtime-barrier] 合理。✓

**c. `new Uint8Array(update)` 敌意子类安全拷贝**：见 §3 表 MEDIUM-1 行——可防御 throw 面完备（内部槽不可截获、detached 良性闭环、OOM 属不可防御域）；与 A1/A3 次序无新交互。✓

**d. P0 preparing 期 open 无 schema gate**：facts 构造期 V2.5 预投影（#132 机制）⇒ preparing 期 facts 诚实；apply 槽 FIFO 排于 P0 后（P0 已 settle）；preparing + disabled → `REPLICATION_NOT_ENABLED` 拒绝路径不变；SA6 20 用例全部在 schemaReady 后 open，零锚冲突。✓

**e. 一致性交叉**：§0 O-11 ↔ §3.1 ↔ INV-S16（初值/新鲜度）；§3.1 ↔ §4.3 ↔ INV-S11 ↔ §8（close 语义）；§4.4 A2 ↔ INV-S15 ↔ §8 决策序 ↔ §13 证据行——五组交叉一致；§9 SA6 矩阵与 §11「零同步」未动 ✓；§12 ALLOW 仅测试条目扩容（+T-1..T-8，行数估计 300–420），DENY 零改动 ✓；§13 新增两行证据如实标注「SA2 独立复跑（双源）」✓；§15-7/15-8 自检声明与本文核验事实相符 ✓。

## 5. §9.1 T-1..T-8 归属 SA3 owned `runtime-replication-session.test.ts` 的合理性

| # | 可行性核验 |
|---|---|
| T-2..T-8 | ✅ 全部单包可测：经包内 seam `createNamespaceRuntimeWithSeam`（受控 notifyDirty/p0Gate）+ 相对通道消费 internal 模块的 `openReplicationSessionCoreForRegistry(runtime, options)` 直取 core——不依赖 registry 层（沿 `runtime-registry-internal-seam.test.ts` 动态 import internal 先例）。T-4 的 unhandledRejection 计数（vitest `process.on` 监测）与 barrier 结算序（gate 挂起/释放）均可确定性驱动；T-8 用 p0Gate 挂起即得 preparing 态。 |
| T-1 | ⚠️ **注记（INFO 级，非阻断）**：前半（lease.ts Equal 断言随 `pnpm typecheck` 即红/绿门）不依赖任何新测试文件、强制力已在 src——成立。后半「包内 test-d 加 `Equal<RuntimeReplicationSessionCore, ReplicationSession>` 双向探针」的**跨包比较在 runtime 包内不可行**（依赖方向：runtime 不 import registry 类型，反向依赖违反包边界）；SA3 落位二选一：(a) 仅依赖 lease.ts src 断言（真锁，推荐——最小面）；(b) runtime 包 test-d 以 §3.1 十键**字面形状副本**做 `Equal<Core, 期望形状>` 自锁（不跨包，可作冗余防线）。**不得**为跨包探针在 runtime 测试 import `@nomicore/namespace-registry`。此为落位精度注记，不构成阻断——两路径均不违反任何冻结条款。 |

## 6. 结论与移交

**verdict: pass**——R1 对 R0 全部 16 项逐条落实且与建议修法吻合（HIGH-1 按 probe5 验证路径、经 probe6 以 R1 字面联合+顺序对调复验 exit 0；HIGH-2 原文级闭合 C-1）；R1 新表述经 12+ 场景回归扫描未引入新矛盾、未触碰任何 SA6 锚点与已背面；机制层与 R0 认定一致（零未声明改动）。同意放行进入 SA3 TDD 实现。

**移交 SA3/S4 的核对点（非阻断）**：
1. T-1 探针落位按 §5 注记二选一（推荐 (a)；禁跨包反向 import）；
2. 文档同步阶段照 §10 执行（含 C-1 注记原文与 ADR 0010 增补节三登记项——SA4 静态验尸逐项核对「设计声明 vs 仓库事实」）；
3. SA4 另核：internal 键集锁测试两键演进、§14 表命名统一、runtime-write-fatal-message-rev1 既有渲染逐字节不变。

## 7. 验证证据汇总

```text
# 1) HIGH-1 修法复验（R1 字面联合、码顺序对调、全十键含 close/getStatus）
npx tsc --noEmit --strict /tmp/sa2-probe/probe6.ts
  → exit 0（Equal<Core,Public> === true）
# 对照组（R0 5 码版）: probe4 → exit 2, TS2344

# 2) 残留扫描
grep -n "5 码\|五码\|不经 core" wiki/raw/task_namespace-lease-replication-session_design.md
  → 3 处命中均为对 R0 缺陷/实证的描述性引用（L233/L674/L770），零残留旧裁决

# 3) 产出点一致性
grep -n "NAMESPACE_LEASE_RELEASED" …design.md
  → apply 语境仅：§3.2 类型成员+注释 / §5.3 表 A0 行 / §5.1 wrapCore revoked 分支
    ——core 槽内零产出点，与「结构性永不结算」自洽

# 4) 基线复用证据（R0 §0/§7）：probe3（5 探针 exit 0）、probe4/5（Equal 红绿对照）、
#    origin-check.mjs / yjs-check2.mjs（Yjs 四项语义 + 敌意子类实证）——本复审未重跑，
#    R1 未触碰其针对面（§3.1 status/十键形状未变，仅 JSDoc 增强）。
```

（探针脚本位于 /tmp/sa2-probe/，未触碰 worktree 任何文件；SA2 本轮唯一写入 = 本复审文件。）
