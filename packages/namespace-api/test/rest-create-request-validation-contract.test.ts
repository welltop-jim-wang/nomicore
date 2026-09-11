/**
 * SA6 验收契约（Feature 红灯固化）— issue #268：REST create 入站校验（HTTP/media 层、
 * JSON 处理、顶层形状、领域 422 映射）。
 *
 * 契约来源（逐条对应见 SA6 报告 §12.2）：
 * - 任务简报 `wiki/raw/task_issue-268.md` AC1（非法 owner / query / 空 body / malformed
 *   JSON / 请求形状 / 数字范围 → 400；媒体类型不支持 → 415；schema 或 ROOT invalid → 422）
 *   与 AC5（重复 key 平台语义、`-0` 无额外语义、malformed JSON 不返回源码位置）；
 * - ADR 0015 §HTTP 契约 L63–75（owner 安全文法 + path 禁止 percent-encoding；首版不接受
 *   query；Content-Type 只接受 `application/json` 与仅带 `charset=utf-8` 的形式；
 *   Content-Encoding 只接受缺失或 `identity`；顶层非数组 object + 恰 `schemaText`/`root`
 *   两个 own keys；`root` 必须显式提交；`schemaText` 必须 string，空串交 VFSL）；
 * - ADR 0015 §JSON 处理 L94–101（有界收集 → 严格 UTF-8 → 平台标准 JSON；
 *   last-key-wins；malformed 只返回通用错误、不含源码位置）；
 * - ADR 0015 §错误契约 L163–174（稳定 code 分支、固定 problem shape、issues 受控安全）。
 *
 * 契约假设（PROPOSAL，待 SA1/SA2 仲裁）：H5/H6/H7 见 `rest-validation-harness.ts` 头注
 * 与 SA6 报告 §12.1；若设计另有裁决须回写本文件并走修订轮。
 *
 * 状态（iteration 0）：HEAD `0b06050`（#267 骨架）只做成功路径与 role gate；owner/query/
 * media/encoding/形状/limits/Registry 失败映射均按设计延后——非法请求多数直接创建成功或
 * 以 rejection 结算，本文件因此整组红灯（能力缺口，非 Bug 回归）。红灯/可满足性/敏感性
 * 证据见 SA6 报告 §9/§13。
 */
import { describe, expect, it } from 'vitest';
import type { RestRouter } from '../src/rest.js';
import {
  CREATE_URL,
  ROOT_VALUE,
  SCHEMA_TEXT,
  createPoisonRegistry,
  matchedResponse,
  trappedBodyRequest,
} from './rest-contract-harness.js';
import {
  LONG_UNKNOWN_REF_SCHEMA_TEXT,
  NUMBER_SCHEMA_TEXT,
  ROOT_MISMATCH_ROOT,
  TWO_FIELD_SCHEMA_TEXT,
  bodylessRequest,
  collectStringLeaves,
  hubRouter,
  jsonBodyRequest,
  observeProblem,
  rawJsonRequest,
  withRealRegistry,
} from './rest-validation-harness.js';

async function createReal(router: RestRouter, request: Request): Promise<Response> {
  return matchedResponse(await router.handle(request));
}

