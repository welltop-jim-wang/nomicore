verdict: pass

# SA2 R2 复审报告 — issue #133「Phase 5: bootstrap import, archive, and guarded replica reset」（Phase 2 设计攻击·R2）

**Date**: 2026-05-30（复审基线：design.md R2 @ 1146 行；R1 报告 `…_sa2_review.md`（verdict: reject）保留作审计轨迹，本文为独立 R2 复审）
**Verdict**: **pass**——R1 两个 BLOCKER + 两个 MEDIUM + 两个 LOW 全部在**机制级**落实（非声明级）；R2 新引入面（forceReleasing 旗标 / dispose 同步段通知 / 独立 archiveSnapshots 分区 / claim 环 assertWritable）经二次攻击推演闭合；§4.14.1 锚转绿对照表在 R2 改动下前提未破坏。残留 2 LOW + 2 INFO（非阻断，登记 SA4/SA7）。

- 复审方法：R2 文本逐节细读（§4.2 接纳段 / §4.5.2 三通知点 / §4.5.3 重写 / §4.5.5-4.5.6 / §4.8.2-4.8.3 / §4.10-4.10.1 / §5 INV-14/15 / §6-R4 / §7 / §4.14.2 第 9-11 条 / 修订记录 B1/B2）+ 对照现行代码事实（lifecycle.ts:263-268/314-332/550-578/590-596、memory.ts:63-127、lease.ts:100-114、registry.ts:693-703/720-755、testing.ts:731-772）+ SA6 五锚文件 Memory 断言逐条重核。
- 纪律：只读 + 本报告；未改任何 src/test/docs/设计文件。

---

## 一、R1 reject 项落实真实性（机制级复核，非声明比对）

### 1.1 BLOCKER-1（settle × dispose 永久挂起）——✅ 落实

**R2 机制**：§4.5.2 三通知点（① flush finally 首位无条件通知；② dispose 同步段 live-entry 清理循环内 splice-通知（clearTimers 后、cells.clear() 前同同步块）；③ archiveDoc 全程 track）+ §4.5.3 claim 环置 cell 前 `assertWritable()` 重检 + INV-15 + 修订记录 B1 推演。

**① R1 八步脚本在 R2 机制下逐步有确定结算（独立重放，不采信 B1 原文）**：

| 步 | R1 结局 | R2 重放（本复审独立推演） |
|---|---|---|
| 1-3 | degraded、retryTimer 武装、零在途 flush；settle 落入 `await archiveWaiters` | 同。**关键补充验证**：settle 从 `cells.get` 到 `entry.archiveWaiters.push(resolve)` 全程同步无出让点 ⟹ waiter 的注册与 archiveDoc 入口 `assertWritable()` 在同一同步执行段内完成——「dispose 通知后才进入 settle 的 waiter」结构性不存在（R1 复审焦点 ③ 的答案：**收口充分**） |
| 4 | dispose 清 retry timer、cells.clear()，waiter 永无人通知 | dispose 同步段：abort → clearTimers → **splice-通知（通知点 2，在 cells.clear() 之前的同一循环体内）** → cells.clear() → `await Promise.allSettled([...inFlight])`。通知先于等待发生 |
| 5-6 | 永久挂起 | waiter 续体（微任务，排在 dispose 同步段之后）：`cells.get(key)` → undefined → settle 返回 → claim 环 `assertWritable()` → closed → throw `Error('persistence is disposed')`（bare，无 code） |
| 7 | — | 被跟踪的 archiveDoc promise reject → inFlight 移除 → allSettled 返回。**自等待环验证**：dispose 等待的集合快照在通知之后拍摄且已包含该 promise；其结算只依赖已交付的通知 + 微任务推进，不依赖 dispose 完成 ⟹ 无环（B1 第 7′ 步论证成立） |
| 8 | registry shutdown 死锁 | registry reset 槽捕获 bare Error → §4.8.3 unknown 行 → `NamespaceRegistryFatalError('reset','lifecycle-slot-internal', false)`（bare Error 无 code 字段，不误匹配五类 code ✓）→ 槽/carrier.tail/runShutdown 逐级有限结算 |

