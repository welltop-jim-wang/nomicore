# SA1 架构设计 — DSH 持久化开发 profile 与 inspector 探针（Issue #59, P4）

> 阶段：Phase 2 架构设计（**R3 修订轮（窄幅）**：SA2 R2 评审 reject（窄幅）——协议骨架经源码级复核+独立原型确认成立、不重开；本轮仅修 §6.2 pending 联言基线公式（R2-1）+ 顺序规则前置（R2-2）+ ProbeClock.pending() 声明（R2-2b）+ 单降级源前置（R2-3）。R2 的两阶段结算协议与 R1/R0 未被触及部分继续有效）
> 任务简报：`wiki/raw/task_dsh-persistence-inspector.md`（含 SA6 Phase 1 验收锚定 §1–§4，契约面以简报 §2/§3 为准）
> ADR 约束基准：`wiki/raw/task_dsh-persistence-inspector_relevant_decisions.md`（ADR-0006 含 2026-08-21 修订节为直接治理 ADR；冲突门禁结论提示 1–5 全部落实，见 §10 映射表）
> 评审链：SA2 R0 评审（reject→R1 落实）；SA8 设计后复审（clear）；SA4 R1 复审（pass）；**SA7 动态验证 fail-needs-fix→R2 回流（`task_dsh-persistence-inspector_sa7_report.md`）**
> 实现基线：P1–P3 已合入（2aa22f4）；SA3 实现 + F1/F2 修复 + SA4 pass + SA6 R1–R5 测试修订均已落盘（HEAD 66ce567 系）；SA6 三缺陷（§9）全部协调落盘。R2 焦点 = file 通道结算谓词重定义（§6.2）。
> worktree：`/home/wangjian/nomicore-fix-issue-59`
> ⚠️ **R3 阻塞解除条件：SA2 R2 攻击点 R2-1/R2-2/R2-3 已全部落实（§6.2/§6.3/§13 P24）；SA7 F-FILE（P1）的修复仍待 SA3 按 R3 版 §6.2 落地 + SA4 复审（专项核对谓词形态——联言基线是本缺陷注入点）+ SA7 复跑（52 跑 + 建议补 file n=2 批次，当前锚只覆盖 n=0/1）。**

---

## §1. 需求推演（Feature）

**任务本质**：ADR-0006 实施顺序第 4 步。P1–P3 已把持久层做成「宿主无关的 Cordis 插件」，但至今只在测试文件里以裸 `new Context()` 驱动过。本任务交付两件事：

1. **DSH 开发 profile**：一个把 `@nomicore/persistence` 现成插件工厂装进真实 Cordis Context 的薄宿主函数（`createDshPersistenceProfile`），证明「同一 contracts、双 Adapter、零条件分支在 core 之外」——**这不是新持久化逻辑，是宿主装配**。
2. **inspector 探针**：一个只消费 `DocPersistence` service 公共面 + 公开注入缝的黑盒驱动器（`runPersistenceProbe` + `src/cli.ts`），在受控虚拟时钟下把 ADR-0006 的关键语义（lease 身份、内部调度 flush、degraded→retry→recovered、引用归零 evict、分区隔离、duplicate/meta-mismatch 响亮拒绝）跑成**确定性、可复制的事件流与文本记录**，供人肉验收与后续 NomicoreServer Host 复用（AC8）。

**真正的设计难题不是装配，是观察**：探针必须观察到 `dirty { generation }`、`flush { generation, ok }`、`evict`、`degraded`/`recovered` 这些**持久层内部状态迁移**，但 AC7 与 ADR-0006 禁止把观察面塞进核心插件（「inspector 只消费 DocPersistence service，不得成为核心插件依赖」；冲突门禁提示 3：「inspector 不得引入外部 flush 协调器，只观察内部调度」）。core 的 `PersistenceLifecycle` 没有事件面，且本任务的 DENY 边界不允许改 `packages/persistence/src/**`（§12）。因此观察通道必须建在 DSH 侧：**memory 走 `MemoryPersistenceOptions` 顶层 `writeSnapshot`/`readSnapshot` 公开 dev/test 注入缝（DSH profile 选项形状为 `memoryIo`，profile 展平透传，§7/P18），file 走「受控时钟边界 + 提交态文件系统外部观察 + getStatus 轮询」**（file adapter 的公共面没有 I/O 注入缝，这是 P3 既定事实；文件系统本身就是 file adapter 的提交态存储，读它不是窥探私有内部）。详见 §6。

**设计期实测验证（R1 收紧纪律）**：本设计的关键机制与**每一条 SA6 用例的可满足性结论**均在真实 P1–P3 代码上原型验证，§9 盘点表逐行挂 §13 证据编号（无证据的行显式标注「未验证 + 风险等级」——本轮已无此类行）。R1 新增证据 P13–P18 覆盖：AC1-memory 不可满足证伪（攻击点 1）、修复配方可满足、AC4-service-memory 的「内核时序 × SA6 FakeTimer 排空深度」精确核算、探针骨架全场景（逐字 FakeTimer + settle 协议）、`failFirstFlushes=2` 退避循环、`memoryIo` 展平事实。**SA1 未改动任何生产/测试文件**，原型脚本跑完即删。

## §2. 现状资产盘点（设计起点）

| 资产 | 位置 | 状态 | 本任务处置 |
|---|---|---|---|
| `DocPersistence`/`DocHandle`/`User` 契约、`DOC_PERSISTENCE_SERVICE`、`DEFAULT_PERSISTENCE_SCHEDULE`（500/5000）、`PersistenceTimer`、`DocDuplicateError`（`code='DOC_DUPLICATE'`） | `packages/persistence/src/contract.ts` | P1 锁定 | 只读消费 |
| `PersistenceLifecycle`（per-key 协调、debounce/maxDirty/retry 三计时器、单飞 flush + generation 保序、degraded 状态机、`maybeEvict`、dispose-epoch、abort I/O） | `packages/persistence/src/lifecycle.ts` | P2→P3 共享内核，全绿 | **只读消费，零改动**（DENY） |
| `MemoryPersistence`（注入缝 = options **顶层** `writeSnapshot`/`readSnapshot` 字段；write 路径：hook 先 await、mirror 后写；read 路径：hook 是唯一读权威。注意：DSH profile 的 `memoryIo` 选项形状须在 profile 展平，§7/P18） | `packages/persistence/src/memory.ts` | 全绿 | profile 选项透传；探针 write 钩子注入（§6.1） |
| `FilePersistence`（`rootDir` 必需；用户分区 `users/<userId>/<docId>.snapshot`；tmp+rename 原子提交；无 I/O 注入缝） | `packages/persistence/src/file.ts` | 全绿 | profile 装配；探针走外部观察通道（§6.2） |
| 插件工厂 `createMemoryPersistencePlugin` / `createFilePersistencePlugin`（`{ apply(ctx), instance }`，apply 时 `ctx.effect` 注册 service + dispose 清理） | 同上 | 全绿 | profile 唯一装配路径 |
| SA6 脚手架：`packages/dsh-persistence/package.json`（`@nomicore/dsh-persistence`，deps 已装，`dsh:probe` 脚本）+ 两个红灯测试文件 + `packages/persistence/test/core-dsh-boundary.test.ts` 绿色守卫 | `packages/dsh-persistence/` | 红灯（src 不存在） | 本任务交付 `src/**` 修绿；测试缺陷协调状态（R1）：缺陷 1/2 已落盘（657b877），缺陷 3 待 SA6 R2（§9） |
| Cordis `Context`（`new Context()` 可裸建；`ctx.provide` 返回注销函数；`ctx.effect` 注册清理；`await ctx.fiber.dispose()` 运行 effect 清理并注销 service） | `@deepseek-ai/cordis@4.0.1` | 已被绿色守卫使用 | profile 装配基座 |

**Caller 审计（grep 证实）**：`@nomicore/persistence` 无包外消费者（`apps/`、其他 `packages/` 均未引用，SA8/P3 已核）。`@nomicore/dsh-persistence` 是第一个真实消费者——依赖方向 `dsh-persistence → persistence` 单向，AC7 绿色守卫（`import.meta.resolve` 方向 + manifest 断言）保持绿色即证。

## §3. 架构决策总览

| # | 决策 | 一句话 |
|---|---|---|
| A | 双层结构：profile（纯装配）+ probe（黑盒驱动+观察） | 装配与观察分离，探针不装饰 service |
| B | 观察通道 adapter 特化：memory=注入缝，file=外部观察 | core 零事件面，观察全在 DSH 侧 |
| C | generation/refs 由探针自持模型推演，不解析 core 内部 | 只依赖公共 service + 自驱序列 |
| D | `ProbeClock`（可推进确定性时钟）是探针 timer 契约 | 裸 `PersistenceTimer` 缺 `advanceBy` → loud TypeError |
| E | profile 配置冲突 loud-reject（拒绝虚假降级） | memory+rootDir / file+memoryIo / 未知 adapter 一律 throw |
| F | dispose 顺序：adapter 先、Cordis fiber 后；幂等 | AC6 全部断言的满足顺序 |
| G | release 之间插入 1-tick 时钟推进 | `evict.t > releases[0].t` 的实证必要条件 |
| H | 每次 flush 尝试（含 retry 重试）各发一条 flush 事件；create-commit 写不算 flush | 事件面诚实覆盖内部调度 |
| I | SA6 三处测试缺陷交总控协调修测试，不在实现侧 hack | 禁止为测试改 core 语义；缺陷 3（AC1-memory）为 R1 新增 |

## §4. 架构决策

### 决策 A：双层结构——profile 是纯装配，probe 是黑盒驱动器，二者不共享观察逻辑

`createDshPersistenceProfile` 只做四件事：选插件工厂（'memory' | 'file' 唯一分支点，即「零条件分支在 core 之外」的字面落地）→ `new Context()` → `plugin.apply(ctx)` → 暴露 `{ ctx, persistence, getStatus, dispose }`。`persistence` 就是 `plugin.instance`（真实 `MemoryPersistence`/`FilePersistence` 实例，AC1 `toBeInstanceOf` 断言的直接满足），`ctx.get(DOC_PERSISTENCE_SERVICE)` 返回同一对象（`ctx.provide` 注册的是同一实例）。

`runPersistenceProbe` 内部**调用同一个 `createDshPersistenceProfile`**（单一装配路径），在其上叠加：场景脚本（§5）+ 观察通道（§6）+ 记录渲染（§7）。探针**不包装、不装饰** `DocPersistence`——它发出去的每个 service 调用都是真实调用，观察来自缝与外部效应，不来自代理拦截。理由：装饰器方案会让 `ctx.get('docPersistence')` 与 `profile.persistence` 出现两个身份，直接违反 AC1 的 `toBe` 断言与 ADR「service 是 Host 长生命周期资源」的单一实例语义。

**（R1，攻击点 5）service 消费路径显式化**：简报 §3 明文「inspector 只经 Cordis 消费 `docPersistence`」。落地：探针运行时第一步 `const svc = requireDocPersistence(profile.ctx)`（等价 `ctx.get(DOC_PERSISTENCE_SERVICE)`，P1 既导出），此后**全部** `createDoc/loadDoc/saveDoc` 调用经 `svc` 发出；`svc === profile.persistence` 恒成立（同一次 `ctx.provide` 注册的同一实例），探针对该恒等式做一次自检断言（不一致 → `probe-failed:scenario-error:service-identity`，loud）。这是「只经 Cordis 消费」在代码里唯一可验证的落点。

### 决策 B：观察通道 adapter 特化——memory 走公开注入缝，file 走外部提交态观察

**memory 通道**：探针经 profile options 的 `memoryIo.writeSnapshot` 注入一个**同步纯观察钩子**（§6.1 伪代码）：per-key 写计数区分 create-commit（第 1 次）与 flush 尝试（第 ≥2 次，含 retry），flush 尝试即发 `flush { generation, ok }` 事件（钩子正常返回 → `ok=true`；钩子 throw → `ok=false` 并随即发 `degraded`），`failFirstFlushes` 只对 `doc-degraded` key 的 flush 尝试注入前 N 次失败。钩子不存储任何数据（memory adapter 自有 mirror，读路径不注入 `readSnapshot`，restore-after-evict 走 adapter 自身 mirror——原型 V3 已证 reload 得到含 rev=2 的新实例）。

**file 通道**：`FilePersistenceOptions` 无 I/O 缝（P3 既定公共面，不改）。探针的观察手段全部是外部效应：受控时钟推进到调度边界后，用**真实等待**（`waitFor(predicate, realDeadline)`，内部用系统 `setTimeout` 轮询，等待不推进虚拟时钟、不进入记录）等真实文件 I/O 结算，然后读提交态快照文件（解码比对 `ROOT.rev` 等语义标记）判定 flush 成败、读 `getStatus()` 判定 degraded/recovered。失败注入用**外科式阻塞**：把 `users/<owner>/{docId}.snapshot.tmp` 占为目录 → flush 的 `writeFile(tmp)` 得 EISDIR（原型 V7 已证：degraded → 解除 → retry recovered，且同用户其他 doc 的已提交快照不受误伤）。

**为什么不为 file 加注入缝**：给 `FilePersistenceOptions` 加 `io` 钩子是改 P3 公共面（DENY 边界 + 纯为探针服务的生产面污染）；外部观察虽多一层等待，但观察对象（提交态文件）恰是 ADR-0006 定义的「只有 `.snapshot` 是提交态」公共语义，探针读它是最诚实的黑盒观察。

### 决策 C：generation / refs / 实例身份由探针自持模型推演

