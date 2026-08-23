# SA1 设计文档 — 统一 XML 属性引号接受域（Issue #94 / Bug 修复）

- **Worktree**: `/home/wangjian/nomicore-fix-issue-94`（branch `refactor/-xml-logical-validation--materialization-`，基线 `b0512aa`）
- **任务简报**: `wiki/raw/task_xml-attr-quote-domain.md`；**根因报告**: `wiki/raw/20260823-bug-xml-attr-quote-domain.md`（SA5）；**红灯契约**: `packages/doc-runtime/test/xml-attr-quote-domain.test.ts`（SA6，26 用例 / 12 红）
- **ADR 约束基准**: `wiki/raw/task_xml-attr-quote-domain_relevant_decisions.md`（ADR-0007 高度相关、ADR-0003 §5 同向、ADR-0001 约束回退路径）
- **版本**: R2（R1 修订，2026-08-23——SA4 R1 reject 唯一阻塞项 `scope-creep-detected` 回流：R1 §7 ALLOW LIST 漏列 Hard Gate #9 强制的 `packages/doc-runtime/package.json` 版本 bump（0.1.5→0.1.6，SA3 已按门禁执行）。**本修订为清单完备性修正，非设计变更**：R1 全部技术设计逐字保留；技术实现 SA4 R1 已确认零缺陷。待 SA2 破壁）

---

## §1. 任务定性与根因复述

**Bug 修复**。SA5 已定谳根因（本设计复核确认，不重考据）：

- **缺陷行**：`packages/doc-runtime/src/xml-parse.ts:209-212` —— `scan()` 属性循环对已按配对引号正确解析出的属性值无条件拒绝 `value.includes('"')`，不区分外层引号是 `'` 还是 `"`。
- **机理**：把 extract 侧 yjs `YXmlElement.toString()`（`YXmlElement.js:124`：`key + '="' + attrs[key] + '"'`，零转义）的**序列化层表示缺陷**前移成了 **② 物化构造域的输入域收窄**，使 ② 严格窄于 ① VFSL `wellFormedXml`（`packages/vfsl/src/xml.ts:69-81`：配对引号扫描、值内一切字符为字面量、对 `"` 无限制）。
- **症状**：`{ body: '<p title=\'a"b\'>x</p>' }` → `validateLogicalSnapshot` ok:true 而 `materializeRoot` ok:false（「属性 title 值含双引号」），破坏 ADR-0007 的 materialize → extract → revalidate 语义 round-trip 闭环。

本设计复核了 SA5 的四条耦合点清单，逐一确认（详见 §3 一致性矩阵）：
1. `xml-parse.ts:209-211` 拒绝块（本设计删除，§4.1）；
2. `extract.ts:138` 裸 `Y.XmlFragment.toString()`（表示缺陷源头，本设计替换为自建序列化器，§4.2/§4.3）；
3. `xml-parse.ts:63-79 canonicalXmlOf`（渲染零转义、靠 ② 拒绝保证无歧义——本设计同步加固，§4.4）;
4. 契约锁定测试 C-8/X-F9/RT-5（SA6 已改写 C-8/X-F9；RT-5 经 §5.4 论证修复后仍绿、断言无需改动）。

## §2. 三域现状矩阵（修复前）

对同一 XML 子集，四个规则消费方当前各持一套规则：

| # | 规则方 | 位置 | 单引号外壳内 `"` | 双引号外壳内 `'` | 输出/判定面 |
|---|---|---|---|---|---|
| ① | VFSL 逻辑校验 `wellFormedXml` | `vfsl/src/xml.ts:16` | **接受**（字面量） | 接受 | 逻辑域（宽域，**基准**） |
| ② | doc-runtime 物化扫描器 `scan()` | `doc-runtime/src/xml-parse.ts:98` | **拒绝**（:209-212 缺陷行） | 接受 | 构造域（被缺陷收窄） |
| ③ | extract XML 字符串投影 | `extract.ts:138` → yjs `toString` | （不可达：② 已拒） | 直存直出 ok | 读回投影（yjs 零转义，表示缺陷源头） |
| ④ | canonical 归一化 `canonicalXmlOf` | `xml-parse.ts:63` | 扫描即拒（② 同款） | ok | ⑥ 产物比较键（渲染 `k="${v}"` 零转义，靠 ② 拒绝保证无歧义） |

矛盾结构：② < ①（构造域窄于逻辑域）且 ③ 的表示能力 < ① 的接受域。修复必须让 ①②③④ 对**同一子集**一致（AC-⑦），而不是把 ① 拉低到 ②③。

## §3. 修复方向裁决

