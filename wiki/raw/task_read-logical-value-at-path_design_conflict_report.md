# 冲突门禁报告（设计后复审 Phase 2）

- **被审对象**：`wiki/raw/task_read-logical-value-at-path_design.md`（SA1 设计：摘要 + 决策总表 D1–D12 + §1–§11 + INV-1..9，全文 592 行逐行读取）
- **冲突基准**：ADR 全集（0001–0007）+ CONTEXT.md。前置门禁已全量盘点（见 `…_conflict_report.md`），本次不重复；对照工作底稿 = `…_relevant_decisions.md`（本次已追加「设计引入的新决策点」一节）
- **复审性质**：设计 vs 决策集一致性（轻量复审）。设计优劣与完备性攻击属 SA2；实现质量属 SA4/SA7
- **门禁人**：SA8（Conflict Gatekeeper）；日期：2026-08-22

## Verdict

`clear`

## 设计决策 × 决策集对照

前置门禁三条注记的落实核验：**注记 A**（越界=缺失 / 负数·非整数·字符串=非法）→ D9 + §4.4 规则表 + D8，已显式落定；**注记 B**（`PATH_NOT_ALLOWED` 保持领域化结果联合，不并入 issues 体系）→ D5/D6 + FC-2，未并入逻辑校验 issues；**注记 C**（运行时以 ADR-0007 number 下标为据，不以 ADR-0004 字符串下标为据）→ D9 + §1.1 表明确登记。三条全部落实。

