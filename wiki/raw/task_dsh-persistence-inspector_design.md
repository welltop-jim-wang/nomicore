# SA1 架构设计 — DSH 持久化开发 profile 与 inspector 探针（Issue #59, P4）

> 阶段：Phase 2 架构设计（首轮 R0）
> 任务简报：`wiki/raw/task_dsh-persistence-inspector.md`（含 SA6 Phase 1 验收锚定 §1–§4，契约面以简报 §2/§3 为准）
> ADR 约束基准：`wiki/raw/task_dsh-persistence-inspector_relevant_decisions.md`（ADR-0006 含 2026-08-21 修订节为直接治理 ADR；冲突门禁结论提示 1–5 全部落实，见 §10 映射表）
> 实现基线：P1–P3 已合入（HEAD 2aa22f4 / PR #66）——`packages/persistence` 提供 `PersistenceLifecycle` 共享内核 + `MemoryPersistence` / `FilePersistence` 双 Adapter，全绿。
> worktree：`/home/wangjian/nomicore-fix-issue-59`
> ⚠️ **本文档包含两条 SA6 红灯测试不可满足断言的实证与修复配方（§9），需要总控协调 SA6 修订测试，属本设计的阻塞项。**

---

## §1. 需求推演（Feature）

**任务本质**：ADR-0006 实施顺序第 4 步。P1–P3 已把持久层做成「宿主无关的 Cordis 插件」，但至今只在测试文件里以裸 `new Context()` 驱动过。本任务交付两件事：

1. **DSH 开发 profile**：一个把 `@nomicore/persistence` 现成插件工厂装进真实 Cordis Context 的薄宿主函数（`createDshPersistenceProfile`），证明「同一 contracts、双 Adapter、零条件分支在 core 之外」——**这不是新持久化逻辑，是宿主装配**。
2. **inspector 探针**：一个只消费 `DocPersistence` service 公共面 + 公开注入缝的黑盒驱动器（`runPersistenceProbe` + `src/cli.ts`），在受控虚拟时钟下把 ADR-0006 的关键语义（lease 身份、内部调度 flush、degraded→retry→recovered、引用归零 evict、分区隔离、duplicate/meta-mismatch 响亮拒绝）跑成**确定性、可复制的事件流与文本记录**，供人肉验收与后续 NomicoreServer Host 复用（AC8）。

**真正的设计难题不是装配，是观察**：探针必须观察到 `dirty { generation }`、`flush { generation, ok }`、`evict`、`degraded`/`recovered` 这些**持久层内部状态迁移**，但 AC7 与 ADR-0006 禁止把观察面塞进核心插件（「inspector 只消费 DocPersistence service，不得成为核心插件依赖」；冲突门禁提示 3：「inspector 不得引入外部 flush 协调器，只观察内部调度」）。core 的 `PersistenceLifecycle` 没有事件面，且本任务的 DENY 边界不允许改 `packages/persistence/src/**`（§12）。因此观察通道必须建在 DSH 侧：**memory 走 `MemoryPersistenceOptions.memoryIo` 公开 dev/test 注入缝（简报 §2 明文认可的透传缝），file 走「受控时钟边界 + 提交态文件系统外部观察 + getStatus 轮询」**（file adapter 的公共面没有 I/O 注入缝，这是 P3 既定事实；文件系统本身就是 file adapter 的提交态存储，读它不是窥探私有内部）。详见 §6。

**设计期实测验证**：本设计的关键机制全部在真实 P1–P3 代码上原型验证过（§13 协议假设依据表逐条列出命令与输出），包括两条 SA6 红灯断言不可满足的证明（§9）。**SA1 未改动任何生产/测试文件**，原型脚本已从工作区删除。

## §2. 现状资产盘点（设计起点）

