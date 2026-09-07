# 架构设计 — Issue #249 diagnostic pump 单飞竞态修复与 duplicate 诊断补齐

- 任务：Issue #249（Bug fix）——`wiki/raw/task_diagnostic-pump-singleflight-duplicate.md`（AC1–AC8）
- Worktree：`/home/wangjian/nomicore-fix-issue-249`（branch `mabf/issue-249`，HEAD `ac91a6b` = PR #248）
- 阶段：design（SA1）；日期 2026-09-06（UTC）
- 输入：SA8 冲突门禁 clear（`wiki/raw/task_249_conflict_report.md`）；决议摘录
  `wiki/raw/task_249_relevant_decisions.md`；SA5 故障分析 clear（`wiki/raw/20260906-bug-249.md`，
  6 红 / 7 绿可执行复现）；SA6 红灯契约 R0（两契约文件 + 验证记录
  `wiki/raw/task_diagnostic-pump-singleflight-duplicate_sa6_red_verification.md`）
- 结论（TL;DR）：
  1. **AC1**：泵调度门从 running-only 集合改为 **scheduled+running 合一的 per-ns 单飞位**（`inflight`），
     位在**排定时**置位、在**回调末尾 finally** 清除——首 drain 前 burst 窗口被结构性消灭，
     AC2 交错不变量逐条保持（§4）。
  2. **AC3**：`DiagPumpDeps` 增可选 `reportDrop`（判别联合载荷：`{kind:'emit', operation, reason:'queue-full'}` |
     `{kind:'init-stream', reason:'queue-full'}`），满队丢弃点同步逐条上报；落点 =
     **ADR-0009 L95 Registry 内部 observer seam 新事件 `diag-pump-drop`**（低基数、无
     namespaceId/streamId/token、不占同一队列、try/catch 收编）（§5）。
  3. **AC4**：registry.ts 两个 retry 分支各补一条**候选级被拒 emission**，经
     `CreateDiag.emitCandidateOutcome`（新方法）走**泵路径（ns-bound 通道）**；legacy
     （#150 共享 emitter 形状）实现为 **no-op**（既有绿灯 `registry-create-diagnostic-red.test.ts`
     L529「恰一条最终结局」冻结契约零漂移）；词表映射走既有冻结词表（identity/
     NAMESPACE_ALREADY_EXISTS/registry 与 transaction/DOC_DUPLICATE/persistence），**零词表演进**
     （§6）；重试预算耗尽终局**不发诊断记录**（observer-only，§6.6 裁决）。
  4. **SA6 契约需三处对齐修订**（本设计新发现，契约自身注记已预授权对齐通道）：R2a 绿锚的
     三次 `flushOne` 机制**结构性依赖被修复消灭的重复调度**（修复后第三次 flush 将抛
     `no pending immediate`）；R3-2 的字面载荷类型无法诚实承载 init-stream 丢弃；T-C 耗尽
     断言需按 §6.6 裁决对齐（§10）。
  5. **无需冲突复审**（requiresConflictRecheck=false）：全部设计决策落在 SA8 已裁定 clear 的
     ADR-0011/0012（诊断格式）/0009/0006/0010 既有条款兑现域内；零词表演进、零 schema 变更、
     零公共 API 变更、零 ADR 文本变更（§14）。

## 1. 范围与非目标

**改动对象**（全部位于 `packages/namespace-registry`，包内非公共模块）：

| 文件 | 改动 |
|---|---|
| `src/diag-pump.ts` | 单飞位重构（§4）+ `reportDrop` 可选依赖（§5） |
| `src/create-diagnostic.ts` | `CreateDiag.emitCandidateOutcome` 新方法（泵实现 + legacy no-op + NOOP no-op）；`CreateEmissionArgs` 增可选 `sourceModule`；泵构造接线 `reportDrop`（§5.4/§6.2） |
| `src/registry.ts` | L1311 / L1410 两 retry 分支补候选 emission；orchestrateCreate 头注释（L1248–1254）按新事实改写（§6.1） |
| `src/observer.ts` | `RegistryObserverEvent` 联合增 `diag-pump-drop` 变体（§5.3） |
| `test/registry-issue-249-*.test.ts` | SA6 对齐修订（§10，SA6 owned）+ 新增覆盖（§13.3） |

**非目标 / 冻结不动**：

- `packages/namespace-diagnostic-log/**` **零改动**（含 `src/schema.ts` 指纹
  `sha256:v1:dedad2ab…`、v1 词表、update-omitted reasons、`test/schema-freeze.test.ts`）。
- `src/index.ts` 公共导出面零改动（ADR-0009 L107–114 公共面冻结；registry-surface 守卫面）。
- `NamespaceRegistryDiagnosticLog` Host seam（emitter/initStream/runtimeEmitterFor 三成员）零改动——
  `reportDrop` 是**泵内部依赖面**（DiagPumpDeps），不是 Host 诊断 seam 扩展。
- adapter 存储语义（单 record 同步 append）、`streamedNamespaces` seed 语义、legacy 路径行为、
  Runtime/复制路径零改动。
- 调度原语恒为裸 `setImmediate`（registry-surface 三正则有意不含该原语，#226 R4 注释契约）；
  不引入被守卫的 `setTimeout`/`setInterval`/`Date.now`。

## 2. 缺陷 → 设计映射总表

| 缺陷链（SA5） | AC | 设计回应 | 契约红→绿 |
|---|---|---|---|
| A：调度门只识别 running 态，burst 窗口每被接纳任务一个 setImmediate（上界 256） | AC1 | §4 单飞位（scheduled+running 合一） | R1a/R1b/R1c 红→绿；R1d 持续绿 |
| B：满队 drop-newest 结构性零上报（DiagPumpDeps 无健康通道） | AC3 | §5 `reportDrop` → observer `diag-pump-drop` | R3-2 红→绿；R3-1 持续绿 |
| C：entry collision / DOC_DUPLICATE 候选结局零发射 | AC4 | §6 候选级 emission（泵路径） | T-A/T-B 红→绿；T-C 对齐（§10） |
| G：AC2 防丢失不变量（现实现成立） | AC2 | §7 结构保持 + 证明 | R2a–R2d 持续绿（R2a 需机制对齐） |

