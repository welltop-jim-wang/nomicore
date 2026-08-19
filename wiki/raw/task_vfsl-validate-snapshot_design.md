# SA1 设计 — validateSnapshot：整份 JSON 快照校验（issue #21）

- **Worktree**: `/home/wangjian/nomicore-fix-issue-21`（branch `fix/issue-21-on-adr-union-representation`，stacked on `40c1be0`）
- **任务类型**: 功能开发（Feature）
- **修订轮次**: R4（2026-08-20，SA2 三审 reject〔轻度〕后修订）。R1 基线：commit `3e9a045`（2026-08-19 首版）；R2：commit `38be0fc`（SA2 首轮 9 项发现处置）；R3：commit `3c9b528`（复审 r2 六项发现处置——SA2 三审确认全部实质落实）。R4 输入：SA2 三审 `wiki/raw/task_vfsl-validate-snapshot_sa2_review_r3.md`（verdict: reject 轻度——R3 新引入条款的 2 MEDIUM + 2 LOW，全部为局部条款补写、不动架构/定理/引擎主线，修完可放行）——逐项处置见 §16 R4 回应表；R4 实质改动集中在 §6.3（lookMemo 稀疏存储规约 + 稠密预分配禁令）、§5.7-3（契约口径最坏化：联合重入乘数入链 + preview 门控出节点行 + 合计改为各行上限之和）、§3.4（对账句算术修正）、§6.4（T2 包络边界脚注）、§3.2/§4/§8.1（emit 消息构造门控——thunk 签名）、附录第 8/10 条
- **输入契约**: `wiki/raw/task_vfsl-validate-snapshot.md`（简报，含 SA6 红灯记录）+ `packages/vfsl/test/validate-snapshot.test.ts`（SA6 红灯，33 条 / 9 describe，commit `f9e4790`）+ `docs/adr/0003-evaluator-derived-schema.md`（四决策，不得违反）+ `docs/vfsl/v1-spec.md` §3/§9/§10 + `wiki/raw/task_vfsl-evaluator_design.md`（#20 前票设计——值 schema 形状、byValue 消费纪律、派生物不可变契约的直接上游）
- **现状基线**: `pnpm vitest run packages/vfsl/test/validate-snapshot.test.ts` → 33 failed | 253 passed（32 条 `TypeError: validateSnapshot is not a function` + 1 条 typeof 断言）；`pnpm typecheck` → TS2305（缺公共导出）+ 15 条 TS7006 级联
- **术语**: 以 `CONTEXT.md` 词汇表为准（整文档校验 validateSnapshot / 派生 schema / 值 schema / 判别联合 / 封闭对象 / 零写入）

---

## §1. 需求推演（Feature 切入点）

### 1.1 现有边界与数据流定位

```
文本 --parseVfsl--> IR --evaluate--> 派生 schema(DerivedSchema) --validateSnapshot--> { ok:true } | { ok:false, issues }
                                            ↑ 编译一次                ↑ 校验多次（每份快照一次调用）
```

- `evaluate`（#20 已合入）产出派生 schema 四件套：`aliases`（结构树别名表）/ `structure`（结构树入口）/ `values`（每别名的值语义树）/ `index`（路径索引）。本设计新增的 `validateSnapshot` 是派生物的第一个运行期消费者。
- `parseVfsl` 的单错误模型只管方言层（文本合法性）；快照校验面对的是数据层的多错误现实——迁移后体检、快照加载、管理端点需要「一次报全」的诊断（CONTEXT.md「整文档校验」词条：快照加载、迁移后体检、测试、管理端点共用的单一入口）。两套错误模型并存是显式设计，不是不一致：VfslIssue 带行列（文本诊断），ValidateIssue 带 path 段数组（数据诊断）。
- 与既有崩溃边界同构：`parseVfsl` / `evaluate` 均「同步、纯函数、不抛错，意外异常顶层 catch 收编为 E100」。`validateSnapshot` 延续同一纪律（§10）。

### 1.2 核心架构决策：只解释值 schema 树

**validateSnapshot 是值 schema（`derived.values`）的解释器；结构树（`aliases` / `structure` / `index`）本票零消费。**

论证——简报三组校验语义在值树上全部有承载：

| 校验语义（简报） | 值树承载 | 红灯锚点 |
|---|---|---|
| 封闭对象未知键拒绝 | `{kind:'object', fields: ValueField[]}`——字段名集合即封闭键空间；未列入 = 未知键 | test.ts「封闭对象未知键拒绝」两条（ROOT 层 + 联合命中成员内） |
| 必填字段缺失报告 | `ValueField` 的 optional 包装（`{kind:'optional'}`）缺席即合法、必填缺席即报 | 「必填字段缺失报告 + 未知键——一次报全」（恰 4 条）、「optional 字段缺失合法」 |
| leaf/plain 位置不接受下钻内容 | leaf = `scalar`/`enum`/`pattern` 节点（收到对象/数组即类型不匹配）；plain = `array` 节点（YPlainArray 在值语义就是 JSON 数组，收到非数组即报；元素按纯值校验） | 「leaf 位置不接受下钻内容」（notes 对象 / keywords 元素对象）、「plain 位置不接受下钻内容」（attachments 收对象） |
| 值校验（原始类型/枚举/Pattern/optional） | `scalar` / `enum` / `pattern` / `optional` 节点直映 | 「值校验」describe 全部 6 条 |
| 联合 any-of / 判别式 / no-match | `union` 节点 + `discriminator` 缓存（§5） | 「联合」describe 全部 6 条 |
| YPlainArray 纯值上下文 | 值树 `array` 递归天然是纯 JSON 语义（#20 设计 §6：`YPlainArray → {kind:'array'}`） | 「YPlainArray 纯值上下文嵌套 JSON」2 条 |
| YXmlFragment（票 B 映射） | `{kind:'xml'}` 节点（#20 设计 §6：JSON 快照值为 XML 字符串，ADR 0003 §5） | 「YXmlFragment」1 条 |

结构树的价值在路径下钻守卫（后续票）；值语义校验不需要物化信息——两树正交（#20 设计的既定立场）是本决策的架构依据。**SA3 不得读取 `derived.structure` / `derived.index` / `derived.aliases`**（读取即设计违约，SA4 静态评审锚点）。

### 1.3 设计开放点定稿总表（简报指派 SA1 定稿的四项 + 本设计补立的两项）

| # | 开放点 | 定稿 | 章节 |
|---|---|---|---|
| O1 | 数组下标段的数字/字符串表示 | **number**（元素下标原生数字；JSON 往返不变形；path 类型 `Array<string \| number>` 直接收纳；Record 键恒 string——'0'（键）与 0（下标）在各自上下文无歧义） | §9 |
| O2 | 截断标记措辞 | `校验问题超出 100 条上限，输出已截断（truncated）：另有 ${N} 处问题未报告`——含「截断」「truncated」双信号（测试 /截断\|truncat/i 双保险），path 为 `[]`；N 为精确溢出计数（收集达 100 后继续遍历仅计数，§8） | §8 |
| O3 | ReDoS 防护机制 | **包内 NFA 子集模拟匹配器**（pattern.ts：正则 → 无捕获字节码 → 状态集宽度优先模拟；R2 重设计，弃 R1 回溯执行器），彻底不用原生 `RegExp.test` 做匹配——零运行时依赖纪律保持；子集内模式**多项式完成（§6.4 定理分列：前瞻-free 线性 T1 / 含前瞻二次 T2）**，挂死结构性不可能；步数预算退居规模护栏（线性 + 二次双项钳制「合法但病态」的 m×len 与 L×len² 乘积，R3 形状对齐）。代价：反向引用收窄出子集（§6.2.1，fixture/红灯零自伤） | §6 |
| O4 | 失败距离度量 | **成员校验的 issue 计数**（把快照值对成员做完整校验，产生的原子 issue 数即距离；非对象值对对象成员 = 1）。两个红灯锚点校准：fixture `{kind:"video"}` → image 5 / text 3 / file 5 → 报 2/3；平局例两成员各 2 → 按声明序报 1/2 | §5.4 |
| O5 | 联合「命中成员」语义（本设计补立） | **候选过滤 + 零 issue 接受 + 最小距离报告**三段算法（§5.2）。纯 any-of（∀成员 issue>0 → 全拒）与 fixture 7 条精确计数测试冲突——kind 命中的成员必须**下钻报字段级错误**而非联合级汇总；候选 = 无「硬矛盾」的成员。**R2 增补资源完备性**：(解析后节点, 值) 记忆化 + 全局工作预算双保险（§3.4/§5.7，兑现 ADR 0003 §4 消费者预算委托） | §5 |
| O6 | 非法正则暴露（spec §9.1 委托） | **使用时暴露**（R2 定稿）：`Pattern<"[">` 类非法正则、子集外构造、程序规模超限、匹配步数预算耗尽，均在该校验位**被到达时**（含 Record keyPattern 的逐键判定）loud issue（ok:false + 具名 message + path）；未到达的位（optional 缺席 / 空 Record / 空数组元素）不编译不暴露 → `ok:true` 为冻结语义。急切编译不可取：pattern 节点经别名共享，issue path 无唯一定位 | §6.5 |

---

## §2. 公共接缝与类型冻结（第三公共导出）

### 2.1 新类型（随 `src/validate.ts` 定义，经 index.ts re-export 为公共类型）

```ts
/** 校验 issue：message + path 段数组（不复用 VfslIssue——无行列；段数组零转义）。 */
export interface ValidateIssue {
  message: string;
  /** 段数组（如 ["assets","abc123","duration"]）；对象/Record 键为 string 段，数组下标为 number 段。 */
  path: Array<string | number>;
}

export type ValidateResult =
  | { ok: true }
  | { ok: false; issues: ValidateIssue[] };
```

### 2.2 签名与行为契约

```ts
export function validateSnapshot(derived: DerivedSchema, snapshot: unknown): ValidateResult;
```

- **同步、纯函数、不抛错**：无 IO / 时钟 / 随机 / 全局可变状态；同输入两次调用输出全等（`toEqual` 断言）；**不修改 `derived` 与 `snapshot`**（纯数据只读遍历——测试以 `JSON.stringify(derived)` 前后相等锚定）。结果为纯 JSON 值（plain object / array / string / number），`JSON.parse(JSON.stringify(result))` 往返全等。
- **编译一次、校验多次**：`derived` 是可复用输入；一切 per-call 中间态（正则编译缓存、ref 解析 memo、count/contra 记忆化、工作账本、issue 收集器——§3.4）都是**调用局部**对象——不落模块级缓存，天然免跨调用污染与并发干涉。
- **崩溃边界**：任何内部异常（含手造/篡改派生物导致的引用环、未知名、深嵌套栈溢出 RangeError）经顶层 catch 收编为 `{ ok:false, issues:[{ message: 'VFSL-E100: 内部错误（意外异常）: <detail>', path: [] }] }`——`detail = err instanceof Error ? err.message : String(err)`（instanceof 守卫镜像 index.ts:46 / evaluate.ts 同款）；E100 冻结前缀经模板字面量直书（ValidateIssue 不经 `makeIssue`——那会引入 line/column 字段，形状不符）。
- **前置条件（公共契约 JSDoc 写明）**：`derived` 须为 `evaluate` 的 `ok:true` 产物。篡改数据（删判别式键是测试合法操作——缓存非契约；但造环/删别名属手造垃圾）落入 loud E100 边界，不静默产出 ok:true。
- **`ok:true` 恰含 ok 键**：`{ ok: true }` 字面量返回，无其余字段（`Object.keys` 断言锚点）；`ok:false` 恰含 `ok` + `issues`，issue 恰含 `message` + `path` 且按键序构造。

### 2.3 typecheck 由红转绿论证

- 红灯记录的 15 条 TS7006 级联全部源于 `validateSnapshot` 缺失使入参/回调推断落 `any`——公共导出落地后级联自消。
- 新类型与测试文件本地声明的 `ValidateIssue` / `ValidateResult` 逐字段一致（name、path 类型、判别联合形状），结构可赋值性成立；`DerivedSchema` / `VfslModule` 已是公共导出（index.ts 现状），测试 import 直接复用。

---

## §3. 校验核心：值树解释器（`src/validate.ts`）

### 3.1 值树 ref 解析器（调用局部）

值树按名引用不内联（#20 设计 §6「永不解析 ref」原则），`derived.values` 自带全量别名表。校验器内置轻量解析：

```
resolveValues(t: ValueSchema, values): ValueSchema   // 迭代 while 循环
  inFlight = Set<string>
  while t.kind === 'ref':
    if inFlight.has(t.name) → throw InternalError(`值树引用环: ${t.name}`)   # ok 派生物不可达（E106）→ loud 边界
    inFlight.add(t.name); t = values[t.name] ?? throw InternalError(`值树未声明别名: ${t.name}`)
  return t
```

- 迭代循环无栈增长（链长任意）；环/缺席均为手造派生物专属 → 顶层 catch 收编 E100（§10 I1/I2 同款）。
- 一次调用内以 `Map<ValueSchema(ref 节点), resolved>` memo（对象引用做键，纯数据稳态）——菱形值链只解析一次。
- 与 `src/resolve.ts` 的关系：**不复用其代码**（它构建于 IR `VfslModule`，本处输入是 `ValueSchema`），复用的是「迭代链解析 + in-flight 环检测 + loud Internal」的既有算法模式（resolve.ts 头注释「后续 validateSnapshot 票复用」指能力模式，非直接调用——`Resolver` 接口形状不匹配，SA3 不得为复用而改 resolve.ts）。

### 3.2 主流程

```
function validateSnapshot(derived, snapshot): ValidateResult {
  try {
    const ctx = { values: derived.values, regexCache: Map<string, CompiledPattern>,
                  work: 0, charge(n=1){…§3.4…}, countMemo, contraMemo,          # R2：资源账本 + 记忆化（全部调用局部）
                  issues: [], overflow: 0 }
    const root = resolveValues(requireKey(derived.values, 'ROOT'), derived.values)   # ROOT 缺席 → InternalError → E100
    validateValue(root, snapshot, [], ctx)                                            # path 起点 = []
    if (ctx.overflow > 0) ctx.issues.push(marker(ctx.overflow))                       # §8：溢出精确计数
    return ctx.issues.length === 0 ? { ok: true } : { ok: false, issues: ctx.issues }
  } catch (err) {
    if (err instanceof WorkBudgetExceeded) → 返回 §3.4 的预算耗尽 issue（区别于 E100）
    …其余异常走崩溃边界 §2.2…
  }
}
```

- `emit(path, makeMessage, ctx)`：issue 收集的唯一通道——**物化态**（`ctx.issues.length < 100`）才调用 `makeMessage()` 构造消息并 push（path 数组**冻结副本**：`[...path]`，防上游复用变长数组污染已收集 issue）；**计数态不调用 `makeMessage`**（`ctx.overflow += 1` 而已——消息构造含 preview 48 单位成本被门控归零，§5.7-3 事件行口径的前提）。**R4 签名冻结为 thunk 形式**（SA2 R3-2b 修法 (ii)：`emit(message, path)` 的 message 在调用前构造，计数态照跑 48 单位 preview——10⁶ 枚举错位节点 = 5.1×10⁷ 单位使契约合计被自家数字证伪）。§8 详述。
- 递归深度：值树**类型表达式**嵌套受解析层 `MAX_TYPE_NESTING = 100` 约束，但 ref 链可组合出远超 100 的**解析后**深度（别名逐层引用不增加表达式嵌套，§3.1 的迭代解析无栈增长、主校验递归沿解析后结构走）；沿快照嵌套另受运行时栈限制——两类超深的 RangeError 均由崩溃边界收编（§10 R3），可观测、不伪装成功（R2 修正论证句：R3 兜底的成立不依赖「嵌套 ≤ 100」这一不确前提）。

### 3.3 jsonTypeOf（诊断用的运行时类型名）

```
jsonTypeOf(v): 'null' | v === null
             | 'array' | Array.isArray(v)
             | 'object' | typeof 'object'
             | 'string' | 'number' | 'boolean' | 'undefined' | 其它（function/symbol/bigint → '非 JSON 值'）
```

快照契约是 JSON 值域；非 JSON 运行时值按结构落到类型不匹配诊断（期望侧永远是 JSON 类型名），不静默接受。

### 3.4 调用局部资源账本：全局工作预算 + (节点, 值) 记忆化（R2 新增，SA2 #1）

ctx 扩展两项（均调用局部，随调用销毁——纯函数契约不破）：

