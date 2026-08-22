# SA1 设计 — `readLogicalValueAtPath(derived, doc, path)`：按 LogicalPath 同步读取 Yjs 子树逻辑值（Issue #75）

- **任务类型**：feature（ADR-0007 四能力之三的落地票）
- **worktree**：`/home/wangjian/nomicore-fix-issue-75`（branch `fix/issue-75-on-docs-doc-runtime-validation`）
- **授权链**：issue #75 → 任务简报 `wiki/raw/task_read-logical-value-at-path.md` → SA8 冲突门禁 `clear`（`…_conflict_report.md`，含注记 A/B/C）→ SA6 Phase 1 冻结契约（`packages/doc-runtime/test/read-logical-value-at-path.test.ts` 20 用例 + `.test-d.ts` 类型层）→ 本设计
- **前置依赖**：#73（`extractYjsSnapshot` 已在 `44156db` 落地，本设计复用其转换器）

---

## 摘要（一页看懂）

`readLogicalValueAtPath` 是 `@nomicore/doc-runtime` 新增的**同步只读**公共能力：给定派生 schema、live doc 与一条 `readonly (string | number)[]` 路径，定位并转换目标子树为普通逻辑值副本。它**不重复全树验证**（ADR-0007「加载和更新负责验证，读取按 path 快速执行」），只触碰路径沿线与目标子树（AC6 的可观测面：与目标无关的兄弟子树结构损坏不影响目标读取）。

核心架构是**两阶段模型**：

```
Phase A（纯 schema 许可判定，零 doc 访问）
  结构树沿 path 逐段下钻 + values 树锁步双游标（唯一职责：Record keyPattern）
  → 拒绝 = 「schema 不允许的路径」→ { ok:false, code:'PATH_NOT_ALLOWED', path }
Phase B（活数据解析 + 定点转换）
  沿 path 读 live 载体（仅 get/length，零写入）：合法缺键短路 undefined，
  union 逐成员活导航（any-of，声明序首个可产出者胜），路径耗尽处
  复用 extract 的 walk() 转换目标子树 → 普通值深拷贝
```

两阶段分离的立法性理由：**schema 许可判定必须与 live presence 无关**——`['title','x']`（leaf 下钻）无论 `title` 在场与否都必须是 `PATH_NOT_ALLOWED`，路径合法性是 schema 性质而非数据性质；而合法缺键（optional/Record/数组越界 → `ok:true, value:undefined`）又是数据性质。两个正交关切分成两个纯函数，语义各自封闭。

三项关键机制裁决（SA2 重点攻击面，§7 预判）：

1. **导航权威 = 结构树 + ref 解析器，不使用 `derived.index`**——索引在 union 成员（evaluate.ts §7.2「union 停——成员不立行」）与 ref 别名子树（别名物化 path=null 不产行）上有**结构性缺口**，本设计期已用探针实证（§4.2）；
2. **Record keyPattern 判定 = `derived.values` 树锁步双游标 + vfsl pattern 引擎**——结构树不携带 keyPattern、索引有上述缺口，values 树在**每个** Record 物化位完整携带（决策 F2，实证见 §4.3）；引擎用 vfsl 受限正则引擎（validate 同源，抗 ReDoS），为此向 vfsl 公共 API 增补接缝：`compilePattern` 别名导出 + `matchPattern` **双参薄包装**（§4.7，R5 修订）；
3. **失败单通道**——结果联合冻结为二形（SA6 注记 B），一切失败（含不变量外防御态、内部缺陷）统一映射 `PATH_NOT_ALLOWED` + 整条尝试路径回显 + 补充性 `message?` 诊断字段（§3.2 C1/C2/C3 分类，是对「契约禁抛错 + 联合冻结二形」双重约束的唯一不自欺推导）。

R1 修订回流（SA2 R1 评审攻击点 #1/#2/#3；核心架构已通过攻击验证，以下为收敛项）：

4. **Phase B 有意零 keyPattern 消费（D15，R1）**——pattern 许可性由 Phase A 按 any-of 键空间**并集**判定；Phase B 对 Record 键不做成员局部 pattern 检查，成员选择错位由载体/结构自校验自纠——与 extract walk/walkUnion 的 keyPattern 零消费纪律同源，锁死「read 与 extractYjsSnapshot 对同 doc 投影一致」（§4.5 反例走查）；
5. **每调用局部 memo（D13，R2）**——Phase A 键（节点， 深度）、Phase B 键（节点， live， 深度），把重叠联合最坏情形的 2^n 回溯折叠为多项式（§4.3/§4.4/§4.9）；
6. **Phase A 先行（D14，R3）**——probeRoot 后置：schema 拒绝的路径**零 doc 触碰**。

### 决策总表

| # | 决策 | 一句话理由 | 详节 |
|---|---|---|---|
| D1 | 两阶段模型：Phase A 纯 schema 许可 / Phase B 活解析+定点转换 | schema 许可与 live presence 正交；presence-independence（AC2/AC5 语义完整性） | §4.1 |
| D2 | 导航权威 = 结构树 + makeRefResolver；`derived.index` 不参与路径导航 | 索引在 union 成员与 ref 别名子树有结构性缺口（探针实证）；extract 同结论先例 | §4.2 |
| D3 | keyPattern 来源 = values 树锁步双游标；判定引擎 = vfsl pattern 引擎（公共接缝：compilePattern 别名导出 + matchPattern 双参薄包装，R5） | 结构树无 pattern、索引有缺口；validate 与 read 必须同引擎（单一语义真相源 + 抗 ReDoS）；charge 记账参数不进公共契约 | §4.3/§4.7 |
| D4 | union 导航 = any-of 逐成员**活**导航，声明序首个可产出者胜；判别式零读取 | 载体 API 按成员分叉（map vs array），纯 schema 导航无法执行读取；对齐 extract INV-4/INV-8 | §4.5 |
| D5 | 结果联合 = SA6 冻结二形 + 补充性 `message?: string` | 冻结字段零改动；纯增补（SA6 契约允许「仅可补充」）；崩溃边界需要带内诊断通道 | §3.1 |
| D6 | 不变量外防御态与内部缺陷（载体错位/required 缺席/引擎预算耗尽/手造派生物，详见 §3.2 C2/C3）统一映射 `PATH_NOT_ALLOWED` | 契约禁抛错 + 联合冻结二形 ⇒ 无第三通道；`ok:true` 或静默是虚假降级（2026-05-07 立法） | §3.2 |
| D7 | 终点转换复用 `extract.ts` 的 `walk()`（包内导出，不走公共入口） | 单一转换语义源；复制 120 行 walk 必然漂移（copyPlainValue/union 试验/安全写入全在 walk 闭环内） | §4.6 |
| D8 | 合法缺键**吸收式**语义：路径中点缺 optional/Record 键、非负整数越界 → `value:undefined`，不再检验余下段（Phase A 已许可） | 与路径终点缺键（AC3）同构；余下段对不存在的值无从检验 | §4.4 |
| D9 | 段合法形态：map/Record 段必须 string；array 段必须 `Number.isInteger(seg) && seg >= 0`（-0 经 JS 属性访问语义自然归一为 0） | ADR-0007「map 用 string，Y.Array 用 number」；AC4 | §4.4 |
| D10 | `plain` 为不可下钻终态：元素级读取一律 `PATH_NOT_ALLOWED`，仅允许整体读取 | ADR-0004 D1「YPlainArray 只能整体替换」的对偶 + AC5 | §4.4 |
| D11 | 崩溃边界：全函数体顶层 try/catch 收编一切异常 → `PATH_NOT_ALLOWED` + `DOCRT-E100` 前缀 message | 对齐 extract INV-6「绝不外抛」；SA6 冻结「同步、不抛错」 | §4.8 |
| D12 | 空 path = 显式读取完整 ROOT；空 doc 经 probeRoot 惰性 map（零 update 事件）读取为 `{}` | ADR-0007「空路径表示显式读取整个 ROOT」；carrier.ts P4 实证 | §4.1/§4.8 |
| D13（R2） | 每调用局部 memo：Phase A 键（resolve 后节点引用, i）、Phase B 键（节点引用, live 引用, i）——重叠联合最坏 2^n 回溯折叠为 O(触及节点数 × 路径长) | schema 本身是 doc 数据（ADR-0001），公共 API 接受任意 derived——对抗性但合法的重叠联合 schema + 长路径 = 进程内 CPU 燃烧面 | §4.3/§4.4/§4.9 |
| D14（R3） | 编排重排：Phase A 谓词先行，probeRoot 后置——schema 拒绝的路径零 doc 触碰（含零惰性创建） | 读取函数更净的不变量；重排零成本，行为差异仅双坏输入的 message 措辞（同 code） | §4.1/§4.8 |
| D15（R1） | Phase B 有意零 keyPattern 消费：pattern 许可 = Phase A any-of 键空间并集语义；成员选择错位由载体/结构自校验自纠 | 与 extract walk/walkUnion 的 keyPattern 零消费纪律同源（extract D4/B5）——成员局部 pattern 检查会制造与 extract ground truth 的投影分歧，击穿 AC6-19 立论前提 | §4.4/§4.5 |

---

## §1. 背景、授权链与现状盘点

### 1.1 ADR 授权链（约束基准，摘自 relevant_decisions，回查原文核对）

| ADR | 对本设计的约束 | 落点 |
|---|---|---|
| 0007（直接治理） | 「`readLogicalValueAtPath(derived, doc, path)`：同步按路径读取，只转换目标子树；依赖 create/open/update 已建立并维持的结构不变量，普通读取不重复验证。空路径表示显式读取整个 ROOT；合法 optional/Record/数组缺失返回 `undefined`」 | §3/§4 全文 |
| 0007 | 「路径统一为 `readonly (string \| number)[]`：map/object/Record 使用 string，Y.Array 使用 number；禁止点号字符串与 JSON Pointer。leaf、plain、XML 是不可下钻终态。XML string 与 Y.XmlFragment 只承诺语义等价」 | D9/D10，§4.4 |
| 0007 | 「普通读取成本与目标 path 子树规模相关」「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型……Yjs 结构与路径/操作错误 fail-fast」 | §4.9；D5/D6 |
| 0003 | ROOT 固定物化 Y.Map（`doc.getMap('ROOT')`）；`xml-fragment` 终态；union any-of「至少一个成员接受即接受」「路径存在性为任一成员出现即存在」；ref 按名引用不内联展开 | §4.2/§4.5 |
| 0003 §4 + CONTEXT.md | 派生 schema = 结构树 + 值 schema + 路径索引打包；纯数据、别名按名引用 | §4.2/§4.3 消费策略 |
| 0006 | doc 三条目布局：读取目标止于 ROOT 子树，不触 SCHEMA/META 兄弟条目 | probeRoot 只碰 'ROOT'（INV-7 同源） |
| 0004（注记 C） | 编译期 patch 路径字符串下标（`'3'`）与运行时 number 下标是**两个独立接缝**，本任务按 0007 实现 number，勿以 0004 为运行时依据 | D9 |
| 0001 | `derived` 上游是 SCHEMA 信封的运行时编译产物；本任务不触 schema 文本纪律 | 文件清单 DENY |

