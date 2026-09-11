/**
 * SA6 契约共享 fixture/harness —— issue #270（Server 集成验收：REST 与 WebSocket 共享
 * Registry + 有序停止）。本文件不是 `*.test.ts`，不被 vitest 收集；只承载契约测试共享的
 * fixture 与观测探针。
 *
 * 纪律（与 apps/yjs-server/test/harness.ts 同源）：
 * - 真实 `createNomicoreApp` 组合根 + 真实 TCP/HTTP + 真实 WebSocket + 真实
 *   Memory/FilePersistence；零 mock 被测对象，零源码字符串断言；
 * - 唯一「观测包装」面是 ADR 0015 §测试决策指定的 `NamespaceRegistry` 公共接口
 *   （`appRegistry()` 读取组合根暴露的同一 Registry 引用；`open/readData` 读回事实）；
 * - 零 real sleep 条件等待：全部经有界轮询（`waitUntil`，10ms 步进）。
 *
 * 契约假设（PROPOSAL，待 SA1/SA2 仲裁；见 wiki/raw/task_issue-270_sa6_contract.md §12）：
 * - H1：hub 组合根的 HTTP listener 默认承载 REST route family（`/v1/owners/{owner}/namespaces`）
 *   与 WebSocket route family（`/replication`）的 raw-path 分流；无需新增必填配置键。
 * - H2：`NomicoreApp` 公开组合后的唯一 Registry 引用（`readonly registry: NamespaceRegistry`，
 *   `ready` 之后可用）——AC1「证明 REST 与 WebSocket Module 持有同一个引用」的最小观测面。
 * - H3：停止顺序 = 停止 intake（listener 关闭）→ 等待已接纳 REST/WS 工作 settle →
 *   释放 Lease/Session → `registry.shutdown()` → persistence dispose；已接纳 REST 工作在
 *   `registry-stopped` 之前完成并从持久化中可恢复。
 */
import * as http from 'node:http';
import { createMemoryPersistence } from '@nomicore/persistence';
import { createTestScheduler } from '@nomicore/persistence/testing';
import {
  createNamespaceRegistryForTesting,
  createRegistryTestScheduler,
} from '@nomicore/namespace-registry/testing';
import type { NamespaceLease, NamespaceRegistry } from '@nomicore/namespace-registry';
import type { ReplicationMessage } from '@nomicore/replication-protocol';
import { createNomicoreApp, type NomicoreApp } from '../src/index.js';
import type { EventSink } from '../src/lifecycle.js';

// ═══════════════════════════ 固定常量 ═══════════════════════════

export const HUB_INSTANCE = 'hub-270';
export const PEER_INSTANCE = 'peer-270';
export const HUB_TOKEN = 'token-270';

export const HUB_OWNER = 'hub-owner-270';
export const REST_OWNER = 'rest-owner-270';

export const NAMESPACE_ID_PATTERN = /^ns-[0-9a-f]{32}$/;

/** 契约 SCHEMA：`n?` 为可选字段（REST create 与 WS 复制两侧共用同一 envelope）。 */
export const SCHEMA_TEXT = 'type ROOT = { title: string; n?: number; };\n';
export const SCHEMA_ENVELOPE = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'issue270-contract',
  text: SCHEMA_TEXT,
});
export const ROOT_VALUE = Object.freeze({ title: 'hello-270' });

/** ADR 0015 REST create 端点（raw path，无尾随斜杠）。 */
export const CREATE_PATH = `/v1/owners/${REST_OWNER}/namespaces`;
/** 协议/组合根冻结 Upgrade 路径。 */
export const UPGRADE_PATH = '/replication';

/** AC1 观测面缺口的可读红灯消息（capability gap anchor）。 */
export const REGISTRY_SEAM_GAP =
  '能力缺口（issue #270 AC1）：组合根 `NomicoreApp` 未暴露共享的 Registry 观测面 ' +
  '（`readonly registry: NamespaceRegistry`，ready 后可用）——集成测试无法证明 REST 与 ' +
  'WebSocket Module 持有同一个 NamespaceRegistry 引用。';

// ═══════════════════════════ 事件 sink 记录器 ═══════════════════════════