## 3. 设计原则（继承冻结谱系）

1. **槽内 O(1)、槽外 drain**（ADR-0009 L62 + ADR-0014 amendment L250）：入队点（含丢弃上报）
   保持 O(1) 纯内存、非抛；一切可能触碰存储的 seam 调用仍在 macrotask drain。
2. **泵 ≠ adapter writer queue**（ADR-0014 L252）：每 record 仍由 drain 内一次同步单-record
   append 落盘；本设计不触发 batch/周期 flush/fsync/队列满四类语义义务；storage projection
   一字不动。
3. **producer 只做语义投影**（ADR-0011 L51 + CONTEXT.md「语义 emission」）：候选结局只用
   既有冻结词表与既有稳定 code；不发明 retryable/rollback/result:'unknown'。
4. **诊断失败零业务外溢**（ADR-0011 L20/L24）：新增的上报与发射路径全部在既有吞没边界内。
5. **低基数健康面**（ADR-0011 L87 + ADR-0014 L240 + ADR-0010 L159）：drop 上报载荷只有封闭
   维度（taskKind/operation/reason），namespaceId/streamId/token/SCHEMA/ROOT/owner 一律不进。

## 4. AC1 — 单飞状态机：`inflight` 位（scheduled+running 合一）

### 4.1 现缺陷机制（SA5 §1 复认）

`draining: Set<string>` 仅在 `drainNamespace` **回调体内** add（L107）、finally delete（L117）；
入队侧调度门 `!draining.has(ns)`（L134）在首 drain 触发前的 burst 窗口恒真 → 每个被接纳任务
各排一个 `setImmediate`（上界 = 容量 256，容量早退在调度语句之前）。这是实现与 #226 设计
冻结语义（「入队后若该 ns 未在 drain，则 setImmediate(drainNs) **一次**（单飞：drain 中重复
入队只补一次调度）」——`task_issue-226_design.md` §3.1）的偏差：设计意图的单飞位覆盖
**scheduled+running**，实现窄化为 running-only。

### 4.2 目标结构

```ts
// diag-pump.ts（结构性伪码——SA3 实现按此形状）
const queues = new Map<string, DiagPumpTask[]>();
const inflight = new Set<string>();   // 该 ns 存在 scheduled 或 running 的 drain（合一位）

function drainNamespace(namespaceId: string): void {
  for (;;) {
    const queue = queues.get(namespaceId);          // 每轮重取引用（既有结构，保持）
    const task = queue === undefined ? undefined : queue.shift();
    if (task === undefined) break;
    runTask(task);                                   // Host 可重入点（initStream/emit/resolver）
  }
  queues.delete(namespaceId);                        // 排空后内存卫生（保持）
}

function enqueue(task: DiagPumpTask): void {
  const namespaceId = task.namespaceId;
  let queue = queues.get(namespaceId);
  if (queue === undefined) { queue = []; queues.set(namespaceId, queue); }
  if (queue.length >= DIAG_PUMP_MAX_QUEUE_PER_NAMESPACE) {
    reportDropBounded(task);                         // §5：吞没式逐条上报（新增）
    return;
  }
  queue.push(task);
  if (!inflight.has(namespaceId)) {
    inflight.add(namespaceId);                       // ← 排定时置位（修复核心：覆盖 scheduled 态）
    try {
      setImmediate(() => {
        try { drainNamespace(namespaceId); }
        finally { inflight.delete(namespaceId); }    // ← 回调末尾清除（见 §4.3 时序论证）
      });
    } catch {
      inflight.delete(namespaceId);                  // setImmediate 本身抛（敌意全局）→ 位回滚，
    }                                                //    队列任务由后续入队补调度（enqueue 非抛契约）
  }
}
```

变化只有两处：(a) 位名与语义 `draining`（running-only）→ `inflight`（scheduled+running），
置位点从回调体**提前到排定点**；(b) 清除点从 drainNamespace 的 finally **移到 setImmediate
回调的 finally**（drainNamespace 完整返回之后）。`drainNamespace` 本体与 `runTask` 逐字节保持。

### 4.3 不变量证明（AC1 与 AC2 同时成立）

1. **AC1 单飞**：位置位先于 `setImmediate` 返回 → burst 窗口内后续入队见 `inflight.has(ns)`
   为真 → 不再排任务。单 ns 同时至多 1 个 scheduled/running drain；跨窗口持续入队时待触发
   drain 恒为 1（R1c：`pending.length === 1 < 50`）。
2. **AC2 无丢失（关键时序）**：drain 全程同步、无 await 点；Host 代码只能 inside `runTask`
   执行。drain 运行期位恒置 → 重入入队不补调度、任务落同一队列数组 → 循环每轮 `queues.get`
   重取引用 → 同轮消费（R1d/R2b）。循环最终空判（break）→ `queues.delete` → 回调 finally
   `inflight.delete` 之间**零 Host 可执行代码**（同步直线代码，无回调点）→ 不存在「队列空但
   位未清导致的漏调度」窗口；位清除后的首次入队必见位空 → 补调度 → 不丢（§3.1 静态论证
   1–4 全部保持）。
3. **stale/重复回调安全**：对已触发回调的再次调用（调度器违约形态，真实 `setImmediate` 不
   发生；契约测试人为制造）= `drainNamespace` 空跑 no-op（空判即 break、`queues.delete` 对
   缺键 no-op），不吞任务（R2a 语义）。**降级但安全**：若 stale 调用在另一活回调待触发期间
   运行，其 finally 会提前清位 → 后续入队可能补一次多余调度（退化为一次多余空跑 drain）——
   记录不丢、不重、次序不变；单飞不变量对**守约调度器**（每个回调恰触发一次）严格成立。
   不引入代际 token 防御该形态：真实原语不产生该交错，复杂度不成比例（§12 备选 B3）。
