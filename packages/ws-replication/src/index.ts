/**
 * `@nomicore/ws-replication` 公共入口（公共契约面：值 + 类型，零逻辑；规范权威
 * protocol §17/§18 + ADR-0010 #161/#172 修订节）。
 */
export { createHubReplication } from './hub-connection.js';
export { createPeerReplication } from './peer-connection.js';
export {
  DEFAULT_REPLICATION_BACKOFF,
  DEFAULT_REPLICATION_LIMITS,
  DEFAULT_REPLICATION_TIMEOUTS,
} from './defaults.js';

export type {
  DuplexTransport,
  HubConnection,
  HubConnectionState,
  HubNamespaceState,
  HubReplication,
  HubReplicationOptions,
  HubUpgradeRequest,
  NamespaceAuthorization,
  NamespaceAuthorizer,
  PeerConnectionState,
  PeerNamespaceState,
  PeerReplication,
  PeerReplicationOptions,
  PeerTokenVerifier,
  ReplicationBackoff,
  ReplicationClock,
  ReplicationLimits,
  ReplicationObserver,
  ReplicationObserverConnectionCode,
  ReplicationObserverEvent,
  ReplicationObserverNamespaceCode,
  ReplicationObserverSide,
  ReplicationTarget,
  ReplicationTimer,
  ReplicationTimeouts,
  UpgradeIdentity,
} from './types.js';
