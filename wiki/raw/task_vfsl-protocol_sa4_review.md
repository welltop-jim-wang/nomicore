# SA4 静态验尸报告

**Date**: 2026-08-25
**Verdict**: pass

> 本报告为**纯静态**验尸：环境命令执行不可用（已验证 bash 被拒），一切证据来自文件内容推演与
> 设计 §C/D §A 逐块比对，**无任何伪造运行输出**。所有须实测项如实标注并移交 SA7/§F。

---

## 审核结论（8 项逐条）

### 1. 设计一致性 —— 通过
- `packages/vfsl-protocol/src/index.ts`（140 行）与设计 §C.1 完整代码**逐字一致**：品牌（`declare const __vfslNodeBrand`+`VfslNodeBrand`）、`VfslKind` 五值、`PathSchema<Value,Kind>`、`UnknownPath`（`__path` 诊断字段）、`RootSchema`、内部助手 `MemberKeys`/`MemberLookup`/`Step`/`PathAtImpl`/`PathPatchUnwrap`（均**未导出**，符合 C.1 清单一 ③）、`VfslPathMap` 空接口（可增广，非 `{}` union）。所有 TSDoc 锚点（A.1–A.7）一一对应。每个 export 带 1 行 TSDoc（清单一 ④）。
- 零值导出纪律：全文件仅 `declare`（ambient）+ interface + type + type-only export；`declare const __vfslNodeBrand` **未 export**，无任何值域代码 → 编译产物空模块（见第 3 节推演）。
- **比对标黄点**：设计 C.1 注释「（A.4.1，不导出）」等与实现一致；未发现命名/结构/注释锚点漂移。

### 2. 读写路径一致性 —— 通过
- 读投影 `PathValue = VfslValueOf`（map/array 递归、leaf/plain/xml-fragment 直取、非节点 `:T` 透传）。
- 写投影 `PathPatchValue`：显式 `UnknownPath → never`（R2 攻击 6 双重 fail-closed）+ `PathPatchUnwrap` 递归 + 非 PathSchema `:never`（丢弃 read 独有 undefined）。读写对偶语义正确（详见第 4 节推演）。

### 3. 静默失败 —— 通过（含一个 LOW 测试锚点观察）
- fail-closed 全链贯通：路径段失败任一环 → `Step` 产 `never` → `PathAtImpl` 识 `never` → `UnknownPath<Remaining>`。
- 访问面：path 参数 `Path & (cond ? never : unknown)` 落 `UnknownPath` 时坍缩 `never`，调用编译错误，非静默放行。
- **无**任何 `any`/`unknown` 吞并合法值或放宽失败的分支（第 4 节暗门扫描全绿）。

### 4. 降级方案 —— N/A（本任务零运行时、零值导出）
数据不可用时无运行时降级面；fail-closed 即失败方向（路径坍缩 `never`）。无工厂/默认值/兜底 fallback（D3），不存在「默默降级为宽类型」路径。

### 5. 极端攻击 —— 通过
第 4 节边界攻击逐项推演全部闭合（fail-closed 完整性、跨 undefined 下钻、越终态下钻、空表、歧义联合、路径坍缩）。无 CRITICAL/HIGH 存活。

### 6. 错误处理 —— 通过
路径解析失败方向与「诊断保留」分离：`UnknownPath.__path` 保留未消费路径（诊断用），`__value: never` 污染读取面、`__kind:'unknown'` 供 `kindOf` 显式返回 `'unknown'`。错误不吞不散。

### 7. 架构评估 —— 通过
- 新包 `@nomicore/vfsl-protocol` 0.1.0，`exports"."→"./src/index.ts"`，与既有 `@nomicore/vfsl` 模板同构；零依赖、零运行时，边界清晰（协议不含生成器，票 F）。
- 根接线自洽：vitest typecheck 指向 vfsl-protocol/tsconfig（include src+test）、根 typecheck `&&` 聚合两包、根 test 含 `--typecheck`。ci.yml 按设计 C.8 不动即可被根脚本覆盖。
- `VfslPathMap` 可增广空接口设计正确支撑 D5（module augmentation 扩展）。

