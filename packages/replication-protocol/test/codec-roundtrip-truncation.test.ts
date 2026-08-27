/**
 * SA6 红灯测试 — canonial roundtrip + 每个 byte offset 截断（issue #135）。
 *
 * 契约：docs/protocols/instance-replication-v1.md §4（canonical、完全消费 payload）+
 * §22（canonical roundtrip、每 offset 截断、trailing bytes）。
 * 截断分类遵循 fixtures.ts 顶部固定检查顺序：< 4 字节 → BAD_MAGIC；其余 → FRAME_LENGTH_MISMATCH。
 */
import { describe, expect, it } from 'vitest';
import {
  type DecodedMessage,
  ProtocolError,
  decodeMessage,
  encodeMessage,
} from '@nomicore/replication-protocol';
import { GOLDEN, buildFrameHex, hexToBytes } from './fixtures';

function expectProtocolError(fn: () => unknown, code: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(ProtocolError);
  expect((caught as ProtocolError).code).toBe(code);
}

describe('canonical encode/decode roundtrip（§22）', () => {
  it('全部 17 种消息：encode(decode(bytes)) === bytes（逐字节 canonical，含 header）', () => {
    for (const g of GOLDEN) {
      const bytes = hexToBytes(g.frameHex);
      const decoded = decodeMessage(bytes);
      expect(decoded.header.messageType).toBe(g.messageType);
      expect(decoded.header.sequence).toBe(g.sequence);
      expect(decoded.header.flags).toBe(0);
      expect(decoded.header.reserved).toBe(0);
      expect(decoded.header.envelopeVersion).toBe(1);
      expect(decoded.header.payloadLength).toBe(g.payloadHex.length / 2);
      const reencoded = encodeMessage(decoded.message, { sequence: decoded.header.sequence });
      expect(Array.from(reencoded), `${g.name} canonical roundtrip`).toEqual(Array.from(bytes));
    }
  });

  it('解码后字段与 fixture 消息完全一致（全部 17 种）', () => {
    for (const g of GOLDEN) {
      const decoded = decodeMessage(hexToBytes(g.frameHex));
      expect(decoded.message).toEqual(g.message);
    }
  });

  it('空 body 字段形态：空 update / 空 stateVector / 空 snapshot 均可 roundtrip', () => {
    const emptyUpdate = { kind: 'UPDATE' as const, namespaceId: 'ns-0123456789abcdef0123456789abcdef', update: new Uint8Array(0) };
    const d1: DecodedMessage = decodeMessage(encodeMessage(emptyUpdate, { sequence: 1 }));
    expect(d1.message).toEqual(emptyUpdate);

    const emptySv = { kind: 'SYNC_STEP1' as const, namespaceId: 'ns-0123456789abcdef0123456789abcdef', syncRoundId: 1, stateVector: new Uint8Array(0) };
    const d2 = decodeMessage(encodeMessage(emptySv, { sequence: 1 }));
    expect(d2.message).toEqual(emptySv);

    const emptySnap = { kind: 'BOOTSTRAP_SNAPSHOT' as const, namespaceId: 'ns-0123456789abcdef0123456789abcdef', replicationId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', replicationEpoch: 1, snapshot: new Uint8Array(0) };
    const d3 = decodeMessage(encodeMessage(emptySnap, { sequence: 1 }));
    expect(d3.message).toEqual(emptySnap);
  });

  it('seq 为 0xffffffff 的 uint32 边界 roundtrip（不回绕由状态层负责，codec 须可承载）', () => {
    const bytes = encodeMessage({ kind: 'UPDATE_ACK' as const, namespaceId: 'ns-0123456789abcdef0123456789abcdef', ackedSequence: 0xffffffff }, { sequence: 0xffffffff });
    const d = decodeMessage(bytes);
    expect(d.header.sequence).toBe(0xffffffff);
  });
});

describe('每个 byte offset 截断（§22）：全部 17 种消息逐 offset', () => {
  it('任意 offset 截断都被分类拒绝（0–3 → BAD_MAGIC，其余 → FRAME_LENGTH_MISMATCH），绝不静默接受', () => {
    for (const g of GOLDEN) {
      const bytes = hexToBytes(g.frameHex);
      for (let i = 0; i < bytes.byteLength; i++) {
        const truncated = bytes.slice(0, i);
        const expectedCode = i < 4 ? 'BAD_MAGIC' : 'FRAME_LENGTH_MISMATCH';
        expectProtocolError(() => decodeMessage(truncated), expectedCode);
      }
    }
  });

  it('decodeMessage 对截断输入同样先于 payload 复制即失败（不抛未分类异常）', () => {
    for (const g of GOLDEN) {
      const bytes = hexToBytes(g.frameHex);
      for (let i = 0; i < bytes.byteLength; i += 3) {
        const truncated = bytes.slice(0, i);
        let caught: unknown = null;
        try {
          decodeMessage(truncated);
        } catch (e) {
          caught = e;
        }
        expect(caught).toBeInstanceOf(ProtocolError);
      }
    }
  });
});

describe('trailing bytes（§22）', () => {
  it('frame 级：任何尾随字节 → FRAME_LENGTH_MISMATCH（一 message 恰一 frame）', () => {
    const bytes = hexToBytes(GOLDEN[0]!.frameHex);
    const trailing = new Uint8Array(bytes.byteLength + 1);
    trailing.set(bytes);
    trailing[bytes.byteLength] = 0x00;
    expectProtocolError(() => decodeMessage(trailing), 'FRAME_LENGTH_MISMATCH');
  });

  it('payload 级：声明长度内的未消费尾随字节 → MALFORMED_FRAME（完全消费原则）', () => {
    // CLOSE_OK payload = varString(ns) + varUint(acked)。追加两个未声明字节并保持 header 长度一致：
    const g = GOLDEN.find((f) => f.name === 'CLOSE_OK')!;
    const extraPayload = g.payloadHex + '0a0b'; // 尾随两个未声明字节
    const frame = hexToBytes(buildFrameHex(0x13, 9, extraPayload));
    expectProtocolError(() => decodeMessage(frame), 'MALFORMED_FRAME');
  });
});
