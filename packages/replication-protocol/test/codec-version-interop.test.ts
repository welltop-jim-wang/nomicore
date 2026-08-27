/**
 * SA6 红灯测试 — 版本/capability 协商矩阵 + 锁定 yjs/y-protocols/lib0 组合互通（issue #135）。
 *
 * 契约：docs/protocols/instance-replication-v1.md §6.1/§6.2（HELLO 显式枚举版本、required/
 * optional capability bitset、Hub 取共同最高版本、required 不支持则拒绝、optional 取交集）、
 * §4（Yjs sync bytes 使用 y-protocols/sync 兼容语义）+ §22（版本协商全矩阵、锁定组合互通矩阵）。
 * 绝不靠消息数值猜测协议版本（§3 envelopeVersion 与 HELLO protocolVersions 是两个独立版本层）。
 */
import { describe, expect, it } from 'vitest';
import { decodeMessage, encodeMessage, selectCapabilities, selectProtocolVersion } from '@nomicore/replication-protocol';
import * as Y from 'yjs';
import { GOLDEN, hexToBytes } from './fixtures';

const NS = 'ns-0123456789abcdef0123456789abcdef';
const RID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('selectProtocolVersion：共同最高版本（§6.1），全矩阵', () => {
  it.each([
    { peer: [1], hub: [1], expected: 1 },
    { peer: [3, 2, 1], hub: [2, 1], expected: 2 },
    { peer: [3, 2, 1], hub: [1], expected: 1 },
    { peer: [3, 2, 1], hub: [5, 4, 3], expected: 3 },
    { peer: [1, 2], hub: [2, 1], expected: 2 },
    { peer: [5], hub: [5, 4, 3, 2, 1], expected: 5 },
    // 无交集 → null（调用方映射 UNSUPPORTED_PROTOCOL_VERSION）
    { peer: [1], hub: [2], expected: null },
    { peer: [1], hub: [], expected: null },
    { peer: [], hub: [1], expected: null },
  ])('peer=$peer, hub=$hub → $expected', ({ peer, hub, expected }) => {
    expect(selectProtocolVersion(peer, hub)).toBe(expected);
  });

  it('与输入顺序无关（交集语义），且总选最高共同版本', () => {
    expect(selectProtocolVersion([1, 3, 2], [3, 2, 1])).toBe(3);
    expect(selectProtocolVersion([9, 2, 7, 5], [5, 2])).toBe(5);
  });
});

describe('selectCapabilities：required 拒绝 / optional 取交集（§6.1/§6.2）', () => {
  it.each([
    { required: 0, optional: 0, supported: 0, ok: true, selected: 0 },
    { required: 0, optional: 0, supported: 0b111, ok: true, selected: 0 },
    { required: 0, optional: 0b100, supported: 0b111, ok: true, selected: 0b100 },
    { required: 0, optional: 0b111, supported: 0b101, ok: true, selected: 0b101 },
    { required: 0b101, optional: 0b100, supported: 0b111, ok: true, selected: 0b100 },
    { required: 0b101, optional: 0, supported: 0b010, ok: false, selected: 0 },
    { required: 0b001, optional: 0b100, supported: 0b011, ok: true, selected: 0b000 },
  ])('required=$required optional=$optional supported=$supported → $ok/$selected', ({ required, optional, supported, ok, selected }) => {
    expect(selectCapabilities(required, optional, supported)).toEqual({ ok, selected });
  });
});

describe('HELLO → 版本选择 → HELLO_ACK 全流程（显式协商，不猜版本）', () => {
  it('HELLO(golden seq=1) 解码 → 选共同最高版本 → 构造 HELLO_ACK roundtrip', () => {
    const hello = decodeMessage(hexToBytes(GOLDEN[0]!.frameHex));
    if (hello.message.kind !== 'HELLO') throw new Error('fixture');
    const version = selectProtocolVersion(hello.message.protocolVersions, [5, 4, 3, 2, 1]);
    expect(version).toBe(3);
    const caps = selectCapabilities(hello.message.requiredCapabilities, hello.message.optionalCapabilities, 0);
    expect(caps).toEqual({ ok: true, selected: 0 });
    const ackBytes = encodeMessage(
      {
        kind: 'HELLO_ACK',
        hubInstanceId: 'hub-a',
        protocolVersion: version!,
        selectedCapabilities: caps.selected,
        connectionNonce: hello.message.connectionNonce,
        connectionId: 'conn-9',
      },
      { sequence: 1 },
    );
    const ack = decodeMessage(ackBytes);
    expect(ack.message.kind).toBe('HELLO_ACK');
    if (ack.message.kind !== 'HELLO_ACK') return;
    expect(ack.message.protocolVersion).toBe(3);
    expect(ack.message.connectionNonce).toEqual(hello.message.connectionNonce);
  });

  it('required 能力不支持 → 拒绝（ok=false；调用方映射 UNSUPPORTED_CAPABILITY）', () => {
    const hello = decodeMessage(hexToBytes(GOLDEN[0]!.frameHex));
    if (hello.message.kind !== 'HELLO') throw new Error('fixture');
    const res = selectCapabilities(0b1000, 0, 0b0111);
    expect(res.ok).toBe(false);
    expect(res.selected).toBe(0);
    expect(hello.message.requiredCapabilities).toBe(0); // golden 里 v1 required=0
  });
});

