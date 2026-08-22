# SA4 静态验尸报告 — 修订轮 R1（owner review #2/#3/#4/#5）

**Date**: 2026-08-21
**Verdict**: pass
**审查对象**: commit `5906ad3`（feat(persistence): R1 owner-review fixes）+ 关联 commit `c481ac8`（总控 git 清理，无代码）
**对照基准**: SA1 R3 设计 `task_file-persistence-plugin_design.md`（决策 G/H、决策 E 第 4 条、决策 F 追加、§9 ALLOW/DENY）；修订轮简报 `task_file-persistence-plugin_rev1.md`（5 条反馈 + 复审门禁）
**前轮报告**: `task_file-persistence-plugin_sa4_review.md`（P3 原轮，verdict = pass @ 359a030）

---

## 0. 复审门禁逐条核验（rev1 简报，owner 原文）

| 门禁 | 证据（命令 + 结果） | 结论 |
|---|---|---|
| PR diff 不含任何 `.mabf-bg/**` / `TASK.md` | `git diff --name-only origin/adr/server-design HEAD \| grep -E '^\.mabf-bg/\|^TASK\.md$'` → **空输出**；`c481ac8` 的 `.mabf-bg` 三文件均为删除/恢复 base 内容操作 | ✅ |
| 无 `index → adapter → lifecycle → index` 循环 | `grep -rn "from './index" packages/persistence/src/` → **零命中**；`contract.ts` 内无任何 `./index.js`/`./lifecycle.js`/`./memory.js`/`./file.js`/`./testing.js` import（叶子不变量成立） | ✅ |
| adapter 模块可直接导入，不依赖导入顺序 | `test/module-graph.test.ts` 3 用例：`vi.resetModules()` 后 `../src/file.js` / `../src/memory.js` / `../src/lifecycle.js` 三深路径各自全新入口**构造实例**（构造即原 `Class extends value undefined` TDZ 崩溃点）——全绿 | ✅ |
| degraded/recovery 按 namespace/entry 隔离 | `file-persistence-sa7-dynamic.test.ts` §8.2 S1（bob 降级仅拒 bob；alice saveDoc resolves；carol 全新 namespace 创建+写入 accepts）、S2（bob degraded 期间 loadDoc 正常返回共享 live doc）——全绿 | ✅ |
| 无关 doc 成功不能提前恢复失败 doc | §8.2 S3：alice 的 `fine.snapshot` 落盘后，bob saveDoc **仍** rejects `/persistence-degraded/`，聚合**仍** `'persistence-degraded'`，`doomed.snapshot` 不存在——全绿 | ✅ |
| `.tmp` 非 ENOENT 删除失败按最终 ADR 语义处理并测试 | `file.ts sweepLeftoverTmp`：仅 ENOENT 防御分支返回，其余包装 Error（tmp 路径 + errno + `cause`）上抛 → loadDoc rejects；§8.1 断言消息含 tmpPath 与 EACCES、tmp 未被触碰、`.snapshot` 未被触碰、权限修复后 load 成功且 tmp 被清——全绿 | ✅ |
| 全量 `pnpm test`、`pnpm typecheck` 双全绿（Node 20/24 CI 由 runner 跟踪） | 独立进程实测（worktree 根，2026-08-21 21:26）：**TYPECHECK_EXIT=0 / TEST_EXIT=0 / Test Files 35 passed (35) / Tests 499 passed (499) / Type Errors none**——恰为设计 §10 步骤 6 预期（35 文件、≥499 用例） | ✅（本地） |

---

## 1. 审核结论

### 1.1 文件清单 Scope Creep Guard — ✅ 无越界

- R1 commit `5906ad3` 实际改动 10 文件，**逐一命中 §9 ALLOW LIST**（contract.ts 新建 / lifecycle.ts / file.ts / memory.ts / index.ts / testing.ts / module-graph.test.ts 新建 / file-persistence-sa7-dynamic.test.ts / memory-persistence.test.ts / package.json），comm 差集为空。
- 黑名单（package-lock.json / yarn.lock / .DS_Store / TASK.md / *.bak）零命中。
- 硬约束逐项复核：
  - **M-1（SA6 文件零改动）**：`file-persistence.test.ts` 最后一次改动在 `359a030`（P3 原轮），R1 diff 不含该文件 ✅；且其在 R1 语义下 11 项用例全绿（M-1 复核表成立）。
  - **M-6（memory-persistence.test.ts 恰 1 处断言）**：diff 实测 = `:285` 一行 rejects→resolves 翻转 + 3 行注释 + 追加 1 行隔离断言（`saveDoc(other)` resolves），其余 511 行零改动 ✅。
  - **package.json 恰 1 行**：diff 仅 `"version": "0.1.1"` → `"0.1.2"`，exports/依赖等结构性字段零改动（HG9 授权范围内）✅。
  - `c481ac8`（总控）只动 `.mabf-bg` 三文件 + wiki 三文件，无生产代码。

