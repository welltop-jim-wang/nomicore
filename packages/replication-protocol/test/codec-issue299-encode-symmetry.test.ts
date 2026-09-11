/**
 * issue #299（#295 切片 1）encode 侧对称补测 — SA2 F2 授权落点（设计 §11 ALLOW / §12 AC2 编码侧对称行）。
 *
 * 契约锚点：
 * - 协议 §10.3「codec 级单帧规则（encode/decode 同一套，违者 MALFORMED_FRAME）」+ 单形态段
 *   （kind ∈ {0,1,2}；绑定块当且仅当 kind≠0 ∧ chunkIndex=0 存在；kind=1 → replicationId
 *   varString + replicationEpoch varUint；kind=2 → syncRoundId varUint）。
 * - ADR 0019：单形态恒用、同版本部署（无归一化/兼容面）。
 * - 设计 D4 裁决：encode 侧违反 iff 规则一律**严格拒绝**（不做 writer 归一化——静默丢弃/补默认
 *   会改写调用方输入并破坏 decode→encode→decode 等价）；值域校验只含结构性规则与
 *   varUint/varString 可编码性（replicationId 文法 / epoch 语义域属 §8.1/§9.2 后续切片，不校验）。
 *
 * 断言清单（设计 §12 冻结；负控 ①–⑧ + SA2 O5 建议的 ⑨⑩）：
 *   ① transferKind=1 ∧ chunkIndex>0 携 replicationId(+replicationEpoch)
 *   ② transferKind=0 携 syncRoundId
 *   ③ transferKind=1 ∧ chunkIndex=0 缺 replicationEpoch（仅携 replicationId）
 *   ④ transferKind=3 经 encode（JS/cast 面）
 *   ⑤ transferKind=2 ∧ chunkIndex=0 携 replicationId（跨族污染）
 *   ⑥ transferKind=2 ∧ chunkIndex>0 携 syncRoundId
 *   ⑦ transferKind=0 携 replicationId / 携 replicationEpoch（与 ② 合成 kind=0 三分支）
 *   ⑧ transferKind=1 ∧ chunkIndex=0 缺 replicationId
 *   ⑨ transferKind=2 ∧ chunkIndex=0 缺 syncRoundId（kind=2「必须存在」方向）
 *   ⑩ transferKind=1 ∧ chunkIndex=0 携 syncRoundId（kind=1 跨族污染另一方向）
 * 正控 P1–P5：kind=0 纯五字段 / kind=1 首 chunk 完整绑定块 / kind=2 首 chunk syncRoundId /
 *   kind=1 非首 chunk 无绑定块 / kind=2 非首 chunk 无绑定块（每组负控前置相近正控，且 P2/P3
 *   以规范算术向量锁定绑定块位置 = totalBytes 之后、bytes 之前 + decode→encode 逐字节无损）。
 *
 * 纪律：无 skip/only/todo、无 env override、无 fallback、无源码字符串/正则断言、零 real sleep；
 * 不修改 SA6 契约三文件（codec-issue299-ac-red.test.ts 冻结向量仍为该形态的验收权威）。
 */
import { describe, expect, it } from 'vitest';
import {
  CAP_CHUNKED_UPDATE,
  type DecodedMessage,
  ProtocolError,
  type UpdateChunkMsg,
  decodeMessage,
  encodeMessage,
} from '@nomicore/replication-protocol';
import { NS, buildFrameHex, bytesToHex, hexToBytes } from './fixtures';

// ---------------------------------------------------------------- 规范算术常量（字面量先行）

const UPDATE_CHUNK_CODE = 0x42;
const RID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'; // 32 hex 字符（varString 长度前缀 = 0x20）

function asciiHex(s: string): string {
  return Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, '0')).join('');
}

const NS_HEX = '23' + asciiHex(NS); // varString(len 35) + ASCII
const RID_HEX = '20' + asciiHex(RID); // varString(len 32) + ASCII

/** 锁定向量（§10.3 字段表纯算术构造；绑定块位于 totalBytes 之后、bytes 之前）。 */
const PINNED = Object.freeze({
  /** P2：kind=1 首 chunk，绑定块 replicationId + replicationEpoch(1)。 */
  KIND1_FIRST:
    '01' +
    NS_HEX +
    '01' + // transferId
    '00' + // chunkIndex
    '03' + // chunkCount
    'd804' + // totalBytes 600
    RID_HEX +
    '01' + // replicationEpoch
    '03' + '0a0b0c', // bytes
  /** P3：kind=2 首 chunk，绑定块 syncRoundId(5)。 */
  KIND2_FIRST:
    '02' + NS_HEX + '09' + '00' + '02' + 'e807' + '05' + '04' + 'deadbeef',
});

