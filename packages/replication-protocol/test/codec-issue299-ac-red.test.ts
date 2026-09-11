/**
 * SA6 红灯验收契约 — issue #299（#295 切片 1）：0x42 UPDATE_CHUNK kind 首字段单形态 codec。
 *
 * 契约锚点：
 * - ADR 0019「消息形态」：0x42 payload 恒为 `kind varUint` 首字段 + namespaceId/transferId/
 *   chunkIndex/chunkCount/totalBytes/bytes 五字段序不变 + 绑定块（当且仅当 kind≠0 ∧
 *   chunkIndex=0：kind=1 → replicationId varString + replicationEpoch varUint；kind=2 →
 *   syncRoundId varUint）；`kind ∈ {0,1,2}`；ADR 0013 六字段旧形态作废（从未发布，无兼容负担）。
 * - docs/protocols/instance-replication-v1.md §5 L116（单形态恒用 + v1 代际端照旧
 *   UNSUPPORTED_MESSAGE_TYPE）、§10.3（字段表 + 单形态规则 + codec 级单帧规则「违者
 *   MALFORMED_FRAME」）、§22（golden vectors 由实现票交付/改写）。
 * - issue #299 AC1（单形态编解码 + golden vectors 改写冻结）、AC2（kind 非法值 / 绑定块位置
 *   违例 → MALFORMED_FRAME）、AC4（三 kind 共用同一 transferId 字段语义）；SA8 前置门禁
 *   artifacts/sa8-conflict-gate-issue-299.md R33（codec 无状态，不承载连接级 assembly 状态）、
 *   R34（解码侧协商门一体适用、不得随改写移除）。
 *
 * 断言面为何不引用新类型字段名：本文件只观察 wire 字节、既有公开字段（namespaceId/
 * transferId/chunkIndex/chunkCount/totalBytes/bytes）与 decode→encode 逐字节往返，不假设实现为
 * wire kind / 绑定块选择的 TS 字段名（`UpdateChunkMsg.kind` 已是判别键 'UPDATE_CHUNK'，
 * wire kind 的 TS 命名属 SA1 设计面，本契约不锁定）。往返无损（decode 后 encode 回原字节）
 * 同时锁定 kind 首字段、五字段序、绑定块内容与位置，以及编码器必须按单形态重建——
 * 任何形态偏差都在字节比对处失败。
 *
 * 红灯条件（实现前本文件必须在「单形态」断言处失败；失败原因是缺实现而非环境/fixture）：
 * - R1–R4：kind 首字段向量当前被按六字段旧形态解析 → MALFORMED_FRAME（新形态不存在）；
 * - R5：六字段旧形态向量当前仍可解码（要求其被 MALFORMED_FRAME 拒绝——单形态恒用）；
 * - R6：仓内 UPDATE_CHUNK golden fixtures 当前仍是六字段形态（AC1 要求改写为单形态）；
 * - R7–R14：kind/绑定块/transferId/字段限额/编码侧对称校验——每例先断言同 kind 的「相近正控」
 *   帧单形态可解码（证明解析器抵达该规则所在字段），再断言违例分类；旧形态下正控即失败，
 *   故本组用例整体红（拒绝不再可能是旧解析器误判的偶然结果）。
 * 实测（实现前）：R1–R14 = 14 红，N1–N3 = 3 绿，见契约报告 §13 证据日志。
 *
 * 负控（实现前即绿、实现后必须保持绿——证明红不在环境/入口/断言敏感度）：
 * - N1：未协商 0x42 在 payload 解析前 UNSUPPORTED_MESSAGE_TYPE（SA8 R34，形态无关）；
 * - N2：selectedCapabilities 非法值急切 CONNECTION_POLICY_VIOLATION（形态无关）；
 * - N3：非 0x42 消息（UPDATE 0x40）逐字节往返回归（改写不得波及它域）。
 *
 * 纪律：无 skip/only/todo、无 env override、无 fallback、无源码字符串/正则断言、零 real sleep。
 */
import { describe, expect, it } from 'vitest';
import {
  CAP_CHUNKED_UPDATE,
  type DecodedMessage,
  type FieldLimits,
  ProtocolError,
  type UpdateChunkMsg,
  decodeMessage,
  encodeMessage,
} from '@nomicore/replication-protocol';
import { GOLDEN, NS, buildFrameHex, bytesToHex, hexToBytes } from './fixtures';

