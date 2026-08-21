# AC 逐条确认门禁 — FilePersistence Cordis 插件（issue #58）

核对基准：TASK.md Acceptance criteria（9 条）。核对时间：SA4 pass + SA7 pass 之后（评审双清已达成）。
验证基线：总控亲跑 `pnpm typecheck` EXIT=0；`pnpm test` Test Files 34 passed / Tests 496 passed / EXIT=0（SA7 补充测试合入后由 SA7 复跑 + 总控 Phase 4 终验复跑，见 .mabf-bg/ 日志）。

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC-1 | rootDir 可配置，多插件实例可指向不同目录互不影响 | ✅ | `file-persistence.test.ts:216` `keeps plugin instances with different rootDir fully independent`（双实例双 rootDir：B 实例 loadDoc=null、B 目录无文件）；`:346` Cordis 插件工厂注册 service + fiber dispose | SA6 锚定，SA3 实现，SA7 动态复核 |
| AC-2 | 磁盘布局 `{rootDir}/users/{userId}/{namespaceId}.snapshot`；userId/namespaceId 验证 `^[a-z][a-z0-9-]{0,62}$`，不可路径穿越 | ✅ | `:130` `writes the ADR disk layout ...`（精确路径断言 + flush 后无 .tmp 残留）；`:276` `validates userId/namespaceId against the safe grammar and never escapes rootDir`（11 非法 userId × 6 非法 docId 含 `../escape` 全部 loud reject；单字符/63 字符边界合法；rootDir 外零逃逸文件）；实现 `src/file.ts` validateIdentity 钩子 + resolveSnapshotPaths 纵深防御（SA4 §1 核对落实） | SA6 锚定，SA3 实现，SA4 静态核对 |
| AC-3 | flush 对完整 Y.Doc 使用 `Y.encodeStateAsUpdate`，写 `.tmp` 后原子 rename 为 `.snapshot` | ✅ | `:130`（磁盘字节经 `Y.applyUpdate` 还原验证为完整 Yjs update）；`:300` `replaces a committed snapshot via atomic rename: a read-only committed file does not block the next flush`（chmod 444 已提交快照 → 直写必 EACCES、tmp+rename 必成功，确定性钉死 rename）；SA7 复跑该用例 ✓ 503ms | SA6 锚定，SA3 实现，SA7 复跑 |
| AC-4 | load 只认 `.snapshot`；遗留 `.tmp` 一律忽略并删除 | ✅ | `:233` `ignores and deletes leftover .tmp files on load (crash recovery)`（tmp-only → load=null+删除；tmp+有效 snapshot → snapshot 胜出+删除）；`file-persistence-sa7-dynamic.test.ts:195` 键控钉死（load d1 只删 d1.tmp，d2.tmp 不动）；设计决策 E.1 披露残留语义（惰性清扫，重启后未再访问的 tmp 滞留——已文档化） | SA6 锚定，SA7 动态加固 |
| AC-5 | save → 新建 FilePersistence 实例 → load 能完整还原 Y.Doc（SCHEMA/META/ROOT） | ✅ | `:153` `fully restores SCHEMA/META/ROOT through a brand-new instance after save (crash restart)`（SCHEMA 信封四字段、META.docId/createdAt、ROOT 标量/嵌套 Y.Map/Y.Text 全量断言；还原 doc ≠ 写入 doc 实例） | SA6 锚定，SA3 实现 |
| AC-6 | META.docId 与请求 namespaceId 不一致视为存储损坏并响亮失败 | ✅ | `:262` `treats a snapshot whose META.docId does not match the requested namespace as corruption and fails loudly`（`rejects.toThrow(/META\.docId/)`）；实现 lifecycle.ts `restoreEntry` loud throw（SA4 §1 核对） | SA6 锚定，SA4 静态核对 |
| AC-7 | 复用 P2 lifecycle core：缓存身份、handle/lease、调度、单飞 flush、generation、degraded/retry 不得复制第二套 | ✅ | 架构：SA3 抽取 `src/lifecycle.ts`（PersistenceLifecycleCore），memory/file 均继承——调度/单飞/generation/degraded-retry 代码物理上仅一份（SA4 §3「不得复制第二套」grep 判据成立 + §4 逐字搬迁核验 24 成员）；行为：`describeDocPersistenceContract(FilePersistence 工厂)` 共享契约测试通过（独立 handle 共享 live doc、release 幂等、foreign/released handle 响亮拒绝）；`file-persistence-sa7-dynamic.test.ts:136` degraded/retry 动态点火验证 | SA1 决策 A，SA3 实现，SA4 静态审计，SA7 动态验证 |
| AC-8 | dispose 取消 timer、等待/处理进行中 flush、释放文件资源与缓存 | ✅ | `:326` `dispose cancels pending flush timers, leaves nothing written, and rejects further use`（fake timer pending→0、无快照落盘、status=disposed、loadDoc/saveDoc 拒绝）；`:346` fiber dispose 联动；释放/在途 flush 处理由内核 dispose 语义继承（设计 §4.7，逐字搬迁核验） | SA6 锚定，SA4 静态核对 |
| AC-9 | 通过 P1 shared contract tests + 文件系统专属恢复/临时文件/用户分区测试 | ✅ | `file-persistence.test.ts:112` `describeDocPersistenceContract(...)` 接入 P1 共享契约套件（绿）；文件系统专属用例 10 个（布局/恢复/分区/tmp/rename/dispose/工厂）+ SA7 动态补充 3 个（sweep 信号链/degraded 半径/tmp 键控）全部绿：总测试 34 files / 496 passed | SA6+SA7 |

**结论：9/9 AC 全部 ✅，无 ❌ 条目，无需追加 SA 修订轮。进入 Phase 4 收尾固化。**
