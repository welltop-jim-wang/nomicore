# SA1 设计文档 — doc-runtime：schema-independent ROOT 载体投影读取（issue #86 / Phase 2）

> **R2 修订（2026-08-23）**：落实 SA2 R1 攻击评审（verdict=reject，见 `…_sa2_review.md`）全部 must-fix #1–#4 与 should-fix #5–#8。修订点以「R2」标注散布正文；逐条对照见文末「SA2 反馈逐条回应」表。R1 版总体架构（载体驱动重写、D2 两层分类器、D5 键空间统一、D7 拷贝器分叉、D10 崩溃边界、§6.2 删除授权链）经 SA2 认定不需返工；修订均为局部裁决与文本修正。SA2 全部实证（detached 载体行为、matchPattern 覆盖缺口、行数 1479）已经 SA1 本轮独立复测确认后再落实（探针输出见 §8 A14）。
>
> **R3 修订（2026-08-23）**：落实 SA2 R2 复审（reject，仅两点，见评审文末「R2 复审」节）：**R2-1**（MEDIUM must-fix）零副作用锚三重自相矛盾——按方案 (i) 改写主锚（空 doc + `[0]` 段型不符）+ 方案 (ii) 落为独立对照锚（title fixture + update 0/toJSON 前后相等），并顺带将 guards fixture 规格显式化以根除歧义；**R2-2**（LOW）vfsl/test 计数 27→26（`.test.ts` 口径；目录另有 1 个 `validate-logical-snapshot.contract.ts` 共享文件共 27 条目——口径注记一并入文，SA1 本轮 `ls`/`find` 双口径复测确认）。顺带落实 SA2 三项 INFO 建议（guards fixture 规格 / E16 destroyed doc 实测注记 / E20 跨 doc 别名注记 + detached 三形态并列锚）。SA2 R2 复审判定：R1 八点 100% 核销、R2 新机制（ProjectOutcome/detached 守卫/SUP-5 移植/Proxy 划界/G0 前缀）经二轮攻击全部成立、「其余一切无需再动」。
>
> **R4 修订（2026-08-23，SA4 静态验尸 F2 处置指令）**：§7 文件清单修订——`packages/doc-runtime/package.json` 从 DENY「零改动」移入 ALLOW，**仅限 patch 版本号 bump（0.1.5 → 0.1.6）**。SA3 的 bump 是履行 MABF 硬门禁 #9「所有改过代码的模块必须 bump patch 版本号」（read.ts 重写即改代码）；R1–R3 的 DENY 行原意是「零依赖改动」，未按字段粒度识别硬门禁的优先级，致 SA4 按 §1.1 判 scope 违规（F2）。依赖（vfsl/yjs/devDeps）与其他字段零改动不变，`tsconfig.json` 仍 DENY；§6.1 生产代码表同步修订。本修订为 F2 单点处置，不触设计其余任何裁决。（SA4 R2 复审已核销本处置，字段级比对通过。）
>
> **R5 修订（2026-08-23，SA4 R2 复审处置指令——设计勘误两项）**：(1) **§4 蓝本错误通道勘误**——catch 块与 notAllowed 的一切「不可信值→string/数组」转换改经 `safeDetail`/`safeSpreadPath` 助手（蓝本与 SA3 实现 5c5668f 同步）；`safeDetail` 返回前 `typeof raw === 'string'` 收窄，非原始 string（敌意 toString 对象/Symbol 数据属性——SA4 R2-F1a NEW1/NEW2 向量）一律回退 `'unstringifiable'`，防下轮照抄蓝本再犯。(2) **D2/D6 isPlainRecord 正式勘误**——plainObject 判据从 R1 字面规则 `proto ∈ {Object.prototype, null}` 更正为原型链级 isPlainRecord（SA4 R1-D3 验证「必要且安全」并接受：字面规则与冻结 AC3 fixture protoObj 三层 plain 中继链矛盾，冻结契约「不得收窄」优先；constructor 经 descriptor 读零 getter 执行、深度上限 32、超深链/跨 realm 保守 loud、链顶 null 放行）。D6/E13 表述同步。

- **Issue**: #86（welltop-jim-wang/nomicore），branch `fix/issue-86-on-docs-namespace-runtime`，base `docs/namespace-runtime`（Parent PR #85）
- **任务类型**: 功能开发（ADR-0008「必要的底层演进」第 1 条的直接落实）
- **SA6 冻结契约**: `packages/doc-runtime/test/read-logical-value-at-path-schema-independent.test.ts`（行为 33 例）+ `.test-d.ts`（类型 4 例）——本设计**不收窄**其任何可观测契约，仅做补充裁决
- **约束基准**: `wiki/raw/task_doc-runtime-root-carrier-projection-read_relevant_decisions.md`（SA8 产出；ADR-0008 直接治理 + ADR-0007 仍生效条款 + ADR-0003/0004/0006 + CONTEXT.md 词条）

---

## §0. 任务定位与红灯机理

### 0.1 演进指令（ADR-0008 原文）

> 「Runtime 实现前先完成以下 `@nomicore/doc-runtime` 契约演进：1. `readLogicalValueAtPath(derived, doc, path)` 改为 schema-independent 的 `readLogicalValueAtPath(doc, path)`」

配套读取语义（同 ADR「读取签名与载体语义」节，全部逐条落实，见 §5 AC 映射表）：string/严格非负整数 segment、缺键/越界成功 `undefined`、own enumerable string data property、plain 子树 JSON 值域、Y.XmlFragment 语义字符串终态、未知 shared type 响亮失败无 toJSON fallback、空 path 深拷贝完整 ROOT、返回可变普通深拷贝、预期失败走同步结果联合。

### 0.2 红灯现状（构造性红灯，SA6 已验证）

当前 `read.ts` 是 issue #75 冻结的 schema-aware 三参实现（Phase A 纯 schema 许可判定 + Phase B 活数据解析）。SA6 新测试全以双参调用：运行时 `derived` 位收到 `Y.Doc` → `derived.structure` 取空 → 顶层崩溃边界 `{ok:false, code:'PATH_NOT_ALLOWED', path:[], message:'DOCRT-E100…'}` → 37 例全红；类型层 TS2554×64 + TS2554/TS2578。SA3 实现新签名后转绿。

### 0.3 为什么不能在旧实现上做兼容层（需求推演）

旧 Phase A/B 的每个部件都以 schema 概念为地基：

| 旧部件 | 依赖的 schema 概念 | 在新契约下的状态 |
|---|---|---|
| Phase A `isPathAllowed`/`decide` | 结构树 kinds、字段封闭集、Record keyPattern、optional | **整体失效**——新契约无「schema 不允许的路径」这一类别（红线：任意 string 键可导航） |
| Phase B `resolveLive`/`navigate` | StructureNode 游标、union any-of 成员序、memo | **整体失效**——union/Record/optional 均为 schema 词汇 |
| `arbitrateUnion`/`memberOutcomes`/`NavOutcome` | union 三态仲裁 | **整体失效**（rev2 的包内导出随实现一并退役） |
| `makeValuesResolver`/`keyAllowed`/`vChild` | values 树锁步、pattern 引擎 | **整体失效** |
| `walk`（extract.ts，@internal） | StructureNode switch（map/Record/array/union/leaf/plain/xml 分发） | 不可复用——walk 的每个分支都需要节点；schema-independent 读取只有 live 载体 |
| `probeRoot`/`carrierOf`（carrier.ts） | 无 schema 依赖 | **原样复用**（§3 D2/D9） |

结论：**重写 `read.ts` 为载体驱动（carrier-driven）实现**，而非给旧实现加分支。这不是推翻旧设计——旧设计锚定的 schema-aware 语义已被 ADR-0008 明文取代（ADR-0007 相应条款标注「已由 ADR 0008 取代」），被取代物的测试与实现按 AC7 同步退役。

### 0.4 调用面盘点（变更半径实测）

```bash
git grep -n "readLogicalValueAtPath" -- ':!wiki' ':!node_modules'
```

结果：生产代码 caller **为零**。命中仅：`CONTEXT.md` / `docs/adr/0007` / `docs/adr/0008`（文档）、`packages/vfsl/src/index.ts:86`（注释提及）、`packages/doc-runtime/src/index.ts`（导出）、`packages/doc-runtime/src/read.ts`（实现）、`packages/doc-runtime/test/read-logical-value-at-path*.test.ts`（新旧测试）。另实测 `@nomicore/doc-runtime` 包**无任何包外消费方**（grep apps/packages/domains/tests 零命中）。签名改造的连锁半径 = 包内测试 + index.ts 出口注释。完整 caller 审计见 §9。

---

## §1. 冻结契约重申（本设计的硬边界）

SA6 冻结、SA1 只可补充不可收窄：

1. **公共接缝**：`readLogicalValueAtPath(doc: Y.Doc, path: readonly (string | number)[])`，经 `packages/doc-runtime/src/index.ts` 导出；同步、不抛错。
2. **结果联合**（issue #75 注记 B 形态延续）：
   `{ ok: true; value: unknown } | { ok: false; code: 'PATH_NOT_ALLOWED'; path: readonly (string | number)[]; message?: string }`
   —— 预期 path/载体失败统一此通道；`message` 为诊断增补（非契约字段）。
3. **schema-independent 红线**：`['任意string键']` 不再因「schema 未知字段」返回 PATH_NOT_ALLOWED，而是「容器缺键 → ok:true, value:undefined」或「值域违规 → ok:false」。
4. 37 例行为/类型断言（AC1–AC6）的全部可观测面。

本设计的补充裁决（SA6 未锚定的边缘）逐条列于 §5.2，均以「不与任何冻结断言冲突」为前提，并给出行为依据。

---

## §2. 总体架构：载体驱动的两阶段模型

```
readLogicalValueAtPath(doc, path)
│
├─ G0  path 形态守卫（非数组 → 归一失败，零外抛；message 带 DOCRT-E100 前缀——R2：与旧 F2 守卫可观测行为逐字一致；SA4-F2 勘误守卫延续）
│
├─ N0  ROOT 探针（复用 carrier.ts probeRoot —— 唯一触碰 doc 的入口，只碰 'ROOT'）
│      ├─ 缺席 → getMap 惰性创建空 map（零 update 事件，探针 P3）→ 视为空容器
│      └─ 异型（Y.Array/Y.XmlFragment/Y.Text）→ PATH_NOT_ALLOWED（C4）
│
├─ N1  导航循环 navigate：cur = ROOT Y.Map；逐段下钻
│      ├─ 段纪律（string ↔ map/object；严格非负整数 ↔ array）
│      ├─ 合法缺席（缺键/越界/键空间外）→ 立即 {ok:true, value:undefined}（中间缺失立即结束）
│      └─ 段型不符 / 不可下钻终态 / 路径上值域违规 / detached 载体（R2 #2）→ PATH_NOT_ALLOWED（C1/C2/C3）
│
└─ P1  定点投影 project：路径耗尽处按实际载体转换目标子树
       ├─ detached 守卫（Yjs 家族 v.doc === null → loud，R2 #2）
       ├─ Y.Map / Y.Array → 递归投影
       ├─ Y.XmlFragment 家族 → toString() 语义字符串（终态）
       ├─ plain 域 → copyPlainStrict（descriptor 读 + JSON 值域 loud + 深拷贝）
       └─ Y.Text 等导航词汇表外 shared type → PATH_NOT_ALLOWED（无 toJSON fallback）

全程包在顶层 try/catch（崩溃边界 E100，FC-1 同步不抛）。
```

与旧两阶段的对称性：Phase A（纯 schema 许可）整体删除——载体驱动导航**天然零 schema**，许可判定与活数据解析合一（不存在「schema 允许但 live 拒绝」的分裂面，也就不需要 memo 折叠 union 回溯——union 概念消失后最坏 2^n 回溯的来源消失，**模块级零可变态、零 memo**，INV-R10）。

---

## §3. 核心设计决策（D1–D12）

### D1 — 重写 read.ts 为载体驱动两阶段（导航 + 定点投影）

新实现 ~280 行替换旧 417 行。文件内聚：`read.ts` 继续作为唯一公共读取实现（index.ts 导出符号名不变：`readLogicalValueAtPath` + `ReadLogicalValueResult`）。`@nomicore/vfsl` 的 import 从 read.ts 全部移除（extract/materialize 仍依赖 vfsl；package.json 依赖不动，仅 version 字段 patch bump——R4/SA4-F2，见 §6.1/§7）。

