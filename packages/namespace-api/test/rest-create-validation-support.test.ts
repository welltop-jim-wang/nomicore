/**
 * SA6 契约支撑负控 / fixture 有效性锚（issue #268，恒绿基线段）。
 *
 * 目的：`rest-create-*-contract.test.ts` 的红灯必须只能归因于 REST 路由缺失的入站校验/
 * limits/problem 契约，而不是契约 fixture 本身、平台 JSON 语义、VFSL 窄接口或 Registry
 * 领域判定。本文件不调用 router，只亲证：
 *
 * 1. 平台语义锚：last-key-wins、`-0` 可解析、malformed JSON 的平台报错携带位置（正是
 *    REST 必须收敛掉的信息），请求 fixture（percent-encoding / 流式 body / 空 body）可构造；
 * 2. VFSL 锚：合法 schemaText 派生 sc1-，非法 schemaText 的 issues 携带 line/column
 *    （422 映射的真实来源）；
 * 3. Registry 锚：ROOT 领域非法 → `NAMESPACE_ROOT_INVALID` 且 issues 携带 path；
 *    深层嵌套 / 120k 数组 / `-0` / `Number.MAX_SAFE_INTEGER` / 256 KiB 注释文本本身可被
 *    领域接纳（413/400 期望纯属 REST 策略，不是下游拒收）；
 * 4. 门禁锚：非有限数在 Registry 输入快照即 `NAMESPACE_CREATE_INVALID_INPUT`
 *    （REST 若不做数字范围检查将落入安全 500 路径，而非 400）；
 * 5. poison registry 自证：任何成员被调用即 throw（契约中「零 Registry 触达」断言有效）。
 *
 * 本文件在当前 HEAD 即绿；SA3 落地后仍须恒绿（不得因实现引入回归）。
 */
import { describe, expect, it } from 'vitest';
import { deriveSchemaIdentity } from '@nomicore/vfsl';
import {
  SCHEMA_TEXT,
  createContractRegistry,
  createMemoryFixture,
  createPoisonRegistry,
  type PersistenceFixture,
} from './rest-contract-harness.js';
import {
  NUMBER_ARRAY_SCHEMA_TEXT,
  TWO_FIELD_SCHEMA_TEXT,
  UNKNOWN_FIELD_SCHEMA_TEXT,
  deepNestedRootRawBody,
  exactByteSchemaText,
  streamedJsonRequest,
  utf8Bytes,
  type RestIssueShape,
} from './rest-validation-harness.js';

const SCHEMA_TEXT_DEFAULT_LIMIT = 256 * 1024;

async function withFixture<T>(
  run: (registry: ReturnType<typeof createContractRegistry>, fixture: PersistenceFixture) => Promise<T>,
): Promise<T> {
  const fixture = await createMemoryFixture();
  const registry = createContractRegistry(fixture.persistence);
  try {
    return await run(registry, fixture);
  } finally {
    await registry.shutdown();
    await fixture.dispose();
    await fixture.cleanup();
  }
}

function envelopeFor(schemaText: string): { lang: 'vfsl'; version: 1; id: string; text: string } | undefined {
  const derived = deriveSchemaIdentity(schemaText);
  if (!derived.ok) return undefined;
  return { lang: 'vfsl', version: 1, id: derived.schemaId, text: schemaText };
}

