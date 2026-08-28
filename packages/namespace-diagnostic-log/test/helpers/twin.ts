/**
 * SA6 全 suite 共享的 JSON round-trip 孪生不变量断言（非测试文件）。
 *
 * 契约锚点：设计 §9.8（R2/C-b1 机器锚）——
 * 「对每个被接纳 record 断言 validateLogicalSnapshot(derived, JSON.parse(JSON.stringify(record))) ok」。
 * 作用：一次性防住所有「对象合法、字节非法」类分叉（NaN/±Infinity/undefined/hole/-0），
 * 与 §2.5「内存 JSON 与文件 JSONL 记录逐字段同构」承诺互为锚。
 */
import { expect } from 'vitest'
import { validateLogicalSnapshot } from '@nomicore/vfsl'
import type { DerivedSchema } from '@nomicore/vfsl'
import { mustCompile } from './base.js'

/** 断言 record 经紧凑 JSON 序列化-解析后仍通过冻结 schema 的全量校验（§9.8）。 */
export function expectRecordTwinValid(derived: DerivedSchema, record: unknown, label = 'record'): void {
  const roundTrip: unknown = JSON.parse(JSON.stringify(record))
  const result = validateLogicalSnapshot(derived, roundTrip)
  expect(result.ok, `${label}: JSON round-trip 孪生不变量——validateLogicalSnapshot(derived, JSON.parse(JSON.stringify(record))) 必须 ok`).toBe(true)
  if (!result.ok) {
    // 失败时给出可诊断路径（不进入断言输出）
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(result.issues))
  }
}

/** 取 derived schema 并对 record 做孪生断言（§9.8 通用入口）。 */
export function expectTwin(record: unknown, label = 'record'): void {
  expectRecordTwinValid(mustCompile().derived, record, label)
}
