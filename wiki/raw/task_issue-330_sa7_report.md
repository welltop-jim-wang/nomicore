# SA7 动态验证报告 — Issue #330 nomicore 服务表面 getter 化（ADR 0023 机械落地）

- 派发：`sa-ec6af13d-656c-4610-8991-fa3420770aa8`（role `mabf-sa7`，phase `final-verification`，iteration 0）
- Worktree：`/home/wangjian/nomicore-fix-issue-330`（branch `mabf/issue-330`，HEAD `83581b3` + 未提交实现 diff：4 跟踪源文件 + 3 新测试文件）
- 验证焦点（派发指定）：guard-proxy 在已转换冻结服务方法上的消费、稳定身份（stable identity）、shutdown/teardown 语义、契约行为
- 上游结论链：SA6 `approve`（红/绿契约）→ SA1 设计 → SA2 `approve` → SA3 实现 → SA4 `approve`（静态审查，无 BLOCKER/MAJOR）→ SA8 实现后复查 `clear`（`requiresConflictRecheck=false`）
- Owner 评论：REST Issue-comments 读取为 `[]`——无 owner 要求、无 comment ID/时间戳可应用（与简报空节、SA6 §2、SA4 §3、SA8 §1 一致）

## Verdict

**`approve`**

SA4 已 `approve`，本次动态验证未发现任何可下调事实。全部结论以活链路运行证据支撑：设计 §8 声明改变的两条数据流路线（成员读取形态、构建产物语法）按设计变化；声明不变的路线（服务构造与发布、Clock 门禁/包装消费、错误语义、键面/枚举性、排除面）保持不变；registry 三相接纳态机、hub/peer stop 一次性结算态机、`waitForLive` 结算与 teardown reverse-yield 次序运行时观察全部符合设计；禁止状态/禁止转换（双重 teardown、数据属性复活、跨实例串状态、getter 抛错）未出现；临时驱动已删除并复跑确认结果不变。

## 1. Inputs

| 输入 | 路径 | 采用 |
|---|---|---|
| 任务简报（AC1–AC8；`Comments` 空） | `wiki/raw/task_issue-330.md` | 验证范围与 AC 落点 |
| SA1 设计（§7.2 S1–S5、R1–R6、§7.3 稳定闭包、§7.4 姿态、§7.6 三重对照、§8 数据流三路线、§12 验证门、§15 冻结面） | `wiki/raw/task_issue-330_design.md` | 变更/保持路线与状态机契约基准 |
| SA6 验收契约 + 红证据（§12.2 逐成员契约、§12.3 helper 纪律、§5 红表） | `wiki/raw/task_issue-330_sa6_contract.md`、`task_issue-330_sa6_red_probe.log` | 红→绿对照基线（18/18 函数成员 THROW → 目标 ACCESS_OK） |
| SA3 实现报告 + 四份日志 | `wiki/raw/task_issue-330_sa3_impl.md`、`_sa3_red/_green/_root-test/_pack-local.log` | 实现范围与 SA3 已跑门禁 |
| SA4 静态审查（`approve`；§11 后续动态验证项） | `wiki/raw/task_issue-330_sa4_review.md` | 动态验证聚焦点（root typecheck 独立日志、hub listener close 恰一次等） |
| SA8 实现后冲突复查（`clear`） | `wiki/raw/task_issue-330_implementation_conflict_report.md` | 冻结面 10/10 闭合记录 |
| 母法 | `docs/adr/0023-proxy-consumable-frozen-service-surfaces.md` | L45–74 决策/姿态、L90–93 验收 |
| 本报告新证据 | `wiki/raw/task_issue-330_sa7_dynamic_probe.log` | 62 项运行时观察（探针驱动，已删，见 §7） |

## 2. Runtime environment

- Node v24.13.0；pnpm 10.28.2；依赖已安装（`--offline --frozen-lockfile` 产物在场）。
- 测试入口：`NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run --typecheck`（root `vitest.config.ts` include 命中三包 test 目录）；探针入口：`tsx`（cwd `packages/ws-replication`，经该包 node_modules 软链解析 `@nomicore/*` 源码）。
- 实现状态实读：`git status` 跟踪改动恰 4 个 ALLOW 源文件（+173/−145）；3 个新测试文件未跟踪在场；DENY 面零改动。
- 全程无 CI 依赖：本报告为本地动态验证；不观察 PR CI（SA7 边界）。

## 3. Changed Data Flow Verification

