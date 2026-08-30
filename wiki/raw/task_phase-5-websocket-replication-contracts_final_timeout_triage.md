# SA7 动态分诊 — issue #172 final run 7×5s Vitest 超时：真实回归 vs 负载/并发 flake

**Date**: 2026-08-30 03:16–03:39（复跑窗口）
**SA7 Verdict**: **环境性负载/并发超时 flake —— 7 项全部不可归因于 issue #172 diff；无需回流 SA3**
**分诊对象**: `.mabf-bg/issue-172-final.log`（HEAD `d171744`；typecheck=0、test=1、diff-check=0；7 failed 全为 `Test timed out in 5000ms`；另伴 2 个 `[vitest-worker]: Timeout calling "onTaskUpdate"` RPC 基建超时；Duration 996.20s）
**前置门禁（Step 0）**: SA4 verdict = **pass**（R2 固定范围复验全过）；本分诊为其「动态审核重点」的独立执行，结论与 SA4 `timeout_scope_review.md`（pass）相互独立印证。SA7 不下调 SA4 verdict。
**方法**: 零代码修改（工作树仅新增本报告与 `.mabf-bg/triage-*` 日志，均被 gitignore）；全部复跑以独立后台进程（`setsid nohup … & disown`）执行，附全程 20s 间隔负载采样。

---

## 0. 结论（先答问题）

**7 个超时均为共享 2 核宿主机 CPU 饥饿下的环境性 flake，不是回归。判定性事实**：

1. **同一份被测代码（HEAD `d171744`），安静窗口复跑全部转绿**——R3（03:38，loadavg 3.16 触发）：4 文件 48/48 用例全绿，7 个 final 失败项实测 2921–3852ms。
2. **失败集合随运行时刻漂移、不随代码变化**——final 7 红 / R1（高负载）8 红（含 final 中绿着的 dsh「memory profile」）/ R2（全量忠实复跑）3 红（gen 2 项与 session 2 项转绿）。确定性回归不可能产生这种来回翻转的失败集合。
3. **final run 同代码比 02:22 全绿跑慢 1.9 倍**（996.20s vs 521.74s，tests 715.60s vs 367.73s）——唯一变量是运行时刻的机器占用。
4. **机制级微探针实测预算结构**：dsh 双 spawn 用例 = 2 条 `pnpm→tsx→即时编译` 子进程链，中等负载（load≈3.9）下 3629/3706ms（5s 预算的 73%）；gen 用例 = generate+--check 两条串行子进程 ≈ 6.8s **名义上已超 5s**，能否过线完全取决于机器快慢。四文件零 per-test timeout 覆盖（`grep '{ timeout'` = 0），`vitest.config.ts` 零 timeout/并发调优，缺省 `testTimeout=5000ms`。
5. **registry 两文件 3 项为纯 CPU 用例**：fixture 明示「零 real sleep」（虚拟时钟 `createTestScheduler` + 固定 `now`），逻辑级挂起不可能——超时只能是 worker 进程被饿到 5s+。

**回流建议：不回流 SA3。** 可选的测试基建加固（per-test timeout / spawn 密集文件限并行）另立票处理，与本票 diff 无关（见 §6）。

---

## 1. 环境事实（共享宿主机）

| 事实 | 值 | 来源 |
|---|---|---|
| CPU | **2 核**（`nproc`=2，`availableParallelism`=2） | 本机 |
| vitest 并发/超时配置 | 无任何配置 → forks pool 按核数并行 + `testTimeout=5000ms` 缺省 | `vitest.config.ts`（全仓唯一，无包级 config） |
| 分诊期间负载 | loadavg 3.16–7.10 振荡 | `.mabf-bg/triage-driver.out` 20s 采样 |
| 外来常驻占用 | **3 个失控 `grep -RIl`（各 ~60% CPU，已跑 15–16h）≈ 独占 1.8/2 核** + MABF runner + openclaw agent | `ps --sort=-pcpu`（仅识别，未触碰） |
| final run 窗口负载 | 03:14:54 采样 3.78/5.30/5.69（5 分钟均值覆盖 final run 尾段）→ 2 核超订 ~2.6× | scope review §5 + 本分诊采样 |

