# SA2 攻击评审报告 — File diagnostic-log adapter（issue #152）

**Date**: 2026-08-28
**Verdict**: **reject**（1 × CRITICAL + 3 × MAJOR 需 SA1 修订设计后复审；已裁决项 G1–G6 与 J9 裁决本身不重审）

**被审对象**: `wiki/raw/task_diagnostic-log-file-adapter_design.md`（R1，739 行，含文末总控 §11 六项裁决与 J9 裁决）
**审查基准**: ADR 0012/0011 条款（经 `task_diagnostic-log-file-adapter_relevant_decisions.md`）> SA6 红灯契约（简报 §1–§5 + 五测试文件实体）> 设计选择性裁决。
**审查方法**: 全新视角；全部攻击点均经基线源码与运行时实证核验（非纸面推断），核验命令与结果见文末附录 A。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议修订 |
|---|--------|--------|---------|---------|
| 1 | **CRITICAL** | §4.1 binLength 失败重同步 | `binLength 重同步 = stat(bin).size ?? 0` 在 .bin 被目录占位（EISDIR）时把**目录的 st_size（实测 4096）**当作文件长度写入状态；恢复后新帧落盘于真实文件尾（0），JSONL 引用却写 4096 → 永久 corrupt，且直接击穿 SA6 已锚定红灯测试 ns-binfirst-1 | 重同步规则改为 `throwIfNoEntry:false` + `isFile()` 判定（非常规文件 ⇒ 0）；或放弃缓存、每次 sidecar append 前 fresh stat 取 offset；§13 补登 stat-目录行为假设 |
| 2 | **MAJOR** | §3.1 构造函数无 crash 包络 | `observedAtFrom(clock.now)`（manifest createdAt + genesis observedAt 两处）在注入 clock throw / 返回 NaN / epoch 超域时直接 throw——`createFileDiagnosticLog` 向 Host 抛错，违反 ADR 0012「初始化失败不影响 namespace create」；§4.1 的 append 有「整函数 try/catch」，构造面没有对称防线 | §3.1 增加构造级 catch-all：任何未预见异常 → failed/disabled 模式 + 恰一次既有事件（`pipeline-crashed{stage:'adapter'}`，零词表扩）+ 形状完备返回值（J6 纪律） |
| 3 | **MAJOR** | §7 reader 无 fs 错误包络 | 「纯同步函数，不抛」无实现面支撑：`readdir(segmentsDir)` ENOENT/EACCES、`readFileSync(jsonl)` EISDIR/EACCES、bin 读取 EISDIR 均未定义分支——reader 在最需要它的损坏状态下自己崩掉 | reader 全函数 try/catch + 显式定义三分支（segments 目录缺失/不可读、jsonl 读失败、bin 读失败）到 corrupt + 稳定码的映射，任何 fs 错误收敛为 corrupt/incompatible 之一，不抛 |
| 4 | **MAJOR** | §4.1/§8/§10-J9/§12 与文末 J9 裁决矛盾 | 总控 J9 裁决（新增 `{type:'stream-exhausted'}`、转换时刻恰发一次）未回写正文：§4.1 仍写「exhausted → 丢弃（静默）」、§8/§12 仍写「三成员」——SA3 按正文实现即违反已生效裁决 | 裁决回写四处（§4.1 分支、§8 第四成员、§10-J9/§12 计数、§9 测试映射）+ 精确定义「转换时刻」（assign 出 UINT64_MAX 的那次 append 完成后置位并发事件，后续静默） |
| 5 | MINOR | §7.1 ③ manifest 身份交叉缺失 | manifest.streamId/namespaceId 不与实参互核、schemaId 字段不与信封互核：stream A 目录改名为 stream B 且 records 为空 → 判 'ok'，身份误归因 | manifest 门增补身份互核（建议 stream 级 `stream-mismatch`）；schemaId 一致性并入 manifest-invalid 或 fingerprint 码，取值记 §11 |
| 6 | MINOR | §6.3 injectFinalRecordFile 语义分叉 | 设计只列「VFSL 门 → storage 门 → 落盘」，跳过 line 预算门；#148 `appendFinal` 经 `gateAndEnqueue` **含** line 预算（memory.ts:258-281），SA6 明示「复制 #148 injectFinalRecord 语义」；disabled 模式注入行为亦未声明 | 补「注入路径同过 line 预算门」或显式豁免+理由；补「mode ≠ ready → 静默丢弃」 |
| 7 | MINOR | §4.2 genesis 守卫跳过零可观察性 | Host 显式提供 `genesisUpdateBytes`（明确意图）后被守卫静默吞掉（empty/超 payloadCap → 无 genesis、无事件）；与 J9 同型（「Host 显式意图被静默吞」） | 走 J9 同款路径：提请总控裁决可观察性（联合成员追加或备案豁免 + README 判别法：读 JSONL 首行 recordKind） |
| 8 | MINOR | §7.1 ③ manifest 严格度未定义 | 「键结构残缺」未定义是否拒绝多余键/类型不符键：`inlineUpdateMaxBytes:"4096"`（字符串）或第 15 键 → 门全过 → 'ok' | 二选一裁决（恰 14 键 vs 必需键+类型核对）并记 §11 |
| 9 | MINOR | §2.3 current.json tmp 残留 | tmp 写失败/rename 失败后 `current.json.tmp` 可残留；失败分支无 best-effort 清理声明（layout 测试只锚健康路径） | 失败分支 ENOENT-容忍的 unlink，或在 §2.3 声明残留合法（#153 locator 恢复兼容） |
| 10 | INFO | 并发读写语义未声明 | 1 MiB 行的 `appendFileSync` 可能拆多个 write(2)，并发 reader 可见半行 → invalid-json 误判；ADR 无快照一致性要求 | README 声明 reader 面向静态 stream（writer 停写后使用），不承诺并发一致性 |