4. **坏修复反例被 R2 族锁死**（SA5 §3.3）：
   - 位在「循环空判后、Host 重入消费前」清除（典型坏形）→ R2b 红（末任务期重入任务丢失）；
   - 循环外缓存队列数组引用（重入建新数组、旧循环空转）→ R2a/R2b 红；
   - 位不提前到排定点（保持 running-only）→ R1a/R1b/R1c 红。
5. **per-ns 独立**：位与队列均按 namespaceId 独立——某 ns 存储挂起只饿死该 ns 自己的投递
   （#226 设计冻结语义保持）。
6. **内存有界**：位随回调 finally 清除、队列随排空删除——长期运行零泄漏（与现状同）。

### 4.4 与既有测试机制的兼容性

- 手工调度器替换 `globalThis.setImmediate`：泵以裸标识符调用、调用时点对 globalThis 求值
  （#226 契约既证）——本设计不改变引用方式，R1/R2/R3 的调度捕获机制原样可用。
- R1d/R2b/R2c/R2d/R3-1/R3-2 场景在修复后语义不变（逐用例推演见 §10.1 表）；**唯 R2a 需
  SA6 机制对齐**（§10.2）。

## 5. AC3 — 满队丢弃上报：`reportDrop` 泵依赖 → 内部 observer 事件

### 5.1 缺陷与义务

现实现满队 drop-newest 本体正确（R3-1 绿锚：保序、丢新），但结构性零上报（R3-2 红：44 条
丢弃零信号）。义务源：ADR-0011 L25「实现应尽力上报 dropped count、sink failure 和 queue
health」+ ADR-0014 L240「按 operation/reason 增加低基数 dropped metrics，并走独立 observer；
不得为了记录 drop 再挤占同一队列」。#226「泵满静默、Registry 不代发」的历史立场按 SA8 裁定
（冲突报告 §检查范围 L17 + 逐项说明 3）让位于上述义务。

### 5.2 泵边界 seam（契约锚点 `DiagPumpDeps.reportDrop?`）

```ts
/** 满队丢弃上报（可选依赖；满队 drop 点同步调用，恰一次/每被丢任务；泵侧 try/catch 收编）。 */
export type DiagPumpDropReport =
  | { readonly kind: 'emit'; readonly operation: NamespaceDiagnosticChangeEmission['operation']; readonly reason: 'queue-full' }
  | { readonly kind: 'init-stream'; readonly reason: 'queue-full' };

export interface DiagPumpDeps {
  readonly initStream: (namespaceId: string, genesisUpdateBytes: Uint8Array | undefined) => void;
  readonly resolveEmitter: (namespaceId: string) => NamespaceDiagnosticChangeEmitter | undefined;
  /** #249：满队丢弃健康上报（AC3/ADR-0011 L25、ADR-0014 L240）。缺席 → 静默（既有行为）。 */
  readonly reportDrop?: (drop: DiagPumpDropReport) => void;
}
```

- **载荷语义**：`kind` 复用任务判别元（`'emit' | 'init-stream'`）；emit 任务携带**该 emission
  自身的 operation**（封闭 6 值词表成员——泵同时承载 Runtime emissions（root-mutation 等，
  经 `resolveRuntimeDiag` 延迟 wrapper 入队），operation 必须取自被丢记录而非硬编码）；
  init-stream 任务**无 operation**（建流不是 record emission，无词表位——诚实缺席，不发明
  第 7 个 operation 值）。`reason` 恒 `'queue-full'`（v1 封闭 reason 维度）。
- **上报时机与成本**：drop 点同步调用（enqueue 内，槽内 O(1)）——不为记录 drop 排队、不占
  用同一队列（ADR-0014 L240 逐字）；频率以入队率为上界，聚合归 Host metrics adapter。
- **隔离**：泵侧 `try { deps.reportDrop?.(drop) } catch { /* 吞没 */ }`——上报通道违约绝不
  外溢（enqueue 非抛契约保持；dispatchObserver 亦有同款隔离，双层防御）。
- **每被丢任务恰一次**（SA6 契约锚注语义）：覆盖两类任务（emit 与 init-stream）。

### 5.3 落点：ADR-0009 L95 内部 observer seam 新事件

```ts
// observer.ts —— RegistryObserverEvent 联合新增变体（内部 seam 增量，#111/#112/phase-5/R2 同款先例）
| {
    type: 'diag-pump-drop';
    taskKind: 'emit' | 'init-stream';
    operation?: Operation;        // 仅 taskKind === 'emit' 时在场（= 被丢 emission 的 operation）
    reason: 'queue-full';
  }
```

- **为什么是新变体而非复用既有事件**：既有事件全部是「携带 identity + exact cause 的生命
  周期/故障」形态；drop 是低基数计数类健康事实——塞入 `lifecycle-slot-failed` 会污染其语义
  且强制携带 identity。联合按票增量是该 seam 的既定演进方式（#111 +2、#112 +3、phase-5 +4、
  133-R2 +1），非公共事件订阅面（ADR-0009 L95「v1 不提供公共事件订阅」保持——observer 类型
  不出 `src/index.ts`，仅构造 options/testing seam 注入）。
- **低基数红线**（ADR-0011 L87 + ADR-0010 L159 + SA8 红线 3）：事件载荷只有
  type/taskKind/operation?/reason 四个封闭维度；namespaceId/streamId/token/SCHEMA/ROOT/owner
  一律不进（metrics label 安全由构造保证，不依赖消费方自律）。
- **Host 兼容**：事件为加法变体；生产 Host 未注入 observer 时 dispatchObserver no-op（ drops
  静默——Host 的健康面选择，与全部既有事件同语义）。

### 5.4 接线（registry.ts → create-diagnostic.ts）

`createDiagRuntime(diagnosticLog, clock)` 增第三参（窄回调，保持 create-diagnostic 与
observer.ts 解耦）：