| 资产 | 位置 | 状态 | 本任务处置 |
|---|---|---|---|
| `DocPersistence`/`DocHandle`/`User` 契约、`DOC_PERSISTENCE_SERVICE`、`DEFAULT_PERSISTENCE_SCHEDULE`（500/5000）、`PersistenceTimer`、`DocDuplicateError`（`code='DOC_DUPLICATE'`） | `packages/persistence/src/contract.ts` | P1 锁定 | 只读消费 |
| `PersistenceLifecycle`（per-key 协调、debounce/maxDirty/retry 三计时器、单飞 flush + generation 保序、degraded 状态机、`maybeEvict`、dispose-epoch、abort I/O） | `packages/persistence/src/lifecycle.ts` | P2→P3 共享内核，全绿 | **只读消费，零改动**（DENY） |
| `MemoryPersistence`（含 `memoryIo.writeSnapshot/readSnapshot` 公开注入缝；write 路径：hook 先 await、mirror 后写；read 路径：hook 是唯一读权威） | `packages/persistence/src/memory.ts` | 全绿 | profile 选项透传；探针 write 钩子注入（§6.1） |
| `FilePersistence`（`rootDir` 必需；用户分区 `users/<userId>/<docId>.snapshot`；tmp+rename 原子提交；无 I/O 注入缝） | `packages/persistence/src/file.ts` | 全绿 | profile 装配；探针走外部观察通道（§6.2） |
| 插件工厂 `createMemoryPersistencePlugin` / `createFilePersistencePlugin`（`{ apply(ctx), instance }`，apply 时 `ctx.effect` 注册 service + dispose 清理） | 同上 | 全绿 | profile 唯一装配路径 |
| SA6 脚手架：`packages/dsh-persistence/package.json`（`@nomicore/dsh-persistence`，deps 已装，`dsh:probe` 脚本）+ 两个红灯测试文件 + `packages/persistence/test/core-dsh-boundary.test.ts` 绿色守卫 | `packages/dsh-persistence/` | 红灯（src 不存在） | 本任务交付 `src/**` 修绿；两处测试时序缺陷须 SA6 协调（§9） |
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
| I | SA6 两处测试缺陷交总控协调修测试，不在实现侧 hack | 禁止为测试改 core 语义 |

## §4. 架构决策

### 决策 A：双层结构——profile 是纯装配，probe 是黑盒驱动器，二者不共享观察逻辑

`createDshPersistenceProfile` 只做四件事：选插件工厂（'memory' | 'file' 唯一分支点，即「零条件分支在 core 之外」的字面落地）→ `new Context()` → `plugin.apply(ctx)` → 暴露 `{ ctx, persistence, getStatus, dispose }`。`persistence` 就是 `plugin.instance`（真实 `MemoryPersistence`/`FilePersistence` 实例，AC1 `toBeInstanceOf` 断言的直接满足），`ctx.get(DOC_PERSISTENCE_SERVICE)` 返回同一对象（`ctx.provide` 注册的是同一实例）。

`runPersistenceProbe` 内部**调用同一个 `createDshPersistenceProfile`**（单一装配路径），在其上叠加：场景脚本（§5）+ 观察通道（§6）+ 记录渲染（§7）。探针**不包装、不装饰** `DocPersistence`——它发出去的每个 service 调用都是真实调用，观察来自缝与外部效应，不来自代理拦截。理由：装饰器方案会让 `ctx.get('docPersistence')` 与 `profile.persistence` 出现两个身份，直接违反 AC1 的 `toBe` 断言与 ADR「service 是 Host 长生命周期资源」的单一实例语义。

### 决策 B：观察通道 adapter 特化——memory 走公开注入缝，file 走外部提交态观察

**memory 通道**：探针经 profile options 的 `memoryIo.writeSnapshot` 注入一个**同步纯观察钩子**（§6.1 伪代码）：per-key 写计数区分 create-commit（第 1 次）与 flush 尝试（第 ≥2 次，含 retry），flush 尝试即发 `flush { generation, ok }` 事件（钩子正常返回 → `ok=true`；钩子 throw → `ok=false` 并随即发 `degraded`），`failFirstFlushes` 只对 `doc-degraded` key 的 flush 尝试注入前 N 次失败。钩子不存储任何数据（memory adapter 自有 mirror，读路径不注入 `readSnapshot`，restore-after-evict 走 adapter 自身 mirror——原型 V3 已证 reload 得到含 rev=2 的新实例）。