### D2 — 导航载体词汇表 `NavCarrier`（基于 carrierOf 的细分分类器）

`carrierOf`（carrier.ts，五值词汇表 + null 不可达态）原样复用作粗判第一层；read.ts 内部细分第二层：

| NavCarrier | 判定 | 导航语义 | 投影语义 |
|---|---|---|---|
| `ymap` | `carrierOf === 'Y.Map'`（注：含 XmlHook——见 §5.2 E12） | string 段下钻 | 递归投影 entries |
| `yarray` | `carrierOf === 'Y.Array'` | 严格非负整数段下钻 | 递归投影 elements |
| `xml` | `carrierOf === 'Y.XmlFragment'`（含 XmlElement 子类，探针 P4） | **不可下钻终态** → 段未耗尽即 C2 | `toString()` 语义字符串 |
| `text` | `carrierOf === 'Y.Text'`（含 XmlText 子类，探针 P4） | 不可下钻 → C3 | **响亮失败**（无 toJSON/toString fallback，AC5 锚定） |
| `unknownShared` | `carrierOf === null` 且 `v instanceof Y.AbstractType` | 不可下钻 → C3 | 响亮失败（ADR-0008「未知 Yjs shared type」） |
| `detached` | Yjs 家族（上述四类 + AbstractType）且 `v.doc === null`（未集成 doc；R2 #2） | **响亮失败** → C3（不可借道/不可下钻） | 响亮失败（同一守卫，禁空投影） |
| `plainObject` | `carrierOf === 'plain value'` 且非 array、**isPlainRecord 判真**（R5 勘误，判据见下方 R5 勘误段——R1 字面规则 `proto ∈ {Object.prototype, null}` 与冻结 AC3 fixture 矛盾） | 键空间段下钻（D5） | copyPlainStrict 对象分支 |
| `plainArray` | `Array.isArray(v)` | 严格非负整数段下钻 | copyPlainStrict 数组分支 |
| `scalar` | `string / number / boolean / null` | **不可下钻** → C2（「标量不可作为容器」，AC2 锚定） | number 有限性细判；其余直通 |
| `nonPlainObject` | plain value 且非 array、isPlainRecord 判假（Date/类实例/超深链/跨 realm——R5） | 不可下钻 → C3 | 响亮失败（原型守卫，extract R2/#3 同族；判据见 R5 勘误段） |
| `violation` | `bigint / function / symbol / undefined`（carrierOf null 或 bigint 分支） | 路径上出现 → C3 | copyPlainStrict 响亮失败 |

`xml` 与 `text` 分开建模的原因：XmlFragment 是**合法终态**（投影产出语义字符串），Y.Text 是**词汇表外类型**（投影响亮失败）——AC5 把两者钉在不同结局上，分类器必须区分。

**detached 守卫（R2，SA2 #2 方案 a 采纳）**：Yjs 家族载体（ymap/yarray/xml/text/unknownShared）在导航与投影期统一前置检测 `v.doc === null`（未集成 doc 的 detached 实例；O(1) 属性读）→ 归入 `detached` 载体类 → PATH_NOT_ALLOWED loud（message：`'detached Yjs 载体（<申报词>，未集成 doc）不可读'`）。依据（实测，§8 A14）：detached 读语义 = 空 + **每次调用触发 yjs `console.warn('Invalid access: Add Yjs type to a document before reading data.')`**；detached `Y.XmlFragment.toString()` 返回 `''`（length=1 的非空片段内容静默蒸发）；detached 写静默 no-op——放行即「ok:true 空投影 + 告警噪声」，违反 AC4「绝不静默丢弃」精神与 ok:true 路径零副作用纪律。零误伤论证：经 ROOT 探针到达的容器恒 attached（实测 `doc !== null`）；Y.Map 内 set 的 Yjs 子类型由 yjs 自动集成（attached）；**别名集成载体**（同一实例先 `root.set` 集成、再塞 plain 容器）`doc !== null`，借道读真实数据不受影响（E20）；detached 仅在「plain 容器持有的从未集成引用」上出现（公共 API 直接可达：`root.set('holder', { frag })`）。冻结 37 例无借道下钻用例，守卫零影响。

**isPlainRecord 勘误（R5，SA4 R2 复审处置指令——正式回收 R1-D3 偏离，消除设计与实现字面漂移）**：R1 字面判据 `proto ∈ {Object.prototype, null}` 与冻结 AC3 fixture **直接矛盾**——fixture `protoObj = Object.create(proto)`、`proto = Object.create({inherited:'from-proto'})`（带 enumerable accessor）构成三层自定义 plain 中继链，冻结断言 `['protoObj']` → 投影 `{own:'v'}`（EXPECTED_ROOT 明文）；按字面规则 protoObj 应判 nonPlainObject → loud → 冻结测试红。SA6 冻结契约「不得收窄」优先于设计文本，实现采用**原型链级 isPlainRecord**（SA3 实现期捕获该矛盾；SA1/SA2 三轮评审均未发现；SA4 R1-D3 核验「必要且安全」并接受）。**正式判据**：

- 沿原型链上溯（**深度上限 32 层**，超限保守判假 → nonPlainObject），链上每个**非 `Object.prototype`** 节点的 own `constructor` **descriptor** 必须缺失、或值为 `Object`/`undefined`，任一节点违规即判 nonPlainObject；链顶 `null` 终止放行（`Object.create(null)` 家族，E13 行为结局不变）。
- **constructor 读取一律经 `getOwnPropertyDescriptor`**（零 getter 执行，INV-R4 完好——SA4 实测）；原型链仅用于**分类**，值读取永不走原型链（readableOwnDataValue 只读 own descriptor，INV-R5 完好）；导航与投影同一判据（INV-R11 不分裂）。
- **保守方向**：超深链（>32 层，SA4 探针：41 层链 → loud）与跨 realm 对象（对侧 `Object.prototype` 的 constructor ≠ 本侧 `Object`）均保守 loud。
- **行为结局对照**（SA4 实测逐项核验）：Date/类实例仍 loud（guards Date 锚绿）；三层中继 plain 链 → 投影 `{own:'v'}`、原型继承键导航 → ok:true undefined、原型 getter 键导航 → ok:true undefined（零触发）。

### D3 — segment 纪律（ADR-0007 仍生效条款的延续）

- map/plain object 载体：段必须 `typeof seg === 'string'`（number 段 → C1；symbol/object/boolean 等运行时野段同样被 typeof 判拒，零抛点）。
- Y.Array/plain array 载体：段必须 `Number.isInteger(seg) && seg >= 0`（负数/非整数/字符串 → C1）。
- **-0**：`Number.isInteger(-0) && -0 >= 0` 为 true → 合法段；`ya.get(-0)` 实测返回元素 0（探针 C）、`arr[-0]` 索引语义归一 0——与旧 `validArraySeg` 注释裁决逐字一致（旧 supplementary 已锚，§6 移植）。
- **超大合法整数（2^53）**：整数且非负 → 合法段，`>= length` → 越界吸收（旧 supplementary 已锚，§6 移植）。
- 点号字符串/JSON Pointer：类型层由 `readonly (string | number)[]` 拒绝（test-d 锚定）；运行时 string 段中的点号/空格是**合法键名**（`'sp ace.key'`，AC1 锚定）——段从不拆分、从不解释。

### D4 — 缺席语义：三源吸收 + 数组元素 undefined 响亮（非对称是有意的）

| 场景 | 裁决 | 依据 |
|---|---|---|
| Y.Map 缺键（`get(seg) === undefined`） | `{ok:true, value:undefined}`（吸收） | AC2 锚定 |
| Y.Map 键显式存 `undefined`（`has=true, get=undefined`，探针 L 可达） | **吸收为缺席**（导航 → ok:true undefined；投影 → 键省略） | (a) yjs 自家 `Y.Map.toJSON()` 同样省略该键（探针 P1：`keys=["u"], toJSON={}`）；(b) 旧实现 D4「get()===undefined 视同缺席」先例；(c) SA6 只把「**数组内** undefined」列入违规清单——map/object 键位 undefined 未列入（有 bigint-in-object 对照：`{v:1n}` 被锚为违规，若 `{v:undefined}` 也想违规，平行用例不会缺席）；(d) 逻辑域无损论证见下 |
| plain object 键空间外（缺键/accessor/non-enumerable/原型/symbol 键/值为 undefined） | `{ok:true, value:undefined}`（吸收） | (a)(b)(d) 同上 + AC3「accessor 不产出」锚定（不产出 ≡ 投影后该键不存在 ≡ 导航到它等于导航到缺席键——键空间模型自洽性，D5） |
| Y.Array / plain array 越界 | `{ok:true, value:undefined}`（吸收） | AC2 锚定 |
| **plain array 在界 undefined 元素**（含稀疏空洞 `[1,,3]`） | **响亮失败 PATH_NOT_ALLOWED** | AC4 锚定（`[1, undefined]`）；JSON.stringify 会静默 null 化——位置语义不可省略（省略即移位，静默篡改长度），loud 是唯一不腐败的选择 |
| Y.Array 在界 undefined 元素 | 响亮失败（防御分支） | 公共 API 造不出：attached（已集成 doc）`insert(0,[undefined])` 实测 throw；detached 同调用静默 no-op 且 length 不变（R2 #5 attached 限定，§8 A1/A14、E21）——两情形都造不出 undefined 元素；防御路径与 plain array 同判，保持「数组位置 undefined = 违规」全一致 |

**非对称的原则性论证**（SA2 预答）：object/map 的键是**无序命名空间**，`{a: undefined}` 与 `{}` 在 JSON/逻辑域是同一个值（`JSON.stringify({a:undefined}) === '{}'`，yjs toJSON 同）——吸收**在投影域零信息损失**；array 的位置是**有序计数**，`[1,undefined]` 与 `[1]` 是不同长度、不同逻辑值——丢弃/转换即静默腐败。SA6 的锚定清单（bigint、non-finite、数组内 undefined、嵌套 Yjs）恰好沿这条线切分，本设计沿用同一条线。

**中间缺失立即结束**：导航一旦吸收缺席，剩余段不再消费、不再触碰 doc（`['meta','missing','deep']` → ok:true undefined，AC2 锚定）。

### D5 — AC3 键空间模型：导航与投影共用同一读取助手（INV-R11）

plain object 的**可读键空间** = own enumerable **string data** property（ADR-0008 措辞，比任务 AC3 多「string」一词——按 SA8 措辞对齐备注从严执行；symbol 键 `Object.keys` 天然排除，探针 H）。

实现上导航与投影**必须**调用同一助手（否则 `read(doc, ['acc']).secret` 与 `read(doc, ['acc','secret'])` 语义分裂）：

```
readableOwnDataValue(obj, key):
  desc = Object.getOwnPropertyDescriptor(obj, key)   // 不执行 getter（探针 J：descriptor 读取零触发）
  if desc 为空                 → NONE   // 缺键 / 原型链（getOwnPropertyDescriptor 不查原型链）
  if desc.get 或 desc.set 存在 → NONE   // enumerable accessor：不执行、不产出（AC3 锚定；Object.keys
                                        //   会列出 enumerable accessor，故必须经 descriptor 而非索引读——
                                        //   探针 I 实测索引读会执行 getter 并把返回值算进快照）
  if desc.value === undefined  → NONE   // 吸收（D4）
  return desc.value                    // own enumerable data property（non-enumerable 不在 Object.keys 内，
                                        //   投影枚举天然排除；导航直查 descriptor 时 enumerable=false 的
                                        //   data 键 desc 存在但非 enumerable → 见下方补丁）
```

**枚举性补丁**：导航是按键直查（不经 Object.keys），`Object.getOwnPropertyDescriptor` 对 non-enumerable data 键同样返回 descriptor——必须显式检查 `desc.enumerable === true`，否则导航会读 到 AC3 排除的 non-enumerable 键（fixture `nonEnum.hidden`：导航 `['nonEnum','hidden']` 必须缺席，投影必须不产出——两侧同键空间）。修正后：

```
readableOwnDataValue(obj, key):
  desc = Object.getOwnPropertyDescriptor(obj, key)
  if desc 为空                    → NONE
  if desc.enumerable !== true     → NONE   // non-enumerable 键空间外（AC3 锚定）
  if desc.get !== undefined 或 desc.set !== undefined → NONE   // accessor：不执行不产出
  if desc.value === undefined     → NONE   // 吸收
  return desc.value
```

