# SA2 窄域设计复审（R2.1）— Issue #227 rev2 design（F-1 窄修验收 + owner 两条必修项逐项验收）

- 被审对象：`wiki/raw/task_issue-227_rev2_design.md`（SA1 **R2.1**——SA8 R2 冲突门禁 reject（窄修型）唯一必修项 F-1 的窄修；D8–D11 架构零变更）
- 输入：任务简报 `wiki/raw/task_issue-227.md`；R1.1 设计 `wiki/raw/task_issue-227_design.md`；SA8 R2 冲突报告 `wiki/raw/task_issue-227_rev2_design_conflict_report.md`；ADR-0012-LOG L280–318、ADR-0011 L97–105、包 `AGENTS.md`（#227 增量段）
- 基线亲证：`git rev-parse HEAD` = **`31ff694`**（与 R2.1 声明的被修订基线一致；工作树仅 wiki 未跟踪/修改文件，src/test 零改动）
- 复审方式：**全部独立重验**——R2.1 引用的全部源码锚点逐处亲读（reader.ts / read-session.ts / file.ts / diagnostic-replay.ts）；三个测试文件全文亲读（`file-adapter-read-session.test.ts`、`file-adapter-retention-lease-gate.test.ts`、`strict-reader-lease.test.ts`）；**独立全仓扫描**所有 `sweepRetention` / `openDiagnosticReadSession` 测试调用点（含设计/SA8 均未逐例列出的 `file-adapter-retention*.test.ts` ×3 与 `apps/yjs-server/test/*` ×2——见 §4.3）；ADR-0012 关键条款原文亲读比对
- 边界：**零生产代码改动、零测试改动、零 git 操作**；唯一写入 = 本文件
- 时间：2026-09-06（design-review 窄域轮，R2.1）

## Verdict

**approve** —— R2.1 已完整兑现 SA8 F-1（§2 T-C3/T-C4 段 + §8.3 处置行 + §0.2 白名单行 + §12/N-b，四项修订要求逐项在文且内容正确）；D8/D9/D10/D11 对 owner 两条必修项（O-1/O-2）的承接逐句正确、锚点全部属实、测试契约可构造且红/绿档案诚实。**放行进入 SA6（acceptance-contract）**，按 §12 路由第 3 步执行，附加本文 §5 K-binding。

无阻断项。3 条非阻断登记（§6），2 个裁决点裁定（§5.3）。

---

## 1. Owner 必修项 (1) 逐项验收：strict reader 取得点前移 + 统一 finally + manifest 阶段并发测试

| Owner 要求 | 设计决策 | 独立核验（本轮亲读） | 裁决 |
|---|---|---|---|
| 在路径安全检查后、第一次 manifest I/O 前取得 session | D8 §3.1.1：④″ = ①（:441–453）之后、②（:459 首次 `readFileSync`）之前；传入臂纯绑定、自建臂 open | ① 亲证零 fs（纯文法 `isSafeNamespaceId/isSafeStreamId`）；② 亲证全函数首次磁盘触达（:456–499，`readFileSync` :459）；`streamLayoutPaths` :454 纯派生；传入臂（replay :129–136）session 先于 `readStreamStrict` :139 天然合规；open 内「枚举→openAt :215→注册 :235–241」同一同步函数无 yield（原子） | ✅ 时序位置正确 |
| 用统一 finally 覆盖 manifest 缺失 / JSON 损坏 / gate 失败等一切早退 | D9 §3.2：函数级唯一 `finally { ownedSession?.close() }`，删除三处分散站点；INV-227-11 | 三处分散站点亲证：④′ enumerationFailed（:591–592）、⑦（:838–841）、⑧（:868–871）；早退覆盖清单亲证全在 try 体内：② 缺失（:460–470）/JSON 损坏（:472–486）/非对象（:487–498）、③ schema-compile（:503–513）/**gate 失败 corrupt+incompatible 双臂（:516–527）**/policy（:531–541）、④′ 反应、⑤ break、⑦ 双返回、⑧ 异常逃逸；close 幂等（read-session.ts:162–166）→ 统一后外部观测不变；传入臂不 close（replay finally :304–308 责任方不变） | ✅ 覆盖完备 |
| 测试证明 manifest read/gate 期间 lease 已注册 | D10 §3.1.2：取得检查点 `renewIfDue` = 注册后、② 前唯一天然钟读位 | **位次论证独立复核成立**：call#1 = open `openAt`（:215，注册**前**——leasedUntil 依赖 openAt，顺序不可倒置）→ **call#2 = 检查点 `renewIfDue`（read-session.ts:157 无条件先读钟，margin 判定前）** → call#3+ = ⑤ 检查点（:659）。A6a 在 call#2 回调内跑 probe sweep：此时 reader 会话已注册（until T0+15_000，openAt=fake call#1=T0）→ probe 以 now=T0 初查（file.ts:1258）即阻 → `leaseBlockedGroups ≥ 1 ∧ deletedGroups === 0` = 已注册的直接运行时证据。**位置判别性亲证**：若钩子误挂 call#1（openAt，注册前）→ probe 不阻 → 断言红；若挂 call#3+（manifest 已读）→ rmSync 无从影响 ② → `corrupt+manifest-invalid` 断言红——A6a 精确钉死 [注册后, manifest I/O 前] 窗口 | ✅ 可构造且判别 |
| 覆盖该阶段与 retention sweep 并发 | A6b（只 probe 不删 manifest → 读取 ok 全量 + probe 零删） | 并存臂语义成立；probe sweep 全链消费入参 now（初查 :1258 即阻，S0′ 不可达），P0 门仅 orphan 候选触达（fixture 无 orphan）→ 零重入（reader fake 钟不被 probe 再入） | ✅ |

