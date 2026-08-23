# SA4 静态验尸报告

**Date**: 2026-08-23
**Reviewer**: SA4（Red Team；静态绿光验尸，未修改任何生产代码）
**被审对象**: SA3 实现 commit `8ef2824`（`packages/doc-runtime`：新增 `src/fatal.ts` 82 行、`src/mutation.ts` 301 行，改 `materialize.ts`/`resolve.ts`/`index.ts`，package.json 0.1.5→0.1.6）
**基准**: SA1 设计 R3.1（`task_doc-runtime-transaction-fatal_design.md`）+ SA2 R3 pass 附条件（C-R3-1/C-R3-2）+ 任务简报 AC-1~AC-7
**Verdict**: **reject**（唯一阻塞项 F-1：`applyValidatedMutation` 嵌套路径 placeSet 返回值缺陷——常规 schema 下嵌套 set 恒失败且诊断失真；同构可互验 schema 下 **ok:true + 值写错层级 + 子树塌缩**的静默错误写入。外科手术级修复，回流目标 SA3。**本任务核心交付面（fatal 契约）全部验证通过、无任何 fatal 通道缺陷**——F-1 是 set 路径管道缺陷，非契约面缺陷。）

---

## 0. 验证环境与复跑证据（全部独立进程：`setsid nohup`）

| 命令 | 结果 |
|---|---|
| `npx vitest run packages/doc-runtime`（worktree 根） | **16 文件 / 235 用例全绿**，`Type Errors no errors`，exit 0（17 红灯转绿 + 3 护栏绿 + 218 既有零回归——与总控亲跑一致） |
| `pnpm typecheck`（根，6 包） | exit 0，0 error |
| PoC 重放（`npx tsx` 临时脚本，跑完即删；见 §5） | 伪造 branded 三投递路径 + SA2 攻击面 #2/#3/#7 全部运行时验证 |

## 1. 设计一致性审查

### 1.1 文件清单 Scope Creep Guard — **通过（1 项登记型偏离，不阻塞）**