设计 §8 声明改变的路线：**路线 2（成员读取：data property 查找 → 访问器 `[[Get]]` → getter 返回稳定闭包）** 与 **路线 3（构建产物新增 getter 语法）**。探针证据 ID 指向 `task_issue-330_sa7_dynamic_probe.log` 行内 `check` 字段。

| Route | Design change | Runtime driver | Observed hops | Expected result | Actual result | Verdict |
|---|---|---|---|---|---|---|
| 2a. guard-proxy 成员读取（五服务 20 成员：18 函数 + 2 既有 `status` getter） | data 属性 → 访问器；guard `get` 陷阱（`Reflect.get` → 函数成员返回包装闭包 `Reflect.apply(value, receiver, args)`）不再触发 `[[Get]]` 不变量 | 探针 guardProxy（带 hop 计数）+ 逐成员 sweep（B3/C4/D4/E3/B7） | hop 观测 B2：`trapCalls:1, functionWraps:1`，直通读数落在 `Date.now()` bracket 内；sweep 全 `ACCESS_OK`（registry 7、hub 3、peer 6、systemClock 1、manual 3） | 20/20 ACCESS_OK（SA6 红表 18 THROW 的成员全转绿，`status`×2 不回归） | 20/20 ACCESS_OK；敏感性正控 A1 冻结 data 形态仍 THROW:TypeError（helper 非空洞）；诚实 Proxy A2 绿 | ✅ |
| 2b. 读取后调用直通（包装闭包 `Reflect.apply` → 稳定闭包体） | 行为逐字平移：调用结果与直连等价 | B2/B8（clock bracket、manual set/advance/校验）、C7–C9（registry 信封）、D5/D9（hub status/requestReauth）、E4/E8（peer） | `p.open(missing)` deep-equal 直连 `{ok:false, code:'NAMESPACE_NOT_FOUND', message:…}`；`p.getStatus() === registry.getStatus()`（同冻结常量引用）；`p.set(250)/advance(5)` → 255；hub `p.requestReauth` resolve；peer `p.removeTarget` resolve | 直连与经代理调用结果 SameValue/deep-equal | 全部等价（C7/C8/C9、B8、D9、E8 PASS） | ✅ |
| 2c. 旧 data-property 读取路径不再存在 | 描述符无 `value` 槽 | C5/D6/E5/B1 描述符块 + 姿态探针（C15/C16、D14、E13、B5） | 20 成员描述符全 `{accessor, get:function, set:undefined, configurable:false, enumerable:true}`；赋值/`defineProperty`/strict `delete` 全 TypeError；teardown 后（shutdown/stop/dispose）复测姿态不变 | 旧路径不可达、不可复活 | 20/20 访问器；敌意操作全拒；teardown 后零复活 | ✅ |
| 3. 构建产物（`pnpm pack:local` → tsc ES2022 → dist/tgz） | dist 携带 getter 语法（无 downlevel 变形） | `pnpm pack:local` + dist/tgz 抽查 + dist 运行时消费 | exit 0；三 tgz 在场（clock 0.1.0 / namespace-registry 0.1.10 / ws-replication 0.1.5，均含 `dist/`）；dist 实文：`get now() { return nowImpl; }`、manual `get now/set/advance`、hub `get requestReauth/stop`、peer `get addTarget/…/waitForLive/stop`、registry `get open/getStatus/shutdown` 等；node 直载 `dist/index.js` 经 guard Proxy 运行时访问 OK、`distManualThrough:255`、isFrozen 保持 | tgz 可构建且产物为访问器形态 | 全部命中；dist 中仅存的箭头对象是**保留不改**的 peer/hub `clock: { now: () => clock.now() }` 消费包装（dist plugin.js L252/L341，非服务表面） | ✅ |

## 4. Preserved Data Flow Verification

设计声明不变的路线（入口、事实源、读写顺序、事件数量、错误分类、close/retry 行为）：

