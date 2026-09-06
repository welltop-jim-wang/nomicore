# 设计修订 R2.1 — Issue #227：租约取得点前移、统一释放与 S0′ 提交时刻（SA1 / R2.1）

- 任务：welltop-jim-wang/nomicore#227（parent PR #142；发布 PR #251）
- Worktree：`/home/wangjian/nomicore-fix-issue-227`（branch `mabf/issue-227`，被修订基线 = 已提交 **`31ff694`**「fix(diagnostics): lease strict replay and fail closed」）
- 作者：SA1（design lead）；状态：**R2.1**（SA8 R2 冲突门禁 reject（窄修型）唯一必修项 F-1 的窄修）提请 SA2 窄域复审——**免重开设计轮冲突门禁**（SA8 R2 裁定 `requiresConflictRecheck: false`：ADR 冲突面 clear、owner 两条必修项承接正确，驳回仅因既有测试兼容声明失实，见 `task_issue-227_rev2_design_conflict_report.md` §Verdict/§4/§5）
- **本轮只产出设计，不实现、不提交、不推送**（实现归 SA3、红灯归 SA6——路由见 §12）

### 修订日志

- **R2.1（本轮，响应 SA8 R2 冲突门禁 reject（窄修型）F-1）**：**零架构变更（D8–D11 及其锚点/论证/不变量一字不动）、零新码（§5 词表仍零增量）、零 DENY 面触碰**——SA8 R2 已逐项通过的面（O-1/O-2 逐句承接、C1–C10、A6/B4 可构造性与红档案）全部保持原样：
  - **F-1（必修，唯一驳回事由）**：§2「既有测试兼容面」补 `file-adapter-read-session.test.ts` T-C3/T-C4 段——其**双钟构造**（适配器恒定钟 T0 × 会话推进钟 T0+1001/T0+2000）在 D11/INV-227-12 落地后必翻红，性质裁定 = **测试夹具钟源对齐**（非语义回归：新不变量下「按策略时刻已过期、按提交时刻仍活跃」的场景**正确地**阻塞）；§8.3 处置表增 T-C3/T-C4 行——夹具改**共享推进钟**（`makeWriter` 的 `clock` 直传同一 `clock` 对象，适配器提交时刻与会话钟同源推进），**断言语义零变化**（仍钉「过期放行/过期重租」），SA6 与 §8.2 B4 同一 change 落地；§0.2 ALLOW 白名单补 `file-adapter-read-session.test.ts` 行；§12 路由同步。
  - **N-a（精度勘误，随修）**：§2 B 系括注数值修正——B 系会话 ttl 实注入 **60_000**（until T0+60_000），非缺省 15s；结论不变（初查/S0′ 两时刻均判活跃，零回退）。
  - **N-b（随修）**：§12 第 2 步 SA2 K-binding 预期补 T-C3/T-C4 处置行——构造对齐**非预红面**（共享钟构造于新旧实现均绿），红基线证据仍以 A6a/B4b 为准。
  - **N-c**：dispatch 日志稀疏补记归总控（§12 第 8 步维持原列，非设计缺陷）。
- **R2（2026-09-06，响应 owner PR #251 评审评论）**：两条必修项，**零架构变更、零新码（§5 词表零增量）、零 DENY 面触碰、replay/diagnostic-replay.ts 零改动**：
  - **O-1（必修，→ D8/D9/D10）**：strict reader 自建 session 取得点从 ④′（reader.ts:546–604）前移至 ① 路径安全检查之后、② 首次 manifest I/O（:456–499）之前；自建 session 改**唯一 finally** 释放（现状分散三处 close 站点删除），覆盖 manifest 缺失、JSON 损坏、gate 失败等一切持约早退；增测试证明 manifest read/gate 期间 lease 已注册并覆盖该阶段与 retention sweep 并发（§8 A6/A7）。
  - **O-2（必修，→ D11）**：S0′ 提交点复查弃用 sweep 起始 `now`（file.ts:1099/:1272/:1340 现传参），改为在 S1 rename 前以 `clock.now()` 取**真正提交时刻**；增测试证明 lease 在 sweep 开始后、S1 rename 前到期时允许删除（§8 B4；P0 同类门 → 裁决点 G-227-5，B5）。
- **R1.1 及此前轮次**：`wiki/raw/task_issue-227_design.md`（R1.1，SA2 approve + K-1..K-4 全兑现）；SA4 R1/R2 approve（`task_issue-227_sa4_review.md`）；实施冲突门禁 clear（`task_issue-227_impl_conflict_recheck.md`）。**R1.1 的 D1–D7、INV-227-2/4..10、分类表 §4、词表 §5 本轮一字不动**——R2 只动租约生命周期的「取得点/释放结构」与 sweep 复查的「取时来源」两处。
- 权威上位契约：ADR `docs/adr/0012-vfsl-validated-jsonl-and-framed-sidecar-change-log.md` §Retention 与删除（L280–299）、§Strict reader 与诊断性 replay（L301–318）；ADR-0011 L97–105；包契约 `packages/namespace-diagnostic-log/AGENTS.md`（#227 增量段）；**owner PR #251 评审评论（2026-09-06T13:14:31Z，welltop-jim-wang）= 本轮规范源**。

---

## 0. 任务与范围

### 0.1 新增缺口（owner 评审锚点 → 技术读法）

