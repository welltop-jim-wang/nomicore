/**
 * SA6 红灯测试 — AC5：纯包契约（issue #135）。
 *
 * 契约（issue AC 5）：包直接锁定 yjs / y-protocols / lib0，无 Cordis、WebSocket、Registry、
 * 或 Node server 依赖；不依赖 Node Buffer（运行时行为锚点）。
 * - manifest 断言（依赖边界，AC5 是 manifest 级验收）；
 * - Buffer-free 运行时断言（行为锚点：Buffer 全局不存在时 codec 照常工作，输出为纯 Uint8Array）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeFrame, decodeMessage, encodeFrame, encodeMessage, ENVELOPE_HEADER_BYTES } from '@nomicore/replication-protocol';
import { GOLDEN, hexToBytes } from './fixtures';

interface PkgManifest {
  name?: string;
  version?: string;
  type?: string;
  exports?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function loadManifest(): PkgManifest {
  const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  return JSON.parse(raw) as PkgManifest;
}

describe('AC5：包 manifest 直接锁定 yjs/y-protocols/lib0 且无 Cordis/WS/Registry/server 依赖', () => {
  it('package.json 存在 name=@nomicore/replication-protocol、exports["."]=./src/index.ts、type=module', () => {
    const pkg = loadManifest();
    expect(pkg.name).toBe('@nomicore/replication-protocol');
    expect(pkg.type).toBe('module');
    expect(pkg.exports?.['.']).toBe('./src/index.ts');
  });

  it('dependencies 直接声明 yjs、y-protocols、lib0（锁定兼容组合）', () => {
    const deps = loadManifest().dependencies ?? {};
    expect(deps.yjs, 'yjs 必须为显式直接依赖').toBeDefined();
    expect(deps['y-protocols'], 'y-protocols 必须为显式直接依赖').toBeDefined();
    expect(deps.lib0, 'lib0 必须为显式直接依赖').toBeDefined();
  });

  it('dependencies 不含 Cordis / WebSocket / Registry / server / buffer 依赖', () => {
    const deps = loadManifest().dependencies ?? {};
    const forbidden = /cordis|(^|\/)ws$|^ws$|@nomicore\/namespace-registry|@nomicore\/namespace-runtime|@nomicore\/doc-runtime|@nomicore\/persistence|^buffer$|node:buffer/i;
    const offenders = Object.keys(deps).filter((k) => forbidden.test(k));
    expect(offenders, '依赖中不得出现 cordis/ws/registry/server/buffer').toEqual([]);
  });
});

describe('AC5：运行时不依赖 Node Buffer（行为锚点）', () => {
  it('globalThis.Buffer 被遮蔽为 undefined 时，codec 全链路照常工作且输出纯 Uint8Array', () => {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'Buffer');
    expect(desc).toBeDefined();
    try {
      Object.defineProperty(globalThis, 'Buffer', { value: undefined, configurable: true, writable: true });
      expect((globalThis as { Buffer?: unknown }).Buffer).toBeUndefined();

      // golden 帧 encode 与 decode 全链路
      const frame = encodeFrame({ messageType: GOLDEN[0]!.messageType, sequence: GOLDEN[0]!.sequence, payload: hexToBytes(GOLDEN[0]!.payloadHex) });
      expect(Object.getPrototypeOf(frame)).toBe(Uint8Array.prototype);
      expect(Array.from(frame)).toEqual(Array.from(hexToBytes(GOLDEN[0]!.frameHex)));

      const decodedFrame = decodeFrame(frame);
      expect(Object.getPrototypeOf(decodedFrame.payload)).toBe(Uint8Array.prototype);

      const hello = encodeMessage(
        { kind: 'HELLO', peerInstanceId: 'peer-a', expectedHubInstanceId: 'hub-a', protocolVersions: [1], requiredCapabilities: 0, optionalCapabilities: 0, connectionNonce: Uint8Array.from({ length: 16 }) },
        { sequence: 1 },
      );
      const decoded = decodeMessage(hello);
      expect(decoded.message.kind).toBe('HELLO');
      expect(Object.getPrototypeOf(hello)).toBe(Uint8Array.prototype);
    } finally {
      Object.defineProperty(globalThis, 'Buffer', desc!);
    }
    expect(typeof Buffer).not.toBe('undefined'); // 环境恢复
  });

  it('encode/decode 全程不产出 Buffer 实例（原型恰为 Uint8Array）', () => {
    for (const g of GOLDEN) {
      const bytes = encodeMessage(g.message, { sequence: g.sequence });
      expect(Object.getPrototypeOf(bytes), g.name).toBe(Uint8Array.prototype);
      const decoded = decodeMessage(bytes);
      expect(decoded.header.envelopeVersion).toBe(1);
    }
    expect(ENVELOPE_HEADER_BYTES).toBe(20);
  });
});
