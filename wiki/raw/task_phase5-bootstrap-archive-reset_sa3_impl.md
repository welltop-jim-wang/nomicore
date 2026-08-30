# SA3 实现报告 — issue #133「Phase 5: bootstrap import, archive, and guarded replica reset」（Phase 3 TDD 实现）

- **Worktree**: `/home/wangjian/nomicore-fix-issue-133`
- **Branch**: `fix/issue-133-on-docs-phase-5-websocket-replication`
- **设计基准**: `wiki/raw/task_phase5-bootstrap-archive-reset_design.md`（R3 终态，1160 行）
- **验收锚**: SA6 5 个红灯测试文件（52 红运行时 + 3 守卫绿 + 类型锚）
- **状态**: 全部转绿；**未 git commit**（按总控要求保留工作树未提交状态）

---

## 1. 实现清单（文件 → 落位的设计节）

### packages/persistence/src（6 文件，全部在 §7 ALLOW 内）

| 文件 | 落位 |
|---|---|
| `contract.ts` | §4.0.1 逐字：`YjsDoc` 别名、`ReplicationIdentityRef`、`DocImportIdentityError`（code `DOC_IMPORT_IDENTITY_MISMATCH`）、归档四类（Identity/ActiveHandle/Duplicate/Operational）+ `DocArchiveFatalError`（三 phase + `DOC_ARCHIVE_FATAL_PHASE_COMMITTED` 冻结映射）；`DocPersistence` optional +`importDoc`/`archiveDoc`；派生接口 `ReplicaPersistence`（required） |
| `lifecycle.ts` | §4.0.2 `PersistenceIO` +optional `writeArchive`/`remove`；§4.5.1 cell 状态机 `archiving` + `CreateClaim→KeyClaim` 更名 + `LiveEntry.archiveWaiters`；§4.3 `createDoc` 抽取为私有 `exclusiveCreate(op)` + `importDoc`（差异位 = `validateImportDoc`，先于 claim/io；claim 环新增 archiving 分支）；§4.5.2 settle 段 `settleEntryForArchive`（强制即时 flush 跳 debounce、retry 回退尊重、干净 entry 当场驱逐、waiters 等待）+ 通知点 1（flush **finally 首位**无条件通知）+ 通知点 2（dispose 同步段 live-entry 清理循环内通知）+ 通知点 3（archiveDoc 公共入口 `this.track(...)` 全程记账）；§4.5.3 重写 `archiveDoc` 主体（`assertWritable` → `assertArchiveIo` 入口 gate → track；settle 环 + claim 环 + `runArchiveDoc`）：`resolveLoad` archiving 分支、seedForTest 守卫扩 `archiving`（SA2 MEDIUM-3）、§4.5.4 guard-read + 单一身份谓词 + `readPersistedReplicaFacts` 判据复刻（REPLICATION_ID_PATTERN 本地副本 #2，三处注释互引）、§4.5.5 relocate（提交点 = writeArchive resolve；remove 失败 → `DocArchiveFatalError('relocate-remove')` committed:true）、双路径 identity 守卫善后（成功/失败均 `cur?.state==='archiving' && cur.claim===claim` 才删——INV-14） |
| `memory.ts` | §4.10 R2 形态：独立 `archiveSnapshots: Map` 分区 + `writeArchive` **不经 writeSnapshot hook**；`remove` = abort 门 → loud 配置门（read 接线且 deleteSnapshot 缺席 → 稳定 message 拒绝）→ `deleteSnapshot?.(key)` → 主 mirror 删除；`MemoryPersistenceOptions` +optional `deleteSnapshot`；dispose 增 `archiveSnapshots.clear()`（drain-then-clear 同款纪律）；`importDoc`/`archiveDoc` 委托 |
| `file.ts` | §4.9：`resolveArchivePaths`（`{rootDir}/archive/users/{userId}/{docId}.snapshot` + `.tmp`，SAFE_PATH_SEGMENT 双段复用）、`writeArchiveSnapshot`（mkdir→writeFile tmp→rename 原子提交 + abort 三门位）、`removeCommittedSnapshot`（`rm {force:true}` ENOENT 容忍 + 入口 abort 门）、`importDoc`/`archiveDoc` 委托 + `validateIdentity` 入口 |
| `index.ts` | §4.0.4：+7 值（DocImportIdentityError、DOC_ARCHIVE_FATAL_PHASE_COMMITTED、DocArchive{Identity,ActiveHandle,Duplicate,Operational,Fatal}Error）+4 类型（YjsDoc、ReplicationIdentityRef、ReplicaPersistence、DocArchiveFatalPhase） |
| `testing.ts` | §4.6（D-6 裁决 (b)）：`wrap` 新增 `writeArchive`（并入既有 write 故障/hold 槽：failWrite / holdWriteBeforeCommit / holdWriteAfterCommit + `signal.throwIfAborted()` 自检后转调内层）+ `remove` 透传（本票不新增 remove 故障槽） |

