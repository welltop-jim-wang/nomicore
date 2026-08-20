# SA2 攻击评审报告

**Date**: 2026-08-25
**Verdict**: **reject**（存活攻击：1×CRITICAL + 4×HIGH + 2×MEDIUM + 2×LOW；SA1 必须逐条落实修订清单）

> 被审对象：`task_vfsl-protocol_design.md`（707 行，A/B/C/D 四块）与 SA6 三个测试文件。
> 评审方式：无命令执行环境（bash 被沙箱拒），纯类型语义推演 + 文档条款 + 仓库现状核对；凡经独立推演证实的 TS 行为，按「已知 TS 语义」直接断言；凡不确定者一律列为攻击点要求 SA1 给依据或改写法，**不许凭感觉放行**。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞（触发条件 → 影响 → 建议修订） |
|---|---|---|---|
| 1 | **CRITICAL** | §A.6 + 承重墙 | **D2 读投影 `T | undefined` 在设计的 `Step` 机制下不可能产生**。SA1 据 §D.2-②（union 索引访问 `U['url']`=T\|undefined）声明「成员独有字段 read→T\|undefined」。但那条规则只在**非分发、不受 keyof 门禁的直接索引** `(Image\|Text)['url']` 上成立；设计的 `Step` 根本到不了它。推演：`V extends Record<infer Key,unknown>` 左值是裸类型参数 `V`，TS 的 naked-type-param 条件分发会把 `V=Image\|Text` **按成员逐支分发**（Image 支 / Text 支）。Image 支 `keyof=Image='kind'\|'url'`，`'url'` 通过门禁得 `Image['url']=PathSchema<string,'leaf'>`；Text 支 `keyof Text='kind'\|'body'`，`'url'` **fail→never**。结果 = `PathSchema<string,'leaf'>\|never` = **`PathSchema<string,'leaf'>`，无 undefined**。反证（不分发）：union 级 `keyof(Image\|Text)` = `keyof A ∩ keyof B` = `'kind'`（TS 手册：keyof(union)=交集，非并集），`'url' extends 'kind'` 直接 never → UnknownPath。**两条路都产不出 `\|undefined`**——要么 string（无 undefined）、要么 UnknownPath。SA6 正例断言 `PathValue<...['url']>` 期望 `string\|undefined`（projection 行 133、156）必 RED。设计 §A.6.#2 自相矛盾：它需要的 union 级索引访问与它迫使的分发式 keyof 门禁互斥。**修订**：改为对 union `V` **显式按成员逐支取键再补 undefined** 的读投影函数（如 `ReadOf<UnionNode>` 对每个成员的键分支求 `T`，对只存在部分成员的键补 `undefined`），read 投影与写投影（patch）显式分两个不同分支实现，不得依赖「Step 的 `V[Seg]` 天然带 undefined」。SA6 已能抓住（正例 4 断言存在），SA1 需保证实现让该断言转绿。 |
| 2 | **HIGH** | §A.7.1 + 承重墙 | **fail-closed「条件 never 交叉参数」的推断顺序/化简不确定**（总控点名必查）。`path: Path & (PathAt<Map,Path> extends UnknownPath<infer _P> ? never : unknown)` 中 `PathAt<Map,Path>` 在 `Path` **被推断之前**就出现在参数类型里。已推演：裸 `Path` 分项是合法推断位，成功路径 `Path` 从实参字面量元组推断后条件可化简（`Path&unknown=Path`）；失败路径 `Path&never=never` → 报错，方向合理且 SA6 负例可判别。**但**存在已知 TS 陷阱：① 若 `Path` 因条件类型位置导致推断失败回落到约束型 `readonly(string|number)[]`，则 `PathAt<Map, 约束>` 大概率 → UnknownPath → **连合法路径也全错**（正例 1 `access.patch(['name'],'ok')` 会假红）；② deferred conditional 在推断点是否真实析构，TS 不保证。本环境无法跑 tsc 实测，依纪律必须列攻击点。**修订**：SA1 提供真实 `tsc` 证据（含成功路径正例 + 空表失败路径负例，贴命令与输出），或改用不依赖该微妙行为的写法（如双层泛型：先 `const patch = <P extends readonly(string|number)[]>(path:P,...)=>...` 单独推断 P，再用 `PathAt<Map,P> extends UnknownPath ? /* 编译错 */ : PathPatchValue<...>` 作为 value 与返回型，把 never 收敛到单独可推断的类型参数位）。SA6 正例 1 能抓「合法路径被误杀」，但抓不住「推断时序」本身，故需以实测证据闭环。 |
| 3 | **HIGH** | §C.6 | **lockfile 手工条目缩进错位 2 空格**。实查 `pnpm-lock.yaml`：importer 键是**2 空格**（`cat -A` 见 `  packages/vfsl:$`，子级 `devDependencies:` 4 空格），而设计 C.6 代码块给出 `    packages/vfsl-protocol:`（4 空格）、`      devDependencies:`（6 空格），并文字写「4 空格缩进，逐字一致」。逐字照抄会把新 importer 插入为 `packages/vfsl:` 块的**子键**，YAML 虽合法但 pnpm 解析不到 vfsl-protocol importer → CI `--frozen-lockfile` 必炸，AC/工程接线全部落空。**修订**：C.6 条目改为 2 空格 importer 键 + 4 空格子级，与 `packages/vfsl:`（行 18-25）逐字节对齐，插在空行之后紧挨 vfsl 条目。SA4 专项复核用 `cat -A`/字节级 diff。 |
| 4 | **HIGH** | §A.7.2 + 数组三件套 | **`appendToArray`/`insertIntoArray` 的 `value` 类型错：用了整数组写投影 `PathPatchValue<PathAt<Map,Path>>` = `Record<\`${number}\`, 元素判别联合>`，而 append/insert 的 value 应为单个元素类型（判别联合）。** `appendToArray(['tree','entities'], {kind:'image',url:'u'})`：`PathPatchValue<array节点>` 经 `PathPatchUnwrap` 分发为 `{ [k in \`${number}\`]: 元素 }`，实参 `{kind:'image',...}` 不可赋给 `Record<number, union>` → 编译错误。三件套语义（D1 ADR + 简报）是「数组节点 + 显式 index = 元素级编辑」，value=元素类型。SA6 当前未对三件套写运行时调用断言，测试抓不住。**修订**：value 改为指向**元素节点**的读投影（如先经 PathAt 取 `PathSchema<Record, 'array'>`，再 `PathValue<PathAt<Map,[...Path, '0']>>` 或专门提供 `ArrayElement<array节点>`；delete 无 value 不受影响）。补一条三件套正例断言（append 接受单元素判别联合）。 |
| 5 | **HIGH** | §B.1 / §C.7 + 流程 | **§B.1 的 3 处修订执行者未钉死 → 空表隔离语义悬空**。设计再三强调 `projection.test-d.ts` 的 `declare module` 增广是**程序级全局**，却把「empty 文件改 `VfslTypedAccess<LocalEmptyMap>` + 新增 `interface LocalEmptyMap {}`」标注为 `[SA6 owned]` 且「交 SA6/总控执行」，未指明**哪个 SA 在哪个阶段执行、由谁确认落地**。若无人执行，empty 文件仍写 `VfslTypedAccess<VfslPathMap>`，因同 program 内 `VfslPathMap` 已被增广 → 其 4 条 `@ts-expect-error` 全部变「unused directive」→ **假红**（空表测试自己挂）。**修订**：指名单个执行者（如 SA6 在本阶段重跑 or 总控在 SA3 落地后、SA7 前补做），并配套一个「已核对该文件出现 `LocalEmptyMap` 字样」的回读门禁；顺带更新 empty 文件头注释（行 10-11 「分属不同编译单元」的理由已被 B.1 证伪为「程序级全局」，注释会误导后人）。 |
| 6 | MEDIUM | §A.5 + fail-open | **`VfslValueOf` 的 `: T` 尾分支让 `PathValue<UnknownPath>` 返回 UnknownPath 接口自身（非 `undefined`/never）**。SA1 §A.3 声称 `__value: never`「污染任何 PathValue 读取处」——实为不实：`VfslValueOf<UnknownPath>` 因 UnknownPath 非 `PathSchema`（`__kind:'unknown'` 不在 VfslKind）落 `: T`，返回整个 `UnknownPath<…>` 类型，`__value:never` 从不被读取（死字段）。影响：若 A.7.1 门禁失效/被绕（见攻击 2），对坏路径的 `read()` 会**静默返回 UnknownPath 类型而非报错**——纯类型包的「静默失败」暗门。**修订**：`PathValue<UnknownPath>` 显式改为 `never` 或设计给明「read 遇 UnknownPath 必须 never」的短路分支；不依赖 `__value:never` 的隐性污染。 |
| 7 | MEDIUM | §D.2-⑧ | **自名引用依据缺仓库内先例**。设计 C.1 测试用 `import type {...} from '@nomicore/vfsl-protocol'`（自名），§D.2-⑧ 依 TS self-reference（name+exports）判低风险。实查：**仓库内 vfsl 的测试全部用相对路径 `import ... from '../src/index.js'`，无任何包名自引先例**；且 tsconfig 未设 `paths`/`baseUrl`。self-reference 在 moduleResolution=bundler + `exports:".":"./src/index.ts"` 下 TS 5.9 理论上支持（Node 包自引用 + `.ts` exports 目标），但**未被本仓库验证**，且是全部类型测试的 load-bearing 前提（不解析则 test-d 全 TS2307）。应标「需 tsc 实测」，非「低风险」。**修订**：SA1 补证据或提供 tsconfig paths 兜底；SA4 把「自名 import 能解析」列为专项门禁。 |
| 8 | LOW | §A.4/B.3 | **模板数字键只匹配字符串数字字面量，`Path` 类型约束却允许 `number` 段**。`keyof Record<\`${number}\`,T>` = `\`${number}\``，`Seg extends keyof V` 只放 `'0'`/`'5'` 这类字符串数字；若调用方按 `Path extends readonly(string|number)[]` 传 `5`（number 字面量），`5 extends \`${number}\``（模板字面量是 string 型）≈ false → never。三件套已把下标收为显式 `index:number`，数组下钻段走字符串下标，本票测试不至触发；但契约允许 number 段却实际拒收，属接口签名误导。**修订**：把 `Path` 约束收敛为 `readonly string[]`（或文档明示 number 段不支持、下标段一律字符串数字），避免误用。 |
| 9 | LOW | §A.4 | **`RootSchema<M>` 对 `M` 无 `type` 约束**，`PathSchema<M,'map'>` 的 `M` 若被传非对象类型（如 `string`），`Step` 的 `V extends Record` → never → 恒 UnknownPath（fail-closed 仍成立，无放行），仅缺早期内联诊断。可接受，记为已推演存活。 |

