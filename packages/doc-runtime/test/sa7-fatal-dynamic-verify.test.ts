/**
 * SA7 动态验证补充测试 — issue #87（committed-aware transaction fatal 契约）。
 *
 * 来源：SA4 静态验尸 R1 §10「动态审核重点」清单（R2 pass 附条件移交 SA7 逐项处置；
 * 报告 wiki/raw/task_doc-runtime-transaction-fatal_sa4_review.md）。本文件固化其中
 * 本地可达的三项（第 2/4/5 项）；第 1 项的 F-1 复现锚回归与全量零回归由
 * apply-validated-mutation-nested-path-repro.test.ts + 全仓 vitest 覆盖，第 3 项
 * （CI Node 20/24 矩阵日志）属发布后 runner 面，在 SA7 报告中登记、不在测试内伪造。
 *
 * - 重点 2（伪造 branded 三投递路径，SA4 R1 §5 PoC 动态化）：
 *   ① observer 投递 → transactGuarded 无条件包装 E203：committed:true（伪造的
 *      committed:false **不得**被交付）、phase='observer-cleanup-throw'、cause===spoof
 *      实例零信息损失保留；
 *   ② 信封 ownKeys trap 投递 → E205 领域单 issue ok:false + 零写入（类 B 分级——
 *      敌意数据不得升格 internal fatal）；
 *   ②' value 校验读投递（Proxy get trap）→ 领域联合 ok:false（vfsl E100 内收或
 *      E205）+ 零写入；
 *   ③ ⑥ derived 计数 Proxy 投递（提交后第二次读 derived.structure）→ e201D
 *      committed:true + phase='post-commit-verification' + cause===spoof 保留。
 * - 重点 4（(F)(G) 双读窗口，设计 §7.5 登记移交）：对抗 value 发散不抛形态——
 *      断言不出现**未登记**行为。登记形态三枚（设计 §7.5 行「(F)(G) 双读窗口」）：
 *      (a) ok:false + 零写入；(b) ok:true 且两读一致；(c) ok:true 且发散
 *      （「未经校验值落库」——登记接受 + 移交完整任务 ⑥ 式回读仲裁锚定）。
 *      未登记行为 = 抛错逃逸 / ok:false 却有写入 / ok:true 却落库**非投递值**
 *      （捏造值）/ 声称回滚。
 * - 重点 5（P-5 yjs 版本面）：E202 三窗口谓词对 yjs 内部字段（_transaction /
 *      _transactionCleanups）的依赖在实装版本（本地 = CI `--frozen-lockfile` 同版
 *      yjs@13.6.32，证据见 SA7 报告）下的行为一致性——genuine 干净语境字段形态 +
 *      放行、genuine 窗口 A（未闭合 transact）、genuine 窗口 B（observer 派发期，
 *      mutation 侧指名补证）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DerivedSchema } from '@nomicore/vfsl';
import { evaluate, parseVfsl } from '@nomicore/vfsl';
import { applyValidatedMutation } from '../src/mutation.js'; // 内部 seam（公共入口已收缩，owner 修改要求 1 / rev1 AC R1）
import {
      DocRuntimeFatalError,
      materializeRoot,
      readLogicalValueAtPath,
} from '../src/index.js';

// —— 测试辅助（与 SA6 契约测试同款纪律） ——

function derivedOf(text: string): DerivedSchema {
  const parsed = parseVfsl(text);
  if (!parsed.ok) throw new Error(`前置 parseVfsl 失败（fixture 缺陷）：${JSON.stringify(parsed.issues)}`);
  const evaluated = evaluate(parsed.module);
  if (!evaluated.ok) throw new Error(`前置 evaluate 失败（fixture 缺陷）：${JSON.stringify(evaluated.issues)}`);
  return evaluated.derived;
}

function stateBytes(doc: Y.Doc): number[] {
  return [...Y.encodeStateAsUpdate(doc)];
}

function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return undefined;
}

function phaseOf(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const p = (err as { phase?: unknown }).phase;
  return typeof p === 'string' ? p : undefined;
}

function committedOf(err: unknown): boolean | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const c = (err as { committed?: unknown }).committed;
  return typeof c === 'boolean' ? c : undefined;
}

function causeOf(err: unknown): unknown {
  if (typeof err !== 'object' || err === null) return undefined;
  return (err as { cause?: unknown }).cause;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const ROLLBACK_CLAIM = /(已|已经|正在|将)\s*回滚|(?:已|已经)自动回滚|自动回滚|回滚(?:已|)完成|rolled\s*-?\s*back/i;

function expectNoRollbackClaim(thrown: unknown): void {
  expect(messageOf(thrown)).not.toMatch(ROLLBACK_CLAIM);
}

/** 伪造 branded（敌意调用方数据投递面）：真实类实例 + 撒谎的 committed:false。 */
function spoofFatal(tag: string): DocRuntimeFatalError {
  return new DocRuntimeFatalError('pre-commit-internal', false, `spoof-branded-${tag}`);
}