- **generation（R1，攻击点 3：递增点显式立法）**：`saveDoc` 是公共 API，每次成功调用使该 doc 的 `dirtyGeneration` +1（lifecycle.ts:201 逐字行为）；探针数自己发出的 saveDoc 即得 generation。**递增点唯一且严格：`saveCounters` 仅在该次 `saveDoc` promise resolve 之后 +1——reject（`write-rejected`）一律不计**。若误把被拒的 saveDoc 计入，degraded 后 retry 成功的 flush 会渲染成 `generation=2 ok=true`，而内核捕获的仍是 g1（lifecycle `flush()` 捕获当时 `dirtyGeneration`）——记录规范（§8）与内核行为将系统性背离。正确模型下：S4 的 `dirty generation=2` 行必然出现在 `recovered` 之后（恢复可写证明的 saveDoc 才是第二个成功的 saveDoc）——这也是 SA2 红线测试 #3 的锚（实证见 §13 P16：retry 成功渲染 `generation=1 ok=true`，随后才有 `dirty doc-degraded generation=2`）。
- **refs**：探针是唯一 handle 持有者，per-`(owner,docId)` 记账 `held` 集合；`release` 事件带 `held-1`。与内核 `entry.handles.size` 一致（探针从不把手柄交给第三方）。
- **实例身份**：`WeakMap<Y.Doc, string>` 给每个 live Y.Doc 发稳定 id（`d1`,`d2`,…）；handle 同理发 `h1`,`h2`,…。确定性来自固定的发号顺序。
- **evict**：`doc.on('destroyed', …)`（yjs 公共事件，原型 V1 已证）——驱逐即销毁，销毁即事件，不需要 core 暴露缓存表。

**为什么不用轮询推断**：受控时钟下时序是探针自己排的，自持模型是确定性的；轮询内部状态既不可能（无公共面）也不必要。

### 决策 D：`ProbeClock` 是探针 timer 契约；不可推进的 timer 一律 loud reject

简报 §2 写 `timer?` 缺省时「探针自建确定性虚拟时钟（CLI 可复制的关键）」。推论：**提供的 timer 必须可推进**，否则记录将含墙钟时间、违反 AC8 逐字节一致。因此：

```ts
export interface ProbeClock extends PersistenceTimer {
  advanceBy(milliseconds: number): Promise<void>
}
```

- 缺省：探针自建 `createDeterministicClock()`（§4 clock 模块），行为与 P2/P3 共享 testkit `createTestTimer` 同族：按到期刻度顺序触发回调，每次触发后排空微任务。
- 调用方传入的对象在运行时做结构检查：缺 `advanceBy` → 抛 `TypeError('runPersistenceProbe requires a drivable clock (advanceBy); a bare PersistenceTimer cannot keep the record deterministic')`。SA6 验收测试传入的 `FakeTimer`（now/setTimeout/clearTimeout/advanceBy）结构兼容 ✓。这是**正常路径缺陷的 loud assert**（不是降级场景）：不可推进的时钟使 AC8 契约不可能成立。
- profile 的 `timer` 保持 `PersistenceTimer`（简报 §2 原样）：宿主配置只是把计时器实现注入插件，不需要推进能力。

### 决策 E：profile 配置冲突 loud-reject（拒绝虚假降级）

| 输入 | 处置 | 依据 |
|---|---|---|
| `adapter` ∉ {'memory','file'} | `TypeError`，消息含 `adapter` | AC1 红灯断言 `toThrow()`；CLI stderr 需匹配 `/adapter/` |
| `adapter:'file'` 且 `rootDir` 缺失/空 | `TypeError`，消息含 `rootDir`（profile 预校验；`FilePersistence` 构造器二道防线） | CLI stderr 需匹配 `/rootDir/`；AC6 场景 file 必需 rootDir |
| `adapter:'memory'` 且给了 `rootDir` | `TypeError`（配置 bug，静默忽略会掩盖意图错误） | 拒绝虚假降级立法 |
| `adapter:'file'` 且给了 `memoryIo` | `TypeError`（同上） | 同上 |
| `schedule` 非法值 | 透传给 `resolvePersistenceSchedule`（其自带 RangeError） | P1 既有行为 |

### 决策 F：profile.dispose 顺序与幂等

```ts
async dispose(): Promise<void> {
  if (this.disposed) return            // 幂等（重复调用无害）
  this.disposed = true
  await this.persistence.dispose()     // ① 先停 adapter：settle 全部 in-flight I/O、清三计时器、销毁 live Y.Doc
  await this.ctx.fiber.dispose()       // ② 再停 Cordis：effect cleanup 运行（再次 dispose adapter，幂等）→ service 注销
}
```

顺序依据：①保证 `timer.pending()===0`、`handle.doc.isDestroyed===true` 在 dispose 返回时已成立（内核 `dispose()` 同步清计时器、销毁 doc 后 `await allSettled(inFlight)`）；②保证 `ctx.get(DOC_PERSISTENCE_SERVICE)===undefined`（原型 V2 + 绿色守卫已证 fiber.dispose 运行 effect 清理并注销 service）。`getStatus()` 直接委托 adapter（内核 `closed→'disposed'`）。反向顺序（先 fiber 后 adapter）同样成立但让①的清理跑在 effect 里，出错时区分更难——正序让探针/调用方对 adapter 的停机有直接 await 点。

### 决策 G：release 之间插入 1-tick 时钟推进（实证必要）

AC2 断言 `evicts.every(e => e.t > releases[0].t)`。`maybeEvict` 在最后一次 `release()` 内同步执行，`destroyed` 事件与 release 事件落在**同一虚拟时刻**；若三个 release 不推时钟，`evict.t === releases[0].t`，断言失败（原型 V3 实测确认 evict 与三连 release 同刻 t=1000）。因此场景脚本在相邻 release 之间 `advanceBy(1)`（此时无 pending flush 计时器，1-tick 推进无副作用）。这不是为讨好测试的 hack——它同时让记录里「逐次释放」的过程在时间轴上可读。

### 决策 H：flush 事件面 = 每次 flush 尝试一条；create-commit 写不算 flush

memory 钩子的 per-key 写计数：第 1 次 = `createDoc` 初始提交（ADR：createDoc 承诺返回前落盘，不是 saveDoc 调度面）→ 不发 flush 事件；第 ≥2 次 = flush 尝试（含 degraded 后的 retry 重试）→ 各发一条 `flush { generation, ok }`。retry 与首发同 generation（决策 C），AC4 的 `failedFlush(g1,ok=false) → okFlush(g1,ok=true)` 序列与排序断言天然满足（相对时序 fail@+500 → rejected 同刻 → retry 成功@+1000 → recovered 同刻，实测见 §13 P16；绝对刻度按 §5 场景表为 1508/2008，原型骨架的场景间隔较设计表压缩，相对量逐项一致）。

### 决策 I：SA6 测试缺陷交总控协调，不做实现侧 hack（详见 §9）

实证发现 SA6 红灯测试**三处**断言在**正确实现**下不可满足：缺陷 1（AC4-file 真实 I/O 微任务结算假设）、缺陷 2（AC6 dispose 前脏数据未提交假设）——R0 发现，**已协调落盘**（commit 657b877，SA8 专项裁决 no-conflict）；缺陷 3（AC1-memory release 后 loadDoc 同实例断言）——**R1 由 SA2 攻击点 1 揭出，SA1 独立复核成立**（§9 缺陷 3，证据 P13）。可选的黑帽路径——给 core dispose 加 flush-dirty 语义、给 FilePersistence 写路径加同步预检、让 profile 包装 SA6 的 timer、让 profile 偷持 phantom handle 抑制驱逐（缺陷 3 专属黑帽）——全部违反 DENY 边界或 ADR 语义（§9 逐条排除；SA2 已确认前两类缺陷的实证与修复配方复核无误）。正确路径是修测试（附已验证配方），按简报 §2「SA6 固定，改动须与 SA6 协调」条款交总控。

## §5. 探针固定场景脚本与虚拟时间线

场景顺序固定（记录确定性的前提）：**S1 主链路（user-a/doc-alpha）→ S2 隔离（user-b/doc-alpha）→ S3 异常输入（duplicate / meta-mismatch）→ S4 doc-degraded 生命周期**。S1 必须最先（AC2 `releases[0].refs > 0` 要求首个 release 出自多 handle 场景）。**（R2 对齐实现与锚）S4 恒跑**（SA3 实现已被 SA4/SA6 R5/SA7 锚定为 n=0 时 events=28，含 S4 基本生命周期 create→save→flush×2→release→evict）；**降级腿（注入/拒绝/退避重试/恢复）仅在 `failFirstFlushes ≥ 1` 时执行**——比简报 §3 场景 4 的「仅 memory」表述覆盖更宽（file 降级腿经外科式注入支持，V7/P9），已由 SA7 锚背书。下表为 n=1 的完整形态；n=0 时 S4 仅剩 1008/1508(g1 ok)/2008(g2 ok)/2009 四行（见 §5 推演段与锚定 record）。

默认调度（debounce=500，maxDirty=5000）下的精确时间线（memory；file 同刻度，仅观察手段不同）：

| t | 动作 | 事件 |
|---|---|---|
| 0 | S1：`createDoc(user-a, 'doc-alpha', threeEntryDoc)`（SCHEMA 信封 + META{docId} + ROOT） | `create h1 d1` |
| 0 | `ROOT.rev=1`；`saveDoc` | `dirty g1` |
| 500 | `advanceBy(500)` → debounce 到期 → flush（memory: 钩子第 2 写；file: waitFor 快照 rev=1） | `flush g1 ok=true` |
| 500 | `loadDoc` ×2（同 live doc、独立 handle） | `load h2 d1`、`load h3 d1` |
| 500 | `ROOT.rev=2`；`saveDoc` | `dirty g2` |
| 1000 | `advanceBy(500)` → flush g2 | `flush g2 ok=true` |
| 1000 | `release h1`（refs 3→2） | `release refs=2` |
| 1001 | `release h2`（refs 2→1） | `release refs=1` |
| 1002 | `release h3`（refs 1→0 → 内部 `maybeEvict` → d1 destroyed） | `release refs=0`、`evict` |
| 1002 | `loadDoc` → cache miss → store 还原 → **新实例 d2**；`observed`：META.docId / share keys / ROOT keys | `load h4 d2`、`observed` |
| 1003 | `release h4` → evict d2 | `release refs=0`、`evict` |
| 1004 | S2：`createDoc(user-b, 'doc-alpha', …)`（独立分区） | `create h5 d3` |
| 1004 | `observed`（user-b 视角） | `observed` |
| 1005 | `release h5` → evict d3 | `release refs=0`、`evict` |
| 1006 | S3：`createDoc(user-a,'doc-alpha', 新doc)` → store 路径 `DocDuplicateError` | `duplicate code=DOC_DUPLICATE` |
| 1007 | S3：`createDoc(user-a,'doc-alpha', META.docId='doc-other' 的 doc)` → `validateCreateDoc` 先拒绝（不触盘） | `meta-mismatch expected=doc-alpha actual=doc-other` |
| 1008 | S4：`createDoc(user-a,'doc-degraded', …)` | `create h6 d4` |
| 1008 | `saveDoc` | `dirty g1` |
| 1508 | `advanceBy(500)` → flush 写失败（memory: 钩子注入 throw；file: `.tmp` 目录阻塞 → EISDIR，waitFor degraded） | `flush g1 ok=false`、`degraded` |
| 1508 | `saveDoc` → 内核拒绝（`persistence-degraded`） | `write-rejected` |
| 2008 | `advanceBy(500)`（首次 retry 退避 = debounceMs，内核 `retryDelayMs` 初值）→ retry flush 成功 | `flush g1 ok=true`、`recovered` |
| 2008 | `saveDoc`（恢复可写证明，断言 resolves） | `dirty g2` |
| 2508 | `advanceBy(500)` → flush g2 | `flush g2 ok=true` |
| 2509 | `release h6` → evict d4；探针关闭（拆除 destroyed 监听 → `profile.dispose()`） | `release refs=0`、`evict` |

**S4 通用退避循环（R1，攻击点 4：`failFirstFlushes = n` 为任意非负整数）**：上表仅 n=1。探针对任意 n≥1 采用统一循环——失败注入的每次 flush 尝试后，按**探针自持的退避镜像序列**推进时钟（镜像内核 `retryDelayMs` 规则：初值 `debounceMs`，每次失败后 `delay ← min(max(delay×2,1), maxDirtyMs)`），直至注入耗尽且观察到成功：

```text
saveDoc(g1) → dirty g1
advance(debounceMs)                    → 尝试#1 失败（n≥1）→ [flush g1 ok=false, degraded]
saveDoc → 拒绝 → [write-rejected]                      ← 仅在尝试#1 失败后观察一次（内核语义：degraded 拒绝后续写）
nextDelay = debounceMs                                   ← 镜像内核 retryDelayMs 初值
while (注入未耗尽 或 getStatus() !== 'ready'):
    advance(nextDelay)                 → 下一次 retry 尝试（hook 发 flush 事件；成功则 [flush g1 ok=true, recovered]）
    nextDelay = min(nextDelay×2, maxDirtyMs)             ← 内核失败后翻倍规则（lifecycle.ts:456）
恢复后：saveDoc → resolve → dirty g2 → advance(debounceMs) → flush g2 ok=true → release → evict
```

