# 设计 — Issue #227：保证 strict replay 的读取租约与完整性判定（SA1 / R1.1）

- 任务：welltop-jim-wang/nomicore#227（parent PR #142 docs/namespace-diagnostic-change-log）
- Worktree：`/home/wangjian/nomicore-fix-issue-227`
- 作者：SA1（design lead）；状态：**R1.1**（F-1 窄修 + N-1/N-2/N-3 备案）提请 SA2 窄域复审；R0 评审：`wiki/raw/task_issue-227_sa2_review.md`（verdict=reject，窄修型）

### 修订日志

- **R1.1（本轮，响应 SA2 R0 reject）**：窄修 F-1 + 三处备案，**零架构变更、零新增码表条目（§5 仍恰四新码）、零 DENY 面触碰**——SA2 R0 §4 已逐项通过的部分一字不动：
  - **F-1（必修）**：§0.1-G4 增补；§4.1 分类表补一行（`fatal ∧ committed:true ∧ effect 字段缺席`——schema.ts:178 形状）；§4.2 判定收窄为 `kind==='fatal' ∧ committed===true ∧ effect ∉ {'update','update-omitted'}` → `{kind:'unknown'}`（effect 缺席与字面 `'unknown'` 同归「必要性不可证」）；INV-227-5 措辞扩；§5/§7 对应行同步；测试增量 **C4 / D8**；§1 AC3/AC4 映射行同步。
  - **N-1/N-2/N-3（应随修备案）**：§4.3 两条备案 bullet（omitted×断链 issue 优先级翻转 / pre-genesis 物化前置）；§3.3.2 事件频率备案一句；**D4 乱序-omitted 变体、D9 pre-genesis pin**；§8.5 备注一句。
  - **G-227-2 闭环**：SA2 R0 §5 维持默认（`committed:false` 自证无提交 → 推进可证安全；与 F-1 的 `committed:true` 形状方向相反、不可折抵）——§10 R-4/§11 同步。
- **R1**：初版（SA2 R0 独立重验结论：§0.1 五缺口全部真实、锚点全部精确；§3.5 三腿论证与 §4 其余攻击面通过）。
- 权威上位契约：ADR `docs/adr/0012-vfsl-validated-jsonl-and-framed-sidecar-change-log.md` §Retention 与删除（L289–297）、§Strict reader 与诊断性 replay（L301–318）；包契约 `packages/namespace-diagnostic-log/AGENTS.md`；#154 设计（read-session/retention 落地）；#155（replay 工具落地）
- 本设计不实现任何生产代码；实现归 SA3，红灯契约归 SA6

---

## 0. 任务与范围

### 0.1 问题陈述（issue 五条 AC 的技术读法）

#227 是**两条既有 ADR 强制项的实施缺口 + 一处 replay 完整性判定漏洞**：

| # | 缺口 | 现状证据（精确锚点） |
|---|------|---------------------|
| G1 | ADR 0012 L297「reader 通过 `openReadSession()` 获得短期 segment lease」在生产读取路径**从未接线**：`readStreamStrict`（`packages/namespace-diagnostic-log/src/reader.ts:391`）自枚举、自读取，全程不持租约；`replayNamespaceDiagnosticLog`（`apps/yjs-server/src/diagnostic-replay.ts:49`）同样裸读，且其 `materializeStrictRecordUpdate` 逐条重读 `.bin`（reader.ts:843）时也无保护 | `openDiagnosticReadSession` 仅被测试引用（`file-adapter-read-session.test.ts`、`file-adapter-namespace-deletion.test.ts`），src 内零调用方 |
| G2 | sweep 的租约检查只在**判定点**做一次（file.ts:1226 / :1281），S1 提交点（`deleteGroup` file.ts:1067–1086 的 `renameSync(jsonl→.deleting)`）无复查；P0 卫生遍历的 orphan-BIN 清理（file.ts:1134–1151）**完全不看租约** | 「检查→删除」窗口结构性敞开；正确性今天仅靠「单线程同步执行不可交错」这一调度事实隐式成立 |
| G3 | replay 把 `fatal ∧ committed:true ∧ effect:'unknown'` 记录归入「其他（无 update 载荷）」分支**推进连续计数**（diagnostic-replay.ts:208–212 else 分支；`committed` 判定 :171 含 fatal-committed-true，`hasUpdateCarrier` :183–188 因 `effect!=='update'` 为 false）→ 该记录后链路可继续走到 `complete` | 既有 pin：`apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts:448`（重点 4）逐字钉死旧行为「complete、issues=[]、推进计数」——**本票必须废止该 pin**（见 §8.4） |
| G4 | `materializeStrictRecordUpdate` 的 `none` 语义过宽（reader.ts:794–817）：`fatal-committed-unknown` 与 `noop/rejected/fatal-committed-false` 同归 `none`，使上层无法区分「可证无更新」与「不可证」；**R1.1-F1 增补**：`fatal ∧ committed:true ∧ effect 字段缺席`（schema.ts:178 第 5 成员——VFSL 合法、emitter 不可达、盘面可达）现状同落 :817 `none` → replay 推进 → complete 可达——SA2 R0 驳回依据，修复见 §4.1/§4.2 | `StrictRecordUpdate`（reader.ts:755–759）四成员缺「不可证」通道 |
| G5 | 防御缺口：`committed ∧ effect:'update'` 但 `res.update` 形状畸形时 `hasUpdateCarrier=false` → 静默按无更新推进（diagnostic-replay.ts:183–188 先看形状后定必要性——次序颠倒） | VFSL 封闭联合使该形状对 `entry.ok=true` 结构不可达，但 fail-closed 纪律要求按 kind/effect 定必要性、畸形走 invalid |

### 0.2 ALLOW 路径（生产改动白名单——SA3 只许改这些）

| 路径 | 改动 |
|------|------|
| `packages/namespace-diagnostic-log/src/read-session.ts` | §3.1：命名常量导出、`renewIfDue`、`enumerationFailed` 只读字段 |
| `packages/namespace-diagnostic-log/src/reader.ts` | §3.2：`StrictReadRequest.session?`、自租约路径、逐段续租检查点、`segment-vanished` 检测；§4.2：`StrictRecordUpdate` 增 `unknown` 成员及分类收窄 |
| `packages/namespace-diagnostic-log/src/adapters/file.ts` | §3.3：`deleteGroupIfUnleased`（S1 前复查）、P0 卫生遍历 orphan-BIN 租约门 |
| `packages/namespace-diagnostic-log/src/retention.ts` | §3.3.3：`leaseBlockedGroups` 注释语义扩写（含 P0 跳过计数）——零形状变更 |
| `packages/namespace-diagnostic-log/src/index.ts` | 增量 re-export（新常量/类型；既有导出一字不动） |
| `apps/yjs-server/src/diagnostic-replay.ts` | §3.4 + §4.3：session 生命周期、fail-closed 分类、新码 |
| `packages/namespace-diagnostic-log/test/**`、`apps/yjs-server/test/**` | SA6 红灯契约（§8）；含废止/改写 SA7 重点 4 pin |
| `packages/namespace-diagnostic-log/AGENTS.md`、根 `CONTEXT.md` | #227 增量段（词表演进备案，随实现同步——同 #153/#154 先例） |

