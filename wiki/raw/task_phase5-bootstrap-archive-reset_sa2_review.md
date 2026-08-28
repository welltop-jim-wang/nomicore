verdict: reject

# SA2 攻击评审报告 — issue #133「Phase 5: bootstrap import, archive, and guarded replica reset」（Phase 2 设计攻击）

**Date**: 2026-05-30（评审基线：design.md 1053 行 @ ebc5419 worktree）
**Verdict**: **reject**（2 个 BLOCKER/HIGH 级规格缺口 + 2 个 MEDIUM 级修订项；其余攻击面经机械化推演确认闭合，预答区论证逐条验证成立）

- 被审对象：`wiki/raw/task_phase5-bootstrap-archive-reset_design.md`（D-1..D-14）
- 契约锚：5 个 SA6 测试文件全文细读（ARC 23 用例 / IMP 14 / REG 18 / 两 surface test-d）
- 代码事实：persistence/src/{contract,lifecycle,memory,file,testing,index}.ts、namespace-registry/src/{registry,lease,identity,observer,types,errors,index}.ts、namespace-runtime/src/{close,runtime,replication-write}.ts 全文/关键段逐行核对；3 个 stub 文件抽查 + `implements DocPersistence` 全量 grep（16 命中：13 stub + Memory + File + 1 注释）
- 纪律：只读 + 本报告；未改任何 src/test/docs 文件

---

## 一、攻击点清单（总表）

| # | 严重度 | 攻击面 | 具体漏洞 | 设计是否已防御 | 修复方向 |
|---|--------|--------|---------|----------------|----------|
| 1 | **BLOCKER** | settle 排空环 × dispose（§4.5.2） | degraded retry 武装 + 零在途 flush 时 dispose：waiter 永久挂起 → archiveDoc/reset/shutdown 永久挂起；R4 声称的「dispose 无条件通知」无任何规格化机制承载；flush finally 通知次序文本自相矛盾 | **否**（R4 声称有、机制缺） | 见 §三.1 修订条件 |
| 2 | **BLOCKER** | archiving cell 态 × 失败路径（§4.5.3/§4.5.5） | archiving claim 的**失败路径** cell 清理（带 `cur.claim === claim` identity 守卫的 catch 段）未规格化；5 个 ARC 锚（identity 两式/failNextRead/failNextWrite/损坏）在泄漏实现下 loadDoc 无限微任务循环 → 测试超时红 + key 永久毒化 | **否**（仅成功路径注释提及） | 见 §三.2 修订条件 |
| 3 | MEDIUM | seedForTest × archiving 态（§7 lifecycle 改动清单遗漏） | `seedForTest`（lifecycle.ts:289-306）对 reading/creating 抛错守卫未扩 archiving；归档在途 seed 会以 `cells.set` 无条件覆写 archiving cell，击穿归档排他 | 否（§7 清单未列 seedForTest） | 守卫扩 `archiving`（1 行） |
| 4 | MEDIUM | Memory archive-scoped key 碰撞（§4.10/D-10） | `archive\0{userId}\0{docId}` 与主键 `${userId}\0${docId}` 同池：直接调用 `createMemoryPersistence` 方以 `userId='archive'`、`docId='alice\0ns-…'` 创建即精确命中归档槽位，静默覆写归档副本（违反 INV-4）；memory.ts 无任何身份文法（file.ts 有） | 否（设计未讨论该碰撞） | Memory 归档区改独立 Map（结构性分区）或在 baseIo 入口拒绝 `\u0000` 段 |
| 5 | LOW | 错误判别通道混用（§4.8.3） | 四类归档拒绝按 code 字符串、`DocArchiveFatalError` 按 instanceof：duck-typed 第三方 Adapter 的 fatal（code=`DOC_ARCHIVE_FATAL` 非 instanceof）落入 unknown → committed 事实被改写为 false（relocate-remove 的 true 丢失） | 部分（R10 只论证 code 判别本身） | fatal 分支同样 code-first（读 `cause.committed` 需在场合），instanceof 作双保险 |
| 6 | LOW | importReplica 接纳段未显式规格化（§4.2） | §4.8 为 reset 给出「接纳段（acceptance + validateOpenIdentity + carrier FIFO）」，§4.2 对 import 仅从槽内 ① 开始；File 侧 SAFE_PATH_SEGMENT 依赖该前置 | 隐含（镜像纪律） | 补一句冻结：import 接纳段 = acceptance + validateOpenIdentity 同款同步段 |
| 7 | INFO | import 对 closing entry 不等待（§4.2 ①） | 外来 idle-close 在途时 import 得 `NAMESPACE_ALREADY_EXISTS`（镜像 create 碰撞策略）；调用方重试即成功——稳定且诚实，记录即可 | 是（有意设计） | 无 |
| 8 | INFO | TOCTOU（复制字段在 ②b 与 encode 间变异） | 预答区「与 createDoc 完全同构」经核实**成立**：createDoc 从不校验复制字段，import 的可逃逸核对不劣于既有暴露面；受信调用方模型（0010:79）内闭合 | 是（§4.2 TOCTOU 声明 + R2） | 无 |
| 9 | INFO | 强制 lease 失效的运行时噪声 | release 循环末尾 handleLeaseReleased 会发射 `entry-idle` + 短暂 phase='idle'，随即被 cancelIdleArm/close 覆写——观测噪声（N'-5 同族） | 部分 | 可选：reset 槽内抑制 idle 武装（如先翻 phase 或传标志） |

