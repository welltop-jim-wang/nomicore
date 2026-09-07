# 架构设计 — issue #239: periodic reconciliation 的 no-op 与有效同步可观测性

> 阶段：architecture design（SA2）。Issue comments 已于本阶段派发前完整读取：**0 条评论，无额外 Owner 要求**。
> 前置输入（全读）：
> - 任务简报：`wiki/raw/task_issue-239-periodic-noop-observability.md`
> - SA8 冲突门禁 `clear` + 相关决议：`..._conflict_report.md` / `..._relevant_decisions.md`
> - SA5 故障分析（缺陷确认，20/20）：`..._failure_analysis.md` + `..._repro.log`
> - SA6 红灯验收契约（10/10 按预期失败）：`..._ac_red.md` + 两份 log；
>   契约测试 `packages/ws-replication/test/ws-replication-issue239-ac-red.test.ts`（冻结，修复后不改即绿）
>
> 本设计为唯一裁决文档：SA3 实现须逐条落实 §4/§5/§6；验证命令见 §7；协议假设依据见 §8。
> 硬约束（任务派发令 + SA8）：**不改 wire bytes；不改 §9.4/§16 状态机；§23 append-only 演进
> （含 safe-digest 语义字段按 §23.3 注册）；observer gating；syncRoundId 限定单连接代际。**

---

## 0. 设计目标：让 issue 的四个问题在观察面上可回答

生产现象（简报 §Summary）：已收敛副本的每个 periodic round，双方 `sync-step2-sent` /
`sync-diff-applied` 恒为非零 bytes（生产 1,272 B / 本地 fixture 9–10 B），观察面无法区分
健康 no-op round 与真正 convergence defect 修复 round。SA5 已证明根因链：

- R1（协议层，非缺陷）：Yjs「空 diff」结构性非零（§9.2 允许空 diff，但编码无规范零长；
  最小探针 2 B `[0,0]`）⇒ `bytes > 0` 恒真，判据失效；
- R2（缺陷本体）：§23 两事件只投影 `byteLength`，无 round 关联、无语义效果字段
  （四处发射点 + `types.ts` L336-350 实证）。

修复后，诊断 Adapter 只消费 observer 事件即可回答 issue 的四问：

| issue 的问题 | 修复后的回答途径 |
|---|---|
| round 前后 state vector 是否变化 | `sync-diff-applied.stateVectorChanged`（+ `stateVectorBeforeHash`/`AfterHash` 佐证） |
| apply 是否推进了文档状态 | `sync-diff-applied.applyEffect ∈ {changed, noop}`（由 before/after SV 派生，非 byteLength） |
| encoded update 是否只是格式非零但语义 no-op | `bytes > 0 ∧ applyEffect='noop'` 并存即明示（no-op round 的可观测化） |
| 两端是否反复认为同一历史缺失 | 以 `syncRoundId`（+ `namespaceId`/`connectionId`）做 round 级关联：逐 round 比较双侧 before/after hash——双侧 after-hash 相等且逐 round 不变 ⇒ 健康 no-op；hash 逐 round 持续变化且持续 changed ⇒ 需要调查。boolean 字段无法跨侧比对，hash 字段是该判别的最小安全载体 |

转绿判据：SA6 红灯契约测试 `ws-replication-issue239-ac-red.test.ts` **不改一字转绿**
（红灯失败点全部且仅为缺 `syncRoundId`/`encodedUpdateBytes`/`stateVectorChanged`/`applyEffect`）。

## 1. 非目标（显式不做清单）

| 不做 | 依据 |
|---|---|
| 不改任何 wire 字节（codec / 消息注册表 / §3 envelope / §9 帧字段） | §23「local，非 wire 契约」；任务硬约束 |
| 不改 §9.4 周期 reconciliation 状态机与 §16 peer namespace 状态机（timer 武装/清理、`live → reconciling → live`、round 收口全不动） | 任务硬约束；红灯契约的守护断言（回 live、roundId 单调 +1）持续把守 |
| 不 rename / 不删除 / 不重解释既有 `bytes` 字段；不新增事件型（维持 20 型） | §23「只增不改；GA 后字段语义冻结」+ SA8 注记 2 |
| 不给 `update-sent`/`update-applied`/`update-acked`/`bootstrap-*`/`degraded-bypass-applied` 追加新字段 | 混淆面是 sync round 专属（AC 只要求 sync 两型）；append-only 以后可扩 |
| 不设计任何跨连接/跨重启的 round 关联状态（无全局 round 映射、无持久化字段） | §21：进程重启丢弃 syncRoundId ⇒ 关联域 = 单连接代际（SA8 注记 4） |
| 不把 `applyEffect` 塞进 session/lease status，不断言 noop round 无 dirty / 不置 unvalidated | ADR-0010 #134 R2-7 正交两维（SA8 注记 1）；`applyEffect` 只否定 SV 推进 |
| 不暴露 live Y.Doc / raw session；SV 捕获只经 session 受控能力 `encodeStateVector` | ADR-0012 被否决方案；ADR-0010 L81-88 能力词汇 |
| 不扩 Runtime capability status；捕获/比较不进 Registry write sequencer 槽 | ADR-0008 L40/L101；§23.4「永不位于 sequencer 槽内」 |
| 不给默认 metrics 加高基数 label（syncRoundId / hash 不入默认 label） | §23.6 + issue「avoid default metrics label」 |

