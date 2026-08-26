# AC 逐条核对表 — issue #112 round 2 修订轮（registry-idle-plugin-shutdown-rev1）

基线 commit: d183d3b（SA3 实现）+ SA7 补充测试 registry-sa7-rev1.test.ts（随收尾 commit 入库）。
验证基座：总控亲验 `pnpm typecheck` EXIT=0；`pnpm test` Test Files 116→117 passed、Tests 1397→1402 passed、Type Errors: no errors；SA4/SA7 独立复跑同绿。

## 修订轮 3 项问题（本轮主验收面）

| # | 描述 | 状态 | 证据 | 处理 |
|---|------|------|------|------|
| P1 | shutdown 收编 runtime.close() 同步抛错：全部 Runtime 必被尝试、entries.clear+stopped 恒执行、同步 throw 与 rejection 同构聚合进 NamespaceRegistryShutdownError | ✅ | registry.ts:979-1001 收编段；红灯 19b（首个同步 throw→全尝试/stopped/聚合）+ 19c（双 entry 全 throw，failures 插入序恰一次）+ SA7 19d（floating-window 载荷场景零 unhandled）；SA4 逐字一致性 ✅ | SA3 实现，SA4/SA7 双清 |
| P2 | beginIdleClose 同步抛错收编：不逃出 timer 回调、idle-close-failed observer exact cause 恰一次、entry 移除、后续 open 新 generation、零 unhandled rejection | ✅ | registry.ts:627-653 收编段；红灯 11b + 11c（phase 守卫防误伤）+ SA7 11d/11e（real native timer 零逃出/敌意 sink 隔离）；SA2 四通道核对 ✅ | SA3 实现，SA4/SA7 双清 |
| P3 | Registry shutdown 先于 Persistence adapter dispose（真实次序保证，非 fiber 级收窄） | ✅ | service.ts bindPersistenceAdapterLifecycle（yield revoke re-parent + drainStep 逆序串行，finally 兜底 dispose）；memory/file 两 Adapter 复用；plugin.ts 头注第 2 条改写；红灯 29 + SA7-P2 改写（探针次序 registry-shutdown-settled < persistence-adapter-disposed）；SA2 实验 1 old/new wiring 对照；SA7 R5P 双 timer 形态证实 | SA8 放行 persistence 边界→SA1 设计→SA2 复审→SA3 实现 |

## issue #112 原文 13 条 AC（不回归核对）

| AC# | 描述 | 状态 | 证据 | 处理 |
|-----|------|------|------|------|
| AC1 | plugin 发布 ctx.nomicoreRegistry，含 Host 无关核心、Cordis Adapter 与受控 testing subpath | ✅ | registry-plugin.test.ts 25-28a、registry-surface.test.ts；本轮公共面零变更（SA4 §6 契约连锁审计） | 不回归保持 |
| AC2 | production config 仅 idleTimeoutMs，默认 300000ms，校验 0..2147483647 有限整数 | ✅ | registry.ts resolveIdleTimeoutMs/DEFAULT_IDLE_TIMEOUT_MS 零 diff；plugin.test.ts config 用例绿 | 不回归保持 |
| AC3 | plugin 强依赖 clock/timer/nomicorePersistence，缺失 loud fail 无 fallback | ✅ | plugin.ts inject + assertNamespaceRegistryHostDependencies 零 diff；测试 21-24 绿 | 不回归保持 |
| AC4 | 最后 lease 释放进 idle 经 ctx.timeout 延迟 close；重进 idle 重置完整 timeout | ✅ | registry-idle.test.ts 1-8 绿；handleLeaseReleased 零 diff | 不回归保持 |
| AC5 | idle 期 open 同步取消 timer 复用；timer 先进 closing 后 open 等 close 再建新 generation | ✅ | registry-idle.test.ts 9/10/11/11b/11c 绿；P2 收编保持 I2/I4 | 不回归保持 |
| AC6 | timeout=0 仍异步调度；fatal/degraded Runtime 相同 idle retention | ✅ | registry-idle.test.ts 对应用例绿；零 diff | 不回归保持 |
| AC7 | background idle-close failure 零 unhandled rejection、不污染后续 open、进内部 observer | ✅（本轮强化） | 11b 扩展同步 throw 通道；SA7 11d real-timer 零逃出 | P2 修复 |
| AC8 | getStatus 仅 running/shutting-down/stopped，不暴露 entry/lease/queue | ✅ | getStatus 三相冻结常量零 diff；surface 审计绿 | 不回归保持 |
| AC9 | shutdown 同步停接纳零输入访问、取消 idle timers、等待已接纳结算、不等外部 release | ✅ | registry-shutdown.test.ts 14/15/15a/16/17 绿（SA7 逐名复核） | 不回归保持 |
| AC10 | shutdown 复用在途 close、尝试关闭全部 Runtime、稳定聚合错误 | ✅（本轮强化） | 18/19/19b/19c/19d 绿；同步 throw 同构入聚合 | P1 修复 |
| AC11 | plugin 有序 async disposer 完成 shutdown 后再撤 service，且先于 Persistence dispose | ✅（本轮由 fiber 级强化为 adapter 级） | plugin.ts generator effect 保持；25/26/27/29/SA7-P2/R5P 绿；adapter dispose 严格后于 shutdown settle | P3 修复 |
| AC12 | shutdown 与 release 幂等 same-Promise | ✅ | 20/21 绿；shutdown() 非 async 缓存实例零 diff | 不回归保持 |
| AC13 | 确定性时间/并发测试、全量 typecheck/test 与 Node 20/24 CI | ✅（本地）/ 待 CI（矩阵） | typecheck EXIT=0；1402/1402 绿；全部新测试 fake scheduler/gate 零真实 sleep；Node 20/24 矩阵由 CI 覆盖（push 后 Host 观测） | 本地闭环，CI 交 Host |

## 结论

全部 ✅，无 ❌ 项，无需追加派发。遗留说明：
1. R5′ 残余窗口（生产 timer 下 persistence fiber UNLOADING 窗口内 ctx.timeout 抛 INACTIVE_EFFECT）已经 SA1 设计 §8 R5′ 声明式登记 + SA7 实测证实与声明一致（18/18 探针 + 5/5 差分对照）；失败类别响亮非静默、不回归 round 1，根治出票（scheduler 所有权迁移超本轮 SA8 放行边界）。
2. effect-faithful timer stub 契约用例未落地（SA3 裁量：复刻成本高、判定易失真；SA2 R2 已接受文档声明路径）。
3. git config mabf.branch/mabf.base-branch 在本 worktree 为陈旧值（fix/issue-89-on-docs-namespace-runtime / docs/namespace-runtime），与当前任务身份不符；PR #126 实际 base = docs/namespace-registry 正确。总控已将本 worktree git config 修正为 mabf.branch=fix/issue-112-on-docs-namespace-registry、mabf.base-branch=docs/namespace-registry（本地元数据修正，非发布动作）。
