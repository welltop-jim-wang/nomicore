# 相关决议 (Relevant Decisions) — 全链 SA 复用（修订轮 rev1）

> SA8 前置门禁产出（修订轮）。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 任务：`readLogicalValueAtPath` Phase B union 仲裁遮蔽缺陷修复（Issue #75 rev1 / PR #83 owner Review，**Bug 修复**，run_id `issue-75-rev-1787397220`）。
> 冲突基准：`docs/adr/` 全集（0001–0007，共 7 份，逐份全文读取，无抽样）+ `CONTEXT.md`。
> **与首轮的关系**：ADR 与 CONTEXT.md 自首轮门禁（2026-08-22 15:35）后零变更（7 份 ADR + CONTEXT.md 同批 15:28 落盘）——首轮 `task_read-logical-value-at-path_relevant_decisions.md` 的全部摘录**原样复用**。本文件不重复全量盘点，聚焦修订轮差异：union 仲裁 / 缺席三态语义相关条款，并补充 owner 明确要求对齐的任务族内规（标注出处，非 ADR）。

## 相关 ADR（修订轮聚焦条目；完整摘录见首轮文档）

### ADR-0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted，2026-08-22）

**与本修订轮的关联点**：被修缺陷位于本 ADR 定义的 `readLogicalValueAtPath` 实现内部（Phase B union 导航仲裁）；修订不得触动其公共条款。

核心条款（原文摘录）：

- 「`readLogicalValueAtPath(derived, doc, path)`：同步按路径读取，只转换目标子树；依赖 create/open/update 已建立并维持的结构不变量，普通读取不重复验证。空路径表示显式读取整个 ROOT；合法 optional/Record/数组缺失返回 `undefined`。」
- 「路径统一为 `readonly (string | number)[]`：map/object/Record 使用 string，Y.Array 使用 number；禁止点号字符串与 JSON Pointer。leaf、plain、XML 是不可下钻终态。」
- 「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型；NamespaceRuntime/Registry 再映射成稳定的 create/open/mutation 上层错误。逻辑校验保留完整 issues，Yjs 结构与路径/操作错误 fail-fast。」
- 「普通读取成本与目标 path 子树规模相关；首版 mutation 为正确性执行完整 ROOT 提取与逻辑校验，性能优化必须在行为等价测试下后续引入。」
- 「加载和更新负责验证，读取按 path 快速执行，不重复全树验证。」

### ADR-0003 求值器与派生 schema（accepted，2026-08-19）

**与本修订轮的关联点**：union 仲裁语义的地基——owner 建议的「value 优先」仲裁直接依据本 ADR §3 条款；修订亦不得改派生 schema 形状（含 union 节点）。

核心条款（原文摘录）：

- 「基础表示：`{ kind: 'union'; members: StructureNode[] }`；匹配语义 **any-of**（至少一个成员接受即接受——重叠成员不构成错误）；路径存在性为**任一成员出现即存在**；」
- 「判别式检测（派生）：存在一字面量字段在全体成员中两两互异 → 附非契约缓存 `discriminator`，O(1) 跳转；**缓存的缺失/存在不得改变任何可观测行为（含错误输出）**——映射未命中回流同一诊断生成器；」
- 「no-match 诊断：报**失败距离最小**的成员（平局按声明序），消息标注「联合成员 i/N」相对定位。」（注：该校验相位移交条款不直接约束读取仲裁；声明序平局裁决精神与导航层一致）
- 「派生 schema 照搬 IR 的模块形状：别名表 + ref 节点 `{ kind: 'ref'; name }`；引用**不内联展开**，解析动作由包内共享解析器完成」
- 派生 schema 纪律：「纯数据、可 JSON 序列化、可内容哈希、不携带行列位置」——修订不得要求改 `packages/vfsl` 派生物形状。

### ADR-0004 vfsl-protocol 类型投影（accepted，2026-08-19）

- D3：「全部内容为类型空间产物……编译后为空模块，零依赖、零运行时代码」——本 ADR 不构成运行时约束（沿首轮注记 C：编译期字符串下标 `'3'` 与运行时 number 下标两层并存）。
- D5：「`PathAt` 需含 `[]` 分支（空路径解析为根节点自身……）」——空路径语义跨层参照。

### ADR-0006 Cordis 持久化插件与 doc 三条目布局（accepted，含修订节）

- 「META/SCHEMA 作为 ROOT 的兄弟条目，天然在 validateSnapshot/validatePatch 的校验面之外（校验只作用 ROOT 子树）。」——修订轮读取面仍止于 ROOT 子树。

### ADR-0001 / ADR-0002 / ADR-0005（accepted）

与本修订轮无新增关联（同首轮结论：背景约束 / 写入管线无交集 / codegen 无交集）。摘录与首轮一致，不重复。

## 修订轮新增关联：任务族内规（非 ADR 冲突基准，出处标注）

> 以下规则属既有设计/实现层，**不构成 ADR 冲突基准**（SA8 只以 ADR + CONTEXT.md 为基准）；但 owner 修订建议（AC-R3）明确要求与其一致并成文——SA1 设计必须显式调和。

### extract 侧 union 声明序规则（extract.ts `walkUnion`，extract 任务族设计 §4.5.2 / INV-8）

