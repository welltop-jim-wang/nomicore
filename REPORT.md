---
status: complete
run_id: issue-112-1787739744-862383
branch: fix/issue-112-on-docs-namespace-registry
round: 1
---

# namespace-registry：idle retention、Cordis plugin 与 ordered shutdown（issue #112）

## 概要

完成 ADR-0009 已冻结但未实现的三块能力，issue #112 全部 13 条验收标准落地：

1. **空闲保留（idle retention）**：最后一个 lease 释放后 Runtime 进入 idle 而非立即 close，
   经注入的 `RegistryTimeoutScheduler`（生产桥 = Cordis `ctx.timeout()`）延迟
   `idleTimeoutMs`（默认 300,000ms，校验 0..2,147,483,647 有限整数）后关闭；每次重进
   idle 重置完整时限；idle 期 open 同步取消 timer 并复用 Runtime；timer 先触发则 entry
   不可逆转 closing，open 等待同一 close Promise 结算后建立新 generation；timeout=0
   仍异步调度；fatal/degraded Runtime 同语义；idle-close 失败零 unhandled rejection、
   经内部 observer（`idle-close-failed`）上报、不污染后续 open。
2. **通用 Cordis plugin**：新模块 `src/plugin.ts` 发布 `ctx.nomicoreRegistry` service；
   强依赖 `clock`/`timer`/`nomicorePersistence`（inject 依赖图边 + apply 内形状断言
   双机制，缺失 loud fail 零 fallback）；config 仅 `idleTimeoutMs` 一键，工厂调用期
   同步校验；plugin 在一个有序 async disposer（generator effect，cordis 逆序串行语义
   经源码核实）中先完成 Registry shutdown 再撤销 service，且经依赖图先于 Persistence
   fiber dispose。
3. **Host shutdown**：acceptance 三相（running→shutting-down→stopped）；首次 shutdown
   同步段停接纳（后续 open/create 返回 `REGISTRY_NOT_ACCEPTING` 且零输入访问）+ 取消
   全部 idle timer + 缓存 same-Promise；异步段等待全部已接纳 open/create 槽结算（不等
   外部 lease release），复用在途 close Promise、尝试关闭全部 Runtime，close failures
   以稳定 `NamespaceRegistryShutdownError` 聚合 reject（failures 冻结、Map 插入序、
   结构化 {owner,namespaceId,cause}）；shutdown 与 release 均幂等 same-Promise；
   `getStatus()` 仅表达 running/shutting-down/stopped。

## 变更（文件级；commit 83bd579，28 文件 +6189/−198）

**生产代码（packages/namespace-registry/）**：
- `src/plugin.ts`（新建 ~200 行）：NOMICORE_REGISTRY_SERVICE、Context augmentation、
  provide/require、`assertNamespaceRegistryHostDependencies`、`createCordisRegistryScheduler`、
  `resolvePluginIdleTimeoutMs`、`createNamespaceRegistryPlugin`（inject + 有序 disposer）、
  `DEFAULT_IDLE_TIMEOUT_MS` re-export；头注固化宿主接线契约三条
- `src/registry.ts`（+391/−40）：Entry 三态（active/idle/closing）+ `idleTimerHandle`
  （删死字段 lifecycleTail）；I1-I4 不变量（I4 arm-token：回调首查
  `entry.idleTimerHandle !== handle` 失配即 no-op）；`resolveIdleTimeoutMs` +
  `DEFAULT_IDLE_TIMEOUT_MS` 单点；scheduler 必需形状门禁（次序在 clock 门禁后）；
  `handleLeaseReleased`/`beginIdleClose`/`activateEntry`/`removeEntryAfterClose`；
  runOpenSlot 三态重写（closing-wait catch-吞并继续，ADR-0009:50 直译）；runCreateSlot
  idle 第五态 → ALREADY_EXISTS 零 Persistence；acceptance 门迁至公共入口同步段；
  shutdown 真实化（非 async 方法保证 AC12 same-Promise；runShutdown 微任务边界保证
  三相可观测）；getStatus 三相冻结常量
- `src/lease.ts`（+12）：`createLeaseController` 第三参 `onReleased`（首次 release
  同步段、observer 事件后、恰一次）
- `src/types.ts`：删 `RegistryOperationUnavailableIssue` 占位；增 `RegistryTimeoutScheduler`、
  `shutdown(): Promise<void>`、`NamespaceRegistryShutdownFailure`、options 增
  `scheduler`(必需)/`idleTimeoutMs?`、5 条稳定 message 常量（单一真相源）
- `src/errors.ts`：`NamespaceRegistryShutdownError`（恒定 message 零插值零回显）
- `src/observer.ts`：事件七形→十形（+entry-idle/idle-arm-failed/idle-close-failed）
- `src/testing.ts`：overrides 增 `scheduler`(必需)/`idleTimeoutMs?`；新导出
  `createRegistryTestScheduler`（确定性 advanceBy/pending，零 native timer）
