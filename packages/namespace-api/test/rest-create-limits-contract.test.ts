/**
 * SA6 验收契约（Feature 红灯固化）— issue #268：资源 limits（默认值、Host Partial
 * 覆盖、构造期 TypeError、413 与迭代 depth/nodes/数字检查）。
 *
 * 契约来源（逐条对应见 SA6 报告 §12.2）：
 * - 任务简报 AC2（七项默认 limits 生效、Host Partial 覆盖、未知键与越界值构造时
 *   TypeError、`maxSchemaTextBytes > maxBodyBytes` 被拒绝）、AC3（depth/nodes 迭代实现，
 *   深嵌套不栈溢出）、AC5（`-0` 无额外语义）；
 * - ADR 0015 §JSON 处理与资源限制 L103–115（默认数值七项；Partial 覆盖；构造 TypeError；
 *   413；Content-Length 只作提前拒绝、stream 始终执行 byte 上限；迭代检查避免递归栈溢出；
 *   `-0` 无额外语义）、§错误契约 L169–172（400 数字范围 / 413 结构超限）。
 *
 * 契约假设（PROPOSAL，待 SA1/SA2 仲裁）：H5/H6/H7 + 「limit 边界为排他上限（≤ 上限
 * 接受、> 上限 413）」+「跨字段不变量按合并默认后的有效值判定」见报告 §12.1；
 * 若设计另有裁决须回写本文件并走修订轮。
 *
 * 状态（iteration 0）：HEAD `0b06050` 的 limits 是「预留构造面，不校验不执行」，因此本
 * 文件的构造门、默认值、413 与迭代检查断言整组红灯（能力缺口，非 Bug 回归）。
 */
import { describe, expect, it } from 'vitest';
import {
  CREATE_URL,
  ROOT_VALUE,
  SCHEMA_TEXT,
  createPoisonRegistry,
  matchedResponse,
} from './rest-contract-harness.js';
import {
  NUMBER_ARRAY_SCHEMA_TEXT,
  TWO_FIELD_SCHEMA_TEXT,
  UNKNOWN_FIELD_SCHEMA_TEXT,
  deepNestedRootRawBody,
  exactByteSchemaText,
  hubRouter,
  hubRouterWithUntypedLimits,
  jsonBodyRequest,
  manyFieldsSchemaText,
  observeProblem,
  rawJsonRequest,
  streamedJsonRequest,
  utf8Bytes,
  withRealRegistry,
  type RestRouterLimits,
} from './rest-validation-harness.js';

const FOUR_MIB = 4 * 1024 * 1024;
const SCHEMA_TEXT_DEFAULT_LIMIT = 256 * 1024;
const ISSUES_TOTAL_DEFAULT_LIMIT = 64 * 1024;
const ISSUE_MESSAGE_DEFAULT_LIMIT = 1024;

const LIMIT_KEYS = [
  'maxBodyBytes',
  'maxSchemaTextBytes',
  'maxJsonDepth',
  'maxJsonNodes',
  'maxIssues',
  'maxIssueMessageBytes',
  'maxIssuesTotalBytes',
] as const;

/** `totalBytes` 长度的合法 JSON（`pad` 键 ⇒ 读取阶段合法、形状阶段 400，用于隔离 body 上限）。 */
function paddedBody(totalBytes: number): string {
  const prefix = '{"pad":"';
  const suffix = '"}';
  return `${prefix}${'x'.repeat(totalBytes - prefix.length - suffix.length)}${suffix}`;
}

function messageBytes(issue: { readonly message: string }): number {
  return utf8Bytes(issue.message);
}

