# 冲突门禁报告（设计后复审）— task_xml-attr-quote-domain（Issue #94，design R1）

- 被审对象：`wiki/raw/task_xml-attr-quote-domain_design.md`（SA1 设计 R1：主路径 = 投影面正确转义）
- 冲突基准：`docs/adr/` 全集（0001–0007，前置门禁已全读；本次按触点复核）+ `CONTEXT.md` + 前置门禁产出 `task_xml-attr-quote-domain_relevant_decisions.md`
- 复审性质：设计一致性轻量复审（不重复前置门禁全量盘点；全维度攻击评审属 SA2）；相关决议文档已同步追加「设计引入的新决策点（design R1）」节

## Verdict

`clear`

## 三条红线逐一核验（总控点名项）

### 红线 1：ADR-0007（零写入 / 单事务 / 唯一入口 / 语义等价 round-trip）— 未触碰

| 设计内容（原文摘录） | ADR-0007 条款（原文摘录） | 核验 |
|---|---|---|
| §4.5/§5.6：「`materialize.ts` 六阶段编排：零改动」「改动不触碰 prepare/④ 事务结构：② 失败面只减不增（删一条拒绝分支），一切失败仍在安装前（零写入）；成功路径仍单次 `doc.transact`」 | 「确认目标 ROOT 为空后以一次 `Y.transact` 安装。验证或构造失败时目标 doc 零写入；不覆盖、不合并、不 fallback」「零写入承诺覆盖所有验证失败和 detached 构造失败」 | 一致：单事务结构与零写入承诺面原样；② 仅删除一个拒绝分支，失败面单调缩小，且所有失败仍位于安装前 |
| §4.2：「模块内部件（不经 `index.ts` 导出，与 xml-parse.ts 同纪律）」；§4.5 materialize 六阶段零改动 | 「`materializeRoot`……唯一公共物化入口」 | 一致：未新增公共物化/投影绕行入口；新序列化器为 doc-runtime 模块内部件 |
| §5.5：「两者 XML 语义等价（dec 后同为 `a"b`），受 ADR-0007『XML 只承诺语义等价 round-trip，不承诺字符串逐字相同』明文保护。**单次 materializeRoot 调用内部无漂移**」 | 「XML string 与 Y.XmlFragment 只承诺语义等价 round-trip，不承诺字符串逐字相同」 | 一致且同款口径：设计显式援引该条款接纳投影表示漂移（`a"b` → `a&quot;b`），且论证 dec(esc(v))===v 的语义等价性——条款本就豁免逐字相同 |
| §4.2 live 守卫 throw / §9 崩溃边界审计：「live 守卫 throw 被既有 E100 崩溃边界收编为结构化返回（不外抛）」「守卫 throw → e201D（理论不可达，防御性收敛）」 | 「Yjs observer 不得向事务调用栈抛异常……不虚假声称自动回滚，也不尝试 fallback」 | 一致：守卫非 observer、位于模块内部件、被既有 E100/E201-D 边界收编，无新增外抛面（§9 caller audit 全表覆盖五个消费方 + grep 无第六处） |
| §4.3：extract walk 仅替换 xml-fragment 终态投影实现 | 「`extractYjsSnapshot`……只读取固定 ROOT，严格验证实际 Yjs 载体并提取普通逻辑 ROOT；首个结构错误立即停止，不读取或验证 SCHEMA/META」 | 一致：载体结构校验、fail-fast、SCHEMA/META 边界均不动；仅终态 XML 字符串的产出实现替换 |

### 红线 2：ADR-0003 §5（良构 XML 接受域）— 未触碰，且为同向兑付

- 设计 §3 明文否决收窄路径：「备选路径 B（收窄 VFSL 逻辑域到 ②/③ 的窄域）——否决。触碰 ADR-0001……且低于 ADR-0003 §5『运行时校验仅要求良构 XML』的既定接受域」；DENY LIST 首条「`packages/vfsl/**`……本修复不动 vfsl 一行」。
- 逻辑域接受面（① `wellFormedXml`）零改动；② 物化域**放宽**至与 ① 同域（§4.1 删拒绝）；③④ 投影/canonical 对齐同一子集（§4.2/§4.4）。方向是把 ②③④ 抬到 ①，不是把 ① 拉低——与前置门禁放行的主路径完全一致。
- §5.1 不变式 B（`esc(v)` 永不含裸 `"` → 投影输出在 `wellFormedXml` 下恒良构）保证「运行时校验仅要求良构 XML」的域内闭环。
- **前置门禁演进哨点 #1 解除**：Phase 0 报告预警的「回退路径若被选择构成 evolution」未被触发——设计明确否决该路径，无需 owner/Jim 裁决。
- 中性注记（非冲突）：ADR-0003 §5 括注「（与 `Y.XmlFragment.toJSON()` 投影一致）」——`toJSON()` 并非字符串投影（yjs 中为 JSON 树结构），条款操作性内容是「JSON 快照中其值为 XML 字符串」；设计保持该语义（且字符串恒良构），不构成对该括注的违反。byte 级投影形态未被任何 ADR 钉死。