// ---------------------------------------------------------------- 契约常量（规范字面量先行）

/** 0x42 UPDATE_CHUNK（§5 消息注册表）。 */
const UPDATE_CHUNK_CODE = 0x42;
/** CAP_CHUNKED_UPDATE 位值（§6.2 协商）。 */
const CAP_BIT = 0x00000001;
/** kind 三态（ADR 0019 / §10.3）。 */
const KIND_LIVE_UPDATE = 0;
const KIND_SNAPSHOT = 1;
const KIND_SYNC_DIFF = 2;
/** ADR 0013 六字段旧形态（随单形态作废）的 payload。 */
const OLD_SIX_FIELD_PAYLOAD_HEX =
  '236e732d3031323334353637383961626364656630313233343536373839616263646566010003d804030a0b0c';

// ---------------------------------------------------------------- wire 向量（纯算术构造，与实现无关）
//
// 编码规则核对自 lib0 canonical：varUint = 无符号 LEB128 最短形式；varString = varUint(utf8 字节数)
// + utf8；varUint8Array = varUint(byteLength) + 字节。frameHex = 20-byte envelope + payloadHex
// （buildFrameHex 纯算术组装，§3）。NS 的 varString 前缀 = 0x23（35 字节）；RID 的 varString
// 前缀 = 0x20（32 字节）。

function frame(payloadHex: string, sequence: number): string {
  return buildFrameHex(UPDATE_CHUNK_CODE, sequence, payloadHex);
}

const V = Object.freeze({
  /** kind=0 live-update 首 chunk：kind + NS + tid=1 + idx=0 + count=3 + total=600 + bytes 0a0b0c。 */
  KIND0_FIRST: frame(
    '00236e732d3031323334353637383961626364656630313233343536373839616263646566010003d804030a0b0c',
    31,
  ),
  /** kind=0 非首 chunk：tid=7、idx=2。 */
  KIND0_LATER: frame(
    '00236e732d3031323334353637383961626364656630313233343536373839616263646566070203d804030a0b0c',
    32,
  ),
  /** kind=1 snapshot 首 chunk：绑定块 replicationId(RID) + replicationEpoch(1)，位于 totalBytes 之后、bytes 之前。 */
  KIND1_FIRST: frame(
    '01236e732d3031323334353637383961626364656630313233343536373839616263646566010003d80420613162326333643465356636303731383239336134623563366437653866393001030a0b0c',
    33,
  ),
  /** kind=2 sync-diff 首 chunk：绑定块 syncRoundId(5)。 */
  KIND2_FIRST: frame(
    '02236e732d3031323334353637383961626364656630313233343536373839616263646566090002e8070504deadbeef',
    34,
  ),
  /** kind=2 非首 chunk：无绑定块（idx=1）。 */
  KIND2_LATER: frame(
    '02236e732d3031323334353637383961626364656630313233343536373839616263646566090102e807010a',
    35,
  ),
  /** kind=1 非首 chunk：无绑定块，transferId = uint32 上界 0xffffffff。 */
  KIND1_LATER_U32MAX: frame(
    '01236e732d3031323334353637383961626364656630313233343536373839616263646566ffffffff0f0102e807010a',
    36,
  ),
  /** kind=2 非首 chunk：transferId = 0xffffffff。 */
  KIND2_LATER_U32MAX: frame(
    '02236e732d3031323334353637383961626364656630313233343536373839616263646566ffffffff0f0102e807010a',
    37,
  ),
  /** kind=0 非首 chunk：transferId = 0xffffffff。 */
  KIND0_LATER_U32MAX: frame(
    '00236e732d3031323334353637383961626364656630313233343536373839616263646566ffffffff0f0102e807010a',
    38,
  ),
  /** 非法 kind=3（单帧规则 kind ∈ {0,1,2}）。 */
  KIND3_INVALID: frame(
    '03236e732d3031323334353637383961626364656630313233343536373839616263646566010003d804030a0b0c',
    39,
  ),
  /** 非法 kind=127（varUint 单字节上界）。 */
  KIND127_INVALID: frame(
    '7f236e732d3031323334353637383961626364656630313233343536373839616263646566010003d804030a0b0c',
    40,
  ),
  /** kind=1 首 chunk 缺绑定块（绑定块当且仅当 kind≠0 ∧ chunkIndex=0）。 */
  KIND1_NO_BINDING: frame(
    '01236e732d3031323334353637383961626364656630313233343536373839616263646566010003d804030a0b0c',
    41,
  ),
  /** kind=1 首 chunk 把绑定块写在 bytes 之后（位置违例）。 */
  KIND1_BINDING_AFTER_BYTES: frame(
    '01236e732d3031323334353637383961626364656630313233343536373839616263646566010003d804030a0b0c20613162326333643465356636303731383239336134623563366437653866393001',
    42,
  ),
  /** kind=1 非首 chunk 携带绑定块（越位：非首 chunk 不得携带）。 */
  KIND1_BINDING_ON_LATER: frame(
    '01236e732d3031323334353637383961626364656630313233343536373839616263646566010102e80720613162326333643465356636303731383239336134623563366437653866393001010a',
    43,
  ),
  /** kind=2 非首 chunk 携带绑定块（越位）。 */
  KIND2_BINDING_ON_LATER: frame(
    '02236e732d3031323334353637383961626364656630313233343536373839616263646566090102e80705010a',
    44,
  ),
  /** kind=0 首 chunk 携带绑定块字节（kind=0 不得携带 → 尾随字节拒绝）。 */
  KIND0_BINDING_BYTES: frame(
    '00236e732d3031323334353637383961626364656630313233343536373839616263646566010001e807010a20613162326333643465356636303731383239336134623563366437653866393001',
    45,
  ),
  /** kind=1 首 chunk transferId=0（0 非法，AC4 三 kind 同域语义）。 */
  KIND1_TID0: frame(
    '01236e732d3031323334353637383961626364656630313233343536373839616263646566000001e80720613162326333643465356636303731383239336134623563366437653866393001010a',
    46,
  ),
  /** kind=2 首 chunk transferId=0。 */
  KIND2_TID0: frame(
    '02236e732d3031323334353637383961626364656630313233343536373839616263646566000001e80705010a',
    47,
  ),
  /** kind=0 首 chunk transferId=0（既有规则回归面）。 */
  KIND0_TID0: frame(
    '00236e732d3031323334353637383961626364656630313233343536373839616263646566000001e807010a',
    48,
  ),
  /** 六字段旧形态（ADR 0013 golden 向量字面量；单形态下首字节 0x23 不是合法 kind）。 */
  OLD_SIX_FIELD: frame(OLD_SIX_FIELD_PAYLOAD_HEX, 49),
});