- `src/index.ts`：主入口导出 3→9 值 + 3 类型（§2.G 冻结清单）
- `package.json`：dependencies += `@deepseek-ai/cordis ^4.0.1`、
  `@deepseek-ai/cordis-plugin-timer ^1.1.3`（pnpm-lock.yaml 同步刷新）

**测试（49 新用例：SA6 红灯 35 + SA7 攻击 14）**：
- 新建 `test/registry-idle.test.ts`（16）、`test/registry-shutdown.test.ts`（10）、
  `test/registry-plugin.test.ts`（8，真实 `new Context()` 组合）、
  `test/registry-sa7-concurrency.test.ts`（C1-C4：100 并发/50 key/shutdown 竞态/确定性
  三轮 digest）、`test/registry-sa7-hostile.test.ts`（H1-H6：arm throw/双重 fire/observer
  throw/never-settle/clock 回跳/getStatus 身份锚）、`test/registry-sa7-cordis.test.ts`
  （P1-P4：根级 dispose/R1 聚合通道/reload/native timer 烟囱）
- 迁移 `registry-open.test.ts`（32 工厂调用 + 2 处点名断言替换）、
  `registry-create.test.ts`（47+4 + idle duplicate 行）、`registry-node-dispose.test.ts`（1）、
  `registry-surface.test.ts`（导出 9 键 + cordis 白名单/host-global-timer 双守卫）——
  既有断言语义零改动（SA4 逐行 diff 核实）

**流水线档案（wiki/raw/task_registry-idle-plugin-shutdown_*.md）**：冻结设计（SA2 R1
REJECT→修订→R2 PASS）、SA2 评审、SA6 红灯报告、SA3 实现档案、SA4 静态验尸（pass）、
SA7 动态验证（pass）、AC 门禁清单、dispatch 台账。

## 验证（总控亲跑，后台独立进程；输出 .mabf-bg/final-test.log / final-tc.log）

- 全量 `pnpm test`（Node 24.13.0，提交态 83bd579）：**Test Files 116 passed (116)；
  Tests 1392 passed (1392)；Type Errors no errors；exit 0**（Duration 59s）
- `pnpm typecheck`（九包 tsc 链）：**exit 0**
- 基线对照：#112 前 110 文件 1341/1341 → 其余包与既有用例零回归
- Node 20 实跑（SA7，docker node:20-slim v20.20.2 非 root）：全量 1390 passed +
  2 skipped（#110 既定条件跳过）exit 0；typecheck exit 0；CI 矩阵（ci.yml node:[20,24]）
  发布侧 run 由 Host 跟踪（本机侧双版本证据已落）
- 确定性：namespace-registry 套件 3 连跑 canonical 输出逐字节一致；全部测试零 real
  sleep（唯一例外 SA7-P4 烟囱用例 real native timer，文件内已注明）
- 变异杀伤率 7/8（残 1 为 SA7 双路实证的结构等价变异，非测试盲区）
- 双轴终审（code-review skill，e1efbbe...HEAD）：Standards 轴 0 HARD/5 JUDGEMENT
  （全部为文档化标准压制项或信息级）；Spec 轴 0 missing/0 creep/0 wrong

## 遗留风险

- **R1（已声明，后续票）**：Cordis fiber `_unload` 对本级 disposables 并发执行，
  依赖图只保证 Registry fiber settle 先于 Persistence fiber 卸载完成（fiber 级），
  不保证先于 persistence adapter 内部排空——并发窗口内 runtime close 失败会进入
  shutdown 聚合错误（诚实响亮通道，SA7-P2 动态实证该通道工作）；根治需 persistence
  侧注册形态演进（本票 DENY 边界外，建议立后续票）
- **R3（契约行为）**：runtime close 永不 settle 时 open/create 的 closing-wait 与
  shutdown 随之挂起（ADR-0008「不取消、不设内部 timeout」），SA7-H4 以探针锚定
  「等待而非崩溃」
- **R5（v1 冻结接受）**：persistence 服务重提供触发 Registry fiber 全量重建（reload），
  旧实例 lease 随 shutdown 失效；SA7-P3 锚定语义
- **宿主接线契约**（plugin.ts 头注固化）：timer plugin 必须先装后停（timer⊇registry
  生命周期）；timer 先卸则 idle 回收停摆（entry 滞留 idle 直至 open/shutdown 兜底，
  不崩溃不泄漏）
- CI 是否为本包新增显式 workflow 存在性步骤（对齐 persistence-contract 先例）留作
  开放问题，当前由全量 `pnpm test` 覆盖
