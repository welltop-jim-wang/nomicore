# Bug — 非有限 number（NaN/±Infinity）经 copyPlainValue 标量直通进入 ok:true 快照，JSON 序列化后无信号变 null（PR #81 review P1）

**Status**: analyzed | **Date**: 2026-08-22
**Severity**: high（P1 正确性：契约违约 + 零信号数据变化；无崩溃、无安全问题）
**Type**: new-feature-defect（自首次实现 079e957 即存在，非回归；源头是设计 §4.6 伪代码同名缺口）
**Layer**: backend（`packages/doc-runtime` 单包内）

---

## 0. 触发来源：PR #81 owner review 反馈（逐字引用）

> ## PR #81 review：合并前需修复
>
> 结论：主体实现质量较高，但发现 **1 个 P1 正确性问题**，当前不建议合并。
>
> ### P1：非有限 `number` 被当作合法 JSON logical snapshot 返回
>
> 位置：`packages/doc-runtime/src/extract.ts:258-260`
>
> 当前 `copyPlainValue()` 对所有 JavaScript `number` 直接返回成功，因此以下值都会进入 `ok:true` 快照：
>
> - `NaN`
> - `Infinity`
> - `-Infinity`
>
> 这些值不属于 JSON 数值域，`JSON.stringify()` 会将它们静默转换成 `null`。这违反本任务关于"普通 logical ROOT snapshot / 纯 JSON 值域 / 与 live doc 解耦"的契约，并会造成无信号的数据变化。
>
> 本地确定性复现，schema 为：
>
> ```ts
> type ROOT = { n: YLeaf<number> };
> ```
>
> 向 `ROOT.n` 分别写入三个非有限值后：
>
> ```text
> NaN       → { ok: true, snapshot: { n: NaN } }
> Infinity  → { ok: true, snapshot: { n: Infinity } }
> -Infinity → { ok: true, snapshot: { n: -Infinity } }
> ```
>
> 但序列化后都变成 `{ "n": null }`。
>
> ### 建议修复
>
> 在 `copyPlainValue()` 中单独处理 number：只有 `Number.isFinite(v)` 才允许进入 snapshot；否则返回 fail-fast 单 issue，例如：
>
> ```ts
> if (typeof v === 'number') {
>   if (!Number.isFinite(v)) {
>     return plainDomainIssue(path, loc, 'non-finite number')
>   }
>   return { kind: 'value', snapshot: v }
> }
> ```
>
> ### 必补回归测试
>
> 至少覆盖：
>
> 1. leaf 位置的 `NaN`；
> 2. plain object 内的 `Infinity`；
> 3. plain array 内的 `-Infinity`；
> 4. 均返回 `ok:false`、fail-fast 单 issue；
> 5. `expected === 'plain value'`；
> 6. `actual === 'non-finite number'`（或冻结的等价词汇）；
> 7. issue path 锚定对应 schema 声明节点；
> 8. 有限 number 正向对照继续通过，且快照 JSON 往返全等。
>
> 其他审查范围内暂未发现阻塞问题。修复后请重新运行 doc-runtime 针对性测试、全量 `pnpm test`、`pnpm typecheck` 与 Node 20/24 CI。

---

## 1. Symptoms（症状）

对 schema `type ROOT = { n: YLeaf<number> }` 的 live doc 写入非有限 number（`NaN` / `Infinity` / `-Infinity`）后调用 `extractYjsSnapshot(derived, doc)`：

- 返回 `{ ok: true, snapshot: { n: <非有限值> } }` —— 非有限值被当作合法 JSON 值放行；
- 对该 snapshot 执行 `JSON.stringify()` 得 `{"n":null}` —— 数值语义**零信号蒸发**（无 issue、无异常、无日志）；
- `JSON.parse(JSON.stringify(snapshot))` 与 snapshot 深比较**不等** —— 违反任务契约「成功返回普通 logical ROOT snapshot（纯 JSON 值域）」与既有测试的「JSON 往返无损」断言口径（SA6 冻结幸福路径即断言 `JSON.parse(JSON.stringify(snapshot))` 深等 snapshot）。

