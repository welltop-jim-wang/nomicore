# SA2 攻击评审报告 — extractYjsSnapshot 设计（SA1 R1）

**Date**: 2026-08-22
**Verdict（R1 轮；已被文末「R2 复审」取代，现行裁决: pass）**: **reject**（发现 2 个 CRITICAL、3 个 MAJOR 攻击点，需 SA1 出 R2 修订后重审；修订清单见文末「R2 必改项」）
**被审对象**: `wiki/raw/task_doc-runtime-extract-yjs-snapshot_design.md`（SA1 R1，624 行全读）
**审查方式**: 全新视角通读 + 逐条对照 ADR 摘录（relevant_decisions）/ SA6 冻结契约 F1–F10 / 21 用例逐条重推演 + vfsl 源码锚点核对（derived.ts / evaluate.ts / resolve.ts / validate.ts / parser.ts）+ **yjs@13.6.32 独立实测复测**（SA1 的 P 编号证据逐项复验 + 新攻击面探针，命令与输出见附录 B）。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议（修订要求） |
|---|--------|--------|---------|------|
| 1 | **CRITICAL** | §4.5.1 union 试验语义 × Record 形成员 | trialMember 对 map 形成员「按字段声明序检查缺必填字段」，**无 Record 特例**。而求值器（`evaluate.ts:107`，已实证）把 Record 物化为 `{fields:[{name:'<key>', optional:false, node}]}`——`'<key>'` 是 **required** 的字面段名。按 §4.5.1 字面实现，Record 形 union 成员对任何真实 live Y.Map 恒「缺必填 `<key>`」→ **恒软拒、永不接受**（除非动态键恰好叫 `'<key>'`，而该名字在对象语法中不可声明——实证 parse 报错）。违反 ADR-0003 any-of「至少一个成员接受即接受」。**可观测发散反例**（schema 与派生物实证见附录 B-3）：`type ROOT = Record<string, YLeaf<string>> \| { b: YArray<YLeaf<string>> };` + live `{x:'hello', b:'plainstring'}` → 正确语义 member 0 试验 walk 全键通过 → **ok:true** `{x:'hello',b:'plainstring'}`；按 §4.5.1 字面实现 member 0 软拒、member 1 真 issue(`['b']`) → **ok:false**。成员选择同理可漂移（Record 成员应胜时被跳过） | §4.5.1 增补明文：Record 形 map 成员（resolve 后 `fields` 恒为单字段 `'<key>'`）**无「缺失」概念，试验 = 直接 walk（键集即在场集）**——与 §4.3 walk 的 Record 分支对称。R2 必改 |
| 2 | **CRITICAL** | §4.1/§4.3 carrierOf × §4.6 copyPlainValue × §4.8 崩溃边界 | 三节对「非 JSON 纯值直接落在 leaf/plain 位」给出**互斥规格**：`set('bi', 10n)` 实测**成功**且 `get()` 读回 bigint（且经 `Y.encodeStateAsUpdate`+`applyUpdate` 跨端同步后**仍是 bigint**，附录 B-2 E1）；walk 路由下 `carrierOf(10n) = null` → `mismatch()` 的 `actual === null` → `throw UnreachableCarrier` → **E100 'internal'**；而 §4.6 规定 bigint → `plainDomainIssue` 真 issue。同时 §4.8 表声称「carrierOf null \| 公共 yjs API 不可达」——**被实测证伪**（bigint 可达且可跨端传播）。后果：公开可达的用户脏数据被上报为「内部错误（意外异常）」，违背 §4.8 自己的语义契约「该路径命中 = 实现缺陷/不可达输入信号」——运维会去查不存在的引擎缺陷。另：§4.6 的 function/symbol 分支实际**不可达**（实测 `set` 即抛 "Unexpected content type"，附录 B-2 A2/A3），设计未区分可达/不可达子集 | 统一裁决并在 R2 落文：carrierOf 将 bigint 归入 plain 域（返回 `'plain value'`），由 leaf/plain 位 mismatch 或 copyPlainValue 统一产出真 issue（actual 用申报词，见 #4）；§4.8 可达性表改为实证口径（bigint=可达；function/symbol=set 期即抛不可达，保留为防御或删除并说明）；§4.6 标注各分支可达性。R2 必改 |
| 3 | **MAJOR** | §4.6 plain 值深拷贝 × Date/类实例（虚假降级） | 实测 `set('dt', new Date(0))` 成功、本地 `get()` 读回 Date 实例；`carrierOf(Date)='plain value'`（isPlainObjectShallow 通过）→ copyPlainValue 走 object 分支 `Object.keys(Date) = []` → **ok:true 快照 `{}`**——时间戳语义静默蒸发。这是技能立法意义的**伪降级**：plain 位合法值域是 JSON 值，Date 不是正常写入流程应产生的值（正常流程=materializeRoot 管线，未建），它出现即脏数据，应 loud 而非静默投影。设计自身对同类情形自相矛盾：undefined 数组元素 → loud 真 issue（B7），类实例 → 静默 `{}`。附带不一致：`JSON.stringify(new Date())` 经 toJSON 产出 ISO 字符串，与 `Object.keys` 投影 `{}` 都不同——该投影没有任何规范依据 | copyPlainValue 增加「普通对象原型守卫」：`Object.getPrototypeOf(v) === Object.prototype \|\| null` 才走 object 分支，其余（Date/RegExp/Map/Set/类实例）→ plainDomainIssue 真 issue（actual 申报词，并入 #4 词表）；或至少在 §6 B7 显式裁决并给出理由——但静默投影不可接受。R2 必改（含 #4 词表申报） |
| 4 | **MAJOR** | SA8 note-5 裁决：§4.6 plainDomainIssue 的 actual 词（'undefined'/'function'/'symbol'/'bigint'）偏离五值词汇表未申报 | **SA2 裁决：要求补报收编。** 这组词与 D9 的 `'internal'` 同属「词汇表外 actual」，D9 走了显式申报 + SA4 复核流程，而 §4.6 散落在代码注释里零申报——同仓两种纪律。且 #2/#3 修订后这组词将成为**真实可观测输出**（`ExtractIssue.actual` 会真的出现 `'bigint'` 等），冻结契约 F4 的任何偏离按任务纪律（SA6 简报「设计如需偏离必须显式说明并由 SA4 复核」）必须显式走流程 | R2 将 plain 域违规词表并入 D9 同一偏离声明（建议：`'undefined'`/`'bigint'` 实测可达必申报；`'function'`/`'symbol'` 标注 set 期即抛不可达，可降为防御分支或删除；#3 若采纳则增类实例词如 `'object'`/构造名——具体词表由 SA1 定，SA4 复核一并裁决），并在 §10 连锁审计与自检附注登记 |
| 5 | **MAJOR** | §4.5.1 trialMember 缺「成员根载体前置判定」 | §4.5.1 只说「按字段声明序逐字段检查」，未规定试验前先判 live 值对成员根的载体匹配。字面实现有两种病态： **live 非 Y.Map（如 plain 数组/字符串）时对 live 调 `has()/get()`（Y.Map API）→ TypeError → E100 误分类（合法 schema：map 成员 + array 成员联合 `\| YArray<...>`，fold 为 container 形合法，实证可求值）； 全可选字段的 map 成员对任意 plain 值「零字段缺席=零软标记」→ accept:true 但试验从未检查成员根 → 垃圾快照或后续 walk 才炸。注：§5 R2 行的推演（「成员 0 试验 issue 保留」）**隐含假设了载体前置判定成立**，与 §4.5.1 正文脱节——正文与用例推演不一致即是规格空洞的证据 | §4.5.1 增补第一步：「试验 = 先 carrierOf(live) 对成员根期望载体判定（不匹配 → 拒 + 真 issue，与 walk 的 mismatch 同款），再做字段序检查/Record 特例」。R2 必改 |
| 6 | MINOR | §9 协议假设依据可定位性 | P2a-c / P3a-d 依据栏写「（见 bash 会话记录）」——会话记录非仓内存档，SA4 无法定位复验；违反「实测验证须贴命令与输出」的立法精神。本 SA2 已独立复测证实其为真（附录 B-1/B-2 F 行、XF 行），故不据此升级 | R2 将 P2/P3（及任何只写「同上」的行）的命令与关键输出摘录内联进 §9 表格，保证 SA4 可重跑 |
| 7 | MINOR | WalkResult `'undetermined'` 死规格 | §4.5.4 自己论证了 walkUnion 三出口只产 value/issue（出口 3 的回退 walk 递归终止）→ `'undetermined'` 从不被产生；则 §4.3 map/array 通路的 `undeterminedFallback` 与 §4.5.1 非映射成员「undetermined → 软拒」均为不可达死路径。规格噪音会诱导 SA3 实现并测试一个「永不发生」的分支 | 二选一：从 WalkResult 删除 `'undetermined'`（出口 3 内联消化）；或在 §4.3/§4.5.1 三处统一标注「类型完备性防御分支，正确实现下不可达（§4.5.4），到达即实现缺陷信号」。禁止维持现状的三处互相矛盾的叙述（「可能返回」vs「永不向上传播」） |
| 8 | MINOR | §4.6 违规锚定精度 + `__proto__` 键 | plainDomainIssue 锚定声明节点自身 path（如 `['attachments']`），不区分「attachments 本身是 Y.Array」与「attachments 内第 i 个元素是 Y.Map」——排障信息损失。另 `out[k] = ...` 对 own-key `'__proto__'` 不建 own 属性（原型污染/键静默丢失；源头可由对端 wire 解码或 defineProperty 构造） | message 模板携带违规内部位置（如 `(at [1])`）；copyPlainValue 用 `Object.create(null)` 起底或 defineProperty 写键（随 #3 一并处理即可） |