**file 通道**：`FilePersistenceOptions` 无 I/O 缝（P3 既定公共面，不改）。探针的观察手段全部是外部效应：受控时钟推进到调度边界后，用**真实等待**（`waitFor(predicate, realDeadline)`，内部用系统 `setTimeout` 轮询，等待不推进虚拟时钟、不进入记录）等真实文件 I/O 结算，然后读提交态快照文件（解码比对 `ROOT.rev` 等语义标记）判定 flush 成败、读 `getStatus()` 判定 degraded/recovered。失败注入用**外科式阻塞**：把 `users/<owner>/{docId}.snapshot.tmp` 占为目录 → flush 的 `writeFile(tmp)` 得 EISDIR（原型 V7 已证：degraded → 解除 → retry recovered，且同用户其他 doc 的已提交快照不受误伤）。

**为什么不为 file 加注入缝**：给 `FilePersistenceOptions` 加 `io` 钩子是改 P3 公共面（DENY 边界 + 纯为探针服务的生产面污染）；外部观察虽多一层等待，但观察对象（提交态文件）恰是 ADR-0006 定义的「只有 `.snapshot` 是提交态」公共语义，探针读它是最诚实的黑盒观察。

### 决策 C：generation / refs / 实例身份由探针自持模型推演

- **generation**：`saveDoc` 是公共 API，每次成功调用使该 doc 的 `dirtyGeneration` +1（lifecycle.ts:201 逐字行为）；探针数自己发出的 saveDoc 即得 generation。retry flush 重试的是**同一 generation**（lifecycle `flush()` 捕获当时 `dirtyGeneration`）——探针模型与内核行为一致（原型 V3：doc-degraded 第 3 次写=retry g1）。
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

memory 钩子的 per-key 写计数：第 1 次 = `createDoc` 初始提交（ADR：createDoc 承诺返回前落盘，不是 saveDoc 调度面）→ 不发 flush 事件；第 ≥2 次 = flush 尝试（含 degraded 后的 retry 重试）→ 各发一条 `flush { generation, ok }`。retry 与首发同 generation（决策 C），AC4 的 `failedFlush(g1,ok=false) → okFlush(g1,ok=true)` 序列与排序断言天然满足（原型 V3 时间线 1508/1508/1508/2008/2008）。

### 决策 I：SA6 测试缺陷交总控协调，不做实现侧 hack（详见 §9）

实证发现 SA6 红灯测试两处断言在**正确实现**下不可满足（AC4-file 的真实 I/O 微任务结算假设、AC6 的 dispose 前脏数据未提交假设）。可选的黑帽路径——给 core dispose 加 flush-dirty 语义、给 FilePersistence 写路径加同步预检、让 profile 包装 SA6 的 timer——全部违反 DENY 边界或 ADR 语义（§9 逐条排除）。正确路径是修测试（附已验证配方），按简报 §2「SA6 固定，改动须与 SA6 协调」条款交总控。

## §5. 探针固定场景脚本与虚拟时间线

场景顺序固定（记录确定性的前提）：**S1 主链路（user-a/doc-alpha）→ S2 隔离（user-b/doc-alpha）→ S3 异常输入（duplicate / meta-mismatch）→ S4 降级（user-a/doc-degraded，仅 `failFirstFlushes ≥ 1`）**。S1 必须最先（AC2 `releases[0].refs > 0` 要求首个 release 出自多 handle 场景）。

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

**每条 AC 断言的满足性推演**（对照 SA6 `dsh-profile-acceptance.test.ts`）：

