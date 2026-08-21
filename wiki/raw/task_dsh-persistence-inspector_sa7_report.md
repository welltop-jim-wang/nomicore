# SA7 动态验证报告 — task_dsh-persistence-inspector（Issue #59, P4）

**Date**: 2026-08-22
**Verifier**: SA7（Dynamic Verifier；独立进程实跑，无 ACP session 内阻塞）
**验证对象**: worktree HEAD `66ce567`（SA3 实现 `217d8a4` + F1/F2 修复 `d734352` + SA4 R1 复审 pass `66ce567`；merge-base `origin/adr/server-design` = `2aa22f4` 与简报一致）
**SA7 Verdict**: **fail-needs-fix** —— 1 项 P1（file 通道探针 record 非确定性，违反 AC8「同参两跑逐字节一致」）；1 项 LOW（外部 `.tmp` 占位失败注入下 unhandled promise rejection 泄漏）；其余 SA4 动态审核清单项全部通过。SA6 红灯验收面全绿（40/40 文件、535/535 测试）。
**Verdict (R2 复跑，最终)**: **pass** —— F-FILE 修复（commit `980c5a2`，设计 R3 两阶段结算协议）经 ①–⑤ 全项闭环复跑实证：file n=0/n=1 各 52 跑 + n=2 30 跑共 134 同参跑 **0 异常、三批组内各单一 sha256**（R0 基线 52 跑 2 异常）；memory 哈希与 R0 完全一致（零副作用）；SA7 锚 6 连跑 12/12 稳定绿；全量 40 文件 / 535 测试全绿。详见文末「R2 复跑节」。
**环境**: node v24.13.0（本机主版本）/ pnpm 10.28.2 / yjs 13.6.32（lockfile 单版本解析，实测 `packages/dsh-persistence/node_modules/yjs` = 13.6.32）。本任务无端口/常驻服务依赖（vitest + tsx CLI 均不绑端口），无需 fuser 清场。

---

## Step 0 / Step 1 结论

```
[SA7 Step 0 结论]
SA4 verdict: pass（R1 复审最终裁决，sa4_review.md 第 7 行 + 文末 R1 复审节）
操作: 进 Step 1
```

```
[SA7 Step 1 结论]
SA6 红灯: 🟢 GREEN —— pnpm test（= ci.yml:39 同命令，vitest run --typecheck --reporter=basic）
  → Test Files 39 passed (39)；Tests 533 passed (533)；Type Errors no errors；退出码 0
  （与简报 §7 R4 / §9 R5 记录的基线 39/533 完全一致）
操作: 进入 Step 2
```

---

## 🔴 F-FILE（P1，fail-needs-fix）file 通道探针 record 非确定性 —— 同参双跑 stdout 分歧，AC8 交付物失真

### 现象（SA7 实跑，2026-08-22，独立进程）

对 `pnpm exec tsx packages/dsh-persistence/src/cli.ts --adapter file --rootDir <fresh-dir>` 连跑（每次全新 rootDir、同参数），52 跑中 2 异常（≈3.8%）：

**症状 A（静默 record 失真，exit 0）** —— 首组双跑即命中：

```
run A: probe ok=true events=27   ← 尾行前缺 evict 行（见下）
run B: probe ok=true events=28
diff A B → 30c30,31：A 缺「evict doc-degraded t=2009」整行
run A 尾部：                    run B 尾部：
  flush doc-degraded … t=2008     flush doc-degraded … t=2008
  release doc-degraded refs=0 t=2009    release doc-degraded refs=0 t=2009
  probe ok=true events=27         evict doc-degraded t=2009
                                  probe ok=true events=28
```

两跑 stdout 不一致、`release refs=0` 后驱逐事件丢失（违反决策 C「驱逐即销毁，销毁即事件」与 §5 钉死值 28），且 **exit 0 + ok=true —— 静默失真，下游无法察觉**。

**症状 B（响亮失败，exit 1）** —— 20 连跑批次 run14：

