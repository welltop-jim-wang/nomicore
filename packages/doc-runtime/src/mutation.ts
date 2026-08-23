/**
 * @nomicore/doc-runtime — applyValidatedMutation **最小落地**（O1，issue #87 §7）：
 * ADR-0007/PRD §6 冻结管线骨架 + 仅 `set` 操作（含 `set([])` 整体替换）+ fatal 契约面。
 *
 * 范围裁决（O1）：不实现 delete/array-insert/array-delete 语义与 mutation 侧 ⑥ 对称
 * 重物化校验（完整 validated mutation 语义属独立任务面——移交清单见 SA1 设计 §7.5）。
 *
 * 管线（ADR-0007 冻结骨架逐句直译 + PRD §6 次序）：
 * ⓪ assertNoActiveTransaction(doc, 'applyValidatedMutation') —— E202 裸 Error（§5 同规，
 *    一切 catch 之外）
 * (A)–(G½) prepareMutation（唯一 try/catch）：
 *   (A) mutation 信封校验（plain object / 闭环键集恰为 {op,path,value} / op==='set' /
 *       path 段 string|number / value 非 undefined——逐项领域单 issue，零写入，响亮拒绝）
 *   (B) 派生物 guard（structure 非 root → DerivedInvariantError → E204）
 *   (C) extractYjsSnapshot 当前 ROOT 结构检查（载体域；损坏 → 普通失败，不承担 recovery）
 *   (D) validateLogicalSnapshot（逻辑域双重确认——载体合法而逻辑错位（如 number 字段的
 *       'not-a-number' string）在此拒绝）
 *   (E) proposed = JSON 往返克隆 + placeSet（§7.3 concrete-JSON 放置器，own-key 纪律：
 *       终段 Object.defineProperty 写入、中间段 Object.hasOwn 导航）
 *   (F) validateLogicalSnapshot(derived, proposed)（完整 ROOT 逻辑校验，issues 完整透传）
 *   (G) buildTopEntries detached 构造（复用 materialize ②；sentinel → E204）
 *   (G½) 写前响亮预检：live 顶层键集 ⊄ 重建键集 → 领域单 issue 拒绝（拒绝静默丢键，F7 纪律）
 * (H) transactGuarded 单次 Yjs transaction（clear + 重建；observer 逃逸 → E203
 *     committed:true 直接上抛）——**物理位于一切 catch 之外**（R3 方案 A，对齐
 *     materializeRoot「④⑤⑥ 位于一切 catch 之外」双同构）
 * (I) verifyInstall ⑤ 复用（E201 committed:true 直接上抛）
 *
 * 【R3 / SA2 R2-1】全库零 instanceof 透传：本 try 内无内部 fatal 源（sentinel 由本 catch
 * 自产 E204；(H)/(I) 已物理移出 try）。try 内存在调用方对象读取面（信封 Proxy trap /
 * value getter / proposed 引用直读——读取即执行外部代码）：敌意数据抛出的伪造 branded
 * 一律落 E205 ok:false（类 B 分级——用户数据不得升格 internal fatal，杜绝「一次敌意
 * value → Runtime 永久关写」DoS）。
 */
import * as Y from 'yjs';
import type { DerivedSchema } from '@nomicore/vfsl';
import { validateLogicalSnapshot } from '@nomicore/vfsl';
import { extractYjsSnapshot } from './extract.js';
import { assertOutermostTransactionContext } from './tx-guard.js';
import { buildTopEntries } from './detached-build.js';
import { verifyInstall } from './install-verify.js';
import { DerivedInvariantError, DocRuntimeFatalError, transactGuarded } from './fatal.js';

/** mutation 领域 issue（ADR-0008「ROOT mutation 独立窄 issue 类型」；与 MaterializeIssue 同形不同名）。 */
export interface MutationIssue {
  message: string;
  path: Array<string | number>;
}

export type ApplyValidatedMutationResult =
  | { ok: true } // 成功只返回 {ok:true}（ADR-0007）
  | { ok: false; issues: MutationIssue[] };

