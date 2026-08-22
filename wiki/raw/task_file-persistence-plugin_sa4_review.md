# SA4 静态验尸报告

**Date**: 2026-08-21
**Verdict**: pass
（附 1 项 MEDIUM 非阻断新发现 + 2 项文档债回流 SA1；不阻塞 SA7 动态验证）

- 被审对象：commit `359a030`（SA3 实现，base `37561ac` = `adr/server-design`）
- 设计基准：`wiki/raw/task_file-persistence-plugin_design.md`（R1，SA2 R2 pass）
- 约束基准：`wiki/raw/task_file-persistence-plugin_relevant_decisions.md`（ADR-0006）
- 红灯锚点：`packages/persistence/test/file-persistence.test.ts`（SA6 owned）
- 审查方式：P2 原版 memory.ts（344 行）与 lifecycle.ts/memory.ts 逐行比对 + 全部门禁命令实跑 + 3 组行为探针（探针为临时文件，跑毕即删，worktree 零残留）

---

## 0. 独立复跑证据（不采信自报）

| 命令 | 结果 |
|---|---|
| `pnpm typecheck`（独立进程） | **EXIT=0**，无 `error TS` |
| `pnpm test`（独立进程，`vitest run --typecheck`） | **Test Files 33 passed (33) / Tests 493 passed (493) / Type Errors no errors / EXIT=0** |
| 与总控亲跑（`.mabf-bg/sa3-verify.log`）比对 | 完全一致 |

---

## 1. SA2 移交静态核对项（三项全部落实）

### ① `??` 缝隙逐字同构 —— ✅ 落实（位置勘误：在 `memory.ts`，非 lifecycle.ts）

- **位置**：总控简报写「现位于 lifecycle.ts」，实际该表达式按设计 §4.2 留在 **`src/memory.ts:44`**（`readCommittedSnapshot` 桥接方法内），lifecycle.ts:201 仅以 `await this.readCommittedSnapshot(user, docId, this.abortController.signal)` 调用。位置以设计与实现为准，简报表述有误，不影响核对结论。
- **逐字比对**：
  - P2 原版（`37561ac:memory.ts:171`）：`await (this.options.readSnapshot?.(key, this.abortController.signal) ?? this.snapshots.get(key)?.snapshot)`
  - 现实现（`memory.ts:44`）：`return this.options.readSnapshot?.(key, signal) ?? this.snapshots.get(key)?.snapshot`
  - 核心表达式字符级同构；仅有的两处机械差：`this.abortController.signal` → 形参 `signal`（调用点 lifecycle.ts:201 绑定同一对象，值恒等）、`await (...)` 移至调用方（`??` 在两种形态下都作用于回调的**立即返回值**、await 之前求值——求值次序等价，见下探针）。
- **行为探针**（vitest 临时用例，index-first 入口；三分支全过）：
  - 分支① 无回调 → `MAP-BYTES`（读内部 map）✓
  - 分支② **同步**回调返回 undefined → `MAP-BYTES`（**回落内部 map**）✓
  - 分支③ **async** 回调解析 undefined → `null`（Promise 对象 non-nullish，**不回落**）✓
  - 与 memory.ts:35-43 注释的三分支描述逐字一致；与 SA2 R2 的 node 探针输出一致。**该无测试钉死的缝隙经实测未漂移。**
- 备注：探针未固化为永久测试——总控 18:22 已裁决不发起 SA6 R2 锚定轮，本报告以探针输出留档代替。

### ② `PersistenceCoreOptions` 的 `| undefined` 桥接形态 —— ✅ 落实

`src/lifecycle.ts:37-38`：`readonly schedule?: Partial<PersistenceSchedule> | undefined`、`readonly timer?: PersistenceTimer | undefined`，附 TS2379 成因注释（lifecycle.ts:31-36）。与设计 §4.1 R1 修订逐字一致；memory.ts:28 / file.ts:35 的 `super({...})` 桥接随动；typecheck EXIT=0 即该形态的编译期证明（SA2 R1 探针曾实证旧形态 EXIT=2）。

