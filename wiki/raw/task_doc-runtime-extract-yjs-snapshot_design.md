# SA1 设计 — 建立 @nomicore/doc-runtime 并实现 extractYjsSnapshot(derived, doc)（Issue #73）

- 任务：功能开发（Feature）· 新建 workspace 包 `@nomicore/doc-runtime`，实现 `extractYjsSnapshot(derived, doc)`——只读固定 ROOT，严格区分 Yjs 载体，fail-fast 单 issue，成功返回普通 logical ROOT snapshot
- 依据：任务简报 `wiki/raw/task_doc-runtime-extract-yjs-snapshot.md`（含 SA6 冻结契约与红灯记录）；`task_doc-runtime-extract-yjs-snapshot_relevant_decisions.md`（ADR-0001…0007 摘录，ADR-0007 为直接依据）；`task_doc-runtime-extract-yjs-snapshot_conflict_report.md`（SA8 前置门禁 verdict: clear / 0 冲突点）；SA6 红灯测试 `packages/doc-runtime/test/extract-yjs-snapshot.test.ts`（21 用例 10 组，构造性红灯：`Cannot find module '../src/index.js'`）
- 状态：**R2.1（SA2 R2 复审 pass 后的文档 touch-up，零机制变更）** · 2026-08-22 · SA1。评审历史：R1 reject（`task_doc-runtime-extract-yjs-snapshot_sa2_review.md`——2 CRITICAL / 3 MAJOR / 3 MINOR，R2 逐条落实）；R2 复审 **pass**（设计定稿，遗留 R-1/R-2 两项 MINOR 文档 touch-up，本版完成——见文末回应表 R2.1 节）；SA2 附录 B/C 实测证据（A1–E2/N1–N4/Q1–Q5b）已并入 §9 依据表
- 冻结接缝（本设计不收窄、只落实）：SA6 测试锚定的 `extractYjsSnapshot(derived: DerivedSchema, doc: Y.Doc)` 经 `packages/doc-runtime/src/index.ts` 导出；`{ ok, issues }` 结果联合；`ExtractIssue` 四字段与 expected/actual 五值词汇表

---

## 摘要（一页看懂）

`extractYjsSnapshot` 是**结构树（`derived.structure` + `derived.aliases`）的第一个运行时消费者**：一个同步、不抛错的解释器，把 live `Y.Doc` 的固定 ROOT 条目按结构树逐节点做**载体验证 + 逻辑值提取**。核心机制五件：

1. **ROOT 探针（§4.2）**：`doc.getMap('ROOT')` → `getArray` → `getXmlFragment` → `getText` 四级 try/catch 级联探针（设计期实测 yjs@13.6.32：异型构造函数全部抛同一句 "already been defined with a different constructor"，探针收敛为 `path: []` 单 issue，绝不外抛——SA6 冻结契约 T1/T2 锚点）；ROOT 缺席时 `getMap` 惰性创建空 map（实测 0 个 update 事件，update 层面零副作用）。
2. **节点遍历全景表（§4.3）**：8 种结构树节点 × 期望载体 × 快照产出。map/Record → `Y.Map`、array → `Y.Array`、xml-fragment → `Y.XmlFragment`（快照值 = `toString()` XML 字符串投影）、leaf/plain → `plain value`（不可下钻终态）。**缺失字段与未知键一律不报不进快照**（ADR-0007「ROOT 载体提取和逻辑校验」两步分离；属 validateLogicalSnapshot 逻辑域）。
3. **union 试验语义（§4.5）**：判别式**结构树提取永不读取**（`node.discriminator` 对提取器是死数据）——成员按声明序做「试验提取」，**第一步恒为成员根载体前置判定**（R2/#5：live 值对成员根的载体不匹配 → 拒 + 真 issue，杜绝 TypeError→E100 误分类与全可选成员裸接受）；Record 形成员**无缺失概念、试验 = 直接 walk**（R2/#1：`'<key>'` 是字面段名，按「缺必填」字面实现会恒软拒、违反 any-of）。试验三结局（接受 / 真 issue / 软拒=缺必填），首个接受者胜；全拒时按声明序报首个真 issue，全软拒时回退成员 0。这使 ADR-0003「缓存的缺失/存在不得改变任何可观测行为」成为**构造性事实**而非约定。
4. **plain 值深拷贝（§4.6）**：实测 yjs 对 plain 值 `get()` 返回**原引用**（非解码副本），故快照必须显式深拷贝才能兑现 AC4 解耦；拷贝器强制 JSON 值域断言——**原型守卫**（Date/类实例 → 真 issue，R2/#3 禁静默投影 `{}`）、bigint/数组内 undefined → 真 issue（R2/#2 实测可达、含跨端传播）、`__proto__` own-key 经 defineProperty 安全拷贝（R2/#8）——兑现冻结契约「snapshot 无 Yjs 对象泄漏」；违规 actual 词表并入 D9 家族偏离申报（R2/#4）。
5. **崩溃边界（§4.8）**：全函数体顶层 try/catch → `DOCRT-E100` 结构化返回（对齐 vfsl `parseVfsl`/`evaluate`/`validateLogicalSnapshot` 三接缝同款纪律）；可达性表按 SA2 实证口径重写（R2/#2：bigint/Date 为**可达真 issue 路径**而非 E100）。

包布局（§3）：`src/carrier.ts`（载体判定 + ROOT 探针）+ `src/extract.ts`（遍历器 + 公共接缝 + 崩溃边界）+ `src/index.ts`（公共面 re-export）；`tsconfig.json` 新建并入根 `pnpm typecheck`（AC5）；CI 零改动（node 20/24 matrix 与 `pnpm test` include 模式既有覆盖，§7）。

### 决策总表

| # | 决策 | 一句话理由 | 被否方案 |
|---|---|---|---|
| D1 | 载体判定 = **两层**：粗判 `carrierOf`（`instanceof` 四连 → 词汇表名；`instanceof Y.AbstractType` 兜底 → 不可达态崩溃边界；**bigint/Date/一切非 Y 对象 → 'plain value'**）+ 细判由 copyPlainValue 的 JSON 值域断言承担（R2/#2/#3） | 实测（P5/P5c/P8/P22/Q1/Q2）四类 instanceof 全覆盖且 `Y.AbstractType` 公共导出；XmlElement 经 `instanceof Y.XmlFragment` 命中（Q2：YXmlElement extends YXmlFragment）；粗判保持五值词汇表纯净，细粒度违规（bigint/类实例）在 plain 域内产真 issue | `constructor.name` 字符串（脆于压缩/子类化）；`toJSON` 探测（实测 P19：toJSON 抹平载体信息，恰是要防的信息丢失）；carrierOf 把 bigint 归为 null/不可达（R1 原案——SA2 A1/E1 实测**可达且跨端传播**，误分类 E100 误导排障） |
| D2 | ROOT 载体 = 四级 getter 探针级联，**不读 `doc.share`** | SA6 冻结契约明文锚定「getMap 原生 throw 必须收敛」；探针只用公共 API；次级探针仅在 ROOT 确已存在（首探针已抛）时执行，无创建副作用（P1b/P2c/P3d） | `doc.share.get('ROOT')` 内部注册表（非公共 API，且绕开 SA6 锚定的 throw 收敛路径）；try/catch 解析错误文本（脆，依赖 yjs 报错文案） |
| D3 | ROOT 缺席 → `getMap('ROOT')` 惰性空 map，snapshot `{}` / 空字段 | SA6 冻结契约「ROOT 缺失按空 map，不外抛」；实测创建不触发任何 update 事件（P4：0 events、toJSON 出现 `ROOT:{}` 但 state 层零内容） | 视缺席为错误（冻结契约明文反对）；用 `doc.share.has` 预检避开创建（同 D2 被否理由） |
| D4 | 缺失字段（required 与 optional 同等）与未知键：**不报、不下钻、不进快照** | SA6 冻结契约「缺失字段不报结构错……缺失/未知键属 validateLogicalSnapshot 逻辑域」；`get() === undefined` 视同缺席（对齐 validate.ts:159 `present()` 冻结惯例，P16 实测 set(k,undefined) → has/get 语义） | 提取期报缺失/未知键（越权逻辑域，破坏两步分离）；把 undefined 值拷进快照（破坏 JSON 往返断言） |
| D5 | union 试验语义：**第一步成员根载体前置判定**（R2/#5）→ Record 形成员特例（试验 = 直接 walk，键集即在场集，R2/#1）→ 封闭 map 形字段声明序扫描（缺必填置软标记）；三结局（接受 / 真 issue / 软拒），首个接受者胜；全拒 → 首个真 issue；全软拒 → 回退成员 0 | any-of（ADR-0003）+ 提取期容忍缺失（D4）的合取必然产物：缺失容忍使成员选择欠定，必须确定性仲裁；前置判定杜绝「live 非 Y.Map 时调 map API → TypeError → E100」与「全可选成员裸接受」两个病态（SA2 #5）；Record 的 `'<key>'` 是**字面段名**（evaluate.ts:107 `optional:false`），按缺必填字面实现会恒软拒 Record 成员（SA2 B-3 实证反例）；全软拒回退保证「结构不裁决时不吞掉逻辑校验素材」 | **判别式主选（被否——核心论证见 §4.5.3）**：kind 值属值语义（leaf 节点不携带字面量），判别式主选使 `node.discriminator` 缺失/存在改变可观测输出，直接违反 ADR-0003 判别式缓存条款；**无前置判定的字段序直扫（R1 原案，被否——SA2 #5：载体病态两例）** |
| D6 | 快照 plain 值 = **显式深拷贝 + JSON 值域断言 + 原型守卫 + own-key 安全写入**（R2/#3/#8：普通对象仅 `proto === Object.prototype \|\| null` 放行，Date/类实例 → 真 issue；键一律 defineProperty 写入，`__proto__` own-key 不落原型） | 实测 P15/P15b：yjs 对 plain 值 `get()` 返回原引用（含嵌套），浅引用即快照泄漏 live 状态（AC4 解耦红灯）；P22：plain 数组可内嵌 Y.Map；C1/C2：Date 可存可读且 `Object.keys` 投影为 `{}`——静默投影 = 数据语义蒸发的伪降级；Q3/Q4：defineProperty own-key + JSON 往返无损 | 直接引用（解耦红灯）；`structuredClone`（Y 类型抛 DataCloneError 且不区分错位类型）；`JSON.parse(JSON.stringify())`（undefined→null 静默规范化，违 loud 纪律）；Date 静默投影 `{}`（R1 原案隐含行为——SA2 #3 伪降级否决） |
| D7 | XML 快照值 = `Y.XmlFragment.toString()` | 实测 P6/P6b：与 `toJSON()` 投影一致输出 `<p>Hello <b>world</b></p>`；属性保留（P21）；ADR-0003「JSON 快照中其值为 XML 字符串（与 Y.XmlFragment.toJSON() 投影一致）」 | 自研 XML 序列化器（重复造 yjs 已有投影；语义等价锚只要求结构与文本一致，yjs 投影天然满足） |
| D8 | 结构树 ref 解析：包内迭代链走查（`derived.aliases`）+ inFlight 环守卫 + 每调用 memo | ADR-0003「ref 不内联展开，解析动作由共享解析器完成」——但 vfsl 的 resolve.ts 是包内部件（index.ts 不导出），doc-runtime 只能基于公共数据 `derived.aliases` 自建同款 while 循环（镜像 walkRefChain 语义） | 给 vfsl 公共面新增解析器导出（本任务不许动 vfsl，AC1）；递归无环守卫（手造派生物成环 → 栈溢出绕过崩溃边界的可观测性） |
| D9 | **词汇表偏离家族统一申报（R2/#4 收编 SA8 note-5 裁决；R2.1/R-2 改判 function/symbol 归组）**：① E100 崩溃边界 `expected/actual = 'internal'`；② plain 域违规 issue：`expected` 恒词汇表内 `'plain value'`，`actual` 用申报词——可达：`'bigint'`（A1/D2/E1）/ `'undefined'`（D1 数组元素）/ `'non-plain object'`（C1 Date/类实例，message 附 constructor 名）/ **`'function'` / `'symbol'`（N1–N3 plain 子树内嵌路由可达；直接位 A2/A3 set 期即抛不可达——R2.1 改判入可达组）**。全部偏离报 SA4 复核（§10 登记） | 不抛错纪律（与 vfsl 三接缝同源）要求 catch-all 必须产出四字段 issue；SA6 冻结词汇表辖域 = 结构错位（expected 侧保持纯净），actual 侧扩展是**真实可观测输出**，按「设计如需偏离必须显式说明并由 SA4 复核」纪律必须申报——R1 只申报 'internal' 而 §4.6 散落代码注释零申报属同仓两种纪律（SA2 #4）；R2 原按「直接位不可达」把 function/symbol 归防御组，SA2 复审 N1–N3 实证内嵌可达、其词为可达可观测输出——改判入可达组（机制行为不变：尾分支真 issue + 词已申报） | expected/actual 用词汇表值冒充（不诚实）；省略字段（违约四字段形状）；不申报（SA8 note-5 明示否决）；function/symbol 维持「不可达防御」归类（R2 原案——SA2 N1–N3 证伪，可达输出必须入申报组） |
| D10 | 提取器**零消费** `derived.values` / `derived.index` / `derived.aliasDocs` 等值域与文档域 | 两树正交纪律（镜像 validate.ts:4-6「结构树本文件零消费」的对称声明：extract 是结构树的第一个消费者，值域零消费）；SCHEMA/META 零接触（AC「只读取固定 ROOT」） | 借值树做成员选择（越域 + 引入 D5 已否决的判别式问题） |
| D11 | v1 无显式工作预算，论证 + 登记为已知界 | 遍历深度 ≤ 结构树深度 ≤ `MAX_TYPE_NESTING = 100`（vfsl parser.ts:24）；union 试验成本受 fail-fast 与接受短路约束（§8 分析）；validateLogicalSnapshot 拥有 2×10⁸ 预算先例但那是全收集语义的需求，fail-fast 单 issue 快路径无对应攻击面 | 引入 WORK_LIMIT（无锚定攻击面；增加一个 SA6 未冻结的失败形态） |
| D12 | `WalkResult` 恒**两结局**（`value \| issue`）——R1 的 `'undetermined'` 第三结局**删除**（R2/#7）：walkUnion 出口 3（全软拒回退）内联消化为 value/issue，永不向上传播（§4.5.4 终止论证） | R1 自己论证了 undetermined 永不逃逸 walkUnion 却保留三结局 + map/array 通路四个防御分支——规格噪音诱导 SA3 实现并测试「永不发生」的分支（SA2 #7）；删除后类型即不变式 | 保留三结局 + 三处「不可达防御」标注（SA2 给出的另一选项——不如直接删除：类型系统替注释承担不变式） |