## 2. 设计裁决（D1–D8）

**D1 字段集（§23.1 append-only）**
- `sync-step2-sent`（hub/peer 两发射点）追加：`syncRoundId: number`（必在）、`encodedUpdateBytes: number`（必在，恒 === `bytes`）。发送不推进发送方 SV，效果字段在 sent 侧语义无定义——不加（红灯契约 §2.3 同款豁免）。
- `sync-diff-applied`（hub/peer 两发射点）追加：`syncRoundId: number`、`encodedUpdateBytes: number`（均必在）+ **效果字段组** `stateVectorChanged?: boolean`、`applyEffect?: 'changed' | 'noop'`、`stateVectorBeforeHash?: string`、`stateVectorAfterHash?: string`。
- 效果字段组**单命运**（single fate）：两次 SV 捕获均成功 → 四字段全在；任一捕获 throw（折叠）→ 四字段**整组缺失**（事件与其余字段照常发射）。绝不伪造 `noop`，绝不部分出现（conformance 一致性断言把守）。

**D2 `syncRoundId` 的投影路径（wire 既有事实，零 wire 变化）**
- sent 侧：RoundEngine `send` 回调的既有 `SYNC_STEP2` 分支直接取 `message.syncRoundId`（帧内已有，§9.2）。
- applied 侧：把收到的 Step2 帧 roundId 经 `RoundHost.applyStep2` 回调**第三参数**显式透传（`onStep2` 已校验 `message.syncRoundId === currentRound` 后调用，round-engine.ts L134-152）。与既有 `step2Sequence` 透传完全同构（precedent：宿主 `applyStep2` 已接收帧序用于 SYNC_APPLIED，peer-namespace.ts L1005-1026 / hub-namespace.ts L834-853）。
- 备选（否决为次选）：宿主在 `applyStep2` 入口同步读 `this.round.currentRound`——数值等价（onStep2 校验后同步调用链内 state 不可变），但投影「帧携带的 wire 事实」语义更弱、对引擎内部重构脆弱。选显式透传；round-engine.ts 改动为纯参数化（接口签名 + 两个透传点），**零状态机逻辑变化**。

**D3 SV 捕获与效果派生（observer gating + §23.4 纪律）**
- 捕获能力：`session.encodeStateVector()`（replication-session.ts L409-414；读取面、同步、session 终态时同步 throw `ReplicationSessionClosedError`——该 throw 是真实路径，走折叠）。
- before 捕获：`applyRemoteUpdate` 内、调用 `session.applyRemoteUpdate(update)` **入队之前**的同步段（与既有 `t0` latency 采样同点、同纪律——帧分发同步段，完整覆盖 sequencer 排队），门控 `isStep2 && this.observerOn`。UPDATE 路径（`isStep2=false`）零新增读取。
- after 捕获：`await pending` 结算且 `result.ok` 之后的**结算续体**内（事件发射同点；该点已有 `degradedBypassActive()` 投影读取先例，peer-namespace.ts L1053-1081/L1108-1123）。使用**接纳时捕获的同一 `session` 局部引用**（ provenance = 实际执行该 apply 的 session；期间 session 被关闭 → throw → 整组折叠）。
- 比较：字节逐位相等（长度 + 循环）⇒ `stateVectorChanged = !equal`；`applyEffect = equal ? 'noop' : 'changed'`。
- **窗口语义（文档化诚实口径）**：效果 = 本侧「Step2 接纳（帧分发同步段）→ apply 结算」窗口内 state vector 是否推进。窗口内其他写（本地写 / 交错 UPDATE 的 sequenced apply）的效果如实计入——这是**观测投影，非因果归因**。受控场景（round 内无其他写，红灯契约两场景即此）下窗口增量 ≡ round 级增量，契约断言成立。
- 折叠实现：`observer.ts` 新增 `safeStateVector(read): Uint8Array | undefined`（try/catch → undefined，与既有 `safeNow` L125-131 同款）。
- peer degraded 分支：degraded Step2 apply 仍发 `degraded-bypass-applied`（互斥规则不动、不加新字段）；捕获照做但效果字段组不附着（丢弃）——degraded 判别在结算后才可得，before 已捕获，成本有界（每 Step2 apply 至多 2 次 SV 读取 + 2 次 digest）。

