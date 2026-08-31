/**
 * SA6 红灯测试 — @nomicore/namespace-runtime 队首 P0 schema preparation
 * （issue #89 / ADR-0008，功能开发：Runtime 骨架 + 同步读取面 + 队首 P0，子集）。
 *
 * 契约来源：
 * - docs/adr/0008「P0 与 active schema」节：「Runtime 发布前，P0 已作为 write
 *   sequencer 的真实队首节点入队」；「P0 只读取 SCHEMA 标准四键、调用
 *   compileSchemaEnvelope 并构造 schema-dependent tools，不读取、提取或验证 ROOT」；
 *   「P0 结算后出队，只保留：preparing；ready 与 active schema tools；或 unavailable
 *   与稳定 schema issue 摘要」；「正常 compile result failure 仅使 ROOT write
 *   unavailable；SCHEMA write仍可修复。P0 抛出结果联合之外的 internal exception 则
 *   触发 internal fatal：永久禁用该 Runtime 的所有写（读取保留——ADR 原措辞为
 *   「永久关闭」，本轮统一为「永久禁用…读取保留」语义）」；
 * - docs/adr/0008「读取能力」节：「普通 open 不执行 schema、ROOT 载体或 logical
 *   validation」；「读取只观察调用瞬间已经提交的 live Y.Doc」；
 * - 任务简报 AC5/AC6/AC7/AC8。
 *
 * 本文件冻结的契约锚点（SA3 实现的行为锚，仅可补充）：
 * - P0 是真实异步队首任务：构造同步返回且 schema.state === 'preparing'，P0 绝不
 *   在构造调用栈内同步结算；结算后转 'ready'；
 * - 真实 ready 路径：getActiveSchema() 返回 { lang, version, id, envelopeFingerprint,
 *   semanticFingerprint }，双指纹与 @nomicore/vfsl compileSchemaEnvelope 对同一信封的
 *   产物逐字节一致（P0 经公共编译接缝），且不暴露 module/derived/validator；
 * - P0 只读取 SCHEMA 标准四键：注入 compile 收到的信封恰为四键投影（无额外键）；
 * - P0 不读取、不验证 ROOT：ROOT 为非 Y.Map 载体（Y.Text）或内容违反 schema 均
 *   照常 ready；且读取面不重校验（违反 schema 的逻辑值可原样读出）；
 * - 正常 compile failure → schema.state 'unavailable' + 稳定 issue 摘要（code/message
 *   字符串、无 stack/cause）+ rootWrite.enabled false + schemaWrite.enabled true
 *   （SCHEMA write 可修复）+ 读取保留 + getActiveSchema() null；
 * - P0 internal throw（注入 compile 抛错）→ 构造不抛、fatal 槽位填稳定摘要（不含原始
 *   错误文本、无 stack/cause）、rootWrite/schemaWrite 全部永久禁用、读取保留；
 * - 结算后 schema.state 只属 {preparing, ready, unavailable} 且收敛稳定。
 *
 * 红灯现状（构造性红灯）：@nomicore/namespace-runtime 包不存在，../src/index.js
 * 无法解析 → 全部用例 import 阶段红（模块未找到）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createMemoryPersistence } from '@nomicore/persistence';
import type { DocHandle, User } from '@nomicore/persistence';
import { realPersistenceScheduler } from './real-persistence-scheduler.js';
import { compileSchemaEnvelope } from '@nomicore/vfsl';
import type { CompileSchemaEnvelopeResult, SchemaEnvelope } from '@nomicore/vfsl';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';

const OWNER: User = { userId: 'u-alice' };
const TEXT_VALID = 'type ROOT = { n: number; a: string; };';
const TEXT_BAD = 'type ROOT = { a: ; };';
const ENVELOPE_FIXTURE = { lang: 'vfsl', version: 1, id: 'ns-1', text: TEXT_VALID } as const;

async function makeHandle(opts: {
  schema?: Record<string, unknown>;
  rootCarrier?: 'map' | 'text';
  rootValues?: Record<string, unknown>;
} = {}): Promise<{ persistence: ReturnType<typeof createMemoryPersistence>; handle: DocHandle; doc: Y.Doc }> {
  const persistence = createMemoryPersistence({ scheduler: realPersistenceScheduler });
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(opts.schema ?? { ...ENVELOPE_FIXTURE })) {
    sc.set(k, v);
  }
  const meta = doc.getMap('META');
  meta.set('docId', 'ns-1');
  meta.set('createdAt', 1_700_000_000_000);
  if (opts.rootCarrier === 'text') {
    const text = doc.getText('ROOT');
    text.insert(0, 'garbage-carrier-not-a-map');
  } else {
    const root = doc.getMap('ROOT');
    for (const [k, v] of Object.entries(opts.rootValues ?? { n: 'str', a: 'val' })) {
      root.set(k, v);
    }
  }
  const handle = await persistence.createDoc(OWNER, 'ns-1', doc);
  return { persistence, handle, doc };
}

function asActiveInfo(value: unknown): {
  lang: string;
  version: number;
  id: string;
  envelopeFingerprint: string;
  semanticFingerprint: string;
} | null {
  return value as { lang: string; version: number; id: string; envelopeFingerprint: string; semanticFingerprint: string } | null;
}

describe('namespace-runtime 队首 P0（AC5/AC6/AC7/AC8）', () => {
  it('AC5/AC7：P0 是真实异步队首节点——构造后 preparing，结算后 ready 并安装 active schema tools', async () => {
    const { handle } = await makeHandle();
    const runtime = createNamespaceRuntimeWithSeam({ handle });

    // P0 是 sequencer 上的异步任务：构造同步返回，P0 绝不在构造调用栈内结算
    expect(runtime.getStatus().schema.state).toBe('preparing');

    await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');

    const status = runtime.getStatus();
    expect(status.schema.state).toBe('ready');
    expect(status.lifecycle).toBe('ready');
    expect(status.read.enabled).toBe(true);
    expect(status.rootWrite.enabled).toBe(true);
    expect(status.schemaWrite.enabled).toBe(true);
    expect(status.fatal).toBeNull();

    // active schema 身份 + 双指纹与公共编译接缝产物逐字节一致（P0 调用 compileSchemaEnvelope）
    const active = asActiveInfo(runtime.getActiveSchema());
    expect(active).not.toBeNull();
    const compiled = compileSchemaEnvelope({ ...ENVELOPE_FIXTURE });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error('fixture 信封必须可编译');
    expect(active!.lang).toBe('vfsl');
    expect(active!.version).toBe(1);
    expect(active!.id).toBe('ns-1');
    expect(active!.envelopeFingerprint).toBe(compiled.envelopeFingerprint);
    expect(active!.semanticFingerprint).toBe(compiled.semanticFingerprint);
    // 不暴露 module / derived / validator（ADR-0008：不暴露 module、derived 或 validator）
    expect((active as unknown as Record<string, unknown>).module).toBeUndefined();
    expect((active as unknown as Record<string, unknown>).derived).toBeUndefined();
    expect((active as unknown as Record<string, unknown>).validator).toBeUndefined();
  });

  it('AC5/AC8：P0 只读取 SCHEMA 标准四键——注入 compile 收到的信封恰为四键投影（无额外键）；ok:false 形成 unavailable', async () => {
    let received: SchemaEnvelope | null = null;
    const injectedCompile = (envelope: SchemaEnvelope): CompileSchemaEnvelopeResult => {
      received = envelope;
      // 类型层放宽（R3）：'ENV_TEST' 有意越出 vfsl SchemaEnvelopeIssueCode 闭集码域——
      // R2 #5 不透明透传契约（P0 不得按码域解释/重分类注入的 issue code，原样投影为
      // 稳定摘要）。字面量先按 unknown 构造再单点收窄为 CompileSchemaEnvelopeResult；
      // 运行期值形状零变化（ok:false + 单条 envelope issue），行为断言与冻结锚点不受影响。
      const injected: unknown = {
        ok: false,
        issues: [{ kind: 'envelope', issue: { code: 'ENV_TEST', message: 'seam rejection' } }],
      };
      return injected as CompileSchemaEnvelopeResult;
    };
    const schema: Record<string, unknown> = { ...ENVELOPE_FIXTURE, extraKey: 'extra-value', extraNum: 42 };
    const { handle } = await makeHandle({ schema });
    const runtime = createNamespaceRuntimeWithSeam({ handle, compile: injectedCompile });

    await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('unavailable');
    // P0 恰投影四个标准键（额外键在投影面即被忽略，未进入编译输入）
    expect(received).toEqual(ENVELOPE_FIXTURE);
    if (received === null) throw new Error('注入 compile 必须被 P0 调用');
    expect([...Object.keys(received)].sort()).toEqual(['id', 'lang', 'text', 'version']);
  });

  it('AC5：P0 不读取或验证 ROOT——ROOT 载体非 Y.Map（Y.Text）仍照常 ready', async () => {
    const { handle } = await makeHandle({ rootCarrier: 'text' });
    const runtime = createNamespaceRuntimeWithSeam({ handle });

    await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');
    expect(runtime.getActiveSchema()).not.toBeNull();
    // 读取面按实际载体投影：ROOT 非 map → 拒绝（doc-runtime 语义）；与 P0 无关
    const read = runtime.readData([]);
    expect(read.ok).toBe(false);
    if (read.ok) throw new Error('Y.Text ROOT 上读取应被载体纪律拒绝');
    expect(read.code).toBe('PATH_NOT_ALLOWED');
  });

  it('AC5：P0 不验证 ROOT 逻辑值——违反 schema 的 ROOT 内容照常 ready 且可原样读出（读取不重校验）', async () => {
    // schema: n: number；ROOT 实存 'str'（string）——违反 schema，但 P0/读取均不得因此失败
    const { handle } = await makeHandle();
    const runtime = createNamespaceRuntimeWithSeam({ handle });

    await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');
    const read = runtime.readData(['n']);
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error(`期望 ok:true，实际 code=${read.code}`);
    expect(read.value).toBe('str');
  });

  it('AC6：P0 正常 compile failure → schema-unavailable + 稳定 issue 摘要 + ROOT write 关、SCHEMA write 可修复、读取保留', async () => {
    const { handle } = await makeHandle({ schema: { lang: 'vfsl', version: 1, id: 'ns-1', text: TEXT_BAD } });
    const runtime = createNamespaceRuntimeWithSeam({ handle });

    await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('unavailable');

    const status = runtime.getStatus();
    expect(status.schema.state).toBe('unavailable');
    expect(status.rootWrite.enabled).toBe(false);
    expect(status.schemaWrite.enabled).toBe(true); // SCHEMA write 仍可修复
    expect(status.fatal).toBeNull();
    expect(runtime.getActiveSchema()).toBeNull();

    // 稳定 issue 摘要：code/message 字符串，无原始 Error/stack/cause
    const issue = status.schema.issue;
    expect(issue).toBeTruthy();
    expect(typeof issue!.code).toBe('string');
    expect(issue!.code.length).toBeGreaterThan(0);
    expect(typeof issue!.message).toBe('string');
    expect(issue!.message.length).toBeGreaterThan(0);
    expect((issue as unknown as Record<string, unknown>).stack).toBeUndefined();
    expect((issue as unknown as Record<string, unknown>).cause).toBeUndefined();

    // 读取保留：四键投影与 META 照常
    expect(runtime.getSchema()).toEqual({ lang: 'vfsl', version: 1, id: 'ns-1', text: TEXT_BAD });
    const meta = runtime.getMetadata();
    expect(meta.docId).toBe('ns-1');

    // 摘要稳定：后续 getStatus 同值
    expect(runtime.getStatus().schema.issue).toEqual(issue);
  });

  it('AC6：P0 internal throw（注入 compile 抛错）→ fatal 摘要稳定、全部写永久禁用、读取保留', async () => {
    const BOOM = 'NSRT-P0-INTERNAL-SENTINEL-9f8c21';
    const { handle } = await makeHandle();
    const runtime = createNamespaceRuntimeWithSeam({
      handle,
      compile: () => {
        throw new Error(BOOM);
      },
    });

    // P0 internal 异常经结构化通道：构造本身与调用方均不接收裸异常
    expect(runtime.getStatus().schema.state).toBe('preparing');
    await expect.poll(() => runtime.getStatus().fatal, { interval: 10, timeout: 5_000 }).not.toBeNull();

    const status = runtime.getStatus();
    const fatal = status.fatal;
    expect(fatal).not.toBeNull();
    expect(typeof fatal!.code).toBe('string');
    expect(fatal!.code.length).toBeGreaterThan(0);
    expect(typeof fatal!.message).toBe('string');
    expect(fatal!.message.length).toBeGreaterThan(0);
    // 稳定摘要：不含原始错误文本，无 stack/cause（ADR-0008 「稳定且不含原始 Error/stack」）
    expect(fatal!.message).not.toContain(BOOM);
    expect((fatal as unknown as Record<string, unknown>).stack).toBeUndefined();
    expect((fatal as unknown as Record<string, unknown>).cause).toBeUndefined();

    // 永久禁用全部写（ROOT + SCHEMA），读取保留
    expect(status.rootWrite.enabled).toBe(false);
    expect(status.schemaWrite.enabled).toBe(false);
    expect(['preparing', 'ready', 'unavailable']).toContain(status.schema.state);
    const read = runtime.readData(['n']);
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error(`期望 ok:true，实际 code=${read.code}`);
    expect(read.value).toBe('str');
    expect(runtime.getSchema()).toEqual(ENVELOPE_FIXTURE);
    expect(runtime.getMetadata().docId).toBe('ns-1');

    // 关闭是永久态：后续采样仍关闭（非瞬时）
    await expect.poll(() => runtime.getStatus().rootWrite.enabled, { interval: 10, timeout: 5_000 }).toBe(false);
    expect(runtime.getStatus().schemaWrite.enabled).toBe(false);
  });

  it('AC7：P0 结算后出队——schema.state 只属三态集合且收敛稳定', async () => {
    const { handle } = await makeHandle();
    const runtime = createNamespaceRuntimeWithSeam({ handle });
    expect(['preparing', 'ready', 'unavailable']).toContain(runtime.getStatus().schema.state);

    await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');

    const samples: string[] = [];
    for (let i = 0; i < 5; i++) {
      const state = runtime.getStatus().schema.state;
      samples.push(state);
      expect(['preparing', 'ready', 'unavailable']).toContain(state);
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(samples.every((s) => s === 'ready')).toBe(true);
  });
});