## 2. 运行点清单（同一被测代码）

> `d171744`（final HEAD）与 `3141884`（H1 时点）仅差 5 个 wiki 文档文件——被测代码逐字节等价（scope review §3 已核对）。

| 运行点 | 时刻 | 形态 | Duration | 总结果 | 负载语境 | 日志 |
|---|---|---|---|---|---|---|
| H1 历史全绿 | 08-30 02:22 | 全量 `pnpm test` | **521.74s** | **176 文件 / 2043 用例全绿**（+2 RPC 基建超时） | 安静窗口 | `/tmp/sa7-full.log`（sa7_report §3 登记） |
| **F final（分诊对象）** | 08-30 02:55 | 全量 `pnpm test` | **996.20s** | 4 文件 / **7 用例红**（+2 RPC） | 重载（比 H1 慢 1.9×） | `.mabf-bg/issue-172-final.log` |
| R0 机制微探针 | 03:16 | 裸 CLI 计时 | 14s | 见 §4 | load 3.47–3.87 | `.mabf-bg/triage-r0-micro.log` |
| R1 隔离串行 | 03:16–03:18 | 4 文件逐个 `vitest run --reporter=verbose` | ~96s | **8 红**（dsh×5、gen×2、session×1） | load 3.87→**6.68**（爬升） | `.mabf-bg/triage-r1-serial.log` |
| R2 全量忠实复跑 | 03:18–03:28 | **与 final 完全同命令** `pnpm test` | **598.84s** | **3 红**（仅 dsh 三项）+ 2040 绿（+2 RPC） | load 5.2–7.1 | `.mabf-bg/triage-r2-full.log`（exit=1） |
| **R3 安静窗口串行** | 03:38–03:39 | 4 文件逐个（轮询 load<3.2 触发，实测 3.16） | 50s | **48/48 全绿，0 失败** | load 3.16→4.55 | `.mabf-bg/triage-r3-calm.log` |

**R1 诚实披露**：R1 执行期间（03:16:40 起），scope review agent 的同款隔离复跑（03:16:37，`/tmp/sa4-timeout-scope.log`）与本分诊并发——R1 的负载读数含两者的互相挤压。这不影响结论方向（R1 本身即「叠加并发 → 更多超时」的数据点），但 R1 的负载归因按「双套件并发」记录。R2/R3 窗口内无其他 agent 测试进程（`ps` 核实）。

## 3. 逐项证据矩阵（每项 ≥4 个同代码数据点，含两轮新鲜复跑）

| # | 文件 / 用例 | H1 02:22（安静全量） | F 02:55 final | R1 03:16 串行（负载→6.7） | R2 03:18 全量（599s） | R3 03:38 安静串行 | 归因 |
|---|---|---|---|---|---|---|---|
| 1 | dsh-probe-cli · 可复制性（**2 条并发 spawn**） | ✓ 3640ms | × 5077ms | × 5010ms | × 5013ms | ✓ **3728ms** | 负载 flake |
| 2 | dsh-probe-cli · file profile（**2 条并发 spawn**） | ✓ 3741ms | × 5018ms | × 5012ms | × 5014ms | ✓ **3749ms** | 负载 flake |
| 3 | registry-phase5-replication-red · AC-6 persistence-degraded | ✓ 2922ms | × 6219ms | ✓ 3090ms | ✓ 3631ms | ✓ **2960ms** | 负载 flake |
| 4 | registry-phase5-replication-session-red · AC-5 peer degraded | ✓ 3254ms | × 8291ms | × 7745ms | ✓ 4037ms | ✓ **3229ms** | 负载 flake |
| 5 | registry-phase5-replication-session-red · 补锚 (a) hub degraded | ✓ 2956ms | × 7013ms | ✓ 4418ms | ✓ 3510ms | ✓ **2921ms** | 负载 flake |
| 6 | generate-cli-check · generate 后 --check（**2 条串行 spawn**） | ✓ 3068ms | × 6540ms | × 7851ms | ✓ 3840ms | ✓ **3208ms** | 负载 flake |
| 7 | generate-cli-check · 源漂移后 --check（**2 条串行 spawn**） | ✓ 3831ms | × 6506ms | × 7015ms | ✓ 4403ms | ✓ **3852ms** | 负载 flake |
| 旁证 | dsh-probe-cli · memory profile（1 条 spawn，final 中**绿**） | — | ✓ 3796ms | × 5110ms | × 5070ms | ✓（7/7 绿） | 集合双向漂移 |

