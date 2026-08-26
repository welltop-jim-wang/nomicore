# 冲突门禁报告（设计后复审）

- 被审对象：`wiki/raw/task_namespace-runtime-registry-seam_design.md`（SA1 R0 初版，2026-08-25）
- 冲突基准：`docs/adr/` 全集 9 篇 + 根 `CONTEXT.md`（本会话前置门禁已全量读取盘点；按技能协议本次为轻量复审——聚焦设计决策逐条对照，不重复全量盘点，0001–0005「不相关」结论沿用前置报告 `…_conflict_report.md`）
- 配套更新：`…_relevant_decisions.md` 已追加「设计后复审追加（SA8，R0）」节，登记设计引入的新决策点 N1–N8
- 前置门禁结论：verdict `clear`（4 条候选张力均 no-conflict）

## Verdict

`clear`

## ADR 对照（设计决策 × 相关 ADR 条款）

| 设计决策 | 对照 ADR 条款 | 对照结论 |
|---|---|---|
| §D-A internal entry：`src/internal.ts` leaf、恰一键值导出、零类型导出、与主 entry 互不引用 | ADR 0009「`@nomicore/namespace-runtime/internal` 唯一导出的 `createNamespaceRuntimeForRegistry`」「主 entry 不公开生产 Runtime 构造器」 | 一致；「零类型导出」是对「唯一导出」的最强解读（收紧而非放宽），不构成违反；no-conflict |
| §D-B 两参形签名，`notifyDirty` 必填无缺省、不代绑；handle 独占租约 + 构造失败所有权归调用方 | ADR 0008「`notifyDirty` 是由构造方绑定 `persistence.saveDoc(handle)` 的窄接缝；Runtime 不依赖整个 `DocPersistence`」「Runtime 成功构造后独占一个 `DocHandle`；构造失败时所有权仍归调用方」 | 一致——必填参数即「构造方绑定」的类型面表达，绑定动作归未来 Registry；no-conflict |
| §D-B 状态门放行 `{ready, persistence-degraded}`（标注为委托继承的既有行为） | ADR 0009「fatal 和 persistence-degraded 只改变 Runtime capability，不改变 open 或 idle retention 语义」；ADR 0006（2026-08-22 修订）「Runtime……在业务 mutation 前读取 `handle.getStatus()`，已 degraded 则拒绝开始新写入」 | 一致——degraded 拒绝面在写前 gate（写槽），不在构造；构造放行 degraded 正是 0009「degraded 不改 open 语义」的推论；且本设计零行为改动（纯委托既有实现）；no-conflict |
| §D-C 纯委托既有生产工厂，构造序单一实现；委托链第三跳 `p0Gate`/`compile` 缺席 → P0 恒走真实 `compileSchemaEnvelope` | ADR 0008「P0 只读取 SCHEMA 标准四键、调用 `compileSchemaEnvelope` 并构造 schema-dependent tools」「生产工厂保留包内，由未来 Registry 使用」 | 一致——生产路径恒真实编译、无注入门；消灭第二构造路径恰是该 ADR 意图；no-conflict |
| §D-C internal.ts 不 re-export `createNamespaceRuntimeWithSeam`/`NamespaceRuntimeSeamInput`/`createNamespaceRuntime` 别名 | ADR 0008「测试通过包内确定性 seam 注入可控 P0、dirty notifier、handle 与 fault」 | 一致——测试 seam 保留包内模块通道，不进任何 package entry；no-conflict |
| §D-D exports 键集恰 `['.', './internal']`、version bump、无测试子路径 | ADR 0009 subpath 决策 | 一致——新增键即 ADR 钦定的生产通道；no-conflict |
| §D-E 存量 T1.4 键集断言演进 `['.']` → `['.', './internal']` | ADR 0009 subpath 决策；「testing seam 绝不进 package entry」立法（issue #93，非 ADR/CONTEXT 基准） | 一致——演进方向由 ADR 0009 直接要求；非 ADR 立法仅记录（不变量实质保持：新增键是生产通道，非测试通道）；no-conflict |
| §D-F 边界三硬规则（生产零消费 / 相对导入 only / 测试目录豁免） | ADR 0009「模块边界测试限制该 internal subpath 只能由 Registry 生产代码消费」 | 一致——见候选张力 T4 裁定；no-conflict |
| §6 DENY list：`src/index.ts`、`src/runtime.ts`、语义层文件、`docs/adr/**`、`CONTEXT.md` 零改动 | ADR 0008 公共面/语义不变量；ADR 0009 主 entry 封闭 | 一致——设计未触碰任何被冻结面；no-conflict |
| §D-G README 一行对齐（可选） | 无 ADR/CONTEXT 条款触及 README | 不构成冲突基准项；scope 取舍归 SA2 |
| 术语使用（写序列器、P0、seam、dirty notifier 等） | CONTEXT.md 各词条及 `_Avoid_` 清单 | 无 `_Avoid_` 词违规（未用 mutation queue / schema 注册表 / validated read 等）；no-conflict |

