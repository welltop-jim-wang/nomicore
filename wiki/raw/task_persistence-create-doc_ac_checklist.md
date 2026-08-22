# AC 逐条确认门禁 — DocPersistence createDoc（issue #64）

- 门禁时间：2026-08-21 23:2x（Phase 3.5，评审双清后）
- 验收基准：`wiki/raw/task_persistence-create-doc.md` Required semantics 13 条（issue #64 body；PRD `docs/prd/persistence-create-doc.md` 不存在，dispatch log 已备案）
- 证据基线：commit `4e802b8`；总控亲验 `pnpm test` 491/491 绿（R2 修复后）→ SA7 补充测试后新基线 **499/499** 绿（`task_persistence-create-doc_sa7_report.md` §2.4/§4）；`pnpm typecheck` exit 0
- 用例编号 = `packages/persistence/src/testing.ts` 共享套件 `describeDocCreateContract` 10 用例 + lease 套件 3 条 + 模块契约 1 条（SA6 锚定，简报「SA6 红灯测试记录」节有映射表）

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| 1 | `createDoc` 对 `(owner.userId, docId)` 排他创建；cache/store 已存在或并发创建时稳定 duplicate，不覆盖 | ✅ | 用例 3（cache 路径 + fresh 空缓存实例查 store 路径均拒 duplicate、不覆盖已提交内容、不销毁 challenger）；用例 4（并发恰一成功、enteredWrites===1、提交内容=winner）；SA7 §2.2 | 已实现 |
| 2 | duplicate 稳定 error code 或专用错误类型，无需解析 message | ✅ | `DocDuplicateError`（`code='DOC_DUPLICATE'` 自有可枚举属性）自 `@nomicore/persistence` 导出；用例 3 `rejects.toMatchObject({ code: 'DOC_DUPLICATE' })` + instanceof 锚定；SA4 R1 通过项（§10 落实对账） | 已实现 |
| 3 | 创建成功前初始完整 snapshot 已提交；FilePersistence temp→rename 提交点，不新增 fsync | ✅ | 用例 1：createDoc resolve 前初始快照已提交（fresh 实例不经 saveDoc 直读可见）；R4 起 fresh 断言经真实 store 验证（U1 保真）。FilePersistence temp→rename 提交点：本票 DENY `src/file.ts`（设计 §14），由协调条款指定的 #58 接入同一 seam；提交段原子性承诺（signal.aborted 后不执行提交段）已在 IO seam 落地（设计 §5.2，SA4 R2-#4 对账通过）——本票交付共享 core 与提交点语义，File 侧锚定属 #58 | 已实现（#58 边界已注明） |
| 4 | 成功时签发有效 lease，`handle.owner === owner` 且 `handle.doc === doc`，Persistence 接管 doc 生命周期 | ✅ | 用例 1：owner/doc 同一对象断言 + `handle.user` 不存在 + 同实例 load 共享 live doc + 无遗留 timer；lease 套件 3 条（独立 handle/幂等 release/foreign+released 拒绝）全绿 | 已实现 |
| 5 | 失败时不返回 handle、不缓存、不销毁传入 doc，所有权归调用方 | ✅ | 用例 6：初始写失败 → 拒绝（原错 message 保留）、fresh loadDoc=null（不缓存）、`doc.isDestroyed===false`、无 timer、同 key 可重 create 且无 stale claim | 已实现 |
| 6 | 仅校验 `META.docId === docId`，不校验 VFSL/ROOT/createdAt | ✅ | 用例 9：docId 不匹配/缺失 → 响亮拒绝（message 含 META.docId）；无 SCHEMA/无 ROOT/createdAt 垃圾值/ROOT 为 Y.Text 均通过；ADR-0006 修订节同文（§12 逐字落地，SA4 字节比对 exact match） | 已实现 |
| 7 | create/create 与 create/load 共享 per-key coordination；并发 create 恰一成功；create 获胜后 load 不落 null | ✅ | 用例 4（create/create）；用例 5（load 在 create 获胜后 pending 不落 null、`loaded.doc === created.doc`）；SA7 §2.4：5a（adoption + claim-join 驱逐双路径非 null）、5d（hung read 不阻塞 waiter） | 已实现 |
| 8 | 不同 key 的操作不互相串行 | ✅ | 用例 8：第一 key 写 in-flight 时第二 key create 在 2s 超时守卫内完成（全局串行即红） | 已实现 |
| 9 | A owner/B accessor 只接收 A；A/doc1 与 B/doc1 隔离 | ✅ | 用例 7：A/doc1 与 B/doc1 互不视为 duplicate、内容隔离（doc 实例不同）、未知 key/他用户 loadDoc=null；SA4 R1 修复后跨 store 泄漏复现回归转绿（SA7 §2.1，升格持久契约用例） | 已实现 |
| 10 | `DocHandle.user`、内部 Entry 参数/字段、契约测试和文档统一迁移 owner 语义 | ✅ | 设计 §9 迁移清单逐处落实（SA4 R1 通过项对账）：index.ts `DocHandle.owner`、lifecycle Entry 参数字段、testing.ts 套件、testkit 参数名、ADR-0006 修订节；`git grep "\.user\b"` 残留 = SA6 缺席断言一处（断言 user 不存在） | 已实现 |
| 11 | create 失败或 dispose 竞态不遗留 timer、in-flight、cache entry 或隐藏 lease | ✅ | 用例 10：dispose 竞态 in-flight create 以真实 rejection 收束（非超时/非隐藏 lease）、`timer.pending()===0`、dispose 后拒绝含 `disposed`；SA7 §2.4 dispose-during-flush 等既有锚定全绿；R2-1 活性钉（写失败后被取代 load 真实 settle） | 已实现 |
| 12 | MemoryPersistence 与 FilePersistence 通过同一组 createDoc shared contract tests | ✅ | 共享套件 `describeDocCreateContract(factory)` + fixture 面（`DocCreateContractFixture`/`TestTimer`/`DocStoreHooks`/`makeFresh`）已交付并接入 MemoryPersistence（39 条契约/套件用例绿）；FilePersistence 接入属 #58（简报 Coordination：本票先落共享 contract/lifecycle core，#58 随后接入；契约固定点 5 已书面规定其复用义务） | 已实现（#58 边界已注明） |
| 13 | 保持 `saveDoc` 仅登记 dirty、异步调度现有语义 | ✅ | 用例 2：saveDoc 后不立即写、499ms 不写、500ms 写 1 次；既有 debounce/max-dirty/generation 保序/降级重试 19 条 MemoryPersistence 测试全绿零回归（总控亲验 491→SA7 后 499 全绿） | 已实现 |

## 结论

13/13 ✅（其中 AC3/AC12 的 FilePersistence 侧落钉按简报 Coordination 条款属 #58 范围，本票交付物 = 共享 lifecycle core + 共享契约套件 + MemoryPersistence 接入 + ADR 修订节，边界已在证据列注明）。无 ❌ 项，无需追加 SA 派发。进入 Phase 4 收尾固化。

观测备案（非 AC 缺口，来自 SA7 §3）：①createDoc 接受 pre-destroyed Y.Doc（无契约，留上游决策）；②index.ts 运行时 re-export testing.js 拉 vitest 进运行时 import（base 既有，git show 37561ac 证实，非本票引入）。
