# 冲突门禁报告 — 设计后复审（Phase 2 第二道）

- 被审对象：`wiki/raw/task_doc-runtime-extract-yjs-snapshot_design.md`（SA1 R1 设计，624 行全读）
- 冲突基准：`docs/adr/0001`–`0007` 全集（7 篇，逐篇全读，无 superseded 状态文件）+ `CONTEXT.md`
  + 前置门禁产出 `task_doc-runtime-extract-yjs-snapshot_relevant_decisions.md`（约束清单）
- 门禁日期：SA8 设计后复审，2026-08-22
- 审查方式：设计决策总表 D1–D11 + 不变式 INV-1–8 + §4 各节机制 + §5 用例映射 + §6 边界清单逐条
  对照 ADR 条款原文与 CONTEXT.md 术语；设计 §1.1 授权链表的 ADR 引文已逐条与 ADR 原文核对，无失真引用。

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本唯一真相源（含 2026-08-19 修订、2026-08-21 命名修订） | accepted | 低 | 无冲突。实现零仓内 schema 文本（fixture 全在 SA6 冻结测试内，属明文例外）；E100「内部错误」loud 上报与 loud-fail 精神同向。 |
| ADR-0002 | nomicore 重写定位、authority 完全出范围 | accepted | 中 | 无冲突。D10/B5 提取器零值语义裁决：`keyPattern`、字面量判别字段全部不读——正是「不保留 authority 接口」的忠实执行。 |
| ADR-0003 | 求值器与派生 schema（ROOT 约定 / 联合 any-of / 判别式缓存 / ref 按名引用 / XML 终态） | accepted | 高 | 无冲突。① ROOT 期望载体恒 `'Y.Map'`＝「ROOT 固定物化为 Y.Map，Yjs 映射为 `doc.getMap('ROOT')`」；② D5 首个接受者胜＝any-of「至少一个成员接受即接受」+ 声明序仲裁（INV-8）；③ 判别式死数据（INV-4，提取器不读 `node.discriminator`）是「缓存的缺失/存在不得改变任何可观测行为」的构造性兑现，优于约定式遵守；④ D7 XML 快照 `toString()` 实测与 `toJSON()` 投影一致（P6），满足「JSON 快照中其值为 XML 字符串（与 Y.XmlFragment.toJSON() 投影一致）」；⑤ D8 自建解析器见 note-3。 |
| ADR-0004 | vfsl-protocol 类型协议包（D1–D5） | accepted | 低 | 无冲突。设计 DENY `packages/vfsl-protocol/**`，与 D3「协议包零运行时」零交叉。 |
| ADR-0005 | 投影生成管线 | accepted | 低 | 无冲突。新包落位 `packages/doc-runtime` 沿用「`packages/` = 可复用库」惯例；不触生成管线。 |
| ADR-0006 | Cordis 持久化插件（含 createDoc 修订节） | accepted | 中 | 无冲突。INV-7「SCHEMA/META 名字空间零接触」+ D2 探针只碰 `'ROOT'`＝三条目布局「META/SCHEMA 作为 ROOT 的兄弟条目……校验只作用 ROOT 子树」；DENY `packages/persistence/**` 保持「持久层看不见 schema 语义」「不得 import DSH 或 NomicoreServer app」。 |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge 分层 | accepted | 极高（直接依据） | 无冲突。逐条款：包名与依赖（§3.2 = 「新包依赖 vfsl + yjs」「vfsl 继续保持无 Yjs 依赖；持久层继续不理解 VFSL」）；「只读取固定 ROOT，严格验证实际 Yjs 载体并提取普通逻辑 ROOT」= §4.3 全景表载体判定 + D1；「首个结构错误立即停止」= INV-3 fail-fast 单 issue；「不读取或验证 SCHEMA/META」= INV-7/F10；「路径统一为 `readonly (string \| number)[]`……禁止点号字符串与 JSON Pointer」= F3 issue.path 数组（message 文本渲染见 note-4）；「leaf、plain、XML 是不可下钻终态」= 全景表三行均为终态提取；「XML 只承诺语义等价 round-trip」= D7 + F7 归一化等价；「领域化结果联合……Yjs 结构错误 fail-fast」= §3.1 ExtractResult；「YArray 与 plain array 逻辑值相同、载体严格区分」= array/plain 双向错位锚（A2/P1）；设计自我定位「open 链第 3 环」＝「普通 open 必须依次完成 schema 编译、META 身份检查、ROOT 载体提取和逻辑校验」。惰性空 map 见 note-2。 |

无 superseded 状态的 ADR 文件；ADR-0006 早期 createDoc 条款已被其文末修订节正式取代，现行文本有效，且本任务不触持久化语义。

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| （无） | — | — | — | — | 未发现任何直接违反；无 override-declared（设计未声明推翻任何 ADR）、无 evolution（无未走 supersede 的修订意图——D8 自建解析器是遵守「不动 vfsl 公共面」的域内落地，非修订 ADR）、无 hard-violation |

## 专项裁决：D9 崩溃边界 `expected/actual='internal'` 偏离五值词汇表（总控点名裁决项）

**裁决：no-conflict（相对 ADR-0001–0007 + CONTEXT.md 基准）。**