type Path = Array<string | number>;

/**
 * 唯一公共 mutation 入口（ADR-0007）：同步；领域失败经返回值传递（ok:false + issues）；
 * fatal 面（E202 裸 Error / E203 / E201 / E204 branded）为唯一 exception 形态——W1 唯一
 * 相容形态 throw、绝不吞并成伪 ok/伪回滚。
 *
 * mutation 参数形状（v1 事实，SA1 设计 §7.1 对齐 SA6 最小直译）：`{ op: 'set', path,
 * readonly (string|number)[], value: unknown }`——完整四操作联合类型由 validated-mutation
 * 独立任务定稿；本函数运行时校验形状（未知键/未知 op/坏 path/undefined value → 领域单
 * issue 响亮拒绝）。
 *
 * ⚠️ 前置条件（⓪）：未闭合外层 transaction / cleanup 派发期 → throw DOCRT-E202（与
 * materializeRoot 同规，E202 不 fatal 化——调用方契约破坏，O2 裁决）。
 */
export function applyValidatedMutation(
  derived: DerivedSchema,
  doc: Y.Doc,
  mutation: unknown,
): ApplyValidatedMutationResult {
  assertOutermostTransactionContext(doc, 'applyValidatedMutation'); // ⓪ E202 裸 Error（§5 同规）——一切 catch 之外
  const ready = prepareMutation(derived, doc, mutation); // (A)–(G½) 写前只读+构造区（唯一 try/catch 所在）
  if (ready.kind === 'fail') return { ok: false, issues: ready.issues }; // 领域联合（ok:false）——不 throw、零写入
  // —— (H)(I) 物理位于一切 catch 之外（R3/SA2 R2-1 方案 A，对齐 materializeRoot
  // 「④⑤⑥ 位于一切 catch 之外」双同构）：E203/E201 自 throw 点直接上抛，不经任何 catch ——
  transactGuarded(doc, () => {
    // (H) 单次 Yjs transaction：事务体仅 detached 产物 set/clear（D10）——observer 逃逸
    //     → E203 committed:true 直接上抛；clear+set 在 cleanup 派发前完成（实证 §10 P-2）
    ready.rootMap.clear();
    for (const [k, v] of ready.entries) ready.rootMap.set(k, v);
  });
  verifyInstall({ rootMap: ready.rootMap, entries: ready.entries }); // (I) ⑤ 复用——E201 committed:true 直接上抛
  return { ok: true };
}

type MutationPrepared =
  | { kind: 'ready'; rootMap: Y.Map<unknown>; entries: Array<[string, unknown]> }
  | { kind: 'fail'; issues: MutationIssue[] };

/** (A)–(G½) 写前准备：唯一 try/catch 所在。sentinel（DerivedInvariantError）→ E204
 *  committed:false fatal throw；其余一切意外异常（含伪造 branded）→ E205 ok:false 领域
 *  单 issue（类 B 分级，零写入）。 */
