# SA7 动态验证报告 — Issue #139（`apps/yjs-server` Hub/Peer 组合根）

**Date**: 2026-08-30
**Verifier**: SA7（独立动态验证；**未修改任何生产代码/测试/配置、未提交、未推送**；唯一产物为本报告 + `/tmp/sa7-139/` 下的验证脚本与日志）
**审核对象**: worktree `/home/wangjian/nomicore-fix-issue-139` @ commit `4d9fff5`（branch `fix/issue-139-on-docs-phase-5-websocket-replication`，基线 `d911025`）
**Step 0 校对**: SA4 最新 verdict = **PASS**（`task_issue-139_sa4_review_r2.md` 首部 Verdict 行，B1/B2 确认解决）→ 按规进入动态验证，SA7 可独立发现 fail。
**SA7 Verdict**: **FAIL（fail-needs-fix）** —— 1 项阻断（F1：`verify-write` 有界等待契约被绕过 = 套件不稳定根因 + 设计 §3.4 错误链偏离，见 §2）；其余全部验证维度独立复验通过（§3-§6），修复面窄（`app.ts` `opVerifyWrite` 单函数 + 1 条测试）。

---

## 0. 方法与执行纪律

- 所有验证命令在**独立后台进程**（`setsid nohup`）执行，日志落 `/tmp/sa7-139/logs/*.log`；进程信号全部发送给**真实脚本进程**（生产路径 `node --import tsx apps/yjs-server/src/main.ts`，SIGHUP 直达；见 §5-G tsx 包装层负例）。
- 复现脚本/配置只写 `/tmp/sa7-139/`（`lib.mjs` 进程驱动 + 各场景脚本），worktree 零写入（`git status` 复核仅 `?? wiki/raw/task_issue-139_*`）。
- 未采信 SA3/SA4 报告中的任何运行结果；所有命令由 SA7 独立重跑。进程纪律：未知/非本任务进程一律保留（如 MABF runner、`/tmp/sig-h.ts` 探针）；仅对**可按 config 路径精确识别为本任务 yjs-server 测试残留**的孤儿进程做了三次回收（共 23 只，见 §7-O2/O4——它们持续消耗本机线程预算，阻塞后续验证）。

## 1. Step 0：SA4 verdict 校对

`wiki/raw/task_issue-139_sa4_review_r2.md` 首部：`Verdict: PASS`（B1/B2 确认解决，N3 随包闭合）。→ SA7 进入独立动态验证（只能上发 fail，不得下发）。

## 2. 定向套件稳定性与 verify-write flake 根因（**F1 阻断**）

### 2.1 独立套件重跑（基线，`/tmp/sa7-139/logs/stability-baseline.log`）

命令（×3 顺序执行）：

```bash
cd /home/wangjian/nomicore-fix-issue-139 && ./node_modules/.bin/vitest run apps/yjs-server/test
```

| 轮次 | 结果 | 明细 |
|---|---|---|
| run 1 | ✅ 6 files / 31 tests 全绿，EXIT=0 | 35s |
| run 2 | ✅ 6 files / 31 tests 全绿，EXIT=0 | 36s |
| run 3 | ❌ **1 failed**：`smoke-skeleton-red.test.ts` 用例 1（`expect(writeReply.ok)` @ test:232），EXIT=1 | 失败用例时长 **874ms**（快速失败，非 30s 超时） |

→ 本机近无负载条件下套件失败率 **1/3**；与 SA4 R2 §O5（1 次失败）、SA3 R2 §3（并发轮 2 失败）互相印证：**套件不稳定是可复现事实，非偶发噪声**。

### 2.1b 隔离 smoke 批次（`/tmp/sa7-139/logs/smoke-stress.log` Phase A）

`./node_modules/.bin/vitest run apps/yjs-server/test/smoke-skeleton-red.test.ts` ×5 顺序隔离执行：**run 2 红**（用例 2「clean shutdown releases the rootDir lock」，719ms 快速失败——同 F1 签名；该用例同样在 peer ready 后立即 `verify-write`），其余 4 轮绿。失败时点系统 load average 仅 **0.44** —— F1 竞态在低负载下即命中，不依赖高争用。

### 2.2 定向复现器（脱离 vitest，逐步捕获回执载荷）