1. **词汇表不是 ADR/CONTEXT 条款。** 五值词汇表（`'Y.Map'/'Y.Array'/'Y.XmlFragment'/'Y.Text'/'plain value'`）的唯一出处是 SA6 冻结契约 F4（`packages/doc-runtime/test/extract-yjs-snapshot.test.ts:30-36` 注释 + 各用例 `expectIssueAt` 断言）——任务层约束。前置门禁报告对照明细第 4 条已裁定「expected/actual 字段为 ADR 未规定的补充细节，不构成违反」。本次复审重查 ADR 全集与 CONTEXT.md：无任何条款规定 ExtractIssue 字段形状或载体词汇表。
2. **ADR-0007 对 issue 的全部要求均仍满足。** 「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型」——E100 仍是 `ExtractIssue` 领域化四字段形状，未合并、未引入新 issue 类型；「Yjs 结构与路径/操作错误 fail-fast」——E100 同为 fail-fast 单 issue；接缝「同步、不抛错」不变。
3. **'internal' 是诚实语义域标记，与 ADR 精神同向。** E100 属「内部错误」语义域而非「载体错位」语义域，伪造载体词冒充反而失真（设计 D9 被否方案自证）；loud 上报与 ADR-0001 loud-fail、vfsl 三接缝（parseVfsl/evaluate/validateLogicalSnapshot）E100 同款纪律同构。
4. **偏离辖域与处置路径正确。** 该偏离针对 SA6 冻结契约（任务层），设计已按简报要求自申报（决策总表 D9 + §10 + 自检附注）并转 SA4 复核；已核对 SA6 21 用例无任何 `expected/actual='internal'` 的行为断言（grep 全量核实），偏离不产生测试红。SA8 基准只含 ADR + CONTEXT.md，任务层契约一致性归 SA2/SA4，非门禁停止事由。

## 辅助对照明细（no-conflict 关键锚点）与 notes

1. **D4 缺失/未知键不报** ＝ ADR-0007 两步分离（extract 载体相位 / `validateLogicalSnapshot` 值相位）的直接推论；CONTEXT.md「封闭对象：未声明字段拒绝」辖域是值校验入口（validateLogicalSnapshot 消费 `derived.values`），extract 非值校验入口，D10 零消费 values 与之自洽 → no-conflict。
2. **note-2（D3 惰性空 map，ADR 未规定的灰色地带，no-conflict）**：ROOT 缺席时 `getMap('ROOT')` 惰性创建空 map。实测零 update 事件、零数据写入、零 state vector 变化（设计 P4）——「只读取固定 ROOT」条款的核心辖域（不碰 SCHEMA/META、不写数据面）未破；ADR-0007 未规定 ROOT 缺席语义，SA6 F6 明文冻结「按空 map」；`toJSON()` 层面的惰性条目出现是 yjs 公共读取 API 的标准语义，非本设计引入的写入。不构成违反，留此记录供 SA2 攻击复核（设计自检已预判该点）。
3. **note-3（D8 自建 ref 解析器，no-conflict）**：ADR-0003「解析动作由包内共享解析器完成（复用 shapes.ts 的 clsOf/memo 模式）」写作语境是 vfsl 包内部（shapes.ts 为 vfsl 部件，彼时 doc-runtime 尚不存在）。doc-runtime 包内同样收敛到单一解析器（`makeRefResolver`，§4.3 表后注释已显式对齐两处调用为同一机制）、ref 未内联展开（遵守「引用不内联展开」）、vfsl 公共面零改动（DENY）。条款字面与实质均未违反；「两份 walkRefChain 实现漂移」属设计优劣判断，归 SA2，不属门禁辖域。
4. **note-4（message 文本点号渲染，no-conflict）**：§4.7 `renderPath` 在 message 文本用 `.`/`[]` 渲染——ADR-0007「禁止点号字符串与 JSON Pointer」辖域是路径的**数据表示**（`issue.path` 恒为 `Array<string|number>` 数组，F3 满足），message 为自由文本（F7 仅要求非空），设计已在 §4.7 显式声明此解读。不构成违反。
5. **note-5（提示 SA2/SA4，非门禁结论）**：§4.6 `plainDomainIssue` 的 actual 值（`'undefined'` / `'function'` / `'symbol'` / `'bigint'`）同样在五值词汇表之外，但设计未像 D9 那样显式申报该同类偏离（自检附注仅登记 internal 偏离）。已核实 SA6 21 用例未锚定这些值（不会红）；属任务层契约申报完整性问题，建议 SA2 评审时要求补报或收编进 D9 同一偏离声明，供 SA4 复核一并裁决。
6. **依赖边界**：§3.2「对 vfsl 只做 `import type`（类型空间消费）+ deps `workspace:*`」不与 ADR-0007「依赖 vfsl + yjs」冲突（ADR 未规定依赖形态必须含运行时值导入）；AC1 三条边界（vfsl 零 yjs / persistence 零 vfsl·doc-runtime / doc-runtime 仅 vfsl+yjs）现状已成立且设计 DENY 全覆盖 → no-conflict。
7. **D11 无工作预算**：ADR-0003「枚举预算是消费者策略，不进引擎契约」——不引入预算与该条款同向；ADR 无强制预算要求 → no-conflict。

## 结论

**Verdict: `clear`——放行。** SA1 R1 设计与 ADR-0001–0007 全集及 CONTEXT.md 无任何冲突点：无 override-declared、无 evolution、无 hard-violation。总控点名的 D9 崩溃边界 `expected/actual='internal'` 偏离，经专项裁决为 **no-conflict**——五值词汇表是 SA6 冻结契约（任务层）而非 ADR/CONTEXT 条款，且 E100 仍满足 ADR-0007 对领域化结果联合与 fail-fast 的全部要求；该偏离已按流程自申报并转 SA4 复核，处置正确。3 条 note（惰性空 map、自建解析器、message 点号渲染）均为 ADR 未规定地带或辖域外事项的存档记录，不阻塞；note-5（§4.6 actual 值同类偏离未申报）建议转 SA2/SA4 处理，非门禁事由。

相关决议文档已按设计后复审要求追加「设计引入的新决策点」一节（D3–D11 + INV 摘录），供 SA2/SA3/SA4/SA7 复用。
