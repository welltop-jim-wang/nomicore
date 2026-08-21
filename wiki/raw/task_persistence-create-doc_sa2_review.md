# SA2 攻击评审报告

**Date**: 2026-08-21（R1）｜ 2026-08-21（R2 重审）｜ 2026-08-21（R3 增量重审，见文末「R3 增量重审评审节」）
**Verdict**: R1 = reject（#1 CRITICAL、#2 HIGH）→ R2 = reject（窄幅：仅 R2-1 门禁；R1 六点核验为已封死）→ **R3 = pass（R2-1/R2-2/R2-3 全部核验落实，增量重审通过）**

**被审对象**: `wiki/raw/task_persistence-create-doc_design.md`（SA1 设计，issue #64）
**审查基准**: 任务简报 + SA6 红灯套件源码（`packages/persistence/src/testing.ts`，逐行精读）+ 现行实现（`src/memory.ts`、`src/index.ts`、三个测试文件）+ ADR 基准（`_relevant_decisions.md` 摘录，含 SA8 追加的设计新决策点节）+ 前置/设计后两份冲突报告（`conflict`→C1/C2 放行；`clear` + 备注 2 移交本审）。

**审查方法**: 以全新视角对设计 §4/§6/§7 的状态机与伪代码做了逐用例（10 条红灯 + 25 条绿灯含 5 条 dispose 竞态）的微任务级推演；对关键外部行为假设做了实测验证（见文末验证证据）。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议修订 |
|---|--------|--------|---------|---------|
| 1 | **CRITICAL** | supersede × eviction 生命周期交互（§4.3/§6/§7 未定义） | 被取代读的 fallback 分支以「create 已失败」为唯一前提设计（§7 注释原文），漏掉了「create 胜出后 entry 被 evict」这一合法可达态，派生三个缺陷：(a) **假 null**——create 胜出→调用方 release create handle（clean entry 立即 evict，cell 回 empty）→被取代读稍后 settle→driver 走 fallback 用**先于 create 写入的过期读证据**（undefined）返回 null，而 store 此刻已有 create 提交的内容：直接违反简报 Required semantics「create 取得创建权后 load 不得错误返回 null」；(b) **静默旧内容复活 + 无告警的数据丢失**——同链路但读返回的是被 create 覆盖**前**的旧快照：fallback 把旧快照 restore 成 live entry（§4.3 规则 3 声称「结果被丢弃」，§7 伪代码却恢复——规格自相矛盾），造成 cache=旧/store=新 撕裂；后续 saveDoc→flush 将以旧内容**静默覆盖** create 刚提交的新内容，且 live 分支的 lost-update 告警在 fallback 路径**不触发**——违反 §4.3「不静默」与 §12「响亮告警」承诺，也击穿 C1「绝不覆盖已提交内容」的核心语义；(c) **ghost handle**——driver `return cell.entry`/`resolveLoad` 返回与 waiter `issueHandle` 之间存在 await 边界（现行 `loadDoc` 的 cache 命中路径是**同步**签发、无此窗口；设计的 `resolveLoad` 恒 async 引入了新窗口），间隙内 create handle 被 release→evict→`doc.destroy()`→waiter 签发指向已销毁 doc 的 handle，违反 U3 | ① fallback 分支必须区分「被取代且 create 已胜出」：不得信任先于 create 写入的读证据，改为丢弃证据重新 `resolveLoad`（create 已提交 ⇒ store 必有内容），且被丢弃的非空证据在该分支**同样 loud 告警**；或等价机制——被取代读 in-flight 期间 pin 住 created entry 不可 evict。② 任何 handle 签发必须与「cell 仍持有该 entry」的所有权验证处于同一微任务（复验失败则重走 resolveLoad），消除 (c)。③ §4.3 规则 3 的「结果被丢弃」与 fallback 行为统一 |
| 2 | **HIGH** | §4.3 规则 1 与 §7 伪代码矛盾；§12 ADR 草案「绝不覆盖」绝对化 | ① §4.3 规则 1 称 create 成功后 load waiter「**立即**采纳 created live entry……不等 read settle」，但 §7 driver 的第一行是无条件 `await read.rawPromise`——按伪代码，采纳只能发生在 read settle 之后，两处规格相反；SA3 无所适从，且该不一致正是 #1(a)(c) 的温床（若按 §4.3 字面实现——claimResolve 时同步采纳并签发——#1(a)(c) 自动消失）。② §12 将逐字落进 ADR 的文本 bullet 1 写「cache/store 已存在或并发创建 → 拒绝 ……**绝不覆盖已提交内容**」（绝对化），bullet 4 又定义了可覆盖既有提交的 supersede 路径且告警只是事后检测而非防护——未来任务按本仓惯例拿 ADR 条款当契约基准时必然被 bullet 1 误导（SA8 备注 2 判「自洽」过于乐观；且 bullet 4 的告警承诺在 #1(b) 路径不成立） | ① 二选一并写明：采纳时机 = read settle 后经 driver（伪代码现状，需删去 §4.3「不等 read settle」表述并如实披露 hung-read 下 waiter 不返回），或 = claimResolve 同步采纳（推荐，与 #1 修法一致）。② §12 bullet 1 改为限定式（「在 duplicate 判定路径上绝不覆盖」），bullet 4 显式注明该窗口可覆盖既有提交、告警是检测非防护；修订须在 #1(b) 修复后使告警承诺真正全覆盖 |
| 3 | **MEDIUM** | restore 校验失败后的 cell 残留（§7 driver 经典路由） | driver 对 READ_ERR / undefined / dispose 三种结局都清 cell，唯独 `restoreAndValidate` 抛错（META.docId 损坏）时 cell 残留 `reading` 态（ticket 已 settle、completion 已 reject）。后续 loadDoc 将永远 await 已 reject 的 completion、**重放缓存的 rejection**；现行实现（loading promise settle 后即从 map 删除）下次 load 会**重读 store**——瞬时损坏可自愈的行为回归，25 绿灯与 10 红灯均测不到 | 该分支补 `this.cells.delete(key)` 再 throw，与 READ_ERR 处理对齐；§8 失败清单补一行「store 快照校验失败（load 侧）」 |
| 4 | **MEDIUM** | IO seam 草图丢失现行 `writeSnapshot` 的 isCurrent 守卫；`status='ready'` 迁移落点未指明（§5.2/§5.3） | 现行 `writeSnapshot`（memory.ts:253-258）结构为「options 写 → `isCurrent(epoch)` 守卫 → `snapshots.set` → `status='ready'`」。§5.3 的 io.write 闭包无条件 `snapshots.set`（epoch 过期/abort 后仍写，dispose 已 `clear()` 的私有 map 被复活——对 memory 不可观测，但对 #58 的 temp→rename 提交点意味着「abort 后仍可能完成提交，而 createDoc 已以 disposed 拒绝」的幽灵提交）；同时 `status='ready'`（degraded→ready 恢复的唯一通道，绿灯 memory-persistence.test.ts:307-309 锚定）的迁移落点完全未规定——放 io 闭包会在 abort 后把 disposed 覆写回 ready（绿灯 :471/:492 红），漏放则 degraded 永不恢复（绿灯 :307-309 红） | §5.3/§5.2 明示：`status='ready'` 移入 core flush 的 `isCurrent` 守卫之后（与守卫前置于 io 调用的现行语义等价）；IO seam 契约追加「`signal.aborted` 已置位时实现不得执行提交段（memory：私有 set；#58：rename）」，替代被拆掉的 isCurrent 守卫 |
| 5 | **LOW** | superseded read 以 I/O 错误 settle 时被完全吞掉（§7 live 分支） | driver 采纳 created entry 时对 READ_ERR 既不告警也不记录——I/O 故障零观测，与 §4.3「不静默」精神不一致（操作本身成功，无正确性影响） | 补一条 debug/error 级日志，或在 §4.3 明示「读错误在 create 已胜出后视为无关噪声、刻意不记录」的设计决策 |
| 6 | **LOW** | entries Map → cells Map 的「逐字搬移」适配点未点名（§5.3 迁移纪律） | `saveDoc` 的 `this.entries.get(key)`、`maybeEvict` 的 `entries.delete`、release/flush 终态对 entry 的寻址，在数据结构替换后都需改为 live-cell 查询/清理；纪律只说「逐字搬移」而不列这些改写点，SA3 需自行推断，易在 creating/reading 态的 handle 校验上引入语义偏移 | 迁移纪律补一条显式映射清单（entry 寻址 → `cells.get(key)?.state==='live'` 等），并注明 creating/reading 态下 handle 校验应维持「foreign or released」行为 |