- 「union 提交层仲裁（§4.5.2 唯一权威，恒两结局）：1. 首个接受者胜（any-of + 声明序，INV-8）；2. 全拒 → 声明序首个真 issue；3. 全软拒 → 回退成员 0 提交提取（结构不裁决，逻辑相位报缺必填）。判别式（node.discriminator）零读取（D5/INV-4，构造性保证）。」
- 成员试验三结局（§4.5.1）：「第一步恒为成员根载体前置判定……封闭 map 形成员逐字段检查——缺必填置软标记但不中断，真 issue 立即拒；……Record 形成员无缺失概念、试验 = 直接 walk」

### read 侧现行规则（首轮设计 D4 / INV-7；read.ts:343-349 为 owner 指认的缺陷位）

- 首轮设计 D4：「union 导航 = any-of 逐成员**活**导航，声明序首个可产出者胜；判别式零读取」（INV-7：「union 导航/试验声明序确定性，首个可产出者/接受者胜」）
- 现行包内类型（read.ts:261）：`type NavOutcome = { ok: true; value: unknown } | { ok: false }`——owner 要求三态化（value / missing / reject）的改造对象；**包内内部类型，非公共接缝**。
- 现行缺席三源（owner 指认 read.ts:323-325 / 329-334）：Record 缺键 `if (v === undefined) return { ok: true, value: undefined }`；optional 缺席 `f.optional ? { ok: true, value: undefined } : { ok: false }`；数组非负整数越界（注记 A：格式合法越界 = 合法缺失）。
- 现行 union 循环（read.ts:343-349）：`for (const m of node.members) { const r = resolveLive(...); if (r.ok) return r; } return { ok: false }`——`ok:true`（含 missing）即短路，即 owner 指认的遮蔽机制。

### 首轮冻结契约（SA6 Phase 1 锚定，任务简报「SA1 设计不得收窄，仅可补充」）

1. 公共接缝：`readLogicalValueAtPath(derived: DerivedSchema, doc: Y.Doc, path: readonly (string | number)[])` 经 `packages/doc-runtime/src/index.ts` 导出；同步、不抛错。
2. 结果联合两态：`{ ok: true; value: unknown } | { ok: false; code: 'PATH_NOT_ALLOWED'; path: readonly (string | number)[] }`（+设计 D5 增补 `message?` 非契约诊断字段）。
3. AC3 缺键形态：`{ ok: true; value: undefined }`——value 键必须显式存在且为 undefined（禁省略键）。
4. 无 Yjs 泄漏；XML 字符串投影只承诺语义等价。
5. AC6 行为锚点：目标子树读取只返回目标子树；坏兄弟子树不影响目标读取；返回值修改不影响 live doc。

### 首轮设计 DENY（修订轮继续有效）

- 「`packages/vfsl/src/evaluate.ts` / `derived.ts` / `validate.ts` 及 `packages/vfsl` 其余源码——派生 schema 冻结形状与校验语义不动」

### 首轮设计相关决策点（被修订的基底）

- D6 失败单通道：C1（schema 不允许，契约内）/ C2（不变量外活数据态，防御性映射）/ C3（内部缺陷，崩溃边界）统一映射 `PATH_NOT_ALLOWED`。
- D8 缺键吸收式语义：「路径中点缺 optional/Record 键、非负整数越界 → `value:undefined`，不再检验余下段」。
- D13 memo：「memo 只缓存不改变判定路径：union 成员声明序迭代不变（INV-7），命中即返回等价结果」；成本上界 O(触及节点数 × 路径长 × 成员扇出)，SUP-2 为护栏锚点。
- D15：「Phase A 按 any-of 键空间并集判定；Phase B 有意零 keyPattern 检查」——SUP-1 以 `extractYjsSnapshot` 为 ground truth 交叉锁。

## CONTEXT.md 相关术语与惯例（同首轮摘录，补录两条）

- **判别联合（discriminated union）**：「字面量联合字段（如 `kind`）区分的变体；引擎自动识别判别字段并按变体验证。」
- **封闭对象（closed object）**：「子集内对象类型默认封闭：未声明字段拒绝。」
- **结构树（structure tree）**：「Yjs 物化语义（kind / storage / opaque），供路径下钻守卫；与值语义正交。」
- **路径索引（path index）**：「路径 → 子 schema 的下钻索引，键匹配（exact / pattern）为标准能力。」_Avoid_: resolveChild 三级前缀匹配
- **标记类型 / ROOT / 派生 schema / 逻辑快照校验 / 命名空间 / 信封**：摘录与首轮文档逐字一致，不重复。

## 修订轮验收要求速览（摘自 rev1 简报，供 SA1/SA2/SA6 对照；裁决见 `…_rev1_conflict_report.md`）

- AC-R1: Phase B 导航结果区分 value / missing / reject 三态（或等价机制）
- AC-R2: union 仲裁——首个真实 value 胜出；前序仅 missing 时继续后续成员；全部可行成员 missing → `ok:true, value:undefined`；全部 reject → `PATH_NOT_ALLOWED`
- AC-R3: 明确 required-missing / 载体错位 / 合法缺席的优先级，并与现有 extract/union 声明序规则一致（在设计文档中成文）
- AC-R4: owner 要求的全部回归测试补齐（含数组越界场景 owner 自带保留措辞「如结构允许」）
- AC-R5: 不回归既有测试（含 SUP-1 XML 情形）
