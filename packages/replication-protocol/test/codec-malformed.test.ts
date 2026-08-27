/**
 * SA6 红灯测试 — malformed 输入分类（issue #135）。
 *
 * 契约：docs/protocols/instance-replication-v1.md §4（拒绝截断、溢出、非 canonical 数值编码、
 * 非法 UTF-8、错误 optional marker、超界 bytes、未声明尾随）与 §22（非法 namespaceId、
 * 错误 optional/list count、非法 sequence/ACK、长度少一/多一/溢出/巨大声明短 body）。
 *
 * 分类规则（本红灯测试锚定，实现不得静默吞掉或改变分类）：
 * - 全部 payload 级违规 → MALFORMED_FRAME（connection fatal）；
 * - 帧级违规 → BAD_MAGIC / UNSUPPORTED_ENVELOPE_VERSION / UNSUPPORTED_FLAGS /
 *   MALFORMED_FRAME(reserved) / UNSUPPORTED_MESSAGE_TYPE / FRAME_TOO_LARGE /
 *   FRAME_LENGTH_MISMATCH / SEQUENCE_VIOLATION；
 * - 字段级 limit 超限 → 对应 namespace 错误（UPDATE_TOO_LARGE / BOOTSTRAP_TOO_LARGE / SYNC_DIFF_TOO_LARGE）。
 * - ERROR 帧的 fatal/retryable/scope/code 必须与注册表一致，否则 MALFORMED_FRAME。
 */
import { describe, expect, it } from 'vitest';
import { ProtocolError, decodeMessage, encodeMessage } from '@nomicore/replication-protocol';
import { buildFrameHex, hexToBytes } from './fixtures';

const NS = 'ns-0123456789abcdef0123456789abcdef';
const RID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

const NS_VSTR = '236e732d3031323334353637383961626364656630313233343536373839616263646566';
const RID_VSTR = '206131623263336434653566363037313832393361346235633664376538663930';
const NONCE_VSTR = '10000102030405060708090a0b0c0d0e0f';
const HELLO_TAIL = '030102030000000000000000' + NONCE_VSTR; // version list 3 项 + caps + nonce

/** ASCII varString 编码（len < 128 单字节前缀）— 仅测试用 */
function asciiVarStr(s: string): string {
  const bytes = Array.from(s).map((c) => c.charCodeAt(0));
  if (bytes.length > 127) throw new Error('test helper ascii only');
  return bytes.length.toString(16).padStart(2, '0') + bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function frame(messageType: number, seq: number, payloadHex: string): Uint8Array {
  return hexToBytes(buildFrameHex(messageType, seq, payloadHex));
}

function expectProtocolError(fn: () => unknown, code: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught, `expected ProtocolError(${code})`).toBeInstanceOf(ProtocolError);
  expect((caught as ProtocolError).code).toBe(code);
}

describe('非法 UTF-8（§4/§22）', () => {
  it('varString 含非法 UTF-8（0xc3 0x28）→ MALFORMED_FRAME（OPEN_OK namespaceId 槽）', () => {
    // ns 槽内容 = 'ns-' + [0xc3,0x28] + 'a'*30，长度仍 35
    const badNs = '6e732d' + 'c328' + '61'.repeat(30);
    expect(badNs.length).toBe(70);
    // varString len 0x23 + badNs 的字节序列
    const frameBytes = frame(0x11, 7, '23' + badNs + '01' + RID_VSTR + '01');
    expectProtocolError(() => decodeMessage(frameBytes), 'MALFORMED_FRAME');
  });

  it('GOAWAY reasonCode 槽含非法 UTF-8 → MALFORMED_FRAME', () => {
    const bad = '02' + 'c328';
    const frameBytes = frame(0x03, 3, bad + '8827' + '01' + 'd00f');
    expectProtocolError(() => decodeMessage(frameBytes), 'MALFORMED_FRAME');
  });
});

