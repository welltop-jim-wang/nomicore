/**
 * docs 三槽 → TSDoc（§3.7）：walkDocs 文法镜像的语法路径构造在 emitter 内联
 * （`${path}.${字段名}` / `.&lt;key&gt;` / `.&lt;item&gt;` / `.&lt;member N&gt;`）；
 * 本文件提供 TSDoc 块渲染——每条 doc 一行、逐字（测试断言原文在场）。
 *
 * 返回不含尾换行；调用方按所在位置（块位 / 行内位）自行拼接换行与缩进。
 */
export function tsdocLines(docs: readonly string[] | undefined, indent: string): string {
  if (docs === undefined || docs.length === 0) return '';
  return docs.map((d) => `${indent}/** ${d} */`).join('\n');
}