**备选路径 B（收窄 VFSL 逻辑域到 ②/③ 的窄域）——否决**。触碰 ADR-0001「方言只增不改」（收窄属「改」）且低于 ADR-0003 §5「运行时校验仅要求良构 XML」的既定接受域；任务简报明示该路径「必须先明确 ADR/兼容性演进，不得仅保留跨层隐式差异」——隐式收窄被立法禁止，显式 ADR 演进超出本 Bug 修复半径。**vfsl 包零改动**（§7 DENY LIST 首条）。

**备选路径 A（parse 侧存转义值：assemble 时 `setAttribute(k, '"'.replace → '&quot;')`，extract 保持 yjs 裸 toString）——否决**。理由三条：
1. **治标错位**：表示缺陷在投影面（③），observer / 直接 yjs API 写入（`el.setAttribute('q', 'x"y')`，RT-5/RT-E 实证路径）绕过 parse 侧转义，裸 `"` 仍会进入存储 → extract 输出仍非良构 → ⑥ canonical 扫描失败落变体 D（「校验未能运行」），检测面弱化。
2. **违反 SA6 RT-E 的设计意图**：RT-E 注释明文要求修复后「⑥ canonical 双侧均可扫描（同域一致规则）→ real({title,q}) vs scratch({title}) 产物差异 → throw DOCRT-E201（**变体 C**）」——即 extract 投影面必须对任意存储值产出可扫描输出。路径 A 下 RT-E 断言 `toThrow(/DOCRT-E201/)` 虽因变体 D 也匹配而字面通过，但「同一 XML 子集一致规则」（AC-⑦）不成立：物化器接受的值域与投影面可表示的值域仍不相交覆盖。
3. **存储失真**：Yjs 载体不再保存真实属性值（`getAttribute('title')` 返回 `a&quot;b` 而非 `a"b`），违反「Yjs 载体存真值、字符串投影面负责语法正确性」的分层直觉，且 `Y.XmlFragment.toJSON()` 等其它 yjs 投影全部看到转义残影。

**主路径（采纳）：投影面正确转义（serialize-side escaping）**——② 删除拒绝恢复与 ① 同域；③ 换用 doc-runtime 自建 XML 字符串投影序列化器，`Y.XmlElement` 属性值中的 `"` 转义为 `&quot;`，其余一切委托/镜像 yjs 原生行为。这是 SA5 Fix direction 首选、SA6 比较器明文兼容的形态之一（「在 XML 字符串投影面把属性值中的 `"` 转义为 `&quot;`」），且只动 doc-runtime 包。

**为何转义为 `&quot;` 而不是「按需改选单引号外壳」（SA6 提到的另一形态）**：
1. **双引号同存值无解**：parse 侧来源的值至多含一种引号字符（配对闭引号扫描的构造性保证），但 observer / 直接 yjs 写入的值可同时含 `"` 与 `'`（如 `x"y'z`）——任何引号外壳都无法无损包裹，转义无此盲区。**必须覆盖 observer 写入路径**（RT-5/RT-E 是活跃测试锚），这是决定性理由。
2. **单一输出形态**：转义使所有属性一律双引号外壳，与 yjs 既有投影风格唯一化；外壳切换会引入第二种输出风格，徒增推理面。
3. 与 canonical（一律双引号渲染）和 SA6 比较器（属性值实体解码后比较）正交配合。

## §4. 详细设计

### §4.1 D1 — `xml-parse.ts`：删除 ② 构造期拒绝（缺陷行本体）

`scan()` 属性循环（现 :196-214）删除以下 4 行：

```diff
         const value = s.slice(j + 1, valueEnd);
-        if (value.includes('"')) {
-          // D7 规则 3：yjs 序列化器不转义属性值（A12）——双引号值必产出不可再校验文档
-          return { kind: 'err', reason: `属性 ${attrName} 值含双引号` };
-        }
         attrs.push([attrName, value]); // 重复属性 last-wins：yjs setAttribute 覆盖（规则 4）
```

删除后 ② 与 ① 的骨架镜像关系**恢复完整**（两扫描器除「产出中间树 vs 布尔判定」外零语义分叉）。malformed 行为不变：M-1（`title='a'b'`）/M-2（`title="a"b"`）型输入在配对闭引号截断后落「属性缺少 "="」错——与 `wellFormedXml` 逐字同款（两侧骨架本就镜像，被删的检查位于配对引号解析**成功之后**，不影响任何 malformed 判定路径）。RT-D 八行全部走 ① 拒绝 + 引用零损透传 + 零写入，机制不变。

同步更新文件头注释「四条语义规则」第 3 条（:16-17）：由「属性值含 `"` → 响亮拒绝」改为「属性值逐字存储（含单引号外壳内 `"` 字面量，与 wellFormedXml 同域）；投影面的无损转义由 `xml-serialize.ts` 承担（issue #94）」。

