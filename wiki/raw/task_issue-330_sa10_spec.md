# SA10 Spec 终审 — Issue #330 nomicore 服务表面 getter 化（ADR 0023 落地）

- 派发：`sa-2425c3c4-2aec-46c0-9a54-a8a24d041f4c`（role `mabf-sa10`，phase `spec-review`，iteration 0）
- Worktree：`/home/wangjian/nomicore-fix-issue-330`（branch `mabf/issue-330`）
- **审查对象（唯一权威）**：最终已提交 diff `83581b30be81e585a19d302d8c483b73fb893662`（母 PR #329 head，ADR 0023 文档落地）→ `a7e294a2bc32534467be1dcbf8d9489d5f2d7cd9`（HEAD，`fix: expose frozen services through proxy-safe getters`）
- **diff 范围**：4 个跟踪源文件（`packages/clock/src/system.ts`、`packages/clock/src/manual.ts`、`packages/ws-replication/src/plugin.ts`、`packages/namespace-registry/src/registry.ts`）+ 3 个新增测试文件（三包 `test/*-guard-proxy-consumption.test.ts`）+ 9 个 `wiki/raw/task_issue-330_*` 过程产物（brief/冲突/设计/评审/实现/验证档案）。包内代码面恰 7 文件，+173/−145（源码）+ 571（新测试）。
- **对照规格**：`wiki/raw/task_issue-330.md`（Issue #330 正文 AC1–AC8 + 明确不改清单）、`wiki/raw/task_issue-330_sa6_contract.md`（SA6 验收契约，verdict `approve`）、母法 `docs/adr/0023-proxy-consumable-frozen-service-surfaces.md`、`CONTEXT.md` L129–131（服务表面术语 + Avoid 红线）
- **Owner 评论**：REST Issue-comments 读取 `[]`——无 owner 要求、无 comment ID/时间戳可应用（与简报空节及 SA2/SA4/SA6/SA7/SA8 各报告一致记录相符）。全部义务 = Issue 正文 AC1–AC8 + ADR 0023。
- **只读纪律**：未修改任何代码/设计/测试、未运行测试、未启动服务、未调度其他 SA、未 commit/push；本报告为唯一写入。全部关键结论由本审查在 HEAD 独立复核（`git diff` 全文实读、`git diff -w` 语义残渣分析、`-U0` hunk 定位、AC4 grep 独立复跑、dist 产物 getter 形态直接抽查、日志证据抽读）。

## Verdict

**`approve`** — 实现是 Issue #330 正文与 ADR 0023 的忠实机械落地：AC1–AC8 全部 MET，无 unmet/partial/unachievable；SA6 契约 §12.2 十四行逐成员契约全部有测试落点；ADR 0023 姿态对照 L64–74 逐行兑现；明确不改清单零触碰；无 scope creep。两条契约字面小偏差均为既有 MINOR（SA4 O1），已由 SA7 动态证据补证，不阻断 approve，须随 PR 披露（见 §6）。

---

## 1. Issue AC 逐条核对（AC1–AC8）

