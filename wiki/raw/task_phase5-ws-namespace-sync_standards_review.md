# Standards Review（规范与可维护性轴） — `@nomicore/ws-replication`（issue #136 切片 6 完工前终审）

- **轴**：Standards review（仓库规范 / 术语纪律 / 测试要求 / 生命周期防御模式 / 可维护性）；本轴不做实现、不改代码。
- **日期**：2026-08-30
- **审查 diff range（逐字）**：`ff50d47..f557b68`（`git diff ff50d47..f557b68`）
- **审查对象**：新建包 `packages/ws-replication`（15 src + 11 test 文件）+ 根 `package.json` typecheck 枚举单行追加 + `pnpm-lock.yaml` 接线 + `wiki/raw/task_phase5-ws-namespace-sync*` 任务档案族。
- **验收基准**：`wiki/raw/task_phase5-ws-namespace-sync_design.md`（R4.2，含 §23 R-11/R-12 登记）；**规范基准**：`CONTEXT.md`、`docs/adr/`（尤其 0010 含 #133/#134 修订节）、`AGENTS.md`、`docs/protocols/instance-replication-v1.md`。
- **既有评审链核对**：SA2 R3 pass / SA4 R3 pass / SA7 R2 pass（本轴不重复其三轴覆盖面，仅在其未覆盖的规范/可维护性面独立取证）。

**Verdict（当前，R2 复审）**: **clear** —— R1 唯一阻塞项 B-1（EOF 空行 / `git diff --check` exit 2）已消解并经本轴复核通过；R1 后新增 delta（Spec B-1/B-2 竞态簇修复 + SA4 R4-1~3 / SA7 D2 回流修复，commits `0336dce`/`0324d8f`/`6ab9e32`/`12258c2` 等）经全轴复扫**零新增规范违规**。证据与发现详见文末「R2 复审节（diff range `ff50d47..51bcbd5`）」。

**R1 Verdict（历史，保留）**: **has-blocking-findings**（1 条硬性违规 B-1：设计 §22 验收命令 `git diff --check` 未通过——单字节化妆品级，修复成本一行；其余全部为 non-blocking 判断性意见）。规范主体面（包形态、术语、测试纪律、timer 纪律、错误码闭集、零回显、接线）**全部通过**。

---

## R1 正文（历史，原样保留）

## 一、独立复跑验证（本轴亲跑，非转述）

| 命令 | 结果 |
|---|---|
| `pnpm exec vitest run packages/ws-replication` | ✅ 10 文件 / 74 测试全绿（含 9 条 `api.test-d.ts` 类型测试），exit 0 |
| `pnpm typecheck`（根枚举，含 `packages/ws-replication/tsconfig.json`） | ✅ exit 0 |
| `git diff --check ff50d47..f557b68` | ❌ **exit 2**：`packages/ws-replication/test/ws-replication-r3-r4-regressions.test.ts:342: new blank line at EOF`（唯一诊断） |
| diff 范围 vs 设计 §21 ALLOW/DENY LIST | ✅ 仅触 `packages/ws-replication/**`、`pnpm-lock.yaml`、根 `package.json`（R4.1 勘误追认项）、`wiki/raw/**`；DENY 内既有包/根配置零触碰 |

## 二、分轴结论

### A. 仓库惯例（对照 replication-protocol / namespace-registry 先例）——✅ 通过

