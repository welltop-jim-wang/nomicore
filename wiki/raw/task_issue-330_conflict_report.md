# 冲突门禁报告 — Issue #330 nomicore 服务表面 getter 化（ADR 0023 落地）

## 1. Reviewed subject

- **task（前置门禁，SA1 派发前）**：Issue #330 任务简报（`wiki/raw/task_issue-330.md`）Problem/Scope/明确不改/Acceptance Criteria 1–8 全文。
- Issue-comments 读取结果为 `[]`：无 Owner 评论要求，无可应用的 comment ID/时间戳——**无任何评论来源的 override 或附加义务**。

## 2. Inputs and decision set

- 冲突基准：`docs/adr/` 全集 20 文件（0001–0014、0016–0019、0022、0023）逐个核对状态行（全部「已接受」；无整篇 superseded；ADR-0007 仅 open/read 条款被 0008 部分取代且与本任务无交集）+ 根 `CONTEXT.md` 全读（含 L129–131「服务表面」术语）。
- 按收录关系附入的模块决策：`packages/namespace-registry/AGENTS.md`、`packages/ws-replication/AGENTS.md`、`packages/clock/AGENTS.md`；`docs/protocols/instance-replication-v1.md` 做无交集核验。
- 源码现状核验（只佐证事实，不构成独立冲突基准）：`registry.ts` L2179–2281、`plugin.ts` L431–439/L505–545、`system.ts` L9–11、`manual.ts` L34–52、`instance/src/index.ts` L61–64、`persistence/src/memory.ts` L74 / `file.ts` L59、`persistence/src/testing.ts` L161–191、三包测试断言面。摘录与行号锚见 `wiki/raw/task_issue-330_relevant_decisions.md`。
- `wiki/raw/` 历史工件按 docs/AGENTS.md 属证据非规范契约，不构成冲突基准。

## 3. Decision analysis