### packages/namespace-registry/src（5 文件，全部在 §7 ALLOW 内）

| 文件 | 落位 |
|---|---|
| `types.ts` | §4.0.3：5 条 message 常量（NAMESPACE_IMPORT_{INVALID_IDENTITY,IDENTITY_MISMATCH,FAILED}_MESSAGE、NAMESPACE_RESET_{IDENTITY_MISMATCH,FAILED}_MESSAGE）、`ImportReplicaIssue/Result`、`ResetReplicaIssue/Result`、`ReplicationIdentityRef` 转出、`NamespaceRegistry` +required `importReplica(owner, namespaceId, doc: YjsDoc)`/`resetReplica(owner, namespaceId, expectedLocalIdentity)` |
| `registry.ts` | §4.2（D-2）接纳段（acceptance → validateOpenIdentity → carrier FIFO）+ 槽内冻结次序（① entry 碰撞 owner 先行 → ②a `readMetaDocId` → ②b `readImportedReplicaFacts`（判据复刻，REPLICATION_ID_PATTERN 本地副本 #1 + 三处注释互引）→ ③ capability gate（loud fatal，稳定 message）→ ④ importDoc 映射矩阵（§4.8.3：DocDuplicateError instanceof → ALREADY_EXISTS；DOC_IMPORT_IDENTITY_MISMATCH → 防御映射；DOC_CREATE_OPERATIONAL → IMPORT_FAILED + observer import-persist-failed；DOC_CREATE_FATAL code-first + committed 布尔读取传播 → fatal；unknown → fatal false）→ ⑤ 单一构造路径（§4.12：`factory(handle,…)`；throw → handle best-effort release + observer import-runtime-construction-failed + committed:true fatal，镜像 create DQ-7）；§4.8（D-8）reset 槽：① owner 核对 → capability gate（R3 放置点表：槽内、首次 Persistence 调用之前）→ ② 强制失效全部未决 lease（`forceReleaseOutstandingLeases`：闭包旗标 `forceReleasing` try/finally 置位/清位，§4.8.2）+ `cancelIdleArm` + `beginCloseCurrent`（I2 先赋值后翻相 + settle 处理器 removeEntryAfterClose）→ ③ 存在性探针（loadDoc；DocLoadOperationalError → LOAD_FAILED；null → NOT_FOUND 且零归档触达）→ ④ archiveDoc 映射矩阵（code-first：IDENTITY_MISMATCH → RESET_IDENTITY_MISMATCH + lifecycle-slot-failed；DUPLICATE → NOT_FOUND；ACTIVE_HANDLE → RESET_FAILED；OPERATIONAL → RESET_FAILED + reset-archive-failed；FATAL（code-first + instanceof 双保险，committed 布尔读取）→ fatal；unknown → fatal false）→ ⑤ `{ok:true}`（key 缺席即 bootstrap 资格）；§4.8.1 close rejection → fatal('reset','lifecycle-slot-internal',false)；`readMetaDocId`/`readImportedReplicaFacts`/`errorCodeOf`/`committedOf` 模块级私有读取器；`handleLeaseReleased` 首语句 `forceReleasing` 判别（仅抑制 idle 武装与 entry-idle 事件，lease-released 照发）；7 个冻结窄 issue 常量 |
| `errors.ts` | §4.11.3：`NamespaceRegistryFatalError.operation` +`'reset' | 'import'`（append-only，2 行） |
| `observer.ts` | §4.0.3：`lifecycle-slot-failed.operation` 联合 +`'reset' | 'import'`；+3 事件形（reset-archive-failed / import-persist-failed / import-runtime-construction-failed） |
| `index.ts` | §4.0.4：type-only +5 导出（ImportReplicaIssue/ImportReplicaResult/ResetReplicaIssue/ResetReplicaResult/ReplicationIdentityRef）；**零新增值导出**（九值冻结清单不动） |

