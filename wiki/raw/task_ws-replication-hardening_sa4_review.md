# SA4 静态验尸报告 — issue #161 ws-replication 协议加固（commit 066d01f）

**Date**: 2026-08-29
**Verdict**: **reject**
**审查对象**: `packages/ws-replication` @ commit `066d01f`（base `origin/docs/phase-5-websocket-replication`）
**权威设计**: `wiki/raw/task_ws-replication-hardening_design.md`（R2，SA2 pass）
**红灯契约**: `wiki/raw/task_ws-replication-hardening_sa6_red.md`（21 例 + 6 补充锚）
**基线复测**（本轮实测，repo root）: `./node_modules/.bin/vitest run packages/ws-replication` →
**14 files / 103 tests 全绿，Type Errors none，`git diff --check` 通过**——总控「红灯全绿（103/103）」声明属实。

---

## 一、Reject 清单（一次列全，可共同修复集合）

### R1【P1·correctness，回流 SA3】`OutboundQueue.sendControl` 返回值在数据面激活后被污染 → G2.1/G2.2 关联基准错误 → hub 合法 BOOTSTRAP_ACK 被 false-fatal、peer 合法 CLOSE_OK 被拒

**缺陷位置**：`packages/ws-replication/src/frame-io.ts:145-149`

```ts
sendControl(message: ReplicationMessage): number {
  this.controlQueue.push(message);
  this.drain();
  return this.lastSeq;   // ← 返回 drain 结束时的最后帧序：若数据帧随控制帧之后派发，
}                          //    该值是数据帧的序号，不是本控制帧的序号
```

`drain()`（frame-io.ts:195-229）先排空控制队列、再进入数据循环——同一次 drain 内，控制帧先出、
数据帧后出。PR #160 时代数据循环是死代码（`sendData` 零调用者），`lastSeq` 恒等于本控制帧序；
本 commit 激活数据面后，该不变量 silently 失效，而方法注释仍自述「返回本帧序列」。

**可复现证据 A**（真实接线形态，主证据；真实 `OutboundQueue` 类，独立脚本
`/tmp/sa4-repro/repro2-realshape.ts`，tsx 直接驱动，零 worktree 改动）——状态构造与生产链逐点同形：
W = `dropData` 后无帧但 in-flight 窗口满（`declareLocalResync`/`onResyncReceived` → 清桶保留注册，
NB2(a)）；Y = 正常交付的兄弟 ns：

```
W 先注册（enqueue+dropData 清桶，canDispatchData(W)=false）
Y 交付 2 帧：Y#1 的 drain 挡在 W → 排队；Y#2 的 drain 从 cursor=Y 派发 Y1(seq=1) 后挡回 W
           → 静止态 = {cursor 指向 Y，Y2 在队且窗口开放}
sendControl(BOOTSTRAP_SNAPSHOT) 返回值 = 3
本次调用 wire 增量 = [{"seq":3,"label":"DATA:UPDATE:Y"}]   ← 快照帧自身序号实为 2
EXIT=1（REPRODUCED）
```

即：wire 上 `BOOTSTRAP_SNAPSHOT` 携带 sequence=2、随后派发的 Y2 数据帧为 sequence=3，
`sendControl` 返回 3。`startBootstrap` 会把 `bootstrapSnapshotSeq` 存为 **3**；peer 的
BOOTSTRAP_ACK 回 echo 实序 **2**（peer-namespace.ts:386-390）→ 错配 → false-fatal。

**可复现证据 B**（三 ns 竞争简化形，`/tmp/sa4-repro/repro.ts`）：a 窗口满挡游标、b 先满后被 ACK
放开、c 活跃——`sendControl(CLOSE_NAMESPACE)` 返回 **3**（b1 数据帧序）而控制帧自身序号 **2**。

**真实系统可达链**（证据 A 即其缩微，全链均为既有代码路径）：

1. `drain()` 只在两种情况下早退留下非空队列：`paused`（此时数据循环整体跳过，控制帧返回值安全）或
   `canDispatchData(nsId)=false` 的 `return`（frame-io.ts:203-205）。后者 = 该 ns `inFlightCount ≥ max`
   （hub-namespace.ts:687-689 / peer-namespace.ts:752-754 只查 inFlight）。
2. 由 A7 不变量（update-channel.ts：`inFlight + pendingData ≤ max`），**inFlight=max ⟹ pendingData=0 ⟹ 该 ns
   连接级队列必空**——但它仍可能**注册在 dataOrder 且桶被清空**：`dropData`/`shedNamespace`
   （frame-io.ts:178-186/295-303）刻意保留空桶注册（NB2(a)）。即「**无帧但窗口满**」的 ns 会挡住游标。
