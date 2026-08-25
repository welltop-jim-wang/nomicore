/**
 * @nomicore/namespace-runtime —— 投影器：SCHEMA 四键投影（D4）+ META 深拷贝（D5）。
 *
 * 投影器不是验证器，但必须是安全器（R2 修订后的精确表述）：
 * - 验证决策点单源在 vfsl compileSchemaEnvelope 严格门（ENV-1/2/3/4/5）；
 * - 本模块只承担一条不可下放的纪律——live writable Yjs 引用零出站（INV-N13）：
 *   · SCHEMA 四标准键持非 primitive 值（object≠null/function/symbol，覆盖一切
 *     Y.AbstractType/类实例/Uint8Array）时，公共模式 loud throw
 *     （SchemaProjectionError，code NSRT-SCHEMA-E1），P0 模式键省略
 *     （live 引用绝不进 compile 输入——缺键由 ENV-2 收编 → 数据级 unavailable）；
 *   · META 值域违规（嵌套 Yjs shared type / bigint / undefined / function / symbol /
 *     non-finite number / 非 plain 原型对象）loud throw（MetaProjectionError，
 *     code NSRT-META-E1），绝不静默跳键。
 *
 * 载体处置遵循「生产不可达 → loud / 生产合法可达 → 可观测缺席信号」单一判据（R2 修订，
 * SA2 #2）：
 * - SCHEMA 载体缺席 → null（经 createDoc/loadDoc 生产路径合法可达——两者均只
 *   校验 META.docId，完全不触碰 SCHEMA；共享套件「Permissive: correct docId,
 *   no SCHEMA, no ROOT」显式锁定宽容）；
 * - SCHEMA 载体异型（同名 Y.Text 等）→ 分流（rev2，评审项 6/SA8 裁决 D）：
 *   public 模式 loud throw（SchemaProjectionError / NSRT-SCHEMA-E2——载体损坏
 *   ≠ 缺席，静默映射 null 即虚假降级，镜像 META-E2 判据）；p0 模式 null →
 *   compile ENV-1 收编 → 数据级 unavailable（禁 fatal——保 SCHEMA write 修复
 *   路径；runP0 catch 对该态结构性不可达）；
 * - META 载体缺席/异型 → loud throw（NSRT-META-E2，生产路径不可达——createDoc/
 *   loadDoc 恢复均强制 getMap('META').get('docId')===docId，缺席/异型 doc 直接被拒；
 *   唯一例外是 seedForTest 测试设施）。
 *
 * 键纪律：
 * - 四键投影固定键集 ['lang','version','id','text']，不枚举全 keys——额外键结构性
 *   不出现；键缺席/显式 undefined（get(k)===undefined，yjs set undefined 后
 *   has=true 但 get=undefined，实测 §12 #4）→ 键省略（不写 undefined 值键）；
 * - 投影器返回全新对象，无共享可变引用（调用方突变不污染 runtime/后续读数）。
 *
 * proto-key 安全写入纪律（D5 R3 touch-up，SA4 F-1）：META 深拷贝的任何键写入（顶层
 * out 与嵌套 plain object 分支）经 putPlainKey（plain-data.ts，defineProperty 四真）
 * ——禁裸赋值 `out[k] = …`。机理：裸 `out['__proto__'] = v` 命中 Object.prototype.__proto__
 * accessor——标量值被 setter 静默忽略（键蒸发）；对象值替换 out 原型（键丢失 + 返回
 * 对象原型被 doc 内数据劫持）。本仓已知陷阱：doc-runtime read.ts putKey（E8/E9）与
 * extract.ts putSnapshotKey（R2.2/F-1 修复回流，注释明文「禁赋值式」）——本包重新引入
 * 即回归。defineProperty 写入使 '__proto__' 等危险键成为 own enumerable data
 * property（不触发原型 setter，Object.getPrototypeOf(out) 恒为 Object.prototype）。
 */
import * as Y from 'yjs';
import type { SchemaEnvelope } from '@nomicore/vfsl';
import { MetaProjectionError, SchemaProjectionError } from './errors.js';
import { describePlainValue, isPlainRecord, ownDataFact, putPlainKey, yjsFamilyWord } from './plain-data.js';