export interface RecordingSink {
  readonly events: Array<Record<string, unknown>>;
  readonly emit: EventSink;
  /** 首个匹配 `event` 的事件下标；未出现 → -1。 */
  indexOf(event: string): number;
  countOf(event: string): number;
  names(): string[];
}

export function createRecordingSink(): RecordingSink {
  const events: Array<Record<string, unknown>> = [];
  return {
    events,
    emit: (event) => {
      events.push({ ...event });
    },
    indexOf: (event) => events.findIndex((e) => e.event === event),
    countOf: (event) => events.filter((e) => e.event === event).length,
    names: () => events.map((e) => String(e.event)),
  };
}

// ═══════════════════════════ 组合根启动器 ═══════════════════════════

export interface HubHarness {
  readonly app: NomicoreApp;
  readonly sink: RecordingSink;
  readonly port: number;
  /** `provision` 条目创建出的 namespaceId（未启用 provision → undefined）。 */
  readonly provisionedNamespaceId: string | undefined;
  stop(): Promise<void>;
}

export interface HubHarnessOptions {
  /** file persistence rootDir；缺省 = memory。 */
  readonly fileRootDir?: string;
  readonly provision?: boolean;
  readonly authorization?: boolean;
  readonly diagnosticsRootDir?: string;
  readonly schedule?: Readonly<{ debounceMs: number; maxDirtyMs: number }>;
}

/** 启动 hub 组合根并等待 `listening`（真实端口），最后一项事件为 `ready`。 */
export async function startHubApp(options: HubHarnessOptions = {}): Promise<HubHarness> {
  const sink = createRecordingSink();
  const hub: Record<string, unknown> = {
    listen: { host: '127.0.0.1', port: 0 },
    tokens: { [PEER_INSTANCE]: HUB_TOKEN },
  };
  if (options.provision === true) {
    hub.provision = [{ id: 'p1', ownerUserId: HUB_OWNER, schema: SCHEMA_ENVELOPE, root: { title: 'hub-root' } }];
  }
  if (options.authorization === true) {
    hub.authorization = [
      { peerInstanceId: PEER_INSTANCE, provisionId: 'p1', read: true, submit: true },
    ];
  }
  const app = createNomicoreApp(
    {
      role: 'hub',
      instanceId: HUB_INSTANCE,
      persistence:
        options.fileRootDir === undefined
          ? { kind: 'memory' }
          : {
              kind: 'file',
              rootDir: options.fileRootDir,
              schedule: options.schedule ?? { debounceMs: 10, maxDirtyMs: 20 },
            },
      ...(options.diagnosticsRootDir === undefined
        ? {}
        : { diagnostics: { enabled: true, rootDir: options.diagnosticsRootDir } }),
      hub,
    },
    { emitter: sink.emit },
  );
  try {
    await app.ready;
    await waitForEvent(sink, 'listening', 20_000);
    await waitForEvent(sink, 'ready', 20_000);
  } catch (error) {
    await app.stop().catch(() => undefined);
    throw error;
  }
  const listening = sink.events.find((e) => e.event === 'listening') as { port: number };
  const provisioned = sink.events.find((e) => e.event === 'provisioned') as
    | { namespaceId: string }
    | undefined;
  return {
    app,
    sink,
    port: listening.port,
    provisionedNamespaceId: provisioned?.namespaceId,
    stop: () => app.stop(),
  };
}

export interface PeerHarness {
  readonly app: NomicoreApp;
  readonly sink: RecordingSink;
  stop(): Promise<void>;
}

/** 启动 peer 组合根（进程内），连接给定 hub 端口并按 target 复制。 */
export async function startPeerApp(options: {
  readonly port: number;
  readonly targetNamespaceId?: string;
  readonly ownerUserId?: string;
}): Promise<PeerHarness> {
  const sink = createRecordingSink();
  const app = createNomicoreApp(
    {
      role: 'peer',
      instanceId: PEER_INSTANCE,
      persistence: { kind: 'memory' },
      peer: {
        hub: {
          url: `ws://127.0.0.1:${options.port}${UPGRADE_PATH}`,
          hubInstanceId: HUB_INSTANCE,
          token: HUB_TOKEN,
        },
        ...(options.targetNamespaceId === undefined
          ? {}
          : {
              targets: [
                {
                  namespaceId: options.targetNamespaceId,
                  ownerUserId: options.ownerUserId ?? HUB_OWNER,
                },
              ],
            }),
      },
    },
    { emitter: sink.emit },
  );
  try {
    await app.ready;
    await waitForEvent(sink, 'ready', 20_000);
  } catch (error) {
    await app.stop().catch(() => undefined);
    throw error;
  }
  return { app, sink, stop: () => app.stop() };
}

