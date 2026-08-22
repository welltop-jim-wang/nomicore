# SA1 修订设计（rev1）— readLogicalValueAtPath Phase B union 仲裁 value-first 硬化（Issue #75 / PR #83 owner Review）

- **任务类型**：Bug 修复（owner Review 定性 P1 正确性缺陷；经 SA5 核实在现行结构系统内**结构性不可达**，修订定性 = **行为不变的防御性语义硬化**）
- **worktree**：`/home/wangjian/nomicore-fix-issue-75`（branch `fix/issue-75-on-docs-doc-runtime-validation`，run_id `issue-75-rev-1787397220`）
- **授权链**：rev1 简报 `task_read-logical-value-at-path_rev1.md`（owner Review 全文 + AC-R1..R5）→ SA8 修订轮冲突门禁 `clear`（`task_read-logical-value-at-path_rev1_conflict_report.md`，注记 1–5）→ SA5 故障分析 `20260822-bug-read-logical-value-union-arbitration.md`（结论 (a)/(b)/(c)/(d)）→ SA6 rev1 契约测试 18 绿灯锁入库（`read-logical-value-at-path-rev1-union-arbitration.test.ts`，commit `23851e1`）→ 本设计
- **修订基底**：首轮设计 `task_read-logical-value-at-path_design.md`（D1–D15 / INV-1..11 / C1-C2-C3 分类 / 文件清单**全部继续有效**）。本文件是**增量修订**：只修订受影响条款（§附 A 条款对照表），不重述未变内容；与首轮冲突处以本文件为准。

---

## 摘要（一页看懂）

**缺陷定性**：owner 指认的机理真实存在——`NavOutcome` 两态（read.ts:261）把「实际产出」与「合法缺席」坍缩为同一个 `ok:true`，union 循环（read.ts:343-349）以首个 `r.ok` 短路，策略上允许「前序成员合法缺席遮蔽后序成员实际值」。SA5 四步归谬证明该遮蔽在现行结构系统内**不可达**（缺席三源皆 live 数据事实，成员形状零参与），且现行「首个 ok 胜」与 owner「value-first」仲裁在一切合法输入上**观测等价**。修订因此是**封死病态的策略层硬化**，对合法输入零可观测行为变更——这是本设计一切裁决的地基（§1、§3.5 定理）。

**核心改动**（全部在 `packages/doc-runtime/src/read.ts` 包内，~50 行 delta）：

1. **D16**：`NavOutcome` 两态 → 三态 `{ kind: 'value'; value: unknown } | { kind: 'missing' } | { kind: 'reject' }`（AC-R1；包内私有类型，公共结果联合零改动——SA8 注记 3）；
2. **D17**：union 中段仲裁改 value-first 四规则——首个真实 value 胜；missing 不胜出、继续后序成员；无 value 且有 missing → missing；全 reject → reject（AC-R2；mixed missing+reject 优先级 = missing 胜，SA5 (b)1 裁决成文）;
3. **D18**：成员内结局三分法成文——合法缺席三源 → missing；required 缺席 / 载体错位 / 段型不符 / 成员无此字段 / 终点 issue → reject；与 extract `walkUnion` 提交层仲裁的调和表 + INV-7 精确化 + swap 不变式限域成文（AC-R3；SA5 (b)2/(b)3）；
4. **D13 重述**：memo 值域两态→三态后健全性不变、多项式上界不变（SA8 注记 4）；
5. **公共契约冻结**：签名、两态结果联合、AC3 缺键形态（value 键显式存在）原样——SA6 首轮 20+12 例与 rev1 18 例绿灯锁在硬化后必须保持全绿（AC-R4/AC-R5）。

**为什么必须修一个不可达的缺陷**（SA2 预攻，§1.3 详述）：现行安全性完全寄托于四个结构性事实的合取（live 导航确定性 / 段消耗无跳跃 / 三源缺席皆 live 事实 / E309+yjs undefined 约束）——它们是结构系统的**偶发属性**，不是类型保证；E309 放宽、新增节点 kind、yjs API 演进任一都可能静默打开可达面。硬化把安全性从「事实依赖」升级为「构造保证」，且是 ADR-0003「路径存在性为任一成员出现即存在」在读取维度的逐字兑付（SA8 对照 #2/#3：收紧而非推翻）。

### 决策增量总表

| # | 决策 | 一句话理由 | 详节 |
|---|---|---|---|
| D16（rev1） | `NavOutcome` 三态化：value / missing / reject，包内私有 | 两态的信息坍缩是缺陷根因；owner 建议形态逐字采纳；公共联合冻结（SA8 注记 3） | §3.1 |
| D17（rev1） | union 中段 value-first 仲裁四规则 + mixed 优先级 missing > reject | AC-R2 逐条；SA5 (b)1 成文；与现行行为观测等价（§3.5 定理） | §3.2 |
| D18（rev1） | 成员内结局三分法 + 两层仲裁调和成文 + INV-7 精确化 + swap 限域 | AC-R3 成文义务；SA5 (b)2/(b)3；与 extract INV-8 声明序精神一致 | §3.3 |
| D13 重述（rev1） | memo 值域扩至三态：健全性论证与 O(触及节点数 × 路径长 × 成员扇出) 上界**不变** | SA8 注记 4 强制；value-first 试探集扩大被 memo 吸收 | §3.4 |
| D6/D8/D9/D15（不变，显式复核） | 失败单通道 / 吸收式缺键 / 段形态 / Phase B 零 keyPattern 全部原样 | 修订只动仲裁策略，不动缺席判定与失败归类 | §3.3/§3.6 |

新增不变量：INV-12（三态完备互斥）、INV-13（观测等价）、INV-14（三态不泄漏公共联合）；INV-7 精确化（§3.3）。

---

## §1. 缺陷定性与修订性质（Bug 根因推演）

### 1.1 owner 指认的机理（全部属实）

