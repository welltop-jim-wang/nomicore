# 冲突门禁报告 — task_registry-idle-plugin-shutdown-rev1（issue #112 round 2）

- 被审对象：`wiki/raw/task_registry-idle-plugin-shutdown-rev1.md`（spec 审查裁定的 3 项
  高风险修复）
- 冲突基准：`docs/adr/` 全集 9 份（逐个全读，无抽样）+ `CONTEXT.md`；辅助对照上一轮档案
  `wiki/raw/task_registry-idle-plugin-shutdown*.md`（任务级冻结，非 ADR）
- 门禁时机：前置门禁（SA6 红灯 / SA1 设计之前）
- 产出日期：2026-08-27（run_id issue-112-1787739744-862383，round 2）

## Verdict

`clear`

（4 项对照全部 no-conflict；0 hard-violation、0 override-declared、0 evolution。
无停止原因、无 Jim 裁决项。对总控两个重点裁决点的结论见冲突点 #3、#4 与「结论」。）

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 唯一真相源 | accepted | 无 | 无冲突（schema 语言域，不触及本任务） |
| 0002 | 重写定位、authority 出范围 | accepted | 无 | 无冲突 |
| 0003 | 求值器与派生 schema | accepted | 无 | 无冲突 |
| 0004 | 类型投影协议包 | accepted | 无 | 无冲突 |
| 0005 | 投影生成管线 | accepted | 无 | 无冲突 |
| 0006 | Persistence Docstore（含 #64/#79 修订节） | accepted | **有**（问题 3 persistence 边界；close→release 排空下游） | 无冲突；若触及 persistence src 须遵守共享 core 纪律（见 #4 依据列） |
| 0007 | 逻辑验证与 Yjs bridge | accepted（open/read 条款被 0008 取代） | 弱关联 | 无冲突（被取代部分不构成约束；其余条款不触及） |
| 0008 | Runtime 能力与单序列器（含稳定码注册修订） | accepted | **有**（问题 1/2 的 close 语义与失败通道） | 无冲突（同步 throw 收编兼容 close 契约，见 #1/#2） |
| 0009 | Registry 租约与 Host 生命周期 | accepted | **有**（核心：三项修复全部落入本 ADR 冻结域） | 无冲突（三项均为履行既有条款，见 #1–#3） |