### 8. 过度设计 —— 通过
内部助手 `MemberKeys/MemberLookup/Step/PathAtImpl/PathPatchUnwrap` 均保持私有不导出（C.1-③）；`MemberKeys`/`MemberLookup` 的设计（R2 攻击 1 解决 D2 崩塌）是最小必要机制，无冗余抽象。六个访问方法签名恰好覆盖读/写/kind/序列三件套，均为任务简报所需，无多余面。

---

## Scope Creep Guard

### ALLOW / actual 比对

| ALLOW（设计 §D.1） | actual | 结论 |
|---|---|---|
| `packages/vfsl-protocol/src/index.ts` 新建 | 存在（140 行，=C.1） | ✓ |
| `packages/vfsl-protocol/package.json` 新建 | 存在（=C.2） | ✓ |
| `packages/vfsl-protocol/tsconfig.json` 新建 | 存在（=C.3） | ✓ |
| `…/test/vfsl-protocol-projection.test-d.ts` [SA6 owned] | 存在（284 行，SA6 R1+修订轮产出） | ✓ |
| `…/test/vfsl-protocol-empty-fail-closed.test-d.ts` [SA6 owned] 修改 | 存在（58 行，含 `LocalEmptyMap`） | ✓ |
| `…/test/vfsl-protocol-empty-module.test.ts` [SA6 owned] | 存在（27 行） | ✓ |
| `vitest.config.ts` 修改 | =C.4 | ✓ |
| 根 `package.json` scripts 修改 | `test: vitest run --typecheck`、`typecheck: tsc -p packages/vfsl/** && tsc -p packages/vfsl-protocol/**`（=C.5） | ✓ |
| `pnpm-lock.yaml` importers 修改 | vfsl-protocol 条目已补 | ✓ |
| `wiki/raw/task_vfsl-protocol*.md` | 简报/设计/评审/派遣日志齐备 | ✓ |

### 抽查（无时间痕迹，内容抽验）
- `packages/vfsl/package.json` **version 仍 0.1.7**（引擎包未动）；`packages/vfsl/` 下仅 src/test/tsconfig/node_modules，无新增文件 → DENY `packages/vfsl/**` 遵守。
- `docs/adr/` 五文件原样（0001–0005 均在，无新增/改动痕）；`static` grep `vfsl-protocol` 仅命中根 package.json scripts 与新包 package.json → **无其它文件被动**。
- `docs/**`、`.github/workflows/ci.yml`（C.8：不动，结论符合）未改。
- `.mabf-bg/probe.txt` 存在 = 总控自留探针（不入 commit，总控收尾处理），**非 SA3 越界**，登记在案。
- 结论：**无 scope creep**。SA3 交付严格限定在六文件加三次配置锁点，未触碰任何 DENY/SA6-owned 文件。

### lockfile 缩进专项（C.6 门禁，逐字符核对）
`pnpm-lock.yaml` 行 18-34 读核 + grep 断言：

```
行18:  packages/vfsl:             ← 2 空格键
行19:    devDependencies:          ← 4 空格
行20:      typescript:             ← 6 空格
行21-22:  specifier ^5.9.3 / 5.9.3 ← 8 空格
行23:      vitest:                 ← 6 空格
行24-25:  specifier ^3.2.4 / 3.2.7 ← 8 空格
（空行）
行27:  packages/vfsl-protocol:     ← 2 空格键（grep `^  packages/` 命中两钥匙一致）
行28:    devDependencies:          ← 4 空格
行29-34:  typescript/vitest 6 空格、specifier/version 8 空格，缩进与 vfsl 块**完全同构**
```

- importer 键 2 空格、`devDependencies` 4、依赖名 6、specifier/version 8 —— **逐位对齐** `packages/vfsl:` 块与 C.6 蓝图，无四空格错配（SA2 R2 攻击 3 已修复）。
- 新条的 `specifier: ^5.9.3`/`^3.2.4` 与包 package.json devDeps **逐字一致**；`version: 5.9.3`/`3.2.7` 在 `packages:` 解析段（行 516 `typescript@5.9.3:`、行 566 `vitest@3.2.7:`）已存在锁定 → `--frozen-lockfile` 静态门禁过（§F 待实测补跑强校验）。