### 0.3 DENY 路径（明确不动 + 理由）

| 路径 | 理由 |
|------|------|
| `src/schema.ts`（冻结指纹）、`src/record.ts` 类型联合 | record 契约冻结；`fatal-committed-unknown` 本就是合法 schema 形状（schema.ts:181），修的是**消费侧判定**，不是 schema |
| `src/emission.ts` / `src/pipeline.ts` / `src/sink.ts` / `src/adapters/memory.ts` | 写路径与语义接缝零涉及；emitter 已能产出 fatal-unknown 记录（pipeline.ts:118、:145）——测试无需手工拼行 |
| 组删除协议 S1–S3 步序、`.deleting` 标记文法、`enumerateSegmentGroups` 语义 | #154 冻结；本票只在 S1 **之前**加复查门，不改协议本身 |
| `analyzeStreamForResume`（reader.ts:966） | writer 侧构造期健康证明；构造期 sweepOnOpen 在证明之后同线程执行，无并发面（#153 纪律已覆盖） |
| `deleteNamespaceDiagnosticLog` / `releaseNamespaceLeasePartition` | INV-12：namespace 逻辑删除有意压过租约（删除意图标记先行）；#227 不改 |
| 跨进程/跨 worker 锁 | INV-9 冻结：进程内注册表 + ADR 0012 单进程独占 rootDir 部署约束；worker_threads 不共享模块态注册表，属部署违约而非代码缺口 |
| manifest 布局/17 键形状、storage-gate、frame codec、health 事件白名单 | 无涉；本票**零新增 health 事件**（sweep 已有 `leaseBlockedGroups` 计数字段） |
| 新依赖 / 新 fs 绑定面 | `read-session.ts` 维持纯 TS；reader/file 的 node:fs 绑定面已在 AGENTS.md 声明内 |

---

## 1. 验收契约映射（AC → 设计决策 → 测试）

| AC（issue 原文） | 设计决策 | 测试（§8 矩阵） |
|---|---|---|
| AC1 生产 strict read/replay 在枚举、读取、校验和 update 物化期间取得并最终释放 read-session lease，长读取按冻结策略续租或诚实失败 | D1（reader 自租约/传入 session、快照驱动枚举）、D6（replay 开session → read → 逐条物化 → finally close）、D7（冻结常量 + `renewIfDue` 检查点；bounded 模式诚实失败码 `lease-expired`） | A1–A4、D1、D7 |
| AC2 retention sweep 只删除无有效 lease 的 closed segment group，且 replay 与 sweep 并发时不存在枚举后删除、读取前丢失的 TOCTOU 窗口 | D2（S1 提交点租约复查 `deleteGroupIfUnleased`）、D3（P0 orphan-BIN 租约门）、§3.5 三腿论证（open 原子注册 + S1 复查 + marker 不可见不变量） | B1–B3、A3（vanished 检测兜底）、D2 |
| AC3 `fatal`、`committed:true`、`effect:'unknown'` 不再被当作无更新的连续记录推进至 complete | D4（materialize 增 `unknown` 第五成员）、D5（replay switch 分类：`unknown` → issue `update-unknown` + break） | C1、C4【R1.1】、D3（**废止并改写 SA7 重点 4**）、D7、D8【R1.1】 |
| AC4 缺失、omitted、unknown 或无法解码的必要 update 返回稳定且可解释的 partial/failed 状态和 issue；complete 仅在冻结连续性条件全部可证明时返回 | D5 分类表（§4.1：必要性由 kind/committed/effect 先定——含 effect 缺席形状（F-1），畸形走 invalid——修复 G5）；complete 门保持 `issues===[] ∧ applied>0 ∧ readStatusOk ∧ !historyTrimmed` 不变，由分类收紧自然满足 | D3–D6、D8–D9【R1.1】+ 既有 R4/R5/R7/R9 pin 保留 |
| AC5 测试覆盖 replay/retention 并发、lease 到期与续租、unknown committed effect、omitted update、以及合法 complete replay 的保真回归 | §8 全矩阵；「并发」在单线程同步模型下的可测化论证见 §8.0 | A–E 全部 |

---

## 2. 现状锚点（评审用精确引用）

- **读取链**：`readStreamStrict`（reader.ts:391–747）步骤 ④ 枚举（:501–516，`enumerateSegmentGroups` 同源共享）→ ⑤ 逐段逐行读+校验（:564–688）→ ⑦ 聚合三态。JSONL ENOENT 分支（:569–571）按「合法 BIN-first 崩溃窗口」零行零 issue 处理。
- **物化链**：`materializeStrictRecordUpdate`（reader.ts:777–824）入口 `entry.ok===false → invalid`；genesis → carrier；attempt 按 `res.kind/effect` 分流（:794–817）；sidecar 路径**重新读盘** `readBinOrNull`（:843）——G1 中「物化期间无保护」的物理落点。
- **replay 链**：`replayNamespaceDiagnosticLog`（diagnostic-replay.ts:49–254）：①前置门/locator（:60–91）→ ②`readStreamStrict`（:95）→ ③流级事实透传（:110–115）→ ④逐 entry（:122–213）→ ⑤genesis-missing（:216）→ ⑥identity（:220）→ ⑦三态（:227–232）→ ⑧owned snapshot。**全同步**。
- **sweep 链**：`sweepNow`（file.ts:1192–1334）：P0 卫生（:1208）→ P1 年龄（:1211–1242，租约查 :1226）→ P2 字节（:1248–1302，租约查 :1281）→ 报告重建。`deleteGroup` S1/S2/S3（:1067–1086）。
- **租约注册表**：`read-session.ts`——`openDiagnosticReadSession`（:158–214）枚举+注册在同一同步函数内（无 yield）→ **open 即原子**；`renew`（:109–130，bounded 解释性拒续 :116）；`segmentLeased`（:217–221，惰性过期判定）；`releaseNamespaceLeasePartition`（:224）。
- **既有租约契约 pin**：`file-adapter-read-session.test.ts` T-C1..T-C8 + T-B6（活跃阻塞/close 释放/TTL 过期放行/过期重租/maxLifetime 拒续/快照集/跨实例 INV-9/注册表隔离/前缀纪律）——**全部保留，本票零回退**。

