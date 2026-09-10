# SA8 冲突门禁报告 — CI repair：PR #276 根锁 stale 回收双活竞态（设计后冲突复审，iteration 3）

> Phase：conflict-gate（iteration 3）。Dispatch：`sa-c3db4b13-4d6d-4442-a5b7-9fce84bc89b5`（mabf-sa8）。
> 被审对象：`wiki/raw/task_ci-pr-276_design.md`（SA1 design 修订版，595 行，iteration 3 原位修订）——
> 响应 SA2 reject（7 findings：1 CRITICAL + 3 MEDIUM + 3 LOW）引入的机制变更：**串行化 canonical
> 变更者**（`.nomicore-lock.reap-claim` 互斥门，link(2) 原子挂名 + rename-detach 单胜者接管）、
> **claim 门 + 证据门控阶梯**（`''` 证据按 canonical 形态分派：absent / empty-dir / stray-nondir /
> dir-empty-owner）、**ENOTDIR 并入 CAS 争用 errno 集**（杂散文件/符号链接恢复 parity）、
> **EPERM 只读探测分类 + Windows 能力矩阵如实化**（§13 R1 改写）。
> Issue/PR 评论 REST 读取为 `[]`（与派发注记一致）——无 Owner 追加要求可映射，无评论级冲突输入。

- **冲突基准（唯一）**：`docs/adr/` 全集 14 文件（0001–0012、0014–0015；无 0013）+ 根 `CONTEXT.md`
  （173 行全文亲读，本轮重读）。`docs/AGENTS.md` Authority/Editing 节用于确立基准层级（ADR =
  架构决策记录、CONTEXT.md = 共享词表；`wiki/raw/` 为证据非契约）。代码与 wiki 文档不构成自动
  阻塞依据。
- **触发原因（合法回炉）**：SA2 §5 明裁 `requiresConflictRecheck: true`——#1 修订改变 D1 机制
  本体（争用臂行为门槛 + claim 原子化 + 遗留清障原语 + CAS errno 集），超出 iteration 2 SA8
  结论中「仅措辞修订」的复审面；设计 §16 自判一致。这正落在 iteration 2 报告明示的重新触发
  条款（「机制体变更保守回炉」，例举非穷举）内。
