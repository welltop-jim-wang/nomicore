# SA3 Implementation Report

> Phase：implementation（iteration 1）。Dispatch：`sa-a254afd4-85f7-41b8-8d01-40c4ff6bf093`（mabf-sa3）。
> 任务：按最新批准设计（SA1 iteration 5 修订版，`wiki/raw/task_ci-pr-276_design.md`）实施 CI repair——
> `apps/yjs-server` 根锁 stale 回收双活竞态（PR #276 `test (24, 4)`），含 SA2 iteration-2 #8 催生的
> D6 claim 门活性预算与 SA2 iteration-3 #12（Option A）修订（文案不相交 + T7a②′/⑥ + T7c/E9d）。
> Issue/PR comments REST 读取为 `[]`——无 Owner 追加要求。

## Inputs consumed

| 输入 | 结论 |
|---|---|
| `wiki/raw/task_ci-pr-276_design.md`（iteration 5，808 行） | 全文亲读；实施蓝本（§7 D1/D1′/D2/D3/D4/D6 伪代码、§8.1 定稿文案与钉位 regex、§8.2 状态机、§9 errno/恢复语义、§11 ALLOW/DENY、§12 E1-E9d 验收、§14 P1-P10） |
| `wiki/raw/task_ci-pr-276_sa6_contract.md` + 证据 log 四件 + driver | 亲读；红灯契约与 CI 同形场景（§5/§12/§13） |
| `wiki/raw/task_ci-pr-276_sa2_review.md`（iteration 4 闭环核验轮，verdict pass） | 亲读；#12 A1-A4 逐项闭环证据（V1-V5 文案验证、§7 变异模拟、§15 红线测试思路、O-13/O-14 实现期观察） |
| `task_ci-pr-276_design_conflict_report.md` / `_iter3.md` / `_iter4.md` | 亲读（iter-4：H1-H8 clear + O4/B4′ 边界 + 关门重触发条款；无实施轮约束冲突） |
| 两契约测试 + fixture（DENY 面） | 全文亲读（canary L77/L78/L104-107/L121；stress L125-127/L165-168；fixture 单消息协议）——实现期零触碰 |
| 生产锚点 | `lifecycle.ts`（252 行旧版全文）、`src/index.ts` L70 导出面、`src/main.ts` 消费点语义（B8/B12） |
| 文档锚点 | `docs/integration/hub-peer-deployment.md` §锁文件与共享 root（L232-250）、`apps/yjs-server/AGENTS.md` Boundaries 末条 |

## Existing worktree reconciliation

- worktree HEAD = `334494d`（`git log -1` 亲证），与 SA6/SA2/SA8 各轮证据同一性一致。
- 初始 `git status`：生产代码零改动；未跟踪物 = SA6 交付物（stress 契约 + wiki 证据 6 件 + driver）。
- **无既有 `task_ci-pr-276_sa3_impl.md`、无未提交实现**（本文件为新产物，非修订态）。
- SA6 stress 契约文件（DENY）保持原样（实施前亲读存档；`git status` 无该文件改动标记——未跟踪态不变）。

## Changed paths