**D4 safe-digest 算法（§23.3「documented safe digest」注册形态）**
- 算法：**双泳道 FNV-1a-32**——泳道 A 正序扫 raw 编码 state vector 字节、泳道 B 逆序扫同一字节；两泳道均 offset basis `2166136261`、prime `16777619`、模 2³²（`Math.imul(h ^ b, 16777619) >>> 0`）。输出 = 泳道 A 8 位小写 hex ∥ 泳道 B 8 位小写 hex，**恒 16 字符**（零填充）。
- 选型依据：同步可算（发射点同步段；webcrypto.subtle 异步不可用）；零依赖、Node/浏览器同构（Cordis peer 宿主不定）；确定性；有效 64 位判别宽度满足跨侧/跨 round 关联（collision 面 ~2⁻⁶⁴·事件对数）。**用途 = 关联/相等判别，非保密**（SV 本身不属 §23.3 禁泄类别；禁的是 raw 字节载荷与高基数不可控字段——digest 是派生定长字符串）。
- 不选 keyed：跨侧关联（hub after-hash vs peer after-hash）要求两端同 key，而 key 无跨进程分发渠道；issue 授权形态本就是「keyed **或** documented」，取 documented。
- 落点：`observer.ts` 纯函数 `stateVectorSafeDigest(sv: Uint8Array): string`（+ `stateVectorBytesEqual(a, b): boolean`），经 `src/testing.ts` 显式测试面导出（`@nomicore/ws-replication/testing` 子路径已存在），**不进 `src/index.ts` 生产 API**。
- 算法一经注册即冻结（GA 纪律）；若未来需要更强 digest，append-only 新增另一字段，不修改本字段。

**D5 事件形状（types.ts 精确类型）**——见 §3 代码块；`syncRoundId`/`encodedUpdateBytes` 为必在字段（数据源无失败模式：帧内既有 + `byteLength` 属性读），效果字段组为条件存在（`?`，exactOptionalPropertyTypes 下字段缺失而非 undefined 值——与 `applyLatencyMs?` 缺 clock 先例同形）。

**D6 conformance 键集冻结白名单与 api 型断言同步 append**（SA8 注记 6 / 红灯契约 §6.3）：
`ws-replication-observer-red.test.ts` ALLOWED_KEYS 两行 + 数值守卫名单 + 新一致性/文法断言；`ws-replication-api.test-d.ts` L246-247 union 成员形状同步追加。不同步则实现后 conformance/type-test 红。

**D7 协议文档落点 = `docs/protocols/instance-replication-v1.md` §23 append-only**（issue #231 先例：commit 4323118/#240 直接改协议文档，无 ADR 修订节；ADR-0010 #172 修订节 2：wiki/raw 非规范）。§9/§16/§18/§21 一字不动。

**D8 测试策略**
- 红灯契约 `ws-replication-issue239-ac-red.test.ts`：**冻结不改**，修复后不改一字转绿。
- SA5 复现 `ws-replication-issue239-repro.test.ts`：按 failure_analysis §3.3 预告的翻转，把「缺陷在场」断言改为「修复后语义」断言（§6 T3）。
- conformance 扩展：白名单 append + 效果字段组一致性/文法/单命运断言 + helpers 单元面（testing 子路径）。
- 回归面：periodic-reconcile / ac4 / ac5 / issue231（SA5 已建回归清单）+ 包 typecheck + 根 `pnpm typecheck` / `pnpm test`（包 AGENTS 验证门：observer/lifecycle 相邻变更）。

---

## 3. 新增事件字段精确语义（§23.1 注册口径）

```ts
// packages/ws-replication/src/types.ts（改写 L336-350 两成员；其余 18 型不动）
| {
    readonly type: 'sync-step2-sent';
    readonly side: ReplicationObserverSide;
    readonly connectionId?: string;
    readonly namespaceId: string;
    readonly bytes: number;                    // 冻结：encoded Step2 diff 载荷长度
    /** issue #239 append-only：本 Step2 帧的 wire roundId 投影（§9.1–9.3；
     *  uint32、单连接代际内单调；sent/applied 关联键。 */
    readonly syncRoundId: number;
    /** issue #239 append-only：=== bytes（encoded update 长度澄清字段；bytes 冻结不 rename）。 */
    readonly encodedUpdateBytes: number;
  }
| {
    readonly type: 'sync-diff-applied';
    readonly side: ReplicationObserverSide;
    readonly connectionId?: string;
    readonly namespaceId: string;
    readonly bytes: number;                    // 冻结
    readonly applyLatencyMs?: number;          // 既有：clock 缺省时字段缺失
    /** issue #239 append-only：被 apply 的 Step2 帧的 wire roundId 投影。 */
    readonly syncRoundId: number;
    /** issue #239 append-only：=== bytes。 */
    readonly encodedUpdateBytes: number;
    /** ── 效果字段组（单命运：两次 SV 捕获均成功才存在；捕获 throw 整组折叠缺失）── */
    /** 接纳→结算窗口内本侧 state vector 是否推进（观测投影，非因果归因）。 */
    readonly stateVectorChanged?: boolean;
    /** 'changed' ⟺ stateVectorChanged === true。 */
    readonly applyEffect?: 'changed' | 'noop';
    /** documented safe digest（§23.3 注册：双泳道 FNV-1a-32，16 小写 hex）。 */
    readonly stateVectorBeforeHash?: string;
    readonly stateVectorAfterHash?: string;
  }
```

