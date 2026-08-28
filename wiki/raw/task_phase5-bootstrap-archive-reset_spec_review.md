Conclusion: clear

# Spec 轴终审报告 — issue #133「Phase 5: bootstrap import, archive, and guarded replica reset」

**Date**: 2026-05-30（Phase 4 双轴终审 · Spec/规格轴）
**审查对象**: worktree `/home/wangjian/nomicore-fix-issue-133`，`git diff ebc5419..dcda564`（HEAD=dcda564 实证；30 文件 +7605/-14，其中 src 11 文件、测试 7 文件、wiki/raw 流水线档案 12 文件）
**纪律**: 只读审查 + 本报告；未改任何 src/test/docs 文件
**规格源（全部亲读原文取证）**:
1. issue #133（`gh issue view 133 --repo welltop-jim-wang/nomicore --json body,comments`）：What to build（trusted Hub snapshot 安装缺席副本 + conflicted Peer 安全重置的完整**本地**生命周期）+ AC-1..AC-6；**comments 为空**，无反馈规格。
2. ADR 0010：:28（受信导入保留 Hub namespaceId）、:57（resetReplica 三步编排 + WS 禁触文件）、:65（bootstrap 五步第 3 步本地部分）、:218（Persistence 能力授权不增 catalog）——行号经 `grep -n` 按内容回查属实。
3. phase-5 文档：切片 2（:60-65）、切片 8（:111-116）、场景 15b（:173）、测试 seam（:178-184）、非目标（:190-202）。
4. 流水线反馈规格：SA2 R1（`…_sa2_review.md`，verdict: reject，§三 修订条件 4 必须 + 1 建议）、SA2 R2（`…_sa2_review_r2.md`，verdict: pass，残留 LOW-R2-1/2 + INFO-R2-1/2）、SA4（`…_sa4_review.md`，verdict: pass，F-1..F-7）、SA8 两份门禁报告（`…_conflict_report.md` N-1..N-9、`…_design_conflict_report.md` N'-1..N'-8）中设计承诺回应的部分。

---

## 一、AC-1..AC-6 逐条核对

### AC-1 ✅ 受信内部 bootstrap：保留 Hub namespaceId、detached Y.Doc 完整应用、ownership 转移前核对 META 复制身份

- **保留 Hub namespaceId（0010:28）**：`importReplica(owner, namespaceId, doc)` 全程不生成 ID——registry.ts:1362-1445 `runImportSlot` 以调用方 namespaceId 直建 entry；类型面 types.ts:479。测试锚：registry-phase5-bootstrap-reset-red.test.ts:331「成功导入：namespaceId 原样保留（非生成）」（断言 `lease.namespaceId === NS_B`、`META.docId/replicationId/epoch` 原样、open 复用同一身份）；:411「普通 create 面不受导入路径影响」（create 仍生成 `ns-`+32hex）。
- **META 核对先于 ownership 转移（0010:65）**：runImportSlot 冻结核对次序 ① entry 碰撞（owner 先核对，registry.ts:1364-1368）→ ②a `readMetaDocId`（registry.ts:209-217）→ ②b `readImportedReplicaFacts`（registry.ts:179-206，readReplicationFacts 判据族结构守卫副本 #1）→ ③ capability gate（:1390-1400）→ ④ 才调 `persistence.importDoc`（:1403）。核对失败锚：registry-red :359（缺失）/:373（格式违约）/:394（docId 不符）三例断言 `importCalls === []` + `loadDoc === null`（零持久化写入）。
- **detached Y.Doc 完整应用**：seam 输入 = detached 完整 Y.Doc（phase:62「从 detached、已核对身份的完整 Y.Doc 排他创建副本的受控 seam」逐字）；字节→Y.Doc 物化属切片 6 wire 侧（设计 §4.2/D-2 明文、SA8 Phase-0 报告 §4 背书该划分，见 N-3 登记）。内容完整锚：registry-red :331（`ROOT.n===123`）、import-red :177（loadDoc 后 ROOT/META 完整）。
- **Runtime 构造（0010:66 步骤 4）**：runImportSlot ⑤ 走既有单一构造路径 `factory(handle, () => persistence.saveDoc(handle))`（registry.ts:1432-1445）；factory throw → handle best-effort release + `NamespaceRegistryFatalError('import','runtime-construction',true)`，镜像 create DQ-7。

