/**
 * issue #333（T0 pre-factor）验收仪器 —— readData 成功分支「形状断言」扫描器。
 *
 * 背景：readData 成功分支为恰三键 `{ ok: true, value, schema }`（ADR-0016；
 * T3/ADR-0024 将破坏性修订为恒五键）。该形状的断言在 runtime 与 registry 测试中
 * 散布 20+ 处，T0 要把它们收敛为统一 helper / 集中化形状构造，使 T3 的形状修订只改
 * 一处。本文件提供**可复用的 AST 扫描器**，供
 * `readdata-shape-assertion-consolidation-gate.test.ts`（收敛门 + 仪器敏感性自控）使用。
 *
 * 仪器语义（AST 级，非文本/正则匹配——本仪器只回答一个问题：**还有多少处断言把成功
 * 分支的恰三键形状字面写死**；运行时行为验证由既有 readData 套件与 SA6 报告的突变
 * 探针承担，本仪器不替代行为验证）：
 *
 * family A（`deep-equal-literal`）命中 = 满足全部条件的调用实参对象字面量：
 *   1. 被调方法 ∈ { toEqual, toStrictEqual, deepStrictEqual, deepEqual }（深等家族；
 *      `.not.toEqual` 同样命中——它也把形状字面写死）；
 *   2. 实参是对象字面量（解开 as const / 括号 / 非空断言包装）；
 *   3. 含 `ok` 且初值为字面 `true`（`true as const` 亦算）；
 *   4. 含 `schema` 键（任何值——含 oracle 调用 / 对象字面量 / null）；
 *   5. 无 spread（`{...x}` 形态不能静态判定键集，单独标记）。
 *
 * family B（`exact-key-set-literal`）命中 = 成功分支键集的整键集断言：
 *   1. 被调方法 ∈ 深等家族；
 *   2. 实参是恰三元素字符串数组字面量，集合等于 { ok, schema, value }（顺序无关）；
 *   3. 断言主语的表达式子树里出现 `Object.keys(...)` / `Reflect.ownKeys(...)` 调用
 *      （把「这个读结果恰三键」写死为字面量——T3 五键修订同样必须逐处改）。
 *
 * 不命中（刻意的负样本族，见门测试敏感性自控）：
 *   - doc-runtime 成功分支恰两键 `{ ok: true, value }`（ADR-0016 分层：只进 schema 的
 *     组合边界才升级三键）——无 `schema` 键 / 键集数组不含 schema；
 *   - 失败分支 `{ ok: false, code, path }`——`ok` 非 true；
 *   - `toMatchObject({ ok: true, value, schema })`——加法兼容断言（负控文件刻意保持
 *     新旧形状均可绿），不是「恰三键」全等断言；
 *   - 已集中化的形态 `toEqual(readDataOk(value, schema))` 或
 *     `toEqual(expected)`（实参是 CallExpression / 标识符——AC1 允许的「集中化形状
 *     构造」正是这种形态）。
 *
 * 另附**形状制造点**（producers）扫描：对象字面量同时含 `ok: true` / `value` /
 * `schema`，典型是测试替身的 `readData: () => ({ ok:true, value, schema:null })`。
 * AC1 的「或等价的集中化形状构造」允许这部分也收敛；但它是**报告项、不是门项**
 * （门只约束断言，避免越界的强约束）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

/** 仓库根（本文件位于 packages/namespace-runtime/test/helpers）。 */
export const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/** T0（issue #333）作用域：runtime 与 registry 两个测试树。 */
export const SHAPE_ASSERTION_SCOPE = [
  'packages/namespace-runtime/test',
  'packages/namespace-registry/test',
] as const;

/** 深等家族方法名（全等断言；toMatchObject 等加法兼容断言刻意排除）。 */
export const DEEP_EQUAL_METHODS = ['toEqual', 'toStrictEqual', 'deepStrictEqual', 'deepEqual'] as const;

/** readData 成功分支恰三键键集（ADR-0016；T3 将修订为五键）。 */
export const SUCCESS_SHAPE_KEYS = ['ok', 'schema', 'value'] as const;

export type ShapeAssertionKind = 'deep-equal-literal' | 'exact-key-set-literal';

export interface ShapeAssertionSite {
  /** worktree-relative POSIX 路径。 */
  readonly file: string;
  /** 1-based 行号。 */
  readonly line: number;
  /** 1-based 列号。 */
  readonly column: number;
  readonly kind: ShapeAssertionKind;
  /** 深等方法名。 */
  readonly method: string;
  /** 断言是否被 `.not` 取反。 */
  readonly negated: boolean;
  /** family A = 对象字面量键名（出现序）；family B = 被断言的键集数组。 */
  readonly keys: readonly string[];
  /** family A：是否含 spread（键集不可静态判定）。family B：恒 false。 */
  readonly hasSpread: boolean;
  /** 命中行原文（截断 200 字符，便于报告定位）。 */
  readonly snippet: string;
}

