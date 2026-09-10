# SA10 Spec 审查报告 — CI repair：`apps/yjs-server` 根锁 stale 回收双活竞态（PR #276 `test (24, 4)`）

> Phase：spec-review（iteration 1）。Dispatch：`sa-2be907c7-a5e9-481e-ba68-afcda9806784`（mabf-sa10）。
> 审查对象：committed CI repair HEAD `7ac6570ed989aaa49afa7a0767560b98f1d3797e`
> （`fix(yjs-server): serialize root lock reclamation`，parent `334494d`）。
> 对照基准（全部亲读）：设计 `wiki/raw/task_ci-pr-276_design.md`（SA1 iteration 5，808 行）、
> SA6 验收契约 `wiki/raw/task_ci-pr-276_sa6_contract.md`、SA2 iteration-4 **pass**
> `wiki/raw/task_ci-pr-276_sa2_review.md`、SA4 **clear** `wiki/raw/task_ci-pr-276_sa4_review.md`、
> SA3 实现报告 `wiki/raw/task_ci-pr-276_sa3_impl.md`。
> Issue/PR comments REST = `[]`——无 Owner 追加要求可映射（dispatch 注记，与 SA6/SA8/SA2 各轮一致）。
> 基座同一性：`git merge-base --is-ancestor a1ca2d7 7ac6570` 亲证成立（a1ca2d7 ← 704398c ←
> 08c0ea6 ← 334494d ← 7ac6570）。
> **结论：approve**——并发、liveness、兼容性、错误/消息、验收契约五维逐项核对全部满足；
> 无遗漏/部分实现/错误实现/scope creep；6 条 MINOR 披露项登记（均不阻断）。

## 1. 审查方法与亲证清单

本轮只做**规范一致性判断**（实现是否忠实满足 Issue 正文/Owner 评论/验收标准），通用架构风格与
仓库规范归 SA9。方法：(a) 生产/测试/文档实现全文亲读并对照设计 §7 伪代码、§8.1 定稿文案、§11
ALLOW/DENY、§12 E1-E9d 逐条映射；(b) `git diff 334494d..7ac6570` 对 DENY 面程序化核证；
(c) claimStuck 定稿文案对两个 regex 的程序化验证；(d) 冻结文案与 release() 对 pre-fix 版本的
字节级对拍；(e) SA4 可执行证据（V1-V14）作为活链路证据采信并抽查其关键锚点。

亲证锚点：`apps/yjs-server/src/lifecycle.ts`（503 行全文）、
`apps/yjs-server/test/root-lock-atomic-publication.test.ts`（379 行全文）、
`apps/yjs-server/test/root-lock-stale-reclaim-race-stress.test.ts`（181 行全文）、
`apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts`（L104/L107 锚点）、
`docs/integration/hub-peer-deployment.md` 与 `apps/yjs-server/AGENTS.md` 的 commit diff、
`334494d` 版 lifecycle.ts（heldError/loudUnwritable/reap 守卫链/release 对拍）。

## 2. 并发安全（I0/I1/I2 + 三层防线）——**满足**

| 设计规格 | 实现落点（本轮亲读） | 判定 |
|---|---|---|
| I1：canonical 自名称出现即含完整 owner.json（staging 完整构建 + 原子 rename 发布） | 私有 staging 目录 mkdir → `owner.json` wx 写 → claim-staging wx 写（L269-293）；唯一发布 = `renameSync(staging, canonical)`（L326） | ✓ |
| I2：成功出口唯一绑定 rename 原子事件 | `published = true` 仅在 rename 成功后置位（L327）；`break` 唯一出现于 `if (published)` 内（L338-347）；镜像失败 ⇒ rm **自有** canonical + rethrow（#10 唯一 recursive 例外，L343-346） | ✓ |
| I0：发布者与回收者在 canonical 上永不重叠（同持 claim 门） | CAS、证据阶梯、清障全部位于 `takeReapClaim(...)===true` 的 try 块内，finally 内容校验释放（L315-433，L211-217）；claim 挂名 = `linkSync` 原子（L159，B6 空窗修复）；死持有者接管 = rename-detach 单胜者 + 墓碑内容复核 + 误判回复位（L175-206） | ✓ |
| 防线二：`''` 证据永不触发目录 rename 摘除 | `raw !== ''` 主路径仅凭非空死 payload 双读摘除（L355-385）；`''` 分派 absent-continue / L1 rmdir / stray-nondir rename 摘除 / L2·杂散门内清障（L387-429） | ✓ |
| 防线三：条件原语（单胜者 rename / 空目录条件 rmdir / 名称条件 unlink） | L397-419 逐分支在位；子目录清障单遍 `rmSync(recursive, force)` 不传 `maxRetries`（L414） | ✓ |
| 主路径墓碑比对守卫链原样内联 | 复读 `claimedRaw !== raw → continue` → rename 摘除 → `movedRaw !== raw` 回复位（失败 ⇒ movedHeld loud）→ rm 墓碑（L360-384），与 `334494d` 原版守卫链逐行同构（本轮 diff 对拍） | ✓ |
| #11 清障 errno 契约 | 清障 catch：ENOENT/ENOTEMPTY → continue 复检；EACCES/EPERM → loudUnwritable；其余 rethrow（L421-428）；主 reap 链 catch 同形（L367-372） | ✓ |