**未成立的攻击（攻过且排除，留档防复审重复劳动）**：
- 探针级联次序/副作用：getMap→getArray→getXmlFragment→getText 全链实测复证（Array/XmlFragment/Text 三种异型 ROOT + 缺席惰性创建零 update 事件）✓；
- 判别式死数据论证：对照 validate.ts:396-407「段 0 仅加速静默接受」实测语义，D5/§4.5.3 论证成立且必要 ✓；
- 深拷贝强制性（P15 原引用）、P16/P22/P7：实测复证 ✓；
- `'<key>'` Record 识别启发式的碰撞安全性：对象语法不可声明字面量 `'<key>'` 字段（parse 报错实证），`fields.length===1 && name==='<key>'` 无碰撞 ✓；
- D8 自建解析器与 resolve.ts walkRefChain 的镜像性（迭代 while + inFlight + next-hop memo）逐行比对一致 ✓；
- §5 的 21 用例映射：本人对全部 21 条独立重推演（含最难的 R2/U2/U3/X2/幸福路径 union 仲裁链），在本报告 #1/#2/#5 修订落地后全部成立 ✓；
- 工程管线（根 typecheck 5 包串联、vitest include、ci.yml matrix 20/24、lock importer、yjs 13.6.32、tsconfig 镜像形状）：全部核对无误 ✓。

