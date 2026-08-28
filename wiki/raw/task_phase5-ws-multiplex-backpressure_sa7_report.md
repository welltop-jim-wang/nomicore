# SA7 动态验证报告 — issue #137（单连接多 namespace 多路复用 + 有界公平背压）

**Date**: 2026-08-29
**Verdict**: **pass**（SA4 R2 pass 之上独立动态验证；D1–D5 全绿 + 四红锚复证 + 既有 73 IT 零回归 + 类型干净；无新阻断项；2 条非阻断动态发现登记）
**被验对象**: commit 6f2676f..8f9751e（src/backpressure.ts 新建 + frame-io/update-channel/peer-connection/hub-connection/peer-namespace/hub-namespace 修改）+ 本轮新增 `packages/ws-replication/test/ws-replication-sa7-issue137-dynamic.test.ts`（commit 98ffafc，7 IT）
**验证方法**: 独立进程真实执行（setsid nohup 后台 + 退出码落盘 `.mabf-bg/`，全程零前台同步阻塞）+ 临时 `[SA7-DIAG]` 诊断日志（已完成 `git checkout` 还原，src/ 零残留）+ 破坏性/守卫测试编写
**输入**: SA4 R2 报告 §6 D1–D6 / SA2 R3 报告 §5 F1–F9 + §7.3 R2-N1 + §8.4 移交配方 / 设计 R3（§15 B-x）/ 任务简报 §SA6 红灯契约

---

## 0. Step 0/1 结论（skill 立法项）

- **SA4 verdict 校对**：`..._sa4_review.md` 顶部 **Verdict（R2 复审，最新·最终）: pass** → 本 SA7 合法启动动态验证（不上发不下发约束遵守：本报告 verdict 独立）。
- **SA6 红灯复跑（第二关）**：四红锚（AC-2 合并 / AC-6a+AC-4 水位闸门+RR 帧序 / AC-5 总压 shed / AC-6b hub 出站压力+control 保留）随基线套件**全部绿**（`ws-replication-issue137-ac1-ac7-red.test.ts (4 tests) ✓`）——实现已满足红灯契约，无 REJECT 事由。

```
[SA7 Step 0 结论] SA4 verdict: pass（R2 最终）→ 进 Step 1
[SA7 Step 1 结论] SA6 红灯: 🟢 GREEN（4/4 转绿）→ 进入 Step 2 清单驱动验证
```

---

## 1. 执行证据（命令 + 结果；全部独立进程，退出码落盘 `.mabf-bg/`）

| # | 命令 | 结果 | 退出码落盘 |
|---|---|---|---|
| E1 | `pnpm exec vitest run packages/ws-replication --no-typecheck`（**基线**，SA7 新文件加入前） | **Test Files 12 passed (12) / Tests 77 passed (77)**——与 SA4 R2-E1 独立复跑吻合（SA6 4 红锚转绿 + 既有 73 IT 零回归） | `sa7-r137-baseline-vitest.exit=0`（/tmp/sa7-r137-baseline.log） |
| E2 | 同上（**SA7 新测试合入后全量**，含 `ws-replication-sa7-issue137-dynamic.test.ts` 7 IT） | **Test Files 13 passed (13) / Tests 84 passed (84)**（= 73 既有 + 4 SA6 红锚 + 7 SA7 新增） | `sa7-r137-full3-vitest.exit=0`（/tmp/sa7-r137-full3.log） |
| E3 | 同上（**稳定性复跑**，同工作树第二轮） | **Test Files 13 passed (13) / Tests 84 passed (84)**——两轮全绿，零 flake | `sa7-r137-full4-vitest.exit=0`（/tmp/sa7-r137-full4.log） |
| E4 | `pnpm exec tsc -p packages/ws-replication/tsconfig.json`（含新增测试文件） | EXIT=0（类型面干净） | `sa7-r137-tsc5.exit=0`（另 tsc/tsc2/tsc3/tsc4 各轮均 0） |
| E5 | D4 通道级诊断（临时 `[SA7-DIAG]` instrumentation，tsx 独立进程，完毕后 `git checkout` 还原） | `pull items=20039 seq=0`（F4 消费）后**同一次 drain 内** `pull items=27+27 frame=37 seq=8`（合法项发出）——R2-N1「消费即进展」通道级实证；hub 侧 `onUpdate bytes=37 state=live` + apply ok | `sa7-r137-d4-diag.exit=0` 等（诊断轮；最终断言形态已固化为 D4 IT） |
| E6 | `git status --short packages/ws-replication/src/` | **空**（诊断 instrumentation 零残留；src/ 全程未被修改——diff 仅新增测试文件） | — |
| E7 | `git diff --name-only 8f9751e..98ffafc` | 恰 `packages/ws-replication/test/ws-replication-sa7-issue137-dynamic.test.ts`（1 文件，+706）——测试面外零触碰 | — |

