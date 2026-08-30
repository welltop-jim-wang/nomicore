# SA2 攻击评审报告

**Date**: 2026-08-30（R1）／ 2026-08-30（R2 重审）
**Latest Verdict**: **pass**（R2——A-1 至 A-4 全部修订落实且经独立验证，无回归；依据与残留观察见文末「R2 重审」章节）
**Verdict (R1, superseded)**: reject（A-1 必须修订设计；A-2/A-3/A-4 一并修订后重审）
**被审对象**: `wiki/raw/task_issue-140-phase-5-websocket-replication_design.md`（R1 = Round 1；R2 = SA1 R1 修订版，基线 HEAD `469ca36`）
**审查方法**: 全新视角；对设计引用的全部关键源码行号逐条实读核验（`app.ts` 全文、`peer-connection.ts`、`peer-namespace.ts`、`hub-namespace.ts`、`fence-watchdog.ts`、`registry.ts` reset 槽、`schema-write.ts`、`runtime.ts` fence 段、`lifecycle.ts`、`defaults.ts`、`memory.ts`、`main.ts` 控制通道、SA6 红灯测试全文、两份目标文档）；ADR 约束以相关决议摘录为基准。

---

## 总评

设计整体质量高：三个动词的接线半径克制（`packages/**` 零改动）、AD-1/AD-2/AD-3 的裁决论证充分、§9 协议假设依据逐条带源码行号（我逐条核验全部属实，无一虚引）、诚实回执语义（ok ≠ 传播/落盘/fence 已广播）与 ADR 0010 口径对齐。**核心缺陷只有一个，但在设计自己声称支持的合法运维序列上造成可复现的状态撕裂与伪成功回执**（A-1），必须修订设计后重审。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| 1 | **MAJOR** | `reset-replica` 编排与 app 层 `peerOwners` 记录的一致性 | 设计 §3.3 G5 直接调用底层 `this.peer.removeTarget` / `this.peer.addTarget`，**全程不维护 app 层 `peerOwners` map**（peer 侧 `knownOwner` 的唯一来源，`app.ts:117/587-590`）。两个现实触发（均不需 G5 catch 可达）：**(a) 设计 §4.3 自己声称支持的合法运维序列 `remove-target` → `reset-replica`**：`opRemoveTarget` 已 `peerOwners.delete`（`app.ts:563`），reset 成功后 G5 的 `addTarget` 正常重引导 channel（controller 留存 map、终态走 re-add 分支，`peer-connection.ts:228-233`，已核验 controllers map 无 delete 路径），bootstrap 成功后终态 = **channel live + `peerOwners` 缺失** → 该 ns 的 `read`/`verify-write` 永久 `namespace-unknown`，数据在、通道在、黑盒不可达，只能重启进程恢复。§4.3 宣称该序列「仍可达」只对 reset 本身成立，对 reset 之后的重引导产物不成立。**(b) §7 声称的恢复路径失效**：reset 成功 + 重引导链后续失败（bootstrap failed / hub 不可达 backoff）后，运维按 §7 与 §6.1 文档指引重试 `add-target` → `opAddTarget` 的幂等短路（`app.ts:549` `if (this.peerOwners.has(namespaceId)) return {ok:true}`）因条目从未清理而**返回伪 `ok:true` 且零动作**——静默伪成功，恢复路径断裂 | 设计 §3.3 G5 显式裁决 `peerOwners` 维护点：G4 reset 成功后、`removeTarget` 前同步 `this.peerOwners.delete(namespaceId)`；G5 成功后 `this.peerOwners.set(namespaceId, ownerUserId)`；G5 catch 分支保持 deleted（保证 `add-target` 重试真正可达）。§3.3 竞态表补「reset 进行中并发 `remove-target`/`add-target`」两行终态推演；§6.1 部署文档「管理动词」小节的 reset 重试指引与该语义对齐 |
| 2 | MINOR | G5 失败路径的结构可达性 vs §7 声称的恢复信号面 | 设计 §10 调用方审计表声明 `removeTarget`「Promise resolve（事件驱动结算，不 reject）」、`addTarget`「同步、幂等（无 throw 面）」——两者皆真 ⟹ G5 的 try/catch + `restarted:false` 事件 + `reset-replica-failed` 回执是**结构性死代码**。§7 风险表行「reset 第 2/3 步失败 → restarted:false + reset-replica-failed loud；重试 add-target 即恢复」描述了一条不存在的行为；§6.1 文档照抄会向运维承诺无法兑现的信号。现实的 G5 后失败是**重引导链失败**（事件面 = 既有 channel/连接 observer 事件），不是 G5 本身 throw | 设计二选一诚实化：(i) 承认 catch 为纯防御边界，§7/§6.1 失败矩阵改写为「现实的 G5 后失败 = 重引导链失败，观测面 = 既有事件，恢复入口 = `add-target`（依赖 #1 修订后真正可达）」；(ii) 或给出 catch 真实可达的路径证据 |
| 3 | MINOR | `replace-schema` 的 `root` 参数形状门禁缺位 | G2 只对 `schema` 四键做形状门禁，`root` 无门禁：stdin `{"root":null}` 或 `"root":42}` 经 `'root' in args` 判定（§3.1 伪代码）送入 runtime 形状/校验拒绝 → 回执 `write-failed`。后果：(a) 同类调用方输入错误得到两个码族（schema 形状错 → `invalid-op-args`，root 形状错 → `write-failed`），`write-failed` 同时承载 compile 失败/degraded/fatal 等真实写失败，诊断分辨度被稀释；(b) §3.1「JSON 无 undefined，键存在性判定无歧义」只排除 undefined，未处理 null 的语义二义（「清除 root」还是「未提供」）——JSON 有 null | G2 增补：`root !== undefined && !isPlainObject(root) → invalid-op-args`（与 schema 门禁同层）；部署文档动词表注明 root 为可选 plain JSON 对象、`null` 不是「未提供」 |
| 4 | MINOR | 文档对齐遗漏 phase-5 切片 9 行交付登记修正（SA8 N4 未吸收） | `docs/phases/phase-5-websocket-replication.md:159` 切片 9 行仍标「未交付 \| #164」，与基线 HEAD `469ca36`（apps/yjs-server 已随 #186 交付）矛盾。设计 §6.2 只改切片 8/10 行，同一张表留下相邻行的事实错误——AC7「文档一致性」验收口径下的登记缺口 | §6.2 修改半径补切片 9 行状态修正，或显式声明为何出本任务范围 |

