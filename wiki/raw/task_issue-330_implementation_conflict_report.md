# 冲突门禁报告 — Issue #330 实现后复查（implementation recheck）

## 1. Reviewed subject

- **implementation（实现后冲突复查）**：branch `mabf/issue-330`（HEAD `83581b3`）上的未提交实现 diff——4 个跟踪源文件改动（`packages/clock/src/system.ts`、`packages/clock/src/manual.ts`、`packages/ws-replication/src/plugin.ts`、`packages/namespace-registry/src/registry.ts`）+ 3 个新增测试文件（`packages/clock/test/clock-guard-proxy-consumption.test.ts`、`packages/namespace-registry/test/registry-guard-proxy-consumption.test.ts`、`packages/ws-replication/test/ws-replication-guard-proxy-consumption.test.ts`）。
- 复查触发依据：SA8 前置门禁 `wiki/raw/task_issue-330_conflict_report.md` §10 `requiresConflictRecheck=true` + SA1 设计 §15 复查清单 + SA6 契约 §3 Frozen surfaces 1–10。本次为该复查的闭合。
- 本报告只做冲突裁决：对照 ADR 全集 + `CONTEXT.md`（按收录关系附三包 `AGENTS.md` 与 `docs/protocols/instance-replication-v1.md`）逐项核对 diff；不评价设计优劣、实现质量与测试充分性（SA2/SA7 域），不运行测试（绿/红证据采信 SA3 日志与产物静态核验）。
- Issue-comments REST 读取结果为 `[]`（派发说明 + 简报空节 + SA6 §2/SA8 §1 一致记录）：**无 Owner 评论来源的 override 或附加义务，无 comment ID/时间戳可应用**。

## 2. Inputs and decision set

- 决策基准（逐个核对状态行）：`docs/adr/` 全集 20 文件（0001 系列实际在档：0003–0014、0016–0019、0022、0023 等，全部「已接受」；无整篇 superseded；ADR-0007 仅 open/read 编排条款被 0008 部分取代且与本任务无交集）。母法 `docs/adr/0023-proxy-consumable-frozen-service-surfaces.md`（accepted，commit `83581b3`）。
- 术语基准：`CONTEXT.md` L129–131「服务表面（service surface）」+ Avoid 两条红线（访问器纪律 / 禁去 freeze）——与 ADR 0023 同步在档，本次 diff 零文档改动、无需演进。
- 按收录关系附入：`packages/clock/AGENTS.md`、`packages/namespace-registry/AGENTS.md`、`packages/ws-replication/AGENTS.md`；`docs/protocols/instance-replication-v1.md`（无交集核验）。
- 上游工件（evidence，非规范契约，按 `docs/AGENTS.md` authority 节）：`wiki/raw/task_issue-330.md`（简报 AC1–AC8）、`task_issue-330_relevant_decisions.md`、`task_issue-330_conflict_report.md`（前置门禁 clear）、`task_issue-330_design.md`（SA1）、`task_issue-330_sa2_review.md`（approve）、`task_issue-330_sa6_contract.md` + `_sa6_red_probe.log`、`task_issue-330_sa3_impl.md` + `_sa3_red/_green/_root-test/_pack-local.log`。
- diff 静态核验方法（本报告自做，不采信自述）：`git diff --stat`（恰 4 文件 +173/−145）；`git diff -w` 语义残渣过滤（registry 残渣仅 1 空行，plugin/clock 残渣仅声明形态行与 ADR 注释）；hunk 定位（registry 恰 2 个 hunk 全在 L2179+；plugin 恰 4 个 hunk 在 L431+/L509+）；`ctx.provide` 全仓站点盘点（恰 6 处，与 ADR 0023 影响面表互证）；三个新测试文件全文实读；dist/tgz 产物 getter 形态抽查。

## 3. Decision analysis

