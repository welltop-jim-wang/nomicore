/**
 * SA6 红灯测试 — 全部 v1 消息 payload 的 byte-level golden vectors（issue #135）。
 *
 * 契约：docs/protocols/instance-replication-v1.md §5 消息注册表 + §6–§13 字段顺序 + §4 lib0 canonical。
 * 每个 golden 的 payload 十六进制 = lib0 canonical 编码（与 lockfile lib0@0.2.117 行为核对），
 * 字段顺序逐条取自规范表格，为「规范不因库的偶然编码而变」的固化锚点。
 *
 * ERROR 的 golden 同时锚定 AC4「错误元数据由 append-only 注册表导出」：
 * wire 上的 fatal/retryable 位由 code 注册表推导，调用方不可传入覆盖。
 */
import { describe, expect, it } from 'vitest';
import {
  type DecodedMessage,
  ProtocolError,
  decodeMessage,
  encodeMessage,
} from '@nomicore/replication-protocol';
import {
  ERROR_CONN,
  ERROR_NS,
  GOLDEN,
  hexToBytes,
  OPEN_NAMESPACE,
} from './fixtures';

const GOLDEN_BY_NAME = new Map(GOLDEN.map((g) => [g.name, g]));

function decodeGolden(name: string): DecodedMessage {
  const g = GOLDEN_BY_NAME.get(name);
  if (!g) throw new Error(`unknown golden ${name}`);
  const decoded = decodeMessage(hexToBytes(g.frameHex));
  expect(decoded.header.sequence).toBe(g.sequence);
  expect(decoded.header.messageType).toBe(g.messageType);
  expect(decoded.header.payloadLength).toBe(g.payloadHex.length / 2);
  return decoded;
}

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

