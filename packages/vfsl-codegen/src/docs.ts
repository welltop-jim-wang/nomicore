/**
 * docs 四槽（含 #307 memberDocs）→ TSDoc（§3.7）：walkDocs 文法镜像的语法路径构造
 * 在 emitter 内联（`${path}.${字段名}` / `.&lt;key&gt;` / `.&lt;item&gt;` / `.&lt;member N&gt;`）；
 * 本文件提供 TSDoc 块渲染——每条 doc 一行、逐字（测试断言原文在场）。
 *
 * 返回不含尾换行；调用方按所在位置（块位 / 行内位）自行拼接换行与缩进。
 */
export function tsdocLines(
  docs: readonly string[] | undefined,
  indent: string,
  opts?: { semicolonFree?: boolean },
): string {
  if (docs === undefined || docs.length === 0) return '';
  return docs.map((d) => tsdocBlock(d, indent, opts?.semicolonFree === true)).join('\n');
}

/**
 * 行内位 doc 块（#307 W2）：每条 doc 一块、按源序以单个空格串联（无缩进、无换行分隔），
 * 形如「块 + 空格 + 块」；调用方追加成员文本，块与成员起点之间恰一个空格。
 * 与块位共用 tsdocBlock 渲染（逐字、零新规范化；多行体逐字内嵌）。
 */
export function tsdocInline(docs: readonly string[] | undefined, opts?: { semicolonFree?: boolean }): string {
  if (docs === undefined || docs.length === 0) return '';
  return docs.map((d) => tsdocBlock(d, '', opts?.semicolonFree === true)).join(' ');
}

/** 单块 TSDoc 渲染（tsdocLines/tsdocInline 单一真相源，§3.7 既有表达式原样）。 */
function tsdocBlock(d: string, indent: string, semicolonFree: boolean): string {
  // 无分号模式下，多行 doc 的 `/**` 后不垫空格，避免首行留下行尾空格；
  // 默认模式保留既有字节，避免未选择新格式的消费方发生 freshness 漂移。
  return semicolonFree && d.startsWith('\n') ? `${indent}/**${d} */` : `${indent}/** ${d} */`;
}