3. 该状态常态可达：ns-a 的 `declareLocalResync`/`onResyncReceived`/watchdog 边沿触发 `dropData`
   （hub-namespace.ts:130/547/597，peer-namespace.ts:128/435/701）时 in-flight 窗口仍满（溢出恰恰发生在高负载）；
   随后 ns-b 交付 2+ 帧：第一笔 enqueue 的 drain 挡在 a，第二笔起 drain 从 cursor=b 直达 b → 派发 1 帧后
   循环推进、再次挡在 a → **静止态 = {cursor 指向 b，b 有排队帧且窗口开放}**。
4. 此刻任何「返回值被消费」的控制发送（下表）→ drain：控制帧 seq=N 先出 → cursor 落 b → 派发 b 的帧
   （N+1, N+2…）→ `sendControl` 返回 N+k ≠ N。

**受影响消费方**（仅两处消费返回值做关联，均属本任务新增的 G2.1/G2.2 特性）：

| 消费方 | 位置 | 污染后果 | 严重度 |
|---|---|---|---|
| peer `removeTarget` 存 `closeNamespaceSeq` | peer-namespace.ts:541-546 | hub 回显正确序的 `CLOSE_OK`（hub-namespace.ts:532-536 回 echo 入站帧序）被判错配 → close 无法经 CLOSE_OK 完成，退化为 closeTimeout(5s) 本地收口 | 中（收口延迟，有兜底） |
| hub `startBootstrap` 存 `bootstrapSnapshotSeq` | hub-namespace.ts:407-414 | peer 回显正确序的 `BOOTSTRAP_ACK`（peer-namespace.ts:386-390）被判错配 → `connectionFatal('ACK_STATE_VIOLATION', 1002)` **false-fatal** → 整连接死亡；peer `onClose(1002) → enterBlocked()`（peer-connection.ts:558-559）→ **blocked 无自动重连 → 多 ns 复制静默停摆直至人工干预** | **高** |

触发面为纯合法流量形态：多 ns 同连接 + 某 ns 恢复声明（dropData）窗口未收口 + 另一 ns 持续交付 +
新 ns OPEN（bootstrap 路径）或目标移除（close 路径）。21 例红灯与 82 例既有测试均未覆盖该交错
（AC3a/AC3b 是单 ns、无并发数据面竞争），故 103/103 全绿不能证明此面安全。

**影响评估**：非「伪造帧被接受」方向（AC3 的验收面仍成立——错配帧依旧被拒），而是**反向**：
关联基准被污染导致**合法 ACK 被误杀**。hub 侧后果是不可自愈的连接级 false-fatal + peer 永久 blocked。

**修复方向（SA3，最小局部修复，无需改设计）**：`sendControl` 返回「本控制帧自身序号」。控制队列 FIFO、
本帧必为本批最后发出的控制帧——可在 `drain()` 的控制循环中记录「最后发出的控制帧序」（或让
`emitOne` 的返回值在控制循环中被捕获并在 `drain` 后透出），`sendControl` 返回该值而非 `lastSeq`。
修后 `bootstrapSnapshotSeq`/`closeNamespaceSeq` 与 wire 实序恒等，G2.1/G2.2 语义恢复。
**建议随修复补一条多 ns 竞争下的关联完整性测试锚**（交 SA6/SA7 契约面，本报告不越权编写）。

---

### R2【P2·scope，回流 SA3（回滚）】`packages/ws-replication/package.json` 版本号 0.1.0 → 0.1.1 不在 ALLOW LIST

- 证据：`git diff origin/docs/phase-5-websocket-replication HEAD -- packages/ws-replication/package.json`
  仅一行 `"version": "0.1.0" → "0.1.1"`；设计 §10 ALLOW LIST（生产 11 文件 + 测试 4 文件）与全文均未提及版本变更。
- 处置：回滚该行（`git checkout`），或走 SA1 显式扩展 ALLOW LIST 并标注理由。不接受「无行为影响」作为
  免除文件门禁的理由（2026-06-08 立法）。BLACKLIST（npm/yarn lockfile、TASK.md、.bak）零命中 ✓。

### R3【P2·G5.2 反模式回归，回流 SA3】`ensureCloseMemo` 在生产代码引入 3000 跳 `await Promise.resolve()` 轮询环

**位置**：peer-namespace.ts:565-580

```ts
for (let i = 0; i < 3_000 && this.state === 'closing'; i += 1) {
  await Promise.resolve();
}
```