SA8 注记落实：**注记 A**（边界细化：格式合法但越界 = 缺失；负数/非整数/字符串 = 非法路径）→ D9 + §4.4 规则表显式落定；**注记 B**（`PATH_NOT_ALLOWED` 保持领域化结果联合，不并入 issues 体系）→ D5/D6；**注记 C**（勿以 0004 字符串下标为运行时依据）→ D9。

### 1.2 代码现状（全部已读 + 设计期探针实证）

| 文件 | 现状 | 本设计的消费方式 |
|---|---|---|
| `packages/doc-runtime/src/extract.ts`（44156db，#73 产物） | `extractYjsSnapshot` + 私有 `walk`（§4.3 全景表分发点：map/array/xml-fragment/leaf/plain/union/ref 八 kinds）、`makeRefResolver`（D8：环守卫 + memo）、`copyPlainValue`（JSON 值域断言）、`putSnapshotKey`（defineProperty 安全写入） | 复用 `walk` + `makeRefResolver`：**包内导出**（D7），公共入口不变 |
| `packages/doc-runtime/src/carrier.ts` | `carrierOf`（五值词汇表 + null 不可达态）、`probeRoot`（四级探针级联；惰性创建零 update 事件 P4） | 原样只读复用，零修改 |
| `packages/doc-runtime/src/index.ts` | 仅导出 extractYjsSnapshot + 两个类型 | 追加 readLogicalValueAtPath + 结果类型导出 |
| `packages/vfsl/src/derived.ts` | DerivedSchema 五件套（aliases/structure/values/index/docs×3）；`StructureNode` 八 kinds；`ValueSchema.keyPattern`（决策 F2「仅 Record 物化位携带」） | 结构树 = 导航权威；values 树 = keyPattern 唯一可靠来源（§4.3 实证） |
| `packages/vfsl/src/evaluate.ts` | 别名物化 path=null 不产索引行（L51-54）；字段/Record/数组在自身语法路径物化产行（L172-191）；**union 成员不立行**（L120/155「§7.2 union 停」）；ref 结构形按名终态（L89-94）；valueOf Record 物化 object+keyPattern（L292-296） | D2/D3 的证据源 |
| `packages/vfsl/src/pattern.ts` | 受限正则引擎：`compile`/`match`（BFS 模拟、无回溯栈、步数预算 fail-closed）、`matchBudget` 二次项护栏；**未导出到公共 API** | D3：公共导出 compilePattern/matchPattern（§4.7） |
| `packages/vfsl/src/validate.ts` | `validateKeyPattern`（L271-280）：键位被到达才编译、`match(compiled, key, charge)` 判定 | read 侧键判定必须与此同引擎（INV-9） |

**设计期实测验证**（探针脚本，命令与关键输出；fixture = SA6 测试同款规格文本）：

```bash
# /tmp/probe75/probe.mts：parseVfsl + evaluate 两个 fixture（内联 Record / ref 别名 Record），dump structure/values/index
$ /home/wangjian/nomicore-fix-issue-75/node_modules/.bin/tsx /tmp/probe75/probe.mts
```

关键输出（三处裁决性证据）：

1. **内联 Record**：`index` 有行 `ROOT.assets.<key> | {match:"pattern", keyPattern:"^[A-Za-z0-9_\\-]{1,64}$"}`；**结构树** assets 节点 = `map{fields:[{name:"<key>", node: union…}]}`——**树内无 keyPattern**；
2. **ref 别名 Record**（`type Assets = Record<AssetId,…>; type ROOT = YMap<{assets: Assets}>`）：index **只有** `ROOT.assets | {match:"exact", nodeKind:"ref"}` 一行——**没有** `ROOT.assets.<key>` 行；而 `values['Assets'] = {kind:"object", fields:[{name:"<key>",…}], keyPattern:"^[A-Za-z0-9_\\-]{1,64}$"}` **完整携带**；
3. union 结构节点带 `discriminator:{field:"kind", byValue:{image:0,text:1}}`（本设计零读取）；`notes` 字段 `optional:true` 在结构树 MapField 上。

⇒ 结论：**索引不能作为路径导航机制**（ref 别名子树与 union 成员两处结构性缺口），**values 树是 keyPattern 的完备载体**。D2/D3 的直接依据。

### 1.3 SA6 冻结契约（行为锚点，逐条编号，本设计不得收窄）

| # | 冻结条款 | 本设计落点 |
|---|---|---|
| FC-1 | 公共接缝 `readLogicalValueAtPath(derived: DerivedSchema, doc: Y.Doc, path: readonly (string\|number)[])` 经 `packages/doc-runtime/src/index.ts` 导出；同步、不抛错 | §3.1 签名逐字一致 |
| FC-2 | 结果联合 `{ok:true; value:unknown}` \| `{ok:false; code:'PATH_NOT_ALLOWED'; path: readonly (string\|number)[]}`；fail-fast 单错；path 回显**整条尝试路径**；不并入 issues 体系 | §3.1；D5（+`message?` 纯增补）；D6 |
| FC-3 | AC3 缺键形态：`{ok:true, value:undefined}`——value 键**显式存在**且为 undefined（禁省略键） | §4.4（SA3 陷阱注记：禁 `{ok:true}` 简写） |
| FC-4 | 成功 value 为普通值深拷贝（JSON 往返无损、无 Y.Map/Y.Array/Y.XmlFragment/Y.Text）；XML 为字符串投影只承诺语义等价 | D7 复用 walk（INV-1）；xml `toString()`（extract D7 同款） |
| FC-5 | AC6 行为锚点（不锁实现）：目标子树读取只返回目标子树；坏兄弟子树不影响目标读取；返回值修改不影响 live doc | §4.9 成本模型；D7 深拷贝 |
| FC-6 | 类型层：path 非数组/点号字符串/裸 string/number 一律编译错误（`@ts-expect-error` 自我反转）；`code` 为字面量类型非宽 string | §3.1 签名（`readonly (string\|number)[]` 参数天然拒绝） |

---

## §2. 需求推演（Feature 切入点）

**定位**：`@nomicore/doc-runtime` 第二个公共能力（extract 之后），纯增量：新文件 `read.ts` + 入口导出 + 两处复用导出。不改动 extract 的任何行为，不触 vfsl 求值/校验行为。

**与现有代码的接缝关系**：

- 输入侧：`DerivedSchema`（只读消费，三件套各司其职：structure 导航 / values keyPattern / aliases ref 解析——index 弃用，理由见 D2）、`Y.Doc`（只经 `probeRoot` 触碰，只碰 'ROOT' 名字空间）；
- 输出侧：领域化结果联合（不并入 vfsl issues，注记 B）；
- 机制侧：目标子树的「转换」语义必须与 `extractYjsSnapshot` **逐字节同源**（同一个 walk：union 试验、plain 深拷贝、Record 插入序、安全写入）——否则同一 doc 两条读取路径给出不同投影是架构级自相矛盾。

**七个关键张力**（需求推演产物，§4 逐个裁决）：

| # | 张力 | 裁决 |
|---|---|---|
| T1 | schema 许可（路径是否被 schema 允许）与 live presence（键/下标是否在场）纠缠：`['title','x']` 在 title 缺席时该怎么判？ | 两阶段拆分（D1）：许可判定 presence-independent |
| T2 | keyPattern 在结构树上不存在、索引上有但带缺口 | values 双游标（D3） |
| T3 | union 成员的载体 API 分叉（map.get vs array.get）：纯 schema 导航选错成员就无法执行读取 | any-of 活导航（D4） |
| T4 | 结果联合只有二形，但不变量外的坏输入（错位载体、required 缺席）总得有个归宿 | C1/C2/C3 分类 + 单通道映射（D6） |
| T5 | 读侧键 pattern 判定用什么引擎：原生 RegExp 还是 vfsl 引擎 | vfsl 引擎公共导出（D3，语义单一真相源 + 抗 ReDoS） |
| T6 | 转换器复用还是复制 | 复用 + 包内导出（D7） |
| T7 | mid-path 合法缺键（`['notes','x']` notes 缺席、'x' 是合法字段）返回什么 | 吸收式 undefined（D8） |

---

## §3. 公共契约与结果联合

### 3.1 签名与类型（`packages/doc-runtime/src/read.ts` 新建，`index.ts` 转出口）

```ts
import type * as Y from 'yjs';
import type { DerivedSchema } from '@nomicore/vfsl';

/**
 * readLogicalValueAtPath 结果联合（SA6 冻结形态 + message 纯增补，D5）。
 * - ok:true 恒携带 value（成功 = 目标子树普通值副本；合法缺键 = value 显式为 undefined，FC-3）；
 * - ok:false 恒携带 code:'PATH_NOT_ALLOWED' 与 path（整条尝试路径回显，fail-fast 单错）；
 * - message?：诊断增补字段（非契约字段，消费者不得依赖；C2/C3 类失败携带 DOCRT 前缀详情）。
 */
export type ReadLogicalValueResult =
  | { ok: true; value: unknown }
  | { ok: false; code: 'PATH_NOT_ALLOWED'; path: readonly (string | number)[]; message?: string };

/** 同步按路径读取目标子树逻辑值（ADR-0007）。同步、不抛错（INV-3）。 */
export function readLogicalValueAtPath(
  derived: DerivedSchema,
  doc: Y.Doc,
  path: readonly (string | number)[],
): ReadLogicalValueResult;
```

`index.ts` 追加：`export { readLogicalValueAtPath } from './read.js'; export type { ReadLogicalValueResult } from './read.js';`

**FC-6 类型层自证**：参数类型 `readonly (string | number)[]` 使 `'assets.img1.url'`（string）、`0`（number）、`'assets'`（string）在类型层全部不可传入（test-d 三条 `@ts-expect-error` 由签名直接消费）；`code` 声明为字面量 `'PATH_NOT_ALLOWED'`，`r.ok` 收窄后 `expectTypeOf(r.code).toEqualTypeOf<'PATH_NOT_ALLOWED'>()` 成立；`value: unknown` 同理。

