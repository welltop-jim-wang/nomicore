# SA2 攻击评审报告

**Date**: 2026-08-31（R1）／ 2026-08-31（R2 复审追加，见 §6）
**Verdict**: R1 **reject**（轻量修订）→ **R2 `pass`**（三项 blocker 全部独立复核通过，见 §6；§0-§5 为 R1 原始评审记录，未改动）

**被审对象**：`wiki/raw/task_ws-replication-bound-early-frame-admission-in-accepttrusted_design.md`（570 行全读）
**约束基准**：`_relevant_decisions.md`（ADR-0010 唯一强相关 + 设计后复审 7 条冻结决策点）+ SA8 设计后复审 `clear`（B1/B2 边界裁决）
**审查方法**：全新视角独立重放——对设计引用的全部源码/测试/协议文档逐行核验（非采信设计自述），实跑红灯基线，对 §3.2 伪代码与 `hub-connection.ts` 现行 accept() 门 3 做逐语句同构比对。

---

## 0. 独立验证证据（本报告结论的事实地基）

| 验证项 | 命令 | 结果 |
|---|---|---|
| 红灯基线 | `npx vitest run packages/ws-replication/test/ws-replication-issue190-red.test.ts` | `Tests 3 failed \| 1 passed (4)`、`Type Errors no errors` —— 与 SA6 契约「3 红 + 1 绿保真锚」一致 |
| 根因代码 | read `hub-connection.ts:255-268` | `acceptTrusted` listener 确为无条件 `earlyFrames.push(bytes)`（:259-261），无界保留属实 |
| accept() 门 3 现状 | read `hub-connection.ts:140-239` | 三检（幂等 :156 / 单帧界 :157-163 / 条数界 :164-170）+ no-op 句柄（:152-154）+ 注册后同步收口（:177-180）—— 设计 §3.2 伪代码与之逐语句同构 ✅ |
| P1/P2 close code | read `docs/protocols/instance-replication-v1.md:335-395` | :341 `FRAME_TOO_LARGE → 1009`、:389-390「1008 身份或连接 policy 错误 / 1009 外层 frame 超限」✅ |
| P3 reason 闭集 | read 同上 `:625-645` | :636 `auth-upgrade-rejected` reason ∈ {…, frame-too-large, early-frame-limit, …}（pre-connection 无 connectionId）✅ 零新码成立 |
| P4 同步重放形态 | read `ws-replication-sa7-r2-transport.test.ts:127-141` | 真实 TcpTransport `onMessage` 注册即 `pendingFrames.splice(0)` 循环同步投递、先于 return ✅（fixture 非臆造） |
| P6/P7 caller 与守卫先例 | read `apps/yjs-server/src/app.ts:268-275`、`index.ts:364-382` | :274 `void acceptTrusted.call(...)` fire-and-forget 属实；:375-382「accept 永不 reject = 包缺陷」响亮 handler 属实；safeCloseTransport「吞二次异常」注释属实 ✅ |
| P8 observer 隔离 | read `observer.ts:29-39` | `dispatchReplicationObserver` try/catch 静默隔离 ✅ |
| P9 零 await | read `hub-connection.ts:241-290` | `acceptTrusted` 全函数无 `await`（async 仅签名）✅——「单同步段、唯一可达拒绝源是同步重放帧限」成立 |
| 锚存在性 | read `ws-replication-auth-lifecycle-red.test.ts:616-690` | A2-d（:618-630 超时封顶）、trusted-HELLO（:632-653，`replayedCount()===2`/`state==='closed'`）、A2-e（:655-678，1009/1008 + `replayedCount 1/17` + 零分配）全部在位且与设计引用吻合 ✅ |
| 红灯 fixture 语义 | read `issue190-red.test.ts:60-112` | `onMessage` 注册即迭代完整 backlog（不因 close 中断）→ 修复后 `replayedCount` = 积压条数推导正确；`pump` 迭代当前 listeners → detach 后零投递推导正确 ✅ |

**结论**：设计 §12 全部 9 条协议假设依据均可定位、可复核，无「应该/通常/预计」类无据推断；§1 根因、§5.2 保真推演、§8.2 锚表与代码/测试实况逐项吻合。

---