另录一条 API 工效学备注（不设severity）：`clock` 字段同时服务 manifest `createdAt` 与 genesis `observedAt`，但 §1.3 注释只写「仅 genesis observedAt 用」——与 §2.2（createdAt 同源）自相矛盾，SA1 修订时顺手对齐。

---

## CRITICAL / MAJOR 逐条论证

### #1（CRITICAL）binLength 重同步规则在 EISDIR 场景制造持久损坏

**设计原文**（§4.1 sidecar 分支）：

> `appendFileSync(binPath, frame)` 失败 → `storage-write-failed{stage:'bin', code:errno}` → 丢弃 → **`binLength 重同步 = stat(bin).size ?? 0（失败后状态未知）`**

**触发条件**（已被 SA6 红灯测试逐字锚定，`file-adapter-mismatch-interference.test.ts:160-199` ns-binfirst-1）：
1. inline 记录先行（JSONL 1 行，.bin 不存在）；
2. `mkdirSync(p.binPath)` 目录占位；
3. emit 4097B sidecar → bin append 抛 EISDIR → 进入失败分支执行重同步。此刻 binPath 是**目录**：实测 `statSync(dirPath).size === 4096` 且**不抛错**（附录 A-1），`?? 0` 只接得住 throw，接不住「成功返回目录尺寸」→ `binLength = 4096`；
4. 恢复 `rmdirSync(p.binPath)`；
5. 再 emit 4097B sidecar：`appendFileSync` 在新建文件的真实尾部（offset 0）落帧，而 JSONL 引用按 `binLength` 写 `frameOffset:"4096"`。

**影响**：
- **击穿自身红灯契约**：reader 对该 record 走 §7.4 规则 3（4096+25 ≤ binSize=4122 通过）→ 规则 5 magic 校验（bytes[4096..4099] 是 payload 垃圾区）→ `frame-magic-invalid` → status corrupt。测试 :195 `expect(read.status).toBe('ok')` 与 :198 `expect(rec.ok).toBe(true)` **必败**。§9 测试映射声称该测试由「binLength 重同步 + gap 合法」机制满足——机制本身不成立。
- **瞬态故障固化为永久损坏**：一次已恢复的 EISDIR 故障让此后**每一条** sidecar 记录都引用错误偏移，stream 永久 corrupt，违反 §4.1 自身声明的「写失败不推进状态」不变量的意图。
- **虚假恢复（虚假降级立法的镜像）**：把「失败后状态未知」静默猜测为一个数值（0 或目录尺寸）——与 ADR 0012 对 locator「损坏时不得按 wall clock 静默猜测」是同一反模式：未知状态被冒充成已知状态。

**修订要求**（SA1 必须改设计文本，二选一，推荐 b）：
- (a) 重同步规则改为文件感知：`const st = statSync(binPath, { throwIfNoEntry: false }); binLength = st !== undefined && st.isFile() ? st.size : 0`；
- (b) 更优：**彻底放弃 binLength 缓存**——每次 sidecar append 前 fresh stat（同款 `throwIfNoEntry:false` + `isFile()` 判定）取预计 offset。单进程单 writer（ADR 部署约束）内无 TOCTOU；还顺带获得对外部截断的自愈能力，并消除一条需要维护的内存-磁盘孪生状态（skill 维度「缓存与存储状态撕裂」的正解）。
- 同时在 §13 补登被依赖却缺失的运行时行为假设：「`statSync(目录)` 成功返回非零 st_size（目录条目尺寸）而非抛错/返回 0」——本条假设若早登记，此漏洞在设计期即暴露。

**红灯测试构想**：
- 现有 ns-binfirst-1 即是（恢复后第二帧引用必须等于真实落点）。补强三个变体：(i) 先成功写一帧（binLength=125）→ EISDIR 失败 → 恢复 → 再写：断言新帧 `frameOffset === "125"` 且 reader ok（覆盖「成功态 + 故障 + 恢复」而非只有空态）；(ii) 外部 `truncate(bin, 50)` 后再写 sidecar：断言 fresh-stat 语义下引用自愈（若采纳方案 b）；(iii) bin 为目录期间连发两条 sidecar，恢复后连发两条：断言全部四条路径上 reader 对已落盘两条全绿。

### #2（MAJOR）构造函数缺整体 crash 包络——注入 clock 可让 `createFileDiagnosticLog` 抛错

