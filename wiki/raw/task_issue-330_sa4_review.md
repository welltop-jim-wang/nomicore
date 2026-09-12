# SA4 实现静态审查 — Issue #330 nomicore 服务表面 getter 化（ADR 0023 机械落地）

- 派发：`sa-19bfcc12-f0c0-45ed-8e96-799b77d3ed95`（role `mabf-sa4`，phase `implementation-review`，iteration 0）
- 审查对象：branch `mabf/issue-330`（HEAD `83581b3`）上的未提交实现 diff——4 个跟踪源文件（`packages/clock/src/system.ts`、`packages/clock/src/manual.ts`、`packages/ws-replication/src/plugin.ts`、`packages/namespace-registry/src/registry.ts`）+ 3 个新增测试文件（三包 `*-guard-proxy-consumption.test.ts`）
- Worktree：`/home/wangjian/nomicore-fix-issue-330`
- 审查方式：静态实读（diff、源码、测试、日志证据、配置与 CI 入口）；本审查未运行测试、未启动服务、未修改任何实现/设计/测试。全部关键结论以只读命令在本 worktree 复核（`git diff`/`git diff -w`/hunk 定位/grep 全仓扫描/日志逐行抽读/dist 产物抽查）。

## 1. Reviewed inputs

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-330.md`（任务简报，AC1–AC8；`Comments` 空——REST Issue-comments 读取 `[]`，无 owner 要求、无 comment ID/时间戳可应用） | 已读 |
| `wiki/raw/task_issue-330_sa6_contract.md`（SA6 验收契约，verdict `approve`） | 已读 |
| `wiki/raw/task_issue-330_sa6_red_probe.log`（HEAD 红证据） | 已读（抽样核对 §5 红表） |
| `wiki/raw/task_issue-330_design.md`（SA1 设计，§7.2 S1–S5、R1–R6、§7.3–§7.7、§11、§12、§15） | 已读 |
| `wiki/raw/task_issue-330_sa2_review.md`（SA2 设计评审，verdict `approve`；MINOR O1–O3） | 已读 |
| `wiki/raw/task_issue-330_sa3_impl.md` + `_sa3_red/_green/_root-test/_pack-local.log`（SA3 实现报告与原始证据） | 已读（日志逐段核验，见 §9） |
| `wiki/raw/task_issue-330_relevant_decisions.md`、`task_issue-330_conflict_report.md`（SA8 前置门禁 `clear`、`requiresConflictRecheck=true`） | 已读 |
| `wiki/raw/task_issue-330_implementation_conflict_report.md`（SA8 实现后复查 `clear`、`requiresConflictRecheck=false`） | 已读 |
| `docs/adr/0023-proxy-consumable-frozen-service-surfaces.md`（母法，决策/姿态/验收全文） | 已读 |
| `CONTEXT.md` L129–131（服务表面术语 + Avoid 红线）、三包 `AGENTS.md` | 已读（经 workspace 指令注入与实读） |
| 源码实读：`registry.ts`（工厂末段 diff 与 `clonePlainData` L763–768 区间）、`plugin.ts`（hub/peer `apply` 段与 `ctx.effect` 块）、`system.ts`、`manual.ts`、`dsh-persistence/src/clock.ts`（额外消费者） | 已读 |
| 测试实读：三个新测试文件全文、`ws-replication-plugin.test.ts`（`dependencies()` seam 对照）、`clock-contract.test.ts`（既有键面/isFrozen 断言） | 已读 |
| 运行环境实读：`vitest.config.ts`、`tsconfig.typecheck.json`、root `package.json`、`packages/clock/tsconfig.json`、`.github/workflows/ci.yml`、`.gitignore` | 已读 |

## 2. Verdict

**`approve`**

无 BLOCKER、无 MAJOR。实现是 SA1 设计 §7.2（R1–R6）与 ADR 0023 L45–62 的忠实机械落地：五处服务表面全部函数成员改为「工厂/apply/模块作用域稳定闭包 + 字面量 getter」，`git diff -w` 证明方法体逐字平移（残渣仅为声明形态行、ADR 注释与 R4 显式注解），`Object.freeze` 五处保留、成员序与枚举性不变、接口面零触碰（`types.ts`/`contract.ts` 零改动，`plugin.ts` hunk 全在 L431+）。三个新测试文件三重对照齐备、姿态断言逐成员覆盖、被全部真实入口收集（root `pnpm test` 341 文件 / 3596 用例含三文件全绿；包 tsconfig 含 `test/**` 进 typecheck 门禁；CI shard 按磁盘枚举自动纳入），且红→绿证据链真实（HEAD 红 8 用例含原始 ECMA-262 不变量错误消息 → 改后绿）。四条非阻断观察见 §12。

## 3. 上游要求落实

Owner 评论：无（REST `[]`，与简报/SA6 §2/SA8 §1 一致）。全部义务 = Issue AC1–AC8 + ADR 0023。

| Requirement or finding | Implementation evidence | Assessment |
|---|---|---|
| AC1 registry 全函数成员访问器化 + 真实 Cordis 组合后 guard-proxy 消费回归 | `registry.ts` 七闭包提升（`createRegistryInternal` 内 `runShutdown` 后、字面量前）+ 七 getter；`registry-guard-proxy-consumption.test.ts` 真实组合（instance+manual clock+fake timer+memory persistence+registry plugin）取 `requireNomicoreRegistry(ctx)`，7 成员 sweep 全 ACCESS_OK + open/create/importReplica/resetReplica/deleteNamespace 直连 deep-equal + `getStatus()` 同引用 + 姿态组 | 覆盖 |
| AC2 Hub/Peer 同款 + 各一款回归（既有插件 seam），覆盖 `status`/`requestReauth`/`stop` 与 `status`/`addTarget`/`removeTarget`/`notifyAuthChanged`/`waitForLive` | `plugin.ts` hub `requestReauth` 提升 + 2 getter（`status`/`stop` const 不动）；peer 四闭包提升 + 5 getter；测试 seam 与 `ws-replication-plugin.test.ts` `dependencies()` 逐行同款（实读比对）；两服务全清单成员 sweep + 行为断言 | 覆盖（超出 issue 清单补入 peer `stop`，SA2 已判定合理强化） |
| AC3 systemClock + ManualClock 同款 + guard-proxy 用例；既有 `Object.isFrozen` 断言保持绿 | `system.ts` 模块级 `nowImpl`；`manual.ts` 工厂作用域三闭包；clock 测试含 plugin 发布通道（`requireClock` 后仍是同一实例 `toBe` 断言）；`clock-contract.test.ts` 零改动且在 root 3596 用例中绿 | 覆盖 |
| AC4 既有 data 形态断言更新为访问器形态，无则审计结论记录在案 | SA3 报告 §AC4 记录在案；本审查独立复跑 `grep -rn "\bwritable\b" ... | grep -v writableLength`——恰 2 命中（`types.ts:518` 注释词、`registry.ts:766` clonePlainData 数据载荷），确无服务成员 `writable === false` 断言 → 审计分支正确 | 覆盖 |
| AC5 `Object.freeze` 保留；赋值/`defineProperty` 重定义仍拒；TS 公共类型面零变化 | 五处 freeze 调用原样（diff 上下文逐一确认）；`expectAccessorPosture` 断言块（`'value' in d === false`/`get` function/`set === undefined`/`configurable === false`/`enumerable === true`/`isFrozen`/赋值与 defineProperty `toThrow(TypeError)`）逐成员套用；接口文件零改动，root typecheck 与 vitest `--typecheck` 均 `Type Errors no errors` | 覆盖 |
| AC6 helper 包内复制（约 10 行），不新建共享测试设施 | 三文件各内联 `guardProxy`（语义逐字同款 SA6 §12.3/设计 §7.6：`Reflect.get` + 函数成员返回 `(...args) => Reflect.apply(value, receiver, args)`）；无新共享模块/导出 | 覆盖 |
| AC7 三包门禁 + root `pnpm typecheck` / `pnpm test` 全绿 | SA3 验证表 + `_sa3_green.log`（3 文件 8 用例 + Type Errors no errors）、`_sa3_root-test.log`（341 文件/3596 用例，第 579/580/603 行含三个新文件）、三包 `pnpm --filter typecheck` 与 root `pnpm typecheck` exit 0 | 覆盖（typecheck 证据形态见 §12-O2） |
| AC8 三包 local tarball 可构建 | `_sa3_pack-local.log`（14 tgz，含 clock/namespace-registry/ws-replication 三包）；本审查抽查 `packages/*/dist`：`get now() { return nowImpl; }`、hub `get requestReauth/stop`、peer `get addTarget/.../waitForLive/stop`、registry 七 getter（ES2022 无 downlevel 变形） | 覆盖（DSH 侧重建为仓外，ADR L93 后半，SA3 已正确划界） |
| SA2 O1（S3 骨架 `Promise<void =>` 注解笔误） | 实现为 `const waitForLive = (namespaceId: string): Promise<void> => new Promise<void>(...)`（正确形态，体逐字平移）——按 SA2 建议以源码现行为准处置 | 已落实 |
| SA6 红→绿流程纪律（先在 HEAD 捕获红） | `_sa3_red.log` 13:29 → `_sa3_green.log` 13:31 → root-test 13:43；红 log 含原始不变量错误消息（`'get' on proxy: property 'shutdown' is a read-only and non-configurable data property ...`）——不可能由改造后代码产生，红为真实 HEAD 红 | 已遵守 |

## 4. 设计落实审查

| Design decision | Implementation location | Assessment | Finding |
|---|---|---|---|
| R1 提升作用域（S1 工厂/S2·S3 apply/S4 模块/S5 工厂，恰一次） | registry 七闭包在 `createRegistryInternal` 内；hub/peer 在 `apply` 内；`nowImpl` 模块顶层（单例无实例状态）；manual 三闭包在 `createManualClock` 内捕获本实例 `current` | 一致；无模块级提升带实例状态的闭包（manual 多实例隔离由测试 `createManualClock ×2` 覆盖并绿） | — |
| R2 getter 形态（体只 `return` 闭包标识符；成员序不变） | 全部 18 个 getter 体均为单 `return <const>`；registry 7 序/hub 3 序/peer 6 序/clock `['now']`/manual `['now','set','advance']` 与原字面量成员序逐一相同（测试以 `Object.keys` 精确断言） | 一致 | — |
| R3 方法体一行不动（注释随体） | `git diff -w` 残渣仅为：声明形态行（`},`→`};`、方法简写→`const x = ... =>`）、ADR 注释、getter 字面量；`shutdown` 的 exact-same-Promise 注释（原 L2262–2264）随体平移 | 一致 | — |
| R4 提升闭包显式注解（参数+返回类型逐字取自接口/原签名） | 18 个提升闭包全部显式注解（含 SA2 O1 修复点 `waitForLive`） | 一致 | — |
| R5 `Object.freeze` 保留 | 五处 freeze 原样 | 一致 | — |
| R6 `this` 无关性 | 原方法体均无 `this` 引用（体逐字平移 ⇒ 保持）；箭头闭包 + guard `Reflect.apply(value, receiver, args)` 与直连结果一致（测试 deep-equal/恒等断言） | 一致 | — |
| §7.3 稳定闭包（`service.m === service.m`；teardown `yield stop` 引用同一性；shutdown 非 async） | `shutdown` 为非 async 函数表达式（`const shutdown = (): Promise<void> =>`）；hub/peer `stop` 保持既有命名 const 零提升，`ctx.effect` 块（`yield revoke; yield stop;`）逐字未动；三测试函数成员稳定闭包断言全绿；`p.shutdown() === first`、`p.stop() === first`、`p.shutdown() === p.shutdown()` 断言在场 | 一致（peer `status` 为快照值 getter，SA3 澄清稳定闭包断言仅适用函数成员——与 ADR L45「函数成员」口径一致，非弱化） | — |
| §7.4 姿态（描述符/赋值/重定义/枚举性/isFrozen） | `expectAccessorPosture` 断言块覆盖全部 18 个改造成员 + 2 个既有 `status` getter；ESM strict 下赋值与 defineProperty 均 `toThrow(TypeError)` | 一致 | — |
| §7.6 三重对照 + 姿态 + 稳定闭包 + 行为直通 | 每用例首行敏感性正控（`Object.freeze({probe})` 访问必抛 TypeError）+ 诚实 Proxy 负控 + 被测断言；行为断言含 bracket 读数、manual loud 校验透传（`set(NaN)` RangeError、`set('1')` TypeError、失败后读数不变）、registry issue 信封 deep-equal、hub/peer stop/`waitForLive` 注入 timer settle | 一致（两处契约字面小偏差见 §12-O1，非弱化） | O1（MINOR） |
| §7.7 AC4 审计分支 | 见 §3 AC4 行 | 一致 | — |
| §12.3 验证门 | SA3 验证表逐项执行并留 log（除 tsc 终端输出项，见 §12-O2） | 一致 | — |
| §15 冻结面复查 | SA3 报告 10/10 逐项 + SA8 实现后复查独立闭合（`clear`） | 一致 | — |

设计明确但实现缺失项：无。

## 5. 架构一致性与惯例

### 责任归属

| Behavior | Expected owner | Actual location | Assessment |
|---|---|---|---|
| 服务对象构造与闭包提升 | 拥有实例状态的构造点 | registry 工厂 / ws plugin `apply` / clock 模块与工厂 | 正确；无行为移出事实 Owner，无应用层参与 |
| 可包装性契约回归 | 各包内测试 | 三包 test/ 内 | 正确；无跨包设施 |

### 相似能力对照

| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
|---|---|---|---|---|
| 访问器形态服务成员 | hub/peer `status` getter（plugin.ts 既有） | 同款字面量 getter 范式 | 一致 | 同文件既有先例，ADR L54–59 钦定 |
| guard-proxy helper | SA6 probe / 设计 §7.6 | 三包内联复制，逐字同款 | 一致 | AC6 明令不建共享设施 |
| 测试组合 seam | `registry-plugin.test.ts` 测试 22、`ws-replication-plugin.test.ts` `dependencies()` | 逐行对齐复制（ws 的 `dependencies`/`transport` 与既有文件 L17–33 实读一致；peer `plugin.apply(ctx)` 同步调用亦同既有 L159 惯例） | 一致 | 复用既有 seam，无新抽象 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| 服务方法实现 | 恰一次提升的稳定闭包 | getter 只 return 该 const | 无第二实现；`m === m` 断言锁死 |
| 服务实例状态 | 工厂/apply/模块作用域变量（不变） | 闭包捕获同一绑定 | 无镜像状态 |
| 冻结姿态 | `Object.freeze` + 描述符断言 | `Object.isFrozen` 既有断言 | 无 marker/标签反推 |

### 生命周期对称性

| Start or acquire | Stop or release | Failure recovery | Assessment |
|---|---|---|---|
| `ctx.provide`（不变） | `ctx.effect` reverse-yield revoke→stop（逐字未动，实读 hub L441–448/peer L550–556 现行） | stop 缓存 Promise / shutdown exact-same-Promise（不变） | 对称性零变化；测试均以 `ctx.fiber.dispose()` 收尾 |

### 平行机制检查

| Candidate duplicate | Existing path | Actual path | Disposition |
|---|---|---|---|
| 共享 guard-proxy helper | 无 | 三份包内复制 | 正确拒绝共享化 |
| 第二构造/冻结机制、facade、fork 守卫 | ADR 0023 L83–86 已否决 | 未采用 | 无平行机制 |
| 新 lint/规则化 | code review 纪律 | 未引入 | 正确（设计 §13 残余 3） |

## 6. 文件范围审查

| Changed path | ALLOW entry | Purpose | Assessment |
|---|---|---|---|
| `packages/clock/src/system.ts` | ALLOW 1（§7.2 S4） | `nowImpl` + getter | 合规；diff 仅此 |
| `packages/clock/src/manual.ts` | ALLOW 2（§7.2 S5） | 工厂作用域三闭包 + getter | 合规 |
| `packages/ws-replication/src/plugin.ts` | ALLOW 3（§7.2 S2/S3） | hub/peer getter 化 | 合规；hunk 恰 4 个全在 L431+/L509+，接口区块 L35–56 与 `clock` 包装 L482 不在任何 hunk 内 |
| `packages/namespace-registry/src/registry.ts` | ALLOW 4（§7.2 S1；文件内子范围 DENY L763–772） | 七闭包 + getter | 合规；hunk 恰 2 个全在 L2179+，`clonePlainData` 区间零触碰（`-U0` hunk 头实证） |
| 三新测试文件 | ALLOW 5–7 | 回归（AC1/2/3/5/6） | 合规；路径与 SA6 §12.5 钉死一致 |
| `wiki/raw/task_issue-330_*`（SA3 报告/4 log/上游产物/本审查） | 设计 ALLOW 外的技能强制产物 | 过程证据 | 与仓库既有惯例一致（wiki/raw 大量先例）；零源码/构建面影响 |

- `git status --short`：跟踪改动恰 4 个 ALLOW 源文件；未跟踪为 3 新测试 + wiki 产物。DENY 面（`types.ts`/`contract.ts` 接口、`instance`/`persistence`/`namespace-runtime`/`ws-replication testing.ts`/`create-diagnostic.ts`、`CONTEXT.md`/`docs/**`/协议、`vitest.config.ts`/CI/`scripts/**`/三包 `package.json`、`apps/**`/`domains/**`/其余 packages）零触碰；跟踪的 `artifacts/local-packages/manifest.json` 与 `packages/instance/tsconfig.build.json` 无 diff。worktree 内 `packages/*/dist` 与 `artifacts/*.tgz` 为 gitignore 构建产物（pack:local 正常残留），不入 diff。
- 无 `/tmp` marker、无 probe 残留（`.sa6-probe-issue-330.ts` 已删）。

## 7. 契约连锁审查

| Contract | Caller | Actual handling | Risk | Finding |
|---|---|---|---|---|
| 服务成员读取（形态变化） | `registry.ts` `assertClockShape`（`typeof clock.now === 'function'`，不在 hunk）、peer `clock: { now: () => clock.now() }`（L482 不在 hunk）、`persistence/src/service.ts` `requireClock`、`apps/yjs-server/src/app.ts` L281、`packages/dsh-persistence/src/clock.ts`（`createManualClock` 消费，本审查补充枚举） | 全部为属性读取/调用——getter 返回稳定闭包后语义不变；dsh-persistence 同为属性调用形态 | 无 | — |
| `Object.freeze` 公共姿态 | 任意消费方 | 赋值/重定义/strict delete 行为同型（均 TypeError），`Object.isFrozen`、键面、`JSON.stringify`（函数成员均被省略）不变 | 无漂移 | — |
| Cordis provide/get/require | 6 个 provide 站点 | 对象身份、发布名、revoke 函数不变（service 名常量不在任何 hunk；registry 测试并断言 `NOMICORE_REGISTRY_SERVICE === 'nomicoreRegistry'`） | 无 | — |
| 描述符消费 | 仓内 `getOwnPropertyDescriptor` 全部站点（identity.ts L146/182/186、registry.ts L319/672/730/754、doc-runtime、namespace-runtime） | 全部作用于敌意输入/数据域记录，无一作用于五服务对象（本审查 grep 复核） | 无 | — |
| spread/`Object.assign`/`vi.spyOn`/深克隆消费 | 全仓扫描 | 零命中作用于服务对象 | 无 | — |
| teardown 次序（ADR 0012） | hub/peer `ctx.effect` | 块逐字未动，`yield stop` 引用既有 const | 无 | — |
| `shutdown` exact-same-Promise（AC12） | registry 消费方 | 非 async 闭包返回缓存 `shutdownPromise`；测试三重恒等断言 | 无 | — |

## 8. 错误、恢复与并发

- **无新错误路径**：getter 体只 `return` const 标识符（R2），构造期与访问期均不可抛；提升不改变任何绑定解析（同作用域内上移数行、仅在工厂完成后被调用，无 TDZ）。
- **失败语义逐字保持**：manual clock loud 校验（TypeError/RangeError）、registry issue 信封、branded fatal、hub/peer stop 结算——`git diff -w` 证明体零改动；测试透传断言在场且绿。
- **并发/幂等**：无并发面变化；getter O(1)；`stopPromise ??=`、`shutdownPromise` 缓存、`liveWaits` 结算访问序不变；`service.m === service.m` 消除「每次访问新函数」竞态面。
- **资源与生命周期**：服务对象所有权、fiber dispose、reverse-yield 不变；测试每用例自建 Context 并 `ctx.fiber.dispose()` 收尾，无泄漏（root 341 文件串行全绿）。
- **进程重启/事务中断**：纯机械 diff、无持久化/schema/wire 状态，`git revert` 即回滚（设计 §9 论证与 diff 一致）。
- 静态无法确认项：无（本改动无时序/并发/规模新面，SA6 §7 已裁定时序无涉）。

## 9. 测试质量审查

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
|---|---|---|---|---|
| `clock-guard-proxy-consumption.test.ts`（4 用例） | 敏感性正控（helper 必抛）/诚实负控/双对象全成员 sweep + bracket 调用直通/manual 错误语义透传与失败后读数不变/多实例隔离/plugin 发布通道（`toBe(systemClock)`、`toBe(manual)`）/稳定闭包/姿态组/键面 | root `pnpm test`（root-test log L603 实录收集）；CI test shard 按磁盘枚举自动纳入；包 tsconfig 含 `test/**` 进 `pnpm typecheck` | 无 skip/only/todo/env fallback/源码字符串断言 | — |
| `registry-guard-proxy-consumption.test.ts`（2 用例） | 同款三重对照 + 真实组合 seam + 7 成员直连 deep-equal（`NAMESPACE_NOT_FOUND`、`{ok:false}` 信封）+ `getStatus()` 同引用 + `shutdown()` 三重 same-Promise + 姿态组 + 键面 | 同上（root-test log L580） | 敌意输入以受控显式转换穿过 typed 边界（`{} as CreateNamespaceInput` 等）——SA3 Deviations 已备案，运行时断言强度不变（direct vs proxied deep-equal） | — |
| `ws-replication-guard-proxy-consumption.test.ts`（2 用例） | 同款 + hub/peer 全清单成员 + `status` 既有绿灯不回归（内容断言 + 姿态组）+ `requestReauth` resolve + `stop` 缓存 Promise 恒等 + `waitForLive` 注入 timer 武装（`toHaveBeenCalledTimes(+1)`）与 `stop()` 触发 reject `'peer replication stopped'`、`cancel >= 1` | 同上（root-test log L579） | hub「listener close 恰一次」未显式断言、peer `status` 未与直连 deep-equal（hub 有）——见 O1 | O1（MINOR） |
| 红→绿证据 | HEAD 红：8 用例全红，含原始 Proxy 不变量错误消息（非断言文案）；18 函数成员 `THROW:TypeError`、`status`×2 绿；改后 3 文件 8 用例绿 + `Type Errors no errors` | `_sa3_red.log`（13:29）/`_sa3_green.log`（13:31） | 红先绿后纪律满足（SA6 §13） | — |
| 既有测试回归 | `clock-contract.test.ts` 键面/isFrozen 零改动；root 341 文件/3596 用例全绿（含三个新文件） | `_sa3_root-test.log` | 无 | — |
| 负控敏感性（防空洞绿） | 每文件每用例首行正控：helper 对冻结 data 形态必抛 TypeError | 三文件 | mutation 等价证据：同一 helper 在 HEAD（data 形态）红、改造后绿——形态敏感性由红→绿直接证明 | — |

未被真实 runner 触发/验收弱化的情形：未发现（三文件在 root-test log 中实录收集；CI sharder 文件列表由磁盘枚举决定、注释明示新文件自动纳入；`--typecheck.only` 的 test-d 集中跑不影响 `*.test.ts` 由 test job 覆盖）。

## 10. Required revisions

无 BLOCKER、无 MAJOR finding。

| Finding ID | Severity | Evidence | Problem | Required change | Acceptance | Suggested routing |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — |

## 11. 后续动态验证项

| Risk | Driver | Expected observation | Failure condition |
|---|---|---|---|
| CI 全量门禁在 PR 上首次运行（含 Node 20/24 × 6 shard + typecheck job） | CI（push/PR 触发） | typecheck job exit 0；test shard 全绿且三个 `*-guard-proxy-consumption.test.ts` 至少落一片 | 任一分片红或文件未被枚举 |
| root `pnpm typecheck` 独立日志证据（SA3 以终端输出记录，无 log 文件） | Controller/后续验证角色 | exit 0 无输出 | 任一 tsc project 报错 |
| DSH 侧 `nomicore-host` 用三 tgz 重建 + revision 切换 live reload + 回退 DSH fork 沙箱守卫（ADR L93 后半，仓外联动） | DSH 侧/Controller | 会话级插件 `ctx.get('nomicoreRegistry')` 等成员访问不再抛 TypeError，fork 守卫可回退 | 仓外环境仍抛不变量 TypeError |
| 部署面回归：`@nomicore/dsh-persistence` 时间线（manual clock 消费者）在 DSH 探针全链路 | DSH 侧 | 探针时间线逐字节一致（其测试已在 root 341 文件内绿） | 时间线漂移 |

## 12. Non-blocking observations

| ID | Observation | Evidence | Suggested disposition |
|---|---|---|---|
| O1（MINOR） | ws 测试两处契约字面偏差：hub 未断言「listener close 恰一次」（SA6 §12.2 #9 尾项；drain 语义由既有 `ws-replication-plugin.test.ts` drain 用例覆盖）；peer `status` 未与直连读数 deep-equal（#10；hub 侧有 `toEqual(service.status)`，peer 侧以字段级 `state`/`connection ∈ [...]` 断言）。两处均不弱化红灯断言本体（sweep + 行为 + 姿态 + 键面完整） | `ws-replication-guard-proxy-consumption.test.ts` L137–138 vs L179–180；SA6 契约 §12.2 #9/#10 | 后续维护时补 `expect(guarded.status).toEqual(service.status)`（peer）与 stub close 计数断言（hub）；非本票阻断项 |
| O2（备注） | root/包 `pnpm typecheck` 证据为 SA3 终端输出（无 log 文件）；但绿/根测试 log 均含 vitest `--typecheck` `Type Errors no errors`（其程序经 `tsconfig.typecheck.json`（含 `packages/*/src`+`test`）传递覆盖改动的 src 与新测试），且 CI typecheck job 必复跑 | SA3 验证表 vs `_sa3_green.log`/`_sa3_root-test.log` 尾行 | 已列后续动态验证项；无需返工 |
| O3（备注） | SA6 §10 消费侧审计未枚举三包之外的 `packages/dsh-persistence/src/clock.ts`（`createManualClock` 消费者）；本审查实读其为纯属性调用（`manual.now()/advance()`），形态不可分辨，且该包测试在 root 341 文件全绿集内 | `packages/dsh-persistence/src/clock.ts` L54+ | 审计清单小缺口、无行为风险；备案即可 |
| O4（备注） | worktree 残留 gitignore 构建产物（`packages/*/dist`、`artifacts/local-packages/*.tgz`）；跟踪文件（`manifest.json`、`packages/instance/tsconfig.build.json`）无 diff，不构成范围越界 | `git status --short`；`git check-ignore -v` | 无需处理；与 SA6 §16 同款清理纪律由收尾角色酌情执行 |

## 13. 结论

实现与 SA6 契约、SA1 设计（R1–R6/§7.3/§7.4/§7.6/§7.7）、SA2 评审决议（O1 已按建议处置）、SA8 前置与实现后复查、Issue AC1–AC8、ADR 0023 逐项一致；文件范围恰为 ALLOW 面、DENY 零触碰；测试具备真实红→绿证据、三重对照与全量姿态断言，并被 root/包/CI 全部真实入口收集。无 BLOCKER/MAJOR；O1–O4 为非阻断观察。**Verdict：`approve`**。无新的 ADR 冲突风险（不提交 `requiresConflictRecheck`；SA8 实现后复查已闭合且本审查未发现新决策面）。
