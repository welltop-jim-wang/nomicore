# SA4 静态验尸报告 — SA3 实现（commit d183d3b，issue #112 round 2 修订轮）

**Date**: 2026-08-26
**被审对象**: `fix/issue-112-on-docs-namespace-registry` @ `d183d3b`（基线 `05cc030`；11 文件 +564/−70）
**Verdict**: **pass**

## 审核结论

1. 设计一致性：✅ 一致（§2.A/§2.B/§2.C.2/§2.C.5 与设计 R2 逐字一致；唯一偏离 = helper 参数类型
   `DocPersistence & { dispose(): Promise<void> }`，裁决**可接受**——见下「偏离裁决」）
2. 读写路径一致性：✅ 一致（service 值仍为同一 adapter 实例；无数据源变更）
3. 静默失败：✅ 无（P1→聚合错误、P2→observer 事件+移除、P3 失败→cordis `logger.error`，全响亮）
4. 降级方案：✅ 无降级路径（统一失败通道，无兜底掩盖）
5. 极端攻击：✅ 未发现漏洞（多 throw/次序/幂等/双路直调/根级全拆逐条推演，见「攻击面」）
6. 错误处理：✅ 完整（drainStep `finally` 兜底 adapter dispose；rejection 最终通道 = `_unload`
   per-disposable catch → `ctx.logger.error`，源码亲核属实）
7. 架构评估：✅ 可行（2 处 try/catch + 1 个单源 wiring helper，最小变更半径）
8. 过度设计：✅ 精简（P1 空 catch 有 SA2 验证的 floating-window 必要性；helper 消除两 Adapter
   的 wiring 重复，净复杂度不升）

---

## 1. Scope Creep Guard（§1.1）

- actual diff（`git diff --name-only 05cc030 HEAD`）= 11 文件，全部命中 ALLOW LIST：
  `registry.ts`/`plugin.ts`/`service.ts`/`memory.ts`/`file.ts`/两个 `package.json` + 4 个
  `[SA6 owned]` 测试文件。
- **DENY LIST 完好**：`lifecycle.ts`/`contract.ts`/`index.ts`/`testing.ts`（persistence）、
  `types/errors/observer/lease/testing/index/identity/create-document.ts`（registry）、
  `namespace-runtime`/`clock`/`dsh-persistence`/`vfsl*`/`doc-runtime`/`docs`/根 `package.json`/
  `.github` —— 逐一 `git diff --name-only` 过滤，**零命中**。
- BLACKLIST（package-lock/yarn.lock/.DS_Store/TASK.md/.bak）：零命中。
- **commit 干净度**：`git show --name-only d183d3b` 不含 `wiki/`（grep 计 0）、不含 `.mabf-bg`
  （grep 计 0）；`git diff HEAD -- packages/` 为空（提交态 == 工作区）；wiki 档案仅处于 staged
  未提交态（流水线台账惯例，正确）；`REPORT.md` 与 `.mabf-bg` 均 gitignored 不入 commit。

## 2. 设计逐字一致性（审查重点 1）

### 2.1 P1 runShutdown 收编段（§2.A）— ✅ 逐字一致

`registry.ts:989-1001` 与设计 §2.A 代码块逐语句相同（仅注释对齐空格差异）：发起分支
`try { promise = entry.runtime.close() } catch { promise = Promise.reject(cause);
void promise.catch(() => {}) }` → `entry.closePromise = promise` → `phase = 'closing'`。
复用分支（:986-987）、聚合循环（:1005-1014）、终态推进 `entries.clear()` +
`acceptance='stopped'`（:1016-1017）**逐字未动**。

### 2.2 P2 beginIdleClose 收编段（§2.B）— ✅ 逐字一致

`registry.ts:627-653`：ABA 守卫（:628）→ phase 守卫（:629）→ **I4 token 收缴先行（:630）** →
`try/catch` 合成 rejected closePromise（:631-638）→ **I2 先落位后翻相**（:639-640）→
`.then` 两臂同一同步段挂接（:641-652，reject 臂 = 既有 `idle-close-failed` 事件类型 +
`removeEntryAfterClose`）。四通道结构对同步 throw 同构成方。