**② finally 首位通知的零回归论证成立**：`archiveWaiters` 仅 settle 填充；非归档路径 splice(0) 恒空数组 → no-op，finally 既有语句（isCurrent 早退/flushing=false/reschedule/maybeEvict）次序零变化（§4.14.2-9 ✓）。归档路径：resolve 仅把续体排入微任务队列，finally 其余同步语句先完成 → waiter 醒来观察到 flush 终态——与 lifecycle.ts:565-577 实际结构（早退先于 maybeEvict）核对，**首位是唯一同时覆盖正常轮与 dispose-abort 轮的位置**，R1 指出的矛盾表述已被更正。**附加闭环验证**（本复审补充，R2 未明言但成立）：「flush 在 line 551 早退（saved===dirty）→ finally 不运行 → 无通知」的路径与「waiter 在册」互斥——waiter 在册 ⟹ 要么 flush 在途（其 finally 必通知）要么 retryTimer 武装（其触发要么进 flush 要么 saved===dirty+零 handle ⟹ 早被上一轮 finally 通知并驱逐+清 timer，矛盾）——即**每个被推入的 waiter 必然被下一个 finally 或 dispose 通知消费**，无「通知缺失 × waiter 在册」死角。

**③ 全程 track 与 allSettled 无自等待环**：见上表第 7 步。附加验证：`this.track(this.runArchiveDoc(...))` 的参数求值（含 runArchiveDoc 同步前缀与 waiter push）与 `inFlight.add` 在调用方同一同步执行段完成 ⟹ dispose 的等待快照不可能漏掉已通过入口检查的 archiveDoc；dispose 之后才调用的 archiveDoc 在入口 `assertWritable()` 即拒（无需通知）。

**结论**：BLOCKER-1 的修复是机制完整的——三个通知点互为冗余且覆盖全部等待形态（在途 flush / retry 武装 / reading/creating/archiving claim 等待，后者本就依赖 tracked op 的 abort-rejection 结算）。INV-15 成立。

### 1.2 BLOCKER-2（archiving claim 失败善后）——✅ 落实

**R2 机制**：§4.5.3 op 闭包 try/catch 全包，catch 侧与成功返回前同款执行 `cur?.state === 'archiving' && cur.claim === claim` 守卫删除后 rethrow/返回（镜像 lifecycle.ts:263-268）；§4.5.6 矩阵 10 行逐行补「archiving cell 善后」列；INV-14。

**① 十行善后归属逐行一致性**（本复审逐行核对）：

| 行 | 善后归属 | 核对结论 |
|---|---|---|
| settle ActiveHandle | 未建立（cell 保持 live） | ✓——settle 在置 claim 前抛出，cells 中无 archiving 态 |
| disposed（settle 苏醒后 assertWritable） | 未建立（置 cell 前抛出） | ✓——§4.5.3 line 572 位于 cells.set 之前 |
| Duplicate / Operational×2 / Identity / Fatal×2 / seam 违约 bare / 成功 | 已清理（守卫删除） | ✓——全部经 op 闭包的 catch/成功善后。**ABA 验证**：claim.promise 在 op 结算后才 settle（`claim.promise = op.then(...)`），而善后在 op 结算路径内同步先行 ⟹ 等待者（loadDoc/create/import 的 archiving 分支）醒来时 cell 必已清理，identity 守卫对「后来者新建 cell」额外防误删 |

前置抛出点完备性：入口 assertWritable（两处：archiveDoc 公共入口 + claim 环每轮）与 settle 的 ActiveHandle 均在 `cells.set` 之前，无 cell 可毒化 ✓（R1 复审焦点 ②）。