## 2. Owner 必修项 (2) 逐项验收：S0′ 提交时刻取时 + sweep 后 rename 前到期放行测试

| Owner 要求 | 设计决策 | 独立核验（本轮亲读） | 裁决 |
|---|---|---|---|
| S0′ 复查读取真正提交时刻，不复用 sweep 起始时间 | D11 §3.3：`deleteGroupIfUnleased` 弃 `now` 参、复查改 `clock.now()`（适配器闭包钟 :309）；P1（:1266–1273，now 实参 :1272）/P2（:1334–1341，:1340）弃实参；INV-227-12（策略面=入参 now / 提交门=提交时刻现值） | 现状回溯亲证：`deleteGroupIfUnleased`（:1093–1103）`now` 参（:1099）直传 `segmentLeased`（:1101）；`segmentLeased` 惰性过期（read-session.ts:255 `entry.leasedUntil > now`）——判定随查询时刻翻转，G8 机制根源属实；`sweepRetention(options?.now ?? clock.now())`（:1529）亲证；注入面 `config.clock`（:309）已存在，零新公共 API | ✅ 语义分工正确，ADR L289「没有 reader lease」的提交时刻诚实读法（兑现型，零 amendment） |
| 如需确定性注入 clock | 既有 `config.clock` + reader 侧新增 `StrictReadRequest.clock?`（加性可选，先例 read-session.ts:34 / diagnostic-replay.ts:63） | `StrictReadRequest` 现形状（:38–49）亲证无 clock 字段——加性演进成立；G-227-6 裁定见 §5.3 | ✅ |
| 测试证明 sweep 开始后、S1 rename 前到期 → 允许删除 | B4a 主臂 + B4b control（§8.2） | **可构造性独立复核**：注入 fake 适配器钟（`sweepOnOpen:false` 规避 :1517 构造期 sweep——既有手法）；`sweepRetention({now: T0})` 后**首个钟调用 = P1 S0′ 提交位**亲证成立（P0 门仅 orphan 候选、fixture 无 orphan；初查/年龄/字节均消费入参 now 零钟读）；回调内注册 probe（ttl 5，静态钟 T_REG）返回 T2 ≥ T_REG+5 → `T_REG+5 ≤ T2` → 判过期 → 删 → `deletedGroups===1 ∧ leaseBlockedGroups===0 ∧ probe.closed===false`（放行源于**到期**而非关闭——INV-4 字面证据）；B4b 返回 T2′∈[T_REG, T_REG+5) → 活跃阻塞（反向钉死提交时刻语义）。红档案诚实：B4b 旧实现必红（无钟读→无租约→照删）；B4a 主臂旧实现空洞绿（与 B4b 合并成红差分）——设计如实标注 | ✅ |

## 3. F-1 修订专项攻击（本轮核心裁决面）

### 3.1 事实链独立重验（全部成立）