- **独立核验方式**（SA8 不采信设计单方陈述，以下均本轮亲证，HEAD `334494d` / branch
  `mabf/issue-266`，与设计/SA6/SA2 声明的 CI 失败 head 同一性核对一致）：
  - `grep -rniE "root.?lock|nomicore-lock|根锁|rootlock|reap|staging" docs/adr/` → **零命中**
    （14 文件全量）。`grep -rniE "\block\b|mutex|exclusive|互斥" docs/adr/` 唯一命中为 ADR-0003
    L38（schema 联合方案语义，与根锁无关）。
  - `grep -rniE "root.?lock|nomicore-lock|根锁|rootlock|reap|staging|rename|mkdir|双活|owner" CONTEXT.md`
    → 根锁/发布/回收机制词族零命中（命中仅为实例身份/namespaceId 词条，与根锁无关）。
  - **「claim」词形排查**：ADR-0006 L123/L211/L238 的 claim 是 DocStore 内存 per-key cell 排他
    状态机（createDoc/importDoc/archiveDoc claim 环）——`packages/persistence` 领地、内存语义，
    与根锁 `.reap-claim` 文件门**不同子系统、无碰撞、无管辖**。
  - ADR 状态核对：全部 accepted；ADR-0007 仅「Runtime/open/read 条款由 ADR 0008 部分取代」
    （L4/L26/L44/L50 亲读），取代范围为 schema-aware 读取与 open 编排——与根锁无关；**无被
    superseded 的 ADR 落在被审面上**。
  - temp→rename 原子提交模式族基准亲读：ADR-0006 v1 布局节（`{rootDir}/users/{userId}/
    {namespaceId}.snapshot` 冻结面 + `.tmp`「可能半写入，只有 `.snapshot` 是提交态」+「rename
    成功即完成一次 flush」「不对每次 flush 做 fsync」）、ADR-0014 L44（current.json temp+rename）
    与 L291（JSONL rename `.deleting`）、ADR-0010 L291（归档 rename resolve = 提交点）——全部
    位于 `packages/persistence`、`packages/namespace-diagnostic-log` 领地。
  - **rootDir 顶层可见性独立复核**：`packages/persistence/src/file.ts` L229/L244 只 join
    `users/`、`archive/users/` 受控子树；`packages/namespace-diagnostic-log` 的 readdirSync 仅
    作用于 streamsDir（日志流目录）；`packages/vfsl*` 的 readdir 是仓库源码树 `domains/`，非运行
    时 rootDir——**无任何生产代码枚举 rootDir 顶层**，新瞬态名族对 packages 不可见。
  - `.nomicore-lock` 名族消费方全量枚举（ts/mjs/md，排除 wiki）：`lifecycle.ts`（canonical +
    `.reap-claim`/`.reap-<uuid>`/`.release-<uuid>`）、`main.ts`（镜像）、`apps/yjs-server/AGENTS.md`、
    `hub-peer-deployment.md`、5 个测试文件——无任何通用顶层名解析器；两契约测试断言均为
    定路径 existsSync（`.nomicore-lock` 在场/缺席），**无顶层枚举式断言**会被新瞬态名
    （`.acquire-<uuid>` / `.reap-claim.staging-<uuid>`）触碰。
  - 公共面核对：`src/index.ts` L70 导出 = `acquireRootLock, createStdoutEventSink,
    ROOT_LOCK_FILE_NAME, STABLE_OP_ERROR_CODES`；设计 §8.1 新增常量全为模块私有（不导出），
    签名/导出面零变化属实。`main.ts` L132（SIGHUP）/L193（file 模式）消费面属实。
  - 测试装置核对：`vitest.config.ts` `maxWorkers: 1`、include `apps/*/test/**/*.test.ts`；
    `scripts/ci-test-shard.mjs` 以磁盘枚举（packages/domains/apps 递归 walk）装箱——新测试文件
    `root-lock-atomic-publication.test.ts` 自动收录，成立。
  - 文档同步面亲读：`docs/integration/hub-peer-deployment.md` L232-250（§锁文件与共享 root）
    六条安全不变量原文（单活 owner / 共享活跃 root unsupported / pid 死可回收 + rename 墓碑 +
    mkdir 回环 / 镜像非 token / EACCES/EPERM loud / pid 复用人工确认）与
    `apps/yjs-server/AGENTS.md` Boundaries 末条（排他 mkdir 取得权威目录）——与设计 §11 声明的
    修订面逐条对照。
  - `main.ts` L11 头注仍称镜像文件为「独占锁」（O2 先在缺陷在本 HEAD 仍在场，属实）。

## 裁决总表