## 协议假设依据审查

- **§9 章节存在**：✓（「## §9. 协议假设依据 (Protocol Assumption Evidence)」，含环境、编号表、依据类型分栏）。
- **依据可验证性**：P1/P4/P5/P6/P7/P8/P15/P16/P19/P21/P22/P24 与 S1–S6 均有内联输出或精确源码行引用，且**经本 SA2 独立复测证实**（附录 B）；P2a-c/P3a-d 仅写「见 bash 会话记录」——不可定位（攻击点 #6），但已由本评审代为复测证实，不构成 reject 独立理由。
- **「应该/通常/预计」类无据推断**：未发现。设计的实测断言均给了编号与输出摘录；唯一失实的是 §4.8 的可达性断言（「carrierOf null 公共 API 不可达」被 bigint 实测证伪，攻击点 #2）——这是**依据错误**而非无据。
- **SA4 可重跑性**：本报告附录 B 附上全部复测命令与输出，SA4 可直接重跑核对。

## 错误处理链路审查

（本对象是纯函数库接缝，无 UI/网络；按「静默失败 / 状态闭环 / 降级 / 虚假降级」四维套用）

- **静默失败**：✗ 有两处——(a) Date/类实例静默投影 `{}` 且 ok:true（#3，数据语义蒸发且无任何信号）；(b) bigint 直达 leaf/plain 位被误分类为 E100「内部错误」（#2，错误信号存在但语义域错误，误导排障）。两者均须按修订要求收敛为真 issue。
- **状态闭环**：✓（就「失败必经 `{ok:false, issues}` 返回值」而言）——顶层 catch-all 保证任意内部异常收敛为 E100 四字段 issue，无外抛路径（INV-6 构造成立）；SA6 caller 因此无需 try/catch（§10 审计正确）。但闭环的**语义正确性**被 #2/#5 打破（可达输入落进 E100/TypeError）。
- **降级路径**：N/A（无外部服务依赖；yjs 同进程同步调用）。唯一「降级样」行为是 ROOT 缺席惰性空 map——那是 SA6 F6 冻结契约明文语义，非降级（B1 论证成立，实测零 update 事件复证）。
- **虚假降级识别**：✗ 命中一处——#3 Date 投影 `{}`。判断依据技能三度立法：plain 位的合法值域是 JSON 值，Date/类实例在正常写入流程（未来 materializeRoot 管线）中不应出现，其出现=脏数据/上流 bug，应 loud assert（真 issue），静默投影属「bug 被降级掩盖」。设计对 undefined 数组元素已正确 loud（B7），对类实例漏裁——是疏漏而非决策。

## 红线测试思路（每个漏洞对应的新增 IT 方向）

> 冻结文件 `extract-yjs-snapshot.test.ts` 为 SA6 owned，以下用例建议以**新增补充测试文件**（如 `test/extract-plain-domain.test.ts`、`test/extract-union-trial.test.ts`）落位，或经总控走 SA6 增补流程；断言全部锚定公共接缝可观测输出。

