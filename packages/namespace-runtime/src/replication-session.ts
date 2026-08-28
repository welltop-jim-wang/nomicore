/**
 * @nomicore/namespace-runtime —— ReplicationSession 会话核心（issue #134：Phase 5
 * 切片 3/4「expose trusted NamespaceLease ReplicationSession」；设计
 * wiki/raw/task_namespace-lease-replication-session_design.md §4，R1 定稿）。
 *
 * 模块职责边界：一切需要 doc/handle/state/sequencer/notifyDirty 的机制——gate、
 * scratch 预演检查、apply 槽 R1–R7、SV/diff、扇出、session 终态机。公共 Runtime
 * 对象零改动（仍恰十二键、Object.freeze、index 值导出仍恰一键——D-12）；本模块
 * 只经 `@nomicore/namespace-runtime/internal` 第二值导出
 * `openReplicationSessionCoreForRegistry` 被 Registry 生产代码消费，index.ts 零
 * re-export。
 *
 * 结构（D-1/D-2）：
 * - SessionFanout：构造期 `doc.on('update')` 恰一监听（INV-S2——每 Runtime 恰一个）；
 *   **R2-3 异步化**：observer 内只复制 owned bytes（`update.slice()`）并入队；listener
 *   移出 transaction 栈——经每 channel 自延伸微任务泵（让步 20）有界投递（容量 16 冻结
 *   常量 FANOUT_CHANNEL_QUEUE_CAPACITY）；溢出 → 弃新 + `needsResync`（sticky、继续
 *   投递——ADR 0010 L113 字面实现）；投递集 = 交付时刻 listener 快照（at-least-once，
 *   §4.2 要点 8）；按 origin token 抑制回声（INV-S3）；每 listener 每投递独立
 *   `Uint8Array` 副本（slice()——INV-S4 字节面）；listener throw 在投递点自捕获
 *   （计数进 session status `observerFailures`——ADR 0007 L54「记录」面；绝不抛入
 *   Yjs transaction 栈，T-2 和解）。
 * - RuntimeReplicationHost：{doc, handle, state, sequencer, notifyDirty, fanout}——
 *   由 runtime.ts 构造期一次成型，经模块级 WeakMap 以 runtime 对象引用为键登记
 *   （SA2 R1 #15：登记在 runtime 对象构造之后——零属性污染，Object.keys 仍十二键）。
 * - RuntimeReplicationSessionCore：冻结四域 + 六能力；apply 槽 `enqueue` **同一
 *   WriteSequencer 实例**（INV-S1——与 mutateRoot/replaceSchema/enable/bump 共享唯一
 *   FIFO，AC-3 结构性保证）。
 * - 会话域拒绝 message 全部为 §6.2 冻结文案（errors.ts 单一真相源；本模块只引用）。
 *
 * 模块级导出面（包内通道）：类型 + createSessionFanout（runtime.ts 消费）+
 * registerReplicationHost（runtime.ts 消费）+ openReplicationSessionCoreForRegistry
 * （internal.ts re-export；测试经包内相对通道直取）。
 */
import * as Y from 'yjs';
import type { DocHandle, DocHandleStatus } from '@nomicore/persistence';
import {
  REPLICATION_EPOCH_CONFLICTED_MESSAGE,
  REPLICATION_NOT_ENABLED_MESSAGE,
  REPLICATION_PROTECTED_FIELDS_CHANGED_MESSAGE,
  REPLICATION_RAW_UPDATE_INVALID_MESSAGE,
  REPLICATION_SESSION_CLOSED_MESSAGE,
  REPLICATION_SESSION_UNSUPPORTED_MESSAGE,
  RUNTIME_WRITE_DISABLED_CODE,
  ReplicationSessionClosedError,
  RuntimeWriteFatalError,
} from './errors.js';
import type { RuntimeState } from './p0.js';
import { markWriteFatal, rejectWithWriteFatal, writeFatalMessage } from './write.js';
import { WriteSequencer } from './sequencer.js';
import type { NamespaceRuntime } from './runtime.js';

// ─────────────────────────────── 公共类型面（§3.2） ───────────────────────────────

/** open 输入（与 registry 侧 OpenReplicationSessionOptions 同形；replicationId/
 *  replicationEpoch 由 Runtime 投影链冻结，非调用方输入——SA8 T-6/O-7）。 */
export interface RuntimeReplicationSessionOptions {
  readonly localRole: 'hub' | 'peer';
  readonly remoteInstanceId: string;
}

/**
 * apply 拒绝码闭集（append-only；fatal 经 RuntimeWriteFatalError rejection，不入本联合）。
 * 【SA2 R1 HIGH-1 修法】本联合与公共联合（registry §3.1 六码）**逐字相同**——这是
 * lease.ts `Equal<RuntimeReplicationSessionCore, ReplicationSession>` 十键逐字段相等
 * 成立的前提（SA2 实证：5 码版 TS2344 红、6 码版 exit 0）。
 * `'NAMESPACE_LEASE_RELEASED'` 在 core 侧**结构性永不结算**——唯一产出点是 registry
 * 包装层 wrapCore 的 revoked() 前置检查（设计 §5.1/§5.3）；core 并入该码纯粹是类型层
 * 锁面要求，运行时无第二产出路径。
 */
export type RuntimeReplicationSessionApplyRefusalCode =
  | 'REPLICATION_SESSION_CLOSED'
  | 'REPLICATION_EPOCH_CONFLICTED'
  | 'REPLICATION_RAW_UPDATE_INVALID'
  | 'REPLICATION_PROTECTED_FIELDS_CHANGED'
  | 'RUNTIME_WRITE_DISABLED'
  | 'NAMESPACE_LEASE_RELEASED';

export type RuntimeReplicationSessionApplyResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: RuntimeReplicationSessionApplyRefusalCode; message: string }>;

/** session 独立状态查询面（O-11 冻结词汇；Runtime status 的 replication 域仍只含两态
 *  持久事实——T-4）。与 registry 侧 ReplicationSessionStatus 逐字段同构（lease.ts
 *  Equal 断言锁死）。 */