无任何 ADR 处于 superseded-by 状态需豁免（0007 的部分条款被 0008 取代，已在表中标注）。

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | 核对（非冲突） | ADR-0009:101「所有 Runtime 都尝试 close……shutdown 最终以稳定 `NamespaceRegistryShutdownError` 聚合 close failures，不因第一项失败跳过其余 Runtime」 | 问题 1：runShutdown 对每次 close 发起同时收编同步 throw 与 Promise rejection；全部 Runtime 仍被尝试；`entries.clear()`+`acceptance='stopped'` 恒执行；同步 throw 与 rejection 同构进入 failures | **no-conflict** | 要求是 :101 的直接履行——现状「首个 close 同步抛错即中断」本身低于 ADR 保证。ADR-0008:93 冻结的 close 语义未规定 `close()` 恒不同步 throw（契约外行为），Registry 收编属其自身聚合职责（ADR-0009:101），不修订 0008 的 close 契约。终态先于 throw 的推进与 round 1 §2.D 冻结一致（保持）。 |
| 2 | 核对（非冲突） | ADR-0009:50「若 timer callback 先同步将 entry 转为 closing，则该转换不可逆；后续 open 等待同一个 close Promise 结算，再 load 并建立新 generation」；:95「event可携带受控 identity和exact cause」 | 问题 2：beginIdleClose 统一失败收编路径——同步 throw 走 I2 许可的 closing 语义（closePromise 以 rejected Promise 落位）→ `idle-close-failed` 恰一次（exact cause）→ removeOnlySelf 移除；零 unhandled rejection、不逃出 timer callback、不污染后续 open | **no-conflict** | 全部要素均为既有条文的直接扩展：I2（round 1 设计不变量，非 ADR）被**保持**而非修订；「后续 open 可建立新 generation」是 :50 字面（结算含 reject，round 1 已冻结 open 吞 reject 路径）；observer exact cause 恰一次符合 :95 与 round 1 §2.C「发起侧单点」；与 ADR-0007:54 的 Yjs observer 纪律同精神不同域，无互涉。 |
| 3 | 重点裁决 | ADR-0009:103「Cordis依赖图保证 Registry先于Persistence停止」；「Persistence 停止」的字义由 ADR-0006:86「dispose 时释放文件句柄、后台任务和 Y.Doc 缓存；宿主负责按依赖逆序停止插件」界定 | 问题 3：把 round 1 固化的「fiber 级」保证强化为真实 adapter 级次序（adapter dispose 不先于 Registry shutdown settle），并以集成探针证明 | **no-conflict** | ADR-0009:103 的规范性内容是次序保证本身（「Registry先于Persistence停止」）；按 ADR-0006:86，Persistence 的「停止」= 其 dispose（释放句柄/任务/缓存），故 adapter dispose 落入该保证字面范围。round 1 的「fiber 级」收窄（§2.F 头注契约第 2 条 + §8 R1）是**设计层解释**，记录于 wiki 档案而非 ADR，不约束 round 2。本轮强化是**回归 ADR 字面保证的履行**，不是对任何 ADR 决策的修订——不构成 evolution，更非 hard-violation。（「Cordis依赖图保证」的机制归因经 round 1 §5#5/#6 源码亲核只兑付 fiber 级次序，属机制事实陈述而非冻结决策；补足编排以兑付既定保证不改决策内容。） |
| 4 | 重点裁决（边界） | 无 ADR 条款触及（round 1 §4 DENY LIST 属任务范围决策，非 ADR/CONTEXT）；触及 persistence src 时适用 ADR-0006:157-159/:196/:83/:86 | 问题 3 注意项：是否允许在 persistence 侧加排空钩子，或必须在 registry plugin 侧纯编排解决 | **no-conflict**（附条件允许） | ① DENY LIST 不是 ADR 亦非 CONTEXT，按门禁基准不构成自动阻塞；round 1 自己把根治列为「建议后续票」（§8 R1 + 开放问题 2），round 2 简报（总控意志）已显式重启该边界并明文委托 SA8/SA1。② ADR 全集无任何条款禁止 persistence 侧排空/串行化钩子。③ 可行性事实（供 SA1，非裁决）：round 1 §5#5/#6 机制证据表明 adapter dispose 注册于 persistence fiber 本级 effect 清单、fiber `_unload` 对本级 disposables 并发执行——registry plugin 侧无法重排 persistence fiber 内部次序；若集成探针要求「persistence fiber 先行卸载」场景下 adapter 级次序成立（SA7-P2 场景），纯 plugin 侧编排不完整，persistence 侧改动是唯一完整路径；最终路径由 SA1 定夺并显式记录。④ 若触及 persistence src，须遵守：共享 persistence lifecycle core（两 Adapter 不得复制状态机，:157-159/:196）；只依赖 Cordis/Yjs/contracts（:83）；「宿主负责按依赖逆序停止插件」职责不变、不得转嫁宿主新义务（:86）；service 面（`nomicorePersistence`，ADR-0009:26）不变。 |

补充记录（非冲突点）：

- SA7-P2 旧测试假设的删除/改写：测试层面事项，无 ADR 冲突。注意 ADR-0009:101 的聚合
  错误通道本身是冻结契约（AC10）——SA7-P2 承载的「聚合通道真实工作」覆盖若随场景假设
  一并删除，须由其他用例继续锚定（属 SA2/AC 门禁关注点，不构成本门禁阻塞）。
- 简报执行约束（确定性测试、禁 real sleep、版本 bump、不 push）与 ADR-0009:83 确定性
  测试纪律一致，无冲突。
- 13 条验收标准整体不回归：AC11 在本轮简报中标注「强化为真实次序保证」——该强化方向
  与 ADR-0009:103 一致（见 #3），其余 12 条无 ADR 层面变动。

## 结论

**Verdict: clear —— 放行。**

- 三项修复要求与 ADR 全集 + CONTEXT.md **零冲突**：问题 1/2 是 ADR-0009:101/:50/:95 的
  履行性收编（现状低于 ADR 保证，修复即合规）；问题 3 是回归 ADR-0009:103 字面保证的
  强化（round 1「fiber 级」收窄非 ADR，不约束本轮）。
- **persistence 边界裁定**：允许在 persistence 侧加排空/串行化钩子（无 ADR 障碍；
  DENY 属 round 1 任务范围决策且已被本轮简报显式重启），不强制「纯 plugin 侧解决」；
  机制证据显示纯 plugin 侧编排在该场景下不完整。SA1 必须在设计中**显式记录**所选路径、
  触及 persistence 的具体文件与理由，并满足 ADR-0006 共享 core / 依赖边界 / 宿主职责
  四条约束（见 #4 依据列④）。
- 无 override-declared、无 evolution、无需 Jim 裁决条目。
- 后续门禁衔接：SA1 设计产出后，SA8 设计后复审将重点核对——头注契约第 2 条改写、
  §8 R1/开放问题 2 的收口表述、SA7-P2 改写后聚合通道覆盖是否保持、以及 persistence
  侧改动是否守住 ADR-0006 四条约束。