### 通过项核对（已验证、无需修改）

1. **C1/C2 演进引用与 §12 落地形式**：与前置/设计后冲突报告逐字一致，未越放行范围；本审无新增 ADR 冲突（SA8 二审已覆盖，抽检认可）。
2. **§3.1 死锁穷举的契约复算**：亲测确认用例 5 的门控形态（`releaseRead` 每次调用重赋值、测试仅在 create 之后释放一次、`await createDoc` 无超时守卫）——「等待读」「abort 后重读」两策略确为测试挂死，「supersede 不查 store」是契约强制的唯一 adapter 无关解。设计的推演成立。
3. **10 条红灯用例的算法路径逐条微任务级推演**：按 §6/§7 伪代码推演用例 1-10（含 FIFO continuation 序、fake timer 2/3 微任务排空预算、`tick()` 3 跳内到达 io.write 的预算）全部可过；红灯基线亲测复现（14 failed / 25 passed，与 SA6/SA1 记录逐条一致）。CRITICAL #1 位于套件覆盖之外的交互，SA7 动态验证也抓不到，只能在设计层修。
4. **§16 caller 审计**：行号引用逐条核对无误（index.ts:17/30-31、memory.ts:31/51/338、contract test:19-26）；`git grep -rn "nomicore/persistence"` 排除包自身后零命中（亲测）；stub 补桩方案正确。
5. **§5.3 seedForTest 对 reading/creating cell 的 loud throw**、**create 失败不进 degraded/retry**：符合「拒绝虚假降级」立法，改进正确。
6. **Yjs `getMap` 无副作用**（实测见文末）：`validateCreateDoc` 在调用方 bare doc 上调 `doc.getMap('META').get('docId')` 不产生 state 变更/update 事件/根注册——失败路径不静默污染调用方 doc，§15 第 1 行依据成立且比设计引用更强。
7. **disposed 错误消息改名安全**：既有测试全部断言 `/disposed/` 正则（grep 核对），'persistence is disposed' 替换安全。
8. **DocDuplicateError 可枚举自有属性**：tsconfig target ES2022（useDefineForClassFields 默认 true），类字段初始化即自有可枚举属性，`toMatchObject({code})` 与 instanceof 双锚定成立。

