# SA2 攻击评审报告 — namespace-runtime 单 write sequencer 与 validated ROOT write（issue #90）

**Date**: 2026-08-24
**Verdict**: **reject**（攻击点 #1 为阻断性缺陷：按 D9 实现则 SA6 冻结测试在 typecheck 通道必红，AC10 不可达；攻击点 #2 违反 ADR-0008 snapshotter 拒绝条款。需 SA1 修订设计后重新评审）
**被审对象**: `wiki/raw/task_namespace-runtime-write-sequencer_design.md`（R1 初版，769 行，全读）
**审查方式**: 全新视角独立攻击。已通读任务简报、SA8 相关决议（含 7 条追加决策点）、SA8 设计复审冲突报告、SA6 两冻结测试全文（776+180 行）、#89 五冻结测试中的公共面守卫测试、namespace-runtime 全部 src、doc-runtime mutation.ts/fatal.ts/detached-build.ts 关键段、persistence lifecycle.ts/testing.ts 关键段、vitest/tsconfig 配置，并用仓库实际 tsc（5.9.3，repo 等效 flags）做了可赋值性复现实验。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| 1 | **CRITICAL** | D9/§7.2 公共类型契约 × SA6 冻结测试编译 | **D9 的 `MutateRootResult` 使冻结的 `runtime-mutate-root-persistence.test.ts` 编译失败（TS2430），AC10 的「全量 typecheck/test 绿」不可达。** persistence 冻结测试（第 44–46 行）本地重声明为 `interface MutateRootRuntime extends NamespaceRuntime { mutateRoot: (mutation: unknown) => Promise<{ ok: true } \| { ok: false; issues: unknown[] }> }`。SA3 按设计给基接口加上 `mutateRoot: (mutation: unknown) => Promise<MutateRootResult>`（issues 为 `RootMutationIssue[]`）后，`unknown[]` 不可赋值给 `RootMutationIssue[]` → 接口扩展不兼容。**实测复现**（仓库 `node_modules/.bin/tsc`，repo 等效 flags `--strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess`）：`error TS2430: Interface 'PersMutateRootRuntime' incorrectly extends interface 'NamespaceRuntime' … Type 'unknown[]' is not assignable to type 'RootMutationIssue[]'`。该文件在 `tsconfig.typecheck.json` include 内（`packages/*/test/**/*.ts`），`pnpm test` 的 typecheck 阶段会编译它——这正是简报红灯证据中 2 处 TS2353（seam 字面量）报错的同一通道（本评审已实跑 `tsc -p tsconfig.typecheck.json` 复现那 2 处报错，证明 .test.ts 错误确实进入该程序）。sequencer 测试的本地孪生（`issues: MutationIssue[]`，与 `RootMutationIssue` 结构同一）则编译通过——**§7.2 声称「设计期已核对的硬约束」只核对了 sequencer 一个文件，漏了 persistence 文件的更宽形状**。SA6 测试冻结不可改（§1.3/文件清单 `[SA6 owned]`），故唯一出路是修订公共类型 | D9 修订：`MutateRootResult` 的 ok:false 分支放宽为 `{ ok: false; issues: unknown[] }`（或证明两冻结文件本地孪生均可编译的等价形状）；`RootMutationIssue` 名目保留导出，作为元素形状的文档类型与构造侧纪律（实现内部构造 issue 时仍按 `{message, path}` 产出）。同步修订 §7.2：对**全部** SA6 冻结文件逐文件给出类型核对结论（不只是 sequencer），并把「实现后 `tsc -p tsconfig.typecheck.json --noEmit` 零错」列为显式验收门 |
| 2 | **CRITICAL** | D3 受控 snapshotter — 数组分支拒绝清单缺口 | **ADR-0008 原文（docs/adr/0008…md 第 43 行）：「snapshotter 只接受 primitive、finite number、null、plain object/array，拒绝 accessor、class instance、特殊对象、symbol key、循环引用及其他非 plain data」——拒绝清单无对象/数组限定。设计的数组分支（D3 copyFrozen `Array.isArray(v)` 支）缺三项检查**：(a) **symbol own 键**——只在对象分支查 `getOwnPropertySymbols`，数组分支无；symbol 键不进 `Object.keys`，故 `Object.keys(v).length !== v.length` 检测不到，**被静默丢弃而非拒绝**；(b) **非枚举 own 字符串键**——对象分支有 `names.length !== keys.length` 检查，数组分支无（`Object.keys` 只含可枚举键）；同样静默丢弃；(c) **accessor 下标属性**——对象分支对每个可枚举键查 descriptor 的 get/set，数组分支完全不查：`Object.defineProperty(arr, 0, {get(){…}, enumerable:true})` 的 `0 in arr` 为真、`arr[0]` 调用 getter，**输入侧代码在 S3 被执行而 ADR 明令拒绝该输入**。后果评估（诚实定级依据）：快照产物是 `new Array` + 下标赋值的全新普通数组，故不产生「校验值≠提交值」的 TOCTOU；实际危害是 **快照与输入静默分歧（调用方数组携带的 symbol/非枚举键被无声丢弃、写却返回 ok:true）** 与 **getter 执行**——这恰是「把应拒绝的输入缺陷静默处理成照常成功」的虚假降级近亲，同时违反设计自己在 §1.1 声称逐类兑现的 ADR 拒绝清单与 SA8 追加决策点 4 注册的拒绝细则（「symbol key」「非枚举 own 键」「数组非索引 own 键」——后者也只覆盖可枚举面）。对象分支无此缺口（proto/symbol/非枚举/accessor 四查齐全） | D3 数组分支增补：① `Object.getOwnPropertySymbols(v).length > 0 → throw`；② 非枚举 own 键检测——注意 `getOwnPropertyNames` 对数组含 `'length'`，需 `names.filter(k => k !== 'length').length !== Object.keys(v).length → throw`；③ 下标 descriptor 检查——对每个索引取 `Object.getOwnPropertyDescriptor(v, String(i))`，`get !== undefined \|\| set !== undefined → throw 'accessor 下标'`（或等效的整表 descriptor 扫描）。同步更新 §6.2 #11 拒绝清单与 §1.1 映射表措辞，使「逐类拒绝规则」与实现伪代码一致 |
| 3 | HIGH | §7.2 类型核对方法论 | 「设计期已核对的硬约束」一节只核对了 sequencer 测试文件的本地 `MutateRootRuntime` 孪生与 seam 字面量，未对 persistence 测试文件做同样核对——这是攻击点 #1 的根因。typecheck 通道 B 编译**全部** `packages/*/test/**/*.ts`（设计 §12 #7 自证），任何冻结文件里的 extends 重声明、直接字面量都是硬约束面 | 修订时逐文件列出：每个 SA6 冻结文件中所有「以 src 类型为约束的声明」（extends 重声明、seam 直接字面量、动态取成员 cast）及其可赋值性结论；SA4 复核命令补一条 `tsc -p tsconfig.typecheck.json --noEmit` 全绿门 |
| 4 | MEDIUM | D5.1/D8' 导出源自相矛盾 | `RuntimeWriteFatalPhase` 的声明位置：D5.1 代码块标注「// errors.ts（新增）」且 §3/§11 ALLOW LIST 把「`RuntimeWriteFatalError` 类 + `RuntimeWriteFatalPhase` 类型」都放在 errors.ts；D8' 却写 `export type { RootMutationIssue, MutateRootResult, RuntimeWriteFatalPhase } from './write.js'`。SA3 直译会在 write.ts/errors.ts 之间二选一时产生分歧，且 re-export 与声明分离是无谓的间接层 | 统一：类型声明与值导出同源（建议 `RuntimeWriteFatalError` + `RuntimeWriteFatalPhase` 都在 errors.ts 声明并从 errors.ts 导出；write.ts 只承载结果联合类型）。纯一致性问题，不涉语义 |
| 5 | LOW | §6.2 #8 覆盖面 | 「notifier 永久挂住 → 槽永不释放」只描述了 S6 成功路径；**fatal 路径的 best-effort notifier 挂住**（D5.3 ② `await env.notifyDirty?.()`）同样使 fatal rejection 永不送达调用方、已排队写永不取槽。缓解已在设计中：`markWriteFatal` 同步先行（① 先于 ②），`status.fatal` 立即可观测，与 R4「停滞是持久层存活信号」哲学一致——但该窗口未在边界清单中点名 | §6.2 #8 措辞扩展为「S6 与 fatal best-effort 两处 notifier await 共用同一停滞语义」；补一条观察性测试构想（见红线测试思路 #5），不改行为 |

