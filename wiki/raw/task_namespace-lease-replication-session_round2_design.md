# 设计增补（R2.2）— issue #134 Round 2 修订轮（PR #146 评审 12 项 → R2-1..R2-12）

- **修订轮次**: **R2.2**（2026-08-28）——SA3 交付（commit 8a68d82）后的三项就地裁决：① 认可偏离 1（§5.1 白名单物化前提被 yjs 13.6.32 实测反证——plain array/object 经 lib0 `writeAny` **原样存储**，非物化为 Y.Map/Y.Array；白名单修正为「Y.Map/Y.Array ∪ plain array ∪ plain object」；**SA2 R2.2 复审 M-1 指出 ADR L273 括注仍残留已作废前提原句——经 M-1 就地修正后设计/实现/ADR 三方逐字一致**）；② 认可发现 1（§19「订阅先于写⇒快照漂移不可观测」声称与 round-1 registry AC-2 ③ 事实不符——作废该声称 + 登记 AC-2 ③ 一行 fixture 时序演进授权）；③ 采纳发现 2 处置 (a)（spin fixture 测试末 close 收尾——§4.3(d)/§18 补测试隔离义务注记，SA7 满载协议保持）。另核：偏离 2（新文件 ~740 行）认可、偏离 3（SA2 #5 可选锚改由 SA7 可选承接）裁决登记。详见文末「R2.2 修订记录」。
- **R2.1**（2026-08-28）：逐条落实 SA2 round-2 攻击评审（verdict: reject——HIGH×1 / MEDIUM×2 / LOW×5；机制骨架经全维攻击成立）。必修 1（#1）= 交付集语义 at-least-once 明文冻结（路 A）；必修 2（#2）= Y.Text 三处一致化（路 B 白名单）；#3–#8 全部采纳。
- **R2 首版**（2026-08-28）：本文件是 round-1 设计（`task_namespace-lease-replication-session_design.md`，R1.1）的**增量增补**，不替代基线——基线的 O-1..O-12 裁决骨架、seam 结构、apply 槽序 R1–R7、Equal 锁格架继续有效；本增补只修订评审 12 项触及的机制面（§1 明文列出被作废的 round-1 断言）。
- **worktree**: /home/wangjian/nomicore-fix-issue-134（基线 = PR #146 当前代码，round-2 红灯套件已入库）
- **任务类型**: 合同缺陷修复（评审阻断 1–5 为 file:line 契约违背，SA8 已裁为「实现向 ADR 条款的回归」）+ 小型功能补全（R2-8）+ 测试/文档收口（R2-9..R2-12）
- **必读输入已消化**: round-2 任务简报（评审 12 项全文 + AC-R2 映射）、round-2 冲突报告（verdict clear，#1–#12 对账 + 登记义务 D-1..D-4 + R2-4 路径 (a) / R2-7 成功接纳即置位 / R2-8 双路放行方向）、round-2 relevant_decisions 增量、round-1 relevant_decisions（O-1..O-12 + 设计后复审追加节）、round-1 设计 R1.1 全文、SA6 round-2 红灯锚定报告（29 用例：21 红 / 8 绿锁定 + §3 六项待冻结清单）、源码（replication-session.ts 660 行 / runtime.ts 476 行 / replication-write.ts 426 行 / close.ts / sequencer.ts / lease.ts 438 行 / plugin.ts 208 行 / registry.ts 1340 行 / types.ts 555 行）、round-1 两测试文件（52 用例 R2-10 加严版）、ADR 0010 修订节（L230–263）、phase-5 文档切片 3/4、两包 README、registry-plugin.test.ts 文案锚。
- **验证基线**: SA6 两个 round-2 红灯文件（runtime 17 用例 / registry 12 用例）逐用例核对（§15 矩阵），全部有实现路径且**零锚改形**（SA6 §3 预留的 fixture 类型面同步除外，见 §15.3）；round-1 既有 52 用例中仅 1 处断言值需按 §0 裁决 3 演进（SA3 owned，§15.2）。

---

## §0. 六项待冻结裁决总表（SA6 round-2 报告 §3 逐项冻结；正文论证见对应章节）

| # | 冻结裁决 | 论证章节 |
|---|---|---|
| F-1 | **needs-resync 标记形状** = session status 第 11 字段 `needsResync: boolean`（初值 false、**sticky**——置位后 session 生命周期内永不清除，无清除 API；清零路径 = transport reset/bootstrap 后 open 新 session）。**标记后 channel 投递行为 = 继续投递**（ADR 0010 L113「**只**把 channel 标记为 needs-resync」字面——标记是观测信号不是行为切换；deliver/detach 分离，与 L241 observerFailures「不熔断不断扇出」同构）。**队列有界语义** = 每 channel（= 每 session）容量 **16 项**冻结常量 `FANOUT_CHANNEL_QUEUE_CAPACITY`（不可配置——沿 RAW_PROTECTED_FIELDS「raw caller 不得逐次自定义」同款纪律）；**溢出触发条件** = observer 入队时 `queue.length >= 16`，处置 = **丢弃新项**（保序：已入队最旧项保留，与 L151「丢弃未发送增量」同向）+ 置 `needsResync`；容量检查先于字节复制（溢出路径零分配） | §4 |
| F-2 | **R2-2 session 终态词汇 = `closed`**（非冲突性终态）。Runtime close 对现存 session 的终止是「close 生命周期事件的 session 面等价物」——语义属 closed 家族；`conflicted` 保留给 epoch fence（L245 词义不污染）。内部记账 `closedBy: 'runtime-close'`（**不进 status 形状**——A1 拒绝码映射专用，§3.3） | §3 |
| F-3 | **R2-1 fence 与 bump 自身 META 写的相对序** = fence 落点 bump 槽 **E5.5（同步投影步：事务后、`await notifyDirty` 前）**；bump 自身 META 写的 update 事件在 E5 事务内已发出、owned bytes 已入旧 session 队列，但 **fence 取消该 channel 全部未投递排队项** ⇒ 旧 session 对 bump 写**零投递**。round-1 T-3 锚 `afterBump === 1` 演进为 `=== 0`（联动面登记 §15.2）。理由：向已被 fence 的 session 投递 fence 自身的 epoch 字节语义自相矛盾（L53「旧 epoch 的 peer 必须显式 reset/bootstrap」；round-1 ADR 增补节已登记「epoch 传播走控制面、bump 字节不得经 raw 回灌」踩坑注记） | §2 |
| F-4 | **R2-6 精确二分判据** = R5 内挂 `beforeTransaction` 探针：`txStarted === false`（探针未运行 ⇒ beforeTransaction emit 未完成 ⇒ 事务函数从未执行）⟹ `committed:false`；`txStarted === true`（事务已开始，mutation 程度不可判）⟹ 保守 `committed:true`。**无需保守过报规范**（SA6 实测 Yjs 13.6.32 `transact` 的 beforeTransaction emit 先于事务函数——#13 注入证实零 mutation）。例外注记（D-4 随登记）：二分精确性条件 = 注入面为 yjs 事务钩子域；解码期异常（R4 已拦 `REPLICATION_RAW_UPDATE_INVALID`）、notifyDirty 失败（`committed:true` 既有锁定）不在判据内；复合敌意（beforeTransaction 内先变异后抛错的多个敌意 listener）属 ADR 0007 L54 observer 契约破坏域，不承诺 | §7 |
| F-5 | **R2-5 注入面说明** = hostile core 经 `lease.ts` 包内直构（`createLeaseController` 第 4 参 `deps.openReplicationSessionCore` 注入敌意实现），绕过真实 runtime seam（该 seam 无测试注入点——registry.ts 直传真函数）。**行为契约与注入面分离**：SA6 断言全部锚公共可观察行为（release 同步面 / onReleased / close 尝试 / 释放事实）；修复只改 doRelease 顺序即绿，注入面合法且零改动。设计确认此注入面为 lease.ts 包内通道的正当用途（不触 internal subpath import 图） | §6 |
| F-6 | **R2-9 联动确认** = registry 侧 #11（Runtime close × in-flight apply）与 #12（epoch bump × in-flight apply）的终态断言与 R2-2 / R2-1 的红同源——FIFO 序部分已绿（真实缺口只是终态化），R2-1/R2-2 修复落地后两用例自然转绿，**无新增语义分歧、无测试改形** | §10 |

---

## §1. round-1 断言作废清单（明文修订——SA8 冲突报告 D-1 指定的两处 + 本增补充分推演追加三处）

| round-1 位置 | 原断言 | 作废/修订为 |
|---|---|---|
| 设计 §0 O-10（L24） | 「同步扇出；……队列/背压/needs-resync 属切片 6，本切片无队列（**同步扇出天然不阻塞 sequencer**）」 | **作废**（事实性错误：慢 listener 阻塞 transaction 返回 → 阻塞槽释放 → 阻塞 sequencer——评审阻断 3）。修订为：observer 内只复制 owned bytes，投递经有界异步队列（§4）；needs-resync 于本切片落地（capacity 16） |
| 设计 §4.4 R5 槽位（L370） | 「fanout 在事务内同步扇出（ADR 0010 六步之 4——**结构性满足**）」 | **作废**（读法不完备）。修订为：六步之 4 要求的是「**产出** owned update 与受控 origin」——产出仍同步发生在 observer 内（字节复制），异步的是**投递**（listener 消费）；第 5/6 步（saveDoc、释放槽）照旧 |
| 设计 §5.5 shutdown 条目（L522） | 「Registry **不**主动终态化 session（……本切片 session 保持 open 但写通道死）」 | **作废**（评审阻断 2）。修订为：Runtime close 同步段主动终止/detach 全部现存 sessions（终态 `closed`，§3）；Registry shutdown 经 Runtime close 获得同一效力 |
| 设计 §9.1 T-3 行（L642） | 「bump → …→ 断言 session1 listener **零新增投递**」+ runtime 测试 L344 `expect(afterBump).toBe(1)`（bump 写投递 events=1） | 断言语义保留（fence 后零投递），**锚值演进**：`afterBump === 0`（F-3：fence 取消未投递排队项——bump 写零投递）。SA3 owned 文件一行演进，§15.2 登记 |
| 设计 §5.5（L522 同段） | 「encodeStateVector 为 best-effort……本设计不承诺其结果」 | **收窄为确定行为**：Runtime close 终止 session 后 `encodeStateVector`/`encodeDiff` 同步 throw `ReplicationSessionClosedError`（终态纪律统一——与显式 close/conflicted 一致；停止序违约面从「不承诺」升格为「确定拒绝」） |

（ADR 0010 L241「熔断/背压属切片 6 队列属主」收窄与 phase-5 L81 C-1 注记改写在 §14 文档同步清单。）

---

## §2. R2-1 — bump 槽边界主动 fence 旧 epoch session

### §2.1 机制

评审阻断 1 的修法 = **bump 槽 E5.5 主动 fence**（SA8 放行方向；ADR 0008 #132 L134 槽序「单 Yjs transaction → 同步投影 → await notifyDirty」的「同步投影」步 = fence 落点，零新增 sequencer 机制）：

```ts
// replication-write.ts runBumpReplicationEpochSlot 的 E5.5 增补（事务返回后、E6 之前）：
env.state.replication = Object.freeze({ state: 'enabled', replicationId: facts.replicationId, replicationEpoch: nextEpoch });
env.fanout.fenceStale(facts.replicationId, nextEpoch);   // ← R2-1 新增：bump 槽同步投影步主动 fence
```

- `SessionFanout` 接口追加方法 `fenceStale(replicationId: string, replicationEpoch: number): void`：遍历 fanout channel 集合，凡 channel 冻结 `(replicationId, replicationEpoch)` 与传入不等（身份不等或 epoch 落后）→ 调 `channel.finalize('conflicted')`。bump 后 `nextEpoch` 为全新值 ⇒ 全部现存 channel（全部冻结旧 epoch）被 fence——无幸存者、无逐 channel 判断遗漏。
- `SessionChannel` 结构扩展（单次成型于 `createSessionCore`）：追加冻结 `replicationId` / `replicationEpoch`（fence 谓词输入）+ `finalize` 回调 + `isTerminal` 回调（core 闭包——**终态唯一可变源仍在 core**，channel 不复制终态，防双写）。
- `finalize('conflicted')`（core 闭包，幂等）：
  1. `if (coreState.terminal !== 'open') return;`（conflicted 后再 fence / close 幂等无害，状态保持）
  2. `coreState.terminal = 'conflicted';`（L245 终态语义复用——释放 Lease session 槽位 ⇒ 同 Lease 可再 open 新 epoch session）
  3. `fanout.detach(channel);`（L247 摘除点复用——存量 listener 即刻停止投递）
  4. **取消全部未投递排队项**（`channel.queue.length = 0`；进行中的 pump 于下一让步点经 `isTerminal()` 退出——§4.2 要点 7）。F-3：bump 自身 META 写的 bytes 已在 E5 入队，被本步取消 ⇒ 旧 session 对 bump 写零投递。
- `ReplicationWriteEnv` 追加 `fanout: SessionFanout` 字段（runtime.ts 构造序同批捕获局部量——INV-N14 纪律延续；enable/bump 两槽共享 env，见下）。
- **enable 槽不 fence**（显式裁决）：open 门序要求 facts `enabled`（O-7）⇒ disabled 文档结构性不可能持有 session；已启用文档的 enable 为幂等零写。enable 的 E5 事务（首装谱系）发生时 fanout channel 集合必空。SA3 不得在 enable 槽加 fence 调用。
- **【R2.1 / SA2 #4】实现不变量注记（冻结）**：`finalize` 只摘除**自身** channel（`fanout.detach(channel)` 以自引用为参）；`fenceStale` 迭代期间的 `Set` 删除**限于当前被访元素**（JS Set 迭代语义下安全——SA2 已核实）。若未来引入终态级联（finalize 摘除非当前 channel），现行迭代将静默跳过未访元素——SA3 不得引入级联摘除；如确需，必须同步改为快照迭代（`[...channels]`）。

### §2.2 与既有面的相容性推演

