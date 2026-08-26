Verdict: pass

# SA7 动态验证报告 — issue #112：idle retention / Cordis plugin / ordered shutdown

- **Date**: 2026-08-27（SA7 轮）
- **验证对象**: `packages/namespace-registry` worktree `/home/wangjian/nomicore-fix-issue-112`（branch `fix/issue-112-on-docs-namespace-registry`），SA3 实现未提交工作区（基线 e1efbbe + #112 全部改动）。
- **Step 0 前置校验**: `task_registry-idle-plugin-shutdown_sa4_review.md` 首行 `Verdict: pass` → SA7 进入动态验证（不上发不下发原则保持）。
- **Step 1（SA6 红灯现状）**: SA6 34 用例经 SA3 实现全部转绿——目标套件 `pnpm exec vitest run packages/namespace-registry --typecheck` = **8 文件 / 137 用例 / Type Errors 0 / EXIT=0**（`/tmp/sa7-baseline.log`，独立后台进程亲跑）。
- **方法**: 8 个手工变异逐个 apply→定向 vitest→还原（备份件 sha256 校验，**非** `git checkout`——#112 实现本身未提交）；14 个补充攻击用例（3 新文件，§9 登记）；Node 24 本机 + Node 20 真实容器实跑；全部测试命令独立后台进程；零端口占用（纯 vitest 单元包，fuser 规则 N/A）。

---

## 1. 变异抽查（攻击面 1）——杀伤率 **6/8（基线）→ 7/8（补充 SA7-H6 锚后）**，残 1 为等价变异

每个变异单独应用 → `pnpm exec vitest run packages/namespace-registry --typecheck`（全套件）→ 记录红/绿 → 备份件还原（还原后 sha256 逐轮校验一致 `5fb16442…d1ea`）。

| # | 变异 | 预期红 | 实际（被杀？） | 杀伤它的测试 |
|---|---|---|---|---|
| a | arm-token 首查删除（`if (entry.idleTimerHandle !== handle) return;` 移除） | 3a/15a | ** Killed**：exit=1，恰 2 红 | idle **3a**（旧回调 no-op）+ shutdown **15a**（取消后旧 fire）——与预测逐字吻合 |
| b | `beginIdleClose` ② 赋值/③ 翻相次序颠倒 | I2 相关断言 | **Survived（等价变异，实证见下）**：137/137 全绿 | 无（不可杀伤——两相邻同步属性写零交错点） |
| c | `handleLeaseReleased` 的 `entry.leases.size !== 0` 早退删除 | 多 lease 场景 | **Killed**：exit=1，恰 2 红 | idle **1**（双 lease 首释放后 `pending()===0`）+ **6**（同场景回归）——多 lease 红灯在案 |
| d | shutdown 同步段不取消 idle timer | 15 | **Killed**：exit=1，恰 2 红 | shutdown **15**（`pending()===0`）+ **15a**（adversarial 聚合不重复） |
| e | runShutdown 枚举跳过 closing entry（不复用 closePromise） | 18/23 | **Killed**：exit=1，恰 1 红 | shutdown **18**（SA6 编号 23 = 同一用例：复用在途 close + 聚合恰一次） |
| f | 聚合失败首败即 throw（不尝试其余） | 19 | **Killed**：exit=1，4 红 | shutdown **19**（三 key 聚合形状/第三 key 仍被试/status stopped）+ 15a/18/20 连带红 |
| g | acceptance 门从公共入口移回槽内 | 14 | **Killed**：exit=1，恰 1 红 | shutdown **14**（Proxy trap 零执行——身份校验被触发即 trap 计数 >0） |
| h | getStatus 返回新冻结对象（弃常量纪律） | 观测是否有锚 | **基线 Survived（无锚盲区）→ 补充 SA7-H6 锚后 Killed** | 补充用例 **SA7-H6**（跨调用/跨相位/跨实例 `toBe` 身份锚 + `Object.isFrozen`）——应用变异 h 单跑 hostile 文件：SA7-H6 红、exit=1（`/tmp/sa7-mutation/mut-h-anchor.log`） |