n=1 退避序列 = [500]，还原上表（失败 1508 → 成功 2008）；n=2 = [500, 1000]：失败 1508 → 失败 2008 → 成功 3008，`flush g1 ok=false` 两条同 generation（实证见 §13 P17）；n=3 = [500, 1000, 2000]，成功在 +4000。任意 n 的虚拟时刻由退避序列唯一决定，record 仍确定；CLI 接受任意 n 而不再欠定。`degraded` 事件在**每次**失败尝试时各发一条（幂等再断言，AC4 用 `find` 取首个，P17 已按此语义验证）。

**每条 AC 断言的满足性推演**（对照 SA6 `dsh-profile-acceptance.test.ts`）：

- AC2：doc-alpha flushes = [g1@500, g2@1000]（≥2 ✓，均 ≥500 ✓，各有同代 dirty 先行 ✓）；loads = h2/h3/h4（≥3 ✓，handle 唯一 ✓，d1 计 2 次 ✓ 实例集大小 2 ✓）；releases（docId=doc-alpha 过滤，含 user-b）= [refs2@1000, refs1@1001, refs0@1002, refs0@1003, refs0@1005]（首个 refs=2>0 ✓，末个=0 ✓，共 5≥3 ✓）；evicts = [1002, 1003, 1005]（≥2 ✓，均 > 1000 ✓）。
- AC3：observed(user-a) metaDocId='doc-alpha'、entries⊇{SCHEMA,META,ROOT} ✓；user-b create+observed 独立 ✓；duplicate code ✓；meta-mismatch expected/actual ✓。
- AC4：[failedFlush 1508, degraded 1508, rejected 1508, okFlush 2008, recovered 2008] 升序 ✓；record 四个标记 ✓。
- AC5：release→refs 归零→内部决定 evict（`maybeEvict` clean 前置）→ reload 新实例（store 还原）——时间线 1002 行完整覆盖 ✓。
- AC8（CLI）：stdout = 记录（仅虚拟 t、无 rootDir）→ 同参两跑逐字节一致 ✓；file 跑落盘 `users/{user-a,user-b}/doc-alpha.snapshot`（create-commit 即落盘，原型 V5 已证 existsSync 在 advance 后成立）✓。
  - **（R2 勘误）**上句「file 双跑逐字节一致」曾被 SA7 动态证伪（P19：52 跑 2 异常——原 §6.2 谓词竞争；SA6 CLI 用例因「双跑同形态 flake → 相等性成立」结构性失明未捕获）。R2 两阶段结算协议（§6.2）修复后恢复成立：原型实证 60 跑逐字节一致（P23）+ 并发 50 跑 3 次自然窗口命中全吸收零失真（P22）+ 确定性窗口（延迟钩子）下旧协议破碎/新协议完整吸收（P20/P21）。SA7 回归锚（`dsh-file-probe-determinism.test.ts`，events=28/`t=2008`/`t=2009` 精确钉死）为该承诺的持续守卫。
- **（R2）协议不变性**：§6.2 两阶段结算协议**不新增事件、不移动虚拟刻度**（A-arming/A-evict 的虚拟刻度不变式证明见 §6.2），§5 全部钉死值（含 n=0 的 events=28）逐字保持；协议的存在只体现在 file 通道等待的真实时间内，对 record 完全不可见。

## §6. 观测通道设计

### §6.1 memory 通道（注入缝，同步纯观察）

```ts
// probe.ts（伪代码，关键逻辑完整）
const injectionKey = 'user-a\u0000doc-degraded'
const writesPerKey = new Map<string, number>()
const saveCounters = new Map<string, number>()   // ★ R1 攻击点 3：唯一递增点在场景脚本中 saveDoc resolve 之后
let flushFailuresLeft = failFirstFlushes ?? 0
let injectionDegraded = false

const memoryIo = {
  writeSnapshot(key: string, _snapshot: Uint8Array): void {   // 同步、零存储：mirror 由 adapter 自己维护
    const n = (writesPerKey.get(key) ?? 0) + 1
    writesPerKey.set(key, n)
    if (n === 1) return                                        // create-commit：不是 flush，静默
    const { owner, docId } = splitKey(key)                     // '\u0000' 分隔；解析失败 → probe-failed（loud）
    const generation = saveCounters.get(key) ?? 0              // 决策 C：被拒的 saveDoc 从未进入此计数
    const inject = key === injectionKey && flushFailuresLeft > 0
    if (inject) {
      flushFailuresLeft -= 1
      emit({ type: 'flush', owner, docId, generation, ok: false, t: clock.now() })
      emit({ type: 'degraded', owner, docId, t: clock.now() }) // 每次失败尝试各一条（幂等再断言）
      throw new Error('probe-injected flush failure')          // → io.write 拒绝 → 内核 degraded + 退避 retry
    }
    emit({ type: 'flush', owner, docId, generation, ok: true, t: clock.now() })
    if (key === injectionKey && injectionDegraded) {
      emit({ type: 'recovered', owner, docId, t: clock.now() })
      injectionDegraded = false
    }
  },
}
// 场景脚本侧（S4 通用循环，见 §5）：每次 flush 观察后推进时钟前——
//   await svc.saveDoc(handle).then(
//     () => { saveCounters.set(key, (saveCounters.get(key) ?? 0) + 1); emit(dirty) },  // ★ resolve 才 +1 才发 dirty
//     (err) => { emit(write-rejected) },                                                // ★ reject：只发事件，不计数
//   )
// 探针每个 advanceBy 之后：await settle(32)（微任务排空，见 §6.3），再对照 getStatus() 自检
// degraded/recovered 推断与 getStatus() 不一致 → probe-failed:status-divergence:{docId}（ok=false，loud）
```

**（R1，攻击点 4）退避推进循环**：S4 不再固定两个 `advanceBy(debounceMs)`，改用 §5 的通用循环（`nextDelay` 镜像内核 `retryDelayMs` 翻倍序列），任意 `failFirstFlushes = n` 均确定。

微任务深度核算（SA6 FakeTimer 每 callback 只排空 2 个微任务的约束下）：flush 链 = `callback → flush() 同步段 → await io.write → await hook(同步) → mirror set → write resolve → flush 恢复`，共 ≤2-3 hop；探针在 advanceBy 后再 `settle(32)`，后续 saveDoc/观察必然看到已结算的内核状态。**逐字 SA6 FakeTimer 下的探针骨架全场景（S1/S3/S4，n=1 与 n=2）已实测通过**（§13 P16/P17）；AC4-service-memory（无探针 settle 兜底、断言紧跟 `advanceBy`）的精确深度核算与实测见 §13 P15。

### §6.2 file 通道（外部提交态观察 + 真实等待 + **R2 两阶段结算协议**）

> **（R2，SA7 F-FILE 回流）R0/R1 本节的原结算谓词被动态验证证伪**，本小节整体重写。被证伪的假设与机理（SA7 52 跑实证，2 异常，§13 P19）：
>
> - 原谓词：`waitFor(() => getStatus()==='ready' && 快照 rev 达标)`，隐含「磁盘提交态可见 ⟺ 内核 flush 记账完成」。
> - 事实：`fs.readFileSync` 直读磁盘在 `rename(2)` 落盘即见新内容；而内核记账（`savedGeneration` 赋值 → `flushing=false` → `maybeEvict`，lifecycle.ts:431→:440→:449）在 `io.write` promise 的续体内，须经**线程池 → 事件循环交接**（poll 交付 + 微任务）才执行。两事件之间存在可观察窗口（加载态下 ~4%/跑）。
> - 症状 B：谓词提前通过 → 探针推进虚拟时钟 → 下一个 save 的 debounce 到期时 `startFlush` 被 `entry.flushing` 单飞锁早退（lifecycle.ts:419→:400）→ g1 记账 finally 把 flush **重排到已推进后的虚拟时钟**（now+debounce）→ 探针不再推进 → 5s 超时（`file-settle-timeout`，exit 1）。
> - 症状 A：谓词提前通过 → release 时 `maybeEvict` 因 `flushing=true` 前置不过 → 不驱逐 → 记账回调 finally 虽会 destroy，但探针 teardown 已先拆 destroyed 监听 → evict 事件静默丢失（events=27、exit 0、ok=true——**下游无法察觉的 record 失真**）。
> - memory 通道不受影响（同步注入缝，无 libuv 交接；SA7 20 跑哈希唯一）。

**R2 结算协议：把「flush 结算」拆成两个独立条件，全部用内核公共面可观察信号证明——**

**条件 W（write-settle，磁盘提交态可见）**：同原谓词（status + 快照 rev 解码比对）。它只证明「这次 flush 的字节已提交」，**不再**被当作记账完成的证据。

**条件 A（accounting-settle，记账完成证明）**——依据内核两条不变式（源码级，DENY 区零改动）：

- **原子性引理**：`flush()` 的记账（try 尾的 `savedGeneration/degraded` 赋值、catch 的 `degraded+scheduleRetry`、finally 的 `flushing=false`/重排/`maybeEvict`）在 `io.write` promise 结算后的**同一个同步续体**内执行（lifecycle.ts:423-451，try 尾/catch→finally 之间无 await）。任何宏任务观察者（探针的轮询定时器）要么完全在记账前、要么完全在记账后看到状态——**不存在「degraded 已见而记账未完」的外部视角**。推论 ①：失败腿 `waitFor(status==='persistence-degraded')` 与恢复腿 `waitFor(status==='ready')` 本身**就是**记账完成证明（状态翻转只发生在记账块内）；推论 ②：成功腿 status 恒为 'ready'，无判别力——竞争恰好只存在于「成功 flush + 后续还有动作」的腿上。
- **武装不变式**：`scheduleFlush`（lifecycle.ts:399-404）以 `if (entry.flushing || closed) return` 早退——**它成功武装计时器 ⟺ 当时 `flushing === false` ⟺ 前一次 flush 的 finally 已执行**（`flushing=false` 只在 finally 赋值）。

由此定义两种 A 形态（互斥，按窗口后续动作选择）：

**A-arming（窗口后还有脏写）**——arm 紧随其后置 saveDoc，advance 仅在 armed 之后：

```ts
const base = pendingCount()            // ★（R3，R2-1）A-arming 基线 = saveDoc 调用前的同步快照（本形态原已正确）：
                                        //   saveDoc 无 await 段——非 flushing 时同步武装 debounce+maxDirty 两计时器，
                                        //   flushing 时由记账 finally 武装——两路径 pending 均净增 ≥1，`>base` 恒可达
await svc.saveDoc(handle)              // 脏写（resolve 后才计 generation，决策 C）
emit dirty { generation }
await waitFor(() => pendingCount() > base, FILE_WAIT_MS, `file-settle-timeout:${docId}:g${gen}`)
//   ↑ 通过 ⟺ scheduleFlush 已武装 ⟺ flushing=false ⟺ 前次 flush 记账完成（武装不变式）
await clock.advanceBy(debounceMs); await settle()
await waitFor(() => status==='ready' && readRev(docId) === expect, …)   // 条件 W
emit flush { generation, ok: true }
```

**虚拟刻度不变式（时间线不漂移的证明）**：探针在「脏 saveDoc → 武装确认」之间**绝不推进虚拟时钟**。若记账滞后（竞争命中），finally 的重排 `scheduleFlush` 以当前虚拟 now（未动）武装 `now+debounce`；若记账已先行，saveDoc 自身武装的也是 `now+debounce`——**两种路径落到同一个虚拟到期刻**。故 §5 钉死时间线与 SA7 锚（events=28、`t=2008`、`t=2009`）逐字保持，且 A-arming 等待本身不产生事件、不进入 record（AC8 双跑逐字节一致恢复）。

**A-evict（窗口后是末次 release）**——evict 事件即记账证明：

```ts
emit release { refs: 0 }               // 先发（决策 G：相邻 release 间 1-tick 推进保持）
await handle.release()                 // 若记账已完成：maybeEvict 同步驱逐 → destroyed 监听同刻发 evict
await waitFor(() => evictSeen.has(docKey), FILE_WAIT_MS, `file-settle-timeout:${docId}:g${gen}`)
//   ↑ maybeEvict 只在记账 finally（或 clean 的 release 路径）执行——延迟 evict ⟹ finally 已运行；
//     同刻不变式：等待期间虚拟时钟不推进 → evict t 与 release t 同刻（§5 钉死 1002/2009 保持）
```

refs>0 的中间 release 无需等待：`maybeEvict` 的 `handles.size>0` 前置使 release 行为与 flushing 状态无关，且 release 间 1-tick 推进无计时器可弹。

**顺序规则与前置条件（实现纪律，防误用；R3 补 R2-2 前置）**：

1. **放置规则**：A-arming 必须紧随其后置 saveDoc，**不得**做成独立的 post-advance 等待——无后续脏写的窗口在记账完成后没有任何计时器武装，孤立的 `pending>base` 等待必然超时（R2 原型实测定位，§13 P23；SA2 R2 原型 B 恢复腿复证 pending=0）。
2. **（R3，R2-2a）净零武装前置**：A-arming 基线期间该 doc **无既存未决 debounce/maxDirty 计时器对**——即**每脏写窗口恰一次 saveDoc 后必 advance 到 flush**。反例边界：同一 doc 在一个 debounce 窗口内二次 saveDoc 时，`scheduleFlush` 对已存在的 debounce 计时器 clear+set **净零**、maxDirty 已存在不新增（lifecycle.ts:401-403）→ pending 不增 → A-arming 超时。当前场景 S1/S4 均满足（每窗口一写一推）；**未来场景编辑（如「连续两次标脏验证 debounce 合并」）须先为 A-arming 更换信号**（如 per-doc 计数观察口），不得沿用 pending 基线。
3. **（R3，R2-2b）时钟内省契约**：`pending()` 语义见 §6.3 ProbeClock 声明（**已触发已删除的计时器不计**——SA6 FakeTimer 与自建时钟同语义，是本节全部基线算术成立的前提）。