describe('非法 namespaceId（§4 固定格式 ^ns-[0-9a-f]{32}$）', () => {
  const badNamespaces = [
    'ns-' + '0'.repeat(31), // 短
    'ns-' + '0'.repeat(33), // 长
    'ns-0123456789ABCDEF0123456789ABCDEF', // 大写
    'ns-0123456789abcdef0123456789abcdefg', // 非 hex（g）
    'xx-0123456789abcdef0123456789abcdef', // 前缀错
    'ns0123456789abcdef0123456789abcdef', // 缺连字符
    '', // 空
    'ns-', // 空 hex
  ];
  it('UPDATE 首字段 namespaceId 不匹配 → MALFORMED_FRAME', () => {
    for (const bad of badNamespaces) {
      const frameBytes = frame(0x40, 17, asciiVarStr(bad) + '03040506');
      expectProtocolError(() => decodeMessage(frameBytes), 'MALFORMED_FRAME');
    }
  });

  it('OPEN_OK / OPEN_NAMESPACE / SYNC_STEP2 / ERROR(namespace) 的 namespaceId 同样校验', () => {
    const bad = 'ns-' + '0'.repeat(31);
    expectProtocolError(
      () => decodeMessage(frame(0x11, 7, asciiVarStr(bad) + '01' + RID_VSTR + '01')),
      'MALFORMED_FRAME',
    );
    expectProtocolError(
      () => decodeMessage(frame(0x10, 6, asciiVarStr(bad) + '01' + '01' + RID_VSTR + '01' + '01')),
      'MALFORMED_FRAME',
    );
    expectProtocolError(
      () => decodeMessage(frame(0x31, 14, asciiVarStr(bad) + '01' + '02' + '03010203')),
      'MALFORMED_FRAME',
    );
    // ERROR namespace scope：scope 01 + code + bits + no related + ns 槽
    const badErr = frame(0x04, 5, '01' + '1453594e435f53544154455f56494f4c4154494f4e' + '0100' + '00' + '01' + asciiVarStr(bad) + '0f787878787878787878787878787878');
    expectProtocolError(() => decodeMessage(badErr), 'MALFORMED_FRAME');
  });
});

describe('非 canonical 数值编码（§4 拒绝非 canonical varUint）', () => {
  it('HELLO_ACK protocolVersion 2 编码为 82 00 → MALFORMED_FRAME', () => {
    const frameBytes = frame(0x02, 2, '056875622d61' + '8200' + '00000000' + NONCE_VSTR + '06636f6e6e2d31');
    expectProtocolError(() => decodeMessage(frameBytes), 'MALFORMED_FRAME');
  });

  it('UPDATE_ACK ackedSequence 6 编码为 86 00 → MALFORMED_FRAME；零值编码为 80 00 → MALFORMED_FRAME', () => {
    expectProtocolError(
      () => decodeMessage(frame(0x41, 18, NS_VSTR + '8600')),
      'MALFORMED_FRAME',
    );
    expectProtocolError(
      () => decodeMessage(frame(0x41, 18, NS_VSTR + '8000')),
      'MALFORMED_FRAME',
    );
  });

  it('规范最短形式（同值单字节）正常通过', () => {
    const d = decodeMessage(frame(0x41, 18, NS_VSTR + '06'));
    expect(d.message.kind).toBe('UPDATE_ACK');
  });
});

describe('错误 optional marker / list count（§4/§22）', () => {
  it('optional marker 非 0/1（GOAWAY retryAfterMs=02）→ MALFORMED_FRAME', () => {
    expectProtocolError(
      () => decodeMessage(frame(0x03, 3, '115345525645525f52455354415254494e47' + '8827' + '02')),
      'MALFORMED_FRAME',
    );
  });

  it('optional marker=01 但值缺失（截断）→ MALFORMED_FRAME', () => {
    expectProtocolError(
      () => decodeMessage(frame(0x03, 3, '115345525645525f52455354415254494e47' + '8827' + '01')),
      'MALFORMED_FRAME',
    );
  });

  it('ERROR relatedSequence marker=02 → MALFORMED_FRAME', () => {
    expectProtocolError(
      () => decodeMessage(frame(0x04, 4, '00' + '094241445f4d41474943' + '0100' + '02' + '00' + '09626164206d61676963')),
      'MALFORMED_FRAME',
    );
  });

  it('HELLO protocolVersions list count 错误：count=04 只有 3 项（截断）→ MALFORMED', () => {
    expectProtocolError(
      () => decodeMessage(frame(0x01, 1, '06706565722d61056875622d61' + '04' + '010203' + '00000000' + '00000000' + NONCE_VSTR)),
      'MALFORMED_FRAME',
    );
  });

  it('list count=02 但实际 3 项（尾部未消费）→ MALFORMED', () => {
    expectProtocolError(
      () => decodeMessage(frame(0x01, 1, '06706565722d61056875622d61' + '02' + '010203' + '00000000' + '00000000' + NONCE_VSTR)),
      'MALFORMED_FRAME',
    );
  });

  it('count=00（空列表，违反 §6.1 至少一个）→ MALFORMED', () => {
    expectProtocolError(
      () => decodeMessage(frame(0x01, 1, '06706565722d61056875622d61' + '00' + '00000000' + '00000000' + NONCE_VSTR)),
      'MALFORMED_FRAME',
    );
  });

  it('bytes 字段巨大声明 + 短 body（nonce 声明 0xff / 2^35）→ MALFORMED，绝不越界分配', () => {
    expectProtocolError(
      () => decodeMessage(frame(0x01, 1, '06706565722d61056875622d61' + '010203' + '00000000' + '00000000' + 'ff000102030405060708090a0b0c0d0e0f')),
      'MALFORMED_FRAME',
    );
    expectProtocolError(
      () => decodeMessage(frame(0x01, 1, '06706565722d61056875622d61' + '010203' + '00000000' + '00000000' + 'ffffffff7f000102030405060708090a0b0c0d0e0f')),
      'MALFORMED_FRAME',
    );
  });
});