### §4.2 D2 — 新建 `packages/doc-runtime/src/xml-serialize.ts`：投影面序列化器

模块内部件（不经 `index.ts` 导出，与 xml-parse.ts 同纪律）。两个导出：

```ts
/**
 * @nomicore/doc-runtime — Y.XmlFragment → XML 字符串投影序列化器（issue #94）。
 *
 * 与 yjs 原生 toString 的唯一差异：Y.XmlElement 属性值中的 `"` 转义为 `&quot;`——
 * yjs 零转义投影（YXmlElement.js:124 `key + '="' + attrs[key] + '"'`）无法无损表示
 * 含 `"` 的属性值（SA5 A12 实证引号截断）。其余一切（元素名 toLocaleLowerCase、
 * 属性字母序、单空格连接、空元素显式闭合、YXmlText/YXmlHook 委托）逐字符镜像 yjs，
 * 保证不含 `"` 属性值的输出与 yjs toString 逐字节相同（设计期实测，§8）。
 *
 * 转义纪律：只转义 `"`，禁止转义 `&`（及 `<`/`>`/`'`）——parse 侧不解码实体（规则 1），
 * 序列化侧转义 `&` 会破坏 `title="a&quot;b"` 字面实体值的语义等价 round-trip（T-13 反例，
 * §5.2）。escape 幂等：escape(escape(x)) === escape(x)。
 */
import * as Y from 'yjs';

/** 属性值转义：仅 `"` → `&quot;`。非 string 值（observer 可 set 任意值）经 String() 强转，
 * 镜像 yjs 字符串拼接的隐式强转语义。split/join 实现——零引擎依赖（不依赖 ES2021 replaceAll）。 */
export function escapeAttrValue(v: unknown): string {
  return String(v).split('"').join('&quot;');
}

/** 唯一公共投影入口（模块内部件）：live Y.XmlFragment → 良构 XML 字符串。
 * 前置条件：fragment 必须已集成（doc !== null）——detached 类型的 getAttributes()
 * 读不到 prelim 属性、会静默丢属性；违反即实现缺陷，loud throw（拒绝虚假降级），
 * 不做静默空投影。当前唯一调用方 extract walk 恒传 live 值，本守卫为防御纵深。 */
export function xmlFragmentToString(fragment: Y.XmlFragment): string {
  if (fragment.doc === null) {
    throw new Error('xmlFragmentToString: 收到未集成（detached）的 Y.XmlFragment——只接受 live 值');
  }
  return fragment.toArray().map(xmlNodeToString).join('');
}

/** 单节点投影：XmlElement 自渲染（属性值转义），其余类型委托 yjs 原生 toString。 */
function xmlNodeToString(node: Y.XmlElement | Y.XmlText | Y.XmlHook): string {
  if (node instanceof Y.XmlElement) {
    const attrs = node.getAttributes() as Record<string, unknown>;
    const keys = Object.keys(attrs).sort(); // 镜像 yjs：默认字典序（YXmlElement.js:120 keys.sort()）
    const attrsStr = keys.length > 0
      ? ' ' + keys.map((k) => `${k}="${escapeAttrValue(attrs[k])}"`).join(' ')
      : '';
    const name = node.nodeName.toLocaleLowerCase(); // 镜像 yjs（YXmlElement.js:126）
    return `<${name}${attrsStr}>${node.toArray().map(xmlNodeToString).join('')}</${name}>`;
  }
  return node.toString(); // YXmlText（逐字 span / 格式 delta 渲染）与 YXmlHook 委托 yjs 原生
}
```

设计要点：

1. **最小差原则**：只有 `Y.XmlElement` 的属性值渲染被替换；`YXmlText`/`YXmlHook` 子节点与 fragment 拼接全部委托 yjs 原生 `toString()`。文本 span 渠道（规则 1 逐字往返、X-16 实体字面量逐字保留契约）**零行为漂移**——文本转义是被明确否决的（§5.3）。
2. **镜像依据**：`YXmlElement.js:113-128` toString（keys.sort + `key + '="' + value + '"'` + `toLocaleLowerCase` + `' ' + join(' ')` + `super.toString()` 子内容 + 显式闭合）；`YXmlFragment.js:270` toString（`typeListMap(...).join('')`）。逐行依据见 §8 协议假设表。
3. **live 守卫**：detached fragment 的 `getAttributes()` 走 `typeMapGetAll`（读 `_map`，detached 时为空）会**静默丢属性**——这是「正常路径的缺陷」类条件，按立法做 loud assert 而非降级。
4. **集成后属性可见性**：detached 构造期的 `_prelimAttrs` 在 `_integrate` 时落盘（`YXmlElement.js:66-70`），extract walk 只见 integrated 值，守卫覆盖后无静默路径。

### §4.3 D3 — `extract.ts`：投影接线

`walk()` xml-fragment 分支（:136-139）：

```diff
     case 'xml-fragment': {
       if (carrierOf(live) !== 'Y.XmlFragment') return mismatch(path, 'Y.XmlFragment', live);
-      return { kind: 'value', snapshot: (live as Y.XmlFragment).toString() }; // D7：XML 字符串投影
+      return { kind: 'value', snapshot: xmlFragmentToString(live as Y.XmlFragment) }; // D7'：投影面序列化器（issue #94：属性值 `"`→`&quot;）
     }
