# 冲突门禁报告

- 被审对象：任务简报 `wiki/raw/task_docscope-compile-cache.md`（Issue #54，H3：DocScope 作用域绑定与编译缓存，功能开发）
- 冲突基准：`docs/adr/0001–0005` 全集（5/5 逐篇全读）+ `CONTEXT.md`。代码与 wiki 其他文档（含 `docs/phases/phase-2-engine-gaps.md`）不构成阻塞依据，仅作背景理解。
- 门禁类型：前置门禁（SA 派发前）
- 报告：SA8（Conflict Gatekeeper），只读裁决，未改动任何被审文件

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 文本是 schema 的唯一真相源，只存在于文档与测试中 | accepted（含 2026-08-19 修订节、2026-08-21 命名修订） | 高度相关（编译缓存是该 ADR 显式条款；方言冻结/未知方言 loud-fail 约束缓存入口；纯引擎仓库边界） | no-conflict：任务即「引擎必须在运行时解析任意合法方言文本，性能依赖按内容哈希的编译缓存」的落地；未知方言经 H1 断言拒绝、不进缓存与「未知方言 loud-fail 只读」一致；纯引擎实现不引入仓内 schema 文本 |
| 0002 | nomicore 是全新 yjs-server 重写，authority 完全出范围 | accepted（无显式状态行；未被任何 ADR 标记 superseded） | 边界相关（DocScope 属读路径解析/求值设施，不触 authority 与写入管线） | no-conflict：任务不引入任何 authority 规则或旧 manifest 接口 |
| 0003 | 求值器与派生 schema——evaluate 接缝、ROOT 根别名约定、联合的分支列表表示 | accepted | 高度相关（getCompiled 组合的正是本 ADR 冻结的 parseVfsl/evaluate 公共接缝；可失败结果联合定义缓存值语义；被否方案 B 约束 getCompiled 层定位） | no-conflict：getCompiled 是组合既有公共接缝的缓存门面，不改动/收窄 parseVfsl 与 evaluate 契约；「evaluate 失败不污染缓存」与结果联合的 ok-branches 语义一致（见冲突点 #1、#2） |
| 0004 | vfsl-protocol 类型协议包——编译期路径投影的五个设计决策 | accepted | 边界相关（D3 划定协议包与引擎包分离；任务「零新运行时依赖」与零运行时精神一致） | no-conflict：任务全部落在引擎侧（packages/vfsl），不触碰协议包、不新增运行时依赖 |
| 0005 | 投影生成管线——SchemaSource 接缝、生成器输入契约、生成物入仓 | accepted | 高度相关（H1 断言通道的 ADR 依据；「id 是标签不是键」约束缓存键；async-from-day-one 权衡 getCompiled 形态；生成器输入契约约束双产出的消费方式） | no-conflict：缓存键为文本内容哈希而非 id，正是「id 是标签不是键」的执行；方言断言前置与 §1「消费方首动作 = 方言断言」一致（见冲突点 #3、#4） |

无 ADR 处于 superseded 状态；无条款触发 override / evolution 判定。

## 冲突点