**`message?` 增补的正当性论证**（SA2 预攻击点）：SA6 冻结的是「联合含哪些变体、各变体携带哪些**契约**字段」；`message?` 不删除、不改名、不改任何冻结字段的类型，也不被任何冻结断言检查（SA6 测试只断 `code`/`path`/`ok`/`value`），属任务简报明文允许的「仅可补充」。没有它，崩溃边界（D11）与不变量外防御态（D6）将退化为与正常路径拒绝**不可区分**的静默失败——这正是 2026-05-07 立法「拒绝虚假降级」要封死的形态。带内 message 是「契约禁抛错 + 联合冻结二形」双重约束下**最响**的信号通道。**消费面约定（R4 修订明确）**：应用逻辑只依赖 `code`/`path` 分支；`message` 供**日志/诊断面**消费（SA4 静态评审、SA7 动态验证、运维日志、上游 NamespaceRuntime 的错误日志），不进入应用分支语义——两类消费面分离使「非契约字段」与「可诊断性」并存。

### 3.2 失败分类 C1/C2/C3（D6 核心，拒绝虚假降级对照表）

| 类 | 触发条件 | 语境 | 返回 | 是否设计行为 |
|---|---|---|---|---|
| **C1 schema 不允许** | 未知封闭字段、Record 键违反 Pattern、段类型错（number 上 map / string 上 array）、数组下标负数/非整数、leaf/plain/xml 下钻 | 契约内，调用方正常用错路径 | `{ok:false, code:'PATH_NOT_ALLOWED', path, message}` | ✅ 设计行为（AC2/AC4/AC5） |
| **C2 不变量外活数据态** | 路径**沿线**载体错位（leaf 位是 Y.Map 等）、封闭 map required 字段缺席、非 Y.Map ROOT、plain 域违规（NaN/bigint/Date/内嵌 Y 类型） | 契约外：Registry 管理的 doc 经 open 全量验证后**不可达**（ADR-0007 不变量前提）；仅未注册 doc / 手改数据可触达 | 同上，message 携带详情 | ⛔ 防御性映射（非设计行为，文档显式声明） |
| **C3 内部缺陷** | 手造派生物（structure 非 root、ref 缺名/环、双游标 lockstep 断裂）、pattern 引擎 throw（编译失败/步数预算耗尽——schema 携带不可编译 pattern 属**上游缺陷信号**，R4 统一裁定）、意外异常 | 实现缺陷信号 | 同上，message 携带 `DOCRT-E100: …` | ⛔ 崩溃边界（D11） |

**为什么 C2/C3 映射到 `PATH_NOT_ALLOWED` 而不是别的**：可选方案穷举——(a) 抛错：违反 FC-1「不抛错」；(b) `ok:true, value:undefined`：把不变量破坏伪装成合法缺键，是立法明文禁止的静默降级，且与 AC3 缺键形态**不可区分**（掩盖缺陷）；(c) 第三错误变体：扩展冻结联合形态，超出「补充」边界（SA6 冻结的是变体集本身）；(d) console.error + 前三者之一：带外噪音不构成契约通道。⇒ (PATH_NOT_ALLOWED + message) 是唯一同时满足「不抛错、联合形态不变、失败响亮、不冒充成功」四约束的落点。C2 在契约语境不可达（open 已拒），故其「误导性错误码」风险不进入正常调用面；message 中的详情语句保证可诊断性。

---

## §4. 实现设计（伪代码）

### 4.1 总体编排（D1/D12）

```ts
export function readLogicalValueAtPath(derived, doc, path): ReadLogicalValueResult {
  try {
    if (derived.structure.kind !== 'root') {                       // 手造派生物守卫（对齐 extract L53）
      throw new Error('derived.structure 非 root（手造派生物）');   // → C3 崩溃边界
    }
    const resolveS = makeRefResolver(derived);                      // 复用 extract D8 解析器（环守卫 + memo）
    const resolveV = makeValuesResolver(derived.values);            // values 树专用解析器（同款环守卫，§4.3）
    const patternCache = new Map<string, CompiledPattern>();        // R6：per-call 局部（禁模块级可变态；对齐 validate compileOrCache per-ctx 纪律）
    const memoA: Map<StructureNode, Map<number, boolean>> = new Map();          // R2/D13：Phase A memo
    const memoB: Map<StructureNode, Map<unknown, Map<number, NavOutcome>>> = new Map(); // R2/D13：Phase B memo（live 原始值按值作键、对象按引用作键）

    // Phase A 先行（R3/D14）：纯 schema 许可判定——被拒路径零 doc 触碰（含零惰性创建）
    if (!isPathAllowed(derived.structure.node, derived.values['ROOT'], path, 0, resolveS, resolveV, patternCache, memoA)) {
      return notAllowed(path, '路径不被 schema 允许');              // C1——此刻 doc 未被触碰（INV-10）
    }
    // probeRoot 后置（R3/D14）：Phase A 通过后才触碰 doc（INV-7：只碰 'ROOT'；唯一触碰 doc 的入口）
    const probe = probeRoot(doc);
    if (probe.carrier !== 'Y.Map') {
      return notAllowed(path, 'ROOT 载体非 Y.Map（不变量外输入）'); // C2：整树不可读（open 期必已被拒）
    }
    // Phase B：活数据解析 + 定点转换
    const r = resolveLive(derived.structure.node, probe.map, path, 0, resolveS, path, memoB);
    return r.ok
      ? { ok: true, value: r.value }                                // FC-3：value 键恒显式构造
      : notAllowed(path, '路径无法在 live 数据上解析（不变量外输入）'); // C2（Phase A 已放行，Phase B 活态拒绝）
  } catch (err) {                                                   // 崩溃边界（D11，对齐 extract §4.8）
    const detail = err instanceof Error ? err.message : String(err);
    return notAllowed(path, `DOCRT-E100: 内部错误（意外异常）: ${detail}`); // C3
  }
}

/** 统一失败构造：path 回显整条尝试路径的**新鲜副本**（不别名调用方数组）；message 恒非空。 */
function notAllowed(path, message): ReadLogicalValueResult {
  return { ok: false, code: 'PATH_NOT_ALLOWED', path: [...path], message };
}
```

**为什么是两阶段而不是单趟交织**（T1 裁决）：交织式导航在遇到合法缺键时只能「就地短路返回 undefined」，这会使 `['notes','x']`（notes 缺席、x 对 leaf 下钻）返回 `ok:true`——而同一路径在 notes 在场时返回 `PATH_NOT_ALLOWED`。**路径是否被 schema 允许是 schema 的性质，不得依赖数据在场性**（AC2 措辞「schema 不允许的路径」的直接推论）。两阶段把「许可」与「解析」拆成两个各自封闭的纯函数，且 Phase A 是零 doc 访问的纯 schema 谓词（可独立单测）。代价是段类型检查在两阶段各出现一次（各 ~10 行），换取语义完备。

### 4.2 派生数据消费策略（D2）

| 部件 | 角色 | 依据 |
|---|---|---|
| `derived.structure`（+ `aliases` 经 makeRefResolver） | **导航权威**：字段存在性、段类型合法性、终态判定、union 成员迭代 | 八 kinds 全覆盖（extract §4.3 同源） |
| `derived.values`（+ 独立 values 解析器） | **唯一被咨询点：Record 节点位的 keyPattern**（锁步双游标，§4.3） | 结构树不携带 keyPattern（§1.2 实证 1）；索引带缺口（实证 2） |
| `derived.index` | **不参与**。两处结构性缺口：① union 成员不立行（evaluate.ts L120/L155「§7.2 union 停——成员不立行」）——`['assets','img1','url']` 末段在索引中无行可查；② 别名物化 path=null（L51-54）——ref 别名 Record 的 `ROOT.assets.<key>` 行不存在（§1.2 实证 2：场景 2 索引仅 1 行） | 探针实证 + evaluate.ts 行号 |
| `derived.aliasDocs/fieldDocs/markerDocs` | 不消费（文档域，与读取无关） | — |

extract 同结论先例：#73 的 walk 从一开始就绕开 index 走树 + 解析器。本设计与其保持同一消费立场。

### 4.3 Phase A：`isPathAllowed`（纯 schema 谓词，零 doc 访问）

```ts
/** 段合法形态谓词（D9）。 */
function validMapSeg(seg: unknown): seg is string { return typeof seg === 'string'; }
function validArraySeg(seg: unknown): boolean {
  return typeof seg === 'number' && Number.isInteger(seg) && seg >= 0; // -0：-0>=0 为 true，属性访问语义归一为 0
}

/**
 * 纯 schema 许可判定：结构树游标 + values 锁步游标沿 segs[i..] 下钻。
 * 只回答「schema 是否允许这条路径」，不看任何 live 数据（presence-independent，D1）。
 * R2/D13：入口/出口为 memo 挂点（键 = resolve 后节点对象引用 + 深度 i）——重叠联合最坏 2^n 回溯折叠为多项式。
 */
function isPathAllowed(node, vCursor, segs, i, resolveS, resolveV, pc, memo): boolean {
  node = resolveS(node);                                  // ref 链解析（含环守卫）；memo 键取 resolve 后节点
  const hit = memo.get(node)?.get(i);                     // R2：同一 (节点, 深度) 结果确定（健全性见下）
  if (hit !== undefined) return hit;
  const out = decide(node, vCursor, segs, i, resolveS, resolveV, pc, memo); // decide = 下方 switch 体（下钻一律递归回本函数）
  let byDepth = memo.get(node);
  if (byDepth === undefined) { byDepth = new Map(); memo.set(node, byDepth); }
  byDepth.set(i, out);
  return out;

  function decide(node, vCursor, segs, i, resolveS, resolveV, pc, memo): boolean {
    if (i === segs.length) return true;                     // 路径耗尽 = 目标节点本身恒许可
    const seg = segs[i]!;                                   // noUncheckedIndexedAccess 纪律
    switch (node.kind) {
      case 'root': return isPathAllowed(node.node, vCursor, segs, i, resolveS, resolveV, pc, memo);
      case 'map': {
        if (!validMapSeg(seg)) return false;                // number 段上 map/Record（D9）
        const first = node.fields[0]!;
        if (isRecordForm(node)) {                           // 单 '<key>' 字段（extract.ts:100 同款判别式）
          const vObj = resolveV(vCursor);                   // 锁步：Record 位 values 必为 object（lockstep 断裂 → throw → C3）
          if (vObj.kind !== 'object') throw new Error(`lockstep 断裂：Record 位 values=${vObj.kind}`);
          if (vObj.keyPattern !== undefined && !keyAllowed(vObj.keyPattern, seg, pc)) return false; // D3 引擎；许可 = any-of 并集语义（D15/R1，见 §4.5）
          return isPathAllowed(first.node, vChild(vObj, '<key>'), segs, i + 1, resolveS, resolveV, pc, memo);
        }
        const f = node.fields.find((x) => x.name === seg);
        if (f === undefined) return false;                  // 未知封闭字段（AC2 用例 4）
        return isPathAllowed(f.node, vChild(resolveV(vCursor), seg), segs, i + 1, resolveS, resolveV, pc, memo);
      }
      case 'array': {
        if (!validArraySeg(seg)) return false;              // 负数/非整数/字符串下标（AC4 用例 11-13）
        return isPathAllowed(node.element, vElement(resolveV(vCursor)), segs, i + 1, resolveS, resolveV, pc, memo);
      }
      case 'union': {                                       // 纯 schema any-of（ADR-0003 存在性语义）
        const vu = resolveV(vCursor);
        if (vu.kind !== 'union') throw new Error(`lockstep 断裂：union 位 values=${vu.kind}`);
        return node.members.some((m, idx) =>
          isPathAllowed(m, vu.members[idx]!, segs, i, resolveS, resolveV, pc, memo)); // 成员序同源（IR 同构）
      }
      case 'leaf': case 'plain': case 'xml-fragment':
        return false;                                       // 终态下钻（AC5；plain 元素级读取 D10）
    }
  }
}
```