```

（文件头补 `import { xmlFragmentToString } from './xml-serialize.js';`；D7 注释行同步改写。）此分支是 XML 字符串投影的**唯一产出点**——`readLogicalValueAtPath` 的终点转换复用同一 `walk`（read.ts:370，D7 单一转换语义源），接线后两个公共入口自动同域。

### §4.4 D4 — `xml-parse.ts`：`canonicalXmlOf` 渲染加固（行为中性）

`renderCanonicalNode`（:70-79）属性值渲染从 `` ` ${k}="${v}"` `` 改为 `` ` ${k}="${escapeAttrValue(v)}"` ``（顶部 `import { escapeAttrValue } from './xml-serialize.js'`——单向依赖，无环：xml-serialize 不 import xml-parse）。

- **行为中性论证**：canonical 的唯一调用方是 `materialize.ts` productEqual（⑥，:343-344），输入恒为 extract 产物 = 新序列化器输出——其属性值**永不含裸 `"`**（已转义），escape 作用于无裸 `"` 的字符串是恒等变换。⑥ 诚实路径双侧同管线 → 字节一致 → canonical 相等，加固前后判定结果逐 case 相同。
- **加固价值**：若未来 canonical 直接消费非投影面字符串（演进防御），escape 保证 `<e k='a"b'/>` 与 `<e k="a&quot;b"/>`（同一逻辑值的两种写法）归一化到同一 canonical 键（`k="a&quot;b"`），消除「裸 `"` 嵌入双引号渲染」的键歧义；且两者 XML 语义等价（SA6 比较器 decodeAttrEntities 同款口径），归并**正确**而非误并。
- **不做实体解码**：canonical 保持结构性归一（值逐字），不升级为全语义归一（解码 `&amp;` 等）——⑥ 的保守检测语义（observer 做语义等价但字节不同的改写仍报变体 C）是 rev2 既定契约，本任务不放宽检测面。`:58` 与 `:76` 处「② 已拒属性值含 `"`，C-8/X-F9——归一化无歧义」的失效注释同步改写为新依据（序列化器转义 + escape 加固）。

### §4.5 D5 — materialize.ts 六阶段编排：零改动（论证）

⓪ E202 guard、① 透传、② buildValue（消费 parseXmlToFragment，接受域自动放宽）、③ probeRoot、④ 单事务安装、⑤ verifyInstall（引用同一性，与 XML 无关）、⑥ verifySnapshotIntact——**均无需改动**：
- ⑥ 内部经 `extractYjsSnapshot` × 2 → 双侧同走新序列化器 → `productEqual` 比较键一致（§4.4 中性论证）；
- RT-E 攻击路径：输入 `<p title='a"b'>x</p>` ② 放行安装 → observer 注入 `q='x"y'` → real 投影 `<p q="x&quot;y" title="a&quot;b">x</p>` vs scratch `<p title="a&quot;b">x</p>` → 双侧 canonical 均可扫描（同域一致）→ 属性集差异 → **变体 C** throw `DOCRT-E201`——与 RT-E 注释的修复后期望逐字吻合；
- rev2 RT-5（`<p>t</p>` + 注入 `q='x"y'`）：修复前走变体 D（real 侧裸 `"` → canonical 扫描失败），修复后走变体 C（差 `q` 属性）——断言 `toThrow(/DOCRT-E201/)`（标题明文「变体 C 或 D 皆可」）两者皆绿，**该测试文件无需任何改动**。

## §5. 边界条件与防御性分析

### §5.1 转义映射的语义正确性（逐行过 RT-C 矩阵）

设 `esc(v) = v.split('"').join('&quot;')`，`dec` 为 XML 属性值实体解码（SA6 比较器口径）：

