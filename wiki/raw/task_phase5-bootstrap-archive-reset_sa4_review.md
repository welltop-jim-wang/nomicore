# SA4 静态验尸报告 — issue #133「Phase 5: bootstrap import, archive, and guarded replica reset」

**Date**: 2026-05-30（Phase 3 静态审查）
**Verdict**: **pass**
**审查基线**: `git diff ebc5419 -- packages/`（11 个 src 文件 +1214/-14）+ 5 个 SA6 测试文件（untracked，亦属审查面）
**冻结设计（唯一规格）**: `wiki/raw/task_phase5-bootstrap-archive-reset_design.md`（R3，1160 行）
**红灯锚（验收方）**: 5 个 SA6 文件（archive-red 23 / import-red 14 / registry-red 18 / 2 surface test-d 各 4）
**SA3 报告**: `wiki/raw/task_phase5-bootstrap-archive-reset_sa3_impl.md`（2 项偏差登记，均已裁决，见 F-1/F-2）
**SA2 R2 残留**: LOW-R2-1/LOW-R2-2/INFO-R2-1/INFO-R2-2 逐条复核见 §6

---

## 一、审核结论（技能模板 8 项）

1. **设计一致性**：✅ 一致（§4.0–§4.13 全部机制逐一对位，见 §二逐决策表）。两处已登记偏差经裁决为忠实最小调和（F-1/F-2）；另有 4 项 INFO 级微偏差/文档失同步（F-3..F-6），均不阻断。
2. **读写路径一致性**：✅ 一致。归档 = 同一份 guard-read 字节经 `writeArchive` 写入归档区、经 `remove` 删除主键（lifecycle.ts:394-420，字节复用不重编码）；读路径（loadDoc）与主键存储同源；Memory 归档区独立 Map 分区（memory.ts:80），主键 hook store 与归档域结构性隔离——无双数据源分叉。
3. **静默失败**：✅ 无。全部拒绝路径均产出 typed rejection / issue / fatal / bare loud Error；三处 capability gate（Registry×2 槽、lifecycle 入口、Memory 配置门）全部 loud；`remove` 失败浮出为 committed:true fatal（不吞错）；fault seam 的 remove 透传不设静默槽。
4. **降级方案**：✅ 安全。无新增降级路径。debounce 跳过是时序优化非语义降级（degraded retry 回退窗被动等待，N-5 逐字满足）；degraded-dirty 无 dispose 时为诚实 pending（ADR 0008:93 同款契约行为，非不变量违反）。
5. **极端攻击**：✅ 未见可静态确认的漏洞。已推演的边界：flush 预检早退窗口（由 dispose 同步段通知兜底，见 INV-15 论证）、archive∥archive 第二者得 DUPLICATE、归档在途 seed 击穿（seedForTest 守卫封死）、Memory 病态主键碰撞归档区（独立 Map 分区结构性免疫）、TOCTOU（与 createDoc 既有暴露面同构，设计 §4.2 已声明诚实边界）。残留活链路窗口 → SA7（F-7）。
6. **错误处理**：✅ 完整。§4.5.6 十行矩阵、§4.8.3 两张映射矩阵、§4.11.2 文案单点表逐行核对一致（§四）；message 文本逐字一致；committed 映射 false/false/true 逐字一致。
7. **架构评估**：✅ 可行。无绕过架构约束的硬编码/临时补丁；exclusiveCreate 抽取是设计钦定的复用形态（D-3）。
8. **过度设计**：✅ 精简。新增面全部由设计决策与 SA6 锚背书；无「为将来需求」的抽象层；变更半径与 ALLOW 清单精确重合。

---

## 二、逐决策落位真实性（设计 §4.0–§4.13 × 实现对位表）

