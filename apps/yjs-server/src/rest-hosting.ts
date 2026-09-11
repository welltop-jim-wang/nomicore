/**
 * `createRestHosting` —— 组合根 plain-HTTP 分流与已接纳 REST 工作记账（issue #270，ADR 0015 L32）。
 *
 * 归属：REST router（`@nomicore/namespace-api`）不拥有 listener/认证/drain；本模块是
 * server 侧的**唯一** bridge 与生命周期记账点（app-owned adapter 层，不改任何包契约）：
 *
 *  - `handle`：plain HTTP 总入口——intake 门（停机期 503，不进入任何 route family）→
 *    REST family 优先（标准 Web `Request→Response`，body 以流透传、适配层不预读）→
 *    `matched:false` 回落到 listener 自有路由（`GET /healthz` 200 / 其余 404，与
 *    `transport/ws-server.ts` 缺省路径逐字节一致，含 query-string 的精确等值语义）。
 *    rejection（router 未映射结局）以诚实结局收口：`onRejection` 观测 + `500 text/plain`
 *    占位（FR-3 错误契约票以加法替换；绝不静默回落 404）。
 *  - `drain`：有界排空——等待**已接纳**（`handle` 入口已登记 in-flight）请求结算；
 *    预算尽则逐个 abort（销毁请求 socket，使挂起 body 读取以流错误结算、客户端得到
 *    传输层失败——诚实失败，不无限等待）后即返回。幂等（二次调用 no-op）。
 *
 * 记账纪律：in-flight 登记发生在 `handle` 首次同步段（Node request 事件同步派发 ⇒ 要么
 * 已登记、要么被 intake 门 503，无中间态）；响应写回完成（或写回失败静默收口）时注销。
 * 观测回调 throw 被隔离（与 `ws-server.ts` `notifyAdapter` 同纪律）：观测不改变请求结局。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { RestHandledResult, RestRouter } from '@nomicore/namespace-api';

export interface RestHostingOptions {
  readonly restRouter: RestRouter;
  /** 停机门：true 时新普通请求 503（intake 已停，请求未被接纳）。 */
  readonly isStopping: () => boolean;
  /** `restRouter.handle` rejection 的观测回调（app 注入 sink 事件；回调 throw 被隔离）。 */
  readonly onRejection: (error: unknown) => void;
}

export interface RestHosting {
  /** plain HTTP 总入口：intake 门 → REST family 优先 → /healthz → 404；内含 in-flight 记账。 */
  handle(req: IncomingMessage, res: ServerResponse): void;
  /** 有界排空：等已接纳请求结算；预算尽则 abort（销毁 socket）后返回。幂等。 */
  drain(budgetMs: number): Promise<void>;
}

/** 无 body 语义方法：Fetch `Request` 构造禁止 body，其余方法以流透传（router 单点读 body）。 */
const BODYLESS_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

const TEXT_CONTENT_TYPE = 'text/plain';

/** 每请求记账项：结算信号（只 resolve，永不 reject——迟到结算天然 no-op）+ socket abort。 */
interface InFlightEntry {
  readonly settled: Promise<void>;
  settle(): void;
  abort(): void;
}