plain array 元素读取同理统一为 `readableArrayElement(arr, i)`（descriptor 守卫，INV-R4 全局零 accessor 执行）：

```
readableArrayElement(arr, i):
  if i >= arr.length                       → NONE   // 越界吸收（D4）
  desc = Object.getOwnPropertyDescriptor(arr, i)
  if desc 为空                              → VIOLATION('undefined')   // 稀疏空洞
  if desc.get !== undefined 或 desc.set     → VIOLATION('accessor')    // 无法零副作用取值且位置不可省略 → loud
  if desc.value === undefined              → VIOLATION('undefined')   // AC4 锚定
  return desc.value
```

（Y.Array 元素读取无需 descriptor——yjs 类型系统无 accessor 下标病理；越界→NONE，在界 undefined→VIOLATION 防御分支。）

**Proxy 划界（R2 #7）**：本节零 accessor 执行承诺（INV-R4）限于**普通对象语义载体**。调用方数据自带 Proxy trap 时，`Object.keys`/`getOwnPropertyDescriptor`/`getPrototypeOf`（proto 守卫、两助手均调用）都会触发 trap——那是一次调用方代码执行，属数据自带行为，超出读取契约边界；trap throw 由顶层崩溃边界 E100 结构化收编（不外抛，INV-R1）。不为此增设任何 Proxy 特判分支（见 E22 与 guards Proxy 锚）。

### D6 — 定点投影纪律（project + copyPlainStrict 双递归）

**失败通道记号（R2 #1）**：`projectValue`/`copyPlainStrict` 的返回一律为判别联合 `ProjectOutcome = { kind: 'value'; v: unknown } | { kind: 'fail'; msg: string }`——**明文禁止 `null`/`undefined` 作失败哨兵**。理由：`null` 是完全合法的投影值（冻结 fixture `nothing: null`、`arr[3] === null`、copyPlainStrict 的 `string/boolean/null → v` 分支原样返回 null）——若以 `r === null` 判失败，`read(doc, ['nothing'])`、`read(doc, ['arr', 3])` 与空 path 全量读（EXPECTED_ROOT 含 `nothing: null`）会全部误判为 PATH_NOT_ALLOWED，冻结 AC1 直接红。本文下述伪代码的 `FAIL(...)` 记号一律指 ProjectOutcome 的 fail 侧（携带申报词与内部位置线）。

路径耗尽处的转换按 `NavCarrier` 分发。关键区分：**Yjs 容器递归**（projectValue）与 **plain 域拷贝**（copyPlainStrict）是两条互不递归进对方 Yjs 分支的递归：

```
projectValue(v): ProjectOutcome                             // R2 #1：判别联合（禁 null/undefined 哨兵）
  detached    → v 属 Yjs 家族且 v.doc === null → FAIL('detached Yjs 载体（未集成 doc）不可读')   // R2 #2 守卫
  ymap        → 逐 keys() 投影（get(k)===undefined → 键省略，吸收）；defineProperty 四真写入（§D6 尾注）
  yarray      → 逐下标投影（在界 undefined → VIOLATION 防御）
  xml         → v.toString()               // 语义字符串（探针 B：attached 实测 '<p>Hello <b>world</b></p>'）
  text/unknownShared → FAIL('未知 Yjs shared type（无 toJSON fallback）')   // AC5 锚定
  其余        → copyPlainStrict(v)          // scalar / plainObject / plainArray / nonPlainObject / violation

copyPlainStrict(v): ProjectOutcome                          // R2 #1：同款判别联合；plain 域拷贝器（JSON 值域纪律，AC3/AC4 锚定面）
  number     → Number.isFinite(v) ? v : FAIL('non-finite number')   // NaN/±Infinity：探针 P14 可达；禁静默 null 化
  string/boolean/null → v
  bigint     → FAIL('bigint')               // 探针 P15 可达（对象值位：{v:1n}；直存位同判）
  undefined/function/symbol → FAIL(...)     // 函数/符号：直存位 yjs set 期即抛（探针 P16），plain 容器内嵌可达
  Yjs 家族（carrierOf 粗判命中四类或 AbstractType）→ FAIL('嵌套 Yjs shared type')  // AC4 锚定（探针 P17 引用保留可达）
  plainArray → 逐元素 readableArrayElement + 递归 copyPlainStrict（VIOLATION → FAIL）
  plainObject→ isPlainRecord 守卫（判假 → FAIL('non-plain object')：Date/类实例/超深链/跨 realm；判据与勘误见 D2 R5 段）
               逐 Object.keys(v) 经 readableOwnDataValue（NONE → 键省略）+ 递归 copyPlainStrict
               输出键写入经 defineProperty 四真（'__proto__' 自有键安全，Y.Map 键 '__proto__' 公共 API 直接可达——探针 P7）
```

plain 域拷贝器**独立实现于 read.ts**，不共享 extract.ts 的 `copyPlainValue`——分叉理由见 D7。

**defineProperty 四真尾注（AC6 陷阱）**：输出对象/数组容器的一切键写入必须 `Object.defineProperty(out, k, { value, writable: true, enumerable: true, configurable: true })`。漏传描述符时 defineProperty 默认 `writable:false, configurable:false` → 事实冻结 → AC6「不 freeze、顶层与嵌套均可写」直接红。数组元素可用 push（下标语义无 `__proto__` accessor 病理），对象键一律 defineProperty。

### D7 — 与 extract.ts `copyPlainValue` 的关系：显式分叉，不共享（附潜在缺陷申报）

两者纪律高度同源（number 有限性拆支、bigint/non-finite/数组 undefined/function/symbol/原型守卫/嵌套 Yjs 全部 loud、defineProperty 安全写入），但存在两处**可观测行为差异**，共享一个实现必改其一契约：

| 差异点 | extract.ts copyPlainValue（现状） | read.ts copyPlainStrict（本设计） | 依据 |
|---|---|---|---|
| plain object enumerable accessor 键 | `Object.keys` + **索引读 → 执行 getter**，返回值进快照（探针 I 实测复现路径） | descriptor 读 → **零执行、不产出**（NONE 吸收） | AC3 锚定「副作用计数器零触发」；extract 现状是**潜在缺陷**（只读提取执行用户代码） |
| plain object 值为 undefined 的键 | `if (val === undefined) continue` 省略（注释：= JSON 投影 + validate present() 惯例） | 省略（吸收，同结局） | 结局一致，机制不同（descriptor 显式建模） |

**裁决：分叉**。理由：(a) 修 extract 的 accessor 执行会改变已交付契约（extractYjsSnapshot）的可观测行为——其快照会从「包含 getter 返回值」变为「省略」，超出本任务 AC 范围（scope creep）；(b) 不修而共享则 read 违反 AC3 冻结锚定；(c) 两者的下游校准不同——extract 处于 schema-aware 管线（后置 validateLogicalSnapshot），read 是独立公共投影（无后置）。extract 的 accessor 执行列为**已申报的已知潜在缺陷**（本任务 DENY extract.ts，建议后续独立任务修复；届时两拷贝器可评估合并回单一 seam——D7 单一转换语义源原则在两契约收敛后恢复）。

### D8 — 失败通道：单 code 多因由 + path 新鲜副本 + SA4-F2 守卫 + E100 崩溃边界

- 一切预期失败统一 `{ok:false, code:'PATH_NOT_ALLOWED', path:[...整条尝试路径], message}`（SA6 冻结，fail-fast 单错、path 回显与 ExtractIssue.path 先例一致）。
- `notAllowed(path, message)` 沿用旧实现的**新鲜副本**纪律（不别名调用方数组）与 **SA4-F2 守卫**（R5 升级为 `safeSpreadPath` 助手：`Array.isArray` 前置 + 内层 try 包 spread、失败回退 `[]`——非数组 path 归一 `[]`，且 Proxy 包装数组的敌意 `Symbol.iterator` 抛出被内层收编，SA4 R1-F1 P10 向量；蓝本见 §4 助手区）。G0 入口对非数组 path 提前归一失败（`'zz'`/`0`/`null` → `{ok:false, path:[]}` 零外抛），与旧 supplementary F2 锁行为逐字一致（§6 移植）。
- **message 模板**（非契约字段，统一前缀便于日志检索，F7 自由域）：
  - G0：`'DOCRT-E100: path 必须是段数组（readonly (string | number)[]）'`（R2：类型外 path = 调用方编程错误，归 internal-bug 域与崩溃边界共用前缀——与旧 F2 守卫可观测行为逐字一致，supplementary L288–297 的 message 前缀锚原样可移植）
  - C1 段纪律：`'第 i 段 <seg> 与 <载体> 载体不符（期望 <string|非负整数>）'`
  - C2 不可下钻：`'<载体> 是不可下钻终态（标量/plain/XML）'` / `'ROOT 载体非 Y.Map（实际 <载体>）'`
  - C3 值域：沿用 extract 措辞家族 `'纯值域违规（<path 渲染><内部位置 loc>）：期望 plain value（JSON 值域），实际 <申报词>'`、`'未知 Yjs shared type（<ctor>）——无 toJSON fallback'`、`'数组位置 undefined 不可投影'`、`'detached Yjs 载体（<申报词>，未集成 doc）不可读'`（R2 #2）
  - E100：`'DOCRT-E100: 内部错误（意外异常）: <detail>'`（崩溃边界；R2 起 G0 类型外输入同前缀——见上）

### D9 — ROOT 探针复用（probeRoot 原样，INV-R8/R9）

- `probeRoot` 四级级联（getMap→getArray→getXmlFragment→getText）只碰 `'ROOT'` 名字空间——SCHEMA/META 兄弟条目天然零接触（ADR-0006 布局）。
- ROOT 缺席 → `getMap` 惰性创建空 map，实测零 update 事件（探针 P3）、幂等（探针 P13）——空 doc `[]` → `{}`（AC1 锚定）。
- ROOT 异型（Y.Array/Y.Text，探针 P2/F 实测 getMap 抛）→ C4 PATH_NOT_ALLOWED（AC5 锚定，非空 path 回显避免与 E100 的 `path:[]` 形态混淆——测试已规避该混淆，实现无需特判）。
- 第四级全失败 → throw → E100 崩溃边界（公共 API 造不出的第五种 ROOT，现状保留）。

### D10 — 循环引用 / 深递归 → 崩溃边界收编（不加 cycle 检测）

plain 子图循环引用（`a.self = a` 经引用存储可达，探针 P8 同机制）→ copyPlainStrict 无限递归 → RangeError → 顶层 catch → E100 结构化返回。**不增设 seen-set 预检**，理由：(a) 可观测结局与专门检测**同形**——都是 `{ok:false, code:'PATH_NOT_ALLOWED', path, message}`，差异仅在 message 文案（message 非契约字段）；(b) seen-set 给每次正常读取加 WeakSet 写开销，为的是改一个非契约字段的措辞；(c) 与 extract §4.8 崩溃边界口径一致（同款输入在 extract 侧同为 E100）。列为 §5.2 E10 已知边界。

### D11 — 同步与并发模型（零新增义务）

Yjs 单线程事务模型下，同步读取在 JS 调用栈上原子观察调用瞬间的 live 状态——ADR-0008「读取只观察调用瞬间已经提交的 live Y.Doc，不等待已接纳但尚未提交的写」由同步性直接满足，无需锁/快照/事务参与（读取不进入写序列器）。本设计不引入异步面、不注册 observer、零事件订阅（INV-R9 只读零写入）。

### D12 — 性能预算（ADR-0007「普通读取成本与目标 path 子树规模相关」）

- 导航：O(path.length)，每段 O(1) 载体判定 + 一次容器读取（+ plain object/array 一次 descriptor 查询）。
- 投影：O(目标子树规模)——每个 Yjs 容器节点访问一次、每个 plain 值一次 classify + 深拷贝。
- 空 path = O(全 ROOT)；非空 path 不触碰目标子树以外的数据（`['meta']` 不转换 ROOT 其他键，AC1 锚定 `Object.keys(value)` 无其他键）。
- 无 memo、无缓存、无模块级状态（INV-R10）——union 回溯消失后不存在重复子问题。

---

## §4. 算法伪代码（SA3 实现蓝本）