```
rc=1；record 尾部：
  flush doc-degraded generation=1 ok=true t=1508
  dirty doc-degraded generation=2 t=1508
  probe-failed file-settle-timeout:doc-degraded:g2
  probe ok=false events=25
stderr: probe failed: file-settle-timeout:doc-degraded:g2
```

同参（file + 全新 rootDir + n=0）应恒为 events=28 / exit 0 —— run14 变为 events=25 / exit 1。

### 根因（源码级，SA7 定位）

设计 §6.2 规定 file 通道结算谓词（实现 `probe.ts:280-284` 忠实落地）：

```ts
waitFor(() => profile.getStatus() === 'ready' && readSnapshotRev(owner, docId) === expect.snapshotRev, 5_000, …)
```

该谓词假设「磁盘提交态可见 ⟺ 内核 flush 记账完成」。**动态证据证伪此假设**：

- `readSnapshotRev`（probe.ts:161）走 `fs.readFileSync` **直读磁盘**，rename 落盘即见新 rev；
- 内核记账（`lifecycle.ts:431` `savedGeneration` 赋值 → `:440` `flushing=false` → `:449` `maybeEvict`）在 `io.write` promise 的回调链里，须经 **libuv 线程池 → 事件循环交接**后才执行；
- 探针 waitFor 的 25ms 轮询定时器若在「rename 已落盘、完成回调未入队/未执行」窗口内触发，谓词即提前通过，探针随即推进虚拟时钟 / release：

  - **症状 B**：下一 save 的 debounce 到期 → `startFlush`（lifecycle.ts:419）被 `entry.flushing` 单飞锁早退跳过 → g1 记账 finally 里 `scheduleFlush`（:444-447）把 flush 重排到**虚拟时钟**上 → 探针不再 advanceBy → 磁盘永无 rev=2 → 5s 超时。record 停在 `dirty g2` 后（与 run14 逐行吻合）。
  - **症状 A**：release 时 `maybeEvict`（:464）见 `flushing=true` 前置不过 → 不驱逐；随后记账回调的 finally `maybeEvict` 虽会 destroy，但探针 teardown（probe.ts:466-471）**先拆 destroyed 监听再 dispose**（F1 修复语义）→ destroy 无监听 → evict 事件丢失 → events=27、exit 0。

memory 通道不受影响（同步注入缝，无 libuv 交接）：**n=0/n=1 各 10 连跑 sha256 单一值**（83bd630d… / 219aef5f…），events=28/32 恒定。

### 影响

1. **AC8 核心交付物失真**：record 是「供后续 NomicoreServer Host 复用验收」的交付；症状 A 下下游拿到 exit 0 + ok=true 但缺驱逐事件的错误 record（会误读「未发生驱逐」），症状 B 下拿到失败 record——同参数两种产出，可复制性被破坏。
2. **SA6 CLI 测试结构性弱检测**：`dsh-probe-cli.test.ts` file 用例只断言双跑 stdout 相等 + `toContain` 子串——单跑命中症状（27≠28 或 exit≠0）才红；双跑同时以同形态 flake（都 27）则相等性成立、`toContain` 照过 → 绿但错（与 SA6 R5 揭示的 `>=` 失明同构）。套件在我两轮全量运行中均未命中（≈13%/轮 捕获率）。
3. **SA4 R1 复审「file 双跑 IDENTICAL」结论被推翻**：该证据在本机复跑下不成立（首组双跑即分歧）——静态轮次少 + 3.8% 概率，属抽样未命中，非 SA4 程序错误。

### 归属与修复约束（SA7 判定，不越权定案）

