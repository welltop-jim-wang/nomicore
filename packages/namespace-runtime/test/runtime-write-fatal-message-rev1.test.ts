/**
 * SA6 红灯/回归测试（修订轮 R1）— fatal message 稳定面 + fatal/close 术语边界
 * （issue #90 / PR #100 Review P1/P2；AC-R1-1/2/3/4 + AC-R2-1 锚定）。
 *
 * 契约来源：
 * - 任务简报 `wiki/raw/task_namespace-runtime-write-sequencer_rev1.md`：
 *   AC-R1-1 message 只含稳定 code/phase/committed 与固定处置说明；AC-R1-2 原始异常实例仅经
 *   标准 cause 保留（严格相等、零信息损失）；AC-R1-3 status.fatal 仍为稳定 {code,message}
 *   摘要（不暴露 cause/stack/原始文本）；AC-R1-4 回归测试覆盖两条路径的上述纪律；
 *   AC-R2-1 诊断/注释/测试措辞统一为「永久禁用…写能力，读取仍保留」类表达，不出现
 *   暗示 closing/closed 生命周期的「永久关闭」类措辞（src + test；ADR 不动）。
 * - owner Review P1：`RuntimeWriteFatalError.message` 不得拼接原始异常文本（detail 来自
 *   notifier / observer / adapter / mutation pipeline 任意异常文本，可能包含 ROOT 数据、
 *   SCHEMA 文本、用户输入——公共 message 必须稳定）。
 *
 * 红灯现状（本轮真实缺陷——行为锚，非源码 grep）：
 * - `write.ts` `writeFatalMessage(...)` 模板尾段 `原始异常证据引用：「${detail}」` 把 detail
 *   插值进公共 message（detail 来自 S6 notifier rejection 与 S5 unknown pipeline throw 的
 *   原始异常文本）→ 本文件断言 message 不含原始异常文本即当前为红；
 * - P2 措辞面（可观测 message 仍含「全部写已永久关闭」；稳定常量 FATAL_*_MESSAGE 与
 *   S1 gate disabled 文案同样含「永久关闭」且不含「禁用」）→ 断言「无永久关闭/无
 *   closing/closed」「含禁用/读取/保留」当前为红。
 *
 * 触发机制（真实可执行路径，非源码文本断言）：
 * - notify-dirty-failed：seam 注入 `notifyDirty` 抛错（S6 同槽 await——写已提交、登记通道
 *   损坏 → 诚实 fatal；phase='notify-dirty-failed', committed=true）。
 * - unknown-pipeline-throw：让 `applyValidatedMutation` 在 ⓪ 事务语境 guard
 *   （doc-runtime `assertOutermostTransactionContext` 第一访问点：读 `doc._transaction` /
 *   `doc._transactionCleanups`）逃逸一个**非 branded** 异常——经 Y.Doc 语义面注入：与真实
 *   E202 逃逸（cleanup 队列残留、外层 transact 等）同一逃逸点、同一槽内 catch 位置；
 *   槽体视角等价（S5 catch 中非 DocRuntimeFatalError → phase='unknown-pipeline-throw',
 *   committed:true 保守）。cause 严格相等断言要求持有原始异常实例——真实 E202 由
 *   doc-runtime 内部 `new Error` 创建、实例不可供测试侧持有，故本处注入测试自造实例。
 * - P0 internal fault：seam 注入 compile 抛错（P0 队首 internal fault → status.fatal 摘要
 *   = FATAL_P0_INTERNAL_MESSAGE；fatal 后写槽 S1 gate → RUNTIME_WRITE_DISABLED 措辞观察面）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, User } from '@nomicore/persistence';
import { RuntimeWriteFatalError } from '../src/index.js';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';
import type { NamespaceRuntime } from '../src/index.js';

// —— fixture ——

const OWNER: User = { userId: 'u-alice' };
const TEXT_VALID = 'type ROOT = { n: number; a: string; };';
const ENVELOPE = { lang: 'vfsl', version: 1, id: 'ns-1', text: TEXT_VALID } as const;
const ROOT0 = { n: 1, a: 'x' };
const SET_N = (value: unknown) => ({ op: 'set', path: ['n'], value });

// —— 构造的泄漏 sentinel（原始异常文本的三类敏感内容：ROOT 数据 / SCHEMA 文本 / mutation 输入）——

const PATH_SENTINEL = 'NSRT-LEAK-PATH-SENTINEL-9f2c7d';
const ROOT_SENTINEL = `ROOT_CONTENT_SENTINEL-1a2b3c:{"n":1,"secret":"s3cr3t-root"}`;
const SCHEMA_SENTINEL = `SCHEMA_TEXT_SENTINEL-4d5e6f:type ROOT = { secret: string; };`;
const INPUT_SENTINEL = `MUTATION_INPUT_SENTINEL-7a8b9c:{op:set,value:"user-typed-secret"}`;
const RAW_LEAK_MESSAGE = `${PATH_SENTINEL} | ${ROOT_SENTINEL} | ${SCHEMA_SENTINEL} | ${INPUT_SENTINEL}`;

/** 原始异常实例（message 携带全部泄漏 sentinel；cause 严格相等断言持有同一引用）。 */
function leakErrorOf(pathTag: string): Error {
  return new Error(`[${pathTag}] 原始异常：${RAW_LEAK_MESSAGE}`);
}

