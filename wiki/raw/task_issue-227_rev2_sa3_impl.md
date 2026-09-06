# SA3 实现报告（R2/R2.1）— Issue #227 rev2：租约取得点前移、统一 finally 与提交时刻取时

- 角色/阶段：SA3 implementation（rev2 设计 R2.1 获批 + SA2 approve + SA6 红灯契约落地后）
- Worktree：`/home/wangjian/nomicore-fix-issue-227`（branch `mabf/issue-227`），被修订基线 HEAD = **`31ff694`**
- 输入：rev2 设计 `wiki/raw/task_issue-227_rev2_design.md`（§3.1–§3.3/§7/§9）；
  SA2 窄域复审 `task_issue-227_rev2_sa2_review.md`（approve + K-binding；G-227-5 裁定采含、G-227-6 裁定平铺）；
  SA6 红灯契约 `task_issue-227_rev2_sa6_red.md` + 三个已落地测试文件
- Owner 两条必修（PR #251 评审，2026-09-06T13:14:31Z）：(1) 路径安全后、首次 manifest I/O 前取得
  read-session lease；自建 session 单一 finally 覆盖 manifest 缺失/JSON 损坏/gate 失败早退；
  manifest read/gate 与 retention sweep 并发契约；(2) S0′ 于 S1 rename 前取真实提交时刻、
  不复用 sweep-start now；sweep 后/rename 前到期 lease 可删除
- 边界：改动仅限 rev2 设计 §0.2 ALLOW 白名单（src/reader.ts、src/adapters/file.ts、包 AGENTS.md）
  + 必要 patch version bump + 本审计档案；**测试文件零改动**（SA6 已落地，本 SA 未触碰）；
  **零 git 操作**（不 commit、不 push）

## Verdict

实现完成。Owner 两条必修逐条落地，四红灯（A6a/A6b/B4b/B5-control）全部转绿，
全仓 2917/2917 通过（SA6 红基线 = 4 failed | 2913 passed——零回退），根 typecheck 14 包 exit 0。

## 1. 精确改动路径（本 SA 变更）

| 路径 | 变更 | 对应设计 |
|---|---|---|
| `packages/namespace-diagnostic-log/src/reader.ts` | `StrictReadRequest` 增可选 `clock?`（G-227-6 平铺）；`readStreamStrict` 自建臂取得点前移至 ④″（① 路径安全后、② 首次 manifest I/O 前）+ 取得检查点（拒续 → corrupt+`lease-expired`，manifest:null）+ 唯一 finally 释放（删除 ④′ enumerationFailed/⑦/⑧ 三处分散 close 站点） | D8/D9/D10（O-1）；INV-227-1 改写版 / INV-227-11 |
| `packages/namespace-diagnostic-log/src/adapters/file.ts` | `deleteGroupIfUnleased` 弃 `now` 参、S0′ 复查改适配器闭包钟 `clock.now()`（提交时刻现值）；P1/P2 调用点弃实参；P0 orphan-BIN 门同改（G-227-5 采含）+ `hygieneStream` 弃 `now` 参；`sweepRetention` JSDoc `now` 语义收窄为策略时刻 | D11 + G-227-5（O-2）；INV-227-12 |
| `packages/namespace-diagnostic-log/AGENTS.md` | #227 增量段追加 R2 句（取得点/统一 finally/提交时刻语义 + now 分工） | §0.2 文档义务（N-2） |
| `packages/namespace-diagnostic-log/package.json` | patch bump `0.1.6 → 0.1.7` | §12 V-1（本票要求） |
| `wiki/raw/task_issue-227_rev2_sa3_impl.md` | 本审计档案 | 审计档案 |

DENY zero-diff 亲证（`git diff --stat` 空）：`apps/yjs-server/**`、`src/read-session.ts`、
`src/retention.ts`、`src/index.ts`、`src/adapters/memory.ts`、`docs/**`、`CONTEXT.md`；
`deleteGroup`（S1–S3）本体零 hunk。

## 2. Owner 必修 (1) 落地（O-1 → D8/D9/D10）

- **D8 取得点前移**：④″ 位于 ①（路径文法安全，零 fs）之后、②（首次 `readFileSync`）之前；
  传入臂纯绑定（①′ 身份/已闭校验后，manifest 阶段天然持约）；自建臂 `openDiagnosticReadSession`
  透传 `request.clock`。快照派生（④′ `[...session.segments]`）位置不变——同源枚举、同步单线程
  零漂移。
- **D9 唯一 finally**：`finally { ownedSession?.close() }` 为唯一释放点；删除三处分散站点
  （原 ④′ enumerationFailed 臂 / ⑦ 聚合前 / ⑧ 兜底 catch）；覆盖 ② 缺失/JSON 损坏/非对象、
  ③ schema-compile/gate（corrupt+incompatible 双臂）/policy、④′ 反应、⑤ break、⑦ 返回、
  ⑧ 异常逃逸。传入臂不 close（replay finally 维持唯一责任方）。
