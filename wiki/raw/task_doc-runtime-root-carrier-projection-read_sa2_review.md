# SA2 攻击评审报告 — doc-runtime：schema-independent ROOT 载体投影读取（issue #86 / Phase 2）

**Date**: 2026-08-23（R1）；2026-08-23（R2 复审）；2026-08-23（R3 复审，见文末）
**Reviewer**: SA2（破壁人 / 攻击评审）
**被审对象**: `wiki/raw/task_doc-runtime-root-carrier-projection-read_design.md`（R1 版 553 行 → R2 版 611 行 → R3 版 636 行）
**约束基准**: `wiki/raw/task_doc-runtime-root-carrier-projection-read_relevant_decisions.md`（ADR-0008 直接治理 + ADR-0007 仍生效条款 + ADR-0003/0004/0006 + CONTEXT.md）
**Verdict**: R1 = **reject**（8 攻击点，见下文 R1 存档）→ R2 = **reject**（R1 八点全部核销；新引入 1 个 must-fix 移植锚自相矛盾 + 1 个数字错误）→ R3 = **pass**（R2-1/R2-2 全部核销 + 三 INFO 落实 + detached 三形态锚；三轮攻击无新缺陷、无回退。**当前生效裁决以文末「R3 复审」节为准**。pass 仅表示设计通过审查，不替代 SA4/SA7 对实现与活链路的验证）