### ③ 设计 E.1 / §4.5 披露与实现一致性 —— ✅ 落实（三项逐一对上）

| 披露项 | 设计承诺 | 实现事实 | 判定 |
|---|---|---|---|
| 残留 tmp（E.1） | 清扫仅发生在 `loadDoc` cache-miss 还原路径；S 中不再被访问的 namespace 其 `.tmp` 永久滞留；不做启动全树清扫 | `sweepLeftoverTmp` 全仓**唯一**调用点 = `file.ts:62`（`readCommittedSnapshot` 内，`.snapshot` 命中与 ENOENT 两分支之后）；构造期/apply 无任何扫描；flush 路径不调 sweep（仅 `writeFile flag 'w'` 截断，file.ts:73） | ✅ 一致 |
| degraded 全局半径（§4.5） | 半径 = 整个适配器实例（跨用户跨 namespace）；恢复条件 = 任一 flush 成功（无条件 `status='ready'`）；失败 doc 自身 dirty-retry 兜底 | `status` 为内核单字段（lifecycle.ts:88）；`assertWritable` 对**所有** saveDoc/创建路径全局拒绝（lifecycle.ts:332-335）；成功路径无条件 `this.status = 'ready'`（lifecycle.ts:265）；失败 doc 由 `scheduleRetry` 退避（lifecycle.ts:285-293），dirtyGeneration 保序（lifecycle.ts:276） | ✅ 一致（P2 逐字继承，未动钉死行为） |
| sweep 信号链（§4.5 sweep 行） | best-effort 吞掉删除失败（`.tmp` 无害且永不被读）；同一磁盘状况在下次 flush 的 `writeFile` 响亮浮出（degraded→retry）；POSIX 平台限定已披露 | `fsp.rm(tmpPath, { force: true }).catch(() => undefined)`（file.ts:93）吞掉一切失败；下次 flush `writeFile(tmpPath, …, { signal })`（file.ts:73）失败 → 内核 catch → `persistence-degraded`（lifecycle.ts:266-269）。「unlink 与 writeFile 同需目录 w+x」的信号闭合属运行时性质 → 转SA7 动态项 1 | ✅ 一致（静态面） |

---

## 2. 立法门禁逐项记录

### 2.1 §1.1 文件清单 Scope Creep Guard —— ✅ 无越界（1 项 HG9 豁免裁决）

- BASE：`git config mabf.base-branch` = `adr/server-design` = `37561ac`（注意 `mabf.basebranch` 未设置，skill 命令会回落 `origin/main` 并误含 P1/P2 三个父提交 `7e55bcd`/`653af45`/`37561ac`，已修正）。
- actual（13 文件）− ALLOW（5 文件）− 白名单（`wiki/raw/task_*` ×7）= **`packages/persistence/package.json`**（唯一 ALLOW 外文件）。
- BLACKLIST（package-lock.json / yarn.lock / .DS_Store / TASK.md / *.bak）：**零命中**。
- DENY LIST 实测：`src/testing.ts`、`test/memory-persistence.test.ts`、`test/memory-testkit.ts`、`test/persistence-contract.test.ts`、`tsconfig.json`、根配置——**diff 为空，零触碰**。

### 2.2 硬门禁 9（版本 bump）—— ✅ 落实，附 SA1 文档债

- 实测 `git diff 37561ac 359a030 -- packages/persistence/package.json`：**恰 1 行**，`"version": "0.1.0"` → `"0.1.1"`；`dependencies`/`devDependencies`/`exports`/`scripts` 等结构字段零改动。
- 裁定：HG9（行为变更包 patch bump，本任务新增公共导出 4 名，属行为变更）为总控级立法、高于设计文件清单；bump 合规——同 `task_vfsl-codegen-hardening_sa4_review.md` 先例（SA4 当时裁定 HG9 为更高权威、SA3 合规、设计滞后为文档债）。
- **回流 SA1（文档债，非阻断）**：设计 §9 ALLOW LIST 须增补 `packages/persistence/package.json`（标注「仅 version patch 位一行，硬门禁 9」），DENY LIST 对应条目收窄为「结构性字段不动」。注意本设计把该文件放在 **DENY**（codegen-hardening 案仅是 ALLOW 缺列），DENY 措辞与其「无新依赖」的真实意图不符，修订时应一并澄清。