### 1.2 设计一致性（决策 G/H/E4/F）— ✅ 逐字落地

| 设计要求 | 实现核对 |
|---|---|
| **决策 G**：contract.ts 承接 P1 契约（类型 5 + 值 6 + Context 增强）；index.ts 纯 re-export；四处 `./index.js` → `./contract.js` | 逐字核对通过。**公共 API 符号面 diff 实测 DEFS-IDENTICAL**（P1 定义名集合新旧全等）+ 三段 re-export 名单逐一相同——决策 D「零增项」继续成立 |
| **决策 H**：删类字段 `status`；`CoreEntry.degraded`；`getStatus()` 聚合（disposed > 任一 degraded > ready）；`assertEntryWritable`（消息逐字 `'persistence-degraded: writes are rejected until retry succeeds'`）；saveDoc 次序 disposed → identity → ownership → degraded；flush 成功/失败双翻转仅作用本 entry；`[CORE_TEST_FACTORY]` 既有 degraded entry 拒绝、全新 namespace 不拒 | lifecycle.ts R1 diff 逐行核对全部命中，无额外改动。disposed 报错语义与 pre-R1 `assertWritable = assertReadable + degraded` 完全等价（行为无漂移） |
| **决策 E 第 4 条**：`sweepLeftoverTmp` 仅 ENOENT 视为无文件，其余包装 Error（tmp 路径 + errno + `cause`）上抛 | file.ts:113-122 与设计 §4.3.2 伪代码逐字一致 |
| **决策 F 追加**：rootDir 单写者 JSDoc 逐字文案 | file.ts:16-31 与设计 §4.3.1 文案逐字一致（SINGLE-WRITER OWNERSHIP 段） |
| **§6.1 护栏**：memory 桥接 `??` 回落表达式须与 P2 `memory.ts:171` 逐字同构 | base 分支原文 `await (this.options.readSnapshot?.(key, this.abortController.signal) ?? this.snapshots.get(key)?.snapshot)` vs 现 `return this.options.readSnapshot?.(key, signal) ?? this.snapshots.get(key)?.snapshot`（async return 语义等价 await 包裹）——`??` 作用于回调立即返回值、在 await 之前求值的三分支语义**形态保持**，注释与实现一致 ✅ |

### 1.3 CI 触发性（§1.3/§1.4 立法）— ✅ 全部接通

- `ci.yml` Node **20/24 矩阵**；`pnpm test` → 根 `vitest.config.ts` include `packages/*/test/**/*.test.ts` **覆盖本任务全部 3 个改动测试文件**（本次实跑 35 文件中 `module-graph.test.ts (3)` / `file-persistence-sa7-dynamic.test.ts (3)` / `memory-persistence.test.ts (22)` 均被收集执行）；`pnpm typecheck` 含 `tsc -p packages/persistence/tsconfig.json`；另有 `persistence-contract.test.ts` 显式 CI 步骤。无孤儿 spec。

### 1.4 协议假设（§1.5 立法）— ✅ R1 相关假设经实跑复证

- **P13**（r-x 目录内 `fsp.rm` 以 EACCES 拒绝）：§8.1 测试实跑通过且断言消息含 `EACCES` ——「设计期实测」类依据复跑一致。
- **P12**（`vi.resetModules()` + 动态 import 全新入口）：module-graph 3 用例实跑通过。
- 其余 P1–P10 假设未受 R1 触碰（flush I/O 链路零改动）。

### 1.5 契约改动连锁审查（§1.6 立法）— ✅ 半径闭合

R1 含 4 项行为级契约改动（saveDoc 拒绝半径 / CORE_TEST_FACTORY 拒绝半径 / getStatus 聚合 / sweep 失败可见性），caller 三层防御矩阵：

| Caller | A 直接 try/catch | B await 完整 | C 顶层 catch-all | 结论 |
|---|---|---|---|---|
| `test/memory-persistence.test.ts`（saveDoc/getStatus 全部调用点） | expect 捕获 | await | — | ✅ `:285` 行为翻转已被 M-6 改写对齐 |
| `test/file-persistence.test.ts`（SA6，零改动） | expect 捕获 | await | — | ✅ M-1 复核：无断言依赖全局降级半径，实跑全绿证明 |
| `test/file-persistence-sa7-dynamic.test.ts` | expect/waitFor | await | — | ✅ 重写后断言新语义 |
| `test/module-graph.test.ts` | expect | await | — | ✅ |
| 包外（apps/ 其他 packages） | `git grep "@nomicore/persistence" -- apps/ packages/ ':!packages/persistence'` → **零消费者** | — | — | ✅ 无隐藏 caller |
| 顶层兜底 | `git grep "process.exit\|unhandledRejection\|uncaughtException" -- packages/persistence/` → **零命中** | | | ✅ 无进程级放大风险 |