**values 锁步双游标规则表**（D3；两树经同一 IR 同构物化，锁步只维护到需要咨询 keyPattern 的深度）：

| 结构树动作 | values 游标动作 | 备注 |
|---|---|---|
| 入口：`structure.node` | `values['ROOT']` | 探针实证 1（C 节）确认形态对应 |
| map 封闭字段 `f` | `fields.find(name === f.name).value`，若 `{kind:'optional'}` 则解包 `.value` | 字段声明序同源（evaluate materializeObject ↔ valueOf object） |
| map Record `'<key>'` 字段 | 同上（字段名 `'<key>'` 同名哨兵）；**keyPattern 读自 resolve 后的 object 节点本体** | 决策 F2：keyPattern 在 Record 物化位（evaluate.ts L292-296） |
| array `element` | `.element` | |
| union 成员 i | `members[i]` | 声明序同源（evaluate 两树各自 `t.members.map` 1:1） |
| ref `name` | `ref name → resolveV(values[name])` | 同名别名表；独立解析器（环守卫 + memo，镜像 makeRefResolver） |
| leaf/plain/xml-fragment | 终态，游标不再前进 | 标量联合折叠（structure leaf ↔ values enum/union）等不对称**只发生在终态**，锁步安全 |

lockstep 断裂（手造派生物）→ throw → C3 崩溃边界。**实证完备性**（§1.2）：内联 Record、ref 别名 Record、ROOT 级 Record、union 成员内 Record、嵌套 Record、数组元素 Record——values 树在全部位置携带 keyPattern（valueOf 对 Record 恒物化 object+keyPattern，别名全量入 `values` 表）。

**values 游标推进助手**（§4.3 伪代码中 `vChild` / `vElement` 的语义规格）：

```ts
/** 取 object 字段的 values 子树：ref 解析 → optional 解包 → 按名取字段。
 *  任一步落空（字段缺失 / 非 object 形）= lockstep 断裂 → throw → C3 崩溃边界（禁静默降级）。 */
function vChild(vObj: { kind: 'object'; fields: ValueField[] }, name: string): ValueSchema {
  const f = vObj.fields.find((x) => x.name === name);
  if (f === undefined) throw new Error(`lockstep 断裂：values 无字段 ${name}`);
  return f.value.kind === 'optional' ? f.value.value : f.value;   // optional 解包（结构 optional ↔ values {kind:'optional'} 包装）
}
function vElement(vArr: { kind: 'array'; element: ValueSchema }): ValueSchema { return vArr.element; }
```

**keyPattern 判定（D3 引擎，§4.7 详述）**：

```ts
/** R6：pc（patternCache）为 readLogicalValueAtPath 函数体内创建的 per-call 局部 Map，经参数传入——
 *  禁模块级可变态（对齐 validate compileOrCache 的 per-ctx 纪律）。 */
function keyAllowed(regex: string, key: string, pc: Map<string, CompiledPattern>): boolean {
  let compiled = pc.get(regex);
  if (compiled === undefined) { compiled = compilePattern(regex); pc.set(regex, compiled); }
  return matchPattern(compiled, key);                      // R5：双参薄包装（charge no-op 已封进包装，§4.7）
}                                                          // 编译错/预算耗尽 → throw → 顶层 catch → C3（DOCRT-E100 前缀；fail-closed，非「不匹配」——R4 统一裁定）
```

**memo 健全性论证（D13，R2）**：memo 语义成立依赖两条不变量——

1. **(节点， 深度) 完全决定 Phase A 结果**：同一 resolve 后结构节点对象只在两种途径被重复到达——① 经同一 ref 名（别名表按名共享对象：`aliases['X']` 是唯一对象，结构 ref X 与 values ref X 解析到**同一对**别名条目 → 同一结构节点对象恒对应同一 values 游标，与到达路径无关）；② 非物化共享（evaluate 对每个语法位置物化新对象，位置唯一不可重复到达）。加上 `segs[i..]` 每调用固定，(节点， i) → 结果是纯函数；
2. **(节点， live, 深度) 完全决定 Phase B 结果**：导航只依赖这三者与 `segs[i..]`（fullPath 仅用于 walk 的 issue 渲染，而 issue 一律坍缩为 `{ok:false}`，不影响 memo 值语义）；live 原始值按**值**作键（同一原始值行为确定）、Yjs 对象按**引用**作键。

memo 只缓存不改变判定路径：union 成员声明序迭代不变（INV-7），命中即返回等价结果。**最坏情形折叠**（SA2 R2 反例）：经 ref 别名链构造 n 层重叠二员联合（每层两成员都许可前缀下钻、只在末段互异），无 memo 时一条末段被拒路径的 `members.some()` 回溯展开 2^n 次节点访问（Phase B 成员循环同形）；memo 化后每个 (节点， i) / (节点， live, i) 只计算一次，上界 = O(触及节点数 × 路径长 × 成员扇出)——多项式。该反例可达性本质：ADR-0001 下 schema 本身是 doc 数据（SCHEMA 信封随 doc 走），readLogicalValueAtPath 是接受任意 derived 的公共 API，对抗性但**合法**（通过 parse/evaluate 无障碍）的 schema + 30 段路径即为进程内 CPU 燃烧面——memo 是必要的防护而非优化。

### 4.4 Phase B：`resolveLive`（活数据解析，T7 吸收式缺键）

```ts
type NavOutcome = { ok: true; value: unknown } | { ok: false }; // ok:false = 本分支无法解析（union 回退信号）

/**
 * R2/D13：入口/出口为 memo 挂点（键 = resolve 后节点引用 + live 引用 + 深度 i；健全性见 §4.3 论证）。
 */
function resolveLive(node, live, segs, i, resolveS, fullPath, memo): NavOutcome {
  node = resolveS(node);
  const hit = memo.get(node)?.get(live)?.get(i);
  if (hit !== undefined) return hit;
  const out = navigate(node, live, segs, i, resolveS, fullPath, memo); // navigate = 下方 switch 体（下钻一律递归回 resolveLive）
  let byLive = memo.get(node);
  if (byLive === undefined) { byLive = new Map(); memo.set(node, byLive); }
  let byDepth = byLive.get(live);
  if (byDepth === undefined) { byDepth = new Map(); byLive.set(live, byDepth); }
  byDepth.set(i, out);
  return out;

  function navigate(node, live, segs, i, resolveS, fullPath, memo): NavOutcome {
    if (i === segs.length) {                                 // 路径耗尽：定点转换（D7 复用 walk）
      const r = walk(node, live, [...fullPath], resolveS);   // extract.ts 同一转换器（union 试验/plain 拷贝/安全写入）
      return r.kind === 'issue' ? { ok: false } : { ok: true, value: r.snapshot };
    }
    const seg = segs[i]!;
    switch (node.kind) {
      case 'root': return resolveLive(node.node, live, segs, i, resolveS, fullPath, memo);
      case 'map': {
        if (typeof seg !== 'string') return { ok: false };            // 段类型自校验（D9；见下「Phase B 自校验义务」）
        if (carrierOf(live) !== 'Y.Map') return { ok: false };        // 沿线载体错位 → C2 / union 回退信号
        const ymap = live as Y.Map<unknown>;
        const first = node.fields[0]!;
        if (isRecordForm(node)) {
          // D15/R1：pattern 许可性由 Phase A 按 any-of 键空间**并集**判定（§4.5 反例走查）；
          // Phase B **有意零 keyPattern 检查**——与 extract walk/walkUnion 的 keyPattern 零消费纪律同源
          //（extract D4/B5），成员选择错位由载体/结构自校验自纠。此处照抄「本成员键空间校验」会制造
          // 与 extractYjsSnapshot 的投影分歧，直接击穿 AC6-19 以 extract 为 ground truth 的交叉实证。
          const v = ymap.get(seg);
          if (v === undefined) return { ok: true, value: undefined }; // 合法缺键：吸收式短路（D8；AC3 用例 8）
          return resolveLive(first.node, v, segs, i + 1, resolveS, fullPath, memo);
        }
        const f = node.fields.find((x) => x.name === seg);
        if (f === undefined) return { ok: false };                    // 本成员无此字段（union 回退）/ 不可达（非 union 场景 Phase A 已拒）
        const v = ymap.get(seg);
        if (v === undefined) {
          return f.optional ? { ok: true, value: undefined }          // optional 缺席 → 吸收式 undefined（AC3 用例 7）
                            : { ok: false };                           // required 缺席 → C2（不变量外；AC3 白名单不含 required）
        }
        return resolveLive(f.node, v, segs, i + 1, resolveS, fullPath, memo);
      }
      case 'array': {
        if (typeof seg !== 'number' || !Number.isInteger(seg) || seg < 0) return { ok: false }; // 段类型自校验（D9）
        if (carrierOf(live) !== 'Y.Array') return { ok: false };
        const ya = live as Y.Array<unknown>;
        if (seg >= ya.length) return { ok: true, value: undefined };  // 非负整数越界 = 合法缺失（注记 A；AC3 用例 9）
        return resolveLive(node.element, ya.get(seg), segs, i + 1, resolveS, fullPath, memo);
      }
      case 'union': {                                                 // any-of 活导航（D4，§4.5）
        for (const m of node.members) {                               // 声明序（INV-7）
          const r = resolveLive(m, live, segs, i, resolveS, fullPath, memo);
          if (r.ok) return r;                                         // 首个可产出者胜
        }
        return { ok: false };
      }
      case 'leaf': case 'plain': case 'xml-fragment':
        return { ok: false };                                         // 不可达（Phase A 已拒终态下钻）——防御（C3）
    }
  }
}
```