| 位置 | 现行代码 | 机理 |
|---|---|---|
| read.ts:261 | `type NavOutcome = { ok: true; value: unknown } \| { ok: false }` | 两态坍缩：「实际产出」（含真值）与「合法缺席」（value:undefined）共享 `ok:true`，仲裁器**无法区分** |
| read.ts:323-325 | Record 缺键 `if (v === undefined) return { ok: true, value: undefined }` | 缺席被编码为成功 |
| read.ts:329-334 | optional 缺席 `{ ok: true, value: undefined }`；required 缺席 `{ ok: false }` | 同上（required 已正确归拒） |
| read.ts:343-349 | `for (const m of node.members) { const r = resolveLive(...); if (r.ok) return r; } return { ok: false }` | **首个 ok（含 missing）短路** → 若可达，前序成员合法缺席遮蔽后序成员实际值 |

SA5 结论 (d) 行号复核：三处引注逐行准确。**根因不在行号而在类型**：`NavOutcome` 的信息损失使 union 仲裁器在信息不足下做出 owner 指认的错误决策——类型缺陷独立于可达性存在。

### 1.2 可达性定性与观测等价（SA5 结论 (a)，本设计的地基）

SA5 四步归谬（24 项断言矩阵 + E309/yjs-undefined 探针实证支撑）：

1. **live 导航确定性**：深度 k 处 live 值是 `(ROOT live, segs[0..k-1])` 的纯函数——每步读取仅 `child(live_{k-1}, segs[k-1])`，成员形状零参与；一切存活到深度 k 的成员看到**同一个** `live_k`；
2. **段消耗无跳跃**：容器下钻每层恰耗一段；root/union/ref 委托零消耗；抵达 `i === n` 必经全部 n 段；
3. **`value:undefined` 三源皆 live 缺席事实**（Record `get` undefined / optional 缺席 / `seg >= ya.length`），与成员形状无关；终点 `walk` 快照恒非 undefined（构造点枚举：map→`{}`、array→`[]`、xml→串、leaf/plain→`copyPlainValue` JSON 值域）；yjs 公共 API 造不出显式 undefined 数组元素，map 显式 undefined 值被 D4「`get()===undefined` 视同缺席」先收；E309 在源头禁止标量/容器混合联合；
4. **归谬**：设成员 j 以合法缺席胜出 ⟹ 存在深度 `k < n` 使 `live_k` 在 `segs[k]` 缺席 ⟹ 任一后序成员或在深度 k 前已拒，或到达深度 k 面对同一缺席——**不可能产出真实 value**。∎

**推论（两仲裁策略观测等价）**：(i) 现行首 ok 为真值 X ⟹ X 亦为新策略首真值（此前成员同序同拒）→ 同取 X；(ii) 现行首 ok 为 missing ⟹ 由归谬无任何成员可产真值 ⟹ 新策略落入「有 missing 无 value」→ 同为 `{ok:true, value:undefined}`；(iii) 现行全拒 ⟹ 新策略全 reject → 同 `PATH_NOT_ALLOWED`。分叉面仅存于手造派生物的 E100 域（§3.5 边界成文）。

### 1.3 为什么必须修（不可达 ≠ 不修）

1. **契约义务**：owner Review「Request changes」是 PR #83 合并阻塞项；AC-R1/R2 明文要求三态与 value-first——本设计是该修订的建筑蓝本；
2. **安全性寄托于偶发事实的合取**：四步归谬的每一步都依赖现行结构系统的具体属性（段消耗模型、缺席三源的读取方式、E309 禁令、yjs undefined 约束）。这些是**实现现状**而非**类型不变量**——未来任何一项演化（放宽 E309、新增带异构段消耗的节点 kind、yjs 允许 undefined 元素）都会**静默**打开可达面，且无任何测试能报警（竞争类 fixture 结构性不可构造，SA5 (c) 表）。硬化后，「missing 不胜出」成为构造保证，与上述事实解耦；
3. **策略与文档语义的一致性**：ADR-0003「路径存在性为**任一成员出现即存在**」——若某后序成员能产出值而前序成员缺席短路返回 undefined，即违反该条款。现行代码对该条款的遵守是「侥幸」（靠不可达），修订使其成为「构造性遵守」（SA8 对照 #2：「收紧而非推翻」）；
4. **语义缝隙是真实文档债**：mixed missing+reject 优先级未定义、INV-7「可产出」歧义、swap 不变式范围未成文——三者均为 owner 修订建议明文要求的成文项（AC-R3）；
5. **成本近零**：单文件 ~50 行、公共契约零变化、合法输入行为零变化（定理 + 18 绿灯锁护栏）。

---

## §2. 修订影响面（改动半径）

- **只动**：`read.ts` 的 `NavOutcome` 类型、`navigate` 的结局编码、union 分支仲裁循环、`readLogicalValueAtPath` 尾部三态→两态映射、相关 JSDoc；
- **不动**：Phase A（`isPathAllowed`/`decide`——纯 schema 许可，`members.some()` any-of 语义原样，owner 缺陷只在 Phase B）；`resolveLive` 的 memo 挂点结构（键形不变，值域扩展）；`notAllowed`/崩溃边界/SA4-F2 守卫；`walk`/`walkUnion`/`trialMember`（extract 终点语义逐字继承）；`carrier.ts`；公共 `ReadLogicalValueResult` 与 `index.ts` 导出；`packages/vfsl` 一切源码（SA8 注记 5）。

---

## §3. 修订设计

### 3.1 D16：`NavOutcome` 三态化（AC-R1）

```ts
/**
 * 活导航三态结局（rev1/D16，AC-R1；owner 建议形态逐字采纳；包内私有类型——
 * 公共结果联合冻结为两态，missing/reject 不得泄漏（INV-14，SA8 注记 3））：
 * - value  = 实际产出：路径耗尽处 walk 快照（恒非 undefined，见完备性论证）或中段不下钻场景不产此态；
 * - missing = 合法缺席：且仅由三源产生（Record 缺键 / optional 缺席 / 非负整数越界，D8 三源）；
 * - reject = 本分支拒绝：段型不符 / 载体错位 / required 缺席 / 成员无此字段 / 终点 walk issue。
 */
type NavOutcome =
  | { kind: 'value'; value: unknown }
  | { kind: 'missing' }
  | { kind: 'reject' };
```

