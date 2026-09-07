# SA6 红灯验收契约（R2/R2.1 增量）— Issue #227 rev2（2026-09-06）

- 角色/阶段：SA6 acceptance-contract（rev2 设计 R2.1 获批后：SA1 R2.1 → SA2 approve → **SA6** → SA3）
- Worktree：`/home/wangjian/nomicore-fix-issue-227`（branch `mabf/issue-227`），HEAD = **`31ff694`**
  （round-1 实现「fix(diagnostics): lease strict replay and fail closed」——被修订基线；`git rev-parse HEAD` 亲证）
- 输入：已批准修订设计 `wiki/raw/task_issue-227_rev2_design.md`（§8 测试契约 + §3.1.2 时序表）；
  SA2 窄域复审 `wiki/raw/task_issue-227_rev2_sa2_review.md`（**approve** + §5 K-binding K-R2-1..K-R2-4；
  G-227-5 裁定采含）；SA8 冲突门禁 `wiki/raw/task_issue-227_rev2_design_conflict_report.md`
  （F-1 必修项——T-C3/T-C4 双钟构造处置）；ADR-0014-LOG（`docs/adr/0014-vfsl-validated-jsonl-and-framed-sidecar-change-log.md`）
  与包 AGENTS.md
- Owner 要求（PR #251 评审，welltop-jim-wang 2026-09-06T13:14:31Z）：(1) strict reader 在路径安全检查后、
  首次 manifest I/O 前取得 lease，自建 session 用单一 finally 覆盖 manifest 缺失/JSON 损坏/gate 失败的释放；
  测试证明 manifest read/gate 期间 lease 已注册并与 retention sweep 并发；(2) S0′ 在 S1 rename 前取真实
  提交时刻而非复用 sweep-start now；测试 sweep 后、rename 前 lease 到期时会删除
- 边界：改动仅限**已批准测试/契约**（三个 `test/**` 文件）与 `wiki/raw/` 审计证据；**零生产代码改动、
  零 git 操作**（`git status` 仅上述测试文件 + 本轮既有 wiki 文件）

## Verdict

**approve**（rev2 红灯契约已锚定：A6a/A6b/B4b/B5-control 四条在 `31ff694` 上实测**红灯**并留证；
A7 ×5/B4a/B5-主臂空洞绿灯、T-C3/T-C4 共享推进钟对齐后新旧实现均绿、其余既有矩阵零回退；无测试抑制；
契约对 SA3 可执行——与 rev2 设计 §8 档案逐条一致）

---

## 1. 产物清单（本次 change 的精确路径范围）

| 路径 | 类型 | 覆盖（rev2 设计矩阵 / SA2 K-binding） |
|---|---|---|
| `packages/namespace-diagnostic-log/test/strict-reader-lease.test.ts` | 增量（+7 用例） | **A6a**（manifest 阶段持约·红差分）/ **A6b**（阶段并发共存·红→绿）/ **A7** ×5（唯一 finally 释放矩阵·结构 pin）（§8.1）；新增 `withClock`/`manifestPathOf` 夹具辅助（A6 注入面 = `StrictReadRequest.clock?` 扩展形状直通，同 withSession cast 先例） |
| `packages/namespace-diagnostic-log/test/file-adapter-retention-lease-gate.test.ts` | 增量（+4 用例） | **B4a**（S0′ 到期放行·主臂空洞绿）/ **B4b**（S0′ 活跃阻塞·红灯 control）/ **B5** ×2（P0 orphan-BIN 提交门·G-227-5 采含——主臂空洞绿 + control 红灯）（§8.2）；新增 `buildTwoGroups` 夹具（P1 恰一闭组候选） |
| `packages/namespace-diagnostic-log/test/file-adapter-read-session.test.ts` | 夹具钟源对齐（F-1/R2.1） | **T-C3/T-C4**：同一 `newClock(T0)` 对象引用直传 writer 构造（`buildThreeGroups` 增可选 clock 透传，缺省恒定钟行为对既有调用方零变化——K-R2-2/K-R2-3）与会话 open；**断言字节级零改动**（含 `leasedUntil===T0+1000`/`===T0+3000` 自钉值）；非预红面（新旧实现均绿——N-b） |
| `wiki/raw/task_issue-227_rev2_sa6_red.md` | 本证据 | 命令 / 红绿实测 / 纪律自证 / SA3 执行说明 |

未触碰：`file-adapter-read-session.test.ts` 其余用例（T-C1/C2/C5..C8/T-B6 零改动）、`buildThreeGroups`
缺省分支（其余调用方行为零变化）、全部 `src/**`、全部其他测试文件。

## 2. 执行命令（SA3/SA4/SA7 可直接复跑）