saveDoc 检查次序变化（degraded 实例 + foreign handle 报错文本从 `/persistence-degraded/` → `foreign or released DocHandle`）：grep 证实无任何测试钉死旧优先级，实测无回归。

### 1.6 测试质量（§1.7 源码 grep 断言禁令）— ✅ 通过

3 个 R1 改动测试文件扫描：无 `readFileSync(<.ts 源码>) + toMatch/toContain` 反模式。`file-persistence-sa7-dynamic.test.ts` 的 `readFileSync` 读的是**运行时磁盘快照字节**（`.snapshot` 文件），`toContain` 断言的是 **error.message**——均为真·运行时行为断言；`module-graph.test.ts` 为动态 import + 构造行为测试。

### 1.7 读写路径一致性 — ✅ 无分叉

写路径（flush 成功 → memory `onSnapshotCommitted` 写内部 map / file `rename` 提交 `.snapshot`）与读路径（`readCommittedSnapshot`）同源同 key（`toPersistenceKey` / `resolveSnapshotPaths` 一致派生）；degraded 状态的写门（`assertEntryWritable`）与状态翻转（flush catch）同属一个 entry 对象，无跨源读取。

### 1.8 静默失败 — ✅ 无新增，且 R1 消除两处历史静默

- sweep 失败：从 `.catch(() => undefined)` 吞掉 → 响亮上抛（本轮主诉）。
- degraded：flush 失败仍有可观察效应（entry.degraded → saveDoc 拒绝 + getStatus 聚合变化），非静默。
- 观察项（非阻塞，见 §3）：flush 的原始 errno 仍被 catch 丢弃（P2 逐字继承，非 R1 回归）。

### 1.9 降级方案 — ✅ 安全

R1 未新增任何降级路径；相反，删除了两处**虚假降级**（tmp 删除吞错、全局 degraded 掩盖无关 namespace）。设计决策 H 不变式静态验证成立：

- **degraded ⇒ dirty ⇒ 常驻**：flush 失败时 `savedGeneration` 不推进，`maybeEvict` 的 `savedGeneration !== dirtyGeneration` 前置永真 → degraded entry 不可驱逐 → 跨 release/reload 存活（S2 读保留的结构基础）。
- **恢复原子性**：`entry.degraded = false` 与 `savedGeneration` 推进位于 flush 成功路径同一同步段（lifecycle.ts:285-287）。
- **恢复只认自己**：成功路径仅写本 entry 字段；旧 `this.status = 'ready'` 越权写已删除（diff 证实）。

### 1.10 极端条件攻击 — ✅ 未发现可静态确认的漏洞

已构造并推演的攻击面（静态推理，无运行时缺陷确认）：

| 攻击 | 结果 |
|---|---|
| degraded entry 被驱逐后状态丢失 | 不可能：maybeEvict 三重前置（handles/flushing/generation）挡死 |
| degraded entry 期间 flush 卡死（retry 丢失） | flush 失败 → `scheduleRetry` 必达（catch 路径唯一出口）；finally 段 `retryTimer !== undefined` 阻止 debounce 重排但不影响 retry 已挂起 |
| 聚合 `'persistence-degraded'` 期间 healthy namespace 写被误拒 | 不可能：写门是 `assertEntryWritable(entry)`，与聚合视图解耦（S1 alice/carol 断言钉死） |
| 清扫失败 → load 拒绝后留下半初始化 entry | 不可能：`restoreEntry` 在 `createEntry` 之前抛出，entries 无残留（§8.1 断言 `getStatus() === 'ready'` 钉死） |
| tmpPath 是**目录**（非文件）的遗留物 | `rm(file, {force:true})` 无 recursive → EISDIR/EPERM → 非 ENOENT → 响亮拒绝（正确：契约「忽略并删除」无法成立） |
| rootDir 不存在时 load | readFile ENOENT → miss；`rm force` 对缺失路径 resolve；**不 mkdir 不留痕** ✅ |
| 同一 entry 的 saveDoc 在 ownership 检查与 scheduleFlush 之间被逐出 | 不可能：单线程同步段，无 await 间隙 |
| disposed 后迟到 flush 复活状态 | epoch 防护 + abort signal（`signal.throwIfAborted()` ×3 手工防护 mkdir/rename 缝隙）保持；rename 窄窗口竞态已由设计 §4.3.2 披露接受 |

### 1.11 错误处理链路 — ✅ 完整