**变异 b 等价性实证（临时探针，用后已删、未登记）**：契约外敌意 Runtime（`close()` 同步 throw）下对比原始 vs 变异 b——两侧可观测结局**完全一致**（timer 回调栈异常上抛、entry 停留 idle、随后同 key create 均得 `NAMESPACE_ALREADY_EXISTS`；`close()` 的调用点在 ②③ 之前，两写次序对 throw 路径亦无差）。契约内路径两写处于同一同步段、零观察边界。结论：**结构等价变异，非测试盲区**；与 SA4 OBS-1（sync-throw close 属 seam 契约外）互证。

- 日志：`/tmp/sa7-mutation/mut-{a..h}.log`、`mut-h-anchor.log`、`results-a-d.txt`、`results-e-h.txt`。
- 意外全绿盘点：仅 b（等价）与 h（盲区→已补锚）。**无未解释的测试盲区。**

## 2. 并发压力（攻击面 2）——`registry-sa7-concurrency.test.ts` 4/4 绿

| 用例 | 场景与结果 |
|---|---|
| SA7-C1 | 单 key 同 tick **100 次并发 open**：`loadCalls===1`（carrier FIFO 串行、active 复用）→ 交错释放 50 + 并发重 open 50（`pending()===0`，部分释放不武装）→ 全释放（`pending()===1`、entry-idle 恰 1）→ advanceBy(300_000) **close 恰 1 次** → 再 open 全新 generation（loadCalls=2）→ 二代亦收口（close 共 2 次，各自恰 1）；零 unhandled rejection |
| SA7-C2 | **50 key 并行** open→（倒序交错）release→idle（`pending()===50`）→ **一次 advanceBy 齐发 50 个到期回调**：每 runtime close 恰 1、全部 entry 清理（50 key 再 open 全新 loadDoc=2/载、第二代 50 新 runtime、一代不重复 close）；零 unhandled |
| SA7-C3 | **shutdown 与 50 个在途 open 竞态**（共享 load gate）：gate 期间 `shutting-down` 可观测、shutdown 不 settle、新 open 得 `REGISTRY_NOT_ACCEPTING`；放行后 **50 个在途 open 全部完整结算 ok（绝非 NOT_ACCEPTING 折损）**、50 个 Runtime 全被 shutdown 关闭（各恰 1 次）、shutdown resolve undefined、status stopped、重复调用 same-Promise；零 unhandled |
| SA7-C4 | **确定性三轮复跑**：50 key 全流程 ×3 轮，canonical digest（逐 key loads/release/observer 事件全序 + close 计数串）**逐字节一致**（`digests[1]===digests[0]===digests[2]`）；零 unhandled |

## 3. 敌意注入（攻击面 3）——`registry-sa7-hostile.test.ts` 6/6 绿

| 用例 | 攻击与结果 |
|---|---|
| SA7-H1 | **scheduler.setTimeout 重武装时同步 throw**（idle-arm-failed 通道的重武装变体，补 SA6 测试 14 首装失败之外的面）：首装成功→激活复用→再释放 throw → observer exact cause 恰 1、entry 停留 active（再 open 零 loadDoc 复用）、release same-Promise 不破、shutdown 兜底 close 恰 1 |
| SA7-H2 | **违约 scheduler 同 callback 双重/三重 fire**：gate 挂起变体（第一次 fire 建立 closing、entry 仍在 map，第二/三次 fire no-op）+ 立即 settle 变体（settle 前后连发）——两变体 `closeCalls` 恒 1、零 idle-close-failed 误报、close settle 后零污染（再 open 全新 loadDoc）；零异常零 unhandled |
| SA7-H3 | **observer 每事件 throw**：open→read→release→idle→advance→close→再 open→再收口→shutdown 全链公开结果不变（issue/lease/getStatus 全部如常）、`closeCalls` 精确、零 unhandled（dispatchObserver 隔离实证） |
| SA7-H4 | **close 永不 settle（withTimeout 探针，经注入 scheduler 实现、零 real timer）**：后续同 key open = closing-wait 纯等待（探针 `timeout`、零第二次 loadDoc）；shutdown 同样纯等待（探针 `timeout`、status 停留 shutting-down、幂等 same-Promise）；零 unhandled——R3「等待而非崩溃」契约的动态证明 |
| SA7-H5 | **Clock.now 回跳**（每次读数 −60s）：idle 窗口纯由 scheduler 计时——advanceBy(299_999) 零 close、再 1ms 恰 close（回跳既不提前也不推迟）；create 在回跳时钟下照常（ok:true、createCalls=1，单次读数无单调校验） |
| SA7-H6 | **getStatus 冻结常量身份锚**（mutation h 杀伤锚，设计 §2.E）：running/shutting-down/stopped 三相各自跨调用 `toBe` 同一实例 + `Object.isFrozen` + 跨两实例共享同一模块级常量 + 相位间互为不同常量 |