场景 = smoke 用例 1 的精确链路：hub（file+provision）boot → peer（静态 target）`ready` 事件后**立即** `verify-write{timeoutMs:30000}`（脚本 `/tmp/sa7-139/flake-repro.mjs`）：

| 批次 | 条件 | N | 失败数 | 失败载荷 |
|---|---|---|---|---|
| 近无载（并行一次 app tsc） | settle=0 | 12 | **1** | `ok=false code=write-failed opMs=50` |
| 4 路 CPU 打满 | settle=0 | 10 | **7** | 全部 `code=write-failed`，opMs=49~53ms |
| 4 路 CPU 打满（对照） | **settle=1500ms** | 10 | **0** | —（全 ok，opMs≈50ms） |

命令：`node /tmp/sa7-139/flake-repro.mjs <N> <settleMs>`（打满批次由 `/tmp/sa7-139/flake-loaded.sh` 包裹 4× `node -e 'for(;;){}'` 燃烧进程）。

结论（载荷级证据）：失败**不是**「30s 写入截止窗被 CPU 争用耗尽」（SA3 R2 §3 的定性），而是 **~50ms 的即时 `write-failed`**；只要 peer ready 后等 1.5s 再发 op，4 路满载下 10/10 全绿 → 竞态窗口 = peer `ready` 事件（`app.ts:349-351`，`peer.start()` 后立即发射，此刻拨号/引导尚未完成）到本地 ns 记录物化之间。

### 2.3 机制定位（源码 + 公共面探针）

- 探针（`/tmp/sa7-139/probe/registry-open-probe.mjs`，仅 import `@nomicore/*` 公共入口）：
  `peer-role registry.open(unknown ns) -> ok=false code=NAMESPACE_NOT_FOUND in 1ms`（对照：hub-role open 已建 ns → ok）。
- `apps/yjs-server/src/app.ts:505-506`：

  ```ts
  const opened = await this.registry.open({ userId: ownerUserId }, namespaceId);
  if (!opened.ok) return { ok: false, code: 'write-failed' };   // ← 50ms 快速失败路径
  ```

  有界等待 `waitNamespaceLive`（:509-510 → `verify-write-timeout`）只在 open **成功之后**才开始——ns 记录未物化时 30s deadline 从未生效。
- 设计 §3.4（`task_issue-139_design.md:100-101`）冻结的契约：已知集 ns（peer = targets，非 `namespace-unknown`）→ **先有界等待**（缺省 30s，超时 `verify-write-timeout`）；`write-failed` **仅**限「等待达成后 mutateRoot ok:false」。实现顺序相反 → 错误链偏离。

### 2.4 设计 T7 指定用例动态执行 = 红（最直接佐证）

`E1-4b`（`/tmp/sa7-139/logs/smoke-manual.log`）：peer `add-target` 一个**永不可 live** 的 ns（`ns-deadbeef…`，文法合法）→ `verify-write{timeoutMs:500}`：

```
[FAIL] E1-4b verify-write on never-live ns -> verify-write-timeout (bounded, no hang)
       :: {"ok":false,"code":"write-failed"} in 51ms        ← 期望 ~500ms 后 verify-write-timeout
```

设计 §5-T7 明文用例「对永不可 live ns 的 `verify-write`（timeoutMs:500）→ `verify-write-timeout`」——SA6 未写 T7（SA4 R1 §4 已记缺口），SA7 动态执行该规格 = **红**。

### 2.5 F1 阻断定级与修复方向（回流 SA3）

- **影响**：① 定向套件失败率 1/3（本机近无载）~7/10（满载复现器），PR CI（170 文件全量 + node20/24 双矩阵）红灯概率高；② 设计 §3.4 冻结的稳定码语义不可达——对「已知集但未物化」ns，`verify-write-timeout` 永不出现，文档化部署自检动词在 peer ready 后立即使用会得到误导性的 `write-failed`（形似变更被拒，实为尚未物化）；③ 设计 §5-T7 指定断言动态执行红。
- **修复方向（窄面）**：`opVerifyWrite` peer 路径对 `registry.open` 失败且 ns ∈ 已知集（`peerOwners`）时，在 op deadline 内重试 open，超时返回 `verify-write-timeout`（稳定码注册表零新增，符合 append-only 冻结）；`write-failed` 收缩回「open 于物化后真被拒 / mutateRoot ok:false」。配 1 条红测（永不可 live ns → `verify-write-timeout`，即 T7 规格）+ smoke 稳定化随修自动成立。
- 修复后重验门槛：`vitest run apps/yjs-server/test` ≥3 连绿 + `flake-repro`（满载 settle=0）10/10 ok + E1-4b 绿。