| # | 缺口 | 现状证据（`31ff694` 精确锚点） |
|---|------|------------------------------|
| G6 | **manifest 阶段无租约**（owner 点 1 前半）：`readStreamStrict` 自建臂的 session 在 ④′ 才取得，而首次磁盘触达是 ② manifest 读取——②（readFileSync/JSON.parse，reader.ts:456–499）与 ③ manifest 门/policy（:501–542）全程无 lease。未传入外部 session 的生产调用在 manifest I/O 与校验期间不受保护：该窗口内 retention 删组后，快照（open 内枚举）再注册已迟到——「读了 manifest 世界、租了删除后世界」，AC1「读取、校验…期间取得」未覆盖 manifest 阶段 | ① 路径安全（:441–453，零 fs）→ ②（:456）首 IO → ④′ open（:569–576）。传入臂（replay，diagnostic-replay.ts:129–139）天然合规：session 先于 readStreamStrict 存在，②③ 已在其保护下——**缺口仅在自建臂** |
| G7 | **释放非统一 finally**（owner 点 1 后半）：自建 session 的 close 分散三处（④′ enumerationFailed 臂 :590–592、⑦ :838–841、⑧ catch :868–871），无函数级 finally。G6 修复后 ②/③ 早退（manifest 缺失 :460–470、JSON 损坏 :472–486、非对象 :487–498、schema-compile 失败 :503–513、gate 失败 :516–527、policy 失败 :531–541、incompatible）都将成为**持约早退**——必须有唯一 finally 兜住全部出口与异常逃逸，否则早退泄漏租约（阻塞后续 sweep，A5 无泄漏面回退） | owner 原文「使用统一 finally 确保自建 session 最终释放」 |
| G8 | **S0′ 复查时刻回溯**（owner 点 2）：`deleteGroupIfUnleased`（file.ts:1093–1103）以 `now` 入参复查 `segmentLeased`，P1（:1266–1273）/P2（:1334–1341）传入的都是 **sweep 起始捕获的 `now`**（`sweepNow(now)` :1224；`sweepRetention(options?.now ?? clock.now())` :1529）。年龄统计/字节 stat（`groupAgeExpired` :1262、`groupBytesBeforeDelete` :1263/:1331）期间注册且到期的租约，在真正 S1 rename 前仍被旧 `now` 判活跃 → 过期租约继续阻塞（INV-4「过期租约永不阻塞」字面违约）、`leaseBlockedGroups` 口径失真、年龄/字节预算不能及时收敛 | owner 原文「S0′ 复查时读取真正提交时刻的当前时间，不复用 sweep 起始时间；如需测试确定性，注入 clock」 |

### 0.2 ALLOW 路径（SA3 白名单——本轮增量；R1.1 §0.2 其余行继续有效）

| 路径 | 改动 |
|------|------|
| `packages/namespace-diagnostic-log/src/reader.ts` | §3.1：自建臂取得点前移（① 后 ② 前）+ 取得检查点 + `StrictReadRequest.clock?`；§3.2：唯一 finally（三处分散 close 删除）。**④′ 的 enumerationFailed 反应与快照派生位置不动（包络冻结，§3.1.1）** |
| `packages/namespace-diagnostic-log/src/adapters/file.ts` | §3.3：`deleteGroupIfUnleased` 弃 `now` 参、复查时刻改 `clock.now()`（适配器闭包钟，:309）；P1/P2 调用点同步；G-227-5 采含时 P0 卫生门同规 + `hygieneStream` 弃 `now` 参 |
| `packages/namespace-diagnostic-log/test/strict-reader-lease.test.ts` | §8 A6a/A6b/A7 增量用例 |
| `packages/namespace-diagnostic-log/test/file-adapter-retention-lease-gate.test.ts` | §8 B4a/B4b（+G-227-5 采含时 B5）增量用例 |
| `packages/namespace-diagnostic-log/test/file-adapter-read-session.test.ts` | 【R2.1/F-1】**仅 T-C3/T-C4 夹具钟源对齐**：`makeWriter` 的 `clock` 直传共享推进钟对象（断言零改动）——§8.3 处置行；SA6 与 B4 同一 change 落地；该文件其余用例零改动 |
| `packages/namespace-diagnostic-log/AGENTS.md` | #227 增量段追加 R2 句（取得点/统一 finally/提交时刻语义 + `now` 语义分工） |

### 0.3 DENY 路径（本轮新增/重申；R1.1 §0.3 全部继续有效）

| 路径 | 理由 |
|------|------|
| `apps/yjs-server/src/diagnostic-replay.ts` | **本轮零改动**——传入臂已合规（session :129–136 先于 readStreamStrict :139 的 manifest I/O）；其 locator 读的是 namespace 定位器 `namespaces/{ns}/current.json`（:95–98），非 stream manifest，retention 不删之；locator→open 窗口内删组由读取面诚实降级观测（全删 → zero records → `genesis-missing`/failed；部分删 → `history-trimmed` → complete 门关闭），无静默丢失（§6 备案残余 R2-R3） |
| `read-session.ts` / `retention.ts` / `index.ts` / `apps/yjs-server/src/index.ts` | 本轮零改动——clock 供参面（`DiagnosticReadSessionRequest.clock` :34）、注册表、`renewIfDue` 均已存在；`StrictReadRequest` 增可选字段不需要 index 导出变更 |
| P1/P2 判定点初查与年龄/字节门的取时 | **保持 sweep 起始 `now`**（owner 只命门 S0′）——候选/年龄/字节是策略面，sweep 单一策略时刻是既有确定性契约（T-A7 锚点、「now 可注入」JSDoc :125 保留）；初查过期误判过阻的形态自愈于下一轮 sweep（R2-R4 备案） |
| 词表 / health 事件 / complete 门 / 分类表 / 删除协议 S1–S3 | 零新码（INV-227-10 维持）、零事件成员、INV-227-7 逐字不动、§4 分类零触碰、`deleteGroup` 本体零 hunk |

---

## 1. 验收契约映射（owner 两条必修项 → 设计决策 → 测试）