---

## 协议假设依据审查

**§15 章节存在** ✓（本任务无 HTTP/WS/端口假设，设计主动列出了 6 条库行为/调度假设）。

- **依据可验证性**：逐条核对——`src/memory.ts:176`、`memory-persistence.test.ts:164-167/349-365/383-494`、`testing.ts:496-499` 引用行号全部准确；红灯复现命令+输出已贴且本人重跑一致；「实测验证」类声称均附命令。
- **无「应该/通常/预计」类无据推断** ✓；最弱的一行（FIFO continuation 序）设计自带无害兜底论证（claim 为同步 check-then-set，序互换仍恰一成功）——论证成立。
- **SA2 增强验证**：对 Yjs `getMap` 副作用假设做了套件外实测（结论：无副作用，见文末），依据链闭合。
- **结论：协议假设门禁通过**。

## 错误处理链路审查

- **静默失败**：create 全部失败路径以 rejection 收束（§8 清单核对无误）；两处例外——superseded read 的 READ_ERR 静默吞（#5，LOW）、stale 复活路径静默（#1b，CRITICAL）。
- **状态闭环**：disposed/degraded/META/duplicate/io 五类错误态均响亮且可区分（code/消息锚定）；破口 = restore 校验失败后 cell 残留（#3）。
- **降级路径**：依赖不可用（I/O 挂/错）→ 原始错误原样上抛，无掩盖；degraded 语义边界（flush 专属）被正确保持，未被 create 失败滥用。
- **用户可感知性**：duplicate 有专用类型+稳定错误码（无需解析 message），其余错误带上下文消息 ✓。
- **虚假降级识别**：**未发现**伪降级——设计显式拒绝了两处常见伪降级（seedForTest 撞协调态 loud throw；lost-update 走告警而非 degraded）；但 #1(b) 的静默数据丢失是比伪降级更严重的「静默正确性破坏」，已列 CRITICAL。

## 红线测试思路（每漏洞对应，供 SA3/SA6/SA7 落地）

1. **#1(a) 假 null**：`store.read` 门控永不 release；`loadDoc(K)` 启动读 → `createDoc(K, NEW)` 胜出 → **立即 `await createdHandle.release()`**（触发 clean entry evict）→ release 门控（resolve undefined）→ `await withTimeout(loading)`：断言 loaded 非 null 且 `loaded.doc` 内容 === create 提交内容（现设计：返回 null → 红）。
2. **#1(b) 静默复活**：先建立 OLD 提交（create+release，store=OLD）→ `loadDoc(K)` 门控读挂起（将返回 OLD 快照）→ `createDoc(K, NEW)` 胜出 → 立即 release created handle → releaseRead(OLD 快照) → 断言：load 得到的 doc 内容 === **NEW**（现设计：还原 OLD → 红）；同时 spy `console.error` 断言 lost-update 告警被触发（现设计：fallback 无告警 → 红）。
3. **#1(c) ghost handle**：门控 releaseRead；create 胜出后、releaseRead 之前 release created handle；再 releaseRead → 断言 `loaded.doc.isDestroyed === false` 且 saveDoc(loaded) 可用（现设计：可能签发 destroyed doc 的 handle → 红）。
4. **#2 一致性**：门控读 + create 胜出 + **不** release 门控：`await withTimeout(loading, 2000)`——按 §4.3 字面实现应绿；按 §7 伪代码实现将挂起→红。此测试强制 SA1 在两种规格中二选一。
5. **#3 缓存 rejection 重放**：`readSnapshot` 首次返回 META.docId 损坏快照、第二次返回好快照；第一次 `loadDoc` rejects `/META\.docId/`；断言第二次同实例 `loadDoc` **成功**（现设计：重放缓存 rejection → 红；现行实现绿）。
6. **#4 守卫/落点回归**（现有绿灯即锚，保持绿即可）：degraded→ready 恢复（:307-309）、dispose-during-flush 后 status 仍 disposed（:471/:492）；#58 专测补充思路——dispose 竞态中 io.write 在 abort 后 resolve 且已完成提交段 → 断言目标文件/store 未被写入（幽灵提交检测）。
7. **#5**：spy console，断言 superseded READ_ERR settle 时有日志输出（或设计明示豁免后删除该断言）。
8. **#6**：纯设计文档修订项，无测试。