---

## §1. 背景、授权链与现状盘点

### 1.1 ADR 授权链（设计必须遵守的约束基准，摘自 relevant_decisions）

| ADR 条款 | 对本设计的约束 | 落位 |
|---|---|---|
| ADR-0007「新包 `@nomicore/doc-runtime` 依赖 `@nomicore/vfsl + yjs`」`vfsl 继续保持无 Yjs 依赖；持久层继续不理解 VFSL` | 包依赖图方向冻结（AC1） | §3.2 / §8 边界 |
| ADR-0007「`extractYjsSnapshot(derived, doc)`：只读取固定 ROOT，严格验证实际 Yjs 载体并提取普通逻辑 ROOT；首个结构错误立即停止，不读取或验证 SCHEMA/META」 | 功能定义本体 | §4 全节 / §5 用例映射 |
| ADR-0007「路径统一为 `readonly (string \| number)[]`：map/object/Record 用 string，Y.Array 用 number；禁止点号字符串与 JSON Pointer。leaf、plain、XML 是不可下钻终态」 | issue.path 构造纪律 | §4.3 / §4.7 |
| ADR-0007「XML string 与 Y.XmlFragment 只承诺语义等价 round-trip」 | XML 快照只承诺语义等价（AC4） | D7 |
| ADR-0007「底层能力各自保留领域化结果联合……Yjs 结构与路径/操作错误 fail-fast」 | `{ ok, issues }` + 单 issue | §3.1 |
| ADR-0007「`validateLogicalSnapshot`……只接受普通 JSON logical ROOT snapshot，不接受 Y.Doc/Y.Map/Y.Array」 | 两步分离：extract（载体→逻辑值）→ validateLogicalSnapshot（值语义）；缺失/未知键属后者 | D4 |
| ADR-0007「YArray 与 plain array 的逻辑值相同，但实际 Yjs 载体仍被严格区分」 | array 节点 vs plain 节点两个错位方向的测试锚 | §4.3 全景表 |
| ADR-0003 根指定（ROOT 恒 map 形、物化 `doc.getMap('ROOT')`） | ROOT 期望载体恒 `'Y.Map'`（即使 ROOT 是全 map 形联合） | D2 / §4.2 |
| ADR-0003 联合 any-of + 「判别式缓存：缺失/存在不得改变任何可观测行为（含错误输出）」 | union 成员选择的确定性 + 判别式死数据化 | D5 / §4.5.3 |
| ADR-0003 ref 按名引用不内联 + 遍历经共享解析器 | 结构树 ref 节点的解析动作 | D8 |
| ADR-0003 xml-fragment 终态：无 children、JSON 快照值为 XML 字符串 | xml-fragment 节点不遍历实参（实参在求值期已整体丢弃，evaluate.ts:131） | §4.3 |
| ADR-0006 doc 三条目布局（SCHEMA/META 与 ROOT 兄弟、校验只作用 ROOT 子树） | 只触碰 `'ROOT'` 名字空间 | D2 / §4.2 |
| ADR-0005「`packages/` = 可复用库」 | 新包落位 `packages/doc-runtime` | §3.1 |
| ADR-0001 纯引擎仓库（schema 文本仅测试 fixture） | 实现零 schema 文本；fixture 已在 SA6 测试内 | 全文 |
| ADR-0002 authority 出范围 | 提取器零值语义裁决（不查枚举/范围/Pattern）——`keyPattern`、字面量判别字段全部不读 | D4 / D10 |
| ADR-0004 协议包零运行时 | doc-runtime 不动 vfsl-protocol | §8 DENY |

### 1.2 代码现状（全部已读）

- **`packages/doc-runtime/`**：SA6 脚手架已就位——`package.json`（name/version/private/type/exports `"." → "./src/index.ts"`、deps `@nomicore/vfsl: workspace:*` + `yjs: ^13.6.30`、devDeps typescript/vitest/@types/node、`typecheck` script）与 `test/extract-yjs-snapshot.test.ts`（21 用例）。**`src/` 不存在**（构造性红灯成因）、`tsconfig.json` 不存在（SA3 交付物，AC5）。
- **`pnpm-lock.yaml:36`**：`packages/doc-runtime` importer 已登记（SA6 更新，CI `--frozen-lockfile` 可用）。
- **结构树形状**（`packages/vfsl/src/derived.ts:26-41`）：`StructureNode = root | map{fields} | array{element} | xml-fragment | leaf | plain | union{members, discriminator?} | ref{name}`；`MapField{name, optional, node}`，Record 的动态键段固定名 `'<key>'`。**求值器已把无子终态 ref 内联**（evaluate.ts:89-93 决策 F4：链终点为 plain/leaf/xml-fragment → 直接产出终态节点），结构形 ref 保持按名终态——提取器遇到的 ref 节点解析目标恒为 map/array/union（含嵌套 ref 的 aliases 条目，D8 链走查处理）。
- **ROOT 入口形状**（evaluate.ts:56-58）：`derived.structure = { kind:'root', node: structureOf(resolveChain(ROOT 体)) }`——内层节点已物化（map / 全 map 形 union），**顶层不可能是 ref**。
- **值树零消费先例**（validate.ts:4-6 头注）：结构树在 validate.ts 零消费；本设计是其镜像（D10）。
- **根 `package.json:13` typecheck**：五个既有包的 `tsc -p` 串联——追加 doc-runtime（§7）。
- **`vitest.config.ts:6`**：include `packages/*/test/**/*.test.ts` → 新包测试自动入 CI `pnpm test`；typecheck include（`*.test-d.ts`）+ `tsconfig.typecheck.json`（含 `packages/*/src/**`）均模式化覆盖。
- **`.github/workflows/ci.yml:17-19,38-39`**：node 20/24 matrix + `pnpm typecheck` + `pnpm test`——零改动（AC5）。
- **依赖边界现状**：`packages/persistence/package.json` / `dsh-persistence` 均无 vfsl/doc-runtime 依赖（grep 实证）；vfsl 无 yjs 依赖。AC1 边界初始即成立，本任务只需**不破坏**。

### 1.3 SA6 冻结契约（设计的行为锚点，逐条编号供 §5 引用）

| # | 冻结条款 | 出处（测试文件） |
|---|---|---|
| F1 | 接缝 `extractYjsSnapshot(derived: DerivedSchema, doc: Y.Doc)` 经 `../src/index.js` 导出 | :24-26 / :61 |
| F2 | `{ ok: true; snapshot: unknown } \| { ok: false; issues: ExtractIssue[] }`；fail-fast = `issues.length === 1` | :28-29 / :91-103 |
| F3 | `ExtractIssue = { message; path: Array<string\|number>; expected; actual }`；path 段 map/object/Record=string、Y.Array=number、`[]`=ROOT | :30-31 / :66-74 |
| F4 | 词汇表冻结：`'Y.Map'/'Y.Array'/'Y.XmlFragment'/'Y.Text'/'plain value'`；root/map→Y.Map、array→Y.Array、xml-fragment→Y.XmlFragment、leaf/plain→plain value | :32-36 |
| F5 | yjs 异型 ROOT 的 `getMap` 原生 throw 必须收敛为 `{ok:false, issues:[单条]}`，绝不外抛 | :38-41 / :303-315 |
| F6 | 缺失字段不报结构错；缺 optional → 快照省略；ROOT 缺失按空 map | :35-36 / :525-530 |
| F7 | XML 快照值为字符串、归一化语义等价（非逐字）；message 仅要求非空 | :121-125 / :487-494 |
| F8 | success 分支 snapshot 必须普通 JSON（`JSON.parse(JSON.stringify(s))` 全等，无 Yjs 泄漏） | :280-281 |
| F9 | 解耦：提取后突变 live doc → snapshot 不变 | :284-299 |
| F10 | SCHEMA/META 垃圾不读不验证 | :514-523 |

## §2. 需求推演（Feature 切入点）

**问题形状**：ADR-0007 把「打开一个命名空间文档」拆成两个正交相位——载体相位（live Yjs 载体 → 普通 JSON 逻辑值，**本任务**）与逻辑相位（JSON 值 → 值语义裁决，validateLogicalSnapshot 既有）。两相位的输入输出恰好咬合：extract 的 `snapshot` 是 validateLogicalSnapshot 的入参。这一咬合决定了 extract 的语义边界——**它裁决且仅裁决「载体」**：每个结构树节点声明一种期望载体，live 端每个位置有一种实际载体，二者对不上就是结构错位；至于「值对不对」（类型、枚举、Pattern、必填缺席、未知键），一概不碰（D4/D10，ADR-0002 authority 出范围的远亲条款同样禁止越权）。

**切入点**：结构树至今没有运行时消费者（validate-patch 是第一个但属写入校验域）。extract 是结构树解释器，与 validate.ts 是值树解释器形成对称——同一份 `DerivedSchema`，两棵树，两个解释器，两个领域化结果联合（ADR-0007「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型」）。新包 `@nomicore/doc-runtime` 是唯一正确的落点：它必须同时看到 `DerivedSchema`（vfsl）与 `Y.Doc`（yjs）——这两者在依赖图上不允许相遇于任何既有包（AC1）。

**必须成立的不变式**（推导自 AC + ADR + 冻结契约，后文逐条落位）：

| # | 不变式 | 落位 |
|---|---|---|
| INV-1 | ok:true ⇒ snapshot 是纯 JSON 值（`JSON.stringify` 往返全等，零 Yjs 引用） | D6 深拷贝 + JSON 值域断言 |
| INV-2 | ok:true ⇒ snapshot 与 live doc 完全解耦（此后任意 live 突变不影响 snapshot） | D6（P15 实测 yjs 返回原引用 ⇒ 拷贝强制）+ D7（XML 每次现算字符串） |
| INV-3 | ok:false ⇒ `issues.length === 1` 且 path/expected/actual 精确锚定首个错位节点，错误节点不继续下钻 | §4.3 全景表每行的「错位行为」列 + fail-fast 传播 |
| INV-4 | 提取器输出与 `node.discriminator` 的存在/缺失无关 | D5：提取器不读取该字段（构造性保证） |
| INV-5 | 除惰性创建空 ROOT map（零 update 事件）外，doc 与 derived 双双零突变 | D2/D3 + 纯只读遍历 |
| INV-6 | 任意输入（含异型 ROOT、手造派生物、对抗深嵌套）不外抛 | §4.8 崩溃边界 |
| INV-7 | `SCHEMA` / `META` 名字空间零接触 | D2 探针只碰 `'ROOT'` |
| INV-8 | 同一 (derived, doc) 输入 ⇒ 逐字节相同输出（确定性：无时间/随机/全局态/迭代序依赖） | §4.9 迭代序冻结（字段声明序 / keys 插入序 / 下标序 / 成员声明序） |

## §3. 公共契约与包布局

### 3.1 包布局（新包全量交付物）

```
packages/doc-runtime/
├── package.json            # SA6 已就位（不动）
├── tsconfig.json           # 新建：{ "extends": "../../tsconfig.base.json",
│                           #          "include": ["src/**/*.ts", "test/**/*.ts"] }（镜像 vfsl tsconfig）
├── src/
│   ├── index.ts            # 新建（~20 行）：公共面——re-export extractYjsSnapshot + ExtractIssue/ExtractResult
│   ├── carrier.ts          # 新建（~70 行）：CarrierName 词汇表类型 + carrierOf(v) + probeRoot(doc)
│   └── extract.ts          # 新建（~280 行）：遍历器（§4.3–§4.6）+ 公共接缝 + 崩溃边界（§4.8）
└── test/
    └── extract-yjs-snapshot.test.ts  # [SA6 owned] 冻结（SA3 仅可动测试基础设施，禁改断言）
```

