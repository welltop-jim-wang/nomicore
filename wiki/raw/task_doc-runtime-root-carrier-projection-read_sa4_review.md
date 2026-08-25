# SA4 静态验尸报告 — doc-runtime：schema-independent ROOT 载体投影读取（issue #86）

**Date**: 2026-08-23（R1）；2026-08-23（R2 复审）；2026-08-23（R3 复审，见文末「R3 复审」节）
**Reviewer**: SA4（Red Team / 静态验尸）
**被审对象**: R1 = commit `51621caf`（read.ts 重写 + index.ts JSDoc + guards 测试 + 7 遗留测试删除 + package.json 0.1.5→0.1.6）；R2 = commit `5c5668f`（F1 修复）+ 设计 R4 版（F2 处置）；R3 = commit `4014a8d`（R2-F1a 修复）+ 设计 R5 版（两项勘误）
**设计基准**: `wiki/raw/task_doc-runtime-root-carrier-projection-read_design.md`（R1 轮 = R3 定稿；R2 复审轮 = R4 版；R3 复审轮 = R5 版）
**Verdict**: R1 = **reject**（F1 错误通道外抛 ×3 向量 + F2 package.json DENY 违例）→ R2 = **reject**（F1/F2 核销；新代码攻击发现 R2-F1a safeDetail 残余洞）→ R3 = **pass**（R2-F1a 一行收窄核销、NEW1/NEW2 收编、回归面零、设计 R5 勘误落地、919 例全绿；错误通道已无内层 try 之外的不可信转换。**当前生效裁决以文末「R3 复审」节为准**）

---

## 审核结论总览

| # | 维度 | 结论 |
|---|---|---|
| 1 | 设计一致性（§1.1 范围 + §1.2 偏离） | ⚠️ 两处偏离：**F2（package.json 落 DENY LIST，reject 项）**、D3（isPlainRecord 判据偏离——**必要且安全，已验证接受**，建议 SA1 补设计勘误） |
| 2 | 读写路径一致性 | ✅ 纯只读单数据源（live Y.Doc），probeRoot 唯一 doc 入口，零订阅零写入（guards 零副作用锚实测 update=0） |
| 3 | 静默失败 | ✅ 无静默失败路径（detached 静默空投影家族已被 INV-R13 双入口守卫封死）；但发现**反向问题：错误通道自身可被击穿外抛（F1，reject 项）** |
| 4 | 降级方案 | ✅ 无伪降级（ROOT 缺席惰性创建空 map 为 ADR-0008 立法正常态；无任何 fallback） |
| 5 | 极端条件攻击 | ❌ **F1：三条可复现外抛向量击穿「同步、不抛错」（INV-R1/E22）**；其余攻击面（-0/2^53/NaN±∞/野段/`__proto__`/循环引用/深原型链/敌意非数组 path/symbol 抛出物）全部安全 |
| 6 | 错误处理链路 | ❌ 缺口即 F1：catch 块与 notAllowed 的 path 拷贝对敌意输入无二次异常防护 |
| 7 | 架构评估 | ✅ 可行（载体驱动重写干净落地，零 workaround、零 FIXME，无需退回 SA1） |
| 8 | 过度设计 | ✅ 精简（418 行覆盖 11 载体类 + 双递归，无多余抽象；isPlainRecord 深度上限为合理保守守卫） |

**门禁自检**：§1.3 E2E spec（无 .spec.ts，N/A）／§1.4 vitest 触发性 ✅（`vitest.config.ts` include `packages/*/test/**/*.test.ts` 覆盖 guards+冻结行为测试，typecheck include 覆盖 test-d；`ci.yml` node 20/24 矩阵跑 `pnpm typecheck`+`pnpm test`，doc-runtime tsconfig 在 typecheck 脚本内）／§1.5 协议假设（§8 全部实测且 SA2 三轮独立复现，本轮抽核 yjs 行为一致）／§1.6 契约连锁 ✅（签名 3→2 参：生产 caller 实测为零，残留即 TS2554 硬红；无 return↔throw/async 迁移）／§1.7 源码 grep 断言禁令 ✅（三个新增测试文件 readFileSync 计数 0，全部锚定运行时行为）／§1.1 BLACKLIST ✅（无 lockfile/.bak/TASK.md 类文件）。

---

## F1（must-fix，reject）— 错误通道构造无二次异常防护：三条外抛向量击穿「同步、不抛错」

**契约依据**：冻结契约 1「同步、不抛错」；INV-R1「全函数顶层 try/catch 收编一切异常」；E22/Proxy 划界「trap throw 由顶层崩溃边界 E100 结构化收编（**不外抛**）」；设计 §6.2 guards Proxy 锚明文断言「结构化返回、不外抛」。

