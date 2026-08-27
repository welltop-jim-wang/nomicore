# SA7 动态验证报告 — Phase 5: enable replication identity and epoch management

- **Date**: 2026-08-27
- **Issue**: #132（welltop-jim-wang/nomicore）
- **被验对象**: SA3 实现 commit `8113083` + SA6 锚修订 `ec83429`（worktree HEAD = ec83429）
- **Worktree**: /home/wangjian/nomicore-fix-issue-132
- **SA4 verdict（Step 0 校对）**: pass（sa4_review.md 顶部 Verdict 行）→ 允许进入动态验证
- **Verdict**: **pass**

---

## Step 0 / Step 1 结论

- **[Step 0]** SA4 静态验尸 verdict = `pass` → 进入 Step 1（SA7 不做「下发」：仅在 SA4 pass 基础上独立发现 fail，本次未发现）。
- **[Step 1] SA6 红灯转绿**：🟢 GREEN

```
$ pnpm vitest run --typecheck \
    packages/namespace-registry/test/registry-phase5-replication-red.test.ts \
    packages/namespace-registry/test/registry-phase5-replication-surface.test-d.ts
 ✓  TS  packages/namespace-registry/test/registry-phase5-replication-surface.test-d.ts (6 tests)
 ✓ packages/namespace-registry/test/registry-phase5-replication-red.test.ts (14 tests) 1225ms
 Test Files  2 passed (2)
      Tests  20 passed (20)
Type Errors  no errors
→ exit 0（独立进程）
```

---

## SA4 五条动态审核重点逐条回复

### 重点 1 — FilePersistence 全链耐久时序（CI 磁盘 flake 观测）

**结论：本地验证通过（8 次含磁盘链路的独立运行零 flake）；CI 级观测环境阻塞（非实现缺陷，见「CI 可达性」节）。**

本地证据（全部独立进程、真实 fs `mkdtemp` 目录、真实 `writeFile→rename`）：

| 运行 | 命令 | 结果 |
|---|---|---|
| red 文件（含 FilePersistence 全链用例）连续 ×5 | `pnpm vitest run --typecheck .../registry-phase5-replication-red.test.ts` | 5/5 次 exit 0，每次 `Tests 14 passed (14); Type Errors: no errors`（flake-run-1..5） |
| 新增真实计时器用例（重点 2，同样走 FilePersistence 磁盘 committed 轮询）×3 | `pnpm vitest run .../registry-sa7-phase5-replication-dynamic.test.ts` | 3/3 次 exit 0，每次 `Tests 4 passed (4)` |
| CI 同链全量 ×1 | `pnpm test` | `126 files / 1478 tests` 全绿（red 文件耗时 824ms，无超时） |

机理复核：red 文件 File 用例的防 flake 机制 = issue #108 正式模式 `waitDurableSnapshot`（`expect.poll` 25ms 间隔 / 5s 有界超时，直接读磁盘 committed 快照、不干扰 flush 写路径，超时响亮失败）——不依赖固定 sleep 时序假设，慢磁盘只会拉长轮询而不会误红。SA4 建议的「连续 3 次 CI run 观察」**无法执行**：本任务分支从未 push（见下节），SA7 无权 push/建 PR。残余风险已登记：发布阶段（push + PR CI）后由总控/后续轮次从 `gh run view --log` 复核 `Test` 步骤无超时 flake。

### 重点 2 — 真实调度交错（真实 timer 下 enable-已接纳-后-shutdown 排空）

**结论：通过（新增 SA7 用例，全链零 fake scheduler）。**

新增用例：`packages/namespace-registry/test/registry-sa7-phase5-replication-dynamic.test.ts` ›
「SA4 动态重点 2：真实计时器（零 fake scheduler）下 enable 已接纳后 shutdown 的排空与恢复」。

与 SA6/SA3 既有并发用例（微任务确定性栅栏 + 受控 scheduler）的差异面：

- registry idle/close 调度器 = 自建 `realRegistryScheduler`（`globalThis.setTimeout/clearTimeout` 直通）；
- FilePersistence debounce/maxDirty = 只读 import `realPersistenceScheduler`（issue #107 迁移裁决的正式真实计时器注入器），`schedule: { debounceMs: 5, maxDirtyMs: 60 }` 真实到期；
- 竞态驱动：`const enableP = lease.enableReplication(); const shutdownP = registry1.shutdown();`（同步接纳后立即 shutdown，无中间 await），断言 `enableP` resolve `{ok:true}`（已接纳任务经 close barrier 无条件排空）、`shutdownP` resolve undefined；
- 磁盘 committed 事实经 `waitDurableSnapshot` 有界轮询（真实异步 `writeFile→rename` 落盘后才允许 dispose）；身份值直接取自磁盘 committed 字节（shutdown 后 lease 已 closed，`RUNTIME_READ_DISABLED` 停接纳——身份不读 closed 读面，这本身是一次负路径实证）；
- 重启：全新 FilePersistence + 全新 Registry 真实 `loadDoc` 解码 → `replicationId`（`/^[0-9a-f]{32}$/`）与 `replicationEpoch:1` 完整恢复，status `enabled` 同构。

