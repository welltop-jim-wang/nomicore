/**
 * @nomicore/namespace-runtime —— descriptor-safe 共享原语层（rev2/评审项 7/SA8 裁决 F：
 * walker 共享——共享原语层、不统一遍历器）。
 *
 * 共享范围（三族纯函数 + 一个判据）：
 * - descriptor 读取事实：`ownDataFact`（零执行——getOwnPropertyDescriptor 元数据读，
 *   不触发 accessor、不读原型链值）；
 * - 安全写入：`putPlainKey`（defineProperty 四真）；
 * - 申报词：`yjsFamilyWord` / `describePlainValue`（message 用，不进入任何稳定码）；
 * - 判据：`isPlainRecord`（仅 projection 消费——write.ts 的对象分支用更严的单级原型
 *   判据，子类即拒，语义不同，不共用——防行为回归）。
 *
 * 不统一遍历器（SA8 F 明示）：projection 与 write 两个 walker 的失败语义（throw vs
 * 收编 issue/skip）、冻结纪律（不冻结 vs 后序递归冻结）、循环策略（原型链 32 层上限
 * vs 祖先路径集）、plain 判据（链上溯 vs 单级严格）是各自被测试锚锁定的契约面——本
 * 模块只共享上述原语，遍历器与失败分级各自保留。
 *
 * 模块纪律：包内实现模块——index.ts 不导出（ADR 对包内模块结构沉默，无条款冲突）；
 * 任何消费方经相对路径导入。本模块零 yjs 依赖（纯 ES 反射），不 import 任何包内模块
 * （原语层不允许反向依赖，防环）。
 */
export type OwnDataFact =
  | { kind: 'missing' }          // 无 own descriptor（缺键 / 原型链）
  | { kind: 'non-enumerable'; value: unknown } // own 但 enumerable !== true（data 值已知，零执行）
  | { kind: 'accessor' }         // desc.get/set 存在（不执行）
  | { kind: 'undefined-value' }  // own enumerable data 值为 undefined
  | { kind: 'ok'; value: unknown };

/** own descriptor 事实（零执行）。判据次序：missing → accessor → non-enumerable →
 *  undefined-value → ok（accessor 先于 non-enumerable——非枚举 accessor 在数组元素面
 *  现行 violation「数组下标 accessor 不可读取」须逐字节保留，判据次序即消息面）。
 *  【R2——SA2 R1 #3】'non-enumerable' 携带 value：数组元素面（readableArrayElement）
 *  现行语义是「照常读值」（不检查 enumerable），需要值；对象键面（readableOwnDataValue）
 *  才把 non-enumerable 归为 skip——两个消费面有意不同，kind 必须带值以支撑前者。 */
export function ownDataFact(target: object, key: string | number): OwnDataFact {
  const desc = Object.getOwnPropertyDescriptor(target, key);
  if (desc === undefined) {
    return { kind: 'missing' };
  }
  if (desc.get !== undefined || desc.set !== undefined) {
    return { kind: 'accessor' };
  }
  if (desc.enumerable !== true) {
    return { kind: 'non-enumerable', value: desc.value };
  }
  if (desc.value === undefined) {
    return { kind: 'undefined-value' };
  }
  return { kind: 'ok', value: desc.value };
}

/** plain record 判据（原型链上溯 ≤32 层防循环，链上每个非 Object.prototype 节点的
 *  own constructor 须缺失或为 Object/undefined——Date/Map/Set/RegExp/类实例 → 非
 *  plain；全程 descriptor 读）。[projection 消费——write.ts 的对象分支用更严的单级
 *  原型判据（子类即拒），语义不同，不共用——防行为回归] */
export function isPlainRecord(v: object): boolean {
  let cur: object | null = v;
  for (let depth = 0; depth < 32; depth++) {
    const proto = Object.getPrototypeOf(cur);
    if (proto === null) {
      return true; // Object.prototype 或 null-proto 链尾
    }
    if (proto !== Object.prototype) {
      const desc = Object.getOwnPropertyDescriptor(proto, 'constructor');
      if (desc !== undefined) {
        if (desc.get !== undefined || desc.set !== undefined) {
          return false;
        }
        if (typeof desc.value === 'function' && desc.value !== (Object as unknown)) {
          return false;
        }
      }
    }
    cur = proto;
  }
  return false; // 超深/循环链 → 保守 loud
}

/** defineProperty 四真安全写入（writable/enumerable/configurable 全 true）——
 *  '__proto__' 等 own 键不触发原型 setter、不劫持产物原型（E8/E9/F-1 纪律；
 *  仓内先例 read.ts putKey / extract.ts putSnapshotKey / detached-build.ts
 *  copyJsonDomain）。 */
export function putPlainKey(out: object, key: string, value: unknown): void {
  Object.defineProperty(out, key, { value, writable: true, enumerable: true, configurable: true });
}

/** Yjs 家族申报词（构造器名，兜底 'Y.AbstractType'）——message 用。 */
export function yjsFamilyWord(v: unknown): string {
  const ctor = (v as { constructor?: { name?: string } } | null | undefined)?.constructor?.name;
  return typeof ctor === 'string' && ctor.length > 0 ? ctor : 'Y.AbstractType';
}

/** 诊断词（finite 描述 / 构造器名 / typeof 三态）——message 用。 */
export function describePlainValue(v: unknown): string {
  if (typeof v === 'number') {
    return String(v);
  }
  if (typeof v === 'object' && v !== null) {
    const ctor = (v as { constructor?: { name?: string } }).constructor?.name;
    return typeof ctor === 'string' && ctor.length > 0 ? ctor : 'object';
  }
  return typeof v;
}