| # | 冲突候选（iteration 3 新机制面） | 基准条款 | 裁决 | 等级 |
|---|---|---|---|---|
| G1 | **claim 门串行化全部 canonical 变更者**（发布者与回收者互斥；claim 升级为正确性承载，防线一）是否触任何 ADR 冻结面 | ADR 全集 14 文件 | **无冲突**——无任何 ADR 管辖根锁/进程级文件互斥（本轮独立 grep 重证零命中，iteration 2 F1 结论在修订后机制上仍成立：机制体变更是「自由面上的变更」，不是「冻结面上的变更」） | — |
| G2 | **claim 原子化原语族**（link(2) 挂名、rename-detach 单胜者接管、内容校验释放）与 ADR-0006「claim」排他语义是否冲突 | ADR-0006 L123/L211/L238 | **无冲突**——ADR-0006 claim 是 DocStore 内存 per-key 状态机（persistence 领地），与根锁文件门不同子系统、不同语义载体；无管辖、无词法碰撞（模块私有常量，见 G6） | — |
| G3 | **新瞬态名族** `.nomicore-lock.acquire-<uuid>`（目录）/ `.nomicore-lock.reap-claim.staging-<uuid>`（文件）是否违反 ADR-0006 冻结磁盘布局 / `.tmp` 规则 | ADR-0006 v1 布局节 | **无冲突**——冻结面 = `users/`、`archive/users/` 子树内快照与 `.tmp`；新名在 rootDir 顶层、app 层所有；本轮独立复核 persistence/diagnostic-log/vfsl 均不枚举顶层；名族与既有 `.reap-*`/`.release-*`/`.reap-claim` 同前缀不碰撞；`packages/persistence/**` 在 DENY LIST | — |
| G4 | **证据门控阶梯清障原语**（rmdir 空目录条件 / unlink 空内容 owner.json / 非目录 rename 摘除 / 逐项清障单遍 rmSync）是否与任何 ADR 决策抵触 | ADR 全集 | **无冲突**——无 ADR 管辖根锁恢复/清障语义；「canonical 永不承受 rmSync(recursive)、目录删除恒为 rmdir」为收紧而非放宽，与仓库 fail-loud 纪律同向 | — |
| G5 | **ENOTDIR 并入 CAS errno 集 + EPERM 只读探测分类 + Windows 能力矩阵如实化**是否违反任何跨平台承诺 | ADR 全集；deployment doc L232-250 | **无冲突**——无 ADR 强制跨平台文件语义；能力矩阵改写是**收窄失实声明**（iteration 1 表述被 SA2 #3 证失实）；deployment doc 能力句属合规同步（G7）；错误文案冻结承诺与既有 `loudUnwritable` 文案逐字保持 | — |
| G6 | 新机制词汇（claim 门、staging、证据阶梯）是否引入未登记的 CONTEXT.md 域词 | CONTEXT.md 全文 + docs/AGENTS.md Editing 节 | **无冲突**——CONTEXT.md 为 VFSL/namespace/复制/诊断共享词表，根锁词族零命中；新常量模块私有不导出（index.ts L70 亲证导出面未变），不构成跨域共享术语，「引入域词须更新 CONTEXT.md」义务未触发 | — |
| G7 | **文档同步扩面**（deployment doc 机制句 + Windows 能力句 + 遗留名族清理句；AGENTS.md 边界句改写）是否构成权威决策冲突 | docs/AGENTS.md Authority/Editing 节；两文档原文 | **无冲突（合规文档同步）**——两文件均非 ADR/CONTEXT.md，不属自动阻塞基准；docs/AGENTS.md 明令「代码行为变化时必须更新每一份陈述该契约的规范文档」，设计 §11 恰为此安排同变更集落盘；六条安全不变量逐条亲读对照**全部保持**，I0（发布者/回收者永不重叠）是对「两个 owner 的运行期不得重叠」的**加强**；SA8 B3 预裁被遵守：名族清理扩句未触发新门禁 | 低（登记备案） |
| G8 | **回炉范围遵从**：修订是否越出 SA2 §5 授权面（ALLOW/DENY 扩界、fsync、packages、公共导出/钩子） | SA2 §5 重审范围；iteration 2 SA8 重触发条款 | **无冲突（合规）**——ALLOW 四项（lifecycle.ts、新测试文件、两文档）与 SA2 指定落点一一对应，无扩界；R6 明确不引入 fsync（与 ADR-0006「不做掉电级持久性承诺」纪律同向）；packages 零触碰；导出面/生产钩子零新增（G6 核证）；被否决备选 4（哨兵文件）以「不改变 canonical 磁盘契约」为由拒绝，正确维持了 G3 的布局结论 | — |
| N1′ | 原子发布 + claim 门作为**正确性承载的序列化机制**仍仅记录于 deployment doc + AGENTS.md，未立 ADR | docs/AGENTS.md「Record a durable architectural decision as an ADR」 | **非冲突、治理观察（ relevan­ce 上升）**——无既有 ADR 被静默矛盾（根锁从未入 ADR，沿既例记于文档层）；但 iteration 3 把 claim 门从「优化器」升级为「防线一/正确性承载」（R3 自述），机制的架构权重上升，N1 的「是否补轻量 ADR」裁量价值相应上升。仍归 owner/总控，不阻塞 | 低（advisory） |
| O2（沿） | `main.ts` L11 头注仍称 `.nomicore-lock.json` 为「独占锁」——先在缺陷 | 非基准（代码注释） | **观察**——本轮亲证仍在场；设计 DENY main.ts（语义零变化）合理，注释勘误留实施轮可选，不构成冲突 | 观察 |
| O3（新） | 设计 §13 R7 处置称「§11 文档句不变（**该假设句已在文档中**）」——单二进制假设句的在场性 | 非基准（文档完备性） | **观察**——deployment doc 亲读：L248「root 是当前进程的私有持久化实现……不得同时打开同一 root」与 L249「合法接管只发生在旧 owner 完全停机……两个 owner 运行期不得重叠」构成**所有权排他句**，但**无显式「每 rootDir 单二进制/禁混版本并发」句**。混版本并发操作已被 L248/L249 排除在合法用法之外，故 R7 维持假设口径本身无 gate 问题；但「该假设句已在文档中」的引述不精确——实施/验收轮（SA4/SA7）不得将其当作可定位的文档锚点引用，若需要显式混版本边界句应走 §11 扩句（B3 同款预裁：不触发新门禁） | 观察 |

## 关键裁决理由展开

### G1/G8（本门禁的主裁决面：机制体变更落在自由面）

