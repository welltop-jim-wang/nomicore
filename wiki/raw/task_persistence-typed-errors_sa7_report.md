# SA7 动态验证报告 — issue #108 persistence：typed load/create 错误与 committed-aware create fatal（Phase 3）

- **Date**: 2026-06-0x（SA4 pass 后动态验证会话）
- **Verifier**: SA7（Dynamic Verifier / 动态攻击验证）
- **Worktree**: `/home/wangjian/nomicore-fix-issue-108`（branch `fix/issue-108-on-docs-namespace-registry`，SA3 改动未提交、以工作树 diff vs `ba1b6b4` 为评审对象）
- **前置**: SA4 verdict = **pass**（`wiki/raw/task_persistence-typed-errors_sa4_review.md` L11）→ SA7 进入动态验证（Step 0 校对通过）
- **验证方法纪律**: 所有 vitest/探针命令均以后台独立进程执行（`setsid nohup … & disown`，exit code 落 `/tmp/*.exit`）；探针脚本只放 `/tmp`；零 `src/`、`test/` 文件改动、零 git 写操作（验证前后 `git status --porcelain` 逐行一致，见 §清理确认）

---

# Verdict: **pass**

7 项动态重点全部执行（无放弃项）：时序锚 5 连跑 0 flake、EC7 cause 形态在 Node 20/24/18 三个真实版本实测成立（超出双版本要求）、EC5(File) 磁盘事实探针补证成功、dsh probe 确定性逐字节双跑一致、flush 三结局结局不变、wrapIo 不泄入生产插件工厂的 tsc 静态锚以 TS2353 精确命中、4 项自由攻击全部失败于击穿（0 unhandled rejection）。未发现任何 SA4 静态结论被动态证伪的点。

---

## 1. 时序锚防 flake（EC5/EC7/EC10/§5.4.2，5 连跑）

**命令**（循环体 ×5，后台独立进程，exit code 落文件）：

```bash
cd /home/wangjian/nomicore-fix-issue-108 && npx vitest run packages/persistence   # 各次输出 → /tmp/sa7-persistence-run$i.log
```

| 轮次 | exit code | Test Files | Tests | Type Errors | Unhandled 段 |
|---|---|---|---|---|---|
| run1 | 0 | 10 passed (10) | **94 passed (94)** | no errors | 无（grep 计数 0） |
| run2 | 0 | 10 passed (10) | **94 passed (94)** | no errors | 无 |
| run3 | 0 | 10 passed (10) | **94 passed (94)** | no errors | 无 |
| run4 | 0 | 10 passed (10) | **94 passed (94)** | no errors | 无 |
| run5 | 0 | 10 passed (10) | **94 passed (94)** | no errors | 无 |

- `grep -cE "Unhandled Rejection|Unhandled Errors" /tmp/sa7-persistence-run{1..5}.log` → 全部 `0`（vitest 对 unhandled rejection 判败，其缺席 5/5 持续成立 = §4.2.6 completion.catch 修复的进程级证据稳定）。
- 追加一轮 `--reporter=verbose`（exit 0，同样 94/94）摘录四个时序锚的逐用例证据（含 2000ms withTimeout 护栏构造，全部 ✓ 且单次毫秒级完成）：

```
✓ memory-persistence.test.ts > DocPersistence typed error contract > EC5: a dispose after commit is DocCreateFatalError post-commit committed:true and never rolls back  3ms
✓ memory-persistence.test.ts > DocPersistence typed error contract > EC7: a store write aborted by dispose is DocCreateFatalError store-write committed:false  1ms
✓ memory-persistence.test.ts > DocPersistence createDoc contract > settles an in-flight create when dispose races it, leaving no timers or hidden leases (§5.4.2)  1ms
✓ memory-persistence.test.ts > MemoryPersistence delegation-model committed:true anchor (issue #108 EC10) > reports committed:true when an abort-during-hook write still commits, and the read path agrees  1ms
✓ file-persistence.test.ts   > DocPersistence typed error contract > EC5: a dispose after commit is DocCreateFatalError post-commit committed:true and never rolls back  3ms
✓ file-persistence.test.ts   > DocPersistence typed error contract > EC7: a store write aborted by dispose is DocCreateFatalError store-write committed:false  1ms
```

