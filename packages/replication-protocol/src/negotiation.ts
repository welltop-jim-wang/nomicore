/**
 * 版本 / capability 协商纯函数（无状态）。
 *
 * 权威来源：docs/protocols/instance-replication-v1.md §3（envelopeVersion 与 HELLO protocolVersions
 * 是两个独立版本层）、§6.1/§6.2（共同最高版本、required 全支持、optional 取交集）。
 * 本模块只做纯集合/位运算数学，不抛错、不维护状态；
 * ok:false 由调用方（ws-replication）映射 UNSUPPORTED_CAPABILITY（设计 §8）。
 * 注意：selectProtocolVersion 不做降序校验——那是 HELLO wire 字段规则，在 encode/decode 边界执行。
 */

/** 共同最高协议版本；空或没有交集 → null（调用方映射 UNSUPPORTED_PROTOCOL_VERSION）。 */
export function selectProtocolVersion(peerVersions: number[], hubVersions: number[]): number | null {
  const hub = new Set(hubVersions);
  let best: number | null = null;
  for (const v of peerVersions) {
    if (hub.has(v) && (best === null || v > best)) {
      best = v;
    }
  }
  return best;
}

/**
 * required 全支持才 ok（无符号位运算，bit31 安全）；optional 取交集。
 */
export function selectCapabilities(required: number, optional: number, supported: number): { ok: boolean; selected: number } {
  const ok = ((required & ~supported) >>> 0) === 0;
  return { ok, selected: (optional & supported) >>> 0 };
}
