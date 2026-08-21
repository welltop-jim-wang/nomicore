/**
 * 文本 → SHA-256 摘要——包内纯 TS 参考实现（issue #54 / H3，DocScope 编译缓存键）。
 *
 * 定位（设计 §D8）：缓存键 = `sha256(文本内容)`。引擎包内**自包含**零依赖实现——
 * `lib:["ES2022"]` 无 DOM（无 TextEncoder 类型面）、@types/node 不声明全局
 * TextEncoder；`node:crypto` 会造成引擎包第二个环境绑定面，违 index.ts 头注
 * 「FileSchemaSource 读 Node fs——引擎包内唯一环境绑定面」不变量。仓内
 * sha-256-of-text 先例（packages/vfsl-codegen/src/header.ts:10,37）在构建期工具包
 * 且绑 node，恰是本实现「纯 ES2022、零 import 叶子模块」的对照论据。
 *
 * 本模块零 import（叶子）；不进入包公共面（仅 KAT 测试直连 `../src/sha256.js`）。
 */

/**
 * 字符串 → 字节序列（键的单射字节化，设计 §D8.2 / R2-A1）。合法码点：RFC 3629
 * UTF-8；未配对代理（lone surrogate）：不替换，走通用 3 字节分支编码为 WTF-8 代理段
 * （ED A0 80–ED BF BF）——该段与一切合法码点的规范 UTF-8 不相交 ⇒ 全字符串空间
 * 单射（INV-2）。R1 的 U+FFFD 替换编码会使 '\uD800'/'\uDC00'/'\uFFFD' 坍缩同键
 * （SA2 A1），已废弃。使用 codePointAt 规避 noUncheckedIndexedAccess 索引访问。
 */
export function utf8Bytes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i) as number; // i < length ⇒ 非 undefined
    i += cp > 0xffff ? 2 : 1; // 星面码点跨代理对（配对时 codePointAt 返回星面值）
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      // 含 lone surrogate（0xD800–0xDFFF，codePointAt 对未配对者原样返回该值）：
      // 编码为 ED A0 80–ED BF BF（WTF-8 段）——不替换、不坍缩（§D8.2 单射证明）
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return out;
}

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/** FIPS 180-4 §4.2.2 K 表（64 常量；表值以 FIPS 原文为准，KAT 失败 = 抄录错误探测器）。 */
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/**
 * sha256(text) → 64 字符小写 hex。纯函数、确定性（同文本恒同键——缓存正确性根基）。
 * 纯 ES2022 循环实现：FIPS 180-4 §5.1.1 填充 + 大端位长编码（除法必须取整——
 * 非整除位会出错，'abc' KAT 可捕获之）+ 64 轮压缩。文本 < 2^32 bit ≈ 512 MB。
 */
export function sha256Hex(text: string): string {
  const bytes = utf8Bytes(text);
  // 元组类型：解构得 number 而非 number|undefined（noUncheckedIndexedAccess 适配）。
  const H: [number, number, number, number, number, number, number, number] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const bitLen = bytes.length * 8;
  const msg = [...bytes, 0x80]; // FIPS 180-4 §5.1.1 padding
  while (msg.length % 64 !== 56) msg.push(0);
  for (let j = 7; j >= 0; j--) {
    // 64 位大端位长（低 32 位即够，文本 < 2^32 bit ≈ 512 MB；除法必须取整）
    msg.push(Math.floor(bitLen / 2 ** (8 * j)) & 0xff);
  }
  for (let off = 0; off < msg.length; off += 64) {
    const w = new Array<number>(64);
    for (let i = 0; i < 16; i++) {
      w[i] =
        ((msg[off + 4 * i] as number) << 24) |
        ((msg[off + 4 * i + 1] as number) << 16) |
        ((msg[off + 4 * i + 2] as number) << 8) |
        (msg[off + 4 * i + 3] as number);
    }
    for (let i = 16; i < 64; i++) {
      const s0 =
        rotr(w[i - 15] as number, 7) ^ rotr(w[i - 15] as number, 18) ^ ((w[i - 15] as number) >>> 3);
      const s1 =
        rotr(w[i - 2] as number, 17) ^ rotr(w[i - 2] as number, 19) ^ ((w[i - 2] as number) >>> 10);
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + (K[i] as number) + (w[i] as number)) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    // 累加回写（元组索引恒 number，无需断言）
    H[0] = (H[0] + a) | 0;
    H[1] = (H[1] + b) | 0;
    H[2] = (H[2] + c) | 0;
    H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0;
    H[5] = (H[5] + f) | 0;
    H[6] = (H[6] + g) | 0;
    H[7] = (H[7] + h) | 0;
  }
  return H.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}