---

## 复审要求（reject 条件解除）

SA1 须修订设计文档解决 #1（CRITICAL）与 #2（HIGH）——二者同根（supersede 采纳时机与 eviction 交互未定义），建议一并重写 §4.3/§7 的 supersede 小节并在 §12 同步；#3/#4 建议随轮修订（各为单一明确改动）；#5/#6 可接受「承认并给出明示决策」的处置。修订后本审按更新稿重审 #1/#2 相关章节。

## 验证证据（SA2 亲测，可重跑）

1. 红灯基线复现：`node_modules/.bin/vitest run packages/persistence/test/memory-persistence.test.ts packages/persistence/test/persistence-contract.test.ts` → `Test Files 2 failed (2) / Tests 14 failed | 25 passed (39)`，与 SA6 记录及设计 §2 逐条一致（13× createDoc is not a function + 1× expected 'undefined' to be 'function'）。
2. 外部消费面：`git grep -rn "nomicore/persistence" -- '*.ts' '*.json'`（排除包自身与 node_modules）→ 零命中，设计 §2 声称属实。
3. Yjs 副作用实测（yjs@13.6.32，pnpm store）：bare doc 上 `getMap('META').get('docId')` → state 字节 2→2 不变、update 事件 0 次、后续编码不含 META 根 → `validateCreateDoc` 对调用方 doc 无副作用。
4. 编译面：`tsconfig.base.json` target ES2022 + strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes（设计 §6 实现注意的约束前提成立）；`docs/adr/0006-server-persistence-docstore.md` 当前确为演进前文本（L18 `readonly user`、L35 创建=首个 saveDoc、L104 v1 限制），与 SA8 备注 1 一致。
5. 错误消息锚定：grep 全部 disposed 断言均为 `/disposed/` 正则，消息改名安全。

---
---

# R2 重审评审节（2026-08-21）

**被审对象**: `task_persistence-create-doc_design.md` R2 版（922 行，修订声明见其 §17）
**重审范围**: ①R1-CRITICAL #1 三派生缺陷是否真正封死（对新机制做微任务级攻击推演）；②R1-HIGH #2 规格矛盾；③R1-MEDIUM #3/#4、LOW #5/#6 处置；④SA1 自检声称修复的自环死锁。
**重审方法**: 精读 R2 全文；以 R1 红线测试 1–4 的攻击构造（5a/5c 驱逐链、多 waiter、U7 误报搜索、stale-ticket-to-null 路径搜索、分支标志竞态、双 supersede、hung read）对 §6/§7 新伪代码逐条推演；行号引用以 grep 复核。

## R2 Verdict: **reject（窄幅）**

R1 全部六个攻击点核验为**已真实封死**（见下「R1 处置核验」），SA1 的「create 胜出收尾块同步采纳」修法在微任务级推演下成立。但 R2 重构使 `claim.promise` 的 settlement 成为两条活性路径（§7 L537 resolveLoad creating 分支、L558 driver 分支 B）的唯一依赖，而 §6 伪代码对该机制存在**双重表述**（未定义符号 `claimResolve()` @L470 与 `claim.promise = op.then(…)` 派生式 @L485 并存，失败路径无任何 claim 结算），错误读法的实现后果是**被取代 load waiter 的永久挂起**——此项门禁（R2-1，MEDIUM）；另有 1 LOW + 1 NIT 随轮修订。修复成本极低（一段不变式 + 删一个符号），下轮为**增量重审**（只看 R2-1/R2-2/R2-3 的修订段落）。

## R1 处置核验（六点逐条，全部通过）

### ① CRITICAL #1（supersede × eviction 三派生缺陷）——✅ 封死（微任务级攻击推演）

新机制：ReadTicket 增 deferred（`settleOnce/rejectOnce` 恰一次互斥）+ `supersededBy` 反向引用 + `adoptedByCreate/adoptedEntry`；create 胜出收尾块（§6 L462-471）在同一同步块内完成 `cells.set(live)` → `settleOnce(entry)`（采纳，先于 claim settle，I5）→ `issueHandle`（I6）。攻击推演结论：

