# 设计 ADR 冲突复审（conflict recheck）— Issue #227 design R2（租约取得点前移 / 统一 finally / S0′ 提交时刻）

- 被审对象：`wiki/raw/task_issue-227_rev2_design.md`（SA1 **R2**，297 行全文——owner PR #251 评审两条必修项的窄修设计）
- 触发事由：R2 修订设计提请 SA8 设计轮冲突门禁（R2 §12 路由第 1 步）
- 冲突基准：`docs/adr/0012-vfsl-validated-jsonl-and-framed-sidecar-change-log.md`（ADR-0012-LOG）、
  `docs/adr/0011-best-effort-namespace-diagnostic-change-log.md`（ADR-0011）、
  `packages/namespace-diagnostic-log/AGENTS.md`（含 #227 增量段）、`apps/yjs-server/AGENTS.md`、
  根 `CONTEXT.md`、`docs/AGENTS.md`（文档同步纪律）；R1.1 摘录基线 `task_issue-227_relevant_decisions.md`
- 复审方式：**全部独立重验**——
  - 两 ADR 关键条款亲读（ADR-0012-LOG L280–318、ADR-0011 L90–110）；
  - R2 引用的全部源码锚点逐处亲读比对：reader.ts ①′(:411–440)/①(:441–453)/②(:456–499)/③(:501–542)/
    ④′(:546–604，自建臂 :569–576、enumerationFailed close :590–592)/⑤ 检查点(:659–662)/vanished(:674–700)/
    ⑦ close(:838–841)/⑧ catch(:865–882，close :868–871)、read-session.ts 全文（openAt :215 先于注册 :235–247、
    `renewIfDue` 无条件先读钟 :157、close 幂等 :162–166、`segmentLeased` 惰性过期 :252–256）、
    file.ts（clock 闭包 :309、`deleteGroupIfUnleased` :1093–1103（now 参 :1099/:1101）、P0 门 :1173–1176、
    P1 初查 :1258/S0′ :1266–1273（now :1272）、P2 初查 :1325/S0′ :1334–1341（now :1340）、
    `hygieneStream` :1126–1131/调用 :1240、`sweepNow` :1224、构造期 sweep :1517、`sweepRetention` :1527–1532、
    JSDoc :125）、diagnostic-replay.ts（clock :63、locator :95–98、session open :129–136 先于
    readStreamStrict :139、finally :304–308）、`StrictReadRequest` 现形状（:38–49，**无 clock 字段**）；
  - **owner PR #251 评审评论原文逐字核得**（`gh api issues/227/comments`，welltop-jim-wang，2026-09-06T13:14:31Z）——
    两条必修项与 R2 §0.1 G6/G7/G8 的转述逐句一致；
  - 既有测试兼容面亲读：`file-adapter-retention-lease-gate.test.ts` 全文、`file-adapter-read-session.test.ts` 全文
    （T-C1..C8/T-B6）、`strict-reader-lease.test.ts` 全文（A1–A5）、`file-adapter-namespace-deletion.test.ts`
    T-D9、`diagnostic-replay-lease-completeness-red.test.ts` stepClock 用例、`helpers/file.ts`、
    `groupAgeExpired`（:1041–1063，走 record observedAt 非 mtime）；
  - `git rev-parse HEAD` = **`31ff694`** 亲证 = R2 声明的被修订基线。
- 时间：2026-09-06（conflict-gate 设计轮，R2）

## Verdict

**reject（窄修型）** —— `requiresConflictRecheck: false`

- **ADR 冲突面：clear**。D8/D9/D10/D11 全部为兑现型/加性收紧，零 ADR amendment 需求、零冻结面触碰
  （逐项见 §3）。**owner 两条必修项均被设计正确、完整地承接**（逐条裁决见 §2）。
- **驳回理由（唯一必修项 F-1，见 §4）**：R2 §2/§8.3 的「既有测试零回退」兼容声明**失实**——
  `file-adapter-read-session.test.ts` **T-C3（:133–150）/T-C4（:152–172）在 D11 落地后必翻红**，而 §8.3
  处置表声明「T-C1..C8/T-B6 保留零改动」。按 R2 §9 完成定义（`pnpm test` exit 0）该设计**自相矛盾**：
  SA6 依 §8 写红、SA3 依 §7 实现后，套件必在 T-C3/T-C4 红，且 §8.3 的错误处置表会误导 SA4/SA7 把该红
  误诊为实现回归。属 R1→R1.1 同型的单一实质发现窄修（SA2 R0 reject（窄修型）先例），修订量约一段
  设计文本 + 一行处置表——不触及 D8–D11 架构。