export interface RuntimeReplicationSessionStatus {
  /** session 终态机：open → closed（显式 close 或 Lease release）| conflicted（epoch fence，稳定）。 */
  readonly state: 'open' | 'closed' | 'conflicted';
  readonly localRole: 'hub' | 'peer';
  /** 创建时派生冻结：localRole==='peer' ⇔ 'hub-to-peer'（星型拓扑下 peer 的唯一对端是 hub）。 */
  readonly direction: 'hub-to-peer' | 'peer-to-hub';
  readonly remoteInstanceId: string;
  readonly replicationId: string;
  /** 冻结值——永不随 Runtime bump 漂移（ADR 0010 L81；SA6 用例 17 锚）。 */
  readonly replicationEpoch: number;
  /** Runtime 投影链当前 epoch（fence 可观测：currentEpoch !== replicationEpoch ⟹ 已过期）。 */
  readonly currentEpoch: number;
  /** raw apply 成功后置位、session 生命周期内永不清除（session 无法证明 ROOT 重新合法——只置不清是诚实方向）。 */
  readonly rootValidation: 'none' | 'replication-unvalidated';
  /** ADR 0010 L139：必须区分「内存已追上」与「磁盘未追上」，不得声称 durable。
   *  memoryCaughtUp 初值冻结 false（open 时刻尚无经本 session 的 raw apply——SA2 R1 #7），
   *  首次 apply 槽 R5.5 置 true 后不回落；diskCaughtUp 为字面量 false 类型——本查询面
   *  结构性永不声称磁盘已追上（durable 证据通道在本切片不存在）。 */
  readonly durability: Readonly<{ readonly memoryCaughtUp: boolean; readonly diskCaughtUp: false }>;
  /** 扇出 listener 抛错的自捕获计数（ADR 0007 L54「记录」面；不 fatal、不断扇出）。 */
  readonly observerFailures: number;
  /** fanout 投递队列溢出标记（F-1：status 第 11 字段；初值 false——open 时队列为空；
   *  **sticky**——置位后 session 生命周期内永不清除（无清除 API；清零路径 = transport
   *  reset/bootstrap 后 open 新 session）；标记后投递行为不变（继续投递——标记是
   *  观测信号不是行为切换），transport 观测后自行决策 reset/bootstrap（切片 6 消费）。 */
  readonly needsResync: boolean;
}

/** 公共窄能力面（ADR 0010 L81–88 六项 + 冻结四域；恰十键；与 registry 侧
 *  ReplicationSession 逐字段同构——close 同为 `Promise<void>` 无参，release 路径复用
 *  同一 close()，不设第二方法面；由 lease.ts Equal 断言锁死）。 */
export interface RuntimeReplicationSessionCore {
  readonly localRole: 'hub' | 'peer';
  readonly remoteInstanceId: string;
  readonly replicationId: string;
  readonly replicationEpoch: number;
  encodeStateVector(): Uint8Array;
  encodeDiff(remoteStateVector: Uint8Array): Uint8Array;
  subscribeOwnedUpdates(listener: (update: Uint8Array) => void): () => void;
  applyRemoteUpdate(update: Uint8Array): Promise<RuntimeReplicationSessionApplyResult>;
  getStatus(): Readonly<RuntimeReplicationSessionStatus>;
  close(): Promise<void>;
}

/** open 结果联合（core 侧）；code 闭集与 registry §3.1 OpenReplicationSessionIssueCode
 *  的 open 域成员一一对应（released/输入/role/session-exists 由 Lease 层裁决，不进 core）。 */
export type RuntimeReplicationSessionOpenResult =
  | Readonly<{ ok: true; core: RuntimeReplicationSessionCore }>
  | Readonly<{
      ok: false;
      code: 'REPLICATION_NOT_ENABLED' | 'RUNTIME_WRITE_DISABLED' | 'REPLICATION_SESSION_UNSUPPORTED';
      message: string;
    }>;

// ─────────────────────────────── 扇出（§4.2 / O-10 / AC-6；R2-3 异步化） ───────────────────────────────

/** 每 channel（= 每 session）投递队列容量上限（F-1：冻结常量 16——不可配置，沿
 *  RAW_PROTECTED_FIELDS「raw caller 不得逐次自定义」同款纪律）。溢出 → 丢弃**新**项
 *  （保序：已入队最旧项保留）+ 置 needsResync（ADR 0010 L113 字面实现）。 */
const FANOUT_CHANNEL_QUEUE_CAPACITY = 16;

/** 每次投递前的微任务让步数（§4.3 时序论证：20 为双向 load-bearing 常数——
 *  下界 = 写结算链上界（~8 跳）+ 裕度（公平性：T 恒先于 listener 调用）；
 *  上界 = flushMicrotasks 预算（registry 侧 40 内首投递可见）；合法区间 [16, 24]。）
 *  让步只产生微任务计数，不产生墙钟等待。 */
const FANOUT_DELIVERY_DEFERRAL_MICROTASKS = 20;

/** 会话广播通道（每 session 一份；fanout 的 channel 集合成员）。
 *  【R2.1 / SA2 #4 实现不变量（冻结）】finalize 只摘除**自身** channel
 *  （fanout.detach 以自引用为参）；fenceStale/terminateAll 迭代期间的 Set 删除限于
 *  当前被访元素（JS Set 迭代语义下安全）。SA3 不得引入终态级联摘除（finalize 摘除
 *  非当前 channel）；如确需，必须同步改为快照迭代（[...channels]）。 */
export interface SessionChannel {
  /** 每 session 唯一回声抑制 token（D-4：apply 源 origin 与该 token 恒等即排除）。 */
  readonly applyOrigin: symbol;
  readonly listeners: Set<(update: Uint8Array) => void>;
  /** listener throw 自捕获计数（ADR 0007 L54「记录」面——不 fatal、不熔断、不断扇出；
   *  无界纯计数，熔断/退订/背压属切片 6 队列属主——O-10 显式选择）。 */
  failures: number;
  /** 冻结 fence 谓词输入（createSessionCore 单次成型——不变不漂移；fenceStale 以
   *  （replicationId, replicationEpoch）与传入不等判过期——身份不等或 epoch 落后）。 */
  readonly replicationId: string;
  readonly replicationEpoch: number;
  /** 有界异步投递队列（F-1：每 channel 容量 16；FIFO；溢出弃新保旧）。 */
  readonly queue: Uint8Array[];
  /** 溢出 sticky 标记（F-1：置位后 session 生命周期内永不清除；清零路径 = transport
   *  reset/bootstrap 后 open 新 session；标记后投递行为不变——标记是观测信号）。 */
  needsResync: boolean;
  /** 泵单飞守卫（任一时刻每 channel 至多一个泵 continuation 挂起——公平性机制根源）。 */
  pumpScheduled: boolean;
  /** finalize 回调（core 闭包——终态唯一可变源仍在 core，channel 不复制终态，防双写）。
   *  终态迁移：terminal==='open' 时才生效（幂等；conflicted 不降级）；置终态 +
   *  fanout.detach(channel)（摘除点复用）+ **取消全部未投递排队项**（queue.length = 0；
   *  进行中泵于下一让步点经 isTerminal() 退出）。 */
  readonly finalize: (terminal: 'closed' | 'conflicted', cause?: 'runtime-close') => void;
  /** 终态观测（core 闭包转置——泵/observer 的双闸输入）。 */
  readonly isTerminal: () => boolean;
}

