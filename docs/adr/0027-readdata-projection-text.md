# ADR 0027：readData 投影文本化——投影通道的交付换代

日期：2026-09-14（设计敲定：本仓 grill 会话，追踪 issue 见文内）
状态：已接受（影响包 `@nomicore/vfsl`、`@nomicore/namespace-runtime`、`@nomicore/namespace-registry`）；决策 1 的「options 闭合形状零变化」句由 [ADR-0031](0031-readdata-byte-budget.md) 再修订（+`maxBytes` 预算轴，三键闭合）——头行、✂ 段与渲染器条款不动

## 背景

ADR 0016 交付的语义 schema 投影是 JSON 四件套（valueSchema / aliases / docs / aliasDocs），ADR 0024 为其加上了同预算截断与投影层截断标记。实测（issue #359 后续讨论，mabf-center `tasks/<TaskKey>`）暴露出**编码密度问题**：

- 整读的 schema 通道 45.8KB vs 值通道 1.2KB（38 倍）；其中 docs 散文 25KB 是不可压缩的大头，结构包装（`"kind":`×249、`"name":`×239、`"value":`×193）与 docs 键路径重复（245 键键名合计 5.7KB）是纯句法噪音；
- 预算读下逐字段截断标记 `{kind:'truncated', clue:{via:'ref', name:X}}` 约 90B 表达「X→Y」（约 15B 信息），单条密度约 29%；
- 瓶颈不是数据模型而是**编码错配**：JSON 命名键树是给「按 kind 判别、按名索引」的程序读者的随机访问格式；把投影塞进模型上下文（DSH L2 会话级只读工具）的消费方是**顺序阅读者**，对词表重复零容忍。

判断：痛点集中在渲染边界（投影 → 模型上下文），该边界的正确编码是**确定性文本**。本 ADR 把投影通道的**交付形态**从 JSON 换成文本，语义面（resolver、docs 文法、切片规则）不动。

## 决策

### 1. readData 投影通道无条件文本化

- 成功分支**恒四键** `{ ok, value, schema, truncated }`：`schema` 位 = **投影文本**（string）或 `null`；
- `truncated` 布尔保留——机器可判「本次读发生过裁剪」的最低信号；
- 结构化 `truncations` 键**删除**：截断事实的唯一载体 = 投影文本内的 **✂ 段**（规范性文法，见决策 3）；「键缺席 vs 被裁」的消歧以 ✂ 段为准；
- `options` 闭合形状 `{ depth?, maxChildrenPerNode? }` **零变化**（预算单一权威与三层透传不动），无第三参、无呈现键；
- 失败分支形状与语义不动；`schema: null` 单义不变（无 active schema / 路径偏离 / 敌意 path——null 直通，不渲染、不是空串）；
- **单 API**：不设姊妹方法、不设双通道——JSON 投影四件套从公共读面退役。

### 2. 投影文本渲染器（`@nomicore/vfsl` 公共导出）

- `renderProjectionText(projection, truncations?)`：**零选项纯函数**、同步、逐字节确定；`truncations` 在场则渲染 ✂ 段；
- 输入类型 = `ReadDataSchemaProjection` 系（**保留为公共类型**——它们仍是 `resolveSchemaAtPath` 的输出契约与渲染器入参契约；vfsl 包面零破坏）；
- 文本组装序：readData 组合层**前贴头行**（实参 path + 预算，防伪造的事实锚）→ 渲染器正文 → ✂ 段；头行格式属规范文法；
- 口径策略**恒 first-line**（多行注释取首行 + `…`）——无 `full` / `skip-members` 选项（API 极简优先；全文口径从公共读面不可达，已知限制 1）。

### 3. 文法规格（规范性，快照锚定）

- 字段行：`名?: 类型 // 口径首行…`——`?` 可选、`T[]` 数组、ref 直写别名名；
- **可见性切片延续 ADR 0024 #359 amendment**：已渲染宿主的槽位（字段 / `<item>` / `<member N>` / `<key>`）docs 全部在场；被截位以 `‡` 标记（页脚一行解释），容器线索无名时如实 `[...]‡`，不编造；
- 标量域**照抄 VFSL 源文法**：`Int<1, 9999999999>`、`Range<0, 100>`、`Pattern<"…">`、enum `"a" | "b"`（` | ` 分隔，超 100 列折行缩进续行）；
- Record / union 照源文法：`Record<string, T>` + 行尾 keyPattern 注释；union `| { … }` 不特判判别式；
- 别名块 = 闭包发现序（与 resolver aliases 键序同源）；
- docs 文本防御：注释内换行折叠为空格、注释文本永不破坏文法结构（first-line 规则天然截断多行）；
- 头行 `# readData [<path>] {depth:N}` 与 ✂ 段（路径 / 裁因 / omitted 计数）为规范文法——✂ 段承担截断事实契约职责。

