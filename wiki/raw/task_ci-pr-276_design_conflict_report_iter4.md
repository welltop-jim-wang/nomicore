# SA8 冲突门禁报告 — CI repair：PR #276 根锁 stale 回收双活竞态（设计后冲突复审，iteration 4）

> Phase：conflict-gate（iteration 4）。Dispatch：`sa-63a22f99-333c-4494-912b-7cd5f9cafcae`（mabf-sa8）。
> 被审对象：`wiki/raw/task_ci-pr-276_design.md`（SA1 design 修订版，736 行，iteration 4 原位修订）——
> 响应 SA2 iteration-2 verdict reject 的 **#8 MAJOR**（claim 门 pid 复用/冻结持有者形态 = 同步无界
> 静默自旋、watchdog 免疫、R2/R4/R5 风险登记失实）与 #9/#10/#11 MINOR，并落实迭代 4 派发指令
> （claim 门有界/liveness-safe）。修订新增面：**D6 claim 门活性预算**（`ROOT_LOCK_CLAIM_WAIT_LIMIT_MS
> = 5_000`，同内容占用计账 + 更替重置 + `claimStuckError` loud 中止 + 绝不夺门）、claiming 态新终止
> 态 `claim-blocked`、新不变量 **I3**（liveness）、§12 E9a/E9b/E9c（T7a/T7b 可执行验收）、§13 R2/R4/R5
> 如实改写 + R8 新增、§11 两文档扩句（门等待有界句 + claim 卡死症状→处置句）；#9 墓碑名立法
> （`.nomicore-lock.reap-claim.reaped-<uuid>`）、#10 canonical 删除原语作用域限定、#11 清障 errno 契约。
> D1/D1′/D2/D3/D4 机制结构未动（设计 §15 自述 + 本轮对照核证）。
> Issue/PR 评论 REST 读取为 `[]`（与派发注记一致）——无 Owner 追加要求可映射，无评论级冲突输入。

- **冲突基准（唯一）**：`docs/adr/` 全集 14 文件（0001–0012、0014–0015；无 0013）+ 根 `CONTEXT.md`
  （173 行全文亲读，本轮重读）。`docs/AGENTS.md` Authority/Editing 节用于确立基准层级；代码与
  wiki 文档不构成自动阻塞依据。
- **触发原因（合法回炉）**：设计 §16 自判 `requiresConflictRecheck = true`——D6 为正确性承载组件
  （claim 门 = 防线一）引入**新失败语义**（新公共可观察错误输出 + claiming 新终止态 + 5000ms 等待
  预算），按 iteration 2 SA8「机制体变更保守回炉」先例与本仓「新增失败语义须复查」纪律提交。这正是
  iteration 2/3 报告重触发条款的合法触发，本轮即该复查。