**② ARC 五锚机械转绿推演**（:280/:305/:331/:442/:549——归档拒绝后立即 `loadDoc` 断言非 null）：identity/operational 拒绝 → catch 守卫删除 archiving cell → loadDoc fast path 非 live → `resolveLoad` → `cells.get` → **undefined**（已删）→ 全新 read ticket → hook store/文件读回 committed snapshot → live entry → 非 null——有限微任务结算，「await 已 settle 的 claim.promise × cell 仍在」的无限循环前提被消除。五锚路径同构，机械成立 ✓（B2 推演与独立重放一致）。INV-6「identity mismatch 后文档完好可 open」在真实 persistence 下成立 ✓。

### 1.3 MEDIUM-3（seedForTest × archiving）——✅ 落实

§7 lifecycle.ts ALLOW 行明文：「seedForTest 守卫扩 archiving（`reading/creating/archiving` 一律抛 'test seed requires an idle key cell'，文本不变）」；§4.14.2-11 零回归论证（基线无 archiving 态）成立。R1 指出的「归档在途 seed 以 `cells.set` 覆写 archiving cell」击穿面被堵死 ✓。

### 1.4 MEDIUM-4（Memory 归档键同池碰撞）——✅ 落实（变体 ①′）

**R2 机制**：独立 `archiveSnapshots: Map<string, StoredSnapshot>`（以主键为键）+ `writeArchive` 不经 writeSnapshot hook（§4.10/§4.10.1）；remove = deleteSnapshot hook + 主 mirror 删除（不触归档域）；dispose 增 `archiveSnapshots.clear()`（§4.10 代码注释 + §7 memory.ts 行——**新清理义务已规格化**，drain-then-clear 纪律同款延伸 ✓）。

**碰撞消解验证**：两个不相交存储域（不同 Map 对象）——任意 userId/docId 组合的主键写结构性不可达归档域；hook store 不再收到任何归档键 ⟹ mirror 与 hook store 两处碰撞面同时消解。R2 对「仅分区 Map 而保留 hook 路由不充分」的论证正确（hook store 内归档键仍可被病态主键命中——本复审核实 hook store 是外部 Map、无文法守卫，该残余碰撞真实存在，①′ 的叠加是必要的而非过度设计）。被淘汰方向 ②（输入文法收窄）的否决理由（破坏 Memory 现状契约 + 需全量排查）成立。

**SA6 Memory 锚定兼容性声称——本复审逐条独立重核（不采信设计自述）**：

| 用例 | 断言 | hook 旁路下 |
|---|---|---|
| ARC 成功归档 | loadDoc→null（经 R-1 deleteSnapshot）+ slot 重建（n=99/epoch 2） | ✓ 归档副本在场与否无断言 |
| ARC 身份两式/损坏 | `assertStoreUnchanged`（仅主键）+ loadDoc 非 null | ✓ 失败路径本就零写 |
| ARC active handle | ACTIVE_HANDLE → release → 成功 → loadDoc null | ✓ |
| ARC duplicate | 二次归档 DUPLICATE + loadDoc null | ✓ guard-read 经 hook 读主键 → undefined |
| ARC hold-before-commit（Memory） | `Promise.race` 判 held + hold 期间 store 逐字节不变 + release 后 loadDoc null | ✓ **关键**：hold 经 **seam 的 write 槽**（testing.ts wrap 层）拦截，与 adapter 内 baseIo 是否调 writeSnapshot hook 是两层——seam 在 hold 期间不调内层 writeArchive ⟹ store（hook store）与 archiveSnapshots 均未写 ✓；完成后无归档副本在场断言 |
| ARC failNextRead | operational + 零变化 + loadDoc 非 null（fault 消费后重读） | ✓ |
| ARC owner 分区 | 双分区内容/身份 + 各自可归档 | ✓ |
| REG Memory 闭环 | `store.has(primary)===false`（经 R-1 deleteSnapshot）+ loadDoc null + import 成功；前置 `store.get(primary)` decode（reset 之前，主键仍在） | ✓ |

**结论：兼容性声称属实——SA6 Memory 断言无一要求归档副本出现在 hook store**；R-1 回流（补 deleteSnapshot）仍然必要且充分（remove 对外部 store 的删除能力）。R1 攻击 #4 闭合。

