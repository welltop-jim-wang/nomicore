# 冲突门禁报告（设计后复审）

- **被审对象**：SA1 设计文档 `wiki/raw/task_doc-runtime-root-carrier-projection-read_design.md`（553 行，全文已读：§0 定位 / §1 冻结契约 / §2 架构 / §3 D1–D12 / §4 伪代码与 INV-R1~R12 / §5 AC 映射与 E1–E18 / §6 调用面与测试处置 / §7 文件清单 / §8 协议假设 / §9 连锁审计 / §10 SA2 预答）
- **门禁类型**：Phase 2 设计后复审（设计 vs ADR 决策全集一致性；轻量复审，全维度攻击评审属 SA2）
- **冲突基准**：`docs/adr/` 全部 8 份 ADR + `CONTEXT.md`。**基准核对**：自前置门禁（Phase 0）以来 ADR 目录文件数（8）、mtime、md5 均无变化，CONTEXT.md 无变化——基准沿用，无需重新全量盘点（前置门禁报告：`wiki/raw/task_doc-runtime-root-carrier-projection-read_conflict_report.md`）
- **审查日期**：2026-08-23（run_id: issue-86-1787480031-378585）

## Verdict

`clear`

## ADR 盘点（设计对照）

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 唯一真相源 | accepted（含修订节） | 否 | 设计不触及 schema 来源/方言/机器标签；read.ts 移除 vfsl import 是解耦而非变更真相源；无冲突 |
| ADR-0002 | 重写定位、authority 出范围 | accepted | 否 | 读取面设计，不涉 authority 与统一写入管线；无冲突 |
| ADR-0003 | 求值器与派生 schema | accepted | 是 | D9 ROOT 探针（固定 `getMap('ROOT')`、异型拒绝）、D2/D6 YXmlFragment 终态返回语义字符串，均与「ROOT 固定物化为 Y.Map」「xml-fragment 是结构树终态节点…JSON 快照中其值为 XML 字符串」一致；无冲突 |
| ADR-0004 | vfsl-protocol 类型协议包 | accepted | 弱相关 | 空路径=根自身（D5 条款）与设计空 path 深拷贝完整 ROOT 概念一致；设计零改动该包；无冲突 |
| ADR-0005 | 投影生成管线 | accepted | 否 | 编译期生成管线，设计零触及；无冲突 |
| ADR-0006 | Cordis 持久化与 doc 三条目布局 | accepted（含 #64/#79 修订） | 是 | INV-R8「只触碰 'ROOT'，SCHEMA/META 零接触」probeRoot 唯一 doc 入口——与三条目布局（ROOT 数据根，SCHEMA/META 兄弟条目不进读取下钻面）一致；无冲突 |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge | accepted（read 相关条款被 ADR-0008 取代，底层条款继续有效） | 是 | 仍生效条款逐条核过：路径 `readonly (string \| number)[]` ✓（D3/G0）、禁止点号字符串/JSON Pointer ✓（D3——禁的是路径编码形态，含点号的**键名**合法）、终态纪律 ✓（D2，术语澄清见冲突点下「张力裁决」）、XML 语义等价 round-trip ✓（D6 toString + §10.5）、领域化结果联合 ✓（D8，read 自有联合未与别能力合并）、零写入/observer no-rollback ✓（INV-R9 零事件零写入）、读取成本与目标子树规模相关 ✓（D12）；设计退役的是**已被取代**的 schema-aware 三参语义及其部件（Phase A/B、union 仲裁）——被取代物不构成约束；无冲突 |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器 | accepted（取代 ADR-0007 相应部分） | 是（直接依据） | 设计全部机制（D1 签名、D3 段纪律、D4 缺席、D5 键空间、D6 投影/深拷贝/不冻结、D8 结果联合、D9 ROOT、D11 同步观察不进 sequencer、D12 成本）逐条映射其「读取能力」节；无冲突 |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|

（无冲突点。）

## 设计决策对照明细（支撑上表结论）

