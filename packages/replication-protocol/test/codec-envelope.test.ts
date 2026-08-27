/**
 * SA6 红灯测试 — `@nomicore/replication-protocol` 固定 20-byte 大端 NMCR envelope（issue #135）。
 *
 * 契约：docs/protocols/instance-replication-v1.md §3（固定 envelope）+ §5（消息注册表）。
 * - 一条 WebSocket binary message 恰好承载一个完整 frame：byteLength === 20 + payloadLength。
 * - 全部整数 network byte order（big-endian）。
 * - 解码器检查顺序见 test/fixtures.ts 顶部契约注释；严格失败不忽略。
 *
 * 当前状态：包尚不存在（红灯）——本文件 import `@nomicore/replication-protocol` 即失败，
 * 且一旦包被实现即锚定此处全部行为契约。
 */
import { describe, expect, it } from 'vitest';
import {
  ENVELOPE_HEADER_BYTES,
  ENVELOPE_MAGIC,
  ENVELOPE_VERSION,
  type FrameHeader,
  ProtocolError,
  decodeFrame,
  encodeFrame,
} from '@nomicore/replication-protocol';
import {
  ENVELOPE_HEADER_BYTES as HEADER,
  ENVELOPE_MAGIC_HEX,
  bytesToHex,
  buildFrameHex,
  GOLDEN,
  hexToBytes,
} from './fixtures';

const HELLO = GOLDEN[0]!; // 基准 fixture：type 0x01, seq 1, payload 42 bytes

function expectProtocolError(fn: () => unknown, code: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught, `expected throw of ProtocolError(${code})`).toBeInstanceOf(ProtocolError);
  const err = caught as ProtocolError;
  expect(err.code).toBe(code);
}

