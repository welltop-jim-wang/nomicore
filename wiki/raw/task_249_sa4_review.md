# SA4 独立静态审查 — Issue #249 实现（implementation 验尸）

- 阶段：implementation-review（SA4 静态验尸）；日期 2026-09-06（UTC）
- Worktree：`/home/wangjian/nomicore-fix-issue-249`（branch `mabf/issue-249`，HEAD
  `ac91a6bf17ae7661df3f6461456e7ca4e8e81526` = PR #248；工作树含 SA3 未提交改动）
- 审查对象：SA3 R0 实现（5 个产品/版本文件改动 + 3 个新增测试文件）
- 输入（全部亲读）：
  - 批准设计 `wiki/raw/task_249_design.md`（SA8 前置/设计后 clear、SA2 approve）
  - SA2 攻击评审 `wiki/raw/task_249_sa2_review.md`（approve；O1–O7）
  - SA6 R1 对齐契约 + 轻量复验 `wiki/raw/task_249_sa6_align_verification.md`
  - SA3 实现报告 `wiki/raw/task_249_sa3_impl.md`、验证命令勘正
    `wiki/raw/task_249_sa3_verification_command.md`
  - 任务简报 `wiki/raw/task_diagnostic-pump-singleflight-duplicate.md`（AC1–AC8）
  - 三份验收契约全文：`registry-issue-249-pump-red.test.ts`（432 行）、
    `registry-issue-249-duplicate-red.test.ts`（306 行）、
    `registry-issue-249-coverage.test.ts`（410 行）
  - 实现全量 diff（`git diff HEAD`，逐 hunk）；相关源码/ADR/词表/守卫正则亲读
- 本轮边界：零产品代码改动、零测试改动；唯一写入 = 本审查文件；零提交、零推送、零 PR；
  验证命令一律后台独立进程（Job 服务持有）

## Verdict

**approve**（`requiresConflictRecheck: false`）

实现与批准设计逐条对齐（单飞位/上报 seam/候选发射三点核心 + 全部裁决 D-1/D-2 落地）；
ADR 红线全部保持；修改范围恰为设计 §1 表 + 版本 bump；三份契约在 root vitest 收集面内
且本轮独立复跑 20/20 全绿；未发现任何测试屏蔽、偷跑或断言弱化；AC1–AC8 逐条验收通过。
新发现 F1–F3 均为非阻断观察（证据链卫生 / 机器预算边缘 / 跨 SA 文件类型机械修正的程序
性注记），无一构成驳回或冲突复检理由。

## 1. 审查方法与独立验证证据

静态审查为主（全 diff 逐 hunk + 源码锚点亲读 + ADR 条款原文回查），辅以本轮独立后台
复跑（不采信 SA3 口头声明）：

| # | 命令（后台 Job / 前台快查） | 结果 | 判定 |
|---|---|---|---|
| V1 | `vitest run` 三契约文件（pump-red + duplicate-red + coverage） | **20/20 passed**，Type Errors: no errors，13.83s，exit 0 | ✅ AC7 终态 |
| V2 | `vitest run packages/namespace-registry/test`（全套件） | 397/398；唯一失败 = `registry-surface` 主入口 export-key 审计用例 **5s 预算超时**（并发负载边缘，见 F2） | ⚠ 判别后非缺陷 |
| V3 | `vitest run registry-surface.test.ts`（隔离复跑） | **12/12 passed**，exit 0（超时用例隔离实测 3513ms，临界 5s） | ✅ F2 = 负载边缘 |
| V4 | `pnpm typecheck`（14 工程串行 tsc） | **exit 0**（含 namespace-registry / namespace-diagnostic-log） | ✅ AC8 |
| V5 | `git diff --check` | 干净（零 whitespace 错误） | ✅ AC8 |
| V6 | 红灯历史证据核验（AC7「PR #248 会失败」） | `.scratch/249/sa6-contract-final-run.log` = 6 failed \| 7 passed（R0）；`sa6-align-final-run.log` = 7 failed \| 6 passed（R1 对齐版 × HEAD）；SA2 附录 A 独立重跑同构 | ✅ 契约判别力实证 |