评审方法：全新视角通读设计 → 逐条对照 ADR 摘录与 SA6 冻结测试（37 例）→ 独立重跑 yjs 13.6.32 行为探针攻击 §8 协议假设（本报告所有「实测」均为 SA2 独立复现，命令可重跑）→ 核对仓库事实（调用面 / 配置 / 行数 / 测试覆盖）。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| 1 | **HIGH（must-fix）** | §4 伪代码 FAIL 哨兵 | `projectValue`/`copyPlainStrict` 的失败哨兵与合法投影值 `null` 碰撞：§4 L320-321 逐字写着 `const r = projectValue(cur, path); if (r === null) return notAllowed(...)`，而 `null` 是完全合法的投影值（冻结 fixture `root.set('nothing', null)`、`arr=[...,null,...]`，copyPlainStrict 的 `string/boolean/null → v` 分支原样返回 null）。§4 标题自封「SA3 实现蓝本」——照抄即 bug：`read(doc,['nothing'])`、`read(doc,['arr',3])`、`[]` 全量读（EXPECTED_ROOT 含 `nothing:null`）全部误判为 PATH_NOT_ALLOWED。冻结测试会兜住（AC1 case1 红），但这是把缺陷蓝图交给 SA3 白烧一轮迭代 | FAIL 哨兵改用独立 unique symbol 或判别联合（`{ kind:'value'; v } \| { kind:'fail'; msg }`），明文禁止 `null`/`undefined` 作哨兵；设计文本同步修正 §4 与 D6 |
| 2 | **HIGH（must-fix）** | E7 借道导航 × A2 注记「天然 attached」（设计自相矛盾 + 静默数据丢失） | 设计 E7 允许导航借道 plain 容器内嵌 Yjs 载体继续下钻；A2 注记却断言「实现直接对 live 容器调用，**天然 attached**」。SA2 实测证伪：**plain 容器内嵌的 Yjs 类型永远是 detached（`v.doc === null`）**，且 detached 读语义是「空 + 告警」：(a) detached `Y.XmlFragment.toString()` 返回 `''`（实测片段 `length=1` 仍产空串）；detached `Y.XmlElement.toString()` 返回 `'<p></p>'`（子内容静默丢弃）；同一片段集成后读回 `'<p>detached-content</p>'`。(b) detached Y.Map/Y.Array 的 `keys()/get()/size/length` 全部返回空，且**每次调用触发 yjs `console.warn('Invalid access: Add Yjs type to a document before reading data.')`**（AbstractType.warnPrematureAccess，lib0 log.warn）。(c) detached 写（set/insert）是**静默 no-op**（不抛）。触发路径（SA6 fixture 纪律明示公共 API 可达）：`root.set('holder',{frag})` → `read(doc,['holder','frag'])` → **ok:true, value:''——非空 XML 片段静默投影为空串** + console.warn 噪声；`read(doc,['holder','ys','x'])` → ok:true undefined（穿一个永远空的容器）+ console.warn。这违反设计自己的 loud 纪律（D4「loud 是唯一不腐败的选择」、AC4 精神「绝不静默丢弃」），且合法 ok:true 路径带可观测副作用 | 二选一（SA2 倾向 a）：**(a)** D2/D6 新增 detached 载体守卫：ymap/yarray/xml 载体在导航与投影期检测 `v.doc === null`（实测 O(1)，`m.doc===d` 对集成类型成立）→ PATH_NOT_ALLOWED loud（『detached Yjs 载体（未集成 doc）不可读』）；E7 收窄为「仅集成载体可借道」（别名集成类型借道读真实数据已实测可行，E7 语义保留）。**(b)** 若坚持全放行：必须新增 E19/E20 边缘裁决，明文记录 detached 读=空+console.warn、xml detached 投影内容静默丢失，并在 guards 钉测试。——(b) 保留静默数据丢失通道，与 AC4 精神冲突，不推荐。**冻结测试不受 (a) 影响**（37 例无任何用例借道内嵌载体下钻；badNested/badNestedArray/badText 锚定的都是 plain 容器根 loud） |
| 3 | **MEDIUM（must-fix，事实错误）** | §6.2「不移植的旧锚与其理由」 | 「keyPattern/compilePattern 双参 seam（vfsl 公共面，**已有 vfsl 自身测试覆盖**）」为**假**。实测 `grep -rln "matchPattern\|compilePattern" --include="*.ts"`（排除 node_modules）仅命中：`packages/vfsl/src/index.ts`（实现/导出）、`packages/doc-runtime/src/read.ts`（将重写、import 清零）、`packages/doc-runtime/test/read-logical-value-at-path-supplementary.test.ts`（SUP-5，将删除）。`packages/vfsl/test/` 22 个文件**零命中**。即：删除 supplementary 后，`matchPattern`/`compilePattern` 这一 vfsl **公共接缝的全部测试覆盖静默消失**（SUP-5 是其唯一签名锁），设计以错误事实为依据放行覆盖倒退 | 将 SUP-5（supplementary L206-217，与 read 签名完全无关的纯 vfsl seam 断言，含 `@ts-expect-error` 三参负锁）移植进 guards 新文件或迁至 `packages/vfsl/test/`；修正设计表格理由句 |
| 4 | **MEDIUM（must-fix，移植清单精度）** | §6.2 移植清单 | 三处照抄即写错/写丢：(i) **L299 对照锚期望翻转**——原锚 `['nope'] → PATH_NOT_ALLOWED` 是 schema-aware 拒绝；新红线下 `['nope']` → `ok:true undefined`（AC2 冻结锚定）。设计只写「双参版」，未指出该锚必须换真拒绝路径（如 `['items','0']`/`['title','x']`）；SA3 逐字移植会写出与冻结 AC2 直接互斥的测试。(ii) **「ROOT 不创建」表述不可满足**——新架构 G0→N0 先探针后判段（C1 判定需要段位载体，探针必然先行），拒绝路径同样惰性创建 ROOT；可观测断言（`size===0`、零 update、幂等）仍绿，但「ROOT 不创建」这个锚名错了，须改写为「惰性创建后仍为空 map、零 update 事件、幂等」。(iii) **NaN/±∞ 段守卫锚静默丢失**——supplementary L238-244 `it.each([NaN, Infinity, -Infinity])`（非整数/非法段 → PATH_NOT_ALLOWED）既不在 5 行移植表中、也不在「不移植理由」段；该锚完全载体无关、冻结 AC2 只锚了 -1/1.5，删 supplementary 后 NaN/±∞ 段零覆盖。另：F2 家族原 11 变体（Set/Map/BigInt/function/array-like 等）移植表只列 4 个，未声明「精选」还是「全量」 | 移植表逐锚给出新期望与 fixture 形态；补 NaN/±∞ it.each 移植行；F2 家族声明全量或精选清单；「ROOT 不创建」改写为可观测事实表述 |
| 5 | **MEDIUM（should-fix，依据链不严）** | §8 A1 证据限定词缺失 | A1 声称「`Y.Array.insert(0,[undefined])` 抛错」——SA2 实测：**仅 attached（已集成 doc）成立**（复现同消息 `Cannot read properties of undefined (reading 'constructor')`）；detached 数组同调用是**静默 no-op 不抛**（length 仍 0，不产生 undefined 元素）。D4「Y.Array 在界 undefined = 防御分支」的**结论**两情形下都仍成立（detached no-op 造不出元素），但论据未区分 attached/detached，SA4 复核时会产生假矛盾 | A1 依据补「attached」限定词；与 #2 的 detached 裁决合并成一条完整的边缘表行 |
| 6 | **LOW（should-fix）** | §6.2 标题 | 「7 文件，2132 行」实测为 **1479 行**（`wc -l`：423+52+195+326+128+48+307；分文件行数全对，仅总数错） | 改正总数 |
| 7 | **LOW（should-fix，边界声明）** | INV-R4「全局零 accessor 执行」 | 对 **Proxy 载体不成立且不可能成立**：plain 容器可经公共 API 引用原样置入 Proxy 对象；`Object.keys`/`getOwnPropertyDescriptor`/`getPrototypeOf`（D2 proto 守卫、D5 助手均调用）全部触发 trap = 用户代码执行。设计未划界，INV-R4 的绝对化措辞会被 SA4/SA7 拿来误判 | D5/D6 补一句边界：零执行承诺限于普通对象语义载体；Proxy trap 属调用方数据自带代码，超出读取契约（trap throw → 顶层 E100 结构化收编，不外抛）。不需要实现变更 |
| 8 | **LOW（知会）** | 调用面注释失真 | `packages/vfsl/src/index.ts:86` 注释宣称 matchPattern「由 doc-runtime readLogicalValueAtPath 的 Record 键许可判定」消费；本任务后该消费消失，注释失真。DENY 名单下可接受 | 设计 §7 DENY 段如实标注「已知将失真的注释，留独立任务」即可，不要求本任务改 vfsl |

**未构成攻击点、经独立验证成立的设计裁决**（SA4/SA7 可直接复用证据）：E1/E2 undefined 非对称吸收（实测 yjs `toJSON` 确实省略 undefined 键：`keys:["a","u","b"], toJSON:{"a":1,"b":2}`；JSON 域等值论证成立）；D5 键空间统一（实测索引读执行 getter=1 次、descriptor 读 0 次、Object.keys 0 次）；D3 的 -0/2^53（实测 `ya.get(-0)`/`arr[-0]` 归一 0，`getOwnPropertyDescriptor(arr,-0)` 命中 own '0'）；E8/E9 `__proto__`（实测 Y.Map 键 `has=true get=1`）；E10 循环引用（实测纯 JS 深拷贝循环 → RangeError 可捕获）；E12/E13（实测 XmlHook.prototype instanceof Y.Map=true；顶层 null-proto set 抛 `Unexpected content type`、嵌套可读）；D8/E100 单 code 收编（冻结联合只有 PATH_NOT_ALLOWED，SA8 已背书许可式读法，与现网 read.ts 一致）；D7 拷贝器分叉（extract 的 accessor 执行缺陷由 SA2 独立复现：`live['secret']` 计数器 +1——DENY extract.ts + 已申报潜在缺陷的处置正确）；D11 并发模型（同步栈原子观察，ADR-0008 明文读取不进 sequencer）；§6.2 删除 7 遗留文件的授权链（简报交接节明文 + ADR-0008 取代声明，成立）。

