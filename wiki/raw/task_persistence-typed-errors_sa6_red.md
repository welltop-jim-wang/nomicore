# SA6 红灯契约测试报告 — issue #108 persistence：typed load/create 错误与 committed-aware create fatal

- **SA**: SA6（Red Test Writer, Phase 1 测试先行）
- **Date**: 2026-06-0x（R1 设计定稿后、SA3 实现前）
- **worktree**: /home/wangjian/nomicore-fix-issue-108（branch `fix/issue-108-on-docs-namespace-registry`；全程无 git 写操作，仅测试/task 记录文件修改）
- **设计依据**: `wiki/raw/task_persistence-typed-errors_design.md`（R1 + R1.1 注记，661 行，以文件当前内容为准）；SA2 R2 报告 `task_persistence-typed-errors_sa2_review_r2.md`（PASS，EC10/§5.4.2 已独立 trace 验证）
- **任务类型**: feature（AC7 共享错误契约 + AC1–AC6 分类锚定）；交付=红灯（含 tsc 类型错误）

---

## 1. 交付文件清单（全部在授权 File Scope 内）

| 文件 | 类型 | 内容 |
|---|---|---|
| `packages/persistence/src/testing.ts` | 修改（+517/−18） | 新增 `createPersistenceIoFaultSeam`（`PersistenceIoFaultSeam`/`PersistenceIoFaults`/`PersistenceHold`）+ `describePersistenceErrorContract`（EC1–EC8 共享套件）；§5.4.1/§5.4.2 两处既有用例修订；`tick()` 辅助因 §5.4.2 重构而孤儿化→删除 |
| `packages/persistence/test/memory-persistence.test.ts` | 修改（+103） | 接入 `describePersistenceErrorContract`（Memory fixture：createDocStore + flat hooks 委托 store + `wrapIo: seam.wrap`；makeFresh 同形；writeCommitted 经 store.write 直写）+ **EC10**（公共 flat hooks 直构，不经 seam） |
| `packages/persistence/test/file-persistence.test.ts` | 修改（+28） | 接入 `describePersistenceErrorContract`（File fixture：真实 mkdtemp rootDir，只用 wrapIo；makeFresh 新 FilePersistence 同 rootDir；writeCommitted 直写 `.snapshot`；afterAll 既有模式清理） |
| `packages/persistence/test/file-persistence-sa7-dynamic.test.ts` | 修改（+14） | §5.4.3：L115 EACCES 断言改锚 `code: 'DOC_LOAD_OPERATIONAL'` + `cause` 保真（`toMatchObject({ code: 'EACCES' })`） |
| `packages/persistence/test/persistence-encode-fatal.test.ts` | 新建（+70） | EC9：`vi.mock('yjs', …importActual…)` 部分 mock `encodeStateAsUpdate` 抛哨兵异常（Memory fixture） |

未触碰：`src/contract.ts`/`lifecycle.ts`/`memory.ts`/`file.ts`/`index.ts`（SA3 范围）；其余既有测试文件与断言逐字未动。

---

## 2. 用例 × 红状态矩阵

运行命令（后台独立进程，exit code 落文件）：
- `npx vitest run packages/persistence` → **VITEST_EXIT=1**
- `npx tsc -p packages/persistence/tsconfig.json --noEmit` → **TSC_EXIT=2**

### 2.1 新用例（18 个：EC1–EC10 + 共享套件双 Adapter 展开）

