/**
 * SA6 红灯测试 — append-only 消息/错误注册表（issue #135）。
 *
 * 契约：docs/protocols/instance-replication-v1.md §5（消息注册表，append-only）、
 * §13.1（连接错误注册表 17 项）、§13.2（namespace 错误注册表 20 项，含同名 INTERNAL_ERROR 双 registry）。
 * AC4：错误码从不可变注册表导出 scope/fatal/retryable/terminalState 元数据；
 * 注册表必须 append-only（冻结、不可原地修改）。
 */
import { describe, expect, it } from 'vitest';
import {
  CONNECTION_ERRORS,
  type ErrorInfo,
  MESSAGE_REGISTRY,
  MESSAGE_NAMES,
  MESSAGE_TYPES,
  NAMESPACE_ERRORS,
  lookupError,
} from '@nomicore/replication-protocol';
import {
  CONNECTION_ERROR_TABLE,
  MESSAGE_ACK,
  MESSAGE_DIRECTION,
  MESSAGE_SCOPE,
  MESSAGE_TABLE,
  NAMESPACE_ERROR_TABLE,
} from './fixtures';

describe('消息注册表（§5）：append-only，恰好 17 个 v1 消息', () => {
  it('MESSAGE_TYPES 与规范表完全一致（name → code）', () => {
    expect(Object.keys(MESSAGE_TYPES).sort()).toEqual(Object.keys(MESSAGE_TABLE).sort());
    for (const [name, code] of Object.entries(MESSAGE_TABLE)) {
      expect(MESSAGE_TYPES[name as keyof typeof MESSAGE_TYPES], name).toBe(code);
    }
  });

  it('MESSAGE_NAMES 是 MESSAGE_TYPES 的精确逆映射（code → name）', () => {
    expect(Object.keys(MESSAGE_NAMES)).toHaveLength(Object.keys(MESSAGE_TABLE).length);
    for (const [name, code] of Object.entries(MESSAGE_TABLE)) {
      expect(MESSAGE_NAMES[code]).toBe(name);
    }
    for (const [code, name] of Object.entries(MESSAGE_NAMES)) {
      expect(MESSAGE_TYPES[name as keyof typeof MESSAGE_TYPES]).toBe(Number(code));
    }
  });

  it('MESSAGE_REGISTRY：每条消息的 scope / direction / ack 语义与 §5 表一致', () => {
    const names = Object.keys(MESSAGE_TABLE);
    for (const name of names) {
      const entry = MESSAGE_REGISTRY[name as keyof typeof MESSAGE_REGISTRY];
      expect(entry, name).toBeDefined();
      expect(entry.code, name).toBe(MESSAGE_TABLE[name]!);
      expect(entry.scope, name).toBe(MESSAGE_SCOPE[name]);
      expect(entry.direction, name).toBe(MESSAGE_DIRECTION[name]);
      expect(entry.ack, name).toBe(MESSAGE_ACK[name]);
    }
    // 注册表无多余条目
    expect(Object.keys(MESSAGE_REGISTRY).sort()).toEqual(Object.keys(MESSAGE_TABLE).sort());
  });

  it('注册表是冻结的（append-only 不可原地修改）', () => {
    expect(Object.isFrozen(MESSAGE_TYPES)).toBe(true);
    expect(Object.isFrozen(MESSAGE_NAMES)).toBe(true);
    expect(Object.isFrozen(MESSAGE_REGISTRY)).toBe(true);
    expect(() => {
      (MESSAGE_TYPES as Record<string, number>).HELLO = 0x99;
    }).toThrow();
    expect(() => {
      (MESSAGE_REGISTRY as Record<string, unknown>).SYNC_TEST_FAKE = {};
    }).toThrow();
  });

  it('消息码空间严格：0x00 与 0x05–0x0f、0x14–0x1f、0x23–0x2f、0x34–0x3f、0x42+ 均未注册', () => {
    const registered = new Set(Object.values(MESSAGE_TYPES));
    expect(registered.has(0x00)).toBe(false);
    expect(registered.has(0x05)).toBe(false);
    expect(registered.has(0x0f)).toBe(false);
    expect(registered.has(0x14)).toBe(false);
    expect(registered.has(0x2f)).toBe(false);
    expect(registered.has(0x42)).toBe(false);
    expect(registered.has(0xff)).toBe(false);
  });
});

describe('连接错误注册表（§13.1）：恰 17 项，元数据不可变', () => {
  it('全部连接错误 code 及其 fatal/retryable/wsCloseCode 与规范表一致', () => {
    expect(Object.keys(CONNECTION_ERRORS).sort()).toEqual(Object.keys(CONNECTION_ERROR_TABLE).sort());
    for (const [code, meta] of Object.entries(CONNECTION_ERROR_TABLE)) {
      const entry: ErrorInfo | undefined = CONNECTION_ERRORS[code as keyof typeof CONNECTION_ERRORS];
      expect(entry, code).toBeDefined();
      expect(entry!.scope, code).toBe('connection');
      expect(entry!.fatal, code).toBe(meta.fatal);
      expect(entry!.retryable, code).toBe(meta.retryable);
      expect(entry!.wsCloseCode, code).toBe(meta.wsCloseCode);
    }
  });

  it('连接错误元数据抽样：FRAME_TOO_LARGE=1009/config、INSTANCE_IDENTITY_MISMATCH=1008/config、CONNECTION_BACKPRESSURE=1011/yes', () => {
    expect(CONNECTION_ERRORS.FRAME_TOO_LARGE).toMatchObject({ fatal: true, retryable: 'config', wsCloseCode: 1009 });
    expect(CONNECTION_ERRORS.INSTANCE_IDENTITY_MISMATCH).toMatchObject({ fatal: true, retryable: 'config', wsCloseCode: 1008 });
    expect(CONNECTION_ERRORS.CONNECTION_BACKPRESSURE).toMatchObject({ fatal: true, retryable: 'yes', wsCloseCode: 1011 });
    expect(CONNECTION_ERRORS.HELLO_TIMEOUT).toMatchObject({ fatal: true, retryable: 'yes', wsCloseCode: 1002 });
  });
});

