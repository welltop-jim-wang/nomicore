# SA4 静态验尸报告 — extractYjsSnapshot 实现（SA3 commit 079e957）

> **现行裁决：R2 Verdict: pass（2026-08-22，F-1 修复面复审通过——见文末「SA4 R2 复审」章节；R1 reject 已由修复回流 79319a4 + 设计 R2.2 + SA6 回归锚闭合）。以下为 R1 原始记录，保留不删。**

**Date**: 2026-08-22
**Verdict**: **reject**（单项 REJECT 级发现 F-1：Record 动态键 `'__proto__'` 在 `ok:true` 下静默丢失/原型劫持——设计伪代码同患，精准回流 SA1 touch-up + SA3 一行级修复 + SA6 回归锚；其余全部通过，无架构问题，不需要 needs-redesign）
**被审对象**: `packages/doc-runtime/src/{carrier,extract,index}.ts` + `packages/doc-runtime/tsconfig.json` + 根 `package.json` typecheck 串联（commit 079e957，diff 基线 `origin/docs/doc-runtime-validation`，merge-base f07462d）
**审查方式**: 全新视角通读实现 429 行 + 三份测试 865 行；逐条对照 R2.1 设计（D1–D12 / INV-1–8 / §4 全节 / §6 边界 / §11 文件清单）；§9 协议假设与 SA2 附录 B/C 探针**独立重跑**；8 项极端条件攻击探针（含 2 项发现级）；全量 `pnpm test`（50 files/707 tests）与根 `pnpm typecheck`（6 包）独立复跑确认。

---

## 审核结论

1. **设计一致性**：⚠️ 高保真 + 1 项继承自设计的规格空洞（F-1）+ 1 项修复性偏离（F-2，正向）。D1 两层判定 / D2 探针级联 / D3 惰性空 map / D4 undefined 视同缺席 / D5 试验三结局（前置判定 + Record 特例 + 出口 3 回退）/ D6 深拷贝 + 原型守卫 + defineProperty / D7 toString / D9 词表 / D10 值域零消费 / D12 两结局 WalkResult 逐条核符。`discriminator` 零读取（grep：仅注释）、`values/index/aliasDocs` 零消费（grep：零命中）——INV-4/D10 构造性成立。
2. **读写路径一致性**：✅ 纯函数接缝，无数据源分叉；snapshot（纯 JSON）→ validateLogicalSnapshot（JSON 入参）两步分离咬合正确。
3. **静默失败**：❌ **F-1**（ok:true 下 Record 动态键 `'__proto__'` 静默丢失，对象值时快照原型被劫持）——见下文发现清单。
4. **降级方案**：✅ 设计裁决项均合规——ROOT 缺席惰性空 map 为冻结契约 F6 语义（P4 复跑：0 update 事件）；union 全软拒回退成员 0 为 B6 明文裁决（实测行为与设计推演一致）。F-1 属「静默投影蒸发」类伪降级（同 B13/B15 判例），必须 loud 化或保真。
5. **极端攻击**：❌ F-1（静态+动态双确认）；其余攻击面安全——E100 崩溃边界 8 项探针全部收敛为结构化返回（零外抛、零挂起，含手造 ref 环 A→B→A / 自引 / 缺名 / structure 非 root / union 空成员 / derived=null / doc=null）；Y.Array 元素 undefined 全部公共写入路由（integrated insert / 嵌套 insert / 跨端 sync / 游离→挂接）均在写期抛错（实测），walk array 分支不可达 undefined；`'__proto__'` 作封闭字段名被 parser 拒绝（`_` 不可作标识符起始、字符串字面量字段名拒绝——实测），封闭 map 分支无此向量。
6. **错误处理**：✅ 完整——所有路径终态为 `{ok:true,snapshot}` / 单 issue / E100 三者之一；INV-6 不外抛经 8 项探针实证（含 `derived=null`、`doc=null`）；src 内 6 处 throw 全部位于顶层 try/catch 辖域内（grep 复核）。
7. **架构评估**：✅ 可行——分层（carrier/extract/index）、依赖边界（doc-runtime→vfsl 仅 `import type` + yjs 运行时；vfsl/persistence 零反向——package.json 实核）、崩溃边界模式全部成立。无需退回 SA1 重设计。
8. **过度设计**：✅ 精简——extract.ts 350 行 vs 设计预估 ~280 行同阶；无投机抽象、无防御过度（F-2 的环守卫重排为有据防御）；变更半径 = ALLOW LIST 精确范围。

---

## 发现清单

### F-1【REJECT · MAJOR+】Record 动态键 `'__proto__'` → 快照静默丢键 / 原型劫持（ok:true）

- **位置**：`packages/doc-runtime/src/extract.ts:104-106`（walk map Record 分支 `out[key] = r.snapshot;`——赋值式写入）。同款赋值式还有 `:117`（封闭 map，parser 已挡 `__proto__` 字段名，不可达）与 `:210`（trialMember，同 parser 保护）——**可达向量唯一：Record 动态键来自 live 数据**。
- **机理**：`out['__proto__'] = v` 命中 `Object.prototype.__proto__` accessor——标量值被 setter 静默忽略（键丢失）；对象值把 out 的原型设为该快照对象（键丢失 + 原型劫持，JSON 序列化后数据整体蒸发）。
- **实测证据**（真实实现探针，2026-08-22，本机 yjs@13.6.32 / Node 24.13.0）：

```
# 探针（tsx，import 自 packages/doc-runtime/src/index.js）
A: derived = { m: Record<string, string> }；live m.set('normal','v1'); m.set('__proto__','v2')
   → ok:true | live m keys=["normal","__proto__"] | snapshot m keys=["normal"] | lost __proto__? true
B: derived = { m: Record<string, { x: string }> }；live m.set('__proto__', Y.Map{x:'y'})
   → ok:true | snapshot m own keys=[] | Object.getPrototypeOf(out.m) !== Object.prototype → true（原型被劫持为内层快照）
C: derived = { __proto__: string }（封闭字段名）→ parse FAIL: VFSL-E100: 未知记号: _（schema 侧不可达）
D: 对照——plain 值内 own '__proto__' 键（copyPlainValue defineProperty 路径 :294）
   → ok:true | snapshot own keys=["__proto__"] | own 键保留 true（同文件内两分支纪律自相矛盾的铁证）
```

