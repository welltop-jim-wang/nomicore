/**
 * 编译期路径投影协议（设计文档 §8，机制借鉴 DSH Typert）。
 *
 * 定位：`__schema__` 文本的受检镜像——由生成器产出、CI 校验，
 * 不参与运行时判定、不承担权威。运行时校验管“进来的数据”，
 * 本协议管“自己写的代码”：手写字面量路径在编译期投影出精确值类型。
 */

declare const VALUE: unique symbol;
declare const KIND: unique symbol;
declare const UNKNOWN_PATH: unique symbol;

/** 路径节点的载体接口：tsc 视角是恒等包装，运行时擦除。 */
export interface PathSchema<Value, Kind extends string = string> {
  readonly [VALUE]: Value;
  readonly [KIND]: Kind;
}

/**
 * 未知路径的 fail-closed 标记。
 * never 是底部类型，用在输出位置会被静默接受，
 * 因此未知路径投影成带路径信息的 UnknownPath，输入/输出位置都拒绝。
 */
export interface UnknownPath<Path extends readonly string[]> {
  readonly [UNKNOWN_PATH]: Path;
}

export type PathValue<P> = P extends PathSchema<infer V, string>
  ? V
  : P extends UnknownPath<readonly string[]>
    ? P
    : never;

export type PathKind<P> = P extends PathSchema<unknown, infer K>
  ? K
  : P extends UnknownPath<readonly string[]>
    ? P
    : never;

/**
 * 空路径表：各领域包通过 `declare module '@nomicore/vfsl-protocol'` 增广，
 * 用嵌套类型树镜像结构树（设计文档 §8.3）。
 */
export interface VfslPathMap {}

/** 路径段元组 → 路径表中的节点；任何一段走丢都得到 UnknownPath。 */
export type PathAt<Map, Path extends readonly string[]> = Path extends readonly [
  infer Head extends string,
  ...infer Tail extends readonly string[],
]
  ? Head extends keyof Map
    ? Tail['length'] extends 0
      ? Map[Head]
      : PathAt<Map[Head], Tail>
    : UnknownPath<Path>
  : UnknownPath<Path>;