/** 投影模式：出站纪律不同，键集/缺席/异型语义相同（D4 双模式同源单点）。 */
export type SchemaProjectionMode = 'public' | 'p0';

/** SCHEMA 标准四键（vfsl SchemaEnvelope 恰四键，ADR-0007 冻结）。 */
const SCHEMA_KEYS = ['lang', 'version', 'id', 'text'] as const;

/**
 * SCHEMA 四键投影（D4）。三分支：
 * ① 载体缺席（share 无 'SCHEMA' 键）→ null（不惰性 getMap——零副作用）；
 * ② 载体异型（同名 Y.Text 等，getMap throw）→ public 模式 loud throw
 *    （SchemaProjectionError / NSRT-SCHEMA-E2——载体损坏 ≠ 缺席，禁静默 null）/ p0
 *    模式 null（→ compile ENV-1 收编 → 数据级 unavailable，禁 fatal）；
 * ③ Y.Map 存在 → 恰四键投影。
 * 值域守卫（R2 修订，SA2 #1）：非 primitive 值 → public 模式 throw
 * （SchemaProjectionError / NSRT-SCHEMA-E1）/ p0 模式键省略；
 * primitive 类型错（version 存 string 等）→ 原样带出（compile ENV-3 收编，不 coercion）。
 */
export function projectSchemaEnvelope(
  doc: Y.Doc,
  mode: SchemaProjectionMode,
): SchemaEnvelope | null {
  // ① 载体缺席：share.has === false → null（不创建惰性空 map；share 为 yjs 公开
  //    typed 属性，Doc.d.ts:44）
  if (!doc.share.has('SCHEMA')) {
    return null;
  }
  // ② 载体异型分流（rev2/评审项 6/SA8 裁决 D）：损坏 ≠ 缺席——public 模式 loud
  //    （镜像 projectMetadata ② 的 META-E2 形态）；p0 模式数据级 null（→ ENV-1 →
  //    unavailable——禁 fatal，保 SCHEMA write 修复路径）
  let sc: Y.Map<unknown>;
  try {
    sc = doc.getMap('SCHEMA');
  } catch (err) {
    if (mode === 'public') {
      throw new SchemaProjectionError(
        'NSRT-SCHEMA-E2',
        `SCHEMA 载体异型（同名条目非 Y.Map，观测异常：` +
          `${err instanceof Error ? err.message : String(err)}）——公共读取面拒绝把载体损坏` +
          `静默映射为缺席 null（NSRT-SCHEMA-E2）`,
      );
    }
    return null; // p0 模式：终点 unavailable（数据级），绝非 fatal
  }
  // ③ 四键投影（固定键集 + 值域守卫）
  const out: Record<string, unknown> = {};
  for (const k of SCHEMA_KEYS) {
    const v = sc.get(k);
    if (v === undefined) {
      continue; // 键缺席/显式 undefined → 键省略（不写 undefined 值键）
    }
    if (!isPrimitiveValue(v)) {
      // 值域守卫（INV-N13）：非 primitive（object≠null/function/symbol）覆盖一切
      // Y.AbstractType/类实例/可执行体——live writable 引用零出站
      if (mode === 'public') {
        throw new SchemaProjectionError(
          'NSRT-SCHEMA-E1',
          `SCHEMA 标准键 ${k} 持有非 primitive 值（观测 typeof ${typeof v}）：` +
            '公共读取面禁止带出 live Yjs 引用（NSRT-SCHEMA-E1）',
        );
      }
      continue; // p0 模式：违规键省略——live 引用绝不进 compile 输入；缺键由 ENV-2 收编
    }
    out[k] = v; // primitive 值（string/number/boolean/null/bigint）原样带出——
    //             类型错由 compile ENV-3 收编，不在本层收窄（ADR「不 coercion 或补
    //             默认值」；SA2 红灯反向锁定「不 throw」）
  }
  // double-cast 是记录「投影是原始数据，验证不在此层；类型声明 SchemaEnvelope 描述
  // 合规 doc（契约域）下的形状」——primitive 类型错的投影是显式记录的行为
  return out as unknown as SchemaEnvelope;
}

/** primitive 判据：非 object（含 null）/function/symbol——bigint 属 JSON 边缘 primitive，
 *  过守卫（N2 注记：bigint 非 live 引用不泄漏，进 compile 由 ENV-3/ENV-4 结构化收编）。 */