## 1. 触发面与基线核验

| 项 | 独立核验事实 | 结论 |
|---|---|---|
| 基线 | HEAD = `31ff694`「fix(diagnostics): lease strict replay and fail closed」（PR #251 唯一提交）| ✅ 与 R2 声明一致 |
| G6（manifest 阶段无租约）| `readStreamStrict` 首次磁盘触达 = ② `readFileSync(manifest)`（:459）；自建臂 session 在 ④′（:570–575）才 open——②③ 全程无租约；传入臂（replay）session（:129–136）先于 readStreamStrict（:139）天然合规 | ✅ 缺口真实，且仅自建臂 |
| G7（释放非统一 finally）| 自建臂 close 分散三处：④′ enumerationFailed（:591–592）、⑦（:838–841）、⑧（:868–871），无函数级 finally；G6 修复后 ②③ 早退（:460–470/:472–486/:487–498/:503–513/:516–527/:531–541）全部成为持约早退 | ✅ 缺口真实 |
| G8（S0′ 复查时刻回溯）| `deleteGroupIfUnleased`（:1093–1103）以 `now` 入参直传 `segmentLeased`（:1101）；P1/P2 传入 sweep 起始 `now`（:1272/:1340 ← `sweepRetention(options?.now ?? clock.now())` :1529）；`segmentLeased` 惰性过期（:255 `entry.leasedUntil > now`）——判定结果由查询时刻决定 | ✅ 缺口真实；INV-4「过期租约永不阻塞」（read-session.ts:12 头注）在提交点字面违约 |

## 2. Owner 两条必修项的逐条裁决（本轮强制裁决面）

### O-1：strict reader 取得点 / 统一 finally / manifest 阶段并发测试 — **设计正确承接（reject 非因本面）**

Owner 原文（PR #251 评论）→ 设计映射 → 独立核验：

| Owner 要求（原文） | 设计决策 | 独立核验 |
|---|---|---|
| 「在路径安全检查后、第一次 manifest I/O 前取得 session」 | D8：④″ 取得点 = ①（:441–453，零 fs）之后、②（:459 首次 readFileSync）之前（§3.1.1） | ✅ 时序位置正确：① 零 fs 亲证（纯文法检查）；② 确为全函数首次磁盘触达；传入臂纯绑定（lease 自调用前已存在）；自建臂 open 的「枚举→注册」同同步函数内原子（read-session.ts:209–247 无 yield） |
| 「使用统一 finally 确保自建 session 最终释放」（覆盖 manifest 缺失、JSON 损坏、gate 失败等早退） | D9：函数级唯一 `finally { ownedSession?.close() }`，删除三处分散站点（§3.2）；INV-227-11 | ✅ 覆盖清单逐点核实在 try 体内：② 缺失(:460–470)/JSON 损坏(:472–486)/非对象(:487–498)、③ schema-compile(:503–513)/**gate 失败(:516–527，corrupt+incompatible 双臂)**/policy(:531–541)、④′ 反应、⑤ break、⑦ 双返回、⑧ 异常逃逸——owner 点名的早退全部在内；close 幂等（:162–166）使统一后外部观测不变；传入臂不 close（生命周期归调用方，replay finally :304–308 责任方不变）✅ |
| 「补充测试，证明 manifest read/gate 期间 lease 已注册，并覆盖该阶段与 retention sweep 并发」 | D10 + A6a/A6b（§3.1.2/§8.1） | ✅ 可构造性亲证：注入钟调用序 call#1（open `openAt` :215，注册**前**——leasedUntil 依赖 openAt，顺序不可倒置）→ **call#2 = 取得检查点 `renewIfDue`（无条件先读钟，read-session.ts:157），落在注册后、② 前——owner 窗口的唯一天然钩子**；call#3+ = ⑤ 检查点(:659)。A6a 于 call#2 回调内跑 probe sweep：reader 会话已注册（until T0+15000）→ probe 以 now=T0 初查即阻（`leaseBlockedGroups ≥ 1 ∧ deletedGroups === 0` = **已注册的直接运行时证据**）；同回调内 rmSync(manifest) 后读取 `corrupt + manifest-invalid` ⇒ **钩子位置先于 ② manifest 读取的反证证明**。probe sweep 内部零 `request.clock` 钟读（sweep 全链消费入参 now；新实现的 S0′ 读适配器闭包钟，非 reader 注入钟）→ 无重入 ✅。红差分成立：`31ff694` 上自建臂不消费 `request.clock`（字段不存在，:38–49 亲证）→ fake 钟零调用 → 钩子不触发 → 断言必红（「缝的缺席即红」）✅。A6b（只跑 probe 不删 manifest → `ok` 全量 + probe 零删）覆盖「该阶段与 sweep 并发」并存臂 ✅。A7 释放矩阵对四类早退逐形态 sweep-after-read 断言注册表零残留 = finally 已释放的可观测 pin ✅ |
| 「长读取按冻结策略续租或诚实失败」（AC1 既有面，R2 不回退） | R1.1 D7 维持；取得检查点拒绝包络复用 reader 域 `lease-expired`（manifest:null 零进一步 IO） | ✅ 词表零增量（§5）亲证；缺省 15s/margin 1s 下检查点为快路径真值，生产行为零变化 |