一致性不变式（conformance 断言 + §23.7 注册）：当效果字段组在场时
`stateVectorChanged === (stateVectorBeforeHash !== stateVectorAfterHash)` 且
`applyEffect === (stateVectorChanged ? 'changed' : 'noop')`；
`encodedUpdateBytes === bytes` 恒成立（两型）；`syncRoundId > 0` 且属于本连接 wire
Step1 roundId 集合。

---

## 4. 生产改动清单（SA3 逐条落实；全部位于 `packages/ws-replication` + 协议文档）

### P1 `src/types.ts`（L336-350）
两 union 成员按 §3 形状追加字段。事件型数不变（20 型）。

### P2 `src/observer.ts`（新增三个纯观测 helper，与 `safeNow` L125-131 同域同纪律）
```ts
/** issue #239：SV 捕获安全折叠（clock-throw 同款）——session 终态同步 throw 等
 *  观测面异常 → undefined（效果字段组整组缺失），绝不外溢协议路径。 */
export function safeStateVector(read: () => Uint8Array): Uint8Array | undefined;

/** issue #239：SV 逐字节相等（编码 canonical ⇒ 字节相等 ⟺ 逻辑相等，依据见 §8-A1）。 */
export function stateVectorBytesEqual(a: Uint8Array, b: Uint8Array): boolean;

/** issue #239：documented safe digest（§23.3 注册算法）——双泳道 FNV-1a-32，
 *  正序+逆序，basis 2166136261 / prime 16777619 / mod 2^32，16 小写 hex。纯函数。 */
export function stateVectorSafeDigest(sv: Uint8Array): string;
```

### P3 `src/round-engine.ts`（纯参数化透传；零状态机逻辑变化）
- L30 `RoundHost.applyStep2` 签名：`(update: Uint8Array, step2Sequence: number, syncRoundId: number) => Promise<'ok' | 'aborted'>`。
- L151 `onStep2`：`void this.applyStep2Safely(message.update, message.sequence, message.syncRoundId);`（`message.syncRoundId` 已在 L140-149 校验 === `currentRound`）。
- L188-195 `applyStep2Safely` 增第三参并透传给 `host.applyStep2`。
- 其余（违例矩阵、结算、reset）一字不动。

### P4 `src/peer-namespace.ts`
1. **sent 发射点**（RoundEngine `send` 回调内，L157-165 现形状）追加两字段：
```ts
if (seq > 0 && message.kind === 'SYNC_STEP2' && this.observerOn) {
  const encodedUpdateBytes = message.update.byteLength;
  this.host.emitObserver({
    type: 'sync-step2-sent',
    side: 'peer',
    ...(cidField(this.host.connectionId())),
    namespaceId: this.namespaceId,
    bytes: encodedUpdateBytes,
    // issue #239 append-only：wire roundId 投影 + 长度澄清
    syncRoundId: message.syncRoundId,
    encodedUpdateBytes,
  });
}
```
2. **applyStep2**（L1005）签名增第三参 `syncRoundId: number`，透传
   `this.applyRemoteUpdate(update, step2Sequence, true, syncRoundId)`。
3. **applyRemoteUpdate**（L1029-1098）：
   - 签名增第四参 `syncRoundId?: number`（`isStep2` 时恒在）；
   - 接纳段（L1042 `t0` 采样旁）追加 before 捕获：
     `const svBefore = isStep2 && this.observerOn ? safeStateVector(() => session.encodeStateVector()) : undefined;`
   - 结算续体成功分支（L1053-1081）：after 捕获 + 效果组派生，`sync-diff-applied`（L1076）附着：
```ts
const svAfter = svBefore !== undefined
  ? safeStateVector(() => session.encodeStateVector())
  : undefined;
const svEqual = svBefore !== undefined && svAfter !== undefined
  ? stateVectorBytesEqual(svBefore, svAfter)
  : undefined;
const effect = svEqual !== undefined
  ? {
      stateVectorChanged: !svEqual,
      applyEffect: svEqual ? ('noop' as const) : ('changed' as const),
      stateVectorBeforeHash: stateVectorSafeDigest(svBefore!),
      stateVectorAfterHash: stateVectorSafeDigest(svAfter!),
    }
  : undefined;
// 分支内：
if (isStep2) {
  this.host.emitObserver({
    type: 'sync-diff-applied', ...base,
    syncRoundId: syncRoundId!,          // isStep2 ⇒ 恒在
    encodedUpdateBytes: update.byteLength,
    ...(effect !== undefined ? effect : {}),
  });
}
```
   （`base` 内 `bytes` 保持 `update.byteLength` 原样；degraded 分支 `degraded-bypass-applied` 不动、不附效果组；`update-applied` 分支不动。）