注释自证预算选择依据是测试观察窗（「CLOSE_OK/closeTimeout 在预算内必达」）——与被本任务明令删除的
512 跳 `queueMicrotask` 环（G5.2：生产代码不得为测试可观测性引入魔法常数延迟）同构，只是常数换成 3000
（恰好 > settle(300) 且 ≈ settleUntil 预算——测试耦合常数回归测试侧归属原则的对立面）。且该环**并不能
兑现自己的承诺**：预算耗尽后 promise 无条件 resolve（仍可能 closing 未收口），真正的收口语义
（closeSettled 在 CLOSE_OK/closeTimeout 前为 false）本可由事件直接驱动。

**修复方向（SA3）**：删除轮询环；`ensureCloseMemo` 的 memo body 只做 drain + cleanup，收口完成由
`onCloseOk`/`onTimerFired('close')`/`onCloseRequest` 完成段的既有 `settleCloseMemo()` 触发
（Memoized 合流已保证恰一结算）。AC3b 的 `closeSettled === false` 锚在事件驱动下语义不变（注入伪造
CLOSE_OK 后无人 settle → false ✓；closeTimeout 后 settle ✓），断言面零改动。

### R4【P3·设计偏离 §3.5 teardown 行，回流 SA3（小修）】peer `enterBlocked()` 不 dispose 出站队列 → blocked 后残留排队数据帧继续派发

**位置**：peer-connection.ts:577-587（enterBlocked 无 outbound.dispose）vs stop():121-124 / dialNow():197-200（有）。

后果：GOAWAY(SERVER_SHUTTING_DOWN/REAUTH_REQUIRED) → `enterBlocked` 时 sa7 G2 锚要求**不关本地
socket**——transport 仍开放，连接级已排队 UPDATE 帧在检查点 timer 驱动下继续发往一个已宣布停机的
hub，直至队列排空；设计 §3.5 交互矩阵「连接收口 → dispose（checkpoint 清 + 逐 ns onDataShed）」在
blocked 路径未实现。有界、无状态破坏（A7 记账仍闭环），但违反「GOAWAY 同步静默」的设计意图。
**修复方向**：`enterBlocked()` 内追加 `this.outbound?.dispose()`（dialNow 本就会 dispose 旧队列，
提前 dispose 安全；dispose 的逐 ns onDataShed 在控制器已投影 disconnected 后走
`onConnectionDataShed → declareLocalResync`（sendControl 非 ready → 零出站帧，无噪声））。

---

## 二、非阻断发现（记录在案，随回流一并知会）

| # | 发现 | 定性 | 处置 |
|---|---|---|---|
| N1 | `requestRebuild` 用裸 `queueMicrotask` 而非设计 §5.2 伪码的 `deferTask`（peer-connection.ts:626-633，注释自证动机） | **必要偏离**：设计伪码若照搬会让 DENY 冻结面 `spec-b1-b2` 的 B-1 锚（settle 内 dialCount+1）在 driver 注入 512 跳 TEST_DEFER 下恒红；生产语义与缺省 deferTask 等价（单跳） | 回流 **SA1**：§5.2 补一行「requestRebuild 保持单跳直调度（不注入 TEST_DEFER）」的设计修订注记；SA3 代码不改 |
| N2 | `src/liveness.ts` 为新文件：设计正文 §5.1 明文命名（「共用小工具 liveness.ts 或内联」）但 §10 ALLOW LIST 漏列 | SA1 文档缺口（非 SA3 越界） | 回流 **SA1**：§10 ALLOW LIST 补 `src/liveness.ts` 条目 |
| N3 | 公平性微瑕：`drain()` 在首个 `canDispatchData=false` 的 ns 处 `return`（而非跳过继续），其后的可派发 ns 需等下一次 drain 触发（最迟一个检查点周期 100ms——queued>0 保证检查点续挂） | 有界活性延迟，无饿死（timer 兜底推进） | 记入动态审核重点；非阻断 |
| N4 | `liveness.ts` 无 pong 代际关联：旧 ping 的迟到 pong 会清掉新 ping 的 pong 计时（真实 WS 无载荷语义下 best-effort） | 协议层可接受（协议未定义 pong 载荷关联） | 记入动态审核重点（SA7 + 切片 9） |
| N5 | hub `dispatchReady` 的 `CLOSE_OK` 分支将其按 `NAMESPACE_STATE_VIOLATION` ERROR 帧回敬（hub-connection.ts:346-349），而 peer 侧对收到 hub→peer 专用帧直接 1008 fatal（peer-connection.ts:366-370）——双向方向纪律不对称 | 既有行为（非本 commit 引入），协议 §6 方向纪律的宽松侧实现 | 仅记录；如需对称收紧另开票 |

