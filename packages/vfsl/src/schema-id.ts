/**
 * sc1- 内容寻址 schema ID 编码件（issue #266 / ADR 0015：`sc1-<52 位小写 RFC 4648
 * Base32，无 padding>`）——模块内部叶子：**零 import**、纯函数、确定性、零运行时
 * 依赖（#72 AC6 清单契约：package.json 不动）。
 *
 * 冻结格式（ADR 0015 L127-133；CONTEXT.md「内容寻址 schema ID」词条）：
 * - 前缀 `sc1-` 大小写敏感（`1` 是格式版本号，L133）；
 * - payload = semantic fingerprint 完整 256-bit SHA-256 digest 的 canonical
 *   小写 RFC 4648 §6 Base32：字母表 `a–z` + `2–7`，MSB-first 5-bit 组，无 `=`；
 *   32 bytes = 256 bits → 恰 52 组，末组 1 个数据位 + 4 个 pad 位；
 * - pad 位必须为零（RFC 4648 §3.2「pad bits MUST be zero」）——52 字末字符因此
 *   只能取 `a`(0) 或 `q`(16)，其余字母表字符携带非零 pad 位（数学推论，非独立
 *   校验条款）。
 *
 * 保留族（D3）：`/^sc[0-9]+-/i` 是内容寻址 ID 的保留命名族（防仿冒执行——族内
 * 只有精确 `sc1-` + canonical payload 合法，`SC1-`/`sc2-` 等形态一律 ENV_6 拒绝）；
 * 族外字符串（含 `mysc1-provisional-id`、`sc-` 无数字、全部旧式标签）走旧式路径
 * 零触及。Unicode 数字（全角 `１` 等）不在族内——如需收紧须走新决策。
 *
 * 与测试侧独立参考件 `packages/vfsl/test/sc1-base32-ref.ts` **无共享代码路径**
 * （防循环论证，SA6 §1）：参考件被测试 import，本模块被 src import——两文件
 * 头注互斥 grep 守卫（SA2 F2）；编码算法以 RFC 4648 §3.2/§6/§10 为规范依据。
 */
export const SC1_ID_PREFIX = 'sc1-';

/** 保留族触发器：`sc<digits>-`（大小写不敏感）；族外 = 旧式路径，零触及（D3）。 */
const SC_ID_FAMILY_RE = /^sc[0-9]+-/i;

/** RFC 4648 §6 小写字母表（`a–z` + `2–7`）。 */
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** 完整 256-bit digest → 5-bit 组数：⌈256/5⌉ = 52（末组 1 数据位 + 4 pad 位）。 */
const SC1_PAYLOAD_BITS = 256;
const SC1_PAYLOAD_CHARS = 52;

/** 64 位小写 hex digest 形状（sha256Hex 产物段；schema-id 编码的唯一合法输入）。 */
const DIGEST_HEX_RE = /^[0-9a-f]{64}$/;

/** 保留族判定：`sc<digits>-`（ASCII 数字，大小写不敏感）→ true。 */
export function isInScIdFamily(id: string): boolean {
  return SC_ID_FAMILY_RE.test(id);
}

/**
 * canonical sc1- id 判定：恰 `sc1-` + 52 位 `[a-z2-7]` 且 pad 位为零
 * （经完整解码校验——RFC 4648 §3.2；等价于末字符 ∈ {a, q} 的完整实现）。
 */
export function isCanonicalSc1Id(id: string): boolean {
  return digestHexFromCanonicalSc1Id(id) !== null;
}

/**
 * canonical sc1- id → 64 位小写 hex digest；非 canonical（前缀错/长度错/字母表外
 * 字符/pad 位非零）返回 null。纯函数、零抛错。
 */
export function digestHexFromCanonicalSc1Id(id: string): string | null {
  if (!id.startsWith(SC1_ID_PREFIX)) {
    return null;
  }
  const payload = id.slice(SC1_ID_PREFIX.length);
  if (payload.length !== SC1_PAYLOAD_CHARS) {
    return null;
  }
  // 每字符按 MSB-first 展开 5 位；52 字 → 260 位；末尾 4 位是 pad 位（RFC 4648
  // §3.2：必须为零），前 256 位 = digest 位流。
  let bits = '';
  for (const ch of payload) {
    const value = BASE32_ALPHABET.indexOf(ch);
    if (value === -1) {
      return null; // 字母表外（含大写、'='、内嵌空白等）→ 非 canonical
    }
    bits += value.toString(2).padStart(5, '0');
  }
  const padBits = bits.length - SC1_PAYLOAD_BITS; // 260 - 256 = 4
  if (padBits > 0 && /1/.test(bits.slice(-padBits))) {
    return null; // pad 位非零 → 非 canonical
  }
  bits = bits.slice(0, SC1_PAYLOAD_BITS);
  let hex = '';
  for (let i = 0; i < bits.length; i += 8) {
    hex += parseInt(bits.slice(i, i + 8), 2).toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * 64 位小写 hex digest → canonical `sc1-<52 位>` id。非法 hex **抛错**（内部
 * 不变式违反，loud——正常流程输入恒为 digestHexFromSemanticFingerprint 校验
 * 后的冻结格式产物；throw 由各公共入口顶层崩溃边界收编，非静默降级）。
 */
export function sc1IdFromDigestHex(digestHex: string): string {
  if (!DIGEST_HEX_RE.test(digestHex)) {
    throw new Error(`sc1- 编码前置不变式破坏：digest 应为 64 位小写 hex，实际 ${digestHex}`);
  }
  let bits = '';
  for (let i = 0; i < digestHex.length; i += 2) {
    bits += parseInt(digestHex.slice(i, i + 2), 16).toString(2).padStart(8, '0');
  }
  let payload = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    payload += BASE32_ALPHABET[parseInt(chunk, 2)] as string;
  }
  return SC1_ID_PREFIX + payload;
}
