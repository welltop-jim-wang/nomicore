# 冲突门禁报告 — task_xml-attr-quote-domain（Issue #94，Phase 0 前置门禁）

- 被审对象：`wiki/raw/task_xml-attr-quote-domain.md`（Bug 修复：统一 VFSL logical XML validation 与 doc-runtime materialization 的属性引号接受域）
- 冲突基准：`docs/adr/` 全集（7 份，逐个全读）+ `CONTEXT.md`
- 产出时间：SA8 前置门禁；伴生文档：`task_xml-attr-quote-domain_relevant_decisions.md`

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted（2026-08-19 修订节、2026-08-21 命名修订） | 中（方言冻结条款） | no-conflict：主路径只改 doc-runtime 物化器，不触碰方言语义；回退路径已被简报自身用「先走显式 ADR/兼容性演进」前置约束（见结论·演进哨点） |
| ADR-0002 | nomicore 是重写，authority 出范围 | accepted | 低 | no-conflict：统一接受域不引入 authority 式不变式，不改变「结构 → 值 → 单事务提交」三步管线 |
| ADR-0003 | 求值器与派生 schema | accepted | 高（§5 YXmlFragment 不透明语义） | no-conflict：§5「运行时校验仅要求良构 XML」与任务主路径**同向**——`<p title='a"b'>x</p>` 是良构 XML，物化器无条件拒绝 `"反而是与该条款张力的一侧；修复是在兑付而非违反该条款 |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 低 | no-conflict：YXmlFragment→string 映射不变，引号风格不进入类型投影面 |
| ADR-0005 | 投影生成管线 | accepted | 无 | no-conflict：生成器/SchemaSource/CI 新鲜度与 XML 属性引号接受域无交集 |
| ADR-0006 | Cordis 持久化与 doc 三条目布局 | accepted（含 #64/#79 修订节） | 无/低 | no-conflict：任务不触及持久层；「校验只作用 ROOT 子树」边界维持 |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge 分层 | accepted | 高（全部触点所在） | no-conflict：见下逐条对照 |

对 ADR-0007 的逐条对照（任务要求 → 条款）：

| 任务要求（简报原文摘录） | ADR-0007 条款（原文摘录） | 对照 |
|---|---|---|
| 「优先在 materializer/serializer 中实现属性值的无损表示或正确转义」 | 「`materializeRoot`……唯一公共物化入口；内部先执行 `validateLogicalSnapshot`，再构造……detached Yjs 子树……以一次 `Y.transact` 安装」 | 一致：仍走唯一公共入口、先验证后构造、单事务安装；转义/无损表示是构造正确性修复，不构成「覆盖、合并、fallback」 |
| 「round-trip 只要求 XML 语义等价，不要求引号风格或字符串逐字相同」 | 「XML string 与 Y.XmlFragment 只承诺语义等价 round-trip，不承诺字符串逐字相同」 | 逐字同向：任务 AC 就是该条款的复述与兑付 |
| 「malformed XML 继续响亮失败，validation/construction 失败继续保持目标 doc 零写入」 | 「验证或构造失败时目标 doc 零写入；不覆盖、不合并、不 fallback」「零写入承诺覆盖所有验证失败和 detached 构造失败」 | 一致：零写入承诺面不缩小 |
| 「`extractYjsSnapshot` 提取结果再次通过 `validateLogicalSnapshot`」 | 「`extractYjsSnapshot(derived, doc)`：只读取固定 ROOT，严格验证实际 Yjs 载体并提取普通逻辑 ROOT；首个结构错误立即停止」 | 一致：提取行为与 fail-fast 边界不变，只是接受域对齐 |
| 「VFSL validator、materializer、canonical/extract 比较器对同一 XML 子集使用一致规则」 | 「`@nomicore/vfsl` 继续保持无 Yjs 依赖……新包 `@nomicore/doc-runtime` 依赖 `@nomicore/vfsl + yjs`」 | 一致（含约束）：规则统一不得以 vfsl 引入 Yjs 依赖为代价；共享定义须 Yjs-free，依赖方向 doc-runtime → vfsl |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| （无） | — | — | — | — | 未发现任何直接违反 accepted ADR 条款或 CONTEXT.md 硬性惯例的要求 |

- 现有测试「把这一差异锁成『有意 materialization 约束』」不构成冲突基准（代码与测试不在 ADR/CONTEXT 收录范围内），简报要求删除/改写该测试无约束冲突。
- Issue #74 的 round-trip 意图本身不是冲突基准，但其语义已由 ADR-0007「XML string 与 Y.XmlFragment 只承诺语义等价 round-trip」条款收录，对照以上。

## 结论

**Verdict: clear —— 放行，无需 override。**

任务简报的主路径（materializer/serializer 侧无损表示或正确转义，统一两侧接受域）与 ADR-0007 的单入口/先验证后构造/单事务/零写入/语义等价 round-trip 条款完全同向，与 ADR-0003 §5「运行时校验仅要求良构 XML」同向；无任何条款被违反。

**演进哨点（不阻塞，供总控与 Jim 知悉，SA1/SA2 需盯住）**：

1. **回退路径自带演进前置**：简报明确「如果确实只能收窄 logical XML 输入域，必须先明确 ADR/兼容性演进，不得仅保留跨层隐式差异」。若后续设计/实现真的选择收窄 `wellFormedXml` 接受域，将低于 ADR-0003 §5「仅要求良构 XML」的接受域、并触碰 CONTEXT.md 方言条款「一经发布冻结，引擎只增不改」——届时构成 **evolution**（需 owner/Jim 裁决并走正式 ADR 修订），在本报告的 clear 裁决范围之外。主路径不受此影响。
2. **分层纪律红线**：统一规则时 `@nomicore/vfsl` 不得引入 Yjs 依赖（ADR-0007）；共享 XML 子集定义必须 Yjs-free。
3. **零写入与 fail-fast 面不得缩小**：修复只允许扩大物化接受域以对齐校验域，不得反向放宽 malformed XML 的响亮失败或零写入承诺（ADR-0007、CONTEXT.md `零写入`）。