公共面（`src/index.ts` 全部内容）：

```ts
export { extractYjsSnapshot } from './extract.js';
export type { ExtractIssue, ExtractResult } from './extract.js';
```

类型定义（`src/extract.ts`，与 SA6 测试 :66-78 本地接口逐字段一致——F2/F3）：

```ts
/** 提取 issue：fail-fast 单 issue（ADR-0007「Yjs 结构错误 fail-fast」）。 */
export interface ExtractIssue {
  message: string;
  /** 段数组：map/object/Record 用 string，Y.Array 用 number；[] 即 ROOT 自身（ADR-0007）。 */
  path: Array<string | number>;
  /** 结构树节点所需载体（词汇表：'Y.Map'|'Y.Array'|'Y.XmlFragment'|'plain value'；崩溃边界为 'internal'，D9）。 */
  expected: string;
  /** doc 实际存储载体（词汇表另含 'Y.Text'；崩溃边界为 'internal'）。 */
  actual: string;
}

export type ExtractResult =
  | { ok: true; snapshot: unknown }
  | { ok: false; issues: ExtractIssue[] };

/** 只读固定 ROOT，严格验证 Yjs 载体并提取普通 logical ROOT snapshot（ADR-0007）。同步、不抛错。 */
export function extractYjsSnapshot(derived: DerivedSchema, doc: Y.Doc): ExtractResult;
```

### 3.2 依赖边界（AC1）

```
@nomicore/doc-runtime ──deps──> @nomicore/vfsl（类型 + 零运行时值导入¹）、yjs
@nomicore/vfsl        ──（零 yjs，现状保持）
@nomicore/persistence ──（零 vfsl / 零 doc-runtime，现状保持）
```
¹ 提取器对 vfsl 只做 `import type { DerivedSchema, StructureNode } from '@nomicore/vfsl'`（类型空间消费，编译后消失）——vfsl 无任何运行时值被 doc-runtime 引入；deps 声明沿用 SA6 脚手架（`workspace:*`），与「依赖 = 编译期类型消费者」的实况一致，不收窄不加宽。

## §4. 实现设计（伪代码）

### 4.1 载体判定（`carrier.ts`）——两层判定（R2/#2/#3 修订）

载体判定分两层，职责互斥：**粗判**（carrierOf）回答「这个值是不是 Yjs 类型、是哪一种」——输出恒为五值词汇表或 null（不可达态）；**细判**（copyPlainValue 的 JSON 值域断言，§4.6）回答「这个 plain 值是否 JSON 值域成员」——产出 D9 申报的扩展词。粗判把 bigint/Date/一切非 Y 对象归入 `'plain value'`，使**结构错位位（map/array/xml）的 actual 永远是词汇表内五值**（如 `set('a', 10n)` 于 map 位 → `expected 'Y.Map' / actual 'plain value'`），细粒度违规只发生在 leaf/plain 终态位并由细判产真 issue——两层合取下无任何可达输入落入 E100 误分类。

```ts
import * as Y from 'yjs';

/** 载体词汇表（SA6 F4 冻结）。'plain value' = 非 Yjs 类型的一切值（粗判口径）。 */
export type CarrierName = 'Y.Map' | 'Y.Array' | 'Y.XmlFragment' | 'Y.Text' | 'plain value';

/**
 * 粗判 live 值的实际载体。返回 null = 不可达态（见 §4.8 可达性表）：
 * - undefined：walk 的缺失检测先行（D4：get()===undefined 视同缺席），到不了载体判定
 * - function / symbol：直接 leaf/plain 位不可达（yjs set 期即抛 "Unexpected content type"，
 *   A2/A3 实测）；但可经 plain 容器（数组元素/对象值）内嵌进入 doc（N1–N3 实测：set 成功、
 *   读回原类型、encode 不抛）——内嵌路由由 copyPlainValue 尾分支捕获（§4.6），本函数对它们
 *   返回 null 即「非载体词可名状」，两路由共用此返回值
 * - Y.AbstractType 家族的第五类变体（四类 instanceof 均不中的 AbstractType 子类）：
 *   公共写入路径造不出（XmlElement 借继承命中 XmlFragment 判别，见下）
 * 调用方对 null 按崩溃边界处理（D9①，loud assert——非静默降级）。
 */
export function carrierOf(v: unknown): CarrierName | null {
  if (v instanceof Y.Map) return 'Y.Map';
  if (v instanceof Y.Array) return 'Y.Array';
  if (v instanceof Y.XmlFragment) return 'Y.XmlFragment';  // XmlElement extends YXmlFragment——Q2 实测命中本行
  if (v instanceof Y.Text) return 'Y.Text';
  if (v instanceof Y.AbstractType) return null;            // Q1：AbstractType 公共导出——第五类变体防御（不可达）
  if (v === null || typeof v === 'string' || typeof v === 'number'
    || typeof v === 'boolean' || typeof v === 'bigint') return 'plain value';  // R2/#2：bigint 归 plain 域
  if (typeof v === 'object') return 'plain value';         // 含 Array / 普通对象 / Date / 类实例 / null-proto——细判在 §4.6
  return null;   // undefined（D4 先行拦截）+ function/symbol（直接位不可达→E100 防御；内嵌路由经 copyPlainValue 尾分支→真 issue，§4.6）
}
```

实测依据：P5（map 值四类 instanceof 全通过 + plain 值白名单通过）、P5c（Y.Text 值）、P8（array 元素）、P22（plain 数组内嵌 Y.Map——细判兜住）、Q1（`typeof Y.AbstractType === 'function'` 公共导出）、Q2（XmlElement 作 map 值：`instanceof Y.XmlFragment === true`，proto 链 `YXmlElement`——借类继承自然归位，无需第五分支）、SA2 A1（bigint 直存可达）、C1（Date 可存可读）。

### 4.2 ROOT 探针（`carrier.ts`，D2/D3）

```ts
export type RootProbe =
  | { carrier: 'Y.Map'; map: Y.Map<unknown> }   // 唯一可继续提取的结局
  | { carrier: 'Y.Array' | 'Y.XmlFragment' | 'Y.Text' }; // 异型：仅报 issue 用
  // 无第四种好结局：全探失败 = 不可达态 → 调用方崩溃边界（D9）

/**
 * 四级探针级联（顺序冻结）：
 * ① getMap  ② getArray  ③ getXmlFragment  ④ getText
 * - ROOT 为 Y.Map（或缺席→惰性创建）：① 命中返回。缺席分支的创建实测零 update 事件（P4）。
 * - ROOT 为异型：① 抛（yjs 原生 throw，F5）→ ②③④ 依次探测；次级探针仅在 ROOT
 *   确已存在时执行（①已抛），返回已存在实例、无创建副作用（P1b/P2c/P3d）。
 */
export function probeRoot(doc: Y.Doc): RootProbe {
  try { return { carrier: 'Y.Map', map: doc.getMap('ROOT') }; } catch { /* ROOT 存在且非 Y.Map */ }
  try { doc.getArray('ROOT'); return { carrier: 'Y.Array' }; } catch { /* 继续 */ }
  try { doc.getXmlFragment('ROOT'); return { carrier: 'Y.XmlFragment' }; } catch { /* 继续 */ }
  try { doc.getText('ROOT'); return { carrier: 'Y.Text' }; } catch { /* 不可达态 */ }
  throw new UnreachableRootCarrier(); // → 崩溃边界 DOCRT-E100（公共 API 造不出第五种 root）
}
```

探针设计要点：
- **级联顺序即语义**：`getMap` 永远第一——它是唯一有「缺席创建」副作用的探针，且缺席创建正是 D3 想要的空 map 语义；后续探针只在「ROOT 确已存在」的前提下运行，零创建。
- **`'ROOT'` 是唯一被触碰的名字**（INV-7）：SCHEMA/META 无论什么垃圾载体，探针与遍历都不会碰（F10 用例的行为根源）。
- yjs 源码依据（node_modules/yjs/dist/yjs.mjs `Doc.get`）：存在性检查 + 构造函数比对 + 抛错文案 `"Type with the name ${name} has already been defined with a different constructor"`——设计不解析该文案（脆），只消费 throw/不 throw 二值（D2 被否方案）。
- ROOT 期望载体恒 `'Y.Map'`（ADR-0003 根指定；即使 ROOT 内层是全 map 形联合，外层载体仍 Y.Map——F4 的 root→'Y.Map' 映射）。

### 4.3 节点遍历全景表（`extract.ts` 核心，唯一分发点）

内部分发函数返回**两结局**（R2/#7：R1 的第三结局 `'undetermined'` 已删除——union 提交层出口 3 内联消化，§4.5.4；「三结局」术语专属成员试验 §4.5.1，勿混淆）：

```ts
type WalkResult =
  | { kind: 'value'; snapshot: unknown }   // 干净提取
  | { kind: 'issue'; issue: ExtractIssue } // 首个真结构错位（fail-fast，携带即止）
```

| 结构树节点 | 期望载体（expected） | live 判定 | 匹配时快照产出 | 错位行为（actual） |
|---|---|---|---|---|
| `root{node}` | `'Y.Map'`（恒定，§4.2） | `probeRoot(doc)` | 递归 `node`，path 起点 `[]` | 探针异型 → 单 issue `path: []`（F5）；不外抛 |
| `map{fields}`（封闭对象） | `'Y.Map'` | `carrierOf` | 新建 `{}`；**按字段声明序**遍历（§4.9）：字段缺席（`!has \|\| get()===undefined`）→ 跳过（D4）；在场 → 递归，段 = 字段名（string） | 非 `'Y.Map'` → 单 issue；**不下钻**（INV-3，AC3「错误节点不继续下钻」） |
| `map{fields}`（Record 形态：单一字段名 `'<key>'`） | `'Y.Map'` | `carrierOf` | 新建 `{}`；**按 `ymap.keys()` 插入序**（§4.9）遍历动态键：值 `undefined` → 跳过（D4）；否则递归 `'<key>'` 字段节点，段 = 动态键（string） | 同上；`keyPattern` **零消费**（ADR-0002：值语义） |
| `array{element}` | `'Y.Array'` | `carrierOf` | 新建 `[]`；按下标 `0..len-1` 递归 element 节点，段 = 下标（number，ADR-0007） | 非 `'Y.Array'`（含 plain JS 数组——错位方向一）→ 单 issue，不下钻 |
| `xml-fragment` | `'Y.XmlFragment'` | `carrierOf` | `live.toString()`（D7：XML 字符串投影；属性保留、自闭合渲染为 `<x></x>`） | 非 `'Y.XmlFragment'`（含 plain XML 字符串——方向：expected Y.XmlFragment/actual plain value）→ 单 issue |
| `leaf` | `'plain value'` | `carrierOf` | `copyPlainValue(live, path, '')`（§4.6 深拷贝 + 值域断言；标量/对象/数组皆可——值类型裁决属逻辑域） | 任一 Yjs 类型 → 单 issue（actual = 各自类型名，含 'Y.Text'）——错位方向二 |
| `plain` | `'plain value'` | `carrierOf` | `copyPlainValue(live, path, '')`（与 leaf 同构——两者在提取语义下不可区分，区别只在写入校验域） | 任一 Yjs 类型 → 单 issue（plain 节点放 Y.Array → expected plain value/actual Y.Array，F4 方向二锚） |
| `union{members, discriminator?}` | 由成员各自声明（union 无自身载体期望；试验语义见 §4.5） | 成员试验 | 接受成员的快照 | 全拒 → 单 issue（§4.5.2 仲裁） |
| `ref{name}` | ——（解析后分发，D8） | —— | `walk(resolveStructureRef(node), live, path)` | 解析失败（缺名/环，手造派生物）→ 崩溃边界 E100 |

伪代码（主体；省略类型注解的机械部分）：