**未列入清单但已攻击且通过的面试点**（供 SA4/SA7 复用，避免重复劳动）：

- **槽序与 ADR-0008 逐位对应**：S1–S7 与「lifecycle/fatal gate → writable gate → 输入快照 → 领域校验与 detached 构造 → 一次 Yjs transaction → await notifyDirty() → 释放」无重排无遗漏；notifier 绑定检查为 SA8 已裁决的增补（relevant_decisions 追加节 1）。
- **preparing∧无fatal 的结构不可达性**：核实 `p0.ts` runP0 整体 try/catch（p0Gate reject、compile throw、投影杂散异常全部收敛 fatal，`schemaState` 保持 preparing）——任何写槽必在 P0 settle 后启动，D4 的 loud fatal 分支确为防御位而非可达路径。
- **fatal 分类表与 doc-runtime 源码逐行对账**：E202 裸 Error（tx-guard 在一切 catch 之外，mutation.ts:73）→ unknown-pipeline-throw 保守 committed:true；E203 transactGuarded 无条件包装 committed:true（fatal.ts:63-77）；E204 DerivedInvariantError → committed:false branded throw（mutation.ts:169-181）；E205 类 B ok:false——设计 D5.2 表与源码事实一致。`sa7-fatal-dynamic-verify.test.ts` 确有「observer 抛错 → committed:true + 写入已落盘」实证（§12 #2 引用属实）。
- **notifier 预算 ≤1、markWriteFatal 先行、状态闭环**：D5.3 ①mark → ②best-effort → ③throw 的次序保证 status.fatal 先于 rejection 可观测；S6 notify-dirty-failed 分支同样先 mark 再 throw。
- **status.ts 零改动兼容性**：`rootWrite/schemaWrite = fatal===null && …` 天然覆盖写 fatal；SA6 两 fatal 用例的六键断言（fatal 非 null、无 stack/cause 键、写位全关、read true）与现状公式吻合。
- **冻结不外泄链**：`copyJsonDomain` 对 plain array/object 构造全新容器 + defineProperty（detached-build.ts:185-213，§12 #6 引用属实）——冻结快照值不会以冻结形态进入 doc 存储/读取面/持久化编码。
- **saveDoc degraded 不拒**：lifecycle.ts 注释与逻辑核实（§12 #4 属实）；testing.ts `expect(handle.doc).toBe(doc)` 属实（§12 #5）。
- **gate 段零输入访问的可实现性**：thunk `() => runRootWriteSlot(writeEnv, mutation)` 纯调用、mutation 仅被捕获；S1/S2 拒绝路径无任何属性读取——Proxy 探针（get/ownKeys/getOwnPropertyDescriptor/has）零触发可达。
- **版本 bump 目标**：namespace-runtime 现 0.1.0、doc-runtime 现 0.1.7——设计的 0.1.1/0.1.8 正确。
- **caller 审计**：`git grep createNamespaceRuntime\b` 仅定义+注释+缺席断言；`enqueue` 唯一既有调用点 runtime.ts:102——§13 属实。
- **enqueue 泛化零回归**：`void ∈ T` 签名放宽，链尾恒绿接线保持，P0 用法零变化。
- **#89 冻结测试兼容**：公共面守卫测试无「恰七键」键数断言（已读全文核实），第八键增广不破绿；禁键名单（doc/handle/yDoc/sequencer/persistence）与 mutateRoot 无冲突。