**失败注入（不变，V7/P9）与降级腿基线（R3，R2-1 修正）**：外科式 `mkdir users/<owner>/doc-degraded.snapshot.tmp` → 在途 flush 的 `writeFile(tmp)` 得 EISDIR → degraded。降级腿的结算判据按「**触发动作返回点的同步基线**」统一：

- **首次失败腿（n≥1）**：主信号 = `waitFor(status === 'persistence-degraded')`（原子性引理推论 ①，翻转即记账完成，**完备**）。若实现选择叠加 `pending` 联言作纵深防御，**base 必须取 `advanceBy` 返回瞬间**——advance 已同步消耗到期的 debounce+maxDirty（base=0），记账完成后仅剩 retry 计时器（pending=1 → `1>0` ✓）。R2 原文「base 取 advance 前」是**错误公式**：base=2（debounce+maxDirty）→ 记账后 pending=1 → `1>2` 恒假——照字面落地 file n=1 **每跑必超时（确定红，非 flaky）**（SA2 R2 原型 B 三组算术实证，§13 P24）。
- **中间失败腿（n≥2，状态不翻转——status 持续 degraded，无翻转信号）**：信号 = `waitFor(pending > base)`，**base 同样取 `advanceBy` 返回瞬间**（advance 已消耗上一支 retry 计时器 → base=0；记账 catch 重排下一支 retry → pending=1 → `1>0` ✓）。R2 原文「base 取 advance 前」在此同样恒假（base=1 → `1>1`）——**file 通道 n≥2 中间失败腿将无任何可用信号**，是对「任意 n 确定」承诺（R1 攻击点 4）在 file 通道上的回归。修正后该腿恢复正确信号。
- **恢复腿**：**删除 `pending` 联言，只用 `waitFor(status === 'ready' && rev 达标)`**——status 翻转依原子性引理已是完备记账证明；且恢复时 `saved===dirty`，记账 finally **不重排任何计时器**（lifecycle.ts:444 条件不满足）→ 记账后 pending=0，任何 `pending>base` 联言**恒假必超时**（SA2 原型 B：`恢复后 pending = 0`）。

**R2 修复后的完整窗口协议（file 通道每一步；R3 已按 R2-1 修正基线）**：

| 场景步 | 协议 |
|---|---|
| 脏写→flush→（后续还有脏写） | saveDoc → **A-arming**（base=saveDoc 前快照）→ advance → **W** → flush 事件 |
| flush→末次 release | **W** → flush 事件 → releases（中间无等待）→ 末次 release → **A-evict** |
| 重载验新实例（S1 h4） | A-evict 通过后才 `loadDoc`（保证 cache miss → 新实例，否则会拿到未驱逐的旧 live doc） |
| S4 首次失败腿（n≥1） | advance → waitFor(status degraded [&& pending>baseAdvance])（baseAdvance=advanceBy 返回瞬间，=0）→ flush ok=false + degraded（原子性引理①） |
| S4 中间失败腿（n≥2） | advance → waitFor(pending > baseAdvance)（baseAdvance=advanceBy 返回瞬间）→ flush ok=false + degraded（retry 重排即记账完成，状态无翻转故以此为唯一信号） |
| S4 恢复腿 | unblock → advance(delay) → waitFor(status ready && rev 达标)（**禁止叠加 pending 联言**——恢复后 pending=0，联言恒假，P24）→ flush ok=true + recovered（原子性引理①） |

**（R3，R2-3）status 谓词的实例级前置声明**：`getStatus()` 是**实例级**信号（任一 cell degraded 即整体 degraded）——失败/恢复腿的翻转谓词隐含前置「**当前唯一 degraded 源是本 doc** + **降级窗口串行**」。当前场景恒成立：S4 是唯一降级源、探针全程持 handle、窗口串行执行、degraded entry 不可能被驱逐清空（`maybeEvict` 的 `saved!==dirty` 前置保证 degraded ⇒ dirty ⇒ 不驱逐）。**未来扩展警示**：多 doc 并行降级场景会使翻转谓词失真（A 的降级掩盖 B 的恢复）——届时需 per-doc 状态信号，属内核公共面演进，须另行 ADR/设计评审，不得在本协议内静默修补。

**（R1，攻击点 6）`probe-failed` reason 封闭词表**：`waitFor` 超时与场景异常的 reason **不得**内插 `err.message`（EISDIR/ENOENT 等系统文本含绝对路径）或 rootDir——失败 record 与成功 record 同受 §8「无环境痕迹」禁令约束。reason 取自封闭枚举：

| reason 模式 | 触发 |
|---|---|
| `file-settle-timeout:{docId}:g{generation}` | file 通道任一结算等待（W/A-arming/A-evict）5s 真实超时 |
| `status-divergence:{docId}` | 事件推断的 degraded/recovered 与 `getStatus()` 互检不一致 |
| `scenario-error:{step}` | 场景步骤抛出非预期异常（step ∈ S1-create/S1-flush/…/S4-recover 等固定步名） |
| `service-identity` | `requireDocPersistence(profile.ctx) !== profile.persistence`（决策 A 自检） |
| `clock-not-drivable` | 决策 D：传入 timer 缺 `advanceBy`（探针启动即拒，不产生 record） |
| `io-read-error:{docId}` | 提交态快照读取/解码失败（非 ENOENT） |

原始错误对象走结构化出口（CLI stderr / `runPersistenceProbe` 的 console.error + `ok:false`），**永不进入 record**。

**真实性边界声明**：file 通道的 flush 观察是「调度边界 + 提交态效果」级（观察到的是每次 flush 的最终结果，而非写调用本身）；memory 通道是写调用级。两级粒度都以公共语义为准（`.snapshot` 是唯一提交态），记录格式相同，不影响任何 AC 断言（两通道的事件 t 同刻度）。R2 协议不改变这一粒度声明，只把「结算完成」的判据从磁盘可见升级为记账完成的可证信号。

### §6.3 时钟模块

```ts
// （R3，R2-2b）pending() 是 A-arming / advance 驱动腿依赖的时钟内省面（§6.2 基线算术的前提）：
// 返回当前已武装、未到期的计时器个数；**已触发已删除的计时器不计**（触发即从登记表移除）。
// SA6 FakeTimer（timers Map 触发即 delete）与自建时钟必须同语义——否则 §6.2 的
// 「advanceBy 返回瞬间 base=0（到期计时器已同步消耗）」基线算术不成立。
export interface ProbeClock extends PersistenceTimer {
  advanceBy(milliseconds: number): Promise<void>
  pending(): number
}

export function createDeterministicClock(): ProbeClock {
  // 机制与 persistence testkit createTestTimer 同族（testing.ts:100-132）：到期序触发回调，
  // 每次触发后与 advance 收尾各排空若干微任务；now 从 0 起（AC2 flush.t ≥ 500 断言的基准）。
  // （R1，攻击点 7 勘误：testkit 实际每轮排空 3 个微任务（testing.ts:126/129），R0 误写为 8；
  //   自建时钟的每轮排空数是探针自选实现参数，真正的结算兜底不依赖它——
  //   探针在每个 advanceBy 之后统一 settle(32)，file 模式另有真实等待（§6.2）。）
  // pending() 语义：武装未到期计数；advanceBy 触发回调前先从登记表移除该计时器（已触发已删除不计）。
}
async function settle(ticks = 32): Promise<void> { for (let i = 0; i < ticks; i++) await Promise.resolve() }
```

调用方传入的 timer 缺 `advanceBy` → `TypeError`（决策 D）；**（R3）adapter 为 file 时还要求 `pending` 可内省**（缺 → 启动即 `TypeError`，同 loud-reject 语义——无内省则 §6.2 基线协议不可实现；memory 通道不依赖 pending，不作要求）。

## §7. 模块设计与公共面

新包 `packages/dsh-persistence/`（SA6 脚手架已就位，依赖已装）：

| 模块 | 职责 | 预估行数 |
|---|---|---|
| `src/profile.ts` | `createDshPersistenceProfile` + `DshPersistenceProfileOptions`/`DshPersistenceProfile`；决策 A/E/F | ~110 |
| `src/clock.ts` | `ProbeClock`、`createDeterministicClock`、`settle`、`waitFor`（file 通道真实等待） | ~90 |
| `src/events.ts` | `ProbeEvent` 判别联合（12 成员，全带 `t/owner/docId`）+ `ProbeRunOptions`/`ProbeRunResult` 类型 | ~70 |
| `src/record.ts` | `renderProbeRecord(events): string` 纯函数（§8 规范） | ~80 |
| `src/probe.ts` | `runPersistenceProbe`：场景脚本 S1–S4 + 双观察通道 + 自检（§6/§5） | ~380 |
| `src/cli.ts` | 参数解析 + 探针调用 + stdout/stderr/退出码（§8） | ~100 |
| `src/index.ts` | 聚合 re-export：`createDshPersistenceProfile`、`runPersistenceProbe`、`ProbeClock`、`createDeterministicClock` 及全部类型 | ~40 |

**`ProbeEvent` 类型（与简报 §2 逐字对齐）**：

```ts
interface ProbeEventBase { readonly t: number; readonly owner: string; readonly docId: string }
export type ProbeEvent =
  | ProbeEventBase & { type: 'create'; handle: string; docInstance: string }
  | ProbeEventBase & { type: 'load'; handle: string; docInstance: string }
  | ProbeEventBase & { type: 'dirty'; generation: number }
  | ProbeEventBase & { type: 'flush'; generation: number; ok: boolean }
  | ProbeEventBase & { type: 'release'; refs: number }
  | ProbeEventBase & { type: 'evict' }
  | ProbeEventBase & { type: 'observed'; metaDocId: string; entries: readonly string[]; rootKeys: readonly string[] }
  | ProbeEventBase & { type: 'degraded' }
  | ProbeEventBase & { type: 'write-rejected' }
  | ProbeEventBase & { type: 'recovered' }
  | ProbeEventBase & { type: 'duplicate'; code: string }
  | ProbeEventBase & { type: 'meta-mismatch'; expected: string; actual: string }
```

**profile 伪代码**：

```ts
export function createDshPersistenceProfile(options: DshPersistenceProfileOptions): DshPersistenceProfile {
  // 决策 E：全部配置冲突在此 loud-reject
  switch (options.adapter) {
    case 'memory':
      if (options.rootDir !== undefined) throw new TypeError('rootDir is only valid with adapter "file"')
      // ★ R1 勘误（实证 §13 P18）：memoryIo 是 DSH profile 的选项形状（简报 §2），
      //   MemoryPersistenceOptions 的注入缝是【顶层】 writeSnapshot/readSnapshot 字段——
      //   直接把 memoryIo 对象透传给插件工厂会被静默忽略（原型实测 hook 从不触发、writes=0）。
      //   profile 必须展平；exactOptionalPropertyTypes 下用条件展开，不传 undefined 键。
      plugin = createMemoryPersistencePlugin({
        ...(schedule !== undefined ? { schedule } : {}),
        ...(timer !== undefined ? { timer } : {}),
        ...(options.memoryIo?.writeSnapshot !== undefined ? { writeSnapshot: options.memoryIo.writeSnapshot } : {}),
        ...(options.memoryIo?.readSnapshot !== undefined ? { readSnapshot: options.memoryIo.readSnapshot } : {}),
      })
      break
    case 'file':
      if (options.memoryIo !== undefined) throw new TypeError('memoryIo is only valid with adapter "memory"')
      if (typeof options.rootDir !== 'string' || options.rootDir.length === 0)
        throw new TypeError('adapter "file" requires a non-empty rootDir')
      plugin = createFilePersistencePlugin({ rootDir, schedule, timer })
      break
    default:
      throw new TypeError(`unknown adapter ${JSON.stringify(options.adapter)}: expected "memory" or "file"`)
  }
  const ctx = new Context()
  plugin.apply(ctx)
  const persistence = plugin.instance!   // apply 同步建实例并注册 service；随后 instanceof 自检，null → throw（loud）
  return {
    ctx,
    persistence,
    getStatus: () => persistence.getStatus(),
    dispose: async () => { /* 决策 F 顺序 + 幂等 */ },
  }
}
```

**（R1，攻击点 5）探针 service 消费**：`runPersistenceProbe` 开场 `const svc = requireDocPersistence(profile.ctx)`，全部场景调用经 `svc` 发出，`svc === profile.persistence` 自检（决策 A）。

**探针 teardown 纪律**：场景全部结束后，先移除全部 `destroyed` 监听并置 `scenarioActive=false`（dispose 销毁 live doc 不再误发 evict），再 `await profile.dispose()`（finally 路径保证异常时也执行）——AC6 的「监听器/timer/cache 无残留」在探针侧同样成立。

## §8. 记录（record）与 CLI 规范

### 记录渲染（确定性硬规范）

每事件一行，行序 = 事件序；`t` 为虚拟时钟刻度；**禁止**出现墙钟时间戳、rootDir 绝对路径、pid、随机数。行格式（`{}` 为插值）：

