/**
 * @nomicore/namespace-registry —— 最小兼容 identity 校验（issue #110 设计 §4；
 * issue #111 设计 §4 DQ-1 —— create 最小 identity 接纳）。
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
 * null-prototype data descriptor（accessor 拒绝；#111 起 input 顶层 owner/
 * namespaceId 读取同为 descriptor-only、accessor 零执行），userId 经
 * descriptor.value 读取（不经 getter）。
 */
import {
  NAMESPACE_CREATE_INVALID_INPUT_MESSAGE,
  NAMESPACE_INVALID_IDENTITY_MESSAGE,
} from './types.js';
import type { CreateNamespaceIssue, OpenNamespaceIssue } from './types.js';

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

/**
 * #111 create 接纳结果（设计 §4 DQ-1）；phase-5 切片 1（ADR 0010）修正：ok 携带**冻结
 * owner 投影**（namespaceId 不存在——槽内由注入受控 CSPRNG 生成）；失败只携带窄 issue
 * （`NAMESPACE_CREATE_INVALID_INPUT` 或 `NAMESPACE_INVALID_IDENTITY`，均常量 message）
 * ——零随机源/零 carrier/零 Persistence 副作用。
 */
export type CreateIdentityOutcome =
  | { readonly ok: true; readonly owner: Readonly<{ readonly userId: string }> }
  | { readonly ok: false; readonly issue: CreateNamespaceIssue };

/** create 顶层 input 非 object 的窄 issue（常量 message、零回显）。 */
export const CREATE_INVALID_INPUT_ISSUE: Extract<
  CreateNamespaceIssue,
  { code: 'NAMESPACE_CREATE_INVALID_INPUT' }
> = Object.freeze({
  ok: false,
  code: 'NAMESPACE_CREATE_INVALID_INPUT',
  message: NAMESPACE_CREATE_INVALID_INPUT_MESSAGE,
});

function invalid(field: 'owner.userId' | 'namespaceId'): OpenIdentityOutcome {
  const issue: Extract<OpenNamespaceIssue, { code: 'NAMESPACE_INVALID_IDENTITY' }> = Object.freeze({
    ok: false,
    code: 'NAMESPACE_INVALID_IDENTITY',
    field,
    message: NAMESPACE_INVALID_IDENTITY_MESSAGE,
  });
  return { ok: false, issue };
}

function invalidOwnerIssue(): Extract<CreateNamespaceIssue, { code: 'NAMESPACE_INVALID_IDENTITY' }> {
  return Object.freeze({
    ok: false,
    code: 'NAMESPACE_INVALID_IDENTITY',
    field: 'owner.userId',
    message: NAMESPACE_INVALID_IDENTITY_MESSAGE,
  });
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
 * Open 身份校验（设计 §4 伪码的逐行实现；phase-5 切片 1：key = namespaceId 本体——
 * 单成分键无拼接碰撞注入面，长度前缀复合键退役）。返回 frozenOwner 独立投影与内部 key。
 *
 * 短路顺序：namespaceId typeof 先行（String object 不进入）；owner 形状判断全部
 * 在 try/catch 内（getPrototypeOf/getOwnPropertyDescriptor trap → invalid），
 * 只接受 own data descriptor（desc.get/set === undefined）。
 */
export function validateOpenIdentity(owner: unknown, namespaceId: unknown): OpenIdentityOutcome {
  if (typeof namespaceId !== 'string' || !isMinimalSafeString(namespaceId)) {
    return invalid('namespaceId');
  }
  const ownerOutcome = validateOwnerIdentity(owner);
  if (!ownerOutcome.ok) {
    return invalid('owner.userId');
  }
  return {
    ok: true,
    identity: {
      owner: ownerOutcome.owner,
      namespaceId,
      key: namespaceId,
    },
  };
}

/** owner 校验结果：ok 携带冻结 owner 投影（仅 userId）；失败只携带窄 INVALID_IDENTITY. */
export type OwnerIdentityOutcome =
  | { readonly ok: true; readonly owner: Readonly<{ readonly userId: string }> }
  | { readonly ok: false; readonly issue: Extract<CreateNamespaceIssue, { code: 'NAMESPACE_INVALID_IDENTITY' }> };

/**
 * owner 校验段（从 validateOpenIdentity 抽出复用——open 路径零行为变化；create 接纳
 * 只校验 owner）。形状判断全部在 try/catch 内（getPrototypeOf/getOwnPropertyDescriptor
 * trap → invalid），只接受 own data descriptor（desc.get/set === undefined）。
 */
export function validateOwnerIdentity(value: unknown): OwnerIdentityOutcome {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { ok: false, issue: invalidOwnerIssue() };
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return { ok: false, issue: invalidOwnerIssue() };
    }
    const desc = Object.getOwnPropertyDescriptor(value, 'userId');
    if (desc === undefined || !('value' in desc) || desc.get !== undefined || desc.set !== undefined) {
      return { ok: false, issue: invalidOwnerIssue() };
    }
    const userId = desc.value;
    if (typeof userId !== 'string' || !isMinimalSafeString(userId)) {
      return { ok: false, issue: invalidOwnerIssue() };
    }
    return { ok: true, owner: Object.freeze({ userId }) };
  } catch {
    return { ok: false, issue: invalidOwnerIssue() };
  }
}