| 设计决策 | 摘要 | 对照条款（基准） | 结论 |
|---|---|---|---|
| D1 两阶段模型 | Phase A 纯 schema 许可（零 doc 访问、presence-independent）/ Phase B 活解析+定点转换 | ADR-0007「同步按路径读取，只转换目标子树……普通读取不重复验证」——Phase A 是 schema 谓词非数据校验，Phase B 只触碰路径沿线+目标子树 | no-conflict |
| D2 导航权威 = 结构树 + ref 解析器；`derived.index` 不参与 | 消费策略选择，附探针实证（union 成员 / ref 别名子树两处索引缺口） | CONTEXT.md「路径索引」为能力描述词条而非强制消费义务（Avoid 仅指 resolveChild 旧机制）；ADR-0003「结构树……供路径下钻守卫」「按名引用不内联展开」被正确消费；派生 schema 形状零改动（DENY：evaluate.ts/derived.ts 不动，不触 ADR-0003「形状变更须走设计修订流程」）——解释边界见注记 N1 | no-conflict |
| D3 keyPattern = values 树锁步双游标 + vfsl pattern 引擎**公共导出** | 向 `@nomicore/vfsl` 增补 `compilePattern`/`matchPattern`/`CompiledPattern` 三条公共导出 | ADR-0007 明文「新包 `@nomicore/doc-runtime` 依赖 `@nomicore/vfsl + yjs`」「`@nomicore/vfsl` 继续保持无 Yjs 依赖」（导出不引入 Yjs 依赖）；无 ADR 冻结 vfsl 封闭导出集（ADR-0003 §1 与 ADR-0007 `compileSchemaEnvelope` 均为逐项新增公共导出的先例）——见注记 N2 | no-conflict |
| D4 union any-of 活导航、判别式零读取 | Phase A `members.some`；Phase B 声明序首个可产出者胜；discriminator 不消费 | ADR-0003「匹配语义 any-of（至少一个成员接受即接受——重叠成员不构成错误）」「路径存在性为任一成员出现即存在」逐字实现；「缓存的缺失/存在不得改变任何可观测行为」——零读取判别式正是对该条款的最保守遵守 | no-conflict |
| D5 结果联合二形 + `message?` 增补 | 冻结字段零改动，纯增补诊断字段 | ADR-0007「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型」——单一失败码 + 可选诊断串仍是本能力自己的领域联合；SA6 冻结契约非 SA8 阻塞基准（代码与 wiki 非决策集，见注记 N3） | no-conflict |
| D6 C1/C2/C3 单通道映射 `PATH_NOT_ALLOWED` | 不变量外活数据态（载体错位/required 缺席）与内部缺陷统一映射单失败码 + message | ADR-0007「依赖 create/open/update 已建立并维持的结构不变量」——C2 类状态在契约语境被该条款声明为不可达，无任何 ADR 条款规定其错误形态；单通道与「Yjs 结构与路径/操作错误 fail-fast」相容（见注记 N3） | no-conflict |
| D7 终点转换复用 `walk`（包内导出） | extract.ts ≤8 行纯 export 增补，逻辑零变化，不走 index.ts 公共入口 | 无 ADR 约束包内导出；单一转换语义源与 ADR-0007 四能力同层一致性正交加强 | no-conflict |
| D8 合法缺键**吸收式**语义 | 路径中点缺 optional/Record 键、非负整数越界 → `value:undefined`，不验余下段 | ADR-0007「合法 optional/Record/数组缺失返回 `undefined`」未区分路径位置；= 前置注记 A 的设计落地（见注记 N4） | no-conflict |
| D9 段形态：map/Record=string，array=非负整数 | number 下标运行时侧；-0 归一说明 | ADR-0007「map/object/Record 使用 string，Y.Array 使用 number」逐字对应；前置注记 C 落地（不以 ADR-0004 类型层字符串下标为运行时依据） | no-conflict |
| D10 plain 终态、仅整体读取 | 元素级读取一律 `PATH_NOT_ALLOWED` | ADR-0007「leaf、plain、XML 是不可下钻终态」；ADR-0004 D1「`YPlainArray` 只能整体替换（普通 JSON 值，非 Y.Array——标记语义边界）」的读取对偶 | no-conflict |
| D11 崩溃边界：顶层 try/catch 不外抛 | 一切异常 → `PATH_NOT_ALLOWED` + DOCRT-E100 message | ADR-0007 无「读取不得抛错」明文；结果联合（可失败）风格与 ADR-0003 §1「可失败（结果联合）」哲学一致；「Yjs observer 不得向事务调用栈抛异常」条款未被触碰（本函数不开事务） | no-conflict |
| D12 空 path = 完整 ROOT；空 doc 惰性 map → `{}` | probeRoot 惰性创建（自证零 update 事件） | ADR-0007「空路径表示显式读取整个 ROOT」逐字落实；惰性创建无 ADR 条款涉及（见注记 N5） | no-conflict |
| XML `toString()` 语义等价投影 | FC-4 / §4.6 | ADR-0007「XML string 与 Y.XmlFragment 只承诺语义等价 round-trip，不承诺字符串逐字相同」逐字吻合 | no-conflict |
| 只碰 ROOT 子树（INV-7/INV-8） | probeRoot 仅触碰 `'ROOT'`；SCHEMA/META 零接触 | ADR-0006「META/SCHEMA 作为 ROOT 的兄弟条目……校验只作用 ROOT 子树」；ADR-0007 extract「不读取或验证 SCHEMA/META」同族纪律 | no-conflict |
| 成本模型 O(路径长 + 目标子树) | §4.9 三行成本表；兄弟子树零触碰 | ADR-0007「普通读取成本与目标 path 子树规模相关」（路径长是请求自身规模，前置门禁已确认口径） | no-conflict |
| 文件面（ALLOW/DENY） | 不触 vfsl-protocol、persistence、codegen、配置 | ADR-0004（协议包零运行时）、ADR-0005（codegen 管线）、ADR-0006（持久层）辖域零触碰 | no-conflict |

**ADR 引用准确性抽查**：设计 §1.1 对 ADR-0007（readLogicalValueAtPath 条款、「加载和更新负责验证」、成本条款）、ADR-0003（any-of / 存在性 / 判别式缓存非契约）、ADR-0004 D1（YPlainArray 整体替换）、CONTEXT.md（路径索引词条）的引文与原文逐字核对一致，无失真引用。