- **FIFO（runtime red #3 / registry red #12，绿锁定）**：apply A → bump → apply B 同一 sequencer 定序；A 先过 R2 gate 照常提交（gate 瞬时观察——ADR 0008 L47 同构）；bump 槽 E5.5 fence；B 的槽内 R2 比对（既有被动 fence，O-8）发现 epoch 不等 → 幂等 finalize（已终态，no-op）+ `REPLICATION_EPOCH_CONFLICTED` 零写入。主动 fence（bump 槽）与被动 fence（apply 槽 R2）共用同一 finalize——**零新增终态语义**（D-2a 登记：L245/L247 追加 bump 槽触发面）。
- **在途竞态**：apply 在 bump 之后接纳（bump 槽尚未运行）：接纳层 A1 检查时 terminal 仍 `open`、A3 lifecycle 仍 `ready` → 入队；槽内 R2 兜底 fence（上条）。fence 时序竞态被 FIFO + 槽内重读结构性消除。
- **新 epoch session 重建（registry red #3）**：fence 同步置终态 ⇒ Lease 层 open 编排 ④ 的活跃检查（`activeSession.getStatus().state === 'open'`）读到 `conflicted` ⇒ 放行再 open；新 open 冻结 `replicationEpoch = 2`（L245「终态后同 Lease 可再 open」）。**registry lease.ts 零改动**。
- **`getStatus()` 可观测性**：fence 后 `state === 'conflicted'`、`currentEpoch === 2`（投影链已在 E5.5 先行整替——finalize 在整替之后调用，读数诚实）、冻结 `replicationEpoch === 1` 不漂移（INV-S5）。

### §2.3 测试归属

SA6 红套件转绿：runtime red #1（bump 后零投递）/ #2（conflicted 可观测）；registry red #1/#2/#3（Lease 面同款 + 再 open）。SA3 包内补充（`runtime-replication-session-round2.test.ts`，§15.2）：fenceStale 谓词单元锚（身份不等 / epoch 落后 / 幸存者不存在）、fence 取消排队项的队列级断言、**双 channel 直构谓词正反锚（R2.1 / SA2 #4 加严：经包内通道直构 fanout + 两 channel——一命中谓词一不命中——`fenceStale` 后恰命中者终态化、不命中者不受扰、迭代无跳过无过栅）**。

---

## §3. R2-2 — Runtime close 同步段终止并摘除现存 sessions

### §3.1 机制

评审阻断 2 的修法 = runtime `close()` 同步段追加 session 面终止（ADR 0008 L93「立即停止接纳公共 read 和 write」的 session 面等价物）：

```ts
// runtime.ts close()（幂等 same-promise 结构不变）：
close: (): Promise<void> => {
  if (closePromise !== undefined) return closePromise;
  state.lifecycle = 'closing';                       // ① 既有：同步停接纳（read/write/apply 接纳层）
  fanout.terminateAll('runtime-close');              // ② R2-2 新增：终止/detach 全部现存 sessions（同步段）
  closePromise = sequencer.enqueue(() => runCloseBarrier(closeEnv));  // ③ 既有：队尾 barrier
  return closePromise;
};
```

- `SessionFanout` 追加方法 `terminateAll(cause: 'runtime-close'): void`：遍历 channel 集合，逐 channel `finalize('closed', 'runtime-close')` 并从集合移除。顺序冻结：**lifecycle 翻转之后、barrier 入队之前**（同一同步段内，JS run-to-completion 原子）。**【R2.1 / SA2 #4】实现不变量注记（冻结，与 §2.1 同款）**：finalize 只摘除自身 channel；terminateAll 迭代期删除限于当前被访元素；SA3 不得引入级联摘除（如需，改快照迭代）。
- `finalize('closed', 'runtime-close')`：仅 `terminal === 'open'` 时迁移（conflicted 保持 conflicted——终态不降级）；置 `coreState.terminal = 'closed'` + 内部记账 `closedBy = 'runtime-close'`（**不进 status 形状**——SA6 锚只要求 `state !== 'open'`）+ detach + 取消全部未投递排队项（§4.2 要点 7 同款）。
- **close barrier / 已接纳 apply 排空语义（零新增机制）**：barrier 在队尾（INV-C4）⇒ 先于本次 close() 接纳的全部任务（含在途 apply 槽）无条件排空（ADR 0008 L93「此前已接纳任务无条件排空」+ ADR 0010 L179「等待已被 Runtime 接纳的 apply 槽完成」）；runtime red #6 / registry red #10/#11 的 FIFO 序（`[apply, close]` / `[apply, shutdown]`）由既有 sequencer 结构保证——**close.ts / sequencer.ts 零改动**。apply 槽体内不检查 session 终态（接纳层 A1 是唯一终态门——round-1 冻结，不变）。
- `session.close()` 幂等 same-promise 不变：Runtime close 经 finalize（不经 core.close()）终止的 session，其后任何 `close()` 调用走既有路径（terminal ≠ open ⇒ 跳过标记 + 惰性入队一个恒绿空槽体 barrier + 缓存）——首次调用缓存后所有调用同实例，永不 reject（INV-S11 延续）。

### §3.2 活跃 session 注册面（host 侧维护方式——零属性污染纪律）

「host 侧维护活 session 注册面」的落点 = **fanout 的 channel 集合本身**（`Set<SessionChannel>`）：channel 与 session core 在 `createSessionCore` 内一次成型互持（channel 持 finalize/isTerminal 闭包，core 持 channel），attach 即注册、detach/finalize 即注销。**不新增第二注册结构、不触碰 runtime 对象**（WeakMap host 一次成型 + Object.keys 仍恰十二键——round-1 D-2 纪律不变）。brief 提示的「WeakMap host 一次成型与零属性污染」由此满足：fanout 本就在 host 内。

### §3.3 apply 拒绝码映射精化（round-1 既有锚保持绿的关键）

Runtime-close 终止的 session 上后续 `applyRemoteUpdate` 的拒绝码：**`RUNTIME_WRITE_DISABLED`（lifecycle 分域 message）**，而非 `REPLICATION_SESSION_CLOSED`。实现：接纳层 A1 精化——

```ts
if (coreState.terminal === 'closed') {
  if (closedBy === 'runtime-close') {
    return refusal('RUNTIME_WRITE_DISABLED', writeDisabledMessage('lifecycle', host.state.lifecycle));
  }
  return refusal('REPLICATION_SESSION_CLOSED', REPLICATION_SESSION_CLOSED_MESSAGE);
}
```

依据：ADR 0008 #93 修订节第 (4) 类「close 后 lifecycle≠ready 的接纳拒绝 → `RUNTIME_WRITE_DISABLED`」——session apply 在 Runtime close 后的拒绝本质是 close 域接纳拒绝，session 级 closed 只是派生事实；码域统一到 #93 注册表。**锚保持**：registry round-1 L1287-1289（shutdown 后 apply 含 `RUNTIME_WRITE_DISABLED`）与 runtime round-1 L719-736（close 后 apply 含 `close 已停止接纳会话 apply`）两处既有绿锚零改动即绿。A0（lease revoked）→ A1 → A2 → A3 顺序不变（round-1 §4.4 冻结）。

### §3.4 其余能力面

- `getStatus()`：全生命周期可观测不变（round-1 §5.5 既定）；终态后读 `state === 'closed'`、`currentEpoch` 照常读投影链。
- `encodeStateVector` / `encodeDiff`：终态同步 throw `ReplicationSessionClosedError`（§1 作废清单第 5 行——best-effort 措辞收窄为确定 throw；无既有测试锚）。
- `subscribeOwnedUpdates`：终态 no-op 订阅不变；存量 listener 经 detach + 队列取消双通道停投（runtime red #5：close 后直接 doc 写零投递——observer 遍历空 channel 集）。

### §3.5 测试归属

SA6 红套件转绿：runtime red #4（终态）/ #5（零投递）；registry red #11（shutdown × in-flight apply 终态）。绿锁定不受影响：runtime red #6 / registry red #10（排空 FIFO）。SA3 包内补充：terminateAll 单元锚（conflicted 不降级为 closed / closedBy 映射 / 重复 close 幂等同实例）。

---

## §4. R2-3 — fanout 异步化：owned bytes 复制 + 有界队列 + 自延伸微任务泵

### §4.1 评审阻断 3 的机制修法（总览）

observer（`doc.on('update')`，构造期恰一监听——INV-S2 不变）内**只做**：回声抑制谓词 → 容量检查 → **owned bytes 复制**（`update.slice()`——六步之 4「产出」的同步面）→ 入队 → 调度泵。**listener 调用全部移出 transaction 栈**（时序隔离 + 既有 try/catch 异常隔离双保险）：

```ts
// 冻结常量（模块私有；不可配置——F-1）
const FANOUT_CHANNEL_QUEUE_CAPACITY = 16;        // 每 channel（= 每 session）排队项上限
const FANOUT_DELIVERY_DEFERRAL_MICROTASKS = 20;  // 每次投递前的微任务让步数（§4.3 时序论证）

doc.on('update', (update: Uint8Array, origin: unknown) => {
  for (const channel of channels) {
    if (origin === channel.applyOrigin) continue;          // 回声抑制（INV-S3 唯一谓词，不变）
    if (channel.isTerminal()) continue;                     // 终态双保险（detach 后结构性不可达）
    if (channel.queue.length >= FANOUT_CHANNEL_QUEUE_CAPACITY) {
      channel.needsResync = true;                           // L113：溢出 → 只标记（丢弃新项、零分配）
      continue;
    }
    channel.queue.push(update.slice());                     // owned bytes 复制（隔离 yjs 数组复用）
    schedulePump(channel);                                  // 泵已调度则 no-op（单飞守卫）
  }
});
```

### §4.2 泵（pump）——自延伸微任务链

```ts
function schedulePump(channel: SessionChannel): void {
  if (channel.pumpScheduled) return;
  channel.pumpScheduled = true;
  void (async () => {
    try {
      while (channel.queue.length > 0 && !channel.isTerminal()) {
        for (let i = 0; i < FANOUT_DELIVERY_DEFERRAL_MICROTASKS; i += 1) await Promise.resolve();
        if (channel.isTerminal() || channel.queue.length === 0) return;   // 让步后重检（fence/terminate/清队）
        const item = channel.queue.shift()!;                               // FIFO：最旧先投（溢出弃新保旧）
        for (const listener of [...channel.listeners]) {                   // 交付时刻 listener 快照（要点 8——R2.1）
          try { listener(item.slice()); }                                  // 每 listener 每投递独立副本（INV-S4 字节面）
          catch { channel.failures += 1; }                                 // 自捕获计数（observerFailures——要点 5）
        }
      }
    } catch {
      // 【R2.1 / SA2 #7】最外层兜底：listener 已逐个隔离、shift()/slice() 结构性不可抛，
      // 但未来任何编辑引入非 listener 抛点时收敛为计数而非 unhandled rejection。
      channel.failures += 1;
    } finally {
      channel.pumpScheduled = false;   // 与 while 退出检查同一同步段（无 await 间隔）⇒ 无丢失唤醒
    }
  })();
}
```

设计要点（冻结）：

1. **每 channel 独立泵**（channel = session：多 session 互不拖累——AC-6 fan-out 结构延续）。
2. **单飞守卫 + 自延伸链**：任一时刻每 channel 至多一个泵 continuation 挂起（`await Promise.resolve()` 在循环内逐次延伸，非一次性预排 k 个微任务）。这是「公平性」的机制根源：** sequencer 槽 thunk / 调用方 await 续体在入队时即排在泵的下一个 continuation 之前**——泵不能长期霸占微任务队列（§4.3）。
3. **每项投递前统一让步 20 次**（首项与后续项同规——无特例）。让步只产生微任务计数，不产生墙钟等待。
4. **投递时逐 listener `item.slice()`**：队列项是 channel 级单副本（observer 复制一次，隔离 yjs 对 update 数组的复用）；交付时每 listener 每投递再造独立副本——INV-S4 的**字节面**（「每 listener 每投递独立 `Uint8Array`、byteOffset=0、全幅、底 buffer 不共享」）逐条保持（R2-10 加严锚 + round-1 两文件锚全部兼容）。两级复制是正确性优先的有意成本（ADR 登记性能注记，§14）。
5. **`observerFailures` 计数语义不变**（无界纯计数、不熔断不自动退订——O-10 显式选择延续）：listener throw 在投递点自捕获计数；变更仅是捕获点从 observer（transaction 栈内）移到泵（transaction 栈外）——隔离从「异常域」升级为「异常域 + 时序域」。（计数面不变；投递时机的语义增量见要点 8。）
6. **零订阅者 channel**：泵照常消费队列（对空 listener 快照迭代 = no-op）——不引入退订侦测特例；队列容量照常约束（订阅空转的 transport 自担溢出标记）。
7. **与终态的互斥**：泵循环条件 + 让步后重检双闸（`isTerminal()`）；fence/terminate 的清队使 `queue.length === 0` 双重成立。
8. **【R2.1 / SA2 #1 必修——交付集语义冻结（公共能力面行为契约增量，at-least-once）】交付集 = 交付时刻的 listener 快照**（`[...channel.listeners]` 于每项投递时点取，非入队时点）。三段明文推论：
   - **晚订阅者可收到订阅前入队的 update**——慢消费者积压下（让步窗口 ~20 跳起、满积压可长达 16 项排空全程），`subscribeOwnedUpdates` 返回后新 listener 仍会收到积压中尚未投出的项；
   - **跨退订→重订周期可重复收到同一 update**（同一队列项在两次订阅窗口各投一次）；
   - 重复交付的正确性锚 = **Yjs `Y.applyUpdate` 幂等吸收**（CRDT 重复应用零效果）——切片 6 transport 的 at-least-once 语义天然契合；round-1 同步扇出下交付集 = 事件时刻快照、该语义结构性不存在，**本条即异步化的行为契约增量**（经 SA2 攻击确认必须冻结，非 SA3 实现的偶然产物）。
   登记落点：本要点 + §14 D-1 ADR 增补句 + §19 契约改动表新增行 + §15.2 SA3 锚 ×2（积压期订阅收到积压项 / 退订重订重复交付幂等吸收）。

### §4.3 时序论证（F-1/F-3 与 SA6 锚的全量相容）