V2 的 1 例失败为**本轮自身编排**造成的负载边缘（与 V1 契约跑、V4 typecheck 并行 +
`maxWorkers:1` 仅限单进程内），隔离复跑 V3 全绿；与 SA3 记录的 vfsl-codegen 预算边缘
（§4 判别链）同类，非 #249 改动引入、非断言失败。SA3 的 registry 全套件 398/398 顺序
跑证据（`sa3-vc-02-registry-suite.log`）与本轮 V2+V3 联合结论一致。root 全量 `pnpm test`
未在本轮重跑（~15min；SA3 两轮全量 + 唯一失败项判别链已记录，SA7 动态验证为该面
 designated 复核位）——registry 域 + 类型面 + 契约面已由 V1–V4 独立闭环。

## 2. 修改范围核验（git diff --name-only HEAD + git status 双向）

**改动（恰 5 个 tracked + 3 个 untracked，全部位于 `packages/namespace-registry`）**：

| 文件 | 性质 | 对照设计 §1 表 |
|---|---|---|
| `src/diag-pump.ts` | 修改（+127/−27 量级） | ✅ §4 单飞位 + §5.2 reportDrop |
| `src/create-diagnostic.ts` | 修改 | ✅ §6.2 emitCandidateOutcome + sourceModule + §5.4 接线 |
| `src/observer.ts` | 修改 | ✅ §5.3 diag-pump-drop 变体（唯一新增联合分支） |
| `src/registry.ts` | 修改 | ✅ §6.1 两发射点 + §5.4 窄回调 + 头注释改写 |
| `package.json` | 版本 bump | ✅ §14（见 §3） |
| `test/registry-issue-249-{pump-red,duplicate-red,coverage}.test.ts` | 新增（untracked） | ✅ SA6 契约 + §13.3 a–d |

**冻结面逐项核验（零触碰）**：

- `packages/namespace-diagnostic-log/**` 零 diff → schema 指纹 `sha256:v1:dedad2ab…`、
  v1 词表、update-omitted reasons、`test/schema-freeze.test.ts` 平凡保持。
- `src/index.ts` 零 diff（公共导出面）；runtime export-key 审计（九值冻结清单）V3 实跑绿。
- `src/testing.ts`、adapter/persistence、Runtime/复制路径、`apps/**` 零 diff。
- 零 tracked 测试文件被修改（`git status --porcelain packages/*/test/` 仅 3 个 untracked
  新文件）——既有绿基线（含 #150/#226 冻结锚）零触碰，防回退面成立。
- vitest 配置、CI workflow、tsconfig 零 diff（无收集面/门禁面操纵）。

## 3. 版本 bump

- `@nomicore/namespace-registry` `0.1.8 → 0.1.9`（patch，唯一被改包）。✅ 与设计 §14
  「namespace-diagnostic-log 零改动 → 无联动」一致；诊断包零 diff 平凡成立。
- 锁面核验：`pnpm-lock.yaml` 对 workspace 包全部为 `link:` 引用（importers 不记录自身
  版本号；全文件 grep 无 `0.1.8`/`0.1.9` 字面）→ **无 lockfile 漂移**，`--frozen-lockfile`
  安装不受影响。全仓无其它 `0.1.8` 残留引用。
- 仓库无 changeset/CHANGEBOOK 联动机制（设计 §14 已核，本轮复核成立）。

## 4. ADR 红线逐条核验（条款原文回查 + diff 亲证）