| 要求（owner PR #251 评论原文） | 设计决策 | 测试（§8） |
|---|---|---|
| 「在路径安全检查后、第一次 manifest I/O 前取得 session」（AC1 持约范围扩至 manifest 阶段） | D8 取得点前移（§3.1.1）+ D10 取得检查点与 `StrictReadRequest.clock?` 确定性缝（§3.1.2） | **A6a（红差分，31ff694 上必红——缝缺席即红）**、A6b（并发共存，红→绿） |
| 「使用统一 finally 确保自建 session 最终释放」（覆盖 manifest 缺失、JSON 损坏、gate 失败等早退） | D9 唯一 finally（§3.2，三处分散站点删除） | A7 释放矩阵（对旧实现空洞绿灯、对漏 finally 的新实现红灯的回归 pin） |
| 「证明 manifest read/gate 期间 lease 已注册，并覆盖该阶段与 retention sweep 并发」 | D10：取得检查点落在**注册后、manifest 读取前**的唯一可注入钟读取位（§3.1.2 时序论证）——probe sweep 在该位被租约阻塞即为「已注册」的直接运行时证据 | A6a（probe 阻断断言 `leaseBlockedGroups ≥ 1 ∧ deletedGroups === 0` + manifest 删除差分）、A6b |
| 「S0′ 复查时读取真正提交时刻的当前时间，不复用 sweep 起始时间；如需测试确定性，注入 clock」（AC2/INV-4） | D11 提交时刻取时（§3.3；`clock.now()` 于 S1 rename 前即刻读取；适配器 `config.clock` 即注入面） | **B4a/B4b（31ff694 上 control 臂必红）**、B5（G-227-5 采含时） |
| 「租约在 sweep 开始后、S1 rename 前到期时，应允许删除」 | D11 + B4a 构造：租约在 sweep 初查通过后、于 S0′ 取时回调内注册且其到期早于返回时刻 → 提交时刻判过期 → 删除放行 | B4a 主臂（`deletedGroups === 1 ∧ leaseBlockedGroups === 0 ∧ probeSession.closed === false`） |

AC3/AC4 与 R1.1 §1 映射行**零变化**（本轮不触碰分类/complete 面）；AC5 矩阵按 §8 增量扩两族。

---

## 2. 现状锚点（复审用精确引用，全部亲读自 `31ff694`）

- **读取链时序**：`readStreamStrict`（reader.ts:405）①′ 传入 session 防御门（:411–440，零 fs）→ ① 路径安全（:441–453，零 fs；`streamLayoutPaths` :454 纯派生）→ **② manifest 读取 = 全函数首次磁盘触达（:459 readFileSync）** → ③ 门/policy（:501–542）→ ④′ 取得 session（:546–604；自建臂 :569–576 open，enumerationFailed 反应 :557–568/:590–603）→ ⑤ 逐段循环（逐段续租检查点 :659–662；vanished :674–700）→ ⑦ 聚合返回（close :838–841）→ ⑧ 兜底 catch（close :868–871）。
- **open 内部时序**（read-session.ts:190–249）：id/ttl/maxLifetime 校验（:191–204）→ 枚举（:209–214，失败收敛空快照+标志）→ **`openAt = clock.now()`（:215，先于注册）** → leasedUntil（:216）→ 注册表登记（:229–247，「枚举→注册」同一同步函数内无 yield——open 即原子，R1.1 §3.5 腿 1 维持）。
- **sweep 取时面**（file.ts）：适配器闭包钟 `const clock = config.clock ?? { now: () => Date.now() }`（:309）；构造期自动 sweep `sweepNow(clock.now())`（:1517，T-A7）；`sweepRetention(options?.now ?? clock.now())`（:1527–1532，now 入参 = 策略时刻）；P1 初查 :1258 / S0′ 呼叫 :1266–1273；P2 初查 :1325 / S0′ 呼叫 :1334–1341；P0 卫生门 :1173–1176；`deleteGroupIfUnleased`（:1093–1103）签名含 `now` 并直传 `segmentLeased`。
- **segmentLeased 惰性过期**（read-session.ts:252–256）：`entry.leasedUntil > now` 才算活跃——**判定结果由查询时刻的 `now` 决定**，这正是 G8 的机制根源：同一注册表条目，sweep 起始 `now` 与提交时刻可给出相反答案。
- **既有测试兼容面（R2.1 修订——SA8 R2 F-1 后逐例亲读重验）**：
  - `strict-reader-lease.test.ts` A2 步进钟用例走**传入臂**（session+clock 供参）——本轮检查点仅自建臂，A2 时序零漂移；
  - `file-adapter-retention-lease-gate.test.ts` B 系：适配器恒定注入钟 `T0`（:59）+ 会话恒定钟 `{now: () => T0}`、ttl=**60_000**（:95–96/:123–124/:159–160/:192–193——until **T0+60_000**，R2 误注缺省 15s，N-a 勘误）+ `sweepRetention({now: T0+1000})` 组合——初查（入参 now）与 S0′（D11 后 `clock.now()=T0`）**两时刻均判活跃**（T0+60_000 > T0+1000 > T0）→ 阻塞结论两实现一致，零回退（§8.5/§8.3）；
  - `file-adapter-read-session.test.ts`：T-C1/C2/C6/C7/C8/T-B6 会话钟恒定 `T0`（ttl=60_000 → 初查即阻，S0′ 不可达）、T-C5 推进钟但**零 sweepRetention 调用**（纯会话状态机面，D11 不触及）——均零回退；
  - **T-C3（:133–150）/T-C4（:152–172）——唯一双钟构造，D11 落地后必翻红（R2 声明「保留零改动」失实，F-1）**：`makeWriter`（:62–72）给**适配器**注入恒定钟 `{now: () => T0}`（:69），而会话用**可推进**钟 `newClock(T0)`（ttl=1000 → until T0+1000），并以推进值 `clock.t = T0+1001`（T-C3）/`T0+2000`（T-C4）作 `sweepRetention({now})` 入参。现行代码初查与 S0′ 同用入参 now → 判过期 → 放行/照删 → 两 pin 绿（owner「494 个测试全部通过」与此一致）；**D11 后 S0′ 改读适配器闭包钟（恒 T0）→ `segmentLeased(…, T0)`：`T0+1000 > T0` → 判活跃 → `'lease-blocked'` 前缀止步 → T-C3 `deletedGroups=0 ∧ leaseBlockedGroups≥1`（双断言翻红）、T-C4 `deletedGroups=0`（断言翻红）**；且初查（入参 now=T0+1001/T0+2000）判过期放行 → sweep **必然到达** S0′（年龄门走 record observedAt ≤ cutoff、字节 >0——无任何上游门可兜住）。**性质裁定（R2.1）**：这是两钟在新语义分工（INV-227-12：策略时刻 vs 提交时刻）下的**合法漂移**——该构造形成「按策略时刻（推进的会话钟值）已过期、按提交时刻（适配器钟）仍活跃」的场景，新不变量下**正确地**阻塞——语义无错，须修的是测试夹具的钟源对齐（§8.3：共享推进钟，断言语义零变化），**非** D11 实现回归；错误修法（回退提交时刻取时、或 `Math.max(now, clock.now())` 折衷）违 INV-227-12 与 owner「不复用 sweep 起始时间」字面，明示禁止。