### AC-2 ✅ Bootstrap 排他创建：绝不覆盖、绝不静默合并

- **落位**：`importDoc` 与 `createDoc` 共享 per-key 排他管线 `exclusiveCreate`（lifecycle.ts:226-341）：live → duplicate、creating → duplicate、archiving → 等待重评估（:242-247）、reading → 等待探读（store 见快照即拒）；身份校验单点分叉先于 claim、先于任何 io（:232-234 分叉 + validateImportDoc :706-712）。
- **测试锚**：import-red :197（已存在 committed snapshot → DOC_DUPLICATE 零覆盖）/:225（同 key 并发两导入恰一成功）/:253（跨面排他：导入后普通 createDoc 同键仍 DOC_DUPLICATE）；registry-red :438（live entry → NAMESPACE_ALREADY_EXISTS 零覆盖零合并）/:461（无 entry 有 snapshot → ALREADY_EXISTS 旧快照零改动）/:489（并发两导入恰一）；SA7 2b（reset×import 并发 ×50 轮两形态确定）。
- **亲跑**：import-red 14/14 绿（exit 0）。

### AC-3 ✅ Memory/File 行为等价归档 + expectedReplicationIdentity 守卫

- **签名与前置（phase:63）**：`archiveDoc(owner, docId, expectedReplicationIdentity)`（contract.ts:79-85 optional + ReplicaPersistence :88-95 required；lifecycle.ts:343-356 入口）。前置「仅在无有效 handle/Runtime generation 时执行」= settle 段（lifecycle.ts:465-487：handles>0 → `DocArchiveActiveHandleError`；干净零-handle 当场驱逐；dirty 零-handle 强制即时 flush；degraded retry 武装 → 被动等待回退轮）。
- **身份守卫（权威 = 持久快照复制事实）**：guard-read（io.read）→ 单一谓词核对（lifecycle.ts:390-413 + `readPersistedReplicaFacts` :926-950 判据副本 #2）——错 id/错 epoch/缺失/恰一键/undefined/格式违约/载体异型/docId 不符/字节损坏统一 `DocArchiveIdentityError`。
- **双 adapter 等价**：同一 PersistenceLifecycle 状态机（两 adapter 不复制状态机，ADR 0006:157-159 纪律）；Memory 侧独立 `archiveSnapshots` Map 分区（memory.ts:80）+ `deleteSnapshot` hook + loud 配置门（memory.ts:101-118）；File 侧见 AC-5。
- **测试锚**：archive-red 共享矩阵 9 组双 adapter 同断言（:239 成功归档 loadDoc→null+slot 重建 /:270 identity 不匹配零改动 /:297 epoch 不符同拒 /:320 格式违约 /:346 active handle 拒绝→release 后成功 /:372 二次归档 DUPLICATE /:457 owner 分区）；SA7 1a-1d/6a-6b 动态边界。
- **亲跑**：archive-red 23/23 绿（exit 0）。

### AC-4 ✅ resetReplica 串行化 close→archive→bootstrap 资格；owner/identity race 拒绝零部分删除

