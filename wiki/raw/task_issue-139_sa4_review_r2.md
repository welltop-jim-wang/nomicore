# SA4 静态验尸报告 R2（独立复审）— Issue #139 B1/B2 阻断修复

**Date**: 2026-08-30
**Reviewer**: SA4（独立静态复审；未修改任何生产代码/测试/配置，仅写本报告）
**审核对象**: commit `4d9fff5`（= `git diff 758c3c4..4d9fff5`，恰好 4 文件：`apps/yjs-server/src/config.ts`、`src/main.ts`、`test/app-config-red.test.ts`、`test/lifecycle-watchdog-red.test.ts`）
**复验范围**: 严格限于 R1 固定复验范围（`wiki/raw/task_issue-139_sa4_review.md` §R 末段）——config.ts、main.ts、两份直接测试 + 直接影响面（`parseAppConfig` 调用点、`validateTokens`/`validatePersistence` 调用链、shutdown/reload 两条链、`app.ts` 排空窗常量引用）。其余文件不复审。
**Verdict**: **PASS**（B1、B2 均确认真正解决；N3 随包闭合；范围内无新阻断项。4 条非阻断观察见 §O，其中 3 条交 SA7/SA1 记账）

---

## 0. 审核基线与独立验证证据（非采信 SA3 声明）

- **基线**: R1 reject 报告 `task_issue-139_sa4_review.md`（B1/B2 阻断包 + 固定复验范围）；SA3 R2 实现报告 `task_issue-139_sa3_r2_impl.md`。
- **范围纪律**: `git diff --name-only 758c3c4..HEAD` = 恰好上述 4 文件，零溢出。`app.ts` 未动（R1 允许「仅常量/导出」，实际无需）；零 `packages/**`；工作树相对 HEAD 零脏改（仅 `?? wiki/raw/task_issue-139_*` 非提交物）。全任务 diff（`d911025..HEAD`，23 文件）BLACKLIST/DENY 零命中。
- **独立复跑**（setsid 独立进程，命令 + 结果）：
  - `./node_modules/.bin/vitest run apps/yjs-server/test`（第一次）：6 files / 31 tests，**1 失败**（`smoke-skeleton-red.test.ts`「clean shutdown releases the rootDir lock」用例，`verify-write` 回执 ok=false）→ 见 §O5 排查；
  - 同命令复跑（第二次）：**6 files / 31 tests 全绿，Type Errors: no errors，EXIT=0**；
  - `./node_modules/.bin/vitest run apps/yjs-server/test/smoke-skeleton-red.test.ts` 隔离连跑 3 次：**3×3 passed，EXIT=0**；
  - `pnpm typecheck`：**EXIT=0**（含 `tsc -p apps/yjs-server/tsconfig.json`）。
- **CI 触发性（skill §1.3/§1.4）**: 新增 `test/lifecycle-watchdog-red.test.ts` 与改动的 `test/app-config-red.test.ts` 均命中根 `vitest.config.ts` include `apps/*/test/**/*.test.ts` → `.github/workflows/ci.yml` `Test: pnpm test` 覆盖；类型面经 `Typecheck: pnpm typecheck` 覆盖。✅
- **源码 grep 断言禁令（skill §1.7）**: 两份新增/改动测试全部锚定运行时可观察行为（动态 import + throw 断言；真实 tsx 子进程 + NDJSON 事件 + exit code + stderr），零 `readFileSync(源码)+toMatch` 反模式。✅
- **契约改动连锁（skill §1.6）**: `MAX_MAX_DIRTY_MS` 为纯新增 export；`validateTokens`/`validatePersistence` 为私有函数签名不变；`reload()` 未导出。零既有 export 契约改动。N/A。✅

## 1. B1 复验：重复 token 值 → 启动期 loud 拒 —— **确认解决** ✅

- **实现核对**（`config.ts:256-288`）：`validateTokens` 内建 `seenTokenValues: Set<string>`，逐条目（key 文法/值非空先过）查重——重复 → violation `{path: 'hub.tokens.<key>', reason: 'duplicate token value (token values must be unique per peer)'}`，随后仍 `add` 入 Set（三重复时第 2、3 条均报）。与 R1 处方逐字一致。
- **loud 链路闭合**：violations 聚合后 `parseAppConfig` 第二道 `violations.length > 0 → throw new ConfigValidationError`（`config.ts:574-579`，TypeError 子类，message 逐条 `path: reason`）。两个入口均核实：
  - boot：`main.ts:168-177` → `config-error` NDJSON + stderr `config violation …` + `exit(1)`；
  - reload 前置验证：`main.ts:100-108` → `config-error` 事件 + 旧实例继续服务（先验证后拆卸纪律保持）。