```
ctx.work: number                         # 全局工作计数（每次 validateSnapshot 调用从 0 起）
ctx.WORK_LIMIT = 200_000_000             # 冻结（R3 重标定：16M → 2×10⁸，乘法推导与 v1 契约见 §5.7-3）
ctx.charge(n = 1):                       # 唯一计费通道
    work += n
    if work > WORK_LIMIT → throw WorkBudgetExceeded(work)   # 调用级终态，非 E100

ctx.countMemo:  Map<ValueSchema, Map<unknown, number>>   # countIssues 结果记忆化
ctx.contraMemo: Map<ValueSchema, Map<unknown, boolean>>  # contradicts 结果记忆化（同键异桶）
# 键结构：外键 = 解析后值树节点对象（引用同一性）；内键 = 快照值（对象按引用同一性，
# 原始值按 SameValueZero 值等价——校验结果只依赖值内容，两类键均可靠）
```

**计费规则（冻结；R3 补四行——R2 表对「不进 validateValue 的纯遍历」失明，SA2 R2-3）**：

| 计费点 | 单价 |
|---|---|
| `validateValue` / `countIssues` / `contradicts` 每次进入（**含 memo 命中**——查询本身是工作） | 1 |
| NFA 模拟每步（闭包访问 / 转移 / lookMemo 命中；pattern.ts 经 charge 钩子回写 ctx——依赖注入，无模块级状态） | 1 |
| 正则编译一次 | 编译产物指令数 |
| **快照对象键被访问（R3 补）**：封闭对象未知键扫描与 Record 逐键循环中每个被枚举消费的键——**含不进 validateValue 的纯遍历键**（未知键只 emit 不下钻，但枚举即访问） | 每键 1 |
| **数组元素被访问（R3 补）**：array 行逐下标循环的每个元素——**含达 100 条后计数态 overflow 继续遍历的元素** | 每元素 1 |
| **emit / overflow 记账（R3 补）**：发射与溢出计数本身是工作（计数态的 overflow++ 循环不再免费） | 每次 1 |
| **preview 有界序列化（R3 补；R4 门控）**：按产出常数上界计费——**仅在物化态被调用**（计数态 `makeMessage` 不执行，§3.2/§8.1）→ 全局调用数 ≤ 物化 issue 数 ≤ 100 | 每次调用 48 |

R3 补行的动机（SA2 R2-3 攻击构造）：封闭对象收到 10⁸ 个未知键的快照——未知键不触发 validateValue，R2 计费表下循环体只有免费的 emit/overflow++，`ctx.work` 几乎不增长，预算对该遍历面**失明**；补行后 **>10⁸ 键触发 loud `WorkBudgetExceeded`**——每键恰 2 单位（键访问 1 + emit·overflow 记账 1），1.1×10⁸ 键 → 2.2×10⁸ > 2×10⁸；10⁸ 键恰为 2×10⁸ = WORK_LIMIT，`work > WORK_LIMIT` 不触发、刀锋上完成（R4 修正：R3 版「10⁸ 键 → 10⁸ 单位 > WORK_LIMIT」漏计自家记账行且沿用 16M 时代直觉——SA2 R3-3 失实修正）。10⁶ 键 ≈ 2×10⁶ 单位，照常完成并返回 101 条——SA2 IT 方向「有限时间内返回、不触发预算」兑现。配套实现约束见 §4.1（字段名索引 Map，消除键数 × 字段数的未计费乘积）与 §4（preview 有界序列化，禁止全量 stringify）。

`WorkBudgetExceeded` 的消费（与 E100 同为调用级终态，但**可区分**）：

```
catch WorkBudgetExceeded(w):
    return { ok: false, issues: [{ message:
        `校验工作预算耗尽（全局已执行 ${w} 工作单位，上限 200000000）：无法在预算内完成整份校验`,
        path: [] }] }
```

- **fail-closed**：无法在预算内证明合法即不放行——与 §6.5 匹配预算耗尽同立场（诚实边界，非误报「不匹配」）；
- **三重可区分**：含「校验工作预算」——区别于 E100（前缀 `VFSL-E100: 内部错误（意外异常）`）、区别于单次 Pattern 预算（`Pattern 匹配步数预算耗尽`，携带单匹配的输入长度/预算上下文）；
- **不与 100 条上限交互**：直接返回单 issue（同 E100 处置），不进 emit 通道、不产生截断标记。

**记忆化容量上界**：`countMemo` / `contraMemo` 各 65_536 条，超出**清空重建**——记忆化是性能优化、非正确性依赖（清空只损失命中率，时间界交还全局预算兜底）；封顶避免「条目数无界先于预算爆内存」（条目为键引用 + number/boolean，65_536 条 ≈ MB 级封顶）。

---

## §4. 节点校验规则全景表（`validateValue(schema, value, path, ctx)`——唯一分发点）

| 值树节点（ref 已解析） | 规则 | issue 消息（冻结格式，SA3 逐字实现） |
|---|---|---|
| `{kind:'scalar', type:'string'}` | `typeof value === 'string'` 否则报 | `类型不匹配：期望 string，实际 ${jsonTypeOf(value)}` |
| `{kind:'scalar', type:'number'}` | `typeof value === 'number'` | 同上（期望 number） |
| `{kind:'scalar', type:'boolean'}` | `typeof value === 'boolean'` | 同上（期望 boolean） |
| `{kind:'scalar', type:'null'}` | `value === null` | 同上（期望 null） |
| `{kind:'scalar', type:'unknown'}` | **恒接受**（含对象/数组/null/undefined） | — |
| `{kind:'enum', values}` | 类型形与字面量类别一致（string 字面量要 string、number 字面量要 number）且严格相等 ∈ values | `值不在枚举内：期望 ${values.map(String).join(' \| ')}，实际 ${jsonTypeOf(value)} ${preview(value)}` |
| `{kind:'pattern', regex}` | value 为 string 且 §6 匹配器判定 match（**使用时暴露**：到达本行才编译——§6.5 定稿） | 非 string → 类型不匹配（期望 string）；不匹配 → `不匹配 Pattern 正则 /${regex}/`；编译失败/规模超限/预算耗尽 → §6.5 专用消息 |
| `{kind:'optional', value}` | **不出现在本层分发**——仅对象字段位的包装，由 object 行解包（§4.1） | — |
| `{kind:'object', fields, keyPattern?}` | §4.1 封闭对象 / Record 两形态 | 见 §4.1 |
| `{kind:'array', element}` | `Array.isArray` 否则报；否则逐下标 `validateValue(element, value[i], [...path, i], ctx)`（i 为 **number** 段，O1） | 非数组 → `类型不匹配：期望数组，实际 ${jsonTypeOf(value)}` |
| `{kind:'xml'}` | value 为 string 且 §7 良构 | 非 string → `类型不匹配：期望 XML 字符串，实际 ${jsonTypeOf(value)}`；非良构 → `YXmlFragment 值不是良构 XML：${detail}` |
| `{kind:'union', members, discriminator?}` | §5 三段算法 | §5.5 |
| `{kind:'ref', name}` | 分发前已解析（§3.1），执行中**不出现** | — |

`preview(value)` = **有界序列化（R3 定稿；R4 门控）**：按 JSON 风格增量序列化，**产出满 40 字符即提前终止**（终止则追加 `…`）——**禁止**实现为 `JSON.stringify(value).slice(0, 40)`（全量 stringify 对深/大值是未计费的 O(值规模) 序列化，≤100 次 emit 可放大百倍，SA2 R2-3）；提前终止使成本被产出字符数封顶（深嵌套在 40 字符处停、长键/长数字在 40 字符处停——探索深度 ≤ 40），每次调用计 48 单位（§3.4 计费行）。诊断可读性用途不变（枚举消息专用）。**R4 调用时点门控（SA2 R3-2b）**：§4 全景表的消息（含 preview）一律经 `emit(path, () => 消息)` 的 thunk 传入——preview 只在物化态（issues.length < 100）经 `makeMessage()` 执行，计数态与计数 sink（§5.2 countIssues）零调用、零字符串垃圾；全局 preview 调用数 ≤ 物化 issue 数 ≤ 100 → ≤ 4.8×10³ 单位（§5.7-3 独立行）。消息**格式**零改动，仅构造时点后移。

### 4.1 object 节点两形态

**判别依据**：`fields` 含名为 `'<key>'` 的字段 → Record 形态（#20 设计 F2：Record 物化为 object + `'<key>'` 动态槽位 + 可选 keyPattern）。`'<key>'` 是保留段名——标识符文法不含 `<`（spec §4），与真实字段名无碰撞。

**封闭对象形态**（无 `'<key>'` 字段）：

```
validateObject(fields, value, path):
  value 非纯对象（null/数组/标量）→ emit(类型不匹配：期望对象，实际 X) → return
  # (1) 必填缺失——字段声明序
  for f of fields where 非 optional 包装:
      present(f.name) 或 emit(`缺少必填字段 "${f.name}"`, [...path, f.name])
  # (2) 未知键——快照键序（Object.keys 插入序）
  for k of Object.keys(value) where fields 无名 k 的字段:
      emit(`未知字段 "${k}"：封闭对象不接受未声明键`, [...path, k])
  # (3) 在场字段值校验——字段声明序
  for f of fields where present(f.name):
      validateValue(解包 optional(f), value[f.name], [...path, f.name])
```

`present(k)` = `Object.hasOwn(value, k) && value[k] !== undefined`——undefined 值视同缺席（optional 缺席合法 / 必填按缺失报告；JSON 序列化本就丢弃 undefined，运行时值域的对齐处理，冻结）。