```ts
const { diag, resolveRuntimeDiag } = createDiagRuntime(options.diagnosticLog, clock, {
  reportPumpDrop: (drop) =>
    dispatchObserver(observer, {
      type: 'diag-pump-drop',
      taskKind: drop.kind,
      ...(drop.kind === 'emit' ? { operation: drop.operation } : {}),
      reason: drop.reason,
    }),
});
```

仅在**泵路径**构造泵时传入（legacy 路径无泵无丢弃；NOOP_DIAG 无日志无丢弃）。observer 缺席
时该回调仍可传入（dispatchObserver 自行 no-op）——泵级 seam 可测性与生产接线同构。

## 6. AC4 — 候选级 duplicate 诊断：发射点、词表映射、归属与边界

### 6.1 发射点（registry.ts，均在 retry return 之前、槽内 O(1)）

**点 1 — entry collision（L1311）**：

```ts
if (entries.has(id.key)) {
  diag.emitCandidateOutcome(id.namespaceId, undefined /* 候选未过 Clock 步 → 侧读一次 */, {
    stage: 'identity',
    code: 'NAMESPACE_ALREADY_EXISTS',
    result: { kind: 'rejected' },
    input: { status: 'not-accessed' },   // 碰撞判定只读 entries map——零输入访问（AC5）
  });
  return { kind: 'retry' };
}
```

**点 2 — Persistence DOC_DUPLICATE（L1410 catch 内）**：

```ts
if (cause instanceof DocDuplicateError) {
  diag.emitCandidateOutcome(id.namespaceId, p.createdAt /* 复用槽内 Clock 步——零额外读数 */, {
    stage: 'transaction',
    code: 'DOC_DUPLICATE',
    sourceModule: 'persistence',
    result: { kind: 'rejected' },
    input: { snapshot: { schema: p.schema, root: p.root } },  // 复用既有 detached frozen snapshot（AC5）
  });
  return { kind: 'retry' };
}
```

同时改写 orchestrateCreate 头注释（L1248–1254）：其「表达候选重试需要冻结 v1 词表之外的
retry result/correlation 形状」的立场已被 #249 推翻——每候选 = 一次独立 namespace-create
变更尝试（CONTEXT.md L148–150「被拒请求也属变更尝试」），`rejected` 结局在冻结词表内完全
可表达（§6.3）。

### 6.2 `CreateDiag.emitCandidateOutcome`（新方法）与路由

```ts
export interface CreateDiag {
  // …既有四方法零改动…
  /** #249：候选级被拒结局（entry collision / DOC_DUPLICATE）——仅 ns-bound（泵）路径发射；
   *  legacy 形状与日志禁用为 no-op。observedAt === undefined → 候选未过 Clock 步（碰撞在
   *  快照前）→ 读一次 clock；clock 故障 → 诚实缺席（丢弃该条，不伪造时间戳）。归属 =
   *  候选 namespaceId（碰撞时即既有 namespace 的流）；该 ns 无流时 genesis-less 补建一次。 */
  emitCandidateOutcome(namespaceId: string, observedAt: string | undefined, e: CreateEmissionArgs): void;
}
```

- **泵路径实现**：`ts = observedAt ?? readEarlyObservedAt(clock)`（undefined → 丢弃）→
  `assembleEmission(ts, e)`（undefined → 丢弃）→ `seedRejectedStreamIfAbsent(namespaceId)` →
  `enqueueEmit(namespaceId, record)`。与既有 `emitOutcome`（早结局泵投递）同构，复用同一
  吞没/组装/建流 seed 基础设施——零新机制。
- **legacy 路径实现 = no-op**（设计裁决，理由见 §6.5）。
- **NOOP_DIAG 单例**增 no-op 成员（日志禁用零行为）。
- `CreateEmissionArgs` 增可选 `sourceModule?: SourceModule`（缺省 `'registry'`——既有全部
  调用点零漂移）；`assembleEmission` 的 code↔sourceModule 成对展开改为采用该值。依据：
  ADR-0014 L89「code 与 sourcePhase …标注 source module」+ ADR-0011 L51「保留**所属模块**
  已有稳定 code」——`DOC_DUPLICATE` 的所属模块是 persistence；emitter 管线强制 code 与
  sourceModule 成对（pipeline.ts L239–250，单侧缺失即丢字段+健康事件）。

### 6.3 词表映射（既有冻结词表无损表达——零演进）

| 结局 | operation | stage | result | code | sourceModule | 依据 |
|---|---|---|---|---|---|---|
| entry collision | `namespace-create`（既有） | `identity`（既有 8 值） | `rejected`（预期失败零提交，ADR-0014 L80–87 判别联合） | `NAMESPACE_ALREADY_EXISTS`（types.ts L470 既有冻结稳定码——Registry「namespace 已存在」既有序列） | `registry` | ADR-0011 L51；ADR-0011 L40–49 stage 释义「identity：…namespace identity 不满足」；ADR-0014 L89 |
| Persistence duplicate | `namespace-create`（既有） | `transaction`（既有） | `rejected` | `DOC_DUPLICATE`（ADR-0006 #64 修订 L121–123 稳定码） | `persistence` | ADR-0011 L51「所属模块」；ADR-0006 #64 排他创建；#150 冻结映射表「持久层 duplicate → transaction / rejected / 快照已捕获」同款 stage 先例（registry.ts L1413 持久层运营失败 rejected 亦用 transaction） |

- **stage 选择论证**：entry collision 取 `identity` 而非 #150 映射表的 `acceptance`——
  `acceptance` 释义是「接纳**前**拒绝」（lifecycle/角色/授权门），而候选碰撞发生在 id 生成
  **之后**、候选身份判定处，`identity`（「namespace identity 不满足」）是逐字贴合的冻结值；
  且公共入口（真正的 acceptance 域）零改动。DOC_DUPLICATE 取 `transaction`——与既有持久层
  阶段结局（运营失败 rejected / fatal）同 stage，#150 映射表「持久层 duplicate → transaction」
  同款。两值均在 8 值封闭集内，**不触发** schema `@2` / 新 stream generation / 指纹钉死 /
  设计评审演进通道（SA8 逐项说明 4 两条合规路径之一，本设计取「既有词表」路径）。
