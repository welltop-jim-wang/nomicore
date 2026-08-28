/**
 * 冻结 schema 的 Pattern 常量（设计 §3.2——schema 与 TS 单源纪律）。
 *
 * 全部 Pattern 字符串先在此定义为 TS 常量，`RECORD_SCHEMA_TEXT`（schema.ts）以模板
 * 字面量插值这些常量——TS intake 校验与 VFSL Pattern 永不漂移。
 *
 * 纪律（设计 §3.2）：全部 Pattern 零反斜杠转义（无 `\\`），锚定显式 `^…$`
 * （v1-spec §3：「锚定不由方言隐含」）；`P_BOUNDED_STR` 的 `.` 不匹配行终止符
 * （ECMAScript 语义）→ 天然禁换行（JSONL 行注入免疫）。
 */

/** stream 身份半段：log- + 32 位小写 hex（设计 §3.3）。 */
export const P_STREAM_ID = '^log-[0-9a-f]{32}$'

/** 十进制字符串（uint64 值域）：无前导零；"0" 合法（序列 Pattern 起点自由度，设计 §10-J11）。 */
export const P_DECIMAL = '^(0|[1-9][0-9]*)$'

/** 有界字符串（≤256 字符、无换行）：attemptId / remoteInstanceId / context 关联 ID。 */
export const P_BOUNDED_STR = '^.{1,256}$'

/** UTC ISO 8601、毫秒精度、Z 后缀。 */
export const P_ISO_MS = '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'

/** 稳定诊断码：ASCII 受控字符集、≤128 字符（顶层 code/sourcePhase 与 update-omitted reason 共用）。 */
export const P_STABLE_CODE = '^[A-Za-z0-9_.:-]{1,128}$'

/** CRC-32C（Castagnoli）8 位小写 hex。 */
export const P_CRC32C_HEX = '^[0-9a-f]{8}$'

/** SHA-256 小写 hex（64 位）。 */
export const P_SHA256_HEX = '^[0-9a-f]{64}$'

/** sidecar 所在 segment 名：固定 8 位十进制（00000001 起，00000000 保留）。 */
export const P_SEGMENT = '^[0-9]{8}$'

/** RFC 4648 标准 Base64（含必须 padding、无空白换行）。 */
export const P_BASE64 =
  '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$'

/** intake 本机 RegExp 副本（与 VFSL Pattern 同源常量；仅 intake 结构校验实际使用
 *  的三枚——其余 Pattern 只在 schema 文本与 VFSL 引擎侧生效，不留死导出——R5 nano）。 */
export const RE_BOUNDED_STR = new RegExp(P_BOUNDED_STR)
export const RE_ISO_MS = new RegExp(P_ISO_MS)
export const RE_STABLE_CODE = new RegExp(P_STABLE_CODE)