---

## 协议假设依据审查

**结论：章节存在（§12，10 条）、依据具体可验证、无「应该/通常/预计」类无据推断——但 §7.2 的姊妹声称（「设计期已核对的硬约束」）存在覆盖缺口（攻击点 #1/#3），故本节判定为「依据合格、核对不完备」。**

- 章节存在性：✓（§12 共 10 条，每条给出依据类型 + 具体引用）。
- 依据可验证性抽查（本评审逐条实跑/实读）：
  - #2（E203 committed:true 可达性）：`sa7-fatal-dynamic-verify.test.ts` 确有 observer 抛错 → committed:true + 写入落盘断言；`fatal.ts:63-77` transactGuarded 源码属实。✓
  - #4（saveDoc degraded 仍 resolve）：`persistence/src/lifecycle.ts` saveDoc 实现与注释逐字核实。✓
  - #5（handle.doc 同一实例）：`testing.ts` `expect(handle.doc).toBe(doc)` 属实。✓
  - #6（copyJsonDomain 全新容器）：`detached-build.ts:172-218` 核实（设计引 185-212，为该函数数组/对象分支，实质相符）。✓
  - #7（通道 B 编译 .test.ts）：本评审实跑 `tsc -p tsconfig.typecheck.json --noEmit`，复现出 persistence:95 与 sequencer:468 两处 TS2353——与简报「2 处 notifyDirty does not exist」完全一致，证明该通道确以 .test.ts 字面量为硬约束。✓（也正是这条通道使攻击点 #1 成立。）
  - #10（enqueue 泛化零变化）：sequencer.ts 现源码 `this.tail.then(run, run)` + `settled.then(noop, noop)` 与设计 D7 一致。✓