- **影响**：Record 的键集就是数据面（AC6「Record 多动态键正确提取」）；快照静默缺键后，下游 validateLogicalSnapshot（体检相位，只看快照不看 live doc）**永远无法发现该丢失**——端到端零信号的静默数据丢失。情形 B 同时违反 INV-1 精神（数据挂在原型上，`JSON.stringify` 往返蒸发）。可达性：Record 键是任意字符串（keyPattern 零消费是 D4/B5 明文设计），`ymap.set('__proto__', v)` 公共 API 直接可达（实测成功）——与 B15/Q3/Q4（plain 值 own `__proto__` 键，SA1 已用 defineProperty 修掉的同一威胁类）完全同源。
- **责任归属**：设计 §4.3 伪代码原文即 `out[key] = r.snapshot`（封闭 map 分支 `out[f.name] = …` 同）——**规格空洞，SA3 忠实实现**，非 SA3 偏离；SA1 R2 与 SA2 R1/R2 均未攻击到该位（SA2 #8 只覆盖了 copyPlainValue 的对象键）。
- **回流目标与处置**（按 skill §5「静态可确认漏洞 → REJECT」）：
  1. **SA1**：设计 touch-up——§4.3 快照 map 构造写入纪律改为 defineProperty（镜像 §4.6 R2/#8 的既有裁决）或等效安全写入；§6 边界清单补 B16（Record 动态键 `'__proto__'`：own 键保真写入，禁赋值式）；顺带把 §4.4 伪代码的环守卫顺序按 F-2 回写（见下）。
  2. **SA3**：Record 分支（extract.ts:106）改 defineProperty 写入（封闭 map 分支 :117/:210 可一并统一为防御纵深，行为不变）；**不得**借机改动其他行为面。
  3. **SA6**：增补回归锚——Record 动态键 `'__proto__'` 标量值与嵌套 map 值两用例，断言 own 键保留 + `JSON.parse(JSON.stringify(s))` 往返含该键 + 快照对象原型仍为 `Object.prototype`。

### F-2【正向偏离 · 记录】ref 解析器环守卫顺序重排——修复设计伪代码（与 vfsl walkRefChain）的潜在死循环

- **位置**：`extract.ts:232-246`：环守卫 `inFlight.has(cur.name)` 在 memo 命中检查**之前**；设计 §4.4 伪代码与 vfsl `resolve.ts walkRefChain`（:91-107）均为 memo-first 序。
- **机理**：memo-first 序下，手造环 A→B→A 首轮把 `memo[A]=B、memo[B]=A` 写入后，后续迭代全部命中 memo、永不触达 inFlight 检查 → **死循环**（while 无栈增长，RangeError 兜底也不触发）。SA3 的重排使环在 memo 命中前即被 inFlight 拦截。
- **实测**：手造 A→B→A 与自引 A→A 两探针均 **0ms** 终止并返回结构化 `DOCRT-E100: 结构 ref 环（A）`（见附录 A-3）；合法 derived（E106 保证无环）下两序行为逐位一致（无环链上 inFlight 检查恒 false）。
- **处置**：非阻塞。建议 SA1 把 §4.4 伪代码同步为现行实现序（文档 touch-up）；vfsl `walkRefChain` 同患此疾（对合法输入不可达，纯手造 IR 面）——**超出本任务 DENY 辖域**，仅登记为后续票观察项，本任务不得改 vfsl。

### F-3【MINOR · 登记】plain 对象 throwing getter → E100 'internal'

- 本地可达：`set('g', { get x(){ throw } })` 存原引用成功，copyPlainValue 读 `v[k]` 触发 getter throw → 顶层 catch → E100。响亮（ok:false）但语义域为「内部错误」——与 SA2 #2 攻击的「可达脏数据误报 internal」同类（更罕见：需原型合法对象内嵌 throwing accessor）。设计 §4.6 未覆盖该值形。处置：登记 SA1 后续裁量（补申报词或维持 E100 归类），不阻塞本裁决；SA7 动态面无需求（本探针已动态验证）。

### F-4【cosmetic · 登记】`doc=null` 时 E100 message 语义失真

- probeRoot 四级 try/catch 会吞掉 null 解引用的 TypeError，最终报「ROOT 载体探针全失败（公共 API 造不出第五种 ROOT）」。终态仍是 E100 结构化返回（INV-6 成立），仅 message 措辞失真。不阻塞；SA3 修复 F-1 时可顺手（也可不动）。

### F-5【审计记录】DENY 清单两文件出现在分支 diff——SA6 脚手架落仓，非 SA3 修改

- `packages/doc-runtime/package.json`（DENY「不改」）：内容与 SA6 Phase 1 记录逐字段一致（name/version/private/type/exports/scripts/deps/devDeps 全等）——SA6 产出经 SA3 commit 首次入 git，无改动。
- `pnpm-lock.yaml`（DENY「零 lockfile 变更」）：diff +19 行全部为 `packages/doc-runtime` importer 登记（`@nomicore/vfsl link:../vfsl` + yjs 13.6.32 + devDeps），即设计 §9 S4 所载 SA6 产物落仓；无任何依赖版本漂移。属 skill 白名单豁免范畴。两处均为流程性落仓，不判 scope-creep；留档备查。

---

## 待裁决事项（总控转来）——SA4 裁决

### ① D9 词汇表偏离家族（E100 'internal' + plain 域 actual 词）——**裁决：接受申报**