| Route | Preserved invariant | Runtime driver | Baseline observation | Current observation | Verdict |
|---|---|---|---|---|---|
| 1. 服务构造与发布 | 构造点产出同一冻结对象；`ctx.provide` 名与对象恒等；require 通道多次取同一实例 | B11/B13（`requireClock === systemClock`/manual 实例）、C2（registry 二次 require 同一）、D2（hub）、probe 组合 | SA6 基线：provide/get 语义不变 | 同一实例恒等 PASS；四 service 名不变（C3 `nomicoreRegistry`、D3 `nomicoreHubReplication`、E2 `nomicorePeerReplication`；`clock` 经 `requireClock` 解析 + `clock-contract.test.ts` L27–28 冻结断言在包门禁中绿） | ✅ |
| Clock 门禁与包装消费 | `assertClockShape`（`typeof clock.now === 'function'`）经 getter 仍通过；peer `clock: { now: () => clock.now() }` 包装行为不变 | C1（registry 真实组合以**访问器形态** manual clock 完成——门禁未拒）、D1/E1（hub/peer 以 `systemClock` 组合成功且 status 可观察）、dist 实读 L252/L341 包装未动 | SA6/SA8：两站点不在 diff hunk | 门禁通过、包装消费正常；错误分类零新增（getter 体只 `return` const） | ✅ |
| 错误语义透传 | manual loud 校验（RangeError/TypeError）、registry issue 信封在代理路径下逐字保持 | B8（`set(NaN)` RangeError、`set('1')` TypeError、失败后读数不变 255）、C7/C8/C13（`NAMESPACE_NOT_FOUND`/`NAMESPACE_INVALID_IDENTITY`/`REGISTRY_NOT_ACCEPTING` 直连 deep-equal 代理） | SA6 契约 §12.2 #2/#3 | 逐项 PASS | ✅ |
| 键面/枚举性/isFrozen/序列化 | `Object.keys` 序与键面、`Object.isFrozen`、`JSON.stringify` 省略函数成员 | B6/B10（`['now']`、`['now','set','advance']`）、C6（7 序）、D7（3 序）、E6（6 序）、JSON `'{}'` | SA6 探针模型（键面/isFrozen 不变） | 全部保持；既有 `clock-contract.test.ts` 键面/isFrozen 断言零改动且在包门禁绿 | ✅ |
| 排除面负控 | `nomicoreInstance`（纯数据冻结）、`nomicorePersistence`（class 原型、非冻结）不受影响 | F1（instance 冻结 data 成员 guard 访问 ACCESS_OK）、F2（persistence 原型方法 guard 访问 ACCESS_OK） | SA6 probe 27–33 | 保持；实现 diff 未触碰两包 | ✅ |
| 三包既有门禁 | 120 文件基线全绿 → 改造后仍绿 | 三包 test 目录全量（本报告实跑） | SA6 基线 47+73 文件 / 475+535 用例 | **clock+registry 49 文件 / 481 用例；ws-replication 74 文件 / 537 用例**（各含新文件），`Type Errors: no errors`，exit 0 | ✅ |

## 5. State Machine Verification