**完备性与互斥性（INV-12，仲裁正确性的支点）**：三态必须两两可区分，value-first 才是良定义的——若 `kind:'value'` 可携带 `undefined`，则 value 与 missing 不可区分，仲裁退化为原两态病态。论证：

1. **missing 仅由三源中段缺席产生**（§3.3 三分表），这些分支在产出 missing 前**未做终点转换**；
2. **value 仅由终点 walk 产生**（`i === segs.length` 分支）——`walk` 快照构造点枚举恒非 undefined（map→`{}`/按声明序填充、array→`[]`、xml→`toString()`、leaf/plain→`copyPlainValue` JSON 值域断言；extract.ts:104-134/137-143，SA5 Investigation 第 3 层复核）；到达终点的 live 值在中段每步已过滤 undefined（三源缺席先行拦截）；
3. **reject 无载荷**，与另两态天然可区分。∎

由此 `kind:'value'` 的 `value` 恒非 undefined——这是「首个真实 value 胜出」语义的良定义基础，也是 memo 以 `undefined` 为未命中哨兵仍然安全的基础（memo 存储的是 outcome 对象，非 value 字段）。

### 3.2 D17：union 中段 value-first 仲裁（AC-R2）

`navigate` 修订版全量伪代码（改动处以 `// rev1` 标注；未标注行与现行逐字一致）：

```ts
function navigate(node, live, segs, i, resolveS, fullPath, memo): NavOutcome {
  if (i === segs.length) {
    const r = walk(node, live, [...fullPath], resolveS);        // D7 终点委托（零改动）
    return r.kind === 'issue' ? { kind: 'reject' }              // rev1：终点 issue = reject
                              : { kind: 'value', value: r.snapshot }; // rev1：快照恒非 undefined（INV-12）
  }
  const seg = segs[i]!;
  switch (node.kind) {
    case 'root':
      return resolveLive(node.node, live, segs, i, resolveS, fullPath, memo);
    case 'map': {
      if (typeof seg !== 'string') return { kind: 'reject' };            // rev1：段型不符（D9 自校验义务不变）
      if (carrierOf(live) !== 'Y.Map') return { kind: 'reject' };       // rev1：载体错位（C2/成员回退）
      const ymap = live as Y.Map<unknown>;
      const first = node.fields[0]!;
      if (isRecordForm(node)) {
        // D15/R1 不变：Phase B 有意零 keyPattern 检查（§4.5 反例走查仍成立，本修订不触）
        const v = ymap.get(seg);
        if (v === undefined) return { kind: 'missing' };                // rev1：Record 缺键（D8 三源之一）
        return resolveLive(first.node, v, segs, i + 1, resolveS, fullPath, memo);
      }
      const f = node.fields.find((x) => x.name === seg);
      if (f === undefined) return { kind: 'reject' };                   // rev1：本成员无此字段（D15/D18）
      const v = ymap.get(seg);
      if (v === undefined) {
        return f.optional ? { kind: 'missing' }                         // rev1：optional 缺席（D8 三源之一）
                          : { kind: 'reject' };                         // rev1：required 缺席（C2，三分法不变）
      }
      return resolveLive(f.node, v, segs, i + 1, resolveS, fullPath, memo);
    }
    case 'array': {
      if (typeof seg !== 'number' || !Number.isInteger(seg) || seg < 0) return { kind: 'reject' }; // rev1（D9）
      if (carrierOf(live) !== 'Y.Array') return { kind: 'reject' };     // rev1
      const ya = live as Y.Array<unknown>;
      if (seg >= ya.length) return { kind: 'missing' };                 // rev1：非负整数越界（注记 A/D8 三源之一）
      return resolveLive(node.element, ya.get(seg), segs, i + 1, resolveS, fullPath, memo);
    }
    case 'union': {
      // rev1/D17：value-first 仲裁（AC-R2 四规则；INV-7 精确化——声明序迭代不变）
      let sawMissing = false;
      for (const m of node.members) {                                   // 声明序（INV-7，零改动）
        const r = resolveLive(m, live, segs, i, resolveS, fullPath, memo);
        if (r.kind === 'value') return r;                               // 规则 1：首个真实 value 胜出
        if (r.kind === 'missing') sawMissing = true;                    // 规则 2：missing 不胜出，继续后序成员
      }
      return sawMissing ? { kind: 'missing' } : { kind: 'reject' };     // 规则 3/4 + mixed 优先级（§3.3）
    }
    case 'leaf': case 'plain': case 'xml-fragment':
      return { kind: 'reject' };                                        // rev1：终态下钻（Phase A 已拒，防御）
    case 'ref':
      throw new Error('不可达：ref 应已由 resolveS 解析（手造派生物）'); // C3（零改动）
  }
}
```

**owner 四规则逐条对照**：

| owner 规则 | 本设计落点 | 判定 |
|---|---|---|
| 1. 首个真实 value 胜出 | union 分支 `if (r.kind === 'value') return r;`（声明序循环内） | ✅ |
| 2. 前序成员只得到 missing 时继续尝试后续成员 | `sawMissing` 只记账不返回；循环不因 missing 中断 | ✅ |
| 3. 所有**可行**成员均只能得到 missing → `ok:true, value:undefined` | 循环耗尽且 `sawMissing` → `{kind:'missing'}` → 顶层映射 `{ ok: true, value: undefined }`（value 键显式构造，FC-3） | ✅（「可行成员」形式化见 §3.3） |
| 4. 全部成员 reject → `PATH_NOT_ALLOWED` | 循环耗尽且无 missing → `{kind:'reject'}` → `notAllowed(...)` | ✅ |

