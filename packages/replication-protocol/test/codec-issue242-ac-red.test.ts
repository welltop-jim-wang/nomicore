/**
 * 红灯验收契约 — issue #242：UPDATE_CHUNK codec 与 CAP_CHUNKED_UPDATE 协商（issue #233 切片 1）。
 *
 * 契约锚点：
 * - ADR 0013（docs/adr/0013-chunked-live-update-transfer.md）——UPDATE_CHUNK 字段顺序唯一权威：
 *   namespaceId(varString) → transferId(varUint) → chunkIndex(varUint) → chunkCount(varUint)
 *   → totalBytes(varUint) → bytes(varUint8Array)；HELLO 追加 capability bit 0x00000001；
 *   namespace 错误码 UPDATE_TRANSFER_VIOLATION（fatal/no/failed）与
 *   UPDATE_TRANSFER_TOO_LARGE（fatal/config/failed）；RESYNC reason 词表追加 UPDATE_TRANSFER_EXPIRED。
 * - docs/protocols/instance-replication-v1.md §3（envelope version 恒 1、flags 恒 0）、§4（lib0
 *   canonical + 完全消费 + 敌意输入拒绝）、§5（消息注册表 append-only，未知码 connection fatal
 *   UNSUPPORTED_MESSAGE_TYPE）、§6.1/§6.2（optional 取交集 → selectedCapabilities）、
 *   §13.2（namespace 错误注册表）。
 *
 * 红灯条件（生产实现前，本文件必须失败且失败原因唯一指向未实现的协议面）：
 * - UPDATE_CHUNK(0x42) 未注册 → encode 抛 UNSUPPORTED_MESSAGE_TYPE、decodeFrame 步骤 6 拒绝；
 * - CAP_CHUNKED_UPDATE / UpdateChunkMsg / DecodeOptions.selectedCapabilities 不存在；
 * - NAMESPACE_ERRORS 无两条 UPDATE_TRANSFER_* 码（恰 20 条）。
 * 转绿条件（实现后本文件不改即绿）：
 * - 注册 0x42 + 全字段编解码（本文件 golden 向量逐字节锁定）；
 * - 解码门控：selectedCapabilities 缺省/无该位 → UNSUPPORTED_MESSAGE_TYPE connection fatal；
 *   选项校验作用域=急切（对称 resolveExpectedSequence 先例，对全部消息类型先行生效）；
 * - 注册表 22 条 + ERROR wire 位由注册表推导；
 * - 全字段敌意拒绝分类与本文件断言一致。
 * 本切片不改任何发送/接收行为：ws-replication 的 decodeInbound 不传 selectedCapabilities，
 * 缺省即 v1 保守语义（0x42 = 未支持消息码）——新旧实现互不破译。
 */
import { describe, expect, it } from 'vitest';
import {
  CAP_CHUNKED_UPDATE,
  MESSAGE_NAMES,
  MESSAGE_REGISTRY,
  MESSAGE_TYPES,
  NAMESPACE_ERRORS,
  type UpdateChunkMsg,
  ProtocolError,
  decodeMessage,
  encodeMessage,
  lookupError,
  selectCapabilities,
} from '@nomicore/replication-protocol';
import { GOLDEN, NONCE, NS, buildFrameHex, hexToBytes } from './fixtures';

// ---------------------------------------------------------------- 本地契约常量（与实现无关的纯算术）

/** ADR 0013：CAP_CHUNKED_UPDATE 位值（字面量先行，常量导出另行断言）。 */
const CAP_BIT = 0x00000001;
/** UPDATE_CHUNK 消息码（ADR 0013：0x42，UPDATE_ACK 0x41 之后的首个空闲码）。 */
const UPDATE_CHUNK_CODE = 0x42;
/** fixtures NS 的 varString canonical 编码（len 0x23 + 35 ASCII 字节）。 */
const NS_HEX = '236e732d3031323334353637383961626364656630313233343536373839616263646566';

function hexOf(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function asciiHex(s: string): string {
  return Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, '0')).join('');
}

function expectProtocolError(fn: () => unknown, code: string): ProtocolError {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught, `期望 ProtocolError(${code})`).toBeInstanceOf(ProtocolError);
  const err = caught as ProtocolError;
  expect(err.code, `实际错误码应为 ${code}，消息：${String(err.message)}`).toBe(code);
  return err;
}