1. `makeWriter`（:62–72）给适配器注入恒定钟 `{ now: () => T0 }`（:69）——亲证；
2. T-C3（:133–150）：会话钟 `newClock(T0)`（:57–60 可推进），ttl=1000 → `leasedUntil=T0+1000`（:145 断言钉死）；`clock.t = T0+1001`（:146）→ `sweepRetention({now: clock.t})`（:147）；断言 `deletedGroups===2`（:148）∧ `leaseBlockedGroups===0`（:149）——与 R2.1 §8.3 引文逐字一致；
3. T-C4（:152–172）：`clock.t = T0+2000`（:164）→ `deletedGroups===2`（:166）∧ `renew()===true`（:168）∧ `leasedUntil===T0+3000`（:169）∧ `closed===false`（:170）∧ segments 快照不变（:171）——逐字一致；
4. 翻转机制亲证：现行初查（:1258/:1325）与 S0′（:1101）同用入参 now=T0+1001/T0+2000 → 过期 → 放行 → 两 pin 绿；**D11 后 S0′ 读适配器闭包钟（恒 T0）→ `T0+1000 > T0` → 判活跃 → `'lease-blocked'` 前缀止步 → T-C3 双断言翻红、T-C4 `deletedGroups===0` 翻红**；
5. 无上游门兜住亲证：初查（入参 now）判过期放行；年龄门 `groupAgeExpired`（:1041–1063）走 record observedAt=T0 ≤ cutoff（retention maxAgeMs:0，buildThreeGroups :82）→ 过期；字节 100B sidecar > 0 → sweep 必然到达 S0′——R2「保留零改动」声明失实，SA8 F-1 驳回正当。

### 3.2 R2.1 修订兑现核查（四项全在、内容正确）

| SA8 F-1 修订要求（冲突报告 §4 清单） | R2.1 落点 | 核验 |
|---|---|---|
| 1. §2 补 T-C3/T-C4 段（性质=构造对齐，非语义回归） | §2 末段（T-C3/T-C4 逐例 + 性质裁定 + 禁用修法明示） | ✅ 在文，性质裁定正确（「按策略时刻已过期、按提交时刻仍活跃」在新不变量下**正确地**阻塞） |
| 2. §8.3 增处置行（共享推进钟、断言语义零变化、与 B4 同 change、白名单依据） | §8.3 T-C3/T-C4 行 + §0.2 白名单行（`file-adapter-read-session.test.ts` 仅夹具钟源对齐） | ✅ 在文；断言文本逐字钉死（见 §3.3 防伪绿） |
| 3.（顺带）N-a ttl 勘误（60_000 非缺省 15s） | §2 B 系括注（until T0+60_000，结论不变） | ✅ 亲证 `file-adapter-retention-lease-gate.test.ts` :95–96/:123–124/:159–160/:192–193 ttl=60_000 |
| N-b：K-binding 预期补处置行 | §12 第 2 步（构造对齐非预红面；红基线仍以 A6a/B4b 为准） | ✅ 在文 |

### 3.3 伪绿路径攻击矩阵（owner 特别关切——逐条排除）

| # | 伪绿路径 | 攻击结论 |
|---|---|---|
| P-1 | **放宽断言**（删 `leaseBlockedGroups===0`、`deletedGroups===2` 改 `≥0`、去 `leasedUntil` 钉值） | 被设计逐字钉死（§8.3「断言语义零变化」+ 断言原文引用）；本文 §5 K-binding 再钉**断言字节级不动**。且断言具**自钉性**：`leasedUntil===T0+1000`（T-C3 :145）/`===T0+3000`（T-C4 :169）在 openAt=T0、now=T0+1001/T0+2000 下反向钉死 ttl=1000——夹具 TTL 无法暗中放大 |
| P-2 | **延长 TTL**（ttl 1000→60_000 之类） | 数学上不可伪绿：lease 活跃于两时刻 → 新旧实现**均**阻塞 → `deletedGroups===0` → 红（比现状更红）；且被 P-1 自钉性拦截 |
| P-3 | **绕过 gate / 篡改 now**（`sweepRetention({now: T0})` 换掉 clock.t） | 不可伪绿：初查即判活跃（T0+1000 > T0）→ 阻塞 → 红 |
| P-4 | **锁步双钟**（两个独立 newClock 手动同步推进，语义等价但非「共享」） | 新旧实现均绿（可过测）但违 owner「共享推进 clock」字面与设计「直传**同一** `newClock(T0)` 对象」——**本文 §5 K-binding 显式钉 same-object（同一引用传 `openDiagnosticReadSession` 与 writer config 两处）**，SA4/SA7 复核点 |
| P-5 | **错误修法**（回退提交时刻取时 / `Math.max(now, clock.now())` 折衷） | 设计 §2/§10 R2-R7 明示禁止（违 INV-227-12 与 owner「不复用 sweep 起始时间」字面）——本文背书该禁令 |