### 1.5 LOW-5 / LOW-6 / INFO-7/8/9——✅ 落实 / 留档合理

- **LOW-5**：§4.8.3 fatal 分支改 code-first（`code === 'DOC_ARCHIVE_FATAL'` + instanceof 双保险；committed 取 `typeof cause.committed === 'boolean' ? cause.committed : false`，缺席保守 false）；import 侧 DOC_CREATE_FATAL 同款。duck-typed relocate-remove fatal 的 committed:true 不再被 unknown 分支改写为 false——INV-12 对 duck-typed 实现成立 ✓。
- **LOW-6**：§4.2「接纳段（R2 增补冻结）」——acceptance（零输入访问）→ validateOpenIdentity（零 entries/carriers/Persistence/Runtime 访问）→ carrier FIFO，与 open/reset 同款同步段；File 侧 SAFE_PATH_SEGMENT 第二道门的编排侧对应物显式在案 ✓。
- **INFO-7/8**：维持原设计留档（R1 已定性「稳定且诚实」/「预答成立」），零改动合理 ✓。
- **INFO-9**：forceReleasing 闭包旗标（§4.8.2），见 §二.1 二次攻击。

---

## 二、R2 新引入面二次攻击（逐项场景脚本与结论）

### 2.1 forceReleasing 旗标——闭合（附 1 条 LOW 注记）

- **异常路径**：release()（lease.ts:100-114 doRelease）逐语句无抛出点（dispatchObserver 隔离、onReleased 在旗标命中时首语句即返）；try/finally 保证旗标清位——即便假设性抛出，finally 兜底 ✓。
- **重入（observer 回调在 release 循环内同步触发 registry 操作）**：open/create/import/reset 均经 carrier FIFO 接纳——重入调用链接到该 key carrier 尾部（当前槽正占用 tail 链），不重入当前槽；不同 key 走各自 carrier（微任务后运行）✓；回调 throw 被 dispatchObserver 隔离 ✓。无死锁（接纳是非阻塞链式）。
- **并发外部 release**：循环快照内的 lease 已被 release → doRelease 幂等（releasePromise 缓存）返回同一 Promise、不再触发 onReleased；快照外新 lease 不可签发（同 key 槽 FIFO 排队中）✓。
- **「release 循环前已有 idle 武装」形态**：idle entry 的 lease 集恒空（I1）⟹ 循环 no-op、旗标无匹配；预武装 timer 由循环后同步 `cancelIdleArm` 清除——§4.8.2「旗标与取消互为冗余兜底」的双层覆盖正确 ✓。
- **跨 key 并发 reset 的单变量覆写（本复审新发现的交错，设计未显式讨论）**：`forceReleasing` 是 registry 闭包单变量；不同 key 的 reset 槽可并行（各自 carrier），槽 A 置旗标=entryA 后进入 await 窗口，槽 B 置旗标=entryB 覆写；若 A 的 finally 在 B 的旗标窗口内清位（置 undefined）……**安全性验证**：旗标的载荷窗口只有 release 循环本身（entry 仍 'active' 的同步段，无出让点、不可被覆写穿插）；窗口之外（槽已同步翻 phase='closing' 后才首个 await），该 entry 的 handleLeaseReleased 被 `entry.phase !== 'active'` 守卫拦截——与旗标无关。恒等比较使错配（旗标指向他 entry）恒不抑制。**结论：机制安全**，但依赖 phase 守卫作兜底而非旗标自身完备——登记 LOW-R2-2（见 §四），建议设计补一句注记或将旗标作用域缩至同步段（set→循环→cancelIdleArm→clear）。

### 2.2 dispose 同步段通知与 waiter 续体交错——闭合