- **签名（phase:113/0010:57 逐字）**：`resetReplica(owner, namespaceId, expectedLocalIdentity)`（types.ts:487-491；registry.ts:1686-1700 公共入口）。
- **串行化**：carrier FIFO 整槽串行（admitResetSlot registry.ts:1454-1466，`carrier.tail.then(() => runResetSlot(...))`）；槽内冻结次序 ① owner 核对（mismatch → NOT_FOUND 零泄露，:1472-1476）→ capability gate（:1482-1492，先于槽内一切持久化动作）→ ② 强制失效全部未决 lease（forceReleaseOutstandingLeases :941-951 + forceReleasing 旗标 :646/:853）→ cancelIdleArm（:955-961）→ close barrier（beginCloseCurrent :970-989，I2 纪律复用）→ ③ loadDoc 存在性探针（:1521-1539；null → NOT_FOUND 不触归档 seam）→ ④ archiveDoc 期望身份纯传递（:1554-1556）→ ⑤ bootstrap 资格 = key 缺席（:1574-1578，无显式动作）。
- **race 拒绝零部分删除**：owner mismatch 先于一切存储变更；identity mismatch → `NAMESPACE_RESET_IDENTITY_MISMATCH` + 本地文档完好（守卫拒绝即未删）；`DOC_ARCHIVE_DUPLICATE` → NOT_FOUND（无部分删除语义）；close 失败 → fatal committed:false（归档未发生，:1508-1512）。
- **测试锚**：registry-red :521（成功闭环 reset→open NOT_FOUND→import 成功）/:562（owner mismatch + `archiveCalls===[]`）/:586（identity mismatch 文档完好）/:611（missing key NOT_FOUND）/:625（在途 ROOT 写 + reset：写完整结算后归档、归档含写后值）/:651（并发 open+reset 两序确定）；SA7 2a-2d（×50 轮并发矩阵 + reset×shutdown + 双 reset 恰一）、§3（forceReleasing 观测面：零 entry-idle、lease-released 恰等于未决数）。
- **亲跑**：registry-red 18/18 绿（exit 0，含 :521/:625/:651 全部 AC-4 锚）。

### AC-5 ✅ File 归档受控路径 + 原子 rename；WS 不直接触文件

- **受控路径 + 原子 rename（phase:64）**：`{rootDir}/archive/users/{userId}/{docId}.snapshot`（+ 同名 `.tmp`）；file.ts:200-210 `resolveArchivePaths`（SAFE_PATH_SEGMENT 双段守卫复用）；:160-172 `writeArchiveSnapshot`（mkdir→writeFile tmp→rename，abort 三门位，同名重复归档 = rename 原子覆盖 latest-wins）；:174-178 `removeCommittedSnapshot`（fsp.rm force:true ENOENT 容忍）；模块纪律 = 全部 fs 操作包内私有。
- **WS 禁触文件（0010:57/phase:65）**：本 diff 不含任何 WS 包（packages/ 无 ws-replication；replication-protocol 包零触碰）；文件访问结构性封闭在 @nomicore/persistence 内（INV-11）。
- **测试锚**：archive-red File 专属 :501（归档落点 rootDir 内、恰一份归档文件、字节 decode META 完整、零 tmp 残留）/:538（failNextWrite → OPERATIONAL + 目录树零变化，原子 rename 无部分状态）/:600（rootDir 外零新增文件）；SA7 5a-5e（真实 tmpdir 崩溃恢复实机：重启恢复/tmp 残留覆盖式清理/双副本收敛/owner 分区/dispose×relocate-remove 窗口）。
- **亲跑**：archive-red 23/23 + SA7 persistence 动态 14/14 绿（含 5a-5e）。

### AC-6 ✅ 测试覆盖六要素

| 要素 | 测试证据 | 亲跑 |
|---|---|---|
| duplicate bootstrap | import-red :197/:225/:253；registry-red :438/:461/:489 | ✅ |
| crash/error committed 事实 | archive-red :396（hold-before-commit 窗口零变化、release 后提交恰一次）/:433（failNextRead→OPERATIONAL 零改动）/:538（failNextWrite→OPERATIONAL）；relocate-remove → committed:true fatal + 重试收敛 = SA7 4b（:561）；冻结映射导出 contract.ts:159-163 | ✅ |
| active handle 拒绝 | archive-red :346（DOC_ARCHIVE_ACTIVE_HANDLE → release 后成功） | ✅ |
| identity mismatch | archive-red :270/:297/:320；registry-red :586；SA7 6a/6b（epoch 演进后旧身份拒绝 + 文档完好 + open 恢复） | ✅ |
| archive 恢复 | archive-red :564（File dispose→新实例 loadDoc→null、归档副本 decode 完整）；SA7 5a-5c；import-red :315（导入副本重启恢复） | ✅ |
| 独立 owner 分区 | archive-red :457；import-red :288；registry-red :681；SA7 5d（实机文件树对比） | ✅ |

---

## 二、ADR 0010 四条关键文本逐句对位