**触发条件**：`FileDiagnosticLogConfig.clock` 是公共配置面（SA6 契约字段）。`observedAtFrom(now)` 的 #148 冻结文档明示「epoch 超出 ISO 表示域时 throw」（emission.ts:99-106），且 `now()` 本身可抛（Host 侧 bug 或恶意注入）。设计在**构造期**两处调用它：§2.2 manifest `createdAt`、§4.2 genesis `observedAt`。`clock: { now: () => NaN }`（`new Date(NaN).toISOString()` 抛 RangeError）或 `{ now: () => { throw ... } }` → 异常从构造函数直接冒泡。同理，§3.1 ⑤ 中任何未列举 errno 形态的异常（resync stat 的非常规错误等）均无兜底。

**影响**：违反 ADR 0012 明文「初始化失败不影响 namespace create；独立健康 observer 上报 `LOG_STREAM_INIT_FAILED`」（docs/adr/0012:24）与 ADR 0011 隔离总纪律——日志模块把异常抛进 Host 的 namespace 生命周期，是本 ADR 体系最核心的红线。§4.1 给了 append 路径「整函数 try/catch → pipeline-crashed」，构造面没有对称防线；§3.1 模式表也没有「init 期未预见异常」行。这是错误处理「状态闭环」检查的直接缺口：失败态（disabled/failed）不是在所有失败路径上都能被写入。

**修订要求**：§3.1 增加构造级 catch-all：`createFileDiagnosticLog` 整体包 try/catch，任何未预见异常 → failed（或 disabled）模式 + **恰一次**既有事件（建议 `pipeline-crashed{stage:'adapter'}`——已在 #148 词表内，零扩词表）+ 返回 J6 形状完备对象；并在 §3.1 模式表补一行「init 期未预见异常 | failed | pipeline-crashed{stage:'adapter'} | 不保证零产物（mkdir 可能已发生）」。

**红灯测试构想**：`makeFileLog({ ..., clock: { now: () => { throw new Error('boom') } } })` → 断言：不抛、`log.streamId` 匹配文法、`typeof log.emitter.emit === 'function'`、events 恰一次 `pipeline-crashed`、`log.emitter.emit(baseEmission())` 不抛且零落盘。同款三连：`now: () => NaN`、`now: () => 8.64e15 + 1`（ISO 域外）。

### #3（MAJOR）reader 无 fs 错误包络——「不抛」承诺无实现面

**触发条件**（均为损坏注入的常规手段，且 mismatch 测试自己就造过 jsonl-为-目录的状态）：
- ④ `readdirSync(segmentsDir)`：manifest 在而 segments 目录被删（ENOENT）或无权限（EACCES）→ **未定义分支，直接 throw**；
- ⑤ `readFileSync(jsonl)`：EISDIR（`mkdirSync(jsonlPath)` 占位，mismatch 测试 :216-217 的同款状态若被 reader 读）/ EACCES → throw；
- §7.4 读 bin：`statSync/readFileSync(bin)` 遇目录占位（EISDIR）/ 权限 → throw（「bin 不存在 → frame-missing」只覆盖 ENOENT）。

**影响**：`readStreamStrict` 自称「纯同步函数，不抛」（§7.1 首行）却无包络支撑；作为**损坏诊断工具**，恰在 stream 处于损坏/异常布局时自己崩溃，是对「reader 必须诚实判定 corrupt/incompatible」的正面背叛。SA6 红灯测试未覆盖这些分支（fixture 总是先 mkdir segments），所以它们是**测试未锚定的真缺口**，不是已满足的项。

**修订要求**：
1. reader 全函数 try/catch 兜底：任何未归类异常 → `{ status:'corrupt', manifest:已读到的|null, records:[], issues:[{code:…}] }`，绝不抛；
2. 显式定义三个分支的稳定码映射（词表封闭，SA1 定稿并记 §11）：segments 目录缺失/不可读、单 segment jsonl 读失败（建议至少 stream 级 issue + 该 segment 内 records 空/该段记 invalid-json 类）、bin 读失败（建议引用它的 record 记 `frame-missing`）；
3. 明确「jsonl 缺失（bin-only segment，计数入 presence 集合）」按空处理还是记 issue——当前 §7.1 ④ 的存在性定义与 ⑤ 的逐行读取之间留了未定义缝隙。

**红灯测试构想**：`writeStreamFixture` 后 `rmSync(segmentsDir, {recursive:true,force:true})` → `expect(() => readStreamStrict(...)).not.toThrow()` + status corrupt；`mkdirSync(jsonlPath)` 占位 → 同款；bin 目录占位 + 引用它的 sidecar record → 不抛 + corrupt。

### #4（MAJOR）J9 总控裁决未回写正文——设计文档自相矛盾

**证据**：文末总控裁决（2026-08-28，SA8 冲突点 #1）已裁定选项 (c)：`DiagnosticLogHealthEvent` 新增 `{ type: 'stream-exhausted' }`、writer 在「进入 exhausted 的转换时刻恰发一次」。但正文四处理直气壮地写着旧决策：
- §4.1：`exhausted(lastSequence) → 丢弃（静默；§10-J9 护栏）`；
- §8：联合「追加三成员」（SA6 契约三成员 + G3 扩值，无第四成员）；
- §10-J9：「物理不可达…词表演进留给实际需要时」；
- §12 ALLOW LIST：`src/health.ts … 追加三成员（§8，+~20 行，只增不改）`。