---

## 协议假设依据审查（§D.2 九条逐条）

- **① `Record<\`${number}\`,T>` 模板键 `'0'/'5'`**：已独立推演，`keyof Record<\`${number}\`,T>` = `\`${number}\``，字符串数字字面量 `'0'≡\`${number}\``、`V['0']` 模板键索引=元素类型→**成立**；但只见字符串数字段（number-literal 段不成立，攻击 8）。依据类型「TS 手册 template literal types」可验证。存活（对测试用字形）。
- **② union 索引访问 `U['url']`=T\|undefined**：规则本身真（TS 手册 indexed access on union），但**是设计承重墙且被本文攻击 1 攻破**——规则在设计的 Step 管道里从不触发。不是「依据错」，是「机制到不了依据」。需重写读投影。
- **③ module augmentation 程序级全局**：成立（无文件局部作用域），§B.1 据此隔离方向正确；但**执行者悬空**（攻击 5）。中风险未被真正化解。
- **④ `declare const` unique symbol 零运行时**：成立（ambient 无发射）。
- **⑤ never 不可匹配**：成立；但「让 path 参数坍缩 never」的推断时序依赖 ② 之外的另一承重墙（攻击 2）。
- **⑥ `{} & X` 键空间=X / keyof(A&B)=并**：`keyof(A&B)` = ∫ember 指 span，成立；空对象不贡献键成立。B.2 交叉根推导正确（且因增广全局，同 program 内等价）。存活。
- **⑦ vitest typecheck 配置形状**：`test.typecheck.enabled/.include/.tsconfig` 为 vitest 3.2 文档条目；`tsconfig` 相对项目根解析、`./packages/vfsl-protocol/tsconfig.json` 方向正确；`--typecheck` 同时跑普通+typecheck。接线形状经仓库现状核对基本成立（C.4/C.5 与根 vitest.config/include 自洽；vfsl 15 个 `*.test.ts` 不影响）。存活，附攻击 7 的解析前提。
- **⑧ 自名引用经 name+exports 解析**：TS self-reference 文档支持，**但仓库无先例**（vfsl 测试全相对路径）、未设 paths → 降为 MEDIUM、须实测（攻击 7）。「低风险」标注不当。
- **⑨ deferred conditional 在实参推断点求解**：概念成立，但[推断点实际时序]存疑（攻击 2）——这正是不能给「低」的原因。