| Decision | Clause | Subject behavior | Classification | Evidence | Required action |
|---|---|---|---|---|---|
| ADR 0023 | 决策 L45–62：函数成员一律访问器属性（方法体提稳定闭包、getter 返回闭包、`Object.freeze` 保留、方法体/闭包封装/状态机一行不动）；落地 4 生产 + 1 testing | diff 把五服务全部函数成员改为字面量 getter：registry 七方法提升至 `createRegistryInternal` 作用域（`runShutdown` 后、字面量前）；hub `requestReauth` 提升（`stop` 原为命名 const 零提升）；peer 四内联箭头提升（`stop` 同零提升）；`systemClock` 模块级 `nowImpl`；`ManualClock` 工厂作用域三闭包。`git diff -w` 证明方法体逐字平移（registry 语义残渣仅 1 空行；其余残渣均为声明形态行 + ADR 引用注释 + R4 显式返回类型注解） | implements-existing-decision | `docs/adr/0023-...md` L45–62；`git diff -w` 四文件；设计 §7.2 R1–R6；`registry.ts` 现行 L2179–2289 | 无（义务已兑现） |
| ADR 0023 | 影响面 L30–41：恰改 5 受影响行；排除 `nomicoreInstance`/`nomicorePersistence`/`timer`；lease/session 返回值与信封不受影响 | 全仓 `ctx.provide` 盘点恰 6 站点：5 个含函数成员的冻结字面量表面全部在 diff 内；`instance/src/index.ts`、`persistence/src/*`、`ws-replication/src/testing.ts decorateLease`、`create-diagnostic.ts NOOP_DIAG`、`persistence/src/testing.ts` fake timer 均零改动（git status 恰 4 跟踪文件） | no-conflict | ADR L30–41；`grep ctx.provide` 六站点；`git status --short` | 无 |
| ADR 0023 | 姿态对照 L64–74：赋值拒（无 setter）、`defineProperty` 重定义拒（non-configurable）、TS 类型面不变、引用缓存不变（同一稳定闭包）、枚举性保持 | 五处 `Object.freeze` 原样保留；getter 只 `return` 命名 const（无内联函数表达式）；字面量成员序保持（registry 7 序、hub status/requestReauth/stop、peer 6 序、clock `['now']`、manual `['now','set','advance']`）；五个公共接口（`NamespaceRegistry`/`HubReplicationService`/`PeerReplicationService`/`Clock`/`ManualClock`）零 diff（registry hunk 全在 L2179+；plugin hunk 在 L431+，接口区块 L35–56 未触碰；`types.ts`/`contract.ts`/`manual.ts` 接口段零改动） | no-conflict | ADR L64–74；diff hunk 定位；三新测试 `expectAccessorPosture` 断言块（`'value' in d === false`、`get` function、`set === undefined`、`configurable === false`、`enumerable === true`、`isFrozen`、赋值/重定义 `toThrow(TypeError)`）+ `Object.keys` 键序断言 | 无 |
| ADR 0023 | 验收 L90–93：每服务 guard-proxy 回归测试（包内 seam + 包内 helper，不新建共享设施）、形态断言、门禁、tarball | 三个新测试文件齐备：helper 三份包内复制（各约 10–30 行、逐字同款 SA6 §12.3，无共享模块）；每用例三重对照（敏感性正控 `Object.freeze({probe})` 必抛 + 诚实 Proxy 负控 + 被测断言）；覆盖 AC2 全清单（hub status/requestReauth/stop，peer status/addTarget/removeTarget/notifyAuthChanged/waitForLive/stop）+ registry 七成员 + clock 双对象；`waitForLive` 用注入 timer + `stop()` 触发 settle（无真实 sleep）；SA3 日志：HEAD 红 8 用例（18 函数成员 `THROW:TypeError`、`status`×2 绿）→ 改后绿 3 文件/8 用例；root `pnpm test` 341 文件/3596 用例 + typecheck 绿；`pnpm pack:local` 产出三 tgz 且 dist 含 getter 形态（本报告抽查 `get now()`/`get shutdown()`/`get waitForLive()` 实证） | implements-existing-decision | ADR L90–93；三测试文件实读；`task_issue-330_sa3_red/green/root-test/pack-local.log`；`artifacts/local-packages/nomicore-{clock-0.1.0,namespace-registry-0.1.10,ws-replication-0.1.5}.tgz` + `packages/*/dist` 抽查 | 无（义务已兑现；DSH 侧重建/live reload/fork 回退属 ADR L93 仓外联动，见 §8） |
| ADR 0023 + 简报 AC4 | L91：既有 `writable === false` 形态断言更新，或无则审计结论记录在案 | 三包无服务成员 `writable === false` 断言（命中仅 `types.ts:518` 注释词与 `registry.ts:766` clonePlainData 数据载荷）→ 走审计分支；SA3 实现报告 §AC4 已把审计结论记录在案；既有 `clock-contract.test.ts` 键面/isFrozen 断言文件零改动且在 root 全绿中保持 | no-conflict | ADR L91；`task_issue-330_sa3_impl.md` §AC4；`grep -n '\bwritable\b'` 复核 | 无 |
| ADR 0023 | 实现注意 L78：deepFreeze 按 `descriptor.value` 递归需注意访问器 | diff 零触碰任何 deepFreeze 实现（`namespace-diagnostic-log/pipeline.ts`、`vfsl`、`yjs-server/config.ts` 均不在改动集）；仓内 deepFreeze 不消费五服务对象 | no-conflict | ADR L78；git status 改动集 | 无 |
| CONTEXT.md | L129–131「服务表面」术语与 Avoid 红线（禁「冻结字面量 + 数据属性方法」、禁「为可包装性去 freeze」） | 实现即术语兑现：五表面全部访问器化、freeze 全保留；diff 未新增任何「冻结字面量 + 数据属性函数成员」形态服务；术语文本无需变更 | no-conflict | `CONTEXT.md` L129–131（实读）；diff | 无 |
| ADR 0009 + clock contract | Registry 构造期 Clock 形状门禁 `typeof clock.now === 'function'`（禁 `Date.now()` fallback）；peer 侧 `clock: { now: () => clock.now() }` 包装 | 门禁代码（`registry.ts` L620–628）与 peer 包装（`plugin.ts` L482）均不在任何 diff hunk 内；getter 返回稳定闭包 ⇒ `typeof` 仍 `'function'`，门禁与消费路径语义不变 | no-conflict | `registry.ts` hunk 定位（仅 L2179+）；`plugin.ts` hunk 定位（L431+/L509+） | 无 |
| ADR 0012 | Instance 身份与 WS plugin 所有权；`ctx.effect` reverse-yield teardown | hub/peer `ctx.effect` 块（`yield revoke; yield stop;`）逐字未动（hub L446–448 / peer L552–555 现行实读）；`stop` 保持既有命名 const（零提升），`yield stop` 引用同一性天然保持 | no-conflict | `packages/ws-replication/src/plugin.ts` L446–448/L552–555；diff 未含该区间 | 无 |
| instance-replication-v1.md | wire 帧/状态机/错误码/关闭语义（协议权威域） | 零 wire 触碰：改动为进程内服务对象构造形态；`docs/protocols/**`、帧/状态机/错误码零改动 | no-conflict | git status 改动集（无 docs/ 条目） | 无 |
| 三包 AGENTS.md | clock：公共 API 只经 `src/index.ts`、ManualClock 留 testing 导出；namespace-registry：公共 API 边界与生命周期次序；ws-replication：自有发布 service 所有权、改 wire 前读协议（触发条件不成立） | `index.ts`/`testing.ts` 导出面零改动（ManualClock 仍仅经 `@nomicore/clock/testing`）；无新公共 API；registry 生命周期次序（停接纳→drain→取消 idle timer→关 runtime→聚合失败）在逐字平移的闭包体内保持；无共享测试设施新建 | no-conflict | 三包 `AGENTS.md`；git status；三测试文件（helper 包内复制） | 无 |
| 前置门禁 SA8 报告 §5/§8 | Frozen surfaces 1–10 + 非冲突提醒 1–6（稳定闭包、shutdown 不 async、AC4 分支、不误伤数据载荷、fake timer 范围外、status 已 getter） | 逐项闭合见 §5 表（10/10 保持）；提醒全部落实：`shutdown` 保持非 async 函数表达式（diff 中 `const shutdown = (): Promise<void> => {`，exact-same-Promise 注释随体平移）；`clonePlainData`（L763–772）与 `namespace-runtime copyFrozen` 零触碰；fake timer 未扩散改造；hub/peer `status` getter 原样（SA3 澄清稳定闭包断言仅适用函数成员——`status` 为快照值 getter，非函数成员，与 ADR L45「函数成员」口径一致，非契约弱化） | no-conflict | `task_issue-330_conflict_report.md` §5/§8；本报告 §5 逐项核对；diff | 无 |