```ts
function walk(node: StructureNode, live: unknown, path: Array<string | number>): WalkResult {
  switch (node.kind) {
    case 'map': {
      if (carrierOf(live) !== 'Y.Map') return mismatch(path, 'Y.Map', live);
      const out: Record<string, unknown> = {};
      const record = node.fields.length === 1 && node.fields[0].name === '<key>';
      if (record) {
        const slot = node.fields[0].node;
        for (const key of (live as Y.Map<unknown>).keys()) {        // 插入序（§4.9）
          const v = (live as Y.Map<unknown>).get(key);
          if (v === undefined) continue;                            // D4：undefined 视同缺席
          const r = walk(resolveStructureRef(slot), v, [...path, key]); // slot 恒非 ref（求值期已解析，§1.2）——resolveStructureRef 为幂等透传
          if (r.kind === 'issue') return r;                         // fail-fast（INV-3）
          out[key] = r.snapshot;
        }
        return { kind: 'value', snapshot: out };
      }
      for (const f of node.fields) {                                // 字段声明序（§4.9）
        const v = (live as Y.Map<unknown>).get(f.name);
        if (!((live as Y.Map<unknown>).has(f.name) && v !== undefined)) continue; // D4
        const r = walk(f.node, v, [...path, f.name]);
        if (r.kind === 'issue') return r;                           // fail-fast：首字段错位即止（INV-3）
        out[f.name] = r.snapshot;
      }
      return { kind: 'value', snapshot: out };
    }
    case 'array': {
      if (carrierOf(live) !== 'Y.Array') return mismatch(path, 'Y.Array', live);
      const ya = live as Y.Array<unknown>;
      const out: unknown[] = [];
      for (let i = 0; i < ya.length; i++) {                         // 下标序（§4.9）
        const r = walk(node.element, ya.get(i), [...path, i]);      // i = number 段（F3）
        if (r.kind === 'issue') return r;                           // fail-fast（INV-3）
        out.push(r.snapshot);
      }
      return { kind: 'value', snapshot: out };
    }
    case 'xml-fragment': {
      if (carrierOf(live) !== 'Y.XmlFragment') return mismatch(path, 'Y.XmlFragment', live);
      return { kind: 'value', snapshot: (live as Y.XmlFragment).toString() }; // D7
    }
    case 'leaf':
    case 'plain': {
      if (carrierOf(live) !== 'plain value') return mismatch(path, 'plain value', live);
      return copyPlainValue(live, path, '');                        // §4.6（可能返回 issue：值域断言失败，含 loc 位置线）
    }
    case 'union':
      return walkUnion(node, live, path);                           // §4.5（恒两结局——出口 3 内联消化）
    case 'ref':
      return walk(resolveStructureRef(node), live, path);           // D8
    case 'root':
      return walk(node.node, live, path);                           // 探针已在入口完成（§4.7）
  }
}

function mismatch(path, expected, live): WalkResult {
  const actual = carrierOf(live);
  if (actual === null) throw new UnreachableCarrier();              // → 崩溃边界（D1/D9①）
  return { kind: 'issue', issue: makeIssue(path, expected, actual) }; // §4.7 message 模板
}
```

> Record 通路中 `resolveStructureRef(slot)` 的幂等透传说明：求值器解析点③（evaluate.ts:102-114）已把 Record 值位物化为**非 ref 节点**（如 fixture 的 union 节点），但同一 walker 也服务 array element / union member 等可携带 ref 的位置——统一在递归入口解析（walk 的 `case 'ref'` + 各调用点对子节点直接传原节点）即可，上表两处 `resolveStructureRef` 调用仅为显式化，等价于直接 `walk(slot, …)`。

### 4.4 结构树 ref 解析（D8）

```ts
/** 每调用局部 memo（对象引用为键——派生物节点共享引用的 O(1) 复用）。 */
function makeRefResolver(derived: DerivedSchema) {
  const memo = new Map<StructureNode, StructureNode>();
  return function resolve(node: Extract<StructureNode, { kind: 'ref' }>): StructureNode {
    const inFlight = new Set<string>();
    let cur: StructureNode = node;
    while (cur.kind === 'ref') {
      const hit = memo.get(cur);
      if (hit !== undefined) { cur = hit; continue; }
      if (inFlight.has(cur.name)) throw new StructureRefCycle(cur.name);   // → E100
      inFlight.add(cur.name);
      const next = derived.aliases[cur.name];   // Object.hasOwn 语义：undefined = 未声明
      if (next === undefined) throw new StructureRefMissing(cur.name);     // → E100
      memo.set(cur, next);
      cur = next;
    }
    return cur;
  };
}
```

- 镜像 vfsl `resolve.ts` `walkRefChain` 的迭代 while + inFlight 环检测 + next-hop memo 语义（该函数为 vfsl 包内部件，公共面不导出——本包基于公共数据 `derived.aliases` 自建同款，ADR-0003「解析动作由共享解析器完成」的域内重述）。
- 两个 throw 只被**手造/篡改派生物**触达（合法 derived 经 E106/E301 保证无环、有名）——被顶层崩溃边界收编为 `DOCRT-E100`（§4.8），不静默产出垃圾快照（对齐 evaluate.ts 手造 IR loud 边界先例）。

### 4.5 union 试验语义（D5——本设计最核心的裁决）

#### 4.5.1 试验语义：前置载体判定 + 形态分流（R2/#1/#5 重写）

union 的 any-of 语义（ADR-0003）说「至少一个成员接受即接受」。但提取期**容忍缺失**（D4：缺失属逻辑域）——一个 text 成员对 image 形文档的全部在场字段都可能结构通过、只是缺 `body`。「缺必填字段」在逻辑域是错误，在结构域只是「这个成员不适用于该值」。于是成员匹配需要一个三结局的**试验**概念：

```ts
/** 成员试验三结局（注意与 WalkResult 两结局的区分：软拒是试验层概念，walk 层不存在）。 */
function trialMember(member: StructureNode, live: unknown, path): 
  { accept: true; snapshot: unknown }                              // 零 issue 且零缺必填
  | { accept: false; issue?: ExtractIssue }                        // issue = 真结构错位；缺 issue = 软拒（仅缺必填）
```

试验按「**第一步前置载体判定 → 第二步按成员形态分流**」执行（成员先经 `resolveStructureRef` 解析 ref，§4.4）：

**第一步（恒定）：成员根载体前置判定（R2/#5）。** `carrierOf(live)` 对成员根的期望载体判定——map 形成员（resolve 后 `kind === 'map'`）要求 `carrierOf(live) === 'Y.Map'`，不匹配 → **拒 + 真 issue**（`mismatch(path, 'Y.Map', live)` 与 walk 同款）。非 map 形成员（array/xml/union/终态）的载体判定内建于其 walk，试验直接进入第二步即自然完成前置判定。前置判定封死两个病态：(a) live 非 Y.Map（plain 数组/字符串等）时字段扫描会调 `has()/get()` 触发 TypeError → E100 误分类；(b) 全可选字段的 map 成员对任意 plain 值「零字段缺席 = 零软标记」裸接受但从未检查成员根载体。红灯锚（SA2 红线 4）：`{ a?: YLeaf<string> } | YArray<YLeaf<string>>` 对 live `['x']`（plain 数组）→ 成员 0 前置判定拒 + 真 issue `['u']` Y.Map/plain value（**绝非** E100 'internal'）→ 全拒 → 首真 issue 确定。

**第二步：按 resolve 后的成员形态分流（R2/#1）。**

- **Record 形 map 成员**（`fields.length === 1 && fields[0].name === '<key>'`）：**无「缺失」概念，试验 = 直接 walk**——键集即在场集（walk 的 Record 分支按 `keys()` 插入序逐键下钻，§4.3）。理由：求值器把 Record 物化为 `{fields:[{name:'<key>', optional:false, node}]}`（evaluate.ts:107），`'<key>'` 是**字面段名**而非可缺席字段——按「缺必填字段」字面实现会对任何真实 live Y.Map 恒判「缺必填 `<key>`」→ 恒软拒、永不接受（`'<key>'` 名在对象语法不可声明，SA2 附录 B-3 t2 parse 报错实证无碰撞），直接违反 any-of（SA2 附录 B-3 t1 反例：`Record<string, YLeaf<string>> | { b: YArray<…> }` 对 live `{x:'hello', b:'plainstring'}` 正确语义 ok:true，R1 字面实现得 ok:false）。
- **封闭 map 形成员**：按字段声明序逐字段检查——**缺必填字段（`!f.optional` 且缺席）置软标记但不中断**（后续字段继续查——软标记不遮蔽真 issue 的发现）；任一字段递归出真 issue → 立即返回 `{accept:false, issue}`（成员内 fail-fast）；全部字段通过且无软标记 → `accept:true`；通过但有软标记 → `{accept:false}`（软拒）。
- **其余形态成员**（array/xml-fragment/union/leaf/plain）：无「缺失」概念，**试验 = 直接 walk**（value → accept；issue → 拒 + issue）。

> 统一表述：**试验与提交提取的唯一差异 = 封闭 map 形成员的「缺必填字段」从「跳过」（D4）变「软拒」**；其余一切形态（含 Record 形）试验与提交提取完全同构。软拒因此只在「成员自身字段层」产生——嵌套 union 的内部仲裁由该 union 自己的提交层完成（出口 3 回退），不向外层试验传播软标记。

#### 4.5.2 提交层仲裁（唯一权威）

```ts
function walkUnion(node, live, path): WalkResult {   // 恒两结局（D12）
  let firstIssue: ExtractIssue | undefined;     // 声明序首个真 issue（跨试验保留）
  for (const member of node.members) {          // 成员声明序（§4.9）
    const t = trialMember(member, live, path);
    if (t.accept) return { kind: 'value', snapshot: t.snapshot };   // 首个接受者胜（any-of + 声明序仲裁）
    if (t.issue !== undefined && firstIssue === undefined) firstIssue = t.issue;
  }
  if (firstIssue !== undefined) return { kind: 'issue', issue: firstIssue };  // 全拒但有真错位
  // 全软拒：结构不裁决——回退成员 0 提交提取，把裁决权留给逻辑相位
  return walk(resolveStructureRefOf(node.members[0]), live, path);
}
```

三条出口的语义：
1. **接受**：any-of 兑现——重叠成员不是错误（ADR-0003），声明序前者胜保证确定性（INV-8）。Record 形与对象形成员均可接受时，声明序前者胜（SA2 红线 1b 的仲裁锚）。
2. **全拒 + 真 issue**：报声明序首个真 issue。它最可能是「本应匹配的成员」的错误（判别式命中位），而声明序恰是求值器成员物化序——与 fixture（image 声明序第一）的直觉锚一致（§5 用例 U2/U3 验证）。
3. **全软拒**：所有成员都只缺必填字段、无结构错位——该值在结构上无法归入任何成员，但**没有结构错误可报**。回退成员 0 提交提取：产出「成员 0 视角的在场字段快照」（缺的省略；Record 形成员 0 则按其键集提取），交给 validateLogicalSnapshot 报「缺少必填字段」。**不吞错误也不伪造错误**——两步分离的正直兑现。

#### 4.5.3 为什么判别式是死数据（D5 核心论证）

判别式主选（kind 值 → 成员跳转）被否决的三重理由：

1. **违反 ADR-0003 判别式缓存条款**：该条款要求「缓存的缺失/存在不得改变任何可观测行为（含错误输出）」。结构树的 leaf 节点**不携带字面量期望**（`kind: "image"` 的 `"image"` 只活在值 schema 的 enum 里，D10 禁读）——提取器无法用结构判据验证判别字段值。若判别式主选，`node.discriminator` 从「加速缓存」升格为「语义输入」，其缺失（SA6 注明判别式是**非契约缓存**，测试剥离合法）将改变输出——直接违反条款。§4.5.2 的仲裁**从不读取** `node.discriminator`，等价性由构造保证（INV-4）。
2. **可构造反例**：全软拒场景下，判别式指向成员 k 而声明序回退成员 0，两者快照不同（成员 k 的在场字段 ⊄ 成员 0 字段集时，如 `{kind:'file', name, tags}` 场景 image 回退只有 `{kind}`）。判别式主选与声明序回退必有一个成为「可观测行为」——选判别式即违约。
3. **收益为零**：判别式加速的价值在 validate（全扫描昂贵）；提取的试验在「接受」路径上短路（首成员接受即返回）、在「真 issue」路径 fail-fast（首个错位即止）——判别式跳转省不了渐进成本。

> 对称先例：validate.ts:396-407 段 0 的纪律是「命中且零 issue 才接受，否则回落全扫描」——判别式仅加速静默接受。提取器更彻底：连加速都不做（试验本身廉价）。

#### 4.5.4 出口 3 的内联消化与递归终止（R2/#7 重写：`undetermined` 已删除）

walkUnion 的三个出口全部返回 `WalkResult`（value/issue）——**不存在第三种向上返回值**：出口 3 的回退 `walk(members[0])` 本身是普通提交提取，返回两结局。递归终止论证：回退目标是 resolve 后的成员节点，成员经 ref 解析构成的图无环（合法 derived 由 E106 保证；手造环在 §4.4 解析器 inFlight 检测即抛 → E100），故「union → 其成员 0 →（若为 union）→ 其成员 0 → …」的回退链严格沿无环成员图下降，有限步内落到非 union 节点终止。R1 的 `WalkResult` 第三结局 `'undetermined'` 与 map/array 通路四处 `undeterminedFallback` 防御分支已**全部删除**（D12）：类型即不变式——SA3 无法实现、也无法测试一个「永不发生」的分支。

### 4.6 plain 值深拷贝与 JSON 值域断言（D6——R2/#2/#3/#8 重写）