- **独立核验方式**（SA8 不采信设计单方陈述，以下均本轮亲证，HEAD `334494d` / branch
  `mabf/issue-266`，与设计/SA6/SA2/SA8 前三轮声明的 CI 失败 head 同一性核对一致）：
  - `grep -rniE "root.?lock|nomicore-lock|根锁|rootlock|reap|staging" docs/adr/` → **零命中**
    （14 文件全量，第三轮独立重证）。D6 新词族追加排查：`grep -rniE "claim.?stuck|perf_hooks|
    performance\.now|watchdog|liveness|spin|自旋|wait.?limit|挂死|event.?loop" docs/adr/` → 唯一
    命中为 ADR-0010 L298/L380 的 **liveness**，指 WebSocket transport 停 liveness 编排
    （§18 detach-close 单点）——与根锁 claim 门活性预算**不同子系统、无管辖、无碰撞**。
  - `grep -rniE "root.?lock|nomicore-lock|根锁|reap|staging|claim|watchdog|liveness|自旋|挂死"
    CONTEXT.md` → 根锁词族零命中（命中仅为方言 loud-fail 与变更尝试 failed 结局词条，均无关）。
    D6 未引入须登记的共享域词（H3）。
  - ADR 状态核对：全部 accepted；ADR-0007「Runtime/open/read 条款由 ADR 0008 部分取代」与
    ADR-0003 吸收同号草稿均为 VFSL/Runtime 面，与根锁无关；**无被 superseded 的 ADR 落在被审面上**。
  - **代码锚点逐条亲读**（本轮全文亲读 `apps/yjs-server/src/lifecycle.ts` 252 行）：
    - B1-B7 属实：常量 L20-22；`isPidAlive` L49-57（`process.kill(pid,0)`，EPERM ⇒ 活——pid 复用必
      误活、方向安全）；`loudUnwritable` L59-63 与 `heldError` L65-74 **两族文案逐字**与设计 §8.1
      引用一致；`readOwner` L76-82 catch-all → `''`；成功臂 L122-137；争用/回收臂 L139-195
      （claim EEXIST 活 ⇒ L155 `continue` = 旧形态同步无界自旋，**仅在争用臂**——B11 属实）；release
      L198-232。
    - `STABLE_OP_ERROR_CODES` L236-251 亲读：为 NDJSON 控制通道 op 码表，与根锁 boot 错误无交集；
      `claimStuckError` 设计为无 code 字段的 plain `Error`（与 `heldError`/`loudUnwritable` 同款），
      不触碰该冻结感列表。
    - `main.ts` 亲读：L30 `STOP_WATCHDOG_MS = 60_000`；L100-105 reload watchdog = `setTimeout`
      宏任务（L105 `unref()`）；boot L191-197 与 reload L130-135 两处 `acquireRootLock` 调用 catch
      均**通用**（stderr / `failBoot` → `exit(1)`）——对任何 thrown Error 一视同仁，D6 无需调用方
      改动属实；L210-212 SIGTERM/SIGINT/SIGHUP 处理器均事件循环回调——B12「同步自旋期间
      watchdog/信号全部无法触发」的 Node 语义成立。
    - `src/index.ts` 导出面亲读：`export { acquireRootLock, createStdoutEventSink,
      ROOT_LOCK_FILE_NAME, STABLE_OP_ERROR_CODES }` + `export type { EventSink, RootLockHandle }`
      ——设计「签名/导出零变化、新常量/构造器/import 模块私有」属实。
    - **两契约钉位断言亲读**：canary L77 `/held by the same instance.*pid reuse caveat/`、L78/L121
      `/shared file persistence root is unsupported/` 与 `/unsupported/`、L104-107（恰 1 acquired +
      败者 `/held|unsupported/`）；stress L125-127/L165-168（同款单 owner 不变量 + 败者 regex）；
      fixture `root-lock-worker.ts`（真进程单消息协议）。两契约均**不构造活占 claim 形态**
      （文件内无 `reap-claim` 预置）——claimStuck 路径不被既有契约触达，与设计 §10 走查声明一致。
    - **packages 可见性复核**（#9 新名）：`packages/persistence/src/file.ts` L229/L244 仅 join
      `users/`、`archive/users/` 受控子树；`packages/namespace-diagnostic-log` 全部 `readdirSync`
      仅作用于 streamsDir（reader.ts L380、adapters/file.ts L276/L1006/L1636）——无任何生产代码
      枚举 rootDir 顶层，新墓碑名对 packages 不可见。
    - ADR-0006 亲读（claim/布局/tmp/rename/fsync 词族）：claim = DocStore 内存 per-key cell 排他
      状态机（L123/L211/L238，含 `'deleting'` 态）；冻结布局 = `users/`、`archive/users/` 子树内
      `.snapshot` + `.tmp`（「tmp 永不提交」「rename 成功即完成一次 flush」「不新增 fsync」）——
      全部 persistence 领地，与根锁文件门不同子系统（iteration 3 G2/G3 结论 firsthand 复证）。
    - 文档同步面亲读：`docs/integration/hub-peer-deployment.md` §锁文件与共享 root（L232-250 六条
      不变量原文）与 `apps/yjs-server/AGENTS.md` Boundaries 末条（排他 `mkdir` 取得权威目录）——
      与设计 §11 修订面逐条对照；**L250 pid 复用句亲证只覆盖 `.nomicore-lock/`**，不覆盖
      `.reap-claim` 形态——设计 B9 与 §11「注明 L250 句不覆盖本形态」的表述准确。
    - `main.ts` L11 头注仍称镜像文件为「独占锁」（O2 先在缺陷在场，属实）。