iteration 3 的回炉触发是**机制本体变更**，SA8 复审的核心问题是：变更后的机制是否撞上任何
权威决策。裁决为否，依据三层：

1. **管辖缺席（独立重证）**：根锁词族（root lock / nomicore-lock / 根锁 / reap / staging /
   mkdir / 互斥 / lock）在 ADR 全集与 CONTEXT.md 零命中——iteration 2 F1 的结论不因机制
   修订而失效，因为「无 ADR 管辖」是关于**决策面**的事实，与设计在自由面上如何演进无关。
   claim 门、link 挂名、证据阶梯、清障原语、errno 集全部落在该自由面内。
2. **模式族正向一致（G2/G3/G4 合成）**：D1′ 的每个新原语都是仓库既立「暂存 → 原子挂名/提交」
   模式的同族延伸——staging/claim-staging 永不作提交态（镜像 ADR-0006「tmp 永不提交」）、
   rename/link 成功即提交/挂名点（镜像「rename 成功即完成一次 flush」）、不新增 fsync 承诺
   （R6 镜像 ADR-0006 纪律）、新顶层瞬态名不触冻结布局且对 packages 不可见（本轮独立复核
   persistence 只 join `users/`、`archive/users/`，无生产代码枚举顶层）。
3. **范围遵从（G8）**：SA2 §5 授权面 = lifecycle.ts 争用臂门槛/errno 集 + 新增测试用例 + 两处
   文档句 + 设计章节增补；iteration 3 的 ALLOW 四项与之一一对应，DENY 未松动（SA6 两契约、
   fixture、CI 装置、packages、main.ts/index.ts 全部维持），备选 4/5/6/7 的否决理由均以
   「不扩磁盘契约/不依赖平台专有原语/保持 loud 诚实退出」收窄而非放宽设计面。

### G7（文档同步面：不变量保持核对）

逐条亲读 deployment doc L232-250 与 AGENTS.md 边界句后核对设计 §11/§10 修订面：

| 既有不变量（文档原文） | 设计保持方式 |
|---|---|
| 单活 owner、两个 owner 运行期不得重叠 | I0/I1/I2 三层防线结构保证（claim 门 + 内容证据 + 条件原语）——**加强** |
| 共享活跃 root unsupported | `heldError` 争用臂与文案逐字保留（§8.1/§9） |
| pid 死 = stale 可回收（rename 墓碑 + 回环） | 主路径守卫链 L163-188 原样内联，仅前置 claim 门与证据门槛 |
| 镜像 `.nomicore-lock.json` 非 token、只诊断 | publishLegacyMirror 位置与语义不变；备选 4（哨兵文件）以不改变 canonical 契约为由否决 |
| EACCES/EPERM → loud | D3 探测分类后 loud 输出仍只有既有 `loudUnwritable` 文案；R1 如实化**收窄**了失实声明 |
| pid 复用人工确认 | R4 维持；§11 保留原句 + 新增名族清理口径（纯增不删） |

唯一被改写的是「机制描述句」（mkdir 线性化点 → 原子发布 + claim 门）与「平台能力句」（失实
→如实）——这正是 docs/AGENTS.md Editing 节「代码行为变化时必须更新陈述该契约的规范文档」
要求的方向，且行为与文档同变更集（B1' 移交项维持）。

### SA2 七项 findings 的冲突面处置核对（仅冲突维度，不含设计质量）

| SA2 finding | 冲突面涉及 | 本轮裁决 |
|---|---|---|
| #1 CRITICAL（`''` 证据摘除 + 回复位失败 = phantom） | 无基准面（无 ADR 管辖）——纯自由面正确性修复 | G1/G4 无冲突 |
| #2 ENOTDIR 逃逸（行为回归） | 恢复既有接管语义 = 恢复与两文档描述的一致性（G7 正向） | 无冲突 |
| #3 Windows/EPERM 表述失实 | 平台承诺无 ADR 面；文档句扩面合规（G5/G7） | 无冲突 |
| #4 协议假设依据章节 | 章节为设计内部证据义务（§14），不触基准 | 无冲突 |
| #5 R7 混版本双向 | 维持假设口径，文档句不动——引述精确性问题记 O3 | 无冲突（O3） |
| #6 遗留名族运维口径 | B3 预裁遵守：扩句不触发新门禁（G7） | 无冲突 |
| #7 测试契约完备性 | 新测试文件/用例不触基准；装置收录已独立核证（G8） | 无冲突 |

## 边界条件（移交下游验证，非冲突）