- **(a) 假 null**：采纳使 waiter 在 read settle 之前就拿到 entry；若采纳后、签发复验前 entry 被 evict（create handle 被 release、clean entry 即刻驱逐），waiter 的复验失败 → 重走 resolveLoad → **新读发生在 create 提交之后** ⇒ 必得 create 提交内容 ⇒ 非 null。构造「重读得 null」的全部路径搜索（stale ticket 复用 / U7 误报）均不可达：重读 ticket 只能在驱逐后（即提交后）启动，其证据必然新鲜；restore 路径的 entry 在签发前无 handle、无 evict 触发点，不会进复验循环。U7（sawEntry 跨轮 loud 守卫）把「单进程内不可达」的丢内容变为 integrity 错误而非静默 null——首层防护机制性消除，残余层防护响亮。✅
- **(b) 静默旧内容复活**：证据路由 `routeEvidence` 从构造上仅在 **create 失败**分支可达（分支 B 定局失败且未复得 cell 所有权）；create 胜出后被取代 ticket 恒走分支 A/B-胜出 → `observeLateReadOutcome` 仅观测（快照 → lost-update console.error；READ_ERR → console.warn），**证据永不进入 restore**。晚到非空快照在胜出后的全部路径（分支 A 与分支 B-胜出）都触发告警——R1「fallback 无告警」缺口随 fallback 本身的不可达而消失。cache=旧/store=新 的撕裂链不再存在。✅
- **(c) ghost handle**：`loadDoc` 恢复**同步快路径**（live cell 直接签发，与现行逐字一致，消除了 R1 版「恒 async resolveLoad」引入的新窗口）；慢路径 `loadSlowPath` 的「cell 复验 → issueHandle」在同一同步块（I6，§7 L524-527 连续同步语句）；create 自身签发与 `cells.set` 同块。多 waiter 采纳（均经 completion 得同一 entry）+ 驱逐 + 各自复验的交错推演：先复验者触发重读注册 E2，后复验者 resolveLoad 命中 live(E2) 或 reading(T2) 合流，单一重读、同实例签发。✅
- 附带核验：双 supersede 不可达（第二个 create 见 creating 即拒，I3）；`adoptedByCreate` 在 driver 两次检查之间被置位的竞态收敛于 `await claim.promise` 后的复检（claim settle 晚于采纳置位，I5）；hung read 下 waiter 照常返回（5d 判定性测试成立）；分支 A 无法抛错（观测不 throw、`adoptedEntry` 与标志同块置位），completion 无双重结算风险（deferred 互斥 + driver 返回值仅对称）。

**唯一保留意见**：上述全部结论以「claim.promise 在 op 成败两态均 settle」为前提——该前提在 R2 文本中是隐式的，见 R2-1。

### ② HIGH #2（规格矛盾 + ADR 绝对化）——✅ 消除

- §4.3 规则 1（「收尾块内 settleOnce……不等 read settle」）与 §7 分支 A/B 伪代码**逐字一致**（采纳出口 = 收尾块；read settle 后仅观测）；§4.4 用例 5/5d 与 §3.2 表述同步。R1 的两处相反规格不复存在。✅
- §0 C1 与 §12 bullet 1 均改为限定式「**在 duplicate 判定路径上**（cache 命中 / store 存在性读见快照 / 并发 claim）绝不覆盖——三条判定都在写路径之前」；§12 bullet 4 显式「已知代价：该窗口内 create 可覆盖既有提交……loud 告警是事后检测而非防护，覆盖被取代读晚到返回既有快照的全部路径」——告警承诺在 #1(b) 封死后**机制上为真**（胜出后晚到非空快照全路径触发；失败路径未覆盖、无需告警）。ADR 落地文本不再含自相矛盾的绝对化条款。✅

### ③ MEDIUM #3 / #4，LOW #5 / #6——✅ 全部处置到位

- **#3**：`ownerRoute` 以 try/catch 包裹 `restoreAndValidate`，失败先 `cells.delete` 再 throw（§7 L586-588）；§8 补「load 侧失败路径」表。行为回归消除：下次 load 重读 store，瞬时损坏可自愈，与现行 loading-Promise-settle-即删语义等价。✅
- **#4**：§5.2 新增「提交段原子性」seam 承诺（memory 侧即 §5.3 草图 L358-360 的 `if (signal.aborted) return` 早退，置 `snapshots.set` 之前——**守卫位置与现行 writeSnapshot 的 isCurrent 检查同位**）；`status='ready'` 落点明示（core flush 成功路径、isCurrent 守卫之后）并绑定 :307-309/:471/:492 三条绿灯；「失败 io.write 保持 store 不变」入 seam 承诺（§4.3 规则 2 前提成立——memory 闭包 throw 时不触私有 set，#58 temp→rename 天然满足）；§15 补 aborted⟺epoch 等价行（已对照 memory.ts:136-139 核实为同一同步块）。✅
- **#5**：`observeLateReadOutcome` 对 READ_ERR 记 `console.warn`（明示设计决策：观测不阻断）。✅
- **#6**：§5.3 迁移纪律 5 给出 entries→cells 显式改写点清单（saveDoc live-cell 寻址、maybeEvict 条件删除、dispose 遍历、assertOwnedHandle 不依赖 cell、writeSnapshot 拆解落点逐项）。✅