- 「实测验证」类依据均附命令/输出可重跑路径（简报红灯证据 + §12 #7）；SA4 可按 §13 的四条 grep 命令与上述 tsc 命令复核。
- 缺口：§7.2 声称已核对测试字面量可赋值性，实际只覆盖 sequencer 文件——persistence 文件的 `issues: unknown[]` 孪生未被核对，且该缺口直接产生 CRITICAL 后果。依据审查整体合格，但**核对声明本身被证伪一处**。

## 错误处理链路审查

- **静默失败**：未发现。`mutateRoot` 三态结算完备（ok:true / ok:false+issues / Promise rejection），任何 gate、快照、管线、notifier 失败都有明确出口；P0 结果被 `void` 丢弃但 P0 永不 reject（INV-N12 结构事实）。攻击点 #2 是唯一「静默」型缺陷（数组 symbol/非枚举键被无声丢弃、写返回 ok:true）——归入虚假降级近亲处理。
- **状态闭环**：✓。两条 fatal 路径（D5.3 rejectWithWriteFatal 与 D2 S6 notify-dirty-failed）均先 `markWriteFatal`（state.fatal 冻结摘要 + fatalCause）再 reject；SA6 断言的 status.fatal 非 null、无 stack/cause 键与 markWriteFatal 产物形状吻合。写 fatal 后 schemaState 不迁移，status 投影零改动即正确。
- **降级路径**：✓。persistence-degraded gate 瞬时观察（S2），检查后降级不撤销已提交事务、S6 照常登记（ADR-0006 #79 语义，saveDoc 源码核实）；released/disposed handle 同被 S2 拦截；notifier 未绑定走 D6.4 loud gate（RUNTIME_WRITE_DISABLED + 构造方义务 message）。
- **虚假降级识别**：设计自身立法质量高——D6.4 明确否决「缺省 no-op notifier」（会静默击穿完成信号语义）、D4 把 preparing∧无fatal 定为 loud internal fatal 而非降级。**但攻击点 #2 构成一处漏网的虚假降级近亲**：数组携带 symbol 键/非枚举键/accessor 下标属「应拒绝的输入缺陷」（ADR 正面清单外），设计却让其走「照常成功、键静默丢失」路径——按本立法精神应改为响亮拒绝（ok:false + MUTATION_INPUT_NOT_PLAIN_DATA），已按 CRITICAL 定级并给出修订要求。
- **用户可感知性**：每种失败模式（gate 拒绝、快照拒绝、领域校验失败、fatal rejection、degraded）在结果联合或 rejection 中都有稳定码/稳定 phase 可判别；`committed` 字段为上层「不得自动重试非幂等写」提供判别面。✓