/** 扇出器（O-10/AC-6）：构造期挂接、永不离线（空 channel 集合零成本快路径）。 */
export interface SessionFanout {
  attach(channel: SessionChannel): void;
  detach(channel: SessionChannel): void;
  /** R2-1（bump 槽 E5.5 主动 fence）：凡 channel 冻结 (replicationId, replicationEpoch)
   *  与传入不等（身份不等或 epoch 落后）→ 调 channel.finalize('conflicted')。
   *  bump 后 nextEpoch 为全新值 ⇒ 全部现存 channel（全部冻结旧 epoch）被 fence——
   *  无幸存者、无逐 channel 判断遗漏。 */
  fenceStale(replicationId: string, replicationEpoch: number): void;
  /** R2-2（Runtime close 同步段）：逐 channel finalize('closed', 'runtime-close')
   *  并从集合移除（finalize 自摘除——迭代删除限于当前被访元素，见 SessionChannel 注记）。 */
  terminateAll(cause: 'runtime-close'): void;
}

/**
 * 泵（R2-3）：自延伸微任务链（每 channel 独立）。设计要点（冻结）：
 * 1. 单飞守卫 + 自延伸链——任一时刻每 channel 至多一个泵 continuation 挂起
 *    （await Promise.resolve() 在循环内逐次延伸，非一次性预排 k 个微任务；预排式链
 *    会霸占微任务队列，无「后续 sequencer 槽先于投递」的公平性）；
 * 2. 每项投递前统一让步 20 次（首项与后续项同规——无特例）；
 * 3. 交付集 = **交付时刻** listener 快照（[...listeners] 于每项投递时点取，非入队时点）
 *    ——at-least-once 语义（§4.2 要点 8）：晚订阅者可收订阅前入队项；跨退订重订可重复
 *    交付；重复由 Yjs Y.applyUpdate 幂等吸收；
 * 4. 每 listener 每投递独立 `item.slice()` 副本（INV-S4 字节面——两级副本）；
 * 5. listener throw 在投递点自捕获计数（捕获点从 transaction 栈内移到栈外——隔离从
 *    「异常域」升级为「异常域 + 时序域」，计数面不变）；
 * 6. 与终态互斥：循环条件 + 让步后重检双闸（isTerminal()）；fence/terminate 的清队使
 *    queue.length === 0 双重成立。
 */
function schedulePump(channel: SessionChannel): void {
  if (channel.pumpScheduled) return;
  channel.pumpScheduled = true;
  void (async () => {
    try {
      while (channel.queue.length > 0 && !channel.isTerminal()) {
        for (let i = 0; i < FANOUT_DELIVERY_DEFERRAL_MICROTASKS; i += 1) await Promise.resolve();
        if (channel.isTerminal() || channel.queue.length === 0) return; // 让步后重检（fence/terminate/清队）
        const item = channel.queue.shift()!; // FIFO：最旧先投（溢出弃新保旧）
        for (const listener of [...channel.listeners]) {
          // 交付时刻 listener 快照（要点 3）；每 listener 每投递独立副本（INV-S4 字节面）
          try {
            listener(item.slice());
          } catch {
            channel.failures += 1; // 自捕获计数（observerFailures——不熔断不自动退订）
          }
        }
      }
    } catch {
      // 【R2.1 / SA2 #7】最外层兜底：listener 已逐个隔离、shift()/slice() 结构性不可抛，
      // 但未来任何编辑引入非 listener 抛点时收敛为计数而非 unhandled rejection。
      channel.failures += 1;
    } finally {
      channel.pumpScheduled = false; // 与 while 退出检查同一同步段（无 await 间隔）⇒ 无丢失唤醒
    }
  })();
}

/**
 * 创建扇出器：`doc.on('update')` 恰一监听。observer 内**只做**（异步化契约，R2-3）：
 * 回声抑制谓词（INV-S3 唯一谓词）→ 终态双保险 → 容量检查（先于字节复制——溢出路径
 * 零分配）→ owned bytes 复制（`update.slice()`——六步之 4「产出」的同步面）→ 入队 →
 * 调度泵。**listener 调用全部移出 transaction 栈**（时序隔离 + 异常隔离双保险）。
 * null origin（一切 Runtime 内部写：transact 无 origin → 事件 origin 为 null）恒投
 * 全部活跃 channel；apply 源 token 恒被其所属 session 排除。
 */
export function createSessionFanout(doc: Y.Doc): SessionFanout {
  const channels = new Set<SessionChannel>();
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    for (const channel of channels) {
      if (origin === channel.applyOrigin) continue; // 回声抑制排除谓词（唯一谓词）
      if (channel.isTerminal()) continue; // 终态双保险（detach 后结构性不可达）
      if (channel.queue.length >= FANOUT_CHANNEL_QUEUE_CAPACITY) {
        // F-1：溢出 → 只标记（丢弃新项、零分配、保序弃新）——L113 字面实现
        channel.needsResync = true;
        continue;
      }
      channel.queue.push(update.slice()); // owned bytes 复制（隔离 yjs 数组复用）
      schedulePump(channel); // 泵已调度则 no-op（单飞守卫）
    }
  });
  return {
    attach(channel) {
      channels.add(channel);
    },
    detach(channel) {
      channels.delete(channel);
    },
    fenceStale(replicationId, replicationEpoch) {
      // R2-1（§2.1）：finalize 只摘除自身 channel——本迭代期删除限于当前被访元素
      //（JS Set 迭代语义安全；SA3 不得引入级联摘除——见 SessionChannel 注记）
      for (const channel of channels) {
        if (
          channel.replicationId !== replicationId ||
          channel.replicationEpoch !== replicationEpoch
        ) {
          channel.finalize('conflicted');
        }
      }
    },
    terminateAll(cause) {
      // R2-2（§3.1）：同款迭代纪律；finalize 对 conflicted 不降级（终态保持）
      for (const channel of channels) {
        channel.finalize('closed', cause);
      }
    },
  };
}