- **不变式 A（往返语义等价）**：`dec(esc(v)) === v` 对含 `"` 的 v 成立——`esc` 只产生 `&quot;`（dec 还原为 `"`），其余字符不动。这是 RT-A/RT-C 全部 T-1~T-9 行绿的核心：输入 canonical（值经 dec）≡ 输出 canonical（值 `esc(存储值)` 经 dec = 存储值 ≡ 输入值经 dec）。
- **不变式 B（输出可再校验）**：`esc(v)` 永不含裸 `"` → 投影输出的属性值段在 `wellFormedXml` 配对引号扫描下是原子字面量 → 输出恒良构（RT-A AC-②/revalidate）。
- **T-6（`a"<b>&c`）**：`<`/`>`/`&` 不转义、不豁免——引号内字面量（vfsl R2 成文口径 `<p title="a>b">` 良构），输出 `title="a&quot;<b>&c"` 良构 ✓。
- **T-7（双属性引号交错）**：title（单引号壳内 `"`）存 `a"b` → `a&quot;b`；lang（双引号壳内 `'`）存 `c'd` → 不动；字母序输出 `<p lang="c'd" title="a&quot;b">x</p>` 良构 ✓。
- **T-8（自闭合）**：yjs 投影本就把空元素渲染为显式闭合（设计期实测 `<ns:item-2.x ...></ns:item-2.x>`），`<img title="a&quot;b"></img>` 良构；SA6 比较器把输入自闭合同样归一为显式闭合 ✓。
- **T-10~T-14（回归锁行）**：值不含裸 `"` 时序列化器与 yjs toString **逐字节相同**（§8 实测 #3）——已工作通道零漂移。

### §5.2 为何禁止转义 `&`（T-13 决定性反例）

parse 侧不解码实体（规则 1）。若序列化侧转义 `&`→`&amp;`：T-13 输入 `title="a&quot;b"`（字面实体，存储值 `a&quot;b`）→ 输出 `title="a&amp;quot;b"` → dec 后 = `a&quot;b`（7 字符字面量）≠ 输入 dec 后的 `a"b` → **语义等价破坏、T-13 变红**。只转义 `"` 则 T-13 输出逐字不变（值内无裸 `"`）。同理禁止转义 `<`/`>`/`'`（无必要且有同类风险：`&lt;` 字面量值会被 `&` 转义破坏）。

### §5.3 为何文本 span 不转义（X-16 契约锁定）

文本渠道规则 1「逐字保留、不解码实体」是 PR #84 定谳且被 X-16（`<p>x &amp; y &lt; z</p>` 逐字往返）锁定的既有契约：SA6 比较器对文本 token **逐字比较、不解码**，若序列化侧转义文本中的 `&`，输出文本 `x &amp;amp; y` ≠ 输入 `x &amp; y` → X-16 红。且 materialize 接受域内文本 run 不含裸 `<`（扫描器把 `<` 识别为标签起点，非标签起点即 malformed），故「parse→extract 诚实路径」文本无需转义即恒良构；observer 注入裸 `<` 文本属 ⑥ 变体 D loud 防线（canonical 扫描失败 → throw，绝不假成功），维持现状。**文本与属性采用非对称策略是契约要求，不是疏漏。**

### §5.4 observer / 直接 yjs 写入路径（RT-5/RT-E 攻击面）

- 注入含 `"` 属性值：投影输出 `q="x&quot;y"` 良构 → ⑥ canonical 双侧可扫描 → 属性集/值差异 → 变体 C（比修复前的变体 D 检测面更强：从「防线未能运行」升级为「检测到偏离」，且不再依赖 canonical 失败兜底）。
- 注入同时含 `"` 与 `'` 的值（`x"y'z`，parse 侧不可构造、仅 observer 可达）：esc 只动 `"` → `x&quot;y'z`，输出 `q="x&quot;y'z"` 良构 ✓——外壳切换方案在此死角无解（§3 已引为否决理由）。
- 注入裸 `<` 文本 / 删除子树 / 改名：与本次修复正交，⑥ 既有检测面（canonical 扫描失败 → 变体 D；结构差异 → 变体 C）不变。

### §5.5 表示漂移的显式接纳（ADR-0007 合规）

存储值 `a"b` 的投影是 `a&quot;b`；若用户把**提取结果**重新物化，parse 逐字存储 `a&quot;b`，再提取仍为 `a&quot;b`（第二次起不动点，esc 幂等）。跨用户级 rematerialize 循环的存储值表示可能在「裸 `"` ↔ `&quot;` 字面」间一次性迁移——两者 XML 语义等价（dec 后同为 `a"b`），受 ADR-0007「XML 只承诺语义等价 round-trip，不承诺字符串逐字相同」明文保护。**单次 materializeRoot 调用内部无漂移**：⑥ 的 real/scratch 双侧都从同一原始 snapshot parse，存储值字节一致。

### §5.6 零写入与单事务不变式

改动不触碰 prepare/④ 事务结构：② 失败面只减不增（删一条拒绝分支），一切失败仍在安装前（零写入）；成功路径仍单次 `doc.transact`（RT-A `events.count === 1`）；⑥ scratch 构造在一次性 doc 上，real doc 的 update 计数不受影响。RT-D 八行零写入双证机制原样。

