# SA7 动态验证报告 — File diagnostic-log adapter R2（issue #152 round=2）

**日期**：2026-08-28（round=2，SA7 动态验证阶段）
**验证对象**：HEAD `f52eccb`（SA3 R2 实现；基线 `fde8034` = round-1 HEAD）
**权威契约**：`task_diagnostic-log-file-adapter-r2_design.md`（SA1 R3）+ dispatch 第 12/14 行 G18/G19/G20/G21 裁决 + `task_diagnostic-log-file-adapter-r2_sa6_red.md` 红灯契约
**运行目录**：`/home/wangjian/nomicore-fix-issue-152`（所有命令后台独立进程，日志落 `.mabf-bg/`）
**补充测试**：`packages/namespace-diagnostic-log/test/file-adapter-sa7-dynamic.test.ts`（9 用例，SA7 域新增；`src/` 零触碰）

---

## verdict: pass

（本地活链路全绿；vitest 包触发的 **CI 侧**证据因 R2 commit 未 push 而环境阻塞，本地等价证据完整——见 §vitest 触发证据；与 round-1 D2 同口径，待总控发布后可按 Step 4 流程补录）

---

## Step 0 — SA4 verdict 校对

`task_diagnostic-log-file-adapter-r2_sa4_review.md` 第 4 行：**`Verdict: pass`** → 进 Step 1。
（SA7 仅可上发：SA4 pass + SA7 独立动态实证。）

## Step 1 — SA6 红灯契约复跑（红→绿第二关）

红灯契约 3 文件（strict-reader / r2-policy-continuity / r2-supplemental，29 红锚）在整包运行中全绿：

```text
$ node_modules/.bin/vitest run packages/namespace-diagnostic-log/test   # node v24.13.0，独立后台进程
 ✓ packages/namespace-diagnostic-log/test/file-adapter-strict-reader.test.ts (60 tests)
 ✓ packages/namespace-diagnostic-log/test/file-adapter-r2-policy-continuity.test.ts (13 tests)
 ✓ packages/namespace-diagnostic-log/test/file-adapter-r2-supplemental.test.ts (22 tests)
 Test Files  19 passed (19) /  Tests 305 passed (305) /  Type Errors no errors /  EXIT=0
```

与 SA4 独立复跑（19/305/EXIT=0）逐字一致——**🟢 GREEN，进 Step 2**。日志：`.mabf-bg/sa7-pkg-run.log`。

## Step 2 — SA4 §5「动态审核重点」四项逐条验证

### D1 — write 期 EACCES 误分类残余（§5.1）→ ✅ 在本 runner 文件系统上取证关闭

**环境取证**（`.mabf-bg/sa7-eaccES-probe.log`，probe 脚本 `.mabf-bg/sa7-eaccES-probe.mjs`）：

1. 本机工作区文件系统：`/proc/mounts` → `/dev/nvme1n1p1 /home ext4 rw,relatime`（本地物理 ext4，非 NFS/FUSE——exotic fs 语义面不存在）。
2. 真实运行时实验（node v24.13.0，与 adapter 同 API）：
   - `EXP1`：`appendFileSync` 打开 `0444` 文件 → `errno=EACCES`，发生在 **open 期**（definitive 正类，分类正确）；
   - `EXP2`：先 `open(fd,'a')` 成功、再 `chmod 000` → `writeSync(fd)` 仍 **SUCCESS**——POSIX DAC 权限检查在 open(2) 时完成，write(2) 不重查；**write 期 EACCES 无法经任何权限手段构造**。
3. **结论**：write 期 EACCES 在本 runner 的 ext4 上不可达 → SA4 §3.3 残余（exotic fs 误归 definitive）在本环境**关闭**；若未来部署于 NFS/FUSE 需重开此项。

**残余后果有界性动态实证**（补测试 D-C6）：即便误分类发生，最坏物理产物（部分行 / 重复 sequence）被 strict reader 响亮判坏、非静默错乱：

```text
D-C6: 真实 writer 产健康 [1,2] → 物理注入「完整重复 seq 2 行 + 无换行半行」
      → status=corrupt；issues 含 sequence-out-of-order + invalid-json ✅
```

### D2 — BIN-ok + JSONL-definitive 交错终态实测（§5.2）→ ✅ 实测判 ok，已补测试锚