function isPrimitiveValue(v: unknown): boolean {
  return (
    (typeof v !== 'object' || v === null) && typeof v !== 'function' && typeof v !== 'symbol'
  );
}

/**
 * META 全键深拷贝（D5，R2 修订）。三分支：
 * ① 载体缺席 → 抛 MetaProjectionError（NSRT-META-E2）；
 * ② 载体异型 → 抛 MetaProjectionError（NSRT-META-E2，message 含观测载体异常信息）；
 * ③ Y.Map 存在 → 逐键深拷贝（值域违规 → NSRT-META-E1 loud throw，绝不静默跳键）。
 *
 * 返回 Record<string, unknown>（删除 nullable——载体异常不再是合法返回值，loud）。
 * 深拷贝必要性：yjs 以 ContentAny 存储平面值，get 返回同一对象引用，突变返回值会
 * 污染存储内容（实测 §12 #1④——getMetadata 必须每调用独立副本，测试 131-146 锚定）。
 */
export function projectMetadata(doc: Y.Doc): Record<string, unknown> {
  // ① 载体缺席：生产路径不可达（createDoc/loadDoc 均强制 META.docId 匹配，缺席 doc
  //    直接被拒；仅 seedForTest 测试设施可造）——loud，拒绝静默 null（虚假降级立法）
  if (!doc.share.has('META')) {
    throw new MetaProjectionError(
      'NSRT-META-E2',
      'META 条目缺席：经 createDoc/loadDoc 生产路径不可达（两者均强制 META.docId ' +
        '匹配校验，缺席 doc 直接被拒）；仅 seedForTest 测试设施可造——生产 handle 上' +
        '出现即上游 bug，拒绝静默 null',
    );
  }
  // ② 载体异型：getMap('META') 在 Y.Text 等同名条目上 throw → loud（同①判据）
  let meta: Y.Map<unknown>;
  try {
    meta = doc.getMap('META');
  } catch (err) {
    throw new MetaProjectionError(
      'NSRT-META-E2',
      `META 载体异型（同名条目非 Y.Map，观测异常：${err instanceof Error ? err.message : String(err)}）`,
    );
  }
  // ③ 逐键深拷贝（值域违规 → NSRT-META-E1 loud；键写入经 putPlainKey——D5 R3
  //    proto-key 安全写入纪律，SA4 F-1：禁裸赋值，防 '__proto__' 键丢失/原型劫持）
  const out: Record<string, unknown> = {};
  for (const k of meta.keys()) {
    putPlainKey(out, k, copyMetaValue(meta.get(k), `META.${k}`));
  }
  return out;
}

/**
 * META 值域深拷贝器（D5 值域纪律：ADR-0008「值只允许 JSON-compatible plain value，
 * 不允许嵌套 Yjs shared type」）。违规一律 loud throw（NSRT-META-E1），绝不静默跳键。
 */
function copyMetaValue(v: unknown, keyPath: string): unknown {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') {
    return v; // JSON 直通值
  }
  if (typeof v === 'number') {
    if (Number.isFinite(v)) {
      return v;
    }
    throw metaValueError(keyPath, `non-finite number（${describePlainValue(v)}）`);
  }
  if (typeof v === 'bigint' || typeof v === 'undefined' || typeof v === 'function' || typeof v === 'symbol') {
    throw metaValueError(keyPath, `值域违规：${typeof v}`);
  }
  if (v instanceof Y.AbstractType) {
    throw metaValueError(keyPath, `嵌套 Yjs shared type（${yjsFamilyWord(v)}）`); // AC4：plain 域禁嵌套 Yjs
  }
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (let i = 0; i < v.length; i++) {
      const hit = readableArrayElement(v, i);
      if (hit.kind !== 'ok') {
        throw metaValueError(`${keyPath}[${i}]`, hit.msg);
      }
      out.push(copyMetaValue(hit.value, `${keyPath}[${i}]`));
    }
    return out;
  }
  // typeof v === 'object'：plain 对象判据（原型链级；Date/RegExp/Map/Set/类实例 → loud）
  if (!isPlainRecord(v)) {
    throw metaValueError(keyPath, `非 plain 原型对象（${describePlainValue(v)}）`);
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) {
    const hit = readableOwnDataValue(v as Record<string, unknown>, k);
    if (hit.kind === 'skip') {
      continue; // accessor / non-enumerable → 键空间外（吸收，descriptor 读零执行）
    }
    if (hit.kind === 'undefined') {
      throw metaValueError(`${keyPath}.${k}`, '值域违规：undefined'); // F-2（R3 touch-up）：
      //  与顶层 Y.Map 键/数组元素处置对齐——undefined 值不吸收，loud（NSRT-META-E1）
    }
    // 子键写入经 putPlainKey——D5 R3 proto-key 安全写入纪律（SA4 F-1，禁裸赋值）
    putPlainKey(out, k, copyMetaValue(hit.value, `${keyPath}.${k}`));
  }
  return out;
}