| 偏离 | 本轮独立复验 | 裁决依据 |
|---|---|---|
| `'internal'`（E100 双侧） | 8 项 E100 探针全部仅手造派生物/null 入参可触达（附录 A-3）；公共 API + 合法 derived 零可达 | 语义域诚实标记（非载体词冒充）；ADR 中立（SA8 no-conflict）；四字段形状完整；SA6 用例未锚定、不产红。expected 侧结构错位恒五值词汇表（两层判定 D1 保证，A2/P1 用例复证） |
| `'bigint'` | A1 直存 / D2 数组内嵌 / E1 跨端 sync 后仍 bigint——三路由全部复现；补充测试第 3 用例经真实实现转绿 | 可达脏数据 → 真 issue（绝不 E100）——R2/#2 裁决的行为面，实现与测试双重锚定 |
| `'undefined'` | D1 plain 数组内元素可达复现；Y.Array 元素 undefined 全写入路由写期抛（含游离→挂接路径，附录 A-2）——唯一残留路由即 plain 数组 | 词与可达性精确对齐 |
| `'non-plain object'` | C1 复现（Date 本地读回实例）；E2 跨端退化为 plain `{}` 复现（守卫正确放行，B13「诚实边界」成立） | 原型守卫禁静默投影 `{}`；message 附 constructor 名（实现 :284-285 ✓） |
| `'function'` / `'symbol'` | 见下② | — |

**理由要点**：expected 侧恒词汇表内值（plain 域违规 = `'plain value'`），actual 侧扩展词全部是**真实可观测输出**且经 16 条补充用例锚定四字段形状 + `!== 'internal'` 回归守卫（`extract-plain-domain.test.ts:76-79` / `extract-union-trial.test.ts:75-77`）；申报走「显式说明 + SA4 复核」流程完备（D9 + §10 登记块）。**冻结契约 F4 的辖域（结构错位词汇）未被侵蚀。**

### ② SA2 R2 复审 R-2 改判（function/symbol 内嵌可达 → 真 issue）——**裁决：接受改判**

- 直接位：`set('a', fn)` / `set('a', Symbol())` → `THROW: Unexpected content type`（A2/A3 本轮复现）——不可达，carrierOf null → mismatchIssue throw → E100 防御，正确。
- 内嵌路由：`set('a',[fn])` ok 且读回 function（N1）、`{k:fn}` ok（N2）、`[Symbol()]` ok（N3）、`encodeStateAsUpdate` 不抛（N4）——本轮全部复现；实现路由至 copyPlainValue 尾分支（extract.ts:299）产真 issue，补充测试两用例（actual='function'/'symbol'）经真实实现转绿。
- 设计 R2.1 文本四处（§4.1 docblock / §4.6 / §4.8 / D9②）口径一致（「内嵌可达→真 issue、直接位→E100」），B9 已限定「直接位」——文本无残留矛盾。
- **附注**：改判仅涉标注层，机制行为 R2→R2.1 零变化，SA2 的判断正确，实现与测试同步到位。

---

## 门禁清单执行记录

| 门禁 | 结果 | 证据 |
|---|---|---|
| §1.1 Scope Creep Guard | ✅ 通过 | actual（17 文件）− allow − 白名单 = ∅：src×3 / tsconfig / 根 package.json / 测试×3 全在 ALLOW；wiki/raw/task_*、pnpm-lock 白名单豁免；package.json(SA6 脚手架) 见 F-5；BLACKLIST（package-lock.json / yarn.lock / .DS_Store / TASK.md / *.bak）零命中 |
| §1.2 设计偏离 | ⚠️ 见 F-1（继承自设计）/ F-2（正向） | 其余逐条核符（结论 1） |
| §1.3 E2E spec 触发 | N/A | 本任务无 `*.spec.ts` |
| 1.4 vitest 触发性自检 | ✅ 通过 | `vitest.config.ts` include `packages/*/test/**/*.test.ts` 覆盖三份新测试；CI `Test` step = `pnpm test`（根 vitest，无 --filter 排除）；本轮实跑确认三文件被执行（21+9+8=38 用例）；typecheck 链：根 `pnpm typecheck` 第 6 项（tsc -p doc-runtime）+ `tsconfig.typecheck.json` glob 覆盖 src/test。AC5 经「零 CI 改动」路线成立，与设计 §7 一致 |
| §1.5 协议假设 | ✅ 通过 | §9 现行 R2.1 文本 P2/P3/Q1 **verbatim 重跑**逐行一致（P3 输出 `getText => ok ` 空串——与 R2.1 校准记载一致）；SA2 附录 B-1/B-2 全组探针复现（P1/P4/P15/P16/P22/P7/A1/A2/A3/C1/C1/D1/D2/E1/E2/N1–N4）；B1 需用**已挂接** Y.Array 复测方复现 THROW（游离数组 insert 不抛——fixture 纪律「先挂接再读取」的佐证，非设计依据缺陷）。无「应该/通常」类无据推断 |
| §1.6 契约改动连锁 | ✅ 无既有契约改动 | 全仓 grep：`extractYjsSnapshot` 实际 caller = index.ts re-export + 3 测试文件（ADR 文档与 vfsl 注释为文字引用非调用）——§10「caller 集合 = 测试」属实；根 typecheck 串联为纯增量（第 6 项追加），6 包本轮全过 EXIT=0 |
| §1.7 源码 grep 断言禁令 | ✅ 通过 | 三份测试零 `readFileSync`；唯一 `toContain` 命中为 `expect(issue.path).not.toContain('b')`（运行时 path 数组断言，非源码文本断言）；全部断言锚定公共接缝可观测输出 |
| §2 读写路径 | ✅ | 结论 2 |
| §3 静默失败 | ❌ F-1 | 结论 3 |
| §4 降级方案 | ✅（F-1 另计） | 结论 4 |
| §5 极端条件 | ❌ F-1；其余 ✅（附录 A） | 结论 5 |
| §6 错误处理链路 | ✅ | 结论 6 |
| §7 架构死胡同 | ✅ 无触发 | 结论 7（无 ≥3 处绕行/无 FIXME/无跨模块扩散） |
| §8 过度设计 | ✅ | 结论 8 |
| 测试基线独立复跑 | ✅ | `pnpm test` → Test Files 50 passed (50) / Tests 707 passed (707) / Type Errors no errors / EXIT=0；`pnpm typecheck` → 6 包串联 EXIT=0（/tmp/sa4-verify.log，2026-08-22 13:14–13:15）——与总控亲验基线一致 |

---

## 动态审核重点（交 SA7）

> 本轮 SA4 已对下列各项做过一次性动态探针（结果见附录 A）；SA7 在 dynamic-verify 阶段请以 CI/真实链路视角复核，F-1 修复后第 1 项作废、其余仍适用。