### 2.6 并发压力批次（Phase B，定性，`smoke-stress.log`）

「全量套件 ∥ app tsc」×2 完整轮（第 3 轮中止）：每轮 5 失败。**逐项分类后仅 2 项为 F1 竞态签名**（smoke 用例 1/2 快速失败 @2730ms/1666ms，Phase B run 1）；其余 8 项失败全部为**本机环境形**：`spawn tsx EAGAIN`（vitest 自身报 `errno:-11`）、进程 `exit 134`(SIGABRT)、30-60s spawn 饥饿超时——本 4 核共享机在双进程树并发下触及 fork/线程预算上限（`bash: fork: retry` 连续出现，甚至一度令 SA7 shell 无法启动）。**该类失败不代表产品行为，也与 CI runner（独占 4 vCPU）条件不同**；且为避免污染后续测量，Phase C（双套件并发）与 D 主动中止。F1 的定量证据以 §2.1（1/3，近无载）、§2.1b（1/5，load 0.44）、§2.2（载荷级）为准。

## 3. 类型检查（独立复跑，全绿）

| 命令 | 结果 |
|---|---|
| `./node_modules/.bin/tsc -p apps/yjs-server/tsconfig.json` | **EXIT=0** |
| 逐项目 `tsc -p`（11 packages + app，镜像 `pnpm typecheck` 全链） | **12/12 EXIT=0，FAIL=0** |
| `pnpm typecheck`（本机 pnpm 11.7.0） | **EXIT=0**（SA3 R2 §3 担忧的 corepack/depsStatusCheck 失败在本机未复现） |

日志：`/tmp/sa7-139/logs/typecheck.log`。

## 4. 真实配置重复 token 拒绝（B1 修复，boot + reload 双路径，真进程）

| # | 场景 | 命令形态 | 结果 |
|---|---|---|---|
| C1 | boot 期重复 token | `node --import tsx src/main.ts --config dup.json`（`tokens:{peer-1:shared,peer-2:shared}`） | ✅ **exit 1（301ms）**；stdout `config-error` violations `[{"path":"hub.tokens.peer-2","reason":"duplicate token value (token values must be unique per peer)"}]`（锚定靠后键=别名接受者）；stderr 精确行 `config violation hub.tokens.peer-2: duplicate token value …` |
| C2 | **reload 期**重复 token（SIGHUP 热实例） | 重写同路径 config 为重复 token → SIGHUP | ✅ `config-error`（同 violation）+ 进程存活 + `status` op ok + **旧 token 拨号仍被接纳**（open，无拒绝事件）+ 错误 token 仍 `1008` + `auth-upgrade-rejected(invalid-credentials)` + 后续 SIGTERM exit 0 |

日志：`/tmp/sa7-139/logs/scenarios-fast.log`（C1/D3a-g 全 PASS）。

## 5. 生命周期 watchdog 边界与 reload 行为