describe('HELLO 字段规则（§6.1）', () => {
  it('peerInstanceId / expectedHubInstanceId 文法 ^[a-z][a-z0-9-]{0,62}$ 违规 → MALFORMED', () => {
    const bad = [
      'Peer-a', // 大写
      '9peer', // 数字开头
      'a'.repeat(64), // 超长
      'peer_a', // 下划线
    ];
    for (const id of bad) {
      expectProtocolError(
        () => decodeMessage(frame(0x01, 1, asciiVarStr(id) + '056875622d61' + HELLO_TAIL)),
        'MALFORMED_FRAME',
      );
      expectProtocolError(
        () => decodeMessage(frame(0x01, 1, '06706565722d61' + asciiVarStr(id) + HELLO_TAIL)),
        'MALFORMED_FRAME',
      );
    }
  });

  it('protocolVersions 降序无重复（[1,2]/[1,1]）→ MALFORMED', () => {
    expectProtocolError(
      () => decodeMessage(frame(0x01, 1, '06706565722d61056875622d61' + '02' + '0102' + '00000000' + '00000000' + NONCE_VSTR)),
      'MALFORMED_FRAME',
    );
    expectProtocolError(
      () => decodeMessage(frame(0x01, 1, '06706565722d61056875622d61' + '02' + '0101' + '00000000' + '00000000' + NONCE_VSTR)),
      'MALFORMED_FRAME',
    );
  });

  it('connectionNonce 必须固定 16 bytes（15 / 17）→ MALFORMED', () => {
    const nonce15 = '0f' + '00'.repeat(15);
    const nonce17 = '11' + '00'.repeat(17);
    expectProtocolError(
      () => decodeMessage(frame(0x01, 1, '06706565722d61056875622d61' + '010203' + '00000000' + '00000000' + nonce15)),
      'MALFORMED_FRAME',
    );
    expectProtocolError(
      () => decodeMessage(frame(0x01, 1, '06706565722d61056875622d61' + '010203' + '00000000' + '00000000' + nonce17)),
      'MALFORMED_FRAME',
    );
  });
});

describe('OPEN_NAMESPACE identity 成对规则（§7.1）', () => {
  it('hasLocalReplica=true 但 replicationId/replicationEpoch 缺失 → MALFORMED', () => {
    // marker 0 表示 optional 缺席：两个 identity 字段同时缺失
    expectProtocolError(
      () => decodeMessage(frame(0x10, 6, NS_VSTR + '01' + '00' + '00')),
      'MALFORMED_FRAME',
    );
    expectProtocolError(
      () => decodeMessage(frame(0x10, 6, NS_VSTR + '01' + '01' + RID_VSTR + '00')),
      'MALFORMED_FRAME',
    );
  });

  it('hasLocalReplica=false 但出现 identity 字段 → MALFORMED', () => {
    expectProtocolError(
      () => decodeMessage(frame(0x10, 6, NS_VSTR + '00' + '01' + RID_VSTR)),
      'MALFORMED_FRAME',
    );
    expectProtocolError(
      () => decodeMessage(frame(0x10, 6, NS_VSTR + '00' + '01' + '01')),
      'MALFORMED_FRAME',
    );
  });

  it('replicationId 非 32 lowercase hex / replicationEpoch 0 → MALFORMED', () => {
    expectProtocolError(
      () => decodeMessage(frame(0x10, 6, NS_VSTR + '01' + '01' + asciiVarStr(RID.slice(0, 31)) + '01' + '01')),
      'MALFORMED_FRAME',
    );
    expectProtocolError(
      () => decodeMessage(frame(0x10, 6, NS_VSTR + '01' + '01' + '206142433344453546363037313832393361346235633664376538663930' + '01' + '01')),
      'MALFORMED_FRAME',
    );
    expectProtocolError(
      () => decodeMessage(frame(0x10, 6, NS_VSTR + '01' + '01' + RID_VSTR + '01' + '00')),
      'MALFORMED_FRAME',
    );
  });
});