## 1. 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| 1 | **MAJOR** | #172 双标注执行义务缺位（ADR-0010 #172 修订节 / 相关决议冻结点 7 / SA8 B2 附带义务） | 设计 §10「SA3 实现指引」列了 4 项改动落点，**未包含** #172 双标注义务；且 §3.1 的机制 doc comment 草稿只写「phase5 R2 A2（有界化）+ R3 N1（同步重放句柄安全）立法的收敛实体」——**无权威指向**。SA3 以 §10 清单为施工合同，照抄草稿落源码后，源码将以 `wiki/raw`（phase5 design 所在地）为唯一契约来源，直接违反 ADR-0010 #172 修订节「源码与规范中的公共行为表述必须指向 CONTEXT.md、ADR 或 docs/protocols/」。现行 `hub-connection.ts:42` 的 `MAX_EARLY_FRAMES` 注释本就只有「§3.2 R2 A2」无权威指向（grep `docs/protocols` 在 `packages/ws-replication/src/` 零命中）——本任务的注释扩展正是补双标注的时机，设计反而固化了旧形态 | ① §10 落点清单增补第 5 项：「#172 双标注义务：`MAX_EARLY_FRAMES` 注释扩展与机制 doc comment 中凡引用 phase5 立法处，须并置权威指向（帧限拒绝语义 → `docs/protocols/instance-replication-v1.md` §13.1/§14/§23 reason 表）+ 历史证据（phase5 design 立法沿革）」；② §3.1 注释草稿补一行权威指向示例，供 SA3 直接采用 |
| 2 | **MINOR** | §3.4 拒绝路径 close 守卫（E10）零验证载体 | §3.4 是全设计**唯一**超越「原样收敛」的新增代码路径（`closeAdmission` try/catch），但：SA6 两测试文件断言冻结、§11 ALLOW LIST 无新测试文件 → 该 try/catch 在全部现存 fixture（close 均不抛）下是**死代码**，无任何测试或验证计划。设计自己在 E10 行承认「无既有测试——契约内零差异」。死守卫的风险：SA3 笔误（如 catch 块内误置状态、吞错后漏 emit）在红/绿锚全绿下不可见，只能靠 SA4 目测。设计声称的「把 promise reject 收窄为 resolve undefined」这一行为变更面完全无验证闭环 | 设计指定验证载体，二选一：①（推荐）§11 ALLOW LIST 增补新测试文件（如 `packages/ws-replication/test/ws-replication-issue190-guard.test.ts`，SA3/SA7 owned）： throwing-close fixture（`close()` 恒 throw）+ 单帧超界同步重放 → 断言 `resolved:'undefined'`、`rejectedReasons:['frame-too-large']`、`collectUnhandledRejections` 空、`replayedCount` = 积压条数（无守卫实现会在 listener 内 throw → 重放流产 + promise reject，测试即红）；② 若坚持零新测试文件，§10 验证块须显式写入「SA7 以 throwing-close probe 手工验证 §3.4 并在报告留命令+输出」 |
| 3 | **MINOR** | I6「机制自身零 throw 路径」声明过强 | §3.3 I6 论证枚举「标志赋值/守卫 close/隔离 emit 均不可抛」，漏掉了 listener 首检前的 `bytes.byteLength` 属性访问本身：契约外帧载荷（`null`/`undefined` 传入 listener）会 TypeError，经 `transport.onMessage(...)` 调用点展开 → promise reject → `app.ts:274` unhandledRejection——即 I6 的绝对表述在契约外输入下不成立。**非回归**：现行 accept() 门 3（:157）同暴露面，且 `HubConnectionImpl.onMessage` → `decodeInbound` 在现行 trusted 路径同样会抛；TS 类型（`Uint8Array`）已封死包内调用方。问题仅在声明精度：I6 是 SA4 静态复核与 SA7 动态验证的**基准不变量**，过强声明会让复核得出假阴性违规 | I6 措辞收敛：「机制零 throw 路径**在契约内帧载荷（Uint8Array）下**成立（标志赋值/守卫 close/隔离 emit 不可抛；`bytes.byteLength` 访问的契约外载荷暴露与现行 accept() 门 3 同面，非本任务新增）」。不需要代码改动——加 typeof 守卫反而破坏「与 accept() 门 3 逐语句一致」的等价性论证 |
| 4 | INFO | accept() 门 3 纯早断静默 vs acceptTrusted 发 `peer-disconnected` 的既有不对称 | accept() 注册后收口段 `if (authRejected \|\| earlyClosed) { detachEarly(); return undefined; }`（:177-180）对**纯早断（无拒绝）**零 observer 事件；acceptTrusted 同形输入发 `peer-disconnected`（:275-279）。设计对两者均原样保留（正确——AC4 要求 token 路径零变化，且该不对称属 phase5 已评审形状）。列出仅为：SA7 探针两入口早断路径时**不要把 accept() 的静默误判为本任务回归** | 无修订要求；建议 SA7 报告将其记为「已知既有形状」 |
| 5 | INFO | E12 敌意 transport 无限同步重放 | 设计坦白承认「无限循环本身是同步回调契约的通性问题（timer 无法抢占同步代码），非本层可解」——定性正确：admission 三检保证每帧 O(1) 且第 17 帧后零保留，内存界不受影响；剩余暴露面（CPU）属 transport 自身契约，且 trusted transport 本就是 Host 授予的可信代码（ADR-0010 §NamespaceLease，设计 C5 定位准确） | 无修订要求 |