// ─────────────────────────────── Host 与 WeakMap 登记（§4.1 / D-2） ───────────────────────────────

/** 会话宿主（runtime.ts 构造期一次成型——纯数据闭包，槽体零读 seam 输入，INV-N14 延续）。
 *  结构上是 WriteEnv 的超集（doc/handle/state/notifyDirty 同批捕获局部量 + sequencer + fanout）。 */
export interface RuntimeReplicationHost {
  readonly doc: Y.Doc;
  readonly handle: DocHandle;
  readonly state: RuntimeState;
  readonly sequencer: WriteSequencer;
  readonly notifyDirty: (() => Promise<void>) | undefined;
  readonly fanout: SessionFanout;
}

/** 模块级 host 登记（WeakMap——以 runtime 对象引用为键；不触碰 runtime 对象本身，
 *  零属性污染——Object.keys(runtime) 仍恰十二键，runtime-registry-internal-seam.test.ts
 *  键集锁零改动即绿）。 */
const replicationHosts = new WeakMap<NamespaceRuntime, RuntimeReplicationHost>();

/** runtime.ts 构造序调用（V3e 之后、返回之前——SA2 R1 #15）。 */
export function registerReplicationHost(runtime: NamespaceRuntime, host: RuntimeReplicationHost): void {
  replicationHosts.set(runtime, host);
}

// ─────────────────────────────── 受保护字段常量（§4.6 / O-12） ───────────────────────────────

/** 冻结常量（raw caller 不得逐次自定义——ADR 0010 L121）。以「接收方本地角色」为键：
 *  hub session（接收 peer→hub update）：SCHEMA 全容器 + META 全键（L105 + D-9 收紧——
 *  对 ADR L105 最小集（SCHEMA+保留字段）的收紧而非放宽：docId/createdAt 是 Registry
 *  身份元数据、本切片无任何合法 raw 路径修改非保留 META（L121 未决定），对称谓词可测
 *  性与防篡改性均更优；ADR 0010 增补节已登记）；peer session（接收 hub→peer update）：
 *  META 全键保护；SCHEMA/ROOT 放行（L105「允许同步 ROOT、SCHEMA」）。 */
const RAW_PROTECTED_FIELDS = Object.freeze({
  hub: Object.freeze({ schema: true, meta: true }),
  peer: Object.freeze({ schema: false, meta: true }),
} as const);

// 【R2-12（§13.1）】PEER_ALLOWED_META_KEYS 空占位已删除：空集是**语义冻结**（ADR 0010
// 修订节「peer 允许的 META 白名单首版 = 空集 ⟺ META 全键保护」——ADR 文字即真相源，
// 非代码常量义务）；运行时零差分、零引用（grep 全域复核）。

// ─────────────────────────────── 会话 core 状态与工厂（§4.3） ───────────────────────────────

/** core 闭包可变状态（唯一可变源；读取面零写）。 */
interface SessionCoreState {
  terminal: 'open' | 'closed' | 'conflicted';
  rootValidation: 'none' | 'replication-unvalidated';
  memoryCaughtUp: boolean;
}

/** Runtime-close 终止来源记账（R2-2 §3.3——**不进 status 形状**；A1 拒绝码映射专用：
 *  closedBy==='runtime-close' → apply 拒绝码 RUNTIME_WRITE_DISABLED（close 域接纳拒绝，
 *  #93 第 (4) 类），显式 close → REPLICATION_SESSION_CLOSED。 */
type SessionClosedBy = 'explicit-close' | 'runtime-close';

/** apply 槽冻结上下文（open 时捕获常量——结构性不漂移，INV-S5）。 */
interface SessionSlotContext {
  readonly localRole: 'hub' | 'peer';
  readonly direction: 'hub-to-peer' | 'peer-to-hub';
  readonly replicationId: string;
  readonly replicationEpoch: number;
  readonly applyOrigin: symbol;
}

/**
 * 建立会话 core（open 门全部通过后调用）：冻结四域 + 创建通道并 attach + 终态机
 * 初值 + 六能力闭包。open → closed（close/release）| conflicted（R2 epoch fence）。
 */