describe('issue #268 HTTP/媒体层契约（ADR 0015 L63–71、step 3）', () => {
  it('AC1: owner 段任意 percent-encoding → 400，且零 Registry 触达', async () => {
    const encodedOwners = ['%61lice', 'a%20b', 'a%2Fb', 'a%5Cb', 'a%2e', '%25'];
    for (const owner of encodedOwners) {
      const router = hubRouter(createPoisonRegistry());
      const request = jsonBodyRequest(`http://localhost/v1/owners/${owner}/namespaces`, {
        schemaText: SCHEMA_TEXT,
        root: ROOT_VALUE,
      });
      const response = matchedResponse(await router.handle(request));
      const observation = await observeProblem(response, 400);
      expect(observation.body.message.length).toBeGreaterThan(0);
    }
  });

  it('AC1 负控: 合法 owner 文法不被误伤（合法 owner → 201）', async () => {
    await withRealRegistry(async (registry) => {
      for (const owner of ['alice', 'a.b', 'alice-1', 'owner_2']) {
        const response = await createReal(
          hubRouter(registry),
          jsonBodyRequest(`http://localhost/v1/owners/${owner}/namespaces`, {
            schemaText: SCHEMA_TEXT,
            root: ROOT_VALUE,
          }),
        );
        expect(response.status, `owner=${owner}`).toBe(201);
      }
    });
  });

  it('AC1: 任意非空 query 参数 → 400，且零 Registry 触达', async () => {
    for (const query of ['?page=1', '?a=1&b=2', '?dryRun=true']) {
      const router = hubRouter(createPoisonRegistry());
      const request = jsonBodyRequest(`${CREATE_URL}${query}`, {
        schemaText: SCHEMA_TEXT,
        root: ROOT_VALUE,
      });
      const response = matchedResponse(await router.handle(request));
      await observeProblem(response, 400);
    }
  });

  it('AC1: 缺失/不兼容 Content-Type → 415，且零 Registry 触达', async () => {
    const rejected = [
      '',
      'text/plain',
      'text/json',
      'application/json-patch+json',
      'application/json; charset=utf-16',
      'application/json; charset=utf-8; foo=bar',
    ];
    for (const contentType of rejected) {
      const router = hubRouter(createPoisonRegistry());
      const headers = contentType === '' ? {} : { 'content-type': contentType };
      const request = jsonBodyRequest(
        CREATE_URL,
        { schemaText: SCHEMA_TEXT, root: ROOT_VALUE },
        headers,
      );
      const response = matchedResponse(await router.handle(request));
      await observeProblem(response, 415);
    }
  });

  it('AC1: 接受的 Content-Type 形式（application/json 与仅带 charset=utf-8）→ 201', async () => {
    const accepted = [
      'application/json',
      'application/json; charset=utf-8',
      'application/json;charset=utf-8',
      'APPLICATION/JSON',
      'application/json; charset=UTF-8',
    ];
    await withRealRegistry(async (registry) => {
      for (const contentType of accepted) {
        const response = await createReal(
          hubRouter(registry),
          jsonBodyRequest(
            CREATE_URL,
            { schemaText: SCHEMA_TEXT, root: ROOT_VALUE },
            { 'content-type': contentType },
          ),
        );
        expect(response.status, `content-type=${contentType}`).toBe(201);
      }
    });
  });

  it('AC1: Content-Encoding 只接受缺失或 identity（其余 → 415）', async () => {
    await withRealRegistry(async (registry) => {
      for (const encoding of [undefined, 'identity']) {
        const headers =
          encoding === undefined
            ? { 'content-type': 'application/json' }
            : { 'content-type': 'application/json', 'content-encoding': encoding };
        const response = await createReal(
          hubRouter(registry),
          jsonBodyRequest(CREATE_URL, { schemaText: SCHEMA_TEXT, root: ROOT_VALUE }, headers),
        );
        expect(response.status, `content-encoding=${String(encoding)}`).toBe(201);
      }
    });
    for (const encoding of ['gzip', 'br', 'deflate', 'compress']) {
      const router = hubRouter(createPoisonRegistry());
      const request = jsonBodyRequest(
        CREATE_URL,
        { schemaText: SCHEMA_TEXT, root: ROOT_VALUE },
        { 'content-type': 'application/json', 'content-encoding': encoding },
      );
      const response = matchedResponse(await router.handle(request));
      await observeProblem(response, 415);
    }
  });

  it('step 3 顺序: owner/media/encoding 失败时零 body 读取（trapped Request 零消费）', async () => {
    const cases: Request[] = [
      jsonBodyRequest('http://localhost/v1/owners/%61lice/namespaces', {
        schemaText: SCHEMA_TEXT,
        root: ROOT_VALUE,
      }),
      jsonBodyRequest(
        CREATE_URL,
        { schemaText: SCHEMA_TEXT, root: ROOT_VALUE },
        { 'content-type': 'text/plain' },
      ),
      jsonBodyRequest(
        CREATE_URL,
        { schemaText: SCHEMA_TEXT, root: ROOT_VALUE },
        { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      ),
    ];
    for (const raw of cases) {
      const router = hubRouter(createPoisonRegistry());
      const observation = { bodyConsumptionAttempts: [] as string[] };
      const request = trappedBodyRequest(raw, observation);
      const response = matchedResponse(await router.handle(request));
      expect([400, 415]).toContain(response.status);
      expect(observation.bodyConsumptionAttempts).toEqual([]);
    }
  });
});

describe('issue #268 JSON 处理与顶层形状契约（ADR 0015 L72–75、L94–101）', () => {
  it('AC1: 无 body / 空 body → 400，且零 Registry 触达', async () => {
    const requests = [
      bodylessRequest(CREATE_URL),
      rawJsonRequest(CREATE_URL, ''),
      bodylessRequest(CREATE_URL, { 'content-type': 'application/json' }),
    ];
    for (const request of requests) {
      const router = hubRouter(createPoisonRegistry());
      const response = matchedResponse(await router.handle(request));
      await observeProblem(response, 400);
    }
  });

  it('AC1/AC5: malformed JSON → 400，只返回通用错误、不返回源码位置', async () => {
    const malformed = [
      '{"schemaText":',
      `{"schemaText":${JSON.stringify(SCHEMA_TEXT)},"root":${JSON.stringify(ROOT_VALUE)}} trailing`,
      "{'schemaText': 'type ROOT = { title: string };'}",
      '{"schemaText" 1}',
      'not-json-at-all',
    ];
    for (const rawBody of malformed) {
      const router = hubRouter(createPoisonRegistry());
      const response = matchedResponse(await router.handle(rawJsonRequest(CREATE_URL, rawBody)));
      const observation = await observeProblem(response, 400);
      expect(observation.body.issuesTruncated).not.toBe(true);
      expect(observation.body.issues ?? []).toEqual([]);
      for (const leaf of collectStringLeaves(observation.body)) {
        expect(leaf, `malformed JSON 的 message 不得携带源码位置: ${leaf}`).not.toMatch(
          /\b(position|offset)\b/i,
        );
        expect(leaf, `malformed JSON 的 message 不得携带源码位置: ${leaf}`).not.toMatch(
          /\bline\s*\d+\b|\bcolumn\s*\d+\b/i,
        );
      }
    }
  });

  it('AC1: 顶层形状错误（非 object / 数组 / 多余键 / 缺键 / 非 string）→ 400', async () => {
    const badShapes: unknown[] = [
      [],
      null,
      'type ROOT = { title: string };',
      42,
      true,
      { schemaText: SCHEMA_TEXT, root: ROOT_VALUE, extra: 1 },
      { root: ROOT_VALUE },
      { schemaText: SCHEMA_TEXT },
      { schemaText: 42, root: ROOT_VALUE },
      { schemaText: null, root: ROOT_VALUE },
    ];
    for (const body of badShapes) {
      const router = hubRouter(createPoisonRegistry());
      const response = matchedResponse(await router.handle(jsonBodyRequest(CREATE_URL, body)));
      await observeProblem(response, 400);
    }
  });

  it('AC1 负控: 恰两键的合法形状 → 201（形状校验不误伤成功路径）', async () => {
    await withRealRegistry(async (registry) => {
      const response = await createReal(
        hubRouter(registry),
        jsonBodyRequest(CREATE_URL, { schemaText: SCHEMA_TEXT, root: ROOT_VALUE }),
      );
      expect(response.status).toBe(201);
    });
  });

  it('AC5: 重复 key 遵循平台 last-key-wins（REST 不建立额外语义）', async () => {
    const schemaLiteral = JSON.stringify(SCHEMA_TEXT);
    const lastValid = `{"schemaText":42,"root":${JSON.stringify(ROOT_VALUE)},"schemaText":${schemaLiteral}}`;
    const lastInvalid = `{"schemaText":${schemaLiteral},"root":${JSON.stringify(ROOT_VALUE)},"schemaText":42}`;
    await withRealRegistry(async (registry) => {
      const ok = await createReal(hubRouter(registry), rawJsonRequest(CREATE_URL, lastValid));
      expect(ok.status, 'last-key-wins：最后一个 schemaText 合法 ⇒ 201').toBe(201);
    });
    const router = hubRouter(createPoisonRegistry());
    const response = matchedResponse(await router.handle(rawJsonRequest(CREATE_URL, lastInvalid)));
    await observeProblem(response, 400);
  });

  it('AC1/形状-领域边界: schemaText 空字符串 → 422（不是 400 形状错误）', async () => {
    const router = hubRouter(createPoisonRegistry());
    const response = matchedResponse(
      await router.handle(jsonBodyRequest(CREATE_URL, { schemaText: '', root: {} })),
    );
    await observeProblem(response, 422);
  });

  it('AC1/形状-领域边界: root 显式 null → 422（REST 不预设 root 形状）', async () => {
    await withRealRegistry(async (registry) => {
      const response = await createReal(
        hubRouter(registry),
        jsonBodyRequest(CREATE_URL, { schemaText: TWO_FIELD_SCHEMA_TEXT, root: null }),
      );
      await observeProblem(response, 422);
    });
  });
});

describe('issue #268 422 领域映射契约（ADR 0015 L174、L163–165）', () => {
  it('AC1: schema 非法（语法/未知名引用/缺 ROOT/空串）→ 422，且零 Registry 触达', async () => {
    const invalidSchemas = [
      'type ROOT = {',
      'type ROOT = { a: Nope1; };',
      LONG_UNKNOWN_REF_SCHEMA_TEXT,
      '',
      'type ROOT = number;',
    ];
    for (const schemaText of invalidSchemas) {
      const router = hubRouter(createPoisonRegistry());
      const response = matchedResponse(
        await router.handle(jsonBodyRequest(CREATE_URL, { schemaText, root: {} })),
      );
      const observation = await observeProblem(response, 422);
      const issues = observation.body.issues ?? [];
      expect(issues.length, `schema=${JSON.stringify(schemaText.slice(0, 40))} 必须有 issues`).toBeGreaterThan(0);
      expect(
        issues.some((issue) => issue.line !== undefined || issue.path !== undefined),
        '422 issues 应保留可用定位信息（line/column 或 path）',
      ).toBe(true);
    }
  });

  it('AC1: ROOT 领域非法（类型不匹配 / 缺必填字段）→ 422，issues 携带 path', async () => {
    await withRealRegistry(async (registry) => {
      const cases = [
        { schemaText: TWO_FIELD_SCHEMA_TEXT, root: {} },
        { schemaText: NUMBER_SCHEMA_TEXT, root: ROOT_MISMATCH_ROOT },
        { schemaText: 'type ROOT = { v: number };', root: { v: 'not-a-number' } },
      ];
      for (const body of cases) {
        const response = await createReal(
          hubRouter(registry),
          jsonBodyRequest(CREATE_URL, { schemaText: body.schemaText, root: body.root }),
        );
        const observation = await observeProblem(response, 422);
        const issues = observation.body.issues ?? [];
        expect(issues.length).toBeGreaterThan(0);
        expect(issues.some((issue) => issue.path !== undefined)).toBe(true);
      }
    });
  });

  it('AC4: 422 response 不泄露 schema/root 片段', async () => {
    const schemaSentinel = 'SA6-SENTINEL-SCHEMA-f3a91';
    const rootSentinel = 'SA6-SENTINEL-ROOT-77c2';
    const router = hubRouter(createPoisonRegistry());
    const schemaResponse = matchedResponse(
      await router.handle(
        jsonBodyRequest(CREATE_URL, {
          schemaText: `// ${schemaSentinel}\ntype ROOT = {`,
          root: {},
        }),
      ),
    );
    const schemaObservation = await observeProblem(schemaResponse, 422);
    expect(schemaObservation.rawText).not.toContain(schemaSentinel);

    await withRealRegistry(async (registry) => {
      const rootResponse = await createReal(
        hubRouter(registry),
        jsonBodyRequest(CREATE_URL, {
          schemaText: TWO_FIELD_SCHEMA_TEXT,
          root: { a: rootSentinel },
        }),
      );
      const rootObservation = await observeProblem(rootResponse, 422);
      expect(rootObservation.rawText).not.toContain(rootSentinel);
    });
  });

  it('AC1 负控: 422 路径不吞掉合法的 201（同 Router 先拒后创）', async () => {
    await withRealRegistry(async (registry) => {
      const router = hubRouter(registry);
      const rejected = await createReal(
        router,
        jsonBodyRequest(CREATE_URL, { schemaText: 'type ROOT = {', root: {} }),
      );
      await observeProblem(rejected, 422);
      const created = await createReal(
        router,
        jsonBodyRequest(CREATE_URL, { schemaText: SCHEMA_TEXT, root: ROOT_VALUE }),
      );
      expect(created.status).toBe(201);
    });
  });
});