```ts
/**
 * 深拷贝 plain 值到纯 JSON 域。非 JSON 值 → 真 issue（expected 恒 'plain value'；
 * actual 为 D9② 申报词；loc = 违规内部位置线，进 message 不进 path——R2/#8 锚定精度）。
 * 各分支可达性（SA2 附录 B-2 实证）：
 * - bigint        可达（A1 直存 / D2 数组内嵌 / E1 跨端同步后仍 bigint）
 * - undefined     可达（D1 plain 数组内元素；对象键 undefined 走省略不报）
 * - non-plain obj 可达（C1 Date/类实例——本地视角；跨端退化为真 plain {}，见文末注）
 * - function/symbol 直接位不可达（A2/A3：set 期即抛 "Unexpected content type"）；
 *   plain 子树内嵌可达（N1–N3：set('a',[fn]) / set('b',{k:fn}) / set('c',[Symbol()])
 *   全部成功且读回原类型、encodeStateAsUpdate 不抛）——尾分支为可达真 issue 路径（R2.1/R-2 改判）
 * - Y 类型内嵌    可达（P22：yjs 允许 set('a', [new Y.Map()])）——actual = 词汇表载体名（nested 再分类）
 */
function copyPlainValue(v: unknown, path: Array<string | number>, loc: string): WalkResult {
  if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
    return { kind: 'value', snapshot: v };              // JSON 标量直通（bigint 不在此列——typeof 'bigint'）
  const nested = carrierOf(v);                          // 嵌套位置再分类（顶层调用方已保证 'plain value'）
  if (nested !== null && nested !== 'plain value')
    return plainDomainIssue(path, loc, nested);         // Y 类型内嵌（P22 可达）→ actual = 词汇表载体名（'Y.Map' 等）
  if (typeof v === 'bigint')
    return plainDomainIssue(path, loc, 'bigint');       // R2/#2：可达真 issue，绝不 E100（E1 跨端锚）
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (let i = 0; i < v.length; i++) {
      if (v[i] === undefined) return plainDomainIssue(path, `${loc}[${i}]`, 'undefined'); // JSON.stringify 静默 null 化——loud 拒绝
      const r = copyPlainValue(v[i], path, `${loc}[${i}]`);   // 位置线下钻（R2/#8）
      if (r.kind === 'issue') return r;
      out.push(r.snapshot);
    }
    return { kind: 'value', snapshot: out };
  }
  if (typeof v === 'object') {                          // 走到此处必非 Y 家族（carrierOf 粗判已滤，§4.1）
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null)
      return plainDomainIssue(path, loc, 'non-plain object',
        `constructor: ${proto?.constructor?.name ?? 'unknown'}`);   // R2/#3 原型守卫：Date/RegExp/Map/Set/类实例
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) {
      if (v[k] === undefined) continue;                 // 对象键 undefined：省略（= JSON 投影 + validate present() 惯例）
      const r = copyPlainValue(v[k], path, `${loc}.${k}`);
      if (r.kind === 'issue') return r;
      Object.defineProperty(out, k, { value: r.snapshot,  // R2/#8：defineProperty 写键——own '__proto__' 不落原型
        writable: true, enumerable: true, configurable: true });
    }
    return { kind: 'value', snapshot: out };
  }
  return plainDomainIssue(path, loc, typeof v === 'function' ? 'function' : 'symbol'); // 可达真 issue（N1–N3 内嵌路由；R2.1/R-2 改判）
}

/** plain 域违规 issue（D9② 申报词；位置线进 message，path 锚定声明节点——结构树下无更深语义节点）。 */
function plainDomainIssue(path, loc: string, word: string, extra?: string): WalkResult {
  const at = loc === '' ? '' : `，内部位置 ${loc}`;
  return { kind: 'issue', issue: {
    message: `纯值域违规（${renderPath(path)}${at}）：期望 plain value（JSON 值域），实际 ${word}${extra ? `（${extra}）` : ''}`,
    path, expected: 'plain value', actual: word } };
}
```

- **为什么必须深拷贝**：P15/P15b 实测 yjs 对 plain 值 `get()` 返回**原引用**（连嵌套对象都同引用）——不拷贝则 INV-1/INV-2 双破（live 原地突变数组 `push` 直接改写快照；嵌套 Y 类型泄漏进 JSON 断言）。
- **为什么白名单断言而非 structuredClone / JSON 投影**：structuredClone 遇 Y 类型抛 `DataCloneError`（分不清「载体错位」还是「不可克隆」，无法构造 expected/actual）；`JSON.parse(JSON.stringify())` 把 undefined 静默 null 化（虚假降级）；**`Object.keys` 直扫对 Date/类实例产出 `{}` 且 ok:true（R1 隐含行为）——时间戳语义静默蒸发，SA2 #3 伪降级否决**。原型守卫（`proto === Object.prototype || null`）把「非普通对象混入 plain 位」变成可锚定真 issue；普通对象经 `{}` 字面量构造、跨端 wire 解码产物（Q5b：`proto === Object.prototype`）自然放行。
- **Date 的诚实边界**：本地写入端 `get()` 读回 Date 实例（C1）→ 守卫命中 → 真 issue；**跨端对端**经 `encodeStateAsUpdate/applyUpdate` 后 Date 退化为真 plain `{}`（SA2 E2 + Q5b 实测：`proto === Object.prototype`、`keys: []`）——对端存储的**确实是** plain 空对象（yjs 写入期即有损编码），无可检测的 Date 性，守卫正确放行为 `{}`。loud 覆盖「可检测的脏数据」，不伪造「不可检测的洁癖」。
- **`__proto__` own-key 安全（R2/#8）**：Q3/Q4 实测 own `'__proto__'` 键可经 `Object.defineProperty` 构造、可被 yjs 存取（原引用）、JSON 往返保留 own 键；`out[k] = …` 赋值式对 `'__proto__'` 触发原型 setter（键静默丢失/原型污染）——defineProperty 写入绕开 setter，四描述符齐全与普通键逐位同形。
- 快照键序：`Object.keys(v)` 原序（INV-8 确定性沿用源值序）。

### 4.7 公共接缝编排与 issue 构造

```ts
export function extractYjsSnapshot(derived: DerivedSchema, doc: Y.Doc): ExtractResult {
  try {
    const probe = probeRoot(doc);                                   // §4.2（唯一触碰 doc 的入口）
    if (probe.carrier !== 'Y.Map')
      return { ok: false, issues: [makeIssue([], 'Y.Map', probe.carrier)] };  // F5/T1/T2：path [] 收敛
    const r = walk(derived.structure.node, probe.map, []);          // root 内层节点（§1.2：恒非 ref）
    if (r.kind === 'issue') return { ok: false, issues: [r.issue] };           // fail-fast 单 issue（F2/INV-3）
    return { ok: true, snapshot: r.snapshot };                                 // INV-1/INV-2 已由拷贝器保证
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, issues: [{ message: `DOCRT-E100: 内部错误（意外异常）: ${detail}`,
      path: [], expected: 'internal', actual: 'internal' }] };                // D9：词汇表显式偏离（§10 登记）
  }
}

/** message 模板（措辞自由域，F7 仅要求非空；模板统一便于日志检索）。 */
function makeIssue(path: Array<string | number>, expected: string, actual: string): ExtractIssue {
  return { message: `Yjs 载体错位（${renderPath(path)}）：期望 ${expected}，实际 ${actual}`, path, expected, actual };
}
/** path 渲染仅用于 message 文本（ADR-0007 禁的是 issue.path 的点号表示，不禁文本渲染）。 */
function renderPath(path: Array<string | number>): string {
  return path.length === 0 ? 'ROOT'
    : path.reduce((acc, seg) => typeof seg === 'number' ? `${acc}[${seg}]` : `${acc}.${String(seg)}`, 'ROOT');
}
```

`derived.structure` 形状守卫：`derived.structure.kind !== 'root'`（手造派生物）→ 抛内部异常 → E100（§4.8 崩溃边界统一收编，无需独立错误族）。

### 4.8 崩溃边界（D9①，INV-6——R2/#2 按实证口径重写可达性表）

全函数体顶层 try/catch（§4.7 已示）。可触达路径的诚实盘点（对齐 parseVfsl E100「该路径命中 = 实现缺陷/不可达输入信号，不得视为通过」的立场）。**R1 的「carrierOf null 公共 API 不可达」断言被 SA2 实测证伪（bigint 可达且跨端传播，附录 B-2 A1/E1）——R2 把全部可达脏数据路径改判为真 issue，E100 只保留真正不可达的防御位**：

| 触发源 | 可达性（实证口径） | 语义 |
|---|---|---|
| ref 解析：缺名 / 环 | 仅手造/篡改 derived（合法 derived 经 E301/E106 保证） | 与 evaluate.ts 手造 IR loud 边界同款 |
| `derived.structure.kind !== 'root'` | 仅手造/篡改 derived | 同上（§4.7 形状守卫） |
| **bigint 落 leaf/plain 位（含 plain 数组内嵌）** | **可达**（A1 直存、D2 数组内嵌、E1 跨端同步后仍 bigint） | **真 issue**（copyPlainValue，actual='bigint'，D9②）——绝不 E100：公开可达的用户脏数据不得上报「内部错误」误导排障 |
| **Date/类实例落 plain 位** | **可达**（C1：本地 `get()` 读回实例；跨端退化见 §4.6 注） | **真 issue**（原型守卫，actual='non-plain object' + constructor 名） |
| **plain 数组内 undefined 元素** | **可达**（D1） | 真 issue（actual='undefined'） |
| **Y 类型内嵌 plain 子树** | **可达**（P22） | 真 issue（actual=词汇表载体名，§4.6 nested 再分类） |
| **function/symbol 经 plain 子树内嵌（数组元素/对象值）** | **可达**（N1–N3 + SA1 R2.1 复现 N4：`set('a',[fn])`/`set({k:fn})`/`set([Symbol()])` 全部成功、读回原类型、`encodeStateAsUpdate` 不抛） | **真 issue**（copyPlainValue 尾分支，actual='function'/'symbol'，D9② 可达组）——机制行为与 R2 一致，仅标注改判（R2.1/R-2） |
| function/symbol 落直接 leaf/plain 位 | 不可达（A2/A3：yjs `set` 期即抛 "Unexpected content type"；SA1 R2.1 对照复现） | carrierOf null → E100 防御——直接位路由确不可达，到达即 yjs 行为漂移信号 |
| carrierOf null 其余情形（undefined 到达载体判定 / AbstractType 第五类变体） | 不可达（undefined 被 D4 缺失检测先行拦截；XmlElement 借类继承命中 XmlFragment 判别 Q2；其余 AbstractType 子类公共写入路径造不出） | loud assert——**不静默归并为 plain value**（虚假降级禁令） |
| 探针第四级全失败 | 不可达（root 只能由四种公共 getter 之一创建） | 同上 |
| 深递归 RangeError | yjs 自身在构造期即栈溢出（P24：~10³ 层嵌套 set 即抛）——文档深度天然有界；结构引导遍历另受 `MAX_TYPE_NESTING=100` 上限 | 兜底而非预期路径 |
| 实现缺陷（不可达分支到达） | —— | 实现缺陷信号 |

### 4.9 确定性与迭代序冻结（INV-8）

| 遍历位 | 序 | 依据 |
|---|---|---|
| 封闭 map 字段 | **字段声明序**（`derived.structure` 的 `fields` 数组序） | 求值器按声明序物化（evaluate.ts:172）；fail-fast 的「首错位字段」语义 = 声明序首个 |
| Record 动态键 | **`Y.Map.keys()` 插入序** | P7 实测：插入序稳定、覆写不换位——同 doc 状态下确定 |
| Y.Array 元素 | 下标升序 | 平凡 |
| union 成员 | 声明序 | ADR-0003 any-of + INV-8 |
| plain 值键 | `Object.keys` 原序 | 源值序透传 |

快照键插入序同源（map 出 = 字段声明序；Record 出 = keys 序）——同输入逐字节同输出（`JSON.stringify` 确定性）。

### 4.10 复杂度（D11）

- 主遍历：O(结构树覆盖的 live 节点数) 单遍。
- union 试验：每 union ≤ 成员数 × 子树（试验 fail-fast / 接受短路）；最坏嵌套全软拒场景理论上有 `m^深度` 型上界（m = 成员数、深度 ≤ 100），但构造它需要 schema 作者写全成员互相软拒的指数嵌套联合 + doc 全量填充——v1 不设显式预算（D11），登记为已知界：**真实 schema（m、深度个位数）下成本与文档规模线性同阶**。
- 内存：快照 O(提取值规模)；ref memo / trial 无跨调用状态（全调用局部——对齐 validate.ts 纯函数纪律）。

## §5. SA6 21 用例 ↔ 设计条款逐条映射（行为对账）