| AC | 要求 | 结论 | 证据（本审查独立复核） |
|---|---|---|---|
| AC1 | `nomicoreRegistry` 全部函数成员访问器形态；Cordis 组合取得后套 guard Proxy 访问并调用每个方法不抛 TypeError、行为直通 | **MET** | `registry.ts` diff：7 方法（`open`/`create`/`importReplica`/`resetReplica`/`deleteNamespace`/`getStatus`/`shutdown`）提为 `createRegistryInternal` 作用域稳定闭包（`runShutdown` 后、字面量前），字面量 7 成员全改 `get x() { return x }`，成员序不变，`Object.freeze` 保留。`registry-guard-proxy-consumption.test.ts`：真实组合（instance + manual clock + fake timer + memory persistence + `createNamespaceRegistryPlugin`，对齐 `registry-plugin.test.ts` 测试 22）经 `requireNomicoreRegistry(ctx)` 取得；7 成员 sweep 全 `ACCESS_OK`；`open` 缺失 ns 与直连 deep-equal（`{ok:false, code:'NAMESPACE_NOT_FOUND'}`）；`create`/`importReplica`/`resetReplica`/`deleteNamespace` 敌意输入与直连同型信封；`getStatus()` 同引用（`toBe`）；`shutdown()` 三重 same-Promise（`p.shutdown()===first`、`p.shutdown()===p.shutdown()`） |
| AC2 | Hub/Peer 同款改造 + 各一款 guard-proxy 回归（既有插件 seam），覆盖 `status`/`requestReauth`/`stop` 与 `status`/`addTarget`/`removeTarget`/`notifyAuthChanged`/`waitForLive` 全部成员访问 | **MET** | `plugin.ts` diff：hub `requestReauth` 提为 `apply` 作用域命名闭包（显式 `Promise<void>` 注解），`requestReauth`/`stop` 改 getter（`status` getter 与 `stop` const 零触碰）；peer 四闭包提升（`addTarget`/`removeTarget`/`notifyAuthChanged`/`waitForLive`），五函数成员全 getter 化并保持成员序。`ws-replication-guard-proxy-consumption.test.ts` seam 与 `ws-replication-plugin.test.ts` `dependencies()` 同款；hub 3 成员 + peer 6 成员 sweep 全 `ACCESS_OK`（issue 清单全覆盖，peer `stop` 为 SA2 已判定的合理超集强化）；`status`×2 既有绿灯不回归（hub deep-equal 直连 `{state:'ready',connections:0}`；peer 字段级 `state`/`connection ∈ ['connecting','handshaking']`）；`waitForLive` 注入 timer 武装（`toHaveBeenCalledTimes(+1)`）+ `stop()` 触发 reject `'peer replication stopped'`，无真实 sleep/轮询 |
| AC3 | `systemClock` 与 `ManualClock` 同款改造 + guard-proxy 用例；既有 `Object.isFrozen` 断言保持绿灯 | **MET** | `system.ts`：模块级 `nowImpl` 提一次 + `get now()`（单例无实例状态，作用域合规）。`manual.ts`：工厂作用域三闭包捕获本实例 `current`，成员序 `now/set/advance` 保持。`clock-guard-proxy-consumption.test.ts`：双对象全成员 sweep + bracket 读数（`before <= p.now() <= after`）+ manual loud 校验透传（`set(NaN)`→RangeError、`set('1')`→TypeError、失败后读数不变）+ 多实例隔离 + plugin 发布通道 `requireClock` 恒等（`toBe(systemClock)`/`toBe(manual)`）。既有 `clock-contract.test.ts` 键面/isFrozen 断言**文件零改动**（diff 复核）且在 root-test log 中绿（17 tests passed） |
| AC4 | 三包内既有 data 属性形态断言更新为访问器形态；无此类断言则审计结论记录在案 | **MET（审计分支）** | 本审查独立复跑 `grep -rn "\bwritable\b" packages/clock packages/namespace-registry packages/ws-replication --include="*.ts" \| grep -v writableLength`：恰 2 命中——`types.ts:518`（文档注释词）、`registry.ts:766`（`clonePlainData` 数据载荷 `writable: false`，非服务成员）。三包**不存在**针对服务成员的 `writable === false` 断言 → 审计分支成立，结论已写入 SA3 实现报告 §AC4（在案）；无任何既有测试文件被改写（diff 复核：三既有测试文件零 diff） |
| AC5 | `Object.freeze` 保留；赋值与 `defineProperty` 重定义仍被拒；TS 公共类型面零变化 | **MET** | 五处 `Object.freeze` 调用原样保留（diff 上下文逐一确认）。三测试文件 `expectAccessorPosture` 断言块逐成员套用：`'value' in d === false`、`typeof d.get === 'function'`、`d.set === undefined`、`configurable === false`、`enumerable === true`、`Object.isFrozen === true`、赋值与 `defineProperty` 均 `toThrow(TypeError)`——与 SA6 §12.4 断言块逐字一致。类型面：`types.ts`/`contract.ts`/clock 双入口 `index.ts`/`testing.ts` **零 diff**；`plugin.ts` 全部 4 个 hunk 位于 L431+/L509+（`-U0` hunk 头实证），接口区块 L35–56 未触碰；root `pnpm typecheck` 与 vitest `--typecheck` 均 `Type Errors no errors` |
| AC6 | 测试 helper 为包内复制的 guard-proxy 构造（每包约 10 行），不新建共享测试设施 | **MET** | 三测试文件各内联 `guardProxy`（约 10 行，语义逐字同款 SA6 §12.3：`Reflect.get` + 函数成员返回 `(...args) => Reflect.apply(value, receiver, args)`）；无新增共享测试模块/导出（diff 全文件清单复核：测试面仅 3 个新文件） |
| AC7 | 三包门禁 + root `pnpm typecheck` 与 `pnpm test` 全绿 | **MET** | `_sa3_green.log`：3 文件 / 8 用例通过、`Type Errors no errors`（`--passWithNoTests=false` 显式运行）。`_sa3_root-test.log`：root `pnpm test`（`vitest run --typecheck`）**341 文件 / 3596 用例全绿**、`Type Errors no errors`，三新文件实录收集。三包 `pnpm --filter typecheck` + root `pnpm typecheck` exit 0（SA3 验证表；SA7 §9 复跑 root typecheck exit 0 补独立证据） |
| AC8 | 三包 local tarball 可正常构建 | **MET** | `_sa3_pack-local.log` exit 0；`artifacts/local-packages/` 14 tgz 在场，含 `nomicore-clock-0.1.0.tgz`、`nomicore-namespace-registry-0.1.10.tgz`、`nomicore-ws-replication-0.1.5.tgz`。本审查直接抽查 dist：`packages/clock/dist/system.js` `get now() { return nowImpl; }`、`dist/manual.js` `get now()`、registry `dist/registry.js` `get shutdown()`、ws `dist/plugin.js` `get requestReauth()`/`get waitForLive()`——ES2022 target 原生保留 getter，无 downlevel 变形。AC8 后半（DSH 侧 `nomicore-host` 重建 + live reload + fork 守卫回退）为 ADR L93 明示的仓外联动，各上游报告一致划界，非本仓交付缺口（见 §6 披露项 3） |