### 4. namespace-runtime 组合层

- 投影 **detach 深拷贝层退役**：渲染器进程内直读 resolver 产物，文本天然 detached（隔离不变量由渲染结果形态保证）；
- readData 结果类型坍缩为**单一四键形**（预算 / legacy 双结果联合消失）；
- registry lease 类型别名跟随，透传零语义变化。

### 5. 契约与发布

- **破坏性 minor bump**（先例：#338 三键→五键；消费方可枚举——仓内测试与 DSH 部署链，0.x 无跨 minor 稳定承诺）；
- DSH 探针工具（原样透传读结果的会话级工具）**零代码改动**，输出形态随包升级自然变化。

## 对既有 ADR 的修订

- **ADR 0016**：交付条款被取代——投影体四件套不再经 readData 交付（投影文本取代）；「每次读投影深拷贝」条款退役（决策 4）。三元组动机（读 = 值 + 语义 + 口径）、always-on、`schema:null` 单义、resolver 条款（解析语义、docs 锚定文法、ADR 0019/0024 对其的修订）**原文延续**——它们描述的语义面是渲染器的输入契约。
- **ADR 0024**：决策 4 的恒五键条款再修订为**恒四键**（`truncations` 键删除，截断事实载体 = 投影文本 ✂ 段）；决策 1/2/3/5/6/7 及 #359 amendment 的语义（预算、折叠、标记、切片）在渲染器输入侧**不变**；决策 3 的「截断清单」通道条款由 ✂ 段条款取代。

## 已知限制（主动登记）

1. **公开无损通道没有了**：JSON 投影与全文 docs 从公共读面不可达（`resolveSchemaAtPath` 虽公共，其入参 `derived` 不出公共面）。程序化结构消费由仓内经 resolver 直达；外部若有此需求，未来以加法演进（如投影读取专用 API），单独评估。
2. **`schema: null` × 预算读的键级消歧失效**：文本不存在时截断事实仅剩 `truncated: true` 布尔；要消歧 → 无预算重读。
3. **marker container 线索不带元素类型名**（ADR 0024 决策 5 冻结面）：紧凑文法如实呈现 `[...]‡`，不编造名字。

## 备选（已否决）

- **姊妹方法 `readDataText` 双 API 并存**：JSON 路径保留给机器消费方——被产品方向否决（单 API，消费方可枚举且 LLM-first）。
- **六键恒形双通道**（schema JSON + schemaText 同场）：主消费路径每次读白付 JSON 物化与深拷贝，契约更胖。
- **options 加 `format` 呈现轴**：破坏预算闭合形状的三层贯通与单一权威校验；结果形状随参数分叉，撞 ADR 0016 立约。
- **`RenderProjectionOptions` 选项对象**（docs 策略 / meta 注入）：API 复杂度被否决——first-line 升格唯一行为，头行改由组合层前贴。
- **wire 层紧凑化**（marker 字符串化 / 紧凑 JSON）：动 ADR 0003/0024 冻结面，收益只在传输层，且判别性受损。
- **渲染器住独立叶包 / namespace-runtime**：文法权威单源在 vfsl（resolver、docs 文法、切片规则同包）。
- **值域 docs 随行 / value-aware 渲染**：前者已在 #359 否决（投影膨胀）；后者破坏渲染器纯函数性。

## 验收

- **缝 1（vfsl 公共入口）**：`renderProjectionText` 经 index 导出——文法快照冻结（逐字节）、确定性（同输入同输出）、first-line 口径、`‡`/`✂` 呈现、敌意 docs 文本防御、零选项签名；夹具沿用预算夹具家族（evaluate 产物 + 手造派生物）；
- **缝 2（readData 公共面）**：恒四键形；`schema` 文本 ≡ `renderProjectionText(resolveSchemaAtPath(…))` 一致性锚（渲染器与组合层不漂移）；头行拼接；`null` 单义与失败分支；options 闭合形状零变化回归；truncated 布尔与 ✂ 段的一致性；
- **缝 3（文档负控）**：作用域文档词汇重录——四件套交付 / 恒五键旧词汇清退，投影文本词汇在场；
- 全套门禁 + root `pnpm typecheck` / `pnpm test`；发布随破坏性 minor bump。

## 开放问题

- **schema 文本缓存**（内容哈希 / 语义指纹上读面）：消费侧内容哈希先扛，实测重复读痛点再议；
- **marker 紧凑表示**：ADR 0024 已登记，继续挂起（渲染后传输冗余已被文本化吸收，优先级降低）；
- **value-aware 渲染**（当前值高亮）：渲染器保持 schema 纯函数，需求实证再议。