**结论**：⑨ 条中 ①②⑨ 三条承重墙标「低风险」与实情不符（②机制到不了、⑨时序存疑、①仅字符串数字段）；应有 SA1 实测证据或改写法后重评。

---

## 错误处理链路审查（纯类型包的「静默失败」= fail-open 暗门）

- **静默失败检查**：设计的 fail-closed 靠 A.7.1 never 交叉把失败收敛在**调用点编译错误**，方向正确。但存在两处暗门：
  1. **攻击 2**：若推断时序坍缩，可能「合法路径全错」（过度拒绝，非放行，安全性无虞但不可用）或「条件永不析构 → 门禁空转 → 失败路径静默放行」——后者是真 fail-open。必须以实测证据排除。
  2. **攻击 6**：`PathValue<UnknownPath>` 返回 UnknownPath 接口自身而非错误，一旦门禁被绕就是「读未知路径静默返回无意义类型」——纯类型包无运行时反馈，属静默失败。须显式 never。
- **状态闭环 / 降级路径**：不适用（无运行时状态）。**伪降级**：无（设计无「把缺失前提当降级」逻辑）。
- **`Step` 宽类型泄漏**：逐分支查无「解析不出就放行」——`K 非 map|array → never`、`V 非 Record → never`、`Seg 不在键空间 → never`，全部收敛到 never/UnknownPath，无宽类型透传（除攻击 6 的 UnknownPath 接口返回）。

