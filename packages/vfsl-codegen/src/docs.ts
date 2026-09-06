/**
 * docs 三槽 → TSDoc（§3.7）：walkDocs 文法镜像的语法路径构造在 emitter 内联
 * （`${path}.${字段名}` / `.&lt;key&gt;` / `.&lt;item&gt;` / `.&lt;member N&gt;`）；
 * 本文件提供 TSDoc 块渲染——每条 doc 一行、逐字（测试断言原文在场）。
 *
 * 返回不含尾换行；调用方按所在位置（块位 / 行内位）自行拼接换行与缩进。
 */
export function tsdocLines(docs: readonly string[] | undefined, indent: string): string {
  if (docs === undefined || docs.length === 0) return '';
  // 多行 doc 条目（以 \n 起始）：`/**` 后不垫空格——否则首行残留行尾空格，
  // semicolon-free 消费仓的 @stylistic/no-trailing-spaces 会拒绝生成物（issue #222 同 lint 门禁链）；
  // 续行与闭星行逐字保留源缩进。
  return docs.map((d) => (d.startsWith('\n') ? `${indent}/**${d} */` : `${indent}/** ${d} */`)).join('\n');
}