---

## 3. 租约取得与释放（O-1：D8/D9/D10）

### 3.1 D8 + D10：取得点前移与确定性缝

#### 3.1.1 取得点（替换 ④′ 的取得半段；反应半段原地不动）

```
①′ 传入 session 防御门（:411–440）【不动——零 fs】
① 路径安全（:441–453）【不动——零 fs】
④″ 会话取得（新位置：① 之后、② 首次 manifest I/O 之前）：
   a. request.session 提供：session := request.session（纯绑定——传入臂的 lease 自调用前即存在，
      manifest 阶段天然持约；①′ 已完成身份/已闭校验）
   b. 未提供（自建臂，owner 命门）：
      session := openDiagnosticReadSession({ rootDir, namespaceId, streamId,
                                             ttlMs/maxLifetimeMs 取冻结缺省,
                                             clock: request.clock })   // ← 新增供参面
      ownedSession := session                                          // 唯一 finally 释放（§3.2）
      取得检查点：if (!session.renewIfDue(READ_SESSION_RENEW_MARGIN_MS))
                    return corrupt + lease-expired（manifest:null，零进一步 IO——诚实失败臂前移到任何 IO 前）
② manifest 读取（:456–499）【自此起一切 IO 均在未闭会话保护下】
③ manifest 门 / policy（:501–542）【不动】
④′ 反应半段（原位保留）：传入臂 enumerationFailed 反应（:557–568）/ 自建臂同包络（:590–603）/
    segments := [...session.segments]（:605）/ historyTrimmed（:611）【全部不动——包络冻结】
⑤ 逐段循环（逐段检查点 :659–662 / vanished :674–700）【不动】
```

- **快照时机前移的零漂移论证**（沿用 R1.1 §3.2.2 同一论证前移一位）：segments 来自同一 `enumerateSegmentGroups` 同源输出，仅取值时机从「门后」移到「门前」；同步单线程下两次枚举间无任何写者，数值逐字节等同。`historyTrimmed`/`earliestRetainedSequence`/roll-target 核查全部消费快照，不受影响。
- **`StrictReadRequest.clock?`（新增可选字段，加性演进）**：`{ now(): number } | undefined`——仅自建臂消费（透传 open）；传入臂忽略（调用方拥有会话生命周期与时钟）。先例：`DiagnosticReadSessionRequest.clock`（read-session.ts:34）、`DiagnosticReplayReadSessionOptions.clock`（diagnostic-replay.ts:63）——本票自己批准过的注入面形状。
- **取得检查点（D10）的双重身份**：
  1. *真实语义*：「每个 IO 阶段在刚验证过的租约下进入」纪律的取得边界执行点——注入极小 ttl 时诚实失败前移到任何 fs IO 之前（与 ①′ 已闭会话臂同族包络）；缺省 15s/margin 1s 下为 `now+1000 < leasedUntil` 快路径真值，零副作用。
  2. *确定性缝*：open 内部的钟读取（`openAt`，:215）**必然先于注册**（leasedUntil 依赖 openAt，注册条目需要 leasedUntil——顺序不可倒置），故「注册后、manifest 读取前」窗口内不存在任何天然钩子；取得检查点的 `renewIfDue` **无条件先读钟**（read-session.ts:157），恰落在该窗口——owner 命令的「证明 manifest read/gate 期间 lease 已注册」测试由此可构造（§8 A6a 时序表）。缺省真实钟下该检查点为纯快路径，生产行为零变化。
- 自建臂 open 的防御 catch（结构性不可达：① 已过文法、冻结缺省合法）保留 corrupt + manifest-invalid 包络（同 R1.1 ④′ catch 臂）。

#### 3.1.2 A6a 时序论证（为何 call#2 即 owner 窗口——SA6/SA4 复核锚点）

| 时钟调用序（自建臂 + `request.clock` 注入） | 位置 | 相对窗口 |
|---|---|---|
| call#1 | open 内 `openAt`（read-session.ts:215） | 注册**前**（枚举后）——不可作 probe 位 |
| **call#2** | **取得检查点 `renewIfDue`（§3.1.1）** | **注册后、② manifest 读取前——owner 窗口** |
| call#3+ | ⑤ 逐段检查点（:659） | manifest 阶段后 |

在 `31ff694` 上自建臂用真实钟、**不消费 `request.clock`**（字段不存在）→ fake 钟全函数零调用 → 钩子永不触发 → A6 系断言必红（缝的缺席即红，§8）。

### 3.2 D9：唯一 finally（统一释放）

```ts
let ownedSession: DiagnosticReadSession | null = null
try {
  ...①′/①/④″/②/③/④′反应/⑤/⑥/⑦（全函数体）...
} catch {
  ...⑧ 兜底 corrupt + manifest-invalid（现 :865–882 原样）...
} finally {
  ownedSession?.close()   // 唯一释放点；close 幂等（read-session.ts:162–166）
}
```

- **删除三处分散站点**：④′ enumerationFailed 臂的 `session.close(); ownedSession = null`（:591–592）、⑦ 的 close（:838–841）、⑧ 的 close（:868–871）——由 finally 统一承接（幂等性使分散站点本就冗余，统一后外部可观测行为不变，A5 无泄漏面零回退）。
- **覆盖清单（owner 点名的早退全部在内）**：② manifest 缺失（:460–470）/ JSON 损坏（:472–486）/ 非对象（:487–498）；③ schema-compile 失败（:503–513）/ **gate 失败**（:516–527，corrupt 与 incompatible 两臂）/ policy 提取失败（:531–541）；④′ 反应（enumerationFailed / 自建 open 防御 catch）；⑤ 各 break（lease-expired / segment-vanished 后继续聚合）；⑦ 两处正常返回；⑧ 异常逃逸。**新不变量见 INV-227-11。**
- 传入臂不 close（生命周期归调用方——R1.1 契约不变，replay 的 finally :304–308 维持唯一责任方）。

### 3.3 D11：S0′ 提交时刻取时（O-2）