失败集合演化：**H1 全绿 → F 7 红 → R1 8 红（含 F 绿项）→ R2 3 红（F 的 7 项中 5 项转绿，另 1 个 F 绿项转红）→ R3 全绿**。同代码同命令下失败集合是「运行时刻负载」的函数，不是代码状态的函数——确定性回归被排除。

## 4. 机制分析（两族失败形态）

### 4.1 CLI 子进程族（#1/2/6/7，dsh-persistence + vfsl-codegen）

- 被测用例每次 spawn `pnpm exec tsx <cli.ts>`（dsh）或 `pnpm generate [--check] --domains <fixture>`（codegen）——完整 node 启动 + pnpm 解析 + tsx 即时编译链。
- **R0 实测（load 3.47–3.87，`.mabf-bg/triage-r0-micro.log`）**：
  - 单条 dsh CLI：**1660ms / 1725ms**（rc=0，`probe ok=true events=28`）；
  - 两条并发（= 失败用例 #1/#2 的精确形状）：**3629ms / 3706ms** —— 缺省预算 5000ms 的 **73%**；
  - `pnpm generate` 3389ms + `pnpm generate --check` 3427ms 串行（= 失败用例 #6/#7 的形状）≈ **6.8s > 5s**：该族在当前共享机器上**结构性越线**，过线与否完全由当时 CPU 可用度决定（安静时单链 ~1.5s → 全过；final 时段单链 ~3s+ → 全挂）。
- 用例自身的 60s 子进程 guard（dsh `runCli`）不构成约束——绑死它们的是 vitest 缺省 5s testTimeout；gen 用例用 `spawnSync`（同步阻塞事件循环），故超时上报为 6.5–7.9s（timer 到点后等同步调用返回才结算）。
- **同仓先例**：`dsh-file-probe-determinism.test.ts` 同为 CLI 双跑用例，但逐用例 `{ timeout: 60_000 }`——final run 中以 8390ms **通过**。族内对照组直接证明「缺省 5s + spawn 密集」是唯一差别。

### 4.2 registry 降级族（#3/4/5，namespace-registry 两文件）

- `makeMemoryStoreFixture` = `createTestScheduler()` **虚拟时钟**（`flushAll` = 60×`advanceBy(1000)` 微任务展开）+ `clock.now` 固定值；session-red 文件头明示「**零 real sleep**」。挂起型缺陷在这类 fixture 中不可能产生超时——超时只能是 worker 进程 5s+ 得不到 CPU。
- 该 3 项是各自文件中最重的纯 CPU 用例（schema 编译 + yjs 编码 + registry bootstrap），安静时 2.9–3.3s（已占预算 58–77%），重载下拉伸到 6.2–8.3s。R1 中同 describe 块内姊妹用例 10–91ms 全绿、仅重用例越线，与 CPU 饥饿的选择性拉伸一致。

### 4.3 基建层旁证

final/R1/R2 三轮均伴随 **2 个 `[vitest-worker]: Timeout calling "onTaskUpdate"`**（vitest 主进程↔worker RPC 超时，堆栈全在 `node_modules/.pnpm/vitest@3.2.7/…/rpc.-pEldfrD.js`）——worker 被 CPU 饿到连 RPC 都无法按期应答的基建级签名，与 H1 全绿跑出现的 2 个 RPC 超时同源（H1 时刻负载尚不足以把测试用例本身推过 5s 线）。

## 5. 回归假设的证伪链（五条独立证据，任一成立即排除）