影响范围：`extractYjsSnapshot` 全部成功路径中任何 number 位（leaf 直存 / plain object 值 / plain array 元素 / Record 值 / union 成员内），只要值非有限即触发。下游消费者（validateLogicalSnapshot 前置的提取产物、持久化 / 传输层 JSON 序列化）拿到的是「提取期 ok、序列化期突变」的数据。

## 2. Reproduction（实证复现）

复现脚本（一次性，位于 worktree 允许的 scratch 区 `.mabf-bg/sa5-repro-nonfinite.ts`，验证后已删除；脚本全文见附录 A）：经 `derivedOf()`（`parseVfsl` + `evaluate`，与测试同构）构造 vfsl 派生 schema，向 `Y.Doc` 的 `ROOT` map 写入非有限值，调 `extractYjsSnapshot` 后打印结果、`JSON.stringify` 产物与往返保真判定（`util.isDeepStrictEqual`）。

真实命令与输出（Node v24.13.0 / tsx 4.23.12 / worktree `fix/issue-73-on-docs-doc-runtime-validation` @ 8869ade）：

```text
$ cd /home/wangjian/nomicore-fix-issue-73
$ ./node_modules/.bin/tsx .mabf-bg/sa5-repro-nonfinite.ts        # EXIT=0

=== [SA5-DIAG] PR #81 review P1 复现：非有限 number 走 JSON 标量直通 ===

基线事实：JSON.stringify(NaN)=null  Infinity=null  -Infinity=null

[1] leaf 位 NaN（schema: type ROOT = { n: YLeaf<number> }）
  result     : { ok: true, snapshot: { n: NaN } }
  JSON.stringify(snapshot) → {"n":null}
  JSON 往返保真: NO —— 无信号数据变化（NaN/±Infinity → null）

[1] leaf 位 Infinity（schema: type ROOT = { n: YLeaf<number> }）
  result     : { ok: true, snapshot: { n: Infinity } }
  JSON.stringify(snapshot) → {"n":null}
  JSON 往返保真: NO —— 无信号数据变化（NaN/±Infinity → null）

[1] leaf 位 -Infinity（schema: type ROOT = { n: YLeaf<number> }）
  result     : { ok: true, snapshot: { n: -Infinity } }
  JSON.stringify(snapshot) → {"n":null}
  JSON 往返保真: NO —— 无信号数据变化（NaN/±Infinity → null）

[2] plain object 内 Infinity（schema: { arr: YPlainArray<{ x: number }> }，live arr=[{x:1},{x:Infinity}]）
  result     : { ok: true, snapshot: { arr: [ { x: 1 }, { x: Infinity } ] } }
  JSON.stringify(snapshot) → {"arr":[{"x":1},{"x":null}]}
  JSON 往返保真: NO —— 无信号数据变化（NaN/±Infinity → null）

[3] plain array 内 -Infinity（schema: { arr: YPlainArray<number> }，live arr=[1,-Infinity]）
  result     : { ok: true, snapshot: { arr: [ 1, -Infinity ] } }
  JSON.stringify(snapshot) → {"arr":[1,null]}
  JSON 往返保真: NO —— 无信号数据变化（NaN/±Infinity → null）

[4] 跨端 encodeStateAsUpdate/applyUpdate 后读回 typeof n = number，值 NaN? true
    远端 doc 提取结果（NaN 跨端仍可达）
  result     : { ok: true, snapshot: { n: NaN } }
  JSON.stringify(snapshot) → {"n":null}
  JSON 往返保真: NO —— 无信号数据变化（NaN/±Infinity → null）

[5] 正向对照：有限 number（n=42, arr=[1,2,3]）
  result     : { ok: true, snapshot: { n: 42, arr: [ 1, 2, 3 ] } }
  JSON.stringify(snapshot) → {"n":42,"arr":[1,2,3]}
  JSON 往返保真: YES
```

**复现结论：成功。** owner 报告的三行输出逐字重现（`{ ok: true, snapshot: { n: NaN } }` 等三例 → `{"n":null}`），且额外证实：

- owner 必补场景 2（plain object 内 Infinity）与场景 3（plain array 内 -Infinity）当前同样 ok:true + 序列化变 null；
- **跨端可达**（E1 式路由）：`NaN` 经 `encodeStateAsUpdate`/`applyUpdate` 同步后远端读回仍为 `number NaN`，提取结果同样 ok:true——脏数据不局限于本地写入端（与 bigint 的 E1 可达性同构）；
- 有限 number 正向对照不受影响（修复不得误伤的基线）。