---

## 三、Hard Gates 结论

### Hard Gate #14 — vitest 触发性自检：**PASS**

- 本任务涉及 `*.test.ts`：`test/ws-replication-sa6-hardening-g1-g2-red.test.ts`、
  `test/ws-replication-sa6-hardening-g3-g4-red.test.ts`（新增），`test/driver.ts`、
  `test/ws-replication-spec-b1-b2-red.test.ts`（改动）。
- CI（`.github/workflows/ci.yml`，PR + push(main)，node 20/24 矩阵）：
  - `Test: pnpm test` → 根 `package.json` `test = vitest run --typecheck` →
    `vitest.config.ts` `include: ['packages/*/test/**/*.test.ts', …]` —— **glob 覆盖
    `packages/ws-replication/test/**/*.test.ts` 全部文件，含两新红灯文件**；
  - `Typecheck: pnpm typecheck` 显式含 `tsc -p packages/ws-replication/tsconfig.json`；
  - typecheck 测试面（`*.test-d.ts`）由 `vitest --typecheck` 的
    `include: ['packages/*/test/**/*.test-d.ts', …]` 覆盖（`ws-replication-api.test-d.ts` 在内）。
- 结论：无「测试存在但 CI 永不触发」黑洞。SA7 动态阶段请从 `gh run view --log` 摘录
  `ws-replication-sa6-hardening-*` 的运行证据（本门禁为静态判定）。

### Hard Gate #15 — 协议假设审查：**PASS**

设计 §11「协议假设依据」章节存在，16 条假设逐条标注依据类型与具体引用；无「应该/通常/预计」类
无据推断（两条解释性选择 #15/#9 均显式声明为解释性并给出依据）。本轮抽查复核：

| 假设 | 依据锚点 | 本轮复核结果 |
|---|---|---|
| #1/#2/#11 协议文本 | `instance-replication-v1.md` §2 L36（bearer 预验证→可信 instanceId）、§6.1 L120（peerInstanceId 必须等于 Upgrade 身份）、L40（活性只走 WS ping/pong）、§18 L516-520 | 逐行 sed 验证存在且语义相符 ✓ |
| #4/#5/#6/#7/#8 | §12 L303-313（CLOSE_OK 关联/丢包容）、§9.4 L247-249（恢复恒由 peer 发起）、§17 L489-492（round-robin/shedding/水位/timer 检查） | ✓ |
| #9 fake scheduler `advanceBy` 到期序 | `namespace-registry/src/testing.ts:74-105` | 源码复核：`at <= deadline` 的最早项循环执行——100ms 检查点在 `advanceBy(100)` 内必达 ✓ |
| #12 类型面加性兼容 | `ws-replication-api.test-d.ts` 单向 `toMatchTypeOf` | 本轮 `vitest run --typecheck` → Type Errors none ✓ |
| #13 peer 对 1011 → backoff | 协议 §15.1 + `peer-connection.ts` onClose 分类 | 现码 onClose（558-563）仅 1002/1008 → blocked，其余 temporary ✓（A2-1011 锚实测通过） |
| 实测基线 | 15→21 红灯 → 全绿 | 本轮复测 103/103 + typecheck clean ✓ |

---

## 四、验尸清单逐项结论

1. **设计一致性**：⚠️ 偏离——R1（sendControl 返回值语义漂移，违反设计 §2.1/§2.2「留存**发送序**」的
   字面意图与 frame-io 自身「返回本帧序列」注释）；R3（§5.2 反模式回归）；R4（§3.5 teardown 行未实现于
   blocked 路径）；N1（requestRebuild 偏离 §5.2 伪码——必要且生产等价，归 SA1 修文）。其余六组 21 项
   required fixes 与 §1-§5 设计逐节核对**一致落地**（§1.1 受信身份/首查/授权源切换、§1.2 代际闸+退订、
   §2.1/§2.2 关联、§2.3 declareHubResync 复用、§2.4 最老在途重挂、§3.1-§3.5 数据面/滞回/检查点/1011/dropData
   四象限、§4.1-§4.5 同步 closing/守卫/waiter flush/GOAWAY 静默、§5.1 liveness dormant、§5.2 deferTask seam、
   §5.3 四处死抽象删除——`LifecycleQueue`/`NamespaceChannelCore`/`sendData`/hub `cleanupTail` grep 零残留 ✓）。