**漏洞机理**：顶层 catch 与 `notAllowed` 的失败结果构造自身执行了不可信代码/不可信转换，且不在任何内层保护内——

| 向量 | 击穿点（read.ts 行号） | 触发条件 |
|---|---|---|
| **P1 敌意 toString** | L129-130 `err instanceof Error ? err.message : String(err)` | Proxy trap 抛出**非 Error 对象且其 `toString()` 再抛** → catch 块内二次抛 → 外泄 |
| **P9 敌意 message getter** | 同上 `err.message` 属性读 | trap 抛出 Error 子类，`message` 为 throwing getter → 同上 |
| **P10 敌意 path 迭代器** | L142 `Array.isArray(path) ? [...path] : []` | path 为 Proxy 包装数组（`Array.isArray` → true 过 G0），`Symbol.iterator` get trap 抛出 → **任一失败路径的 notAllowed 拷贝** 二次抛 → 经顶层 catch 再入 notAllowed 再抛 → 外泄 |

三条向量均经公共 API 可达：guards 自己的 Proxy 锚证明了「敌意 Proxy 可经 `root.set('p', trap)` 置入 doc」（该锚只测了 trap 抛 plain Error 的情形，故现行测试全绿——**绿灯掩盖了通道缺口**，这正是「不能用静态推断替代证据」的反向案例：此处是测试覆盖给了虚假安全感）。

**可复现证据**（worktree 内实测，2026-08-23，`pnpm exec tsx` + yjs 13.6.32 / Node 24.13.0）：

```ts
// P1：非 Error + 敌意 toString
const evil = { toString() { throw new Error('toString boom'); } };
const doc = new Y.Doc();
doc.getMap('ROOT').set('p', new Proxy({ a: 1 }, { ownKeys() { throw evil; } }));
readLogicalValueAtPath(doc, ['p']);   // → 未捕获抛出 "toString boom"（期望：ok:false 结构化返回）

// P9：Error 子类 + 敌意 message getter
class EvilErr extends Error { get message() { throw new Error('message-getter boom'); } }
// ownKeys trap 抛 new EvilErr() → 未捕获抛出 "message-getter boom"

// P10：Proxy 包装数组 path（敌意 Symbol.iterator）
const evilPath = new Proxy(['title','x'], { get(t,k,r){ if (k===Symbol.iterator) throw new Error('iterator boom'); return Reflect.get(t,k,r); } });
readLogicalValueAtPath(doc2, evilPath);  // → 未捕获抛出 "iterator boom"
```

实测输出（三向量均为 `THREW OUT`，非结构化返回）：
```
P1 hostile-toString: THREW OUT → toString boom
P9 hostile-message-getter: THREW OUT → message-getter boom
P10 hostile-path-iterator: THREW OUT → iterator boom
```

**对照（未被击穿的邻路径，证明漏洞是构造层而非兜底层）**：trap 抛 plain `Error` → 结构化 ok:false ✓（guards 锚绿）；trap 抛 `Symbol` → `String(Symbol)` 不抛 → 结构化 ✓（本轮实测 P7）；非数组敌意 path 对象 → G0 直接归一 ✓（本轮实测 P8，path=[]）。

**影响**：调用方按契约可裸调（无 try/catch）的高频读取 API（ADR-0008 定位「schema 准备完成前即可高频读取」）在敌意数据面前变成 throw 点；上游若以 PR #251 类 unhandledRejection→exit 兜底，则升级为进程级风险。严重度：MEDIUM-HIGH（可达性=调用方敌意数据，但契约明文承诺不外抛且 guards 已把「不外抛」立为锚）。

**修复方向（SA3，~5 行，不动任何冻结可观测面——正常输入的 message/path 回显逐字节不变）**：
1. `safeDetail(err)`：内层 try/catch 包 `String(err)`/`err.message`，失败回退 `'unstringifiable'`；
2. `safeSpreadPath(path)`：内层 try/catch 包 `[...path]`，失败回退 `[]`（SA4-F2 守卫的自然延伸——它已防「非数组」，需再防「数组但敌意」）。
3. guards 补一条「trap 抛敌意 toString 对象 → 结构化 ok:false 不外抛」锚（与现有 Proxy 锚并列）。
4. 设计侧：§4 伪代码蓝本携带同一缺陷行（`String(detail)`），SA1 应在修订轮同步勘误，防下轮照抄。

**回流目标**：SA3（实现加固 + guards 补锚）；SA1（蓝本行勘误，随 reject 轮或独立小修）。

---

## F2（must-fix，reject）— `packages/doc-runtime/package.json` 落 DENY LIST（scope 门禁硬违规）

**证据**：`git show 51621ca --name-status` 含 `M packages/doc-runtime/package.json`（diff 仅 `"version": "0.1.5" → "0.1.6"`，commit message 自报「package.json patch 0.1.5 → 0.1.6」）。