// ---------------------------------------------------------------- golden vectors（全字段，锁定）

interface ChunkVector {
  name: string;
  sequence: number;
  message: UpdateChunkMsg;
  /** lib0 canonical payload（字段顺序 = ADR 0013 表序）。 */
  payloadHex: string;
}

/** 向量 A：单字节 varUint 基本形态（transferId=1, index=0, count=3, totalBytes=600, 3 字节载荷）。 */
const VECTOR_A: ChunkVector = {
  name: 'UPDATE_CHUNK_BASIC',
  sequence: 19,
  message: {
    kind: 'UPDATE_CHUNK',
    namespaceId: NS,
    transferId: 1,
    chunkIndex: 0,
    chunkCount: 3,
    totalBytes: 600,
    bytes: Uint8Array.from([0x0a, 0x0b, 0x0c]),
  },
  payloadHex: NS_HEX + '01' + '00' + '03' + 'd804' + '03' + '0a0b0c',
};

/** 向量 B：多字节 LEB128 形态（300/63/64/4 MiB，5 字节载荷）。 */
const VECTOR_B: ChunkVector = {
  name: 'UPDATE_CHUNK_MULTIBYTE',
  sequence: 20,
  message: {
    kind: 'UPDATE_CHUNK',
    namespaceId: NS,
    transferId: 300,
    chunkIndex: 63,
    chunkCount: 64,
    totalBytes: 4194304,
    bytes: Uint8Array.from([0xde, 0xad, 0xbe, 0xef, 0x01]),
  },
  payloadHex: NS_HEX + 'ac02' + '3f' + '40' + '80808002' + '05' + 'deadbeef01',
};

/** 向量 C：uint32 上界形态（0xffffffff / 0xfffffffe / 0xffffffff / 0xffffffff，1 字节载荷）。 */
const VECTOR_C: ChunkVector = {
  name: 'UPDATE_CHUNK_U32_MAX',
  sequence: 21,
  message: {
    kind: 'UPDATE_CHUNK',
    namespaceId: NS,
    transferId: 0xffffffff,
    chunkIndex: 0xfffffffe,
    chunkCount: 0xffffffff,
    totalBytes: 0xffffffff,
    bytes: Uint8Array.from([0xff]),
  },
  payloadHex: NS_HEX + 'ffffffff0f' + 'feffffff0f' + 'ffffffff0f' + 'ffffffff0f' + '01' + 'ff',
};

const VECTORS = [VECTOR_A, VECTOR_B, VECTOR_C];

/** 锁定的完整 frame（20-byte 大端头 + payload；头由规范纯算术构造）。 */
const PINNED_FRAME_HEX: Record<string, string> = {
  UPDATE_CHUNK_BASIC:
    '4e4d435201420000000000130000002d00000000' + VECTOR_A.payloadHex,
  UPDATE_CHUNK_MULTIBYTE:
    '4e4d435201420000000000140000003200000000' + VECTOR_B.payloadHex,
  UPDATE_CHUNK_U32_MAX:
    '4e4d435201420000000000150000003a00000000' + VECTOR_C.payloadHex,
};

function chunkFrame(v: ChunkVector): Uint8Array {
  return hexToBytes(buildFrameHex(UPDATE_CHUNK_CODE, v.sequence, v.payloadHex));
}

/** 已协商语境下的解码（等价 ws-replication 未来传入 selectedCapabilities 的调用形态）。 */
function decodeChunk(bytes: Uint8Array, extra?: { limits?: { maxUpdateBytes?: number } }): ReturnType<typeof decodeMessage> {
  return decodeMessage(bytes, { selectedCapabilities: CAP_BIT, ...extra });
}

/** 敌意 payload 构造：默认为向量 A 的字段，逐字段覆盖。 */
function hostilePayload(overrides: Partial<Record<'nsHex' | 'transferIdHex' | 'chunkIndexHex' | 'chunkCountHex' | 'totalBytesHex' | 'tailHex', string>>): string {
  return (
    (overrides.nsHex ?? NS_HEX) +
    (overrides.transferIdHex ?? '01') +
    (overrides.chunkIndexHex ?? '00') +
    (overrides.chunkCountHex ?? '03') +
    (overrides.totalBytesHex ?? 'd804') +
    (overrides.tailHex ?? '03' + '0a0b0c')
  );
}