### 观察项（不构成 reject 依据，供 SA3/SA4/SA7 参考）

- **O-1（停机窗口伪回执）**：`shutdown` 回执发出 → `performStop` 中 `peer.stop()` 完成后，进行中的 reset-replica G5 之 `addTarget` 会因 `dialNow` 的 `stopping` 守卫静默 no-op（controller 置 targeted 但永不重拨）→ 回执 `ok:true + restarted:true` 但重引导不发生。进程将退出、重启后按配置 targets 重引导、数据零丢失——实际无害，但 §3.3 竞态表「reset 与 app 停机并发」行应补此终态（回执「ok = 重引导已启动」在停机窗口为假）。注意 main.ts 控制通道为**并发**模型（`rl.on('line')` 每行独立 IIFE 不排队，`main.ts:142-155`；SA6 `waitConverged` 的 `Promise.all` 三路并发为实证），该交错真实可达。
- **O-2（reset 与 read 并发）**：reset 成功后 entry 移除、bootstrap 完成前，并发 `read` → `namespace-unknown`/`read-failed`（opRead 无 F1 重试），bootstrap 后自愈——行为可接受但 §3.3 竞态表未声明。
- **O-3（AC3-② 时序前提）**：设计 §3.2 推演第 6 点成立的前提 = SA6 先 `waitForEvent(identity-conflicted)` 再写 `count=5`（hub 侧 `oneShotTerminal` 的帧发送与 `finalize('conflicted')` 同同步段，peer 事件出现 ⟹ hub channel 已终态，此后 `onOwnedUpdate` default 分支忽略——`hub-namespace.ts:690-706` 已核验）。建议设计点名该断言序依赖，避免 SA7 动态复核误判为自由竞态。
- **O-4（实现优化）**：若 `NamespaceLeaseBumpReplicationEpochResult` 的 ok 分支已携带新 epoch，可直接取用，省去 `getStatus()` 二次投影与防御分支。