| Path | Design section | Change |
|---|---|---|
| `apps/yjs-server/src/lifecycle.ts` | §7 D1/D1′/D2/D3/D4/D6、§8.1、§8.2、§9、§11 ALLOW 第 1 行 | 获取臂重构：NEW① 私有 staging（CAS 件 `.nomicore-lock.acquire-<uuid>` + claim 件 `.nomicore-lock.reap-claim.staging-<uuid>`，wx 卫生位）→ NEW② claim 门（`linkSync` 原子挂名；死持有者 rename-detach 单胜者接管到 `.reap-claim.reaped-<uuid>` + 内容复核 + 墓碑删除；释放 = 内容校验 unlink）→ NEW③ 原子 CAS（errno 集 = EEXIST/ENOTEMPTY/ENOTDIR/EPERM-只读探测，成功出口唯一绑定 rename + 镜像发布；发布失败自清理 = 唯一 recursive 例外）→ NEW④ 证据门控阶梯（非空死 payload 双读摘除链原样内联；`''` → absent-continue / L1 rmdir / stray-nondir rename 摘除 / L2·杂散条目清障，errno 契约 #11）→ NEW⑤ 双 staging 清理。D6：`ROOT_LOCK_CLAIM_WAIT_LIMIT_MS = 5_000` + `node:perf_hooks` performance import + 占用计账（同内容连续活占 ≥ LIMIT ⇒ `claimStuckError` loud；更替/挂名/接管/弃置 ⇒ 重置；绝不夺门）。头注不变量措辞更新（I1/I2/I0/I3）。release() 原样保留 |
| `apps/yjs-server/test/root-lock-atomic-publication.test.ts` | §11 ALLOW 第 2 行、§12 E5a/E5b/E6/E8/E9a-E9d | 新增 9 用例：T1（L1）/T2（L2）/T3（杂散文件）/T4（指向外部目录符号链接，E8）/T5（E6 名族 + 死 claim 自动接管）/T6（E5b：L1/L2 × 12 真竞争者 + 2 burner，恰 1 acquired、11 rejected 匹配 `/held\|unsupported/`、owner=镜像=winner、无 reap 残留）/T7a（E9a 七件断言：钉位 regex、②′ 下界 ≥5000ms、② 上界 <4×5000ms、claim 字节不变、canonical 未建、无 staging 残留、⑥ 不与 `/held\|unsupported/` 相交）/T7b（E9b 承 T7a 同 root 人工清除恢复）/T7c（E9d：内联 `node -e` 助手原子换名两次更替 ≈2800ms×2，合计 >5000ms、单段 <5000ms ⇒ 获取必须成功） |
| `docs/integration/hub-peer-deployment.md` | §11 ALLOW 第 3 行 | §锁文件与共享 root：机制句改为原子 rename 发布 + claim 互斥门 + 门等待有界 5000ms loud；stale 回收句措辞更新（门内重读 + 墓碑比对 + 回环 rename 发布）；Windows/非 POSIX 能力句；瞬态名族全清单（含 `.reap-claim.reaped-<uuid>`）与人工清理口径；claim 卡死症状→处置句（引文 `reap-claim … still occupied by a live pid … 5000ms`）+ L250 pid 复用句不覆盖注记 + 单调时钟/suspend 注记（#13）；其余语义句零变化 |
| `apps/yjs-server/AGENTS.md` | §11 ALLOW 第 4 行 | Boundaries 末条：排他 mkdir 句 → 原子 rename 发布完整 staging 目录句（canonical 首次可观察即完整；发布与回收经 `.reap-claim` 门串行；门等待有界——超时 loud，绝不无界静默等待） |
| `wiki/raw/task_ci-pr-276_sa3_impl.md` | SKILL 实现报告 | 本报告 |

## SA2 Finding落实