SA4 静态推演为 ok 但**无测试锚**——本 SA7 以真实恢复路径构造该终态并实测（`D-A1`，新增测试锚）：

```text
场景（全部真实链路）：
  ① emit seq1 inline（10B）→ JSONL [1]
  ② JSONL 路径目录占位（open 期 EISDIR）→ emit sidecar 4097B：
     BIN-first 帧完整落盘（orphan frame seq '2' @offset 0）→ JSONL append EISDIR
     → storage-write-failed{stage:'jsonl',code:'EISDIR'}（definitive，零字节可证明）
  ③ 移除目录占位、还原 JSONL → emit 另一 4097B sidecar（不同 payload/CRC）：
     candidate '2' 复用；fresh-stat 跳过 orphan 帧 → 新帧 @offset 4122 → JSONL 落盘
  ④ bin 终态实测：两个 seq '2' 帧（orphan @0 + 复用提交帧 @4122）；frameOffset='4122'

实测判定（readStreamStrict）：
  status = 'ok'；records ['1','2'] 全 ok；issues = []        ← 与静态推演一致
```

**机理确认**：reader 的 sidecar 交叉按「被 JSONL 引用的帧」链接（`expectedOffsets` 首个被引用帧 `expected===null` 不做 boundary 检查）；orphan 帧无 JSONL 引用，不产生 `frame-boundary-invalid`——orphan 作为诚实残态保留（ADR 0012 既有「BIN-first 崩溃窗口」语义）。终态诚实：两条路径（判 ok / 逐条诊断）均不产生 false-ok 或静默错乱。日志：`.mabf-bg/sa7-dynamic-run1.log`、`.mabf-bg/sa7-pkg-run4.log`。

### D3 — README 并发半行 / 静态 stream 声明未回退（§5.3）→ ✅ 确认

`packages/namespace-diagnostic-log/README.md`（f52eccb 版本）：

- **L132–135（round-1 既有声明，逐字保留）**：「并发读写语义：JSONL 行的 `appendFileSync` 在内核侧可能拆为多个 `write(2)`，与活跃 writer 并发运行的 reader 可能读到半行（误判 invalid-json）。`readStreamStrict` 面向**静态 stream**（writer 停写后 / 离线拷贝上使用），不承诺与活跃 writer 的并发一致性。」——R2 行长检查以文件当前字节为准，活跃 writer 并发读仍按此「静态 stream」契约声明，**未回退、无需新证**（SA4 §5.3 原文口径）。
- **L128（R2 新增 strict `ok` 文案，设计 §3.5 逐字）**：「在本次静态读取中，已解析的该 stream v1 物理 records 自 sequence 1 连续，且通过 manifest/storage/frame 校验。」——无「业务完整/可恢复」过度声明 ✅。
- 配套：`AGENTS.md` +9 行（同步 emit 不得在 namespace write slot 内接线的工程边界提示，与 ADR amendment MUST 条款一致）。

### D4 — vitest 触发证据（§5.4）→ ✅ 本地完整；CI 侧环境阻塞（未 push）

见文末 §vitest 触发证据段（本地 19 文件逐文件收集+执行证据 + node20/24 双版本；CI 侧阻塞事实与 round-1 D2 同口径）。

## 验证门槛（任务简报 §验证门槛）— 全部通过

| 门槛 | 命令（独立后台进程） | 结果 | 日志 |
|---|---|---|---|
| `git diff --check` | `git diff --check fde8034 f52eccb`；工作区 `git diff --check` | **干净 / 干净** | — |
| `pnpm typecheck` | 全仓 | **EXIT=0**（含 `packages/namespace-diagnostic-log/tsconfig.json`） | `.mabf-bg/sa7-typecheck.log` |
| `pnpm test` 全仓 | `vitest run --typecheck` 全量（SA7 文件加入前） | **137 文件 / 1710 测试全绿，EXIT=0** | `.mabf-bg/sa7-full-test.log` |
| `pnpm test` 全仓（加入 SA7 补充测试后） | 同命令 | **138 文件 / 1719 测试全绿，EXIT=0** | `.mabf-bg/sa7-full-test2.log` |
| 基线对比 | fde8034 = 136 文件 / 1664 测试 | +1 文件（r2-policy-continuity 全重写计入）/+46 测试，**零回退**；+SA7 文件后再 +1 文件/+9 测试 | — |
| 双版本 node（round-1 口径） | 包套件 @ node v20.19.0（官方 dist，与 CI 同源同版本族） | **20 文件 / 314 测试全绿，EXIT=0** | `.mabf-bg/sa7-pkg-node20.log` |