**违例**：设计 §7 DENY LIST 明文「`packages/doc-runtime/package.json` / `tsconfig.json` — **零改动**（vfsl 依赖保留给 extract/materialize）」。

**实质性评估（如实）**：改动为私有包版本号（`"private": true`，无发布面、无消费方、无 pnpm-lock 连锁——commit 不含 lockfile、全量 install/test 绿），**无行为影响**。但 MABF 立法（§1.1 第四步）对 DENY 命中是硬门禁，不接受「已经测试过了」作为豁免理由。

**处置（二选一）**：
- SA1 修订 design §7：ALLOW LIST 显式增列该文件的 version 字段豁免并注明理由（每任务 patch bump 的仓库惯例，如确为惯例）；或
- SA3 回滚该 bump（`git checkout 51621ca^ -- packages/doc-runtime/package.json` 后并提交）。

**回流目标**：SA1（设计修订）或 SA3（回滚）。

---

## 已核验为忠实的四处关键机制（SA2 R3 交接提示逐项）

| 机制 | 设计锚 | 实现落点 | 核验 |
|---|---|---|---|
| ProjectOutcome 判别联合（禁 null/undefined 哨兵） | D6/R2 #1 | read.ts:289 `type ProjectOutcome = {kind:'value';v} \| {kind:'fail';msg}`；projectValue/copyPlainStrict 全分支走 kind 判别；无一处 `=== null` 失败比较 | ✅ 代码逐行核 + guards null 哨兵碰撞锁（`['nothing']`/`['arr',3]` → ok:true null）绿 |
| detached 前置判别双入口 | D2/R2 #2/INV-R13 | navClassify 前置（read.ts:211-213）+ projectValue 前置（read.ts:305-309），`v.doc === null` O(1) 判别；copyPlainStrict 对嵌 Yjs 一律拒（不问 attached，E7 注记保真） | ✅ guards 三形态并列锚（借道中途/路径耗尽/目标投影）+ 别名集成对照 `['holder2','inner','k']`→1 全绿 |
| G0 E100 前缀 | D8/R2 | read.ts:59-61 `DOCRT-E100: path 必须是段数组…`，与旧 F2 可观测行为一致；F2 全量 11 变体 + 前缀 sub-family 移植完整 | ✅ guards 逐锚绿 |
| defineProperty 四真写入 | D6 尾注/INV-R7 | putKey（read.ts:416-418）`{value,writable:true,enumerable:true,configurable:true}`；对象键三处调用（projectYMap L338 / copyPlainStrict L406）；数组用 push（设计允许） | ✅ 冻结 AC6 不 freeze 锚 + guards `__proto__` 防劫持双锚绿 |

**其余设计保真点**：index.ts 仅 JSDoc 更新、导出符号逐字不变（read.ts:29-30 出口）；read.ts vfsl import 清零（仅 yjs + ./carrier.js）；carrier.ts/extract.ts/materialize.ts/package.json 依赖面零触碰（不在 commit diff）；arbitrateUnion/NavOutcome/memberOutcomes/makeValuesResolver 全仓无残留（grep 零命中）；模块级零可变态零 memo（INV-R10）；D4 吸收/响亮非对称、D5 键空间统一（readableOwnDataValue 导航投影共用，INV-R11）、D10 循环引用 E100 收编、E8/E9 `__proto__` 双向——全部按设计落地并有对应绿锚。

---

## D3 — 申报偏离「D2 原型字面规则 → 原型链级 isPlainRecord」：核验为必要且安全，接受

**偏离内容**：设计 D2 写 `plainObject：proto ∈ {Object.prototype, null}`（字面）；实现改为 isPlainRecord（read.ts:177-192）——沿原型链上溯（上限 32 层），链上每个非 Object.prototype 节点的 own `constructor` descriptor 必须缺失或为 Object/undefined，否则 nonPlainObject。

**必要性（冻结契约优先级的正确裁决）**：冻结 AC3 fixture `protoObj = Object.create(proto)`，其中 `proto = Object.create({inherited:'from-proto'})` 且带 enumerable accessor——三层自定义 plain 中继链，冻结断言 `['protoObj']` → **投影 `{own:'v'}`**（EXPECTED_ROOT 明文）。按 D2 字面规则 protoObj 应判 nonPlainObject → loud → 冻结测试红。SA6 冻结契约「不得收窄」优先于设计文本，SA3 选择改实现不改冻结锚是唯一正确方向。本轮实测复现：`P5 protoObj: {"ok":true,"value":{"own":"v"}}`、原型继承键导航 → ok:true undefined、原型 getter 键导航 → ok:true undefined（零触发）。**SA1/SA2 三轮评审均未发现该设计-冻结矛盾，属设计残留缺陷，由 SA3 实现期捕获**——建议 SA1 补一行设计勘误（非阻塞）。