### ④ 自环死锁自检修复——✅ 真实且正确

R2 初稿缺陷（分支 B 失败后无条件 routeEvidence → resolveLoad 见「恢复的 reading(本 ticket)」→ `await cell.read.completion` = await 自己 → 死锁）的修复（所有权复验：复得 → `ownerRoute`）经推演**真实有效**，且两种时序配对严密：

- **回滚恢复 reading 的前提**是 `!isSettled(rawPromise)`（§6 L476）——此刻 driver 仍停在第一个 `await read.rawPromise`（分支未判定）；read settle 后 driver 醒来 → 分支 B → `await claim.promise`（失败已定）→ 复验见 `reading(本 ticket)` → `ownerRoute` **同步经典路由**（不经过 completion）→ driver 返回 → deferred 结算。无自 await。✅
- **driver 已进入分支 B** 的前提是 rawPromise 已 settle——此刻回滚的 isSettled 为真 → 走 `cells.delete`（empty）→ 复验失败 → `routeEvidence` → 其委托的 `resolveLoad` 所见 cell **不可能**是本 ticket（本 ticket 的 cell 已被删）→ 无自环。✅

两种配对互斥且完备（driver 位置与 isSettled 判定由同一事实——rawPromise 是否 settle——决定），设计在两处（§7 L563-571 与防死锁自证段）表述一致。

## R2 新攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议修订 |
|---|--------|--------|---------|---------|
| R2-1 | **MEDIUM（门禁）** | §6 claim 结算机制双重表述——R2 新活性支柱的规格内缺陷 | `claimResolve()`（L470，try 块内调用）是**未定义符号**（§4.1 `CreateClaim` 只有 `promise` 字段，无 deferred），而 L485 `claim.promise = op.then(() => undefined, () => undefined)` 是唯一的结算接线；**失败路径（catch L473-483）无任何 claim 结算动作**。两种读法：(a) 派生式（op.then 双 handler）——成败两态均 settle，正确；(b) 字面显式 deferred（SA3 为 L470 补一个只在 try 块 resolve 的 deferred）——**create 失败时 claim.promise 永不 settle**。R2 重构后 claim settlement 是两条路径的唯一活栓：§7 L537（resolveLoad creating 分支 `await cell.claim.promise`——rollback 前 parked 的 load）与 L558（driver 分支 B `await claim.promise`）。读法 (b) 的后果链：create supersede → io.write 失败 → op 拒绝但 claim.promise 悬置 → 分支 B 的 driver 永久 parked → 该 ticket 的 completion 永不结算 → **全部被取代 load waiter 永久挂起**（静默活性丢失，劣于崩溃；红灯套件不覆盖——用例 5 只有成功路径）。触发条件：supersede + create 写失败 + SA3 采用读法 (b)。设计自身依据偏向 (a)（防死锁自证「claim 由 io.write 的 settle 驱动」、§4.1 类型形状），但 §6 头部宣称「SA3 按此实现」而含未定义符号，属规范性伪代码缺陷 | 二选一：删除 L470 的 `claimResolve()`（采纳 L485 派生式为唯一机制），或定义 `CreateClaim.resolve` deferred 并在 **catch 块同样结算**；无论哪种，将性质升格为显式不变式（与 I2 对偶）：「**U8：claim.promise 在 op 成败两态均 settle（失败路径不得遗漏结算）——它是 §7 L537/L558 两处 await 的活性前提**」，并在防死锁自证段引用 |
| R2-2 | LOW | §4.3 lost-update 窗口可达性表述不完整（披露完整性） | §4.3 称窗口「触发前提是**调用方自己**对同一 key 同时发起 load 与 create」。R2 新增的 `loadSlowPath` 复验循环（L528-529）使 **core 自身成为 load 发起方**：create#1 胜出→驱逐→waiter 复验重读 in-flight 期间，调用方的 create#2 supersede 该**内部重读** → 覆盖窗口打开，而调用方并未显式并发 load+create（其 create#2 与一个「正在等待 create#1 结果的 load」竞争）。窗口仍已被披露 + 告警覆盖（分支 A 晚到非空快照必响），**无新的静默路径**，但可达性归因表述过窄，上层调用方指引（§13）若按字面执行仍可能踩中 | §4.3 可达性小节与 §13 契约提示各补一句：被取代的 load 可能是持久层内部复验重读（不只是调用方显式 loadDoc），故「create 与任何 in-flight load（含内部）并发」都属反模式——指引保持「先 create、duplicate 再 load，且不与未决 load 并发」 |
| R2-3 | NIT | TS 草图精度（两处，SA3 typecheck 必撞） | (i) §5.3 io.read 闭包 `(key, signal) => options.readSnapshot?.(key, signal) ?? snapshots.get(key)?.snapshot` 在无 hook 时返回裸 `Uint8Array \| undefined`，不满足 `PersistenceIO.read` 的 `Promise<…>` 返回类型（SA3 需 `Promise.resolve` 包裹或闭包 async 化；**read 路径**加一跳预算安全——tick/withTimeout 守卫充足，且 §11 同深约束只约束 flush/write 路径）；(ii) §7 `loadDoc` 同步快路径 `return this.issueHandle(cached.entry)` 从 `Promise<DocHandle \| null>` 方法返回裸值（需 loadDoc 为 async 或包 `Promise.resolve`——现行 loadDoc 即 async，保持即可） | §5.3/§7 草图各补一处类型自洽写法（或加一行实现注意），注明 read 侧包裹不违反 §11 同深约束（该约束的适用范围 = write/flush 链） |