| 设计机制 | 实现落位（文件:行） | 对位结论 |
|---|---|---|
| §4.0.1 契约类型/错误族/派生接口 | contract.ts:32-190（YjsDoc:32 / ReplicationIdentityRef:38-41 / DocImportIdentityError:97 / 归档四类+Fatal:113-180 / optional 成员:73-90 / ReplicaPersistence:93-102） | ✅ 逐字（message 文本逐一比对一致；`committed: false` 字面量、cause 保留不拼接均落实） |
| §4.0.2 PersistenceIO optional +writeArchive/+remove | lifecycle.ts:51-66 | ✅ 注释契约逐字搬运 |
| §4.0.3 registry 类型/常量/接口扩展 | types.ts:85-99（5 常量）、277-353（两联合+两结果）、464-490（接口 +2 required 方法）；偏差 #1 见 F-1 | ✅（联合差异 = F-1 登记项） |
| §4.0.4 导出面 | persistence index.ts +7 值 +4 类型；registry index.ts type-only +5、零值导出 | ✅ 计数逐一核对（7 值：Import/Archive×5/COMMITTED 常量；4 类型） |
| §4.1/D-1 公共方法暴露面 | registry.ts:1673-1700（importReplica/resetReplica 入口）+ types.ts:467-490 | ✅ 无 capability token、无 internal subpath、无通用管理面 |
| §4.2/D-2 核对次序冻结 | registry.ts:1362-1395（① entry 碰撞 owner 先行 → ②a readMetaDocId:209-217 → ②b readImportedReplicaFacts:179-206 → ③ gate → ④ importDoc → ⑤ factory）；接纳段 1673-1683（acceptance → validateOpenIdentity → carrier FIFO，与 open 入口逐行同款） | ✅ 全部核对先于任何 Persistence 调用 |
| §4.2.1 判据复刻（结构守卫副本 #1） | registry.ts:179-206（has/get 键存在性判别、恰一键、undefined 值、PATTERN、SafeInteger、≥1、载体异型收编） | ✅ 与 readReplicationFacts 判据族逐条对位；REPLICATION_ID_PATTERN 三处互引注释在位（registry.ts:165-169 / lifecycle.ts:908-917） |
| §4.3/D-3 exclusiveCreate 抽取 | lifecycle.ts:209-224（createDoc/importDoc 委托）、226-341（共享管线；唯一差异位 validateCreateDoc/validateImportDoc 分叉:232-234，先于 claim/io）；validateImportDoc:706-712 | ✅ 与基线 createDoc 逐字节等价（见 §五.1） |
| §4.4/D-4 optional + 派生接口 + 三处 gate | contract.ts:73-102；Registry import gate:1390-1400 / reset gate:1482-1492；lifecycle 入口 gate:493-503（assertArchiveIo，置于 assertWritable 后、track/settle 前）；Memory 配置门:109-118 | ✅（gate 检查域拆分见 F-6） |
| §4.5/D-5 archiveDoc 状态机 | lifecycle.ts:343-356（入口：assertWritable → assertArchiveIo → track）、358-463（runArchiveDoc：settle 环 → assertWritable 重检:367 → claim 环:368-379 → archiving cell:381 → op 体） | ✅ 与 §4.5.3 伪码逐行同构 |
| §4.5.1 cell 扩展/KeyClaim 更名/resolveLoad 分支 | lifecycle.ts:110-119（四态 cell）、108-112（KeyClaim）、599-604（resolveLoad archiving 分支）、242-247（claim 环 archiving 分支） | ✅ 两分支均「await claim 后重评估」，无伪 duplicate |
| §4.5.2 settle 段 + 三通知点 | settleEntryForArchive:465-487（ActiveHandle:471 / 干净驱逐:474-477 镜像 maybeEvict / 强制 flush:480 / degraded 被动等待）；通知点 1 = flush finally 首位:833-834（先于 isCurrent 早退:835）；通知点 2 = dispose 同步段:558-559（clearTimers 后、cells.clear() 前同一同步块）；通知点 3 = 入口 track:350 | ✅ 三点位置与 R2 规格逐字一致 |
| §4.5.4 guard-read 单一谓词 | lifecycle.ts:390-413（io.read → DUPLICATE(undefined) → scratch 解码 → docId 门 → facts 全等谓词 → 统一 DocArchiveIdentityError）；readPersistedReplicaFacts:926-950（副本 #2） | ✅（两段 try 合并 + cause 缺席见 F-5） |
| §4.5.5 relocate 提交点 | lifecycle.ts:415-424（writeArchive! → epoch 分类 → remove! → Fatal(relocate-remove)）；成功善后:425-428 | ✅ 提交点 = writeArchive resolve；remove 失败恒 Fatal committed:true |
| §4.5.6 失败通道矩阵 + INV-14 善后 | 双路径 identity 守卫清理:416-419（成功）/421-429（catch，rethrow 原拒绝）；置 cell 前抛出点:344-345（入口）/367（claim 环 assertWritable）/471（settle ActiveHandle）均无 cell 可清 | ✅ 十行逐行一致（row 9 文档列失同步见 F-3，实现正确） |
| §4.6/D-6 归档提交段 seam 路由 | testing.ts:775-796（writeArchive 并入 failWrite/holdWriteBefore/AfterCommit 同槽 + throwIfAborted 自检）、799-801（remove 透传） | ✅ 与 write 槽逐语句同构（比对:747-771） |
| §4.7/D-7 纯传递 | registry.ts:1554-1556（expected 原样传 archiveDoc）；无任何 close 前本地事实预检 | ✅ |
| §4.8/D-8 reset 编排 | registry.ts:1468-1580：① owner 核对:1472-1476 → gate:1482-1492 → ② close:1494-1520（closing 等待 / forceReleaseOutstandingLeases:941-951 + cancelIdleArm:955-961 + beginCloseCurrent:970-989）→ ③ 探针:1521-1539（loadDoc；LOAD_FAILED/NOT_FOUND；probe.release()）→ ④ archive 映射:1541-1571 → ⑤ {ok:true}:1574-1578 | ✅ 次序逐行一致 |
| §4.8.1 close 失败分类 | registry.ts:1496-1499/1508-1512（fatal('reset','lifecycle-slot-internal',false)） | ✅ |
| §4.8.2 forceReleasing 旗标 | registry.ts:646（闭包变量）、853（handleLeaseReleased 首语句判别）、941-951（try/finally 置位清位） | ✅ 仅抑制 idle 武装与 entry-idle；lease-released 照发（doRelease 同步段触发，lease.ts:101-116 实证）；跨 key 三层保证（R3 §4.8.2 注记）成立——查阅窗口零 await 同步块实证：置位→循环→清位同同步段，cancelIdleArm 与 close 发起紧随（1495-1498 无 await 间隔） |
| §4.8.3 映射矩阵 code-first | errorCodeOf:224-231 / committedOf:233-238；reset 六行:1543-1570；import 段:1401-1429 | ✅ 逐行一致；duck-typed stub（test:291/298/306 以 Object.assign(new Error,{code}) 抛）由 code-first 判别命中——锚定机制与 R2 LOW-5 修复对位 |
| §4.8.4 三相交互 + 并发串行 | closing 等待分支:1495-1500；carrier FIFO 接纳:1344-1354/1600-1612 | ✅ |
| §4.8.5 bootstrap 资格 = key 缺席 | registry.ts:1574-1578（无显式动作/无标记/无新枚举） | ✅ |
| §4.9/D-9 File 归档布局与 tmp | file.ts:200-210（resolveArchivePaths：archive/users/{u}/{id}.snapshot+.tmp，SAFE_PATH_SEGMENT 双段:205-206）、160-172（mkdir→writeFile tmp→rename，abort 三门位:162/164/166）、174-178（rm force:true ENOENT 容忍） | ✅ latest-wins 覆盖由 rename 原子覆盖实现；主键区读路径 tmp 清理（readCommittedSnapshot）结构性不触及归档区 |
| §4.10/D-10 Memory 独立分区 + loud 配置门 | memory.ts:80（独立 archiveSnapshots Map）、101-107（writeArchive 不经 writeSnapshot hook、快照 slice 复制）、109-118（remove：abort 门 → loud 配置门（message 逐字）→ deleteSnapshot?.(key) → 主 mirror 删）、48（optional hook）、179-181（dispose drain-then-clear） | ✅ R2 ①′ 形态逐字落实；归档域与主键域两个不相交存储域，碰撞面在 mirror 与 hook store 两处同时消解 |
| §4.11/D-11 词表 append-only | errors.ts:23/29（+reset/import）；observer.ts:31（operation +2 值）、45-47（+3 事件形）；types.ts 5 常量 | ✅ append-only；phase 词表零新增 |
| §4.12/D-12 单一构造路径 | registry.ts:1432-1445（factory(handle, () => persistence.saveDoc(handle)) 与 create:1325 同一行；throw → releaseHandleBestEffort + import-runtime-construction-failed + fatal('import','runtime-construction', true)） | ✅ 镜像 create DQ-7（registry.ts:1330-1336 逐句比对） |
| §4.13 reset→bootstrap 全链闭环 | registry-red test:521（stub）/707（Memory）/774（File）三例全绿（本次亲跑 55/55 复证） | ✅ |
| §4.14/D-14 测试迁移 | R-1 落位（archive-red:127-131 / registry-red:718-723 deleteSnapshot hook）；R-2 落位（persistence surface:33/63-72 锚指 ReplicaPersistence）；import-red 零断言改动（偏差 #2 见 F-2） | ✅ |