function prepareMutation(derived: DerivedSchema, doc: Y.Doc, mutation: unknown): MutationPrepared {
  try {
    // (A) mutation 信封校验（领域单 issue，零写入，逐项响亮拒绝）：
    const env = plainObjectOf(mutation);
    if (env === null) {
      return failIssue([], `mutation 信封形状错误：期望普通对象 { op, path, value }，实际 ${wordOf(mutation)}`);
    }
    // A2. 信封 own 键集必须恰为 {op, path, value}——含未知键（如 extra / 笔误 val）→ 单 issue
    const allowed = ['op', 'path', 'value'];
    const unknownKeys = Object.keys(env).filter((k) => !allowed.includes(k));
    if (unknownKeys.length > 0) {
      return failIssue([], `未知信封键 "${unknownKeys[0]}"（允许的键：op/path/value）`);
    }
    const missingKeys = allowed.filter((k) => !Object.hasOwn(env, k));
    if (missingKeys.length > 0) {
      return failIssue([], `信封缺少必需键 "${missingKeys[0]}"（允许的键：op/path/value）`);
    }
    // A3. op === 'set'；delete/array-insert/array-delete → 独立任务面未支持；其他 → 未知操作
    const op = env.op; // 单次读取（值语义按值捕获，避免敌意 getter 差分放大）
    if (op !== 'set') {
      if (op === 'delete' || op === 'array-insert' || op === 'array-delete') {
        return failIssue([], `操作 "${String(op)}" 属 validated mutation 独立任务面，本切片未支持`);
      }
      return failIssue([], `未知操作 "${String(op)}"`);
    }
    // A4. path 为 Array 且每段 string|number
    if (!Array.isArray(env.path)) {
      return failIssue([], 'path 必须是数组（段为 string|number）');
    }
    const path = env.path as Path; // A4 已逐段校验（string|number 不变式）；单次读取
    for (const seg of path) {
      if (typeof seg !== 'string' && typeof seg !== 'number') {
        return failIssue([], `path 段类型错误：期望 string|number，实际 ${typeof seg}`);
      }
    }
    // A5. value 存在且非 undefined——杜绝「set(undefined) ≡ 隐式 delete」走私 delete 语义
    if (!Object.hasOwn(env, 'value')) {
      return failIssue([], 'set 需携带非 undefined value；清除字段属 delete 操作语义（独立任务面）');
    }
    const value = env.value; // 单次读取（(F) 校验 / (G) 构造的引用直读在下游；双读窗口移交 §7.5）
    if (value === undefined) {
      return failIssue([], 'set 需携带非 undefined value；清除字段属 delete 操作语义（独立任务面）');
    }
    // (B) 派生物 guard：structure 非 root → sentinel → E204（类 A，合规调用者不可达）
    if (derived.structure.kind !== 'root') {
      throw new DerivedInvariantError('derived.structure 非 root（手造派生物）');
    }
    // (C) 当前 ROOT 结构检查（载体域）：损坏 → 普通失败，不承担 recovery
    const ex = extractYjsSnapshot(derived, doc);
    if (!ex.ok) return { kind: 'fail', issues: ex.issues };
    // (D) 逻辑域双重确认（PRD §6 次序；载体合法而逻辑错位在此拒绝）
    const logical = validateLogicalSnapshot(derived, ex.snapshot);
    if (!logical.ok) return { kind: 'fail', issues: logical.issues };
    // (E) proposed = JSON 往返克隆（extract 产物为纯有限 JSON → 恒等，P-6）+ placeSet
    const proposed = cloneJson(ex.snapshot);
    const placed = placeSet(proposed, path, value);
    if (placed.kind === 'issue') return { kind: 'fail', issues: [placed.issue] };
    // (F) 完整 proposed ROOT 逻辑校验（issues 完整透传——ADR-0007：logical 保留完整 issues）
    const validated = validateLogicalSnapshot(derived, placed.value);
    if (!validated.ok) return { kind: 'fail', issues: validated.issues };
    // (G) detached 构造（复用 materialize ②；sentinel → E204；issue → 单 issue）
    const top = buildTopEntries(derived, placed.value);
    if (top.kind === 'issue') return { kind: 'fail', issues: [top.issue] };
    const rootMap = doc.getMap('ROOT');
    // (G½) 写前响亮预检（拒绝静默丢键，对齐 materializeRoot F7 纪律）：
    //     检测面 = 顶层（live keys）；嵌套子树未声明键移交完整任务（§7.5）
    const liveKeys = [...rootMap.keys()];
    const rebuildKeys = new Set(top.entries.map(([k]) => k));
    const dropped = liveKeys.filter((k) => !rebuildKeys.has(k));
    if (dropped.length > 0) {
      return failIssue([], `拒绝静默丢键：live ROOT 顶层存在结构树投影外的键 [${dropped.join('、')}]，` +
        `clear+重建将丢弃它们——未声明键处置属 validated-mutation 独立任务面；本调用零写入`);
    }
    return { kind: 'ready', rootMap, entries: top.entries };
  } catch (err) {
    if (err instanceof DerivedInvariantError) {
      // 类 A：internal 不变量破坏 → committed:false fatal（写前、零写入；与 materialize
      // prepare 侧 E204 消息逐字同一）。
      throw new DocRuntimeFatalError(
        'pre-commit-internal',
        false,
        `DOCRT-E204: 写前 internal 不变量破坏（${err.message}）——合规调用者不可达` +
          `（派生物仅可由 evaluate 产出，此处为 internal 缺陷类）；本调用零写入` +
          `（doc 状态不因本调用改变）；不补偿、不 fallback`,
        { cause: err },
      );
    }
    // 【R3/SA2 R2-1】无 instanceof DocRuntimeFatalError 透传：本 try 内无内部 fatal 源
    // （sentinel 由本 catch 自产 E204；transactGuarded/verifyInstall 已物理移出）。try 内存在
    // 调用方对象读取面（信封 Proxy trap / value getter / proposed 引用直读——读取即执行
    // 外部代码）：敌意数据抛出的伪造 branded 一律落 E205 ok:false（类 B 分级——用户数据
    // 不得升格 internal fatal，杜绝「一次敌意 value → Runtime 永久关写」DoS）。message 以
    // 「」定界携带原始异常文本（证据引用纪律）。
    return { kind: 'fail', issues: [{ path: [], message: `DOCRT-E205: applyValidatedMutation 内部错误（意外异常）:「${errDetailOf(err)}」` }] };
  }
}