function hostileFrame(payloadHex: string, sequence = 19): Uint8Array {
  return hexToBytes(buildFrameHex(UPDATE_CHUNK_CODE, sequence, payloadHex));
}

// ================================================================ AC1：golden vectors + canonical roundtrip

describe('AC1：UPDATE_CHUNK 全字段 golden 向量锁定 + canonical roundtrip（字段序 = ADR 0013）', () => {
  it('注册表：UPDATE_CHUNK=0x42、code→name 逆映射、scope=namespace/direction=either/ack=UPDATE_ACK；CAP_CHUNKED_UPDATE=0x00000001', () => {
    expect(MESSAGE_TYPES.UPDATE_CHUNK).toBe(UPDATE_CHUNK_CODE);
    expect(MESSAGE_NAMES[String(UPDATE_CHUNK_CODE)]).toBe('UPDATE_CHUNK');
    expect(MESSAGE_REGISTRY.UPDATE_CHUNK).toEqual({
      code: UPDATE_CHUNK_CODE,
      scope: 'namespace',
      direction: 'either',
      ack: 'UPDATE_ACK', // ADR 0013：ACK 复用 UPDATE_ACK（ackedSequence = 末 chunk 帧序）
    });
    expect(CAP_CHUNKED_UPDATE).toBe(CAP_BIT);
    // append-only 锚点（现有不变式保持）
    expect(Object.isFrozen(MESSAGE_TYPES)).toBe(true);
    expect(Object.isFrozen(MESSAGE_REGISTRY)).toBe(true);
    expect(MESSAGE_TYPES.UPDATE).toBe(0x40);
    expect(MESSAGE_TYPES.UPDATE_ACK).toBe(0x41);
  });

  it('golden 向量与规范算术构造一致（buildFrameHex 链路自校验 + 锁定字面量）', () => {
    for (const v of VECTORS) {
      expect(buildFrameHex(UPDATE_CHUNK_CODE, v.sequence, v.payloadHex), v.name).toBe(PINNED_FRAME_HEX[v.name]);
    }
  });

  it('encodeMessage 输出与锁定 frame 逐字节一致（lib0 canonical：最短 LEB128 + varString/varUint8Array 长度前缀）', () => {
    for (const v of VECTORS) {
      const bytes = encodeMessage(v.message, { sequence: v.sequence });
      expect(hexOf(bytes), `${v.name} golden`).toBe(PINNED_FRAME_HEX[v.name]);
    }
  });

  it('decode（已协商）字段与 fixture 全等；header envelopeVersion=1/flags=0/reserved=0（envelope 面零变化）', () => {
    for (const v of VECTORS) {
      const d = decodeChunk(chunkFrame(v));
      expect(d.header.messageType, v.name).toBe(UPDATE_CHUNK_CODE);
      expect(d.header.sequence, v.name).toBe(v.sequence);
      expect(d.header.envelopeVersion, v.name).toBe(1);
      expect(d.header.flags, v.name).toBe(0);
      expect(d.header.reserved, v.name).toBe(0);
      expect(d.header.payloadLength, v.name).toBe(v.payloadHex.length / 2);
      expect(d.message, v.name).toEqual(v.message);
    }
  });

  it('canonical roundtrip：encode(decode(frame)) === frame（逐字节，含 header）', () => {
    for (const v of VECTORS) {
      const d = decodeChunk(chunkFrame(v));
      const re = encodeMessage(d.message, { sequence: d.header.sequence });
      expect(hexOf(re), `${v.name} canonical roundtrip`).toBe(PINNED_FRAME_HEX[v.name]);
    }
  });

  it('字段顺序锁定：varString(ns) → transferId → chunkIndex → chunkCount → totalBytes → varUint8Array(bytes)', () => {
    expect(VECTOR_A.payloadHex.startsWith(NS_HEX)).toBe(true);
    expect(VECTOR_A.payloadHex.slice(NS_HEX.length)).toBe('01' + '00' + '03' + 'd804' + '03' + '0a0b0c');
    expect(VECTOR_B.payloadHex.slice(NS_HEX.length)).toBe('ac02' + '3f' + '40' + '80808002' + '05' + 'deadbeef01');
    expect(VECTOR_C.payloadHex.slice(NS_HEX.length)).toBe(
      'ffffffff0f' + 'feffffff0f' + 'ffffffff0f' + 'ffffffff0f' + '01' + 'ff',
    );
  });
});