**O-1 裁决：D8/D9/D10 与 owner 要求逐句对应、锚点全部属实、测试契约可构造且红/绿档案诚实（A6a 红差分、A7 结构 pin）。**

### O-2：S0′ 提交时刻取时 / sweep 后 rename 前到期放行测试 — **设计正确承接（reject 非因本面）**

| Owner 要求（原文） | 设计决策 | 独立核验 |
|---|---|---|
| 「S0′ 复查时读取真正提交时刻的当前时间，不复用 sweep 起始时间」 | D11：`deleteGroupIfUnleased` 弃 `now` 参，复查改 `clock.now()`（适配器闭包钟 :309）；P1/P2 调用点弃实参；INV-227-12（策略面=入参 now，提交门=提交时刻现值） | ✅ 语义分工与 ADR L289「没有 reader lease」的提交时刻诚实读法一致；初查/年龄/字节维持策略时刻（owner 只命门 S0′——file.ts:1090–1108/1253–1261/1331–1339 即 `deleteGroupIfUnleased`+P1/P2 调用点，P0 门 :1173 不在点名内）；`deleteGroup` 本体（S1–S3）零 hunk ✅ |
| 「如需测试确定性，注入 clock」 | 注入面 = 既有 `config.clock`（:309）+ reader 侧新增 `StrictReadRequest.clock?` | ✅ 零新公共 API：`sweepRetention(options?: {now?: number})` 形状不变（:126/:1527），JSDoc 语义收窄为「策略时刻」（§7 文档义务已列）；`StrictReadRequest.clock?` 为加性可选字段，先例同构（read-session.ts:34、diagnostic-replay.ts:63）✅ |
| 「增加测试：租约在 sweep 开始后、S1 rename 前到期时，应允许删除」 | B4a 主臂 + B4b control（§8.2） | ✅ 可构造性亲证：注入 fake 适配器钟（构造后计数清零规避 :1517 构造期 sweep，或 sweepOnOpen:false——既有手法）；`sweepRetention({now: T0})` 后**首个钟调用即新实现的 S0′ 提交时刻位**（P0 无 orphan 零触门：门在 orphan 过滤器之后，:1170 continue 先行——亲证；初查/年龄/字节消费入参 now 零钟读——亲证）；回调内注册 probe（ttl 5，静态钟 T_REG > T0）后返回 T2 ≥ T_REG+5 → 提交时刻判过期 → `deletedGroups === 1 ∧ leaseBlockedGroups === 0 ∧ probe.closed === false`（放行源于到期而非关闭——INV-4 字面证据）✅。B4b control 返回 T2′ ∈ [T_REG, T_REG+5) → 活跃阻塞 → 反向钉死「提交门读的是提交时刻」✅。红档案诚实：B4b 在 `31ff694` 必红（旧实现无钟读 → 无租约 → 删除照常）；B4a 主臂旧实现空洞绿——设计如实标注，与 B4b 合并构成红差分 ✅ |

**O-2 裁决：D11 与 owner 要求逐句对应、注入面已存在、B4a/B4b 构造成立且 control 臂红基线真实。**

## 3. ADR/契约逐项（R2 增量面）——均无冲突