- **根因面闭合**：`AppConfig` 在本 app 的唯一构造路径是 `parseAppConfig`（boot `main.ts:168` / reload `main.ts:101`；`createNomicoreApp` 消费其产物）——`app.ts:208-211` 的 `tokenToPeer` Map last-wins 覆盖构建**不再可能收到重复 value**，静默身份别名路径根除。
- **边界攻击**（静态推演）：① key 违法 + value 重复 → 两类 violation 同时报（仍 loud）；② value 非字符串/空串 → 走非空串分支，不入 Set（两处同报 non-string violation）；③ `'peer-1'/'peer-2'` 为非数字型键 → `Object.entries` 保插入序，「violation 锚在靠后键」确定性成立；④ 深冻结/深比较无关，无哈希碰撞面（Set 全字符串精确匹配）。
- **测试核对**（`app-config-red.test.ts:238-249`）：动态 import 真 `parseAppConfig`，`{'peer-1':'shared-token','peer-2':'shared-token'}` → 断言 `instanceof TypeError` + message 含 `hub.tokens.peer-2: duplicate token value`（直接锚定 last-wins 的别名接受者）。真行为断言，本审核两轮全量 + SA3 报告一致绿。

## 2. B2 复验：maxDirtyMs 上界 + reload 总超时 watchdog —— **确认解决** ✅

### 2.1 数值矛盾根除（R1 处方选项 ①）

- `config.ts:34` `export const MAX_MAX_DIRTY_MS = 30_000`；`config.ts:223-228`：schedule 通过正有限数检查后，`maxDirtyMs > 30_000` → violation `persistence.schedule.maxDirtyMs`（reason 明示 watchdog 覆盖理由）。
- 数值链独立复核：排空窗 = `maxDirtyMs + DRAIN_MARGIN_MS(500)`（`app.ts:387,59`）≤ **30_500ms 严格短于** `STOP_WATCHDOG_MS = 60_000`（`main.ts:24`）——合法配置（含上界值 30_000 本身）的干净 SIGTERM 排空永不被 watchdog 击穿，剩余 ≥29.5s 覆盖其余拆卸链（ws close + 包内 deadline 有界的复制 drain + registry.shutdown + fiber dispose，各段均有自有上界，总量级远低于余量）。与 R1 建议值（≤30_000）一致。
- 边界：`30_000` 恰过 / `30_001` 拒——测试双向锚定（`app-config-red.test.ts:253-268`，上界值解析成功断言 `kind==='file'`）；`NaN/Infinity` 走既有 positive-finite violation；memory 持久化无排空窗不受影响；未配 schedule → 缺省 `DEFAULT_MAX_DIRTY_MS=5_000`（`app.ts:57`）安全。
- **R1 反向靶闭合**：`maxDirtyMs: 60000` 配置不再存在「60s 后 watchdog exit(1) 击穿排空」路径——boot 即拒。`lifecycle-watchdog-red.test.ts` 以真实 tsx 子进程锚定：exit 1 + stderr `config violation persistence.schedule.maxDirtyMs` + stdout `config-error` 事件 + 输出**不含** `watchdog timeout`（~300ms，CI 可承受）。

### 2.2 reload 全链纳入总超时 watchdog（R1 的「且」条款）

- `main.ts:90-95`：单飞门后立即武装 `setTimeout(…, STOP_WATCHDOG_MS)`，`unref()`（不维持事件循环）；覆盖面独立 trace：① 配置重验证（`readFileSync`+`JSON.parse`+同步校验，不可挂）；② 停旧 `await state.app.stop()`（含 file 排空窗，上界由 §2.1 保证 < 60s）；③ 锁删/取（同步）；④ 装新 `createNomicoreApp` + `await state.app.ready`。任一半程挂起 → 60s 触发：stderr `reload watchdog timeout` + NDJSON `reload-failed`(reason=watchdog-timeout) + `exit(1)`——符合 §3.6「全程总超时保护」与 §3.7-4 运行期失败 loud 语义，SIGHUP 无限静默停摆路径消除。
- `finally` 中 `clearTimeout`（`main.ts:135`）：成功/前置验证失败路径均回收定时器；`failBoot`/watchdog 的 exit 路径进程即终，无泄漏面。
- **N3 随包闭合**（MINOR，非本轮门禁但确认）：停旧 `await state.app.stop()` 包 try/catch（`main.ts:111-117`）→ `failBoot`（stderr + exit(1)，返回 `never`，控制流收口）——unhandled rejection 逃逸消除；且 app 层 `performStop` 失败时先发 `app-stop-failed` NDJSON（`app.ts:398-404`）再 rethrow，可观测链（事件→stderr→exit 1）完整；锁残留由既有 stale-pid 覆盖路径兜底（R1 已核）。
- 信号交互复核：reload 中 SIGTERM → `shutdown` 与 `stop()` 同 `stopPromise` single-flight 后 `exit(0)`，watchdog unref 不阻退出；shutdown 中 SIGHUP → `reload-ignored`（既有），无新竞态面。

