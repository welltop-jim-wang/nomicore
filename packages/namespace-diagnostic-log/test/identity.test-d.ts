/**
 * 红灯契约（类型面）— §9.10 TS 字面量相关性与 R2/F-c2 物理键黑名单（AC1）
 *
 * 锚点：设计 §10-J2（fatal committed↔effect 相关性由 TS 字面量类型 + emitter 唯一构造点 +
 *       契约测试三重强制——本文件是编译期那一重）+ §2.1（AttemptResult/EmissionResult
 *       判别联合成员）+ §2.6（NamespaceDiagnosticChangeEmission 形状）+ §4.4（RandomSource）
 *       + R2/F-c2（「不向 producer 暴露 JSONL/Base64/segment/frame/offset/retention」的
 *       直接编译期锚：emission/EmissionResult 键集 ∩ 物理键黑名单 = ∅；
 *       UpdateCarrier 合法拥有物理键——黑名单非空转）。
 *
 * 锚定机制（vitest --typecheck 下红/绿翻转）：
 * - `@ts-expect-error` 反向锚：一旦允许非法形状（fatal+false 带 effect、emission 带
 *   base64），本文件转红——编译期机器锁；
 * - `expectTypeOf` 正向锚：合法形状/键集关系必须恰为冻结形状。
 */
import { describe, expectTypeOf, it } from 'vitest'
import type {
  AttemptRecord,
  AttemptResult,
  DiagnosticChangeRecord,
  EmissionResult,
  NamespaceDiagnosticChangeEmission,
  NamespaceDiagnosticChangeEmitter,
  UpdateCarrier,
} from '../src/index.js'

/** §9.10 R2/F-c2 物理键黑名单（AC1 原文逐字：JSONL/Base64/segment/frame/offset/retention）。 */
type PhysicalKeys = 'base64' | 'segment' | 'frameOffset' | 'crc32c' | 'payloadLength' | 'storage' | 'retention'

/** 联合类型全成员键并集（keyof 联合 = 公共键，须显式展开才是键并集）。 */
type AllKeys<T> = T extends unknown ? keyof T : never

describe('类型面：fatal committed ↔ effect 字面量相关性（§10-J2）', () => {
  it('EmissionResult：fatal+committed:false 不得携带 effect（编译期拒绝）', () => {
    const ok: EmissionResult = { kind: 'fatal', committed: true, effect: 'unknown' }
    expectTypeOf<EmissionResult>().toEqualTypeOf<EmissionResult>()
    // @ts-expect-error fatal+committed:false 不得携带 effect（字面量锁死）
    const _bad: EmissionResult = { kind: 'fatal', committed: false, effect: 'unknown' }
    void _bad
  })

  it('AttemptResult：rejected 与 fatal+committed:false 均无 update/effect 位', () => {
    const rejected: AttemptResult = { kind: 'rejected' }
    expectTypeOf<AttemptResult>().toEqualTypeOf<AttemptResult>()
    // @ts-expect-error rejected 禁止携带 update（封闭形状）
    const _bad1: AttemptResult = { kind: 'rejected', update: { storage: 'inline', format: 'yjs-update-v1', payloadLength: 1, crc32c: '00000000', base64: 'AA==' } }
    void _bad1
  })

  it('AttemptRecord：fatal+committed:false 记录无 effect 位（record 侧同锁）', () => {
    const base: AttemptRecord = {
      recordKind: 'attempt',
      streamId: 'log-0123456789abcdef0123456789abcdef',
      sequence: '1',
      attemptId: 'att-0123456789abcdef0123456789abcdef',
      operation: 'root-mutation',
      stage: 'transaction',
      observedAt: '2026-08-28T12:00:00.000Z',
      source: { kind: 'local' },
      input: { capture: 'none' },
      result: { kind: 'fatal', committed: false },
    }
    expectTypeOf<Extract<AttemptResult, { kind: 'fatal'; committed: false }>>().toEqualTypeOf<{ kind: 'fatal'; committed: false }>()
    // @ts-expect-error fatal+committed:false 不得携带 effect
    const _bad: AttemptRecord = { ...base, result: { kind: 'fatal', committed: false, effect: 'unknown' } }
    void _bad
  })
})

describe('类型面：R2/F-c2 emission 物理键黑名单（AC1 编译期锚）', () => {
  it('NamespaceDiagnosticChangeEmission 键集 ∩ 物理键黑名单 = ∅', () => {
    expectTypeOf<Extract<keyof NamespaceDiagnosticChangeEmission, PhysicalKeys>>().toEqualTypeOf<never>()
  })

  it('EmissionResult 全成员键并集 ∩ 物理键黑名单 = ∅', () => {
    expectTypeOf<Extract<AllKeys<EmissionResult>, PhysicalKeys>>().toEqualTypeOf<never>()
  })

  it('黑名单非空转：UpdateCarrier 合法拥有 base64/storage/crc32c/payloadLength（inline）与 segment/frameOffset（sidecar）', () => {
    type Inline = Extract<UpdateCarrier, { storage: 'inline' }>
    type Sidecar = Extract<UpdateCarrier, { storage: 'sidecar' }>
    expectTypeOf<Inline['base64']>().toEqualTypeOf<string>()
    expectTypeOf<Inline['crc32c']>().toEqualTypeOf<string>()
    expectTypeOf<Inline['payloadLength']>().toEqualTypeOf<number>()
    expectTypeOf<Sidecar['segment']>().toEqualTypeOf<string>()
    expectTypeOf<Sidecar['frameOffset']>().toEqualTypeOf<string>()
    expectTypeOf<Sidecar['crc32c']>().toEqualTypeOf<string>()
  })

  it('emitter.emit 拒绝带物理键的 emission（excess property 检查）', () => {
    const emitter: NamespaceDiagnosticChangeEmitter = { emit() {} }
    emitter.emit({
      operation: 'root-mutation',
      stage: 'transaction',
      observedAt: '2026-08-28T12:00:00.000Z',
      source: { kind: 'local' },
      result: { kind: 'rejected' },
      // @ts-expect-error producer 面不得出现 base64（AC1：不暴露 Base64 细节）
      base64: 'MTIzNDU2Nzg5',
    })
  })
})

describe('类型面：record 判别联合与关键形状（§2.4/§2.5）', () => {
  it('DiagnosticChangeRecord 由 recordKind 判别两族', () => {
    expectTypeOf<DiagnosticChangeRecord['recordKind']>().toEqualTypeOf<'attempt' | 'genesis-baseline'>()
    expectTypeOf<AttemptRecord['recordKind']>().toEqualTypeOf<'attempt'>()
  })

  it('InputCapture 与 result 的判别字段为字面量（v1 词表冻结）', () => {
    expectTypeOf<Extract<EmissionResult, { kind: 'committed' }>['effect']>().toEqualTypeOf<'noop' | 'update' | 'update-omitted'>()
    expectTypeOf<Extract<EmissionResult, { kind: 'committed'; effect: 'update' }>['updateBytes']>().toEqualTypeOf<Uint8Array>()
  })
})
