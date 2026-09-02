# SA7 动态验证报告 — issue #191 yjs-server 根锁 stale 回收原子化

- **Date**: 2026-08-30（UTC）/ 落盘 2026-08-31 03:1x（本地）
- **验证对象**: 提交 `f2bc4f0`（分支 `refactor/yjs-server-make-stale-root-lock-reclamation-atomic`，worktree `/home/wangjian/nomicore-fix-issue-191`）
- **输入**: `TASK.md`、`wiki/raw/task_191_sa1.md`（R2）、`wiki/raw/task_191_sa2.md`（R1 reject → **R2 pass/APPROVE**）、`wiki/raw/task_191_sa6.md`、`wiki/raw/task_191_sa3.md`
- **SA7 独立性声明**: 未改动任何业务代码/测试/配置；所有补充探针脚本只存在于 `/tmp/sa7-191/`（worktree 外）；本报告与 dispatch 追加为唯一 worktree 写入；未提交。
- **Verdict**: **APPROVE** — 动态域全项通过（详见 §6/§10）；SA4 静态审核同期完成且 verdict 一致（pass/APPROVE，见 §0）。附环境伪影说明（§3）。

---

## 0. Step 0 — SA4 verdict 校对

- SA4 静态审核报告 `wiki/raw/task_191_sa4.md` **verdict: pass / APPROVE**（零阻断项；非阻断观察 O1-O4）。SA4 与 SA7 曾同时被派发（2026-08-30T20:46:00Z），其报告在 SA7 动态验证过程中落盘——SA7 起草时 SA4 尚未出 verdict，终稿前已确认 **pass**。
- 静态门禁链完整：SA2 R2（设计）pass → SA4（实现静态）pass → 本报告（动态域）APPROVE——三层一致，无「上发/下调」冲突。
- SA4 对 SA7 的移交项（两个非确定性窗口评估 + 顺序全量回归）已在本报告 §5/§7 完成；SA4 O2（U+FFFD 解码碰撞理论边）位于已披露 §7.1 变体 3 窗内，SA4 已判非阻断，SA7 无新增动态证据需要补（不虚构）。

---

## 1. 提交完整性（范围与卫生，静态快查）