**顶层三态→两态映射**（`readLogicalValueAtPath` 尾部，rev1）：

```ts
    // Phase B：活数据解析 + 定点转换（rev1：三态收束到冻结两态公共联合）
    const r = resolveLive(derived.structure.node, probe.map, path, 0, resolveS, path, memoB);
    if (r.kind === 'value') return { ok: true, value: r.value };        // FC-3：value 键恒显式构造
    if (r.kind === 'missing') return { ok: true, value: undefined };    // rev1：合法缺席（FC-3 同款显式构造）
    return notAllowed(path, '路径无法在 live 数据上解析（不变量外输入）'); // rev1：reject → C2 单通道（D6 不变）
```

`memoB` 类型注解形不变（`Map<StructureNode, Map<unknown, Map<number, NavOutcome>>>`），值域随 `NavOutcome` 扩展（§3.4）。

### 3.3 D18：优先级成文与两层仲裁调和（AC-R3）

#### 3.3.1 成员内结局三分法（normative）

单一成员在单段导航步上的结局**完备**归类：

| # | 情形 | 结局 | 依据 |
|---|---|---|---|
| M1 | Record 键缺席（`ymap.get(seg) === undefined`） | **missing** | D8 / AC3 白名单 / ADR-0007「合法 Record 缺失返回 undefined」 |
| M2 | optional 字段缺席 | **missing** | D8 / AC3 白名单 / ADR-0007「合法 optional 缺失返回 undefined」 |
| M3 | 非负整数越界（`seg >= ya.length`） | **missing** | 注记 A / AC3 白名单（格式合法越界 = 合法缺失） |
| M4 | **required 字段缺席** | **reject** | AC3 白名单**不含** required；不变量外活数据态（C2，open 期校验后不可达）；2026-05-07 立法「拒绝虚假降级」——把不变量破坏冒充合法缺席是静默降级，禁止 |
| M5 | 载体错位（`carrierOf(live)` ≠ 期望） | **reject** | C2（非 union 场景）/ 成员回退信号（union 场景，D9） |
| M6 | 段类型不符（number 上 map/Record、负数/非整数下标、string 上 array） | **reject** | D9 + Phase B 段型自校验义务（首轮 §4.4，不变） |
| M7 | 封闭成员无此字段（union 位） | **reject** | D15：Phase A 已按 any-of 键空间并集放行，本成员让位后序成员 |
| M8 | 终点 `walk` 返回 issue | **reject** | D7/D6 单通道 |
| M9 | 终点 `walk` 返回快照 | **value** | INV-12（快照恒非 undefined） |
| M10 | 终态（leaf/plain/xml）下钻 | **reject** | Phase A 已拒，防御性（C3 域） |

#### 3.3.2 union 组合优先级（normative）：**value > missing > reject**

- 任一成员产出 value → **声明序首个 value 胜**（规则 1；value 重叠平局按声明序取首者——与 ADR-0003 no-match 诊断「平局按声明序」精神同源）；
- 无 value 且存在 missing → **missing**（规则 3；**mixed missing+reject 裁决**：reject 成员**非可行成员**，其存在不否决 missing 结局——SA5 (b)1 成文，实证 5a/5c：`{foo?: YLeaf} \| {bar: YLeaf}` + live `{}` 读 `['x','foo']` → `undefined` 非 `PATH_NOT_ALLOWED`）；
- 全体成员 reject → **reject**（规则 4 → 顶层 `PATH_NOT_ALLOWED`）。

**「可行成员」（owner 规则 3 术语）形式化定义**：可行成员 = 产出 value 或 missing 的成员（= 非 reject 成员）。由 INV-12 三态完备性，「可行」无第四种取值；规则 3 由此严格化为 `∃ missing ∧ ¬∃ value → missing`。

#### 3.3.3 与 extract `walkUnion` 声明序规则的调和成文（AC-R3 第二半句）

两层仲裁各自闭合，以**路径耗尽**为唯一接缝：

| 维度 | extract `walkUnion`（**提交层**，INV-8，extract.ts:158-175） | read `navigate` union 分支（**导航层**，rev1/D17） |
|---|---|---|
| 回答的问题 | 哪个成员的**整子树投影**提交入快照 | 哪个成员能**沿路径产出值** |
| 首选 | 首个**接受者**胜（声明序，any-of） | 首个**真实 value** 胜（声明序，any-of） |
| 成员缺必填（试验） | **软拒**（置标记不中断；全软拒回退成员 0 提交提取——「结构不裁决，逻辑相位报缺必填」） | **reject**（导航层无「回退成员 0 再提取」相位——中段缺必填使该成员无法承载该路径） |
| 全拒结局 | 声明序首个真 issue / 全软拒回退成员 0 | 全 reject → 顶层 `PATH_NOT_ALLOWED`（D6 单通道，读取无 issue 词汇） |
| 声明序角色 | 平局裁决（重叠成员投影分歧的确定性来源） | 平局裁决（value 重叠取首者）+ 迭代序（INV-7） |
| 判别式 | 零读取（D5/INV-4） | 零读取（INV-4 维持——三态与 value-first 均不消费 `discriminator`） |

**一致性论证**（三层）：

1. **平局裁决精神同源**：两层都以声明序为重叠分歧的确定性裁决——ADR-0003「重叠成员不构成错误」要求 any-of 语义，而 any-of 在成员产出分歧时必须有一个确定性 tie-breaker；两层选用同一 tie-breaker（声明序首者），不存在「read 层与 extract 层对同一 live 选不同成员」的策略分歧面；
2. **接缝单一**：中段仲裁归 `navigate`，终点（`i === n`）仲裁归 `walk → walkUnion`——同一次读取内两层不重叠、不嵌套竞争；终点语义经 `walk` 委托**逐字继承** extract（SUP-1 XML 情形 + AC6-19 ground truth 交叉锁维持，AC-R5）；
3. **软拒/reject 不对称是问题差异的忠实反映，不是矛盾**：提交层必须为整子树产出点什么（快照要完整，缺必填留给逻辑校验相位报），导航层只需回答本路径能否产出——中段缺必填即「此成员承载不了此路径」。两态以「路径是否耗尽」为界，边界即 `walk` 委托点。