**安全性（本轮攻击验证）**：
- Date/class 实例 loud（guards Date 锚 + 探针 P4/P6：Date→ok:false；顶层 set Map/Set/RegExp/类实例被 yjs 直接拒绝不可达，嵌套于 plain 容器 → isPlainRecord 拒 → loud ✓）；
- 值读取永不走原型链（readableOwnDataValue 只读 own descriptor，INV-R5 完好）——原型链仅用于分类，descriptor 读零 getter 执行（INV-R4 完好）；
- 导航与投影同一判据（navClassify L232 与 copyPlainStrict L397 同用 isPlainRecord，INV-R11 不分裂）；
- 深度上限 32 → 超深链保守 loud（探针 P2：41 层链 → ok:false，方向安全；唯 message「非 plain 原型对象」对超深 plain 链有轻微误导——message 非契约字段，INFO）；
- 跨 realm 对象 → 对侧 Object.prototype 的 constructor ≠ 本侧 Object → 保守 loud（静态推演，安全方向）。

---

## SA6 冻结契约未收窄：核验

- 计数逐 AC 吻合简报声明：AC1=5、AC2=7、AC3=5、AC4=6、AC5=6、AC6=4（行为 33）+ test-d 4 = 37；实测运行 33+34+4=71 例全绿（guards 34 例为新增独立文件，不属冻结面）。
- **保真度正面证据**：冻结文件保留了与 R3 定稿设计直接矛盾的 protoObj 锚（SA3 若曾收窄冻结面，最自然方向是把该锚改成 loud 以消灭偏离义务——事实上锚原样、实现让步）。
- **溯源限制（如实声明）**：两份冻结文件在 git 中的首次提交即 SA3 的 51621ca（`git log --all` 单提交，无 SA6 原件可比对 byte 级一致性）；本轮以结构性核验替代（逐 AC 计数 + 简报红灯证据细节逐点比对：`['items',-1]` path 回显、TS2554/TS2578 机理、buildDoc 键集、EXPECTED_ROOT 形态——全部与简报 Phase 1 记载吻合）。建议后续任务把 SA6 产物在 Phase 1 末单独 commit，消除该审计盲区。

---

## 验证证据（命令 + 结果）

| 验证 | 命令 | 结果 |
|---|---|---|
| 全量门禁复跑 | `pnpm typecheck && pnpm test`（独立进程模式） | `TYPECHECK_EXIT=0`；`Test Files 61 passed (61)`、`Tests 914 passed (914)`、`Type Errors no errors`、exit 0——与 dispatch 第 10 行总控亲验一致 |
| 本任务三件套 | `pnpm exec vitest run packages/doc-runtime/test/read-logical-value-at-path-{guards,schema-independent}.test.ts packages/doc-runtime/test/read-logical-value-at-path-schema-independent.test-d.ts --typecheck` | `71 passed (71)`（33+34+4），typecheck 无错 |
| F1 三向量 | `/tmp/sa4-probe{,2,3}.ts` 经 `pnpm exec tsx`（探针代码见 F1 节） | P1/P9/P10 均 `THREW OUT`（应结构化返回）；P5/P7/P8 等对照向量行为正确 |
| 范围比对 | `git diff --name-only 51621ca^ 51621ca` | 13 个非 wiki 文件：12 在 ALLOW LIST、1 个 DENY 命中（package.json）；BLACKLIST 清洁 |
| caller 审计 | `git grep -n "readLogicalValueAtPath" -- ':!wiki' ':!node_modules' ':!docs' ':!CONTEXT.md'` | 生产 caller 零（命中仅实现/导出/注释/测试）；`arbitrateUnion\|NavOutcome\|memberOutcomes\|makeValuesResolver` 全仓零残留 |
| CI 触发性 | `cat .github/workflows/ci.yml vitest.config.ts` + root scripts | vitest include/typecheck include 覆盖三个新测试文件；node 20/24 矩阵执行 typecheck+test |

---

## 动态审核重点（交 SA7）

1. **F1 修复后复跑三向量探针**（探针代码见 F1 节，可直接搬入 SA7 报告）：P1 敌意 toString / P9 敌意 message getter / P10 敌意 path 迭代器 → 全部应为 `ok:false` 结构化返回且不外抛；并确认正常输入的 message/path 回显与修复前逐字节一致（回归面零）。
2. **guards 新增敌意抛出物锚**（F1 修复第 3 条）在 CI 真实 run 中被收集执行（`gh run view --log` 摘录 doc-runtime 测试块）。
3. **Node 20/24 双矩阵**：本任务纯同步纯函数，无版本敏感面（静态判定），SA7 摘录两个 node 版本的 run 日志确认。
4. **INFO 级异型载体**：`Object.create(ymapInstance)` 型假载体（plain 对象以 Y.Map 实例为原型 → `instanceof Y.Map` 为 true）嵌 plain 容器时经 ymap 分支别名读真数据——静态推演不抛、投影为深拷贝无泄漏；SA7 可选跑一例确认无 crash。
5. **E16 destroyed doc**：destroy 后读取行为良性（SA2 实测注记），SA7 可选复核。

