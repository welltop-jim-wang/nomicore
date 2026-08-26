# AC 门禁清单 — issue #112（namespace-registry：idle retention、Cordis plugin 与 ordered shutdown）

- run_id: issue-112-1787739744-862383 ｜ round: 1 ｜ branch: fix/issue-112-on-docs-namespace-registry
- 基线：e1efbbe（origin/docs/namespace-registry）
- 证据索引：设计 `task_registry-idle-plugin-shutdown.md`（SA2 PASS）；SA6 `..._sa6_red.md`（34+1 用例）；SA3 `..._sa3_impl.md`；SA4 `..._sa4_review.md`（pass）；SA7 `..._sa7_report.md`（pass，14 补充用例）
- 总控亲跑门禁（.mabf-bg/ctrl-full-test.log / ctrl-tc.log）：`pnpm test` 113 文件 1378/1378 exit 0（Type Errors 0）；`pnpm typecheck` exit 0。SA7 复审后全量：116 文件 1392/1392 exit 0（含 SA7 新增 14 用例）。

| AC | 验收标准 | 证据 | 判定 |
|---|---|---|---|
| 1 | plugin 发布 `ctx.nomicoreRegistry`；含 Host 无关核心、Cordis Adapter 与受控 testing subpath | src/plugin.ts（NOMICORE_REGISTRY_SERVICE='nomicoreRegistry'、Context augmentation、provide/require、createNamespaceRegistryPlugin）；主入口 9 值导出（surface 测试锚）；testing subpath 2 导出；registry-plugin.test.ts 测试 22 真实 `new Context()` 组合绿；SA7-P1 完整装配绿 | ✅ |
| 2 | production config 仅 `idleTimeoutMs`，默认 300,000ms，0..2,147,483,647 有限整数 | registry.ts `DEFAULT_IDLE_TIMEOUT_MS=300_000` + `resolveIdleTimeoutMs` 单点（TypeError/RangeError 二分、恒定文案）；plugin.ts `resolvePluginIdleTimeoutMs`（键集拒绝多余键）；registry-plugin.test.ts 测试 29 校验矩阵绿（-1/1.5/NaN/'300000'/2147483648/{foo:1} 全拒；0/2147483647 接受） | ✅ |
| 3 | plugin 强依赖 clock、Cordis timer、nomicorePersistence，缺失 loud fail 无 fallback | `assertNamespaceRegistryHostDependencies`（clock→timer→persistence 固定次序、逐字文案、apply 栈 throw 先于 provide）；测试 23（通道 A 直接 apply loud）+ 测试 28a（通道 B ctx.plugin inject PENDING 门：零 service/零 instance/零 fallback，补装转 ACTIVE）——双通道语义经 SA2 R1 裁决落纸（设计 §2.F） | ✅ |
| 4 | 最后 lease 释放后 idle 并经 `ctx.timeout()` 延迟 close；重进 idle 重置完整 timeout | registry.ts `handleLeaseReleased`（release 同步段武装、I4 arm-token）+ `beginIdleClose`；生产桥 `createCordisRegistryScheduler`→`ctx.timeout`；测试 1/2/3（完整 299_999+1、重进重置全新窗口）+ 测试 28（真实桥 advance 驱动）+ SA7-P4（native timer 烟囱 close 恰 1） | ✅ |
| 5 | idle 期 open 同步取消 timer 复用；timer 先 closing 则 open 等 close 后建新 generation | `activateEntry`（同步 clearTimeout + phase→active）；runOpenSlot closing 分支 await closePromise→recheck→新 generation；测试 7（pending 0、同 Runtime marker、零 loadDoc）+ 测试 8（timer 先行、deferred gate、新 generation）+ 测试 3a（arm-token adversarial，SA2 H1） | ✅ |
| 6 | timeout=0 仍异步调度；fatal/degraded 同 idle retention | 测试 4（release 后含微任务排空仍零 close、advanceBy(0) 才 close）+ 测试 5（fatal/degraded 两变体照常 close） | ✅ |
| 7 | background idle-close failure 零 unhandled rejection、不污染后续 open、入内部 observer | `beginIdleClose` ④⑤ then 双臂（派生恒 resolve）+ observer `idle-close-failed` exact cause 恰一次 + removeOnlySelf 双守卫；测试 9/11/12（unhandledRejection 探针、后续 open/create 全新 generation）+ SA7-H1/H2/H4 | ✅ |
| 8 | getStatus 仅 running/shutting-down/stopped，不暴露 entry/lease/queue | acceptance 三相冻结常量投影（RUNNING/SHUTTING_DOWN/STOPPED 单例）；测试 13 + SA7-H6（跨调用/相位/实例 toBe 身份锚 + isFrozen）；类型面 `NamespaceRegistryStatus` 三相联合（#110 已冻结） | ✅ |
| 9 | shutdown 同步停接纳且不访问新输入、取消 idle timers、等已接纳 open/create 结算、不等外部 release | 公共入口同步段 acceptance 首查（先于 identity 校验）；shutdown 同步段翻相+取消全部 timer；runShutdown 等 carrier tails→关闭全集；测试 14（Proxy trap 零执行）/15/15a/16（在途槽完整结算签 lease）/17（持 lease 照常关闭）；SA7-C3（shutdown×50 在途 open 竞态全 ok） | ✅ |
| 10 | shutdown 复用在途 close Promise、尝试关闭全部 Runtime、稳定聚合错误 | runShutdown 步骤 2 复用 `entry.closePromise`；步骤 3 逐个 await 收集 failures 不因首败跳过；`NamespaceRegistryShutdownError`（恒定 message、failures 冻结+插入序+{owner,namespaceId,cause}）；测试 18（releaseCalls===1）/19（三 key 聚合形状）/24（message 恒定零回显专测）；SA7-P2（R1 通道真实工作） | ✅ |
| 11 | plugin 有序 async disposer：shutdown 完成后撤 service，先于 Persistence dispose | plugin.ts generator effect（yield revoke→shutdown disposer，cordis 逆序串行：shutdown 完成后 finally 撤 service）；inject 依赖图边（persistence provide disposer await 依赖 fiber settle——cordis lib/index.js:817-820 总控亲核）；测试 25（dispose 不 settle 直到 shutdown 完成）/26（fiber 级先序）/27（close 失败仍撤 service）；SA7-P2/P3 | ✅ |
| 12 | shutdown 与 release 幂等 same-Promise | shutdown() 非 async 方法 + shutdownPromise 同步段缓存（含 reject 实例复用）；release 闭包缓存（#110 冻结保留）；测试 20（并发/结算后/含 reject 同一实例）+ 测试 6（release/asyncDispose 回归） | ✅ |
| 13 | 确定性时间/并发测试、全量 typecheck/test、Node 20/24 CI | 全部测试 deferred gate + fake scheduler advanceBy，零 real sleep（唯一例外 SA7-P4 烟囱用例已注明）；SA7-C4 三轮 digest 逐字节一致、套件 3 连跑 canonical 输出一致；Node 24 本机全绿 + Node 20 真实容器（v20.20.2 非 root）全量 1390 passed+2 skipped exit 0、typecheck exit 0（SA7 §5；2 skipped=#110 既定条件跳过）；CI 矩阵 ci.yml node:[20,24] 既有（发布侧 CI 由 Host 跟踪） | ✅ |

**结论：13/13 AC 全部 ✅，无 ❌ 无追加派发项。**
