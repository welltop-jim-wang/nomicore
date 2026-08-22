/**
 * @nomicore/doc-runtime — 载体判定（carrierOf）+ ROOT 探针（probeRoot）。
 *
 * 设计 §4.1/§4.2（wiki/raw/task_doc-runtime-extract-yjs-snapshot_design.md）：
 * - 两层判定：carrierOf 为粗判（五值词汇表 + null 不可达态），细判（bigint/Date/
 *   类实例/内嵌 Y 类型等 JSON 值域断言）由 extract.ts 的 copyPlainValue 承担；
 * - ROOT 探针为四级 getter 级联（getMap → getArray → getXmlFragment → getText），
 *   只触碰 'ROOT' 名字空间（INV-7：SCHEMA/META 零接触）；yjs 异型构造函数 throw
 *   收敛为领域化失败（F5），缺席经 getMap 惰性创建空 map（D3，零 update 事件）。
 */
import * as Y from 'yjs';

/** 载体词汇表（SA6 F4 冻结）。'plain value' = 非 Yjs 类型的一切值（粗判口径）。 */
export type CarrierName = 'Y.Map' | 'Y.Array' | 'Y.XmlFragment' | 'Y.Text' | 'plain value';

/**
 * 粗判 live 值的实际载体。返回 null = 不可达态（调用方按崩溃边界处理，D9①）：
 * - undefined：walk 的缺失检测先行（D4：get()===undefined 视同缺席），到不了载体判定；
 * - function / symbol：直接 leaf/plain 位不可达（yjs set 期即抛 "Unexpected content
 *   type"）；但可经 plain 容器（数组元素/对象值）内嵌进入 doc——内嵌路由由
 *   copyPlainValue 尾分支捕获（§4.6），本函数对它们返回 null 即「非载体词可名状」；
 * - Y.AbstractType 家族的第五类变体（四类 instanceof 均不中）：公共写入路径造不出
 *   （XmlElement 借继承命中 XmlFragment 判别，Q2）。
 */
export function carrierOf(v: unknown): CarrierName | null {
  if (v instanceof Y.Map) return 'Y.Map';
  if (v instanceof Y.Array) return 'Y.Array';
  if (v instanceof Y.XmlFragment) return 'Y.XmlFragment'; // XmlElement extends YXmlFragment——Q2 命中本行
  if (v instanceof Y.Text) return 'Y.Text';
  if (v instanceof Y.AbstractType) return null; // 第五类变体防御（不可达）
  if (
    v === null || typeof v === 'string' || typeof v === 'number'
    || typeof v === 'boolean' || typeof v === 'bigint'
  ) return 'plain value'; // bigint 归 plain 域（R2/#2）——细判在 copyPlainValue 产真 issue
  if (typeof v === 'object') return 'plain value'; // 含 Array / 普通对象 / Date / 类实例——细判在 §4.6
  return null; // undefined（D4 先行拦截）+ function/symbol（直接位不可达；内嵌路由经尾分支）
}

/** ROOT 探针结局：仅 Y.Map 可继续提取；异型仅报 issue 用；全失败 = 不可达态 → 崩溃边界。 */
export type RootProbe =
  | { carrier: 'Y.Map'; map: Y.Map<unknown> } // 唯一可继续提取的结局
  | { carrier: 'Y.Array' | 'Y.XmlFragment' | 'Y.Text' }; // 异型：仅报 issue 用

/**
 * 四级探针级联（顺序冻结）：
 * ① getMap  ② getArray  ③ getXmlFragment  ④ getText
 * - ROOT 为 Y.Map（或缺席→惰性创建）：① 命中返回。缺席分支的创建实测零 update 事件（P4）。
 * - ROOT 为异型：① 抛（yjs 原生 throw，F5）→ ②③④ 依次探测；次级探针仅在 ROOT
 *   确已存在时执行（①已抛），返回已存在实例、无创建副作用（P1b/P2c/P3d）。
 * - 第四级全失败 = 公共 API 造不出的第五种 ROOT → 抛错由顶层崩溃边界收编 DOCRT-E100。
 */
export function probeRoot(doc: Y.Doc): RootProbe {
  try {
    return { carrier: 'Y.Map', map: doc.getMap('ROOT') };
  } catch { /* ROOT 存在且非 Y.Map */ }
  try {
    doc.getArray('ROOT');
    return { carrier: 'Y.Array' };
  } catch { /* 继续 */ }
  try {
    doc.getXmlFragment('ROOT');
    return { carrier: 'Y.XmlFragment' };
  } catch { /* 继续 */ }
  try {
    doc.getText('ROOT');
    return { carrier: 'Y.Text' };
  } catch { /* 不可达态 */ }
  throw new Error('ROOT 载体探针全失败（公共 API 造不出第五种 ROOT）'); // → 崩溃边界 DOCRT-E100
}