**INV-7 精确化**（normative 措辞立法，行为不变——SA5 (b)2）：

> **INV-7（rev1 精确化）**：union 导航/试验声明序确定性——成员恒按声明序迭代；导航层「首个可产出者胜」精确化为「**可产出 = 产出真实 value（`kind:'value'`）**；missing 不构成胜出，仅记入可行缺席集合」；value 平局按声明序取首者。提交层（extract `walkUnion`/INV-8）「首个接受者胜」语义不变。

**swap 不变式限域**（normative 成文——SA5 (b)3，SA8 注记 2）：

> **swap 不变式（rev1 限域）**：交换 union 成员声明序不改变读取结果，**仅当**读取终点为叶子/标量（含 plain 整读）的多段读成立（SA5 6c/6d 实证域）；终点为 union 自身的整树投影，在重叠成员上交换序**合法改变**结果（SA5 6a/6b：`{foo:"v",bar:"w"}` 两序分别投影 `{foo:"v",bar:"w"}` 与 `{foo:"v"}`）——这是 ADR-0003 重叠合法性 + 提交层声明序平局裁决的必然推论。**任何实现不得对终点=union 的重叠投影承诺 swap 不变**；SA6 R5 组已按此限域落测（`⛔ 禁写断言` 注记在案）。

### 3.4 D13 memo 健全性重述（SA8 注记 4 强制）

三态化改变 memo 的**值域**（两态 → 三态）与 union 分支的**试探集**（首 ok 短路 → value 短路），健全性与成本上界重述如下：

**健全性**：memo 语义成立的条件是「键完全决定值」。Phase B 键 = `(resolve 后节点引用, live 引用, 深度 i)`，导航结果只依赖这三者与 `segs[i..]`（per-call 固定）与 `resolveS`（确定性纯函数）——该条件**与结局编码无关**：`navigate` 是该键的纯函数这一性质在两态与三态下同等成立（三分法 §3.3.1 是对纯函数值域的重新划分，不引入新的依赖面）。union 节点自身的组合结局（value-first 聚合）同样只依赖成员结局的确定序列 → 仍是纯函数 → memo 命中返回等价结果。**结论：健全性论证原样成立，零新假设。**

**成本上界（不变）**：

| 项 | 修订前（首 ok 短路） | 修订后（value-first） |
|---|---|---|
| 单次 union 节点访问的成员试探数 | 最坏全体成员（全拒时不短路） | 最坏全体成员（无 value 时不短路）——**同一最坏界** |
| 相异 (节点, live, i) 三元组数 | ≤ 触及节点数 × 路径长 | ≤ 触及节点数 × 路径长（键形不变） |
| 总上界 | **O(触及节点数 × 路径长 × 成员扇出)** | **O(触及节点数 × 路径长 × 成员扇出)**（同式） |
| 「首 ok = missing」场景 | 立即短路，后序成员零试探 | 后序成员继续试探——合法输入上**必然空手**（归谬第 4 步：后续成员不可能产出 value，至多再记 missing/reject），每次试探 O(1) memo 命中摊销 |

试探集扩大只影响**常数因子**（原本被 missing 短路跳过的后序成员现在被试探，但每个 (节点, live, i) 至多计算一次），不改变渐近界。**SUP-2 护栏（22 层重叠联合 + 末段全拒/required 缺席路径 <2s）维持有效**：该构造的最坏路径本就不含 missing 短路受益（成员全 reject/required-reject），value-first 下试探集与原最坏情形相同。ADR-0007「普通读取成本与目标 path 子树规模相关」条款继续满足。

### 3.5 观测等价定理与硬化风险清单（SA5 (b)4）

**定理（观测等价）**：对一切合法输入（合法 derived（parseVfsl+evaluate 产物）× 任意 live doc）且不触发崩溃边界（E100）的调用，修订前后 `readLogicalValueAtPath` 返回**逐字相同**的结果。

*证明*（三 case，引 §1.2 推论）：设旧仲裁 O（首个 `ok:true` 短路）与新仲裁 N（value-first）。
- **Case 1**：O 在成员 j 返回真值 X（j 前全 reject）⟹ N 在 j 前见同序同 reject，j 处同 value ⟹ N 亦返 X；
- **Case 2**：O 在成员 j 返回 missing ⟹ N 继续试探 j+1..——由四步归谬第 4 步，后续成员不可能产出 value（存活者面对同一缺席 live_k，至多 missing/reject）⟹ N 终局 `sawMissing=true` → missing ⟹ 顶层同为 `{ok:true, value:undefined}`；
- **Case 3**：O 全拒 ⟹ 成员结局 reject 映射不变 ⟹ N 全 reject ⟹ 同 `PATH_NOT_ALLOWED`。∎

**边界（诚实行文）**：定理的 Case 2 在「成员 j 见缺席而某后序成员能产出 value」的输入上会分叉——四步归谬证明该输入在段消耗无跳跃 + live 导航确定性下**不可构造**，唯一逃逸面是**手造派生物**（锁步断裂、零成员 union 等违规形状使 `navigate`/`walk` throw）——属 E100 防御域（C3），非契约面。合法 derived 经 evaluate 锁步物化构造性排除。

**硬化风险清单**（normative，实现与评审对照）：

