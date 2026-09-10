/**
 * SA6 契约独立参考件 — RFC 4648 Base32 canonical 重编码器（issue #266 / sc1- 内容寻址 schema ID）。
 *
 * 定位：测试侧**独立**的参考实现——与被测生产实现无共享代码路径，用于锚定
 * `sc1-` payload（完整 256-bit SHA-256 digest）的 canonical 小写无 padding Base32
 * 编码/解码。算法已与 Python `base64.b32encode`（RFC 4648 §6）跨验一致（多组
 * 32-byte digest + RFC 4648 §10 KAT），见 `sc1-schema-id-envelope-validation.test.ts`
 * 的参考件自检块。
 *
 * 规则（契约冻结面，全部来自 ADR 0015「sc1-<52 位小写 RFC 4648 Base32>，无 padding」）：
 * - 字母表 = RFC 4648 §6 `a–z` + `2–7`（小写形式）；
 * - payload = digest 位流 MSB-first 切 5-bit 组；32 bytes = 256 bits → 52 组，
 *   末组 1 个数据位 + 4 个 pad 位（无 `=` 字符）；
 * - canonical 条件：全小写、仅字母表字符、无 `=`、pad 位必须为零
 *   （RFC 4648 §3.2「pad bits MUST be zero」——52 字末字符因此只能取值 `a`(0) 或
 *   `q`(16)，其余 30 个字母表字符都携带非零 pad 位）。
 *
 * 本文件只被测试 import；不进入包公共面（非 *.test.ts，vitest include 不收集）。
 *
 * 互斥 grep 守卫（SA2 F2，issue #266）：生产侧 fingerprint.ts 的语义指纹 digest
 * 提取件刻意**异名**（`digestHexFromSemanticFingerprint`），与本文件同义导出
 * `digestHexFromFingerprint` 互斥——防 IDE 自动导入把本独立参考件与生产实现混淆
 * （共享代码路径即防循环论证纪律静默失效）。本文件导出只允许被 test/ 下文件 import；
 * 生产侧导出只允许被 src/index.ts 消费。两文件头注相互指认。
 */
export const SC1_BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** 小写 canonical 无 padding Base32 编码（hex → 字符串；hex 允许任意偶数长度，含空串）。 */
export function canonicalBase32FromHex(hex: string): string {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error(`sc1 参考件: 非法 hex 输入 ${JSON.stringify(hex)}`);
  }
  if (hex.length === 0) {
    return '';
  }
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  let bits = '';
  for (const b of bytes) {
    bits += b.toString(2).padStart(8, '0');
  }
  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    out += SC1_BASE32_ALPHABET[parseInt(chunk, 2)] as string;
  }
  return out;
}

/**
 * 小写 canonical 解码（字符串 → hex / null）。拒绝：非小写、非字母表字符、
 * 非零 pad 位（RFC 4648 §3.2）。不校验 `=`（`=` 不在字母表内 → 自然拒绝）。
 */
export function hexFromCanonicalBase32(text: string): string | null {
  if (text.length === 0) {
    return '';
  }
  if (!/^[a-z2-7]+$/.test(text)) {
    return null;
  }
  let bits = '';
  for (const c of text) {
    const index = SC1_BASE32_ALPHABET.indexOf(c);
    bits += index.toString(2).padStart(5, '0');
  }
  const excess = bits.length % 8;
  if (excess !== 0) {
    if (/1/.test(bits.slice(-excess))) {
      return null; // pad 位非零 → 非 canonical（RFC 4648 §3.2）
    }
    bits = bits.slice(0, -excess);
  }
  let out = '';
  for (let i = 0; i < bits.length; i += 8) {
    out += parseInt(bits.slice(i, i + 8), 2).toString(16).padStart(2, '0');
  }
  return out;
}

/** semantic fingerprint（`sha256:v1:<64 小写 hex>`）→ canonical `sc1-<52 小写>`。 */
export function sc1IdFromFingerprint(fingerprint: string): string {
  const digest = digestHexFromFingerprint(fingerprint);
  if (digest === null) {
    throw new Error(`sc1 参考件: 非法 fingerprint ${JSON.stringify(fingerprint)}`);
  }
  return `sc1-${canonicalBase32FromHex(digest)}`;
}

/** fingerprint 的 digest hex 段（`sha256:v1:` 后 64 位小写 hex）；非法返回 null。 */
export function digestHexFromFingerprint(fingerprint: string): string | null {
  const match = /^sha256:v1:([0-9a-f]{64})$/.exec(fingerprint);
  return match === null ? null : (match[1] as string);
}

/** `sc1-` id → digest hex（要求 payload 恰解码为 32 bytes）；非法/非 canonical 返回 null。 */
export function digestHexFromSc1Id(id: string): string | null {
  if (!id.startsWith('sc1-')) {
    return null;
  }
  const payload = id.slice(4);
  if (payload.length !== 52) {
    return null;
  }
  const hex = hexFromCanonicalBase32(payload);
  if (hex === null || hex.length !== 64) {
    return null;
  }
  return hex;
}

/** 检查字符串是否为「sc1- + 52 位小写字母表字符」的字面形状（不查 pad 位/digest）。 */
export function isSc1Shape(text: string): boolean {
  return /^sc1-[a-z2-7]{52}$/.test(text);
}
