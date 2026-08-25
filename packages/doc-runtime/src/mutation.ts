/**
 * ADR-0007 validated mutation bridge. Every operation is simulated against a
 * concrete JSON snapshot, fully validated, rebuilt detached, then installed by
 * one guarded Yjs transaction. Domain failures are zero-write results; fatal
 * transaction/install failures retain their committed-aware exception channel.
 */
import * as Y from 'yjs';
import type { DerivedSchema } from '@nomicore/vfsl';
import { validateLogicalSnapshot } from '@nomicore/vfsl';
import { extractYjsSnapshot } from './extract.js';
import { assertOutermostTransactionContext } from './tx-guard.js';
import { buildTopEntries } from './detached-build.js';
import { verifyInstall } from './install-verify.js';
import { DerivedInvariantError, DocRuntimeFatalError, transactGuarded } from './fatal.js';

export interface MutationIssue {
  message: string;
  path: Array<string | number>;
}

export type MutationPath = readonly (string | number)[];
export type ValidatedMutation =
  | { op: 'set'; path: MutationPath; value: unknown }
  | { op: 'delete'; path: MutationPath }
  | { op: 'array-insert'; path: MutationPath; index: number; values: readonly unknown[] }
  | { op: 'array-delete'; path: MutationPath; index: number; count: number };

export type ApplyValidatedMutationResult =
  | { ok: true }
  | { ok: false; issues: MutationIssue[] };

type Path = Array<string | number>;
type MutationPrepared =
  | { kind: 'ready'; rootMap: Y.Map<unknown>; entries: Array<[string, unknown]> }
  | { kind: 'fail'; issues: MutationIssue[] };
type PlaceResult = { kind: 'ok'; value: unknown } | { kind: 'issue'; issue: MutationIssue };
type StepResult = { kind: 'ok'; value: unknown } | { kind: 'issue'; issue: MutationIssue };

/** Apply one ADR-0007 set/delete/array-insert/array-delete operation synchronously. */
export function applyValidatedMutation(
  derived: DerivedSchema,
  doc: Y.Doc,
  mutation: ValidatedMutation | unknown,
): ApplyValidatedMutationResult {
  assertOutermostTransactionContext(doc, 'applyValidatedMutation');
  const ready = prepareMutation(derived, doc, mutation);
  if (ready.kind === 'fail') return { ok: false, issues: ready.issues };
  transactGuarded(doc, () => {
    ready.rootMap.clear();
    for (const [k, v] of ready.entries) ready.rootMap.set(k, v);
  });
  verifyInstall({ rootMap: ready.rootMap, entries: ready.entries });
  return { ok: true };
}

function prepareMutation(derived: DerivedSchema, doc: Y.Doc, mutation: unknown): MutationPrepared {
  try {
    const parsed = parseMutation(mutation);
    if (parsed.kind === 'fail') return parsed;
    if (derived.structure.kind !== 'root') {
      throw new DerivedInvariantError('derived.structure 非 root（手造派生物）');
    }
    const ex = extractYjsSnapshot(derived, doc);
    if (!ex.ok) return { kind: 'fail', issues: ex.issues };
    const logical = validateLogicalSnapshot(derived, ex.snapshot);
    if (!logical.ok) return { kind: 'fail', issues: logical.issues };

    const proposed = cloneJson(ex.snapshot);
    const placed = applyToJson(proposed, parsed.mutation);
    if (placed.kind === 'issue') return { kind: 'fail', issues: [placed.issue] };

    const validated = validateLogicalSnapshot(derived, placed.value);
    if (!validated.ok) return { kind: 'fail', issues: validated.issues };
    const top = buildTopEntries(derived, placed.value);
    if (top.kind === 'issue') return { kind: 'fail', issues: [top.issue] };
    const rootMap = doc.getMap('ROOT');
    return { kind: 'ready', rootMap, entries: top.entries };
  } catch (err) {
    if (err instanceof DerivedInvariantError) {
      throw new DocRuntimeFatalError(
        'pre-commit-internal',
        false,
        `DOCRT-E204: 写前 internal 不变量破坏（${err.message}）——合规调用者不可达（派生物仅可由 evaluate 产出，此处为 internal 缺陷类）；本调用零写入（doc 状态不因本调用改变）；不补偿、不 fallback`,
        { cause: err },
      );
    }
    return failIssue([], `DOCRT-E205: applyValidatedMutation 内部错误（意外异常）:「${errDetailOf(err)}」`);
  }
}