function createSessionCore(
  host: RuntimeReplicationHost,
  options: RuntimeReplicationSessionOptions,
  facts: Readonly<{ state: 'enabled'; replicationId: string; replicationEpoch: number }>,
): RuntimeReplicationSessionCore {
  const localRole = options.localRole;
  const remoteInstanceId = options.remoteInstanceId;
  const replicationId = facts.replicationId;
  const replicationEpoch = facts.replicationEpoch;
  const direction: 'hub-to-peer' | 'peer-to-hub' = localRole === 'peer' ? 'hub-to-peer' : 'peer-to-hub';
  const applyOrigin = Symbol('replication-session-apply-origin'); // 每 session 唯一 token（D-4）
  const coreState: SessionCoreState = { terminal: 'open', rootValidation: 'none', memoryCaughtUp: false };
  let closePromise: Promise<void> | undefined;
  let closedBy: SessionClosedBy | undefined;

  /** 终态迁移统一入口（R2-1/R2-2：bump 槽 fenceStale、Runtime close terminateAll、显式
   *  close、apply 槽 R2 被动 fence 共用——零新增终态语义；channel 持 finalize/isTerminal
   *  闭包，core 持 channel——一次成型互持，终态唯一可变源仍在 core）。 */
  const finalize = (terminal: 'closed' | 'conflicted', cause?: 'runtime-close'): void => {
    if (coreState.terminal !== 'open') return; // 幂等 + 终态不降级（conflicted 保持 conflicted）
    coreState.terminal = terminal;
    if (terminal === 'closed' && cause === 'runtime-close') closedBy = 'runtime-close';
    host.fanout.detach(channel); // 摘除点复用——存量 listener 即刻停止投递
    channel.queue.length = 0; // 取消全部未投递排队项（F-3：bump 写零投递给旧 session）
  };

  const channel: SessionChannel = {
    applyOrigin,
    listeners: new Set(),
    failures: 0,
    replicationId,
    replicationEpoch,
    queue: [],
    needsResync: false,
    pumpScheduled: false,
    finalize,
    isTerminal: () => coreState.terminal !== 'open',
  };
  host.fanout.attach(channel);

  const session: RuntimeReplicationSessionCore = {
    localRole,
    remoteInstanceId,
    replicationId,
    replicationEpoch,
    encodeStateVector() {
      // 终态同步 throw（沿 getter 域 throw 先例——RuntimeReadDisabledError 同款通道）；
      // 本方法为同步编码面，不经结果联合包装
      if (coreState.terminal !== 'open') throw new ReplicationSessionClosedError();
      return Y.encodeStateVector(host.doc);
    },
    encodeDiff(remoteStateVector) {
      if (coreState.terminal !== 'open') throw new ReplicationSessionClosedError();
      // 畸形 state vector（无法被 lib0/yjs 解码）→ 照实抛 Yjs 原生错误——可信域契约
      //（调用方为 Host 组装的可信 transport；本方法为同步编码面，不经结果联合包装）
      return Y.encodeStateAsUpdate(host.doc, remoteStateVector);
    },
    subscribeOwnedUpdates(listener) {
      // 形状门禁：非函数 → 订阅时同步 TypeError（SA2 R1 #8 冻结；运行期 listener throw
      // 由扇出层自捕获计数，不熔断）
      if (typeof listener !== 'function') {
        throw new TypeError(
          'REPLICATION_SESSION_SUBSCRIBE_INVALID: subscribeOwnedUpdates 的 listener 必须是函数' +
            '（订阅时同步形状门禁；运行期 throw 由扇出层自捕获计数，不熔断）',
        );
      }
      if (coreState.terminal !== 'open') return () => {}; // 终态：永不投递的 no-op 订阅
      channel.listeners.add(listener);
      return () => {
        channel.listeners.delete(listener);
      };
    },
    applyRemoteUpdate(update) {
      // ── 接纳层（同步段，非槽——镜像 D5.1 接纳门）A0–A4 ──────────────────────
      // A1 core 终态（停接纳即时生效；终态后 apply 一概不入队）
      if (coreState.terminal === 'closed') {
        // R2-2（§3.3）码域精化：Runtime-close 终止的 session 的复后拒绝本质是 close 域
        // 接纳拒绝（ADR 0008 #93 修订节第 (4) 类）——code 域统一到 RUNTIME_WRITE_DISABLED；
        // 显式 close 保持 REPLICATION_SESSION_CLOSED（A1 拒绝码映射专用 closedBy 记账）。
        if (closedBy === 'runtime-close') {
          return Promise.resolve(
            refusal('RUNTIME_WRITE_DISABLED', writeDisabledMessage('lifecycle', host.state.lifecycle)),
          );
        }
        return Promise.resolve(
          refusal('REPLICATION_SESSION_CLOSED', REPLICATION_SESSION_CLOSED_MESSAGE),
        );
      }
      if (coreState.terminal === 'conflicted') {
        return Promise.resolve(
          refusal('REPLICATION_EPOCH_CONFLICTED', REPLICATION_EPOCH_CONFLICTED_MESSAGE),
        );
      }
      // A2 输入形状 + 陷阱安全拷贝（INV-S15：**绝不用 update.slice()**——敌意子类
      // （class Evil extends Uint8Array { slice(){ throw } }）instanceof 通过而 slice()
      // 同步 throw 将击穿「一切拒绝经 Promise 结算」；new Uint8Array(update) 经不可
      // 截获的整型索引读取复制，产物为纯 Uint8Array（中性化 Buffer 伪装/子类覆写），
      // 排队期间调用方对原对象的变异无效（单读捕获——快照纪律的 bytes 最小实现）
      if (!(update instanceof Uint8Array)) {
        return Promise.resolve(
          refusal('REPLICATION_RAW_UPDATE_INVALID', REPLICATION_RAW_UPDATE_INVALID_MESSAGE),
        );
      }
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(update);
      } catch {
        // 防御分支（构造器异常面完备——整型索引与 length 均为内部槽；detached buffer
        // 产出全零字节属良性闭环：下游 scratch 预演按非法/空内容处理）。覆盖 A2 的
        // 极端拒绝路径——一切拒绝经返回 Promise 的 ok:false 结算
        return Promise.resolve(
          refusal('REPLICATION_RAW_UPDATE_INVALID', REPLICATION_RAW_UPDATE_INVALID_MESSAGE),
        );
      }
      // A3 runtime lifecycle ≠ 'ready' → 零入队即时拒绝（INV-S11：close 后接纳层拒；
      //   与运行时四写 D5.1 接纳门同构；lifecycle 为瞬时观察——A3 与槽 R1 之间
      //   close() 在途切换时已接纳槽照常排空，ADR-0008）
      const lifecycle = host.state.lifecycle;
      if (lifecycle !== 'ready') {
        return Promise.resolve(
          refusal('RUNTIME_WRITE_DISABLED', writeDisabledMessage('lifecycle', lifecycle)),
        );
      }
      // A4 入队唯一 write sequencer（INV-S1——同一 WriteSequencer 实例，FIFO 互通）
      return host.sequencer.enqueue(() =>
        runSessionApplySlot(
          host,
          coreState,
          channel,
          {
            localRole,
            direction,
            replicationId,
            replicationEpoch,
            applyOrigin,
          },
          bytes,
        ),
      );
    },
    getStatus() {
      // 每次调用返回全新深冻结对象（沿 buildStatus/INV-R6 先例——SA2 R1 #6：
      // state/currentEpoch/rootValidation/observerFailures/durability 均为时变域）
      const factsNow = host.state.replication;
      // 投影链当前 epoch（fence 可观测：currentEpoch !== replicationEpoch ⟹ 已过期）。
      // disabled 分支结构不可达（open 需 enabled；enable 幂等、无回退写路径）——防御
      // 回退到冻结值（该分支永不触发，回退值仅满足类型闭包）
      const currentEpoch = factsNow.state === 'enabled' ? factsNow.replicationEpoch : replicationEpoch;
      return Object.freeze({
        state: coreState.terminal,
        localRole,
        direction,
        remoteInstanceId,
        replicationId,
        replicationEpoch,
        currentEpoch,
        rootValidation: coreState.rootValidation,
        durability: Object.freeze({
          memoryCaughtUp: coreState.memoryCaughtUp,
          diskCaughtUp: false as const,
        }),
        observerFailures: channel.failures,
        needsResync: channel.needsResync,
      });
    },
    close() {
      // 幂等 same-promise 缓存（INV-S11，沿 runtime.close INV-C2 形状）：
      // 首调**同步段**：① finalize('closed')——标记终态 + fanout.detach + 排队项取消
      //（停接纳即时生效，后到的 apply 在接纳层 A1 被拒、不入队；当前为 conflicted 时
      // 保持 conflicted——终态不降级，finalize 幂等 no-op）
      // ② 恒绿空槽体 barrier 入队（resolve 时点 = 先于本次 close() 接纳的全部任务
      // 排空之后——镜像 runtime.close barrier/INV-C4；直接服务 ADR 0010 L179「等待已
      // 被 Runtime 接纳的 apply 槽完成但不无限等待网络 ACK」）。**永不 reject**：
      // barrier 槽体为空 async 函数，结构性无 reject 面（§5.2 `void close()` fire-and-
      // forget 零 unhandled rejection 前提）
      if (closePromise !== undefined) return closePromise;
      finalize('closed');
      closePromise = host.sequencer.enqueue(async () => {
        /* 恒绿空槽体：barrier 只承担「排在已接纳任务之后」的时序语义 */
      });
      return closePromise;
    },
  };
  return Object.freeze(session);
}