## 裁决总表（iteration 4 复审面：D6 失败语义 + MINOR 三项 + 既有机制面保持核证）

| # | 冲突候选（iteration 4 新增/触及面） | 基准条款 | 裁决 | 等级 |
|---|---|---|---|---|
| H1 | **`claimStuckError` 作为 `acquireRootLock` 新增公共可观察错误输出**（§8.1 定稿文案 + regex 钉位）是否与任何基准或已钉位契约冲突 | ADR 全集；CONTEXT.md；canary/stress 断言 | **无冲突**——无 ADR/CONTEXT.md 管辖根锁错误面（本轮 grep 零命中，含 claim.?stuck/watchdog/liveness 新词族）；`STABLE_OP_ERROR_CODES`（亲读）是控制通道 op 码表、不被触碰；无 code 字段的 plain Error 与既有三族同款；该路径在 iteration 3 设计中为缺陷形态（无界挂死）、在旧代码不存在（干净 root 不触 claim，B11 亲证），canary/stress 均不构造活占 claim（本轮亲证）——无任何已钉位断言依赖其现状。两契约文件在 DENY LIST，未弱化 | — |
| H2 | **D6「绝不夺门」+ 有界等待**是否与 I0（发布者/回收者互斥）及 SA2 已证的 phantom 关闭矛盾 | 无基准条款（自由面）；iteration 3 G1/G4 结论面 | **无冲突，方向为收紧**——超时中止不删/不移/不覆写他人 claim、不触 canonical；等待者退出方式变更不削弱持有者互斥（设计 §7 防线一论证 + 备选 9 否决理由与 A2 phantom 窗口分析同向）；「canonical 永不承受 rmSync(recursive)」作用域限定（#10）与显式 errno 契约（#11）均为收紧/完备化，与仓库 fail-loud 纪律同向（G4 结论在修订面上继续成立） | — |
| H3 | 模块私有 `ROOT_LOCK_CLAIM_WAIT_LIMIT_MS = 5_000`、`claimStuckError` 构造器、`import { performance } from 'node:perf_hooks'` 是否构成公共导出/域词/依赖面变化 | `src/index.ts` 导出面；CONTEXT.md Editing 义务；apps/yjs-server AGENTS.md「Consume only package public exports」 | **无冲突**——全部模块私有不导出（index.ts 导出面本轮亲证未变）；`node:perf_hooks` 是 Node 内建（与既有 `node:crypto`/`node:fs`/`node:path` 同类），非 package-internal 子路径；根锁词族不属 CONTEXT.md 共享词表（G6 结论延续）——「引入域词须更新 CONTEXT.md」义务未触发 | — |
| H4 | **#9 立法的 claim 接管墓碑名 `.nomicore-lock.reap-claim.reaped-<uuid>`** 是否触 ADR-0006 冻结布局 / packages 可见性 | ADR-0006 v1 布局节 | **无冲突**——冻结面 = `users/`、`archive/users/` 子树内快照与 `.tmp`；新名在 rootDir 顶层、app 层所有、永不作提交态（与 staging/claim-staging 同款「temp→原子挂名」模式族）；本轮独立复核 persistence/namespace-diagnostic-log 均不枚举顶层；与既有 `.reap-*`/`.release-*` 名族同前缀不碰撞；五处清单一致（§8.1/R2/§11/伪代码/T5） | — |
| H5 | **claiming 新终止态 `claim-blocked` + 不变量 I3（liveness）** 是否与任何状态机契约冲突 | ADR 全集（无根锁管辖）；两契约行为面 | **无冲突**——无基准管辖获取内部状态机；I3 是对既有「无出口空转」缺陷形态（SA2 #8）的结构封堵，与 I0/I1/I2 同向收紧；E9a 五件断言（文案/墙钟上界/claim 字节不变/canonical 未创建/无 staging 残留）为行为级钉位，不依赖生产钩子（SA6 §15 裁决「不引入钩子」维持） | — |
| H6 | **§11 两文档扩句**（deployment doc：门等待有界句 + 症状→处置句 + 名族清理口径含 #9 新名 + L250 句不覆盖注记；AGENTS.md：边界句改写含「门等待有界」）是否构成权威决策冲突或越出 G7/B3 预裁面 | docs/AGENTS.md Authority/Editing 节；两文档原文 | **无冲突（合规文档同步）**——两文件均非 ADR/CONTEXT.md，不属自动阻塞基准；docs/AGENTS.md 明令行为变化时同变更集更新规范文档，§11 恰为此安排；六条安全不变量逐条亲读对照**全部保持且纯增不删**（L250 原句保留 + 新句注明其不覆盖 claim 形态）；iter-3 G7/B3 已预裁「同款扩句不触发新门禁」，本轮扩句属同款 | 低（登记备案） |
| H7 | **iter-3 收窄重触发条款逐项对照**：fsync / packages 与 ADR-0006 冻结布局 / 公共导出与生产钩子 / CONTEXT.md 域词 / ALLOW-DENY 扩界 | iteration 3 SA8 报告重触发条款 | **逐项未触**——无 fsync（R6 维持；`performance.now()` 是时钟读取非持久化原语）；`packages/**` 零触碰且在 DENY；无新增导出/生产测试钩子（H3 核证）；无域词（H3）；ALLOW 仍为同一文件四项（lifecycle.ts / 新测试文件 / 两文档）、DENY 未松动——**范围遵从**：D6 是迭代 4 派发指令明令的新增面，全部落在既有 ALLOW 行内，未扩界 | — |
| H8 | **新增验收面 E9a/E9b/E9c（T7a/T7b）与 §14 P10** 是否触测试装置契约或 CI 机制 | vitest 装置；CI 分片机制（非基准，核证面） | **无冲突**——新用例落在新文件 `root-lock-atomic-publication.test.ts`（ALLOW 项），被 `vitest.config.ts` include `apps/*/test/**/*.test.ts` 与 `scripts/ci-test-shard.mjs` 磁盘枚举自动收录（iter-3 已核证 walk 逻辑，本轮文件清单复核装置未变）；两契约文件与 fixture、CI 装置均在 DENY；无跳过/禁用/弱化任何测试；P10 为运行时契约引用（Node 文档），不触基准 | — |
| N1″ | claim 门失败语义（claimStuck + 5000ms 预算 + 人工恢复口径）成为**运维契约的一部分**后仍仅记录于 deployment doc + AGENTS.md，未立 ADR | docs/AGENTS.md「Record a durable architectural decision as an ADR」 | **非冲突、治理观察（权重继续上升）**——无既有 ADR 被静默矛盾（根锁从未入 ADR）；但 D6 使该机制从「正确性承载」（iter-3 N1′）进一步升为「正确性 + 活性双承载 + 运维恢复契约」，轻量 ADR 的裁量价值随之上升。仍归 owner/总控，不阻塞 | 低（advisory） |
| **O4（新）** | 设计 §8.3-10 / §12 E9c 声称「若预算在合法竞速中误发，败者消息将**不再匹配** `/held\|unsupported/` ⇒ 压力契约/canary 转红——E1 兼任误触发守卫」——**该守卫论证与 claimStuck 定稿文案不符** | 非基准（设计内部验证论证精确性） | **观察（移交 SA2/SA4）**——本轮亲证：canary L107 与 stress L127/L168 的败者 regex `/held\|unsupported/` 为**子串匹配**，而 §8.1 定稿文案含「is still **held** by a live pid」——若 D6 在合法竞速中误发 claimStuck，败者消息**仍会匹配**该 regex，两契约**不会转红**，「E1 兼任误触发守卫」不成立（E9c 后半句失实）。这不触任何 ADR/CONTEXT.md 条款、未弱化任何契约、不阻塞门禁（设计质量与验证论证属 SA2 裁权）；但 **SA4 不得以 E1 转红作为 D6 误触发的检测手段**——误触发检测应以 T7a 直接钉位 + 实现评审承担；SA2 重审时应核改 §8.3-10/E9c 表述或改定稿文案避开 `held` 子串（二选一，属设计裁量） | 观察 |
| O2（沿） | `main.ts` L11 头注仍称 `.nomicore-lock.json` 为「独占锁」——先在缺陷（本轮亲证在场） | 非基准（代码注释） | **观察**——设计 DENY main.ts（语义零变化）合理，注释勘误留实施轮可选，不构成冲突 | 观察 |