---

## 二、BLOCKER 级攻击详述（可复现场景脚本）

### #1 settle 被动等待 × dispose：永久挂起（liveness 破坏 + 设计自身诚实性缺口）

**证据锚点**：
- `packages/persistence/src/lifecycle.ts:550-578`（flush 的 finally 结构：`if (!this.isCurrent(epoch)) return` 早退在 `maybeEvict` **之前**）；
- `lifecycle.ts:314-332`（dispose：`clearTimers(entry)` 会**取消 retry timer**、`cells.clear()`、不触达任何 waiter 结构）；
- `lifecycle.ts:580-588`（scheduleRetry：retryTimer 武装 = 降级窗内唯一 flush 调度源）；
- 设计 §4.5.2 伪码（settle：`retryTimer !== undefined` 时跳过 startFlush、纯被动 `await archiveWaiters`）；§4.5.2 bullet 2（通知**唯一**机制 = flush finally 追加）；§7 lifecycle.ts 改动清单（**无 dispose() 改动项**）；§6-R4（声称「dispose 无条件通知 waiters 解除挂起」）。

**场景脚本（步骤化交错）**：
1. `saveDoc` 后 flush 失败（如 `failNextWrite`）→ entry 进入 degraded，`retryTimer` 武装（`retryDelayMs` 回退中），`flushing===false`，handles 已全部 release（registry 侧 lease 失效/idle-close 后的常见残态——REG 闭环中 registry entry 已清而 persistence cell 降级脏是真实可达路径，本评审在 §4.5.7 并发矩阵「archive ∥ saveDoc/flush」行的语义下核实）。
2. `archiveDoc(key)` → settle 循环：cell live、handles=0、`retryTimer !== undefined` → **不**调 startFlush，落入 `await new Promise(resolve => entry.archiveWaiters.push(resolve))`。
3. 此刻**没有任何在途 flush**（上一次 flush 已失败结算，retry timer 是唯一未来调度源），settle 的外层 archiveDoc promise 尚未进入 `track`（claim 未建，§4.5.3 的 op 尚不存在）→ `inFlight` 中无该工作。
4. `dispose()`：`closed=true; epoch+=1; abort()` → 对该 live cell `clearTimers(entry)`（**retry timer 被取消**）→ `cells.clear()` → `await Promise.allSettled(inFlight)`（不含 settle 等待）→ dispose **正常返回**。
5. 此后：`startFlush` 因 `this.closed` 永不启动、flush finally 永不再运行、无任何代码路径触达 `archiveWaiters` → **settle 永久挂起**。

**期望 vs 设计行为**：期望 archiveDoc 最终以某种错误结算（R4 声称「dispose 竞态下等待者也被告知，随后 claim 段 assertWritable 以 bare disposed 错误收口」）。按设计 §7 改动清单实现的代码在上述交错下**永不结算**。

**放大后果**：该 archiveDoc 由 registry reset 槽调用 → 槽 promise 永挂 → `carrier.tail` 永挂 → `runShutdown`（registry.ts:1173 `for (const carrier of [...carriers.values()]) await carrier.tail`）**永挂** → Host shutdown 死锁。单测形态：fake scheduler + failNextWrite + reset + dispose 即可构造（无需真实计时）。