---

## 3. 租约生命周期设计（AC1/AC2）

### 3.1 `read-session.ts` 增量（纯 TS，零新绑定）

```ts
/** 冻结缺省租期（原 openDiagnosticReadSession 内联 15_000 提名常量——单源导出）。 */
export const DEFAULT_READ_SESSION_TTL_MS = 15_000
/** 冻结续租安全边际：会话内检查点在「距到期不足该值」时触发续租。 */
export const READ_SESSION_RENEW_MARGIN_MS = 1_000

export interface DiagnosticReadSession {
  // ...既有成员一字不动...
  /** open 时刻 segments/ 枚举是否失败（缺失/不可读）。true ⇒ segments===[]
   *  且该会话不保护任何组；消费方（reader）据此保持既有 corrupt 包络。 */
  readonly enumerationFailed: boolean
  /** 到期邻近时续租（margin 判定）；未到期 → true（零副作用）。
   * 到期/邻近 → 委托 renew()（closed / bounded 越界 → false）。 */
  renewIfDue(marginMs: number): boolean
}
```

`renewIfDue(marginMs)` 语义（实现于 `DiagnosticReadSessionImpl`）：

```ts
renewIfDue(marginMs: number): boolean {
  if (this.closedValue) return false
  const now = this.clock.now()
  if (now + marginMs < this.leasedUntilValue) return true   // 未到期：零副作用快路径
  return this.renew()                                        // bounded 语义/registry 同步全沿用
}
```

- `marginMs` 非法值（非 safe integer / <0）→ 视同 0（不 throw——会话对象沿用「运行时可变读视图」轻量纪律；调用方全部来自包内冻结常量）。**裁决点 G-227-1**：备选是 throw；取宽容版因唯一调用方是包内常量，throw 面无人受益。
- `openDiagnosticReadSession` 公开形状不变：枚举失败仍收敛空快照（:176–180 现状），新增 `enumerationFailed` 字段承载事实（调用方可区分「目录空」与「目录不可读」）。

### 3.2 `reader.ts`：strict read 全程持约（D1）

#### 3.2.1 请求面（增量、可选字段——零破坏）

```ts
export interface StrictReadRequest {
  rootDir: string
  namespaceId: string
  streamId: string
  /** 调用方持有的读会话（快照租用）。提供时：
   *  - 枚举采用 session.segments（快照语义：open 后新滚出段不可见——§4.3 既有契约）；
   *  - reader 不 close（生命周期归调用方）；
   *  - 逐段读取前跑 renewIfDue 检查点。
   * 缺省时：reader 自开自关（ttl=DEFAULT_READ_SESSION_TTL_MS、maxLifetimeMs=null、真实时钟）。 */
  session?: DiagnosticReadSession | undefined
}
```

#### 3.2.2 会话取得与防御门（替换步骤 ④ 的裸枚举）

```
④′ 会话取得：
  a. request.session 提供：
     - 身份不符（rootDir/namespaceId/streamId 任一不匹配）→ 返回 corrupt + locator-invalid（零 fs）
     - session.closed === true → 返回 corrupt + lease-expired（防御：闭会话无保护，不静默裸读）
     - session.enumerationFailed === true → 返回 corrupt + manifest-invalid（保持 ④ 现有枚举失败包络逐字节等同）
     - 否则 enumeration.live := session.segments（不再触碰磁盘枚举——快照即枚举）
  b. 未提供：内部 openDiagnosticReadSession（ttl/maxLifetime/时钟取 §3.1 冻结缺省）
     - enumerationFailed → corrupt + manifest-invalid（同上）
     - segments := session.segments
     - 自开标记 ownedByReader := true（finally 中 close——readStreamStrict 全函数不抛，close 恒达）
```

- `historyTrimmed` / `earliestRetainedSequence` / §9.3 roll-target 核查全部改吃快照 segments——**数值与现状逐字节等同**（同一 `enumerateSegmentGroups` 输出，仅取值时机移到 open）。
- 快照为空 ∧ `enumerationFailed === false`（目录存在但空/全新流）→ 零记录、`status:'ok'`——现状保留。

#### 3.2.3 逐段续租检查点（冻结策略的执行点）

每段循环体开头（读 `.jsonl` 之前）：

```
if (!session.renewIfDue(READ_SESSION_RENEW_MARGIN_MS)) {
  streamIssues.push({ code: 'lease-expired', segment })   // 新 reader 域码（§5）
  break                                                    // 诚实失败：停止读取，保留已读 records
}
```

- 默认 `maxLifetimeMs=null`（显式续租模式，ADR 0012 L297 允许项之二，#154 先例缺省）⇒ 生产路径 `renew()` 恒 true——续租永不失败，`lease-expired` 实际不可达。
- bounded 模式（调用方自开 session 传 `maxLifetimeMs`）：续租被解释性拒续（read-session.ts:116）→ 诚实中止并解释。这正是 AC1「续租**或**诚实失败」的双臂。
- 同步单线程下检查点间时钟不走（无 await），检查点面向：注入时钟的确定性测试、host 分步物化模式（§3.4）、未来 async 化的结构保险。

#### 3.2.4 `segment-vanished` 检测（租约契约的可观测兜底）

步骤 ⑤ 中 JSONL ENOENT 分支（:569–571）扩为：

```
jbuf === null（ENOENT）时：
  statSync(bin, throwIfNoEntry:false) 与 statSync(`${seg}.deleting`, throwIfNoEntry:false)：
  - bin 存在 ∧ marker 不存在 → 合法 BIN-first 崩溃窗口（现状契约，W 系 pin）：零行、零 issue【保留】
  - marker 存在 ∨ bin 缺失    → streamIssues.push({ code: 'segment-vanished', segment })
                               （快照里有、盘上无 = 租约窗内被删/到期后被扫——诚实 corrupt）
```

- 判定只增补在 jsonl ENOENT 的罕见分支，零热路径成本（两个 stat 仅在 jsonl 缺失时发生）。
- 现状下（同线程无交错）结构性不可达 → **对 259 个既有测试文件零回归风险**；红测试以「public API 开 session → 手工删文件 → 带 session 读」构造（§8 A3）。
- 该码使 AC2 的 TOCTOU 消除**可被证伪**：若未来任何路径重新打开窗口，读取面立刻可见而非静默零行。

#### 3.2.5 与 BIN-first 窗口 / `.deleting` 中间态的正交性