| 权威文本（行号经内容回查） | 实现落位 | 结论 |
|---|---|---|
| :28「复制 bootstrap 使用内部受信任导入保留 Hub namespaceId，不是普通 create」 | registry.ts:1362-1445 importReplica 全链保留调用方 namespaceId；普通 create 接纳零改动（registry-red :411 保持性守卫 + :841 随机生成纪律不变）；信任模型按 0010:79 同款纪律文档化于 types.ts:467-486 JSDoc（无 capability token） | ✅ |
| :57「resetReplica()：Registry 先关闭本地 Runtime generation，再通过 Persistence 归档旧副本，最后允许重新 bootstrap。Persistence 为此增加受身份前置条件保护的归档 seam；WS 层不得直接读写 snapshot 文件」 | runResetSlot ②close（:1494-1520）→ ④archiveDoc（:1541-1571）→ ⑤资格=key 缺席（:1574-1578）三步次序逐句对应；archiveDoc 身份前置 = lifecycle.ts:390-413 单一谓词；WS 层不存在、文件访问封闭于 persistence 包 | ✅ |
| :65「peer 在 detached Y.Doc 应用基线、严格核对 META 身份，再通过 Persistence 的受控复制导入能力排他创建」（五步第 3 步本地部分） | 严格核对 = runImportSlot ②a/②b（先于一切 Persistence 调用）；排他创建 = exclusiveCreate；「应用基线到 detached Y.Doc」的物化在 seam 上游（切片 6），phase:62 对 seam 输入的措辞逐字支持该划分（N-3 登记） | ✅（附划分注记） |
| :218「为 Persistence 增加复制导入与归档所需的受控能力；namespaceId 的概率全局唯一由生成策略负责，Persistence 不增加跨 owner catalog 或原子唯一约束」 | 能力增加 = importDoc/archiveDoc optional 成员 + ReplicaPersistence 派生接口（contract.ts:72-95）；生成策略仍在 Registry（#131 CSPRNG 零改动）；无跨 owner catalog——保持性守卫锚：import-red :344「无 list/enumerate 公共方法」+ 两份 surface test-d 绿守卫（removeDoc/deleteDoc/listDocs/enumerateDocs/moveDoc 禁词面）+ SA7 §7 运行时枚举键探针 | ✅ |

## 三、phase 切片 2 五条 + 切片 8 签名逐项对位

| 切片 2 条目（phase:62-65） | 落位 | 结论 |
|---|---|---|
| 从 detached、已核对身份的完整 Y.Doc 排他创建副本的受控 seam | importDoc（contract.ts:72-77；lifecycle.ts:215-217 → exclusiveCreate）+ Registry importReplica | ✅ |
| `archiveDoc(owner, docId, expectedReplicationIdentity)`：仅在无有效 handle/Runtime generation 时执行 | 签名逐字（contract.ts:79-85）；前置 = settle 段 + ActiveHandle 拒绝 + Registry 先 close 编排 | ✅ |
| File 同 rootDir 受控 archive 路径 + 原子 rename | file.ts:200-210/:160-172（tmp→rename 原子提交） | ✅ |
| Memory 行为等价、可测试 | memory.ts:80/95-118（独立分区 + deleteSnapshot hook + loud 门）；共享矩阵双 adapter 同断言 9 组 | ✅ |
| 四分类稳定词汇 + 不得由 WS 插件直接操作文件 | 见 §四；无 WS 包被触碰 | ✅ |

切片 8 resetReplica 签名（phase:113「Peer `resetReplica(owner, namespaceId, expectedLocalIdentity)` 编排 close→archive→允许 bootstrap」）：types.ts:487-491 + registry.ts:1686 逐字一致 ✅。切片 8 第 2/3 条（targets add/remove、结构化 observer seam）属 ws-replication 插件域，本票未顺手实现（N-7 遵守，见 §八）。

## 四、切片 2 四分类在代码中的实际分类面（逐一取证）

