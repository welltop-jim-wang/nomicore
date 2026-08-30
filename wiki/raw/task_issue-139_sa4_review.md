# SA4 静态验尸报告 — Issue #139（`apps/yjs-server` Hub/Peer 组合根）

**Date**: 2026-08-30
**Reviewer**: SA4（独立静态审核；未修改任何生产代码/测试/配置，仅写本报告）
**审核对象**: `git diff d911025..HEAD`（commit `199be62` + `758c3c4`）+ 当前 worktree 变更（`git status`：仅 `?? wiki/raw/task_issue-139_*` 非提交物，零生产文件脏改）
**Verdict**: **reject**（2 项可共同修复的阻断缺陷，回流目标 SA3；一并附全部非阻断发现与测试缺口，固定复验范围见 §R）

---

## 0. 审核基线与独立验证证据

- 设计基线：`wiki/raw/task_issue-139_design.md`（READY R2）+ `task_issue-139_sa2_review_r3.md`（PASS）。
- 独立复跑（非采信 SA3 声明）：`./node_modules/.bin/vitest run apps/yjs-server/test`（独立 setsid 进程）→
  **5 files / 28 tests 全绿，Type Errors: no errors，EXIT=0**（`/tmp/sa4-139-run.log`）。与 SA3 报告一致。
- 零 `packages/**` 改动（diff 文件清单核实）；DENY LIST（packages/、docs/adr/、docs/phases/、CONTEXT.md、tests/acceptance/）零触碰；BLACKLIST（package-lock.json / yarn.lock / TASK.md / *.bak / .DS_Store）零命中；`pnpm-lock.yaml` 仅新增 `ws@8.21.3` / `@types/ws@8.18.1` + app importer（+58 行，白名单生成物）。
- **CI 触发性（skill §1.3/§1.4）**：`.github/workflows/ci.yml` `Test: pnpm test` → 根 `vitest.config.ts` include 已含 `apps/*/test/**/*.test.ts`；`Typecheck: pnpm typecheck` 已追加 `tsc -p apps/yjs-server/tsconfig.json`。app 测试与类型面均已接通 CI。✅
- **文件 Scope（skill §1.1）**：actual 22 文件全部落在 ALLOW LIST 语义范围内；唯一文件名级偏差 = `test/smoke-skeleton-red.test.ts`（SA6 以其替换 T3 `hub-peer-smoke-red.test.ts`，缩减为 3 用例骨架，SA6 红报 §0 明示取舍并经总控许可）——**不判 scope-creep**，但其覆盖后果记入 §4 测试缺口。
- **契约改动连锁（skill §1.6）**：纯新增 app 模块，零既有 export 契约改动，与设计 §7 声明一致。N/A。✅
- **源码 grep 断言禁令（skill §1.7）**：5 个测试文件全部锚定运行时可观察行为（动态 import 抛错/深冻结/子进程 NDJSON/exit code/stdin 回执），零 `readFileSync(源码)+toMatch` 反模式。✅

## 审核结论（8 项）

1. **设计一致性**：⚠️ 偏离 —— 4 处实现级偏离中 3 处已由 SA3 报告 §4 声明且论证成立（wrapWs CONNECTING 缓冲、`httpServer.close()` 不等回调、file 排空窗口、boot 取消感知——后两者见下）；**1 处未声明**：停机改为手工编排（`app.ts:363-405` 直接调 `registry.shutdown()` / `persistenceFiber.dispose()` / `ctx.fiber.dispose()`，设计 §3.6 明文「不手工调 registry.shutdown() 也不手工 dispose registry fiber」）。经核实该偏离**无害**：可观测停机序（`replication-drained→registry-stopped→persistence-disposed→app-stopped`）与设计一致、`stop()` single-flight、`registry.shutdown()` 同 Promise 幂等（`registry.ts:1977-1991`）、复制插件 disposer 二次执行走幂等 close/stop —— 不阻断，但 SA3 须在实现报告补声明或请 SA1 修订 §3.6 表述。
2. **读写路径一致性**：✅ 一致 —— 直引/provision 双形式授权绑定表（`app.ts:195-224, 290-301`）为 authorize 唯一读源，owner 单源规则落地；peer `peerOwners`（config targets + add-target）与 `knownNamespaces`（provision ∪ 直引）读写同源。
3. **静默失败**：✅ 基本无 —— stdin 每行恰一回执（`main.ts:125-139` 兜底 catch）；provision 失败 → `provision-failed` + exit(1)；listen 失败 reject → exit(1)。❌ 两处例外见 B1（重复 token 值静默别名）与 N4（内部错误错标 `unknown-op`）。
4. **降级方案**：⚠️ —— file 停机排空用「固定 sleep(maxDirtyMs+500ms)」而非显式 flush：经核实 `PersistenceLifecycle.dispose()` 确实只 abort+clearTimers 不冲刷（`lifecycle.ts` dispose 体），包层无公共 flush API，等待窗是零包改动的合理落地（等待期 ctx 未拆、`ctx.timeout` 武装有效）——**方案本身成立**；但其与 60s 固定 watchdog 的数值矛盾构成 B2 阻断。
5. **极端攻击**：❌ 发现 2 项可静态确认缺陷（B1 token 别名、B2 watchdog/排空窗矛盾 + reload 无 watchdog），详见 §R。
6. **错误处理**：✅ 完整度高（config violations 聚合、stdin 稳定码、SIGHUP 先验证后拆卸、锁 EACCES/EPERM/stale 分支齐全）；❌ 缺口 = N3（reload 停旧半程异常 → unhandled rejection 而非结构化 loud exit）、N4。
7. **架构评估**：✅ 可行 —— 组装序/启动序（绑定先于 listen）/单一拆卸链/NDJSON 事件面均忠实落地；无死胡同信号，无需退回 SA1。
8. **过度设计**：✅ 精简 —— 无多余抽象；`STABLE_OP_ERROR_CODES` 仅导出作文档锚未强制执行（可接受）。