---

## 协议假设依据审查

- **章节存在性**：§9「协议假设依据」存在，含 E1–E10 十条，全部为「源码引用」型（个别附全仓 grep 与既有测试存在性）。✅
- **依据可验证性（逐条实读核验，全部属实）**：
  - E1 ✅：`hub-namespace.ts:187-193`（watchdog 构造 `idleProbeMs: host.timeouts.ackTimeoutMs`）、`fence-watchdog.ts:56-66`（idle 到期先清守卫再重武装后探测）、`defaults.ts:39`（`ackTimeoutMs: 10_000`）、`ws-replication-ac6-resync-close.test.ts` 存在。
  - E2 ✅：`peer-namespace.ts:644-705`（removeTarget 状态矩阵；conflicted/failed → 立即 `setState('closed')` 零 wire；live → CLOSE_NAMESPACE + close timer）、`armTimer`（close → `closeTimeoutMs`）、`defaults.ts:38`（5_000）。
  - E3 ✅：`peer-connection.ts:228-233`（closed/conflicted/failed → targeted + `requestRebuild('re-add')`）。**补充核验**：全文件无 `controllers.delete`——removeTarget 后 controller 留存 map 且 state='closed'，re-add 分支结构性可达（设计时序推演的前提成立）。
  - E4 ✅：`registry.ts:1707-1709`（fence mismatch 在一切破坏性动作之前 return）；槽注释②明示「先于一切 Persistence 探针/forceRelease/close admission/archive」。
  - E5 ✅：`app.ts:157-160`（`const {type, ...rest} = event; this.sink({event: type, ...rest})`）。
  - E6 ✅：`memory.ts:141-160`（importDoc/archiveDoc/readPersistedReplicationIdentity 委托 core）。
  - E7 ✅：`lifecycle.ts:102` 定义、`index.ts:28` 唯一导出、全仓 grep 恰两处、无测试形状锚定。
  - E8 ✅：lease `enableReplication` 文档注释「原子安装随机 128-bit 复制谱系 + epoch 1」；`app.ts:311-315` provisioned 事件投影链同款防御式读取。
  - E9 ✅：`hub-namespace.ts:690-706`（onOwnedUpdate switch——live/reconciling 系列之外 default 忽略交付）。
  - E10 ✅：`app.ts:436-441`（reply 包装）、`main.ts:140-157`（attachControlChannel 每行恰一回执）。
- **「应该/通常/预计」类无据推断**：未发现。§9 末行「无其他协议级假设」的声明与全文一致。✅
- **结论**：协议假设依据审查**通过**。SA4 可按行号直接重跑核验。

## 错误处理链路审查

- **静默失败**：三动词自身的一切 registry/lease 层失败均映射稳定码回执（G1–G5 每步有码）✅。**例外 = A-1(b)**：跨动词交互面上 `add-target` 幂等短路产生伪 `ok:true` 零动作回执——这是本设计引入编排后新暴露的静默伪成功路径，归入 A-1 修订。
- **状态闭环**：失败状态在所有路径可写入稳定码 ✅；`replica-reset` 事件覆盖 G5 成功/失败两分支 ✅——但失败分支结构性不可达（A-2），信号面与 §7 声明不符。
- **降级路径**：三动词为纯本地编排（registry/lease/内存态），无外部依赖降级场景 ✅。停机/断连窗口的行为由既有面兜底（O-1 的伪回执除外，已列观察项）。
- **虚假降级识别**：设计 §4.1 自查成立——D2 的「读不出 enabled epoch」确为结构性不可达（bump ok ⟹ enabled），处置为省略字段而非虚构数值，**不是**伪降级 ✅；`registry === undefined` → `unknown-op` 有码区分且有 `request-reauth` 复合守卫先例 ✅。未发现把 bug 降级掩盖的路径。
- **结论**：链路骨架健康；实质违例集中于 A-1（伪成功回执 + 恢复路径断裂），诚实性缺口为 A-2。

## 红线测试思路（每漏洞对应的测试编写方向）

