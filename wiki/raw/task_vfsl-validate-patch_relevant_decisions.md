# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出（task_vfsl-validate-patch / issue #53 / H2）。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 冲突裁决见同目录 `task_vfsl-validate-patch_conflict_report.md`（Verdict: clear）。

## 相关 ADR

### ADR-0002 nomicore 是全新 yjs-server 重写，authority 完全出范围（accepted）

- 与本任务的关联点：H2 即「统一写入管线」判定核心的落地票；管线的形状由本 ADR 收敛定义。
- 核心条款（原文摘录）：
  - 「旧系统既有的 authority 规则体系（`__authority__` manifest：enum / range / conditional / state-machine）**完全排除在范围外，不保留接口**——统一写入管线收敛为『结构 → 值 → 单事务提交』三步。」
- 对本任务的约束含义：validatePatch 的判定面只做「结构 → 值」两步判定；「单事务提交」属 server/yjs 层（Phase 2，本票明确不碰 yjs）。不得引入任何 authority 风格的不变式校验（enum/range/conditional/state-machine 式规则）。

### ADR-0003 求值器与派生 schema（accepted）

- 与本任务的关联点：结构守卫与重建校验的全部语义依据；简报明引 §3。
- 核心条款（原文摘录）：
  - §3：「基础表示：`{ kind: 'union'; members: StructureNode[] }`；匹配语义 **any-of**（至少一个成员接受即接受——重叠成员不构成错误）；路径存在性为**任一成员出现即存在**」
  - §3：「判别式检测（派生）：存在一字面量字段在全体成员中两两互异 → 附非契约缓存 `discriminator`，O(1) 跳转；**缓存的缺失/存在不得改变任何可观测行为（含错误输出）**——映射未命中回流同一诊断生成器」
  - §3：「no-match 诊断：报**失败距离最小**的成员（平局按声明序），消息标注「联合成员 i/N」相对定位。」
  - §4：「派生 schema 照搬 IR 的模块形状：别名表 + ref 节点 `{ kind: 'ref'; name }`；引用**不内联展开**，解析动作由包内共享解析器完成（复用 shapes.ts 的 clsOf/memo 模式）」
  - §5：「`xml-fragment` 是结构树的**终态节点**：无 children、路径下钻守卫到此为止；JSON 快照中其值为 XML 字符串（与 `Y.XmlFragment.toJSON()` 投影一致），运行时校验仅要求良构 XML。」
  - 后果：「派生 schema 的形状变更须走设计修订流程（公共契约）」
  - 后果：「结构树/值 schema 节点类型含 `ref` 成员，一切遍历经包内共享解析器（shapes.ts 已有同模式基础设施）」
  - 关联：「Feishu 设计文档 §3（派生产物）、§7（统一写入管线——「最近的结构边界重建整值」依赖联合表示）」
- 对本任务的约束含义：
  1. 结构守卫的存在性判定与联合 no-match 诊断必须逐字兑现上述条款（AC 已镜像）；
  2. validatePatch 一切对 derived（含 ref 成员）的遍历必须走包内共享解析器——这正是简报「resolve 双份收敛」的 ADR 依据；**现状 resolveValues（validate.ts）与 resolveChain（resolve.ts）两份并存，收敛是向本条款对齐，不得再添第三份**；
  3. 重建校验的 union 判定复用 validateSnapshot 的同一诊断生成器（判别式缓存非契约、不得改变错误输出）；
  4. YXmlFragment 是与 leaf/plain 并列的终态位：下钻守卫到此为止，值校验只要求良构 XML——简报 AC 未单列 xml 位，SA1/SA3 须补齐覆盖（见冲突报告观察 2）；
  5. validatePatch 只消费 derived，不得改其形状；如设计需要形状变更 → 走设计修订流程。

### ADR-0004 vfsl-protocol 类型协议包（accepted）—— D1/D2 为本任务的词表来源