### 2.3 §1.3 E2E spec 触发性 —— N/A（本任务无 `.spec.ts`）

### 2.4 §1.4 vitest 触发性自检 —— **all-vitest-packages-triggered** ✅

- 本任务新增 `packages/persistence/test/file-persistence.test.ts`；根 `vitest.config.ts` include = `packages/*/test/**/*.test.ts` → 该文件落入收集范围。
- `.github/workflows/ci.yml` test job（node 20/24 矩阵）含 `pnpm test` 步骤（:39）→ CI 必跑；另有独立步骤 `vitest run packages/persistence/test/persistence-contract.test.ts --typecheck`（:44）。`tsconfig.typecheck.json` include `packages/*/test/**` → typecheck 门禁同样覆盖。无 CI 黑洞。

### 2.5 §1.5 协议假设依据 —— ✅ 通过（§7 章节在位，静态可验项逐一复核）

- `MakeDirectoryOptions`（@types/node@20.19.43 `fs.d.ts:1666`）确无 `signal` → 实现采 `mkdir` 不传 signal + `signal.throwIfAborted()` 手工防护（file.ts:70-72）✓（P3）。
- `RmOptions`（`fs.d.ts:1620`）确无 `signal`；`rm force:true` 对缺失路径 resolve ✓（P4）。
- `rename(oldPath, newPath): Promise<void>`（`fs/promises.d.ts:577`）确无 options 参数 ✓（P1 类型面）。
- `readFile/writeFile` options 含 `Abortable`（`fs/promises.d.ts:290/1042` 一带）✓（P2）。
- 运行环境 Node v24.13.0 与设计实测环境一致。无「应该/通常」类无据推断。

### 2.6 §1.6 契约改动连锁 —— ✅ 无公共契约改动（内部搬迁 + 纯增量）

- 无 `return → throw`、签名、async 化类改动；新增导出无既有 caller（grep 证实 `@nomicore/persistence` 包外零消费者——本次复扫 `packages/ apps/ domains/` 确认）。
- effect label `'memory-persistence: service'` → `'MemoryPersistence: service'`（lifecycle.ts:134 参数化）：grep 全仓**无任何测试断言 label** ✓。
- 错误消息逐字保留：`foreign or released DocHandle`（lifecycle.ts:124/326）、`persistence-degraded: writes are rejected until retry succeeds`（:334）、`persisted META.docId … does not match …`（:209）、Memory 侧 disposed 消息字符串与 P2 逐字相同（:330 参数化后值不变）。

### 2.7 §1.7 源码 GREP 断言禁令 —— ✅ 无违例

- `file-persistence.test.ts` 的 2 处 `readFileSync` 均作用于**运行时快照文件**（磁盘字节 → `Y.applyUpdate` 还原断言），唯一 `toContain`（:170）断言还原后的 Yjs 值——全部是行为断言，非源码文本断言。文件头自述「no source text is inspected」属实。无 `.skip/.only/.todo`。

---

## 3. 「不得复制第二套」可审计判据 —— ✅ 成立

- `file.ts` / `memory.ts` 对 `debounce|maxDirty|retry|generation|degraded|evict|WeakMap|setTimeout|clearTimeout|epoch` 的 grep 命中**全部为注释或 `PersistenceStatus` 类型别名**，零实现代码；适配器不引用 `this.schedule/this.timer/this.entries/this.loading/this.inFlight`（grep 计 0）。
- 调度/lease/generation/degraded/eviction 机器物理上仅存在于 `lifecycle.ts` 一份。
- 双 Adapter 行为一致由 `describeDocPersistenceContract(FilePersistence 工厂)`（file-persistence.test.ts:112-123）+ 22 条 memory 既有用例全绿共同钉死。