---

## R. REJECT 阻断包（两项，同批修复，回流目标 SA3；修复面 = `apps/yjs-server/src/config.ts` + `src/main.ts`（±`src/app.ts` 常量导出）+ 配套测试）

### B1【安全/配置校验】重复 token 值不被拒绝 → 静默身份别名（last-wins），授权按错误身份裁决

- **证据**（静态可复核）：
  - `apps/yjs-server/src/config.ts:246-257`（`validateTokens`）：逐键校验 key 文法与 value 非空，**无跨键 value 去重**；
  - `apps/yjs-server/src/app.ts:208-211`：`for (const [peerInstanceId, token] of Object.entries(hubConfig.tokens)) tokenToPeer.set(token, peerInstanceId);` —— Map 同 key 后写覆盖。
- **影响**：`hub.tokens: {"peer-1":"t","peer-2":"t"}` 通过全部校验（零 violation，违背 §3.2「一切违反启动期同步 loud」纪律）；随后**所有持 `t` 的连接都被验证为 JSON 中靠后的那个实例**（如 peer-2）。若 peer-2 配有 authorization 条目，peer-1 即以 peer-2 身份获得 read/submit 授权并在 **peer-2 的 localOwner 持久分区**下复制/写入（跨租户数据落错 owner）；若只有 peer-1 有授权条目则 peer-1 全部 channel `failed`（fail-closed 但不可诊断）。verifyToken 是本 app 唯一凭据边界（§3.3 零预检），该边界上的静默别名不可接受。
- **修复**（SA3，小改）：`validateTokens` 内建 `Set<string>` 检测重复 token 值 → violation `hub.tokens.<key>: duplicate token value (token values must be unique per peer)`；T1 增 1 用例。设计 §3.2 未写此规则 —— 一并请 **SA1** 在 §3.2 tokens 行补「value 全表唯一」半句（设计级补注，非重新设计）。
- **复现**（修复前）：`parseAppConfig({role:'hub',instanceId:'hub-1',persistence:{kind:'memory'},hub:{listen:{host:'127.0.0.1',port:0},tokens:{'peer-1':'t','peer-2':'t'}}}})` → 正常返回（应拒）。

### B2【生命周期/配置交互】固定 60s watchdog 短于自身排空窗；SIGHUP 换装路径完全无 watchdog

- **证据**（静态可复核）：
  - `apps/yjs-server/src/main.ts:24`：`STOP_WATCHDOG_MS = 60_000`（固定）；
  - `apps/yjs-server/src/app.ts:386-389`：file 模式停机排空 `sleep(maxDirtyMs + 500)`，其中 `maxDirtyMs` 来自配置且校验仅要求「正有限数」（`config.ts:198-211`）→ 配 `maxDirtyMs: 60000` 时排空窗 60.5s **> 60s watchdog**；
  - `apps/yjs-server/src/main.ts:80-121`（`reload`）：停旧半程 `await state.app.stop()` 与装新半程 `await state.app.ready` **均无任何超时保护**。
- **影响**：
  1. `maxDirtyMs ≥ ~59_500` 的合法配置下，**每次干净 SIGTERM 都被 watchdog 强制 exit(1)**，且 exit 发生在排空 sleep 中途——`persistenceFiber.dispose()` 永不执行、被保护的 dirty flush 可能随进程终止丢失（该等待窗的全部意义被守卫自己击穿）；
  2. SIGHUP 换装若停旧链挂起（如 `hub.close()` drain 异常阻塞），进程**永久挂起**、无 error 事件、无 exit(1) —— 直接违背设计 §3.6「全程设总超时保护，超时 `exit(1)`」与 §3.7-3「严格按 §3.6 全序停旧」（全序含超时保护）。监督器在无退出下也不会重启 → 换装卡死成为静默停摆。