| type | 行 |
|---|---|
| header | `# dsh persistence probe` / `# adapter={memory\|file} schedule=debounceMs:{n},maxDirtyMs:{n} failFirstFlushes:{n}` |
| create | `create {owner}/{docId} handle={h} instance={d} t={n}` |
| load | `load {owner}/{docId} handle={h} instance={d} t={n}` |
| dirty | `dirty {docId} generation={g} t={n}` |
| flush | `flush {docId} generation={g} ok={true\|false} t={n}` |
| release | `release {docId} refs={r} t={n}` |
| evict | `evict {docId} t={n}` |
| observed | `observed {owner}/{docId} entries={E} metaDocId={m} rootKeys={k1,…} t={n}` |
| degraded | `degraded {docId} t={n}` |
| write-rejected | `write-rejected {docId} t={n}` |
| recovered | `recovered {docId} t={n}` |
| duplicate | `duplicate {owner}/{docId} code={c} t={n}` |
| meta-mismatch | `meta-mismatch {owner}/{docId} expected={e} actual={a} t={n}` |
| 失败尾行 | `probe-failed {reason}`（仅 ok=false 时） |
| 尾行 | `probe ok={true\|false} events={count}` |

要点：`entries` 以固定规范序 `SCHEMA,META,ROOT` 渲染（多余条目按字典序追加），`rootKeys` 字典序——排序消解 Yjs share 插入序差异（AC3 记录断言 `entries=SCHEMA,META,ROOT` 逐字符匹配）。owner/docId 前缀的分布严格按 §5 表（create/load/observed/duplicate/meta-mismatch 带 owner；调度类事件只带 docId）——由 SA6 断言字符串反推固定，不可自由发挥。全部 12 个 SA6 记录断言子串已逐一对照通过（§5 推演）。

**（R1，攻击点 3）generation 语义补则**：degraded 后 retry **成功**的 flush 行，其 generation 与首发失败行**相同**（同代重试；`saveCounters` 仅在 saveDoc resolve 后递增，见决策 C/§6.1）；`dirty { generation=n+1 }` 行必然出现在 `recovered` 之后（恢复可写证明的 saveDoc 才是第 n+1 次成功调用）。此二条把 record 的 generation 语义钉死为跨实现确定（SA2 红线测试 #3 的锚，实证 §13 P16）。

**（R1，攻击点 6）`probe-failed {reason}` 词表**：reason 取自 §6.2 的封闭枚举，不含 `err.message`/绝对路径；「无环境痕迹」禁令（无墙钟、无 rootDir、无 pid）对成功与失败 record **一律**适用；原始错误对象走 stderr/结构化出口。

### CLI

```
pnpm exec tsx packages/dsh-persistence/src/cli.ts --adapter <memory|file> [--rootDir <dir>] [--fail-first-flushes <n>]
```

- 成功：record → stdout，退出码 0（`result.ok=false` → 退出码 1 + stderr 尾因）。
- `--adapter file` 缺 `--rootDir` → stderr（含 `rootDir`）非零退出；未知 adapter → stderr（含 `adapter`）非零退出；`--fail-first-flushes` 非非负整数 / 未知 flag / 缺 `--adapter` → stderr 用法提示 + 非零退出（沿用 vfsl-codegen CLI 的退出码纪律：0 成功 / 1 领域失败 / 2 用法错误）。
- file 模式 CLI **不清理 rootDir**（快照是 AC8 要的可观察副作用）；探针内部 profile.dispose 不删已提交快照（内核 dispose 只清缓存/计时器）。
- CLI 内部：自建 `createDeterministicClock()`；file 通道真实等待在进程内完成（记录不含等待痕迹）→ 同参两跑逐字节一致（AC8）。

## §9. SA6 红灯测试缺陷：三条不可满足断言（阻塞项，实证 + 修复配方）

> 均在**已实现且全绿**的 P1–P3 代码上以 SA6 逐字复刻的 FakeTimer 实测（证据编号见各缺陷，命令与输出见 §13）。结论：这不是实现缺口，是测试的时序/语义假设缺陷；按简报 §2「SA6 固定，改动须与 SA6 协调」条款走总控→SA6 通道。修复均为**测试基础设施性质**（插入等待/推进/断言序调整），断言的目标值一字不改。
>
> **R1 状态**：缺陷 1/2 已由 SA6 按配方落盘（commit 657b877；`settleRealIo` 助手 + AC4-file 两处等待 + AC6 dispose 前推进；SA2 复核「实证与修复配方复核无误」，SA8 专项裁决 no-conflict）。**缺陷 3 为 R1 新增（SA2 攻击点 1），待总控协调 SA6 R2。**

### 缺陷 1：AC4 service 级 file 用例——真实 I/O 不在微任务里结算【已落盘 ✅】

- **断言链**：`saveDoc` → `await timer.advanceBy(debounceMs)` → **立即** `expect(profile.getStatus()).toBe('persistence-degraded')`。
- **实测（§13 P5）**：FakeTimer 的 `advanceBy` 只排空微任务（每 callback 2 次 `await Promise.resolve()`）；flush 的 `fsp.mkdir/writeFile/rename` 在 libuv 线程池结算，需要真实事件循环轮转。复刻输出：`T+0 advance 返回后立刻 getStatus: ready`；直到 `setImmediate` ×5 后才 `persistence-degraded`。恢复侧断言同理。
- **不可满足性证明（实现侧无解）**：任何正确实现都无法让真实文件 I/O 在纯微任务排空内完成——除非给 `FilePersistence` 写路径加同步预检（改 P3 生产代码 + 语义错误）或包装调用方 timer（外部 flush 协调器，违反 ADR）。
- **修复配方（已实证）**：在每个 `advanceBy(...)` 与 `getStatus()` 断言之间插入 `settleRealIo()`。
- **落盘核验（R1）**：测试文件 371/377 行已插入两处 `settleRealIo()`，断言目标值 `toBe('persistence-degraded')` / `toBe('ready')` 原样（SA8 报告核对同）。

### 缺陷 2：AC6 用例——dispose 前的脏数据从未提交【已落盘 ✅】

- **断言链**：`createDoc` → `ROOT.rev=1` → `saveDoc` → `expect(timer.pending()).toBeGreaterThan(0)` → `await profile.dispose()` → reload 后 `expect(loaded.doc.getMap('ROOT').get('rev')).toBe(1)`。
- **实测（§13 P6）**：内核 dispose 语义 = 清计时器 + abort I/O + 销毁 doc（**不 flush 未决脏数据**；release 也不触发 flush——`maybeEvict` 的 clean 前置使其只驱逐已保存项）。复刻输出：`AC6 reload rev = undefined`。
- **不可满足性证明（实现侧无解）**：让 rev=1 落盘需在 dispose 前让 debounce 到期——profile 无法替调用方推进其 timer；改内核 dispose 加 flush-dirty = 改 P3 行为契约（DENY）。
- **修复配方（已实证，§13 P7）**：dispose 前插入 `advanceBy(debounceMs)` + `settleRealIo()`。
- **落盘核验（R1）**：测试文件 400–401 行已按配方插入（R1 注释注明出处），`rev === 1` 断言原样。

### 缺陷 3：AC1 memory 用例——release 后 loadDoc 同实例断言与内核驱逐语义冲突【R1 新增，待协调 ⛔】

> SA2 攻击点 1 揭出；SA1 独立复核成立并补齐实证（R0 盘点表误判「✓ 可满足」——该行结论已在下方盘点表更正）。

- **断言链**（`dsh-profile-acceptance.test.ts:129-132`）：`createDoc` → `await handle.release()` → `loadDoc` → `expect(loaded!.doc).toBe(doc)`。
- **内核行为（源码级）**：该用例 createDoc 后**没有 saveDoc**，entry 处于 `savedGeneration(0) === dirtyGeneration(0)` 的 clean 态；唯一 handle release 时 `maybeEvict`（lifecycle.ts:463-469）三前置全过 → **同步驱逐并 `doc.destroy()`**（销毁的是调用方传入的 doc 实例）；随后的 `loadDoc` 走 store 路径从 mirror 还原**新 Y.Doc 实例**。
- **实测（§13 P13）**：`V8 release 后 doc.isDestroyed: true`；`V8 loaded.doc===doc: false（SA6 断言要求 true）`；新实例内容等价（title/META.docId 还原正确）。
- **这是 P2/P3 既定契约而非实现巧合**：P2 内核测试 `memory-persistence.test.ts:366` 明文 `expect(restored!.doc).not.toBe(oldDoc)`（release→advance→restore 是新实例）；ADR-0006「引用归零仅使缓存项成为可驱逐候选……仅在保存成功、缓存/空闲策略满足后才真正释放实例」与 AC5「release 后由持久层内部决定真实 evict」正是该语义。本设计 §5 S1（load h4 得新实例 d2）与 AC5 推演**依赖**同一语义——AC1-memory 的这条断言与 AC2/AC5/AC6 的语义锚点**互相矛盾**。
- **不可满足性证明（实现侧无解）**：让 `loaded.doc === doc` 成立只有两条邪路——(a) profile 偷持 phantom handle 抑制驱逐：直接打翻 AC2（`evicts.length>=2` 需要真实驱逐）、AC5、AC6（dispose 后 `isDestroyed`）与 ADR 驱逐条款；(b) 改内核 `maybeEvict` 对 clean 态不驱逐：推翻 P2 契约（P2 测试锚定）+ 让 Y.Doc cache 永不释放，违反「dispose 时释放……Y.Doc 缓存」。两条均为 §9 已排除的黑帽类别。
- **修复配方——修法 A 与修法 B 的取舍（R1 选定 B）**：
  - **修法 A（对齐驱逐语义）**：删同实例断言，改 `expect(loaded!.doc).not.toBe(doc)` + 内容等价断言 + `expect(doc.isDestroyed).toBe(true)`。
  - **修法 B（对齐 cache-hit 语义，选定 ✅）**：把 `loadDoc` 提到 `release` 之前（cache-hit 路径，同 live 实例），断言集原样保留：
    ```ts
    const handle = await profile.persistence.createDoc(owner, 'doc-alpha', doc)
    expect(handle.doc).toBe(doc)
    expect(handle.owner).toBe(owner)
    expect(handle.docId).toBe('doc-alpha')
    const loaded = await profile.persistence.loadDoc(owner, 'doc-alpha')   // ← release 之前：cache-hit
    expect(loaded).not.toBeNull()
    expect(loaded!.doc).toBe(doc)        // 断言目标值原样：共享 live Y.Doc（ADR「共享 doc，独立 handle」）
    expect(loaded).not.toBe(handle)      // （建议新增）独立 lease
    await loaded!.release()
    await handle.release()
    expect(doc.isDestroyed).toBe(true)   // （建议新增）反黑帽守卫：双 release 后无 phantom handle
    expect(timer.pending()).toBe(0)      // （建议新增）无残留计时器
    ```
  - **选 B 的论证**：① **断言语义零反转**——原断言 `toBe(doc)` 的意图（同一 live 实例）在 cache-hit 路径下为真，原样保留；修法 A 则把断言方向反转（`not.toBe`），改动更大。② **覆盖净增益**——「共享 doc、独立 handle」的 cache-hit 语义在 service 级目前**无任何其他用例覆盖**（AC2 只经探针事件间接覆盖）；驱逐/新实例语义已被 AC2（`instanceCounts.size>=2`）、AC5、AC6（reload `not.toBe`）三方锚定，修法 A 只会造成重复覆盖并丢失 cache-hit 断言。③ **反黑帽守卫原生嵌入**——尾部 `isDestroyed`/`pending()===0` 两断言使 phantom-handle 黑帽立即爆红。修法 B 的可满足性已实测（§13 P14：cache-hit `toBe(doc)` ✓、独立 handle ✓、双 release 后 `isDestroyed` ✓、`pending===0` ✓）。

### 其余 SA6 用例可满足性盘点（R1 逐行挂证据；R2 修订两行）

| 用例 | 结论 | 证据（§13） |
|---|---|---|
| AC1 memory（service 级） | ✓（缺陷 3 修法 B **已落盘**，SA6 R2；当前全绿——SA7 40/40 文件、535/535 测试） | P13（证伪）+ P14（修法 B 配方验证）+ SA7 Step1 全绿 |
| AC1 file / AC3 file（service 级） | ✓ 可满足（existsSync 由 create-commit 落盘保证，loads 走 live cache） | P8 |
| AC2/AC3/AC4 probe 级（memory + SA6 FakeTimer） | ✓ 可满足（逐字 FakeTimer + settle(32) 协议下 S1/S3/S4 全事件序列实测与 §5 时间线一致） | P16（+P3 机制级） |
| AC4 service 级 memory（memoryIo 注入） | ✓ 可满足（**精确深度核算**：async hook 失败链 = hook(无 await, 同步 throw→rejected promise) → memory-write await 恢复 hop1 → flush await 恢复 hop2 → `degraded=true`，恰在 SA6 FakeTimer 每 callback 2 微任务 + 收尾 2 微任务之内；恢复链同为 2 hop。逐字复刻实测：advance 后**立即** `persistence-degraded` ✓ → saveDoc 拒绝 ✓ → retry advance 后立即 `ready` ✓ → 恢复可写 resolve ✓） | P15 |
| AC4 service 级 file（修复后） | ✓ 可满足（`settleRealIo` 已落盘；真实结算后 degraded→拒绝→解除→ready 序列实测通过） | P5（T+2 证 degraded 需要 setImmediate 轮转）+ P9（解除→恢复）+ 落盘核验 |
| AC6（修复后） | ✓ 可满足（advance+settle 已落盘；`rev===1` 配方实测通过，其余断言 P8 逐项通过） | P7（配方）+ P6（原始证伪）+ 落盘核验 |
| CLI 全部 7 用例 | **（R2 修订）用例本身 ✓（当前绿）；但其守护目标「file 双跑逐字节一致」曾被 SA7 证伪**（P19：症状下双跑同形态 flake → 相等性成立而失明——非用例可满足性问题，是判别力问题）。R2 协议修复后确定性恢复；持续守卫由 SA7 锚 `dsh-file-probe-determinism.test.ts`（精确 events=28 + 三跑逐字节一致）承担，不依赖 CLI 用例的相等性抽查 | P19（证伪与机理）+ P22/P23（R2 修复实证）+ P11/P12 |
| core-dsh-boundary 绿色守卫 | ✓ 保持绿色（本设计零触碰 `packages/persistence`） | P2 + P12（当前绿色事实） |