> 端口说明：本包为内存双端 transport 单元/集成测试（无监听端口），skill 的 `fuser -k` 端口释放步骤 N/A（无端口竞争面）。
> 过程透明性：`.mabf-bg/` 中 `new/new2/new3/full2/d4vit` 等中间轮 exit=1 为本轮**测试编写迭代过程**（见 §4 动态发现——测试侧构造问题，非被验实现缺陷），最终态以 E2/E3/E4 为准。

---

## 2. SA4 §6 D1–D6 逐项复证（本轮核心清单）

新增测试文件 `ws-replication-sa7-issue137-dynamic.test.ts`（7 IT）逐项锚定，全部真实链路断言（零源码 grep 断言）：

| # | SA4 动态审核重点 | 复证结果 | 断言形态（实测） |
|---|---|---|---|
| **D1** | F1 修复回归锚（**必测**）：E5 场景——maxInFlightUpdates=1 + withPressure + 暂停段积压 2 项 + saveGate 扣 ACK + **撤压不推进 scheduler** + 第三写 → 恰 1 帧 + ACK 守恒；vitest 触发证据摘录 | ✅ **绿**（`D1:` IT） | 置压 2×highWater → 写 n=11/12（暂停段 **0 UPDATE 帧** + 本地 n=12 保留）→ saveGate 悬挂 → 撤压至 lowWater/2 **零 scheduler 推进** → 第三写 n=13 → **`UPDATE 帧数 === 1`**（合并 11+12；F1 bug 形态为 2 帧超窗→红）+ 悬挂期 **UPDATE_ACK === 0**（近似在途 1 ≤ 窗口 1，ACK 守恒）+ 释放后 hub 收敛 n=13（无滞留）+ 总帧数 2 < 3 笔写（合并证明）+ ns live。E5 判别值 [1][2][3][6][7] 在动态环境逐项复现 |
| **D2** | SA2 §5-F2 锚：handshaking 期 peer fatal（坏帧注入）→ 恰 1 帧 connection ERROR + close + blocked（R2 新语义防回退成静默） | ✅ **绿**（`D2:` IT） | `boot({start:false})` → `peer.start()` 同步 dial+HELLO+setState('handshaking')（断言锁定注入窗口）→ 同步注入**截断 payload 坏帧**（序列=期望 1；一跳微任务先于 HELLO_ACK 两跳——确定性）→ decode error → **peerToHub 恰 1 个 connection ERROR**（code = 实测抛码 `FRAME_LENGTH_MISMATCH`，零硬编码；无 namespaceId）+ close **1002**（hub 侧收码断言）+ connectionState **blocked** + 零 HELLO 重试。#136 旧语义（ready 门吞帧→0 ERROR 帧）下本断言红 |
| **D3** | SA2 §5-F3 配方：额度耗尽可达性——① lowWater=1,highWater=2 极端 → 任一 control 帧 → CONNECTION_BACKPRESSURE + 1011 + backoff + 重连恢复；② 缺省 64KiB 配方（≈1600+ ACK 或 >64KiB 单控制帧）锁定谓词精确触发帧数 | ✅ **绿**（三互补面，`D3a/D3b/D3c:` IT） | **D3a**：lowWater=1/highWater=2 + 置压 3 → peer 写 → hub 应用（数据面不受控，hub n=5 断言）→ UPDATE_ACK 首帧即触发：**恰 1 ERROR `CONNECTION_BACKPRESSURE`**（无 namespaceId）+ **暂停段 0 新 ACK**（触发帧不发送）+ close **1011** + peer **backoff（非 blocked）**+ 撤压分步推进重连（新 wire #2）→ live → 新写 ACK 回流（通路恢复）。**D3b**：缺省 64KiB 大控制帧路径——90KB blurb hub 文档 + 首连预置压：HELLO_ACK 小帧放行（握手完成）→ **首个 >64KiB BOOTSTRAP_SNAPSHOT 触发且该帧零上 wire** + 1 ERROR + 1011 + backoff → 撤压重连 → BOOTSTRAP 流转恰 1 帧 → live + 90KB 收敛。**D3c**：谓词精确帧数——lowWater=100 + 实测等长 ACK 帧（探针写先实测 `ackBytes`）：暂停段放行数**恰 = floor(lowWater/ackBytes)**（异形谓词 `used ≥ lowWater` 会多发 1 帧→红；SA2 #3(a) 两读法以帧数判别）+ 每笔 UPDATE 先应用（hub n 断言）+ 1 ERROR + 1011 + backoff + 恢复。≈1600+ ACK 路径与 ② 同谓词，由 D3c 以任意帧长精确锁定（64KiB ÷ ~40B ≈ 1638 的算术同源） |
| **D4** | SA2 R2-N1 转绿守卫：超限项 + 合法小更新同队（maxUpdateBytes 配小 + 窗口 1 + saveGate 扣 ACK）→ 释放后合法项在预算内到达对端收敛且超限项零 UPDATE wire 帧 | ✅ **绿**（`D4:` IT，断言形态见 §4-N2 修正注记） | 可选 blurb schema（测试本地）+ 窗口 1 + saveGate：写 n=2（在途，ACK 被扣）→ 写 20KB blurb（**超限项入队 20039B > 8KB**）→ delete blurb（合法项① 27B）→ 写 n=3（合法项② 27B）→ 释放 → drain **pass1 F4 消费超限项（seq=0）→ 同一 drain pass2 合法项①②贪心合并（37B ≤ 8KB）上 wire**：`UPDATE 帧数 === 2`（字面 false-on-F4 下合法帧永不上 wire→红）+ **全部 UPDATE 负载 ≤ maxUpdateBytes**（超限项零 wire 帧）+ 两帧均获 hub ACK（apply ok 闭环）+ 本地 n=3/blurb 已删保留 + ns live + conn ready |
| **D5** | SA2 §5-F6 锚：置压进入暂停 → GOAWAY(SERVER_RESTARTING, drainTimeoutMs=0) → drain close → peer scheduler.pending() 恢复基线（无残留 poll timer） | ✅ **绿**（`D5:` IT） | 置压 + 写 n=11（暂停段 0 帧；**pending 严格 +1** = poll timer 武装）→ hub 静默期注入 GOAWAY(SERVER_RESTARTING, 1ms)（序列=下一期望；先 settle 令投递+drain timer 武装，pending 再 +1）→ advanceBy(1) deadline fire → peerSideClosed → **pending 恰回退 1（= pausedPending−1：poll timer 已清）** → 大步推进 60s **零新帧 + 计面不增长**（teardown 后 stale fire 零副作用零重武装）→ close 事件交付 → backoff → 撤压分步重连 → live → 暂停段积压 n=11 经恢复 round 收敛（数据不丢） |
| **D6** | B-7 反向风险：真实 WS adapter 须暴露 `bufferedAmount` number 属性（切片 7 自检演进位；**本轮仅登记，非验收面**） | ✅ **登记确认**（不加断言） | 本轮全部水位用例经 duck-typed 属性 seam（`Object.defineProperty(transport,'bufferedAmount',{get})`——issue137-driver:120-125）注入；实现读取形态（peer-connection.ts `readBufferedAmount`：number ∧ isFinite → 值，缺失/非法 → 0=无压力）与属性 seam 同构验证成立。生产 adapter 自检面维持切片 7 演进位登记（D6 非本任务验收面，按 SA4 原文处置） |

