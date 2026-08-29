/**
 * `@nomicore/ws-replication` 公共入口（SA6 冻结契约面，§2；值 + 类型，零逻辑）。
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
  HubReplication,
  HubReplicationOptions,
  NamespaceAuthorization,
  NamespaceAuthorizer,
  PeerConnectionState,
  PeerNamespaceState,
  PeerReplication,
  PeerReplicationOptions,
  ReplicationBackoff,
  ReplicationLimits,
  ReplicationTarget,
  ReplicationTimer,
  ReplicationTimeouts,
  UpgradeIdentity,
} from './types.js';