function parseMutation(input: unknown):
  | { kind: 'ok'; mutation: ValidatedMutation & { path: Path } }
  | { kind: 'fail'; issues: MutationIssue[] } {
  const env = plainObjectOf(input);
  if (env === null) return failIssue([], `mutation 信封形状错误：期望普通对象，实际 ${wordOf(input)}`);
  const op = env.op;
  const specs: Record<string, readonly string[]> = {
    set: ['op', 'path', 'value'],
    delete: ['op', 'path'],
    'array-insert': ['op', 'path', 'index', 'values'],
    'array-delete': ['op', 'path', 'index', 'count'],
  };
  if (typeof op !== 'string' || !Object.hasOwn(specs, op)) return failIssue([], `未知操作 "${String(op)}"`);
  const operation = op as ValidatedMutation['op'];
  const allowed = specs[operation]!;
  const unknown = Object.keys(env).find((k) => !allowed.includes(k));
  if (unknown !== undefined) return failIssue([], `未知信封键 "${unknown}"（操作 ${op}）`);
  const missing = allowed.find((k) => !Object.hasOwn(env, k));
  if (missing !== undefined) return failIssue([], `信封缺少必需键 "${missing}"（操作 ${op}）`);
  if (!Array.isArray(env.path)) return failIssue([], 'path 必须是数组（段为 string|number）');
  const path = [...env.path] as Path;
  for (const seg of path) {
    if (typeof seg !== 'string' && typeof seg !== 'number') return failIssue([], `path 段类型错误：期望 string|number，实际 ${typeof seg}`);
  }
  if (op === 'set') {
    if (env.value === undefined) return failIssue([], 'set 需携带非 undefined value');
    return { kind: 'ok', mutation: { op, path, value: env.value } };
  }
  if (op === 'delete') return { kind: 'ok', mutation: { op, path } };
  if (!strictNonNegativeInteger(env.index)) return failIssue(path, `${op} index 必须是严格非负整数`);
  if (op === 'array-insert') {
    if (!Array.isArray(env.values) || env.values.length === 0) return failIssue(path, 'array-insert values 必须是非空数组');
    if (env.values.some((v) => v === undefined)) return failIssue(path, 'array-insert values 不得包含 undefined');
    return { kind: 'ok', mutation: { op, path, index: env.index, values: [...env.values] } };
  }
  if (op !== 'array-delete') return failIssue([], `未知操作 "${String(op)}"`);
  if (!strictPositiveInteger(env.count)) return failIssue(path, 'array-delete count 必须是严格正整数');
  return { kind: 'ok', mutation: { op, path, index: env.index, count: env.count } };
}

function applyToJson(root: unknown, mutation: ValidatedMutation & { path: Path }): PlaceResult {
  switch (mutation.op) {
    case 'set': return placeSet(root, mutation.path, mutation.value);
    case 'delete': return placeDelete(root, mutation.path);
    case 'array-insert': return placeArrayInsert(root, mutation.path, mutation.index, mutation.values);
    case 'array-delete': return placeArrayDelete(root, mutation.path, mutation.index, mutation.count);
  }
}