裁决分布：no-conflict 10 项、implements-existing-decision 2 项、evolution-required 0、hard-conflict 0。

## 4. Overrides

| Old decision | Override authority | Scope | New obligation |
|---|---|---|---|
| — | — | — | — |

无 override：实现严格落在已接受 ADR 0023 的裁决范围内；Issue-comments 为 `[]`，不存在 Owner 评论来源的 override 权威，亦无其被消费的记录；无 ADR/CONTEXT/协议修订需求（见 §6）。

## 5. Frozen surfaces

前置门禁 §5 所列冻结面逐项核对实际 diff（本次为闭合核对，「待实现核对」全部出清）：

| Surface | Must remain unchanged | Evidence | Actual result |
|---|---|---|---|
| Cordis service 名 | `nomicoreRegistry`/`nomicoreHubReplication`/`nomicorePeerReplication`/`clock` 四字符串不变 | plugin.ts L27–28、namespace-registry/plugin.ts L67、contract.ts L20 | **保持**（四常量不在任何 diff hunk；registry 测试并断言 `NOMICORE_REGISTRY_SERVICE === 'nomicoreRegistry'`） |
| 公共 TS 类型面 | 五接口零变化；接口不区分数据/访问器 | ADR 0023 L70；简报 AC5 | **保持**（`types.ts` 零改动；plugin.ts 接口区块 L35–56 不在 hunk 内；`contract.ts`/`manual.ts` 接口段零改动；root typecheck + vitest Type Errors 绿——SA3 日志） |
| 冻结姿态 | 五对象 `Object.freeze` 保留；赋值与 `defineProperty` 重定义仍拒；getter 返回同一稳定闭包 | ADR 0023 L64–74 | **保持**（五处 freeze 调用原样；三测试姿态断言组 + `service.m === service.m` 断言全绿；既有 `Object.isFrozen` 断言在 root 3596 用例中保持绿） |
| 枚举性/键序 | `Object.keys(systemClock) === ['now']`、ManualClock `[now,set,advance]`；五服务键序不变 | clock-contract.test.ts；ADR 0023 L73 | **保持**（字面量成员序未动；三新测试各带 `Object.keys` 键序断言；既有键面断言文件零改动且绿） |
| 方法行为/状态机 | 方法体一行不动；`shutdown` 非 async、exact-same-Promise；hub/peer `stop` 缓存 Promise | ADR 0023 L45；registry.ts 注释契约 | **保持**（`git diff -w` 语义残渣仅声明形态与注释；`shutdown` 为非 async 函数表达式，注释随体平移；测试断言 `p.shutdown() === first`、`p.stop() === first`） |
| plugin teardown 次序 | `ctx.effect` 内 revoke→stop reverse-yield | plugin.ts L438–445/L540–545（原区间） | **保持**（两 `ctx.effect` 块逐字未动，现行 L446–448/L552–555 实读；`stop` const 零提升） |
| Registry 信封/常量 | issue/status 冻结常量与结果联合形态不变 | registry.ts L465–591；ADR 0023 L41 | **保持**（registry hunk 仅 L2179+；常量区零触碰；测试 `getStatus()` 同引用断言） |
| 数据载荷快照纪律 | `clonePlainData`/`copyFrozen` 的 `writable: false` 不被误伤 | registry.ts L763–772；namespace-runtime/runtime.ts | **保持**（registry diff 无该区间 hunk；working tree 实读 L763–772 原样；namespace-runtime 零改动） |
| testing 导出边界 | ManualClock 仅经 `@nomicore/clock/testing`；不新建共享测试设施 | clock/AGENTS.md；ADR 0023 L90 | **保持**（`index.ts`/`testing.ts` 零改动；helper 三份包内复制，无共享模块） |
| wire 协议 | 帧/码/状态机零触碰 | instance-replication-v1.md | **保持**（改动集无 docs/ 与协议相关代码） |

