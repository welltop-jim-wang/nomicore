/**
 * @nomicore/namespace-registry —— 最小兼容 identity 校验（issue #110 设计 §4）。
 *
 * 本票没有来自 ADR/Persistence 的 canonical grammar（设计 §4 明示不得擅加 ASCII、
 * 长度上限或首字符白名单），故最小安全规则只有：primitive non-empty string，且不含
 * Unicode C0/C1 控制字符（U+0000–U+001F、U+007F–U+009F）、`/`、`\\`，也不等于
 * `.` 或 `..`；不 trim、不 normalise、不 coerce。Unicode、长字符串、空格及其它
 * Persistence 可接受的普通 string 保持可用（§9 round-trip 兼容锚）。
 *
 * “invalid 零访问”精确定义（设计 §4/§6）：invalid 时零 Registry entries/carriers map、
 * Persistence、Runtime factory/Runtime 访问；不承诺零 JavaScript Proxy/getter trap
 * 执行。所有 shape/prototype/descriptor 读取均在 try/catch；trap 或 getter 的任何
 * 异常都稳定映射 invalid，绝不 reject/fatal。namespaceId 先 `typeof` 短路——String
 * object 与 coercion valueOf/toString 一律不会被访问；owner 只接受 object /
 * null-prototype data descriptor（accessor 拒绝），userId 经 descriptor.value 读取
 * （不经 getter）。
 */
import { NAMESPACE_INVALID_IDENTITY_MESSAGE } from './types.js';
import type { OpenNamespaceIssue } from './types.js';

/** 内部身份（只读；owner 是冻结独立投影，key 是内部 map key——绝不写入公开文本）。 */
export interface InternalIdentity {
  readonly owner: Readonly<{ readonly userId: string }>;
  readonly namespaceId: string;
  readonly key: string;
}

/** Open 身份校验结果：invalid 只携带窄 issue（含失败字段 + 常量 message）——零 map/Persistence/Runtime 访问。 */
export type OpenIdentityOutcome =
  | { readonly ok: true; readonly identity: InternalIdentity }
  | {
      readonly ok: false;
      readonly issue: Extract<OpenNamespaceIssue, { code: 'NAMESPACE_INVALID_IDENTITY' }>;
    };

function invalid(field: 'owner.userId' | 'namespaceId'): OpenIdentityOutcome {
  const issue: Extract<OpenNamespaceIssue, { code: 'NAMESPACE_INVALID_IDENTITY' }> = Object.freeze({
    ok: false,
    code: 'NAMESPACE_INVALID_IDENTITY',
    field,
    message: NAMESPACE_INVALID_IDENTITY_MESSAGE,
  });
  return { ok: false, issue };
}

function isMinimalSafeString(value: string): boolean {
  if (value.length === 0) return false;
  if (value === '.' || value === '..') return false;
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    // C0/C1 控制字符（U+0000–U+001F、U+007F–U+009F）
    if ((c >= 0x0000 && c <= 0x001f) || (c >= 0x007f && c <= 0x009f)) return false;
    // '/'（0x2F）与 '\\'（0x5C）
    if (c === 0x2f || c === 0x5c) return false;
  }
  return true;
}

/**
 * Open 身份校验（设计 §4 伪码的逐行实现）。返回 frozenOwner 独立投影与内部 key
 * （长度前缀 + \u0000，避免简单拼接碰撞）。
 *
 * 短路顺序：namespaceId typeof 先行（String object 不进入）；owner 形状判断全部
 * 在 try/catch 内（getPrototypeOf/getOwnPropertyDescriptor trap → invalid），
 * 只接受 own data descriptor（desc.get/set === undefined）。
 */
export function validateOpenIdentity(owner: unknown, namespaceId: unknown): OpenIdentityOutcome {
  if (typeof namespaceId !== 'string' || !isMinimalSafeString(namespaceId)) {
    return invalid('namespaceId');
  }
  try {
    if (typeof owner !== 'object' || owner === null || Array.isArray(owner)) {
      return invalid('owner.userId');
    }
    const proto = Object.getPrototypeOf(owner);
    if (proto !== Object.prototype && proto !== null) {
      return invalid('owner.userId');
    }
    const desc = Object.getOwnPropertyDescriptor(owner, 'userId');
    if (desc === undefined || !('value' in desc) || desc.get !== undefined || desc.set !== undefined) {
      return invalid('owner.userId');
    }
    const userId = desc.value;
    if (typeof userId !== 'string' || !isMinimalSafeString(userId)) {
      return invalid('owner.userId');
    }
    const frozenOwner = Object.freeze({ userId });
    return {
      ok: true,
      identity: {
        owner: frozenOwner,
        namespaceId,
        key: `${userId.length}:${userId}\u0000${namespaceId.length}:${namespaceId}`,
      },
    };
  } catch {
    return invalid('owner.userId');
  }
}

/**
 * 内部 key 的固定不可逆诊断 token（测试受控 diagnostics 事件专用）：FNV-1a 64-bit
 * 纯 TS 摘要（零依赖、Host 无关），恒定输出 `keydigest:v1:<16 hex>`——不是 identity
 * 原文，不经 reverse 恢复；仅用于事件成对/代际匹配断言，绝不进入公开文本。
 */
export function digestKey(key: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= BigInt(key.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return `keydigest:v1:${hash.toString(16).padStart(16, '0')}`;
}