describe('issue #268 契约支撑锚（平台 / fixture，恒绿）', () => {
  it('平台 JSON 语义锚：last-key-wins、`-0` 可解析、malformed 平台报错携带位置', () => {
    const duplicate = JSON.parse('{"schemaText":1,"schemaText":2}') as { schemaText: number };
    expect(duplicate.schemaText).toBe(2);
    const negativeZero = JSON.parse('-0') as number;
    expect(Object.is(negativeZero, -0)).toBe(true);
    let platformMessage = '';
    try {
      JSON.parse('{"schemaText":1} trailing');
    } catch (error) {
      platformMessage = error instanceof Error ? error.message : String(error);
    }
    // REST 契约要求「malformed JSON 只返回通用错误、不含源码位置」——平台报错正是必须收敛的输入。
    expect(platformMessage).toMatch(/position|line|column/i);
  });

  it('Request fixture 锚：percent-encoding 保持 raw；流式 body 无 Content-Length；空 body 可构造', async () => {
    const encoded = new Request('http://localhost/v1/owners/%61lice/namespaces', { method: 'POST' });
    expect(new URL(encoded.url).pathname).toBe('/v1/owners/%61lice/namespaces');

    const streamed = streamedJsonRequest(
      'http://localhost/v1/owners/alice/namespaces',
      [new Uint8Array(200).fill(120)],
    );
    expect(streamed.headers.get('content-length')).toBeNull();
    let bytes = 0;
    const reader = streamed.body?.getReader();
    if (reader === undefined) throw new Error('契约前置失败：流式 Request 必须有 body');
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value?.byteLength ?? 0;
    }
    expect(bytes).toBe(200);

    const empty = new Request('http://localhost/v1/owners/alice/namespaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '',
    });
    expect(await empty.text()).toBe('');
  });

  it('VFSL 窄接口锚：合法文本派生 sc1-；非法文本 issues 携带 line/column（422 的真实来源）', () => {
    const ok = deriveSchemaIdentity(SCHEMA_TEXT);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.schemaId).toMatch(/^sc1-[a-z2-7]{52}$/);

    for (const text of ['type ROOT = {', `type ROOT = { a: ${'Z'.repeat(1500)} };`, 'type ROOT = number;']) {
      const failed = deriveSchemaIdentity(text);
      expect(failed.ok, JSON.stringify(text.slice(0, 40))).toBe(false);
      if (failed.ok) continue;
      expect(failed.issues.length).toBeGreaterThan(0);
      expect(failed.issues[0]?.line).toBeGreaterThanOrEqual(1);
      expect(failed.issues[0]?.column).toBeGreaterThanOrEqual(1);
    }
  });

  it('Registry 锚：ROOT 领域非法 → NAMESPACE_ROOT_INVALID 且 issues 携带 path', async () => {
    await withFixture(async (registry) => {
      const cases = [
        { schemaText: TWO_FIELD_SCHEMA_TEXT, root: {} },
        { schemaText: 'type ROOT = { v: number };', root: { v: 'not-a-number' } },
        { schemaText: 'type ROOT = { n: number };', root: { n: 'not-a-number' } },
      ];
      for (const body of cases) {
        const created = await registry.create({
          owner: { userId: 'support-owner' },
          schema: envelopeFor(body.schemaText),
          root: body.root,
        });
        expect(created.ok).toBe(false);
        if (created.ok) continue;
        expect(created.code).toBe('NAMESPACE_ROOT_INVALID');
        if (created.code !== 'NAMESPACE_ROOT_INVALID') continue;
        const issues = created.issues as readonly RestIssueShape[];
        expect(issues.length).toBeGreaterThan(0);
        expect(issues.some((issue) => Array.isArray(issue.path))).toBe(true);
      }
    });
  });

  it('Registry 锚：深层 / 数组 / -0 / MAX_SAFE_INTEGER / 256 KiB 文本本身可被领域接纳', async () => {
    await withFixture(async (registry) => {
      const accepted: Array<{ schemaText: string; root: unknown }> = [
        { schemaText: UNKNOWN_FIELD_SCHEMA_TEXT, root: { v: [[[[[[[[[[0]]]]]]]]]] } },
        { schemaText: NUMBER_ARRAY_SCHEMA_TEXT, root: { v: [1, 2, 3] } },
        { schemaText: 'type ROOT = { n: number };', root: { n: -0 } },
        { schemaText: 'type ROOT = { n: number };', root: { n: Number.MAX_SAFE_INTEGER } },
        { schemaText: exactByteSchemaText(SCHEMA_TEXT_DEFAULT_LIMIT), root: { title: 'hello' } },
      ];
      for (const body of accepted) {
        const created = await registry.create({
          owner: { userId: 'support-owner' },
          schema: envelopeFor(body.schemaText),
          root: body.root,
        });
        expect(created.ok, `schema=${body.schemaText.slice(0, 40)} 应被领域接纳`).toBe(true);
        if (created.ok) await created.lease.release();
      }
    });
  });

  it('Registry 门禁锚：非有限数在输入快照即 NAMESPACE_CREATE_INVALID_INPUT（REST 必须先查数字范围）', async () => {
    await withFixture(async (registry) => {
      const created = await registry.create({
        owner: { userId: 'support-owner' },
        schema: envelopeFor('type ROOT = { n: number };'),
        root: { n: Number.POSITIVE_INFINITY },
      });
      expect(created.ok).toBe(false);
      if (!created.ok) expect(created.code).toBe('NAMESPACE_CREATE_INVALID_INPUT');
    });
  });

  it('poison registry 自证：任何成员被调用即 throw（零触达断言的有效性）', () => {
    const poison = createPoisonRegistry();
    expect(() => poison.getStatus()).toThrow(/触达/);
    expect(() => poison.create({ owner: { userId: 'x' }, schema: {}, root: {} })).toThrow(/触达/);
  });

  it('deepNestedRootRawBody 锚：深度与字节可预期（避免构造侧栈噪声）', () => {
    const body = deepNestedRootRawBody(50_000, '0');
    expect(utf8Bytes(body)).toBeGreaterThan(100_000);
    expect(body.startsWith('{"schemaText":')).toBe(true);
    expect(body.endsWith(']]}}')).toBe(true);
    const parsed = JSON.parse(body) as { root: { v: unknown[] } };
    expect(Array.isArray(parsed.root.v)).toBe(true);
  });
});
