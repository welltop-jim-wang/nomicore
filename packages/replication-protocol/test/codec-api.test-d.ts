/**
 * SA6 红灯测试（类型层）— `@nomicore/replication-protocol` codec API 契约（issue #135）。
 *
 * 本文件在 vitest --typecheck 下编译并运行类型断言（仓库约定：各包 test 目录下后缀为
 * test-d.ts 的类型测试文件）。当前包尚不存在 → TS2307 模块解析失败 = 预期红灯；
 * 实现包后这些断言即成为 API 形状契约。
 */
import { describe, expectTypeOf, it } from 'vitest';
import {
  type DecodeOptions,
  type DecodedMessage,
  type ErrorInfo,
  type FrameHeader,
  type MessageName,
  type ProtocolError,
  type ReplicationMessage,
  type UpdateChunkMsg,
  type UpdateChunkTransferKind,
  CAP_CHUNKED_UPDATE,
  CONNECTION_ERRORS,
  MESSAGE_REGISTRY,
  MESSAGE_TYPES,
  decodeFrame,
  decodeMessage,
  encodeFrame,
  encodeMessage,
  selectCapabilities,
  selectProtocolVersion,
} from '@nomicore/replication-protocol';

describe('@nomicore/replication-protocol 类型契约', () => {
  it('encodeMessage/decodeMessage 与判别联合 ReplicationMessage 闭合', () => {
    expectTypeOf(encodeMessage).parameter(0).toEqualTypeOf<ReplicationMessage>();
    expectTypeOf(decodeMessage).returns.toMatchTypeOf<DecodedMessage>();
    expectTypeOf<DecodedMessage>().toMatchTypeOf<{ header: FrameHeader; message: ReplicationMessage }>();
    expectTypeOf<DecodedMessage['message']>().toEqualTypeOf<ReplicationMessage>();
  });

  it('message 判别键 kind 为 18 个注册名之一（issue #242 追加 UPDATE_CHUNK）', () => {
    expectTypeOf<ReplicationMessage['kind']>().toEqualTypeOf<MessageName>();
    expectTypeOf(MESSAGE_TYPES).toMatchTypeOf<Record<MessageName, number>>();
    expectTypeOf(MESSAGE_REGISTRY['UPDATE'].code).toEqualTypeOf<number>();
  });

  it('issue #242 类型面：UpdateChunkMsg 成员、CAP_CHUNKED_UPDATE 常量、DecodeOptions.selectedCapabilities', () => {
    expectTypeOf<UpdateChunkMsg>().toMatchTypeOf<{
      kind: 'UPDATE_CHUNK';
      namespaceId: string;
      transferId: number;
      chunkIndex: number;
      chunkCount: number;
      totalBytes: number;
      bytes: Uint8Array;
    }>();
    // issue #295：wire kind 首字段必填、三态命名类型；绑定块成员可选（存在性由 codec 裁决）
    expectTypeOf<UpdateChunkMsg['transferKind']>().toEqualTypeOf<UpdateChunkTransferKind>();
    expectTypeOf<UpdateChunkTransferKind>().toEqualTypeOf<0 | 1 | 2>();
    expectTypeOf<UpdateChunkMsg>().toMatchTypeOf<{
      transferKind: UpdateChunkTransferKind;
      replicationId?: string;
      replicationEpoch?: number;
      syncRoundId?: number;
    }>();
    expectTypeOf<ReplicationMessage>().extract<{ kind: 'UPDATE_CHUNK' }>().toEqualTypeOf<UpdateChunkMsg>();
    // 常量导出为数字型（字面量是否收窄取决于声明边界的 const 推断；值恒等 0x1 由运行时契约
    // codec-issue242-ac-red.test.ts AC1 断言）
    expectTypeOf<typeof CAP_CHUNKED_UPDATE>().toMatchTypeOf<number>();
    expectTypeOf<DecodeOptions>().toMatchTypeOf<{ selectedCapabilities?: number }>();
    // 既有消息成员不受扩容影响（append-only）
    expectTypeOf<ReplicationMessage>().extract<{ kind: 'UPDATE' }>().toMatchTypeOf<{ kind: 'UPDATE'; update: Uint8Array }>();
  });

  it('encodeFrame/decodeFrame 的 header 形状为 20-byte 大端字段', () => {
    expectTypeOf(encodeFrame).parameter(0).toMatchTypeOf<{ messageType: number; sequence: number; payload: Uint8Array }>();
    expectTypeOf(encodeFrame).returns.toEqualTypeOf<Uint8Array>();
    expectTypeOf<FrameHeader>().toMatchTypeOf<{
      envelopeVersion: number;
      messageType: number;
      flags: number;
      sequence: number;
      payloadLength: number;
      reserved: number;
    }>();
    expectTypeOf(decodeFrame).returns.toMatchTypeOf<{ header: FrameHeader; payload: Uint8Array }>();
  });

  it('ERROR 的元数据不可由调用方覆盖（fatal/retryable 不在消息对象上）', () => {
    expectTypeOf<ReplicationMessage>().extract<{ kind: 'ERROR' }>().toMatchTypeOf<{
      kind: 'ERROR';
      code: string;
      safeMessage: string;
      relatedSequence?: number;
      namespaceId?: string;
    }>();
  });

  it('错误注册表条目形状：scope/fatal/retryable/wsCloseCode/terminalState', () => {
    expectTypeOf<ErrorInfo>().toMatchTypeOf<{
      code: string;
      scope: 'connection' | 'namespace';
      fatal: boolean;
      retryable: string;
      wsCloseCode?: number;
      terminalState?: string;
    }>();
    // NonNullable 包裹：注册表以 Record<string, ErrorInfo> 声明时，noUncheckedIndexedAccess 下
    // 点访问型为 ErrorInfo | undefined；断言语义仍为「wsCloseCode 是 number | undefined」。
    expectTypeOf<NonNullable<typeof CONNECTION_ERRORS.BAD_MAGIC>['wsCloseCode']>().toEqualTypeOf<number | undefined>();
  });

  it('协商函数签名', () => {
    expectTypeOf(selectProtocolVersion).parameter(0).toEqualTypeOf<number[]>();
    expectTypeOf(selectProtocolVersion).returns.toEqualTypeOf<number | null>();
    expectTypeOf(selectCapabilities).parameter(0).toEqualTypeOf<number>();
    expectTypeOf(selectCapabilities).returns.toEqualTypeOf<{ ok: boolean; selected: number }>();
  });

  it('ProtocolError 是带码分类错误', () => {
    expectTypeOf<ProtocolError>().toMatchTypeOf<Error & { code: string; fatal: boolean; scope: string }>();
  });
});