| 组 | 用例（测试行） | 设计路径 | 判定推演 |
|---|---|---|---|
| 幸福路径 :276 | 全 fixture → ok + 深等 + JSON 往返 | §4.3 全表 + §4.5 | ROOT 探针 → map；`assets` Record：img1/doc1/f1 各值 → union 试验：img1 全字段在场且载体对 → 成员 0 接受；doc1 缺 image 的 url/width/height → 成员 0 软拒 → 成员 1（body=Y.XmlFragment→toString，audit ref→aliases['Audit']→map）接受；f1 → 成员 2 接受；attachments=plain 数组→plain 深拷贝 `['x','y']`；audit → ref→map；keywords=Y.Array→`['k1','k2']`。快照纯 JSON（INV-1：拷贝器 + toString）✓ |
| 解耦 :284 | 提取后 6 类突变 → snapshot 不变 | §4.6 深拷贝 + D7 | 快照零 live 引用（INV-2）：map/Y.Array/Xml 突变作用于 live 对象、plain 覆写换的是 map 槽位——快照是独立值树 ✓ |
| root T1 :303 | ROOT=Y.Array → path [] / Y.Map / Y.Array 不外抛 | §4.2 探针② + §4.7 | getMap 抛 → getArray 命中 → `makeIssue([], 'Y.Map', 'Y.Array')` ✓ |
| root T2 :310 | ROOT=Y.XmlFragment → path [] / Y.Map / Y.XmlFragment | §4.2 探针③ | getMap、getArray 均抛（P2b 实测）→ getXmlFragment 命中 ✓ |
| map 错位 M1 :319 | `{a,b}` a=Y.Array → 首字段锚 `['a']`，b 不报告 | §4.3 map 行 fail-fast | 字段声明序：a 载体 Y.Array ≠ plain value → 单 issue 即返；b 未访问（`issue.path` 无 'b'）✓ |
| map 错位 M2 :330 | a 应 Y.Map 实 Y.Array（内含垃圾）→ 只锚 `['a']` 不下钻 | §4.3 错位行为列 | mismatch 即返，不读数组内容 ✓ |
| array A1 :346 | tags[1]=Y.Map → `['tags',1]` number 段 | §4.3 array 行 | 元素 0 'ok' plain ✓ → 元素 1 carrierOf=Y.Map ≠ plain value → issue，段=下标 number ✓ |
| array A2 :361 | array 节点放 plain 数组 → `['keywords']` Y.Array/plain value | §4.3 array 错位（方向一） | carrierOf(plain JS array)='plain value' ≠ 'Y.Array' ✓ |
| plain P1 :371 | plain 节点放 Y.Array → `['attachments']` plain value/Y.Array（方向二） | §4.3 plain 错位 | ✓ |
| plain P2 :382 | plain 节点放 plain 数组 → ok 原样 | §4.3 plain 行 + §4.6 | 白名单数组深拷贝 → `{attachments:['a','b']}` ✓ |
| leaf L1 :392 | profile.name=Y.Text → `['profile','name']` plain value/Y.Text | §4.3 leaf 错位 | carrierOf=Y.Text → issue（词汇表 'Y.Text' 的唯一测试锚）✓ |
| leaf L2 :403 | profile.name=Y.Map → 同锚 | 同上 | ✓ |
| Record R1 :416 | 多动态键正确 → ok 保留全部键 | §4.3 Record 行 | keys 插入序 k1,k2 各下钻 '<key>' 节点 → `{m:{k1:{a:'x'},k2:{a:'y'}}}` ✓ |
| Record R2 :432 | Record 值放 plain 对象 → `['assets','img1']` Y.Map/plain value | §4.5 试验：三成员（map 形）对 plain 值全部 mismatch | 成员 0 试验 issue(`['assets','img1']`,Y.Map,plain value) 保留；成员 1、2 同型 issue 不覆盖首个；全拒 → 首个真 issue ✓ |
| union U1 :444 | 三成员各自正确提取 | §4.5.2 出口 1 | 同幸福路径推演 ✓ |
| union U2 :450 | 成员内字段错位 → `['assets','img1','url']`（Record+union+ref 链） | §4.5 试验软拒 + 出口 2 | 成员 0：url=Y.Map ≠ plain value → 真 issue 保留；成员 1 缺 body（必填）→ 软拒；成员 2 缺 name/size/tags → 软拒；全拒 → 首真 issue=`['assets','img1','url']` plain value/Y.Map ✓ |
| union U3 :469 | ref 目标载体错位 → `['assets','img1','audit']` | §4.4 + §4.5 出口 2 | 成员 0：audit=plain 对象 → resolve ref 'Audit'→map 节点 → mismatch Y.Map/plain value；成员 1/2 软拒 → 首真 issue ✓ |
| XML X1 :487 | 正确 XmlFragment → 字符串 + 归一化等价 | D7 | toString → `'<p>Hello <b>world</b></p>'`（P6 实测逐字吻合；归一化仅放宽空白）✓ |
| XML X2 :496 | xml 位放 plain 字符串 → `['assets','doc1','body']` Y.XmlFragment/plain value | §4.5 出口 2 | 成员 0 软拒（缺 url 等）；成员 1：body plain string ≠ Y.XmlFragment → 真 issue；成员 2 软拒 → 首真 issue ✓ |
| SCHEMA/META S1 :515 | SCHEMA=Y.Array 垃圾 + META 数字垃圾 + ROOT 正确 → ok | §4.2 只碰 'ROOT'（INV-7） | 探针 getMap 命中既有 ROOT；SCHEMA/META 名字零访问 → `{title:'ok'}` ✓ |
| S2 :525 | 全 optional ROOT + 空 doc → `{}` | D3 探针①缺席创建 | getMap 惰性空 map（P4：零 update）；字段 notes 缺席 → 跳过 → `{}` ✓ |

**21/21 全绿推演成立。** 红灯唯一成因（`../src/index.js` 缺失）由本设计 §3.1 包布局直接消除。

> **R2 同步注记（SA2 #1/#2/#5 修订对 §5 的影响）**：21 用例推演**结论全部不变**——R1 表中 union 各行（幸福路径/U1/U2/U3/X2/R2）的推演在 R2 试验语义下重走：前置载体判定一步在这些用例的 live 值（Y.Map）上恒通过（成员均为 map 形、img1/doc1 值均 Y.Map），不改变成员试验的后续流程与仲裁结果；R2 行（Record 值 plain 对象）在 R1 推演中隐含假设的前置判定（SA2 #5 指出的脱节）现已成为 §4.5.1 明文第一步，推演与规格一致化（结论本就正确）。Record 形 union 成员与 plain 域违规（bigint/Date）不在 21 用例覆盖面内，属 SA2 红线 1–5 建议的**补充测试文件**行为面（§11 ALLOW LIST R2 追加）。

## §6. 边界与防御性设计清单（拒绝虚假降级对照）

| # | 边界条件 | 设计裁决 | 为什么不是静默降级（对照 SKILL 立法） |
|---|---|---|---|
| B1 | ROOT 缺席 | 惰性空 map → 快照空对象（**契约明文**，非降级） | SA6 F6 冻结：缺失属逻辑域；D3 |
| B2 | ROOT 异型载体 | 探针收敛单 issue `path: []`（F5） | yjs 原生 throw 被**转化**为领域化失败——错误信息零丢失（expected/actual 齐备），不是吞掉 |
| B3 | 字段/键缺席（含 `set(k, undefined)`） | 跳过不报不进快照 | 两步分离的设计语义（ADR-0007）；逻辑相位会响亮报「缺少必填字段」——错误不消失，只是相位正确 |
| B4 | 未知键（封闭 map 多出来的键） | 忽略（不进快照） | 同上：validateLogicalSnapshot 报「未知字段」；提取期报 = 越权（ADR-0002） |
| B5 | Record 键不匹配 keyPattern | 不校验（keyPattern 零消费） | 值语义越权；逻辑相位报「Record 键不满足 Pattern」 |
| B6 | union 全软拒 | 回退成员 0 提交提取（快照照常产出） | **不吞裁决**：逻辑相位拿到的快照保留了全部在场字段信息，必填缺席由它响亮报出（§4.5.2 出口 3 论证） |
| B7 | plain 子树内嵌 Y 类型 / 非 JSON 值 | 真 issue（锚定声明节点位 + message 内部位置线，R2/#8） | P22 实测可达；F8「无泄漏」的结构强制；structuredClone 的 DataCloneError 反而是不可诊断的坏降级 |
| B8 | 手造 derived（ref 缺名/环/structure 非 root） | DOCRT-E100（崩溃边界） | 上游 bug 不静默产出垃圾 ok:true——对齐 evaluate.ts 手造 IR 纪律 |
| B9 | 探针/载体判定不可达态（function/symbol **直接位**、AbstractType 第五类、探针第四级全失败） | DOCRT-E100 | loud assert：公共 API 造不出的状态若出现，即实现或环境缺陷信号（A2/A3 + R2.1 复现：function/symbol **直接位** set 期即抛；**内嵌路由可达、归 B7 值域违规真 issue**——N1–N3/R-2 改判） |
| B10 | 对抗深嵌套 doc | yjs 构造期自身先炸（P24）+ 崩溃边界兜底 RangeError | 环境极限的诚实上报，非吞掉 |
| B11 | 判别式字段缺失于派生物（非契约缓存被剥离） | 行为逐字节不变 | INV-4 构造性保证（提取器不读 discriminator）——非「容错」，是「无依赖」 |
| B12 | **bigint 落 leaf/plain 位（含数组内嵌、跨端传播）**（R2/#2 新增） | 真 issue（actual='bigint'，D9② 申报词）——**绝不 E100** | A1/D2/E1 实测可达：公开可达的用户脏数据上报「内部错误」= 错误信号语义域错位，误导排障去查不存在的引擎缺陷；真 issue 保持四字段可锚定 |
| B13 | **Date/RegExp/类实例落 plain 位**（R2/#3 新增） | 原型守卫 → 真 issue（actual='non-plain object'，message 附 constructor 名）——**禁静默投影 `{}`** | C1/C2 实测：`Object.keys(Date)=[]` 直扫产出 ok:true `{}` = 时间戳语义蒸发的**伪降级**（SKILL 立法典型样例——正常写入流程 materializeRoot 未建，出现即脏数据，应 loud）；与 B7 undefined 数组元素纪律一致 |
| B14 | **union 成员根载体错位 / Record 形成员**（R2/#1/#5 新增） | 前置载体判定 → 拒 + 真 issue；Record 形试验 = 直接 walk | 前者杜绝 TypeError→E100 误分类（载体错位是用户可见数据问题，非内部错误）；后者纠正「`'<key>'` 字面段名被当缺席字段」的 any-of 违约——两处都是把**可达输入从错误语义域归位到正确语义域**，非新增降级 |
| B15 | own `'__proto__'` 键混入 plain 对象（R2/#8 新增） | defineProperty 写键，own 属性逐位保留 | Q3/Q4 实测：赋值式写入触发原型 setter（键静默丢失/原型污染）——静默丢失键正是 B13 同款的投影蒸发；JSON 往返无损实证 |

## §7. 包集成（AC5 落位）与验收映射

- **根 `package.json` `typecheck`** 追加 `&& tsc -p packages/doc-runtime/tsconfig.json`（唯一根文件改动，1 行）。
- **`packages/doc-runtime/tsconfig.json`** 新建：extends `../../tsconfig.base.json` + include `["src/**/*.ts", "test/**/*.ts"]`（镜像 `packages/vfsl/tsconfig.json` 逐字节形状——同款 include 让测试文件进 tsc 面）。
- **CI 零改动**：node 20/24 matrix（ci.yml:17-19）+ `pnpm typecheck`（:36）+ `pnpm test`（:39，vitest include `packages/*/test/**/*.test.ts` 自动拾取新测试）——AC5「被根 typecheck 与 CI Node 20/24 显式覆盖」由既有管线 + 上述两文件达成。
- **lockfile**：SA6 已登记 importer（pnpm-lock.yaml:36）；本设计零依赖变更 → 零 lockfile 变更。
- **AC 对照**：AC1→§3.2；AC2→§4.3 全景表（root/map/array/xml/leaf/plain/union/ref 八 kinds 全覆盖 + 双向错位）；AC3→INV-3 + §4.7；AC4→INV-1/INV-2 + D7；AC5→本节；AC6→§5 映射表（SA6 21 用例即行为测试矩阵）。

## §8. 对业务的影响评估

- **零存量代码影响**：新包 + 根 typecheck 一行追加；无任何既有函数被调用/修改；无任何既有测试受影响。
- **下游铺路**：ADR-0007「普通 open 依次完成 schema 编译、META 身份检查、ROOT 载体提取和逻辑校验」——本接缝是 open 链第 3 环的独立可测件；`materializeRoot` 等其余三入口后续在本科落位。
- **风险点**：无（纯新增）；唯一外部行为耦合是 yjs 载体语义（§9 全部实测锚定）。

## §9. 协议假设依据 (Protocol Assumption Evidence)

设计期实测环境：worktree 内 `packages/doc-runtime/node_modules/yjs`（yjs@13.6.32，Node 24.13.0）；SA1 探针脚本一次性未落仓（R1 的 P2/P3 原以「见 bash 会话记录」引用——R2/#6 已改为内联命令与输出，SA4 可重跑）；SA2 评审独立复测全部 P 编号并新探 A1–E2（其附录 B），SA1 R2 补探 Q1–Q5。**R2 口径：可达性断言以实测为准（bigint/Date 可达被 R1 误判不可达——已改判，见 §4.8）**。SA4 重跑方式：`cd packages/doc-runtime && node -e "<命令列>"`（`import * as Y from 'yjs'` 经包内 node_modules 解析）。