### 2.3 P3 bindPersistenceAdapterLifecycle（§2.C.2）— ✅ 机制要件逐字一致

`service.ts:84-104`：generator effect 内 `const revoke = provideNomicorePersistence(ctx, adapter)`
→ `yield revoke`（re-parent）→ `yield drainStep`（`try { await revoke() } finally { await
adapter.dispose() }`）。**yield 序与 try/finally 形状与设计逐字相同**；R5′ 宿主接线契约段、
ADR-0006:86 + ADR-0009:103 勘误引用（SA8 非阻塞注记）均按 R2 版落纸。`memory.ts:105-111`/
`file.ts:91-96` 的 `apply` 改调 helper，`assertPersistenceHostDependencies` 先行次序保持（AC3），
label `'memory-persistence: service'`/`'file-persistence: service'` 保持，旧 import 清理同步。

### 2.4 plugin.ts（§2.C.5）— ✅ 纯注释、逐字

头注第 2 条改写（adapter 级保证 + R5′ 残余窗口段 + round 1 R1 废止声明）与设计 §2.C.5 逐字
一致；inject 行代码段 `inject: ['clock', 'timer', 'nomicorePersistence'],` **字节级未变**
（diff 的 -/+ 两行代码部分相同，仅尾注释补引）。

### 2.5 偏离裁决：helper 参数类型（SA3 申报的唯一偏离）— **可接受 ✅**

- 设计代码块写 `adapter: { dispose(): Promise<void> }`；实现写
  `adapter: DocPersistence & { dispose(): Promise<void> }`。
- **必要性实证**：`contract.ts:204` `provideNomicorePersistence(ctx, persistence:
  DocPersistence)` 形参要求 `DocPersistence`；而 `DocPersistence` 接口（contract.ts:38-42）
  仅含 `createDoc/loadDoc/saveDoc`、**无 `dispose`**——设计的裸 `{ dispose() }` 结构类型在
  `provideNomicorePersistence(ctx, adapter)` 调用点**不可赋值，无法通过 typecheck**。偏离是
  真实的 typecheck 缺口修正，非风格偏好。
- **语义中性**：类型收窄零运行时行为差异；两 Adapter 均 `implements DocPersistence` 且带
  `dispose(): Promise<void>`，满足交集类型；`index.ts` 不转出 `service.ts`（亲核），公共面
  零增量（D6）。且交集类型恰好显式表达了 helper 的真实要求（「adapter 必须是 service 值本体
  且可 dispose」），比设计原稿更精确。

## 3. 冻结语义回归面（审查重点 2）— ✅ 零回归

| 冻结面 | 核对结果 |
|---|---|
| I1（idle ⟺ 武装；shutdown 豁免窗口） | registry.ts diff 仅 2 个 hunk（`@@ -628`/`@@ -979`），武装/取消逻辑零触碰 ✅ |
| I2（closing ⟹ closePromise 定义） | **强化**：同步 throw 路径先落位（rejected Promise）后翻相，同一同步段 ✅ |
| I4（arm-token 判别） | token 收缴（:630）仍在 close 发起之前，次序不动 ✅ |
| AC9（停接纳/取消 timer/等待已接纳/不等外部 release） | runShutdown 步骤 1-2（:981-982 carrier 等待）与同步段零触碰 ✅ |
| AC10（复用/全尝试/稳定聚合） | 复用分支与聚合循环零改动；发起分支从「rejection 不跳过」强化为「同步 throw 亦不跳过」 ✅ |
| AC12（幂 same-Promise） | `shutdown()` 入口（:1056）零改动 ✅ |
| observer 事件面零扩张 | `observer.ts` 零 diff（DENY 核对）；P2 reject 臂只用既有 `idle-close-failed` 类型；P1 零新事件（维持「shutdown 不加事件」冻结） ✅ |
| runOpenSlot/runCreateSlot 零改动 | :556/:708/:778/:803 均不在 diff hunk 内 ✅ |
| ADR-0006 四约束 | lifecycle/contract/index/testing 零改动；service.ts→contract.ts 运行时导入不成环（module-graph 回归测试在全量运行中绿） ✅ |

## 4. vitest 触发性自检（§1.4，审查重点 3）— ✅ 通过