| # | 风险 | 定性 | 处置/验证锚 |
|---|---|---|---|
| H-1 | value-first 扩大成员试探集（首 ok=missing 后继续试探） | 成本面：渐近界不变、常数因子微增；合法输入上后序试探必然空手 | §3.4 重述；SUP-2 维持 |
| H-2 | 手造派生物 E100 面轻微扩大：新增试探可触及旧短路跳过的违规分支（lockstep 断裂成员、深层零成员 union）→ throw 先于旧实现暴露 | 防御域（C3，非契约面）：顶层 catch（D11）+ SA4-F2 守卫不变，仍结构化返回 | §3.5 边界成文；INV-3 维持 |
| H-3 | 三态泄漏公共联合（实现者诱惑：把 missing/reject 加进 `ReadLogicalValueResult` 或 issues 体系） | 契约面禁止 | INV-14（§6 不变量表）；SA8 注记 3；test-d 冻结形态锁 |
| H-4 | 实现把 required 缺席（M4）误归 missing（软化 C2） | 行为面：违反首轮 D6 + 拒绝虚假降级立法 + SUP-2 Phase B 锁（required 缺席路径 → `PATH_NOT_ALLOWED` 非 undefined） | §3.3.1 三分表 M4；SUP-2 既有锁 |

### 3.6 不变项显式复核（修订不触的首轮裁决）

- **D6 失败单通道**：reject 顶层归宿仍是 `PATH_NOT_ALLOWED`（C1/C2/C3 分类与 message 措辞零改动）；
- **D8 吸收式缺键**：三源缺席语义不变，仅编码从 `{ok:true,value:undefined}` 改为 `{kind:'missing'}`——顶层映射后公共形态逐字复原（FC-3 value 键显式构造）；
- **D9/D15/D7/D10/D11/D12/D14**：段形态、Phase B 零 keyPattern、终点委托、plain 终态、崩溃边界、空路径、Phase A 先行——全部零改动；
- **Phase A**：`isPathAllowed`/`decide` 一字不动（owner 缺陷只在 Phase B；Phase A `members.some()` 是 ADR-0003 存在性语义的逐字实现，修订不触）。

---

## §4. 测试映射（AC-R4 / AC-R5）

SA6 rev1 契约测试（18 例，已入库 commit `23851e1`，全部绿灯行为锁）按 SA5 结论 (c) 可构造性表落测——本设计与其逐组对账：

| 组 | 例数 | 锁定行为 | 本设计落点 | 硬化后保持绿的理由 |
|---|---|---|---|---|
| R1 Record 缺键 vs 后序在场 | 4 | 两序读 `['x','foo']` 均返回真值 `"v"`；真缺席 → 显式 undefined；extract ground truth 交叉锁 | §1.2 归谬 + §3.2 规则 1 | 在场合键 Record 成员直读真值（owner 反例前提不成立）；value-first 首 value 即此真值 |
| R2 optional 缺席 vs 后序在场 | 3 | 两序在场 → `"v"`；缺席 → 显式 undefined | 同上 | optional 成员对在场值直读；缺席时两成员同见缺席 |
| R3 数组越界 vs 后序可解析 | 3 | `[]`/`["v"]` 两序：越界 → 显式 undefined，界内 → `"v"` | §3.2 array 分支 + §3.3.1 M3 | 数字段仅数组成员接受（D9），同界同判 |
| R4 全体可行成员合法缺席 | 4 | 全 missing → `{ok:true, value:undefined}`（value 键显式存在断言）；**含 mixed missing+reject → missing 胜** | §3.2 规则 3 + §3.3.2 mixed 裁决 | 规则 3 的直接锚；mixed 裁决与 SA5 实证 5a/5c 一致 |
| R5 swap 限域（终点=叶子/标量） | 4 | 两序派生物同 live 同路径结果 `toEqual` 逐字一致 | §3.3.3 swap 限域 | 终点=叶子时 value-first 与首 ok 胜同取首真值（定理 Case 1） |

**AC-R4 判定**：owner 五类要求全部落测——前三类按 SA5 (c) 降级为绿灯行为锁（竞争在结构系统内不可构造红灯，**不得虚构 fixture、不得放宽结构系统**——SA5 Fix direction 明文 + SA8 注记 1），第四/五类直接落测/限域落测。可选补充锚点（SA4/SA7 裁量，SA3 不编写）：mixed 反序（reject 先、missing 后：`{bar: YLeaf} \| {foo?: YLeaf}` + live `{}` 读 `['x','foo']` → undefined）——落点文件见 §7 ALLOW 可选项。

**AC-R5 判定**：首轮 `read-logical-value-at-path.test.ts`（20 例）+ `-supplementary.test.ts`（12 it，SA5 实测口径 48/48 含 it.each 展开）+ extract 5 文件基线——由观测等价定理（§3.5）保证零回归；SUP-1 XML 情形走终点 `walkUnion`（提交层仲裁），不经中段 union 循环，且成员 0 以真实 value（XML 串）胜出的机制在 value-first 下不变（SA8 对照 #7）。**全绿护栏 = 等价定理的行为锚**：任一用例转红即为定理被实证推翻，必须按真实状态上报而非调测试迁就实现。

---

## §5. 协议假设依据 (Protocol Assumption Evidence)

**无新增协议级假设**：本修订是纯包内类型/控制流重构（无 HTTP/WS/端口/进程/第三方库行为假设）。仲裁正确性依赖的既有行为假设及其依据：