**(a) 慢 listener 零阻塞写结算（runtime red #7/#8）**。写槽结算链深度（结构性，非墙钟）：`enqueue` 的 `.then`（1）→ 槽 thunk 同步段（含 transaction/observer 入队）→ `await notifyDirty` 续体（1）→ promise adoption（1–2）→ 调用方 await 续体 T（1–2）≈ **5–8 跳**。泵首投递在 20 次让步之后（≥20 跳）⇒ **T 恒先于 listener 调用** ⇒ `await mutateRoot` / `await applyRemoteUpdate` 的墙钟不含 listener 自旋（红锚阈值 250ms vs 自旋 400ms，判别裕度充足）。
**(b) 后续 sequencer 槽不被 pending 投递阻塞（red #8 第二段）**。自延伸链在任一时刻只持一个挂起 continuation：第二写在 T1 同步段入队时，其槽 thunk 立即排在泵下一个 continuation 之前（微任务 FIFO）⇒ 槽结算（~6 跳）先于泵剩余让步（≥14 跳）⇒ `t3 - t2` 不含 400ms 自旋。预排式链（一次排满 k 个微任务）无此性质——本设计显式排除之。
**(c) `flushMicrotasks()` 可观测（round-1 两文件 + R2-1/R2-10 基线锚）**。首投递位置 ≈ 20 + 写链 ~6 ≈ 26 跳 < registry 侧 flush 预算 40 < runtime 侧 60——全部「await 写 → flushMicrotasks → 断言 events 长度」锚在预算内可见。
**(d) 溢出确定性 + 突发零阻塞（runtime red #9）【R2.1 / SA2 #3——裕度区间化表述】**。64 个顺序 await 写 ≈ 64×（6–9）跳（每写跳数随链深摆动）；投递节奏 = 每 20 跳一项 ⇒ 突发期间交错投递 D ≈ **15–22 项**（随跳数漂移）× 15ms ≈ **225–330ms** + 64 次写开销（CI 负载敏感，~0.2–2ms/次）⇒ 端到端 ≈ **240–390ms**，对 400ms 阈值的裕度区间 ≈ **10–160ms**（悲观端紧——非固定「≥70ms」）。**20 让步常数为双向 load-bearing**：下界（公平性——须 > 写结算链上界 ~8 跳）与上界（flush 预算——须满足 registry 侧 40 轮内首投递可见），合法区间 [16, 24]（§18 第 4 行推演）。**SA7 移交注记**：red #9 的墙钟断言须在 vitest forks 池满载下复跑 ≥3 次取最坏值（SA2 协议），验证最坏值 < 400ms 且落在本区间；队列在 ~第 26–30 写处涨满 16 ⇒ 溢出标记 `needsResync === true`（确定性成立：生产速率 > 消费速率，涨满单向——与墙钟无关，不受负载影响）。
**【R2.2 / 发现 2——测试隔离义务（冻结为测试面契约）】**异步泵 + 同步自旋 fixture 存在固有跨测试泄漏面：**spin fixture 测试（red #7/#8 及一切含慢 listener 自旋的用例）必须在测试末尾 close session 收尾**（`sessionX.close()` → finalize 终止 channel + 清队 ⇒ 泵于下一让步点退出，遗留排队项不再投递——零断言改形）。机理（SA3 探针实测）：未收尾时前测的遗留自旋（red #8 的 400ms）在微任务 FIFO 中排在后测首写槽 thunk 之前，整体计入后测 elapsed——red #9 整文件跑恒 584–607ms（= 自身 ~190ms + 泄漏 400ms）即此机理；**本区间估算（240–390ms）只覆盖单测试窗口**，跨测泄漏属测试隔离缺失而非泵缺陷（listener 已在 transaction 栈外——设计意图成立）。隔离修复后单用例实测 187–227ms（SA3，3/3）——**低于区间下界 240ms（方向更优：实际交错交付与写开销低于区间估算的保守端；区间为上界包络而非点估计——N'-3 措辞修正）**；SA7 满载复跑协议在收尾落地后保持。SA6 执行清单见 §15.3-4。
**(e) 生产语义**：真实 `notifyDirty`（saveDoc I/O）挂起期间泵自然完成投递——槽悬浮于 I/O 时投递免费完成；listener 墙钟不再进入 transaction 返回路径（评审阻断 3 的原始病灶消除）。ADR 0010 L113「队列溢出只把 channel 标记为 needs-resync，不得阻塞 write sequencer」自 round-1「结构性不可达」读法改为**字面实现**（D-1 登记）。

### §4.4 needs-resync 语义（F-1 冻结汇总）

| 维度 | 冻结值 |
|---|---|
| 可观测面 | `getStatus().needsResync: boolean`（status 第 11 字段；初值 false） |
| 置位条件 | observer 入队时该 channel 队列已满（≥16）——唯一触发面 |
| 置位后行为 | **继续投递**（标记不改变投递机制；transport 观测后自行决策 reset/bootstrap——切片 6 消费） |
| 清除 | 无（sticky；session 生命周期内恒 true；新 session = 新 channel = 新队列） |
| 溢出丢弃 | 丢弃**新**项（已入队最旧项保序投出——与 L151「丢弃未发送增量」同向） |
| 队列属主边界 | 本队列 = fanout **投递**队列（runtime 内，session 域）；WS 发送队列/连接级背压仍属切片 6（ADR 0010 L151 域——D-1 收窄注记） |

### §4.5 测试归属

SA6 红套件转绿：runtime red #7/#8（非阻塞）/ #9（溢出可观测 + 突发零阻塞——墙钟裕度区间与 SA7 满载复跑协议见 §4.3(d)）。SA3 包内补充（§15.2）：容量边界（16 入 17 弃）、弃新保序、sticky、标记后继续投递、两级副本独立性、泵与 unsubscribe 交互、**交付集语义锚 ×2（R2.1 / SA2 #1：积压期订阅收到积压项 / 退订重订重复交付 + `Y.applyUpdate` 幂等吸收）**。

---

## §5. R2-4 — 受保护字段结构值规范化深比较（SA8 放行路径 a）

### §5.1 判据细化（O-12 演进——L251 增补，D-3）

round-1 `protectedPrimitiveEqual` 将一切非 primitive 恒判「已改变」——对 ADR 0008 L31 合法值域（「JSON-compatible plain value，含 object/array」）产生 false positive（合法 ROOT-only update 被误拒 → session 可用卡死——SA8 放行方向 (a) 的动因）。修订为**规范化深比较**：判据名不变（内容投影相等——L251 自名），值域覆盖扩展到 L31 全部合法值：

> **【R2.2 前提修正——偏离 1 裁决认可】**yjs 13.6.32 对 plain 值的本地存储形态：`Y.Map.set(k, plainValue)` 经 lib0 `writeAny` **原样存储**（plain array 仍为 `Array.isArray === true` 且 `instanceof Y.Array === false`；plain object 仍为 `Object.prototype` 原型、非 `Y.Map`；encode/apply round-trip 后仍为 plain——本设计 R2 首版「合法 plain value 经 Yjs 物化的仅有两种本地形态 = Y.Map/Y.Array」**前提错误**，已被 SA3 实现期实测与本修订设计期复测双源反证）。白名单据此修正为**合法 plain 值域的实际本地形态 ∪ 手工容器形态**：`plain array ∪ plain object（proto∈{Object.prototype,null}）∪ Y.Map ∪ Y.Array`（后两者覆盖显式 `set(k, new Y.Map())` 构造的容器——`toJSON()` 投影后同为 plain 结构）。修正不改变路线 (B) 的保守边界：**一切非白名单 `instanceof Y.AbstractType` 容器（Y.Text 等）与 Date/Map/Set 等非 plain 实例维持保守拒**。

```ts
/** 白名单值容器判定（R2.2 / 偏离 1——与实现 isWhitelistedValueContainer 逐字一致）：
 *  Y.Map/Y.Array（显式构造容器）∪ plain array ∪ plain object（proto∈{Object.prototype,null}
 *  ——yjs writeAny 原样存储域，排除 Date/Map/Set 等非 plain 实例与一切其它 AbstractType）。 */
function isWhitelistedValueContainer(value: unknown): boolean {
  if (value instanceof Y.Map || value instanceof Y.Array) return true;
  if (Array.isArray(value)) return true;
  if (typeof value !== 'object' || value === null) return false;
  if (value instanceof Y.AbstractType) return false; // Y.Text 等——契约外容器
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** 值投影相等（O-12 判据 (a) round-2 细化；R2.1 / SA2 #2——白名单路线 (B)；R2.2 白名单
 *  扩至 plain 实际存储域）：primitive 直比（SameValue）；白名单容器经 projectOf 投影
 *  （Y.Map/Y.Array → toJSON() 递归；plain 结构直递）后深比较；其余一切形态保守判
 *  「已改变」——即使内容未变亦拒（round-1 姿势对契约外形态连续，见 §5.2 注记）。 */
function protectedValueEqual(a: unknown, b: unknown): boolean {
  const aContainer = isWhitelistedValueContainer(a);
  const bContainer = isWhitelistedValueContainer(b);
  if (aContainer || bContainer) {
    if (!(aContainer && bContainer)) return false; // 跨形态分叉（白名单容器 vs primitive/契约外容器/异型）
    return deepEqualPlain(projectOf(a), projectOf(b));
  }
  // 白名单外的容器（Y.Text 等 AbstractType）与一切契约外标量在此落入保守拒：
  // typeof 恒 'object' ≠ string/number/boolean，非 null ⇒ return false。
  const t = typeof a;
  if (t === 'string' || t === 'number' || t === 'boolean') return typeof b === t && Object.is(a, b);
  if (a === null) return b === null;
  return false; // 契约外（ADR 0008 L31 值域外 / 存储域外容器）保守拒
}

/** 白名单容器投影：Y.Map/Y.Array → toJSON()（递归 plain 化）；plain 结构直递（已是投影形态）。 */
function projectOf(value: unknown): unknown {
  return value instanceof Y.Map || value instanceof Y.Array ? value.toJSON() : value;
}

/** plain 结构深比较（规范化规则冻结）：array 有序递归；plain object 键序无关（键集相等后逐键）；
 *  primitive SameValue（NaN=NaN、-0≠0——round-1 语义延续）；其余形态 false。 */
function deepEqualPlain(a: unknown, b: unknown): boolean {
  if (a === null || b === null) return a === b;
  const t = typeof a;
  if (t === 'string' || t === 'number' || t === 'boolean') {
    return typeof b === t && Object.is(a, b);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqualPlain(item, b[i]));
  }
  if (t === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    return ka.every((k) => deepEqualPlain((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false; // bigint/symbol/function/undefined 等：契约外
}
```

**路线裁决（R2.1，SA2 #2 二选一——选 (B) 保守白名单；R2.2 前提修正）**：(A)（按 `instanceof Y.AbstractType` 泛判 + 投影相等放行）会使契约外**存量**容器（Y.Text 同型等值）经放行面——对 L31 值域构成未经评审的静默宽恕；(B) 把投影比较域对齐**合法值域的本地存储域**（R2.2 修正后 = plain array/object 原样存储形态 ∪ Y.Map/Y.Array 手工容器形态），其余一切形态维持 round-1 保守拒——「修正 false positive 而非放宽保护」（SA8 对路径 (a) 的原始定性）在容器域内同样成立。触发面权衡（SA2 提供）：契约外 Y.Text 仅种子/直构面可达（合法写路径结构性不可达），(B) 下此类文档维持 round-1 全拒行为——零回归、零宽恕面。**R2 首版 (B) 的「仅物化为 Y.Map/Y.Array」表述系对 yjs 存储行为的错误假设**（实测反证见上方引文）——SA3 按 (B) 意图修正白名单构成（路线不变、成员修正），本修订追认并使设计文本/实现/ADR 三方逐字一致（**ADR 0010 round-2 小节 L273 残留的已作废前提括注经 SA2 R2.2 复审 M-1 就地修正**——修正前该处「仅有两种本地形态」原句与同句 writeAny 分句自相矛盾）。

### §5.2 规范化规则表（冻结 + 锁定测试）

| 值形态 | 规范化 | 比较 | 锚 |
|---|---|---|---|
| string / boolean | 恒等 | 直比 | 既有（SCHEMA 四键不变路径） |
| number | 恒等 | **SameValue**（`Object.is`：NaN 与自身相等、-0 ≠ 0） | round-1 语义延续 |
| null | 恒等 | 双侧 null | 既有 |
| **Y.Map / Y.Array**（显式构造容器，含嵌套） | `toJSON()` 递归投影 → plain 结构 | deepEqualPlain | red #10/#11 + SA3 新锚 |
| **plain array / plain object（proto∈{Object.prototype,null}）——yjs 原样存储域【R2.2 / 偏离 1】** | 直递（已是投影形态；同时构成 toJSON 投影的输出域） | **数组有序递归 / object 键序无关**（键集 sort 后比对）+ 递归 | red #10/#11（`meta.set('labels', ['a','b'])` 等种子即此形态——ROOT-only 放行）+ SA3 新锚 |
| **Y.Text / Y.XmlText / Y.XmlElement / Y.XmlFragment 等契约外容器**（instanceof `Y.AbstractType` 但非白名单） | **不参与投影比较**（直接落入保守拒） | **保守「已改变」——即使同型等内容未变亦拒**（round-1 姿势对契约外形态连续；合法写路径结构性不可达，仅种子/直构面） | SA3 新锚（R2.1 / SA2 #2） |
| **Date / Map / Set 等非 plain 实例**（proto 不在白名单） | — | 保守「已改变」（plain 原型门排除——R2.2 白名单构成的一部分） | SA3 新锚（R2.2） |
| 跨形态分叉（白名单容器 vs primitive / vs 契约外容器 / 异型 vs 异型） | — | 拒（单侧白名单即拒） | SA3 新锚（R2.1 / SA2 #2——含 Y.Text("abc") vs plain "abc" 对照） |
| 白名单容器**内嵌套**的契约外子值（如 Y.Map 值槽内的 Y.Text） | 随宿主 `toJSON()` 投影参与比较（投影已摊平——Y.Text → string；plain 容器内不可达——plain 存储域不含 AbstractType） | **投影相等即放行**（表征归一化边界——与「删后同值重写」同族：任何投影变化仍拒；预投影类型巡检的更深收紧不采纳——成本/复杂度不对等于种子面角落） | 边界注记（§14 D-3 登记） |
| undefined / bigint / symbol / function | — | 保守「已改变」（契约外——L31 值域外形态不得经 raw 判等放行） | SA3 新锚 |