---

## 类型机制边界攻击记录（第 2 节逐项推演结果）

### fail-closed 完整性 —— 闭合 ✓
空表 `PathAt<LocalEmptyMap,['name']>` 全链：`RootSchema<LocalEmptyMap> = PathSchema<LocalEmptyMap,'map'>` → `Step<…,'name'>`：K='map' 命中可下钻 → `'name' extends MemberKeys<LocalEmptyMap>`. `MemberKeys<LocalEmptyMap>`：`interface LocalEmptyMap {}` **无 index signature** → `extends Record<infer Key,unknown>` 假 → `never`. → `'name' extends never` 假 → `Step` 返 `never` → `PathAtImpl` 识 `[never]extends[never]` → `UnknownPath<['name']>` ✓.
访问面：`patch/read/kindOf` 单点判据（path 参数 `Path & (cond ? never:unknown)`），Path 采字面量 tuple 或 `string[]` 均坍缩 `never`（见下「健壮性」注）→ 空表负例 1/2/3 四 `@ts-expect-error` 均真实命中（静态成立，运行时交 §F-2 实测）。

### Step 分发正确性 —— 闭合 ✓
- `Step<PathSchema<Image|Text,'map'>,'url'>`：K 命中 → `'url' ∈ MemberKeys = 'kind'|'url'|'body'`（裸分发 keyof 并集）→ `MemberLookup<Image∪Text,'url'>` 裸分发：Image 支命中 `PathSchema<string,'leaf'>`、Text 支缺键补 `undefined` → **`PathSchema<string,'leaf'>|undefined`** ✓（读 T|undefined 唯一来源，R2-攻击 1 落点）。
- `'kind'`（全成员命中）：无缺键支 → `PathSchema<'image'>|PathSchema<'text'>`，**无 undefined** ✓（判别字段精确字面量）。
- 未知键落 `never → UnknownPath` ✓（负例 2 行 232 `nonexistentField`）。
- plain 终态：`attachments = PathSchema<string[],'plain'>`，K='plain' ⊄ {'map','array'} → `never → UnknownPath` ✓（D1 负例）。leaf 终态同理（`['tree','title','name']` → UnknownPath，负例 2 行 230）。

### 读写投影二象性 —— 闭合 ✓
- `PathValue<PathSchema<string,'leaf'>|undefined>` = `VfslValueOf` 分发 → `string | VfslValueOf<undefined>` = `string|undefined` ✓（正例 4）。
- `PathPatchValue<同>`：undefined 支非 PathSchema → `:never`；leaf 支直取 `string` → `string|never = string` ✓（D2 写投影丢 undefined）。

### VfslValueOf<undefined> —— 闭合 ✓
`undefined` 非 PathSchema → `: T = undefined` ✓（undefined 通道设计必为之支）。

### PathKind<节点|undefined> —— 闭合 ✓
非 UnknownPath；分发：PathSchema 支取 K、undefined 支 `:never` → `K|never = K` ✓（对成员独有字段读不出 kind 歧义）。

### PathElementValue —— 闭合 ✓
`PathElementValue<PathAt['tree','entities']>`：Node=`PathSchema<Record<\`${number}\`, ElUnion>,'array'>` → K='array' → `V extends Record<infer _Idx,infer ElNode>` 取 ElNode → `VfslValueOf` 分发 → 判别联合 ✓（三件套正例）。非 array 节点（name leaf）→ K≠'array' → `never`；且 `appendToArray` path 另带 `PathKind extends 'array' ? unknown : never` 双闸 → 非数组路径负例闭合 ✓。

### 越 undefined 下钻 —— 闭合 ✓
`['tree','entities','0','url','x']`：'url' 后 `PathSchema<string,'leaf'>|undefined` → 下一段 'x'：`Step<union,'x'>` 分发：leaf 支终态拒、undefined 支非节点 → 均 `never` → `UnknownPath<['x']>` ✓。不产生叶末悬空宽类型。