---

## 协议假设依据审查

- **章节存在性**：§8「协议假设依据 (Protocol Assumption Evidence)」存在，13 条（A1–A13），含依据类型栏与依据内容栏。✅
- **依据可验证性（SA2 独立重跑结果）**：SA2 于 worktree 内 yjs 13.6.32 / Node 24 独立复现全部探针：
  - **验证为真**（命令形态：`cd packages/doc-runtime && node -e "<探针>"`，与设计同源可重跑）：A2（attached XmlFragment/XmlElement toString 语义串）、A3（XmlElement instanceof XmlFragment / XmlText instanceof Text / **XmlHook instanceof Y.Map 均 true**）、A4（`set('u',undefined)` → `has=true, get=undefined, keys含u, toJSON省略`）、A5（ROOT=Y.Array 时 getMap 抛 `Type with the name ROOT has already been defined with a different constructor`；空 doc getMap 零 update、同引用幂等）、A6（索引读执行 getter、descriptor 读零执行）、A7（identity 保留）、A8、A9、A10、A11（attached 抛/detached 语义见 #5）、A12、A13（ci.yml node 20/24 矩阵、vitest include、tsconfig.typecheck.json 均核实）。
  - **证伪/不完整**：A1 缺 attached 限定（#5）；A2 注记「天然 attached」在 E7 借道场景下事实错误（#2，核心攻击点）。
- **「应该/通常/预计」类无据推断**：未发现——§8 各条均以实测/源码引用立据。
- **实测声明未贴输出**：A10 依据栏只写「探针 C 输出 → D3」未贴正文（SA2 已代为复现为真）；按立法精神应补贴，列入修订小项。
- **设计期探针脚本「不留产物」**：可复现性依赖命令描述而非脚本文件，SA2 全部成功重跑，可验证性成立。

## 错误处理链路审查

- **静默失败检查**：发现一处真正的静默失败家族成员——**#2 detached Yjs 载体静默空投影**（ok:true + 空串/空容器 + console.warn 噪声），正是本任务 AC4「绝不静默丢弃/转换」要封死的行为类别出现在设计自己的补充裁决里；必须修复。其余全路径（G0/E100/三态联合）无「无结果 + 无反馈」路径：顶层 try/catch + notAllowed 守卫（`Array.isArray(path) ? [...path] : []`）闭环，catch 块内无二次抛点。✅
- **状态闭环检查**：纯同步函数、零异步面、零模块级状态（INV-R10）——无 exStatus 类状态机，N/A。✅
- **降级路径检查**：无外部服务依赖。唯一「降级形态」候选逐一审查：D9 ROOT 缺席 → `{}` **不是伪降级**——ADR-0008 立法意图正是「Runtime 发布后读取立即可用」（P0 前开放读），空 doc 是合法正常态且被 AC1 case5 锚定；E4/E5/E6 键空间外吸收是 AC3 的立法意图本体（accessor/原型/non-enumerable 即「不在可读键空间」），非 bug 掩盖；probeRoot 第四级全失败 → E100 loud 形态。✅
- **虚假降级识别**：按「该条件在正常流程是否应恒满足」标准过筛——D9、E4/E5/E6 均为正常可达态而非前提缺失，不判伪降级；**E7 借道 detached 载体（#2）**是唯一命中项：调用方数据里存在 Yjs 载体是「合法但不可读」的状态，设计将其伪装成「空容器吸收」，属 bug 级边缘被吸收语义掩盖，已列 must-fix。
- **用户可感知性**：失败一律 `{ok:false, code, path, message}` 同步返回（message 非契约字段但恒非空）；唯一可编程区分 internal bug 的面是 message 的 `DOCRT-E100:` 前缀（冻结单 code 使然）——建议 guards 钉一例防 SA3 丢前缀（见红线测试 #10）。

## 红线测试思路（SA3 落地 guards 新文件 `read-logical-value-at-path-guards.test.ts` 的补充编写方向）

1. **#1 哨兵碰撞**：`read(doc,['nothing'])` → `ok:true && value === null`（显式断言非 undefined：`expect(r.value).toBe(null)`）；`read(doc,['arr',3])` → `ok:true null`；`[]` 全量读已由冻结 AC1 兜底，guards 再钉单键形态。
2. **#2 detached 裁决（按修订方案 a）**：fixture `root.set('holder',{frag: <有子元素的 Y.XmlFragment>})` → `read(doc,['holder','frag'])` → `ok:false` + path 回显；`{ys:new Y.Map()}` 借道 `['holder','ys','x']` → `ok:false`；**别名集成对照**：`m=root.set 后再 set 进 plain 容器` → `['holder','inner','k']` → `ok:true, 1`（证明 loud 是 detached 判别而非「内嵌即拒」）。若 SA1 改选方案 b：断言改为 `ok:true, value===''` + `vi.spyOn(console,'warn')` 断言告警被触发（把噪音显性化）。
3. **#3 seam 覆盖**：SUP-5 原样移植（`compilePattern`+`matchPattern` 双参、`@ts-expect-error` 三参负锁），放 guards 或 vfsl 测试目录。
4. **#4 移植精度**：对照锚改用 `['title','x']` → `notAllowed(['title','x'])`，另加 `['nope']` → `expectUndefinedValue`（双保险防误移植）；补 `it.each([NaN, Infinity, -Infinity])` 段 → PATH_NOT_ALLOWED；零副作用锚断言改为「`getMap('ROOT').size===0` + update 计数 0 + 重复调用 `toEqual` 幂等（含 message）」。
5. **#5/#2 合并边缘表**：detached `Y.Array.insert(0,[undefined])` 不抛且 length 不变（钉住「防御分支」结论的两情形成立）。
6. **循环引用**：`cyc.self=cyc` 经 `root.set('cyc',cyc)` → `read(doc,['cyc'])` → `ok:false` 且 `message` 匹配 `/^DOCRT-E100:/`（同步不抛 + 前缀保留双锚）。
7. **运行时野段**：`['cfg', Symbol('x')]`、`['cfg', {}]` → C1 零外抛（E17 无测试覆盖）。
8. **E8/E9 键**：Y.Map 键 `'__proto__'` 与 plain object own `'__proto__'` 数据键 → 正常读写且输出对象 `Object.getPrototypeOf(out)===Object.prototype`（防原型劫持回归）。
9. **原型守卫**：`root.set('d', new Date())` → `['d']` loud / `['d','x']` loud；`['d']` 全量读（[]）亦 loud。
10. **Proxy 边界（若采纳 #7 声明）**：trap-throw proxy 置入 → `read(doc,['p'])` → `ok:false` 结构化返回、不外抛。