**次级缺陷（同一节文本）**：§4.5.2 bullet 2 的通知放置次序描述「**先于** `isCurrent(epoch)` 早退、在 maybeEvict **之后**」对单条语句是**不可同时满足**的矛盾约束（lifecycle.ts 现行 finally 中早退先于 maybeEvict）。两种放置分别覆盖不同分支：置于 finally 开头 → dispose 竞态轮通知、但正常轮先于 `flushing=false`/maybeEvict（微任务时序下无害，本评审已核实）；置于末尾 → 正常轮完整、dispose 竞态轮**漏通知**。SA3 按字面任选其一都可能落错。

**修复方向（修订条件）**：① 设计明文：`dispose()` 同步段在 `clearTimers` 前/后对每个 live entry `archiveWaiters.splice(0).forEach(w => w())`（waiter 醒后 settle 见 cell 缺席返回，claim 段以 disposed 错误/fatal 收口）；② flush finally 的通知语句固定为**无条件置于 finally 首位**（先于 `isCurrent` 早退），并更正 bullet 2 的次序文本；③ 外层 archiveDoc 的 settle 等待纳入 `track`（或等效 inFlight 记账），使 dispose 的排空语义覆盖归档全程。

### #2 archiving claim 失败路径清理缺失：key 永久毒化 + 5 个 ARC 锚机械红灯

**证据锚点**：
- `lifecycle.ts:263-268`（createDoc 的失败清理范型：catch 段 `cur?.state === 'creating' && cur.claim === claim` 才 `cells.delete`——identity 守卫防 ABA）；
- 设计 §4.5.3（op 闭包体为 `/* guard-read → verify → relocate，下文 */` 占位）；§4.5.5（唯一一次提及 claim 释放是**成功路径末尾**的注释「claim 释放（cells.get(key) 仍为本 claim 才删）」）；§4.5.6 失败矩阵九行**无一字**说明 archiving cell 的善后；
- ARC 锚：`persistence-phase5-archive-red.test.ts:280`（身份不匹配拒绝后 `await fx.persistence.loadDoc(...)` 断言非 null）、`:305`（epoch 式同）、`:331`（损坏式同）、`:442`（failNextRead 式同）、`:549`（failNextWrite 式同）——**五个用例都在归档拒绝之后立即 loadDoc 同 key**。

**场景脚本**：
1. createDoc → release（cell 干净驱逐）→ `archiveDoc` 以错误身份调用。
2. claim 环置 `{state:'archiving', claim}` → op 内 verify 抛 `DocArchiveIdentityError` → op reject；`claim.promise = op.then((),())` 已 settle。
3. 若 op 闭包无 catch 侧清理（设计未规定）：cells 中 `archiving` cell **永久残留**（claim.promise 已 settle）。
4. 随后 `loadDoc`：fast path 非 live → `resolveLoad` 新增 archiving 分支 `await cell.claim.promise; continue` → claim 已 settle（微任务）→ 循环回 `cells.get` → **仍是 archiving** → 再 await 已 settle 的 promise → 无限微任务循环 → `loadDoc` 永不返回 → ARC 锚 5 例全部以超时红。createDoc/importDoc 的 archiving 分支同构毒化（§4.5.1「等待 claim.promise 后重评估」在同残余下同样死循环）。
5. 一次失败的归档即让该 `(owner, docId)` key 在本实例上永久不可用——比红灯更严重的是生产语义：reset 的 `NAMESPACE_RESET_IDENTITY_MISMATCH`（设计宣称「文档完好可 open」，INV-6）在真实 persistence 下**不成立**（open 挂死）。

**期望 vs 设计行为**：§4.14.1 声称 ARC「22 红全绿」、§4.8.3 声称 identity mismatch 后「本地文档完好——零部分删除」——两者都**隐含依赖**未规格化的失败清理。冻结设计不能把「照抄 createDoc 的 catch 范型」留给实现者猜测（放置位置、identity 守卫、与 track 的关系都影响正确性）。

**修复方向（修订条件）**：设计 §4.5.3/§4.5.6 明文：op 闭包以 try/catch 全包，catch 侧（以及成功路径末尾）执行 `const cur = this.cells.get(key); if (cur?.state === 'archiving' && cur.claim === claim) this.cells.delete(key)` 后 rethrow——逐字节镜像 createDoc 范型（lifecycle.ts:263-268）；并在 §4.5.6 矩阵为每一拒绝行补「archiving cell 已按 identity 守卫清理」的 store 状态列。

---