1. ~~Record 动态键 `'__proto__'` 快照保真~~（**F-1 修复后**改为：验证修复产物 own 键保留 + JSON 往返 + 原型未被劫持——随 SA6 回归锚走）。
2. **解耦与跨端组合**：`encodeStateAsUpdate → applyUpdate` 后的远端 doc 提取（E1/E2 已探；SA7 请覆盖「同 doc 两次提取逐字节相同」INV-8 与并发观察者在场时的只读性——P4 只探了惰性创建零 update，未探遍历期事务只读性）。
3. **大文档性能面**：D11 无预算论证在真实 schema（m、深度个位数）下成立；SA7 可用 vfs3.assets 形 + 数千 Record 键抽样时延，确认无超线性路径（union 试验最坏面在 fail-fast 约束下的实际表现）。
4. **Node 20 矩阵**：本机仅 Node 24.13.0；CI node 20 下 yjs 13.6.32 行为一致性（`instanceof` 矩阵 / `Symbol.hasInstance` 无关路径）由 CI 双矩阵覆盖，SA7 摘录 run log 中 doc-runtime 三文件的执行证据（SKILL「vitest 触发证据」要求）。
5. **F-3 throwing getter**：如 SA1 裁量补词，SA7 补动态锚；如维持 E100 归类，SA7 确认 message 可排障（当前含原异常文案 `boom`——可）。

---

## 附录 A：本轮探针命令与输出（可复现）

### A-1 协议假设 verbatim 重跑（§9 现行文本）

```
$ cd packages/doc-runtime
$ node -e "import('yjs').then((Y)=>{const d=new Y.Doc();d.getXmlFragment('ROOT');for(const [n,f] of [['getMap',()=>d.getMap('ROOT')],['getArray',()=>d.getArray('ROOT')],['getXmlFragment',()=>d.getXmlFragment('ROOT')]]){try{f();console.log(n,'=> ok')}catch(e){console.log(n,'=> THROW:',e.message)}}})"
getMap => THROW: Type with the name ROOT has already been defined with a different constructor
getArray => THROW: Type with the name ROOT has already been defined with a different constructor
getXmlFragment => ok                                    # = P2 记载 ✓

$ node -e "import('yjs').then((Y)=>{const d=new Y.Doc();d.getText('ROOT').insert(0,'x');for(const [n,f] of [...四探...]){try{const r=f();console.log(n,'=> ok',typeof r==='string'?r:'')}catch(e){console.log(n,'=> THROW')}}})"
getMap => THROW / getArray => THROW / getXmlFragment => THROW / getText => ok    # = P3 记载（R2.1 校准后）✓

$ node -e "import('yjs').then((Y)=>console.log(typeof Y.AbstractType))"
function                                                # = Q1 记载 ✓
```

### A-2 SA2 附录 B 探针复跑（摘要，全部与 B-1/B-2 记载一致）

```
P1 getMap => THROW / getArray len=3        P4 update events=0        P15 same ref=true
P16 has=true get=undefined                 P22 [Y.Map] instanceof=true P7 keys=["b","a","c"]
A1 set bigint ok typeof=bigint             A2 set function THROW: Unexpected content type
A3 set symbol THROW: Unexpected content type
B1 integrated insert [undefined,1] => THROW: TypeError（游离数组不抛——挂接后方复现记载）
B1b nested / B1c sync 均 THROW             C1 Date instanceof=true C2 keys=[]
D1 [undefined] ok el=undefined             D2 [10n] ok typeof=bigint
E1 bigint after sync typeof=bigint         E2 date after sync ctor=Object
N1 [fn] ok typeof=function                 N2 {k:fn} ok               N3 [Symbol] ok typeof=symbol
N4 encodeStateAsUpdate ok
# 游离→挂接注入路由：detached insert ok（内容未落）→ set('a',arr) THROW: Cannot read properties of undefined——写期拦截，不可达
```

### A-3 E100 崩溃边界探针（tsx 驱动真实实现，全部 ok:false 单条 E100、零外抛）

```
E100-1 structure 非 root        → DOCRT-E100 … derived.structure 非 root（手造派生物）   [1ms]
E100-2 ref 环 A→B→A（memo 场景） → DOCRT-E100 … 结构 ref 环（A）                        [0ms，无挂起——F-2]
E100-3 ref 缺名                 → DOCRT-E100 … 结构 ref 缺名（Nope）
E100-4 union 空成员             → DOCRT-E100 … union 无成员（手造派生物）
E100-5 derived=null             → DOCRT-E100 … Cannot read properties of null …
E100-6 doc=null                 → DOCRT-E100 … ROOT 载体探针全失败（F-4：措辞失真，终态正确）
E100-7 throwing getter          → DOCRT-E100 … boom（F-3）
E100-8 自引 A→A                 → DOCRT-E100 … 结构 ref 环（A）                        [0ms]
EXIT=0（进程正常退出，无未捕获异常）
```

### A-4 F-1 复现脚本（核心段；完整见发现清单）

```ts
// cd <worktree> && pnpm exec tsx <file>（文件置于 packages/doc-runtime/ 内以解析依赖）
const d = derivedOf('type ROOT = { m: Record<string, string> };');   // vfsl parse+evaluate
const doc = new Y.Doc(); doc.getMap('ROOT').set('m', new Y.Map());
const m = doc.getMap('ROOT').get('m') as Y.Map<unknown>;
m.set('normal', 'v1'); m.set('__proto__', 'v2');
extractYjsSnapshot(d, doc)  // → ok:true；snapshot.m 仅含 "normal"，"__proto__" 静默丢失
```

### A-5 全量基线复跑

```
$ pnpm test      → Test Files 50 passed (50) | Tests 707 passed (707) | Type Errors no errors | EXIT=0
  （含 ✓ extract-yjs-snapshot 21 / extract-plain-domain 9 / extract-union-trial 8）
$ pnpm typecheck → vfsl && vfsl-protocol && vfsl-codegen && persistence && dsh-persistence && doc-runtime | EXIT=0
```

---

## 回流指令汇总