1. **A-1（peerOwners 一致性）——进程内单测为主**（AppHandle 直接构造 + peer 桩注入，黑盒层难以稳定控制 G5 交错窗口）：
   - 桩测：reset-replica 成功路径执行后断言 `peerOwners` 被按修订语义维护（delete→set 对称）；G5 失败注入（桩 `addTarget` throw）后断言 `peerOwners` 保持 deleted。
   - 钉死短路回归：`peerOwners` 预置条目 + channel 终态 failed → 发 `add-target` → 断言底层 `addTarget` **真正被调用**且 `target-added` 事件发射（防伪 ok 回归）。
   - 集成级（黑盒三进程）：`remove-target` → `reset-replica`（correct expected）→ 等 `replica-reset` + 收敛 → `read` 断言恢复 `ok:true`（钉住 §4.3 声称的合法序列不再撕裂为 `namespace-unknown`）。
2. **A-2（死路径诚实性）**：SA4 静态审查项——核对 §7/§6.1 失败矩阵表述与代码可达性一致；不为结构性不可达路径写伪红灯。
3. **A-3（root 形状门禁）**：黑盒——`replace-schema` 带 `root:null` → 断言 `code === 'invalid-op-args'`（修订后）；带合法 `root`（满足新 SCHEMA 的完整对象）→ `ok:true` 且双 peer 收敛到新 root。
4. **A-4（文档登记）**：SA4 文档核对项：phase-5 切片表 8/9/10 三行状态与实际交付一致。
5. **既有 SA6 锚（无需新增）**：AC3-② 的「fenced 后写不收敛」与 AC3-③ 的「mismatch 零破坏」已覆盖设计的 E9/E4 假设；AC3-① 传播链已覆盖 E1/E3 主路径。

---

## 给 SA1 的修订要求汇总（reject 解除条件）

1. §3.3 G5 补 `peerOwners` 维护三步（delete 于 removeTarget 前 / set 于 G5 成功后 / catch 保持 deleted），§3.3 竞态表补 `remove-target`/`add-target` 并发两行，§6.1 文档措辞同步（A-1，**必须**）。
2. §7 与 §6.1 的 G5 失败表述诚实化：区分「G5 catch（结构性防御）」与「重引导链失败（现实恢复场景，入口 = 依赖修订 1 的 add-target）」（A-2）。
3. §3.1 G2 补 `root` 形状门禁（非 plain object → `invalid-op-args`），§3.1 「无歧义」论证补 null 二义性说明，部署文档注明（A-3）。
4. §6.2 补 phase-5 切片 9 行登记修正或显式出范围声明（A-4）。
5. 建议（非阻塞）：O-1 停机伪回执终态补入 §3.3 竞态表；O-3 的 SA6 断言序依赖点名。

以上修订均为设计文档级，不动摇 AD-1/AD-2/AD-3 三条架构决策与 §8 文件清单的半径（`peerOwners` 维护发生在 ALLOW LIST 的 `app.ts` 内）。修订后按总控流程重审。

---

# R2 重审（2026-08-30）— Latest Verdict: **pass**

**被审对象**：设计 R1 修订版（修订记录见设计文档头部 L11-12）。R1 reject 的四项修订要求 + 三项观察建议逐条复核，全部新引入依据锚独立验证，回归面检查完毕。

## A-1 至 A-4 逐条验证