| # | 场景 | 结果 |
|---|---|---|
| D1a | `maxDirtyMs:30001` boot | ✅ exit 1 + `config violation persistence.schedule.maxDirtyMs: maxDirtyMs must be <= 30000 …` + 无 `watchdog timeout` 字样 |
| D1b/D7 | `maxDirtyMs:30000`（上界值）boot → SIGTERM | ✅ boot 至 ready；**stopMs=30558 < 60s watchdog**；停机链 `replication-drained→registry-stopped→persistence-disposed→app-stopped` 严格递增且末事件到达管道；exit 0；无 watchdog 文案（排空窗 30.5s 恰为设计值，被 watchdog 覆盖，B2 数值关系在边界值上动态成立） |
| D2 | 好配置 SIGHUP 换装 + **token 换装** | ✅ 事件链 `reload-starting < app-stopped < listening < ready < reload-complete`（全停机链在内）；**同端口重听**；换装后**旧 token 拨号 → WS 1008 + `auth-upgrade-rejected(invalid-credentials)`**、新 token 拨号 open 无拒绝；SIGTERM exit 0 |
| D3 | 坏配置 SIGHUP | ✅ 见 §4-C2（旧实例继续服务） |
| D4 | 换装中重复 SIGHUP | ✅ 第二发 → `{"event":"reload-ignored"}`；恰 1 次 `reload-starting`/`reload-complete`；无 `reload-failed`/`config-error`；SIGTERM exit 0（20s 排空窗内双发，窗口充分） |
| D6 | 换装新 config 端口被占 | ✅ `reload-starting` → 停旧完成 → 装新 listen `EADDRINUSE` → stderr `reload failed after teardown …` → **exit 1**，耗时 <60s（catch 臂 loud，未动用 watchdog 臂），无静默挂起 |
| D5/O2 | reload 总超时 watchdog **触发臂** | ⚠ **未能动态驱动**：构造 = reload（maxDirtyMs=30s）进入排空后 `SIGSTOP` 70s 再 `SIGCONT`——恢复后 reload **直接完成**（`reload-complete`），watchdog 未获得触发机会（日志 `reload-watchdog.log`）。合法配置无法制造 ≥60s 真挂起（这正是 backstop 的设计前提）；触发臂保持**静态核实**（`main.ts:90-95` 换装入口武装、unref、`finally:135` 清除；超时臂 stderr+`reload-failed(watchdog-timeout)`+exit(1) 代码路径在案）。SA4 R2-O2 以「需人为挂起」记账，本次尝试如实报告未遂 |
| O3 相关 | 末事件管道截断 | ✅ 侧证：所有 SIGTERM/换装路径的末事件（`app-stopped`/`reload-complete`）在管道读端全部到达（D7/E1-8b/D2/D4）；`reload-failed` 事件本身的管道送达随 D5 未遂，未覆盖 |
| E-竞态 | boot 窗口 SIGTERM / SIGHUP | ✅ A：config-loaded 后立即 SIGTERM → 干净 exit 0、无 unhandled/崩溃 stderr；B：立即 SIGHUP → 停旧（boot 取消感知）→ 装新 → `reload-complete`，恰 1 次 `reload-starting`，SIGTERM exit 0 |
| G | tsx 包装层 SIGHUP（部署文档声明） | ✅ 负例成立：对 tsx **包装进程**发 SIGHUP → 无任何 reload 事件、包装进程自身 `Hangup` 死亡（脚本进程未收到信号）；生产路径 `node --import tsx` 直收（§5 D2/D3/D4 全部经此路径）——文档声明与实现一致 |

## 6. 真实 Hub+Peer 冒烟事实（独立手工链路，`smoke-manual`）

全链 PASS（除 §2.4 的 E1-4b=F1）：

- **E1-1** 启动序 `config-loaded < provisioned < listening{实际port} < ready` 严格递增；nsId 合 `^ns-[0-9a-f]{32}$`；port=0 上报实际端口。✅
- **E1-2** peer 静态 target 认证 → `verify-write` ok → hub `read` 回读 =7。✅（本链路单次执行收敛正常——F1 仅在 ready 后即刻发 op 的竞态窗口内触发）
- **E1-3** stdin 错误链：raw 非 JSON 行 → `malformed-line`（恰 1 回执）；`bogus-op` → `unknown-op`；坏文法 nsId → `invalid-op-args`；合法文法未知 ns → `namespace-unknown`；进程存活、`status` ok。✅（T7 未自动化部分的关键行为面）
- **E1-4a/c** `add-target` 重复 add：两回执均 ok、**恰 1 次** `target-added` 事件；`remove-target` 二次移除幂等 ok。✅（E1-4b 见 F1）
- **E1-5** HTTP 面：`GET /healthz` → 200 `ok`；`GET /other` → 404；**对错误路径发起 WebSocket upgrade → HTTP/1.1 404 Not Found**（upgrade 前拒）。✅
- **E1-6** 认证面：错 token 拨号 → **WS 1008 + hub `auth-upgrade-rejected{"reason":"invalid-credentials"}`**；缺 Authorization 头 → **WS 1008 + `missing-token`**。✅（SA4 R1 动态重点 #2，零自动化覆盖项，已动态证实）
- **E1-7** peer `notify-auth-changed` → `ok:true` + `connectionState:"ready"` 载荷。✅
- **E1-8** SIGTERM：peer/hub 均 exit 0；hub 停机链四事件严格递增且**全部到达管道**（截断风险侧证）；**锁文件随干净停机删除**。✅
- **E1-9** 同 rootDir 重启（直引形式授权）→ durable 回读 =7。✅
- **E1-10** 共享 root 锁：异实例 → exit 1 + `shared file persistence root is unsupported: another instance holds .nomicore-lock.json ({instanceId:"hub-1", pid:…})`；同 instanceId → exit 1 + `held by the same instance … previous instance did not shut down clean`（文案区分达标）；崩溃残留 stale 锁被按 pid 判定覆盖后可 boot。✅