## 关键裁决理由展开

### H1/H2/H5（本门禁的主裁决面：新失败语义落在自由面且方向为收紧）

iteration 4 回炉的核心问题是：正确性承载组件上**新增失败语义**（新错误输出、新终止态、等待预算）
是否撞上权威决策或既有契约。裁决为否，依据三层：

1. **管辖缺席（第三轮独立重证）**：根锁词族 + D6 新词族（claimStuck / watchdog / liveness /
   perf_hooks / wait limit / 挂死）在 ADR 全集与 CONTEXT.md 零有效命中（ADR-0010 liveness 为
   WebSocket transport 编排，不同子系统）。「无 ADR 管辖」是关于决策面的事实，不因设计在自由面上
   演进失效。
2. **契约面无损（本轮逐 regex 亲证）**：canary/stress 的全部钉位断言逐一核对——三族既有文案
   逐字保留；两契约不构造活占 claim 形态，claimStuck 路径不被触达；DENY LIST 完整覆盖两契约 +
   fixture + CI 装置；「不跳过/不禁用/不弱化任何测试」的派发要求在 ALLOW/DENY 结构上成立。
3. **方向收紧**：D6 的四个组成（有界/loud/重置/不夺门）全部为「消除无出口路径」而非「放宽互斥」；
   #10/#11 是对既有 loud 纪律的完备化重申。与 G4「fail-loud 同向」结论一致。