```ts
// packages/doc-runtime/src/read.ts（重写骨架；~280 行；伪代码含不变量注释）
import * as Y from 'yjs';                                   // vfsl import 全部移除
import { carrierOf, probeRoot } from './carrier.js';

export type ReadLogicalValueResult =                        // 冻结形态，逐字不变
  | { ok: true; value: unknown }
  | { ok: false; code: 'PATH_NOT_ALLOWED'; path: readonly (string | number)[]; message?: string };

export function readLogicalValueAtPath(doc: Y.Doc, path: readonly (string | number)[]): ReadLogicalValueResult {
  try {
    // G0 — SA4-F2 守卫前置：非数组 path 归一失败（绝不把垃圾输入当空 path 读全 ROOT）；
    // message 带 DOCRT-E100 前缀（R2：与旧 F2 可观测行为逐字一致，guards 前缀锚原样可移植）
    if (!Array.isArray(path)) return notAllowed(path, 'DOCRT-E100: path 必须是段数组（readonly (string | number)[]）');

    // N0 — ROOT 探针（唯一 doc 触碰入口，INV-R8：只碰 'ROOT'；INV-R9：零写入零事件）
    const probe = probeRoot(doc);                           // throw → E100（第四级全失败，D9）
    if (probe.carrier !== 'Y.Map') return notAllowed(path, `ROOT 载体非 Y.Map（实际 ${probe.carrier}）`); // C4

    // N1 — 导航循环（段纪律 D3 + 缺席吸收 D4 + 不可下钻 C1/C2/C3）
    let cur: unknown = probe.map;
    for (let i = 0; i < path.length; i++) {
      const seg = path[i] as unknown;                       // 运行时野段（symbol 等）由下游 typeof 判拒，零抛点
      const c = navClassify(cur);                           // D2 两层分类器（Yjs 家族含 detached 前置判别，R2 #2）
      switch (c.k) {
        case 'ymap': {
          if (typeof seg !== 'string') return notAllowed(path, segMsg(i, seg, 'Y.Map', 'string'));   // C1
          const v = c.v.get(seg);
          if (v === undefined) return okUndefined();        // 缺键/显式 undefined 一律吸收（D4）——中间缺失立即结束
          cur = v; break;
        }
        case 'yarray': {
          if (!isNonNegInt(seg)) return notAllowed(path, segMsg(i, seg, 'Y.Array', '非负整数'));      // C1
          if (seg >= c.v.length) return okUndefined();      // 越界吸收（D4）
          const v = c.v.get(seg);
          if (v === undefined) return notAllowed(path, '数组位置 undefined 不可导航'); // 防御（公共 API 不可达，探针 A）
          cur = v; break;
        }
        case 'plainObject': {
          if (typeof seg !== 'string') return notAllowed(path, segMsg(i, seg, 'plain object', 'string')); // C1
          const hit = readableOwnDataValue(c.v, seg);       // D5 键空间助手（descriptor 读，零 accessor 执行）
          if (hit === NONE) return okUndefined();           // 键空间外 ≡ 缺席（D4/D5）
          cur = hit.value; break;
        }
        case 'plainArray': {
          if (!isNonNegInt(seg)) return notAllowed(path, segMsg(i, seg, 'plain array', '非负整数'));   // C1
          const hit = readableArrayElement(c.v, seg);       // D5（descriptor 守卫）
          if (hit === NONE) return okUndefined();           // 越界吸收
          if (hit === VIOLATION) return notAllowed(path, hit.msg);   // 空洞/undefined 元素/accessor 下标 → C3（D4）
          cur = hit.value; break;
        }
        case 'xml':  return notAllowed(path, 'Y.XmlFragment 是不可下钻终态（语义字符串）');              // C2（AC5 锚定）
        case 'text': return notAllowed(path, '未知 Yjs shared type（Y.Text 家族）不可下钻——无 toJSON fallback'); // C3
        case 'unknownShared': return notAllowed(path, '未知 Yjs shared type 不可下钻——无 toJSON fallback');      // C3
        case 'detached': return notAllowed(path, `detached Yjs 载体（${c.word}，未集成 doc）不可读——拒绝静默空投影`); // R2 #2（C3）
        case 'scalar': return notAllowed(path, '标量不可作为容器');                                     // C2（AC2 锚定）
        case 'nonPlainObject': return notAllowed(path, '非 plain 原型对象不可下钻');                     // C3
        case 'violation': return notAllowed(path, c.msg);   // bigint/function/symbol/undefined 出现在路径上 → C3
      }
    }

    // P1 — 定点投影（路径耗尽，D6 双递归）。R2 #1：ProjectOutcome 判别联合——禁 null/undefined 哨兵：
    // null 是合法投影值（fixture nothing:null / arr[3]===null），`r === null` 判失败即把缺陷蓝图交给 SA3
    const r = projectValue(cur, path);
    if (r.kind === 'fail') return notAllowed(path, r.msg);  // C3 透传（消息由违规定位器提供）
    return { ok: true, value: r.v };                        // INV-R3：value 键恒显式构造（r.v 可为合法 null）
  } catch (err) {                                           // 崩溃边界 E100（D10 含 RangeError 循环引用）
    // R5（SA4 R1-F1 / R2-F1a 勘误）：catch/notAllowed 的一切「不可信值→string/数组」转换必须在
    // 内层保护的助手内完成，且助手返回值收窄为原始 string——直接 `String(err)`/模板插值 ToString
    // 可被敌意 toString 击穿（P1）；`err.message` 属性读可被 throwing getter 击穿（P9）；message 为
    // 敌意对象/Symbol 数据属性时插值 ToString 逃逸（R2-F1a NEW1/NEW2）；`[...path]` 可被 Proxy
    // 包装数组的敌意 Symbol.iterator 击穿（P10）——上述求值点若在内层 try 之外即二次抛出外泄，
    // 击穿 INV-R1「同步不抛」。蓝本与 SA3 实现（safeDetail/safeSpreadPath）同步，防下轮照抄再犯
    return notAllowed(path, `DOCRT-E100: 内部错误（意外异常）: ${safeDetail(err)}`);
  }
}

// —— 助手（伪代码级；NONE/VIOLATION 用哨兵或判别联合实现）——
// R2 #1：projectValue/copyPlainStrict 返回 ProjectOutcome = {kind:'value'; v} | {kind:'fail'; msg}
//        ——判别联合，明文禁 null/undefined 作失败哨兵（null 是合法投影值）；导航助手 NONE/VIOLATION
//        仅在「键空间/下标读取」层使用，与投影值域无关，不与 null 投影值混淆。
okUndefined(): { ok: true; value: undefined }               // value 键显式存在（FC-3，expectUndefinedValue 锚定）
notAllowed(path, msg): { ok:false, code:'PATH_NOT_ALLOWED', path: safeSpreadPath(path), message: msg }  // path 拷贝经 R5 助手（P10）
safeDetail(err): string                                       // R5（SA4 R1-F1 + R2-F1a）：内层 try 包 instanceof /
                                                              //   err.message 属性读 / String(err)，返回前
                                                              //   `typeof raw === 'string'` 收窄——非原始 string
                                                              //   （敌意 toString 对象 / Symbol 数据属性，R2-F1a
                                                              //   NEW1/NEW2 向量）一律回退 'unstringifiable'；
                                                              //   调用点模板插值因此零 ToString 逃逸（TS 的
                                                              //   `Error.message: string` 只是类型断言，子类可用
                                                              //   own 数据属性覆写——类型不可作运行时安全依据）
safeSpreadPath(path): readonly (string | number)[]            // R5（SA4 R1-F1 P10）：Array.isArray 前置 + 内层 try
                                                              //   包 spread（Proxy 包装数组的敌意 Symbol.iterator
                                                              //   可抛），失败回退 []——notAllowed 拷贝点零二次抛
isNonNegInt(s): typeof s === 'number' && Number.isInteger(s) && s >= 0   // -0 合法（D3，探针 C）

navClassify(v): NavCarrier                                  // D2 表格机械翻译（第一层 carrierOf；第二层细分 + Yjs 家族 detached 前置判别，R2 #2）
readableOwnDataValue(obj, key): NONE | { value }            // D5（enumerable + data + 非 undefined 三关）
readableArrayElement(arr, i): NONE | VIOLATION | { value }  // D5
projectValue(v, path): ProjectOutcome                       // D6（detached 守卫 + ymap/yarray/xml/text/plain 分发）
copyPlainStrict(v, loc): ProjectOutcome                     // D6（JSON 值域拷贝器；fail 侧携带申报词与内部位置线）
putKey(out, k, v): Object.defineProperty(out, k, { value: v, writable: true, enumerable: true, configurable: true })  // D6 尾注
```

### 不变量清单（新 INV-R 系；SA4/SA7 评审锚）

| # | 不变量 | 锚定 |
|---|---|---|
| INV-R1 | 同步、不抛错——全函数顶层 try/catch 收编一切异常 | AC6 case4 / 冻结契约 1 |
| INV-R2 | 失败单通道 `PATH_NOT_ALLOWED` + 整条 path **新鲜副本**回显 | 冻结契约 2 |
| INV-R3 | 成功恒显式 `value` 键（缺键 = 显式 undefined） | expectUndefinedValue |
| INV-R4 | 零 accessor 执行（对象键 + 数组下标一律 descriptor 读）——**限于普通对象语义载体**（R2 #7 划界）：Proxy trap 属调用方数据自带代码，超出读取契约，trap throw → E100 收编 | AC3 counters / 探针 I·J / E22 |
| INV-R5 | 不走原型链、不读 non-enumerable、不读 symbol 键 | AC3 |
| INV-R6 | 返回值零 Yjs 引用（深拷贝；expectNoYjsLeak 递归） | AC6 |
| INV-R7 | 不 freeze——输出键 defineProperty 四描述符全 true | AC6 case2 |
| INV-R8 | 只触碰 'ROOT' 名字空间（probeRoot 唯一 doc 入口；SCHEMA/META 零接触） | ADR-0006 |
| INV-R9 | 零写入、零事件、幂等（getMap 缺席惰性创建零 update） | 探针 P3 / 旧 supplementary 移植 |
| INV-R10 | 模块级零可变态、零 memo、零订阅 | ADR-0008（读取不进 sequencer） |
| INV-R11 | 导航键空间 ≡ 投影键空间（同一 descriptor 助手） | D5 自洽性 |
| INV-R12 | 成本 O(path + 目标子树)，非空 path 不转换目标外数据 | ADR-0007 / AC1 case2 |
| INV-R13 | Yjs 家族载体（导航 + 投影）恒 attached：`v.doc === null`（detached）→ PATH_NOT_ALLOWED loud——封死「ok:true 空投影 + console.warn 噪声 + XML 内容静默蒸发」通道（R2 #2） | 探针 A14 / E19–E21 / guards detached 锚 |

---

## §5. 边界矩阵

### 5.1 AC → 设计机制映射（冻结锚定全覆盖）

| AC | 冻结断言（SA6 37 例） | 设计机制 |
|---|---|---|
| AC1 | 双参签名；空 path 深拷贝完整 ROOT；非空只转换目标子树；无 schema 文档任意 string 段可读 | §4 签名；`[]` → projectValue(ROOT)；`['meta']` → 导航后仅投影 meta（D12）；键从不与 schema 比对（D1/D2） |
| AC2 | string↔map/object、非负整数↔array 段纪律；缺键/越界（含中间缺失）→ ok:true undefined；段型不符/负数/非整数 → PATH_NOT_ALLOWED+path 回显 | D3 段纪律 + D4 吸收三源 + D8 C1 回显 |
| AC3 | accessor 不执行（零触发）不产出；原型链（data+accessor）不参与；non-enumerable 不参与 | D5 readableOwnDataValue（descriptor 读，探针 I/J 依据） |
| AC4 | plain 子树嵌 Yjs/bigint/non-finite/数组内 undefined → ok:false 绝不静默 | D6 copyPlainStrict（classify 拒 Yjs、finite 拆支、bigint、readableArrayElement VIOLATION） |
| AC5 | XmlFragment 家族 → 语义字符串不可下钻；Y.Text/Y.XmlText 无 toJSON fallback → ok:false 且无 value 键；ROOT 异型 → 失败 | D2 xml/text 分型 + D6 toString + D9 C4；notAllowed 形态天然无 value 键（`expect(r).not.toHaveProperty('value')`） |
| AC6 | 无 live 引用（递归 instanceof）；JSON 往返无损；不 freeze（顶层+嵌套可写）；突变不影响 live；失败同步不抛 | D6 深拷贝 + defineProperty 四真（INV-R7）+ INV-R1/R6 |
| AC7 | 调用面调整 + 全量 typecheck/test + Node 20/24 CI | §6 测试处置 + §7 文件清单 |