| 红线 | 条款原文（本轮亲读） | 实现落点 | 判定 |
|---|---|---|---|
| 词表冻结（不发明 operation/stage/result/code/sourceModule） | ADR-0011 L51「保留所属模块已有的稳定 code…不得发明 retryable、rollback」 | 候选记录全部取既有值：stage `identity`/`transaction`（vocabulary.ts L28–29/L64–65）、result `rejected`、code `NAMESPACE_ALREADY_EXISTS`（registry types.ts L292/L330 既有冻结码族）/`DOC_DUPLICATE`（ADR-0006 L121–123 稳定码）、sourceModule `registry`/`persistence`（vocabulary.ts L33/L69）。§13.3-d 双测试经**真实 emitter 管线**断言 code+sourceModule+stage 精确成对落盘（intake 未丢字段）| ✅ |
| 泵 ≠ adapter writer queue | ADR-0014 L252 | diff 零触碰 adapter/存储语义；单 record 同步 append 不变；未引入 batch/flush/fsync 义务 | ✅ |
| dropped metrics 低基数 + 不占同一队列 + 走独立 observer | ADR-0014 L240「drop newest，保留已排队顺序；不得为了记录 drop 再挤占同一队列。按 operation/reason 增加低基数 dropped metrics，并走独立 observer」；ADR-0011 L25；ADR-0010 L159 | `reportDrop` 在 drop 点同步直报（不入队）；载荷 3 封闭维度（kind/operation/reason）；observer 事件恰 4 键（§13.3-b 以 `Object.keys().sort()` 断言）；namespaceId/streamId/token/SCHEMA/ROOT/owner 零进入 | ✅ |
| 归属与业务不变量（8-retry/单最终结果/不覆盖已提交） | ADR-0010 L28；ADR-0006 L121–123 | 候选记录以候选 namespaceId 数据键控入泵（T-A/T-B/T-C `unattributedDrops===0` 断言）；`createCalls` 序列锚绿；`committed:false` branded fatal 冻结；诊断发射均在 retry return 之前槽内 O(1) | ✅ |
| 输入零访问 + detached snapshot | ADR-0011 L69–77 | entry collision `input:{status:'not-accessed'}`（判定只读 entries map）；DOC_DUPLICATE `input:{snapshot:{schema:p.schema, root:p.root}}` 与相邻全部发射点（L1406/L1422/L1436/L1468/L1477）逐字同款——复用 `preparedBox` 既有 detached frozen snapshot，零重读零第二套序列化 | ✅ |
| 诊断失败零业务外溢 | ADR-0011 L20–L26 | 泵侧 reportDrop try/catch + dispatchObserver 既有隔离（双层）；legacy/NOOP no-op；observer throw 隔离锁（§13.3-b test 2）实跑绿——`created.ok===true` 且后续投递 255 条零影响 | ✅ |
| 内部 observer seam、v1 无公共事件订阅 | ADR-0009 L95「内部结构化 observer seam…v1 不提供公共事件订阅」 | `diag-pump-drop` 为联合加法变体（#111/#112/phase-5/R2 同款先例）；observer 类型不出 index.ts（grep 亲证零导出）；生产 Host 零 observer 注入面改动 | ✅ |
| 调度原语纪律 | registry-surface R4 注释契约（三正则有意不含 setImmediate） | diff 新增行 grep `setTimeout|setInterval|Date.now` 零命中；唯一原语仍裸 `setImmediate`；host-global-timer 守卫测试（扫全部 src/*.ts 零豁免）V3 实跑绿 | ✅ |
| 每次变更尝试恰一次 clock 读数（DC-3） | #226 DC-3 | entry collision 候选传 `undefined` → `readEarlyObservedAt` 侧读恰一次（每候选=一次尝试）；DOC_DUPLICATE 复用 `p.createdAt`（preparedBox 跨候选复用，零额外读）；registry-create.test（无日志场景）47/47 保持绿 | ✅ |
| 日志不引入第二业务排序机构 | ADR-0011 L123–129 | per-ns 队列 FIFO 结构零改动；候选 emission 槽内 O(1) 无让渡；业务槽序零触碰 | ✅ |
| 公共入口/legacy 冻结 | #150「恰一条最终结局」 | legacy 路径 `emitCandidateOutcome: () => undefined` + NOOP no-op（D-1）；§13.3-c 双测试把裁决钉为契约；`registry-create-diagnostic-red` 16/16 与 sa7-dynamic `emitCalls===10` 锚在 V2 中绿 | ✅ |

## 5. 测试触发性（vitest）

- root `vitest.config.ts` include = `packages/*/test/**/*.test.ts`（亲读）→ 三份契约
  文件路径全部命中，**进 `pnpm test` 全量收集面**（AC7 简报要求）。
- `tsconfig.typecheck.json` include 含 `packages/*/test/**/*.ts`（亲读）→ 三文件在
  `vitest run --typecheck` 的 tsc 程序编译面内（SA2 O2 勘正后的真实类型门禁通道）；
  V1/V2/V3 均 `Type Errors: no errors` 且零 unhandled error。
- 本轮 V1 实际收集并执行 20 用例（13 契约 + 7 覆盖）——非「存在即绿」推断，是收集+
  执行双证。`.scratch/249/` 复现载体不在 root include 面内（目录模式不匹配），不进
  `pnpm test`（与 SA5 §7 主张一致；但见 F1 的 gitignore 勘误）。
- 无包级 vitest 配置覆盖/排除（grep 零命中包内 vitest.config）；root `passWithNoTests:
  true` 为既有配置，非本票引入。

## 6. 无测试屏蔽 / 偷跑审计

| 审计项 | 方法 | 结果 |
|---|---|---|
| skip/only/todo/skipIf/runIf/soft | grep 三契约文件（全词模式） | **零命中** |
| 既有测试弱化 | `git diff --name-only` + `git status` test 树 | 零 tracked 测试改动；断言不可能被弱化 |
| vitest/CI 配置操纵 | diff 面核验 | vitest.config.ts / ci.yml / tsconfig 零 diff |
| mock/替换产品代码 | 三文件亲读 | 零 `vi.mock`；全部经真实 `src/diag-pump.js`、真实 testing seam、真实 emitter 管线 |
| 断言强度 | 逐用例亲读 | 全部强形式：精确计数（1/2/9/10/44/256/300）、精确键集（`Object.keys` sort）、精确序（FIFO/initStream 先行）、精确业务锚（createCalls 序列、branded fatal、phase）——无恒真/弱化断言 |
| 红灯真实性（AC7「PR #248 会失败」） | 历史日志核验（V6） | R0 6 红 + R1 对齐版 7 红（新增 T-C）× HEAD ac91a6b，SA6/SA2/SA5 三方独立复现同构 |
| R1b「delivered 256」是否偷跑 | 语义核验 | AC3 明文允许有界 drop-newest——256 为容量上界的**预期**行为，丢弃可见性由 R3-2/R3-3 单独锁定，非屏蔽 |
| SA3 对 SA6 契约文件的改动 | 亲读 diff 注记（duplicate-red L69–77/L184–195） | 仅类型机械修正：`counters[… ]!` 非空断言（调用点 counters 恒非空——类型级 erasure）+ `exactOptionalPropertyTypes` 在场性分形构造（产物对象逐字段等价）；**断言/编排/契约注释零触碰**。程序性注记见 F3 |

## 7. 验收标准逐条（AC1–AC8）

| AC | 要求 | 证据 | 判定 |
|---|---|---|---|
| AC1 | 每 ns 同时至多一个 scheduled/running drain；首 drain 前 burst 不无界重复 setImmediate | 实现：`inflight` 位排定时置位（先于 setImmediate 返回）、回调末尾 finally 清除、敌意 throw 位回滚（diag-pump diff 亲证，与设计 §4.2 伪码逐行同构）；R1a（scheduleCount=1）/R1b（fired=1）/R1c（pending<50）红→绿 V1 实跑 | ✅ |
| AC2 | stale callback 与 enqueue/drain 清理交错不丢已接纳任务；同 ns FIFO、initStream 先行 | R2a（对齐版：显式重调已触发回调，空队 no-op、scheduleCount=2、零丢失）/R2b（末任务期重入同轮消费）/R2c（FIFO+init 先行）/R2d（违约隔离）4/4 绿 V1；实现侧 drain 本体结构逐字节保持（循环重取引用/空判 break/排空 delete），簿记移至回调 finally——break→queues.delete→inflight.delete 间零 Host 可执行代码（同步直线无回调点） | ✅ |
| AC3 | 内存与调度有界；满队 drop-newest 保序 + 既有低基数 metric/observer 健康语义上报 | R3-1（256 保序）绿；R3-2（44 条 emit 丢弃逐条判别联合上报）红→绿；R3-3（init-stream 丢弃恰一次、无 operation、从未执行）绿；§13.3-b（observer 落点四键 + throw 隔离）绿——全部 V1 实跑 | ✅ |
| AC4 | entry collision 与 DOC_DUPLICATE 到正确 namespace 的诊断流；不影响 8 次 retry、最终 create 结果、稳定词表 | T-A（nsA 2 条含 rejected、零补建）/T-B（1 条 rejected + 恰一次 genesis-less 补建）/T-C（1 committed + 9 rejected、零 fatal 记录、initStream 恰 1、unattributed 0）红→绿；§13.3-c（legacy no-op）/§13.3-d（code↔sourceModule↔stage 精确成对）绿；retry 预算与 `createCalls` 序列锚全绿 | ✅ |
| AC5 | acceptance/capability gate 输入零访问；后续仅 detached safe snapshot | entry collision `not-accessed`（只读 entries map）；DOC_DUPLICATE 复用 preparedBox detached frozen snapshot（与相邻发射点同款，亲读 L1442–1462） | ✅ |
| AC6 | initStream/resolver/emitter/storage 异常不改业务结果/顺序、不无限延长 shutdown | R2d + §13.3-b throw 隔离锁绿（业务 `ok:true`、后续投递零影响）；泵零 disposer 注册/零 shutdown 耦合（diff 零触碰 shutdown 面）；legacy initStream 吞没边界保持 | ✅ |
| AC7 | 确定性红→绿测试覆盖 burst/stale interleave/queue-full+health/collision/duplicate/retry 成功/耗尽/异常隔离，且 PR #248 会失败 | 20 用例覆盖矩阵齐（V1 全绿）；红灯史 V6（R0 6 红/R1 7 红 × HEAD）三方独立复现 | ✅ |
| AC8 | registry 指定测试 + root `pnpm typecheck` + `pnpm test` + `git diff --check` | V1 契约 20/20；V2/V3 registry 域 398 用例绿（1 例判别为负载边缘，隔离 12/12）；V4 root typecheck exit 0；V5 diff --check 干净；root `pnpm test` SA3 两轮 2887–2888/2889（唯一失败 = vfsl-codegen 5s 预算边缘，零代码交集、30s 预算 8/8 全绿、默认预算隔离复现——判别链完整，`sa3-vc-05/06/07/08` 日志核验在场） | ✅（vfsl-codegen 项登记为机器预算边缘，归 CI/SA7 复核位） |

## 8. 新发现（均非阻断）

- **F1（证据链卫生——SA5 表述勘误）**：`.scratch/249/` **不在** `.gitignore` 内
  （`grep scratch .gitignore` 零命中；`git status` 将其列为 untracked 而非 ignored）。
  SA5 §7「载体：.scratch/249/（gitignored）」表述不准确——不影响验收（root vitest
  include 不含该目录，无收集面风险；内有 `node_modules/` 与复现载体）。**处置建议**：
  finalize 必须以精确 paths 收录（结构化 `mabf_runner_finalize_local` 本就如此），确保
  `.scratch/` 不入提交；后续卫生票可将 `.scratch/` 纳入 .gitignore（#249 范围外）。
- **F2（机器预算边缘——本轮自证）**：V2 并发全量跑中 `registry-surface` 主入口
  export-key 审计用例 5s 超时（该用例 `await import` 主入口，隔离实测 3513ms 临界）；
  隔离复跑 V3 12/12 全绿。与 SA3 §4 已判别的 vfsl-codegen 预算边缘同类（本机慢、CI
  runner 裁决），非 #249 改动引入、非断言失败。提示 SA7/总控：registry 全量跑避免与
  其它重负载 Job 并发。
- **F3（程序性注记——SA3 对 SA6 契约文件的类型机械修正）**：SA6 红灯证据（7 红 ×
  HEAD）生成于 SA3 修正之前；修正仅为类型级（非空断言 + exactOptionalPropertyTypes
  分形构造，亲读核验为 erasure-only、运行时行为零变化），红灯/绿灯判定不受影响，且
  现行 20/20 绿与该修正共存。程序上 SA3 改动了 SA6 owned 文件——已在 SA3 报告 §1
  显式登记并有正当依据（`pnpm test` tsc 程序暴露的 latent 类型错误，SA6 定向跑不含
  typecheck 面故未先见）。无屏蔽意图、无语义变化，记录备查。
- **F4（观察，无需行动）**：`DiagPumpDeps.reportDrop` 为可选依赖 + registry.ts 恒传
  回调（observer 缺席时 dispatchObserver 自行 no-op）——泵级可测性与生产接线同构，
  与设计 §5.4 一致；`options.reportPumpDrop === undefined` 分形构造保持两参既有行为
  零漂移（其余调用方零存在，grep 亲证 registry.ts 唯一调用点）。

## 9. 结论

- 实现忠实于批准设计（含 SA2 O3「结构等价理解」、O5「先例锚注释」、O6「滞留语义
  登记」三点落地核验）；SA6 三处契约对齐（R2a/R3-2/T-C）与本实现相互印证。
- ADR 红线、版本 bump、修改范围、测试触发性、无屏蔽/偷跑、AC1–AC8 全部核验通过；
  独立复跑证据 V1–V6 与 SA3 声明零矛盾。
- 无需冲突复检：全部实现决策落在设计（SA8 双 clear + SA2 approve）已覆盖的既有 ADR
  条款兑现域内；F1–F4 无规范演进触发。
- 路由：SA4 approve → SA7 动态验证（root `pnpm test` 全量 + CI 面为 designated 复核位，
  注意 F2 并发负载提示）→ AC 门禁 → finalize（精确 paths，排除 `.scratch/`）。

Verdict: approve — `requiresConflictRecheck: false`