- **code Pattern 合规**：两码均匹配 `P_STABLE_CODE`（ASCII 受控字符集 ≤128；schema-patterns.ts
  单源）——emitter intake（pipeline.ts L64–77）不会丢弃。
- **其余字段**：`source: {kind:'local'}`（assembleEmission 既有）；`attemptId` 省略 → 管线
  CSPRNG 生成（ADR-0014 L61–67）；不携带 issues/rawIssues（两类结局无 issues 载荷——零发明）；
  `result: {kind:'rejected'}` 无 update（ADR-0014 L80–87「rejected 禁止携带 update」）。

### 6.4 归属与建流（复用 #226 冻结基础设施）

- **归属规则**（SA8 红线 4）：两类碰撞候选 id **即既有 namespace 的 id**（entry 碰撞对 live
  entry；store 碰撞对已持久化 doc）→ 诊断归**候选 id 的流** = 既有 namespace 的流。目标 ns
  未启用日志时按 best-effort 缺席，不强行建流、不改业务状态。
- **建流交互**（`streamedNamespaces` seed 语义）：已建流（create#1 成功路径已入
  `enqueueInitStreamTask` 登记）→ 补记**不重复建流**（T-A：NS_A 流 2 条、initStream 仍恰
  1 次）；未建流（T-B：NS_A 只在 store 侧存在）→ `seedRejectedStreamIfAbsent` genesis-less
  补建恰一次（`initStream(ns, undefined)`——ADR-0014 L22「genesis 未成功写入时 stream 仍可
  记录诊断事实」）。per-ns FIFO 保证建流任务先于其后的候选结局记录（#150 DC-2 冻结次序）。
- **unattributed 通道恒零**：候选结局以候选 id 数据键控投递（C1 竞态类别不存在——与
  emitOutcome 同构）；发射点缺席缺陷修复后 `unattributedDrops === 0`（T-A/T-B 断言）。

### 6.5 路由边界：legacy 形状 no-op（设计裁决 D-1）

**裁决**：候选级结局只在**泵路径**（seam 提供 `runtimeEmitterFor` 的生产形状）发射；legacy
形状（#150 时代共享 emitter Host）与日志禁用均为 no-op。

**依据**：

1. AC4 的对象是「**到正确 namespace 的诊断流**」——ns-bound 归属通道只在泵路径存在；legacy
   形状只有共享通道，无「namespace 的诊断流」概念。
2. 既有绿灯冻结契约 `registry-create-diagnostic-red.test.ts` L529–552（legacy 形状 +
   DOC_DUPLICATE 内部重试）断言「attempt 记录恰 1 条（最终 committed）」——legacy 发射候选
   结局将使其永久红。#226 设计明文冻结 legacy「逐字节现行——#150 冻结契约零漂移面」
   （create-diagnostic.ts 文件头）；本设计不扩大 #249 的爆炸半径去改写 #150 冻结契约。
3. ADR-0011 L57 的覆盖义务在生产装配（apps/yjs-server `createHostDiagnosticsManager`
   runtimeEmitterFor 形状）上兑现；legacy 形状的候选结局缺席属 L23 best-effort 允许域
   （「日志允许缺失」），且 #150 冻结契约本身即当时对该义务的裁决载体。
4. SA6 验证记录预期「修复（SA3）+ SA4/SA7 双清后全量转绿」——legacy no-op 是全量转绿的
   必要条件。

**锁定**：新增回归锁 §13.3-c（legacy 形状下 entry collision + DOC_DUPLICATE 仍恰一条最终
结局记录）把该裁决钉死。

### 6.6 重试预算耗尽终局：不发诊断记录（设计裁决 D-2，解决 #226 §1.5 登记未预裁项）

**裁决**：预算耗尽（`throwIdGenerationFatal` → branded `NamespaceRegistryFatalError`
committed:false / phase='namespace-id-generation'，ADR-0010 L28）**不发射诊断记录**——维持
现状 observer-only（`create-id-generation-failed` 事件，ADR-0009 L95 seam）。**但链内每个
碰撞候选照常发 rejected 记录**（与 T-A 同一发射点、同语义——候选级覆盖统一，无特例分支）。

**依据**：

1. ADR-0011 L57 首版覆盖域枚举（输入、schema、ROOT、**duplicate、Persistence** 与
   post-commit Runtime construction 结局）**不含** id 生成耗尽；扩域属新决策，非本票义务。
2. **归属不可用**：终局属公共 create 级 fatal，无归属 id——归到最后一个碰撞候选（既有
   namespace）的流是语义发明（该 fatal 不是那个 ns 的生命周期事实）；走共享/unattributed
   通道在生产 Host 是恒丢弃+计数（不可见的噪音，且污染 `unattributedDrops` 观测）。
3. 运营可见性已有双通道：内部 observer 事件（owner/attempt/cause）+ 公共 fatal 错误本体
   （调用方可见的 authoritative 终局）。
4. 保守解决登记未预裁项，零词表/归属发明风险。

**后果**：T-C 修复后 NS_A 流 = 1 committed（create#1）+ 9 rejected identity（create#2 的
碰撞候选，各侧读一次 clock）；零 fatal 记录、零补建流、unattributed 恒零——**T-C 现断言
`nsARecords.length === 1` 将转红，须按本裁决对齐**（§10.4，SA6 契约注记预留的对齐点）。

**已否决备选**：E2 终局 fatal 归最后候选流（归属发明 + 污染无关 ns 流）；E3 终局 fatal 走
共享/unattributed 通道（生产不可见噪音 + 与「公共入口 pre-id 拒绝走共享通道」的 #226 裁决
域混淆——该裁决覆盖的是 id 生成**之前**的公共入口拒绝，本终局在 id 链之后）。

### 6.7 observedAt / Clock / 输入纪律（AC5 + DC-3 兼容）

