# MABF Task: FilePersistence Cordis 插件：用户分区、缓存与崩溃恢复（P3）

## Issue #58

## Parent

PR #55

## Task Type

功能开发（feature）

## Base / Branch

- base: `adr/server-design`
- branch: `fix/issue-58-on-adr-server-design`
- run_id: `issue-58-1787304142-139880`

## What to build

实现 ADR 0006 的生产 Adapter：FilePersistence Cordis 插件。复用 P2 的 cache/handle/lifecycle core，负责将其 snapshot persistence backend 落到用户分区磁盘布局。持久层看 Y.Doc、不了解 VFSL/业务数据；全量 snapshot、temp+rename、遗留 tmp 丢弃是实现契约。

## Acceptance criteria

- [ ] rootDir 可配置，多插件实例可指向不同目录互不影响
- [ ] 磁盘布局：`{rootDir}/users/{userId}/{namespaceId}.snapshot`；userId/namespaceId 均验证 `^[a-z][a-z0-9-]{0,62}$`，不可路径穿越
- [ ] flush 对完整 Y.Doc 使用 `Y.encodeStateAsUpdate`，写 `{namespaceId}.snapshot.tmp` 后原子 rename 为 `.snapshot`
- [ ] load 只认 `.snapshot`；遗留 `.tmp` 一律忽略并删除
- [ ] save → 新建 FilePersistence 实例 → load 能完整还原 Y.Doc（SCHEMA/META/ROOT）
- [ ] META.docId 与请求 namespaceId 不一致视为存储损坏并响亮失败
- [ ] 复用 P2 lifecycle core：缓存身份、handle/lease、调度、单飞 flush、generation、degraded/retry 不得复制第二套
- [ ] dispose 取消 timer、等待/处理进行中 flush、释放文件资源与缓存
- [ ] 通过 P1 shared contract tests + 文件系统专属恢复/临时文件/用户分区测试

## Blocked by

#57（MemoryPersistence Cordis 插件与 lifecycle core）—— 已随 commit 653af45 / 37561ac 落地。

## Working Directory

/home/wangjian/nomicore-fix-issue-58

## Branch

fix/issue-58-on-adr-server-design

---

## SA6 红灯验收锚定记录（Phase 1，2026-08-21）

### 需求拆解 → 测试映射

| 验收标准 | 锚定测试（`packages/persistence/test/file-persistence.test.ts`） |
|---|---|
| rootDir 可配置，多实例不同目录互不影响 | `keeps plugin instances with different rootDir fully independent`（双实例双 rootDir，B 实例 loadDoc=null、B 目录无文件）+ Cordis 插件工厂测试 |
| 磁盘布局 `{rootDir}/users/{userId}/{namespaceId}.snapshot`；userId/namespaceId 验证 `^[a-z][a-z0-9-]{0,62}$`，不可路径穿越 | `writes the ADR disk layout ...`（精确路径断言 + 磁盘字节经 `Y.applyUpdate` 还原验证为完整 Yjs update）+ `validates userId/namespaceId against the safe grammar and never escapes rootDir`（11 个非法 userId × 6 个非法 docId 全部 loud reject；单字符/63 字符边界合法；`../escape` 不得落盘） |
| flush 用 `Y.encodeStateAsUpdate` 全量编码，写 `.snapshot.tmp` 后原子 rename 为 `.snapshot` | `writes the ADR disk layout ...`（flush 后 `.tmp` 不存在）+ `replaces a committed snapshot via atomic rename: a read-only committed file does not block the next flush`（chmod 444 已提交快照 → 直写 `.snapshot` 必 EACCES 降级，tmp+rename 必成功——确定性钉死 rename 而非重写） |
| load 只认 `.snapshot`；遗留 `.tmp` 忽略并删除 | `ignores and deletes leftover .tmp files on load (crash recovery)`（tmp-only → load=null + 删除；tmp+有效 snapshot → snapshot 胜出 + 删除） |
| save → 新建实例 → load 完整还原 SCHEMA/META/ROOT | `fully restores SCHEMA/META/ROOT through a brand-new instance after save (crash restart)`（SCHEMA 信封四字段、META.docId/createdAt、ROOT 标量/嵌套 Y.Map/Y.Text 全量断言，还原 doc ≠ 写入 doc 实例） |
| META.docId 不一致视为损坏并响亮失败 | `treats a snapshot whose META.docId does not match the requested namespace as corruption and fails loudly`（`rejects.toThrow(/META\.docId/)`） |
| 复用 P2 lifecycle core（缓存身份/handle/lease/调度/单飞 flush/generation/degraded-retry） | P1 shared contract suite 接入：`describeDocPersistenceContract(FilePersistence 工厂)`（独立 handle 共享 live doc、release 幂等、foreign/released handle 响亮拒绝）——行为与 MemoryPersistence 一致即复用证明；degraded/retry/单飞 generation 由 P2 core 既有测试锚定 |
| dispose 取消 timer、等待/处理进行中 flush、释放文件资源与缓存 | `dispose cancels pending flush timers, leaves nothing written, and rejects further use`（fake timer pending→0、无快照落盘、status=disposed、loadDoc/saveDoc 拒绝）+ 插件 fiber dispose 联动 |
| 通过 P1 shared contract tests + 文件系统专属恢复/临时文件/用户分区测试 | 本文件整体（contract 接线 + 上述文件系统专属用例） |

### SA6 假设的公开 API 契约（SA3 实现面，镜像 MemoryPersistence，避免复制第二套 core）

- `FilePersistence` 类（`src/file.ts`）：`constructor(options: FilePersistenceOptions)`，`options = { rootDir: string; schedule?: Partial<PersistenceSchedule>; timer?: PersistenceTimer }`；实现 `DocPersistence`（loadDoc/saveDoc）+ `apply(ctx)` + `dispose(): Promise<void>` + `getStatus(): FilePersistenceStatus`（'ready' | 'persistence-degraded' | 'disposed'）
- `createFilePersistencePlugin(options)` → `{ apply(ctx); instance: FilePersistence | undefined }`（工厂/实例模型，非全局单例）
- `createFileHandleForTest(persistence, user, docId)`：test-only 创建路径，从 `src/file.js` 导出（镜像 `src/memory.js` 的 `createMemoryHandleForTest`），**不进入** `@nomicore/persistence` 公共导出
- `src/index.ts` 追加 re-export：`FilePersistence`、`createFilePersistencePlugin`、`FilePersistenceOptions`、`FilePersistenceStatus`

### 红灯运行结果

- 命令：`pnpm test`（vitest run --typecheck，worktree 根目录，独立进程运行，退出码写入 /tmp/sa6-file-exit）
- 结果：**EXIT=1（红灯确认）**，`Test Files 1 failed | 32 passed (33)`，其余 480 个既有测试全绿
- 失败锚点（仅 `packages/persistence/test/file-persistence.test.ts`）：
  - `TypeCheckError: Cannot find module '../src/file.js' or its corresponding type declarations`（file-persistence.test.ts:33 —— `createFileHandleForTest` 导入路径）
  - 缺失导出 `FilePersistence` / `createFilePersistencePlugin`（file-persistence.test.ts:26-27，`../src/index.js`）
- 结论：FilePersistence 实现尚不存在 → 测试在收集期即失败，红灯真实且稳定；SA3 落地 `src/file.ts` 并按下表 API 契约导出后，测试进入可运行状态并须全绿。