### 暗门扫描 —— 闭合 ✓
- `VfslValueOf` `:T` 透传：仅经由 PathValue 暴露，测试/矩阵只喂 PathAt 产物。undefined 通道是成员独有字段读的必要设计，非任意宽化。**评估：够窄**（直接对 `PathValue<string>` 调用得 string 属导出工具自担，非攻击面；投影链中永不注入非节点）。
- 全链无意外 `any/unknown` 产出、无 `never` 窄化吞噬合法值。三访问方法 path 坍缩不误杀合法路径（正例通过依赖字面量 tuple 推断——见 SA7 清单 A）。

---

## 测试质量审查

### projection.test-d.ts
- 正例 1-6 / 负例 1-4 / D1 / D2 / D5 与任务简报 §8.4 矩阵 + 设计机制逐条对齐（映射见简报「用例→验收标准」表）：正例 1 `name→string`、2 `portraitResourceId→string|null`、3 整实体判别联合写、4 read 精确类型（含成员独有 `url→string|undefined`、判别 `kind→'image'|'text'`、整实体判别联合）、5 分发 helper 窄化、6 kindOf（含 `kindOf([])→'map'`）。
- **正例 5 已按 C.7-5 改分发 helper**（行 157-165）：`type UrlOf<E> = E extends {kind:'image'} ? E['url'] : never` —— 裸类型参数分发正确，`UrlOf<Entity> = string|never = string ≠ never` ✓（R3-CRITICAL 已闭环）。`not.toEqualTypeOf<never>()` 非空即过 ✓。
- 三件套 + PathElementValue 断言在（行 250-276）✓（C.7-3/4）。
- **负例 `@ts-expect-error` 自反转语义评估**：
  - 自我反转方向正确：凡「本应报错」被误放行 → 无错误 → `@ts-expect-error` 变 unused-directive → 编译错误 → 断言 RED ✓。
  - **D1 负例（行 199-202）为 LOW 观察**：`@ts-expect-error` 压在 `expectTypeOf<PathValue<PathAt<'attachments','0'>>>().toEqualTypeOf<string>()` 上。该断言锚定的是「`attachments('0')` **不是 string**」，而非严格「== `UnknownPath`」：
    - 若 SA3 错误实现使 `attachments('0')` 解析成 string 叶 → 匹配 string → 无错误 → unused-directive → **RED ✓（能捕获 terminal 泄漏成 string 的回归）**。
    - 但若错误实现产出任意**非 string 宽类型**（如 number/any-node），`toEqualTypeOf<string>` 仍 mismatch → `@ts-expect-error` 抑制 → **假绿**。即该断言**不足以锚定「plain 终态拒绝」的全集**，只锚定「≠string」子集。
    - 建议（不阻塞）：加强为 `expectTypeOf<PathAt<AugVfslPathMap,['tree','attachments','0']>>().toEqualTypeOf<UnknownPath<['0']>>()`（`PathValue<UnknownPath>=UnknownPath<['0']>` 精确相等），直接校验失败态形状。**回流：SA6（LOW，增强项，可选）**。
- 其余负例（1/2/3/4）锚定值类型/键空间，经上文推演均真实命中。

### empty-fail-closed.test-d.ts
- 已按 C.7/B.1 换 `LocalEmptyMap`（行 31）+ `declare const access: VfslTypedAccess<LocalEmptyMap>`（行 34），头注释明示「module augmentation 程序级全局、本地空接口隔离」✓（回读门禁：`LocalEmptyMap` 在场、四 `@ts-expect-error` 保留）。
- 四断言（patch×2/read/kindOf）对空表路径：路径坍缩 `never` 编译错误（静态成立）✓。隔离逻辑自洽——不依赖「VfslPathMap 未增广为空」这个被证伪前提。

### empty-module.test.ts
- `Object.keys(ns)` 为空的推演在「全 type-only export + declare const ambient」下成立：index.ts 无值导出；`declare const __vfslNodeBrand` 未 export 且被 TS 擦除；`export type/interface` 在 `verbatimModuleSyntax` 下经 esbuild 擦除 → **编译产物空模块**，`import * as ns` 到空模块 → `Object.keys` = [] ✓（运行时交 §F-7）。