## 处置指令（总控）

- **SA3**：修 F1（safeDetail/safeSpreadPath + guards 敌意抛出物锚）+ 处置 F2（回滚 bump 或等 SA1 修订）→ 交 SA4 复审（只需复审 read.ts 错误通道构造与 guards 增锚，其余维度本轮已 pass）。
- **SA1**（随轮小修，非阻塞）：①蓝本 catch 行勘误（F1 第 4 条）；②D2 plainObject 行补 isPlainRecord 判据勘误（D3 节）；③（若选设计修订路径）§7 增 package.json version 豁免。
- **流程备忘**：SA6 冻结产物应在其 Phase 1 末独立 commit，否则 SA4 无法做 byte 级防篡改核验（本轮只能结构性核验）。

---
---

# R2 复审（2026-08-23）—— 已被 R3 复审取代（verdict: reject，单点 R2-F1a；R3 已核销）

**被审对象**: commit `5c5668f`（F1 修复：read.ts safeDetail/safeSpreadPath + guards 3 例敌意抛出物锚）+ 设计 R4 版（F2 处置：package.json 移入 ALLOW 仅限 patch bump）
**复审方法**: 逐条核销 F1（探针复跑三向量 + 回归面对比）/ F2（设计 R4 修订内容与实际 diff 字段级比对）→ 对新引入代码（safeDetail/safeSpreadPath/3 新锚）继续攻击 → 独立复跑全量门禁。

## Verdict: **reject**（单点 must-fix：R2-F1a——safeDetail 一行残余洞；F1/F2 全部核销，其余维度不重开）

## R1 攻击点核销表

| R1 # | 核销 | 核销依据（代码 + 本轮探针实测） |
|---|---|---|
| F1 三向量 P1/P9/P10 | ✅（但见 R2-F1a） | read.ts 新增 `safeDetail`（内层 try 包 `instanceof`/`err.message`/`String(err)`，回退 `'unstringifiable'`）与 `safeSpreadPath`（`Array.isArray` 前置 + 内层 try 包 spread，回退 `[]`），catch 块与 notAllowed 全部改走两助手。**探针复跑实测**：P1（敌意 toString）→ `structured ok=false` ✓；P9（敌意 message getter）→ `structured ok=false` ✓；P10（敌意 path 迭代器）→ `structured ok=false`（path 回退 []）✓——三向量零外抛。guards 新增 3 锚与探针同构（P1/P9 断言 `toContain('unstringifiable')`，P10 断言 `path toEqual([])`），断言真实锚定运行时行为 |
| F1 回归面（正常输入逐字节不变） | ✅ | 实测：`['items','0']` → message `第 1 段 0 与 Y.Array 载体不符（期望 非负整数）`、path 回显 `["items","0"]`；G0 `path:[]` + `DOCRT-E100:` 前缀——与 R1 实现的可观测输出一致；冻结 37 例 + guards 34 旧锚全绿（见下门禁证据） |
| F1 修复第 3 条（guards 补锚） | ✅ | 5c5668f guards diff：3 例新锚（P1/P9/P10）全部 `not.toThrow` + `ok:false` 结构化断言 + code/path/message 三面锚定 |
| F2 package.json DENY 违例 | ✅（设计修订路径） | 设计 R4 版：§7 ALLOW LIST 增 `packages/doc-runtime/package.json` 行——「**仅限 patch 版本号 bump**（0.1.5→0.1.6；MABF 硬门禁 #9……依赖与其他字段零改动）」；DENY 行留守 `tsconfig.json` 并注明字段粒度豁免逻辑；§6.1 生产代码表（L437）与 §3 D1（L102）同步；R4 后记记录教训（DENY 行需字段粒度声明豁免，硬门禁 > 设计约束）。**实际 diff 字段级核验**（R1 已取证）：51621ca 中该文件仅 `version` 一行变化，与 R4 豁免范围精确一致，无越权字段。修订理由可追溯（硬门禁 #9 为仓库级强制惯例），豁免范围最小化，tsconfig 未放松——核销 |

