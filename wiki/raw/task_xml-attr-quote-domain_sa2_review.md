# SA2 攻击评审报告 — task_xml-attr-quote-domain（Issue #94，Bug 修复）

**Date**: 2026-08-23
**Verdict**: **pass**（附 2 项 MINOR 修订建议 + 2 项 OBSERVATION，均不构成 reject 级漏洞；MINOR 项建议 SA3 实现时采纳，不阻塞放行）

- **被审对象**：`wiki/raw/task_xml-attr-quote-domain_design.md`（SA1 R1：主路径 = 投影面正确转义 serialize-side escaping）
- **约束基准**：`wiki/raw/task_xml-attr-quote-domain_relevant_decisions.md`（ADR-0007 高度相关 / ADR-0003 §5 同向 / ADR-0001 约束回退路径）；SA8 冲突门禁 Verdict: clear
- **评审方法**：全新视角独立复核——缺陷行、四条耦合点、§8 全部 yjs 协议假设（源码行号 + 实测复算）、§9 caller audit 逐行对源码、红灯基线实测复跑、RT-E 修复后路径端到端模拟。全部命令与输出见文末「独立验证证据」。

---

## 一、攻击前立场核查（SA5 根因 + 简报 AC 复核）

1. **缺陷行属实**：`packages/doc-runtime/src/xml-parse.ts:209-212` 无条件 `value.includes('"')` 拒绝，位于配对引号解析**成功之后**——与 SA5 定谳一致。删除后 ② 扫描器与 `vfsl/src/xml.ts wellFormedXml` 除「产出中间树 vs 布尔判定」外逐字符相同（SA2 逐行比对两扫描器源文确认，含字符工具函数 `readXmlName/isXmlNameStart/isXmlNameChar/skipXmlSpace` 逐字镜像）→ AC-⑦「同域一致」的 ①=② 半边由删除动作直接成立。
2. **AC 覆盖 8/8**（§10 对照表核过）：①删拒绝 / ②③序列化+不变式 / ④T-1~T-14 / ⑤机制不变 / ⑥C-8 已删（SA2 grep 确认 materialize-root.test.ts:65/69/842/881 登记删除，无残留「值含双引号」断言）/ ⑦四域矩阵 / ⑧验证命令。**无验收点遗漏**。
3. **修复方向裁决复核**：否决路径 B（收窄 VFSL 域）正确——触碰 ADR-0001「方言只增不改」且低于 ADR-0003 §5 接受域，简报明文禁止隐式收窄；否决路径 A（parse 侧存转义值）三条理由（observer 绕过 / RT-E 变体 C 意图 / 存储失真）经 SA2 复核全部成立——`el.setAttribute('q', 'x"y')` 是 RT-5/RT-E 实证活跃路径，parse 侧转义对它无效。主路径为 SA5 Fix direction 首选、SA6 比较器明文兼容形态，且「按需改选单引号外壳」在 observer 双引号同存值（`x"y'z`）下确无解（§3 决定性反例成立）。