| # | 条款 | 与 R2 的关系 | 裁决 |
|---|---|---|---|
| C1 | ADR-0012-LOG **L289**「retention 只删除已关闭且没有 reader lease 的 segment group」 | D11 把「没有 lease」的评估时刻从 sweep 起始（陈旧快照）校正为提交时刻现值——兑现型诚实化；INV-4（过期永不阻塞，read-session.ts:12）在提交点字面复位。D8/D9 把持约范围扩至 manifest 阶段，同句「reader lease」保护面的完整兑现 | ✅ 兑现型 |
| C2 | ADR-0012-LOG **L297**「reader 通过 `openReadSession()` 获得短期 segment lease…长期 reader 必须有最大 lease 时长**或**显式续租」 | 取得点位置非 ADR 冻结面；缺省 maxLifetimeMs=null 显式续租臂维持（R1.1 C2 先例） | ✅ 兑现型收紧 |
| C3 | ADR-0012-LOG **L291–295**（删除协议 S1–S3 / orphan 清理文法） | `deleteGroup` 本体零 hunk；S0′ 仍是 S1 前置门，仅取时来源变更；`.deleting` 文法/枚举剔除不动 | ✅ 零触碰 |
| C4 | ADR-0012-LOG **L301–318**（strict reader 行为 / replay 报告形状冻结） | ②③ 门语义与各早退包络逐字节不动（早退 return 原文保留，仅外层加 try/finally）；快照时机前移零漂移论证成立（同一 `enumerateSegmentGroups` 同源输出、同步单线程两次取值间无写者）；分类/complete/报告形状/replay 零涉及；取得检查点拒绝包络复用既有码 | ✅ 零触碰 |
| C5 | ADR-0011 L97–105（重放五条件） | R2 不触碰分类/complete 面 | ✅ 无涉 |
| C6 | 包 AGENTS.md：#227 增量段 / 词表 / 事件白名单 / 环境绑定面 | R2 追加一句（取得点/统一 finally/提交时刻 + now 分工）已列 §0.2/§7；零新码、零事件成员、零 reason（§5——A6/A7/B4/B5 全部复用既有码与既有报告计数，亲证）；reader/file 的 node:fs 绑定面不变；read-session/retention/index 零改动 | ✅ 文档义务随 SA3 |
| C7 | 包 AGENTS.md「契约测试 SA6 owned——改实现不改测试断言」 | T-C3/T-C4 的必要处置（见 F-1）是**测试构造对齐**（双钟合并推进），断言语义（过期放行/过期重租）不变——与 SA7 重点 4 改写同型的合法演进路径（SA6 同 change 落地）；R1.1 §0.2 的 `test/**` SA6 白名单继续有效（R2 §0.2 明示「其余行继续有效」） | ✅ 纪律可满足（需 F-1 修订后明示） |
| C8 | docs/AGENTS.md「code behavior 变更须同步每一份成文契约文档」 | CONTEXT.md 亲查：无 #227 租约/取得点成文面（「租约」命中均为 namespace-runtime 空闲保留，无涉）——R2 文档同步义务仅包 AGENTS.md 一处，§0.2 列载正确 | ✅ 无漏面 |
| C9 | INV-9/12/13、单进程注册表、T-A7 锚点 | 注册表零改动；namespace 删除压过租约不动；`.deleting` 文法零新增枚举；构造期 sweep（:1517）仍以注入钟为策略 now——T-A7 对策略面继续成立 | ✅ 维持 |
| C10 | G-227-5（P0 门随 D11 一并改提交时刻——默认采含） | L289 统辖全部删除面（R1.1 C3 解释性裁定先例）；P0 unlink 是同类提交点；默认采含统一 INV-227-12，退回路径（R2-R4b）亦合规——owner 点名范围外的明示扩权，已交 SA2 裁决（§11），两向均无 ADR 冲突 | ✅ 无冲突（裁决点移交 SA2） |

## 4. F-1【必修，驳回本体】T-C3/T-C4 兼容声明失实——D11 落地后两既有 pin 必翻红

**事实链（本轮逐环亲验）：**

1. `file-adapter-read-session.test.ts` 的 `makeWriter`（:62–72）给**适配器**注入恒定钟 `clock: { now: () => T0 }`（:69）；
2. **T-C3**（:133–150）：会话钟 `newClock(T0)` 可推进，ttl=1000 → `leasedUntil = T0+1000`；`clock.t = T0+1001` 后调
   `a.log.sweepRetention({ now: clock.t })`，断言 `deletedGroups === 2 ∧ leaseBlockedGroups === 0`（过期放行）；
3. **T-C4**（:152–172）：同构造，`clock.t = T0+2000`，断言 `report.deletedGroups === 2`（过期后 sweep 照删 → renew 重租）；
4. 现行代码下初查（:1258/:1325）与 S0′（:1101）同用入参 `now = T0+1001/T0+2000` → 租约判过期 → 放行 → 两 pin 绿
   （owner 评论「494 个测试全部通过」与此一致）；