2. **读写路径一致性**：✅ 无分叉——UPDATE 出站（session→channel→enqueueData→OutboundQueue→transport）与
   ACK 入站（transport→onUpdateAck→channel.onAck）共用同一 channel/队列实例；序列号单点分配（emitOne）纪律保持。
3. **静默失败**：✅ 无新增——非 ready 门丢弃经 onDataShed 显影（A7）；超限丢弃有恢复 round 兜底并有注释锚；
   唯R4 的 blocked 后队列继续派发属「向已死对端发帧」而非无观察效应（wire 层可观察）。
4. **降级方案**：✅ 安全——accept 缺身份响亮 TypeError（拒绝虚假降级立法落实）；liveness/bufferedAmount
   缺面 dormant 为设计声明的正确降级（切片 9 loud 断言已开票面）；`validateLimits` 补
   `highWater ≤ maxQueuedBytesPerConnection` 链式校验（A2-3）✓。
5. **极端攻击**：❌ 发现 R1（多 ns 窗口竞争交错下的关联基准污染——见上文完整攻击链与复现）。其余边界
   （单帧超限病态配置断点接纳、uint32 耗尽响亮收口、OutboundExhaustedError 传播路径、drain 控制循环
   编码错沿 sendChecked 同族收编）静态推演均安全。
6. **错误处理**：✅ 基本完整——G4.4 GOAWAY blocked 改走 enterBlocked（通知全部控制器）、RESTARTING
   deadline 句柄保存 + quiesceControllers 同步静默 + dialNow 重置 goawayActive（sa7 G1/G2 锚保绿）；
   缺口即 R4（blocked 路径队列不 dispose）。
7. **架构评估**：✅ 可行——无需退回 SA1；R1 修复为 frame-io 单点局部修复，架构（控制/数据双平面 +
   序列单点分配）本身健全。
8. **过度设计**：✅ 精简——死抽象按设计删除而非新建层；`canDispatchData` 可选 dep 是 A7 窗口不变量的
   最小实现面；变更半径与 21 项清单相称。

**测试构造微调审查（SA3 声明 4 处，断言面零改动）**：✅ 属实——
① g1-g2 AC2a 注入前清零 hubToPeer 造证基准（L116-119，锚 `toHaveLength(1)` 只观测注入帧）；
② g1-g2 AC3b 注入前以 hub 通道 closed 投影为同步点（L200-211，运行时对象图只读观测，非源码断言）；
③ g3-g4 DispatchEntry 构造期记录 ERROR code（L78-125，A2-1011 锚断言面等价）；
④ g3-g4 AC5-RR 按 §3.8 裁决 1 替换构造（L398-427，`setGate(false)` A4 修正并入，断言 `[a,b,a,b]`+4 帧
与原契约逐字一致）。21 锚断言面与红灯契约表逐条比对一致；DENY 冻结测试面（ac1-ac7/r3-r4/sa4/sa7/
api.test-d/harness.ts）零触碰（diff 证实）；§1.7 源码 grep 断言禁令零命中（测试无 readFileSync，
3 处 toContain 均为运行时解码值断言）。

**§1.6 契约改动连锁**：`accept()` 新增同步 TypeError——全仓 `git grep '\.accept('` 仅 5 个测试调用点，
全部已传 identity（driver×2/spec-b1-b2×1/g3-g4 bootMulti×1/g1-g2 AC1×1）✓；`onCloseOk(ackedSequence)`
签名收紧——唯一 dispatch 点同步传参（peer-connection.ts:402）✓；`sendUpdateFrame→enqueueUpdate`
迁移——唯一调用点随 Host 契约改造 ✓。无 throw 契约反转引入未兜底 caller。

---

## 五、复验范围（SA3 修复后 SA4 只复审以下固定面）

1. `frame-io.ts` sendControl 返回值修复 + `bootstrapSnapshotSeq`/`closeNamespaceSeq` 关联完整性
   （R1）——含多 ns 竞争交错下合法 ACK 不被误杀；
2. `package.json` 版本行回滚（R2）；
3. `ensureCloseMemo` 事件驱动化（R3）——AC3b 锚保绿；
4. `enterBlocked` 出站队列 dispose（R4）——sa7 G1/G2 锚保绿；
5. 上述面的直接影响面：`vitest run packages/ws-replication` 103 例 + typecheck + `git diff --check`。

N1/N2 回流 SA1 修文（设计修订注记 + ALLOW LIST 补条目），不阻塞 SA3 复验。

---

## 六、动态审核重点（交 SA7，于 `task_ws-replication-hardening_sa7_report.md` 回复）