| 目标 | 动作 | 理由 |
|---|---|---|
| **SA1** | 设计 touch-up：①§4.3 快照 map 构造写入纪律（defineProperty/等效安全写入，镜像 §4.6 R2/#8）；②§6 补 B16（Record 动态键 `'__proto__'` own 键保真）；③§4.4 伪代码环守卫顺序按 F-2 回写；④F-3（throwing getter 归类）裁量登记 | F-1 规格空洞源头在设计；F-2 文档与实现同步 |
| **SA3** | extract.ts Record 分支 :106 安全写入（:117/:210 可统一，行为不变）；修后重跑全量 + 新增 SA6 锚转绿 | F-1 可达向量唯一落点 |
| **SA6** | 增补回归锚：Record 动态键 `'__proto__'`（标量 + 嵌套 map）→ own 键保留 + JSON 往返 + 原型未劫持 | F-1 防回归（冻结 21 + 增补 16 均未覆盖） |
| SA7 | 按「动态审核重点」清单执行（F-1 修复后第 1 项改验修复产物） | 动态面收口 |

**Verdict: reject** —— 阻塞项仅 F-1 一项，修复半径一行级 + 测试锚；架构、依赖边界、门禁、词表裁决（①②均接受）全部通过。修复回流完成后 SA4 复审仅需针对 F-1 修复面。

---

# SA4 R2 复审 — F-1 修复面（2026-08-22）

**Date**: 2026-08-22
**Verdict（R2，取代 R1）**: **pass**
**被审对象**: F-1 修复回流四件套——commit 79319a4（`extract.ts` putSnapshotKey + 三处替换）、设计 R2.2 落文（commit 7646f06：D13/B16 + §4.3/§4.4 回写 + F-2 守卫序登记 + B17）、SA6 回归锚 `extract-record-keyspace.test.ts`（commit 8b49798，2 用例）、基线复验（51 files/709 tests + 6 包 typecheck）。
**审查范围**: 按本报告 R1 末回流指令，仅 F-1 修复面；R1 已裁决项（D9 家族/R-2 改判/其余门禁）不重开。

## 修复面逐项核验

### 1. SA3 实现（commit 79319a4）——✅ 精准兑现回流指令

| 检查项 | 结果 | 证据 |
|---|---|---|
| 修复半径 | ✅ 生产代码仅 `extract.ts` 1 文件（+17/−3） | `git show --stat 79319a4` |
| putSnapshotKey 助手 | ✅ defineProperty + 四描述符（value/writable/enumerable/configurable），与 §4.6 plain 值写入同款；docblock 完整记载机理（accessor 静默丢键/原型劫持/JSON 蒸发）+ 可达性 + parser 保护 + D 对照矛盾 | extract.ts:318-329 |
| 三处替换落位 | ✅ `:106` Record 分支（F-1 唯一可达向量）；`:117` 封闭 map（防御纵深，行为不变）；`:210` trialMember（防御纵深）——即 R1 回流指令的「可选统一」全采纳 | grep 实证：**零残留赋值式快照键写入**（`out[` 模式无命中；仅余 `out.push` ×2 数组下标安全 + copyPlainValue `:294` 既有 defineProperty） |
| 非 `__proto__` 键行为等价 | ✅ defineProperty 四描述符数据属性 ≡ 赋值式创建的属性（enumerable/writable/configurable 同形）；各分支键唯一（Y.Map 键/字段名不重复），无重定义路径；插入序保持 | 探针 F：Record 键序 `["b","a","c"]` 插入序不变 + 同输入两次提取逐字节相同（INV-8 无回归） |
| 全量回归 | ✅ 既有 38 用例 + 全仓 709 用例零回归 | 见下「基线独立复现」 |

### 2. 漏洞闭合验证（修复后实现探针重跑）——✅ 全绿

```
A（R1 红点·标量）: Record m 含 '__proto__'='v2' → ok:true | keys=["normal","__proto__"] | hasOwn=true | val='v2' | 原型完好(true)
B（R1 红点·对象）: 嵌套 map 值 → ok:true | keys=["__proto__","normal"] | 原型未被劫持(Object.prototype) | JSON 往返含键=true | 往返值={"x":"y"}
D（对照回归）    : plain 值 own '__proto__' 键仍保留（copyPlainValue 路径无回归）
E1（扩展）       : Record 形 ROOT 顶层（walk Record 分支根位）→ hasOwn=true | val='top'
E2（扩展）       : union 全软拒回退成员 0（Record 形）路径 → u keys=["__proto__"] | hasOwn=true
F（扩展）        : 键序 ["b","a","c"] 插入序保持；同输入两次输出逐字节相同
```

E1/E2 为本轮新增探针：覆盖 Record 分支的两个间接触达路径（ROOT 直下 + union 出口 3 回退），与 A/B 同走 `:106` 修复位——全部闭合。**F-1 的三个可观测病灶（静默丢键 / 原型劫持 / JSON 蒸发）零残留。**

### 3. SA6 回归锚真实性——✅ 修复前真实红（断言红，非构造性红）

本轮以暂换旧实现方式独立复验（换前快照 / 跑后立即还原，`git diff` 确认零残留）：

```
$ git show 8b49798:packages/doc-runtime/src/extract.ts > <worktree>/.../extract.ts   # 修复前状态
$ pnpm exec vitest run packages/doc-runtime/test/extract-record-keyspace.test.ts --passWithNoTests=false
  × 标量值用例 → AssertionError: expected false to be true（Object.hasOwn 位）
  × 嵌套 map 用例 → AssertionError: expected false to be true
  Test Files 1 failed (1) / Tests 2 failed (2) / EXIT=1
$ <还原修复版> && git diff --stat packages/doc-runtime/src/ → 无差异
```

- 2 用例断言全部锚定公共接缝可观测输出（Object.hasOwn / Object.keys / 索引读值 / getPrototypeOf === Object.prototype / JSON.stringify 往返），与 R1 回流指令的三断言（own 键保留 + JSON 往返含键 + 原型未劫持）逐条对应，且额外锚了键值保真。
- §1.7 合规：无 readFileSync；唯一 `toContain` 作用于 `JSON.stringify(snapshot)` 运行时输出串（非源码文本）。
- 1.4 vitest 触发性自检：include glob `packages/*/test/**/*.test.ts` 覆盖，本轮全量实跑确认 `✓ extract-record-keyspace.test.ts (2 tests)`（第 51 个文件）。