- **键集先行**：容器级比较先比键集（存在性），再逐键值比较（round-1 `protectedMapEqual` 结构保留，仅替换值判等函数为 `protectedValueEqual`）——red #12（META 新键，值为对象 → 键集不等）保持拒绝零写入。
- **【R2.1 / SA2 #2 + R2.2 / 偏离 1】容器域两级裁决（与 §5.1 代码逐字一致）**：顶层（META/SCHEMA 键的直接值）走白名单门——plain array/object（yjs 原样存储的合法值形态）∪ Y.Map/Y.Array（显式构造容器）参与投影深比较，其余一切 AbstractType（Y.Text 等）与非 plain 实例保守拒（虽内容未变亦拒）；嵌套（白名单容器内部）走投影摊平——契约外子值投影相等即放行（上表归一化边界行）。§5.1 代码的 `isWhitelistedValueContainer`/`projectOf` 即此两级裁决的实现，四处（代码/本表/§14 D-3/ADR L273）由 R2.1+R2.2 两轮修订对齐——前版「Y.Text 投影类型分叉 → 拒」表述矛盾（R2.1 消除）与「仅物化为 Y.Map/Y.Array」前提错误（R2.2 消除）均已修正。
- **META 值域零收窄**（D-3 红线）：本设计不触碰 ADR 0008 L31「值只允许 JSON-compatible plain value」的整体值域；深比较只在**受保护字段投影比对域**内执行完整。SCHEMA 恒四 string 键——行为不变。
- **同值重写边界**（L252「删后同值重写 = 内容未变 = 允许」）：结构值下同样成立（投影相等即允许）——不变。

### §5.3 测试归属

SA6 红套件转绿：runtime red #10（hub 侧 object/array + ROOT-only 放行）/ #11（peer 侧同款）；绿锁定保持：red #12（真改仍拒）。SA3 包内补充：deepEqualPlain 规则矩阵（键序无关 / 数组有序 / NaN / -0 / 契约外形态 / 嵌套容器）+ **R2.1 / SA2 #2 新锚**：种子 `meta.set('note', new Y.Text('abc'))`（trusted-domain 种子面）+ ROOT-only update → `REPLICATION_PROTECTED_FIELDS_CHANGED` 拒（锁 (B) 保守白名单）；对照：live `Y.Text('abc')` vs update 改写为 plain `'abc'` → 拒（跨形态分叉——两路线一致）；对照：白名单容器内嵌套契约外子值投影相等 → 放行（归一化边界）。

---

## §6. R2-5 — lease doRelease hostile seam：幂等直调 + guaranteed cleanup 隔离

### §6.1 机制（lease.ts doRelease 同步段重写）

评审阻断 5 的修法 = 删除 `getStatus()` 前置查询、直调幂等 `close()`、把 session seam 隔离进 guaranteed cleanup 路径：

```ts
const doRelease = (): Promise<void> => {
  if (releasePromise === undefined) {
    released = true;                       // ① 同步标记（先于一切 seam 调用——L42）
    entry.leases.delete(controller);       // ② 释放事实（Registry idle cleanup 的武装前提）
    releasePromise = Promise.resolve();    // ③ same-Promise 载体（重复 release exact same 实例）
    dispatchObserver(observer, { type: 'lease-released', ... });
    // ④ issue #134 round-2（R2-5）：幂等直调 session.close()——不先查状态（getStatus seam
    //    异常不得跳过 close / 不得同步抛出）；close 的同步/异步异常全部隔离（guaranteed
    //    cleanup 路径——onReleased 无条件执行，半释放结构性不可达）。
    if (activeSession !== undefined) {
      try {
        // 【R2.1 / SA2 #5 加固】Promise.resolve(closing) 同化：敌意返回值（undefined / 原始值 /
        // thenable / 假 catch 方法返回 rejecting promise 的对象）一律经原生 promise 吸收——
        // .catch 为原生方法，兜底分支结构性零 unhandled rejection（前版 closing.catch 直接
        // 调用敌意 catch 方法的尾巴已闭合）。
        const closing = activeSession.close() as unknown;
        void Promise.resolve(closing).catch(() => {});
      } catch {
        /* session seam 同步 throw 隔离——不阻断 ⑤ */
      }
    }
    onReleased?.();                        // ⑤ guaranteed cleanup（idle 武装）——无条件到达
  }
  return releasePromise;
};
```

- **不先查状态**：终态 session（closed/conflicted）同样直调 `close()`（幂等 same-promise / 恒绿 barrier——L246「永不 reject」使直调零风险）；red #6 锚（终态仍收到 close 调用）转绿。
- **release 永不同步抛**：`released` 标记、entry 删除、releasePromise 缓存均无 seam 依赖（①②③ 在 ④ 之前完成）；④ 的两类敌意（getStatus 不再被调用；close 同步 throw / 异步 reject）全部隔离 ⇒ red #4/#5 转绿。
- **half-release 结构性不可达**：④ 失败不跳过 ⑤；idle 武装（onReleased → handleLeaseReleased）与释放事实（①②）不依赖 session seam。
- **顺序冻结**：`dispatchObserver` → session close（隔离）→ `onReleased`——与 round-1 相同（observer 事件先行的既有序）。
- 真实 core 的 `close()` 恒不 reject（INV-S11）——`Promise.resolve(...).catch` 兜底只对敌意替身生效，对真实路径零成本。**【R2.1 / SA2 #5】类型面边界声明**：公共类型面 `close(): Promise<void>` 下敌意 catch 尾巴本不可达（真 rejecting Promise 被 catch 回调吞没）；加固面向的是超类型面病态替身（SA6 hostile 注入域）。SA3 可选锚（§15.2）：hostile core `close: () => ({ catch: () => Promise.reject(...) })` → release 后进程级 unhandledRejection 计数为 0（沿 T-4 watchdog 模式）。

### §6.2 注入面（F-5）

hostile core 经 `createLeaseController` deps 注入（SA6 已按此锚定；registry.ts 生产路径直传真函数不受影响）。lease.ts 的 deps 签名零改动——本项修复是**纯顺序/防御重写**，无类型面变化。

### §6.3 测试归属

SA6 红套件转绿：registry red #4（getStatus 抛错）/ #5（close 抛错）/ #6（终态仍直调）。SA3 无需新增（hostile seam 已由 SA6 全锚）。

---

## §7. R2-6 — applyUpdate 异常 committed 精确二分（beforeTransaction 探针）

### §7.1 机制（replication-session.ts R5 重写）

评审项 6 的修法 = R5 内以 `beforeTransaction` 探针实现 F-4 二分：

```ts
// ── R5 一次 Y.applyUpdate(doc, bytes, 受控 origin token) + 事务边界探针（R2-6）──
let txStarted = false;
const txProbe = (): void => { txStarted = true; };
host.doc.on('beforeTransaction', txProbe);       // 注册于本槽内——晚于一切先注册 listener（敌意
try {                                             //  listener 先抛 ⇒ 探针不运行 ⇒ txStarted=false）
  Y.applyUpdate(host.doc, bytes, ctx.applyOrigin);
} catch (err) {
  // 精确二分（F-4）：txStarted=false ⟺ beforeTransaction emit 未完成 ⟺ 事务函数从未执行
  // ⟺ 零 mutation ⇒ committed:false；txStarted=true ⟹ 事务已开始、mutation 程度不可判
  // ⇒ 保守 committed:true（ADR 0008 L84「未知异常保守视为可能已提交」——过报方向强制）。
  // rejectWithWriteFatal 负责 markWriteFatal + committed:true 时 best-effort notifyDirty。
  return rejectWithWriteFatal(host, txStarted, 'unknown-pipeline-throw', err, 'replication-apply');
} finally {
  host.doc.off('beforeTransaction', txProbe);     // 槽级一次性——零泄漏到后续事务
}
```

- **判据健全性**：`txStarted === false` ⟹ 探针未运行 ⟹（探针注册于槽内、晚于一切先注册 listener）要么 `Y.applyUpdate` 在到达事务前抛出，要么某个**更早注册**的 beforeTransaction listener 抛出使 emit 未完成——两种情形事务函数（`readUpdate` 解码 + mutation）均未执行 ⟹ 零 mutation。`txStarted === true` ⟹ 事务已开始（emit 完成、creator 已进入或已执行）⟹ Yjs 无 rollback、mutation 程度不可判 ⟹ 保守 true。探针自身零副作用、零抛出点。
- **listener 次序依据**：Yjs `doc.on` 按注册次序同步派发；槽内注册使探针恒为「最后注册者」——敌意 beforeTransaction（测试先注册）先抛时探针不运行。SA6 #13 实测锚定该次序（Yjs 13.6.32）。
- **例外注记（D-4 登记；R2.1 / SA2 #6 补方向性）**：解码期异常发生在 creator 内（beforeTransaction 之后）⇒ `txStarted=true` 保守 true（且 R4 scratch 预演通常已先行拦为 `REPLICATION_RAW_UPDATE_INVALID`）；notifyDirty 失败维持 `committed:true`（既有锁定）；复合敌意（beforeTransaction 内先变异后抛错的多个 listener）属 ADR 0007 L54 observer 契约破坏域——二分不为其承诺（登记为判据的精确性条件）。**该除外情形的失败方向为 under-report（`committed:false` 而可能已变异）**——比过报危险的方向（调用方可能据此跳过 reconciliation）；ADR 0008 L84 纪律只强制过报方向，本二分对钩子域内单点注入维持精确、对契约破坏域的残余风险以此明文方向性登记收口（不构成对契约破坏域的行为承诺）。
- **fanout 交互**：fanout 的 `'update'` 监听与探针互不干扰（不同事件名）；`afterTransaction` 敌意（SA6 #14，mutation 已发生）⇒ 探针已运行 ⇒ `committed:true` + ROOT 变更保留——绿锁定保持。
- **fatal 码/词不变**：`NSRT-FATAL-REPLICATION-APPLY-INTERNAL` + slot `'replication-apply'` + phase `'unknown-pipeline-throw'`——只精化 `committed` 布尔（`RuntimeWriteFatalError.committed` 的诚实域），零新词汇。

### §7.2 测试归属

SA6 红套件转绿：runtime red #13（beforeTransaction 抛错 → committed:false + 零变更 + fatal 保守）；绿锁定保持：red #14（afterTransaction → committed:true）。SA3 包内补充：探针卸载（后续事务不重复计数）、`txStarted` 两分支的 fatal message 渲染。

---

## §8. R2-7 — 「成功接纳即置位」明文规范（登记项，零代码改动）

SA8 放行方向 = 路径一；当前实现（R5.5 无条件置位）已满足——红锚 #15/#16 为绿锁定。本项产出 = **明文规范**（评审项 7 自带 ADR 文字要求）：

> **成功接纳即置位**：no-op / 重复 / 空效果 update 的成功 apply（`Y.applyUpdate` 正常返回 + R6 dirty 登记完成）同样置 `rootValidation = 'replication-unvalidated'` 与 `memoryCaughtUp = true`——无「且推进文档状态」限定。依据：修订节 L241「raw apply 成功后置位」「首次 apply 成功置 true」字面；ADR 0010 L107「该 update 仍被**接受**……标记」；CONTEXT「复制未校验」词条「已**提交**并登记 dirty」；ADR 0006 #79 L192「degraded 不构成 saveDoc 拒绝理由」互证（no-op 照常登记 dirty ⇒ 词条字面即满足）。「实际推进才置位」路径需改写 L241 冻结词并引入 transaction-empty/state-vector 比对新误差面——不采纳。

落点：ADR 0010 修订节 round-2 增补（§14 D-4）+ runtime README（§12）。

---

## §9. R2-8 — plugin config 贯通 role（提前履行切片 9 义务）

SA8 双路放行；本设计选**贯通路**（评审建议方向；收窄路需要诚实登记延后——贯通后无需收窄声明）。

### §9.1 变更清单（四件）

1. **plugin.ts**：`NamespaceRegistryPluginConfig` 追加 `readonly role?: InstanceRole`；校验序冻结（工厂调用期同步 loud）：① 对象形状（非 object/null/array → `NAMESPACE_REGISTRY_PLUGIN_CONFIG` TypeError）→ ② 键集 ⊆ `{idleTimeoutMs, role}`（多余键 → `NAMESPACE_REGISTRY_PLUGIN_CONFIG`）→ ③ **role 值域**（非 `undefined|'hub'|'peer'` → TypeError `NAMESPACE_REGISTRY_ROLE_INVALID`——复用 types.ts 既有 const，O-4 既有词汇域）→ ④ `idleTimeoutMs` 经 `resolveIdleTimeoutMs` 单点（既有 TYPE/RANGE 二分不变）。`apply` 内 `createNamespaceRegistry(..., { ..., role })` 透传。
2. **registry.ts**：`createNamespaceRegistry` 生产工厂**补转发 `role`**（当前缺口：`CreateNamespaceRegistryOptions.role`（types.ts:554）已声明但工厂未透传给 `createRegistryInternal`——L1333-1339 的展开缺 role 键。这是评审「生产 composition 无法构造 peer Registry」的根因之二，与 plugin config 缺口叠加）。
3. **types.ts**：`NAMESPACE_REGISTRY_PLUGIN_CONFIG_MESSAGE` 文案更新（「仅接受 idleTimeoutMs 键」→「仅接受 idleTimeoutMs 与 role 键」——诚实文档；registry-plugin.test.ts:240 的文案断言同步一行，§15.2）。
4. **README**：registry README「Plugin configuration」节更新为 `{ idleTimeoutMs?, role? }`（§12）。

### §9.2 锚相容性