### 测试与实现签名一致性
- 六方法签名（patch/read/kindOf/appendToArray(path,value)/insertIntoArray(path,index,value)/deleteFromArray(path,index)）在各测试调用与 index.ts 逐一比对——**全部一致**（`Patch` 泛型 `readonly string[]` 约束、append/insert 第二参 value 为元素、insert 显式 `index:number`、delete 无 value 且不受攻击 4 影响）✓。

---

## CI 触发性（静态）

- 触发链完整：CI `pnpm test` → 根脚本 `vitest run --typecheck` → vitest.config `test.typecheck`（enabled+include `packages/*/test/**/*.test-d.ts` 匹配两 test-d 文件、`tsconfig` 指向 vfsl-protocol）→ + `*.test.ts` include 匹配 empty-module.test.ts（passWithNoTests 兜底）✓。
- `pnpm typecheck` → 两包 `tsc -p`（根脚本 `&&` 聚合）✓；vfsl-protocol/tsconfig include src+test 覆盖 `*.test-d.ts`（`.test-d.ts` 以 `.ts` 结尾，被 `test/**/*.ts` glob 命中）✓。
- `--frozen-lockfile`：新 importer specifier 与包 devDeps 逐字一致（^5.9.3/^3.2.4）、version 与解析段已验证一致（5.9.3/3.2.7 在 `packages:`）→ 静态过 ✓。
- Node 20/24：纯类型包，无版本敏感运行时 API（唯一运行时面是 empty-module namespace import，Node 版本无关）✓。
- **自名解析静态门禁（§D.2-⑧）**：测试 `import '@nomicore/vfsl-protocol'`；包 package.json name+exports 就位（self-reference）、moduleResolution:bundler 支持 —— 静态可验部分全过；**实际解析须 tsc 实测**，交 §F（C.4 已备相对路径兜底）。

---

## 动态审核重点（交 SA7）

以下为**必须实测核验**的运行时/编译项（源自 §F 清单 + 本报告发现；SA7 报告须引用 §F 结果）：

- **A.【关键-全机制锚】字面量 tuple 推断必须成立**：`patch(['name'],'ok')` 等正例的 `Path` 泛型须推断为字面量 tuple（`['name']`）而非 `string[]`——否则 `Seg` 落 `string ⊄ 键空间` → 正例误红。验证手段：§F-3(F.3-3/8) 正例编译通过即闭环；若红 → 检查推断（design D.2-⑨ / A.7.1）。
- **B. read/kindOf 单点 fail-closed 实测闭环**：`read(['notDeclaredKey'])`/`kindOf([...])`/空表三例须报编译错误（TS2345/2322），非静默放行（§F-1/2）。这是设计 R3-2（MEDIUM）的取证欠账，双轨轨二。
- **C. empty-module 运行时零导出**：`Object.keys(ns)` 实测为 `[]`（§F-7）——验 D3 空模块。
- **D. `@ts-expect-error` 自反转**：projection 负例 1-4 + D1 负例 + 三件套负例、empty 四断言均须「真实命中」——无 unused-directive（§F-1/2/5）即验证自我反转生效。
- **E. 三件套正/负例**：`appendToArray(['tree','entities'],{kind:'image',url:'u'})` 通过、`appendToArray(…,'x')`/`insertIntoArray(…,{kind:'image'})` 报错（§F-5/6）——验 `PathElementValue` 元素判别联合。
- **F. 分发 helper 正例 5**：`UrlOf<Entity>`/`BodyOf<Entity>` = `string`，`not.toEqualTypeOf<never>()` 通过（§F-4）——若此步 RED 则 C.7-5 未落地，退回 SA6。
- **G. §F-8 推导抽查**：`PathAt<Map,['tree','entities','0','url']>` 含 `|undefined`、`PathValue<'kind'>` = `'image'|'text'`、`['tree','entities','5']` = Image|Text。
- **H. 自名解析实测**：`tsc -p packages/vfsl-protocol/tsconfig.json` 能否解析 `@nomicore/vfsl-protocol` 自名 import（§D.2-⑧ 中风险）；失败则按 C.4 兜底转相对路径 import（增广目标保持包名）。
- **I. 单条命令集合**：`pnpm install --frozen-lockfile`（验 lockfile 手工条目）、`pnpm typecheck`、`pnpm test`（§F-2 两项）。任一失败 → 按 §F.4 结论闸门回流 SA3/SA4/SA6。