---

## 复审放行条件（SA1 修订清单）

must-fix：#1（哨兵）、#2（detached 裁决，a/b 二选一）、#3（SUP-5 去向 + 理由句更正）、#4（移植表三处修正）。
should-fix：#5、#6、#7、#8（随 must-fix 一并小改即可）。
总体架构（载体驱动重写、D2 两层分类器、D5 键空间统一、D7 拷贝器分叉、D10 崩溃边界、§6.2 删除授权链、§9 调用面审计——生产 caller 为零已经 SA2 独立 grep 复核）**不需要返工**；修订均为局部裁决与文本修正。

## 验证证据（SA2 独立实测，命令+结果摘录）

- 探针环境：worktree `packages/doc-runtime` 下 `node -e`（yjs 13.6.32，Node 24.13.0）。
- #2 证据：detached XmlFragment（length=1）`toString()` → `''`；集成后同引用 → `'<p>detached-content</p>'`；detached XmlElement → `'<p></p>'`；detached Y.Map `keys()` → `[]`、`get()` → `undefined`、伴随 `Invalid access: Add Yjs type to a document before reading data.` console.warn；detached `set('k',1)` 后读仍空；别名集成 map 借道 `keys=['k'], get k=1`。
- #1 证据：冻结测试 L181 `root.set('nothing', null)`、L216 `arr=[1,'two',true,null,{n:'obj'}]` 与设计 §4 L320-321/L337-338 字面冲突（纯文本对照）。
- #3 证据：`grep -rln "matchPattern" --include="*.ts" .`（root，排除 node_modules）→ 仅 `doc-runtime/src/read.ts`、`doc-runtime/test/read-logical-value-at-path-supplementary.test.ts`、`vfsl/src/index.ts`；`grep -rln "compilePattern"` 同集合；`ls packages/vfsl/test/` 22 文件零命中。
- #4 证据：supplementary L162-180（SUP-3 断言形态）、L238-244（NaN/±∞ it.each）、L299-306（对照锚 `['nope']` → notAllowed）；设计 §6.2 移植表逐行对照。
- #5 证据：attached `arr.insert(0,[undefined])` → `TypeError: Cannot read properties of undefined (reading 'constructor')`；detached 同调用 no-throw、length=0。
- #6 证据：`wc -l` 7 文件合计 1479。
- 仓库事实：`.github/workflows/ci.yml` matrix `node: [20, 24]` ✓；`vitest.config.ts` include `packages/*/test/**/*.test.ts`、typecheck 仅 `*.test-d.ts` ✓；root `package.json` typecheck 逐包 `tsc -p`（含 doc-runtime）✓；`pnpm-lock.yaml` yjs 13.6.32 ✓；`scripts/` 目录不存在 ✓；生产 caller 零（`git grep readLogicalValueAtPath` 命中仅文档/注释/导出/实现/测试）✓；materialize.ts 不 import read.ts ✓；行为测试 `it(` 计数 33 ✓。

---
---

# R2 复审（2026-08-23）—— 已被 R3 复审取代（verdict: reject，2 攻击点；R3 已全部核销）

**被审对象**: `wiki/raw/task_doc-runtime-root-carrier-projection-read_design.md` **R2 版（611 行，「R2」标注 53 处）**
**复审方法**: 逐条核销 R1 攻击点（对照 R2「SA2 反馈逐条回应」表与正文实际修订，逐处核对无虚报）→ 对 R2 新引入内容（ProjectOutcome 判别联合、detached 载体守卫、SUP-5 移植、移植清单重写、Proxy 划界、G0 前缀修订）执行二轮攻击 → 补充探针（destroyed doc / 别名集成判别 / vfsl test 计数 / 冻结 fixture 零误伤复扫）。

## Verdict: **reject**（单点 must-fix）

R1 八点全部落实且质量高（含一项超出要求的主动加固）；新机制经二轮攻击全部成立；但移植清单重写时**新引入一处照抄即红的自相矛盾锚**（R2-1）+ 一处数字错误（R2-2）。修复面合计两行文本，不动任何架构与机制——预计 R3 一轮即过。

## R1 攻击点核销表（#1–#8 + 协议小项 A10）