- `package.json` 形态与先例逐字段一致（`private`/`type:module`/`exports` `.`+`./testing`/`typecheck` 脚本/workspace 协议依赖写法）；`/testing` 子路径先例（namespace-registry）成立。
- `tsconfig.json` 与 replication-protocol **逐字节相同**（`extends ../../tsconfig.base.json`，include src+test）。
- `src/index.ts` 与 replication-protocol 同款：中文 JSDoc 头 + 纯 re-export 零逻辑；冻结契约面（设计 §2）逐字段核对**无增删改名**（15 类型 + 3 DEFAULT 常量 + 2 工厂 + `/testing` 导出）。
- 注释/文档风格与仓库一致：中文 JSDoc + `═══` 分节横幅 +  pervasive 设计条款溯源（`§x.y`/ADR/协议锚），与 payloads.ts 等既有文件同款纪律。
- 模块分解与设计 §3 **15/15 文件逐一对应**，职责注释与 §3 描述一致；`hub-namespace.ts`（839 行）/`peer-namespace.ts`（897 行）超出 §21 的 ≈300/≈320 估算（估算符号为「≈」，超出部分为 OPEN 矩阵与错误映射路径实体，非违规，仅注记）。
- 接线：`pnpm-workspace.yaml`（`packages/*`）、`vitest.config.ts`（include/typecheck 通配）、`tsconfig.typecheck.json`（通配）均零改动覆盖本包（P-12 勘误后与 §21 一致）；根 `package.json` typecheck 枚举追加单行为 R4.1 授权项（commit `0cd1ae6`），`pnpm-lock.yaml` importers 条目与 manifest 逐值一致。
- wiki 档案族命名/结构与既有任务（如 `task_doc-runtime-*`）一致。

### B. CONTEXT.md 术语与 avoid 清单纪律——✅ 通过

- avoid 清单扫描（`master|slave|leader|follower|mutation queue|validateSnapshot|SCHEMA_REGISTRY|resolveChild|已关闭 Runtime`，src+test 全量，大小写不敏感）：**零命中**。
- 冻结词汇正确使用：写序列器（write sequencer，apply 唯一入口纪律）、`ReplicationSession` 窄能力（transport 全程未接触裸 Y.Doc——peer 侧唯一 `new Y.Doc()` 为 §8 明文规定的 detached bootstrap 预演，`peer-namespace.ts:294`）、`needs-resync`/`conflicted` 终态语义与 Registry 冻结一致；Hub/Peer 术语遵守 ADR 0010 L106/L109。
- owner 纪律：wire 帧零 owner（AC1 锚测试扫描佐证）；`authorize(instanceIdentity, namespaceId)` 签名不含 owner；与 CONTEXT《namespaceId》词条「owner 不上 wire」一致。

### C. 测试要求——✅ 通过

- **零 real sleep**：src/test 全量扫描 `setTimeout|setInterval|setImmediate|Atomics|Date.now|performance.now` ——仅三处接口类型声明（注入 `ReplicationTimer` 形状），零调用点；时间推进全部经 `RegistryTestScheduler.advanceBy` + 微任务 `settle()`/`settleUntil()` 有界预算（harness.ts:215-232）。
- **确定性 fake-duplex**：`makeDuplex`/`makeWire`（harness.ts:520-692）微任务投递 + `bytes.slice()` 隔离 + 选择性丢帧/双侧 close 故障注入 seam；测试用真实 yjs / 真实 Registry+Runtime，Persistence 仅 stub 承担可编程载体（saveGate/importHold/setStatus），不 mock 被测对象。
- **零源码 grep 断言**：test 目录零 `node:fs`/`readFileSync`/源码文本断言；断言全部落在 wire 帧（decode 后）、状态投影、收敛数据上。
- **基建与断言分层**：三层清晰——`harness.ts`（调度器/stub/duplex/帧观测原语 + `CONTRACT_*` 冻结镜像，与 `defaults.ts` 逐值一致 ✅）、`driver.ts`（编排/观测/注入 seam，SA4 F3 配套的序列记账纪律已文档化 driver.ts:280-298）、`*test.ts`（纯断言）。
- 注入序列纪律：`injectPeer/injectHub` 默认 `nextSeq = 已见最大 + 1`，撞号不变量成文（SA4 F3 修复配套），符合 §4.1 ADR 字面定案。

### D. 生命周期 / 防御模式——✅ 主体通过（意见见 N-2/N-3/N-8）