// ================================================================ AC2：敌意解码（响亮拒绝，无越界分配）

describe('AC2：敌意输入全部被响亮拒绝（分类稳定，绝不未分类异常/越界分配）', () => {
  it('逐 byte offset 截断：0–3 → BAD_MAGIC，其余 → FRAME_LENGTH_MISMATCH（先于 payload 复制/分配）', () => {
    const bytes = chunkFrame(VECTOR_A);
    for (let i = 0; i < bytes.byteLength; i++) {
      const truncated = bytes.slice(0, i);
      const expectedCode = i < 4 ? 'BAD_MAGIC' : 'FRAME_LENGTH_MISMATCH';
      expectProtocolError(() => decodeChunk(truncated), expectedCode);
    }
  });

  it('非 canonical varUint / 超 8 字节 LEB128 / 超 uint32 域 → MALFORMED_FRAME', () => {
    // transferId=1 的非最短形式 `81 00`
    expectProtocolError(() => decodeChunk(hostileFrame(hostilePayload({ transferIdHex: '8100' }))), 'MALFORMED_FRAME');
    // chunkCount=3 的非最短形式 `83 00`
    expectProtocolError(() => decodeChunk(hostileFrame(hostilePayload({ chunkCountHex: '8300' }))), 'MALFORMED_FRAME');
    // bytes 长度前缀非最短形式
    expectProtocolError(() => decodeChunk(hostileFrame(hostilePayload({ tailHex: '83000a0b0c' }))), 'MALFORMED_FRAME');
    // 9 字节连续续位（超过 8 字节上限）
    expectProtocolError(() => decodeChunk(hostileFrame(hostilePayload({ transferIdHex: 'ff'.repeat(18) }))), 'MALFORMED_FRAME');
    // transferId = 2^32（超出 uint32 域）
    expectProtocolError(() => decodeChunk(hostileFrame(hostilePayload({ transferIdHex: '8080808010' }))), 'MALFORMED_FRAME');
    // chunkIndex = 2^32
    expectProtocolError(() => decodeChunk(hostileFrame(hostilePayload({ chunkIndexHex: '8080808010' }))), 'MALFORMED_FRAME');
  });

  it('非法 UTF-8 / 非法 namespaceId 格式 → MALFORMED_FRAME', () => {
    // varString 长度合法（35）但字节为 0xff —— 严格 UTF-8 解码必须 fatal
    expectProtocolError(
      () => decodeChunk(hostileFrame(hostilePayload({ nsHex: '23' + 'ff'.repeat(35) }))),
      'MALFORMED_FRAME',
    );
    // 合法 UTF-8 但大写 hex（违反 ^ns-[0-9a-f]{32}$）
    expectProtocolError(
      () => decodeChunk(hostileFrame(hostilePayload({ nsHex: '23' + asciiHex('ns-') + '41'.repeat(32) }))),
      'MALFORMED_FRAME',
    );
    // 长度不足
    expectProtocolError(
      () => decodeChunk(hostileFrame(hostilePayload({ nsHex: '06' + asciiHex('ns-abc') }))),
      'MALFORMED_FRAME',
    );
  });

  it('payload 内尾随字节（header 长度同步调整）→ MALFORMED_FRAME（完全消费原则）', () => {
    expectProtocolError(() => decodeChunk(hostileFrame(VECTOR_A.payloadHex + 'ab')), 'MALFORMED_FRAME');
  });

  it('超声明 bytes：长度前缀超余量 / 巨额声明 → MALFORMED_FRAME，分配前拒绝（无越界分配）', () => {
    // 声明 200 字节，实际仅 3 字节
    expectProtocolError(() => decodeChunk(hostileFrame(hostilePayload({ tailHex: 'c801' + '0a0b0c' }))), 'MALFORMED_FRAME');
    // 声明 2^32 字节（4 GiB），实际 0 字节 —— 必须立即分类拒绝而非尝试分配
    expectProtocolError(() => decodeChunk(hostileFrame(hostilePayload({ tailHex: '8080808010' }))), 'MALFORMED_FRAME');
  });

  it('单帧语义自洽拒绝：chunkCount=0 / chunkIndex≥chunkCount / transferId=0 / 空 bytes / bytes>totalBytes → MALFORMED_FRAME', () => {
    expectProtocolError(() => decodeChunk(hostileFrame(hostilePayload({ chunkCountHex: '00' }))), 'MALFORMED_FRAME');
    expectProtocolError(() => decodeChunk(hostileFrame(hostilePayload({ chunkIndexHex: '03' }))), 'MALFORMED_FRAME'); // 3 ≥ 3
    expectProtocolError(() => decodeChunk(hostileFrame(hostilePayload({ transferIdHex: '00' }))), 'MALFORMED_FRAME');
    expectProtocolError(() => decodeChunk(hostileFrame(hostilePayload({ tailHex: '00' }))), 'MALFORMED_FRAME'); // 空分片
    expectProtocolError(() => decodeChunk(hostileFrame(hostilePayload({ totalBytesHex: '01' }))), 'MALFORMED_FRAME'); // 3 > 1
  });

  it('字段限额复用 maxUpdateBytes：bytes 超限 → UPDATE_TOO_LARGE（encode/decode 同一判据，ADR 0013「chunk 大小复用 maxUpdateBytes」）', () => {
    const frame = chunkFrame(VECTOR_A); // bytes=3
    expectProtocolError(() => decodeChunk(frame, { limits: { maxUpdateBytes: 2 } }), 'UPDATE_TOO_LARGE');
    expectProtocolError(
      () => encodeMessage(VECTOR_A.message, { sequence: 19, limits: { maxUpdateBytes: 2 } }),
      'UPDATE_TOO_LARGE',
    );
  });

  it('encode 侧执行同一套字段规则（R9 对称：先验证后写）', () => {
    const base = { ...VECTOR_A.message } as unknown as Record<string, unknown>;
    const variant = (patch: Record<string, unknown>) => ({ ...base, ...patch }) as never;
    expectProtocolError(() => encodeMessage(variant({ chunkCount: 0 }), { sequence: 1 }), 'MALFORMED_FRAME');
    expectProtocolError(() => encodeMessage(variant({ transferId: 0 }), { sequence: 1 }), 'MALFORMED_FRAME');
    expectProtocolError(() => encodeMessage(variant({ transferId: 0x100000000 }), { sequence: 1 }), 'MALFORMED_FRAME');
    expectProtocolError(() => encodeMessage(variant({ chunkIndex: 3, chunkCount: 3 }), { sequence: 1 }), 'MALFORMED_FRAME');
    expectProtocolError(() => encodeMessage(variant({ bytes: [1, 2, 3] }), { sequence: 1 }), 'MALFORMED_FRAME'); // 非 Uint8Array
    expectProtocolError(() => encodeMessage(variant({ namespaceId: 'ns-ABC' }), { sequence: 1 }), 'MALFORMED_FRAME');
    expectProtocolError(() => encodeMessage(variant({ totalBytes: 2 }), { sequence: 1 }), 'MALFORMED_FRAME'); // 3 > 2
  });
});