4. `observerOn` 既有构造期标记（L126/L150）复用，不新增门控状态。

### P5 `src/hub-namespace.ts`（P4 的镜像，无 degraded 分支）
1. sent 发射点（L144-151）同 P4.1（`side: 'hub'`）。
2. `applyStep2`（L834）签名增第三参并透传（L835）。
3. `applyRemoteUpdate`（L855-910）：同 P4.3（t0 采样点 L867；结算成功分支 L878-895；
   `sync-diff-applied` 发射 L891 附着新字段）。

### P6 `src/testing.ts`
追加导出（显式测试面，不进 index.ts）：`export { safeStateVector, stateVectorBytesEqual, stateVectorSafeDigest } from './observer.js';`

### P7 `docs/protocols/instance-replication-v1.md`（§23 append-only；文本见 §5）

---

## 5. 协议文档 §23 append-only 更新（逐节插入文本）

### 5.1 §23.1（两行字段表替换 + 语义注记段）

bootstrap / reconcile / updates 表中两行改为：

```markdown
| `sync-step2-sent` | hub/peer | `connectionId?`、`namespaceId`、`bytes`（出向 Step2 diff 载荷长度）、`syncRoundId`（issue #239：本 Step2 帧的 wire roundId 投影，§9.1–9.3；uint32、单连接代际内单调；sent/applied 关联键）、`encodedUpdateBytes`（issue #239：恒 === `bytes`——encoded update 长度澄清字段；`bytes` 冻结不 rename） |
| `sync-diff-applied` | hub/peer | `connectionId?`、`namespaceId`、`bytes`、`applyLatencyMs?`、`syncRoundId`（被 apply 的 Step2 帧的 roundId 投影）、`encodedUpdateBytes`（=== `bytes`）、效果字段组（issue #239，单命运——两次 SV 捕获均成功才存在，捕获异常整组折叠缺失）：`stateVectorChanged`（boolean：本侧「Step2 接纳 → apply 结算」窗口内 state vector 是否推进——观测投影，非因果归因，窗口内其他写如实计入）、`applyEffect` ∈ {changed, noop}（'changed' ⟺ stateVectorChanged）、`stateVectorBeforeHash`/`stateVectorAfterHash`（§23.3 documented safe digest） |
```

表后追加注记段：

```markdown
**issue #239 语义注记**：发送不推进发送方 state vector，`sync-step2-sent` 不携带效果
字段组。Yjs 空 diff 编码结构性非零（§9.2 允许空 diff），`bytes > 0 ∧ applyEffect='noop'
并存即「健康 periodic no-op round」的可观测形态。全部 `bytes` 字段 = 编码后帧载荷长度
（长度非内容，亦非 logical change 计数）。`syncRoundId` 关联域 = 单连接代际（§21：进程
重启即丢弃；跨重启关联不存在）。
```

### 5.2 §23.3 允许清单追加（禁止清单不动）

```markdown
- 低基数闭联合字面量 `applyEffect` ∈ {changed, noop}（issue #239；同族先例
  channelState/connectionState）与 boolean `stateVectorChanged`；
- 有限数值 `syncRoundId`（uint32，wire §9.1–9.3 既有事实的观测投影，连接代际内）与
  `encodedUpdateBytes`（长度）；
- **documented safe digest（issue #239 注册）**：`stateVectorBeforeHash`/
  `stateVectorAfterHash`，算法固定 = 双泳道 FNV-1a-32（泳道 A 正序、泳道 B 逆序扫描
  raw 编码 state vector 字节；offset basis 2166136261、prime 16777619、模 2³²），
  输出恒 16 位小写 hex；用途 = 关联/相等判别（trace/事件 payload，§23.6 默认不入
  metric label）。raw state vector 字节仍属 Yjs bytes 禁止项——digest 是派生定长
  字符串，非字节载荷。
```

### 5.3 §23.4 追加捕获纪律段

```markdown
- **issue #239 效果字段组捕获纪律**：before 捕获位于 Step2 帧接纳的帧分发同步段
  （sequenced apply 入队前），after 捕获位于 apply 结算续体（事件发射同点）；两处均经
  session 受控能力 `encodeStateVector`（读取面，不进 Registry write sequencer 槽），
  且仅在 observer 注入时执行（无 observer = 零捕获，热路径与现状逐字节等价）。捕获
  throw（含 session 终态同步 throw）按 clock-throw 同款折叠策略处理：效果字段组整组
  缺失（事件本体与其余字段照常发射），绝不伪造 `noop`。