- red #7（config 接受 hub/peer/组合/缺省）：键集过 + role 过 + idleTimeoutMs 过 ⇒ 不抛 ✓。
- red #8（非法 role → `NAMESPACE_REGISTRY_ROLE_INVALID`）：`{role:'solo'|'HUB'|42|null}` 键集过 → ③ 拒 ✓（非键集误报）。
- red #9（peer 装配 + 角色权限 + hub 对照）：plugin apply → createNamespaceRegistry(role:'peer') → createRegistryInternal(role) → issueLease deps.role → Lease 接纳段 `REPLICATION_ROLE_PERMISSION`（既有机制零改动）✓；缺省路径零回归（不传 role ⇒ 'hub' ⇒ 基线全权限等价面）。
- registry-plugin.test.ts 既有键集锚（`{foo:1}` → PLUGIN_CONFIG）：键集仍先拒 ✓（仅文案字符串更新）。

### §9.3 测试归属

SA6 红套件转绿：registry red #7/#8/#9。SA3 同步：registry-plugin.test.ts 文案一行（§15.2）。

---

## §10. R2-9 — 竞态矩阵七场景覆盖结论（F-6）

| 场景 | 覆盖 | 结论 |
|---|---|---|
| accepted apply → Lease release | round-2 registry red #10（绿锁定：不取消、FIFO `[apply, close]`、release 同步失效、后 apply `NAMESPACE_LEASE_RELEASED`） | 已锚 |
| session close | round-1 AC-2/AC-7（幂等 close + T-4 barrier/in-flight）+ round-2 #10 联动 | 已锚 |
| Runtime close（× in-flight apply） | round-2 registry red #11（FIFO 序绿 + 终态红 → §3 转绿） | 本轮补齐 |
| 真实 idle expiry | round-1 AC-7 用例 18（fake-timer `advanceBy`） | 已锚 |
| Registry shutdown | round-1 AC-7 用例 16 + round-2 #11 联动（shutdown → Runtime close → terminateAll） | 已锚 |
| epoch bump（× in-flight apply + bump 边界主动 fence） | round-2 runtime red #1/#2/#3 + registry red #1/#2/#3/#12 | 本轮补齐 |
| committed fatal | round-1 AC-7 用例 19（notify 失败 committed:true）+ round-2 red #13/#14（二分） | 已锚 + 本轮精化 |

设计确认：七场景全部有确定性合同测试；确定性来源 = 唯一 sequencer FIFO + 同步段终态标记（fence/terminate/release）——零真 sleep、零轮询（SA6 纪律满足）。

---

## §11. R2-10 — owned bytes 直存原始参数加严（登记项）

SA6 已完成（round-1 两文件 listener 直存 + 数组/buffer 独立断言，52 用例全绿；round-2 red #17 绿锁定）。设计登记：**异步投递下 owned-bytes 的字节面语义不变**——队列项 = channel 级复制（observer 内 `update.slice()`，隔离 yjs 复用），交付 = 每 listener 每投递 `item.slice()`（独立底 buffer、byteOffset=0、全幅）——§4.2 要点 4。INV-S4 的字节面原文继续成立；**交付集（哪些 listener 在何时收到哪些项）为异步化引入的行为契约增量，按 at-least-once 语义明文冻结于 §4.2 要点 8（R2.1 / SA2 #1）——不属「不变」声称范围**。

---

## §12. R2-11 — 两包 README 更新内容大纲

### `packages/namespace-runtime/README.md`（新增「ReplicationSession（内部宿主）」节 + Lifecycle 节增补）

1. **宿主与能力面**：Runtime 构造期创建 fanout + replication host（模块级 WeakMap 登记，公共对象面零污染）；session 经 `@nomicore/namespace-registry` 的 `lease.openReplicationSession` 取得（本包不直接暴露）；六能力 + open/apply 拒绝码闭集（ADR 0010 修订节注册表指针）。
2. **trusted raw 例外（L79/L94 明示义务）**：raw replication 绕过 VFSL 业务校验——Host 搭建方只把 Lease 交给可信代码；raw apply 无 zero-write 保证（拒绝路径除外）。
3. **degraded hub→peer apply**：peer `persistence-degraded` 期已冻结 hub-to-peer session 的 bypass 五条件合取（内存生效 + saveDoc 照常 + durability 区分内存/磁盘，永不声称 durable）；hub degraded 拒 peer→hub。
4. **受保护字段**：hub 侧 SCHEMA+META 全键 / peer 侧 META 全键（冻结常量）；判据 = 内容投影相等（结构值规范化深比较——R2-4 规则表）；畸形字节 scratch 预演拒绝。
5. **fanout 投递模型（R2-3）**：observer 内只复制 owned bytes；有界异步队列（每 session 16 项）投递；溢出 → `status.needsResync`（sticky、继续投递）；listener 慢/重入/不返回零阻塞 sequencer；`observerFailures` 自捕获计数不熔断；**交付集 = 交付时刻 listener 快照（at-least-once——晚订阅者可收订阅前入队项、跨退订重订可重复交付；重复由 Yjs apply 幂等吸收）**。
6. **epoch fence（R2-1）**：bump 槽同步投影步主动 fence（conflicted 终态 + 摘除 + 排队项取消）；apply 槽身份/epoch gate 被动 fence；终态后同 Lease 可再 open（新 epoch）。
7. **生命周期边界（R2-2）**：Runtime `close()` 同步段终止全部现存 sessions（终态 `closed`；其后 apply → `RUNTIME_WRITE_DISABLED`）；已接纳 apply 槽无条件排空（barrier 队尾）；Lease release 同步 close session。每 Lease 至多一个活跃 session。
8. **committed 诚实（R2-6/R2-7）**：apply 异常按事务边界二分（before-transaction 零 mutation → false；否则保守 true）；成功接纳即置位（no-op 同样置 `replication-unvalidated`/`memoryCaughtUp`）。

### `packages/namespace-registry/README.md`（Public API 增补 + Plugin configuration 更新）

1. **ReplicationSession 登记句**：`openReplicationSession` 高级受信付认入口（trusted raw 例外指针、拒绝码闭集、每 Lease 一活跃 session、终态后可再 open）。
2. **Plugin configuration**：`createNamespaceRegistryPlugin({ idleTimeoutMs?, role? })`——`role: 'hub'|'peer'`（缺省 `'hub'`；非法值 `NAMESPACE_REGISTRY_ROLE_INVALID`；生产 composition root 必须显式传——切片 9 义务提前）。
3. **peer 权限边界**：peer 实例的 `replaceSchema`/`enableReplication`/`bumpReplicationEpoch` 以 `REPLICATION_ROLE_PERMISSION` 稳定拒绝；ROOT 业务写不受限。
4. **生命周期边界**：Lease release 同步 close 既有 session（hostile seam 隔离——release 永不因 session 异常半释放）；Registry shutdown → Runtime close → sessions 终态 `closed`。
5. **status 词汇**：`state/direction/冻结四域/currentEpoch/rootValidation/durability/observerFailures/needsResync`（ADR 0010 修订节指针）。

---

## §13. R2-12 — PEER_ALLOWED_META_KEYS 删除 + seam 类型收敛方案

### §13.1 空占位删除

`replication-session.ts` 的 `const PEER_ALLOWED_META_KEYS: readonly string[] = Object.freeze([])` **删除**（SA8 裁决：空集是**语义冻结**（修订节 L253「peer 允许的 META 白名单首版 = 空集 ⟺ META 全键保护」），ADR 文字即真相源，非代码常量义务；运行时零差分、零引用）。`RAW_PROTECTED_FIELDS` 冻结常量保留不动（L121 受保护集合仍为代码常量）。grep 复核：该常量在 src/test 全域零引用（SA6 报告 + 本设计期复核）——删除零涟漪。

### §13.2 seam 类型手工重复收敛（ Equal 锁格架——不删锁、不加副本）

现状三处声明（有意冗余，声明图纪律使然）：runtime `replication-session.ts`（core 面）→ registry `types.ts`（公共面，主入口可达声明图不得引用 runtime 命名类型）→ registry `lease.ts`（结构描述面，不经 internal subpath 的自锁载体）。**收敛方案 = 把「手工三写」降为「编译器驱两点同步 + 转置锁」**：

1. **真锁**（registry.ts，internal subpath 唯一消费者）：`Equal<RuntimeReplicationSessionCore, ReplicationSession>` + `Equal<RuntimeReplicationSessionStatus, ReplicationSessionStatus>`——跨包逐字段锁（既有，保留）。
2. **自锁**（lease.ts）：`Equal<ReplicationSessionOpenCore, ReplicationSession>`（既有，保留；**不得删除**——brief 的 lease.ts Equal 断言锁纪律）。
3. **注入口即锁**：`deps.openReplicationSessionCore` 的赋值（registry.ts 直传真函数）提供函数签名级编译检查（apply 结果联合经 core 接口成员转置锁住）。
4. **演进纪律**：任何 status/能力面字段变更（如本轮 `needsResync`）只需改**恰好两个 src 声明点**（runtime core + registry types），三把锁全部编译期红直到镜像完成——shotgun surgery 面收敛为「两点 + 编译器强制」。本轮 needsResync 的加入即该格架的即时演示（§15.3 同步清单）。
5. **不改**：internal.ts 导出面（两键不变）、两侧 package.json exports、INSTANCE_ID_PATTERN 双副本（跨包值导出不可达的结构守卫先例——注释互引已是收敛态）。

---

## §14. ADR / 文档同步清单（登记义务 D-1..D-4 的落地条目）

| 文档 | 增补内容 | 登记义务 |
|---|---|---|
| `docs/adr/0010-hub-peer-websocket-ydoc-replication.md` 修订节（append-only 追加「issue #134 round 2 修订」小节，~30–40 行） | **(D-1)** fanout 投递异步化：owned bytes 复制（observer 内同步=六步之 4「产出」）+ 每 session 有界队列（容量 16 冻结常量）+ 自延伸微任务泵（让步 20）+ 溢出弃新置 `needsResync`（sticky、继续投递、status 第 11 字段）；**撤销 round-1「本切片无队列 ⇒ L113 不可达」读法**；L241「熔断/背压属切片 6 队列属主」收窄为「WS 发送队列/连接级背压（正文 L151 域）」；observerFailures「无界纯计数、不熔断不自动退订」不变；两级副本（入队 + 交付）性能注记；**【R2.1 / SA2 #1】交付集语义冻结句**：「投递交付集 = 交付时刻 listener 快照（at-least-once）——晚订阅者可收到订阅前入队项；跨退订重订可重复交付；重复交付由 Yjs `Y.applyUpdate` 幂等吸收（CRDT 重复应用零效果）」。**(D-2a)** L245/L247 增补 bump 槽 E5.5 主动 fence 触发面：conflicted 终态 + fanout.detach 摘除 + **未投递排队项取消**（bump 写零投递给旧 session——F-3 词义）；与 apply 槽 R2 共用 finalize（零新增终态语义）。**(D-2b)** L246/L247 增补 Runtime close 触发面：close 同步段（lifecycle 翻转后、barrier 前）terminateAll → 终态 `closed` + 排队项取消；已接纳 apply 槽无条件排空（ADR 0008 L93/L179 锚）；其后 apply 拒绝映射 `RUNTIME_WRITE_DISABLED`（#93 第 (4) 类域）；`encodeStateVector`/`encodeDiff` 确定_throw_（终态纪律统一）。**(D-3)** L251 增补判据细化（**R2.2 口径；ADR 0010 round-2 小节 L273 残留的已作废前提括注经 M-1 就地修正后与本条逐字对齐**）：结构值规范化深比较（§5.2 规则表全文——键序无关/数组有序/SameValue/**容器白名单 = Y.Map/Y.Array（显式构造容器，`toJSON()` 递归投影）∪ plain array/plain object（yjs 13.6.32 经 lib0 `writeAny` 原样存储的合法值本地形态；原型必须为 Object.prototype/null，排除 Date/Map/Set 等非 plain 实例）**/契约外容器（Y.Text 等一切非白名单 `instanceof Y.AbstractType`）保守拒——虽同型等内容未变亦拒/**白名单容器内嵌套契约外子值投影相等放行的归一化边界**/跨形态分叉拒）；META 值域零收窄注记；**【R2.1 / SA2 #8】深比较性能注记**：每 apply 每受保护 META 键投影 ×2（live + scratch；Y.Map/Y.Array 容器 `toJSON()`、plain 直递）+ 键集 sort——O(META 体量)/次（scratch 全量 clone 为既有成本，深比较为新增；与 fanout 两级副本注记同款登记）。**(D-4)** L237 增补 committed 精确二分（beforeTransaction 探针；精确性条件 = yjs 事务钩子域注入；复合敌意除外注记**——除外情形失败方向为 under-report（`committed:false` 而可能已变异）**）；L241 增补「成功接纳即置位」明文（§8 引文） | D-1/D-2a/D-2b/D-3/D-4 |
| `docs/phases/phase-5-websocket-replication.md` | 切片 3 落地对账注记（C-1，L81 附近）**改写**：「本切片无队列 ⇒ ADR 0010 L113 唯一触发面结构性不可达；needs-resync 与队列属主 = 切片 6」→「**needs-resync 于本切片（issue #134 round 2）落地**：fanout 投递队列为切片 3 属主（每 session 有界 16 项、溢出标记）；WS 发送队列/连接级背压仍属切片 6（ADR 0010 L151 域）」；切片 3/4 锚定节追加 R2 冻结词汇（needsResync / fence 触发面 / Runtime close 终态） | D-1 |
| `packages/namespace-runtime/README.md` / `packages/namespace-registry/README.md` | §12 大纲落地 | R2-11 |
| `CONTEXT.md` | `ReplicationSession` 词条追加一句：「fanout 投递有界队列溢出将 session 标记 `needs-resync`（sticky）——transport 须 reset/bootstrap」（~2 行；轻量收口） | D-1 |

不改动：ADR 0006/0007/0008/0009（T-1 和解按 lex posterior 在 ADR 0010 修订节陈述的既定路径不变）。

---

## §15. 测试矩阵与同步清单

### §15.1 SA6 round-2 红灯 → 设计落位（29 用例全量）