---

## 红线测试思路（SA6/SA7 能否抓住 + 补什么）

| # | 漏洞 | 现有测试能否抓 | 补充测试思路 |
|---|---|---|---|
| 1 | D2 读投影无 `\|undefined` | ✅ projection 正例 4 行 133/156 断言 `string\|undefined`，转绿即要求实现必须产 undefined | （无需新增；SA1 改实现后该断言即验收） |
| 2 | never-cross 推断时序 | ⚠️ 正例 1「合法路径必须编译」能抓「过度拒绝」；抓不住「条件未析构的静默放行」 | 补：对**失败路径**加一条「必须编译错误」的负例；并在可执行环境贴 `tsc --noEmit` 全文件取证 |
| 3 | lockfile 缩进 | ❌ 测试抓不住 | SA4 用字节级/`cat -A` 核对 C.6 importer 与 `packages/vfsl:`（行 18-25）对齐（2 空格键）；CI frozen-lockfile 是最终门禁 |
| 4 | append/insert 元素类型 | ❌ 三件套当前无运行时断言 | 补：`appendToArray(['tree','entities'], {kind:'image',url:'u'})` 必须编译通过；value 推断为判别联合 |
| 5 | B.1 编辑执行者 | ⚠️ empty 测试转绿即要求 edits 已落地 | SA6/总控执行后加回读「文件含 `LocalEmptyMap`」；4 条 @ts-expect-error 不被误增/删 |
| 6 | PathValue<UnknownPath>=UnknownPath | ⚠️ 负例能抓「被放行」，抓不住「返回类型非值」 | 补 `expectTypeOf<PathValue<PathAt<Map,['notDeclared']>>>().toEqualTypeOf<never>()`（或显式断言非 UnknownPath） |
| 7 | 自名引用解析 | ⚠️ test-d 全是 TS2307→全红即抓 | 可执行环境跑 `tsc -p packages/vfsl-protocol/tsconfig.json` 贴输出留证 |

---

## 存活（已独立推演、未倒）的承重墙

- **A.4 递归骨架 + `[]`→RootSchema → kindOf([])='map'**：存活（`PathAtImpl` 空表返回 Node、`PathKind<RootSchema<M>>`='map'）。
- **A.3 UnknownPath 结构身份**（`__kind:'unknown'` 使 `UnknownPath⋠PathSchema`，条件匹配断言正确）：存活（VfslValueOf 落到 `: T` 除外，见攻击 6）。
- **A.6 判别字段（`kind` 两成员共有）→ 'image'\|'text' 精确字面量**：存活（分发下 keyof 每支含 kind，Image['kind']\|Text['kind']）。
- **A.6 patch 写投影丢弃 undefined 的 `:never` 分发机制**：机制本身正确（Node=X\|undefined 分发，undefined→never），**但属攻击 1 的连带品**——D2 read 产不出 undefined 时该分支从不触发；D2 修复后此机制才有意义。
- **B.2 交叉根 `{} & VfslPathMap` 等价增广后表**：存活（增广程序级全局 + keyof(A&B)=并集，同 program 内成立）。
- **C.4/C.5 vitest typecheck 接线**：形状成立（tsconfig 相对根、include 匹配 test-d、`--typecheck` 语义、vfsl 15 测试不受影响）；前提是攻击 7 的自名解析打通。
- **A.7.2 array-kind 门禁**（三件套 `PathKind='array'`+never）：逻辑对，value 类型错（攻击 4）。

---

## SA1 修订清单（reject → 逐条落实后重新评审）

1. **攻击 1（必须）**：重写「成员独有字段 read→T\|undefined」读投影，采用对 union 逐成员取键并显式补 `undefined` 的分支，禁止依赖 `V[Seg]` 天然带 undefined；保证 SA6 正例 4（行 133/156）转绿。
2. **攻击 2（必须）**：给出 tsc 实测证据（正例编译通过 + 负例编译错误，贴命令与输出），或改为不依赖推断时序的写法。
3. **攻击 3（必须）**：C.6 importer 缩进改 2 空格、子级 4 空格，逐字节对齐 `packages/vfsl:`。
4. **攻击 4（必须）**：append/insert 的 value 改为数组元素类型；补三件套正例断言。
5. **攻击 5（必须）**：钉死 §B.1 3 处修订的执行者与顺序；更新 empty 文件头注释。
6. **攻击 6（建议）**：`PathValue<UnknownPath>` 显式 never。
7. **攻击 7（建议）**：补自名解析证据/兜底 paths。
8. **攻击 8（建议）**：`Path` 约束收敛为 `readonly string[]` 或文档明示 number 段不支持。