describe('固定 envelope：20-byte 大端 NMCR 头（§3）', () => {
  it('导出固定常量：magic NMCR、envelopeVersion 1、头长 20', () => {
    expect(ENVELOPE_MAGIC).toBe('NMCR');
    expect(ENVELOPE_VERSION).toBe(1);
    expect(ENVELOPE_HEADER_BYTES).toBe(20);
  });

  it('encodeFrame 产出逐个 offset 正确的 20-byte 大端 header（HELLO golden）', () => {
    const bytes = encodeFrame({ messageType: 0x01, sequence: 1, payload: hexToBytes(HELLO.payloadHex) });
    expect(bytes.byteLength).toBe(HEADER + HELLO.payloadHex.length / 2);
    // offset 表（§3）：0 magic / 4 envelopeVersion / 5 messageType / 6 flags / 8 sequence / 12 payloadLength / 16 reserved
    expect(bytesToHex(bytes.slice(0, 4))).toBe('4e4d4352'); // magic 'NMCR'
    expect(bytes[4]).toBe(1); // envelopeVersion
    expect(bytes[5]).toBe(0x01); // messageType = HELLO
    expect(bytes[6]).toBe(0); // flags 高字节
    expect(bytes[7]).toBe(0); // flags 低字节
    expect(bytesToHex(bytes.slice(8, 12))).toBe('00000001'); // sequence BE
    expect(bytesToHex(bytes.slice(12, 16))).toBe('0000002a'); // payloadLength BE = 42
    expect(bytesToHex(bytes.slice(16, 20))).toBe('00000000'); // reserved
    expect(bytesToHex(bytes)).toBe(HELLO.frameHex); // 完整 golden 字节
  });

  it('encodeFrame 对 sequence/payloadLength 使用大端（对称暴露于 header 字段）', () => {
    const payload = new Uint8Array(300).fill(0xab);
    const bytes = encodeFrame({ messageType: 0x40, sequence: 0x01020304, payload });
    expect(bytesToHex(bytes.slice(8, 12))).toBe('01020304');
    expect(bytesToHex(bytes.slice(12, 16))).toBe('0000012c');
    expect(bytes.byteLength).toBe(20 + 300);
  });

  it('decodeFrame golden：返回 header 各字段 + 完整 payload（不复制截断）', () => {
    const decoded = decodeFrame(hexToBytes(HELLO.frameHex));
    expect(decoded.header).toEqual({
      envelopeVersion: 1,
      messageType: 0x01,
      flags: 0,
      sequence: 1,
      payloadLength: 42,
      reserved: 0,
    } satisfies FrameHeader);
    expect(bytesToHex(decoded.payload)).toBe(HELLO.payloadHex);
  });

  it('decodeFrame 按消息注册表验证 messageType（0x00/0x05/0x42 → UNSUPPORTED_MESSAGE_TYPE）', () => {
    for (const bad of [0x00, 0x05, 0x42]) {
      const bytes = hexToBytes(buildFrameHex(bad, 1, HELLO.payloadHex));
      expectProtocolError(() => decodeFrame(bytes), 'UNSUPPORTED_MESSAGE_TYPE');
    }
  });

  it('decodeFrame envelopeVersion != 1 → UNSUPPORTED_ENVELOPE_VERSION（0 与 2 均拒绝）', () => {
    const valid = hexToBytes(HELLO.frameHex);
    for (const version of [0, 2, 0xff]) {
      const bytes = valid.slice();
      bytes[4] = version;
      expectProtocolError(() => decodeFrame(bytes), 'UNSUPPORTED_ENVELOPE_VERSION');
    }
  });

  it('decodeFrame 非零 flags → UNSUPPORTED_FLAGS；非零 reserved → MALFORMED_FRAME', () => {
    const flags = hexToBytes(HELLO.frameHex);
    flags[6] = 0x01;
    expectProtocolError(() => decodeFrame(flags), 'UNSUPPORTED_FLAGS');

    const reserved = hexToBytes(HELLO.frameHex);
    reserved[19] = 0x01;
    expectProtocolError(() => decodeFrame(reserved), 'MALFORMED_FRAME');
  });

  it('decodeFrame magic 错误/缺失 → BAD_MAGIC（含 0/1/3 字节输入）', () => {
    expectProtocolError(() => decodeFrame(new Uint8Array(0)), 'BAD_MAGIC');
    expectProtocolError(() => decodeFrame(new Uint8Array([0x4e])), 'BAD_MAGIC');
    expectProtocolError(() => decodeFrame(new Uint8Array([0x4e, 0x4d, 0x43])), 'BAD_MAGIC');
    const wrong = hexToBytes(HELLO.frameHex);
    wrong[0] = 0x00;
    expectProtocolError(() => decodeFrame(wrong), 'BAD_MAGIC');
  });

  it('decodeFrame payloadLength 与 body 不一致：少一、多一、超大声明短 body → FRAME_LENGTH_MISMATCH', () => {
    const full = hexToBytes(HELLO.frameHex);
    // 声明 42，实际 41（截掉 payload 尾字节）
    expectProtocolError(() => decodeFrame(full.slice(0, full.length - 1)), 'FRAME_LENGTH_MISMATCH');
    // 声明 42，实际 43（追加尾随字节）
    const trailing = new Uint8Array(full.length + 1);
    trailing.set(full);
    trailing[full.length] = 0x00;
    expectProtocolError(() => decodeFrame(trailing), 'FRAME_LENGTH_MISMATCH');
    // 头声明 payloadLength = 0xffffffff（2^32-1），body 只有 5 字节：必须在复制/分配 payload 前拒绝
    const huge = hexToBytes(buildFrameHex(0x01, 1, 'ffffffff'));
    const hugeShort = new Uint8Array(20 + 5);
    hugeShort.set(huge.slice(0, 20));
    hugeShort.set([0x01, 0x02, 0x03, 0x04, 0x05], 20);
    expectProtocolError(() => decodeFrame(hugeShort), 'FRAME_LENGTH_MISMATCH');
    // 头声明 41，实际 42（后 20 字节内含一个多余字节于 payload 尾部）
    const shorter = hexToBytes(buildFrameHex(0x01, 1, HELLO.payloadHex.slice(0, -2)));
    const shorterBody = new Uint8Array(20 + 41 + 1);
    shorterBody.set(shorter.slice(0, 20));
    shorterBody.set(hexToBytes(HELLO.payloadHex), 20);
    expectProtocolError(() => decodeFrame(shorterBody), 'FRAME_LENGTH_MISMATCH');
  });

  it('decodeFrame maxFrameBytes：超限 → FRAME_TOO_LARGE（null 边界通过）', () => {
    const full = hexToBytes(HELLO.frameHex);
    expect(decodeFrame(full, { maxFrameBytes: full.byteLength }).header.messageType).toBe(0x01);
    expectProtocolError(
      () => decodeFrame(full, { maxFrameBytes: full.byteLength - 1 }),
      'FRAME_TOO_LARGE',
    );
  });

  it('decodeFrame expectedSequence：匹配通过，gap/repeat → SEQUENCE_VIOLATION', () => {
    const full = hexToBytes(HELLO.frameHex);
    expect(decodeFrame(full, { expectedSequence: 1 }).header.sequence).toBe(1);
    expectProtocolError(() => decodeFrame(full, { expectedSequence: 2 }), 'SEQUENCE_VIOLATION');
    // 两帧相同 sequence（repeat）→ 第二帧被拒
    expectProtocolError(() => decodeFrame(full, { expectedSequence: 0 }), 'SEQUENCE_VIOLATION');
  });

  it('encodeFrame 拒绝未注册 messageType（0x05）与超过 maxFrameBytes 的 payload', () => {
    expectProtocolError(
      () => encodeFrame({ messageType: 0x05, sequence: 1, payload: new Uint8Array(0) }),
      'UNSUPPORTED_MESSAGE_TYPE',
    );
    expectProtocolError(
      () =>
        encodeFrame(
          { messageType: 0x40, sequence: 1, payload: new Uint8Array(1000) },
          { maxFrameBytes: 100 },
        ),
      'FRAME_TOO_LARGE',
    );
  });

  it('一条 WS binary message 恰好一个完整 frame：无二义（encode 输出 byteLength === 20 + payloadLength）', () => {
    for (const g of GOLDEN) {
      const bytes = encodeFrame({ messageType: g.messageType, sequence: g.sequence, payload: hexToBytes(g.payloadHex) });
      expect(bytes.byteLength).toBe(20 + g.payloadHex.length / 2);
    }
  });
});