---

## 3. SA2 §8.4 移交配方覆盖对照

| SA2 §8.4 移交项 | 承接 IT | 结果 |
|---|---|---|
| F2 handshaking fatal 新语义（1 帧 ERROR 直发） | D2 | ✅ 恰 1 帧 + close(1002) + blocked |
| F3 额度耗尽可达性（lowWater=1 极端 / 64KiB 大控制帧 / 精确触发帧数） | D3a / D3b / D3c | ✅ 三面全绿，含触发帧不发送 + 1011 + backoff + 重连恢复 |
| R2-N1 转绿守卫（超限项 F4 消费后合法项收敛、不依赖未来触发点） | D4 | ✅（断言形态修正为 wire 层，见 §4-N2；通道级「同一 drain 双 pull」另经 E5 诊断实证） |
| F6/B-2 风暴终止条件（对端恢复读取 → 重连收敛；timer 泄漏面） | D5（+D3a/b/c 恢复段共证） | ✅ 每个耗尽/GOAWAY 用例均以「撤压→重连→live→收敛」闭环（B-2 终止条件 = 对端恢复读取的动态等价物：撤压后重连成功且数据收敛）；poll timer 零泄漏 |
| F7 emit 异常（运行时面） | 全部 7 IT 的 `collectUnhandledRejections()` 探针 | ✅ 零 unhandled rejection（含 F4 丢弃路径、收口路径、重连路径） |
| F1/F5/F8/F9（合并账务/双重编码/直发共存公平/73 IT 守卫） | F1→D1+D4（合并核减 + 帧数守恒）；F5→D3b（BOOTSTRAP 探针编码路径经判据放行）；F8→既有 SA6 AC-6a+AC-4 RR 帧序锚（E1 随套件复绿）；F9→E1/E2/E3 全量两轮 | ✅ |