**门禁独立复跑**（本轮，前台直跑）：`pnpm typecheck` → exit 0；`pnpm test` → `Test Files 61 passed (61)`、`Tests 917 passed (917)`（914+3 新锚）、`Type Errors no errors`、exit 0——与总控亲验一致。三件套定向：guards 37（34+3）+ 冻结 33 + test-d 4 = 74 例全绿。5c5668f 范围：read.ts + guards + wiki 流水线档案（含本报告 R1 版入库）——全部在 ALLOW/DENY 范围内，无新 scope 违规。

## R2 新引入内容攻击结果

### R2-F1a（must-fix，reject）— safeDetail 未做原始 string 收窄：message 为非 string 数据属性时模板插值 ToString 逃逸

**漏洞机理**：`safeDetail`（read.ts:169-176）声明返回 `string`，但实现 `return err instanceof Error ? err.message : String(err)` 将 `err.message` **原样返回**——TS 类型撒谎（`Error.message: string` 只是类型断言，运行时子类可用 own 数据属性覆写为任意值）。属性读本身不抛（数据属性、非 getter）→ 内层 try 正常完成 → **敌意对象被原样返回** → catch 块的模板插值 `` `DOCRT-E100: … ${safeDetail(err)}` `` 对其做 ToString——该转换发生在 **safeDetail 的内层 try 之外、顶层 catch 之内**（catch 块不再有外层保护）→ 二次抛出外泄，与 R1-F1 同族、同一击穿点。

**两条可复现向量**（worktree 实测，2026-08-23，`pnpm exec tsx` + yjs 13.6.32 / Node 24.13.0；fixture 与 guards P1 锚同构——敌意 Proxy 置入 plain 容器，公共 API 直接可达）：

```ts
// NEW1：message 为「带敌意 toString 的对象」的 own 数据属性
class EvilMsgObj extends Error {
  constructor() { super('x'); (this as any).message = { toString() { throw new Error('message-object boom'); } }; }
}
doc.getMap('ROOT').set('p', new Proxy({ a: 1 }, { ownKeys() { throw new EvilMsgObj(); } }));
readLogicalValueAtPath(doc, ['p']);
// 实测：THREW OUT → message-object boom（期望：ok:false + 'unstringifiable'）

// NEW2：message 为 Symbol 数据属性（ToString(Symbol) 是 TypeError）
class EvilMsgSym extends Error {
  constructor() { super('x'); (this as any).message = Symbol('sym'); }
}
// 实测：THREW OUT → Cannot convert a Symbol value to a string
```

实测输出：
```
R2-NEW1: THREW OUT → message-object boom
R2-NEW2: THREW OUT → Cannot convert a Symbol value to a string
（对照：R2-P1/P9/P10 全部 structured ok=false ✓）
```

**本质**：5c5668f 的修复契约自宣「绝不二次抛（INV-R1）」——该承诺对 NEW1/NEW2 不成立，属修复不完整而非新设计缺陷。

**修复（一行 + 一锚，SA3）**——收窄返回值为原始 string，与同文件 `yjsWord` 已有的 typeof 守卫模式（L186-187 `typeof ctor === 'string' && ctor.length > 0 ? ctor : 'Y.AbstractType'`）完全同构：

```ts
function safeDetail(err: unknown): string {
  try {
    const raw = err instanceof Error ? err.message : String(err);
    return typeof raw === 'string' ? raw : 'unstringifiable'; // NEW1/NEW2：非原始 string 一律回退
  } catch {
    return 'unstringifiable';
  }
}
```

guards 补第四锚：NEW1 形态（message 数据属性 = 敌意 toString 对象）→ `not.toThrow` + `ok:false` + `toContain('unstringifiable')`。

**影响与严重度**：与 R1-F1 同级（MEDIUM-HIGH）——冻结契约 1「同步不抛」经公共 API 敌意数据可破；上游无 try 裸调时升级为未捕获异常。修复后 R1 三锚 + 新锚全部保持绿（fallback 字符串不变）。

### 其余新代码攻击面（未发现新洞）

| 攻击面 | 结果 |
|---|---|
| `safeSpreadPath` 元素路径：path 元素带敌意 toString（`['title', evilObj]`） | ✅ 安全——元素被原样拷贝进回显数组，实现自身从不对 path 元素做 ToString（实测 R2-NEW3：`ok:true value:undefined` 干净吸收，零外抛；元素 stringify 是调用方 `JSON.stringify` 的自身行为） |
| `segMsg` 的 `String(seg)` 抛出（敌意段对象） | ✅ 安全——求值点在导航循环内（顶层 try 之内），抛出经顶层 catch 收编为 E100 结构化返回（R2-F1a 修复后 catch 完全异常安全，本路径同时免疫） |
| `yjsWord` 的 `constructor.name` 读取 | ✅ 已有 typeof 守卫（模式正确——正是 safeDetail 缺的那道） |
| `instanceof` 的 Proxy getPrototypeOf trap 抛出 | ✅ 在 safeDetail try 内（5c5668f commit message 已列，实测 P1 族覆盖） |
| 其余插值点（`c.word`/`r.msg`/`hit.msg`/`probe.carrier`/`loc`/`typeof v`） | ✅ 全部为内部生成 string 或 typeof 表达式（恒 string），无外部值直插 |