| # | R1 要求 | 修订落实（设计位置） | 独立验证结论 |
|---|---|---|---|
| A-1（MAJOR） | G5 补 `peerOwners` 三步维护 + 竞态表两行 + §6.1 对齐 | §3.3 伪代码 G5a（`peerOwners.delete` 于 removeTarget 前）/ G5c（`set` 于 G5b 成功后）/ catch 保持 deleted；G4 mismatch 路径显式声明零 peerOwners 动作；竞态表新增 remove-target/add-target 两行（w1/w2/w3 三交错窗）；S1/S2 时序图同步；§4.3 闭环补充；§6.1 重试指引；E11/E12 依据锚 | ✅ **落实且正确**。(a) `remove-target`→`reset-replica` 序列撕裂被 G5c set 修复（§4.3 闭环推演与 registry ① owner 核对语义一致——G4 成功 ⟹ set 的 ownerUserId 与本地副本 owner 一致）；(b) 重引导失败后 `add-target` 恢复路径被 G5a delete 修复（幂等短路不再拦截，`target-added` 事件为成功信号）。**窗口穷尽性独立推演**：G5b try 内 `await removeTarget` 是唯一 await 边界（addTarget/G5c set/sink 均同步紧随）→ w1（G5a 前）/ w2（removeTarget await 边界）/ w3（G5c 后）三窗口划分穷尽，addTarget 与 G5c set 之间零 await、并发行不可插入。w2 内 remove-target 的并发底层调用经 `controller.removeTarget` 的 intent='removed' 幂等合流（`peer-namespace.ts:645-647`）后仍被 G5c set 覆盖——终态收敛成立；「remove-target 意图被编排超越 = last-writer-wins」的声明诚实（两动词均回 ok，stdin 并发无全局序）。E11（`app.ts:549/563/117/587-590`）与 E12（controllers.delete 零命中）与本人 R1 实测完全一致 |
| A-2（MINOR） | G5 catch/`restarted:false` 与 no-throw 实现对齐（建议 (i) 诚实化） | §3.3 catch 注释改「结构性不可达纯防御边界」（引 E13）+ 新增「G5 失败的二分」段（结构性防御 vs 现实重引导链失败——后者观测面 = 既有 observer 事件、恢复入口 = add-target）；§3.5 `replica-reset` 事件收敛为仅成功分支、**去 `restarted` 字段**；§4.6 失败矩阵拆两行；§7 风险表拆行；§3.4 回执表标注 `reset-replica-failed` 双来源 | ✅ **落实**。采用建议 (i)。事件面收敛无回归：SA6 测试不消费 `replica-reset` 事件（`phase5-three-instance-acceptance-red.test.ts` 全文复核——AC3-③ 只等回执 + waitConverged），`restarted` 字段从未被断言。E13 依据（removeTarget 全分支 resolve + addTarget 同步无 throw）与本人 R1 核验一致 |
| A-3（MINOR） | `root` 形状门禁 + null 二义裁决 + 文档注明 | §3.1 G2 增补 `'root' in args && !isPlainObject(args.root) → invalid-op-args`；新增「root 参数契约（完全规格）」：提供性（键存在性）/合法域（plain JSON 对象，依据 ADR 0003「ROOT 固定物化为 Y.Map」）/null 二义裁决（≠ 未提供 ≠ 清除语义 = 形状违约）/语义校验分层；§6.1 动词表注明 | ✅ **落实**。门禁逻辑与既有 `isPlainObject`（`app.ts:67-69`：非 null、非数组、非标量）匹配——`root:null`/`[]`/`42` 均 `invalid-op-args`，与 schema 形状错同码族。合法域论证（Y.Map 物化 ⟹ JSON 投影恒为对象）严谨且与 ADR 0003 决议摘录一致。SA6 AC3-① 不发 root，零测试影响；G4 input 构造（`'root' in args ? {schema, root} : {schema}`）与 G2 前置保证自洽 |
| A-4（MINOR） | phase-5 切片 9 行登记修正 | §6.2 补切片 9 行（L159）事实修正（「未交付 \| #164」→ 已交付，#164+#186 落地）；同表 8/9/10 三行一致；切片 7 行显式裁决不动（#170/#171 另有修复票、状态自洽） | ✅ **落实**。修正口径与基线事实（HEAD `469ca36` = #186 交付 apps/yjs-server）一致 |

## 观察建议吸收验证

- **O-1 ✅**：§3.3 竞态表「reset 与 app 停机并发」行重写——停机窗口伪回执诚实登记为已知有限偏差（数据零丢失、重启按配置 targets 重引导），并给出不引入 stopRequested 回执翻转的理由（回执发射时序不可撤回 + 有限窗口）。E14 依据锚核心属实：`peer-connection.ts:279`（dialNow 的 `if (this.stopping) return`）+ requestRebuild 的 deferTask 内 `if (!this.stopping) this.dialNow()` + stop() 的 `onConnectionStopped` 收口链，拦截语义成立。
- **O-2 ✅**：竞态表新增 read 并发行（G5a–G5c 间 → `namespace-unknown` 瞬态；G5c 后 bootstrap 前 → `read-failed` 瞬态；均自愈）——G5a delete 引入的新瞬态窗口被同步声明，无未登记回归。
- **O-3 ✅**：§3.2 新增「SA6 断言序依赖」段（推演第 6 步前提 = 先 `waitForEvent` 再写 `count=5`，引 `test.ts:412-427` 顺序与 `hub-namespace.ts:735-743` 同步段）——与本人 R1 核验一致。
- **O-4 ❌ 核实不适用——裁决依据经独立验证属实**：本人实读 `replication-write.ts` 类型定义，`BumpReplicationEpochResult = { ok: true } | { ok: false; issues: unknown[] }`——ok 分支确为窄形状**不携带 epoch**，SA1 的否决正确，本人 R1 观察建议的前提不成立。保留 `getStatus()` 二次投影与防御分支是对的。