## 4. Cordis 组合动态（攻击面 4；SA4 §7 交验事项 2/3）——`registry-sa7-cordis.test.ts` 4/4 绿

| 用例 | 场景与结果 |
|---|---|
| SA7-P1 | **真实 `new Context()` 完整装配→工作→根级 dispose**（manual clock + fake timer + persistence 服务 + registry plugin）：create→read({n:42})→release（idle 武装 pending=1）→ `ctx.fiber.dispose()` → idle timer 被**取消**（pending=0，非到期触发）、runtime close 恰 1、service/instance 全回收、status stopped、**零 unhandled rejection 探针** |
| SA7-P2 | **persistence fiber 先 dispose（R1 残余并发通道）**：close 写排空撞「已销毁 handle」（release reject）→ 依赖级联触发 registry fiber 卸载 → **聚合错误通道真实工作**：held instance 经 AC12 幂等 same-Promise 取回 `NamespaceRegistryShutdownError`（failures=1、cause 链 `NSRT-CLOSE-RELEASE-FAILED` + `.cause===原始 release 异常`）；旧实例 stopped（失败不回滚）、plugin.instance 回收、registry fiber PENDING（可重载）、零 unhandled。→ SA4 §7.3 交验事项确认：**该通道在 fiber 级 R1 场景下确实工作** |
| SA7-P3 | **registry plugin reload**：撤 persistence 服务 → 旧 Registry 实例 shutdown（stopped、带存活 lease 照常关闭）、fiber PENDING；重提供（新 persistence 实例）→ fiber 转 ACTIVE、**全新 Registry 实例**（≠旧、service/instance 换新、running、经新服务 open/read/release 可用）；旧 lease 回收后幂等不炸；零 unhandled |
| SA7-P4 | **烟囱用例（唯一 real native timer + real sleep 40ms，文件内已注明）**：真实 cordis-plugin-timer `TimerService`（native setTimeout）+ `idleTimeoutMs=10`；arm(T1)→open 激活取消→重武装(T2 完整窗口) 交错后 native 到期 **close 恰 1 次**（releaseCalls=1、loadCalls=1——T1 真被取消）；close 后 entry 清理（再 open loadCalls=2）；零 unhandled。→ SA4 §7.2 交验事项：native timer 交错的最小生产形态证据 |

## 5. Node 版本验证（攻击面 5；SA4 §7 交验事项 1）

| 环境 | 命令 | 结果 |
|---|---|---|
| 本机 Node **24.13.0** | 全部门禁（§6） | 全绿 EXIT=0 |
| **Node 20 真实容器**（`docker run node:20-slim`，v20.20.2，非 root uid=1000，corepack pnpm@10.28.2 与 packageManager 钉版一致） | `pnpm exec vitest run packages/namespace-registry --typecheck` | **10 文件 passed + 1 skipped；149 用例 passed + 2 skipped；Type Errors 0；EXIT=0**（`/tmp/sa7-node20.log`） |
| 同上 | 全量 `pnpm test` | **115 passed + 1 skipped（116）；1390 passed + 2 skipped（1392）；Type Errors 0；EXIT=0**（`/tmp/sa7-node20-full3.log`） |
| 同上 | `pnpm typecheck`（九包 tsc 链） | **EXIT=0**（`/tmp/sa7-node20-typecheck.log`） |

