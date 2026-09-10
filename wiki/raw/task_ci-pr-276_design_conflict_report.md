# SA8 冲突门禁报告 — CI repair：PR #276 根锁 stale 回收双活竞态（设计后冲突复审）

> Phase：conflict-gate（iteration 2）。Dispatch：`sa-e6067861-2e01-4b9b-ae21-0475c4c7262e`（mabf-sa8）。
> 被审对象：`wiki/raw/task_ci-pr-276_design.md`（SA1 design，327 行，iteration 1）——D1「staging
> 目录完整构建 + 原子 rename 发布」获取臂重构，影响文件系统发布语义。
> Issue/PR 评论 REST 读取为 `[]`（与派发注记一致）——无 Owner 追加要求可映射，无评论级冲突输入。

- **冲突基准（唯一）**：`docs/adr/` 全集 14 文件（0001–0012、0014–0015；无 0013）+ 根 `CONTEXT.md`
  （173 行全文亲读）。`docs/AGENTS.md` Authority 节用于确立基准层级（ADR = 架构决策记录、
  CONTEXT.md = 共享词表；`wiki/raw/` 为证据非契约）。代码与 wiki 文档不构成自动阻塞依据。
- **触发原因**：设计 §6/§15 自判 `requiresConflictRecheck: true`（本轮前置门禁产物缺失）+
  修订两处既有文档化机制决策措辞（`docs/integration/hub-peer-deployment.md` §锁文件与共享
  root、`apps/yjs-server/AGENTS.md` 边界句）+ 派发明示「影响文件系统发布语义」。
- **独立核验方式**（SA8 不采信设计单方陈述，以下均本轮亲证）：
  - `grep -rniE "root.?lock|nomicore-lock|根锁|staging|rename" docs/adr/` → 根锁词族**零命中**
    （14 文件全量）；rename/staging 命中仅 ADR-0006（snapshot temp→rename）、ADR-0014
    （current.json temp+rename、JSONL rename `.deleting`）、ADR-0010 L183/L291（snapshot
    temp→rename 借鉴清单 / 归档 rename 提交点）——全部属 `packages/persistence`、
    `packages/namespace-diagnostic-log` 领地，无一管辖 `apps/yjs-server` 根锁。
  - `grep -niE "root.?lock|nomicore-lock|根锁|staging|rename|原子|mkdir|双活|owner" CONTEXT.md`
    → 根锁/发布机制词族零命中（命中仅为实例身份/namespaceId 词条，与根锁无关）。
  - ADR 状态核对：全部 `accepted`；ADR-0007 仅「Runtime/open/read 条款由 ADR 0008 部分取代」，
    与根锁无关；**无被 superseded 的 ADR 落在被审面上**。
  - `docs/protocols/instance-replication-v1.md` grep 根锁零命中（停机协议不引用锁实现）。
  - 设计 B 系锚点逐条亲读源码复核（HEAD `334494d`，branch `mabf/issue-266`，与设计/SA6
    声明的 CI 失败 head 一致）：`apps/yjs-server/src/lifecycle.ts` L20-22（常量/owner.json
    payload）、L105-108（mkdir 线性化点头注）、L122-137（获取臂 mkdir→wx→镜像→break；rm 臂）、
    L139-195（争用臂 readOwner→heldError→reap-claim→复读守卫→rename 墓碑→比对→rm→回环）、
    L198-232（守护式 release）；`src/index.ts` L70 导出面。
  - **历史钩子排查**：`grep -rn "RootLockAcquireHooks|beforeStaleReclaimDecision" apps/` →
    **零命中**——issue #191 时代的测试钩子 seam 在 HEAD 已不存在，当前公共面即两参
    `acquireRootLock(rootDir, instanceId)`；设计「签名/导出零变化」与「拒绝生产测试钩子
    （SA6 §15）」不撤销任何现存公共面。
  - 契约文件在场性：`apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts`（canary）、
    `root-lock-stale-reclaim-race-stress.test.ts`（SA6 压力契约，头注自述以
    hub-peer-deployment.md §锁文件与共享 root 为规范锚）均在 HEAD 工作树。
  - `docs/integration/hub-peer-deployment.md` L232-250（§锁文件与共享 root）与
    `apps/yjs-server/AGENTS.md` L36-39 边界句原文亲读：安全不变量清单（单活 owner、共享活跃
    root unsupported、pid 死=可回收、镜像非 token、EACCES/EPERM loud、pid 复用人工确认）
    与设计 §6/§11 声明的保持面逐条对照。

## 裁决总表