// —— harness（沿 runtime-mutate-root-sequencer.test.ts 既有风格）——

function seedDoc(): Y.Doc {
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(ENVELOPE)) sc.set(k, v);
  doc.getMap('META').set('docId', 'ns-1');
  const root = doc.getMap('ROOT');
  for (const [k, v] of Object.entries(ROOT0)) root.set(k, v);
  return doc;
}

function fakeHandle(doc: Y.Doc): DocHandle {
  return {
    owner: OWNER,
    docId: 'ns-1',
    doc,
    getStatus: () => 'ready',
    release: async () => {},
  } as unknown as DocHandle;
}

async function waitReady(runtime: NamespaceRuntime): Promise<void> {
  await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');
}

/** 收集 settled 结果/拒绝（resolve 值或 throw 值统一返回，不使测试直接崩散）。 */
async function settleOf(p: Promise<unknown>): Promise<{ kind: 'resolved'; value: unknown } | { kind: 'rejected'; reason: unknown }> {
  try {
    return { kind: 'resolved', value: await p };
  } catch (reason) {
    return { kind: 'rejected', reason };
  }
}

function issuesOf(value: unknown): Array<{ message: string; path: unknown[] }> {
  if (typeof value !== 'object' || value === null) return [];
  const issues = (value as { issues?: unknown }).issues;
  return Array.isArray(issues) ? (issues as Array<{ message: string; path: unknown[] }>) : [];
}

function readValue(runtime: NamespaceRuntime, path: readonly (string | number)[]): unknown {
  const read = runtime.readData(path);
  if (!read.ok) throw new Error(`读取应成功，实际 code=${read.code}`);
  return read.value;
}

/** 稳定 message 结构断言（AC-R1-1：只含稳定 code/phase/committed 与固定处置说明）。 */
function expectStableFatalMessageShape(message: string, phase: string, committed: boolean): void {
  expect(typeof message).toBe('string');
  expect(message.length).toBeGreaterThan(0);
  expect(message).toContain('NSRT-WRITE-FATAL'); // 稳定 code 前缀
  expect(message).toContain(`phase=${phase}`); // 稳定 phase 插值
  expect(message).toContain(`committed=${String(committed)}`); // 稳定 committed 事实
  expect(message).toContain('不补偿'); // 固定处置说明（不补偿、不 fallback、不声称回滚；不得自动重试）
}

/** AC-R1-4 泄漏面断言：公共 message 不含原始异常 sentinel 与构造的 ROOT/SCHEMA/input sentinel。 */
function expectMessageNotLeak(message: string): void {
  expect(message).not.toContain(RAW_LEAK_MESSAGE);
  expect(message).not.toContain(PATH_SENTINEL);
  expect(message).not.toContain(ROOT_SENTINEL);
  expect(message).not.toContain(SCHEMA_SENTINEL);
  expect(message).not.toContain(INPUT_SENTINEL);
  // 不含「证据引用」定界模板段（detail 插值点）；不含原始异常 stack 痕迹
  expect(message).not.toContain('原始异常证据引用');
}

/** AC-R2-1 措辞面断言（可观测 message 的术语纪律——可放宽面见简报说明）。 */
function expectNoClosingWording(message: string): void {
  expect(message).not.toContain('永久关闭');
  expect(message).not.toContain('closing');
  expect(message).not.toContain('closed');
}