/**
 * #111 create 最小 identity 接纳（设计 §4 DQ-1；phase-5 切片 1 owner-only 重写，ADR
 * 0010：普通 create 不再接受调用方 namespaceId），冻结次序：
 * 1. 顶层 input 非 object（含 null/Array）→ `NAMESPACE_CREATE_INVALID_INPUT`；
 * 2. `namespaceId` 键出现即拒（data 或 accessor 描述符一律拒；accessor 零 getter
 *    执行）→ `NAMESPACE_CREATE_INVALID_INPUT`（四键输入与 key 缺省的双重拒绝面）；
 * 3. `owner` 描述符任意（data/accessor/缺键）→ accessor 或形状非法交 `validateOwnerIdentity`
 *    （descriptor-only 读取；accessor 描述符零 getter 执行、直接窄 CREATE_INVALID_INPUT；
 *    trap throw 仍 catch 为窄 CREATE_INVALID_INPUT）；
 * 4. owner 文法校验通过 → 冻结 owner 投影（本体三键化，namespaceId 由槽内受控随机源
 *    生成）。
 *
 * 关键时序事实：owner 投影在接纳时立即冻结——排队期间调用方改写 owner 或替换 input
 * 引用，不改最终 Persistence/create-document 身份（§4 不变量；对应「owner 冻结」红灯）。
 */
export function acceptCreateIdentity(inputRef: unknown): CreateIdentityOutcome {
  try {
    if (typeof inputRef !== 'object' || inputRef === null || Array.isArray(inputRef)) {
      return { ok: false, issue: CREATE_INVALID_INPUT_ISSUE };
    }
    const record = inputRef as Record<string, unknown>;
    // ① namespaceId 键出现即拒（data 或 accessor 描述符一律拒；accessor 零 getter 执行）
    if (Object.getOwnPropertyDescriptor(record, 'namespaceId') !== undefined) {
      return { ok: false, issue: CREATE_INVALID_INPUT_ISSUE };
    }
    // ② owner descriptor-only 形状门（沿用既有判别式：accessor → CREATE_INVALID_INPUT）
    const ownerDesc = Object.getOwnPropertyDescriptor(record, 'owner');
    if (
      ownerDesc !== undefined &&
      (!('value' in ownerDesc) || ownerDesc.get !== undefined || ownerDesc.set !== undefined)
    ) {
      return { ok: false, issue: CREATE_INVALID_INPUT_ISSUE };
    }
    // ③ owner 文法校验 + 冻结投影（field='owner.userId'；零随机/零 carrier/零 Persistence）
    return validateOwnerIdentity(ownerDesc?.value);
  } catch {
    return { ok: false, issue: CREATE_INVALID_INPUT_ISSUE };
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