## 3. Investigation（调查过程）

阅读清单（Step 1+2，共 8 个文件，未超 10 文件上限）：

1. `wiki/raw/task_doc-runtime-extract-yjs-snapshot.md` — 任务简报 + SA6 三轮锚定记录（冻结契约：expected/actual 词汇表、四字段 issue 形状）；
2. `packages/doc-runtime/src/extract.ts` — 缺陷代码全文（walk 分发 / copyPlainValue / plainDomainIssue / putSnapshotKey）；
3. `packages/doc-runtime/src/carrier.ts` — 两层判定的粗判层（carrierOf 五值词汇表）；
4. `packages/doc-runtime/src/index.ts` — 公共接缝（仅 re-export，无逻辑）；
5. `packages/doc-runtime/package.json` — 版本 0.1.0、deps（vfsl workspace:* + yjs）；
6. `packages/doc-runtime/test/extract-plain-domain.test.ts` — D9② 申报词既有行为面测试（词汇表与断言 helper 的同构先例）；
7. `wiki/raw/task_doc-runtime-extract-yjs-snapshot_design.md`（§4.6/§4.8/D9/§10/B17 定位检索）— 设计伪代码与申报词登记；
8. `packages/doc-runtime/test/extract-yjs-snapshot.test.ts`（schema 语法与 plain 载体用例定位）+ vfsl `evaluate.ts`/`derived.ts`（grep 定位 `YPlainArray` → `kind: 'plain'` 纯值终态，确认 plain object/array 场景的 schema 构造方式）。

数据流追踪（写入 → 提取 → 序列化）：

```
Y.Map.set('n', NaN)                     # yjs 以 float64 存储，NaN/±Infinity 存取/跨端均存活（复现 [4] 实证）
  → walk(leaf 节点, NaN, ['n'])          # extract.ts:136-139：carrierOf(NaN)==='plain value' → 细判
    → copyPlainValue(NaN, ['n'], '')     # extract.ts:258
      → typeof NaN === 'number' 命中     # extract.ts:259 ←←← 唯一放行点（无 Number.isFinite 检查）
        → { kind:'value', snapshot: NaN } # 进入 ok:true 快照
          → 下游 JSON.stringify(snapshot) → {"n":null}   # 断点：JSON 数值域 ≠ IEEE-754 全域
```

对照：同为「JSON 序列化期静默变形」的 `undefined`（数组元素 → null）与 `bigint`（→ 抛 TypeError）均已被细判拦为真 issue（D9② 申报词），唯独非有限 number 是同一缺陷家族中漏网的一员——`typeof v === 'number'` 与 `typeof v === 'bigint'` 同在类型白名单语境，bigint 走了显式分支（:266-268），number 没有对应值域分支。

## 4. Root Cause（根因）

**缺陷点：`packages/doc-runtime/src/extract.ts:258-260`** —— `copyPlainValue()` 的 JSON 标量直通分支：

```ts
function copyPlainValue(v: unknown, path: Array<string | number>, loc: string): WalkResult {
  if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return { kind: 'value', snapshot: v }; // JSON 标量直通   ← 缺陷行（:259-260）
  }
```

`typeof v === 'number'` 将 JavaScript number 全域（IEEE-754 双精度：含 NaN/Infinity/-Infinity）放行为「JSON 标量」，但 JSON 数值域（RFC 8259 §6）只含有限十进制数——`Number.isFinite` 检查缺失。非有限值因此穿透细判层（该层职责恰是「plain 值是否 JSON 值域成员」，§4.1 两层判定），以 ok:true 进入快照，把「JSON 序列化期静默 null 化」这一数据突变留给下游无信号承受。

**根因溯源（design-level omission）**：缺陷并非 SA3 实现走样，而是**设计 §4.6 伪代码的同名缺口被忠实实现**——`task_doc-runtime-extract-yjs-snapshot_design.md` 第 442-443 行：

```ts
if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
  return { kind: 'value', snapshot: v };              // JSON 标量直通（bigint 不在此列——typeof 'bigint'）
```