// —— fixture ——

const DERIVED_TWO = derivedOf('type ROOT = { title: string; count: number };');
const DERIVED_NESTED = derivedOf('type ROOT = { u: { n: number; s: string } };');

// ============================================================
// SA4 R1 §10 重点 2 — 伪造 branded 三投递路径
// ============================================================

describe('SA7 重点 2① — 伪造 branded 经 observer 投递 → E203 无条件包装（不透传伪造 committed:false）', () => {
  it('observer 抛 DocRuntimeFatalError(pre-commit-internal,false) → 交付 committed:true / phase observer-cleanup-throw / cause===spoof；写入已落盘', () => {
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    const spoof = spoofFatal('observer');
    let updateCount = 0;
    doc.on('update', () => {
      updateCount += 1;
    });
    let done = false;
    root.observe(() => {
      if (done) return; // one-shot（G8 纪律）
      done = true;
      throw spoof; // 伪造 branded：宣称 committed:false + pre-commit-internal
    });
    const thrown = capture(() => materializeRoot(DERIVED_TWO, { title: 't', count: 7 }, doc));
    // 无条件包装（零 instanceof 透传）：分类权归捕获位置——事务已提交
    expect(thrown).toBeInstanceOf(DocRuntimeFatalError);
    expect(committedOf(thrown)).toBe(true); // 伪造的 committed:false 未被交付（W3 不得降格）
    expect(phaseOf(thrown)).toBe('observer-cleanup-throw');
    expect(messageOf(thrown)).toMatch(/DOCRT-E203/);
    expect(messageOf(thrown)).toContain('spoof-branded-observer'); // 原文证据引用
    expect(causeOf(thrown)).toBe(spoof); // cause 实例零信息损失保留
    expectNoRollbackClaim(thrown);
    // 提交事实：安装事务已落盘（update=1），doc 保持提交后状态（不补偿）
    expect(updateCount).toBe(1);
    expect(root.get('title')).toBe('t');
    expect(root.get('count')).toBe(7);
  });
});

describe('SA7 重点 2② — 伪造 branded 经 mutation 信封/value 读取面投递 → 领域联合 ok:false + 零写入（类 B 分级）', () => {
  it('信封 ownKeys trap 投递 → E205 单 issue ok:false（不升格 fatal）+ state 字节不变', () => {
    const doc = new Y.Doc();
    expect(materializeRoot(DERIVED_TWO, { title: 't', count: 7 }, doc).ok).toBe(true); // 铺底
    const spoof = spoofFatal('envelope');
    const hostile = new Proxy({ op: 'set', path: ['title'], value: 't2' } as Record<string, unknown>, {
      ownKeys() {
        throw spoof; // 信封键枚举面投递（A2 校验 ownKeys trap）
      },
    });
    const before = stateBytes(doc);
    const res = applyValidatedMutation(DERIVED_TWO, doc, hostile);
    expect(res.ok).toBe(false); // 领域联合，非 throw
    if (!res.ok) {
      expect(res.issues.length).toBe(1);
      expect(res.issues[0]!.message).toMatch(/DOCRT-E205/);
      expect(res.issues[0]!.message).toContain('spoof-branded-envelope'); // 「」定界证据引用
    }
    expect(stateBytes(doc)).toEqual(before); // 零写入（W3）
  });

  it('value Proxy get trap 校验读投递 → 领域联合 ok:false（vfsl E100 内收或 E205）+ state 字节不变', () => {
    const derived = derivedOf('type ROOT = { cfg: { level: string } };');
    const doc = new Y.Doc();
    expect(materializeRoot(derived, { cfg: { level: 'seed' } }, doc).ok).toBe(true); // 铺底
    const spoof = spoofFatal('value');
    const hostileValue = new Proxy({ level: 'x' } as Record<string, unknown>, {
      get(target, prop, receiver) {
        if (prop === 'level') throw spoof; // (F) 校验读取面投递
        return Reflect.get(target, prop, receiver);
      },
    });
    const before = stateBytes(doc);
    const res = applyValidatedMutation(derived, doc, { op: 'set', path: ['cfg'], value: hostileValue });
    expect(res.ok).toBe(false); // 领域联合：vfsl E100（INV-6 内收）或 E205——均不升格 fatal
    if (!res.ok) {
      const msgs = res.issues.map((i) => i.message).join(' | ');
      expect(msgs).toMatch(/(DOCRT-E205|VFSL-E100)/); // E205（doc-runtime 层）或 vfsl E100 内收——均领域联合
      expect(msgs).toContain('spoof-branded-value'); // spoof 原文经领域链保留（证据引用）
    }
    expect(stateBytes(doc)).toEqual(before); // 零写入（W3）
    // 落库面未被污染：cfg.level 仍为铺底值
    const read = readLogicalValueAtPath(derived, doc, ['cfg', 'level']);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value).toBe('seed');
  });
});