- entry collision：候选未过 Clock 步（碰撞判定在快照前）→ `emitCandidateOutcome(ns,
  undefined, …)` 侧读一次 clock（`readEarlyObservedAt` 既有非抛边界；clock 故障 → 该条诚实
  缺席）。**DC-3 逐尝试恰一次读数**保持（每候选一次，与 #226 早结局同款）；业务路径 clock
  读数零变化（碰撞判定本身不读 clock——`registry-create.test.ts` L1565 锚（无 diagnosticLog
  场景）不受影响；该测试无日志注入，诊断侧读数与其计数器无交集）。
- DOC_DUPLICATE：复用 `p.createdAt`（该 create 编排的首候选槽内 Clock 步产物，retry 候选经
  `preparedBox` 复用——零额外读数；L1565「DOC_DUPLICATE 重试不重复读」保持）。
- 输入：entry collision `input: {status:'not-accessed'}`（碰撞判定只读 entries map——零
  trap/零访问）；DOC_DUPLICATE 复用既有 detached frozen snapshot（不重读、不建第二套序列
  化——AC5 逐句对齐 ADR-0011 L69–77）。

## 7. AC2 — 守护锚保持（结构不变项清单）

| 结构 | 状态 | 锁 |
|---|---|---|
| drain 全程同步、无 await 点 | 保持 | R2a–R2d |
| 循环每轮 `queues.get(ns)` 重取引用 | 保持（§4.2 显式） | R2a/R2b |
| `runTask` 逐任务 try/catch 收编（resolver 违约 undefined / initStream throw / emitter throw） | 保持 | R2d |
| 非 running 态入队恒有 ≥1 个待执行或可补 drain | 保持（§4.3-2 证明） | R2a/R2b |
| 排空后 `queues.delete` 内存卫生 | 保持 | R2d（`pending.length===0`） |
| per-ns FIFO、initStream 先于其后 emission | 保持（队列结构零改动） | R2c |

## 8. AC6 / 业务不变量 — 零影响论证

- 新增全部诊断动作（候选 emission 组装、enqueue、reportDrop、observer dispatch）均在既有
  吞没边界内、O(1) 纯内存、槽内非抛或槽外 drain——不改 create 返回值、提交事实、sequencer
  顺序、Persistence 状态（ADR-0011 L20 逐字）。
- 业务冻结面逐项不动：8 次重试预算与候选再生成（T-A/T-B `createCalls` 序列锚）、成功重试
  恰一条最终 create 结果、耗尽 `committed:false` branded fatal（T-C）、`DOC_DUPLICATE` 判定
  不覆盖已提交内容（ADR-0006 #64——诊断只观察）、create lifecycle 槽串行化与 carrier FIFO
  （ADR-0009 L62/#131 L140——发射点在槽内 O(1)，无让渡）。
- shutdown 零耦合保持：泵不注册 disposer、不清泵、不等待（ADR-0011 L129）——`reportDrop`
  与候选发射不改变该结构。
- initStream/resolver/emitter 违约隔离：全部走既有 `resolveEmitterOnce`/runTask/assemble
  吞没边界——R2d 持续绿。

## 9. 改动面与冻结面汇总

**改动**：§1 表（4 个 src 模块 + 2 个契约测试文件）。**冻结**：namespace-diagnostic-log
整包、index.ts 公共面、Host seam 类型、legacy 路径行为、adapter 存储语义、
`streamedNamespaces` seed 语义、调度原语（裸 setImmediate）、registry-surface 三正则守卫面。

## 10. 红灯契约对齐需求（SA6 owned——本设计新发现，须在 SA3 修绿前落地）

### 10.1 契约现状 vs 修复后行为推演

| 用例 | 现判定 | 修复后 | 相容性 |
|---|---|---|---|
| R1a/R1b/R1c | 红 | 绿（scheduleCount=1 / fired=1 / pending=1） | ✅ 断言原样转绿 |
| R1d | 绿 | 绿（running 期位恒置 → 不补调度；同轮消费） | ✅ |
| R2b/R2c/R2d | 绿 | 绿（结构保持；推演见 §4.3/§7） | ✅ |
| R3-1 | 绿 | 绿（丢弃本体零改动） | ✅ |
| R3-2 | 红 | 绿（44 条 emit 丢弃逐条上报） | ⚠ 载荷类型需对齐（§10.3） |
| T-A/T-B | 红 | 绿（§6.4 推演逐条命中断言） | ✅ |
| T-C | 绿（业务锚） | **红**（9 条碰撞候选 rejected 记录 → length=10≠1） | ⚠ 须按 D-2 对齐（§10.4） |
| R2a | 绿 | **红**（第三次 `flushOne` 抛 no pending——机制依赖被消灭的重复调度） | ⚠ 须机制对齐（§10.2） |

### 10.2 R2a 修订（stale 回调探针的制造机制）

**问题**：R2a 三次 `flushOne` 的编排隐含依赖旧泵的重复调度（第二次 enqueue 排 S2）。修复后
全场景仅产生 2 次调度 → 第三次 `flushOne` 抛 `no pending immediate to flush`，绿锚被修复
本身击穿。

**对齐方向**（保留断言语义：stale no-op、零丢失、FIFO）：以**显式重调被捕获回调**制造
stale——例：入队(1) 捕获 `pending[0]` 回调 → `flushOne()`（活 drain 投递 1）→ 入队(2) 排
新回调 → **手动重调捕获的旧回调**（stale：空队 no-op、不吞 2）→ `flushOne()`（投递 2）→
断言 `delivered === [0001, 0002]`。该形态直接探针「重复触发已触发回调」的违约域，不再依
赖缺陷本体；调度器加捕获/重调辅助或直接访问 `s.pending` 均可（SA6 定形）。

### 10.3 R3-2 修订（载荷类型对齐）

**问题**：契约注记锚定「每被丢任务恰一次」，但测试本地 `DropReport = {operation: string;
reason}` 与泵载荷 `(drop: {operation: string; reason}) => void` 的 `satisfies` 组合**无法**
给 init-stream 丢弃一个诚实的 operation（无词表位）。§5.2 的判别联合（`kind` 判别 + emit
分支带 operation）是唯一不发明词表值的诚实形状；联合与测试本地类型的逆变赋值在
`--typecheck` 下必失败（sa6 运行日志含 Type Errors 面板——typecheck 开启）。