verbose 全日志 ✓ 计数 94、失败 0（grep 到的 1 处 "failed" 字样为用例名 `degraded/recovery is entry-scoped: only the failed (user, docId)…` 的 ✓ 行，非失败）。

## 2. EC7 cause 形态跨版本（signal.reason = DOMException AbortError `instanceof Error`）

**本机版本盘点**：`/usr/local/bin/node` = **v24.13.0**（默认 PATH）；`/usr/bin/node` = **v18.19.1**（系统 apt，额外加验）；无 nvm/volta/fnm；**docker 本地已有 `node:20-slim` 镜像（v20.20.2）** → 双版本实测**不需要放弃**，20/24 双版本均完成真实运行。

**(a) 一次性 DOMException 探针**（`/tmp/sa7-probe-domexception.mjs`，纯 Node 零依赖，四个断言面：默认 abort reason / 直接构造 / `throwIfAborted` identity / abort-listener 观察到的 reason）——三个版本全部 PASS：

| 版本 | exit | 关键输出 |
|---|---|---|
| v24.13.0（宿主） | 0 | `default-abort-reason {"ctor":"DOMException","name":"AbortError","instanceofError":true,"protoChainHasError":true,"instanceofDOMException":true}` · `throwIfAborted {"thrownInstanceofError":true,"sameIdentityAsReason":true}` · `abort-listener-reason {"instanceofError":true}` |
| v20.20.2（docker node:20-slim） | 0 | 同上四面全 true（`PROBE-DOMEXCEPTION PASS (node v20.20.2)`） |
| v18.19.1（宿主系统 node，加验） | 0 | 同上四面全 true |

**(b) persistence 套件双版本分别核对**：

- Node 24（宿主）：第 1 项 5 连跑 94/94（含 EC7 memory+file 两条 ✓）。
- Node 20（docker）：`docker run --rm --user 1000:1000 -v <worktree>:/w -w /w node:20-slim node …/vitest.mjs run --cache=false packages/persistence` → **exit 0，Test Files 10 passed (10)，Tests 94 passed (94)，Type Errors no errors，无 Unhandled 段**（`/tmp/sa7-persistence-node20u.log`）——EC7 的 `cause instanceof Error` 断言在 v20.20.2 真实成立。

**环境备注（区分验证与环境阻塞）**：node:20 首次以容器默认 **root** 运行时 3 个用例失败（EACCES sweep / degraded entry-scoped / issue-79 entry-status）——根因是 root 持 `CAP_DAC_OVERRIDE` 绕过 `chmod 555/500`，三个用例全部依赖「非 root 被 chmod 拒绝写/unlink」，属容器环境属性而非代码缺陷；改 `--user 1000:1000` 后同一套件 94/94 全绿即证。CI runner 非 root，不受影响。