---

## R2 复审（2026-08-25）

**Verdict**: **reject**（存活：1×CRITICAL + 1×MEDIUM＋若干附加核验结论；SA1 须补 R3）

> 被审对象：`task_vfsl-protocol_design.md` R2 版（849 行）＋修订清单 8 项逐条回应表（§E）+ SA6 三个测试文件现状。
> 方式：无命令执行环境（bash 被沙箱拒），纯已知 TS 语义复推每条承重链；本环境**无法跑 tsc**，凡依赖 tsc 实测结论的处置一律坚持「须 SA4 补 tsc 取证」。
> 结论总览：修订 8 项**全部实质落实**（attack 1 机制彻底替换并三处同步一致）；但 SA6 **正例 5 的 `UrlWhenImage`/`BodyWhenText` 两条断言推不出**（设计 A.6 lines 296-300 对 TS 语义误判）——按任务规则「任何一条推不出即 CRITICAL」否决；另留 read/kindOf 单点 fail-closed 的 tsc 取证欠账。

### R1 八项修订核验表

| R1 攻击点 | 声称落实 | 实际核验结论 |
|---|---|---|
| 1 CRITICAL 读投影 T\|undefined | §E-1 落实：新 `MemberKeys`+`MemberLookup`，三处同步（A.4 prose / A.4.1 表 / C.1 完全一致） | ✅ **实质落实**。独立复推 4 链全部成立：`PathAt<Map,['…','url']>`=`PathSchema<string,'leaf'>\|undefined`（Image 命中、Text 缺键补 undefined，分包并集）；`'kind'`=无 undefined 并集→`'image'\|'text'`；未知键经 `MemberKeys` 门禁→never→`UnknownPath`；`VfslValueOf` 对 union 的裸 T 分发、undefined 走 `:T`→读=`string\|undefined`；`PathPatchValue` 的 `PathSchema` 进 `PathPatchUnwrap` 取 `string`、undefined 分支 `:never`→写=`string`。每链独立推演成立。 |
| 2 HIGH fail-closed 推断时序 | §E-2：Path 收敛 `readonly string[]`+值参双 fail-closed+严格论证 | ⚠️ **部分落实（方向正确，缺 tsc 实证）**。成功/失败路径代入成立（`Path&unknown=Path`、`Path&never=never`）；`PathAt=节点\|undefined` 非 naked 参数不分发→整体判非 UnknownPath→不误杀（已复推）。write 路径双钳（path 参+value `PathPatchValue<UnknownPath>`=never）方向正确。**但 read/kindOf 无 value 参，仍是单点**——设计「失败方向由双重 fail-closed 兜底」的表述对 read/kindOf 不成立；「推断先于条件实例化」引 TS 手册语句是存在语义，但本环境无 tsc，按纪律不能「凭签名直接放行」，须 SA4 el tsc 取证（且 empty 表 fail-closed-2/3 的 `@ts-expect-error` 是 read 判错的后备捕获）。列为存活 MEDIUM（非 HIGH：write 侧已实质降险 + read 有测试后备）。 |
| 3 HIGH C.6 lockfile 缩进 | §E-3：改 2/4/6/8 空格逐字节对齐 | ✅ 已**逐字节实测核对**（sed/cat -A pnpm-lock.yaml L18-25 对照设计 C.6 代码块）：`packages/vfsl-protocol:`=2 空格、`devDependencies:`=4、`typescript/vitest:`=6、`specifier/version:`=8，与 `packages/vfsl:` 完全一致；impoter 插 vfsl 之后同级、version 同源。SA4 `cat -A` 复核指令在场。**落实无误**。 |
| 4 HIGH append/insert value 类型 | §E-4：value 改 `PathElementValue`（元素子树读投影=单元素判别联合） | ✅ **实质落实**。复推：`appendToArray(['tree','entities'],{kind:'image',url:'u'})` 中 `PathElementValue<record数组节点>`=`VfslValueOf<EntityMap>`=`{kind:'image',url}\|{kind:'text',body}`，对象匹配✓；`'x'` 字符串不匹配→错✓；C.1 六方法签名同步；C.7-3 补三件套正/负例指令在场。 |
| 5 HIGH B.1 执行者 | §E-5：钉死 SA6 单执行者+流程顺序+empty 头注释指令+回读门禁 | ✅ **实质落实**。C.7 开头钉死「R2 pass 后、SA3 前由总控派 SA6 修订轮」，SA3 全程不碰 SA6 owned 文件；回读门禁(LocalEmptyMap 字样+4 expect-error 仍在)在场。empty 文件头注释更新指令(C.7-2)在场。**注意**：empty 文件现状仍是旧 `VfslTypedAccess<VfslPathMap>`+旧头注释——修订落在 SA6 轮执行，时序正确。 |
| 6 建议 PathValue<UnknownPath> | §E-6：`PathPatchValue<UnknownPath>`=never（随 2）；`PathValue<UnknownPath>`=UnknownPath 语义钉死+锚定断言 | ✅ **实质落实**。C.1 `PathPatchValue` 首分支 `extends UnknownPath ? never`，C.7-4 补断言指令在场；读投影不塌陷语义钉死（A.6 读锚定）。 |
| 7 建议 自名引用 | §E-7：补依据+降中风险+C.4 相对 import 兜底(增广目标仍包名)+SA4 门禁 | ✅ **落实**。依据 TS self-referencing+exports；降级中风险；C.4 兜底说明（增广必须包名，故以包名为准）合理；SA4 专项门禁在场。仍需 tsc 实测闭环（见 residual）。 |
| 8 建议 Path 收敛 | §E-8：收敛 `readonly string[]` + 下标一律字符串数字 | ✅ **落实**。全文档 A.7.1/A.7.2/C.1/D.4/§D.4 无 `readonly(string|number)` 残留（grep 证实）；SA6 各路径段全为字符串字面量（含 `'0'`/`'5'`），与约束兼容。 |