| 设计决策 | 对应 ADR/CONTEXT 条款 | 对照结论 |
|---|---|---|
| D1 重写 read.ts 为载体驱动双参（去 derived） | ADR-0008「必要的底层演进 1」+「`readLogicalValueAtPath(doc, path)` 去掉 `derived` 参数」 | no-conflict：被接受 ADR 的明文实施项 |
| D2 NavCarrier 词汇表（ymap/yarray/xml/text/unknownShared/plainObject/plainArray/scalar/nonPlainObject/violation） | ADR-0008「按实际载体投影」+ 段纪律表 | no-conflict：载体分类是对 ADR 载体枚举的实现细分；xml/text 分型兑现「XmlFragment 终态 vs 未知类型响亮失败」两种不同结局 |
| D3 段纪律（string↔map/object；严格非负整数↔array；-0 归一；段从不拆分解释） | ADR-0008 段纪律 + ADR-0007「路径统一为 readonly (string \| number)[]…禁止点号字符串与 JSON Pointer」 | no-conflict：「禁止点号字符串」禁路径编码形态，非禁含点号键名（键名即段，从不解释） |
| D4 缺席吸收三源 + 数组位置 undefined 响亮（非对称） | ADR-0008「map/object 缺键或数组越界均成功返回 `undefined`，中间缺失立即结束」+「plain subtree 仅允许 JSON-compatible plain value」 | no-conflict：ADR 明文的缺席面照办；显式 undefined 键（E1/E2）是 ADR 沉默边缘的补充裁决（吸收，与 yjs toJSON/JSON 投影域一致）；数组位置 undefined 响亮是「仅允许 JSON-compatible plain value」的直接推论（JSON 域无该值，静默省略=移位腐败） |
| D5 键空间助手（descriptor 读，enumerable/data/非 undefined 三关；导航≡投影键空间 INV-R11） | ADR-0008「plain object 仅读 own enumerable **string** data property，不走原型链、不执行 accessor」 | no-conflict：逐字从严实现（含前置门禁「措辞对齐备注」要求的 string 一词——symbol 键经 descriptor/Object.keys 天然排除）；E4/E5/E6 键空间外≡缺席是该条款的自洽推论（不产出 ⇒ 导航不可达） |
| D6 定点投影双递归 + copyPlainStrict（JSON 值域 loud；嵌套 Yjs FAIL；defineProperty 四真不冻结） | ADR-0008「plain subtree 仅允许 JSON-compatible plain value，禁止嵌套 Yjs shared type」+「返回值是可变普通深拷贝，不做运行时冻结」 | no-conflict：值域纪律逐条兑现；不冻结经四真描述符保证（INV-R7） |
| D7 拷贝器分叉（不共享 extract.ts copyPlainValue；extract accessor 执行申报为潜在缺陷并 DENY） | ADR-0007「extractYjsSnapshot…只读取固定 ROOT」（extract 侧） | no-conflict（对本设计）：设计零改动 extract.ts，分叉避免本任务越权改变已交付契约；extract 现状的 getter 执行是**先在**张力（非本设计引入），设计已显式申报并建议独立任务——超出本门禁裁决范围，转记 SA2/后续任务（见「边界外观察」） |
| D8 单 code 多因由 + path 新鲜副本 + message 非契约字段 | ADR-0008「预期路径、载体和 lifecycle 失败使用同步结果联合」；ADR-0007「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型」 | no-conflict：该联合条款约束**跨能力**不合并成巨型 issue（read/extract/mutate 各自保留联合）——read 自有 ReadLogicalValueResult 未与他能力合并；单 code 多因由是能力内部的失败通道收敛，结果联合形态不变 |
| D9 ROOT 探针复用（惰性 getMap 零事件；异型 C4；只碰 'ROOT'） | ADR-0003「ROOT 固定物化为 Y.Map…Yjs 映射为 doc.getMap('ROOT')」+ ADR-0006 三条目布局 | no-conflict：缺席 ROOT 视为空容器返回 `{}` 与「ROOT 固定 Y.Map」物化语义一致；零 update 事件=零可观测写入（ADR-0007 零写入纪律） |
| D10 循环引用 → E100 结构化返回（不抛出、不加 seen-set） | ADR-0008「预期路径、载体和 lifecycle 失败使用同步结果联合」；CONTEXT.md「持久化文件被其他程序错误修改不在运行时读取契约范围内」 | no-conflict：循环引用经受控写入不可达（快照器拒绝循环引用——ADR-0008 写序列器 snapshotter 条款），属契约范围外防御路径；通道同形（ok:false + path），仅 message 文案差异（非契约字段） |
| D11 同步并发模型（零锁零快照零订阅） | ADR-0008「读取只观察调用瞬间已经提交的 live Y.Doc…」+「读取不等待 P0 或任何写任务，也不进入 sequencer」；CONTEXT.md「写序列器…读取不进入该序列」 | no-conflict：同步栈原子观察即「调用瞬间已提交」语义的直接兑现 |
| D12 性能预算 O(path+目标子树)，无 memo 无模块态 | ADR-0007「普通读取成本与目标 path 子树规模相关」+ ADR-0008「非空 path 只转换目标子树」 | no-conflict |
| §6.2 删除 7 个锚定被取代语义的遗留测试 + 通用锚移植 guards | 无 ADR 条款治理测试留存；任务 AC7「调整调用面与行为测试」授权 | no-conflict：被删用例锚定 ADR-0008 明文取代的三参语义，与新契约测试互斥（保留则全量门禁不可能同时绿） |
| §7 文件清单（ALLOW 限 doc-runtime 读面；DENY 含 docs/adr/** 与 CONTEXT.md） | — | no-conflict：设计不触碰 ADR/CONTEXT，未声明任何 override——也无需声明（全程在 ADR-0008 已立法框架内） |
| INV-R1~R12 不变量系 | 各条款映射见上表 | no-conflict：全部不变量是 ADR 条款的实现级收口，无一条加码或放松 ADR 语义 |

## 张力裁决（表面张力 × 3，均已消解，不构成冲突点）

1. **plain 可下钻性**：ADR-0007「leaf、plain、XML 是不可下钻终态」乍看与设计 D2「plainObject/plainArray 可下钻」相抵触。裁决：**不冲突**——ADR-0007 同句前半「map/**object**/Record 使用 string」已确立 plain object 为 string 段容器；句中「plain」指结构树 plain kind（`YPlainArray` 整值语义——ADR-0004 D1「只能整体替换（普通 JSON 值，非 Y.Array）」），非 plain object 载体。ADR-0008「plain object/array 同理」以现行法明文确认 plain 容器可下钻。设计的建模（plainObject/plainArray 容器化，scalar/xml/text/unknownShared 终态）与两份 ADR 在正确术语映射下完全一致。
2. **「只有 internal bug 才抛异常」vs INV-R1 零外抛（E100 收编一切异常）**：ADR-0008 该句若读作「internal bug **必须**抛」则与设计抵触。裁决：**不冲突**——采用许可式读法：该句的规范内容是「预期失败必须走结果联合、不得抛」（设计完全遵守），「只有 internal bug 才抛」划定的是**允许**抛出的例外情形，而非要求内部错误必须外抛。设计把 internal bug 也收编为结构化 E100 结果是**收紧**而非违反；且 E100 崩溃边界是现网 read.ts 既有行为（设计 §0.2 红灯机理可证），本设计延续而非新设。
3. **E7 导航借道内嵌 Yjs**：ADR-0008「plain subtree…禁止嵌套 Yjs shared type」若读作「含嵌套 Yjs 的 plain 容器整棵不可导航」则与设计抵触。裁决：**不冲突**——该条款位于投影语义清单（「仅允许…禁止…」约束投影产出值域），设计的 copyPlainStrict 在投影 plain 域时逐字执行（嵌套 Yjs → FAIL）；导航是另一动作，按「从固定 ROOT 按实际载体投影」逐段看实际载体，且「非空 path 只转换目标子树」反证违规仅在目标子树转换触及时才可观测。设计把该纪律限定于投影期是对 ADR 条款作用域的忠实读法，非放松。