```ts
/** #227 R2（owner PR #251 点 2）：S0′ 提交点复查以 S1 rename 前的 clock.now() 取真正提交时刻
 *  （不再复用 sweep 起始 now——INV-227-12）。策略面（候选/年龄/字节口径）仍用 sweep 入参 now。 */
function deleteGroupIfUnleased(
  rootDir: string, namespaceId: string, streamId: string,
  segmentsDir: string, segment: string,
): 'deleted' | 'lease-blocked' | 'failed' {
  if (segmentLeased(rootDir, namespaceId, streamId, segment, clock.now())) return 'lease-blocked'
  return deleteGroup(segmentsDir, segment) ? 'deleted' : 'failed'
}
```

- P1（:1266–1273）/ P2（:1334–1341）调用点弃 `now` 实参；`deleteGroup` 本体（S1/S2/S3）零 hunk。
- **取时来源** = 适配器闭包钟（`config.clock ?? Date.now`，:309）——**注入面已存在**（owner「如需确定性注入 clock」的承载：测试注入 `config.clock` 即可确定性驱动提交时刻，无需新 API）。`sweepRetention` 的 `options.now` 语义**收窄为策略时刻**（JSDoc :125 与 AGENTS.md 同步措辞）：初查（:1258/:1325）、年龄门（:1262）、字节统计仍用它——T-A7「构造期自动 sweep 恒以注入钟为 now」对策略面继续成立。
- **语义分工原则（INV-227-12）**：*策略评估*用 sweep 单一策略时刻（确定性、可注入、一次快照）；*删除提交门*用提交时刻现值（诚实评估「此刻是否有活跃租约」）。两时刻在同步单线程生产路径上数值几乎相同——本修复把正确性从「调度事实」（时钟不走）升格为「结构不变量」（提交门不依赖任何时刻假设），与 R1.1 §3.5 同一方法论。
- **G-227-5（裁决点，默认采含）**：P0 卫生 orphan-BIN unlink 门（:1173）是同类**删除提交点**（无 S1 rename，unlink 即提交），现同样用 sweep 起始 `now`。默认随 D11 一并改 `clock.now()`（一行同机制改动 + `hygieneStream` 弃 `now` 参 :1126–1131/:1240）——统一「提交门 = 提交时刻」不变量，消除「P0 为何不同」的复审问题；若 SA2 裁定越权可单点退回（退回时登记残余 R2-R4b：P0 过期误阻自愈于下一轮 sweep）。owner 原文点名范围为 S0′（file.ts:1090–1108/1253–1261/1331–1339），P0 门（:1173）不在点名内——此为类推扩权，明示待裁。

---

## 4. TOCTOU 论证增补（AC2，R1.1 §3.5 三腿的修订）

R1.1 三腿（open 原子注册 / S0′ 提交点复查 / marker 不可见）维持；R2 补两处：

4. **取得先于一切受保护观察**（G6 修复后成立）：自建臂的注册严格先于首次 manifest I/O——「先观察后注册」的静默丢失窗口（manifest 世界 ≠ 快照世界）关闭；调用开始后发生的删除要么被 S0′ 阻止（快照组受保护），要么发生在注册前（删除先于读取开始的世界线，读取诚实反映，`history-trimmed`/`genesis-missing` 降级，非静默）。
5. **提交门时刻诚实**（G8 修复后成立）：「没有 reader lease」在 S1 rename 前以提交时刻评估——sweep 开始后注册、rename 前到期的租约不再阻塞（INV-4 复位）；反向（sweep 开始后注册且 rename 时仍活跃）依旧阻塞——S0′ 的原使命（R1.1 腿 2）不受影响，B4b control 臂钉死。

推论更新：会话活跃期间其快照组不可被 retention 删除（腿 1+2+5 合取）；过期租约**在任何删除提交点**都不阻塞（INV-4 在提交门处字面成立）。

---

## 5. 稳定码词表 — **零增量**

本轮**零新码、零事件成员、零 reason**：A6/A7 复用 `manifest-invalid`/`lease-expired`（reader 域既有）；B4/B5 复用 sweep 报告既有计数（`deletedGroups`/`leaseBlockedGroups`/`orphanBinsDeleted`）。INV-227-10 维持成立（恰四新码的 R1.1 记账不变）。取得检查点的拒绝包络复用 reader 域 `lease-expired`。**R2.1 增量：T-C3/T-C4 夹具钟源对齐不触碰任何码面/断言（§8.3）——词表零增量结论不变。**

---

## 6. 不变量清单（R2 修订/新增；INV-227-2/4..10 原文不动）

- **INV-227-1（持约读取，R2 改写）**：`readStreamStrict` 的一切磁盘触达——manifest 读取（②）、manifest 门/policy（③）、枚举、逐段读取、校验——都发生在某个未关闭会话的保护下；自建会话在 ① 路径安全检查后、② 首次 manifest I/O 前取得，并在唯一 finally 释放（→ INV-227-11）。
- **INV-227-3（提交点复查，R2 修订）**：P1/P2 每次 S1 rename 前必有 `segmentLeased` 复查，且复查时刻 = 复查点 `clock.now()` 现值（→ INV-227-12）；`'lease-blocked'` 恒走前缀止步。
- **INV-227-11（统一释放，新）**：自建 session 的 close 只存在于函数唯一 `finally`；②/③/④′/⑤/⑦/⑧ 一切出口与异常逃逸均经其释放；函数体内不得再有 `ownedSession.close()` 直呼站点。
- **INV-227-12（提交时刻诚实，新）**：一切删除提交门（P1/P2 的 S0′；G-227-5 采含时 P0 unlink 门）以门点 `clock.now()` 评估租约；sweep 起始 `now` 仅用于候选/年龄/字节策略。等价刻画：任何在提交时刻已过期（`leasedUntil ≤ now`）的租约不得使该次删除被阻。
- 备案残余：**R2-R3** replay locator（current.json）阶段无租约——非 stream manifest、retention 不删、删除后果经 `history-trimmed`/`genesis-missing` 诚实降级，无静默丢失面（§0.3）；**R2-R4** 初查/年龄门维持策略时刻——sweep 起始时活跃、门后到期的租约使本轮 P1/P2 在初查处止步一次，下一轮 sweep 自愈（非正确性问题，capacity 收敛延迟至多一轮）；G-227-5 退回时追加 **R2-R4b**（P0 同型）。