describe('锁定 yjs/y-protocols/lib0 组合互通矩阵（§4/§22）', () => {
  function makeDoc(content: Record<string, string>): Y.Doc {
    const doc = new Y.Doc();
    const map = doc.getMap('root');
    for (const [k, v] of Object.entries(content)) map.set(k, v);
    return doc;
  }

  it('UPDATE：真实 Yjs update 经 codec 帧往返后 apply 收敛（内容与 state vector 一致）', () => {
    const a = makeDoc({ k1: 'v1', k2: 'v2' });
    const update = Y.encodeStateAsUpdate(a);

    const frame = encodeMessage({ kind: 'UPDATE', namespaceId: NS, update }, { sequence: 1 });
    const decoded = decodeMessage(frame);
    if (decoded.message.kind !== 'UPDATE') throw new Error('fixture');
    expect(decoded.message.update).toEqual(update); // codec 不解释/不改写 Yjs 字节

    const b = new Y.Doc();
    Y.applyUpdate(b, decoded.message.update);
    expect(Array.from(Y.encodeStateVector(b))).toEqual(Array.from(Y.encodeStateVector(a)));
    expect(b.getMap('root').toJSON()).toEqual({ k1: 'v1', k2: 'v2' });
  });

  it('BOOTSTRAP_SNAPSHOT：完整 Y.encodeStateAsUpdate 快照经 codec 往返后 apply 到空 doc 收敛', () => {
    const a = makeDoc({ x: '1', y: '2' });
    const snapshot = Y.encodeStateAsUpdate(a);
    const frame = encodeMessage(
      { kind: 'BOOTSTRAP_SNAPSHOT', namespaceId: NS, replicationId: RID, replicationEpoch: 1, snapshot },
      { sequence: 5 },
    );
    const decoded = decodeMessage(frame);
    if (decoded.message.kind !== 'BOOTSTRAP_SNAPSHOT') throw new Error('fixture');
    expect(decoded.message.snapshot).toEqual(snapshot);
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, decoded.message.snapshot);
    expect(Array.from(Y.encodeStateVector(fresh))).toEqual(Array.from(Y.encodeStateVector(a)));
    expect(fresh.getMap('root').toJSON()).toEqual({ x: '1', y: '2' });
  });

  it('SYNC_STEP1：真实 state vector 经 codec 往返字节不变（reconcile 输入正确）', () => {
    const a = makeDoc({ a: '1' });
    const sv = Y.encodeStateVector(a);
    const frame = encodeMessage({ kind: 'SYNC_STEP1', namespaceId: NS, syncRoundId: 7, stateVector: sv }, { sequence: 2 });
    const decoded = decodeMessage(frame);
    if (decoded.message.kind !== 'SYNC_STEP1') throw new Error('fixture');
    expect(decoded.message.stateVector).toEqual(sv);
  });

  it('SYNC_STEP2：y-protocols/sync step2 diff 字节经 codec 帧往返不变', () => {
    // y-protocols/sync 的 Step2 diff 为 [1, update] 结构（writeSyncStep2 语义）；
    // 此处以 Y.encodeStateAsUpdate 产生的 diff 字节验证 codec 的 varUint8Array 载荷无改写。
    const a = makeDoc({ a: '100' });
    const diff = Y.encodeStateAsUpdate(a);
    const frame = encodeMessage(
      { kind: 'SYNC_STEP2', namespaceId: NS, syncRoundId: 7, relatedStep1Sequence: 3, update: diff },
      { sequence: 4 },
    );
    const decoded = decodeMessage(frame);
    if (decoded.message.kind !== 'SYNC_STEP2') throw new Error('fixture');
    expect(decoded.message.update).toEqual(diff);
  });

  it('空 diff 合规（允许空 diff，§9.2）', () => {
    const frame = encodeMessage(
      { kind: 'SYNC_STEP2', namespaceId: NS, syncRoundId: 1, relatedStep1Sequence: 1, update: new Uint8Array(0) },
      { sequence: 1 },
    );
    const decoded = decodeMessage(frame);
    if (decoded.message.kind !== 'SYNC_STEP2') throw new Error('fixture');
    expect(decoded.message.update.byteLength).toBe(0);
  });

  it('codec 全程产出/解码纯 Uint8Array（不依赖 Node Buffer）', () => {
    const doc = makeDoc({ z: '9' });
    const update = Y.encodeStateAsUpdate(doc);
    expect(Object.getPrototypeOf(update)).toBe(Uint8Array.prototype);
    const frame = encodeMessage({ kind: 'UPDATE', namespaceId: NS, update }, { sequence: 1 });
    expect(Object.getPrototypeOf(frame)).toBe(Uint8Array.prototype);
    const decoded = decodeMessage(frame);
    if (decoded.message.kind !== 'UPDATE') throw new Error('fixture');
    expect(decoded.message.update).toEqual(update);
    expect(Object.getPrototypeOf(decoded.message.update)).toBe(Uint8Array.prototype);
  });
});