**未成立而放弃的攻击**（攻击过但被设计/代码证伪，记录供 SA4/SA7 免重讼）：

- 「acceptTrusted 收口段 `isRejected()` 与 `this.closed` 复查顺序引入新行为」——不成立：函数体零 await（P9 实证），`this.closed` 在单同步段内不可翻转，顺序调整无行为面；且 §5.1 拒绝优先于 `transport.closed`/`earlyClosed` 的论证经 fixture 语义核验成立（拒绝 close 确使 `transport.closed === true`，先查必误分类 `peer-disconnected`）。
- 「守卫 close 吞异常导致 transport 悬挂无人收口」——部分成立但非本任务回归：契约内（生产 `wrapWs`，`ws.close` 无同步 throw）零发生；契约外形态下现行 gate 0/1 的未守卫 close 同样无人兜底且更糟（promise reject → unhandledRejection 进程级风险）。§3.4 与 `safeCloseTransport` 先例同款纪律，SA8 B1 已裁决。残局归属已在设计 §3.2 注释草稿中成文。
- 「auth timer 路径 markRejected/detach/close/emit 的次序竞态」——不成立：timer 回调为同步段，markRejected 与 detach 间无投递点；帧限与超时共用 `state.rejected` 后 listener 幂等早退读同一标志，与现行 `authRejected` 单闭包标志语义同构。
- 「§4 重写 accept() 破坏 A2-d 零宽窗口（queueMicrotask 让出）」——不成立：设计保留让出语句与让出后 `isRejected()` 复核，位置与现行 :208-214 逐句对应。

---

## 2. 协议假设依据审查

**章节存在性**：✅ `§12. 协议假设依据 (Protocol Assumption Evidence)` 在位，P1-P9 九条全数列出。

**依据可验证性**（SA2 独立复核，不采信设计自述）：

| 假设 | 复核结果 |
|---|---|
| P1/P2（1009/1008 + `'upgrade-frame-limit'`） | ✅ 源码 :157-170、A2-e 绿锚断言、protocol doc :341/:389-390 三重印证，逐行比对吻合 |
| P3（reason 闭集已文档化） | ✅ protocol doc :636 闭集恰含 `frame-too-large`/`early-frame-limit`，pre-connection 无 connectionId 字段与 `emitUpgradeRejected`（:96-114）实现吻合——「零新码、零文档变更」成立，相关决议衍生约束（落点在 protocol doc）前提确不触发 |
| P4（同步重放为实存形态） | ✅ `sa7-r2-transport.test.ts:127-141` 真实 TcpTransport 形态实证 |
| P5（`MAX_EARLY_FRAMES=16` 立法值） | ✅ `hub-connection.ts:46` 模块常数实证 |
| P6（恒 resolve 包级不变量） | ✅ `index.ts:375-382` 注释 + 显式 rejection handler；`app.ts:274` fire-and-forget 无 handler 属实——I6 的必要性论证成立 |
| P7（close 可能抛出需守卫） | ✅ `index.ts:364-368` safeCloseTransport 先例属实 |
| P8（observer 隔离） | ✅ `observer.ts:34-38` 实证 |
| P9（trusted 窗口零 await） | ✅ `acceptTrusted` 全函数无 await 实证 |
| 依据栏用词 | ✅ 无「应该/通常/预计」类无据推断；全部为可定位的源码行号/测试行号/协议文档行号 |
| 「实测验证」类声明 | 设计未声称新实测；红灯基线实测由 SA6 承担且本 SA2 已复跑确认（3 红 1 绿）——合规 |

