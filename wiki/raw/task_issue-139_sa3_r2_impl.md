# SA3 实现报告（R2 修复轮）— Issue #139（`apps/yjs-server` Hub/Peer 组合根）

**Date**: 2026-08-30
**Implementer**: SA3（TDD 执行者；R2 修复轮）
**回流依据**: `wiki/raw/task_issue-139_sa4_review.md` §R（B1/B2 阻断包）——两项全部修复，随包非阻断项 N3 一并处理（小改 + 与 §3.7-4 同向），N1/N2/N4/N5/N6 记账未动。
**修复范围**: 严格限于 SA4 固定复验范围 —— `apps/yjs-server/src/config.ts`、`src/main.ts`、对应测试（`test/app-config-red.test.ts` 增用例 + 新增 `test/lifecycle-watchdog-red.test.ts`）。**零** `packages/**`、零 `app.ts`、零 `index.ts`、零配置/CI 改动。
**Commit**: `4d9fff5`（本地）—— `fix(apps/yjs-server): SA4 B1/B2 阻断修复——重复 token 值 loud 拒、maxDirtyMs 上界、reload 总超时 watchdog（issue #139）`；4 文件，+212/-1。

---

## 1. B1【安全/配置校验】重复 token 值 → 启动期 loud 拒 ✅

- **修复**（`config.ts` `validateTokens`）：新增 `seenTokenValues: Set<string>`，逐键校验 value 非空后查重；重复 → violation
  `hub.tokens.<key>: duplicate token value (token values must be unique per peer)`（锚定在 JSON 中靠后的键 = last-wins 反查表的别名接受者）。空/非字符串 value 不进 Set（避免与「非空 string」violation 双重误报）。`parseAppConfig` 汇总后抛 `ConfigValidationError`（TypeError 子类）→ 启动与 SIGHUP 换装共用同一校验器，两条路径都 loud。
- **为何在此修**：`tokenToPeer` 反查表是 `Map`（`app.ts:208-211`），重复 value 的静默别名只能从配置校验层根除——适配层零预检契约（§3.3）与包侧 `verifyToken` 均不可动。
- **测试**：`app-config-red.test.ts` 新增 `rejects duplicate token values across hub.tokens entries (SA4 B1: last-wins identity aliasing)` —— `{'peer-1':'shared-token','peer-2':'shared-token'}` → 捕获异常断言 `instanceof TypeError` 且 message 含 `hub.tokens.peer-2: duplicate token value`（直接锚定「loud + 靠后键」）。

## 2. B2【生命周期/配置交互】maxDirtyMs 上界 + reload 总超时 watchdog ✅

SA4 §R-B2 给出二选一：① `config.ts` 设 maxDirtyMs 上界（≤30_000，violations loud）；或 ② main.ts watchdog 随排空窗缩放；**二者都要求** reload 停旧/装新纳入同一 watchdog。本次选 **①**（理由见下），并完整闭合 reload watchdog。

- **① 上界**（`config.ts`）：`export const MAX_MAX_DIRTY_MS = 30_000;`（文档注释锚定与 `STOP_WATCHDOG_MS=60_000` 的数值关系）；`validatePersistence` schedule 分支：`maxDirtyMs > MAX_MAX_DIRTY_MS` → violation
  `persistence.schedule.maxDirtyMs: maxDirtyMs must be <= 30000 (the stop total-timeout watchdog must cover the dirty-flush drain window)`。
  - 排空窗 = `maxDirtyMs + 500`（`app.ts:387`）≤ 30_500ms **严格短于** 60_000ms watchdog → 合法配置下干净 SIGTERM 永不被 watchdog 击穿；dirty flush 保护窗口在「持久化 fiber 卸载前等调度窗」语义下成立。
  - 上界仅作用于显式 `schedule`；缺省（`DEFAULT_MAX_DIRTY_MS=5_000`）不受影响；`debounceMs` 不参与排空窗、不设上界。
  - **选 ① 而非 ② 的理由**：① 把数值矛盾在配置层面 loud 根除（与 §3.2「一切违反启动期同步 loud」纪律同向），零 `app.ts`/`index.ts` 改动、零公共面扩张、测试可在 T1 纯单元锚定（快速、确定性）；② 需导出 app.ts 排空常量并在 main.ts 计算，运行时验证需 ≥60s 真实排空（CI 不可接受），且公共函数不可经包入口达（index.ts 超范围）。两种方案 SA4 均明确许可（「二选一并闭合 reload」）；实现选择已在文档锚定，请 SA1 在设计 §3.2 补一句 `maxDirtyMs 上界（MAX_MAX_DIRTY_MS=30_000，watchdog 覆盖纪律）`（设计级补注，非重新设计）。