## 3. 测试质量与触发（固定范围内两份文件）

| 文件 | 断言形态 | 判定 |
|---|---|---|
| `app-config-red.test.ts`（20→22 用例） | 动态 import 真 parse + throw/message/boundary 断言 | 真行为，✅ |
| `lifecycle-watchdog-red.test.ts`（新增） | 真子进程（tsx + main.ts）exit code + stderr + NDJSON + 反向断言（不含 watchdog timeout）| 真行为，✅；spawn 模式与既有 smoke-skeleton 同款（TSX_BIN/MAIN_TS 解析一致）；afterEach SIGKILL + tmpdir 清理完备 |

独立复跑证据见 §0（两轮全量 31/31 绿 + 隔离 3×3 绿 + typecheck 0）。

## O. 新见观察（固定范围内，全部非阻断）

| # | 级别 | 发现 | 证据 | 处置 |
|---|---|---|---|---|
| O1 | MINOR | 跨文件数值不变量 `MAX_MAX_DIRTY_MS + DRAIN_MARGIN_MS < STOP_WATCHDOG_MS` 仅由注释维持：`STOP_WATCHDOG_MS` 是 main.ts 模块私有常量，无任何测试锚定该不变量——未来单侧改常数可静默复活 B2 | `config.ts:27-34` 注释、`main.ts:24` 私有 const | 记账交 SA6/后续：导出 `STOP_WATCHDOG_MS`（或提共享常量）+ 1 条静态不变量断言（`MAX_MAX_DIRTY_MS + 500 < STOP_WATCHDOG_MS`）。当前数值正确，非功能缺陷 |
| O2 | INFO | reload watchdog 的**触发臂**（60s 挂起 → reload-failed + exit 1）零自动化覆盖（需人为挂起才能驱动）——静态代码已核实，行为面待动态验证 | `main.ts:90-95` | 交 SA7（R1 动态清单第 1 条的子项，验证时注意 tsx 不转发 SIGHUP） |
| O3 | INFO | watchdog 超时臂先 `state.sink(reload-failed)` 再 `process.exit(1)`——stdout 为管道时末事件存在截断风险，与 R1 动态清单第 4 条同类 | `main.ts:92-93` | 交 SA7：动态清单第 4 条扩 cover `reload-failed` |
| O4 | INFO | 设计补注仍 pending：① §3.2 tokens「value 全表唯一」句；② §3.2/§3.6 maxDirtyMs 上界句；③ §3.5 事件清单缺 `reload-failed` 词条（SA3 已声明该新事件） | `task_issue-139_design.md` grep 无命中；`task_issue-139_sa3_r2_impl.md` §2/§3 已请求补注 | 交 SA1 三句补注（R1 已定性「设计级补注，非重新设计」，不阻断本复验） |
| O5 | INFO（范围外） | 全量并行跑 1 次 `smoke-skeleton-red.test.ts`「restart reads back durable value」用例失败（`verify-write` ok=false）；**与本 commit 因果无涉**：该测试配置（唯一 token `token-1`、缺省 schedule maxDirtyMs=5_000 ≤ 上界）不触新校验、失败步骤（首 boot 期复制收敛）位于本 commit 未触碰的 app/transport/replication 代码、且从不发 SIGHUP（watchdog 不武装）。隔离 3 连跑 + 全量复跑均绿 → 并行负载下真子进程时序 flake | `/tmp/sa4-r2-run.log`（1 失败）vs `/tmp/sa4-r2-run2.log`（31/31 绿）+ 3× 隔离绿 | 记账（CI 偶发红风险），非本轮判定输入；SA7/CI 侧留意 |

## 4. 结论

R1 固定复验范围内逐项核销：

1. **B1 真正解决** ✅——重复 token 值在唯一配置入口（boot/reload 双路径）loud 拒绝，last-wins 身份别名不可达；边界（非法 key、非串值、三重复、插入序确定性）静态攻击全部收敛；测试真行为锚定。
2. **B2 真正解决** ✅——maxDirtyMs ≤ 30_000 上界使排空窗（≤30.5s）严格小于 60s 总超时 watchdog（余量 ≥29.5s，边界值双向测试锚定，反向靶配置 boot 即拒）；reload 停旧/装新整链纳入同一 watchdog（unref + finally 清理 + 超时 reload-failed/exit(1)），SIGHUP 静默停摆与合法配置被 watchdog 击穿两条路径均根除；N3 随包闭合。
3. **范围内无新阻断**：O1-O5 均为记账级（测试债/动态验证/设计补注/范围外 flake），无一构成 pass 障碍。

**Verdict: PASS**。可进入后续动态验证；O2/O3 并入 SA7 动态清单，O1 记测试债，O4 交 SA1 补注，O5 供 CI 稳定性参考。