```bash
cd /home/wangjian/nomicore-fix-issue-227

# 1) 定向（本次三个文件——红/绿档案亲跑面）
NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run \
  packages/namespace-diagnostic-log/test/strict-reader-lease.test.ts \
  packages/namespace-diagnostic-log/test/file-adapter-retention-lease-gate.test.ts \
  packages/namespace-diagnostic-log/test/file-adapter-read-session.test.ts

# 2) 全量（SA3 完成定义；本基线预期 = 仅下列 4 条红灯，其余全绿）
pnpm test
```

## 3. 红/绿实测结果（HEAD `31ff694`；2026-09-06 本机独立运行）

### 3.1 定向运行（§2 命令 1）——实测一致

```
Test Files  2 failed | 1 passed (3)
     Tests  4 failed | 31 passed (35)
Type Errors  no errors
```

| 用例 | 档案（rev2 设计） | 实测（红基线） | 修后期望（绿） |
|---|---|---|---|
| **A6a** manifest 阶段持约 | **红** | `report` 恒 null（fake 钟零调用——自建臂不消费 `request.clock`，取得检查点缝缺席即红）→ 读取 ok 全量 | call#2 钩子触发：probe `leaseBlockedGroups≥1 ∧ deletedGroups===0`（manifest read/gate 期间 lease 已注册的直接运行时证据）+ rm manifest 后读取 `corrupt + [manifest-invalid]`、records `[]` |
| **A6b** 阶段并发共存 | 红→绿 | 同上（probe 报告无从产生） | 只 probe 不删 manifest：读取 ok 全量 records `[1,2,3]` + probe `deletedGroups===0`（manifest 阶段与 sweep 尝试并存零丢失） |
| **B4b** S0′ 活跃阻塞 control | **红** | `deletedGroups=1`（旧提交门无钟读 → 钩子不触发 → 无租约 → group1 照删） | 提交时刻 T_REG+2 仍活跃 → `deletedGroups===0 ∧ leaseBlockedGroups≥1`、jsonl/bin 在 |
| **B5-control** P0 提交门活跃租约 | **红** | `orphanBinsDeleted=1`、`leaseBlockedGroups=0`（P0 门旧取时无钟读 → BIN 照删） | 提交时刻活跃 → `leaseBlockedGroups≥1 ∧ orphanBinsDeleted===0`、BIN 在 |
| A7 ×5 统一 finally 释放矩阵 | 空洞绿（旧实现）→ 漏 finally 新实现红 | 全绿（manifest 缺失 / JSON 损坏 / gate corrupt 臂 / gate incompatible 臂 四形态读后 sweep `deletedGroups=2 ∧ leaseBlockedGroups=0`；enumerationFailed 形态 `0/0`——注册表零残留） | 同绿（SA3 漏 finally 时 ②③ 早退泄漏 → sweep `leaseBlockedGroups≥1` → 红） |
| B4a S0′ 到期放行主臂 | 空洞绿（与 B4b 合并成红差分） | 绿（钩子不触发 → 无租约 → `deletedGroups=1`） | 提交时刻 T_REG+5 已到期 → 放行 `deletedGroups===1 ∧ leaseBlockedGroups===0`、probe 未 close |
| B5 P0 提交门主臂 | 空洞绿（同 B4a 机制） | 绿 | 提交时刻已到期 → `orphanBinsDeleted===1 ∧ leaseBlockedGroups===0` |

### 3.2 绿灯 pin（31 条全绿——SA3 不得回退）

- `strict-reader-lease.test.ts` 既有 A1/A2/A3a/b/c/A4a/b/c/A5 ×2 全绿（A6 系注入面零漂移：A2 走传入臂，钟序列不变）；
- **A7 ×5 全绿**（上述）；
- `file-adapter-retention-lease-gate.test.ts` 既有 B2 ×2/B3 ×2 全绿（D11 对 P0/P1 报告口径零回退）；
- **B4a/B5-主臂空洞绿**（上述）；
- `file-adapter-read-session.test.ts` T-C1..C8/T-B6 全 9 条绿——含 **T-C3/T-C4 共享推进钟对齐版**
  （同一 `newClock(T0)` 对象供 writer 与会话；`sweepRetention({now: clock.t})` 断言语义零变化：
  T-C3 仍钉 `deletedGroups===2 ∧ leaseBlockedGroups===0`；T-C4 仍钉 `deletedGroups===2 ∧ renew()===true
  ∧ leasedUntil===T0+3000 ∧ closed===false ∧ segments 快照不变`）——构造对齐非预红面，新旧实现均绿（N-b 佐证）。

### 3.3 全量运行（§2 命令 2）——`pnpm test`（vitest run --typecheck，264 文件 / 2917 tests）

```
Test Files  2 failed | 262 passed (264)
     Tests  4 failed | 2913 passed (2917)
Type Errors  no errors
   Duration  387.90s
```

- 全仓 2913 条通过 = **零回退**（含 namespace-diagnostic-log 全部既有用例、apps/yjs-server
  diagnostic-replay/red/sa7 全部既有 pin、以及全部其他包/app 测试）；