function frame(payloadHex: string, sequence: number): string {
  return buildFrameHex(UPDATE_CHUNK_CODE, sequence, payloadHex);
}

function decodeChunk(frameHex: string): DecodedMessage {
  return decodeMessage(hexToBytes(frameHex), { selectedCapabilities: CAP_CHUNKED_UPDATE });
}

/** 取 UPDATE_CHUNK 消息（判别联合收窄，零 cast）。 */
function chunkOf(decoded: DecodedMessage): UpdateChunkMsg {
  if (decoded.message.kind !== 'UPDATE_CHUNK') {
    throw new Error(`期望 UPDATE_CHUNK，实际 ${decoded.message.kind}`);
  }
  return decoded.message;
}

/** encode 违例断言：必须 ProtocolError(MALFORMED_FRAME)，绝无未分类异常/静默产出。 */
function expectEncodeMalformed(message: UpdateChunkMsg, label: string): void {
  let caught: unknown;
  try {
    encodeMessage(message, { sequence: 99 });
  } catch (error) {
    caught = error;
  }
  expect(caught, `${label}：期望 ProtocolError(MALFORMED_FRAME)`).toBeInstanceOf(ProtocolError);
  expect((caught as ProtocolError).code, label).toBe('MALFORMED_FRAME');
}

function chunk(overrides: Partial<UpdateChunkMsg>): UpdateChunkMsg {
  return {
    kind: 'UPDATE_CHUNK',
    transferKind: 0,
    namespaceId: NS,
    transferId: 1,
    chunkIndex: 0,
    chunkCount: 3,
    totalBytes: 600,
    bytes: Uint8Array.from([0x0a, 0x0b, 0x0c]),
    ...overrides,
  };
}

/** 正控：encode 成功 → decode → 逐字段一致 → re-encode 逐字节一致（返回解码消息）。 */
function expectEncodable(message: UpdateChunkMsg, label: string): UpdateChunkMsg {
  const encoded = encodeMessage(message, { sequence: 7 });
  const decoded = chunkOf(decodeMessage(encoded, { selectedCapabilities: CAP_CHUNKED_UPDATE }));
  expect(decoded, `${label}：encode→decode 字段一致`).toEqual(message);
  expect(bytesToHex(encodeMessage(decoded, { sequence: 7 })), `${label}：re-encode 逐字节`).toBe(
    bytesToHex(encoded),
  );
  return decoded;
}

// ---------------------------------------------------------------- 补测（encode 侧 iff 严格拒绝）