设计期可达性盘点（§4.8 实证口径 + SA2 附录 B 探针 A1–E2/N1–N4）覆盖了 bigint/undefined/non-plain object/function/symbol/Y 类型内嵌，**唯独没有对 number 做有限性探针**——`typeof` 白名单的「类型级」审查天然看不见「值级」的 NaN/±Infinity。引入 commit：**079e957**（feat(doc-runtime): implement extractYjsSnapshot carrier extraction，首次实现即携带）；D9② 申报词表（'bigint'/'undefined'/'non-plain object'/'function'/'symbol'，§10 R2/#4 登记块「五词均可达」）同样未含此词。

**Fix direction**（供 SA1/SA3 参考，不展开实现）：按 owner 建议在 `copyPlainValue()` 首分支拆出 number 单独处理——`Number.isFinite(v)` 才直通，否则 `plainDomainIssue(path, loc, 'non-finite number')`（复用既有 D9② 申报词构造器，四字段形状/path 锚定/loc 位置线纪律全部继承）。同步项见 §6 影响面。

## 5. 修复点唯一性论证（单点修复是否足够）

**结论：extract.ts:259 是全代码库唯一的非有限 number 放行点，单点修复完整覆盖 owner 必补场景 1–3 的全部位置。** 论证：

1. **快照值的产出终态只有两处**（`walk` 全分发，extract.ts:85-146）：`xml-fragment` → 字符串投影（:134，无 number）；`leaf` / `plain` 两种 kind **共用同一细判入口** `copyPlainValue`（:136-139 单一 case 块）。map / array / Record / union / trialMember 的一切中间构造（`putSnapshotKey` / `out.push`）的值均来自 `walk` 递归，最终都汇入这两类终态——**没有任何绕过 copyPlainValue 的 number 通路**。
2. **嵌套位置经同一函数递归**：plain array 元素（:271-277，`copyPlainValue(el, path, \`${loc}[${i}]\`)`）与 plain object 值（:288-295，`copyPlainValue(val, path, \`${loc}.${k}\`)`）都是对 `copyPlainValue` 自身的递归调用——场景 2（object 内 Infinity，loc 形如 `[1].x`）与场景 3（array 内 -Infinity，loc 形如 `[1]`）的值必然再过 :259 同一分支。深层嵌套（object 套 array 套 object…）同理，递归闭包内无第二出口。
3. **全仓 number 相关代码检索佐证**：doc-runtime src 内 `typeof v === 'number'` 仅两处——carrier.ts:32（粗判层，返回 `'plain value'`，**职责正确无需改**：非有限 number 在结构错位位仍应报五值词汇表 `'plain value'`，细粒度拒绝归细判层，D1 两层判定不变式）与 extract.ts:259（本缺陷）。`isFinite`/`Number.isFinite` 全包零出现（grep 实证）——不存在其他已做有限性检查而遗漏联动的位置。
4. **carrier.ts / index.ts / vfsl 均无需改动**（详见 §6）：粗判层五值词汇表冻结（SA6 F4）；公共接缝签名与导出不变；vfsl 属逻辑校验域（ADR-0007 两步分离），提取期保证快照纯 JSON 后，逻辑域输入即已洁净。

## 6. 影响面评估