| Initial state | Trigger | Expected transitions | Observed transitions | Forbidden transitions absent | Verdict |
|---|---|---|---|---|---|
| registry `acceptance='running'` | `shutdown()` 调用（同步段） | 同步翻 `shutting-down`（调用返回后、任何 await 前可观测）→ runShutdown 结算后 `stopped` | C11：`['running','shutting-down','stopped']` 三点实测（第三次读数在 `await first` 后） | 未见回退到 running；`shutting-down` 不是终态、`stopped` 后 shutdown 不再产生新 Promise（C14 同一缓存实例） | ✅ |
| registry running | shutdown 后调用 `open`（直连与经代理） | `REGISTRY_NOT_ACCEPTING` 信封（停接纳门先行，不访问输入） | C13：直连 === 代理 deep-equal，`ok:false, code:'REGISTRY_NOT_ACCEPTING'` | 无状态副作用、无异常泄漏 | ✅ |
| registry 未 shutdown | 并发/重复 `shutdown()`（经 guard 闭包包装调用） | exact-same-Promise：全部调用返回同一缓存实例（含结算后） | C12 三方恒等（direct first === p.shutdown() === p.shutdown()）；C14 结算后再调用仍 `=== first` | 未出现第二 Promise 实例（async 化复活路径 absent——`shutdown` 仍非 async 闭包） | ✅ |
| hub `{state:'ready', connections:0}` | `stop()`（经 guard） | `stopPromise ??=` 一次性结算；listener close → replication close → timer dispose；status → `{state:'stopped', connections:0}` | D10 三方同一 Promise；D11 status 翻 stopped；D12 listener close **恰一次**（显式 stop 后 1 次，`fiber.dispose()` 后仍 1 次） | 禁止的双 close/双 teardown 未出现（dispose 复用缓存 Promise） | ✅ |
| hub 服务已发布（ctx.effect yield [revoke, stop]） | `ctx.fiber.dispose()` | reverse-yield：先 stop（drain 窗口内服务仍在场）后 revoke | D13：`listener.close()` 执行期间 `ctx.get(NOMICORE_HUB_REPLICATION_SERVICE)` 仍 defined；dispose 完成后 revoked（undefined） | 未出现先 revoke 后 stop（服务在 drain 中途消失）；D15 teardown 后 `stop()` 仍 resolve（缓存） | ✅ |
| peer `{state:'ready', connection:'handshaking'}`（dial stub） | `waitForLive(ns)` 后 `stop()` | waitForLive 武装注入 timer（不轮询真实时钟）→ stop 同步结算全部 liveWaits（reject `'peer replication stopped'`）并取消 timer；status → stopped；stop 缓存 Promise | E9：timer armed +1、pending reject 消息精确匹配、`cancelCalls:3`；E10 stop 同一 Promise；E11 `{state:'stopped', connection:'stopped'}` | 未出现未结算挂起 Promise、未出现真实 sleep/轮询；E12 stop 后 `removeTarget` 经闭包 no-op resolve（replication=undefined 分支），无旧路径复活 | ✅ |
| peer/hub/registry 服务已冻结 + 已 teardown | 敌意赋值/重定义/strict delete | 全部 TypeError 拒绝；描述符保持访问器 | C15/C16、D14、E13、B5 全拒；dispose 后 provide 已 revoke 而服务对象姿态不变 | 未出现 teardown 后可变性复活 | ✅ |
| ManualClock 工厂态 | 两实例并发使用 | 工厂作用域闭包：每实例独立 `current`；getter 恒返回本实例闭包 | B9：`c1.now !== c2.now`（每实例闭包独立）+ `c1` 三成员自恒等 + `c2` 读数不受 `c1.set/advance` 影响（500） | 禁止的跨实例串状态未出现（若误提模块作用域则 `c1.now === c2.now` 且 c2 读数漂移） | ✅ |
| 任意冻结服务 | 重复成员访问（含 3 次完整探针复跑 ×62 检查） | getter 每次返回同一闭包，不可抛 | B4/C10/D8/E7 自恒等 + 缓存引用稳定；62/62 × 4 次运行全 PASS（0 flake） | 未出现 getter 抛错或每次新函数实例 | ✅ |

## 6. Error and Cleanup Flow

- **错误分类零漂移**：manual 校验错误类型（RangeError/TypeError）与 registry issue 信封（`NAMESPACE_NOT_FOUND`/`NAMESPACE_INVALID_IDENTITY`/`REGISTRY_NOT_ACCEPTING`）经 guard 代理与直连逐字等价（B8/C7/C8/C13）；hub/peer stop 结算路径无新增失败类型（D10–D12/E9–E11）。
- **失败后状态不被污染**：`p.set(NaN)` / `p.set('1')` 抛错后读数保持 255（B8）；敌意输入经代理调用零状态副作用（C8）。
- **cleanup 到达 quiescence**：三场景均以 `ctx.fiber.dispose()` 收尾——registry provide revoke（C16）、hub listener close 恰一次 + revoke（D12/D13）、peer liveWaits 全结算 + timer 取消 + revoke（E9/E14）；探针为挂起 Promise 预挂 catch，无 unhandled rejection；探针进程 exit 0。
- **错误路径不伪成功**：敌意赋值/重定义/strict delete 以 TypeError 显式拒绝（非静默吞掉），改造前后的可观察错误种类一致（SA6 姿态模型 E5 对照）。

## 7. Temporary Diagnostics

- **未向任何生产/测试代码添加 `[SA7-DATAFLOW]` 日志**：本任务全部关键跳点与状态转换可由运行时描述符、返回值恒等、stub 计数器与 hop 计数驱动观察，无需代码插桩。收尾扫描 `grep -rn "SA7-DATAFLOW" packages/ apps/ domains/ tests/` 零命中；`git diff` 仅含实现本身的 4 个源文件。
- **临时驱动**：`packages/ws-replication/.sa7-probe-issue-330.ts`（SA6 探针先例同款位置；untracked、不进构建面）。产出证据后已删除；`ls packages/ws-replication/.sa7*` 无残留。
- **证据保留**：62 项观察输出存 `wiki/raw/task_issue-330_sa7_dynamic_probe.log`（含运行命令与环境头；驱动捕获前经历 4 次驱动侧修正——缺 import、预期信封缺 `message` 字段、F2 组合缺 clock/timer 服务——均为驱动缺陷修正，未触碰任何生产/测试代码）。
- **post-removal 复验**：删除驱动后复跑三个 checked-in guard-proxy 测试文件（关键场景等价面）：3 文件 / 8 用例通过、`Type Errors: no errors`——结果与驱动在场时一致。
- **构建残留**：`pnpm pack:local` 产物（`packages/*/dist`、`artifacts/local-packages/*.tgz`）为 gitignore 构建产物（SA4 O4 同款备案）；跟踪文件（`manifest.json`、`packages/instance/tsconfig.build.json`）`git status` 无 diff。