- **归属：设计级假设缺陷**（SA1 §6.2 谓词规定即缺陷载体；SA3 实现忠实于设计，非实现偏离）。修复需**总控协调 SA1 设计修订 + SA3 落地**，模式同 SA6 R1–R4。
- 修复必须满足：`packages/persistence/src|test/**` 维持 DENY 零 diff（内核单飞/重排/驱逐语义是 P2/P3 既定契约，本身无错）；§5 钉死虚拟刻度不漂移（file 与 memory 同刻度）；AC8 双跑逐字节一致恢复。
- 候选方向（供 SA1 权衡）：① 契约面增加只读 in-flight/pending 观察口（`DocPersistence` 当前无任何 pending 暴露，probe 只能看磁盘与 status——需走契约改动连锁审计）；② 设计层重定义 file 通道结算协议（谓词从「磁盘可见」升级为「可证的记账完成」——注意 R3/R4 教训：deadline 式等待必须有语义谓词，固定轮数 setImmediate 不可靠，本缺陷正是「谓词本身选错」而非「等待不够长」）。
- **回归锚已由 SA7 落盘**（见「补充测试交付」）：修复后任意形态回归（events≠28 / 缺 evict / 超时 / exit≠0）即红。

### 复现证据（命令 + 输出已存档 /tmp/sa7-probe/*、/tmp/sa7-flake-run-14.txt）

```bash
cd /home/wangjian/nomicore-fix-issue-59
# 症状 A（首组双跑，2026-08-22 实跑）：
pnpm exec tsx packages/dsh-persistence/src/cli.ts --adapter file --rootDir /tmp/sa7-probe/a
#   → exit 0；尾行 probe ok=true events=27；无 evict doc-degraded 行
pnpm exec tsx packages/dsh-persistence/src/cli.ts --adapter file --rootDir /tmp/sa7-probe/b
#   → exit 0；尾行 probe ok=true events=28；evict doc-degraded t=2009 在
# diff 两跑 stdout → 非一致（30c30,31）
# 症状 B（20 连跑批次 run14）：同命令全新 mkdtemp rootDir → rc=1，
#   probe-failed file-settle-timeout:doc-degraded:g2；events=25
# 量化：52 跑（2 + 20 + 30 三批）→ 2 异常（A×1、B×1），其余 50 跑全为 events=28
# memory 对照：n=0/n=1 各 10 连跑 stdout sha256 唯一（确定性成立）
```

---

## 🟡 F-REJECT-LEAK（LOW）外部 `.tmp` 占位失败注入下 unhandled promise rejection 泄漏到进程层

SA4 动态清单第 2 条的注入手法（占死 `.tmp`）实测揭出：

```bash
d=$(mktemp -d); mkdir -p "$d/users/user-a/doc-degraded.snapshot.tmp"
pnpm exec tsx packages/dsh-persistence/src/cli.ts --adapter file --rootDir "$d"
# → exit 1 ✓；stdout record 纯净（见下）；stderr 在「probe failed: scenario-error:S4-degradation」
#   之后追加 node:internal/process/promises:394 triggerUncaughtException(err, true /* fromPromise */)
#   + EISDIR 错误对象 dump（同一错误对象出现两次：一次被探针 catch 打印，一次未捕获）
```

- **失败 record 本身纯净**（详见下节），exit 1 不受影响（exitCode 已为 1）。
- 错误源：`packages/persistence/src/file.ts:96` `readCommittedSnapshot` 的 `await fsp.rm(tmpPath, { force: true })` —— `force` 只容忍 ENOENT，对**目录**抛 EISDIR；某条 read-ticket promise 链（lifecycle.ts `startReadTicket`/`createReadTicket` 一族）存在未闭环 rejection。
- 严重度 LOW：仅在「.tmp 被外部占位」这一注入形态触发（探针自身 `ensureBlocked` 注入时序不会命中 create 的读路径）；不影响 record 与退出码；但 unhandled rejection 若在其他路径泄漏到成功态进程，会把 exit 0 变 crash。**归属待判**：泄漏点在内核 read-ticket 记账链（DENY 区）还是探针侧，需 SA3/总控定位；SA7 无权限改 `packages/persistence`。
- 佐证：症状 B 的自发失败（run14）stderr 无此 dump —— 泄漏非失败路径普遍现象，是该注入形态特有。