// ═══════════════════════════ AC1 Registry 观测面 ═══════════════════════════

/**
 * 组合根共享 Registry 引用观测面（H2）。当前实现尚未暴露 → undefined（红灯能力缺口）；
 * 目标实现按 H2 在 `NomicoreApp` 上公开 `readonly registry: NamespaceRegistry`。
 * 以结构窄化读取，避免在实现落地前制造 typecheck 噪声。
 */
export function appRegistry(app: NomicoreApp): NamespaceRegistry | undefined {
  return (app as unknown as { readonly registry?: NamespaceRegistry }).registry;
}

/** 轮询等待 lease runtime 进入 ready 且 read 可用（app.ts waitLeaseReadable 同款判据，公共面）。 */
export async function waitLeaseReady(lease: NamespaceLease, timeoutMs = 10_000): Promise<void> {
  await waitUntil(
    'lease runtime ready',
    () => {
      const status = lease.getStatus();
      return (
        status.lease === 'active' &&
        status.runtime.lifecycle === 'ready' &&
        status.runtime.read.enabled
      );
    },
    timeoutMs,
  );
}

/** 经 Registry 公共面 open 并读回 path 值；返回结果值（读取失败即抛出）。 */
export async function openAndReadValue(
  registry: NamespaceRegistry,
  ownerUserId: string,
  namespaceId: string,
  path: readonly (string | number)[],
): Promise<unknown> {
  const opened = await registry.open({ userId: ownerUserId }, namespaceId);
  if (!opened.ok) {
    throw new Error(
      `契约违例：Registry.open(${ownerUserId}, ${namespaceId}) 应成功，实际 ${JSON.stringify(opened)}`,
    );
  }
  const lease = opened.lease;
  try {
    await waitLeaseReady(lease);
    const read = lease.readData(path);
    if (!read.ok) {
      throw new Error(`契约违例：readData(${JSON.stringify(path)}) 失败：${JSON.stringify(read)}`);
    }
    return read.value;
  } finally {
    await lease.release();
  }
}

export interface IndependentRegistryFixture {
  readonly registry: NamespaceRegistry;
  shutdown(): Promise<void>;
}

/**
 * 独立第二 Registry（自有 MemoryPersistence + 受控 clock/scheduler/randomBytes）：
 * AC1 敏感度负控——第一 Registry 创建的 namespace 在第二 Registry 上必须
 * `NAMESPACE_NOT_FOUND`（证明「同一引用」断言非恒真）。
 */
export function makeIndependentRegistry(): IndependentRegistryFixture {
  let counter = 0;
  const registry = createNamespaceRegistryForTesting(
    createMemoryPersistence({ scheduler: createTestScheduler() }),
    {
      clock: { now: () => 1_700_000_000_000 },
      scheduler: createRegistryTestScheduler(),
      idleTimeoutMs: 1_000_000,
      role: 'hub',
      randomBytes: (length: number): Uint8Array => {
        counter += 1;
        const hex = counter.toString(16).padStart(32, '0');
        const out = new Uint8Array(length);
        for (let i = 0; i < length; i += 1) {
          out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        }
        return out;
      },
    },
  );
  return { registry, shutdown: () => registry.shutdown() };
}

// ═══════════════════════════ HTTP 客户端（真实 TCP） ═══════════════════════════

export interface HttpResponse {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
  /** 传输层失败（连接拒绝/重置等）时的错误串；正常 HTTP 结算 → undefined。 */
  readonly transportError: string | undefined;
}

function collectResponse(response: http.IncomingMessage): Promise<HttpResponse> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    response.on('data', (chunk: Buffer) => chunks.push(chunk));
    response.on('end', () =>
      resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        transportError: undefined,
      }),
    );
  });
}