function placeSet(root: unknown, path: Path, value: unknown): PlaceResult {
  if (path.length === 0) return { kind: 'ok', value };
  const parent = navigateToParent(root, path);
  if (parent.kind === 'issue') return parent;
  const seg = path[path.length - 1]!;
  const obj = plainObjectOf(parent.value);
  if (obj === null) {
    if (Array.isArray(parent.value)) return issueOf(path, 'set 终态不支持数组下标');
    return issueOf(path, `路径穿越不可下钻终态——终段父节点非普通对象（实际 ${wordOf(parent.value)}）`);
  }
  if (typeof seg !== 'string') return issueOf(path, '终段键段非字符串');
  Object.defineProperty(obj, seg, { value, writable: true, enumerable: true, configurable: true });
  return { kind: 'ok', value: root };
}

function placeDelete(root: unknown, path: Path): PlaceResult {
  if (path.length === 0) return issueOf([], 'delete 禁止删除 ROOT');
  const parent = navigateToParent(root, path);
  if (parent.kind === 'issue') return parent;
  if (Array.isArray(parent.value)) return issueOf(path, 'delete 禁止数组下标；请使用 array-delete');
  const obj = plainObjectOf(parent.value);
  const seg = path[path.length - 1]!;
  if (obj === null || typeof seg !== 'string') return issueOf(path, 'delete 终段必须是普通对象的字符串键');
  if (!Object.hasOwn(obj, seg)) return issueOf(path, 'delete 目标键不存在（拒绝 no-op）');
  delete obj[seg];
  return { kind: 'ok', value: root };
}

function placeArrayInsert(root: unknown, path: Path, index: number, values: readonly unknown[]): PlaceResult {
  const target = navigate(root, path);
  if (target.kind === 'issue') return target;
  if (!Array.isArray(target.value)) return issueOf(path, 'array-insert 目标必须是数组');
  if (index > target.value.length) return issueOf(path, 'array-insert index 越界（不 clamp）');
  target.value.splice(index, 0, ...values);
  return { kind: 'ok', value: root };
}

function placeArrayDelete(root: unknown, path: Path, index: number, count: number): PlaceResult {
  const target = navigate(root, path);
  if (target.kind === 'issue') return target;
  if (!Array.isArray(target.value)) return issueOf(path, 'array-delete 目标必须是数组');
  if (index >= target.value.length || index + count > target.value.length) return issueOf(path, 'array-delete 范围越界（不 clamp、不接受越界 no-op）');
  target.value.splice(index, count);
  return { kind: 'ok', value: root };
}

function navigateToParent(root: unknown, path: Path): StepResult {
  return navigate(root, path.slice(0, -1));
}

function navigate(root: unknown, path: Path): StepResult {
  let cur = root;
  for (let i = 0; i < path.length; i++) {
    const next = stepInto(cur, path[i]!, path, i);
    if (next.kind === 'issue') return next;
    cur = next.value;
  }
  return { kind: 'ok', value: cur };
}

function stepInto(parent: unknown, seg: string | number, path: Path, at: number): StepResult {
  const prefix = path.slice(0, at);
  const obj = plainObjectOf(parent);
  if (obj !== null) {
    if (typeof seg !== 'string') return issueOf(prefix, '中间容器导航键段非字符串');
    if (!Object.hasOwn(obj, seg)) return issueOf(prefix, '中间容器缺失——不自动创建中间容器');
    return { kind: 'ok', value: obj[seg] };
  }
  if (Array.isArray(parent)) {
    if (!strictNonNegativeInteger(seg) || seg >= parent.length) return issueOf(prefix, '数组下标越界或非整数下标');
    return { kind: 'ok', value: parent[seg] };
  }
  return issueOf(prefix, `路径穿越不可下钻终态（实际 ${wordOf(parent)}）`);
}

function cloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function strictNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function strictPositiveInteger(value: unknown): value is number {
  return strictNonNegativeInteger(value) && value > 0;
}

function plainObjectOf(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null ? value as Record<string, unknown> : null;
}

function wordOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function failIssue(path: Path, message: string): { kind: 'fail'; issues: MutationIssue[] } {
  return { kind: 'fail', issues: [{ message, path }] };
}

function issueOf(path: Path, message: string): { kind: 'issue'; issue: MutationIssue } {
  return { kind: 'issue', issue: { message, path } };
}

function errDetailOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