## 2. SA6 契约 §12.2 逐成员契约核对（14 行）

| # | 契约断言 | 结论 | 落点 |
|---|---|---|---|
| 1 | `systemClock.now` bracket 读数 | ✅ | clock 测试用例 1（`before <= r <= after` + 有限 number） |
| 2 | ManualClock `now/set/advance` + 错误语义透传 + 失败后读数不变 | ✅ | clock 测试用例 3（`set(250)→250`、`advance(5)→255`、`set(NaN)` RangeError、`set('1')` TypeError、读数保持 255） |
| 3 | `open` 缺失 ns deep-equal `{ok:false, code:'NAMESPACE_NOT_FOUND'}` | ✅ | registry 测试用例 1 |
| 4 | `create/importReplica/resetReplica/deleteNamespace` 非法输入同型信封、零副作用 | ✅ | 同上（受控显式转换穿过 typed 边界，SA3 已备案；direct vs proxied deep-equal 保持断言强度） |
| 5 | `getStatus() === registry.getStatus()`（恒等锚） | ✅ | 同上（`toBe`） |
| 6 | `shutdown()` exact-same-Promise + `Object.isFrozen` 仍 true | ✅ | registry 测试用例 2（三重恒等 + 姿态断言含 isFrozen） |
| 7 | hub `status` 不回归 + deep-equal `{state:'ready',connections:0}` | ✅ | ws 测试 hub 用例 |
| 8 | hub `requestReauth('peer-one')` resolves | ✅ | 同上 |
| 9 | hub `stop()` 缓存 Promise 恒等；随后 dispose 排空、listener close 恰一次 | ✅（尾项见 §5 偏差 1） | `p.stop() === first` 断言在场；「listener close 恰一次」未在 checked-in 测试显式断言（MINOR，SA4 O1；SA7 D12 动态补证 close=1 跨显式 stop + dispose） |
| 10 | peer `status` 不回归 + deep-equal 直连 + `connection ∈ ['connecting','handshaking']` | ✅（deep-equal 见 §5 偏差 2） | ws 测试 peer 用例字段级断言（`state==='ready'`、`connection` 集合成员）；未与直连 deep-equal（MINOR，SA4 O1；SA7 E4/E11 动态补证） |
| 11 | peer `addTarget`/`notifyAuthChanged` 访问不抛、调用不抛 | ✅ | ws 测试 peer 用例 |
| 12 | peer `removeTarget(ns)` resolves | ✅ | 同上 |
| 13 | `waitForLive` 注入 timer 武装 + `stop()` 触发 reject `'peer replication stopped'`（无真实 sleep） | ✅ | 同上（`toHaveBeenCalledTimes(+1)`、精确消息、`cancel >= 1`） |
| 14 | peer `stop()` resolves（drain 窗口语义） | ✅ | 同上（`await guarded.stop()`） |