| 文件 | 是否需改 | 说明 |
|---|---|---|
| `packages/doc-runtime/src/extract.ts` | **是（唯一代码修复点）** | :258-260 拆 number 分支 + `Number.isFinite` 守卫；:252-257 `copyPlainValue` docblock 可达性清单补一行（non-finite number：leaf 直存 / plain 子树内嵌 / 跨端 E1 均可达，本报告复现 [1]-[4] 实证） |
| `packages/doc-runtime/src/carrier.ts` | 否 | 粗判层对 number 恒 `'plain value'` 是 D1 两层判定的正确行为；改它反而破坏「结构错位位 actual 恒五值词汇表」（bigint 先例：粗判 plain、细判 issue） |
| `packages/doc-runtime/src/index.ts` | 否 | 纯 re-export，接缝不变 |
| `packages/vfsl/**` | 否 | 数值有限性属提取期 JSON 值域断言（本能力辖域）；validateLogicalSnapshot 直用手造快照的值域不在此 bug 辖域（边界注记，不联动） |
| `packages/persistence/**`、`packages/dsh-persistence/**` | 否 | 无依赖（AC1 边界：persistence 不依赖 doc-runtime） |
| `wiki/raw/task_doc-runtime-extract-yjs-snapshot_design.md` | **是（SA1 设计回写）** | §4.6 伪代码 :442-443 同名缺口 + docblock 可达性清单；D9②（:34）与 §10 R2/#4 登记块（:668「五词均可达」）需增报第六词 `'non-finite number'`；§4.8 可达性表 / §6 行为表（B12-B13 邻域）建议补行——owner review 属最高优先级修复指令，满足 B17 立法的「扩申报词需正当收益」门槛 |
| `packages/doc-runtime/test/`（SA6 新红灯） | **是** | 新增回归测试文件（锚点建议见 §7）；既有 4 份测试文件断言零冲突（词表用例均未锚定 number 相关 actual，见 §8 分析） |
| `packages/doc-runtime/package.json` | **是（版本）** | `0.1.0` → `0.1.1`（patch：行为修复）。仓内惯例：版本随实质变更 commit 同步 bump（vfsl 0.2.0 @ f07462d breaking rename、persistence 0.1.2、vfsl-codegen 0.1.1 均如此）；doc-runtime 0.1.0 由 079e957 引入后未动过，本轮修复即首个 patch 位 |

CI 面：owner 要求的针对性测试 / 全量 `pnpm test` / `pnpm typecheck` / Node 20/24 复跑属 SA3→SA4 验证链；根 vitest.config.ts include 模式 `packages/*/test/**/*.test.ts` 自动收编新测试文件，workflow 无需改动（与本包建立时的 AC5 结论一致）。

## 7. 给 SA6 的红灯测试锚点建议（对照 owner 8 条逐条）

建议新文件 `packages/doc-runtime/test/extract-nonfinite-number.test.ts`（不改动 4 份既有冻结文件；命名沿 `extract-<主题>.test.ts` 先例：extract-union-trial / extract-plain-domain / extract-record-keyspace）。断言 helper 直接复用 `extract-plain-domain.test.ts` 的 `expectFailIssue(result, path, expected, actual)`（:59-80，含四字段形状完整 + 非 `'internal'` 双守卫）与 `expectOkSnapshot`。

| # | owner 要求 | 锚点建议（schema / live 写入 / 断言） |
|---|---|---|
| 1 | leaf 位 NaN | `type ROOT = { n: YLeaf<number> };` + `doc.getMap('ROOT').set('n', NaN)`（owner 原始 schema 逐字）→ `expectFailIssue(r, ['n'], 'plain value', 'non-finite number')` |
| 2 | plain object 内 Infinity | `type ROOT = { arr: YPlainArray<{ x: number }> };` + `set('arr', [{ x: 1 }, { x: Infinity }])` → `expectFailIssue(r, ['arr'], 'plain value', 'non-finite number')`（本报告复现 [2] 实测当前 ok:true——真实红） |
| 3 | plain array 内 -Infinity | `type ROOT = { arr: YPlainArray<number> };` + `set('arr', [1, -Infinity])` → `expectFailIssue(r, ['arr'], 'plain value', 'non-finite number')`（复现 [3] 实测当前 ok:true） |
| 4 | ok:false + fail-fast 单 issue | `expectFailIssue` 内建：`result.ok === false` + `issues.length === 1`（D9② 家族统一形状） |
| 5 | expected === 'plain value' | `expectFailIssue` 第三参（同 helper 已断言 `typeof === 'string'` + 精确值） |
| 6 | actual === 'non-finite number'（冻结词） | `expectFailIssue` 第四参；**建议在文件 docblock 显式冻结该词**（沿 plain-domain 文件 :14-18 docblock 词表声明先例），并保留 `actual !== 'internal'` E100 误分类守卫 |
| 7 | issue path 锚定 schema 声明节点 | 场景 1 锚 `['n']`（leaf 声明节点）；场景 2/3 锚 `['arr']`（plain 声明节点——与 bigint D2 用例锚 `['arr']` 同构：违规内部位置线 `[1].x` / `[1]` 只进 message 不进 path，R2/#8 锚定精度纪律）；可另断言 `issue.message` 含 `'内部位置 [1]'` / `'[1].x'` 强化定位（message 非 SA6 冻结域，建议只做包含性断言或不锚） |
| 8 | 有限 number 正向对照 + JSON 往返全等 | `{ n: 42, arr: [1,2,3] }`（复现 [5] 实测当前 ok 且往返 YES）→ `expectOkSnapshot` + `expect(snapshot).toEqual({ n: 42, arr: [1, 2, 3] })` + `expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)`（与 plain-domain 正向对照 :158-168 同构）；建议追加 `0`、`-0`、小数（如 `0.1`）防误伤边界 |