**Phase B 段类型自校验义务**（自检回流修正）：Phase B **不得**信任 Phase A 对段类型的判定。理由：union 活导航（§4.5）中，Phase B 实际选中的成员可能与 Phase A 验证同一 segs 时所用的成员**不同**——异构联合 `YMap<{x}> | YArray<leaf>` 下，string 段 `'x'` 在 Phase A 经 map 成员放行，但 live 值是 Y.Array 时 Phase B 只能进入 array 成员；若 Phase B 省略自校验，`ya.get('x')` 类脏调用会坠入崩溃边界（C3），而其正确归宿是干净的成员拒绝（`{ok:false}` → 下一成员 → 全拒 → C1 `PATH_NOT_ALLOWED`）。两阶段是**语义**分工（许可 vs 解析），不是「检查一遍就够」的执行分工——段类型检查在两阶段各出现一次是 D1 的既定成本（§4.1/A5）。

**分段规则全景表**（Phase A × Phase B 职责分界；AC 对照）：

| 节点 kind × 段形态 | Phase A（schema 许可） | Phase B（live 解析） | AC |
|---|---|---|---|
| map 封闭 × 未知字段 | ❌ 拒 | — | AC2-4 |
| map 封闭 × 已知字段 | ✅ | 在场→下钻；optional 缺席→undefined；required 缺席→❌ | AC3-7/10 |
| map Record × string 过 pattern | ✅（union 位 = any-of 键空间**并集**放行即放行，D15/R1） | 缺席→undefined（吸收式）；在场→下钻——**零 keyPattern 复检**（D15/R1，与 extract 同源） | AC3-8 |
| map Record × string 违 pattern | ❌ 拒（union 位 = 全体成员键空间均拒才拒） | — | AC2-5 |
| map（含 Record）× number 段 | ❌ 拒 | — | D9 |
| array × 非负整数 | ✅（不看界） | 越界→undefined；界内→下钻 | AC3-9 / AC4-14 |
| array × 负数/非整数/NaN/±∞ | ❌ 拒 | — | AC4-11/12 |
| array × string 段 | ❌ 拒 | — | AC4-13 |
| union × 任意段 | 任一成员许可即 ✅ | 逐成员活导航（§4.5） | AC2-6 |
| leaf/plain/xml × 任意剩余段 | ❌ 拒（终态不可下钻） | — | AC5-15/16/17 |
| plain 整体读取 | ✅ | 转换 = copyPlainValue 深拷贝 | AC5-16 |
| 空路径 | ✅ | probeRoot → walk 全 ROOT | AC1-1/3 |

**吸收式缺键的语义论证**（D8）：`{ok:true, value:undefined}` 表示「路径合法，但其解析值缺席」。路径**中点**的合法缺键与**终点**的合法缺键（AC3 明文）是同一语义的两次实例——值不存在时余下段无从也无需检验（Phase A 已保证余下段 schema 合法）。反面设计（中点缺键改报 `PATH_NOT_ALLOWED`）会把「合法缺键」拆成两种行为，无 ADR 依据且 AC3 措辞（「合法 optional/Record 缺键……返回 ok:true, value:undefined」）不区分路径位置。

### 4.5 union 导航语义（D4，T3 裁决）

**纯 schema 导航为什么不够**：union 成员可以是异构载体（`YMap<{…}> | YArray<…>` 合法联合）。schema 侧「成员 0 允许 `foo` 下钻」之后，live 值若实为 Y.Array，`Y.Map.get` 调用直接 TypeError。**载体 API 按成员分叉 ⇒ 读取必须活导航**。

**Phase A（存在性）与 Phase B（可解析性）的分工**：

- Phase A 的 `members.some(...)` 是 ADR-0003「路径存在性为任一成员出现即存在」的**逐字实现**——纯 schema 命题；
- Phase B 的逐成员 `resolveLive` 回答「哪个成员能在 live 值上**实际产出**」：成员在段类型不符 / 载体不符 / 内部缺 required 时自我拒绝（`{ok:false}`），导航自动落到下一成员（声明序），全拒则整条路径 `PATH_NOT_ALLOWED`。这正是 extract 试验语义（trialMember 三结局 + walkUnion 首个接受者胜）在「路径导航」维度的同构移植：**首个可产出者胜**。

**可产出性回溯是正确性必需，不是优化**：重叠成员（ADR-0003「重叠成员不构成错误」）下，`union A = {a?: YLeaf} | B = {b?: YMap<{q}>}` 且 live 实体匹配 A 时，读 `['e','b','q']` 必须回溯到成员 B 才能得到 schema 许可（Phase A 经 B 放行）+ live 解析（B 的 b 缺席 → 吸收式 undefined）的一致结果。逐成员全路径回溯保证 Phase A 的每一份许可在 Phase B 都有机会被兑现。

**判别式零读取**（INV-4，对齐 extract D5/INV-4）：`discriminator` 字段在 Phase A/B 均不消费。理由同 extract §4.5.3：判别式是「非契约缓存」（ADR-0003 §3 缺失/存在不改变可观测行为），any-of 活导航已完备；引入判别式跳转会使成员选择依赖缓存的**存在性**，制造第二套选择语义。

**路径终点是 union 时**：Phase B 的 `i === segs.length` 分支直接交给 `walk` → `walkUnion` 完整试验语义（含全软拒回退成员 0——extract §4.5.2 唯一权威），与 `extractYjsSnapshot` 对同一子树的投影**逐字节一致**（AC3 用例 10 读 `['assets','img1']`）。

**union 成员键空间交叉（D15/R1 落实——Phase B 零 keyPattern 消费的合法性论证）**：

Phase A 对 union 位 Record 键的 pattern 许可是 **any-of 并集语义**：`members.some()` 中键只需被**任一**成员的键空间放行（ADR-0003「路径存在性为任一成员出现即存在」的逐字落实）；而 Phase B 实际下钻的成员由**声明序 + 载体可产出性**决定，可能与放行该键的成员不同。可达反例走查（SA2 R1 攻击点 #1）：

```ts
type StrictId = string & Pattern<"^[a-z]+$">;
type Mixed = Record<StrictId, YXmlFragment<{ p: YArray<YLeaf<string>> }>> | Record<string, YLeaf<string>>;
type ROOT = YMap<{ items: Mixed }>;          // live：items = { BAD: <Y.XmlFragment> }（'BAD' 违 ^[a-z]+$）
```

读 `['items','BAD']`：

- **Phase A**：成员 0 键空间（StrictId）拒 `'BAD'`；成员 1（无约束键）放行 → `members.some` = true → 整体许可（并集语义）；
- **Phase B**：成员 0（声明序先行）：seg `'BAD'` 为 string ✓、carrier Y.Map ✓、Record 形 `get('BAD')` **在场**（XmlFragment）→ 下钻 `<key>` 节点 = xml-fragment 终点 → walk `toString()` 产出 XML 串 → **首个可产出者胜，成员 0 胜出**（成员 1 的 leaf 位遇 XmlFragment 会载体错位拒绝）；
- **extract ground truth 对照**：`extractYjsSnapshot` 对同位 `walkUnion` 试验中，Record 形成员「键集即在场集，无『缺失』概念——试验 = 提取（walk）」（extract.ts §4.5.1/R2-#1），且 walk/walkUnion 对 keyPattern **零消费**（extract D4/B5 明文；本设计源码复核 extract.ts L100-110：Record walk 直接按 `ymap.keys()` 下钻，无 pattern 分支）→ 成员 0 试验直接接受 → 快照 `items.BAD` = XML 串——**与 read 的 Phase B 结果逐字一致**。

若按「Phase B 校验本成员键空间」实现（本设计 R1 修订前的错误注释方向）：成员 0 拒 `'BAD'` → 成员 1：`get('BAD')` 在场 → leaf 位遇 XmlFragment → 载体错位 → 全拒 `PATH_NOT_ALLOWED`——与 extract 投影**分歧**，直接击穿 AC6-19 以 extractYjsSnapshot 为 ground truth 的交叉实证立论。故裁定：**Phase B 对 Record 键有意零 keyPattern 检查**，成员选择的「键空间错位」由载体/结构自校验自纠——这不是缺口，恰是 extract 试验语义在路径导航维度的同构移植（extract 提取时同样不因 pattern 拒键；pattern 违规键的**值域**裁决属 validateLogicalSnapshot 的逻辑校验面，不属结构读取面）。非 union 位的单 Record（AC2 用例 5）不受影响：其键空间唯一，Phase A 的并集 = 自身，拒绝仍然成立。

### 4.6 终点转换：复用 `extract.ts` 的 `walk`（D7，T6 裁决）

**修改**：`packages/doc-runtime/src/extract.ts` 为 `walk` 与 `makeRefResolver` 增加 `export` 关键字 + JSDoc 注记（「包内复用接缝：read.ts 消费；不经 index.ts 公共入口」）。**不改任何逻辑行**。改动 ≤ 8 行。

**复用 vs 复制**：目标子树的转换语义 = extract 的 §4.3 全景表（map 封闭按声明序 + 缺失跳过 D4 / Record 按 keys() 插入序 / array 逐元素 / xml `toString()` / leaf+plain `copyPlainValue` JSON 值域断言 / union 试验 / ref 解析 / `putSnapshotKey` 安全写入）。复制这 120 行闭环到 read.ts 必然产生第二转换实现，`extractYjsSnapshot` 与 `readLogicalValueAtPath([])` 对同一 doc 给出不同投影只是时间问题——AC6 用例 19 恰以 extractYjsSnapshot 为 ground truth 交叉实证，两条读取路径语义漂移会直接击穿该测试的立论前提。包内导出（不走公共入口）不扩大公共 API 面。

**FC-4 由复用直接继承**：walk 的产物即普通值深拷贝（无 Yjs 类型、JSON 值域、`__proto__` 安全写入）——issue 只在不变量外输入出现，映射 `{ok:false}` → C2。

### 4.7 vfsl pattern 引擎公共导出（D3，T5 裁决）

**修改**：`packages/vfsl/src/index.ts` 追加（纯增量，不动任何既有导出与 pattern.ts；R5 修订后的形态）：

```ts
import { compile, match } from './pattern.js';   // pattern.ts 仍零修改
import type { CompiledPattern } from './pattern.js';

/** 受限正则引擎公共接缝（ADR-0003 Pattern 标记的唯一运行时判定引擎；跨包键匹配标准能力）。
 *  doc-runtime readLogicalValueAtPath 的 Record 键许可判定与 validateLogicalSnapshot 同源消费。 */
export { compile as compilePattern } from './pattern.js';
export type { CompiledPattern } from './pattern.js';

/** R5：双参公共包装——charge 记账参数是 validate 内部工作预算的实现细节，不进公共契约；
 *  引擎内部 matchBudget（8192 起、二次项、4M 绝对封顶）不依赖 charge，预算封顶不受影响。 */
export function matchPattern(compiled: CompiledPattern, input: string): boolean {
  return match(compiled, input, () => {});
}
```