| R1 # | 核销 | 核销依据（R2 文本 + SA2 复核） |
|---|---|---|
| #1 FAIL 哨兵 × null 碰撞（HIGH） | ✅ | D6「失败通道记号」段确立 `ProjectOutcome = {kind:'value'; v} \| {kind:'fail'; msg}`，明文禁 null/undefined 哨兵；§4 伪代码改 `if (r.kind === 'fail')` + `return { ok:true, value: r.v }`（注释明示 r.v 可为合法 null）；助手区注明 NONE/VIOLATION 仅存在于键空间/下标层、与投影值域不混淆；guards 新增 `['nothing']`/`['arr',3]` → ok:true null 碰撞锁——记号/蓝本/锚三层闭环 |
| #2 detached 载体静默空投影（HIGH） | ✅ 方案 a | D2 新增 `detached` 载体行（Yjs 家族 ∧ `v.doc === null`，导航+投影统一前置判别）+ §2 架构图 + §4 case 'detached' + D8 C3 模板 + INV-R13 + E7 收窄「仅集成载体可借道」+ E19/E20/E21 + A2 错误注记撤回归档 + A14 实测入档 + guards detached 锚与别名集成对照锚。SA2 零误伤复核：经 probeRoot 到达的容器恒 attached；`root.set` 直存的 Yjs 子类型 yjs 自动集成（R1 Q5 探针）；别名集成 `doc !== null` 借道读真实数据（R1 T1 + 本轮 V3）；冻结 fixture 的一切内嵌 Yjs（badNested/badNestedArray/badText）锚定在 plain 容器根 → copyPlainStrict Yjs 家族分支 loud，**不走 detached 守卫**，37 例期望零改变 |
| #3 SUP-5 覆盖倒退事实错误（MEDIUM） | ✅ | 错误句以删除线+更正呈现（附 grep 证据）；SUP-5（双参 + `@ts-expect-error` 3 参负锁 + expectTypeOf）移植进 guards 移植清单独立行；「不移植」段同步更正。guards import `@nomicore/vfsl` 合法（package.json 依赖保留；冻结 test-d import DerivedSchema 同款先例） |
| #4 移植清单三缺陷（MEDIUM） | ✅（但见 R2-1） | (i) 对照锚期望翻转 + `['nope']`→expectUndefinedValue 双保险锚；(ii)「ROOT 不创建」改写为可观测事实表述并注明机制变化；(iii) NaN/±∞ it.each 补移植行；F2 家族声明全量 11 变体 + E100 前缀 sub-family；**主动发现并修复** G0 message 须带 DOCRT-E100 前缀（否则 L288-297 前缀锚不可移植）——超出 SA2 要求的主动加固。**但零副作用锚改写时新引入自相矛盾（R2-1）** |
| #5 A1 attached 限定（MEDIUM） | ✅ | A1 补双情形限定（attached 抛 TypeError / detached 静默 no-op 且 length 不变）；D4 Y.Array 行与 E21 同步；论证与 SA2 R1 探针逐字一致 |
| #6 行数 2132→1479（LOW） | ✅ | §6.2 标题更正；归因自洽（1479+581+72=2132，SA6 新文件误计） |
| #7 INV-R4 Proxy 划界（LOW） | ✅ | D5 Proxy 划界段 + INV-R4 修订（限于普通对象语义载体）+ E22 + guards trap-throw 锚；不增设特判分支 |
| #8 vfsl:86 注释失真（LOW） | ✅ | §7 DENY vfsl 行如实标注「已知将失真的注释，留独立任务」；seam 覆盖由 SUP-5 移植锚保全 |
| 协议小项 A10 | ✅ | §8 A10 补贴实测输出原文 |

**核销结论：R1 全部 8 攻击点 + 1 协议小项 100% 落实，「SA2 反馈逐条回应」表与正文实际修订逐处一致，无虚报。**

## R2 新引入内容二轮攻击结果（成立项）

1. **ProjectOutcome 判别联合**：三值通道（okUndefined 显式 `value:undefined` / `r.v` 合法 null / fail 判别）无碰撞；与导航层 NONE/VIOLATION 哨兵的层级划分（键空间/下标层 vs 投影值域）在 §4 助手注释明文区分——`['nothing']`、`['arr',3]`、缺键三场景在蓝本层面可区分。
2. **detached 守卫完备性**：分类家族（ymap/yarray/xml/text 四类 + AbstractType 变体）全覆盖 `doc===null` 前置判别；unknownShared × detached 的判定顺序歧义无观测差异（同 loud 结局、path 回显同形）；O(1) 属性读不破 D12 预算；D2「零误伤论证」三条（探针到达恒 attached / set 即集成 / 别名集成放行）经 SA2 探针逐条复现为真。
3. **E7/E19/E20/E21 矩阵自洽**：导航借道（集成放行 / detached loud）与投影纪律（copyPlainStrict 对嵌 Yjs 一律拒绝、不问 attached——AC4 锚保持）两条边界在 E7 注记明文划清；detached 三形态（目标 `['holder','frag']` / 借道中途 `['holder','ys','x']` / 路径耗尽 `['holder','ys']`）均由 navClassify 前置判别或 projectValue 守卫覆盖。
4. **G0 message E100 前缀**：与旧 F2 可观测行为逐字一致（旧实现一切非数组 path 经 catch → E100 前缀，R1 复读 supplementary L262-297 确认）；L288-297 前缀锚移植闭环；「E100 独占前缀」旧表述已全文同步修订、无残留矛盾（grep 核对）。
5. **Proxy 划界 / Date 守卫 / `__proto__` 防劫持 / 野段 / 循环引用前缀锁**：guards 新增锚与 SA2 R1 红线思路 1–10 逐条对应齐全。
6. **A14 协议假设**：SA2 独立复现与 SA1 本轮自测一致（detached 读=空+console.warn、detached XmlFragment toString=''、detached 写 no-op、别名集成读真实数据）——依据可被 SA4 重跑。

