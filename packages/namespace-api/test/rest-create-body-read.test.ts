/**
 * SA3 body 读取阶段行为套件 — issue #268（D6 `Request.signal` + D12 严格 UTF-8 解码）。
 *
 * 覆盖缺口依据：SA6 契约报告 §12.2/§15 明示「严格 UTF-8 解码由实现路径承担」且
 * **不断言** `Request.signal`——冻结套件（#268 五文件 + #267 五文件）零改动，本文件以
 * **新增**测试固化这两类行为（SA2-268-F2 / M-2 修订）：
 *
 * ① 有界读取期间 abort → `handle` 以普通 `Error` rejection 结算（固定 message + cause
 *    `signal.reason`）、无 Response、poison registry 零成员调用；
 * ② Registry 接纳后 abort 不传播取消：create settle、`lease.release()` 恰一次、仍 201；
 * ③ 流式非法 UTF-8 bytes → 400 `INVALID_BODY_ENCODING` + problem shape + 零 Registry 触达
 *    （两组字节序列：孤立非法字节与截断三字节序列）；
 * ④ `INVALID_BODY_ENCODING` 与 `MALFORMED_JSON` code 可分（实现把两类合并即转红）。
 *
 * 断言全部观察运行时行为（HTTP 状态/形状/值、promise 结算、Registry 公共 seam 观测），
 * 无源码字符串断言、无 sleep/轮询、无 skip/only/env override；未修改冻结契约文件。
 */
import { describe, expect, it } from 'vitest';
import {
  CREATE_URL,
  NAMESPACE_ID_PATTERN,
  ROOT_VALUE,
  SCHEMA_TEXT,
  createObservingRegistry,
  createPoisonRegistry,
  matchedResponse,
} from './rest-contract-harness.js';
import {
  buildFailureScenario,
  hubRouter,
  observeProblem,
  streamedJsonRequest,
  withRealRegistry,
} from './rest-validation-harness.js';

/** abort 结算的固定 rejection message（设计 D6；不产生任何 Response）。 */
const ABORTED_BODY_READ_MESSAGE = 'REST create aborted during body read';

/** 流式请求：无 Content-Length，仅 enqueue 首批 bytes 并保持打开，供中途 abort。 */
function openStreamedRequest(url: string, firstChunk: Uint8Array, signal: AbortSignal): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(firstChunk);
      // 有意不 close：读取在首批 bytes 之后挂起，直到 abort 触发 cancel。
    },
  });
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: stream,
    duplex: 'half',
    signal,
  } as RequestInit & { duplex: 'half' });
}

/**
 * 可控 release gate：`createObservingRegistry` 的 `releaseGate` 被 `await` 时同步
 * 通知「release 已进入」，并把续体捕获到 `open()`——场景②因此无需 sleep/轮询即可
 * 确定性地在「Registry 已接纳、release 挂起」窗口内 abort。
 */
function createControllableReleaseGate(): {
  readonly gate: Promise<void>;
  readonly releaseEntered: Promise<void>;
  open(): void;
} {
  let releaseContinuation: (() => void) | undefined;
  let notifyEntered: (() => void) | undefined;
  const releaseEntered = new Promise<void>((resolve) => {
    notifyEntered = resolve;
  });
  const gate = {
    then(onFulfilled: () => void): void {
      notifyEntered?.();
      releaseContinuation = onFulfilled;
    },
  } as unknown as Promise<void>;
  return {
    gate,
    releaseEntered,
    open: () => {
      releaseContinuation?.();
    },
  };
}

