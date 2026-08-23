# [Bug] XML logical validation 与 materialization 属性引号接受域不一致（单引号属性内双引号被物化器拒绝）

**Status**: analyzed | **Date**: 2026-08-23
**Severity**: medium
**Type**: new-feature-defect (introduced at: `8d1e92c4b1e618663af9d68333b9a332885dd012`, PR #84, issue #74 materializeRoot)
**Layer**: multi-service（`@nomicore/vfsl` 校验层 ↔ `@nomicore/doc-runtime` 物化/提取层）

## Symptoms

同一份 logical snapshot 中的 XML 字符串，两个公共入口给出相反结论：

```text
snapshot = { body: `<p title='a"b'>x</p>` }   // schema: type ROOT = { body: YXmlFragment<{ p: string }> };

validateLogicalSnapshot(derived, snapshot) → ok:true
materializeRoot(derived, snapshot, doc)     → ok:false
  issues = [{ message: "XML 解析失败（ROOT.body）：属性 title 值含双引号", path: ["body"] }]
```

- 属性值 `a"b` 包在**单引号**内，按 XML 规范与 VFSL 良构规则是合法字面量；doc-runtime 物化器却在解析**成功之后**无条件拒绝值内任意 `"`。
- 对偶输入 `<p title="a'b">x</p>`（双引号属性内单引号）两侧均通过——拒绝是单侧、单字符的，证明不是统一的领域规则而是跨层差异。
- 后果：通过 logical validation 的 snapshot 无法经唯一公共物化入口完成 materialize → extract → revalidate 闭环，违反 Issue #74 / ADR-0007 的 XML 语义 round-trip 意图。

## Reproduction

环境：worktree `main`（merge `b0512aa1`，含 PR #84），`pnpm install --frozen-lockfile` 后 `pnpm exec tsx` 运行下述临时脚本（已删除）：

```ts
import * as Y from 'yjs';
import { evaluate, parseVfsl, validateLogicalSnapshot } from '@nomicore/vfsl';
import { materializeRoot } from './packages/doc-runtime/src/index.js';

const derived = /* parseVfsl + evaluate */ 'type ROOT = { body: YXmlFragment<{ p: string }> };';
const snapshot = { body: `<p title='a"b'>x</p>` };
validateLogicalSnapshot(derived, snapshot);        // → ok:true
materializeRoot(derived, snapshot, new Y.Doc());   // → ok:false（属性 title 值含双引号）
```

实测输出（`[SA5-DIAG]` 脚本，yjs@13.6.32 / Node 24）：

```text
[SA5-DIAG] target: 单引号属性内双引号
  input              : "<p title='a\"b'>x</p>"
  validateLogical    : ok=true
  materializeRoot    : ok=false issues=[{"message":"XML 解析失败（ROOT.body）：属性 title 值含双引号","path":["body"]}]
  zero-write (bytes) : yes
[SA5-DIAG] contrast: 双引号属性内单引号
  validateLogical    : ok=true
  materializeRoot    : ok=true
```

既有测试即包含此复现：`packages/doc-runtime/test/materialize-root.test.ts:839`（C-8）以它为**预期失败**断言锁定。

## Investigation

阅读（按序）：`wiki/raw/task_xml-attr-quote-domain.md`、`task_xml-attr-quote-domain_relevant_decisions.md`、`packages/doc-runtime/src/xml-parse.ts`、`packages/vfsl/src/xml.ts`、`packages/doc-runtime/src/materialize.ts`、`packages/doc-runtime/src/extract.ts`（xml 分支）、`packages/doc-runtime/test/materialize-root.test.ts`（C-8/X-F9/RT-5 段）。

数据流追踪（materialize 写路径）：

```
materializeRoot (materialize.ts:97)
 └─ prepare (:446)
     ├─ ① validateLogicalSnapshot (vfsl/src/validate.ts:511 → vfsl/src/xml.ts wellFormedXml)   ← 宽域：放行
     └─ ② buildTopEntries → buildValue case 'xml-fragment' (materialize.ts:530-535)
         └─ parseXmlToFragment → scan (xml-parse.ts:98)
             └─ 属性循环 :196-214 —— 配对引号正确解析出 value='a"b' 后，
                :209-211 `if (value.includes('"')) return err('属性 … 值含双引号')`   ← 窄域：拒绝
```

两台扫描器骨架逐条镜像（xml-parse.ts 头部声明"骨架逐条镜像 vfsl xml.ts"），唯一语义分叉就是这一条**解析成功后的附加拒绝**。VFSL 侧 `xml.ts:69-81` 按 XML 规范处理引号：开引号扫到**配对**闭引号（另一引号字符不闭合），值内一切字符为字面量，对 `"` 无任何限制。

拒绝动机（git 考古 + 设计文档）：PR #84（`8d1e92c`，2026-08-23）引入 `xml-parse.ts` 与 C-8 测试。issue #74 设计文档 `task_doc-runtime-materialize-root_design.md` §4.6 规则 3 / D7 / B6 明文"定谳"：yjs `XmlElement.toString()` 按字母序输出属性且**不转义属性值**（A12 实证：`alt='an "alt" & <tag>'` → `alt="an "alt" & <tag>"`，引号截断），故"单引号原值含双引号经 yjs 双引号重排后必破坏良构性"→ 解析期响亮拒绝，且被测试 C-8/X-F9 锁定为"有意 materialization 约束"。

对该动机的实证复核（本机 yjs@13.6.32，源码 `src/types/YXmlElement.js` toString）：

```js
stringBuilder.push(key + '="' + attrs[key] + '"')   // 无条件双引号 + 零转义
```

实测：把 `title='a"b'` 的语义值 `a"b` set 进 XmlElement 并集成到 doc 后：

```text
[SA5-DIAG] yjs stored attr a"b → toString() = "<p title=\"a\"b\">x</p>"
[SA5-DIAG] 该输出再过 validateLogicalSnapshot → ok:false（"YXmlFragment 值不是良构 XML：属性缺少 \"=\"：b"）
```

即：拒绝所防御的 extract 侧风险**真实存在**（若只删检查、不动序列化，round-trip 会坏在 `extractYjsSnapshot` → `extract.ts:138` 的 `(live as Y.XmlFragment).toString()`），但防御位置错了——用收窄②构造域补偿③序列化层的表示缺陷，造成与①逻辑域不一致。

## Root Cause

**缺陷行：`packages/doc-runtime/src/xml-parse.ts:209-211`**（`scan()` 属性循环，引入于 `8d1e92c4b1e618663af9d68333b9a332885dd012` / PR #84）——对已按配对引号正确解析出的属性值无条件拒绝 `value.includes('"')`，不区分外层引号是单引号还是双引号。它把"extract 侧 yjs `XmlElement.toString()`（`YXmlElement.js` toString：`key + '="' + value + '"'`，零转义）无法无损表示含 `"` 的属性值"这一**序列化层表示缺陷**，前移成了**输入域收窄**，使 ② materialize 构造域严格窄于 ① VFSL `wellFormedXml`（`packages/vfsl/src/xml.ts:16`，按 XML 规范接受单引号属性内 `"` 字面量）逻辑域。

耦合点（修复必须同步一致，否则只移动断点）：
1. `extract.ts:138` —— XML 读回直接用 `Y.XmlFragment.toString()`，是表示缺陷的源头（零转义双引号投影）。
2. `xml-parse.ts:63-79 canonicalXmlOf` / `renderCanonicalNode:76`（`` ` ${k}="${v}"` ``）—— canonical 渲染同样无条件双引号零转义，靠 :209 的拒绝保证"归一化无歧义"（materialize.ts:341-353 productEqual 与 rev2 ⑥ 校验消费它）。
3. 契约锁定测试：`materialize-root.test.ts:839`（C-8"构造期拒绝——§4.1 定谳的有意 materialization 约束"）；另 `materialize-root-rev2.test.ts:585-599`（RT-5：observer 注入含双引号属性值 → canonical 扫描失败 → DOCRT-E201）锚定了 extract 侧当前无转义能力下的防线行为，修复时需一并重新审视。

类型定谳：**new-feature-defect**（非回归）——`wellFormedXml` 自 `46f7632`（PR #17，ADR 0003）起即为宽域；分叉诞生于 PR #84 的 materializeRoot 实现及其设计期 D7 规则 3"定谳"，从未存在两域一致的正常时期。系统性检查：同类"yjs 序列化投影"问题中文本 span（逐字、不解码实体）与 `<`/`>`/`&`/`'` 属性字符均往返安全（规则 1-2 注释 + 测试 X-1/X-3），属性值含 `"` 是唯一被收窄的实例，属孤立缺陷而非模式性漏洞。

**Fix direction**（供 SA1 设计参考，不展开实现）：
在 doc-runtime 侧为属性值提供无损表示/正确转义（如在 XML 字符串投影面把属性值中的 `"` 转义为 `&quot;`——注意设计 B6 驳斥的是"**静默**转义/跳过属性"，任务简报要求的是可再校验的对称转义；或 extract 侧弃用裸 `Y.XmlFragment.toString()` 改用自建序列化器），并同步 `canonicalXmlOf` 的渲染规则，使 ① wellFormedXml、② materialize 扫描器、③ extract/canonical 序列化器对同一 XML 子集使用一致规则；同时删除/改写 C-8 契约测试（AC 明示），重审 RT-5。备选路径（收窄 VFSL 逻辑域）触碰 ADR-0001 方言冻结与 ADR-0003"仅要求良构 XML"，须先走显式 ADR 演进，任务简报已声明不采隐式差异。

## Evidence

1. 症状复现输出（见 Reproduction，`[SA5-DIAG]` 临时脚本，运行后已删除；零写入双证 target case `encodeStateAsUpdate` 逐字节不变）。
2. 缺陷代码 `xml-parse.ts:206-212`：
   ```ts
   const valueEnd = s.indexOf(quote, j + 1); // 配对闭引号（另一引号字符不闭合）
   if (valueEnd === -1) return { kind: 'err', reason: `属性值引号未闭合：${attrName}` };
   const value = s.slice(j + 1, valueEnd);
   if (value.includes('"')) {
     // D7 规则 3：yjs 序列化器不转义属性值（A12）——双引号值必产出不可再校验文档
     return { kind: 'err', reason: `属性 ${attrName} 值含双引号` };
   }
   ```
3. VFSL 接受域 `xml.ts:69-81`（配对引号、值内字面量、无 `"` 限制）+ 头注释 §R2：`<p title="a>b">` 良构。
4. yjs 序列化器 `node_modules/.pnpm/yjs@13.6.32/.../src/types/YXmlElement.js` toString（字母序 + `key + '="' + attrs[key] + '"'` 零转义）；实测 `a"b` → `<p title="a"b">x</p>` → revalidate ok:false（"属性缺少 \"=\"：b"）。
5. 引入 commit：`git log -S '值含双引号' -- packages/doc-runtime/src/xml-parse.ts` → `8d1e92c4b1e618663af9d68333b9a332885dd012 2026-08-23 feat(doc-runtime): materializeRoot …(#84)`；设计依据 `task_doc-runtime-materialize-root_design.md` §4.6 规则 3（:578-582）、D7（:48）、B6（:697）。
6. 契约锁定：`materialize-root.test.ts:839`（C-8/X-F9）、`materialize-root-rev2.test.ts:585-599`（RT-5）。
7. 对照组：`<p title="a'b">x</p>` 完整 round-trip（materialize ok → extract → `<p title="a'b">x</p>`，语义等价 revalidate ok），证明 `'` 通道与双引号通道的不对称仅在 `"` 单字符、materialize 单侧。
