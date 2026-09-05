import { createHubReplication } from './hub-connection.js';
import type { NamespaceLease, NamespaceRegistry, ReplicationSession } from '@nomicore/namespace-registry';
import type { DuplexTransport, HubReplication, HubReplicationOptions } from './types.js';

interface EndState {
  listeners: Set<(bytes: Uint8Array) => void>;
  closeListeners: Set<(info: Readonly<{ code: number; reason: string }>) => void>;
  closed: boolean;
}
function makeEnd(self: EndState, peer: EndState): DuplexTransport {
  return {
    send(bytes) { if (!self.closed) { const copy = bytes.slice(); queueMicrotask(() => { for (const fn of [...peer.listeners]) fn(copy); }); } },
    close(code = 1000, reason = '') { if (!self.closed) { self.closed = true; queueMicrotask(() => { for (const fn of [...peer.closeListeners]) fn({ code, reason }); }); } },
    get closed() { return self.closed; },
    onMessage(fn) { self.listeners.add(fn); return () => self.listeners.delete(fn); },
    onClose(fn) { self.closeListeners.add(fn); return () => self.closeListeners.delete(fn); },
  };
}
export function createMemoryDuplexTransport(): { readonly peer: DuplexTransport; readonly hub: DuplexTransport } {
  const peer: EndState = { listeners: new Set(), closeListeners: new Set(), closed: false };
  const hub: EndState = { listeners: new Set(), closeListeners: new Set(), closed: false };
  return { peer: makeEnd(peer, hub), hub: makeEnd(hub, peer) };
}

export interface HubSessionCloseProbe {
  readonly sessionCloseCalls: ReadonlyMap<ReplicationSession, number>;
  readonly sessions: readonly ReplicationSession[];
}

function decorateLease(
  lease: NamespaceLease,
  probe: { sessions: ReplicationSession[]; counts: Map<ReplicationSession, number> },
  sessionCloseError?: Error,
): NamespaceLease {
  const open = lease.openReplicationSession.bind(lease);
  return Object.freeze({
    owner: lease.owner,
    namespaceId: lease.namespaceId,
    readData: lease.readData.bind(lease),
    getSchema: lease.getSchema.bind(lease),
    getMetadata: lease.getMetadata.bind(lease),
    getActiveSchema: lease.getActiveSchema.bind(lease),
    getStatus: lease.getStatus.bind(lease),
    mutateData: lease.mutateData.bind(lease),
    replaceSchema: lease.replaceSchema.bind(lease),
    enableReplication: lease.enableReplication.bind(lease),
    bumpReplicationEpoch: lease.bumpReplicationEpoch.bind(lease),
    openReplicationSession: async (options: Parameters<typeof open>[0]) => {
        const result = await open(options);
        if (!result.ok) return result;
        const session = result.session;
        probe.sessions.push(session);
        const close = session.close.bind(session);
        return {
          ok: true as const,
          session: Object.freeze({
            localRole: session.localRole,
            remoteInstanceId: session.remoteInstanceId,
            replicationId: session.replicationId,
            replicationEpoch: session.replicationEpoch,
            encodeStateVector: session.encodeStateVector.bind(session),
            encodeDiff: session.encodeDiff.bind(session),
            applyRemoteUpdate: session.applyRemoteUpdate.bind(session),
            subscribeOwnedUpdates: session.subscribeOwnedUpdates.bind(session),
            getStatus: session.getStatus.bind(session),
            close: async () => {
              probe.counts.set(session, (probe.counts.get(session) ?? 0) + 1);
              await close();
              if (sessionCloseError !== undefined) throw sessionCloseError;
            },
          }),
        };
      },
    release: lease.release.bind(lease),
    [Symbol.asyncDispose]: () => lease[Symbol.asyncDispose](),
  });
}

export function createHubReplicationForTesting(
  options: HubReplicationOptions,
  controls: Readonly<{ sessionCloseError?: Error }> = {},
): {
  readonly replication: HubReplication;
  readonly probe: HubSessionCloseProbe;
} {
  const sessions: ReplicationSession[] = [];
  const counts = new Map<ReplicationSession, number>();
  const source = options.registry;
  const registry = new Proxy({} as NamespaceRegistry, {
    get(_target, property) {
      if (property === 'open') return async (...args: Parameters<NamespaceRegistry['open']>) => {
        const result = await source.open(...args);
        return result.ok ? { ok: true as const, lease: decorateLease(result.lease, { sessions, counts }, controls.sessionCloseError) } : result;
      };
      const value = Reflect.get(source, property, source);
      return typeof value === 'function' ? value.bind(source) : value;
    },
  });
  return {
    replication: createHubReplication({ ...options, registry }),
    probe: { sessions, sessionCloseCalls: counts },
  };
}