| Finding ID | Implementation | Result |
|---|---|---|
| iteration-1 #1 CRITICAL（`''` 证据摘除 phantom） | D1′ 三层防线全落地：claim 门覆盖 CAS 发布者与回收者；`''` 证据永不触发目录 rename 摘除（absent → 回环 CAS；在场形态走条件原语）；主路径墓碑比对 + 回复位失败 loud 分支原样内联 | 落实（结构由 E1 ≥3 复跑 + E7 driver burn + canary 零改动转绿验证） |
| iteration-1 #2 MEDIUM（杂散文件/符号链接裸 ENOTDIR） | D2：ENOTDIR 并入 CAS 争用 errno 集；stray-nondir rename 摘除 + 墓碑删除；T3/T4（E8）钉位（修复期实测发现 `rmSync(tomb,{force})` 对 symlink-to-dir 抛 EISDIR，改用 `unlinkSync`——行为符合设计「摘除非目录名」） | 落实（T3/T4 恒绿） |
| iteration-1 #3 MEDIUM（Windows/EPERM 表述） | D3：CAS EPERM/EACCES 只读 `lstatSync` 探测分类；文档能力句同步 | 落实 |
| iteration-1 #4 MEDIUM（协议假设章节） | 无代码面；P1-P10 已由设计固化，实现只依赖标准 fs 语义（§14 探针结论与实现一致） | 落实（文档/设计面） |
| iteration-1 #5 LOW（R7 混版本双向） | 实现不引入可被旧版误伤的 canonical 中间态（I1）；边界句维持设计口径 | 落实（假设维持） |
| iteration-1 #6 LOW（遗留族运维口径） | 名族常量立法 + 文档清理口径（含新 `.reap-claim.reaped-<uuid>`） | 落实 |
| iteration-1 #7 LOW（测试契约完备性） | 新测试文件 T1-T7c + E1/E5b/E6/E8/E9 验收面 | 落实 |
| iteration-2 #8 MAJOR（claim 门无界静默自旋） | D6 全机制：有界等待（同内容占用 ≥5000ms ⇒ claimStuck loud）、占用更替计账重置、绝不夺门（T7a③ 字节不变钉位）、外层 finally 清 staging；文案含五要素；T7a/T7b/T7c 确定性可测 | 落实（T7a 5002ms 抛、T7b 恢复、T7c 5626ms 成功） |
| iteration-2 #9 MINOR（接管墓碑名立法） | `.nomicore-lock.reap-claim.reaped-<uuid>` 常量 + 代码 + T5 名族 + 文档四处一致 | 落实 |
| iteration-2 #10 MINOR（rmSync-recursive 作用域） | 清障阶梯恒 rmdir/unlink；唯一 recursive 例外 = 发布失败自清理（代码注释 #10） | 落实 |
| iteration-2 #11 MINOR（裸 catch errno 契约） | 清障/阶梯 catch 显式映射：ENOENT/ENOTEMPTY → continue 复检；EACCES/EPERM → loudUnwritable；其余 rethrow | 落实 |
| iteration-3 #12 MAJOR（Option A A1-A4） | A1：文案 `occupied` 措辞逐字落地（无 `held`/`unsupported` 子串，程序化复核 V 见 Verification），钉位 regex 实测匹配；A2：T7a ②′（≥5000ms 下界）+ ⑥（不相交断言）落地；A3：T7c 原子换名助手（禁 unlink+write 空窗；nonce argv 传入 + 字节轮询确认 + 25ms 间隔；分段 ≈2800ms×2 按 O-13(b) 扩裕度）；A4：实现不产生任何「契约转红即误触发」表述 | 落实（变异自检证据见 Verification） |
| iteration-3 #13 MINOR（R8-② 时钟方向） | 实现用 `performance.now()` 单调时钟；文档注明挂起/饥饿下墙钟可能长于 5000ms | 落实 |
| O-13（实现期观察，SA2 §14） | 轮询间隔 ≤25ms；分段取 ≈2800ms×2（δ 预算 ≈600ms）；helper 经 argv 传 nonce，测试字节比对 | 落实 |

## File scope check

| Changed path | ALLOW entry | Purpose |
|---|---|---|
| `apps/yjs-server/src/lifecycle.ts` | ALLOW 第 1 行 | 唯一根因修复点 + D6 liveness 修复点（设计 §11） |
| `apps/yjs-server/test/root-lock-atomic-publication.test.ts` | ALLOW 第 2 行 | 新增确定性 + 并发契约（T1-T7c） |
| `docs/integration/hub-peer-deployment.md` | ALLOW 第 3 行 | 规范文档与实现同变更集同步（B1″） |
| `apps/yjs-server/AGENTS.md` | ALLOW 第 4 行 | 模块契约边界句同步（B9 + D6） |
| `wiki/raw/task_ci-pr-276_sa3_impl.md` | 本角色产物 | SA3 实现报告（SKILL 规定路径） |

DENY 面零触碰：canary / stress / fixture / `main.ts` / `src/index.ts` / `packages/**` / CI 装置 / SA6 证据文件全部未改（`git status` 核证：deny 路径无任何 diff 标记；SA6 stress 契约保持其原始未跟踪态与字节）。

## Verification

环境：node v24.13.0 / vitest 3.2.7 / `NODE_OPTIONS=--conditions=nomicore-source` / `maxWorkers:1`（与设计 §12、SA6 §4 口径一致）。