---

## 汇总

- **Verdict: pass**（无 CRITICAL/HIGH 存活）。
- 8 项结论：设计一致性 ✓ / 读写路径一致性 ✓ / 静默失败 ✓ / 降级方案 N/A(零运行时) ✓ / 极端攻击 ✓ / 错误处理 ✓ / 架构评估 ✓ / 过度设计 ✓。
- Scope creep：**无**（ALLOW 全覆盖、DENY 全遵守、lockfile 缩进逐位对齐）。
- 问题清单：
  - **LOW** — projection 测试 D1 负例（行 199-202）仅锚定「≠string」，不足以确证「==UnknownPath」全量（假绿风险限于「非 string 错误类型」）。建议 SA6 加强为直接 `toEqualTypeOf<UnknownPath<['0']>>`（可选，不阻塞）。
  - **MEDIUM（设计已预登记）** — read/kindOf 单点 fail-closed 与字面量 tuple 推断均无实测证据（§D.2-⑨/⑧、A.7.1、R3-2），非 SA3 缺陷，交 §F/SA7 闭环。
- 动态审核重点：见上 SA7 清单 **A–I（9 条）**。
---

## R2 增量复审（2026-08-20）

**Verdict**: **pass**

R1 全绿后，本轮仅复审：SA3-R2 实现（index.ts 140→155 行，fail-closed 机制换型）+ SA6 三次微量修复 + 总控实跑全绿的真实性与完备性。

### R4 机制一致性核验
- **C.1 代码块逐字比对**：`index.ts` 六方法签名（L118-151）、`FailClosedRest`（L104-107）、`ArrayEditRest`（L110-113）、内部助手不导出，与设计 C.1 代码块（行 626-675）**逐字一致**——含 `const P extends readonly string[]`、value/index/返回位全 `NoInfer<P>`、`...rest: FailClosedRest/ArrayEditRest` 必需标记、各方法 TSDoc 锚点。A.7.2 rest 标记链版签名吻合。
- **新机制安全推演**：① 合法路径 `PathAt<Map,P>` 非 UnknownPath → `FailClosedRest=[]` → 收零 rest，调用面不变（D5 `[]`→`readonly []`→`kindOf([])='map'` ✓）；② 失败路径 UnknownPath → 必需单元素 `[error:…]` → 缺参 **TS2554** 报错；含 value 方法 `patch/append/insert` 另由 `PathPatchValue<UnknownPath>=never` value 双钳 → **双重 fail-closed 保留**；③ 三件套 `ArrayEditRest` 二段链：先 `UnknownPath`、再 `PathKind≠'array'` → 缺参（`deleteFromArray(['name'],0)` 命中 leaf 门禁）。判据两向正确。
- **零旧机制残留**：`index.ts` grep `Path & (…never)`/never 交叉参数 → **无残留**；仅 TSDoc 字面「≠ keyof」解释性文本（非代码）。

### SA6 三处修复正当性
- **① 头注释 `*/` glob 序列**：projection 头注释（L1-47）与 empty-fail-closed 头注释（L1-25）现无任何块注释内赘余 `*/` 闭合序列（仅正常 `*/` 结尾）——消除语法错误，纯注释层改动，零语义影响 ✓。
- **② D1 负例（projection L197-207）**：由 R1 的 `@ts-expect-error` +「≠string」改为**精确等价断言** `PathValue<PathAt<...[,'tree','attachments','0']>> = UnknownPath<['0']>`。trace：attachments 为 `plain` 终态 → Step 拒下钻 → `UnknownPath<['0']>` → VfslValueOf `:T` 透传 → 精确相等。**直接兑现 R1 LOW 增强项**（SA4 R1 报告 L136）——比 R1 更强、最小；`@ts-expect-error` 计数投影降到 9，等价于「负例改原子精确断言」，未夹带弱化/删除 ✓（仍锚定 plain 终态拒下钻 = UnknownPath）。
- **③ 正例 5 分发 helper（L156-161）**：`UrlOf<E> = E extends { kind:'image'; url: infer U } ? U : never`——infer 形态取成员独有字段，`UrlOf<Entity>/BodyOf<Entity>` 均为 `string`（≠never）→ `not.toEqualTypeOf<never>()` 通过；仍验证整值窄化，语义保持 ✓。
- **无越界**：`@ts-expect-error` 真实计数 projection=9、empty=4，与正/负例断言语义一一对应，无删除、无削弱。