| 用例 | Adapter | 红原因（本阶段实测） | 断言锚（设计 §5） |
|---|---|---|---|
| EC1 load operational | Memory | `expected the operation to reject`（wrapIo 未生效→load 返回 null） | N1–N4 + 双并发同实例 + heal 读回 |
| EC1 load operational | File | 同上 | 同 |
| EC2 load corruption 不降级 | Memory | `The instanceof assertion needs a constructor but undefined was given`（三新类型不存在） | N6：/META\.docId/ + not instanceof 三新类型 |
| EC2 | File | 同上 | 同 |
| EC3 create operational W2 | Memory | `expected the operation to reject`（wrapIo 未生效→create 成功） | N1–N4 + committed false + doc 未销毁 + pending 0 + fresh null + 重试 handle.doc===doc |
| EC3 | File | 同上 | 同 |
| EC4 create operational R1 | Memory | `expected the operation to reject` | 同 EC3 类型断言 + store 空 + 可重试（回归 §4.2.6 unhandledRejection 修复） |
| EC4 | File | 同上 | 同 |
| EC5 fatal post-commit committed:true | Memory | `timed out waiting for create write to finish its commit and enter the post-commit hold`（2000ms withTimeout；seam 未接线） | N1 + phase 'post-commit' + committed true + cause instanceof Error + N5 rollback 负锁 + makeFresh 读回 + 重试 DOC_DUPLICATE |
| EC5 | File | 同上 | 同 |
| EC6 fatal probe-read committed:false | Memory | `timed out waiting for create probe read to enter the hold` | phase 'probe-read' + committed false + store 空 + L0/C0 /disposed/ 裸传锚 |
| EC6 | File | 同上 | 同 |
| EC7 fatal store-write committed:false | Memory | `timed out waiting for create write to enter the pre-commit hold` | phase 'store-write' + committed false + cause instanceof Error（AbortError 变体）+ store 空 + pending 0 |
| EC7 | File | 同上 | 同 |
| EC8 duplicate 独立性 | Memory | `The instanceof assertion needs a constructor but undefined was given` | instanceOf 互斥四向 + 四 code 去重 size 4 |
| EC8 | File | 同上 | 同 |
| EC9 encode fatal | Memory（独立文件） | `The instanceof assertion needs a constructor but undefined was given`（第 58 行；`DocCreateFatalError` 未导出→undefined） | phase 'snapshot-encode' + committed false + cause toBe(encodeFault) + store 空 + doc 未销毁 + N3 |
| EC10 委托模型 committed:true 自洽锚 | Memory（独立 describe） | 同上（`await import('../src/index.js')` 后 undefined） | phase 'post-commit' + committed true + makeFresh 读回共享 store + L0/C0 裸传 |

### 2.2 既有用例修订（§5.4 三处授权修订，预期红）

| 修订 | 用例 | 红原因（实测） |
|---|---|---|
| §5.4.1 | `does not cache, commit, or destroy the caller doc when the initial write fails` | `The instanceof assertion needs a constructor but undefined was given`（`DocCreateOperationalError` 不存在）→ 修订点红，后续断言（doc 未销毁/pending 0/fresh null/重试）未执行——预授权 |
| §5.4.2 | `settles an in-flight create when dispose races it, leaving no timers or hidden leases` | `The instanceof assertion needs a constructor but undefined was given`（`DocCreateFatalError` 不存在）→ 修订点红，原断言（非 TestTimeoutError/instanceof Error/pending 0/后续 /disposed/）保持 |
| §5.4.3 | sa7-dynamic `non-ENOENT tmp sweep failure is loud…` | `AssertionError: expected Error: EACCES: permission denied, unlink … to match object { code: 'DOC_LOAD_OPERATIONAL' }`（actual `code: 'EACCES'`）→ 包装未实现，改动点红 |

### 2.3 未授权用例：零新增失败 ✓

- 基线（改动前）：**76/76 绿**（已验证，`VITEST_EXIT=0`）。
- 改动后：**73 绿 / 21 红（94 总数）**。73 = 76 − 3（§5.4 三处授权修订）；21 = 18 新用例 + 3 授权修订。**无任何未授权既有用例变红**。
- 全绿保持文件（6/10）：`issue-79-entry-status`（6）、`issue-79-file-entry-status`（2）、`sa7-supplementary`（3）、`module-graph-regression`（4，含 reverse-barrel/AC4 timer 静态守卫）、`core-dsh-boundary`（6）、`persistence-contract`（6）。

---

## 3. 红灯证据摘录（关键失败输出）

```
× DocPersistence typed error contract > EC1 … (memory + file)
  → Error: expected the operation to reject
× DocPersistence typed error contract > EC5 …
  → TestTimeoutError: timed out waiting for create write to finish its commit and enter the post-commit hold
× DocPersistence typed error contract > EC2 / EC8 / EC9 / EC10 / §5.4.1 / §5.4.2 …
  → The instanceof assertion needs a constructor but undefined was given.
FAIL packages/persistence/test/file-persistence-sa7-dynamic.test.ts > … tmp sweep …
  AssertionError: expected Error: EACCES: permission denied, unlink … to match object { code: 'DOC_LOAD_OPERATIONAL' }
  - Expected {"code": "DOC_LOAD_OPERATIONAL"} / + Received Error {"code": "EACCES"}
```

vitest 汇总：`Test Files 4 failed | 6 passed (10)`；`Tests 21 failed | 73 passed (94)`；Type Errors no errors（vitest 自身 typecheck 阶段仅检 `*.test-d.ts`）。
tsc 汇总（5 个错误，**全部为构造性类型错误，且全部位于测试文件**，恰好落在「类型不存在/wrapIo 未生效」两类）：

```
test/file-persistence-sa7-dynamic.test.ts(32,15): TS2305 — no exported member 'DocLoadOperationalError'
test/file-persistence.test.ts(147,65): TS2353 — 'wrapIo' does not exist in type 'FilePersistenceOptions'
test/memory-persistence.test.ts(128,5): TS2353 — 'wrapIo' does not exist in type 'MemoryPersistenceOptions'
test/memory-persistence.test.ts(598,13): TS2339 — Property 'DocCreateFatalError' does not exist on index
test/persistence-encode-fatal.test.ts(20,3): TS2305 — no exported member 'DocCreateFatalError'
```