## 红线测试思路

> 以下为 SA6/SA4 可直接落地的红灯 IT 编写方向（不要求 SA2 亲写；#1 属于设计修订后的验证门）。

1. **【攻击点 #1】typecheck 通道全绿门（阻断性红灯）**：SA3 实现后运行 `./node_modules/.bin/tsc -p tsconfig.typecheck.json --noEmit`（与 `pnpm test` typecheck 阶段同一程序）——设计现状下该命令必报 `runtime-mutate-root-persistence.test.ts(44): TS2430 Interface 'MutateRootRuntime' incorrectly extends interface 'NamespaceRuntime' … 'unknown[]' is not assignable to 'RootMutationIssue[]'`。修订 D9（issues 放宽为 `unknown[]`）后该命令零错、且两个冻结文件本地孪生同时编译通过，方可放行。附加正锚：sequencer 测试孪生（结构同一形状）在修订前后都应编译通过——防止修订反向破坏。
2. **【攻击点 #2a】数组 symbol own 键**：`const a = [1,2]; a[Symbol('x')] = 9;` 作为 set 的 value → 断言 resolved `ok:false`、issues 含 `MUTATION_INPUT_NOT_PLAIN_DATA`、0 次 update 事件、state 字节不变、0 次 notifier、读取保留。当前设计下该输入会 ok:true（键被静默丢）——即红灯。
3. **【攻击点 #2b】数组非枚举 own 键**：`Object.defineProperty(a, 'meta', {value: 1, enumerable: false})` → 同上断言组。当前设计下静默通过——红灯。
4. **【攻击点 #2c】数组 accessor 下标（零执行断言）**：`let calls = 0; Object.defineProperty(a, 0, {get(){ calls += 1; return 5; }, enumerable: true, configurable: true})` → 断言 ok:false + 稳定码 + **`calls === 0`**（拒绝必须先于对该属性的任何输入侧代码执行）+ 零写入零 notifier。同族补一条：mutation 信封的 `path` 数组携带 symbol 键 → 拒绝（快照器不认识信封形状，但数组纪律必须一致）。
5. **【攻击点 #5】fatal best-effort notifier 挂住窗口**：注入 notifier = 挂住的 deferred；触发 committed:true fatal（ROOT observer throw）→ 断言 `runtime.getStatus().fatal` 非 null **先于** pA 的 settle（markWriteFatal 先行的可观测性）；随后 notifier 永不 resolve → pA 永 pending、新调用 mutateRoot 返回 pending promise（不 throw、不 disabled——因队列停滞而非 gate）——锁定「停滞而非静默跳过」语义，防止未来实现把挂住悄悄降级成 resolve。
6. **【回归护栏】**：既有 SA6 12+2 用例转绿的同时，#89 五冻结测试与 doc-runtime 既有 15 测试文件零改动全绿（`pnpm test` 全量）；doc-runtime 公共面守卫由「不导出」翻转为「存在且函数 + 值导出面恰一个 mutation 入口」（已由 SA6 更新，SA3 不得触碰断言）。

---

## 复核命令存档（SA4 可重跑）