## 7. 非阻断观察（记账）

| # | 级别 | 发现 | 证据 |
|---|---|---|---|
| O1 | MINOR | `opRead`（`app.ts:470-471`）同形快速失败：未物化 ns 的 `read` 即时 `read-failed`（设计对 read 的措辞仅「读取失败 → read-failed」，偏离不如 verify-write 明确）——建议随 F1 一并复核 | E1-3d 对照（合法未知 ns 正确 `namespace-unknown`；未物化已知 ns 则 `read-failed`） |
| O2 | INFO | 套件孤儿进程泄漏：测试 afterEach 对 tsx **包装进程** `SIGKILL` 后内层脚本进程存活（每只 ~11 OS 线程，idle）。SA7 会话内累计发现 23 只本任务可识别残留（config 路径全部指向 `/tmp/yjs-server-{smoke,t6,watchdog}-*` 或 SA7 自建；横跨 SA3/SA4/SA7 历次运行），三次按 config 精确回收（SIGTERM→SIGKILL）。测试侧建议：afterEach 改杀**进程组**或解析内层 pid 兜底 | `pgrep -af "main.ts --config"` 历次快照；elapsed 与历次套件运行时刻吻合 |
| O3 | INFO | SA4 R2-O1 的跨文件数值不变量（`MAX_MAX_DIRTY_MS+500 < STOP_WATCHDOG_MS`）仍无静态断言；本报告 D7 以边界值动态侧证行为正确 | §5-D7 |
| O4 | INFO | 本机（4 核共享）存在**线程/进程预算上限**：并发双进程树即触发 `spawn EAGAIN`/`SIGABRT`/esbuild(Go) `newosproc` fatal（§2.6、§8），并与 O2 的孤儿泄漏正反馈（用户线程峰值 212；三次回收后 60）。该上限使全仓 `pnpm test` 无法在本机取得干净全量结果——定性时须区分环境形失败 | `ps -o nlwp` 汇总 212→113→112→60；`smoke-stress.log`/`pnpm-test.log` |
| O5 | INFO | T6 在全仓运行中暴露 F1 第三面：hub 重启 → `notify-auth-changed` 恢复 → 收敛 `verify-write` 若在本地 ns 重物化前发出，同样快速 `write-failed`（@6.7s 失败）——修复 F1 时应一并覆盖该路径 | `pnpm-test.log` 尝试 3 |

## 8. CI 触发证据（skill Step 3/4）

- **阻塞（非 SA7 可解）**：分支未推送——`git status -sb` 显示 `ahead 3`（相对 `origin/docs/phase-5-websocket-replication`）；`origin` 无同名远端分支；`gh run list --branch fix/issue-139-…` 空；`gh pr list --head …` 空 → **无 CI run 可摘录**。SA7 不负责 push/建 PR（边界），CI 侧 spec/vitest 触发证据待推送后由后续轮补。
- 静态门禁独立复核：`.github/workflows/ci.yml` `Test: pnpm test` → 根 `vitest.config.ts` include 含 `apps/*/test/**/*.test.ts`（app 6 测试文件在收集面内）；`Typecheck: pnpm typecheck` 含 `tsc -p apps/yjs-server/tsconfig.json`（本机 EXIT=0，§3）。
- 本地 CI-parity：`pnpm test`（= `vitest run --typecheck`，170 文件全仓）×3 次尝试，**本机未能取得干净全量结果**（详见下），但失败分类已完成：
  - 尝试 1（12:52）：**348ms 即夭折**——esbuild（Go 二进制）`runtime: failed to create new OS thread … errno=11` fatal → 3 文件收集失败、0 用例执行（纯环境失败：本共享机线程预算耗尽）；
  - 尝试 2：`smoke-skeleton` 用例 1 红（**F1 签名** @826ms）+ dsh-persistence 7 失败 + `ERR_IPC_CHANNEL_CLOSED` 中止；
  - 尝试 3：`T6` 红（**F1 签名**：hub 重启恢复后的收敛 `verify-write` @6.7s `expected false to be true`——F1 的第三个暴露面：恢复路径上本地 ns 重物化前发 op 同样快速 `write-failed`）+ dsh 6 失败；
  - **dsh 失败定性为环境形**：两个失败文件隔离重跑全绿（`dsh-probe-cli` 7/7 @2.65s、`dsh-file-probe-determinism` 2/2 @1.34s）；本任务 diff 零 `packages/**` 改动。
  - 结论：全仓 `pnpm test` 在本机唯一可归因产品的失败类 = F1；全量绿/红的最终裁定需真实 CI（未推送，阻塞）。