| # | 冲突候选 | 基准条款 | 裁决 | 等级 |
|---|---|---|---|---|
| F1 | D1 改变根锁获取线性化点（mkdir → staging+原子 rename），是否触任何 ADR 冻结面 | ADR 全集 14 文件 | **无冲突**——无任何 ADR 管辖根锁（独立 grep 零命中；设计 B8 陈述属实） | — |
| F2 | staging 目录 + rename 发布是否与 ADR 级 temp→rename 原子提交模式族相抵触 | ADR-0006 §v1 布局/L52-55、ADR-0014 L44、ADR-0010 L183/L291 | **无冲突（正向一致）**——D1 沿用仓库既立模式：暂存名永不作提交态（I1：canonical 出现即完整，镜像 ADR-0006「tmp 永不提交」）、rename 成功即提交点（I2，镜像「rename 成功即完成一次 flush」）、不新增 fsync 承诺（R6，镜像 ADR-0006「不承诺掉电级持久性」纪律）。目录级 rename-onto-empty-target 的 CAS 语义是新模式位，无 ADR 管辖 ⇒ 自由面 | — |
| F3 | 新增 rootDir 顶层瞬态名 `.nomicore-lock.acquire-<uuid>` 是否违反 ADR-0006 冻结磁盘布局 / `.tmp` 忽略删除规则 | ADR-0006 L43-52、L215 | **无冲突**——ADR-0006 布局冻结的是 `{rootDir}/users/{userId}/{namespaceId}.snapshot` 与 `{rootDir}/archive/users/...`（persistence adapter 领地）；`.tmp` 忽略删除规则作用于用户目录内快照 tmp。staging 在顶层、app 层所有、命名族与既有 `.nomicore-lock.reap-*`/`.release-<uuid>`/`.reap-claim` 同族不碰撞；`packages/persistence` 零改动（DENY LIST 锚定，与部署文档「adapter 只触 users/、archive/users/ 受控子树」一致） | — |
| F4 | 是否引入/变更 CONTEXT.md 域词而未更新词表 | CONTEXT.md 全文 + docs/AGENTS.md Editing 节 | **无冲突**——CONTEXT.md 无根锁词条；staging 前缀为模块私有不导出（设计 §8.1），不构成跨域共享词表术语，「引入域词须更新 CONTEXT.md」义务未触发 | — |
| F5 | 修订两处**既有文档化机制决策**措辞（deployment guide 获取/回收机制句、yjs-server AGENTS.md 边界句）是否构成权威决策冲突 | docs/AGENTS.md Authority/Editing 节；两文档原文 | **无冲突（合规文档同步）**——两文件均非 ADR/CONTEXT.md，不属自动阻塞基准；docs/AGENTS.md 明令「代码行为变化时必须更新每一份陈述该契约的规范文档」，设计 §11 ALLOW LIST 恰为此安排（同变更集落盘）。安全不变量六条（见核验方式末条）逐条保持并加强；仅机制描述句（线性化点措辞）随实现更新，无语义句被删减 | 低（登记备案） |
| F6 | 拒绝生产测试钩子（SA6 §15 裁决）是否与既有公共面/既有决议冲突 | HEAD 源码 grep；ADR 全集 | **无冲突**——钩子 seam 在 HEAD 已不存在（#191 产物已被后续演进移除），拒绝钩子不撤销任何现存导出；无 ADR 管辖该面 | — |
| N1 | 原子发布机制作为「持久架构决策」仅记录于 deployment guide + AGENTS.md，未立 ADR | docs/AGENTS.md「Record a durable architectural decision as an ADR」 | **非冲突、治理观察**——无既有 ADR 被静默矛盾（B8：根锁从未入 ADR；本次沿既例记于部署文档层，与 mkdir 机制的既有记录位置一致）。派发明示影响「文件系统发布语义」，实施轮可选择补一份轻量 ADR 或明示维持文档层记录（现状惯例）；归 owner/总控裁量，不阻塞 | 低（advisory） |
| O1 | 运维口径完备性：SIGKILL 中断获取遗留 `.nomicore-lock.acquire-*`（设计 R2 已记为运维清理项 + follow-up），deployment doc ALLOW 条目仅覆盖机制句 | 非基准（文档完备性） | **观察，移交 SA2**——若 §11 文档更新不同步提及新遗留类的清理口径，运维 runbook（pid 复用人工接管条）存在盲区；属设计完备性评审面，非权威决策冲突 | 观察 |
| O2 | `main.ts` L11 头注释仍称 `.nomicore-lock.json`（镜像文件）为「独占锁」——修复前即陈旧 | 非基准（代码注释） | **观察**——先在缺陷，非本设计引入；设计 DENY main.ts（语义零变化）合理，注释勘误可随实施轮顺手处理，不构成冲突 | 观察 |

## 关键裁决理由展开

### F1/F5（本门禁的主裁决面）

设计对冲突基准的唯一实质触碰是 F5：两份**规范文档的机制措辞修订**。SA8 裁定其不构成阻塞冲突，
依据三层：