- **timer 纪律（零 native timer）**：✅ src 全部延迟经注入 `ReplicationTimer`（连接 hello/backoff/resetAfter、ns open/bootstrap/reconcile/close、watchdog 空闲节奏、GOAWAY drain——逐一核对 `peer-connection.ts:493-528`、`peer-namespace.ts:855-881`、`hub-namespace.ts:812-835`、`fence-watchdog.ts:56-66`）；watchdog D1 修复（回调内先清 `idleArmed` 再重武装，`fence-watchdog.ts:59-65`）与 N1 修复（HELLO_ACK 同步段解除 hello timer，`hub-connection.ts:217-219`）均已落地且注释溯源。
- **资源清理/零泄漏**：双侧控制器收口路径同构完整（`closeSessionAndRelease`：session.close → unsubscribe → watchdog/round/channel `teardown()` → lease.release；timer `clearAllTimers` on finalize；连接级 stop/close 清全部连接 timer 并等待通道 cleanup）。`LifecycleQueue.enqueue` 失败不阻断后续（恒绿 cleanup 链）。SA7 W1 动态锚（teardown 后推进零新帧）佐证。
- **错误分类学闭集**：包产出的全部 wire 码 ∈ replication-protocol 注册表（逐一比对 `errors.ts` CONNECTION/NAMESPACE 两表）；codec `encodeError`/`decodeError` 在注册表外直接 throw/malformed（payloads.ts:264/310-312），闭集由 codec 边界强制；终态映射经 `lookupError().terminalState` 单点驱动（`error-mapping.ts:38-40`）；消费侧 session 拒绝码闭集恰为 ADR 0010 #134 冻结六码（`error-mapping.ts:11-17`）。
- **零回显/owner 不泄露（I-2）**：`safeMessageFor` 为静态模板 `protocol error: <code>`（frame-io.ts:30-32），零 owner/token/身份值/内容回显；构造期 TypeError 只回显配置数值（非敏感面）；测试侧 AC1/AC2 有 `not.toContain(owner)` 扫描锚。
- **迟到纪律/终态不降级**：§13.4 在各 resolve 点一致落实（`isTerminal()`/`isQuietState()` 门禁 + 静默回收）；closing 期 terminal 帧只推进收口（R3/#5d）。

### E. 可维护性——✅ 主体通过（死代码/半残面见 N-1；已知登记项确认见第四节）

- 设计 §3 模块分解 15/15 对应（见 A）；包内无私有路径绕过（一切 Registry/Runtime 交互经公开/lease 面；`@nomicore/persistence` 仅 devDep 测试消费，src 零 import ✅ 与 §1「经 Registry 间接消费」一致）。
- src 生产依赖实测：yjs ✅（peer bootstrap 预演）、两个 workspace 包 ✅；`lib0`/`y-protocols` 声明但未 import（见 N-7）。
- 无 FIXME/TODO 堆积；无 `console.*`；排他性 switch 全部 `never` 收口。

## 三、硬性违规（blocking）

### B-1 `git diff --check` 未通过——测试文件 EOF 多余空行（违反仓库单换行尾规范与设计 §22 验收命令）

- **证据**：`git diff --check ff50d47..f557b68` → exit 2，唯一诊断 `packages/ws-replication/test/ws-replication-r3-r4-regressions.test.ts:342: new blank line at EOF`。字节级复核：文件尾为 `});\n\n`（342 行，末行为空行）。
- **规范依据**：(a) 仓库规范为 POSIX 单换行尾——抽样既有包 8 个测试文件（replication-protocol/namespace-registry）尾字节均为 `3b0a`（`;\n`），零 `0a0a` 先例；(b) 设计定稿 §22「验证命令」明文列入 `git diff --check`——验收基准自带的门禁命令当前**不通过**。
- **影响评估**：纯化妆品级；CI 门禁（`.github/workflows/ci.yml`：typecheck + test）不覆盖 `diff --check`，不阻塞绿灯；修复为单行删除（删 342 行空行）。
- **处置建议**：SA3/S A6 任一侧删行即可（测试文件归 SA6 所有，按纪律建议 SA6 执行）；本轴不要求功能改动。

## 四、已知登记项排除确认（不算违规）