| Decision | Clause | Subject behavior | Classification | Evidence | Required action |
|---|---|---|---|---|---|
| ADR 0023 | 决策 L45–62：函数成员一律访问器属性（getter 返回稳定闭包）、方法体提闭包、`Object.freeze` 保留、落地 4 生产 + 1 testing | 简报 L17–19 + AC1–AC3 对同一五对象（registry / hub / peer / systemClock / ManualClock）做同款机械变换，方法与状态机一行不动 | implements-existing-decision | `docs/adr/0023-...md` L45–62；`task_issue-330.md` L17–19、AC1–3 | 无（属兑现缺口：ADR 已接受、代码未改造——现状核验 relevant_decisions §现状 1–3） |
| ADR 0023 | 影响面表 L30–41：排除 `nomicoreInstance`（纯数据）、`nomicorePersistence`（class）、`timer`（上游）；lease/session 返回值与 issue/status 信封不受影响 | 简报 L21「明确不改」清单与 ADR 逐项一致 | no-conflict | ADR L37–41；task L21 | 无 |
| ADR 0023 | 姿态对照 L64–74：赋值仍拒、`defineProperty` 重定义仍拒、TS 类型面不变、引用缓存不变（同一稳定闭包）、枚举性保持 | AC5 逐句同款（freeze 保留、赋值/重定义仍拒、TS 公共类型面零变化） | implements-existing-decision | ADR L64–74；task AC5 | 无 |
| ADR 0023 | 验收 L90–93：guard-proxy 回归测试逐服务、包内 helper 不新建共享设施、`writable === false` 断言更新为访问器形态断言、三包门禁 + root typecheck/test、tarball 就绪 | AC1–4、AC6–8 逐条对应（含 AC4 的「无此类断言则审计结论记录在案」分支） | implements-existing-decision | ADR L90–93；task AC1–4、AC6–8 | 无 |
| ADR 0023 | 实现注意 L78：deepFreeze 按 `descriptor.value` 递归需注意访问器 | 仓内 deepFreeze（namespace-diagnostic-log / vfsl）只作用于数据载荷，不消费五个服务对象 | no-conflict | `packages/namespace-diagnostic-log/src/pipeline.ts` L36–43；relevant_decisions §现状 6 | 无（实现侧留意即可） |
| CONTEXT.md | 「服务表面」术语 L129–131：访问器纪律已登记；Avoid 含「为可包装性去掉 Object.freeze」 | 任务行为即术语定义的兑现；无需改 CONTEXT | no-conflict | `CONTEXT.md` L129–131 | 无（术语已与 ADR 同步，本变更集零文档演进） |
| namespace-registry/AGENTS.md | L15 公共 API 只经 `src/index.ts`、hostile/test 控制留显式 testing 面；L17–19 验证门 | 任务只加测试与包内 ~10 行 helper，零新公共 API；AC7 跑包门禁 + root 门禁 | no-conflict | `packages/namespace-registry/AGENTS.md` L15–19；task AC6–7 | 无 |
| ws-replication/AGENTS.md | L16 plugin 拥有自有发布 service；L5 改 wire/生命周期前读 ADR 0010/0012/协议；L20–22 验证门 | 改造仅限自有 service 的构造形态；wire/FSM/lifecycle 零触碰（触发条件不成立），包门禁仍跑 | no-conflict | `packages/ws-replication/AGENTS.md` L5、L16、L20–22；task AC2、AC7 | 保持 `ctx.effect` 内 revoke→stop reverse-yield 次序（`plugin.ts` L438–445/L540–545） |
| clock/AGENTS.md | L9 `Clock.now()` 语义；L12 ManualClock 留 `@nomicore/clock/testing`；L13 公共 API 只经 index；L16 服务契约变更跑 root typecheck | 只改属性形态，语义/导出边界不变；门禁按 AC7 执行 | no-conflict | `packages/clock/AGENTS.md` L9–16；task AC3、AC7 | 无 |
| ADR 0009 + clock contract | Registry 构造期 Clock 形状门禁 `typeof clock.now === 'function'`（`registry.ts` L620–628）；peer 侧 `clock: { now: () => clock.now() }` 包装（`plugin.ts` L482） | getter 返回稳定闭包 ⇒ `typeof` 仍 `'function'`，门禁与消费路径天然通过 | no-conflict | `registry.ts` L620–628；`plugin.ts` L482 | 无（不得借机改门禁文案/顺序） |
| ADR 0012 | Instance 身份与 WS plugin 所有权；provide/revoke 模式 | 所有权与 teardown 模式零变化；`yield stop` 闭包引用经「同一稳定闭包」保持 | no-conflict | `packages/instance/src/index.ts` L35–37；`plugin.ts` L438–445 | 无 |
| instance-replication-v1.md | wire 帧/状态机/错误码/§21 关闭语义 | 零 wire 触碰（进程内 JS 构造面，非 wire 面） | no-conflict | `docs/protocols/instance-replication-v1.md`（服务对象无条目；§685 Hub close 语义不涉属性形态） | 无 |

裁决分布：no-conflict 8 项、implements-existing-decision 4 项、evolution-required 0、hard-conflict 0。

## 4. Overrides

| Old decision | Override authority | Scope | New obligation |
|---|---|---|---|
| — | — | — | — |

无 override 需求：任务全部要求与既有决策一致；Issue-comments 为 `[]`，不存在 Owner 评论来源的 override 权威，亦无其被消费的记录。

## 5. Frozen surfaces