## R2 攻击点清单（新引入）

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| R2-1 | **MEDIUM（must-fix）** | §6.2 移植清单「零副作用/幂等锚」 | **锚内三重自相矛盾，任一 fixture 选择都至少一条断言必红**：(a) `['title','x']` → notAllowed 的前提是 title 在场且为标量（title 缺席时该路径是 D4 吸收式 `ok:true undefined`，连拒绝都不成立）；(b) 断言 `getMap('ROOT').size === 0` 的前提是 ROOT 为空——与 (a) 互斥（有 title 则 size ≥ 1，`toBe(0)` 必红）；(c) 随读 `['nope']` → ok:true undefined、`[]` → `{}` 强烈暗示空 doc fixture——此时 (a) 崩塌（`['title','x']` → ok:true undefined）。该清单标题自封「期望值逐锚给出，SA3 照此编写**不再回读旧文件**」——把必然红的测试指令直接交付 SA3。性质与 R1 #4(i) 同类（移植锚精度缺陷），且出现在专为修复 #4 而重写的清单里 | 一行改写，二选一：**(i) 空 doc fixture + 拒绝路径改 `[0]`**——number 段下钻空 ROOT Y.Map → C1 段型不符；ROOT 保持空、`size===0`、零 update、幂等、随读 `['nope']`/`[]` 全部成立（最贴近旧 SUP-3 单 doc 全程语义）；**(ii) 保留 `['title','x']` + 有 title 的 fixture**，断言改为「update 计数 0 + `getMap('ROOT').toJSON()` 调用前后 `toEqual`（键集不变）」 |
| R2-2 | LOW（should-fix） | §6.2 处置行 / 回应表 #3（两处） | 「vfsl/test **27** 文件零命中」实为 **26**（`ls packages/vfsl/test/*.test.ts \| wc -l` = 26）。零命中结论不受影响，但数字未经 wc 复核——与 R1 #6 同病 | 更正为 26（结论句不动） |
| — | INFO（建议随 R3 顺带，不挡） | guards fixture 规格 | 移植锚引用 title/items/cfg/holder 等键名（冻结 buildDoc 同构命名），guards fixture 规格未显式给出——SA3 自造命名易漂移，且 R2-1 的矛盾部分源于 fixture 未定 | 移植清单补一句「fixture 与冻结 buildDoc 同构（或给出最小键集规格：title/items/cfg/meta/holder 族）」 |
| — | INFO（不挡） | E16 家族可补充 | destroyed doc：SA2 实测 `doc.destroy()` 后 `getMap('ROOT')` 不抛、类型 `doc` 属性仍非 null、内存数据可读——detached 守卫不误伤、无外抛、行为良性（契约外输入） | 可在 E16 补一句实测注记；不强制 |
| — | INFO（不挡） | E20 推广边缘 | 跨 doc 别名：docB 的集成类型塞进 docA 的 plain 容器 → `doc !== null` → 放行借道，读到 docB 数据。载体驱动 + 别名规则下自然（plain 容器内的 JS 引用即 docA 内存视图内容）；INV-R8 立法意图是「不碰 SCHEMA/META」，不冲突 | 可作已知边缘记录；不强制 |

## R2 协议假设增量审查

- **A14（新增）**：SA2 独立复现一致（R1 探针 C/C2/K/T1/Q1/Q2 + 本轮 V3）——依据类型「设计期实测」名副其实，命令可重跑。
- **A1/A2 修订后表述**与 SA2 R1 实测逐字一致（attached/detached 双情形限定；「天然 attached」错误注记撤回并归档为 A2 R2 更正）。
- **A10** 已补贴输出正文。无新增「应该/通常/预计」类无据推断。

## R2 错误处理链路增量审查

- R1 #2 揭示的静默失败通道（detached 空投影 + console.warn 噪声）已被 INV-R13 + E19 前置守卫在导航与投影两个入口封死，三形态（目标/借道中途/路径耗尽于 detached）全覆盖。
- 伪降级复扫：E19 正是 R1 判定的「伪降级命中项」的正确修复方向（loud 化）；R2 未引入新伪降级。
- R2-1 属测试蓝图自相矛盾（非运行时静默失败），已归入攻击点清单处置；运行时错误处理链路（G0/N0/E100 闭环、catch 块无二次抛点）经复读无回退。

## R2 红灯测试思路增量

1. **R2-1 修正后形态（方案 i）**：空 doc → `read(doc, [0])` → notAllowed(`[0]`) + `getMap('ROOT').size === 0` + `doc.on('update')` 计数 0 + 重复调用 `toEqual` 幂等（含 message）；同 doc 随读 `['nope']` → expectUndefinedValue、`[]` → `{}`（update 仍 0）。
2. **detached 三形态并列锚**（E19 只显式列两形态）：`['holder','ys']`（路径在 detached 上耗尽 → projectValue 守卫）与 `['holder','ys','x']`（借道中途 → navClassify 前置判别）、`['holder','frag']`（目标）三例并列，钉死「导航与投影一律 loud」的「一律」。

## R3 放行条件

- must-fix：**R2-1**（零副作用锚一行改写，方案 i/ii 二选一）。
- should-fix：**R2-2**（27→26，两处）。
- INFO（可顺带，不挡）：guards fixture 规格、E16 destroyed doc 注记、E20 跨 doc 别名记录。
- 其余一切（R1 核销成果 + R2 新机制）**无需再动**；R3 仅需校验上述两点后即可 pass。

## R2 验证证据（SA2 独立实测/核对，命令+结果摘录）