---

## 三、INV-1..INV-15 逐条验证

| INV | 机制在位证据 | 结论 |
|---|---|---|
| INV-1 排他永不让步 | exclusiveCreate 共享 claim 环（lifecycle.ts:226-341）；IMP 三排他锚（duplicate/并发恰一/跨面）全绿 | ✅ |
| INV-2 核对先于所有权转移 | registry.ts:1364-1390（①②a②b 全在 ④ importDoc 之前）；REG 四核对失败用例断言 `importCalls === []` | ✅ |
| INV-3 导入字节原样继承 | exclusiveCreate 复用 `Y.encodeStateAsUpdate(doc)`（与 create 同一语句，无 META 改写面） | ✅ |
| INV-4 归档提交不变式 | lifecycle.ts:390-428（guard/verify 只读、writeArchive 写公理、remove 后置、字节复用）；memory.ts:80/101-107（独立分区使主键写结构性不可达归档域） | ✅ |
| INV-5 身份守卫单点 | lifecycle.ts:395-413 单一谓词（任何偏差含损坏/docId 不符 → 同码零改动）；判据副本 #2 与 #1、runtime 语义源互引 | ✅ |
| INV-6 零部分删除 | registry.ts:1472-1571（守卫/探针先于一切存储变更；close-only 不动存储；DUPLICATE→NOT_FOUND 零副作用——owner mismatch 用例断言 archiveCalls===[]） | ✅ |
| INV-7 close→archive 次序与写完整结算 | registry.ts:1494-1520（close barrier）+ lifecycle.ts:465-487（settle 排空零-handle dirty，归档字节 = 写后终态） | ✅ |
| INV-8 资格 = key 缺席 | registry.ts:1574-1578；无标记/枚举/wire 面（surface 绿守卫证） | ✅ |
| INV-9 stale 身份重放拒绝 | 同一守卫结构覆盖（新持久事实 ≠ 旧期望 → RESET_IDENTITY_MISMATCH） | ✅（结构性） |
| INV-10 owner 分区 + 零泄露 | registry.ts:1364-1368/1472-1476（owner 先核对 NOT_FOUND）；ARC/IMP/REG owner 分区锚全绿 | ✅ |
| INV-11 文件访问封闭 | file.ts 全部 fs 操作（writeArchiveSnapshot/removeCommittedSnapshot/readCommittedSnapshot）；registry 仅经 archiveDoc seam | ✅ |
| INV-12 词表 append-only + committed 传播 | contract.ts:170-172（committed 由冻结映射派生:189）；registry.ts:233-238 committedOf 布尔读取原样传播（duck-typed fatal 不被改写） | ✅ |
| INV-13 capability 显式化 | 三处 gate 全 loud：registry import:1390-1400 / reset:1482-1492（fatal）；lifecycle:493-503（bare loud Error，稳定 message）；memory:112-117（bare loud Error） | ✅ |
| INV-14 key 无毒化 | 全部结算路径覆盖：op 成功:425-428 / op catch:421-429（identity 守卫 + rethrow）——identity/operational/fatal/duplicate/disposed 后续段/seam 违约同走 catch；置 cell 前抛出点（344/367/471）无 cell 可毒化；seedForTest 守卫扩 archiving（registry MEDIUM-3 对应，lifecycle.ts:524-529） | ✅ |
| INV-15 归档必然结算 | 通知点 1（lifecycle.ts:833-834，finally 首位，先于 isCurrent 早退:835、先于 flushing=false:836）✅；通知点 2（558-559，dispose 同步段 clearTimers 后、cells.clear():564 前）✅；通知点 3（350，入口 track 包住 settle→claim→op 全程）✅。flush 预检早退（:813，isCurrent false 时 finally 不跑）的唯一遗漏窗口恰与 dispose 同现，由通知点 2 兜底——两通知点互为冗余，B1 推演在实现结构下成立，无自等待（通知点 2 先于 allSettled:565） | ✅ |