**八项核验计数：6 实质落实 + 1 部分落实（attack 2 缺 tsc，read 侧单点）+ 0 未落实。**

### 新攻击面核验（B 项逐条）

- **`MemberKeys`/`MemberLookup` 对非 union V 退化**：`MemberKeys<单对象>`=keyof；`MemberLookup<单对象,seg>` 单分支取 `V[Seg]`，无补位。单 Object/交叉根键同 keyof=并集。退化正确。✅
- **`PathAtImpl` 越 undefined 分量继续下钻**（`['tree','entities','0','url','x']`）：`Step` 对 `Node=PathSchema<string,'leaf'>\|undefined` 的裸 Node 分发——leaf 支 K≠map/array→never、undefined 支非 PathSchema→never，并集=never→`[never] extends [never]`→UnknownPath。**正确落 UnknownPath，未误判成功**。✅
- **`PathKind<PathSchema\|undefined>`**（naked 分发丢 undefined）：`PathSchema`支取 K、undefined 支 `:never`；`['…','body']`→`'xml-fragment'\|never`=`'xml-fragment'`。SA6 line 170 成立。✅
- **`Path` 收敛 `readonly string[]` 与 SA6 全路径字面量**（含 `'0'`/`'5'`）：全部是字符串字面量元组，兼容；number 段不被设计使用。✅
- **C.1 与 A.4.1/A.6/A.7 一致性**：`MemberKeys`/`MemberLookup`/`Step`/`PathAtImpl`/`VfslValueOf`/`PathPatchValue`/`PathPatchUnwrap`/`PathElementValue`/`VfslTypedAccess` 逐块比对 C.1 与 A 节**文字逐字一致**（MemberLookup 的 `V extends unknown`、Step 的 `K extends 'map'|'array'` 门禁顺序等）。✅

### SA6 断言全量重推结论

- 正例 1（name=string）✅、正例 2（portrait=string\|null）✅、正例 3（entity=Image\|Text 判别联合+\='map'）✅、正例 4（name/portrait/url=`string\|undefined`/kind=`'image'\|'text'`/entity 整值）**全部成立** ✅、正例 6（name leaf / portrait leaf / entity map / [] map / body xml-fragment / entities array）✅。
- D1：`['tree','entities','5']`=Image\|Text ✅、`['0','kind']`=`'image'\|'text'` ✅、`attachments[0]`→UnknownPath（`VfslValueOf` 落 `:T` 返回 UnknownPath 接口，≠string，`@ts-expect-error` 命中）✅。
- D2：patch url→string ✅、patch body→string ✅、kind value=`'image'\|'text'` ✅。
- 负例 1-4（42 / notDeclaredKey / tree.title.name / entities.0.nonexistentField / {kind:'image'} 缺 url / 'not-an-entity' / entities.0.title）全部经 path-never 或值判据成立 ✅。
- fail-closed 1-3（空表→`LocalEmptyMap` 后）：`{}`→MemberKeys=never→Step never→UnknownPath→path never→全错 `@ts-expect-error` 命中 ✅。
- 空模块：仅执行环境断言（须包存在+S 运行时解析），设计 D3 机制使 `Object.keys(ns)=[]` 成立，需 SA7 实测。
- ❌ **正例 5（line 151-154）`type UrlWhenImage = Entity extends {kind:'image'} ? Entity['url'] : never` 推不出 `≠never`**。`Entity = PathValue<…['0']>` 是**具体类型别名**（非裸类型参数）；`Entity extends {kind:'image'}` 因检查类型非类型参数而**不分发**，TS 整个联合判可赋值性：`{kind:'text';body}` 不可赋给 `{kind:'image'}`→条件假→`:never`。故 `UrlWhenImage=never`、`BodyWhenText=never`，`not.toEqualTypeOf<never>()` 两断言均 **RED**。设计 A.6（lines 296-300）声称「逐成员窄化命中」是对 TS 语义的**误判**（分发只对裸类型参数生效）。C.7 未含修复指令。→ **CRITICAL**。