**共享推进钟修法的双向绿灯算亲证**：旧实现初查/S0′ 同用入参 now（=共享钟 t=T0+1001/T0+2000）→ 过期放行 → `deletedGroups===2`；新实现 S0′ 读同一共享钟（t 未再动）→ 同值 → 过期放行 → 同断言；T-C4 `renew()` 读共享钟 now=T0+2000 → next=max(T0+2000, T0+1000)+1000=T0+3000 → 断言逐项成立。构造期零风险亲证：`buildThreeGroups` 用 `sweepOnOpen:false`（:82）且构造先于 `clock.t` 推进。**修法唯一正确，验收通过。**

### 3.4 独立全仓扫描（超出 SA8 盘点面的补强验证）

本轮独立枚举全仓全部 `sweepRetention`（10 文件 49 调用点）与 `openDiagnosticReadSession`（4 测试文件）组合，逐一判定 D11 翻转风险：

| 调用面 | 判定 |
|---|---|
| `file-adapter-retention.test.ts`（20 点）/`retention-deletion-windows`（4）/`retention-history`（2） | **零 openDiagnosticReadSession** → 注册表恒空 → S0′ 取时变更不可观测 → 零翻转 |
| `strict-reader-lease.test.ts` A5（:345/:360） | 自建臂 session 于读取返回时已 close（⑦/finally）→ sweep 时零残留 → 零翻转 |
| `file-adapter-retention-lease-gate.test.ts` B2/B3（5 点） | 会话恒定钟 T0 + ttl 60_000 → 初查（now=T0+1000）与 S0′（clock=T0）两时刻均活跃（T0+60_000 > 两值）→ 阻塞结论两实现一致 → 零翻转（R2.1 §2 论证亲证成立） |
| `apps/yjs-server/...-lease-completeness-red.test.ts` D2（:230） | replay 返回后（其 finally 已 close 内部 session）才 sweep → 零残留 → 零翻转 |
| `apps/yjs-server/...-host-lifecycle-red.test.ts` R4（:644） | sweep 先于 replay 调用、全程零会话 → 零翻转 |
| `file-adapter-namespace-deletion.test.ts` T-D9 | 会话经分区释放置 closed，无 sweep 交错 → 零翻转 |

**结论：T-C3/T-C4 是全仓唯一双钟翻转构造——F-1 的事实链与处置范围完备，无第二个漏盘面。**

## 4. 其余攻击点（审过且澄清，均不阻断）

1. **A6a 红差分机制**（31ff694 上「缝缺席即红」）：旧自建臂 open 不供钟（:571–575 无 clock 参）→ fake 钩子永不触发；SA6 可循 `withSession` 同款 cast 先例（strict-reader-lease.test.ts:82–85）使编译过、断言红——红档案成立。
2. **取得点前移的零漂移**：②/③ 早退在旧实现先于 session open、新实现后于 open+finally——返回包络逐字节等同（corrupt+manifest-invalid，manifest:null）；代价 = 早退路径多一次 segments/ readdir（R2-R2 已备案）。快照时机前移：同一 `enumerateSegmentGroups` 同源、同步单线程两次取值间无写者——论证成立。open 内部枚举先于注册不构成 TOCTOU（同一同步函数内无 yield——R1.1 §3.5 腿 1 维持）。
3. **取得检查点仅自建臂** → A2（传入臂步进钟 :142–175）钟调用序列零漂移（亲证 withSession 供参）；A4a/b/c 防御门位置不动（①′ 最前）——包络冻结成立。
4. **P0 门（G-227-5）触达条件**：门在 orphan 过滤器之后（jsonl 缺 ∧ marker 缺 ∧ bin 在才达 `segmentLeased`，file.ts:1165–1176）——B4a/A6a/T-C3/T-C4 夹具均无 orphan → 采含 G-227-5 不扰动这些用例的钟位次断言。
5. **T-A7 锚点**：构造期自动 sweep（:1517）`sweepNow(clock.now())` 仍以注入钟为策略 now——策略面语义维持；D11 只改提交门取时。
6. **⑦/⑧ close 站点删除 → finally**：return 前 finally 恒达（同步函数）；close 幂等——A5 无泄漏面零回退。
7. **INV-227-12 等价刻画**与 `segmentLeased` 严格 `>` 语义一致（`leasedUntil ≤ now` ⇒ 不阻塞）。
8. **§9 验证命令**四个定向测试文件均存在；完成定义（A6a/B4b 预红留证、T-C3/T-C4 对齐夹具新旧均绿）自洽。