## 8. Dynamic Evidence Matrix

| Source | Requirement or risk | Driver | Expected | Actual | Evidence | Result | Suggested routing |
|---|---|---|---|---|---|---|---|
| Design §8 路线 2 | guard-proxy 成员读取形态翻转 | 探针 sweep（5 服务 20 成员） | 20/20 ACCESS_OK | 20/20 ACCESS_OK | probe log B3/C4/D4/E3/B7 | ✅ | — |
| Design §7.3 | 稳定闭包（`m === m`、缓存引用、每实例恰一次提升） | 探针恒等断言（5 服务全部函数成员） | 恒真 | 恒真 | B4/B9/C10/D8/E7 | ✅ | — |
| Design §7.3.4 / SA6 §12.2 #6 | `shutdown` exact-same-Promise（非 async 复活禁令） | 探针 C12/C14 | 三方恒等 + 结算后同实例 | PASS | probe log | ✅ | — |
| Design §8 状态机 / SA6 #9 | hub stop 缓存 Promise + listener close 恰一次（SA4 O1 补证项） | stub close 计数 + dispose | close=1（跨显式 stop + dispose） | 1/1 | D10/D12 | ✅ | — |
| SA4 §11 / ADR 0012 | teardown reverse-yield（drain 窗口服务在场，dispose 后 revoke） | close 回调内观测 `ctx.get(service)` | drain 中 defined、dispose 后 undefined | PASS | D13 | ✅ | — |
| SA6 §12.2 #13 | `waitForLive` 注入 timer 武装 + `stop()` settle `'peer replication stopped'` | timer 计数 stub | armed+1、reject 精确消息、cancel≥1 | PASS（cancel=3） | E9 | ✅ | — |
| SA6 §12.2 #5/#10 | peer `status` 快照字段（state/connection）不回归 | 探针读数 | ready + connecting/handshaking → stopped/stopped | PASS | E4/E11 | ✅ | — |
| Design §7.4 / AC5 | 姿态：访问器描述符 + 赋值/重定义/strict delete 拒 + isFrozen | 描述符块 + 敌意操作 | 全拒/全保持 | PASS（含 teardown 后复测） | B1/B5/C5/C15/C16/D6/D14/E5/E13 | ✅ | — |
| Design §7.4 / AC3 | 键面/枚举性（既有 `clock-contract` 断言不回归） | `Object.keys` + 包门禁 | 序与键面不变 | PASS | B6/B10/C6/D7/E6 + 49 文件门禁 | ✅ | — |
| Design §8 路线 1 / §10 | 消费方零改动：Clock 门禁 + peer 包装 + require 恒等 | 访问器 clock 真实组合（registry/hub/peer） | 组合成功、同一实例 | PASS | C1/C2/D1/D2/E1、B11/B13 | ✅ | — |
| Design §8 路线 3 / AC8 | tarball 可构建且 dist 访问器形态 | `pnpm pack:local` + dist/tgz 抽查 + dist 运行时消费 | 三 tgz + getter 语法 + 运行时可消费 | exit 0，全部命中 | 本报告 §3 行 3 | ✅ | — |
| SA6 §6 排除面 | instance/persistence 不受影响 | guard 访问排除面服务 | ACCESS_OK、形态不变 | PASS | F1/F2 | ✅ | — |
| Design §12.3 / AC7 | 三包门禁 + 新文件显式运行 | vitest 包目录 + 显式 3 文件 | 全绿 | 49+74 文件 / 481+537 用例 + 8/8 | 本报告 §9 | ✅ | — |
| SA4 §11 | root `pnpm typecheck` 独立证据（SA3 仅终端输出） | root typecheck 复跑 | exit 0 | 见 §9（复跑通过） | 终端 exit 0 | ✅ | — |

## 9. Commands and Evidence