describe('全部 v1 消息 payload 的 byte-level golden vectors（§5–§13）', () => {
  it('注册表恰好 17 个 v1 消息，每种的 encodeMessage 输出与 golden frame 逐字节一致', () => {
    expect(GOLDEN).toHaveLength(18);
    for (const g of GOLDEN) {
      const bytes = encodeMessage(g.message, { sequence: g.sequence });
      const hex = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      expect(hex, `${g.name} golden`).toBe(g.frameHex);
    }
  });

  it('HELLO — 字段顺序: instanceIds → protocolVersions → caps → nonce', () => {
    const d = decodeGolden('HELLO');
    expect(d.message.kind).toBe('HELLO');
    if (d.message.kind !== 'HELLO') return;
    expect(d.message.peerInstanceId).toBe('peer-a');
    expect(d.message.expectedHubInstanceId).toBe('hub-a');
    expect(d.message.protocolVersions).toEqual([3, 2, 1]); // 降序、无重复、至少一个
    expect(d.message.requiredCapabilities).toBe(0);
    expect(d.message.optionalCapabilities).toBe(0);
    expect(Array.from(d.message.connectionNonce)).toEqual(Array.from({ length: 16 }, (_, i) => i));
  });

  it('HELLO_ACK — 字段顺序: hubInstanceId → protocolVersion → selectedCapabilities → nonce → connectionId', () => {
    const d = decodeGolden('HELLO_ACK');
    expect(d.message.kind).toBe('HELLO_ACK');
    if (d.message.kind !== 'HELLO_ACK') return;
    expect(d.message.hubInstanceId).toBe('hub-a');
    expect(d.message.protocolVersion).toBe(2);
    expect(d.message.selectedCapabilities).toBe(0);
    expect(d.message.connectionId).toBe('conn-1');
  });

  it('GOAWAY — reasonCode → drainTimeoutMs → retryAfterMs(optional)', () => {
    const d = decodeGolden('GOAWAY');
    expect(d.message.kind).toBe('GOAWAY');
    if (d.message.kind !== 'GOAWAY') return;
    expect(d.message.reasonCode).toBe('SERVER_RESTARTING');
    expect(d.message.drainTimeoutMs).toBe(5000);
    expect(d.message.retryAfterMs).toBe(2000);
  });

  it('ERROR(connection) — scope/code/fatal/retryable 由注册表导出并写入 wire', () => {
    const d = decodeGolden('ERROR_CONN');
    expect(d.message.kind).toBe('ERROR');
    if (d.message.kind !== 'ERROR') return;
    expect(d.message.code).toBe('BAD_MAGIC');
    expect(d.message.relatedSequence).toBe(7);
    expect(d.message.namespaceId).toBeUndefined();
    expect(d.message.safeMessage).toBe('bad magic');
    // golden payload 里 scope=00(fatal 位 01/retryable 位 00) 与 §13.1 BAD_MAGIC 注册表一致
    expect(GOLDEN_BY_NAME.get('ERROR_CONN')!.payloadHex.startsWith('00094241445f4d414749430100')).toBe(true);
    // encode 只接受 code，fatal/retryable 推导自注册表 —— 重新 encode 必须复现 golden
    const re = encodeMessage({ kind: 'ERROR', code: 'BAD_MAGIC', relatedSequence: 7, safeMessage: 'bad magic' }, { sequence: 4 });
    expect(Array.from(re).map((b) => b.toString(16).padStart(2, '0')).join('')).toBe(
      GOLDEN_BY_NAME.get('ERROR_CONN')!.frameHex,
    );
  });

  it('ERROR(namespace) — namespace scope 必有 namespaceId 字段', () => {
    const d = decodeGolden('ERROR_NS');
    expect(d.message.kind).toBe('ERROR');
    if (d.message.kind !== 'ERROR') return;
    expect(d.message.code).toBe('SYNC_STATE_VIOLATION');
    expect(d.message.relatedSequence).toBe(12);
    expect(d.message.namespaceId).toBe('ns-0123456789abcdef0123456789abcdef');
    expect(d.message.safeMessage).toBe('sync violation');
  });

  it('OPEN_NAMESPACE — ns → hasLocalReplica → 两个 identity 同时出现', () => {
    const d = decodeGolden('OPEN_NAMESPACE');
    expect(d.message.kind).toBe('OPEN_NAMESPACE');
    if (d.message.kind !== 'OPEN_NAMESPACE') return;
    expect(d.message.namespaceId).toBe('ns-0123456789abcdef0123456789abcdef');
    expect(d.message.hasLocalReplica).toBe(true);
    expect(d.message.replicationId).toBe('a1b2c3d4e5f60718293a4b5c6d7e8f90');
    expect(d.message.replicationEpoch).toBe(1);
  });

  it('OPEN_OK — ns → mode → replicationId → replicationEpoch', () => {
    const d = decodeGolden('OPEN_OK');
    expect(d.message.kind).toBe('OPEN_OK');
    if (d.message.kind !== 'OPEN_OK') return;
    expect(d.message.namespaceId).toBe('ns-0123456789abcdef0123456789abcdef');
    expect(d.message.mode).toBe(1);
    expect(d.message.replicationId).toBe('a1b2c3d4e5f60718293a4b5c6d7e8f90');
    expect(d.message.replicationEpoch).toBe(1);
  });

  it('CLOSE_NAMESPACE — ns → reasonCode', () => {
    const d = decodeGolden('CLOSE_NAMESPACE');
    expect(d.message.kind).toBe('CLOSE_NAMESPACE');
    if (d.message.kind !== 'CLOSE_NAMESPACE') return;
    expect(d.message.namespaceId).toBe('ns-0123456789abcdef0123456789abcdef');
    expect(d.message.reasonCode).toBe('USER_REMOVED');
  });

  it('CLOSE_OK — ns → ackedSequence', () => {
    const d = decodeGolden('CLOSE_OK');
    expect(d.message.kind).toBe('CLOSE_OK');
    if (d.message.kind !== 'CLOSE_OK') return;
    expect(d.message.namespaceId).toBe('ns-0123456789abcdef0123456789abcdef');
    expect(d.message.ackedSequence).toBe(9);
  });

  it('BOOTSTRAP_SNAPSHOT — ns → replicationId → epoch → snapshot(varUint8Array)', () => {
    const d = decodeGolden('BOOTSTRAP_SNAPSHOT');
    expect(d.message.kind).toBe('BOOTSTRAP_SNAPSHOT');
    if (d.message.kind !== 'BOOTSTRAP_SNAPSHOT') return;
    expect(d.message.namespaceId).toBe('ns-0123456789abcdef0123456789abcdef');
    expect(d.message.replicationId).toBe('a1b2c3d4e5f60718293a4b5c6d7e8f90');
    expect(d.message.replicationEpoch).toBe(1);
    expect(Array.from(d.message.snapshot)).toEqual([0, 1, 2, 3]);
  });

  it('BOOTSTRAP_ACK — ns → ackedSequence', () => {
    const d = decodeGolden('BOOTSTRAP_ACK');
    expect(d.message.kind).toBe('BOOTSTRAP_ACK');
    if (d.message.kind !== 'BOOTSTRAP_ACK') return;
    expect(d.message.namespaceId).toBe('ns-0123456789abcdef0123456789abcdef');
    expect(d.message.ackedSequence).toBe(4);
  });

  it('IDENTITY_CHANGED — ns → 新 replicationId → 新 epoch', () => {
    const d = decodeGolden('IDENTITY_CHANGED');
    expect(d.message.kind).toBe('IDENTITY_CHANGED');
    if (d.message.kind !== 'IDENTITY_CHANGED') return;
    expect(d.message.namespaceId).toBe('ns-0123456789abcdef0123456789abcdef');
    expect(d.message.replicationId).toBe('0123456789abcdef0123456789abcdef');
    expect(d.message.replicationEpoch).toBe(2);
  });

  it('SYNC_STEP1 — ns → syncRoundId → stateVector', () => {
    const d = decodeGolden('SYNC_STEP1');
    expect(d.message.kind).toBe('SYNC_STEP1');
    if (d.message.kind !== 'SYNC_STEP1') return;
    expect(d.message.namespaceId).toBe('ns-0123456789abcdef0123456789abcdef');
    expect(d.message.syncRoundId).toBe(1);
    expect(Array.from(d.message.stateVector)).toEqual([0x00]);
  });

  it('SYNC_STEP2 — ns → syncRoundId → relatedStep1Sequence → update', () => {
    const d = decodeGolden('SYNC_STEP2');
    expect(d.message.kind).toBe('SYNC_STEP2');
    if (d.message.kind !== 'SYNC_STEP2') return;
    expect(d.message.namespaceId).toBe('ns-0123456789abcdef0123456789abcdef');
    expect(d.message.syncRoundId).toBe(1);
    expect(d.message.relatedStep1Sequence).toBe(2);
    expect(Array.from(d.message.update)).toEqual([1, 2, 3]);
  });

  it('SYNC_APPLIED — ns → syncRoundId → ackedSequence(Step2 的 seq)', () => {
    const d = decodeGolden('SYNC_APPLIED');
    expect(d.message.kind).toBe('SYNC_APPLIED');
    if (d.message.kind !== 'SYNC_APPLIED') return;
    expect(d.message.namespaceId).toBe('ns-0123456789abcdef0123456789abcdef');
    expect(d.message.syncRoundId).toBe(1);
    expect(d.message.ackedSequence).toBe(3);
  });

  it('RESYNC_REQUIRED — ns → reasonCode', () => {
    const d = decodeGolden('RESYNC_REQUIRED');
    expect(d.message.kind).toBe('RESYNC_REQUIRED');
    if (d.message.kind !== 'RESYNC_REQUIRED') return;
    expect(d.message.namespaceId).toBe('ns-0123456789abcdef0123456789abcdef');
    expect(d.message.reasonCode).toBe('ACK_TIMEOUT');
  });

  it('UPDATE — ns → update(varUint8Array)', () => {
    const d = decodeGolden('UPDATE');
    expect(d.message.kind).toBe('UPDATE');
    if (d.message.kind !== 'UPDATE') return;
    expect(d.message.namespaceId).toBe('ns-0123456789abcdef0123456789abcdef');
    expect(Array.from(d.message.update)).toEqual([4, 5, 6]);
  });

  it('UPDATE_ACK — ns → ackedSequence', () => {
    const d = decodeGolden('UPDATE_ACK');
    expect(d.message.kind).toBe('UPDATE_ACK');
    if (d.message.kind !== 'UPDATE_ACK') return;
    expect(d.message.namespaceId).toBe('ns-0123456789abcdef0123456789abcdef');
    expect(d.message.ackedSequence).toBe(6);
  });

  it('encodeMessage 用注册表推导 ERROR 元数据：调用方无法覆盖 fatal/retryable', () => {
    // BAD_MAGIC: fatal=true, retryable='no' → wire bits 01/00
    const bytes = encodeMessage({ kind: 'ERROR', code: 'BAD_MAGIC', safeMessage: 'x' }, { sequence: 1 });
    const payloadHex = Array.from(bytes.slice(20)).map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(payloadHex.startsWith('00094241445f4d414749430100')).toBe(true); // scope 00 + code + fatal 01 + retryable 00
    // ACK_TIMEOUT: fatal=false, retryable='resync' → wire bits 00/01
    const ackTimeout = encodeMessage({ kind: 'ERROR', code: 'ACK_TIMEOUT', namespaceId: 'ns-0123456789abcdef0123456789abcdef', safeMessage: 'x' }, { sequence: 1 });
    const ackHex = Array.from(ackTimeout.slice(20)).map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(ackHex.startsWith('010b41434b5f54494d454f55540001')).toBe(true);
  });

  it('encodeMessage 拒绝 namespace-scope ERROR 缺 namespaceId / 未知 code', () => {
    expectProtocolError(
      () => encodeMessage({ kind: 'ERROR', code: 'SYNC_STATE_VIOLATION', safeMessage: 'x' }),
      'MALFORMED_FRAME',
    );
    expectProtocolError(
      () => encodeMessage({ kind: 'ERROR', code: 'NO_SUCH_CODE', safeMessage: 'x' }),
      'MALFORMED_FRAME',
    );
  });

  it('OPEN_NAMESPACE 无本地副本的合法形态（identity 成对省略）可 roundtrip', () => {
    const msg = { kind: 'OPEN_NAMESPACE' as const, namespaceId: 'ns-0123456789abcdef0123456789abcdef', hasLocalReplica: false };
    const bytes = encodeMessage(msg, { sequence: 1 });
    const d = decodeMessage(bytes);
    expect(d.message).toEqual(msg);
    // 且 message code 仍是 0x10
    expect(d.header.messageType).toBe(0x10);
  });

  it('ERROR 无 relatedSequence/namespaceId 的合法形态 roundtrip', () => {
    const msg = { kind: 'ERROR' as const, code: 'HELLO_TIMEOUT', safeMessage: 'timeout' };
    const bytes = encodeMessage(msg, { sequence: 1 });
    const d = decodeMessage(bytes);
    expect(d.message).toEqual(msg);
  });

  it('goaway 无 retryAfterMs 的合法形态 roundtrip（optional 省略）', () => {
    const msg = { kind: 'GOAWAY' as const, reasonCode: 'SERVER_SHUTTING_DOWN', drainTimeoutMs: 1000 };
    const bytes = encodeMessage(msg, { sequence: 1 });
    const d = decodeMessage(bytes);
    expect(d.message).toEqual(msg);
  });

  it('ERROR 字段顺序固化为规范顺序（scope→code→fatal→retryable→related→ns→safeMessage）', () => {
    // ERROR_CONN golden payload 头几字节 = scope 00, code(9) 'BAD_MAGIC', fatal 01, retryable 00
    expect(GOLDEN_BY_NAME.get('ERROR_CONN')!.payloadHex).toBe('00094241445f4d41474943010001070009626164206d61676963');
    // ERROR_NS golden: scope 01, code(20) SYNC_STATE_VIOLATION, fatal 01, retryable 00,
    // relatedSequence marker 01 + 0c, namespaceId marker 01 + ns, safeMessage
    expect(GOLDEN_BY_NAME.get('ERROR_NS')!.payloadHex.startsWith('011453594e435f53544154455f56494f4c4154494f4e0100010c01236e732d')).toBe(true);
  });

  it('OPEN_NAMESPACE 的 identity 字段与 OPEN_OK 边界：mode 聚合自 fixtures（golden 固化 bool=1、epoch=1）', () => {
    // encode 的 OPEN_NAMESPACE（hasLocalReplica=true）payload 尾端 = optional(01)+epoch(01)
    const bytes = encodeMessage(OPEN_NAMESPACE, { sequence: 6 });
    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(hex.endsWith('0101')).toBe(true);
  });
});