// ================================================================ AC3：capability 协商 + 未协商 fatal

describe('AC3：CAP_CHUNKED_UPDATE 交集协商 + 未协商端 UNSUPPORTED_MESSAGE_TYPE connection fatal', () => {
  it('selectCapabilities：optional 交集 / required 拒绝（既有纯函数，位 0x1 生效）', () => {
    expect(selectCapabilities(0, CAP_BIT, CAP_BIT)).toEqual({ ok: true, selected: CAP_BIT });
    expect(selectCapabilities(0, CAP_BIT, 0)).toEqual({ ok: true, selected: 0 });
    expect(selectCapabilities(0, 0b11, CAP_BIT)).toEqual({ ok: true, selected: CAP_BIT });
    expect(selectCapabilities(CAP_BIT, 0, 0)).toEqual({ ok: false, selected: 0 });
    expect(selectCapabilities(CAP_BIT, CAP_BIT, CAP_BIT)).toEqual({ ok: true, selected: CAP_BIT });
  });

  it('HELLO/HELLO_ACK 携带 capability bit 的字节级 roundtrip（uint32 BE 字段位置不变，envelope 面零变化）', () => {
    const hello = encodeMessage(
      {
        kind: 'HELLO',
        peerInstanceId: 'peer-a',
        expectedHubInstanceId: 'hub-a',
        protocolVersions: [3, 2, 1],
        requiredCapabilities: 0,
        optionalCapabilities: CAP_BIT,
        connectionNonce: NONCE,
      },
      { sequence: 1 },
    );
    const helloPayload = hexOf(hello.slice(20));
    // 既有 HELLO golden 的 optionalCapabilities 字段位置（chars [42,50)）置为 00000001，其余逐字节一致
    const goldenHello = GOLDEN[0]!;
    expect(helloPayload.slice(42, 50)).toBe('00000001');
    expect(helloPayload).toBe(goldenHello.payloadHex.slice(0, 42) + '00000001' + goldenHello.payloadHex.slice(50));
    const decodedHello = decodeMessage(hello);
    expect(decodedHello.message.kind).toBe('HELLO');
    if (decodedHello.message.kind !== 'HELLO') return;
    expect(decodedHello.message.optionalCapabilities).toBe(CAP_BIT);

    const ack = encodeMessage(
      {
        kind: 'HELLO_ACK',
        hubInstanceId: 'hub-a',
        protocolVersion: 1,
        selectedCapabilities: CAP_BIT,
        connectionNonce: NONCE,
        connectionId: 'conn-1',
      },
      { sequence: 2 },
    );
    const decodedAck = decodeMessage(ack);
    expect(decodedAck.message.kind).toBe('HELLO_ACK');
    if (decodedAck.message.kind !== 'HELLO_ACK') return;
    expect(decodedAck.message.selectedCapabilities).toBe(CAP_BIT);
  });

  it('未协商（缺省选项 / selected=0 / 仅他位置位）解码 UPDATE_CHUNK → UNSUPPORTED_MESSAGE_TYPE connection fatal', () => {
    const frame = chunkFrame(VECTOR_A);
    for (const selected of [undefined, 0, 0x00000002]) {
      const err = expectProtocolError(
        () => decodeMessage(frame, selected === undefined ? undefined : { selectedCapabilities: selected }),
        'UNSUPPORTED_MESSAGE_TYPE',
      );
      // connection fatal 分类由连接错误注册表单点导出（§13.1）
      expect(err.scope).toBe('connection');
      expect(err.fatal).toBe(true);
      expect(err.retryable).toBe('no');
      expect(err.wsCloseCode).toBe(1002);
    }
  });

  it('已协商（本位置位，含多余位）解码成功且字段全等', () => {
    const frame = chunkFrame(VECTOR_A);
    const d1 = decodeMessage(frame, { selectedCapabilities: CAP_BIT });
    expect(d1.message).toEqual(VECTOR_A.message);
    // 操作数修复（SA3，issue #242）：裸 `CAP_BIT | 0x80000000` 经 JS 位运算得 int32 有符号值
    // -2147483647，与同文件「非法值（负）→ CPV」用例互斥；`>>> 0` 还原 uint32 0x80000001
    // （位 0 + 多余高位），保持本用例「本位置位 + 多余位 → 解码成功」的原语义（设计 §12 AC3）。
    const d2 = decodeMessage(frame, { selectedCapabilities: (CAP_BIT | 0x80000000) >>> 0 });
    expect(d2.message).toEqual(VECTOR_A.message);
  });

  it('selectedCapabilities 非法值 → CONNECTION_POLICY_VIOLATION（选项校验响亮，绝不 clamp）', () => {
    const frame = chunkFrame(VECTOR_A);
    expectProtocolError(() => decodeMessage(frame, { selectedCapabilities: -1 }), 'CONNECTION_POLICY_VIOLATION');
    expectProtocolError(() => decodeMessage(frame, { selectedCapabilities: 1.5 }), 'CONNECTION_POLICY_VIOLATION');
    expectProtocolError(() => decodeMessage(frame, { selectedCapabilities: 0x100000000 }), 'CONNECTION_POLICY_VIOLATION');
  });

  it('选项校验作用域=急切（对称 expectedSequence 先例，SA2 F3）：非 UPDATE_CHUNK 帧 + 非法 selectedCapabilities → CONNECTION_POLICY_VIOLATION', () => {
    // 合法的非 UPDATE_CHUNK 帧（既有 GOLDEN HELLO，0x01）：选项校验必须与消息类型无关地先行生效。
    // 钉死「急切校验」作用域（resolveExpectedSequence 先例），堵死「仅 UPDATE_CHUNK 路径惰性校验」的窄实现。
    const hello = hexToBytes(buildFrameHex(0x01, 1, GOLDEN[0]!.payloadHex));
    expectProtocolError(() => decodeMessage(hello, { selectedCapabilities: -1 }), 'CONNECTION_POLICY_VIOLATION');
    expectProtocolError(() => decodeMessage(hello, { selectedCapabilities: 1.5 }), 'CONNECTION_POLICY_VIOLATION');
    expectProtocolError(() => decodeMessage(hello, { selectedCapabilities: 0x100000000 }), 'CONNECTION_POLICY_VIOLATION');
    // 合法选项值下同一帧正常解码（作用域钉死不引入假拒绝）
    expect(decodeMessage(hello, { selectedCapabilities: 0 }).message.kind).toBe('HELLO');
  });

  it('v1 互通回落：v1 支持集（无该位）协商 selected=0 → 解码按未知消息码规则拒绝（新旧互不破译）', () => {
    const negotiation = selectCapabilities(0, CAP_BIT, 0); // v1 端 supported=0
    expect(negotiation).toEqual({ ok: true, selected: 0 });
    expectProtocolError(
      () => decodeMessage(chunkFrame(VECTOR_A), { selectedCapabilities: negotiation.selected }),
      'UNSUPPORTED_MESSAGE_TYPE',
    );
  });
});