### SA6 owned 测试文件（回流落位）

- `packages/persistence/test/persistence-phase5-import-red.test.ts` — 除设计 R-1/R-2 之外的**附加 fixture 管道微调**（见 §3 偏差 #2）。
- 其余 4 个 SA6 文件零改动（archive-red / registry-red / 两个 surface test-d 均已含 R-1/R-2 回流，断言逻辑零改动）。

---

## 2. 实测验证记录（命令 + 退出码 + 计数）

### 2.1 转绿前（基线红灯，亲手确认）

| 命令 | 基线结果 |
|---|---|
| `npx vitest run packages/persistence/test/persistence-phase5-import-red.test.ts` | 13 failed \| 1 passed（其特征缺失红 `TypeError: importDoc is not a function`） |
| `npx vitest run packages/persistence/test/persistence-phase5-archive-red.test.ts` | 22 failed \| 1 passed |
| `npx vitest run packages/namespace-registry/test/registry-phase5-bootstrap-reset-red.test.ts` | 17 failed \| 1 passed |
| `npx tsc -p tsconfig.typecheck.json --noEmit` | **恰 3 错**（registry surface 2× TS2322 + persistence surface 1× TS2305 `ReplicaPersistence`） |

合计 **52 红 / 3 绿** —— 与任务简报完全一致。

### 2.2 转绿后（全部亲跑）

| 命令 | 结果 |
|---|---|
| `npx vitest run packages/persistence/test/persistence-phase5-import-red.test.ts` | **14 passed (14)**，exit 0 |
| `npx vitest run packages/persistence/test/persistence-phase5-archive-red.test.ts` | **23 passed (23)**，exit 0 |
| `npx vitest run packages/namespace-registry/test/registry-phase5-bootstrap-reset-red.test.ts` | **18 passed (18)**，exit 0 |
| `npx tsc -p tsconfig.typecheck.json --noEmit` | **0 错误**（含两个 surface test-d 全部锚：persistence 2 红锚 `ReplicaPersistence` 转绿 + 2 绿守卫保持；registry 2 红锚转绿 + 2 绿守卫保持） |
| `pnpm typecheck` | **exit 0**（10 包链：vfsl/vfsl-protocol/vfsl-codegen/persistence/dsh-persistence/doc-runtime/namespace-runtime/clock/namespace-registry/replication-protocol） |
| `pnpm test` | **Test Files 140 passed (140) / Tests 1687 passed (1687) / Type Errors: no errors**，exit 0（全仓零回归、零 Type Error） |
| 三文件连跑 2 次 flake 检查 | 第 1 轮 55 passed；第 2 轮 55 passed —— **零 flake** |
| `git diff --check` | **零输出** |

### 2.3 计数自洽性说明

- 58 个新用例 = 3 个红灯运行时文件 55 用例（52 红→绿 + 3 守卫保持绿）+ 2 个 surface test-d 的 8 个类型锚用例（runtime 面为平凡 `it`，其真实断言面为 tsc TS2322/TS2305 转绿）。全量 1687 用例含此 63 项。
- 任务简报的「基线 133 文件 1599 用例」为分派时快照（不含本 worktree 上已存在的若干既有测试文件/用例——本分支合流后仓库实际含 140 个 vitest 文件）；由于**实现后全量零失败、零 Type Error**，且本次改动仅触及 ALLOW 清单 11 个 src 文件与 1 个新 SA6 测试文件的 fixture 管道（见 §3 偏差 #2），既有套件零回归由「全量全绿」事实上证明。

---

## 3. 与设计的偏差（应逐条说明；标记需 SA4 关注）

### 偏差 #1（设计文档内部矛盾的最小调和 → **需 SA2/SA4 确认**）

