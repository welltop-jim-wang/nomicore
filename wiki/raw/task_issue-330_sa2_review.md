# SA2 设计攻击评审 — Issue #330 nomicore 服务表面 getter 化（ADR 0023 机械落地）

- 派发：`sa-45d9924b-6b86-4a8f-9b45-ccedf9399097`（role `mabf-sa2`，phase `design-review`，iteration 0）
- 评审对象：`wiki/raw/task_issue-330_design.md`（SA1，iteration 0）
- Worktree：`/home/wangjian/nomicore-fix-issue-330`（branch `mabf/issue-330`，HEAD `83581b3` 实核：`git log --oneline -1` = `83581b3 docs(adr): ADR 0023 服务表面 getter 化…`）
- 评审方式：全新视角独立攻击。全部关键行号锚点、消费侧审计结论、测试入口与门禁命令均由本评审在 HEAD **重新实读核验**（不采信设计自述）。

## 1. Reviewed inputs

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-330.md`（任务简报，Issue 正文 AC1–AC8 + 明确不改清单；`Comments` 空） | 已读 |
| `wiki/raw/task_issue-330_design.md`（SA1 设计） | 已读（509 行全文） |
| `wiki/raw/task_issue-330_sa6_contract.md`（SA6 契约，verdict `approve`） | 已读 |
| `wiki/raw/task_issue-330_sa6_red_probe.log`（红证据，49 行 JSON） | 已读（逐行抽样核对 §5 红表） |
| `wiki/raw/task_issue-330_relevant_decisions.md`（SA8 决议摘录） | 已读 |
| `wiki/raw/task_issue-330_conflict_report.md`（SA8 冲突报告，verdict `clear`，`requiresConflictRecheck=true`） | 已读 |
| `docs/adr/0023-proxy-consumable-frozen-service-surfaces.md`（母法） | 已读全文 |
| `CONTEXT.md` L129–131（服务表面术语 + Avoid 红线） | 已读 |
| 源码实读：`registry.ts`（L605–649/L750–779/L2100–2282 + 工厂全名冲突扫描 L700–2100）、`ws-replication/src/plugin.ts`（L1–140/L410–549）、`clock/src/system.ts`、`manual.ts`、`contract.ts`、`namespace-registry/src/plugin.ts`、`types.ts`、`instance/src/index.ts`、`persistence/src/service.ts`、`apps/yjs-server/src/app.ts`、`ws-replication/src/testing.ts` | 已读 |
| 测试实读：`clock-contract.test.ts`、`registry-plugin.test.ts`（测试 22 + `mountHubInstance`）、`ws-replication-plugin.test.ts`（`dependencies()`）、`registry-surface.test.ts`、`clock-surface.test.ts` | 已读 |
| 运行环境实读：`vitest.config.ts`、`tsconfig.base.json`、`tsconfig.typecheck.json`、root `package.json`、三包 `package.json`（typecheck/build 脚本）、`scripts/build-local-packages.mjs`/`build-package.mjs`、`.github/workflows/ci.yml` | 已读 |
| 独立全仓扫描：生产代码全部 `ctx.provide` 站点、`getOwnPropertyDescriptor` 消费、`vi.spyOn`/`Object.assign`、`deepFreeze`、三包 `\bwritable\b` 断言 | 已执行 |

`wiki/raw/task_issue-330_sa2_review.md` 此前不存在（SA1 §14 记录一致）；本文件为首个评审产物。

## 2. Verdict

**`approve`**

无 BLOCKER、无 MAJOR。设计可以安全交付 SA3 实施。核心理由：

1. **机械规格与源码逐点对齐**：设计 §7.2 五处变换规格的每一行骨架（提升点、作用域、注解、体平移范围、成员序）与 HEAD 源码实读一致；未发现任何会导致行为漂移的偏差。
2. **排除面经独立全仓扫描证实完备**：本评审枚举生产代码全部 6 个 `ctx.provide` 站点——`nomicoreRegistry`/hub/peer/`clock`（=systemClock|ManualClock 实例）4+1 个表面恰为改造面；`nomicoreInstance`（纯数据冻结字面量，instance/src/index.ts L60–64 实读）与 `nomicorePersistence`（class，`persistence/src/contract.ts` L518 提供站点实读）天然合规，排除正确。**不存在被遗漏的第六个冻结字面量函数成员服务表面**。
3. **上游证据链闭合**：SA6 红证据（18/18 函数成员访问抛同型 `TypeError`、`status`×2 已绿、负控/敏感性/姿态探针、200/200 稳定）与 probe log 逐行对上；设计的红→绿流程纪律（§12.2）直接采纳 SA6 §13。
4. **冻结姿态与稳定闭包约束可执行**：§7.3/§7.4 的不变量均落为可执行断言（§7.6 姿态断言块与 SA6 §12.4 逐字一致），且 teardown `yield stop` 引用同一性、`shutdown` 非 async exact-same-Promise、成员序/枚举性等既有绿灯锚全部显式保持。
5. **测试计划落在真实入口**：三条新测试路径命中 `vitest.config.ts` include glob（同目录兄弟文件在 SA6 基线实跑被收集）；`--typecheck` + 文件过滤 + `--passWithNoTests=false` 命令形态有 ci.yml L106/L111 先例；三包 `typecheck` 脚本与 `tsconfig`（含 `test/**`）实存，新测试文件被 root/包 typecheck 覆盖。

两条 MINOR 观察见 §14，均不阻断。

## 3. 需求覆盖

| Requirement | Design section | Assessment |
|---|---|---|
| AC1 registry 全函数成员访问器化 + 经 Cordis 组合后 guard-proxy 消费回归 | §7.2 S1、§7.6（registry seam）、§12.1 | 覆盖。7 成员清单与 HEAD `registry.ts` L2179–2281 实读逐一相符；seam 对齐 `registry-plugin.test.ts` 测试 22（L165–180 实读核实，`mountHubInstance` = `createInstancePlugin().apply` 包装，L93 实读） |
| AC2 Hub/Peer 同款 + 各一款 guard-proxy 回归，覆盖 issue 列出的成员 | §7.2 S2/S3、§7.6、§12.1 | 覆盖且为超集：issue 清单 peer 侧未列 `stop`，设计/SA6（§12.2 #14）补入——合理强化，非范围扩大 |
| AC3 systemClock + ManualClock 同款 + guard-proxy 用例；既有 `Object.isFrozen` 断言保持绿 | §7.2 S4/S5、§7.4、§12.1 | 覆盖。`clock-contract.test.ts` 键面/isFrozen 断言实读在场；字面量 getter 默认 enumerable、成员序保持 → 断言保持绿的论证成立（probe 模型行 2/5/6 佐证） |
| AC4 既有 data 形态断言更新或审计结论记录在案 | §7.7 | 覆盖，走审计分支。本评审独立复跑 `grep -rn "\bwritable\b"`（排除 `writableLength`）：三包恰 2 处命中——`types.ts:518`（文档注释词）、`registry.ts:766`（`clonePlainData` 数据载荷）——**确无服务成员 `writable === false` 断言**，分支选择正确；"审计结论写入 SA3 实现说明"已列为任务内必要条件（§13） |
| AC5 `Object.freeze` 保留；赋值/`defineProperty` 重定义仍拒；TS 公共类型面零变化 | §7.2 R5、§7.4、§12.1 | 覆盖。姿态断言块 8 行逐条对应；接口零改动依据充分（5 接口均属性签名式，实读核实） |
| AC6 helper 包内复制约 10 行，不新建共享测试设施 | §7.6、§11 DENY | 覆盖。helper 与 SA6 §12.3/附录 A 逐字同款；"任何新建共享测试 helper" 入 DENY |
| AC7 三包门禁 + root typecheck/test 全绿 | §12.3 | 覆盖。命令集实存可执行（三包 `typecheck` 脚本、root 脚本实读） |
| AC8 三包 local tarball 可构建 | §12.3、§8 路线 3 | 覆盖。`tsconfig.base.json` target ES2022 实读（getter 为 ES5+ 语法，任何 ≥ES5 target 原生保留，设计论证偏保守即更强）；DSH 侧联动明确划为仓外（与 SA6 §12.6 范围外说明一致，非静默缩小——AC8 本文只要求"可构建"） |
| Issue「明确不改」清单（instance/persistence/timer/lease/session/信封） | §1 非目标、§11 DENY | 逐项一致，无静默扩大或缩小 |

## 4. Owner评论覆盖

Issue-comments REST 读取结果为 `[]`（派发说明 + 简报 `Comments` 空节 + SA6 §2 + SA8 §1 一致记录）。**无 Owner 评论、无 comment ID/时间戳可应用**——设计 §4 的记录与此相符，无遗漏义务。全部义务 = Issue 正文 AC1–AC8 + ADR 0023，设计的来源映射表（§4）逐条核验无缺。

## 5. 上游事实与SA8约束

| Fact or constraint | Design response | Assessment |
|---|---|---|
| 红证据：guard-proxy 下 18/18 函数成员访问抛 `read-only and non-configurable data property ... did not return its actual value`；hub/peer `status` 已 getter 2/2 绿 | §3/§5 引用并按目标形态落地 | 本评审抽读 probe log 全部相关行（模型 2–6、clock 7–15、registry 17–25、hub 34–39、peer 40–48、stability 49）——与契约 §5 表逐条一致，无夸大 |
| 敏感性 E1/E6（仅属性形态翻转红绿）+ 200/200 稳定 | §5 采纳；§7.6 强制三重对照 | 采纳到位；正控防空洞绿为每文件必备项 |
| 负控排除面（instance/persistence/class/非冻结/访问器模型全绿） | §1 非目标据此固定 | 与本评审独立扫描一致 |
| SA8 Frozen surfaces 1–10（service 名、TS 类型面、姿态、枚举性、方法体/状态机、teardown 次序、信封、数据载荷、testing 边界、wire） | §6 逐条落实表 + §15 复查清单 | 10 项全部有设计落点；§15 给出实现后逐项复核清单（与 SA8 §5 闭合要求一致） |
| SA8 §8 提醒 1–6（稳定闭包/shutdown 不 async/AC4 分支/不误伤数据载荷/fake timer 范围外/status 已 getter） | §6 末行 + 对应章节 | 全部采纳，无遗漏 |
| ADR 0023 L45–62（决策与范例）、L64–74（姿态对照）、L78（deepFreeze 注意）、L90–93（验收） | §7.2/§7.4/§7.6/§12 | 逐条兑现；deepFreeze 项经本评审独立 grep（3 处 deepFreeze 均消费数据载荷/缓存/config，无服务命中面）证实"无动作"结论正确 |
| ADR L41 范围排除（lease/session 返回值非服务表面） | §1 非目标 + §11 DENY（`ws-replication/src/testing.ts` `decorateLease`） | 实读 `decorateLease`（L38–50，冻结字面量 + data 属性 bind 方法）确在排除面——它是方法返回值装饰，不经 `ctx.provide` 发布，ADR 裁决适用；设计未顺手改造，正确 |

## 6. 设计内部一致性

- **正文 ↔ 骨架 ↔ 表格 ↔ ALLOW/DENY 交叉一致**：§2.1 五服务现状表、§7.2 规格、§10 调用方矩阵、§11 文件范围、§12 验收映射五个视图的成员清单/文件路径/行为断言互不矛盾；S2/S3 的 "`status` 已是 getter、`stop` 已是命名 const 零提升" 描述与 plugin.ts L421–437/L492–539 实读一致。
- **无死引用**：设计引用的 `registry-plugin.test.ts` 测试 22、`ws-replication-plugin.test.ts` `dependencies()`、`registry-surface.test.ts` 九键断言、`clock-contract.test.ts` 键面断言、ci.yml `--passWithNoTests=false` 先例、`scripts/build-package.mjs`（经 `pnpm run build` 逐包调用，入口 `build-local-packages.mjs`）均实存。
- **无前后相反描述**：§7.4 姿态表（赋值/重定义/strict delete 全拒、枚举性与 `isFrozen` 不变）与 §7.6 姿态断言块及 ADR L64–74 三方一致；`JSON.stringify` 行（函数值成员被省略，getter 形态等价）论证正确。
- **无"附录承认但正文未改"的伪修订**：本 iteration 无评审输入（§14 记录属实——本文件即首个评审产物）。
- **骨架 TS 有效性**：S1/S2/S4/S5 骨架均为合法 TS 且注解与现有签名逐字一致（`NamespaceRegistry` types.ts L712 起、`HubReplicationService` L35–40、`PeerReplicationService` L48–56、`HubReplication.requestReauth` types.ts L178 `Promise<void>`、`PeerReplication.removeTarget` L217 `Promise<void>`、`Clock`/`ManualClock` contract.ts L14–17/manual.ts L17–20 全部实读核对）。S3 骨架有一处注解笔误（见 §14-O1），受 R3/R4 规则约束不会传导为实现错误。
- **提升作用域无标识符冲突**：本评审对 `createRegistryInternal`（L781–2282）作用域扫描 `open`/`create`/`importReplica`/`resetReplica`/`deleteNamespace`/`getStatus`/`shutdown` 七名——零既有绑定；hub/peer `apply` 作用域对 `requestReauth`/`addTarget`/`removeTarget`/`notifyAuthChanged`/`waitForLive` 同样零冲突；clock 两个文件对 `nowImpl`/`now`/`set`/`advance` 零冲突。提升闭包捕获的变量（`acceptance`/`entries`/`scheduler`/`shutdownPromise`/`replication`/`liveWaits`/`current` 等）均在外层作用域先于调用初始化，无 TDZ 风险（闭包只在构造完成后被调用）。

## 7. 状态机与并发攻击

| ID | Initial state | Trigger | Expected behavior | Design gap | Required revision |
|---|---|---|---|---|---|
| SM-1 | 任意服务实例 | 同一成员两次访问（`service.m === service.m`） | getter 返回同一稳定闭包，恒等真 | 无：§7.3.1 不变量 + §7.6 第 4 项断言 + 禁止 getter 内联函数表达式（R2/§7.3.2） | — |
| SM-2 | `createManualClock` 两实例 | 实例 A `set(100)`、实例 B `now()` | 各实例状态隔离（B 不受 A 影响） | 无：§7.2 R1/S5 作用域表明示"工厂作用域、不得提模块级（跨实例串状态）"；§13 列为最高风险点，既有 manual 多实例用例覆盖 | — |
| SM-3 | registry running | 首次 `shutdown()` 后重复/并发调用 | 恒返回同一缓存 `shutdownPromise` 实例（含已 reject） | 无：R3 + §7.2 S1 骨架保持非 async 函数表达式（L2262–2264 注释契约随体平移）+ §7.3.4 + §12.1 `p.shutdown() === first` 断言 | — |
| SM-4 | hub/peer service 已发布 | fiber dispose（reverse-yield） | 先 revoke 后 stop，`yield stop` 引用同一闭包实例 | 无：`stop` 本已是命名 const（L421/L492 实读），零提升，引用同一性天然保持（§7.3.3） | — |
| SM-5 | peer `waitForLive` 等待中 | `stop()` 触发 | `liveWaits` 全体 reject `peer replication stopped` | 无：方法体一行不动；§7.6/§12.1 验收用注入 timer + `stop()` 触发 settle（SA6 §12.2 #13），无真实 sleep | — |
| SM-6 | 任意改造成员 | 构造后 `service.m = fn` / `defineProperty` 重定义 / strict delete | 全拒（TypeError） | 无：§7.4 姿态表 + §7.6 姿态断言块三连 | — |
| SM-7 | 服务对象构造期 | 字面量求值时 getter 求值 | getter 体内只 `return` const 标识符，不求值任何实例状态 | 无：R2 显式限定 getter 体形如 `return <closureIdent>`——构造期不可抛、无副作用 | — |
| SM-8 | 键面断言（`Object.keys`） | 改造后 | 键序 = 字面量成员序不变 | 无：R2 成员声明序保持；五处骨架成员序与现源码逐一相同（本评审对照实读） | — |
| SM-9 | 进程重启 / 迟到回调 | — | 无持久化状态、无注册回调面变化 | 无：§9 明示纯机械 diff、`git revert` 即回滚；闭包内状态访问序不变 | — |

## 8. 错误与恢复攻击

| ID | Failure | Current design behavior | Risk | Required revision |
|---|---|---|---|---|
| ER-1 | getter 执行期抛错 | 不可能：getter 体只 return const（R2），构造点闭包在 freeze 前已定义 | 无新错误路径；§9 论证成立 | — |
| ER-2 | 姿态退化被静默（赋值/重定义意外成功、freeze 被移除） | 姿态断言块 8 行 + `Object.isFrozen` 既有断言，ESM strict 下任一退化即红 | fail loud 到位；R5 + CONTEXT Avoid 红线禁止去 freeze | — |
| ER-3 | 新测试空洞绿（helper 未真正包装 / 断言不敏感） | 每文件三重对照：敏感性正控（helper 套冻结 data 字面量必抛）+ 诚实 Proxy 负控 + 被测断言；禁止 skip/only/宽松断言/源码字符串断言 | 反伪绿设计充分（对应 SA6 E1/E6 敏感性证据） | — |
| ER-4 | 测试文件被删/改名/未被收集 → 静默假绿 | §12.3 新文件显式运行 + `--passWithNoTests=false`（ci.yml L44/L80/L106/L111/L116/L122 先例实读核实） | 已覆盖 | — |
| ER-5 | 平移时人为改写方法体/注释/签名 | R3「一行不动」+ §13 风险表「评审 diff 只允许声明形态变化」+ §15 冻结面逐项复核 | 流程性缓解到位 | — |
| ER-6 | tarball 产物 getter 变形 / 构建回退 | target ES2022 原生保留（无 downlevel）；AC8 `pnpm pack:local` exit 0 + 三 tgz 在场为门禁 | 论证成立且偏保守（getter 在任何 ≥ES5 target 均不被降级变形） | — |
| ER-7 | 手误伤及同文件数据载荷 `writable:false`（`clonePlainData` L763–768 / `copyFrozen`） | §11 文件内子范围 DENY + §6/§15 diff 复核项 | 排除面精确到行；本评审实读确认该代码为 JSON 域数据快照，与服务表面无涉 | — |
| ER-8 | 领域错误语义漂移（manual clock loud 校验、issue 信封、branded fatal） | 方法体逐字平移（R3）；§12.1 AC3 行含 `set(NaN)` RangeError / `set('1')` TypeError 透传断言 | 已覆盖 | — |

正常路径不变量（冻结姿态、exact-same-Promise、键面）均以断言锁定，无以 fallback 掩盖缺失的路径——本任务本身无外部故障降级面，§9 的"无新错误路径"结论与源码一致。

## 9. 契约影响审查

| API or contract | Missing or weak caller handling | Evidence | Required revision |
|---|---|---|---|
| `assertClockShape`（registry.ts L620–628 实读） | 无：`typeof clock.now === 'function'` 经 getter 取稳定闭包后 `typeof` 仍 `'function'`，门禁通过；设计明令不得借机改文案/顺序 | §10 第 1 行 + 源码实读 | — |
| peer Clock 包装（plugin.ts L482 实读） | 无：属性读取语义不变 | §10 第 2 行 | — |
| `assertPersistenceHostDependencies`（persistence/src/service.ts L27 区实读 `requireClock(ctx)`） | 无 | §10 第 3 行 | — |
| yjs-server 诊断（apps/yjs-server/src/app.ts L281 实读 `now: () => requireClock(this.ctx).now()`） | 无 | §10 第 4 行 | — |
| Cordis `ctx.provide`/`ctx.get`/`require*` | 无：对象身份、发布名、注销函数全不变 | §10；6 个 provide 站点全仓扫描 | — |
| 既有三包测试（属性读取/调用/键面/isFrozen） | 无：经 getter 取同一闭包，键面与枚举性不变（probe 模型行 2/5/6 实证） | §10 + clock-contract.test.ts 实读 | — |
| 导出面审计（registry-surface 九键、clock 双入口） | 无：七个闭包为函数作用域 const、`nowImpl` 模块级但不导出——运行时 export keys 零变化 | §8；registry-surface.test.ts L57 实读 | — |
| DSH cordis-host-runner guard Proxy（仓外） | 无：访问器成员不受 `[[Get]]` 不变量约束（probe 行 4/5 实证 ACCESS_OK + 调通 + 姿态探针） | §10 末行；ADR 0023 L8–26 | — |
| 仓内 `getOwnPropertyDescriptor` 消费 | 无遗漏：本评审独立扫描三包 + yjs-server——全部位于敌意输入校验（identity.ts L146/182/186、registry.ts L319–320/672/730/754）与测试 Proxy fixture，无一作用于五服务对象 | §2.2 消费侧审计（结论与本扫描一致） | — |
| `vi.spyOn`/`Object.assign`/spread 消费 | 无遗漏：扫描命中全部为 Error 对象装饰与文档注释，无服务对象 spy/合并/展开 | 同上 | — |

## 10. 架构一致性与惯例审查

### 责任归属

| Behavior | Expected owner | Design location | Assessment |
|---|---|---|---|
| 服务对象构造与闭包提升 | 各自拥有实例状态的构造点（registry 工厂 / ws plugin apply / clock 模块与工厂） | §7.2 逐服务作用域表 | 正确：无行为移出事实 Owner；应用层零参与 |
| 可包装性契约回归 | 各包内测试（不新建跨包设施） | §7.6 三文件 | 正确 |

### 相似能力对照

| Similar capability | Existing implementation | Proposed design | Consistent or divergent | Reason |
|---|---|---|---|---|
| 访问器形态服务成员 | hub/peer `status` getter（plugin.ts L432–434/L506–513） | 同款字面量 getter 范式（R2） | 一致 | 同文件内既有先例，ADR L54–59 钦定范式 |
| guard-proxy helper | SA6 probe（契约附录 A，约 10 行） | 逐字同款、包内复制 | 一致 | AC6/ADR L90 明令不建共享设施 |
| 冻结姿态断言 | SA6 §12.4 断言块 | §7.6 第 5 项逐字采纳 | 一致 | 契约钉死，SA1 未另创 |

未发现可比而未比的既有能力；无凭空声称惯例。

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| 服务方法实现 | 恰一次提升的稳定闭包（§7.3.2） | getter 只 return 该 const | 无第二份实现；`service.m === service.m` 断言锁死 |
| 服务实例状态 | 工厂/apply/module 作用域变量（不变） | 闭包捕获同一绑定 | 无镜像状态 |
| 冻结姿态 | `Object.freeze` + 描述符断言 | `Object.isFrozen` 既有断言 | 无文件 marker / 标签反推 / 存在性推断 |

### 生命周期对称性

| Start or acquire | Stop or release | Failure recovery | Assessment |
|---|---|---|---|
| `ctx.provide`（不变） | `ctx.effect` reverse-yield：revoke → stop（不变，L438–445/L540–545 实读） | stop 缓存 Promise / registry shutdown exact-same-Promise（不变） | 对称性零变化；`yield stop` 引用同一性由"stop 零提升"保持 |

### 平行机制检查

| Candidate duplicate | Existing path | Proposed path | Disposition |
|---|---|---|---|
| 共享 guard-proxy 测试 helper | 无（各包测试自治） | 每包内联复制 | 正确拒绝共享化（AC6） |
| facade/门面服务、fork 守卫、class 改造 | ADR 0023 L83–86 已否决 | 未采用 | §7.5 备选表与 ADR 逐条对应 |
| 第二套冻结/构造机制 | `Object.freeze` 字面量 | 保持，仅属性形态翻转 | 无平行机制 |
| 新 lint/规则化 | code review 纪律 | 明确列为 follow-up 非本票 | 正确（§13 残余 3） |

无"行为落在错误 Owner / 绕过既有能力 / 双事实源 / 生命周期不对称 / 以改动更少为由偏离架构"任一阻断形态。

## 11. 文件范围审查

| Path or scope issue | Evidence | Required revision |
|---|---|---|
| ALLOW 7 路径（4 源文件 + 3 新测试文件） | 每路径均有 §7.2/§7.6 对应改造/新增内容；无多余路径 | 无 |
| `registry.ts` ALLOW + 文件内子范围 DENY（L763–772 `clonePlainData`） | 实读 L763–768 为数据载荷 `writable:false` defineProperty；子范围排除精确 | 无 |
| `plugin.ts` ALLOW + 接口区块 L35–56 子范围排除 | 实读接口在 L35–56，排除面正确 | 无 |
| DENY 无与正文冲突项 | §1 非目标 ↔ §11 DENY ↔ issue「明确不改」三方一致；`decorateLease`、`NOOP_DIAG`、`copyFrozen`、instance、persistence、config/vitest/ci/scripts、`apps/**`/`domains/**`/其余 packages 均有明确禁止理由 | 无 |
| ALLOW 无无理由扩张 | 未包含任何非必要路径（无 index.ts/testing.ts 源文件改动——导出面零变化使然） | 无 |
| follow-up 未掩盖本任务必要项 | §13「任务内必要条件」明列四源文件、三测试文件、验证门、AC4 审计入实现记录；DSH 侧联动为 issue/ADR 自身划定的仓外边界 | 无 |

## 12. 验收设计审查

| Requirement or risk | Proposed evidence | Gap | Required revision |
|---|---|---|---|
| AC1/AC2/AC3 可包装性 | 三新文件：guard Proxy 逐成员访问不抛 + 调用行为直通（deep-equal、exact-same Promise、错误语义透传、注入 timer settle） | 无：断言观察运行时行为，非源码文本（源码字符串断言被明令禁止） | 无 |
| AC5 姿态 + 类型面 | 描述符 8 行断言块 + 赋值/重定义 throw + root typecheck + 既有 test-d | 无 | 无 |
| 红→绿真实性 | §12.2：SA3 先落地测试在 HEAD 复跑捕获红（预期同 SA6 §5 表）再改造转绿 | 无：防"直接声称红" | 无 |
| 空洞绿/伪绿 | 三重对照（敏感性正控必抛 + 诚实负控必不抛 + 被测断言）；skip/only/todo/env override/fallback/吞错全禁 | 无 | 无 |
| 测试入口真实性 | include glob 命中（本评审核对 `vitest.config.ts` + 兄弟文件基线收集）；`tsconfig.typecheck.json`/包 tsconfig 含 `test/**` → 新文件受 typecheck 门禁覆盖；命令形态有 ci.yml L106/L111 先例；三包 `typecheck` 脚本实存 | 无 | 无 |
| 并发/幂等/回归 | `shutdown()` exact same Promise ×3 形态、`stop` 缓存 Promise 恒等、既有 1010 用例基线全绿保持 | 无 | 无 |
| AC4 | 审计分支 + 结论入实现记录（本评审独立复跑 grep 证实结论成立） | 无 | 无 |
| AC8 | `pnpm pack:local` exit 0 + 三 tgz + dist 含访问器产物；构建失败即门禁红 | 无 | 无 |

## 13. Required revisions

无 BLOCKER、无 MAJOR finding。设计可原样交付 SA3 实施。实现阶段须按设计 §12.2 红先绿后、§12.3 全门禁、§15 冻结面复查执行（该复查已由 SA8 `requiresConflictRecheck=true` 规定，非本评审新增义务）。

## 14. Non-blocking observations

| ID | Observation | Evidence | Suggested disposition |
|---|---|---|---|
| O1（MINOR） | §7.2 S3 骨架 `waitForLive` 注解行笔误：`): Promise<void => new Promise<void>(…` 缺一个 `>`，按字面复制不是合法 TS。正确形态在源码 plugin.ts L517（`(namespaceId: string) => new Promise<void>((resolve, reject) => {`）；且 R3「体一行不动」+ R4「注解逐字取自接口」两规则使正确结果无歧义，不会实际传导为错误实现 | 设计 L207 vs plugin.ts L517 实读 | SA1 下次原位修订设计时改为 `): Promise<void> => new Promise<void>(`；SA3 实施以源码现行为准 |
| O2（MINOR） | 个别行号锚点小漂移：§2.2 称 clock-contract.test.ts manual 键面/isFrozen 断言在 L109–113（实测 `it` 块在 ~L108–110，断言 L109–110）；§2.1/§11 称 `clonePlainData` L763–772（defineProperty 块实测 L763–768）。断言与代码均在場且被定位，无实质影响 | 本评审 sed 实读 | 无需修订；引用时以"约"或直接 grep 定位 |
| O3（备注） | §2.2 「`pack:local` 走 `scripts/build-package.mjs`」表述可更精确：入口为 `scripts/build-local-packages.mjs`，其逐包调用 `pnpm run build`（= `node ../../scripts/build-package.mjs`，clock package.json L19 实读）。语义上无错 | scripts/ 实读 | 无需修订 |

## 15. 裁决与路由建议

- **Verdict：`approve`**——需求、Owner 评论（空）、上游事实、SA8 约束、状态机、错误恢复、调用方、架构一致性、文件范围、验收设计十个维度均足以安全实施。
- 路由：设计原样进入 SA3 实现；SA3 须遵守 §12.2 红先纪律与 §7.2 R1–R6 / §7.3 稳定闭包纪律；实现 diff 按 SA8 §5 + 设计 §15 做冻结面冲突复查（既有流程义务，非本评审新增）。
- 本评审未发现需要重新执行 ADR 冲突检查的新风险（不提交 `requiresConflictRecheck`）：五表面改造均在已接受 ADR 0023 的裁决范围内，无决策演进、无新表面、无 override。