## 三、MEDIUM/LOW 级攻击详述

### #3 seedForTest 未适配 archiving 态（MEDIUM）

`lifecycle.ts:289-306`：`seedForTest` 仅对 `reading`/`creating` 抛 `'test seed requires an idle key cell'`，随后**无条件** `this.cells.set(key, {state:'live'})`。新增 `archiving` 态后：归档在途（relocate 前）执行 seed → archiving cell 被 live cell 覆写 → 归档 op 的 relocate 继续（claim 清理因 identity 守卫不误删新 live cell ✓）→ 主键被 remove 而 live entry 仍在——「归档 ⟹ 无有效 handle」前置（phase:63）被测试缝击穿。设计 §7 的 lifecycle.ts 改动清单未列 seedForTest。修复：守卫扩为 `reading/creating/archiving` 一律抛（1 行，ALLOW 内）。

### #4 Memory 归档键与主键空间同池碰撞（MEDIUM）

- 事实链：`toKey` = `${userId}\u0000${docId}`（lifecycle.ts:639）；Memory mirror 为单一 `Map<string, StoredSnapshot>`（memory.ts:65），**无身份文法校验**（对照 file.ts:128-131 `validateIdentity` + `assertSafePathSegment`）；设计 D-10 归档键 = ``archive\u0000${key}``。
- 攻击：直接调用方（`createMemoryPersistence` 是包公共面，ARC/IMP 测试自身即直接调用）执行 `createDoc({userId:'archive'}, 'u-alice\u0000ns-aaa…', doc)` → 主键字符串 = ``archive\u0000u-alice\u0000ns-aaa…`` = (u-alice, ns-aaa…) 的归档槽位。此后任一方向的写都静默覆写另一方向：归档副本被普通 doc 快照覆盖（**INV-4「归档区持有已核对的同一份字节」在 Memory 上可被第三方破坏**），或反之归档写毁掉 'archive' 用户的文档。
- 可达性限定：registry 路径不可达（identity.ts:88-99 最小安全文法拒 U+0000；'archive' 虽是合法 SAFE_PATH_SEGMENT 段，但 `docId='alice\0ns-…'` 过不了文法）。暴露面 = persistence 包直接调用方（测试/未来宿主装配）。既有 mirror 本就有 `('x','y\0z') vs ('x\0y','z')` 二义（前存量），但**本设计新增了一个带保留语义的前缀命名空间进同一池**且未声明。
- 修复方向（修订条件，择一）：① Memory adapter 以独立 `archiveSnapshots: Map` 承载归档区（结构性分区，零碰撞面，~3 行）；② 或 baseIo 的 write/writeArchive/remove 入口拒绝含 `\u0000` 的 userId/docId 段（与 File 的文法守卫对称）。设计文本须记录该碰撞分析与裁决。

### #5 归档 fatal 的判别通道混用（LOW）

§4.8.3：四类拒绝按 `code` 字符串（对 duck-typed stub 必要——已实证 stub 以 `Object.assign(new Error, {code})` 抛，registry-phase5-bootstrap-reset-red.test.ts:279-302），`DocArchiveFatalError` 却按 `instanceof`（镜像 create DQ-6）。后果：第三方 Adapter 若 duck-type 其 fatal（code 正确、非真实类实例），registry 落入 unknown 分支 → `NamespaceRegistryFatalError('reset','lifecycle-slot-internal', false, cause)`——`relocate-remove` 的 committed:true 事实被改写为 false，违反「committed 事实原样传播」的自身纪律（D-11/INV-12）。SA6 无锚约束此分支（stub 不抛 fatal），修复自由：fatal 判别同样 code-first（`code === 'DOC_ARCHIVE_FATAL'` 时读 `cause.committed`），instanceof 降为双保险。非阻断，建议随修订一并处理。

### #6 importReplica 接纳段未显式规格化（LOW）

§4.8 为 reset 明文「接纳段（公共入口同步段，镜像 open）：acceptance → validateOpenIdentity → carrier FIFO」；§4.2 对 import 直接从槽内 ① 开始。两处依赖该前置：File 侧 `archiveDoc/importDoc` 入口的 `validateIdentity`（SAFE_PATH_SEGMENT）与「invalid 零 Persistence 访问」纪律。补一句冻结即可（镜像 open 同款同步段，含 `validateOpenIdentity` 复用）。

---

## 四、已验证闭合的攻击面（攻击不成立——留档防复审重复劳动）