```bash
# 攻击点 #1 复现（当前树 + 模拟 SA3 后类型）：
#   见本评审报告正文；最小复现为 persistence.test.ts:44-46 孪生 extends 设计 D9 类型，
#   仓库 tsc 5.9.3 + repo flags → TS2430。
./node_modules/.bin/tsc -p tsconfig.typecheck.json --noEmit   # 现状：4 错（2×TS2305 + 2×TS2353，与简报红灯证据一致）
git grep -n "createNamespaceRuntime\b" -- 'packages/**/*.ts'  # 仅定义+注释+缺席断言
grep -n '"version"' packages/namespace-runtime/package.json packages/doc-runtime/package.json  # 0.1.0 / 0.1.7
grep -n "snapshotter\|symbol key" docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md  # L43 拒绝条款原文

# 攻击点 #2 复现（node 直接验证设计数组分支唯一检测的盲区；输出实测）：
node -e '
const a1=[1,2]; a1[Symbol("x")]=9;
const a2=[1,2]; Object.defineProperty(a2,"meta",{value:1,enumerable:false});
const a3=[1,2]; let calls=0;
Object.defineProperty(a3,0,{get(){calls++;return 5},enumerable:true,configurable:true});
for (const [n,v] of [["symbol-key",a1],["non-enumerable",a2],["accessor-index",a3]])
  console.log(n, "keys=",Object.keys(v).length, "len=",v.length,
    "设计检测(keys!==len)=",Object.keys(v).length!==v.length,
    "symbols=",Object.getOwnPropertySymbols(v).length);
console.log("getter calls=",calls,"0 in a3=",0 in a3,"a3[0]=",a3[0]);'
# 实测输出：三例 设计检测均为 false（不触发拒绝）；symbols=1 仅第一例可见；
#           accessor: 0 in a3 = true, a3[0] 调用 getter 返回 5 → 全部绕过设计数组分支
```

## 裁决

**reject。** 设计的整体骨架（槽序、fatal 诚实分类、notifier 屏障、sequencer 泛化、公共面加法演进、错误链路闭环）质量高且与 ADR/冻结测试锚点对账基本严密；但攻击点 #1 是可实证的阻断缺陷（SA3 按图施工必然在 typecheck 通道翻车，AC10 不可达），攻击点 #2 违反 ADR-0008 snapshotter 拒绝条款并构成静默分歧。要求 SA1：

1. 修订 D9/§7.2（issues 形状放宽至两冻结孪生均可编译，并逐文件补齐类型核对结论）；
2. 修订 D3 数组分支（symbol 键、非枚举 own 键、accessor 下标三项拒绝 + `length` 排除细节）；
3. 顺手解决 #4 导出源一致性、#5 文档覆盖。

修订后交回本 SA2 重新评审；本报告红灯测试思路 #1–#4 为复审必查项。

---

# SA2 攻击评审报告 — R2 复审（Phase 2 第二轮）

**Date**: 2026-08-24
**Verdict**: **pass**（R1 全部 5 个攻击点修订落实且经本 SA2 独立复验；红灯测试思路 #1–#4 逐条核验通过。同意放行 SA3 实现）
**被审对象**: `wiki/raw/task_namespace-runtime-write-sequencer_design.md`（R2 修订版，847 行；文末「SA2 反馈逐条回应（R2 修订）」表 + 27 处「R2 修订」差异标注）
**复审方式**: 不采信 SA1「设计期实测」自称——对每条修订用仓库工具链**独立重跑**验证；对未标注区段做语义偷改排查（确认 D2 槽体/D4/D5.2–D5.4/D6–D8/§6.1/§6.3 与 R1 语义一致，无借修订之名夹带变更）。

## R1 攻击点 → R2 修订核验表

