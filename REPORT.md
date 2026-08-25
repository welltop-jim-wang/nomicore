---
status: complete
run_id: issue-107-1787656954-603033
branch: fix/issue-107-on-docs-namespace-registry
round: 1
---

# issue #107：persistence 迁移 `nomicorePersistence` 与外部 Clock/Timer

## 需求理解

将 Nomicore Persistence 的 Cordis service 与时间调度接线迁移到 Phase 4 统一能力（ADR-0009）：

- **AC1** service 名 `docPersistence` → `nomicorePersistence`，Context 属性、provide/require helpers 与全部消费方同步；
- **AC2** plugin 启动强依赖 `clock`（@nomicore/clock）与 Cordis `timer`（@deepseek-ai/cordis-plugin-timer），缺失任一在 provide 之前同步 loud throw；
- **AC3** 所有一次性延迟调度（debounce/max-dirty/retry）经 lifecycle-managed `ctx.timeout()`；
- **AC4** 包内删除 `systemPersistenceTimer`/`PersistenceTimer`，零自建 system/global timer、零 `Date.now()`；
- **AC5** Clock 只作 wall-clock 观测，elapsed 调度归 Timer——调度缝 `PersistenceScheduler` 无 `now`；
- **AC6** Memory/File Adapter 的 debounce、max-dirty、single-flight flush、degraded/retry、generation 保序行为零回归（lifecycle 只换缝名）；
- **AC7** DSH profile 装配序 clock→timer→persistence，probe 确定性 record 逐字节不变，文档/共享 contract tests 与新名一致；
- **AC8** 全量 typecheck/test 绿（Node 20/24 矩阵属外层 CI，非本地门槛）。

流水线背景：前任总控完成 SA1 设计（R1，SA2 攻击评审 FAIL→复审 PASS）并派发 SA3 实现后中绝。本 round 由继任总控接管：核验在飞实现与设计逐点对齐，全量门禁发现两个设计盲区缺陷（见下「修复轮」），修复后双轴终审 PASS。

## 变更

### 主实现（SA3，对照设计 R1 §4/§6 逐点落实）

- `packages/persistence/src/contract.ts` — `NOMICORE_PERSISTENCE_SERVICE`、`PersistenceScheduler`（property-signature、无 `now`）、provide/require 更名、Context augmentation `nomicorePersistence`；删除 `DOC_PERSISTENCE_SERVICE`/`PersistenceTimer`/`systemPersistenceTimer`/`provide|requireDocPersistence`；`DocPersistence` 接口名保留（JSDoc 交叉引用新 service 名）。
- `packages/persistence/src/lifecycle.ts` — 调度缝 `timer` → `scheduler`（7 调用点），构造 options `scheduler` 必填、无默认；**状态机/退避/generation 逻辑零改动**。
- `packages/persistence/src/service.ts`（新建）— `assertPersistenceHostDependencies`（AC2：先 requireClock 再 `ctx.get('timer')` 探针 + 成员校验，provide 之前 throw）+ `createCordisPersistenceScheduler`（AC3：`ctx.timeout` 桥，disposer 即 handle）；文件头 R1/#15 宿主接线契约（timer fiber 生命周期 ⊇ adapter 生命周期）。
- `packages/persistence/src/memory.ts` / `file.ts` — options 必填 `scheduler`；`apply(ctx)` 开头断言依赖；plugin 工厂 `Omit<..., 'scheduler'>` + 工厂内 `createCordisPersistenceScheduler(ctx)`。
- `packages/persistence/src/index.ts` — 导出面 -5 旧名 +4 新名。
- `packages/persistence/src/testing.ts` — `TestScheduler`/`createTestScheduler`（无 `now`）、fixture 字段 `timer`→`scheduler`、`createFakeTimerPlugin` re-export（实现迁至 fake-timer.ts，公共面不变）。
- `packages/persistence/src/fake-timer.ts`（新建，修复 A）— vitest-free 的 `createFakeTimerPlugin`（幂等 disposer 契约 + 时间线视图契约，全箭头属性形态）。
- `packages/persistence/package.json` — +`@nomicore/clock`、`@deepseek-ai/cordis-plugin-timer` 依赖；exports +`./testing` +`./fake-timer`；0.1.3 → 0.2.0。
- `packages/clock/src/contract.ts` — 仅第 28 行 JSDoc doc-only 修订（SA2 B2 裁定方案 a，清旧符号引用）。
- `packages/dsh-persistence/src/clock.ts`（重写）— `ProbeTimeline`/`createProbeTimeline`：manual Clock（观测）+ fake timer（调度）同一闭包虚拟时间线（R1/B3 不变式 ③：`at = manual.now() + delayMs`）；`settle`/`waitFor`/`ProbeTimeoutError` 保留。
- `packages/dsh-persistence/src/profile.ts` — options 双注入缝 `clock?`/`timer?`（缺省 systemClock plugin / 真实 `new TimerService(ctx)`），同步直 apply 装配序；dispose 顺序不变。
- `packages/dsh-persistence/src/probe.ts` — timeline 自建/注入，`resolveProbeClock` 可推进性守卫整体删除，`requireNomicorePersistence` 自检；S1–S4 场景脚本零改动。
- `packages/dsh-persistence/src/events.ts` / `index.ts` — `ProbeRunOptions.timeline?: ProbeTimeline`；导出面更替。`cli.ts`/`record.ts` 零改动。
- `packages/dsh-persistence/package.json` — 同两项依赖；0.1.1 → 0.2.0。
- 测试迁移（persistence ×9 + dsh ×1）：共享套件 fixture 更名、直连构造全量显式注入 fake scheduler、file 真实 timer 用例虚拟化（advanceBy 触发 + deadline 式谓词 waitFor、谓词逐用例化、waitFor 先于 dispose）、core-dsh-boundary 四段式（正向 + AC2 负向 A/B/C）、module-graph-regression 新增 AC4 静态守卫（三正则 + 判别力样本表先证后扫，扫描七生产文件）、dsh-profile-acceptance 全量迁 ProbeTimeline + 新增「ProbeTimeline 确定性基线」describe（§6.13 + SA2 L-1 两计时器中途断言）。