## 二、攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞（触发条件 / 影响） | 可执行修订要求 |
|---|--------|--------|------------------------------|----------------|
| 1 | **MINOR** | §4.2 `escapeAttrValue` 的「镜像 yjs 隐式强转」声明失真 | 触发：direct yjs API 对已集成元素 `setAttribute(k, <非字符串>)`，其中 (a) **symbol**——yjs 原生 `key + '="' + attrs[key] + '"'` 抛 TypeError（extract → E100 loud 结构化失败），设计的 `String(v)` 静默产出 `"Symbol(x)"` 字符串；(b) **带 valueOf 的对象**——`'' + {valueOf:()=>42}` 为 `"42"` 而 `String(...)` 为 `"[object Object]"`（ToPrimitive hint 不同）。materialize 路径不可达（parse 只产 string 值），仅 hostile direct-API 可达，⑥ 变体 C 兜底。影响：§6「值不含 `"` 的输出逐字节不变」对该角落不成立（修复前 E100 无输出 / 异输出）；extract 公共读入口在 symbol 角落从 loud 失败变为 ok:true + 捏造值。 | 把 `String(v)` 改为 `'' + v`（对 symbol 同样抛 TypeError → 被 extract E100 / ⑥ 变体 D 既有崩溃边界收编 = 忠实镜像，代码更短）；若坚持 String() 则须在 §9 审计表登记该 divergence 并拍板期望行为。SA3 实现期采纳即可，不阻塞设计放行。 |
| 2 | **MINOR** | §4.2 `xmlNodeToString` 对非 XmlElement 子节点一律委托原生 | 触发：direct API 把 `Y.XmlFragment` 嵌入 `Y.XmlElement` 子位，且其后代元素属性值含 `"`。委托分支 `node.toString()` 走 yjs 原生零转义 → 嵌套子树属性不转义 → 投影可能非良构。影响：与修复前行为完全一致（**非回归**）——revalidate ok:false 响亮、⑥ canonical 扫描失败落变体 D throw（绝不假成功）；但设计「其余一切委托 yjs 原生行为」的表述未覆盖此角落，「投影恒良构」（§5.1 不变式 B）的论证默认了子节点只有 XmlText/XmlHook。 | 两种处置任选：(a) 对 `node instanceof Y.XmlFragment` 递归 `xmlNodeToString`（fragment 无属性、子节点同构，一两行）；(b) 在 §4.2 注释登记「嵌套 fragment 子树投影可能非良构 → ⑥ 变体 D / revalidate 响亮」为已知 loud 角落。SA3 实现期处置，不阻塞。 |
| 3 | OBSERVATION | §4.4/§5.5 esc 归并对 ⑥ 检测面的吸收 | 触发：observer 把属性值从 `a"b` 改写为 `a&quot;b`（SA6 比较器口径 dec 后语义等价）→ 双侧投影同串 → ⑥ 变体 C 不报。影响评估：**非检测面放宽**——修复前同形态走变体 D（「校验未能运行」，同样无偏离报告），且 INV-11 明文「检测基准 = 语义等价」，吸收语义等价改写是该基准的正确行为；对照面未被放宽：`a&amp;b` ↔ `a&b` 类其它实体改写 canonical 不解码、仍变体 C 检出（设计 §4.4 自我声明一致）。 | 设计无需改；建议把该归并语义落成两条对照回归锁（见「红线测试思路」#3），防止后续演进无意中把「不解码」也放宽。 |
| 4 | OBSERVATION | §8 实测脚本留存与 §9 措辞精度 | (a) §8 实测块称「脚本见 git 外记录」——命令形态（node -e 直跑 yjs@13.6.32）已声明、输出已逐字贴出，SA2 已独立复算全部四条（#1/#2/#3/#4 输出逐字吻合，见文末证据），可验证性成立，不触发「实测无输出」reject 立法；(b) §9 把 materialize-root.test.ts:576 / extract:493 / read:361 描述为「byte-exact 断言」，实际为 `normalizeXml`（折叠标签间空白）语义比较——结论不受影响（quote-free 值投影逐字节不变已被 SA2 实测证实），纯措辞精度。 | SA4 复验 §8 时以本报告文末的复算命令为基准；§9 措辞可由 SA1 在 R2 顺手修正，非必须。 |

**未发现的漏洞类别（扫描结论）**：竞态/死锁（全同步单线程，无）；缓存与存储撕裂（读侧投影替换、写侧零触碰，无）；极端输入 panic（深嵌套递归栈溢出 → extract E100 / ⑥ 变体 D，与修复前同款；超大值线性扫描无炸点；`"` 为 BMP 字符，split/join 与代理对无干涉）；Feature/Refactor 类契约污染（公共签名/返回结构/throw 面零变化，§9 审计表与源码逐行核对一致）。

## 三、协议假设依据审查（2026-06-13 立法）

**结论：通过。**