（R2 注：#1 哨兵判别联合与 #2 detached 守卫为补充裁决——冻结 37 例无借道下钻/哨兵误判用例，本映射表机制不受影响；新增锚见 §6.2 guards 清单。）

### 5.2 未锚定边缘裁决表（SA1 补充裁决；每条附行为依据）

| # | 场景 | 裁决 | 依据 |
|---|---|---|---|
| E1 | Y.Map 键显式存 undefined | 吸收为缺席（导航 ok:true undefined；投影省略键） | D4 表（探针 P1/L：yjs toJSON 同判；旧 D4 先例；SA6 违规清单未列入） |
| E2 | plain object own enumerable data 键值 undefined | 吸收（NONE） | D4/D5（JSON.stringify/yjs toJSON 投影域同值；键空间模型统一） |
| E3 | 导航穿过 plain array 空洞/undefined 元素（如 `['arrU',1,'x']`） | 响亮失败（违规在路径上） | D4 数组纪律（AC4 同款；位置语义不可省略） |
| E4 | 导航至 accessor 键（如 `['acc','secret']`） | ok:true undefined（键空间外 ≡ 缺席），getter 零触发 | D5 键空间自洽性（投影不产出 ⇒ 导航不可达；探针 J descriptor 零执行） |
| E5 | 导航至 non-enumerable 键（`['nonEnum','hidden']`） | ok:true undefined | 同 E4（desc.enumerable !== true → NONE） |
| E6 | 导航至原型链键（`['protoObj','inherited']`） | ok:true undefined，原型 accessor 零触发 | getOwnPropertyDescriptor 不查原型链（语言语义） |
| E7 | 导航穿过 plain 容器内嵌**集成** Yjs 载体（别名集成：Y.Map/Y.Array 先 set 进 doc 集成、再别名塞进 plain 容器，`v.doc !== null`；如 `['holder','inner','k']` → ok:true 1） | 按内嵌载体自身规则继续导航/投影，读真实数据 | R2 #2 收窄：借道仅对集成载体成立（detached → E19 loud）；载体驱动导航只看段位实际载体（ADR-0008「按实际载体」）。注意区分：投影期 plain 拷贝对**嵌套 Yjs 的拒绝（AC4，如 `['badNested']` → loud）不问 attached 与否**——copyPlainStrict 的 Yjs 家族分支一律拒绝；detached 守卫只作用于导航借道与 projectValue 的 Yjs 容器分发 |
| E8 | plain object 带 own enumerable `__proto__` 数据键（defineProperty 造） | 正常投影（descriptor.value 读；输出 defineProperty 写，不触发原型 setter） | 探针 P6（own 键 Object.keys 可列、descriptor 值可读）；extract R2/#8 同款纪律 |
| E9 | Y.Map 键名 `'__proto__'` | 正常读写（键查找非属性访问）；投影 defineProperty 安全写入 | 探针 P7（公共 API 直接可达：has=true get=1） |
| E10 | plain 子图循环引用 | RangeError → E100 结构化返回（不抛出、不加 cycle 预检） | D10（通道同形论证；extract §4.8 同口径） |
| E11 | `-0` 值 / `-0` 段 | 值：finite 直通（extract SA5 复现[5] 先例）；段：合法归一 0（探针 C） | D3 |
| E12 | `Y.XmlHook`（extends Y.Map，探针 P5） | 归 `ymap` 载体（与 extract 既有口径一致） | yjs 原型链事实；无公共写入路径产生（构造器专用类型）；本任务不新增特判 |
| E13 | 顶层 null-prototype 对象 | **不可达**（yjs set 顶层直接 throw，探针 G2b）；嵌套于 plain 容器内可达 → isPlainRecord 放行（链顶 null 终止——R5 勘误后判据，行为结局与原设计一致） | 探针 G2/G2b |
| E14 | plain array 带 accessor 下标（defineProperty 造） | 响亮失败（无法零副作用取值且位置不可省略） | D5 readableArrayElement（INV-R4 全局零执行优先于取值）；理论病理，经受控写入不可产生 |
| E15 | 数字形 string 键（`'0'`）在 map/object 上 | 按普通 string 键直查，无数值隐换 | ADR-0007 路径纪律（段从不解释）；与 array 段型纪律（`['items','0']` 拒绝）互补 |
| E16 | 垃圾 `doc`（null/非 Y.Doc） | probeRoot 内 TypeError → E100 结构化返回 | INV-R1（与现状同判；类型层已由签名拒绝）。R3 补注（SA2 INFO）：`doc.destroy()` 后 `getMap('ROOT')` 不抛、类型 `doc` 属性仍非 null、内存数据可读（SA2 实测）——detached 守卫零误伤、无外抛、行为良性；destroyed doc 属契约外输入，不新增特判 |
| E17 | path 含非 string/number 运行时野段（symbol/object） | typeof/Number.isInteger 判拒 → C1，零抛点 | D3 + G0（类型层已拒绝，运行时防御） |
| E18 | ROOT 为 Y.XmlFragment 异型 | C4 PATH_NOT_ALLOWED（同 Y.Array/Y.Text） | D9（探针 F：getMap 抛 → 级联③命中） |
| E19 | plain 容器内嵌 **detached** Yjs 载体（`root.set('holder', { frag })`——内嵌实例从未集成，`v.doc === null`；SA6 fixture 纪律实证公共 API 可达） | 导航与投影一律响亮失败 PATH_NOT_ALLOWED（message `'detached Yjs 载体（<申报词>，未集成 doc）不可读'`）；含借道 `['holder','ys','x']` 与目标 `['holder','frag']` 两形态 | R2 #2（SA2 方案 a）：实测 detached 读 = 空 + 每次触发 yjs `console.warn('Invalid access…')`、detached `XmlFragment.toString()` 返回 `''`（length=1 非空片段内容静默蒸发）、写静默 no-op——放行即「ok:true 空投影 + 告警噪声」，违反 AC4「绝不静默丢弃」精神与 ok:true 零副作用纪律；冻结 37 例无借道下钻用例，零影响 |
| E20 | 别名集成载体借道（同一实例先 `root.set` 集成、再塞 plain 容器，`v.doc !== null`） | 正常借道：按集成载体规则导航/投影，读到真实键值 | R2 #2：实测别名集成 map 借道 `keys=['k'], get('k')=1`（§8 A14/D3）——证明 E19 的 loud 判别是「detached」而非「内嵌即拒」，E7 语义对集成载体完整保留。R3 补注（SA2 INFO）：**跨 doc 别名**——docB 的集成类型塞进 docA 的 plain 容器 → `doc !== null` → 放行借道、读到 docB 数据；载体驱动 + 别名规则下自然（plain 容器内的 JS 引用即 docA 内存视图内容），INV-R8 立法意图是「不碰 SCHEMA/META」，不冲突 |
| E21 | detached Y.Array `insert(0, [undefined])` | 静默 no-op（不抛、length 不变）→ 造不出 undefined 元素 | R2 #5：A1 补 attached 限定（attached 抛 TypeError / detached no-op）——D4「Y.Array 在界 undefined = 防御分支」结论两情形均成立 |
| E22 | Proxy 载体（trap = 调用方代码；plain 容器可经公共 API 引用原样置入） | `Object.keys`/`getOwnPropertyDescriptor`/`getPrototypeOf` 触发 trap 属调用方数据自带行为，超出读取契约；trap throw → 顶层 E100 结构化收编不外抛 | R2 #7：INV-R4 零执行承诺限于普通对象语义载体——绝对化措辞划界，防 SA4/SA7 误判；不增设 Proxy 特判分支 |

---

## §6. 调用面调整与测试处置（AC7）

### 6.1 生产代码

| 文件 | 改动 |
|---|---|
| `packages/doc-runtime/src/read.ts` | **重写**（§4；旧 Phase A/B、arbitrateUnion、memberOutcomes、NavOutcome、makeValuesResolver、keyAllowed、vChild 全部移除；`ReadLogicalValueResult` 类型逐字保留；vfsl import 清零） |
| `packages/doc-runtime/src/index.ts` | 导出符号**不变**（`readLogicalValueAtPath` / `ReadLogicalValueResult`）；仅更新头部 JSDoc 契约注释（三参描述 → 双参载体投影描述，~10 行注释 diff） |
| `packages/doc-runtime/src/carrier.ts` / `extract.ts` / `materialize.ts` / `resolve.ts` / `xml-parse.ts` | **零改动**（probeRoot/carrierOf 原样复用；extract 的 walk/makeRefResolver @internal 导出保留——extract 自用） |
| `packages/doc-runtime/package.json` | **仅 patch 版本号 bump**（0.1.5 → 0.1.6；R4/SA4-F2 处置：MABF 硬门禁 #9——read.ts 重写即改代码，改码模块必须 bump patch，SA3 履行硬门禁）；**依赖与其他字段零改动**（vfsl 依赖保留给 extract/materialize；yjs ^13.6.30 覆盖实测所用的 13.6.32） |
| `packages/doc-runtime/tsconfig.json` | **零改动** |

### 6.2 遗留测试处置（7 文件，1479 行；R2 #6 更正——R1 误写「2132」系把 SA6 新文件 581+72 一并计入）

简报交接注意事项明文：「既有 read-logical-value-at-path*.test.ts（含 rev1/rev2）锚定的是已被 ADR-0008 取代的 schema-aware 三参语义……由 SA3 在实现期适配/移除」。

| 文件 | 行数 | 处置 | 理由 |
|---|---|---|---|
| `read-logical-value-at-path.test.ts` | 423 | **删除** | 全部用例经 parseVfsl+evaluate 造 derived、三参调用；「未知 ROOT 字段 → PATH_NOT_ALLOWED」与新红线**直接矛盾**；通用面（空 doc {}、path 回显、无泄漏）已被新 SA6 套件重锚 |
| `read-logical-value-at-path.test-d.ts` | 52 | **删除** | 锚定旧三参签名合法——与新 test-d 的 `@ts-expect-error` 反向锁直接冲突 |
| `read-logical-value-at-path-rev1-hardening.test.ts` | 195 | **删除** | union/optional 三态仲裁 + memo 成本护栏——schema 概念整体消失 |
| `read-logical-value-at-path-rev1-union-arbitration.test.ts` | 326 | **删除** | 同上（union 仲裁一致性锁） |
| `read-logical-value-at-path-rev2-union-arbitration-pure.test.ts` | 128 | **删除** | arbitrateUnion 纯函数表驱动——被测函数随实现退役（deep import `../src/read.js`，不删则编译失败） |
| `read-logical-value-at-path-rev2-inv14-negative.test-d.ts` | 48 | **删除** | 锁 arbitrateUnion/NavOutcome 包内导出面——同上 |
| `read-logical-value-at-path-supplementary.test.ts` | 307 | **删除 + 移植** | schema 专属锚（SUP-1/SUP-2/SUP-4 keyPattern 引擎面）删除；通用守卫锚 + **SUP-5 vfsl seam 签名锁**（R2 #3：实测 `matchPattern|compilePattern` 全仓仅 3 处命中——read.ts 将重写、supplementary 将删除、vfsl/src 实现，**vfsl/test 26 个 `.test.ts` 零命中**（R3 按 SA2 R2-2 更正：R2 误写 27——目录实为 26 个 `.test.ts` + 1 个 `validate-logical-snapshot.contract.ts` 共享文件共 27 条目，SA1 `ls`/`find` 双口径复测确认），SUP-5 是该公共接缝唯一覆盖，删除即覆盖静默消失）按 R2 移植清单转移 |

**移植清单 → 新文件 `packages/doc-runtime/test/read-logical-value-at-path-guards.test.ts`（SA3 新建，双参形态，~220 行；R2 #3/#4 全面修正 + 吸收 SA2 红线思路 1–10）**：

*一、移植锚（supplementary 原文 → 双参新形态；期望值逐锚给出，SA3 照此编写不再回读旧文件）：*