// ─────────────────────────────── apply 槽 R1–R7（§4.4） ───────────────────────────────

/**
 * 会话 apply 槽（ADR 0010 L96–103 六步逐位对应；与 S/E 槽同构——差异见设计 §4.4 表）。
 * async——同步段无可抛点，一切可预期拒绝经 ok:false 结果结算，internal fatal 经
 * RuntimeWriteFatalError rejection（committed 诚实）。
 */
async function runSessionApplySlot(
  host: RuntimeReplicationHost,
  coreState: SessionCoreState,
  channel: SessionChannel,
  ctx: SessionSlotContext,
  bytes: Uint8Array,
): Promise<RuntimeReplicationSessionApplyResult> {
  // ── R1 fatal gate（零输入访问；零 doc 访问）──────────────────────────────
  if (host.state.fatal !== undefined) {
    return refusal('RUNTIME_WRITE_DISABLED', writeDisabledMessage('fatal'));
  }

  // ── R2 身份/epoch gate（约 E4 会话变体：事实源 = 投影链 state.replication 单点
  //    ---- T-6；不读 live META——避免新的损坏读取通道）─────────────────────
  const factsNow = host.state.replication;
  if (
    factsNow.state !== 'enabled' ||
    factsNow.replicationId !== ctx.replicationId ||
    factsNow.replicationEpoch !== ctx.replicationEpoch
  ) {
    // O-8：不等 → 被动 fence——**同一 finalize**（与 bump 槽 E5.5 主动 fence 共用：
    // 终态置位 + fanout.detach 摘除点 + 未投递排队项取消；零新增终态语义，D-2a）+ 零写入拒绝
    channel.finalize('conflicted');
    return refusal('REPLICATION_EPOCH_CONFLICTED', REPLICATION_EPOCH_CONFLICTED_MESSAGE);
  }

  // ── R3 writable gate + degraded bypass 谓词 + notifier 绑定（O-1；短路顺序
  //    fatal→getStatus→notifier 与 E2 逐字节同序）─────────────────────────
  let handleStatus: DocHandleStatus;
  try {
    handleStatus = host.handle.getStatus();
  } catch (err) {
    // adapter bug → 统一 fatal（committed:false——此时尚零 doc 写）
    markWriteFatal(host, err, 'replication-apply');
    throw new RuntimeWriteFatalError(
      'write-slot-internal',
      false,
      writeFatalMessage('replication-apply', 'write-slot-internal', false),
      err === undefined ? undefined : { cause: err },
    );
  }
  if (handleStatus !== 'ready') {
    // O-1 bypass 五条件合取（lifecycle==='ready' 已由 A3 保证、fatal 未置位已由 R1
    // 保证、direction 创建时冻结、getStatus==='persistence-degraded'、notifyDirty 已绑定）：
    // 唯一「非 ready 放行」例外 = peer 实例经 hub→peer 会话的 degraded apply（L131–135）
    const bypass =
      handleStatus === 'persistence-degraded' &&
      ctx.direction === 'hub-to-peer' &&
      host.notifyDirty !== undefined;
    if (!bypass) {
      // hub degraded 拒 peer→hub（O-5a）/ released / disposed 同拒（L136：handle
      // 失效不得绕过）
      return refusal('RUNTIME_WRITE_DISABLED', writeDisabledMessage('writable', handleStatus));
    }
  }
  if (host.notifyDirty === undefined) {
    // D6.4 立法：无持久化绑定不得写——bypass 亦不得「提交成功但永无 dirty 登记」
    return refusal('RUNTIME_WRITE_DISABLED', writeDisabledMessage('notifier'));
  }
  const notifyDirty = host.notifyDirty; // 单读捕获（此后槽体零再读 host 字段语义）

  // ── R4 受保护字段检查（O-12：scratch clone 预演 + 内容投影相等判据 (a)）────
  const evaluation = protectedContentEvaluated(host.doc, bytes, ctx.localRole);
  if (evaluation === 'invalid') {
    // 畸形字节（Yjs 无法解码）→ 整体拒绝零写入（live doc 永不被无效字节触碰，§14 实测）
    return refusal('REPLICATION_RAW_UPDATE_INVALID', REPLICATION_RAW_UPDATE_INVALID_MESSAGE);
  }
  if (evaluation === 'changed') {
    // 受保护内容变化 → 整体拒绝、零写入、saveDoc 0 次、拒绝行为稳定（重复调用同拒）
    return refusal('REPLICATION_PROTECTED_FIELDS_CHANGED', REPLICATION_PROTECTED_FIELDS_CHANGED_MESSAGE);
  }

  // ── R5 一次 Y.applyUpdate(doc, bytes, 受控 origin token)（本槽唯一 live Y.Doc
  //    写入口）+ 事务边界探针（R2-6：committed 精确二分，F-4）───────────────
  // 探针注册于本槽内——晚于一切先注册 listener（Yjs doc.on 按注册次序同步派发；敌意
  // beforeTransaction 先抛 ⇒ 探针不运行 ⇒ txStarted=false）。
  let txStarted = false;
  const txProbe = (): void => {
    txStarted = true;
  };
  host.doc.on('beforeTransaction', txProbe);
  try {
    Y.applyUpdate(host.doc, bytes, ctx.applyOrigin);
  } catch (err) {
    // 精确二分（F-4）：txStarted=false ⟺ beforeTransaction emit 未完成 ⟺ 事务函数
    // 从未执行 ⟺ 零 mutation ⇒ committed:false；txStarted=true ⟹ 事务已开始、mutation
    // 程度不可判 ⇒ 保守 committed:true（ADR 0008 L84「未知异常保守视为可能已提交」——
    // 过报方向强制）。rejectWithWriteFatal 负责 markWriteFatal + committed:true 时
    // best-effort notifyDirty。
    // 【例外注记（D-4）】二分精确性条件 = 注入面为 yjs 事务钩子域；解码期异常（R4 已拦
    // REPLICATION_RAW_UPDATE_INVALID）、notifyDirty 失败（committed:true 既有锁定）不在
    // 判据内；复合敌意（beforeTransaction 内先变异后抛错的多个 listener）属 ADR 0007
    // L54 observer 契约破坏域——二分不为其承诺，残余风险方向为 under-report（已登记）。
    return rejectWithWriteFatal(host, txStarted, 'unknown-pipeline-throw', err, 'replication-apply');
  } finally {
    host.doc.off('beforeTransaction', txProbe); // 槽级一次性——零泄漏到后续事务
  }

  // ── R5.5 session 标记（镜像 E5.5 时序：notify 挂起窗口内 status 已可观测提交事实；
  //    标记写 session 域——state.replication 不动，session 状态绝不入 Runtime status，T-4）──
  coreState.rootValidation = 'replication-unvalidated'; // 置位后永不清除（INV-S9 语义面的
  // 诚实方向：session 无法证明 ROOT 重新合法——只置不清）
  coreState.memoryCaughtUp = true; // 首次 apply 成功后不回落（INV-S16）

  // ── R6 同槽 await notifyDirty（bypass 路径同样调用——ADR 0010 L135「仍调用
  //    saveDoc 登记」；#79：degraded 不构成 saveDoc 拒绝理由）──────────────
  try {
    await notifyDirty();
  } catch (err) {
    // 写已提交而登记通道损坏——诚实 fatal（committed:true）；不重试
    markWriteFatal(host, err, 'replication-apply');
    throw new RuntimeWriteFatalError(
      'notify-dirty-failed',
      true,
      writeFatalMessage('replication-apply', 'notify-dirty-failed', true),
      err === undefined ? undefined : { cause: err },
    );
  }

  // ── R7 槽释放（promise settle；sequencer 自动放行下一项）─────────────────
  return { ok: true };
}