| SA6 锚 | R2 | 设计落位 | 转绿路径 |
|---|---|---|---|
| runtime #1 bump 后零投递 | R2-1 | §2 | E5.5 fence：detach + 排队项取消 |
| runtime #2 conflicted 可观测 | R2-1 | §2 | finalize 置终态；currentEpoch 已整替 |
| runtime #3 FIFO（绿锁定） | R2-1 | §2.2 | 不变（R2 槽内幂等 finalize） |
| runtime #4 close 后终态 | R2-2 | §3 | terminateAll → `closed` |
| runtime #5 close 后零投递 | R2-2 | §3 | detach + 队列取消（observer 空集） |
| runtime #6 排空 FIFO（绿锁定） | R2-2 | §3.1 | barrier 队尾（零新增机制） |
| runtime #7 慢 listener 不阻塞写槽 | R2-3 | §4.3(a) | 泵让步 20 > 写结算链 ~6-8 跳 |
| runtime #8 不阻塞 apply 槽/后续槽 | R2-3 | §4.3(b) | 自延伸链公平性（单挂起续体） |
| runtime #9 溢出可观测 + 突发零阻塞 | R2-3 | §4.3(d) | 容量 16 + needsResync sticky |
| runtime #10 hub 侧结构值放行 | R2-4 | §5 | protectedValueEqual + toJSON 投影 |
| runtime #11 peer 侧同款 | R2-4 | §5 | 同上（role 分叉仅在 SCHEMA） |
| runtime #12 真改仍拒（绿锁定） | R2-4 | §5.2 | 键集先行（不变） |
| runtime #13 beforeTransaction → false | R2-6 | §7 | 探针未运行 ⇒ committed:false |
| runtime #14 afterTransaction → true（绿锁定） | R2-6 | §7 | 探针已运行 ⇒ 保守 true |
| runtime #15/#16 置位（绿锁定） | R2-7 | §8 | 现行为即规范（零改动） |
| runtime #17 直存原始参数（绿锁定） | R2-10 | §11 | 两级副本保持 INV-S4 |
| registry #1/#2 bump fence（Lease 面） | R2-1 | §2 | 同 runtime（经真实链路） |
| registry #3 再 open 新 epoch | R2-1 | §2.2 | 终态释放槽位（Lease ④ 零改动） |
| registry #4 getStatus 抛错 | R2-5 | §6 | 不先查状态 + 直调 close |
| registry #5 close 抛错 | R2-5 | §6 | try/catch 隔离 + onReleased 无条件 |
| registry #6 终态仍直调 | R2-5 | §6 | 无 state 前置条件 |
| registry #7 config 接受 role | R2-8 | §9 | 键集 + role 域校验 |
| registry #8 非法 role 域 | R2-8 | §9 | 校验序 ③ ROLE_INVALID |
| registry #9 peer 装配 + 权限 | R2-8 | §9 | plugin → factory 转发 → deps.role |
| registry #10 release × in-flight（绿锁定） | R2-9 | §10 | 不变 |
| registry #11 shutdown × in-flight | R2-9 | §3 | runtime.close() → terminateAll |
| registry #12 bump × in-flight | R2-9 | §2 | E5.5 fence |

### §15.2 SA3 owned 测试演进与新锚（`runtime-replication-session.test.ts` 演进 + 新建 round-2 文件）

| 项 | 文件 | 内容 |
|---|---|---|
| T-1 形状锁演进 | `runtime-replication-session.test.ts` | `PublicStatusShape` 追加 `needsResync: boolean`（编译期锁随类型同步） |
| T-3 锚值演进 | `runtime-replication-session.test.ts` L344 | `expect(afterBump).toBe(1)` → `toBe(0)` + 注释改写（F-3：fence 取消未投递排队项——bump 写零投递） |
| 文案同步 | `registry-plugin.test.ts` L240 | PLUGIN_CONFIG message 断言字符串同步（types.ts 文案更新后） |
| 新建包内单锚 | `runtime-replication-session-round2.test.ts`（[SA3 owned]，**实际 ~740 行——R2.2 认可偏离 2**：R2.1 必修锚（交付集 ×2 + Y.Text 三锚 + 双 channel 正反）合计 ~250 行 + 每锚独立 seed/断言纪律（零共享可变 fixture），22 用例全部落位、行为面不缩水） | 泵与队列：容量 16 边界（16 入 17 弃）/ 弃新保序 / sticky / 标记后继续投递 / 两级副本独立性 / 零订阅者消费 / unsubscribe 交互 / **交付集语义 ×2【R2.1 / SA2 #1 必修】：(i) 慢消费者积压未排空时 `subscribeOwnedUpdates(B)` → flush 后 B 收到 ≥1 项订阅前入队 update；(ii) 订阅→退订→立即重订（积压窗口）→ 断言重订后可重复收到未投递项 + `Y.applyUpdate` 幂等吸收（replay 副本状态不变）** / **泵兜底【R2.1 / SA2 #7 可选】：isTerminal 抛错替身（包内 seam 直构）→ observerFailures 递增而非 unhandled rejection**；fence：fenceStale 谓词（身份/epoch/幂等）/ 排队项取消 / conflicted 不降级 / **双 channel 直构谓词正反锚【R2.1 / SA2 #4】：一命中一不命中 → 恰命中者终态化、无跳过无过栅**；terminateAll：closedBy 映射（apply → RUNTIME_WRITE_DISABLED 文案）/ 重复 close 同实例 / 终态 throw；R2-4：deepEqualPlain 规则矩阵（键序无关 / 数组有序 / NaN / -0 / 契约外 / 嵌套）+ **【R2.1 / SA2 #2 必修】种子 Y.Text + ROOT-only → PROTECTED_FIELDS_CHANGED 拒；Y.Text('abc') vs plain 'abc' 跨形态分叉拒对照；白名单容器嵌套契约外子值投影相等放行（归一化边界）** + **【R2.2 / 偏离 1】plain 原样存储域矩阵（plain array/object 直递深比较、Date/Map/Set 非 plain 实例拒）**；R2-6：探针卸载 / 两分支 message 渲染；**【R2.1 / SA2 #5 可选锚——R2.2 偏离 3 裁决：未在 runtime 落位】hostile catch → unhandledRejection 计数 0 的锚属 registry 侧 lease.ts 注入域，runtime 包测试依赖方向禁止 import registry（round-1 文件头注同款纪律）——承接 = SA7 动态验证可选直构（验证脚本内、不入仓）；加固正确性为语言级结构事实（`Promise.resolve` 原生同化），运行时锚非义务** |

### §15.3 需 SA6 同步改测试清单（SA6 §3 预留的「按冻结改写」——非断言改形）

1. `registry-phase5-replication-session-round2-red.test.ts` 的 `makeHostileStatus` fixture（及文件内其余全形 status 字面量）：追加 `needsResync: false`——类型面同步（`ReplicationSessionStatus` 增字段后的编译必需）。SA6 锚本体（#9 的 `status.needsResync` cast 断言、终态断言）零改动。
2. runtime 侧 round-2 文件：零同步（status 消费经 `as unknown as` cast，类型面已兼容）。
3. round-1 两文件（52 用例）：除 §15.2 的 SA3 owned T-3 锚值外，SA6 owned 的 `registry-phase5-replication-session-red.test.ts` **【R2.2 修订——发现 1】恰一行 fixture 时序演进**：AC-2 ③ 在步骤 ② 的 `mutateRoot(n→8)`（L729）之后、步骤 ③ 订阅（L738）之前加一行 `await flushMicrotasks()`——排空积压使晚订阅者不收订阅前项（§4.2 要点 8 at-least-once 语义下的确定性时序；**零断言语义变化**——`received.length===1` 断言本体不动）。R2/R2.1 版「零改动」结论作废（其相容性核对漏计了「写先于订阅」边界——§19 同源修正）。其余 51 用例零改动（无 bump 写投递锚、无 post-shutdown apply 码锚冲突——L1287-1289 经 §3.3 映射保持绿、fanout 锚均经 flushMicrotasks 预算内可见）。
4. **【R2.2 新增——发现 2 / 裁决 3(a)】spin fixture 收尾义务（测试隔离）**：round-2 红文件的慢 listener 自旋用例（runtime red #7/#8）测试末尾加 `sessionX.close()` 收尾（终止 channel + 清队 ⇒ 泵零跨测试泄漏；零断言改形——SA6 执行）。机理与义务全文见 §4.3(d) 注记；red #9 自身的 15ms fixture 同样适用本义务（虽量级小）。SA3 新文件已按同款纪律收尾（其 22 用例无跨测泄漏）。

### §15.4 全量回归预期

既有 138 文件 1689 用例（含 round-2 新绿锁定 8 例）+ 21 预期红转绿 ⇒ 140 文件 / 1710 用例全绿 + Type Errors 0；演进面恰三处（T-1 形状 / T-3 锚值 / plugin 文案——均有 §15.2/§15.3 登记）。

---

## §16. 版本号 bump 面（简报指定）

| 包 | 现版本 | bump | 理由 |
|---|---|---|---|
| `packages/namespace-runtime` | 0.1.9 | **0.1.10**（patch） | replication-session.ts / runtime.ts / replication-write.ts 代码变更（R2-1/R2-2/R2-3/R2-4/R2-6） |
| `packages/namespace-registry` | 0.1.5 | **0.1.6**（patch） | lease.ts / plugin.ts / registry.ts / types.ts 代码变更（R2-5/R2-8）+ status 类型增字段 |

（仅 `version` 字段；exports/依赖零改动——DENY LIST 纪律。）

---

## §17. 文件清单（File Scope）

### ALLOW LIST

- `packages/namespace-runtime/src/replication-session.ts` — 修改：channel 队列/needsResync/泵（§4）、fenceStale/terminateAll/finalize（§2/§3）、status `needsResync` 第 11 字段、protectedValueEqual/deepEqualPlain（§5）、R5 探针二分（§7）、PEER_ALLOWED_META_KEYS 删除（§13.1）（约 180–260 行净变更）。
- `packages/namespace-runtime/src/runtime.ts` — 修改：close() 同步段 `fanout.terminateAll('runtime-close')` + ReplicationWriteEnv 构造增 fanout 字段（≤ 20 行，公共面零变化）。
- `packages/namespace-runtime/src/replication-write.ts` — 修改：`ReplicationWriteEnv` 增 `fanout` 字段 + bump 槽 E5.5 `fenceStale` 调用（≤ 12 行）。
- `packages/namespace-registry/src/lease.ts` — 修改：doRelease 幂等直调 + hostile seam 隔离（§6；~14 行；deps 签名零改动）。
- `packages/namespace-registry/src/plugin.ts` — 修改：config `role` 键 + 校验序 + apply 透传（§9；~20 行）。
- `packages/namespace-registry/src/registry.ts` — 修改：`createNamespaceRegistry` 转发 `options.role`（§9.1-2；~2 行）。
- `packages/namespace-registry/src/types.ts` — 修改：`ReplicationSessionStatus.needsResync` 字段 + `NAMESPACE_REGISTRY_PLUGIN_CONFIG_MESSAGE` 文案更新（~6 行）。
- `packages/namespace-runtime/test/runtime-replication-session.test.ts` — 修改 [SA3 owned]：T-1 `PublicStatusShape` + 字段 / T-3 锚值 `1→0`（§15.2；~6 行）。
- `packages/namespace-runtime/test/runtime-replication-session-round2.test.ts` — **新建 [SA3 owned]**：§15.2 包内单锚（泵/队列/交付集/fence/terminate/规则矩阵/探针 + R2.1 新增锚：交付集 at-least-once ×2 / Y.Text 白名单三锚 / 双 channel 谓词正反；**实际 ~740 行——R2.2 认可偏离 2，见 §15.2**）。
- `packages/namespace-runtime/test/runtime-replication-session-round2-red.test.ts` — `[SA6 owned]` 已存在：红灯转绿目标；SA3 不得改断言（§15.3-2 零同步）。
- `packages/namespace-registry/test/registry-phase5-replication-session-round2-red.test.ts` — `[SA6 owned]` 已存在：转绿目标 + §15.3-1 fixture 类型面同步（`makeHostileStatus` 等 + `needsResync: false`——SA6 按冻结改写，非断言改形）。
- `packages/namespace-registry/test/registry-plugin.test.ts` — 修改：L240 文案断言同步（§15.2；~2 行）。
- `packages/namespace-registry/test/registry-phase5-replication-session-red.test.ts` — `[SA6 owned]`：**恰一行 fixture 时序演进**（§15.3-3 R2.2 修订：AC-2 ③ n→8 写后、订阅前 flushMicrotasks——零断言语义变化）。
- `docs/adr/0010-hub-peer-websocket-ydoc-replication.md` — 修改：修订节 round-2 增补（§14；~30–40 行）。
- `docs/phases/phase-5-websocket-replication.md` — 修改：C-1 注记改写 + 冻结词汇追加（§14；~8 行）。
- `packages/namespace-runtime/README.md` / `packages/namespace-registry/README.md` — 修改：§12 大纲（各 ~25–45 行）。
- `CONTEXT.md` — 修改：ReplicationSession 词条 needs-resync 一句（§14；~2 行）。
- `packages/namespace-runtime/package.json` / `packages/namespace-registry/package.json` — 修改：version bump（§16；各 1 行）。

### DENY LIST

- `packages/namespace-runtime/src/index.ts` — 值导出面冻结（恰一键）；零改动。
- `packages/namespace-runtime/src/internal.ts` — 值导出两键不变（R2-12 收敛不动导出面）。
- `packages/namespace-runtime/src/write.ts` / `close.ts` / `sequencer.ts` / `status.ts` / `p0.ts` / `errors.ts` / `projection.ts` / `read.ts` — 本轮零改动（R2-6 改在 replication-session.ts R5；barrier/FIFO 零新增机制；无新稳定码/文案需求）。
- `packages/namespace-registry/src/observer.ts` / `testing.ts` / `index.ts` / `errors.ts` / `identity.ts` / `create-document.ts` — 零改动（testing.ts role 已透传；observer 面不扩）。
- 两侧 `package.json` 的 `exports`/`dependencies` — 键集冻结（仅 version 在 ALLOW）。
- `packages/persistence/**` / `packages/doc-runtime/**` / `packages/vfsl/**` / `packages/replication-protocol/**` — 不动。
- `packages/namespace-registry/test/registry-phase5-replication-session-surface.test-d.ts` — `[SA6 owned]` 零改动（无 status 全形锁——已核对）。
- `apps/**` / `domains/**` — 无关。