---

## SA4 动态审核重点逐项结论（清单 1–5）

| # | 项目 | 结论 | 证据摘要 |
|---|---|---|---|
| 1 | F1 修复后回归 | ✅（memory）/ ❌（file，见 F-FILE） | memory n=1 `events=32`（evict 恰 4 条：doc-alpha t=1002/1003/1005 各 1 + doc-degraded t=2509）；n=2 `events=34`；n=0 `events=28`；file 名义 `events=28` + t=1002 单条 evict —— 但 file 通道双跑一致性不成立（F-FILE），本项 file 半边不通过 |
| 2 | 失败 record 纯度 | ✅（附 F-REJECT-LEAK 保留意见） | 双证据：自发失败 run14（`probe-failed file-settle-timeout:doc-degraded:g2`）+ 强制注入（`scenario-error:S4-degradation`，events=21）。两份失败 record：reason 均落 §6.2 封闭词表 ✓；无 spurious evict 行（仅 3 条合法 doc-alpha evict，teardown 先拆监听生效）✓；stdout 零环境痕迹（rootDir/墙钟/pid/EISDIR 文本 grep 均 0 命中）✓；退出码 1 ✓；原始错误走 stderr ✓ |
| 3 | CLI 退出码矩阵 | ✅ | 7 类用法/参数错误全部 exit **2**（file 缺 rootDir、未知 adapter、缺 --adapter、`--fail-first-flushes -1`/`abc`、未知 flag、flag 缺值——后六者 stderr 带 usage 行，file 缺 rootDir 走 `probe error:` + 含 rootDir，SA4 已注可接受）；成功 exit 0；领域失败 exit 1。0/1/2 纪律完整 |
| 4 | 并发 CLI 余量 | ✅ | 套件内 `dsh-probe-cli.test.ts` 7 用例 3680ms（含多组 Promise.all 双 CLI 并行），60s guard ≈ **16×** 余量；单 CLI 子进程实测 ~0.5–1.2s；新增 SA7 锚（2 用例，进程内 3 跑 + CLI 2 跑）1268ms，余量同量级 |
| 5 | node 版本面 yjs destroyed 一致性 | ✅ 本地可验证部分 / ⚠ node 20 阻塞 | lockfile 单版本 yjs@13.6.32（两包声明 ^13.6.30 同源解析）；node **24.13.0** 与 **25.6.0**（本机 `/usr/local/n/versions/node/25.6.0`）下 CLI memory n=0/n=1 events=28/32 且 stdout sha256 与 node 24 完全一致（83bd630d…）、acceptance 文件 10/10 绿 —— 'destroyed' 事件跨版本行为一致。**node 20**：本机未安装、分支未 push 无 CI run（见 vitest 触发证据节），CI 矩阵半边待总控 push 后补验 |

---

## vitest 触发证据（verdict 升级 — 2026-06-15 立法；总控特别要求）

**触发条件命中**：本任务新增/改动 `*.test.ts` —— SA6 三件（dsh-profile-acceptance / dsh-probe-cli / core-dsh-boundary）+ SA7 本轮一件（dsh-file-probe-determinism）。

**CI Run**: ⚠ **不存在** —— 分支 `fix/issue-59-on-adr-server-design` 未 push（ahead 15 于 origin/adr/server-design），无 PR（`gh run list` / `gh pr list` 均空）。SA7 无 push/建 PR 权责（边界声明），CI 侧动态门禁**环境阻塞**，交总控 push 后以同款命令补验。

**本地等价实跑**（与 ci.yml:39 `run: pnpm test` 完全同命令，`pnpm test -- --reporter=basic` = `vitest run --typecheck`）：

```text
Test Files  40 passed (40)      ← 34 既有 .test.ts + 1 SA7 新锚 + 5 .test-d.ts（typecheck 通道）
     Tests  535 passed (535)    ← 533 既有 + 2 SA7 新锚
Type Errors  no errors          ← typecheck 通道同步绿（tsc -p packages/dsh-persistence 亦 TSC-OK）
    退出码  0
```