- **R2-1 证据**（§4 蓝本逐行推演）：navClassify(ROOT)=ymap → `['title','x']`：seg `'title'` 为 string 合法 → 空 ROOT 时 `get('title')===undefined` → D4 吸收 → `ok:true value:undefined`（非 notAllowed）；title 在场（='Hello'）时 → cur='Hello' → 下一轮 navClassify → scalar → notAllowed ✓ 但 `getMap('ROOT').size ≥ 1` → `toBe(0)` 必红。任一 fixture 选择三断言无法同时成立。
- **destroyed doc 探针**：`doc.destroy()` 后 `d.getMap('ROOT')` 不抛、`m.doc === null → false`、`keys=["k"]` 内存可读——detached 守卫零误伤、无外抛。
- **别名集成判别**：`{inner: m}.inner.doc === null → false`（借道放行）；`new Y.Map().doc === null`（detached 判别 O(1) 可行）。
- **vfsl/test 计数**：`ls packages/vfsl/test/*.test.ts | wc -l` → **26**（R2 文本两处写 27）。
- **R2 核销核对**：R2 标注 53 处逐类抽查（D2/D5/D6/D8/§4/E7/E19–E22/INV-R4/INV-R13/A1/A2/A10/A14/§6.2/§7/回应表）与 R1 要求逐条对齐，无虚报；冻结两测试文件 `[SA6 owned]` 标注保留、guards 为新增独立文件，冻结契约未收窄。

---
---

# R3 复审（2026-08-23）—— 当前生效裁决

**被审对象**: `wiki/raw/task_doc-runtime-root-carrier-projection-read_design.md` **R3 版（636 行）**
**复审方法**: 按 R3 放行条件逐条核销（R2-1 / R2-2）→ 三项 INFO 与 detached 三形态锚落实核对 → R3 改动区域逐断言推演自洽性（fixture × 期望 × 断言整对推导）→ R3 标记分布扫描确认无意外改动/无回退 → 新事实声明（vfsl/test 目录构成）独立实测复核。

## Verdict: **pass** ✅

R3 放行条件全部满足；R3 新引入内容（拆锚、fixture 规格段、口径注记、三形态锚）经三轮攻击无新缺陷；R1/R2 已核销成果无回退。**放行 SA3 实现。**

> pass 边界：本 verdict 仅表示**设计文档通过攻击评审**——不替代 SA4 静态门禁对实现的逐行核验、SA7 对活链路与全量门禁（typecheck/test/CI node 20/24）的动态验证；SA6 冻结契约（37 例）与 guards 锚是 SA3→SA4→SA7 链路的验收基准。

## R2 攻击点核销表（R3 落实核对）

| R2 # | 核销 | 核销依据（R3 文本 + SA2 逐断言推演/实测） |
|---|---|---|
| R2-1 零副作用锚三重自相矛盾（MEDIUM must-fix） | ✅ 方案 (i)+(ii) 拆锚 | **主锚（方案 i，§6.2 零副作用锚行）**：空 doc fixture（零 set）+ 拒绝路径 `[0]`——SA2 逐断言推演全部自洽：G0 通过（数组）→ probeRoot 惰性创建空 ROOT Y.Map（attached，零 update，R1 探针 P3/R5 实测）→ navClassify=ymap + number 段 → C1 段型不符 → notAllowed(`[0]`)（非空 path 回显，与 E100 `path:[]` 形态正确区分）；`size===0`（空 map ✓）/ update 计数 0（惰性创建零事件 ✓）/ 重复调用 `toEqual` 幂等含 message（纯函数确定性 ✓）/ 同 doc 随读 `['nope']` → ok:true undefined（空 map 缺键吸收 ✓）/ `[]` → `{}`（update 仍 0 ✓）——五断言在同一空 doc 上**同时成立**，矛盾结构消除。**对照锚（方案 ii，独立 it）**：title 在场（'Hello' 标量）→ `['title','x']` → scalar C2 notAllowed ✓；断言 update 0 + `getMap('ROOT').toJSON()` 调用前后 `toEqual`（toJSON 纯读零副作用，R1 探针 S5 同机制）；**明文不断言 `size===0`**（有数据 doc 上不成立——设计自己标注了这一禁令，表明矛盾根源已真正理解而非机械修补）。两锚各自 fixture、各自自洽 ✓ |
| R2-2 「vfsl/test 27」实为 26（LOW） | ✅ 三处全改 + 口径注记 | 处置行 / 「不移植」段 / 回应表 #3 三处均改为「26 个 `.test.ts`」；新增口径注记「目录另有 1 个 `validate-logical-snapshot.contract.ts` 共享文件共 27 条目（SA1 `ls`/`find` 双口径复测）」——SA2 独立实测复核：`ls packages/vfsl/test/ \| wc -l` = **27**、`ls packages/vfsl/test/*.test.ts \| wc -l` = **26**、非 .test.ts 条目恰为 `validate-logical-snapshot.contract.ts`——双口径数字与目录构成**逐项吻合**，「零命中」结论两口径均成立。本轮统计终于完全可复核 |
| INFO：guards fixture 规格显式化 | ✅ | §6.2 新增「guards fixture 规格」段：主 fixture（冻结 buildDoc 同构命名精简子集 title/items/cfg/meta/arr/nothing——逐键核对恰好覆盖对照锚/段纪律锚/野段锚/哨兵锚的全部取键需求，`arr[3]===null` 与 `nothing:null` 两个 null 哨兵位都在）/ 空 doc fixture / 专用 fixture（holder/detached 族、cyc、`__proto__`、Date、Proxy 就地构造）/ 纪律（每 it 自造 doc 零共享 + **update 计数器在 fixture 构造之后挂接**——后者正是对照锚 fixture 有 set 写入情形下的必要细节，防 fixture 写入计数污染读侧断言）✓ |
| INFO：E16 destroyed doc 注记 | ✅ | E16 补注与 SA2 R2 实测逐字一致（destroy 后 getMap 不抛、`doc` 属性非 null、内存可读、detached 守卫零误伤、契约外输入不新增特判） |
| INFO：E20 跨 doc 别名记录 | ✅ | E20 补注（docB 集成类型塞 docA plain 容器 → 放行借道；JS 引用即 docA 内存视图内容；与 INV-R8「不碰 SCHEMA/META」立法意图不冲突）——忠实记录 SA2 观察且论证方向正确 |
| R2 红线思路增量 2：detached 三形态并列锚 | ✅ | guards detached 锚补第三形态：`['holder','ys','x']`（借道中途 → navClassify 前置判别）/ `['holder','ys']`（路径在 detached 上耗尽 → projectValue 守卫）/ `['holder','frag']`（detached 目标投影）三例并列 + 别名集成对照 `['holder2','inner','k']` → ok:true 1——SA2 推演：三形态分别命中导航循环 navClassify 与投影入口 projectValue 两个守卫点，「导航与投影一律 loud」的『一律』被完整钉死；fixture（`{frag: <含子元素的 Y.XmlFragment>, ys: new Y.Map()}` 均为 detached 实例）构造可行（R1 探针 C2/K 同构） |

