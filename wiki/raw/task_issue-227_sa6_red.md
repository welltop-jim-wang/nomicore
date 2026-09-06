# SA6 红灯验收契约 — Issue #227（2026-09-06）

- 角色/阶段：SA6 acceptance-contract（Bug 修复流水线：SA5 → SA6 → SA1 → SA2 → SA3）
- Worktree：`/home/wangjian/nomicore-fix-issue-227`，HEAD `ac91a6b`（`mabf/issue-227`，pre-implementation）
- 输入：已批准设计 `wiki/raw/task_issue-227_design.md`（R1.1 §8 矩阵）；SA2 复审
  `wiki/raw/task_issue-227_sa2_review.md`（approve + K-1..K-5 binding）；SA5 报告
  `wiki/raw/20260906-bug-issue-227.md` + 复现脚本 `wiki/raw/repro-20260906-issue-227.ts`
- 边界：改动仅限 `test/**` 与 `wiki/raw/` 证据；零生产代码改动、零 git 操作

## Verdict

**approve**（验收契约已锚定：全部预期红灯在 HEAD 上复现；绿灯 pin 与既有矩阵零回退；
无测试抑制；契约对 SA3 可执行）

---

## 1. 产物清单（本次 change 的路径范围）

| 路径 | 类型 | 覆盖（设计矩阵 / binding） |
|---|---|---|
| `packages/namespace-diagnostic-log/test/strict-reader-lease.test.ts` | 新增红文件 | A1 快照驱动 / A2 续租检查点 / A3 vanished 兜底 / A4 防御门 / A5 无泄漏（§8.1） |
| `packages/namespace-diagnostic-log/test/file-adapter-retention-lease-gate.test.ts` | 新增红文件 | B2 卫生守约（P0 orphan-BIN 租约门）/ B3 报告口径（§8.2 + N-3） |
| `packages/namespace-diagnostic-log/test/strict-reader-materialize-unknown.test.ts` | 新增红文件 | C1 unknown 分类 / C2 none 收窄 / C3 回归 / C4 effect 缺席（§8.3 + R1.1-F1） |
| `apps/yjs-server/test/diagnostic-replay-lease-completeness-red.test.ts` | 新增红文件 | D1 到期续租 / D2 恒释放 / D3 unknown / D4 omitted（+K-2/N-1）/ D5 undecodable / D6 missing-畸形 / D7 complete 保真 / D8 effect 缺席 / D9 pre-genesis 损坏 / K-3 非法供参（§8.4 + SA2 K-2/K-3） |
| `apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts` | 改写（K-1） | 重点 4 pin 废止改写为 D3 语义（同 change；设计 §8.4 D3 + §8.5 处置表） |
| `wiki/raw/task_issue-227_sa6_red.md` | 本证据 | 命令 / 预期红 / 实测结果 / SA3 执行说明 |

## 2. 执行命令（SA3 可直接复跑）

```bash
# 0) 环境（SA5 同款）
cd /home/wangjian/nomicore-fix-issue-227
# pnpm install --prefer-offline --ignore-scripts   # 仅 fresh worktree 需要

# 1) 定向红灯契约（本次四个新文件 + 两个零回退既有文件并跑）
NODE_OPTIONS=--conditions=nomicore-source ./node_modules/.bin/vitest run \
  packages/namespace-diagnostic-log/test/strict-reader-lease.test.ts \
  packages/namespace-diagnostic-log/test/file-adapter-retention-lease-gate.test.ts \
  packages/namespace-diagnostic-log/test/strict-reader-materialize-unknown.test.ts \
  packages/namespace-diagnostic-log/test/file-adapter-read-session.test.ts \
  apps/yjs-server/test/diagnostic-replay-lease-completeness-red.test.ts \
  apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts

# 2) SA7 重点 4 改写 pin（K-1；与 D3 同语义）
NODE_OPTIONS=--conditions=nomicore-source ./node_modules/.bin/vitest run \
  apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts -t "重点 4"

# 3) 设计 §9 全量面（SA3 完成定义）
pnpm typecheck && pnpm test
```

## 3. 红灯实测结果（HEAD ac91a6b；2026-09-06 本机两次独立运行，结果一致）

### 3.1 定向运行（§2 命令 1）

```
Test Files  4 failed | 2 passed (6)
     Tests  18 failed | 50 passed (68)
Type Errors  no errors
Duration  39.36s
```

- 2 个通过文件 = 零回退既有面：`file-adapter-read-session.test.ts`（T-C1..C8/T-B6，
  设计 §8.5 处置表「保留零改动」——S0′/hygiene 改造不得回退任何断言）、
  `apps/.../diagnostic-replay-host-lifecycle-red.test.ts`（R1–R11 pin 保留）。
