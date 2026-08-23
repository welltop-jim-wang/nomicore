/**
 * @nomicore/doc-runtime — Y.XmlFragment → XML 字符串投影序列化器（issue #94）。
 *
 * 模块内部件（不进公共面，与 xml-parse.ts 同纪律）。两个导出：
 * - escapeAttrValue：属性值转义（`"` → `&quot;`，仅此一项）；
 * - xmlFragmentToString：live Y.XmlFragment → 良构 XML 字符串（唯一公共投影入口）。
 *
 * 与 yjs 原生 toString 的唯一差异：Y.XmlElement 属性值中的 `"` 转义为 `&quot;`——
 * yjs 零转义投影（YXmlElement.js:124 `key + '="' + attrs[key] + '"'`）无法无损表示
 * 含 `"` 的属性值（SA5 A12 实证引号截断）。其余一切（元素名 toLocaleLowerCase、
 * 属性字母序、单空格连接、空元素显式闭合、YXmlText/YXmlHook 委托）逐字符镜像 yjs，
 * 保证不含 `"` 属性值的输出与 yjs toString 逐字节相同（设计 §8 实测 #3）。
 *
 * 转义纪律：只转义 `"`，禁止转义 `&`（及 `<`/`>`/`'`）——parse 侧不解码实体（规则 1），
 * 序列化侧转义 `&` 会破坏 `title="a&quot;b"` 字面实体值的语义等价 round-trip（T-13 反例，
 * 设计 §5.2）。escape 幂等：escape(escape(x)) === escape(x)。
 */
import * as Y from 'yjs';

/**
 * 属性值转义：仅 `"` → `&quot;`。
 * 非 string 值（observer / direct yjs API 可 set 任意值）经 `'' + v` 强转——与 yjs 原生
 * 字符串拼接（`key + '="' + attrs[key] + '"'`）同款的 ToPrimitive(hint "default") 语义：
 * 带 valueOf 的对象产出 valueOf 结果、symbol 抛 TypeError（被 extract E100 / ⑥ 变体 D
 * 既有崩溃边界收编），而非 String() 的 `[object Object]` / `Symbol(x)` 捏造值（SA2 MINOR #1）。
 * split/join 实现——零引擎依赖（不依赖 ES2021 replaceAll）。
 */
export function escapeAttrValue(v: unknown): string {
  return ('' + (v as string)).split('"').join('&quot;');
}

/** 投影子节点联合（XmlElement 继承自 XmlFragment，instanceof 判定须 element 在前）。 */
type XmlNodeLike = Y.XmlElement | Y.XmlText | Y.XmlHook | Y.XmlFragment;

/**
 * 唯一公共投影入口（模块内部件）：live Y.XmlFragment → 良构 XML 字符串。
 * 前置条件：fragment 必须已集成（doc !== null）——detached 类型的 getAttributes()
 * 读不到 prelim 属性、会静默丢属性；违反即实现缺陷，loud throw（拒绝虚假降级），
 * 不做静默空投影。当前唯一调用方 extract walk 恒传 live 值，本守卫为防御纵深。
 */
export function xmlFragmentToString(fragment: Y.XmlFragment): string {
  if (fragment.doc === null) {
    throw new Error('xmlFragmentToString: 收到未集成（detached）的 Y.XmlFragment——只接受 live 值');
  }
  return fragment.toArray().map(xmlNodeToString).join('');
}

/** 单节点投影：XmlElement 自渲染（属性值转义），其余类型委托 yjs 原生 toString。 */
function xmlNodeToString(node: XmlNodeLike): string {
  if (node instanceof Y.XmlElement) {
    const attrs = node.getAttributes() as Record<string, unknown>;
    const keys = Object.keys(attrs).sort(); // 镜像 yjs：默认字典序（YXmlElement.js:120 keys.sort()）
    const attrsStr = keys.length > 0
      ? ' ' + keys.map((k) => `${k}="${escapeAttrValue(attrs[k])}"`).join(' ')
      : '';
    const name = node.nodeName.toLocaleLowerCase(); // 镜像 yjs（YXmlElement.js:126）
    return `<${name}${attrsStr}>${node.toArray().map(xmlNodeToString).join('')}</${name}>`;
  }
  if (node instanceof Y.XmlFragment) {
    // 嵌套 Y.XmlFragment 子树（direct API 可把 fragment 嵌入 element 子位；SA2 MINOR #2 处置 a）：
    // fragment 无属性、子节点同构——递归渲染，封死后代元素属性值 `"` 不经转义输出（非良构）的缺口。
    return node.toArray().map(xmlNodeToString).join('');
  }
  return node.toString(); // YXmlText（逐字 span / 格式 delta 渲染）与 YXmlHook 委托 yjs 原生
}
