/**
 * SA6 验收契约（Feature 红灯固化）— issue #268：固定 problem shape、稳定 code 分支面
 * 与 issues 受控安全（含截断标记）。
 *
 * 契约来源（逐条对应见 SA6 报告 §12.2）：
 * - 任务简报 AC4（错误 response 为固定 problem shape；issues 受控安全、不泄露 schema/root
 *   片段；截断携带 `issuesTruncated: true`）与 AC1（400/403/405/413/415/422 状态映射）；
 * - ADR 0015 §错误契约 L163–165（客户端只按稳定 `code` 分支；固定 problem shape；
 *   validation issues → 受控、可 JSON 序列化 REST issue：稳定 code、可选 line/column 或
 *   `(string | number)[]` path、有 UTF-8 byte 上限的安全 message；数量或总 byte 预算截断时
 *   显式 `issuesTruncated: true`）、L41（403 `INSTANCE_ROLE_FORBIDDEN` 冻结）、L68
 *   （405 + `Allow: POST`）。
 *
 * 契约假设（PROPOSAL，待 SA1/SA2 仲裁）：H5（problem 键集 = 必选 `code`/`message` +
 * 可选 `issues`/`issuesTruncated`，未知键不允许）、H6（14 类失败各自给出互异稳定 code）、
 * H7（REST issue 形状）；405 的 `METHOD_NOT_ALLOWED` 取自 #267 已在树行为，属「不收紧也
 * 不放松」的既有 code。若设计另有裁决须回写本文件并走修订轮。
 *
 * 状态（iteration 0）：HEAD `0b06050` 无 4xx/422 Response（延后项以 rejection 结算），
 * 403/405 仅有最小 `{code}` body——本文件的形状/稳定性/可分性断言整组红灯。
 */
import { describe, expect, it } from 'vitest';
import {
  CREATE_URL,
  ROOT_VALUE,
  SCHEMA_TEXT,
  createPoisonRegistry,
  matchedResponse,
  methodRequest,
} from './rest-contract-harness.js';
import {
  FAILURE_SCENARIOS,
  buildFailureScenario,
  collectStringLeaves,
  hubRouter,
  jsonBodyRequest,
  observeProblem,
  peerRouter,
  type FailureScenarioKey,
  type ProblemObservation,
} from './rest-validation-harness.js';

const ISSUE_MESSAGE_DEFAULT_LIMIT = 1024;

async function observeScenario(key: FailureScenarioKey): Promise<ProblemObservation> {
  const expected = FAILURE_SCENARIOS.find((scenario) => scenario.key === key);
  if (expected === undefined) throw new Error(`契约 fixture 缺 scenario ${key}`);
  const env = await buildFailureScenario(key);
  try {
    const response = matchedResponse(await env.router.handle(env.request));
    return await observeProblem(response, expected.expectedStatus, ISSUE_MESSAGE_DEFAULT_LIMIT);
  } finally {
    await env.teardown();
  }
}

