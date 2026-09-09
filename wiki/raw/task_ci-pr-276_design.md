# SA1 架构设计 — CI repair：`apps/yjs-server` 根锁 stale 回收双活竞态（PR #276 `test (24, 4)`）— 修订版

> Phase：design（iteration 5，原位修订 iteration 4 全文）。Dispatch：`sa-a3c0694f-2bac-40e9-bd63-15ad64a3e85a`（mabf-sa1）。
> 上游输入（全部亲读）：SA6 验收契约 `wiki/raw/task_ci-pr-276_sa6_contract.md`（approve，含可执行压力契约
> `root-lock-stale-reclaim-race-stress.test.ts` 与 CI/红跑证据四件）；SA8 设计后冲突复审 iteration 2
> `wiki/raw/task_ci-pr-276_design_conflict_report.md`（clear + 重触发条款）、iteration 3
> `task_ci-pr-276_design_conflict_report_iter3.md`（clear，G1–G8 + N1′/O2/O3 + 收窄后的重触发条款）
> 与 **iteration 4 `task_ci-pr-276_design_conflict_report_iter4.md`（clear，H1–H8 + N1″/O2/O4 +
> B1″–B4′ 边界移交——iteration 4 设计的保守复查已由该报告闭环）**；SA2 攻击评审
> `wiki/raw/task_ci-pr-276_sa2_review.md`（iteration 3 verdict **reject（窄幅）**：D6 机制本体与
> D1/D1′/D2/D3/D4 既有解全部复核肯定、不许重开；新增 **#12 MAJOR**——「E1 压力契约兼任 D6 误触发
> 守卫」论证与 claimStuck 定稿文案的 `held` 子串矛盾（守卫不存在），且「预算过早起爆」「占用更替
> 计账重置失效」两类实现变异对全部既有验收面全盲——加 #13 MINOR R8-② 时钟方向写反）。**本修订按
> SA2 §12 #12 Option A（推荐路径）逐条落实 #12 与 #13，机制本体（D1/D1′/D2/D3/D4/D6）零改动，
> 保留 iteration 1/2 全部 finding 的既有解，见 §15 映射表。**
> 任务 worktree HEAD = `334494d`（= CI 失败 head，本轮 `git log -1` 亲证，与 SA6 §4 / SA2 三轮 / SA8
> 四轮证据清单同一性一致）。Issue/PR comments REST 读取为 `[]`——无 Owner 追加要求（dispatch 注记与
> SA6 §2 / SA8 各轮 / SA2 各轮六方一致）。本设计只产出设计证据；除 §11 ALLOW LIST 四文件外不改任何
> 生产代码或测试。

## 0. 设计结论摘要（iteration 5 修订后）

1. **D1 主体保留**（iteration 3 机制本体，SA2 三轮均认可）：获取成功臂 = 私有 staging 目录完整构建 +
   原子 `rename(staging → canonical)` 发布（CAS）。canonical 自名称出现即含完整 `owner.json`（I1），
   成功出口唯一绑定 rename 原子事件（I2）。争用臂与 release 的既有守卫链保留。
2. **D1′ 保留**——claim 门与证据门控阶梯：所有 canonical 变更者（CAS 发布者与回收者）经同一互斥门
   `.nomicore-lock.reap-claim` 串行；claim 原子挂名（link）、死持有者单胜者接管（rename-detach + 内容
   复核）、内容校验释放；非空死 payload 双读是目录摘除的唯一证据；`''` 证据按 canonical 形态分派
   （缺席 ⇒ 回环 CAS / 空目录 ⇒ rmdir / 杂散非目录 ⇒ rename 摘除 / 升级遗留与杂散条目 ⇒ claim 门内
   清障）。**SA2 iteration 2 独立重放确认三层防线下 phantom 协议内不可达——本修订不改其结构。**
3. **D6（iteration 4 新增，SA2 iteration-3 复核机制本体无反例、本轮零改动）——claim 门活性预算**：
   claim 门位于每次获取的同步关键路径，其「活持有者」失活形态（持有者 pid 被复用或持有者被冻结，
   二者在判活上同形：pid 存活但永不释放）不得演化为无界静默自旋。机制 = **有界等待 + loud 中止 +
   占用更替重置 + 绝不夺门**：同一 claim 占用（同内容、含 nonce）连续被判「活持有」≥
   `ROOT_LOCK_CLAIM_WAIT_LIMIT_MS`（5000ms，模块私有常量）⇒ 抛出**新的唯一 loud 错误**
   `claimStuckError`（文案含 claim 名、持有者 `{instanceId, pid}`、等待上限与处置指引）；claim 内容
   更替（合法竞争换手）或缺席即重置计账；超时中止**不删除/不移动他人的 claim、不触碰 canonical**
   （夺门会重启 SA2 已证的 phantom 窗口——备选 9 否决）。CPU 燃烧与等待同界（≤ 5000ms/次连续占用）。
   **（iteration 5 修订，#12 Option A）claimStuck 定稿文案避开子串 `held` 与 `unsupported`**（改用
   `occupied`——§8.1），使其与两冻结契约的败者子串 regex `/held|unsupported/`（canary L107、
   stress L127/L168，本轮亲证）**不相交**——误触发时两契约真实转红（概率性兜底）；**误触发的
   确定性守卫** = T7a②′ 墙钟**下界**（≥5000ms）+ T7a⑥ 文案不相交断言 + **T7c 占用更替重置用例**
   （连续换手合计 >5000ms、单段 <5000ms ⇒ 获取必须成功——§12 E9a/E9d）。
4. **ENOTDIR/EPERM 分类（iteration 3 D2/D3 保留）**：`ENOTDIR` 并入 CAS 争用 errno 集转入阶梯；
   `EPERM` 经只读 `lstatSync` 探测分类（在场 ⇒ 争用转阶梯；缺席 ⇒ 既有 `loudUnwritable`，文案不变）。
5. **MINOR 修订（iteration 4 落实，本轮保留）**：#9 claim 接管墓碑名立法为模块私有常量
   `.nomicore-lock.reap-claim.reaped-<uuid>` 并入全部名族清单；#10 D4 绝对化表述限定作用域（清障阶梯
   中 canonical 永不承受 `rmSync(recursive)`，发布失败自清理为唯一例外）；#11 全部清障 catch 显式
   errno 契约（ENOENT/ENOTEMPTY ⇒ continue 复检；EACCES/EPERM ⇒ 既有 loud 映射；其余 rethrow）。
6. **不变量（修复后，四条）**：
   - **I1** canonical 自其名称出现的那一刻起 `owner.json` 必然完整（rename 单系统调用原子携带整个目录）。
   - **I2** 成功出口唯一且绑定原子事件 `rename(staging → canonical)` 成功。
   - **I0** 发布者与回收者在 canonical 上**永不重叠**：二者均须持 claim；claim 挂名原子、接管单胜者、
     判活可靠；即使瞬态双回收者，destructive 操作均为单胜者 rename / 名称条件 unlink / 空目录条件
     rmdir，任意交错下仍无双活（§8.3）。
   - **I3（新增，liveness）** claim 门等待有界：任意 `acquireRootLock` 调用在任一连续同内容 claim
     占用上至多等待 `ROOT_LOCK_CLAIM_WAIT_LIMIT_MS`，随后必然产生可观察结果（成功 / 既有三类 loud /
     新 claimStuck loud）——不存在无界静默等待路径。
7. **requiresConflictRecheck = false**（§16）：iteration 4 设计自判的保守复查已由 SA8 iteration 4
   报告（clear，H1–H8）闭环；本轮修订面 = claimStuck **尚未实现**的错误文案措辞（避开 `held`/
   `unsupported` 子串）+ 新测试文件内断言（T7a②′/⑥、T7c）+ §11 既有 ALLOW 文档行内引文同步 +
   设计文本——SA8 iteration 4 关门重触发条款（fsync / packages 与 ADR-0006 冻结布局 / 新增公共
   导出或将 claimStuck 纳入 `STABLE_OP_ERROR_CODES` / CONTEXT.md 域词 / ALLOW-DENY 扩界 /
   5000ms 进配置面）逐项未触，且 **B4′ 已预裁「改文案须同步 T7a regex 与 §8.1」的修订路径**——
   无需回炉（§16）。

---

## 1. 任务类型、目标与非目标

**类型：Bug（CI repair，并发缺陷）**（SA6 §1 / SA8 同判；SA2 三轮六维评审同判）。