**各 workspace package 测试文件清单核对**（vitest.config.ts include = `packages/*/test/**/*.test.ts` + `domains/*/test/**/*.test.ts`；typecheck include = `*.test-d.ts`；磁盘枚举 35 + 5 = 40，与 runner 计数 40 一一对应，无孤儿、无遗漏）：

| Workspace Package | 测试文件（.test.ts） | 计数 | 套件中运行 |
|---|---|---|---|
| **dsh-persistence**（本任务新包） | dsh-profile-acceptance（10）/ dsh-probe-cli（7）/ **dsh-file-probe-determinism（2，SA7 新增）** | 3 | ✓ 全绿 |
| persistence | core-dsh-boundary（3，AC7 绿色守卫）/ file-persistence（13）/ file-persistence-sa7-dynamic（3）/ memory-persistence（32）/ module-graph-regression（3）/ persistence-contract（7）/ sa7-supplementary（3） | 7 | ✓ 全绿 |
| vfsl | 17 个（parse-vfsl* / evaluate-derived* / validate-snapshot* / domains-scaffold / schemasource-seam / vfsl-assets-fullchain-e2e） | 17 | ✓ 全绿 |
| vfsl-codegen | generate-*（6 个） | 6 | ✓ 全绿 |
| vfsl-protocol | vfsl-protocol-empty-module | 1 | ✓ 全绿 |
| domains/vfs3-assets | vfs3-assets-tsdoc | 1 | ✓ 全绿 |
| （typecheck 通道 .test-d.ts） | domains/vfs3-assets ×2、vfsl-codegen ×1、vfsl-protocol ×2 | 5 | ✓ TS 全绿 |

静态门禁（SA4 ① 已核，SA7 复认）：ci.yml job `test`（node 20/24 矩阵）第 39 行 `pnpm test` → 根 script `vitest run --typecheck` 吃上述 include；无 `--filter` 裁剪；ci.yml:36 `pnpm typecheck` 含 `tsc -p packages/dsh-persistence/tsconfig.json`。include 通配是唯一且充分的触发通道。

**verdict**: ✅ **all-vitest-packages-triggered（本地实跑）** / ⚠ CI 侧动态确认阻塞于未 push（总控 push 后 `gh run view` 按 Step 4 立法摘录 `Test Files` 行补验——预期同 40/535）。

---

## 补充测试交付（SA7）

| 文件 | 内容 | 判别力 |
|---|---|---|
| `packages/dsh-persistence/test/dsh-file-probe-determinism.test.ts`（新增，未 commit） | ① 进程内 `runPersistenceProbe({adapter:'file'})` 3 连跑：每跑 ok=true + record 精确命中 §5 钉死值（尾行 `probe ok=true events=28`、`flush … g2 … t=2008`、`evict doc-degraded t=2009`、无 probe-failed）+ 三跑逐字节一致；② CLI 连跑 2 次（独立 rootDir）：均 exit 0 + 同钉死值 + stdout 逐字节一致 | 修复前：间歇红（单跑异常率 ~3.8%，每文件 5 跑理论捕获率 ~18%；本轮 7 次文件运行 35 跑未命中，诚实声明：锚的红态由 F-FILE 直接 CLI 证据锚定，非锚内观测）。修复后：确定性绿；events≠28 / 缺 evict / 超时 / exit≠0 任一形态立即爆红。堵死 SA6 CLI 测试「双跑同形态 flake → 相等性成立」的结构性失明（SA6 R5 同款精确计数哲学） |

**给总控**：修复落地前该锚会以 ~百分之十几概率间歇红——这是缺陷的正确信号，**不要以放宽断言方式「修 flaky」**；SA3 修复后转为稳定绿。

---

## 裁决

