# SA1 设计 — validateSnapshot：整份 JSON 快照校验（issue #21）

- **Worktree**: `/home/wangjian/nomicore-fix-issue-21`（branch `fix/issue-21-on-adr-union-representation`，stacked on `40c1be0`）
- **任务类型**: 功能开发（Feature）
- **修订轮次**: R1（2026-08-19，首版）
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
| O3 | ReDoS 防护机制 | **包内受限回溯匹配器**（pattern.ts：正则 → 字节码 → 显式回溯栈执行 + 步数预算），彻底不用原生 `RegExp.test` 做匹配——零运行时依赖纪律保持，且预算按构造覆盖一切模式（含多项式炸弹），非「静态风险分析 + 原生兜底」的不完备防护 | §6 |
| O4 | 失败距离度量 | **成员校验的 issue 计数**（把快照值对成员做完整校验，产生的原子 issue 数即距离；非对象值对对象成员 = 1）。两个红灯锚点校准：fixture `{kind:"video"}` → image 5 / text 3 / file 5 → 报 2/3；平局例两成员各 2 → 按声明序报 1/2 | §5.4 |
| O5 | 联合「命中成员」语义（本设计补立） | **候选过滤 + 零 issue 接受 + 最小距离报告**三段算法（§5.2）。纯 any-of（∀成员 issue>0 → 全拒）与 fixture 7 条精确计数测试冲突——kind 命中的成员必须**下钻报字段级错误**而非联合级汇总；候选 = 无「硬矛盾」的成员 | §5 |
| O6 | 非法正则暴露（spec §9.1 委托） | `Pattern<"[">` 类非法正则、匹配器子集外构造、步数预算耗尽均**loud issue**（ok:false + 具名 message + path），不静默、不误报「不匹配」 | §6.5 |

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
- **编译一次、校验多次**：`derived` 是可复用输入；一切 per-call 中间态（正则编译缓存、ref 解析 memo、issue 收集器）都是**调用局部**对象——不落模块级缓存，天然免跨调用污染与并发干涉。
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
    const ctx = { values: derived.values, regexCache: Map<string, CompiledPattern>, issues: [], overflow: 0 }   # 全部调用局部
    const root = resolveValues(requireKey(derived.values, 'ROOT'), derived.values)   # ROOT 缺席 → InternalError → E100
    validateValue(root, snapshot, [], ctx)                                            # path 起点 = []
    if (ctx.overflow > 0) ctx.issues.push(marker(ctx.overflow))                       # §8：溢出精确计数
    return ctx.issues.length === 0 ? { ok: true } : { ok: false, issues: ctx.issues }
  } catch (err) { …崩溃边界 §2.2… }
}
```

- `emit(message, path, ctx)`：issue 收集的唯一通道——`ctx.issues.length < 100` 时 push（path 数组**冻结副本**：`[...path]`，防上游复用变长数组污染已收集 issue）；否则 `ctx.overflow += 1`。§8 详述。
- 递归深度：沿值树嵌套受解析层 `MAX_TYPE_NESTING = 100` 约束；沿快照嵌套受运行时栈限制——超深快照的 RangeError 由崩溃边界收编（§10 R3），可观测、不伪装成功。

### 3.3 jsonTypeOf（诊断用的运行时类型名）

```
jsonTypeOf(v): 'null' | v === null
             | 'array' | Array.isArray(v)
             | 'object' | typeof 'object'
             | 'string' | 'number' | 'boolean' | 'undefined' | 其它（function/symbol/bigint → '非 JSON 值'）