| Command | Result | Evidence |
|---|---|---|
| `tsc -p apps/yjs-server/tsconfig.json`（含 src+test） | 干净 | 多轮 TSC-OK（含最后复原后复跑） |
| `vitest run apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts`（CI canary，DENY 文件零改动） | **7/7 绿**（含 CI 红用例 `real-process stale reclaim race …`，826ms/520ms） | 实跑输出 |
| `vitest run apps/yjs-server/test/root-lock-stale-reclaim-race-stress.test.ts`（SA6 压力契约，零改动） | **3/3 绿**，主契约 6 轮 ~5.6s | 实跑输出 |
| 同 stress 契约连续复跑 ×2（E1 ≥3 次全文件复跑） | 3 连绿（每次 3/3） | 实跑输出（bash 后台 job） |
| `vitest run apps/yjs-server/test/root-lock-atomic-publication.test.ts`（新契约） | **9/9 绿**（T7a 5002ms 抛、T7c 5626ms 成功、T6 1491ms） | 实跑输出 |
| `vitest run apps/yjs-server/test`（全 app 套件，E4） | **30 文件 / 162 测试全绿**（含全部既有跨包契约；typecheck 无错） | 实跑输出 415s |
| 三契约文件联跑（复原后最终确认） | 3 文件 / 19 测试绿 | 实跑输出 |
| claimStuck 文案程序化复核 | 钉位 regex `/reclaim claim .* occupied by a live pid .*\(pid reuse caveat/` 匹配；`/held\|unsupported/` 不相交（assertion ⑥ 同源） | node 复核输出 |
| 变异自检（§12 义务，一次性不入库）：临时 M1「首拒即抛」 | publication 文件红（T7a ②′ `expected 0.4 ≥ 5000` false、T7b/T7c 红）+ stress 主契约红（败者 regex `expected false to be true`）——**验收网对急起爆敏感**；复原后三文件 19 测试全绿 | 输出存 `/tmp/ci-pr-276-mutation/m1-publication.log`、`m1-stress.log`（评审证据，不入库） |
| E7 验证 driver burn（可选加强） | **200 轮 × 12 真竞争者 + 2 CPU burner，DOUBLE-rounds = 0**（driver exit 0；`stream burn200: DONE rounds=200 DOUBLE-rounds=0`） | 实跑输出 |

## Deferred verification

- 真实 PR #276 CI 重跑（`node scripts/ci-test-shard.mjs 4 6` CI 分片全绿属 E2；本地同形 app 套件已全绿，
  CI 装置裁决归总控/CI，非 SA3 义务）。
- SA4：实现与设计伪代码逐行保真对拍（含 §7 伪代码 ↔ 本文件行结构）、T7a/T7c 实机红灯性复验、
  P1-P9 探针对拍、B2″ 义务。
- SA7：活链路/真实环境验收（含 Node 20 交叉、Windows 非一等声明面）。

## Deviations or blockers

无阻塞偏差。实现期两处工程决策（均在设计许可内，已记录于 Changed paths/SA2 Finding 表）：

1. stray-nondir 墓碑删除用 `unlinkSync` 而非 `rmSync(tomb, {force:true})`——实测 Node 24 的
   `rmSync(force)` 对 symlink-to-dir 抛 `ERR_FS_EISDIR`（T4 首跑即红发现）；`unlinkSync` 语义 =
   「摘除非目录名后删除链接/文件本体」，与设计 detaching-stray 表述一致。
2. T7c 分段取 ≈2800ms×2（合计 ≈5600ms > 5000ms、单段 <5000ms）——按 SA2 §14 O-13(b) 建议扩
   M2 红灯 δ 预算（≈600ms）；文案/常量/断言与设计零出入。

## Suggested commit message

```
fix(yjs-server): atomically publish root lock and bound the reap-claim gate wait

Root-lock acquisition now builds a private staging directory with the full
owner.json and publishes it with a single atomic rename (canonical is never
observable without complete content), which structurally eliminates the
double-owner race CI caught on PR #276 (test (24, 4)). CAS publishers and
stale reclaimers serialize on the .reap-claim gate (atomic hard-link claim,
single-winner dead-holder takeover with content re-check); waiting for a live
claim holder is bounded (5000ms, monotonic clock) and fails loudly with a new
claimStuckError instead of spinning forever — the gate is never seized and
legal contention turnover resets the accounting. Legacy residues (empty
canonical, {owner.json:""}, stray files/symlinks, transient artifact families)
are cleared under gated conditional primitives with an explicit errno
contract. Adds deterministic publication/staleness/liveness contracts
(root-lock-atomic-publication.test.ts) and syncs hub-peer-deployment.md and
apps/yjs-server/AGENTS.md. Canary and SA6 stress contracts stay untouched and
turn green.
```