---

## 四、错误分类学逐行核对

### §4.5.6 矩阵 10 行 × 实现

| 行 | 触发 | 实现位 | 拒绝值/committed | cell 善后 | 判定 |
|---|---|---|---|---|---|
| 1 | settle 有 handle | lifecycle.ts:470-471 | DocArchiveActiveHandleError | 未建立（settle 抛于置 cell 前） | ✅ |
| 2 | disposed（settle 苏醒后） | :367 assertWritable | bare Error('persistence is disposed') | 未建立 | ✅ |
| 3 | guard-read 无快照 | :392 | DocArchiveDuplicateError | catch 守卫删除 | ✅ |
| 4 | guard-read 拒绝（current） | :388-390 | Operational committed:false | 同上 | ✅ |
| 5 | verify 偏差 | :395-413 | Identity（单一谓词） | 同上 | ✅ |
| 6 | relocate-write 拒绝（current） | :415-419 | Operational committed:false | 同上 | ✅ |
| 7 | guard/relocate-write 被 dispose 终结 | :388-390/:417-419 | Fatal(guard-read\|relocate-write) committed:false | 同上 | ✅ |
| 8 | relocate-remove 失败 | :421-423 | Fatal(relocate-remove) committed:true | 同上 | ✅ |
| 9 | io seam 缺方法 | :493-503 入口 gate | bare loud Error | 未建立（入口拒出——与 R3 放置点表一致；设计矩阵行 9 文本失同步见 F-3） | ✅ 实现 / ⚠️ 设计文本 |
| 10 | 成功 | :424-428 | Object.freeze({ok:true}) | 成功守卫删除 | ✅ |

### §4.8.3 reset 映射 6 行 × 实现（registry.ts:1541-1571）
IDENTITY_MISMATCH→RESET_IDENTITY_MISMATCH+observer ✅；DUPLICATE→NOT_FOUND（无 observer）✅；ACTIVE_HANDLE→RESET_FAILED+observer ✅；OPERATIONAL→RESET_FAILED+reset-archive-failed ✅；FATAL（code-first+instanceof 双保险，committedOf）→fatal 传播 ✅；unknown→fatal false ✅。
import 段（:1401-1429）：DocDuplicateError instanceof→ALREADY_EXISTS ✅；DOC_IMPORT_IDENTITY_MISMATCH→防御映射 ✅；DOC_CREATE_OPERATIONAL（instanceof‖code）→IMPORT_FAILED+import-persist-failed ✅；DOC_CREATE_FATAL→fatal committedOf ✅；unknown→fatal false ✅。与 create 既有映射（registry.ts:1290-1320）逐句镜像，仅 duplicate 归宿不同（create=retry / import=issue——设计钦定）。