| 分类 | Persistence 面 | Registry 映射面 |
|---|---|---|
| duplicate | 导入复用冻结 `DocDuplicateError`（DOC_DUPLICATE）；归档新增 `DocArchiveDuplicateError`（DOC_ARCHIVE_DUPLICATE，contract.ts:130-137） | 导入 → NAMESPACE_ALREADY_EXISTS（registry.ts:1406-1408）；归档 DUPLICATE → NAMESPACE_NOT_FOUND（:1549-1551） |
| identity mismatch | `DocImportIdentityError`（DOC_IMPORT_IDENTITY_MISMATCH，contract.ts:100-108）；`DocArchiveIdentityError`（DOC_ARCHIVE_IDENTITY_MISMATCH，:111-118，单一谓词收编损坏/缺失/docId 不符） | 导入前置 ②a/②b → NAMESPACE_IMPORT_IDENTITY_MISMATCH / NAMESPACE_IMPORT_INVALID_IDENTITY；归档 → NAMESPACE_RESET_IDENTITY_MISMATCH（:1543-1548） |
| operational failure | `DocArchiveOperationalError`（DOC_ARCHIVE_OPERATIONAL，committed:false 字面量 + cause 保留，contract.ts:140-149）；导入复用 DocCreateOperationalError | 归档 → NAMESPACE_RESET_FAILED + `reset-archive-failed` 事件（:1557-1560）；导入 → NAMESPACE_IMPORT_FAILED + `import-persist-failed`（:1412-1419） |
| committed-aware fatal | `DocArchiveFatalError` + 冻结映射 `DOC_ARCHIVE_FATAL_PHASE_COMMITTED = {guard-read:false, relocate-write:false, relocate-remove:true}`（contract.ts:152-178，Object.freeze 导出）；导入复用 DocCreateFatalError | code-first 判别 `errorCodeOf`/`committedOf`（registry.ts:224-238）+ instanceof 双保险；committed 事实原样传播（:1421-1429/:1561-1571）；duck-typed stub 锚（registry-red :279-302） |

四分类齐备、无第五类（损坏收编 identity 族系 SA6 边缘提示 8 的冻结裁决）。✅

## 五、场景 15b 本地生命周期闭环（identity conflict → resetReplica → archive → 重新 bootstrap）

端到端证据齐备（phase:173 标注 15b 属切片 3-8，本票交付其本地部分，wire 侧稳定冲突留切片 6——SA8 Phase-0 §5 背书该划分）：

1. **identity conflict 拒绝**：registry-red :586（stale 身份 → RESET_IDENTITY_MISMATCH + 文档完好可 open）；SA7 6a（导入 epoch1 → bump epoch → 落盘 → 旧 epoch reset 拒绝 + 文档完好 + open 恢复）。
2. **resetReplica → archive → 重新 bootstrap 闭环**：registry-red :521（stub 观测 lease:'released' + archiveCalls[0].expected 纯传递）；:707（**Memory 真实全链**：create→enable→flush→reset→open NOT_FOUND→import 新 epoch→身份/内容正确）；:774（**File 真实全链**：同 rootDir 重启语义 + 归档文件在场 + import + 重启恢复）。
3. 亲跑：registry-red 18/18 绿，含上述三例闭环。✅

## 六、SA2 R1 §三 修订条件 4+1 逐条落位

| R1 条件 | 落位证据 | 结论 |
|---|---|---|
| 1（BLOCKER-1 settle×dispose）：dispose 同步段 splice-通知 + flush finally 首位无条件通知 + settle 全程 track | lifecycle.ts 通知点 2 = dispose 同步段（:558-559 区域 diff hunk：clearTimers 后、cells.clear() 前同一同步块）；通知点 1 = flush finally 首位（:833-835，先于 isCurrent 早退）；通知点 3 = 入口 track（:350 `return this.track(this.runArchiveDoc(...))`）；动态实证 = SA7 1c/1d（BLOCKER-1 原始脚本动态版，亲跑绿） | ✅ |
| 2（BLOCKER-2 archiving claim 失败善后） | runArchiveDoc op 闭包 try/catch 全包；catch 侧与成功末尾同款 `cur?.state==='archiving' && cur.claim===claim` 守卫删除后 rethrow（lifecycle.ts:416-429）；置 cell 前抛出点（:349/:367/:471）无 cell 可毒化；ARC 五锚（:280/:305/:331/:442/:549 拒绝后 loadDoc 非 null）亲跑绿 | ✅ |
| 3（MEDIUM-3 seedForTest 守卫扩 archiving） | lifecycle.ts:521-527 `reading/creating/archiving` 一律抛 'test seed requires an idle key cell'（文本不变） | ✅ |
| 4（MEDIUM-4 Memory 归档键同池碰撞） | 独立 `archiveSnapshots: Map`（memory.ts:80）结构性分区；writeArchive 不经 writeSnapshot hook（:101-107）；dispose 增 archiveSnapshots.clear()（:179-181） | ✅ |
| 5（建议：fatal code-first + import 接纳段冻结） | errorCodeOf/committedOf code-first + instanceof 双保险（registry.ts:224-238）；importReplica 接纳段（registry.ts:1673-1683：acceptance 零输入访问 → validateOpenIdentity 零存储访问 → carrier FIFO，注释明文冻结） | ✅ |