| 锚 | 原位置 | 新形态（双参）与期望 |
|---|---|---|
| F2 非数组 path **全量家族 11 变体**（null / undefined / 42 / `'zz'` / true / `{}` / array-like `{length:2}` / Set / Map / 1n / function） | L262–286 | **全量移植**（R2 #4：明确全量而非精选）：每变体 → `{ok:false, code:'PATH_NOT_ALLOWED', path:[]}` + message 非空 + 调用不被 try 包裹（守卫义务 = 不抛） |
| F2 E100 前缀 sub-family（null / undefined 两变体） | L288–297 | 原样移植：message 匹配 `/^DOCRT-E100:/`——前提 G0 守卫 message 带 E100 前缀（R2 已修订 D8，与旧行为逐字一致） |
| 零副作用 / 幂等锚（R3 按 SA2 方案 (i)+(ii) 重写——R2 版存在三重自相矛盾：`['title','x']` 拒绝需 title 在场、`size===0` 需 ROOT 空、随读 `[]`→`{}` 暗示空 doc，任一 fixture 必红一条） | L162–180（SUP-3） | **主锚（方案 i，空 doc）**：fixture = 全新空 `Y.Doc()`（ROOT 未建、零 set）→ 拒绝路径 `[0]`（number 段下钻空 ROOT Y.Map → C1 段型不符）→ notAllowed(`[0]`)（非空 path 回显，与 E100 `path:[]` 形态区分）；断言 `getMap('ROOT').size === 0`（探针惰性创建后仍空）+ `doc.on('update')` 计数 0 + 重复调用 `toEqual` 幂等（含 message；path 新鲜副本非别名）；**同一 doc** 随读 `['nope']` → ok:true undefined（空 map 缺键吸收）、`[]` → `{}`（update 仍 0）——五断言在同一空 doc fixture 上全部成立。**对照锚（方案 ii，有数据 doc，独立 it）**：fixture = `root.set('title','Hello')` → `['title','x']` → notAllowed(`['title','x']`)（标量下钻 C2）；断言 update 计数 0 + `getMap('ROOT').toJSON()` 调用前后 `toEqual`（键集不变）——**不断言 `size===0`**（有数据 doc 上该断言不成立）。原「ROOT 不创建」表述不可满足（R2 #4ii：探针先行必然惰性创建），机制变化、可观测断言不变 |
| `-0` 段归一 0 | L228–235 | 双参版：`['items', -0]` → ok:true `'k1'` |
| **NaN/±∞ 段守卫（R2 #4iii 补移植——R1 清单写丢）** | L238–244 | `it.each([NaN, Infinity, -Infinity])`：`['items', seg]` → notAllowed + path 回显（冻结 AC2 只锚 -1/1.5，此锚载体无关、不可静默丢失覆盖） |
| 超大合法下标 2^53 越界 | L246–254 | 双参版：`['items', 2**53]` → ok:true undefined（吸收） |
| 对照锚（**期望翻转修正**，R2 #4i） | L299–306 | `['title']` → ok:true `'Hello'`；`['nope']` → **ok:true undefined（红线下期望翻转——原锚 notAllowed 与冻结 AC2 直接互斥；双保险锚防 SA3 误移植）**；真拒绝对照改用 `['title','x']` → notAllowed(`['title','x']`)（path 回显保留） |
| **SUP-5 vfsl seam 签名锁（R2 #3 补移植）** | L206–217 | 原样移植进 guards：`compilePattern('^a+$')` + `matchPattern(compiled, input)` 双参、返回 boolean、`expectTypeOf` 参数/返回类型断言 + `@ts-expect-error` 3 参负锁（charge 回调非公共契约）——见上处置行覆盖缺口论证 |

*二、新增锚（R2：SA2 红线思路 1–10 吸收；均双参、零冻结套件触碰）：*

| 锚 | 断言 |
|---|---|
| null 哨兵碰撞锁（#1） | `['nothing']` → ok:true 且 `value === null`（显式 `toBe(null)`，区分 undefined）；`['arr', 3]` → ok:true null——钉死 ProjectOutcome 判别联合不被退化回 `=== null` 哨兵比较 |
| detached 载体守卫锁（#2 方案 a；R3 补三形态并列，SA2 R2 红线思路增量 2） | **三形态并列**（钉死「导航与投影一律 loud」的『一律』）：`['holder','ys','x']`（借道中途遇 detached → navClassify 前置判别）→ ok:false；`['holder','ys']`（路径在 detached 上耗尽 → projectValue 守卫）→ ok:false；`['holder','frag']`（detached XmlFragment 目标投影）→ ok:false + path 回显。fixture：`root.set('holder', { frag: <含子元素的 Y.XmlFragment>, ys: new Y.Map() })`；**别名集成对照**：先 set 进 ROOT 集成再塞 plain 容器 → `['holder2','inner','k']` → ok:true 1（证明 loud 判别是 detached 而非「内嵌即拒」，E20） |
| 循环引用 E100 前缀锁 | `cyc.self = cyc` 经 `root.set('cyc', cyc)` → `['cyc']` → ok:false + message 匹配 `/^DOCRT-E100:/`（同步不抛 + 前缀双锚，D10/E10） |
| 运行时野段锁（E17） | `['cfg', Symbol('x')]` / `['cfg', {}]` → notAllowed 零外抛 |
| `__proto__` 防劫持锁（E8/E9） | Y.Map 键 `'__proto__'` 与 plain object own `'__proto__'` 数据键正常读写，且输出 `Object.getPrototypeOf(out) === Object.prototype`（防原型劫持回归） |
| Date 原型守卫锁 | `root.set('d', new Date())` → `['d']` loud / `['d','x']` loud / `[]` 全量读亦 loud（nonPlainObject 家族） |
| Proxy trap-throw 锁（E22/#7） | trap 抛出的 Proxy 置入 → `['p']` → ok:false 结构化返回、不外抛（trap throw → E100 收编；Proxy 划界见 D5） |

**不移植的旧锚与其理由（R2 更正版）**：~~「keyPattern/compilePattern 双参 seam——vfsl 公共面，已有 vfsl 自身测试覆盖」~~——此为 R1 事实错误（SA2 #3 揭示：vfsl/test 26 个 `.test.ts` 零命中——R3 更正计数口径，见上处置行），SUP-5 已改为移植（上表）；SUP-4（pattern 引擎 throw → C3）——keyPattern 概念随 schema-aware 语义消亡、pattern 引擎不再被 read 消费，E100 前缀家族改由 F2 sub-family + 循环引用前缀锚钉住；Phase A 零 doc 触碰——Phase A 消亡，探针先行必然惰性创建 ROOT（机制变化、可观测断言不变，见零副作用锚改写）。

**guards fixture 规格（R3 新增，SA2 INFO 建议采纳——根除锚文与 fixture 的歧义，R2-1 矛盾部分源于 fixture 未定）**：

- **主 fixture**（通用锚共用，与冻结 `buildDoc()` 同构命名的精简子集）：`title:'Hello'`、`items:Y.Array['k1','k2']`、`cfg:Y.Map{mode:'fast', limit:10}`、`meta:plain{createdBy:'jim', tags:['a','b']}`、`arr:plain[1,'two',true,null,{n:'obj'}]`、`nothing:null`——对照锚/段纪律锚/野段锚/哨兵锚按需取键；
- **空 doc fixture**（零副作用主锚专用）：`new Y.Doc()`，零 set（ROOT 未建）；
- **专用 fixture**（各锚就地构造，不共享）：holder/detached 族（`{frag: XmlFragment}`、`{ys: new Y.Map()}`、别名集成 `holder2`）、循环引用 `cyc`、`__proto__` 键、`new Date()`、trap-throw Proxy；
- **纪律**：每个 `it` 自造 doc、零跨 it 共享状态（与冻结套件 `buildDoc()` 每 it 重建同构）；零副作用锚的 `doc.on('update')` 计数器在 fixture 构造**之后**挂接（fixture 写入不计入读侧断言）。

### 6.3 全量门禁影响

