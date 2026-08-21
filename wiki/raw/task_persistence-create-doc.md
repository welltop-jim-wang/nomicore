# MABF Task: DocPersistence createDoc：排他创建、owner 语义与首快照提交

## Issue #64

## Parent

PR #55

## PRD

`docs/prd/persistence-create-doc.md`

## What to build

扩展 `DocPersistence`：

```ts
createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle>
loadDoc(owner: User, docId: string): Promise<DocHandle | null>
saveDoc(handle: DocHandle): Promise<void>
```

同时将 `DocHandle.user` 改为 `DocHandle.owner`。owner 是文档的存储所有者，不是当前访问者；访问者授权不进入 Persistence Interface。

在共享 lifecycle core 中实现 create/load 的同键协调，并让 MemoryPersistence 与 FilePersistence 共用 contract tests，不得复制并发状态机。

## Required semantics

- [ ] `createDoc` 对 `(owner.userId, docId)` 排他创建；cache/store 已存在或并发创建时稳定地返回 duplicate 错误，不覆盖
- [ ] duplicate 必须有稳定 error code 或专用错误类型，调用方无需解析 message
- [ ] 创建成功前初始完整 snapshot 已提交；FilePersistence 以 temp → rename 完成为提交点，不新增 fsync 保证
- [ ] 成功时签发有效 lease，`handle.owner === owner` 且 `handle.doc === doc`，Persistence 接管 doc 生命周期
- [ ] 失败时不返回 handle、不缓存、不销毁传入 doc，所有权仍归调用方
- [ ] Persistence 仅校验 `META.docId === docId`，不校验 VFSL/ROOT/createdAt
- [ ] create/create 与 create/load 共享 per-key coordination；并发 create 恰好一个成功，create 取得创建权后 load 不得错误返回 null
- [ ] 不同 key 的操作不互相串行
- [ ] A owner / B accessor 场景中 Persistence 只接收 A；A/doc1 与 B/doc1 保持隔离
- [ ] `DocHandle.user`、内部 Entry 参数/字段、契约测试和文档统一迁移为 owner 语义
- [ ] create 失败或 dispose 竞态不遗留 timer、in-flight、cache entry 或隐藏 lease
- [ ] MemoryPersistence 与 FilePersistence 通过同一组 createDoc shared contract tests
- [ ] 保持 `saveDoc` 仅登记 dirty、异步调度的现有语义

## Coordination

P2 #57 已合并。本票应先落共享 contract/lifecycle core；正在实现的 P3 #58 随后接入相同 createDoc 语义。若与 #58 并行开发，先约定依赖顺序，避免在 FilePersistence 分支复制临时实现。

---

## SA6 红灯测试记录（2026-08-21，SA6 Phase 1 验收锚定）

### 测试文件与命令

- `packages/persistence/src/testing.ts` — 共享契约 harness 扩展：新增 `describeDocCreateContract(factory)`（10 条 createDoc/owner 验收用例）、`DocCreateContractFixture` / `DocPersistenceWithCreate` / `TestTimer`+`createTestTimer` / `DocStoreHooks`+`createDocStore` / `withTimeout`；既有 `describeDocPersistenceContract` 迁移为 owner 语义（`createHandle(owner, docId)`）
- `packages/persistence/test/memory-persistence.test.ts` — MemoryPersistence 接入共享 createDoc 套件（fake timer + 共享 store hooks + `makeFresh` 二次实例）；既有 lease 套件 seeding 改为走公共 `createDoc` 路径
- `packages/persistence/test/persistence-contract.test.ts` — `DocHandle` 形状契约迁移为 `owner`；新增「adapter 实例暴露 createDoc」模块契约测试
- 测试命令：`pnpm test`（全量 `vitest run --typecheck`）；局部：`node_modules/.bin/vitest run packages/persistence/test/memory-persistence.test.ts packages/persistence/test/persistence-contract.test.ts`；类型检查 `pnpm typecheck`
- 无新增测试包 / 端口依赖；`scripts/test-lock.sh` 不存在，无需更新

### 红灯验证结果（真实失败证据，2026-08-21 运行）

```
Test Files  2 failed | 30 passed (32)
     Tests  14 failed | 477 passed (491)
```