## 七、SA2 R2 残留 4 项处置留痕

| 残留 | 处置 | 结论 |
|---|---|---|
| LOW-R2-1（io gate 放置点） | 实现按 R3 §4.4 放置点表落位（lifecycle.ts:493-503 入口同步段、track/settle 之前）；设计矩阵行 9 善后列已在 R4 更正为「无 cell 可清（入口拒出）」（design.md:671，R4 注记明文引用 SA4 F-3） | ✅ |
| LOW-R2-2（forceReleasing 跨 key 覆写） | 设计 R3 §4.8.2 三层保证注记 + 实现注释（registry.ts:644-651）；实现以 entry-identity 判别 + 置位→循环→清位零 await 同步块（:941-951）结构性满足；SA7 §3 观测面用例亲跑绿 | ✅ |
| INFO-R2-1（Memory dispose 窗口） | 转 SA7 活链路：SA7 4a（drain-then-clear + committed:true fatal + 外部主键未删 + 新实例重试收敛）亲跑绿 | ✅ |
| INFO-R2-2（§9 计数 17→16） | design R4 :1059 按口径更正（git-grep 域 16 / 文件系统域 17，差异注明） | ✅ |

## 八、SA4 F-1/F-2 裁决执行留痕 + F-3..F-7 去向

- **F-1（ImportReplicaIssue 补列 NAMESPACE_NOT_FOUND）**：实现 types.ts:288-308（additive 成员在列）；设计 R4 §4.0.3 补列 + 矛盾留痕注记（design.md:298-303）；dispatch.md 第 17 行登记「已完成」。✅
- **F-2（import-red File 夹具 walk ENOENT 容错 6 行）**：实现在场（import-red :137-155，fixture 管道容错非断言面）；sa6_red.md §8.6 留痕 + §2.1 表单行标注。✅（§8.6 附带计数瑕疵见 N-4）
- **F-3**（设计矩阵行 9 失同步）→ R4 已更正（design.md:671）✅；**F-4**（§9 计数）→ R4 已更正 ✅；**F-5**（verify 段微差，锚定无影响）留档 ✅；**F-6**（gate 检查域拆分单查）留档——实现 import 槽单查 importDoc（registry.ts:1391-1392）、reset 槽单查 archiveDoc（:1483-1484），行为差异仅在半能力第三方 Adapter，message 提及两者略欠严谨（SA4 原登记 INFO，维持）；**F-7**（活链路两窗口）→ SA7 4a/4b/5e 覆盖亲跑绿 ✅。

## 九、SA8 N/N' 观察项中设计承诺回应的落位抽查