| 假设 | 依据类型 | 依据内容（具体引用） | 风险 |
|---|---|---|---|
| `Y.Map.get(键缺席)` 返回 undefined，`v === undefined` 可作缺键判据 | 源码引用 + 现有测试 | extract.ts L105/L115/L118（D4 缺失检测先行全部现存用法）；首轮设计 §9 同款；48 用例基线绿 | 低 |
| `Y.Array` 界内 `get(i)` 恒非 undefined（显式 undefined 元素公共 API 不可构造） | 设计期实测验证 | SA5 yjs-undefined 探针：`Y.Array.insert([undefined])` → `Cannot read properties of undefined (reading 'constructor')`；read.ts:340 越界是数组上唯一 undefined 源 | 已消除 |
| 终点 `walk` 快照恒非 undefined（INV-12 支点） | 源码引用 + 设计期实测验证 | extract.ts L104-112（Record→`{}`）/L115-123（封闭→`{}`）/L128-134（数组→`[]`）/L137-138（xml→串）/L140-143+copyPlainValue（JSON 值域）；SA5 24 矩阵全 PASS | 已消除 |
| map 显式 undefined 值（`set('foo', undefined)` 可存）= D4 缺席 | 设计期实测验证 | SA5 探针 b1：读 `['x','foo']` → `ok:true, value=undefined`；与 extract walk 跳过 undefined 值（extract.ts:107/118）两成员同见同判 | 已消除 |
| 标量/容器混合联合被结构系统源头拒绝（归谬第 3 步辅助） | 设计期实测验证 | SA5 E309 探针：`{ foo?: YLeaf } \| YLeaf` → `VFSL-E309: 同步物化上下文混合联合：标量形与容器形并存` | 已消除 |
| memo 哨兵 `hit !== undefined` 在三态值域下仍安全 | 源码引用 | memo 存储 outcome 对象（read.ts:277-278）；`kind:'value'` 的 value 字段恒非 undefined（INV-12）不参与哨兵判定 | 低 |

## §6. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数/接缝

| 接缝 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `NavOutcome`（包内私有类型） | `packages/doc-runtime/src/read.ts:261` | `{ ok: true; value: unknown } \| { ok: false }` | `{ kind:'value'; value: unknown } \| { kind:'missing' } \| { kind:'reject' }`（仍包内私有，INV-14） |
| `navigate` / `resolveLive`（包内私有） | `packages/doc-runtime/src/read.ts:295/267` | 返回两态 `NavOutcome` | 返回三态 `NavOutcome`（签名形不变，值域扩展） |
| `readLogicalValueAtPath`（公共） | `packages/doc-runtime/src/read.ts:41` | `(derived, doc, path) → ReadLogicalValueResult`，同步、不抛错 | **契约零改动**——签名/返回类型/语义逐字不变（观测等价定理 §3.5） |

**公共契约改动 = 无**：不新增 throw 路径、不改同步性、不改 nullable 性、不扩联合形态——五类契约改动逐项为零。三态化限于包内 `NavOutcome`（SA8 注记 3）；missing/reject 不并入公共联合、不并入 issues 体系（ADR-0007「不合并成巨型 issue 类型」）。

### Caller 清单

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| `NavOutcome` 消费者 | 仅 `read.ts` 内部（`navigate` L304-357 / `resolveLive` L277-291 / `readLogicalValueAtPath` L79） | 同步 | —（包内） | 顶层 try/catch（D11） | 三处消费点随本设计同步改写（§3.2）；包外零消费者（模块私有类型，未导出） |
| `readLogicalValueAtPath` 存量 caller | SA6 三测试文件：`read-logical-value-at-path.test.ts` / `-supplementary.test.ts` / `-rev1-union-arbitration.test.ts`（`grep -rn "readLogicalValueAtPath" packages/ apps/` 仅命中测试与 index.ts 转出口） | 否（同步） | 测试内 `expect` | — | 行为零变化（定理），66 例绿灯锁即回归护栏；无 caller 侧改动义务 |
| `walk`/`makeRefResolver` 包内消费者 | `read.ts` L24 import、L306/L51 消费 | 同步 | 顶层 catch | ✅ | 消费方式零改动（终点委托形态不变） |

**风险评估**：改动半径 = 包内私有类型的值域 + 三处包内消费点；公共 API 面零变化；不存在 return→throw / 同步→异步 / nullable→non-null 类 rippling。

---

## §7. 不变量增量表（并入首轮 INV-1..11）

| # | 不变量 | 验证锚 |
|---|---|---|
| INV-7（精确化） | union 导航声明序确定性；「可产出 = 产出真实 value」；missing 不构成胜出；value 平局按声明序取首者。提交层 INV-8 不变 | rev1 R5 组；SUP-1 |
| INV-12（rev1） | 三态完备互斥：`navigate` 一切出口必居 value/missing/reject 之一；`kind:'value'` 的 value 恒非 undefined；missing 仅由三源产生（M1-M3），reject 仅由 M4-M8/M10 产生 | §3.1 论证；rev1 R1-R4 组（value 键显式存在断言） |
| INV-13（rev1） | 观测等价：合法输入上修订前后公共结果逐字一致 | §3.5 定理；66 例全绿护栏 |
| INV-14（rev1） | 三态不泄漏：`NavOutcome` 包内私有；missing/reject 不进公共联合、不进 issues 体系；顶层映射恒收束到冻结两态 | test-d 冻结形态；SA8 注记 3 |

---

## §8. 文件清单（File Scope）

> 对账基线建议：rev1 修订轮以 `23851e1`（rev1 门禁档案与 SA6 契约入库点）为 diff 基线——**§8.1 即该基线下的预期改动面**。若 SA4 采用 origin/main 基线，PR #83 全程面 = §8.1 ∪ §8.2（首轮已评审落地，非本轮新增改动）。

### 8.1 ALLOW LIST（rev1 修订轮改动面）

- `packages/doc-runtime/src/read.ts` — 修改（~50 行 delta）：`NavOutcome` 三态化（D16）+ `navigate` 十处结局编码改写 + union 分支 value-first 仲裁（D17）+ 顶层三态→两态映射 + JSDoc（§3.1/§3.2）
- `packages/doc-runtime/package.json` — 修改（1 行）：version patch bump `0.1.2 → 0.1.3`（流水线硬门禁 #9：改过代码的模块必须 bump；#72/#73/#75 首轮发版惯例；仅 version 字段）
- `packages/doc-runtime/test/read-logical-value-at-path-rev1-union-arbitration.test.ts` — `[SA6 owned]` 已入库 18 绿灯行为锁（commit `23851e1`）。SA3 不得改断言逻辑；仅允许测试基础设施级修复
- `packages/doc-runtime/test/read-logical-value-at-path-rev1-hardening.test.ts` — 新建（**可选**，SA4/SA7 裁量按 §4 可选锚点落地：mixed 反序绿灯锁；SA3 不编写测试）