- marker 组在 `enumerateSegmentGroups` 即整体剔除（reader.ts:357–375）→ 永不进快照 → 会话永不租用正在删除的组。
- BIN-first（bin 有 jsonl 无）是 writer 崩溃窗口，不是删除态——3.2.4 的判定矩阵把两者显式分离。

### 3.3 `adapters/file.ts`：sweep 提交点复查（D2/D3）

#### 3.3.1 `deleteGroupIfUnleased`（替换 P1/P2 两处 `deleteGroup` 直呼）

```ts
type DeleteOutcome = 'deleted' | 'lease-blocked' | 'failed'

function deleteGroupIfUnleased(
  rootDir: string, namespaceId: string, streamId: string,
  segmentsDir: string, segment: string, now: number,
): DeleteOutcome {
  // S0′ 提交点复查：S1 rename 之前再次核对（惰性过期语义同 segmentLeased）
  if (segmentLeased(rootDir, namespaceId, streamId, segment, now)) return 'lease-blocked'
  ...原 deleteGroup S1→S2→S3 逐字搬入；任一步失败 → 'failed'...
}
```

- P1 年龄遍历（:1233）与 P2 字节遍历（:1289）改呼新函数：`'lease-blocked'` → `report.leaseBlockedGroups += 1; break`（前缀纪律不变）；`'failed'` → `failedSteps++; break`（现状）；`'deleted'` → 计数/字节口径不变。
- 复查用 `sweepRetention` 入参 `now`（与初查同钟——确定性测试面；同步单线程下两者等值，复查的存在使不变量**结构化**而非调度依赖）。
- 判定点初查（:1226/:1281）**保留**（避免读龄/统计的无谓 IO——先挡一道），形成「初查 → 读龄/字节 → S0′ 复查 → S1」双门。

#### 3.3.2 P0 卫生遍历 orphan-BIN 租约门（D3）

`hygieneStream` 的 orphan-BIN 清理（:1144–1150）前加：

```
if (segmentLeased(config.rootDir, namespaceId, stream.streamId, segment, now)) {
  report.leaseBlockedGroups += 1      // 语义：因活跃租约跳过的组数（P1/P2 止步 + P0 跳过）
  continue                            // 卫生遍历无前缀纪律——逐组跳过
}
```

- `hygieneStream` 签名需增 `now`（与 `report` 一并传入；P0 调用点 :1208 传 `sweepNow` 的 `now`）。
- `.deleting` 标记续走（S2/S3）**不加**租约门：marker 组对一切会话枚举不可见（INV-13 + 枚举剔除）→ 不存在持约视图，续走安全。
- `retention.ts` 的 `leaseBlockedGroups` JSDoc 扩写为「因活跃租约跳过（P1/P2 止步 + P0 orphan 跳过）的组数」——字段形状与语义族不变，`retention-swept` 事件白名单不动。
- 【R1.1 N-3 备案】P0 跳过计入 `leaseBlockedGroups` 后，`emitRetentionSweptIfAction`（file.ts:1337–1345）以 `leaseBlockedGroups > 0` 为动作判定 → **纯卫生租约跳过现在会触发 `retention-swept` 事件**（现状「零动作不发」）。事件形状/白名单零变更（§5 声明不变），仅发波频率语义变化——接受并备案（SA2 R0 N-3）。

#### 3.3.3 open-group 保护不变

P1/P2 的 `openSegment` 止步（:1222/:1277）与「绝不动开组」纪律（INV-5）原样保留；lease 与 open-group 是两道独立门（ADR L289「已关闭且没有 reader lease」合取）。

### 3.4 `diagnostic-replay.ts`：replay 全程持约（D6）

#### 3.4.1 请求面（增量、可选）

```ts
export interface DiagnosticReplayReadSessionOptions {
  ttlMs?: number                 // 缺省 DEFAULT_READ_SESSION_TTL_MS
  maxLifetimeMs?: number | null  // 缺省 null（显式续租模式）
  clock?: { now(): number }      // 缺省真实时钟；测试确定性注入面
}
export type ReplayNamespaceDiagnosticLogRequest = {
  rootDir: string; namespaceId: string
  readSession?: DiagnosticReplayReadSessionOptions
}
```

#### 3.4.2 生命周期（locator 解析成功取得 streamId 之后）

```
const session = openDiagnosticReadSession({
  rootDir, namespaceId, streamId,
  ttlMs: readSession?.ttlMs ?? DEFAULT_READ_SESSION_TTL_MS,
  maxLifetimeMs: readSession?.maxLifetimeMs ?? null,
  clock: readSession?.clock,
})
try {
  read := readStreamStrict({ ...strictRequest, session })      // 枚举/读取/校验全程持约
  ...④ 逐 entry：物化前 if (!session.renewIfDue(READ_SESSION_RENEW_MARGIN_MS)) {
        issues.push({ code: 'lease-expired' }); break }         // 新 replay 域码（§5）
        m := materializeStrictRecordUpdate(strictRequest, entry) // 物化期间持约（bin 重读受 S0′ 保护）
  ...
} finally { session.close() }                                   // 恒释放（工具不抛——finally 恒达）
```

- `enumerationFailed` 由 reader 的 ④′ 包络转成 `corrupt + manifest-invalid` → replay 走既有 partial/failed 通道——工具层无需特判。
- `maxLifetimeMs=null` 缺省下 `lease-expired` 不可达（AC1 诚实失败臂仅在 bounded 配置出现）；注入小 ttl + 步进假钟可确定性触发（§8 D1）。

### 3.5 TOCTOU 消除论证（AC2 的「为什么窗口关死了」）

三方不变量合取：

1. **open 原子性**：`openDiagnosticReadSession` 的「枚举 → 注册」在单一同步函数内无 yield——会话注册的组集合恰为快照集合，不存在「枚举了但没租上」的中间态。
2. **S0′ 提交点复查**：sweep 在 S1 rename 前重核租约——「初查通过 → 会话注册 → 删除继续」的窗口被提交点二次门关闭（结构性，不依赖调度假设）。
3. **marker 不可见不变量**：S1 一旦发生，组从一切后续枚举（会话/reader/sweep）消失——「正在删除的组」对新会话不存在，旧会话由 2 保护、由 3.2.4 `segment-vanished` 兜底观测。

推论：会话活跃（未过期未关闭）期间其快照组的 jsonl/bin 不可能被 retention 删除；过期/关闭后删除合法（INV-4——过期租约永不阻塞），读取面以 `segment-vanished`/既有 ENOENT 码诚实降级，**永不静默成功**。

单线程同步模型下 1+2 本已由调度隐式保证；本设计把保证从「调度事实」升格为「结构 + 可测不变量」——这是 AC2 在 vitest `maxWorkers:1` 环境下的可测化基础（§8.0）。