- `pnpm typecheck`（root：逐包 `tsc -p`，include test/**）：红灯证据 TSC_EXIT=2（TS2554×64）在实现后消解；删除 7 遗留文件后其三参调用不再进入编译面。
- `pnpm test`（root vitest `--typecheck`；include `packages/*/test/**/*.test.ts`，typecheck 仅 `*.test-d.ts` 经 tsconfig.typecheck.json）：37 例新锚转绿 + guards 移植锚转绿；extract/materialize 套件零触碰（零生产改动）。
- CI（.github/workflows/ci.yml：node 20/24 矩阵）：纯同步纯函数重写，无 Node 版本敏感面（无 ESM/CJS 交互、无新依赖）；yjs 13.6.32 已在 lockfile。
- `scripts/test-lock.sh` 不存在（简报已核），无依赖面新增。

---

## SA2 反馈逐条回应（R1 评审 → R2 修订；R2 复审 → R3 修订）

### R1 攻击点（8 项 + 协议小项，R2 复审已 100% 核销）

| 要求 | 严重度 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|---|---|---|
| #1 FAIL 哨兵与合法值 `null` 碰撞（`r === null` 判失败 → `['nothing']`/`['arr',3]`/`[]` 全量读误判 PATH_NOT_ALLOWED） | HIGH must-fix | ✅ | §3 D6 失败通道记号段 / §4 伪代码 P1 与助手区 / §6.2 guards 新增锚 | projectValue/copyPlainStrict 返回改判别联合 `ProjectOutcome = {kind:'value'; v} \| {kind:'fail'; msg}`，明文禁止 null/undefined 哨兵（null 是合法投影值，fixture `nothing:null`/`arr[3]`）；guards 新增 `['nothing']`→ok:true null、`['arr',3]`→ok:true null 碰撞锁 |
| #2 E7 借道 detached Yjs 载体静默空投影（toString='' 内容蒸发 + console.warn 噪声 + 「天然 attached」注记自相矛盾） | HIGH must-fix | ✅ 采纳方案 (a) | §2 架构图 / §3 D2 detached 行+守卫段 / §3 D8 C3 模板 / §4 伪代码 case 'detached' / §5.2 E7 收窄+E19/E20 / INV-R13 / §8 A2 更正+A14 / §6.2 guards detached 锚 | D2 新增 detached 载体类：Yjs 家族导航与投影期统一前置检测 `v.doc === null` → PATH_NOT_ALLOWED loud；E7 收窄为「仅集成载体可借道」；别名集成对照（E20）保留借道语义；A2「天然 attached」错误注记更正；实测依据入 A14 |
| #3 SUP-5 matchPattern/compilePattern 覆盖倒退（「已有 vfsl 自身测试覆盖」为假——vfsl/test 零命中，SUP-5 是唯一签名锁） | MEDIUM must-fix | ✅ | §6.2 处置表 supplementary 行 / 移植清单 SUP-5 行 / 「不移植」段更正 | 错误事实句删除并更正（附 grep 证据）；SUP-5（双参 + `@ts-expect-error` 3 参负锁）移植进 guards 新文件，seam 覆盖零丢失（计数 R3 更正为 26 个 `.test.ts`，见下表） |
| #4 移植清单三处缺陷：(i) `['nope']` 期望翻转 (ii) 「ROOT 不创建」不可满足 (iii) NaN/±∞ 锚丢失；另 F2 家族未声明全量/精选 | MEDIUM must-fix | ✅ | §6.2 移植清单全面重写 | (i) 对照锚改 `['title','x']`→notAllowed + `['nope']`→expectUndefinedValue 双保险；(ii) 改写为「惰性创建后仍空 map（size===0）+ 零 update + 幂等（含 message）」并注明机制变化；(iii) 补 `it.each([NaN, Infinity, -Infinity])` 移植行；F2 家族声明**全量 11 变体** + E100 前缀 sub-family；另发现并修复：G0 message 须带 `DOCRT-E100:` 前缀，否则 L288–297 前缀锚不可移植（D8 已修订）。**（本行 (i)(ii) 的 R2 落地在 R2 复审中被判自相矛盾——`['title','x']` 与 `size===0` 被错误拼进同一锚，R3 已按 R2-1 重写为零副作用主锚 + 对照锚两独立锚，见下表）** |
| #5 A1 缺 attached 限定词（detached insert 是静默 no-op 不抛） | MEDIUM should-fix | ✅ | §8 A1 / §3 D4 Y.Array 行 / §5.2 E21 | 补 attached/detached 双情形限定（结论两情形均成立：都造不出 undefined 元素）；与 A14/E19/E21 合并为完整边缘覆盖 |
| #6 行数 2132 → 1479 | LOW should-fix | ✅ | §6.2 标题 | 更正（SA2 wc 复核 + 本轮复测一致；R1 系误将 SA6 新文件计入） |
| #7 INV-R4「全局零 accessor 执行」对 Proxy 载体不成立且不可能成立 | LOW should-fix | ✅ | §3 D5 Proxy 划界段 / INV-R4 / §5.2 E22 / guards Proxy 锚 | 零执行承诺划界为「限于普通对象语义载体」；Proxy trap 属调用方数据自带代码超出契约；trap throw → 顶层 E100 收编不外抛；不增设特判分支 |
| #8 `packages/vfsl/src/index.ts:86` 注释将失真 | LOW 知会 | ✅ | §7 DENY LIST vfsl 行 | 如实标注「已知将失真的注释，留独立任务」；seam 覆盖由 SUP-5 移植锚保全；本任务不改 vfsl（DENY 维持） |
| 协议审查小项：A10 依据栏未贴实测输出正文 | — | ✅ | §8 A10 | 补贴实测输出原文 `C yarr.get(-0)= a \| plain [10,20][-0]= 10 \| …` |

### R2 复审攻击点（2 项 + 3 INFO，R3 落实）

| 要求 | 严重度 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|---|---|---|
| R2-1 零副作用锚三重自相矛盾（`['title','x']` 拒绝需 title 在场、`size===0` 需 ROOT 空、随读锚暗示空 doc——任一 fixture 必红一条） | MEDIUM must-fix | ✅ 方案 (i) 主锚 + (ii) 对照锚 | §6.2 移植清单零副作用锚行（整行重写） | 主锚（方案 i）：空 doc fixture + 拒绝路径 `[0]`（number 段下钻空 ROOT Y.Map → C1）——`size===0`/update 0/幂等/`['nope']`→undefined/`[]`→`{}` 五断言在同一空 doc 全部成立（最贴近旧 SUP-3 单 doc 全程语义）；对照锚（方案 ii，独立 it）：title 在场 + `['title','x']`→notAllowed + update 0 + `toJSON()` 前后相等——**不断言 size===0**。两锚各自 fixture、各自自洽，矛盾结构消除 |
| R2-2 「vfsl/test 27 文件」实为 26（`.test.ts` 口径） | LOW should-fix | ✅ | §6.2 处置行 / 「不移植」段 / 回应表 #3（三处全改） | 更正为 26 个 `.test.ts`；附口径注记（目录另有 1 个 `validate-logical-snapshot.contract.ts` 共享文件共 27 条目——SA1 `ls`=27 / `find -type f`=27 / `*.test.ts`=26 双口径复测确认）；「零命中」结论两口径均成立不动 |
| INFO：guards fixture 规格未显式（R2-1 矛盾部分源于此） | INFO | ✅ | §6.2 新增「guards fixture 规格」段 | 主 fixture（冻结 buildDoc 同构命名精简子集：title/items/cfg/meta/arr/nothing）/ 空 doc fixture / 专用 fixture（holder/detached/cyc/`__proto__`/Date/Proxy 就地构造）+ 每 it 自造 doc 零共享 + update 计数器挂接时机纪律 |
| INFO：E16 可补 destroyed doc 实测注记 | INFO | ✅ | §5.2 E16 | 补注：`doc.destroy()` 后 getMap 不抛、`doc` 属性非 null、内存可读——detached 守卫零误伤；契约外输入不新增特判 |
| INFO：E20 可记录跨 doc 别名边缘 | INFO | ✅ | §5.2 E20 | 补注：docB 集成类型塞 docA plain 容器 → `doc!==null` 放行借道读 docB 数据——JS 引用即 docA 内存视图内容，与 INV-R8「不碰 SCHEMA/META」不冲突 |
| （SA2 R2 红线思路增量 2）detached 三形态并列锚 | — | ✅ 顺带 | §6.2 guards detached 锚 | 补第三形态 `['holder','ys']`（路径在 detached 上耗尽 → projectValue 守卫），与借道中途/目标投影三例并列 |

---

## §7. 文件清单（File Scope）

### ALLOW LIST

- `packages/doc-runtime/src/read.ts` — 重写，schema-independent 载体投影实现（§4 伪代码 → ~280 行；旧 Phase A/B 与 union 仲裁体系整体退役）
- `packages/doc-runtime/src/index.ts` — 修改，仅头部 JSDoc 契约注释更新（导出符号与路径不变，~10 行注释 diff）
- `packages/doc-runtime/package.json` — 修改，**仅限 patch 版本号 bump**（0.1.5 → 0.1.6；R4/SA4-F2 处置：MABF 硬门禁 #9「所有改过代码的模块必须 bump patch 版本号」，SA3 履行硬门禁；依赖与其他字段零改动）
- `packages/doc-runtime/test/read-logical-value-at-path-schema-independent.test.ts` — `[SA6 owned]` 冻结验收测试，**任何 SA 不改断言逻辑**
- `packages/doc-runtime/test/read-logical-value-at-path-schema-independent.test-d.ts` — `[SA6 owned]` 冻结类型验收测试，同上
- `packages/doc-runtime/test/read-logical-value-at-path.test.ts` — 删除（锚定被 ADR-0008 取代的三参语义，§6.2）
- `packages/doc-runtime/test/read-logical-value-at-path.test-d.ts` — 删除（与新类型锁直接冲突，§6.2）
- `packages/doc-runtime/test/read-logical-value-at-path-rev1-hardening.test.ts` — 删除（union/optional/memo 锚失效，§6.2）
- `packages/doc-runtime/test/read-logical-value-at-path-rev1-union-arbitration.test.ts` — 删除（同上，§6.2）
- `packages/doc-runtime/test/read-logical-value-at-path-rev2-union-arbitration-pure.test.ts` — 删除（arbitrateUnion 随实现退役，§6.2）
- `packages/doc-runtime/test/read-logical-value-at-path-rev2-inv14-negative.test-d.ts` — 删除（包内导出面锁失效，§6.2）
- `packages/doc-runtime/test/read-logical-value-at-path-supplementary.test.ts` — 删除，通用守卫锚按 §6.2 移植清单转移
- `packages/doc-runtime/test/read-logical-value-at-path-guards.test.ts` — 新建（SA3，R2 扩充），移植 F2 全量家族/E100 前缀 sub-family/零副作用幂等（改写版）/-0/NaN±∞/2^53/对照修正/SUP-5 vfsl seam 锁 + 新增 detached/null 哨兵/循环引用前缀/野段/`__proto__`/Date/Proxy 锚（双参形态，~220 行）

### DENY LIST

- `packages/doc-runtime/src/extract.ts` — 零改动。其 copyPlainValue 的 accessor 执行为已申报潜在缺陷（§3 D7），修复改变已交付契约可观测行为，超出本任务范围，留独立任务
- `packages/doc-runtime/src/carrier.ts` — 零改动（probeRoot/carrierOf 原样复用，词汇表不加值）
- `packages/doc-runtime/src/materialize.ts` / `resolve.ts` / `xml-parse.ts` — 零改动（写面/解析面与读取演进正交；materialize 不 import read.ts，实测无连锁）
- `packages/doc-runtime/tsconfig.json` — 零改动（R4：package.json 原与本行同列「零改动」，SA4-F2 处置后移入 ALLOW 仅限 patch bump——硬门禁 #9 优先于本行原意「零依赖改动」；「vfsl 依赖保留给 extract/materialize」的约束在 ALLOW 行中不变）
- `packages/doc-runtime/test/extract-*.test.ts` / `materialize-*.test.ts` — 零改动（对应生产面零改动，绿灯基线）
- `packages/vfsl/**` / `packages/vfsl-protocol/**` / `packages/vfsl-codegen/**` — 零改动（读取不再依赖 vfsl，反而解耦）。**已知注记（R2 #8）**：`packages/vfsl/src/index.ts:86` 注释宣称 matchPattern「由 doc-runtime readLogicalValueAtPath 的 Record 键许可判定」消费——本任务后该消费消失、注释将失真；DENY 维持（注释清理留独立任务），该 seam 的行为覆盖由 SUP-5 移植锚（guards）保全
- `packages/persistence/**` / `packages/dsh-persistence/**` / `apps/**` / `domains/**` / `tests/**` — 零改动（实测无 doc-runtime 消费方，§0.4）
- `docs/adr/**` / `CONTEXT.md` — 零改动（ADR-0008 已立法；CONTEXT.md 载体投影读取词条已在 Parent PR 更新）

---

## §8. 协议假设依据 (Protocol Assumption Evidence)

本设计含多处 yjs 运行时行为假设，全部经**设计期实测验证**（2026-08-23，worktree 内 yjs 13.6.32，Node 24；脚本经 stdin 注入 `packages/doc-runtime` 目录运行，不留产物）：

| # | 假设 | 依据类型 | 依据内容（实测命令+输出） | 风险 |
|---|---|---|---|---|
| A1 | attached（已集成 doc）`Y.Array.insert(0,[undefined])` 抛错；detached 同调用静默 no-op——两情形都造不出 undefined 元素，Y.Array 无 undefined 元素可达 | 设计期实测 + R2 复测（SA2 #5 独立复现一致） | attached：抛 `Cannot read properties of undefined (reading 'constructor')`；detached：不抛且 length 保持 0 → D4「yarray 在界 undefined = 防御分支」结论两情形均成立（E21） | 低 |
| A2 | attached（`v.doc !== null`）`Y.XmlFragment.toString()` 产语义 XML 串 | 设计期实测 + 源码行为 | fixture 同构树实测 `"<p>Hello <b>world</b></p>"`；`Y.XmlElement` 同 `"<p>hi</p>"`。R2 更正：R1 注记「实现直接对 live 容器调用，天然 attached」**不成立**——经 ROOT 探针到达的容器恒 attached（实测 `doc !== null`），但 plain 容器内嵌借道场景载体可能 detached（toString 返回 `''`，内容静默丢失）——已由 D2 detached 守卫 + E19 封死 | 低 |
| A3 | `Y.XmlElement instanceof Y.XmlFragment`、`Y.XmlText instanceof Y.Text` | 设计期实测 | 两处均 true → carrierOf 单判覆盖子类（fixture 纪律注记同源） | 低 |
| A4 | `ymap.set(k, undefined)` 合法；`has=true, get=undefined, keys 含 k`；`toJSON()` 省略该键 | 设计期实测 | P1/L 输出 `has= true get= undefined keys= ["u"] toJSON= {}` → E1 吸收裁决的三重依据 | 低 |
| A5 | `getMap('ROOT')` 在 ROOT 为 Y.Array/Y.Text 时 throw；缺席时零 update 事件且幂等 | 设计期实测 + 现有源码 | P2/F 抛 `Type with the name ROOT has already been defined with a different constructor`；P3 `update events: 0`；P13 同引用 → probeRoot 级联与惰性创建语义成立（carrier.ts 既有 P1b–P4 探针同源） | 低 |
| A6 | 索引读执行 enumerable accessor；`getOwnPropertyDescriptor` 不执行 | 设计期实测 | 探针 I：`index-read executed getter: true`；探针 J：`descriptor read no exec: true` → D5 descriptor 键空间助手的直接依据（也是 extract 潜在缺陷的复现证据） | 低 |
| A7 | plain 引用原样入 Y.Map（identity 保留、set 零 getter 触发）；嵌套 Yjs 于 plain 容器可达 | 设计期实测 | P8 `identity preserved: true / set triggered getter: 0`；P17 `nested Y.Map reachable: true, same ref: true` → AC3/AC4 可达性前提 | 低 |
| A8 | 顶层 null-proto 对象 set 抛；嵌套可达 | 设计期实测 | G2b 抛 `Unexpected content type`；G2 嵌套读回 proto===null → E13 | 低 |
| A9 | `Y.Map` 键 `'__proto__'` 公共 API 可达；own enumerable `__proto__` 数据键可构造可枚举 | 设计期实测 | P7 `has=true get=1`；P6 `Object.keys=['__proto__']` 且 descriptor 值可读 → D6 安全写入必要性 | 低 |
| A10 | `-0` 段：`Number.isInteger(-0) && -0>=0` 为 true；`ya.get(-0)`/`arr[-0]` 归一 0 | 设计期实测 | 实测输出原文（R2 补贴正文）：`C yarr.get(-0)= a | plain [10,20][-0]= 10 | [-0]>=0: true, Number.isInteger(-0): true` → D3 | 低 |
| A11 | `function` 直存抛（plain 容器内嵌可达）；`NaN`/bigint 直存合法 | 设计期实测 | P16 抛 `Unexpected content type`；P14 `get: NaN`；P15 `typeof bigint` → C3 违规族可达性 | 低 |
| A12 | `Object.keys` 忽略 symbol 键；稀疏数组空洞读 undefined | 设计期实测（语言语义） | 探针 H `["sym"]`；探针 K `sparse[1]: undefined length: 3` → D5/E14 | 低 |
| A13 | CI node 矩阵 20/24；vitest include `packages/*/test/**`；typecheck 仅 test-d 经 root tsconfig.typecheck.json | 源码引用 | `.github/workflows/ci.yml` matrix `node: [20, 24]`；`vitest.config.ts` include/typecheck 配置；root package.json scripts | 低 |
| A14 | detached Yjs 载体（`v.doc === null`，未集成 doc）读语义 = 空 + **每次调用触发 `console.warn('Invalid access: Add Yjs type to a document before reading data.')`**；detached `XmlFragment.toString()` = `''`（length=1 非空片段内容静默丢失）；detached 写静默 no-op；别名集成载体（先 set 进 doc 再塞 plain 容器）`doc !== null`、借道读真实数据 | 设计期实测（R2 #2；SA2 独立复现一致） | 本轮实测输出：`D1 detached frag.doc === null | toString: "" | length: 1`；`D1 detached map.doc === null | keys: [] | get: undefined`；`D2 nested frag still detached: true`（内嵌不集成）；`D3 alias integrated doc===null: false | read back: 1`；stderr 每次 detached 读输出 `Invalid access: Add Yjs type to a document before reading data.` → D2 detached 守卫 / E19/E20/E21 / INV-R13 | 低 |

无进程/端口/跨进程资源生命周期类假设；无第三方工具行为假设（yjs 为唯一运行时依赖，全部实测）。

---

## §9. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数

| 函数 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `readLogicalValueAtPath` | `packages/doc-runtime/src/read.ts:43` | `(derived: DerivedSchema, doc: Y.Doc, path) → ReadLogicalValueResult`（schema-aware：未知字段/非法段/schema 拒绝 → PATH_NOT_ALLOWED） | `(doc: Y.Doc, path) → ReadLogicalValueResult`（schema-independent：载体驱动；未知字段不再是失败类别；新增值域违规失败族）。**返回联合类型形态逐字不变**；同步性/不抛错不变（无 return↔throw 迁移） |
| `arbitrateUnion` / `NavOutcome`（模块级导出） | `packages/doc-runtime/src/read.ts:271/296` | 包内 deep-import seam（rev2/SA8 注记 R2-1 破例） | **删除**（union 概念随 schema-aware 语义退役） |
| `walk` / `makeRefResolver`（extract.ts @internal 导出） | `packages/doc-runtime/src/extract.ts:89/233` | 包内复用接缝（read.ts 消费） | **保留原样**——read.ts 停止消费，extract 自用不变（无契约改动） |

同步函数、无 async 化、无 return↔throw 迁移、无 nullable 化：**错误通道与调用时序零变化**，变更半径 = 参数表收窄一格。

### Caller 清单（抓全命令与结果）

```bash
git grep -n "readLogicalValueAtPath\|arbitrateUnion\|NavOutcome" -- ':!wiki' ':!node_modules' ':!docs' ':!CONTEXT.md'
```

| Caller | 文件 | 是否 await（同步 N/A） | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| 公共出口 re-export | `packages/doc-runtime/src/index.ts:27-28` | N/A（同步） | N/A | N/A | 符号名不变，仅 JSDoc 注释更新（§6.1） |
| 行为测试（三参调用） | `test/read-logical-value-at-path.test.ts`（423 行，~60 调用点） | N/A | N/A | N/A | **删除**（§6.2——锚定被取代语义，与新红线矛盾） |
| 行为测试（三参） | `test/read-logical-value-at-path-rev1-hardening.test.ts` | N/A | N/A | N/A | 删除（§6.2） |
| 行为测试（三参） | `test/read-logical-value-at-path-rev1-union-arbitration.test.ts` | N/A | N/A | N/A | 删除（§6.2） |
| 行为测试（三参） | `test/read-logical-value-at-path-supplementary.test.ts` | N/A | N/A | N/A | 删除 + 通用锚与 SUP-5 vfsl seam 锚移植 guards 新文件（§6.2，R2 #3/#4） |
| 纯函数测试（deep import `../src/read.js`） | `test/read-logical-value-at-path-rev2-union-arbitration-pure.test.ts` | N/A | N/A | N/A | 删除（被测函数退役；不删则模块解析编译失败） |
| 类型测试（deep import + barrel 负锁） | `test/read-logical-value-at-path-rev2-inv14-negative.test-d.ts` | N/A | N/A | N/A | 删除（导出面锁失效，§6.2） |
| 类型测试（三参合法锁） | `test/read-logical-value-at-path.test-d.ts` | N/A | N/A | N/A | 删除（与新 test-d `@ts-expect-error` 反向锁冲突） |
| 生产 caller | —（实测为零） | — | — | — | 无需处置（§0.4：包外无消费方，apps/packages/domains/tests grep 零命中） |
| 文档引用 | `CONTEXT.md:57`、`docs/adr/0007:26,50`、`docs/adr/0008:16,103`、`packages/vfsl/src/index.ts:86`（注释） | N/A | N/A | N/A | 零改动——ADR-0008 已按新签名立法，注释与词条已更新（Parent PR 完成） |

### 风险评估

- **遗漏 caller 的代价**：三参调用点若残留 → `pnpm typecheck` TS2554 硬红（红灯证据即此机理）→ CI 拦截，不会静默流入。
- **deep import 残留的代价**：rev2 两文件 import 已删符号 → 模块解析失败硬红 → 同样 CI 拦截。
- **运行时误用（JS 调用方传 derived 于首位）**：旧三参在参数表收窄后，`(derived, doc, path)` 调用会把 DerivedSchema 传入 `doc: Y.Doc` 位 → probeRoot 内 `doc.getMap` TypeError → E100 结构化返回（INV-R1 不抛）——降级为响亮的结构化失败而非崩溃。
- **行为迁移面**（同一调用在旧新契约下的结局差异，全部为新契约的**立法意图**，ADR-0008 授权）：未知 schema 字段 `['nope']`：旧 PATH_NOT_ALLOWED → 新 ok:true undefined；空 schema 文档：旧必须先编译 → 新直接可读；union/Record/optional 导航：旧语义 → 新按实际载体（无 schema 可言）。已由 37 例冻结锚定背书。

---

## §10. SA2 预答（设计自检）

1. **「删除 7 个测试文件 = 覆盖倒退」** → §6.2 逐文件理由 + 移植清单：被删用例锚定被 ADR-0008 明文取代的语义（保留即与新红线测试**永久互斥**，全量门禁不可能同时绿）；可迁移的载体无关锚（F2 守卫/零副作用/-0/2^53/对照）全部移植；简报交接节明文授权「适配/移除」。
2. **「吸收 vs 响亮的非对称（E1/E2 vs 数组 undefined）」** → §3 D4 表：四重依据（yjs toJSON 实测、JSON 投影域等值论证、旧 D4 先例、SA6 违规清单的列举边界）。
3. **「E100 把数据违规当 internal bug（循环引用 E10）」** → §3 D10：可观测通道同形（message 非契约字段），cycle 预检只改文案不改结局，付出每读 WeakSet 开销不值；与 extract 同口径。
4. **「导航与投影键空间分裂」** → §3 D5/INV-R11：同一 descriptor 助手，分裂在结构上不可发生。
5. **「XmlFragment toString 锁逐字？」** → ADR-0007「只承诺语义等价 round-trip」；测试 normalizeXml 归一化比对；探针 A2 实测语义串。
6. **「freeze 陷阱」** → §3 D6 尾注 + INV-R7：defineProperty 四描述符全 true，漏传即 AC6 红。
7. **「并发/observer 窗口读取」** → §3 D11：同步栈原子观察 + 零订阅零事件（INV-R9）；ADR-0008 明文读取不进 sequencer。
8. **「性能」** → §3 D12：O(path+子树)，无 memo 需求（union 回溯源消失），ADR-0007 成本条款满足。
9. **「为什么重写而不是兼容层」** → §0.3 部件失效表。
10. **「read.ts 与 extract.ts 拷贝器漂移」** → §3 D7 分叉表 + 潜在缺陷申报 + 收敛路径（独立任务修 extract 后可回单一 seam）。

**R2 后记（2026-08-23，SA2 R1 实际攻击 vs 首轮预答对照）**：预答 1（覆盖倒退）被 #3 部分命中——SUP-5 seam 覆盖点漏判（「已有 vfsl 测试覆盖」为事实错误，已移植）；预答 3（E100 通道同形）方向成立，但 #2 detached 揭示了「通道同形却 XML 内容静默蒸发」的新静默家族（已按方案 a 封死，INV-R13）；预答 10（拷贝器分叉）获 SA2 独立复现背书（extract accessor 执行缺陷确认）；#1 哨兵碰撞与 #4 移植精度为首轮未预见的实现蓝图级缺陷。全部 8 点已落实（见「SA2 反馈逐条回应」表）——R2 修订完稿，交出控制权，等待 SA2 复审。

**R3 后记（2026-08-23，SA2 R2 复审）**：R1 八点 100% 核销、R2 新机制二轮攻击全部成立；仅余 R2-1（零副作用锚三重自相矛盾——R2 修 #4 时把旧锚 `size===0` 断言与新选的 `['title','x']` 拒绝路径错误拼接，属「主动加固」再次引祸，与 R2 主动修复的 G0 前缀同源教训：**移植锚的 fixture 与断言必须整对推导，不能跨锚拼接**）与 R2-2（计数口径 27→26）。R3 按方案 (i)+(ii) 拆为两个各自自洽的独立锚 + fixture 规格显式化（根治），计数三处更正并附口径注；顺带落实三项 INFO 与 detached 三形态并列锚。——R3 修订完稿，交出控制权，等待 SA2 复审（预计放行）。

**R4 后记（2026-08-23，SA4 静态验尸 F2 处置）**：SA3 的 package.json patch bump（0.1.5→0.1.6，commit 51621caf）被 SA4 按 §7 DENY 判 scope 违规（F2，reject 项）——根源是 R1 的 DENY 行把「版本号 bump」与「依赖改动」混写为整文件「零改动」，未识别 MABF 硬门禁 #9 的优先级。R4 按 SA4 处置选项一将该文件移入 ALLOW（仅限 version 字段 patch bump），依赖与其他字段仍零改动、tsconfig.json 仍 DENY。教训入库：**DENY 行需按字段粒度声明豁免（硬门禁 > 设计约束），整文件粒度的「零改动」会与仓库级强制惯例冲突**。SA4 同报告的 F1（catch 块 `String(detail)` 可被敌意 toString 击穿外抛）与 D3（isPlainRecord 判据偏离）为 SA3 侧修复项/已接受偏离，不在本 R4 单点处置范围（总控指令限定）。

**R5 后记（2026-08-23，SA4 R2 复审处置——两项设计勘误，抹平设计与实现字面漂移）**：(1) **错误通道蓝本**：SA4 R1-F1 三向量（敌意 toString P1 / 敌意 message getter P9 / Proxy 包装数组敌意 Symbol.iterator P10）与 R2-F1a（message 为非原始 string 数据属性 → 模板插值 ToString 逃逸 NEW1/NEW2）证明「收编者自身无抛点」必须细化到**每个不可信值的每次转换**；TS 类型断言（`Error.message: string`）不可作为运行时安全依据——safeDetail 的 `typeof raw === 'string'` 收窄与同文件 yjsWord 的既有 typeof 守卫同构；蓝本同步防下轮照抄再犯。(2) **isPlainRecord**：R1 字面判据与冻结 AC3 fixture 直接矛盾（三层 plain 中继链按字面应 loud、冻结断言投影 `{own:'v'}`）——SA1/SA2 三轮评审均未发现、SA3 实现期捕获、SA4 R1-D3 核验接受，R5 正式回收为设计判据。教训入库：**设计判据必须对冻结 fixture 逐键推演**（EXPECTED_ROOT 每个键过一遍判据即可当场暴露该矛盾）；「冻结契约优先于设计文本」是偏离裁决的基准方向。