- **修复**（SA3，小改，二选一并闭合 reload）：① `config.ts` 对 `persistence.schedule.maxDirtyMs` 设上界（如 ≤30_000，violations loud）；或 ② `main.ts` watchdog 取 `max(STOP_WATCHDOG_MS, drainMs + 余量 + 固定停机预算)`；**且** `reload()` 的停旧/装新半程纳入同一 watchdog（超时 → error 事件 + exit(1)，与 §3.7-4 一致）。T1/新增用例各 1 条锚定。
- **回流目标**：SA3（实现）；SA1 仅需在设计 §3.2/§3.6 补「maxDirtyMs 上界或 watchdog 随排空窗缩放」的约束句（本缺陷属实现选择，非设计架构错误）。

**固定复验范围（SA4 下轮只审）**：`apps/yjs-server/src/config.ts`、`src/main.ts`（如动 `src/app.ts` 仅限常量/导出）、对应 `test/app-config-red.test.ts` 与新增 B1/B2 用例；及其直接影响面（validateTokens/validatePersistence 调用点、shutdown/reload 两条链）。其余文件不复审。

---

## 1. 非阻断发现（随包返回，SA3 可选修复或记账；不单独构成 reject）

| # | 级别 | 发现 | 证据 | 处置 |
|---|---|---|---|---|
| N1 | MINOR | 配置校验完备性缺口（违背 §3.2「未知键一律 TypeError」精神）：① `peer.hub` 块**无未知键白名单**（对照 hub/peer/listen/persistence/provision/authorization/targets 均有）；② `persistence.schedule` 多余键静默丢弃；③ provision `schema.version` 仅 `typeof number`（NaN/非有限通过）；④ **重复 `provision[].id` 不拒** → 引用该 id 的 authorization 在每个同名 provision 完成时都绑定一次（`app.ts:291-300`），一份授权授予多个 ns | `config.ts:449-457,198-211,277-289,260-300` | SA3 小改（①②④ 各 1-3 行 + 用例） |
| N2 | MINOR | 未声明设计偏离：停机手工编排 vs §3.6「不手工调」（无害：序/幂等/single-flight 已核实，见结论 1） | `app.ts:363-405` | SA3 补声明或 SA1 修订 §3.6 表述 |
| N3 | MINOR | `reload()` 停旧半程 `await state.app.stop()` 抛异常 → 逃逸出 reload（仅 finally 复位 flag）→ `void reload(state)` 产生 **unhandled rejection**（Node 默认崩溃退出），非结构化「error 事件 + exit(1)」，且跳过 `state.lock?.release()`（残留锁可被 stale 覆盖，无永久死锁） | `main.ts:101,118-120,185` | SA3 小改：reload 顶层 catch → sink error 事件 + exit(1) |
| N4 | MINOR | 控制通道内部异常回执错标 `unknown-op`（稳定码注册表无 internal-error 码），「每行恰一回执」仍成立 | `main.ts:134-137` | 记账（追加稳定码需设计 append-only 授权） |
| N5 | INFO | 换装成功后不重发 `config-loaded`（仅 `reload-complete`）；`performStop` 失败事件 `app-stop-failed` 为设计外新增（合理） | `main.ts:112-117`、`app.ts:398-404` | 记账 |
| N6 | INFO | file 模式每次停机固定支付 `maxDirtyMs+500` 排空等待（无 dirty 亦等）；默认 5.5s/次。测试断言余量充足（T3/T6 实测 11.6s/17.2s 内含） | `app.ts:386-389` | 记账（无公共 flush API 前难更优） |

## 2. 已核实为合理的实现级偏离（SA3 §4 已声明，SA4 复核通过）

1. **wrapWs CONNECTING 期 send 缓冲**（`ws-server.ts:46-75`）：包在 `dial()` 后同步发 HELLO 与 ws 异步建连的真实时序差必要落地；失败经 `'close'`(1006) 投影 → 包侧 backoff；`closed` 在 CLOSE 前恒 false 符合 A3/T2 语义。
2. **`httpServer.close()` 不等回调**（`ws-server.ts:165-174`）：node `close(cb)` 会等全部既有连接（含升级 socket）——若 await 必与 `hub.close()` 的 GOAWAY→drain 死锁；先关 listening socket（同步停接纳）+ drain 交 `hub.close()` 与 §3.6「先停接纳、后复制 drain」一致。
3. **boot 取消感知**（`app.ts:120-122,160-261` 各 await 边界）：SIGTERM 落 boot 窗口 → 静默取消 → ready resolve → 干净 exit 0；亦使 SIGHUP-during-boot 不触发旧 ready 的 boot-failed exit。
4. **锁获取前 `mkdirSync(rootDir,{recursive:true})`**（`lifecycle.ts:63-66`）：免 ENOENT 误导文案，语义零变化。

