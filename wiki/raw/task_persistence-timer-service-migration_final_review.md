# Final Review Record — issue #107 persistence 迁移 nomicorePersistence 与外部 Clock/Timer

> 完成前独立代码审查（engineering/code-review 门禁）：两轴并行、同一 diff 范围、零阻断。

- run_id: issue-107-1787656954-603033
- worktree: /home/wangjian/nomicore-fix-issue-107（branch fix/issue-107-on-docs-namespace-registry）
- **审查 diff 范围**：基线 commit `a73136d`（HEAD，本任务零提交）→ 工作区最终态：`git diff HEAD`（38 个已跟踪文件，含 pnpm-lock.yaml）+ 3 个未跟踪新文件（`packages/persistence/src/service.ts`、`packages/persistence/src/fake-timer.ts`、`packages/namespace-runtime/test/real-persistence-scheduler.ts`）。wiki/raw 流程文档为上下文，非代码审查对象。
- 审查执行：两个独立并行 subagent（通用路由，与总控同模型线），Standards 轴（仓约/注释声称/测试纪律/生命周期防御/可维护性）与 Spec 轴（issue #107 AC1–AC8 + 设计 R1 裁决 1–10 + SA2 B1/B2/B3/L-1 落实）。

## Verdict

| 轴 | Verdict | 阻断 | 非阻断 |
|---|---|---|---|
| Standards | **PASS** | 0 | 7 条建议 |
| Spec | **PASS** | 0 | 5 条观察 |

## 关键独立证据（两轴各自实跑/实读，非转述）

- Spec 轴：设计 §8 步骤 12 sweep 命令逐字重跑**输出恰 1 行**（docs/adr/0009:26，有意保留）；旧符号全仓 grep 零活残留；43 文件消费方清单逐一分类核实；AC4 守卫三正则 × 14 样本 node 仿真（8 合法全过、6 非法全中）+ 七生产文件实扫零命中；`pnpm typecheck` exit 0；vitest persistence 76/76、dsh-persistence 21/21、namespace-runtime 118/118。
- Standards 轴：注释声称逐条对照 cordis 4.0.1（reflect/fiber/service/utils 全文）与 cordis-plugin-timer 1.1.3 源码核实成立；只读 tsx 实测：fake-timer.ts 非 vitest 进程可载 / testing.ts 不可载（拆分理由实证）、同 ctx 二次装 timer loud throw、`ctx.fiber.dispose()`×2 后 accessor 摘除、disposer 幂等；sleep(250)/waitForFlush 零残留 grep。
- lifecycle.ts 逐 hunk 核对：严格只换缝名（7 调用点 + import/字段/构造 options），状态机/退避公式/generation 记账零改动（AC6）。

## 非阻断项的总控裁决记录（两轴均判非阻断，不违反 issue 范围与仓约）

1. **`createFakeTimerPlugin` 独立为 `src/fake-timer.ts` + `./fake-timer` subpath**（偏离设计 §4.F/§4.H 文件计划）：动因 = testing.ts 顶层 import vitest，探针 CLI 真实子进程被拖崩（"Vitest failed to access its internal state"，dsh-probe-cli 6 红 + determinism 1 红实测）；`./testing` re-export 保住 §3.2 公共面。总控裁定修法并备案 dispatch log「修复 A」。两轴认可。
2. **namespace-runtime 13 测试文件 + real-persistence-scheduler.ts**（偏离设计 §9 DENY「零改动」）：设计侦查对 src 成立（5 处 import type 零改动）但对 test 误判（29 构造点运行时直接构造 adapter，裁决 2 必填 scheduler 强制必改）。改动为最小机械注入（真实计时器替身，与旧默认 system timer 逐秒等价），符合裁决 2「测试显式注入不算 AC4 违规」。总控裁定备案 dispatch log「修复 B」。两轴认可。
3. **`ctx.mixin('timer', ['timeout'])` disposer 未捕获（fake-timer.ts:59）**：Standards 轴源码级证伪泄漏风险——mixin 内部即 `fiber.effect`（reflect.ts:364-390），fiber 无条件跟踪（fiber.ts:520）、unload 逆序清理（fiber.ts:676-686）；上游 TimerService 构造器同款先例（timer src/index.ts:15）；dispose×2 实测 accessor 摘除。记录不修。
4. **AC1 常量断言锚点位置**：设计 §5 指名 persistence-contract.test.ts，实际常量断言落在 dsh-profile-acceptance.test.ts:107/437；字面值由 core-dsh-boundary/memory/file 的 `ctx.get('nomicorePersistence')` 与 require 文案断言钉死，经 provide 传递性绑定常量===字面值。实质满足，不修。
5. **fake-timer.ts:12 注释「一律 property-signature」过宽**（56 行 `apply` 自身为 method-shorthand，不在 AC4 守卫词表内）与 **JSDoc 禁令 vs file-persistence.test.ts:396 用法的字面张力**（该组合段不 advance 时间线，危害不可达，且设计 §6.2 指名此接线）：措辞级，不修。
6. **dsh clock.ts:44「非负仅前进」措辞**（ManualClock.set 允许回跳，timeline 仅以递增值调用）：行为无虞，不修。
7. **persistence-contract.test.ts fake-seam 断言粒度**（pendingDelays 精确值 → pending 计数）：触发序/取消语义仍由 calls 数组钉死，不修。
8. **core-dsh-boundary 负向 A/B 的 Context 未显式 dispose**：仅持有 systemClock provide effect，无 OS 资源，可忽略级，不修。
9. **注释级历史符号提及 ×2**（dsh clock.ts:17、probe.ts:77）：非活符号、不在 sweep 变体清单内，与仓内注释惯例一致，不修。

## 修复与验证链（blocking 历史，均已闭环）

| 轮 | 发现（当时阻断） | 修复者 | 验证 |
|---|---|---|---|
| 修复 A | vitest 经 persistence/testing 拖进探针 CLI 子进程（dsh 7 用例红） | SA3（5d598d01） | CLI exit 0 events=28；dsh 21/21、persistence 三文件 49/49 绿 |
| 修复 B | namespace-runtime 13 测试文件未随必填 scheduler 同步（45+ 用例红） | SA6（d1c2b01a） | nsr 22 文件 118/118 绿；全仓 tsc EXIT=0 |
| 修订轮 | 新 helper 注释含旧符号字面名使 sweep 变 3 行 | SA6 同会话续传 | sweep 恰 1 行（总控亲跑复核一致） |