活链路旁证（SA4 独立复核，采信）：140 轮 × 12 真竞争者 burn 零双活（V11）、12 路死 claim
接管风暴恰 1 acquired（V13-H）、对抗场景 A-H 全绿（V12/V13）。

## 3. Liveness（I3 + D6）——**满足**

| 设计规格 | 实现落点 | 判定 |
|---|---|---|
| `ROOT_LOCK_CLAIM_WAIT_LIMIT_MS = 5_000` 模块私有常量 | L33（不导出） | ✓ |
| 单调时钟 `performance.now()` | `node:perf_hooks` import（L15）+ L307/L310；无 `Date.now()` 计时混入 | ✓ |
| 计账单位 = claim 占用内容（nonce = 占用身份）；同内容连续判活 ≥ LIMIT ⇒ loud | `claimDenied`：`claimRaw !== deniedClaimRaw` ⇒ 重置基线；否则 `performance.now() - deniedSince >= 5000` ⇒ `throw claimStuckError`（L304-313） | ✓ |
| 更替/挂名/接管竞速/弃置 ⇒ 计账重置 | link 成功（L160）、acquire 侧持门后（L322）、接管竞速 ENOENT（L181）、误判回复位（L196）、死内容确认（L205）均调 `claimWaitReset` | ✓ |
| 绝不夺门：超时不删除/不移动他人 claim、不触碰 canonical | `claimDenied` 抛点位于 `takeReapClaim` 的 EEXIST 分支（本方未持门，L169-171）；claimStuck 经外层 finally 仅清**本方**双 staging（L434-447）；T7a③④ 钉位（claim 字节不变、canonical 未建，测试 L295-297） | ✓ |
| 恢复语义：自动接管（死 pid）+ 人工清除 | 死 pid claim 经 rename-detach 接管（T5 钉位，L203-207 预置死 pid claim 后获取成功）；T7b 人工 unlink 后获取成功（测试 L315-322） | ✓ |
| 无无界静默路径（#11 防 EACCES 静默自旋） | 全部 catch 三分类（continue 复检 / loudUnwritable / honest rethrow）；无裸 catch 吞错回环 | ✓ |

活链路旁证：SA4 V5 实测 T7a 抛于 **5002ms**（②′ ≥5000 ✓ / ② <20000 ✓）；T7c 5622ms 成功；
V13-G 真实外部冻结 pid ⇒ claimStuck ≥5s 不夺门 ⇒ kill 后自动接管。

## 4. 兼容性——**满足**

| 面 | 证据 | 判定 |
|---|---|---|
| 签名/导出面零变化 | `acquireRootLock(rootDir, instanceId): RootLockHandle` 原样；`src/index.ts` 在 commit 中零 diff（`git diff 334494d..7ac6570` 空）；新常量/构造器/`performance` import 全部模块私有 | ✓ |
| `STABLE_OP_ERROR_CODES` 不含 claimStuck | L487-503 十五项原样；claimStuck = plain `Error`（L100-106），不入稳定码 | ✓ |
| 三族冻结文案逐字保留 | `heldError`（L76-85）与 `loudUnwritable`（L70-74）对 `334494d` 版**字节级一致**（本轮 diff 对拍） | ✓ |
| 磁盘契约稳定面零变化 | `owner.json` `{instanceId, pid, nonce}` / `.nomicore-lock.json` 镜像字段与路径不变；新增名族（`.acquire-<uuid>`、`.reap-claim.staging-<uuid>`、`.reap-claim.reaped-<uuid>`）均为 rootDir 顶层瞬态件 | ✓ |
| `release()` 原样 | `let released = false` 起至文件尾与 `334494d` 版**逐字节相同**（本轮 diff：`RELEASE-IDENTICAL`） | ✓ |
| 调用方零改动 | `main.ts` 零 diff（DENY 核证）；boot/reload 通用 catch 对 claimStuck 一视同仁（stderr+`exit(1)` / `failBoot`）——设计 §10 矩阵成立 | ✓ |

## 5. 错误/消息一致性——**满足**