- **2 个 skipped = `registry-node-dispose.test.ts` 的既定条件跳过（#110 冻结策略，非 #112 回归）**：实测 Node 20.20.2 `Symbol.asyncDispose` **存在**（symbol）但 `await using` **语法**不可用（V8 11.3，`new Function` 编译 throw → 按用例内 `run()` 条件 skip）。
- **静态核验**：src 零 `await using`（仅 types.ts:259 注释提及）；零 Node 22+ 专属 API（`Promise.withResolvers`/`structuredClone`/`fromAsync`/`toSorted`/`groupBy`/`findLast`/`Symbol.dispose` 全仓 src grep 零命中）；运行期唯一新依赖 `Symbol.asyncDispose`（types.ts:268）在 20.20.2 实测在场。
- **环境对照实验（root 伪差异排除）**：容器默认 root 下全量测试有 3 个 `packages/persistence/test/` chmod 失败注入用例红——以 **node:24-slim root 对照复现同样 3 红**（root 无视权限位），且同为 Node 20 非 root 全绿 → 判定为 docker-root 环境伪迹，**非 Node 20 兼容性问题、非 #112 范围**。
- CI 矩阵（ci.yml `node: [20, 24]`，Typecheck+Test 两 step）的发布侧 run 日志摘录属 PR 阶段（SA7 不 push、不宣称 CI 绿）；本节以 Node 20 真实容器实跑承担本地侧矩阵证据。

## 6. 门禁复跑（攻击面 6，独立后台进程，exit 码亲记）

| 门禁 | 命令 | 结果 | 退出码 |
|---|---|---|---|
| 目标套件（含 SA7 新增 3 文件） | `pnpm exec vitest run packages/namespace-registry --typecheck` | **Test Files 11 passed (11)；Tests 151 passed (151)；Type Errors no errors** | **0** |
| 全仓 | `pnpm test`（Node 24） | **Test Files 116 passed (116)；Tests 1392 passed (1392)；Type Errors no errors** | **0**（`/tmp/sa7-gate-fulltest4.log`） |
| 类型 | `pnpm typecheck`（Node 24，九包链） | 全过 | **0**（`/tmp/sa7-gate-typecheck.log`） |
| 全量测试文件类型（权威 checker） | `pnpm exec tsc -p tsconfig.typecheck.json --noEmit` | 零错误 | **0** |
| 全仓（Node 20 容器） | `pnpm test` | 115+1 skipped / 1390+2 skipped / TS 0 | **0** |

（过程注记：首轮并行跑门禁时 vitest 报 6 个 `onTask-worker: Timeout calling "onTaskUpdate"` RPC 伪迹——纯 CPU 争用，串行复跑全净；且首轮暴露出 SA7 自身新测试文件的 4 个类型错误——已修复并复绿，见 §8 OBS-3。）

## 7. 确定性复跑（攻击面 7）

namespace-registry 套件连跑 3 次（含 SA7 新增文件）：`Test Files 11 passed (11)` / `Tests 151 passed (151)` / `Type Errors no errors` / `EXIT=0` **逐轮一致**；逐文件结果（剥离时长后排序的 canonical 输出）**run1==run2==run3 逐字节一致**（diff 空）。未排序 diff 的唯一差异 = 并行 worker 的文件完成顺序（非结果差异）。

## 8. 发现分级

### HIGH：0
### MEDIUM：0
### MINOR：0

**实现（src/）真实缺陷：0** —— 8 变异中 6 个被既有 SA6/SA4 套件精确杀死、攻击面 2-4 共 14 个敌意/压力场景全部按冻结设计行为通过、双 Node 门禁全绿。**不退回 SA3。**

### OBSERVATION：3

- **OBS-1（等价变异记录）**：变异 b（`beginIdleClose` ②/③ 次序颠倒）经契约内 + 契约外（sync-throw close）双路实证**结构等价**（两相邻同步属性写、零交错点；`close()` 调用先于两写）。不构成测试盲区；如未来在 ②③ 之间插入任何可观察语句（observer/await），须同步补 I2 时序锚。
- **OBS-2（既有盲区→已补锚）**：变异 h 揭示 §2.E「恒冻结常量」纪律在 #112 套件中只有 `toEqual` 值锚、无身份锚（全部 `getStatus()` 断言为 `toEqual`）。SA7-H6 补 `toBe` 身份 + `Object.isFrozen` + 跨实例锚后变异 h 被杀（已验证：应用 h → SA7-H6 红）。
- **OBS-3（流水线注记，供总控/后续 SA 参考）**：`pnpm exec vitest run <pkg> --typecheck` 的 vitest checker 只覆盖 `typecheck.include`（`*.test-d.ts`），**不检查普通 `*.test.ts`**；测试文件的权威类型门禁 = 全量 `tsc -p tsconfig.typecheck.json` / 全量 `pnpm test`。SA7 首轮 3 个新文件曾带 4 个类型错误在 scoped run 下「假绿」，被全量门禁抓出后修复（KEYS[0] noUncheckedIndexedAccess 收窄 ×3、`lease.read()` 缺 path 参 ×1）。另两条环境注记：docker 默认 root 使 chmod 失败注入伪红（node:24 root 对照证实）；vitest RPC `onTaskUpdate` 超时在并行门禁争用下出现——门禁须串行跑。