实测：`Tests 4 passed (4)`，3 次复跑全绿（59ms 级真实计时器窗口，无 flake）。

### 重点 3 — undefined 值经 FilePersistence 磁盘格式 round-trip

**结论：通过（磁盘级实证补齐 SA2/SA4 的内存链实证）。**

新增用例同文件 ›「SA4 动态重点 3」，两段断言：

1. **磁盘字节事实**：种子 `META.set('replicationEpoch', undefined)`（id 合法 32hex）→ 以 FilePersistence committed 快照同款字节布局落盘（`rootDir/users/{userId}/{docId}.snapshot` = `Y.encodeStateAsUpdate` 全量快照）→ 重新 `readFile + applyUpdate` 解码后：
   `has('replicationEpoch') === true && get('replicationEpoch') === undefined`（且 `replicationId` 完好）——**「键存在而值 undefined」形态经真实磁盘编码 round-trip 存活**，D-3 判据（has() 判别、绝不与键缺席同判）的事实前提在磁盘级成立。
2. **open 结局**：该磁盘形态 open → `NamespaceRegistryFatalError`（`operation:'open'`、`phase:'runtime-construction'`、`committed:false`），`cause.message` 含稳定码 `NSRT-REPLICATION-META-CORRUPT`——持久化损坏家族 loud、不虚假降级。
3. **反向守卫（防过纠）**：两键真缺席的同款磁盘种子 → open 成功、`status.replication = {state:'disabled'}`、META 两键投影 undefined。

### 重点 4 — vitest 触发证据（硬门禁 #14）→ 见下方独立章节

### 重点 5 — 载体异型分支（SA4 L4 可选用例）

**结论：通过（新增用例）+ 一条 yjs 语义实证发现（INFO，不改验收）。**

新增用例同文件 ›「SA4 动态重点 5」：**live doc 同实例**种子（in-memory persistence `loadDoc` 返回同一 `Y.Doc` 引用）`getText('META').insert(0,'hostile-text-carrier')` → 自证 `seed.getMap('META')` 确实 throw（同文档异型语义）→ `registry.open` → `NamespaceRegistryFatalError('open','runtime-construction', committed:false)` + `cause.message` 含 `NSRT-REPLICATION-META-CORRUPT` + observer `open-runtime-construction-failed`。E4/V2.5 读取器的 `getMap try/catch 收编为 corrupt` 分支获得直接测试覆盖（此前仅 SA4 设计期实证支撑）。

**yjs 语义实证发现（INFO）**：异型载体经 `encodeStateAsUpdate → applyUpdate` round-trip 后会被**去特化**——接收端 `share.get('META')` 为 `AbstractType`，`getMap('META')` **不抛**且返回空 Map 门面（`has/get/keys` 全空读、`set` 可写并将 share 翻为 `YMap`；原 Text 内容仍可经 `getText` 读出并再存活一轮 round-trip）。即「载体异型 → corrupt」分支**仅在 live 同实例上可达**；敌意磁盘快照（META 为 Y.Text）经正常 open 会落到「两键真缺席 → disabled」。判定：非本票缺陷——生产 create/load 管线不可能产生异型载体快照（SA4 L4 同判），且该敌意形态下 open 走 disabled 是「两键真缺席」判据的事实性真命题（getMap 门面读不到任何复制键）；建议记入后续切片（WS bootstrap/reconcile 接触外部快照时）的输入硬化备注。

---

## vitest 触发证据 (verdict 升级 — 2026-06-15)

**CI Run: 不存在（环境阻塞）**——本任务分支 `fix/issue-132-on-docs-phase-5-websocket-replication` 从未 push：

- `git branch -r`：origin 无该分支 ref（只有 `origin/fix/issue-131-...` 等其他任务分支）；
- `gh run list --limit 8`：全部 run 属其他分支（docs/phase-5-websocket-replication、fix/issue-131-...、main 等），无一属于本分支；
- `gh pr list --state all`：PR #144 属 issue-135 分支（另一任务），本分支无 PR。

SA7 职责边界：不 push、不建 PR、不宣称 CI 已绿 → **CI runner log 摘录此项环境阻塞**，本地以 CI 完全同命令链提供触发证据（发布阶段 push 后需由总控从真实 `gh run view --log` 的 `Test` 步骤补摘录；若届时任一文件未出现在收集列表 → 按门禁 FAIL 处置）。

**本地同链触发证据**（命令 = `.github/workflows/ci.yml` `Test` 步骤逐字相同：`pnpm test` = 根脚本 `vitest run --typecheck`，root vitest.config glob `packages/*/test/**/*.test.ts` + typecheck include `*.test-d.ts`）：