**文档佐证（跨版本语义非偶然）**：WHATWG DOM Standard 将 `DOMException` 声明为 `interface DOMException : Error`（[dom.spec.whatwg.org](https://dom.spec.whatwg.org/#domexception)；WebIDL 层 [[ErrorData]] 继承讨论见 [whatwg/webidl #1421](https://lists.w3.org/Archives/Public/public-webapps-github/2024Aug/0552.html)）；Node 的 `AbortController.abort()` 默认 reason 即该 DOMException AbortError（[nodejs/node #36319](https://github.com/nodejs/node/pull/36319)）。20/24/18 三版本 live 实测一致，结论不需要再依赖外层 CI 兜底（CI 矩阵绿仍由总控在 publish 后按流程核）。

## 3. EC5(File) 磁盘事实探针（hold.entered 时 `.snapshot` 已在盘上）

**构造**（`/tmp/sa7-probe-ec5-disk.mts`，`npx tsx` 运行；复用 `createPersistenceIoFaultSeam` + 真实 `mkdtemp` `FilePersistence` + `holdNextWriteAfterCommit`，2000ms 护栏；**未放弃**）：

```
createDoc(不 await) → await hold.entered →【同步断言磁盘事实】→ dispose(不 await) → hold.release() → await dispose → 收 rejection 断言 fatal → fresh FilePersistence 读回
```

**结果：exit 0，PASS**（`/tmp/sa7-ec5-disk.log`）：

```
[PROBE-EC5-DISK] at hold.entered: /tmp/sa7-ec5-disk-*/users/probe-user/ec5-disk-doc.snapshot on disk (71 bytes), decodes to ROOT.who=on-disk-before-fatal
[PROBE-EC5-DISK] rejection: DocCreateFatalError phase=post-commit committed=true code=DOC_CREATE_FATAL
PROBE-EC5-DISK PASS
```

- **磁盘事实**：`hold.entered` 时刻（dispose/release 均未发生）同步 `readFileSync` 断言 `.snapshot` 存在（71 字节）、无 `.tmp` 残留（rename 已完成=commit 已落盘）、字节可 `Y.applyUpdate` 解码出 `META.docId` 与 `ROOT.who='on-disk-before-fatal'` —— 设计「hold.entered 时 File 可断言 .snapshot 已在盘上」补证成功（共享套件 fixture 不暴露 rootDir 的缺口由此闭合）。
- **分类事实**：release 后 rejection 为 `DocCreateFatalError` `phase='post-commit'` `committed=true` `code='DOC_CREATE_FATAL'`；随后 fresh 实例读回同内容、`.snapshot` 持续在盘（never rolls back）。

## 4. dsh probe 确定性（§6.8）

- **套件**：`npx vitest run packages/dsh-persistence` → **exit 0，Test Files 3 passed (3)，Tests 21 passed (21)，Type Errors no errors，无 Unhandled 段**（`/tmp/sa7-dsh.log`；probe/profile/acceptance 三文件全绿）。
- **probe CLI 双跑逐字节比对**（仓库确有直接运行方式：`packages/dsh-persistence/package.json` → `"dsh:probe": "tsx src/cli.ts"`）：

| 命令 | exit | 输出尺寸 | cmp |
|---|---|---|---|
| `npx tsx packages/dsh-persistence/src/cli.ts --adapter memory`（×2） | 0/0 | 1368 B / 1368 B | **逐字节一致（exit 0）** |
| `npx tsx packages/dsh-persistence/src/cli.ts --adapter file --rootDir <a/b> --fail-first-flushes 1`（×2，双目录） | 0/0 | 1507 B / 1507 B | **逐字节一致（exit 0）** |

事件流样本（含时序戳，双跑全同）：`create → dirty → flush ok=true t=500 → load/h2/h3 instance=d1 → … → evict t=1002 → instance=d2 …`。dsh-persistence 源零改动（SA4 DENY 核证）+ 本次双跑零漂移，§6.8 动态面闭合。

## 5. flush 三结局抽验（新门位下结局不变）

memory 既有三用例（`memory-persistence.test.ts` L473/L497/L526，即总控所指 L437/L461/L490 附近的三类结局构造）在 verbose 绿日志中的逐用例摘录：

```
✓ MemoryPersistence > waits for an aborted flush rejection without reviving state or timers                    1ms
✓ MemoryPersistence > waits for a never-settling writer to settle through AbortSignal before dispose resolves  0ms
✓ MemoryPersistence > does not revive state or timers when dispose happens during flush                        0ms
```

三结局（dispose 期 abort-rejection / never-settling writer 经 AbortSignal 收敛 / dispose-during-flush 不复活）在门位移位后的新实现下全部保持原结局；同一批用例在 5 连跑 + Node20 docker 跑中共 7 次全绿。

## 6. wrapIo 不泄入生产插件工厂（tsc 静态锚，design §3.4 可选项）

**构造**（`/tmp/sa7-tsc-probe/`：`wrapio-leak.ts` / `wrapio-clean.ts` + 两个 extends `tsconfig.base.json` 的 tsconfig；探针经绝对路径 import 生产 `src/index.js`，完整拉入 src 依赖图）。**未放弃**。

| 探针 | 命令 | exit | 输出 |
|---|---|---|---|
| 泄漏面 | `npx tsc -p /tmp/sa7-tsc-probe/tsconfig-leak.json` | **2** | `wrapio-leak.ts(7,33): error TS2353: Object literal may only specify known properties, and 'wrapIo' does not exist in type 'Omit<MemoryPersistenceOptions, "scheduler" \| "wrapIo">'`<br>`wrapio-leak.ts(8,67): error TS2353: … 'wrapIo' does not exist in type 'Omit<FilePersistenceOptions, "scheduler" \| "wrapIo">'` |
| 干净面 | `npx tsc -p /tmp/sa7-tsc-probe/tsconfig-clean.json` | **0** | 无输出 |

两工厂（memory/file）的 `Omit<…, 'scheduler' | 'wrapIo'>` 收紧在编译期精确拒绝 `wrapIo` 对象字面量（TS2353 excess property），不传则零错误——测试 seam 不泄入生产插件面，静态锚落地。

## 7. 自由攻击（≥2 要求，实做 4 项，全部未击穿）

攻击脚本 `/tmp/sa7-probe-attacks.mts`（`npx tsx`，exit 0，全脚本挂 `process.on('unhandledRejection')` 收集器，结束时断言 **0 条**）：

| # | 攻击点 | 构造 | 结果 |
|---|---|---|---|
| A-1 | **EC1 双 load 同一包装实例高压复现** | Memory + seam + 共享 store：300 轮，每轮「seed 提交内容 → `failNextRead` → 同 tick 双 `loadDoc` → 收双 rejection → self-heal 读回」 | **300/300 轮**：双 rejection `===` 同一实例（identity）、`DocLoadOperationalError` + `cause` 恒等、 healed 300/300 内容精确匹配。输出 `[ATTACK-1] EC1 high-pressure: 300/300 rounds, same-instance coalescing 300/300, self-healed 300/300` |
| A-2 | **fault seam 单发槽连续两次 arm** | 连续 `failNextRead(e1)`、`failNextRead(e2)` 后连续两次 load | 恰好 1 次读失败且 cause=`e2`（**槽覆盖语义，非队列**——与 testing.ts「single-shot arming slots」JSDoc 一致），下一次读干净通过、内容无损。单发槽不双发、不外溢 |
| A-3 | **create operational 失败后同 key 立即重试（memory）** | `failNextWrite` → `createDoc` 拒绝 → 立即同实例同 key 同 doc 重试 | 首败 `DocCreateOperationalError committed:false` + cause identity + `doc.isDestroyed=false` + `scheduler.pending()=0` + fresh 读为 null（零提交）；重试成功且返回**同一个 Y.Doc 实例**，fresh 读回内容一致（store 一致） |
| A-4 | **同攻击面打真实 File IO（mkdir→tmp→rename）** | 真实 `mkdtemp` 目录 + `FilePersistence` + seam：`failNextWrite` → 失败 → 立即重试 → 读盘字节 → fresh 实例读回 | 失败后**磁盘零残留**（无 `.snapshot`、无 `.tmp`）；重试后 `.snapshot` 真字节可 Yjs 解码出 ROOT 值；fresh FilePersistence 读回一致。**exit 0** |

**攻击中附带核实的两点观察（非发现、零行动项）**：
1. issue-64 共享 createDoc 契约套件（含 §5.4.1/§5.4.2 用例）当前仅由 `memory-persistence.test.ts` 装配运行，`file-persistence.test.ts` 未装配——经 `git show ba1b6b4:…` 核对为**预存拓扑**（base 亦无），非本任务回归；File 的 create 行为已由 typed-error 契约（EC3–EC7）、issue-79、sa7-dynamic 套件覆盖。
2. dsh probe CLI `--fail-first-flushes 1` 下事件流仍逐字节确定（第 4 项双跑）。

## Spec / vitest 触发证据（skill Step 3/4 分类登记）

- 本任务设计**无新增/改动 `*.spec.ts`（E2E）** → Step 3 不适用。
- 设计含新增 `*.test.ts`（`persistence-encode-fatal.test.ts`）+ 3 个改动测试文件：SA4 已静态核证其被根 `vitest.config.ts` include 且由 CI `test` job（`pnpm test` = `vitest run --typecheck`）触发（无 CI 黑洞）；**动态 CI run log 证据**因本阶段尚无 push/PR（发布归总控）暂不可观察——本地等价动态证据为 persistence 94/94（Node 24 ×5 + Node 20 ×1）+ dsh-persistence 21/21 + 全仓 typecheck 由 vitest 内建 typecheck（`Type Errors no errors`）覆盖；CI run 的 persistence 段计数与 Unhandled 摘录归总控 publish 后核对。

## /tmp 探针清理确认

验证结束后统一删除本会话全部产物：脚本（`sa7-vitest-chain.sh`、`sa7-host-probes*.sh`、`sa7-docker-node20*.sh`、`sa7-dsh-cli.sh`）、探针（`sa7-probe-domexception.mjs`、`sa7-probe-ec5-disk.mts`、`sa7-probe-attacks.mts`、`sa7-tsc-probe/` 四文件）、日志与 exit 文件（`sa7-persistence-run{1..5}.*`、`sa7-persistence-verbose.*`、`sa7-dsh.*`、`sa7-domex-node{18,20,24}.*`、`sa7-tsc-{leak,clean}.*`、`sa7-ec5-disk.*`、`sa7-attacks.*`、`sa7-persistence-node20*.log/.exit`、`sa7-dsh-cli*.{out,exit}`）、双跑产物（`sa7-dsh-file-root-{a,b}`）、`sa7-git-after.txt` → 清理后逐一核对：上述文件名 `ls` 均不存在；探针自建临时目录（`sa7-ec5-disk-*`/`sa7-atk4-file-*`）已由探针自身 `rmSync` 回收（`ls -d` 为空）。/tmp 中仍存在的其他 `sa7-*` 命名文件（`sa7-r1/r2/r3/rev1/rev2/…` 含完整 repo 克隆目录）为**其他会话/其他任务的既有产物**，按「未知归属默认保留」原则未触碰。工作树完整性：验证前后 `git status --porcelain` 对比，唯一差异为本报告文件新增（9 个 SA3 修改文件 + 新增测试 + 既有 wiki/raw 档案逐行不变）；docker run 采用 `--cache=false`，`node_modules/.vite` 属主/时间戳未变。

---

## 结论

**pass。** SA4 转办的 7 条动态重点无放弃项、无证伪：时序锚 5 连跑 + Node20 复跑全绿零 unhandled；EC7 cause 的 `DOMException instanceof Error` 在 20/24/18 三版本真实成立（文档佐证在案）；EC5(File)「commit 已落盘后 fatal 才发生」的磁盘事实与分类事实由一次性探针双面补证；dsh probe 事件流双跑逐字节一致；flush 三结局不变；wrapIo 泄漏面被 TS2353 精确封死；4 项自由攻击（含 300 轮高压与真实 File IO）全部未击穿。绿灯不是偶然。