1. **层级**：两文件均非 ADR、非 CONTEXT.md——按 docs/AGENTS.md Authority 节与 SA8 基准规则，
   不构成自动阻塞依据；且 docs/AGENTS.md 的 Editing 节恰恰**要求**这类文档随代码行为变化而
   更新（「documentation-only wording changes must not invent implementation behavior」反向
   同理：implementation changes must update stated contract）。设计不做「文档先行发明行为」，
   而是行为与文档同变更集对齐（ALLOW LIST 含两文件）。
2. **不变量保持**：被审修订仅动「获取线性化点」的机制描述（mkdir 排他 → 完整 staging 目录
   原子 rename 发布）；六条安全不变量（单活 owner、共享活跃 root 拒绝、pid 死可回收、镜像
   非 token、EACCES/EPERM loud、pid 复用人工确认）逐条对照两文档原文确认全部保持，且
   I1/I2/I3（§7）是对「单活 owner」的**加强**而非重定义——旧文档句「同 root 活跃 owner 唯一、
   运行期不重叠」（S7 所引不变量）正是被修复缺陷击穿、被 D1 恢复的契约。
3. **无隐性决策冲突**：ADR 全集独立 grep 证实设计 B8 陈述属实——根锁机制从未进入任何 ADR，
   故不存在「静默矛盾既有 ADR」；对 ADR 模式族（F2/F3）为正向一致而非偏离。

### 边界条件（移交下游验证，非冲突）

| # | 内容 | 移交对象 |
|---|---|---|
| B1 | ALLOW LIST 两文档的措辞修订必须与 `lifecycle.ts` 实施同变更集落地（防规范面与实现漂移——正是 S7 教训） | SA3/SA4 |
| B2 | POSIX `rename(dir→空 dir)` 替换语义（R1）为 D1 根基——Windows EPERM 降级 loud 的收敛性需 §12 E5 用例钉位；此为平台边界声明，基准无 ADR 强制跨平台语义 | SA2/SA6 |
| B3 | staging 残留（R2）与 O1 运维口径：若 SA2 裁定 deployment doc 需补遗留类清理句，属 §11 ALLOW 面内扩句，不触发新一轮冲突门禁（仍不触 ADR/CONTEXT.md） | SA2 |
| B4 | N1 治理选择（是否补轻量 ADR）——若总控裁定立 ADR，属新增决策记录，与现有全集无矛盾面 | 总控/owner |

## 结论

- **verdict：clear**（无阻塞冲突）。
- 分布：冲突候选 9 项 = 阻塞 0 / 无冲突裁决 6（F1-F6，其中 F2/F3 为正向一致佐证）/ 低级
  advisory 1（N1，治理记录位置选择，归 owner/总控裁量）/ 观察 2（O1、O2，移交 SA2，非基准面）。
- 设计自设的 `requiresConflictRecheck: true`（因前置门禁产物缺失）由本报告补位闭环：**本轮
  复审后无需再次冲突复查**（`requiresConflictRecheck: false`）——被审面不触任何 ADR 冻结面
  与 CONTEXT.md 词表。重新触发条件：SA2 评审修订若改变 D1 机制本体（如引入 fsync 承诺、
  改动 packages/persistence、新增公共导出/生产钩子）或 ALLOW/DENY 面扩界，须回炉 SA8。
- 设计质量（状态机完备性、R1 平台风险、E1-E7 验收充分性）不属 SA8 裁权，留 SA2 全维度评审。

## 证据清单

| 证据 | 位置 |
|---|---|
| 被审设计 | `wiki/raw/task_ci-pr-276_design.md`（iteration 1，327 行） |
| 上游 SA6 契约/证据 | `wiki/raw/task_ci-pr-276_sa6_contract.md`、`_sa6_ci-fail.log`、`_sa6_red.log`、`_sa6_stress-red.log`、`_rootlock-race-driver.mjs` |
| 冲突基准 | `docs/adr/`（14 文件）、`CONTEXT.md`（173 行）、`docs/AGENTS.md`（Authority/Editing 节） |
| 亲读规范面 | `docs/integration/hub-peer-deployment.md` L225-250（§锁文件与共享 root）、`apps/yjs-server/AGENTS.md`（Boundaries） |
| 亲读代码锚 | `apps/yjs-server/src/lifecycle.ts`（L20-22/L105-108/L122-232 全臂）、`src/index.ts` L70、`src/main.ts` L11/L132/L193（消费面） |
| 契约测试在场 | `apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts`、`root-lock-stale-reclaim-race-stress.test.ts`、`test/fixtures/root-lock-worker.ts` |
| HEAD 同一性 | `git log -1` = `334494d`（branch `mabf/issue-266`）＝设计/SA6 声明的 CI 失败 head |