describe('OPEN_OK / BOOTSTRAP_SNAPSHOT / IDENTITY_CHANGED 字段规则（§7.2/§8.1/§11）', () => {
  it('mode 非 0/1 → MALFORMED；replicationEpoch 0 → MALFORMED；replicationId 大写 → MALFORMED', () => {
    expectProtocolError(
      () => decodeMessage(frame(0x11, 7, NS_VSTR + '02' + RID_VSTR + '01')),
      'MALFORMED_FRAME',
    );
    expectProtocolError(
      () => decodeMessage(frame(0x11, 7, NS_VSTR + '01' + RID_VSTR + '00')),
      'MALFORMED_FRAME',
    );
    expectProtocolError(
      () => decodeMessage(frame(0x11, 7, NS_VSTR + '01' + '206142433344453546363037313832393361346235633664376538663930' + '01')),
      'MALFORMED_FRAME',
    );
  });

  it('BOOTSTRAP_SNAPSHOT replicationEpoch 0 → MALFORMED', () => {
    expectProtocolError(
      () => decodeMessage(frame(0x20, 10, NS_VSTR + RID_VSTR + '00' + '0400010203')),
      'MALFORMED_FRAME',
    );
  });

  it('IDENTITY_CHANGED replicationId 非 32 hex → MALFORMED', () => {
    expectProtocolError(
      () => decodeMessage(frame(0x22, 12, NS_VSTR + asciiVarStr(RID.slice(0, 31)) + '01')),
      'MALFORMED_FRAME',
    );
  });
});

describe('ERROR 与注册表一致性（§13：fatal/retryable/scope/code 不可被 wire 篡改）', () => {
  it('BAD_MAGIC 的 wire fatal 位被篡改为 0 → MALFORMED_FRAME', () => {
    // scope 00 + code BAD_MAGIC + fatal 00（注册表为 01）+ retryable 00
    expectProtocolError(
      () => decodeMessage(frame(0x04, 4, '00' + '094241445f4d41474943' + '00' + '00' + '00' + '09626164206d61676963')),
      'MALFORMED_FRAME',
    );
  });

  it('ACK_TIMEOUT 的 wire fatal 位被篡改为 1 → MALFORMED_FRAME（注册表 fatal=false）', () => {
    // scope 01 + code ACK_TIMEOUT + fatal 01（注册表为 00）+ retryable 01 + related 00 + ns + safeMessage
    expectProtocolError(
      () => decodeMessage(frame(0x04, 5, '01' + '0b41434b5f54494d454f5554' + '01' + '01' + '00' + '01' + NS_VSTR + '0178')),
      'MALFORMED_FRAME',
    );
  });

  it('scope 字节非 0/1、未知 code、注册表 scope 不符 → MALFORMED_FRAME', () => {
    expectProtocolError(
      () => decodeMessage(frame(0x04, 4, '02' + '094241445f4d41474943' + '0100' + '00' + '00' + '09626164206d61676963')),
      'MALFORMED_FRAME',
    );
    expectProtocolError(
      () => decodeMessage(frame(0x04, 4, '00' + '0c4e4f5f535543485f434f4445' + '0100' + '00' + '00' + '0178')),
      'MALFORMED_FRAME',
    );
    // scope=connection 但 code 只在 namespace 注册表（SYNC_STATE_VIOLATION）
    expectProtocolError(
      () => decodeMessage(frame(0x04, 4, '00' + '1453594e435f53544154455f56494f4c4154494f4e' + '0100' + '00' + '00' + '0178')),
      'MALFORMED_FRAME',
    );
  });
});