export function httpRequest(
  port: number,
  method: string,
  path: string,
  options: Readonly<{ body?: string; headers?: Record<string, string> }> = {},
): Promise<HttpResponse> {
  return new Promise((resolve) => {
    const headers: Record<string, string> = { ...options.headers };
    if (options.body !== undefined) {
      headers['content-type'] = headers['content-type'] ?? 'application/json';
      headers['content-length'] = String(Buffer.byteLength(options.body));
    }
    // agent:false = 每条请求独立 TCP 连接（避免 Node ≥19 全局 keep-alive 连接复用，
    // 使 intake 停止语义在 listener 层可判定）。
    const req = http.request({ host: '127.0.0.1', port, method, path, headers, agent: false }, (res) => {
      void collectResponse(res).then(resolve);
    });
    req.on('error', (error: Error) => {
      resolve({ status: 0, headers: {}, body: '', transportError: `Error: ${error.message}` });
    });
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

export interface AdmittedRequest {
  /** 100-continue 已到达：server 已解析并接纳该请求（在调用 stop() 之前已 admitted）。 */
  readonly admitted: true;
  /** 发送请求体并等待最终 Response（request head 先于 stop() 到达，admission 已锚定）。 */
  sendBody(): Promise<HttpResponse>;
}

/**
 * 以 `Expect: 100-continue` 建立「已被 server 接纳、等待 body」的 REST create 请求：
 * 收到 100 Continue ⇒ server 已解析请求头并接纳该请求（此后 stop() 不得把它当作
 * 未接纳工作丢弃）；body 由调用方在 stop() 发起之后再发送。
 */
export function openAdmittedRequest(
  port: number,
  path: string,
  body: string,
  timeoutMs = 10_000,
): Promise<AdmittedRequest> {
  return new Promise<AdmittedRequest>((resolve, reject) => {
    let settled = false;
    let settleResponse: ((response: HttpResponse) => void) | undefined;
    const responsePromise = new Promise<HttpResponse>((resolveResponse) => {
      settleResponse = resolveResponse;
    });
    let req: http.ClientRequest;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      req.destroy();
      reject(new Error(`契约违例：${timeoutMs}ms 内未收到 server 的 100 Continue（请求头未被接纳）`));
    }, timeoutMs);
    req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path,
        agent: false,
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body)),
          expect: '100-continue',
        },
      },
      (res) => {
        void collectResponse(res).then((response) => settleResponse?.(response));
      },
    );
    req.on('continue', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        admitted: true,
        sendBody: () => {
          req.end(body);
          return responsePromise;
        },
      });
    });
    req.on('error', (error: Error) => {
      if (settled) {
        settleResponse?.({
          status: 0,
          headers: {},
          body: '',
          transportError: `Error: ${error.message}`,
        });
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(new Error(`契约违例：admitted 请求建立失败（${error.message}）`));
    });
  });
}

// ═══════════════════════════ WS 协议消息 ═══════════════════════════

export function helloMessage(): ReplicationMessage {
  return {
    kind: 'HELLO',
    peerInstanceId: PEER_INSTANCE,
    expectedHubInstanceId: HUB_INSTANCE,
    protocolVersions: [1],
    requiredCapabilities: 0,
    optionalCapabilities: 0,
    connectionNonce: new Uint8Array(16).fill(7),
  };
}

export function openNamespaceMessage(namespaceId: string): ReplicationMessage {
  return { kind: 'OPEN_NAMESPACE', namespaceId, hasLocalReplica: false };
}

// ═══════════════════════════ 有界轮询 ═══════════════════════════

export async function waitUntil(
  what: string,
  predicate: () => boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() > deadline) {
      throw new Error(`waitUntil 超时（${timeoutMs}ms）：${what}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

/** 等待 sink 中出现指定事件（真实运行时事件面，非源码断言）。 */
export async function waitForEvent(
  sink: RecordingSink,
  event: string,
  timeoutMs = 20_000,
): Promise<void> {
  await waitUntil(`sink 事件 ${event}`, () => sink.indexOf(event) >= 0, timeoutMs);
}