| R1 # | 修订声称位置 | 独立复验（命令 + 结果） | 结论 |
|---|---|---|---|
| **#1 CRITICAL**（TS2430 阻断） | D9 重写：`MutateRootResult = { ok: true } \| { ok: false; issues: unknown[] }`；`RootMutationIssue` 保留为构造侧纪律/文档名目；§7.2 重写；§9 AC10/§13 增 tsc 全绿门；§10 R9 新增放宽风险登记 | 双向 tsc 复验（仓库 node_modules/.bin/tsc 5.9.3，repo 等效 flags `--strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --target es2022 --module esnext --moduleResolution bundler`）：**probe-r2**（R2 形状 + sequencer 孪生 `issues: MutationIssue[]` + persistence 孪生 `issues: unknown[]` + 生产侧窄类型构造 `{ ok:false, issues: [disabledIssue()] }`）→ **exit=0 零错**；**probe-r1**（对照组，R1 形状 `issues: RootMutationIssue[]`）→ **exit=2 复现 TS2430**（`'unknown[]' is not assignable to type 'RootMutationIssue[]'`）——SA1 双向实测声称属实。放宽方向论证正确（`unknown[] ⊑ T[]` 仅当 T=unknown；收窄单向、生产构造不变）；「窄」的语义落点（ROOT 与 SCHEMA 各自独立联合）不因元素类型放宽而丢失 | ✅ 落实 |
| **#2 CRITICAL**（数组分支拒绝缺口） | D3 数组分支整段重写：① `getOwnPropertySymbols>0` 拒；② `getOwnPropertyNames` 过滤 `'length'` 后与 `Object.keys` 比对拒非枚举（含非枚举下标）；③ **descriptor 全表扫描先于任何值读取**（`d===undefined` 拒空洞/原型链污染、get/set 拒 accessor）；④ keys-vs-length 拒可枚举非索引键；§6.2 #11 同步；`path` 数组同分支免费覆盖 | 忠实仿真 R2 ①②③④⑤ 序的 node 实测（9 例）：**R1 三盲区全数拒绝**——数组+symbol 键 → 「数组携带 symbol 键」；数组+非枚举 'meta' 键 → 「数组携带非枚举 own 键」；数组+accessor 下标 → 「accessor 下标（index 0）」且 **getter 调用数 = 0**（descriptor-先于值读取次序保证成立，红灯 #4 断言兑现）；补充族亦正确——非枚举下标拒（②）、可枚举非索引键拒（④）、稀疏空洞拒（③ `d===undefined`）；**正例零误伤**——密集数组/空数组/嵌套密集数组全部接受。`Object.defineProperty(a,'length',{get})` → `TypeError: Cannot redefine property: length`（§12 #11(c) 声称属实，length accessor 异形结构性不存在）。与对象分支四查纪律对齐完成 | ✅ 落实 |
| **#3 HIGH**（§7.2 方法论） | §7.2 重写为逐文件核对表（两 #90 测试文件 + doc-runtime 两守卫文件 + #89 五冻结文件），每行列 src 约束点/冻结侧形状行号/可赋值性结论；新增显式验收门 `./node_modules/.bin/tsc -p tsconfig.typecheck.json --noEmit` 零错（§9 AC10 行 + §13 SA4 复核命令） | 表格 5 行逐行核对：行号引用抽查属实（sequencer 孪生 :70-81、persistence 孪生 :44-46、seam 字面量 :466-471/:92-96、p0-sequencer 双 cast :124-131 实读核实——`const injected: unknown = {...}; return injected as CompileSchemaEnvelopeResult`，确不经 src 类型约束）；tsc 全绿门已嵌入 §9 AC10 与 §13 SA4 命令块；「sequencer 孪生修订前后都必须编译」反向锚已写入 §7.2 | ✅ 落实 |
| **#4 MEDIUM**（导出源矛盾） | D5.1 注释「类与 phase 类型均落 errors.ts」；D8' `export type { RuntimeWriteFatalPhase } from './errors.js'`；§3 模块树/§11 ALLOW LIST（errors.ts/index.ts/write.ts 条目）同步；write.ts `import { RuntimeWriteFatalError }` + type-only import phase（verbatimModuleSyntax 纪律） | 三处（D5.1/D8'/§11）交叉读一致：声明地=导出地=errors.ts，write.ts 只承载结果联合类型并消费 import；re-export 间接层消除。R1 的二选一分歧不复存在 | ✅ 落实 |
| **#5 LOW**（fatal 路径停滞覆盖） | §6.2 #8 扩展为「两处 notifier await 共用同一停滞语义」：(a) S6 成功路径 + (b) fatal best-effort 路径；点名 markWriteFatal 先行使 status.fatal 挂住窗口内可观测；援引 SA2 红灯构想 #5 | §6.2 #8 原文复读确认：两路径 + 可观测性缓解 + 停滞哲学（无 timeout/无取消）齐备，措辞与 D5.3 ①② 次序一致。行为零变化（纯覆盖扩展），符合 R1 要求 | ✅ 落实 |

## 语义偷改排查（R2 差异面之外的稳定性）