- **N-1**（判据单点）：三处结构守卫副本互引注释闭环（runtime replication-write.ts ↔ registry.ts:165-172 ↔ lifecycle.ts:908-917）；判据逐条复刻（两键真缺席/恰一键/undefined 值/格式违约/载体异型收编）。✅
- **N-2**（bootstrap 资格 = key 缺席）：registry.ts:1574-1578 无显式动作/无标记/无新枚举；surface 绿守卫证无 wire 面。✅
- **N-3**（词表授权链）：errors.ts:23-32 operation +'reset'|'import' append-only（既有三值不动）；observer.ts:31/47-49 事件联合 append-only；phase 词表零新增（fatal phase 落既有 lifecycle-slot-internal/runtime-construction）。✅
- **N-4**（受信路径暴露面）：公共方法 + 文档化信任纪律（types.ts:467-486 JSDoc 明文 0010:79 同款）；无 capability token；无新增通用按 key 管理面（surface 负向守卫 + SA7 §7 运行时枚举探针双锚）。✅
- **N-5**（degraded 交互）：settle 尊重 retry 回退、被动等待、不热循环（lifecycle.ts:465-487）；SA7 1b 实测计数锚（逐步 +1、总尝试恰 4 次）亲跑绿；「不得以 reset 之名绕过 retry」逐字满足。✅
- **N-6**（归档 tmp 协调）：file.ts 归档子树 + 每 key 至多一份 tmp + 覆盖式清理 + tmp 永非提交态 + 主键区读路径清理结构性不触及归档区；SA7 5b（tmp 残留恢复实机）亲跑绿。✅
- **N-7**（切片归位）：本 diff 零切片 3-7 面（见 §十）；切片 8 第 2/3 条未顺手实现。✅
- **N-8**（Memory 等价操作化）：等价面 = 共享矩阵九组断言双 adapter + loadDoc→null + slot 重建；恢复面归 File（phase:183）；deleteSnapshot hook + loud 配置门在场。✅
- **N-9**（单一构造路径）：runImportSlot ⑤ 与 open/create 同款 factory 调用行；TOCTOU 收编 committed:true fatal；namespace-runtime 包零改动（diff --name-only 实证）。✅
- **N'-5**（observer 事件复用）：reset 探针复用 `open-load-failed`/`handle-release-failed`（registry.ts:1523/1533）——原报告登记为「建议低成本区分，非必须」，维持未区分（见 N-2 登记）。
- **N'-6**（计数勘误）/ **N'-7**（三副本漂移防护：注释互引 + 格式违约用例三消费包各有锚——runtime 既有 replication-write 测试 / registry-red :373 / archive-red :320）/ **N'-8**（SA6 回流 R-1/R-2 落位：archive-red :127-131 + registry-red :718-723 deleteSnapshot hook；两 surface 锚改指 ReplicaPersistence）：均在案。✅

## 十、非目标与边界核查