## 6. Evolution requirements

无。实现是已接受 ADR 0023 的逐字兑现，未改变任何既有契约；CONTEXT.md 术语已预先登记（L129–131），无需本变更集修订任何 ADR、CONTEXT 或协议文档。旧引用更新面：无（无文档引用五服务的「数据属性」形态——ADR 0023 自身即描述改前/改后两种形态）。

## 7. Hard conflicts

无。`git diff -w` 证明无夹带行为变更；改动集恰为 ALLOW 面（4 源文件 + 3 测试文件 + 技能强制 wiki 证据产物），DENY 面零触碰。

## 8. Required actions

无阻塧行动。备案（非本仓义务，不构成后续冲突复查触发）：

1. **仓外联动**（ADR 0023 L93 后半）：DSH 侧 `nomicore-host` 用新 tarball 重建、revision 切换 live reload、回退 DSH fork 沙箱守卫——host 侧动作；本仓边界止于三 tgz 可构建且 dist 含访问器形态产物（已核验）。
2. **DSH 沙箱一般性缺陷**（ADR 0023 L95–97 残留）：host 侧后续议题。
3. **未来新增对象字面量服务的访问器构造纪律**：ADR 0023 已冻结为纪律，由 code review 执行（lint 规则化属独立改进）。
4. SA2 MINOR O1（设计骨架注解笔误）已按「以源码现行为准」处置，实现无传导错误；O2/O3（行号漂移/构建入口表述）无实质影响——均与本冲突域无关，仅备案。

## 9. Verdict

**clear** —— 全部对照项为 no-conflict（10）或 implements-existing-decision（2）；无 evolution-required（零决策演进、零文档修订需求）、无 hard-conflict、无 override 需求。实现 diff 与 ADR 0023 的决策条款、影响面表、姿态对照、验收节逐项一致；前置门禁 §5 冻结面 10/10 闭合核对通过；红→绿证据链（HEAD 18/18 函数成员 THROW → 改后全绿）与 root 门禁产物在案。实现可以进入后续验收/合并流程。

## 10. requiresConflictRecheck

**false** —— 本报告即前置门禁所要求的实现后复查，且已闭合：公共 API 运行时形态（五服务属性形态）已按 ADR 0023 逐项核对；TS 类型面、wire、schema、持久化、状态机、生命周期（teardown 次序）、失败语义（错误信封/loud 校验/幂等 Promise 语义）经 diff 与断言证据核对全部保持；无正式 override 待核对；无文档演进待落地。剩余事项（§8 备案 1–3）均为仓外/host 侧或既有纪律的例行执行，不构成新的决策面。
