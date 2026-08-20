/**
 * 纯值上下文投影（§3.6）：ValueSchema → TS 值类型文本。
 * 仅用于 plain/leaf 值位与别名终态；ref 沿 values 表内联展开，遇环 → 响亮拒绝
 * （纯值自引用是方言病理；结构侧 ref 环经具名别名天然安全，两套机制互不混淆）。
 */
import type { ValueField, ValueSchema } from '@nomicore/vfsl';

/** 纯值上下文 ref 环（§3.6）：方言病理，响亮拒绝，绝不静默截断。 */
export class ValueContextCycleError extends Error {
  constructor(name: string) {
    super(`纯值上下文 ref 环: '${name}' 自引用（方言病理，响亮拒绝）`);
    this.name = 'ValueContextCycleError';
  }
}

/**
 * 值投影：scalar → 标量名；enum → 字面量联合（声明序，字符串单引号）；pattern/xml → string；
 * array → V[]；object → 对象字面量（Record 形 → Record<string, …>）；union → 成员 | 成员；
 * optional → 内层（可选性在字段位以 ?: 表达）；ref → 被引别名值投影的内联展开。
 */
export function projectValue(
  v: ValueSchema,
  values: Record<string, ValueSchema>,
  stack: readonly string[] = [],
): string {
  switch (v.kind) {
    case 'scalar':
      return v.type;
    case 'enum':
      return v.values.map((lit) => (typeof lit === 'string' ? `'${lit}'` : String(lit))).join(' | ');
    case 'pattern':
      return 'string';
    case 'xml':
      return 'string';
    case 'array':
      return `${projectValue(v.element, values, stack)}[]`;
    case 'object': {
      const recordField = v.fields.length === 1 && v.fields[0]?.name === '<key>' ? v.fields[0]! : undefined;
      if (recordField !== undefined) {
        return `Record<string, ${projectValue(recordField.value, values, stack)}>`;
      }
      return `{ ${v.fields.map((f) => projectField(f, values, stack)).join('; ')} }`;
    }
    case 'union':
      return v.members.map((m) => projectValue(m, values, stack)).join(' | ');
    case 'optional':
      return projectValue(v.value, values, stack);
    case 'ref': {
      if (stack.includes(v.name)) throw new ValueContextCycleError(v.name);
      const target = values[v.name];
      if (target === undefined) {
        throw new Error(`未知别名 '${v.name}'（纯值上下文 ref 展开）`);
      }
      return projectValue(target, values, [...stack, v.name]);
    }
  }
}

/** 对象字段投影：optional 包装 → `'name'?: …`（可选性在字段位以 ?: 表达）。 */
function projectField(f: ValueField, values: Record<string, ValueSchema>, stack: readonly string[]): string {
  if (f.value.kind === 'optional') {
    return `'${f.name}'?: ${projectValue(f.value.value, values, stack)}`;
  }
  return `'${f.name}': ${projectValue(f.value, values, stack)}`;
}