## 3. 安全/脱敏复核

- NDJSON 事件面零 token/owner 值/Yjs bytes/SCHEMA/ROOT 内容（app 自有事件逐一核对；复制域事件直通包已脱敏联合）；token 反查表不进任何事件。✅
- 认证面与设计 §3.3/R1 #7 冻结一致：路径 ≠ `/replication` → 404；相符一律完成 upgrade 后 `accept`，适配层零凭据预检，`verifyToken` 单次调用在包内。✅
- 锁守卫（§3.4/R1 #5）：`wx` 独占、同实例/异实例文案区分、stale pid 覆盖、EACCES/EPERM loud、EPERM=存活 判定正确；TOCTOU 由 `wx` 原子性收敛。✅
- `/healthz` 无认证但零信息（"ok"）；TLS 外置已按 ADR 0010 在部署文档醒目要求。✅
- 唯一安全面缺口 = **B1**（见上）。

## 4. 测试缺口（对照设计 §5；SA6 裁剪经总控许可并文档化 —— 列为缺口与 SA7 靶点，不判 SA3 reject）

**自动化未覆盖**（SA3 报告 §6 已如实声明 + 本审核确认代码已实现、仅手工验证）：
- **T7 全部**（R1 为回应 SA2 CRITICAL #3 而立）：malformed-line / unknown-op / namespace-unknown / verify-write-timeout 逐行恰一 error 回执且进程不退；SIGHUP 坏 config → `config-error` + 旧实例继续服务；换装中重复 SIGHUP → `reload-ignored`；
- **T3 重型步骤**：SIGHUP 换装链（改 token → 旧 token 拨号 `auth-upgrade-rejected`(invalid-credentials) → 新 token 新进程 live → 旧 peer 保持 blocked 负例静默窗口）——**AC3 restart-only 变更面当前零自动化覆盖**；
- **T2 全部**：ws 传输单元（帧回显、close code/reason 直通、bufferedAmount、ping/pong、`closed` 翻转时序）；
- hub 侧 `verify-write` 对称路径、`request-reauth` e2e。

已交付的 T1（20）/T4（2）/T5（2）/T3-skeleton（3）/T6（1）质量良好：真行为断言、事件序/exit code/stdin 回执锚定、无源码 grep 反模式；T6 完整兑现 R2 NB-1 blocked-recovery 断言链（goaway→blocked→静默窗口→notify→收敛）。

## 5. 动态审核重点（交 SA7，`task_issue-139_sa7_report.md` 逐条回复）

1. **SIGHUP 换装全链**（tsx 不转发 SIGHUP —— 部署文档已明示，须对脚本进程发信号或用裸 node）：好 config → `reload-starting→reload-complete` 且新 token 生效；坏 config → `config-error` + 旧实例原 token 连接仍被接纳；双 SIGHUP → `reload-ignored`。
2. **错 token 拨号** → hub NDJSON `auth-upgrade-rejected`(reason=`invalid-credentials`)；缺 Authorization 头 → `missing-token`（R1 #7 观测锚，零自动化覆盖）。
3. **B2 数值矛盾运行时复现**：`maxDirtyMs: 60000` 配置下 SIGTERM → 观察是否 60s watchdog `exit(1)`（修复验证的反向靶）。
4. stdout 为管道时 `process.exit` 对末尾 NDJSON 事件的截断风险（`app-stopped` 等末事件是否总能到达读端）。
5. boot 窗口信号竞态：SIGTERM-during-provision / SIGHUP-during-boot / reload 中 SIGTERM 的实际事件序与 exit code。
6. CONNECTING 缓冲压力路径：慢握手下 HELLO 排队冲刷、握手失败 1006→backoff 投影。
7. CI 证据摘录：`gh run view --log` 中 `apps/yjs-server/test` 5 文件被 `pnpm test` 收集执行的日志行（skill §1.4 SA7 联动）。

---

## 6. 结论

实现整体忠实于 R2 设计、质量高、独立复跑全绿；但 **B1（重复 token 值静默身份别名——凭据边界上的校验漏洞）与 B2（watchdog/排空窗数值矛盾 + reload 零超时保护——违背设计明文的总超时保护义务）为可静态确认的阻断缺陷**。两项修复面小且同批可修（config.ts/main.ts ± 常量 + 2-3 条测试用例），合并为一个回流包退 **SA3**；SA1 仅需两句设计补注（tokens value 唯一、maxDirtyMs 上界/watchdog 缩放）。N1-N6 与测试缺口随包返回，不单独成轮。固定复验范围见 §R 末段。