以下攻击经逐步场景推演**未击穿**设计，且多数预答区论证经独立核实**成立**：

1. **settle 强制 flush 与 flushing 单飞/世代保序**：`startFlush` 直调不经 debounce；flush 首行的 `saved===dirty` 早退在 settle 前置检查（同步无隙）下不可达；失败 → retry 武装 + finally 的 reschedule 分支被 `retryTimer!==undefined` 正确抑制（lifecycle.ts:571）——单一调度源纪律保持；成功 → maybeEvict → clearTimers 清掉残留 debounce/maxDirty（lifecycle.ts:592）无悬挂 timer。settle 内联驱逐（干净零 handle）与 `cell===entry` 的无隙读同理安全。
2. **degraded 被动等待期间新 loadDoc/saveDoc 到达**：等待期间 cell 仍 live，loadDoc 经 fast path 发 handle 合法；新 dirty 由 retry 轮以全量 live doc 捕获；waiter 醒后 settle 重检 `handles.size>0` → `DOC_ARCHIVE_ACTIVE_HANDLE`（§4.5.7 行 5）——诚实拒绝，闭环成立（除 #1 的 dispose 交错外）。
3. **claim 环 ABA**：settle 返回 ⟹ cell 非 live（同步段内不变），外层 `break → cells.set(archiving)` 之间零 await——原子；并发双 archive 经 claim.promise 重评估收敛于 DUPLICATE（前提 #2 修复）。
4. **guard-read→verify→relocate 字节同一性**：verify 解码的 `bytes` 即 `io.read` 返回引用，writeArchive 写回同引用（不重编码）——同实例内无第二写者（archiving claim 排他 + 零 handle + 零 dirty）；跨实例写者属 v1 单进程边界（0006 后果节），设计已在 §4.5.6/§4.8.3 以 DUPLICATE 等拒绝形态处理，诚实。
5. **relocate-remove 双副本收敛**：File rename 原子覆盖 + `fsp.rm force:true` ENOENT 容忍（file.ts:114 先例）→ 重试 archiveDoc 幂等收敛论证成立；Memory `snapshots.delete` 幂等。committed 映射 {guard-read:false, relocate-write:false, relocate-remove:true} 与 observable-channel axiom（lifecycle.ts:15-44）逐点对齐。
6. **reset 编排逐项**（registry.ts 逐行核对）：carrier FIFO 为 `carrier.tail.then(() => runSlot(...))` 链（registry.ts:693-703）——**整槽含全部 await 原子串行**，③ probe await 与 ④ archive 之间无同 key 插槽窗口；强制 release 全同步（lease.ts:100-114：released 标记→leases.delete→observer→onReleased 均同步），release 循环与 cancelIdleArm 之间零 await 声称**成立**（快照迭代防 Set 变异）；closing 分支 await 的 closePromise 只可能由 beginIdleClose 创建（shutdown 创建的 closePromise 在 runShutdown 步骤 2 carrier-tail 等待之后才产生，而 reset 槽本身就在被等待的 tail 上），其 settle 处理器（removeEntryAfterClose）先于本 await 挂接 → 先执行——「③ 假定 entry 已移除」的时序论证**文档化正确**；probe release（同步驱逐）→ archive 之间无 handle 窗口（FIFO 原子）；「并发 open+reset」两序确定（reset 先→open 见 NOT_FOUND；open 先→reset 强制失效其 lease，`lease:'released'` 锚可达）；shutdown 竞态：reset 已删 entry 与 shutdown close 全集交集为空（runShutdown 先 await tails 再枚举 entries），removeOnlySelf 双守卫兜底。
7. **在途 ROOT 写 + reset**：lease release 不取消已接纳写（ADR 0009:42），runtime.close barrier（close.ts:34-55，release 于 barrier 内、close resolve 前完成）排空后 handle 释放（persistence 侧同步驱逐），归档字节含写后值——REG 锚（archives[0] n===7）机制成立。
8. **import 编排**：核对次序（docId 先、事实后）对 SA6 两组用例产出锚定码；② 先于 ③ ⟹ `importCalls===[]`/`loadDoc===null` 零写入锚成立；判据族复刻含 `set(k,undefined)` 键存在性判别与载体异型收编（与 replication-write.ts:213-240 逐条对齐，observable 结果等价——import 侧全部 ok:false、archive 侧全部 mismatch）；Runtime 构造 V2.5 走单一路径、TOCTOU 收编 committed:true fatal（§4.12，镜像 registry.ts:1145-1152）成立。
9. **D-4 optional + ReplicaPersistence**：13 stub 抽查 3 个（registry-create:196 / registry-idle:175 / replication-channels:60——均恰三方法，不触新路径）；`{read,write}` wrapIo 字面量（registry-sa7-phase5-dynamic.test.ts:312）在 optional 下合法；三成员字面量绿守卫保持；R-2 的 `HasArchiveDoc<DocPersistence>` 对 optional 成员求值 never → 回流改锚 `ReplicaPersistence` 后求值 true（签名逐字段结构等价已核对）——**回流必要性/充分性独立证实**；REG 两红锚（required 成员 + 返回联合可赋值性 `{ok:boolean}` / `{ok:false;code:string}`）直接绿。
10. **声明图禁词**：registry-surface.test.ts 审计仅扫 registry 自身 emit 的 d.ts（相对 import 才遍历，包说明符不进入）——`YjsDoc`/`ReplicationIdentityRef`/`DocArchiveOperationalError` 等经 `@nomicore/persistence` 说明符引入**不含**任何禁词 token（`\bY\.Doc\b` 不匹配 `YjsDoc`）；前提 = registry.ts 的 yjs 引用保持实现私有（导出面不得出现 `Y.Doc`），设计已如此约束（§4.2.1 私有读取器）。九值冻结清单零新增值导出 ✓。
11. **零回归 8 条静态论证**：逐条 grep 复核属实（含 `implements DocPersistence` 16 命中 vs 设计称 17——SA8 N'-6 已勘误，不影响论证）；`CreateClaim` 仅 lifecycle.ts 内部 3 处，更名 KeyClaim 零外部引用；fault seam wrap 扩展 writeArchive 并入 write 槽后，既有 armed 位消费者不触归档路径（ARC hold/fail-write 两锚即验收）；flush finally 追加通知在**非归档路径**零 waiter、零观测差异成立（waiter 数组仅 settle 填充）。
12. **R-1 回流必要性独立证实**：ARC Memory 夹具接线 `readSnapshot`（唯一读权威，memory.ts:77 `??` 短路），无 deleteSnapshot 则 remove 对外部 store 必然虚假 no-op → 「成功归档后 loadDoc→null」（ARC:247）与 `store.has(primary)===false`（REG:743）在任何诚实设计下都不可满足——**锚的前置缺口定性正确**，非设计转嫁。
13. **File 归档路径纪律**：主键读路径 tmp 清理（file.ts:114）作用于 `users/{u}/{d}.snapshot.tmp`，与 `archive/` 子树结构性分离 ✓；latest-wins 覆盖（rename 原子）+ 崩溃窗口残留有界 + tmp 永非提交态 ✓；SAFE_PATH_SEGMENT 双段在归档路径解析复用（§4.9 与 file.ts:133-143 同构）✓；「模块纪律 rootDir 外零新增」由布局结构性满足 ✓。
14. **协议假设依据（§8）审查**：章节在场；四条假设依据类型与内容可验证——`fsp.rename` 同子树原子性（file.ts:118-126 既有生产行为）、TS 可赋值性（锚文本已核对）、fault seam write 槽可覆盖（testing.ts:731-772 已核对，wrap 现仅拦 `{read,write}`，扩展在 ALLOW）、`fsp.rm force:true` ENOENT 容忍（Node 文档 + file.ts:114 先例）。无「应该/预计」类无据推断。✅
15. **错误处理链路审查（技能立法）**：静默失败——三处 loud gate（Registry typeof gate → fatal；lifecycle io gate → bare Error；Memory 缺 deleteSnapshot → loud 拒绝）均为真实降级路径的正确形态（条件在正常流程可缺省成立时确实应为配置缺陷，非伪降级）；被淘汰方案 (a')（remove 内联吞错为 resolve）的否决正确。状态闭环——四分类 + fatal committed 映射覆盖全部失败通道（除 #2 的 cell 善后与 #1 的挂起外无缺口）。降级路径——degraded-dirty 诚实 pending、不绕过 retry（N-5 逐字满足）。用户可感知性——稳定 code/message 全通道。**唯一违反「诚实失败」的是 #1（设计文本声称的防御不存在）与 #2（未承诺的善后被绿转论证依赖）。**

---

## 五、SA1 修订必须满足的逐条条件（reject 解除条件）

1. **[对应 #1]** §4.5.2/§7 增补并冻结：① `dispose()` 同步段对每个 live entry 执行 `archiveWaiters` 的 splice-通知（含清理）；② flush finally 的通知语句固定为无条件置于 finally **首位**（先于 `isCurrent(epoch)` 早退），并更正「先于早退、在 maybeEvict 之后」的矛盾表述；③ settle 等待期纳入 inFlight/track 记账（dispose 排空覆盖归档全程）。修订后给出「degraded retry 武装 + 零在途 flush + dispose」交错下 archiveDoc 必然结算的逐步论证。
2. **[对应 #2]** §4.5.3/§4.5.6 明文 archiving claim 的**失败路径**清理：op 闭包 try/catch 全包，catch 与成功末尾同款执行 `cells.get(key) 仍为本 claim 才删`（镜像 lifecycle.ts:263-268），rethrow 原拒绝；§4.5.6 矩阵每行补 archiving cell 善后状态。
3. **[对应 #3]** §7 lifecycle.ts 清单补 `seedForTest` 守卫扩展（`archiving` 一律抛 idle-key 错）。
4. **[对应 #4]** §4.10 就 ``archive\0{primaryKey}`` 与主键空间的碰撞给出显式裁决并落地：Memory 归档区独立 Map 分区（推荐）或 baseIo 入口 `\u0000` 段拒绝；设计文本记录分析。
5. **[对应 #5/#6，建议随修]** fatal 判别改 code-first（committed 事实不因 duck-typing 丢失）；importReplica 接纳段（acceptance + validateOpenIdentity 同步段）补一句冻结。

修订只需触及上述条目；D-1/D-2/D-6/D-7/D-8/D-9/D-11/D-12/D-13/D-14 及全部预答区论证**无需改动**（本报告 §四 已逐项验证闭合）。

---

## 六、红灯测试思路（供 SA4/SA6 后续锚定参考）

1. **[=#1] dispose 解除 settle 挂起**：fake scheduler；`failNextWrite` 制造 degraded（retry 武装、零 handle）→ 发起 `archiveDoc`（不 await）→ 微任务推进确认进入被动等待 → `dispose()` → 断言 `archiveDoc` promise 在有限微任务内 reject（bare disposed 或 fatal guard-read），且 `dispose()` 与 registry `shutdown()` 均不挂起（`Promise.race` + 超时护栏形态，沿 ARC hold 用例的 race 判定先例）。
2. **[=#2] 归档失败不毒化 key**：identity-mismatch 归档拒绝后，同 key `loadDoc` 有限时间内返回非 null（ARC 现存 5 用例即此锚——SA3 落地后若泄漏将以 vitest 超时红显形；建议补一条显式「拒绝后再 createDoc 得 DOC_DUPLICATE 而非挂起」）。
3. **[=#3] seedForTest × archiving**：fault seam `holdNextWriteBeforeCommit` 钳住归档提交段 → 期间 `seedForTest` 同 key → 断言抛 'test seed requires an idle key cell' 而非静默覆写。
4. **[=#4] Memory 归档键碰撞**：`createMemoryPersistence`（无 hook）→ `createDoc({userId:'archive'}, 'u-alice\u0000ns-x', docA)` → `archiveDoc(u-alice, ns-x, …)` 成功后断言 loadDoc('archive','u-alice\0ns-x') 仍返回 docA 原内容（分区实现下成立；同池实现下红）。
5. **[=#5] duck-typed fatal 的 committed 传播**：stub 抛 `Object.assign(new Error, {code:'DOC_ARCHIVE_FATAL', phase:'relocate-remove', committed:true})` → 断言 registry fatal 的 `committed === true`。

---

## 七、结论

**verdict: reject。** 阻断项 2 个（#1 settle×dispose 永久挂起——liveness + 设计自证防御缺位；#2 archiving claim 失败善后缺规格——5 个 ARC 锚机械红 + key 永久毒化 + INV-6 在真实 persistence 下不成立）。修订面窄（§三 条件 1-4 必须、5 建议），核心架构裁决（optional+派生接口、settle→claim→guard→verify→relocate、Registry 纯传递、carrier FIFO 编排、File/Memory 布局、词表 append-only、R-1/R-2 回流）经独立攻击推演全部站得住——预答区 12 条预判攻击中 10 条论证属实，未被预答覆盖的正是 #1/#2 两个真实缺口。