describe('namespace 错误注册表（§13.2）：恰 20 项，含 terminalState', () => {
  it('全部 namespace 错误 code 及其 fatal/retryable/terminalState 与规范表一致', () => {
    expect(Object.keys(NAMESPACE_ERRORS).sort()).toEqual(Object.keys(NAMESPACE_ERROR_TABLE).sort());
    for (const [code, meta] of Object.entries(NAMESPACE_ERROR_TABLE)) {
      const entry: ErrorInfo | undefined = NAMESPACE_ERRORS[code as keyof typeof NAMESPACE_ERRORS];
      expect(entry, code).toBeDefined();
      expect(entry!.scope, code).toBe('namespace');
      expect(entry!.fatal, code).toBe(meta.fatal);
      expect(entry!.retryable, code).toBe(meta.retryable);
      expect(entry!.terminalState, code).toBe(meta.terminalState);
    }
  });

  it('同名 INTERNAL_ERROR 在两个注册表并存且元数据不同（connection=yes/1011；namespace=reconnect/failed）', () => {
    expect(CONNECTION_ERRORS.INTERNAL_ERROR).toMatchObject({
      scope: 'connection',
      fatal: true,
      retryable: 'yes',
      wsCloseCode: 1011,
    });
    expect(NAMESPACE_ERRORS.INTERNAL_ERROR).toMatchObject({
      scope: 'namespace',
      fatal: true,
      retryable: 'reconnect',
      terminalState: 'failed',
    });
  });

  it('语义抽样：ACK_TIMEOUT 唯一非 fatal（needs-resync）；IDENTITY 冲突类 terminalState=conflicted；REOPEN=closed', () => {
    expect(NAMESPACE_ERRORS.ACK_TIMEOUT).toMatchObject({ fatal: false, retryable: 'resync', terminalState: 'needs-resync' });
    expect(NAMESPACE_ERRORS.REPLICATION_ID_MISMATCH).toMatchObject({ fatal: true, retryable: 'reset', terminalState: 'conflicted' });
    expect(NAMESPACE_ERRORS.REPLICATION_EPOCH_MISMATCH).toMatchObject({ fatal: true, retryable: 'reset', terminalState: 'conflicted' });
    expect(NAMESPACE_ERRORS.NAMESPACE_REOPEN_REQUIRES_RECONNECT).toMatchObject({ fatal: true, retryable: 'reconnect', terminalState: 'closed' });
    expect(NAMESPACE_ERRORS.PERSISTENCE_DEGRADED).toMatchObject({ fatal: true, retryable: 'recovery', terminalState: 'failed' });
  });
});

describe('lookupError / 注册表不可变性（AC4）', () => {
  it('lookupError 按 (scope, code) 返回注册表条目；未知返回 undefined', () => {
    expect(lookupError('connection', 'BAD_MAGIC')).toBe(CONNECTION_ERRORS.BAD_MAGIC);
    expect(lookupError('namespace', 'ACK_TIMEOUT')).toBe(NAMESPACE_ERRORS.ACK_TIMEOUT);
    expect(lookupError('connection', 'ACK_TIMEOUT')).toBeUndefined(); // 跨 scope 不可见
    expect(lookupError('namespace', 'BAD_MAGIC')).toBeUndefined();
    expect(lookupError('connection', 'NO_SUCH_CODE')).toBeUndefined();
    expect(lookupError('namespace', 'NO_SUCH_CODE')).toBeUndefined();
  });

  it('错误注册表冻结；错误条目对象亦不可变', () => {
    expect(Object.isFrozen(CONNECTION_ERRORS)).toBe(true);
    expect(Object.isFrozen(NAMESPACE_ERRORS)).toBe(true);
    expect(Object.isFrozen(CONNECTION_ERRORS.BAD_MAGIC)).toBe(true);
    expect(Object.isFrozen(NAMESPACE_ERRORS.ACK_TIMEOUT)).toBe(true);
    expect(() => {
      (CONNECTION_ERRORS as Record<string, ErrorInfo>).FAKE_NEW_ERROR = { code: 'X', scope: 'connection', fatal: true, retryable: 'no' };
    }).toThrow();
  });

  it('错误码稳定 ASCII：全部注册项 code 与自身键一致（append-only 键即稳定码）', () => {
    for (const [scope, reg] of [['connection', CONNECTION_ERRORS], ['namespace', NAMESPACE_ERRORS]] as const) {
      for (const [key, entry] of Object.entries(reg as Record<string, ErrorInfo>)) {
        expect(entry.code, `${scope}:${key}`).toBe(key);
        expect(entry.scope, key).toBe(scope);
      }
    }
  });
});