### 压力批次汇总（`/tmp/sa7-139/logs/smoke-stress.log`）

- Phase A 隔离 smoke ×5：**1 红**（run 2，F1 快速失败签名 @719ms，load 0.44），4 绿
- Phase B（套件 ∥ tsc）：run 1 = 5 失败（2×F1 签名 + 3×环境形）；run 2 = 5 失败（全环境形 spawn 饥饿）；run 3 中止（同环境形）
- Phase C/D：主动中止（本机 fork/线程预算上限已触及，继续只会产生环境噪声，见 §2.6）

## 9. 结论

| 维度 | 结论 |
|---|---|
| SA4 Step 0 校对 | PASS（R2）→ 允许独立发现 fail |
| 定向套件稳定性 | ❌ 1/3 基线失败；根因 F1（§2） |
| 类型检查 | ✅ 全绿（app + 12 项目链 + `pnpm typecheck`） |
| 重复 token 拒绝（boot+reload） | ✅ 真进程双路径 loud 拒 |
| watchdog 边界 / reload 行为 | ✅ 边界值动态成立、换装/坏配置/双发/端口冲突/启动竞态全过；watchdog 触发臂动态未遂（静态在案） |
| Hub+Peer 冒烟事实 | ✅ 全链路（含认证拒绝面、错误链、幂等、锁、durable）——唯 E1-4b=F1 |
| CI 触发证据 | ⚠ 阻塞：未推送/无 PR/无 run（SA7 不 push）；静态门禁已独立复核 + 本地 `pnpm test` 三次尝试（本机线程上限干扰，dsh 失败已定性环境形——隔离全绿；唯一产品可归因失败类 = F1） |

**Verdict: FAIL（fail-needs-fix）** —— 单一阻断 F1：`verify-write` 对「已知集未物化」ns 绕过 §3.4 有界等待（`app.ts:505-506` 快速 `write-failed`），即套件 1/3 失败率的根因，且设计 §5-T7 指定行为动态执行为红。其余全部维度独立复验通过，SA3 修复面窄（`opVerifyWrite` 单函数 + 1 条 T7 规格红测）；修复后按 §2.5 门槛重验。

---

## 附录 A：命令与日志索引（全部独立进程执行）

| 产物 | 路径 |
|---|---|
| 套件基线 ×3 | `/tmp/sa7-139/logs/stability-baseline.log` |
| 类型检查 | `/tmp/sa7-139/logs/typecheck.log` |
| 压力/隔离批次 | `/tmp/sa7-139/logs/smoke-stress.log` |
| 全仓 `pnpm test` ×3 | `/tmp/sa7-139/logs/pnpm-test.log`（末次覆盖；wrapper1-3 佐证） |
| flake 复现器（近无载/满载/对照） | `/tmp/sa7-139/logs/flake-unloaded.log`、`flake-loaded.log` |
| registry.open 探针 | `/tmp/sa7-139/probe/registry-open-probe.mjs`（输出见本报告 §2.3） |
| C1/D1/D7/D3/D6 场景 | `/tmp/sa7-139/logs/scenarios-fast.log` |
| D2/D4/启动竞态 | `/tmp/sa7-139/logs/scenarios-slow.log` |
| D5 watchdog 实验 | `/tmp/sa7-139/logs/reload-watchdog.log` |
| 手工冒烟 E1 | `/tmp/sa7-139/logs/smoke-manual.log`（+ e1-rest 输出见 §6） |
| tsx SIGHUP 负例 | `/tmp/sa7-139/logs/tsx-hup2.log` |
| 驱动库/场景脚本 | `/tmp/sa7-139/{lib,cfg-boundary,reload-bad,reload-good,reload-double,reload-portconflict,reload-watchdog,boot-race,smoke-manual,flake-repro}.mjs` |