## §18. 协议假设依据 (Protocol Assumption Evidence)

| 假设 | 依据类型 | 依据内容（具体引用） | 风险等级 |
|---|---|---|---|
| Yjs `transact` 的 beforeTransaction emit 先于事务函数执行；listener 按注册次序同步派发 | **设计期实测（SA6 独立）** + 库行为 | SA6 round-2 报告 §3.4：「Yjs 13.6.32 transact 的 beforeTransaction emit 位于事务函数之前——本套件 #13 注入证实零 mutation + 当前过报 committed:true」（红锚 #13/#14 即行为证据）；§7 判据的唯一次序依赖 | 低 |
| 微任务 FIFO + 自延伸 async 链的「单挂起续体」公平性；写槽结算链深度 ~5–8 跳 | 语言语义 + 设计期推演 + 既有测试锚 | ECMAScript PromiseJobs FIFO（sequencer.ts:35-37 头注同源）；跳数 = enqueue `.then`(1) + `await notifyDirty` 续体(1) + adoption(1–2) + 调用方 await(1–2)；SA6 flushMicrotasks 预算 40/60 为上界锚（§4.3(c) 首投递 ~26 跳） | 中（SA7 动态复核——red #7/#8/#9 的墙钟判别裕度 250/250/400ms vs 预期 ~0/~0/~290ms） |
| `Y.Map.prototype.toJSON()` 递归 plain 投影（map→object / array→array / 标量恒等） | 库公共 API + round-1 同源实测 | round-1 设计 §14「scratch clone 内容投影比较可行；同内容 ⇒ 投影相等」实测（判据 (a) 的既有基础）；yjs 公共文档化 API | 低 |
| **【R2.2 / 偏离 1】yjs 13.6.32 对 plain array/object 经 lib0 `writeAny` 原样存储（`instanceof Y.Array/Y.Map === false`；round-trip 后仍为 plain）** | **设计期实测（双源）** | SA3 实现期实测（SA3 报告 §4 偏离 1：`Array.isArray(meta.get('labels'))===true`、`instanceof Y.Array===false`）+ **SA1 R2.2 复测**（worktree `packages/namespace-runtime` 下 node 探针：labels `Array.isArray=true / instanceof Y.Array=false`、extra `proto=Object.prototype / instanceof Y.Map=false`、round-trip 同款、手工 `new Y.Map()` 显式容器可并存）；反证了 R2 首版「物化为 Y.Map/Y.Array」前提 | 低 |
| **【R2.2 / 发现 2】泵遗留自旋的跨测试泄漏量 = 前测未清队排队项的自旋总和（red #8→#9 实测恒 ~400ms）** | 设计期推演 + SA3 探针实测 | 微任务 FIFO（§4.2 要点 2 同源）+ SA3 实测（deliveries=12、totalSpin=180ms、泄漏 = 400ms 前测自旋）；隔离义务（spin fixture 末尾 close）冻结于 §4.3(d) 注记 + §15.3-4 | 低（测试隔离面，非生产面） |
| 泵首投递晚于写 Promise 结算、且早于 flushMicrotasks(40/60) 预算耗尽 | 设计期推演（§4.3 全表） | 让步 20 的下界 = 写结算链上界（~8 跳）+ 裕度 12；上界 = 预算 40 − 写链 6 − 裕度 14；两约束区间 [16, 24] 内取 20 | 低（结构跳数确定，非墙钟） |
| `update.slice()` 两级副本满足 R2-10 直存锚（byteOffset=0/全幅/底 buffer 不共享） | 语言语义 + 现行绿锚 | `TypedArray.prototype.slice` 独立缓冲（ECMAScript）；round-2 red #17 / round-1 两文件 R2-10 加严版当前绿（同步扇出下同款副本语义） | 低 |
| plugin config 校验序（键集 → role 域 → idleTimeoutMs）与既有锚相容 | 源码引用 | plugin.ts:149-158 现行序（对象形状→键集→resolveIdleTimeoutMs）；registry-plugin.test.ts:234-246 既有锚（`{foo:1}` 键集 / TYPE / RANGE 各自独立触发） | 低 |

（本设计无 HTTP/WS 端点/端口/跨进程类协议假设——R2-3 队列域与 ADR 0010 L151 WS 发送队列域分界，后者仍属切片 6。）

## §19. 契约改动连锁审计 (Contract Change Caller Audit)

**无公共函数签名/返回类型收窄或 throw 面新增**（全部为加法/内部精化/拒绝码映射收窄到既有码族）+ **一处公共能力面的可观测行为契约增量（R2.1 / SA2 #1 必修登记：`subscribeOwnedUpdates` 交付集语义漂移为 at-least-once——非签名变化，但属公共行为契约，必须在此显式列行）**。逐面：