| 登记项 | 实现形态核实 | 结论 |
|---|---|---|
| R-11（设计 §23，切片 7 演进位） | `OutboundQueue.sendData` 直发旁路（frame-io.ts:124-127 `void namespaceId`）、`dataQueues`/round-robin 未被喂入（:102-104）、`lowWater`/`highWater`/`maxQueuedBytesPerConnection` 仅 defaults+validate 零消费、`CONNECTION_BACKPRESSURE` 无实现面；UPDATE 大小门先于 state/submit 门（hub-connection.ts:260 连接层判定） | 与登记文本逐点一致；v1 内存同步 transport 下结构性不可达；**排除**，指向切片 7 |
| R-12（设计 §23，切片 9 演进位） | GOAWAY `SERVER_RESTARTING` 仅 deadline 关连接、未停新 OPEN/round（peer-connection.ts:336-347，注释已划界「slice 9 前不做 deadline 完整编排」） | 与登记文本一致；**排除**，指向切片 9 |

## 五、判断性意见（non-blocking）

> 全部为判断性/化妆品级；不构成本轴放行障碍，建议随切片 7/9/10 或下一修订轮顺手收口。

### N-1 死代码 / 半残面簇（src，逐条附证据）

1. **`LifecycleQueue` 类零实例化**（lifecycle-queue.ts:7-24）：全包仅 `Memoized` 被消费（peer-namespace.ts:14/74/501/511）；per-ns 串行化由两控制器各自重造（peer `cleanupTail` 链 peer-namespace.ts:73/842-849；hub `closeQueue` 链 hub-namespace.ts:83/503-517）。设计 §3/§13.1 以 lifecycle-queue 为双侧统一串行器——当前形态 = 死类 + 两处 ad-hoc 重实现。建议：双侧接入 `LifecycleQueue` 或删除该类。
2. `HANDSHAKE_OR_READY`（peer-connection.ts:30）声明零使用（grep 全包仅声明点）。
3. `cleanupTail` 字段（hub-namespace.ts:82）声明零使用。
4. hub 侧 `TimerKind` 含 `'close'`（hub-namespace.ts:59）但 `armTimer('close')` 零调用点、timer 回调只处理 `'bootstrap'`（:815-822）——死配置（SA4 R1 §过度设计已注记，仍存）。
5. 空 if 化妆性死代码（SA4 已注记，仍存）：peer-namespace.ts:790-791（`if (state === 'failed') {}`）、peer-connection.ts:325-327（`if (message.hasLocalReplica) { /* 仅注释 */ }`）。
6. `void this;` 死表达式（peer-connection.ts:340）；`goawayDrainMs` 实例字段（:339/349）可作 `scheduleDrainClose` 形参。
7. 哨兵类型再导出零消费：`UpdateChannelControl`（update-channel.ts:180-181）、`WatchdogTimer`（fence-watchdog.ts:125-126）。
8. `HubDocHandle = Y.Doc`「类型锚」（hub-namespace.ts:838-839）：index.ts 未再导出、零消费；且是 `hub-namespace.ts:6` `import * as Y from 'yjs'` 的**唯一**消费点——删锚即删 import。
9. `void _hubIdentity`（hub-namespace.ts:405）：形参仅为被 void 而携带，可删形参。
10. **`openWaiters` thunk 从不被调用**（hub-namespace.ts:72/162-166/171/201 vs 326-340）：`'closing'` 分支 push 的「发送 REOPEN 错误」thunk 无任何调用点（消费方把 waiter 当计数器迭代，从不执行）；`finishOpenSilently`（:348-352）清空而不作答。后果：hub 通道 `closing` 窗口内到达的重复 OPEN 永远收不到 `NAMESPACE_REOPEN_REQUIRES_RECONNECT` 应答（§7.0a 合流语义在该分支未闭合）。可达性极低（hub 'closing' 仅由 peer CLOSE 进入，I-5 下诚实 peer 同连接不会再 OPEN；对端有自身 openTimeout 兜底），定级 non-blocking；建议切片 7 随 R-11 一并收口（或在 0a 合流表中注明 closing 分支不作答的理由）。

### N-2 ACK 计时不在每笔 ACK 重置（§10.3「删除 + 重置计时」/§16「覆盖最老 in-flight」的偏离）