// ─────────────────────────────── 受保护字段检查实现（§4.6） ───────────────────────────────

/** 预演结果（槽内同步，无 await）。 */
type ProtectedEvaluation = 'equal' | 'changed' | 'invalid';

/**
 * scratch 预演（判据 (a) 内容投影相等）：
 * 1. scratch = new Y.Doc() + encodeStateAsUpdate(liveDoc) 全量装载；
 * 2. Y.applyUpdate(scratch, bytes)（throw → 'invalid'——畸形字节过滤器）；
 * 3. 投影比对（scratch vs liveDoc 当前投影——两读之间零 await，JS run-to-completion
 *    无并发写入）：SCHEMA（仅接收方为 hub）全容器 + META（两侧）全键 各自全键值
 *    投影相等（R2-4 后：primitive 直比 + 合法结构值规范化深比较——protectedValueEqual；
 *    契约外形态保守判「已改变」）；
 * 4. 不等 → 'changed'（整体拒绝、零写入、saveDoc 0 次、拒绝行为稳定）。
 * 边界 (a)：删后同值重写 = 内容未变 = 允许（内容投影相等判据的字面推论——同值重写
 * 仅历史膨胀，危害有界；ADR 0010 增补节已登记）。
 */
function protectedContentEvaluated(
  liveDoc: Y.Doc,
  bytes: Uint8Array,
  localRole: 'hub' | 'peer',
): ProtectedEvaluation {
  const scratch = new Y.Doc();
  try {
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(liveDoc));
    Y.applyUpdate(scratch, bytes);
  } catch {
    return 'invalid'; // 畸形字节：live doc 永不被触碰
  }
  const rules = RAW_PROTECTED_FIELDS[localRole];
  if (rules.schema && !protectedMapEqual(liveDoc, scratch, 'SCHEMA')) return 'changed';
  if (rules.meta && !protectedMapEqual(liveDoc, scratch, 'META')) return 'changed';
  return 'equal';
}

/** 单容器全键值内容投影相等（判据 (a)）。载体在场经 share.has 判别（零惰性 getMap）；
 *  载体异型（同名非 Y.Map）保守 'changed'（契约外形态不得经 raw 入容器——O-12 保守读法）。
 *  键集先行（存在性——长度判别）+ 逐键值比较（round-1 结构保留，仅替换值判等函数为
 *  protectedValueEqual——R2-4）。 */
function protectedMapEqual(
  live: Y.Doc,
  scratch: Y.Doc,
  name: 'SCHEMA' | 'META',
): boolean {
  const liveHas = live.share.has(name);
  const scratchHas = scratch.share.has(name);
  if (liveHas !== scratchHas) return false;
  if (!liveHas) return true;
  let liveMap: Y.Map<unknown>;
  let scratchMap: Y.Map<unknown>;
  try {
    liveMap = live.getMap(name);
    scratchMap = scratch.getMap(name);
  } catch {
    return false;
  }
  const liveKeys = [...liveMap.keys()];
  const scratchKeys = [...scratchMap.keys()];
  if (liveKeys.length !== scratchKeys.length) return false;
  for (const key of scratchKeys) {
    if (!protectedValueEqual(liveMap.get(key), scratchMap.get(key))) return false;
  }
  return true;
}

/** 白名单容器判据（R2-4 路线 (B) 保守白名单 —— 物化域对齐）：
 *  - Y.Map / Y.Array（合法 plain value 经手工 Yjs 容器形态的仅有两种；toJSON 递归投影）；
 *  - plain array / plain object（**yjs 13.6.32 实测**：`Y.Map.set` 对 plain 值经 lib0
 *    writeAny 原样存储、encode/apply round-trip 后仍为 plain——ADR 0008 L31 合法
 *    JSON-compatible 值域的实际本地形态；本判据即设计 §5.1 白名单对真实物化域的修正）；
 *    原型必须为 Object.prototype/null（排除 Date/Map/Set 等非 plain 实例——契约外）。
 *  其余一切形态（Y.Text/Y.XmlText 等 instanceof Y.AbstractType 的契约外容器、
 *  undefined/bigint/symbol/function、其它实例）保守判「已改变」——即使内容未变亦拒
 *  （round-1 姿势对契约外形态连续；合法写路径结构性不可达，仅种子/直构面）。 */