export function createRestHosting(options: RestHostingOptions): RestHosting {
  const { restRouter, isStopping, onRejection } = options;
  const inFlight = new Set<InFlightEntry>();
  let drainPromise: Promise<void> | undefined;

  /** plain 响应写回：socket 已亡（客户端断连/停机 abort）→ 静默收口（观测已在 rejection 面）。 */
  function writePlain(res: ServerResponse, status: number, body: string): void {
    try {
      res.writeHead(status, { 'content-type': TEXT_CONTENT_TYPE });
      res.end(body);
    } catch {
      // 写回失败不改变请求结局；in-flight 由 handle 的 finally 注销。
    }
  }

  /** 观测隔离：onRejection throw 不外抛、不影响请求结局（与 ws-server notifyAdapter 同纪律）。 */
  function notifyRejection(error: unknown): void {
    try {
      onRejection(error);
    } catch {
      // 观测不改变业务结果。
    }
  }

  /** node `IncomingMessage` → 标准 Web `Request`（transport 边界单跳；body 不预读）。 */
  function toWebRequest(req: IncomingMessage): Request {
    const method = req.method ?? 'GET';
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) headers.append(name, item);
      } else {
        headers.append(name, value);
      }
    }
    // router 只消费 pathname；authority 不参与路由（raw path 分流）。
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (BODYLESS_METHODS.has(method)) {
      return new Request(url, { method, headers });
    }
    return new Request(url, { method, headers, body: Readable.toWeb(req), duplex: 'half' });
  }

  /** REST family 优先 → `matched:false` 回落自有路由；rejection → 500 占位 + 观测。 */
  async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let outcome: RestHandledResult;
    try {
      outcome = await restRouter.handle(toWebRequest(req));
    } catch (error) {
      notifyRejection(error);
      writePlain(res, 500, 'internal error\n');
      return;
    }
    if (!outcome.matched) {
      // 回落到 listener 自有路由：判定保持 `req.method === 'GET' && req.url === '/healthz'`
      // 精确等值（query-string 现状即 404，行为不得漂移）。
      if (req.method === 'GET' && req.url === '/healthz') {
        writePlain(res, 200, 'ok\n');
      } else {
        writePlain(res, 404, 'not found\n');
      }
      return;
    }
    try {
      const response = outcome.response;
      const bytes = new Uint8Array(await response.arrayBuffer());
      const headers: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        headers[name] = value;
      });
      res.writeHead(response.status, headers);
      res.end(bytes);
    } catch {
      // 写回失败（socket 已亡）：静默收口；in-flight 由 handle 的 finally 注销。
    }
  }

  function register(req: IncomingMessage): InFlightEntry {
    let resolveSettled: (() => void) | undefined;
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });
    const entry: InFlightEntry = {
      settled,
      settle: () => {
        inFlight.delete(entry);
        resolveSettled?.();
      },
      abort: () => {
        // 销毁请求 socket：挂起 body 读取以流错误结算；已进入 registry.create 的在途槽
        // 不被取消（ADR 0015 L113），由 registry.shutdown() 的已接纳槽结算二次保障。
        req.socket.destroy();
      },
    };
    inFlight.add(entry);
    return entry;
  }

  async function runDrain(budgetMs: number): Promise<void> {
    const pending = [...inFlight];
    if (pending.length === 0) return; // 无已接纳工作：即时返回（N2 有界锚）
    const all = Promise.all(pending.map((entry) => entry.settled));
    let timer: NodeJS.Timeout | undefined;
    const outcome = await Promise.race<'settled' | 'timeout'>([
      all.then(() => 'settled' as const),
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), Math.max(0, budgetMs));
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    if (outcome === 'settled') return;
    // 预算尽：abort 后即继续（迟到结算为 no-op；registry.shutdown 承担第二道结算保障）。
    for (const entry of pending) entry.abort();
  }

  function drain(budgetMs: number): Promise<void> {
    drainPromise ??= runDrain(budgetMs);
    return drainPromise;
  }

  function handle(req: IncomingMessage, res: ServerResponse): void {
    // EventEmitter 上下文不外抛：异步主体整体包裹（首个同步段即完成 intake 门判定与
    // in-flight 登记——Node request 事件同步派发，无「已到未登记」中间态）。
    void (async () => {
      if (isStopping()) {
        // intake 门 A：停机期新普通请求一律 503（不进入任何 route family、不登记 in-flight）。
        // 定性 = server transport 层拒绝（非 router 错误契约成员；FR-3 收敛义务见设计 §13）。
        writePlain(res, 503, 'service unavailable\n');
        return;
      }
      const entry = register(req);
      try {
        await dispatch(req, res);
      } finally {
        entry.settle();
      }
    })().catch((error: unknown) => {
      // 兜底（结构性不可达：dispatch/writePlain/register 均已自收口）：不外抛 + 不静默。
      notifyRejection(error);
    });
  }

  return Object.freeze({ handle, drain });
}