- 13/14 失败：`TypeError: persistence.createDoc is not a function`（共享 createDoc 套件 10 条 + lease 套件 3 条——createDoc 接缝未实现）
- 1/14 失败：`AssertionError: expected 'undefined' to be 'function'`（`persistence-contract.test.ts`：adapter 实例未暴露 createDoc）
- 477 条既有测试全绿（含 19 条 MemoryPersistence 既有测试与 6 条 contract 既有测试），无回归、无伪红——红灯纯粹锚定 createDoc/owner 契约缺失
- 类型检查（`tsc -p packages/persistence/tsconfig.json`，exit 2）恰为契约红，SA3 实现接口后全部转绿：
  - `Property 'owner' does not exist on type 'DocHandle'`（testing.ts ×3）
  - `Property 'createDoc' does not exist on type 'DocPersistence'` / `'MemoryPersistence'`（testing.ts + memory-persistence.test.ts，另 1 条 fixture 可赋值性）
  - `'owner' does not exist in type 'DocHandle'`（persistence-contract.test.ts:120）

### createDoc 验收契约（SA3 按此实现；shared suite = 契约正文）

共享套件 `describeDocCreateContract` 由 MemoryPersistence（本票）与 FilePersistence（#58 rebase 后）用各自 fixture 调用**同一套用例**，不得复制并发状态机。fixture 形状：

```ts
interface DocCreateContractFixture {
  persistence: DocPersistenceWithCreate  // DocPersistence + createDoc(owner, docId, doc)
  timer: TestTimer                       // fake clock：advanceBy / pending
  store: DocStoreHooks                   // write/read 可被测试替换以注入失败/门控（adapter 的 I/O options 必须委托到 store 的当前方法）
  makeFresh: () => DocPersistence        // 同一 store 上的空缓存二次实例
  dispose: () => Promise<void>
}
```

10 条用例 ↔ Required semantics 映射：

| # | 用例 | 锚定语义 |
|---|---|---|
| 1 | creates an owner lease, commits the initial snapshot before resolving, and shares the live doc with loads | `handle.owner === owner`（同一对象）、`handle.doc === doc`、`handle.user` 不存在；同实例 load 共享 live doc；**createDoc resolve 前初始快照已提交**（fresh 实例不经 saveDoc 直读可见）；成功后无遗留 timer |
| 2 | only registers dirty on saveDoc after create and flushes on the debounce deadline | 保留 saveDoc「仅登记 dirty、异步调度」语义：saveDoc 后不立即写，499ms 不写、500ms 写 1 次 |
| 3 | rejects duplicate createDoc with a stable error code and never overwrites committed content | **cache 已存在**与**store 已存在**（fresh 空缓存实例）两路径均拒绝 duplicate；稳定 error code `DOC_DUPLICATE`；不覆盖已提交内容；不销毁 challenger doc（`isDestroyed === false`） |
| 4 | lets exactly one concurrent create win and rejects the other with duplicate | create/create 并发（写门控下）恰好一个成功；loser 在写路径前被拒（`enteredWrites === 1`）；提交内容 = winner 内容 |
| 5 | does not return null for a load that is still pending when create wins the key | create/load 共享 per-key coordination：load 在 create 获胜后仍 pending 时不得返回 null，且 `loaded.doc === created.doc`（同一 live 实例） |
| 6 | does not cache, commit, or destroy the caller doc when the initial write fails | 初始写失败：拒绝、不缓存（fresh loadDoc → null）、不销毁传入 doc、无 timer；失败后同 key 可重新 create 且 `handle.doc === doc` 同一实例（无 stale claim） |
| 7 | keeps A/doc1 and B/doc1 isolated and returns null for unknown keys | 排他键含 `owner.userId`：A/doc1 与 B/doc1 互不视为 duplicate、内容隔离；未创建 key / 其他用户 → `loadDoc` null |
| 8 | does not serialize operations of different keys | 第一 key 写 in-flight 时第二 key create 必须在 2s 超时守卫内完成（全局串行即红灯） |
| 9 | validates only META.docId: rejects mismatch, tolerates missing ROOT/SCHEMA and arbitrary createdAt | META.docId 不匹配 / 缺失 → 响亮拒绝（message 含 `META.docId`）；无 SCHEMA、无 ROOT、`createdAt` 垃圾值 → 通过；ROOT 为 Y.Text 也通过（不校验 ROOT 类型） |
| 10 | settles an in-flight create when dispose races it, leaving no timers or hidden leases | dispose 竞态：in-flight create 必须以**真实 rejection** 收束（非超时守卫、非 resolve 出隐藏 lease）；`timer.pending() === 0`；dispose 后 loadDoc/createDoc 均拒绝（message 含 `disposed`） |