### 红线 3：ADR-0001（方言冻结）+ vfsl 无 Yjs 依赖（条款精确归属：ADR-0007）— 未触碰

- 方言冻结（ADR-0001「方言只增不改」/CONTEXT.md「一经发布冻结，引擎只增不改」）：`packages/vfsl/**` 全包 DENY LIST 零改动，方言语义（含 `wellFormedXml` 接受域）原样——无「改」无「收窄」。
- 依赖方向（ADR-0007「`@nomicore/vfsl` 继续保持无 Yjs 依赖……`@nomicore/doc-runtime` 依赖 `@nomicore/vfsl + yjs`」）：新模块 `xml-serialize.ts` 位于 doc-runtime、import yjs——方向正确；`xml-parse.ts → xml-serialize.ts` 为同包单向依赖（§4.4「无环：xml-serialize 不 import xml-parse」）；vfsl 零依赖变化。（注：「vfsl 不得引入 Yjs 依赖」的条款原文在 ADR-0007 分层纪律，ADR-0001 为方言冻结——两条均核验通过。）

## ADR 盘点（触点复核，其余沿用前置门禁结论）

| 编号 | 状态 | 设计触点 | 对照结论 |
|---|---|---|---|
| ADR-0001 | accepted（含修订节） | 无 vfsl 改动；方言未触碰 | no-conflict |
| ADR-0002 | accepted | 无 authority 机制引入；写入管线三步不变 | no-conflict |
| ADR-0003 | accepted | §5 接受域同向兑付（见红线 2）；ROOT 约定不触及 | no-conflict |
| ADR-0004 | accepted | YXmlFragment→string 类型映射不变（投影仅内容层变化，类型仍为 string） | no-conflict |
| ADR-0005 | accepted | 无触点（codegen/SchemaSource 不涉及） | no-conflict |
| ADR-0006 | accepted | 无触点（持久层零影响，§6 grep 确认） | no-conflict |
| ADR-0007 | accepted | 全部触点（见红线 1 逐条表） | no-conflict |

CONTEXT.md 惯例核验：`零写入`（§5.6 保持）、`逻辑快验`入口与用途（不动）、`标记类型`（无新标记/变体拼写）、`方言`（冻结原样）、`ROOT`（不触及）——全部 no-conflict。

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| （无） | — | — | — | — | 未发现设计任何条目直接违反 accepted ADR 条款或 CONTEXT.md 硬性惯例；无 override 声明，亦无未走正式 supersede 的实质演进 |

附注（非冲突、交接 SA2 的观察点，不构成门禁动作）：

1. 设计对 yjs@13.6.32 投影行为的镜像依赖（§8 协议假设表 + 实测）属第三方库行为假设与实现质量问题，不在 ADR/CONTEXT 冲突基准内——归 SA2 攻击评审。
2. §5.2/§5.3 的「禁止转义 `&`、文本/属性非对称」是设计级决策（PR #84 既有契约 + T-13/X-16 反例推导），无 ADR 条款约束冲突；其正确性论证归 SA2。
3. D4「行为中性」论证依赖「canonical 唯一调用方为 productEqual、输入恒为新投影输出」的实现前提——若 SA3 实现偏离该前提属实现偏差（SA4/SA7 领地），不改变 ADR 一致性结论。

## 结论

**Verdict: clear —— 设计与 ADR 全集 + CONTEXT.md 一致，放行进入 SA2 全维度评审。**

- 三条红线（ADR-0007 零写入/单事务/唯一入口/语义等价 round-trip、ADR-0003 §5 良构接受域、ADR-0001 方言冻结 + vfsl 无 Yjs 依赖）逐条核验**均未触碰**；设计中与 ADR 的全部交互点为**兑付方向**（修复正是在落实 ADR-0007 round-trip 闭环与 ADR-0003 §5 接受域）。
- 前置门禁三条演进哨点处置：#1 回退路径已被设计明文否决（哨点解除）；#2 依赖方向红线遵守（新模块在 doc-runtime，单向无环）；#3 零写入/fail-fast 面未缩小（② 失败面只减不增，malformed 镜像保持）。
- 无 override-declared、无 evolution、无 hard-violation；无需 Jim 裁决事项。
- 相关决议文档已追加「设计引入的新决策点（design R1）」节供 SA2/SA3/SA4/SA7 复用。