describe('issue #299：UPDATE_CHUNK encode 侧绑定块 iff 严格拒绝（D4 / SA2 F2 冻结清单）', () => {
  it('正控 P1（kind=0 纯五字段）与负控 ②⑦（kind=0 携任一绑定块成员 → MALFORMED_FRAME）', () => {
    expectEncodable(chunk({}), 'P1 kind=0 纯五字段');

    expectEncodeMalformed(chunk({ syncRoundId: 5 }), '② kind=0 + syncRoundId');
    expectEncodeMalformed(chunk({ replicationId: RID }), '⑦ kind=0 + replicationId');
    expectEncodeMalformed(chunk({ replicationEpoch: 1 }), '⑦ kind=0 + replicationEpoch');
    // 三成员联携（kind=0 完整拒绝面）
    expectEncodeMalformed(
      chunk({ replicationId: RID, replicationEpoch: 1, syncRoundId: 5 }),
      '②⑦ kind=0 + 三成员',
    );
  });

  it('正控 P2（kind=1 首 chunk 完整绑定块）锁定位置与往返；负控 ③⑧⑩（缺成员/跨族污染 → MALFORMED_FRAME）', () => {
    // P2 正控：规范算术向量锁定绑定块位置 + decode→encode 逐字节无损
    const pinned = frame(PINNED.KIND1_FIRST, 33);
    const decodedPinned = chunkOf(decodeChunk(pinned));
    expect(decodedPinned.transferId).toBe(1);
    expect(decodedPinned.chunkIndex).toBe(0);
    expect(decodedPinned.totalBytes).toBe(600);
    expect(decodedPinned.replicationId).toBe(RID);
    expect(decodedPinned.replicationEpoch).toBe(1);
    expect(bytesToHex(encodeMessage(decodedPinned, { sequence: 33 }))).toBe(pinned);

    const p2 = expectEncodable(
      chunk({ transferKind: 1, replicationId: RID, replicationEpoch: 1 }),
      'P2 kind=1 首 chunk 完整绑定块',
    );
    expect(p2.replicationId).toBe(RID);
    expect(p2.replicationEpoch).toBe(1);

    // ③ 缺 replicationEpoch（仅携 replicationId）
    expectEncodeMalformed(chunk({ transferKind: 1, replicationId: RID }), '③ 缺 replicationEpoch');
    // ⑧ 缺 replicationId（仅携 replicationEpoch）
    expectEncodeMalformed(chunk({ transferKind: 1, replicationEpoch: 1 }), '⑧ 缺 replicationId');
    // ⑩ 携 syncRoundId（kind=1 跨族污染另一方向）
    expectEncodeMalformed(
      chunk({ transferKind: 1, replicationId: RID, replicationEpoch: 1, syncRoundId: 5 }),
      '⑩ kind=1 首 chunk + syncRoundId',
    );
  });

  it('正控 P3（kind=2 首 chunk syncRoundId）锁定位置与往返；负控 ⑤⑨（携异族成员/缺自身成员 → MALFORMED_FRAME）', () => {
    const pinned = frame(PINNED.KIND2_FIRST, 34);
    const decodedPinned = chunkOf(decodeChunk(pinned));
    expect(decodedPinned.transferId).toBe(9);
    expect(decodedPinned.chunkIndex).toBe(0);
    expect(decodedPinned.totalBytes).toBe(1000);
    expect(decodedPinned.syncRoundId).toBe(5);
    expect(bytesToHex(encodeMessage(decodedPinned, { sequence: 34 }))).toBe(pinned);

    const p3 = expectEncodable(chunk({ transferKind: 2, transferId: 9, chunkCount: 2, totalBytes: 1000, syncRoundId: 5 }), 'P3 kind=2 首 chunk syncRoundId');
    expect(p3.syncRoundId).toBe(5);

    // ⑤ 携 replicationId（跨族污染）
    expectEncodeMalformed(
      chunk({ transferKind: 2, syncRoundId: 5, replicationId: RID }),
      '⑤ kind=2 首 chunk + replicationId',
    );
    expectEncodeMalformed(
      chunk({ transferKind: 2, syncRoundId: 5, replicationId: RID, replicationEpoch: 1 }),
      '⑤ kind=2 首 chunk + replicationId/replicationEpoch',
    );
    // ⑨ 缺 syncRoundId（kind=2「必须存在」方向）
    expectEncodeMalformed(chunk({ transferKind: 2 }), '⑨ kind=2 首 chunk 缺 syncRoundId');
  });

  it('正控 P4/P5（kind=1/2 非首 chunk 无绑定块）；负控 ①⑥（非首 chunk 携绑定块 → MALFORMED_FRAME）', () => {
    const p4 = expectEncodable(
      chunk({ transferKind: 1, chunkIndex: 2 }),
      'P4 kind=1 非首 chunk 无绑定块',
    );
    expect(p4.replicationId).toBeUndefined();
    expect(p4.replicationEpoch).toBeUndefined();

    const p5 = expectEncodable(
      chunk({ transferKind: 2, chunkIndex: 2 }),
      'P5 kind=2 非首 chunk 无绑定块',
    );
    expect(p5.syncRoundId).toBeUndefined();

    // ① kind=1 非首 chunk 携 replicationId(+replicationEpoch)
    expectEncodeMalformed(
      chunk({ transferKind: 1, chunkIndex: 2, replicationId: RID }),
      '① kind=1 idx>0 + replicationId',
    );
    expectEncodeMalformed(
      chunk({ transferKind: 1, chunkIndex: 2, replicationId: RID, replicationEpoch: 1 }),
      '① kind=1 idx>0 + replicationId/replicationEpoch',
    );
    // ⑥ kind=2 非首 chunk 携 syncRoundId
    expectEncodeMalformed(
      chunk({ transferKind: 2, chunkIndex: 2, syncRoundId: 5 }),
      '⑥ kind=2 idx>0 + syncRoundId',
    );
  });

  it('负控 ④（transferKind=3 经 encode / JS-cast 面 → MALFORMED_FRAME；kind 值域先于写出）', () => {
    expectEncodable(chunk({}), '④ 前置正控 kind=0');
    const cast = (transferKind: number): UpdateChunkMsg =>
      ({ ...chunk({}), transferKind }) as unknown as UpdateChunkMsg;
    expectEncodeMalformed(cast(3), '④ transferKind=3');
    expectEncodeMalformed(cast(127), '④ transferKind=127');
    expectEncodeMalformed(cast(-1), '④ transferKind=-1');
    expectEncodeMalformed(cast(1.5), '④ transferKind=1.5');
    expectEncodeMalformed(cast(Number.NaN), '④ transferKind=NaN');
  });
});