- 27 处「R2 修订」标注全部定位并读取；**未标注区段**（D1/D2 槽体 S1–S7、D4、D5.2–D5.4、D6、D7、D8、§5 伪代码主体、§6.1 时间线、§6.2 #1–#7/#9–#10/#12–#25、§6.3、§8、§10 R1–R8、§12 #1–#10、§13 主体）经行号偏移对照与 R1 评审记忆复核：语义零变更——槽序、fatal 分类表、notifier 预算、sequencer 泛化、公共面八键、版本 bump 目标均保持 R1 已通过审查的形态。
- §1.1 映射表两行（snapshotter/D9）随修订同步更新，与 D3/D9 新文本一致。

## R2 复审新增备注（不阻塞 verdict）

| # | 级别 | 备注 | 建议 |
|---|------|------|------|
| N1 | LOW | R2 新增的数组分支拒绝行为（symbol 键/非枚举键/accessor 下标/空洞）**无冻结测试锚定**（SA6 冻结两文件只覆盖对象分支拒绝族），且 §11 ALLOW LIST 未显式允许 SA3 新增非冻结测试文件——严格读下「ALLOW LIST 排他」使红灯 #2–#4 的 IT 落地无归属。行为契约已由设计伪代码 + §6.2 #11 + §12 #11 实测锚定，SA4 可对照验证，故不阻塞 | 建议（SA1 或总控一句话即可，无需再走 SA2）：§11 ALLOW LIST 增补「可新增 `packages/namespace-runtime/test/runtime-mutate-root-snapshotter-array.test.ts`（非冻结，承载 SA2 红灯 #2–#4：三盲区拒绝 + `calls === 0` + 正例不误伤）」；或显式注明该验证归 SA4 以独立脚本执行。目的：把 R2 修订的拒绝语义从「设计文本 + 一次性实测」升级为「可回归的自动化锚」 |
| N2 | 观察 | D3 ③ 循环边界 `v.length` 对 Proxy 输入走 get trap——「descriptor 全表扫描先于任何值读取」的精确含义是「accessor 检查先于目标属性 getter 执行」（已实测 `calls === 0` 兑现）；Proxy trap 自身的执行属一切快照不可避免的读取面，其抛错路径已由 §6.2 #12 收编。设计注释（「Proxy 侧走 getOwnPropertyDescriptor trap 而非 get trap」指 descriptor 检查本身）表述正确，无需修订 | 无动作（SA4/SA7 验证时按此精确语义对照即可） |

## 复审结论

**pass。**

- R1 两个 CRITICAL 均以「修订 + 独立可复现实证」收口：#1 的类型形状经双向 tsc 复验（R2 零错 / R1 复现 TS2430）；#2 的数组分支经 9 例仿真复验（三盲区全拒、getter 零执行、正例零误伤、length 无逃逸面）。
- #3/#4/#5 逐条核验落实；未标注区段无语义偷改。
- 复审独立验证证据（SA4/SA7 可重跑）：
  ```bash
  # 红灯 #1（R2 形状两孪生零错 / R1 形状复现 TS2430）：
  #   仓库 tsc 5.9.3 + repo flags，probe-r2 exit=0 / probe-r1 exit=2（本报告 R2 节表格）
  # 红灯 #2–#4（数组分支四查）：
  #   node 仿真 R2 ①②③④⑤ 序：三盲区拒绝、accessor getter 调用 0、密集/空/嵌套数组接受、
  #   非枚举下标/可枚举非索引键/稀疏空洞各得其所拒绝、length 重定义 TypeError
  ./node_modules/.bin/tsc -p tsconfig.typecheck.json --noEmit   # SA3 实现后必须零错（§7.2 显式门）
  ```
- SA3 实现期间的复审触发条件（保持 R1 立场）：若实现偏离 D3 ①–⑤ 检查次序（尤其 descriptor-先于值读取）或 D9 公共联合形状，属设计违约，SA4/SA7 应拒收。
- 备注 N1 建议随 SA3 派单一并处理（一句话级），不构成再次评审的必要条件。

R1 报告（上节）的全部内容作为历史记录保留；R2 版设计文档是 SA3 实现的唯一蓝本。