## 9. 补充用例登记（test/ 新文件 ×3，共 14 用例；零 src/、零既有测试文件改动）

| 文件 | 用例（it 名前缀） | 锚点 |
|---|---|---|
| `packages/namespace-registry/test/registry-sa7-concurrency.test.ts` | **SA7-C1** 单 key 100 并发 open + 交错 release/重 open | loadCalls===1 / pending 计数 / entry-idle 恰 1 / close 恰 1 |
|  | **SA7-C2** 50 key 并行全流程 | 每 key loads/close 计数、一次 advanceBy 齐发 50 close |
|  | **SA7-C3** shutdown × 50 在途 open 竞态 | 在途槽全 ok、50 close、resolve undefined、same-Promise |
|  | **SA7-C4** 三轮 digest 逐字节一致 | canonical digest toBe |
| `packages/namespace-registry/test/registry-sa7-hostile.test.ts` | **SA7-H1** 重武装 setTimeout throw | idle-arm-failed exact cause 恰 1 / active 复用零 loadDoc |
|  | **SA7-H2** 同 callback 双重 fire（两变体） | closeCalls 恒 1 / 零 idle-close-failed / 零污染 |
|  | **SA7-H3** observer 每事件 throw | 公开结果不变 / 零 unhandled |
|  | **SA7-H4** close 永不 settle + withTimeout 探针 | 探针 timeout（等待非崩溃）/ 幂等 same-Promise |
|  | **SA7-H5** Clock.now 回跳 | scheduler 边界 299_999+1 / create 照常 |
|  | **SA7-H6** getStatus 冻结常量身份锚 | toBe 跨调用/相位/实例 + isFrozen（mutation h 杀伤锚） |
| `packages/namespace-registry/test/registry-sa7-cordis.test.ts` | **SA7-P1** 完整装配→根级 dispose | pending 0（取消非到期）/ close 1 / 零 unhandled |
|  | **SA7-P2** persistence 先 dispose（R1 通道） | 聚合 ShutdownError + NSRT-CLOSE-RELEASE-FAILED cause 链 + PENDING |
|  | **SA7-P3** plugin reload | 旧实例 stopped / 新实例 running 可用 / instance 换新 |
|  | **SA7-P4** 烟囱（real native timer，已注明） | native 到期 close 恰 1 / 取消真实生效 / entry 清理 |

（另：变异 b 探针为临时文件，验证后已删除、未登记。）

## 10. 证据索引

- 变异：`/tmp/sa7-mutation/`（`registry.orig.ts` 备份 + `mutate.py` + `mut-{a..h}.log` + `mut-h-anchor.log` + `results-*.txt`；每轮还原 sha256 `5fb16442…d1ea` 校验）。
- 攻击套件：`/tmp/sa7-attack-first.log`（首轮，3 个 SA7 侧测试 bug）/ `/tmp/sa7-attack-second.log`（修复后 14/14 EXIT=0）。
- Node 24 门禁：`/tmp/sa7-baseline.log`、`/tmp/sa7-gate-fulltest4.log`（EXIT=0）、`/tmp/sa7-gate-typecheck.log`（EXIT=0）。
- Node 20：`/tmp/sa7-node20.log`（包级 EXIT=0）、`/tmp/sa7-node20-full3.log`（全量非 root EXIT=0）、`/tmp/sa7-node20-typecheck.log`（EXIT=0）、`/tmp/sa7-node24root-persist.log`（root 伪迹对照）。
- 确定性：`/tmp/sa7-determinism-{1,2,3}.{log,norm,sorted}`（排序后逐字节一致）。