| # | 假设 | 依据类型 | 依据内容（命令 + 关键输出，具体引用） | 风险 |
|---|---|---|---|---|
| P1a/b | 异型 ROOT `getMap('ROOT')` 抛错；`getArray` 返回既有实例 | 设计期实测 | `node /tmp/yjs-probe.mjs`：ROOT=Y.Array 时 `getMap` 抛 `"Type with the name ROOT has already been defined with a different constructor"`，`getArray` 正常返回既有。SA2 附录 B-1 复证（`P1 getMap on Array-ROOT => THROW` / `P1 getArray returns existing => 3`） | 低（SA6 测试注释 :49-53 同锚） |
| P2a-c | ROOT=Y.XmlFragment：getMap/getArray 抛、getXmlFragment 返回 | 设计期实测（R2 内联命令；R2.1/R-1 修正解构——yjs ESM 无 default export，SA2 复审 verbatim 复跑诊断确认） | `cd packages/doc-runtime && node -e "import('yjs').then((Y)=>{const d=new Y.Doc();d.getXmlFragment('ROOT');for(const [n,f] of [['getMap',()=>d.getMap('ROOT')],['getArray',()=>d.getArray('ROOT')],['getXmlFragment',()=>d.getXmlFragment('ROOT')]]){try{f();console.log(n,'=> ok')}catch(e){console.log(n,'=> THROW:',e.message)}}})"` → `getMap => THROW: Type with the name ROOT has already been defined with a different constructor` / `getArray => THROW: …different constructor` / `getXmlFragment => ok`。SA2 附录 B-1 XF 行 + 附录 C 修正变体复跑复证 | 低 |
| P3a-d | ROOT=Y.Text：前三级全抛、getText 返回 | 设计期实测（R2 内联命令；R2.1/R-1 同上修正） | `cd packages/doc-runtime && node -e "import('yjs').then((Y)=>{const d=new Y.Doc();d.getText('ROOT').insert(0,'x');for(const [n,f] of [['getMap',()=>d.getMap('ROOT')],['getArray',()=>d.getArray('ROOT')],['getXmlFragment',()=>d.getXmlFragment('ROOT')],['getText',()=>d.getText('ROOT')]]){try{const r=f();console.log(n,'=> ok',typeof r==='string'?r:'')}catch(e){console.log(n,'=> THROW')}}})"` → 前三级 `=> THROW` / `getText => ok`（返回 Y.Text 实例；R2.1 实跑校准——原记 `ok x` 系笔误，命令的 `typeof==='string'` 分支不触发）。SA2 附录 B-1 F1-F4 行复证 | 低（防御分支，测试未锚） |
| P4 | 空 doc `getMap('ROOT')` 创建不触发 update 事件 | 同上 | `d4.on('update')` 计数 = 0；`toJSON()` 出现 `ROOT:{}` 但零 update 回调——D3 副作用论证。SA2 B-1 复证 `update events after lazy getMap: 0` | 中（若未来 yjs 为惰性创建发 update，只读性受损——版本钉死 ^13.6.30 + CI 双 node 版本回归） |
| P5/P5c | map 值四类载体 instanceof 判别 + plain 白名单 + 缺键 get→undefined | 同上 | `instanceof checks: true true true …`；`missing key get(): true` | 低 |
| P6/P6b/P21 | `Y.XmlFragment.toString()` = 语义 XML 字符串（含属性、`<img src="a.png"></img>` 形自闭合） | 同上 | `"<p>Hello <b>world</b></p>"`；toJSON 同值 | 低 |
| P7 | `Y.Map.keys()` 插入序、覆写不换位 | 同上 | `["b","a","c"]` 覆写后不变。SA2 B-1 复证 | 低 |
| P8/P9 | Y.Array 元素载体 instanceof；嵌套 Y.Map in Y.Array 可读 | 同上 | `idx1 instanceof Y.Map: true` 等 | 低 |
| P15/P15b | **plain 值 `get()` 返回原引用（含嵌套）** | 同上 | `same ref as set? true`；`nested fresh? false`——深拷贝强制性的根基。SA2 B-1 复证 | 高（若误判为解码副本则解耦红灯）→ 已按拷贝设计 |
| P16 | `set(k, undefined)` → `has` true / `get` undefined | 同上 | 输出 `has(undefined-set): true`。SA2 B-1 复证 | 低（D4 以 get()===undefined 判缺席，has 不单独使用） |
| P19 | `Y.Map.toJSON()` 抹平载体（Y.Text→字符串） | 同上 | `{"t":"x"}`——证明不可用 toJSON 做载体判定（D1 被否依据） | 低 |
| P22 | **yjs 允许 plain 数组内嵌 Y.Map 且读回活引用** | 同上 | `set plain-array-with-Ytype: allowed; get(0): is Y.Map`。SA2 B-1 复证 | 中（越轨状态可达 → §4.6 断言必设） |
| P24 | ~10³ 层嵌套构造期 yjs 自身 RangeError | 同上 | `RangeError: Maximum call stack size exceeded`（构造 set 级联中） | 低（B10 兜底） |
| Q1（R2） | `Y.AbstractType` 公共导出（第五类 Y 类型防御判定的可行性） | 设计期实测（R2；R2.1/R-1 同步修正解构） | `cd packages/doc-runtime && node -e "import('yjs').then((Y)=>console.log(typeof Y.AbstractType))"` → `function`（§4.1 兜底行依据；SA2 附录 C Q1 复证） | 低 |
| Q2（R2） | XmlElement 作 map 值：借类继承命中 `instanceof Y.XmlFragment` | 设计期实测（R2） | `set('e', new Y.XmlElement('p'))` 后 `get('e')`：四类 instanceof = `false false true false`、`instanceof Y.AbstractType: true`、proto 构造名 `YXmlElement`——XmlElement extends YXmlFragment，自然归位无需第五分支 | 低 |
| Q3/Q4（R2） | own `'__proto__'` 键：defineProperty 构造、yjs 存取原引用、JSON 往返保留 | 设计期实测（R2） | `Object.defineProperty(src,'__proto__',{value:1,…})` → `Object.keys: ['__proto__']`；yjs `set/get` 后 `hasOwnProperty('__proto__'): true`（原引用）；`JSON.parse(JSON.stringify(src))` → `{"__proto__":1}` own 键保留（§4.6 defineProperty 写入依据） | 低 |
| Q5/Q5b（R2） | Date 本地原型可判；跨端 wire 同步后退化为真 plain `{}` | 设计期实测（R2） | 本地 `getPrototypeOf(new Date(0)) !== Object.prototype`（ctor `Date`）；`encodeStateAsUpdate→applyUpdate` 后对端 `get('dt')`：`proto === Object.prototype: true`、ctor `Object`、`keys: []`——与 SA2 E2 互证（§4.6 Date 诚实边界注） | 低（跨端退化是 yjs 写入期有损编码的既成事实，非提取器可检测） |
| A1/A2/A3（SA2） | bigint 可直存读回；function/symbol set 期即抛 | SA2 实测（附录 B-2） | `A1 set bigint => ok / get bigint => bigint`；`A2 set function => THROW: Unexpected content type`；`A3 set symbol => THROW`——D1 粗判域划分 + §4.8 可达性表的直接依据 | 中（bigint 行为面 → 补充测试文件锚定，§11） |
| B1（SA2） | Y.Array 元素不可 undefined（insert 期抛） | SA2 实测 | `insert [undefined,1] => THROW: TypeError`——undefined 违规只剩 plain 数组内嵌一路（D1 可达） | 低 |
| C1/C2（SA2） | Date 可存可读、`Object.keys` 投影为空 | SA2 实测 | `get Date instanceof => Date`；`Object.keys(date-value) => []`——#3 原型守卫的伪降级证据 | 中（→ 补充测试文件锚定） |
| D1/D2/E1（SA2） | plain 数组内 undefined/bigint 可达；bigint 跨端同步后仍 bigint | SA2 实测 | `set [undefined] => ok`、`set [10n] => ok / typeof => bigint`、`bigint after sync typeof => bigint`——D9② 'undefined'/'bigint' 申报词的可达性依据 | 中（→ 补充测试文件锚定） |
| E2（SA2） | Date 跨端退化为 plain Object | SA2 实测 | `date after sync ctor => Object`（与 Q5b 互证） | 低 |
| N1–N4（SA2 复审 + SA1 R2.1 复现） | function/symbol 可经 plain 容器内嵌进入 doc：set 成功、读回原类型、encode 不抛；**直接位 set 期即抛（对照）** | SA2 复审实测 + SA1 R2.1 独立复现 | SA2 N1–N3：`set('a',[()=>1])` / `set('b',{k:()=>2})` / `set('c',[Symbol()])` 全 ok、`typeof get` → function/symbol、encodeStateAsUpdate 不抛（wire 投影 null，本地存活窗口完整）。SA1 复现（`cd packages/doc-runtime && node -e "import('yjs').then((Y)=>{…})"` namespace 变体）：N1 `[fn]` ok（same ref true）/ N2 `{k:fn}` ok / N3 `[Symbol]` ok / N4 encode ok / 对照 `set('d',fn)` THROW "Unexpected content type"——R-2 改判（§4.6/§4.8/D9②/§6 B9）的直接依据 | 中（内嵌路由行为面 → 补充测试文件锚定：`set('a',[fn])` → ok:false 单 issue、actual='function'、非 'internal'，§11） |
| B-3 t1/t2/t3（SA2） | Record 形 union 成员 schema 合法可求值；`'<key>'` 字面名对象语法不可声明 | SA2 实测（tsx 求值器） | `type ROOT = Record<string, YLeaf<string>> | { b: YArray<…> }` evaluate ok，structure.node = union[map{'<key>'}, map{b}]；`type ROOT = { "<key>": string }` parse error——#1 Record 特例的触发前提与无碰撞实证 | 低 |
| S1 | 测试自动入 CI | 源码引用 | `vitest.config.ts:6` include `packages/*/test/**/*.test.ts` | 低 |
| S2 | 根 typecheck 管线 | 源码引用 | `package.json:13` 五包串联；本设计追加第六项 | 低 |
| S3 | CI matrix 20/24 | 源码引用 | `.github/workflows/ci.yml:17-19` + `:36` `pnpm typecheck` | 低 |
| S4 | lockfile importer 已就位 | 源码引用 | `pnpm-lock.yaml:36` `packages/doc-runtime:` | 低 |
| S5 | 结构深度 ≤ 100 | 源码引用 | `packages/vfsl/src/parser.ts:24` `MAX_TYPE_NESTING = 100` | 低 |
| S6 | 求值器终态内联/Record 值位解析（提取器遇 ref 的形状前提） | 源码引用 | `packages/vfsl/src/evaluate.ts:89-93`（F4）、`:102-114`（解析点③）、`:56-58`（root 入口物化） | 低 |

## §10. 契约改动连锁审计 (Contract Change Caller Audit)

**无契约改动**：本设计仅涉及**新建**函数（`extractYjsSnapshot`，新包新文件）与新包脚手架（tsconfig）。不修改任何既有函数的签名、返回形状、throw 行为、同步性、可空性——既有五个包的源码零触碰（§11 文件清单 DENY 全覆盖）。既有 caller 集合（全仓对该设计对象的调用）= ∅（新接缝，SA6 测试是其第一个消费者，且测试已冻结）。

> **R2/#4 登记（SA8 note-5 裁决落实；R2.1/R-2 同步改判）**：本设计对 SA6 冻结契约 F4（expected/actual 五值词汇表）存在**一处已申报的扩展面**——`ExtractIssue.actual` 在 plain 域违规路径可取 D9② 申报词（`'bigint'` / `'undefined'` / `'non-plain object'` / `'function'` / `'symbol'` 五词均**可达**：前三者 A1/D1/C1，后两者 N1–N3 plain 子树内嵌路由——R2.1 改判）与 E100 路径的 `'internal'`（D9①）；`expected` 侧恒词汇表内值（plain 域违规 = `'plain value'`）。该扩展不触碰 SA6 21 用例的任何断言（用例未锚定这些值），但属「设计偏离冻结契约必须显式说明并由 SA4 复核」的辖域——SA4 Phase 3 请对本节 + D9 一并裁决。SA6 冻结测试文件**不因此改动**。

### 改动函数

| 函数 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `extractYjsSnapshot`（新增） | `packages/doc-runtime/src/extract.ts`（新建） | ——（不存在） | `(derived: DerivedSchema, doc: Y.Doc) => ExtractResult`；同步、不抛错、fail-fast 单 issue |

### Caller 清单

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| SA6 验收测试（既有，冻结） | `packages/doc-runtime/test/extract-yjs-snapshot.test.ts:61` | 否（同步） | 不需要（接缝承诺不抛错，F5/INV-6） | N/A | 无需处置——不抛错纪律使 caller 永不面对异常 |
| 其余 caller | ——（无） | —— | —— | —— | ADR-0007 的 NamespaceRuntime 编排属后续票；届时 caller 审计随票重做 |

## §11. 文件清单（File Scope）

### ALLOW LIST