- AC2：doc-alpha flushes = [g1@500, g2@1000]（≥2 ✓，均 ≥500 ✓，各有同代 dirty 先行 ✓）；loads = h2/h3/h4（≥3 ✓，handle 唯一 ✓，d1 计 2 次 ✓ 实例集大小 2 ✓）；releases（docId=doc-alpha 过滤，含 user-b）= [refs2@1000, refs1@1001, refs0@1002, refs0@1003, refs0@1005]（首个 refs=2>0 ✓，末个=0 ✓，共 5≥3 ✓）；evicts = [1002, 1003, 1005]（≥2 ✓，均 > 1000 ✓）。
- AC3：observed(user-a) metaDocId='doc-alpha'、entries⊇{SCHEMA,META,ROOT} ✓；user-b create+observed 独立 ✓；duplicate code ✓；meta-mismatch expected/actual ✓。
- AC4：[failedFlush 1508, degraded 1508, rejected 1508, okFlush 2008, recovered 2008] 升序 ✓；record 四个标记 ✓。
- AC5：release→refs 归零→内部决定 evict（`maybeEvict` clean 前置）→ reload 新实例（store 还原）——时间线 1002 行完整覆盖 ✓。
- AC8（CLI）：stdout = 记录（仅虚拟 t、无 rootDir）→ 同参两跑逐字节一致 ✓；file 跑落盘 `users/{user-a,user-b}/doc-alpha.snapshot`（create-commit 即落盘，原型 V5 已证 existsSync 在 advance 后成立）✓。

## §6. 观测通道设计

### §6.1 memory 通道（注入缝，同步纯观察）

```ts
// probe.ts（伪代码，关键逻辑完整）
const injectionKey = 'user-a\u0000doc-degraded'
const writesPerKey = new Map<string, number>()
let flushFailuresLeft = failFirstFlushes ?? 0

const memoryIo = {
  writeSnapshot(key: string, _snapshot: Uint8Array): void {   // 同步、零存储：mirror 由 adapter 自己维护
    const n = (writesPerKey.get(key) ?? 0) + 1
    writesPerKey.set(key, n)
    if (n === 1) return                                        // create-commit：不是 flush，静默
    const { owner, docId } = splitKey(key)                     // '\u0000' 分隔；解析失败 → probeFailed（loud）
    const generation = saveCounters.get(key) ?? 0              // 决策 C：自持 saveDoc 计数
    const inject = key === injectionKey && flushFailuresLeft > 0
    if (inject) {
      flushFailuresLeft -= 1
      emit({ type: 'flush', owner, docId, generation, ok: false, t: clock.now() })
      emit({ type: 'degraded', owner, docId, t: clock.now() })
      throw new Error('probe-injected flush failure')          // → io.write 拒绝 → 内核 degraded + 退避 retry
    }
    emit({ type: 'flush', owner, docId, generation, ok: true, t: clock.now() })
    if (key === injectionKey && wasDegraded(key)) {
      emit({ type: 'recovered', owner, docId, t: clock.now() })
      markReady(key)
    }
  },
}
// 探针每个 advanceBy 之后：await settle(32)（微任务排空，见 §6.3），再对照 getStatus() 自检
// degraded/recovered 推断与 getStatus() 不一致 → probeFailed（ok=false，loud）
```

微任务深度核算（SA6 FakeTimer 每 callback 只排空 2 个微任务的约束下）：flush 链 = `callback → flush() 同步段 → await io.write → await hook(同步) → mirror set → write resolve → flush 恢复`，共 ≤2-3 hop；探针在 advanceBy 后再 `settle(32)`，后续 saveDoc/观察必然看到已结算的内核状态（原型 V3 全链路通过即证）。

### §6.2 file 通道（外部提交态观察 + 真实等待）

