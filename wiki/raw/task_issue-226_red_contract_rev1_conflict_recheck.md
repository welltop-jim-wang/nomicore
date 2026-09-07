# 修订红契约冲突复审（conflict recheck）— Issue #226 acceptance-contract rev1

- 被审对象：`wiki/raw/task_issue-226_red_contract_rev1.md`（SA6 重新固话轮）及其落地的三个测试文件
  - `packages/namespace-registry/test/registry-issue-226-red.test.ts`（修订后 13 用例全集；未跟踪新文件）
  - `apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts`（R3 修订 C1 用例；已跟踪文件修改，diff 47+/16−，11 个 hunk 全部位于头注释与 C1 用例内——其余 5 用例零触碰）
  - `packages/namespace-runtime/test/runtime-issue-226-red.test.ts`（**删除**，结构性变更，rev1 §1 R2 登记）
- 复审基准：`task_issue-226.md`（简报 AC1–AC5）、`task_issue-226_design.md`（SA1 iter4 §10 修订集）、`task_issue-226_design_conflict_report.md`（SA8 C1/C2/C3 + N1–N5）、`task_issue-226_relevant_decisions.md`（ADR 摘录）、ADR-0011/0012（诊断日志版）/0008/0009/0010 被引条款
- 复审方式：本轮全部独立重验，不沿用上游声明——四项后台 Job 实测（§3）、生产代码锚点亲读（registry.ts L1229/L1436–1463、create-diagnostic.ts `createRuntimeDiagResolver` L286–297、registry.ts L763–765 默认 runtimeFactory）、守卫三正则逐字符核对、全 repo `unattributed` 锚清扫、git status/diff 全量核对
- Worktree：`/home/wangjian/nomicore-fix-issue-226`（branch `mabf/issue-226`，HEAD `45a22f0`）
- 时间：2026-09-06（SA8 conflict recheck 轮）

## Verdict

**clear**（`requiresConflictRecheck: false`）

对复审三问的裁决：

1. **修订红契约可满足** — 是。R1「到达 poll + 顺序」形状让事件循环让渡（vitest `expect.poll` 定时器 = macrotask），macrotask 级延迟投递的存储完成标记可被观测到；顺序断言在到达后执行，结算标记（测试续段微任务内 push）先于 drain（macrotask）确定性成立。R2 经 Registry 生产装配全链路注入（默认 `runtimeFactory = createNamespaceRuntimeForRegistry`，registry.ts L763–765 本轮亲证），即 #226 修复的实际改动面（resolver 产出的 emitter）——修复后 wrapper O(1) 入队 + drain 迟到执行即翻绿，且实现空间不再封闭。R3 判据与投递到达时机正交（drop 计数只会多不会少）。原 C1（五顺序锚实现空间封闭）/C2（与 #149 AC4 互斥）/C3（冻结缺陷 A）三组阻断冲突经修订全部消解。
2. **仍准确覆盖问题** — 是。缺口 A（归属）：T1–T6（六类建流前结局数据键控归属）+ T11（真实 File adapter E2E：被拒 create 建 genesis-less 流落盘）+ #155 SA7 C1（应用层全链路 E2E，B 以 NS_B 归属）；缺口 B（隔离）：T8（create）/T9（shutdown×建流）/T10（open×adapter 构造）/T12（下一写槽推进）/T13（shutdown×close barrier）；T7 GREEN 对照钉住缺口边界。修复前红面本轮独立复现（§3：12F|1P），与 SA5/SA6/verify2–6/design 各轮红态签名一致（T8/T9/T10 `expected N to be less than M` 顺序反序红、T12/T13 墙钟红、T1–T6/T11 到达 poll 超时红）——AC5「证明修复前行为会失败」维持。
3. **与 #149/#155 证据、ADR 无冲突** — 见 §4/§5。

## 1. 逐修订项复核（对照 SA8 design-conflict 裁决 R1–R4）