### 契约固定点（SA3 必须逐字满足）

1. `DocPersistence` 增加 `createDoc(owner: User, docId: string, doc: Y.Doc): Promise<DocHandle>`；`DocHandle.user` → `readonly owner: User`；`loadDoc`/内部 Entry 参数与字段统一迁移为 owner 语义；`src/memory.ts` 的 `createMemoryHandleForTest`/testkit 若保留则签名参数名同步迁移
2. duplicate 错误：稳定错误码 `'DOC_DUPLICATE'`（可枚举自有属性，`rejects.toMatchObject({ code: 'DOC_DUPLICATE' })` 可见）；推荐（套件 instanceof 锚定）从 `@nomicore/persistence` 导出 `DocDuplicateError`（`new (message?: string) => Error`，含 `code` 自有属性）
3. dispose 后的拒绝 message 需含 `disposed`（套件正则断言；FilePersistence 同）
4. createDoc 在 cache miss 时必须查 store（fresh 实例 duplicate 用例锚定），claim 与 commit 之间不得让并发 load 落到 null
5. FilePersistence（#58 rebase 后）必须接入同一 `describeDocCreateContract`（fixture 提供真实 FS rootDir 下的 `makeFresh`/`dispose`）；temp→rename 提交点与遗留 `.tmp` 清理由 #58 的 FilePersistence 专测另行锚定

### R4 修订注记（2026-08-21，SA4 reject 回流 · 设计 R4 裁决选 (a)）

- **授权范围**：仅用例 4（`lets exactly one concurrent create win...`）写门控一处，按设计
  `task_persistence-create-doc_design.md` §5.3.1「SA6 修订规格」逐字修订（~4 行）；其余用例与
  fixture 未动。
- **修订内容**（`packages/persistence/src/testing.ts`，用例 4）：丢弃型门控
  `store.write = async () => { enteredWrites += 1; await gate }` → 透传写门控：

  ```ts
  const originalWrite = store.write
  store.write = async (key, snapshot, signal) => {
    enteredWrites += 1
    await gate
    await originalWrite(key, snapshot, signal) // 透传真实写：gate 只门控时序，不吞 payload
  }
  ```

  保留 `enteredWrites` 计数与门控时序语义（`enteredWrites === 1`、恰一胜者、loser 不被销毁等断言
  全部不变）；gate 放行后经 `originalWrite` 真实落盘——尾随 fresh 断言改为锚定**真实 store** 中的
  winner 提交（U1 保真，设计 §4.4 用例 4 行注记），不再依赖 adapter 镜像副产物。
- **修订后对账结果（2026-08-21 22:46 实跑，当前实现 = commit `081a3b3`）**：

  ```
  Test Files  2 passed (2)
       Tests  39 passed (39)
  Type Errors  no errors
  ```

  - `memory-persistence.test.ts` 32 条全绿 + `persistence-contract.test.ts` 7 条全绿，exit 0；
    用例 4 单独 `-t "exactly one concurrent create"` 复跑 1 passed（31 skipped）
  - `tsc -p packages/persistence/tsconfig.json` exit 0
  - 结论：修订未改变绿灯基线（39/39 仍全绿），用例 4 相关断言行为不变——门控只修 fixture 的
    「说谎写」缺陷，不透传时不落 payload 的旧路径在当前实现下经 adapter 镜像侥幸通过，
    透传后经真实 store 验证通过；SA3 随后按 §5.3/§5.3.1 重接线（IO-1/2/3）后该用例仍须全绿
    （§5.3.1 R4 回归验证点 2）
- 设计建议的「两个 hooks 实例指向不同 store 互不可见」新增用例**未采纳**（总控授权仅限用例 4 修订）

## Out of scope

- accessor/ACL/sharing/auth
- SCHEMA/META/ROOT 初始化
- list/delete/owner transfer
- persistence health Cordis events

## Working Directory

/home/wangjian/nomicore-fix-issue-64

## Branch

fix/issue-64-on-adr-server-design