```

### 5.4 §23.6 表格更新
metrics 允许列 label 集 `{side, type, code, cause, reason}` 追加 `applyEffect`（低基数）；
禁止列追加 `syncRoundId`/`stateVectorBeforeHash`/`stateVectorAfterHash` 作默认 label。

### 5.5 §23.7 追加 conformance 招募

```markdown
- issue #239：两 sync 事件键集白名单追加新字段；断言 `encodedUpdateBytes === bytes`、
  `syncRoundId` ∈ wire Step1 roundId 集合（每轮有事件、无孤儿事件）、效果字段组单命运
  （同现同缺）与组内一致性（`stateVectorChanged === (beforeHash !== afterHash)`、
  `applyEffect ↔ stateVectorChanged`）、hash 16 位小写 hex 文法；捕获折叠与 digest
  确定性经 testing surface（`@nomicore/ws-replication/testing`）单元面覆盖（throwing
  reader → 整组缺失；digest 纯函数确定）；periodic no-op round 全 noop / 静默漂移修复
  round 至少一侧 changed 的场景级验收由 `ws-replication-issue239-ac-red.test.ts` 承担。
```

---

## 6. 测试改动清单

### T1 `test/ws-replication-api.test-d.ts`（L246-247）
「事件 union：20 型字面量精确匹配」的两成员形状按 §3 同步追加字段（`toEqualTypeOf`
精确锁定的协锁面——SA8 注记 6）。不追加则 type-test 红。

### T2 `test/ws-replication-observer-red.test.ts`（conformance 面）
1. **ALLOWED_KEYS**（L1148-1149）：
   - `sync-step2-sent` += `syncRoundId`、`encodedUpdateBytes`；
   - `sync-diff-applied` += `syncRoundId`、`encodedUpdateBytes`、`stateVectorChanged`、`applyEffect`、`stateVectorBeforeHash`、`stateVectorAfterHash`。
2. **数值守卫**（L1190-1200 有限非负名单）+= `syncRoundId`、`encodedUpdateBytes`。
3. **新断言块**（T9 内或新 describe「issue #239 效果字段组」）：对矩阵运行中全部 sync 事件断言
   `encodedUpdateBytes === bytes`；效果字段组在场时的一致性三不变式 + hash `/^[0-9a-f]{16}$/` 文法；
   组单命运（四键同现同缺）。
4. **单元块**（helpers，import 自 `@nomicore/ws-replication/testing`）：
   - `stateVectorSafeDigest`：确定性（同输入同输出）、16-hex 文法、正逆序双泳道可分辨
     （构造两个 SV 使单泳道碰撞的对抗样本可不做，只锁算法基准向量：空输入、`[0,0]`、
     递增序列的期望值——**测试内 hardcode 期望 hex**，锁算法冻结）；
   - `safeStateVector`：throwing reader → `undefined`；正常 reader → 原样返回；
   - `stateVectorBytesEqual`：相等/不等/长度不同三态。
5. T8（无 observer / 良性 / 每事件必 throw 三运行 wire 与文档内容全等）**不改**——
   新捕获为 observer 门控只读，天然满足；该测试继续把守「无 observer 热路径等价」。

### T3 `test/ws-replication-issue239-repro.test.ts`（SA5 复现，按 failure_analysis §3.3 翻转）
1. 场景 1 第 (5) 项：由「全部事件不含语义字段」翻转为——
   全部 sync 事件携带 `syncRoundId`（number > 0）与 `encodedUpdateBytes === bytes`；
   全部 `sync-diff-applied` `stateVectorChanged === false ∧ applyEffect === 'noop'`，
   效果组在场时 `stateVectorBeforeHash === stateVectorAfterHash` 且 16-hex；
   `syncRoundId` 集合 === wire Step1 roundId 集合。
2. 场景 2 第 (3) 项：由「事件形状与 no-op 完全相同」翻转为——
   修复 round 内 peer 侧 `sync-diff-applied` 报 `changed`（`stateVectorChanged === true`、
   before≠after hash）、hub 侧报 `noop`（与实测 round 级 SV 增量一一对应）；
   修复后下一 periodic round 回到全 noop（非粘滞）。
3. 保留：不锁字节数（`> 0` 断言）、键集形状 log（`keySetsOf` 输出自然更新）。

### T4 `test/ws-replication-issue239-ac-red.test.ts` —— **冻结不改**（转绿判据本体）。

### T5 `test/driver.ts` —— 不改（SA5 additive seam `hubObserver`/`peerObserver` L195-199、
`stateVectorOf` L445-447、`advanceMs` L600-602 已满足全部测试需要）。

---

## 7. 验证命令与预期结果（SA3 完成后依序执行；SA4/SA7 复验同表）

| # | 命令（worktree 根） | 预期 |
|---|---|---|
| V1 | `pnpm exec vitest run packages/ws-replication/test/ws-replication-issue239-ac-red.test.ts --reporter=verbose` | **2 passed**（红灯契约不改一字转绿；两场景全部断言含 no-op 全 noop / 漂移 round delta 对应 / 关联集合相等） |
| V2 | `pnpm exec vitest run packages/ws-replication/test/ws-replication-issue239-repro.test.ts --reporter=verbose` | 2 passed（翻转后断言） |
| V3 | `pnpm exec vitest run packages/ws-replication/test/ws-replication-observer-red.test.ts --reporter=verbose` | 全绿（T1-T13 + T9 白名单/一致性 + 新单元块） |
| V4 | `pnpm exec vitest run packages/ws-replication/test/ws-replication-periodic-reconcile.test.ts packages/ws-replication/test/ws-replication-ac4-reconcile.test.ts packages/ws-replication/test/ws-replication-ac5-live.test.ts packages/ws-replication/test/ws-replication-issue231-send-failure.test.ts` | 全绿（SA5 回归清单 27 tests + 同族） |
| V5 | `pnpm exec vitest run packages/ws-replication/test/ws-replication-api.test-d.ts`（或随包 vitest 全量） | type-test 绿（union 形状协锁更新后） |
| V6 | `pnpm exec tsc -p packages/ws-replication/tsconfig.json` | exit 0（含 test/**） |
| V7 | `pnpm typecheck`（根） | exit 0 |
| V8 | `pnpm test`（根） | 全绿（包 AGENTS 验证门：observer/lifecycle 相邻变更） |
| V9 | 稳定性：V1+V2 连续 10 次 | 10/10 绿，0 flake（对齐 SA6 红灯稳定性口径） |

## 8. 协议假设的可验证依据（每条假设 → 证据锚点）

| # | 假设 | 可验证依据（本 worktree 实读） |
|---|---|---|
| A1 | **SV 编码 canonical ⇒ 字节相等 ⟺ 逻辑 SV 相等**（`stateVectorBytesEqual` 判据可靠性） | yjs@13.6.32（pnpm-lock.yaml L982 单版本解析）`src/utils/encoding.js` L601-608：`writeStateVector` 对 `sv.entries()` **显式排序**后逐项 varUint 写出——同一 client→clock 映射恒产生逐字节相同编码；反向（字节不等 ⇒ 逻辑不等）显然。判据 = issue 指定的「round 前后 state vector 是否变化」 |
| A2 | **applied 侧 roundId 有明确定义且每 round 每侧恰一笔 `sync-diff-applied`** | §9.1「每方向每 round 只允许一个 Step1」；round-engine.ts `onStep2` L134-152：`receivedStep2` 单槽 + `syncRoundId === currentRound` 校验（每 round 恰收一笔 Step2）；`sendStep2` L176-186：`ownStep2Seq` 单槽（每 round 恰发一笔）⇒ 事件 roundId 分组无歧义 |
| A3 | **`syncRoundId` 关联域 = 单连接代际，设计不得跨重启关联** | 协议 §21（L562-578）：「进程重启丢弃 connection sequence、syncRoundId…」；本设计零新增长生命周期状态（字段均为发射时刻投影，见 §1 不做清单第 5 行） |
| A4 | **捕获不进 sequencer 槽、属读取面** | replication-session.ts `encodeStateVector` L409-414（同步读面；终态 throw——折叠路径真实存在）；`applyRemoteUpdate` L436+ 接纳为同步段、变更经 sequencer 异步结算；CONTEXT.md「读取不进入该序列」；同点先例：`degradedBypassActive()` 在结算续体读 `lease.getStatus()`（peer-namespace.ts L1108-1123） |
| A5 | **observer gating 形态成立（无 observer = 零捕获）** | 构造期 `observerOn` 标记既有先例（peer-namespace.ts L126/L150、hub-namespace.ts L115/L137、peer-connection.ts L108、hub-connection.ts L485）；§23.4 明文；T8 三运行基线全等测试既有（observer-red L1086-1111）持续把守 |
| A6 | **Yjs 空 diff 结构性非零 ⇒ no-op round `bytes > 0` 与 `applyEffect='noop'` 必然并存** | §9.2「允许空 diff」+ SA5 探针（2 B `[0,0]`，failure_analysis §4.3）+ 本地 fixture no-op round 10 B（repro log）；红灯契约场景 1 断言 `minBytes > 0` 与全 noop 并存即该不变式的验收形态 |
| A7 | **§23 append-only 演进直接改协议文档、无需 ADR 修订节** | §23 开头自我登记 + issue #231 先例（commit 4323118/#240，ADR-0010 无 #231 修订节；SA8 冲突报告基准节同款认定） |
| A8 | **`applyEffect=noop` 与 session dirty/unvalidated 正交** | ADR-0010 #134 修订节 R2-7（SA8 relevant_decisions §ADR-0010 摘录）：no-op 成功 apply 同样置 `rootValidation='replication-unvalidated'` + dirty；本设计不动 apply 管线任何决策，只在 observer 在场时追加读取 |
| A9 | **hash 不入默认 metric label 的口径** | §23.6「namespaceId/connectionId 是事件 payload……默认不绑 metric label」同款高基数处理（SA8 relevant_decisions §23.6 推论）；`applyEffect` 低基数入 label 白名单与 issue「低基数 metrics / avoid default metrics label for syncRoundId」逐条对应 |
| A10 | **改动面完备性（发射点恰 4 处 + 类型面 1 处 + 白名单 1 处 + api 协锁 1 处）** | `grep sync-step2-sent|sync-diff-applied src/`：peer-namespace.ts L159/L1076、hub-namespace.ts L146/L891（唯一 4 处）；types.ts L336-350；observer-red ALLOWED_KEYS L1148-1149；api.test-d.ts L246-247 |

## 9. 合规对照矩阵

| SA8 注记 / AC | 本设计落实 |
|---|---|
| 注记 1（noop ≠ apply 未发生；正交两维） | §1 不做清单第 6 行；A8；apply 管线零改动 |
| 注记 2（`bytes` 冻结，add-only 澄清） | D1/D5：`bytes` 原样，`encodedUpdateBytes === bytes` 新增；§5.1 注记「全部 bytes = 编码后载荷长度」 |
| 注记 3（safe-digest 条件注册） | D4：算法/编码/长度固定，§5.2 注册进 §23.3；深扫禁令维持（digest 为 16-hex 字符串）；conformance 文法断言 T2.3 |
| 注记 4（捕获成本/发射点/门控/单连接代际） | D3 + §5.3；A3/A4/A5 |
| 注记 5（复现重建、漂移注入受控 seam） | 已由 SA5/SA6 完成（driver additive seam + persistence peek）；本设计零生产暴露要求（T5 不改） |
| 注记 6（协议文档权威 + conformance 同步） | D7 + D6 + §5；§23.7 招募 T2 |
| 注记 7（范围切割：Hub 不对称/#231/#232） | 零涉及；hub 侧仅镜像事件字段 |
| AC「不再用 bytes>0 猜测语义 diff」 | §0 四问回答途径；V1 场景断言 |
| AC「no-op round 明确报告 + SV 不变」 | D3 派生 + 契约场景 1 |
| AC「漂移修复 round 报 changed 且收敛」 | 契约场景 2（delta 一一对应） |
| AC「roundId/sequence 可靠关联」 | D2 + 契约关联断言（事件 roundId 集 === wire 集） |
| AC「bytes 文档与字段名澄清」 | §5.1 注记 + `encodedUpdateBytes` |
| AC「safe-field / 低基数 / throw 隔离 / 无 observer 热路径测试通过」 | T2 全项 + T8 既有 + §5.2/§5.3/§5.4 |
| AC「不改 wire bytes / 状态机；§23 append-only」 | §1 不做清单 + P3 纯参数化 + V4 状态机守护断言 |

## 10. 风险与边界

| 风险 | 缓解 |
|---|---|
| 效果字段组「部分出现」实现缺陷（只折叠其一） | 单命运构造单点（P4.3/P5.3 `effect` 对象整组 spread/整组缺）；T2.3 一致性 + 单命运断言捕获 |
| 窗口语义被误读为因果归因 | §3/§5.1 明文「观测投影，非因果归因」；conformance 文档化 |
| digest 算法将来被认为不足 | 算法冻结于 §23.3；append-only 可另增字段（D4）；用途仅关联非保密 |
| 观察者事件体积增大（sync 事件 +2~6 字段） | §23.6 既有聚合指引；sync 事件每 round 每侧 ≤1 笔，低频 |
| 捕获成本（每 Step2 apply 2×SV 编码 + 2×digest + 1×比较） | O(clients) 级、仅 `observerOn && isStep2`；UPDATE 热路径（含 observer 在场）零新增 |
| conformance/api 协锁遗漏导致实现后红 | D6 列全 4 个锁面（A10）；V3/V5 逐一验证 |
| round-engine 签名变更被误读为状态机改动 | P3 注明纯参数化；V4 periodic-reconcile/ac4/ac5 状态机测试全绿 + V1 守护断言（回 live、roundId +1） |

## 11. 交付物清单（本设计产出）

- `wiki/raw/task_issue-239-periodic-noop-observability_design.md`（本文档）
- 依赖的上游 artifact（已在本 worktree）：`..._conflict_report.md`、`..._relevant_decisions.md`、`..._failure_analysis.md`、`..._ac_red.md`（+两 log）、`ws-replication-issue239-ac-red.test.ts`、`ws-replication-issue239-repro.test.ts`、`test/driver.ts`（SA5 additive seam，未提交）