- **证据**：update-channel.ts:74-86——`onAck` 删除后仅当 `inFlight.size === 0` 才 `disarmAckTimer`（:77）；持续流量下 in-flight 不空 → 计时锚定「本计费周期首笔登记时刻」，`ackTimeoutMs` 到点即整体 `abandonInFlight`（:141-149），较年轻的在途项被提前弃置。
- **方向**：安全侧（needs-resync + 同连接 round 修复，§5.3 零数据丢失论证成立）；仅效率/活性面偏差（持续负载下可能产生伪 resync 周期）。冻结测试无持续流量时序锚，故未暴露。
- **建议**：切片 7/8 接入真实 transport 时按 §10.3 字面实现「每笔 ACK 重置（或按最老项重锚）」，或设计侧把现行语义成文化。

### N-3 入站字段级限额只覆盖 UPDATE（SYNC_STEP2 / BOOTSTRAP_SNAPSHOT 入站无门）

- **证据**：`decodeInbound`（frame-io.ts:60-68）不向 `decodeMessage` 传 `limits` → codec decode 侧字段检查（payloads.ts:471-484/550-563/611-622，`limits` 缺省不设限——limits.ts:14-20）**不生效**；手工补门仅覆盖 UPDATE（hub：hub-connection.ts:260-267 → hub-namespace.ts:478-482；peer：peer-namespace.ts:392-396）。SYNC_STEP2 / BOOTSTRAP_SNAPSHOT 入站除 `maxFrameBytes`（8 MiB）外层帧限外无 `maxSyncDiffBytes`（2 MiB）/`maxBootstrapBytes`（4 MiB）执行面。
- **设计文本核对**：§9.1.3「`update.length > maxSyncDiffBytes`（codec 层抛）」对 encode 侧成立（`OutboundQueue.emitOne` 传 limits，frame-io.ts:181-185），对 decode 路径不成立——设计假设与实现接线存在事实差。
- **影响**：有界（maxFrameBytes 兜底；超大 diff 仍受 sequencer/apply 正常约束）；属纵深防御缺口而非正确性缺口。修复模式仓库内现成（`namespaceFieldViolation` 扩 kind 或 decode 传 limits + 半数解码 ERROR 构造）。
- **建议**：登记切片 7 硬化清单（与 R-11 同批）；本轴不定级 blocking（协议资源限制面属 spec/attack 轴域，且 SA2/SA4 未列为阻塞，本轴尊重其裁决、仅作登记补强）。

### N-4 error-mapping 两处与 §11.1 字面的可读偏差（判断为可接受读法，登记）

1. `NAMESPACE_LEASE_RELEASED / REPLICATION_SESSION_CLOSED / REPLICATION_EPOCH_CONFLICTED` → `{kind:'local', failed}`（error-mapping.ts:94-98，零 wire 帧）vs §11.1 字面「→ INTERNAL_ERROR (failed；**通道已终局，收口优先**)」。实现取「收口优先」读法（终态通道回发 ERROR 与 §13.4 迟到纪律相悖），判断成立但与映射表字面不一致——建议设计侧补半句勘误或代码注释点名该读法依据。
2. `mapRejection`（error-mapping.ts:126-136）把一切 rejection 路由经 `RUNTIME_WRITE_DISABLED` 分支复用 `mapSessionRefusal`：`RuntimeWriteFatalError` 落地依赖「fatal 置位后 runtime 快照 fatal≠null → INTERNAL_ERROR」的旁证链——结论正确但路径间接；建议注释点名该不变量（或 rejection 直映射 INTERNAL_ERROR 的极简形）。

### N-5 格式 / 风格一致性（化妆品级簇）