- **ALLOW LIST 比对**：`fatal.ts`/`mutation.ts`/`materialize.ts`/`resolve.ts`/`index.ts` + 两个 SA6 测试文件全部在 §15 ALLOW 内；DENY 名单文件 `extract.ts`/`read.ts`/`carrier.ts`/`xml-parse.ts`/`packages/vfsl/**`/`tsconfig.json` **零 diff**（`git diff --stat` 空）。
- **登记偏离**：`packages/doc-runtime/package.json` 在 DENY LIST 上，实际改动**仅** `"version": 0.1.5 → 0.1.6`（diff 1 行）。DENY 条目动机是「无新依赖（W4）」——核对 dependencies 零变更（仍仅 `@nomicore/vfsl` + `yjs`）、exports 仍封闭 `"."`（`DerivedInvariantError`/`transactGuarded` 无泄露面）。版本随新公共导出递增有仓库惯例前例（#74→0.1.2、#83 rev1→0.1.3），且总控移交简文明文披露该项。判定：护栏意图完好，**不构成 scope-creep**；建议 SA1 下次设计把「版本号行」显式写进 ALLOW 例外。
- BLACKLIST（package-lock/yarn.lock/.DS_Store/TASK.md/*.bak）：diff 零命中 ✓。

### 1.2 设计偏离审查 — **核心面一致；发现 1 处实现级偏离（=F-1）**

逐项核验（对照设计章节）：

| 设计条款 | 实现核验 | 判定 |
|---|---|---|
| §3.1 `DocRuntimeFatalError`（phase/committed/message/ErrorOptions.cause、`name` 显式设置、原生 class 无 setPrototypeOf） | `fatal.ts:26-41` 逐字段一致；仅 import yjs（W4） | ✅ |
| §3.2 phase 三值冻结表 + committed 恒定值 | `'observer-cleanup-throw'`(true)/`'post-commit-verification'`(true)/`'pre-commit-internal'`(false)——全部 throw 点核对（见 §1.6 矩阵） | ✅ |
| §3.3 transactGuarded **无条件包装**（零 instanceof 透传） | `fatal.ts:64-77`：catch 内直接 `throw new DocRuntimeFatalError('observer-cleanup-throw', true, …, { cause: err })`；全库 grep `instanceof DocRuntimeFatalError` **仅 3 处注释、零活代码**（materialize.ts:305/551、mutation.ts:180）；`instanceof` 全清单核对：活代码仅 `instanceof DerivedInvariantError` ×2（两 prepare catch，合法 sentinel 分级）+ `instanceof Error`（消息提取） | ✅（R2-1 方案 A 落实） |
| §3.3 catch 分级总表 ⑥ 行（三 catch 无守卫 → e201D 重分级 committed:true + cause 必携） | `materialize.ts:302-348`：三 catch（scratch 构造/双侧提取/产物比较）均 `throw e201D(…, err)` 携 cause；`:342` ⑥ 本地手造诊断点保留裸 `Error`（§4.3 明示「不改」） | ✅ |
| §3.4 E202 参数化（materialize 侧字节同一） | node 渲染比对：E202-A/B/C 三变体与基线 `E202_MSG_A/B/C` **逐字节同一**（`'materializeRoot'` 代入）；mutation 侧指名 `'applyValidatedMutation'`（PoC-3 实证：E202 消息含 applyValidatedMutation、不含 materializeRoot、非 branded） | ✅（§12.6 复核命令通过） |
| §3.4 ⑤⑥ branded 化（消息逐字不变） | ⑤ 变体 A/B、e201C、e201D 模板骨架与基线**逐字节同一**（node 块比对）；E200 行逐字同一 | ✅ |
| **C-R3-2** errDetail 嵌入段「」定界精确范围 + 锚安全 | e201D 三处 catch 调用点恰对 `errDetail(err)` 插值段加「」（:309/:325/:347）；`scratch.issue.message`（:313）与 `exScratch.issues[0]`（:331）非 errDetail 嵌入支**未加**定界；E203/E205 定界（新码无锚）。锚安全：`grep -rn "toThrow.*E201" packages/doc-runtime/test/` 全部为 `'DOCRT-E201'`（子串）/`/DOCRT-E201/`（正则）**前缀形态**，变体 C/D 内部文本（触发类/无法完成/语义校验偏离/校验防线）在既有测试 **0 命中**（grep exit 1） | ✅ **C-R3-2 闭环** |
| **C-R3-1** §15 陈旧交叉引用修正 + 实现不复活已废除守卫 | 设计 R3.1 §15 materialize.ts 条目已改为「⑥ 三 catch 不加 instanceof 守卫」、mutation.ts 条目已对齐 R3 结构（~290 行 + prepareMutation）；实现侧核对：⑥ 无守卫 ✓、mutation.ts 301 行 R3 结构（⓪ 与 (H)/(I) 在 catch 外 + prepareMutation (A)–(G½) 唯一 try/catch）✓ | ✅ **C-R3-1 闭环** |
| §4.2/§4.3 E200 拆分 + sentinel 五落点 | prepare 首检(:517)/buildTopEntries(:259)/rootEntries(:580)/resolve.ts 环(:25)/缺名(:33) 全部 `DerivedInvariantError`；⑥ 侧 :342 保留裸 Error（设计明示）；catch 分级：sentinel→E204、其余→E200（消息逐字不变，rev2 Minor-2 RangeError 类 C 留守） | ✅ |
| §4.3 双副本隔离 | `extract.ts:233` 自有副本保留裸 `Error` **零改动**；`resolve.ts` 副本仅 materialize.ts 消费；read.ts 用 extract 副本（:26 import 核对） | ✅ |
| §5 E202 不 fatal 化 | 两入口均裸 `Error` throw；非 `instanceof DocRuntimeFatalError`（PoC-3 实证） | ✅ |
| §6 U13 字节零改动 | `git diff --stat` materialize-root.test.ts / -rev2.test.ts **空 diff**；E203 message 含 `'observer-boom'` 子串（「」定界不破坏子串匹配——235 全绿含 U13 实证） | ✅ |
| §3.5 导出面五项 + 不导出 RuntimeWriteFatalError/DerivedInvariantError/transactGuarded | index.ts:52-56 五项新导出；模块级断言 `mod['RuntimeWriteFatalError'] === undefined` 在测（AC-1 用例 2 绿） | ✅ |
| §7.2 (A1-A5) 信封校验 / (G½) 预检 / own-key 纪律 | A1 plain object、A2 未知键+缺失键（设计「恰为 {op,path,value}」的等价二分实现，诊断更精确）、A3 set-only+未支持操作响亮拒绝、A4 path 段型、A5 value 存在且非 undefined——PoC-5a/b/c 运行时验证；own-key：`Object.defineProperty` 终段（:248）+ `Object.hasOwn` 导航（:225）——PoC-4/6 运行时验证（`__proto__` own 键真实落库、原型零劫持；原型成员名 →「中间容器缺失」诚实诊断）；(G½) dropped 预检——PoC-7 运行时验证（rogue 键拒绝、零写入、rogue 保留） | ✅ |
| §7.2 (E)(F)(G) 数据流 | **❌ 偏离 → F-1**：(F)/(G) 消费 `placed.value`，而 `placeSet` 对 path 长度 ≥2 返回**终段父对象**（子树）而非设计明文的「**完整 proposed ROOT**」（§7.2 (F)「`validateLogicalSnapshot(derived, proposed)` 完整 proposed ROOT 逻辑校验」） | ❌ |

### 1.3 E2E spec 触发性 — N/A（diff 无 `*.spec.ts`）

### 1.4 vitest 触发性 — **通过**

`.github/workflows/ci.yml`：`Test` 步 `pnpm test` = `vitest run --typecheck`，根 `vitest.config.ts` include `packages/*/test/**/*.test.ts` → 两个新测试文件 + SA4 复现锚均被 CI 触发；`Typecheck` 步含 `tsc -p packages/doc-runtime/tsconfig.json`；Node 20/24 矩阵。单文件点名步（materialize-root.test.ts）是存在性门禁，非主 runner。**无 CI 黑洞。**

### 1.5 协议假设审查 — **通过**

§10 P-1~P-9 章节齐备、依据无「应该/通常」类推断。SA4 复核：P-1（U13 子串绿）、P-2/P-3（observer 场景 16 用例绿 + SA4 PoC-0 实证 update 落盘）、P-4（typecheck 0 error + instanceof 断言绿）、P-7（E203/E204/E205 前缀此前 0 占用，现为新码）、P-8（PoC-4 `__proto__` own 落键 + 零原型劫持）、P-9（PoC-7 dropped 判据）。

### 1.6 契约改动连锁审查（§1.6 立法）— **通过**（caller 矩阵）

| 契约变更 | Caller | 直接 try/catch | 判定 |
|---|---|---|---|
| ④ 裸值→branded E203 | 生产 caller **0**（grep 全仓实证；namespace-runtime 未建）；测试 U13 `toThrow('observer-boom')` 子串（字节零改动，绿）；rev2 observer 组 `/DOCRT-E201/`（E203 消息不含 E201 前缀——注意：④ 现抛 E203 而非 E201，rev2 对 observer 抛错场景的锚是 U13 子串/最终状态断言，非 E201 前缀——核对 rev2:586 组为 XmlElement setAttribute 场景走 ⑤⑥，不受影响，235 绿实证） | ✅ | 同步 API、无 fire-and-forget、无进程顶层 process.exit 一刀切（库层）；本包无 unhandled rejection 面 |
| ⑤⑥ 裸 Error→branded（消息逐字不变） | 37 处 E201 前缀锚（子串/正则）全绿；`toBeInstanceOf(Error)` ×5 兼容（extends Error） | ✅ |  |
| prepare 类 A return→throw（E200→E204） | 既有测试「手造派生物→ok:false」锚 **0 命中**（grep exit 1，与设计 §9 声明一致）；SA6 新锚要求正是 throw | ✅ |  |
| E202 参数化 | 字节同一（§1.2 表）+ 17 处既有锚零触碰 | ✅ |  |
| `makeRefResolver`（resolve.ts 副本）裸 Error→sentinel | caller 仅 materialize.ts:261/:344（prepare→E204 / ⑥→e201D，位置分类）；extract/read 用自有副本零影响 | ✅ |  |
| `applyValidatedMutation` 新增公共函数 | 无既有 caller；SA6 4 用例 + SA4 复现锚 2 用例 | ✅（契约面）｜❌（行为缺陷 F-1，见 §5） |  |

### 1.7 源码 GREP 断言禁令 — **通过**

两个新测试文件 `readFileSync` 0 命中；仅有的 `not.toMatch` 是对**运行时抛出错误消息**的 ROLLBACK_CLAIM 负面锚（行为断言）。全部断言为 instanceof/字段值/最终状态/update 计数/state 字节。

## 2. 读写路径一致性 — ✅ 一致（materialize 侧）/ ❌ 分叉（mutation 侧 = F-1 的另一表述）

materializeRoot：extract 读 live → detached 构造 → 单事务写 live ROOT → ⑤⑥ 读 live 验证——同源闭环。mutation：extract 读 live → JSON 克隆 → placeSet 写克隆 → (F)(G) 消费**placed.value**——设计要求消费完整 proposed；实现消费终段父对象 → 读（校验/构造）与写（事务安装）的**对象基准分叉**（嵌套路径下校验的是子树、安装的也是子树）。详见 §5 F-1。

## 3. 静默失败专项 — ❌ 发现 1 处（F-1 变体 B：ok:true + 数据重塑，三问全否的成功面谎言）

## 4. 降级方案审查 — ✅ 无降级/fallback

E200/E205 留守领域联合是 ADR-0008 条款面（「普通、可预期且零写入」），非伪降级；无任何「失败后偷偷写默认值」路径；F-1 不是降级设计而是返回值管道缺陷。

## 5. 极端条件攻击 — ❌ 发现 F-1（唯一阻塞项）

### F-1（REJECT）：`placeSet` 返回终段父对象而非 proposed 根——嵌套路径 set 双形态缺陷

**根因**（`mutation.ts:201-212, :242-249`）：`placeAt` 返回 `{ kind:'ok', value: obj }`（obj = 终段**父**对象）；`placeSet` 末行 `return placeAt(cur, …)` 原样转发。path 长度 ≥2 时 `placed.value` = 子树；:151/:154 把它送入 (F) 校验与 (G) 构造——**违反设计 §7.2 (F)「validateLogicalSnapshot(derived, proposed) 完整 proposed ROOT 逻辑校验」**（设计伪代码 (F) 校验的就是 proposed）。

**形态 A（常规 schema，必现）**：任意嵌套 set 恒 ok:false，且诊断**失真**——实测 `type ROOT = { u: { n: number; s: string } }`、`set(['u','n'], 5)`：
```json
[{"message":"缺少必填字段 \"u\"","path":["u"]},
 {"message":"未知字段 \"n\"：封闭对象不接受未声明键","path":["n"]},
 {"message":"未知字段 \"s\"：封闭对象不接受未声明键","path":["s"]}]