---

## 7. 模块级变更规格（SA3 实现清单——本轮增量）

| 文件 | 函数/类型 | 变更 |
|---|---|---|
| reader.ts | `StrictReadRequest` | 加可选 `clock?: { now(): number }`（仅自建臂消费） |
| reader.ts | `readStreamStrict` | 取得半段前移至 ① 后（④″）；自建臂取得检查点（拒绝 → corrupt+lease-expired，manifest:null）；④′ 反应半段/快照派生原位不动；三处分散 close 删除 → 唯一 finally |
| file.ts | `deleteGroupIfUnleased` | 弃 `now` 参；复查改 `clock.now()`；JSDoc 语义更新 |
| file.ts | P1/P2 S0′ 调用点 | 弃 `now` 实参（:1272/:1340） |
| file.ts | `hygieneStream` + P0 门 + :1240 调用点 | 【G-227-5 采含时】门改 `clock.now()`、弃 `now` 参；退回时零改动 |
| file.ts | `sweepRetention` JSDoc（:125） | now 语义收窄为「策略时刻」（提交门改述） |
| 包 AGENTS.md | #227 增量段 | R2 句：取得点/统一 finally/提交时刻语义 + now 分工 |
| 三个测试文件 | §8 A6/A7/B4(/B5) 增量用例 + 【R2.1/F-1】`file-adapter-read-session.test.ts` T-C3/T-C4 夹具钟源对齐（§8.3——断言零改动，SA6 与 B4 同 change） | 全部 SA6 落地（测试契约 SA6 owned） |

预估 diff 量级：src ≈ **50–80 行净变动**（reader.ts ~35、file.ts ~20、AGENTS.md ~8）；测试另计。`deleteGroup`/`segmentLeased`/`openDiagnosticReadSession`/`renewIfDue`/replay/read-session/index/retention **零改动**。

---

## 8. 测试契约（SA6 增量矩阵；红/绿档案相对 `31ff694` 逐条标注）

### 8.0 方法论（沿用 R1.1 §8.0 三等价类）

「manifest 阶段与 sweep 并发」「S1 前到期」在 vitest `maxWorkers:1` 单线程同步模型下以**注入钟回调位**构造确定性交错：probe/注册动作挂在被测代码自身的钟读取调用上——该调用位的存在性与位置本身就是被测结构（取得检查点 = 注册后唯一钟读位；S0′ 钟读 = 提交时刻位），旧实现上钩子不触发或错位 → 断言必红。

### 8.1 `strict-reader-lease.test.ts` 增量

| 用例 | 档案（vs `31ff694`） | 构造与断言 |
|---|---|---|
| **A6a manifest 阶段持约（红差分）** | **红**（旧自建臂不消费 `request.clock` → fake 钟零调用 → 钩子不触发 → 读取 `ok` 全量、probe 报告无从产生——缝的缺席即红） | 流 ≥1 闭组 + aged（retention 可删）+ 合法 manifest；自建臂 `readStreamStrict({..., clock: fake})`；fake：call#1（open `openAt`）返回 T0 无副作用；**call#2（取得检查点）回调内**：① probe `a.log.sweepRetention({now: T0})` 捕获报告；② `rmSync(manifestPath)`；返回 T0（fire-once 守卫；probe sweep 于 P1 初查即阻 → 其内部零钟调用——亲证无重入）。断言：probe 报告 `leaseBlockedGroups ≥ 1 ∧ deletedGroups === 0`（**manifest read/gate 期间 lease 已注册的直接运行时证据**）∧ 读取结果 `corrupt + [manifest-invalid]`（钩子触发即证明其位于 ② manifest 读取之前 = 取得先于首次 manifest I/O） |
| **A6b 阶段并发共存（红→绿）** | 红（旧实现缝缺席，probe 无从产生）→ 绿 | 同 A6a 但 call#2 只跑 probe sweep **不删 manifest** → 读取 `ok` 全量记录、probe `deletedGroups === 0`——manifest read/gate 与 retention sweep 尝试并存零丢失（AC5「该阶段与 sweep 并发」覆盖臂） |
| **A7 统一释放矩阵（结构 pin）** | 旧实现空洞绿 / 漏 finally 新实现红 | 逐早退形态：manifest 缺失（rm）/ JSON 损坏（写坏字节）/ gate 失败（篡改 manifest 字段→corrupt 臂；指纹篡改→incompatible 臂）/ enumerationFailed（rm segments/）；每次 readStreamStrict（自建臂）返回后立即 `sweepRetention({now:T})` → 断言 `deletedGroups === N ∧ leaseBlockedGroups === 0`（注册表零残留 = finally 已释放）。afterEach 兜底 close 维持 |

### 8.2 `file-adapter-retention-lease-gate.test.ts` 增量

| 用例 | 档案（vs `31ff694`） | 构造与断言 |
|---|---|---|
| **B4a 到期放行（owner 点名场景）** | 主臂旧实现**空洞绿**（无 S0′ 钟读→钩子不触发→无租约→照常删除）；与 B4b 合并构成红差分 | 流 1 闭组 aged、无 orphan（P0 零钟调用）；适配器注入 fake clock（**构造后计数清零**——规避 :1517 构造期 sweep 的钟读与误删，或 `sweepOnOpen:false` + utimes 回写 mtime aged，沿既有 retention 测试手法）；`a.log.sweepRetention({now: T0})`；fake 首个钟调用（= P1 S0′ 提交时刻位）回调内：注册 `probe = openDiagnosticReadSession({..., ttlMs: 5, clock: {now: () => T_REG}})`（独立静态钟防重入；T_REG > T0）后返回 `T2 ≥ T_REG + 5`（租约 sweep 开始后注册、S1 rename 前到期）。断言：`deletedGroups === 1 ∧ leaseBlockedGroups === 0` ∧ jsonl/bin 消失 ∧ `probe.closed === false`（放行源于**到期**而非关闭——INV-4 字面证据）。旧实现：S0′ 用 now=T0 → 租约判活跃 → 阻塞 → 与 B4b 一起翻红 |
| **B4b 活跃阻塞 control（红臂）** | **红**（旧实现无钟读→钩子不触发→无租约→删除发生） | 同 B4a 但返回 `T2' ∈ [T_REG, T_REG+5)`（提交时刻仍活跃）→ 断言 `deletedGroups === 0 ∧ leaseBlockedGroups ≥ 1` ∧ 文件在。旧实现：删除照常发生 → 断言必红。B4a+B4b 合并证明：提交门读取的是**提交时刻**的租约状态（旧实现两臂皆翻——阻塞判定与 sweep 起始时刻解耦） |
| **B5 P0 提交门（仅 G-227-5 采含）** | control 臂红（同 B4b 机制） | 孤儿 BIN（bin 无 jsonl/marker、非开组）流；fake 首个钟调用改挂 P0 门位（P0 先于 P1——钩子位与 B4 不同，测试内注释锚定）注册「届时已到期」租约 → `orphanBinsDeleted === 1 ∧ leaseBlockedGroups === 0`；control 臂（活跃）→ `leaseBlockedGroups ≥ 1 ∧ orphanBinsDeleted === 0` |