---

## 4. replay 完整性判定收紧（AC3/AC4）

### 4.1 必要 update 分类表（D5——单源归 materialize）

| record 形状（`result`） | 必要性判定 | materialize 返回 | replay 动作 | 可达 complete？ |
|---|---|---|---|---|
| `committed / effect:'update'` | **必要**（有更新须物化） | `{kind:'update', bytes}` | genesis 后 apply + 推进；无 genesis 跳过（⑤兜底） | 可（物化+解码成功且链连续） |
| `fatal / committed:true / effect:'update'` | **必要** | `{kind:'update', bytes}` | 同上 | 可 |
| `committed / effect:'update-omitted'` | **必要但被省略** | `{kind:'omitted', reason}` | issue `update-omitted` + **break** | 否 → partial |
| `fatal / committed:true / effect:'update-omitted'` | **必要但被省略** | `{kind:'omitted', reason}` | 同上 | 否 → partial |
| `fatal / committed:true / effect:'unknown'` | **必要性不可证**（G3 根因） | `{kind:'unknown'}`【新】 | issue `update-unknown` + **break** | 否 → partial |
| `fatal / committed:true / effect 字段缺席`（schema.ts:178 第 5 成员；VFSL 合法、emitter 不可达——pipeline.ts:115–123 只挡写侧、盘面可达——手拼/篡改/第三方 writer）【R1.1-F1】 | **必要性不可证**（自证已提交 ∧ 效应不明——与字面 `'unknown'` 同级） | `{kind:'unknown'}` | issue `update-unknown` + **break** | 否 → partial |
| `committed / effect:'noop'` | 可证无更新 | `{kind:'none'}` | 推进连续计数 | 可 |
| `rejected` | 可证无更新 | `{kind:'none'}` | 推进 | 可 |
| `fatal / committed:false`（无 effect） | 可证无更新 | `{kind:'none'}` | 推进 | 可 |
| `committed/fatal-committed ∧ effect:'update'` 但 `update` 畸形（防御，VFSL 下 `entry.ok=false` 先挡） | **必要**（按 kind/committed/effect 先定） | `{kind:'invalid', code}` | issue `m.code` + break | 否 → partial/failed |

- **关键次序修正（G5/F-1）**：必要性由 `kind/committed/effect` 判定，**先于**对 `update` 形状与 effect 字段在场性的任何其他检查——畸形必要 update 一律走 invalid 通道、已提交而效应不明一律走 `unknown` 通道，杜绝 `hasUpdateCarrier=false` 静默推进。
- `lastAppliedSequence` 语义：break 停止点前最后一条**已应用或已推进**的 record——fatal-unknown 处不推进（链上最后可证 record）。
- snapshot 语义：break 前已 apply 的前缀状态照常输出（owned 副本）——partial 的「有重放基」定义不变。

### 4.2 `StrictRecordUpdate` 第五成员（D4）

```ts
export type StrictRecordUpdate =
  | { kind: 'update'; bytes: Uint8Array }
  | { kind: 'omitted'; reason: string }
  | { kind: 'none' }                        // 语义收窄：committed-noop / rejected / fatal-committed:false（含其 effect 放宽残差 §4.4）
  | { kind: 'unknown' }                     // 【新·R1.1 域收紧】fatal ∧ committed:true ∧ effect ∉ {'update','update-omitted'}（字面 'unknown' 或字段缺席）
  | { kind: 'invalid'; code: string }
```

`materializeStrictRecordUpdate` attempt 分支（reader.ts:794–817）改动：

```
effect === 'update-omitted' → omitted（不变）
effect === 'update' ∧ (committed ∨ fatal-committed-true) → carrier 物化（不变）
kind === 'fatal' ∧ committed === true ∧ effect ∉ {'update','update-omitted'}
  → { kind: 'unknown' }   // 【R1.1-F1】从 'none' 迁出：effect 字段缺席（schema.ts:178 形状）与字面 'unknown'
                          //   同归「必要性不可证」——已提交而效应不明，fail-closed 永不按无更新推进
其余（committed-noop / rejected / fatal-committed:false——含其 effect 放宽残差 §4.4）→ none（不变，文档收窄）
```

- 联合加成员属**加性演进**；既有穷举 switch 的调用方只有 replay 工具与测试——同步更新，无第三方面。
- #155 冻结报告形状（`DiagnosticReplayResult` 三态/issues/lastAppliedSequence/snapshot?）**零变更**。

### 4.3 replay ④ 分支重写（以 materialize 为唯一分类源——消灭 app 侧联合重复）

```
for (const entry of read.records) {
  entry.ok / record 形状 / genesis 放置判定【不变】
  attempt: attemptSeen := true【不变】
  连续性复核（expectedNext）【不变，先于物化】
  m := materializeStrictRecordUpdate(strictRequest, entry)
  switch (m.kind):
    'update'   → !genesisSeen ? skip（⑤兜底） : apply（catch → update-undecodable + break）; applied++; lastSeq/expectedNext 推进
    'omitted'  → issues.push(update-omitted); break
    'unknown'  → issues.push(update-unknown); break          // 【新】AC3
    'none'     → genesisSeen 时推进 lastSeq/expectedNext      // 连续无更新记录
    'invalid'  → issues.push({code: m.code}); break           // 含防御畸形必要 update
}
```

- 现 :165–212 的 app 侧 `committed`/`hasUpdateCarrier` 手工推导**整体删除**（8 形状联合语义回归包内单源——包边界纪律：app 只消费包公共投影）。
- 【R1.1 N-1 备案——omitted×断链 issue 优先级翻转】新次序把连续性复核置于物化/omitted 判定之前（现状 :173 omitted 检查先于 :179 连续性复核）：一条「乱序 ∧ committed-omitted」记录现在报 `sequence-gap`（现状报 `update-omitted`）。两臂均非 complete、三态不变，仅 issue 码翻转；连续性复核零 IO 且断链是更早的事实——**接受翻转并备案**（SA2 R0 N-1 建议），D4 加乱序-omitted 变体钉死新优先级。
- 【R1.1 N-2 备案——pre-genesis 物化前置】新次序对**每条** attempt 先 materialize 再 switch（现状仅 `hasUpdateCarrier ∧ genesisSeen` 时物化，:189–194）：genesis 之前的 update 记录若 sidecar 载体损坏（如 bin 缺失 → `frame-missing`），现状静默跳过（⑤ `genesis-missing` 兜底），新设计在物化处得 `invalid` → break，issue 集合从 `[genesis-missing]` 变为 `[<invalid 码>, genesis-missing]`（同为 failed）。方向是 fail-closed 改善——备案并由 D9 钉死，防 SA4 误判回归。
- complete 门 :227–232 逐字保留：`issues===[] ∧ applied>0 ∧ readStatusOk ∧ !historyTrimmed`。AC4「仅在全部可证时 complete」由分类表收紧后自然成立——缺任何必要 update 必然产生 issue 或断链。
- ⑥ identity、③ 流级透传、② incompatible、① locator 各分支零改动。

