# SA6 红灯契约 — issue #112 round 2 修订轮（3 项 spec 缺陷）

> 交付：红灯回归测试 + 真实红灯运行证据。当前实现（fix/issue-112-on-docs-namespace-registry，
> PR #126 全绿基线）下 4 个新增/改写用例全部失败（红）；修复后应转绿。
> 只改 `packages/namespace-registry/test/` 下文件；**未改任何 src**（含 persistence src——
> 问题 3 的次序测试完全基于 plugin/编排可观测面设计）。

## 测试清单

| 用例 | 文件 | 缺陷 | 契约锚点 |
|---|---|---|---|
| `19b. rev1 问题 1：首个 close 同步 throw 被收编……` | `test/registry-shutdown.test.ts`（AC10 describe） | 问题 1 runShutdown 关闭发起段 | ① 后续 Runtime 全部被尝试关闭（closeCalls）；② entries 清空、getStatus 推进 `stopped`；③ 错误聚合为 `NamespaceRegistryShutdownError` 且 failures 收录同步 cause（与 rejection 同构） |
| `11b. rev1 问题 2：idle close 同步 throw……` | `test/registry-idle.test.ts`（AC7 describe） | 问题 2 beginIdleClose | ① 异常不逃出 timer 回调（advanceBy 不 reject）；② observer `idle-close-failed` exact cause 恰一次；③ entry 移除 → 后续 open 全新 generation（loadDoc 计数证明）；④ 零 unhandled rejection（collectUnhandledRejections 探针） |
| `29. rev1 问题 3：裁撤 persistence fiber 级联……` | `test/registry-plugin.test.ts`（新 describe） | 问题 3 plugin 顺序契约 | `registry-shutdown-settled` 严格先于 `persistence-adapter-disposed`（开始+完成双探针、恰一次）；旧实例 stopped/service 撤销/registry fiber PENDING；无 close 聚合失败；零 unhandled rejection |
| `SA7-P2 …（改写）` | `test/registry-sa7-cordis.test.ts` | 问题 3（旧假设删除） | 同上次序契约（SA7 套件视角）；**移除** round 1 的「close 撞已销毁 handle → 聚合失败」固化预期 |

### 注入面与技术（全部确定性，零 real sleep）

- 问题 1/2：testing seam（`createNamespaceRegistryForTesting` + `runtimeFactory` stub，
  `ObservableRuntime.close()` 新增 `syncThrowWith` 同步抛错路径）+ `createRegistryTestScheduler`
  fake 调度 + deferred gate + 显式微任务展开。既有 `collectUnhandledRejections` 探针沿用。
- 问题 3：真实 Cordis `new Context()` + `createManualClockPlugin` + `createFakeTimerPlugin` +
  **真实** `createMemoryPersistencePlugin` + `createNamespaceRegistryPlugin`（真实 runtime）。
  - **adapter dispose 探针**：`createMemoryPersistencePlugin().instance` 的 `dispose`/`saveDoc`
    以实例级影子方法替换——effect disposer 的 `this.dispose()` 在卸载时点动态解析，探针
    必被捕获（零 src 改动）。
  - **窗口拉开（确定性）**：`lease.mutateRoot` 接受一个写 → 写槽 S6 同槽 `await notifyDirty`
    （= `persistence.saveDoc(handle)`）经影子 `saveDoc` 挂起在 deferred gate 上 → Runtime
    close 排空（barrier 排在写槽之后）严格挂起 → `registry.shutdown()` 经 AC12 same-Promise
    挂接 settle 探针（沿用测试 25「窗口拉开」手法）→ 裁撤 memory fiber → 级联卸载期间
    adapter dispose 与 registry shutdown 的历史并发点被探针次序直接暴露。

## 红灯运行证据（当前实现）

```bash
# 命令 1：目标 4 文件（基线先行）
cd /home/wangjian/nomicore-fix-issue-112 && pnpm exec vitest run packages/namespace-registry/test/registry-shutdown.test.ts packages/namespace-registry/test/registry-idle.test.ts packages/namespace-registry/test/registry-plugin.test.ts packages/namespace-registry/test/registry-sa7-cordis.test.ts
# 基线（改动前）：4 文件 38 通过，exit 0
# 改动后：Tests  4 failed | 37 passed (41)，exit 1

# 命令 2：全包回归
pnpm exec vitest run packages/namespace-registry/test/
# Test Files  4 failed | 7 passed (11)   Tests  4 failed | 150 passed (154)，Type Errors: no errors
```

失败明细（4/4，与缺陷机理逐条对应）：

1. **19b（问题 1）**：
   `AssertionError: expected Error: shutdown-close-sync-throw-19b to be an instance of NamespaceRegistryShutdownError`
   —— 同步 throw 作为裸原因逃出 runShutdown，未聚合；`entries.clear`/`stopped`/后续 close
   均未到达（停在该行断言，与 runShutdown 首抛即中断枚举的实现完全一致）。
2. **11b（问题 2）**：
   `expected 'rejected:Error: idle-close-sync-throw…' to be 'settled'`（Received:
   `rejected:Error: idle-close-sync-throw-11b`）
   —— 同步 throw 逃出 fake timer 回调（`advanceBy` 拒绝）；observer 事件、entry 移除、
   新 generation 断言未到达（beginIdleClose 在 `runtime.close()` 处逃逸）。
3. **29（问题 3）**：
   `expected 2 to be less than 0`（events = `['persistence-adapter-disposed',
   'persistence-adapter-disposed-complete', 'registry-shutdown-settled']`）
   —— 写排空窗口内 adapter dispose **开始且完成**均早于 `registry-shutdown-settled`
   （即 shutdown 挂起期间 adapter 已销毁 = 设计 §8 R1 残余并发，round 2 契约违规）。
4. **SA7-P2（改写）：** 同 3：`expected 2 to be less than 0`（事件序相同）。

旁证（红点为真、窗口真实）：两用例在级联前的
`expect(shutdownSettled).toBe(false)` 均通过（shutdown 严格挂起于门控写排空）——adapter
dispose 是在 shutdown 未 settle 时发生的，无时序侥幸。

## 覆盖/边界说明

- **AC10 聚合错误通道锚定未丢失**：NSRT-CLOSE-RELEASE-FAILED 聚合仍由既有用例锚定
  （registry-shutdown.test.ts 15a/18/19 的 reject 路径、registry-plugin.test.ts 27），
  与 SA7-P2 删除的「撞已销毁 handle」假设解耦。
- **问题 3 无需改 persistence src**：adapter dispose 探针经插件工厂 `instance` 影子方法
  观测；「次序违规」经持久化编排面（真实 plugin/真实 runtime/真实 adapter）暴露。
  断言全部是运行时行为（探针事件序、状态、service 在场性、无 unhandled），零源码文本断言。
- **确定性**：fake scheduler / deferred gate / 显式微任务展开，零真实 sleep（SA7-P4 既有
  烟囱用例的 40ms real sleep 不在本次改动范围）。
- 修改文件：`test/registry-shutdown.test.ts`（+19b）、`test/registry-idle.test.ts`（+11b）、
  `test/registry-plugin.test.ts`（+29）、`test/registry-sa7-cordis.test.ts`（SA7-P2 改写）。
  未改 src、未加依赖、未动 scripts/test-lock.sh（无新端口/包依赖）。
