/**
 * SA6 红灯测试 — fuzz / property（issue #135）。
 *
 * 契约：docs/protocols/instance-replication-v1.md §22（fuzz/property：decoder 不得越界分配、
 * 不得抛出未分类异常）+ §4（canonical、完全消费）。
 * 不变量（固定种子，可复现）：
 * 1. 任意字节输入 → decodeFrame 要么成功（此时 re-encode 必须逐字节还原 = canonical），
 *    要么抛出 ProtocolError 且 code ∈ 注册表（绝不抛 RangeError/TypeError 等未分类异常）；
 * 2. decodeMessage 同样只抛注册表分类错误；成功路径 canonical；
 * 3. 任意合法值消息 → encode/decode roundtrip 字段一致；
 * 4. 对 golden 帧单字节变异 → 只允许成功（且 canonical）或注册表分类错误。
 */
import { describe, expect, it } from 'vitest';
import {
  CONNECTION_ERRORS,
  NAMESPACE_ERRORS,
  ProtocolError,
  decodeFrame,
  decodeMessage,
  encodeFrame,
  encodeMessage,
} from '@nomicore/replication-protocol';
import { GOLDEN, hexToBytes } from './fixtures';

/** mulberry32 — 固定种子确定性 PRNG */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALL_ERROR_CODES = new Set([...Object.keys(CONNECTION_ERRORS), ...Object.keys(NAMESPACE_ERRORS)]);

describe('fuzz：随机字节输入（固定种子，确定性复现）', () => {
  it('800 个随机输入：成功即 canonical 可还原；失败即注册表分类错误（decodeFrame）', () => {
    const rand = mulberry32(0x1357);
    for (let i = 0; i <800; i++) {
      const len = Math.floor(rand() * 140);
      const bytes = new Uint8Array(len);
      for (let j = 0; j < len; j++) bytes[j] = Math.floor(rand() * 256);

      let frame: ReturnType<typeof decodeFrame> | null = null;
      try {
        frame = decodeFrame(bytes, { maxFrameBytes: 4096 });
      } catch (e) {
        expect(e).toBeInstanceOf(ProtocolError);
        const err = e as ProtocolError;
        expect(ALL_ERROR_CODES.has(err.code), `迭代 ${i}: 未注册错误码 ${err.code}`).toBe(true);
      }
      if (frame) {
        // canonical：可解码输入再编码必须逐字节还原
        const re = encodeFrame({
          messageType: frame.header.messageType,
          sequence: frame.header.sequence,
          payload: frame.payload,
        });
        expect(Array.from(re), `迭代 ${i}: 非 canonical`).toEqual(Array.from(bytes));
      }
    }
  });

  it('800 个随机输入：decodeMessage 绝不抛未分类异常（成功或注册表分类错误）', () => {
    const rand = mulberry32(0x2468);
    for (let i = 0; i < 800; i++) {
      const len = Math.floor(rand() * 140);
      const bytes = new Uint8Array(len);
      for (let j = 0; j < len; j++) bytes[j] = Math.floor(rand() * 256);
      let decoded: ReturnType<typeof decodeMessage> | null = null;
      try {
        decoded = decodeMessage(bytes, { maxFrameBytes: 4096 });
      } catch (e) {
        expect(e).toBeInstanceOf(ProtocolError);
        const err = e as ProtocolError;
        expect(ALL_ERROR_CODES.has(err.code), `迭代 ${i}: 未注册错误码 ${err.code}`).toBe(true);
      }
      if (decoded) {
        // 成功路径：随机但完整合法的帧 → re-encode 逐字节还原
        const re = encodeMessage(decoded.message, { sequence: decoded.header.sequence });
        expect(Array.from(re), `迭代 ${i}: 成功路径非 canonical`).toEqual(Array.from(bytes));
      }
    }
  });
});