**判定**：§12 合规，无需补章节。唯一关联缺口见攻击点 #1（P1-P3 的权威指向已正确指向 protocol doc，但该纪律未传导至 §3.1 源码注释草稿与 §10 施工清单）。

---

## 3. 错误处理链路审查

本任务为 transport 接纳层 bugfix，无前端/UI 交互面；按四项纪律审查：

- **静默失败检查**：拒绝路径全部响亮——close(1009/1008, `'upgrade-frame-limit'`) + `auth-upgrade-rejected` observer 事件 + 恒 resolve undefined（调用方语义：undefined = 包已按自身语义收口，`index.ts:375` 注释已文档化该契约）。无「无请求发出 + 无反馈」路径。✅
- **状态闭环检查**：拒绝一次定型（I2：恰 1 次 close、恰 1 条事件、后续帧幂等早退、事后 pump 无处投递）——AC1-AC3 快照字段（`closeInfos` 恰 1 条、`rejectedReasons` 恰 1 条、零 `connection-failed`/`connection-state-changed`）构成完整闭环断言。✅
- **降级路径检查**：不适用（无外部依赖服务面；transport 契约外形态见 §3.4 守卫，与 `safeCloseTransport` 生产先例同款）。✅
- **虚假降级识别**：✅ 无伪降级。设计 §2 显式对照 phase5 §12 定性——越界早到帧是异常路径，处理方式是显式 fail-closed 拒绝（close + 稳定 reason + observer 事件），不是把正常路径前提缺失包装成降级。§3.4 守卫的 catch 仅覆盖 transport 契约外形态（正常流程中不应发生 = transport 自身缺陷），且效果是「收窄进程级风险」而非掩盖协议状态——与「伪降级掩盖 bug」的判据不符，残局归属已显式成文（「残局归 transport 所有者」）。

---

## 4. 红线测试思路

> 攻击点 #1（#172 双标注）为文档合规义务，无 IT 载体——由 SA4 静态复核执行（检查源码注释双标注形态：权威指向 + 历史证据并置）。

**RT-1（对应攻击点 #2，§3.4 守卫行为锁定）**：
- 场景：`makeReplayTransport` 变体 fixture，`close()` 恒 `throw new Error('boom')`（其余面同款）；backlog = 1 帧超界（`CONTRACT_LIMITS.maxFrameBytes + 1`）+ 2 帧常规尺寸（共 3 帧，验证重放循环不流产）。
- 断言（快照式 toEqual）：`resolved:'undefined'`、`rejectedReasons:['frame-too-large']`（事件仍发——吞的是 close 异常不是拒绝效果）、`connections:0`、`replayedCount:3`（close throw 不得展开到 `onMessage` 调用点流产循环）、`probe.events:[]`（恒 resolve 不掉到 unhandledRejection）。
- 红灯性：无守卫实现下 listener 内 throw → fixture 重放循环中断（`replayedCount:1`）+ acceptTrusted promise reject → `await p` 抛出 → 测试红。天然区分「守卫在」与「守卫不在」。
- 落点：需 §11 ALLOW LIST 增补新测试文件（SA6 两文件断言冻结，不可承载）。

**RT-2（对应攻击点 #3，I6 边界文档化后的回归锚，可选）**：
- 场景：契约外载荷 probe（`transport.onMessage` 直接以 `undefined` 调 listener）→ 预期与现行 accept() 同面（throw → promise reject），仅用于固化「非本任务新增暴露」的基线记录，防止未来有人以 I6 过强声明反推本任务引入回归。若 SA1 采纳 #3 的措辞收敛，本测试可不做。