```ts
// file 模式下每次 advanceBy 后的结算协议（伪代码）
async function settleFileIo(expect: { status?: PersistenceStatus, snapshot?: { docId: string, rootRev: unknown } }): Promise<void> {
  await waitFor(() => {
    if (expect.status && profile.getStatus() !== expect.status) return false
    if (expect.snapshot) {
      const bytes = readSnapshotFile(rootDir, owner, expect.snapshot.docId)   // fs.readFileSync，ENOENT → undefined
      if (bytes === undefined) return false
      const scratch = new Y.Doc(); Y.applyUpdate(scratch, bytes)              // 解码提交态
      if (scratch.getMap('ROOT').get('rev') !== expect.snapshot.rootRev) return false
    }
    return true
  }, { timeoutMs: 5_000 })   // 真实 setTimeout 轮询；超时 → probeFailed（ok=false，loud）
}

// 失败注入（外科式）：mkdir users/<owner>/doc-degraded.snapshot.tmp（目录）
// → 在途 flush 的 writeFile(tmp) 得 EISDIR → degraded（原型 V7）
// 解除：rm 该目录 → advance(retryDelay) → waitFor(ready + 快照 rev 达预期) → recovered
```

flush 事件归属（file 无钩子）：场景脚本每步只驱动一个 doc 的调度窗口，advance 前登记「本窗口预期 flush 的 key+generation」，settle 成功即发 `flush{gen, ok:true}`，`waitFor(status=degraded)` 成立即发 `flush{gen, ok=false}` + `degraded`。retry 窗口同理（同 generation）。

**真实性边界声明**：file 通道的 flush 观察是「调度边界 + 提交态效果」级（观察到的是每次 flush 的最终结果，而非写调用本身）；memory 通道是写调用级。两级粒度都以公共语义为准（`.snapshot` 是唯一提交态），记录格式相同，不影响任何 AC 断言（两通道的事件 t 同刻度）。

### §6.3 时钟模块

```ts
export interface ProbeClock extends PersistenceTimer { advanceBy(milliseconds: number): Promise<void> }

export function createDeterministicClock(): ProbeClock {
  // 与 persistence testkit createTestTimer 同族：到期序触发；每次触发后 8 微任务；
  // advance 收尾再 8 微任务。now 从 0 起（AC2 flush.t ≥ 500 断言的基准）。
}
async function settle(ticks = 32): Promise<void> { for (let i = 0; i < ticks; i++) await Promise.resolve() }
```