### H7（重触发条款闭环）

iteration 3 报告的重触发五条款（fsync / packages+冻结布局 / 公共导出+钩子 / CONTEXT.md 域词 /
ALLOW-DENY 扩界）逐项对照均未触发；iteration 4 的唯一新增面（D6）是派发指令明令且落在既有 ALLOW
行内。设计 §16 自判的保守回炉由本报告闭环。

## 边界条件（移交下游验证，非冲突）

| # | 内容 | 移交对象 |
|---|---|---|
| B1″（沿） | §11 两文档的全部扩句（含门等待有界句、症状→处置句、名族清理口径、L250 不覆盖注记）必须与 `lifecycle.ts` 实施**同变更集**落地（防规范面与实现漂移——S7 教训） | SA3/SA4 |
| B2″（沿） | §14 协议假设的 SA1 探针脚本位于 `/tmp`（沙箱外一次性产物）——SA4 须按 §14 内联要点重跑对拍；P10（单调时钟/判活）为运行时契约引用，无需探针，但 SA4 应核证 `performance` import 的使用形态与 §7 伪代码一致 | SA4 |
| B3″（沿） | O3 引述精确性：R7 不得将「该假设句已在文档中」当作可定位锚点（本轮核证设计 §13 R7 已改为不作在场性引述——落实确认）；若实施轮需显式混版本边界句走 §11 扩句 | SA4/SA7 |
| **B4′（新）** | **O4 误触发守卫失实**：SA4/SA7 验收时**不得依赖 E1/canary 转红来检测 D6 误触发**（claimStuck 文案含 `held` 子串，败者 regex 仍匹配）；D6 无误触发的证据责任在 T7a 直接钉位 + 压力契约多轮复跑的行为观察 + 实现评审。SA2 重审应裁决：改 §8.3-10/E9c 表述，或改 claimStuck 定稿文案避开 `held` 子串（若改文案，须同步改 T7a regex 与 §8.1） | SA2/SA4/SA7 |

## 结论