### 修复轮（继任总控裁定，SA 执行）

- **修复 A（SA3）**：`createFakeTimerPlugin` 从 vitest 耦合的 testing.ts 抽取至 vitest-free `src/fake-timer.ts` + `./fake-timer` subpath——消除探针 CLI 真实子进程的 vitest 崩溃（"Vitest failed to access its internal state"，dsh-probe-cli 6 红 + dsh-file-probe-determinism 1 红）。
- **修复 B（SA6）**：`packages/namespace-runtime/test/` 13 文件 29 构造点消费方同步（AC1）——新建共享 `real-persistence-scheduler.ts`（与旧默认 system timer 逐秒等价的真实计时器替身），逐点显式注入；设计 DENY 对 src 成立（type-only，零改动）对 test 误判，已按 AC1「消费方同步更新」裁定纳入。修订轮：helper 注释去除旧符号字面名，收敛文档 sweep 至预期 1 行。
- `pnpm-lock.yaml` — 新增 timer 插件解析边。

## 验证（全部亲跑，worktree /home/wangjian/nomicore-fix-issue-107）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 全量类型检查 | `pnpm typecheck`（8 包 tsc 串联） | **exit 0** |
| 全量测试 | `pnpm test`（vitest run --typecheck） | **Test Files 97 passed (97)；Tests 1174 passed (1174)；Type Errors no errors；exit 0**（50.38s） |
| 文档 sweep（设计 §8 步骤 12） | `grep -rn "docPersistence\|DOC_PERSISTENCE\|PersistenceTimer\|systemPersistenceTimer\|provideDocPersistence\|requireDocPersistence" CONTEXT.md AGENTS.md README.md docs packages --include='*.ts' --include='*.md' --exclude-dir=node_modules` | **恰 1 行** = `docs/adr/0009-namespace-registry-leases-and-host-lifecycle.md:26`（迁移句前瞻原文，有意保留） |
| 探针 CLI 冒烟 | `pnpm exec tsx packages/dsh-persistence/src/cli.ts --adapter memory` | **exit 0**，尾行 `probe ok=true events=28`，末事件 `evict doc-degraded t=2009`（与确定性锚逐字节一致） |
| 修复轮包级验证 | SA3/SA6 各自实跑 | dsh-persistence 21/21、persistence 定点 49/49、namespace-runtime 22 文件 118/118、全仓 tsc EXIT=0（证据见 dispatch log 与 final_review 档案） |

### 完成前独立双轴审查（engineering/code-review 门禁）

- diff 范围：基线 `a73136d` → 工作区最终态（38 已跟踪文件 + 3 新文件），两轴同一范围。
- **Standards 轴：PASS**（0 硬性违规；注释声称逐条经 cordis/timer 源码与只读实测核实；AC4 守卫样本表独立仿真自洽）。
- **Spec 轴：PASS**（0 阻断；AC1–AC8 逐条核对；SA2 B1/B2/B3/L-1 全部落实确认）。
- 非阻断项 9 条全部由总控裁决记录在案（含两项已备案的设计偏差：fake-timer 抽取、namespace-runtime 测试消费方同步），详见 `wiki/raw/task_persistence-timer-service-migration_final_review.md`。

## 遗留风险

1. **Node 20/24 CI 矩阵**属外层职责（本地 Node 24.13.0 全绿；timer 插件的 `Promise.withResolvers` 仅 promise 分支触及，persistence 只用 callback 形态，SA2 已裁定 Node≥20 安全）。
2. **非阻断观察项**（两轴认可、不修）：fake-timer.ts 的 mixin disposer 未捕获（cordis fiber 无条件跟踪 + unload 逆序清理 + 上游同款先例，实测无害）；AC1 常量断言锚点位置与设计 §5 文字不符但实质钉死；若干注释措辞精度项。详见 final_review 档案。
3. **宿主接线契约**（设计内建、非新风险）：timer fiber 生命周期必须 ⊇ persistence adapter 生命周期（service.ts 文件头 JSDoc 立法）；未来 NomicoreServer/Registry Host 装配须遵守，违反时 `scheduleRetry` 的 `ctx.timeout` 在 native 回调续体抛 INACTIVE_EFFECT。
4. `packages/clock/src/contract.ts:28` 单行 doc-only 修订为 SA2 B2 裁定的 ALLOW 例外（#106/#115 冻结的是行为面，零行为/零 API 变更）。
