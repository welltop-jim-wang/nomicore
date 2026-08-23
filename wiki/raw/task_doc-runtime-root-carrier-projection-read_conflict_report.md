# 冲突门禁报告

- **被审对象**：任务简报 `wiki/raw/task_doc-runtime-root-carrier-projection-read.md`（issue #86，doc-runtime：schema-independent ROOT 载体投影读取）
- **门禁类型**：Phase 0 前置门禁（任务简报 vs ADR 全集 + CONTEXT.md）
- **冲突基准**：`docs/adr/` 全部 8 份 ADR（已逐份全文读取，无抽样）+ `CONTEXT.md`
- **审查日期**：2026-08-23（run_id: issue-86-1787480031-378585）

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19 修订节、2026-08-21 命名修订） | 否 | 约束 schema 来源/方言冻结/无机器标签；运行时读取不触及 schema 来源，无冲突条款 |
| ADR-0002 | nomicore 是全新重写，authority 出范围 | accepted | 否 | 统一写入管线属写入面；本任务为读取面，无冲突条款 |
| ADR-0003 | 求值器与派生 schema | accepted | 是 | ROOT 固定物化为 `doc.getMap('ROOT')`、YXmlFragment 终态（XML 字符串投影）与任务 AC5「Y.XmlFragment 是返回语义字符串的不可下钻终态」一致；无冲突 |
| ADR-0004 | vfsl-protocol 类型协议包 | accepted | 弱相关 | D5 空路径解析为根节点自身（`kindOf([])` → `'map'`）与 AC1「空 path 深拷贝完整 ROOT」概念一致；本任务不改该包；无冲突 |
| ADR-0005 | 投影生成管线 | accepted | 否 | 编译期类型投影生成，与运行时读取无关；无冲突条款 |
| ADR-0006 | Cordis 持久化插件与 doc 三条目布局 | accepted（含 issue #64、#79 修订节） | 是 | doc 三条目布局（SCHEMA/META/ROOT）与读取投影「固定 ROOT」一致——ROOT 是数据根，SCHEMA/META 兄弟条目不进下钻面；无冲突 |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge 分层 | accepted（Runtime/open/read 与 schema-aware 读取签名条款**已被 ADR-0008 取代**） | 是 | 仍生效条款（路径 `readonly (string \| number)[]`、禁止点号字符串/JSON Pointer、leaf/plain/XML 终态、XML 语义等价 round-trip、领域化结果联合、普通读取成本与目标子树规模相关）均与任务 AC 一致；任务去掉 `derived` 参数触碰的恰是**已被取代**的 schema-aware 签名条款——按门禁规则「与被 superseded 的 ADR 冲突不算冲突」；无冲突 |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器 | accepted（取代 ADR-0007 相应部分） | 是（直接依据） | 任务全部 AC 几乎逐条来自其「读取能力」节；「必要的底层演进」第 1 条明文指令本次签名改造；无冲突 |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|

（无冲突点。）

## 逐条 AC 对照明细（支撑上表结论）

| 任务 AC | 对应约束条款 | 对照结论 |
|---|---|---|
| AC1 `readLogicalValueAtPath` 不再接收 derived schema，空 path 深拷贝完整 ROOT，非空 path 只转换目标子树 | ADR-0008「`readLogicalValueAtPath(doc, path)` 去掉 `derived` 参数……空 path 深拷贝完整 ROOT；非空 path 只转换目标子树」+「必要的底层演进 1」；ADR-0004 D5 空路径=根自身 | no-conflict：任务是被接受 ADR 的明文实施项，非推翻 |
| AC2 Y.Map/plain object 用 string segment，Y.Array/plain array 用严格非负整数 segment；容器缺失成功返回 `undefined` | ADR-0008「`Y.Map` 使用 string segment，`Y.Array` 使用严格非负整数 segment；plain object/array 同理；map/object 缺键或数组越界均成功返回 `undefined`，中间缺失立即结束」；ADR-0007「路径统一为 `readonly (string \| number)[]`……禁止点号字符串与 JSON Pointer」 | no-conflict：逐字对应 |
| AC3 plain object 仅读 own enumerable data property，不走原型链、不执行 accessor | ADR-0008「plain object 仅读 own enumerable **string** data property，不走原型链、不执行 accessor」 | no-conflict：AC 措辞略宽（少「string」一词），ADR 更严且方向一致；实现按 ADR 较严措辞执行（详见相关决议文档「措辞对齐备注」） |
| AC4 plain subtree 只接受 JSON-compatible plain value，嵌套 Yjs shared type 响亮失败 | ADR-0008「plain subtree 仅允许 JSON-compatible plain value，禁止嵌套 Yjs shared type」+「预期路径、载体和 lifecycle 失败使用同步结果联合」 | no-conflict：「响亮失败」落在结果联合通道，与 ADR 失败纪律一致 |
| AC5 Y.XmlFragment 是返回语义字符串的不可下钻终态；未知 Yjs shared type 不使用通用 fallback | ADR-0008「`Y.XmlFragment` 是不可下钻终态，返回语义字符串；未知 Yjs shared type响亮失败，不使用 `toJSON()` fallback」；ADR-0003 §5 终态节点/XML 字符串；ADR-0007「XML string 与 Y.XmlFragment 只承诺语义等价 round-trip」 | no-conflict：三份 ADR 相互印证 |
| AC6 预期 path/载体失败返回同步结果联合；返回值不含 live 引用且不做运行时 freeze | ADR-0008「预期路径、载体和 lifecycle 失败使用同步结果联合，只有 internal bug 才抛异常」+「返回值是可变普通深拷贝，不做运行时冻结」 | no-conflict：逐字对应 |
| AC7 调整调用面与行为测试，全量 typecheck/test + Node 20/24 CI | 无 ADR 条款涉及 CI 矩阵；ADR-0008 底层演进 1 授权调用面调整 | no-conflict |
| What to build：schema preparation 完成前即可高频读取 | ADR-0008「读取不等待 P0 或任何写任务，也不进入 sequencer」；CONTEXT.md「P0……Runtime 发布后读取立即可用」「写序列器……读取不进入该序列」 | no-conflict：「schema 准备完成前可读」正是 ADR-0008 建立的能力 |

## 结论

**Verdict: `clear`——放行。**

- 冲突点数：**0**；裁决分布：no-conflict ×8（ADR 维度）/ override-declared ×0 / evolution ×0 / hard-violation ×0。
- 本任务不是对任何 ADR 的推翻或演进，而是 **ADR-0008「必要的底层演进」第 1 条与其「读取能力」节的直接实施**：任务 AC 与 ADR-0008 条款几乎逐字对应，并得到 ADR-0003（ROOT/YXmlFragment 终态）、ADR-0006（doc 三条目布局）、ADR-0007 仍生效条款（路径纪律、终态、结果联合）及 CONTEXT.md「载体投影读取」词条的一致支撑。
- 唯一形式上的「表面冲突」是：任务要求删除的 `derived` 参数来自 ADR-0007 的旧签名——但该条款已被 ADR-0008 明文取代（ADR-0007 正文与「取代关系」节双重确认），被 superseded 的条款不构成约束，故不记冲突。
- 无需 override、无需 Jim 裁决条目。总控可按路由继续（SA6 验收锚定 → SA1 → SA8 设计复审 → SA2 → SA3 → SA4 → SA7 → AC 门禁）。

相关决议清单见：`wiki/raw/task_doc-runtime-root-carrier-projection-read_relevant_decisions.md`。