§12.3 纪律复核：8 个用例**每个**首行均带敏感性正控（helper 对 `Object.freeze({probe})` 必抛 TypeError，防空洞绿）+ 诚实 Proxy 负控 + 被测断言；无 skip/only/todo/env override/吞错/宽松断言/源码字符串断言（三文件全文实读）；稳定闭包断言 `service.m === service.m` 覆盖全部函数成员。SA3 关于「`status` 为快照值 getter、稳定闭包断言仅适用函数成员」的澄清与 ADR L45「函数成员」口径一致，非契约弱化。

§13 红→绿流程纪律复核：`_sa3_red.log`（13:29，HEAD 改造前 8 用例全红，含原始 ECMA-262 不变量错误消息 `'get' on proxy: property 'shutdown' is a read-only and non-configurable data property ... did not return its actual value`——不可能由改造后代码产生）→ `_sa3_green.log`（13:31 全绿）→ root-test（13:43）。红先绿后、红为真实 HEAD 红。

## 3. ADR 0023 规范核对

| 条款 | 结论 | 证据 |
|---|---|---|
| L45–62 决策：函数成员一律访问器属性、方法体提稳定闭包、getter 返回该闭包、freeze 保留、方法体/状态机一行不动 | **MET** | `git diff -w` 语义残渣仅为声明形态行（方法简写/内联箭头 → `const x = ... =>`、`},` → `};`）、ADR 注释与 R4 显式注解；registry 七方法体逐字平移（含 L2262–2264 exact-same-Promise 注释随体）；`shutdown` 保持**非 async** 函数表达式；hub/peer `stop` 保持既有命名 const 零提升 |
| L30–41 影响面：恰改 5 受影响行；排除 instance/persistence/timer/返回值/信封 | **MET** | diff 文件清单恰为 5 个服务表面的 4 个宿主源文件；`instance/`、`persistence/`、`ws-replication/src/testing.ts`（`decorateLease`）、`create-diagnostic.ts`（`NOOP_DIAG`）零改动；registry hunk 仅 L2179+（`-U0` 实证），`clonePlainData` L763–772 零触碰；`namespace-runtime`（`copyFrozen`）零改动 |
| L64–74 姿态对照（赋值拒/重定义拒/类型面不变/引用缓存不变/枚举性保持/Proxy 可包装） | **MET** | 姿态断言块逐成员覆盖（见 AC5 行）；成员序与字面量 getter 默认 enumerable 保持（三测试 `Object.keys` 精确断言）；`service.m === service.m` 锁死引用缓存语义；guard-proxy 消费由红（18/18 THROW）转绿（20/20 ACCESS_OK，SA7 sweep 复核） |
| L78 实现注意（deepFreeze 按 `descriptor.value` 递归） | **MET（无命中面）** | diff 零触碰任何 deepFreeze 实现；仓内 deepFreeze 只消费数据载荷（SA2/SA8 独立扫描一致） |
| L90–93 验收（逐服务回归 + 包内 helper + 形态断言审计 + 门禁 + tarball） | **MET** | 见 §1 AC1–AC8 各行 |
| CONTEXT L129–131 Avoid 红线（禁数据属性方法形态、禁去 freeze） | **MET** | 实现即红线兑现；diff 未新增任何「冻结字面量 + 数据属性函数成员」形态；五处 freeze 全保留 |