export interface ShapeProducerSite {
  /** worktree-relative POSIX 路径。 */
  readonly file: string;
  /** 1-based 行号。 */
  readonly line: number;
  /** 对象字面量键名（出现序）。 */
  readonly keys: readonly string[];
  /** 该对象字面量是否同时是深等断言的实参（即 assertion site）。 */
  readonly isAssertionArgument: boolean;
  readonly snippet: string;
}

export interface ShapeScanResult {
  /** 实际扫描过的文件（worktree-relative POSIX 路径，升序）。 */
  readonly filesScanned: readonly string[];
  /** 未集中化的成功形状断言（门项：T0 后必须为空）。 */
  readonly assertionSites: readonly ShapeAssertionSite[];
  /** 形状制造点（报告项：测试替身/常量构造）。 */
  readonly producerSites: readonly ShapeProducerSite[];
}

function unwrap(node: ts.Expression): ts.Expression {
  let current: ts.Expression = node;
  while (
    ts.isAsExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isLiteralTrue(node: ts.Expression): boolean {
  return unwrap(node).kind === ts.SyntaxKind.TrueKeyword;
}

interface ObjectShape {
  readonly keys: string[];
  readonly okTrue: boolean;
  readonly hasValue: boolean;
  readonly hasSchema: boolean;
  readonly hasSpread: boolean;
  readonly node: ts.ObjectLiteralExpression;
}

function readObjectShape(expr: ts.Expression): ObjectShape | null {
  const node = unwrap(expr);
  if (!ts.isObjectLiteralExpression(node)) return null;
  const keys: string[] = [];
  let okTrue = false;
  let hasValue = false;
  let hasSchema = false;
  let hasSpread = false;
  for (const property of node.properties) {
    if (ts.isSpreadAssignment(property)) {
      hasSpread = true;
      continue;
    }
    if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
      const name = ts.isIdentifier(property.name)
        ? property.name.text
        : ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)
          ? property.name.text
          : null;
      if (name === null) continue;
      keys.push(name);
      if (name === 'ok' && ts.isPropertyAssignment(property) && isLiteralTrue(property.initializer)) {
        okTrue = true;
      }
      if (name === 'value') hasValue = true;
      if (name === 'schema') hasSchema = true;
    }
  }
  return { keys, okTrue, hasValue, hasSchema, hasSpread, node };
}

interface DeepEqualCall {
  readonly method: string;
  readonly negated: boolean;
  readonly argument: ts.Expression;
  readonly call: ts.CallExpression;
}

function readDeepEqualCall(node: ts.CallExpression): DeepEqualCall | null {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  const method = callee.name.text;
  if (!(DEEP_EQUAL_METHODS as readonly string[]).includes(method)) return null;
  const link = callee.expression;
  const negated = ts.isPropertyAccessExpression(link) && link.name.text === 'not';
  const first = node.arguments[0];
  if (first === undefined) return null;
  return { method, negated, argument: first, call: node };
}

/** family B：`expect(<含 Object.keys(...) 的表达式>).toEqual(['ok','schema','value'])`。 */
function readExactKeySetArgument(call: DeepEqualCall): readonly string[] | null {
  const argument = unwrap(call.argument);
  if (!ts.isArrayLiteralExpression(argument)) return null;
  const values: string[] = [];
  for (const element of argument.elements) {
    if (!ts.isStringLiteral(element)) return null;
    values.push(element.text);
  }
  if (values.length !== SUCCESS_SHAPE_KEYS.length) return null;
  if ([...values].sort().join('\u0000') !== [...SUCCESS_SHAPE_KEYS].sort().join('\u0000')) return null;
  if (!subjectReadsOwnKeys(call.call)) return null;
  return values;
}

/**
 * 取「深等断言的主语」：`expect(<subject>).toEqual(...)` 的 `<subject>`。
 *
 * TS AST 事实：`expect(x).toEqual(y)` 是**单个** CallExpression——其 `expression` 为
 * PropertyAccessExpression(`expect(x).toEqual`)，实参为 `[y]`；主语在
 * `expression.expression` 的 `expect(...)` 调用的第一个实参上。`.not` 链
 * （`expect(x).not.toEqual(y)`）多一层 PropertyAccess。
 */
function expectSubject(deepEqualCall: ts.CallExpression): ts.Expression | null {
  const callee = deepEqualCall.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  let receiver: ts.Expression = callee.expression;
  if (ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'not') {
    receiver = receiver.expression;
  }
  if (ts.isCallExpression(receiver)) return receiver.arguments[0] ?? null;
  return null;
}

/** 断言主语子树中是否有 Object.keys / Reflect.ownKeys 调用。 */
function subjectReadsOwnKeys(deepEqualCall: ts.CallExpression): boolean {
  const subject = expectSubject(deepEqualCall);
  if (subject === null) return false;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      const receiver = node.expression.expression;
      const receiverName = ts.isIdentifier(receiver) ? receiver.text : null;
      if ((name === 'keys' && receiverName === 'Object') || (name === 'ownKeys' && receiverName === 'Reflect')) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(subject);
  return found;
}