可选加固（超出 owner 8 条，SA6 自行裁量）：跨端路由用例（`encodeStateAsUpdate`/`applyUpdate` 后远端提取，本报告复现 [4] 实证可达——对齐 bigint E1 先例）；三值各自独立 leaf 用例（owner 报告即三值分列）。

**红灯真实性预期**：当前实现下场景 1–3 断言 4–6 全部真实失败（`expected false to be true` / 词不匹配），非构造性红灯——本报告 §2 复现输出即失败实况，SA6 落位后无需 stub 即得真红。

## 8. 申报词核对（D9② 词汇表一致性）

- **既有申报词表**（design D9② :34 + §10 R2/#4 登记块 :668 + plain-domain 测试 docblock :14-18）：可达五词 `'bigint'` / `'undefined'` / `'non-plain object'` / `'function'` / `'symbol'`（后两词 R2.1/R-2 改判入可达组），另有 E100 `'internal'`（D9①）与 Y 类型内嵌的词汇表载体名（P22，`'Y.Map'` 等）。`expected` 侧恒 `'plain value'`。
- **风格一致性评估**：既有词两类风格——`typeof` 名（bigint/undefined/function/symbol）与「non- 否定描述短语」（non-plain object）。`'non-finite number'` 属第二类，与 `'non-plain object'` 完全同构（「non- + 违反的域属性 + 值类型名」），小写空格分隔、稳定词（非动态内容——constructor 名那类动态信息进 message 不进 actual 的纪律同样适用）。**评估：风格一致，无违和。**
- **备选词否决**：`'NaN'`（不能覆盖 ±Infinity）、`'number'`（与放行的有限 number 无法区分，误导排障）、`'Infinity'`（以偏概全）——owner 建议词即最优，建议直接冻结 `'non-finite number'`。
- **需同步的词表声明位置**（改动即申报面扩大，逐处过一遍）：
  1. design D9②（:34 可达组）与 §10 登记块（:668「五词均可达」→ 六词）——**必改**（B17 立法：扩词必须登记，owner 指令即正当性）；
  2. design §4.6 伪代码 docblock 可达性清单（:432-439）+ §4.8 可达性表——随修复回写；
  3. `extract.ts:252-257` copyPlainValue docblock 可达性清单 + `:27` ExtractIssue.actual 注释——随修复回写；
  4. `extract-plain-domain.test.ts` docblock（:14-18）列有词表——该文件系 SA6 owned 冻结面，**不改既有断言**；新词声明放新测试文件 docblock（§7 建议）；
  5. SA6 冻结契约（task doc :53-54）的五值词汇表辖域 = **结构错位位**（expected 侧），D9② 扩展词属已申报偏离面（R2/#4 裁决先例）——新词沿同一申报通道，**不需要**动冻结契约原文；
  6. 检索确认：仓内无其他测试 / 文档枚举申报词全集（`extract-yjs-snapshot.test.ts` 与 `extract-union-trial.test.ts` / `extract-record-keyspace.test.ts` 均未锚定 plain 域词表；wiki 其余 bug/评审文档为历史记录，不改史）。

## 9. Evidence（证据汇总）

- 复现脚本与完整输出：§2（真实命令 + 逐行输出，EXIT=0；三值 leaf / object 内 / array 内 / 跨端 / 正向对照五组）；
- 缺陷代码：`extract.ts:258-260`（§4 引文）+ 设计伪代码同名缺口 `task_doc-runtime-extract-yjs-snapshot_design.md:442-443`；
- 引入 commit：`079e957`（`git log --follow -- packages/doc-runtime/src/extract.ts` 首笔；实现忠实于设计，属设计缺口传导）；
- 既有测试基线（证明红灯可归因 + 修复零回归参照）：