**（R1，攻击点 2）盘点纪律**：上表每行必须挂 §13 证据编号；本轮无「未验证」行。后续修订若新增无证据结论，必须显式标注「未验证 + 风险等级」——SA4 静态门禁可将「§9 行 ↔ §13 行可对号」列为检查项（SA2 红线测试 #2）。

**（R2）SA7 动态验证结论对照**：SA6 红灯验收面全绿（40/40、535/535）；F1 evict 去重回归 ✓；失败 record 纯度 ✓（封闭词表生效）；CLI 退出码矩阵 ✓（0/1/2）；并发余量 ✓（16×）；yjs destroyed 跨 node 版本一致 ✓（24/25.6.0，node 20 待 CI）。**唯一 fail-needs-fix = F-FILE（P1）**，即 §6.2 R2 重写对象；F-REJECT-LEAK（LOW）处置见 §11。

## §10. AC 与冲突门禁提示映射表

| 验收条款 / 提示 | 设计落点 |
|---|---|
| AC1 双 Adapter 同一 contracts | 决策 A（唯一分支点在 profile 装配）；file 用例 ✓（P8）；**memory 用例含不可满足断言 → §9 缺陷 3（R1 新增，修法 B 待协调；P13/P14）** |
| AC2 load→saveDoc→调度 flush→release；重复 load | §5 S1 时间线；决策 G/H；逐字 FakeTimer 实测（P16） |
| AC3 隔离 + META 校验 + 三条目 | §5 S1/S2/S3；`observed` 渲染规范序；P16 |
| AC4 降级全记录 | §5 S4（含任意 n 退避循环）；§6.1/§6.2 双通道；§9 缺陷 1（已落盘）；service-memory 深度核算 P15、n=2 实测 P17 |
| AC5 引用归零与最终释放 | 决策 C（refs 记账）+ `destroyed` 事件（P1）；P16 |
| AC6 dispose 卫生 | 决策 F + 探针 teardown 纪律；§9 缺陷 2（已落盘，P7） |
| AC7 核心不 import DSH | DENY `packages/persistence/src/**`；绿色守卫不触碰；依赖方向 dsh→persistence 单向 |
| AC8 可复制命令+记录 | §8 记录规范（无环境痕迹）+ CLI；AC8 用例 ✓ |
| 提示 1 createDoc 排他创建 | S1/S2/S4 全走 `createDoc`；无首个 saveDoc 建档 |
| 提示 2 安全文法 | 场景标识全部 `user-a`/`user-b`/`doc-alpha`/`doc-degraded`（合规） |
| 提示 3 无外部 flush 协调器 | 探针只推进时钟（触发内部调度）+ 观察；无强制 flush 命令面；决策 I 拒绝包装 timer |
| 提示 4 degraded 观测面 | 经 `saveDoc` 拒绝路径（write-rejected）+ `getStatus()`（file 通道）观察 |
| 提示 5 条目命名 | `SCHEMA`/`META`/`ROOT`（ADR-0006 布局） |
| ADR-0002 authority 排除 | 探针零 authority 语义，仅观察持久化行为 |
| ADR-0001 schema fixture | 探针构造的 SCHEMA 信封是测试 fixture 运行时数据，不入仓 |

## §11. 风险与边界

| 风险 | 处置 |
|---|---|
| SA6 FakeTimer 微任务深度不足（每 callback 2 hop） | flush 链 ≤3 hop；探针每次 advance 后 `settle(32)` 独立兜底；逐字 FakeTimer 全场景实测通过（P16）；AC4-service-memory 精确 2-hop 核算 + 实测（P15） |
| file 通道真实等待超时（慢盘/CI） | `waitFor` 5s 真实上限 → `probe-failed:file-settle-timeout:{docId}:g{gen}` + `ok=false`（loud，不静默）；CLI 非零退出 |
| 探针场景中途异常 | finally 保证 `profile.dispose()`；`probe-failed:scenario-error:{step}`（封闭词表 §6.2）+ `ok=false`；不吞栈 |
| 事件归属用 `\u0000` key 解析（memory 通道） | 该格式是 memoryIo 公共回调参数的既定事实（lifecycle `toKey`、file.ts `resolveSnapshotPaths` 同款解析先例）；解析失败 → `probe-failed`（loud） |
| `plugin.instance` 非空断言 | apply 同步建实例（P2/P3 工厂实现事实）；设计在 apply 后立刻 `instanceof` 自检，null → throw（loud） |
| **（R1 新增）`memoryIo` 透传形状错误**：直接把 `memoryIo` 对象传给 `createMemoryPersistencePlugin` 会被 `MemoryPersistenceOptions` 静默忽略（注入缝是顶层 `writeSnapshot`/`readSnapshot` 字段） | profile 展平透传（§7 伪代码勘误）；原型反证见 §13 P18（嵌套传法实测 hook 从不触发）；`exactOptionalPropertyTypes: true` 下条件展开，不传 `undefined` 键 |
| root package.json `typecheck` 脚本需纳入新包 | 追加 `&& tsc -p packages/dsh-persistence/tsconfig.json`（CI `pnpm typecheck` 覆盖新包；ALLOW LIST 内） |
| 双跑记录不一致 | 记录只含虚拟 t + 固定场景序 + 固定发号 + `probe-failed` 封闭词表；Map 遍历序由排序规范消解；**R2：file 通道 libuv 交接竞争（P19）已由两阶段结算协议封死（P22/P23）**；SA7 锚持续守卫 |
| **（R2，SA7 F-FILE）file 通道「磁盘可见 ≠ 记账完成」竞争**：`fs.readFileSync` 可早于线程池→事件循环交接看到提交态 → 提前 advance 撞单飞锁重排（症状 B）/ release 早于 `maybeEvict` + teardown 拆监听（症状 A 静默失真） | §6.2 R2 两阶段结算协议：条件 W（磁盘）+ 条件 A（A-arming 武装不变式 / A-evict 记账 finally 信号 / 原子性引理 status 翻转），全部内核公共面信号，DENY 零改动；虚拟刻度不变式保证 §5 钉死值不漂移；实证 P20（旧协议在确定性窗口下破碎）→ P21/P22/P23（新协议全吸收 + 双跑逐字节一致） |
| **（R2，SA7 F-REJECT-LEAK，LOW）**外部预阻塞 `.tmp` 下 `file.ts:96` 的 `fsp.rm(tmp, {force:true})` 对目录抛 EISDIR，某条 read-ticket promise 链泄漏 unhandled rejection 到进程层（不影响 record/退出码，SA7 双证据实测） | 归属分析：泄漏点在内核 read-ticket 记账链（`packages/persistence`，DENY 区）——`force` 只容忍 ENOENT 是否应扩展容忍 EISDIR 属 P3 行为策略，本设计**不越权处置**；探针侧自身 await 均已 catch（step catch → ProbeFailure），未放大泄漏。建议总控将其立为 P3 跟进项单独裁决（若需改 `file.ts` 即 DENY 例外）；探针的注入时序（`ensureBlocked` 在 create 之后）不命中该路径 |

## §12. 文件清单（File Scope）

### ALLOW LIST

- `packages/dsh-persistence/src/profile.ts` — 新建，DSH 装配 profile（决策 A/E/F，§7，~110 行）
- `packages/dsh-persistence/src/clock.ts` — 新建，`ProbeClock`/确定性时钟/`settle`/`waitFor`（§6.3，~90 行）
- `packages/dsh-persistence/src/events.ts` — 新建，`ProbeEvent` 联合与探针类型（§7，~70 行）
- `packages/dsh-persistence/src/record.ts` — 新建，确定性记录渲染（§8，~80 行）
- `packages/dsh-persistence/src/probe.ts` — 新建，场景脚本 + 双观察通道（§5/§6，~380 行）
- `packages/dsh-persistence/src/cli.ts` — 新建，AC8 命令入口（§8，~100 行）
- `packages/dsh-persistence/src/index.ts` — 新建，聚合导出（§7，~40 行）
- `packages/dsh-persistence/tsconfig.json` — 新建，镜像 `packages/persistence/tsconfig.json`（include src+test）
- `packages/dsh-persistence/test/dsh-file-probe-determinism.test.ts` — `[SA7 owned]` **R2 修订追加**：SA7 动态验证落盘的回归锚（file 通道确定性：精确 events=28 + 三跑/双 CLI 逐字节一致）；本任务 SA1/SA3 不改其断言，修复后必须稳定绿
- `packages/dsh-persistence/test/dsh-profile-acceptance.test.ts` — `[SA6 owned]` **须与 SA6 协调**的测试修订：缺陷 1/2 时序修复**已落盘**（commit 657b877）；**R1 修订追加**：缺陷 3（AC1-memory 修法 B，§9）待 SA6 R2 落盘——改动限于 loadDoc 位置调整 + 两条反黑帽守卫断言，`toBe(doc)` 断言目标值不变。SA3 仅可落协调后的最小修复，不得改断言值。**R2 状态更新：缺陷 3 修法 B 已由 SA6 R2 落盘（测试内 R2 注释），当前全绿**
- `packages/dsh-persistence/test/dsh-probe-cli.test.ts` — `[SA6 owned]` 无需改动（§9 盘点可满足）；列入 ALLOW 仅为覆盖其在 diff 中的存在（SA6 已创建）
- `packages/dsh-persistence/package.json` — SA6 脚手架已就绪（`dsh:probe` 已锚定）；预期零改动，列入以覆盖 diff
- `packages/persistence/test/core-dsh-boundary.test.ts` — `[SA6 owned]` SA6 新建的 AC7 绿色守卫（Phase 1 交付，已在工作区）；本任务零改动，列入以覆盖 diff，保持绿色
- `pnpm-lock.yaml` — SA6 `pnpm install` 产物，已在 diff；预期本阶段零新增改动
- `package.json`（根） — 修改，`typecheck` 脚本追加 `&& tsc -p packages/dsh-persistence/tsconfig.json`（1 处，§11 风险表）

### DENY LIST

- `packages/persistence/src/**` — 持久化核心插件：AC7 边界 + 本任务零改动（观察通道全部在 DSH 侧，决策 B）
- `packages/persistence/test/**` — P2/P3 既有套件保持原样；**唯一例外**：`core-dsh-boundary.test.ts` 为 SA6 新建绿色守卫（见 ALLOW，[SA6 owned]）
- `packages/vfsl/**`、`packages/vfsl-protocol/**`、`packages/vfsl-codegen/**` — 与本任务无关
- `domains/**`、`apps/**` — 与本任务无关
- `docs/adr/**`、`CONTEXT.md` — 无 ADR evolution/override 声明，零改动
- `vitest.config.ts`、`tsconfig.base.json`、`tsconfig.typecheck.json` — 全局配置：`packages/*` 通配已覆盖新包，零改动
- `packages/dsh-persistence/src/index.ts` 以外的公共导出新增（如装饰器/代理 service、强制 flush API）——决策 A/B/I 已排除，此处显式护栏

## §13. 协议假设依据 (Protocol Assumption Evidence)