function snippetOf(source: ts.SourceFile, node: ts.Node, text: string): string {
  const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
  return text.split('\n')[line]!.trim().slice(0, 200);
}

/**
 * 对一段源码做形状断言扫描（供门测试用正/负样本做仪器敏感性自控）。
 * `fileName` 仅用于 SourceFile 标识，不参与判定。
 */
export function scanSourceForSuccessShapeAssertions(sourceText: string, fileName = 'sample.ts'): ShapeAssertionSite[] {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const sites: ShapeAssertionSite[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const call = readDeepEqualCall(node);
      if (call !== null) {
        const shape = readObjectShape(call.argument);
        if (shape !== null && shape.okTrue && shape.hasSchema) {
          const position = source.getLineAndCharacterOfPosition(node.getStart(source));
          sites.push({
            file: fileName,
            line: position.line + 1,
            column: position.character + 1,
            kind: 'deep-equal-literal',
            method: call.method,
            negated: call.negated,
            keys: shape.keys,
            hasSpread: shape.hasSpread,
            snippet: snippetOf(source, node, sourceText),
          });
        } else {
          const keySet = readExactKeySetArgument(call);
          if (keySet !== null) {
            const position = source.getLineAndCharacterOfPosition(node.getStart(source));
            sites.push({
              file: fileName,
              line: position.line + 1,
              column: position.character + 1,
              kind: 'exact-key-set-literal',
              method: call.method,
              negated: call.negated,
              keys: keySet,
              hasSpread: false,
              snippet: snippetOf(source, node, sourceText),
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

/** 对一段源码做形状制造点扫描（`ok:true` + `value` + `schema` 对象字面量）。 */
export function scanSourceForSuccessShapeProducers(sourceText: string, fileName = 'sample.ts'): ShapeProducerSite[] {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const producers: ShapeProducerSite[] = [];
  const isAssertionArgument = new Set<ts.Node>();
  const firstPass = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const call = readDeepEqualCall(node);
      if (call !== null) {
        const shape = readObjectShape(call.argument);
        if (shape !== null) isAssertionArgument.add(shape.node);
      }
    }
    ts.forEachChild(node, firstPass);
  };
  firstPass(source);
  const secondPass = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const shape = readObjectShape(node);
      if (shape !== null && shape.okTrue && shape.hasValue && shape.hasSchema) {
        producers.push({
          file: fileName,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          keys: shape.keys,
          isAssertionArgument: isAssertionArgument.has(shape.node),
          snippet: snippetOf(source, node, sourceText),
        });
      }
    }
    ts.forEachChild(node, secondPass);
  };
  secondPass(source);
  return producers;
}

function* walkTypeScriptFiles(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkTypeScriptFiles(full);
    else if (entry.isFile() && entry.name.endsWith('.ts')) yield full;
  }
}

function toRepoRelative(absolute: string): string {
  return path.relative(REPO_ROOT, absolute).split(path.sep).join('/');
}

/** 扫描 issue #333 作用域（runtime + registry 两个测试树）。 */
export function scanReadDataShapeAssertions(repoRoot: string = REPO_ROOT): ShapeScanResult {
  const files: string[] = [];
  const assertionSites: ShapeAssertionSite[] = [];
  const producerSites: ShapeProducerSite[] = [];
  for (const scope of SHAPE_ASSERTION_SCOPE) {
    const absoluteScope = path.join(repoRoot, scope);
    for (const file of walkTypeScriptFiles(absoluteScope)) {
      const relative = toRepoRelative(file);
      files.push(relative);
      const text = fs.readFileSync(file, 'utf8');
      assertionSites.push(...scanSourceForSuccessShapeAssertions(text, relative));
      producerSites.push(...scanSourceForSuccessShapeProducers(text, relative));
    }
  }
  files.sort();
  assertionSites.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  producerSites.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  return { filesScanned: files, assertionSites, producerSites };
}

/** 报告用：把命中清单排成稳定可读文本（门失败消息与 SA6/SA5 报告共用）。 */
export function formatShapeAssertionInventory(sites: readonly ShapeAssertionSite[]): string {
  if (sites.length === 0) return '(empty)';
  return sites
    .map(
      (site) =>
        `- ${site.file}:${site.line}:${site.column} [${site.negated ? 'not.' : ''}${site.method}/${site.kind}] keys=${site.keys.join(',')}${
          site.hasSpread ? ' +spread' : ''
        } :: ${site.snippet}`,
    )
    .join('\n');
}

/** 报告用：按文件聚合命中数（验收报告的作用域分布表）。 */
export function countByFile(sites: readonly ShapeAssertionSite[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const site of sites) counts[site.file] = (counts[site.file] ?? 0) + 1;
  return counts;
}
