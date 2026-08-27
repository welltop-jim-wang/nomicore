/**
 * CanonicalReader（解码路径，完全自研——决策 D-1）+ PayloadWriter（写路径，lib0/encoding 封装）。
 *
 * 权威来源：docs/protocols/instance-replication-v1.md §4（lib0 canonical 编码 + decoder 必须
 * 拒绝截断/溢出/非 canonical/非法 UTF-8/错误 marker/超界/尾随）。
 *
 * 为什么不直接用 lib0 decoding（F4/F5/F6）：
 * - readVarUint 接受非最短 LEB128（`82 00`）→ 违反 canonical 契约；
 * - readVarUint8Array 无边界检查，声明超界 → new Uint8Array 抛 RangeError（未分类异常）；
 * - readUint32BigEndian 截断 → NaN→0 静默返回 0（虚假降级）；
 * - readVarString 在 Safari 探测失败时退化为非 fatal polyfill（非法 UTF-8 不抛错）。
 * 读路径有界 + canonical + 严格 UTF-8，任何失败 → ProtocolError('MALFORMED_FRAME')。
 *
 * 写路径用 lib0/encoding 的原因是：lib0 是 canonical 产出者（最短 LEB128、varString=varUint(len)+UTF-8、
 * varUint8Array=varUint(len)+bytes），golden 十六进制已按 lockfile lib0@0.2.117 行为核对。
 * 所有写入值在喂给 lib0 前先验证（非负安全整数 / u32 / well-formed 字符串），
 * 封死 lib0 writeVarUint 对 >2^53 输入的精度损失静默产出错字节的通道。
 *
 * 本文件是唯一允许 import 'lib0/encoding' 的源文件；其余模块只经 CanonicalReader/PayloadWriter 使用它。
 */
import * as encoding from 'lib0/encoding';
import { ProtocolError } from './errors.js';

/** 严格 UTF-8 解码器（fatal + 不剥离 BOM——设计决策 D-2，canonical roundtrip 的必要条件）。 */
interface Utf8Decoder {
  readonly fatal: boolean;
  decode(input?: Uint8Array): string;
}

declare const TextDecoder: {
  new (label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean }): Utf8Decoder;
};

const utf8Decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** 抛出已分类 MALFORMED_FRAME（payload 级一切违规的统一出口；绝无未分类异常逃逸）。 */
export function throwMalformed(detail?: string): never {
  throw new ProtocolError('MALFORMED_FRAME', detail);
}

/** 非负安全整数断言（varUint 合法域；>2^53 由 lib0 编码侧不可表示）。 */
export function assertNonNegativeSafeInteger(n: number, name: string): void {
  if (!Number.isSafeInteger(n) || n < 0) {
    throwMalformed(`${name} must be a non-negative safe integer`);
  }
}

/** uint32 语义字段断言（seq/roundId/ackedSequence/relatedSequence/capability）。 */
export function assertU32(n: number, name: string): void {
  if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) {
    throwMalformed(`${name} must fit in uint32`);
  }
}

/**
 * 字符串 well-formed 断言（设计规则 R6，encode 侧「拒绝虚假降级」落点）：
 * TextEncoder 会把未配对代理项静默替换为 U+FFFD，破坏 canonical roundtrip，
 * 故含 lone surrogate 的字符串在 encode 侧拒绝。
 *
 * 首行 typeof 守卫（SA4 F2）：所有 writeVarString 调用点均经此函数——
 * JS caller 若传 undefined/null/数字，裸 `s.length` 会抛 TypeError（未分类异常逃逸）
 * 或让 TextEncoder 静默强转上 wire；一律先转 MALFORMED_FRAME。
 */
export function assertWellFormedString(s: string, name: string): void {
  if (typeof s !== 'string') {
    throwMalformed(`${name} must be a string`);
  }
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throwMalformed(`${name} contains an unpaired surrogate`);
      }
      i++; // 跳过配对低代理项
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      throwMalformed(`${name} contains an unpaired surrogate`);
    }
  }
}

/**
 * 有界、canonical、严格 UTF-8 的 payload 读取器。
 *
 * - 作用对象是帧层已钉死长度的 payload 视图（decodeFrame 步骤 8 之后才会进入本层）；
 * - 一切越界/截断/非 canonical/非法 UTF-8 → ProtocolError('MALFORMED_FRAME')；
 * - readVarUint8ArrayCopy 在分配前检查 pos+len ≤ end，绝无越界分配；
 * - 本类绝不写输入 buffer（只读使用）。
 */
export class CanonicalReader {
  private readonly buf: Uint8Array;
  private pos = 0;

  constructor(buf: Uint8Array) {
    this.buf = buf;
  }

  /** 未消费字节数。 */
  get remaining(): number {
    return this.buf.length - this.pos;
  }

  /** 完全消费原则（设计规则 R1）：payload 内任何未声明尾随字节 → MALFORMED_FRAME。 */
  expectEnd(): void {
    if (this.pos !== this.buf.length) {
      throwMalformed('payload has trailing bytes');
    }
  }