- **续体访问已 clear 的 cells**：settle 续体仅 `cells.get`（只读，undefined → 返回）+ claim 环 `assertWritable`（closed → 抛）。**cells.set 全归档路径唯一写点位于 claim 环 break 之后、assertWritable 检查之后的纯同步段**——dispose 后不可达 ✓。op 体内对 cells 仅 get（善后守卫读）无 set ✓。
- **续体时序**：w() 仅 resolve Promise（无同步用户代码），dispose 同步段原子完成（含 cells.clear）后续体才运行 ✓；两通知点对同一 waiter 至多各消费一次（splice 语义）✓。
- **通知点 2 的循环覆盖面**：settle waiter 只挂于 live entry 的 `archiveWaiters`——dispose 的 live-entry 清理循环恰好枚举全部潜在载体；reading/creating/archiving cell 无 waiter 且各自 tracked op 经 abort 结算 ✓。

### 2.3 独立 archiveSnapshots 分区——闭合（附 1 条 INFO 登记）

- **dispose 清理义务**：已规格化（§4.10 代码注释 + §7 memory.ts 行「dispose 增 archiveSnapshots.clear()」），与既有 drain-then-clear（memory.ts:124-127）同款——drain 覆盖在途 writeArchive（tracked）后双 Map 齐清 ✓。
- **writeArchive resolve → remove 前 dispose 的一致性窗口**：remove 入口 abort 门（`signal.throwIfAborted()`，先于 hook/mirror 删除）抛 → `DocArchiveFatalError('relocate-remove', committed:true)`（对提交瞬间为真）；dispose 随即清空 archiveSnapshots（归档副本随实例消失，Memory 无恢复面——R9 裁决一致），外部 store 主键未删（外部视角「归档未发生、文档原样」）。新实例重试收敛（guard-read 见主键 → 身份复验 → 再归档 → 删主键）。诚实且收敛；登记 INFO-R2-1 供 SA7 活链路覆盖（含 INV-4「任何拒绝 ⟹ 不变」措辞实辖 pre-commit 拒绝的附读提示）。
- **与 fault seam 的分层**：hold/fail-write 经 wrap 层（seam）拦截，先于 baseIo.writeArchive——hook 旁路不影响 seam 注入面（§4.14.1 ARC hold 行前提保持）✓。
- **Memory 无 hook 实例**：writeArchive 仅写 archiveSnapshots；remove 仅删主 mirror——对称、无外部面 ✓。

### 2.4 claim 环 assertWritable 的 TOCTOU——闭合

`break`（cell undefined）→ `const claim = {...}` → `cells.set` 之间纯同步（对象字面量创建，无函数调用、无 await）；`assertWritable → cells.get → 条件分派 → break` 亦纯同步。等待分支（reading/creating/archiving）一律 `continue` 回到 settle+assertWritable 重检。**无检查-使用出让点** ✓。

---

## 三、§4.14.1 锚转绿对照表在 R2 下的前提复核

| 原推演前提 | R2 改动是否破坏 | 复核 |
|---|---|---|
| ARC 22 红全绿 | 否 | claim 善后（§1.2）补上了 R1 缺的机械前提；Memory hook 旁路经 §1.4 逐用例独立重核兼容（hold 用例经 seam 层 engage 不依赖 adapter hook 路由）；R-1 仍必要且充分 |
| IMP 13 红全绿 | 否 | R2 零触及导入路径（exclusiveCreate/importDoc 无改动）；fixture 无 wrapIo 前提保持 |
| REG 17 红全绿 | 否 | §4.8 编排零改动（除 §4.8.2/4.8.3 增强——forceReleasing 不影响任何断言：REG 测试无 observer 事件断言，`lease:'released'` 由 release() 本体保证照发）；Memory 闭环经 §1.4 核对；unknown→fatal 映射承接 B1 第 8′ 步 |
| ARC-surface 2 红锚经 R-2 改锚转绿 | 否 | 类型面零改动（R2 未动 §4.0.1/§4.4 optional 裁决） |
| REG-surface 2 红锚直接绿 | 否 | 同上 |
| §4.14.2 零回归 8+3 条 | — | 第 9 条（finally 首位 no-op）经 §1.1-② 核实；第 10 条（dispose 追加语句仅触达恒空数组）✓；第 11 条（seedForTest 守卫 + 旗标不进正常 release 路径——idle 用例族 entry-idle 照发）✓ |