function expectDisableRetainWording(message: string): void {
  expect(message).toContain('禁用');
  expect(message).toContain('读取');
  expect(message).toContain('保留');
}

/** AC-R1-3 + AC-R2-1：status.fatal 稳定摘要面（{code,message}，无 stack/cause，无泄漏，无旧措辞）。 */
function expectStableFatalSummary(fatal: { code: string; message: string } | null, code: string): void {
  expect(fatal).not.toBeNull();
  if (fatal === null) return;
  expect(fatal.code).toBe(code);
  expect(typeof fatal.message).toBe('string');
  expect(fatal.message.length).toBeGreaterThan(0);
  expect((fatal as unknown as Record<string, unknown>).stack).toBeUndefined();
  expect((fatal as unknown as Record<string, unknown>).cause).toBeUndefined();
  expectMessageNotLeak(fatal.message);
  expectNoClosingWording(fatal.message);
  expectDisableRetainWording(fatal.message);
}

describe('P1 fatal message 稳定面（AC-R1-1/2/3/4：rejection 形状、cause 严格相等、message 无泄漏）', () => {
  it('AC-R1-4 notifier-failure 路径：notifyDirty 抛错 → rejection 为 RuntimeWriteFatalError（phase=notify-dirty-failed, committed=true）、cause 严格等于原始异常实例、message 不含原始异常/ROOT/SCHEMA/input sentinel', async () => {
    const doc = seedDoc();
    const rawErr = leakErrorOf('notify-dirty-failed');
    let notifierCalls = 0;
    const runtime = createNamespaceRuntimeWithSeam({
      handle: fakeHandle(doc),
      notifyDirty: async () => {
        notifierCalls += 1;
        throw rawErr;
      },
    });
    await waitReady(runtime);

    const settled = await settleOf(runtime.mutateData(SET_N(2)));

    expect(settled.kind).toBe('rejected'); // fatal 走 rejection（不出 ok:false 后门）
    if (settled.kind !== 'rejected') return;
    const reason = settled.reason;
    expect(reason).toBeInstanceOf(RuntimeWriteFatalError); // 稳定 branded rejection
    const wr = reason as RuntimeWriteFatalError;
    expect(wr.phase).toBe('notify-dirty-failed'); // 稳定 phase
    expect(wr.committed).toBe(true); // 诚实 committed（写已提交、登记通道损坏）
    expect(wr.cause).toBe(rawErr); // 严格等于原始异常实例（零信息损失经标准 cause）
    // 稳定 message 结构（AC-R1-1）
    expectStableFatalMessageShape(wr.message, 'notify-dirty-failed', true);
    // AC-R1-4：message 不含原始异常 sentinel / ROOT / SCHEMA / input sentinel
    expectMessageNotLeak(wr.message);
    // AC-R2-1：message 措辞 = 永久禁用写能力 + 读取仍保留（无 closing/closed 暗示）
    expectNoClosingWording(wr.message);
    expectDisableRetainWording(wr.message);
    // S6 同槽 notifier 恰一次（本槽即唯一一次尝试）
    expect(notifierCalls).toBe(1);
    // AC-R1-3 + AC-R2-1：status.fatal 稳定摘要（{code,message}，无 cause/stack，无泄漏，无旧措辞）
    expectStableFatalSummary(runtime.getStatus().fatal, 'NSRT-FATAL-WRITE-INTERNAL');
    // 事实面：写能力永久禁用、读取保留；不虚假回滚——事务已提交值保留（S5 先提交，S6 才失败）
    const status = runtime.getStatus();
    expect(status.rootWrite.enabled).toBe(false);
    expect(status.schemaWrite.enabled).toBe(false);
    expect(status.read.enabled).toBe(true);
    expect(readValue(runtime, ['n'])).toBe(2);
  });

  it('AC-R1-4 unknown-pipeline-throw 路径：applyValidatedMutation 逃逸非 branded 异常 → rejection 为 RuntimeWriteFatalError（phase=unknown-pipeline-throw, committed=true 保守）、cause 严格等于原始异常实例、message 不含原始异常/ROOT/SCHEMA/input sentinel', async () => {
    const realDoc = seedDoc();
    const rawErr = leakErrorOf('unknown-pipeline-throw');
    // Y.Doc 语义面注入：applyValidatedMutation ⓪ 事务语境 guard 的第一访问点（读
    // doc._transaction / doc._transactionCleanups）抛出自造未知异常——非 DocRuntimeFatalError、
    // 非 branded，与真实 E202 同一逃逸点（S5 catch → unknown-pipeline-throw）。
    const probeDoc = new Proxy(realDoc, {
      get(target, key: string) {
        if (key === '_transaction' || key === '_transactionCleanups') throw rawErr;
        return Reflect.get(target, key, target);
      },
    });
    let notifierCalls = 0;
    const runtime = createNamespaceRuntimeWithSeam({
      handle: fakeHandle(probeDoc as unknown as Y.Doc),
      notifyDirty: async () => {
        notifierCalls += 1;
      },
    });
    await waitReady(runtime);

    const settled = await settleOf(runtime.mutateData(SET_N(2)));

    expect(settled.kind).toBe('rejected');
    if (settled.kind !== 'rejected') return;
    const reason = settled.reason;
    expect(reason).toBeInstanceOf(RuntimeWriteFatalError);
    const wr = reason as RuntimeWriteFatalError;
    expect(wr.phase).toBe('unknown-pipeline-throw'); // 未知异常按管线位置分类
    expect(wr.committed).toBe(true); // 未知异常保守视为已提交（ADR 过报方向）
    expect(wr.cause).toBe(rawErr); // 严格等于原始异常实例
    expectStableFatalMessageShape(wr.message, 'unknown-pipeline-throw', true);
    expectMessageNotLeak(wr.message);
    expectNoClosingWording(wr.message);
    expectDisableRetainWording(wr.message);
    // committed:true → 槽内 best-effort notifier 恰一次（登记最新 live doc）
    expect(notifierCalls).toBe(1);
    // AC-R1-3 + AC-R2-1
    expectStableFatalSummary(runtime.getStatus().fatal, 'NSRT-FATAL-WRITE-INTERNAL');
    const status = runtime.getStatus();
    expect(status.rootWrite.enabled).toBe(false);
    expect(status.schemaWrite.enabled).toBe(false);
    expect(status.read.enabled).toBe(true);
    // ⓪ 在任何 doc 触碰前拒绝 → 零写入事实：读取保留且未被改写
    expect(readValue(runtime, ['n'])).toBe(1);
  });
});