- **config 覆盖**：根 `vitest.config.ts` include = `packages/*/test/**/*.test.ts`，4 个改动
  测试文件全部命中（`packages/namespace-registry/test/*.test.ts`）。
- **CI 接通**：`.github/workflows/ci.yml` `Test` step = `pnpm test` = `vitest run
  --typecheck`（根 config），Node 20/24 矩阵；`Typecheck` step 覆盖 namespace-registry 与
  persistence 两个 tsc project。
- **本轮真实运行证据**（本 SA4 独立进程复跑，`setsid nohup` 后台执行）：
  - `pnpm typecheck` → `TYPECHECK_EXIT=0`（9 个 project 全过）；
  - `pnpm test` → **Test Files 116 passed (116)；Tests 1397 passed (1397)；Type Errors no
    errors**；`VITEST_EXIT=0`（与 SA3 申报的 1397 一致）；
  - 4 文件 verbose 定向复跑 → **43/43 绿**，逐名命中：
    `19b`（AC10 describe）、`19c`（R2 增补①）、`11b`（AC7 describe）、`11c`（R2 增补③）、
    `29`（rev1 问题 3 describe）、`SA7-P2`（改写版）——全部 ✓。
  - 文件级计数与基线吻合：shutdown 12（10+19b+19c）、idle 18（16+11b+11c）、plugin 9（8+29）、
    sa7-cordis 4（SA7-P2 原位改写）。

1.4 vitest 触发性自检结论：all-vitest-packages-triggered（packages/namespace-registry 与 packages/persistence 两包逐文件命中，4 个改动测试文件均在根 vitest config include 覆盖内且本轮真实运行转绿）

## 5. 协议假设抽查（§1.5，审查重点 4）— ✅ 通过

设计 §5 #1-#12 抽查 7 条（承重项全部亲核 cordis 4.0.1 随包 TS 源码）：

| # | 断言 | 亲核结果 |
|---|---|---|
| 1 | `_unload` 以 `Promise.all(this._disposables.clear().map(...))` 并发 | fiber.ts:675-687 逐字 ✅（含 per-disposable try/catch → `ctx.logger.error`，即 §2.C.6 最终通道） |
| 2 | provide disposer = delete store → notify → `await Promise.allSettled(fibers.map(f=>f.await()))` | reflect.ts:277-304 逐字 ✅ |
| 3 | `collect` re-parent：`disposables.push(dispose); this._disposables.delete(dispose)` | fiber.ts:447-452 逐字 ✅ |
| 4 | effect 本地 disposables `splice(0).reverse()` + `task.then(runDisposable)` 逆序串行 | fiber.ts:427-436 逐字 ✅ |
| 5 | `runDisposable`+`effectInertia` join；wrapper 已启动态两路径不 join | fiber.ts:115-121（`effectInertia.set(wrapper, ()=>inFlight)`）、wrapper 体 `if (!runner.epoch) return setupFailed ? inFlight : undefined` 亲核 ✅ |
| 8 | `saveDoc` 记账+`scheduleFlush` 即返；`releaseHandle` 不等待 flush | lifecycle.ts:277-287（async 无 await 即返）、:512-517（同步 delete+maybeEvict）亲核 ✅；dispose 幂等分支（:315-318）亲核 ✅ |
| 12 | 真实 timer `timeout` 经 `this.ctx.effect` 绑调用方 fiber；UNLOADING 态 `effect()` throw `INACTIVE_EFFECT` | cordis-plugin-timer/src/index.ts:33-42 逐字 ✅；fiber.ts:418-421 throw 分支亲核 ✅；utils.ts:163-170「side effects bind to caller, not origin」逐字 ✅；fake seam（testing.ts）纯箭头函数零 ctx.effect ✅ |

（#6 = 缺陷本体已替换；#7 = plugin.ts:170-190 先例在实现中亲见；#9 = Node 官方文档语义；
#10/#11 = typecheck 全过 + 先例运行佐证。）

1.5 协议假设审查结论：protocol-assumption 全部成立（设计 §5 #1-#12 承重项抽查经 cordis 4.0.1 源码逐字亲核属实）