## 回归检查（修订引入面）

| 检查项 | 结论 |
|---|---|
| 事件面收敛（去 `restarted`） | 无回归——SA6 零消费，部署文档同步为「仅成功路径发射」 |
| G5a delete 的瞬态 `namespace-unknown` 窗口 | 已被 O-2 竞态行显式登记（瞬态、自愈、与 §4.4 诚实报告原则同源） |
| G5c set 的 owner 正确性 | 由 G4 registry ① owner 核对保障（owner 不匹配 ⟹ NOT_FOUND，到不了 G5c） |
| G2 root 门禁与 G4 input 构造的自洽 | ✓（门禁保证存在即 plain object，`'root' in args` 判定无歧义） |
| 文件半径 / 架构决策 | AD-1/AD-2/AD-3 与 §8 半径不变（R1 增量均在 `app.ts` 新 handler 体内，§8 已更新行数估算） |
| AD-3 稳定码策略 / STABLE_OP_ERROR_CODES append | 未被修订触碰，E7 依据仍成立 |

## 协议假设依据（R2 增量锚验证）

- **E11 ✅ / E12 ✅**（A-1 依据）：与本人 R1 实测逐行一致（`app.ts:549/563/117/587-590`；controllers.delete 全文件零命中）。
- **E13 ✅**（A-2 依据）：removeTarget 状态矩阵全分支有界结算 + addTarget 同步无 throw——R1 已核验。
- **E14 ✅（语义）/ ⚠（标注）**（O-1 依据）：拦截语义成立（dialNow stopping 守卫 + deferTask 条件拨号）；`271` 行的函数标注漂移（该行属 `notifyAuthChanged` 守卫而非 requestRebuild 入口）——±行级标注瑕疵，不推翻声称本体，留 SA4 校正。

## R2 残留观察（非阻塞，供 SA3/SA4 参考）

1. **E14 行级标注**：`peer-connection.ts:271` 标注为「requestRebuild 入口守卫」实际是 `notifyAuthChanged` 的 stopping 守卫；真正的拦截点是 279（dialNow）与 requestRebuild 的 deferTask 条件。SA4 静态门禁时顺带校正行号即可。
2. **竞态表 add-target (w2) 未逐子态展开**：窗口内 controller 可能处 closing（合流 `intent='active'`）或 closed（自身触发 re-add）两子态——终态均正确收敛到「重引导 + peerOwners set」，由底层幂等保证；设计粒度到窗口级已足够，SA7 动态复核若深挖可参考。
3. **切片 7 行的 #171 子项时效**：hub 停机 GOAWAY 是否已随 issue #171/#174 修复而使「已知偏差」表述过时——设计已显式裁决该行出本任务范围（「另有修复票、状态自洽」）；属交付登记完整性的独立问题，不阻塞本设计。

## R2 结论

**Latest Verdict: pass**。A-1（MAJOR）的 G5a/G5c/catch 三步维护经窗口穷尽性独立推演验证正确，R1 的两个撕裂场景（remove-target→reset-replica 序列、重引导失败后的 add-target 恢复）均被修复且恢复路径真正可达；A-2/A-3/A-4 修订到位；观察项 O-1/O-2/O-3 吸收、O-4 否决依据属实；无修订引入的回归；§9 依据锚 E1–E14 全部经本人数轮实读核验无虚引。残留三项均为非阻塞观察。同意放行至 SA3 实现；本 pass 仅覆盖设计层——实现与活链路验证归 SA4/SA7（R1 红线测试思路章节仍为有效验收参考）。