（node v24.13.0 包套件：20 文件 / 314 测试全绿，EXIT=0 —— `.mabf-bg/sa7-pkg-run4.log`。）

## R2-AC 活链路实证（敌意注入经真实 createFileDiagnosticLog / readStreamStrict）

补充测试文件：`packages/namespace-diagnostic-log/test/file-adapter-sa7-dynamic.test.ts`（9 用例全绿）。与 SA6 手工 fixture 的分工：本文件全部用例先以**真实 writer**（`createFileDiagnosticLog` → emitter → adapter → 磁盘投影）产出健康 stream，再仅做**物理层敌意篡改**（manifest 字段翻转 / JSONL 行删除 / 字节注入），验证 reader 不信任 writer。

### R2-AC1（反馈 1：manifest 四策略逐条执行）✅

| 用例 | 敌意注入（物理篡改） | 实测判定 |
|---|---|---|
| D-C1 | 真实 update 记录 + manifest `committedUpdateCapture` 翻转为 `false` | `corrupt` + `manifest-update-capture-violation`；records 保留逐条解释 ✅ |
| D-C2 | 真实 10B inline 记录 + manifest `inlineUpdateMaxBytes` 收紧为 4 | `corrupt` + `manifest-inline-threshold-violation`（超阈值不得 inline）✅ |
| D-C3 | 真实 4097B sidecar 记录 + manifest `inlineUpdateMaxBytes` 放宽为 1048576 | `corrupt` + `manifest-sidecar-threshold-violation`（≤阈值不得 sidecar）✅ |
| D-C4 | 真实记录行 + manifest `jsonlLineLimitBytes` 收紧为 64 | `corrupt` + `manifest-line-limit-exceeded`（行字节上限）✅ |
| D-C5 | 真实 `{snapshot}` 输入投影的 full 记录（inputPolicy:'full' writer 产出）+ manifest `inputCapturePolicy` 改为 `'none'` | `corrupt` + `manifest-input-policy-violation`（policy 与 input 不符）✅ |

（SA6 红灯契约同面的手工 fixture 锚——capture=false 带 update、4097/4096 四象限、多字节行超限、marker 双向——已在 Step 1 复跑中全绿，两套证据互补。）

### R2-AC2（反馈 2：连续性 / 物理删除必发现、健康 stream 不误判）✅

| 用例 | 场景 | 实测判定 |
|---|---|---|
| D-B1 | 真实 [1 inline, 2 sidecar, 3 inline] → **物理删除 JSONL seq 2 行**（bin 帧 2 原样保留） | `corrupt` + `sequence-gap`；**归因 = 发现缺口的物理 record**（sequence '3'、offset 1、segment '00000001'，R2-G20）；records ['1','3'] 逐条 ok 保留——bin 残帧不掩盖缺口 ✅ |
| D-B2 | 健康 stream 混合合法终态：committed inline / committed sidecar / **fatal-committed sidecar** / noop / fatal-rejected | `ok`、零 issue、sequences ['1'..'5'] 全 ok——**合法终态不误判** ✅ |
| D-A1 | （见 §D2）definitive 复用后的 [1,2] 连续流 + bin orphan 残态 | `ok`——健康流（含交错恢复终态）不误判 ✅ |

### R2-AC3（反馈 3：ADR 0012 amendment 落地、ADR 0011 不动）✅

- `docs/adr/0012-…md` diff（fde8034→f52eccb，+15 行）实核：
  - **dated amendment**（L244「Amendment — File adapter first slice（2026-08-28，issue #152 round 2）」）明文「**在首切片 File adapter 的当前实现范围内被以下条款取代**」（取代关系，非并列）✅
  - 同步 append 范围（每 emit ≤1 JSONL 行 + sidecar BIN-first ≤1 帧；无 queue/batch/fsync 开关/常驻 fd；不构成掉电承诺）✅
  - 「有界」定义（数据量/操作数，非延迟上界）+ **write-slot 外 MUST** 接线条件（`#149–#151/#155` 修复后方可启用）✅
  - 演进路径（公共 seam/schema/policy/slot 隔离不变前提下可替换 queue/batch；须另行定义 close/flush/队列满/fsync）✅
  - 被否方案新增 4 条 + 后果段「首切片取舍（2026-08-28 amendment）」逐条在 diff 中 ✅