---

## 4. 动态发现（非阻断，登记备查）

### N1（NOTE·测试基建认知）大步进 advanceBy 饿死 open/bootstrap 链 → 超时误判
fake scheduler（registry testing.ts）`advanceBy(30_000)` 在同一批 timer 内连发 backoff 拨号与 openTimeout(5s)/bootstrapTimeout(10s)，拨号后握手/OPEN 微任务链来不及在批内完成即被超时 timer 判 `failed`。**测试侧修正**：`advanceUntilReady`（250ms 分步推进 + 步间 settle）。实现无缺陷（timer 语义正确）；登记为后续测试编写范式（#136 G1 因确定性 backoff 25ms 未踩中）。

### N2（NOTE·SA4 D4 断言形态修正 + 运行时特性实证）F4 丢弃后同链 UPDATE 的对端 integrate 依赖 item-chain
- **构造修正**：本运行时 mutation bridge 每次 root 写**整树重写**（clear+set，doc-runtime/mutation.ts:63-66）——含大字段的后续写恒超限，SA2 原配方「写大→写小」不可得「合法小项」；改经**可选字段 schema + `op:'delete'`**（写 20KB blurb → delete blurb → 写 n=3）构造 [超限, 合法①, 合法②] 同队。
- **运行时特性（E5 诊断实证）**：F4 丢弃超限项后，后续 delta 的 yjs item 以被丢项为 left-origin——合法帧**可正常上 wire 并获 ACK**（drain/ACK 链路完好），但对端因 item-chain 缺口暂不 integrate（hub 值不推进），值收敛需 state-vector round diff 修复（AC-5 同款恢复 round 补齐路径）。故 D4 的活性守卫锚在 **wire 层**（合法帧在 settleUntil 预算内上 wire + ACK 闭环 + 零超限帧），值收敛不在本断言面。
- **定性**：非缺陷——设计 §17「配置保证单笔必可发送（校验侧不 clamp）」+ B-2 运维下界（lowWater/maxUpdateBytes 配置指导）已把 `maxUpdateBytes < 单笔 update` 划为配置病理面；本发现为其提供了动态实证注脚（修复 diff 含墓碑内容同样可能超限→不可依赖「后续合法项」承载修复）。**建议**：随下轮设计修订把「F4 丢弃的 round-repair 边界（含墓碑尺寸）」补入 B-2 运维登记（回流 SA1 备忘，同 SA4 F2 处置通道）。