### §4.11.2 文案单点
Persistence 七类构造器默认 message 与 §4.0.1 逐字一致（contract.ts:101/122/131/140/151/181——零插值零 cause 拼接）；Registry 5 常量（types.ts:87-98）与 §4.0.3 逐字一致；issue 对象全部 Object.freeze（registry.ts:349-385）。

### committed 映射
`DOC_ARCHIVE_FATAL_PHASE_COMMITTED = {guard-read:false, relocate-write:false, relocate-remove:true}`（contract.ts:161-165，Object.freeze）——逐字 ✅；DocArchiveFatalError.committed 由该映射派生（:189），调用方不重推导 ✅。

---

## 五、零回归静态复核（被改动的既有路径逐处论证）

1. **exclusiveCreate 抽取对 create 路径逐字节等价**：与 `git show ebc5419` 原 createDoc 逐行比对——claim 环次序（live→creating→reading→probe）不变，新增 archiving 分支为纯追加（基线无该态，不可达）；提交段（encode→write→post-commit→catch 善后）零改动；仅变量名 op→op2 与身份校验单点分叉（`op==='create'` 分支 = 原 validateCreateDoc 调用原位）。✅
2. **flush finally 首位通知对非归档路径 no-op**：archiveWaiters 仅 settleEntryForArchive:483 填充；非归档生命周期恒空 ⟹ `splice(0)` 返回空数组、for 零迭代、零观测差异；finally 其余语句（isCurrent 早退/flushing=false/reschedule/maybeEvict）次序零变化。✅
3. **dispose 同步段通知**：追加语句仅在 live-entry 清理循环内触达 archiveWaiters（基线恒空）；既有 dispose 语义（closed/epoch/abort/clearTimers/handles.clear/doc.destroy/cells.clear/allSettled）零变化。✅
4. **KeyClaim 更名**：纯类型名替换（CreateClaim→KeyClaim），注释同步；无运行时差异。✅
5. **resolveLoad archiving 分支**：纯追加分支（基线无 archiving 态）；reading/creating 分支原样。✅
6. **seedForTest 守卫扩展**：追加 `|| cell?.state === 'archiving'`，抛错文本不变；基线不可达。✅
7. **createEntry 追加 archiveWaiters 字段**：纯数据成员追加。✅
8. **optional 成员扩展**：13+1 个既有测试 stub、三成员字面量（surface:82-91）、registry-sa7 wrapIo `{read,write}` 字面量全部不需改动（本次亲跑 55/55 + 总控 1687/1687 全绿实证编译与运行双零回归）。✅
9. **handleLeaseReleased 首语句守卫**：仅 `forceReleasing === entry` 时早退——该旗标仅 reset 槽同步段置位，既有 idle 流程（正常 release→武装→entry-idle）零影响。✅
10. **observer/errors 词表 append-only**：既有字面量断言零破坏（既有断言面 grep 均只断言既有值）。✅

---

## 六、SA2 R2 残留 4 项复核

| 残留 | 复核结论 |
|---|---|
| LOW-R2-1（io gate 放置点） | 实现按 R3 §4.4 放置点表落位（lifecycle.ts:493-503 入口、track/settle 之前，assertWritable 之后）——「active-handle entry + io 缺方法」组合下入口 gate 先于 settle 判定，语义确定。设计 §4.5.6 行 9 善后列仍为 R2 文本「已清理（同上）」，与 R3 放置点失同步 → F-3（SA1 补一句，实现无责）。 |
| LOW-R2-2（forceReleasing 跨 key 覆写） | R3 §4.8.2 三层保证注记已在设计；实现以 entry-identity 判别 + 同步块零 await（941-951 置位→循环→清位；调用方 1495-1498 循环→cancelIdleArm→close 发起连续同步）结构性满足第 ①② 层；每 key FIFO 满足第 ③ 层。失配退化为不抑制，cancelIdleArm + I4 token + beginIdleClose phase 守卫兜底（899-901 实证）。一致 ✅ |
| INFO-R2-1（Memory dispose drain-then-clear 窗口） | memory.ts:175-181 保持 core.dispose() 先结算 → clear 后置纪律；窗口转 SA7（F-7-i）。 |
| INFO-R2-2（§9 计数） | R3 已更正为 16；实测含 SA6 StubReplicaPersistence 共 17 行（13 stub + SA6 stub + Memory + File + 1 文档注释）——R3 把 SA6 stub 单列一行致 grep 总数 17 > 16。纯计数口径问题，零裁决影响 → 并入 F-4。 |

---