describe('issue #268 limits 构造期契约（AC2）', () => {
  it('AC2: 未知 limits 键 → 构造时普通 TypeError', () => {
    const registry = createPoisonRegistry();
    const unknownKeys: unknown[] = [
      { maxBoddyBytes: 64 },
      { maxBodyBytes: 1024, unknown: 2 },
      { foo: 1 },
      { MAXBODYBYTES: 1024 },
    ];
    for (const limits of unknownKeys) {
      expect(
        () => hubRouterWithUntypedLimits(registry, limits),
        `limits=${JSON.stringify(limits)} 必须 TypeError`,
      ).toThrow(TypeError);
    }
  });

  it('AC2: 越界值 → 构造时普通 TypeError（七键 × 非正/非整数/非有限/非安全整数）', () => {
    const registry = createPoisonRegistry();
    const invalidValues: unknown[] = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53];
    for (const key of LIMIT_KEYS) {
      for (const value of invalidValues) {
        expect(
          () => hubRouterWithUntypedLimits(registry, { [key]: value }),
          `${key}=${String(value)} 必须 TypeError`,
        ).toThrow(TypeError);
      }
    }
  });

  it('AC2: maxSchemaTextBytes > maxBodyBytes → TypeError；相等允许', () => {
    const registry = createPoisonRegistry();
    expect(() =>
      hubRouterWithUntypedLimits(registry, { maxBodyBytes: 1024, maxSchemaTextBytes: 2048 }),
    ).toThrow(TypeError);
    expect(() =>
      hubRouterWithUntypedLimits(registry, { maxBodyBytes: 1024, maxSchemaTextBytes: 1024 }),
    ).not.toThrow();
  });

  it('AC2: limits 缺省 / 空对象均可构造（默认值生效的负控）', async () => {
    const registry = createPoisonRegistry();
    expect(() => hubRouter(registry)).not.toThrow();
    expect(() => hubRouter(registry, {})).not.toThrow();
    const response = matchedResponse(
      await hubRouter(registry).handle(
        jsonBodyRequest(CREATE_URL, { schemaText: 'type ROOT = {', root: {} }),
      ),
    );
    await observeProblem(response, 422); // poison registry ⇒ step 6 之前结算
  });
});