- `git diff fde8034 f52eccb --name-only -- docs/adr/0011-best-effort-namespace-diagnostic-change-log.md` → **0 文件（ADR 0011 正文未动）** ✅
- ADR 0012 状态头保留 `accepted`（状态未改）✅

## Step 3 — E2E spec 触发证据

本票无 `*.spec.ts` 改动（SA4 §1.3 已判 N/A；diff 10 文件 + SA7 补充测试均非 e2e）——**N/A**。

## vitest 触发证据 (verdict 升级 — 2026-06-15 立法适用)

**CI Run**：无 —— R2 commit `f52eccb` **未 push**（`git ls-remote origin` 远端分支仍指 `fde8034`；PR #159 存在但其最近 run `33170450757`（completed/success，2026-08-28T12:17Z）属 round-1 `fde8034`，不能作为 R2 证据）→ **CI 侧环境阻塞，非代码缺陷**。SA7 无 push/建 PR 权责（skill 边界）。

**本地等价证据**（与 CI `Test` step 同命令 `vitest run --typecheck`，独立后台进程）——19 个测试文件**逐文件收集并执行**（非仅收集）：

| Workspace Package | 触发结果 | log 摘录（`.mabf-bg/sa7-pkg-run.log`） |
|---|---|---|
| namespace-diagnostic-log | ✓ 19 文件全触发且通过（296 runtime + 9 typecheck = 305） | `✓ …/file-adapter-strict-reader.test.ts (60 tests)`、`✓ …/file-adapter-r2-policy-continuity.test.ts (13 tests)`、`✓ …/file-adapter-r2-supplemental.test.ts (22 tests)`、`✓  TS  …/identity.test-d.ts (9 tests)` … `Test Files 19 passed (19)` / `Tests 305 passed (305)` / `Type Errors no errors` / `EXIT=0` |
| namespace-diagnostic-log（+SA7 补充后） | ✓ 20 文件 / 314 测试 | `✓ …/file-adapter-sa7-dynamic.test.ts (9 tests)` … `Test Files 20 passed (20)` / `EXIT=0`（`.mabf-bg/sa7-pkg-run4.log`） |
| namespace-diagnostic-log @ node v20.19.0 | ✓ 20 文件 / 314 测试 | 同上（`EXIT=0`，`.mabf-bg/sa7-pkg-node20.log`） |
| 全仓（CI Test step 同命令） | ✓ 137→138 文件 / 1710→1719 测试 | `Test Files 137 passed (137)` / `Tests 1710 passed (1710)` / `EXIT=0`（`.mabf-bg/sa7-full-test.log` / `sa7-full-test2.log`） |

**verdict**: ✅ all-vitest-packages-triggered（**本地**；CI 侧 ⏸ 待总控 push 后按 Step 4 流程摘录 PR CI `Test` step 的本包收集行补录——workflow 接线静态面 SA4 §1.4 已验：`vitest.config.ts` include 覆盖该包、`ci.yml` Test step 执行 `pnpm test`）

## 补充性测试裁定

| 文件 | 用例 | 裁定 |
|---|---|---|
| `test/file-adapter-sa7-dynamic.test.ts` | 9 | 保留入 CI：D-A1 补 SA4 §5.2 无锚面（交错终态）；D-B1/B2、D-C1–C5 把 R2-AC1/2 从手工 fixture 提升到真实 writer 产物 + 物理篡改活链路；D-C6 锚定误分类残余后果有界 |

## 结论

- SA4 verdict=pass 之上，SA7 动态实证四项重点全部闭合：EACCES 残余在本环境取证关闭（+后果有界锚）、交错终态实测 ok（已补锚）、README 静态 stream 声明未回退、vitest 包触发本地全证据（CI 侧环境阻塞已如实登记）。
- R2-AC1/2/3 活链路实证通过；验证门槛三项全过（typecheck 0 / 全仓 138 文件 1719 测试绿 / diff-check 干净），基线对比零回退；node 20/24 双版本一致。
- 无需 SA3 返工项。遗留：发布后补录 PR CI `Test` step 触发行（总控权责）。

**verdict: pass**