// ================================================================ AC4：错误注册表 + RESYNC reason 词表

describe('AC4：两条 namespace 错误码注册表单点导出 + RESYNC reason 词表 append-only', () => {
  it('UPDATE_TRANSFER_VIOLATION：fatal=true/retryable=no/terminalState=failed（对齐 SYNC_STATE_VIOLATION 先例）', () => {
    expect(NAMESPACE_ERRORS.UPDATE_TRANSFER_VIOLATION).toEqual({
      code: 'UPDATE_TRANSFER_VIOLATION',
      scope: 'namespace',
      fatal: true,
      retryable: 'no',
      terminalState: 'failed',
    });
  });

  it('UPDATE_TRANSFER_TOO_LARGE：fatal=true/retryable=config/terminalState=failed（对齐 SYNC_DIFF_TOO_LARGE 语义族）', () => {
    expect(NAMESPACE_ERRORS.UPDATE_TRANSFER_TOO_LARGE).toEqual({
      code: 'UPDATE_TRANSFER_TOO_LARGE',
      scope: 'namespace',
      fatal: true,
      retryable: 'config',
      terminalState: 'failed',
    });
  });

  it('注册表 append-only：恰 22 条 namespace 码，既有 20 条不变（抽样锚点），条目冻结', () => {
    expect(Object.keys(NAMESPACE_ERRORS)).toHaveLength(22);
    expect(NAMESPACE_ERRORS.SYNC_STATE_VIOLATION).toMatchObject({ fatal: true, retryable: 'no', terminalState: 'failed' });
    expect(NAMESPACE_ERRORS.SYNC_DIFF_TOO_LARGE).toMatchObject({ fatal: true, retryable: 'config', terminalState: 'failed' });
    expect(NAMESPACE_ERRORS.UPDATE_TOO_LARGE).toMatchObject({ fatal: true, retryable: 'config', terminalState: 'failed' });
    expect(NAMESPACE_ERRORS.ACK_TIMEOUT).toMatchObject({ fatal: false, retryable: 'resync', terminalState: 'needs-resync' });
    expect(Object.isFrozen(NAMESPACE_ERRORS)).toBe(true);
    expect(Object.isFrozen(NAMESPACE_ERRORS.UPDATE_TRANSFER_VIOLATION)).toBe(true);
  });

  it('lookupError 双向可见性：namespace 命中、connection 不可见（scope 隔离）', () => {
    expect(lookupError('namespace', 'UPDATE_TRANSFER_VIOLATION')).toBe(NAMESPACE_ERRORS.UPDATE_TRANSFER_VIOLATION);
    expect(lookupError('namespace', 'UPDATE_TRANSFER_TOO_LARGE')).toBe(NAMESPACE_ERRORS.UPDATE_TRANSFER_TOO_LARGE);
    expect(lookupError('connection', 'UPDATE_TRANSFER_VIOLATION')).toBeUndefined();
    expect(lookupError('connection', 'UPDATE_TRANSFER_TOO_LARGE')).toBeUndefined();
  });

  it('ERROR wire roundtrip：scope/fatal/retryable 位由注册表推导（调用方不可覆盖）', () => {
    const violation = {
      kind: 'ERROR' as const,
      code: 'UPDATE_TRANSFER_VIOLATION',
      namespaceId: NS,
      relatedSequence: 9,
      safeMessage: 'chunk violated',
    };
    const violationBytes = encodeMessage(violation, { sequence: 7 });
    // payload 前缀：scope=01 + varString(code) + fatal=01 + retryable=00（registry: no → false）
    expect(hexOf(violationBytes.slice(20)).startsWith('01' + '19' + asciiHex('UPDATE_TRANSFER_VIOLATION') + '01' + '00')).toBe(true);
    expect(decodeMessage(violationBytes).message).toEqual(violation);

    const tooLarge = {
      kind: 'ERROR' as const,
      code: 'UPDATE_TRANSFER_TOO_LARGE',
      namespaceId: NS,
      safeMessage: 'transfer exceeds limit',
    };
    const tooLargeBytes = encodeMessage(tooLarge, { sequence: 8 });
    // fatal=01 + retryable=01（registry: config ≠ no → true）
    expect(hexOf(tooLargeBytes.slice(20)).startsWith('01' + '19' + asciiHex('UPDATE_TRANSFER_TOO_LARGE') + '01' + '01')).toBe(true);
    expect(decodeMessage(tooLargeBytes).message).toEqual(tooLarge);

    // 与注册表不一致的 fatal 位 → MALFORMED_FRAME（decodeError 既有推导校验覆盖新码）
    const badBits =
      '01' + '19' + asciiHex('UPDATE_TRANSFER_VIOLATION') + '00' + '00' + '00' + '01' + NS_HEX + '00';
    expectProtocolError(() => decodeMessage(hexToBytes(buildFrameHex(0x04, 9, badBits))), 'MALFORMED_FRAME');
  });

  it('ProtocolError 元数据导出：显式 namespace scope 消解（AC4 单点语义）', () => {
    const err = new ProtocolError('UPDATE_TRANSFER_VIOLATION', 'chunk mismatch', 'namespace');
    expect(err.scope).toBe('namespace');
    expect(err.fatal).toBe(true);
    expect(err.retryable).toBe('no');
    expect(err.terminalState).toBe('failed');
    const err2 = new ProtocolError('UPDATE_TRANSFER_TOO_LARGE', 'over budget', 'namespace');
    expect(err2.retryable).toBe('config');
    expect(err2.terminalState).toBe('failed');
  });

  it('RESYNC_REQUIRED reasonCode 词表追加 UPDATE_TRANSFER_EXPIRED：roundtrip 锁定 + 空理由仍拒', () => {
    const msg = { kind: 'RESYNC_REQUIRED' as const, namespaceId: NS, reasonCode: 'UPDATE_TRANSFER_EXPIRED' };
    const bytes = encodeMessage(msg, { sequence: 3 });
    expect(decodeMessage(bytes).message).toEqual(msg);
    expectProtocolError(
      () => encodeMessage({ kind: 'RESYNC_REQUIRED' as const, namespaceId: NS, reasonCode: '' }, { sequence: 3 }),
      'MALFORMED_FRAME',
    );
  });
});