调用方传入的 timer 缺 `advanceBy` → `TypeError`（决策 D）。

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
      plugin = createMemoryPersistencePlugin({ schedule, timer, memoryIo })
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
  const persistence = plugin.instance!   // apply 同步建实例并注册 service
  return {
    ctx,
    persistence,
    getStatus: () => persistence.getStatus(),
    dispose: async () => { /* 决策 F 顺序 + 幂等 */ },
  }
}
```

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

### CLI

```
pnpm exec tsx packages/dsh-persistence/src/cli.ts --adapter <memory|file> [--rootDir <dir>] [--fail-first-flushes <n>]
```

- 成功：record → stdout，退出码 0（`result.ok=false` → 退出码 1 + stderr 尾因）。
- `--adapter file` 缺 `--rootDir` → stderr（含 `rootDir`）非零退出；未知 adapter → stderr（含 `adapter`）非零退出；`--fail-first-flushes` 非非负整数 / 未知 flag / 缺 `--adapter` → stderr 用法提示 + 非零退出（沿用 vfsl-codegen CLI 的退出码纪律：0 成功 / 1 领域失败 / 2 用法错误）。
- file 模式 CLI **不清理 rootDir**（快照是 AC8 要的可观察副作用）；探针内部 profile.dispose 不删已提交快照（内核 dispose 只清缓存/计时器）。
- CLI 内部：自建 `createDeterministicClock()`；file 通道真实等待在进程内完成（记录不含等待痕迹）→ 同参两跑逐字节一致（AC8）。

## §9. SA6 红灯测试缺陷：两条不可满足断言（阻塞项，实证 + 修复配方）

> 以下均在**已实现且全绿**的 P3 `FilePersistence` 上以 SA6 逐字复刻的 FakeTimer 实测（原型 V4/V5/V6，命令与输出见 §13）。结论：这不是实现缺口，是测试的时序/语义假设缺陷；按简报 §2「SA6 固定，改动须与 SA6 协调」条款，**请求总控协调 SA6 修订 `packages/dsh-persistence/test/dsh-profile-acceptance.test.ts` 两处**。修复均为**测试基础设施性质**（插入等待/推进），断言的目标值一字不改。

### 缺陷 1：AC4 service 级 file 用例（test 文件 338–362 行）——真实 I/O 不在微任务里结算

- **断言链**：`saveDoc` → `await timer.advanceBy(debounceMs)` → **立即** `expect(profile.getStatus()).toBe('persistence-degraded')`。
- **实测**：FakeTimer 的 `advanceBy` 只排空微任务（每 callback 2 次 `await Promise.resolve()`）；flush 的 `fsp.mkdir/writeFile/rename` 在 libuv 线程池结算，需要真实事件循环轮转。复刻输出：`T+0 advance 返回后立刻 getStatus: ready（SA6 断言要求 persistence-degraded）`；直到 `setImmediate` ×5 后才 `persistence-degraded`。恢复侧断言（rm blocker → advance → `toBe('ready')`）同理。
- **不可满足性证明（实现侧无解）**：任何正确实现都无法让真实文件 I/O 在纯微任务排空内完成——除非给 `FilePersistence` 写路径加同步预检（改 P3 生产代码 + 语义错误：同步预检测不出 EACCES/EPERM 竞态）或包装调用方 timer（外部 flush 协调器，违反 ADR）。
- **修复配方（已实证）**：在该用例每个 `await timer.advanceBy(...)` 之后、断言 `getStatus()` 之前，插入真实结算等待，例如：
  ```ts
  const settleRealIo = async (rounds = 12) => { for (let i = 0; i < rounds; i++) await new Promise(r => setImmediate(r)) }
  // 或等价 waitFor(() => profile.getStatus() === 'persistence-degraded') 有界轮询
  ```
  （原型 V4/V7：插入等待后 degraded → 拒绝 → 解除 → ready 全序列通过。）

### 缺陷 2：AC6 用例（test 文件 364–416 行）——dispose 前的脏数据从未提交

- **断言链**：`createDoc` → `ROOT.rev=1` → `saveDoc` → `expect(timer.pending()).toBeGreaterThan(0)` → `await profile.dispose()` → reload 后 `expect(loaded.doc.getMap('ROOT').get('rev')).toBe(1)`。
- **实测**：内核 dispose 语义 = 清计时器 + abort I/O + 销毁 doc（**不 flush 未决脏数据**；release 也不触发 flush——`maybeEvict` 的 clean 前置使其只驱逐已保存项）。复刻输出：`AC6 reload rev = undefined（SA6 断言要求 1）`。
- **不可满足性证明（实现侧无解）**：让 rev=1 落盘需要在 dispose 前让 debounce 计时器到期（推进时钟）——profile 无法替调用方推进其传入的 timer（那是外部 flush 协调）；改内核 dispose 加 flush-dirty 语义 = 改 P3 行为契约（DENY + 影响既有 P3 套件对 dispose-abort 语义的锚定）。
- **修复配方（已实证，原型 V6）**：在 `await profile.dispose()` 之前插入：
  ```ts
  await timer.advanceBy(DEFAULT_PERSISTENCE_SCHEDULE.debounceMs)  // 让 debounce flush 提交 rev=1
  await settleRealIo()                                             // file 模式真实结算（同缺陷 1 helper）
  ```
  之后 `dispose` → reload → `rev === 1` 实测通过；且该用例其余断言（pending=0、doc destroyed、service undefined、status disposed、无 .tmp、无 fd 残留、reload 新实例）全部不受影响（原型 V5 已逐项通过）。

### 其余 SA6 用例可满足性盘点（实证）

| 用例 | 结论 |
|---|---|
| AC1 memory / AC1 file / AC3 file（service 级） | ✓ 可满足（file 的 existsSync 由 create-commit 落盘保证，loads 走 live cache；原型 V5 逐项通过） |
| AC2/AC3/AC4 probe 级（memory + FakeTimer） | ✓ 可满足（微任务可结算；原型 V3 全链路通过） |
| AC4 service 级 memory（memoryIo 注入） | ✓ 可满足（同步钩子，原型 V3 通过） |
| CLI 全部 7 用例 | ✓ 可满足（子进程内探针自建时钟 + 自结算；记录无环境痕迹） |
| core-dsh-boundary 绿色守卫 | ✓ 保持绿色（本设计零触碰 `packages/persistence`） |

## §10. AC 与冲突门禁提示映射表

| 验收条款 / 提示 | 设计落点 |
|---|---|
| AC1 双 Adapter 同一 contracts | 决策 A（唯一分支点在 profile 装配）；AC1 三用例 ✓ |
| AC2 load→saveDoc→调度 flush→release；重复 load | §5 S1 时间线；决策 G/H |
| AC3 隔离 + META 校验 + 三条目 | §5 S1/S2/S3；`observed` 渲染规范序 |
| AC4 降级全记录 | §5 S4；§6.1/§6.2 双通道；**§9 缺陷 1（file service 级测试须修）** |
| AC5 引用归零与最终释放 | 决策 C（refs 记账）+ `destroyed` 事件（V1） |
| AC6 dispose 卫生 | 决策 F + 探针 teardown 纪律；**§9 缺陷 2（reload 断言须修）** |
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
| SA6 FakeTimer 微任务深度不足（每 callback 2 hop） | flush 链 ≤3 hop 实测通过（V3）；探针每次 advance 后 `settle(32)` 独立兜底 |
| file 通道真实等待超时（慢盘/CI） | `waitFor` 5s 真实上限 → `probe-failed` + `ok=false`（loud，不静默）；CLI 非零退出 |
| 探针场景中途异常 | finally 保证 `profile.dispose()`；`probe-failed {reason}` 行 + `ok=false`；不吞栈 |
| 事件归属用 `\u0000` key 解析（memory 通道） | 该格式是 memoryIo 公共回调参数的既定事实（lifecycle `toKey`、file.ts `resolveSnapshotPaths` 同款解析先例）；解析失败 → `probe-failed`（loud） |
| `plugin.instance` 非空断言 | apply 同步建实例（P2/P3 工厂实现事实）；设计在 apply 后立刻 `instanceof` 自检，null → throw（loud） |
| root package.json `typecheck` 脚本需纳入新包 | 追加 `&& tsc -p packages/dsh-persistence/tsconfig.json`（CI `pnpm typecheck` 覆盖新包；ALLOW LIST 内） |
| 双跑记录不一致 | 记录只含虚拟 t + 固定场景序 + 固定发号；Map 遍历序由排序规范消解 |

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
- `packages/dsh-persistence/test/dsh-profile-acceptance.test.ts` — `[SA6 owned]` **须与 SA6 协调**的两处时序修复（§9 缺陷 1/2：插入 settleRealIo/advanceBy，断言目标值不变）；SA3 仅可落协调后的最小修复，不得改断言值
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

## §14. 契约改动连锁审计 (Contract Change Caller Audit)

**无契约改动**：本设计仅新增包 `packages/dsh-persistence`（新函数、新类型、新 CLI），不修改任何既有函数签名、返回类型、throw 行为或调用时序；`packages/persistence/src/**` 零改动（DENY）。根 `package.json` 仅追加 typecheck 子命令（构建脚本，非代码契约）。`@nomicore/persistence` 既有 caller（本包测试 + 新增的 dsh-persistence 消费）不受影响。

## SA2 反馈逐条回应

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|---|---|
| （首轮 R0：尚无 SA2 反馈） | — | — | — |

---

**SA1 结论**：设计就绪。核心交付为薄装配 profile + 黑盒探针双通道观察（§4–§8），SA6 契约面（简报 §2）逐项可满足；**唯一阻塞项是 §9 两条 SA6 测试断言不可满足，须总控协调 SA6 按已验证配方修订**（改动均为测试时序基础设施，断言目标值不变）。