```
`u` 明明存在却被谎报缺失——嵌套 set 能力完全不可用 + 诊断撒谎。（1 段 path 正常：flat `set(['title'],'t2')` ok:true ✓——这是 SA6 4 用例全绿却漏检的原因：锚只用了 1 段 path。）

**形态 B（同构可互验 schema，静默错误写入）**：无环三别名 `type ROOT = { a?: A; x: number }; type A = { a?: B; x: number }; type B = { x: number }`，seed `{a:{a:{x:1},x:2},x:3}`，`set(['a','x'], 9)` 实测：
- 返回 **ok:true**；
- 最终 ROOT：`x = 9`（正确应为 3——值写错层级）、`a.x = 1`（正确应为 9——请求的写未发生）、`a.a` **消失**（子树塌缩）。

(F) 把子树 `{a:{x:1},x:9}` 当 ROOT 校验通过（B 可作为 A 验证）→ (G) 重建子树 → (G½) live=[a,x] ⊆ rebuild=[a,x] 放行 → (H) 清空 live 安装子树。**虚假成功 + 数据重塑**——正是 SA2 攻击 #3 的判语「不是虚假回滚，是虚假成功」的同类，AC-4/W1 精神违反面。

**证据链**：稳定复现红灯锚已按技能授权落盘 `packages/doc-runtime/test/apply-validated-mutation-nested-path-repro.test.ts`（2 用例，实测 2/2 红、Type Errors no errors、CI `pnpm test` 覆盖）；临时 PoC 脚本（tsx，跑完即删）输出全文见本报告附录引述。

**处置**：**REJECT → 回流 SA3**。修复方向（行为锚，非实现指令）：`placeSet` 对长度 ≥1 的 path 返回 mutated proposed 根（克隆对象被 `defineProperty` 原地变更，直接返回 `root` 即可；空 path 整体替换 `{kind:'ok', value}` 语义不变）。修复后复现锚 2 用例转绿；既有 235 用例零影响（全用 1 段/空 path）。**不退回 SA1**（设计 §7.2/§7.3 语义明确无误，纯实现走样）。

### 其余攻击面全部通过（运行时实证）

| 攻击 | 结果 |
|---|---|
| 伪造 branded 经 observer 投递（R2 #1/PoC-0） | 无条件包装：`committed:true`、`phase='observer-cleanup-throw'`、`cause===spoof 实例`、title 落盘 ✓（伪造 `committed:false` **未**被交付） |
| 伪造 branded 经 mutation value/信封读取面投递（R2-1 Site1/PoC-1） | envelope ownKeys trap → **E205 ok:false 单 issue**（spoof 原文「」定界入 msg）+ 零写入 ✓；value Proxy get trap 在 校验读抛 → 落 **vfsl E100 域 issue**（`VFSL-E100: …spoof`，ok:false + 零写入）——比设计的 E205 更早一层被 收敛，方向同为领域联合，**未升格 fatal** ✓ |
| 伪造 branded 经 derived 二次读投递（R2-1 Site2/PoC-2，5 个投递位全扫） | read#1（prepare）→ E200 ok:false 零写入 ✓；read#2（⑥ scratch 构造）与 read#5（⑥ 产物比较）→ **e201D committed:true + phase post-commit-verification + cause 保留** ✓；read#3/#4（经 extract INV-6 内收）→ e201C committed:true（spoof 文本经 E100 链保留）✓——**五个投递位无一交付伪造 committed:false** |
| `__proto__` Record 新键（SA2 #2a） | ok:true + live ROOT own `'__proto__'` 键真实落库（值 'v'）+ `Object.getPrototypeOf({})` 未被劫持 ✓ |
| 信封闭环（#2c/#2d） | 缺 value / value:undefined / 未知键 extra → 各自精确单 issue，原值未静默清除 ✓ |
| 原型链导航（#2b） | `['constructor','x']` → 「中间容器缺失——原型成员不视为存在键」诚实诊断 ✓ |
| live 未声明键（#3/(G½)） | rogue 注入后 set → ok:false 单 issue 指名 rogue、rogue 保留、state 字节不变 ✓ |
| ref 环手造派生物（#7/sentinel 落点 resolve.ts:25） | **E204** branded、committed:**false**、phase `pre-commit-internal`、0 update、state 字节不变 ✓（落点覆盖缺口的运行时实证） |
| E202 语境指名（#4） | mutation 侧消息含 `applyValidatedMutation`、不含 `materializeRoot`、裸 Error 非 branded ✓ |

## 6. 错误处理链路 — ✅ 完整（fatal/领域双通道闭环，静默路径仅 F-1 形态 B 一处）

每条拒绝路径均有精确 issue 或 branded fatal；无空 catch；catch-all 收敛为响亮 E200/E205 单 issue；vfsl E100 内收边界方向安全（领域联合）。

## 7. 架构评估 — ✅ 可行，无需退回 SA1

R3 结构（全库零透传 + 结构化 catch 分级）在实现中成立且经五投递位运行时验证；F-1 是单点返回值缺陷，修复半径 = `mutation.ts` `placeSet`/`placeAt` 返回值一处。

## 8. 过度设计 — ✅ 精简

fatal.ts 82 行 / mutation.ts 301 行与冻结契约面相当；(A1-A5)/(G½)/own-key 纪律均为 SA2 评审强制项；无投机抽象。

## 9. C-R3-1 / C-R3-2 闭环核验（总控移交项）

- **C-R3-1（必修）✅ 闭环**：设计 R3.1 §15 两处陈旧交叉引用已修正（materialize.ts 条目删除「⑥ catch instanceof 守卫」废除指令、mutation.ts 条目对齐 R3 结构）；实现侧证实未复活守卫（⑥ 三 catch 零 instanceof；mutation (H)/(I) 物理位于 catch 外）。
- **C-R3-2（复核点）✅ 闭环**：e201D 模板骨架逐字同一，差异恰为三处 errDetail 插值段「」定界（:309/:325/:347）；非 errDetail 嵌入支（:313/:331）未定界；37 处 E201 锚全为前缀子串/正则形态、变体 C/D 内部文本零锚（§12.6 复核命令通过）。

## 10. 动态审核重点（交 SA7）

> 前提：SA3 修复 F-1 并使复现锚转绿后，SA7 进入动态验证。

1. **F-1 修复回归**：`apply-validated-mutation-nested-path-repro.test.ts` 2 用例转绿 + 全量 237 用例（235+2）零回归（CI `pnpm test` Node 20/24 双矩阵日志摘录）。
2. **伪造 branded 三投递路径**（本报告 §5 PoC 脚本可复用为动态用例）：observer 投递→E203 committed:true；value/envelope 投递→E205/E100 域联合零写入；⑥ derived 计数 Proxy 投递→e201D committed:true——断言 `cause` 实例保留。
3. **Node 20/24 矩阵 CI 证据**：`gh run view --log` 摘录 `Test` 步（vitest run --typecheck）与 `Typecheck` 步通过证据（§1.4 已静态确认覆盖面）。
4. **(F)(G) 双读窗口**（设计 §7.5 登记移交）：对抗 value 发散不抛形态——确认不出现「校验值≠落库值且 ok:true」未登记行为（本切片允许 ok:false 或两读一致两种形态）。
5. **yjs 版本面**（P-5）：E202 窗口 C fail-closed 对 yjs 内部字段的依赖在 CI 实装版本（^13.6.30）下的行为一致性。

---

## 附：SA3 修复后 SA4 复审范围预告（R1 结语，保留）

定点复核 F-1（placeSet 返回值 + 复现锚转绿 + 全量回归），其余面不再重审（本轮已全部核验通过）。

---
---

# R2 定点复审段（2026-08-23 追加；R1 记录完整保留于上，供溯源）

**被审对象**: SA3 修复 commit `87ea526`（`fix(doc-runtime): placeSet 返回完整 proposed ROOT`）——`packages/doc-runtime/src/mutation.ts` 单文件 10 行差（placeSet 函数体 + 函数头注释）；同 commit 携带 SA4 R1 两件产物入库（复现锚测试 + 本报告 R1 版）。
**复审范围**: 按 R1 预告的三个定点——placeSet 返回值修复正确性、复现锚转绿、全量零回归；另按 R1 §5 对 fatal 通道做零触碰快查。**R1 已核验通过的其余面不再重审。**
**复审方法**: commit diff 全量精读 + 独立进程复跑（`setsid nohup`）+ PoC 重放（`npx tsx` 临时脚本，跑完即删）。

## R2.1 定点一：placeSet 返回值修复正确性 — ✅ 真实落实

diff（`mutation.ts:212-219`）：

```ts
const placed = placeAt(cur, path[path.length - 1]!, value, path);
if (placed.kind === 'issue') return placed;
// placeAt 已对终段父对象原地变更；set 的产物是完整 proposed ROOT（设计 §7.2 (F)）——
// 返回 mutated 根（root），绝不返回终段父对象（子树，path 长度 ≥2 时即数据重塑面）
return { kind: 'ok', value: root };
```

核验：

- **issue 支透传保留**（placed.kind === 'issue' 原样返回）——真不可达拒绝路径未变；
- **`root` 引用正确性**：placeAt 经 `Object.defineProperty` 对终段父对象**原地变更**，而终段父对象是 `stepInto` 从 `root`（= prepareMutation (E) 的 `proposed` 克隆）逐层 `obj[seg]` 取得的**同一对象图内节点**——变更对 `root` 可见，返回 `root` 即返回 mutated proposed 根 ✓（与设计 §7.2 (E)(F)「 完整 proposed ROOT」逐字对齐）；
- **空 path 早退 `{ kind: 'ok', value }` 未触碰**（整体替换语义不变——PoC [C4] 实证 set([]) ok:true 且落库）；
- **无其他改动**：placeAt/stepInto/own-key 纪律/信封校验/(G½)/prepareMutation catch 分级全部零触碰；`instanceof` 全库清单复核零新增（修复 diff 不含任何 instanceof）。

## R2.2 定点二 + 定点三：复现锚转绿 + 全量零回归 — ✅（SA4 独立进程亲跑）

| 命令 | 结果 |
|---|---|
| `npx vitest run packages/doc-runtime`（worktree 根） | **17 文件 / 237 用例全绿**（R1 基线 235 + SA4 复现锚 2），`Type Errors no errors`，exit 0——与总控亲跑一致 |
| `pnpm typecheck`（根，6 包） | exit 0，0 error |
| Scope 复核 | `git show 87ea526 --stat`：仅 `mutation.ts`（ALLOW LIST 内）+ SA4 两件产物入库；fatal.ts/materialize.ts/resolve.ts/index.ts 零触碰；无越界文件 |

## R2.3 F-1 双形态修复 PoC 重放（实际实现，运行时实证）

| PoC | 结果 |
|---|---|
| 形态 A（常规 schema 嵌套 set） | `set(['u','n'],5)` → **ok:true**、u.n=5、u.s='x' 保留、deep.q=7 保留；**3 段** `set(['u','deep','q'],8)` → ok:true、deep.q=8、先前 u.n=5 不受扰 ✓ |
| 形态 B（同构可互验 schema） | `set(['a','x'],9)` → ok:true 且最终 ROOT = **正确完整 proposed 投影**（x=3 不受扰、a.x=9、a.a.x=1 嵌套保留）——子树冒充安装面消除 ✓ |
| 嵌套中间容器缺失（修复不得掩盖真不可达） | `['u','missing','k']` → ok:false「中间容器缺失——set 不自动创建中间容器」✓ |
| (G½) 预检未波及 | rogue 注入后 set → ok:false 指名 rogue、rogue 保留、state 字节不变 ✓ |

## R2.4 fatal 通道零触碰快查（R1 §5 攻击面抽查）

- 伪造 branded 经 observer 投递 → E203 无条件包装：`committed:true` / `phase='observer-cleanup-throw'` / `cause===spoof 实例` ✓；
- 伪造 branded 经信封 ownKeys trap 投递 → **E205 ok:false 单 issue + 零写入**（state 字节不变）✓；
- 全套 fatal 契约行为由 237 用例中 20 个 fatal 契约用例（SA6 17+3 护栏 + 复现锚外）锁定全绿 ✓。

## R2.5 R2 裁决

**Verdict: pass。**

- F-1 唯一阻塞项真实修复（单点、外科手术级、与 R1 给出的修复方向一致），双形态缺陷运行时实证消除；
- 复现锚 2/2 转绿 + 全量 237/237 零回归 + typecheck 0 error（SA4 独立亲跑，与总控一致）；
- fatal 通道零触碰确认，R1 已核验面（契约三相/零透传/C-R3-1/C-R3-2/E202 字节同一/U13/CI 触发性等）无回退必要（无 diff 即无回退面）；
- R1 §10 动态审核重点 5 项维持原样移交 SA7（其中第 1 项「F-1 修复回归」的本地面已由本轮闭合，SA7 只需补 CI Node 20/24 矩阵日志证据）。

---
---

# 1.4 vitest 触发性自检（补充轮明文落文；issue #289 立法硬门禁 #14）

> 补充轮说明：本节为 R1 §1.4「vitest 触发性——通过」结论按 2026-06-15 立法（SA4 SKILL §1.4，issue #289 复盘）要求的**明文小节落文**——R1/R2 已实质完成同等核验，本节不改变任何结论，仅补齐立法文书面。核验时点：R2 pass 之后（2026-08-23），证据链当次重取。

## 核验对象（本任务新增/改动的 `*.test.ts` → 所在 workspace package）

`git diff --name-only 74b9cfd HEAD | grep -E '\.test\.ts$'` 全枚举（3 个文件，SA6 红灯锚 ×2 + SA4 复现锚 ×1）：

| 测试文件 | 所在 package（最近 package.json `name`） |
|---|---|
| `packages/doc-runtime/test/transaction-fatal-materialize-contract.test.ts` | `@nomicore/doc-runtime` |
| `packages/doc-runtime/test/apply-validated-mutation-fatal-contract.test.ts` | `@nomicore/doc-runtime` |
| `packages/doc-runtime/test/apply-validated-mutation-nested-path-repro.test.ts` | `@nomicore/doc-runtime` |

涉及 workspace package 唯一：**`@nomicore/doc-runtime`**。

## CI vitest 调用链核验

1. `.github/workflows/ci.yml` 唯一主测试 job `test`（Node 20/24 矩阵，push main + 全 PR 触发）的 `Test` 步：`run: pnpm test`；
2. 根 `package.json` `"test": "vitest run --typecheck"`——**无 `--filter`/`--project` 限定**（grep 全 workflow + 根 scripts 零命中）→ 全 workspace 范围运行；
3. 根 `vitest.config.ts` `test.include: ['packages/*/test/**/*.test.ts', ...]` → `packages/doc-runtime/test/**` 全部落入收集范围——上述 3 个测试文件（及该 package 其余 14 个测试文件）全部被 `Test` 步触发，并同步经 `--typecheck` 覆盖类型面；
4. 辅助单文件门禁步（`Materialize root tests`→materialize-root.test.ts、`Persistence contracts`、`Domain scaffolds check`）为存在性专项步，**非排除面**，不缩减主 runner 覆盖范围；
5. 旁证（非本任务产物）：working tree 未提交的 `sa7-fatal-dynamic-verify.test.ts`（SA7 动态验证文件）同在此 package、同一 include 覆盖下——触发面相同。

## 判定

`@nomicore/doc-runtime` 的全部新增/改动 `*.test.ts` 均被 CI `test` job `Test` 步（`pnpm test` = `vitest run --typecheck`）覆盖，无「测试存在但从未被触发」的 CI 黑洞；Node 20/24 双矩阵均在触发面内。

**结论令牌：`all-vitest-packages-triggered`**