## R2 红线测试思路（新增项）

1. **R2-1（活性钉）**：门控 `store.read`（挂起被取代读）→ `loadDoc(K)` 启动 → `store.write = throw` → `createDoc(K)` 失败（拒绝断言）→ release 门控 → `await withTimeout(loading, 2000, 'superseded load must settle after create failure')`——断言 loading 以**真实结局** settle（null / 快照还原 / I/O 错误均可，视门控释放值）。读法 (b) 的实现下该测试**挂起转超时红**；读法 (a) 绿。此测试同时钉住 resolveLoad creating 分支的失败收束，建议随 SA3 落地进共享套件外围（与 SA6 协调归属）。
2. **R2-2**：无需新测试（披露性修订；现有 5b 告警断言已覆盖机制面）。
3. **R2-3**：`pnpm typecheck` 即钉（TS 编译器强制）。

## R2 结论

- R1 六点：全部核验为已修复且修法正确（①的封死经微任务级攻击推演，④的自环修复经双时序配对验证）。
- R2 门禁：仅 **R2-1**（claim 结算双重表述 + 失败路径活性前提未立不变式）——MEDIUM，但后果为永久挂起且位于 R2 新构筑的活性支柱上，规范性伪代码（「SA3 按此实现」+ 未定义符号）必须先自洽。R2-2/R2-3 随轮修订，不独立门禁。
- 下轮预期：**增量重审**——SA1 仅需修订 §6（claim 结算机制唯一化 + U8 不变式 + 防死锁自证补引）、§4.3/§13（各一句）、§5.3/§7（类型自洽），其余章节维持；R2 已核验通过的结论不重开。

## R2 验证证据

1. R2 设计全文精读 + 关键行号 grep 复核：`claimResolve` 全文仅 L470 一处（调用点）、无声明；`claim.promise` 赋值仅 L453（`undefined!` 占位）与 L485（op.then 派生）两处；`await claim.promise`/`await cell.claim.promise` 各一处（L558/L537）——R2-1 的行号与双重表述引用准确。
2. R1 验证证据（红灯基线、grep、yjs 实测、tsconfig、ADR 文本）在本轮全部复用有效——R2 未触碰测试文件与生产代码（`git status`：仅 SA6 三测试文件为既有修改 + wiki 文档增改，无代码新改动）。
3. ④自环修复验证依据：§6 L476 `isSettled(supersededRead.rawPromise)` 判定与 §7 driver 第一个 `await read.rawPromise`（L549）的语义耦合——回滚恢复 reading ⟺ driver 尚未过首个 await，配对互斥完备（纯逻辑推演，无需运行时）。

---
---

# R3 增量重审评审节（2026-08-21）

**被审对象**: `task_persistence-create-doc_design.md` R3 版（950 行；修订声明：仅动 §4.3/§5.3/§6/§7（防死锁段与 loadDoc 签名）/§8（U8）/§13/§17 与文档头）
**重审范围**: 按承诺仅增量重审 R2 三项（R2-1 门禁 / R2-2 / R2-3）；对修订范围声明做抽检真实性核验；R2 已核验结论不重开。

## R3 Verdict: **pass**

## 增量核验（三项逐条）

### ① R2-1（MEDIUM 门禁）claim 结算机制唯一化 + U8 ——✅ 解除