1. **（对 #1）Record 形 union 成员**：
   - schema `type ROOT = Record<string, YLeaf<string>> | { b: YArray<YLeaf<string>> };`（derivedOf 求值——已实证可行）+ live `{x:'hello', b:'plainstring'}` → 断言 `ok:true` 且 snapshot `{x:'hello', b:'plainstring'}`（当前设计规格下会得到 `ok:false, ['b']`——即红灯锚）；
   - 成员选择序：Record 成员与对象成员**均可接受**时（构造两者快照不同的 fixture，如对象成员多一个可选字段），断言声明序前者（Record 视角）胜出。
2. **（对 #2）非 JSON 纯值直达 leaf/plain 位**：
   - `root.set('n', 10n)` 于 leaf 位 → 断言 `ok:false` 单 issue、`expected:'plain value'`、`actual` 为申报词（并断言 `actual !== 'internal'`——防 E100 误分类回归）；
   - 协作可达性用例：源 doc set bigint → `Y.encodeStateAsUpdate`/`applyUpdate` 到新 doc → extract 新 doc，断言同上（锁死「跨端脏数据不得变成内部错误」）。
3. **（对 #3）类实例伪降级**：
   - `root.set('n', new Date(0))` 于 leaf/plain 位 → 断言 `ok:false` 真 issue（actual 为申报词）；对照用例：plain 数组内 `undefined` 元素已 loud（保持）——两者纪律一致。
4. **（对 #5）成员根载体前置判定**：
   - schema `type ROOT = { u: { a?: YLeaf<string> } | YArray<YLeaf<string>> };` + live `u = ['x']`（plain 数组）→ 断言 `ok:false` 单 issue 锚 `['u']`、`expected:'Y.Map'` 或 `'Y.Array'`（按 R2 裁决的仲裁序）、**绝不是** E100 `'internal'`（红灯锚：TypeError→E100 回归）。
5. **（对 #4）词表申报落地后**：对申报的每个 actual 新词各一条最小用例（bigint/undefined/类实例词），断言四字段形状完整（防「省略字段」违约）。

## 特别事项：SA8 note-5 裁决（总控点名）

**裁决：要求补报收编**（攻击点 #4）。理由：① 词表偏离与 D9 `'internal'` 同类，D9 已申报而 §4.6 未申报，同仓纪律不一致；② 本评审 #2/#3 修订落地后该组词成为真实可观测输出，属冻结契约 F4 的实质变更面，必须走「显式说明 + SA4 复核」流程；③ SA6 21 用例未锚定这些值（不产生测试红），若无申报，SA4/SA7 对该行为面将完全失明——申报是唯一防漏手段。不建议「不申报维持现状」选项。

## 结论与 R2 必改项

设计整体质量高（探针级联、深拷贝论证、判别式死数据、两步分离、D8 解析器、§5 映射与工程集成均经独立验证成立），但 union 试验语义与 plain 值域两处核心机制存在**可达输入上的规格空洞/自相矛盾**，SA3 按现文实现必然产生错误分类或 any-of 违约。**Verdict: reject**，R2 必改：

1. §4.5.1：成员根载体前置判定 + Record 形成员特例（#1/#5，CRITICAL+MAJOR）；
2. §4.1/§4.6/§4.8：非 JSON 纯值统一裁决（bigint 可达实证、function/symbol 不可达标注、E100 可达性表更正）（#2，CRITICAL）；
3. §4.6/§6 B7：Date/类实例 loud 化 + 原型守卫（#3，MAJOR）；
4. D9 家族偏离申报：plain 域 actual 词表收编（#4，MAJOR，SA8 note-5 裁决）；
5. §9：P2/P3 证据内联（#6，MINOR）；`undetermined` 死规格统一叙述（#7，MINOR）；锚定精度与 `__proto__`（#8，MINOR，可随 #3 顺手处理）。

修订后只需重审 §4.1/§4.5/§4.6/§4.8/§6/§9 及自检附注，§3/§5/§7/§10/§11 与 21 用例映射无需重做。

---

## 附录 A：SA2 独立核验通过的设计事实（防复审重复劳动）