- **现象**：设计 §4.0.3 冻结的 `ImportReplicaIssue` 联合**不含** `NAMESPACE_NOT_FOUND`，但同一设计 §4.2 importReplica 槽伪码 ① 明确 `return NOT_FOUND_ISSUE`（owner mismatch 分支）——两文本不可同时满足（否则 TS 编译红）。
- **落位**：在 `ImportReplicaIssue` 联合中**追加** `{code:'NAMESPACE_NOT_FOUND'; message: NAMESPACE_NOT_FOUND_MESSAGE}`（additive，复用既有冻结常量；SA6 registry surface 锚 `HasImportReplica` 只要求 `code: string`，不受影响；无 SA6 用例负向断言该键缺席）。
- **理由**：伪码的 owner-mismatch → NOT_FOUND 是「零存在性泄露」不变量（INV-10）的落地行为，比联合漏列更权威；追加是任一方向的最小改动（改伪码为 ALREADY_EXISTS 会破坏零泄露语义）。
- **SA4 关注点**：该追加使 `ImportReplicaIssue` 与 `ResetReplicaIssue` 的 NOT_FOUND 成员对称（后者本就含），语义一致。

### 偏差 #2（SA6 fixture 管道微调 → **需 SA4 关注**）

- **现象**：`persistence-phase5-import-red.test.ts` 的 FilePersistence 夹具 `readStoreFiles()` 以 `fsp.readdir(rootDir)` 递归清点文件；「META.docId ≠ docId → 零持久化写入」用例在 **rootDir 从未被创建**（合法拒绝先于任何 mkdir）时 walk 抛 ENOENT，使该用例在实现正确后仍红（实现前它红在 `importDoc is not a function` 更早一步，掩盖了此缺口）。
- **落位**：仅在 `makeFileImportFixture().readStoreFiles` 的 walk 内对 `ENOENT` 容错（缺失目录 ≡ 空 store），**零断言逻辑改动、零锚定语义改动**（设计 §4.14.1 对 import-red 的「零改动转绿」预测遗漏了该 fixture 管道缺口）。
- **理由**：「零持久化写入 ⟹ 无文件可枚举」只能是该观察面的语义；tolerate-ENOENT 是使观察成立的最小管道修正（与 afterEach 既有的 `fsp.rm(..., {force:true})` 容错同款精神）。
- **SA4 关注点**：SA6 文件被改动的范围超出回流清单 R-1/R-2（R-1/R-2 在基线 worktree 已落位）；如 SA4 认定 fixture 缺口应回流 SA6 而非 SA3 落位，可将其合入下一轮回流清单（本改动仅 6 行、无行为断言变化）。

### 非偏差确认（设计已裁决、无需 SA4 关注）

- **reset capability gate 放置点**：取 §4.4 R3 放置点表（槽内、acceptance/identity 检查之后、**首次 Persistence 调用之前**——即 ① owner 核对之后、② close 之前），而非 §4.8 伪码中 ④ 的晚放置——R3 修订文字明确该表「消除 §4.4 与 §4.5.5 的放置歧义」且强制「gate 先于槽内一切持久化动作」；两种放置对 SA6 断言零差异（stub 恒具备能力），R3 表为权威。
- **`beginCloseCurrent` 关闭失败不发 `idle-close-failed`**：该事件属 idle 状态机队列（AC7）；reset 的 close 失败按 §4.8.1 经 `lifecycle-slot-failed(reset)` + fatal 上报，settle 处理器仅 `removeEntryAfterClose`（双守卫，key 不毒化）。
- **`removeCommittedSnapshot` 不传 `signal` 给 `fsp.rm`**：当前 Node 类型（RmOptions）无 signal 字段；以入口 `signal.throwIfAborted()` 门 + `rm {force:true}` 落地（进入后完整执行 ⟹ resolve ⟺ 主键缺席，满足 remove 契约；中止窗口归入 committed:true fatal，语义同设计）。

---

## 4. 遗留问题

1. **无阻塞遗留**：3 红灯运行时文件 55 用例全绿、tsc 0 错、全量 1687 用例零失败、`pnpm typecheck` 10 包链 exit 0、`git diff --check` 零输出、连跑 2 次零 flake。
2. **待 SA4/SA7 观察**：偏差 #1（ImportReplicaIssue +NOT_FOUND）与偏差 #2（import-red fixture ENOENT 容错）已在上文标记；SA7 动态验证（Memory dispose drain-then-clear 窗口、归档 × dispose 竞态——设计 §4.10 R3 INFO-R2-1 登记项）可基于本实现复跑。
3. **工作树未提交**：全部改动处于工作区（11 个 src 文件 M + 1 个 SA6 测试文件 fixture 微调 + 5 个 SA6 测试文件/8 个 wiki 文件 untracked），等待总控统一收口。
