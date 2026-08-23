# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出（被审对象：`wiki/raw/task_xml-attr-quote-domain.md`，Issue #94 Bug 修复）。
> 只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文（`docs/adr/`，共 7 份全读）。
> 冲突裁决见同目录 `task_xml-attr-quote-domain_conflict_report.md`（Verdict: clear）。

## 相关 ADR

### ADR-0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted，2026-08-22）— 高度相关

本任务的全部触点（validateLogicalSnapshot / materializeRoot / extractYjsSnapshot / XML round-trip / 零写入）都在本 ADR 的决策面上。

- 与本任务的关联点：Issue #94 的症状（validateLogicalSnapshot ok:true 但 materializeRoot ok:false）发生在本 ADR 定义的两个入口之间；修复不得破坏以下任一条款。
- 核心条款（原文摘录）：
  - 「`validateSnapshot` 直接更名为 `validateLogicalSnapshot`，不保留兼容 alias；它只接受普通 JSON logical ROOT snapshot，不接受 Y.Doc/Y.Map/Y.Array。」
  - 「`extractYjsSnapshot(derived, doc)`：只读取固定 ROOT，严格验证实际 Yjs 载体并提取普通逻辑 ROOT；首个结构错误立即停止，不读取或验证 SCHEMA/META。」
  - 「`materializeRoot(derived, snapshot, doc)`：唯一公共物化入口；内部先执行 `validateLogicalSnapshot`，再构造未集成到任何 doc 的 detached Yjs 子树，确认目标 ROOT 为空后以一次 `Y.transact` 安装。验证或构造失败时目标 doc 零写入；不覆盖、不合并、不 fallback。」
  - 「路径统一为 `readonly (string | number)[]`：map/object/Record 使用 string，Y.Array 使用 number；禁止点号字符串与 JSON Pointer。leaf、plain、XML 是不可下钻终态。**XML string 与 Y.XmlFragment 只承诺语义等价 round-trip，不承诺字符串逐字相同。**」
  - 「零写入承诺覆盖所有验证失败和 detached 构造失败。Yjs observer 不得向事务调用栈抛异常……」
  - 分层纪律：「`@nomicore/vfsl` 继续保持无 Yjs 依赖；持久层继续不理解 VFSL。新包 `@nomicore/doc-runtime` 依赖 `@nomicore/vfsl + yjs`」——若统一 XML 子集规则需要共享定义，共享物必须保持 Yjs-free（依赖方向只能 doc-runtime → vfsl，不得反向）。
  - 「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型……逻辑校验保留完整 issues，Yjs 结构与路径/操作错误 fail-fast。」

### ADR-0003 求值器与派生 schema（accepted，2026-08-19）— 高度相关（§5）

- 与本任务的关联点：§5 定义 YXmlFragment 的逻辑面契约——「良构 XML」是运行时校验对 XML 值的唯一要求；任务主路径（放宽 materializer 接受域）与该条款同向。
- 核心条款（原文摘录，§5 YXmlFragment 不透明语义）：
  - 「`xml-fragment` 是结构树的**终态节点**：无 children、路径下钻守卫到此为止；JSON 快照中其值为 XML 字符串（与 `Y.XmlFragment.toJSON()` 投影一致），**运行时校验仅要求良构 XML**。不定义实参字段与 XML 结构的映射——实参字段为文档性质。」
  - §2（ROOT 约定）：「ROOT 固定物化为 Y.Map，`YArray` / `YXmlFragment` 与标量形一律拒绝」——YXmlFragment 只能出现在 ROOT 子树内部字段位，本任务不触及。
- 注意（中性陈述）：任务简报的回退路径「收窄 logical XML 输入域」若被选择，将低于本条款「仅要求良构 XML」的接受域，任务简报自身已声明该路径必须先走显式 ADR/兼容性演进。

### ADR-0001 VFSL 唯一真相源（accepted；2026-08-19 修订、2026-08-21 命名修订）— 相关（回退路径的演进前提）

- 与本任务的关联点：方言冻结条款约束 VFSL 校验语义的修改方式；任务主路径只改 doc-runtime 物化器、不动方言，不受影响。回退路径（收窄 logical 接受域）会触碰本条款。
- 核心条款（原文摘录）：
  - 「解释行为由信封自述的方言版本决定，方言只增不改，未知方言 loud-fail 只读。」
  - 修订节：「本 ADR 的其余条款（无机器标签、方言冻结、编译缓存、演进为运行时管理操作）不变。」

### ADR-0002 nomicore 是重写、authority 出范围（accepted）— 弱相关

- 与本任务的关联点：统一写入管线的三步收敛是 materializeRoot 单事务安装的上位语境。
- 核心条款（原文摘录）：
  - 「统一写入管线收敛为『结构 → 值 → 单事务提交』三步。」
  - authority 规则体系「完全排除在范围外，不保留接口」——本任务不得以「兼容旧约束」为由引入任何 authority 式不变式。

### ADR-0004 vfsl-protocol 类型投影（accepted）— 弱相关

- 与本任务的关联点：类型层 XML 恒为 string；引号风格不进入类型投影面，本任务不改变映射表。
- 核心条款（原文摘录）：
  - 「类型树形状 = 生成契约：票 F 生成器的输出规格即本 ADR + 设计文档 §8.3 映射表（Record 通配层 / 标记→kind / Pattern→string / **YXmlFragment→string** / ref→别名引用 / docs→TSDoc 注释）」