5. **D11 后**：S0′ 改读适配器闭包钟（§3.3「`clock.now()`（适配器闭包钟，:309）」）= 恒 T0 →
   `segmentLeased(…, T0)`：`T0+1000 > T0` → **判活跃** → `'lease-blocked'` → 前缀止步 →
   T-C3 得 `deletedGroups=0, leaseBlockedGroups≥1`（双断言翻红）、T-C4 得 `deletedGroups=0`（断言翻红）；
6. 初查（用入参 now=T0+1001/T0+2000）判过期放行 → sweep **必然到达** S0′（年龄门走 record observedAt=T0 ≤ cutoff，
   `groupAgeExpired` :1041–1063 亲证；字节 >0）——无任何上游门可兜住；
7. 触发条件正是两钟（会话钟 vs 适配器钟）在新语义分工（INV-227-12：策略时刻 vs 提交时刻）下的合法漂移——
   该测试构造形成「按会话钟已过期、按提交钟仍活跃」的合法场景，新不变量下**正确地**阻塞——语义无错，错的 是
   R2 的兼容清单。

**R2 失实点：** §2「既有测试兼容面（亲读）… 结论不变零回退（§8.5）」只覆盖 B 系/T-C1/C2/C5..C8/T-B6
（会话钟恒 T0 → T0 处租约活跃 → 初查即阻，S0′ 不可达或结论一致——本轮逐例核实为真），**漏盘 T-C3/T-C4**；
§8.3 处置表「A5 无泄漏 / T-C1..C8/T-B6 / B2/B3 … 保留零改动」因此错误。

**后果：** SA6 依 §8 写红 → SA3 依 §7 实现 → `pnpm test` 必红于 T-C3/T-C4 → R2 §9 完成定义不可达；
且 §8.3 处置表会误导 SA4/SA7 将该红误诊为 D11 实现回归（错误修法：回退提交时刻取时或 `Math.max(now, clock.now())`
折衷——后者违背 INV-227-12 与 owner「不复用 sweep 起始时间」的字面）。

**R2.1 修订要求（SA1 窄修，不触 D8–D11 架构）：**

1. §2 兼容论证补 T-C3/T-C4 段：声明其双钟构造在 INV-227-12 下的行为翻转（性质=测试构造对齐，非语义回归）；
2. §8.3 处置表增行：`file-adapter-read-session.test.ts` T-C3/T-C4——构造改为共享推进钟
   （如 `makeWriter` 的 `clock` 直接传 `clock` 对象，使适配器提交时刻与会话钟同源推进），**断言语义零变化**
   （仍钉「过期放行/过期重租」）；处置依据 = R1.1 §0.2 `test/**` SA6 白名单（继续有效）+「改实现不改测试**断言**」
   纪律（断言不动，仅夹具钟源对齐）；同步 §8 注明 SA6 落地时与 B4 同 change；
3. （可选顺带）§2 括注数值勘误：B 系会话 ttl 实为 60_000（until T0+60_000），非缺省 15_000——结论不变（T0 处
   均活跃），纯精度修正。

## 5. 非阻断登记项（移交 SA2 窄域复审）

- **N-a【精度】** R2 §2「租约 until T0+15000 > T0」——B 系实际注入 ttl=60_000；结论（T0 处活跃）不受影响。
- **N-b【K-binding 建议】** SA2 窄域复审应把 F-1 修订后的 T-C3/T-C4 处置行纳入 K-binding（红基线证据仍以
  A6a/B4b 为准；T-C3/T-C4 属构造对齐，不要求在 `31ff694` 上预红）。
- **N-c【路由备注】** R2 §12 第 8 步自识的 dispatch 日志稀疏补记归总控（非设计缺陷，仅流程备注）。

## 6. 边界声明

- 本轮**零生产代码改动、零测试改动、零 git 操作**（HEAD 仍 `31ff694`，`git status` 仅既有 wiki 未跟踪/修改文件）；
  唯一写入 = 本文件。
- 未运行测试套件（被审对象为设计文档；owner 评论已载明 `31ff694` 全量 494 测试绿——与本轮静态推演互证）。
- 编号消歧：本文「ADR-0012-LOG」均指 `0012-vfsl-validated-jsonl-and-framed-sidecar-change-log.md`。

Verdict: **reject（窄修型）** — ADR 冲突面 clear、owner 两条必修项承接正确；唯一驳回事由 = F-1
（§2/§8.3 既有测试兼容声明失实，T-C3/T-C4 必翻红）。R2.1 窄修（§4 清单）后可径入 SA2 窄域复审，
无需重开冲突门禁（`requiresConflictRecheck: false`——修订仅触及测试处置文本，不新增语义面）。