### 8.3 既有测试处置（增量处置表；R1.1 §8.5 全部继续有效）

| 既有面 | R2 影响 | 处置 |
|---|---|---|
| A2 步进钟（strict-reader-lease.test.ts:142–175，传入臂） | 零——取得检查点仅自建臂，传入臂钟调用序列不变 | 保留零改动 |
| A4a/b/c 防御门 + enumerationFailed 包络 | 零——①′/④′ 反应位置不动，包络逐字节等同 | 保留零改动 |
| A5 无泄漏 / **T-C1/C2/C5..C8**/T-B6 / B2/B3 | 零——finally 幂等替换分散站点；恒定钟构造下初查/S0′ 两时刻结论一致（T-C5 推进钟但零 sweep——§2 兼容论证） | 保留零改动 |
| **T-C3/T-C4（file-adapter-read-session.test.ts:133–150/:152–172）【R2.1/F-1】** | **必翻红**——双钟构造（适配器恒 T0 × 会话推进钟）在 D11/INV-227-12 下「正确阻塞」（§2 性质裁定）；**非语义回归** | **夹具钟源对齐（SA6）**：`makeWriter(root, ns, { clock })` 直传同一 `newClock(T0)` 对象——适配器提交时刻与会话钟**同源推进**，新旧两实现下均绿（旧：初查/S0′ 同用入参 now；新：S0′ 读同一共享钟，`T0+1000 > T0+1001` 不成立 → 判过期放行）。**断言语义零变化**：T-C3 仍钉 `deletedGroups===2 ∧ leaseBlockedGroups===0`（过期放行）；T-C4 仍钉 `deletedGroups===2 ∧ renew()===true ∧ leasedUntil===T0+3000 ∧ closed===false ∧ segments 快照不变`（过期重租）。处置依据 = R1.1 §0.2 `test/**` SA6 白名单（继续有效）+「改实现不改测试**断言**」纪律（仅夹具钟源对齐，断言与被测行为逐字不动）；**与 §8.2 B4 同一 change 落地**（防 D11 合入后的中间提交必红）；构造期零风险（`buildThreeGroups` 用 `sweepOnOpen:false`，且构造先于钟推进，`clock.t` 仍 T0） |
| C/D 系（materialize/replay） | 零——本轮不触碰分类/replay | 保留零改动 |

测试卫生：fake 钟 fire-once 守卫 + 重入返回现值（A6a probe sweep 于初查即阻、零额外钟调用——亲证无递归）；所有 aged 构造须规避构造期 sweep 误删（`sweepOnOpen:false` 或构造后 utimes）；外部 session 用例 afterEach close 纪律沿用。**R2.1 注**：T-C3/T-C4 共享钟构造于新旧实现**均绿**（构造对齐，非红/绿差分）——红基线证据仍以 A6a/B4b 为准（N-b；SA6 无需在 `31ff694` 上为 T-C3/T-C4 留预红证据，仅需与 B4 同 change 落地对齐版）。

---

## 9. 验证命令（SA3/SA4/SA7 与总控亲跑面——与 R1.1 §9 同集）

```bash
pnpm typecheck
pnpm test    # vitest run --typecheck, maxWorkers 1

# 定向（红→绿最小环 + 零回退并跑）
NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run \
  packages/namespace-diagnostic-log/test/strict-reader-lease.test.ts \
  packages/namespace-diagnostic-log/test/file-adapter-retention-lease-gate.test.ts \
  packages/namespace-diagnostic-log/test/strict-reader-materialize-unknown.test.ts \
  packages/namespace-diagnostic-log/test/file-adapter-read-session.test.ts
NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run apps/yjs-server/test/diagnostic-replay
NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/namespace-diagnostic-log
```

完成定义：`pnpm typecheck && pnpm test` exit 0；`git diff` 不含 §0.3 DENY 路径；A6a/B4b 在 `31ff694` 上预红（SA6 落地时留红基线证据）、SA3 后全绿；**T-C3/T-C4 对齐夹具（SA6 与 B4 同 change）在 SA3 前后均绿（§8.3 R2.1 注——构造对齐非预红面）**。

---

## 10. 风险与残余

| # | 风险 | 处置 |
|---|---|---|
| R2-R1 | 钩子型测试依赖钟调用**位次**（call#2 = 取得检查点 / sweep 首钟读 = S0′）——未来插入钟读取会错位 | 测试内注释锚定位次来源；断言本身（包络/报告/盘面）错位即红，不会静默漂移；SA4 复审核对 §3.1.2 时序表 |
| R2-R2 | 自建臂 open 在 manifest 缺失流上多付一次 segments/ readdir（枚举失败→空快照→立即 finally） | 可忽略（一次 readdir）；包络不变 |
| R2-R3 | replay locator 阶段无租约（备案） | §0.3/§6 论证：非 stream manifest、诚实降级、无静默丢失 |
| R2-R4 | 初查/年龄门维持策略时刻 → sweep 起始活跃、门后到期的租约本轮止步一次 | 自愈下一轮；owner 只命门 S0′；备案 |
| R2-R5 | G-227-5 类推扩权（P0 门）可能被判越权 | 明示默认+可退回；退回登记 R2-R4b |
| R2-R6 | `now` 语义收窄（策略时刻）与既有调用方约定 | JSDoc + AGENTS.md 同步；公共形状零变更；既有测试兼容亲证（§2） |
| R2-R7【R2.1】 | D11 合入后 T-C3/T-C4 若未同步对齐必红，且易被误诊为 D11 实现回归（错误修法：回退提交时刻取时 / `Math.max(now, clock.now())` 折衷——后者违 INV-227-12 与 owner「不复用 sweep 起始时间」字面） | §8.3 处置行强制**与 B4 同一 change** 落地对齐夹具（新旧实现均绿）；§2 性质裁定明示「正确阻塞，非语义回归」与禁用修法；SA4/SA7 复核时核对 §8.3 R2.1 注 |

