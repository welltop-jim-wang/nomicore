/**
 * `@nomicore/ws-replication/testing` —— §17 内存双端 transport（与 harness makeDuplex
 * 同形；供切片 7/8 与第三方 Host 复用；实现独立、零 harness 依赖）。
 */
import type { DuplexTransport } from './types.js';

interface EndState {
  listeners: Set<(bytes: Uint8Array) => void>;
  closeListeners: Set<(info: Readonly<{ code: number; reason: string }>) => void>;
  closed: boolean;
}

function makeEnd(self: EndState, peer: EndState): DuplexTransport {
  return {
    send(bytes) {
      if (self.closed) return;
      const copy = bytes.slice();
      queueMicrotask(() => {
        for (const listener of [...peer.listeners]) listener(copy);
      });
    },
    close(code = 1000, reason = '') {
      if (self.closed) return;
      self.closed = true;
      queueMicrotask(() => {
        for (const listener of [...peer.closeListeners]) listener({ code, reason });
      });
    },
    get closed() {
      return self.closed;
    },
    onMessage(listener) {
      self.listeners.add(listener);
      return () => {
        self.listeners.delete(listener);
      };
    },
    onClose(listener) {
      self.closeListeners.add(listener);
      return () => {
        self.closeListeners.delete(listener);
      };
    },
  };
}

/** 内存双端：一端 send → 对端 onMessage（微任务投递）；一端 close → 对端 onClose。 */
export function createMemoryDuplexTransport(): {
  readonly peer: DuplexTransport;
  readonly hub: DuplexTransport;
} {
  const peer: EndState = { listeners: new Set(), closeListeners: new Set(), closed: false };
  const hub: EndState = { listeners: new Set(), closeListeners: new Set(), closed: false };
  return { peer: makeEnd(peer, hub), hub: makeEnd(hub, peer) };
}