### N3（NOTE·确认无新伤）
D1（F1 回归锚）在动态环境复证恰 1 帧 + ACK 守恒 + 释放收敛——SA4 R2 §8.2 的 E5 预演形态与 vitest 环境实测**逐值一致**；四红锚 + 73 IT 零回归（E2/E3）排除实现侧行为漂移。

---

## 5. 测试产物

| 文件 | 内容 | 状态 |
|---|---|---|
| `packages/ws-replication/test/ws-replication-sa7-issue137-dynamic.test.ts` | 7 IT（D1/D2/D3a/D3b/D3c/D4/D5）+ 本地测试基建 `bootLocal`（自定义 schema/预置压/set+delete 写助手）+ `advanceUntilReady` 分步推进 | **commit 98ffafc**（中英双语 message 引用 #137；**未 push**——SA7 无 push 权限，由总控收尾发布） |

- SA6 owned 三件（`ws-replication-issue137-ac1-ac7-red.test.ts` / `issue137-driver.ts` / `harness.ts`）**零改动**——红锚断言语义未削弱（E1 基线 4/4 独立复绿为证）。
- src/ **零触碰**（E6/E7；临时诊断日志已全部还原）。
- 红线纪律：零 real sleep（fake scheduler + 微任务 + 门闩）；零源码 grep 断言（全部 wire 帧/状态投影/持久化值/scheduler 计面）。

---

## 6. vitest 触发证据（硬门禁 #14 — 2026-06-15 立法）

**Workspace Package**: `@nomicore/ws-replication`（`packages/ws-replication/package.json` name 字段；version 0.1.1）

### 6.1 本地动态触发证据（独立进程 setsid nohup，退出码落盘）

| 用例 | 命令 | 触发结果 | log 摘录 |
|---|---|---|---|
| 基线（SA7 前） | `pnpm exec vitest run packages/ws-replication --no-typecheck` | ✓ 12 文件 77 IT 全绿 | `Test Files  12 passed (12)` / `Tests  77 passed (77)`（/tmp/sa7-r137-baseline.log；`.mabf-bg/sa7-r137-baseline-vitest.exit=0`） |
| 全量（含 SA7 新文件） | 同上 | ✓ 13 文件 84 IT 全绿（**两轮**） | `Test Files  13 passed (13)` / `Tests  84 passed (84)`（/tmp/sa7-r137-full3.log + /tmp/sa7-r137-full4.log；`.mabf-bg/sa7-r137-full3-vitest.exit=0`、`sa7-r137-full4-vitest.exit=0`） |
| 类型 | `pnpm exec tsc -p packages/ws-replication/tsconfig.json` | ✓ exit 0 | `.mabf-bg/sa7-r137-tsc5.exit=0` |