### §5.7 对 ② 扫描器 malformed 行为的回归确认

被删检查位于配对引号解析**之后**：所有 malformed 判定（引号未闭合/缺 `=`/无引号/非法属性名/标签未闭合/不匹配/裸 `<`/DOCTYPE）路径不经过它，② 的错误面与 ① 保持逐字镜像（AC-⑦ 的 malformed 半边）。

## §6. 影响评估与测试期望映射

**公共契约面变化**：`extractYjsSnapshot` / `readLogicalValueAtPath` 返回的 XML 字符串内容，仅在「属性值含 `"`」时与修复前不同（且修复前该形态经 materializeRoot 不可达；observer 写入可达但输出本就非良构）。值不含 `"` 的输出**逐字节不变**（§8 实测 #3）。函数签名、错误返回结构、零写入承诺、单事务承诺：零变化。vfsl / persistence / dsh-persistence / vfsl-codegen / vfsl-protocol：零影响（无 doc-runtime 依赖，grep 确认）。

| 红灯（12 条） | 现失败原因 | 转绿机制 |
|---|---|---|
| RT-A 前置+主断言（2） | ② 拒绝 → ok:false | §4.1 删拒绝 → ok:true + 单事务 |
| RT-C T-1~T-9（9） | 同上 | 同上 + §4.2/§4.3 投影转义 → 语义等价 + revalidate ok |
| RT-E（1） | ② 拒绝返回 ok:false 不 throw | §4.1 放行 + §4.5 ⑥ 变体 C → throw E201 |
| RT-C T-10~T-14 / RT-D M-1~M-8（14 绿） | — | 回归锁：§5.1/§5.7 论证 + 实测 #3 字节一致性 |
| 既有 223 条（含 rev2 RT-5） | — | §4.5/§5.4 论证零改动保持绿 |

**验证命令**（SA3/SA7 执行）：`pnpm exec vitest run packages/doc-runtime/test --typecheck.enabled=false` 与 `pnpm exec tsc -p packages/doc-runtime/tsconfig.json --noEmit`（全量 typecheck/test 走 CI）。

## §7. 文件清单（File Scope）

### ALLOW LIST

- `packages/doc-runtime/src/xml-parse.ts` — 修改：删 ② 拒绝块 :209-212（§4.1，-4 行）+ canonical 渲染 escape 加固（§4.4，~2 行）+ 头注释规则 3 与 canonical 注释更新（§4.1/§4.4，~6 行）。净变 ~±10 行。
- `packages/doc-runtime/src/xml-serialize.ts` — 新建：投影面序列化器 `escapeAttrValue` + `xmlFragmentToString`（§4.2，~65 行含文档）。
- `packages/doc-runtime/src/extract.ts` — 修改：walk xml-fragment 分支接线 + import + D7 注释（§4.3，~4 行）。
- `packages/doc-runtime/package.json` — 修改：version `0.1.5` → `0.1.6`，**仅 version 字段**（deps/exports/scripts 不动）。**R2 修订追加——SA4 R1 唯一阻塞项回流**：Hard Gate #9 强制的行为变更交付 patch bump，SA3 已按门禁执行，R1 漏列；仓内 4/4 先例显式列入（rev1 0.1.2→0.1.3 / rev2 0.1.4→0.1.5 同款，仅 version 字段）。
- `packages/doc-runtime/test/xml-attr-quote-domain.test.ts` — `[SA6 owned]` 验收红灯测试（已入库，26 用例）。SA3 不得改断言逻辑；测试基础设施调整须回溯本设计确认不弱化契约。
- `packages/doc-runtime/test/materialize-root.test.ts` — `[SA6 owned]` C-8/X-F9 已按 AC-⑥ 改写入库（59 用例）。同上纪律。
- `packages/doc-runtime/test/materialize-root-rev2.test.ts` — `[SA6 owned]` 断言零改动即应保持绿（§4.5 RT-5 变体 C/D 皆匹配）；如 SA6 认为需要刷新 RT-5 行内注释（变体 D → 修复后变体 C 的预期描述），属注释级维护，SA3 不得代改。

### DENY LIST

- `packages/vfsl/**` — ① wellFormedXml 是宽域**基准**；ADR-0001 方言冻结，本修复不动 vfsl 一行。
- `packages/doc-runtime/src/materialize.ts` — 六阶段编排与 ⑥ 判定逻辑零改动（§4.5 论证）。
- `packages/doc-runtime/src/extract.ts` 的 xml-fragment 分支以外区域 / `src/read.ts` / `src/carrier.ts` / `src/resolve.ts` / `src/index.ts` — read 经 walk 复用自动受益（D7 单一语义源），公共导出面不变。
- `packages/persistence/**`、`packages/dsh-persistence/**`、`packages/vfsl-codegen/**`、`packages/vfsl-protocol/**` — 与 XML 投影面无依赖交集（grep 确认零引用）。
- `packages/doc-runtime/test/` 下其余测试文件（extract-*.test.ts / read-*.test.ts 等）— 既有断言经 §6 审计在新投影下保持绿，无需改动。