### 4. 设计 R2.2 落文（commit 7646f06）——✅ 逐条兑现，且额外收口两项 R1 遗留

| R1 要求 | 落实 | 核验 |
|---|---|---|
| 快照 map 构造安全写入纪律落文 | ✅ D13 新决策行（统一纪律 + 被否方案栏记录「赋值式 + 仅 Record 局部修」原案证伪）+ B16 边界条目（含端到端零信号论证）+ §4.3 全景表 Record 行标注 + §4.3 伪代码 putSnapshotKey×2 回写 + §11 ALLOW 追加回归锚文件 | diff 逐行核对，与实现 `:106/:117` 一一对应 |
| §4.4 守卫序回写（F-2） | ✅ 伪代码守卫移至 memo.get 之前 + 「守卫顺序」叙述条（memo-first 死循环机理 + A-3 探针证据 + 合法输入等价论证）+ D8 更新 + 「镜像关系修正」条（vfsl walkRefChain 同患登记为后续票观察，DENY 不动） | 与实现 `:232-246` 逐行一致 |
| F-3（throwing getter）裁量 | ✅ **B17 落文：维持 E100 归类**（响亮不静默、可达面极窄、扩词收益近零；message 含原异常文案可排障） | 与 R1 F-3「不阻塞、SA1 裁量」处置一致——SA4 接受该裁量 |
| §9 证据链 | ✅ 新增「SA4 A-1~A-5」证据行（F-1 复现/F-2 环守卫/E100 八探针/基线） | — |
| 自检附注 | ✅ 「快照写入纪律」五处统一（D13/§4.3×2/§4.6/B15-B16）+「ref 守卫序」三处统一 | grep 复核无赋值式/旧序残留 |

### 5. Scope 复核（本轮新增 4 commits）——✅ 全部在辖

`01eb5d5`（wiki：R1 评审+派遣日志）/ `7646f06`（wiki：设计 R2.2+派遣）/ `8b49798`（测试锚 + wiki）/ `dc9342b`（wiki：派遣）——生产代码改动仅 79319a4 的 `extract.ts`（ALLOW）；`extract-record-keyspace.test.ts` 已由 R2.2 §11 ALLOW 显式收编（SA6 owned）；其余 wiki 均白名单。BLACKLIST 零命中。

### 6. 基线独立复现——✅ 与总控亲验一致

```
$ pnpm test      → Test Files 51 passed (51) | Tests 709 passed (709) | Type Errors no errors | EXIT=0
$ pnpm typecheck → 六包串联（含 doc-runtime）| EXIT=0          （/tmp/sa4-r2-verify.log，2026-08-22 13:34）
```

## R2 结论

- **F-1 闭合确认**：唯一可达向量（Record 分支）修复 + 两处防御纵深统一 + 快照键写入面零赋值式残留；R1 三病灶（静默丢键/原型劫持/JSON 蒸发）经 6 组探针（A/B/D/E1/E2/F）零残留；INV-8 确定性与既有行为零回归（709/709）。
- **回流四件套全部兑现**：SA3 实现（一行级 + 助手）、SA1 设计（D13/B16/B17 + §4.3/§4.4 回写）、SA6 回归锚（真实红→绿）、基线（51/709 + typecheck）。
- R1 已裁决项（D9 家族接受 / R-2 改判接受 / 其余门禁通过）不重开、无新触发。
- **动态审核重点更新（交 SA7）**：R1 清单第 1 项**已闭合**（本轮代验，SA7 免做）；第 2–5 项仍有效（跨端组合只读性 / 大文档性能面 / Node 20 矩阵证据摘录 / B17 E100 message 可排障性——SA7 按 CI run log 摘录 doc-runtime 四文件的 vitest 触发证据即可）。

**Verdict: pass** —— F-1 修复面复审通过；SA7 可进入动态验证。

---

## 修订轮 R3 评审（2026-08-22，PR #81 review P1，commit f8f2ddd）

**Date**: 2026-08-22
**Verdict**: **reject**（单项 REJECT 级发现 F-R3-1：`packages/doc-runtime/package.json` 位于设计 §11 DENY LIST（「不改」），本轮 version bump 0.1.0→0.1.1 修改了该 DENY 文件而 R2.3 设计回写未修订 §11——scope 治理门禁未走完。**修复代码本身零缺陷：全部 8 个技术维度通过、29/29 对抗探针全绿、三线基线独立复现一致；回流目标 = SA1 一行级 §11 touch-up，SA3 零返工，复审仅需针对该设计 diff**）

**被审对象**: commit f8f2ddd（fix(doc-runtime): reject non-finite numbers in plain value domain）7 文件——`extract.ts`（number 拆支 + docblock）、`package.json`（0.1.0→0.1.1）、`extract-nonfinite-number.test.ts`（新增 8 用例）、wiki 四件（SA5 报告 / 设计 R2.3 / 简报锚记录 / dispatch log）。
**审查范围**: 发布后修订轮（owner review P1）修复面全维度静态验尸 + 对抗探针 + 基线独立复现；R1/R2 已裁决项不重开。

### 门禁与维度逐项结论