| 设计断言 | 核验方式 | 结果 |
|---|---|---|
| evaluate.ts:107 Record `'<key>'` 字段 `optional:false`；:89-93 终态 ref 内联（F4）；:56-58 root 入口物化（顶层非 ref） | 读源码 | ✓ |
| derived.ts:26-41 StructureNode 八 kinds / MapField / Record 段名 `'<key>'` | 读源码 | ✓ |
| resolve.ts walkRefChain：迭代 while + inFlight 环守卫 + next-hop memo（D8 镜像声称） | 读源码逐行比对 | ✓ |
| validate.ts:158-160 present()（hasOwn 且非 undefined）；:396-407 判别式段 0「仅加速静默接受，不改变任何输出」 | 读源码 | ✓ |
| parser.ts:23-24 `MAX_TYPE_NESTING = 100` | 读源码 | ✓ |
| 根 package.json typecheck 5 包串联（追加第 6 项正确）；vitest include `packages/*/test/**`；ci.yml node 20/24 + typecheck + test；pnpm-lock importer 就位；yjs 实装 13.6.32；vfsl tsconfig 形状 `{extends, include:["src/**","test/**"]}`；tsconfig.base.json 存在 | 读文件 | ✓ |
| P1 异型 ROOT getMap 抛 + getArray 返回既有；P2 XmlFragment 级联三探；P3 Text 级联四探；P4 惰性创建零 update；P7 keys 插入序覆写不换位；P15 plain get 原引用（含嵌套）；P16 set(k,undefined)→has true；P22 plain 数组内嵌 Y.Map 读回活引用；缺席 getMap 二次同实例 | 附录 B 实测 | ✓ 全部复证 |
| `'<key>'` 字段名在对象语法不可声明（Record 启发式无碰撞） | 附录 B-3 t2 parse 报错 | ✓ |
| Record 形 union 成员 schema 合法可求值（fold map+map=map） | 附录 B-3 t1/t3 | ✓（同时是 #1 的触发前提实证） |

## 附录 B：SA2 复测命令与输出（SA4 可直接重跑）

环境：worktree `packages/doc-runtime/node_modules/yjs`（13.6.32，Node 24.x）。

**B-1 载体与探针**（`cd packages/doc-runtime && node -e "…"`）：

```
P1 getMap on Array-ROOT => THROW: Error: Type with the name ROOT has already been defined with a different constructor
P1 getArray returns existing => 3
P4 update events after lazy getMap: 0 size: 0
P15 same ref: true nested same ref: true
P16 has: true get: undefined
P22 allowed; get(0) instanceof Y.Map: true
P7 keys order: ["b","a","c"]            # 覆写 a 后仍在原位
XF getMap throws => THROW: …different constructor
XF getArray throws => THROW: …different constructor
XF getXmlFragment returns len => 0
F1-F4（ROOT=Y.Text）: 前三级全抛 / getText 返回 'x'
absent getMap twice same instance: true
```

**B-2 攻击面探针（本评审新证据）**：

```
A1 set bigint  => ok          A1 get bigint => bigint     # bigint 直存可达！
A2 set function => THROW: Error: Unexpected content type   # set 期即抛，不可达
A3 set symbol   => THROW: Error: Unexpected content type   # set 期即抛，不可达
B1 insert [undefined,1] => THROW: TypeError … (reading 'constructor')  # Y.Array 元素不可 undefined
C1 get Date instanceof => Date   C2 Object.keys(date-value) => []     # Date 可存可读，Keys 投影空
D1 set [undefined] => ok; get [0]===undefined => true       # plain 数组内 undefined 可达（§4.6 该分支活）
D2 set [10n] => ok; typeof get[0] => bigint                 # plain 数组内 bigint 可达
E1 bigint after sync typeof => bigint                       # 跨端同步后仍为 bigint（E100 误分类可跨端触发）
E2 date after sync ctor => Object                           # Date 跨端退化为 plain Object
```

**B-3 求值器实证**（`tsx -e`，import 自 `@nomicore/vfsl`）：

```
t1: 'type ROOT = Record<string, YLeaf<string>> | { b: YArray<YLeaf<string>> };'
  parse ok:true, evaluate ok:true
  structure.node = union[ map{fields:[{name:'<key>',optional:false,node:leaf}]},   ← #1 触发前提
                          map{fields:[{name:'b',optional:false,node:array{leaf}}]} ]
t2: 'type ROOT = { "<key>": string };'  => parse error: 期望字段名标识符，实际 字符串字面量
t3: 'type ROOT = { a: string } | Record<string, number>;' => evaluate ok（object+record 联合合法）
```

---

# SA2 攻击评审 — R2 复审（2026-08-22）

**Date**: 2026-08-22
**Verdict**: **pass**（R1 八个攻击点全部机制性核销；R2 新引入 2 个 MINOR 级文档残留 R-1/R-2，均为标注/命令文本层修正、不动任何机制，无需再开 SA2 轮次——处置建议见「残留处置」）
**被审对象**: `wiki/raw/task_doc-runtime-extract-yjs-snapshot_design.md`（SA1 R2，705 行全读；重点 §4.1/§4.5/§4.6/§4.8/§6/§9 + 自检附注 + 「SA2 反馈逐条回应」表）
**审查方式**: 对 R2 修订面以全新视角重攻——R2 新依赖断言（Q1–Q5b）逐项独立实测；§4.5.4 递归终止论证前提用求值器实证；21 用例 union 行在 R2 试验语义下重走；§9 内联命令 **verbatim 复跑**；规格残留 grep。