**核销结论：R2 两攻击点 + 三 INFO + 三形态锚 100% 落实，「SA2 反馈逐条回应」表 R2 复审节与正文实际修订一致；#4 行诚实标注 R2 落地曾被判矛盾并指明 R3 重写位置——修订可追溯性良好。**

## R3 新引入内容三轮攻击结果

1. **拆锚自洽性**：主锚五断言 × 空 doc、对照锚三断言 × title doc——fixture 与断言整对推导（R3 后记自我教训「不能跨锚拼接」已内化），SA2 逐断言独立推演无一必红。
2. **fixture 规格段**：主 fixture 键集恰好覆盖全部引用键（title/items/cfg/nothing/arr + 天然缺席键 nope）；「计数器挂接时机」纪律堵住了对照锚 fixture 写入计数的暗坑；「每 it 自造 doc」与冻结套件 buildDoc 每 it 重建同构。
3. **口径注记**：双口径（27 条目 / 26 .test.ts）与 SA2 实测逐项吻合，且给出了 SA2 未提供的目录构成解释（contract.ts 共享文件）——统计声明首次达到完全可复核。
4. **无回退确认**：R3 标记分布（头部注记/E16/E20/§6.2 四处/回应表两节/后记）全部位于 R3 放行条件范围内；D2/D5/D6/D8/§4/E7/E19/E22/A1/A2/A10/A14/INV-R13 等 R2 定稿区域零改动（grep 扫描 + 抽读核对）；冻结两测试文件 `[SA6 owned]` 标注保留、冻结契约未收窄。
5. **无新缺陷**：未发现 R3 修订引入的任何新矛盾、新事实错误或新静默通道。

**非阻塞观察（记录在案，无需修订，SA3/SA4 可自由裁量）**：
- guards 行数估算仍写「~220 行」——R3 扩充（fixture 规格 + 三形态锚 + 拆锚）后实际可能 ~260；纯估算非契约，不构成缺陷。
- 主锚 `['nope']` 依赖主 fixture（空 doc）天然无该键——与冻结 AC2 的 `['nope']` 锚（有数据 doc 上缺键吸收）形成两个不同 fixture 上的同语义双锚，语义面冗余加固，无冲突。

## R3 验证证据（SA2 独立实测/核对，命令+结果摘录）

- **R2-2 口径复核**：`ls packages/vfsl/test/ | wc -l` → 27；`ls packages/vfsl/test/*.test.ts | wc -l` → 26；`ls packages/vfsl/test/ | grep -v "\.test\.ts$"` → 仅 `validate-logical-snapshot.contract.ts`——与 R3 注记「26 个 .test.ts + 1 个共享文件共 27 条目」逐项吻合。
- **R2-1 主锚推演**（§4 蓝本逐行）：`[0]` → G0 `Array.isArray` ✓ → probeRoot 惰性创建（零 update，R1 R5 探针）→ navClassify(ROOT)=ymap → `typeof 0 !== 'string'` → C1 → notAllowed(`[0]`)——五断言全绿路径成立。
- **R2-1 对照锚推演**：title='Hello' → `['title','x']` → cur='Hello' → navClassify=scalar → C2 notAllowed；update 0（读零 update）+ toJSON 纯读前后 `toEqual` `{title:'Hello'}` 稳定。
- **detached 三形态推演**：holder fixture 两内嵌实例均 `doc===null`（R1 C2/K 探针同构）；`['holder','ys','x']` 命中导航循环 case 'detached'、`['holder','ys']`/`['holder','frag']` 命中 projectValue detached 守卫（§4 L200/L325）——两个守卫点全覆盖。
- **R3 标记分布**：`grep -n "R3"` → 14 处，全部位于放行条件范围（头部/E16/E20/§6.2×4/回应表/后记），核心机制区域零改动。

## 三轮评审总览

| 轮 | verdict | 攻击点 | 核心成果 |
|---|---|---|---|
| R1 | reject | 8 项（2 HIGH + 2 MEDIUM must-fix + 3 should-fix + 1 知会） | 独立探针证伪 A2「天然 attached」（detached 静默空投影）、null 哨兵碰撞、SUP-5 覆盖缺口、移植锚精度 ×3 |
| R2 | reject | 2 项（1 MEDIUM must-fix + 1 LOW） | R1 八点 100% 核销；新机制（ProjectOutcome/detached 守卫/G0 前缀/Proxy 划界）二轮攻击全部成立；捕获 R2 重写时新引入的零副作用锚自相矛盾 |
| R3 | **pass** | 0 项 | R2-1 拆锚（整对推导自洽）、R2-2 双口径复核吻合、fixture 规格显式化、三 INFO + 三形态锚落实、无回退无新缺陷 |

设计历经三轮对抗收敛：核心机制自 R2 起稳定（SA2 两轮攻击未再触及架构层），R3 全部为测试蓝图与文档事实层的精化。**SA3 可按 §4 蓝本 + §6.2 移植清单/guards fixture 规格直接实现；SA4 应重点核验 ProjectOutcome 判别联合、detached 前置判别（navClassify + projectValue 双入口）、G0 E100 前缀、defineProperty 四真写入四处机制的落地保真度。**