| # | 维度 | 结果 | 证据 |
|---|---|---|---|
| 1 | 修复正确性（伪代码一致性） | ✅ | 设计 §4.6 R2.3 伪代码（:444-452）与实现 `extract.ts:262-269` **逐语句逐字一致**（仅注释排版差异）：`typeof v === 'number'` 拆支 → `!Number.isFinite(v)` → `plainDomainIssue(path, loc, 'non-finite number')`，有限 number 直通；null/string/boolean 维持直通、bigint 分支原位未动；`carrier.ts`/`index.ts` 在 f8f2ddd **零改动**（`git diff f8f2ddd^..f8f2ddd --name-only` 计 0）——D1 两层判定不变式保持 |
| 2 | 修复完备性（单点论证复核） | ✅ | SA5 §5 论证独立复核成立：doc-runtime src 内 `typeof v === 'number'` 仅 carrier.ts:32（粗判层，职责正确）与 extract.ts:262（修复位）；`Number.isFinite` 全包仅 extract.ts:263——**无绕过 copyPlainValue 的 number 通路**（快照值终态仅 xml-fragment `toString()`（字符串，:136）与 leaf/plain 共用细判入口 :141 两条；map/array/Record/union/trialMember 中间构造值全部来自 walk 递归）。嵌套递归 loc/path 纪律正确（探针 C4-C7） |
| 3 | 申报词一致性 | ✅ | `'non-finite number'` 三处同口径：实现 `extract.ts:264` + 文件头 docblock（:12-14）与 copyPlainValue docblock（:256-259）可达性清单；设计 D9②（:34 第六词登记）+ §10 R2/#4 登记块（:677「六词均可达」）+ §4.8 行（:539）+ B18（:619）+ R2.3 回应表；测试 docblock（:16-24 冻结声明 + 备选词否决）。`expected` 恒 `'plain value'`（探针全例复核） |
| 4 | 版本 bump | ✅（实质）/ ❌（治理，见 F-R3-1） | `package.json` version 0.1.1 实核；bump 依据 = SA5 §6 影响面表 + 仓内惯例（vfsl 0.2.0@f07462d、persistence 0.1.2 先例）——但设计 §11 未同步（F-R3-1） |
| 5 | 1.4 vitest 触发性 | ✅ | 根 `vitest.config.ts` include `packages/*/test/**/*.test.ts` 收编新文件（本轮实跑 `✓ extract-nonfinite-number.test.ts (8 tests)`，52 文件含之）；CI `ci.yml:39` `pnpm test` 根 vitest 无 --filter 排除；typecheck 链 6 包含 doc-runtime（`ci.yml:36`）。无 CI 改动需要（与 DENY「ci.yml 零改动」一致） |
| 6 | scope 比对 | ❌ F-R3-1 | 7 文件中 6 件在辖：`extract.ts`（ALLOW）、新测试文件（ALLOW R2.3 追加 :705）、wiki 四件（task_*/bug-* 白名单 + 设计自身）；**`packages/doc-runtime/package.json` 在 §11 DENY LIST（:717「不改」）而 R2.3 回写未解除/登记**——唯一阻塞项。BLACKLIST（package-lock/yarn.lock/.DS_Store/TASK.md/*.bak/.mabf/REPORT）零命中；4 份既有冻结测试文件零触碰 |
| 7 | 对抗探针（29/29 PASS，tsx 独立进程，scratch 已清理） | ✅ | 正向：-0/MAX_VALUE/MIN_VALUE/MAX_SAFE_INTEGER/0.1/42 直通 + JSON 往返 OK（-0 往返签名丢失属 JSON 规范行为，仅内存级 Object.is 断言——SA6 docblock 已登记该边界）；负向：**运行期溢出 1e308\*10、MAX_VALUE\*2、0/0、Infinity-Infinity、Number("x")、Math.sqrt(-1)** 六种非字面量产生路径全拒（path ['n'] / expected 'plain value' / actual 'non-finite number'）；位置面：Record 值位 ['bad']、union 成员位 ['u','a']、嵌套 Record ['m','k','x']、数组套数组 loc [1][1]、深层对象 loc .a.b.c 全锚定正确；fail-fast 单 issue 首违规即止（[1,2,∞,NaN,-∞,3] → 单 issue loc [2]）；跨端：Infinity/运行期溢出/plain 子树 -Infinity 经 encode→apply 后远端全拒；零误伤：string "NaN"/"Infinity"、boolean、null 直通不变，bigint 仍报 'bigint'、undefined 数组元素仍报 'undefined'；**D1 复证：错位位（Y.Array/Y.Map 位放 NaN）actual 恒 'plain value' 五值词汇表**（探针 F1/F2） |
| 8 | 测试质量（§1.7）+ 红灯真实性 | ✅ | 新文件 8 用例零 readFileSync、`toContain` 仅作用于 issue.message 运行时输出；断言全部锚公共接缝。**红灯真实性独立复验**：暂换修复前实现（8869ade）→ 新文件 **6 failed / 2 passed（EXIT=1）**，与 SA6 记录逐字一致（行为级红：`expected true to be false`，非构造性红）；还原零残留（sha1 前后一致 7982a84d，`git status` 清洁）。owner 8 条必补逐条映射：#1 leaf NaN / #2 object Infinity（message 含 内部位置 [1].x）/ #3 array -Infinity / #4 helper 内建 ok:false+单 issue+四字段+非 internal 双守卫 / #5-6 词断言 / #7 path 锚 ['n']/['arr'] / #8 正向对照+往返全等（+0/-0/0.1 边界加固 + 三值分列 + 跨端加固） |
| — | 契约涟漪（§1.6） | ✅ 无 | `copyPlainValue` 为私有函数；公共接缝 `extractYjsSnapshot` 类型签名/结果联合零变化（行为变化即修复目的）；全仓 caller = index.ts re-export + 测试（vfsl validate.ts:640 为注释文字引用），无涟漪面 |
| — | 基线独立复现 | ✅ | doc-runtime 包 5 文件/48 用例 EXIT=0；全量 `pnpm test` 52 文件/717 用例/Type Errors no errors EXIT=0；`pnpm typecheck` 6 包串联 EXIT=0——与总控亲验（.mabf-bg/ctl-verify.log）逐位一致（/tmp/sa4-r3-{docrt,full,tc}.log） |
| — | 过度设计 | ✅ | 修复半径 = 拆支 5 行 + docblock 2 处 + 版本 1 行，与根因（单分支缺值域守卫）同阶；无投机抽象 |

### 发现清单

#### F-R3-1【REJECT · scope-governance】DENY 文件被修改而 §11 未同步修订

- **事实**：`packages/doc-runtime/package.json` 列于设计 §11 **DENY LIST**（:717「SA6 脚手架已满足全部需求（deps/exports/scripts），不改」）；commit f8f2ddd 修改其 version 字段（0.1.0→0.1.1）；**R2.3 设计回写未修订 §11**（DENY 项未加注、ALLOW 未登记版本 bump 例外；设计全文 grep「0.1.1/版本/bump」零命中）——§11 记录与分支现实自相矛盾。
- **bump 本身有据**：SA5 §6 影响面表明列「是（版本）0.1.0→0.1.1（patch）」+ dispatch R4 指令「bump 0.1.1」+ 仓内惯例（版本随实质变更 commit 同步）。缺的不是行为，是**设计治理闭环**：设计自身的 pnpm-lock DENY 项示范了正规出口（「若实现期确需变更，必须回总控显式扩展本清单」）——package.json 未走同等扩展。
- **流程根因**：dispatch R3 给 SA1 的派遣词仅含「D9② 申报词登记 + §4.6 伪代码缺口」两项，**漏派 §11/version 项**（SA5 §6 列了、派遣词没带）——构成缺口在总控派遣，非 SA1/SA3 执行走样。
- **判 reject 依据**：skill §1.1 硬门禁对 DENY 文件零豁免；R1 F-5 先例已对本文件的 DENY 出现做过登记（当时以「SA6 脚手架首次落仓、内容逐字段一致」豁免——该理由本轮**不适用**：这是对已跟踪文件的内容修改）。若放行，DENY 门禁将退化为「dispatch 提过即可绕过」。
- **回流（半径一行级）**：**SA1** 设计 §11 touch-up——DENY 项改注（如「deps/exports/scripts 不改；version 随实质变更 commit 同步 bump——R2.3: 0.1.0→0.1.1，SA5 §6/仓内惯例」）或等效 ALLOW 例外登记，并在 R2.3 回应表补一行；**SA3 零返工**（代码与 commit 不需任何改动）；**SA4 复审**仅针对该设计 diff（分钟级）。总控后续派遣请携带 §11 项。

#### 登记（非阻塞）

- **N-R3-1（边界注记）**：`-0` 是有限值故直通（owner 立法形态 = 仅 `Number.isFinite` 守卫，正确执行）；`JSON.stringify(-0)==='0'` 使严格 Object.is 意义上往返不恒等——SA6 测试 docblock 已显式登记该边界（-0 仅内存级 Object.is 断言），owner 必补 #8 的「往返全等」以有限值常规域解读成立。如 owner 未来要求 -0 域断言属新立法，非本轮缺陷。
- **N-R3-2（正向记录）**：R2.3 设计回写质量高——D9②/§10「六词均可达」/§4.6 伪代码逐字同步/§4.8 行/B18/§11 测试收编/R2.3 回应表 + 自检五处口径一致（grep 11 处分布逐条核符），历史评审记录（R1/R2/R2.1/R2.2）零改写。

### 动态审核重点（交 SA7）

1. R1/R2 清单第 2–5 项仍有效（跨端组合只读性 / 大文档性能面 / Node 20 矩阵 / B17 E100 message）。
2. 本轮新增：CI run log 摘录 `extract-nonfinite-number.test.ts` 的 vitest 触发证据（Node 20/24 双矩阵）——静态面已由本轮实跑确认（本地 48/48），SA7 补 CI 侧证据即可。
3. F-R3-1 修复（§11 touch-up）为纯文档，无动态面。

**Verdict: reject** —— 唯一阻塞项 F-R3-1（§11 DENY 治理未闭环），代码修复面全维度通过（探针 29/29、红灯真实性 6R/2G 复验、三线基线一致）；SA1 一行级 touch-up 后即转 pass。

---

## 修订轮 R3.1 复审（2026-08-22，F-R3-1 闭环验证，SA1 设计 §11 touch-up）

**Date**: 2026-08-22
**Verdict（R3.1，取代 R3）**: **pass**
**复审范围**: 仅 F-R3-1 回流产物——设计文档工作区 diff（`git diff --unified=0` 实核**恰 2 hunk**，均在 `wiki/raw/task_doc-runtime-extract-yjs-snapshot_design.md`）；R3 已裁决的技术维度（探针/基线/词表/触发链）不重开。

### 逐项核验

| 检查项 | 结果 | 证据 |
|---|---|---|
| Hunk 1（§11 DENY :717）改注内容 | ✅ 兑现 R3 回流处方 | DENY 项由「不改」改注为「**deps/exports/scripts 不改** + **version 字段例外**（R2.3/SA4 R3 F-R3-1 改注）：随实质变更 commit 同步 bump——本轮 0.1.0→0.1.1」——与 R3 F-R3-1 回流指令逐点对应（守卫保留 + 例外登记 + 出处 SA5 §6/仓内惯例三先例 + hard gate） |
| Hunk 2（R2.3 回应表 :773 表尾追加行） | ✅ | 四列结构（要求/是否落实/修订位置/摘要）与表头一致，落位在「owner 必补 8 条」行后、「R2.3 自检」段前（表成员正确）；显式引用 F-R3-1 为回流来源并如实转录 R3「修复代码零缺陷、SA3 零返工」判定 |
| 治理与实况一致性 | ✅ | `package.json` 实况 `version: 0.1.1`（grep 实核）；f8f2ddd 中该文件 diff **仅 version 单行**（-0.1.0/+0.1.1）——「deps/exports/scripts 不改」守卫声明与 commit 实况吻合，无虚假承诺 |
| 历史零改写 | ✅ | `git diff --unified=0` 全量仅 :717 改注 + :773 追加两处；R1/R2/R2.1/R2.2/R2.3 既有文本零触碰 |
| SA3 返工面 | ✅ 零 | 本轮 touch-up 仅 wiki 单文件，无业务代码/测试/package.json 改动 |

### F-R3-1 闭合判定

DENY 治理矛盾消除：§11 记录与分支现实（package.json 已 bump 0.1.1）一致化，version 例外经显式登记 + 出处留痕 + 回应表审计行三重闭环；DENY 门禁实质（deps/exports/scripts 守卫）未削弱——「dispatch 提过即可绕过」的先例风险未成立。R3 全部技术面判定（8 维度通过 / 探针 29/29 / 红灯真实性 6R/2G / 三线基线一致）维持有效。

**Verdict: pass** —— F-R3-1 闭环确认；PR #81 owner review P1 修复链（f8f2ddd + 本 touch-up）静态面收口，SA7 可进入动态验证（R3 动态审核重点清单仍适用：R1/R2 第 2–5 项 + 新测试文件 CI Node 20/24 触发证据摘录）。
