/**
 * 双指纹双域构造——envelope 域 + semantic 域（issue #72；ADR-0007「带版本的 domain
 * separation（sha256:v1:<hex>）」的构造性落实；决策源：设计 §6 + relevant_decisions
 * D1/D2）。本模块是纯计算叶子：零 index 依赖（与 sha256.ts 同级），只 import
 * sha256Hex 与两个类型。
 *
 * D2-CONTRACT-MARKER（SA2 M1(a) 加固，可 grep 的 D2 契约标记）：
 * 本模块摘要输入 = 单一生产者插入序 canonical JSON（module 恒为本次编译内 parseVfsl
 * 刚产出者，不引入第二规范化层）。**第二生产者或跨实现指纹互认出现之前，必须先将
 * 域文档版本升为 v2 前缀**（FINGERPRINT_PREFIX），不得静默沿用 v1 摘要。升级触发器
 * 清单（如 v2 方言放开数值字面量语法 ⇒ semantic 域文档必须重审并升 v2）见设计 §6.3
 * 与 relevant_decisions D2 节。静态守卫（SA4 门禁 RT-1a）：本文件两构造函数名全仓
 * grep 仅许本文件（定义）+ index.ts（唯一调用点）出现——第三文件出现即 D2 违反。
 */
import { sha256Hex } from './sha256.js';
import type { SchemaEnvelope } from './schemasource.js';
import type { VfslModule } from './ir.js';

/**
 * 指纹输出前缀（ADR-0007「带版本的 domain separation（sha256:v1:<hex>）」的外显格式，
 * 两域共用）。`v1` = 摘要算法（SHA-256）+ 域文档形态（§6.1/§6.2 冻结形状）的联合
 * 版本号；未来任一者演进 → 升 v2 前缀，旧指纹天然失效不混淆（D1）。
 */
const FINGERPRINT_PREFIX = 'sha256:v1:';

/**
 * semantic 域自述标签（域分离 semantic 侧构造件，§6.2）：域文档首键，envelope 域
 * 文档键集不含 domain/module ⇒ 两域文档语言字符串层构造性不相交。
 */
const SEMANTIC_DOMAIN_TAG = 'vfsl-semantic';

/**
 * envelope 域指纹：恰四键按 v1-spec §7 冻结表序（lang, version, id, text）紧凑
 * 序列化（JSON.stringify 语义）后的 SHA-256。字面量键序即 canonical——不依赖调用方
 * 传入对象的键序（§6.1 canonical 三层含义）。
 */
export function envelopeFingerprintOf(envelope: SchemaEnvelope): string {
  const canonical = JSON.stringify({
    lang: envelope.lang,
    version: envelope.version,
    id: envelope.id,
    text: envelope.text,
  });
  // JSON.stringify 对纯对象字面量恒返回 string（undefined 仅限 undefined/函数/symbol
  // 根值——此处不可达），断言收窄 lib 类型（string | undefined）。
  return `${FINGERPRINT_PREFIX}${sha256Hex(canonical as string)}`;
}

/**
 * semantic 域指纹：`lang + version +` 规范 IR 组成的域标签文档
 * `{ domain: 'vfsl-semantic', lang, version, module }` 紧凑 JSON 序列化后的 SHA-256。
 * module 恒为本次编译内 parseVfsl 刚产出的 IR（单一生产者不变式，§6.3）；
 * 不含 id（ADR-0005：id 是标签不是键）。
 */
export function semanticFingerprintOf(lang: string, version: number, module: VfslModule): string {
  const canonical = JSON.stringify({ domain: SEMANTIC_DOMAIN_TAG, lang, version, module });
  return `${FINGERPRINT_PREFIX}${sha256Hex(canonical as string)}`;
}