**字段名索引（R3 新增，SA2 R2-3 配套）**：`fields` 的名字查找实现为**调用局部 Map**（进入 object 节点时按声明序构建，`Map<name, field>`，构建 O(#fields) 计费同量级）——未知键判定 O(1)，**消除「键数 × 字段数」的未计费线性扫描乘积**（10⁸ 键 × 30 字段的字符串比较是 R2 计费表看不见的 3×10⁹ 次比较）；§4.1 两形态与 Record 形态的键循环统一经此索引判「有无同名声明字段」。

**Record 形态**（有 `'<key>'` 字段）：

```
validateRecord(keyPattern?, slotSchema, value, path):
  value 非纯对象 → emit(类型不匹配：期望对象，实际 X) → return
  for k of Object.keys(value):                       # 快照键序
      if keyPattern 存在且 !matchPattern(keyPattern, k):
          emit(`Record 键 "${k}" 不满足 Pattern 正则 /${keyPattern}/`, [...path, k])
      validateValue(slotSchema, value[k], [...path, k])   # 键违规不阻断值校验——全收集语义
  # 无必填缺失、无未知键：动态键空间，空对象合法
```

红灯对账：`{assets:{}, unknownKey:1}` → (1) attachments/audit/keywords 三条必填缺失（assets 在场且 Record 空对象合法）；(2) unknownKey 一条 → 恰 4 条 ✓。特殊字符键 `['m','a.b|c[d]','v']` 整段相等、恰 3 条 ✓（`Record<string,…>` 无 keyPattern → 无键 issue）。

---

## §5. 联合：候选过滤 + 零 issue 接受 + 最小距离报告（ADR 0003 §3）

### 5.1 问题陈述：纯 any-of 与红灯契约的张力

若 any-of 接受定义为「成员校验零 issue」、失败时只报联合级汇总：fixture 非法快照 `img1 = {kind:'image', url:42, width:'800', …}` 的 url 类型错使 image 成员 issue>0 → 三成员全拒 → 只报汇总 → **7 条精确计数测试必红**（它要求 `['assets','img1','url']` 等 3 条成员内字段级 path）。反之，若「kind 命中即下钻、字段错误照报」而无 no-match 通道：`{kind:'video'}` 与平局例的「联合成员 i/N」消息无落点。三段算法（§5.2）是同时满足全部 6 条联合红灯 + 7 条计数红灯的唯一一致解（SA3 实现以本节为唯一权威）。

### 5.2 三段算法（伪代码）

```
validateUnion(node, value, path, ctx):
  # 计费声明：本伪代码内一切 countIssues / contradicts / dive 调用经 ctx.charge 计费（§3.4），不逐行重复
  members = node.members.map(resolveValues)                    # ref 成员先解析（红灯 describe「ref 成员按名解析后逐成员尝试」）

  # —— 段 0（可选快速路径）：判别式缓存跳转——仅加速静默接受，不改变任何输出
  if node.discriminator 存在 且 value 为纯对象:
      raw = value[node.discriminator.field]
      if raw !== undefined 且 node.discriminator.byValue[String(raw)] === i:
          if countIssues(members[i], value) === 0 → return      # 命中且零 issue：接受，零输出（与全扫描输出全等）
          # 命中但有 issue → 落入下方完整流程（输出与无缓存路径全等）

  # —— 段 1：候选过滤（硬矛盾判定，§5.3；contraMemo 记忆化）——
  candidates = [i for i in 0..N-1 if !contradicts(value, members[i])]

  # —— 段 2：接受扫描——候选按声明序逐个 countIssues，首个零 issue → 接受（零输出）
  distances = members.map(m => countIssues(m, value))          # 顺带产出距离（O4）；countMemo 记忆化
  if 存在候选 i 使 distances[i] === 0 → return                  # any-of 接受：至少一个成员零 issue

  # —— 段 3：报告——
  if candidates 非空:
      winner = candidates 中 distances 最小者（平局取声明序在前者，严格 < 扫描）
      dive(members[winner], value, path)                       # 下钻报 winner 的字段级 issue（re-base 到 path）
  else:
      winner = 全体成员中 distances 最小者（平局取声明序在前者）
      emit(联合汇总消息含「联合成员 ${winner+1}/${N}（距离 ${distances[winner]}）」, path)
      dive(members[winner], value, path)                       # 汇总 + 下钻双输出（§5.1 两类红灯锚点）
```

- `countIssues(m, value)`：以**计数 sink** 跑完整校验（不 emit，只累加）——距离 = issue 计数（O4），嵌套递归照常（嵌套联合的汇总与下钻各计 1）。**计数 sink 从不构造消息**（R4：emit 的 thunk 在计数 sink 下不执行——preview 与消息字符串零产出，§3.2/§8.1 门控的另一面）。**精确计数、不短路**（R2：R1 的「首个 issue 即返回 ≥1」短路删除——短路产出的非精确值会污染 argmin 的平局比较；重复查询的防护由 countMemo 承担：同键命中 O(1)，比短路更强且不失真）。以 (解析后节点, 值) 为键记忆化（§3.4）。
- `dive(m, value, path)`：以**发射 sink** 对成员跑完整校验，相对路径 re-base 到联合值 path（`['assets','img1']` + `['url']` → `['assets','img1','url']`）。
- 段 3 两个分支的输出集合：候选存在 → 仅 winner 字段级 issue（7 条计数锚点：img1 恰 3 条，无汇总混入）；候选为空 → 汇总 + winner 字段级 issue（`{kind:'video'}` 红灯锚定 `some(联合成员 2/3)`，`kind:'video'`+字段齐备例锚定 path `['assets','img1','kind']`——两类断言各取所需）。

### 5.3 硬矛盾判定（contradicts）——候选过滤的封闭定义

对成员 m（ref 已解析）与快照值 v：

| 成员形态 | contradicts(v, m) 为 true 当且仅当 |
|---|---|
| `scalar`（string/number/boolean/null） | 运行时类型不匹配（如 v=42 对 string） |
| `scalar unknown` | **永不矛盾**（unknown 全收） |
| `enum` | 类型形不符或值 ∉ values |
| `pattern` | v 非 string（匹配性属段 2 软判定） |
| `array` | v 非 Array |
| `xml` | v 非 string（良构性属段 2 软判定） |
| `object`（封闭形） | v 非纯对象；**或**存在必填（非 optional 包装）字段 F：F 的值 schema 为 `enum`，且 `present(F.name) ? v[F.name] ∉ values : true`（字面量字段缺席或值错 = 不可挽回的成员排除——判别字段缺席即排除是平局红灯 `联合成员 1/2` 的直接驱动）；`'<key>'` 字段跳过（动态槽位不参与矛盾判定） |
| `object`（Record 形态） | v 非纯对象（键 Pattern 违规属软判定——键错值对仍可报字段错） |
| `union`（嵌套） | 全部子成员 contradicts（递归） |
| `optional` | 成员位不可达（仅字段位包装）——到达即断言违约，throw Internal（loud） |

「必填字面量字段缺席 = 矛盾」的边界依据：字面量字段是唯一的判别信息源（F3 判别式检测同一候选条件）；缺席时值与该成员无任何可判定亲和性，交由段 3 距离裁决。平局例 `{x:42}` 对 `{kind:"a";x:string} \| {kind:"b";x:string}`：两成员 kind 均缺席 → 双矛盾 → 候选空 → 距离 2/2 平局 → 报 1/2 ✓。

### 5.4 失败距离度量（O4 定稿）

**距离 d(m) = 以计数 sink 对 v 跑 m 完整校验的 issue 数。** 每个原子 issue 计 1（必填缺失、未知键、类型错、枚举外、Pattern 不匹配、嵌套联合的汇总与下钻各计 1）。性质：

- **确定性**：遍历序冻结（§9）→ 同输入同距离；
- **锚点校准**：fixture `{kind:'video'}` → image: kind 枚举错 1 + 缺 url/width/height/audit 4 = 5；text: 1 + 缺 body/audit 2 = 3；file: 1 + 4 = 5 → 最小 text → `联合成员 2/3` ✓（测试注释「text 成员仅缺 body/audit 两字段」与计数口径一致——kind 枚举错两口径均计 1，不改变 argmin）。平局例 2/2 → 声明序 1/2 ✓；
- **平局规则**：声明序在前者胜（严格 `<` 顺序扫描，遇更小才替换）——跨实现稳定；
- 距离在段 2 接受扫描中顺带产出（同一遍计数），无二次遍历。

### 5.5 联合消息格式（冻结）

- 汇总：`不匹配任何联合成员（any-of 全拒绝）：失败距离最小的成员为联合成员 ${i}/${N}（距离 ${d}）`——测试锚 `includes('联合成员 2/3')` / `includes('联合成员 1/2')` 由 `${i}/${N}` 段直接命中；path = 联合值的 path。
- 下钻 issue：成员校验的原生消息（§4 消息表），path re-base——无联合前缀改写（7 条计数测试要求成员内 path 原样：`['assets','img1','url']`）。

### 5.6 判别式缓存透明（ADR 0003 §3 红线）

缓存的缺失/存在不得改变任何可观测行为（含错误输出）——**由算法结构保证，非事后对账**：

- 段 0 快速路径仅在「byValue 命中 且 成员零 issue」时短路返回——返回值是**静默接受**，与无缓存路径段 2 扫描到零 issue 候选的输出（同为零输出）全等；
- 命中但有 issue、未命中、value 非对象、缓存缺席——一切其余情形流入段 1~3 完整流程，与无缓存路径逐字节同路；
- byValue 键消费纪律（#20 设计 §5.2 R2 交接）：跳转键 = `String(运行时值)`，同键化后查表，**不从键反推字面量类型**。类型欺骗防御：运行时值 `'1'`（string）对字面量 `1`（number）时 `String('1') === '1'` 命中 byValue，但段 0 的零 issue 验证中枚举成员资格 `'1' ∈ [1]` 严格相等为 false → 成员有 issue → 回落完整流程（且 `'1'` 对该成员构成 §5.3 枚举矛盾被段 1 排除）——**跳转永远被同一零 issue 验证门控，不可能错接受**；
- 红灯 `stripDiscriminators`（对派生物数据删 `discriminator` 键）两路径对匹配/no-match 快照输出全等：`toEqual` 深比较，含 issues 数组序——遍历序与距离计算不感知缓存 ✓。

### 5.7 资源完备性：消费者预算与记忆化（R2 新增——兑现 ADR 0003 §4 的明文委托）

> ADR 0003 §4 原文：「派生物大小恒为 O（文本规模）；菱形引用链（`A1={l:A2,r:A2}; …`）的全展开爆炸（2^N）只在枚举型消费时发生——**枚举预算是消费者策略，不进引擎契约**。」

validateSnapshot 正是该条款点名的「枚举型消费者」——本节就是那份被委托的消费者策略。R1 的缺口：§3.1 的 memo 只覆盖 ref→目标的**解析**，不覆盖 (节点, 值) 的**校验结果**重复计算。攻击构造（SA2 P6 探针实测合法，全标量联合、每别名语法深度 2、`MAX_TYPE_NESTING=100` 完全不设防）：

```
type U0 = string;  type V0 = number;
type U1 = U0 | V0;  type V1 = U0 | V0;   …  type Uk = U_{k-1} | V_{k-1};  type ROOT = { m: U40 };
```

值树 `values['U_k'] = union{[ref U_{k-1}, ref V_{k-1}]}` → `countIssues(U_k, v)` 调 `countIssues(U_{k-1}, v) + countIssues(V_{k-1}, v)`，而 `U_{k-1}` 被 `U_k` 与 `V_k` 各调一次 → T(k) = 2·T(k−1)，k=40 ≈ 10^12 次成员扫描——同步挂死，且 R1 的步数预算只在 Pattern 引擎内部，对此零拦截。**R2 策略 = 记忆化（治 ADR 点名的菱形类）+ 全局工作预算（构造性兜底一切）**，覆盖性论证四层：

1. **菱形类（ADR 点名类）被键结构消灭**：爆炸源是「同一 (解析后节点, 值) 对被重复求值」。`values` 别名表使同名 ref 解析到**同一节点对象**（derived.ts 不可变契约：index 条目与树内节点同引用是显式设计选择），§3.1 的 resolveValues memo 保证解析结果同一性 → countMemo 外键（节点对象）恰好与爆炸源重合。菱形链 U_k 的 distinct (节点, 值) 对总数 = O(k)——记忆化后从 2^k 坍缩为线性。这不是「实测快」，是**键身份与爆炸源结构性重合**。
2. **非共享深乘积类被构造性兜底**：嵌套联合 × 多成员 × 多值位置可造出 distinct 对数量本身巨大的合法 schema（无共享子图可命中）——多项式但乘积可巨大。全局工作预算按**执行计费**（§3.4 计费点全覆盖 validateValue/countIssues/contradicts/模拟步/lookMemo 命中/编译/**键与元素访问**/**emit 与 overflow 记账**/**preview（物化态——R4 门控后计数态零调用）**——R3 补行后纯遍历面不再失明），2×10⁸ 上限硬封顶任意调用的总工作量，超限 loud fail-closed。对照 §6.1 否决「静态风险分析」的判据（「漏报即挂死，防护承诺破产」）：计费式预算**无识别面即无漏报面**——构造性成立（R2-3 三个盲区堵死后）。
3. **合法调用的组合包络（R3 重写为显式乘法推导 + v1 快照规模契约冻结；R2 的单点标定作废）**：

   **R2 标定的自相矛盾（SA2 R2-2，用设计自家数字即可证伪）**：R2 §5.7-3 宣称「带 Pattern 的常规快照 ≤ 10^4 单位」，而 R2 §6.4 自己给出 AssetId 单键保守界 **2.7×10^4**（135×66×3）——单点标定没做乘法：① 键数乘法：16M ÷ 2.7×10^4 ≈ **590 键**（保守界）即触顶，按实际状态集宽度（5~7×10^3/键）≈ 2_500~4_000 键——**数千资产的全合法快照（迁移后体检旗舰场景）被 `WorkBudgetExceeded` 误拒**；② 联合乘数：段 2 `members.map(countIssues)` 对全部成员完整计数且接受不短路（R2 删短路的正确决定保留了代价：成员内 Pattern 工作量 × N）；③「16M ≈ 数十万节点访问级」的等价说法掩盖了 NFA 步与节点访问 1:1 计费——真实含义是「600~4_000 次 Pattern 应用**或**数十万节点访问」，对 Pattern 承载快照错 1~2 个数量级。

   **乘法链（自上而下，每个乘数显式；R4 补联合重入乘数——R3 版缺席使契约在最坏同排满下被自家数字证伪〔SA2 R3-2：1.35×10^8 + 5×10^7 + 5.1×10^7 = 2.36×10^8 > 2×10^8〕）**：
   - 单次 Pattern 应用成本上界 = §6.4 定理界（按类分列）：T1 类（前瞻-free）64 码元 × m≈135 × f=3 ≈ **2.7×10^4**；T2 类（含前瞻、L·m_sub·f_sub ≈ 15）256 码元 ≈ **10^6**；
   - × 应用次数乘数 = Record 键数 + 数组元素数 + 联合成员数（段 2 全成员计数）+ 字段数——每个「到达 pattern 位的数据位置」各计一次；
   - **× 联合重入乘数 = Π(Nᵢ+1)（R4 补，SA2 R3-2a）**：第 i 层联合（成员数 Nᵢ）的快照子树被 Nᵢ 次段 2 全成员 countIssues + 1 次段 3 dive 完整重入——嵌套联合下每快照节点的计费进入数 = 各层 (Nᵢ+1) 之积；成员子树全相异时 countMemo 键不碰撞、记忆化不救（运行时由全局预算 loud 兜底——第 2 层，fail-closed ~1s 不挂死；缺口只在契约行口径，非运行时安全）。**契约行必须按重入后的总数计**：深度 30 二元相异联合链 × 深度 30 快照（3^30 量级进入）在新口径下是**超契约调用**（≫ 3×10^6 事件），落入「超契约调用」的 loud 语义——契约作为充分条件的推导闭合；
   - + 计费事件乘数（R4 口径，取代 R3 的「节点访问乘数」）= 每快照节点**每次进入** ≤ ~3 个 1 单位事件（进入 1 + 父边键/元素访问 1 + emit·overflow ≤ 1）+ 联合位记忆化查询——**preview 不在本行**（R4 门控后仅物化态构造，独立成行，见下表）。

   **v1 快照规模契约（冻结，「支持 ≤ X 次 Pattern 应用 / ≤ Y 规模快照」；R4 最坏口径重排——合计 = 各行上限之和〔SA2 R3-2 修订要求〕）**：

   | 维度 | v1 冻结值 | 保守界合计（定理界口径） |
   |---|---|---|
   | 前瞻-free Pattern 应用（单次输入 ≤ 64 码元） | ≤ **5_000 次** | 5_000 × 2.7×10^4 = 1.35×10^8 |
   | 含前瞻 Pattern 应用（单次 ≤ 256 码元、L·m_sub·f_sub ≤ 15） | ≤ **50 次** | 50 × 10^6 = 5×10^7 |
   | **计费事件数（R4 口径）**：validateValue/countIssues/contradicts 进入（含 memo 命中查询与**联合重入 Π(Nᵢ+1)**）+ 键/元素访问（含纯遍历，§3.4 R3 补行）+ emit·overflow 记账 | ≤ **3_000_000 事件**（union-free 下 ≈ 10^6 快照节点 × ~3 事件/节点——与 R3 版 10^6 节点承诺等价） | 3×10^6（每事件恰 1 单位） |
   | preview（R4 门控：仅物化态构造，§3.2/§8.1） | ≤ 100 次调用 | 100 × 48 = 4.8×10^3 |
   | **合计保守界（= 各行上限之和）** | | **1.35×10^8 + 5×10^7 + 3×10^6 + 4.8×10^3 = 1.88×10^8 ≤ WORK_LIMIT = 2×10^8（余量 ~6%）** |

   **R4 重排说明（两处最坏化，对照 SA2 R3-2 的 (a)(b)）**：(a) 节点行维度从「快照节点数」改为「计费事件数」——联合重入乘数 Π(Nᵢ+1) 显式入乘法链，嵌套联合调用按重入后事件总数对照冻结值（R3 版把含联合 schema 按无联合假设计，三行全合规仍可触顶）；(b) preview 从节点行（R3 自注「48 仅枚举位」→ 最坏 51 单位/节点）**门控出节点行**为独立全局行（≤ 100 × 48，§3.2 thunk 签名兑现）——枚举错位节点最坏回落 ~3 单位。SA2 三修法中取 **(i)+(ii) 组合**（乘数入式 + preview 门控），不动 WORK_LIMIT 数值（2×10^8 维持，§3.4/附录 8 无需再改）。

   WORK_LIMIT 重标定：16_000_000 → **200_000_000**（§3.4 同步）。契约内调用的保障是**保守定理界口径**（实际成本低于定理界 3~10×，实际余量 ~5×；两级余量如实分列）。**旗舰场景核对（CONTEXT.md「迁移后体检」规模）**：3_000 个 AssetId 键（8/32/64 码元混长、均长 ~35）+ 合法实体 ≈ 3_000 × (35×135×1.2 实际) + 3_000×50 ≈ **1.7×10^7 单位 = WORK_LIMIT 的 8.5%**；保守定理界口径 3_000 × 2.7×10^4 = 8.1×10^7（40%）——两口径均在契约内（**R4 口径复核**：单层联合的 ×4 重入计入事件行——3_000 键 ≈ 1.5×10^5 事件 ≪ 3×10^6，旗舰结论不变）。墙钟参考：计费单位为 O(1) 状态集/Map 操作，node 实测同形操作 ≈ 1.9×10^8 次/秒（设计期基准，Set has/add 循环 5×10^7 次）→ 旗舰场景 < 1s、契约顶 ≈ 1~5s。**超契约调用**：预算内则照常完成（WORK_LIMIT 是上界不是配额）；耗尽则 loud `校验工作预算耗尽`——fail-closed、可诊断、不挂死。打满 2×10^8 的最坏墙钟（≈ 1~5s）由调用方场景背书：本接缝的预设消费者（快照加载前置检查、迁移后体检、管理端点）均为离线/诊断路径，非热路径；后续票若需在线调用，WORK_LIMIT 是 validate.ts 内常量（非接缝形状），可参数化下调而不动架构。
4. **内存上界**：memo 容量 65_536 条封顶（§3.4）+ NFA 模拟活内存 O(\|prog\|) 与 lookMemo **稀疏物化的被写槽位**（§6.3，R4——稀疏规约使「每槽写入前必已付费 → 槽位被步数预算封顶」的论证在字面读法下成立，稠密预分配禁令入附录 8）+ emit 侧 issue 物化 ≤ 101 条（R4 门控后计数态零消息字符串）→ 调用级内存 ≈ O(派生物规模 + 快照遍历栈 + MB 级账本)，无 GB 面（R1 的捕获副本回溯栈已随 §6.3 引擎重设计整体消除——SA2 #6 的 OOM 绕过路径不复存在；R3-1 的稠密分配回归通道由稀疏规约封死）。

---

## §6. Pattern 执行引擎：包内 NFA 子集模拟匹配器（`src/pattern.ts`，O3 定稿；R2 重设计）

### 6.1 为什么不用原生 `RegExp.test`

| 方案 | 判定 | 依据 |
|---|---|---|
| 原生 RegExp 直接匹配 | **否决** | 同步单线程下无法中断运行中的原生匹配——worker/超时/watchdog 三条路都破坏同步纯函数签名或引入运行时依赖；且 ReDoS 红灯 `(a+)+$ × 'a'*32+'!'` 正是原生引擎的指数回溯死局 |
| 原生 + 静态风险分析分流（安全走原生、危险走受限引擎） | **否决** | 静态分析不完备是定理级困难（覆盖重叠交替、多项式炸弹 `a*a*a*a*b` × 兆级输入均漏报）——漏报即挂死，防护承诺破产 |
| **包内 NFA 子集模拟匹配器（本设计，R2）** | **采纳** | 子集内模式**多项式完成（§6.4 定理分列：T1 线性 / T2 二次）**——挂死结构性不可能，防护不依赖「标定恰好覆盖」；零运行时依赖（包内纯 TS）；同步；确定性（不依赖引擎实现差异）；`packages/vfsl/package.json` 零 runtime deps 纪律保持。步数预算退居**规模护栏**（线性 + 二次双项，钳制「合法但病态」的 m×len 与 L×len² 乘积，§6.4 R3）。代价：反向引用收窄出子集（§6.2.1——fixture 与红灯全部 Pattern 实核零反向引用，无自伤） |

### 6.2 支持的语法子集（冻结；「ECMAScript RegExp（无标志）」的实用子集，Annex B 宽松解析；R2 逐类完备枚举）

**语义基线**：按 UTF-16 码元模拟（与无 `u` 标志的 ECMAScript 一致——代理对是两个码元，`.` 匹配单个码元）。

| 类别 | 支持项（冻结枚举） |
|---|---|
| 字面量 | 普通字符；类外语法字符转义 `\\ \. \* \+ \? \( \) \[ \] \{ \} \| \^ \$ \/`（均按该字符字面量）；控制转义 `\n \r \t \f \v \0`；`\cX`（X ∈ A-Za-z，控制字符；`\c` 后非字母 → 编译失败 loud）；`\xHH`（两位十六进制）；`\uHHHH`（四位十六进制）——`\x`/`\u` 非完整形处置**统一**见 IdentityEscape 行（R3，消除 R2 两行相反）；`\u` 后非四位十六进制 → IdentityEscape 字面量 `u`，其后 token 流按**正常量词规则**解析：`{n}` `{n,}` `{n,m}` 合法 → **作用于字面量 `u` 的量词**；非法量词形（`{,2}` `{FFFF}` 等）→ `{` 字面量（Annex B）。**实测依据（node v24.13.0，R3 修正 R2 反向断言）**：`/\u{2}/.test('uu') === true` 且 `/\u{2}/.test('u{2}') === false`——`{2}` 是作用于 `u` 的量词，R2「按非量词字面量」与 ECMAScript 相反（按 R2 字面实现会把 `Pattern<"\\u{2}">` 的接受语言从 `'uu'` 错成 `'u{2}'`，双向偏离）；`/\u{2,3}/.test('uuu') === true`；`/\u{,2}/.test('u{,2}') === true`（非法量词 → 字面量）；`/\u{FFFF}/.test('u{FFFF}') === true`（无 u 标志下花括号码点形**不**按 `\u{...}` 解析——`\u`→`u`、`{FFFF}` 非法量词 → 字面量） |
| **类外 IdentityEscape（Annex B 宽松立场，R2 定稿；R3 统一非完整形处置）** | `\` + 任意非保留前缀字符 → 按该字符**字面量**（`\q`→`q`、`\-`→`-`、`\e`→`e`——与 ECMAScript 无标志行为一致，避免大量 JS 合法模式被 loud 拒）。保留前缀冻结清单：`c d D s S w W b B x u` + 数字 `0-9` + `f n r t v` + 上行已列语法字符 + `/`。**前缀后非完整形的唯一权威处置（R3）**：`x` / `u` 前缀后跟非完整形 → **降级为该前缀字符的字面量**（Annex B Web 兼容），与字面量行同读——实测：`/\xZ/.test('xZ') === true`（`\xZ` ≡ 字面量 `xZ`）、`/\xZZ/.test('xZZ') === true`、`/\uZZ/.test('uZZ') === true`、`/\uq/.test('uq') === true`、完整形不受影响 `/\x41/.test('A') === true`；R2 本行「保留前缀后跟非完整形 → 编译失败 loud」与字面量行相反且被 `\xZ` 实测证伪——**废弃**。仍 loud 的前缀（两行一致的完整枚举）：`\c` 后非字母（`c` 无 Annex B 降级形）；数字（类外 = 反向引用 `\1`~`\9` 收窄，§6.2.1；类内 = legacy 八进制不进子集）；`\p{` `\P{` `\k<` 完整前缀形（Unicode 属性转义 / 命名引用——**有意偏离基线并显式标注**：Annex B 非完整标志下它们本可 IdentityEscape（实测 `/\p{L}/.test('p{L}') === true`），本引擎按 §6.5 子集外构造 loud 拒——收紧方向一致于两行、偏离在案；裸 `\p` `\k` 不跟 `{`/`<` 时按 IdentityEscape 字面量（实测 `/\p/.test('p') === true`、`/\k/.test('k') === true`）） |
| `.` | 除行终止符（LF U+000A / CR U+000D / LS U+2028 / PS U+2029）外任意 UTF-16 码元（无 s 标志语义） |
| 字符类 | `[...]` / `[^...]`（编译期求补）；字符；区间 `a-z`（端点可为类内转义）；**类内转义全集（R2 枚举）**：`\\` `\]` `\^` `\-`、类内 `\b`（= U+0008 退格——与类外「词边界」义不同，ECMAScript 同款区分）、`\d \D \s \S \w \W`、`\n \r \t \f \v \0`、`\cX`、`\xHH`、`\uHHHH`；`[` 在类内为字面量（Annex B）；类内 IdentityEscape：`\` + 非保留前缀 → 字面量；**类内 `\` + 数字 → 编译失败 loud**（Annex B legacy 八进制不进子集——显式收窄，枚举在案） |
| 预定义类 | `\d \D \s \S \w \W`（类内类外同语义；`\D \S \W` 为补类，编译期展开） |
| 断言 | `^`（串首：pos === 0）、`$`（串尾：pos === len——无 m 标志，**不**匹配尾换行前）、`\b \B`（词边界：prev/next 码元的 `\w` 性，越界视为非词字符——caret 语义） |
| 分组 | `(…)` 捕获形 / `(?:…)` 非捕获——编译时**一律不分配捕获槽**（布尔 test 语义；两形按相同 NFA 结构编译） |
| **交替（R3 补行，SA2 R2-6）** | `\|`——顶层与分组内交替，编译为 `Split(x, y)`（§6.3 指令集；§6.1 否决静态分析的论据「覆盖重叠交替」本就以本行能力为前提——枚举完备纪律要求成行）；优先级最低、任意结合（`a\|b\|c` 左结合链）；**空交替臂合法**：`a\|`、`\|a`、`(\|)` 的空臂编译为 ε 路径（闭包直达，零消费）——实测 `/a\|/.test('') === true`、`/(\|)/.test('') === true`（Annex B 基线一致）；`\|` 在字符类内为字面量（上行类内转义全集已含） |
| 量词 | `* + ? {n} {n,} {n,m}` + 惰性后缀 `?`；`{` 不构成量词时按字面量（Annex B）；**惰性/贪婪编译同形**（优先序只影响捕获选择与匹配位置，不影响「是否存在匹配」——布尔语义下等价） |
| 前瞻 | `(?=…)` `(?!…)`——子模拟求值（§6.3），**零回写**：JS `(?=(a))` 的持久化捕获只影响 `$1` 读取面，本引擎无捕获读取，布尔 test 语义与 ECMAScript 等价（#9-b 成文） |
| 反向引用 | **不支持（R2 收窄）**：`\1` ~ `\9` → 子集外构造 loud 拒绝——理由见 §6.2.1 |

**fixture 自伤核对（#3 修订要求的验收）**：fixture AssetId 解码后正则 `^[A-Za-z0-9_\-]{1,64}$` 的 `\-` 落在类内转义全集内（上行）→ 编译通过；`^[a-z]{2,4}$`、`(a+)+$`（红灯）均在子集内。R1 清单缺 `\-` 将使 fixture Record 键 Pattern 全部编译失败、约 15 条测试连环红——已修复。

### 6.2.1 反向引用收窄的决策记录（R2；R3 补混合引擎否决与收益分列）

R1 字节码回溯引擎为容纳 `\1`~`\9` 需要「捕获副本快照栈」；NFA 子集模拟天然无法表达反向引用（非正则语言）。**收窄的两条独立理由（R3 分列——R2 的「三难」把一条已解的难列进去了）**：

1. **内存收益（可被替代方案部分消解——如实陈述）**：R1 捕获副本栈无界（SA2 #6 的 OOM 绕过 E100 路径）。SA2 R1 #6 自己给出过 undo-log 回溯器选项：只记 (pc, 位置) 撤销日志、回退时重放，栈条目 O(1)/步、峰值 O(len)——**这一条难是有解的**，不构成否决反向引用的独立充分理由。
2. **定理收益（真正不可兼得的一条）**：反向引用使模式语言超出正则类，**任何**保语义的执行器（回溯、undo-log 回溯、Pike VM 皆同）对含反向引用的模式失去多项式完成保证——回溯类执行器对反向引用模式仍是指数时间类，完成性只能靠预算兜底 → 「合法值不被预算误拒」重新依赖「标定恰好覆盖」（R1 #4-b 缺陷类的回归通道）。§6.4 的 T1/T2 定理是「防护不依赖标定恰好覆盖」立场的兑现载体，而定理的论域恰是无反向引用的正则类——**保留反向引用 = 放弃定理覆盖面**，这是内存之外独立的、不可通过工程手段消解的代价。附带：反向引用使 (pc, pos) 状态记忆化不健全（匹配结果依赖捕获向量，键不再充分）——NFA 化后此问题随捕获整体消失（§6.3 活内存 O(\|prog\|)）。

**混合引擎的显式否决（R3 补，SA2 R2-5）**——「无反向引用走 NFA、含反向引用走受预算回溯器」的双引擎方案否决，理由分列：

- **(a) 定理覆盖面缩水（主因）**：「子集内多项式完成」的承诺退化为「半子集多项式 + 半子集预算兜底」——含反向引用的半边原样保留 R1 #4-b「合法值被预算误拒」缺陷类与指数时间类，防护重新依赖标定；单引擎的定理是全子集的结构性属性，混合引擎把它降级为条件性属性；
- **(b) 语义分裂风险**：同一 §6.2 子集内两类引擎须对 Annex B 边缘构造（`\u{2}` 量词作用、空交替臂、空迭代语义）逐项双实现双对账——走样面 ×2，且「同一模式在不同引擎下语义不同」的分歧一旦出现即是对 ECMAScript 基线的双向偏离（R2-4 类缺陷的双引擎放大）；
- **(c) 维护与测试半径**：两套执行器 + 分流判定 + 各自的对账面（红灯/探针/IT 须对两引擎分别成立）——测试面翻倍；
- **(d) 需求面为零**：fixture 与红灯全部 Pattern 零反向引用（实核 test.ts:50/328/352——AssetId、`^[a-z]{2,4}$`、`(a+)+$`），为不存在的用例支付双引擎代价。

处置：收窄出子集，loud 可诊断（`不支持的构造：反向引用`）。自伤核查：同上实核零自伤。子集边界原则（SA2 #3）：**可以窄，必须枚举完备、无 fixture 自伤**。

### 6.3 编译与执行（无捕获字节码 + NFA 子集模拟——无回溯栈、无递归、活内存 O(|prog|)）

```
compile(regex): { program, size }     # ctx.regexCache 调用局部缓存（键 = regex 字符串）；编译按产物指令数计入全局工作预算
  语法分析（§6.2 子集 + Annex B 立场）→ AST → 线性程序：
    Char(cp) | Class(setId) | Any | AssertStart | AssertEnd | AssertWordB(neg)
    Jmp(x) | Split(x, y) | Look(neg, sub) | Match
  无 Save / 无 Backref / 无捕获槽（§6.2 分组行）；Split 无优先序标注（布尔语义不需要）
  程序规模上限 10_000 指令——{n,m} 大边界展开（如 {1,100000}）超限 → 编译失败（§6.5 编译期规模消息）

match(regex, input): boolean          # test 语义：非锚定搜索（存在任一起点的前缀匹配即 true）
  budget = min(4_000_000, max(8_192, 1_024 × len + 512 × len² + 16_384))   # 冻结（R3 重标定：形状对齐定理分列——线性项 T1 类 + 二次项 T2 类，§6.4）
  lookMemo: Map<Look 指令, Map<number, boolean>>   # (Look, pos) 结果记忆化（R3 新增，调用局部；R4 存储规约：**稀疏物化**）：
                                      #   同一 Look 指令在同一 pos 的锚定子模拟结果只求值一次，跨外层轮次与兄弟子模拟共享；
                                      #   命中也计 1 步（查询即工作，与 §3.4 memo 计费纪律一致）；
                                      #   **只有被写的 (Look, pos) 槽才占内存**——外层 Map 键 = Look 指令对象，内层 Map 键 = pos
                                      #   （等价实现：单一 Map<复合键 (lookId, pos), boolean>）。**禁止稠密预分配**
                                      #   new Array(len+1) / new Uint8Array(len+1)——数组分配不是计费步、不受 4M 钳制，
                                      #   SA2 R3-1 构造（200 条空前瞻 ε 链 × 10^7 码元输入）在 ~600 计费单位下即可物化
                                      #   200×10^7 = 2×10^9 槽（普通数组 ≈ 16GB / Uint8Array ≈ 2GB），双预算失明、
                                      #   V8 OOM 是不可 catch 的进程级 FatalError（E100 收编不了）——SA4 静态锚点（附录 8）
  NFA 子集模拟（宽度优先，逐消费轮推进）：
    S = closure({start})              # ε 闭包：追随 Jmp/Split；AssertStart/End/WordB 按 pos 谓词过滤；
                                      #   Look(neg, sub) → 查 lookMemo[该指令][pos]；未命中则从 pos 起**锚定**子模拟
                                      #   （无重播种，共享 budget 与 charge）→ 布尔取反/保留 → 结果写回 lookMemo
                                      #   闭包内以 pc 去重——每状态每轮至多入闭包一次：
                                      #   = 空宽度循环的结构性终止守卫（#4-a：'(a?)*' 的空迭代在闭包内被去重拦停，不再无限压栈）
    if S 含 Match → true              # 空串匹配于此判定（如 'a?' × ''）
    for pos = 0 .. len-1:
        S = closure( step(S, input[pos]) ∪ {start} )   # 逐起点重播种 = 非锚定搜索；本轮闭包在 pos+1 处求值
        if S 含 Match → true
    终轮：closure(S)（在 pos = len 处）中 AssertEnd 通过且含 Match → true；否则 false
  每次闭包访问/转移计 1 步（lookMemo 命中同计 1）；steps > budget → throw BudgetExceeded（→ §6.5，非静默）
  步数经 charge 钩子同步计入全局工作预算（§3.4）
```

- **状态集即已访集**（#4-b 的等价物，更强形态）：闭包按 pc 去重使「同一 (pc, pos) 的重复探索」结构性不存在——回溯引擎需要专门记忆化的地方，模拟器的数据结构天然就是记忆化。
- **活内存**：当前/下一状态集 + 闭包暂存 ≤ 3 × \|prog\| 槽，外加编译期类集合（\|prog\| 级）与 lookMemo（R3：键空间 ≤ L×(len+1) 布尔槽；**R4 稀疏物化**：`Map<Look, Map<number, boolean>>` 只有被写的槽才占内存——「每槽写入前必已付出 ≥ 1 计费步的求值」的封顶论证由此**对实际占用的内存成立**，被写槽位被步数预算封顶，4M 钳制下 ≤ 4M 槽 ≈ MB 级；稠密预分配禁令见上行规约与附录 8——无回溯栈、无捕获副本、无预算外的随步数增长分配、**无计费外的大块物化**（#6 的内存上界即此：R1 的 `(pc,pos,captures 副本)` 栈已整体消除，OOM 绕过 E100 的路径不复存在；R3-1 的稠密分配面是唯一回归通道，已由存储规约封死）。

### 6.4 完成性定理（定理分列，R3）与预算重标定

**R2 陈述为假的自认（SA2 R2-1）**：R2 定理 `steps ≤ (len+2)×m×f` 对**含前瞻的模式不成立**——括注「前瞻子模拟同定理递归」只给了子模拟自身的界，没有乘上 Look 的评估次数。攻击构造（node 实测合法 ECMAScript 且在子集内：`/(?=.*;)z/.test('xxxxxz;') === true`）：

```
type ROOT = { name: string & Pattern<"(?=.*;)z"> };
快照 { name: 'x'.repeat(N) + 'z' + ';' }     # 真值：匹配（pos N 处前瞻命中、z 命中）
```

非锚定搜索每轮重播种 `{start}` → 闭包每轮处理 `Look` → 从 pos 起**锚定**子模拟 `.*;`（成本 ≈ 15×(len−pos)）→ 外层每消耗 1 字符重评估一次。总成本 ≈ Σ 15×(len−p) ≈ **7.5·len²**，而 R2 预算是线性的（1024·len + 16384）：令 L=len，7.5L² > 1024L + 16384 ⟺ **L ≳ 151**——约 152 字符以上的合法值即被预算误拒为「无法判定」（`ok:false`），R1 #4-b「合法值被预算误拒」缺陷类经引擎重设计后以新形态回归。R3 修复 = **定理分列（如实陈述二次界）+ 预算形状对齐（二次项）+ 嵌套前瞻记忆化**。

**定理 T1（前瞻-free 线性界）**：P 不含 Look 指令（\|prog\| = m）× 输入 s（len），模拟步数
`steps ≤ (len + 2) × m × f`（f = 闭包平均扇出，≤ 3）。
证明骨架：位置单调推进（每轮消费恰 1 码元，len + 2 轮含初态与终轮）；每轮闭包是对有限状态集的单调不动点——pc 去重使每状态每轮至多处理一次、每次处理触发 ≤ f 条转移。∎

**定理 T2（含前瞻二次界——R3 如实陈述）**：P 含 L 条 Look 指令（L ≥ 1），最大子程序规模 m_sub，则在 (Look, pos) 记忆化（§6.3，R3 新增）下
`steps ≤ (len + 2) × m × f + L × (len + 1) × (len + 2) × m_sub × f_sub`（f_sub ≤ 3）。
**二次的根源**：非锚定搜索逐轮重播种使闭包内的 Look 在每个 pos 各评估一次（闭包 pc 去重只保证「每轮每 pc 一次」，不跨轮去重），每次评估触发从 pos 起的锚定子模拟 O((len − pos) × m_sub × f_sub) → Σ_pos (len − pos) = O(len²)。**记忆化的定理意义**：无记忆化时同一 (Look, pos) 对会在嵌套场景被重复求值——深度 d 嵌套前瞻为 O(len^(d+1))；记忆化使全部 Look 评估总数 ≤ L × (len + 1)（键空间上限），每次 ≤ O(len × m_sub × f_sub) → **任意嵌套深度下 T2 的二次界不变**。正确性依据：锚定子模拟无重播种、无捕获，结果是 (子程序, pos, 输入) 的确定函数——同键必同值。∎
**剩余界如实陈述**：单层前瞻的 O(len) 次评估本身无重复（键 (Look, pos) 天然互异），记忆化对此**不减**——T2 类就是二次，本设计不宣称线性。

**推论（T1 类继承 R2 全部结论）**：挂死在子集内**结构性不可能**（不依赖标定恰好覆盖——T2 类多项式次数为 2，同样排除指数类）；空宽度循环被闭包去重拦停（`(a?)*b` × `'b'` → **true**，与 ECMAScript `(a?)*b`.test('b') === true 一致）；小输入合法值不再因探索量超预算被误拒（`(a+)+b` × `'a'*20+'c'+'a'*5+'b'`：steps ≈ 8 × 29 × 3 ≈ 700，start 21 命中 → **true**——R1 回溯引擎在 start 0 烧 2^19 分区 > 预算 4096 必误拒）。

**预算重定位（R3 形状对齐）**：`budget = min(4_000_000, max(8_192, 1_024 × len + 512 × len² + 16_384))`——线性项覆盖 T1 类定理界、二次项覆盖 T2 类定理界、4M 钳制是单匹配绝对工作量护栏（对抗性 L × m_sub 乘积的独立于 len 的界，≈ 数十毫秒级）。从 R1 的「唯一防挂死线」降级为**规模护栏**的定位不变；耗尽 → loud fail-closed，消息明示「无法判定」，不冒充「不匹配」。

**「耗尽 ⟹ 超包络」蕴含式（R3 重写——R2 的一揽子蕴含为假）**：预算耗尽 ⟹ 输入至少违反下列之一（按所属类分列）：
- **T1 类**：`m × (len+2) × f > 1_024 × len + 16_384`（len ≲ 3_891 时成立——线性项主导段；超出后 4M 钳制接管，见下行病态大值类目）——程序规模超线性包络（f = 3 保守口径下 m ≳ 340 恒过界：340 × 3 = 1_020 < 1_024 斜率、截距余量 16_384 − 340×2×3 = 14_344；锚定/有效 f ≈ 1 模式 m ≲ 1_024）；
- **T2 类**：`L × m_sub × f_sub × (len+2)² > 512 × len² + 1_024 × len + 16_384`，或已触 4M 钳制——前瞻负载（L × m_sub × f_sub 乘积）超二次包络（该蕴含式的严格有效域见包络表下边界脚注）。
R2 蕴含式「耗尽 ⟹ m × len 乘积超包络」对 T2 类为假（SA2 构造：m = 8、len = 250 乘积微不足道仍耗尽）——废弃，以分列蕴含式取代。

| 类目（分列） | 定理界 | 预算保障包络（定理界 ≤ 预算） | 标定 / 实测 |
|---|---|---|---|
| 33（ReDoS 红灯 `'a'*32+'!'`，T1 类） | (35) × 8 × 3 ≈ 840 | 8_192，余量 ~10× | 病态回溯炸弹（回溯引擎下 2^31 步）→ 多项式完成，**真值判定「不匹配」** → `ok:false` ✓（红灯对账不受 R3 修订影响：`(a+)+$` **前瞻-free**，属 T1 类——成文说明见 §6.6） |
| 27（`(a+)+b` × `'a'*20+'c'+'a'*5+'b'`，SA2 #4-b 探针，T1 类） | ≈ 700 | 8_192 | **非锚定 × 中庸模式 × 结构化不匹配前缀**（R1 缺位类目——回溯引擎在此误拒合法值）→ 完成，start 21 命中 → `ok:true` ✓ |
| ≤ 64（AssetId 键、短枚举串，T1 类锚定线性） | m ≈ 135（`{1,64}` 展开）× 66 × 3 ≈ 2.7 × 10^4 | 8_192 ~ 81_920，余量 ~3× | 实际状态集宽度 ≤ 64/轮 → 实测口径 ≈ 5~7 × 10^3/键（§5.7-3 乘法推导用保守界 2.7 × 10^4） |
| **202（SA2 R2-1 攻击构造 `(?=.*;)z` × `'x'*200+'z'+';'`，T2 类）** | 8×204×3 + 1×204×205×5×3 ≈ 6.3 × 10^5 | budget(202) = min(4M, 206_848 + 20_910_000 + 16_384) = 4M（钳制），余量 ~6× | **R2 下必红**（线性预算 206K+16K < 实际 ~3.1 × 10^5 即耗尽、保守界 6.3 × 10^5 更甚）；R3 下完成 → 真值**匹配**（前瞻命中 + z 命中）→ `ok:true` ✓——SA2 IT 方向「前者 ok:true」的直接兑现 |
| 300（对照锚定类 `^(?=.*d)[a-z]+$` × 含 d 长串，T2 类但锚定） | Look 仅在 pos 0 评估一次（AssertStart 滤掉 pos>0 的重播种）→ 有效线性 ≈ 300 × m × f | 线性项即覆盖 | 锚定前瞻（密码式惯用法）不触发二次项——**出事的是非锚定 × 前瞻内含 `.*`/`{n,m}` 类**（R3 包络表分列使其可检） |
| **T2 类通用包络** | L × (len+1) × (len+2) × m_sub × f_sub | 二次项保障：L × m_sub × f_sub ≲ 512 且 (len+2)² × L × m_sub × f_sub ≤ 4M → **len ≲ √(4M / (L·m_sub·f_sub))**；攻击类乘积 15 → len ≲ ~514 | 更大 L × m_sub 乘积按平方反比收缩（如乘积 60 → len ≲ ~257）；乘积 > 512 的前瞻负载在任何 len 都只受 4M 钳制兜底（loud） |
| ~2.5 KB × m ≈ 340（T1 类包络边界） | 340 × 2562 × 3 ≈ 2.61M | 1_024×2560 + 512×2560² + 16_384 → 钳制 4M，余量 ~1.5× | T1 包络上限（保守定理界 f=3）m ≲ 340 且 len ≲ 2.5K；锚定线性（有效 f ≈ 1）容纳 m 至 ~1_024；schema 校验的 Pattern 用途（键/ID/短枚举串）深藏包络内，长自由文本由 YXmlFragment/结构承载（fixture 分工：body = xml、id/name = pattern） |
| 16 KB ~ 1 MB（病态大值，两类通用） | — | 4M（钳制值） | 超包络 → 预算耗尽 loud（fail-closed、可诊断、不误报「不匹配」）；单次匹配最坏 ~4M 步 ≈ 数十毫秒（钳制上限） |

**边界脚注（R4，SA2 R3-4）**：包络表「预算保障包络」列在 T2 类的**严格**蕴含式为 `P(len+1)(len+2) ≤ 512len² + 1_024len + 16_384`（P = L·m_sub·f_sub）——P=512 时等价于 `512len ≤ 15_360` ⟺ **len ≤ 30**（线性项/截距的补偿只在此时严格）；len ∈ (30, ~86) 窗口内（4M 钳制接管前）定理界可超预算项 **≤ ~0.8%**，算术推导 + node 复核：len=40 → 512×41×42 = 881,664 vs 876,544（+0.58%）；len=60 → 512×61×62 = 1,936,384 vs 1,921,024（+0.80%，窗口峰值）。该偏差的实际吸收：设计自陈「实际成本低于定理界 3~10×」（定理界是 f=3、全重播种的保守口径），实际面无任何风险；**声明精度修正**——表列条件 `L·m_sub·f_sub ≲ 512 且 (len+2)²×P ≤ 4M` 在该窗口内是包络的**近似**（偏差 ≤ 0.8%）而非严格充分条件，P 的严格有效域为 `P ≤ 512·len²/(len+1)(len+2)` 且仅在 len ≤ 30 有线性项/截距补偿。不修二次项系数（640 方案会使 §6.3 预算公式与附录 8 逐字冻结面再变动，0.8% 的声明偏差不值得该扰动——SA2 亦判定「修不修不影响放行」）。

### 6.5 四类 loud 失败（O6：**使用时暴露**语义，R2 定稿；全部 ok:false + path 定位）

**使用时暴露（暴露时点的冻结读法）**：spec §9.1 把非法正则的暴露时点委托给语义层（validateSnapshot）；本设计在层内进一步定稿为「**该校验位被到达时**」——`validateValue` 抵达 pattern 节点（含 §4.1 Record keyPattern 的逐键判定）即编译并按需判定。**未到达的位不编译不暴露**：`Pattern<"[">` 挂在 optional 缺席字段 / 空 Record（无键）/ 空数组（无元素）上 → `ok:true`——这是冻结语义而非静默降级（该正则从未被要求执行任何判定；急切编译不可取：pattern 节点经别名共享，issue path 无唯一定位——同一模式可同时是多个字段/Record 键位的来源）。

| 触发 | 消息（冻结） |
|---|---|
| 语法非法（如 `Pattern<"[">`——spec §9.1 明文该暴露点属 validateSnapshot） | `Pattern 正则无法编译：/${regex}/（${detail}）` |
| 子集外构造（`(?<=` `(?<!` `(?<name>` `\k<` `\p{` `\P{` 内联标志 `(?i`、**反向引用 `\1`~`\9`（R2 收窄）**、类内 `\`+数字 等） | `Pattern 正则含匹配器不支持的构造：${construct}（子集清单见设计 §6.2）` |
| **编译期程序规模超限**（{n,m} 展开超 10_000 指令——R2 单列：编译期无输入上下文，消息不携带输入长度/预算参数，#9-a） | `Pattern 正则程序规模超限：/${regex}/ 编译产物超过 10000 指令（量词展开 ${copies} 份）` |
| 匹配步数预算耗尽（运行期，携带单匹配上下文） | `Pattern 匹配步数预算耗尽（输入长度 ${n}，预算 ${budget}）：无法在预算内判定匹配性` |

预算耗尽的语义立场（诚实边界，非误报）：**不宣称「不匹配」**——消息明示「无法判定」；ok:false 与「写入被拒」的零写入语义一致（无法证明合法即不放行，fail-closed）。ReDoS 红灯仅锚定 `ok:false` ✓。全局工作预算耗尽（§3.4）是第五类同级边界（消息含「校验工作预算」，调用级）。

### 6.6 红灯对账（R2 重新对账——ReDoS 行为路径变更）

- `(a+)+$` × 33 字符：编译 ✓（无反向引用、嵌套量词在子集内）→ 模拟 ~840 步**多项式完成** → 真值 = 不匹配（`'!'` 挡在 `$` 前）→ issue `不匹配 Pattern 正则 /(a+)+$/` → `ok:false` ✓ 微秒级返回 ✓。**R2 修订记录**：R1 对账的「执行耗尽 4_096 步 → 预算耗尽 issue」路径作废——新引擎下预算不触发，正确路径是完成后的真值判定；对抗性不变（朴素回溯引擎该输入需 2^31 步，本引擎 840 步，八个数量级差），红灯断言（仅 `ok:false`）两路径下均绿，修复与验收兼容；**R3 成文说明（SA2 R2-1 修订要求）**：`(a+)+$` **前瞻-free，属定理 T1 类**——R3 的定理分列与预算二次项重标定不触碰 T1 类的线性界与线性预算项，本条对账在 R3 下逐字不变；红灯面其余两模式（`^[a-z]{2,4}$`、AssetId `^[A-Za-z0-9_\-]{1,64}$`）亦均无前瞻（实核 test.ts:50/328/352），全部落在 T1 类——**R3 修订对红灯对账零影响**；
- `^[a-z]{2,4}$`：'ab'/'abcd' 匹配 ✓；'AB' 不匹配 issue path `['name']` ✓；
- fixture AssetId `^[A-Za-z0-9_\\-]{1,64}$`：`\-` 在类内转义全集内 → 编译 ✓（§6.2 fixture 自伤核对）；合法键匹配、`abc.123` 拒绝（Record 键 Pattern，§4.1）✓；
- SA2 §5 探针预期（设计面成文，供复审验证）：`(a?)*b` / `(a*)*b` × `'b'` → `ok:true`（空迭代闭包去重）；`(?:(a)(b)(c)(d)(e))*z` × 长 'abcde'×n + 不匹配尾 → 多项式完成正常返回（无回溯栈即无 OOM 面）。

---

## §7. YXmlFragment 良构性检查（`src/xml.ts`）

票 B（#20）映射执行（ADR 0003 §5 + #20 设计 §6）：JSON 快照中该位为 **XML 字符串**（与 `Y.XmlFragment.toJSON()` 投影一致），运行时校验仅要求**良构**——实参字段不进结构树、不参与校验（不透明语义）。

零依赖良构检查器（**片段语义——多顶层元素森林 + 顶层字符数据均合法**，R2 放宽，SA2 #7）：

**R2 放宽记录**：R1 的「顶层非空白文本 → false（片段是元素序列）」论断不实——`Y.XmlFragment` 的子节点可含顶层 `Y.XmlText`，其 `toJSON()` 投影是**顶层纯文本**（body `'hello world'`）或**文本与元素混合**（`'hi <b>b</b>'`），均为合法 Yjs 投影；R1 已采纳多根森林、独禁顶层文本，是对「良构片段」语义的半途而废（外部实体的片段语义本就容纳多根与顶层字符数据）。按 R1 自设的「与 `Y.XmlFragment.toJSON()` 投影一致」口径反向校准：顶层文本必须放行，否则合法快照被误拒。放宽后规则统一为「仅要求标签栈平衡与良构结构」。

```
wellFormedXml(s): boolean    # 单遍扫描 + 显式标签栈（无递归）
  跳过：<?…?> 处理指令 | <!--…--> 注释（未闭合 → false）| <![CDATA[…]]>（未闭合 → false）
  顶层文本：允许（任意内容，含纯文本 'hello world' 与混合 'hi <b>b</b>'——R2 放宽，见上）
  元素：< name attr* (/ > | > 子内容 </ name >)
    name：[A-Za-z_:][A-Za-z0-9_.:-]*；attr：name S* '=' S* ("…" | '…')
    引号强制，未引 → false；**属性值为原子单元**：从开引号扫描到配对闭引号（另一引号字符不闭合），
    引号内一切字符（含 '<' 与 '>'）为字面量——`<p title="a>b">` 良构 ✓（R2 成文，SA2 #7）；未闭引号 → false
  文本中裸 '<' 后非合法标签起点 → false；实体宽松（接受裸 & 与未声明实体——Y 投影侧已转义，宽松度冻结）
  <!DOCTYPE → false（片段投影不携带，按不支持处理）
  终态：标签栈空 且 扫描至串尾
```

红灯对账：`'<p>hello <b>world</b></p>'` 良构 ✓；`'<p>unclosed'` 栈非空 → 拒绝，path `['assets','text1','body']` ✓；`body: 42` 非字符串 → 类型不匹配 ✓。放宽面（红灯未覆盖，SA2 §5 探针预期）：`'hello world'` / `'hi <b>b</b>'` → 良构 `ok:true`；`'<p title="a>b">x</p>'` → 良构（属性原子扫描）。

---

## §8. 全收集 + 100 条上限 + 截断标记（O2 定稿）

### 8.1 收集器两态

```
emit(path, makeMessage):                                          # R4：消息构造门控在物化态（thunk 签名冻结，§3.2）
  if issues.length < LIMIT(=100): issues.push({ message: makeMessage(), path: [...path] })   # path 冻结副本
  else: overflow += 1                                             # 计数态：继续遍历、不物化、**不调用 makeMessage**
```

- **不提前终止**：达 100 条后遍历继续（计数态）——全收集语义的本意是诊断完备，提前终止使「另有 N 处」不可知；遍历成本与合法快照的完整校验同阶（O(快照规模)，本就是每次调用的固有成本），上界不因收集策略变化。
- **计数态零消息构造（R4 门控，SA2 R3-2b）**：`makeMessage` 只在物化态执行——计数态的 overflow++ 循环不产出任何消息字符串与 preview（preview 0 单位、零字符串垃圾）；这是 §5.7-3 契约事件行口径成立的前提（枚举错位节点最坏 ~3 单位/进入而非 51）。
- **计数态下的距离计算不受影响**：`countIssues` 用独立计数 sink，与 emit 通道正交（§5.2 段 2 在计数态照常产出精确距离；countMemo 命中使计数态的重复距离查询 O(1)）。
- 资源界在计数态照常生效：单次 Pattern 匹配预算（每模式应用独立）与**全局工作预算**（countIssues 是计费点，§3.4）在计数态照常计费——计数态不放大资源消耗。

### 8.2 截断标记（唯一追加点：主流程末尾）

```
if overflow > 0:
  issues.push({ message: `校验问题超出 100 条上限，输出已截断（truncated）：另有 ${overflow} 处问题未报告`, path: [] })
```

- 恰在真实 issue 数 > 100 时出现（=100 时无标记——「超限」的精确读法）；总数恒 = 100 真实 + 1 标记 = 101 ✓；
- 可区分性：消息含「截断」「truncated」双信号（红灯 /截断|truncat/i）；path 为 `[]`——真实 issue 的 path 至少含对象字段段/数组段或为类型不匹配的值 path，`[]` 仅出现于 ROOT 级类型错与标记——**再叠加消息措辞区分**，双重可辨识；
- 红灯对账：150 个非 number 元素 → 100 真实 + overflow=50 → 101 条、`issues[100]` 为标记 ✓。

---

## §9. path 段数组与确定性

### 9.1 段表示（O1 定稿）

| 位置 | 段类型 | 例 |
|---|---|---|
| 对象字段 / Record 键 | `string`（任意字符，整段相等，零转义） | `['assets','abc.123','v']`、`['m','a.b|c[d]','v']` |
| 数组元素（YArray 值位 / YPlainArray / 值树 array） | **`number`**（下标） | `['keywords',1]`、`['items',0,'count']` |
| ROOT 级 | `[]`（空数组） | 顶层类型不匹配 / 截断标记 |

红灯仅锚定首段与段数（`p[0]==='keywords' && p.length===2`；`['items',…,'count']` 长度 3）——number 表示与之兼容；JSON 往返 number 不变形 ✓。

### 9.2 遍历序冻结（输出确定性）

- 封闭对象：必填缺失（字段声明序）→ 未知键（快照键枚举序）→ 在场字段（字段声明序）；
- 「快照键枚举序」的精确读法（R2 修正，#9-c）：ES 对象枚举序对**整数形态键**（canonical numeric string，如 `'0'` `'42'`）按数值升序**先行**，其余字符串键按插入序——「快照键插入序」的说法对整数形态键不确切；两序均为引擎确定行为，输出确定性不受影响（`Object.keys` 语义冻结依赖）；
- Record：键按快照键枚举序（同上精确读法），逐键（键 Pattern → 值下钻）；
- 数组：下标升序；
- 联合：候选/成员按声明序；距离平局取声明序在前者；
- 同一快照两次调用 / JSON 往返后的派生物 → 输出逐字节全等（红灯 `toEqual` 锚点）。

---

## §10. 防御性设计：不变量与 loud 边界（虚假降级禁令审查）

| # | 条件 | 应然性判定 | 处置 |
|---|---|---|---|
| I1 | `derived.values['ROOT']` 存在 | 合法派生物恒真（evaluate 必产） | 缺席 → throw InternalError → 顶层 catch → E100 issue（path `[]`），不静默 |
| I2 | 值树 ref 链无环、名皆在表 | 合法派生物恒真（E106/E301 上游收口；`stripDiscriminators` 类纯删键操作不破坏） | in-flight 检测 / 表查询缺席 → InternalError → E100（§3.1） |
| I3 | 值树成员位不出现 `optional` 包装 | 恒真（#20 §6：optional 仅字段位包装） | 到达 → InternalError → E100（穷尽 switch 的不可达臂） |
| I4 | Pattern regex 为 string | 恒真（派生物类型契约） | 非法正则**不是**不变量违反——是 spec §9.1 显式委托本层暴露的数据问题 → 专用 issue（§6.5），非 E100 |
| R1 | 快照含非 JSON 运行时值（undefined/function/…） | 快照契约外，但运行期可发生 | present() 语义处理 undefined；其余按结构落到类型不匹配诊断（§3.3）——可观测拒绝，不静默 |
| R2 | 手造/篡改派生物（环、缺名、垃圾形状） | 契约外输入 | 一律 loud E100（parseVfsl/evaluate 同款崩溃边界），绝不 ok:true 伪装 |
| R3 | 超深快照递归栈溢出（RangeError） | 资源边界（合法但病态的数据） | 崩溃边界收编为 E100 issue——可观测、不伪装成功；深度仅受运行时栈约束（R2 修正：值树**解析后**深度无 ≤100 上界——ref 链可组合更深，§3.2；类型表达式层的 `MAX_TYPE_NESTING=100` 不约束解析后结构），JSON.parse 自身的解析深度通常先于本层成为瓶颈——但兜底不依赖该经验排序 |

判定依据（SKILL 立法）：I1~I3 在功能完备系统里应恒真 → 不设计降级，设计报警；I4/R1/R2/R3 是真实的异常/边界路径 → 显式诊断而非吞没。**全程无一处 `if (!x) return fallback` 式静默降级。**

纯度与不可变：不写 `derived` / `snapshot`（只读遍历）；issue path 一律冻结副本；正则编译缓存为调用局部 Map——「编译一次、校验多次」指派生物复用，非进程级正则缓存（避免跨调用状态，保纯函数契约）。

---

## §11. 红灯测试逐条对账（33 条 → 设计章节映射；§11.1 处置落地后为 34 条面）

| describe（条数） | 设计依据 | 关键锚点核对 |
|---|---|---|
| 接缝：签名、结果形状与 JSON 往返（8） | §2 | `{ok:true}` 恰含 ok 键 ✓；issue 恰含 message+path ✓；JSON 往返 ✓；纯函数 + 派生物不 Mutation ✓（§10 末段）；编译一次校验多次 ✓（调用局部态）；JSON 往返派生物输出全等 ✓（§9.2 确定性）；非对象顶层（null/42/'str'/true/[]）→ object/union ROOT 类型不匹配或无候选 → ok:false ✓ |
| 结构校验：封闭对象 / 必填缺失 / leaf·plain 不下钻（6） | §4 / §4.1 | ROOT 层未知键 `['extraKey']` ✓；联合命中成员内未知键 `['assets','img1','unexpected']` ✓（实际流程：段 0 命中 kind:image 但 countIssues>0 → 段 1 候选过滤 `{image}` → **段 3 候选分支 dive**（§5.2 唯一权威），封闭语义照常——R2 修正措辞，消除与 §5.2「接受 = 零输出」的走样空间，#8）；恰 4 条一次报全 ✓；optional 缺席合法 ✓；leaf 收对象 → `['notes']`、数组元素对象 → `['keywords',1]` 长度 2 ✓；plain 收非数组对象 → `['attachments']` ✓ |
| 值校验：原始类型 / 字面量枚举 / optional / Pattern（6） | §4 / §6 | 五原始类型各自认领、unknown 全收、恰 4 条 ✓；枚举 `kind:'video'` → 候选空 → 汇总+下钻含 `['assets','img1','kind']` ✓；端口枚举 80/443 vs 8080 → `['port']` ✓（值树折叠为 enum 节点，§4）；Pattern 匹配/不匹配 ✓；Record 键 Pattern `abc.123` 拒绝 ✓；ReDoS 对抗 → NFA 多项式完成（~840 步，T1 类）→ 真值「不匹配」→ `ok:false` 毫秒级 ✓（§6.4/§6.6——R3 成文：三红灯模式均前瞻-free，修订零影响） |
| 联合：any-of / 判别式缓存透明 / no-match 最小距离（6） | §5 | 三 kind 各自命中（缓存跳转 + 无缓存扫描双路）✓；ref 成员联合（无判别式缓存）逐成员尝试 ✓（§3.1 解析 + 段 1/2）；stripDiscriminators 两路径匹配输出全等 ✓（§5.6）；no-match 输出全等 ✓；`{kind:'video'}` → 距离 5/3/5 → `联合成员 2/3` ✓（§5.4 校准）；平局 `{x:42}` → 双矛盾候选空 → 距离 2/2 → `联合成员 1/2` ✓ |
| YPlainArray 纯值上下文嵌套 JSON（2） | §4 array 行 + **§11.1（测试缺陷处置）** | **首条用例为 SA6 测试文本缺陷**（SA2 #2：`YPlainArray<{…}[]>` 派生为双重数组，两条断言均不可满足）——处置定稿见 §11.1：修正文本为 `YPlainArray<{…}>`（断言不动）后，嵌套封闭对象 `['items',0,'count']` 长 3 ✓；补双重数组锁例（`[[{…}]]` → ok:true / `[{…}]` → ok:false）钉死 #20 映射 ✓；混合联合 `string \| {a:number}`：'s' 与 {a:1} 各命中 ✓、{b:1} 候选下钻报未知键 ✓、42 无候选汇总 ✓ |
| YXmlFragment（1） | §7 | 良构通过 / `<p>unclosed` 拒绝 `['assets','text1','body']` / 非字符串拒绝 ✓ |
| path 段数组：Record 键特殊字符零转义（1） | §4.1 / §9.1 | `['m','a.b|c[d]','v']` 等三键整段相等、恰 3 条 ✓ |
| 全收集 + 100 上限 + 截断标记（1） | §8 | 150 错 → 101 条、`issues[100]` 标记匹配 /截断\|truncat/i、path 数组 ✓ |
| §10 fixture：合法 / 非法快照（2） | 全章节 | 合法 → 恰 `{ok:true}` ✓；非法 7 处独立错误一次报全（img1 三条成员内 + attachments/audit.createdBy/notes/keywords[0]）→ **恰 7 条**——联合段 3 候选分支零汇总混入是计数成立的关键（§5.2 段 3）✓ |

**typecheck**：公共导出落地后 TS2305 消除、15 条 TS7006 级联随 `any` 传播链断开自消（§2.3）。

### 11.1 红灯测试缺陷处置：首条 YPlainArray 用例（R2 新增，SA2 #2 CRITICAL 定稿）

**事实链（设计期核对，非转述）**：

- 红灯测试 `packages/vfsl/test/validate-snapshot.test.ts:422-434`：文本 `type ROOT = { items: YPlainArray<{ name: string; count: number }[]> };`，断言 `{items:[{name:'a',count:1}]}` → `ok:true`、`{items:[]}` → `ok:true`、坏例存在长 3 且以 `count` 结尾的 path；
- #20 冻结映射（`evaluate.ts` marker 分支）：`YPlainArray<T>` → `{kind:'array', element: valueOf(T)}`；此处 `T = {…}[]` 本身又是一层 array → 派生树 = **双重数组** `array(array(object))`（SA2 探针 P1 实测同果）；
- 忠实解释该值树（§1.2 核心决策）：`items[0] = {…}` 对内层 array 节点报「类型不匹配：期望数组，实际 object」→ `ok:false`、path `['items',0]` 长 2——**两条断言（ok:true / 长 3 path）在忠实实现下均不可满足**。R1 §11 该行对账「✓」失实（SA1 未做派生树核对）。

**判定**：SA6 测试文本缺陷——`[…]` 多写了一层数组；用例意图是「元素为封闭对象」（断言与描述均按单层数组写），正确文本应为 `YPlainArray<{ name: string; count: number }>`。

**处置（三步，授权链完整，SA3/SA4 锚点）**：

1. **授权修正测试文本**：`YPlainArray<{ name: string; count: number }[]>` → `YPlainArray<{ name: string; count: number }>`，**断言逻辑零改动**（两处 `ok:true` + 长 3 path 三处断言全保留）。授权依据：§13 ALLOW LIST 该测试文件条目的「仅允许测试基础设施级修正且须在 PR 说明」条款 + SA2 R2 #2 修订要求显式授权 + 本节定稿；PR 说明须引用本节。
2. **补双重数组正例（把 #20 映射钉进测试面）**：同 describe 追加一条 `it`——文本 `YPlainArray<{ name: string; count: number }[]>`：× `{items:[[{name:'a',count:1}]]}` → `ok:true`（双重数组忠实解释：元素是 `{…}[]`）；× `{items:[{name:'a',count:1}]}` → `ok:false`（单层对象不是数组）。堵死「拍平兜底」的转绿路径。
3. **禁止 SA3 兜底拍平（负面清单，SA4 静态评审锚点）**：不得为让原文本转绿而做以下任一——(a) `YPlainArray` 实参自动解一层 `[…]`（改派生映射的忠实解释）；(b) array 节点对「期望数组收到对象」宽容放行；(c) validate.ts 内任何「双重数组 + 单元素」特判。双重数组本身就是 `YPlainArray<T[]>` 的正确语义（元素是 `T[]`）——任何拍平都是静默破坏 #20 已冻结的派生语义。

---

## §12. 实现文件与版本

| 文件 | 动作 | 内容（预估行数） |
|---|---|---|
| `packages/vfsl/src/pattern.ts` | 新建 | §6 NFA 子集模拟匹配器：Annex B 解析（含 §6.2 类内/类外转义全集与 IdentityEscape 立场）+ 编译（无捕获字节码 + 程序规模上限 + 类集合）+ 模拟（闭包/重播种/前瞻子模拟 + 步数预算 + charge 钩子）+ 四类 loud 失败（~450 行；R2 重估：转义全集枚举与模拟器取代回溯栈后较 R1 估的 ~350 行增） |
| `packages/vfsl/src/xml.ts` | 新建 | §7 良构检查器：单遍扫描 + 标签栈 + 属性原子扫描（~90 行） |
| `packages/vfsl/src/validate.ts` | 新建 | §3 解析器/主流程/资源账本（charge + 双记忆化 + WorkBudgetExceeded）+ §4 全景表 + §5 联合三段（含 §5.7 资源完备性落点）+ §8 收集器 + ValidateIssue/ValidateResult 类型（~380 行） |
| `packages/vfsl/src/index.ts` | 修改 | `export { validateSnapshot } from './validate.js'` + `export type { ValidateIssue, ValidateResult }` + 头注释第三公共导出段（≤ 12 行） |
| `packages/vfsl/package.json` | 修改 | `version: 0.1.5 → 0.1.6`（Hard Gate #9） |

内部件（pattern/xml/validate 的具体函数）不导出到公共面（沿 tokenizer/parser/semantic 不导出先例）；公共面新增 = `validateSnapshot` + 两个类型。**零新增依赖**（devDependencies 不变）。

---

## §13. 文件清单（File Scope）

### ALLOW LIST
- `packages/vfsl/src/validate.ts` — 新建，校验核心（§3~§5、§8；ValidateIssue/ValidateResult 类型随此文件定义）
- `packages/vfsl/src/pattern.ts` — 新建，NFA 子集模拟匹配器（§6，ReDoS 防护定稿的落地位；R2 引擎重设计）
- `packages/vfsl/src/xml.ts` — 新建，XML 良构检查器（§7）
- `packages/vfsl/src/index.ts` — 修改，第三公共导出 `validateSnapshot` + 类型 re-export + 头注释（≤ 12 行）
- `packages/vfsl/package.json` — 修改，版本 0.1.5 → 0.1.6（1 行）
- `packages/vfsl/test/validate-snapshot.test.ts` — `[SA6 owned]` 红灯验收测试（已存在，SA6 Phase 1 交付，commit f9e4790）。SA3 不得改断言逻辑；仅允许测试基础设施级修正且须在 PR 说明。**R2 修订追加（SA2 #2 授权扩展，原 DENY 无此文件、ALLOW 原条目内扩权）**：(1) §11.1 定稿的首条 YPlainArray 用例测试文本修正（`[…]` → `YPlainArray<{…}>`，断言零改动）；(2) 同 describe 追加双重数组锁例一条（§11.1-2）。两处改动均须在 PR 说明引用 §11.1；其余 31 条断言逻辑仍不得触碰

### DENY LIST
- `packages/vfsl/src/parser.ts` / `tokenizer.ts` / `semantic.ts` / `shapes.ts` — 解析层已冻结，本任务零改动（validateSnapshot 只消费派生物）
- `packages/vfsl/src/evaluate.ts` / `derived.ts` / `resolve.ts` — #20 已合入的求值器与派生 schema 冻结形状；`resolve.ts` 不为复用而改（§3.1：能力模式复用，非代码调用）
- `packages/vfsl/src/ir.ts` / `errors.ts` — IR 与错误注册表是已冻结公共契约（`makeIssue`/`ErrCode` 本票不 import——ValidateIssue 无行列字段，E100 前缀经模板字面量直书，§2.2）
- `packages/vfsl/test/parse-*.test.ts` / `evaluate-derived-schema.test.ts` — 既有 253 条测试，本任务不动
- `docs/adr/**` / `docs/vfsl/**` — ADR 与 v1-spec 冻结；spec §9.1 委托的正则暴露语义在实现层兑现，规格侧无增改
- `packages/vfsl/tsconfig.json` / 根 `tsconfig.base.json` / `pnpm-workspace.yaml` / 根 `package.json` — 编译与工作区配置不动

---

## §14. 协议假设依据 (Protocol Assumption Evidence)

| 假设 | 依据类型 | 依据内容（具体引用） | 风险等级 |
|---|---|---|---|
| YXmlFragment 的 JSON 快照值为 XML 字符串、校验仅要求良构 | 设计文档引用（ADR，仓内权威） | `docs/adr/0003-evaluator-derived-schema.md` §5：「JSON 快照中其值为 XML 字符串（与 `Y.XmlFragment.toJSON()` 投影一致），运行时校验仅要求良构 XML」；前票设计 `wiki/raw/task_vfsl-evaluator_design.md` §6 YXmlFragment 行同源（值树 `{kind:'xml'}`）。**本票按简报指派执行票 B 映射，不新立协议**。「良构」的 R2 读法 = 标签栈平衡 + 良构结构（多根森林 + 顶层文本均合法，§7 放宽记录——放宽方向是安全方向，不依赖任何外部投影断言） | 低（ADR 冻结文） |
| Pattern 按「ECMAScript RegExp（无标志）解释」，其合法性暴露时点在 validateSnapshot | 规格引用 | `docs/vfsl/v1-spec.md` §3 Pattern 节 + §9.1：「实参解码后是否为合法正则不在方言层校验……非法正则的暴露时点属语义层（validateSnapshot）」。§6.2 子集为该语义的实用子集——子集外构造 loud 拒绝（§6.5）是开放点 O3「ReDoS 防护 vs 零运行时依赖」的定稿权衡，简报明文授权 SA1 定稿 | 中（子集边界是本设计新立的冻结项，SA2 主场） |
| ReDoS 对抗用例的朴素 RegExp 行为（`(a+)+$` × 'a'*32+'!' 指数回溯远超 5s） | 现有测试引用 | `packages/vfsl/test/validate-snapshot.test.ts`「Pattern ReDoS 对抗」用例注释（SA6 Phase 1 已 commit f9e4790）；R2 行为路径：NFA 模拟 ~840 步多项式完成并真值判定「不匹配」（§6.4 定理 + §6.6 重新对账）——对抗性改为「朴素引擎 2^31 步 vs 本引擎 840 步」的结构性差距，不再依赖「预算恰好先耗尽」的标定巧合 | 低 |
| vitest 默认单测试 5s 超时作为对抗兜底 | 现有测试引用 | 同上用例注释「vitest 默认 5s 超时兜底」；vitest 3.x 默认 testTimeout=5000（devDependencies `vitest: ^3.2.4`，package.json） | 低 |
| 派生物为纯数据（JSON 可序列化、无行列）——消费侧不做形状防御的前提 | 现有测试 + 前票设计引用 | `derived.ts` 头注释纪律段；红灯「JSON 往返后的派生物校验结果全等」用例（clone 后校验）已锚定该前提 | 低 |

无 HTTP/WS 端点、端口/进程生命周期、跨进程资源类假设；无第三方库行为假设（**零新增运行时依赖**是本设计硬约束，§6.1 否决案均以此为据）。

---

## §15. 契约改动连锁审计 (Contract Change Caller Audit)

**无契约改动：本设计仅涉及新增公共导出（`validateSnapshot` 函数 + `ValidateIssue` / `ValidateResult` 类型）与版本号 bump——不修改任何既有函数的签名、返回类型、throw 行为或同步性。**

- `parseVfsl` / `evaluate` 及全部内部件（tokenizer/parser/semantic/shapes/resolve/ir/errors/derived）零改动；
- 新增函数无存量 caller；仓内首个消费者为 SA6 红灯测试 `packages/vfsl/test/validate-snapshot.test.ts`（import 自 `../src/index.js`）；
- 下游消费者（快照加载入口、迁移后体检、管理端点——CONTEXT.md「整文档校验」词条所列）属后续票，将以 `ValidateResult` 结果联合为契约：调用方从第一天写 `ok` 判别检查（与 ADR 0003 §1 对 `evaluate` 的前向兼容立场的同构纪律）；
- 语义契约面（新函数自身）：同步、纯函数、不抛错、全收集、100 上限——均在 §2.2 冻结，SA4 §1.5 比对时以本节「无契约改动」声明 + §2.2 契约清单为参照。

---

## §16. SA2 R2 评审逐条回应（9 项发现 → 修订映射）

| # | 要求（SA2 评审 §1/§2） | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|---|---|---|
| 1 | CRITICAL：联合扫描消费侧预算（记忆化 + 全局预算双保险 + 覆盖性论证，兑现 ADR 0003 §4 委托） | ✅ | §3.4（新）、§5.2、§5.7（新）、§8.1 | (解析后节点, 值) 双记忆化（countMemo/contraMemo，外键节点对象与爆炸源结构性重合）+ 全局工作预算 16M（charge 计费全覆盖 + WorkBudgetExceeded loud、三重可区分）；§5.7 四层覆盖性论证（菱形类键重合消灭 / 非共享乘积构造性兜底 / 合法包络 3~5 数量级余量 / 内存封顶）；ADR §4 原文引用逐句兑现；countIssues 短路删除（精确计数保 argmin 平局正确） |
| 2 | CRITICAL：显式定稿首条 YPlainArray 红灯的测试缺陷处置（授权改文本、断言不动 + 补双重数组正例 + 禁拍平） | ✅ | §11.1（新）、§11 表、§13 ALLOW LIST | 判定测试文本缺陷（事实链三段：文本/派生树双重数组/两条断言不可满足，R1 对账失实自认）；三步处置：授权改文本 `YPlainArray<{…}>`（断言零改动，PR 说明引用 §11.1）+ 补 `[[{…}]]` 锁例 + SA3 拍平负面清单三条（SA4 锚点） |
| 3 | HIGH：类内转义全集枚举 + 类外 IdentityEscape 立场定稿 | ✅ | §6.2（重写）、§6.2.1 | 类内转义全集枚举（`\\` `\]` `\^` `\-`、类内 `\b`=U+0008、预定义类、`\cX`/`\xHH`/`\uHHHH`、类内 IdentityEscape、类内 `\`+数字 loud 拒）；类外 IdentityEscape Annex B 宽松立场定稿（保留前缀冻结清单）；fixture `\-` 编译通路显式自伤核对 |
| 4 | HIGH：空迭代守卫 + (pc,pos) 记忆化 + §6.4 重标定 + ReDoS 红灯重新对账 | ✅ | §6.3（引擎重设计）、§6.4（定理化重标定）、§6.6 | 字节码回溯引擎 → **NFA 子集模拟**：闭包 pc 去重 = 空迭代结构性守卫（`(a?)*b`×`'b'` → true）；状态集 = 已访集等价物（更强形态）；完成性定理取代标定推演；§6.4 补 R1 缺位类目「非锚定×中庸×结构化不匹配前缀」（`(a+)+b`×27c → ok:true）；ReDoS 重新对账：多项式完成 → 真值不匹配 → ok:false ✓（R1「预算耗尽」路径作废，红灯断言兼容） |
| 5 | MEDIUM：O6 改「使用时暴露」 | ✅ | §1.3 O6 行、§6.5 引言 | 定稿使用时暴露：校验位被到达才编译判定；optional 缺席/空 Record/空数组 → ok:true 为冻结语义（非静默降级——该正则从未被要求执行判定）；急切编译否决理由成文（别名共享 path 无唯一定位） |
| 6 | MEDIUM：回溯栈 undo-log / 内存上界论证 | ✅ | §6.3 末条、§5.7-4 | 比 undo-log 更强的处置：回溯执行器与捕获副本栈**整体消除**（引擎重设计）；活内存 O(\|prog\|)（状态集 ≤ 3×\|prog\| 槽 + 编译期类集合）；memo 65_536 条封顶 ≈ MB 级——OOM 绕过 E100 的路径不复存在 |
| 7 | MEDIUM：XML 顶层文本放宽或给权威依据 | ✅ | §7（R2 放宽记录 + 规则） | 放宽路线（SA2 预授权：给不出权威依据即放宽）：顶层文本（纯/混合）合法，规则统一为「标签栈平衡 + 良构结构」，与多根森林片段语义一致化；依据 = R1 自设的「与 toJSON() 投影一致」口径反向校准（顶层 Y.XmlText 投影是合法快照）；属性值引号内原子扫描成文（`<p title="a>b">` 良构） |
| 8 | MEDIUM：§11 措辞对齐 §5.2 | ✅ | §11 结构校验行 | 「段 2 接受 image 后下钻」→「段 0 命中但 issue>0 → 段 1 候选过滤 → **段 3 候选分支 dive**」——与 §5.2 唯一权威一致，走样素材清除 |
| 9 | LOW：文档级五项 | ✅ | §6.5（规模消息单列）、§6.2 前瞻行、§9.2、§3.2、§12 | (a) 编译期程序规模超限消息独立成行（不携带运行期上下文）；(b) 前瞻零回写在布尔 test 语义下与 JS 等价（成文于 §6.2）；(c) 「快照键插入序」→「快照键枚举序」精确读法（整数形态键数值升序先行，确定性无碍）；(d) 值树解析后深度可超 100（ref 链组合），R3 兜底论证句修正（不再依赖不确前提）；(e) pattern.ts ~450 / validate.ts ~380 行重估 |

**修订无效模式自检（SKILL「承认但不改」禁令）**：#1~#4 均为设计实质改动（新伪代码/新引擎/新章节），非旁注承认；#5~#8 均改写了对应章节的行为语义或措辞载体；#9 五项全部落在具体行。无「未来优化建议」型修订。

### §16-R3. SA2 复审 r2 逐条回应（6 项发现 → 修订映射）

| # | 要求（SA2 复审 r2 §1/§2） | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|---|---|---|
| R2-1 | HIGH：§6.4 定理对含前瞻模式不成立（真实二次界，~150 字符合法值即被线性预算误拒）——定理分列、包络表与蕴含式重写、ReDoS 对账不受影响成文 | ✅ | §6.4（重写）、§6.3（budget 公式 + lookMemo）、§6.6（成文说明） | R2 陈述为假**自认**（攻击构造 + node 实测 `/(?=.*;)z/` 引证）；定理分列 **T1**（前瞻-free 线性 `(len+2)×m×f`）/ **T2**（含前瞻二次，**子模拟独立预算 + (Look,pos) 结果记忆化**双管：lookMemo 使任意嵌套深度下二次界不变，剩余界如实陈述「单层前瞻的 O(len) 次评估记忆化不减」）；预算改 `min(4M, max(8192, 1024·len + 512·len² + 16384))`（形状对齐定理）；蕴含式分列重写（T1 类 m 包络 / T2 类 L·m_sub·f_sub × len 包络，R2 一揽子蕴含废弃）；包络表补 SA2 攻击构造行（202 字符 R2 必红 → R3 `ok:true`）与锚定对照行、T2 通用包络行（len ≲ √(4M/(L·m_sub·f_sub))）；§6.6 成文：`(a+)+$` 等红灯三模式均前瞻-free 属 T1 类，对账逐字不变 |
| R2-2 | HIGH：§5.7-3 包络标定未做乘法（与 §6.4 自家数字矛盾、590 键触顶误拒旗舰场景）——显式乘法推导 + WORK_LIMIT/计费粒度重标定 + 旗舰场景声明或 v1 契约冻结 | ✅ | §5.7-3（重写）、§3.4（WORK_LIMIT） | R2 自相矛盾**自认**（「常规 ≤ 10⁴」vs 自家单键保守界 2.7×10⁴）；乘法链三层显式（单次定理界 × 应用次数乘数〔Record 键/数组元素/联合全成员计数——R2 删短路的乘数如实计入〕 + 节点访问乘数）；**v1 快照规模契约冻结**（前瞻-free ≤ 5_000 次 × ≤64 码元 / 含前瞻 ≤ 50 次 × ≤256 码元 / 节点 ≤ 1_000_000，合计保守界 1.95×10⁸）；WORK_LIMIT 16M → **2×10⁸**；旗舰场景核对：3_000 AssetId 键 ≈ 1.7×10⁷ 单位（8.5%，实测口径 <1s——node 同形操作基准 1.9×10⁸ 次/秒）；超契约调用语义与最坏墙钟（1~5s，离线场景背书、可参数化）成文 |
| R2-3 | MEDIUM：计费表三个盲区（未知键扫描 / emit·overflow / preview 全量 stringify）——键与元素访问计费 + preview 有界化 | ✅ | §3.4（计费表补 4 行 + 攻击构造对账）、§4（preview 重定义）、§4.1（字段名索引） | 补行：键被访问（含纯遍历未知键）每键 1 / 数组元素被访问（含计数态）每元素 1 / emit·overflow 每次 1 / preview 每次常数 48；10⁸ 未知键构造 → 10⁸ 单位 > 2×10⁸ 上限的 loud 路径成文（10⁶ 键照常 101 条返回；**R4 括注**：本行对账句算术已被 §16-R4 R3-3 修正——正确口径是 2 单位/键、>10⁸ 键触发）；preview 定稿**增量序列化 40 字符提前终止**，禁止 `JSON.stringify().slice()`（探索深度 ≤ 40、成本被产出封顶）；§4.1 字段名索引 Map（调用局部）消除键数 × 字段数未计费线性扫描 |
| R2-4 | MEDIUM：§6.2 两行对 `\uZZ`/`\xZ` 处置相反 + `\u{…}` 非量词断言与实测相反——统一处置 + 修正断言 | ✅ | §6.2（字面量行 + IdentityEscape 行重写） | 统一权威：`x`/`u` 前缀非完整形 → **降级为该前缀字符字面量**（Annex B，与字面量行同读）；实测引证：`/\xZ/.test('xZ')===true`、`/\uZZ/.test('uZZ')===true`、`/\uq/.test('uq')===true`、完整形 `/\x41/.test('A')===true`；R2 IdentityEscape 行「非完整形 → loud」废弃；`\u{…}` 断言修正为「**正常量词规则**：合法量词作用于字面量 `u`（`/\u{2}/.test('uu')===true`、`/\u{2,3}/.test('uuu')===true`），非法量词形按 `{` 字面量（`/\u{,2}/`、`/\u{FFFF}/` 实测）」；`\p{`/`\P{`/`\k<` 保留 loud 但**两行一致 + 显式标注有意偏离基线**（实测 `/\p{L}/.test('p{L}')===true` 在案），裸 `\p`/`\k` 按 IdentityEscape |
| R2-5 | LOW：§6.2.1 三难论证不完备（undo-log 已解内存难）+ 混合引擎未否决——补否决段 + 收益分列 | ✅ | §6.2.1（重写） | 收益分列两条独立理由：**内存收益**（如实陈述 undo-log 可解——撤销已解靶子）与**定理收益**（反向引用 = 指数时间类，任何执行器不免，完成性退回预算兜底 = R1 #4-b 回归通道——不可工程消解的独立代价）；混合引擎四条否决理由分列（定理覆盖面缩水〔主因〕/ Annex B 边缘构造双实现语义分裂 / 测试面翻倍 / 需求面为零实核） |
| R2-6 | LOW：§6.2 缺 `\|` 交替行——补行 | ✅ | §6.2（新增交替行） | `Split(x,y)` 编译、优先级最低任意结合、**空交替臂合法**（ε 路径，`/a\|/.test('')===true`、`/(\|)/.test('')===true` 实测）、类内为字面量；与 §6.1「覆盖重叠交替」论据闭环 |

**修订无效模式自检（R3）**：R2-1/R2-2 落在定理陈述与预算公式（实质行为变更：预算函数形状、WORK_LIMIT 数值、lookMemo 数据结构）；R2-3 落在计费表与 preview/字段索引实现约束（可检行为：10⁸ 键构造从「预算失明慢循环」变为 loud）；R2-4 落在冻结表的处置语义（`\u{2}` 接受语言从错的 `'u{2}'` 修正为 `'uu'`）；R2-5/R2-6 落在决策记录与表行。全部为设计实质改动，非旁注承认。

### §16-R4. SA2 三审（r3）逐条回应（4 项发现 → 修订映射）

| # | 要求（SA2 三审 §1/§2） | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|---|---|---|
| R3-1 | MEDIUM：lookMemo 声明类型 `boolean[len+1]` 的稠密读法使「无 GB 面」失效（分配不计费、双预算失明、OOM 不可 catch）——稀疏存储规约 + 附录 8 禁令 | ✅ | §6.3（存储规约 + 活内存 bullet）、§5.7-4、附录 8 | lookMemo 类型改为 **`Map<Look 指令, Map<number, boolean>>`**（或等价复合键 Map）——只有被写的 (Look, pos) 槽才占内存，「每槽写入前必已付费 → 被写槽位被步数预算封顶」的论证对**实际占用**成立；**显式禁止** `new Array(len+1)` / `new Uint8Array(len+1)` 稠密预分配，SA2 攻击构造（200 空前瞻 × 10⁷ 码元 = ~600 单位 ↔ 2×10⁹ 槽）成文为禁令依据；§5.7-4「无 GB 面」措辞挂接稀疏规约；附录 8 增 SA4 静态锚点（pattern.ts 出现输入长度定长分配即 reject） |
| R3-2 | MEDIUM：v1 契约推导未取最坏口径（联合重入乘数 Π(Nᵢ+1) 缺席 + preview 枚举位 51 单位，三行同排满 2.36×10⁸ > 2×10⁸）——三修法任选/组合，修后合计须为各行上限之和 | ✅（取 **(i)+(ii) 组合**） | §5.7-3（乘法链 + 契约表重排）、§3.2/§4/§5.2/§8.1（thunk 门控）、§3.4（preview 计费行） | (i) 乘法链显式补**联合重入乘数 Π(Nᵢ+1)** 行（Nᵢ 次段 2 全成员 countIssues + 1 次段 3 dive；成员全相异时记忆化不救——契约行必须按重入后总数计；SA2 深度 30 构造 = 3^30 进入属超契约调用，loud 兜底语义闭合）；(ii) **emit 签名冻结为 `emit(path, makeMessage)` thunk**——计数态与计数 sink 不构造消息、preview 归零（全局 ≤ 100×48 = 4.8×10³ 独立行），枚举位最坏回落 ~3 单位；节点行维度改为**计费事件数**（≤ 3×10⁶，每事件恰 1 单位；union-free 下 ≈ 10⁶ 节点 × ~3 事件与 R3 承诺等价）；新合计 **1.35×10⁸ + 5×10⁷ + 3×10⁶ + 4.8×10³ = 1.88×10⁸ = 各行上限之和** ≤ 2×10⁸（余量 ~6%，node 复核）；WORK_LIMIT 不动（否决 (iii)——重排已闭合，无需扰动 §3.4/附录 8 冻结数值）；旗舰场景 R4 口径复核（1.5×10⁵ 事件 ≪ 3×10⁶，结论不变） |
| R3-3 | LOW：§3.4 对账句在 2×10⁸ 下失实（10⁸ 单位并不大于 2×10⁸；且漏计 2 单位/键的记账行） | ✅ | §3.4（R3 补行动机段） | 对账句修正：**>10⁸ 键触发 loud**（键访问 1 + emit·overflow 记账 1 = 2 单位/键 → >2×10⁸；1.1×10⁸ 键 → 2.2×10⁸ ✓ node 复核）；10⁸ 键恰 = 2×10⁸、`work > WORK_LIMIT` 不触发（刀锋）如实成文；10⁶ 键 ≈ 2×10⁶ 照常完成 101 条；R3 版失实归因（漏计记账行 + 16M 时代直觉）自认 |
| R3-4 | LOW：T2 包络「定理界 ≤ 预算」在 len ∈ (30, ~86) 窗口不严格（超界 ≤ 0.7%）——系数放宽或脚注精确化 | ✅（取**脚注**路线） | §6.4（包络表下边界脚注 + T2 蕴含式行交叉引用） | 脚注给出严格蕴含式 `P(len+1)(len+2) ≤ 512len²+1024len+16384`（P=512 ⟺ len ≤ 30）与有效域 `P ≤ 512·len²/(len+1)(len+2)`；窗口内定理界超预算项 ≤ ~0.8%（len=40：881,664 vs 876,544 = +0.58%；len=60：1,936,384 vs 1,921,024 = +0.80% 峰值——算术推导 + node 复核），由「实际成本低于定理界 3~10×」的实际余量吸收；表列条件在该窗口显式降格为**近似**而非严格充分条件；否决 640 系数方案（避免 §6.3 预算公式与附录 8 冻结面再变动——SA2 亦判定不影响放行） |

**修订无效模式自检（R4）**：R3-1 落在存储类型签名与负面清单（可检行为：SA2 IT 方向 200 空前瞻 × 2×10⁶ 码元用例从「OOM/超时」变为「稀疏实现瞬时 ok:true」）；R3-2 落在乘法链行、契约表维度重定义与 emit 签名（可检行为：10⁶ 枚举错位节点从 5.1×10⁷ 单位回落 ~3×10⁶——契约合计从被证伪的 2.36×10⁸ 变为闭合的 1.88×10⁸）；R3-3 落在对账句算术（可检行为：SA4 若按 10⁸ 键设计验证测试将得到「完成」而非「loud」——现已如实）；R3-4 落在包络表脚注与蕴含式交叉引用。全部为实质改动，非旁注承认。

## §17. 修订记录（commit 摘要）

- **§3.4（新）**：调用局部资源账本——charge 计费通道、WORK_LIMIT 16M、countMemo/contraMemo（65_536 条封顶清空重建）、WorkBudgetExceeded 消费路径（三重可区分）。
- **§5.2/§5.7（改/新）**：三段算法接入记忆化与计费；countIssues 短路删除（精确计数）；资源完备性四层覆盖性论证，兑现 ADR 0003 §4 消费者预算委托（菱形构造 U_k 攻击场景坍缩为线性）。
- **§6（重设计）**：回溯字节码引擎 → NFA 子集模拟（无捕获/无回溯栈/无 Backref）：§6.2 转义全集枚举 + IdentityEscape 立场 + 反向引用收窄（§6.2.1 决策记录）；§6.3 编译/模拟规格；§6.4 完成性定理 + 预算重标定（`min(4M, max(8192, 1024·len+16384))`，防挂死线降级为规模护栏，包络声明与定理界自洽）；§6.5 四类 loud 失败 + 使用时暴露定稿；§6.6 ReDoS 重新对账（真值判定路径）。
- **§7（放宽）**：XML 顶层文本合法化 + 属性值原子扫描。
- **§11/§11.1（改/新）**：联合行措辞对齐 §5.2；YPlainArray 测试缺陷三步处置（改文本/补锁例/禁拍平清单）。
- **§9.2/§12/§13/§14（文档级）**：键序精确读法、行数重估、ALLOW LIST 授权扩展（SA2 #2）、协议假设表两行更新。
- **不变项**：接缝形状（§2）、全景表与消息格式（§4）、联合语义主体（§5.2 三段算法结构）、截断语义（§8）、path 规则（§9.1）、loud 边界表（§10）、版本 bump（0.1.6）——SA2 攻击后仍屹立六项（评审 §6）对应的设计面全部保留。

### R3 修订记录（2026-08-20，SA2 复审 r2 reject 后）

- **§6.3/§6.4（改）**：预算公式加二次项（`+ 512 × len²`）+ `lookMemo` (Look, pos) 结果记忆化（命中计费）；定理分列 T1（前瞻-free 线性）/ T2（含前瞻二次，嵌套任意深度下界不变）；R2 线性陈述为假自认（SA2 攻击构造 `(?=.*;)z` 引证 + node 实测）；「耗尽 ⟹ 超包络」蕴含式按类分列重写；包络表补攻击构造行（R2 必红 → R3 `ok:true`）、锚定对照行、T2 通用包络行。
- **§5.7-3（重写）**：单点标定 → 显式乘法推导（单次定理界 × 应用次数乘数 + 节点访问乘数）；v1 快照规模契约冻结（≤5_000 前瞻-free 次 / ≤50 含前瞻次 / ≤10⁶ 节点）；WORK_LIMIT 16M → 2×10⁸（§3.4 同步）；旗舰场景（3_000 AssetId 键）1.7×10⁷ 单位核对 + node 基准墙钟引证。
- **§3.4/§4/§4.1（改）**：计费表补 4 行（键访问 / 元素访问 / emit·overflow / preview）；preview 定稿增量 40 字符提前终止序列化（禁全量 stringify）；字段名索引调用局部 Map（消除键数 × 字段数未计费乘积）。
- **§6.2/§6.2.1（改）**：`\x`/`\u` 非完整形统一为 IdentityEscape 前缀字符字面量（实测对齐）；`\u{…}` 断言修正为正常量词规则（合法量词作用于 `u`）；`\p{`/`\P{`/`\k<` 两行一致 + 有意偏离基线标注；补 `\|` 交替行（含空交替臂 ε 路径）；§6.2.1 收益分列（内存可解〔undo-log 如实陈述〕/ 定理不可兼得）+ 混合引擎四条否决。
- **§6.6/§16/§17/头部/附录（文档级）**：ReDoS 对账不受 R3 影响的成文说明；R3 回应表与修订记录；附录增补第 8/9 条防走样指令。
- **不变项**：接缝形状（§2）、三段联合算法（§5.2）、NFA 引擎架构与指令集（§6.3 主体）、XML 良构检查器（§7）、截断语义（§8）、path 与遍历序（§9）、loud 边界（§10）、§11.1 测试缺陷处置、ALLOW/DENY LIST（§13）、协议假设与契约审计声明（§14/§15）——SA2 复审确认屹立项（评审 §7）全部保留；R3 全部改动落在论证/标定/表行层，不动架构主线（与复审结论「均为论证与标定层的修正」对齐）。

### R4 修订记录（2026-08-20，SA2 三审 r3 reject〔轻度〕后——四处局部补写，不动架构/定理/引擎主线）

- **§6.3/§5.7-4/附录 8（R3-1）**：lookMemo 存储规约改**稀疏物化**（`Map<Look, Map<number, boolean>>`，只有被写槽占内存）；稠密预分配（`new Array(len+1)` / `new Uint8Array(len+1)`）入禁令 + SA4 静态锚点；「无 GB 面」论证挂接稀疏规约（SA2 攻击构造 ~600 单位 ↔ 2×10⁹ 槽的失明面成文）。
- **§5.7-3/§3.2/§4/§5.2/§8.1/§3.4（R3-2，取 (i)+(ii) 组合）**：乘法链补**联合重入乘数 Π(Nᵢ+1)**；emit 签名冻结 **thunk**（`emit(path, makeMessage)`）——计数态/计数 sink 零消息构造、preview 归零；契约节点行改**计费事件数**（≤ 3×10⁶，union-free 下与 R3 的 10⁶ 节点承诺等价）+ preview 独立全局行（≤ 4.8×10³）；合计重排为**各行上限之和 1.88×10⁸** ≤ 2×10⁸（WORK_LIMIT 不动，否决 (iii)）；旗舰场景 R4 口径复核不变。
- **§3.4（R3-3）**：10⁸ 键对账句算术修正——>10⁸ 键（2 单位/键 → >2×10⁸）触发 loud，10⁸ 键刀锋上完成如实成文。
- **§6.4（R3-4）**：T2 包络边界脚注——严格蕴含式有效域（P=512 ⟺ len ≤ 30）、窗口 (30, ~86) 内超界 ≤ ~0.8%（len=40/60 算术 + node 复核）、由 3~10× 实际余量吸收、表列条件降格为近似；蕴含式行交叉引用；否决 640 系数方案（避免冻结面扰动）。
- **§16/§17/头部/附录（文档级）**：R4 回应表与修订记录；附录增第 10 条（emit 门控 SA4 锚点）、第 8 条增存储禁令；头部修订轮次链更新。
- **不变项**：接缝形状（§2）、三段联合算法（§5.2 主体——仅 countIssues bullet 增门控半句）、NFA 引擎架构/指令集/预算公式数值（§6.3——仅 lookMemo 存储形式）、T1/T2 定理陈述（§6.4 主体）、XML 检查器（§7）、截断语义与消息格式（§8——仅构造时点后移，格式零改动）、path 与遍历序（§9）、loud 边界（§10）、§11.1 测试缺陷处置、ALLOW/DENY LIST（§13）、协议假设与契约审计（§14/§15）——SA2 三审「仍屹立的项」（评审 §7）全部保留；R4 改动全部落在存储规约/契约口径/算术句/脚注层（与三审结论「局部条款补写」对齐）。

---

## 附：SA3 实现指令排序（防走样；R2 增补 3/6/7 三条）

1. **§5.2 是联合的唯一权威伪代码**——三段算法任何「简化」（如取消候选过滤、no-match 只报汇总不下钻、候选分支也加汇总）必红至少一条联合或 7 计数锚点（§5.1 张力表已推演）；**§5.7 资源完备性三件套（charge 计费 + 双记忆化 + WorkBudgetExceeded）不得省略**——省略则菱形联合挂死（§5.7 攻击构造），且无任何测试外的防护兜底；
2. §4 全景表的消息格式逐字实现（含中文标点）——`联合成员 ${i}/${N}`、截断标记的 `/截断|truncat/i`、预算耗尽消息的「校验工作预算 / Pattern 匹配步数预算耗尽」措辞是断言与可区分性锚；
3. §6 匹配器 = **NFA 子集模拟**：无捕获槽、无回溯栈、无 Backref 指令；运行路径**完全不出现原生 RegExp 构造**（`new RegExp(...)` 连编译探测也不用，杜绝引擎间行为差异）；反向引用 `\1`~`\9` 按子集外构造 loud 拒（§6.2.1）——**不得**为兼容而加回捕获/回溯；
4. path 段：数组下标 number、键 string、ROOT `[]`；emit 时冻结副本；
5. DENY LIST 文件零触碰；`packages/vfsl/test/validate-snapshot.test.ts` 仅限 §13 R2 授权的两处改动（§11.1）；改码后 `pnpm test`（286 条全绿 + §11.1 修正/新增后 34 条面）+ `pnpm typecheck`（零红）+ package.json bump 三件套缺一不可；
6. **禁止拍平兜底**（§11.1-3 负面清单）：不得改 `YPlainArray` 实参的忠实解释、不得对 array 节点宽容放行、不得做双重数组特判——测试转绿的唯一合法路径是 §11.1 的文本修正；
7. **countIssues 精确计数不短路**（§5.2）——短路值污染 argmin 平局比较；重复查询防护由 countMemo 承担。
8. **预算公式与记忆化逐字实现（R3，防 R2-1 类走样；R4 增存储禁令）**：单匹配 `budget = min(4_000_000, max(8_192, 1_024×len + 512×len² + 16_384))`——二次项**不得省略**（省略即 SA2 攻击构造 `(?=.*;)z` × 202 字符在实现面重现「合法值被误拒」）；`lookMemo` (Look, pos) 记忆化**不得省略**（省略则嵌套前瞻回到 len^(d+1)）；全局 `WORK_LIMIT = 200_000_000`（§3.4/§5.7-3 重标定后数值——实现 16M 会使 3_000 键旗舰场景误触顶）。**R4 存储禁令（SA2 R3-1，SA4 静态锚点）**：lookMemo 必须**稀疏物化**（`Map<Look, Map<number, boolean>>` 或等价复合键 Map）——**禁止稠密预分配** `new Array(len+1)` / `new Uint8Array(len+1)`（pattern.ts 出现对输入长度定长的数组分配即 reject）：分配不是计费步、双预算对其失明，200 条空前瞻 × 10⁷ 码元可在 ~600 单位下物化 2×10⁹ 槽，V8 OOM 不可 catch。
9. **计费与有界化纪律（R3，防 R2-3 类走样）**：快照键/数组元素**被访问即计费**（含不进 validateValue 的纯遍历键与计数态元素）；emit/overflow 记账计费；`preview` 必须是 40 字符提前终止的增量序列化——**禁止** `JSON.stringify(value).slice(0, 40)`（SA4 静态锚点：pattern 上出现全量 stringify 即 reject）；封闭对象/Record 的字段名查找用调用局部 Map 索引，**禁止**对 fields 线性扫描。
10. **emit 消息构造门控（R4，防 R3-2b 类走样——SA4 静态锚点）**：emit 签名冻结为 `emit(path, makeMessage)` thunk 形式（§3.2/§8.1）——计数态（issues.length ≥ 100）与计数 sink（countIssues/contraMemo 路径）**不得调用 makeMessage、不得构造消息字符串、不得运行 preview**（计数态出现字符串构造/preview 调用即 reject）——这是 §5.7-3 契约事件行口径（枚举位 ~3 单位/进入）成立的前提；§5.7-3 契约的节点维度是**计费事件数**（≤ 3×10⁶，含联合重入 Π(Nᵢ+1)），不是快照节点数。