## R2 处置指令（总控）

- **SA3**：safeDetail 一行收窄（上列修复代码）+ guards 第四锚（NEW1 形态）→ 交 SA4 R3 复审（仅复审该函数与新增锚；P1/P9/P10/回归面本轮已核销不再重验）。
- **SA1**：R4 版蓝本 catch 行勘误时，safeDetail 伪代码同步带 `typeof raw === 'string'` 收窄（防下轮照抄再犯）；R4 的 F2 处置本轮已核销，无需再动。
- **SA7 动态重点增补**：修复后复跑 NEW1/NEW2 探针（代码见上，可直接搬入 SA7 报告）→ 均应为 `ok:false` + `toContain('unstringifiable')`；原 R1 三向量探针保持结构化返回。

## R2 验证证据（命令 + 结果摘录）

- **三向量复跑**：`pnpm exec tsx /tmp/sa4-r2-probe.ts`（探针代码见核销表与 R2-F1a 节）→ `R2-P1: structured ok=false` / `R2-P9: structured ok=false` / `R2-P10: structured ok=false`；`R2-NEW1/NEW2: THREW OUT`（R2-F1a 实锤）。
- **回归面**：同探针 R2-NEW4 → message 模板与 path 回显与 R1 逐字一致；`['title',evilObj]` → 干净吸收零外抛。
- **全量门禁**：`pnpm typecheck` → exit 0；`pnpm test` → 61 文件 / 917 例全绿 / typecheck 无错 / exit 0（本轮前台独立复跑；首次后台运行日志截断不可靠，已作废重跑取证）。
- **定向三件套**：`pnpm exec vitest run …guards…schema-independent…test-d --typecheck` → 37+33+4 = 74 例全绿。
- **范围**：`git show 5c5668f --name-status` → read.ts / guards / dispatch / 本报告入库，无 ALLOW 外文件；设计 R4 为工作区修订（未入 5c5668f），内容已逐行核验（§7 L534 ALLOW 行、L551 DENY 留守行、§6.1 L437、§3 D1 L102、R4 头注与后记）。

---
---

# R3 复审（2026-08-23）—— 当前生效裁决

**被审对象**: commit `4014a8d`（R2-F1a 修复：safeDetail 原始 string 收窄 + guards 2 锚）+ 设计 R5 版（两项勘误，641→668 行）
**复审范围**（按 R2 收窄指令）：safeDetail 收窄行 + 新增锚 + NEW1/NEW2 探针核销；P1/P9/P10/回归面/全量门禁不再逐项重验（R2 已核销），仅跑门禁确认全绿。

## Verdict: **pass** ✅

R2-F1a 修复与 SA4 指定模式逐字一致且收窄点正确；NEW1/NEW2 探针复跑全部结构化收编；回归面零（正常 Error 消息原样保留）；设计 R5 两项勘误完整落地（蓝本与实现字面漂移抹平）；全量门禁 919 例全绿。**放行进入 SA7 动态验证。**

> pass 边界：静态验尸通过不替代 SA7 对活链路与 CI 真实 run 的动态验证（动态重点清单见下）。

## R2-F1a 核销表

| 项 | 核销 | 依据 |
|---|---|---|
| safeDetail 收窄行 | ✅ | read.ts（4014a8d diff）：`const raw = err instanceof Error ? err.message : String(err); return typeof raw === 'string' ? raw : 'unstringifiable';`——收窄在**内层 try 之内**完成，ToString 风险全部关回 try；与 yjsWord 既有 typeof 守卫模式同构（R2 处置指令原文） |
| guards 2 新锚 | ✅ | NEW1（message 覆写为敌意 toString 对象的 own **数据属性**——`Object.defineProperty(evilErr, 'message', { value: {...} })`，与 P9 的 getter 形态正确区分）/ NEW2（message = Symbol）→ 均 `not.toThrow` + `ok:false` + `path toEqual(['p'])` + `toContain('unstringifiable')` + E100 前缀；断言真实锚定运行时行为（非源码 grep） |
| NEW1/NEW2 探针复跑 | ✅ | 本轮 tsx 实测：`R3-NEW1: structured ok=false \| msg= DOCRT-E100: 内部错误（意外异常）: unstringifiable`；`R3-NEW2` 同形——两向量零外抛、fallback 生效 |
| 加测（超出 R2 要求） | ✅ | message 为非 string 原始值（42）→ 同样安全收窄回退；正常 `new Error('normal boom')` → message **原样保留**（`DOCRT-E100: …: normal boom`）——合法路径零回归；正常输入行为不变 |
| 设计 R5 勘误 ①（错误通道蓝本） | ✅ | 设计 L9/L351-357/L366-369/L375：catch/notAllowed 一切不可信值转换改经 safeDetail/safeSpreadPath，蓝本含 `typeof raw === 'string'` 收窄伪代码，R5 后记入库教训（「收编者自身无抛点」须细化到每个不可信值的每次转换；TS 类型断言不可作运行时安全依据） |
| 设计 R5 勘误 ②（isPlainRecord 正式回收） | ✅ | 设计 L118/L121/L128-131/L227/L440/L668：D2/D6 判据更正为原型链级 isPlainRecord，R1-D3 偏离正式回收为设计判据（含与冻结 protoObj fixture 的矛盾推导、INV-R4/R5/R11 完好性注记）；R1 报告 D3 节「建议 SA1 补设计勘误」闭环 |