- 与本任务的关联点：简报自述「数组三操作变体（insert/append/delete，D1 词表的运行时面）」；D2 把联合成员适配判定显式划给运行时。
- 核心条款（原文摘录）：
  - D1：「`patch` 路径支持下标（`patch(['items','3','A','B','C'], v)`）：值类型经 `Record<\`${number}\`, 元素子树>` 精确投影；执行映射为 Yjs 粒度 set（保元素身份与协作光标）；越界归运行时校验」
  - D1：「序列编辑（insert / append / delete）不是「按址赋值」，patch 路径表达不了，由专用 API 承载：`appendToArray` / `insertIntoArray` / `deleteFromArray`（下标为显式参数）」
  - D1：「`YPlainArray` 只能整体替换（普通 JSON 值，非 Y.Array——标记语义边界）。」
  - D2：「成员独有字段：read → `T | undefined`……patch 值 → `T`（声明处类型）；当前成员是否允许该写入归运行时重建校验——类型层查键空间与值类型，运行时查成员适配」
- 对本任务的约束含义：
  1. 三操作（insert/append/delete）是 D1 专用 API 的**运行时判定面**，非 patch 路径变体——不得把序列编辑塞进下标替换语义；
  2. 下标替换越界 = 运行时校验拒绝（简报「数组下标越界为运行时错误（替换语义）」即此条款）；insert 的下标边界（含末尾 append 位）无 ADR 冻结，属 SA1 设计自由；
  3. YPlainArray 位拒绝下钻、只接受整值替换；
  4. 向 union 成员写他成员字段的拒绝判定，是 D2 显式指派给运行时重建校验的职责——类型层放行、运行时查成员适配。

### ADR-0001 VFSL 文本是 schema 的唯一真相源（accepted，2026-08-19 修订）

- 与本任务的关联点：弱相关——本任务是纯运行时校验引擎件，兑现「坏数据进不来」的运行时校验承诺。
- 核心条款（原文摘录）：
  - 「**本仓库是纯引擎仓库：代码库不含 schema 文本（测试 fixture 除外）。**」
  - 「『坏数据进不来』由运行时校验兑付」（Consequences）
- 对本任务的约束含义：validatePatch 为纯引擎新增，不引入 schema 文本/消费方；测试 fixture 例外不触发。无机器标签、方言冻结条款不被触及。

### ADR-0005 投影生成管线（accepted）

- 与本任务的关联点：**无关**。SchemaSource 接缝 / 生成器 / 生成物入仓 / domains/ 均不在 H2 触碰范围（列为盘点完整性）。
- 约束含义：无。SA1/SA3 不得因本票改动 `@nomicore/vfsl-codegen`、`domains/` 或 CI regen-diff 相关面。

## CONTEXT.md 相关术语与惯例

- 「**重建校验（rebuild validation）**」：「单字段 patch 也在最近结构边界合并当前值后按完整子 schema 校验——判别联合只有看到判别字段才知道按哪个变体验。」——H2 值校验段的定义性出处。
- 「**结构树（structure tree）**」：「Yjs 物化语义（kind / storage / opaque），供路径下钻守卫；与值语义正交。」——H2 结构守卫段的定义性出处；守卫与值校验两段必须保持正交。
- 「**路径索引（path index）**」：「路径 → 子 schema 的下钻索引，键匹配（exact / pattern）为标准能力。」_Avoid_: resolveChild 三级前缀匹配（被替换的旧机制）——下钻实现不得复活的旧机制。
- 「**零写入（zero-write）**」：「校验失败 → 400 且文档不变；所有写入口走同一条管线。」——validatePatch 是判定核心（纯函数、不写文档）；400/HTTP/WS 通道语义属 Phase 2 PRD 层（见下「补充参照」纪律行）。
- 「**整文档校验（validateSnapshot）**」：「对整份快照跑一次完整校验；快照加载、迁移后体检、测试、管理端点共用的单一入口。」——简报要求「全收集 + 上限语义与 validateSnapshot 一致」且解释器单一来源，两入口共用同一解释器。
- 「**判别联合（discriminated union）**」：「字面量联合字段（如 `kind`）区分的变体；引擎自动识别判别字段并按变体验证。」
- 「**封闭对象（closed object）**」：「子集内对象类型默认封闭：未声明字段拒绝。」——「未知键路径 → 拒绝」AC 的依据。
- 「**派生 schema（derived schema）**」：「求值器的产出：结构树、值 schema、路径索引的打包；与 IR 同纪律——纯数据、可 JSON 序列化、可内容哈希；别名按名引用（`ref`）保留，不内联展开（ADR-0003 §4）。」——validatePatch 第一入参 `derived` 的形状纪律。
- 「**方言（dialect）**」：「`lang + version` 决定的 VFSL 语法子集与语义规格；一经发布冻结，引擎只增不改，未知方言 loud-fail 只读。」——本票不改方言语义；H1（信封解析与方言路由）是姊妹票，不在本票内。
- 「**ROOT**」：「每个模块必须恰好声明一个 map 形的 `type ROOT = …`……ROOT 固定物化为 Y.Map」——路径不含 ROOT 前缀（ADR 0004 D5 同向）：validatePatch 的 path 顶段即 ROOT 字段。