## 5. 对下游的 K-binding 与裁决（随 approve 生效）

### 5.1 SA6（acceptance-contract）

- K-R2-1：A6a/B4b（+B5 若采含）须在 `31ff694` 上预红并留红基线证据；A6b（红→绿）/A7（结构 pin）按 §8 档案。
- K-R2-2：**T-C3/T-C4 夹具钟源对齐与 B4 同一 change 落地**；只动 `test/**`；其余用例零改动（`buildThreeGroups`/`makeWriter` 缺省恒定钟 `{now: () => T0}` 对其余调用方行为不变）。
- K-R2-3（本文新增，钉死 P-1/P-4）：T-C3/T-C4 断言**字节级不动**（含 `leasedUntil===T0+1000`/`===T0+3000` 自钉值）；钟源对齐 = **同一 `newClock(T0)` 对象引用**同时供 `openDiagnosticReadSession({clock})` 与 writer 构造 config（经 makeWriter/buildThreeGroups 直传）——禁止锁步双钟、禁止任何断言/TTL/now 值改写。
- K-R2-4：fake 钟 fire-once 守卫 + 重入返回现值；aged 构造规避构造期 sweep（`sweepOnOpen:false` 或 utimes 回写）。

### 5.2 SA4（implementation-review）

- INV-227-1（改写版）/3（修订版）/11/12 静态核验；§3.1.2 时序表（call#1/#2/#3 位次）核对；DENY zero-diff 亲证（replay/read-session/index/retention 零改动；`deleteGroup` 本体零 hunk）；**T-C3/T-C4 diff 逐行核对 = 仅钟源对齐**（K-R2-3）。

### 5.3 裁决点裁定（SA2）

- **G-227-5（P0 门随 D11 采含时）：裁定采含（默认方案）**。理由：P0 unlink 与 S1 rename 同为删除提交点，ADR L289 统辖全部删除面（R1.1 C3 解释性先例、SA8 C10 两向无冲突）；统一 INV-227-12 消除「P0 为何不同」的复审负担。退回路径（R2-R4b 备案）保留但本轮不启用。
- **G-227-6（`StrictReadRequest.clock?` 平铺可选形状）：裁定接受**——与 `DiagnosticReadSessionRequest.clock`（read-session.ts:34）、`DiagnosticReplayReadSessionOptions.clock`（diagnostic-replay.ts:63）先例同构；嵌套 `readSession?` 备选否决（自建臂无 ttl/maxLifetime 供参需求）。

## 6. 非阻断登记（移交 SA6/SA4 注意，不构成驳回）

- **N-1【实现注记】**：§8.3 修法措辞「`makeWriter(root, ns, { clock })`」——T-C3/T-C4 经 `buildThreeGroups` 构造（:81–88），SA6 落地需给 `buildThreeGroups` 增可选 clock 透传参或在该两用例内联 makeWriter；缺省分支必须保持恒定钟，其余用例零改动（K-R2-2 已覆盖）。纯夹具机械细节，非设计缺陷。
- **N-2【文档义务提醒】**：§0.2 的包 `AGENTS.md` R2 增量句（取得点/统一 finally/提交时刻 + now 分工）随 SA3 同 change 落地——SA4 核对项。
- **N-3【流程】**：`task_issue-227_dispatch.md` 稀疏补记（R2.1 N-c）归总控；finalize 前重读 Issue #227/PR #251 全部评论核销 owner 两条（§12 第 8 步）。

## 7. 边界声明

- 本轮零生产代码改动、零测试改动、零 git 操作（HEAD 仍 `31ff694`）；唯一写入 = 本文件。
- 未运行测试套件（被审对象为设计文档；owner 评论已载明 `31ff694` 全量 494 测试绿，与本轮静态推演互证；A6a/B4b 的预红由 SA6 落地时留证）。
- 编号消歧：ADR-0012-LOG = `docs/adr/0012-vfsl-validated-jsonl-and-framed-sidecar-change-log.md`。

**Verdict: approve** —— R2.1 兑现 F-1 且无伪绿路径存活；D8–D11 承接 owner O-1/O-2 逐句正确。按 §12 路由第 3 步派发 SA6（携带本文 §5 K-binding）。