> 全部验证于设计期在真实依赖/真实 P1–P3 代码上执行（tsx/node 直跑，原型脚本已从工作区删除，SA1 零源码改动）。

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险 |
|---|---|---|---|---|
| P1 | `Y.Doc` 在 `destroy()` 时发出 `'destroyed'` 事件（evict 观察通道） | 设计期实测验证 | 工作区内 `node` 脚本：`doc.on('destroyed', …); doc.destroy()` → 输出 `yjs destroyed event fired: true \| isDestroyed: true`（yjs@13.6.32） | 低 |
| P2 | Cordis：`new Context()` 可裸建；`ctx.provide(name, v)` 返回注销函数，调用后 `ctx.get(name)===undefined`；`await ctx.fiber.dispose()` 运行 `ctx.effect` 清理并注销 service | 设计期实测验证 + 现有测试引用 | 工作区内脚本输出：`get after cleanup: undefined`；`effect cleanup ran: true \| service after fiber.dispose: undefined`；另见 `packages/persistence/test/core-dsh-boundary.test.ts:31-49`（绿色）同款行为 | 低 |
| P3 | memory：`memoryIo.writeSnapshot` 钩子按 create-commit→flush→retry 顺序逐次触发；同步钩子下 flush 链在 FakeTimer 微任务深度内结算；钩子 throw → `persistence-degraded` + `debounceMs` 后 retry 恢复；reload-after-evict 得新实例（mirror 还原 rev=2）；全清后 `pending()===0` | 设计期实测验证 | 原型 V3（tsx，完整场景 S1+S4 于真实 `MemoryPersistence` + 类 SA6 FakeTimer）：输出含 `write#1 … create-commit`、`write#2 t=500 flush`、`write#2 … flush FAIL`、`status after failed flush: persistence-degraded`、`saveDoc rejected: persistence-degraded…`、`status after retry: ready`、`reload new instance: true, rev=2`、`pending timers after clean: 0` | 低 |
| P4 | evict 与三连 release 同虚拟时刻（必须 inter-tick 推进） | 设计期实测验证 | 原型 V3 输出：`evict t=1000` 与三个 release 同刻 → 决策 G 的必要性实证 | 低 |
| P5 | **SA6 AC4-file 断言不可满足**：真实文件 I/O 不在 FakeTimer 微任务排空内结算 | 设计期实测验证 | 原型 V4（SA6 FakeTimer 逐字复刻）：`T+0 advance 返回后立刻 getStatus: ready`，`setImmediate ×5` 后才 `persistence-degraded`；解除阻塞后 2 轮 setImmediate 仍 degraded | **高（阻塞测试）** |
| P6 | **SA6 AC6 reload rev 断言不可满足**：内核 dispose 清计时器不 flush 脏数据 | 设计期实测验证 + 源码引用 | 原型 V5：`AC6 reload rev = undefined`；源码 `lifecycle.ts:236-243`（dispose 清计时器+销毁，无 flush）与 `lifecycle.ts:463-469`（`maybeEvict` clean 前置） | **高（阻塞测试）** |
| P7 | AC6 修复配方有效（advance+真实结算后再 dispose） | 设计期实测验证 | 原型 V6：插入 `advanceBy(500)` + `settleRealIo()` 后 `AC6-fixed reload rev = 1` | 低 |
| P8 | AC1-file/AC3-file 现行断言可满足（existsSync 由 create-commit 落盘保证；loads 走 live cache） | 设计期实测验证 | 原型 V5：`AC1-file snapshot exists … true`；`AC3-file exists A/B: true true`；`AC3-file isolated: true alpha beta` | 低 |
| P9 | file 外科式失败注入：`.tmp` 路径占为目录 → `writeFile` EISDIR → degraded；解除 → retry recovered；不误伤同用户其他快照 | 设计期实测验证 | 原型 V7：`注入后 degraded: true`、`saveDoc 拒绝: persistence-degraded…`、`解除后 recovered: true`、`doc-alpha 快照仍在: true`、`doc-degraded 快照存在: true` | 低 |
| P10 | file dispose 后无指向 rootDir 的打开 fd | 设计期实测验证 | 原型 V3-B 段：`B fd leak into rootDir: false`（linux `/proc/self/fd` 检查） | 低 |
| P11 | tsx 可直接运行 TS 入口且内部 `./xxx.js` 说明符解析到 `.ts` | 类比已有 job 验证 | 根 `package.json` `generate` 脚本 = `tsx packages/vfsl-codegen/src/cli.ts`（CI 在跑），该 cli 内部 `import … from './collect.js'`（`packages/vfsl-codegen/src/cli.ts:19-20`）——与本 CLI 同构 | 低 |
| P12 | vitest 将 `../src/index.js`（自 `packages/*/test/`）解析到 `src/index.ts` | 现有测试引用 | `packages/persistence/test/core-dsh-boundary.test.ts:28` 同款导入当前绿色；vitest include `packages/*/test/**/*.test.ts` 已覆盖新包 | 低 |
| P13 | **（R1）SA6 AC1-memory 同实例断言不可满足**：clean entry（0===0）在唯一 handle release 时被 `maybeEvict` 同步驱逐销毁，随后 loadDoc 从 mirror 还原新实例（SA2 攻击点 1，SA1 独立复核） | 设计期实测验证 + 现有测试引用 | R1 原型 V8（tsx，真实 `MemoryPersistence` + 逐字 SA6 FakeTimer）：`V8 handle.doc===doc: true` / `V8 release 后 doc.isDestroyed: true` / `V8 loaded!==null: true \| loaded.doc===doc: false（SA6 断言要求 true）` / 新实例 `title='untitled'`、`META.docId='doc-alpha'` 内容等价；P2 契约锚点 `packages/persistence/test/memory-persistence.test.ts:366`（`expect(restored!.doc).not.toBe(oldDoc)`） | **高（阻塞测试，缺陷 3）** |
| P14 | **（R1）缺陷 3 修法 B 配方可满足**：loadDoc 前置到 release 之前 → cache-hit 同 live 实例 + 独立 handle；双 release 后驱逐销毁、无残留计时器（反黑帽守卫成立） | 设计期实测验证 | R1 原型 V9：`V9 cache-hit loaded.doc===doc: true \| 独立 handle: true`；`V9 双 release 后 doc.isDestroyed: true \| timer.pending: 0` | 低 |
| P15 | **（R1）AC4-service-memory 精确深度核算**：SA6 逐字 FakeTimer（每 callback 2 微任务 + 收尾 2）下，`advanceBy` 返回即可观察到 degraded/ready——失败链 hop 核算：测试 hook 为无 await 的 async 函数（同步 throw → 已 rejected promise）→ memory-write `await` 恢复（hop1）→ flush `await` 恢复（hop2）→ `entry.degraded=true`；恢复链同 2 hop | 设计期实测验证 | R1 原型 V10（逐字复刻 SA6 memoryIo hook `async () => { writes+=1; if (writes===2) throw }`）：`V10 首次 advance 后【立即】getStatus: persistence-degraded` ✓ / `saveDoc 拒绝 ✓: persistence-degraded: writes are rejected…` / `V10 retry advance 后【立即】getStatus: ready` ✓ / 恢复可写 saveDoc resolve ✓（writes=3）；P2 同构测试 `memory-persistence.test.ts:299-313` 在 3-排空 testkit 下绿色为旁证 | 低 |
| P16 | **（R1）探针骨架全场景（S1/S3/S4, n=1）在逐字 SA6 FakeTimer + settle(32) 协议下通过**：事件**相对时序**与 §5 钉死一致（fail@+500 → rejected 同刻 → retry 成功@+1000 → recovered 同刻 → 之后才 dirty g2；原型骨架场景间隔较 §5 表压缩，绝对刻度是实现细节，record 确定性只依赖固定场景序）；且 `saveCounters` 仅 resolve 递增（retry 成功渲染 `generation=1 ok=true`，`dirty generation=2` 在 `recovered` 之后）——攻击点 3 的记录语义锚 | 设计期实测验证 | R1 原型 V11 n=1 输出（节选）：`flush doc-alpha generation=1 ok=true t=500` / `flush doc-alpha generation=2 ok=true t=1000` / `release refs=2/1/0 t=1000/1001/1002` / `load 重载新实例=true rev=2 t=1003` / `duplicate code=DOC_DUPLICATE instanceof=true` / `meta-mismatch /META\.docId/=true` / `flush doc-degraded generation=1 ok=false t=1504` + `degraded` + `write-rejected` 同刻 / `flush doc-degraded generation=1 ok=true t=2004` + `recovered` 同刻 / `dirty doc-degraded generation=2 t=2004`（在 recovered 之后 ✓）/ `flush doc-degraded generation=2 ok=true t=2504` | 低 |
| P17 | **（R1）`failFirstFlushes=2` 通用退避循环**：探针自持退避镜像（500→1000，cap 5000）推进下，两条同 generation=1 的 `ok=false` 落在 +500/+1000 虚拟刻，成功落 +2000；任意 n 的 record 确定（攻击点 4） | 设计期实测验证 | R1 原型 V11 n=2 输出（节选）：`flush doc-degraded generation=1 ok=false t=1504` → `degraded t=1504` → `write-rejected t=1504` → `flush doc-degraded generation=1 ok=false t=2004` → `degraded t=2004` → `flush doc-degraded generation=1 ok=true t=3004` → `recovered t=3004` → `dirty generation=2 t=3004` → `flush generation=2 ok=true t=3504` | 低 |
| P18 | **（R1）`memoryIo` 展平事实**：`MemoryPersistenceOptions` 的注入缝是顶层 `writeSnapshot`/`readSnapshot` 字段；把 DSH 形状的 `memoryIo` 对象直接传给插件工厂会被静默忽略（R0 §7 伪代码的错误，已勘误） | 源码引用 + 设计期实测验证 | `packages/persistence/src/memory.ts:15-22`（`MemoryPersistenceOptions` 无 `memoryIo` 字段，`writeSnapshot`/`readSnapshot` 顶层）；R1 原型反证：嵌套传法实测 `writes=0`（hook 从不触发、saveDoc 直通、无 flush 事件），展平后 V10/V11 全链路通过 | 低（已勘误，实现照 §7 修订版伪代码） |
| P19 | **（R2）SA7 F-FILE 证伪**：file 通道结算谓词「磁盘提交态可见 ⟺ 内核 flush 记账完成」为假——`fs.readFileSync` 直读在 rename 落盘即见新内容，记账须经线程池→事件循环交接；52 跑 2 异常：症状 A（events=27、exit 0、evict 静默丢失——teardown 先拆监听）×1、症状 B（`file-settle-timeout:doc-degraded:g2`、exit 1——单飞锁早退 + flush 重排到无人推进的虚拟时钟）×1；memory 通道 20 跑 sha256 唯一不受影响 | SA7 动态验证（52 跑量化） | `task_dsh-persistence-inspector_sa7_report.md` F-FILE 节（命令 + 输出存档 /tmp/sa7-probe/*）；根因源码级定位 lifecycle.ts:431→:440→:449（记账）/ :419→:400（单飞锁早退）/ :444-447（重排） | **高（已由 R2 协议修复）** |
| P20 | **（R2）旧协议在确定性窗口下必然破碎**：memory 通道注入 30ms 真实延迟的 writeSnapshot 钩子 =「flush 事件已可观察 / io.write 记账未完成」的确定性窗口——旧协议（微任务排空 settle）下 advance 落在未武装的 debounce 上，flush 永不发生、evict 永不出现（`timeout:old-evict`）= 症状 B 机理的受控复现 | 设计期实测验证（R2 原型，真实 `MemoryPersistence`） | 原型输出：`旧协议（settle 排空）结果：✗ 破碎（timeout:old-evict）`；机理逐行吻合 lifecycle.ts:400（scheduleFlush 早退）+ :444-447（记账 finally 重排到虚拟时钟） | 低 |
| P21 | **（R2）新协议（A-arming/A-evict）在同一确定性窗口下完整吸收**：延迟 30ms 钩子下场景全链路完成，evict 落在钉死刻度 t=1002；插桩验证窗口内 `saveDoc → scheduleFlush 早退 → pending=0` → 30ms 后记账完成 → finally 武装 `pending=2` → advance 触发 flush g2 → release → evict | 设计期实测验证（R2 原型） | 原型输出：`新协议（arming/evict 等待）结果：["dirty g1","flush g1 observed","dirty g2","flush g2 observed","evict a1 t=1002"] —— 窗口被吸收 ✓`；分步插桩：`saveDoc g2 done（dirty g2）| pending = 0（flushing=true → scheduleFlush 早退）` → `arming 等待结束 | elapsed = 30 ms | pending = 2` | 低 |
| P22 | **（R2）file 通道并发竞争压测**：双探针同进程并发 × 1ms 高频轮询 × 25 对 = 50 跑，自然命中「磁盘先于记账」窗口 3 次，全部被新协议吸收（A-arming/A-evict 等待后继续），事件序不一致 0、失败 0 | 设计期实测验证（R2 原型，真实 `FilePersistence`） | 原型输出：`并发压测：50 跑 | 窗口命中 3 | 事件序不一致 0 | 失败 0 → 并发竞争下 0 失真 ✓` | 低 |
| P23 | **（R2）file 通道新协议确定性**：单进程连跑 60 次（每次全新 rootDir），record 逐字节一致（0 不一致），事件序与 §5/SA7 锚定形态逐行相同（含 `flush … g2 … t=2008`、`evict … t=2009`）；另实证顺序规则：孤立的 post-advance `pending>base` 等待（无后续脏写）在记账后无人武装，必然超时——A-arming 必须紧随后置 saveDoc | 设计期实测验证（R2 原型） | 原型输出：`60 跑完成（2692ms）：不一致 0 次 → 新协议下逐字节一致 ✓`；顺序规则反例：`新协议（arming/evict 等待）结果：✗ timeout:arming`（arming 被误置于 advance 之后）→ 修正放置后 P21 通过 | 低 |
| P24 | **（R3）pending 联言基线公式算术（R2-1 缺陷实证）**：真实 `FilePersistence` + `.tmp` 目录阻塞 + 逐字 FakeTimer 下三组实测——① `saveDoc 后 pending = 2 \| 首次失败记账后 pending = 1`（debounce+maxDirty 已消耗，仅剩 retry）；② 「base 取 advance 前」: base=1 → `pending>base = false`（恒假 = 等待必超时）vs「base 取 advance 后（=0）」: `pending(1)>0 = true`（正确信号）；③ `恢复后 pending = 0`（saved===dirty → finally 不重排 → 恢复腿挂 pending 联言必超时）。推论：R2 原基线公式照字面落地则 file n=1 每跑必红（确定红）、n≥2 中间失败腿无信号；R3 修正（触发动作返回点同步基线 + 恢复腿删联言）后两组算术均恢复可达 | SA2 R2 评审原型 B（引用） | `task_dsh-persistence-inspector_sa2_review.md` R2 评审节 §五②（`pnpm exec tsx /tmp/sa2-r2/baseline.mjs`，脚本已删，SA2 工作区零污染）；与 lifecycle.ts:401-403（净零武装）/ :436-437（catch 重排 retry）/ :444（恢复不重排）逐行对账 | 低（公式已修正） |

## §14. 契约改动连锁审计 (Contract Change Caller Audit)

**无契约改动**：本设计仅新增包 `packages/dsh-persistence`（新函数、新类型、新 CLI），不修改任何既有函数签名、返回类型、throw 行为或调用时序；`packages/persistence/src/**` 零改动（DENY）。根 `package.json` 仅追加 typecheck 子命令（构建脚本，非代码契约）。`@nomicore/persistence` 既有 caller（本包测试 + 新增的 dsh-persistence 消费）不受影响。

## SA2 反馈逐条回应（R1）

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|---|---|
| 攻击点 1（CRITICAL）：AC1-memory 第三条不可满足断言，§9 漏报且 §13 无证据 | ✅ | §9 缺陷 3（新增）；§13 P13/P14；§10 AC1 行；决策 I；§12 ALLOW 注记 | SA1 独立复核成立（V8 实测 + P2 契约锚点 lifecycle.ts:463-469 / memory-persistence.test.ts:366）；按 §9 既有格式增补缺陷 3，修法 A/B 论证后**选定修法 B**（load 前置 cache-hit：断言语义零反转 + cache-hit service 级覆盖净增益 + 反黑帽守卫原生嵌入），配方可满足性实测（V9）；待总控协调 SA6 R2 |
| 攻击点 2（HIGH）：盘点表逐行挂证据；§13 按用例补「内核时序 × FakeTimer 排空深度」证据行 | ✅ | §9 盘点表（重写，8 行全挂编号，无未验证行）；§13 P15（AC4-service-memory 精确 2-hop 核算 + 实测）/P16（探针全场景 × 逐字 FakeTimer）；§1 验证声明收紧；盘点纪律条款（SA4 检查项建议） | 「✓ 无据」的流程洞封死；CLI 行证据链 = P16 机制同源 + P11/P12 |
| 攻击点 3（MEDIUM）：saveCounters 递增点未规定 | ✅ | 决策 C generation 条（重写）；§6.1 伪代码（递增点 + 场景脚本侧 then/catch 分流）；§8 generation 语义补则 | 立法：仅在 saveDoc **resolve 后** +1，reject 只发 `write-rejected` 不计数；retry 成功 flush 与首发失败同 generation；`dirty g=n+1` 必在 `recovered` 后——P16 实测锚定（SA2 红线 #3 的两断言形态） |
| 攻击点 4（MEDIUM）：`failFirstFlushes>1` 时间线欠定 | ✅ | §5 S4 通用退避循环（新增伪代码 + n=1/2/3 序列）；§6.1 退避推进循环注记 | 探针自持退避镜像（初值 debounceMs，失败后 ×2 cap maxDirtyMs，镜像 lifecycle.ts:456）循环推进至注入耗尽且 ready；n=2 全序列实测（P17：两条同代 ok=false @+500/+1000，成功 @+2000） |
| 攻击点 5（LOW）：探针 service 消费未显式走 Cordis | ✅ | 决策 A 新增段；§7 profile 伪代码后注记 | `const svc = requireDocPersistence(profile.ctx)`，全部调用经 `svc`，`svc === profile.persistence` 开场自检（不一致 → `probe-failed:service-identity`） |
| 攻击点 6（LOW）：`probe-failed` reason 词表未规定 | ✅ | §6.2 封闭词表（6 模式）；§8 禁令适用条款；§11 风险表 | reason ∈ {file-settle-timeout / status-divergence / scenario-error / service-identity / clock-not-drivable / io-read-error}（带 {docId}/{generation}/{step} 占位）；原始错误走 stderr，永不进 record；无环境痕迹禁令对成败 record 一律适用 |
| 攻击点 7（INFO）：§6.3「每次触发后 8 微任务」转述失真 | ✅ | §6.3 注释（勘误） | 更正：testkit 每轮 3 微任务（testing.ts:126/129）；自建时钟排空数为自选实现参数，结算兜底 = advance 后 `settle(32)` + file 真实等待 |
| （SA1 自查新增）：R0 §7 伪代码 `createMemoryPersistencePlugin({…, memoryIo })` 透传形状错误 | ✅ | §7 伪代码勘误（展平 + 条件展开）；§11 风险表新行；§13 P18 | `MemoryPersistenceOptions` 注入缝是顶层 writeSnapshot/readSnapshot；嵌套传法被静默忽略（原型反证 writes=0）——R1 验证过程中发现并修正，非 SA2 攻击点 |

---

**SA1 结论（R1）**：设计就绪。核心交付为薄装配 profile + 黑盒探针双通道观察（§4–§8），架构决策 A–I 经 SA2 攻击确认维持。SA6 契约面可满足性盘点已逐行挂证据（§9）：缺陷 1/2 已协调落盘（commit 657b877）；缺陷 3（AC1-memory，修法 B）**已由 SA6 R2 落盘、当前全绿**。R1 修订全部附设计期实测证据（§13 P13–P18），SA1 仍未改动任何生产/测试文件。

---

## R2 修订说明（SA7 动态验证 fail-needs-fix 回流，2026-08-22）

### 回流背景与判据变化

SA7 以 52 跑量化数据证伪了 R0/R1 §6.2 file 通道结算谓词的隐含假设（「磁盘提交态可见 ⟺ 内核 flush 记账完成」），产生症状 A（静默 record 失真：evict 丢失、events=27、exit 0——**下游无法察觉**，最危险形态）与症状 B（响亮超时 exit 1）。归属判定为**设计级假设缺陷**（SA3 实现忠实于设计），回流 SA1。

### R2 核心修订：§6.2 两阶段结算协议（ DENY 与 AC8 承诺全部保持）

1. **拆条件**：flush 结算 = 条件 W（磁盘提交态可见，原谓词）+ 条件 A（内核记账完成证明，新增）。W 不再单独作为推进/释放依据。
2. **条件 A 的三条内核公共面信号**（依据两条源码级不变式，`packages/persistence` 零改动）：
   - **原子性引理**：flush 记账（savedGeneration/degraded 赋值、catch 的 scheduleRetry、finally 的 flushing=false/重排/maybeEvict）是 `io.write` 结算后的单个同步续体——宏任务观察者所见状态翻转（degraded↔ready）必伴随记账完成 → 失败/恢复腿的 status 谓词本就是正确判据（R0/R1 这两条腿碰巧正确，错误只在成功腿）；
   - **A-arming**（成功腿 + 后续脏写）：`saveDoc → waitFor(pending > baseline) → advance`——武装不变式（`scheduleFlush` 仅在 `flushing=false` 时武装，而 `flushing=false` 只在记账 finally 赋值）使「已武装 ⟺ 前次记账完成」成为状态蕴含而非时序猜测；
   - **A-evict**（成功腿 + 末次 release）：`release → waitFor(evict 事件)`——maybeEvict 只在记账 finally（或 clean release 路径）执行，延迟 evict ⟹ finally 已运行；同时堵死症状 A 的监听拆除竞态（teardown 必然晚于 A-evict 通过）。
3. **虚拟刻度不变式**（时间线不漂移的证明）：探针在「脏 saveDoc → 武装确认」间绝不推进虚拟时钟 → 记账滞后的 finally 重排与 saveDoc 直武装落到**同一虚拟到期刻** → §5 全部钉死值与 SA7 锚（events=28、t=2008/2009）逐字保持；协议不产生事件、对 record 不可见 → AC8 双跑逐字节一致恢复。
4. **顺序规则**（实现纪律）：A-arming 必须紧随后置 saveDoc；孤立的 post-advance `pending>base` 等待在无后续脏写的窗口必然超时（R2 原型反例实测，P23）。
5. **SA7 候选方向的取舍**：候选 ①（契约面加 in-flight/pending 观察口）被否——需改 `DocPersistence` 公共契约（连锁审计半径大，且 `pending()` 时钟内省已够用）；候选 ②（谓词升级为可证的记账完成）即本方案——语义谓词而非 deadline/固定轮数（SA7 明示的 R3/R4 教训）。

### R2 实证链（§13 P19–P23）

| 编号 | 结论 |
|---|---|
| P19 | SA7 52 跑量化证伪（症状 A/B 机理与源码定位，直接引用） |
| P20 | 旧协议在**确定性窗口**（memory 延迟 30ms 钩子）下必然破碎（症状 B 受控复现） |
| P21 | 新协议同一窗口下完整吸收（evict 落钉死刻度 t=1002；30ms 记账滞后 → finally 武装 → advance → flush） |
| P22 | file 并发 50 跑 ×1ms 轮询：自然命中 3 次窗口，全吸收、零失真、零失败 |
| P23 | file 新协议 60 跑逐字节一致（锚定形态逐行相同）+ 顺序规则反例（孤立 arming 超时） |

### 连带修订与处置

- §5：S4 恒跑对齐（n=0 基本生命周期 = events=28 锚；降级腿仅 n≥1）+ 协议不变性声明；§8/§9/§11 对应更新（AC8 勘误、盘点表 CLI 行修订、风险表两行新增）；§12 ALLOW 追加 `[SA7 owned]` 回归锚。
- **F-REJECT-LEAK（LOW）处置**：归属内核 read-ticket 链（`file.ts:96` `rm force` 只容忍 ENOENT），DENY 区不越权；探针侧 await 均已 catch、未放大；建议总控立 P3 跟进项单独裁决（改 `file.ts` 即 DENY 例外）。
- **SA3 落地范围**：仅 `packages/dsh-persistence/src/probe.ts`（§6.2 协议：observeFlush 拆两条件 + S1/S4 窗口接线 + A-arming 基线 + evictSeen 等待 + 顺序规则），ALLOW 既有条目覆盖；SA7 锚（`dsh-file-probe-determinism.test.ts`）不改，修复后应稳定绿。
- **闭环路径**：SA3 落地 → SA4 复审（重点：协议接线的窗口覆盖完备性，S1/S2/S4 每个 advance/release 前均有条件 A 证明）→ SA7 复跑（52 跑 0 异常 + 锚稳定绿）。

**SA1 结论（R2）**：§6.2 谓词缺陷已修复且实证闭环（P19 证伪 → P20 机理复现 → P21/P22/P23 吸收与确定性）；DENY、AC8、§5 钉死时间线、封闭词表全部保持。设计就绪，待 SA3 落地。

---

## R3 修订说明（SA2 R2 评审 reject 窄幅回流，2026-08-22）

### 修订范围（按总控指令：协议骨架不重开）

仅 §6.2 基线语义与前置声明 + §6.3 接口一行 + §13 一行实证；协议骨架（条件 W/A 拆分、原子性引理、武装不变式、A-evict、虚拟刻度不变式、窗口表结构）、§5 钉死值、§8/§9/§11/§12 均不动（SA2 R2 评审节三「正面确认」清单）。

### SA2 R2 攻击点逐条回应

| 攻击点 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|---|---|
| R2-1（HIGH）：pending 联言基线公式两处实证缺陷（失败/恢复腿联言恒假 → file n=1 确定红；n≥2 中间失败腿无信号） | ✅ | §6.2「失败注入与降级腿基线（R3，R2-1 修正）」+ 窗口表两行 + A-arming 伪代码注释 + §13 P24 | 统一「触发动作返回点的同步基线」：A-arming 保持 base=saveDoc 前快照（原已正确，注释补两路径算术）；首次失败腿联言（可选）base=advanceBy 返回瞬间（=0，debounce+maxDirty 已同步消耗）；中间失败腿（n≥2，状态无翻转）信号 = pending > baseAdvance（同基线；恢复「任意 n 确定」在 file 通道的承诺）；恢复腿**删除联言**（status 翻转依原子性引理已是完备证明；恢复后 pending=0，联言恒假——SA2 原型 B 实证引用为 P24）。R2 原错误公式以「错误公式」标注保留于文中供 SA4 对照，防 SA3 照旧实现 |
| R2-2（MEDIUM）：净零武装边界与 pending() 接口面未声明 | ✅ | §6.2 顺序规则前置 2/3（新增）；§6.3 ProbeClock | 前置声明：A-arming 基线期间该 doc 无既存未决 debounce/maxDirty 计时器对（每脏写窗口恰一次 saveDoc；反例 = 同窗口二次 saveDoc 的 clear+set 净零 → pending 不增 → 超时；未来连续标脏场景须先换信号）；ProbeClock 补 `pending(): number` 声明 + 语义注记（已触发已删除不计；SA6 FakeTimer 与自建时钟同语义——基线算术前提）+ file 通道缺 pending 启动即 loud TypeError（memory 不依赖不作要求，与 SA3 现实现 guard 一致） |
| R2-3（LOW）：status 谓词实例级语义前置未声明 | ✅ | §6.2 窗口表后新增前置段 | 声明「当前唯一 degraded 源是本 doc + 降级窗口串行」为翻转谓词前置（当前恒成立：S4 唯一降级源、全程持 handle、degraded ⇒ dirty ⇒ 不驱逐）；多 doc 并行降级的未来扩展会使谓词失真，届时需 per-doc 状态（内核公共面演进，另行 ADR/设计评审，不得静默修补） |

### 与 SA2 红线测试思路的对应（供 SA4/SA7 参考）

- 红线 #1①（file n=1 ≥20 跑 events=32 无超时）：R3 修正后成立的前提正是基线公式——若 SA3 照 R2 原文实现联言，第一跑即确定红（P24 算术）；
- 红线 #1②（file n=2 CLI：两条同代 ok=false @t=1508/2008 + recovered@3008 + 双跑一致）：当前锚未覆盖 file n≥2，**建议 SA7 复跑补该批次**（R3 修正恢复的回归口）；
- 红线 #1③（恢复腿 pending===0 专项 + 谓词形态文本断言）：SA4 复审专项核对项（谓词形态 = 本缺陷注入点）。

**SA1 结论（R3）**：R2-1/R2-2/R2-3 全部落实，修订面严格限于指令范围；两阶段结算协议骨架维持 SA2 确认形态。设计就绪，交 SA2 窄幅复核（预期仅审 §6.2/§6.3/§13 P24）。