**既有红灯契约（SA6 已就位，无需 SA2 重写）**：AC1/AC2/AC3 + 保真锚的快照断言已完整覆盖 I1-I5（`replayedCount` = 积压条数锁 I5、`closeInfos` 恰 1 条锁 I2、`connections:0` 锁 I3、pump 段锁 I4）；本 SA2 已核验其 fixture 语义与设计 §5/§6 推演逐项自洽。

---

## 5. 裁决与放行条件

**核心机制裁决**：D1（共享 admission 单点）、D2（accept() 等价收敛）、D3（acceptTrusted 修复）经竞态矩阵重放、资源账复核、锚表逐项比对、伪代码-现行代码逐语句同构 diff——**未发现任何 CRITICAL/高危缺陷**。方案选择（共享单点而非双份内联）与被否方案 A-E 的否决理由均成立。不变量 I1/I2/I4/I5/I7/I8 论证完整；I3/I6 论证成立但 I6 措辞需收敛（攻击点 #3）。

**Verdict: reject** —— 以下 3 项修订完成后即可复审放行（预计为纯文档级修订，无需重做设计）：

1. （MAJOR）§10 增补 #172 双标注义务条目 + §3.1 注释草稿补权威指向（攻击点 #1）；
2. （MINOR）为 §3.4/E10 指定验证载体：推荐 ALLOW LIST 增补 RT-1 新测试文件，或在 §10/§7 明确 SA7 throwing-close probe 验证义务（攻击点 #2）；
3. （MINOR）I6 声明收敛至「契约内帧载荷」限定（攻击点 #3）。

攻击点 #4/#5 为 INFO 记录，无修订要求。`pass` 后仍需 SA4 静态复核与 SA7 活链路验证接力——本报告不替代。

---

# §6. R2 复审（SA1 R1 修订后）

**Date**: 2026-08-31
**R2 Verdict**: **`pass`** —— R1 三项 blocker（§5 放行条件 1-3）全部独立复核通过；R1 修订零行为漂移、零范围蔓延；无新增攻击面。设计放行 SA3。

**复审对象**：R1 版设计（666 行全读，含头部 R1 版本表与「SA2 反馈逐条回应」表）。
**复审方法**：不采信回应表自述——对每项修订落到设计原文与仓库实况独立核验；RT-1 规格做了双 variant 独立推演（守卫在/不在）；比对 R0→R1 全部章节确认无行为面改动。

## 6.1 Blocker #1（MAJOR · #172 双标注）—— ✅ 已解除

| 核验项 | 独立验证结果 |
|---|---|
| §3.1 注释草稿补「权威指向 + 历史证据」 | ✅ 草稿新增两段：权威指向 = 帧限拒绝对外语义以 `docs/protocols/instance-replication-v1.md` 为准（§14 close-code 分类、§23 observer reason 表）；历史证据 = phase5 issue #138 §3.2 R2 A2/R3 N1（标注 `wiki/raw` 非规范沿革角色） |
| 权威指向章节号实存性 | ✅ `grep -n "^## " docs/protocols/instance-replication-v1.md`：§14「WS close code」:384（:389-390 1008/1009 分类在内）、§23「Observability seam」:595（:636 reason 闭集在内）——两处指向均准确落点 |
| §10 施工义务成文 | ✅ §10 落点第 5 项把双标注固化为 SA3 施工合同条目（含 SA4 静态复核检查点、模板行指引）；§3.1 代码块后附「#172 双标签示范」说明 |
| 既有欠账修正 | ✅ §10 第 4 项将现行 `hub-connection.ts:41-46` 单标注欠账纳入本次注释扩展——与 SA2 R1 grep 实证（`docs/protocols` 在 `packages/ws-replication/src/` 零命中）吻合；同文件注释级改动，不越 ALLOW LIST |

## 6.2 Blocker #2（MINOR · §3.4/E10 验证载体）—— ✅ 已解除

§10.1 RT-1 全规格独立推演（双 variant）：