**为什么不用原生 `new RegExp(kp).test(key)`**：

1. **单一语义真相源**（ADR-0001 精神）：open 期 `validateLogicalSnapshot` 用 vfsl 引擎判定键合法性（validate.ts L271-280）；read 侧若用原生 RegExp，同一 Pattern 在两个接缝可以给出不同答案——validate 放行的在场键被 read 判 `PATH_NOT_ALLOWED`（读取拒绝已打开文档的数据）或反之。引擎导出后 Mode 1/2 分歧归零（INV-9）；
2. **抗 ReDoS**：vfsl 引擎是 BFS 模拟、无回溯栈、`matchBudget` 二次项 + 4M 绝对护栏、超限 fail-closed（「不冒充不匹配」）；原生 RegExp 在病态量词嵌套模式上指数回溯。pattern 文本来自 schema（作者信任）但键来自 doc 数据（长度不受限），read 是热路径，不应重新引入无界回溯面；
3. **分层合法**：ADR-0007 明文 `@nomicore/doc-runtime` 依赖 `@nomicore/vfsl`；CONTEXT.md「路径索引：键匹配（exact / pattern）为**标准能力**」——引擎即该能力的运行时载体，公共导出使其可跨包消费。先例：vfsl index.ts 已有 `@internal 包内测试接缝` 导出（`getCompiledWith`）。

**read 侧消费纪律**：per-call `Map` 缓存编译产物（R6：在 readLogicalValueAtPath 函数体内创建、经参数传入——对齐 validate compileOrCache「同模式一次调用内编译一次」的 per-ctx 纪律，禁模块级可变态）；匹配一律走 `matchPattern(compiled, key)` 双参形态（R5）；编译失败（PatternCompileError 等——schema 携带不可编译 pattern 且该 Record 零键时 validate 也从未编译过，属性**上游缺陷信号**）与预算耗尽一律 throw → 顶层 catch → **C3** `PATH_NOT_ALLOWED` + `DOCRT-E100:` 前缀 message（R4 统一裁定，与 §4.1/§4.8 伪代码一致；fail-closed，对齐引擎哲学「不冒充不匹配」）。

### 4.8 崩溃边界与 ROOT 探针（D11/D12）

- 全函数体顶层 try/catch（§4.1 伪代码），收编：手造派生物守卫 throw、双游标 lockstep 断裂 throw、pattern 引擎 throw、probeRoot 第五类 ROOT throw、任何意外异常（含超深路径的 RangeError）→ `PATH_NOT_ALLOWED` + `DOCRT-E100` message。**绝不外抛**（FC-1；对齐 extract INV-6）；
- `probeRoot` 四级级联（carrier.ts），**R3/D14 后置于 Phase A 之后执行**——schema 拒绝的路径不再触碰 doc（含不再触发惰性创建；被拒路径零 doc 触碰 = INV-10，§5 AC2-6「零 doc 访问」声明由此转真）：Y.Map 命中（含惰性创建，**零 update 事件，P4 实证**）→ 继续；异型（Y.Array/Y.XmlFragment/Y.Text ROOT）→ C2 整树不可读（open 期必已被拒）→ `PATH_NOT_ALLOWED`（重排后仅「路径非法**且** ROOT 异型」双坏输入的 message 措辞变化，同 code 无契约影响）；全失败 throw → C3。空 doc + 空 path：惰性空 map → walk → `{}`（AC1 用例 3）；
- 读取零写入（INV-5）：全程只调用 `get`/`length`/`keys`/`toString` 只读 API；probeRoot 惰性创建是唯一「构造」，实测零 update 事件（carrier.ts P4）。

### 4.9 复杂度与成本模型（AC6；R2 修订——memo 化上界）

| 阶段 | 成本（**memo 化后上界**，D13） | 触碰面 |
|---|---|---|
| Phase A | O(相异 (节点, i) 对数 × 成员扇出) ≤ **O(触及节点数 × 路径长 × 成员扇出)** 次 schema 节点访问 + O(Record 段) 次 pattern 编译/匹配（per-call 缓存） | 零 doc 访问；**被拒路径零触碰**（R3/INV-10） |
| Phase B | O(相异 (节点, live, i) 三元组数 × 成员扇出) ≤ O(触及节点数 × 路径长 × 成员扇出) 次 `get`/`length`（Yjs 内置索引结构） | 仅路径沿线 |
| 转换 | O(目标子树规模)（walk 同构于 extract 对该子树的提取成本） | 仅目标子树 |

**为什么必须 memo 化（R2 攻击点 #2 回流）**：无 memo 的「O(路径长 × union 成员扇出)」只是**最好情形**表述。最坏可达构造：经 ref 别名链构造 n 层重叠二员联合（每层两成员都许可前缀 `x` 下钻、只在末段互异），一条长 n+1 的末段被拒路径使 `members.some()` 回溯展开 **2^n** 次 schema 节点访问（Phase B 成员循环同形）。该构造的可达性本质：ADR-0001 下 **schema 本身是 doc 数据**（SCHEMA 信封随 doc 走），readLogicalValueAtPath 是接受任意 derived 的公共 API——对抗性但**合法**（通过 parse/evaluate 无障碍）的 schema + 30 段路径 = 进程内 CPU 燃烧面，直接违背 AC6「读取成本与目标子树规模相关」承诺。D13 的每调用局部 memo（Phase A 键 (节点, i)、Phase B 键 (节点, live, i)，健全性论证 §4.3）把指数回溯折叠为上表多项式——这是**必要的防护**而非可选优化，SA3 实现为强制项。

兄弟子树零触碰 ⇒ AC6 用例 20 的两个损坏场景（坏 assets 读 title / 坏 title 读 assets.img1.url）天然通过：损坏子树根本不在访问面上。「读取成本与目标子树规模相关」在 memo 化上界下成立（路径长 × 节点数是读取请求自身的规模，不计入「额外」成本）。

### 4.10 确定性（迭代序冻结，对齐 extract §4.9/INV-8）

- map 封闭按**字段声明序**、Record 按 **`Y.Map.keys()` 插入序**（extract D4/§4.9 同款）；
- union 成员按**声明序**迭代，首个可产出者/接受者胜（Phase B 导航与 walkUnion 试验同规则）；
- 返回的 `path` 副本与调用方数组无别名关系；
- 判别式、index、docs 表零消费——不引入任何基于缓存的次序差异；
- **memo（D13）不改变判定路径**：只缓存 (节点[, live], i) → 结果的纯函数映射，命中即返回等价结果，成员声明序迭代与首个可产出者裁决不变（INV-7 兼容）；memo 与 patternCache 均为 per-call 局部态，**模块级零可变态**（R6/INV-11）。

---

## §5. SA6 20 用例 + 类型层逐条映射（行为对账）

| 用例 | 路径 / 断言 | 设计路径（Phase A → Phase B） | 判定 |
|---|---|---|---|
| AC1-1 | `[]` → 完整 ROOT 副本 | A：空路径恒许可；B：probe Y.Map → walk(root) → 全景表转换；XML toString、plain 深拷贝、Record 插入序 | ✅ |
| AC1-2 | `['assets','img1','url']`（变量 + `as const` 元组） | A：assets Record 键过 pattern → union.some → image 成员 url ✅；B：img1 在场 → 成员 image：url 在场 → leaf 转换 | ✅ |
| AC1-3 | 空 doc `[]` → `{}` | A ✅；B：probe 惰性空 map → walk → 无字段在场 → `{}` | ✅ |
| AC2-4 | `['nope']` | A：ROOT 封闭 map 未知字段 ❌ → `PATH_NOT_ALLOWED(['nope'])` | ✅ |
| AC2-5 | `['assets','bad key!']` | A：Record 键 vs keyPattern `^[A-Za-z0-9_\\-]{1,64}$`（vfsl 引擎）❌ → 拒，path 回显两段 | ✅ |
| AC2-6 | `['assets','img1','nope']` | A：union.some——image 无 `nope`、text 无 `nope` → 全拒 ❌ → 拒，**零 doc 触碰**（R3 重排后此声明字面为真：probeRoot 未执行，INV-10），path 回显三段 | ✅ |
| AC3-7 | `['notes']`（notes 已 delete） | A ✅（optional 字段）；B：get→undefined + optional → `{ok:true, value:undefined}`（value 键显式构造） | ✅ |
| AC3-8 | `['assets','missing-key']` | A：键过 pattern ✅；B：get→undefined → Record 合法缺键 → undefined | ✅ |
| AC3-9 | `['keywords', 5]` | A：非负整数 ✅（不看界）；B：length 2，5 越界 → undefined | ✅ |
| AC3-10 | 正向对照 `['notes']`/`['keywords',1]`/`['assets','img1']` | B：在场下钻 / 界内取元素 / union 终点 → walkUnion 试验 image 接受 | ✅ |
| AC4-11 | `['keywords', -1]` | A：`-1 >= 0` ❌ → 拒 | ✅ |
| AC4-12 | `['keywords', 1.5]` | A：`Number.isInteger` ❌ → 拒 | ✅ |
| AC4-13 | `['keywords','0']` | A：array × string 段 ❌ → 拒 | ✅ |
| AC4-14 | `['keywords', 0]` 正向 | A ✅；B：界内 → `'k1'` | ✅ |
| AC5-15 | `['title','x']` | A：title=leaf，剩余段 → 终态 ❌ → 拒（**presence-independent**：title 在场与否同判） | ✅ |
| AC5-16 | `['attachments',0]` ❌；`['attachments']` → 全量副本 | A：plain 终态 × 剩余段 ❌ → 拒 / 整体 ✅；B：copyPlainValue 深拷贝 `['x','y']` | ✅ |
| AC5-17 | `['xmlBody','child']` ❌；`['xmlBody']` → XML 串 | A：xml 终态下钻 ❌ / 整体 ✅；B：`toString()` 语义等价投影 | ✅ |
| AC6-18 | `['assets']` → 仅 assets，keys=['img1','doc1'] | B：walk Record 按 keys() 插入序 → 仅两键；不含 ROOT 其他键 | ✅ |
| AC6-19 | 返回值突变不影响 live doc + extractYjsSnapshot 实证 | walk 全新鲜构造（INV-1）；读路径零写入；重读原值；extract ground truth 不变 | ✅ |
| AC6-20 | 坏兄弟子树不影响目标读取（双向） | A 零 doc 访问；B 仅触碰 title / assets 链——损坏的 assets/title 不在访问面 | ✅ |
| test-d-1 | readonly 变量 / `[]` / 可变字面量 / `as const` 元组可传 | 签名 `readonly (string\|number)[]` 全部兼容 | ✅ |
| test-d-2 | 点号串 / 裸 number / 裸 string → 编译错误 | 同签名在类型层拒绝，三条 `@ts-expect-error` 被消费 | ✅ |
| test-d-3 | `code` 字面量 / `value: unknown` | 联合变体字面量声明（§3.1） | ✅ |