### 全绿真实性与验收覆盖矩阵（8 条 AC → 测试锚点）
- **verify4.log 核验**：输出形状 `Test Files 18 passed (18) / Tests 361 passed (361) / Type Errors no errors`、`EXIT_TYPECHECK=0`、`EXIT_TEST=0`；两 SA6 test-d 在列（projection 16 / empty-fail-closed 3）、empty-module 1 test 在列、15 个 vfsl 既有文件无回归；vitest.config `typecheck.include **/*.test-d.ts` + tsconfig=vfsl-protocol（include src+test，覆盖两 test-d）实跑证实 ✓。真实性可信（总控实跑日志，非自报）。
- **AC 映射**：
  - AC1 空模块零导出 → empty-module.test.ts（`Object.keys(ns)==[]`）+ package.json devDeps 仅 tsc/vitest ✓
  - AC2 空表 fail-closed → empty-fail-closed.test-d.ts 4 断言 ✓
  - AC3 §8.4 正例 → projection 正例 1/2/3/4/6 ✓
  - AC4 §8.4 负例 → projection 负例 1/2/3/4（9 directives）✓
  - AC5 D1 → projection D1 正例 + D1 负例（精确 UnknownPath）✓
  - AC6 D2 → projection 正例 4（url→`string|undefined`、kind→字面量联合）+ 正例 5（窄化）+ D2 正例 ✓
  - AC7 D5 → projection 正例 6（`kindOf([])='map'`）+ 增广表顶层无 ROOT 前缀 ✓
  - AC8 增广生效 + CI typecheck → projection `declare module` 全表被正例解析 ✓；CI Node 20/24 由 ci.yml（node=[20,24] 原样未动）→ `pnpm test`（= `vitest run --typecheck`）静态触发链可完整指认；纯类型包无版本敏感运行时 → 可静态闭合 ✓
- **8 条 AC 全有锚点**，矩阵闭合（CI 触发链静态可指认）。

### Scope 终检
- git 状态复核：M `TASK.md/package.json/pnpm-lock.yaml/vitest.config.ts` + 新增 `packages/vfsl-protocol/{package.json,tsconfig.json,src,test×3}` + `wiki/raw×6(.mabf-bg 不入 commit)`——与总控冻结一致，无越界新文件。
- **DENY 零触碰**：`packages/vfsl/package.json` version=**0.1.7**（引擎包未动）；`git diff .github/` 与 `docs/` **空** → ci.yml 原样、ADR 原样。
- index.ts：**零 import（零依赖）**、零值域（`declare + interface + type` only）、export 集 = 11 语义类型（VfslKind/PathSchema/UnknownPath/RootSchema/PathAt/VfslValueOf/PathValue/PathKind/PathPatchValue/PathElementValue/VfslTypedAccess）+ VfslPathMap；内部助手含 FailClosedRest/ArrayEditRest 均不导出 ✓。

### 结论
**放行 commit。** 四块核验全通过：R4 机制一致（C.1/A.7.2 逐字对齐、双 fail-closed 保留、array 门禁链正确、零旧残留）；SA6 三处修复最小且语义保持（D1 精确断言反更强）；全绿真实可信（总控实跑 18 文件/361 测试/Type Errors 0）且 8 条 AC 全有测试锚点（CI Node 20/24 触发链静态闭合）；scope 干净（DENY 零触碰、export 集/零依赖符合契约）。R1 遗留 LOW 已由 SA6 修复闭环。