describe('property：seeded 随机合法消息 roundtrip', () => {
  const NS = 'ns-0123456789abcdef0123456789abcdef';
  const RID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const SYNC_CODES = ['SYNC_STATE_VIOLATION', 'UPDATE_TOO_LARGE', 'BOOTSTRAP_TOO_LARGE'];

  function randomMessage(rand: () => number): Record<string, unknown> {
    const pick = Math.floor(rand() * 19);
    const randomBytes = () => Uint8Array.from({ length: Math.floor(rand() * 64) }, () => Math.floor(rand() * 256));
    // §6.1：connectionNonce 固定 16 字节（HELLO/HELLO_ACK 不得用 randomBytes 生成长度）
    const fixedNonce = () => Uint8Array.from({ length: 16 }, (_, i) => i);
    switch (pick) {
      case 0:
        return { kind: 'HELLO', peerInstanceId: 'peer-a', expectedHubInstanceId: 'hub-a', protocolVersions: [3, 2, 1], requiredCapabilities: 0, optionalCapabilities: 0, connectionNonce: fixedNonce() };
      case 1:
        return { kind: 'HELLO_ACK', hubInstanceId: 'hub-a', protocolVersion: 1, selectedCapabilities: 0, connectionNonce: fixedNonce(), connectionId: 'c' };
      case 2:
        return { kind: 'GOAWAY', reasonCode: 'SERVER_RESTARTING', drainTimeoutMs: Math.floor(rand() * 100000) };
      case 3:
        return { kind: 'ERROR', code: 'HELLO_TIMEOUT', safeMessage: 'timeout' };
      case 4:
        return { kind: 'ERROR', code: SYNC_CODES[Math.floor(rand() * SYNC_CODES.length)], namespaceId: NS, safeMessage: 'x' };
      case 5:
        return { kind: 'OPEN_NAMESPACE', namespaceId: NS, hasLocalReplica: true, replicationId: RID, replicationEpoch: 1 };
      case 6:
        return { kind: 'OPEN_NAMESPACE', namespaceId: NS, hasLocalReplica: false };
      case 7:
        return { kind: 'OPEN_OK', namespaceId: NS, mode: 1, replicationId: RID, replicationEpoch: 2 };
      case 8:
        return { kind: 'CLOSE_NAMESPACE', namespaceId: NS, reasonCode: 'USER_REMOVED' };
      case 9:
        return { kind: 'CLOSE_OK', namespaceId: NS, ackedSequence: Math.floor(rand() * 1000) };
      case 10:
        return { kind: 'BOOTSTRAP_SNAPSHOT', namespaceId: NS, replicationId: RID, replicationEpoch: 1, snapshot: randomBytes() };
      case 11:
        return { kind: 'BOOTSTRAP_ACK', namespaceId: NS, ackedSequence: 4 };
      case 12:
        return { kind: 'IDENTITY_CHANGED', namespaceId: NS, replicationId: RID, replicationEpoch: 3 };
      case 13:
        return { kind: 'SYNC_STEP1', namespaceId: NS, syncRoundId: 1, stateVector: randomBytes() };
      case 14:
        return { kind: 'SYNC_STEP2', namespaceId: NS, syncRoundId: 1, relatedStep1Sequence: 2, update: randomBytes() };
      case 15:
        return { kind: 'SYNC_APPLIED', namespaceId: NS, syncRoundId: 1, ackedSequence: 3 };
      case 16:
        return { kind: 'RESYNC_REQUIRED', namespaceId: NS, reasonCode: 'ACK_TIMEOUT' };
      case 17:
        return { kind: 'UPDATE', namespaceId: NS, update: randomBytes() };
      default:
        return { kind: 'UPDATE_ACK', namespaceId: NS, ackedSequence: Math.floor(rand() * 1000) };
    }
  }

  it('300 个 seeded 合法消息：encode → decode → 字段一致', () => {
    const rand = mulberry32(0x99aa);
    for (let i = 0; i < 300; i++) {
      const msg = randomMessage(rand);
      const bytes = encodeMessage(msg as never, { sequence: 1 });
      const decoded = decodeMessage(bytes);
      const actual = decoded.message as unknown as Record<string, unknown>;
      expect(actual.kind, `迭代 ${i}`).toBe(msg.kind);
      for (const [k, v] of Object.entries(msg)) {
        if (v instanceof Uint8Array) {
          expect(Array.from(actual[k] as Uint8Array), `迭代 ${i} 字段 ${k}`).toEqual(Array.from(v));
        } else {
          expect(actual[k], `迭代 ${i} 字段 ${k}`).toEqual(v);
        }
      }
      expect(decoded.header.sequence).toBe(1);
    }
  });

  it('防回归（SA2 攻击点 #1）：mulberry32(0x99aa) 全 300 轮中每次 HELLO/HELLO_ACK 的 connectionNonce 恒为 16 字节（§6.1）', () => {
    // 生成器的 nonce 禁止使用随机长度 randomBytes()（否则与 codec-malformed 侧
    // 「nonce 15/17 必拒」互斥：任何实现二选一必挂另一侧）。
    const rand = mulberry32(0x99aa);
    let helloDrawn = 0;
    for (let i = 0; i < 300; i++) {
      const msg = randomMessage(rand);
      if (msg.kind === 'HELLO' || msg.kind === 'HELLO_ACK') {
        helloDrawn++;
        expect(msg.connectionNonce, `迭代 ${i} ${msg.kind}`).toBeInstanceOf(Uint8Array);
        expect((msg.connectionNonce as Uint8Array).byteLength, `迭代 ${i} ${msg.kind}`).toBe(16);
      }
    }
    expect(helloDrawn).toBeGreaterThan(0); // 生成器确实产出了 HELLO/HELLO_ACK 样本
  });
});

describe('property：golden 帧单字节变异（不含截断）', () => {
  it('每个 golden 的每个 offset 变异一字节 → 成功（canonical 还原）或注册表分类错误', () => {
    for (const g of GOLDEN) {
      const bytes = hexToBytes(g.frameHex);
      for (let offset = 0; offset < bytes.byteLength; offset++) {
        const mutated = bytes.slice();
        mutated[offset] = mutated[offset]! ^ 0xff;
        let frame: ReturnType<typeof decodeFrame> | null = null;
        try {
          frame = decodeFrame(mutated, { maxFrameBytes: 65536 });
        } catch (e) {
          expect(e).toBeInstanceOf(ProtocolError);
          expect(ALL_ERROR_CODES.has((e as ProtocolError).code), `${g.name}@${offset}`).toBe(true);
        }
        if (frame) {
          const re = encodeFrame({
            messageType: frame.header.messageType,
            sequence: frame.header.sequence,
            payload: frame.payload,
          });
          expect(Array.from(re), `${g.name}@${offset} 非 canonical`).toEqual(Array.from(mutated));
        }
      }
    }
  });
});