新文件在本包 runner 内真实执行：`✓ packages/ws-replication/test/ws-replication-sa7-issue137-dynamic.test.ts (7 tests)`；四红锚同 runner 复绿：`✓ packages/ws-replication/test/ws-replication-issue137-ac1-ac7-red.test.ts (4 tests)`。

### 6.2 CI 接通（静态 wiring 复核）

- `.github/workflows/ci.yml`：`test` job（node 矩阵）step `run: pnpm typecheck` + `run: pnpm test`；根 `vitest.config.ts` `include: ['packages/*/test/**/*.test.ts', ...]` —— `packages/ws-replication/test/*.test.ts`（含本新文件）直接落在 CI vitest 覆盖范围内；`pnpm typecheck` 含本包 tsconfig。与 SA4 §1.4 静态门禁结论一致（本轮独立复核）。

### 6.3 CI run log 摘录：⚠ 环境受阻（如实登记，非 verdict 下调项）

- **阻塞事实**：SA7 立法禁止 push；实测 `gh run list --branch fix/issue-137-on-docs-phase-5-websocket-replication` 为空、`git log origin/<branch>` 不存在——**该分支从未推送，commit 98ffafc 的 CI run 尚不存在**，`gh run view --log` 摘录（skill Step 4 动态门禁的 CI 侧证据）客观不可得。
- **处置**：以 §6.1 本地独立进程动态证据 + §6.2 wiring 复核作为本轮触发证据；**不宣称 CI 已绿**。总控 push 后按立法补摘（命令已备）：
  ```bash
  gh run list --branch fix/issue-137-on-docs-phase-5-websocket-replication --limit 3
  gh run view <run-id> --log --job=test | grep -E "ws-replication-sa7-issue137-dynamic|ws-replication-issue137-ac1-ac7-red|Test Files.*passed"
  ```
  预期分类：`@nomicore/ws-replication` → ✓ `Test Files 13 passed (13)`（84 IT）。

---

## 7. Verdict 与回流

**Verdict: pass**

- **D1–D5 逐项全绿**（D6 登记项确认）：F1 修复回归锚在动态环境复证（恰 1 帧 + ACK 守恒 + 收敛）；handshaking fatal 新语义锁定（恰 1 ERROR 直发）；额度耗尽三互补面（极端配置/64KiB 大控制帧/精确帧数谓词锁）全部含 1011 + backoff + 撤压重连恢复闭环；R2-N1 活性守卫（合法项同一 drain 上 wire + ACK 闭环 + 超限项零 wire 帧）；poll timer 零泄漏（pending 恰回退 1 + stale 零副作用）。
- **四红锚 + 既有 73 IT 零回归**（E1/E2/E3，两轮全绿）+ **类型干净**（E4）+ **零 unhandled rejection**（F7 运行时面）。
- **无新阻断项**：两条 NOTE（N1 测试推进范式 / N2 F4-round-repair 边界建议回流 SA1 备忘——同 SA4 F2 处置通道）均非缺陷、不阻断。
- 边界重申：本报告为动态验证（真实运行链路）；CI run log 摘录因 push 禁令受阻（§6.3），由总控发布后补摘；`pass` 不预支 AC 逐条门禁与双轴终审。

---

## 附：验证轮时间线（过程审计）

1. 基线复跑（77/77）→ 2. 新测试 v1（6/7 红：D2 帧日志 decode 撞注入坏帧 / D3a-b 大步进饿死超时 / D3c 探针写与种子值撞值 / D4 运行时整树重写特性 / D5 缺 settle 节奏）→ 3. `[SA7-DIAG]` 四轮诊断（D4 通道双 pull 实证 / D5 drain timer 实证 / D4 item-chain 特性定位）→ 4. 测试修正（safeFrames / advanceUntilReady / 探针值错开 / 可选字段+delete 构造 / ACK settleUntil）→ 5. 全量两轮 13/84 全绿 + tsc 0 → 6. instrumentation 还原 + commit 98ffafc（未 push）。