1. **章节存在**：§8「协议假设依据 (Protocol Assumption Evidence)」在位，六行假设逐行给出依据类型与具体引用。
2. **依据可验证性（SA2 独立复核全部属实）**：
   - `YXmlElement.js` toString：`keys.sort()`（:119）、`key + '="' + attrs[key] + '"'` 零转义（:124）、`toLocaleLowerCase()`（:126）、`' ' + join(' ')` + 显式闭合（:127-128）——行号与内容核对一致；
   - `YXmlFragment.js:269-271` toString = `typeListMap(...).join('')`；`toArray()`（:376-377）→ `typeListToArray`（AbstractType.js:453-467）与 `typeListForEach`（:501-514）过滤谓词逐字相同（`n.countable && !n.deleted`）——设计用 `toArray().map()` 替代 `typeListMap` 的**字节等价结构基础**由 SA2 确认；
   - `getAttributes()`（YXmlElement.js:203-204 → typeMapGetAll 读 `_map`）+ `_integrate`（:66-71 `_prelimAttrs` 落盘后置 null）——live 守卫依据核实，且 SA2 实测 detached `getAttributes()` 返回 `{}` **仅 stderr 告警不抛错**，证实「静默丢属性」判定与 loud 守卫的必要性；
   - 设计期实测 #1/#2/#3：SA2 以镜像设计的序列化器复算，#1 原生投影 `<p title="a"b">x</p>`（非良构）、#2 序列化器 `<p title="a&quot;b">x</p>`（良构）、#3 quote-free 多属性/嵌套/`'`/`.:` 命名/逐字文本 span 双侧**逐字节相同**——三条全部逐字吻合。
3. **无「应该/通常/预计」类无据推断**：全部依据为源码行号或贴出输出的实测；「declared compat ^13.6.30」的版本漂移风险已自我声明（替换而非依赖，升级只影响回归保证不影响正确性）。
4. **附加验证**：SA2 端到端模拟 RT-E 修复后路径，产出 `real="<p q="x&quot;y" title="a&quot;b">x</p>"` / `scratch="<p title="a&quot;b">x</p>"`，双侧 canonical 可扫描、属性集差异 → 变体 C throw——与设计 §4.5 预测串**逐字一致**（含 q/title 字母序）。

## 四、错误处理链路审查（2026-05-07 立法）

1. **静默失败**：无新增静默路径。② 删分支是失败面单调缩小；投影内容变化即修复目的且经 RT-A/RT-C 断言闭环（ok:true + 单事务 + 语义等价 + revalidate ok）；RT-E 断言 throw /DOCRT-E201/（SA2 模拟证实修复后必 throw 而非 ok:false / ok:true）。红灯基线 12 failed | 223 passed 与 SA6 登记逐字一致（SA2 复跑证实）。
2. **状态闭环**：ok:false/issues（返回值）与 throw E201/E202 的分工面零变化；§9 caller audit 五处消费方逐行对上源码——extract.ts:52-68 顶层 try/catch → E100；materialize.ts:261-266（(2) 块）/ 277-287（(3) 块）try/catch → e201D；live 守卫 throw 落入既有崩溃边界，无新增外抛面；`grep toString() src/` 确认 XML 投影唯一产出点 extract.ts:138，**无第六消费方**。
3. **降级路径**：无外部依赖（yjs 本地同步）；无网络/服务降级面。
4. **虚假降级识别**：唯一候选 live 守卫——其条件（detached fragment）在正常路径恒不可达（walk 的 live 值恒来自已集成 doc），处置为 **loud throw 拒绝静默空投影**，完全符合「正常路径前提缺失 = bug，须 loud assert」立法。发现 #1 的 symbol 角落属「静默语义换算」而非降级，已按 MINOR 单列。

## 五、红线测试思路（供 SA3/SA6 增补，非放行前置）

1. **【对应发现 #1】非字符串属性值的镜像保真**：`new Y.Doc()` → 集成元素 `setAttribute('k', Symbol('x'))` → `extractYjsSnapshot` → 若采纳 `'' + v`：断言 `ok:false` 且 message 匹配 `/DOCRT-E100/`（与修复前一致，锁「不因序列化器替换吞掉 loud 失败」）；带 valueOf 对象对照组断言投影含 `"42"`（镜像原生强转）。
2. **【对应发现 #2】嵌套 XmlFragment 子树的响亮失败**：direct API 把含 `"` 属性值的孙元素装进嵌套 fragment 再入 XmlElement → extract 投影 → 断言 `validateLogicalSnapshot` ok:false（malformed 响亮，绝不静默 ok:true）；若 ⑥ 场景（observer 注入同构子树）断言 throw /DOCRT-E201/（变体 D 语义）。
3. **【对应发现 #3】esc 归并的对照双锁**：(a) observer 把已装 title 值 `a"b` 改写为 `a&quot;b` → 断言 `materializeRoot` **ok:true**（语义等价改写不误报——把 §4.4「归并正确而非误并」落成契约）；(b) 对照 observer 改 `a&amp;b` → `a&b` → 断言 throw /DOCRT-E201/ 变体 C（canonical 不解码、保守检测面不放宽）。两锁合并防止后续演进把任一侧语义漂移。
4. **【§5.5 迁移锁，可选】表示漂移不动点**：`<p title='a"b'>x</p>` materialize → extract → 再 materialize → 再 extract：第二次起投影逐字节不变（esc 幂等），且两次 `validateLogicalSnapshot` 均 ok——锁「一次性迁移到不动点」。