- `packages/doc-runtime/src/index.ts` — 新建（~20 行），公共面：re-export `extractYjsSnapshot` + 类型（§3.1）
- `packages/doc-runtime/src/extract.ts` — 新建（~280 行），提取器核心：walk 全景表（§4.3）、union 试验（§4.5）、深拷贝（§4.6）、公共接缝 + 崩溃边界（§4.7/§4.8）
- `packages/doc-runtime/src/carrier.ts` — 新建（~70 行），载体判定（§4.1）+ ROOT 探针（§4.2）
- `packages/doc-runtime/tsconfig.json` — 新建（~4 行），AC5 根 typecheck 接入（§7）
- `package.json`（根）— 修改，`typecheck` script 追加 `&& tsc -p packages/doc-runtime/tsconfig.json`（1 行，§7）
- `packages/doc-runtime/test/extract-yjs-snapshot.test.ts` — `[SA6 owned]` 冻结验收测试（21 用例）。SA3 仅可改测试基础设施（hook/fixture 隔离），**禁改断言逻辑**；当前测试无需任何改动即可驱动本设计
- `packages/doc-runtime/test/extract-plain-domain.test.ts` — `[SA6 owned / R2 追加（SA2 红线 2/3/5；R2.1/R-2 追加锚点）]` **可选增补**：plain 值域违规行为面（bigint 直存与跨端 E1、Date/类实例原型守卫、undefined 数组元素、**function/symbol plain 子树内嵌路由（N1–N3：`set('a',[fn])` → ok:false 单 issue、actual='function'、非 'internal'）**、词表四字段形状）——断言锚定公共接缝（`actual !== 'internal'` 防 E100 误分类回归）；由总控决定走 SA6 增补流程，若落位则受本 ALLOW 管辖，SA3 禁改断言
- `packages/doc-runtime/test/extract-union-trial.test.ts` — `[SA6 owned / R2 追加（SA2 红线 1/4）]` **可选增补**：union 试验语义行为面（Record 形成员接受、成员根载体前置判定、Record/对象成员声明序仲裁）——同上管辖
- `wiki/raw/task_doc-runtime-extract-yjs-snapshot_design.md` — 本设计文档（SA1 产出）

### DENY LIST

- `packages/vfsl/**` — AC1：vfsl 保持零 yjs 依赖；结构树/求值器零改动（D8 自建解析器即为此）
- `packages/persistence/**`、`packages/dsh-persistence/**` — AC1：持久层不新增 vfsl/doc-runtime 依赖
- `packages/vfsl-protocol/**` — ADR-0004：协议包零运行时，与本任务无交集
- `packages/vfsl-codegen/**` — 生成管线与本任务无交集
- `.github/workflows/ci.yml` — node 20/24 matrix 与 pnpm test/typecheck 已覆盖新包（§7 S3），零改动
- `vitest.config.ts` — include 模式已覆盖（§7 S1），零改动
- `pnpm-lock.yaml` — SA6 已登记 importer（S4）；本设计零依赖变更。若实现期确需变更，必须回总控按 SA2 攻击点显式扩展本清单
- `packages/doc-runtime/package.json` — SA6 脚手架已满足全部需求（deps/exports/scripts），不改
- `CONTEXT.md`、`docs/adr/**` — 决议与术语文本非本任务产出

## 附：设计自检（SKILL 一致性要求，R2 复检 + R2.1 增补）

- **自相矛盾扫描**：「判别式」——决策表 D5、§4.5.3、§6 B11 三处均表述为「不读取/死数据」，无一处使用判别式参与选择 ✓；「深拷贝/原型守卫」——D6/§4.6/INV-1/INV-2/B13 表述一致（R1 的「Date 走 object 分支」隐含行为已随 #3 修订消除）✓；「缺失不报」——D4/§4.3 全景表/§6 B3-B5/§5 用例推演一致，且 §4.5.1 明确「Record 形成员无缺失概念」不与 D4 冲突（Record 键集即在场集）✓；「词汇表」——F4 与 §4.1（粗判恒五值）/§4.6（细判 D9② 申报词）/§4.8（可达性实证口径）/D9 家族申报/§10 登记五处口径一致，**R2.1 后 function/symbol 五处统一为「内嵌可达→真 issue、直接位不可达→E100」（B9 限定直接位）** ✓；「undetermined」——已从 WalkResult 删除（D12），全文检索仅在 §4.3 引言（说明删除事实）与 §4.5.4（论证）出现，无残留规格引用 ✓。
- **死引用扫描**：`resolveStructureRef`（§4.3）与 `makeRefResolver`（§4.4）为同一机制的两面，§4.3 表后注释已显式对齐 ✓；R1 的 `undeterminedFallback` 四处调用已随 #7 删除，全文无残留 ✓；`isPlainObjectShallow`（R1 §4.1）已随 #2 两层判定重写删除，全文无残留 ✓。
- **断层扫描**：公共接缝（§3.1/§4.7）与 SA6 测试 import（:61 `../src/index.js`）与 package.json exports（`"." → "./src/index.ts"`）三点一线 ✓；tsconfig/根 typecheck/CI 链路（§7）闭合 ✓；§4.5.1 前置判定/Record 特例与 §5 union 各行推演已同步（R2 同步注记）✓；§4.6 copyPlainValue 签名（新增 loc 参数）与 §4.3 leaf/plain 调用点（`copyPlainValue(live, path, '')`）一致 ✓。
- **SA2 攻击面预判更新**：R1 预判三点均未被 SA2 实际攻击（被攻击的是 R1 未预判的 plain 域可达性与 Record 试验空洞）；R2 新增预判——① D9② 申报词的取舍（'non-plain object' 单词 vs constructor 名进 actual——已裁 actual 稳定词 + message 携带 constructor 名，SA4 复核点）；② 补充测试文件是否落位（总控决策，ALLOW 已备）；③ §4.5.1 前置判定对「成员为 union 嵌套 map」的复合形态（resolve 后 map → 前置判定；resolve 后 union → 直接 walk 由内层 walkUnion 自裁——§4.5.1 第二步分流已覆盖）。

---

## SA2 反馈逐条回应（R1 → R2）

| 要求（SA2 #） | 严重度 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|---|:--:|------|------|
| #1：§4.5.1 增补 Record 形 union 成员特例（无缺失概念、试验=直接 walk） | CRITICAL | ✅ | §4.5.1 第二步分流 + D5 + §6 B14 + 摘要 3 | 明文「Record 形 map 成员（fields 单一 `'<key>'`）无缺失概念，试验 = 直接 walk（键集即在场集）」；引用 evaluate.ts:107 `optional:false` 字面段名论证与 SA2 B-3 t1/t2 实证；统一表述「试验与提交提取的唯一差异 = 封闭 map 形成员的缺必填字段从跳过变软拒」 |
| #2：统一裁决 bigint 等纯值分类（carrierOf 归 plain 域、真 issue、§4.8 实证口径、§4.6 可达性标注） | CRITICAL | ✅ | §4.1（两层判定重写）+ §4.6（bigint 分支 + nested 再分类 + 可达性 docblock）+ §4.8（可达性表按 A1/D1/D2/E1/C1/A2/A3 实证重写）+ D1/D9 + B12 | carrierOf：bigint → `'plain value'`（粗判），细判由 copyPlainValue 产真 issue（actual='bigint'）；结构错位位 actual 恒五值词汇表；E100 只留真正不可达位（function/symbol set 期即抛、AbstractType 变体）；R1「carrierOf null 公共 API 不可达」错误断言已撤并改判 |
| #3：copyPlainValue 原型守卫，Date/类实例 loud 真 issue，禁静默投影 `{}` | MAJOR | ✅ | §4.6 原型守卫分支（`proto === Object.prototype \|\| null` 放行，其余 → plainDomainIssue actual='non-plain object' + message 附 constructor 名）+ D6 + B13 + Date 跨端诚实边界注（Q5b/E2：对端确为真 plain {}，守卫正确放行） | 静默投影 `{}` 判定为伪降级并消除；与 B7 undefined 纪律对齐 |
| #4：plain 域 actual 词表并入 D9 同一偏离申报，登记 §10 与自检附注，转 SA4 复核 | MAJOR | ✅ | D9 重写为「词汇表偏离家族统一申报」（① 'internal'；② 'bigint'/'undefined'/'non-plain object' 可达 + 'function'/'symbol' 不可达防御，expected 恒词汇表内）+ §10 R2/#4 登记块（SA4 裁决请求）+ 自检附注「词汇表」五处口径一致声明 + 补充测试文件入 ALLOW（红线 5 的四字段形状锚定） | 同仓单一纪律：所有词汇表外 actual 集中 D9 申报 |
| #5：§4.5.1 增补成员根载体前置判定为试验第一步 | MAJOR | ✅ | §4.5.1 第一步（恒定前置：map 形成员 carrierOf(live)==='Y.Map'，不匹配 → 拒 + 真 issue 与 walk mismatch 同款；非 map 形由其 walk 内建）+ 封死的两病态（TypeError→E100 / 全可选裸接受）+ 红灯锚推演（`['u']` Y.Map/plain value 绝非 internal）+ §5 R2 同步注记（R1 推演隐含假设已成明文）+ B14 | 前置判定与 R1 §5 推演一致化 |
| #6：§9 P2/P3 等行内联命令与关键输出 | MINOR | ✅ | §9 P2a-c/P3a-d 行：完整 `node -e "…"` 内联命令 + 逐行关键输出（THROW/ok 序列）+ SA2 附录 B-1 XF/F1-F4 复证引用；§9 引言改为 R2 口径（含 SA4 重跑方式） | SA4 可直接重跑 |
| #7：'undetermined' 死规格二选一处理 | MINOR | ✅ | 选**删除**：D12 新决策行 + WalkResult 两结局（§4.3）+ map/array 伪代码四处 `undeterminedFallback` 分支删除 + §4.5.4 重写为「出口 3 内联消化 + 递归终止论证」+ §4.5.1 统一表述（软拒只在成员自身字段层产生） | 类型即不变式，SA3 无法实现/测试「永不发生」的分支 |
| #8：plainDomainIssue 锚定精度 + `__proto__` own-key | MINOR | ✅ | §4.6：`loc` 位置线贯穿递归（`[i]`/`.k`），进 message（`，内部位置 ROOT.a[1]`）不进 path；对象键一律 `Object.defineProperty` 写入（Q3/Q4 实测 own `__proto__` yjs 存取原引用 + JSON 往返保留）；B15 + D6 | 排障信息不损失；原型污染/键静默丢失封死 |

**R2 必改项清单（SA2 结论节）逐项对照**：①（#1/#5）→ §4.5.1 两步重写 ✅；②（#2）→ §4.1/§4.6/§4.8 ✅；③（#3）→ §4.6/B13 ✅；④（#4）→ D9/§10/自检/ALLOW ✅；⑤（#6/#7/#8）→ §9/§4.3+§4.5.4/§4.6 ✅。SA2 明示「§3/§5/§7/§10/§11 与 21 用例映射无需重做」——§5 仅追加 R2 同步注记（推演结论不变）、§10 仅追加 #4 登记块、§11 仅追加两份可选补充测试文件（[SA6 owned]，ALLOW 只增不删立法），核心结构未动。

### R2.1 文档 touch-up（SA2 R2 复审 pass 后遗留项，零机制变更——2026-08-22）

| 要求（SA2 残留 #） | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| R-1：§9 P2/P3 内联命令 `({default:Y})` 解构错误（yjs ESM 无 default export，verbatim 复跑 TypeError），按 SA2 附录 C 修正变体改写 | ✅ | §9 P2a-c/P3a-d 行 | 命令解构改 namespace 变体 `import('yjs').then((Y)=>{…})`，并补 `cd packages/doc-runtime &&` 前缀；依据栏注明「R2.1/R-1 修正解构——SA2 复审 verbatim 复跑诊断确认（附录 C：`typeof default: undefined \| typeof Doc: function`）」；证据内容与输出记载不变（SA2 修正变体复跑逐行一致） |
| R-2：function/symbol 可达性改判——直接位不可达（A2/A3）仍成立，plain 子树内嵌可达（SA2 新探针 N1–N3），三处标注从「不可达防御」改「内嵌可达→真 issue」（机制行为不变：尾分支真 issue + 词已申报） | ✅ | §4.1 carrierOf docblock + §4.6 docblock 与尾分支注释 + §4.8 可达性行（拆为内嵌可达真 issue / 直接位不可达 E100 两行）+ D9②（'function'/'symbol' 改判入可达组）+ §6 B9（限定「直接位」，内嵌归 B7）+ §10 登记块（五词均可达）+ §9 新增 N1–N4 证据行（SA2 复审 + SA1 R2.1 独立复现互证：N1 `[fn]` same-ref / N2 `{k:fn}` / N3 `[Symbol]` / N4 encode ok / 对照直接位 THROW）+ §11 补充测试文件锚点（`set('a',[fn])` → actual='function' 非 'internal'） | 标注层改判完成；伪代码、词汇表、E100 边界机制零变更 |

**R2.1 自检**：`({default:Y})` 解构在**可执行命令文本**中零残留（仅存于 R-1 历史记录行；Q1 行同患同修并实跑验证）；「不可达防御 + function/symbol」的**规格性**表述零残留——余下命中均为历史记录（R2 回应表 #4 行）、被否方案栏（D9 第三列）或改判叙述本身，B9 已限定「直接位」、D9② 已入可达组、§4.1/§4.6/§4.8/§10/§11 口径一致；§9 新命令（P2/P3/Q1）均以 namespace 变体 verbatim 实跑验证、输出与记载逐行一致（P3 记载已按实跑校准）；SA2 R2 复审 pass 辖域未越（零机制变更承诺兑现）。