// ---------------------------------------------------------------- 断言 helper

function decodeChunk(
  frameHex: string,
  options: Readonly<{ limits?: FieldLimits; selectedCapabilities?: number }> = {},
): DecodedMessage {
  return decodeMessage(hexToBytes(frameHex), {
    selectedCapabilities: options.selectedCapabilities ?? CAP_CHUNKED_UPDATE,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  });
}

/** 取 UPDATE_CHUNK 消息（判别联合收窄，零 cast）。 */
function expectChunk(decoded: DecodedMessage): UpdateChunkMsg {
  if (decoded.message.kind !== 'UPDATE_CHUNK') {
    throw new Error(`期望 UPDATE_CHUNK，实际 ${decoded.message.kind}`);
  }
  return decoded.message;
}

function expectProtocolError(fn: () => unknown, code: string, label = ''): ProtocolError {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  const prefix = label === '' ? '' : `${label}：`;
  expect(caught, `${prefix}期望 ProtocolError(${code})`).toBeInstanceOf(ProtocolError);
  const err = caught as ProtocolError;
  expect(err.code, `${prefix}实际错误码应为 ${code}，消息：${String(err.message)}`).toBe(code);
  return err;
}

/** 帧内 payload 长度（§3 固定 20-byte envelope）。 */
function payloadLengthOf(frameHex: string): number {
  return frameHex.length / 2 - 20;
}

/**
 * 单帧规则用例的「相近正控」：同 kind / 同字段位的合法帧必须先可单形态解码，
 * 证明解析器确实抵达该规则所在字段（否则「拒绝」可能只是旧形态误解析的偶然结果——伪绿）。
 */