## 七、SA6 锚满足度抽查（10 关键锚）

| 锚 | 位置 | 机制对应 | 判定 |
|---|---|---|---|
| ARC hold-before-commit（:396-431） | fx.faults.holdNextWriteBeforeCommit | writeArchive 并入 seam write 槽（testing.ts:781-788）→ hold engage、store 逐字节不变、release 后提交恰一次 | ✅（本次亲跑绿） |
| ARC failNextWrite（:538-563） | failNextWrite 注入 | seam failWrite 槽拒绝 → relocate-write Operational + 目录树零变化（failWrite 先于内层调用，零 fs 触达） | ✅ |
| ARC failNextRead（:433-456） | failNextRead 注入 | guard-read 经 io.read（lifecycle.ts:385-390）→ Operational | ✅ |
| REG 并发两导入恰一（:489-519） | Promise.allSettled 双 import | carrier FIFO 串行（admitImportSlot）+ 第二槽见 live entry → ALREADY_EXISTS | ✅ |
| REG owner 零泄露（:562-584） | 断言 archiveCalls === [] | ① owner 核对先于 gate/close/探针（1472-1476） | ✅ |
| REG 闭环·stub（:521-560） | lease:'released' + archiveCalls[0].expected | forceReleaseOutstandingLeases 同步 release（lease.ts doRelease 同步置 released）+ 纯传递（1554-1556） | ✅ |
| REG 闭环·Memory/File（:707/:774） | store.has(key)===false / 归档文件在 rootDir | deleteSnapshot hook（R-1）+ file 归档布局（§4.9） | ✅ |
| IMP 三排他（:197/:225/:253） | DOC_DUPLICATE ×3 形态 | exclusiveCreate 共享 claim 机械（IMP 面 zero 特判） | ✅ |
| surface·persistence（:63-72） | ReplicaPersistence 两红锚 | contract.ts:93-102 required 成员 + index 导出 | ✅ |
| surface·registry（HasResetReplica/HasImportReplica） | NamespaceRegistry 两红锚 | types.ts:467-490 required 方法 | ✅ |

（本次独立复跑：`npx vitest run` 三红文件 → **3 files / 55 tests passed / Type Errors: no errors / exit 0**，与 SA3 §2.2 记录一致。）

---

## 八、ALLOW/DENY 纪律