## 6. 契约改动连锁（§1.6）— ✅ 通过

- `runShutdown`/`beginIdleClose` 均为内部函数，不导出；`shutdown()` 对外契约
  （`Promise<void>` / reject `NamespaceRegistryShutdownError` / same-Promise）**不变**。
  生产唯一 caller `plugin.ts:182` `await registry.shutdown()` 位于 try/finally 有序 disposer
  内，rejection 归 cordis `_unload` catch → logger（源码亲核）。P1 实际上是把「裸原因
  reject」收窄为「聚合错误 reject」——caller 可见变化为 narrowing，零新增通道。
- `beginIdleClose` 唯一 caller（timer 武装闭包）：修复后回调零逃逸，无需 caller 防御。
- `apply` 签名不变；caller = 两个 plugin 工厂（memory.ts:147/file.ts:166）+ dsh profile 直调
  —— profile 形态（先 `persistence.dispose()` 后 `ctx.fiber.dispose()`）下 drainStep 的
  `adapter.dispose()` 命中 lifecycle 幂等分支（亲核 :315-318），无挂起、语义零变化；
  `createNamespaceRegistryPlugin` 仓内无 registry 包外消费方（grep 实证）→ R1′ 边界成立。
- `bindPersistenceAdapterLifecycle` 不经 `index.ts` 转出——公共 API 面零增量。

## 7. 测试质量（§1.7）— ✅ 通过

- 4 个测试文件 `readFileSync` 计数 = 0；全部断言为运行时行为（探针事件序、closeCalls 计数、
  getStatus、loadCalls、unhandledRejection 探针、service 在场性）——零源码文本断言。
- SA6 红灯契约（19b/11b/29/SA7-P2）断言逻辑与交付一致（逐条对照 SA6 契约文档）；SA7-P2 的
  「close 撞已销毁 handle → 聚合失败」旧假设已按要求删除，聚合通道覆盖由 15a/18/19/27 保持
  （全量绿佐证，D7）。SA3 追加的 19c/11c 属设计 §7「R2 增补测试思路」明文授权的可选项
  （「落地与否由 SA3/SA6 裁量」），非越权改写。
- 确定性保持：fake scheduler / deferred gate / 显式微任务展开，零 real sleep。

## 8. 攻击面推演（静态）

- **P1 多 throw / 混合失败**：19c 锚定（failures.length===2、插入序、恰一次、frozen、stopped、
  零 unhandled）；混合（sync throw + rejection）共用聚合循环，同构。
- **P1 floating window**：`void promise.catch(()=>{})` 同步段挂接——rejected Promise 出生即
  handled，聚合 `await` 为第二 handler（合法）；该防御在任意 entries 次序下必要（SA2 已独立
  复核，本 SA4 认同其论证）。
- **P2 reject 臂副作用**：`dispatchObserver` 被 observer.ts:53-63 try/catch 隔离（亲核），
  sink throw 不沿 then 臂传播；`removeEntryAfterClose` = removeOnlySelf 双守卫（identity+
  generation），旧 generation completion 不误删新 entry。
- **P3 挂起/死锁**：被等者（依赖 fiber 卸载）由等待发起者（notify）启动，无环；drainStep
  失败 → finally 兜底 dispose → 串行链 rejected → 链尾 revoke `.then` 短路 → wrapper
  disposalTask reject → `_unload` catch → logger（响亮）。无依赖 fiber 时
  `allSettled([])` 即 settle，无挂起（persistence 94 用例全绿佐证）。
- **双路直调**：宿主先 `adapter.dispose()` 再拆 fiber → drainStep 命中 `closed` 幂等分支。
- **root 全拆**：fiber `inertia` 单实例 join（fiber.ts 亲核），无重入。

## 9. 非阻塞备注（无需行动）

1. `beginIdleClose` 函数级文档注释（registry.ts:618-626）仍保留 rev1 前措辞「① 先取得 close
   Promise」——函数内行内注释已更新为收编语义，函数头注释未同步。纯注释措辞滞后，设计未
   强制要求，不构成偏离。
2. memory.ts/file.ts 的 diff 行数（13/12 行）超出 ALLOW LIST 软预算「≤8 行」——超出部分为
   import 多行重排与一条注释；文件与改动内容均在 ALLOW LIST 语义内，非 scope creep。