### 残留矛盾扫描

- 旧 `Step` 直索引 `V[Seg]`：仅存于新 `MemberLookup` 内（正确）与历史 R2 修订摘述（标注「旧」）；无未迁移的旧 Step。✅
- `readonly(string|number)` 残留：grep 零命中（全 `readonly string[]`）。✅
- `PathPatchValue` 旧透传分支：C.1 已首分支显式 never，无「透传 UnknownPath」残留。✅
- §D.2-②：已划线 `~~R2 废弃~~`→移除，未被设计依赖；⑩⑪ 新增补位依据齐备。✅
- D.4-4 标「机制改」、D.4-9 标「调整」为本地空接口——对账表旧行已迁移。✅

### 结论

**reject**。SA1 修订清单 8 项实质性落实（含 C.6 已逐字节实测正确）：attack 1 CRITICAL 读投影机制彻底重写且三处一致、attack 4/5/6/7/8 实质落地、attack 3 字节正确、attack 2 write 侧双重 fail-closed 方向正确。但存活两项：
1. **CRITICAL（新增/漏检）**：SA6 正例 5 的 `Entity extends {kind:'image'}` 双断言因非裸类型参数不分发而恒为 `never`——设计 A.6 与 SA6 断言对账失败，C.7 无修复指令。**须 R3**：或令 SA6 将断言改为分发式 helper（`type Narrow<U> = U extends {kind:'image'} ? U['url'] : never`，`Narrow<Entity>` 可分发→`string≠never`），或重写 D2 整值窄化锚点，并同步 A.6。
2. **MEDIUM（取证欠账）**：read/kindOf 为单点 fail-closed，其正确性依赖「path 守卫对已推断具体 Path 即时求值」这一标准 TS 行为，本环境未 tsc 实测。须 SA4 在可执行环境跑 `tsc -p packages/vfsl-protocol/tsconfig.json`（成功+失败路径各留证）闭环，并核 C.6 `cat -A` 与自名解析。
3. 流程正确性保留：SA6 修订轮（empty 换 `LocalEmptyMap`+头注释+三件套断言）须在 R2 pass 后、SA3 前由总控派发，empty 文件现状仍为旧态属预期。

---

## R3 复审（2026-08-25）

**Verdict**: **pass**（R2 两存活点全部实质落实；无新 CRITICAL/HIGH；不可实测项已显式收敛为 §F 延期取证+结论闸门）

> 被审对象：`task_vfsl-protocol_design.md` R3 版（936 行）＋正例 5 原文（projection 行 147-159）。方式：无命令执行环境，纯 TS 语义推演。

### R2 存活点①核验（CRITICAL 正例 5 分发 helper）——实质落实 ✅

- **A.6 断言 8 如实修正**（line 296-314）：承认「`Entity = PathValue<...>` 是具体类型别名（`Image|Text`），条件类型只对裸类型参数分发（TS 手册 *Distributive conditional types*），对整体联合判可赋值性 → `extends {kind:'image'}` 恒假 → `:never`」——与我 R2 的推演逐字一致，无偷换。
- **C.7-5 给出精确替换写法**（line 758-774，完整 it 块）：`type UrlOf<E> = E extends {kind:'image'} ? E['url'] : never`——E 是 helper 的**裸类型参数**，`UrlOf<Entity>` 实例化时分发：Image 支命中取 `string`、Text 支不命中 `:never` → `string|never = string ≠ never` ✓；BodyOf 对称 → `string` ✓。相对原文（行 151-154）——分发机制正确、断言转绿成立。断言语义不变：两条 `not.toEqualTypeOf<never>()` 仍证明「整值判别联合可按判别字段窄化访问成员独有字段」，语义锚点未屈从实现。且替换块保留「路径级窄化不做」的 `string|undefined` 锚（对应原文 156-158）✓。
- **D2 原意未偷换**：设计的澄清齐备——对**消费方 JS 代码**，「窄化」＝运行时控制流窄化（`if (e.kind==='image')` 由 tsc 判别联合标准能力收缩，这块**从来不受分发影响、恒成立**）；**类型级断言**里才须分发 helper。与 ADR 0004 D2「整值读取发射判别联合（有判别式时），消费方在 JS 里吃 tsc 原生窄化」完全一致，反而把「类型级验证窄化是测试关注、运行时窄化是业务关注」的边界讲清了。