function isWhitelistedValueContainer(value: unknown): boolean {
  if (value instanceof Y.Map || value instanceof Y.Array) return true;
  if (Array.isArray(value)) return true;
  if (typeof value !== 'object' || value === null) return false;
  if (value instanceof Y.AbstractType) return false; // Y.Text 等——契约外容器
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * 值投影相等（O-12 判据 (a) round-2 细化，R2-4）：primitive 直比（SameValue——NaN 与
 * 自身相等、-0 ≠ 0）；白名单容器（Y.Map/Y.Array 经 toJSON() 递归投影、plain 结构直递）
 * 深比较（deepEqualPlain——键序无关/数组有序）；其余一切形态（契约外容器、未定义域
 * 标量、其它实例）保守判「已改变」。跨形态分叉（单侧白名单即拒——Y.Text vs plain
 * 'abc' 同拒）。META 值域零收窄：深比较只在受保护字段投影比对域内执行。
 */
function protectedValueEqual(a: unknown, b: unknown): boolean {
  const aContainer = isWhitelistedValueContainer(a);
  const bContainer = isWhitelistedValueContainer(b);
  if (aContainer || bContainer) {
    if (!(aContainer && bContainer)) return false; // 跨形态分叉（白名单容器 vs primitive/契约外容器/异型）
    return deepEqualPlain(projectOf(a), projectOf(b));
  }
  // 白名单外的容器（Y.Text 等 AbstractType）与一切契约外标量在此落入保守拒：
  // typeof 恒 'object' ≠ string/number/boolean，非 null ⇒ return false。
  const t = typeof a;
  if (t === 'string' || t === 'number' || t === 'boolean') return typeof b === t && Object.is(a, b);
  if (a === null) return b === null;
  return false; // 契约外（ADR 0008 L31 值域外 / 物化域外容器）保守拒
}

/** 白名单容器投影（Y.Map/Y.Array → toJSON() 递归 plain；plain 结构恒等直递——不加副本，
 *  deepEqualPlain 只读）。 */
function projectOf(value: unknown): unknown {
  return value instanceof Y.Map || value instanceof Y.Array ? value.toJSON() : value;
}

/**
 * plain 结构深比较（规范化规则冻结）：array 有序递归；plain object 键序无关（键集
 * 排序后比对）；primitive SameValue（NaN=NaN、-0≠0——round-1 语义延续）；嵌套契约外
 * 子值随投影参与比较（表征归一化边界——投影相等即放行）；其余形态 false。
 */
function deepEqualPlain(a: unknown, b: unknown): boolean {
  if (a === null || b === null) return a === b;
  const t = typeof a;
  if (t === 'string' || t === 'number' || t === 'boolean') {
    return typeof b === t && Object.is(a, b);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqualPlain(item, b[i]));
  }
  if (t === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    return ka.every((k) => deepEqualPlain((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false; // bigint/symbol/function/undefined 等：契约外
}

// ─────────────────────────────── open 门序与宿主暴露（§3.2） ───────────────────────────────

/** RUNTIME_WRITE_DISABLED 族分域 message（§6.2 冻结文案；单点实现——open 拒绝面与
 *  apply 拒绝面共用；插值仅闭集字面量（lifecycle 值 / DocHandleStatus 值））。 */
function writeDisabledMessage(
  kind: 'lifecycle' | 'fatal' | 'writable' | 'notifier',
  detail?: string,
): string {
  if (kind === 'lifecycle') {
    return `${RUNTIME_WRITE_DISABLED_CODE}: Runtime lifecycle 为 ${detail}——close 已停止接纳会话 apply；本调用零写入、输入零访问`;
  }
  if (kind === 'fatal') {
    return `${RUNTIME_WRITE_DISABLED_CODE}: fatal 已置位（internal fatal 已永久禁用本 Runtime 的全部写能力）——会话 apply 拒绝；本调用零写入`;
  }
  if (kind === 'writable') {
    return `${RUNTIME_WRITE_DISABLED_CODE}: DocHandle 状态 ${detail} 不可写（hub degraded 拒绝复制写；released/disposed 同拒）——本调用零写入`;
  }
  return `${RUNTIME_WRITE_DISABLED_CODE}: notifyDirty 未绑定——degraded bypass 亦不得绕过 dirty 登记；本调用零写入`;
}

/** apply 拒绝结果构造（code 参数以联合类型收窄——字面量经参数直通，零 as）。 */
function refusal(
  code: RuntimeReplicationSessionApplyRefusalCode,
  message: string,
): RuntimeReplicationSessionApplyResult {
  return { ok: false, code, message };
}

/**
 * 打开复制会话 core（全同步——Lease 层 check-then-set 原子性的依赖；零 await）。
 * 门序（冻结）：host 缺席（测试替身 Runtime/包版本错配）→ lifecycle≠ready →
 * fatal 已置位 → facts disabled → 通过则冻结 facts 建 core。
 * 【显式裁决，SA2 R1 #16】门序**不含 schemaState 检查**（preparing/unavailable 期
 * open 合法——有意行为：apply 与 active schema 无关（raw 无 VFSL 预校验，ADR 0010
 * L94），复制事实已在构造期 V2.5 预投影（#132：preparing 期 facts 已诚实）。
 * SA3 不得自行追加 schema gate。
 */
export function openReplicationSessionCoreForRegistry(
  runtime: NamespaceRuntime,
  options: RuntimeReplicationSessionOptions,
): RuntimeReplicationSessionOpenResult {
  const host = replicationHosts.get(runtime);
  if (host === undefined) {
    // 能力缺席显式拒绝——不静默降级、不猜默认（测试替身 Runtime 经 runtimeFactory
    // 注入时结构性无 host）
    return {
      ok: false,
      code: 'REPLICATION_SESSION_UNSUPPORTED',
      message: REPLICATION_SESSION_UNSUPPORTED_MESSAGE,
    };
  }
  const lifecycle = host.state.lifecycle;
  if (lifecycle !== 'ready') {
    return {
      ok: false,
      code: 'RUNTIME_WRITE_DISABLED',
      message: writeDisabledMessage('lifecycle', lifecycle),
    };
  }
  if (host.state.fatal !== undefined) {
    return {
      ok: false,
      code: 'RUNTIME_WRITE_DISABLED',
      message: writeDisabledMessage('fatal'),
    };
  }
  const facts = host.state.replication;
  if (facts.state === 'disabled') {
    // O-7 稳定拒绝（复用 #132 已冻结 message 族，零新词）：四域冻结（L81）前置要求
    // replicationId/epoch 存在，允许开将迫使 session 携带 undefined 谱系
    return { ok: false, code: 'REPLICATION_NOT_ENABLED', message: REPLICATION_NOT_ENABLED_MESSAGE };
  }
  return { ok: true, core: createSessionCore(host, options, facts) };
}