## 六、结论

设计对根因定位准确（SA2 复核确认）、方向裁决与 ADR 基准全对齐（否决 B 不触 ADR-0001/0003、主路径只动 doc-runtime）、四域一致性的兑现机制（删拒绝 + 序列化器 + 接线 + canonical 加固）经 SA2 逐点实测复算成立、错误处理链路与崩溃边界审计与源码逐行相符、AC 8/8 覆盖。发现清单无 CRITICAL/MAJOR：#1/#2 为 hostile direct-API 角落的镜像保真缺口（修复前后均响亮或行为等价、无假成功向量），#3/#4 为观察项。**Verdict: pass**——同意放行进入 SA3 实现；建议 SA3 实现时顺手采纳 #1（`'' + v`）与 #2（递归或注释登记），SA6 可按第五节思路增补回归锁（非阻塞）。

---

## 附：独立验证证据（SA2，worktree `/home/wangjian/nomicore-fix-issue-94`，yjs@13.6.32）

```text
[A] 红灯基线复跑（与 SA6 登记逐字一致）：
    $ pnpm exec vitest run packages/doc-runtime/test --typecheck.enabled=false
    → Test Files 1 failed | 12 passed (13)；Tests 12 failed | 223 passed (235)

[B] §8 实测复算（node -e 直跑 yjs@13.6.32，镜像设计 §4.2 序列化器）：
    #1 yjs native  : "<p title=\"a\"b\">x</p>"        （缺陷实证，非良构）
    #2 serializer  : "<p title=\"a&quot;b\">x</p>"     （良构，可再校验）
    #3 yjs  plain  : "<div lang=\"en\"><ns:item-2.x a=\"1's\" b=\"2\">t</ns:item-2.x></div>plain &amp; <tail>"
       ser  plain  : （与上行逐字节相同，byte-equal: true）
    #4 detached getAttributes: {} + stderr「Invalid access: Add Yjs type to a document
       before reading data.」（静默丢属性不抛错——live 守卫依据成立）

[C] RT-E 修复后路径模拟（② 放行 + observer 注入 q='x"y' + ⑥ 双侧投影/canonical）：
    real   : "<p q=\"x&quot;y\" title=\"a&quot;b\">x</p>"
    scratch: "<p title=\"a&quot;b\">x</p>"
    → 双侧 canonical 可扫描、属性集不等 ⇒ 变体 C throw DOCRT-E201（与设计 §4.5 预测逐字一致）

[D] 源码行号核对：xml-parse.ts:209-212（缺陷块）/ :63-79（canonicalXmlOf）/ :76（渲染行）；
    extract.ts:136-139（xml-fragment 分支）；materialize.ts:343-344（canonicalXmlOf 唯二调用）；
    read.ts navigate 终点 walk 复用（~:370）；vfsl/src/xml.ts:16-90（宽域基准）；
    yjs：YXmlElement.js toString(:113-128)/getAttributes(:203-204)/_integrate(:66-71)、
    YXmlFragment.js toString(:269-271)/toArray(:376-377)、AbstractType.js
    typeListToArray(:453-467)/typeListForEach(:501-514)（过滤谓词逐字相同）
    ——全部与设计引用一致。

[E] grep 验证：src/ 下 XML 投影 toString() 唯一产出点 extract.ts:138（无第六消费方）；
    canonicalXmlOf 仅 materialize.ts 导入；index.ts 公共面不含 xml-parse/xml-serialize；
    materialize-root.test.ts C-8/X-F9 已删（:65/:69/:842/:881 登记注释，无残留断言）；
    rev2 RT-5（materialize-root-rev2.test.ts:594-604）断言「变体 C 或 D 皆可」——零改动保持绿成立。
```