## §8. 协议假设依据 (Protocol Assumption Evidence)

本设计含**第三方库（yjs）行为假设**，逐条给出源码引用 + 设计期实测（SA1 于 design 期在本机 yjs@13.6.32 实跑，命令与输出如下）：

| 假设 | 依据类型 | 依据内容（具体引用） | 风险等级 |
|---|---|---|---|
| yjs `YXmlElement.toString()` 属性零转义、字母序、`toLocaleLowerCase`、单空格连接、空元素显式闭合 | 源码引用 | `node_modules/.pnpm/yjs@13.6.32/node_modules/yjs/src/types/YXmlElement.js:113-128`（:120 `keys.sort()`、:124 `key + '="' + attrs[key] + '"'`、:126 `toLocaleLowerCase()`、:127-128 `super.toString()` 包裹） | 低（declared compat ^13.6.30；且本设计**替换**而非依赖该实现——见下行） |
| 自建序列化器对不含 `"` 属性值的输出与 yjs toString **逐字节相同** | 设计期实测验证 | 见下方实测 #3：`<ns:item-2.x a="1's" b="2"></ns:item-2.x>` 两侧全等 | 低 |
| 存储值 `a"b` 经 yjs 原生 toString 产出非良构串（缺陷实证） | 设计期实测验证 + 现有测试引用 | 实测 #2：`"<p title=\"a\"b\">x</p>"`；SA5 Evidence #4 同款；rev2 RT-5（materialize-root-rev2.test.ts:585-604）以 E201 锁定该防线 | 低 |
| `YXmlFragment.toString()` = 子节点投影空串连接（无包装） | 源码引用 | `YXmlFragment.js:270-272`（`typeListMap(this, xml => xml.toString()).join('')`）；实测 #1/#3 印证 | 低 |
| detached `YXmlElement.getAttributes()` 静默丢 `_prelimAttrs` | 源码引用 | `YXmlElement.js:66-70`（`_integrate` 才落盘 prelim 属性）+ :181-184（getAttributes → typeMapGetAll 读 `_map`）——§4.2 live 守卫的依据 | 低（守卫为防御纵深，正常路径不可达） |
| `YXmlText`/`YXmlHook` 子节点委托原生 toString 与 fragment 聚合语义一致 | 源码引用 | `YXmlText.js:68-92`（toDelta 渲染，纯 span → 逐字）；委托不改变 fragment 聚合（`YXmlFragment.js:270`） | 低 |

**设计期实测**（SA1，worktree 内 `node -e` 直跑 yjs@13.6.32；脚本见 git 外记录，核心输出逐字）：

```text
#1 存储值 a"b（yjs 原生投影，缺陷实证）：
   yjs toString: "<p title=\"a\"b\">x</p>"          ← 非良构（SA5 症状复现）
#2 同树过设计中的序列化器：
   serializer : "<p title=\"a&quot;b\">x</p>"        ← 良构，wellFormedXml 可再校验
#3 不含 `"` 属性值（回归通道，字节一致性）：
   yjs  plain: "<ns:item-2.x a=\"1's\" b=\"2\"></ns:item-2.x>"
   ser  plain: "<ns:item-2.x a=\"1's\" b=\"2\"></ns:item-2.x>"   ← 全等