- **diff 文件清单**（`git diff ebc5419 --name-only`）= 恰 11 文件：persistence/src/{contract,file,index,lifecycle,memory,testing}.ts + namespace-registry/src/{errors,index,observer,registry,types}.ts —— 与设计 §7 ALLOW（persistence 6 + registry 5）**逐一对照全中，零越界**。
- **untracked**：5 个 SA6 测试文件（全部在 §7 ALLOW 的 SA6 owned 清单内）+ 8 个 wiki/raw 流水线档案（白名单）。**零越界**。
- **DENY 核查**：namespace-runtime/**、replication-protocol/**、docs/**、persistence/src/service.ts、registry 其余 src、其余包 —— git status 零触碰 ✅。
- **黑名单**：无 lockfile/备份/TASK.md 残留 ✅。

---

## 九、发现清单（按严重度；无 BLOCKER/HIGH/MEDIUM）

### F-1【LOW · 偏差 #1 裁决：接受，需 SA1 设计补注】ImportReplicaIssue 联合 additive 追加 NAMESPACE_NOT_FOUND

- **证据**：设计内部矛盾属实——§4.0.3 联合（design.md:295-301）不含 NOT_FOUND，而 §4.2 槽伪码 ①（:403-405）`return NOT_FOUND_ISSUE`（owner mismatch 分支），两文本不可同时满足（tsc 编译红）。实现落位 types.ts:289-294（additive 成员，复用既有冻结常量）+ registry.ts:1364-1368（槽内 return NOT_FOUND_ISSUE）。
- **裁决**：**additive 追加是正确的最小调和**。依据：①INV-10「owner mismatch 统一 NOT_FOUND 零存在性泄露」是不变量级要求，伪码行为是权威；②改伪码为 ALREADY_EXISTS 会破坏零泄露语义（owner 泄露存在性）；③与 ResetReplicaIssue 的 NOT_FOUND 成员对称；④SA6 锚不受影响（registry surface `HasImportReplica` 只要求 `code: string`，无负向断言——surface 文件 43-56 行实证；REG import 用例无 owner-mismatch 断言面）。
- **回流目标**：**SA1**——设计 §4.0.3 联合补 NAMESPACE_NOT_FOUND 成员（或加一致性注记「以 §4.2 伪码为准」），消除 R3 内部矛盾存档。SA3 无需改动。

### F-2【LOW · 偏差 #2 裁决：接受，登记 SA6 回流档案】import-red File 夹具 walk ENOENT 容错（6 行）

- **证据**：改动限于 `makeFileImportFixture().readStoreFiles` 的 walk（test:137-155）：`fsp.readdir` 外包 try/catch，`code === 'ENOENT'` → return（空清单），其余错误 rethrow。断言面（:205 filesBefore / :216 toEqual(filesBefore) / :283 toEqual([])）未被触碰。
- **零断言改动声称的核对**：该文件从未被 commit，无 git 基线可比对；以 SA6 报告 §8（import-red「零改动」）+ §2.1 计数（14 用例 = 6 共享×2 + File 重启 + 守卫）为基准核对——现文件 8 个 `it(` × 共享矩阵双 adapter = 14 用例，结构一致；ENOENT 容错位于夹具管道（非断言），与声称相符。
- **锚定力裁决**：**不削弱**。「零持久化写入 ⟹ 无文件可枚举」下 rootDir 缺席 ≡ 空 store 是该观察面的自身语义；若实现写入任何文件，目录即存在、walk 即列出、断言仍红。容错与 afterEach 既有的 `rm {force:true}` 同款精神。
- **纪律面**：超出 R-1/R-2 回流清单的 SA6 owned 文件改动（设计 §7 预测 import-red「零改动转绿」被证伪——基线红被更早的 `TypeError: importDoc is not a function` 掩盖，实现后缺口才显形）。SA3 已透明登记。
- **回流目标**：**总控**——将此 6 行并入 SA6 回流记录（或明示接受为 fixture 管道修正）；SA3 无需改动。

### F-3【INFO · 设计文档失同步 → SA1】§4.5.6 矩阵行 9 善后列与 R3 放置点表不一致

- **证据**：design.md:665 行 9 善后列 =「**已清理**（同上）」，而 R3 §4.4 放置点表（:515）+ §4.5.3 伪码（:572-574）把 lifecycle io gate 钉在入口（track/settle 之前、不建 archiving cell）——入口拒出时 cell「未建立」而非「已清理」。SA2 LOW-R2-1 的对齐请求指向设计矩阵文本，SA3 无权改 design.md。实现（lifecycle.ts:493-503）按 R3 放置点表正确落位。
- **回流目标**：SA1 一句话更正行 9 善后列为「未建立（入口拒出）」。实现无责。

### F-4【INFO · 设计文档计数瑕疵 → SA1】§9 命中数与 §4.11.2「七类」口径

- **证据**：`grep -rn "implements DocPersistence" packages/ --include="*.ts"` 实测 **17 行**（Memory+File 两实现 + file-persistence.test.ts:10 文档注释 + 14 个 stub 类，含 SA6 StubReplicaPersistence）；R3 §9（:1053）记 16 并单列 SA6 stub 行——口径相加恰 17，正文总数漏计 1。另 §4.11.2「七类 message」实数 §4.0.1 为 6 个错误类。均为纯文档计数，零裁决影响（optional 成员裁决依据「13 既有 stub」本身属实）。
- **回流目标**：SA1 顺手更正（INFO-R2-2 收尾）。

### F-5【INFO · 实现与伪码微差，锚定无影响】verify 段两段 try 合并、损坏字节无 cause 链接

- **证据**：设计 §4.5.4 伪码（:625）把 `Y.applyUpdate` 单独包 try 且示意 `DocArchiveIdentityError(/* cause: err */)`；实现（lifecycle.ts:395-413）合并为单一 try/catch，所有偏差路径统一 `new DocArchiveIdentityError()`（无 cause）。冻结类形状（§4.0.1:160-163）本就**无 cause 成员**——实现与冻结类一致，伪码注释是示意级。ARC 损坏用例仅锚「拒绝 + 零改动」（`.rejects.toThrow()`），无 cause 断言。无行为差异。
- **处置**：留档即可，无需改动。

### F-6【INFO · 未登记微偏差】capability gate 检查域拆分（单查 vs 设计伪码双查）

- **证据**：设计 §4.4 gate 伪码（:500-501）为 `typeof importDocFn !== 'function' || typeof persistence.archiveDoc !== 'function'`（双查）；实现 import 槽单查 `persistence.importDoc`（registry.ts:1391-1392）、reset 槽单查 `persistence.archiveDoc`（:1483-1484）。行为差异仅在「半能力第三方 Adapter」（有 importDoc 无 archiveDoc 或反之）：实现允许对应单路径继续，设计伪码拒绝。Memory/File 恒双备、SA6 stub 恒双备 ⟹ 零锚定差异、零测试影响；INV-13（缺席 loud）在「该路径实际消费的能力」上仍成立。检查域拆分是合理精化，但 gate 的 message 文本提及两者（importDoc/archiveDoc）而实查其一，略欠严谨。
- **处置**：留档；若 SA1 修订设计可二选一对齐（建议把 §4.4 伪码改为按槽单查，与实现一致）。

### F-7【INFO · 交 SA7 动态验证】活链路窗口两项

- (i) **INFO-R2-1 原项**：Memory dispose drain-then-clear 窗口（在途 writeArchive 已进入提交段的 archiveSnapshots 写入先于 clear() 生效）——机制与既有 mirror 同款（memory.ts:175-181），SA7 复跑覆盖。
- (ii) **本审补充**：dispose 恰落在 relocate-remove 的 rm 已进入后（file.ts:174-178 rm 不接 signal、进入后完整执行）——archive 返回 ok:true 且效果已落地（诚实）；以及 abort 后 remove 抛错路径的 Fatal(relocate-remove, committed:true) 收敛重试链。两窗口静态均诚实收敛，交 SA7 活链路确认。

---

## 十、SA3 报告「非偏差确认」三项的复核

1. **reset capability gate 取 R3 放置点表（① 后、② close 前）而非 §4.8 伪码 ④**：✅ 认可——R3 修订明文「消除 §4.4 与 §4.5.5 的放置歧义」且「gate 先于槽内一切持久化动作」；实现（1472-1492）gate 在 close/loadDoc/archiveDoc 全部之前，capability 缺席时零 Persistence 触达、零 Runtime 关闭。
2. **beginCloseCurrent 失败不发 idle-close-failed**：✅ 认可——该事件属 idle 状态机队列（AC7，observer.ts 既有形）；reset 的 close 失败按 §4.8.1 走 lifecycle-slot-failed(reset) + fatal；settle 处理器双臂 removeEntryAfterClose（registry.ts:984-987）与 beginIdleClose 失败臂的移除语义（:913-923）一致，key 不毒化。
3. **removeCommittedSnapshot 不传 signal 给 fsp.rm**：✅ 认可——Node RmOptions 无 signal 字段；入口 throwIfAborted 门 + 进入后完整执行满足 remove 契约（resolve ⟺ 主键缺席）；中止窗口归 committed:true fatal，语义同设计。

---

## 十一、动态审核重点（交 SA7）

1. F-7-i：Memory dispose × 在途 writeArchive 的 drain-then-clear 时序（设计 §4.10 R3 登记项）。
2. F-7-ii：dispose × relocate-remove 双窗口（rm 已进入 / abort 后 remove 抛错）的收敛重试链。
3. settle 诚实 pending 活体确认：degraded retry 武装 + 零在途 flush 下 archiveDoc 挂起 → dispose 后有限结算（B1 场景真实链路复跑）。
4. File 归档 latest-wins 覆盖：同 key 二次 create/import 后再归档，旧归档副本被原子覆盖、每 key 恰一份归档文件、tmp 零残留。
5. registry reset ∥ idle timer 迟爆 / ∥ shutdown 的活链路交错（静态推演闭合，动态确认）。

---

## 十二、验证证据汇总

| 命令 | 结果 |
|---|---|
| `npx vitest run <三个红灯文件>`（本次独立复跑，独立进程） | Test Files 3 passed (3) / Tests 55 passed (55) / Type Errors: no errors / **exit 0**（/tmp/sa4.log、/tmp/sa4-exit=0） |
| `git diff ebc5419 --stat -- packages/` | 11 文件 +1214/-14（与分派基线一致） |
| `git diff ebc5419 --name-only` | 恰 ALLOW 11 文件，零越界 |
| `git show ebc5419:packages/persistence/src/lifecycle.ts`（原 createDoc 逐行比对） | exclusiveCreate 抽取逐字节等价（§五.1） |
| `grep -rn "implements DocPersistence"` | 17 行（§F-4 口径说明） |
| `git diff ebc5419 -- packages/ \| grep -E "console.log|debugger|TODO|FIXME"` | 零命中（无调试残留） |

（总控已亲验：140 文件 1687 用例全绿、typecheck 10 包链 exit 0——本次不重复全量。）

## 十三、代码质量

- 注释密度与文件头注记风格与仓库既有先例一致（设计节引用格式统一「§4.x」；三处 REPLICATION_ID_PATTERN 副本互引注释闭环：registry.ts:165-169 ↔ lifecycle.ts:908-917）。
- 无注释掉的代码、无未使用导入（registry.ts 新增导入 DocArchiveFatalError/DocArchiveOperationalError/YjsDoc/ReplicationIdentityRef 均有使用点；lifecycle.ts 六个新错误类全使用）。
- file.ts importDoc 用 `import('yjs').Doc` 内联类型——与该文件零 Y 导入的现状一致的最小改动，非风格违例。

## 十四、结论

**verdict: pass。** 实现对冻结设计 R3 的全部 14 项决策、15 条不变量、三张错误矩阵逐一对位忠实；两个 BLOCKER 修复机制（INV-14 善后 / INV-15 三通知点）在精确位置落地；SA3 登记的 2 项偏差均裁决为忠实最小调和（F-1/F-2），另有 5 项 INFO 级残留（F-3..F-7）登记 SA1 补注 / SA6 归档 / SA7 动态验证，均不阻断。零回归由逐字节比对（§五）+ 全量绿灯（总控）双重证明。

**SA7 可进入动态验证。**