1. `hub-namespace.ts` `startOpen` 体（:202-310）多行顶格零缩进（:203/:207/:215/:222/:284/:306 等），破坏全仓 2 空格缩进惯例；仓库无 prettier/eslint 门禁兜底，纯人工约定面。
2. 同款 close-code 分类两种写法：peer-connection.ts:219 行内嵌套三元 vs hub-connection.ts:389-393 干净 helper（`wsCloseCodeFor`）——建议 helper 上移至 frame-io 共享。
3. `Promise.resolve(undefined as unknown as void)`（peer-connection.ts:147）——`Promise.resolve()` 即可。
4. `connectionId` 计数从 0 起（hub-connection.ts:76-77 先取后增）vs 设计 §4.2 `++counter`（从 1 起）——受控 observability 标识，无语义影响。
5. `types.ts:55` 注释笔误「ADT 0009」应为「ADR 0009」。
6. `ws-replication-api.test-d.ts:10` 头部注记「当前为红灯：本包尚未实现」已过时（包已交付且 74 测试全绿）——建议改为冻结契约声明史。
7. 未使用 `catch (err)` 绑定：peer-namespace.ts:147、hub-namespace.ts:206/221/283（TS 默认不告警；改 `catch {` 与邻码一致）。

### N-6 `onAckTimeoutFired` 的 512 跳微任务延迟环（测试可观测性驱动的生产码）

- **证据**：peer-namespace.ts:592-603——手写 `queueMicrotask` 递归 512 次后才 `maybeStartRecovery`，注释自认动机「保证测试的 settleUntil 至少观察到一次 needs-resync 投影」；512 与任何设计预算无关联（§10.4 措辞为「**立即**」）。
- **定性**：不削弱协议纪律、方向安全，但属「为测试绿灯在生产码引入魔法常数延迟」的同类姿势（SA4 F3 曾以 blocking 裁过更重的同类）；建议：或以显式可观测 seam 替代、或把 512 与设计预算（watchdog 4096/harness 3300）的耦合关系成文登记。

### N-7 `lib0`/`y-protocols` 声明为直接依赖但零 import

- **证据**：`package.json:16-17` vs 全包 grep（src+test 仅注释提及）；两者经 `@nomicore/replication-protocol` 传递可得。设计 §3/§21 依赖清单字面即含二者（实现按单照收），故非实现侧越界；但 pnpm 严格隔离下未用直依即死重。
- **建议**：切片 7（真实 WS 适配大概率直用 y-protocols/lib0）前保留或删除均可，届时定论；或在 manifest 旁注记保留理由。

### N-8 GOAWAY drain timer 句柄未登记（与 R-12 相邻）

- **证据**：peer-connection.ts:351-359——`scheduleDrainClose` 的 timer 句柄不保存，`stop()`/`enterBlocked()` 不清除；回调内 `transport.closed` 自卫使其无害，但属 timer 台账缺口（本包其余 timer 全部可清除）。
- **建议**：随切片 9 停机编排（R-12 收口）一并登记句柄。

## 六、最终结论

**Verdict: has-blocking-findings** —— 唯一阻塞项 **B-1**（`git diff --check` 失败：r3-r4 回归测试文件 EOF 空行；化妆品级、单行修复、CI 不门控，但它使设计 §22 验收命令字面上不通过，本轴按验收基准如实定级）。B-1 修复后本轴即 **clear**。

规范主体结论：包形态/导出/注释/命名**完全符合** replication-protocol 等先例；CONTEXT.md avoid 清单**零命中**、冻结词汇使用正确；测试纪律（零 real sleep、确定性 fake-duplex、零源码 grep、三层分层）**全项达标**；timer 纪律（零 native timer）、收口/零泄漏、错误码闭集（codec 边界强制）、零回显/owner 不上 wire **全部核验通过**；模块分解与设计 §3 **15/15 对应**；R-11/R-12 与登记文本逐点一致、按任务约定排除。non-blocking 意见 N-1–N-8 建议移交切片 7/9/10 或下一修订轮顺手收口。

---

*本评审只写本文件；未改动任何其他文件。审查证据均可经第一节命令复现。*

---

# R2 复审节（2026-08-30，同会话复审轮）