3. 设计 §7 R2 可选增补的「effect-faithful timer stub」（R5′ 残余窗口契约测试）未落地——
   明文可选，SA3 已落地 19c/11c 两项。R5′ 现仅以契约注记（plugin.ts/service.ts）+ 设计文本
   承载，交 SA7 动态面。

## 动态审核重点（交 SA7）

1. **R5′ 生产 timer 残余窗口的动态证实**（最高优先）：真实 TimerService + gated drain 拓扑下，
   窗口内到达 saveDoc 的在途写是否按声明 reject（cause = `CordisError('INACTIVE_EFFECT')`
   或稳定形态）且交付写调用方；close barrier/shutdown 终态是否不受影响（resolve undefined）；
   次序契约（`registry-shutdown-settled` < `persistence-adapter-disposed`）在真实 timer 下是否
   保持（SA2 实验 1 已在未装 timer 的真实 cordis 下证实次序，本项补 timer 在场的联合形态）。
   fake-timer seam 对该窗口结构性失明——本轮 4 红灯转绿不构成其证据。
2. **Node 20/24 CI 矩阵**（AC13）：本 SA4 本地仅能复跑单版本全量（1397 绿 + typecheck 0），
   双版本矩阵须由 CI 观测确认（SA7 摘录 `gh run view --log` 的 4 文件触发证据）。
3. **重复卸载恰一次**：`memoryFiber.dispose()` 重入/根级全拆下 `persistence-adapter-disposed`
   探针仍恰一次（join 语义）——静态已证，动态抽查。
4. **dsh-persistence profile 直调路径烟囱**：`persistence.dispose()` 先行 + fiber 后拆的宿主
   编排在真实 profile 下零挂起、零重复副作用。

---

## 验证证据（SA4 独立执行，后台独立进程 setsid nohup）

```bash
cd /home/wangjian/nomicore-fix-issue-112
# 1) 范围与干净度
git show --name-only --format= d183d3b          # → 11 文件，全在 ALLOW LIST；wiki/.mabf 计 0
git diff HEAD -- packages/                      # → 空（提交态 == 工作区）
git diff 05cc030 HEAD --name-only -- <DENY…>    # → 空（DENY 全部完好）
# 2) typecheck + 全量测试（1397）
pnpm typecheck                                  # → TYPECHECK_EXIT=0
pnpm test                                       # → Test Files 116 passed (116)；Tests 1397 passed (1397)；Type Errors: no errors；VITEST_EXIT=0
# 3) 4 文件 verbose 定向（6 用例逐名转绿证据）
pnpm exec vitest run <4 files> --reporter=verbose
# → 19b ✓ / 19c ✓ / 11b ✓ / 11c ✓ / 29 ✓ / SA7-P2 ✓；Tests 43 passed (43)；EXIT=0
# 4) 协议假设源码亲核（cordis 4.0.1 随包 TS 源码）
sed -n '675,690p' …/cordis/src/fiber.ts         # → _unload Promise.all + per-disposable catch→logger
sed -n '277,304p' …/cordis/src/reflect.ts       # → provide disposer 逐字
sed -n '415,455p' …/cordis/src/fiber.ts         # → UNLOADING throw + reverse 串行链 + collect re-parent
sed -n '110,125p' …/cordis/src/fiber.ts         # → runDisposable + effectInertia join
sed -n '33,45p' …/cordis-plugin-timer/src/index.ts  # → timeout 经 this.ctx.effect
sed -n '160,172p' …/cordis/src/utils.ts         # → "side effects bind to caller, not origin"
# 5) 偏离必要性
grep -n "provideNomicorePersistence" packages/persistence/src/contract.ts  # → :204 形参 DocPersistence
grep -n -A4 "export interface DocPersistence" … # → :38-42 无 dispose → 设计原稿类型不可过 typecheck
```

**Verdict: pass** —— SA3 实现与设计 R2 逐字一致（唯一申报偏离经裁决可接受），冻结语义零回归，
触发面实证接通，协议假设承重项全部源码亲核属实。SA7 可进入动态验证（重点见上节）。