| Surface | Must remain unchanged | Evidence | Actual result |
|---|---|---|---|
| Cordis service 名 | `nomicoreRegistry` / `nomicoreHubReplication` / `nomicorePeerReplication` / `clock` 字符串不变 | `plugin.ts`（registry）L67、`plugin.ts`（ws）L27–28、`contract.ts` L23 | 任务不触及（待实现核对） |
| 公共 TS 类型面 | `NamespaceRegistry`、`HubReplicationService`（L35–40）、`PeerReplicationService`（L48–56）、`Clock`、`ManualClock` 零变化（接口不区分数据/访问器） | ADR 0023 L70；task AC5 | 待实现核对 |
| 冻结姿态 | 五对象 `Object.freeze` 保留；赋值与 `defineProperty` 重定义仍拒；getter 返回同一稳定闭包 | ADR 0023 L64–74 | 待实现核对（`Object.isFrozen` 既有断言 clock-contract.test.ts L72/L112 须保持绿灯） |
| 枚举性 | `Object.keys(systemClock) === ['now']`、ManualClock `[now, set, advance]` | clock-contract.test.ts L71–72、L110–111；ADR 0023 L73 | 待实现核对 |
| 方法行为/状态机 | 方法体一行不动（registry 七方法、hub/peer service 成员、clock 三成员）；`shutdown()` 非 async、精确返回缓存 Promise 的幂等语义 | `registry.ts` L2180–2279（L2262–2279 注释契约）；ADR 0023 L45 | 待实现核对 |
| plugin teardown 次序 | `ctx.effect` 内 provide-revoke 与 stop 的 reverse-yield 次序 | `plugin.ts` L438–445、L540–545 | 待实现核对 |
| Registry 信封/常量 | issue/status 冻结常量与结果联合形态不变（非服务表面，不访问器化） | `registry.ts` L465–591；ADR 0023 L41 | 待实现核对 |
| 数据载荷快照纪律 | clonePlainData / copyFrozen 的 `writable: false` defineProperty 不被误伤（JSON 域数据，非函数成员） | `registry.ts` L763–768；`namespace-runtime/src/runtime.ts` L619 | 待实现核对 |
| testing 导出边界 | ManualClock 仅经 `@nomicore/clock/testing`；不新建共享测试设施 | clock/AGENTS.md L12；ADR 0023 L90 | 待实现核对 |
| wire 协议 | 帧/码/状态机零触碰 | instance-replication-v1.md | 任务范围外（简报明示不改 wire） |

## 6. Evolution requirements

无。ADR 0023 已接受且与简报同源（commit `83581b3`，PR #329 谱系）；CONTEXT.md 术语已登记。本变更集不需要修订任何 ADR、CONTEXT 或协议文档——纯 existing-decision 兑现。

## 7. Hard conflicts

无。

## 8. Required actions

无阻塧行动。给下游 SA 的非冲突提醒：

1. **稳定闭包纪律**（ADR 0023 L45/L72）：getter 每次访问返回**同一**闭包实例——hub/peer 的 `stop`、registry 的 `shutdown`（exact-same-Promise 幂等锚）均依赖引用同一性；禁止在 getter 内联新建函数表达式。
2. **registry `shutdown` 不得 async 化**：现注释明言 async 包装会破坏 AC12「并发/重复调用 exact same Promise」（`registry.ts` L2262–2264）；提闭包时保持原函数形态。
3. **AC4 审计结论**：三包测试无服务成员 `writable === false` 断言（`writable` 命中全为 socket `writableLength`）；既有形态断言为 `Object.keys` 键面 + `Object.isFrozen`（访问器形态下保持绿灯）。实现侧把该审计结论记录在案即满足 AC4 后半分支。
4. **不误伤数据载荷冻结**：`clonePlainData`/`copyFrozen` 族的 `writable: false` defineProperty 是数据快照纪律，与本次「服务表面访问器化」无关，不得一并改写。
5. **范围外事实备案**：`persistence/src/testing.ts` fake timer（未冻结 plain 字面量、上游 `timer` shim）不在 ADR 0023 影响面表亦不在本票范围——未冻结属性不受 Proxy `[[Get]]` 不变量约束，无扩散义务。
6. Hub/Peer 的 `status` 成员现已是 getter（`plugin.ts` L432/L506）：同款改造只及于其余数据属性方法成员，AC2 的成员覆盖清单与现状一致。

## 9. Verdict

**clear** —— 全部对照项为 no-conflict 或 implements-existing-decision（8 + 4）；无 evolution-required（决策与术语均已就位）、无 hard-conflict、无 override 需求；输入完整（ADR 全集 + CONTEXT + 三包 AGENTS + 任务简报；Issue-comments 为空即无评论义务）。任务为 ADR 0023 的机械兑现，可进入 SA1/实现流程。

## 10. requiresConflictRecheck

**true** —— 本次改造变更五个公共 Cordis 服务对象的运行时属性形态（公共 API 运行时面）与 plugin apply 内的构造/闭包提升点（生命周期构造面）；虽然目标形态由已接受的 ADR 0023 完整规定，实现 diff 仍需按第 5 节 Frozen surfaces 逐项核对（姿态表 `configurable === false` / `typeof get === 'function'` / `set === undefined`、freeze 保留、TS 零变化、方法体一行不动、teardown 次序不变）。设计/实现复查阶段应做冲突复核并闭合本表。