### 4.4 保留的既有语义（明确不回退清单）

- `history-trimmed` / `sequence-gap` / `genesis-missing` / `genesis-misplaced` / `identity-mismatch` / `stream-incompatible` / `update-omitted` / `update-undecodable` / locator 三码 / `replay-internal-error` 全保留。
- noop/rejected/fatal-committed-false 推进连续计数（R1/SR1 保真回归的基础）。
- `fatal / committed:false / effect:'update'`（VFSL 布尔放宽的已知残差，schema.ts:178–180）→ materialize `none` → 推进：维持 #155 判定，不在本票扩权（备案残余，见 §10；**R1.1 闭环：SA2 R0 §5 维持默认**——`committed:false` 自证无提交、推进可证安全；与 F-1 的 `committed:true ∧ effect 缺席` 形状方向相反，不可折抵）。

---

## 5. 稳定码词表演进（需过设计评审——本文即评审载体）

| 新码 | 域 | 归属 | 语义 | 状态映射 |
|---|---|---|---|---|
| `lease-expired` | reader 私有码表（§2.6 族） | readStreamStrict | 会话续租被拒（bounded 越界/会话已闭）——读取诚实中止 | `corrupt` |
| `segment-vanished` | reader 私有码表 | readStreamStrict | 快照组盘上消失（jsonl ENOENT ∧（marker 在 ∨ bin 缺））——租约窗内被删的兜底观测 | `corrupt` |
| `update-unknown` | replay 工具码表 | replayNamespaceDiagnosticLog | `fatal ∧ committed:true ∧ effect ∉ {'update','update-omitted'}`（字面 `'unknown'` 或字段缺席——R1.1-F1 收紧）——必要 update 完整性不可证（AC3） | partial/failed |
| `lease-expired` | replay 工具码表 | replayNamespaceDiagnosticLog | 物化前续租被拒（bounded 配置） | partial/failed |

- 两域同码不同表（reader 域与 replay 域本就分立——§11-G9 先例）；命名与 `update-omitted`/`update-undecodable` 平行。
- **零新增 health 事件/事件成员**（AGENTS.md 白名单不动）。
- 文档同步义务（随 SA3 落地）：包 AGENTS.md 增 #227 增量段；reader.ts 头注码表计数 29 → 31；`packages/namespace-diagnostic-log/README.md` 若列码表同步。

---

## 6. 不变量清单（INV-227-*，SA4 静态复审清单）

- **INV-227-1（持约读取）**：`readStreamStrict` 的每一次磁盘枚举/读取/校验都发生在某个未关闭会话的保护下（自开或传入）；自开会在函数返回前 close。
- **INV-227-2（快照即枚举）**：提供 session 时 reader 的 segments 恒等于 `session.segments`；reader 不得另起 `enumerateSegmentGroups`（单源防漂移）。
- **INV-227-3（提交点复查）**：P1/P2 的每次 S1 rename 前必有同 `now` 的 `segmentLeased` 复查；`'lease-blocked'` 恒走前缀止步。
- **INV-227-4（卫生守约）**：P0 orphan-BIN unlink 前必有租约检查；blocked 计入 `leaseBlockedGroups`。
- **INV-227-5（fail-closed 必要性）**：replay/materialize 对 attempt 的必要性判定只依赖 `kind/committed/effect`；`fatal ∧ committed:true` 的记录除非 `effect` 证明为 `'update'`/`'update-omitted'`，永不落入「无更新推进」分支（effect 字段缺席与字面 `'unknown'` 同归 `unknown` → issue + break——R1.1-F1）；`committed ∧ effect:'update'` 的记录永不落入「无更新推进」分支。
- **INV-227-6（unknown 不推进）**：`materialize → 'unknown'` 的记录在 replay 中必产生 issue 且 `lastAppliedSequence` 不推进过该 record。
- **INV-227-7（complete 门冻结）**：complete 判定表达式与 #155 逐字相同；收紧只经分类/issue 通道发生。
- **INV-227-8（恒释放）**：replay 的 session 在包括顶层 catch 的所有返回路径上 close（finally）。
- **INV-227-9（零静默空读）**：jsonl ENOENT 仅在「bin 在 ∧ marker 不在」时豁免 issue；其余形态必出 `segment-vanished`。
- **INV-227-10（词表封闭）**：新码恰四个（§5）；不新增 health 事件成员、不新增 update-omitted reason。

---

## 7. 模块级变更规格汇总（SA3 实现清单）

| 文件 | 函数/类型 | 变更类型 |
|---|---|---|
| read-session.ts | `DEFAULT_READ_SESSION_TTL_MS`/`READ_SESSION_RENEW_MARGIN_MS` 导出 | 新增（15_000 提名 + 1_000 新常量） |
| read-session.ts | `DiagnosticReadSession.enumerationFailed` / `renewIfDue(marginMs)` | 接口加成员/方法 + Impl |
| reader.ts | `StrictReadRequest.session?` | 加可选字段 |
| reader.ts | `readStreamStrict` ④′/逐段检查点/3.2.4 检测/finally close | 行为增量（快照驱动 + 两新码） |
| reader.ts | `StrictRecordUpdate` + `materializeStrictRecordUpdate` | 加 `unknown` 成员；`none` 收窄（`none` 域 = committed-noop/rejected/fatal-committed:false；fatal-committed-true 的一切非 update/update-omitted 形状——含 effect 缺席——全迁 `unknown`，R1.1-F1） |
| file.ts | `deleteGroupIfUnleased`（新）替换两处直呼；`hygieneStream` 加 `now` 参 + 租约门 | 行为增量 |
| retention.ts | `leaseBlockedGroups` JSDoc | 注释扩写 |
| index.ts | re-export 两常量 | 增量 |
| diagnostic-replay.ts | `DiagnosticReplayReadSessionOptions`/请求加 `readSession?`；④ 重写为 materialize switch；session try/finally | 行为增量 + 删 app 侧联合推导 |
| 包 AGENTS.md / CONTEXT.md | #227 增量段 | 文档 |

预估 diff 量级：src ≈ 250–350 行净变动（reader.ts ~120、file.ts ~60、read-session.ts ~50、diagnostic-replay.ts ~90），测试另计。

---

## 8. 测试计划（SA6 红灯矩阵）