- **审查 diff range（逐字）**：`ff50d47..51bcbd5`（`git diff ff50d47..51bcbd5`）。
- **R1→R2 delta（`f557b68..51bcbd5`）**：`0336dce`（双轴终审回流红灯锚定 + G-1 EOF 修复）→ `0324d8f`（Spec B-1/B-2 竞态簇修复）→ `d112647`/`3e1c5f7`（wiki）→ `6ab9e32`（SA4 R4-1 红锚 + 设计 R-13 登记）→ `12258c2`（SA4 R4-1/R4-2/R4-3 代际守卫接线补全）→ `f49f12d`/`51bcbd5`（wiki）。代码面净变更：`peer-connection.ts` +16/−少量、`peer-namespace.ts` +141/−少量、`test/harness.ts` +10；新增测试 `ws-replication-spec-b1-b2-red.test.ts`（228 行/5 IT）、`ws-replication-sa4-r4-1-red.test.ts`（73 行/1 IT）、`ws-replication-sa7-dynamic.test.ts` +118（2 IT）；`ws-replication-r3-r4-regressions.test.ts` −1 行（B-1 修复）。
- **既有评审链核对（R2 时点）**：SA2 R3 pass / SA4 **R5** pass / SA7 **R4** pass / Spec 轴 R1 阻塞项已修复。

## R2-一、独立复跑验证（本轴亲跑）

| 命令 | 结果 |
|---|---|
| `git diff --check ff50d47..51bcbd5` | ✅ **exit 0**（零诊断）——**R1 B-1 消解确认**；新测试文件尾字节抽样 `29 3b 0a`（`);\n`），与仓库单换行尾规范一致 |
| `pnpm exec vitest run packages/ws-replication` | ✅ 12 文件 / **82** 测试全绿（R1 为 10/74；含 9 条类型测试），exit 0 |
| `pnpm typecheck`（根枚举） | ✅ exit 0 |
| native timer / sleep 扫描（src+test，`setTimeout(|setInterval(|setImmediate(|Date.now|performance.now|Atomics`） | ✅ 零命中（仅注入 `ReplicationTimer` 接口类型声明） |
| CONTEXT.md avoid 清单扫描（src+test） | ✅ 零命中 |
| 源码 grep / fs 断言扫描（`node:fs|readFileSync`） | ✅ 零命中 |
| diff 范围 vs 设计 §21 ALLOW/DENY LIST | ✅ 仍仅触 `packages/ws-replication/**` 与 `wiki/raw/task_phase5-ws-namespace-sync*` 族（DENY 零触碰；根 package.json/pnpm-lock 本轮无新改动） |

## R2-二、新增 delta 逐面审查（Spec B-1/B-2 簇 + SA4 R4 / SA7 D2 回流修复）

1. **`peer-connection.ts`**：连接代际计数 `connectionEpochValue`（每次 `dialNow` +1）+ host 回调 `connectionEpoch()`（:44-46/:78/:168）；`sendControl` 增加 ready 状态门（:394-396，B-2e 放大器——重建期零出站，注释引 §4.1/§13.4）；HELLO 经 `this.outbound.sendControl` 直发绕门（:187-193，握手帧不适用 ready 门，注释成文）；`requestRebuild` 通知全部控制器 `onConnectionLost()`（:490-497，§4.3 L228 字面落实）。**风格/注释/溯源与既有纪律一致**；无新 timer、无新错误码、无契约面变动（`PeerNamespaceHost` 为包内私有接口，§2 冻结公共面零触碰 ✅）。
2. **`peer-namespace.ts`**（+141）：代际守卫在五个异步续体一致接线（`startOpen` 导入/session-open/`openSessionAndStartRound`/`tryOpenReplicationSession`/`onBootstrapSnapshot` 导入续体/`applyStep2`/`applyRemoteUpdate` 结篡点），入口捕获 epoch、await 后比对；B-2d 投影先行（`onConnectionLost`/`onConnectionFatal` 先 `setState('disconnected')` 再异步 cleanup）；R4-2 `unsubscribe` 入口捕获 + 当前句柄判别（迟到 cleanup 不误杀新 session listener）；`isConnectionDead()`/`releaseLeaseOrNoop()` 辅助方法命名与注释规范；§13.4 迟到纪律注释逐点溯源（B-2a~e / R4-1~3）。**零新增防御面缺口**；`catch (err)` 未用绑定等 R1 化妆品项原样存续（见 R2-四）。
3. **`test/harness.ts`**：新增 `loadGate` 单次门闩（B-2c 竞态锚）——与既有 `saveGate`/`importHold` 同形同注释，消费登记模式一致；仅基建增量，零断言改动 ✅。
4. **设计文档**：`design.md` 仅追加 2 行（§23 R-13 登记行 + 文末 R4-4 回应行）——append-only 登记纪律遵守 ✅。
5. **新增/增补测试三文件**：头部 provenance 文档（红锚来源、机制、转绿条件）与家族惯例一致；真实 yjs/Registry/Runtime + fake-duplex + 门闩 + `collectUnhandledRejections` 探针；断言全部落在 wire 帧/错误码/状态投影/收敛数据上；确定性 staging（carrier FIFO 结构性论证写入注释）。