- **verdict：clear**（无阻塞冲突）。
- 分布：冲突候选 10 项 = 阻塞 0 / 无冲突裁决 8（H1-H8：H1/H2/H5 为新失败语义主裁决面、H3/H4 为
  私有面与名族核证、H6 文档同步、H7 重触发条款闭环、H8 验收装置）/ 低级 advisory 1（N1″，治理
  记录位置，权重继续上升仍归 owner/总控）/ 观察 2（**O4 新**——E1 兼任误触发守卫的论证与定稿文案
  不符，移交 SA2/SA4；O2 沿）。
- **`requiresConflictRecheck: false`（本轮复审后）**：设计 §16 触发的回炉义务由本报告闭环。被审
  修订面（D6 活性预算、claimStuck、#9/#10/#11、§11 扩句、E9 验收）不触任何 ADR 冻结面与
  CONTEXT.md 词表，不越派发授权面，不弱化任何契约。重新触发条件（沿 iteration 3 条款重申并增补
  D6 面）：后续修订若引入 fsync 承诺、触碰 `packages/**` 或 ADR-0006 冻结布局、**新增公共导出或
  把 claimStuck 纳入 `STABLE_OP_ERROR_CODES` 等稳定码表**、引入或改写 CONTEXT.md 域词、ALLOW/DENY
  面扩界、或**把 5000ms 预算变为配置面/环境变量**——须再次回炉 SA8。
- 设计质量（D6 计账正确性、无误触发分析、E9 验收充分性、§8.3-9/-10 重放完备性）不属 SA8 裁权，
  留 SA2 重审与 SA4/SA7 验证；O4 是其中须 SA2 正视的验证论证失实点。

## 证据清单

| 证据 | 位置 |
|---|---|
| 被审设计（修订版） | `wiki/raw/task_ci-pr-276_design.md`（iteration 4，736 行） |
| 上游评审 | `wiki/raw/task_ci-pr-276_sa2_review.md`（iteration 2 verdict reject：#8 MAJOR + #9/#10/#11 MINOR） |
| 上游 SA8（iteration 2/3） | `wiki/raw/task_ci-pr-276_design_conflict_report.md`（clear，F1-F6/N1/O1/O2 + 重触发条款）、`wiki/raw/task_ci-pr-276_design_conflict_report_iter3.md`（clear，G1-G8/N1′/O2/O3 + 收窄重触发条款） |
| 上游 SA6 契约/证据 | `wiki/raw/task_ci-pr-276_sa6_contract.md`、`_sa6_ci-fail.log`、`_sa6_red.log`、`_sa6_stress-red.log`、`_rootlock-race-driver.mjs` |
| 冲突基准 | `docs/adr/`（14 文件，根锁词族 + D6 新词族 grep 零有效命中；ADR-0010 liveness = WS transport 编排）、`CONTEXT.md`（173 行全文）、`docs/AGENTS.md`（Authority/Editing 节） |
| 亲读规范面 | `docs/integration/hub-peer-deployment.md` L232-250（六条不变量 + L250 pid 复用句覆盖范围亲证）、`apps/yjs-server/AGENTS.md`（Boundaries 末条）、`apps/AGENTS.md`（composition root 边界） |
| 亲读代码锚 | `apps/yjs-server/src/lifecycle.ts`（252 行全文：L20-22/L49-63/L65-74/L76-82/L105-137/L139-195/L198-232/L236-251）、`src/index.ts`（导出面）、`src/main.ts`（L11/L30/L100-105/L125-145/L185-205/L210-212） |
| 契约断言亲证 | `apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts`（L77/L78/L104-107/L121）、`root-lock-stale-reclaim-race-stress.test.ts`（L125-127/L165-168）、`test/fixtures/root-lock-worker.ts` |
| packages 可见性核证 | `packages/persistence/src/file.ts` L229/L244（users/、archive/users/ 子树）、`packages/namespace-diagnostic-log/src/reader.ts` L380、`src/adapters/file.ts` L276/L1006/L1636（streamsDir readdir） |
| HEAD 同一性 | `git log -1` = `334494d`（branch `mabf/issue-266`）＝设计/SA6/SA2/SA8 前三轮声明的 CI 失败 head |