### 8.0 「并发」的可测化声明（方法论锚点）

生产读取/重放/sweep 全为同线程同步函数（无 await 面）——字面并行执行在本仓库 vitest `maxWorkers:1` 模型下不可构造，也非契约承诺面。AC5 的「replay/retention 并发」按以下等价矩阵覆盖：

1. **租约生命周期**（open/到期/续租/close 与 sweep 判定的全部组合——注入钟确定性）；
2. **公共 API 步进交错**（会话 open → 时钟推进/手工删件 → sweep → 带 session 读——每步都是 public seam，交错序列确定性可复现）；
3. **提交点复查的结构可观测**（S0′ 的 `'lease-blocked'` 出口 + `segment-vanished` 兜底码使任何窗口重开都表现为可断言的运行时产物，而非静默成功）。

### 8.1 包级新文件 A：`packages/namespace-diagnostic-log/test/strict-reader-lease.test.ts`

| 用例 | 断言要点 |
|---|---|
| A1 快照驱动 | 外部 session open 后 writer 再滚新段 → 带 session 读不见新段记录；不带 session（自租约）读得见——对照组 |
| A2 续租检查点 | 步进假钟（`now()` 每调用 +Δ）+ 小 ttl 多段流：bounded `maxLifetimeMs` → `corrupt` + issues 含 `lease-expired`、已读 records 保留；unbounded → `ok` 全量 |
| A3 vanished 兜底 | session open → `rmSync` 整组（jsonl+bin）→ 带 session 读：`corrupt` + `segment-vanished`（segment 归因）；对照：只删 jsonl 留 bin → `ok` 零行零 issue（BIN-first 窗口 pin 保留）；再对照：synth `.deleting` marker + 删 jsonl → `segment-vanished` |
| A4 防御门 | 传入身份不符 session → `corrupt + locator-invalid`；传入已 close session → `corrupt + lease-expired`；`enumerationFailed`（segments 目录缺失）→ 与现状 `corrupt + manifest-invalid` 逐字节等同 |
| A5 无泄漏 | 自租约路径读后注册表可再删（sweep 立即生效——close 生效证明）；重复调用无累积（注册表分区空） |

### 8.2 包级新文件 B：`packages/namespace-diagnostic-log/test/file-adapter-retention-lease-gate.test.ts`

| 用例 | 断言要点 |
|---|---|
| B1 既有矩阵零回退 | T-C1..T-C8/T-B6 语义在 S0′ 改造后原样成立（可与既有文件并跑） |
| B2 卫生守约 | 闭组 orphan-BIN（手工构造 bin-无-jsonl-无-marker、非 open 段）+ 活跃 session → sweep 后 bin 仍在、`leaseBlockedGroups ≥ 1`；close 后再 sweep → `orphanBinsDeleted ≥ 1` |
| B3 报告口径 | P1 租约止步与 P0 跳过同计入 `leaseBlockedGroups`；`retention-swept` 事件计数一致 |

### 8.3 包级新文件 C：`packages/namespace-diagnostic-log/test/strict-reader-materialize-unknown.test.ts`

| 用例 | 断言要点 |
|---|---|
| C1 unknown 分类 | emitter 产 `fatal/committed:true/effect:'unknown'`（pipeline 合法路径）→ `materializeStrictRecordUpdate` → `{kind:'unknown'}` |
| C2 none 收窄 | noop / rejected / `fatal committed:false` → `{kind:'none'}`；三形状逐一 pin |
| C3 回归 | committed-update / fatal-committed-update（inline+sidecar 双 storage）→ `{kind:'update'}`；`update-omitted` → reason 原样 |
| C4 【R1.1-F1】effect 缺席分类 | 手工写 `fatal / committed:true /（无 effect 字段）` 行（emitter 不可达——pipeline `resultShapeValid` :115–123 只挡写侧；JSONL 手拼，D6 同法）→ strict 读 `entry.ok===true` → `materializeStrictRecordUpdate` → `{kind:'unknown'}`；对照 `fatal / committed:false /（无 effect）` → `{kind:'none'}`（推进面保真） |

### 8.4 应用级新文件 D：`apps/yjs-server/test/diagnostic-replay-lease-completeness-red.test.ts`

| 用例 | AC | 断言要点 |
|---|---|---|
| D1 到期/续租 | AC1/AC5 | `readSession:{ttlMs:小, maxLifetimeMs:有界, clock:步进假钟}` → `partial` + issues 含 `lease-expired`、`lastAppliedSequence` 停在最后成功物化段；unbounded 同钟 → `complete` |
| D2 会话恒释放 | AC1 | replay 返回后立即 sweep（0/0 retention）→ 全部闭组可删（lease 已 close 的端到端证明）；replay 结果本身不受影响 |
| D3 unknown committed effect | AC3 | genesis + update + **fatal-unknown** + update 链 → `partial`、issues 含 `update-unknown`、`lastAppliedSequence==='2'`（不推进过 fatal-unknown）、snapshot 复现前缀态——**同时改写 SA7 重点 4（diagnostic-replay-host-lifecycle-sa7.test.ts:445–470）为该语义**（旧 pin「complete/issues=[]/seq4」废止） |
| D4 omitted | AC4 | committed-omitted（既有 R7 保留）+ 新增 fatal-committed-omitted 变体 → 双双 `partial` + `update-omitted`；【R1.1-N1】乱序 ∧ committed-omitted 变体 → `sequence-gap`（连续性复核先于 omitted 判定的优先级翻转 pin） |
| D5 undecodable | AC4 | inline 载体装合法 CRC/长度的非 yjs 字节 → applyUpdate throw → `partial` + `update-undecodable`（既有通道 pin） |
| D6 missing/畸形 | AC4 | 中段删整行 → `sequence-gap`（R5 保留）；手工写 `committed/effect:'update'` 但 update 畸形行 → 非 complete（VFSL/invalid 通道，防御 G5 pin） |
| D7 complete 保真回归 | AC5 | genesis + updates + noop + rejected + `fatal committed:false` 混合健康链 → `complete`、`issues===[]`、`lastAppliedSequence` 计入全部连续记录、快照逻辑等价生产终态（扩展 R1 形状） |
| D8 【R1.1-F1】effect 缺席变体 | AC3/AC4 | genesis + update + **fatal-committed-true 无 effect 字段**（JSONL 手拼行，D6 同法）+ 尾部 update 链 → `partial`、issues 含 `update-unknown`、`lastAppliedSequence` 停在该记录之前（不推进过该 record）、snapshot 复现前缀态——F-1 的 replay 端 pin |
| D9 【R1.1-N2】pre-genesis 损坏载体 | AC4 | genesis 之前的手拼 update 记录 + sidecar bin 缺失 → `failed`、issues 含 invalid 码（如 `frame-missing`）**与** `genesis-missing` 并存——每条 attempt 先物化的可观测增量备案（现状该形状静默跳过、仅 `[genesis-missing]`） |

