/**
 * SHA-256 摘要与 CSPRNG（设计 §5.2：node:crypto 仅在本模块与 carrier.ts 出现——
 * AGENTS.md 声明该唯一环境绑定面）。
 *
 * 论据（设计 §5.2）：默认策略即 digest，SHA-256 在 emit() 内同步执行——native
 * 实现把大快照下 producer 可见 CPU 延迟压一个数量级；本包是服务端 observability
 * 模块（Node ≥20），不承担浏览器/edge 约束；node:crypto 即 FIPS 级实现，不重复
 * 自写第三份 SHA-256。
 */
import { createHash, randomBytes } from 'node:crypto'

/** 文本 → SHA-256 小写 hex（UTF-8 字节化经全局 TextEncoder——与 vfsl sha256.ts 同字节语义）。 */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text)
  return createHash('sha256').update(bytes).digest('hex')
}

/** canonical 文本（JCS 输出）→ 快照 digest（SHA-256 小写 hex）。 */
export function digestOfCanonical(canonical: string): string {
  return sha256Hex(canonical)
}

/** CSPRNG 字节（16B 用途：streamId / attemptId；设计 §4.4）。 */
export function cryptoRandomBytes(n: number): Uint8Array {
  return new Uint8Array(randomBytes(n))
}

/** n 字节 → 小写 hex（streamId / attemptId 成形用）。 */
export function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += bytes[i]!.toString(16).padStart(2, '0')
  return out
}