生命周期/状态机冻结面（SA8 §5 十项）复核：4 个 service 名常量不在任何 hunk；hub `ctx.effect`（HEAD L442–448）与 peer `ctx.effect`（HEAD L551–556）`yield revoke; yield stop;` reverse-yield 块逐字未动（HEAD 实读）；registry 常量区/信封零触碰；wire/docs 零改动。SA8 实现后复查已独立闭合（`clear`，`requiresConflictRecheck=false`），本审查结论一致。

## 4. Scope creep 核查

- **代码/测试面**：无。7 个包内文件的每个 hunk 均可一一对应到 AC1–AC6 与 SA6 §12 契约：4 源文件 = 五服务表面改造（S1–S5），3 测试文件 = AC1/AC2/AC3 点名的回归。无契约外行为改动、无顺手重构、无配置/CI/构建链改动（`vitest.config.ts`/`ci.yml`/`scripts/**`/三包 `package.json` 零 diff）。
- **文档面**：diff 含 9 个 `wiki/raw/` 过程档案（brief 档案、SA1–SA8 产物）——技能规程强制交付物，与仓库既有任务惯例一致，非 scope creep。`CONTEXT.md`/`docs/**` 零改动（SA8 判定零文档演进，相符）。
- **diff 外工件**：untracked 的 7 个文件（brief `task_issue-330.md` + 6 个日志/探针证据）不在已提交 diff 内，属 worktree 证据留存，不构成交付面问题。

## 5. 缺失/部分实现清单

**无 unmet、无 partial、无 unachievable。** 两条契约字面小偏差（均不弱化红灯断言本体：sweep + 行为直通 + 姿态组 + 键面完整）：

1. **MINOR**：hub 用例未显式断言「listener close 恰一次」（SA6 §12.2 #9 尾项）。drain 语义由既有 `ws-replication-plugin.test.ts` drain 用例覆盖，SA7 D12 以 stub 计数动态补证（close=1，跨显式 stop + `fiber.dispose()`）。SA4 O1 已判定非阻断。
2. **MINOR**：peer `status` 未与直连读数 deep-equal（SA6 §12.2 #10；hub 侧有 `toEqual(service.status)`），以字段级 `state`/`connection ∈ [...]` 断言替代。SA7 E4/E11 动态补证快照字段不回归。SA4 O1 已判定非阻断。

## 6. PR 必须披露事项

1. **仓外联动未完成项（非本仓缺口，ADR 0023 L93 后半）**：DSH 侧 `nomicore-host` 用新 tarball 重建、revision 切换 live reload、回退 DSH fork 沙箱守卫——本仓验收边界止于三包 tarball 可构建且 dist 含访问器形态产物（已核验）。合并后需 DSH 侧执行联动方可关闭 tracking issue #328 的端到端症状。
2. **CI 首次全量运行**：本地门禁证据齐备（root 341 文件/3596 用例 + typecheck + pack:local），PR 上 CI（Node 20/24 × shard + typecheck job）尚待首次运行确认（SA4 §11 后续项）。
3. **两条 MINOR 测试字面偏差**（§5）：hub listener close 计数断言与 peer status 直连 deep-equal 未入 checked-in 测试，已有 SA7 动态证据补证；后续维护可补显式断言。
4. **DSH 沙箱对任意冻结服务的一般性缺陷**为 host 侧残留议题（ADR L95–97），不在本票。

## 7. 结论

最终已提交 diff 对 Issue #330 正文（AC1–AC8 + 明确不改清单）、SA6 验收契约（§12.2 逐成员/§12.3 纪律/§12.4 姿态/§12.5 路径/§12.6 门禁/§13 红绿纪律）与 ADR 0023（决策/影响面/姿态/验收）逐项忠实落地；冻结姿态不弱化、TS 公共类型面零变化、方法体与状态机一行不动、红→绿证据链真实、无 scope creep。关键 AC 无 partial/unmet/unachievable；两条 MINOR 偏差不阻断。**Verdict：`approve`**。