describe('issue #268 默认 limits 生效（AC2）', () => {
  it('AC2: 默认 body 4 MiB——超 1 byte → 413；恰 4 MiB 不因超限拒绝', async () => {
    const over = matchedResponse(
      await hubRouter(createPoisonRegistry()).handle(
        rawJsonRequest(CREATE_URL, paddedBody(FOUR_MIB + 1)),
      ),
    );
    await observeProblem(over, 413);

    const atLimit = matchedResponse(
      await hubRouter(createPoisonRegistry()).handle(rawJsonRequest(CREATE_URL, paddedBody(FOUR_MIB))),
    );
    // 恰在上限内：必须继续走形状检查（此 body 缺 schemaText/root ⇒ 400），而不是 413。
    await observeProblem(atLimit, 400);
  });

  it('AC2: 默认 schemaText 256 KiB（UTF-8 bytes）——262144 接受（201）、262145 → 413', async () => {
    const acceptedText = exactByteSchemaText(SCHEMA_TEXT_DEFAULT_LIMIT);
    expect(utf8Bytes(acceptedText)).toBe(SCHEMA_TEXT_DEFAULT_LIMIT);
    await withRealRegistry(async (registry) => {
      const response = matchedResponse(
        await hubRouter(registry).handle(
          rawJsonRequest(
            CREATE_URL,
            `{"schemaText":${JSON.stringify(acceptedText)},"root":${JSON.stringify(ROOT_VALUE)}}`,
          ),
        ),
      );
      expect(response.status).toBe(201);
    });

    const overText = exactByteSchemaText(SCHEMA_TEXT_DEFAULT_LIMIT + 1);
    const over = matchedResponse(
      await hubRouter(createPoisonRegistry()).handle(
        rawJsonRequest(
          CREATE_URL,
          `{"schemaText":${JSON.stringify(overText)},"root":${JSON.stringify(ROOT_VALUE)}}`,
        ),
      ),
    );
    await observeProblem(over, 413);
  });

  it('AC2: 默认 JSON depth 64——嵌套 100 → 413；嵌套 10 → 201', async () => {
    const over = matchedResponse(
      await hubRouter(createPoisonRegistry()).handle(
        rawJsonRequest(CREATE_URL, deepNestedRootRawBody(100, '0')),
      ),
    );
    await observeProblem(over, 413);

    await withRealRegistry(async (registry) => {
      const response = matchedResponse(
        await hubRouter(registry).handle(
          jsonBodyRequest(CREATE_URL, {
            schemaText: UNKNOWN_FIELD_SCHEMA_TEXT,
            root: { v: [[[[[[[[[[0]]]]]]]]]] },
          }),
        ),
      );
      expect(response.status).toBe(201);
    });
  });

  it('AC2: 默认 JSON nodes 100,000——120,000 元素 → 413；3 元素 → 201', async () => {
    const over = matchedResponse(
      await hubRouter(createPoisonRegistry()).handle(
        jsonBodyRequest(CREATE_URL, {
          schemaText: NUMBER_ARRAY_SCHEMA_TEXT,
          root: { v: Array.from({ length: 120_000 }, () => 0) },
        }),
      ),
    );
    await observeProblem(over, 413);

    await withRealRegistry(async (registry) => {
      const response = matchedResponse(
        await hubRouter(registry).handle(
          jsonBodyRequest(CREATE_URL, {
            schemaText: NUMBER_ARRAY_SCHEMA_TEXT,
            root: { v: [1, 2, 3] },
          }),
        ),
      );
      expect(response.status).toBe(201);
    });
  });

  it('AC2: 默认 maxIssues 100——底层 101 条 issue 时截断且 issuesTruncated=true', async () => {
    await withRealRegistry(async (registry) => {
      const response = matchedResponse(
        await hubRouter(registry).handle(
          jsonBodyRequest(CREATE_URL, { schemaText: manyFieldsSchemaText(150, 1), root: {} }),
        ),
      );
      const observation = await observeProblem(response, 422);
      const issues = observation.body.issues ?? [];
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.length).toBeLessThanOrEqual(100);
      expect(observation.body.issuesTruncated).toBe(true);
    });
  });

  it('AC2: 默认单条 message 1,024 UTF-8 bytes——超长底层 message 被安全截断', async () => {
    const router = hubRouter(createPoisonRegistry());
    const response = matchedResponse(
      await router.handle(
        jsonBodyRequest(CREATE_URL, {
          schemaText: `type ROOT = { a: ${'Z'.repeat(1500)} };`,
          root: {},
        }),
      ),
    );
    const observation = await observeProblem(response, 422, ISSUE_MESSAGE_DEFAULT_LIMIT);
    expect((observation.body.issues ?? []).length).toBeGreaterThan(0);
  });

  it('AC2: 默认 issues 总预算 64 KiB——超预算时截断、总 byte 不越界', async () => {
    await withRealRegistry(async (registry) => {
      const response = matchedResponse(
        await hubRouter(registry).handle(
          jsonBodyRequest(CREATE_URL, { schemaText: manyFieldsSchemaText(70, 1100), root: {} }),
        ),
      );
      const observation = await observeProblem(response, 422, ISSUE_MESSAGE_DEFAULT_LIMIT);
      const issues = observation.body.issues ?? [];
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.length).toBeLessThanOrEqual(100);
      const total = issues.reduce((sum, issue) => sum + messageBytes(issue), 0);
      expect(total).toBeLessThanOrEqual(ISSUES_TOTAL_DEFAULT_LIMIT);
      expect(observation.body.issuesTruncated).toBe(true);
    });
  });

  it('AC3: 深嵌套（50,000 层）+ 高 depth/nodes 上限下数字范围检查仍终结 → 400（迭代检查）', async () => {
    const limits: RestRouterLimits = {
      maxBodyBytes: FOUR_MIB,
      maxSchemaTextBytes: SCHEMA_TEXT_DEFAULT_LIMIT,
      maxJsonDepth: 1_000_000,
      maxJsonNodes: 1_000_000,
    };
    for (const literal of ['1e400', '9007199254740993']) {
      const response = matchedResponse(
        await hubRouter(createPoisonRegistry(), limits).handle(
          rawJsonRequest(CREATE_URL, deepNestedRootRawBody(50_000, literal)),
        ),
      );
      await observeProblem(response, 400);
    }
  });

  it('AC5: `-0` 无额外语义（与 0 同样走通成功路径）', async () => {
    await withRealRegistry(async (registry) => {
      const router = hubRouter(registry);
      for (const literal of ['0', '-0']) {
        const response = matchedResponse(
          await router.handle(
            rawJsonRequest(
              CREATE_URL,
              `{"schemaText":${JSON.stringify('type ROOT = { n: number };')},"root":{"n":${literal}}}`,
            ),
          ),
        );
        expect(response.status, `n=${literal}`).toBe(201);
      }
    });
  });

  it('AC2 负控: 默认 limits 内合法请求仍 201（上限不误伤成功路径）', async () => {
    await withRealRegistry(async (registry) => {
      const response = matchedResponse(
        await hubRouter(registry).handle(
          jsonBodyRequest(CREATE_URL, { schemaText: SCHEMA_TEXT, root: ROOT_VALUE }),
        ),
      );
      expect(response.status).toBe(201);
    });
  });
});

