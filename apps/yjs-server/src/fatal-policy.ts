/**
 * issue #288 / ADR 0018 §4–§5 —— standalone `@nomicore/yjs-server` 的
 * 「fatal 类 observer 事件 → 宿主动作」策略单点。
 *
 * ## 策略面（ADR 0018 §4 权威）
 *
 * `onFatalError: 'exit' | 'stay'`（缺省 `'exit'`）：
 * - `'exit'`：observer 适配器直通 NDJSON **之后**识别 fatal 类事件 → 有序停机
 *   （`app.stop()` 单一拆卸链：停止接纳 → 排空已接纳 apply → close）→ 经注入
 *   seam 非零退出。编排层（systemd/k8s）按既定策略重启；ADR 0018 §5 的 P0 不对称
 *   保证重启后停在「P0 结果失败、写禁用、读可用、复制照常」的降级态，不形成
 *   crashloop；
 * - `'stay'`：事件仅落 NDJSON，进程继续——供多 namespace 宿主自行编排（fatal 是
 *   namespace 粒度，不株连同进程其他 namespace）。
 *
 * ## fatal 类判据（本文件是唯一审计点）
 *
 * 判据语义 = 「**observer 事件无歧义断言 Runtime fatal 已置位**」（写永久禁用、读
 * 保留；进程内不可自愈；ADR 0008 §fatal 语义）。关键事实：replication observer
 * 24 型词汇中，**唯一**满足该判据的事件型是 `schema-rearm-failed`（issue #287
 * 专为「Runtime fatal 事实的观测投影」而设——协议 §23.1 第 24 型明文「事件是
 * 既有 runtime fatal 事实的观测投影」）。既有 `NSRT-FATAL-*` 族（ADR 0008）的
 * 宿主面是 `lease.getStatus()` fatal 摘要与控制动词回执（拉取/应答 seam），不在
 * observer 推送面上；`schema-rearm-failed` 是该语义进入 observer 面的第一型，
 * 本判据表是它（及未来同语义事件型）的登记点。
 *
 * 其余候选的排除根据（逐型审计；反例驱动——任一误收都会把**正常运维路径**误判
 * 为进程级 fatal）：
 *
 * | 事件 | 判定 | 排除根据 |
 * |---|---|---|
 * | `namespace-failed`（全 13 cause） | 非 fatal | observer 层**无法区分**
 *   「Runtime fatal 置位」与正常运维/可自愈终局：`apply-rejected` 在
 *   delete-namespace×活跃复制的既定运维路径上照常产生（hub 侧 'lease released'
 *   收口——issue #228 AD-7/R-2 契约锚「进程不崩」，回归 =
 *   `host-namespace-delete-under-replication.test.ts`）；timer 族三 cause 经
 *   namespace-recovery 重建自愈（issue #254）；`remote-error` 对端驱动、重连
 *   reconcile 修复；`open-failed`/`protocol-violation`/`apply-refused`/
 *   `send-failed`/`replication-disabled`/`session-missing` 属配置/协议/权限/
 *   生命周期类——重启不修复，`exit` 默认下误判即 crashloop |
 * | `connection-failed` | 非 fatal | peer 侧 backoff 重连自愈（重连守护是既定
 *   语义）；hub 侧是单客户端连接终局，不株连进程 |
 * | `schema-rearm-applied` 及其余 21 型 | 非 fatal | 迁移/计数/采样/成功类观测，
 *   无 fatal 语义 |
 *
 * crashloop 防护的不对称性（ADR 0018 §5）对 `schema-rearm-failed` 成立：restart
 * 后同一持久化事实在 P0 落入**结果失败**（「写禁用、读可用、复制照常」降级态），
 * 而非再次 fatal——进程级 exit+重启收敛，不形成退出-重启死循环。
 */
import type { ReplicationObserverEvent } from '@nomicore/ws-replication';

/** `onFatalError` 缺省值（ADR 0018 §4 明文：默认 `'exit'`）。 */
export const DEFAULT_ON_FATAL_ERROR = 'exit' as const;

/** fatal 策略字面量（config.ts `AppConfig.onFatalError` 的值域）。 */
export type OnFatalErrorPolicy = 'exit' | 'stay';

/**
 * fatal 类事件判定（纯函数；判据表见本文件头注释——唯一审计点）。
 *
 * 当前恰好等价于 `type === 'schema-rearm-failed'`；保持显式 switch 形态——未来
 * observer 词汇 append 新的「Runtime fatal 观测投影」型时在此登记（append-only
 * 纪律与协议 §23.1 同源）。
 */
export function isFatalObserverEvent(event: ReplicationObserverEvent): boolean {
  switch (event.type) {
    case 'schema-rearm-failed':
      return true;
    default:
      return false;
  }
}