**影响**：SA3 以 §4.1/§8/§10-J9/§12 为实现依据（正文是工作文档，文末附注易被漏读）→ 落地「静默丢弃」→ 违反已生效总控裁决与 ADR 0012「丢弃**并上报**」（docs/adr/0012:67）。这不是重审裁决（裁决本身正确且已生效），是**裁决集成缺陷**：裁决只追加在文档尾部，没有像 G1–G6 那样获得正文一致性。

**修订要求**：裁决回写五处——§4.1 exhausted 分支改为「丢弃 + 转换时刻恰一次 `stream-exhausted`（bool 门闩，与 failed 模式事件抑制同纪律）」；§8 联合列第四成员；§10-J9 改为「已由总控裁决为独立成员」；§12 health.ts 行改「四成员」；§9 补转换测试映射。并精确定义**转换时刻**：`nextDecimal` 产出 `UINT64_MAX` 的那次 append 完成（无论该 record 后续落盘成败——sequence 已分配）后置位并发事件一次；此后所有 append 静默丢弃。

**红灯测试构想**：仿 #148 `createBoundedMemoryDiagnosticLogPresetSequence` 增加 File 版预置接缝（testing 子路径）：预置 `lastSequence = UINT64_MAX 前一位` → 第一次 emit 落盘 sequence=UINT64_MAX 且 events 恰一次 `stream-exhausted`；第二次 emit 零落盘且**不再**发该事件；reader 对第一条 record ok。

---

## 协议假设依据审查

**结论：通过（附一条强制补登要求）。**

- §13 章节存在，且覆盖了本设计全部运行时库行为假设（无 HTTP/WS/端口类假设，定位正确）。
- 8 条依据全部为**可验证引用**（Node 官方文档行为 + SA6 测试行号锚定 + 仓内先例），无「应该/通常/预计」类无据推断；SA4 可按引用重跑复核（`appendFileSync` 创建语义、`'wx'` EEXIST、EISDIR、rename 原子性、Base64 宽松解码、ENOENT/err.code、mkdir 幂等、JSON.stringify 紧凑性——七条均与 Node 20 实测一致，其中 EISDIR/append/Base64 三条已被 SA6 测试文件行号钉死）。
- **缺口（并入攻击 #1）**：设计实际依赖「`statSync(目录)` 成功返回非零 st_size 而非抛错/返回 0」这一行为（binLength 重同步），却未登记为假设——登记即自曝漏洞。修订 #1 时必须同步补登该条及其风险定级。

## 错误处理链路审查

- **静默失败**：append 路径无静默失败（§4.4 表 9 行逐行有事件；顶层 pipeline-crashed 兜底）✅。三个残留静默点均已立案：exhausted（#4，裁决已出、正文未回写）、genesis 守卫跳过（#7，MINOR）、resume 匹配分支静默新建（G1 已裁决备案，不重审）。
- **状态闭环**：writer 模式机（ready/disabled/failed/exhausted）在**枚举到的**失败路径上闭环 ✅；但构造期未预见异常无闭环（#2 MAJOR）、reader 的 fs 异常无闭环（#3 MAJOR）。
- **降级路径**：line 预算降级链复用 #148（先降级后丢弃+上报）✅；current.json 失败不禁用（locator 可重建）✅；manifest 失败 disabled ✅；genesis 失败不禁用 ✅。
- **虚假降级识别**：命中 1 处——**#1 的「binLength 重同步」是把未知状态伪装修复完成的虚假恢复**（EISDIR 恢复后 stream 反而永久 corrupt）。这不是降级设计错误，而是恢复机制本身有 bug 被事件上报掩盖（事件发了、record 丢了、看似一切正常，状态却坏了）——按立法精神定为 CRITICAL。
- **用户可感知性**：每类失败均有独立 observer 事件或 reader issue 返回 ✅（#2/#3 补齐后成立）。

## 红线测试思路（汇总）

| 攻击点 | 红灯测试（SA6 域外补充，SA3 实现期落地） |
|---|---|
| #1 | ns-binfirst-1 已锚定（必败回归）；+ 成功帧后 EISDIR 再恢复变体；+ truncate 自愈变体（若采纳 fresh-stat） |
| #2 | 注入 throwing/NaN/超域 clock 三连 → 构造不抛 + 恰一次 pipeline-crashed + emit 不抛零落盘 |
| #3 | segments 目录删除 / jsonl 目录占位 / bin 目录占位 → readStreamStrict 不抛 + corrupt + 稳定码 |
| #4 | File 版 presetSequence 接缝 → 转换时刻恰一次 stream-exhausted；后续静默 |
| #5 | manifest 身份字段篡改（空 records）→ 期望码（SA1 裁决值） |
| #6 | injectFinalRecordFile 超预算 record → 零落盘 + record-dropped（若采纳对齐 #148） |
| #7 | payloadMaxBytes 注入 + 大 genesis → 事件（若总控裁决采纳）或 README 判别法文档化 |
| #8 | manifest 第 15 键 / 类型篡改 → 裁决行为钉死 |