## 冲突点

无（0 条）。

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | （空表：0 冲突点） |

裁决分布：no-conflict ×16（上表）／override-declared ×0／evolution ×0／hard-violation ×0。

设计未含任何「取代 ADR-NNNN」表述（无 override-declared）；D2/D3 对 `derived.index` 的弃用是**消费策略**选择——不修改「路径索引」词条、不改动派生 schema 冻结形状（DENY LIST 明确 evaluate.ts/derived.ts 不动），不构成对既有决策的意图性修订（非 evolution）。

## 结论

**Verdict = `clear`，放行（进入 SA2 全维度攻击评审）。**

设计实质是 ADR-0007 `readLogicalValueAtPath` 条款的忠实展开：任务简报全部验收标准、前置门禁三条注记（A/B/C）均被显式承接并落点；对 ADR-0003（ROOT/终态/any-of/判别式缓存/形状冻结）、ADR-0006（ROOT 子树边界）、ADR-0004（跨层接缝区分）的引用准确、消费正确。

五条**非冲突注记**（不阻塞，移交 SA2 重点攻击；SA8 只标解释边界，不判优劣）：

- **N1（index 弃用的解释边界）**：CONTEXT.md「路径索引」词条描述的是派生 schema 的组成能力，未课以「一切路径消费必须走 index」的义务；设计以探针实证的缺口为由改走结构树+values 树，属消费选择。但「键匹配（exact / pattern）为标准能力」在设计中经 vfsl 引擎兑现（Phase A 的 Record 键 pattern 判定），能力未丢失。SA2 可攻击：探针实证的场景覆盖面（六类 Record 位）是否足以支撑「索引不完备」的全称结论。
- **N2（vfsl 公共 API 增补）**：三条导出是新增公共接缝，ADR 无封闭导出集条款、有逐项新增先例（ADR-0003 §1 evaluate、ADR-0007 compileSchemaEnvelope），且不破坏「vfsl 无 Yjs 依赖」。属**设计引入的新决策点**（已登记至 relevant_decisions.md），一旦实现即成为后续任务的事实约束——SA2 应评审其命名与形态是否配得上公共契约地位。
- **N3（message? 与 C2/C3 映射）**：SA6 冻结契约与「2026-05-07 立法」均**不构成 SA8 的阻塞基准**（冲突基准只有 ADR + CONTEXT.md）；就决策集而言，ADR-0007 未规定不变量外状态的错误形态，设计的单通道映射是允许范围内的细化。SA2 领地：message? 是否会事实上被消费者依赖（增补字段的契约漂移风险）、C2 语义混入 PATH_NOT_ALLOWED 的可诊断性代价。
- **N4（吸收式缺键）**：D8 是前置注记 A「数组缺失返回 undefined」向路径中点的语义延展，ADR-0007 条款未区分位置、未禁止延展；设计已给出同构论证。SA2 可攻击：中点缺键 + 余下段 schema 合法但语义上「本应拒绝对不存在值的下钻」的场景是否有反例。
- **N5（probeRoot 惰性创建）**：读取路径上惰性创建 Y.Map 实例无 ADR 条款涉及；「零 update 事件」为设计期实测自证（carrier.ts P4），INV-5 的行为级验证归 SA4 实现 / SA7 审计。ADR-0006 持久层语义（saveDoc 脏通知）不受影响（本函数不触发 saveDoc）。

**产出清单**：
1. 本报告：`wiki/raw/task_read-logical-value-at-path_design_conflict_report.md`
2. 底稿更新：`wiki/raw/task_read-logical-value-at-path_relevant_decisions.md` 追加「设计引入的新决策点」（七类：跨包公共接缝 / 包内复用接缝 / 派生 schema 消费立场 / 结果联合形态 / 失败单通道分类 / 吸收式缺键 / 两阶段模型）——供 SA2/SA3/SA4 全链复用