| 检查 | 命令 | 结果 |
|---|---|---|
| 提交内容 = ALLOW LIST + 任务档案 | `git show f2bc4f0 --stat` | ✅ `lifecycle.ts`/`index.ts`/SA6 测试文件/`docs/integration/hub-peer-deployment.md` + 5 个 wiki 档案；DENY（main.ts、4 存量测试、packages/**、构建配置）零触碰 |
| 提交 whitespace | `git show --check f2bc4f0` | ✅ 无输出（干净） |
| 工作树 diff | `git diff --check` | ✅ exit 0；`git status` 仅 `M wiki/raw/task_191_dispatch.md`（总控派发记录追加，非代码） |
| `flag:'w'` 生产残留 | 读 `apps/yjs-server/src/lifecycle.ts`（f2bc4f0 版） | ✅ `writeFileSync` 仅两处 `{flag:'wx'}`（:122/:189），生产代码无 `flag:'w'`；基线 b66615c :81 的 `flag:'w'` 确认已被移除（基线 worktree 复核） |
| 实现与设计结构对照 | 逐行读 lifecycle.ts:103-218 | ✅ ①mkdir→②wx（唯一持锁出口 break）→EEXIST→③seam①→判定读 grounding raw→活 pid 双态 loud（逐字）→④attempt≥8 →`did not converge`→⑤a seam②→⑤b 字节全等守卫→⑤c unlink（ENOENT→continue）→⑤d wx（EEXIST→continue）；release 读全等才删否则静默 no-op（JSDoc「刻意选择」）；nonce=randomUUID（:108）；`parseLockInfo(raw)` 等价重构（:39-47） |

---

## 2. 核心动态验证（独立后台进程执行，全部真实运行）

### 2.1 确定性红灯契约 T1-T9（两次独立运行）

```
cd /home/wangjian/nomicore-fix-issue-191
pnpm exec vitest run apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts
```

| 运行 | 结果 | 耗时 |
|---|---|---|
| R1（02:54Z） | **11 passed (11)**，exit 0，Type Errors no errors | tests 17ms |
| R2（03:05Z） | **11 passed (11)**，exit 0 | tests 11ms |

**确定性复核**：两次全绿、零 sleep、零真进程、零 fake timer —— 与 SA1 §5 的确定性声明一致；无闪烁。

### 2.2 基线红灯真实性独立复核（防「假绿灯」）

在 `/tmp/sa7-191/baseline`（`git worktree add … b66615c`，node_modules 符号链接，测试文件拷入）：

```
Test Files  1 failed (1)
      Tests  5 failed | 6 passed (11)   exit 1
```

**5 failed = T1（nonce 缺失）/ T4（败者不抛）/ T5（误删后继者锁）/ T8（守卫缺失）/ T9（无条件 unlink）** —— 与 SA6 记录的基线完全一致（5F|6P）。结论：提交的测试文件在基线上确定性红、在 f2bc4f0 上确定性绿，**非 vacuously green**，红→绿归因于修复本体。

### 2.3 存量锁面回归（真进程四套件，`--no-file-parallelism`）

```
pnpm exec vitest run --no-file-parallelism apps/yjs-server/test/smoke-skeleton-red.test.ts \
  apps/yjs-server/test/phase5-three-instance-acceptance-red.test.ts \
  apps/yjs-server/test/phase5-mgmt-verbs-sa7.test.ts apps/yjs-server/test/lifecycle-watchdog-red.test.ts
```

**结果（环境安静时独立复跑）：Test Files 4 passed (4) / Tests 16 passed (16)，exit 0，104.12s**

覆盖面逐项：干净停机释放 + 同 rootDir 重启读回（smoke）、共享活跃 root loud 拒绝（smoke AC2）、SIGKILL 真实崩溃 → stale 回收重启收敛（phase5 AC6）、管理动词全周期（mgmt-verbs）、watchdog（lifecycle）——**TASK.md AC「存量 normal acquire/release 与 stale 单进程恢复保持绿」成立**。

### 2.4 类型面与 diff 面

- root `pnpm typecheck`：**exit 0**（12 个 `tsc -p` 项目全过，含 apps/yjs-server）。
- `git diff --check`：干净（工作树）；`git show --check f2bc4f0`：干净（提交）。

---

## 3. 环境伪影记录（本机资源限额，非实现问题）

本机 `nproc=4`、用户进程上限 61041，但对**真进程测试并行**存在实际击穿面（SA3 §2.4 已披露）：

1. SA7 首次运行 §2.3 四套件时（02:56Z）**恰逢 SA4 的同名验证套件并行执行**（ps 取证：PID 872338 属 SA4 的 `vitest run --no-file-parallelism` 同四文件），两套真进程套件叠加 → 子进程 node 启动即崩：`uv_thread_create` 断言（exit 134/SIGABRT）、`tsx: Cannot fork`、SA7 自身 shell 亦 `spawn bash EAGAIN`。首轮 14 failed 的**全部**失败签名都是线程创建崩溃/无法 fork，**零锁语义断言失败**；SA4 并行运行亦同期出现 2 failed（互相污染）。
2. **精确归属处置**：逐 PID 核对（`ps -u wangjian -o pid,ppid,nlwp,etime,args`）后等待 SA4 运行自然结束、进程表清零（`pgrep -c node`=0），未对任何非本任务进程执行 kill（含 issue-139/168 worktree 遗留进程——15h/3h 前遗留，默认保留）。
3. 环境安静后同命令复跑 → **16/16 全绿（104s）**。结论：首轮失败为本机资源伪影，与 f2bc4f0 实现无关；`--no-file-parallelism` 是本机真进程套件的必要执行形态（host 已文档化）。

---

## 4. SA7 独立真进程竞态探针（本报告核心增量，脚本仅存 `/tmp/sa7-191/`）

> 目的：不依赖 seam 编排，用**真实多进程**对撞直接观测「双回收者恰一胜」不变量。判据按持有区间重叠判定真双持（V1）、静默败者/崩溃/锁泄漏分别计数。

### 4.1 冷启动对撞（3 真进程 × 同一 stale 锁）

| 代码 | 轮次 | 结果 |
|---|---|---|
| f2bc4f0 | 12 | **12/12 clean**：恰 1 胜、2 败者 loud（`shared file persistence root is unsupported…another instance holds`）、零重叠、零泄漏 |
| b66615c（基线） | 6 | 6/6 clean（！） |

**解读（诚实）**：tsx 冷启动偏差（数百 ms）≫ 判定→覆写窗口（µs 级），冷启动对撞**在坏代码上也基本撞不进窗口**——独立实证了 SA2 攻击点 8「真进程并发对撞不可稳定编排红灯」的判断，也说明冷启动探针**不能**作为判别器。

### 4.2 门控对撞（gate 文件对齐至 avg 0.5ms；先完成模块加载再同时开火）

同探针、同对齐度（avgGateSpreadMs=0.5 两组成对）：

| 代码 | 轮次 | 恰一胜 | 多持有重叠违例 | 静默败者 | 崩溃 | 泄漏 | exit |
|---|---|---|---|---|---|---|---|
| **b66615c（基线）** | 20 | 11 | **9**（含 3 轮 3/3 全持有） | 0 | 0 | 0 | 1 |
| **f2bc4f0（修复）** | 20 | **20** | **0** | 0 | 0 | 0 | 0 |

基线违例细节（真实观测、非编排断言）：

- round 5/12/14：**三个进程同时全部「持有」同一 root**；
- 同轮不同持有者读到的 `heldBytes` **互不相同**（各自读到不同覆写者的 payload）——正是 D1 `flag:'w'` 非独占覆写的双/多持形态；
- 多个持有者读到 `heldBytes=""`（空文件）——**§7.5 部分写入可见窗的天然现场观测**（读落在 open 与 write 之间）；
- 修复侧同条件 20/20 恰一胜、败者全部 loud、胜者持有期间锁内容唯一。

**结论**：D1 修复在真实多进程对撞下成立；判别器（gated probe）在基线上以 45% 违例率命中，在修复上 0/20——与 T4/T8 seam 契约互相印证。此探针按要求**不入库**（host 本轮禁改测试），仅存证。

### 4.3 迟到 release / 不可读锁文件（跨 AC3/RC3）

- AC3（迟到 handle 不删后继者锁）：T5 在套件内逐字节验证（§2.1 两次全绿含 T5）；
- RC3 delta（release 遇 chmod 000 → no-op 残留）：T9 实测执行（本机 uid 1000 非 root，`it.skipIf(isRootUser)` 不触发跳过），全绿。

---

## 5. 两个披露的非确定性窗口 — 诚实评估（不虚构测试）

| 窗口 | 设计披露 | SA7 动态评估 |
|---|---|---|
| **§7.5 部分写入可见窗**（`wx` open→write→close 三段非原子，读者可读空/半截 → 判 stale → 删活锁） | 现状既有、修复不放大且守卫反收窄（需两次读都落同一竞争者单次 write 窗内）；T6b pin「空文件=可回收」语义；硬化路径（temp+`link(2)`）明示半径外 | **不虚构确定性测试**（该窗在真进程下为 3 条相邻系统调用对撞，µs 级，不可稳定编排——SA2 攻击点 8 同判）。动态证据：① 基线 gated 探针**天然观测到** `heldBytes=""`（§4.2），证实窗口真实存在且现状可达；② 修复侧同条件 20 轮零违例——守卫+wx 回环使「读到空→判 stale→删活锁」路径收敛（守卫重读全等才删，竞争者 write 完成后字节必不等→回环重判活 pid→loud）。残余风险接受设计披露口径：窗口理论开放、概率远低于修复前形态、彻底关闭需 `link(2)` 硬化（另立 issue） |
| **§7.1 变体 3 残余窗**（守卫重读→unlink 两条相邻系统调用间被完成「unlink+wx」） | 唯一存活变体；四条系统调用精确对撞、亚微秒；dotlockfile 族固有语义；彻底消除需 flock/fcntl 内核原语（Node 核心不暴露，超半径） | 同上不虚构。动态侧证：gated 探针 0.5ms 对齐下修复侧 20 轮 × 每轮 3 竞争者从未触达（窗口比对齐粒度小 3 个数量级）。该窗若真发生其后果=一次双持（与基线常态行为同级、且概率极低），而基线在同等对齐下 45% 轮次违例——净风险数量级改善成立 |

**SA7 判词**：两窗口的披露与 SA1 R2 §7.1/§7.5 文字一致，无隐瞒、无虚假确定性声明；SA6 未为它们虚构并发用例（正确）；SA7 亦不虚构。评估为**披露充分、剩余风险可接受**。

---

## 6. 验收标准（TASK.md AC）逐条判定

| # | AC | SA7 证据 | 判定 |
|---|---|---|---|
| 1 | 确定性并发测试：双 stale 回收者恰一胜 | T4（三重锚）两次全绿 + gated 探针 20/20 恰一胜 | ✅ |
| 2 | 败者报 held 而非覆写胜者 | T4 锚 1/锚 3 + 探针败者 loud、胜者字节保全 | ✅ |
| 3 | 迟到/过期 handle 不能 unlink 后继者锁 | T5 逐字节断言两次全绿 | ✅ |
| 4 | 存量 normal/stale/恢复测试保持绿 | 四套件 16/16（环境安静复跑） | ✅ |
| 5 | app 焦点测试 + root typecheck + full pnpm test + git diff --check | §2.1/§2.3/§2.4 + §7 全量套件 | ✅（全量见 §7） |

**补充核**：正常获取/幂等释放（T1，含 nonce schema pin）、单回收者 stale（T2）、活 owner 双态文案逐字（T3×2）、不可写 root loud（T3.3，实测非 skip）、非法 JSON/空文件（T6a/b）、守卫 ENOENT 回环（T7）——全部两次运行全绿。

## 7. 全量 `pnpm test`（顺序执行）

```
pnpm exec vitest run --typecheck --no-file-parallelism   # = root "test" 脚本 + 顺序文件执行
Test Files  211 passed (211)
      Tests  2265 passed (2265)
Type Errors  no errors
Duration  318.15s    exit 0（03:10Z，环境独占窗口运行）
```

全仓 211 个测试文件（含 apps/yjs-server 全部真进程套件、SA6 红灯契约、四存量锁面套件、全部 packages/domains 单元面）顺序执行全绿，零跳过异常、零 unhandled error——**AC5 的 full pnpm test 在本机等效形态下通过**（`--no-file-parallelism` 仅为规避 host 已文档化的本机进程/线程限额，CI ubuntu 无此约束）。

## 8. Spec/vitest CI 触发证据（Step 3/4 立法）

本任务无 `*.spec.ts`（Playwright）；新增 `*.test.ts` = `apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts`（vitest workspace app 包，`vitest.config.ts` include `apps/*/test/**/*.test.ts` 已覆盖，root `pnpm test` 本地已真实执行）。**CI runner 证据本轮不适用**：分支未 push、无 PR/CI run（SA7 不负责 push/PR/宣称 CI 绿）。CI 触发性的动态摘录移交发布轮（Runner publication dispatch 后以 `gh run view` 补录）；静态门禁归 SA4。

## 9. 遗留与移交

- 探针脚本位于 `/tmp/sa7-191/`（child.mts / race.mts / race-gated.mts，供复查，不入库）；基线对照 worktree 已清理（`git worktree remove /tmp/sa7-191/baseline --force`，`git worktree list` 复核无残留）。
- **SA4 已完成**：verdict pass / APPROVE（`wiki/raw/task_191_sa4.md`），与本报告动态 APPROVE 一致——总控可进入发布轮；CI 触发性动态摘录（Step 4 vitest runner 证据）由发布轮补录（§8）。
- 环境建议（供总控/后续 SA）：本机禁止两套真进程套件并行执行（本轮已实证互毁：SA4 与 SA7 并行运行时双方共 16 个测试因 `uv_thread_create`/`Cannot fork` 崩溃，全部为线程创建失败签名、零语义断言失败；串行复跑双方全绿）；真进程套件一律 `--no-file-parallelism` 且独占运行窗口。

---

## 10. 结论

**verdict: APPROVE（动态域通过）**

- 确定性契约 T1-T9：基线 5F|6P → 修复 11/11 ×2 次复跑，红→绿归因明确、非假绿；
- 真进程对撞：基线 45% 轮次双/多持违例（含 §7.5 空读天然观测）vs 修复 0/20 违例、败者全 loud——D1 修复在真实调度下成立；
- 存量锁面 16/16、typecheck exit 0、diff 检查干净、范围合规（ALLOW 内 + 档案，DENY 零触碰）；
- 两非确定性窗口披露与实测相符，未发现超出披露的新风险；
- 唯一保留：本机资源伪影曾污染一次并行运行（已定性、复跑洗清）；SA4 静态 verdict = pass/APPROVE，与本报告一致，无未决冲突。