### 8.2 ALLOW LIST（PR #83 首轮已落地面——本轮零新改动，仅供 origin/main 基线对账）

- `packages/doc-runtime/src/index.ts` — 首轮落地（`readLogicalValueAtPath` + 类型转出口）；rev1 **零改动**（公共契约冻结）
- `packages/doc-runtime/src/extract.ts` — 首轮落地（`walk`/`makeRefResolver` 包内导出，≤8 行）；rev1 **零改动**
- `packages/vfsl/src/index.ts` — 首轮落地（`compilePattern`/`matchPattern` 公共接缝）；rev1 **零改动**（SA8 注记 5）
- `packages/vfsl/package.json` — 首轮 version bump `0.2.2` 已落地；rev1 **零改动**（vfsl 源码本轮零改动，无 bump 义务）
- `packages/doc-runtime/test/read-logical-value-at-path.test.ts` / `read-logical-value-at-path.test-d.ts` / `read-logical-value-at-path-supplementary.test.ts` — `[SA6 owned]` 首轮冻结契约 + 补充锚点；rev1 零改动

### 8.3 DENY LIST

- `packages/vfsl/src/**`（pattern.ts / evaluate.ts / derived.ts / validate.ts / envelope.ts 等）— SA8 注记 5 + 首轮 DENY；**结构系统不得为「凑红灯测试」虚构可达性而放宽**（SA5 Fix direction 明文；E309 等禁令是归谬成立的前提事实，必须保持）
- `packages/doc-runtime/src/extract.ts` / `carrier.ts` / `index.ts` 的任何 **rev1 新增改动** — 终点语义/载体判定/公共接缝冻结（§2、§8.2 注记：三文件在 PR diff 中的出现属首轮已评审范围）
- `packages/doc-runtime/src/read.ts` 中 Phase A（`isPathAllowed`/`decide`/`makeValuesResolver`/`vChild`/`keyAllowed`）、`notAllowed`（含 SA4-F2 守卫）、顶层 try/catch 编排 — 本修订明文不触（§3.6）
- `packages/doc-runtime/test/extract-*.test.ts`（5 文件）— #73 回归基线，不动
- `packages/vfsl-protocol/**`、`packages/persistence/**`、`packages/dsh-persistence/**`、`packages/vfsl-codegen/**`、`apps/**`、根配置 — 与本修订无交集
- 注：`wiki/raw/**`、`.mabf*`、`REPORT.md` 为 SA 工作流档案（本设计文档自身所在），非代码面，不参与代码 scope 比对

---

## 附 A. 与首轮设计的条款对照（本修订取代/精确化哪些条款）

| 首轮条款 | rev1 处置 |
|---|---|
| D4「union 导航 = any-of 逐成员活导航，声明序**首个可产出者**胜」 | **精确化**（D17）：「可产出 = 产出真实 value；missing 不构成胜出」——D4 的 any-of 活导航骨架、判别式零读取、声明序迭代全部保留 |
| §4.4 伪代码 `type NavOutcome = { ok: true; value: unknown } \| { ok: false }` | **取代**（D16 三态） |
| §4.4 navigate 各分支 `{ok:true, value:undefined}` / `{ok:false}` 编码 | **取代**（§3.2 三态编码；语义归属按 §3.3.1 三分法逐条不变） |
| §4.5「首个可产出者胜」叙述 | **精确化**（§3.3.3 调和表 + INV-7 精确化） |
| D13 memo（键形、健全性、上界） | **重述确认**（§3.4）：键形不变、值域扩展、上界同式 |
| D6/D8/D9/D10/D11/D12/D14/D15、C1/C2/C3 分类、INV-1..6/8..11 | **原样有效**（§3.6 显式复核） |
| 首轮 §11 文件清单 | **收窄继承**（§8：rev1 改动面 = read.ts + version bump；首轮面转对账注记） |

## 附 B. 设计自检（SKILL 一致性）

- **冻结契约不收窄**：公共签名/两态联合/AC3 缺键形态/message 增补全部原样（§3.2 顶层映射、§6 审计）；三态包内私有（INV-14，SA8 注记 3）；
- **SA2 反馈义务预对齐**：SA5 (b) 四点缝隙（mixed 优先级 §3.3.2 / INV-7 精确化 §3.3.3 / swap 限域 §3.3.3 / 硬化风险清单 §3.5）与 SA8 注记 1-5（可达性 §1.2 / 两层仲裁与 swap §3.3.3 / 公共接缝 §6 / memo 重述 §3.4 / DENY 保持 §8.3）逐条成文；
- **拒绝虚假降级**：required 缺席维持 reject→C2（M4 + H-4），不因三态化软化；mixed 裁决不把 reject 冒充失败、不把 missing 冒充拒绝；
- **架构一致性**：不推翻任何 ADR 与首轮决策；与 extract 共享终点语义源（D7 委托零改动）；两层仲裁调和成文（§3.3.3）；
- **一致性 grep 自检**：全文「missing」仅指三态之一或三源缺席（M1-M3）；「reject」仅指三态之一或 M4-M8/M10；「可产出」仅按 INV-7 精确化含义出现；「value-first」与「首个真实 value 胜」同义混用处均已限指 D17 仲裁；memo 键形表述（§3.4）与首轮 §4.3/§4.9 口径一致；`{ok:true, value:undefined}` 仅在公共联合语境出现（包内一律 `{kind:'missing'}`）；
- **协议假设**：无新增协议级假设，既有行为假设全部带源码引用或 SA5 设计期实测（§5）；
- **契约审计**：公共面零改动、包内三消费点列全（§6）；
- **ALLOW/DENY**：SA6 owned 测试在 ALLOW 且带标签（§8.1/8.2）；DENY 无 SA6 文件；对账基线双覆盖（§8 注记）。