- **reload 总超时 watchdog**（`main.ts` `reload()`）：
  - `reload()` 单飞门后立即武装 `watchdog = setTimeout(…, STOP_WATCHDOG_MS=60_000)`（`unref`），覆盖**停旧**（`await state.app.stop()`，含 file 排空窗——上界 ① 保证 < 60s）与**装新**（`await state.app.ready`）整条链；`finally` 中 `clearTimeout`。
  - 超时 → stderr `reload watchdog timeout: force exit(1)` + NDJSON `{"event":"reload-failed","reason":"watchdog-timeout","message":"reload total-timeout watchdog fired"}` + `exit(1)` —— 与 §3.7-4「输出对应 error 事件后 exit(1)」一致；进程监督器重启兜底。
  - **新事件 `reload-failed` 声明**：换装链无既有 error 事件名（`config-error` 专属前置验证失败），watchdog 超时臂需要独占事件——与 N5 确认的 `app-stop-failed`（设计外新增、合理）同先例。事件面 §3.5 清单需 SA1 补一词条。
  - `watchdog.unref()`：与 shutdown watchdog 同语义（不自行维持进程存活；进程由 app 活句柄维持）。
- **N3（随包 MINOR）顺带修复**：`await state.app.stop()` 包 try/catch → 异常不再逃逸为 unhandled rejection，改 `failBoot(state, 'reload stop-old failed: …')`（stderr + exit(1)，§3.7-4 loud 语义；锁在 stop 失败时不释放——进程随即退出，残留锁由 stale-pid 覆盖路径兜底）。**注意**：与 B2 的 reload watchdog 同文件同函数，一次实现顺带闭合（2 行），不单独成轮。
- **测试**：
  - `app-config-red.test.ts` 新增 `rejects file persistence maxDirtyMs above the stop-watchdog budget (SA4 B2: …)`：`maxDirtyMs: 30_001` → `ConfigValidationError` 且 message 含 `persistence.schedule.maxDirtyMs`；`maxDirtyMs: 30_000`（上界本身）→ 解析通过（kind=file）。
  - 新增 `test/lifecycle-watchdog-red.test.ts`（`B2: total-timeout watchdog vs configured dirty-flush drain window`）：真子进程（tsx）加载 `maxDirtyMs: 60_000` 配置（= SA4 §R-B2 反向靶「60s watchdog exit(1)」的原矛盾配置）→ **boot 即** `config-error` 事件 + stderr `config violation persistence.schedule.maxDirtyMs` + exit 1（~300ms），并断言输出**不包含** `watchdog timeout`——矛盾配置不再能进入「排空窗被杀」路径。

## 3. 验证证据

独立运行（非采信继承值）：

| 命令 | 结果 |
|---|---|
| `./node_modules/.bin/vitest run apps/yjs-server/test`（清净环境，二轮） | **6 files / 31 tests 全绿，Type Errors: no errors**（T1 20→22、新增 lifecycle-watchdog 1、T3/T5/T6 原有全绿；31 = 30 + 新文件 1） |
| `./node_modules/.bin/tsc -p apps/yjs-server/tsconfig.json` | **EXIT=0，零错误**（src + test 全量，两次确认） |
| smoke 重跑（隔离） | 3/3 绿（34.7s） |

- 一次并行验证轮记录（透明申报）：`vitest run` 与 `tsc` 同时启动时，`smoke-skeleton-red.test.ts` 出现 2 例失败（`verify-write` 回执 `ok:false` —— 30s 写入截止窗在 CPU 争用下超时类 flake）；**隔离重跑 smoke 3/3 绿、全量二轮 31/31 绿**。判定为非确定性时序 flake 而非回归——如实记录，SA7 复跑时可复观。