describe('issue #268 body 读取阶段契约（D6 signal / D12 严格 UTF-8）', () => {
  it('D6: abort（读取期间 / 读前已 aborted）→ rejection（固定 message + cause）、无 Response、零 Registry 触达', async () => {
    // (a) 读取期间 abort：流式 body 挂起时取消。
    const abortController = new AbortController();
    const abortReason = new Error('client disconnected');
    const router = hubRouter(createPoisonRegistry());
    const request = openStreamedRequest(
      CREATE_URL,
      new TextEncoder().encode('{"schemaText":'),
      abortController.signal,
    );
    const handling = router.handle(request);
    const rejection = expect(handling).rejects.toThrow(ABORTED_BODY_READ_MESSAGE);
    abortController.abort(abortReason);
    await rejection;
    await expect(handling).rejects.toHaveProperty('cause', abortReason);

    // (b) step 4 起始前 signal 已 aborted：立即 rejection，不建立读取。
    const preAbortedController = new AbortController();
    const preAbortReason = new Error('client gone before read');
    preAbortedController.abort(preAbortReason);
    const preAbortedRequest = openStreamedRequest(
      CREATE_URL,
      new TextEncoder().encode('{"schemaText":'),
      preAbortedController.signal,
    );
    const preAbortedHandling = hubRouter(createPoisonRegistry()).handle(preAbortedRequest);
    await expect(preAbortedHandling).rejects.toThrow(ABORTED_BODY_READ_MESSAGE);
    await expect(preAbortedHandling).rejects.toHaveProperty('cause', preAbortReason);
  });

  it('D6: Registry 接纳后 abort 不传播取消——create settle、release 恰一次、仍 201', async () => {
    await withRealRegistry(async (registry) => {
      const controllable = createControllableReleaseGate();
      const { registry: observing, observation } = createObservingRegistry(registry, {
        releaseGate: controllable.gate,
      });
      const abortController = new AbortController();
      const request = new Request(CREATE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schemaText: SCHEMA_TEXT, root: ROOT_VALUE }),
        signal: abortController.signal,
      });
      const handling = hubRouter(observing).handle(request);
      // release 已进入（gate 挂起）⇒ Registry 已接纳 create、body 读取已完成。
      await controllable.releaseEntered;
      abortController.abort(new Error('client disconnected'));
      expect(abortController.signal.aborted).toBe(true);
      controllable.open();
      const response = matchedResponse(await handling);
      expect(response.status).toBe(201);
      expect(observation.createInputs).toHaveLength(1);
      expect(observation.releaseCalls).toBe(1);
      const body = (await response.json()) as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(['namespaceId', 'schema']);
      expect(body['namespaceId']).toMatch(NAMESPACE_ID_PATTERN);
    });
  });

  it('D12: 流式非法 UTF-8 bytes → 400 INVALID_BODY_ENCODING + problem shape + 零 Registry 触达', async () => {
    const invalidUtf8Streams: readonly (readonly number[])[] = [
      [0x22, 0xff, 0x22], // 孤立非法字节
      [0x7b, 0x22, 0x73, 0x22, 0x3a, 0x20, 0xe2, 0x82], // 截断的三字节序列
    ];
    for (const bytes of invalidUtf8Streams) {
      const router = hubRouter(createPoisonRegistry());
      const request = streamedJsonRequest(CREATE_URL, [Uint8Array.from(bytes)]);
      const response = matchedResponse(await router.handle(request));
      const observation = await observeProblem(response, 400);
      expect(observation.body.code, `bytes=${bytes.join(',')}`).toBe('INVALID_BODY_ENCODING');
      expect(observation.body.issuesTruncated).not.toBe(true);
    }
  });

  it('D12: INVALID_BODY_ENCODING 与 MALFORMED_JSON 可分（同一 router 上 code 互异）', async () => {
    const router = hubRouter(createPoisonRegistry());
    const encodingResponse = matchedResponse(
      await router.handle(streamedJsonRequest(CREATE_URL, [Uint8Array.from([0x22, 0xff, 0x22])])),
    );
    const encodingProblem = await observeProblem(encodingResponse, 400);
    expect(encodingProblem.body.code).toBe('INVALID_BODY_ENCODING');
    // 复用冻结 harness 的 malformed-json 输入字节（合法 UTF-8、非法 JSON）。
    const malformedEnvironment = await buildFailureScenario('malformed-json');
    try {
      const malformedResponse = matchedResponse(await router.handle(malformedEnvironment.request));
      const malformedProblem = await observeProblem(malformedResponse, 400);
      expect(malformedProblem.body.code).toBe('MALFORMED_JSON');
      expect(encodingProblem.body.code).not.toBe(malformedProblem.body.code);
    } finally {
      await malformedEnvironment.teardown();
    }
  });
});