- **claimStuck 定稿文案逐字一致**（设计 §8.1 ↔ lifecycle.ts L104）：
  `root lock reclaim claim .nomicore-lock.reap-claim is still occupied by a live pid ({instanceId: <JSON>, pid: <JSON>}) after 5000ms without turnover: the holder is frozen or its pid was reused — verify that pid, then remove the claim file once you are certain it is stale (pid reuse caveat: see docs/integration/hub-peer-deployment.md)`；
  `{instanceId, pid}` 序列化与 `heldError` owner 串同款（L102 ↔ L79）。
- **程序化验证（本轮 node 执行）**：钉位 regex `/reclaim claim .* occupied by a live pid .*\(pid reuse caveat/`
  匹配 ✓；败者子串 regex `/held|unsupported/` **不相交** ✓（`held`/`unsupported` 子串均不在文案中；
  `holder` 不含 `held`）。#12 Option A 的 A1 硬约束落地，且 T7a⑥ 把不相交性钉为被测契约（测试 L307）。
- **无静默 fallback**：阶梯每个 `continue` 均为复检回环或有界自旋；回复位失败分支 loud（movedHeld）；
  claimStuck loud；不存在无出口空转路径（§9 终止性论证与实现一致）。
- **无生产测试钩子**（SA6 §15 裁决维持；grep 无 hook seam）。

## 6. 验收契约一致性（§12 E1-E9d）——**满足**

| 验收项 | 实现/证据 | 判定 |
|---|---|---|
| E1 双活消除（压力契约转绿 + ≥3 复跑） | stress 文件**零改动**（本轮对拍：L166 `toHaveLength(1)`、L127/L168 `/held\|unsupported/`、6 轮 × 12 竞争者 + 2 burner 与 SA6 §12 及 stress-red.log L166:28 锚点逐行对应）；SA3 3 连绿 + SA4 V3/V4 独立 3 连绿 | ✓ |
| E2 CI 恢复绿（实现侧） | canary **零改动**（DENY diff 空）7/7 绿（SA3/SA4）；SA4 V7 本地同形 `ci-test-shard.mjs 4 6` → 48 文件 / 453 测试 exit 0；**远端 PR #276 CI 重跑属总控/CI 裁决**（披露项 D6） | ✓（实现侧） |
| E3 非竞态语义零回归 + E8 杂散 parity | canary 其余 6 用例绿；T3/T4（杂散文件 / 指向外部目录符号链接）恒绿，无裸 ENOTDIR 逃逸；SA3 偏差（stray 墓碑 `unlinkSync` 替代 `rmSync(force)`——Node 24 对 symlink-to-dir 抛 EISDIR）经 SA4 V14 探针复验为**正确偏差** | ✓ |
| E4 既有套件零波及 | SA4 V6：全 app 套件 30 文件 / 162 测试全绿；`tsc -p apps/yjs-server/tsconfig.json` 干净（V1） | ✓ |
| E5a/E5b 升级遗留接管 | T1（L1）/T2（L2）确定性用例 + T6（L1/L2 × 12 真竞争者 + 2 burner 恰 1 acquired、11 rejected 匹配败者 regex、owner=镜像=winner、无 reap 残留）在位（测试 L176-256） | ✓ |
| E6 遗留名族 + 死 claim 自动接管 | T5 预置全族含 `.reap-claim.reaped-<uuid>`（#9 名族钉位）与死 pid claim（测试 L152-167、L203-207） | ✓ |
| E9a claim 门有界 + 不夺门 | T7a **七件断言全部在位**：① 钉位 regex（L289）、②′ 下界 `elapsed ≥ 5000`（L291）、② 上界 `< 4×5000`（L293）、③ claim 字节不变（L295）、④ canonical 未建（L297）、⑤ 无 staging 残留（L299-304）、⑥ `not.toMatch(/held\|unsupported/)`（L307）；30s 超时兜底（L312） | ✓ |
| E9b 人工清除恢复 | T7b 承 T7a 同 root：unlink claim ⇒ instance-B 获取成功、owner=镜像、release 干净（L315-322）；T7a 早红时 root 仍被 afterEach 清理的 park/re-register 机制在位（L308-310、L317-318） | ✓ |
| E9d/T7c 更替重置 | 内联 `node -e` 助手（**不新增 fixture 文件**，HELPER_SCRIPT L361-379）；原子换名 = 写 staging + `renameSync`（**无 unlink+write 空窗**，O-10）；测试进程**先字节轮询确认 nonce A 在场**再进入同步 acquire（L342-346，25ms 间隔，O-13(a)）；分段 ≈2800ms×2（合计 >5000、单段 <5000，O-13(b) 扩 δ 预算）；断言获取成功 + owner=镜像=instance-C + release 干净（L349）；30s 超时 | ✓ |
| 实现期变异自检义务（#12 验收条款，一次性不入库） | SA3 M1 自检日志（`/tmp/ci-pr-276-mutation/`）+ SA4 V9/V10 独立变异矩阵复核：M1/M1b/M0 红（②′+S3）、M3 红（超时 kill）、**M2-real 红（S3）**；复原后全绿 | ✓ |