```
$ pnpm test   （CI 同链，独立进程）
 ✓  TS  packages/namespace-registry/test/registry-phase5-replication-surface.test-d.ts (6 tests)
 ✓ packages/namespace-registry/test/registry-phase5-replication-red.test.ts (14 tests) 824ms
 ✓ packages/namespace-registry/test/registry-sa7-phase5-replication-dynamic.test.ts (4 tests) 56ms   ← SA7 新增
 ✓ packages/namespace-registry/test/registry-phase5-replication-channels.test.ts (14 tests) 28ms
 ✓ packages/namespace-runtime/test/runtime-replication-write.test.ts (9 tests) 22ms
 Test Files  126 passed (126)
      Tests  1478 passed (1478)
Type Errors  no errors
→ exit 0（Duration 104.18s）
```

| Workspace Package | CI Step Name | 触发结果 | 证据 |
|---|---|---|---|
| @nomicore/namespace-registry | Test（`pnpm test`） | ✓ 触发且通过（本地同链） | `✓ .../registry-phase5-replication-red.test.ts (14 tests)`、`✓ .../registry-phase5-replication-channels.test.ts (14 tests)`、`✓ TS .../registry-phase5-replication-surface.test-d.ts (6 tests)` |
| @nomicore/namespace-runtime | Test（`pnpm test`） | ✓ 触发且通过（本地同链） | `✓ .../runtime-replication-write.test.ts (9 tests)` |

**verdict**: ✅ all-vitest-packages-triggered（本地 CI 同命令链证实收集+执行+全绿）；⚠ CI runner log 摘录环境阻塞（分支未 push，SA7 无权 push——留待发布阶段真实 run 补证）。

**E2E spec 触发证据（Step 3）**：N/A——diff `7425164..HEAD` 零 `*.spec.ts`（`git diff --name-only -- '*.spec.ts'` 为空），与 SA4 §1.3 静态结论一致。

---

## SA7 产出（补充测试，SA7-owned）

| 文件 | 用例 | 覆盖 |
|---|---|---|
| `packages/namespace-registry/test/registry-sa7-phase5-replication-dynamic.test.ts` | 4 | 重点 2（真实计时器排空×1）、重点 3（磁盘 undefined round-trip ×1 + 反向守卫 ×1）、重点 5（live 异型载体 ×1） |

全部用例驱动真实 Registry/Runtime/Yjs/FilePersistence（真实 fs 临时目录）；零源码 grep 断言、零 mock 服务；`waitDurableSnapshot`/`realPersistenceScheduler` 均为只读 import（未修改）。未触碰任何 `src/`（`git status` 核对：除 wiki 报告外仅新增上述测试文件）。

## 独立进程测试证据汇总（全部 exit 0）

1. SA6 红灯锚两文件（`--typecheck`）→ 20/20 绿；
2. 新增动态文件（`--typecheck`）→ 4/4 绿（首轮 + 复跑 3 次，累计 4 次全绿）；
3. red 文件 flake 观测连续 ×5 → 全绿；
4. CI 同链全量 `pnpm test` → 126 files / 1478 tests 全绿，Type Errors: no errors（含 SA7 新文件，基线 125/1474 → +1 file/+4 tests，零回归）；
5. `pnpm typecheck`（9 包 tsc）→ exit 0。

## 发现清单（全部非阻断）

| # | 级别 | 事项 | 处置建议 |
|---|---|---|---|
| S7-1 | INFO（流程） | CI 级触发证据与磁盘时序观测阻塞：分支从未 push，无 run 可摘录（gh run/pr list 证据见上） | 发布阶段 push 后由总控从 `gh run view --log` `Test` 步骤补摘录 4 文件执行行 + 连续 run 无 FilePersistence 超时 flake；任一文件未触发 → 按门禁 FAIL 回流 |
| S7-2 | INFO（yjs 语义） | 磁盘 round-trip 会将 META 异型载体去特化为 AbstractType：`getMap` 不抛、空 Map 门面 → 敌意 Text-META 快照 open 判 disabled 而非 corrupt（corrupt 分支仅 live 同实例可达） | 非本票缺陷（生产不可达 + 「两键真缺席→disabled」为事实性真命题）；记入后续 WS bootstrap/reconcile 切片的输入硬化备注 |

## 结论

SA4 五条动态重点全部核销：#2/#3/#5 以新增 4 用例在真实运行链路（真实计时器、真实磁盘字节、真实 live doc）验证通过；#1/#4 的 CI 级观测因分支未 push 环境阻塞，已用本地 CI 同命令链（`pnpm test` 126/1478 全绿 + 8 次磁盘链路零 flake）提供最强可得证据，残余项登记 S7-1 随发布阶段补证。未发现任何实现缺陷；SA6 红灯 20/20 保持绿；既有套件零回归；SA7 未修改任何生产代码。

**Verdict: pass**