---

## 结论

设计的整体架构（BIN-first、双门校验、冻结面只增不改、路径安全、resume 恒新建）与 ADR 0012/0011 及 SA6 红灯契约的对齐度**高**，§13/§14 两项立法要求均合规，绝大多数判断引用的 #148 符号与行为经源码核验属实。但 **#1 是设计按字面实现必然无法通过自身红灯契约的机制性缺陷**（且属「虚假恢复」类红线），#2/#3 是 ADR 核心隔离红线（初始化不影响业务、reader 诚实判定）在两个边界面上的缺口，#4 是已生效总控裁决的集成不一致。

**Verdict: reject。** 要求 SA1 修订 #1–#4（MINOR #5–#9 可随修订一并处理或显式备案豁免）后提交 R2 复审；R2 仅需复核修订点，不重开全量评审。

---

## 附录 A：核验证据（2026-08-28 于本 worktree 执行）

- **A-1 目录 stat 行为**（#1 依据）：`node -e` 实测——`statSync(目录).size = 4096`、`isFile = false`、不抛；`appendFileSync(目录)` 抛 `EISDIR`；`statSync(缺失, {throwIfNoEntry:false})` → `undefined`。
- **A-2 红灯契约实体**：`git status` 确认五测试文件 + 两 helper 在树（untracked）；基线 commit `7ceede1`（#148 冻结）。
- **A-3 #148 符号核验**：`nextDecimal`/`UINT64_MAX` 导出于 `src/adapters/memory.ts:32,36`；`INTERNAL` Symbol 模式 `memory.ts:146`；`record-dropped.reason` 两值 `src/health.ts:43`；`GenesisBaselineRecord.update: UpdateCarrier` 强制无 omitted 变体 `src/schema.ts:210-218`；`P_STREAM_ID/P_SEGMENT/P_DECIMAL/P_BASE64` `src/schema-patterns.ts:13-38`（P_BASE64 确实放过 'AB=='，canonical 判定必须归 storage 层——设计 §7.3 论证成立）；memory `appendFinal` 含 line 预算门（`memory.ts:258-281,336-351`，#6 依据）；`observedAtFrom` 文档明示可 throw（`src/emission.ts:99-106`，#2 依据）。
- **A-4 §14 审计复核**：`git grep` 包外零引用、`DiagnosticLogHealthEvent` 包外零消费者、包内唯一 switch 按 result.kind 判别——与设计 §14 声明一致。
- **A-5 ADR 条款定位**：exhausted「丢弃并上报」`docs/adr/0012:67`；orphan/不完整尾 best-effort `:240`；初始化失败不影响 namespace create `:24`。

---

# SA2 R2 复审（2026-08-28）

**Date**: 2026-08-28
**Verdict**: **pass**（R1 全部必修项 #1–#4 与 MINOR #5–#9、INFO #10、API 备注、§13 补登要求**全部消除**；附 **1 条实现期强制小修 R2-1**——R2 新接缝引入、MINOR、不需要 R3 设计轮——与 2 条实现期备注。）

**被审对象**: `wiki/raw/task_diagnostic-log-file-adapter_design.md`（R2，862 行，35 处「R2 修订（SA2 #N）」标注 + 文末 R2 回应表）。
**复审范围**: 仅 R1 修订点 + R2 新增面（`createFileDiagnosticLogPresetSequence`、§11-G7–G10 定稿行）；R1 已判合格的部分（架构、BIN-first、路径安全、resume 裁决等）不重开。关键行为均经独立实证（附录 B），不采信设计文档自述。

## 逐条复核表（R1 十二项 → R2 落实判定）