- **D10 取得检查点**：自建臂注册后、② 前立即 `renewIfDue(READ_SESSION_RENEW_MARGIN_MS)`——
  即 rev2 §3.1.2 时序表 call#2（call#1 = open openAt 注册前）；拒续 → corrupt + `lease-expired`
  （manifest:null、零进一步 IO——诚实失败臂前移）。
- **A6a/A6b/A7 ×5 全部转绿**（见 §4）——manifest read/gate 期间 lease 已注册的直接运行时证据
  （probe sweep `leaseBlockedGroups ≥ 1 ∧ deletedGroups === 0`）与零泄漏矩阵成立。

## 3. Owner 必修 (2) 落地（O-2 → D11 + G-227-5）

- `deleteGroupIfUnleased` 弃 `now` 形参：S0′ 复查 `segmentLeased(..., clock.now())`——适配器
  闭包钟 `config.clock ?? Date.now`（既有注入面，零新公共 API），S1 rename 前即刻读取
  提交时刻现值；P1（年龄遍历）/P2（字节遍历）S0′ 调用点同步弃实参。
- **G-227-5 采含**（SA2 §5.3 裁定）：P0 orphan-BIN unlink 门同类改 `clock.now()`，
  `hygieneStream` 弃 `now` 参。
- 策略面保持 sweep 入参 `now`：P1/P2 判定点初查、年龄门（`now - maxAgeMs`）、字节统计
  （INV-227-12 语义分工——「策略评估 = 单一策略时刻；删除提交门 = 提交时刻现值」）。
- `sweepRetention` JSDoc 同步收窄（策略时刻），构造期自动 sweep（`sweepNow(clock.now())`，
  T-A7）不变。
- **B4a/B4b/B5 ×2 全部转绿**（见 §4）——sweep 开始后注册、S1 rename 前到期 → 放行删除
  （`deletedGroups===1 ∧ leaseBlockedGroups===0 ∧ probe.closed===false`）；提交时刻仍活跃 →
  阻塞（control 反向钉死）。
- **T-C3/T-C4**（SA6 共享推进钟对齐版，断言零改动）：SA3 前后均绿（构造对齐非预红面——
  与 SA6 报告 §3.2 一致）。

## 4. 验证事实（本机实际运行，2026-09-06）

### 4.1 定向（三个契约文件——SA6 红基线 4 failed | 31 passed）

```
NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run \
  packages/namespace-diagnostic-log/test/strict-reader-lease.test.ts \
  packages/namespace-diagnostic-log/test/file-adapter-retention-lease-gate.test.ts \
  packages/namespace-diagnostic-log/test/file-adapter-read-session.test.ts

 Test Files  3 passed (3)
      Tests  35 passed (35)
Type Errors  no errors
```

四红灯转绿明细：A6a（manifest 阶段持约·红差分）、A6b（阶段并发共存）、B4b（S0′ 活跃阻塞
control）、B5-control（P0 提交门活跃租约）——全部由失败转通过；A7 ×5/B4a/B5-主臂及全部
绿灯 pin（A1–A5/B2/B3/T-C1..C8/T-B6）保持通过。

### 4.2 包级 + replay 定向

```
pnpm exec vitest run packages/namespace-diagnostic-log   → 30 files / 459 tests passed
pnpm exec vitest run apps/yjs-server/test/diagnostic-replay → 3 files / 46 tests passed
```

### 4.3 全仓

```
pnpm typecheck  → 14 包 tsc 全绿（exit 0）
pnpm test       → Test Files 264 passed (264)；Tests 2917 passed (2917)；
                  Type Errors no errors；exit 0（vs SA6 红基线 4 failed | 2913 passed——零回退）
```

## 5. 纪律自证

- 本 SA 零测试文件改动（`git status` 中三个 test 文件修改 = SA6 已落地产物，diff 与 SA6
  artifactPaths 一致——未再触碰）；无 `.skip/.only/.todo` 新增；零 fallback/env-override。
- 生产代码仅 ALLOW 两文件 + AGENTS.md + package.json bump；DENY 面 zero-diff。
- 错误修法（回退提交时刻取时 / `Math.max(now, clock.now())` 折衷 / 延长 TTL / 篡改 now /
  锁步双钟）全部未使用——D11 以 `clock.now()` 直读落地，测试断言字节级未动。
- 未运行 CI/发布链路；未执行任何 `git add/commit/push`。

## 6. 交接注记（SA4/SA7 复核点）

- SA4 静态核验清单：INV-227-1（改写）/3（修订）/11/12；§3.1.2 时序表（自建臂 call#1=open
  openAt、call#2=取得检查点、call#3+=逐段检查点——传入臂序列零漂移）；T-C3/T-C4 diff =
  仅 SA6 夹具钟源对齐（同一 `newClock(T0)` 对象引用）；DENY zero-diff 亲证。
- SA7 动态验证：§9 全量命令亲跑（本报告 §4 已列全部输出摘要与退出码）。
- 版本 bump：`packages/namespace-diagnostic-log` 0.1.6 → 0.1.7（本票唯一被改包；
  apps/yjs-server 本轮零改动——DENY）。
- README.md 本轮未改（rev2 §0.2 ALLOW 无此项；既有 #227 段落陈述与提交时刻语义无冲突）。