§4.5 错误矩阵逐行与实现比对一致（grammar loud throw / META.docId loud throw / 损坏字节 Y.applyUpdate throw / readFile ENOENT miss / readFile 非 ENOENT 上抛 / flush 失败 entry 级 degraded / sweep 非 ENOENT 上抛 / rootDir TypeError / disposed throw / foreign handle throw）。每条拒绝路径均有响亮信号，无吞错分支残留（`grep -n "catch(() =>" src/` 零命中）。

### 1.12 架构评估 — ✅ 可行

四项结构性修订全部收敛于 `packages/persistence` 包内（7 src + 3 test + package.json），包外零消费者零涟漪；无绕过架构约束的补丁、无 FIXME；决策 G 的叶子模块方案以最小变更根除值环（未引入双 barrel、未异步化构造）。

### 1.13 过度设计 — ✅ 精简

contract.ts 120 行为纯搬迁（零新逻辑）；lifecycle.ts R1 净改动 ~25 行（与设计预算一致）；file.ts 净改动 ~35 行（sweep 响亮化 + JSDoc）；module-graph.test.ts 61 行聚焦单一回归点。无投机抽象。

---

## 2. 非阻塞观察项（不构成 reject，供后续轮次参考）

| # | 观察 | 定性 |
|---|---|---|
| O-1 | `file-persistence-sa7-dynamic.test.ts:157/:181` 注释写 "bob's/alice's **debounce** trigger"，实际 `fireOldest()` 触发的是各自 entry 的 **max-dirty** timer（插入序 maxDirty 先于 debounce）。行为正确（文件自身 ManualTimer docstring 已声明两者等价达 `startFlush`），仅注释措辞不精确 | 注释瑕疵 |
| O-2 | flush 的 `catch {}` 丢弃原始 I/O 错误（errno 不进 degraded 信号），运维只能从 saveDoc 拒绝看到降级、看不到原因。P2 逐字继承，非 R1 回归；将来可加 `entry.lastError` 或 metric 钩子 | 历史遗留，follow-up 候选 |
| O-3 | `Y.encodeStateAsUpdate(entry.doc)` 位于 flush 的 try 块之外（lifecycle.ts:280）——若此处 throw，`entry.flushing = true` 永不复位且 degraded 不置位。静态推演不可达（flush 中的 entry 不可能被 evict/dispose 并发销毁：maybeEvict 以 `!flushing` 为前置、dispose 后 epoch 检查先行拒绝）。P2 逐字继承，非 R1 回归 | 理论死锁面，不可达 |
| O-4 | `[CORE_TEST_FACTORY]` 与在途 `loadDoc`（cache-miss loading 中）并发调用同 key：工厂建新 entry，restore 完成后 `entries.set(key, …)` 覆盖之，工厂 handle 的后续 saveDoc 得到响亮 `foreign or released DocHandle`（非静默损坏）。test-only seam、生产不可达、P2 形态继承 | 动态审核可选验证点 |

---

## 3. 动态审核重点（交 SA7，可选）

本轮 R1 改动的核心运行时行为已由 `file-persistence-sa7-dynamic.test.ts`（§8.1/§8.2 S1–S4）+ `module-graph.test.ts` 在本地全绿钉死，CI Node 20/24 由 runner 跟踪。以下为可选追加验证点：

1. **O-4 竞态探针**：并发 `loadDoc` + `createFileHandleForTest` 同 `(user, docId)`，确认败方得到 loud `foreign or released DocHandle` 而非数据静默丢失（test-only 面，低优先级）。
2. **CI spec 触发证据**：从 `gh run view --log` 摘录 `module-graph.test.ts` 与 `file-persistence-sa7-dynamic.test.ts` 在 Node 20 与 24 两个 job 的执行行（SA7 SKILL「Spec 触发证据」要求）。

---

## 4. 验证证据汇总

| 命令 | 结果 |
|---|---|
| `pnpm typecheck`（独立进程） | EXIT=0 |
| `pnpm test`（= `vitest run --typecheck`，独立进程） | EXIT=0；Test Files 35 passed (35)；Tests 499 passed (499)；Type Errors none |
| `git diff --name-only origin/adr/server-design HEAD \| grep -E '^\.mabf-bg/\|^TASK\.md$'` | 空输出 |
| `grep -rn "from './index" packages/persistence/src/` | 零命中 |
| `git grep "@nomicore/persistence" -- apps/ packages/ ':!packages/persistence'` | 零外部消费者 |
| `git diff e8e4fb8 5906ad3 -- …/memory-persistence.test.ts` | 恰 `:285` 1 断言翻转 + 注释 + 1 行隔离断言 |
| `git log --oneline -- …/file-persistence.test.ts` | 最后改动 359a030（P3），R1 零触碰 |

**Verdict: pass** —— R1 四项修订（#2/#3/#4/#5）逐字落实设计决策 G/H/E4/F，复审门禁 7/7 全过，本地双全绿；未发现需回流的缺陷。