## 补充参照（非冲突基准，总控指定审阅范围）

### docs/phases/phase-2-engine-gaps.md（H2 行 + 纪律）

- H2 行：「`validatePatch(derived, base, path, value)` + 数组三操作：结构守卫（路径存在性任一成员规则、leaf/plain 拒绝下钻）+ 最近结构边界重建整值校验」，依据「设计文档 §7（统一写入管线）；CONTEXT.md『重建校验』；ADR 0003 §3」。
- 纪律：「H2 复用 `validate.ts` 解释器，不复制第三份（#28/#31 评审留档的 resolve 双份问题随票收敛）」；「三票均纯引擎、零新运行时依赖、不碰 yjs」；「WS 校验语义（拒绝于应用前 / 错误通道 / 幂等重拒）与『写入强制级别 / API 面拆分』为 Phase 2 PRD 素材，不在本层」。

### docs/vfsl/v1-spec.md §7（指正）

- **§7 实为「信封形状」**（信封 `{lang, version, id, text}` 四字段与 parser 边界），**不是**「统一写入管线」。
- 「统一写入管线 §7」指向 **Feishu 设计文档** §7（ADR 0003 关联节明引：「Feishu 设计文档……§7（统一写入管线——「最近的结构边界重建整值」依赖联合表示）」）。简报「关键参考」把两者并写为「设计文档 §7（统一写入管线）：docs/vfsl/v1-spec.md」属指针混写——全链 SA 以 ADR 0003 §3/§4/§5 + CONTEXT「重建校验/结构树」为语义依据，**不要**把 v1-spec §7 当写入管线规格读。

---

## 设计后复审追加（Phase 2，2026-08-21）—— SA1 设计冻结的决策点

> SA8 设计后复审产出（verdict: clear，见 `task_vfsl-validate-patch_design_conflict_report.md`）。
> 以下为设计文档（`task_vfsl-validate-patch_design.md`，SA1 R1）在 ADR/CONTEXT 未冻结处行使设计自由后**冻结**的决策点——对 SA3（实现）/ SA4（评审）/ SA7（核验）构成约束。只摘录，不裁决；回查以设计文档原文为准。

### 1. 边界判定规则（设计 §3.3，按优先级命中即止）

1. 游走穿过 union（含数组三操作路径穿过 union）→ 边界 = **第一个被穿越的 union 位**（值树游标静态可达的最深重建点）；
2. 无 union 穿越 + replace + 父容器为 Record map（终段经 `'<key>'` 放行）→ 边界 = **Record 位**（键 Pattern 随写入判定，O(条目数) 成本显式接受）；
3. 无 union 穿越 + replace + 父容器为 array（下标写入）→ 边界 = **数组位**（整数组重建——元素写入的重建单位是数组，AC6#2 测试冻结）；
4. 数组三操作（无 union 穿越）→ 边界 = **目标数组位**；
5. 其余（终态整值替换 / 封闭对象字段写入 / union 位整值替换）→ 边界 = **目标位本身**。

### 2. 决策表冻结项（设计 §5，D1–D12）