type PlaceSetResult = { kind: 'ok'; value: unknown } | { kind: 'issue'; issue: MutationIssue };

/**
 * placeSet：concrete-JSON 放置器（§7.3，最小语义面）——沿具体 JSON 快照（extract 产物）
 * 放置；路径导航只判定「结构不可达」，合法性仲裁全部交给 (F) 完整校验 + (G) 构造。
 *
 * 【F-1 修复（SA4 R1 reject 唯一阻塞项）】放置成功时返回**完整 mutated proposed 根**
 * （克隆对象被 defineProperty 原地变更，直接返回 root）——(F)/(G) 消费的必须是完整
 * proposed ROOT（设计 §7.2 (E)(F)），而非终段父对象（子树）；空 path 整体替换语义不变。
 *
 * own-key 纪律（冻结，§7.3）：终段写入一律 Object.defineProperty（own 数据属性直落，
 * 绕开 Object.prototype.__proto__ accessor——杜绝标量静默忽略与对象值原型劫持）；
 * 中间段导航键存在性判定一律 Object.hasOwn（own 键才可下钻；原型成员名按「中间容器
 * 缺失」单 issue 拒绝）。数组中间段导航不涉原型语义（Array.isArray + 整数边界）。
 */
function placeSet(root: unknown, path: Path, value: unknown): PlaceSetResult {
  // 空 path（set([])）：整体替换 ROOT——非 map 形由 (F)/(G) 仲裁拒绝
  if (path.length === 0) return { kind: 'ok', value };
  let cur = root;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i]!;
    const next = stepInto(cur, seg, path, i);
    if (next.kind === 'issue') return next;
    cur = next.value;
  }
  const placed = placeAt(cur, path[path.length - 1]!, value, path);
  if (placed.kind === 'issue') return placed;
  // placeAt 已对终段父对象原地变更；set 的产物是完整 proposed ROOT（设计 §7.2 (F)）——
  // 返回 mutated 根（root），绝不返回终段父对象（子树，path 长度 ≥2 时即数据重塑面）
  return { kind: 'ok', value: root };
}

type StepResult = { kind: 'ok'; value: unknown } | { kind: 'issue'; issue: MutationIssue };

/** 中间段导航：plain object → string 段 + Object.hasOwn（own 键）；数组 → 非负整数且 < length；
 *  其他（标量/终态）→ 单 issue「路径穿越不可下钻终态」。 */