## 边界外观察（非冲突，转交下游）

- **extract.ts `copyPlainValue` 执行 getter**（设计 D7 申报、探针 I 实测复现）：与 ADR-0007「extractYjsSnapshot…**只读取**固定 ROOT」的只读精神存在张力。这是**先在**行为，非本设计引入；本设计 DENY extract.ts 未使其恶化。冲突门禁只裁决被审对象（设计）与 ADR 的一致性——设计本身无冲突；该先在张力的定性属 SA2 评审/后续独立任务领地，建议总控记录为跟进项。
- 设计对 yjs 运行时行为的 13 项假设（§8 A1–A13）均附实测证据——假设验证的充分性属 SA2/SA4 攻击面，不属冲突门禁。

## 结论

**Verdict: `clear`——放行。**

- 冲突点数：**0**；裁决分布：no-conflict ×8（ADR 维度）/ override-declared ×0 / evolution ×0 / hard-violation ×0。
- 设计是 ADR-0008「读取能力」节 +「必要的底层演进」第 1 条的忠实实施：签名、段纪律、缺席语义、键空间、值域、终态、深拷贝不冻结、结果联合、同步模型、成本预算逐条有 ADR 条款直接对应；D1–D12 中无任何决策推翻或意图修订现存 ADR，无需 override，无需 Jim 裁决。
- 三处表面张力（plain 可下钻性、零外抛 E100、E7 导航借道）均已通过术语澄清/许可式读法/条款作用域读法消解，裁决依据已固化至相关决议文档「SA1 设计引入的新决策点」节，供 SA2/SA3/SA4/SA7 复用。
- 设计退役的旧三参语义、Phase A/B、union 仲裁体系及其测试均锚定**已被 ADR-0008 取代**的条款——被取代物不构成约束。
- 边界外转交：extract.ts getter 执行的先在张力（建议后续独立任务）；协议假设充分性（SA2/SA4 领地）。

相关决议清单（已追加设计引入的新决策点）：`wiki/raw/task_doc-runtime-root-carrier-projection-read_relevant_decisions.md`。
前置门禁报告：`wiki/raw/task_doc-runtime-root-carrier-projection-read_conflict_report.md`。