**错误通道终态复核**（收窄后全链重扫）：catch 路径 = safeDetail（返回保证为原始 string）→ 模板插值（字面量 + 原始 string，ToString 恒等无抛点）→ notAllowed → safeSpreadPath（`Array.isArray` 前置无用户代码 + spread 在内层 try）→ 对象字面量构造——**已无任何发生在内层 try 之外的不可信值转换**；notAllowed 非 catch 调用点的 message 实参均为内部 string 或 typeof 表达式。INV-R1 在本轮攻击手段下闭合。

## R3 验证证据（命令 + 结果摘录）

- **探针**：`pnpm exec tsx /tmp/sa4-r3-probe.ts` → NEW1/NEW2 均 `structured ok=false` + `unstringifiable`；`R3-NUM`（message=42）安全回退；`R3-NORMAL-ERR` → `normal boom` 原样保留；正常输入行为不变。
- **全量门禁**（本轮独立复跑）：`pnpm typecheck` → exit 0；`pnpm test` → `Test Files 61 passed (61)`、`Tests 919 passed (919)`（917+2 新锚）、`Type Errors no errors`、exit 0——与总控亲验一致。
- **定向三件套**：guards 39（37+2）+ 冻结 33 + test-d 4 = 76 例全绿。
- **范围**：`git show 4014a8d --name-status` → read.ts / guards / design.md（R5 本次随 commit 入库）/ dispatch——全部在 ALLOW 与处置授权范围内，无越界。

## SA7 动态验证重点（终版清单）

1. **CI 真实 run 证据**：`gh run view --log` 摘录 doc-runtime 测试块——确认 guards 39 例（含 F1/R2-F1a 五个敌意抛出物锚）与冻结 37 例在 node 20/24 双矩阵被收集执行（静态触发性已核，动态摘录归 SA7）。
2. **敌意抛出物探针复跑**（可选加固，代码见 R1-F1/R2-F1a/R3 节）：P1/P9/P10/NEW1/NEW2 五向量 → 全部 `ok:false` 结构化返回；正常 Error message 原样保留。
3. **INFO 级异型载体**：`Object.create(ymapInstance)` 假载体借道（静态推演安全，可选跑一例确认无 crash）。
4. **E16 destroyed doc**：行为良性复核（可选）。

**§1.4 vitest 触发性自检：all-vitest-packages-triggered**——`vitest.config.ts` include `packages/*/test/**/*.test.ts` 覆盖 doc-runtime 的 guards + 冻结行为测试、typecheck include `packages/*/test/**/*.test-d.ts` 覆盖冻结 test-d（R1 已核，本轮不变）；本地全量复跑 61 文件 919 例含 doc-runtime 包（冻结 33+4=37 + guards 39 = 76）；CI node 20/24 动态摘录（真实 run 日志）留 SA7 按上列动态重点 #1 闭环。

## 三轮验尸总览

| 轮 | verdict | 攻击点 | 核心成果 |
|---|---|---|---|
| R1 | reject | 2 项（F1 错误通道三外抛向量 + F2 package.json DENY 违例）；isPlainRecord 偏离核验接受 | 四大机制保真核验、冻结契约未收窄、CI 触发性/caller 审计/源码 grep 禁令全过、全量 914 例复跑 |
| R2 | reject | 1 项（R2-F1a safeDetail 残余洞 NEW1/NEW2）；F1/F2 核销 | 修复代码继续攻击抓出收窄缺失；safeSpreadPath/segMsg/yjsWord 等邻接面验证安全；全量 917 例复跑 |
| R3 | **pass** | 0 项 | R2-F1a 一行收窄核销 + 双锚落地；错误通道不可信转换全部关入内层 try；设计 R5 抹平蓝本漂移；全量 919 例复跑 |