| R1 # | R2 修订位置 | 判定 | 复核依据（独立验证，非转述） |
|---|---|---|---|
| #1 CRITICAL binLength 重同步 | §4.1 `planFrameOffset`（fresh stat + `isFile()`）、§4.1 不变量、§4.4「offset 规划」行、§9、§13 补登 | ✅ 消除 | 采纳建议 (b)（弃缓存，更优）；ns-binfirst-1 六步独立推演通过（下文重点-1）；grep 证实 `binLength` 仅存 4 处历史引用（缺陷自记/假设行/回应表），无存活设计用法 |
| #2 MAJOR 构造 crash 包络 | §3.1 整体 try/catch + finally 占位、模式表新增行、§1.3/§4.2/§4.4 | ✅ 消除 | 失败语义闭合（下文重点-2）；占位 id `'log-'+'0'×32` 文法合法、零磁盘产物；`pipeline-crashed` 为 #148 既有成员，零扩词表 |
| #3 MAJOR reader fs 包络 | §7.1 ④⑤⑧、§7.4、§7.5 四行、§11-G9 | ✅ 消除 | 三分支 + 兜底全部收敛 corrupt/incompatible，23 码内零扩码（下文重点-3） |
| #4 MAJOR J9 裁决回写 | §1.2/§4.1/§4.4/§8/§10-J9/§12/§14/§9/§6.3 | ✅ 消除 | 五处以上回写逐字一致 + 转换时刻精确定义（下文重点-4） |
| #5 MINOR manifest 身份互核 | §7.1③ 身份互核、§7.5、§11-G7 | ✅ 消除 | stream 级 `stream-mismatch` + records:[] + manifest 仍展示；`schemaId` 自述不自洽并入 fingerprint 码——均 23 码内复用 |
| #6 MINOR injectFinalRecordFile 门序 | §6.3 全门序重写 | ✅ 消除 | 补齐 line 预算门（含 input 降级 + 两事件）+ `mode ≠ ready` 静默丢弃——与 #148 `appendFinal`→`gateAndEnqueue`（memory.ts:258-281,336-351）逐门对齐 |
| #7 MINOR genesis 守卫静默 | §4.2 豁免备案段、§11-G10、§12 README 行 | ✅ 落实（采纳 R1 备选之二） | 豁免论证成立（ADR「尽力」措辞 ≠ 丢弃上报义务；判别法文档化；静默面收窄到 Host 自洽可查输入；留总控翻案口） |
| #8 MINOR manifest 严格度 | §7.1③ 恰 14 键 + 类型核对、§11-G8 | ✅ 消除 | 逐键类型规则列明；例外（fingerprint string-but-wrong）归身份码——语义正确；SA6 fixture 均 14 键类型正确，零红灯冲突 |
| #9 MINOR tmp 残留 | §2.3 best-effort unlink + 残留合法声明 | ✅ 消除 | 清理失败不升级、locator 恢复只按主名——与 layout 测试「无 tmp 残留」（健康路径）不冲突 |
| #10 INFO 并发读写 | §4.3 声明段 + §12 README | ✅ 落实 | 如实文档化，ADR 无冲突 |
| API 备注 clock 注释 | §1.3 clock 行 | ✅ 落实 | 「两处同源」表述与 §2.2/§4.2 一致 |
| §13 补登要求 | §13 新增 stat-目录行为行 | ✅ 落实 | 含实测引用与 R1 缺陷自记——「登记即自曝」补课到位 |

**驳回项核对**：R2 回应表声称「无驳回、全部采纳」——经逐项核对属实。

## 重点项深度复核

### 重点-1（#1 CRITICAL）：fresh-stat 方案对 ns-binfirst-1 的自洽性——独立推演通过

按 R2 §4.1 语义对红灯测试 `file-adapter-mismatch-interference.test.ts:160-199` 六步重演：

1. inline 记录 → JSONL 1 行（.bin 不存在）；
2. `mkdirSync(p.binPath)` 目录占位；
3. emit 4097B：`planFrameOffset` → `statSync` **成功**（目录）→ `isFile()===false` → offset 0 → carrier 引用 '0' → 各门通过 → `appendFileSync` 抛 EISDIR → `storage-write-failed{stage:'bin',code:'EISDIR'}` 恰一次 → record 连同引用一并丢弃（JSONL 仍 1 行、零 sidecar 引用）——满足测试 :174-183；
4. `rmdirSync` 恢复；
5. 再 emit 4097B：`planFrameOffset` → `statSync(…,{throwIfNoEntry:false})` → `undefined` → offset 0 → append 在新建文件 offset 0..4121 落帧 → JSONL 引用 `frameOffset:"0"` = **真实落点**；
6. reader：首引用 expectedOffset=null → 跳 boundary → magic/version/type/flags/reserved/length/sequence/CRC 全过 → record ok → **status ok**——满足测试 :195-198。✓

附带核验：(a) 双帧递推（ns-sidecar-2）——emit1 stat→undefined→0，emit2 stat→4122=25+4097 ✓；(b) genesis sidecar（ns-genesis-2）新 stream stat→undefined→offset 0 ✓；(c) EISDIR 场景事件恰一次（stat 未 throw，无双重事件）✓；(d) `planFrameOffset` stat throw（EACCES）→ `storage-write-failed{stage:'bin'}` + 丢弃（未尝试 append、零副作用、sequence 已分配成 gap）——§4.4 新行闭合 ✓；(e) 单进程单 writer 下 stat 与 append 间无 TOCTOU（跨进程违反 ADR 部署约束，不承诺）✓。**虚假恢复反模式已根除**：内存-磁盘孪生状态整体消失，故障后自愈不依赖任何「猜测」。

### 重点-2（#2 MAJOR）：构造包络的失败语义——闭合