| # | 内容 | 移交对象 |
|---|---|---|
| B1'（沿） | ALLOW LIST 两文档的机制句/能力句/名族清理句必须与 `lifecycle.ts` 实施同变更集落地（防规范面与实现漂移——S7 教训） | SA3/SA4 |
| B2'（新） | §14 协议假设的 SA1 本机探针脚本位于 `/tmp`（沙箱外一次性产物）——SA4 静态门禁须按 §14 内联要点重跑对拍（SA2 §2 输出为参照答案），不得依赖 `/tmp` 脚本在场 | SA4 |
| B3'（新） | O3 引述精确性：R7 的「该假设句已在文档中」不可作为文档锚点引用；若实施轮需要显式混版本边界句，走 §11 扩句（同 B3 预裁款式，不触发新门禁） | SA4/SA7 |

## 结论

- **verdict：clear**（无阻塞冲突）。
- 分布：冲突候选 11 项 = 阻塞 0 / 无冲突裁决 8（G1-G8，其中 G2/G3 为模式族正向一致佐证、
  G8 为范围遵从核证）/ 低级 advisory 1（N1′，治理记录位置选择，权重较 iteration 2 上升但
  仍归 owner/总控裁量）/ 观察 2（O2 沿、O3 新，均非基准面）。
- **`requiresConflictRecheck: false`（本轮复审后）**：SA2 触发的回炉义务由本报告闭环。被审
  修订面（claim 门、证据阶梯、清障原语、errno 集、平台矩阵、测试/文档扩面）不触任何 ADR
  冻结面与 CONTEXT.md 词表，不越 SA2 §5 授权面。重新触发条件（沿 iteration 2 条款重申）：
  后续修订若引入 fsync 承诺、触碰 `packages/**` 或 ADR-0006 冻结布局、新增公共导出/生产测试
  钩子、引入或改写 CONTEXT.md 域词、或 ALLOW/DENY 面扩界——须再次回炉 SA8。
- 设计质量（三层防线论证完备性、终止性、Windows 残余边界、E5b/E8 验收充分性、§14 证据
  可重跑性）不属 SA8 裁权，留 SA2 重审与 SA4/SA7 验证。

## 证据清单

| 证据 | 位置 |
|---|---|
| 被审设计（修订版） | `wiki/raw/task_ci-pr-276_design.md`（iteration 3，595 行） |
| 上游评审 | `wiki/raw/task_ci-pr-276_sa2_review.md`（reject，7 findings，§5 重审范围与回炉裁定） |
| 上游 SA8（iteration 2） | `wiki/raw/task_ci-pr-276_design_conflict_report.md`（clear，F1-F6/N1/O1/O2 + 重触发条款） |
| 上游 SA6 契约/证据 | `wiki/raw/task_ci-pr-276_sa6_contract.md`、`_sa6_ci-fail.log`、`_sa6_red.log`、`_sa6_stress-red.log`、`_rootlock-race-driver.mjs` |
| 冲突基准 | `docs/adr/`（14 文件，根锁词族 grep 零命中；claim 命中仅 ADR-0006 DocStore 内存状态机）、`CONTEXT.md`（173 行全文）、`docs/AGENTS.md`（Authority/Editing 节） |
| 亲读规范面 | `docs/integration/hub-peer-deployment.md` L232-250（§锁文件与共享 root，含 L248/L249 所有权排他句）、`apps/yjs-server/AGENTS.md`（Boundaries 末条） |
| 亲读代码锚 | `apps/yjs-server/src/lifecycle.ts`（L20-22/L49-63/L76-82/L105-137/L139-195/L198-232 全臂亲读）、`src/index.ts` L70（导出面）、`src/main.ts` L11/L132/L193（消费面 + O2 注释） |
| packages 可见性核证 | `packages/persistence/src/file.ts` L229/L244（users/、archive/users/ 子树）、`packages/namespace-diagnostic-log/src/adapters/file.ts`（streamsDir readdir）、`packages/vfsl*`（仓库 `domains/` 树） |
| 测试装置核证 | `vitest.config.ts`（maxWorkers:1、include `apps/*/test/**/*.test.ts`）、`scripts/ci-test-shard.mjs`（磁盘枚举 walk）、`root-lock-atomic-reclaim-red.test.ts` / `root-lock-stale-reclaim-race-stress.test.ts`（定路径断言，无顶层枚举断言） |
| HEAD 同一性 | `git log -1` = `334494d`（branch `mabf/issue-266`）＝设计/SA6/SA2 声明的 CI 失败 head |