---

## 4. 逐字搬迁核验（P2 `37561ac:memory.ts` → `lifecycle.ts`）

24 个搬迁成员逐一比对（loadDoc/saveDoc/apply/dispose/[CORE_TEST_FACTORY]/releaseHandle/restoreEntry/createEntry/issueHandle/scheduleFlush/onDebounce/onMaxDirty/startFlush/flush/scheduleRetry/maybeEvict/cancelDebounce/cancelMaxDirty/clearTimers/track/assertOwnedHandle/assertReadable/assertWritable/isCurrent + CoreDocHandle/Entry/WeakMap×2/toPersistenceKey）：

- **逐字一致**，仅设计 §4.1 明示的缝改动：`validateIdentity` 注入 ×2（loadDoc:102 / saveDoc:121 / test 工厂:165，且在 cache 查找**之前**——cache-hit 路径同样校验，符合决策 C）；I/O 缝三参化（`restoreEntry` 读经 `readCommittedSnapshot`，`flush` 写经 `writeCommittedSnapshot`）；`onSnapshotCommitted`/`disposeAdapterState` 钩子化；更名（Entry→CoreEntry、MemoryDocHandle→CoreDocHandle、TEST_FACTORY→CORE_TEST_FACTORY、toKey→toPersistenceKey）；label 与 disposed 消息参数化。
- **`flush`+`writeSnapshot` 拆解的 epoch 次序等价**（设计 §4.2/§6.3 声明）：原「callback → epoch 检查 → map.set → status='ready'（writeSnapshot 内）→ savedGeneration/retryDelayMs（flush 内）」现收敛为「纯 I/O → epoch 检查 → onSnapshotCommitted(map.set) → savedGeneration → retryDelayMs → status='ready'」。status 与 savedGeneration 的相对次序虽有调换，但两者间**无 await、同一同步区**，事件循环上无观察者可插入 → 不可观察差异。dispose 迟到完成不复活 map（epoch 防护在 map.set 之前）语义保持。
- **`MemoryPersistenceOptions`（含 readSnapshot/writeSnapshot 的 `(key, signal)` 签名）逐字未动**（memory.ts:10-17 vs 原版 :32-39 字符级一致）；`createMemoryPersistence`/`createMemoryPersistencePlugin`/`createMemoryHandleForTest` 逐字保持；P2 三套测试文件零改动即全绿 = 公共面零变化的最强证明。
- `index.ts` 恰 +6 行（4 个 re-export，§4.4 逐字）；`lifecycle.ts` 未进包公共导出 ✓；`exports` map 仍只有 `.` ✓。

---

## 5. 新发现（本轮攻击产出）

### F-1【MEDIUM，非阻断】深路径模块初始化次序脆弱（`extends` TDZ），设计 §6.4-① 论据事实错误

**可复现证据**（vitest 临时用例，跑毕即删）：

| 入口模块（不先经 index.js） | 崩溃点 | 错误 |
|---|---|---|
| 仅 `../src/memory.js` | `file.ts:33` | `TypeError: Class extends value undefined is not a constructor or null` |
| 仅 `../src/file.js` | `memory.ts:24` | 同上 |
| 仅 `../src/lifecycle.js` | `memory.ts:24` | 同上 |
| `../src/index.js` 在前（全部既有测试与包唯一 exports 入口） | — | 正常 |

**根因**：值环 `lifecycle.ts --(provideDocPersistence 等)--> index.ts --(re-export)--> memory.ts/file.ts --(extends 值)--> lifecycle.ts`。`class X extends PersistenceLifecycleCore` 在模块体求值期读取 lifecycle.js 绑定；若求值起点不是 index.js，lifecycle.ts 尚未执行到类声明 → TDZ。