function metaValueError(keyPath: string, msg: string): MetaProjectionError {
  return new MetaProjectionError('NSRT-META-E1', `${keyPath} 值域违规（${msg}）`);
}

/** plain object 键读取（descriptor 读，零 accessor 执行——经 plain-data.ts ownDataFact）。
 *  三分结果：
 *  - skip：缺键/原型链/non-enumerable/accessor → 键空间外（吸收，与 read.ts D5 同款）；
 *  - undefined：own enumerable data property 值为 undefined → 值域违规（F-2，R3
 *    touch-up：与顶层 Y.Map 键/数组元素处置对齐——不吸收，loud NSRT-META-E1）；
 *  - ok：own enumerable data property 值 → 递归。 */
function readableOwnDataValue(
  obj: Record<string, unknown>,
  key: string,
): { kind: 'ok'; value: unknown } | { kind: 'skip' } | { kind: 'undefined' } {
  const fact = ownDataFact(obj, key);
  if (fact.kind === 'missing' || fact.kind === 'non-enumerable' || fact.kind === 'accessor') {
    return { kind: 'skip' }; // 键空间外（吸收——非枚举/accessor 均不产出，descriptor 读零执行）
  }
  if (fact.kind === 'undefined-value') {
    return { kind: 'undefined' }; // 值域违规（不吸收——F-2 与顶层/数组元素对齐）
  }
  return { kind: 'ok', value: fact.value };
}

/** plain array 元素读取同款 descriptor 守卫（经 plain-data.ts ownDataFact）：越界 NONE
 *  （本循环不达）；在界 undefined / 稀疏空洞 / accessor 下标 → VIOLATION（位置语义不
 *  可省略，D4/D5，响亮失败）。【R2——SA2 R1 #3 / R2.1】'non-enumerable'：数组元素面
 *  现行语义是照常读值（不检查 enumerable，与对象键面的 skip 有意不同——数组元素无键
 *  空间概念）；子情形 value===undefined（如 defineProperty(arr, i, {})）→ 维持现行
 *  violation「数组位置 undefined 不可投影」（desc.value===undefined 检查不区分枚举性）。 */
function readableArrayElement(
  arr: unknown[],
  i: number,
): { kind: 'ok'; value: unknown } | { kind: 'violation'; msg: string } {
  if (i >= arr.length) {
    return { kind: 'violation', msg: '数组越界不可投影' };
  }
  const fact = ownDataFact(arr, i);
  if (fact.kind === 'missing') {
    return { kind: 'violation', msg: '数组位置 undefined 不可投影（稀疏空洞）' };
  }
  if (fact.kind === 'accessor') {
    return { kind: 'violation', msg: '数组下标 accessor 不可读取（零副作用纪律）' };
  }
  if (fact.kind === 'undefined-value') {
    return { kind: 'violation', msg: '数组位置 undefined 不可投影' };
  }
  if (fact.kind === 'non-enumerable') {
    // R2.1 子情形：non-enumerable ∧ value===undefined → 现行 violation 维持（不漂移
    // 到「值域违规：undefined」——消息即断言面）
    if (fact.value === undefined) {
      return { kind: 'violation', msg: '数组位置 undefined 不可投影' };
    }
    return { kind: 'ok', value: fact.value }; // 照常读值（现行不检查 enumerable）
  }
  return { kind: 'ok', value: fact.value };
}