describe('issue #268 Host Partial 覆盖生效（AC2）', () => {
  it('AC2: maxBodyBytes 覆盖——较小 body 201、超过覆盖值 413', async () => {
    const limits: RestRouterLimits = { maxBodyBytes: 1024, maxSchemaTextBytes: 256 };
    await withRealRegistry(async (registry) => {
      const ok = matchedResponse(
        await hubRouter(registry, limits).handle(
          jsonBodyRequest(CREATE_URL, { schemaText: SCHEMA_TEXT, root: ROOT_VALUE }),
        ),
      );
      expect(ok.status).toBe(201);
    });
    const over = matchedResponse(
      await hubRouter(createPoisonRegistry(), limits).handle(
        rawJsonRequest(CREATE_URL, paddedBody(1025)),
      ),
    );
    await observeProblem(over, 413);
  });

  it('AC2: maxSchemaTextBytes 以 UTF-8 bytes 计——18 bytes（6×CJK）→ 413；16 bytes → 422', async () => {
    const limits: RestRouterLimits = { maxBodyBytes: 4096, maxSchemaTextBytes: 16 };
    const cjkOver = matchedResponse(
      await hubRouter(createPoisonRegistry(), limits).handle(
        jsonBodyRequest(CREATE_URL, { schemaText: '中'.repeat(6), root: {} }),
      ),
    );
    await observeProblem(cjkOver, 413);
    // 恰 16 bytes：不得因上限拒绝（该文本非法 ⇒ 进入领域校验 422）。
    const exact = matchedResponse(
      await hubRouter(createPoisonRegistry(), limits).handle(
        jsonBodyRequest(CREATE_URL, { schemaText: `${'中'.repeat(5)}x`, root: {} }),
      ),
    );
    await observeProblem(exact, 422);
  });

  it('AC2: maxJsonDepth 覆盖——浅嵌套 201、越界 413', async () => {
    const limits: RestRouterLimits = { maxBodyBytes: 4096, maxSchemaTextBytes: 1024, maxJsonDepth: 8 };
    await withRealRegistry(async (registry) => {
      const ok = matchedResponse(
        await hubRouter(registry, limits).handle(
          jsonBodyRequest(CREATE_URL, {
            schemaText: UNKNOWN_FIELD_SCHEMA_TEXT,
            root: { v: [[[0]]] },
          }),
        ),
      );
      expect(ok.status).toBe(201);
    });
    const over = matchedResponse(
      await hubRouter(createPoisonRegistry(), limits).handle(
        rawJsonRequest(CREATE_URL, deepNestedRootRawBody(32, '0')),
      ),
    );
    await observeProblem(over, 413);
  });

  it('AC2: maxJsonNodes 覆盖——3 元素 201、40 元素 413', async () => {
    const limits: RestRouterLimits = { maxBodyBytes: 4096, maxSchemaTextBytes: 1024, maxJsonNodes: 10 };
    await withRealRegistry(async (registry) => {
      const ok = matchedResponse(
        await hubRouter(registry, limits).handle(
          jsonBodyRequest(CREATE_URL, {
            schemaText: NUMBER_ARRAY_SCHEMA_TEXT,
            root: { v: [1, 2, 3] },
          }),
        ),
      );
      expect(ok.status).toBe(201);
    });
    const over = matchedResponse(
      await hubRouter(createPoisonRegistry(), limits).handle(
        jsonBodyRequest(CREATE_URL, {
          schemaText: NUMBER_ARRAY_SCHEMA_TEXT,
          root: { v: Array.from({ length: 40 }, (_, index) => index) },
        }),
      ),
    );
    await observeProblem(over, 413);
  });

  it('AC2: maxIssues 覆盖——恰保留 2 条并标记截断', async () => {
    const limits: RestRouterLimits = { maxIssues: 2 };
    await withRealRegistry(async (registry) => {
      const response = matchedResponse(
        await hubRouter(registry, limits).handle(
          jsonBodyRequest(CREATE_URL, { schemaText: manyFieldsSchemaText(3, 1), root: {} }),
        ),
      );
      const observation = await observeProblem(response, 422);
      expect((observation.body.issues ?? []).length).toBe(2);
      expect(observation.body.issuesTruncated).toBe(true);
    });
  });

  it('AC2: maxIssueMessageBytes 覆盖——每条 message ≤ 16 bytes 且非空', async () => {
    const limits: RestRouterLimits = { maxIssueMessageBytes: 16 };
    await withRealRegistry(async (registry) => {
      const response = matchedResponse(
        await hubRouter(registry, limits).handle(
          jsonBodyRequest(CREATE_URL, { schemaText: TWO_FIELD_SCHEMA_TEXT, root: {} }),
        ),
      );
      const observation = await observeProblem(response, 422, 16);
      const issues = observation.body.issues ?? [];
      expect(issues.length).toBeGreaterThan(0);
      for (const issue of issues) {
        expect(issue.message.length).toBeGreaterThan(0);
        expect(messageBytes(issue)).toBeLessThanOrEqual(16);
      }
    });
  });

  it('AC2: maxIssuesTotalBytes 覆盖——总预算 64 bytes 时截断且总 byte 不越界', async () => {
    const limits: RestRouterLimits = { maxIssuesTotalBytes: 64 };
    await withRealRegistry(async (registry) => {
      const response = matchedResponse(
        await hubRouter(registry, limits).handle(
          jsonBodyRequest(CREATE_URL, { schemaText: manyFieldsSchemaText(20, 1), root: {} }),
        ),
      );
      const observation = await observeProblem(response, 422);
      const issues = observation.body.issues ?? [];
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.length).toBeLessThan(20);
      const total = issues.reduce((sum, issue) => sum + messageBytes(issue), 0);
      expect(total).toBeLessThanOrEqual(64);
      expect(observation.body.issuesTruncated).toBe(true);
    });
  });

  it('AC2: Partial 覆盖不重置其它默认值（depth 默认仍在生效）', async () => {
    const limits: RestRouterLimits = { maxBodyBytes: 4096, maxSchemaTextBytes: 1024 };
    const over = matchedResponse(
      await hubRouter(createPoisonRegistry(), limits).handle(
        rawJsonRequest(CREATE_URL, deepNestedRootRawBody(100, '0')),
      ),
    );
    await observeProblem(over, 413);
  });

  it('AC2: 无 Content-Length 的流式 body 仍执行 byte 上限 → 413', async () => {
    const limits: RestRouterLimits = { maxBodyBytes: 64, maxSchemaTextBytes: 16 };
    const request = streamedJsonRequest(CREATE_URL, [new Uint8Array(200).fill(120)]);
    expect(request.headers.get('content-length')).toBeNull();
    const response = matchedResponse(await hubRouter(createPoisonRegistry(), limits).handle(request));
    await observeProblem(response, 413);
  });
});