1. **未定义符号已删除**：§6 收尾块（L468-475）不再含 `claimResolve()`；grep 复核全文，该符号仅存于 §17 历史回应表的引文中（R2 行的过程记录，非规范正文）——规范性伪代码零残留。
2. **派生式成为唯一结算机制**：§6 L490-492 `claim.promise = op.then(() => undefined, () => undefined)` 附「唯一机制」注释，且注释写明结构保证——「catch 块不做任何 claim 结算，**正因如此**两态 settle 由本行保证。CreateClaim 无 deferred 字段」；§4.1 `CreateClaim` 经核对仍为 `{ promise, supersededRead? }`（无 deferred 字段），与 U8 的机制陈述闭环。§6 实现注意（L501-504）补「claim 结算机制唯一化」段：try/catch 内无任何显式结算调用，两处 await 的活性由此保证。
3. **U8 已立**（§8 L678-681）：措辞完整含三要素——成败两态均 settle（失败路径不得遗漏）、作为 §7 两处 `await claim.promise`（resolveLoad creating 分支 / driver 分支 B）的活性前提、误读后果链（create 失败 claim 悬置 ⇒ 被取代 load waiter 永久挂起）作为反例写入。
4. **防死锁自证段引用 U8**（§7 L628-630）：「claim 由 io.write 的 settle 驱动——其活性前提即 U8……被取代 load waiter 不会因 create 失败而悬置」。
5. **删除无回归**（时序复核）：`claimResolve()` 删除不改变 R2 已核验的定序——采纳（`settleOnce` + `adoptedByCreate` 置位）仍在 try 块内、先于 op settle；claim.promise 由 op 派生、在 op settle 后结算——I5（采纳先于 claim settle）保持，分支 B 在 `await claim.promise` 后复检 `adoptedByCreate` 仍恒见终值，resolveLoad creating 分支的重评仍见回滚后 cell。§6 L469-470 注释与该定序逐字一致。

### ② R2-2（LOW）可达性归因扩全 ——✅ 落实

- §4.3（L246-252）：触发前提改写为「对同一 key 存在与 create 并发的 in-flight load」，显式列出两种发起方——调用方显式 loadDoc（check-then-create 竞态）与**持久层内部复验重读**，并给出完整触发链（create#1 胜出→驱逐→waiter 复验重读 in-flight→create#2 supersede 该内部重读，调用方并未显式并发 load+create）；调用方模式升级为「不与任何未决 load（含内部）并发」。
- §13（L802-805）：契约提示补句同步（「被并发的 load 不限于调用方显式发起……create 与任何未决 load（含内部）并发都会打开 §4.3 的覆盖窗口」）。

### ③ R2-3（NIT）TS 草图自洽 ——✅ 落实

- §5.3：io.read 闭包 `async` 化（匹配 `PersistenceIO.read` 的 Promise 返回类型），注释明示「read 侧的额外一跳不违反 §11 同深约束——该约束的适用范围 = write/flush 链」——与 R2 建议逐字对应。
- §7（L509-510）：`loadDoc` 补 `async` 关键字与返回类型注记，快路径裸 handle 由 async 语义自动包裹（与现行 loadDoc 一致）。

## 修订范围声明抽检（真实性）

对照 R2 基线抽检未声明章节：§4.1 `CreateClaim`/不变式（未变）、§12 bullet 1 限定式措辞（L743，未变）、§15 aborted⟺epoch 依据行（L865，未变）、§14 ALLOW/DENY（未变）；行数 922→950（+28）与各处增量吻合。声明属实，R2 已核验结论（R1 六点 + 自环修复 + 10 用例路径 + 微任务预算）维持有效。

## R3 结论与移交

- R1 六攻击点（R2 节核验）+ R2 三点（本节核验）全部闭环；设计文档作为 SA3 实现规格的自洽性、活性不变式（U1–U8）、契约文本（§12）与红线测试对照（§4.4 5a–5d ↔ SA2 R1 测试 1–4）齐备。
- **R3 Verdict = pass**。按立法：pass 仅表示设计通过审查，不替代 SA4 静态评审（建议锚点：§5.3 纪律 5 改写点清单逐项对账、U1–U8 逐条落实、§12 是否逐字落地 ADR）与 SA7 动态验证（建议动点：R1 红线测试 1–4 / §4.4 5a–5d、R2-1 活性钉——门控读 + create 写失败 + withTimeout 断言 waiter 真实 settle、U7 守卫、degraded→ready 与 dispose-during-flush 三绿灯）。
- SA3 实现注意（来自三轮评审的全部残留约束，均已入设计正文，此处仅汇总索引）：§5.3 纪律 1/5、§6 实现注意（claim 唯一化）、§11 同深约束（write/flush 链）、§15 全部依据行。

## R3 验证证据

1. R3 设计全文关键段精读（§6 L418-504、§7 L506-637、§8 L639-681、§4.3 L240-265、§13 L793-805、§5.3 L347-368、§17 R3 节）。
2. grep 复核：`claimResolve` 在规范性伪代码零残留（仅 §17 历史引文）；`claim.promise` 赋值仅 §6 L458（占位）与 L492（派生式）两处；`await claim.promise`/`await cell.claim.promise` 仍为 §7 L547/L568 两处（U8 所指点位准确）。
3. 范围抽检：§4.1/§12/§14/§15 与 R2 基线逐字一致（关键锚点行 grep 对照）；git status 确认无代码/测试文件新改动。