```

（源码行号针对 yjs@13.6.32 lockfile 固定版本；若升级 yjs 需复核 YXmlElement.js toString 形态——本设计以**替换**而非复用该实现，升级漂移只影响「与旧输出字节一致」的回归保证，不影响正确性。）

## §9. 契约改动连锁审计 (Contract Change Caller Audit)

**签名/throw/return 结构层面：无契约改动**——本设计仅删除一个内部拒绝分支、新增模块内部件、替换一处投影实现；不新增 throw 到原本 return 的路径（§4.2 live 守卫 throw 位于「正常路径不可达的防御位」，且模块内部件无外部 caller）；不改变任何函数签名、返回类型、async 性态。

**投影内容层面的变化**（`walk` xml-fragment 分支产出的字符串，值含 `"` 时内容不同——修复前该内容非良构、且经 materializeRoot 不可达）需审计全部消费方：

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| `extractYjsSnapshot`（公共读入口） | `extract.ts:51` → walk :138 | 否（同步） | N/A（INV-6 顶层 try/catch → E100 收编意外异常） | ✅ `extract.ts:52/68` | 投影内容变化即本设计目的；live 守卫 throw 被既有 E100 崩溃边界收编为结构化返回（不外抛） |
| `materializeRoot` ⑥ 双侧提取 | `materialize.ts:262-263` | 否（同步） | ✅ (2) 块 try/catch → e201D | ✅（verifySnapshotIntact 内） | 双侧同序列化器 → 判定一致（§4.5）；守卫 throw → e201D（理论不可达，防御性收敛） |
| ⑥ `productEqual` → `canonicalXmlOf` | `materialize.ts:343-344` | 否 | ✅ (3) 块 try/catch → e201D | ✅ | canonical 输入恒为新投影输出（无裸 `"`）→ §4.4 行为中性 |
| `readLogicalValueAtPath` 终点转换 | `read.ts:370`（复用 walk） | 否（同步） | N/A（C3 崩溃边界） | ✅ read.ts 顶层 | 复用同一 walk（D7 单一语义源），自动同域；XML 终态值内容变化同 extract 口径 |
| SA6 红灯测试 | `xml-attr-quote-domain.test.ts`（RT-A/C/E）、`materialize-root*.test.ts` | — | — | — | 新契约正是本设计目标（§6 映射表）；既有 byte-exact 断言已审计（仅 quote-free XML：materialize-root.test.ts:576、extract-yjs-snapshot.test.ts:493、read-logical-value-at-path.test.ts:361、rev2:299 为直调 yjs toString 不经 walk）——均不受影响 |
| 包外消费方 | —（grep 全仓：persistence/dsh-persistence/vfsl* 零引用 doc-runtime；无 apps） | — | — | — | 无 |

**遗漏 caller 的代价评估**：投影内容变化只影响「把 XML 字符串再喂回 validate/比较器」的消费方——全仓此类消费方即上表五处（经 `extractYjsSnapshot`/`readLogicalValueAtPath` 两个公共入口 + materialize ⑥ 内部），grep `doc-runtime|XmlFragment` 全仓确认无第六处。live 守卫 throw 的收编路径（E100/E201-D）均已存在于既有崩溃边界，无新增外抛面。

## §10. AC 覆盖对照

| 任务 AC | 设计条目 |
|---|---|
| ① `<p title='a"b'>x</p>` 物化成功 | §4.1 |
| ② 提取结果再过 validateLogicalSnapshot | §4.2/§4.3 + §5.1 不变式 B |
| ③ round-trip 语义等价（不逐字） | §5.1 不变式 A + §5.5 ADR-0007 合规 |
| ④ 表驱动覆盖（单/双引号、空、交错、转义） | §5.1 逐行（T-1~T-14） |
| ⑤ malformed 响亮失败 + 零写入 | §5.6/§5.7（机制不变） |
| ⑥ 删除 C-8 错误契约 | SA6 已入库（materialize-root.test.ts:842-846/881-883 注释登记）；本设计不复活该契约 |
| ⑦ validator/materializer/canonical-extract 同域一致 | §2 矩阵修复后：①=②（§4.1）、③=④（§4.2/§4.4）对同一子集一致；malformed 半边 §5.7 |
| ⑧ 全量 typecheck/test + Node 20/24 CI | §6 验证命令；类型面零变化（新模块内部件自包含） |

## SA2 反馈逐条回应

### R2 修订登记（SA4 R1 reject 回流，2026-08-23）

**SA4 R1 verdict**: reject，唯一阻塞项 `scope-creep-detected`（技术实现 SA4 已确认零缺陷——修订对象仅为 design.md 清单完备性，SA3 零返工）。

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| SA4 R1-a: §7 ALLOW LIST 补 `packages/doc-runtime/package.json`（版本 bump 0.1.5→0.1.6，Hard Gate #9 强制；仓内 4/4 先例显式列入） | ✅ | §7 ALLOW LIST（第 4 条，按立法只增不删追加） | 追加一行：version 0.1.5→0.1.6、仅 version 字段（deps/exports/scripts 不动）、标注 R2 修订追加 + SA4 R1 理由 + rev1/rev2 先例 |
| SA4 R1-b: 文档头部版本标记更新为 R2 + 记录本次修订缘由 | ✅ | 文档头部版本行 + 本表 | 版本行改 R2 并注明「清单完备性修正，非设计变更」缘由；本表登记逐条 mapping |

**修订性质声明**：本修订不改变任何技术设计——§3 主路径裁决 / §4 D1-D5 / §5 防御论证 / §6 测试映射 / §8 协议假设依据 / §9 契约改动 caller 审计逐字保留 R1 原文；ALLOW LIST 按立法「只增不删」扩展（+1 文件，SA4 比对集从 6 → 7）。