无 hard-violation、无 override-declared、无 evolution。以下为逐条对照中值得复核的边缘项，均裁 no-conflict（严重度列「—」表示非冲突）：

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | — | ADR-0003 §1 被否方案 B：「接缝候选 B（`compile(text)` 单入口）：缓存层无法插在 parse 与 evaluate 之间」 | `getCompiled(input)`（信封或文本）→ `{ module, derived }`，同一次 `parseVfsl + evaluate` | no-conflict | 候选 B 被否的是**用单入口取代独立 evaluate 接缝**；本任务的 getCompiled 是 DocScope 层的缓存门面，组合（而非取代）被 ADR-0003 §1 冻结的公共接缝——「`parseVfsl` / `evaluate` / `validateSnapshot` / `validatePatch` …均以各自 Interface 作为公共观察点」原样保留，parse 与 evaluate 之间插缓存的设计自由不受损。且编译缓存本身是 ADR-0001 的显式条款（「性能依赖按内容哈希的编译缓存」），为 getCompiled 的存在提供直接授权 |
| 2 | — | ADR-0003 §1：「`evaluate(module) → { ok: true; derived } \| { ok: false; issues }`」「可失败是前向兼容设计：调用方从第一天写 ok 检查」 | AC：「evaluate 失败（合法文本但求值失败）不污染缓存（可重试语义）」 | no-conflict | 缓存只存 ok 分支产物，正是结果联合语义在缓存层的自然执行；失败不落缓存保持「调用方从第一天写 ok 检查」的前向兼容位形，未改写 evaluate 契约 |
| 3 | — | ADR-0005 §1：「**id 是标签不是键**：引擎正确性不依赖 id 唯一性（自包含设计消灭了注册表）」；CONTEXT.md 命名空间 _Avoid_「schema 注册表（`SCHEMA_REGISTRY` 是被替换的旧机制）」 | 「按**文本内容哈希**（sha-256）缓存编译产物的**注册表**」 | no-conflict | 缓存键是文本内容哈希而非 id，无按 id 注册/寻址语义，与条款一致；任务简报「注册表」为借词描述内存 Map，非 SCHEMA_REGISTRY 复活（一致性提示见结论第 2 条） |
| 4 | — | ADR-0005 §1：「**async 从第一天起**：DocSchemaSource 终态走网络；接缝按终态设计，不按脚手架现状设计」 | AC：「同步或 async 由 SA1 依 H1 接缝形态定」 | no-conflict | 任务将形态裁定显式交给 SA1 并锚定 H1 接缝形态，未预设与条款相悖的结论；ADR-0005 的 async 原则约束的是 SchemaSource 接缝（H1 邻域），SA1 裁定时以其为权衡输入即可（提示见结论第 3 条） |
| 5 | — | ADR-0005 §3：「**输入 = `evaluate` 的派生 schema**（不直接吃 IR）……生成器是纯发射器」 | getCompiled 返回 `{ module, derived }` 双产出（module 为 parseVfsl 的 IR） | no-conflict | 条款约束**生成器**的输入选择，不禁止引擎暴露 IR——parseVfsl 的 module 本就是公共产物（ADR-0003 §1 公共观察点）；codegen 等消费方自 derived 取用，getCompiled 同时返回两者不构成对 §3 的违反 |
| 6 | — | ADR-0001：「未知方言 loud-fail 只读」；ADR-0005 §1：「**消费方首动作 = 方言断言**（`lang==='vfsl' && version===1`，否则响亮失败）」 | 「未知方言经 H1 断言通道，不进入缓存」；AC「未知方言输入被 H1 通道拒绝，不产生缓存项」 | no-conflict | 方言断言前置（H1）+ 未断言文本不落缓存，与两处条款完全同向；「不产生缓存项」是 loud-fail 在缓存维度的正确投影 |

另核查无对应条款、天然无冲突的任务要素：sha-256 具体算法选择（无 ADR 冻结哈希算法）、v1 无淘汰 Map 策略（无 ADR 条款约束淘汰行为；ADR-0001 仅要求缓存存在）、`{ module, derived }` 的对象引用同一性（ADR-0003 要求派生物纯数据，未约束引用共享方式）。

## 结论

**Verdict: clear，放行。** 任务简报的全部交付描述与六项验收标准逐条对照 ADR-0001（含修订节与命名修订）至 0005 及 CONTEXT.md 全部硬性条款，未发现直接违反；无条目需 override，无条目属演进（evolution）需 Jim 裁决。任务简报对 DocScope 的表述与 CONTEXT.md「作用域绑定（DocScope）」术语近乎同文，多方言并存、内容哈希缓存均有直接 ADR 授权。

给下游 SA 的非阻塞提示（源自上表边缘项，非裁决）：

1. **接缝保形**（边缘项 #1）：getCompiled 无论如何设计，必须保持 `parseVfsl` / `evaluate` 作为独立公共接缝原样可用——getCompiled 是其上的缓存门面，不是替代品；设计不得收窄二者的公共观察点地位，也不得排除未来在 parse 与 evaluate 之间插入中间缓存的可能。
2. **命名纪律**（边缘项 #3）：CONTEXT.md 的 _Avoid_ 是「schema 注册表」（按 id 注册/寻址的旧机制）与「编译器（compiler）」（留给 Phase 1 contract 包的组合入口词）；SA1 命名 API/模块时避开 registry/compiler 语系，缓存键保持文本内容哈希、不引入 id 键控，即天然合规。
3. **同步/异步裁定输入**（边缘项 #4）：SA1 依 H1 接缝形态裁定时，应把 ADR-0005 §1「async 从第一天起（DocSchemaSource 终态走网络，接缝按终态设计）」作为权衡输入——若 getCompiled 的输入可能经 SchemaSource 加载而来，按终态形态设计接缝是该 ADR 的既定原则。
4. **缓存值纪律**（对应 ADR-0003）：被缓存的 `{ module, derived }` 是同一对象引用处处复用，二者须始终保持「纯数据、可 JSON 序列化、可内容哈希」——消费方不得变异共享引用，具体防变异手段（冻结/拷贝/文档化契约）属 SA1 设计与 SA2 评审领地，本门禁只登记约束来源。