```text
$ ./node_modules/.bin/vitest run packages/doc-runtime
 ✓ packages/doc-runtime/test/extract-yjs-snapshot.test.ts (21 tests)
 ✓ packages/doc-runtime/test/extract-union-trial.test.ts (8 tests)
 ✓ packages/doc-runtime/test/extract-plain-domain.test.ts (9 tests)
 ✓ packages/doc-runtime/test/extract-record-keyspace.test.ts (2 tests)
 Test Files  4 passed (4)      Tests  40 passed (40)      Type Errors  no errors
```

40/40 全绿 = 现有行为面零覆盖非有限 number；新红灯文件的失败将唯一归因于缺失守卫（非环境 / 非既有断言漂移）。

- 唯一放行点检索：doc-runtime src 内 `typeof v === 'number'` 仅 carrier.ts:32（粗判，职责正确）与 extract.ts:259（缺陷）；`Number.isFinite`/`isFinite` 全包零出现；
- 版本管理：doc-runtime `0.1.0`（079e957 引入，未动过）；仓内 bump 惯例 = 版本随实质变更 commit 同步（f07462d → vfsl 0.2.0 等）。

## 附录 A：一次性复现脚本全文（`.mabf-bg/sa5-repro-nonfinite.ts`，已删除）

```ts
/**
 * [SA5-DIAG] 一次性复现脚本 — PR #81 owner review P1：
 * 非有限 number（NaN / Infinity / -Infinity）经 copyPlainValue() JSON 标量直通分支
 * 进入 ok:true 快照，JSON.stringify 后静默变 null。
 * 位置：packages/doc-runtime/src/extract.ts:258-260。验证后删除。
 */
import { inspect, isDeepStrictEqual } from 'node:util';
import * as Y from 'yjs';
import { evaluate, parseVfsl } from '@nomicore/vfsl';
import type { DerivedSchema } from '@nomicore/vfsl';
import { extractYjsSnapshot } from '../packages/doc-runtime/src/index.js';

function derivedOf(text: string): DerivedSchema {
  const parsed = parseVfsl(text);
  if (!parsed.ok) throw new Error(`parseVfsl 失败: ${JSON.stringify(parsed.issues)}`);
  const evaluated = evaluate(parsed.module);
  if (!evaluated.ok) throw new Error(`evaluate 失败: ${JSON.stringify(evaluated.issues)}`);
  return evaluated.derived;
}

function show(label: string, derived: DerivedSchema, doc: Y.Doc): void {
  const r = extractYjsSnapshot(derived, doc);
  if (r.ok) {
    const json = JSON.stringify(r.snapshot);
    const intact = isDeepStrictEqual(JSON.parse(json), r.snapshot);
    console.log(`${label}`);
    console.log(`  result     : { ok: true, snapshot: ${inspect(r.snapshot)} }`);
    console.log(`  JSON.stringify(snapshot) → ${json}`);
    console.log(`  JSON 往返保真: ${intact ? 'YES' : 'NO —— 无信号数据变化（NaN/±Infinity → null）'}`);
  } else {
    console.log(`${label}\n  result     : { ok: false, issues: ${JSON.stringify(r.issues)} }`);
  }
  console.log('');
}

// [1] owner schema 三值 leaf 位；[2] YPlainArray<{x:number}> 内 object Infinity；
// [3] YPlainArray<number> 内 -Infinity；[4] encodeStateAsUpdate/applyUpdate 跨端；
// [5] 有限 number 正向对照。（全文逻辑与 §2 输出一一对应，完整源码见 git 外 scratch，已删）
```

运行方式注记：脚本置于 worktree `.mabf-bg/`（git 忽略 scratch 区）+ 临时 `node_modules` 符号链接（→ `packages/doc-runtime/node_modules`，解析 yjs / @nomicore/vfsl，pnpm 严格布局所需），tsx 驱动——`.js` 导入符由 tsx 重写到 `.ts` 源。两件临时产物均已清理。

## 附录 B：现场清理确认

- `.mabf-bg/sa5-repro-nonfinite.ts` 与 `.mabf-bg/node_modules` 符号链接：已删除；
- `git status`：无 src/test/package.json 改动（仅本报告新增于 `wiki/raw/`，及总控自有文件）；
- 未运行任何写操作的 git 命令（无 commit / push / stash）。