  readU8(): number {
    if (this.remaining < 1) {
      throwMalformed('truncated payload');
    }
    return this.buf[this.pos++]!;
  }

  readBool(): boolean {
    const v = this.readU8();
    if (v !== 0 && v !== 1) {
      throwMalformed('bool field must be 0|1');
    }
    return v === 1;
  }

  /** 固定 4 字节大端 uint32（capability bitset）。先检查后读，杜绝 lib0 式 NaN→0 静默。 */
  readUint32BE(): number {
    if (this.remaining < 4) {
      throwMalformed('truncated uint32');
    }
    const b0 = this.buf[this.pos]!;
    const b1 = this.buf[this.pos + 1]!;
    const b2 = this.buf[this.pos + 2]!;
    const b3 = this.buf[this.pos + 3]!;
    this.pos += 4;
    return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
  }

  /**
   * 无符号 LEB128 最短形式：
   * - 最多 8 字节（ceil(53/7)=8，超过 2^53 可表示范围 → MALFORMED_FRAME）；
   * - 截断（未到末字节即耗尽）→ MALFORMED_FRAME；
   * - 非最短形态判据：多字节且末字节为 0（无符号 LEB128 终止由高位 bit 决定，
   *   多余字节只能以末尾 0x00 形式存在）→ MALFORMED_FRAME（`82 00`/`80 00` 被拒，
   *   `06`/`88 27`/`ff ff ff ff 7f` 通过）；
   * - 结果 > Number.MAX_SAFE_INTEGER → MALFORMED_FRAME。
   */
  readVarUint(): number {
    let value = 0;
    let mult = 1;
    let count = 0;
    let last = 0;
    for (;;) {
      if (count >= 8) {
        throwMalformed('varUint exceeds 8 bytes');
      }
      if (this.remaining < 1) {
        throwMalformed('truncated varUint');
      }
      const b = this.buf[this.pos++]!;
      count++;
      last = b;
      value += (b & 0x7f) * mult;
      mult *= 128;
      if (b < 0x80) {
        break;
      }
    }
    if (count > 1 && last === 0) {
      throwMalformed('non-canonical varUint');
    }
    if (value > Number.MAX_SAFE_INTEGER) {
      throwMalformed('varUint exceeds safe integer');
    }
    return value;
  }

  /** varUint 再验 ≤ 0xFFFFFFFF（syncRoundId/ackedSequence/relatedStep1Sequence 类）。 */
  readVarUint32(): number {
    const v = this.readVarUint();
    if (v > 0xffffffff) {
      throwMalformed('varUint exceeds uint32');
    }
    return v;
  }

  /** varUint 长度 + 精确拷贝。分配前检查 pos+len ≤ end，绝无越界分配。 */
  readVarUint8ArrayCopy(): Uint8Array {
    const len = this.readVarUint();
    if (this.remaining < len) {
      throwMalformed('declared bytes exceed payload');
    }
    const out = new Uint8Array(len);
    out.set(this.buf.subarray(this.pos, this.pos + len));
    this.pos += len;
    return out;
  }

  /** varUint 长度 + 严格 UTF-8 解码；非法 UTF-8 → MALFORMED_FRAME。 */
  readVarString(): string {
    const raw = this.readVarUint8ArrayCopy();
    try {
      return utf8Decoder.decode(raw);
    } catch {
      throwMalformed('invalid UTF-8 string');
    }
  }
}

/**
 * 写路径封装（lib0/encoding）。所有数值/字符串在写入前验证，
 * 保证 lib0 只被喂合法输入（非负安全整数 / u32 / well-formed 字符串 / Uint8Array）。
 * finish() 产出精确长度的纯 Uint8Array（原型恒 Uint8Array.prototype，无 Buffer）。
 */
export class PayloadWriter {
  private readonly encoder: encoding.Encoder = encoding.createEncoder();

  writeU8(n: number): void {
    if (!Number.isInteger(n) || n < 0 || n > 255) {
      throwMalformed('u8 field out of range');
    }
    encoding.writeUint8(this.encoder, n);
  }

  writeBool(b: boolean): void {
    encoding.writeUint8(this.encoder, b ? 1 : 0);
  }

  writeUint32BE(n: number): void {
    assertU32(n, 'uint32');
    encoding.writeUint32BigEndian(this.encoder, n);
  }

  writeVarUint(n: number, name = 'varUint'): void {
    assertNonNegativeSafeInteger(n, name);
    encoding.writeVarUint(this.encoder, n);
  }

  writeVarUint32(n: number, name = 'uint32'): void {
    assertU32(n, name);
    encoding.writeVarUint(this.encoder, n);
  }

  writeVarUint8Array(b: Uint8Array): void {
    if (!(b instanceof Uint8Array)) {
      throwMalformed('bytes field must be a Uint8Array');
    }
    encoding.writeVarUint8Array(this.encoder, b);
  }

  writeVarString(s: string, name = 'string'): void {
    assertWellFormedString(s, name);
    encoding.writeVarString(this.encoder, s);
  }

  finish(): Uint8Array {
    return encoding.toUint8Array(this.encoder);
  }
}