function stepInto(parent: unknown, seg: string | number, path: Path, at: number): StepResult {
  const prefix = path.slice(0, at); // 最深成功导航位（issue 锚点）
  const obj = plainObjectOf(parent);
  if (obj !== null) {
    if (typeof seg !== 'string') {
      return issueOf(prefix, `中间容器导航键段非字符串（期望 string 键段，实际 ${typeof seg}）——set 不自动创建中间容器`);
    }
    if (!Object.hasOwn(obj, seg)) {
      return issueOf(prefix, '中间容器缺失——set 不自动创建中间容器（原型成员不视为存在键）');
    }
    return { kind: 'ok', value: obj[seg] };
  }
  if (Array.isArray(parent)) {
    if (typeof seg !== 'number' || !Number.isInteger(seg) || seg < 0 || seg >= parent.length) {
      return issueOf(prefix, '中间容器缺失——数组下标越界或非整数下标（set 不自动创建中间容器）');
    }
    return { kind: 'ok', value: parent[seg] };
  }
  return issueOf(prefix, `路径穿越不可下钻终态——中间节点非容器（期望普通对象或数组，实际 ${wordOf(parent)}）`);
}

/** 终段放置：plain object → string 段 + Object.defineProperty 写入（own 键遮蔽原型
 *  accessor；已存在 own 键覆写）；数组 → 单 issue（ADR-0007 终态枚举：已有字段 /
 *  缺失 optional 字段 / 新 Record 键——不支持数组下标）。 */
function placeAt(parent: unknown, seg: string | number, value: unknown, path: Path): PlaceSetResult {
  const obj = plainObjectOf(parent);
  if (obj !== null) {
    if (typeof seg !== 'string') {
      return issueOf(path, `终段键段非字符串（期望 string 键段，实际 ${typeof seg}）`);
    }
    Object.defineProperty(obj, seg, { value, writable: true, enumerable: true, configurable: true });
    return { kind: 'ok', value: obj };
  }
  if (Array.isArray(parent)) {
    return issueOf(path, 'set 终态不支持数组下标（ADR-0007 终态枚举：已有字段 / 缺失 optional 字段 / 新 Record 键）');
  }
  return issueOf(path, `路径穿越不可下钻终态——终段父节点非容器（期望普通对象，实际 ${wordOf(parent)}）`);
}

/** JSON 往返克隆（extract 产物为纯有限 JSON → 恒等，P-6；own '__proto__' 键经
 *  defineProperty 创建者往返保真——SA2 E-11 实证）。 */
function cloneJson(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v));
}

/** D4 原型守卫：plain 普通对象（typeof object && 非 null && 非数组 && 原型为
 *  Object.prototype 或 null）。getPrototypeOf/keys 的 Proxy trap → 调用方读取面
 *  （抛错 → E205 类 B 分级）。 */
function plainObjectOf(v: unknown): Record<string, unknown> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return null;
  return v as Record<string, unknown>;
}

/** 形状词（诊断文本用，与 materialize wordOf 同款思路）。 */
function wordOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) {
      const ctorName = (proto as { constructor?: { name?: string } }).constructor?.name ?? 'unknown';
      return `object（constructor: ${ctorName}）`;
    }
    return 'object';
  }
  return typeof v;
}

/** 领域单 issue（fail-fast 变体；全部收敛到此——message 措辞与 path 锚定一致性）。 */
function failIssue(path: Path, message: string): { kind: 'fail'; issues: MutationIssue[] } {
  return { kind: 'fail', issues: [{ message, path }] };
}

/** 放置器单 issue（placeSet/stepInto/placeAt 结局）。 */
function issueOf(path: Path, message: string): { kind: 'issue'; issue: MutationIssue } {
  return { kind: 'issue', issue: { message, path } };
}

/** 错误详情（message 或 String 兜底——证据引用文本，非本 issue 自述 claims）。 */
function errDetailOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