| # | 裁决要求 | 落地形态（本轮亲读锚文本） | 复核结论 |
|---|---|---|---|
| R1 | T8/T9/T10 顺序锚改「到达 poll + 顺序」 | T8 L495–506：poll 等 `initStream:<ns>:end` ∧ `emit:<ns>:1:end` 双标记到达后再断言 `create:settled` 先于两者；T9 L540–544 同形（`shutdown:settled` < `initStream:end`）；T10 L577–581 先经一次 lease 写驱动 emission 再 poll `ensure:<ns>:end`；墙钟全部降旁证保留 | ✅ 满足。修复前（槽内同步存储，registry.ts L1436/L1450、L1229 factory 现场解析——本轮亲读证实）标记先于结算标记 → 顺序反序红（本轮实测 `expected 6 to be less than 3`×2 / `expected 2 to be less than 1`）；修复后机制成立（§Verdict.1）。poll 超时余量 1s vs 注入阻塞 100–240ms，充足 |
| R2 | T12/T13 注入形状改「生产 wiring 同构」+ 顺序锚同 R1 形状 | 迁入 registry 红契约 T12 L587–626 / T13 L628–655：`makeRegistry` 不覆写 runtimeFactory → 默认 `createNamespaceRuntimeForRegistry`（L763–765 亲证）+ resolver 产出 emitter（即修复改动面）；通道序号 `emit:<ns>:<n>` 静态判别（#17 = 第 1 条，w1 = 第 2 条）；T12 poll `emit:2:start` 后断言 `writes:settled` 在前；T13 poll `emit:2:end` 后断言 `shutdown:settled` 在前 | ✅ 满足。与裁决建议的形式差异（裁决示例为 `namespace-runtime/testing` 导出 wrapper 助手；落地为经生产装配注入、零新导出）属**手段而非要求**的偏差：裁决的实质四要件（经 #226 修复实际改动面 / seam 字段名零新增 / #149 直连注入零漂移 / 修复前仍红）全部满足，且比 testing 助手更贴「生产 wiring 同构」字义。runtime 包零改动（git status 证实） |
| R3 | #155 SA7 C1 三锚改 #226 后语义（B 归属落盘、0 unattributed、B 目录存在；A 流干净保持） | diff 亲读：`dropsEarly toHaveLength(0)`（原 `===1`）、B 半 = poll `namespaces/NS_B/current.json` 到达 + `readStreamStrict` status `ok` + 恰 1 条 attempt（stage `transaction`/code `NAMESPACE_CREATE_FAILED`/result `rejected`）、全程 drops 0；A 流干净面（恰 genesis+#17、segment 无 B marker、A replay complete/issues=[]）全部保持 | ✅ 满足。修复前确定性红（同步断言、恰 1 条 unattributed drop——本轮实测 `expected [ { …(2) } ] to have a length of +0 but got 1`）；跨 ns 误归因攻防面强化（B 有流后「B 记录不得入 A 流」的检验反而更严格）。**N4 边界保持**：B 流只锚目录 + attempt 可读，不锚 replay complete（C1b 先例形状——本文件 L325–360 既有 genesis-less 流读取先例亲证） |
| R4 | 推荐：`registry-surface.test.ts` §2.M 注释固化 setImmediate 许可 | 未落地（rev1 §1 登记，移交 SA3） | ✅ 无冲突。本轮逐字符核对三正则（L279–284）：`setTimeout|setInterval|clearTimeout|clearInterval`（裸/globalThis 两式）+ `Date.now`——**均不含 `setImmediate`**，泵源码裸调不命中任何守卫；文件零改动（git status 证实），注释属文档级，随实现落地合理 |

## 2. 结构性变更复核

- `runtime-issue-226-red.test.ts` 删除：该文件本为未跟踪（无 git 删除记录），全 repo 检索仅新契约头注释自述引用——零残留引用。删除理由与 SA8 C1/C2 裁决一致：「Runtime 零生产改动 + #149 AC4 同步锚」前提下直注用例对任意实现不可满足，保留即永不绿契约。13 用例全集收敛于 registry 红契约（T1–T13），映射闭合（T12/T13 迁移后判据族与 SA6 R0 登记同族：顺序锚 + 墙钟，注入阻塞 100ms / 阈值 50ms）。
- 通道事件迹加序号（`emit:<ns>:<n>:start/end`）为测试夹具内部形状，非 seam 成员；binding 三成员恰 `emitter`/`initStream`/`runtimeEmitterFor`（L239–254 亲证）——seam 冻结面零漂移。

## 3. 本轮独立重跑证据（后台 Job，2026-09-06）

| 套件 | 命令 | 结果 | 与 rev1 §4 对照 |
|---|---|---|---|
| 修订后红契约 | `pnpm test packages/namespace-registry/test/registry-issue-226-red.test.ts` | **12 failed \| 1 passed (13)**，Type Errors 0，20.19s；T13 墙钟 `124ms > 50`、T11 NS_SECOND 目录 poll 超时 | 一致（12F\|1P；T7 唯一绿） |
| #149+#150 相邻绿基线 | `pnpm test registry-create-diagnostic-red.test.ts runtime-root-schema-diagnostic-red.test.ts` | **30 passed (30)**（#150 16 + #149 14），Type Errors 0 | 一致（零漂移；#149 AC4 `emitCalls===2` 同步锚保持——两文件 git 零改动） |
| #155 SA7 应用套件 | `pnpm test apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts` | **1 failed \| 5 passed (6)**，Type Errors 0——C1 于 L253 `dropsEarly toHaveLength(0)` 确定性失败；C1b/M2/issues 镜像/fatal-unknown/D8 全绿 | 一致（C1 属 #226 全量门必红面） |
| yjs-server typecheck | `tsc -p apps/yjs-server/tsconfig.json` | exit 0 | 一致 |

## 4. #149/#155/#150 证据一致性