- **有守卫（目标态）**：backlog = [超界帧, 32B, 32B] → 帧帧 1 触发单帧界：`state.rejected = true` → `closeAdmission` 吞 close throw → `emitFrameLimitRejected('frame-too-large')` 照发 → 帧 2/3 幂等早退 → fixture 循环完整走完（`replayed += 1` 先于 `listener(bytes)`，故 3 帧全计）→ 收口段 `isRejected()` 首检 → detach → resolve `undefined`。断言快照四字段（`resolved:'undefined'` / `rejectedReasons:['frame-too-large']` / `connections:0` / `replayedCount:3`）+ `probe.events:[]` **全部可达**。快照正确省略 `closeInfos`（fixture close 在记录前即 throw）——规格自洽 ✅。
- **无守卫（红灯性）**：帧 1 `transport.close` throw 经 listener → fixture for 循环首帧即断（`replayedCount:1` ≠ 3）→ 异常经 `transport.onMessage(...)` 调用点展开 → `acceptTrusted` promise reject → `await p` 抛出 → 测试红。**「守卫在/不在」区分度成立** ✅。
- **联动完整性**：✅ §11 ALLOW LIST 增补（`[SA3/SA7 owned]`、断言以 §10.1 为准不得偏离）+ §8.2 锚表新行 + §6 E10 锚列更新（「无既有测试」→ RT-1）+ §13 caller 清单只增不删 + §10 验证命令块（guard 文件单跑 + 「45 文件全绿」——与现基线 44 文件 + 1 新文件计数一致）。

## 6.3 Blocker #3（MINOR · I6 措辞）—— ✅ 已解除

✅ §3.3 I6 重写为「契约内帧载荷（`Uint8Array`）限定」+ 显式边界登记（`bytes.byteLength` 契约外载荷 TypeError 经 `onMessage(...)` 调用点展开；与现行 accept() 门 3 `:157` 同面非新增；TS 类型封死包内调用方）+ 不加 typeof 守卫（保留逐语句等价论证——与 SA2 R1 裁定一致）+ RT-2 按 SA2 明示免做。✅ 措辞已正确传导至 §13 caller 审计（app.ts:274 行注明「契约内输入限定」）。

## 6.4 R1 修订面新攻击扫描（防修订引入新缺陷）

- **行为面零漂移**：§3.2 伪代码、§4 accept()、§5 acceptTrusted、§5.1/§5.2、§9 被否方案、§12 P1-P9 与 R0 逐段比对**内容不变**（仅 §6 E10 锚列、§8.2 加行、§10/§11/§13 增补合规与验证载体）——R1 是纯文档级修订，与 R1 版本表自述一致 ✅。
- **范围纪律**：唯一新增落点 = 注释欠账修正（§10 第 4 项，同一 ALLOW LIST 文件内）+ 新测试文件（§11 增补，SA2 指定载体）——无越界 ✅。
- **工作区实况**：`git log -1` → `b66615c`（HEAD 未动）；`git status` 除 `wiki/raw` 与 SA6 红灯文件外零改动——R1 未触碰业务代码/测试 ✅；红灯基线复跑 `3 failed | 1 passed (4)`、`Type Errors no errors`——与 R1 记录一致 ✅。

## 6.5 剩余事项（非 blocker）

| # | 级别 | 事项 | 处置 |
|---|---|---|---|
| N1 | INFO | §3.1 模板把 §14 与 §23 并称「唯一 wire contract」——protocol doc 自身将 §23 标题为「Observability seam（**local，非 wire 契约**）」：§23 是 observer 面的权威落点但非 wire 契约。ADR-0010 原句（错误码/close code/时序以该文档为唯一 wire contract）已把观察面折入同句，模板措辞与 ADR 框架一致，不构成违规 | SA3 落源码注释时可精化为「以 docs/protocols/instance-replication-v1.md 为唯一权威（§14 wire close-code 分类；§23 observer reason 闭集——local seam）」；不强制，SA4 复核不以此为否决点 |
| N2 | INFO | §10 第 1 项机制行数估计 ≈60 行 vs §11 同条目 ≈55 行——纯估算口径差，无实质 | 无需处置 |

**R2 放行声明**：设计（R1 版）满足简报 Required outcome 1-5 与 Acceptance criteria 1-5 的全部设计侧要求；R1 三项 blocker 清零、零新增攻击面。`pass` 仅覆盖设计层——SA3 实现须按 §10/§10.1 规格执行（RT-1 与 §3.1 双标注模板为施工合同），SA4 静态复核（重点：双标注形态、I6 限定措辞落码、收口检查序）与 SA7 动态验证（重点：3 红→绿 + RT-1 守卫锚 + 全仓回归）接力。