1. **R1 修复后关联完整性**（SA3 修复落地后）：多 ns（≥3）同连接、其中一 ns 触发 resync/dropData 且
   in-flight 窗口未收口、另一 ns 持续交付时，发起新 ns OPEN（bootstrap）与 removeTarget（close）——
   验证 wire 上 BOOTSTRAP_SNAPSHOT/CLOSE_NAMESPACE 帧序与其 ACK 回显恒等关联、零 ACK_STATE_VIOLATION false-fatal。
2. **N3 公平性**：窗口满的 ns 长期占位时，其它 ns 的派发延迟是否被检查点 timer（100ms）有效兜底（真实
   scheduler 推进下无分钟级饿死）。
3. **N4 liveness**：真实 WS adapter（切片 9 前可用内存 transport 模拟 ping/onPong 面注入）下，pong 超时
   收口、stop/重拨清 timer、缺面 dormant 零 timer 的运行时行为。
4. **R4 修复后**：GOAWAY SHUTTING_DOWN → blocked 后 wire 上是否还有后续 UPDATE 帧（应为零）。
5. **CI 触发证据**：`gh run view --log` 摘录两新测试文件在 PR CI 的执行行（Hard Gate #14 动态确认）。

---

## 七、证据附录

- 复现脚本：`/tmp/sa4-repro/repro2-realshape.ts`（主证据：真实接线形态——dropData 后无帧窗口满的 ns
  挡游标 + 兄弟 ns 两笔交付 + 控制发送，EXIT=1 即复现）与 `/tmp/sa4-repro/repro.ts`（三 ns 简化形）；
  tsx 驱动真实 `OutboundQueue` 类；零 worktree 改动，`git status` 仅 `.mabf-dispatch-ts`。
- 基线命令与结果：`./node_modules/.bin/vitest run packages/ws-replication` → 14 files/103 tests passed,
  Type Errors none；`vitest run --typecheck` 同结果；`git diff --check`（vs base）无输出。
- Scope 比对：actual 17 文件（12 src + 4 test + package.json）+ wiki 白名单；ΔALLOW =
  `package.json`（R2）与 `src/liveness.ts`（N2，设计正文已授权）。
- 关键行号（本轮 worktree 实测）：frame-io.ts:145-149/195-229/203-205、hub-namespace.ts:407-414/532-536/
  687-689/775-791、peer-namespace.ts:541-546/565-580/752-754/386-390、peer-connection.ts:552-563/577-587/
  626-633、hub-connection.ts:78-95/249-258/439-441。

---

# SA4 R2 复验段（回流 commit 3e7df32 + 设计 addendum 75e5af7）

**Date**: 2026-08-29
**R2 Verdict**: **pass**
**复验对象**: commit `3e7df32`（066d01f 之上的回流修复）+ 设计 addendum（`75e5af7`：§3.8 裁决 3、§5.2 偏离声明、§10 补列）
**复验范围**: R1 报告 §五 固定面 + 总控追加项（E5 加验 / 裁决 3 产物 / §二处置复核）
**基线复测**（本轮独立实测）: `vitest run packages/ws-replication` → **14 files / 103 tests 全绿 +
Type Errors none + `git diff --check` 干净**（SA3/SA6 复测结论独立复核一致）。

## R2-1 R1（sendControl 返回值污染）：✅ 修复闭合

- **修复形态**（frame-io.ts:144-235）：`drain()` 返回 `lastControlSeq`（本批最后发出的**控制帧**序列，
  0=无控制帧；三个早退点均带值返回）；`sendControl` 返回 `this.drain()`。控制队列 FIFO + 本帧必为
  本批最后控制帧 → 返回值恒为本控制帧自身序号，数据帧随后派发不再参与。
- **原复现脚本重跑**（同一脚本、真实类）：
  - `/tmp/sa4-repro/repro2-realshape.ts`（真实接线形态：dropData 后无帧窗口满的 ns 挡游标 + 兄弟 ns
    交付 + 控制发送）→ `sendControl(BOOTSTRAP_SNAPSHOT)` 返回 **2**，wire 增量
    `[seq2=WIRE(快照), seq3=WIRE(Y2 数据帧)]`——返回值 = 快照帧自身序 ✓（R1 轮为 3）；
  - `/tmp/sa4-repro/repro.ts`（三 ns 形态）→ 返回 **2** = 控制帧自身序 ✓（R1 轮为 3）。
- **嵌套 drain 安全性推演**：数据循环 catch 的 `onDataShed → declareLocalResync → sendControl(RESYNC)`
  与 `onControlExhausted → connectionFatal → sendControl(ERROR)` 构成嵌套 drain——内层返回内层控制帧
  自身序（其返回值无人消费）、外层 `lastControlSeq` 不受内层影响，双向均正确。