- 4 个失败文件 = 本批红文件（预期红灯 18 条全部命中，见 3.3）。

### 3.2 SA7 重点 4 pin 改写（§2 命令 2）

```
Tests  1 failed | 5 skipped (6)
× 健康链中段含 fatal-unknown 记录：partial、issues=[update-unknown]、lastSeq='2'…
  → expected 'complete' to be 'partial'
```

改写后的 pin 在 HEAD 上红灯（旧行为 `complete`），SA3 落地 D3 语义后翻绿；
其余 5 个重点（真实进程 E2E 等）未受影响（-t 过滤未跑，全量门在 SA3 修绿后复核）。

### 3.3 预期红灯清单（今日实测失败 = 断言预期新行为）

| # | 用例（文件内定位） | 今日实际（红基线） | 修后期望（绿） |
|---|---|---|---|
| 1 | A1 快照驱动 | 带 session 读得见 open 后新段（seqs=[1,2,3,4]） | 快照驱动 → seqs=[1,2,3] |
| 2 | A2 bounded 续租检查点 | session 被忽略 → ok 全量 4 记录 | corrupt + `lease-expired`(00000004) + 已读 1..3 保留 |
| 3 | A3a 整组 rm vanished | ok 零 issue（自枚举不见组） | corrupt + `segment-vanished`(00000003) |
| 4 | A3c `.deleting` marker vanished | corrupt [sequence-gap]（无 vanished 归因） | corrupt + `segment-vanished`(00000002) |
| 5 | A4a 身份不符 session | ok 全量（session 被忽略） | corrupt + `locator-invalid`、零 fs |
| 6 | A4b 已 close session | ok 全量 | corrupt + `lease-expired`、零 fs |
| 7 | B2 卫生守约（P0 租约门） | orphanBinsDeleted=1、bin 消失、leaseBlockedGroups=0 | bin 保留、orphanBinsDeleted=0、leaseBlockedGroups≥1 |
| 8 | B2 续（close 后） | 首轮已违约删除 → 次轮 0（状态耦合红） | 首轮被租约挡下 → close 后次轮 orphanBinsDeleted≥1 |
| 9 | B3 报告口径 + 事件 | 事件 leaseBlockedGroups=0（P0 无租约门） | 报告/事件 leaseBlockedGroups≥1、orphanBinsDeleted=0 |
| 10 | C1 unknown 分类 | materialize=`none` | `{kind:'unknown'}` |
| 11 | C4 effect 缺席（F-1） | materialize=`none`（对照 committed:false 亦 none 保持） | 缺席 committed:true → `unknown`；对照 → `none` 不变 |
| 12 | D1 bounded 到期/续租 | `readSession` 供参被忽略 → complete/[]/lastSeq='4' | partial + `lease-expired`、lastSeq='3'（停在最后成功物化段） |
| 13 | D3 unknown committed effect（AC3） | complete/[]/lastSeq='4'/快照 count=9 | partial + `update-unknown`、lastSeq='2'、快照 count=5（前缀态） |
| 14 | D4c（K-2）fatal-committed-false-omitted | complete/[]/lastSeq='4' | partial + `update-omitted`、不推进（lastSeq='3'） |
| 15 | D4d（N-1）乱序 ∧ committed-omitted | issues=[sequence-gap, update-omitted] | 连续性复核先命中 → 含 sequence-gap、**不含** update-omitted |
| 16 | D8 effect 缺席 replay 端（F-1） | complete/[]/lastSeq='4' | partial + `update-unknown`、lastSeq='3'、快照前缀态 |
| 17 | K-3a 非法供参 `{ttlMs:0}` | 被忽略 → complete/[] | 不抛、failed + `replay-internal-error` |
| 18 | K-3b 非法供参 `{maxLifetimeMs:0}` | 被忽略 → complete/[] | 不抛、failed + `replay-internal-error` |
| 19 | SA7 重点 4（K-1，sa7.test.ts 改写 pin） | complete/[]/lastSeq='4'/count=9 | partial + `update-unknown`、lastSeq='2'、count=5 |

### 3.4 绿灯 pin（本批文件内已绿——SA3 不得回退）