**设计偏离**：§6.4-① 声称「lifecycle.ts/**file.ts** 的模块顶层从不读取这些循环导入的绑定」——对 lifecycle.ts→index.js 方向成立，但对 file.ts/memory.ts→lifecycle.js 方向**不成立**（extends 即顶层读值）。SA2 R2 复核「file.ts 顶层（正则字面量；index.js 为 type-only import）」只验证了 index.js 方向，漏了 lifecycle.js 方向。与 SA2 攻击点 #5 同类（论据事实错误，结论在受支持路径上侥幸成立）。

**半径评估（为何非阻断）**：
1. 包 `exports` map 只暴露 `.`——包外**无法**深导入（Node 会 `ERR_PACKAGE_PATH_NOT_EXPORTED`）；grep 证实包外零消费者。
2. 全部 3 个既有测试文件均 index-first（file-persistence.test.ts:25/33、memory-persistence.test.ts:4/11、persistence-contract.test.ts:4），493 用例 + CI 全绿。
3. 失败模式是**导入期响亮崩溃**（fail-fast），不可能静默错行为。
4. P2 时代不存在此雷（原 `implements DocPersistence` 为类型擦除，无运行时 extends）——本任务新引入，但由设计决策 A 的伪代码直接决定，SA3 忠实实现，**回流目标是 SA1 而非 SA3**。

**处置**：① 回流 SA1：§6.4-① 勘误 + 补「入口次序不变式：任何深路径消费者必须先（直接或传递）导入 `src/index.js`」入设计/包文档；② 加固候选（另立 follow-up，非本任务）：把 `provideDocPersistence`/`resolvePersistenceSchedule`/`systemPersistenceTimer`/`DOC_PERSISTENCE_SERVICE` 下沉为无环叶子模块、index.ts 纯 re-export 保持 P1 公共面不变，即可根除；③ SA7 探针须知：动态验证脚本**必须 index-first 导入**，否则收集期 TypeError 会被误判为实现缺陷（已列入动态审核重点 4）。

### F-2【LOW，文档债】设计 §9 与硬门禁 9 冲突

见 §2.2。bump 本体合规，SA1 修订 ALLOW/DENY 表即闭合（先例：vfsl-codegen-hardening v1.2）。

---

## 6. 其余维度结论

- **读写路径一致性**：✅ 写 = `writeCommittedSnapshot`（tmp→rename 落盘），读 = `readCommittedSnapshot`（只认 `.snapshot`），同一 `resolveSnapshotPaths` 双向共用，无分叉；memory 侧写 = flush 后 `onSnapshotCommitted` 内部 map，读 = 同一 map（或注入回调），与 P2 同构。
- **静默失败扫描**：✅ 未发现。load 链非 ENOENT 读错误全部上抛（file.ts:59）；文法违例/META.docId 不一致/foreign handle 全 loud throw；唯一吞错点 `sweepLeftoverTmp` 为契约性 best-effort 且信号闭合论证成立（运行时闭合 → SA7）。
- **降级审查**：✅ 无新增降级路径。ENOENT→null 是规格内 miss；degraded/retry 为 P2 逐字继承（改它反而越界）。
- **极端条件攻击**：✅ 除 F-1 外未破防——空/非字符串 rootDir → 构造期 TypeError（file.ts:37-39）；`../escape`、`a/b`、`a\b`、空串、64 字符、大写、下划线等 17 类非法段全拒（SA6 11×6 钉死 + 双重校验 file.ts:84）；EISDIR/EACCES 读 → 上抛；abort 中途 → throwIfAborted 三处手工防护（file.ts:70/72/74）+ readFile/writeFile Abortable；dispose 中途 rename 窄窗 = 设计已披露的有效旧状态 + epoch 防护（file.ts:77-79）。
- **错误处理链路**：✅ 与设计 §4.5 矩阵逐行对上（10 行全核对）。
- **架构评估**：✅ 可行。继承式内核 + `(user, docId, signal)` 缝 + validateIdentity 钩子在实现中形态干净；F-1 是可文档化的入口纪律/后续加固项，非死胡同信号。
- **过度设计**：✅ 精简。file.ts 132 行（低于设计预估 ~170）；无双写、无多余抽象层；纵深防御 = 一次正则重用。

---

## 7. SA6 文件完整性

- Phase-1 红灯记录所引行锚（`:26-27` 缺失导出、`:33` createFileHandleForTest 导入、`:99` await 用法、`:153-186` 全量还原用例）与 commit 内文件**逐一对上**（无行漂移 ⇒ SA3 未改动 SA6 断言）。
- 11 条映射用例（简报映射表）全部在场、无 skip、无断言弱化；SA3 零「为转绿改测试」痕迹。

---

## 8. 动态审核重点（交 SA7）

1. **sweep 吞错信号链端到端**（SA2 构想 #5）：chmod 555 `users/alice`（r-x）+ 遗留 tmp + 有效 snapshot → load 成功（unlink EACCES 被吞、snapshot 正常还原）→ 随后 saveDoc → flush 的 writeFile EACCES → 断言 `status='persistence-degraded'`（「信号在下次 flush 响亮浮出」运行时闭合）。
2. **degraded 跨用户半径**（SA2 构想 #4）：chmod 500 `users/bob` → bob flush EACCES 失败 → 断言 **alice** 的 saveDoc/创建路径同样被拒；随后 alice 自身 flush 成功 → 断言 status 翻回 `ready` 而 bob 仍在退避 retry（无关 doc 成功即恢复可写的继承语义）。
3. **残留 tmp 钉死**（SA2 构想 #1，现为 E.1 文档承诺）：seed `d1.snapshot.tmp` + `d2.snapshot.tmp`，仅 loadDoc d1 → 断言 d1.tmp 已删、**d2.tmp 仍在**。
4. **模块入口纪律（F-1）**：SA7 一切探针/脚本必须先 import `../src/index.js`（或仅用它）再触深路径；若见 `Class extends value undefined` 即入口次序问题，**不是**实现缺陷，勿误报。
5. **rename/chmod 平台行为**：SA6 用例 8（chmod 444 + rename 覆盖）在 CI Linux 上已锚定，SA7 侧仅需复跑确认，不另开攻击面。
6. **多实例同 rootDir**：v1 明确调用方错误（ADR-0006 无文件锁），SA7 不得将其记为缺陷。

---

## 9. 结论

| # | 维度 | 结论 |
|---|---|---|
| 1 | 设计一致性 | ✅ 一致（缝改动 4 处均在设计明示清单内；F-1/F-2 为设计文本债，回流 SA1） |
| 2 | 读写路径一致性 | ✅ 一致，无分叉 |
| 3 | 静默失败 | ✅ 无（sweep 吞错为契约性 best-effort，运行时闭合交 SA7 项 1） |
| 4 | 降级方案 | ✅ 安全（P2 逐字继承，未新增降级） |
| 5 | 极端攻击 | ⚠️ 发现 F-1（MEDIUM，深入口 TDZ；包外不可达、响亮失败、回流 SA1 文档勘误 + follow-up 加固，非阻断） |
| 6 | 错误处理 | ✅ 完整（§4.5 矩阵 10 行全对上） |
| 7 | 架构评估 | ✅ 可行（无需退回 SA1 重设计） |
| 8 | 过度设计 | ✅ 精简 |

**Verdict: pass** —— SA3 实现与设计 R1 逐项吻合，三项移交核对全部落实，硬门禁 9 bump 合规，DENY/BLACKLIST 零触碰，493 测试 + typecheck 独立复跑全绿，SA6 锚点零漂移。SA7 可进入动态验证（重点见 §8）。回流件：SA1 ×2（§6.4-① 勘误 + §9 ALLOW/DENY 增补 package.json version 行），均为文档级。