| # | Command | Result | Evidence |
|---|---|---|---|
| 1 | `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run --typecheck <三个 guard-proxy 测试文件> --passWithNoTests=false`（改造后实现态） | exit 0；3 文件 / 8 用例；`Type Errors: no errors` | 终端输出（14:16 与删除探针后 14:27 两次一致） |
| 2 | `NODE_OPTIONS=--conditions=nomicore-source ../../node_modules/.bin/tsx .sa7-probe-issue-330.ts`（cwd `packages/ws-replication`；临时驱动，已删） | exit 0；**62/62 PASS，0 FAIL**；稳定复跑 3 次均 62/62 | `wiki/raw/task_issue-330_sa7_dynamic_probe.log`（67 行） |
| 3 | `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run --typecheck packages/clock/test packages/namespace-registry/test` | exit 0；49 文件 / 481 用例；no type errors | 终端输出（14:23） |
| 4 | `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run --typecheck packages/ws-replication/test` | exit 0；74 文件 / 537 用例；no type errors | 终端输出（14:24） |
| 5 | `pnpm pack:local` | exit 0；14 tgz，含三包 tgz | `artifacts/local-packages/nomicore-{clock-0.1.0,namespace-registry-0.1.10,ws-replication-0.1.5}.tgz` |
| 6 | dist/tgz 形态抽查（grep + `tar -tzf` + node 直载 dist 经 guard Proxy） | dist 全部 getter 语法；tgz 含 `dist/`；dist 运行时 guard 访问 OK、`distManualThrough:255` | 本报告 §3 行 3 |
| 7 | `pnpm typecheck`（root，14 tsc project；SA4 §11 后续项复跑） | exit 0（无输出） | 终端输出 |
| 8 | 清理验证：`rm` 探针 → 复跑命令 1；`grep -rn "SA7-DATAFLOW" packages/ apps/ domains/ tests/`；`git status --short` | 8/8 绿不变；零标记命中；跟踪改动恰 4 个实现源文件 | 本报告 §7 |

## 10. Deviations

- 无阻断偏离。验证范围说明：
  1. **未复跑 root `pnpm test` 全量**（SA3 已跑 341 文件 / 3596 用例并有日志；SA7 边界是设计点名的数据流/状态机与三包门禁，不做全仓回归）——三包门禁 + 显式新文件门禁 + root typecheck 均已复跑全绿。
  2. SA4 O1 的两处契约字面小偏差（peer `status` 未与直连 deep-equal、hub listener close 计数断言）已由本报告 D5（hub status deep-equal）、E4/E11（peer status 字段级）、D12（close 恰一次）以动态证据补证；hub 侧 `guarded.status` deep-equal 直连快照在 checked-in 测试亦有断言。
  3. 探针驱动 4 次驱动侧修正（§7）不影响证据有效性：全部修正发生在临时驱动文件内，被测对象（实现源码与测试）零触碰；最终捕获的 62 项观察来自同一份驱动一次完整运行。
  4. 仓外联动（DSH 侧 `nomicore-host` 重建、live reload、fork 守卫回退）非本仓验证边界（ADR 0023 L93 后半）；本报告以 dist 运行时消费（§3 行 3）止于仓内可验证边界。
- 无新增 finding 需要路由：动态验证未发现任何与设计/契约不符的运行时行为。

## 11. Verdict rationale

`approve` 的完整判定链：

1. **变更路线按设计变化**（§3）：20/20 成员经 guard Proxy 访问合法 + 调用直通；hop 级观察（trap → Reflect.get → accessor getter → 稳定闭包 → 包装调用）与设计 §8 路线 2 逐跳一致；构建产物携带访问器形态且运行时可消费（路线 3）。
2. **保持路线保持不变**（§4）：构造/发布/require 恒等、Clock 门禁与包装消费、错误语义、键面/枚举性/isFrozen/序列化、排除面负控、三包门禁基线全绿。
3. **状态机正确、禁止转换未出现**（§5）：registry 三相接纳态机（含同步翻态与 exact-same-Promise）、hub/peer stop 一次性结算、`waitForLive` settle、teardown reverse-yield 次序（drain 中服务在场、dispose 后 revoke）、teardown/敌意操作后零旧路径复活、ManualClock 零跨实例串状态。
4. **错误与 cleanup 符合设计**（§6）：错误分类零漂移、失败不污染状态、三场景 cleanup 全达 quiescence。
5. **临时诊断已清理**（§7）：无代码插桩、驱动已删、删除后复跑结果不变、`[SA7-DATAFLOW]` 零命中、跟踪文件零越界改动。

SA4 verdict `approve` 在案；本次动态验证未发现任何独立 fail 事实，依规程输出 `approve`。