## R2-三、R2 发现（分节）

### 硬性违规（blocking）

**无。** R1 B-1 已消解（R2-一表第一行）；delta 全轴复扫未见新增硬性违规。

### 判断性意见（non-blocking，R2 新增）

- **N-9（术语近邻观察，非违规）**：新引入「连接代际 / `connectionEpoch`」（peer-connection.ts:44、peer-namespace.ts 多处）与 CONTEXT.md 冻结词「**复制代际**（replication epoch）」词根相邻。核实：CONTEXT《复制代际》词条的 avoid 为「连接次数、自动选主 term、可回绕版本号」——禁止的是把*复制代际*误作连接计数；本实现对**另一概念**（每连接生命周期计数）使用限定词「连接代际」且字段恒为 `connectionEpoch*` 限定形，注释明确区分（不与 `replicationEpoch` 混用，avoid 清单零命中）。判定：不构成术语违规；登记为观察项——后续文档/切片引用时须保持「连接代际」全称限定，不得缩写为「代际/epoch」裸词。
- **N-10（化妆品）**：`ws-replication-spec-b1-b2-red.test.ts:52` 的 `import { decodeMessage }` 位于文件中段（函数定义之后）——ESM 合法（hoisted）但与全仓「import 集中顶部」惯例不一致；建议顺手移至顶部 import 块。

### R1 意见存续确认（非新增，仍 non-blocking）

R1 的 N-1（死代码簇：含 `HANDSHAKE_OR_READY` peer-connection.ts:30、`LifecycleQueue` 零实例化等 10 条）/ N-2（ACK 计时不逐笔重置）/ N-3（入站字段限额只覆盖 UPDATE）/ N-4（error-mapping 读法偏差登记）/ N-5（格式簇）/ N-6（512 跳延迟环）/ N-7（lib0/y-protocols 未用直依）/ N-8（GOAWAY timer 句柄未登记）**全部原样存续**——本轮修复聚焦 Spec/SA4/SA7 阻塞簇，未宣称覆盖本轴 R1 意见，存续不构成新问题；处置建议不变（切片 7/9/10 或下一修订轮顺手收口）。

### 已知登记项（R2 时点）

R-11 / R-12 维持 R1 排除结论不变。**R-13（本轮新增登记，design §23）**：`sendControl` ready 门抑制握手期合法 connection ERROR 帧（SA4 R4-4 nano；close code 仍正确送达，危害限诊断面；切片 7 精确化为 epoch 门判据或 connection ERROR 豁免）——与 R-11/R-12 同款「演进位登记」性质，按同一约定**排除出违规清单**。

## R2-四、R2 最终结论

**Verdict（R2）: clear。**

依据：R1 唯一阻塞项 B-1 消解并经 `git diff --check ff50d47..51bcbd5` exit 0 复核；R1→R2 delta（代际守卫/投影先行/unsubscribe 守卫/sendControl 门/loadGate/R-13 登记/三个测试文件）经仓库惯例、CONTEXT 术语、测试纪律、timer 与生命周期、错误分类学、可维护性六面复扫**零新增违规**；包级 82 测试 + 类型测试 + 根 typecheck 全绿；diff 范围仍守 §21 ALLOW/DENY。R1 的 N-1–N-8 与 R2 新增 N-9/N-10 均为 non-blocking，随切片 7/9/10 或下一修订轮收口，不阻塞本切片完工终审。

*R2 复审同样只写本文件；未改动任何其他文件。全部证据可经 R2-一表命令复现。*