A2 unbounded（ok 全量）/ A3b BIN-first 窗口（jsonl-only 删最大段留 bin → ok 零行零 issue）/
A4c enumerationFailed 包络等价（corrupt + manifest-invalid 逐字节等同）/
A5 无泄漏 ×2（自租约读后 0/0 sweep 立即删 3 闭组、重复读零累积）/
B3 P1 年龄遍历租约止步报告复核 / C2 none 收窄三形状 / C3 update+omitted 回归 /
D1 unbounded（complete）/ D2 会话恒释放端到端 / D4a committed-omitted（R7 保留）/
D4b fatal-committed-true-omitted / D5 update-undecodable / D6a sequence-gap（R5 保留）/
D6b vfsl-invalid 防御 / D7 混合健康链 complete 保真回归 / D9 pre-genesis 损坏载体
fail-closed 集合（failed + [frame-missing×4, genesis-missing]、lastSeq=null，钉 SA5
实测形状——N-2 叙事的「仅 [genesis-missing] → +invalid」翻转在该夹具上不可观测，
SA5 §5 D9 行已明示，故以 fail-closed 集合为 pin）。

### 3.5 纪律自证

- 零测试抑制：四个新文件 grep `.skip|.only|.todo|passWithNoTests|continue-on-error` 零命中。
- 零源码文本断言（源码 GREP 禁令）：全部断言针对运行时产物
  （read/replay 报告、issue 码、磁盘文件、sweep 报告、`retention-swept` 事件、Y.Doc 解码快照）。
- 类型面处理：HEAD 类型面无 `request.session` / `readSession` / `StrictRecordUpdate.unknown`
  成员——测试经「扩展形状直通（intersection cast）+ 原始 kind 判别」保持 tsc 零错误
  （见 §4），红灯全部来自运行时行为断言（无静态 import 失败型红）。
- tsc 自证（本批文件零类型债，SA3 修绿不需清测试侧编译债）：
  `tsc -p packages/namespace-diagnostic-log/tsconfig.json --noEmit` → exit 0；
  `tsc -p apps/yjs-server/tsconfig.json --noEmit` → exit 0。

## 4. 对 SA3 的实现提示（契约→实现映射，节选）

- 红 #1/#3/#4/#5/#6 的绿条件集中在 `readStreamStrict` ④′ 会话取得 + 防御门
  （设计 §3.2.2）与 ⑤ ENOENT 分支的 vanished 判定（§3.2.4）；`StrictReadRequest.session`
  加可选字段后类型面即通。
- 红 #2 绿条件在逐段续租检查点（§3.2.3 `renewIfDue(READ_SESSION_RENEW_MARGIN_MS)`，
  外部 session 恒由测试提供——trip 时序见 D1 注记：bounded ttl=maxLifetime=45_000ms +
  每 now() 前进 10_000ms 的步进假钟，第 6 次取时必拒续）。
- 红 #7/#8/#9 绿条件在 `file.ts` P0 hygiene orphan-BIN 清理的 `segmentLeased` 租约门
  （§3.3.2），跳过计入 `leaseBlockedGroups`（含 N-3 事件频率语义）。
- 红 #10/#11/#16 绿条件在 `materializeStrictRecordUpdate` 增 `unknown` 第五成员与
  `none` 域收窄（§4.2 谓词：`fatal ∧ committed:true ∧ effect ∉ {'update','update-omitted'}`
  → unknown，effect 缺席与字面 'unknown' 同归）。
- 红 #12/#17/#18 绿条件在 replay session 生命周期（§3.4.2：open 在 try 内收敛——
  非法供参 → `failed + replay-internal-error`；物化前续租检查点）。
- 红 #13/#14/#15/#16 + SA7 重点 4 绿条件在 replay ④ 重写为 materialize switch
  （§4.3：unknown → `update-unknown` + break；omitted 分类无条件走 effect；连续性复核
  先于物化/omitted——N-1 翻转）；K-2 形状经 materialize omitted 分支无条件触发覆盖。
- K-4（SA2 N-C，SA3 义务）：`diagnostic-replay.ts` 头注（:4–17）五条件措辞随语义收紧
  同 change 同步——属文档义务，行为面已由本批红（D3/D4c/D4d/D8/K-3）锚定；测试不做
  源码文本断言（源码 GREP 禁令），静态措辞核验归 SA4 静态复审。

## 5. 环境与复现佐证

- 夹具全部走公共 API（`createFileDiagnosticLog` / `readStreamStrict` /
  `materializeStrictRecordUpdate` / `openDiagnosticReadSession` / `sweepRetention` /
  `replayNamespaceDiagnosticLog`）+ 临时目录手拼 JSONL（F-1/effect 缺席、K-2、畸形
  carrier 等 emitter 不可达形状——与 SA5 复现脚本同法）；时钟全注入（T0 或步进假钟），
  零真实时间依赖、结果确定性（本批两次运行输出一致）。
- vitest `maxWorkers:1` 单实例下 Y 模块单实例成立——D 文件快照断言用 SA7 同款
  `Y.applyUpdate` 解码（无 tsx 双实例陷阱）。