describe('配置字段级 limit（§17/§22：maxBootstrapBytes/maxSyncDiffBytes/maxUpdateBytes）', () => {
  it('decodeMessage：UPDATE 超过 maxUpdateBytes → UPDATE_TOO_LARGE（namespace fatal）', () => {
    const g = frame(0x40, 17, NS_VSTR + '050102030405');
    let caught: unknown;
    try {
      decodeMessage(g, { limits: { maxUpdateBytes: 4 } });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProtocolError);
    const err = caught as ProtocolError;
    expect(err.code).toBe('UPDATE_TOO_LARGE');
    expect(err.scope).toBe('namespace');
    expect(err.fatal).toBe(true);
  });

  it('decodeMessage：BOOTSTRAP_SNAPSHOT 超过 maxBootstrapBytes → BOOTSTRAP_TOO_LARGE', () => {
    let caught: unknown;
    try {
      decodeMessage(frame(0x20, 10, NS_VSTR + RID_VSTR + '01' + '050102030405'), {
        limits: { maxBootstrapBytes: 4 },
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProtocolError);
    expect((caught as ProtocolError).code).toBe('BOOTSTRAP_TOO_LARGE');
  });

  it('decodeMessage：SYNC_STEP2 超过 maxSyncDiffBytes → SYNC_DIFF_TOO_LARGE', () => {
    let caught: unknown;
    try {
      decodeMessage(frame(0x31, 14, NS_VSTR + '01' + '02' + '050102030405'), {
        limits: { maxSyncDiffBytes: 4 },
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProtocolError);
    expect((caught as ProtocolError).code).toBe('SYNC_DIFF_TOO_LARGE');
  });

  it('encodeMessage 同样执行字段级 limit（编码侧不得产出超限帧）', () => {
    expectProtocolError(
      () =>
        encodeMessage(
          { kind: 'UPDATE', namespaceId: NS, update: Uint8Array.from([1, 2, 3, 4, 5]) },
          { limits: { maxUpdateBytes: 4 } },
        ),
      'UPDATE_TOO_LARGE',
    );
  });
});

describe('encode 侧字段校验（先于写入 wire 的输入验证）', () => {
  it('HELLO 非法 instanceId / 非降序版本 / 非 16 字节 nonce → 拒绝', () => {
    expectProtocolError(
      () =>
        encodeMessage({
          kind: 'HELLO',
          peerInstanceId: 'Peer-a',
          expectedHubInstanceId: 'hub-a',
          protocolVersions: [1],
          requiredCapabilities: 0,
          optionalCapabilities: 0,
          connectionNonce: Uint8Array.from({ length: 15 }),
        }),
      'MALFORMED_FRAME',
    );
    expectProtocolError(
      () =>
        encodeMessage({
          kind: 'HELLO',
          peerInstanceId: 'peer-a',
          expectedHubInstanceId: 'hub-a',
          protocolVersions: [1, 2],
          requiredCapabilities: 0,
          optionalCapabilities: 0,
          connectionNonce: Uint8Array.from({ length: 16 }),
        }),
      'MALFORMED_FRAME',
    );
    expectProtocolError(
      () =>
        encodeMessage({
          kind: 'HELLO',
          peerInstanceId: 'peer-a',
          expectedHubInstanceId: 'hub-a',
          protocolVersions: [1],
          requiredCapabilities: 0,
          optionalCapabilities: 0,
          connectionNonce: Uint8Array.from({ length: 17 }),
        }),
      'MALFORMED_FRAME',
    );
  });

  it('OPEN_NAMESPACE identity 成对/格式/epoch 违规 → 拒绝', () => {
    expectProtocolError(
      () =>
        encodeMessage({ kind: 'OPEN_NAMESPACE', namespaceId: NS, hasLocalReplica: true }),
      'MALFORMED_FRAME',
    );
    expectProtocolError(
      () =>
        encodeMessage({
          kind: 'OPEN_NAMESPACE',
          namespaceId: NS,
          hasLocalReplica: false,
          replicationId: RID,
        }),
      'MALFORMED_FRAME',
    );
    expectProtocolError(
      () =>
        encodeMessage({
          kind: 'OPEN_NAMESPACE',
          namespaceId: NS,
          hasLocalReplica: true,
          replicationId: RID.toUpperCase(),
          replicationEpoch: 1,
        }),
      'MALFORMED_FRAME',
    );
    expectProtocolError(
      () =>
        encodeMessage({
          kind: 'OPEN_NAMESPACE',
          namespaceId: NS,
          hasLocalReplica: true,
          replicationId: RID,
          replicationEpoch: 0,
        }),
      'MALFORMED_FRAME',
    );
  });

  it('OPEN_OK mode 非 0/1、namespaceId 非法、非法 namespaceId 通用 → 拒绝', () => {
    expectProtocolError(
      () => encodeMessage({ kind: 'OPEN_OK', namespaceId: NS, mode: 2 as 0 | 1, replicationId: RID, replicationEpoch: 1 }),
      'MALFORMED_FRAME',
    );
    expectProtocolError(
      () => encodeMessage({ kind: 'UPDATE', namespaceId: 'ns-000', update: new Uint8Array(0) }),
      'MALFORMED_FRAME',
    );
  });

  it('GOAWAY 负 drainTimeoutMs 与非负 varUint 违约 → 拒绝', () => {
    expectProtocolError(
      () => encodeMessage({ kind: 'GOAWAY', reasonCode: 'SERVER_RESTARTING', drainTimeoutMs: -1 }),
      'MALFORMED_FRAME',
    );
  });
});