describe('SA7 重点 2③ — 伪造 branded 经 ⑥ derived 计数 Proxy 投递（提交后二次读）→ e201D committed:true + cause 保留', () => {
  it('derived.structure 在 ④ 提交后的首次读取抛 spoof → DOCRT-E201 变体 D：committed:true / phase post-commit-verification / cause===spoof；已提交状态保留', () => {
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    const spoof = spoofFatal('derived');
    let postCommitThrows = 0;
    // 计数 Proxy：ROOT 空置期（prepare/①②③）直通；④ 提交后（⑥ scratch 构造读 derived.structure）投递 spoof
    const counting = new Proxy(DERIVED_NESTED, {
      get(target, prop, receiver) {
        if (prop === 'structure' && root.size > 0) {
          postCommitThrows += 1;
          throw spoof;
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as DerivedSchema;
    let updateCount = 0;
    doc.on('update', () => {
      updateCount += 1;
    });
    const thrown = capture(() => materializeRoot(counting, { u: { n: 1, s: 'x' } }, doc));
    // ⑥ 运行于事务提交后：「已提交」是捕获位置的管线事实——伪造 committed:false 不透传
    expect(thrown).toBeInstanceOf(DocRuntimeFatalError);
    expect(committedOf(thrown)).toBe(true); // 伪造的 false 未被交付（W3）
    expect(phaseOf(thrown)).toBe('post-commit-verification'); // e201D（校验防线未能运行）
    expect(messageOf(thrown)).toMatch(/DOCRT-E201/);
    expect(messageOf(thrown)).toContain('无法完成'); // 变体 D 文本锚
    expect(messageOf(thrown)).toContain('spoof-branded-derived'); // 「」定界证据引用
    expect(causeOf(thrown)).toBe(spoof); // cause 实例零信息损失保留
    expect(postCommitThrows).toBeGreaterThanOrEqual(1); // 投递真实发生（非未触达的空转绿）
    expectNoRollbackClaim(thrown);
    // 提交事实：安装事务已落盘（update=1），doc 保持提交后状态（不补偿、不回滚）
    expect(updateCount).toBe(1);
    expect(root.get('u')).toBeInstanceOf(Y.Map);
  });
});

// ============================================================
// SA4 R1 §10 重点 4 — (F)(G) 双读窗口（设计 §7.5 登记移交）
// ============================================================

describe('SA7 重点 4 — (F)(G) 双读窗口：对抗 value 发散不抛 → 不出现未登记行为（设计 §7.5）', () => {
  it('计数 getter（首读 first-read、次读起 second-read）经 set 投递 cfg：结果必居登记三形态之一，且无捏造值/无逃逸 throw/ok:false 必零写入', () => {
    const derived = derivedOf('type ROOT = { cfg: { level: string } };');
    const doc = new Y.Doc();
    expect(materializeRoot(derived, { cfg: { level: 'seed' } }, doc).ok).toBe(true); // 铺底
    const before = stateBytes(doc);
    let reads = 0;
    const divergent = {
      get level(): string {
        reads += 1;
        return reads === 1 ? 'first-read' : 'second-read';
      },
    };
    const res = applyValidatedMutation(derived, doc, { op: 'set', path: ['cfg'], value: divergent });
    // 未登记行为 1：逃逸 throw（任何形态的异常逃逸都不属于登记三形态）
    // （applyValidatedMutation 直接调用——若 throw，本用例即红，无需 capture）
    if (!res.ok) {
      // 登记形态 (a)：ok:false → 必零写入（W3）
      expect(stateBytes(doc)).toEqual(before);
      expect(res.issues.length).toBeGreaterThan(0);
      return;
    }
    // 登记形态 (b)/(c)：ok:true → 落库值必须是投递值真实产物之一（first-read / second-read），
    // 不得是捏造值；reads ≥ 2 证明 (F) 校验与 (G) 构造两阶段均真实读取（探针有效性）
    expect(reads).toBeGreaterThanOrEqual(2);
    const read = readLogicalValueAtPath(derived, doc, ['cfg', 'level']);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(['first-read', 'second-read']).toContain(read.value); // 两读一致 (b) 或发散 (c)——均登记面内
    }
  });
});

// ============================================================
// SA4 R1 §10 重点 5 — P-5 yjs 版本面：E202 谓词对实装 yjs 内部字段的依赖
// ============================================================

describe('SA7 重点 5 — P-5：E202 窗口谓词在实装 yjs（与 CI --frozen-lockfile 同版）下的行为一致性', () => {
  it('genuine 干净语境字段形态：_transaction===null 且 _transactionCleanups 为空数组 → guard 放行（materializeRoot ok:true）', () => {
    const doc = new Y.Doc();
    // P-5 依赖面：yjs Doc 实例字段的**genuine 形态**（非合成覆写）
    const tx = (doc as unknown as { _transaction: unknown })._transaction;
    const cleanups = (doc as unknown as { _transactionCleanups: unknown })._transactionCleanups;
    expect(tx).toBe(null); // 放行支前提：null（yjs dist 类型 Doc.d.ts:49 声明面一致）
    expect(Array.isArray(cleanups)).toBe(true); // 空数组（放行支前提）
    expect((cleanups as unknown[]).length).toBe(0);
    const res = materializeRoot(DERIVED_TWO, { title: 't', count: 7 }, doc);
    expect(res.ok).toBe(true); // 放行（唯一放行口：tx===null 且队列空）
  });

  it('genuine 窗口 A：doc.transact 回调内 _transaction 非 null → E202（变体 A 文本锚「doc._transaction 非空」）+ 零写入', () => {
    const doc = new Y.Doc();
    const before = stateBytes(doc);
    let thrown: unknown;
    let txAtWindow: unknown;
    doc.transact(() => {
      txAtWindow = (doc as unknown as { _transaction: unknown })._transaction;
      try {
        materializeRoot(DERIVED_TWO, { title: 't', count: 7 }, doc);
      } catch (err) {
        thrown = err;
      }
    });
    expect(txAtWindow).not.toBe(null); // genuine 窗口：yjs 事务栈真实非空（P-5 谓词左支实证）
    expect(thrown).toBeInstanceOf(Error);
    expect(messageOf(thrown)).toMatch(/DOCRT-E202/);
    expect(messageOf(thrown)).toContain('doc._transaction 非空'); // 变体 A 文本锚
    expect(messageOf(thrown)).toContain('materializeRoot');
    expect(stateBytes(doc)).toEqual(before); // 零写入（写前拒绝）
  });

  it('genuine 窗口 B（mutation 侧指名补证）：observer 派发期调用 applyValidatedMutation → E202-B（「派发期间」+「applyValidatedMutation」）+ 零写入', () => {
    const doc = new Y.Doc();
    expect(materializeRoot(DERIVED_TWO, { title: 't', count: 7 }, doc).ok).toBe(true); // 铺底
    const other = doc.getMap('OTHER');
    let stateAtEntry: number[] | undefined;
    let stateAfter: number[] | undefined;
    let thrown: unknown;
    let txAtWindow: unknown;
    let cleanupsAtWindow: unknown;
    let done = false;
    other.observe(() => {
      if (done) return; // one-shot（G8 纪律）
      done = true;
      txAtWindow = (doc as unknown as { _transaction: unknown })._transaction;
      cleanupsAtWindow = (doc as unknown as { _transactionCleanups: unknown })._transactionCleanups;
      stateAtEntry = stateBytes(doc); // seed 写入后、被测调用前（本函数零写入 → 调用后逐字节不变）
      try {
        applyValidatedMutation(DERIVED_TWO, doc, { op: 'set', path: ['title'], value: 't3' });
      } catch (err) {
        thrown = err;
      }
      stateAfter = stateBytes(doc);
    });
    doc.transact(() => {
      other.set('seed', 1); // 触发 observer 派发（窗口 B：tx===null 且 cleanup 队列非空）
    });
    expect(txAtWindow).toBe(null); // genuine 窗口 B 谓词形态（区别于窗口 A）
    expect(Array.isArray(cleanupsAtWindow)).toBe(true);
    expect((cleanupsAtWindow as unknown[]).length).toBeGreaterThan(0); // P-5 谓词右支实证
    expect(thrown).toBeInstanceOf(Error);
    expect(messageOf(thrown)).toMatch(/DOCRT-E202/);
    expect(messageOf(thrown)).toContain('派发期间'); // 变体 B 文本锚
    expect(messageOf(thrown)).toContain('applyValidatedMutation'); // mutation 侧指名（E202 参数化）
    expect(messageOf(thrown)).not.toContain('materializeRoot');
    expect(stateAfter).toEqual(stateAtEntry); // 零写入：被测调用自身不留下任何字节痕迹
    expect(doc.getMap('ROOT').get('title')).toBe('t'); // 铺底值未被改写
  });
});