`src/testing.ts` 本身 **tsc 零错误**（新 seam/共享套件全部类型自洽；动态导入以显式 cast 屏蔽缺失导出）。

**「意外通过」检查：0**。18 个新用例全部红；无任何新用例在绿灯意义上通过（若 wrapIo 已生效或类型已存在，EC1–EC8 只会在实现完成后才绿——本阶段每个失败都落在预期锚点或前置构造点）。

---

## 4. 构造说明与偏离登记（SA4/SA3 必读）

1. **Fixture 契约两处必要扩展（§5.3 最小面未列，但 EC 行断言需要）**：
   - `DocPersistenceErrorContractFixture` 增加 `readonly scheduler: TestScheduler`——EC3/EC5/EC7 行明确要求 `scheduler.pending() === 0` 断言；
   - 增加 `readonly faults: PersistenceIoFaults`——共享套件必须经 seam 注入故障，而 seam 只能由 fixture 在装配 `wrapIo` 前创建，故必须由 factory 暴露。
   §5.3 所列四成员（persistence/makeFresh/writeCommitted/dispose）逐字保留。
2. **新类型导入策略（红灯隔离）**：`testing.ts` 与 memory-persistence.test.ts 的 EC10 对三类新错误用**运行时动态导入**（`await import('./contract.js')` / `await import('../src/index.js')`），`sa7-dynamic` 用 `import type`（完全擦除）——若不如此，静态导入缺失导出会使**整个模块加载失败**，既有绿测（尤其 testing.ts 的全部消费方）连带变红，违反「未授权用例零新增失败」。EC9 文件是全新文件，采用静态导入（仓库 vfsl Phase-1「静态 import 失败→构造性红灯」先例；实测 vite-node 不阻断加载，失败落在 `instanceof` 断言「constructor but undefined」，更干净）。
3. **§5.4.2 时序**：严格按设计（时序纪律）：`creating = createDoc(...)` → `await withTimeout(writeEnteredPromise)` → `const disposing = fixture.dispose()`（**不 await**）→ `releaseWrite!()` → `await disposing` → 收 rejection。EC5/EC6/EC7 同款（`hold.entered` → dispose 不 await → release → await dispose）。
4. **EC5/EC6/EC7 的 `await hold.entered` 包裹 `withTimeout(2000)`**：防 seam 接线前的死等（红阶段正是靠它 2000ms 内确定性失败而非挂死）；绿阶段 hold 必进入，超时仅作失败护栏。早挂的 `rejectionOf` 附加 no-op catch 防「测试提前中止后 createDoc 落地导致进程级 unhandled rejection」噪音（红阶段测得 6 条→修复后 0 条；绿阶段该 catch 永不触发）。
5. **`tick()` 辅助删除**：仅 §5.4.2 旧构造使用，R1 重构后孤儿化；属授权修订的直接连带（`noUnusedLocals` 未开、留着无害，删除更净）。
6. **EC5 的 File 磁盘断言**：设计文中「File 可断言 .snapshot 已在盘上」在共享套件内不可做（fixture 不暴露 rootDir，Memory 无对应）——以 N5 行为证伪 rollback（makeFresh 读回 + 重试 DOC_DUPLICATE）承担；磁盘层面断言由既有 file 测试（rename 落盘/覆盖写/0o444）与 §5.4.3 共同覆盖。
7. **EC9 的 mock 隔离**：vitest 3.2 per-file mock 隔离已被本运行实测证实——`persistence-encode-fatal.test.ts` 之外的 6 个绿文件（含同包广泛使用 yjs 的 memory/file 套件）全部通过，未被 yjs mock 污染。

---

## 5. 给 SA3 的绿灯契约提醒（关键时序/断言面，来自本红灯实测）

- `wrapIo` 需同时进 `MemoryPersistenceOptions` 与 `FilePersistenceOptions`（当前两处 tsc TS2353 红灯锚）；
- `index.ts` 需导出四错误值/类型 + 冻结映射 + `PersistenceIO` 类型（5 处 TS 红灯锚的解除点）；
- create 的 claim 段/写段/提交后段三段式分类 + `routeOwnedRead` 的 ReadError 包装 + `completion.catch(() => {})`（§4.2.6）是 EC4/EC6 由「红」转「绿」的行为前提；
- memory.ts 的 abort 门移位（§4.3.1，hook 之前）是 EC10 绿的前提（本阶段 EC10 只在 instanceof 处红，门位错误将在绿阶段以 phase/committed 断言暴露——SA7 动态复核点）。