describe('P2 术语纪律可执行面（AC-R2-1：可观测 message 无「永久关闭」/closing/closed，含「禁用/读取/保留」）', () => {
  it('AC-R2-1 P0 internal fault 摘要（FATAL_P0_INTERNAL_MESSAGE）与 fatal 后 S1 gate disabled 措辞：永久禁用写能力、读取保留，不暗示 closing/closed 生命周期', async () => {
    const doc = seedDoc();
    const runtime = createNamespaceRuntimeWithSeam({
      handle: fakeHandle(doc),
      compile: () => {
        throw new Error(`${PATH_SENTINEL}-p0`);
      },
    });
    // P0 internal fault → status.fatal 摘要（P0 稳定码常量）
    await expect.poll(() => runtime.getStatus().fatal, { interval: 10, timeout: 5_000 }).not.toBeNull();
    expectStableFatalSummary(runtime.getStatus().fatal, 'NSRT-FATAL-P0-INTERNAL');

    // fatal 已置位 → 后续写经 S1 gate：disabled 结果（稳定码 + 零写入声明），措辞面同步收货
    const settled = await settleOf(runtime.mutateData(SET_N(5)));
    expect(settled.kind).toBe('resolved');
    if (settled.kind !== 'resolved') return;
    const issues = issuesOf(settled.value);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    const joined = issues.map((i) => i.message).join('\n');
    expect(joined).toContain('RUNTIME_WRITE_DISABLED'); // 稳定码（D9）
    expect(joined).toContain('fatal 已置位'); // S1 gate 语义面
    // P2：措辞 = 永久禁用写能力 + 读取保留，无「永久关闭」/closing/closed
    expectNoClosingWording(joined);
    expectDisableRetainWording(joined);
    // 事实面：disabled 且读取保留
    expect(runtime.getStatus().read.enabled).toBe(true);
    expect(readValue(runtime, ['n'])).toBe(1);
  });
});