- 恰 4 条失败 = 本次预红契约：A6a / A6b / B4b / B5-control（与定向运行逐一相同，见 §3.1）；
- 复跑佐证：包级 + replay 定向全量（33 文件 / 505 tests）同为 `4 failed | 501 passed`，
  两文件级失败 = strict-reader-lease.test.ts（A6a/A6b）与 file-adapter-retention-lease-gate.test.ts
  （B4b/B5-control），无第三条意外红。

### 3.4 纪律自证

- 零测试抑制：三个文件 grep `.skip|.only|.todo|passWithNoTests|continue-on-error` 零命中。
- 零源码文本断言（源码 GREP 禁令）：全部断言针对运行时产物（读状态/issue 码/sweep 报告/磁盘文件/
  会话状态机/注册表可观测行为）。
- 类型面处理：`StrictReadRequest.clock?` 为 rev2 提议增量（HEAD 类型面无）——测试经「扩展形状直通
  （intersection cast，`withClock`）」，与既有 `withSession` cast 同款；红灯全部来自运行时行为断言。
- tsc 自证：`tsc -p packages/namespace-diagnostic-log/tsconfig.json --noEmit` → exit 0；
  根 `pnpm typecheck`（14 包全量）→ exit 0。
- 红差分诚实性：B4a/B5-主臂为设计明示的「空洞绿」（旧实现 S0′/P0 门无钟读位 → 钩子不触发 → 无租约），
  红基线由同构造的 control 臂（B4b/B5-control）承载——与 rev2 §8.2 档案及 SA2 复审 §2 逐字一致；
  probe 相关断言（`probe.closed === false`）在钩子未触发（旧实现空洞态）时经 `probeSlot.session !== null`
  守卫跳过——该守卫只在旧实现空洞态生效，新实现下钩子确定性触发、断言全量执行。
- 注入钟纪律（K-R2-4）：全部 fake 钟 fire-once 守卫 + 重入返回现值；probe 用独立静态钟
  （T_REG）防重入；aged 构造全走 `sweepOnOpen:false` 规避构造期自动 sweep。
- A7 manifest 缺失/JSON 损坏两形态在验证 sweep 前恢复盘面 manifest——`scanSweepStreams` 对
  manifest 缺失/不可解析的流保守跳过（无法按 createdAt 定序——零删），恢复只为了让 sweep 能枚举该流，
  从而把「注册表零残留 = finally 已释放」变成可观测断言（漏 finally 的新实现 → 泄漏租约 →
  leaseBlockedGroups≥1 → 红）；断言强度零放宽（仍钉 `deletedGroups===2 ∧ leaseBlockedGroups===0`）。

## 4. 对 SA3 的实现提示（契约→实现映射，节选——rev2 设计 §7 清单）

- 红 A6a/A6b 绿条件：`reader.ts` `readStreamStrict` 自建臂取得点前移（① 路径安全后、② manifest
  读取前——④″）+ `StrictReadRequest.clock?` 透传 open + 取得检查点 `renewIfDue(READ_SESSION_RENEW_MARGIN_MS)`
  （拒绝 → corrupt + `lease-expired`，manifest:null，零进一步 IO）——A6 fake 的 call#2 即此检查点钟读位
  （rev2 §3.1.2 时序表）。
- 红 B4b/B5-control 绿条件：`file.ts` `deleteGroupIfUnleased` 弃 `now` 参、S0′ 复查改 `clock.now()`
  （适配器闭包钟 :309）；P1/P2 调用点弃实参（:1272/:1340）；P0 orphan-BIN 门（:1173）同改（G-227-5 采含，
  `hygieneStream` 弃 `now` 参）；策略面（初查/年龄/字节）维持 sweep 入参 now（INV-227-12 语义分工）。
- A7 绿条件：D9 函数级唯一 `finally { ownedSession?.close() }`（删除 :591-592/:838-841/:868-871 三处分散
  站点；close 幂等）；传入臂不 close（生命周期归调用方）不变。
- T-C3/T-C4 对齐版在 SA3 前后均绿（构造对齐非预红面）——**禁止**把该两用例的翻红误诊为 D11 实现回归；
  错误修法（回退提交时刻取时 / `Math.max(now, clock.now())` 折衷）违 INV-227-12 与 owner 字面，明示禁止。
- 只动 §0.2 ALLOW 白名单路径（`src/reader.ts`、`src/adapters/file.ts`、包 AGENTS.md 增量句）；replay/
  read-session/index/retention 零改动；`deleteGroup` 本体零 hunk。

## 5. 边界声明

- 本轮**零生产代码改动、零测试断言放宽、零 git 操作**（HEAD 仍 `31ff694`，`git status` 仅三个测试文件
  修改 + 本轮既有 wiki 未跟踪/修改文件——其中 `task_issue-227_sa4_review.md` 的修改为 R2 轮 SA4 复核产物，
  非本 SA6 变更）。
- 未跑 CI/发布链路（属后续 round 与 Runner 职责）。