## 一、R1 八攻击点核销表

| R1 # | 严重度 | 核销 | 核验依据 |
|---|---|:--:|---|
| #1 Record 形 union 成员恒软拒（CRITICAL） | CRITICAL | ✅ | §4.5.1 第二步明文「Record 形 map 成员无缺失概念，试验 = 直接 walk（键集即在场集）」，统一表述「试验与提交提取的唯一差异 = 封闭 map 形成员缺必填从跳过变软拒」自洽；触发前提（evaluate.ts:107 `optional:false` + B-3 t1 求值可行 + `'<key>'` 无碰撞）R1 已实证，R2 引用准确。SA2 红线 1 反例（`Record<string, YLeaf<string>> \| { b: YArray<…> }` + live `{x:'hello', b:'plainstring'}`）在 R2 语义下推演：member 0 试验 = walk → 全键 leaf 通过 → 接受 → ok:true ✓ any-of 兑现 |
| #2 carrierOf/bigint 矛盾 + E100 误分类（CRITICAL） | CRITICAL | ✅ | §4.1 重写为两层判定：粗判把 bigint/Date/一切非 Y 对象归 `'plain value'`（结构错位位 actual 恒五值词汇表），细判由 §4.6 copyPlainValue 产真 issue（actual='bigint'，D9②）；§4.8 可达性表按实证口径重写（bigint 三路由可达 → 真 issue，绝不 E100）；R1 错误断言「carrierOf null 公共 API 不可达」已撤。Q1/Q2 独立复测证实（`typeof Y.AbstractType === 'function'` 公共导出——§4.1 兜底行可编译；XmlElement instanceof 矩阵 `false false true false` 借继承命中 XmlFragment）；两层判定对冻结用例无回归（A2 用例 plain 数组于 array 位 → actual 'plain value' 同 R1） |
| #3 Date/类实例静默投影 `{}`（MAJOR，伪降级） | MAJOR | ✅ | §4.6 原型守卫（`proto === Object.prototype \|\| null` 放行，其余 → plainDomainIssue actual='non-plain object' + message 附 constructor 名）+ B13 显式判伪降级；「Date 跨端诚实边界」论证成立——Q5/Q5b 独立复测：本地 `proto !== Object.prototype`（守卫命中），跨端 `applyUpdate` 后 `proto === Object.prototype`、keys `[]`（对端存储的确实是无 Date 性的 plain {}，守卫放行正确——「loud 覆盖可检测的脏数据，不伪造不可检测的洁癖」）。与 B7 undefined 纪律对齐 ✓ |
| #4 plain 域 actual 词表未申报（MAJOR，SA8 note-5 裁决） | MAJOR | ✅ | D9 重写为「词汇表偏离家族统一申报」（①'internal'；②可达 'bigint'/'undefined'/'non-plain object' + 防御 'function'/'symbol'，expected 恒词汇表内）+ §10 R2/#4 登记块（显式请求 SA4 裁决）+ 自检「五处口径一致」声明 + 补充测试文件入 ALLOW（红线 5 四字段形状锚定）。收编落实 ✓ |
| #5 trialMember 缺成员根载体前置判定（MAJOR） | MAJOR | ✅ | §4.5.1 第一步（恒定前置：map 形成员 `carrierOf(live)==='Y.Map'`，不匹配 → 拒+真 issue 与 walk 同款；非 map 形由其 walk 内建）封死两病态；红灯锚推演我复核成立：`{ a?: YLeaf<string> } \| YArray<…>` 对 live `['x']` → member 0 前置拒（`['u']` Y.Map/plain value）→ member 1 walk 拒（Y.Array/plain value）→ exit 2 首真 issue = member 0 的——**非 E100** ✓；§5「R2 同步注记」声明 R1 推演隐含假设已成明文（正文与推演一致化） |
| #6 P2/P3 证据不可定位（MINOR） | MINOR | ⚠️ 部分核销 | §9 P2a-c/P3a-d 已内联命令+输出、内容真实（输出与我 R1/R2 复测逐行一致）；**但内联命令 verbatim 复跑失败**——见新发现 R-1（MINOR 残留） |
| #7 'undetermined' 死规格（MINOR） | MINOR | ✅ | D12 选删除：WalkResult 两结局、map/array 伪代码四处防御分支删除、§4.5.4 重写为「出口 3 内联消化 + 递归终止论证」。grep 实证：全文 7 处 'undetermined' 均为元叙述（D12/§4.3 引言/§4.5.4/自检/回应表），`undeterminedFallback`/`isPlainObjectShallow` 仅存于「已删除」叙述——自检「无残留规格引用」声称属实 ✓ |
| #8 锚定精度 + `__proto__`（MINOR） | MINOR | ✅ | §4.6 `loc` 位置线贯穿递归（`[i]`/`.k` 起 `''`）进 message 不进 path；对象键一律 `Object.defineProperty` 四描述符写入。Q3/Q4 独立复测证实：defineProperty 构造 own `'__proto__'` → yjs set/get 原引用且 hasOwn 保留 → defineProperty 写回 out 后 `JSON.parse(JSON.stringify(out))` own 键保留 ✓（B15） |