**附加一致性检索（本复审执行）**：设计全文 `archive\0`/archive-scoped 残留仅存于 §4.6 被淘汰方案 (a)、§4.10.1 被攻击形态引述与修订记录（无任何落位残留，R2-3 自检属实）；§4.0.2 writeArchive 契约注释、D-10 行、§4.13、INV-4、§7 memory.ts 五处 Memory 表述同源一致；`先于 isCurrent 早退、在 maybeEvict 之后` 旧表述已全文替换。

---

## 四、残留非阻断清单（登记 SA4/SA7；不构成本复审阻断）

| # | 级别 | 条目 | 内容 | 处置建议 |
|---|---|---|---|---|
| LOW-R2-1 | LOW | io-seam loud gate 放置点未钉死 | §4.4 称 gate 在 `archiveDoc` 入口（settle 之前）；§4.5.5 伪码用 `this.io.writeArchive!(...)`（op 内非空断言）；§4.5.6 矩阵行 9 善后列写「已清理（同上）」（= op 内）。两种放置均满足 INV-14（入口 ⟹ 无 cell 可清；op 内 ⟹ 走 catch 善后），但「active-handle entry + io 缺方法」这一无锚组合的拒绝先后不同（入口 gate 先于 settle 的 ActiveHandle 判定） | SA3 落地按 §4.4 入口放置并同步矩阵行 9 善后列为「未建立（入口拒出）」——一句话对齐，非设计缺陷 |
| LOW-R2-2 | LOW | forceReleasing 跨 key 覆写未显式讨论 | 单闭包变量可被并发不同 key 的 reset 槽互相覆写；安全性由恒等比较 + 载荷窗口外 `phase!=='active'` 守卫兜底共同保证（本复审 §2.1 推演成立），但设计文本未讨论该交错 | SA1/SA3 补一句注记，或将旗标作用域缩至同步段（set→循环→cancelIdleArm→clear，零 await）以自完备 |
| INFO-R2-1 | INFO | Memory writeArchive-resolve→remove 前 dispose 窗口 | committed:true fatal（对提交瞬间为真）+ archiveSnapshots 随 dispose 清空 + 外部主键未删；外部视角归档未发生；新实例重试收敛。诚实且收敛，但属活链路边缘 | SA7 验收覆盖该窗口；SA3 附读 INV-4 时注意「此前任何拒绝」实辖提交点之前（relocate-remove 行自证） |
| INFO-R2-2 | INFO | §9「implements DocPersistence 17 命中」实为 16 | SA8 N'-6 已勘误的前存量，R2 未改该行；不影响任何裁决（13 stub 论据属实） | SA3 落地时随手更正或维持 SA8 勘误在案 |

---

## 五、结论

**verdict: pass。** R1 的两个 BLOCKER（settle×dispose 永久挂起 / archiving claim 失败善后缺失）与两个 MEDIUM（seedForTest 守卫 / Memory 归档键碰撞）均在机制级完整落实——本复审对 B1/B2 推演做了独立重放（含 R2 未明言的三个闭环补充验证：settle 同步前缀的 waiter 注册无出让点、flush 早退路径与 waiter 在册互斥、track 参数求值与 inFlight.add 同步段一致），对 MEDIUM-4 的锚定兼容性声称逐用例独立重核属实。R2 新引入面（forceReleasing / dispose 通知 / archiveSnapshots 分区 / assertWritable）二次攻击全部闭合，其中跨 key 旗标覆写与 io-gate 放置点两项以 LOW 登记。§4.14.1 对照表前提未破坏。R1 报告 §四 的 14 项已验证闭合面在 R2 下不受影响（R2 未回退 D-1..D-14 主体裁决）。

残留 4 项（2 LOW + 2 INFO）移交 SA4（静态门禁：LOW-R2-1/2 的落地一致性）与 SA7（活链路：INFO-R2-1 的 dispose 窗口）关注，均不阻断放行。