- **#149**：`runtime-root-schema-diagnostic-red.test.ts` 零改动（git status）；14/14 绿。C2 互斥的根源（直注冻结 seam）随 T12/T13 迁出 runtime 契约而消解——#149 直连注入不经任何 wrapper，行为零漂移。
- **#150**：`registry-create-diagnostic-red.test.ts` 零改动；16/16 绿（legacy 缓冲 Host 路径与修订正交）。
- **#155**：仅 C1 用例修订（§1 R3）；其余 5 用例（含 manager 级迟到 emit 直探 C1b——数据键控路由的既有攻防面）零触碰全绿。全 repo `unattributed` 期望锚清扫（本轮重跑）：**反向锚已清零**——剩余全部为 `===0`/`toHaveLength(0)`（与修复同向）或夹具管道，与 SA8 C3 裁决的「唯二反向锚」盘点闭环。
- **前置证据链**：红灯签名与 SA5/SA6 R0/verify2–6/design 五轮完全一致（12F|1P；T8/T9/T10 顺序反序、T12/T13 墙钟 ≥100ms）——修订未弱化任何红锚的失败形态。

## 5. ADR 一致性（修订契约层）

| ADR 条款 | 修订契约锚 | 裁决 |
|---|---|---|
| ADR-0011 L129「adapter 慢/失败/队列满不得延长 write slot 或阻塞 close/shutdown；Registry 停止不得无限等待日志 sink」 | T9/T13 顺序锚（shutdown 结算先于日志存储完成）正是该条款的可执行化 | no-conflict |
| ADR-0011 L117 emit 立即/detached/non-throw | poll 判据不要求 emit 返回 Promise/durability；夹具阻塞模拟的是被测 Host 存储延迟（缺陷本体） | no-conflict |
| ADR-0014 L22「genesis 未成功写入时 stream 仍可记录诊断事实」 | R3 B 半 + T11（`initStream(ns, undefined)` genesis-less 流 + attempt 落盘）为该条款原文覆盖形态；不锚 replay complete（无 genesis 诚实缺席） | no-conflict |
| ADR-0014 L70–89/L268 词表与冻结项 | R3 锚值 stage `transaction`/code `NAMESPACE_CREATE_FAILED`/result `rejected` 全为既有冻结词；零新词表值、零 record schema/stream generation 触发 | no-conflict |
| ADR-0014 amendment L250（emit 调用点须在 slot 外/释放后） | T8–T13 全部锚定「结算不等待日志、日志不在关键路径」= 该规范性接线条件的验收面 | no-conflict |
| seam 冻结（#150/#155 契约锚） | binding 三成员名零新增；Runtime 包零改动；`namespace-runtime/testing` 零新导出 | no-conflict |
| 静态守卫（registry-surface §2.M） | `setImmediate` 不在三正则内（本轮逐字符核对）；R4 注释未落地不构成命中缺口 | no-conflict |

## 6. N1–N5 卫生注记闭环（design-conflict 报告移交项）

- **N1**（泵溢出健康上报）：契约层无涉——SA3 实现期建议项，维持。
- **N2**（T13 单锚证明精度勘误）：**已消解**——到达 poll 形状下病态接线自然失效（poll 让出事件循环 ⇒ drain 可观测，判据回到语义本体）；且新 T13 不再直注 Runtime seam，病态接线域不复存在。
- **N3**（补引 ADR-0014 L22）：R3 修订注释已引（SA7 diff L280「ADR-0014：genesis 未成功写入时 stream 仍可记录诊断事实」）——已兑现。
- **N4**（genesis-less 流只锚目录 + attempt 可读）：**边界保持**（§1 R3 行）。
- **N5**（#150 零漂移首验面）：本轮 30P 实证，移交 SA3 回归门。

## 7. 边界裁决（复审轮承接登记项）

- **id 耗尽 fatal 零诊断发射**（前置门禁与 design-conflict §3#8 登记「留待 SA8 recheck」）：本轮裁定**维持，非冲突**。理由：(a) AC1 字面针对「被无归属通道确定性丢弃」的结局——id 耗尽 fatal 是零发射（从未进入任何通道），不在字面域内；(b) 全部候选 id 已证明属他人，任选归属即伪造（违反 ADR-0014 数据键控与「绝不伪造归属」词义）；(c) 无 ns 落盘面需 record schema 演进 + 新 stream generation，超出本票。契约无需为此增设用例。

## 8. 移交 SA3 的非阻断注意事项

1. **R4** 随泵实现一并落地（`registry-surface.test.ts` §2.M 注释固化 setImmediate 许可）。
2. 顺序锚的修复后确定性依赖「emission 入队点 → 调用方结算续段」之间为纯微任务链（无 macrotask yield）——设计满足；SA3 实现不得在 Registry/Runtime 结算路径引入 macrotask 让渡（否则 T8–T13 伪红）。
3. N1 内部丢弃计数建议（零成本预留，不进公共面）。
4. SA3 完成门 = 修订后红契约 13 用例全绿 + #149/#150 基线保持 + C1 翻绿 + 全量回归 + 根 typecheck。

## 9. 本轮边界

- 零产品代码改动（`src/**`、`apps/**/src/**` 未触碰——git status 全量核对：仅 SA7 测试文件 M + registry 红契约未跟踪 + wiki 文件）；零 git 操作；唯一写入 = 本文件。
- 结构化结果：verdict `clear`、`requiresConflictRecheck: false`；artifactPaths = 本文件 + 被审修订报告 + 三个受审测试文件。

Verdict: **clear** — `requiresConflictRecheck: false`