- **越界实现切片 3-7**：零。`git diff --name-only` 恰 30 文件（src 11 = persistence 6 + registry 5；测试 7；wiki/raw 12）。packages/ diff 内 `ReplicationSession|openReplicationSession|WebSocket|bearer` 零代码命中（仅 3 处注释引用 phase 文档标题）；无认证/授权/wire 状态机/ReplicationSession 面；replication-protocol 包零触碰；apps/ 不存在于本 diff。
- **DENY 面**：namespace-runtime/** 零触碰、replication-protocol/** 零触碰、docs/** 零触碰、persistence/src/service.ts 零触碰（diff --name-only 实证）。import-red 对 `namespace-runtime/test/durable-snapshot-wait.js` 为只读 import（测试复用既有 #108 工具，未修改该包）。
- **phase 非目标（:190-202）逐条**：无自动覆盖 identity/epoch 冲突（AC-2 锚）、无 list/discovery/通配 selector（保持性守卫锚）、无第二 transport、无 quorum/线性一致面——均未被触碰。
- **ADR 0010 非目标**同款核查通过。
- **卫生**：diff 内 console.log/debugger/TODO/FIXME 零新增命中。

## 十一、可复现验证记录（本审亲跑，独立进程）

| 命令 | 结果 |
|---|---|
| `gh issue view 133 --repo welltop-jim-wang/nomicore --json title,body,comments` | 原文取证（本报告 §首）；comments=[] |
| `npx vitest run --typecheck packages/namespace-registry/test/registry-phase5-bootstrap-reset-red.test.ts` | **18 passed (18) / Type Errors: no errors / exit 0**（AC-1 :331、AC-4 :521、AC-6 :681-840 抽样全覆盖） |
| `npx vitest run --typecheck packages/persistence/test/persistence-phase5-import-red.test.ts packages/persistence/test/persistence-phase5-archive-red.test.ts` | **37 passed (37) / no type errors / exit 0**（AC-2/AC-3/AC-5/AC-6 persistence 面） |
| `npx vitest run --typecheck <两份 surface test-d>` | **8 passed (8) / exit 0**（类型面锚 + 禁词面绿守卫） |
| `npx vitest run packages/persistence/test/persistence-sa7-phase5-bootstrap-dynamic.test.ts packages/namespace-registry/test/registry-sa7-phase5-bootstrap-reset-dynamic.test.ts` | **24 passed (24) / exit 0**（SA7 活链路全量：BLOCKER-1 动态版、并发矩阵 ×50、F-7 双窗、File 崩溃恢复实机） |
| `git diff --check ebc5419..dcda564` | 1 处报障：wiki/raw/…_sa6_red.md:219 new blank line at EOF（见 N-1） |

合计亲跑 87 用例全绿（7 文件），与 SA4（55/55）、SA7（24/24×3 次）、总控（1711 全量）三方记录互证一致。

## 十二、发现清单

**BLOCKER：0　HIGH：0　MEDIUM：0　LOW：1　INFO：4**

- **N-1【LOW】`git diff --check` 单处报障**：wiki/raw/task_phase5-bootstrap-archive-reset_sa6_red.md:219 新增 EOF 空行（committed 在内）。流水线 raw 档案、非代码面；但 phase-5 收口门禁（phase:204-212）列有「`git diff --check` 通过」，阶段收口前需随手删除该空行。不影响本票任何规格项。
- **N-2【INFO】AC-1「applies a full update to a detached Y.Doc」的物化段不在本票 seam 内**：seam 输入为已物化的 detached Y.Doc（phase:62 逐字措辞支持；SA8 Phase-0 §4 与简报:42 划分背书；设计 §4.2/D-2 明文）。测试以直接构造完整 Y.Doc 模拟 detached 输入。登记防后续复审把「字节→Y.Doc 物化」误读为本票缺口——它属切片 6 wire 侧。
- **N-3【INFO】observer 事件名复用维持原状（N'-5）**：reset 探针 load 失败发 `open-load-failed`（registry.ts:1523）、release 失败发 `handle-release-failed`（:1533），metrics 归因混入 open 域；SA8 原登记「cause 类型可判别，非必须」，设计未采纳区分。内部 seam append-only 无违规，留痕即可。
- **N-4【INFO】sa6_red §8.6 复跑计数与本文其他处不一致**：§8.6 记「archive-red（22）与 registry-bootstrap-reset-red（19）亦全绿」，而 §2.1 表与本审实测均为 archive-red **23** / registry-red **18**（SA4 55/55 = 23+14+18 互证）。纯流水线档案计数瑕疵，零裁决影响。
- **N-5【INFO】expectedLocalIdentity 接纳段无运行时形状校验**：registry.ts:1697 直接 `as ReplicationIdentityRef` 纯传递；垃圾形状输入将以 RESET_IDENTITY_MISMATCH 失败安全收口（守卫权威 = 持久快照复制事实）。受信路径模型（0010:79）+ contract.ts:42-44 注释（「本类型自身不携带运行时校验」）下属既定设计方向，非缺陷。

## 十三、结论

**Conclusion: clear。**

issue #133 的 AC-1..AC-6 全部在 diff 与测试中有可核对落地证据；ADR 0010 四条关键文本逐句对位一致；phase 切片 2 五条与切片 8 resetReplica 签名逐项一致；四分类在代码中的分类面完整且无第五类；场景 15b 本地生命周期闭环有三层端到端测试证据（stub 编排观测 + Memory 全链 + File 全链含重启）；SA2 R1 修订条件 4+1 全部机制级落位、R2 残留 4 项与 SA4 F-1..F-7 全部有处置留痕（含设计 R4 回流）；SA8 N/N' 观察项的设计承诺在实现中逐条在场；非目标与 DENY 面零越界。亲跑 87 用例全绿。唯一 LOW（N-1）为 raw 档案的 `git diff --check` 空行瑕疵，不阻断本票，建议阶段收口前顺手清理。