- **覆盖面**：`clock.now()` throw / NaN（`new Date(NaN).toISOString()` RangeError）/ epoch 超域（`observedAtFrom` 冻结文档明示可抛，emission.ts:99-106）/ `randomSource.randomBytes` throw / config 形状垃圾 TypeError / 未列举 errno——全部落入外层 catch → failed 模式 + 恰一次 `pipeline-crashed{stage:'adapter'}`。与 §4.1 append 面顶层 catch 对称。
- **「恰一次」不受双事件污染**：①②③⑤ 各分支以 return 语义终止（不冒泡），catch 只接未预见异常；`notify` 经 `safeNotify` 永不抛（health.ts:83-98），分支事件与兜底事件不会叠加为同一 type 两次。
- **形状完备**：`finally` 的 `streamId ??= 'log-'+'0'.repeat(32)` 仅在 randomBytes 即抛时生效——文法合法（`^log-[0-9a-f]{32}$`）、零磁盘产物；disabled/failed 模式 emitter 为完整管线 + 静默 sink（intake 照跑、不抛）——layout 敌意 namespaceId 测试的 `typeof log.emitter.emit === 'function'` 断言保持满足。
- **磁盘产物诚实**：模式表新行「不保证零产物（mkdir 可能已发生；绝无半写 manifest——'wx' 原子创建）」——与 best-effort 语义一致，无虚假零产物承诺。
- 一处已核实的轻微张力（不立案）：genesis IO 型失败（§4.2「不禁用 stream」）与外层 catch（failed 禁用）的边界依赖「genesis 的 errno 捕获在内部、未预见异常才冒泡」的实现纪律——设计语义可分辨（IO 失败有 `storage-write-failed` 事件路径），SA3 实现时注意两层 catch 的分工即可。

### 重点-3（#3 MAJOR）：reader fs 分支与 23 码词表——零扩码、语义贴合

| 分支 | 码 | 判定 |
|---|---|---|
| `readdir(segmentsDir)` throw（ENOENT/EACCES/ENOTDIR/EISDIR） | `manifest-invalid`（corrupt）+ records:[] | ✓ 与 ② manifest ENOENT 同码同义——「自描述结构不可用」伞义；构造协议（§3.2 segments 先于 manifest）支撑「目录缺失=结构损坏」的区分依据 |
| jsonl ENOENT（bin-only 段） | 零行、**无 issue** | ✓ 合法崩溃残态（BIN-first 崩溃窗口：帧已落、行未落）；与 ④ 存在性集合「jsonl/bin 任一存在」自洽；空内容 stream 判 ok 是诚实判定 |
| jsonl EISDIR/EACCES | stream 级 `invalid-json`（segment 归因）+ 该段零条目、他段照常 | ✓ 「内容事实上不可解析」的合理推广；corrupt |
| bin 缺失/非常规文件（含目录占位）/不可读 | `frame-missing`（record 级） | ✓ ADR 门槛 11「缺BIN」的推广；`statSync`+`isFile()` 文件感知（与 #1 修复同款纪律） |
| 全函数兜底（未归类异常） | corrupt + `manifest-invalid`（伞义）+ 已积累 issue ∪ 兜底码 + `manifest:已读到的|null` | ✓ 「绝不抛」闭合；伞义选码在 23 码封闭约束下是最不坏选择（R1 授权「收敛为 corrupt + 稳定码」） |

零新码；`invalid-json`/`stream-mismatch`/`manifest-invalid` 三行 §7.5 触发条件已同步扩展。SA6 红灯全部走 fixture 正常路径，新分支零冲突。

### 重点-4（#4 MAJOR）：J9 五处回写一致性——逐字核对通过

grep 实证 `四成员|stream-exhausted` 分布：§1.2:82、§4.1:296/302/356、§4.4:415、§6.3:492、§8:637/649、§9:674/678、§10-J9:694、§12:737、§14:781——**无一处残留「三成员」或旧「静默丢弃」表述**（§4.1:296 的「静默」指转换后的丢弃，与裁决一致）。转换时刻语义精确且自洽：「allocate 产出 UINT64_MAX 的分配完成即触发，无论该 record 后续落盘成败；该 record 本身继续走门与落盘（UINT64_MAX 是合法 sequence）」——对照 ADR「达到 uint64 最大值后……丢弃**并上报**」：达到（分配出 max）→ 上报一次，后续丢弃，上报义务由转换事件履行 ✓。对正常流完备：lastSequence 只能经 allocate 渐进推进，产出 max 时必置门闩，`nextDecimal` 永不被 max 调用（该完备性的唯一例外见 R2-1）。genesis 与 attempt 共用 `allocate()`（R2 统一）正常流等价、预置组合已注记 ✓。

## R2 新发现

### R2-1（MINOR，实现期强制）：预置接缝对非法 lastSequence 的静默纵容

**总控指定审查项**：`createFileDiagnosticLogPresetSequence` 是否引入新问题——**是，一处**。

**触发条件**：`createFileDiagnosticLogPresetSequence(config, X)` 传入 `X ≥ UINT64_MAX`（典型：`'18446744073709551615'` 本身——测试装配错误）。此时 `exhaustedLatch` 为 false、`allocate()` 执行 `nextDecimal(X)`：

**实证**（附录 B-1）：`nextDecimal('18446744073709551615') === '18446744073709551616'`（超域）；门闩检查 `sequence === UINT64_MAX` 对该产出为 **false**（不触发）；`P_DECIMAL`（`^(0|[1-9][0-9]*)$`，#148 冻结、无值域上界）**放行**该串 → VFSL 门不拒；`DataView.setBigUint64` 对超域 BigInt **静默 mask**（实测写回读出 `0n`，不抛 RangeError）。

