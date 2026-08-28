/**
 * testing 子路径（`@nomicore/namespace-diagnostic-log/testing`；设计 §1.3/§9.6/§9.10）。
 *
 * 本模块只服务测试（对齐 `@nomicore/clock/testing` 先例）——非生产路径；生产
 * 构造器的内部函数化（createMemoryLog options）是本子路径注入接缝的实现基础。
 */
import { FILE_INTERNAL, createFileLog } from './adapters/file.js'
import type { FileDiagnosticLog, FileDiagnosticLogConfig, FileLogInternals } from './adapters/file.js'
import { INTERNAL, createMemoryLog, nextDecimal, UINT64_MAX } from './adapters/memory.js'
import type { BoundedMemoryDiagnosticLog, DiagnosticLogConfig } from './adapters/memory.js'
import type { RandomSource } from './emission.js'
import type { DiagnosticLogHealthEvent, DiagnosticLogHealthObserver } from './health.js'
import type { DiagnosticChangeRecord } from './record.js'
import type { MemoryLogInternals } from './adapters/memory.js'
import { P_DECIMAL } from './schema-patterns.js'

const RE_P_DECIMAL = new RegExp(P_DECIMAL)

export { nextDecimal }
export { jcs, SnapshotContractViolation } from './canonical-json.js'
export { sha256Hex } from './digest.js'
/** CRC-32C 直测接缝（8 位小写 hex；复用 src/crc32c.ts 实现——供 CRC KAT 直测，
 *  含空输入：0 字节经 emit 路径按 R2/D-c1 为 update-omitted/empty-update，
 *  inline carrier KAT 由本直测承担）。 */
export { crc32cHex } from './crc32c.js'
export { jsonLiteralBytes, truncateUtf8, TRUNCATION_MARKER } from './projection/issues.js'

/**
 * 确定性随机源（循环供应给定字节；仅 streamId/attemptId 两用途——§4.4）。
 * @example 32B 输入：streamId 取前 16B、attemptId 取后 16B。
 */
export function createDeterministicRandomSource(bytes: Uint8Array): RandomSource {
  if (bytes.length === 0) {
    // R5 nano：空字节序列是测试装配错误——loud 抛错（静默全零序列会掩盖 streamId/
    // attemptId 确定性的误用）
    throw new Error('createDeterministicRandomSource: 字节序列为空（测试装配错误）')
  }
  let cursor = 0
  return {
    randomBytes(n: number): Uint8Array {
      const out = new Uint8Array(n)
      for (let i = 0; i < n; i++) {
        out[i] = bytes[cursor % bytes.length]!
        cursor += 1
      }
      return out
    },
  }
}

/** 事件收集型 observer（§9.6/§9.11 用）。 */
export function createEventCollectingObserver(): DiagnosticLogHealthObserver & { events: DiagnosticLogHealthEvent[] } {
  const events: DiagnosticLogHealthEvent[] = []
  return {
    events,
    onEvent(event: DiagnosticLogHealthEvent): void {
      events.push(event)
    },
  }
}

/**
 * 直通接缝（§9.6）：手工构造最终 record → storage projection → VFSL 门 + 入队。
 * 不分配 sequence（record 自带）；failed/exhausted 模式仍按 adapter 语义计数。
 * 注（R4/nano-4）：直通接缝不更新 lastSequence——注入后可出现重复 sequence 字符串，
 * 仅测试用（生产路径的 sequence 由 append 管线独占分配）。
 */
export function injectFinalRecord(log: BoundedMemoryDiagnosticLog, record: DiagnosticChangeRecord): void {
  const internals = (log as unknown as { [INTERNAL]?: MemoryLogInternals })[INTERNAL]
  if (internals === undefined) throw new Error('injectFinalRecord: 非本包构造的 log 实例')
  internals.appendFinal(record)
}

/** 带自定义 schema envelope 的日志工厂（R2/F-c1：注入坏 envelope 驱动 failed 模式）。 */
export function createBoundedMemoryDiagnosticLogWithSchema(
  config: DiagnosticLogConfig,
  envelope: unknown,
): BoundedMemoryDiagnosticLog {
  return createMemoryLog(config, { envelope })
}

/** sequence 预置工厂（R2/A-c1：预置 lastSequence 到 uint64 邻域驱动 exhausted 转换）。 */
export function createBoundedMemoryDiagnosticLogPresetSequence(
  config: DiagnosticLogConfig,
  lastSequence: string,
): BoundedMemoryDiagnosticLog {
  return createMemoryLog(config, { presetLastSequence: lastSequence })
}

/**
 * File adapter 直通接缝（§6.3；#148 injectFinalRecord 的 File 版）：
 * 手工构造最终 record → storage projection 后半段（line 预算门 → VFSL 门 →
 * storage 门 → 落盘）。不分配 sequence、不推进 lastSequence、不触碰 exhausted 门闩
 * （无分配即无转换）；mode ≠ ready（disabled/failed/exhausted）→ 静默丢弃。
 */
export function injectFinalRecordFile(log: FileDiagnosticLog, record: DiagnosticChangeRecord): void {
  const internals = (log as unknown as { [FILE_INTERNAL]?: FileLogInternals })[FILE_INTERNAL]
  if (internals === undefined) throw new Error('injectFinalRecordFile: 非本包构造的 log 实例')
  internals.appendFinal(record)
}

/**
 * File adapter sequence 预置工厂（§6.3；exhausted 转换的 testing 接缝）。
 *
 * R2-1（SA2 实现期强制）：预置入参 loud 校验——须匹配 P_DECIMAL **且**小于
 * UINT64_MAX（`nextDecimal` 对超域串静默进位 + `setBigUint64` 静默 mask；
 * 预置 max 本身会使门闩检查失效——装配错误 loud 化，`createDeterministicRandomSource`
 * 空字节序列 loud throw 的同型先例）。违规 throw。
 */
export function createFileDiagnosticLogPresetSequence(
  config: FileDiagnosticLogConfig,
  lastSequence: string,
): FileDiagnosticLog {
  if (!RE_P_DECIMAL.test(lastSequence) || BigInt(lastSequence) >= BigInt(UINT64_MAX)) {
    throw new Error(
      `createFileDiagnosticLogPresetSequence: lastSequence 非法（须为无前导零十进制且 < ${UINT64_MAX}）：${lastSequence}`,
    )
  }
  return createFileLog(config, { presetLastSequence: lastSequence })
}
