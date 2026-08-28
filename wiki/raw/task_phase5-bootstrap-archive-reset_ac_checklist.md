# AC 门禁清单 — issue #133「Phase 5: bootstrap import, archive, and guarded replica reset」

门禁时间：Phase 3.5（SA7 pass 后、双轴终审前）。核对人：总控（Controller）。
证据基线：worktree /home/wangjian/nomicore-fix-issue-133，diff ebc5419..工作树（11 src 文件 +1214/-14 + 7 个测试文件新增）；全量 `pnpm test` 142 文件 1711 用例全绿、`pnpm typecheck` 10 包链 exit 0（总控亲验 + SA3/SA4/SA7 三方互证）。

## AC-1 ✅ 受信内部 bootstrap 路径：保留 Hub namespaceId、detached Y.Doc 完整应用、Persistence ownership 转移前核对 META 复制身份

- 落位：`NamespaceRegistry.importReplica(owner, namespaceId, doc)`（设计 §4.2；registry.ts `runImportSlot`——① entry 碰撞（owner 先核对零泄露）→ ②a `META.docId === namespaceId` → ②b `readImportedReplicaFacts`（readReplicationFacts 判据族结构守卫副本）→ ③ capability gate → ④ `persistence.importDoc`（此后才发生 ownership 转移）→ ⑤ 单一 Runtime 构造路径）。输入 = detached 完整 Y.Doc（字节物化属后续 WS 切片，非本票 seam）。
- 核对失败零写入实证：SA6 REG 四用例（`importCalls===[]` + `loadDoc===null` + store 零残留）。
- 测试锚：registry-phase5-bootstrap-reset-red.test.ts（保留 Hub namespaceId/META 身份原样；docId 不符 → NAMESPACE_IMPORT_IDENTITY_MISMATCH；缺失/格式违约 → NAMESPACE_IMPORT_INVALID_IDENTITY）+ SA7 registry 链动态用例。

## AC-2 ✅ Bootstrap 排他创建：绝不覆盖、绝不静默合并既有本地文档

- 落位：`importDoc` 复用 createDoc 同一 per-key 排他 claim 管线（exclusiveCreate；cache 命中/store 见快照/并发 claim 三判定 → 冻结 `DocDuplicateError`）；普通 create 随机生成纪律零改动（SA6 保持性守卫绿）。
- 测试锚：IMP 三用例（live entry duplicate / committed snapshot duplicate / 同 key 并发两导入恰一成功）+ REG ALREADY_EXISTS 双形态 + SA7 2b reset×import 并发 ×50 轮。

## AC-3 ✅ Memory/File 行为等价归档语义 + expectedReplicationIdentity 守卫

- 落位：`archiveDoc(owner, docId, expected)`（设计 §4.5：settle 排空 → archiving claim → guard-read(io.read) → 单一身份谓词（错 id/错 epoch/缺失/损坏/docId 不符统一 DOC_ARCHIVE_IDENTITY_MISMATCH）→ relocate(writeArchive→remove)）；Memory/File 双 adapter 同一状态机（ADR 0006:157-159 平行验收纪律）；守卫权威 = 持久快照复制事实（D-7）。
- 测试锚：ARC 共享矩阵九组用例双 adapter 同断言（23 用例含守卫绿）+ SA7 动态 1a-1d/6a-6b。

## AC-4 ✅ Registry resetReplica 串行化 close→archive→bootstrap 资格，owner/identity race 拒绝零部分删除

- 落位：`runResetSlot`（registry.ts；carrier FIFO 整槽串行——① owner 核对（mismatch → NAMESPACE_NOT_FOUND 零泄露）→ capability gate → ② 强制失效未决 lease（forceReleasing 旗标）+ 取消 idle 武装 + close（I2 纪律复用 closePromise）→ ③ loadDoc 探针（null → NOT_FOUND 不触归档 seam）→ ④ archiveDoc（期望身份纯传递）→ ⑤ key 缺席即 bootstrap 资格）；identity mismatch → NAMESPACE_RESET_IDENTITY_MISMATCH + 本地文档完好可 open（INV-6）；DOC_ARCHIVE_DUPLICATE → NOT_FOUND（无部分删除语义）。
- 测试锚：REG AC-4 七用例 + SA7 并发矩阵 2a-2d（×50 轮、含 reset×shutdown、双 reset 并发）、6a/6b 动态身份边界。

## AC-5 ✅ File 归档受控路径 + 原子 rename；文件访问封闭在 Persistence 包内

- 落位：`{rootDir}/archive/users/{userId}/{docId}.snapshot` + 同名 `.tmp` 暂存 + tmp→rename 原子提交（file.ts writeArchiveSnapshot/removeCommittedSnapshot/resolveArchivePaths 包内私有 seam）；SAFE_PATH_SEGMENT 双段守卫；latest-wins 单槽覆盖；tmp 协调规则（每 key 至多一份、覆盖式清理、tmp 永非提交态）。WS 层不存在于本票；seam 设计使文件访问只能经 Persistence 包（AC-5 后半句的结构保证）。
- 测试锚：ARC File 专属（归档落点在 rootDir 内、单文件、无 tmp 残留、字节可 decode、前后对比 rootDir 外零新增）+ SA7 重点 5（5a-5e：重启恢复/tmp 残留恢复/双副本收敛/owner 分区实机）+ SA7 重点 7 运行时公共面探针（零禁词命中）。

## AC-6 ✅ 测试覆盖：duplicate bootstrap / crash·error committed 事实 / active handle 拒绝 / identity mismatch / archive 恢复 / owner 分区独立

- duplicate bootstrap：IMP/REG 双 layer（上述 AC-2 锚）。
- crash/error committed 事实：ARC fault seam 注入（failNextRead/failNextWrite/hold-before-commit → committed:false 运营分类 + 零改动）；relocate-remove → committed:true fatal + 重试收敛（设计 §4.5.5/§4.5.6；SA7 4b 动态实证）。
- active handle 拒绝：ARC/REG（live handle → DOC_ARCHIVE_ACTIVE_HANDLE；release 后归档成功）。
- identity mismatch：双 layer（Persistence DOC_ARCHIVE_IDENTITY_MISMATCH / Registry NAMESPACE_RESET_IDENTITY_MISMATCH；epoch 不符同拒——SA6/SA7 双锚）。
- archive 恢复：File 归档文件 decode + META 身份完整 + 重启新实例恢复（ARC + SA7 5a-5c）；Memory 等价面 = loadDoc→null + slot 重建 + hook store 删除可观测（SA7 4a）。
- 独立 owner 分区：ARC/IMP/REG 三文件 ALICE/BOB 用例 + SA7 5d 实机文件树对比。
- 计数：SA6 锚 55 用例（52 行为 + 3 守卫）+ SA7 动态 24 用例 + 类型锚 8（4+4）——全绿。

## 门禁结论

**AC 6/6 全部通过，零回流项。** 流水线档案：简报 / SA8 前置门禁（clear）/ SA6 红灯 + 回流 / SA1 设计 R4 / SA8 设计复审（clear）/ SA2 R1 reject → R2 pass / SA3 实现（2 偏差裁决接受）/ SA4 静态验尸（pass）/ SA7 动态验证（pass，零缺陷）。