function expectValidChunk(frameHex: string, label: string): UpdateChunkMsg {
  const message = expectChunk(decodeChunk(frameHex));
  expect(message.namespaceId, `${label}：正控帧必须为单形态可解码`).toBe(NS);
  return message;
}

/** decode → encode 往返：返回重编码帧的十六进制（逐字节无损判据）。 */
function reencodeHex(frameHex: string): string {
  const decoded = decodeChunk(frameHex);
  return bytesToHex(encodeMessage(expectChunk(decoded), { sequence: decoded.header.sequence }));
}

// ---------------------------------------------------------------- 契约测试

describe('issue #299 切片 1：0x42 UPDATE_CHUNK kind 首字段单形态 codec（红灯契约）', () => {
  it('红灯 R1（AC1）：kind=0 live-update 单形态——kind 首字段 + 五字段序 + decode→encode 逐字节无损', () => {
    const decoded = decodeChunk(V.KIND0_FIRST);
    expect(decoded.header.messageType).toBe(UPDATE_CHUNK_CODE);
    expect(decoded.header.payloadLength).toBe(payloadLengthOf(V.KIND0_FIRST));
    const message = expectChunk(decoded);
    expect(message.namespaceId).toBe(NS);
    expect(message.transferId).toBe(1);
    expect(message.chunkIndex).toBe(0);
    expect(message.chunkCount).toBe(3);
    expect(message.totalBytes).toBe(600);
    expect(bytesToHex(message.bytes)).toBe('0a0b0c');
    expect(reencodeHex(V.KIND0_FIRST)).toBe(V.KIND0_FIRST);
  });

  it('红灯 R2（AC1）：kind=0 非首 chunk（idx=2）单形态往返无损', () => {
    const message = expectChunk(decodeChunk(V.KIND0_LATER));
    expect(message.transferId).toBe(7);
    expect(message.chunkIndex).toBe(2);
    expect(reencodeHex(V.KIND0_LATER)).toBe(V.KIND0_LATER);
  });

  it('红灯 R3（AC1）：kind=1 snapshot 首 chunk 携绑定块 replicationId+replicationEpoch 编解码无损', () => {
    const message = expectChunk(decodeChunk(V.KIND1_FIRST));
    expect(message.namespaceId).toBe(NS);
    expect(message.transferId).toBe(1);
    expect(message.chunkIndex).toBe(0);
    expect(message.totalBytes).toBe(600);
    // 绑定块内容必须被解码保留（否则重编码丢块/换位 → 字节比对失败）
    expect(reencodeHex(V.KIND1_FIRST)).toBe(V.KIND1_FIRST);
  });

  it('红灯 R4（AC1）：kind=2 sync-diff 首 chunk 携绑定块 syncRoundId 编解码无损；非首 chunk 无绑定块', () => {
    const first = expectChunk(decodeChunk(V.KIND2_FIRST));
    expect(first.transferId).toBe(9);
    expect(first.chunkIndex).toBe(0);
    expect(first.chunkCount).toBe(2);
    expect(first.totalBytes).toBe(1000);
    expect(reencodeHex(V.KIND2_FIRST)).toBe(V.KIND2_FIRST);

    const later = expectChunk(decodeChunk(V.KIND2_LATER));
    expect(later.chunkIndex).toBe(1);
    expect(reencodeHex(V.KIND2_LATER)).toBe(V.KIND2_LATER);
  });

  it('红灯 R5（AC1 旧形态作废）：ADR 0013 六字段 payload 必须 MALFORMED_FRAME（kind 首字段恒在，无形态兼容面）', () => {
    expectProtocolError(() => decodeChunk(V.OLD_SIX_FIELD), 'MALFORMED_FRAME', 'ADR 0013 旧形态');
  });

  it('红灯 R6（AC1 golden vectors 改写冻结）：仓内 UPDATE_CHUNK golden fixtures 必须全部为单形态且逐字节往返', () => {
    const chunkGoldens = GOLDEN.filter((golden) => golden.messageType === UPDATE_CHUNK_CODE);
    expect(
      chunkGoldens.length,
      'UPDATE_CHUNK golden fixtures 必须保留（条数 ≥3：BASIC/MULTIBYTE/U32_MAX 改写而非删除）',
    ).toBeGreaterThanOrEqual(3);
    for (const golden of chunkGoldens) {
      const payload = hexToBytes(golden.frameHex).subarray(20);
      const kindByte = payload[0];
      expect(
        kindByte === KIND_LIVE_UPDATE || kindByte === KIND_SNAPSHOT || kindByte === KIND_SYNC_DIFF,
        `${golden.name}：payload 首字节必须是 kind ∈ {0,1,2}（单形态），实际 0x${(kindByte ?? -1).toString(16)}`,
      ).toBe(true);
      expect(reencodeHex(golden.frameHex), `${golden.name} golden 必须单形态往返无损`).toBe(
        golden.frameHex,
      );
    }
  });

  it('红灯 R7（AC2）：kind ∉ {0,1,2}（3 / 127）→ MALFORMED_FRAME', () => {
    expectValidChunk(V.KIND0_FIRST, 'kind=0 首 chunk');
    expectProtocolError(() => decodeChunk(V.KIND3_INVALID), 'MALFORMED_FRAME', 'kind=3');
    expectProtocolError(() => decodeChunk(V.KIND127_INVALID), 'MALFORMED_FRAME', 'kind=127');
  });

  it('红灯 R8（AC2）：kind=1 首 chunk 缺绑定块 → MALFORMED_FRAME', () => {
    expectValidChunk(V.KIND1_FIRST, 'kind=1 首 chunk 携绑定块');
    expectProtocolError(() => decodeChunk(V.KIND1_NO_BINDING), 'MALFORMED_FRAME');
  });

  it('红灯 R9（AC2）：绑定块位置违例——kind=1 首 chunk 绑定块写在 bytes 之后 / 非首 chunk 携带 → MALFORMED_FRAME', () => {
    expectValidChunk(V.KIND1_FIRST, 'kind=1 首 chunk');
    expectValidChunk(V.KIND1_LATER_U32MAX, 'kind=1 非首 chunk');
    expectProtocolError(() => decodeChunk(V.KIND1_BINDING_AFTER_BYTES), 'MALFORMED_FRAME');
    expectProtocolError(() => decodeChunk(V.KIND1_BINDING_ON_LATER), 'MALFORMED_FRAME');
  });

  it('红灯 R10（AC2）：绑定块越位——kind=2 非首 chunk 携带绑定块、kind=0 携带绑定块字节 → MALFORMED_FRAME', () => {
    expectValidChunk(V.KIND2_LATER, 'kind=2 非首 chunk');
    expectValidChunk(V.KIND0_FIRST, 'kind=0 首 chunk');
    expectProtocolError(() => decodeChunk(V.KIND2_BINDING_ON_LATER), 'MALFORMED_FRAME');
    expectProtocolError(() => decodeChunk(V.KIND0_BINDING_BYTES), 'MALFORMED_FRAME');
  });

  it('红灯 R11（AC4）：transferId=0 在三种 kind 上一致 MALFORMED_FRAME（作用域计数器从 1 严格递增）', () => {
    expectValidChunk(V.KIND0_LATER, 'kind=0 非首 chunk（tid=7）');
    expectValidChunk(V.KIND1_FIRST, 'kind=1 首 chunk（tid=1）');
    expectValidChunk(V.KIND2_FIRST, 'kind=2 首 chunk（tid=9）');
    expectProtocolError(() => decodeChunk(V.KIND0_TID0), 'MALFORMED_FRAME', 'kind=0');
    expectProtocolError(() => decodeChunk(V.KIND1_TID0), 'MALFORMED_FRAME', 'kind=1');
    expectProtocolError(() => decodeChunk(V.KIND2_TID0), 'MALFORMED_FRAME', 'kind=2');
  });

  it('红灯 R12（AC4）：transferId uint32 上界 0xffffffff 在三种 kind 上一致被接纳且逐字节无损', () => {
    for (const [label, frameHex] of [
      ['kind=0', V.KIND0_LATER_U32MAX],
      ['kind=1', V.KIND1_LATER_U32MAX],
      ['kind=2', V.KIND2_LATER_U32MAX],
    ] as const) {
      const message = expectChunk(decodeChunk(frameHex));
      expect(message.transferId, `${label} transferId 必须保留 uint32 上界`).toBe(0xffffffff);
      expect(reencodeHex(frameHex), `${label} 往返`).toBe(frameHex);
    }
  });

  it('红灯 R13（AC2 kind 无关字段限额）：kind=1/2 chunk 的 bytes 复用 maxUpdateBytes——超限 → UPDATE_TOO_LARGE', () => {
    expectValidChunk(V.KIND1_FIRST, 'kind=1 首 chunk（缺省限额下合法）');
    expectValidChunk(V.KIND2_FIRST, 'kind=2 首 chunk（缺省限额下合法）');
    expectProtocolError(
      () => decodeChunk(V.KIND1_FIRST, { limits: { maxUpdateBytes: 2 } }),
      'UPDATE_TOO_LARGE',
      'kind=1',
    );
    expectProtocolError(
      () => decodeChunk(V.KIND2_FIRST, { limits: { maxUpdateBytes: 2 } }),
      'UPDATE_TOO_LARGE',
      'kind=2',
    );
  });

  it('红灯 R14（AC2 编码侧对称校验 R9）：decode 产物被改写为违例字段后 encode 必须 MALFORMED_FRAME（先验证后写）', () => {
    const tid0 = expectChunk(decodeChunk(V.KIND0_FIRST));
    tid0.transferId = 0;
    expectProtocolError(
      () => encodeMessage(tid0, { sequence: 99 }),
      'MALFORMED_FRAME',
      'encode transferId=0',
    );

    const indexOutOfRange = expectChunk(decodeChunk(V.KIND0_FIRST));
    indexOutOfRange.chunkIndex = indexOutOfRange.chunkCount;
    expectProtocolError(
      () => encodeMessage(indexOutOfRange, { sequence: 99 }),
      'MALFORMED_FRAME',
      'encode chunkIndex=chunkCount',
    );

    const emptyBytes = expectChunk(decodeChunk(V.KIND0_FIRST));
    emptyBytes.bytes = new Uint8Array(0);
    expectProtocolError(
      () => encodeMessage(emptyBytes, { sequence: 99 }),
      'MALFORMED_FRAME',
      'encode 空 bytes',
    );

    const kind2 = expectChunk(decodeChunk(V.KIND2_FIRST));
    kind2.chunkIndex = kind2.chunkCount;
    expectProtocolError(
      () => encodeMessage(kind2, { sequence: 99 }),
      'MALFORMED_FRAME',
      'encode kind=2 chunkIndex=chunkCount',
    );
  });

  it('负控 N1（形态无关·SA8 R34）：未协商 CAP_CHUNKED_UPDATE 的 0x42 帧在 payload 解析前 UNSUPPORTED_MESSAGE_TYPE', () => {
    for (const frameHex of [V.KIND0_FIRST, V.KIND1_FIRST, V.OLD_SIX_FIELD]) {
      expectProtocolError(
        () => decodeChunk(frameHex, { selectedCapabilities: 0 }),
        'UNSUPPORTED_MESSAGE_TYPE',
      );
    }
    expect(CAP_CHUNKED_UPDATE).toBe(CAP_BIT);
  });

  it('负控 N2（形态无关）：selectedCapabilities 非法值急切 CONNECTION_POLICY_VIOLATION', () => {
    expectProtocolError(
      () => decodeChunk(V.KIND0_FIRST, { selectedCapabilities: -1 }),
      'CONNECTION_POLICY_VIOLATION',
    );
    expectProtocolError(
      () => decodeChunk(V.KIND0_FIRST, { selectedCapabilities: 1.5 }),
      'CONNECTION_POLICY_VIOLATION',
    );
  });

  it('负控 N3（改写不波及它域）：UPDATE 0x40 逐字节往返回归', () => {
    const golden = GOLDEN.find((entry) => entry.messageType === 0x40);
    expect(golden, 'UPDATE golden fixture 必须存在').toBeDefined();
    const updateFrame = golden!.frameHex;
    const decoded = decodeMessage(hexToBytes(updateFrame));
    if (decoded.message.kind !== 'UPDATE') throw new Error(`期望 UPDATE，实际 ${decoded.message.kind}`);
    expect(
      bytesToHex(encodeMessage(decoded.message, { sequence: decoded.header.sequence })),
    ).toBe(updateFrame);
  });
});