---

## 11. 提请 SA8/SA2 的裁决点

- **G-227-5**：P0 orphan-BIN unlink 门是否随 D11 一并改提交时刻取时（默认**采含**——同类提交点一行同机制；可单点退回 + R2-R4b 备案）。
- **G-227-6**：`StrictReadRequest.clock?` 命名与形状（默认 `{ now(): number }` 平铺可选字段，与 replay/read-session 先例同构；备选嵌套 `readSession?:`——不建议，自建臂无 ttl/maxLifetime 供参需求）。
- D8/D9/D10/D11 本体无开放分歧（owner 逐字命门）。
- **F-1（R2.1 已兑现，闭环）**：SA8 R2 唯一必修项由本轮 §2（T-C3/T-C4 段 + N-a 勘误）/§8.3（处置行 + R2.1 注）/§0.2（白名单行）兑现——无新裁决点；N-b 随 §12 第 2 步兑现。

---

## 12. 下阶段 SA 路由（总控派发建议）

1. **SA8（conflict-gate，设计轮）——已完成，R2.1 免重开**：R2 门禁结论 = reject（窄修型）——ADR 冲突面 **clear**（C1–C10 逐项：L289/L297 兑现型、L291–295/L301–318 零触碰、零 ADR amendment）、owner 两条必修项承接正确；唯一驳回事由 F-1 已由 R2.1 兑现（§11）。SA8 裁定 R2.1 **无需重开设计轮冲突门禁**（`requiresConflictRecheck: false`——修订仅触及测试处置文本与夹具对齐，不新增语义面/码面/事件成员/ADR 面）；实施轮门禁（第 6 步）仍按计划在新提交态重开。
2. **SA2（design-review，窄域）——R2.1 从本步径入**：只审 R2/R2.1 修订日志所列增量（§3.1/§3.2/§3.3/§6/§8/§11 裁决点 + **R2.1 §2 T-C3/T-C4 段与 §8.3 处置行**）；R1.1 已审面零漂移核查。产出 K-binding（预期含：A6a/B4b 红基线必须在 `31ff694` 留证；finally 唯一性入 SA4 清单；**T-C3/T-C4 夹具对齐处置行入 K-binding——与 B4 同 change、断言语义零变化、非预红面（红基线仍以 A6a/B4b 为准——N-b）**）。
3. **SA6（acceptance-contract）**：按 §8 写红——A6a/B4b（+B5 若采含）须在 `31ff694` 上预红并留红基线证据（同轮次 §3.3 先例）；A6b（红→绿）/A7（结构 pin）按 §8 档案标注；**T-C3/T-C4 夹具钟源对齐（§8.3 行）与 B4 同一 change 落地（断言零改动）**；只动 `test/**`。
4. **SA3（implementation）**：按 §7 清单实现（顺序：reader.ts 取得点/finally → file.ts S0′/P0 → AGENTS.md；replay/read-session/index 零改动）；跑 §9 定向红→绿。
5. **SA4（implementation-review）**：对照 INV-227-1（改写版）/3（修订版）/11/12 + §3.1.2 时序表静态核验；DENY zero-diff 亲证。
6. **SA8（conflict-gate，实施轮）**：新提交态重开实施冲突门禁（沿本轮 `31ff694` 先例）。
7. **SA7（final-verification）**：§9 全量 `pnpm typecheck && pnpm test` 亲跑 + 定向复跑；V-1 版本 bump（0.1.6→0.1.7 / 0.1.3→0.1.4）建议继续移交总控/release 流程裁量（repo CI 立法：非 PR 门禁）。
8. **总控**：finalize 前重读 Issue #227/PR #251 全部评论核销 owner 两条；补记 `task_issue-227_dispatch.md`（SA4 R2 已登记派发日志稀疏）；本轮设计文件随实现提交入库。

---

## 13. ADR 与契约兼容性摘要（复审速查）

| 契约 | R2 影响 | 定性 |
|---|---|---|
| ADR-0012-LOG **L289**「只删除已关闭且没有 reader lease 的 segment group」 | 提交门以提交时刻评估「没有 lease」——INV-4（过期永不阻塞）在提交点字面复位 | 兑现型（诚实化读法，无 amendment） |
| ADR-0012-LOG **L297**「reader 通过 openReadSession() 获得短期 segment lease…或显式续租」 | 持约范围明确覆盖 manifest 读取/校验阶段（AC1「读取、校验…期间」的完整兑现） | 兑现型收紧 |
| ADR-0012-LOG **L301–318**（strict/replay 行为与报告形状冻结） | ②③ 门语义、各早退包络、complete 门逐字节不动；快照时机前移零漂移论证（§3.1.1） | 零触碰 |
| ADR-0012-LOG **L291–295**（删除协议 S1–S3/orphan 清理文法） | `deleteGroup` 本体零 hunk；S0′ 仍是 S1 前置门，仅取时来源变更 | 零触碰 |
| ADR-0011（重放五条件） | 本轮不触碰分类/complete 面 | 无涉 |
| 包 AGENTS.md #227 增量段 / 词表 / 事件白名单 | 追加 R2 句；零新码、零事件成员、零 reason | 文档义务（随 SA3） |
| INV-9/12/13、单进程注册表、`now 可注入` JSDoc | 注册表零改动；now 收窄为策略时刻（形状不变） | 维持 |