## 冲突点

无。全部对照结论为 no-conflict；无 override-declared、无 evolution、无 hard-violation。

显式裁定过的候选张力（均为 no-conflict，记录备查）：

| # | 候选张力 | 裁决 | 依据 |
|---|---|---|---|
| T1 | internal「零类型导出」是否违反 ADR 0009「唯一导出的」 | no-conflict | 最强解读使导出面严格小于等于 ADR 允许范围（收紧不放宽）；消费方类型 `NamespaceRuntime` 取自主 entry，无可用性缺口条款被 ADR 冻结 |
| T2 | `notifyDirty` 必填参数化是否与 ADR 0008 稳定码注册修订「notifyDirty 未绑定的构造方义务 loud gate」冲突 | no-conflict | 写槽内 loud gate 是既有语义且设计明言保留（覆盖 seam 缺省/未绑路径）；factory 层类型必填只是使该 gate 在本通道类型上不可达，未删改任何可观测语义 |
| T3 | 构造状态门放行 `persistence-degraded` 是否违反 ADR 0006 degraded 拒绝条款 | no-conflict | ADR 0006（2026-08-22 修订）把 degraded 拒绝面定位于业务 mutation 前的写前 gate；ADR 0009 明文「persistence-degraded 只改变 Runtime capability，不改变 open 或 idle retention 语义」；且该行为系委托继承的存量行为，本设计零改动 |
| T4 | 边界审计豁免 test 目录（SA6 测试 import internal subpath 作被测探测）是否放宽 ADR 0009「只能由 Registry 生产代码消费」 | no-conflict | 该条款约束的是**生产消费面**；模块边界测试自身必须探测被测对象，否则条款不可实施——豁免是条款可实施性的组成部分而非漏洞；包内测试纪律另由 ADR 0008「测试通过包内确定性 seam 注入」承载；设计 §D-F 规则 3 同时禁止移动测试文件绕审计，无规避通道 |
| T5 | T1.4 存量断言改动是否属未经授权的契约演进 | no-conflict | 演进方向（键集含 `./internal`）由 ADR 0009 直接要求；「testing seam 绝不进 package entry」立法非 ADR/CONTEXT 基准（SA8 不裁），且其不变量实质保持 |

## 结论

**Verdict: clear，放行设计进入 SA2 全维度攻击评审。**

- SA1 设计 R0 未与 ADR 决策集（0006/0007/0008/0009）及 CONTEXT.md 的任何条款冲突：七条 AC 的设计承载全部落在 ADR 0009 §模块与 Cordis service 的冻结边界之内，语义不变量以「纯委托同一实现」的结构方式保持（强于逐条复刻）。
- 无 override-declared（设计未声明推翻任何 ADR）且无 evolution（设计未意图修订任何 ADR 决策；DENY list 明确 `docs/adr/**`、`CONTEXT.md` 零改动）。
- 边界提醒（非冲突）：§D-G README 改动无 ADR 基准，属 scope 判断，归 SA2 裁夺；§7 P1–P5 协议假设与 §8 连锁审计的事实性验证亦属 SA2/SA3 领地，SA8 不判。
- 设计引入的新决策点 N1–N8 已登记入 `…_relevant_decisions.md`「设计后复审追加」节，SA2/SA3/SA4 直接复用；其中 N2（零类型导出）、N3（两参形）、N4（纯委托）为设计自选形态——ADR 只定上界，这三条若 SA2 评审后修订，须同步更新相关决议文档。
