# 冲突门禁报告（设计后复审）— task_registry-idle-plugin-shutdown-rev1_design（issue #112 round 2）

- 被审对象：`wiki/raw/task_registry-idle-plugin-shutdown-rev1_design.md`（SA1 设计 rev1，635 行，全读）
- 冲突基准：`docs/adr/` 全集 9 份（前置门禁已全读，本轮不重复盘点）+ `CONTEXT.md` +
  本 SA8 前置产出 `_rev1_relevant_decisions.md`（含 round 1 档案冻结决策摘录与
  设计后复审追加 D1–D7）
- 复审范围（按技能：轻量复审，不重复前置门禁全量盘点）：P3 persistence 侧有序
  disposer（`bindPersistenceAdapterLifecycle`）vs ADR-0006 四条约束与 ADR-0009:103；
  P1/P2 收编 vs I2 与聚合语义（ADR-0009:50/:95/:101）；设计对任务档案冻结决策的修订
- 关键事实独立核验（SA8 亲核，非采信设计自述）：
  - `persistence/src/index.ts` **不转出** `service.ts`——helper 新增导出不外泄包公共面；
  - `service.ts` 现有导出（assert/scheduler）即包内共享 wiring leaf，仅被 memory/file
    引用；`lifecycle.ts` 不 import service（service→contract 单向，新增 contract.js
    运行时导入不成环）；
  - memory/file `apply` 现状（provide wrapper 留 fiber 级 + dispose 为同级 effect）与
    设计 §1.3 缺陷描述一致；plugin.ts 头注第 2 条、registry.ts runShutdown 发起段/
    beginIdleClose 现状与设计 §1.1/§1.2 逐字对应。

## Verdict

`clear`

（6 项对照全部 no-conflict；0 hard-violation、0 override-declared、0 evolution。
1 条非阻塞勘误注记（引文笔误），见结论。前置门禁的四条 ADR-0006 约束全部守住。）

## 冲突点