**对齐方向**：测试本地类型改为按 `kind` 收窄的联合（或直接 import 泵导出的
`DiagPumpDropReport`）；既有断言全数保留（44 条 emit 丢弃 `operation === 'namespace-create'`、
`reason === 'queue-full'`）。契约锚注同步改写为判别联合形状。**此为契约自身预留的对齐通道**
（「SA1 设计若选不同 seam 形状/命名，须经 SA6 对齐修订本契约」）。

### 10.4 T-C 修订（耗尽链路断言——契约预留的「设计冻结后对齐」点）

按 D-2 对齐：业务锚不变（branded fatal / committed:false / phase='namespace-id-generation'）
+ 诊断面新断言：NS_A 流 = 1 committed + 9 rejected（全部 operation='namespace-create'、
result rejected、零 fatal kind 记录）+ NS_A initStream 恰 1 次（create#1，零补建）+
`unattributedDrops === 0`。

### 10.5 对齐修订的流程建议

三处修订均为**测试力学/断言对齐**（无规范语义变更）；按 #226 先例
（`task_issue-226_red_contract_rev1_conflict_recheck.md`），建议 SA6 修订定稿后附一次轻量
契约级冲突复检（触发面仅上述三处），再交 SA3 修绿。

## 11. ADR 红线对照（逐条自检）

| 红线（SA8 冲突报告 §结论 + 决议摘录） | 本设计落点 | 判定 |
|---|---|---|
| 词表冻结：operation/stage/result/code/sourceModule/reason 不发明；不够则走 `@2`+新 generation+指纹+评审通道；v1 不写 `result:'unknown'` | §6.3 全部取既有冻结值；零演进 | ✅ |
| 泵 ≠ adapter writer queue：单 record 同步 append、storage projection 不动、不触发 L252 义务 | §3-2/§9 冻结面 | ✅ |
| 健康上报低基数：operation/reason 封闭维度；ns/streamId/token/SCHEMA/ROOT/owner 不进 label；不占同一队列；走 ADR-0009 L95 seam；不新增公共面 | §5.2/§5.3（四封闭维度字段；drop 点同步直报；observer 内部 seam 增量变体；index.ts 零改动） | ✅ |
| 归属与业务不变量：归既有 ns 流；未启用日志 best-effort 缺席；8-retry/单一最终结果/耗尽 fatal/不覆盖已提交/槽串行化零变化 | §6.4/§8 | ✅ |
| 输入零访问 + 单一 detached snapshot（ADR-0011 L69–77） | §6.7 | ✅ |
| 隔离义务（L20/L24）：诊断失败零业务外溢、emitter 不被 await、shutdown 不无限等待 | §8 | ✅ |
| 调度原语：不引入被 registry-surface 三正则守卫的裸 `setTimeout`/`setInterval`/`Date.now`；setImmediate 为许可原语 | §4.2 唯一原语不变 | ✅ |
| 每次变更尝试恰一次 clock 读数（DC-3） | §6.7（每候选一次；业务路径零变化） | ✅ |
| 排序：日志不引入第二业务排序机构（ADR-0011 L123–129） | 诊断面 per-ns FIFO 既有秩序保持；业务槽序零触碰 | ✅ |

## 12. 备选方案与否决理由

| # | 备选 | 否决理由 |
|---|---|---|
| A1 | 保留 running-only 门 + 入队侧去重计数（如 token 比较） | 治标：仍无 scheduled 态记录；窗口判定逻辑分散；与 #226 冻结语义（合一位）相悖 |
| A2 | 微任务级 deferral 替代 setImmediate | #226 设计敏感点 1 已裁决否决（T9/T13 语义要求 macrotask；注入 scheduler 结构性不可用）——本票不重开 |
| A3 | 每 ns 代际 token 防「回调重复触发」 | 防御真实原语不产生的违约；复杂度/审查面不成比例；该形态下降级但安全（§4.3-3） |
| B1 | drop 上报载荷恒 `{operation, reason}`，init-stream 丢弃硬编 `operation:'namespace-create'` | 词表谎言（泵承载多 operation 的 Runtime emissions；建流无 operation 词表位）；违反诚实缺席纪律 |
| B2 | drop 上报走 Host `diagnosticLog` seam 新成员 | SA8 已裁定落点 = ADR-0009 L95 observer seam；Host 诊断 seam 是记录通道不是健康通道；扩展面更大 |
| B3 | drop 事件走既有 `lifecycle-slot-failed` 等事件 | 语义污染 + 强制 identity 载荷 + 违反低基数红线 |
| C1 | 候选结局也在 legacy 路径发射（共享 emitter） | 击穿 #150 冻结契约绿锚（L529 恰一条）；AC4 语义（ns 流）在 legacy 无承载；爆炸半径不必要（§6.5） |
| C2 | 词表演进（新 stage/attempt 关联形状）承载候选链 | 既有词表无损可表达（§6.3）；演进通道成本（`@2`+generation+指纹+评审）无必要——SA8 两条合规路径中取轻者 |
| E2/E3 | 耗尽终局发 fatal（归最后候选流 / 走共享通道） | §6.6 已否决（归属发明 / 生产不可见噪音） |

## 13. 测试与验收要求

### 13.1 红→绿（AC7）

SA6 两契约文件（经 §10 对齐后）：R1a/R1b/R1c、R3-2、T-A、T-B 六红转绿；R1d、R2a（修订版）、
R2b–R2d、R3-1、T-C（对齐版）持续绿；PR #248 实现对该批契约失败已经 SA6 R0 实证（6 红）。

### 13.2 既有绿基线保持（防回退面）