**fail-needs-fix** → 回流路径：总控协调 **SA1**（§6.2 file 通道结算谓词假设修订 + 修复方案定案）→ **SA3**（probe.ts 落地，`packages/persistence` DENY 维持）→ SA4 复审 → SA7 复跑本报告复现命令（52 跑 0 异常 + 双跑一致）+ 新锚稳定绿即可闭环。F-REJECT-LEAK（LOW）可随修复顺手定位（若泄漏点在内核 read-ticket 链则需总控单独裁决 DENY 例外）。

其余方面（SA6 验收面、F1 修复回归、失败 record 纯度、退出码矩阵、并发余量、yjs 跨版本、vitest 触发）全部通过；SA7 未修改任何生产代码，仅新增上述测试文件与本报告。

---

# R2 复跑节（2026-08-22，F-FILE 修复闭环复跑）

**复跑对象**：修复 commit `980c5a2`（fix(dsh-persistence): R3 two-stage settle protocol for file channel）——改动严格限于 `packages/dsh-persistence/src/probe.ts` + `src/clock.ts`（SA4 R2 复审已核 scope）；SA1 设计 R2/R3 修订、SA2 R3 pass、SA4 R2 复审 **pass**（Verdict (R2 复审，最终)，sa4_review.md 第 8 行）。**SA7 锚未被改动**（`git diff 980c5a2 HEAD -- …dsh-file-probe-determinism.test.ts` = 空；该文件仅 `980c5a2` 一个 commit 触及——入库）。
**复跑范围**：总控指令 ①–⑤（对齐 R0 量化基线 + SA2 红线 #1② 回归口）。全部独立进程实跑；环境同 R0（node 24.13.0 / pnpm 10.28.2 / yjs 13.6.32）。

## ① file n=0 / n=1 各 52 跑同参批次（对齐 R0 基线）—— ✅ 0 异常 + 组内逐字节一致

```bash
# 每跑全新 mkdtemp rootDir；判异常条件 = rc≠0 ∨ 尾行≠期望 ∨ stderr 非空（兼测泄漏噪声）
pnpm exec tsx packages/dsh-persistence/src/cli.ts --adapter file --rootDir <fresh> ×52
#   → BATCH file-n0: runs=52 anomalies=0 unique_hashes=1（尾行恒 probe ok=true events=28）
pnpm exec tsx …/cli.ts --adapter file --rootDir <fresh> --fail-first-flushes 1 ×52
#   → BATCH file-n1: runs=52 anomalies=0 unique_hashes=1（尾行恒 probe ok=true events=32）
```

- R0 基线（52 跑 2 异常：症状 A events=27 ×1、症状 B file-settle-timeout exit 1 ×1）→ **R2 0 异常**；两症状均未复现。
- 每批 52 跑 stdout sha256 **单一值** = 组内逐字节一致（AC8 恢复）；stderr 全空（无 F-REJECT-LEAK 形态噪声）。

## ② file n=2 批次（SA2/SA4 指出的回归口，红线 #1②）—— ✅ 30 跑 0 异常 + 内容逐行吻合

```bash
pnpm exec tsx …/cli.ts --adapter file --rootDir <fresh> --fail-first-flushes 2 ×30
#   → BATCH file-n2: runs=30 anomalies=0 unique_hashes=1（尾行恒 probe ok=true events=34）
```

record 逐行断言（首跑全文 + 30 跑哈希唯一共同锚定）：

```text
flush doc-degraded generation=1 ok=false t=1508   ← 同代失败 #1（退避 500ms）
degraded doc-degraded t=1508
write-rejected doc-degraded t=1508
flush doc-degraded generation=1 ok=false t=2008   ← 同代失败 #2（退避 1000ms，翻倍规则）
degraded doc-degraded t=2008                      ← §5「每次失败尝试各发一条 degraded」
flush doc-degraded generation=1 ok=true t=3008    ← 同代 retry 成功（成功在 +4000 前沿）
recovered doc-degraded t=3008
flush doc-degraded generation=2 ok=true t=3508    ← dirty g2 在 recovered 之后（决策 C）
release doc-degraded refs=0 t=3509
evict doc-degraded t=3509                         ← R0 症状 A 缺失的正是该行形态
probe ok=true events=34                           ← = S1 15 + S2 4 + S3 2 + S4 13（n=2）
```