**后果**（两条路径都不是 loud 失败——测试装配错误被静默转化）：
- **inline 路径**：超域 sequence 的 record 正常落盘；reader 侧 VFSL 过、无 frame 交叉 → **判 ok**——超 uint64 域的 sequence 被判 ok，诚实性缺口；
- **sidecar 路径**：frame sequence 被 mask 为 0 后落盘，JSONL 引用超域串 → reader 判 `frame-sequence-mismatch` → corrupt——**装配错误被转化为「看似数据损坏」的假象**，误导排障。

**根因**：#148 memory 的防线是「allocate **之前**检查 `lastSequence === UINT64_MAX`」（memory.ts:186,323——预置 max 本身直接进 exhausted 丢弃）；R2 门闩语义迁移为「产出 max 时置闩」后，该前置防线在预置非法值场景丢失。

**修订要求**（一行级，二选一，SA3 实现期强制落地；建议 (a)）：
- (a) 预置接缝入参校验 loud throw：`lastSequence` 须匹配 P_DECIMAL **且** `BigInt(lastSequence) ≤ UINT64_MAX`，违规 throw（testing 接缝对装配错误 loud 化——#148 `createDeterministicRandomSource` 空字节序列 loud throw 的同型先例，testing.ts:28-32）；
- (b) `allocate()` 内防御：`next` 经 BigInt 比较超域 → 视为已耗尽（若未发过事件则发）+ 丢弃。

同时建议在设计 §6.3 补一句入参约束（总控裁量是否要求 SA1 出 R3 文档轮；SA2 判定不需要——MINOR、testing-only、生产不可达、一行修复）。

**红灯测试构想**：`expect(() => createFileDiagnosticLogPresetSequence(config, '18446744073709551615')).toThrow()`；同款 `'01'`（前导零）/`'abc'`（非十进制）；`'0'` 为合法下界（断言不抛，走正常流）。

### 实现期备注（不立案，不阻塞）

1. §6.3「复制 #148 injectFinalRecord 全部门序」未显式声明 `appendFinal` 面的顶层 try/catch（#148 memory.ts:337-350 有，`pipeline-crashed`）——「复制语义」可解释为涵盖，建议 SA3 实现时显式落上，防注入违规 record 使 testing 接缝 throw。
2. §9「R2 补充测试映射」六行的落地者与 SA6 owned 测试域的边界（新增独立文件 ≠ 改既有断言）建议 SA3 开工时与总控确认归属，非设计缺陷。

## R2 红灯测试思路（增量）

| 攻击点 | 红灯测试 |
|---|---|
| R2-1 | 预置 `UINT64_MAX` / `'01'` / `'abc'` → 接缝 loud throw；预置 `UINT64_MAX−1` → 既有转换测试（R2 §9 已列）保持 |
| 备注-1 | 注入会使 appendFinal 抛的 record（如 getter 陷阱）→ 接缝不抛 + `pipeline-crashed` 事件 |

## 结论

R1 的 1 CRITICAL + 3 MAJOR + 5 MINOR + 1 INFO + API 备注 + §13 补登要求在 R2 中**全部真实消除**（非话术性回应：每个修订点均给出可实现的机制文本，#1/#2/#3/#4 的关键语义经本轮独立推演与运行时实证复核）。R2 新增接缝引入 1 个 MINOR 边界缺口（R2-1：预置非法 lastSequence 的静默纵容——超域 sequence 判 ok 或 mask 后假损坏），属 testing-only 面、一行级修复，定为实现期强制项。

**Verdict: pass**（附实现期强制小修 R2-1 与两条实现期备注；`pass` 仅覆盖设计审查——实现与活链路验证归 SA4/SA7）。

---

## 附录 B：R2 复审核验证据（2026-08-28 于本 worktree 执行）

- **B-1 预置接缝超域行为**（R2-1 依据）：`node -e` 实测——`nextDecimal('18446744073709551615') === '18446744073709551616'`；`BigInt(产出) > BigInt(UINT64_MAX) === true`；`/^(0|[1-9][0-9]*)$/.test(产出) === true`（P_DECIMAL 放行超域串）；`DataView.setBigUint64(0, BigInt(产出))` **不抛**、`getBigUint64` 读回 `0n`（静默 mask 为低 64 位）；`setBigUint64(BigInt(UINT64_MAX))` 正常可表达。R2 门闩检查 `产出 === UINT64_MAX` 为 `false`。
- **B-2 回写一致性**：`grep -n "四成员\|stream-exhausted" design.md` → §1.2/§4.1×3/§4.4/§6.3/§8×2/§9×2/§10-J9/§12/§14 共 14 处命中，无「三成员」残留；`grep -n "binLength" design.md` → 4 处，全部为 R1 缺陷历史引用（不变量自记/§13 假设行/回应表），无存活设计用法——与设计 §837 一致性自检声明相符。
- **B-3 R2 标注计数**：`grep -c "R2 修订\|R2 新增\|R2 注\|R2：" design.md` → 35 处（总控口径 36 为标注变体计数差异，覆盖度无缺口，不构成问题）。
- **B-4 基线稳定**：`git status` 确认 #148 冻结 src 面在本 worktree 仍零改动（仅 wiki + 测试文件在树），R2 全部引用符号持续可定位（R1 附录 A-3 证据有效）。
