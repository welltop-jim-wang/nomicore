# 任务简报（Round 2 修订）— namespace-registry：idle retention、Cordis plugin 与 ordered shutdown（issue #112）

## 任务身份

- repo: welltop-jim-wang/nomicore，issue #112，PR #126
- worktree: /home/wangjian/nomicore-fix-issue-112
- branch: fix/issue-112-on-docs-namespace-registry
- run_id: issue-112-1787739744-862383
- round: 2（spec 审查修订轮）
- 任务类型: Bug 修复（spec 审查裁定的 3 项高风险缺陷）
- 上一轮档案: wiki/raw/task_registry-idle-plugin-shutdown*.md（round 1 全流水线产物）

## 背景

PR #126 CI 已全绿，但 spec 审查提出 3 项高风险问题。本轮必须在本分支修复并补回归测试，
同时保持 issue #112 全部 13 条验收标准（见下）不回归。

## 问题 1：shutdown 未收编 `runtime.close()` 的同步抛错

- 位置：`packages/namespace-registry/src/registry.ts` runShutdown 关闭发起段（约 977-986 行）。
- 现状：实现直接调用 `entry.runtime.close()`，未逐项捕获同步异常。若首个 Runtime 的
  close() 同步抛错：后续 Runtime 不会被尝试关闭；`entries.clear()` 与
  `acceptance='stopped'` 不执行，Registry 停在 shutting-down；最终错误不会聚合为
  NamespaceRegistryShutdownError。
- 要求：对每次 close 发起同时收编同步 throw 和 Promise rejection，保证所有 Runtime 都被
  尝试关闭、状态正确推进（entries.clear + acceptance='stopped' 恒执行）、失败稳定聚合为
  NamespaceRegistryShutdownError（同步 throw 与 rejection 同构进入 failures）。
- 回归测试：「首个 close 同步抛错、后续 Runtime 仍全部尝试关闭、状态推进 stopped、聚合
  错误收录该同步 cause」。

## 问题 2：background idle-close 的同步抛错会逃出 timer callback

- 位置：`packages/namespace-registry/src/registry.ts` beginIdleClose（约 627-645 行）。
- 现状：`beginIdleClose()` 假定 `runtime.close()` 必定返回 Promise。同步抛错时：不产生
  `idle-close-failed` observer 事件；entry 不进入正常 closing/清理流程（phase 停留 idle、
  closePromise 未写）；timer token 已清但 entry 仍处于 idle；异常逃出 Cordis timer
  callback。
- 要求：统一失败收编路径（同步 throw 与 Promise rejection 同等处理）：同步 throw 也必须
  走 I2 不变量许可的 closing 语义（closePromise 以 rejected Promise 落位）→
  `idle-close-failed` observer（exact cause，恰一次）→ removeOnlySelf 双守卫移除；不产生
  unhandled rejection、不逃出 timer callback、不污染后续 open（后续 open 可建立新
  generation）。
- 回归测试：同步 throw 用例（现有测试只覆盖 Promise rejection）——覆盖 observer 事件、
  entry 移除、后续 open 新 generation、零 unhandled rejection。

## 问题 3：未真正保证 Registry shutdown 先于 Persistence dispose

- 位置：`packages/namespace-registry/src/plugin.ts`（约 23-29 行头注契约第 2 条与实现）。
- 现状：当前实现注释将保证限定为「fiber 级」，承认 persistence adapter dispose 可能与
  Registry shutdown 并发；SA7 测试（registry-sa7-cordis.test.ts SA7-P2）还把 close 撞上
  已销毁 persistence handle 后产生聚合失败固化为预期。这弱于验收标准「plugin 在一个有序
  async disposer 中完成 Registry shutdown 后再撤销 service，且先于 Persistence dispose」。
- 要求：调整依赖/清理编排，真正保证 Registry shutdown 排空期间 Persistence adapter 仍可
  用（adapter dispose 不先于 Registry shutdown settle 发生）——例如 persistence 服务
  提供方在自身 dispose 前先排空依赖方（plugin 侧经 inject/有序 disposer 表达强依赖，并在
  集成测试中以探针次序证明 adapter dispose 晚于 registry shutdown settle）。
- 回归测试：能证明 persistence adapter 在 Registry shutdown settle 前不会 dispose 的集成
  测试（探针次序：registry-shutdown-settled 先于 persistence-adapter-disposed）；移除把
  并发 dispose 失败固化为预期的旧测试假设（SA7-P2 的「close 撞已销毁 handle → 聚合失败」
  预期必须删除或改写）。
- 注意：本项改动的是 plugin 编排与头注契约，persistence 包 src 是否可改由 SA8/SA1 裁决
  （上一轮 DENY 边界声明「persistence src 不改」——若必须在 persistence 侧加排空钩子，
  需 SA8 对照 ADR 裁决并在设计中显式记录）。

## 验收标准（issue #112 原文，13 条，须整体保持不回归）

1. plugin 发布 `ctx.nomicoreRegistry`，含 Host 无关核心、Cordis Adapter 与受控 testing subpath
2. production config 仅含 `idleTimeoutMs`，默认 300000ms，校验 0..2147483647 有限整数
3. plugin 强依赖 clock、Cordis timer 与 nomicorePersistence，缺失 loud fail 无 fallback
4. 最后 lease 释放后进入 idle 并经 `ctx.timeout()` 延迟 close；重新进入 idle 重置完整 timeout
5. idle 期间 open 同步取消 timer 并复用 Runtime；timer 先进入 closing 后 open 等待 close 再建立新 generation
6. timeout=0 仍异步调度；fatal/degraded Runtime 使用相同 idle retention
7. background idle-close failure 不产生 unhandled rejection、不污染后续 open、进入内部 observer
8. getStatus 仅表达 running/shutting-down/stopped，不暴露 entry/lease/queue
9. shutdown 同步停止接纳且不访问新输入，取消 idle timers，等待已接纳 open/create 结算，不等待外部 lease release
10. shutdown 复用已在途 close Promise，尝试关闭全部 Runtime，用稳定聚合错误报告 close failures
11. plugin 在一个有序 async disposer 中完成 Registry shutdown 后再撤销 service，且先于 Persistence dispose（本轮强化为真实次序保证）
12. shutdown 与 release 均保持幂等 same-Promise 语义
13. 通过确定性时间/并发测试、全量 typecheck/test 与 Node 20/24 CI

## 执行约束

- 每项修复必须配回归测试（含问题 1/2 的同步 throw 用例、问题 3 的 dispose 顺序集成测试）；
  测试须确定性（fake scheduler/受控 gate），禁止真实 sleep。
- 改动范围预期：packages/namespace-registry/src/{registry.ts,plugin.ts} +
  test/（如 SA8 裁决允许，可能涉及 persistence 侧排空钩子）。
- 改动包 bump patch 版本号。
- 不 push、不开 PR；只本地 commit + REPORT.md。
