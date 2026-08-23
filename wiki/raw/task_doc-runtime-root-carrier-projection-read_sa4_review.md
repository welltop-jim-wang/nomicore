# SA4 静态验尸报告 — doc-runtime：schema-independent ROOT 载体投影读取（issue #86）

**Date**: 2026-08-23
**Reviewer**: SA4（Red Team / 静态验尸）
**被审对象**: commit `51621caf`（packages/doc-runtime read.ts 重写 + index.ts JSDoc + guards 测试 + 7 遗留测试删除 + package.json 0.1.5→0.1.6）
**设计基准**: `wiki/raw/task_doc-runtime-root-carrier-projection-read_design.md`（R3 定稿，SA2 R3 verdict=pass）
**Verdict**: **reject**（两处 must-fix；均为局部修复，不动架构——修复后 SA4 复审，无需 SA1 重新设计）

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