| 改动面 | 文件 | 改动前 | 改动后 | Caller 清单与处置 |
|---|---|---|---|---|
| `applyRemoteUpdate` 终态拒绝码（Runtime-close 终止的 session） | replication-session.ts A1 | `REPLICATION_SESSION_CLOSED` | `RUNTIME_WRITE_DISABLED`（closedBy='runtime-close' 分支；§3.3） | **唯一 caller** = registry `lease.ts wrapCore.applyRemoteUpdate`（revoked 前置后直调）——码在六码联合内，类型零改动；runtime round-1 L719-736 与 registry round-1 L1287-1289 两锚**保持绿**（本改动的动机即锚相容） |
| **`subscribeOwnedUpdates` 交付集语义**（公共能力面行为契约增量——R2.1 / SA2 #1 必修登记） | replication-session.ts 泵（§4.2 要点 8） | round-1 同步扇出：交付集 = **事件时刻** listener 快照（晚订阅者结构性不收订阅前项；无跨退订重订重复） | 异步泵：交付集 = **交付时刻** listener 快照——**at-least-once**（晚订阅者可收订阅前入队项；跨退订重订可重复交付；`Y.applyUpdate` 幂等吸收） | caller = 一切 listener 消费者（round-1/round-2 测试 + 切片 6 transport）。既有锚相容性【R2.2 修正——发现 1】：round-2 与 round-1 runtime 侧 events 锚均为「订阅先于写」时序（快照漂移不可观测）；**唯一例外 = registry round-1 AC-2 ③（订阅晚于步骤 ② 的 n→8 写、先于其投递——泵 20 让步未达时订阅完成 ⇒ 交付快照含晚订阅者 ⇒ 收到积压项，`received.length` 实测 2 ≠ 断言 1）——R2.1 版「全部 events 断言均为订阅先于写」的相容性声称错误（SA3 实现期发现），作废**。该 2≠1 正是 §4.2 要点 8 明文承诺的 at-least-once 行为（SA3 新锚 (i) 同构锚定）——断言与实现均被冻结文本支持，**处置 = fixture 时序演进授权**：AC-2 ③ 在 n→8 写后、订阅前加一行 `await flushMicrotasks()` 排空积压（零断言语义变化——SA6 执行，§15.3）；增量冻结于 §4.2 要点 8 + §14 D-1 ADR 句；SA3 锚 ×2（§15.2——积压期订阅 / 退订重订幂等）；**签名/返回类型零变化** |
| `ReplicationSessionStatus` 形状 | replication-session.ts + registry types.ts（两侧镜像） | 10 字段 | +`needsResync: boolean`（加法） | 消费者 = getStatus 调用方（测试 / 未来 transport）——加法兼容；Equal 锁（registry.ts ×2 + lease.ts）编译期强制两声明点同步；SA3 T-1 形状锁 + SA6 hostile fixture 需同步（§15.2/§15.3，已登记） |
| `NamespaceRegistryPluginConfig` | plugin.ts | `{idleTimeoutMs?}` | +`role?: InstanceRole`（加法） | caller = 宿主 plugin 装配（red #9）与既有调用（缺省路径零回归——不传 role 键即旧行为）；`registry-plugin.test.ts` 文案一行同步 |
| `NAMESPACE_REGISTRY_PLUGIN_CONFIG_MESSAGE` 文案 | types.ts | 「仅接受 idleTimeoutMs 键」 | 「仅接受 idleTimeoutMs 与 role 键」 | 值断言 caller = `registry-plugin.test.ts:240`（唯一精确文案锚——grep 复核）——同步一行（§15.2） |
| `doRelease` 内部顺序 | lease.ts | getStatus 前置 → 条件 close | 无条件幂等直调 + 隔离（§6） | 签名/返回契约零改动（same-Promise、同步失效——L42）；caller = `lease.release` / `[ASYNC_DISPOSE]`（既有）；`onReleased` caller = registry `handleLeaseReleased`（执行保证增强：无条件到达） |
| `SessionFanout` 接口 | replication-session.ts | attach/detach | +`fenceStale` / +`terminateAll`（加法） | **唯一 caller** = `runtime.ts`（terminateAll）与 `replication-write.ts` bump E5.5（fenceStale，经 ReplicationWriteEnv）——两者均在 ALLOW；包内接口，无公共面 |
| `ReplicationWriteEnv` 形状 | replication-write.ts | 5 字段 | +`fanout`（加法） | **唯一构造点** = `runtime.ts` V3c''''（ALLOW）；消费 = enable/bump 两槽（enable 不调 fence——§2.1 显式裁决） |
| `RuntimeReplicationSessionStatus`（internal type-only 面） | replication-session.ts / internal.ts re-export | 10 字段 | +`needsResync` | caller = registry.ts Equal 锁 + lease.ts 结构面（经 Equal 转置）——编译器驱动同步（§13.2） |

抓全方法备注：`git grep -n "applyRemoteUpdate\|SessionFanout\|ReplicationWriteEnv\|createNamespaceRegistryPlugin\|NAMESPACE_REGISTRY_PLUGIN_CONFIG" -- 'packages/**/*.ts'`——applyRemoteUpdates 调用点 = lease.ts wrapCore + 各测试；SessionFanout = runtime.ts + replication-session.ts（内部）；plugin config = plugin.ts + registry-plugin.test.ts + round-2 red（`as never` cast）。

---

## §20. 设计自检结论

1. **评审 12 项全覆盖**：R2-1（§2）/R2-2（§3）/R2-3（§4）/R2-4（§5）/R2-5（§6）/R2-6（§7）/R2-7（§8）/R2-8（§9）/R2-9（§10）/R2-10（§11）/R2-11（§12）/R2-12（§13）——逐项含机制 + 测试归属（SA6 转绿 / SA3 包内）+ 文档同步落点（§14）。
2. **SA8 登记义务 D-1..D-4 全部内含**：D-1（§4 + §14 ADR 行 + phase-5 C-1 改写）、D-2a（§2 + §14）、D-2b（§3 + §14）、D-3（§5 + §14——路径 (a)，规则表冻结 + 锁定测试）、D-4（§7/§8 + §14）。
3. **SA6 六项待冻结全部裁决**（§0 F-1..F-6）；红灯套件 29 用例零锚改形（唯 fixture 类型面同步，SA6 §3.1 预留）；round-1 52 用例仅 1 锚值演进（F-3 联动，SA6 §3.3 预留并明示「提请 SA1 注意」）。
4. **round-1 两处作废断言明文修订**（§1 前两行）+ 本增补充分推演追加三处（§1 后三行——均有 ADR/评审依据）。
5. **公共面纪律零突破**：Runtime 十二键 / index 值导出恰一键 / internal 两键 / session 十键 Equal 锁 / seam 类型跨包断言——全部保持；status 第 11 字段经 Equal 格架两点同步（§13.2 演示）。
6. **时序防弹**：§4.3 五组推演覆盖慢 listener 零阻塞（写槽/apply 槽/后续槽）、flushMicrotasks 可观测（40/60 预算）、溢出确定性；自延伸链公平性为机制根源（非墙钟巧合）；SA7 动态验证点已在 §18 标注。
7. **最小扩面**：runtime 三文件 + registry 四文件 + 文档五处 + 版本两行；close.ts/sequencer.ts/write.ts/errors.ts/index.ts/internal.ts 零改动（排空与 FIFO 全部复用既有结构）。
8. **无虚假降级**：R2-5 的 catch 隔离是 guaranteed cleanup 的显式设计（评审指定的隔离语义），非静默吞错——onReleased 无条件执行、释放事实先于 seam 调用完成；R2-3 的溢出丢弃是 L113 字面契约的落地（needs-resync 可观测标记即 loud 面）。

---

## SA2 反馈逐条回应（R2.1 修订 — 评审报告 `task_namespace-lease-replication-session_round2_sa2_review.md`，2026-08-28；8 项全处置）

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| **#1（HIGH，必修）**：泵 × subscribeOwnedUpdates 交付集语义漂移未登记；二选一冻结（推荐 A） | ✅（选 **A**——at-least-once 明文登记） | §4.2 要点 8（新增，含三段推论：交付时刻快照 / 晚订阅者收积压项 / 跨退订重订重复交付 + Yjs apply 幂等吸收）+ §4.2 要点 4/5（「语义不变」限定为字节面/计数面并指引要点 8）+ §11（INV-S4 声称限定字节面）+ §14 D-1（ADR 交付集冻结句）+ §19（总述修正 + 新增「subscribeOwnedUpdates 交付集语义」行，含 caller 与既有锚相容性论证）+ §15.2（SA3 锚 ×2：积压期订阅收到积压项 / 退订重订重复交付幂等吸收） | 行为契约增量从「未登记的偶然产物」升格为四处联锁的冻结文本（设计正文 / ADR 登记句 / 契约审计行 / 测试锚）；通篇「语义不变」过度声称按字节面/计数面/交付集三分收敛 |
| **#2（MEDIUM，必修）**：§5.2 规则表 Y.Text 格与 §5.1 代码矛盾；二选一使三处一致 | ✅（选 **B**——保守白名单） | §5.1 代码（`instanceof Y.Map \|\| instanceof Y.Array` 白名单分支替换 `instanceof Y.AbstractType` 泛判 + 路线裁决段：物化域对齐论证 + 触发面权衡）+ §5.2 表（契约外容器行改写为「不参与投影比较、虽同型等内容未变亦拒」+ 新增跨形态分叉行 + 新增嵌套归一化边界行 + 容器域两级裁决 bullet）+ §5.3（SA3 锚：种子 Y.Text ROOT-only 拒 / Y.Text vs plain 跨形态拒对照 / 嵌套放行边界）+ §14 D-3（登记句同步白名单语义） | 代码/规则表/ADR 登记三处逐字对齐；选择依据 = 「修正 false positive 而非放宽保护」在容器域的连续（(A) 会静默宽恕契约外存量）；契约外 Y.Text 文档维持 round-1 全拒——零回归 |
| **#3（MEDIUM）**：§4.3(d) 裕度乐观；20 让步双向 load-bearing 未引用；SA7 满载复跑 | ✅ | §4.3(d) 重写 | 裕度区间化（端到端 240–390ms、裕度 **10–160ms** 随跳数/写开销漂移，替换「≥70ms」）；20 常数标注双向 load-bearing（公平性下界 / flush 上界，合法区间 [16,24] 引 §18）；SA7 移交注记（red #9 forks 池满载复跑 ≥3 次取最坏值）；`needsResync` 确定性部分标注与墙钟无关 |
| **#4（LOW）**：Set 迭代中删除的实现脆弱性 | ✅ | §2.1 + §3.1（实现不变量注记：finalize 只摘除自身 channel；迭代期删除限当前元素；SA3 禁止级联摘除，如需改快照迭代）+ §2.3 / §15.2（双 channel 直构谓词正反加严锚：恰命中者终态化、无跳过无过栅） | 注记 + 加严锚双落位 |
| **#5（LOW）**：敌意 thenable 尾巴（`closing.catch` 返回 rejecting） | ✅（选加固路） | §6.1 代码（`void Promise.resolve(closing).catch(() => {})` 原生同化——敌意 catch 方法不再被直接调用）+ 类型面边界声明（公共类型面不可达、面向超类型面病态替身）+ §15.2 可选锚（hostile catch 返回 rejecting → 进程级 unhandledRejection 计数 0） | 加固优于纯注释（一行成本闭合超类型面）；SA6 锚零影响（其 closeImpl 为同步 throw / 真 Promise） |
| **#6（LOW）**：§7 除外注记缺失败方向 | ✅ | §7.1 例外注记 + §14 D-4 | 补「除外情形失败方向为 under-report（committed:false 而可能已变异）——比过报危险（调用方可能跳过 reconciliation）；L84 只强制过报方向」——契约破坏域残余风险以方向性明文收口 |
| **#7（LOW）**：泵 IIFE 无最外层兜底 | ✅（选 catch 路） | §4.2 代码（最外层 `catch { channel.failures += 1; }` + 注释：listener 已逐个隔离、shift/slice 结构性不可抛，兜底面向未来编辑引入的非 listener 抛点）+ §15.2 可选锚（isTerminal 抛错替身 → observerFailures 递增） | 兜底与注释双落位；泵主路径行为零变化 |
| **#8（LOW）**：R2-4 深比较性能注记缺位 | ✅ | §14 D-3 | 增补「每 apply 每受保护 META 键 toJSON() 递归投影 ×2（live + scratch）+ 键集 sort——O(META 体量)/次（scratch clone 为既有成本，深比较为新增）」，与 fanout 两级副本注记同款 |

**R2.1 不变项**：机制骨架（fence/terminate/finalize 终态机、自延伸泵、deepEqualPlain、doRelease 直调、探针二分、plugin 贯通——SA2 认定「经全维攻击存活」）、F-1..F-6 裁决、§15.1 SA6 红锚矩阵（零改形）、ALLOW/DENY 边界（仅 §15.2 新建测试文件规模 250–350 → 280–380 行随新锚扩容）、§16 版本 bump 面。

---

## R2.2 修订记录（2026-08-28——SA3 交付 commit 8a68d82 后的三项就地裁决 + 两项另核；报告 `task_namespace-lease-replication-session_round2_sa3_impl.md`）

### 裁决 1（偏离 1——§5.1 白名单物化前提）：**认可修正，设计文本追认并与实现/ADR 三方对齐**

- **事实核验（SA1 独立复测）**：worktree `packages/namespace-runtime` 下 node 探针实测 yjs 13.6.32——`meta.set('labels', ['a','b'])` 后 `Array.isArray(get('labels'))===true ∧ instanceof Y.Array===false`；plain object 仍为 `Object.prototype` 原型、非 `Y.Map`；encode/apply round-trip 后仍为 plain；显式 `new Y.Map()` 容器可与之并存。与 SA3 实现期实测互为第二来源——**R2/R2.1 版「合法 plain value 经 Yjs 物化的仅有两种本地形态 = Y.Map/Y.Array」前提错误成立**。若按错误前提实现（仅 `instanceof Y.Map || instanceof Y.Array` 白名单），SA6 red #10/#11（种子即 plain 形态）恒拒、红锚不可能转绿——前提修正为实现可行性的必要条件。
- **裁决理由**：SA3 的修正保持路线 (B) 的保守边界不变（成员修正、路线不变）——白名单 = 合法 plain 值域的**实际**本地形态（plain array/object 原样存储）∪ 手工容器形态（Y.Map/Y.Array，显式构造）；一切非白名单 `AbstractType`（Y.Text 等）与 Date/Map/Set 非 plain 实例维持保守拒——「修正 false positive 而非放宽保护」定性继续成立，round-1 对契约外形态的全拒行为零变化。实测反证属协议假设层面的错误（非机制层的路线错误），实现期发现并按设计意图修正 + 如实登记偏离——处置正确。
- **修订落位**：§5.1 前提修正引文 + `isWhitelistedValueContainer`/`projectOf` 代码块（与实现逐字一致）+ 路线裁决段补记；§5.2 表（白名单行拆分为 Y.Map/Y.Array 显式容器行 + plain 原样存储行【R2.2】+ Date/Map/Set 非 plain 拒行 + 嵌套边界行限定「plain 容器内不可达」）+ 两级裁决 bullet；§14 D-3 登记句与 ADR 0010 round-2 小节 L273 对齐——**【如实化 / SA2 R2.2 复审 M-1】本裁决初稿「与已落盘 ADR L273 逐字对齐（核验一致）」的声称在修正前不成立**：当时核验的是主体口径方向（writeAny 原样存储分句已由 SA3 落盘），漏检了 Y.Map/Y.Array 括注内残留的已作废前提原句「合法 plain value 经 Yjs 物化的仅有两种本地形态」（与同句下一分句自相矛盾）；**M-1 就地修正（括注改写为「显式构造容器」口径）后三方（设计/实现/ADR）逐字一致**；§18 新增双源实测行。SA2 #2 三锚 + plain 域矩阵全绿（SA3 实测）佐证。

### 裁决 2（发现 1——§19 相容性声称错误）：**认可，作废错误声称 + 授权 AC-2 ③ 一行 fixture 时序演进**

- **事实核验（读码确认）**：registry round-1 AC-2 ③（L726-751）步骤 ② 于 L729 `mutateRoot(n→8)`（无 flush、无 listener），步骤 ③ 于 L738 订阅——两步之间全部为同步语句（encodeDiff/replay/expect，零 await）⇒ 订阅完成于泵首投递（20 让步未达）之前 ⇒ 交付时刻快照含晚订阅者 ⇒ 收到订阅前入队的 n→8 项（SA3 实测 `received.length===2`）。**这正是 §4.2 要点 8 明文冻结的 at-least-once 行为**——SA3 新锚 (i) 同构锚定该语义，两锚同真、不可在断言层调和。
- **裁决理由**：断言（`received.length===1` 的「订阅后恰收一项」语义）与实现（at-least-once）均被冻结文本支持——错的是 R2.1 §19 的**相容性声称**（「全部 events 断言均为订阅先于写」漏计了此「写先于订阅、订阅先于投递」边界）。最小修复 = fixture 时序演进（写后、订阅前 `await flushMicrotasks()` 排空积压）——断言本体与语义零变化，锚回到「订阅先于写」时序域。授权 SA6 执行（§15.3-3 已修订；SA3 §6 清单第 2 项同源）。
- **修订落位**：§19 交付集行的相容性 cell 重写（错误声称作废 + 例外用例点名 + 演进授权）；§15.3-3「零改动」结论修订为「恰一行 fixture 时序演进」；§17 对应 ALLOW 条目同步。

### 裁决 3（发现 2——red #9 跨测试自旋泄漏）：**采纳处置 (a)（spin fixture 末尾 close 收尾）；冻结常数与断言不动**

- **事实核验**：SA3 探针实测——red #8 的 400ms 自旋 listener 泵遗留排队项，其自旋在微任务 FIFO 中排进 red #9 首写 await 窗口（deliveries=12、totalSpin=180ms、泄漏恰 = 前测 400ms）⇒ 整文件跑恒 584–607ms；单用例隔离 3/3 绿（187–227ms——**低于 §4.3(d) 预估区间 240–390ms 的下界，方向更优：实际交错交付与写开销低于区间估算的保守端；区间为上界包络而非点估计——N'-3 措辞修正，原「落在区间内」算术不实**）。机理 = 异步泵交付发生在 transaction 栈外（设计意图 ✓）但**测试隔离**未建模——R2.1 §4.3(d) 区间只覆盖单测试窗口。
- **裁决理由**：(a) 以既有终态机制（finalize 清队 + 泵退出）实现零泄漏收尾，零断言改形、零常数改动（20/16 双向 load-bearing 维持）、与生产语义无涉（生产中 session 生命周期由 transport/lease 管理，不存在「测试结束」面）；备选 (b)（放宽阈值/移动文件）治标且弱化断言，否决。§4.3(d) 区间估算在收尾落地后由 SA3 单用例实测佐证；SA7 满载复跑协议（forks 池 ≥3 次取最坏值）保持——**在 SA6 收尾落地后执行**。
- **修订落位**：§4.3(d) 新增「测试隔离义务（冻结为测试面契约）」注记（机理 + 义务 + 区间适用范围限定）；§15.3-4 新增 SA6 执行条目（red #7/#8 末尾 close——red #9 自身 15ms fixture 同款义务）；§18 新增泄漏量实测行。

### 另核 1（偏离 2——新文件 ~740 行 vs 目标 280–380）：**认可**

理由：行数目标为估算档位非行为面约束；22 用例全部落位（含 R2.1 全部必修锚）且每锚独立 seed/断言（零共享可变 fixture 纪律）——「最小扩面」以**行为面不缩水、DENY 零触碰**为准绳（SA3 实测满足）。§15.2/§17 规模数字已同步（280–380 → ~740）。

### 另核 2（偏离 3——SA2 #5 可选锚未在 runtime 落位）：**裁决 = 不新增仓内落位，承接 = SA7 动态验证可选直构**

理由：① 该锚属 registry 侧 lease.ts 注入域，runtime 包测试依赖方向禁止 import registry（round-1 文件头注同款纪律）——SA3 不落位**正确**；② 加固（`Promise.resolve(closing).catch`）的正确性为**语言级结构事实**（原生 promise 同化 + 原生 catch——非运行时可变行为），运行时锚为可选增强而非义务（SA2 原判「可选」）；③ SA6 registry 红文件锚集冻结（不可为可选项扩锚）。故：SA7 如需行为证据，在动态验证脚本内直构 hostile core 验证 unhandledRejection 计数 0（不入仓）；无证据缺口风险（§6.1 加固为结构性闭合）。§15.2 可选锚条目已注明承接与理由。

### R2.2 不变项

机制骨架与冻结常数（FANOUT_CHANNEL_QUEUE_CAPACITY=16 / FANOUT_DELIVERY_DEFERRAL_MICROTASKS=20 双向 load-bearing）、F-1..F-6 裁决、交付集 at-least-once 冻结（§4.2 要点 8）、§15.1 SA6 红锚矩阵、SA8 登记义务 D-1..D-4 的落点结构、§16 版本 bump 面（runtime 0.1.10 / registry 0.1.6）、ALLOW/DENY 边界（文件集零增减）——均不变。SA3 实现与 R2.2 修订后的设计文本/ADR 0010 L273 三方逐字一致（**ADR 侧一致性以 M-1 修正为前提，见下**）。

### M-1 执行记录（SA2 R2.2 复审 pass 附合并前文字必修——2026-08-28 落地）

- **① ADR 就地修正**：`docs/adr/0010-hub-peer-websocket-ydoc-replication.md` round-2 小节 L273 的 Y.Map/Y.Array 括注——已作废前提原句「（合法 plain value 经 Yjs 物化的仅有两种本地形态——`toJSON()` 递归投影参与比较）」改写为「（**显式构造容器**——调用方以 `new Y.Map()` / `new Y.Array()` 显式构造的本地容器形态；经 `toJSON()` 递归投影参与比较）」，同句 plain 分句尾「L31 值域的实际本地形态」强化为「实际本地**存储**形态」——与 §5.1/§5.2 口径逐字一致；修正消除同句内部自相矛盾（append-only 修订节内部就地文字修正，SA2 明示合并前可改）。
- **② 设计声称如实化（四处）**：头部 R2.2 概述、§5.1 路线裁决段尾、§14 D-3 引语、裁决 1 修订落位——「与已落盘 ADR 逐字对齐（核验一致）」改为「M-1 修正后逐字一致 + 修正前漏检括注残留的如实说明」（初稿核验的是主体口径方向，漏检括注——已点名承认）。
- **③ N'-3 措辞修正（两处）**：§4.3(d) 隔离义务注记与裁决 3 事实核验——「187–227ms 落在区间内」改为「**低于区间下界 240ms（方向更优：实际交错交付与写开销低于区间估算的保守端；区间为上界包络而非点估计）**」。
- 改动面：仅 `docs/adr/0010-*.md` 与本设计文件（SA2 授权范围）；随小 commit 入库（`(#134)` 风格）。