### 8.5 既有测试的处置表

| 既有文件 | 处置 |
|---|---|
| `file-adapter-read-session.test.ts`（T-C1..C8/T-B6） | 保留零改动（S0′/hygiene 改造不得回退任何断言） |
| `file-adapter-retention*.test.ts`、`file-adapter-retention-deletion-windows.test.ts` | 保留（deleteGroup 步序语义不变） |
| `file-adapter-strict-reader.test.ts` | 保留（快照驱动下数值等同；若 ④′ 包络有字节差以本设计 §3.2.2 为准修正断言归属 SA6） |
| `apps/.../diagnostic-replay-host-lifecycle-red.test.ts` R1–R11 | 保留（complete 门未动） |
| `apps/.../diagnostic-replay-host-lifecycle-sa7.test.ts` 重点 4（:445–470） | **废止旧断言，改写为 D3 语义**（issue mandate：AC3 逐字否定该 pin） |
| `record-vocabulary.test.ts` / `schema-freeze.test.ts` / `identity.test-d.ts` | 保留（emission/schema 面零改动；fatal-unknown 形状 pin 照旧成立） |

- 【R1.1 备注】N-1/N-2 的可观测增量（omitted×断链 issue 码翻转 / pre-genesis 物化前置的 issue 集合扩容）经 SA2 R0 亲验**无既有 pin 覆盖冲突**；新 pin 落 D4 乱序-omitted 变体与 D9，既有文件处置零变化。

### 8.6 测试卫生要求

- 所有外部 session 用例 `afterEach` close（模块级注册表跨用例存活——泄漏会污染后续 sweep 断言；既有 T-C 系同款纪律）。
- 步进假钟必须为**每次 `now()` 调用前进**的态对象（reader/renew/replay 多点取时）——不能只设静态时刻。

---

## 9. 验证命令（SA3/SA4/SA7 与总控亲跑面）

```bash
# 全量（根 package.json 权威 scripts）
pnpm typecheck
pnpm test                      # vitest run --typecheck, maxWorkers 1

# 定向（改动面先行——红灯→绿灯的最小环）
NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run \
  packages/namespace-diagnostic-log/test/strict-reader-lease.test.ts \
  packages/namespace-diagnostic-log/test/strict-reader-materialize-unknown.test.ts \
  packages/namespace-diagnostic-log/test/file-adapter-retention-lease-gate.test.ts \
  packages/namespace-diagnostic-log/test/file-adapter-read-session.test.ts
NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run apps/yjs-server/test/diagnostic-replay

# 包级回归（快照驱动改造的零回退面）
NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/namespace-diagnostic-log

# schema 冻结自证（本票应零差异）
pnpm schema:check
```

- 完成定义：`pnpm typecheck && pnpm test` exit 0（259+ 文件全绿，含新增文件）；`git diff` 不含 DENY 路径（§0.3）。

---

## 10. 风险与残余

| # | 风险/残余 | 处置 |
|---|---|---|
| R-1 | `readStreamStrict` 是全仓最高频公共读取面（200+ 测试调用点），自租约改造触碰步骤 ④/⑤ | §3.2.2/§3.2.4 论证零行为漂移（快照=同源枚举；vanished 仅罕见分支）；SA4 静态复审以 INV-227-1/2/9 为核；8.5 处置表钉既有文件零回退 |
| R-2 | worker_threads 下注册表不共享 → 跨 worker 无保护 | INV-9 冻结域外（部署约束）；本设计不试图解决，AGENTS.md 增量段重申 |
| R-3 | `lease-expired` 双域同码可能在聚合报告中产生轻微歧义 | 两域码表分立且 replay 透传 reader 码时本就并存（§2.6 先例）；接受 |
| R-4 | `fatal committed:false + effect:'update'`（VFSL 布尔放宽残差）仍按 none 推进 | 维持 #155 判定（committed:false 自证无提交）；**R1.1 闭环：SA2 R0 §5 裁决「维持默认」**——与 F-1 形状（committed:true）方向相反、分开处置；如未来需升格为 issue 另开增量票 |
| R-5 | SA7 重点 4 pin 改写属「改测试断言」——须由 SA6 在新红文件落地同 change 内完成 | §8.4/§8.5 明示；总控 dispatch 时点名 |
| R-6 | 自租约 + 步进检查点的性能开销 | 每段一次 `now()` 比较（未到期零副作用快路径）；到期续租 O(快照) 注册表更新仅在长读出现——可忽略 |
| R-7 | replay 内部 session 与调用方外部 session 并存时的租约叠加 | 注册表本就多会话叠加（entry list）；sweep 任一未过期即阻塞——语义正确 |

---

## 11. 提请总控/SA2 的裁决点

> 【R1.1 注】SA2 R0 §5 对四点均表「维持默认」：G-227-2 随本轮闭环（见 §10 R-4）；G-227-1/3/4 如无新证据随实现落地，不再单独等候裁决。

- **G-227-1**：`renewIfDue(marginMs)` 对非法 margin 取宽容（视同 0）而非 throw——§3.1（默认通过；SA2 可推翻）。
- **G-227-2**：`fatal committed:false + effect:'update'` 残差形状是否在本票升格为 replay issue——§10 R-4（默认**不**升格，维持 #155）。
- **G-227-3**：`update-unknown` 码名（备选 `committed-effect-unknown`）——默认取与 `update-omitted`/`update-undecodable` 平行的短名。
- **G-227-4**：replay `readSession` 缺省 `maxLifetimeMs=null`（显式续租）vs 有界缺省——默认 null（ADR 允许项 + #154 先例 + 生产不可达失败臂）。

---

## 12. 下阶段建议

1. ~~R1 全量评审~~ 已完成（SA2 R0：reject——窄修型，F-1 单一实质发现 + N-1/2/3 备案要求）。R1.1 提请 SA2 **窄域复审**：只审修订日志所列增量（§4.1 补行 / §4.2 收窄 / INV-227-5 / §5 语义行 / C4·D8 / N 备案三处），预期直接 approve。
2. SA6 按 §8 写红灯（先 A/C/D 三文件；B 文件可与 A 并行；SA7 重点 4 改写同 change）。
3. SA3 按 §7 清单实现（顺序建议：read-session.ts → reader.ts → file.ts → diagnostic-replay.ts → index.ts → 文档）。
4. SA4 静态复审对照 INV-227-1..10；SA7 动态验证跑 §9 定向 + 全量。