### R2 存活点②核验（MEDIUM read/kindOf 单点）——双轨落实 ✅

- **A.7.1 R3 轨一（理论补强）条级可核**（line 362-367）：①裸类型变量位推断（TS 手册 *Inference*）②条件类型内部非实参推断位、条件待类型实参具体后求值（*Conditional types* Deferred resolution / *Evaluating conditional types*）③库生态既有同型签名先例（type-fest/ts-reset 等 `param & (Predicate extends ok ? unknown : never)` 守卫）④如实标注「单点 vs 双点残留质差」、不降 fail-open，空表负例 2/3 的 `@ts-expect-error` 为后备捕获。条级引用 + 生态先例 + 残余质差透明，非凭空放行。
- **§F 延期验证清单可执行、可判读**：F.2 恰两条命令（`pnpm typecheck`、`pnpm test`）+ 每条通过判据；F.3 八条预期输出形状；F.4 结论闸门。覆盖：read/kindOf 单点（F.2-1 明确标「覆盖 read/kindOf 单点 fail-closed」+ F.3-1 列 `read`/`kindOf` 负例形状）、正例 5（F.3-4）、负例自我反转（F.3-2 四 @ts-expect-error 真命中）、空模块（F.3-7）。F.4 明确「全部通过才能标 complete」+ 按条目回退执行者（F.4→SA6 修订轮，其余→SA4/SA3）。

### 流程完整性（C.7 六条 + C.9）——钉死 SA6 修订轮 ✅

C.7 六条齐（empty B.1 三处 / 头注释 / 三件套断言 / PathElementValue 断言 / **正例 5 分发 helper** / 交付回报），全部 `[SA6 owned]`、全部标注「总控在 SA2 R2 / R3 pass 后、SA3 前单独派 SA6 修订轮」执行；回读门禁（`LocalEmptyMap` 字样 + 四 @ts-expect-error）在场。C.9 同步把「SA2 R3 复审（须 pass）」列为前置、SA6 修订轮在其后。流程闭环。

### 新攻击面结论

- **§F F.3-1 预期形状**：报 `Type '...' is not assignable to type 'never'`（TS2345 或 TS2322）——是我 TS 语义知识下 never 交叉参数的确定性报错（TS2345 实参不可赋给参数、TS2322 赋值/返回位，具体码随参数位，`never` 交叉两侧皆不可匹配时可能二选一）；设计已如实写「具体码随参数位」，命令（F.2）与判据（F.4）确定，形状不确定性以实测为准——**允许且无 CRITICAL**。F.2-1「tsc 退出码 0」与 F.3 负例报错并行：负例被 `@ts-expect-error` 消费 → tsc 不落非零，自洽。
- **C.7-5 分发 helper 正确性**：`UrlOf<E>` 的 E 为类型参数 ✓；`string|never = string` 吸收正确 ✓。
- **§E R3 两行**（line 885-892）指向真实修订位置（A.6/C.7-5/§F）✓；§D.2-⑨ 已同步标「read/kindOf 单点→A.7.1 R3 双轨处置 / §F 闭环」（line 837）✓。
- **未新发现 CRITICAL/HIGH/新增 fail-open**：所有凡依赖 tsc 实测的个别结论（自名解析、模板键匹配、never 报错码）均已在 §F 显式收敛为「延期取证 + 结论闸门」，不当作已实测放行。

### 终局判定

**pass（设计通过审查）**。R2 两存活点实质落实：正例 5 CRITICAL——A.6 断言 8 如实修正 + C.7-5 精确替换写法（SA6 可照抄制 it 块、分发 helper 推演转绿、D2 ADR 原意未偷换）；read/kindOf MEDIUM——A.7.1 轨一条级理论 + 轨二 §F（2 命令 + 8 形状 + 结论闸门）把不可实测项全部显式收敛为「延期取证+结论闸门」。无新 CRITICAL/HIGH，流程（C.7 六条 / C.9 / 回读门禁）完整钉死 SA6 修订轮。**read/kindOf 单点与全部类型断言的实测证据依 §F 在可执行会话补跑，属 SA7/总控收尾验证职责（F.4 闸门），不构成设计缺陷**。放行 SA6 修订轮 → SA3 落地实现。