退避序列 1508→2008→3008（500/1000，镜像内核 retryDelayMs 翻倍）逐刻度吻合；两条失败 flush 同 generation=1（§8 generation 补则）✓。

## ③ SA7 锚多连跑 —— ✅ 6 连跑稳定绿

`pnpm exec vitest run packages/dsh-persistence/test/dsh-file-probe-determinism.test.ts --reporter=basic` ×6 → 每轮 **Test Files 1 passed (1) / Tests 2 passed (2)**（合计 12/12 用例、每轮含进程内 3 跑 + CLI 2 跑 file 探针）；R0「间歇红预期」消失，锚转入确定性绿态。

## ④ memory 通道回归 —— ✅ 哈希唯一且与 R0 完全一致

```bash
--adapter memory ×10            → unique=1  hash=83bd630de0af…93384（= R0 值）
--adapter memory --fail-first-flushes 1 ×10 → unique=1  hash=219aef5f9acd…43e2b8（= R0 值）
```

修复对 memory 通道 record **零副作用**（逐字节不变），与「协议不产生事件、对 record 不可见」的设计承诺一致。

## ⑤ 全量 pnpm test —— ✅ 40 文件 / 535 测试全绿

```text
Test Files  40 passed (40)   Tests 535 passed (535)   Type Errors no errors   退出码 0
```

（与 R0 落盘锚后的计数一致：34 既有 .test.ts + 1 SA7 锚 + 5 .test-d.ts = 40；分包清单核对表见 R0「vitest 触发证据」节，仍一一对应。）

## 修复实现核对（diff 层面，SA7 独立比对 66ce567..980c5a2）

- `clock.ts`：`pending()` 升入 `ProbeClock` 接口 + 语义注记（已触发已删除不计——基线算术前提）；`advanceBy` 纯微任务排空声明（不得含宏任务，保「返回瞬间 = 同步基线」快照语义）。
- `probe.ts`：`observeFlush` 降级为**条件 W**（磁盘提交态可见，仅证字节已提交）；**A-arming**（`saveAndEmit` 内 base=saveDoc 前快照，等待期间不推进虚拟时钟）；**A-evict**（`releaseAndEmit` refs=0 时等 `evictSeen`——maybeEvict 只在记账 finally/clean release 执行 ⟹ evict 观测即记账证明，同时闭合症状 A 的拆监听竞态）；失败/中间失败腿 base=**advanceBy 返回瞬间**（R2-1 修正公式，R2 错误公式未复现）；恢复腿**无 pending 联言**（原子性引理下 status 翻转即完备证明）。与设计 R3 §6.2 逐点吻合。

## R2 复跑最终裁决：**pass**

- F-FILE（R0 唯一 P1）实证闭环：134 同参 file 跑（n=0×52 / n=1×52 / n=2×30）**0 异常、三批各单一哈希**，对照 R0 基线 52 跑 2 异常；两症状形态（events=27 静默 / settle-timeout exit 1）均未复现；n=2 回归口（SA2 红线 #1②）补齐且逐行吻合。
- SA4 R2 复审 pass + SA7 复跑 ①–⑤ 全过 → 动态验证链闭环，本任务 SA7 无未决 REJECT 项。
- 遗留（不阻塞，均已在位处置）：F-REJECT-LEAK（LOW）按设计 R2「连带修订与处置」建议由总控立 P3 跟进项单独裁决（`file.ts:96` 属 DENY 区）；node 20 CI 矩阵面维持 R0「CI 侧动态确认阻塞于未 push」措辞原样（push/CI 由 runner 负责，不属于本阶段）。
- R0 记录（含全部量化证据与复现命令）原样保留于上文，供回归对照。