- 症状：PR #276 GitHub Actions 作业 `test (24, 4)`（run
  [34296011254](https://github.com/welltop-jim-wang/nomicore/actions/runs/34296011254/job/102292700330)，
  head `334494d`）中，canary `apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts` 用例
  "real-process stale reclaim race has exactly one live owner" 断言红：
  `expected [ { type: 'acquired', …(1) }, …(1) ] to have a length of 1 but got 2`
  （12 个真进程竞争者回收同一 stale 根锁，2 个进程都从 `acquireRootLock` 成功返回，持有窗口
  重叠 = 双活 owner）。
- 目标：**结构性消除**双活可能（SA6 §12「修复须结构性消除双活可能 ⇒ 任意轮数零双活，非概率性
  变绿」——SA2 明确该标准是**结构零窗口**而非「足够窄」），使 PR #276 CI 恢复绿色且**不跳过/
  不禁用/不弱化任何测试**（SA6 §2）；并（迭代 4 派发指令）使正确性承载的 claim 门在 pid 复用/
  冻结持有者形态下**不产生同步无界静默自旋**——行为有界、可观察、可恢复、可验收；且（迭代 5
  派发指令）其**误触发守卫与验收钉位须真实有效**——文案与冻结契约败者 regex 不相交、等待钉位
  下界与上界、占用更替重置有确定性用例（#12 Option A，§8.1/§12 E9）。
- 非目标：
  - 不引入生产测试钩子（SA6 §15 移交的设计裁决：**否**——SA8 F6 复核钩子 seam 在 HEAD 已不存在，
    拒绝不撤销任何现存公共面；行为级契约 + 新增确定性用例足够验收。D6 的有界化使 reused-pid/
    冻结形态**首次可无钩子确定性测试**——§12 E9，进一步降低钩子诉求）；
  - 不改变根锁磁盘契约的稳定面：`owner.json` / `.nomicore-lock.json` 字段、路径、诊断语义零变化
    （新增的仅为瞬态 staging/claim-staging/claim-接管墓碑名，见 §8.1/§13 R2）；
  - 不改动 `packages/persistence`（不持有该锁，SA6 §10；SA8 F3）；**签名与公共导出面零变化**
    （`src/index.ts` L70 亲证）；**既有错误消息文案零变化**（`held by the same instance…` /
    `shared file persistence root is unsupported…` / `cannot write .nomicore-lock.json in rootDir (…)`
    三族逐字保留）；**新增的唯一公共可观察输出**为 D6 的 claimStuck 错误文案（§8.1 定稿，iteration 5
    起以「不含子串 `held`/`unsupported`」为文案硬约束——与两冻结契约的败者 regex 不相交，#12 Option A）——
    该路径在 iteration 3 设计中为无界挂死（缺陷形态），在旧代码中不存在（干净 root 不触 claim），
    无任何已钉位断言依赖其现状；
  - 不把 `acquireRootLock` 异步化（同步签名是既有契约，备选 12 否决）；不处理 NFS rename 语义、
    Windows 一等支持（§13 R1 如实矩阵）；不处理 pid 复用误判本身（R4 既有边界，D6 只把它从
    「静默挂死」改为「有界 loud + 人工恢复路径」）。

## 2. 当前行为与证据锚点（源码事实，HEAD `334494d`）

| # | 事实 | 锚点 |
|---|---|---|
| B1 | `acquireRootLock(rootDir, instanceId)` 是根锁唯一实现；目录 `.nomicore-lock/` 为权威 token，`owner.json` 写 `{instanceId, pid, nonce}`，`.nomicore-lock.json` 为诊断镜像 | `apps/yjs-server/src/lifecycle.ts` L20-22 / L110-111 |
| B2 | 获取成功路径 = `mkdirSync(canonical)` → `writeFileSync(ownerPath, payload, {flag:'wx'})` → `publishLegacyMirror` → `break`；写失败臂 `rmSync(canonical)` 后 rethrow | lifecycle.ts L122-137（成功臂 L124-128，rm 臂 L129-131） |
| B3 | `writeFileSync(...,{flag:'wx'})` = `openat(O_CREAT\|O_EXCL)`（建**空**文件）+ `write(2)` 两个系统调用，间隙可被抢占 | SA6 strace（`task_ci-pr-276_sa6_red.log` §4）；Node 语义 |
| B4 | 争用路径：mkdir EEXIST → `readOwner` → `heldError` 判 stale → reap-claim 串行 → 复读守卫 `claimedRaw !== raw` → `renameSync(canonical, tombstone)` 摘除 → 墓碑内容比对（不等则抢回复位）→ `rmSync(tombstone)` → 回环 mkdir | lifecycle.ts L139-195（readOwner L76-82；守卫 L166-169；摘除 L170；比对 L178-187） |
| B5 | **`readOwner` 把 ENOENT（owner.json 缺失/目录缺席）、ENOTDIR（canonical 非目录）、空文件、读失败全部坍缩为 `''`**——「缺席」与「内容无效」在既有代码中不可区分 | lifecycle.ts L76-82（catch-all → `''`） |
| B6 | **claim 缺陷（SA6 A1①）**：claim 创建 = `writeFileSync(reapClaim, payload, {flag:'wx'})`——与 owner.json 同款「先建空后写」两段，空读可致活 claim 被 L156 无复验 `unlinkSync` 误删 → 回收者并发化 | lifecycle.ts L148 / L151-157 |
| B7 | release：rename 摘走 canonical → 墓碑 payload 比对（只删自己的）→ 删 `owner.json` + rmdir → 镜像属主比对删除；幂等；迟到 release 有回复位守护 | lifecycle.ts L198-232 |
| B8 | 消费方：仅 `apps/yjs-server/src/main.ts` L132（SIGHUP 换装重取）与 L193（file 模式启动），经 `src/index.ts` L70 re-export；两处 catch 均为**通用错误处理**（boot：stderr + `exit(1)`，L194-197；reload：`failBoot` → stderr + `exit(1)`，L133-135）——对任何 thrown Error 一视同仁；测试消费 = canary、SA6 压力契约、`test/fixtures/root-lock-worker.ts`（fork 真进程，单消息协议） | main.ts L125-145/L185-205；index.ts L70；fixture L8-23 |
| B9 | 文档契约：`docs/integration/hub-peer-deployment.md` §锁文件与共享 root（L232-250）——「`mkdir` 是唯一获取线性化点」「stale 回收：竞争者以原子 `rename` 移到唯一墓碑路径，再以 `mkdir` 竞争新权威目录」；**L250 pid 复用句只覆盖权威目录 `.nomicore-lock/`，不覆盖 claim 门形态**；`apps/yjs-server/AGENTS.md` Boundaries 末条「以排他 `mkdir` 取得权威 `.nomicore-lock/` 目录…共享活跃 root 被拒」 | 两文件原文（§11 ALLOW LIST 同步修订） |
| B10 | 无 ADR 管辖根锁（`docs/adr/` 14 文件 grep `根锁/root lock/rootLock/nomicore-lock` 零命中，SA8 F1/iter-3 G1 两轮亲证）；根锁唯一规范 = B9 两处 + lifecycle.ts L105-108 注释 | SA8 iter-3 §裁决总表；本设计复核一致 |
| B11 | **claim 等待的旧形态（SA2 #8 证据基线）**：旧代码 EEXIST 分支 `heldError(...) !== undefined → continue`（L155）为**同步无界自旋**——但其暴露面**仅限争用臂**（L139 之后）：canonical 缺席的干净 root 获取走 L122-137，**从不触碰 claim**；pid 复用/冻结只卡回收者，不卡获取者 | lifecycle.ts L122-137 vs L146-161；SA2 iteration 2 §7 A6 |
| B12 | **调用点的同步性与 watchdog 形态（SA2 #8 证据基线）**：`acquireRootLock` 为同步函数；两处调用点（boot L193 / reload L132）在调用期间事件循环被独占——`STOP_WATCHDOG_MS = 60_000` 的 reload watchdog 是 `setTimeout` 宏任务（L100-105），SIGTERM/SIGINT 处理器同为事件循环回调（L210-211），**同步自旋期间全部无法触发**；进程仅 SIGKILL 可终止 | main.ts L30/L100-105/L125-145/L185-205/L210-211 |

## 3. 根因（承接 SA6 §8；SA2 三轮独立复核一致）

失败链（SA6 S3→S7，iteration 1 逐条源码验证，SA2 认可）：

1. **S3 空 owner 窗口**：mkdir 赢家 W 在 `openat(O_EXCL)`（空文件已建）与 `write(payload)` 之间被
   抢占；期间 canonical 存在但 `readOwner` 读到 `''`。
2. **S4 回收者摘走活目录**：竞争者 R 两次读空 → 判 stale → 守卫 `claimedRaw === raw('')` 通过 →
   `renameSync(canonical, tombstone)` 摘走 W 刚 mkdir 的目录并随墓碑删除。
3. **S5 W 仍「成功」**：W 恢复后 write/close 走已摘走目录的 fd 仍成功；镜像写在 rootDir 层不受
   摘除影响 → W `break` 返回成功。
4. **S6 R 亦成功** → 两进程同时自认 owner（CI 断言得 2）。
5. **S7 最深根因**：成功条件不与「canonical 路径仍归属本 handle」绑定；stale 判定把「owner.json
   缺失/为空」与「owner 已死」等同——而空 owner 也是**活获取者的写入中间态**。B9 文档不变量
   「同 root 活跃 owner 唯一、运行期不重叠」被击穿。

**SA2 iteration-1 #1 在 iteration 1 设计上追加识别的残余竞态（iteration 3 D1′ 已关死，本修订保留）**：
即便 I1 消除了获取者自身的空窗口，保留的争用臂仍可用 `''` 证据（= 缺席 **或** 内容无效，B5 坍缩）
对目录执行 rename 摘除：(a) 回收者 R1 在 claim 下摘除死目录 → rm 墓碑 → **释放 claim 后才回环 CAS
发布**，claim 释放与 R1 发布之间存在 canonical 缺席窗口；(b) R2 此前 CAS 已失败 → `readOwner` 读
`''` → 判 stale → 复读仍 `''`；(c) R1 的 CAS 发布恰落在 R2 复读与 R2 的摘除 rename 之间 → R2 摘走
R1 **刚发布成功的完整活目录**；(d) 墓碑比对不等 → 回复位失败 → R1 phantom + R3 成功 = 双活。
iteration 3 以三层防线（claim 门 / 证据门槛 / 条件原语）结构关闭，SA2 iteration 2 独立重放确认
phantom 协议内不可达并**确认 claim 门对发布者的封锁是必要条件而非冗余**（备选 5 否决理由成立）。

**SA2 iteration-2 #8 追加识别的 liveness 缺陷（本设计 D6 的直接动因）**：claim 门从「回收臂内的
串行化优化」（旧代码 B11：干净 root 不触 claim）升级为「每次获取同步关键路径上的正确性承载门」
（D1′：发布者也须持门——否则上述 (c)/(d) 窗口重开）。由此，claim 的「活持有者」失活形态——
SIGKILL 遗留 claim 的 pid 被无关进程复用（长生命周期主机上现实存在）、或持有者被冻结（SIGSTOP/
D 状态/永久挂起）——使该 rootDir 上**一切获取**（boot + SIGHUP reload）同步无界静默自旋：不抛错、
不返回、无日志；事件循环被阻塞使 watchdog（B12）与信号处理全部失效；进程 100% CPU 挂死，仅
SIGKILL 可终止。iteration 3 的风险登记（R2「可被接管自愈」/ R4「对 claim 与 owner 同构/不变」/
R5「有界」）三处失实。

放大器（SA6 A1，既有）：① claim 自身「先建空后写」+ 无复验 unlink（B6）；② 镜像 EEXIST 无条件
覆写（仅诊断件）；③ 竞争进程数/CPU 争用放大抢占概率（CI 观测率 ~5%/执行）。

## 4. Owner 要求落实

Issue/PR 评论 REST 读取为空（dispatch 注记、SA6 §2、SA8 各轮头注、SA2 各轮头注六方一致）——无
Owner 评论要求可映射。验收口径 = 派发唯一要求：**PR #276 CI 恢复绿色，不跳过/禁用任何测试**；
迭代 4 派发追加指令：**解决 SA2 iteration-2 #8——claim 门不得造成 stale/reused-PID 或冻结持有者
触发的同步无界静默事件循环自旋；定义可执行的有界/liveness-safe 行为、恢复语义与验收测试；保留
iteration 1 七项 rejection finding 的全部解**；迭代 5 派发追加指令：**解决 SA2 iteration-3 全部
binding findings——修正失实的 E1 误触发守卫、为等待钉位下界（连同既有上界）使「急早起爆」实现
变异无法通过、补占用更替计账重置证据；保留已接受的并发与 liveness 保证（机制本体不许重开）**。

| 来源 | 要求 | 设计落实位置 |
|---|---|---|
| 派发注记（SA6 §2 转述） | CI 绿且 canary 与压力契约保留为契约门禁 | §12（两契约文件原样保留并转绿，DENY LIST 禁改）；§7 D1/D1′/D2/D3/D4 修复本体 |
| 迭代 4 派发指令 | claim 门有界/liveness-safe + 恢复语义 + 可执行验收 + 保留七项既有解 | §7 D6（有界等待 + loud 中止 + 更替重置 + 不夺门）；§9（恢复语义：自动接管 + 人工清除）；§12 E9 可执行验收；§15（iter-1 #1-#7 保留核对） |
| 迭代 5 派发指令 | 修正 E1 误触发守卫失实（#12）；等待下界钉位（急起 claimStuck 不得通过）；更替重置计账证据；#13 时钟方向如实化；保留已接受保证 | §8.1 文案不相交硬约束 + 钉位 regex 同步；§12 E9a②′（下界）+ E9a⑥（不相交）+ **E9d/T7c（更替重置）**；§8.3-10 证据链改写（8 处失实表述清除，见 §15.3）；§13 R8-② 如实改写 + §11 运维句墙钟注记；机制本体（D1/D1′/D2/D3/D4/D6）零改动 |

## 5. 复现和根因承接

| 上游事实 | 证据位置 | 设计响应 |
|---|---|---|
| CI 红：canary L104 `toHaveLength(1)` 得 2（run 34296011254 / job 102292700330） | `task_ci-pr-276_sa6_ci-fail.log`；SA6 §5.1 | §7 D1+D1′ 结构性修复；§12 E1/E2 含 canary 全绿 |
| 本地同形双活 ×2（`ci` round 10 两 worker 同毫秒 acquired、窗口完全重叠；`amb` round 7 collection 764ms ≪ 5s 持有） | `task_ci-pr-276_sa6_red.log` §2/§3 | 同上；压力契约转绿为结构证据 |
| 空窗口机制：`wx` = openat+write 两阶段（strace） | red.log §4 | D1：owner.json 只在私有 staging 经历构建，canonical 名称经原子 rename 一次性携带完整内容 |
| SA2 独立实测 rename 语义五连测 + SA1 本机同形探针逐条一致（node v24.13.0/Linux 本 worktree 同机） | SA2 iteration 1 §2；本设计 §14 | §14 P1-P10 协议假设依据独立成章（#4 义务） |
| SA2 iter-1 #1 残余双活（`''` 证据摘除 + 回复位失败 = phantom） | SA2 §0/§1#1；iteration 2 §7 A2 独立重推确认不可达且 claim 门为必要条件 | D1′ 证据门控阶梯 + claim 门 + §8.3 回复位失败分支完备分析（本修订原样保留） |
| **SA2 iter-2 #8：claim 门上关键路径后 pid 复用/冻结 ⇒ 同步无界静默自旋、watchdog 免疫、干净 root 亦被卡（A6/E-1）；旧代码同 corner 只卡回收者** | SA2 iteration 2 §7 A6 / §8 E-1 / §13 #8；B11/B12 本设计亲证 | **§7 D6**：有界等待（5000ms 连续同内容占用）+ claimStuck loud（唯一新错误面）+ 占用更替重置 + 不夺门；§13 R2/R4/R5 如实改写；§11 运维症状连接句；§12 E9 可执行验收 |
| **SA2 iter-3 #12（binding，= SA8 iter-4 O4/B4′ 采纳并加重）：「E1/canary 兼任 D6 误触发守卫」论证与定稿文案 `held` 子串矛盾（canary L107 / stress L127/L168 为子串匹配——本轮亲证）；「预算过早起爆」（M1）与「更替重置失效」（M2）两类实现变异对全部既有验收面全绿** | SA2 iteration 3 §6.1-§6.4 / §12 #12；§7 D6 正面重放（A11-A16 无反例） | **Option A 落实**：§8.1 claimStuck 文案改 `occupied`（避开 `held`/`unsupported` 子串，要素齐全）+ 钉位 regex 与 §11/§12 引文同步；**T7a②′ 墙钟下界 ≥5000ms + T7a⑥ 文案不相交断言**（§11/§12 E9a——M1 变异确定性转红）；**T7c（=E9d）更替重置确定性用例**（连续换手合计 >5000ms、单段 <5000ms ⇒ 获取必须成功——M2 变异确定性转红）；8 处失实表述清除（§15.3 清单）；§12 增实现期变异自检义务 |
| SA2 iter-3 #13（MINOR）：R8-② 把 suspend 与 `performance.now()` 关系写反（Linux `uv_hrtime`=`CLOCK_MONOTONIC` **不含** suspend——挂起使墙钟变长、单调计量不变，触发只会更晚不会提前） | SA2 iteration 3 §6.4 #13；Node `perf_hooks`/libuv 语义；§14 P10 | R8-② 如实改写（单调计量不含 suspend；墙钟可能长于 5000ms；I3 单调上界不受影响）；§11 运维句同步注明 |
| 触发率随争用上升（空载 0/500+，负载 ~0.8%，CI ~5%） | SA6 §5.3 | 修复不依赖概率：消除窗口本身（§8 状态机 + §8.3 逐场景重放） |
| 排除项（非 PR #276 回归、非 Node 24 特有、非夹具问题、非顺序接管伪阳性） | SA6 §8/§11 | 接受；设计不引入版本/夹具面变化 |
| SA6 §15 开放项：是否引入生产测试钩子 | SA6 §15 | **裁决：不引入**（SA8 F6；SA2 认可；D6 使 #8 形态可无钩子测试，钩子诉求进一步下降） |
| SA2 已核安全面（正面确认，直接采信为约束）：staging 对 `packages/**` 不可见（persistence 只操作 `users/`、`archive/users/` 子树）；`vitest maxWorkers:1` + include `apps/*/test/**/*.test.ts`（本轮亲证）；新测试文件被 `scripts/ci-test-shard.mjs` 磁盘枚举自动收录（本轮亲证 walk 逻辑）；DENY 对 SA6 两契约 + fixture + CI 装置封锁完整 | SA2 各轮 §1 末段；vitest.config.ts L15/L17；scripts/ci-test-shard.mjs L29-50 | 维持这些边界不变（§10/§11） |

## 6. SA8 约束落实

| 决议或义务 | 设计位置 | 处理方式 | 是否需要设计后冲突复查 |
|---|---|---|---|
| F1 / iter-3 G1：无 ADR 管辖根锁（adr 全集 + CONTEXT.md 词族 grep 零命中） | §2 B10 | 不触任何 ADR 冻结面与 CONTEXT.md 域词；D6 沿用同自由面（模块私有常量与错误构造器，不导出） | 否（就该行而言） |
| F2/F3 / iter-3 G2/G3：temp→rename 原子提交模式族正向一致；新名族不碰 ADR-0006 冻结布局与 `.tmp` 规则；packages 不可见 | §7 D1/D1′/D6；§13 R2 | staging/claim-staging/claim-接管墓碑永不作提交态；全部位于 rootDir 顶层 app 层 | 否 |
| F5 / iter-3 G7：文档机制措辞修订属合规文档同步（行为与文档同变更集）；六条安全不变量逐条保持，I0 为加强 | §11 | iteration 4 扩两处：deployment doc 增加 claim 门活性句与症状→处置连接句（SA2 #8 ②，iter-3 G7 已预裁同款扩句不触发新门禁）；AGENTS.md 边界句补「门等待有界」——本轮（iteration 5）仅同步症状句引文与墙钟注记 | 否（就该行而言） |
| iter-3 G8：范围遵从（ALLOW 四项与 SA2 授权落点一一对应） | §11 | **本修订不扩 ALLOW/DENY**——D6 全部落在既有 ALLOW 的 `lifecycle.ts` 行、新测试文件行与两文档行内 | 否（就该行而言） |
| N1/N1′（advisory）：原子发布 + claim 门（现为正确性承载）是否补轻量 ADR | §16 | 维持文档层记录；D6 使 claim 门的失败语义成为运维契约的一部分，N1′ 权重继续上升——仍归 owner/总控裁量，不阻塞 | 否 |
| O1→SA2 #6：deployment doc 补遗留名族清理口径 | §11 | 全名族清单（含 #9 新增 `.reap-claim.reaped-<uuid>`）+ 人工清理口径 + claim 卡死症状→处置句 | 否 |
| O2（沿）：`main.ts` L11 头注陈旧（先在缺陷） | §11 DENY | 维持 DENY（语义零变化）；注释勘误留实施轮可选 | 否 |
| O3/B3′（沿）：R7「该假设句已在文档中」不可作锚点 | §13 R7 | 处置改写为可定位口径：R7 维持假设，**不引述文档在场性**；若实施轮需要显式混版本边界句走 §11 扩句 | 否 |
| **iter-3 收窄重触发条款**（fsync / packages 与冻结布局 / 公共导出与生产钩子 / CONTEXT.md 域词 / ALLOW-DENY 扩界 → 回炉） | §7 D6/§16 | **逐项未触**：无 fsync（R6 维持）；packages 零触碰；无新增导出/钩子（§8.1）；无域词；ALLOW/DENY 面不变。iteration 4 据此对 D6 失败语义面保守提交复查——**已由 SA8 iteration 4 报告闭环（clear，H1-H8）** | 否（iter-4 已闭环） |
| **SA8 iter-4 H1-H8（clear）**：claimStuck 新错误输出自由面（H1）；不夺门方向收紧（H2）；模块私有常量/import 非公共面（H3）；#9 墓碑名不触 ADR-0006 冻结布局与 packages 可见性（H4）；claim-blocked 态 + I3 同向收紧（H5）；§11 两文档扩句合规同步（H6）；重触发条款逐项未触（H7）；E9 验收面与 CI 装置（H8） | §7 D6/§8.1/§11/§12 | 全部采纳为既有裁决基础；本轮修订（文案措辞 + 测试断言 + 引文同步）均在 H1「自由面」与 H8「ALLOW 新测试文件」的预裁范围内 | 否 |
| **SA8 iter-4 O4 / B4′（移交 SA2 裁决，已由 SA2 iter-3 #12 采纳并加重）**：「E1 兼任误触发守卫」失实；SA4/SA7 不得以 E1 转红检测误触发；若改文案须同步 T7a regex 与 §8.1 | §8.1/§8.3-10/§12 E9 | 本修订按 B4′ 预裁路径 Option A 落实：文案避开 `held`/`unsupported` 子串 + regex 同步（§8.1/§11/§12）+ T7a②′/⑥ + T7c 确定性守卫——E1 转红从「唯一误触发证据」降级为「概率性兜底」，与 B4′「不得依赖 E1 转红」的边界一致 | 否（B4′ 预裁的修订路径，无需回炉） |
| SA8 iter-4 N1″（轻量 ADR advisory）/ O2（main.ts L11 头注先在缺陷） | §16/§11 DENY | N1″ 维持归 owner/总控裁量（权重继续上升）；O2 注释勘误留实施轮可选 | 否 |

## 7. 设计决策与主要备选方案

### D1（iteration 1 主体，SA2 三轮认可保留）：获取臂 = staging 完整构建 + 原子 rename 发布

不变量 I1（canonical 出现即完整）/I2（成功出口唯一绑定 rename）见 §0。

### D1′（iteration 3 核心，SA2 iteration 2 独立重放确认结构成立；iteration 4 内嵌 D6 与 MINOR 修正，本轮未再动）：claim 门 + 证据门控争用阶梯

**机制总览**（伪代码，真实符号；省略号 = 现有代码原样；errno 分类见 D2/D3/#11）：

```text
// 模块私有常量（§8.1；全部不导出）：
const ROOT_LOCK_STAGING_PREFIX            = '.nomicore-lock.acquire-';                 // 目录
const ROOT_LOCK_REAP_CLAIM_FILE_NAME      = '.nomicore-lock.reap-claim';               // 路径沿用
const ROOT_LOCK_REAP_CLAIM_STAGING_PREFIX = '.nomicore-lock.reap-claim.staging-';      // 文件
const ROOT_LOCK_REAP_CLAIM_TOMB_PREFIX    = '.nomicore-lock.reap-claim.reaped-';       // #9 立法（文件，篡改形态下可能为目录）
const ROOT_LOCK_CLAIM_WAIT_LIMIT_MS       = 5_000;                                     // D6

export function acquireRootLock(rootDir: string, instanceId: string): RootLockHandle {
  const payload  = JSON.stringify({ instanceId, pid: process.pid, nonce: randomUUID() });
  const canonical = lockDirectoryPath(rootDir);
  const claimPath = join(rootDir, ROOT_LOCK_REAP_CLAIM_FILE_NAME);                  // 路径不变

  mkdirSync(rootDir, { recursive: true });            // L114-120 原样（EACCES/EPERM → loudUnwritable）

  // NEW ①：私有 staging 一次性建好（CAS 发布件 + claim 发布件）；此路径无任何竞争者观察/判定。
  const staging = join(rootDir, `${ROOT_LOCK_STAGING_PREFIX}${randomUUID()}`);
  const claimStaging = join(rootDir, `${ROOT_LOCK_REAP_CLAIM_STAGING_PREFIX}${randomUUID()}`);
  let published = false;
  try {
    try { mkdirSync(staging); } catch (error) { /* EACCES/EPERM → loudUnwritable；其余 rethrow */ }
    writeFileSync(ownerPath(staging), payload, { flag: 'wx' });   // 私有路径：wx 恒新鲜
    writeFileSync(claimStaging, payload, { flag: 'wx' });         // 完整内容先行；wx 卫生位（SA2 O-5）

    // D6：claim 门计账（每次调用私有；performance.now() 单调时钟，§14 P10）
    let deniedClaimRaw: string | undefined;   // 当前连续被拒的 claim 占用内容（含 nonce = 占用身份）
    let deniedSince = 0;
    const claimWaitReset = () => { deniedClaimRaw = undefined; };
    const claimDenied = (claimRaw: string) => {
      if (claimRaw !== deniedClaimRaw) { deniedClaimRaw = claimRaw; deniedSince = performance.now(); return; }
      if (performance.now() - deniedSince >= ROOT_LOCK_CLAIM_WAIT_LIMIT_MS)
        throw claimStuckError(claimRaw, ROOT_LOCK_CLAIM_WAIT_LIMIT_MS);   // I3：有界 loud，不夺门
    };

    for (;;) {
      // NEW ②：claim 门——发布者与回收者共用。活持有 ⇒ 有界自旋（D6）；判活/接管在子协议内。
      if (!takeReapClaim(claimPath, claimStaging, instanceId,
                         { claimDenied, claimWaitReset })) continue;
      claimWaitReset();
      try {
        // NEW ③：获取 = 原子 CAS（唯一成功出口）。
        try {
          renameSync(staging, canonical);
          published = true;
        } catch (error) {
          const errno = (error as NodeJS.ErrnoException).code;
          if (errno === 'EACCES' || errno === 'EPERM') {
            if (!pathExists(canonical)) throw loudUnwritable(errno);   // D3：只读探测分类
          } else if (errno !== 'EEXIST' && errno !== 'ENOTEMPTY' && errno !== 'ENOTDIR') {
            throw error;                                               // 含 ENOENT：honest（与旧 mkdir 臂一致）
          }                                                            // EEXIST/ENOTEMPTY/ENOTDIR/EPERM(在场) → 落阶梯
        }
        if (published) {
          // claim 门内：无竞争者可在该窗口占据 canonical → 清理只会删自己的目录。
          try { publishLegacyMirror(rootDir, payload); }
          catch (error) { rmSync(canonical, { recursive: true, force: true }); throw error; }   // 唯一例外（#10）
          break;                                                       // ← 唯一成功出口
        }

        // —— NEW ④：证据门控阶梯（全部步骤在 claim 门内；各步 errno 契约 = #11）——
        const raw = readOwner(canonical);                    // '' ⇐ 缺席 | 非目录 | 空/不可读
        const held = heldError(instanceId, raw);
        if (held !== undefined) throw held;                  // 非空活 payload → loud（文案不变）

        if (raw !== '') {                                    // 主路径：非空死 payload（nonce 唯一）
          // 既有守卫链 L163-188 原样内联：复读 claimedRaw === raw → rename 摘除到 .reap-<uuid>
          // → 墓碑比对 movedRaw !== raw → 回复位（失败分支完备分析见 §8.3）→ rm 墓碑。
          …; continue;
        }

        switch (classifyCanonical(canonical)) {              // lstatSync/readdirSync，零副作用
          case 'absent':           continue;                 // 缺席证据永不入 reap 臂 → 回环 CAS
          case 'empty-dir':        /* rmdirSync(canonical)：ENOENT/ENOTEMPTY → continue 复检；
                                     EACCES/EPERM → loudUnwritable（文案不变）；其余 rethrow → */ continue;
          case 'stray-nondir':     /* renameSync(canonical, tombstone)：文件/符号链接摘除（单胜者）；
                                     rmSync(tombstone, force) → errno 契约同上 → */ continue;
          case 'dir-empty-owner':  /* L2/杂散清障（D4，errno 契约同上）→ */ continue;
        }
      } finally {
        releaseReapClaim(claimPath, payload);                // 既有内容校验 unlink（L190-194 形态）
      }
    }
  } finally {
    // NEW ⑤：任何出口清掉自己的两个 staging，零残留（发布成功后 staging 目录已被 rename 消费）。
    try { rmSync(staging, { recursive: true, force: true }); } catch { /* 尽力而为 */ }
    try { unlinkSync(claimStaging); } catch { /* 尽力而为 */ }
  }
  // release() L198-232 原样。
}

// claim 子协议（路径与内容语义不变；创建/接管原子化——修复 B6；D6 计账内嵌）：
takeReapClaim(claimPath, claimStaging, instanceId, hooks):
  try { linkSync(claimStaging, claimPath); hooks.claimWaitReset(); return true; }   // link(2)：存在即 EEXIST，原子、内容完整
  catch (EEXIST) {
    claimRaw = read(claimPath);                              // 恒为完整内容（创建原子化后无空窗口）
    if (heldError(instanceId, claimRaw) !== undefined) { hooks.claimDenied(claimRaw); return false; }
                                                             // 活持有者 → D6 有界自旋（内容更替自动重置）
    // 死持有者接管 = rename-detach 单胜者 + 内容复核（替代 L156 无复验 unlink——A1① 修复）：
    const claimTomb = join(rootDir, `${ROOT_LOCK_REAP_CLAIM_TOMB_PREFIX}${randomUUID()}`);   // #9
    try { renameSync(claimPath, claimTomb); }
    catch (ENOENT) { hooks.claimWaitReset(); return false; } // 他者已接管（占用更替）→ 重试
    tombRaw = read(claimTomb);
    if (heldError(instanceId, tombRaw) !== undefined) {      // 竞速中拿到活 claim（误判保护）
      try { renameSync(claimTomb, claimPath); } catch { /* 路径已被新 claim 占用 → 弃置 */ }
      hooks.claimWaitReset(); return false;
    }
    try { unlinkSync(claimTomb); }                           // 确认死内容 → 删接管墓碑
    catch { /* 弃置（SA2 O-4）：协议外形态（如篡改为目录 → EISDIR）不作 loud——私有唯一名、
              无人读取、不阻塞协议；属 §11 运维名族清理口径 */ }
    hooks.claimWaitReset(); return false;                    // 下轮循环重试挂名（单胜者）
  }
  catch (EACCES/EPERM) → loudUnwritable；其余 rethrow
```

**三层防线论证（为什么任意交错下无 phantom——D6 不改变任何一条）**：

1. **防线一（claim 门）**：CAS 发布者与回收者都须持 claim。claim 挂名原子（link(2) 无空窗口）、
   接管单胜者（rename-detach）、内容含 pid 判活可靠（死判不误活；pid 复用只朝「误活」的安全方向）。
   ⇒ **发布事件不可能落在任何回收者的 detach→restore / 清障窗口内**。D6 只改变**等待者**在
   「门被活占」时的退出方式（无界自旋 → 有界 loud 中止），**从不移除或绕过活持有者的门**——门的
   排他性与 iteration 3 完全同构（§8.3-9）。
2. **防线二（证据门槛）**：目录 rename 摘除仅凭**非空死 payload 双读**（nonce UUID 唯一，内容证据
   即身份证据）；`''` 证据永不触发目录摘除，只分派到缺席-continue / rmdir / 非目录摘除 / claim 门内
   清障。
3. **防线三（原语条件性）**：即使瞬态双回收者（接管竞速残余，§8.3-6），destructive 操作全部是
   单胜者 rename、名称条件 unlink、空目录条件 rmdir——不可能删除或替换已发布的非空 canonical。

**主路径墓碑比对恒通过**（iteration 3 论证原样）：claim 门冻结 canonical 的全部协议内变更者；
复读与摘除之间 canonical 只能保持原样；`movedRaw !== raw` 与回复位失败分支协议内不可达，保留为
协议外（混版本/篡改）loud 防御出口（§8.3-3/-7）。

### D2（落实 SA2 iter-1 #2）：CAS errno 集并入 `ENOTDIR`，杂散文件/符号链接恢复接管 parity

SA1 本机探针 + SA2 独立实测一致（§14）：`renameSync(staging 目录, canonical)` 在 canonical 为普通
文件或指向目录的符号链接时 → **ENOTDIR**。旧代码（mkdir 臂）对该形态是接管恢复；iteration 2 修订
把 `ENOTDIR` 并入争用 errno 集合转入阶梯，阶梯 `stray-nondir` 分支 rename 摘除**非目录**名 → rm
墓碑 → 回环 CAS 发布。**恢复 parity：杂散文件/符号链接 at canonical → 接管成功，owner.json/镜像
= 获取者**（§12 E8 钉位）。无新增裸错误输出。本修订原样保留。

### D3（落实 SA2 iter-1 #3）：EPERM 只读探测分类，R1 如实能力矩阵

CAS `EPERM` 先用只读 `lstatSync` 探测 canonical：**在场（任意形态）⇒ 争用 → 转阶梯**；**缺席 ⇒
真 unwritable/不兼容 → `loudUnwritable(errno)`**（文案不变）。探测无副作用：误分类只影响归因与
重试，不影响正确性。§13 R1 能力矩阵：Linux（CI）与 macOS 一等；Windows 经 libuv 映射，CAS 争用
正确分类、回收不保证成功（句柄滞留 EPERM/EBUSY → loud）、非一等目标。本修订原样保留。

### D4（落实 SA2 iter-1 #1 末条 + #10/#11（iteration 4 落实，本轮保留））：升级遗留清障原语与显式 errno 契约

形态命名（SA2 O-1 采纳）：**L1** = 空 `.nomicore-lock/` 目录（预修复 mkdir-only 崩溃遗留）；
**L2** = `{owner.json: ""}`（旧缺陷在生产 root 留下的精确形态）——原 iteration 3 文本的「E1/E2
形态名」更名，避免与 §12 验收 ID E1-E9 混淆；§12 验收 ID 不变。

- **L1（空目录）**：`rmdirSync(canonical)`——空目录专有原语：已发布 canonical 恒非空（I1），
  rmdir 结构上不可能删除它；发布恰落在 rmdir 前 → ENOTEMPTY → continue 复检（读到活 payload →
  loud）。无需读证据。
- **L2（`{owner.json: ""}`）**：claim 门内复读 `''` 后 `unlinkSync(ownerPath)` → `rmdirSync(canonical)`。
  交错安全（iteration 3 论证原样）：L2 目录在 unlink 之前非空 → 协议内发布者（claim 门）不可能在
  「分类 → unlink」窗口内发布；unlink 后目录转空，发布可能落在「unlink → rmdir」窗口 → rmdir
  ENOTEMPTY → continue 复检 → 活 → loud。单回收者结构安全；多回收者由 claim 门排除（§8.3-4）。
- **杂散条目**（目录内非 owner.json 条目——篡改/第三方形态）：claim 门内逐项就地清障：非目录条目
  `unlinkSync`；子目录 `rmSync(entry, {recursive, force})` **单遍**（不传 `maxRetries>0`，§8.3-6
  注）；终步 `rmdirSync(canonical)`。终止性：无篡改时每轮至少移除一个稳定条目；活跃篡改下无界与
  旧代码 parity（out of scope）。
- **（#11）清障 errno 契约（规范性，适用于上述每个 destructive 步及 D1′ 阶梯全部 catch）**：
  `ENOENT`（条目已被他者清理 = 进展）与 `ENOTEMPTY`（有新占据者）⇒ **continue 复检**；
  `EACCES`/`EPERM` ⇒ **既有 `loudUnwritable` 映射（文案不变）**；**其余 errno ⇒ rethrow（honest）**。
  禁止实现为裸 catch——EACCES 下 rmdir/unlink 永久失败而 continue 永久回环 = 新的静默无界自旋
  （SA2 #11 正是此缺口；旧代码 reap 链 L174 有 loud 映射，本契约为该形态的完备重申）。
- **（#10）canonical 删除原语的作用域限定**：**清障阶梯中** canonical 永不承受 `rmSync(recursive)`
  ——目录级删除恒为 rmdir（空目录条件）；**唯一例外**是发布失败的 claim 门内自有目录自清理
  （`rmSync(canonical, {recursive, force})`，§7 NEW③ / §8.2 publishing 行）——该目录是本 handle
  刚经 rename 发布的自有件，门内无他者可占据，删除不可能落到他人目录。

### D5（落实 SA2 iter-1 #6 + #9（iteration 4 落实，本轮保留））：文档遗留名族运维口径

见 §11 deployment doc 行：rootDir 顶层瞬态遗留名族全清单（含 #9 新立法的
`.nomicore-lock.reap-claim.reaped-<uuid>`）+ 人工清理口径 + claim 卡死症状→处置连接句（#8 ②）。

### D6（iteration 4 新增，落实 SA2 iteration-2 #8 + 迭代 4 派发指令；SA2 iteration-3 重放机制本体无反例、本轮零改动，仅修订其验收钉位与文案措辞——#12）：claim 门活性预算——有界等待 + loud 中止 + 占用更替重置 + 绝不夺门

**问题**（SA2 A6/E-1，B11/B12 亲证）：D1′ 把 claim 门放上**每次获取的同步关键路径**（这是
iteration-1 #1 修复的必要条件——备选 5/6 否决维持）。claim 的活持有者可能实际已失活：
(i) SIGKILL 遗留 claim 的 pid 被无关进程复用（`isPidAlive` L49-57 只查 pid 存活——死判不误活，
  复用必误活，安全方向但永不自愈）；(ii) 持有者被冻结（SIGSTOP/D 状态/永久挂起——pid 存活、
  永不推进）。两种形态在判活上同形。若无活性预算，`takeReapClaim → return false → continue`
  为同步无限自旋：不抛错、不返回、无日志；`acquireRootLock` 是同步函数，自旋独占事件循环，
  `STOP_WATCHDOG_MS` watchdog（setTimeout 宏任务）与 SIGTERM/SIGINT 处理器均无法触发；boot
  （main.ts L193）与 SIGHUP reload（L132）双双挂死，进程 100% CPU，仅 SIGKILL 可终止——且暴露面
  较旧代码**扩大**（旧代码干净 root 获取从不触 claim，B11）。

**机制**（伪代码已内嵌 D1′）：

1. **计账单位 = claim 占用**：以 claim 文件内容（含 nonce）为占用身份。连续两次判活拒绝读到
   **同一内容** ⇒ 同一占用持续；读到**不同内容** ⇒ 发生了合法竞争换手（新持有者挂上了自己的
   claim）⇒ 重置计账。claim 被本方成功挂名 / 被观察到更替（接管竞速 ENOENT）/ 回复位/弃置路径
   ⇒ 重置计账。
2. **有界等待**：同一占用连续被判「活持有」达 `ROOT_LOCK_CLAIM_WAIT_LIMIT_MS = 5_000`（单调时钟
   `performance.now()` 测量，§14 P10）⇒ 抛出 `claimStuckError(claimRaw, limit)`——**新的唯一公共
   可观察错误输出**（§8.1 定稿文案）。抛点在门**外**（本方不持 claim），外层 NEW⑤ finally 清理
   本方 staging，零残留。
3. **绝不夺门**：超时中止**不删除、不移动、不覆盖**他人的 claim，**不触碰 canonical**。理由
  （正确性优先）：一个 SIGSTOP 的合法回收者若在恢复后继续其 detach→restore 阶梯，而本方已夺门
   发布，正是 SA2 iteration-2 §7 A2 独立重推证明必须由 claim 门关闭的 phantom 窗口 (c)/(d)。
   活性预算只约束**等待者**，不削弱**持有者互斥**（I0 完整保留）。
4. **预算值依据**：合法单次占用的门内工作量 = 一趟阶梯（主路径回收链 6 个 fs 系统调用；L1/L2
   清障 + readdir + 逐条目操作）——实测毫秒级（SA6 §12：全 6 轮压力 ≈6-7s **含** 12×6 进程
   fork；单轮门内竞速 ≪1s）。5000ms ≈ 三个数量级裕度；且合法多竞争换手由更替重置兜底——
   误触发需要**单一占用**持续 5s 不换手，协议内不存在该形态（R8 如实登记协议外残余）。
   5000ms ≪ `STOP_WATCHDOG_MS = 60_000`（main.ts L30）：loud 失败远早于任何外层 watchdog 关注
   点（同步自旋期间 watchdog 本就无法触发——本预算是该窗口内唯一的活性守卫）。
5. **CPU 形态**：等待期内仍为紧密轮询（单趟快操作，沿既有等待形态——§13 R5 已按 D6 如实改写）；
   燃烧上界 = 等待上界（≤ 5000ms/次连续占用）。同步退避（`Atomics.wait`）为显式否决项（备选 12）。

**状态机影响**：claiming 态新增终止出口 `claim-blocked`（loud throw，§8.2）；I3 新增。

**验收**（iteration 5 修订，#12）：§12 E9（T7a/T7b/T7c 确定性可执行——该形态从「不可无钩子测试的
挂死」变为「确定性 loud 失败 + 确定性恢复 + 确定性更替重置证据」）。**D6 误触发的证据链（改写后）**
= **确定性守卫**：T7a②′ 墙钟下界（同一 `performance.now` 包夹，`elapsed ≥ 5000ms`——「首拒即抛/
量纲错误/基线续量合并」变异在此转红）+ T7a⑥ 文案不相交断言（claimStuck 文案不匹配
`/held|unsupported/`）+ T7c 更替重置用例（连续换手合计 >5000ms、单段 <5000ms ⇒ 获取必须成功——
「重置失效」变异在此转红）；**概率性兜底** = 两冻结契约的败者子串 regex（canary L107 / stress
L127/L168）——仅在 §8.1 文案避开 `held`/`unsupported` 子串（Option A）后才**真实敏感**（误发时
败者消息不匹配即红），不得作为唯一或主要误触发证据（SA8 B4′）。

### 被否决的备选方案（含理由；1-7 沿 iteration 3，8-12 iteration 4 新增，本轮全部维持）

1. **仅改 owner.json 写失败臂 / 发布后复读校验 / claim 升级互斥量**：治标、TOCTOU 概率缩窄、
   claim 自身空窗未修——否决（沿 iteration 1）。
2. **生产测试钩子**：SA6 §15 / SA8 F6 / SA2 三方一致否决；D6 使 #8 形态可无钩子测试，诉求进一步
   下降——维持否决。
3. **flock / 单文件锁重设计**：磁盘契约与跨平台语义巨变，远超最小安全修复边界——否决。
4. **哨兵文件方案**（canonical 内加第二份完整内容文件）：改变 canonical 磁盘契约、对主路径
   detach-restore 窗口无效、被 D1′ 三层防线以更低代价覆盖——否决。
5. **无 claim 门的纯证据门槛方案**：SA2 iteration 2 独立重推确认残余微窗（R 摘走 R′ 刚发布的活
   目录 + 回复位被抢占）无法关闭——claim 门是必要条件——否决（维持）。
6. **`renameat2(RENAME_NOREPLACE/EXCHANGE)`**：Linux 专有、Node 未暴露、不可移植——否决。
7. **恢复失败分支无限重试**：canonical 可能被活 owner 长期占据 → 无界自旋；保留 loud `movedHeld`
   诚实退出——否决重试。
8. **（新）仅文档化自旋风险（SA2 #8 字面最低要求：改写 R2/R4/R5 + 运维句）**：风险登记如实化是
   必要非充分——派发迭代 4 指令明令「must not cause synchronous unbounded silent event-loop
   spin」；仅文档化使 boot/reload 在该 corner 仍 100% CPU 挂死、watchdog 免疫——否决（但其中
   的文档/风险修订部分被 D6 吸收为 §11/§13 修订）。
9. **（新）超时后自动夺门（删除/改写活占 claim）**：直接重启 SA2 A2 证明必须关闭的 phantom 窗口
  （冻结回收者恢复后与本方发布交错）——以可用性换取正确性回归，方向错误；且无法把「pid 复用」
   与「合法慢持有者」可靠区分（`isPidAlive` 只证 pid 存活）——否决。正确的恢复主权在运维
  （核实 pid 后删 claim）与时间（持有者真死后自动接管，T5 已钉位）。
10. **（新）attempt-count 预算（无时钟）**：单趟成本随 fs/负载漂移巨大，慢 CI 下合法竞速会误触
    发上限；单调时钟 + 占用更替重置才是对「同一占用持续过久」的诚实度量——否决。
11. **（新）`Date.now()` 计时**：墙钟可被 NTP 回拨/前跳——回拨拉长等待（安全方向）、前跳造成
    误触发（false positive）；`performance.now()` 单调（§14 P10）——否决 `Date.now()`。
12. **（新）`Atomics.wait` 同步退避 / 异步化 `acquireRootLock`**：前者引入新原语与主线程语义
    论证，收益仅是等待期内少烧 CPU（燃烧已被预算上界约束）；后者改公共签名与全部调用方/夹具
    契约——均否决（前者留作 follow-up 优化，非本轮义务）。

## 8. 接口、状态机和数据流

### 8.1 接口

- **签名/导出零变化**：`acquireRootLock(rootDir: string, instanceId: string): RootLockHandle`、
  `RootLockHandle.release()`、`ROOT_LOCK_FILE_NAME` 常量、`src/index.ts` L70 导出面
  （`acquireRootLock, createStdoutEventSink, ROOT_LOCK_FILE_NAME, STABLE_OP_ERROR_CODES` +
  类型 `EventSink, RootLockHandle`）——本轮亲证不变。
- **既有错误文案零变化**：`held by the same instance…` / `shared file persistence root is
  unsupported…` / `cannot write .nomicore-lock.json in rootDir (…)` 三族逐字保留（canary/压力契约
  regex 钉位不受影响——三契约均不构造活占 claim 形态，本轮逐用例走查确认）。
- **新增唯一公共可观察输出（D6）**：`claimStuckError(raw, waitedMs)` 构造的 plain `Error`（与既有
  错误同为 `new Error(...)`，无 code 字段，测试以 regex 钉位）。**定稿文案（实现须逐字使用；
  iteration 5 起 #12 Option A：不得含子串 `held` 或 `unsupported`）**：

  ```text
  root lock reclaim claim .nomicore-lock.reap-claim is still occupied by a live pid ({instanceId: <JSON>, pid: <JSON>}) after 5000ms without turnover: the holder is frozen or its pid was reused — verify that pid, then remove the claim file once you are certain it is stale (pid reuse caveat: see docs/integration/hub-peer-deployment.md)
  ```

  （`{instanceId, pid}` 序列化格式与 `heldError` 的 `owner` 串完全一致（lifecycle.ts L65-74，`owner`
  串构造 L68：`{instanceId: ${JSON.stringify(…)}, pid: ${JSON.stringify(…)}}`）；`5000ms` = 常量值内插；
  钉位 regex：`/reclaim claim .* occupied by a live pid .*\(pid reuse caveat/`——**本轮已对定稿文案
  逐字符验证可匹配**；注意末段须锚 `\(pid reuse caveat`（文案中 caveat 紧随左括号、前面无空格），
  iteration 4 的 `… .* pid reuse caveat/` 形式（含 SA2 #12 A1 示例）因该空格**永不匹配**，属本轮
  修正的隐性缺陷，实现不得「改回」。）
  **文案不相交硬约束（#12 A1，规范性）**：该文案**不得包含子串 `held` 或 `unsupported`**——两冻结
  契约的败者断言为子串匹配 `/held|unsupported/`（canary L107、stress L127/L168，本轮亲证），文案与
  该 regex 相交会使「D6 误触发 ⇒ 败者消息失配 ⇒ 契约转红」的概率性兜底失效（iteration 4 文案
  「is still **held** by a live pid」正是该缺陷，SA2 #12/SA8 O4 亲证）。该约束本身由 **T7a⑥**
  `expect(message).not.toMatch(/held|unsupported/)` 钉位为被测契约——未来把 `held`/`unsupported`
  字样带回文案的漂移在 T7a 转红。`occupied` 措辞保持全部既有要素：claim 名、持有者
  `{instanceId, pid}`、上限、处置指引、pid-reuse-caveat。
- **新增模块私有常量（不导出）**：`ROOT_LOCK_STAGING_PREFIX = '.nomicore-lock.acquire-'`、
  `ROOT_LOCK_REAP_CLAIM_FILE_NAME = '.nomicore-lock.reap-claim'`（路径沿用）、
  `ROOT_LOCK_REAP_CLAIM_STAGING_PREFIX = '.nomicore-lock.reap-claim.staging-'`、
  `ROOT_LOCK_REAP_CLAIM_TOMB_PREFIX = '.nomicore-lock.reap-claim.reaped-'`（#9）、
  `ROOT_LOCK_CLAIM_WAIT_LIMIT_MS = 5_000`（D6）。新增模块私有 import：
  `import { performance } from 'node:perf_hooks'`（D6 单调时钟）。
- **磁盘契约零变化**：owner.json / 镜像字段与路径零变化；canonical 目录内容零新增条目（备选 4
  否决维持）；rootDir 顶层瞬态名族全清单见 §13 R2（含 #9 新名）。

### 8.2 获取状态机（修复后）

| 状态 | 触发 | 迁移 | 禁止态（须不出现） |
|---|---|---|---|
| init | 调用 | mkdir rootDir（可写性前置，不变） | — |
| building | rootDir 就绪 | mkdir staging + wx 写 owner.json + wx 写 claim-staging（全私有路径） | staging 名冲突（UUID）；内容不完整即被发布 |
| **claiming** | building 完成 | link 挂名：成功 ⇒ cas（计账重置）；EEXIST+活 ⇒ **有界自旋 continue——同内容占用 ≥ 5000ms ⇒ `claim-blocked` loud（D6/I3）；内容更替/缺席 ⇒ 计账重置后继续**；EEXIST+死 ⇒ rename-detach 接管（单胜者+内容复核，墓碑名 = `.reap-claim.reaped-<uuid>`）后重试；EACCES/EPERM ⇒ loud | 空内容 claim 被观察到（link 原子性排除）；活 claim 被接管/误删/夺门（D6 禁止）；无界等待（I3） |
| **claim-blocked（新，终止态）** | 同内容活占 claim 连续 ≥ 5000ms | throw `claimStuckError`（文案 §8.1）；外层 finally 清本方 staging；**claim 与 canonical 均不动** | 删除/移动他人 claim；触碰 canonical；静默（必须 loud） |
| cas | claim 到手 | `rename(staging→canonical)`：成功 ⇒ publishing；EEXIST/ENOTEMPTY/ENOTDIR ⇒ inspecting；EPERM ⇒ 探测：在场 ⇒ inspecting / 缺席 ⇒ loud；ENOENT/其他 ⇒ honest throw（finally 清 staging） | 成功出口出现在 rename 失败之后 |
| inspecting | CAS 争用 | readOwner：非空活 pid ⇒ loud throw（held/unsupported）；非空死 ⇒ reclaiming；`''` ⇒ classifying | 对活 owner 的 canonical 执行摘除/清障 |
| **classifying** | `''` 证据 | absent ⇒ cas（回环）；empty-dir ⇒ clearing-l1；stray-nondir ⇒ detaching-stray；dir-empty-owner ⇒ clearing-l2 | `''` 证据触发目录 rename 摘除 |
| reclaiming | 非空死双读 | 复读守卫 → rename 摘除 → 墓碑比对 → rm 墓碑 → cas（原 L163-188 守卫链，claim 门内） | 摘除非双读内容；比对不等未尝试回复位 |
| **clearing-l1** | L1 空目录 | rmdir → cas；errno 契约 = #11（ENOENT/ENOTEMPTY → 复检；EACCES/EPERM → loudUnwritable；其余 rethrow） | 删除已发布非空目录（rmdir 语义排除）；裸 catch |
| **detaching-stray** | 杂散文件/符号链接 | rename 摘除非目录名 → rm 墓碑（errno 契约同上）→ cas | 摘除目录型 canonical |
| **clearing-l2** | L2/杂散条目 | unlink 空 owner.json（→rmdir）或逐项清障（子目录单遍 rmSync）→ cas；errno 契约同上；ENOENT/ENOTEMPTY → 复检 | unlink 落在活 owner.json 上（claim 门排除）；**清障阶梯中** canonical 承受 rmSync-recursive（#10：唯一例外 = 发布失败自清理） |
| publishing | CAS 胜（claim 门内） | publishLegacyMirror；失败 ⇒ rm 自己的 canonical（唯一例外，#10）+ rethrow loud | 半发布状态存活；清理删到他人目录 |
| owned | 镜像发布完成 + claim 已释放 + staging 已清 | `break` 返回 handle | 第二个 owned（I0/I1/I2 排除） |
| released | `release()` | 原样：rename 摘走 + payload 比对 + 删除；幂等 | 迟到 release 删后继者目录（原守护保留） |

### 8.3 关键竞态重放（修复后逐条完备核对——场景 1-8 沿 iteration 3 结论原样保留，场景 9-10 为 D6 新增）

1. **旧 S3/S4（回收者摘走获取者活目录）**：I1 使 canonical 从无空 owner 状态 → 回收者读到完整活
   payload → loud 拒绝。成功唯一出口是 rename（I2）。
2. **SA2 #1 场景 (a)-(d)（`''` 证据 + 回复位失败 = phantom）**：缺席证据 ⇒ continue 回环 CAS 永不
   摘除；在场 `''` 只能是 L1/L2/杂散形态 ⇒ 条件性原语；发布事件与回收窗口被 claim 门结构互斥 ⇒
   phantom 协议内不可达（SA2 iteration 2 独立重推确认）。
3. **回复位失败分支完备分析**：枚举 canonical 在 detach→restore 窗口内的可能占据者——协议内
   CAS 发布者/他回收者须持 claim（本回收者持门，不可能）；`release()` 回复位不持门但携完整 payload
   （其 pid 守护目录，成为下一轮正常输入，墓碑比对在回复位之前完成）；混版本/篡改 = 协议外 loud
   防御出口（`movedHeld`，绝不静默降级）。
4. **L2 清障交错完备重放**：无 claim 反例（R unlink → W 发布 → R' unlink 活 owner → rmdir 删活
   目录 = phantom）证明清障安全依赖回收者互斥 ⇒ 清障全程持 claim + 终步 rmdir 空目录条件独立
   兜底（ENOTEMPTY → 复检 → 活 → loud）。
5. **迟到 release vs 回收者/发布者**：回复位目标非空 → ENOTEMPTY 安全失败保留证据；目标空/缺席 →
   落下完整 payload 目录成为正常输入。两方向均无无主/双主状态。
6. **claim 接管竞速残余（瞬态双回收者）**：误接管即回复位；无门回收者的 destructive 操作均为
   单胜者 rename / 自清单 unlink / 空目录条件 rmdir——发布者依旧被「某个」持门者挡住。子目录
   清障单遍 rmSync（重遍会重读目录、可能纳入竞速新内容——故禁止 `maxRetries>0`）。
7. **Windows/EPERM 交错**：D3 探测只影响分类；后续按真实 errno 走既有映射。
8. **混版本双向 hazard（R7）**：§13 R7 双向登记；维持单 rootDir 单二进制假设。
9. **（新）claim 卡死形态（SA2 A6 = #8 主体）——reused-pid / 冻结持有者**：初始态 = rootDir 存在
   遗留 `.nomicore-lock.reap-claim`，其 payload pid 被无关活进程复用（或持有者被冻结）。期望 =
   可观察的失败或恢复。**D6 行为**：任何获取（boot / SIGHUP reload）在 ≤ 5000ms（同内容占用）内
   抛 `claimStuckError`（含 claim 名、持有者 `{instanceId, pid}`、上限、处置指引）→ 调用方通用
   catch（B8）→ stderr + `exit(1)`（boot）或 `failBoot`（reload，旧实例已停、监督器重启兜底）。
   事件循环阻塞 ≤ 5000ms——watchdog/SIGTERM 语义不受新增影响（它们本就不覆盖同步段；预算使同步
   段自终结）。**claim 与 canonical 零改动**——若持有者实为冻结的合法回收者，其恢复后独占门完成
   阶梯，无双活引入；若为复用 pid（原持有者已死），其「活」是幻象，任何后来者同样被拒，直至
   运维按 §11 口径清除。**恢复语义**：(i) 自动——真死 pid（无复用）⇒ 下一获取走接管路径
   （T5 钉位）；(ii) 人工——核实 pid 非活跃回收者且 root 无进程使用后删 claim ⇒ 下一获取成功
   （T7b 钉位）。
10. **（新）预算 vs 合法竞速（无误触发分析；iteration 5 证据链改写，#12 A4）**：合法竞速
    （canary/压力契约 12 竞争者、T6 并发遗留回收）的等待呈现为**多次占用更替**（每持有者一趟
    毫秒级阶梯后换手或发布）——更替即重置计账，累计等待不触发预算。单一占用持续 ≥5000ms 需要：
    门内阶梯工作量放大三个数量级（协议外篡改规模的杂散子树，R8 登记），或持有者失活（场景 9，
    正是预算的目标形态）。**该核心性质（更替 ⇒ 计账重置）由 T7c（=E9d）确定性钉位**：外部活
    pid 持有者连续两次占用更替（nonce A ≈2600ms → 原子换名 nonce B ≈2600ms → unlink 退出；
    合计 ≈5200ms > 5000ms、单段 < 5000ms）下 `acquireRootLock` 必须**成功**——「重置分支失效」
    变异（累计 ≈5200ms ≥ 5000ms ⇒ 误抛 claimStuck）与「首拒即抛」变异均在此转红（§12 E9d）。
    **误触发证据链（改写后）**：确定性守卫 = T7a②′（下界）+ T7a⑥（文案不相交）+ T7c（更替
    重置）；两冻结契约的败者子串 regex `/held|unsupported/` 为**概率性兜底**——仅因 §8.1 文案
    避开 `held`/`unsupported` 子串（Option A）而对误触发真实敏感（误发时败者消息失配即红），
    不得作为唯一或主要证据（SA8 B4′ 边界）。

**absent-canonical 竞速与压力契约的关系（SA2 #7c，保留）**：该场景由结构修复保证（缺席证据
不入 reap 臂 + CAS 单胜者 + claim 门），SA6 压力契约作为可执行行为级兜底（§12 E1）。

### 8.4 数据流路线

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚点 |
|---|---|---|---|---|---|---|---|---|
| A 获取（改变） | main.ts 启动/SIGHUP；`{rootDir, instanceId, pid, nonce}` | mkdir staging → wx 写 `staging/owner.json` → wx 写 claim-staging → link claim → `rename(staging→canonical)` → wx 写 `.nomicore-lock.json` | 同进程纯 fs；staging/claim-staging 为 rootDir 下私有唯一名；canonical 出现即完整（I1） | 本地文件系统（同 fs，rename/link 原子） | 争用者 readOwner/claim 读；运维读镜像 | handle 或 loud throw（既有文案不变 + D6 新 claimStuck） | 任何未发布出口 finally 清 staging + claim-staging；镜像失败 rm 自己的 canonical | §12 E1-E5、E8、E9 |
| A′ claim 子协议（新增微流，**D6 修订**） | 回收者/发布者每轮迭代 | 写 claim-staging（完整内容）→ `link` 挂名 claim；死接管 = rename-detach 到 `.reap-claim.reaped-<uuid>` + 内容复核 + 删墓碑（协议外形态弃置墓碑，O-4） | link 原子（无空窗）；**活占等待有界（同内容占用 ≤5000ms，更替重置，单调时钟）** | 本地 fs | 他竞争者读 claim 判活/判死；**D6 计账只读本方内存 + claim 内容** | 门内单持有者；卡死形态 = claimStuck loud（claim/canonical 零改动）；合法连续换手 = 计账逐次重置、获取成功 | 释放 = 内容校验 unlink（原 finally 形态）；死 claim 自动接管；卡死 claim = 人工清除（§11） | §12 E6/E9（E9d/T7c 钉位更替重置） |
| B stale 回收（门槛改变，守卫链原样） | 争用者；死 pid 完整 owner.json | claim 门内：复读守卫 → rename 摘除到 `.reap-<uuid>` → 比对 → rm | 非空死 payload 双读为摘除唯一证据 | 本地 fs | 回收者复读/墓碑比对 | 单胜者回环 CAS | 比对不等 → 回复位（失败 → loud movedHeld，协议内不可达） | §12 E1/E2 |
| B′ 遗留清障（新增） | 争用者；L1 空目录 / L2 空 owner.json / 杂散文件·符号链接·条目 | rmdir / unlink+rmdir / 非目录 rename-detach+rm / 逐项清障+rmdir | 全部条件性原语；`''` 证据永不目录摘除；errno 契约 = #11 | 本地 fs | 分类探测 lstat/readdir | 回环 CAS 收敛单 owner | ENOENT/ENOTEMPTY → continue 复检；EACCES/EPERM → loudUnwritable；其余 rethrow | §12 E5/E6/E8 |
| C release（不变） | owner 进程停机/SIGHUP 旧实例 | rename 到 `.release-<uuid>` → 比对 → unlink+rmdir → 镜像比对删除 | 同 fs | 本地 fs | 后续获取者 | canonical 消失或保留后继者 | 幂等；迟到 release 安全（原样） | canary 既有用例 |

无跨进程 wire、无 schema、无持久化格式变化；`owner.json`/镜像字段与路径零变化。

## 9. 错误、恢复、并发和幂等

- **失败语义（修订后口径）**：既有三族输出（held / unsupported / loudUnwritable + 意外 errno
  原样抛出）**逐字不变**；iteration 3 的「错误消息文案零变化」承诺对其继续成立。**新增失败面
  共两类**：① staging/claim-staging 构建失败（EACCES/EPERM → loud、其余 rethrow——与既有臂同款，
  iteration 3 已有）；② **D6 claimStuck**（同内容活占 claim 连续 ≥5000ms）——该路径在 iteration 3
  为无界静默挂死（缺陷），在旧代码不存在；无任何已钉位断言依赖其旧行为（§8.1 走查）。
- **无静默 fallback**：阶梯每个 `continue` 都是「复检回环」或「有界自旋于活持有者」（D6 上界 +
  loud 出口）；清障 catch 只吞 ENOENT/ENOTEMPTY（转向重新判定）；EACCES/EPERM → loud（#11）；
  回复位失败分支 loud（§8.3-3）；claimStuck loud（I3）。**不存在任何无出口空转路径。**
- **重试/回环终止性（D6 补强后完备）**：claim 门内每轮要么完成一次确定结果的原子操作，要么在
  活占等待中消耗有界预算后 loud；活占据 ⇒ held throw 终止；死/遗留/杂散占据 ⇒ 清障后下一轮 CAS
  必胜（canonical 缺席且无协议内发布者能抢先）；L2/杂散清障在无篡改下每轮至少移除一个稳定条目。
  全部回环路径终止或产生 loud——不存在无界路径（I3）。
- **恢复语义（D6 定义）**：
  - *自动*：claim 持有者进程真死（pid 无复用）⇒ 任何后续获取经 rename-detach 接管自愈（T5）；
    卡死 loud 是可重试的瞬态失败——调用方监督器重启后再次获取，若持有者已死即成功。
  - *人工*：claimStuck 文案给出处置链（核实 pid → 确认 root 无进程使用 → 删
    `.nomicore-lock.reap-claim` → 重试）；§11 部署文档落症状→处置连接句（#8 ②）；T7b 钉位
    「删除后获取成功」。
  - *不自动夺门*（备选 9 否决）：活性预算永远不移除他人的活占 claim——正确性优先。
- **并发**：单活 owner 由 I0/I1/I2 结构保证（D6 零削弱）；回收互斥由 claim 门 + 单胜者 rename +
  墓碑比对保证；claim 自身原子性由 link 挂名 + 单胜者接管保证（B6 修复）；claim 等待由 D6 有界化
  ——「占用更替 ⇒ 计账重置」由 T7c（E9d）确定性钉位，「同内容占用 ≥5000ms 才许抛」由 T7a②′
  下界钉位（#12）。
- **幂等**：release 幂等（原样）；acquire 非幂等语义不变（同 instance 重取 ⇒ held-by-same-
  instance loud，canary 钉位）；claim 释放内容校验（原样）。
- **资源所有权**：staging 目录 + claim-staging 文件生命周期 = 本次调用，任何出口 finally 删除
  （claimStuck 出口亦然）；claim 接管墓碑正常路径同调用内删除，协议外形态（O-4 弃置）/SIGKILL
  中断遗留 = 有界瞬态名（R2）；SIGKILL 中断获取/回收的遗留 = 至多各一个（R2 名族）。

## 10. 调用方影响矩阵

| 调用方 | 当前处理 | 设计后处理 | 所需改动 | 证据 |
|---|---|---|---|---|
| `main.ts` L193（file 模式启动） | try/catch → stderr + `exit(1)`（通用） | 同——签名/既有文案零变化；争用下不再可能双成功；**claim 卡死形态从「挂死」变为 ≤5000ms 后 claimStuck → stderr + `exit(1)`（监督器可重启重试）** | 无 | B8/B12 亲读 |
| `main.ts` L132（SIGHUP 换装：stop → release → 重取） | 失败 → `failBoot` loud `exit(1)`（通用） | 同——claim 卡死形态 ≤5000ms 后 loud 失败：旧实例已停 → `exit(1)` → 监督器重启 → 下次 boot 重试（§3.7 换装非事务语义不变）；**watchdog 免疫窗口消除（B12：同步自旋 ≤5000ms ≪ 60s）** | 无 | main.ts L100-105/L125-145 |
| `src/index.ts` L70 re-export | 导出 `acquireRootLock` 等 | 同（无新增导出；新常量/构造器/import 模块私有） | 无 | 本轮亲读 |
| `test/fixtures/root-lock-worker.ts`（真进程驱动） | acquired/rejected 单消息协议 | 同；争用下恰 1 acquired；败者经既有 held/unsupported 家族退出、消息匹配 `/held\|unsupported/`——claimStuck 文案与该 regex 不相交（§8.1 硬约束），故若 D6 误发，败者消息失配即红（概率性兜底；确定性守卫 = T7a/T7c，§8.3-10） | 无 | fixture L8-23 |
| canary `root-lock-atomic-reclaim-red.test.ts` | 7 用例（含 CI 红用例） | 全绿；**文件零改动**；7 用例均不构造活占 claim（逐用例走查），claimStuck 面不触达 | 无 | SA6 §5.1/§6 |
| SA6 压力契约 `root-lock-stale-reclaim-race-stress.test.ts` | 当前红（attempt 1 即红） | 全绿（结构保证）；败者 regex `/held\|unsupported/` 与 claimStuck 文案不相交（Option A）——对 D6 误触发构成**真实但概率性**的兜底（确定性守卫 = T7a②′/⑥ + T7c，§12 E9；SA8 B4′：不得以本契约转红为唯一误触发证据） | 无（禁弱化） | `task_ci-pr-276_sa6_stress-red.log` |
| 运维/文档读者（hub-peer-deployment.md） | mkdir 线性化点措辞；L250 pid 复用句只覆盖 `.nomicore-lock/` | 机制句更新（原子发布 + claim 门 + **有界等待/超时 loud**）；Windows 能力句；遗留名族清理口径（含 `.reap-claim.reaped-<uuid>`）；**claim 卡死症状→处置句（#8 ②：获取以 claimStuck 失败 ⇒ 核实 pid ⇒ 删 claim ⇒ 重试；注明 L250 句不覆盖本形态）** | §11 文档行 | B9 亲读；SA2 #8/#9 |
| 新测试 `root-lock-atomic-publication.test.ts`（消费公共入口） | —（本轮新增文件） | T1-T6 沿 iteration 3；T7a/T7b/T7c 新增（E9a-E9d，含 #12 的 T7a②′/⑥ 下界与不相交断言、T7c 更替重置用例与内联 `node -e` 助手）；T5 名族预置扩含 `.reap-claim.reaped-<uuid>` | §11 | §12 |

无未覆盖调用方（B8 grep 全量：src 内仅 main.ts 消费；测试侧仅上述文件 + fixture + 新增测试文件）。

## 11. 文件范围

### ALLOW LIST

| 路径 | 预期改动 | 原因 |
|---|---|---|
| `apps/yjs-server/src/lifecycle.ts` | 获取臂重构（iteration 3 面）：①-⑤ staging 构建（CAS 件 + claim 件，claim-staging 写加 `wx`，O-5）→ claim 门（link 挂名 + 死接管 rename-detach 到 `.reap-claim.reaped-<uuid>`（#9）+ 内容复核 + 墓碑删除守护（O-4）+ 内容校验释放）→ 原子 CAS（errno 集 = EEXIST/ENOTEMPTY/ENOTDIR/EPERM-探测）→ 证据门控阶梯（非空死双读摘除链原样内联；`''` → absent-continue / rmdir / 非目录摘除 / L2·杂散清障，**各步显式 errno 契约 #11**）。**D6 新增（#8）**：模块私有 `ROOT_LOCK_CLAIM_WAIT_LIMIT_MS = 5_000` + `performance`（node:perf_hooks）import + claim 占用计账（同内容连续活占超限 ⇒ `claimStuckError` loud；更替/挂名/缺席 ⇒ 重置；绝不夺门）。L105-108 头注不变量措辞更新（线性化点 = 完整 staging 目录原子 rename 发布；claim 门语义与有界等待） | 唯一根因修复点（B2/B4/B5/B6）+ #8 liveness 修复点（B11/B12）；SA2 各轮全部修订落点 |
| `apps/yjs-server/test/root-lock-atomic-publication.test.ts` | **新增**确定性 + 并发契约：T1 L1 升级遗留空 `.nomicore-lock/` 被安全接管且 owner.json=获取者；T2 L2 遗留 `{owner.json:""}` 被安全接管；T3/T4（=E8）杂散文件/指向外部目录的符号链接 at canonical → 接管恢复、release 干净；T5（=E6）遗留名族全在场（`.acquire-<uuid>`、`.reap-claim.staging-<uuid>`、死 pid `.reap-claim`、**`.reap-claim.reaped-<uuid>`（#9 名族钉位）**、`.reap-<uuid>`、`.release-<uuid>`）不干扰获取；T6（=E5b）L1/L2 预置 root × 12 真竞争者 + 2 burner 恰 1 acquired、N-1 rejected 匹配 `/held\|unsupported/`；**T7a/T7b/T7c（=E9a-E9d，D6；T7a②′/⑥ 与 T7c 为 #12 修订新增）**——**T7a**：预置活 pid（`process.pid`）+ 外部 instanceId 的 `.reap-claim` ⇒ `acquireRootLock` 抛错（测试超时 30s 兜底「不挂死」），断言七件：① 文案匹配 `/reclaim claim .* occupied by a live pid .*\(pid reuse caveat/`；**②′ 墙钟下界：同一 `performance.now` 包夹 `elapsed ≥ 5000ms`（规格「同内容占用连续判活 ≥ LIMIT 才许抛」保证成立——「首拒即抛」「量纲错误」「基线续量合并」变异在此转红，#12 A2）**；② 墙钟上界 `elapsed < 4×5000ms`（吸收 CI 抖动——证明有界）；③ claim 文件字节不变（不夺门）；④ canonical 未创建；⑤ 无 `.nomicore-lock.acquire-*`/`.reap-claim.staging-*` 残留；**⑥ 文案不匹配 `/held\|unsupported/`（与两冻结契约败者 regex 不相交——把守卫性质钉为被测契约，防未来文案漂移重新击穿，#12 A2）**；**T7b**（承 T7a 同 root）：删除该 claim（模拟运维处置）⇒ 获取成功、owner.json=镜像=获取者、release 干净；**T7c（=E9d，更替重置）**：测试文件内联 `node -e` 助手（**不新增 fixture 文件**，同 stress burner 的 spawn 模式）以外部 instanceId + 自身活 pid 写 claim（nonce A）→ **测试进程先（异步轮询）确认 nonce A 在场后**再进入同步 `acquireRootLock`（防「门未挂上即获取」退化）→ 助手 ~2600ms 后以「写 staging + `renameSync(staging, claim)` 原子换名」（**无空窗——禁止 unlink+write**，O-10）换成 nonce B → 再 ~2600ms 后 unlink 退出（单段 < 5000ms、合计 ≈5200ms > 5000ms）；断言：获取**成功**（不抛 claimStuck）、owner.json=镜像=获取者、release 干净（测试超时 30s）——正确实现经两次更替重置后成功；「重置分支失效」变异（累计 ≈5200ms ≥ 5000ms）与「首拒即抛」变异均转红 | D1/D1′/D2/D4 新状态 + **D6 有界/liveness 行为与恢复语义 + 更替重置计账**需行为钉位；不动 SA6 两契约文件 |
| `docs/integration/hub-peer-deployment.md` | §锁文件与共享 root：获取机制句（原子发布 + claim 门 + **门等待有界：同持有者连续占用超 5000ms 即 loud 失败，绝不无界等待**）与 stale 回收句措辞更新；Windows/非 POSIX 能力句（D3）；**rootDir 顶层瞬态遗留名族清理口径（D5/#9：`.nomicore-lock.acquire-*`、`.nomicore-lock.reap-claim`（含 `.staging-*`）、`.nomicore-lock.reap-claim.reaped-*`、`.nomicore-lock.reap-*`、`.nomicore-lock.release-*`——确认无进程使用该 rootDir 后可手工删除）**；**claim 卡死症状→处置句（#8 ②；#12 引文同步）**：获取失败文案含 `reap-claim … still occupied by a live pid … 5000ms` ⇒ `ps` 核实该 pid；确认其非活跃回收者且 root 无进程使用后删除 `.nomicore-lock.reap-claim` 即恢复；**注明既有 pid 复用句（L250，针对权威 `.nomicore-lock/`）不覆盖本形态**；**（#13）可选注明：5000ms 以单调时钟计量，不含系统挂起（suspend）时长——挂起/重度调度饥饿下从墙钟看等待可能长于 5000ms 才触发**；其余语义句（单活 owner、共享 root 拒绝、镜像非 token、pid 复用人工确认）零变化 | B9 文档与实现保持一致；SA2 #3/#6/#8/#9/#12/#13；SA8 F5/G7/B3（扩句不触发新门禁） |
| `apps/yjs-server/AGENTS.md` | Boundaries 末条「以排他 `mkdir` 取得」→「以原子 rename 发布完整 staging 目录取得（canonical 首次可观察即含完整 owner.json；发布与回收经 `.reap-claim` 互斥门串行，门等待有界——同一持有者连续占用超时即 loud 失败，绝不无界静默等待）」 | 模块契约措辞同步（B9 + D6） |

### DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
|---|---|---|
| `apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts` | CI canary（抓到本缺陷） | SA6 契约头注「stays untouched」；弱化/改动即违反派发要求 |
| `apps/yjs-server/test/root-lock-stale-reclaim-race-stress.test.ts` | 本轮可执行验收契约（当前红） | 同上；验收断言不得软化（/held\|unsupported/、恰 1 acquired、owner+镜像=winner）；Option A 后其败者 regex 与 claimStuck 文案不相交——对 D6 误发真实转红，但仅为**概率性兜底**（确定性守卫 = T7a②′/⑥ + T7c，§12 E9；不得以本契约转红为唯一误触发证据——SA8 B4′/SA2 #12） |
| `apps/yjs-server/test/fixtures/root-lock-worker.ts` | 契约驱动夹具 | 行为锚，改动会改变复现形状 |
| `apps/yjs-server/src/main.ts` / `src/index.ts` | 消费方/公共面 | 签名、导出与错误语义零变化（§10——两处调用点对 thrown Error 通用处理，D6 无需调用方改动）；O2 注释勘误为可选顺手项，不构成本轮义务 |
| `packages/persistence/**`、其余 `packages/**` | 不持有根锁（SA6 §10；SA8 F3/G3） | 越界；双活修复与 D6 均不需要 |
| `.github/workflows/ci.yml`、`scripts/ci-test-shard.mjs`、`vitest.config.ts` | CI 分片机制 | 禁止以跳过/禁用/重排方式「变绿」；新测试文件被磁盘枚举自动收录（本轮亲证 walk） |
| `wiki/raw/task_ci-pr-276_sa6_*`、`task_ci-pr-276_sa2_review.md`、`task_ci-pr-276_design_conflict_report.md`、`task_ci-pr-276_design_conflict_report_iter3.md`、`task_ci-pr-276_rootlock-race-driver.mjs` | 上游证据/工具 | 只读输入 |

## 12. 验收与验证映射

执行环境口径与 SA6 §4 一致（node 24 / vitest 3.2.7 / `NODE_OPTIONS=--conditions=nomicore-source`；
`vitest.config.ts` include `apps/*/test/**/*.test.ts` + `maxWorkers:1` 本轮亲证）。不指定由哪个 SA
执行。形态名 L1/L2 = iteration 3 文本的 E1/E2 形态（SA2 O-1 更名）；验收 ID E1-E9 不变。

| 需求或风险 | 现有证据 | 所需行为测试或动态场景 | 预期观察 |
|---|---|---|---|
| E1 双活消除（CI 红断言 + SA2 #1 phantom 形态） | `task_ci-pr-276_sa6_stress-red.log`（attempt 1 红，2 acquired） | SA6 压力契约原样转绿，且连续 ≥3 次全文件复跑全绿；对 D6 误发为**概率性兜底**（Option A 后败者 regex `/held\|unsupported/` 与 claimStuck 文案不相交——误发时败者消息失配即红；确定性守卫 = T7a②′/⑥ + T7c，§8.3-10） | 6 轮全过：每轮恰 1 acquired、N-1 rejected 匹配 `/held\|unsupported/`、owner.json=镜像=winner |
| E2 CI 恢复绿 | `task_ci-pr-276_sa6_ci-fail.log`（run 34296011254） | canary 7/7 绿；`node scripts/ci-test-shard.mjs 4 6` 全量绿（本地同形）；PR #276 重跑 CI 绿 | 单文件红消失、无新增红 |
| E3 非竞态语义零回归（含杂散形态 parity） | canary 其余 6 用例（CI+本地绿） | 同文件零改动复跑 + E8 杂散恢复钉位：`.nomicore-lock` 为普通文件 / 指向外部目录的符号链接 → 获取成功、owner.json/镜像=获取者、release 干净、无裸 ENOTDIR 逃逸 | 7/7 + E8 恒绿、确定性 |
| E4 既有套件零波及 | CI 49 文件仅此 1 红 | `vitest run apps/yjs-server/test`（maxWorkers=1 既有配置）+ `tsc -p apps/yjs-server/tsconfig.json` | 全绿、typecheck 干净 |
| E5a 升级遗留确定性接管（单进程，L1/L2 形态） | 无（iteration 3 引入路径） | T1（L1 真空目录）/ T2（L2 `{owner.json:""}`）：手工预置 → 获取成功、owner.json/镜像=获取者、release 干净 | 恒绿、确定性 |
| E5b 升级遗留并发回收恰 1 owner | 无 | T6：L1/L2 预置 root × 12 真竞争者 + 2 burner（worker fixture 同 canary 协议） | 每形态恰 1 acquired、N-1 rejected 匹配 `/held\|unsupported/`、owner.json=镜像=winner、结束后无含活 pid 内容的 `.reap-*` 残留 |
| E6 遗留名族不干扰 + 死 claim 接管 | 无 | T5：预置全族（`.acquire-<uuid>`、`.reap-claim.staging-<uuid>`、**死 pid `.reap-claim`（自动接管钉位）**、**`.reap-claim.reaped-<uuid>`（#9 名族）**、`.reap-<uuid>`、`.release-<uuid>`）→ 获取照常成功、canonical 正确 | 恒绿 |
| E7 高争用额外动态证据（可选加强） | SA6 driver | 修复后 driver burn ≥200 轮（验证工具，不入 vitest） | 零双活（结构上应恒零，非阈值） |
| **E9a（新，D6）claim 门有界性 + 不夺门（iteration 5 增 ②′/⑥，#12 A2）** | 无（iteration 3 形态为挂死——SA2 判不可测；D6 使其可测） | **T7a**：预置 `.nomicore-lock.reap-claim` 内容 = `{instanceId:'foreign-holder', pid: process.pid, nonce: <uuid>}`（pid = 测试进程自身 ⇒ 判活必真，确定性复用 reused-pid/冻结同形）⇒ `acquireRootLock(root,'instance-A')` 抛错（测试超时 30s 兜底「不挂死」）；`const t0 = performance.now()` 包夹 try/catch | 断言七件：① 错误文案匹配 `/reclaim claim .* occupied by a live pid .*\(pid reuse caveat/`；**②′ 墙钟下界 `performance.now() - t0 ≥ 5000ms`（规格「同内容占用连续判活 ≥ LIMIT 才许抛」保证成立，不排斥合规实现——「首拒即抛」「量纲错误（如 5000µs）」「基线与续量合并」变异在此转红，#12 盲区一）**；② 墙钟上界 `performance.now() - t0 < 4×5000ms`（放宽 4× 吸收 CI 抖动——证明有界）；③ claim 文件字节不变（**不夺门**，正确性保持）；④ canonical 未创建；⑤ rootDir 顶层无 `.nomicore-lock.acquire-*`/`.reap-claim.staging-*` 残留（finally 清理生效）；**⑥ 文案不匹配 `/held\|unsupported/`（与两冻结契约败者 regex 不相交——守卫性质本身成为被测契约，未来文案漂移重新引入 `held`/`unsupported` 子串在此转红）** |
| **E9b（新）恢复语义——人工清除路径** | 无 | **T7b**（承 T7a 同 root）：`unlinkSync` 该 claim（模拟 §11 运维处置）⇒ `acquireRootLock(root,'instance-B')` | 成功；owner.json=镜像=instance-B；release 后 canonical 与镜像均消失 |
| E9c（iteration 5 改写）恢复语义——自动接管路径 + 误触发证据链（#12 A4） | T5（死 pid claim 接管）；E1（压力契约） | 死 pid claim ⇒ 下一获取自动接管（T5 已含）；**确定性误触发守卫 = T7a②′（下界，堵「急早起爆」）+ T7a⑥（文案不相交）+ T7c/E9d（更替重置，堵「重置失效」）**；E1/canary 败者 regex 为 Option A 下的**概率性兜底**（真实敏感、非唯一证据——SA8 B4′） | T5 恒绿；E1 ≥3 复跑全绿（其新角色 = 概率性兜底） |
| **E9d（新，#12 A3）占用更替 ⇒ 计账重置（turnover-reset accounting）** | 无（iteration 4 全验收面对该性质零覆盖——SA2 #12 盲区二） | **T7c**：测试文件内联 `node -e` 助手（不新增 fixture 文件）以外部 instanceId + **自身活 pid** 写 claim（nonce A）；测试进程（异步轮询）确认 nonce A 在场后进入同步 `acquireRootLock(root,'instance-C')`；助手 ~2600ms 后以「写 staging + `renameSync(staging, claim)`」原子换名换成 nonce B（**无空窗——禁止 unlink+write**，O-10），再 ~2600ms 后 unlink 退出——两次占用更替，单段 < 5000ms、合计 ≈5200ms > 5000ms（测试超时 30s） | `acquireRootLock` **成功**（不抛 claimStuck——正确实现经两次更替重置）；owner.json=镜像=instance-C；release 后 canonical 与镜像均消失。**变异敏感性（实现评审须验证）**：「重置分支失效」变异（M2：累计 ≈5200ms ≥ 5000ms ⇒ 误抛 claimStuck）转红；「首拒即抛」变异（M1）转红 |

**实现期变异自检义务（SA2 #12 验收条款；一次性、不随实现入库）**：实现评审须附变异自检证据——
临时引入 M1（如「首拒即抛」）或令 `ROOT_LOCK_CLAIM_WAIT_LIMIT_MS` 置 0 后运行 canary / stress /
T6 / T7a / T7c 所在测试文件，**至少一处转红**（Option A 下 canary L107 与 stress L127/L168 因文案
不相交亦应对 M1 转红——守卫网整体敏感性证明）；随后复原并全绿。该义务证明验收网对 M1/M2 敏感，
不指定由哪个 SA 执行。

## 13. 风险、回滚和残余问题

| # | 风险/残余 | 评估 | 处置 |
|---|---|---|---|
| R1 | **平台能力矩阵**：D1/D1′/D6 根基是 POSIX rename(2)/link(2)/rmdir(2) 语义（§14）。Linux（CI）与 macOS 一等；Windows 经 libuv `MoveFileExW` 映射，目录替换语义不同（典型 EPERM/EBUSY，句柄滞留时尤甚）。修复后 Windows：CAS 争用经 D3 只读探测正确分类为争用；死 owner 回收在无滞留句柄时通常可行，句柄滞留 → EPERM/EBUSY loud（errno 保留）；`performance.now()`/`process.kill(pid,0)` 跨平台（Node 文档）。**残余**：Windows 上 stale 自动回收不保证成功，未经 CI 矩阵验证（ubuntu-only）——Windows 非一等目标，诊断准确性是承诺，回收成功率不是 | 设计声明 + §11 部署文档能力句同步；POSIX EPERM 边缘经探测在场 → 转阶梯 → destructive 步按真实 errno loud（文案不变） |
| R2 | SIGKILL 中断获取/回收的 rootDir 顶层瞬态遗留名族：`.nomicore-lock.acquire-<uuid>` 目录、`.nomicore-lock.reap-claim.staging-<uuid>` 文件、`.nomicore-lock.reap-claim`（claim 本体）、`.nomicore-lock.reap-claim.reaped-<uuid>`（接管墓碑：正常路径同调用内删除；SIGKILL/协议外形态（O-4 弃置）遗留）、`.reap-<uuid>` 墓碑、`.release-<uuid>` 墓碑 | 有界（每次崩溃至多各一）、协议不可见（UUID 唯一、无人读他人 staging/墓碑）、**除 claim 本体外均不阻塞获取**。claim 本体分形：**死 pid（无复用）⇒ 自动接管自愈（T5）；pid 被复用或持有者冻结 ⇒ 不自愈——D6 有界 loud（≤5000ms）+ §11 人工清除（T7b），不再是无界挂死**（SA2 #8 ① 如实改写） | 运维清理口径 + 症状→处置句落 §11（D5/#8/#9）；机会式清扫为明确 follow-up，不入本票（范围纪律） |
| R3 | reap-claim 保留并升级为正确性承载（防线一） | B6 缺陷由 link 挂名 + 单胜者接管修复；D6 补齐其 liveness 面（有界等待 + loud）；瞬态双回收者残余由防线三兜底 | follow-up（可选）：claim 纳入诊断输出 + N1′ 的轻量 ADR 裁量（归 owner/总控），不阻塞 |
| R4 | pid 复用误判（死 pid 被复用 → 误报存活）——**SA2 #8 ① 如实改写：owner 侧与 claim 侧不同构** | **owner 侧**：死 owner + 复用 pid ⇒ `readOwner` 判活 ⇒ **立即** loud held/unsupported（既有行为不变）。**claim 侧**：死 claim 持有者 + 复用 pid（或冻结持有者）⇒ **有界等待（同内容占用 ≤5000ms）后** claimStuck loud。两侧方向一致安全（永不剥夺判活持有者），但**时延与文案不同构**——iteration 3 的「同构/不变」表述失实，已改 | 两侧处置均落入 §11 运维口径（owner 侧 = L250 既有句；claim 侧 = 本轮新增句）；T7a/T7b 钉位 claim 侧 |
| R5 | 活 claim 持有者导致他者等待——**SA2 #8 ① 如实改写：不再「不变/有界」笼统登记** | 合法持有（回收者一趟阶梯，毫秒级）⇒ 等待者紧密轮询至换手（更替重置——**由 T7c/E9d 确定性钉位**）；失活持有（复用/冻结）⇒ 等待 ≤ `ROOT_LOCK_CLAIM_WAIT_LIMIT_MS` 后 claimStuck loud（**≥ LIMIT 才许抛由 T7a②′ 下界钉位**）。**CPU 燃烧上界 = 等待上界**（≤5000ms/次连续占用；同步退避为否决项备选 12）。同步等待期间 SIGTERM/watchdog 不触发（B12 同步语义）——由预算上界封顶该窗口，出口后信号/回调恢复 | D6 机制 + §11 症状句 + T7a②′/②/⑥ 断言 + T7c；两冻结契约为概率性兜底（文案不相交，§12 E9） |
| R6 | 无 fsync（掉电一致性） | 根锁是活性协调原语（进程死 ⇒ 按 pid 判 stale），非崩溃持久化数据；与现状 parity | 不引入 fsync（SA8 F2/G 纪律一致） |
| R7 | 混版本共享 rootDir（双向）：(i) 新版回收者 vs 旧版获取者——旧版 mkdir 空窗口目录（非空后）可被新版按非空死证据回收，但旧版空窗口内目录会被新版清障，旧版 fd 写落在已消失目录仍「成功」→ 旧版 phantom；(ii) 旧版获取者 vs 新版 owner——旧版写失败臂 `rmSync(canonical, recursive)` 在「旧版 mkdir 空目录 → 新版 CAS 替换 → 旧版 wx 写 EEXIST → 旧版 rm」交错下删掉新版 owner 刚发布的 canonical → 新版 phantom | 部署单元 = 每 rootDir 单二进制（L248/L249 所有权排他句已把混版本并发排除在合法用法外——**不作「显式句在场」引述**，SA8 O3/B3′）；若实施轮需要显式边界句，走 §11 扩句 | 维持假设口径（不扩支持面） |
| **R8（新）** | D6 预算的残余边界（如实登记；② 为 iteration 5 #13 改写——原文方向写反）：① **协议外误触发**——门内清障遭遇篡改规模的巨型杂散子树（单遍 rmSync 耗时 >5000ms）会使等待者在合法持有期内 claimStuck（方向：loud、可重试、需运维本就在场的清理）；② **时钟与挂起**——`performance.now()` 单调（无 NTP 跳变）且其底层（libuv `uv_hrtime` = Linux `CLOCK_MONOTONIC`）**不含系统挂起（suspend）时长**：挂起使**墙钟**等待变长而单调计量不变 ⇒ 触发相对墙钟只会**更晚**、绝不提前（iteration 4「suspend 计入墙上时长、极端下提前触发」的表述与实现相反，已改——SA2 #13）；I3 的单调上界不受影响；③ **全局有界性**——预算以「单次连续同内容占用」为界；跨无穷次占用更替的累计等待在协议内有界（竞争者有限、每持有者阶梯终止），协议外（无穷外部进程 churn）超出 R7 假设面 | ①/② 属协议外/极端形态，loud 可重试不损正确性；③ 协议内由终止性论证覆盖（§9） | §11 运维口径覆盖①、注明②（墙钟可能长于 5000ms）；不为本轮扩面 |
| 回滚 | 单文件 `lifecycle.ts` revert + 删新增测试 + 文档句 revert | 无数据迁移（锁文件瞬态；遗留名可留待运维清理，R2 口径） | 纯代码回滚即恢复修复前行为（含缺陷与旧 claim 自旋形态） |

任务内必要条件无未解决项；follow-up（R2 机会式清扫、R3 诊断输出/轻量 ADR、Atomics.wait 退避优化）
均为可选加固，不阻塞验收。

## 14. 协议假设依据（SA2 iter-1 #4 立法义务；SA1 自带可重跑证据）

**章节存在性**：独立章节（iteration 1 缺失曾被单列 reject——已修复；iteration 4 增补 P10）。

| # | 假设 | 规范依据 | 本机验证 |
|---|---|---|---|
| P1 | `rename(目录, 缺席目标)` 原子成功；若目标存在则原子替换，无「另一进程观察到目标缺席」的中间点 | [man7 rename(2)](https://man7.org/linux/man-pages/man2/rename.2.html) DESCRIPTION | onto-absent: OK |
| P2 | `rename(目录, 已存在空目录)` = 原子替换成功（L1 升级遗留替换根基） | 同上（newpath must either not exist, or specify an empty directory） | onto-empty-dir: OK |
| P3 | `rename(目录, 非空目录)` → ENOTEMPTY 或 EEXIST（Linux 实测 ENOTEMPTY） | 同上 ERRORS | onto-nonempty-dir: ENOTEMPTY |
| P4 | `rename(目录, 普通文件/符号链接)` → ENOTDIR（D2 依据） | 同上 ERRORS；符号链接改名链接本身 | onto-regular-file / onto-symlink-to-dir: ENOTDIR |
| P5 | `rename(普通文件/符号链接, 缺席墓碑)` 成功且不可能作用于目录型目标（stray-nondir 依据） | 同上 | stray-file/symlink→absent-tomb: OK |
| P6 | `link(staging, claim)`：目标存在 → EEXIST，否则原子创建且内容随 inode 完整（claim 无空窗口根基） | POSIX [link(2)](https://man7.org/linux/man-pages/man2/link.2.html)；Node `fs.linkSync` | link 原子性为内核语义（EEXIST 分支即现有 L151 形态） |
| P7 | `rmdir` 仅能删除空目录；非空 → ENOTEMPTY（L1/清障终步的内容无关安全性根基） | POSIX [rmdir(2)](https://man7.org/linux/man-pages/man2/rmdir.2.html) | rmdirSync(nonempty): ENOTEMPTY；rmdirSync(empty): OK |
| P8 | Node `fs.rmSync(path, {recursive, force})` 默认 `maxRetries=0` = 单遍 | [Node fs 文档](https://nodejs.org/api/fs.html#fsrmsyncpath-options) | D4 约束实现不得传 `maxRetries>0` |
| P9 | 平台差异：Linux（CI）与 macOS 符合上述 POSIX 语义；Windows 经 libuv `MoveFileExW` 映射（libuv `src/win/fs.c` `fs__rename`），目录替换语义不同 | man7 STANDARDS；Node fs 文档 | CI 矩阵 ubuntu-only；Windows 不在验证面（§13 R1） |
| **P10（新，D6）** | `performance.now()` 为**单调**高分辨率毫秒时钟（不受系统时间/NTP 调整影响），可在同步代码中直接调用；`process.kill(pid, 0)` / EPERM 判活语义跨 POSIX 平台一致（既有 `isPidAlive` L49-57 依赖，非新增假设） | [Node perf_hooks 文档](https://nodejs.org/api/perf_hooks.html)（`performance.now()`：high resolution millisecond timestamp，monotonic）；[Node process 文档](https://nodejs.org/api/process.html#processkillpid-signal)（signal 0 = 存在性/权限检测） | 时钟单调性为运行时契约（无需探针）；判活语义为既有代码行为（L49-57 亲读） |

**SA1 本机一次性验证脚本与输出**（node v24.13.0 / Linux / 本 worktree 同机，2026-09-09；脚本只写
`os.tmpdir()` 下 mkdtemp，不触仓库文件；SA2 §2 独立实测同形结果逐条一致——互证）：

```text
脚本（要点）：mkdtemp 基目录 → 逐 case 构造 staging 目录（含完整 owner.json）或杂散形态 → renameSync/rmdirSync 探测

rename(staging,absent)               : OK
rename(staging,nonempty-dir)         : ENOTEMPTY
rename(staging,empty-dir)            : OK        ← 附读回校验 owner.json 内容完整到达
rename(staging,regular-file)         : ENOTDIR
rename(staging,symlink-to-dir)       : ENOTDIR
rename(stray-file,absent-tomb)       : OK
rename(stray-symlink,absent-tomb)    : OK
rmdirSync(nonempty-dir)              : ENOTEMPTY
rmdirSync(empty-dir)                 : OK
```

完整脚本：`/tmp/sa1-ci-pr-276-rename-probe.mjs`（一次性探针，沙箱外临时产物；要点已内联如上，
SA4 可按内联要点重跑对拍——SA8 B2′ 移交义务）。**SA6 strace 证据**（`task_ci-pr-276_sa6_red.log`
§4：`wx` = openat+write 两阶段）继续作为 B3/B6 缺陷机制依据。

## 15. 评审修订映射

### 15.1 SA2 iteration-1 findings #1-#7（iteration 2/3 已落实——本修订**全部保留**并逐条复核未回归）

| Finding | 严重度 | 既有解（iteration 3 落点，本修订保留） | 本修订影响 |
|---|---|---|---|
| #1 残余双活：`''` 证据 rename 摘除 + 回复位失败 = phantom | CRITICAL | D1′（claim 门 + 证据阶梯 + 三层防线）+ D4 + §8.2/§8.3-1~-4/-6 | 无回归：D6 只改等待者退出方式，不动门结构与证据门槛；SA2 iter-2 独立重推结论（不可达 + 门必要）原样承接 |
| #2 杂散文件/符号链接裸 ENOTDIR 逃逸 | MEDIUM | D2（ENOTDIR 并入争用集 + stray-nondir 摘除，parity 恢复） | 无变化（§8.2/§12 E3/E8 保留） |
| #3 Windows/EPERM 表述失实 | MEDIUM | D3（只读探测分类）+ R1 如实矩阵 | 无变化；R1 增补 D6 相关跨平台事实（P10） |
| #4 协议假设依据章节缺失 | MEDIUM | §14 P1-P9 + 本机探针 | 增补 P10（单调时钟 + 判活语义），义务延续 |
| #5 R7 混版本单向 | LOW | R7 双向 | 无变化；处置改为可定位口径（O3/B3′ 采纳） |
| #6 遗留族运维口径 | LOW | D5 + §11 名族清单 | 清单扩含 #9 新名 + #8 症状→处置句 |
| #7 测试契约完备性 | LOW | E5a/E5b/E8 + §8.3 末段声明 | 无变化；新增 E9 与之并列 |

### 15.2 SA2 iteration-2 findings（iteration 4 逐条落实，本修订全部保留并复核未回归）

| Finding | 严重度 | 修订要求（SA2 §13） | 修订位置 | 处理结果 |
|---|---|---|---|---|
| **#8** claim 门同步无界静默自旋（pid 复用/冻结；watchdog 免疫；R2/R4/R5 失实；运维无症状连接；暴露面较旧代码扩大） | **MAJOR** | ① 如实改写 R2/R4/R5（暴露面、静默无界、watchdog 免疫、SIGKILL+人工恢复）并修「同构/有界」；② §11 运维句：症状→处置连接 + 注明 L250 句不覆盖；③ §12 E6/T5 注明 reused-pid 为 manual-only | **超出字面要求（派发迭代 4 指令升级为机制义务）**：§7 D6（有界等待 + claimStuck loud + 更替重置 + 绝不夺门）；§0 I3；§8.1 唯一新错误面定稿；§8.2 claim-blocked 终止态；§8.3-9/-10（卡死行为 + 无误触发分析）；§9 恢复语义；§13 R2/R4/R5 如实改写 + R8 新增；§11 运维症状句；§12 E9a/E9b/E9c——**原「manual-only 不可测」结论被 D6 取代：T7a/T7b 确定性可执行（预置活 pid claim，无需钩子）** | **落实（机制 + 登记双轨）**：自旋上界 = 5000ms/连续占用；出口 loud（文案含 claim 名/持有者/上限/处置）；不夺门保 I0；boot/reload 通用 catch 无需改动 |
| #9 claim 接管墓碑名未定义 | MINOR | §8.1 立法常量并入名族四处清单 | §8.1 `ROOT_LOCK_REAP_CLAIM_TOMB_PREFIX = '.nomicore-lock.reap-claim.reaped-'`；§7 伪代码；§13 R2；§11 文档行；§12 T5 预置族 | **落实**：五处一致（§8.1/R2/§11/伪代码/T5） |
| #10 D4 绝对化表述与发布失败自清理冲突 | MINOR | 限定作用域：清障阶梯内恒 rmdir；发布失败自清理为唯一例外 | §7 D4 末条（#10）；§8.2 clearing-l2 禁止态 + publishing 行 | **落实**：无相互矛盾的绝对化表述 |
| #11 裸 catch 的 errno 映射缺口（EACCES 下静默自旋） | MINOR | D4/§8.2 各清障行显式重申 errno 契约 | §7 D4（#11 规范条）+ NEW④ 伪代码注释；§8.2 各 clearing 行；§9 无静默 fallback 条 | **落实**：ENOENT/ENOTEMPTY → continue；EACCES/EPERM → loudUnwritable（文案不变）；其余 rethrow |

**非阻断观察采纳**：O-1（L1/L2 形态更名，§1/§7 D4/§12）；O-4（接管墓碑 unlink 守护 → 弃置，§7
伪代码）；O-5（claim-staging 写加 `wx`，§7 NEW①）。**不采纳/移交项**：O-2（main.ts 头注勘误留
实施轮可选）；O-3（R7 引述精确性——iteration 4 已改为不作「在场性」引述，显式句留实施轮裁量）；
O-6（自旋 backoff——被 D6 部分吸收为上界，退避本身列否决项备选 12/follow-up）；O-7（Windows
EPERM 归因偏差——R1 覆盖）。

**重审范围遵从**：D1/D1′/D2/D3/D4 机制结构与 iteration 3 完全一致（SA2 明示「不应借本次修订
重开机制面」——iteration 4 修订未动其任何结构，仅内嵌 D6 于 NEW② 的等待路径并做 #9/#10/#11
文本级修补）；D6 是派发迭代 4 指令明令的新增面，落在既有 ALLOW 的 lifecycle.ts/新测试/两文档行内，
未扩 ALLOW/DENY。

### 15.3 SA2 iteration-3 findings（本修订逐条落实，#12 Option A + #13）

| Finding | 严重度 | 修订要求（SA2 §12） | 修订位置 | 处理结果 |
|---|---|---|---|---|
| **#12** D6 误触发守卫论证失实（claimStuck 文案含 `held` 子串 ⇒ 败者子串 regex 仍匹配、两契约不转红；= SA8 iter-4 O4/B4′ 采纳并加重）+ 两个确定性盲区：「预算过早起爆」变异（M1）与「占用更替 ⇒ 计账重置」变异（M2）对全部既有验收面全绿 | **MAJOR（binding）** | Option A（推荐）：(A1) 文案避开 `held`/`unsupported` 子串并同步钉位 regex 与 §11/§12 引文；(A2) T7a 增 ②′ 下界 `≥5000ms` + ⑥ 不相交断言；(A3) 新增 T7c 更替重置确定性用例（内联 `node -e` 助手，不新增文件，原子换名无空窗）；(A4) 改写 8 处「契约转红」失实表述；共同不可谈判项：8 处清除、两变异方向各有确定性红灯、T7a 补下界 | **A1**：§8.1 定稿文案改 `occupied` + 钉位 regex `/reclaim claim .* occupied by a live pid .*\(pid reuse caveat/` + 文案不相交硬约束（规范性）+ T7a⑥ 钉位；§11 ALLOW T7a 行与 deployment doc 症状句引文（`still occupied by a live pid`）同步；§12 E9a① 同步。**A2**：§11 ALLOW T7a 行 + §12 E9a——断言七件（新增 ②′ 下界 `elapsed ≥ 5000ms`（同一 `performance.now` 包夹，规格保证成立）与 ⑥ `not.toMatch(/held\|unsupported/)`）。**A3**：§11 ALLOW 新测试行 + §12 E9d/T7c——外部 instanceId + 自身活 pid，nonce A ≈2600ms → 「写 staging + rename 原子换名」nonce B ≈2600ms → unlink 退出（单段 <5000ms、合计 ≈5200ms >5000ms）⇒ 获取必须成功；M1/M2 均转红；O-10 原子换名（禁 unlink+write 空窗）+ 进入同步 acquire 前先确认 nonce A 在场（防「门未挂上即获取」退化）。**A4**：8 处改写——§7 D6-验收、§8.3-10、§10 fixture 行、§10 压力契约行、§11 DENY 压力契约行、§12 E1 行、§12 E9c 行、§13 R5 处置列——证据链统一为「确定性守卫（T7a②′/⑥ + T7c）+ 概率性兜底（两冻结契约 regex，Option A 后真实敏感）」。另按 SA2 验收条款增 §12 实现期变异自检义务 | **落实**：机制本体（D1/D1′/D2/D3/D4/D6）零改动（SA2 §7 重放正面结论保留）；修订面 = 尚未实现的文案措辞 + 新测试断言 + 引文同步 + 设计文本；无「契约转红」式失实论证残留（本轮 grep 复核）；M1 有 T7a②′/⑥ + T7c 三处红灯、M2 有 T7c 红灯 |
| #13 R8-② suspend 与 `performance.now()` 关系方向写反（Linux `uv_hrtime` = `CLOCK_MONOTONIC` 不含 suspend——挂起使墙钟变长、单调计量不变，触发更晚而非提前；I3 不受影响） | MINOR | R8-② 如实改写；§11 运维句可选注明墙钟可能长于 5000ms | §13 R8-②（单调计量不含 suspend；墙钟可能长于 5000ms；原文表述已按实现方向改正）；§11 deployment doc 行（#13 注明句） | **落实**：文字级，无行为修订；P10 引用本身无误（维持） |

**iteration-5 范围遵从**：SA2 iteration-3 §0/§16 明示「机制本体不许借机重开」——本修订对 D1/D1′/
D2/D3/D4 与 D6 机制（计账单位/有界等待/重置语义/不夺门/预算值）零改动，§7 伪代码不变；全部修订
落点 = §8.1 文案措辞与硬约束、§11/§12 测试断言与引文、§8.3-10/§10/§13 文本改写——均在既有
ALLOW 四行内（SA2 §10 同判：无 ALLOW/DENY 扩界）。**SA2 非阻断观察处置**：O-9（Option A 后两冻结
契约对「合法持有者被调度饥饿 >5s」极端形态真实转红——可见优于隐匿，属守卫语义；若 CI 实测出现，
按 R8-① 口径处置，预算变更须回炉 SA8）登记于 §12 E1/R8；O-10（T7c 原子换名，禁 unlink+write
空窗）已写入 §11/§12 T7c 规格；O-11/O-12 维持原处置。

## 16. 是否需要设计后 ADR 冲突复查

**不需要（`requiresConflictRecheck = false`）**，理由：

1. **iteration 4 的保守复查已闭环**：iteration 4 设计曾因 D6 新失败语义（claimStuck 错误输出 +
   claim-blocked 终止态 + 5000ms 预算）自判 `requiresConflictRecheck = true` 并提交回炉——SA8
   iteration 4 报告裁决 **clear**（H1-H8：自由面、方向收紧、范围遵从、重触发条款逐项未触），
   `requiresConflictRecheck: false` 收档。该裁决对未被本轮触碰的机制面继续有效。
2. **本轮（iteration 5）修订面逐项对照 SA8 iteration 4 关门重触发条款，均未触发**：无 fsync
   （R6 维持）；不触 `packages/**` 与 ADR-0006 冻结布局（T7c 助手为测试内联 `node -e`，不新增
   文件、不触生产名族）；无新增公共导出、不把 claimStuck 纳入 `STABLE_OP_ERROR_CODES`（§8.1
   维持 plain Error）；无 CONTEXT.md 域词（`occupied` 措辞为模块私有文案，根锁词族不在共享词表）；
   ALLOW/DENY 面零扩界（修订全部落在既有四行内——SA2 §10 同判）；5000ms 不变、不进配置面。
3. **修订路径本身已被 SA8 预裁**：SA8 iteration 4 B4′ 对 O4（误触发守卫失实）预裁了「改
   claimStuck 定稿文案避开 `held` 子串（须同步改 T7a regex 与 §8.1）」的修订路径，并明示该路径
   无需回炉；SA2 iteration-3 #12 Option A 即沿该路径落实。§11 两文档行内的引文同步属 H6/G7/B3
   已预裁的「同变更集文档同步」面。
4. 机制本体（D1/D1′/D2/D3/D4/D6）未被本轮改动——SA8 iteration 4 对 D6 失败语义面的 H1/H2/H5
   裁决与对既有机制的 G1-G8 裁决继续有效，无需重开。