## 二、R2 新依赖断言的独立验证（全部通过，SA4 可照附录重跑）

| R2 断言 | 我的复测结果 |
|---|---|
| Q1 `Y.AbstractType` 公共导出（§4.1 兜底行可编译的前提） | ✓ `typeof Y.AbstractType === 'function'` |
| Q2 XmlElement 借继承命中 `instanceof Y.XmlFragment` | ✓ set 后四类矩阵 `false false true false`、AbstractType true、ctor `YXmlElement` |
| Q3/Q4 own `'__proto__'` 键：defineProperty 构造 / yjs 存取原引用 / JSON 往返保留 | ✓ 全部逐行证实（hasOwn true；roundtrip own 键保留） |
| Q5/Q5b Date 本地原型可判、跨端退化为真 plain `{}` | ✓ 本地 `proto !== Object.prototype`；同步后 `proto === Object.prototype`、ctor Object、keys `[]`（与 R1 E2 互证） |
| §4.5.4 递归终止前提（「合法 derived 由 E106 保证」成员图无环） | ✓ 且**更强**：E106 在 **parse 层**即拒绝一切名级环——实测 `type X = Y\|{a}; type Y = X\|{b}`（互引 union 成员）、`type X = X\|{a}`（自引 union 成员）、`type A = {next: A}`（自引 map 字段）三者全部 `PARSE FAIL: VFSL-E106: 循环引用`；前向无环引用（`type A = {next: B}; type B = {v}`）合法。结构树根本无环，walk 递归受结构树深度 + live 数据双重限界——终止论证成立且偏保守 |
| §5 R2 同步注记「21 用例推演结论不变」 | ✓ 我在 R2 试验语义（前置判定 + Record 特例）下重走 R2/U2/U3/X2/幸福路径五行全成立（如 R2 行：三成员前置判定对 plain 对象全拒+issue → exit 2 首真 issue `['assets','img1']` Y.Map/plain value ✓；X2 行：member 0 软拒/member 1 body 真 issue/member 2 软拒 → 首真 issue `['assets','doc1','body']` ✓） |

## 三、R2 新发现（2 项 MINOR，均不阻塞）

**R-1（MINOR）§9 P2a-c/P3a-d 内联命令 verbatim 复跑失败。** 命令文本 `node -e "import('yjs').then(({default:Y})=>{…})"` 中 `({default:Y})` 解构失败：yjs ESM 构建无 default export（诊断：`typeof default: undefined | typeof Doc: function`）→ 实跑 `TypeError: Cannot read properties of undefined (reading 'Doc')`。**证据内容与输出记载均真实**——以 namespace 修正变体 `import('yjs').then((Y)=>{…})` 复跑，输出与 §9 记载逐行一致（`getMap => THROW: …different constructor` / `getArray => THROW` / `getXmlFragment => ok`；P3 同理）。这正是 R1 #6「命令可重跑」的字面要求，修正是一处解构改写。**处置**：SA1 在 SA3 开工前顺手改两行命令文本（`({default:Y})` → `(Y)`）；SA4 复核以修正变体或本评审附录 B 命令重跑。纯文档 touch-up，不动机制，无需再开 SA2 轮次。

**R-2（MINOR）function/symbol 可达性标注三处错误（机制本身正确）。** R2 的 A2/A3 只探了**直接位**（`set('a', fn)` set 期即抛 → 不可达 ✓）；但 plain 容器是不透明引用存储，**嵌套路由可达**——本轮新探针 N1–N3 实测：`set('a', [()=>1])` / `set('b', {k: ()=>2})` / `set('c', [Symbol()])` 全部成功且 `get()` 读回原类型（`typeof => function/symbol`），连 `encodeStateAsUpdate` 也不抛（wire 投影 null，本地存活窗口完整）。因此 §4.6 copyPlainValue 尾分支（`plainDomainIssue('function'/'symbol')`）是**可达真 issue 路径**——伪代码行为正确、词已按 D9② 申报（SA4 词表裁决不受影响）；但三处标注需改判：「直接位不可达（A2/A3）+ plain 子树内嵌可达（N1–N3）」——涉及 §4.6 docblock「不可达防御」、§4.8「function/symbol 落值位 → 不可达 → E100」行（E100 只对应直接位路由）、D9②「不可达防御：'function'/'symbol'」分类。**处置**：随 R-1 一并由 SA1 文档 touch-up 改判，补充测试文件（若落位）应锚定嵌套路由（`set('a',[fn])` → 断言 ok:false 单 issue、actual='function'、非 'internal'）。