**CI 装置**：新测试文件落 vitest include + shard 磁盘枚举自动收录（SA4 实测：publication → shard 3、
stress → shard 5、canary 仍 shard 4；各分片 48-49 文件与 CI 形状一致）；`.github/workflows/ci.yml` /
`scripts/ci-test-shard.mjs` / `vitest.config.ts` 零 diff（DENY 核证）。

## 7. 范围与 scope creep 核对——**满足**

- ALLOW 四行一一对应：`lifecycle.ts`（机制 + D6）、新测试文件、deployment doc、AGENTS.md；
  stress 契约与 wiki 证据为 SA6/各 SA 角色交付物入库。**零扩界。**
- DENY 零触碰（本轮 `git diff 334494d..7ac6570` 对 canary / fixture / `main.ts` / `src/index.ts` /
  `packages/**` / CI 装置输出为空，exit 0）。
- 文档同步与设计同变更集：AGENTS.md 边界句（原子 rename 发布 + 门等待有界）与 deployment doc
  （机制句、stale 回收句、Windows 能力句、名族清理口径、claim 卡死症状→处置句含
  `still occupied by a live pid … 5000ms` 引文、L250 pid 复用句不覆盖注记、#13 单调时钟/suspend
  注记）逐项在位。
- 无新增公共导出、无生产钩子、无 fsync、无 CONTEXT.md 域词、5000ms 未进配置面——SA8 iter-4
  关门重触发条款逐项未触（本轮对照）。

## 8. 披露项（PR 须如实披露；均非阻断）

| # | 级别 | 项 | 出处 |
|---|---|---|---|
| D1 | MINOR | deployment doc 名族清理口径的括号清单未显式列 `.nomicore-lock.acquire-<uuid>`（设计 §11 第 3 行清单含之；该名已在前句机制描述出现，「其余」上下文可读为涵盖）——文档顺手项 | SA4 OBS-1，本轮亲证 |
| D2 | MINOR | `claimStuckError(claimRaw)` 省略设计伪代码的 `waitedMs` 形参（常量内插）——纯形态差异，文案逐字一致 | SA4 OBS-3，本轮亲证 |
| D3 | MINOR | `claimWaitReset` 对协议内形态为冗余纵深防御；净级变异红灯由内容键控计账承载（m2-naive 副本实验 T7c 仍绿）——非守卫缺口 | SA4 OBS-2 |
| D4 | MINOR | T7c 的 M2 红灯依赖 nonce A 检测延迟 δ < 预算；已按 SA2 O-13(b) 取 2800ms×2 分段（δ 预算 ≈600ms）缓解；O-13(c)（δ>150ms 显式 fail）为可选项未实施——自检义务已兜底证明 M2-real 红 | SA2 O-13 / SA4 §6.2，本轮亲证 |
| D5 | 注记 | SA6 证据 `wiki/raw/task_ci-pr-276_sa6_ci-fail.log` 在 worktree 仍为未跟踪态（commit 收录了 red/stress-red 两 log 但未收该件）——仓库卫生项，不影响行为与验收 | 本轮 `git status` 亲证 |
| D6 | 注记 | **远端 PR #276 CI 重跑（E2 远端腿）尚未观测**——本地同形证据（shard 4 仿真 48 文件/453 测试绿、E1 ≥3 复跑、140 轮 burn）已满足设计 §12 实现侧要求；远端绿属总控/CI 裁决，PR 合入前须以真实 CI 重跑收口 | SA3/SA4 Deferred verification |

## 9. 结论

- 并发（I0/I1/I2 + 三层防线 + #11 errno 契约）：实现与设计逐条对应，结构零窗口主张有 SA4 独立
  重放/对抗/burn 证据支撑——**满足**。
- Liveness（I3 + D6 有界等待/loud 中止/更替重置/绝不夺门 + 恢复语义）：机制、常量、时钟、抛点
  位置、清理路径全部在位，实测 5002ms 抛、T7c 5622ms 成功——**满足**。
- 兼容性（签名/导出/磁盘契约/冻结文案/release 原样/调用方零改动）：多路字节级对拍一致——**满足**。
- 错误/消息（claimStuck 逐字 + 双 regex 程序化验证 + 无静默 fallback + 无钩子）——**满足**。
- 验收契约（E1-E9d 全绿、两冻结契约与 fixture 零改动、变异自检净级敏感、CI 自动收录）——**满足**。
- Owner 要求：Issue 评论为空，无追加要求；派发要求（CI 绿、不跳过/禁用/弱化测试、#8 liveness、
  #12 Option A、#13 如实化）全部落实。
- 无关键 AC partial/unmet/unachievable；无 scope creep；披露项 D1-D6 均为 MINOR/注记。

**Verdict: approve。**