### 5.1 R1 修订新增锚点（SA2 R1 红灯测试构想收纳——非 SA6 冻结面，供 SA4/SA7 验证时落地）

SA6 20 用例冻结不动；下表为 SA2 R1 评审「红线测试思路」节的构想，经本设计收纳后作为 R1–R4 修订的**补充验证锚点**（落地文件见 §11 ALLOW LIST 追加项，SA3 不编写）：

| 锚点 | 锁定行为 | 构造 | 对应修订 |
|---|---|---|---|
| SUP-1 union 键空间交叉一致性锁 | `read(['items','BAD'])` = XML 串 且与 `extractYjsSnapshot(...).snapshot.items.BAD` **逐字相等**（ground truth 双向锁）；对照 `['items','ok-key']`（两成员都许可）与 `['items','BAD','x']`（成员 1 leaf 下钻拒） | `Mixed = Record<StrictId, YXmlFragment<…>> \| Record<string, YLeaf<string>>`，live `items = { BAD: <xml> }`（§4.5 反例同款 fixture） | R1/D15——防 SA3 给 Phase B 加回 per-member pattern 检查 |
| SUP-2 重叠联合成本护栏 | 22 层重叠二员联合 + 末段全拒路径：memo 实现毫秒级完成；无 memo 实现确定性超时（2^22） | 经 ref 别名链构造 `{x: <下一层>, t1: YLeaf} \| {x: <下一层>, t2: YLeaf}` ×22，路径 `['x'×22, 'absent']` | R2/D13 |
| SUP-3 被拒路径零 doc 触碰 | `read(derived, doc, ['nope'])` → `PATH_NOT_ALLOWED` 后 `doc.getMap('ROOT').size === 0`；`['nope']` 与 `[]` 两次调用幂等 | 全新 `Y.Doc` | R3/D14/INV-10 |
| SUP-4 pattern 失败 message 前缀稳定 | fixture 携带不可编译 keyPattern（`Pattern<"("`）且 Record 零键，`read(…, ['recs','any'])` → `result.message` 以 `DOCRT-E100:` 开头 | 不可编译 pattern + 空 Record | R4——防 C2/C3 分类漂移 |
| SUP-5 `matchPattern` 双参签名 | `matchPattern(compiled, 'k')` 可调、3 参形态非公共契约 | tsc 签名断言 | R5 |
| SUP-6 模块级零可变态 | patternCache/memoA/memoB 均 per-call 创建（SA4 代码审查项，无运行时断言） | — | R6/INV-11 |

---

## §6. 不变量（INV）

| # | 不变量 | 验证锚 |
|---|---|---|
| INV-1 | 成功 value 恒为普通值深拷贝：无 Yjs 类型、JSON 值域、与 live doc 无别名 | 用例 1/16/18/19（expectNoYjsLeak + JSON 往返 + 突变隔离） |
| INV-2 | 失败恒为单错 `PATH_NOT_ALLOWED` + 整条尝试路径新鲜副本回显，fail-fast，不并入 issues | 用例 4-6/11-17 |
| INV-3 | 同步、不抛错：顶层 try/catch 收编一切异常（含手造派生物/引擎错/预算耗尽） | §4.8；extract INV-6 同源 |
| INV-4 | 判别式零读取 | §4.5；extract INV-4 同源 |
| INV-5 | 读取零写入：不产生 update/transaction（probeRoot 惰性创建零事件） | 用例 19 extract ground truth |
| INV-6 | schema 许可判定 presence-independent（Phase A 零 doc 访问） | 用例 15 + §4.1 论证 |
| INV-7 | union 导航/试验声明序确定性，首个可产出者/接受者胜 | 用例 2/10；extract INV-8 同源 |
| INV-8 | 只触碰路径沿线 + 目标子树 | 用例 18/20 |
| INV-9 | Record 键许可判定与 validateLogicalSnapshot 同引擎同语义 | §4.7；探针实证 |
| INV-10（R3） | schema 拒绝的路径零 doc 触碰（含零惰性创建）——Phase A 先行、probeRoot 后置 | §4.1/§4.8；SUP-3 |
| INV-11（R6） | 模块级零可变态：patternCache / memoA / memoB 均为 readLogicalValueAtPath 每调用局部创建 | §4.3；SUP-6（SA4 审查项） |

---

## §7. 攻击面预判（SA2 复审重点）

| # | 预期攻击 | 预置回应 |
|---|---|---|
| A1 | 「`PATH_NOT_ALLOWED` 兼职承运不变量外失败（C2/C3），错误码语义被稀释」 | §3.2 可选方案穷举：抛错违反 FC-1；`ok:true,undefined` 是立法禁止的虚假降级且污染 AC3 语义；第三变体超出冻结联合。C2 在契约语境不可达（open 全量验证），正常调用面只见 C1；message 区分三类 |
| A2 | 「为什么不用 `derived.index` 导航？它是 CONTEXT.md 的路径索引标准能力」 | §4.2 两处结构性缺口 + 探针实证（union 成员无行、ref 别名子树无行）；extract 同结论先例；index 是投影缓存不是完备导航机制 |
| A3 | 「values 双游标引入 lockstep 复杂度，何不把 keyPattern 塞进结构树/索引」 | 塞结构树 = 改 DerivedSchema 冻结形状（ADR-0003 纯数据纪律，跨包破坏面）；塞索引 = 缺口仍在。双游标是**只读消费**既有完备数据的最低成本方案；lockstep 规则表有实证支撑，断裂走 C3 |
| A4 | 「union 活导航与 ADR-0003 any-of 存在性矛盾？」 | 不矛盾：Phase A `members.some` 是存在性语义的逐字实现（纯 schema 命题）；Phase B 解答「哪个成员能实际产出」——载体 API 按成员分叉使纯 schema 导航**不可执行**（Y.Map.get vs Y.Array.get）。§4.5 异构联合反例 |
| A5 | 「两阶段是过度设计，单趟交织即可」 | §4.1：交织式在合法缺键处短路会使路径合法性依赖 presence（`['notes','x']` 两态不一致）。两阶段各为纯函数、可独立单测，重复的段类型检查约 20 行是语义完备的代价 |
| A6 | 「修改 extract.ts / vfsl index.ts 是 scope creep」 | 两者都在 ALLOW LIST 且行数封顶（extract ≤8 行纯 export；vfsl ≤14 行 = compile 别名/类型导出 + matchPattern 双参薄包装（R5）——pattern.ts 本体零修改）；替代方案（复制 walk / 原生 RegExp）分别制造第二转换实现与第二 pattern 语义源，架构代价更高 |
| A7 | 「吸收式缺键（D8）超出 AC3 字面」 | AC3 措辞不区分路径位置；中点/终点缺键同语义（§4.4 论证）；反面设计把合法缺键拆成两种行为且无 ADR 依据 |
| A8 | 「`message?` 是契约收窄/漂移」 | 纯增补：不改冻结字段、不被任何冻结断言检查、任务简文明文允许「仅可补充」；没有它 C2/C3 与 C1 不可区分（§3.1 论证） |

---

## §8. 对业务的影响评估

- 纯增量能力：不改变 extractYjsSnapshot 行为、不改变 vfsl 求值/校验行为、不触 persistence/yjs-server；
- `extract.ts`/`vfsl/index.ts` 的修改是纯导出增补 + 一个 4 行纯包装函数（R5），对既有消费者零影响（含 5 个 extract 测试文件 48 用例回归基线）；
- 为 ADR-0007 后续 `applyValidatedMutation`（能力四）预铺：其「mutation 前 ROOT 检查」与读取共享 walk/解析器心智模型；
- 性能：路径读取 O(路径 + 目标子树)，为 NamespaceRuntime 高频读取路径（对全树提取的 1/n 成本）提供基础。

---

## §9. 协议假设依据 (Protocol Assumption Evidence)

| 假设 | 依据类型 | 依据内容（具体引用） | 风险 |
|---|---|---|---|
| `Y.Map.get(键缺席)` 返回 `undefined`；`v === undefined` 视同缺席可作缺键判据 | 源码引用 + 现有测试 | extract.ts L105/L115（D4 缺失检测先行的全部现存用法）+ extract 测试 48 用例绿 | 低 |
| `doc.getMap('ROOT')` 对缺席 ROOT 惰性创建且**零 update 事件** | 源码引用 | carrier.ts L46-47（「缺席分支的创建实测零 update 事件（P4）」——#73 设计期实测） | 低 |
| `Y.Array.length` 为当前元素数，界内 `get(i)` 可取元素 | 源码引用 | extract.ts L127-128（array walk 既有用法） | 低 |
| `Y.Map.keys()` 按插入序迭代且确定（覆写不换位）——AC6 用例 18 的 `Object.keys(assets副本)` 序敏感断言依赖 | 类比已有 job 验证 + 源码引用 | #73 设计 §4.9 迭代序冻结 / P7 实测（「插入序稳定、覆写不换位——同 doc 状态下确定」，task_doc-runtime-extract-yjs-snapshot_design.md L555）+ extract 测试 48 用例绿 | 低 |
| 结构树不携带 Record keyPattern；索引在 union 成员与 ref 别名子树无行；values 树完整携带 | **设计期实测验证** | §1.2 探针：命令 + 三段关键输出（内联/ref 别名/ROOT 场景） | 已消除 |
| evaluate 对 union 成员与别名物化的产行规则（缺口根源） | 源码引用 | evaluate.ts L51-54（别名 path=null）、L120/L155（§7.2 union 停）、L89-94（ref 结构形按名）、L292-296（values Record 物化 keyPattern） | 低 |
| vfsl 引擎 `match` 为非锚定搜索语义、超预算 fail-closed 抛错 | 源码引用 | pattern.ts `match` JSDoc（「非锚定搜索……步数预算耗尽 → PatternBudgetExceeded（fail-closed；不冒充『不匹配』）」）+ validate.ts L271-280 消费同款 | 低 |
| `new RegExp` 与 vfsl 引擎可能在子集边缘语义分歧（弃用原生 RegExp 的动因） | 源码引用 | pattern.ts 子集构造清单（PatternUnsupportedError 族）——两引擎并存即两语义源 | 已消除（同引擎） |
| 无 HTTP/WS/进程/端口/跨 job 生命周期假设 | — | 本设计纯进程内同步函数，无协议级假设 | — |

## §10. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数/接缝