### ADR-0005 投影生成管线（accepted）— 无关

- 盘点完整性列入：投影生成/CI 新鲜度与 XML 属性引号接受域无交集。无约束条款需要本任务遵守（仅有通用的 SchemaSource/生成器纪律，不触及）。

### ADR-0006 Cordis 持久化与 doc 三条目布局（accepted；含 #64/#79 修订节）— 无关（仅一条边界注释弱相关）

- 弱相关条款（原文摘录）：「META/SCHEMA 作为 ROOT 的兄弟条目，天然在 validateSnapshot/validatePatch 的校验面之外（校验只作用 ROOT 子树）。」——与 ADR-0007 extractYjsSnapshot「不读取或验证 SCHEMA/META」同义，本任务不触及持久层。

## CONTEXT.md 相关术语与惯例

- `逻辑快照校验（validateLogicalSnapshot）`：「对普通 JSON 逻辑 ROOT 快照运行完整值语义校验；不接收 Y.Doc / Y.Map / Y.Array，也不验证 Yjs 载体。创建前校验、迁移后体检、测试与管理端点共用该入口。」——XML 良构性校验位于此入口的值语义内。
- `零写入（zero-write）`：「校验失败 → 400 且文档不变；所有写入口走同一条管线。」——任务 AC 的零写入条款即此惯例，修复必须保持。
- `标记类型（marker types）`：「`YMap` / `YArray` / `YPlainArray` / `YLeaf` / `YXmlFragment` / `Pattern`；tsc 视角恒等别名，引擎视角是 Yjs 物化语义标记。」——`YXmlFragment` 拼写与语义是契约，物化/提取两侧不得引入新标记或变体拼写。
- `方言（dialect）`：「`lang + version` 决定的 VFSL 语法子集与语义规格；一经发布冻结，引擎只增不改，未知方言 loud-fail 只读。」——回退路径（收窄 logical XML 接受域）属「改」而非「只增」，须先走 ADR 演进。
- `ROOT`：「每个模块必须恰好声明一个 map 形的 `type ROOT = …`（裸对象 / `YMap` / `Record`），ROOT 固定物化为 Y.Map，Yjs 映射为 doc 根 `getMap('ROOT')`。」——本任务在 ROOT 子树内部工作，不触及 ROOT 约定本身。

## 设计引入的新决策点（设计后复审追加，design R1，尚待 SA2 破壁）

> 以下为 SA1 设计 `task_xml-attr-quote-domain_design.md`（R1）新引入的**设计级**决策点（非 ADR 条款），摘录供 SA2/SA3/SA4/SA7 全链复用；设计优劣判断属 SA2，此处不裁决。设计一致性裁决见 `task_xml-attr-quote-domain_design_conflict_report.md`。

- **路径裁决（§3）**：备选 B（收窄 VFSL 逻辑域）否决——「触碰 ADR-0001『方言只增不改』……且低于 ADR-0003 §5……显式 ADR 演进超出本 Bug 修复半径。**vfsl 包零改动**」；备选 A（parse 侧存 `&quot;` 转义值）否决——治标错位 / 违反 RT-E 设计意图 / 存储失真三条理由。主路径采纳：**投影面正确转义（serialize-side escaping）**。
- **D1（§4.1）**：删除 `xml-parse.ts:209-212` 构造期属性值含 `"` 拒绝；② 物化域恢复与 ① `wellFormedXml` 同域；malformed 判定路径不受影响（被删检查位于配对引号解析成功之后）。
- **D2（§4.2）**：新建 `doc-runtime/src/xml-serialize.ts`（模块内部件，不经 index.ts 导出）：`escapeAttrValue` 仅转义 `"`→`&quot;`，**禁止转义 `&`/`<`/`>`/`'`**（T-13 决定性反例）；文本 span 零转义（X-16 契约，文本/属性非对称是契约要求）；不含 `"` 属性值时输出与 yjs 原生 toString **逐字节相同**；detached fragment live 守卫 loud throw（防御纵深，正常路径不可达）。
- **D3（§4.3）**：`extract.ts:138` 裸 `Y.XmlFragment.toString()` 替换为 `xmlFragmentToString`——XML 字符串投影唯一产出点；`readLogicalValueAtPath` 经同一 walk 自动同域（D7 单一语义源）。
- **D4（§4.4）**：`canonicalXmlOf` 属性值渲染加 `escapeAttrValue`（行为中性论证：canonical 输入恒为新投影输出、永不含裸 `"`）；不做实体解码，⑥ 保守检测语义（变体 C/D）不放宽。
- **D5（§4.5）**：`materialize.ts` 六阶段编排零改动；rev2 RT-5 修复后由变体 D 迁移到变体 C，断言零改动保持绿。
- **表示漂移显式接纳（§5.5）**：存储值 `a"b` 投影为 `a&quot;b`，跨用户级 rematerialize 循环可一次性迁移（esc 幂等，第二次起不动点）；设计主张受 ADR-0007「XML 只承诺语义等价 round-trip，不承诺字符串逐字相同」保护；单次 materializeRoot 调用内部无漂移（⑥ 双侧同源 parse）。
- **零写入/单事务（§5.6）**：不触碰 prepare/事务结构，② 失败面只减不增，成功路径仍单次 `doc.transact`。
- **文件边界（§7）**：ALLOW LIST = xml-parse.ts / xml-serialize.ts（新建）/ extract.ts / SA6 所属三个测试文件；DENY LIST 首条 = `packages/vfsl/**` 零改动。