describe('issue #268 problem shape 契约（AC4，ADR 0015 L163–165）', () => {
  it('AC1/AC4: 14 类失败全部返回固定 problem shape（键集/类型/code 模式校验）', async () => {
    for (const scenario of FAILURE_SCENARIOS) {
      const observation = await observeScenario(scenario.key);
      expect(observation.status).toBe(scenario.expectedStatus);
      // observeProblem 已校验：JSON object、键集 ⊆ {code,message,issues,issuesTruncated}、
      // code 命中 UPPER_SNAKE、message 非空、issues/issue 形状受控、message ≤ 1024 bytes。
      expect(observation.body.code).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(observation.body.message.length).toBeGreaterThan(0);
    }
  });

  it('AC4: 同一失败类别的 code 稳定（两次独立运行一致）', async () => {
    for (const scenario of FAILURE_SCENARIOS) {
      const first = await observeScenario(scenario.key);
      const second = await observeScenario(scenario.key);
      expect(second.body.code, `scenario=${scenario.key} 的 code 必须稳定`).toBe(first.body.code);
    }
  });

  it('AC4: code 与失败类别一一对应（客户端只按 code 分支）', async () => {
    const codes = new Map<string, FailureScenarioKey>();
    for (const scenario of FAILURE_SCENARIOS) {
      const observation = await observeScenario(scenario.key);
      const existing = codes.get(observation.body.code);
      expect(
        existing,
        `code ${observation.body.code} 同时代表 ${String(existing)} 与 ${scenario.key}（客户端无法分支）`,
      ).toBeUndefined();
      codes.set(observation.body.code, scenario.key);
    }
    expect(codes.size).toBe(FAILURE_SCENARIOS.length);
  });

  it('AC4: 非截断的 422 不携带 issuesTruncated=true', async () => {
    const observation = await observeScenario('root-invalid');
    expect((observation.body.issues ?? []).length).toBeGreaterThan(0);
    expect(observation.body.issuesTruncated).not.toBe(true);
  });

  it('AC4: 422 issues 受控安全（稳定 code、定位形状、message byte 上限、无源码片段）', async () => {
    for (const key of ['schema-invalid', 'root-invalid'] as const) {
      const observation = await observeScenario(key);
      const issues = observation.body.issues ?? [];
      expect(issues.length, `${key} 必须有 issues`).toBeGreaterThan(0);
      for (const issue of issues) {
        expect(issue.code).toMatch(/^[A-Z][A-Z0-9_]*$/);
        expect(issue.message.length).toBeGreaterThan(0);
        if (issue.line !== undefined) {
          expect(Number.isInteger(issue.line) && issue.line >= 1).toBe(true);
          expect(Number.isInteger(issue.column) && (issue.column as number) >= 1).toBe(true);
        }
        if (issue.path !== undefined) {
          expect(Array.isArray(issue.path)).toBe(true);
        }
      }
      // 受控但有用：至少一条 issue 保留定位（line/column 或 path），而不是全部压平成裸 message。
      expect(issues.some((issue) => issue.line !== undefined || issue.path !== undefined)).toBe(true);
    }
  });

  it('AC4: 403 与 405 也使用同一 problem shape（冻结/既有 code 保持）', async () => {
    const forbidden = matchedResponse(
      await peerRouter(createPoisonRegistry()).handle(
        jsonBodyRequest(CREATE_URL, { schemaText: SCHEMA_TEXT, root: ROOT_VALUE }),
      ),
    );
    const forbiddenObservation = await observeProblem(forbidden, 403);
    expect(forbiddenObservation.body.code).toBe('INSTANCE_ROLE_FORBIDDEN');

    for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) {
      const notAllowed = matchedResponse(
        await hubRouter(createPoisonRegistry()).handle(methodRequest(method, CREATE_URL)),
      );
      expect(notAllowed.headers.get('allow')).toBe('POST');
      const observation = await observeProblem(notAllowed, 405);
      expect(observation.body.code).toBe('METHOD_NOT_ALLOWED');
    }
  });

  it('AC4: 400/413/415/422 的失败链在触达 Registry 之前结算（poison registry 未被调用）', async () => {
    // buildFailureScenario 对 root-invalid 之外的 13 类一律注入 poison registry：
    // 任一 Registry 成员被调用都会 throw，因此「拿到 problem Response」本身即零触达证据。
    for (const scenario of FAILURE_SCENARIOS) {
      if (scenario.key === 'root-invalid') continue;
      const observation = await observeScenario(scenario.key);
      expect(observation.body.code.length).toBeGreaterThan(0);
    }
  });

  it('AC4: 错误 response 中所有 string 叶子不含源码位置标记（malformed 语义不泄漏）', async () => {
    const observation = await observeScenario('malformed-json');
    for (const leaf of collectStringLeaves(observation.body)) {
      expect(leaf).not.toMatch(/\b(position|offset)\b/i);
      expect(leaf).not.toMatch(/\bline\s*\d+\b|\bcolumn\s*\d+\b/i);
    }
  });
});