SA5 基线 5 套件 94/94（`registry-issue-226-red`(13)、`registry-create-diagnostic-red`(16)、
`registry-create-diagnostic-code-source`(6)、`registry-create`(47)、`registry-surface`(12)）
必须全绿——关键锚：L529（legacy 恰一条——由 §6.5 no-op 裁决保证）、L1565 clock 锚（无日志
场景，不受诊断侧读数影响）、sa7-dynamic 全路径业务结局摘要（零业务漂移）。全量 `pnpm test`
转绿为完工门（AC8）。

### 13.3 新增覆盖（设计要求，随 SA6 对齐/SA3 实现落地）

- **a. R3-3（init-stream 丢弃上报）**：满 emit 队列 + 追加 init-stream 任务 → 被丢 →
  `reportDrop({kind:'init-stream', reason:'queue-full'})` 恰一次（无 operation 字段）；修复前
  红（零上报）、修复后绿。
- **b. observer 落点锁**：registry 级测试——注入 observer，制造满队丢弃 → 收到
  `{type:'diag-pump-drop', taskKind, operation?, reason}`；断言载荷**不含** namespaceId/
  streamId/token（低基数锁）；observer throw 时业务结果与后续投递零影响（隔离锁）。
- **c. legacy no-op 锁**：legacy seam 形状下 entry collision + DOC_DUPLICATE 内部重试 →
  attempt 记录仍恰 1 条最终结局（把 §6.5 裁决钉为契约）。
- **d. sourceModule 成对锁**：DOC_DUPLICATE 候选记录 `code==='DOC_DUPLICATE'` 且
  `sourceModule==='persistence'`；entry collision 记录 `code==='NAMESPACE_ALREADY_EXISTS'` 且
  `sourceModule==='registry'`（防单侧缺失被管线静默丢字段）。

### 13.4 AC8 验证命令（后台进程执行；SA3/SA7 阶段）

```text
pnpm exec vitest run packages/namespace-registry/test/registry-issue-249-pump-red.test.ts \
  packages/namespace-registry/test/registry-issue-249-duplicate-red.test.ts
pnpm exec vitest run packages/namespace-registry/test/registry-create-diagnostic-red.test.ts \
  packages/namespace-registry/test/registry-create-diagnostic-code-source.test.ts \
  packages/namespace-registry/test/registry-issue-226-red.test.ts \
  packages/namespace-registry/test/registry-create.test.ts \
  packages/namespace-registry/test/registry-surface.test.ts
pnpm typecheck && pnpm test && git diff --check
```

## 14. 模块/版本要求与冲突复审结论

- **版本/schema**：`namespace-diagnostic-log` 零改动 → 指纹 `sha256:v1:dedad2ab…` 不变、
  schema id 不升 `@2`、无新 stream generation、update-omitted reasons 不动；两包无版本号/
  changeset 联动要求（仓库未见该机制——发布流程属 issue-runner 域）。
- **公共面**：`src/index.ts` 零改动（registry-surface 守卫绿即证）；`RegistryObserverEvent`
  增量为**内部 seam** 演进（构造 options/testing 注入面，#111/#112/phase-5/R2 先例），非
  ADR-0009 L95「v1 不提供公共事件订阅」的违反。
- **冲突复审结论**：**requiresConflictRecheck = false**——本设计全部决策（单飞位、reportDrop
  载荷与 observer 落点、候选词表映射、legacy no-op、耗尽 observer-only）均在 SA8 前置门禁
  clear 所覆盖的 ADR-0011/0012（诊断格式）/0009/0006/0010 既有条款兑现域内，无新规范决策、
  无词表演进、无公共面变更、无 ADR 文本修改。唯一建议：SA6 按 §10 完成契约对齐修订后，依
  #226 先例对**修订后的契约**做一次轻量冲突复检（触发面仅 §10.2/§10.3/§10.4 三处测试力学
  对齐）——该复检属流程卫生，非本设计的规范冲突信号。

## 15. 风险与开放点

| # | 风险 | 缓解 |
|---|---|---|
| 1 | SA6 契约对齐（§10）未在 SA3 修绿前落地 → 修绿运行被绿锚击穿（R2a/T-C） | §10 已给出逐条对齐方向；对齐属契约预留通道；顺序：SA6 对齐 → SA3 修绿 |
| 2 | 全量 `pnpm test` 中存在未扫描到的计数锚测试受候选 emission 影响 | 已扫描诊断 5 套件 + create + surface：唯一计数锚为 L529（legacy，由 no-op 裁决保证）；SA3 全量跑 + SA4/SA7 双清兜底 |
| 3 | Host observer 消费方对新增事件变体的穷尽 switch 编译失败 | 加法变体；已核 yjs-server 生产装配经 `createNamespaceRegistryPlugin` 构造 Registry 时**未注入 observer**（app.ts L214–221 仅 idleTimeoutMs + diagnosticLog）→ 生产零编译/行为面变化，直至某 Host 主动选择观测；testing seam 注入方为数据回调，无穷尽 switch 消费面 |
| 4 | 碰撞链诊断侧 clock 读数放大（每候选一次） | DC-3 逐尝试单读保持；读数非抛隔离；无既有计数锚受影响（唯一 clock 锚在无日志场景） |
| 5 | stale 回调重调形态下的瞬时多余调度（§4.3-3 降级态） | 记录零丢失/零重复/保序；单飞不变量对守约调度器严格成立；文档化为已知降级域 |

## 16. 结论

设计覆盖 AC1–AC8 全部验收面：AC1 以 scheduled+running 合一单飞位修复且逐条证明 AC2 守护
不变量；AC3 以 `DiagPumpDeps.reportDrop`（判别联合、逐条、低基数、不占队列）落
ADR-0009 L95 observer 新事件 `diag-pump-drop`；AC4 以 `emitCandidateOutcome` 在两 retry 分支
补候选级被拒 emission（既有冻结词表零演进、归候选 id 流、legacy no-op、耗尽 observer-only）；
AC5–AC6 由既有吞没边界与零业务面改动保证；AC7–AC8 给出契约对齐需求与验证命令。无需冲突
复审；无实现阻塞点。交付 SA2 评审 → SA6 契约对齐 → SA3 实现。

Verdict: clear