- D1 四函数命名与 SA6 测试导出名逐字一致（`validatePatch` / `validateAppendToArray` / `validateInsertIntoArray` / `validateDeleteFromArray`）；
- D2 insert 下标闭区间 `[0, len]`（len = append 位），index > len 拒绝；
- D3 守卫拒绝的 issue path = **完整尝试路径**（含失败点之后的段；数组操作越界拒绝 = path ++ [index]）；
- D4 Record 条目写入边界 = Record 位（规则 2）；
- D5 值校验 issue path = 绝对路径（ROOT 起）= 边界前缀 ++ 相对路径，含截断标记；
- D6 守卫拒绝恰 1 条 issue（first-failure）；全收集语义只属值校验段（共享解释器）；
- D7 段类型严格：map/Record 位只收 string 段、array 位只收整数 number 段，拒绝一切静默 coerce；
- D8 穿越 Record 时存量键 Pattern 不复检（「可信文档」模型）；新键由规则 2 的 Record 级重建覆盖；
- D9 空 path / undefined 值 / 非对象 base → 拒绝（结果返回，不抛错）；
- D10 optional 字段写入合法（optional 是值级在场语义，非结构存在性）；
- D11 字段清除（写 undefined）v1 无此操作，一律拒绝（清除语义留 PRD 层）；
- D12 `derived.index` 零消费（语法路径键空间 ≠ 运行时路径；不复活三级前缀匹配）。

### 3. 守卫拒绝矩阵（设计 §3.2，冻结措辞见原文）

- 终态三行：leaf / plain / xml-fragment 一律拒绝下钻（plain 只能整体替换 = ADR-0004 D1；xml-fragment = ADR-0003 §5，前置观察②落实位）；
- 越界行：终段替换下标 ≥ len 拒绝（D1「越界归运行时」）；段类型行：map/Record 位收 number 段拒绝、array 位收非整数段拒绝；
- 中间位 base 缺失/类型不符拒绝（字段级写入不自动创建中间容器）；
- 守卫一切拒绝恰 1 条 issue、path = 完整尝试路径。

### 4. resolve 收敛形态（设计 §4，前置门禁「观察 3」的落地）

- **一算法 + 三透镜**：`resolve.ts` 新增泛型核心 `walkRefChain<T>`（包内导出，不进公共面）——全仓 while 循环算法恰一份；IR（resolveChain 内部委托）/ 值树（resolveValues 内部委托）/ 结构树（validate-patch.ts 新增透镜）三个参数化透镜，报错文案经透镜工厂逐字节还原；
- `validate.ts` 抽取共享 `interpret()` 主体：`validateSnapshot` 与内部导出 `validateSubtree`（不进 index.ts 公共面，唯一 caller = validate-patch.ts）单一来源；`validateSnapshot` 可观测行为（消息/顺序/上限/E100）**逐字节零变化**，既有测试文件零改动全绿为硬验收；
- `resolveChain` 对外签名与报错不变，`evaluate.ts` 零改动；
- 弃案（SA3 不得采用）：值树走 IR 解析器 / 派生物内联展开 ref（违反 ADR-0003 §4 + 触形状红线）/ 保留双份另写第三份循环。

### 5. 文件范围（设计 §8）

- ALLOW：`validate-patch.ts`（新建）、`validate.ts` / `resolve.ts` / `index.ts`（修改，纯增量）、`test/validate-patch.test.ts`（SA6 owned，断言冻结）；
- DENY：`evaluate.ts` / `derived.ts` / `shapes.ts` / `ir.ts` / `parser.ts` / `semantic.ts` / `tokenizer.ts` / `pattern.ts` / `xml.ts` / `errors.ts` / `schemasource.ts`、`test/` 下既有测试文件、`vfsl-codegen/**`、`vfsl-protocol/**`、`domains/**`、`docs/**`、`.github/**`、根配置。

### 6. 工程纪律（设计 §3.5/§3.6，SA3 注意事项）

- 重建一律计算键展开（`{ ...o, [k]: v }`）或 `Object.defineProperty`，禁 `__proto__` 字面与点赋值；读取侧 `Object.hasOwn` 守卫（原型污染防护）；
- 全程顶层 try/catch：任何内部异常收编为单条 E100 结果（loud ok:false，无静默降级路径）；
- `value === undefined` 一律拒绝（present() 语义下等同缺席，写入制造幽灵键）。
