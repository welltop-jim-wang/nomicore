/**
 * VFSL 标记类型（设计文档 §4）。
 *
 * 对 tsc 而言它们是恒等别名：编译期擦除，不影响 schema 文本的类型检查；
 * 对 VFSL 引擎而言它们是 Yjs 物化语义的标记，由 parser 识别并翻译进结构树。
 *
 * 同一段 schema 文本因此有两个消费者：编译期的 tsc 与运行期的 VFSL 解释器。
 */
export type YMap<T> = T;
export type YArray<T> = T;
export type YPlainArray<T> = T;
export type YLeaf<T> = T;
export type YXmlFragment = unknown;
export type Pattern<S extends string> = string;