- **drain() 签名 void→number 连锁**：全仓 `.drain(` 调用点仅 frame-io 内部三处（sendControl 消费返回值、
  enqueueData/runCheckpoint 忽略）——零外部 caller，公共导出面（index.ts）不含 OutboundQueue，无涟漪。
- **G2.1/G2.2 关联完整性**：修复落在共享 `OutboundQueue` 单点，hub `startBootstrap`
  （hub-connection.sendControlChecked → outbound.sendControl）与 peer `removeTarget`
  （peer-connection.sendControl → outbound.sendControl）两条消费链同享修复；`bootstrapSnapshotSeq`/
  `closeNamespaceSeq` 与 wire 实序恒等 → 合法 BOOTSTRAP_ACK/CLOSE_OK 不再可能被误杀。

## R2-2 R2（package.json 版本行）：✅ 处置闭合

- 设计 §10 新增包清单条目：`packages/ws-replication/package.json` **仅限 version patch bump 一行**，
  理由 = 硬门禁 #9（改码模块必须 bump）；ALLOW 只增不删纪律下的显式扩展。
- 实测边界：`git diff base HEAD -- package.json` 恰一行（`0.1.0→0.1.1`），无其他字段；
  `3e7df32` 之后生产文件零改动（`git diff 3e7df32 HEAD -- packages/` 为空）——豁免范围与实际改动严格一致。

## R2-3 R3（ensureCloseMemo 事件驱动化）：✅ 修复闭合（含裁决 3 产物核验）

- **3000 跳轮询环已删除**（peer-namespace.ts:567-585）：memo body = drain + cleanup + `await gate`
  （装饰 promise，创建时同步登记 resolve——settle 与登记零竞态窗口，SA2 R3 §三已审查成立）。
- **事件源接线**（E1–E5 封闭集逐一核实现码）：
  E1 `onCloseOk`（关联通过）✓、E2 `onTimerFired('close')` ✓、E3 `onConnectionLost`/`onConnectionFatal`/
  `onConnectionStopped` 三入口（closing 分支均 settle）✓、E4 `onCloseRequest` 完成段 ✓、
  E5 `finalize` **无条件** settle（原 `if (state === 'closed')` 已删）✓。
- **封闭性静态核查**：离开 'closing' 或落入终态的全部路径必经上述五类之一；保持 'closing' 的路径
  （`onIdentityChanged`/`onErrorFrame` 的 closing 早退）closeTimeout 仍在挂 → E2 有界兜底；
  `clearAllTimers` 仅出现于 finalize（E5 同点 settle）——**无孤儿悬挂路径**。
- **E5 路径加验**（SA2 R3 放行路径明示「建议 SA4 复验时加验」；本轮以真实
  `PeerNamespaceController` + stub host 单元级驱动，`/tmp/sa4-repro/e5-verify.mts`）：

  ```
  removeTarget（live→closing）→ CLOSE_NAMESPACE 已发、closeP pending（无事件不结算 ✓ 事件驱动语义）
  E5 触发：closing 期迟到 OPEN_OK → finalize('failed')（clearAllTimers 已清 closeTimeout）
  → 状态 failed 且 closeP 于 50 微任务内结算——零 timer 推进、零 CLOSE_OK
  EXIT=0（PASS：E5 是该路径唯一结算点，无条件 settleCloseMemo 接线有效）
  ```

- **裁决 3 产物核验**：设计 §3.8 裁决 3（E1–E5 + ADR-0008 L93「drain 段 vs 握手等待段」分层 + 选型 (A)）
  与 SA2 R3「修复与本节要求逐字一致时无需再轮 SA2」的放行路径相符——E5 子句已入设计（§12 L313 依据）、
  finalize 一行已落码，逐字一致 ✓。
- **测试⑦豁免边界**：改动两 hunk 均落在用例⑦区间（L241-276）内；全部 `expect` 断言行零触碰
  （CLOSE×1 / 序列严格 [1..9] / CLOSE seq=9 / UPDATE×2 / CLOSE_OK×1 原样），仅 await 点发起/结算分离
  + `await closeP` 一行——与 §10「仅用例⑦、断言面冻结」豁免授权严格一致；其余用例（①-⑥/⑧*）零触碰
  （git diff 全量核verify）。
- **回归面**：AC3b（E2 路径，`closeSettled === false` 锚语义保持）绿 ✓；r3-r4 ①-⑥/⑧*（⑤c/⑤d 终局语义）
  绿 ✓；⑦ 新构造绿 ✓（E1 事件结算）。