| # | 严重度 | ADR 条款 / 冻结决策 | 设计决策 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | 核对（非冲突） | ADR-0009:101「所有 Runtime 都尝试 close……稳定 `NamespaceRegistryShutdownError` 聚合……不因第一项失败跳过」；round 1 I2/§2.D 终态冻结 | P1（§2.A）：发起段 try/catch，同步 throw 合成 rejected Promise 同构进聚合；`void promise.catch(()=>{})` 即刻挂接；聚合循环与终态推进逐字不动 | **no-conflict** | 履行前置门禁 #1 同一结论：同构聚合是 :101 的实现而非修订。I2 **保持且强化**（rejected Promise 先落位后翻相，同一同步段）；「先 stopped 再 throw」冻结保持；零 floating window 处理与「零 unhandled rejection」纪律（:95 域外但同源）一致；不新增 observer 事件——维持 round 1「shutdown 不加事件」冻结，`idle-close-failed` 仍专属 idle 发起侧（:95 seam 边界不扩张）。 |
| 2 | 核对（非冲突） | ADR-0009:50（closing 不可逆/后续 open 建新 generation）、:95（observer exact cause）；round 1 I2/I4 与 §2.C 四通道冻结 | P2（§2.B）：同步 throw 合成 rejected closePromise；④⑤ 两臂同一同步段挂接；四通道结构不变、扩展到同步 throw | **no-conflict** | I2 保持（先落位后翻相）；I4 收缴次序不动（token 收缴先于 close 发起）；observer exact cause 恰一次仍为发起侧单点；removeOnlySelf 双守卫与后续 open 新 generation 是 :50 字面（结算含 reject，round 1 已冻结 open 吞 reject 路径）；「不逃出 timer callback」修复的正是 AC7 收编缺口。同一同步段挂接（三条同步语句、零 await 间隙）确无 unhandled rejection 检查点暴露——与 §2.A 空 catch 的不对称有机制依据，非疏漏。 |
| 3 | 重点裁决 | ADR-0009:103「Plugin用一个有序 async disposer等待 Registry shutdown后再撤销service，**避免把多个 async effects当作清理顺序机制**。Cordis依赖图保证 Registry先于Persistence停止」 | P3 路径丙（§2.C.0–.3）：persistence 侧 `bindPersistenceAdapterLifecycle` 有序 disposer（generator effect：yield revoke re-parent + drainStep「await revoke() → finally adapter.dispose()」逆序串行）；registry plugin 有序 disposer 零改动 | **no-conflict** | ① adapter 级次序是 :103「Registry先于Persistence停止」的字面兑现（「停止」含 adapter dispose，字义见 ADR-0006:86——前置门禁 #3 已裁）。② 机制与 :103 的原则同构而非背离：现状（provide wrapper 与 dispose 两个 fiber 级并发 effect 隐含次序假设）恰是「把多个 async effects 当作清理顺序机制」的违例样态；设计把二者收进**单一有序 effect**，是把该原则施加到 persistence 侧，registry plugin 自身仍是一个有序 disposer（零改动）。③ 等待机制 = provide disposer 的依赖 fiber join（依赖图既有能力），非新造顺序原语；§2.C.6 无死环论证与 ADR-0008「不取消、不设 timeout」传导（R3′）同向。④ SA7-P2 旧假设「close 撞已销毁 handle→聚合失败」的删除是次序保证生效的必然结果，聚合通道本身（:101/AC10）覆盖由 19/19b/15a/18 保持（设计 §7，前置门禁关注项闭合）。 |
| 4 | 重点裁决 | ADR-0006 四条约束（前置门禁 #4 依据列④）：:157-159/:196 共享 core 不复制状态机、:83 只依赖 Cordis/Yjs/contracts、:86 宿主职责不转嫁、service 面不变（含 ADR-0009:26 强依赖/服务名） | §2.C.2 helper 落点与 §2.C.4 自查表；§4 ALLOW/DENY | **no-conflict**（四条逐条独立核验通过） | **约束 1**：`lifecycle.ts` 零改动且仍在 DENY；helper 是 Cordis **wiring** 单源（service.ts，两 Adapter 复用）——ADR-0006 枚举的共享 core 域（create/load 同键协调、flush 调度、entry 状态解析）一字未动，无每-Adapter 复制。**约束 2**：仅新增本包 `contract.js` 运行时导入（SA8 亲核：`provideNomicorePersistence` 在 contract.ts）+ 既有 Context 类型，零新依赖、零 DSH/NomicoreServer import。**约束 3**：不要求宿主新事；宿主直调 `adapter.dispose()` 语义/幂等性零变化；R1′ 把「宿主直调编排不在保证内」如实声明为 :86 宿主职权边界——是把依赖逆序原则落进自身 dispose 编排，非转嫁。**约束 4**：`DocPersistence` 接口、service 值、Memory/FilePersistence 公共签名不变；SA8 亲核 `index.ts` 不转出 service.ts，新导出不外泄公共面；`assertPersistenceHostDependencies` 仍先于 provide（ADR-0009:26 loud-fail 次序保持，设计 §3 AC3）。 |
| 5 | 边界核对 | 前置门禁 #4 裁定（persistence 侧改动附条件允许，所选路径须显式记录并守住四约束）；round 1 §4 DENY LIST | §2.C.0 路径裁决（甲/乙拒、丙采）+ §2.D 修订记录 + §4 窄边界（service/memory/file + package.json；lifecycle/contract/index/testing 仍禁） | **no-conflict** | 路径丙在前置门禁放行范围内且已按简报要求**文本显式记录**（§2.C.0 表 + §2.D 修订表）；甲的「结构性不可行」与乙的「微任务次序洞」拒绝理由是机制级论证，闭合了前置门禁「纯 plugin 侧不完整」的开放判断；窄边界与四约束落点严格对齐（lifecycle/contract/index/testing 禁改正是约束 1/4 的实现）。round 1 DENY 是任务范围决策，本轮窄解除由简报授权 + 前置门禁放行支撑，非 ADR 冲突。 |
| 6 | 档案修订核对 | round 1 冻结：§2.F 头注第 2 条（fiber 级）、§8 R1 + 开放问题 2、§5#6 机制事实 | §2.C.5 头注改写（adapter 级）、§2.D（R1 根治落地、§5#6 保留为事实陈述） | **no-conflict** | 修订对象全部是 wiki 任务档案而非 ADR/CONTEXT——修订不构成 ADR 层冲突；修订方向与 ADR-0009:103 字面一致（强化非推翻）。§5#6「fiber _unload 并发」作为机制事实保留、工程后果由 effect 内有序化抵消——事实与决策分层清晰。前置门禁预告的四个设计后复审核对项（头注第 2 条改写、R1/开放问题 2 收口、SA7-P2 改写后聚合通道覆盖保持、persistence 四约束）全部闭合。 |

## 结论

**Verdict: clear —— 放行（设计进入 SA2 评审）。**

- P3 采纳的 persistence 侧有序 disposer 守住 ADR-0006 全部四条约束（SA8 对导出面/
  模块图/断言次序做了独立核验，未采信设计自述）；机制与 ADR-0009:103「单一有序
  disposer + 依赖图保证」原则同构，adapter 级次序是「Registry先于Persistence停止」
  的字面兑现。
- P1/P2 收编保持 I2（先落位后翻相）与 ADR-0009:101 聚合语义（同构通道、恰一次、
  插入序）；I4 与四通道结构零触碰；零新事件面。
- 相关决议文档已追加 D1–D7（设计引入的新决策点）供 SA2/SA3/SA4/SA7 复用。

**非阻塞注记（1 条，交 SA3 落地时更正，非冲突）**：设计 §2.C.2 helper 文档注释引用
「ADR-0006 :86/:103」——ADR-0006:103 实为「WAL 帧格式不进入 v1」条款（与本题无关），
该处应引 **ADR-0009:103**（有序 disposer 与依赖图保证条款）。注释级引文笔误，不影响
任何裁决结论；建议随实现更正为「ADR-0006 :86 / ADR-0009 :103」。
