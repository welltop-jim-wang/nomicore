# SA1 设计 — materializeRoot(derived, snapshot, doc)：验证后安全物化 logical ROOT 到 Yjs（Issue #74）

- Issue: [#74](https://github.com/welltop-jim-wang/nomicore/issues/74)（feature，功能开发）
- 分支：fix/issue-74-on-docs-doc-runtime-validation（Worktree: /home/wangjian/nomicore-fix-issue-74）
- 行为锚点：`packages/doc-runtime/test/materialize-root.test.ts`（SA6 Phase 1 冻结，13 用例 / AC-1~AC-6）
- ADR 基准：`wiki/raw/task_doc-runtime-materialize-root_relevant_decisions.md`（ADR 0007 直接上游；0001/0002/0003/0006 间接约束）+ SA8 冲突门禁 verdict=clear（6 条非冲突注意事项，§1.2 落位）
- 设计期实证：yjs@13.6.32 行为 23 项实测 + 算法原型对真实 fixture 的 14 组验证（§11 附录 A/B，全部命令与输出内联，SA4 可重跑）

---

## 摘要（一页看懂）

`materializeRoot` 是 extract 的**方向反转孪生**：extract 把 live Yjs 载体投影为普通 JSON
logical snapshot（doc→JSON，读侧），materialize 把已通过逻辑校验的普通 JSON snapshot 构造为
detached Yjs 子树并原子安装（JSON→doc，写侧）。核心编排四阶段（ADR-0007 逐句落文）：

```
① validateLogicalSnapshot（全收集，失败→完整 issues 零损透传）
② detached 构造（结构树导航快照；union 试验；JSON 域深拷贝；XML 结构解析）
③ ROOT 探针 + 空置判定（复用 carrier.ts probeRoot 四级级联）
④ 单次 doc.transact 安装 —— 零捕获：observer 抛错 loud 传播（AC-6）
```

**最核心的结构裁决（D1）**：前三阶段共享一个崩溃边界（意外异常 → `DOCRT-E200` 单 issue
结构化返回），第④阶段**排除在一切 try/catch 之外**——事务一旦开始，唯一合法的异常出口是
「原样抛出」（ADR-0007「事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假
声称自动回滚，也不尝试 fallback」；实测 A9/A18：observer 抛错时 update 已发出、值已落盘、
错误经 `Y.transact` 传播）。零写入承诺由「②③ 全部成功后才开启 ④，且 ④ 事务体只含不可抛
的已验证载荷 set 操作」结构性保证。

**最重要的可达性发现（实证，非防御性假设）**：VFSL 的 `unknown` 原语在 leaf 位**无条件接受
一切值**（`validate.ts:460` `t.type === 'unknown' ? true`；实测 Y.Map 实例 / bigint / function /
NaN / Date / 数组内 undefined 全部 `validate ok:true`），且 `typeof NaN === 'number'` 使 NaN
通过 number 标量位。因此**构造期 JSON 域断言是一等可达路径**：这些值通过了逻辑校验、必须在
构造期被响亮拒绝（单 issue、零写入），否则要么 yjs `set` 期抛错落进半事务，要么产出
extract 侧永远读不回的脏文档（往返域对称不变式 INV-9，§2.2）。

### 决策总表

| # | 决策 | 一句话理由 | 依据 |
|---|---|---|---|
| D1 | 四阶段编排；①②③ 共享 E200 崩溃边界，④ 事务阶段零捕获 | AC-6 的结构性根源：吞掉事务内异常 = 伪 ok / 伪回滚 | ADR-0007 失败边界；实测 A9/A18 |
| D2 | logical 失败 issues **引用零损透传**（不重包装） | AC-1 `toEqual(direct.issues)` 逐条含顺序一致 | 信封/校验族零损透传先例（vfsl index.ts） |
| D3 | 复用 `carrier.ts` 的 `probeRoot` 四级探针，零修改 | 异型 ROOT 侦测 + 惰性创建语义已被 extract 侧实证冻结 | carrier.ts:52；实测 A10/B15 |
| D4 | 构造侧形状判定 + **原型守卫**（plain object / Array / string） | Date/类实例经 `unknown`/all-optional 位可达；静默投影 `{}` = 伪降级 | extract R2/#3 同判例；实测 unknown 接受 Date |
| D5 | union 构造试验 = **递归构造尝试**，首个成功成员胜；**无软拒概念**；判别式死数据 | 必填性是值域概念归 validation；构造只管形状与载体；对齐 extract D5 | ADR-0003 any-of；extract §4.5 |
| D6 | leaf/plain 统一 `copyJsonDomain`（extract `copyPlainValue` 的输入向孪生，六词同表） | leaf 与 plain 在 yjs 存储层同载体（extract 同支处理）；往返域对称 | extract.ts:138-141/§4.6；实测 A19 |
| D7 | XML 结构解析器：文本 span **逐字保留不解码实体**；注释/CDATA/PI 以逐字 XmlText 承载；**attr 值含 `"` 拒绝**；重复 attr last-wins | yjs `toString()` 不转义（A12/A13/A22 实证）——逐字 span 是唯一可再校验的往返策略 | ADR-0003 终态节点；实测 T11 四组 |
| D8 | 结构 ref 解析器自 extract.ts **纯移动**到共享模块 resolve.ts | 25 行不变量密集件（环守卫先于 memo 命中）复制即漂移 | extract D8（SA2 R2 定稿） |
| D9 | map 装配**按快照键迭代**（present 惯例：own + 非 undefined） | 与 extract 按声明字段迭代**方向相反的显式不对称**：写侧按快照键才不静默丢键 | validate present() 惯例；AC-3 键集断言 |
| D10 | ④ 事务体只含对已验证载荷的 `set` 循环 | 载荷 JSON 域 + detached 类型均不可使 yjs set 抛错 → 事务内唯一抛错源 = observer/引擎缺陷 = loud | 实测 A6/A19/B7 |

不变式清单（全文引用锚）：

- **INV-1 零写入**：④ 开始前任何返回路径，doc `encodeStateAsUpdate` 逐字节不变 + 0 次 update 事件
- **INV-2 恰一事务**：成功路径恰 1 次 update 事件（单 `doc.transact`）
- **INV-3 物化 fail-fast**：materialization 失败恰 1 条 issue
- **INV-4 logical 全收集**：逻辑失败保留完整 issues（含 100 条上限 + 截断标记，原样）
- **INV-5 事务异常唯一出口**：④ 内异常原样抛出，不吞并、不伪装返回值、不清理已写内容
- **INV-6 只写 ROOT**：全程只触碰 `'ROOT'` 名字空间（SCHEMA/META 零接触）
- **INV-7 输入引用隔离**：深拷贝使物化后突变输入快照不影响 doc（yjs set 按引用存储，实测 A19）
- **INV-8 确定性**：快照键枚举序 / union 成员声明序 / XML 源序
- **INV-9 往返域对称**：materialize 输入域 ≡ extract 输出域 ≡ JSON 值域；extract 读侧拒绝的
  值，materialize 写侧同表拒绝

---

## §1. 背景、授权链与现状盘点

### 1.1 ADR 授权链（设计必须遵守的约束基准）

摘自 relevant_decisions（编号可回查 ADR 原文）：

1. **ADR-0007**（直接上游）：「`materializeRoot(derived, snapshot, doc)`：唯一公共物化入口；
   内部先执行 `validateLogicalSnapshot`，再构造未集成到任何 doc 的 detached Yjs 子树，确认目标
   ROOT 为空后以一次 `Y.transact` 安装。验证或构造失败时目标 doc 零写入；不覆盖、不合并、不
   fallback」；「逻辑校验保留完整 issues，Yjs 结构与路径/操作错误 fail-fast」；「零写入承诺覆盖
   所有验证失败和 detached 构造失败」；「事务开始后若未知 observer 抛错，视为 Runtime
   internal/fatal，不虚假声称自动回滚，也不尝试 fallback」；「XML string 与 Y.XmlFragment 只承诺
   语义等价 round-trip，不承诺字符串逐字相同」。
2. **ADR-0003**：ROOT 固定物化为 Y.Map（`doc.getMap('ROOT')`，`YArray`/`YXmlFragment` 与标量形
   一律拒绝）；`xml-fragment` 是结构树终态节点，JSON 快照中其值为 XML 字符串；联合 any-of
   （至少一个成员接受即接受）；ref 不内联展开，解析由包内共享解析器完成。
3. **ADR-0002**：「统一写入管线收敛为『结构 → 值 → 单事务提交』三步」——①校验（值）②构造
   （结构）③单事务提交，materializeRoot 即该三步的入口级实现。
4. **ADR-0006**：doc 三条目布局（SCHEMA/META/ROOT）；「META/SCHEMA 作为 ROOT 的兄弟条目，天然在
   校验面之外」——对称地，物化**写入面**也只有 ROOT 子树。
5. **ADR-0001**：SCHEMA 信封命名契约；本任务零触碰。

### 1.2 SA8 非冲突注意事项落位表（冲突门禁 verdict=clear 的 6 条转达）

| # | SA8 注意事项 | 本设计落位 |
|---|---|---|
| 1 | 实现落位 `@nomicore/doc-runtime`，依赖仅 vfsl + yjs | §3 模块布局（零新依赖，package.json 不动） |
| 2 | 入口名 `validateLogicalSnapshot`（无兼容 alias） | §4.1 阶段① 直调该名 |
| 3 | ROOT 顶端固定 Y.Map、只写 ROOT 子树 | §4.2（探针）+ INV-6 |
| 4 | 结果联合按域分离：logical 全收集 / materialization 单 issue，不合并巨型 issue 类型 | §4.8 失败分类总表 |
| 5 | XML 叶子终态，只承诺语义等价 round-trip | §4.6（逐字 span 策略恰好做到更强：可再校验） |
| 6 | observer 边界：不虚假承诺回滚 | §4.1 D1 + §4.7 |

### 1.3 代码现状（全部已读）

| 文件 | 现状 | 本任务关系 |
|---|---|---|
| `packages/doc-runtime/src/index.ts`（11 行） | 仅导出 `extractYjsSnapshot` + 类型 | **修改**：追加 materializeRoot 导出 |
| `packages/doc-runtime/src/extract.ts`（372 行） | extract 全量实现；`makeRefResolver` 为模块私有（L229-251） | **修改**：仅删除局部 resolver 改 import 共享模块（D8 纯移动） |
| `packages/doc-runtime/src/carrier.ts`（69 行） | `carrierOf` 粗判 + `probeRoot` 四级探针（extract 侧实证冻结：P1-P4） | **零修改**，原样复用 |
| `packages/doc-runtime/src/materialize.ts` | 不存在 | **新建**（主编排 + 构造遍历 + JSON 域拷贝） |
| `packages/doc-runtime/src/xml-parse.ts` | 不存在 | **新建**（XML 结构解析器） |
| `packages/doc-runtime/src/resolve.ts` | 不存在 | **新建**（共享 ref 解析器，自 extract.ts 移动） |
| `packages/doc-runtime/test/materialize-root.test.ts`（399 行） | SA6 红灯，13 用例全红（`materializeRoot is not a function`） | **[SA6 owned]** SA3 使其转绿，不改断言 |
| `packages/vfsl/src/validate.ts` | `validateLogicalSnapshot` 值树解释器；`ValidateIssue = {message, path}`（L43-51）；`present()`（L158）；scalar unknown 恒接受（L460） | 只读依赖，零改动 |
| `packages/vfsl/src/xml.ts` | `wellFormedXml` 良构扫描器（片段语义：多顶层元素 + 顶层文本；实体宽松；属性值引号内字面量） | 只读对照：解析器文法镜像基准 |

关键既定语义（从源码与测试提取，设计据此对齐）：

- `probeRoot`：① `getMap('ROOT')`（缺席 → 惰性创建空 map，**零 update 事件、state 不变**，P4）；
  ROOT 存在且非 Y.Map → ① 抛 → ② getArray ③ getXmlFragment ④ getText 级联（次级探针仅在 ROOT
  确已存在时执行，无创建副作用，P1b/P2c/P3d）；四级全失败 → throw（崩溃边界收编）。
- extract 的 walk 对 leaf/plain **同支处理**（`extract.ts:138-141`：两者都要求 `carrierOf ===
  'plain value'` 并走 `copyPlainValue` 深拷贝 + 值域断言）——yjs 存储层上 leaf 与 plain 是同一种
  载体（plain value 槽位），本设计 D6 对齐。
- validate 的对象语义：`isPlainObject`（L153：typeof object + 非 null + 非数组，**无原型检查**）；
  `present(k)`（L158：hasOwn 且值非 undefined）；封闭对象未知键拒绝（L574）；Record 形按
  `Object.keys` 逐动态键下钻（L550）。

### 1.4 SA6 冻结契约（13 用例锚点，逐条编号供 §5 引用）

| 用例（测试文件行号） | AC | 锚点行为 |
|---|---|---|
| U1（L171） | AC-1 | 多违规快照 → `ok:false` 且 `issues` 与 `validateLogicalSnapshot` 直调 `toEqual` 完全一致（≥2 条，全收集） |
| U2（L194） | AC-1 | ROOT 非空 → `ok:false` 恰 1 条 issue，message 非空字符串 |
| U3（L211） | AC-2 | ROOT 含 `title:'old'` → 单 issue + 0 update + state 逐字节不变 + title 不被 overwrite + 新键不被 merge |
| U4（L229） | AC-2 | ROOT 为空 Y.Array → 同款失败；state 不变 |
| U5（L244） | AC-2 | 正向对照：ROOT 缺席 / 空 map（set 后 delete）→ 成功 |
| U6（L264） | AC-3 | 全形态载体：map→Y.Map、array→Y.Array、xml→Y.XmlFragment、plain→纯数组且非 Y.AbstractType；键集恰为快照声明字段 |
| U7（L287） | AC-3 | plain 深拷贝：物化后突变输入（数组 push / 嵌套改值）doc 不变；`stored !== input` |
| U8（L308） | AC-4 | 成功恰 1 次 update 事件 |
| U9（L321） | AC-4 | 逻辑失败 → 0 事件 + state 逐字节不变 |
| U10（L335） | AC-4 | ROOT 非空 → 0 事件 + state 不变 |
| U11（L347） | AC-4 | SCHEMA/META 兄弟条目物化前后不变 |
| U12（L362） | AC-5 | XML 物化 → extract 提取 → 归一化语义等价 + 重校验 `ok:true` |
| U13（L383） | AC-6 | observer 抛错 → `toThrow`；update 恰 1 次；ROOT 值已落盘（不虚假回滚） |

测试头部另冻结三条 fixture 纪律（SA6 实证）：detached 子树集成前**不可读**（yjs 'Invalid
access'）→ 断言只看物化后的 doc 侧；`ymap.set(k, plainObj)` 按引用存储 → 深拷贝必须行为断言；
事务内 observer 抛错不回滚 → 不承诺回滚。

---

## §2. 需求推演（Feature 切入点）

### 2.1 方向反转：读侧孪生

extract 的数据流：`doc（live Yjs 载体）—结构树导航→ 快照（纯 JSON）`，失败面是「live 载体与
结构树不符」（载体错位，fail-fast 单 issue）。materialize 反转：`快照（纯 JSON）—结构树导航→
detached Yjs 子树 —单事务→ doc`，失败面是「快照形状/值域与结构树不符」（形状错位 + 值域违规，
同为 fail-fast 单 issue）。两侧共享：结构树（同一 `derived.structure`）、ref 解析器（D8）、
ROOT 探针（D3）、载体词表（map→Y.Map / array→Y.Array / xml-fragment→Y.XmlFragment / leaf+plain→
plain value）。

方向决定的三处**刻意不对称**（SA2 必攻点，预先落文）：

| 维度 | extract（读侧） | materialize（写侧） | 理由 |
|---|---|---|---|
| map 迭代 | 按声明字段序遍历 live map（未知 live 键不进快照——D4） | **按快照键迭代**（`Object.keys` + present 惯例），封闭形每键必须查到声明字段，查不到 = 单 issue | 写侧若按声明字段迭代，快照中「声明外的键」会被静默丢弃——数据丢失伪降级；AC-3 键集断言（键集恰为快照字段）也由快照键迭代天然满足 |
| 值域断言时机 | 读时（copyPlainValue 拒绝非 JSON 存量） | 写时（copyJsonDomain 拒绝非 JSON 输入） | INV-9：两侧同表（六词，§4.5） |
| 崩溃边界 | 全函数体顶层 catch → E100，**绝不外抛**（INV-6） | ①②③ 共享 catch → E200；**④ 事务零捕获、异常外抛**（INV-5） | AC-6：extract 的 catch-all 若被照抄，observer 抛错会被吞成结构化返回 = 伪降级 |

### 2.2 往返域对称不变式（INV-9）

**物化输入域 ≡ 提取输出域 ≡ JSON 值域。** extract 的 `copyPlainValue` 在读侧拒绝六类值（bigint、
non-finite number、数组内 undefined、non-plain object（Date/类实例）、function/symbol、内嵌 Y
类型）。若 materialize 写侧接受其中任何一类，就会产出 extract 永远无法整读回来的文档（写读域
不对称 = 系统性脏数据源）。因此写侧**同表拒绝**（§4.5）。

这条不变式不是防御性空想——**两侧全部可达**（实证）：

- `type ROOT = { u: unknown }` → 结构节点 leaf（原型实测 `{"kind":"leaf"}`）→ validation 对
  Y.Map 实例 / bigint / function / NaN / Date / 数组内 undefined **全部 ok:true**（见 §11 附录 A
  脚本 U-unknown 段输出）。
- `typeof NaN === 'number'` → number 标量位（如 `YLEaf<number>`）实测接受 NaN（原型 T9）。

即：**逻辑值域 ⊋ JSON 值域**，validation 是宽域，materialize 在窄域上响亮执行（返回单 issue，
零写入）——这不是契约收窄（SA6 冻结的结果联合本来就允许 materialization 失败单 issue），而是
ADR-0007「不 fallback」在值域维度的落实。

### 2.3 最危险的架构点：AC-6 × 崩溃边界

extract 的「全函数顶层 catch、绝不外抛」是它的 INV-6；若 materialize 照抄，U13 必红：observer
抛错会被 catch 收编成 `{ok:false, issues:[E200…]}`——一个**虚假的「失败」返回值**（写入实际已
提交：update 已发出、值已落盘，实测 A9/A18）。ADR-0007 的措辞是「视为 Runtime internal/fatal，
不虚假声称自动回滚，也不尝试 fallback」——对库函数而言 fatal 的唯一诚实表达是**让异常原样离开
函数**（调用方 NamespaceRuntime 的串行化写入循环负责进程级处置）。设计解法（D1）：崩溃边界只
包裹 ①②③，④ 物理上位于一切 catch 之外（§4.1 伪代码结构使这一点不可绕过——`prepare` 与
`transact` 是两个函数体）。

---

## §3. 公共契约与模块布局

### 3.1 公共接缝（SA6 冻结，不得收窄）

```ts
// packages/doc-runtime/src/materialize.ts
import type * as Y from 'yjs';
import type { DerivedSchema } from '@nomicore/vfsl';

/** 物化 issue：与 ValidateIssue 同形（message + path 段数组）。logical 失败时数组元素即
 *  validateLogicalSnapshot 原生 issue（引用透传）；materialization 失败恒单条（fail-fast）。 */
export interface MaterializeIssue {
  message: string;
  path: Array<string | number>; // 段数组：map/object/Record 用 string，Y.Array 用 number；[] 即 ROOT 自身
}

export type MaterializeResult =
  | { ok: true } // 成功不携带额外载荷（exactOptionalPropertyTypes：无多余键）
  | { ok: false; issues: MaterializeIssue[] };

export function materializeRoot(derived: DerivedSchema, snapshot: unknown, doc: Y.Doc): MaterializeResult;
```

- `snapshot: unknown`：运行时姿态（沿 `parseSchemaEnvelope` / `getCompiled` 惯例）——契约要求普通
  JSON logical ROOT snapshot；非 JSON 值经 ①② 响亮拒绝。
- 同步、错误经返回值传递（④ 的异常是唯一例外，见 D1）；经 `src/index.ts` 与
  `extractYjsSnapshot` 同文件导出（`exports["."]` 已就位，package.json 零改动）。

### 3.2 模块布局（依赖方向：materialize → {resolve, xml-parse, carrier} → {yjs, vfsl types}）

```
packages/doc-runtime/src/
├── index.ts        修改：+2 行导出（materializeRoot + MaterializeIssue/MaterializeResult 类型）
├── materialize.ts  新建：四阶段编排 + buildValue/mapEntries/rootEntries + copyJsonDomain + 失败分类
├── xml-parse.ts    新建：XML 字符串 → detached Y.XmlFragment 结构解析器（模块内部件，不进公共面）
├── resolve.ts      新建：makeRefResolver（自 extract.ts L229-251 纯移动，签名与行为零变化）
├── carrier.ts      零修改：probeRoot / carrierOf 原样复用
└── extract.ts      修改：删除局部 makeRefResolver，改 import resolve.js（~-23/+1 行）
```

零新增依赖（`@nomicore/vfsl` + `yjs` 既有）；tsconfig / package.json 零改动。

---

## §4. 实现设计（伪代码）

### 4.1 D1 四阶段总编排与崩溃边界切分

```ts
export function materializeRoot(derived: DerivedSchema, snapshot: unknown, doc: Y.Doc): MaterializeResult {
  const ready = prepare(derived, snapshot, doc); // ①②③ + E200 崩溃边界（唯一 try/catch 所在）
  if (ready.kind === 'fail') return { ok: false, issues: ready.issues }; // INV-3/INV-4
  // ④ 单事务安装 —— 本函数体内没有任何 try/catch（INV-5 的结构性保证）
  doc.transact(() => {
    for (const [key, value] of ready.entries) ready.rootMap.set(key, value);
  });
  return { ok: true };
}

type Prepared =
  | { kind: 'ready'; rootMap: Y.Map<unknown>; entries: Array<[string, unknown]> }
  | { kind: 'fail'; issues: MaterializeIssue[] };

function prepare(derived: DerivedSchema, snapshot: unknown, doc: Y.Doc): Prepared {
  try {
    if (derived.structure.kind !== 'root') {
      throw new Error('derived.structure 非 root（手造派生物）'); // 对齐 extract B8 loud 边界
    }
    // ① 逻辑校验（值域宽域）：失败 → 引用零损透传（D2，INV-4；validateLogicalSnapshot 自身不抛错，
    //    其 E100/预算截断形态原样返回）
    const logical = validateLogicalSnapshot(derived, snapshot);
    if (!logical.ok) return { kind: 'fail', issues: logical.issues };

    // ② detached 构造（结构域窄域）：任何失败 → 单 issue（INV-3）；产物全是 detached 类型与新克隆
    const resolve = makeRefResolver(derived); // D8 共享解析器（环守卫先于 memo 命中）
    const top = rootEntries(derived.structure.node, snapshot, resolve);
    if (top.kind === 'issue') return { kind: 'fail', issues: [top.issue] };

    // ③ ROOT 探针 + 空置判定（D3）：只读触碰 'ROOT'（INV-6）
    const probe = probeRoot(doc);
    if (probe.carrier !== 'Y.Map') {
      return { kind: 'fail', issues: [fail([], `ROOT 载体不是 Y.Map（期望 Y.Map，实际 ${probe.carrier}）——无法安装物化子树`)] };
    }
    if (probe.map.size > 0) {
      return { kind: 'fail', issues: [fail([], `目标 ROOT 非空（现有 ${probe.map.size} 个键）——不覆盖、不合并、不 fallback`)] };
    }
    return { kind: 'ready', rootMap: probe.map, entries: top.entries };
  } catch (err) {
    // 崩溃边界（①②③ 范围）：实现缺陷 / 手造派生物 / 对抗输入（getter/Proxy 抛出）
    const detail = err instanceof Error ? err.message : String(err);
    return { kind: 'fail', issues: [{ message: `DOCRT-E200: materialize 内部错误（意外异常）: ${detail}`, path: [] }] };
  }
}
```

编排顺序即 ADR-0007 原文顺序（validate → construct → confirm-empty → transact），失败优先级冻结：
**logical（完整 issues）＞ 构造（单 issue）＞ ROOT 非空/异型（单 issue）**。组合场景（如快照
构造失败且 ROOT 非空）报构造 issue——无测试覆盖组合态，本表为冻结规格。构造在探针前的性能代价
（ROOT 非空时白构造）是 ADR 顺序的既定代价，v1 接受。

**零写入的结构性论证（INV-1）**：① 只读 snapshot；② 产物全部 detached 或新克隆（对 doc 零
触碰——detached 写入合法性的实测依据见 §11 A1/A2/A3/A5）；③ `probeRoot` 只读（惰性 getMap 零
update、次级探针零副作用，§11 A10/B15）；④ 是第一条写路径。故 ①②③ 的任何 return 路径上
state 逐字节不变、0 update 事件（U3/U4/U9/U10 锚点）。

**TOCTOU 论证**：①②③④ 在同一同步调用内顺序执行，JS run-to-completion 使并发 writer（y-protocols
的远端 update 经事件循环异步 apply）无法插入检查与事务之间；快照在 ①② 各读一遍，对抗性
Proxy 双读发散的处置见 §6 B10（构造以自身读到的数据为准，任何形状/域违例响亮单 issue，永不
半写入）。

### 4.2 D3 ROOT 探针复用与空置判定

零修改复用 `carrier.ts` 的 `probeRoot`（extract 侧已实证冻结，本任务 §11 A10/A11/B15 复测）：

| 探针结局 | 语义 | 处置 |
|---|---|---|
| `{carrier:'Y.Map', map}`（ROOT 缺席，惰性创建） | 空 map，零 update、state 不变 | `size===0` → 就绪（U5 缺席分支） |
| `{carrier:'Y.Map', map}`（已集成空 map，如 set 后 delete） | `size===0`（tombstone 不计） | 就绪（U5 空分支） |
| `{carrier:'Y.Map', map}` 且 `size>0` | 非空 | 单 issue「目标 ROOT 非空」（U2/U3/U10） |
| `{carrier:'Y.Array' \| 'Y.XmlFragment' \| 'Y.Text'}` | 异型载体（即使空） | 单 issue「ROOT 载体不是 Y.Map」（U4） |
| 四级全失败 throw | 不可达态 | E200 收编 |

「空」的判定是 `size === 0` 而非「state 里无 ROOT 条目」——语义按 ADR-0006「ROOT 数据根」的
**内容**而非存储痕迹：set-then-delete 的 map 内容为空，物化合法（U5 doc2 明文锚定此边界）。

### 4.3 D9 构造遍历全景表（buildValue / mapEntries / rootEntries）

构造器内部两结局（无 extract 的软拒概念——见 §4.4）：

```ts
type BuildResult = { kind: 'value'; value: unknown } | { kind: 'issue'; issue: MaterializeIssue };
type EntriesResult = { kind: 'ok'; entries: Array<[string, unknown]> } | { kind: 'issue'; issue: MaterializeIssue };
```

**issue 构造器助手（单点定义，SA3 防走样；§4.1 的 `fail` / §4.3 的 `issue` / `shapeIssue` / §4.5 的
`domainIssue` 全部收敛到此处）：**

```ts
function makeIssue(message: string, path: Array<string | number>): MaterializeIssue { return { message, path }; }
// shapeIssue(path, 期望形状词, snap) → 形状错位 message（word 由形状词表渲染，object 子类附 constructor 申报）
// domainIssue(path, loc, word, extra?) → 纯值域违规 message（renderPath 与 extract.ts:366-372 同款，可复用其实现思路）
// §4.1 伪代码中的 fail([], msg) 即 makeIssue(msg, []) 的简写
```

**节点全景表（唯一分发点 `buildValue`；八 kinds 与 extract §4.3 对称）：**

| node.kind | 快照期望形状（D4，构造侧断言） | 构造动作 | 失败词（issue message 模板） |
|---|---|---|---|
| `root` | —（入口已展开） | 透传 `buildValue(node.node, …)` | —（嵌套 root = 手造 → E200 路径同 extract 透传语义） |
| `ref` | — | `buildValue(resolve(node), …)` | 环/缺名 → throw → E200 |
| `map` | 原型守卫普通对象 | `mapEntries` 收集键值对 → `new Y.Map()` 逐键 `set` | `快照形状错位（{path}）：期望 map 形普通对象，实际 {word}` |
| `array` | `Array.isArray` | 逐元素 buildValue → `new Y.Array()` 一次 `insert(0, items)` | `快照形状错位（{path}）：期望数组，实际 {word}` |
| `xml-fragment` | `typeof string` | `parseXmlToFragment(v)`（§4.6） | 形状错位（期望 XML 字符串）/ `XML 解析失败（{path}）：{reason}` |
| `leaf` | JSON 值域任意 | `copyJsonDomain(v)`（§4.5）——**与 plain 同支** | 纯值域违规六词（§4.5） |
| `plain` | JSON 值域任意 | `copyJsonDomain(v)` | 同上 |
| `union` | — | 成员试验（§4.4） | `联合节点无可构造成员（{path}）：{N} 个成员的结构形状均不符（首个失败：{声明序首真 issue.message}）`（R2-M2） |

形状词 `word`：`null` / `array` / `object` / `string` / `number` / `boolean` / `bigint` /
`function` / `symbol`（object 子类附 `（constructor: Date）` 式申报，对齐 extract D9② 的申报词
纪律——本设计中词只进 message 文本不进结构化字段，无 F4 词表冻结问题）。

**`mapEntries`（map 节点键值收集，D9 核心）：**

```ts
function mapEntries(node: MapNode, snap: unknown, path: Path, resolve: Resolver): EntriesResult {
  const obj = plainObjectOf(snap); // D4 原型守卫：typeof object && 非 null && 非数组 &&
                                   // (proto === Object.prototype || proto === null)
  if (obj === null) return shapeIssue(path, 'map 形普通对象', snap);
  const slot = recordSlotOf(node); // Record 形判定：fields 恰一且 name === '<key>' → fields[0].node
  const entries: Array<[string, unknown]> = [];
  for (const key of Object.keys(obj)) {          // 快照键枚举序（INV-8；整数形态键数值升序先行，
    const v = obj[key];                          //   与 validate §9.2 同一 JS 语义）
    if (v === undefined) continue;               // present 惯例：undefined 视同缺席（validate L158 同款）
    const childNode = slot !== undefined
      ? slot                                     // Record 形：一切键都是动态键
      : declaredFieldOf(node, key);              // 封闭形：查声明字段
    if (childNode === undefined) {
      return issue([...path, key], `快照含结构树未声明字段 "${key}"——拒绝静默丢键`); // 见下「未声明键」
    }
    const r = buildValue(childNode, v, [...path, key], resolve);
    if (r.kind === 'issue') return { kind: 'issue', issue: r.issue };
    entries.push([key, r.value]);
  }
  return { kind: 'ok', entries };
}
```

三条关键裁决：

1. **按快照键迭代（方向不对称，§2.1 表）**：封闭形快照键查不到声明字段 = 单 issue，绝不跳过。
   对通过 ① 的诚实快照此路径不可达（validate 封闭对象未知键全收集拒绝）；可达向量 = 对抗
   Proxy 双读发散 / 结构-值树错位的手造派生物——都必须响亮（静默丢键 = 数据丢失伪降级）。
   在 union 试验语境下（§4.4）同一 issue 语义退化为「该成员试验失败」，被下一成员竞争。
2. **`obj[key]` 读取安全性**：`Object.keys` 只返回 own enumerable 键；own 数据属性（含
   `__proto__`，JSON.parse / defineProperty 可造）遮蔽原型 accessor，括号读返回 own 值——
   实证 T10：Record 快照 own `'__proto__'` 键通过 ①（键名匹配 AssetId Pattern）并在 doc 侧
   `root.keys() === ["__proto__"]`、`get('__proto__')` 值正确。装配用 `ymap.set(key, v)`——
   yjs 内部 Map 存储，无 JS 原型污染面（实证 A7）。
3. **Record 形判定与 extract 同款约定**（`fields.length === 1 && fields[0].name === '<key>'`，
   evaluate.ts:107 实证）——两侧判定逻辑必须逐字相同，SA3 实现时以 extract.ts:100 为模板。

**`rootEntries`（ROOT 顶层特化——产物是 entries 而非 detached map）：**

```ts
function rootEntries(node: StructureNode, snap: unknown, resolve: Resolver): EntriesResult {
  const n = resolve(node); // root 内层（恒非 ref；手造 ref 链在此收敛，环/缺名 → E200）
  if (n.kind === 'map') return mapEntries(n, snap, [], resolve);
  if (n.kind === 'union') { // 全 map 形联合 ROOT（ADR-0003 允许形）
    let firstIssue: MaterializeIssue | undefined;  // 声明序首真 issue（R2-M2，对齐 extract walkUnion）
    for (const member of n.members) {              // 成员声明序（INV-8）
      const r = rootEntries(member, snap, resolve); // 递归试验成员；成员只允许 map/union 形——
                                                    // 非 map/union 成员落入末尾 throw → E200
                                                    // （R2-M1 定谳：不跳过，见下「R2-M1 定谳」段）
      if (r.kind === 'ok') return r;               // 首个成功成员胜（实证 T12：两种成员形状各自成功）
      if (firstIssue === undefined) firstIssue = r.issue;
    }
    return issue([], `联合 ROOT 无可构造成员（全 map 形联合的 ${n.members.length} 个成员均拒；首个失败：${firstIssue!.message}）`);
  }
  throw new Error('ROOT 结构节点非 map 形（手造派生物）'); // ADR-0003「ROOT 必须 map 形」→ E200
}
```

**R2-M1 定谳（联合 ROOT 成员非 map 形的结局 = throw → E200，不存在「跳过」分支）**：SA2 MINOR #1
指出本伪代码旧注释「非 map/union 成员跳过」与代码结构（非 map/union 成员落到函数末尾
`throw` → §4.1 catch → E200）矛盾。定谳**采用 throw 语义**（代码正确，矛盾注释已删）；SA3 按本
伪代码实现，SA7 按定谳断言。理由：

1. **ADR-0003「ROOT 必须 map 形」是派生物合法性约束**：合法派生物的 ROOT 联合成员必为 map 形
   （shapes.ts E311 全 map 形联合 clsOf-synthesize 在编译期挡死非 map 形成员，SA2 评审 V4 源码
   核验）；非 map 形成员只可能来自手造派生物。
2. **跳过 = 缺陷降格**：若跳过该成员继续试验，手造派生物会被伪装成 F6「联合全拒」的正常业务
   失败，违反 §6 B11 手造派生物 loud 边界（该类输入的定性是 E200：实现缺陷/对抗输入，而非 F6）。
3. **消除可观测分歧**：全员非 map 形的极端手造下，skip 语义产出 F6 message、throw 语义产出
   E200 message——两个冻结规格并存即 SA3 实现漂移地雷（SA2 攻击点 #1 原文），统一为 E200。

SA7 红线测试思路 #1（SA2 评审报告「先由 SA1 定谳修订，再按定谳断言」）按本定谳执行：
`derived.structure.node = {kind:'union', members:[{kind:'array',…}, legitMap]}` → `ok:false`
恰 1 条且 message 含 `DOCRT-E200`（skip 分支已从设计中删除，「两侧不可混」的另一侧不复存在）。

为什么 ROOT 顶层不直接产出 detached Y.Map：安装目标是 `doc.getMap('ROOT')` **本身**（doc 级固定
挂载点，ADR-0003），不能把一个 detached map 「换上去」；且 detached 类型**不可读**（SA6 fixture
纪律 + 实测 A4：读不抛错但返回空数据并打印 'Invalid access'——比抛错更危险），entries 必须在
构造期随身携带，④ 直接消费。嵌套 map 无此问题（作为值安装，`buildValue(map)` 返回 detached
Y.Map 实例，实测 A5/A6/B7）。

### 4.4 D5 union 构造试验语义

```ts
case 'union': {
  let firstIssue: MaterializeIssue | undefined;  // 声明序首真 issue（R2-M2：全拒时成员级差异词
                                                 // 随 message 带出，对齐 extract walkUnion「首真
                                                 // issue」纪律——SA2 MINOR #2）
  for (const member of node.members) {           // 成员声明序（INV-8）
    const r = buildValue(resolve(member), v, path, resolve);
    if (r.kind === 'value') return r;            // 首个构造成功者胜（any-of + 声明序，对齐 extract §4.5.2）
    if (firstIssue === undefined) firstIssue = r.issue; // 丢弃的是其余成员的细节，首成员细节保留
  }
  return issue(path, `联合节点无可构造成员（${renderPath(path)}）：${node.members.length} 个成员的结构形状均不符（首个失败：${firstIssue!.message}）`);
}
```

与 extract 试验的三点同异（SA2 必攻点，预先落文）：

1. **试验 = 完整递归构造尝试**，失败产物是可丢弃的 detached 垃圾（未集成任何 doc，GC 回收，
   INV-1 不受影响）。不需要 extract 的「前置载体判定 + 字段序软标记」两步结构——见下条。
   丢弃的是失败产物与「其余成员」的细节；**声明序首真 issue 的 message 保留并附加进 F6**
   （R2-M2：形状词 / 未声明键名 / 域违规词不蒸发，排障少走一轮——与 extract walkUnion 全拒时
   报告首真 issue 的纪律对称）。
2. **无软拒概念**。extract 的软拒存在因为读侧无法区分「缺必填」（逻辑域、不报）与「载体错位」
   （结构域、要报）；构造侧**不检查必填性**（必填是值域概念，① 已全量校验），试验只有二值结局
   （构造成功 / 失败），失败原因 = 形状错位 + 值域违规 + 未声明键，全是结构域词汇。这使构造侧
   试验比 extract 简单一个维度，且与 validation 的 any-of 语义精确对齐：**validation 接受的成员
   集合 ⊇ 构造成功的成员集合**（宽域接受 ⊆ 窄域构造，§2.2）——validation 选中的成员若构造失败，
   说明该值在 JSON 域外，响亮拒绝是唯一正确行为（绝不 fallback 到「最接近」的其他成员）。
3. **判别式（discriminator）是死数据**（对齐 extract D5/INV-4）：成员选择由结构形状试验裁决，
   `byValue` 跳转表零读取。fixture 实证（原型 T1）：`doc1 = {kind:'text', body, audit}` 的成员
   选择路径 = image 成员在 `mapEntries` 的未声明键 `body` 处失败（快照键迭代天然提供 extract
   R2/#5 式的廉价前置裁剪——不需要独立的键集预检 pass，未声明键在迭代第一个异键处即短路）→
   text 成员成功 → body 落位 `Y.XmlFragment`（U6 断言锚点）。

Record 形 union 成员：`mapEntries` 的 Record 分支无「未声明键」概念（一切键都是动态键），试验
= 直接构造——与 extract R2/#1（Record 形成员试验 = 直接 walk）对称；原型 T13 实证
（`Record<string, YLeaf<string>> | { b: YArray<...> }` 对 `{x:'hello'}` 选 Record 成员产出 Y.Map）。

试验成本：失败成员在**首个异键**（封闭形）或**首个终态形状/域违例**处短路；最坏情形（各成员
键集对齐、深层终态分歧）为 Σ成员数 × 子树深度的乘积级，需要对抗性构造的 schema+快照组合且必须
先通过 ①（validation 自身的联合三段算法对同类对抗面有 2×10⁸ 工作预算兜底）；v1 接受该上界并
在此登记（§4.11）。

### 4.5 D6 JSON 域深拷贝（copyJsonDomain——extract copyPlainValue 的输入向孪生）

```ts
function copyJsonDomain(v: unknown, path: Path, loc: string): BuildResult {
  if (typeof v === 'number') {                                   // number 拆支（对齐 extract R2.3）
    if (!Number.isFinite(v)) return domainIssue(path, loc, 'non-finite number'); // NaN/±Infinity：可达（§2.2 实证）
    return { kind: 'value', value: v };                          // 有限 number 直通
  }
  if (v === null || typeof v === 'string' || typeof v === 'boolean') {
    return { kind: 'value', value: v };                          // JSON 标量直通（标量不可变，无引用隔离问题）
  }
  const c = carrierOf(v);                                        // carrier.ts 粗判复用
  if (c !== null && c !== 'plain value') {
    return domainIssue(path, loc, c);                            // 内嵌 Y 类型：可达（unknown 位实证）——
                                                                  // 跨 doc 集成 live 引用会移动/劫持源类型，必须拒绝
  }
  if (typeof v === 'bigint') return domainIssue(path, loc, 'bigint');          // 可达（unknown 位）
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (let i = 0; i < v.length; i++) {
      const el = v[i];
      if (el === undefined) return domainIssue(path, loc, 'undefined');        // 可达（unknown[] 元素位实证）
      const r = copyJsonDomain(el, path, `${loc}[${i}]`);
      if (r.kind === 'issue') return r;
      out.push(r.value);                                         // 新数组——INV-7 引用隔离
    }
    return { kind: 'value', value: out };
  }
  if (typeof v === 'object') {                                   // 走到此处必非 Y 家族（粗判已滤）
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) {          // 原型守卫（对齐 extract R2/#3 判例）
      const ctorName = (proto as { constructor?: { name?: string } }).constructor?.name ?? 'unknown';
      return domainIssue(path, loc, 'non-plain object', `constructor: ${ctorName}`); // 可达（unknown 位 + all-optional object 位）
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) {
      const val = (v as Record<string, unknown>)[k];
      if (val === undefined) continue;                           // present 惯例（与 mapEntries/validate 三方一致）
      const r = copyJsonDomain(val, path, `${loc}.${k}`);
      if (r.kind === 'issue') return r;
      Object.defineProperty(out, k, { value: r.value, writable: true, enumerable: true, configurable: true });
                                                                  // defineProperty 安全写入（对齐 extract putSnapshotKey/D13：
                                                                  // own '__proto__' 键不落原型、不触发原型 setter）
    }
    return { kind: 'value', value: out };
  }
  return domainIssue(path, loc, typeof v === 'function' ? 'function' : 'symbol'); // 可达（unknown 位实证）
}
```

**六词同表**（INV-9 的落文）：`bigint` / `non-finite number` / `undefined`（数组元素）/
`non-plain object` / `function` / `symbol`（+ 内嵌 Y 类型用载体词）——与 extract `copyPlainValue`
（extract.ts:261-308）逐词对齐，可达性标注同口径（本侧全部可达，无 extract 的「set 期即抛不可达」
防御支——输入是调用方给的 JS 值，一切皆可造）。message 模板：
`纯值域违规（{renderPath(path)}，内部位置 {loc}）：期望 plain value（JSON 值域），实际 {word}`——
`renderPath` 与 extract 同款（位置线进 message 不进 path，锚定声明节点位）。

INV-7 的实现根源：**一切容器（数组/对象）重建新实例，标量不可变直通，Y 类型构造期新建**——输入
快照与 doc 之间零共享引用。实证：A19（yjs `set` 按引用存储——不拷贝即共享）+ 原型 T2（突变三处
输入，doc 不变）。

### 4.6 D7 XML 结构解析器（xml-parse.ts）

```ts
/** 模块内部件（不进公共面）。输入：XML 字符串（① 已过 wellFormedXml，但解析器不信任输入——
 * 任何扫描异常响亮失败，见 §6 B10）。输出：detached Y.XmlFragment。 */
export type XmlParseResult =
  | { ok: true; fragment: Y.XmlFragment }
  | { ok: false; reason: string };
export function parseXmlToFragment(text: string): XmlParseResult;
```

**两阶段结构**：① 扫描器（显式标签栈、零递归，**骨架逐条镜像 vfsl `xml.ts` 的
`wellFormedXml`**——同一 token 识别、同一 `readXmlName`/`skipXmlSpace` 字符集）产出中间树（纯
数据：`{text: string}` 文本节点 / `{name, attrs, children}` 元素节点）；② 装配器递归建 Y 类型
（`Y.XmlText(span)` / `Y.XmlElement(name)` + `setAttribute` + `insert(0, kids)`，深度受 JS 栈
上界约束，溢出 RangeError → E200，与 validate.ts 对深嵌套的处置同款）。

**四条语义规则（每条都有 yjs 实测依据）：**

1. **文本 span 逐字保留，不解码实体。** `'<p>a &lt; b</p>'` 的文本 run 以字面四字符 `&lt;`
   存入 XmlText——因为 yjs `XmlText.toString()` **不做 XML 转义**（A13：`'a < b & c'` 原样输出；
   A22：`'A &amp; B'` 字面保持）。解码再存储会把 `&lt;` 变成裸 `<`，提取侧产出非良构字符串、
   重校验必挂——逐字 span 是唯一同时满足「往返可再校验」与「语义等价」的策略。实证 T11 第 4
   组：`'plain &amp; text'` 字节还原 + revalidate ok。
2. **注释 / CDATA / 处理指令以逐字 XmlText 承载。** Yjs 无 Comment/CDATA/PI 节点类型；按
   ADR-0003「xml-fragment 是不透明终态、只承诺字符串投影」，惰性 span 的唯一可观测是其字符串——
   逐字 XmlText 精确保留之（B3/B6 实证：`'<!--c-->'` 字节往返）。不丢（丢 = 内容损失，语义不等
   价）、不解码（解码即规则 1 病态）。
3. **属性值含 `"`（双引号）→ 响亮拒绝**（解析失败 reason）。yjs `XmlElement.toString()` 按字母
   序输出属性且**不转义属性值**（A12：`alt='an "alt" & <tag>'` 输出 `alt="an "alt" & <tag>"`
   ——引号截断、产出非良构 XML；A23：字母序）。单引号原值含双引号经 yjs 双引号重排后必破坏良构
   性。其余字符（`<` `>` `&` `'`）安全：属性值扫描是引号到引号字面量（vfsl xml.ts:9-10 同款）、
   `<` `>` 在引号内重解析合法。实证 T11 第 5 组：拒绝 + state 逐字节不变（零写入）。
4. **重复属性 last-wins、自闭合/空元素输出显式闭合标签、单引号值重排为双引号、标签内空白规格
   化**——全部是 yjs 序列化器的既定投影（A12/A17/A23/B5），往返为**语义等价**而非逐字（ADR-0007
   明文不承诺逐字）。实证 T11 第 1/2 组：`'<p title="a&gt;b">x<!-- note --><br/>y</p>'` →
   `'<p title="a&gt;b">x<!-- note --><br></br>y</p>'` revalidate ok；`'<e k=\'v\'/>'` →
   `'<e k="v"></e>'` revalidate ok。

装配边缘：空字符串 `''` → 空 fragment（`wellFormedXml('') === null` 合法；toString `''` 往返
合法，A16）；顶层森林（多顶层元素 + 顶层文本）→ fragment 多子节点（A14）；空元素 `<b></b>` 往返
不变（A8）。元素名字符集（`[A-Za-z_:][A-Za-z0-9_.:-]*`）Y.XmlElement 全接受（B9）。

**文法镜像同步义务**：xml-parse.ts 的扫描器骨架镜像 vfsl `xml.ts`（后者不导出——vfsl 公共面
最小化纪律），两侧字符集/惰性 span 识别必须同步演化。在设计文档与本模块头注登记该义务；若未来
vfsl 文法演进（如 DOCTYPE 支持），本解析器同票跟进。

### 4.7 D10 单事务安装

```ts
doc.transact(() => {
  for (const [key, value] of ready.entries) ready.rootMap.set(key, value);
});
```

- **恰 1 次 update 事件**（U8）：单 `doc.transact` 内全部 set 合并为一个 update 单元（ADR-0006
  「事务原子性由 Y.transact（单 update 单元）保证」）；实证 A6/B1/B7（含嵌套 detached 子树整装
  一事务）。对照组 A21（两次 transact = 2 事件）隔离了断言效度。
- **entries 为空（ROOT 全 optional 且快照空对象）→ 空事务**：0 update 事件（B2 实证）、`ok:true`
  ——这是合法的零写入成功，不是失败（U5 正向对照的语义延伸）。
- **事务体不可抛论证（D10）**：载荷全集 = JSON 域标量/容器（copyJsonDomain 产物）+ detached
  Yjs 类型（构造期新建）。yjs `set` 对前者按引用存储（A19）、对后者执行集成（A6），均不抛；
  因此事务体内唯一抛错源 = observer 回调 / yjs 引擎内部缺陷 → INV-5 语义（原样抛出）。SA3
  实现**不得**在事务体内追加任何可抛逻辑（不得读 detached、不得再触 doc、不得调用解析器）。
- **嵌套事务**（调用方已在 outer transact 中）：`doc.transact` 归并外层，成功路径对外层仍是
  单 update 提交（B12 实证）——不破坏 U8 语义（U8 在裸 doc 上锚定）。

### 4.8 失败分类总表（issue 分类学；SA8 注意事项 4 落位）

| # | 失败类别 | 阶段 | issues 形态 | path | message 模板 |
|---|---|---|---|---|---|
| F1 | 逻辑校验失败 | ① | **完整透传**（引用同源，含 100 条上限/截断标记/E100 形态） | 各 issue 自带 | validateLogicalSnapshot 原文 |
| F2 | ROOT 异型载体 | ③ | 恰 1 | `[]` | `ROOT 载体不是 Y.Map（期望 Y.Map，实际 Y.Array）——无法安装物化子树` |
| F3 | ROOT 非空 | ③ | 恰 1 | `[]` | `目标 ROOT 非空（现有 N 个键）——不覆盖、不合并、不 fallback` |
| F4 | 快照形状错位（map/array/xml 位） | ② | 恰 1 | 锚定首个错位节点 | `快照形状错位（{path}）：期望 {形状}，实际 {word}` |
| F5 | 纯值域违规（leaf/plain 位六词 + 内嵌 Y 类型） | ② | 恰 1 | 锚定声明节点（位置线进 message） | `纯值域违规（{path}，内部位置 {loc}）：期望 plain value（JSON 值域），实际 {word}` |
| F6 | union 无可构造成员 | ② | 恰 1 | union 节点 | `联合节点无可构造成员（{path}）：N 个成员的结构形状均不符（首个失败：{声明序首真 issue.message}）`；ROOT 顶层特化（§4.3 rootEntries）：`联合 ROOT 无可构造成员（全 map 形联合的 N 个成员均拒；首个失败：{首真 issue.message}）`（R2-M2） |
| F7 | 快照含未声明字段（封闭 map 直筑位） | ② | 恰 1 | `[...path, key]` | `快照含结构树未声明字段 "{key}"——拒绝静默丢键` |
| F8 | XML 解析失败（含 attr 值含 `"`） | ② | 恰 1 | xml 节点 | `XML 解析失败（{path}）：{reason}` |
| F9 | 手造派生物 / 实现缺陷 / 对抗输入异常 | ①②③ catch | 恰 1 | `[]` | `DOCRT-E200: materialize 内部错误（意外异常）: {detail}` |
| F10 | observer / 事务内异常 | ④ | **不返回——throw**（INV-5） | — | （原异常，loud 传播） |

F1 与 F2-F9 的域分离（ADR-0007「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型」）：
F1 数组元素是 `ValidateIssue` 引用（同形结构，类型可赋值）；F2-F9 是 materialize 域自建 issue。
错误码只设 `DOCRT-E200`（与 extract 的 E100 前缀区分来源，日志可检索）。

### 4.9 D8 ref 解析器共享化（resolve.ts）

`extract.ts:229-251` 的 `makeRefResolver` **纯移动**至新模块 `resolve.ts`（签名
`(derived: DerivedSchema) => (node: StructureNode) => StructureNode`，实现逐字不变：调用局部
memo + inFlight 环守卫**先于** memo 命中判定 + 缺名 loud 抛出），`extract.ts` 删除局部实现改
`import { makeRefResolver } from './resolve.js'`。理由：该 25 行是 SA2 R2 攻坚定稿的不变量密集件
（环守卫与 memo 命中的顺序语义），materialize 复制一份即埋下两侧漂移地雷；移动是机械操作，
extract 侧 48 绿用例即回归锚。契约影响审计见 §12。

### 4.10 确定性与迭代序冻结（INV-8）

| 迭代点 | 冻结序 |
|---|---|
| mapEntries / copyJsonDomain 键迭代 | `Object.keys` 枚举序（与 validate §9.2 同一 JS 语义） |
| union 成员试验 | 结构树 `members` 声明序 |
| rootEntries 联合 ROOT 试验 | 同上 |
| XML 子节点 / 属性 | 源序（装配 insert 序）；属性存储序由 yjs 序列化器决定（字母序输出） |
| ④ 安装循环 | entries 构造序 = 快照键枚举序 |

同一 `(derived, snapshot, doc)` 输入产出逐字节确定的 doc state（yjs 对相同 set 序的编码确定）。

### 4.11 复杂度与资源

- 时间：① O(快照规模)（validation 自有预算）；② O(快照规模 × union 试验因子)——诚实快照下试验
  因子趋近 1（首个异键短路，§4.4）；③ O(1)；④ O(entries)。
- 空间：detached 子树 O(快照规模) + 克隆 O(plain 值规模)——峰值约为快照的常数倍；构造失败路径
  的垃圾即刻可回收（无 doc 集成、无全局注册）。
- 深度：② 的递归深度 = 快照嵌套深度（JS 栈上界；对抗性深嵌套 → RangeError → E200，与
  validate.ts 深嵌套处置同款）。union 对抗组合的上界登记见 §4.4 末段。

---

## §5. SA6 13 用例 ↔ 设计条款逐条映射

| 用例 | 锚点行为 | 设计条款（推演链） |
|---|---|---|
| U1 | logical 失败 issues 与直调 `toEqual`（含顺序） | §4.1 阶段① 引用零损透传（D2）——同源引用，`toEqual` 平凡成立；validate 在 doc 触碰前执行 → 无副作用 |
| U2 | ROOT 非空恰 1 issue | §4.2 F3（`size>0` 单 issue）+ §4.8 表；构造先于探针成功（ADR 顺序） |
| U3 | 非 ROOT 零写入三断言 | INV-1（③ 只读：A10/B15 惰性与次级探针实证）+ F3 单 issue + 不进入 ④ |
| U4 | ROOT=Y.Array 同款失败 | §4.2 探针级联第②级（getMap 抛 → getArray 命中，A10 实证 getArray 无副作用）→ F2 |
| U5 | 缺席/空 map → 成功 | §4.2 前两行（惰性创建零事件 P4/B15；`size===0` 就绪，A11 实证 tombstone 不计） |
| U6 | 全形态载体 + 键集恰为快照字段 | §4.3 全景表（map→new Y.Map / array→new Y.Array / xml→parseXml / plain→clone）+ D9 快照键迭代（键集天然相等：快照键 ⊆ 声明字段且无构造垃圾键）；union 试验选对成员（§4.4 第 3 条 fixture 推演，原型 T1 实证） |
| U7 | plain 深拷贝突变隔离 | §4.5 INV-7（容器全重建 + A19 引用存储实证）；原型 T2 实证三处突变 doc 不变 |
| U8 | 成功恰 1 update | §4.7 单 transact（A6/B1/B7 实证） |
| U9 | 逻辑失败 0 事件 + state 不变 | §4.1 阶段① 在一切 doc 触碰之前 return → INV-1 |
| U10 | ROOT 非空 0 事件 + state 不变 | 同 U3 |
| U11 | SCHEMA/META 不变 | INV-6：全程只 `doc.getMap('ROOT')`（probeRoot 单点触碰，与 extract INV-7 同纪律）；原型 T8 实证 |
| U12 | XML 往返语义等价 + 重校验 ok | §4.6 规则 1/2（逐字 span——fixture `'`<p>Hello <b>world</b></p>`'` 字节还原，A8/B1/T3 实证）+ extract 侧行为（既有）；AC-5 的归一化对字节还原是 no-op |
| U13 | observer 抛错 `toThrow` + 1 update + 值已落盘 | §4.1 D1（④ 零捕获）+ §4.7 D10（载荷不可抛 → 唯一抛源 = observer）；A9/A18 实证传播/提交序（observer → update → throw）；原型 T7 实证 |

---

## §6. 边界与防御性设计清单（拒绝虚假降级对照）

| # | 诱惑（伪降级形态） | 裁决 | 条款 |
|---|---|---|---|
| B1 | ROOT 非空时 merge 新键 / overwrite 旧值 / 清空重来 | 响亮单 issue 拒绝，状态逐字节不变 | F3、U3/U10 |
| B2 | 构造失败时保留已构造部分（部分安装） | 构造全在 detached 域，失败 = 丢弃垃圾单 issue；④ 只在 ②③ 全绿后开启 | INV-1、§4.1 |
| B3 | Date/类实例在 map/plain 位静默投影 `{}`（`Object.keys(Date)===[]`） | 原型守卫响亮拒绝（extract R2/#3 同判例——时间戳语义蒸发是伪降级） | D4、§4.5；T9/unknown 实证可达 |
| B4 | NaN/bigint/function/symbol/undefined 元素「yjs 反正存得下」（A20 实证 NaN 可存取） | 拒绝：extract 读侧同表拒绝，写入即制造不可整读文档（INV-9） | D6、F5；可达性实证 §2.2 |
| B5 | 内嵌 Y 类型「顺手集成」（yjs 跨 doc 集成技术上可行） | 拒绝：集成 live 引用会移动/劫持源 doc 类型，且破坏快照纯 JSON 契约 | §4.5 内嵌分支；unknown 实证可达 |
| B6 | XML attr 值含 `"` 时「尽力转义/跳过该属性」 | 解析期响亮拒绝（yjs 序列化不转义，A12 实证任何静默路径都产出不可再校验文档） | §4.6 规则 3、F8；T11-5 实证 |
| B7 | observer 抛错吞成 `{ok:false}` 或「已回滚」失败结果 / 事后清理已写内容 | 异常原样抛出（伪 ok、伪失败、伪回滚三种虚假降级一并拒绝） | D1、INV-5、F10；A9/A18/T7 实证 |
| B8 | union 全拒时选「最接近」成员 / 成员 0 兜底 | 全拒 = 单 issue（any-of 无成员可构造是结构事实，无 fallback） | F6 |
| B9 | 快照未声明键静默跳过（按声明字段迭代的话自然发生） | 单 issue 拒绝静默丢键（诚实快照不可达；对抗输入响亮） | F7、D9 |
| B10 | 对抗性 Proxy 快照双读发散（① 读到合法值、② 读到垃圾） | 构造以自身读到的数据为准：垃圾形状/域违例 → 单 issue；构造碰巧合法 → 以构造数据物化（无部分写入、无崩溃）。E200 兜底一切异常。快照纯 JSON 是调用契约，Proxy 双读属契约外对抗输入 | §4.1 TOCTOU 段、F9 |
| B11 | 手造派生物（非 root 结构 / ref 环 / 缺名 / 非 map 形 ROOT）静默产出垃圾 doc | loud：E200 单 issue（对齐 extract B8 与 evaluate 手造 IR 边界） | F9、§4.3 rootEntries throw |
| B12 | 空 entries（全 optional 空快照）误判为失败 | 合法零写入成功（0 update、ok:true）——「空」不是错误 | §4.7 |

**已知边界（非本任务面，显式登记不改）：** extract 侧对退化重叠成员联合（前序成员为全可选
子集）的试验可能丢弃未声明 live 键（extract D4 既有语义：live 未知键不进快照）——materialize
写侧无此问题（D9 按快照键装配），但 `materialize → extract` 的往返在这种退化 schema 下可能缩
键（重校验仍 ok，AC-5 承诺不破）。此为 extract 冻结行为，修复属 extract 侧任务，本设计零触碰。

---

## §7. 包集成与验收映射

- **index.ts 追加**（`extractYjsSnapshot` 同款纪律）：
  ```ts
  export { materializeRoot } from './materialize.js';
  export type { MaterializeIssue, MaterializeResult } from './materialize.js';
  ```
- **验收命令**（SA3 完成后）：
  ```bash
  pnpm exec vitest run packages/doc-runtime/test/materialize-root.test.ts   # 13 用例转绿
  pnpm exec vitest run packages/doc-runtime/test/                            # 全套 61 用例（48 既有 + 13 新）绿
  pnpm --filter @nomicore/doc-runtime typecheck                              # strict 全开下零错误
  ```
- **回归面**：extract 侧 48 用例是 resolve.ts 移动重构的唯一行为锚（纯移动零行为变化预期全绿）；
  materialize-root 13 用例是功能锚。AC-1~AC-6 与 §5 映射表逐行对账。

## §8. 对业务的影响评估

- **新增公共能力**：ADR-0007 四入口之二落地（extract 已有）。下游消费者是计划中的
  `applyValidatedMutation`（ADR-0007：mutation 管线复用「detached 构造 + 单事务安装」——本设计的
  buildValue/mapEntries/xml-parse 均为模块内部件，届时在同包内复用，**不导出、不扩公共面**）与
  NamespaceRuntime 创建前物化流。
- **无破坏性**：零公共契约变更（§12）；extract 行为零变化（纯移动重构）；持久层/VFSL 零触碰。
- **性能**：同步 O(快照规模)；创建路径（低频操作）可接受；不引入缓存（derived 消费侧只读，
  ADR-0007「缓存生命周期留给 NamespaceRuntime/Registry」）。
- **失败语义可观测性**：F2-F9 单 issue 携带精确 path/位置线，`DOCRT-E200` 前缀与 extract 的
  E100 可区分；F1 完整 issues 与既有校验错误流无缝衔接。

---

## §9. SA2 反馈逐条回应

> R1 首发（907 行）经 SA8 复审 clear + SA2 攻击评审 **pass**（2026-08-22 19:52 报告，附 3 条
> MINOR 修订要求）；下表为本轮 R2 修订的逐条落实记录。SA2 攻击点 #4 为 INFO 登记（不要求本任务
> 动作）：设计新增响亮行为的 IT 已由 SA2 转入其评审报告「红线测试思路」10 条，SA7 活链路阶段落。

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| MINOR #1：§4.3 rootEntries 联合分支注释「非 map/union 成员跳过」与伪代码 throw→E200 矛盾，选一种统一（注释与伪代码一致，防 SA3 实现漂移） | ✅ | §4.3 rootEntries 伪代码（矛盾注释已删、结局显式化）+ 代码块后「R2-M1 定谳」段 | 定谳 **throw→E200**（代码语义正确，矛盾注释删除）；定谳段记录三条理由（ADR-0003 + shapes.ts E311 编译期挡死非 map 形成员 / 跳过=把 E200 类缺陷降格成 F6 类业务失败、违反 B11 / 消除两个可观测 issue 形态并存的漂移地雷）；显式写明 SA7 红线 #1 按定谳断言——message 含 `DOCRT-E200`，skip 分支已从设计删除 |
| MINOR #2：F6 union 全拒时丢弃成员级失败细节（extract walkUnion 保留首真 issue），建议 message 附首失败摘要 | ✅ | §4.4 union case 伪代码 + 正文第 1 点；§4.3 全景表 union 行；§4.3 rootEntries 联合分支；§4.8 F6 行 | 试验循环引入声明序 `firstIssue`（成功即返回、首个失败保留），F6 message 追加 `首个失败：{firstIssue.message}`——形状词/未声明键名/域违规词不蒸发；rootEntries 联合 ROOT 特化 message 同款；F6 模板统一为 §4.8 含 renderPath 前缀口径（顺带消除原 §4.4 代码与 §4.8 表模板的微差）；与 extract walkUnion「首真 issue」纪律对称 |
| MINOR #3：附录 B 段断言脚本未逐条内联且原型仅存 /tmp——补「B↔A 模板」映射表或注明并入 SA7 活链路重证，不得留口头承诺 | ✅（(a)+(b) 双落） | §11.2 新增「B 段断言 ↔ A 段模板行映射表」小节 + A 段脚本内 B 段注释改写；§11.3 末尾 R2-M3 补记 | (a) 全部证据承载 B 断言（B1/B2/B3/B5/B6/B7/B9/B12/B14/B15）逐条一行式 `check(...)` 内联，与 A 段同闭包可拼接重跑；B4/B8/B10/B11/B13 显式定性为不承载独立证据的中间编号（P 表证据编号集合完备性自检）；(b) B1/B2/B3/B7/B12/B15 登记为 SA3 完成后并入 SA7 活链路重证，逐条映射到 U 用例与 SA2 红线条目；原「按 §11.1 表逐行可重建」口头承诺删除，改为指向映射表；/tmp 失存风险三层兜底（SA2 V2/V3 复验 + 仓内重建基线 + SA7 重证） |

**R2 修订不变式自检**：13 用例行为锚点零收窄——F6 message 变化仅触 union 全拒路径（13 用例无
F6 message 文本断言，冻结契约仅要求 issue.message 非空字符串，新模板满足）；rootEntries throw
定谳仅触手造派生物路径（13 用例全部使用真实 fixture derived，不可达）；§10 ALLOW/DENY LIST
与 §3.2 模块布局零改动。

## §10. 文件清单（File Scope）

### ALLOW LIST

- `packages/doc-runtime/src/materialize.ts` — 新建，主编排（prepare/transact 切分）+ 构造遍历（buildValue/mapEntries/rootEntries）+ copyJsonDomain + 失败构造器（§4.1/§4.3/§4.5/§4.8，约 280 行）
- `packages/doc-runtime/src/xml-parse.ts` — 新建，XML 结构解析器两阶段（扫描镜像 + 装配）（§4.6，约 170 行）
- `packages/doc-runtime/src/resolve.ts` — 新建，makeRefResolver 自 extract.ts 纯移动（§4.9，约 45 行含头注）
- `packages/doc-runtime/src/extract.ts` — 修改，仅删除局部 makeRefResolver（L229-251）改 import 共享模块（纯移动，约 -23/+1 行，零行为变化；48 用例回归锚）
- `packages/doc-runtime/src/index.ts` — 修改，追加 materializeRoot + 类型导出（§7，+2 行）
- `packages/doc-runtime/test/materialize-root.test.ts` — `[SA6 owned]` SA6 验收红灯测试（Phase 1 已冻结）。SA3 仅可改测试基础设施（hook/fixture 隔离），**不得改断言逻辑**；预期改动为零

### DENY LIST

- `packages/vfsl/**` — vfsl 无 Yjs 依赖纪律（ADR-0007）；wellFormedXml 不导出是既有决策，本任务镜像而非改动
- `packages/persistence/**`、`packages/dsh-persistence/**` — 持久层不理解 VFSL（ADR-0006/0007）
- `packages/doc-runtime/src/carrier.ts` — probeRoot/carrierOf 原样复用（D3），零修改
- `packages/doc-runtime/test/extract-*.test.ts`（5 文件）— 既有 48 用例回归锚，任何 SA 不动
- `packages/vfsl-protocol/**`、`packages/vfsl-codegen/**` — 编译期轨道，无涉
- `packages/doc-runtime/package.json`、`packages/doc-runtime/tsconfig.json` — 零新依赖、零配置变化

## §11. 协议假设依据 (Protocol Assumption Evidence)

### 11.1 假设总表

全部依据为**设计期实测验证**（yjs@13.6.32，脚本与输出见 11.2/11.3，SA4 可复制重跑）。无 HTTP/
端口/进程级假设；本表全部是第三方库行为假设。

| # | 假设 | 依据类型 | 依据内容（实测编号 + 关键输出） | 风险 |
|---|---|---|---|---|
| P1 | detached `Y.Map.set` / `Y.Array.insert` / XmlFragment `insert` 集成前合法 | 实测 A1/A2/A3/A5 | 三类写入 + 嵌套 detached 全部 no-throw；集成后读回正确（A6） | 低 |
| P2 | detached 类型集成前**不可读**（不抛错但返回空 + stderr 'Invalid access'） | 实测 A4/A15 | `keys()` 返回 `[]`（set 过 'a' 之后）、`toString()` 返回 `''` → 设计不读 detached、entries 随身携带（§4.3 rootEntries 论证） | 低 |
| P3 | 单 `doc.transact` 安装整棵 detached 子树恰 1 次 update | 实测 A6/B1/B7 | `updates=1` + 嵌套子树内容正确；对照组 A21 两次 transact=2 事件 | 低 |
| P4 | observer 在事务内抛错：错误经 transact 传播、update 已发出、值已提交 | 实测 A9/A18 | `threw="observer-boom", updates=1, title="t"`；事件序 `["observer","update","catch"]`（AC-6/F10 契约基础） | 低 |
| P5 | `doc.getMap('ROOT')` 缺席时惰性创建：零 update、state 空 | 实测 B15/A15 | `stateBytes=2`（空 update 头） | 低 |
| P6 | ROOT 已是 Y.Array 时 `getMap` 抛、`getArray` 返回既有实例且 state 不变 | 实测 A10 | `getMap threw=true, state unchanged=true` | 低 |
| P7 | set-then-delete 的 map `size===0`（tombstone 不计） | 实测 A11 | `size=0` | 低 |
| P8 | `ymap.set('__proto__', v)` 合法、`keys()/get()` 可见 | 实测 A7 + 原型 T10 | `keys=["__proto__"], get="v"` | 低 |
| P9 | 手工构造 XmlElement/XmlText 的 fragment `toString()` 字节还原 fixture | 实测 A8/B1 + 原型 T3 | `"<p>Hello <b>world</b></p>" equal=true` | 低 |
| P10 | `XmlText.toString()` 不做 XML 转义（`&` `<` `"` 原样输出） | 实测 A13/A22 | `"a < b & c \"d\" 'e'"`、`"A &amp; B"`（字面保持）→ D7 规则 1（逐字 span） | 中 |
| P11 | `XmlElement` 属性按字母序输出、不转义属性值、空元素显式闭合标签、空属性值 `k=""` | 实测 A12/A17/A23/B5 | `alt` 值含 `"` 产出截断串；`<br></br>`；`a="1" b="2"`（set 序 b,a）→ D7 规则 3/4 | 中 |
| P12 | 空 transact（零写）不触发 update | 实测 B2 | `updates=0` | 低 |
| P13 | 嵌套 transact 归并外层单 update | 实测 B12 | `updates=1` | 低 |
| P14 | 注释/CDATA/PI 以逐字 XmlText 承载可字节还原（含元素内） | 实测 B3/B6 + 原型 T11 | `"a<!--c-->b"`、`"<!-- note -->"` 字节往返 | 低 |
| P15 | `ymap.set` 对 plain 容器按**引用**存储 | 实测 A19 | `stored===input: true` → INV-7 深拷贝必要性 | 低 |
| P16 | NaN 可存入 yjs 并读回 number | 实测 A20 | `typeof=number, isNaN=true` → 写侧必须拒绝（INV-9，A20 只证「能存」不证「该存」） | 低 |
| P17 | VFSL `unknown` 原语产 leaf 结构节点且 validation 恒接受（Y.Map/bigint/function/NaN/Date/undefined 元素全部 ok:true） | 实测（附录 A U-unknown 段） | 六类值 `validate ok=true` → 构造期域断言可达性（§2.2） | 低 |
| P18 | Record 结构节点 = 单字段 `'<key>'`；ROOT 全 map 形联合可求值 | 源码 evaluate.ts:107 + 原型 T12/T13 | union ROOT 两成员各自物化成功；Record 成员试验正确 | 低 |

### 11.2 附录 A：yjs 行为 + unknown 可达性复验脚本（SA4 可复制重跑）

运行方式（worktree 根）：`node <script.mjs > out.txt 2>&1`（yjs 路径按 .pnpm 实际解析调整，
或 `./node_modules/.bin/tsx <script>.mts` + `import * as Y from 'yjs'` 于 doc-runtime 目录）。

```js
// A 段：yjs 行为（A1-A21，节选与 P1-P16 对应的完整断言集）
import * as Y from '<worktree>/node_modules/.pnpm/yjs@13.6.32/node_modules/yjs/src/index.js';
const R = [];
const check = (n, f) => { try { R.push(`PASS ${n} → ${f()}`); } catch (e) { R.push(`FAIL ${n} → ${e.message}`); } };
check('A1', () => { const m = new Y.Map(); m.set('a', 1); return 'ok'; });
check('A2', () => { const a = new Y.Array(); a.insert(0, [1, 2]); return 'ok'; });
check('A4', () => { const m = new Y.Map(); m.set('a', 1); return 'keys=' + JSON.stringify([...m.keys()]); }); // → []
check('A6', () => { const d = new Y.Doc(); let u = 0; d.on('update', () => u++);
  const c = new Y.Map(); c.set('a', 1); d.transact(() => { d.getMap('ROOT').set('k1', c); d.getMap('ROOT').set('k2', 'p'); });
  return `updates=${u}`; }); // → 1
check('A7', () => { const d = new Y.Doc(); d.getMap('ROOT').set('__proto__', new Y.Map());
  return JSON.stringify([...d.getMap('ROOT').keys()]); }); // → ["__proto__"]
check('A9', () => { const d = new Y.Doc(); const r = d.getMap('ROOT');
  r.observe(() => { throw new Error('observer-boom'); }); let u = 0; d.on('update', () => u++);
  let t = null; try { d.transact(() => { r.set('title', 't'); }); } catch (e) { t = e.message; }
  return `threw=${t}, updates=${u}, title=${r.get('title')}`; }); // → threw=observer-boom, updates=1, title=t
check('A10', () => { const d = new Y.Doc(); d.getArray('ROOT'); const b = [...Y.encodeStateAsUpdate(d)];
  let th = false; try { d.getMap('ROOT'); } catch { th = true; }
  return `threw=${th}, eq=${JSON.stringify(b) === JSON.stringify([...Y.encodeStateAsUpdate(d)])}`; }); // → true,true
check('A12', () => { const d = new Y.Doc(); const f = new Y.XmlFragment(); const e = new Y.XmlElement('img');
  e.setAttribute('src', 'a.png'); e.setAttribute('alt', 'an "alt" & <tag>'); f.insert(0, [e]);
  d.getMap('ROOT').set('x', f); return f.toString(); }); // → <img alt="an "alt" & <tag>" src="a.png"></img>（不转义+字母序）
check('A13', () => { const d = new Y.Doc(); const f = new Y.XmlFragment();
  f.insert(0, [new Y.XmlText('a < b & c "d" \'e\'')]); d.getMap('ROOT').set('x', f); return f.toString(); }); // → 原样
check('A17', () => { const d = new Y.Doc(); const f = new Y.XmlFragment(); const div = new Y.XmlElement('div');
  div.insert(0, [new Y.XmlElement('br'), new Y.XmlText('tail')]); f.insert(0, [div]);
  d.getMap('ROOT').set('x', f); return f.toString(); }); // → <div><br></br>tail</div>
check('A19', () => { const d = new Y.Doc(); const a = ['x']; d.getMap('ROOT').set('a', a);
  return d.getMap('ROOT').get('a') === a; }); // → true（按引用存储）
check('A21', () => { const d = new Y.Doc(); let u = 0; d.on('update', () => u++);
  d.transact(() => { d.getMap('ROOT').set('a', 1); }); d.transact(() => { d.getMap('ROOT').set('b', 2); });
  return `updates=${u}`; }); // → 2（对照组）
// B 段（B1-B15）与 U-unknown 段同法：B 段全部证据承载断言的逐条一行式重建代码已内联于
// §11.2「B 段断言 ↔ A 段模板行映射表」（R2-M3-a，可直接拼入本脚本尾部重跑）；
// B4/B8/B10/B11/B13 的定性 + 关键断言的 SA7 活链路重证归属见该表下登记（R2-M3-b）。

// U-unknown 段：P17 可达性（完整可运行片段；运行方式同上，经 tsx 以解析 .ts 源）
import { evaluate, parseVfsl, validateLogicalSnapshot } from '<worktree>/packages/vfsl/src/index.js';
const parsed = parseVfsl('type ROOT = { u: unknown; arr: unknown[] };');
if (!parsed.ok) throw new Error('fixture parse fail');
const evaluated = evaluate(parsed.module);
if (!evaluated.ok) throw new Error('fixture evaluate fail');
const d = evaluated.derived; // structure = root→map[u:leaf, arr:array<leaf>]（实测 JSON 印证）
for (const [label, snap] of [['Y.Map', { u: new Y.Map(), arr: [] }], ['bigint', { u: 10n, arr: [] }],
  ['function', { u: () => {}, arr: [] }], ['NaN', { u: NaN, arr: [] }], ['Date', { u: new Date(0), arr: [] }],
  ['undef-in-arr', { u: 1, arr: [undefined] }]]) {
  R.push(`unknown ${label}: validate ok=${validateLogicalSnapshot(d, snap).ok}`); // 全部 true
}
console.log(R.join('\n'));
```

实测输出（2026-08-22，node v24.13.0，yjs@13.6.32；节选，完整输出与脚本同构）：

```
PASS A1 → ok                      PASS A9 → threw=observer-boom, updates=1, title=t
PASS A4 → keys=[]                 PASS A10 → threw=true, eq=true
PASS A6 → updates=1               PASS A12 → <img alt="an "alt" & <tag>" src="a.png"></img>
PASS A7 → ["__proto__"]           PASS A13 → a < b & c "d" 'e'
PASS A17 → <div><br></br>tail</div>
PASS A19 → true                   PASS A21 → updates=2
unknown Y.Map: validate ok=true       unknown bigint: validate ok=true
unknown function: validate ok=true    unknown NaN: validate ok=true
unknown Date: validate ok=true        unknown undef-in-arr: validate ok=true
```

（B 段实测输出：B1 `updates=1, out="<p>Hello <b>world</b></p>"`、B2 `updates=0`、B3 `"a<!--c-->b"`、
B5 `<e empty="" k="v"></e>`、B6 `"<p>a<!-- note -->b</p>"`、B9 `<ns:item-2.x></ns:item-2.x>`、
B12 `updates=1`、B14 `"a &lt; b &amp; c"`、B15 `stateBytes=2`。）

#### B 段断言 ↔ A 段模板行映射表（R2-M3-a；SA2 攻击点 #3 落实）

> 「同法可重建」的口头承诺废除：下表把**全部证据承载 B 断言**（即 §11.1 P 表引用到的 B 编号）
> 逐条内联为一行式 `check(...)`，与上方 A 段脚本同闭包（同一 `Y` / `check` / `R`），直接拼接到
> 其尾部即可重跑；预期输出见上方 B 段注记、§11.1 对应 P 行及 SA2 评审 V3 复验记录。

| B 断言 | 承载假设 | A 段模板行 | 一行式断言 |
|---|---|---|---|
| B1 | P3/P9 | A6 + A13 | `check('B1', () => { const d = new Y.Doc(); let u = 0; d.on('update', () => u++); const f = new Y.XmlFragment(); const p = new Y.XmlElement('p'); const b = new Y.XmlElement('b'); b.insert(0, [new Y.XmlText('world')]); p.insert(0, [new Y.XmlText('Hello '), b]); f.insert(0, [p]); d.transact(() => { d.getMap('ROOT').set('x', f); }); return `updates=${u} out=${f.toString()}`; });` |
| B2 | P12 | A6（事件计数） | `check('B2', () => { const d = new Y.Doc(); let u = 0; d.on('update', () => u++); d.transact(() => {}); return `updates=${u}`; });` |
| B3 | P14 | A13 | `check('B3', () => { const f = new Y.XmlFragment(); f.insert(0, [new Y.XmlText('a<!--c-->b')]); const d = new Y.Doc(); d.getMap('ROOT').set('x', f); return f.toString(); });` |
| B5 | P11 | A12 | `check('B5', () => { const e = new Y.XmlElement('e'); e.setAttribute('k', 'v'); e.setAttribute('empty', ''); const d = new Y.Doc(); d.getMap('ROOT').set('x', e); return e.toString(); });` |
| B6 | P14 | A12 + A17（嵌套装配） | `check('B6', () => { const p = new Y.XmlElement('p'); p.insert(0, [new Y.XmlText('a'), new Y.XmlText('<!-- note -->'), new Y.XmlText('b')]); const d = new Y.Doc(); d.getMap('ROOT').set('x', p); return p.toString(); });` |
| B7 | P3 | A6（多 set 一事务） | `check('B7', () => { const d = new Y.Doc(); let u = 0; d.on('update', () => u++); const inner = new Y.Map(); inner.set('a', 1); const arr = new Y.Array(); arr.insert(0, ['x', 'y']); d.transact(() => { d.getMap('ROOT').set('m', inner); d.getMap('ROOT').set('arr', arr); d.getMap('ROOT').set('p', ['x', 'y']); }); return `updates=${u} innerA=${d.getMap('ROOT').get('m').get('a')}`; });` |
| B9 | P11（元素名字符集） | A12 | `check('B9', () => { const e = new Y.XmlElement('ns:item-2.x'); const d = new Y.Doc(); d.getMap('ROOT').set('x', e); return e.toString(); });` |
| B12 | P13 | A6 + A21（嵌套 transact 对照） | `check('B12', () => { const d = new Y.Doc(); let u = 0; d.on('update', () => u++); d.transact(() => { d.getMap('ROOT').set('a', 1); d.transact(() => { d.getMap('ROOT').set('b', 2); }); }); return `updates=${u}`; });` |
| B14 | P10 | A13 | `check('B14', () => { const f = new Y.XmlFragment(); f.insert(0, [new Y.XmlText('a &lt; b &amp; c')]); const d = new Y.Doc(); d.getMap('ROOT').set('x', f); return f.toString(); });` |
| B15 | P5 | A10（state 对比）+ A6 | `check('B15', () => { const d = new Y.Doc(); let u = 0; d.on('update', () => u++); d.getMap('ROOT'); const s = [...Y.encodeStateAsUpdate(d)]; return `stateBytes=${s.length} updates=${u}`; });` |

- **B4 / B8 / B10 / B11 / B13 的定性**：设计期脚本的中间对照编号，**不被 §11.1 P 表任何假设
  引用、不承载独立证据**（P1-P18 的证据编号集合 = A1-A23 + 上表 10 条 B 断言 + T1-T14 + 源码
  行号，SA2 V4 已核）；故不进映射表——上表对「证据承载 B 断言」是**完备覆盖**，无重建缺口。
- **SA7 活链路重证归属（R2-M3-b）**：B 段关键断言 **B1 / B2 / B3 / B7 / B12 / B15** 在 SA3 实现
  完成后并入 SA7 活链路验证清单重证（不再依赖 /tmp 原型）：B2（空 transact 零事件）→ U5 空
  entries 路径 + SA2 红线 #10；B7（嵌套 detached 单事务且集成后可读）→ U6/U8；B12（嵌套事务
  归并单 update）→ SA2 红线 #10；B15（`getMap` 惰性创建零事件零 state）→ U5/U9/U10 零事件断言；
  B1/B3（XML 字节往返 / 注释逐字承载）→ U12 语义等价 + revalidate。
- **/tmp 失存风险的兜底**：`/tmp/sa1-*.mjs` 重启即失不复现，由三层覆盖——① SA2 评审 V2/V3 已
  独立复跑并逐字核验（T1-T14 全量 + 9 项 yjs 假设，见 sa2_review.md「评审前独立验证证据」节）；
  ② 本附录 A 段脚本 + 上表一行式断言 + §11.2/§11.3 输出内联 = 仓内可重建基线；③ R2-M3-b 的
  SA7 活链路重证。

### 11.3 附录 B：算法原型对真实 fixture 的验证（T1-T14）

命令：`./node_modules/.bin/tsx /tmp/sa1-proto-materialize.mjs`（原型 = §4 伪代码的直接执行化：
四阶段编排 + union 键集试验 + 逐字 XML 解析器 + copyJsonDomain + E200 边界，fixture 与 SA6 测试
同文本）。实测输出（节选关键行，2026-08-22）：

```
T1 ok=true updates=1 keys=["assets","attachments","audit","keywords"]
T1 assets Y.Map=true img1 Y.Map=true audit Y.Map=true
T1 tags Y.Array=true body Y.XmlFragment=true
T1 attachments plain=["x","y"] notY=true keywords Y.Array=true
T2 ok=true refIsolated=true att=["x","y"] audit=[["createdBy","root"],["createdAt",999]]
T3 body="<p>Hello <b>world</b></p>" semEq=true revalidate=true
T4 ok=false nIssues=1 msg="目标 ROOT 非空（1 键）" updates=0 stateEq=true title=old
T5 ok=false nIssues=1 updates=0 stateEq=true
T6 ok=false identical=true n=3
T7 threw="observer-boom" updates=1 title="t"
T8 ok=true title=b schema=[["lang","vfsl"]] meta=[["docId","m-1"]]
T9 NaN: ok=false（纯值域违规：non-finite number）| Date@map: ok=false（形状错位 … object (Date)）
T10 validate=true materialize=true rootKeys=["__proto__"] get="v"
T11 "<p title=\"a&gt;b\">x<!-- note --><br/>y</p>" → "<p title=\"a&gt;b\">x<!-- note --><br></br>y</p>" revalidate=true
T11 "<![CDATA[a < b]]><e k='v'/>" → "<![CDATA[a < b]]><e k=\"v\"></e>" revalidate=true
T11 "<?pi data?><!--c-->" → "<?pi data?><!--c-->" revalidate=true
T11 "plain &amp; text" → "plain &amp; text" revalidate=true
T11 attr-quote ok=false（XML 解析失败：属性 alt 值含双引号）… stateClean=true
T12 union-ROOT a: ok=true keys=["a"] | b: ok=true keys=["b"]
T13 record-member ok=true carrier Y.Map=true content=["x"]
T14 empty ok=true updates=0 size=0
```

即：§4 算法在真实 derived（vfs3.assets fixture）+ SA6 同源快照上满足 U1-U13 的全部行为锚
（载体 / 键集 / 单事务 / 零写入 / 隔离 / 往返 / observer 边界 / 异型 ROOT / Record '__proto__' /
联合 ROOT / 空 ROOT），13 红灯用例在该算法下预期转绿。临时脚本按 SA6 先例不落仓
（`/tmp/sa1-yjs-verify*.mjs`、`/tmp/sa1-proto-materialize.mjs`）；算法的仓内规范化表达即本文
§4 伪代码，最终裁判是 SA6 冻结测试。

**（R2-M3 补记）** /tmp 原型失存不复现的风险已由三层兜底覆盖：① SA2 评审 V2 整体复跑 T1-T14
且输出与本节逐字吻合、V3 独立自证 9 项 yjs 行为假设（sa2_review.md）；② 附录 A 脚本 + §11.2
「B 段断言 ↔ A 段模板行映射表」内联构成仓内可重建基线；③ 关键断言按 R2-M3-b 并入 SA7 活链路
重证。另：R2 修订后 F6 message 附首真 issue 摘要、rootEntries 联合成员定谳 throw→E200，均
不改变本节任何已登记 T 输出——13 用例无 F6 全拒 message 文本断言、无手造派生物路径，行为
锚点零收窄。

## §12. 契约改动连锁审计 (Contract Change Caller Audit)

**无公共契约改动**：本设计新增公共函数 `materializeRoot` 与两个类型导出（§3.1），不修改任何既有
函数的签名、返回类型、抛错行为或时序；`validateLogicalSnapshot` / `probeRoot` / `carrierOf` /
`extractYjsSnapshot` 全部只读消费。

内部实现件的移动审计（D8，模块私有面，不进包公共 exports）：

| 函数 | 文件 | 改动前 | 改动后 |
|---|---|---|---|
| `makeRefResolver` | `extract.ts:229` → `resolve.ts` | extract.ts 模块私有 | resolve.ts 导出（模块级，非包级）；实现逐字不变 |

| Caller | 文件:行号 | 是否受影响 | 处置方案 |
|---|---|---|---|
| `extractYjsSnapshot`（经 walk 族间接消费） | `extract.ts:62`（`makeRefResolver(derived)` 调用点） | 否（import 来源变更，调用语句不变） | 48 绿用例回归锚；`pnpm exec vitest run packages/doc-runtime/test/` 全绿即证 |
| `materializeRoot`（新增消费者） | `materialize.ts`（§4.1 阶段②） | 新增 | 按 §4.9 契约消费 |

`git grep -n "makeRefResolver" -- 'packages/**/*.ts'` 全量 caller 即上述两处（移动后）。
无 `return→throw` / 同步变异步 / catch 语义变化类改动。

---

### 一致性自检声明

- 「崩溃边界」全文三处口径一致：①②③ 共享 E200（§4.1/§4.8 F9/§6 B10-B11）；④ 零捕获（§4.1/
  §4.7/§4.8 F10/U13）——无任何章节为 ④ 设计 catch。
- 「按快照键迭代」在 §2.1（不对称表）/§4.3（mapEntries）/§4.4（试验短路）/F7/U6 五处同口径。
- 六词域违规词表在 §2.2（INV-9）/§4.5/§4.8 F5 三处一致，且与 extract copyPlainValue 对齐。
- detached 不可读（P2）在 §4.3 rootEntries 论证与 §4.7 D10（事务体不得读 detached）一致。
- 全部 13 用例在 §5 有映射行且各有设计条款 + 实测编号支撑；§10 ALLOW LIST 六文件与正文 §3.2/
  §4.9/§7 一一对应；DENY LIST 与 §1.3「零修改」声明一致。

R2 修订追加（2026-08-22，SA2 MINOR ×3 落实后自检）：

- 「联合 ROOT 成员非 map 形 → throw→E200」三处同口径：§4.3 rootEntries 伪代码（唯一行为定义，
  含递归注释）、§4.3「R2-M1 定谳」段、§4.8 F9（catch 收编）；原矛盾注释已删——grep 复核「非
  map/union 成员跳过」现存出现（定谳段 / §9 汇总表 / 本行）均为对旧文本的引用记录，非行为规格。
- F6 家族 message 四处同口径（均含「首个失败：{声明序首真 issue.message}」）：§4.3 全景表
  union 行、§4.4 union case、§4.3 rootEntries 联合 ROOT 特化、§4.8 F6 行。
- B 段证据链闭环：§11.1 P 表引用的 B 编号集合（B1/B2/B3/B5/B6/B7/B9/B12/B14/B15）与 §11.2
  映射表行集合相等；「同法可重建」口头承诺已改写为指向映射表，无残留。