## 四、残留处置与建议（非阻塞）

1. **R-1/R-2 文档 touch-up**（SA1，SA3 开工前完成；总控裁量是否过目）：§9 两行命令解构修正；§4.6 docblock / §4.8 行 / D9② 三处 function/symbol 可达性改判。零机制变更。
2. **强烈建议总控落实两份补充测试文件的 SA6 增补流程**（§11 ALLOW 已备位：`extract-plain-domain.test.ts` / `extract-union-trial.test.ts`）：R2 修复的全部行为面（Record 形成员接受、前置判定、bigint/Date/undefined/function 词表与四字段形状、跨端 E1 锚）目前**零测试锚定**——冻结 21 用例不覆盖，补充文件是唯一防回归手段，也是 SA7 回归的锚。
3. **SA4 Phase 3 请对 §10 R2/#4 登记块 + D9 家族一并裁决**（含 R-2 改判后的 'function'/'symbol' 归类：建议移入「可达」组）；SA4 重跑命令以本评审附录 B（require 变体）与 R-1 修正变体（namespace import）为准，勿用 §9 现文本 verbatim。

## 五、R2 复审结论

R1 的 2 CRITICAL + 3 MAJOR + 3 MINOR 全部得到**机制性**修复且经本轮独立实证（Q1–Q5b、E106 终止前提、21 用例重推演、残留 grep）；R2 自检附注的声称逐条属实；回应表与正文修订一一对应无虚报。新发现 R-1/R-2 均为文档标注层（命令文本、可达性标签），不影响任何行为机制、不触碰冻结契约与 21 用例。

**Verdict: pass** —— 同意放行进入 SA3 实现。pass 辖域：设计层面；实现与活链路验证归 SA4（§9 依据可重跑性 + D9 家族裁决 + R-1/R-2 touch-up 确认）与 SA7。

## 附录 C：R2 复审实测记录（命令与输出，SA4 可重跑）

```
# Q1/Q2（cd packages/doc-runtime && node -e）
Q1 typeof Y.AbstractType => function
Q2 set XmlElement => ok；instanceof Map/Array/XmlFragment/Text: false false true false
   | AbstractType: true | ctor: YXmlElement

# Q3/Q4（__proto__ own-key 全链路）
defineProperty 构造 → keys ["__proto__"]、hasOwn true
yjs set/get → same-ref: true、hasOwn after get: true
defineProperty 写回 out → JSON roundtrip: {"__proto__":1} → own 键保留 true

# Q5/Q5b（Date 本地 vs 跨端）
local proto!==Object.prototype: true
remote（encodeStateAsUpdate→applyUpdate）proto===Object.prototype: true, ctor: Object, keys: []

# E106 终止前提（tsx -e，@nomicore/vfsl）
'type X = Y | { a: string }; type Y = X | { b: string }; type ROOT = { u: X };'
  => PARSE FAIL: VFSL-E106: 循环引用: X → Y → X
'type X = X | { a: string }; …' => PARSE FAIL: VFSL-E106: 循环引用: X → X
'type A = { next: A; v: string }; …' => PARSE FAIL: VFSL-E106: 循环引用: A → A
'type A = { next: B }; type B = { v: string }; …' => evaluate ok: true（前向无环合法）

# R-1 诊断与修正（§9 内联命令 verbatim 复跑）
verbatim（({default:Y}) 解构）=> TypeError: Cannot read properties of undefined (reading 'Doc')
诊断: typeof default: undefined | typeof Doc: function
修正变体 import('yjs').then((Y)=>{…}) => getMap THROW / getArray THROW / getXmlFragment ok（与 §9 记载逐行一致）

# R-2 嵌套 function/symbol 可达性（新探针 N1–N3）
N1 set('a',[()=>1]) => ok；get('a')[0] typeof => function
N2 set('b',{k:()=>2}) => ok；get('b').k typeof => function
N3 set('c',[Symbol('s')]) => ok；get('c')[0] typeof => symbol
N4 encodeStateAsUpdate => ok（wire 投影 null：toJSON {"a":[null],"b":{},"c":[null]}）

# 残留 grep（设计文档 R2）
'undetermined' 7 处均为元叙述；undeterminedFallback/isPlainObjectShallow 仅存于「已删除」叙述
```