## R2-4 R4（enterBlocked dispose）：✅ 修复闭合

- peer-connection.ts:584-591：`enterBlocked` 在 setState('blocked') 后、控制器循环前
  `outbound.dispose() + outbound = undefined`——checkpoint timer 清 + 逐 ns onDataShed（A7 记账闭环）；
  dispose 期间 connState 已 'blocked' → `onDataShed → declareLocalResync → sendControl` 经非 ready 门
  零出站帧（注释自证与实测一致）；后续 `dialNow` 的 `outbound !== undefined` 守卫跳过重复 dispose ✓；
  `stop()` 的 undefined 守卫同样安全 ✓。GOAWAY-blocked（socket 保持开放）下残留排队 UPDATE 不再外发。

## R2-5 §二非阻断发现处置复核

| # | R1 定性 | 处置 | R2 状态 |
|---|---|---|---|
| N1 requestRebuild 裸 queueMicrotask | 必要偏离，回流 SA1 修文 | 设计 §5.2 新增「实现偏离声明（SA4 R1 N1 追认，SA3 代码不改）」——动机（spec-b1 B-1 锚）+ 生产等价性论证齐备 | ✅ 闭合 |
| N2 src/liveness.ts 漏列 ALLOW LIST | SA1 文档缺口 | §10 补条目（含 54 行落点与授权出处）+ §8 更新为 12 文件口径 | ✅ 闭合 |
| N3 公平性 cursor-skip | 动态审核重点 | 维持 SA7 动态项（本轮无代码变化） | ⏳ 交 SA7 |
| N4 liveness pong 无代际关联 | 动态审核重点 | 维持 SA7 动态项 | ⏳ 交 SA7 |
| N5 CLOSE_OK 方向纪律不对称 | 仅记录（既有行为） | 无变化（如需对称收紧另开票） | 📝 记录 |

## R2-6 残余观察（非阻断，本轮新增）

1. **O1**：SA2 R3「建议红灯锚（随 E5 定案补发 SA6）」——closing drain 期 bump → 终态 + `removeTarget`
   有限结算的 E5 行为锚**未随本轮交付**（SA6 执行包仅含⑦豁免）。SA2 标注为「建议」非门禁；本轮已以
   真实类单元级加验覆盖该行为面（R2-3）。建议 SA7 动态验证清单并入此项（或 SA6 后续锚包补发）。
2. **O2**：closeMemo 跨 close 周期复用（re-add 后二次 removeTarget 返回**已结算**的旧 memo → promise
   即刻 resolve，先于新 close 完成）。与 066d01f 及 PR #160 基线逐字同形（`ensureCloseMemo` 的
   memo 复用语义），**非 R3 引入**；状态机本身正确（closing/CLOSE_OK/timeout 照常），仅二次关闭的
   promise 语义偏弱。信息性记录，不建议本轮处理。
3. **O3**：`enterBlocked` 后 `peer.sendData` 在 `outbound === undefined` 分支静默返回（不经 onDataShed）——
   结构性不可达（blocked 后控制器已投影 disconnected，`onOwnedUpdate` 不再 deliver），与 R1 轮判定一致；
   随 R4 dispose 的引入该分支从「非 ready 门」变为「无队列门」，行为面等价（零 handoff）。信息性记录。

## R2-7 复验命令与证据汇总

```bash
# 基线（独立进程）
./node_modules/.bin/vitest run packages/ws-replication   # 14 files / 103 passed / Type Errors none
./node_modules/.bin/vitest run --typecheck packages/ws-replication  # 同上
git diff --check origin/docs/phase-5-websocket-replication HEAD     # 干净
# R1 修复复验（/tmp 独立脚本，真实类）
tsx /tmp/sa4-repro/repro2-realshape.ts   # sendControl 返回 2 = 控制帧自身序（EXIT=0）
tsx /tmp/sa4-repro/repro.ts              # 同（EXIT=0）
# E5 加验（真实 PeerNamespaceController + stub host）
tsx /tmp/sa4-repro/e5-verify.mts         # closing 期终局 → closeMemo 有限结算（EXIT=0）
```

**R2 Verdict: pass**——R1 报告四项阻断项（R1/R2/R3/R4）全部闭合且证据齐备；裁决 3 产物（E5 子句 +
一行接线 + 测试⑦豁免）与 SA2 R3 放行路径逐字一致；§二非阻断处置到位。SA7 可进入动态验证
（重点清单：R1 报告 §六 1-5 + 本轮 O1 的 E5 运行时锚）。