| 接缝 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `walk` | `packages/doc-runtime/src/extract.ts:87` | 模块私有 | **包内导出**（行为零变化；签名/返回不变） |
| `makeRefResolver` | `packages/doc-runtime/src/extract.ts:229` | 模块私有 | **包内导出**（行为零变化） |
| `compilePattern`/`CompiledPattern` | `packages/vfsl/src/index.ts`（别名导出，源自 `pattern.ts` L883） | 包内私有 | **公共导出**（别名导出；pattern.ts 行为零变化） |
| `matchPattern` | `packages/vfsl/src/index.ts`（R5 新增双参薄包装，包装 `pattern.ts` L895 `match`） | 不存在 | **公共函数** `(compiled, input) => boolean`（charge no-op 封进包装；引擎内部预算封顶不受影响） |
| `readLogicalValueAtPath` | `packages/doc-runtime/src/read.ts`（新建） | 不存在 | 新公共能力（调用方为未来 NamespaceRuntime，本仓零存量 caller） |
| `extractYjsSnapshot` | `packages/doc-runtime/src/extract.ts:51` | — | **不改**（签名/行为/导出均不动） |

### Caller 清单

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| `walk`/`makeRefResolver` 新消费者 | `packages/doc-runtime/src/read.ts`（新建，Phase B 终点转换 + 解析器） | 同步调用 | 顶层 try/catch（read.ts 全函数体，D11） | ✅ 崩溃边界 C3 | 已设计（§4.1/§4.8） |
| `compilePattern`/`matchPattern` 新消费者 | `packages/doc-runtime/src/read.ts`（keyAllowed，§4.3） | 同步调用 | 同上顶层 try/catch | ✅ | 已设计（编译错/预算耗尽 → **C3**，R4 统一裁定） |
| `readLogicalValueAtPath` 存量 caller | **无**（`grep -rln "readLogicalValueAtPath" --include="*.ts" packages/ apps/`（含未跟踪文件）仅命中 SA6 两个测试文件；`git grep` 亦可对已跟踪树复核为零） | — | — | — | 无存量调用方；SA6 测试为唯一消费者 |
| `extractYjsSnapshot` 存量 caller | `packages/doc-runtime/src/index.ts:10`（转出口）、SA6 测试（AC6-19 ground truth）、extract 测试 5 文件 | 同步 | 测试内 | — | 本任务不触碰 |

**风险评估**：全部改动为「私有 → 包内/公共导出」的纯增量与一个新函数；不存在 return→throw、同步→异步、nullable→non-null 等五类契约改动；既有 caller（extract 测试、index 转出口）行为零变化。

## §11. 文件清单（File Scope）

### ALLOW LIST

- `packages/doc-runtime/src/read.ts` — 新建（~260 行，含 R2 memo 挂点）：`readLogicalValueAtPath` + Phase A `isPathAllowed`（含 values 双游标、values 解析器与 per-call patternCache/memoA）+ Phase B `resolveLive`（含 memoB）+ 崩溃边界
- `packages/doc-runtime/src/index.ts` — 修改（+3 行）：转出口 `readLogicalValueAtPath` + `ReadLogicalValueResult` 类型（§3.1）
- `packages/doc-runtime/src/extract.ts` — 修改（≤8 行，纯 export 增补 + JSDoc 注记，D7）：`walk` / `makeRefResolver` 包内导出，逻辑零变化
- `packages/vfsl/src/index.ts` — 修改（≤14 行，D3 + R5）：`compilePattern` 别名导出 + `CompiledPattern` 类型导出 + `matchPattern` 双参薄包装函数（pattern.ts 本体零修改）
- `packages/doc-runtime/test/read-logical-value-at-path.test.ts` — `[SA6 owned]` 验收红灯测试（20 用例）。SA3 不得改断言逻辑；仅允许测试基础设施级修复
- `packages/doc-runtime/test/read-logical-value-at-path.test-d.ts` — `[SA6 owned]` 类型层契约测试。同上纪律
- `packages/doc-runtime/test/read-logical-value-at-path-supplementary.test.ts` — 新建（R1 修订追加，SA4/SA7 按 §5.1 构想落地 SUP-1–SUP-4 锚点；SA3 不编写测试）

### DENY LIST

- `packages/vfsl/src/pattern.ts` — 引擎本体稳定，仅被导出消费，零修改
- `packages/vfsl/src/evaluate.ts` / `derived.ts` / `validate.ts` 及 `packages/vfsl` 其余源码 — 派生 schema 冻结形状与校验语义不动
- `packages/doc-runtime/src/carrier.ts` — 只读复用（carrierOf/probeRoot），零修改
- `packages/doc-runtime/test/extract-*.test.ts`（5 文件）— #73 回归基线，不动
- `packages/vfsl-protocol/**`、`packages/persistence/**`、`packages/dsh-persistence/**`、`packages/vfsl-codegen/**` — 与运行时读取无交集
- 根 `tsconfig.base.json` / `package.json` / `packages/*/tsconfig.json` / `packages/*/package.json` — 无配置需求（exports 已走 src/index.ts，tsconfig include 已覆盖 test/**）

---

## 附：设计自检（SKILL 一致性要求；R1 修订后复检）

- **冻结契约不收窄**：FC-1..FC-6 逐条对照（§1.3/§3.1/§5）；`message?` 为纯增补且已论证（§3.1/A8）；R1–R6 全部修订不触碰公共签名与冻结联合形态（SA2 复审指引明文确认范围）；
- **拒绝虚假降级**：C1/C2/C3 分类表（§3.2）显式穷举失败归宿；required 缺席/载体错位不静默、不冒充成功；pattern 引擎 throw 统一 C3（R4 消除三处分类漂移）；
- **架构一致性**：与 extract 共享 walk/解析器/probeRoot/迭代序纪律（单一转换语义源）；R1 进一步把「Phase B 零 keyPattern 消费」与 extract D4/B5 纪律锁死（§4.5 反例走查）；不推翻任何 ADR；
- **协议假设**：全部假设带源码引用或设计期实测（§9）；无 HTTP/WS/端口类假设；
- **契约审计**：改动全部为纯增量导出 + 新函数 + 一个 4 行包装（R5）；caller 清单完备（§10）；
- **修订一致性 grep**：`grep -n "memo\|D13\|D14\|D15\|C3\|matchPattern" wiki/raw/task_read-logical-value-at-path_design.md`——pattern throw 归属全文档统一为 C3（§3.2/§4.3/§4.7/§10 四处口径一致）；matchPattern 全部为双参形态；memo 健全性论证（§4.3）与成本表（§4.9）数值口径一致；「零 doc 访问/触碰」声明仅在 R3 重排后的语境出现（§4.8/§5 AC2-6/INV-10）。

---

## SA2 反馈逐条回应（R1 → R1 修订）

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| R1（#1 MEDIUM）：修正 §4.4「pattern 合法性 Phase A 已验（本成员键空间）」事实错误注释；补 §4.5 union 成员键空间交叉论证（含反例的 extract 一致性走查） | ✅ | §4.4 Record 分支注释重写；§4.5 新增「union 成员键空间交叉（D15/R1）」整节；D15 入决策总表；§4.4 分段规则表两行更新；摘要回流条目 4 | 注释改为「pattern 许可性由 Phase A 按 any-of 键空间**并集**判定；Phase B **有意零 keyPattern 检查**（与 extract walk/walkUnion keyPattern 零消费纪律同源，成员错位由载体/结构自校验自纠）」；§4.5 以 `Mixed = Record<StrictId, YXmlFragment> \| Record<string, YLeaf>` + live `{BAD: <xml>}` 反例做 Phase A/B + extract ground truth 三方走查，论证「成员局部 pattern 检查会击穿 AC6-19 立论前提」；SUP-1 补充测试锚点（§5.1）防 SA3 按旧注释实现 |
| R2（#2 MEDIUM）：增补每调用局部 memo（Phase A 键 (节点,i)、Phase B 键 (节点,live,i)）；§4.9 改写为 memo 化后上界 | ✅ | D13 入决策总表；§4.1 创建 memoA/memoB；§4.3/§4.4 伪代码入口/出口 memo 挂点 + 健全性论证（别名共享对象 ⇒ (节点,i) 纯函数；live 原始值按值/对象按引用）；§4.9 成本表全文重写（最坏 2^n 反例可达性说明 + 多项式上界）；§4.10 memo 确定性注记；SUP-2 锚点（22 层构造） | memo 为 SA3 **强制实现项**（非优化）；折叠后上界 O(触及节点数 × 路径长 × 成员扇出) |
| R3（#3 MEDIUM-LOW）：编排重排——Phase A 先行，probeRoot 后置；被拒路径零 doc 触碰 | ✅ | §4.1 伪代码重排（probeRoot 移至 Phase A 之后）；D14 入决策总表；§4.8 probeRoot 条目更新；§5 AC2-6 行「零 doc 触碰」转真；INV-10 新增；SUP-3 锚点 | 行为差异仅「路径非法且 ROOT 异型」双坏输入的 message 措辞（同 code）；`['nope']` 在全新 doc 上不再触发惰性创建 |
| R4（#4 MEDIUM-LOW）：pattern 引擎 throw 统一归 C3（DOCRT-E100 前缀）；§3.2 C2 行删 pattern 两项；明确 message 消费面 | ✅ | §3.2 C2 行删「pattern 预算耗尽/编译失败」、C3 行增列；§4.3 keyAllowed 注释、§4.7 消费纪律、§10 caller 表三处统一为 C3；§3.1 新增「消费面约定」（应用逻辑只依赖 code/path；message 供日志/诊断面——SA4/SA7/运维）；SUP-4 锚点（前缀稳定性） | 消除 SA2 指出的三处分类矛盾（§3.2/§4.3/§4.8） |
| R5（#5 LOW-MEDIUM）：matchPattern 改 index.ts 内双参薄包装再导出（charge 不进公共契约） | ✅ | §4.7 导出代码块重写（compile 别名 + 类型导出 + `matchPattern(compiled, input)` 包装函数）；D3/A6 行更新；§10 改动函数表拆两行；§8 措辞更新；ALLOW LIST vfsl 条目 ≤14 行；SUP-5 锚点（tsc 签名断言） | pattern.ts 仍零修改；引擎内部 matchBudget 封顶不受影响（SA2 已核实预算是 match 内部机制） |
| R6（#6 LOW）：patternCache 移入函数体（per-call） | ✅ | §4.1 在 readLogicalValueAtPath 函数体内创建 patternCache 并显式注释「R6：per-call 局部（禁模块级可变态）」；§4.3 keyAllowed 改为经参数接收 pc；§4.10/INV-11 模块级零可变态；SUP-6（SA4 审查项） | 消除 SA2 指出的「书写位置 = 模块顶层 vs 注释声明 per-call」矛盾 |