1. **静态不可达**：本票 diff（`ef19bae..d171744`）生产代码改动全部为注释级（doc-runtime 5 文件×1 行、replication-session.ts 4 行）；唯一行为改动（ws-replication 字段改名/缺省值）不在 4 个失败文件的 import 传递闭包内（无一 import `@nomicore/ws-replication`）。4 个失败测试文件本票零改动。
2. **同代码全绿**：H1（02:22，522s）176/176 文件、2043/2043 用例全绿；本分诊 R3 安静窗口 48/48 全绿。
3. **失败集合漂移**：§3 矩阵——F 的 7 项在 R2 有 5 项转绿、1 个 F 绿项在 R1/R2 转红。
4. **纯 CPU fixture 无挂起通道**：虚拟时钟 + 固定 now + 零 real sleep（§4.2）。
5. **跨 issue 复现**（scope review §4 引证）：issue-138 worktree（不同 diff、4 个失败测试文件逐字节相同）08-29 21:25 出同款 6 个 5s 超时，其 20:44 首跑（441s）全绿——超时是「机器×时刻」的属性，不是任何 diff 的属性。

## 6. 结论与路由

| 决策 | 结论 |
|---|---|
| **是否回流 SA3** | **否。** 7 项超时与本票 diff 无因果关系；任何实现改动都无法消除环境性 CPU 饥饿，回流只会制造假动作。本票代码零改动需求。 |
| 本票收口口径 | final run 的 typecheck=0 与 diff-check=0 已绿；test=1 的 7 项红全部环境归因（本报告）。同等效力的全量绿记录已存在：H1（同代码 2043/2043）。如需新鲜收口证据，安静窗口全量复跑或直接引用 R3 + H1。 |
| 基建加固（另立票，非本票） | ① CLI 子进程类用例（dsh-probe-cli、generate-cli-check、schema-check-cli、dsh-file-probe-determinism 等）与重负载 registry 降级用例设 per-test timeout（30–60s；仓内已有 `{ timeout: 60_000 }` 先例）；② 或 spawn 密集文件限并行（`fileParallelism`/`maxWorkers`/独立 pool）；③ 排程侧：final 全量尽量单占机器窗口（共享 2 核机常被 ~1.8 核外来进程超订）。 |
| CI 侧 | 发布产生 PR run 后按 SA7 N3 既定动作确认 GitHub runner（独占资源）`pnpm test` 全绿——环境性超时在独占 runner 上应消失；若复现同形超时，基建票升级处理（届时才需重审本判定）。 |

## 7. 复现与证据清单（零代码修改）

| 产物 | 路径 |
|---|---|
| 分诊驱动（R0+R1+R2+负载采样） | `.mabf-bg/triage-driver.sh` / `triage-driver.out`（20s 负载采样流） |
| R0 机制微探针 | `.mabf-bg/triage-r0-micro.log` |
| R1 隔离串行 | `.mabf-bg/triage-r1-serial.log` |
| R2 全量忠实复跑 | `.mabf-bg/triage-r2-full.log`（exit 1：3 红） |
| R3 安静窗口串行 | `.mabf-bg/triage-r3-calm.log`（轮询 load<3.2 触发） |
| H1 历史全绿全量 | `/tmp/sa7-full.log`（02:22–02:31，521.74s，2043/2043） |
| final run（分诊对象） | `.mabf-bg/issue-172-final.log`（02:55–03:11，996.20s，7 红） |
| 交叉印证（静态/范围侧） | `wiki/raw/task_phase-5-websocket-replication-contracts_timeout_scope_review.md`（verdict: pass；四证据链独立同结论） |

复跑命令形态（均为独立后台进程）：

```bash
# R1/R3：逐文件串行（verbose 取逐用例毫秒）
pnpm exec vitest run --reporter=verbose <file>
# R2：与 final 完全同命令
pnpm test        # = vitest run --typecheck
# R0：裸计时（单条/双并发 spawn、generate+check）
pnpm exec tsx packages/dsh-persistence/src/cli.ts --adapter memory
```

**SA7 Step 0 记录**：SA4 verdict = pass（R2 固定范围复验）→ 进入动态验证；本分诊独立发现的环境性超时不构成对 diff 的 fail，与 SA4/timeout_scope_review 结论一致。