```

快照契约是 JSON 值域；非 JSON 运行时值按结构落到类型不匹配诊断（期望侧永远是 JSON 类型名），不静默接受。

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
| `{kind:'pattern', regex}` | value 为 string 且 §6 匹配器判定 match | 非 string → 类型不匹配（期望 string）；不匹配 → `不匹配 Pattern 正则 /${regex}/`；编译失败/预算耗尽 → §6.5 专用消息 |
| `{kind:'optional', value}` | **不出现在本层分发**——仅对象字段位的包装，由 object 行解包（§4.1） | — |
| `{kind:'object', fields, keyPattern?}` | §4.1 封闭对象 / Record 两形态 | 见 §4.1 |
| `{kind:'array', element}` | `Array.isArray` 否则报；否则逐下标 `validateValue(element, value[i], [...path, i], ctx)`（i 为 **number** 段，O1） | 非数组 → `类型不匹配：期望数组，实际 ${jsonTypeOf(value)}` |
| `{kind:'xml'}` | value 为 string 且 §7 良构 | 非 string → `类型不匹配：期望 XML 字符串，实际 ${jsonTypeOf(value)}`；非良构 → `YXmlFragment 值不是良构 XML：${detail}` |
| `{kind:'union', members, discriminator?}` | §5 三段算法 | §5.5 |
| `{kind:'ref', name}` | 分发前已解析（§3.1），执行中**不出现** | — |

`preview(value)` = `JSON.stringify(value)` 截断至 40 字符 + `…`（诊断可读性；枚举消息专用）。

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
  members = node.members.map(resolveValues)                    # ref 成员先解析（红灯 describe「ref 成员按名解析后逐成员尝试」）

  # —— 段 0（可选快速路径）：判别式缓存跳转——仅加速静默接受，不改变任何输出
  if node.discriminator 存在 且 value 为纯对象:
      raw = value[node.discriminator.field]
      if raw !== undefined 且 node.discriminator.byValue[String(raw)] === i:
          if countIssues(members[i], value) === 0 → return      # 命中且零 issue：接受，零输出（与全扫描输出全等）
          # 命中但有 issue → 落入下方完整流程（输出与无缓存路径全等）

  # —— 段 1：候选过滤（硬矛盾判定，§5.3）——
  candidates = [i for i in 0..N-1 if !contradicts(value, members[i])]

  # —— 段 2：接受扫描——候选按声明序逐个 countIssues，首个零 issue → 接受（零输出）
  distances = members.map(m => countIssues(m, value))          # 顺带产出距离（O4）
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

- `countIssues(m, value)`：以**计数 sink** 跑完整校验（不 emit，只累加）——距离 = issue 计数（O4），嵌套递归照常。零 issue 判定可短路（首个 issue 即返回 ≥1）。
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

---

## §6. Pattern 执行引擎：包内受限回溯匹配器（`src/pattern.ts`，O3 定稿）

### 6.1 为什么不用原生 `RegExp.test`

| 方案 | 判定 | 依据 |
|---|---|---|
| 原生 RegExp 直接匹配 | **否决** | 同步单线程下无法中断运行中的原生匹配——worker/超时/watchdog 三条路都破坏同步纯函数签名或引入运行时依赖；且 ReDoS 红灯 `(a+)+$ × 'a'*32+'!'` 正是原生引擎的指数回溯死局 |
| 原生 + 静态风险分析分流（安全走原生、危险走受限引擎） | **否决** | 静态分析不完备是定理级困难（覆盖重叠交替、多项式炸弹 `a*a*a*a*b` × 兆级输入均漏报）——漏报即挂死，防护承诺破产 |
| **包内受限回溯匹配器（本设计）** | **采纳** | 步数预算**按构造覆盖一切模式/输入对**（含多项式炸弹）；零运行时依赖（包内纯 TS）；同步；确定性（不依赖引擎实现差异）；`packages/vfsl/package.json` 零 runtime deps 纪律保持 |

### 6.2 支持的语法子集（冻结；「ECMAScript RegExp（无标志）」的实用子集，Annex B 宽松解析）

| 类别 | 支持项 |
|---|---|
| 字面量 | 普通字符、转义 `\\ \. \* \+ \? \( \) \[ \] \{ \} \| \^ \$ \/ \n \r \t \f \v \0`、`\xHH`、`\uHHHH` |
| `.` | 除行终止符（LF/CR/LS/PS）外任意字符（无 s 标志语义） |
| 字符类 | `[...]` / `[^...]`：字符、区间 `a-z`、类内转义、类内 `\d \D \s \S \w \W`（`[` 在类内为字面量等 Annex B 宽松规则） |
| 预定义类 | `\d \D \s \S \w \W` |
| 断言 | `^`（串首）、`$`（串尾——无 m 标志，不匹配尾换行前）、`\b \B`（词边界） |
| 分组 | 捕获 `(…)`、非捕获 `(?:…)` |
| 量词 | `* + ? {n} {n,} {n,m}` + 惰性后缀 `?`；`{` 不构成量词时按字面量（Annex B） |
| 反向引用 | `\1` ~ `\9` |
| 前瞻 | `(?=…)` `(?!…)` |

### 6.3 编译与执行（字节码 + 显式回溯栈——无递归，栈深 O(1)）

```
compile(regex): { program, nSlots }     # 调用局部缓存：Map<regex 字符串, Compiled>（同一次 validateSnapshot 内复用）
  语法分析 → AST → 字节码线性程序：
    Char(c) | Class(setId) | Any | AssertStart | AssertEnd | AssertWordB(pos)
    Save(slot)                    # 捕获组边界记录（运行期数组，回溯点快照恢复）
    Jmp(x) | Split(x, y)          # Split 贪婪：先 x 后 y；惰性量词交换优先序
    Backref(n) | Look(neg, subPc) # 前瞻：当前位起子程序独立回溯栈尝试，消费零字符
    Match
  程序规模上限 10_000 指令——`{2,}` 大边界展开（如 {1,100000}）超限 → 编译失败（§6.5 预算类消息）

match(regex, input): boolean        # test 语义：非锚定搜索 = 起点 0..len 逐起点尝试，共享同一总步数预算
  budget = min(2_000_000, max(4_096, 64 × input.length + 1_024))     # 冻结常数（§6.4）
  显式回溯栈：压入 (pc, pos, captures 副本)——无函数递归，输入任意长无栈溢出
  每条指令 dispatch 前 steps++；steps > budget → throw BudgetExceeded（→ §6.5 issue，非静默）
```

### 6.4 步数预算公式（冻结）与标定

`budget = min(2_000_000, max(4_096, 64 × len + 1_024))`

| 输入长度 | 预算 | 标定场景 |
|---|---|---|
| 33（ReDoS 红灯 `'a'*32+'!'`） | 4_096 | `(a+)+$` 指数回溯（真值 2^31 步）在数千步内耗尽预算 → 立即返回预算耗尽 issue——微秒级返回，5s 超时余量四个数量级 ✓ |
| ≤ 64（常规键/短值） | 4_096~5_120 | 锚定模式线性匹配 O(len × 模式长)，远低于预算——fixture AssetId 键、`^[a-z]{2,4}$` 等全部常规路径零预算压力 |
| 1 MB（病态大值） | 2_000_000 | 上限钳制单次匹配耗时 ≈ 数十毫秒量级；合法锚定长串线性匹配 O(len) ≈ 百万步级可容纳；病态模式被钳制兜住 |

预算**应用于整次 match 调用**（全部起点共享），非单起点——非锚定模式的长输入搜索不放大预算。

### 6.5 三类 loud 失败（O6：spec §9.1 委托的暴露时点，全部 ok:false + path 定位）

| 触发 | 消息（冻结） |
|---|---|
| 语法非法（如 `Pattern<"[">`——spec §9.1 明文该暴露点属 validateSnapshot） | `Pattern 正则无法编译：/${regex}/（${detail}）` |
| 子集外构造（`(?<=` `(?<!` `(?<name>` `\k<` `\p{` `\P{` 内联标志 `(?i` 等） | `Pattern 正则含匹配器不支持的构造：${construct}（子集清单见设计 §6.2）` |
| 步数预算耗尽 | `Pattern 匹配步数预算耗尽（输入长度 ${n}，预算 ${budget}）：无法在预算内判定匹配性` |

预算耗尽的语义立场（诚实边界，非误报）：**不宣称「不匹配」**——消息明示「无法判定」；ok:false 与「写入被拒」的零写入语义一致（无法证明合法即不放行，fail-closed）。ReDoS 红灯仅锚定 `ok:false` ✓。

### 6.6 红灯对账

- `(a+)+$` × 33 字符：段 0 编译 ✓（嵌套量词在子集内）→ 执行耗尽 4_096 步 → 预算耗尽 issue → `ok:false` ✓，毫秒级返回 ✓；
- `^[a-z]{2,4}$`：'ab'/'abcd' 线性匹配 ✓；'AB' 不匹配 issue path `['name']` ✓；
- fixture AssetId `^[A-Za-z0-9_\\-]{1,64}$`：合法键匹配、`abc.123` 拒绝（Record 键 Pattern，§4.1）✓。

---

## §7. YXmlFragment 良构性检查（`src/xml.ts`）

票 B（#20）映射执行（ADR 0003 §5 + #20 设计 §6）：JSON 快照中该位为 **XML 字符串**（与 `Y.XmlFragment.toJSON()` 投影一致），运行时校验仅要求**良构**——实参字段不进结构树、不参与校验（不透明语义）。

零依赖良构检查器（**片段语义——允许多顶层元素森林**，`<p>a</p><p>b</p>` 合法）：

```
wellFormedXml(s): boolean    # 单遍扫描 + 显式标签栈（无递归）
  跳过：<?…?> 处理指令 | <!--…--> 注释（未闭合 → false）| <![CDATA[…]]>（未闭合 → false）
  顶层纯空白文本允许；顶层非空白文本 → false（片段是元素序列）
  元素：< name attr* (/ > | > 子内容 </ name >)
    name：[A-Za-z_:][A-Za-z0-9_.:-]*；attr：name S* '=' S* ("…" | '…')——引号强制，未引 → false
  文本中裸 '<' 后非合法标签起点 → false；实体宽松（接受裸 & 与未声明实体——Y 投影侧已转义，宽松度冻结）
  <!DOCTYPE → false（片段投影不携带，按不支持处理）
  终态：标签栈空 且 扫描至串尾
```

红灯对账：`'<p>hello <b>world</b></p>'` 良构 ✓；`'<p>unclosed'` 栈非空 → 拒绝，path `['assets','text1','body']` ✓；`body: 42` 非字符串 → 类型不匹配 ✓。

---

## §8. 全收集 + 100 条上限 + 截断标记（O2 定稿）

### 8.1 收集器两态

```
emit(message, path):
  if issues.length < LIMIT(=100): issues.push({ message, path })   # path 冻结副本 [...path]
  else: overflow += 1                                              # 计数态：继续遍历、不物化
```

- **不提前终止**：达 100 条后遍历继续（计数态）——全收集语义的本意是诊断完备，提前终止使「另有 N 处」不可知；遍历成本与合法快照的完整校验同阶（O(快照规模)，本就是每次调用的固有成本），上界不因收集策略变化。
- **计数态下的距离计算不受影响**：`countIssues` 用独立计数 sink，与 emit 通道正交（§5.2 段 2 在计数态照常产出精确距离）。
- Pattern 步数预算等资源界在计数态照常生效（每模式应用独立预算）——计数态不放大资源消耗。

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

- 封闭对象：必填缺失（字段声明序）→ 未知键（快照键插入序）→ 在场字段（字段声明序）；
- Record：键按快照插入序，逐键（键 Pattern → 值下钻）；
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
| R3 | 超深快照递归栈溢出（RangeError） | 资源边界（合法但病态的数据） | 崩溃边界收编为 E100 issue——可观测、不伪装成功；深度受值树 ≤100 嵌套 + 运行栈双向约束，JSON.parse 自身的解析深度先于本层成为瓶颈 |

判定依据（SKILL 立法）：I1~I3 在功能完备系统里应恒真 → 不设计降级，设计报警；I4/R1/R2/R3 是真实的异常/边界路径 → 显式诊断而非吞没。**全程无一处 `if (!x) return fallback` 式静默降级。**

纯度与不可变：不写 `derived` / `snapshot`（只读遍历）；issue path 一律冻结副本；正则编译缓存为调用局部 Map——「编译一次、校验多次」指派生物复用，非进程级正则缓存（避免跨调用状态，保纯函数契约）。

---

## §11. 红灯测试逐条对账（33 条 → 设计章节映射）

| describe（条数） | 设计依据 | 关键锚点核对 |
|---|---|---|
| 接缝：签名、结果形状与 JSON 往返（8） | §2 | `{ok:true}` 恰含 ok 键 ✓；issue 恰含 message+path ✓；JSON 往返 ✓；纯函数 + 派生物不 Mutation ✓（§10 末段）；编译一次校验多次 ✓（调用局部态）；JSON 往返派生物输出全等 ✓（§9.2 确定性）；非对象顶层（null/42/'str'/true/[]）→ object/union ROOT 类型不匹配或无候选 → ok:false ✓ |
| 结构校验：封闭对象 / 必填缺失 / leaf·plain 不下钻（6） | §4 / §4.1 | ROOT 层未知键 `['extraKey']` ✓；联合命中成员内未知键 `['assets','img1','unexpected']` ✓（段 2 接受 image 后下钻，封闭语义照常）；恰 4 条一次报全 ✓；optional 缺席合法 ✓；leaf 收对象 → `['notes']`、数组元素对象 → `['keywords',1]` 长度 2 ✓；plain 收非数组对象 → `['attachments']` ✓ |
| 值校验：原始类型 / 字面量枚举 / optional / Pattern（6） | §4 / §6 | 五原始类型各自认领、unknown 全收、恰 4 条 ✓；枚举 `kind:'video'` → 候选空 → 汇总+下钻含 `['assets','img1','kind']` ✓；端口枚举 80/443 vs 8080 → `['port']` ✓（值树折叠为 enum 节点，§4）；Pattern 匹配/不匹配 ✓；Record 键 Pattern `abc.123` 拒绝 ✓；ReDoS 预算耗尽 → ok:false 毫秒级 ✓（§6.4/6.6） |
| 联合：any-of / 判别式缓存透明 / no-match 最小距离（6） | §5 | 三 kind 各自命中（缓存跳转 + 无缓存扫描双路）✓；ref 成员联合（无判别式缓存）逐成员尝试 ✓（§3.1 解析 + 段 1/2）；stripDiscriminators 两路径匹配输出全等 ✓（§5.6）；no-match 输出全等 ✓；`{kind:'video'}` → 距离 5/3/5 → `联合成员 2/3` ✓（§5.4 校准）；平局 `{x:42}` → 双矛盾候选空 → 距离 2/2 → `联合成员 1/2` ✓ |
| YPlainArray 纯值上下文嵌套 JSON（2） | §4 array 行 | 嵌套封闭对象 `['items',0,'count']` 长 3 ✓；混合联合 `string \| {a:number}`：'s' 与 {a:1} 各命中 ✓、{b:1} 候选下钻报未知键 ✓、42 无候选汇总 ✓ |
| YXmlFragment（1） | §7 | 良构通过 / `<p>unclosed` 拒绝 `['assets','text1','body']` / 非字符串拒绝 ✓ |
| path 段数组：Record 键特殊字符零转义（1） | §4.1 / §9.1 | `['m','a.b|c[d]','v']` 等三键整段相等、恰 3 条 ✓ |
| 全收集 + 100 上限 + 截断标记（1） | §8 | 150 错 → 101 条、`issues[100]` 标记匹配 /截断\|truncat/i、path 数组 ✓ |
| §10 fixture：合法 / 非法快照（2） | 全章节 | 合法 → 恰 `{ok:true}` ✓；非法 7 处独立错误一次报全（img1 三条成员内 + attachments/audit.createdBy/notes/keywords[0]）→ **恰 7 条**——联合段 3 候选分支零汇总混入是计数成立的关键（§5.2 段 3）✓ |

**typecheck**：公共导出落地后 TS2305 消除、15 条 TS7006 级联随 `any` 传播链断开自消（§2.3）。

---

## §12. 实现文件与版本

| 文件 | 动作 | 内容（预估行数） |
|---|---|---|
| `packages/vfsl/src/pattern.ts` | 新建 | §6 受限回溯匹配器：编译（AST → 字节码，程序规模上限）+ 执行（显式回溯栈 + 步数预算）+ 三类 loud 失败（~350 行） |
| `packages/vfsl/src/xml.ts` | 新建 | §7 良构检查器：单遍扫描 + 标签栈（~90 行） |
| `packages/vfsl/src/validate.ts` | 新建 | §3 解析器/主流程 + §4 全景表 + §5 联合三段 + §8 收集器 + ValidateIssue/ValidateResult 类型（~300 行） |
| `packages/vfsl/src/index.ts` | 修改 | `export { validateSnapshot } from './validate.js'` + `export type { ValidateIssue, ValidateResult }` + 头注释第三公共导出段（≤ 12 行） |
| `packages/vfsl/package.json` | 修改 | `version: 0.1.5 → 0.1.6`（Hard Gate #9） |

内部件（pattern/xml/validate 的具体函数）不导出到公共面（沿 tokenizer/parser/semantic 不导出先例）；公共面新增 = `validateSnapshot` + 两个类型。**零新增依赖**（devDependencies 不变）。

---

## §13. 文件清单（File Scope）

### ALLOW LIST
- `packages/vfsl/src/validate.ts` — 新建，校验核心（§3~§5、§8；ValidateIssue/ValidateResult 类型随此文件定义）
- `packages/vfsl/src/pattern.ts` — 新建，受限回溯匹配器（§6，ReDoS 防护定稿的落地位）
- `packages/vfsl/src/xml.ts` — 新建，XML 良构检查器（§7）
- `packages/vfsl/src/index.ts` — 修改，第三公共导出 `validateSnapshot` + 类型 re-export + 头注释（≤ 12 行）
- `packages/vfsl/package.json` — 修改，版本 0.1.5 → 0.1.6（1 行）
- `packages/vfsl/test/validate-snapshot.test.ts` — `[SA6 owned]` 红灯验收测试（已存在，SA6 Phase 1 交付，commit f9e4790）。SA3 不得改断言逻辑；仅允许测试基础设施级修正且须在 PR 说明

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
| YXmlFragment 的 JSON 快照值为 XML 字符串、校验仅要求良构 | 设计文档引用（ADR，仓内权威） | `docs/adr/0003-evaluator-derived-schema.md` §5：「JSON 快照中其值为 XML 字符串（与 `Y.XmlFragment.toJSON()` 投影一致），运行时校验仅要求良构 XML」；前票设计 `wiki/raw/task_vfsl-evaluator_design.md` §6 YXmlFragment 行同源（值树 `{kind:'xml'}`）。**本票按简报指派执行票 B 映射，不新立协议** | 低（ADR 冻结文） |
| Pattern 按「ECMAScript RegExp（无标志）解释」，其合法性暴露时点在 validateSnapshot | 规格引用 | `docs/vfsl/v1-spec.md` §3 Pattern 节 + §9.1：「实参解码后是否为合法正则不在方言层校验……非法正则的暴露时点属语义层（validateSnapshot）」。§6.2 子集为该语义的实用子集——子集外构造 loud 拒绝（§6.5）是开放点 O3「ReDoS 防护 vs 零运行时依赖」的定稿权衡，简报明文授权 SA1 定稿 | 中（子集边界是本设计新立的冻结项，SA2 主场） |
| ReDoS 对抗用例的朴素 RegExp 行为（`(a+)+$` × 'a'*32+'!' 指数回溯远超 5s） | 现有测试引用 | `packages/vfsl/test/validate-snapshot.test.ts`「Pattern ReDoS 对抗」用例注释（SA6 Phase 1 已 commit f9e4790）；预算公式标定推演见 §6.4（4_096 步上限 vs 真值 2^31 回溯步，四个数量级余量） | 低 |
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

## 附：SA3 实现指令排序（防走样）

1. **§5.2 是联合的唯一权威伪代码**——三段算法任何「简化」（如取消候选过滤、no-match 只报汇总不下钻、候选分支也加汇总）必红至少一条联合或 7 计数锚点（§5.1 张力表已推演）；
2. §4 全景表的消息格式逐字实现（含中文标点）——`联合成员 ${i}/${N}` 与截断标记的 `/截断|truncat/i` 信号是断言锚；
3. §6 匹配器的运行路径**完全不出现原生 RegExp 构造**——值匹配走自研字节码执行器，正则合法性判定同样由自研编译器给出（`new RegExp(...)` 连编译探测也不用，杜绝引擎间行为差异）；
4. path 段：数组下标 number、键 string、ROOT `[]`；emit 时冻结副本；
5. DENY LIST 文件零触碰；改码后 `pnpm test`（286 条全绿）+ `pnpm typecheck`（零红）+ package.json bump 三件套缺一不可。
