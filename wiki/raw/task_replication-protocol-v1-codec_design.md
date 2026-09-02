# SA1 设计 — `@nomicore/replication-protocol` v1 纯二进制 codec（issue #135）

- 任务类型：功能开发（Phase 5 切片 5）
- 规范唯一权威：`docs/protocols/instance-replication-v1.md`（下称「规范 v1」）
- 红灯验收锚点：`packages/replication-protocol/test/`（SA6 已写，9 文件 + fixtures.ts，18 个 golden）
- ADR 基准：`wiki/raw/task_replication-protocol-v1-codec_relevant_decisions.md`（ADR-0010 直接依据；ADR-0009 namespaceId 身份背景；issue AC 的 Buffer/Node server 收严项）
- 状态：R1 修订（落实 SA2 评审 #1–#5，评审全文 `wiki/raw/task_replication-protocol-v1-codec_sa2_review.md`，verdict=reject→窄面修订；核心架构未被推翻，无重构）

---

## 0. 输入摘要与已核实事实

设计输入与关键实证（全部在本 worktree 内核实，依据见 §16 协议假设依据）：

| # | 事实 | 来源 |
|---|---|---|
| F1 | 规范 v1 §3：20-byte 大端头（magic/version/type/flags/seq/len/reserved），一 WS message 一 frame | `docs/protocols/instance-replication-v1.md:46-60` |
| F2 | 消息注册表 17 条（0x01–0x41），错误注册表连接 17 条 + namespace 20 条（含双 registry INTERNAL_ERROR） | 规范 §5、§13.1、§13.2；fixtures `MESSAGE_TABLE`/`CONNECTION_ERROR_TABLE`/`NAMESPACE_ERROR_TABLE` |
| F3 | SA6 红灯测试锚定的**解码检查顺序**（9 步）与错误分类已固化在 `test/fixtures.ts:17-31` 注释 | `packages/replication-protocol/test/fixtures.ts` |
| F4 | lib0@0.2.117 `readVarString` 走 `new TextDecoder('utf-8',{fatal:true,ignoreBOM:true})`，但 Safari 探测失败时会退化为不抛错的 polyfill | `node_modules/.pnpm/lib0@0.2.117/node_modules/lib0/string.js:98` |
| F5 | lib0 `readVarUint8Array = readUint8Array(readVarUint)` **无边界检查**：声明长度超界时 `new Uint8Array(buffer,offset,len)` 抛 RangeError（未分类异常）；`readVarUint` 接受非最短 LEB128 | `lib0/decoding.js:122,95-107,245-265` |
| F6 | lib0 `readUint32BigEndian` 越界读到 `undefined` → `NaN >>> 0 === 0` **静默返回 0** | `lib0/decoding.js:188-197` |
| F7 | lib0 encoding 侧 `writeVarUint`（最短 LEB128，上限 2^53）、`writeUint32BigEndian`、`writeVarString`（varUint(len)+UTF-8）均为 canonical 且与 golden 十六进制逐字节一致 | `lib0/encoding.js:232,260-267,344`；fixtures golden 已「与 lockfile lib0@0.2.117 行为逐项核对」 |
| F8 | 锁定版本组合现状：lockfile `yjs@13.6.32`（specifier `^13.6.30`）、`lib0@0.2.117`（传递依赖）；`y-protocols` 不在 lockfile，需新增直接依赖；`y-protocols@1.0.7` = deps `lib0 ^0.2.85` + peer `yjs ^13.0.0`（兼容） | `pnpm-lock.yaml:663,834`；`npm view y-protocols@1.0.7`（本会话实测） |
| F9 | 包名自引用解析：根 `node_modules` 无 `@nomicore/` 链接，`packages/vfsl-protocol/test` 通过 `import '@nomicore/vfsl-protocol'` 依赖 package.json `exports` **自引用**机制解析（实测 `pnpm exec vitest run packages/vfsl-protocol` → 20 passed） | 实测 2026-08-27，见 §16 |
| F10 | 红灯测试 `codec-api.test-d.ts` 曾存在一处**无法由任何包实现满足**的类型层断言（TS1361，R0 报告为 :85 值用位）；**SA6 已于 2026-08-27 修订**，现 :87 为 `expectTypeOf<ProtocolError>()` 类型实参形式（SA2 R1 评审现场复核通过，§15.1） | R0 实测复现 + SA2 复核，见 §15.1 |
| F11 | 工程接线：根 `pnpm typecheck` 逐包串 `tsc -p packages/<pkg>/tsconfig.json`（新包必须追加）；vitest include `packages/*/test/**/*.test.ts` 与 typecheck include `packages/*/test/**/*.test-d.ts` 已自动覆盖新包，**无需改** `vitest.config.ts` / `tsconfig.typecheck.json` | 根 `package.json`、`vitest.config.ts`、`tsconfig.typecheck.json` |
| F12 | **（R1 新增）**红灯测试 `codec-fuzz-property.test.ts` 的 property 生成器与 malformed 测试的 nonce 规则**互斥**：`randomMessage()`（:95-138）case 0/1 用 `randomBytes()`（长度 ∈ [0,63] 随机）填 HELLO/HELLO_ACK 的 `connectionNonce`，而规范 §6.1 + `codec-malformed.test.ts:214-225,388-427` 要求恰 16 字节。SA1 独立确定性复现（mulberry32(0x99aa) 全消耗序复刻）：300 轮共 32 次 nonce 抽取**全部 ≠16**，首个违规 i=4（36 字节）、i=11 恰 15、i=142 恰 17——任何实现二选一必挂另一侧（详见 §15.2） | SA1 复现脚本输出（§15.2 内嵌命令+结果），与 SA2 模拟逐数字吻合 |

---

## 1. 需求推演（Feature）

### 1.1 切入点

在 `packages/` 下新建纯库 `@nomicore/replication-protocol`，位于依赖链最底层：只依赖 lib0（运行时）与 yjs/y-protocols（锁定组合的 manifest 级声明），向上为后续切片 `@nomicore/ws-replication` 提供帧/消息编解码、注册表元数据与协商纯函数。所有函数均为无状态纯函数（same-input → same-output，无隐藏连接状态）。

### 1.2 与现有架构的一致性

- ADR-0010「包、应用与生命周期」第 1 项明确本包形态：纯二进制 codec、显式版本协商、消息与稳定错误，不依赖 Cordis、WS 或 Registry → 设计完全对齐。
- ADR-0005 §5「`packages/` = 可复用库」→ 落位 `packages/replication-protocol`。
- 仓库包形态惯例（`packages/vfsl-protocol` 为参照）：`exports: { ".": "./src/index.ts" }` TS 直出、`private: true`、`type: module`、逐包 `tsconfig.json` extends `tsconfig.base.json` → 照搬惯例。
- CONTEXT.md 术语纪律：本设计的「envelope」一律指 **NMCR wire 头**（ADR-0010 用法），与 SCHEMA 四键信封同名不同域；文档与命名（`FrameHeader`/`ENVELOPE_*`）已按域区分。

### 1.3 非目标（本票不做，防 scope creep）

- WS 连接/namespace/sync 状态机、认证授权、背压调度（属切片 6/7）；
- sequence 递增/回绕的**状态跟踪**（codec 只提供 `expectedSequence` 严格相等检查 seam；「从 1 严格递增、不回绕」是状态层纪律——规范 §1.2，roundtrip 红灯测试明示「不回绕由状态层负责，codec 须可承载 0xffffffff」）；
- 消息 direction/ack 语义的**强制**（codec 只在注册表**暴露**元数据；direction 违规属状态层）；
- Yjs 字节的解释/合并/apply（codec 把 stateVector/update/snapshot 当不透明 `varUint8Array` 载荷；红灯测试断言「codec 不解释/不改写 Yjs 字节」）；
- fake duplex 状态机与真实 WS 集成测试（规范 §22 后两项，属后续切片）。

### 1.4 全局兼容保障

新包零 caller（greenfield），不改任何既有模块行为；唯一跨文件改动是根 `package.json` typecheck 脚本链追加一行（§14）。版本协商按 ADR-0010「不得按消息数值猜版本」设计为两层显式协商（§8）。

---

## 2. 包结构与模块划分

```
packages/replication-protocol/
├── package.json            # §11：name/type/exports/deps（lib0+yjs+y-protocols 显式直接依赖）
├── tsconfig.json            # { "extends": "../../tsconfig.base.json", "include": ["src/**/*.ts", "test/**/*.ts"] }
├── src/
│   ├── index.ts             # 公共 API 汇出（唯一入口，全部 re-export，无逻辑）
│   ├── constants.ts         # ENVELOPE_MAGIC/'NMCR'、ENVELOPE_VERSION=1、ENVELOPE_HEADER_BYTES=20、
│   │                        # DEFAULT_MAX_FRAME_BYTES=16MiB、PROTOCOL_OVERHEAD_BYTES=128（R1 修正，推导见 §10）、
│   │                        # namespaceId/replicationId/instanceId 正则与 NONCE_BYTES=16
│   ├── errors.ts            # ProtocolError 类 + 连接/namespace 错误注册表（append-only、深冻结）+ lookupError
│   ├── messages.ts          # 消息注册表（17 条，冻结）+ MessageName/MessageInfo + ReplicationMessage 判别联合（17 成员）
│   ├── canonical.ts         # CanonicalReader（有界、canonical、严格 UTF-8 读）+ PayloadWriter（lib0/encoding 封装）
│   ├── envelope.ts          # encodeFrame/decodeFrame + FrameHeader/DecodedFrame（20-byte 大端头，§4）
│   ├── payloads.ts          # 17 种消息的 payload 编解码 + 字段级验证（§7 字段表逐条落地）
│   ├── limits.ts            # FieldLimits 类型 + validateCodecLimits（§17 启动响亮验证，无运行时 clamp）
│   └── negotiation.ts       # selectProtocolVersion / selectCapabilities（§8）
└── test/                    # SA6 已写：fixtures.ts + 8 个 *.test.ts + 1 个 *.test-d.ts（红灯，本设计不改动断言）
```

模块依赖方向（单向无环）：`index → {envelope, payloads, negotiation, errors, messages, limits, constants}`；`envelope/payloads → canonical, errors, messages, constants, limits`；`canonical → errors`；`errors/messages → constants`。`canonical` 与 `envelope` 互不依赖（envelope 是纯头算术，不用 lib0）。

拆分理由：注册表（errors/messages）与编解码（envelope/payloads/canonical）分离，使 ws-replication 可以只 import 注册表元数据而不拖入 codec 实现；协商纯函数独立成模块便于矩阵测试定位。

---

## 3. 公共 API 契约（与红灯测试逐一对齐）

`src/index.ts` 导出（★ = 红灯测试直接 import 的名字，缺一即红）：

```ts
// —— 常量（codec-envelope.test.ts）
export const ENVELOPE_MAGIC = 'NMCR';            // ★ expect(ENVELOPE_MAGIC).toBe('NMCR')
export const ENVELOPE_VERSION = 1;               // ★
export const ENVELOPE_HEADER_BYTES = 20;         // ★
export const DEFAULT_MAX_FRAME_BYTES = 16 * 1024 * 1024; // fixtures 注释「缺省 16 MiB」
export const PROTOCOL_OVERHEAD_BYTES = 128;      // §10 校验用保守开销上界（R1 修正：逐消息最坏推导见 §10，最贵 BOOTSTRAP_SNAPSHOT 最坏 102）

// —— 类型（codec-api.test-d.ts / 各 .test.ts）
export type MessageName = 'HELLO' | 'HELLO_ACK' | 'GOAWAY' | 'ERROR' | 'OPEN_NAMESPACE' | 'OPEN_OK'
  | 'CLOSE_NAMESPACE' | 'CLOSE_OK' | 'BOOTSTRAP_SNAPSHOT' | 'BOOTSTRAP_ACK' | 'IDENTITY_CHANGED'
  | 'SYNC_STEP1' | 'SYNC_STEP2' | 'SYNC_APPLIED' | 'RESYNC_REQUIRED' | 'UPDATE' | 'UPDATE_ACK';
export type MessageScope = 'connection' | 'namespace' | 'either';
export type MessageDirection = 'peer-to-hub' | 'hub-to-peer' | 'either';
export interface MessageInfo { readonly code: number; readonly scope: MessageScope;
  readonly direction: MessageDirection; readonly ack: string; }
export interface FrameHeader { envelopeVersion: number; messageType: number; flags: number;
  sequence: number; payloadLength: number; reserved: number; }
export interface DecodedFrame { header: FrameHeader; payload: Uint8Array; }   // payload = 输入的 subarray 视图
export interface DecodedMessage { header: FrameHeader; message: ReplicationMessage; }

// ReplicationMessage：17 成员判别联合，kind 为判别键（成员形状 = fixtures.ts 的 17 个 interface，
// 字段名逐一相同；optional 字段按 exactOptionalPropertyTypes 语义「缺席即省略键」）
export type ReplicationMessage = HelloMsg | HelloAckMsg | GoawayMsg | ErrorMsg | OpenNamespaceMsg
  | OpenOkMsg | CloseNamespaceMsg | CloseOkMsg | BootstrapSnapshotMsg | BootstrapAckMsg
  | IdentityChangedMsg | SyncStep1Msg | SyncStep2Msg | SyncAppliedMsg | ResyncRequiredMsg
  | UpdateMsg | UpdateAckMsg;

// ERROR 成员（test-d 断言：无 fatal/retryable 可覆盖字段——元数据只能来自注册表）
export interface ErrorMsg { kind: 'ERROR'; code: string; safeMessage: string;
  relatedSequence?: number; namespaceId?: string; }

// —— 注册表（codec-registries.test.ts；全部 Object.freeze 深冻结）
export const MESSAGE_TYPES: Readonly<Record<MessageName, number>>;        // ★ 恰 17 键
export const MESSAGE_NAMES: Readonly<Record<string, MessageName>>;        // ★ code(数字键) → name 逆映射
export const MESSAGE_REGISTRY: Readonly<Record<MessageName, MessageInfo>>;// ★
export type ConnectionErrorCode = 'BAD_MAGIC' | ... /* §6 全 17 个字面量 */;
export type NamespaceErrorCode = 'TARGET_NOT_REQUESTED' | ... /* §6 全 20 个字面量 */;
export type RetryPolicy = 'no' | 'yes' | 'config' | 'reconnect' | 'reset' | 'recovery' | 'resync';
export type TerminalState = 'failed' | 'closed' | 'conflicted' | 'needs-resync';
export interface ErrorInfo { readonly code: string; readonly scope: 'connection' | 'namespace';
  readonly fatal: boolean; readonly retryable: RetryPolicy;
  readonly wsCloseCode?: number;        // 仅 connection 条目；test-d 断言 number | undefined
  readonly terminalState?: TerminalState; } // 仅 namespace 条目
export const CONNECTION_ERRORS: Readonly<Record<ConnectionErrorCode, ErrorInfo>>;  // ★ 恰 17 条
export const NAMESPACE_ERRORS: Readonly<Record<NamespaceErrorCode, ErrorInfo>>;    // ★ 恰 20 条
export function lookupError(scope: 'connection' | 'namespace', code: string): ErrorInfo | undefined; // ★

// —— 帧层（codec-envelope.test.ts / fuzz）
export interface EncodeFrameInput { messageType: number; sequence: number; payload: Uint8Array; }
export interface FrameOptions { maxFrameBytes?: number; }
export function encodeFrame(frame: EncodeFrameInput, options?: FrameOptions): Uint8Array;  // ★
export function decodeFrame(bytes: Uint8Array, options?: DecodeOptions): DecodedFrame;     // ★

// —— 消息层
export interface FieldLimits { maxUpdateBytes?: number; maxBootstrapBytes?: number; maxSyncDiffBytes?: number; }
export interface DecodeOptions { maxFrameBytes?: number; expectedSequence?: number; limits?: FieldLimits; }
export interface EncodeOptions { sequence?: number; maxFrameBytes?: number; limits?: FieldLimits; } // sequence 缺省 1
export function encodeMessage(message: ReplicationMessage, options?: EncodeOptions): Uint8Array; // ★
export function decodeMessage(bytes: Uint8Array, options?: DecodeOptions): DecodedMessage;        // ★

// —— 协商（codec-version-interop.test.ts）
export function selectProtocolVersion(peerVersions: number[], hubVersions: number[]): number | null; // ★
export function selectCapabilities(required: number, optional: number, supported: number):
  { ok: boolean; selected: number };                                                                   // ★

// —— 错误
export class ProtocolError extends Error { … }  // ★ §9

// —— limits 校验（§10；响应规范 §17「配置启动时响亮验证，不得运行时 clamp」）
export function validateCodecLimits(limits: { maxFrameBytes: number; maxUpdateBytes: number;
  maxBootstrapBytes: number; maxSyncDiffBytes: number }): void;
```

类型层硬约束（tsc --typecheck 红灯锚点，SA3 必须逐条过）：

| test-d 断言 | 本设计满足方式 |
|---|---|
| `parameter(0)` of encodeMessage `toEqualTypeOf<ReplicationMessage>()` | 第一形参恰为联合类型（非宽松化） |
| `DecodedMessage['message']` `toEqualTypeOf<ReplicationMessage>()` | 同一类型引用 |
| `ReplicationMessage['kind']` `toEqualTypeOf<MessageName>()` | 17 个 kind 字面量集合与 MessageName 完全一致（不多不少） |
| `FrameHeader` 形状 | 6 字段全 number，键名逐字符一致 |
| `extract<{kind:'ERROR'}>` 无 fatal/retryable | ErrorMsg 不含元数据字段 |
| `CONNECTION_ERRORS.BAD_MAGIC.wsCloseCode` = `number \| undefined` | 错误注册表用 `Record<ConnectionErrorCode, ErrorInfo>`（字面量键，避开 noUncheckedIndexedAccess 加 undefined 的 index-signature 行为），`wsCloseCode?` 可选 |
| `selectProtocolVersion.parameter(0)` = `number[]` | 用可变数组（非 `readonly number[]`） |
| `selectCapabilities.returns` 恰 `{ok,selected}` | 返回类型即该内联形状 |

---

## 4. Envelope 编解码与检查顺序（§3 规范 + fixtures 固化顺序）

### 4.1 头布局（20 bytes，全 big-endian）

| Offset | Size | 字段 | 编码规则 | 解码校验（失败码） |
|---:|---:|---|---|---|
| 0 | 4 | magic | ASCII `NMCR` = `4e 4d 43 52` | 逐字节相等，否则 `BAD_MAGIC` |
| 4 | 1 | envelopeVersion | 恒 `1` | ≠1 → `UNSUPPORTED_ENVELOPE_VERSION` |
| 5 | 1 | messageType | 注册表 code | 未注册 → `UNSUPPORTED_MESSAGE_TYPE` |
| 6 | 2 | flags | 恒 `0`（BE u16） | ≠0 → `UNSUPPORTED_FLAGS` |
| 8 | 4 | sequence | BE u32，承载任意 u32（含 0xffffffff；起始/递增纪律归状态层） | expectedSequence 提供且不等 → `SEQUENCE_VIOLATION` |
| 12 | 4 | payloadLength | BE u32 | `byteLength ≠ 20+payloadLength` → `FRAME_LENGTH_MISMATCH` |
| 16 | 4 | reserved | 恒 `0`（BE u32） | ≠0 → `MALFORMED_FRAME` |

### 4.2 decodeFrame 检查顺序（**固定，不允许实现自由发挥**——顺序即分类确定性）

fixtures.ts:17-31 固化的 9 步（本设计第 9 步为 sequence seam，位置：长度校验之后、payload 之前——规范 §3「Decoder 在复制或分配 payload 前检查 maxFrameBytes、magic、版本、flags、reserved、sequence 与长度」允许 sequence 在 payload 前的任意位置；红灯测试唯一锚点是「合法帧 + 错误 expectedSequence → SEQUENCE_VIOLATION」，本顺序满足且不与任何已锚定顺序冲突）：

```ts
function decodeFrame(bytes: Uint8Array, options?: DecodeOptions): DecodedFrame {
  const maxFrameBytes = resolveMaxFrameBytes(options?.maxFrameBytes); // 非法值 → CONNECTION_POLICY_VIOLATION（§10）
  // 1. byteLength < 4 或前 4 字节 ≠ 'NMCR'          → ProtocolError('BAD_MAGIC')
  // 2. byteLength < 20                               → ProtocolError('FRAME_LENGTH_MISMATCH')
  // 3. bytes[4] !== 1                                → ProtocolError('UNSUPPORTED_ENVELOPE_VERSION')
  // 4. be16(bytes,6) !== 0                           → ProtocolError('UNSUPPORTED_FLAGS')
  // 5. be32(bytes,16) !== 0                          → ProtocolError('MALFORMED_FRAME')
  // 6. bytes[5] 不在消息注册表                        → ProtocolError('UNSUPPORTED_MESSAGE_TYPE')
  // 7. bytes.byteLength > maxFrameBytes（缺省 16MiB） → ProtocolError('FRAME_TOO_LARGE')
  //    （边界：byteLength === maxFrameBytes 通过——红灯测试 `maxFrameBytes: full.byteLength` 必须绿）
  // 8. bytes.byteLength !== 20 + be32(bytes,12)       → ProtocolError('FRAME_LENGTH_MISMATCH')
  //    （少一/多一/尾随/巨大声明短 body 全部在此步拒绝；发生在任何 payload 复制/分配之前）
  // 9. options?.expectedSequence !== undefined
  //    && be32(bytes,8) !== expectedSequence           → ProtocolError('SEQUENCE_VIOLATION')
  return { header: { envelopeVersion: 1, messageType: bytes[5], flags: 0,
                     sequence: be32(bytes,8), payloadLength: be32(bytes,12), reserved: 0 },
           payload: bytes.subarray(20) };   // 零拷贝视图；本函数绝不写输入
}
```

要点：

- **步骤 1 先于步骤 2**：0–3 字节输入 → `BAD_MAGIC`；4–19 字节（magic 正确）→ `FRAME_LENGTH_MISMATCH`。这是每-offset 截断测试的分类基准（`codec-roundtrip-truncation.test.ts:73-82`）。
- **payload 是 `subarray` 视图，不复制不分配**——「校验发生在按 payloadLength 复制/分配之前」由构造满足；调用方若需保留 payload 超出输入生命周期须自行复制（JSDoc 声明）。fuzz 测试 `Object.getPrototypeOf(payload) === Uint8Array.prototype` 由 `subarray` 天然满足。
- **（R1/决策 D-5）payload 视图的原型跟随输入 buffer**：`decodeFrame` 接受任何 `Uint8Array`（含 Node `Buffer` 子类实例——ws-replication 在 Node 侧的现实喂入形态）；`subarray` 产出的视图原型 = 输入原型，故 Buffer 输入时 `payload` 的原型是 `Buffer.prototype`。**调用方不得以原型做 Buffer 嗅探或身份判断**（JSDoc 明示）。选择文档化而非输入规范化（`new Uint8Array(bytes)` 拷贝）以保持零拷贝；本包**自产输出**（encodeFrame/encodeMessage 结果、decodeMessage 的全部字段 bytes——`readVarUint8ArrayCopy` 精确拷贝）原型恒为 `Uint8Array.prototype`，§11.2 的承诺范围以此为准确边界。
- `be16`/`be32` 在长度 ≥20 已保证后做纯算术（`bytes[8]<<24 | … >>> 0`），不引入 DataView 偏移陷阱。

### 4.3 encodeFrame

```ts
function encodeFrame({ messageType, sequence, payload }: EncodeFrameInput, options?): Uint8Array {
  // a. messageType 未注册                       → ProtocolError('UNSUPPORTED_MESSAGE_TYPE')（红灯：0x05 必拒）
  // b. sequence 非 [0, 2^32-1] 安全整数          → ProtocolError('MALFORMED_FRAME')
  // c. payload 非 Uint8Array                    → ProtocolError('MALFORMED_FRAME')（运行时防御）
  // d. payload.byteLength > 0xFFFFFFFF          → ProtocolError('MALFORMED_FRAME')（u32 长度域溢出）
  // e. 20 + payload.byteLength > maxFrameBytes  → ProtocolError('FRAME_TOO_LARGE')（红灯：1000B payload + max 100 必拒）
  // 写 20 字节头（flags/reserved 恒 0）+ payload 拷贝 → 返回新 Uint8Array，byteLength === 20 + payloadLength（一 message 一 frame 不变式）
}
```

输出恒为全新分配的 `Uint8Array`（原型恰 `Uint8Array.prototype`，无 Buffer——§11）。

---

## 5. Payload 的 lib0 canonical 编解码

### 5.1 规范要求（§4）与 lib0 现实的落差

规范：字符串 `varString`、bytes `varUint8Array`、非负整数 `varUint`、bool `u8 0|1`、optional `u8 0|1`+值、list `varUint count`+逐项、capability 固定 uint32 BE；decoder 必须完全消费、拒绝截断/溢出/非 canonical/非法 UTF-8/错误 optional marker/超界/尾随。

**直接用 lib0 decoding 会违反红灯契约**（依据 F4/F5/F6）：

| lib0@0.2.117 行为 | 后果 | 红灯冲突 |
|---|---|---|
| `readVarUint` 接受非最短 LEB128（`82 00`、`80 00`） | 非 canonical 帧被接受 | `codec-malformed.test.ts:106-120` 要求 `MALFORMED_FRAME` |
| `readVarUint8Array` 声明长度超界 → `new Uint8Array(buffer,off,len)` 抛 RangeError | 未分类异常逃逸 | fuzz 契约「绝不抛未分类异常」 |
| `readUint32BigEndian` 截断 → NaN→0 静默 | capability 假值静默通过 | 「拒绝截断」+ 拒绝虚假降级立法 |
| `readVarString` 的 TextDecoder 在 Safari 探测分支退化为非 fatal polyfill | 非法 UTF-8（`c3 28`）不抛错 | `codec-malformed.test.ts:50-65` 要求 `MALFORMED_FRAME` |

**结论（决策 D-1）**：读路径完全自研 `CanonicalReader`（有界 + canonical + 严格 UTF-8，任何失败→`ProtocolError`）；**写路径用 lib0/encoding**（F7：canonical 产出者、规范点名的直接依赖、golden 已按其行为核对）。这样既锁定 lib0 语义为 wire 契约的生产侧权威，又不继承其解码侧的宽松行为。

### 5.2 CanonicalReader（`src/canonical.ts`）

作用对象：payload 视图（长度已由帧层步骤 8 钉死）。

```ts
class CanonicalReader {
  constructor(buf: Uint8Array)          // 私有 pos=0；buf 即 payload 视图
  get remaining(): number
  expectEnd(): void                     // pos !== buf.length → ProtocolError('MALFORMED_FRAME')（完全消费原则）

  readU8(): number                      // remaining<1 → MALFORMED_FRAME；返回 buf[pos++]
  readBool(): boolean                   // readU8；值 ∉ {0,1} → MALFORMED_FRAME
  readUint32BE(): number                // remaining<4 → MALFORMED_FRAME；4 字节 BE（先检查后读，杜绝 F6）

  readVarUint(): number                 // 见下；canonical、有界、安全整数
  readVarUint32(): number               // readVarUint() 再验 ≤ 0xFFFFFFFF（sequence/roundId/acked 类字段）

  readVarUint8ArrayCopy(): Uint8Array   // len=readVarUint()；pos+len>end 先拒绝（分配前检查！）；
                                       // 然后 new Uint8Array(len) 精确拷贝。绝无越界分配。
  readVarString(): string               // raw=readVarUint8ArrayCopy()；fatal TextDecoder 解码；
                                       // 解码 throw → MALFORMED_FRAME（非法 UTF-8）
}

// canonical varUint（无符号 LEB128 最短形式）：
readVarUint():
  let value=0, mult=1, count=0, last=0
  loop:
    if count >= 8            → MALFORMED_FRAME      // 超出 2^53 可表示范围（ceil(53/7)=8 字节上限）
    if remaining < 1         → MALFORMED_FRAME      // 截断
    b = buf[pos++]; count++; last = b
    value += (b & 0x7f) * mult; mult *= 128
    if b < 0x80: break
  if count > 1 && last === 0 → MALFORMED_FRAME      // 非最短（唯一可能的非 canonical 形态：末字节为 0）
  if value > Number.MAX_SAFE_INTEGER → MALFORMED_FRAME
  return value
```

canonical 性判据说明（设计期推导 + F5 佐证）：无符号 LEB128 的终止由高位 bit 决定，多余的字节只能以「末尾 0x00」形式存在（中间补零会改变数值位权，不可能保持同值），因此「多字节且末字节为 0 ⇔ 非最短」是完整判据。该判据使 `82 00`（=2）、`80 00`（=0）被拒而 `06`、`88 27`、`ff ff ff ff 7f` 通过——与红灯用例逐一相符。

严格 UTF-8（决策 D-2）：

```ts
const utf8Decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
```

- `fatal: true`：`c3 28` 等 → throw → 映射 `MALFORMED_FRAME`；
- `ignoreBOM: true`：**不剥离 BOM**（EF BB BF 解码为 U+FEFF 内容）。这是 canonical roundtrip 不变量的必要条件——若剥 BOM，decode→encode 会丢失 3 字节，fuzz「成功即逐字节还原」即被破坏。与 lib0 的 TextDecoder 配置一致（F4）。

### 5.3 PayloadWriter（写路径，lib0/encoding 封装）

```ts
import * as encoding from 'lib0/encoding';   // 显式直接依赖（规范 §4「将 lib0 声明为协议包直接依赖」）

class PayloadWriter {
  private encoder = encoding.createEncoder();
  writeU8(n: number)                  // encoding.writeUint8
  writeBool(b: boolean)               // 0|1
  writeUint32BE(n: number)            // encoding.writeUint32BigEndian（capability bitset）
  writeVarUint(n: number)             // encoding.writeVarUint（最短 LEB128，F7）
  writeVarUint8Array(b: Uint8Array)   // encoding.writeVarUint8Array
  writeVarString(s: string)           // encoding.writeVarString（varUint(len)+UTF-8）
  finish(): Uint8Array                // encoding.toUint8Array（精确长度、纯 Uint8Array）
}
```

写前输入验证保证 lib0 不会被喂非法值：所有 varUint 字段先验「非负安全整数」（≤2^32-1 的字段另加 u32 上限），字符串先验 well-formed（见 §7 通用规则 R6），capability 先验 u32 域——lib0 `writeVarUint` 对 >2^53 输入会精度损失静默产出错字节，验证前置即封死。

---

## 6. 消息/错误注册表与不可变元数据（AC3/AC4）

### 6.1 消息注册表（`src/messages.ts`，规范 §5 全表移植）

17 条，code/scope/direction/ack 四元组与规范表逐格一致（红灯 `MESSAGE_TABLE/SCOPE/DIRECTION/ACK` 四张表全量比对 + 「无多余条目」+ 码空间洞检查 0x00/0x05–0x0f/0x14–0x1f/0x23–0x2f/0x34–0x3f/0x42+ 未注册）：

| code | name | scope | direction | ack |
|---:|---|---|---|---|
| 0x01 | HELLO | connection | peer-to-hub | `ERROR-or-HELLO_ACK` |
| 0x02 | HELLO_ACK | connection | hub-to-peer | `none` |
| 0x03 | GOAWAY | connection | either | `none` |
| 0x04 | ERROR | either | either | `never-acked` |
| 0x10 | OPEN_NAMESPACE | namespace | peer-to-hub | `ERROR-or-OPEN_OK` |
| 0x11 | OPEN_OK | namespace | hub-to-peer | `none` |
| 0x12 | CLOSE_NAMESPACE | namespace | either | `CLOSE_OK` |
| 0x13 | CLOSE_OK | namespace | either | `none` |
| 0x20 | BOOTSTRAP_SNAPSHOT | namespace | hub-to-peer | `ERROR-or-BOOTSTRAP_ACK` |
| 0x21 | BOOTSTRAP_ACK | namespace | peer-to-hub | `none` |
| 0x22 | IDENTITY_CHANGED | namespace | hub-to-peer | `terminal-conflict` |
| 0x30 | SYNC_STEP1 | namespace | either | `SYNC_STEP2` |
| 0x31 | SYNC_STEP2 | namespace | either | `SYNC_APPLIED` |
| 0x32 | SYNC_APPLIED | namespace | either | `none` |
| 0x33 | RESYNC_REQUIRED | namespace | either | `peer-starts-new-round` |
| 0x40 | UPDATE | namespace | either | `UPDATE_ACK` |
| 0x41 | UPDATE_ACK | namespace | either | `none` |

注：codec **不强制** direction/ack——只在注册表暴露元数据供 ws-replication 状态机使用（红灯测试仅断言注册表内容，不断言编解码时强制）。

`MESSAGE_NAMES` 的键类型依据（决策 D-4）：红灯测试 `codec-registries.test.ts:40` 以 `Object.entries` 产出的 **string** 键索引 `MESSAGE_NAMES[code]`，故类型定为 `Readonly<Record<string, MessageName>>`（运行时键本就是十进制数字符串；数字字面量索引在 string index signature 下同样合法）。`MESSAGE_TYPES` 则为 `Readonly<Record<MessageName, number>>`（字面量键联合，`MESSAGE_TYPES[name as keyof typeof MESSAGE_TYPES]` 精确非 undefined）。

### 6.2 错误注册表（`src/errors.ts`，规范 §13.1/§13.2 全表移植）

- `CONNECTION_ERRORS`：恰 17 条，含 `wsCloseCode`（1002/1008/1009/1011 按 §13.1）；`retryable ∈ {no,yes,config}`。
- `NAMESPACE_ERRORS`：恰 20 条，含 `terminalState`（failed/closed/conflicted/needs-resync）；`retryable ∈ {no,config,reconnect,reset,recovery,resync}`；`ACK_TIMEOUT` 是唯一 `fatal:false`（terminalState `needs-resync`）。
- `INTERNAL_ERROR` 在两表并存且元数据不同（connection: retryable `yes`/wsClose 1011；namespace: retryable `reconnect`/terminal `failed`）——`lookupError(scope, code)` 按 scope 定位，跨 scope 不可见（红灯：`lookupError('connection','ACK_TIMEOUT')` → undefined）。
- **不可变性**：注册表对象与每个条目对象都 `Object.freeze`（深冻结一层足够——条目字段全是原始值）。红灯断言 `Object.isFrozen` 于表与条目、冻结后写入 throw（strict mode 下 `TypeError`）。append-only 纪律：修改注册表只能走源码新增条目 + 版本化（v1 内禁改语义）。

### 6.3 ERROR wire 元数据推导（AC4 核心）

ERROR payload（§13 字段顺序固定）：`scope(u8) → code(varString) → fatal(bool) → retryable(bool) → relatedSequence(optional varUint) → namespaceId(optional varString) → safeMessage(varString)`。

- **encode 侧**：调用方只提供 `{kind, code, safeMessage, relatedSequence?, namespaceId?}`；scope/fatal/retryable **由注册表推导，类型层面即不可覆盖**（ErrorMsg 无这些字段，test-d 锚点）。
- **wire retryable bool 的推导规则**：`retryable_wire = (registry.retryable !== 'no')`。依据：golden `ACK_TIMEOUT`（registry `resync`）的 wire 位是 `01`（`codec-messages-golden.test.ts:239-242` 断言 payload 前缀 `...544f55540001` = fatal 00 / retryable 01），BAD_MAGIC（`no`）为 `00`。
- **encode 的 scope 解析规则（决策 D-3，解决 INTERNAL_ERROR 双注册表歧义）**：`namespaceId` 提供且非 undefined → namespace scope（code 必须在 `NAMESPACE_ERRORS`，否则 `MALFORMED_FRAME`）；否则 connection scope（code 必须在 `CONNECTION_ERRORS`，否则 `MALFORMED_FRAME`）。红灯锚点：namespace-only code `SYNC_STATE_VIOLATION` 无 namespaceId → `MALFORMED_FRAME`；`NO_SUCH_CODE` → `MALFORMED_FRAME`。
- **decode 侧一致性**：scope u8 ∉{0,1} → `MALFORMED_FRAME`；code 不在该 scope 注册表 → `MALFORMED_FRAME`；wire fatal bool ≠ registry.fatal → `MALFORMED_FRAME`；wire retryable bool ≠ (registry.retryable !== 'no') → `MALFORMED_FRAME`；namespace scope 缺 namespaceId 或 connection scope 带 namespaceId → `MALFORMED_FRAME`（红灯：篡改 fatal 位两个方向均覆盖；scope 混用覆盖）。

---

## 7. 每消息字段表与验证规则（payloads.ts）

### 7.0 通用规则（全消息适用）

| # | 规则 | 失败码 |
|---|---|---|
| R1 | 解码结尾必须 `expectEnd()`（payload 完全消费；声明长度内的尾随字节即违规） | MALFORMED_FRAME |
| R2 | namespace-scope 消息首字段 `varString namespaceId`，严格匹配 `^ns-[0-9a-f]{32}$` | MALFORMED_FRAME |
| R3 | `replicationId` 严格匹配 `^[0-9a-f]{32}$`（32 小写 hex） | MALFORMED_FRAME |
| R4 | `replicationEpoch` ≥ 1 且 ≤ MAX_SAFE_INTEGER（规范 §1「从 1 开始的安全整数」） | MALFORMED_FRAME |
| R5 | instanceId 类字段（peerInstanceId/expectedHubInstanceId/hubInstanceId）匹配 `^[a-z][a-z0-9-]{0,62}$`（ADR-0010 安全文法） | MALFORMED_FRAME |
| R6 | **encode 侧字符串 well-formed 检查**：含未配对代理项（lone surrogate）的字符串 → 拒绝（TextEncoder 会静默替换为 U+FFFD，破坏 canonical roundtrip；这是「拒绝虚假降级」立法在 encode 侧的落点） | MALFORMED_FRAME |
| R7 | optional marker 只接受 0/1；marker=1 后值必须完整存在 | MALFORMED_FRAME |
| R8 | 所有 u32 语义字段（syncRoundId/ackedSequence/relatedStep1Sequence/sequence/capability）限 [0, 2^32-1] | MALFORMED_FRAME |
| R9 | encode 与 decode 执行**同一套**字段验证（encode 侧输入校验是独立红灯组：`codec-malformed.test.ts:387-486`） | 同上 |
| R10 | 解码产出的消息对象：optional 字段缺席时**省略键**（非置 undefined），保证 `toEqual(golden.message)` 与 exactOptionalPropertyTypes 双侧成立 | — |

字段级自由文本长度策略：`reasonCode`/`connectionId` 要求非空（「稳定安全码」「observability id」语义），除此之外不发明长度上限（受 maxFrameBytes 天然约束）；`safeMessage` 允许空串（规范无约束；红灯用例均为非空，空串不构成攻击面——wire 上限已定）。grammar 字段（ns/rid/instanceId/nonce）上限由格式固定。

### 7.1 17 种消息字段表（字段顺序 = wire 顺序 = 规范表格顺序，不可迁就库偶然编码）

| 消息 | 字段顺序（编码） | 消息级规则（违规→MALFORMED_FRAME 除注明） |
|---|---|---|
| HELLO 0x01 | peerInstanceId(varString) → expectedHubInstanceId(varString) → protocolVersions(list&lt;varUint&gt;) → requiredCapabilities(uint32BE) → optionalCapabilities(uint32BE) → connectionNonce(varUint8Array) | 版本表 ≥1 项、**严格降序**（蕴含无重复）、每项 ≥1 的安全整数；两个 capability ∈ u32；nonce 恰 16 字节（红灯：15/17 拒、count=00 拒、[1,2]/[1,1] 拒、巨大 nonce 声明短 body 拒） |
| HELLO_ACK 0x02 | hubInstanceId(varString) → protocolVersion(varUint) → selectedCapabilities(uint32BE) → connectionNonce(varUint8Array) → connectionId(varString) | hubInstanceId 过 R5；protocolVersion ≥1；caps u32；nonce 恰 16；connectionId 非空 |
| GOAWAY 0x03 | reasonCode(varString) → drainTimeoutMs(varUint) → retryAfterMs(optional varUint) | reasonCode 非空；drainTimeoutMs ≥0 安全整数（encode：-1 拒，红灯）；retryAfterMs 省略合法（marker 00） |
| ERROR 0x04 | §6.3 固定七段 | §6.3 注册表一致性 |
| OPEN_NAMESPACE 0x10 | namespaceId(varString) → hasLocalReplica(bool) → replicationId(optional varString) → replicationEpoch(optional varUint) | **identity 成对律**：hasLocalReplica=true ⇒ 两 marker 均为 1 且值过 R3/R4；false ⇒ 两 marker 均为 0（红灯四象限全锚定：缺一、只缺 epoch、false 却出现 id、false 却出现 epoch 均拒；rid 31 字符/大写/epoch 0 拒） |
| OPEN_OK 0x11 | namespaceId → mode(u8) → replicationId(varString) → replicationEpoch(varUint) | mode ∈{0,1}（红灯：2 拒）；R3/R4 |
| CLOSE_NAMESPACE 0x12 | namespaceId → reasonCode(varString) | reasonCode 非空 |
| CLOSE_OK 0x13 | namespaceId → ackedSequence(varUint32) | R8 |
| BOOTSTRAP_SNAPSHOT 0x20 | namespaceId → replicationId → replicationEpoch → snapshot(varUint8Array) | R3/R4；snapshot 受 `maxBootstrapBytes`（§10）→ 超限 `BOOTSTRAP_TOO_LARGE`；空 snapshot 合法（roundtrip 红灯） |
| BOOTSTRAP_ACK 0x21 | namespaceId → ackedSequence(varUint32) | R8 |
| IDENTITY_CHANGED 0x22 | namespaceId → replicationId → replicationEpoch | R3/R4（红灯：rid 非 32 hex 拒） |
| SYNC_STEP1 0x30 | namespaceId → syncRoundId(varUint32) → stateVector(varUint8Array) | 空 stateVector 合法（roundtrip 红灯）；仅受 maxFrameBytes 约束（无命名字段限额） |
| SYNC_STEP2 0x31 | namespaceId → syncRoundId(varUint32) → relatedStep1Sequence(varUint32) → update(varUint8Array) | update 受 `maxSyncDiffBytes` → `SYNC_DIFF_TOO_LARGE`；空 diff 合法（§9.2 允许空 diff，红灯） |
| SYNC_APPLIED 0x32 | namespaceId → syncRoundId(varUint32) → ackedSequence(varUint32) | R8 |
| RESYNC_REQUIRED 0x33 | namespaceId → reasonCode(varString) | reasonCode 非空 |
| UPDATE 0x40 | namespaceId → update(varUint8Array) | update 受 `maxUpdateBytes` → `UPDATE_TOO_LARGE` |
| UPDATE_ACK 0x41 | namespaceId → ackedSequence(varUint32) | R8；ackedSequence=0xffffffff 必须可承载（roundtrip 红灯） |

### 7.2 decodeMessage / encodeMessage 管线

```ts
function decodeMessage(bytes, options?): DecodedMessage {
  const { header, payload } = decodeFrame(bytes, options);        // §4.2 全部 9 步（含 expectedSequence、maxFrameBytes）
  const reader = new CanonicalReader(payload);
  const message = decodePayload(header.messageType, reader, options?.limits); // 按 §7.1 表逐字段
  reader.expectEnd();                                             // R1 完全消费（payload 级尾随 → MALFORMED_FRAME）
  return { header, message };
}

function encodeMessage(message, options?): Uint8Array {
  validateMessage(message);                                       // §7.1/R6 encode 侧同套验证 + ERROR 注册表推导（§6.3）
  const payload = encodePayload(message, options?.limits);        // PayloadWriter，字段级限额在写入对应 bytes 字段时检查
  return encodeFrame({ messageType: MESSAGE_TYPES[message.kind], sequence: options?.sequence ?? 1,
                       payload }, { maxFrameBytes: options?.maxFrameBytes });
}
```

canonical roundtrip 不变量（fuzz 红灯）：对任何被接受的输入 b，`encodeMessage(decodeMessage(b).message, {sequence: b.sequence})` 逐字节等于 b。成立链条：decoder 拒绝一切非 canonical 形态（非最短 varUint、错误 marker、尾随、非严格 UTF-8）⇒ 接受集 ⊆ canonical 集；encoder 是 canonical 集上的单射产生者（lib0 最短编码 + 固定字段序 + BOM 不剥离）⇒ 逐字节还原。`decodeFrame` 同理（头字段全常量化重写）。

---

## 8. 版本 / capability 协商（ADR-0010「不得按消息数值猜版本」）

两层版本显式分离（规范 §3 末段）：`envelopeVersion`（=1，只决定头布局，帧层检查步骤 3）与 HELLO `protocolVersions`（完整协议语义版本）。codec 提供两个纯函数 + 注册表元数据，不维护协商状态：

```ts
// 共同最高版本；空/无交集 → null（调用方映射 UNSUPPORTED_PROTOCOL_VERSION）
function selectProtocolVersion(peerVersions: number[], hubVersions: number[]): number | null {
  const hub = new Set(hubVersions);
  let best: number | null = null;
  for (const v of peerVersions) if (hub.has(v) && (best === null || v > best)) best = v;
  return best;   // 纯集合语义：与输入顺序/重复无关（红灯：[1,3,2]×[3,2,1]→3、[9,2,7,5]×[5,2]→5、[]×[1]→null）
}
// 注意：此函数不做降序校验——那是 HELLO wire 字段规则（§7.1），在 encode/decode 边界执行；函数本身是纯交集数学。

// required 全支持才 ok；optional 取交集（全 >>> 0 无符号处理，bit31 安全）
function selectCapabilities(required: number, optional: number, supported: number): { ok: boolean; selected: number } {
  const ok = ((required & ~supported) >>> 0) === 0;
  return { ok, selected: (optional & supported) >>> 0 };
}
// 红灯矩阵 7 例逐一对齐（含 required 0b101×supported 0b010 → ok:false/selected:0；
// required 0b001×optional 0b100×supported 0b011 → ok:true/selected:0）
```

`ok:false` 由调用方（ws-replication）映射 `UNSUPPORTED_CAPABILITY`；codec 不代为抛错（协商决策属状态层，红灯只锚定函数行为）。HELLO→选版本→HELLO_ACK 全流程红灯（`codec-version-interop.test.ts:53-87`）由「decode HELLO → 两函数 → encode HELLO_ACK → decode」的纯函数组合满足。

互通矩阵（锁定组合）：codec 对 Yjs 字节不透明搬运（`codec-version-interop.test.ts:89-171` 用真实 `Y.encodeStateAsUpdate`/`encodeStateVector` 过帧往返后字节不变、apply 收敛），锁定由 §11 的依赖组合保证。

---

## 9. ProtocolError 分类体系

```ts
export class ProtocolError extends Error {
  readonly code: string;                 // ∈ 连接或 namespace 错误注册表（append-only 稳定码）
  readonly scope: 'connection' | 'namespace';
  readonly fatal: boolean;
  readonly retryable: RetryPolicy;       // 注册表导出（类型收窄为字面量联合，test-d 的 string 兼容）
  readonly wsCloseCode?: number;         // connection 条目（ws-replication 映射 §14 close code 用）
  readonly terminalState?: TerminalState;// namespace 条目

  constructor(code: string, detail?: string, scope?: 'connection' | 'namespace') {
    // 元数据查表导出：优先 CONNECTION_ERRORS，次 NAMESPACE_ERRORS；
    // INTERNAL_ERROR 双表歧义由显式 scope 参数消解（缺省 connection）；两表皆无 → connection 域兜底，
    // 兜底路径 this.code 保留调用方原字符串（R1/SA2 #4 写死：message 已含原码；若替换为 'INTERNAL_ERROR'
    // 则原始 typo 只活在 message 里，弱化「错误码 ∈ 注册表」不变式的可测试性）。
    // 该分支只应被编程错误触达：codec 自身只会抛已注册码，运行期触达兜底即为 SA3 缺陷信号（loud，非降级）。
    super(`${code}${detail ? ': ' + detail : ''}`);   // message 只含稳定码 + 本地诊断 detail，绝不上 wire
    this.name = 'ProtocolError';
  }
}
```

- **唯一异常类型**：codec 一切失败路径（帧级、payload 级、encode 输入校验、limits）只抛 `ProtocolError`；fuzz 契约「绝不抛 RangeError/TypeError 等未分类异常」由 D-1（自研有界读）+ 全部 lib0 调用位于写路径（输入已验证）共同保证。`TextDecoder` 的 throw 被捕获并映射 `MALFORMED_FRAME`。
- codec 抛出的码的全集（8 个帧级 connection 码 + 3 个字段级 namespace 码）：`BAD_MAGIC`、`UNSUPPORTED_ENVELOPE_VERSION`、`UNSUPPORTED_FLAGS`、`MALFORMED_FRAME`、`FRAME_LENGTH_MISMATCH`、`UNSUPPORTED_MESSAGE_TYPE`、`FRAME_TOO_LARGE`、`SEQUENCE_VIOLATION`、`UPDATE_TOO_LARGE`（scope=namespace、fatal=true，红灯直接断言 `err.scope`/`err.fatal`）、`BOOTSTRAP_TOO_LARGE`、`SYNC_DIFF_TOO_LARGE`；外加配置类 `CONNECTION_POLICY_VIOLATION`（非法 options/limits 值，§10）。
- `message`/`stack` 是本地诊断，永不参与 wire ERROR 的 safeMessage（§13.2「Wire 永不携带 …原始 cause 或异常 message」——safeMessage 由调用方显式给定）。

---

## 10. 配置 limits 与校验（规范 §17）

```ts
export interface FieldLimits { maxUpdateBytes?: number; maxBootstrapBytes?: number; maxSyncDiffBytes?: number; }
```

- **缺省语义**：`maxFrameBytes` 缺省 `DEFAULT_MAX_FRAME_BYTES`（16 MiB，fixtures 注释锚定）；三个字段级限额缺省 = **不设限**（仍受 maxFrameBytes 帧级约束）。红灯用例只传单字段（`{ maxUpdateBytes: 4 }`）→ 必须是全可选的 Partial 形状。
- **检查时机（decode）**：对应 bytes 字段读完（有界拷贝后）立即比对——例：`UPDATE.update.byteLength > limits.maxUpdateBytes → ProtocolError('UPDATE_TOO_LARGE')`。有界拷贝已保证分配 ≤ 实际帧体（≤ maxFrameBytes），限额检查是策略拒绝而非防分配手段。
- **检查时机（encode）**：写入对应字段前检查（「编码侧不得产出超限帧」，红灯 `encodeMessage(..., {limits:{maxUpdateBytes:4}})` → `UPDATE_TOO_LARGE`）。
- **启动响亮验证（无运行时 clamp，规范 §17）**：导出 `validateCodecLimits({maxFrameBytes, maxUpdateBytes, maxBootstrapBytes, maxSyncDiffBytes})`：
  - 四值均须正有限安全整数；
  - `maxBootstrapBytes/maxSyncDiffBytes/maxUpdateBytes ≤ maxFrameBytes - PROTOCOL_OVERHEAD_BYTES(128)`（R1 修正，SA2 #2：64 低估了带 rid/多 varUint 字段消息的真实开销，存在「启动绿灯 + 运行时 FRAME_TOO_LARGE」的假绿灯配置；逐消息最坏开销推导见下表）；
  - 违规 throw `ProtocolError('CONNECTION_POLICY_VIOLATION')`——这是配置错误，属「响亮 assert」而非降级；绝不 clamp 后继续。
  - 该函数面向 ws-replication/Host 组装期；codec 内部对**显式传入**的 options/limits 值本身做同类校验（负数/非整数/非有限 → `CONNECTION_POLICY_VIOLATION`），未传的字段不参与跨字段校验（保持 Partial 语义）。

**（R1）逐消息最坏协议开销推导**（`PROTOCOL_OVERHEAD_BYTES` 的算术依据；「最坏」= 各 varUint 字段按其设计上限取最长 LEB128 编码）：

| 消息 | 头 | ns varString | 其余定长/变长字段最坏 | 合计最坏 |
|---|---:|---:|---|---:|
| BOOTSTRAP_SNAPSHOT（最贵） | 20 | 1+35=36 | rid varString 1+32=33；epoch varUint ≤8（MAX_SAFE_INTEGER 需 ceil(53/7)=8 字节）；snapshot 长度前缀 varUint ≤5（payloadLength 为 u32，需 ceil(32/7)=5 字节） | **102** |
| SYNC_STEP2 | 20 | 36 | syncRoundId ≤5 + relatedStep1Sequence ≤5 + update 长度前缀 ≤5 | 71 |
| UPDATE | 20 | 36 | update 长度前缀 ≤5 | 61 |

- 最小开销（BOOTSTRAP_SNAPSHOT，epoch=1/单字节、前缀=单字节）= 20+36+33+1+1 = **91**——即 R0 的 64 连最小形态都未覆盖（SA2 #2 属实）。
- 常量取 **128**（≥102 的安全取整 + 为 append-only 未来消息预留余量），不再钉死某个消息精确值；假绿灯反例修正：`{maxFrameBytes:1000, maxBootstrapBytes:936}` 现因 936 > 1000−128=872 被 `validateCodecLimits` 响亮拒绝，运行时 `FRAME_TOO_LARGE` 不会成为该配置的第一个失败点。
- 该常量未被任何红灯测试钉死（SA2 grep 核实 + SA1 复核），修正零测试影响。

---

## 11. 依赖锁定与纯包边界（AC5）

### 11.1 manifest（SA3 新建 `packages/replication-protocol/package.json`）

```json
{
  "name": "@nomicore/replication-protocol",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -p tsconfig.json" },
  "dependencies": {
    "lib0": "^0.2.117",
    "y-protocols": "^1.0.7",
    "yjs": "^13.6.30"
  },
  "devDependencies": { "typescript": "^5.9.3", "vitest": "^3.2.4" }
}
```

- AC5 红灯断言逐条满足：`exports["."] === "./src/index.ts"`、`type === "module"`、deps 直接含 yjs/y-protocols/lib0、deps 无 cordis/ws/registry/server/buffer（正则 `/cordis|(^|\/)ws$|^ws$|@nomicore\/namespace-registry|…|^buffer$|node:buffer/i` 零命中）。
- **版本组合锁定依据（F8）**：`yjs ^13.6.30` 与既有 5 个包同 range → lockfile 单解 13.6.32；`lib0 ^0.2.117` ≥ y-protocols 的 `^0.2.85` → 单解 0.2.117（golden 按 0.2.117 行为核对，升级必须重跑互通矩阵——规范 §4 末段）；`y-protocols ^1.0.7`（peer `yjs ^13.0.0` 兼容）。
- **yjs/y-protocols 声明而 src 不 import 的理由**：AC5 是 manifest 级锁定验收（「directly pins compatible … versions」）；codec 对 Yjs 字节不透明（§1.3），src 运行时唯一外部依赖是 `lib0/encoding`。声明锁定保证后续 `@nomicore/ws-replication` 与本包解析到同一兼容组合，同时让 `codec-version-interop.test.ts` 的真实 yjs 互通测试在锁定版本上运行。这不是死代码依赖，是组合锁（SA2 若攻击此点，答复即此）。

### 11.2 纯包边界（运行时）

- **无 Cordis / WebSocket / Registry / Node server / Node Buffer**：src 只 import `lib0/encoding`；使用的全局仅 `Uint8Array`、`TextEncoder`（lib0 内部）、`TextDecoder`（自建 fatal 实例）、`Number`/`Math`——全部跨平台（Node ≥20 / 浏览器 / worker 皆有）。
- **Buffer-free 行为锚点**（红灯 `codec-package-contract.test.ts:51-88`）：`globalThis.Buffer` 遮蔽为 undefined 时全链路照常。成立依据：src 与 lib0 encode 路径（`createEncoder`/`writeVarUint`/`writeVarString`→`encodeInto`/`toUint8Array`）均不触碰 `Buffer`；解码路径完全自研（D-1）不经过 lib0 decoding/isomorphic 探测。**输出原型承诺的准确边界（R1/D-5）**：本包**自产**的输出——encodeFrame/encodeMessage 结果（`toUint8Array`/`new Uint8Array`）、decodeMessage 的全部字段 bytes（`readVarUint8ArrayCopy` 精确拷贝）——原型恒为 `Uint8Array.prototype`（红灯逐 golden 断言即覆盖此集合）；唯一例外是 `decodeFrame` 的 `payload` subarray 视图，其原型跟随输入 buffer（Buffer 进 → `Buffer.prototype`），调用方不得以原型做嗅探（§4.2 D-5）。本包不**产生**也不**依赖** Buffer，只对喂入的 Buffer 子类实例按 Uint8Array 语义只读使用。
- **无状态**：模块级仅常量与冻结注册表（可变状态为零）→ 可被任意并发连接共享。

### 11.3 模块解析（F9）

测试 `import '@nomicore/replication-protocol'` 经 package.json `exports` **自引用**解析（根 node_modules 无 @nomicore 链接，与 vfsl-protocol 同机制）；测试内 `import 'yjs'` 在 SA3 建包声明依赖并 `pnpm install` 后经包内 node_modules 解析（SA6 红灯记录已预告此消解路径）。

---

## 12. 红灯测试覆盖映射（§22 conformance → 测试 → 设计章节）

| 规范 §22 要求 | 红灯测试文件 | 设计章节 |
|---|---|---|
| byte-level golden vectors（envelope+全部 payload） | fixtures.ts 18 golden + codec-messages-golden.test.ts | §4/§5/§6/§7（实现必须逐字节复现 golden，**不得改字段顺序适配库**） |
| encode/decode canonical roundtrip | codec-roundtrip-truncation.test.ts:28-70 | §5.2/§7.2 canonical 不变量 |
| 每个 byte offset 截断 | codec-roundtrip-truncation.test.ts:72-98 | §4.2 步骤 1/2 + §5.2 有界读 |
| 长度少一/多一/溢出/巨大声明短 body | codec-envelope.test.ts:123-144 | §4.2 步骤 8（分配前拒绝） |
| 非零 flags/reserved、未知版本/type、非法 sequence | codec-envelope.test.ts:88-121,155-161 | §4.2 步骤 3-6/9 |
| trailing bytes（帧级/载荷级） | codec-roundtrip-truncation.test.ts:101-116 | §4.2 步骤 8 / R1 |
| 非法 UTF-8、非法 namespaceId、非 canonical varUint、错误 optional/list count、巨大声明短 body | codec-malformed.test.ts | §5.2/§7.0 |
| HELLO/OPEN 字段规则、ERROR 注册表 bits 一致性 | codec-malformed.test.ts:183-331 | §7.1/§6.3 |
| 字段级 limit（UPDATE/BOOTSTRAP/SYNC_DIFF_TOO_LARGE）+ encode 侧输入校验 | codec-malformed.test.ts:333-486 | §10/§7.0 R9 |
| 注册表恰 17/17/20、冻结、lookupError | codec-registries.test.ts | §6 |
| 版本协商全矩阵、capability、HELLO→ACK、锁定组合互通 | codec-version-interop.test.ts | §8/§11 |
| fuzz/property（不越界分配、不抛未分类异常、canonical 还原、单字节变异） | codec-fuzz-property.test.ts | §5.2（D-1）/§7.2。**⚠ R1 登记：该文件的 property roundtrip 块存在与 malformed nonce 规则互斥的生成器缺陷（§15.2，SA1/SA2 双重确定性复现）——SA6 修正前该文件必红于此点，与实现质量无关；修正后本设计条款即全量满足** |
| manifest 锁定 + Buffer-free | codec-package-contract.test.ts | §11 |
| 类型层 API 契约 | codec-api.test-d.ts | §3（R0 §15.1 所报断言缺陷**已由 SA6 2026-08-27 修订**：:87 为类型实参形式，SA2 复核通过） |

---

## 13. 边界条件与防弹要点汇总

1. **越界分配零可能**：帧级长度先验（步骤 8）钉死 payload 实际长度；`readVarUint8ArrayCopy` 在分配前做 `pos+len ≤ end` 检查；`readVarUint` 限 8 字节。随机 fuzz（800×2 + 全 golden×全 offset 变异）下最坏分配 = 帧体本身。
2. **异常全分类**：唯一异常类型 ProtocolError；lib0 只在写路径出现且输入预验证；TextDecoder throw 被捕获映射。未分类异常（RangeError/NaN 静默）在 D-1 下无入口（F5/F6 的三个坑即其来源，已在 §5.1 逐条封堵）。
3. **分类确定性**：检查顺序固定（§4.2/§5.2/§7），同一输入永远同一错误码——红灯对「截断 0-3 → BAD_MAGIC、其余 → FRAME_LENGTH_MISMATCH」等逐 offset 断言即依赖此性。
4. **无静默降级**：任何无法解析/校验失败的输入一律 loud 抛 ProtocolError；不存在「尽力解析、跳过坏字段」。正常路径中「应当总是为真」的格式不变量（如 OPEN identity 成对律、ERROR 注册表 bits）全部是硬断言。
5. **不可变元数据**：注册表深冻结，ERROR 元数据类型层面不可注入。
6. **canonical roundtrip 双向**：接受集=规范形式集（严格拒绝非 canonical），产生集=同一集（lib0 最短编码 + BOM 不剥离 + 字段序固定）。
7. **u32 语义字段的 0xffffffff 边界**可承载（roundtrip 红灯）；回绕防护归状态层（§1.3）。
8. **空体字段**（空 update/stateVector/snapshot/空 marker optional）合法且 roundtrip。
9. **输入不可变性**：decoder 绝不写输入 buffer（subarray 视图只读使用）；encode 输出全新分配。

---

## 14. 实现步骤建议（SA3）与工程接线

1. 建 `packages/replication-protocol/{package.json,tsconfig.json}`（§11.1 / §2）→ `pnpm install`（更新 lockfile：新增 y-protocols@1.0.7，复用既有 yjs/lib0 单解）。
2. 按 §2 顺序实现 src（constants → errors → messages → canonical → envelope → payloads → limits → negotiation → index）。
3. 根 `package.json` `typecheck` 脚本链末尾追加 `&& tsc -p packages/replication-protocol/tsconfig.json`（唯一根级改动；vitest.config.ts / tsconfig.typecheck.json 已自动覆盖，不改）。
4. 验证命令与**预期结果（R1 修正，SA2 #1）**：`pnpm exec vitest run packages/replication-protocol` —— 在 §15.2 所登记的 SA6 生成器修正落地**之前**，预期为 **8 文件绿 + `codec-fuzz-property.test.ts` 红于已登记阻塞点**（property roundtrip 块首个 HELLO/HELLO_ACK 违规 nonce，i=4）；该红与实现质量无关，SA3 不得为使其变绿而放宽 nonce 规则（那会使 malformed 测试红 + 违反规范 §6.1）。SA6 修正落地后预期 9 文件全绿。随后跑根 `pnpm test` 与根 `pnpm typecheck`。
5. golden 对齐策略：先跑 codec-messages-golden，任何不一致都修实现侧字段序/编码选择，**禁止改 fixtures**。
6. 版本号从 `0.1.0` 起（仓库惯例）。

预估规模：src ≈ 1100–1400 行（payloads.ts 约 500，errors+messages 注册表数据约 350，canonical 约 150，envelope 约 120，其余小件）。

---

## 15. 红灯测试可实现性阻塞登记（SA6 owned 文件，SA1 不改测试；均须总控授权 SA6 执行）

### 15.1 【已解决】codec-api.test-d.ts 的 type-only 值用位断言（R0 报告，SA2 #5 复核）

R0 报告：`codec-api.test-d.ts:14` 以 **type-only** 方式导入 `type ProtocolError`，原第 85 行把它用在**值位置**：

```ts
expectTypeOf(ProtocolError).toMatchTypeOf<Error & { code: string; fatal: boolean; scope: string }>();
```

**任何包实现都无法使该行编译通过**——TS 对 type-only import 的硬性报错（TS1361），与导出形状无关；且即改为值导入，T 也会被推成构造器类型（`typeof ProtocolError`），与实例类型 `Error & {...}` 不匹配。R0 设计期实测复现（2026-08-27，本 worktree 的 vitest@3.2.7 + tsc，最小复现工程）：

```
FAIL  pkg/test/x.test-d.ts > shape > class-as-type matches Error&{code,fatal,scope}
TypeCheckError: 'ProtocolError' cannot be used as a value because it was imported using 'import type'.
```

唯一可行修正是断言改用类型实参形式（import 保持 type-only）。**状态：SA6 已于 2026-08-27 修订完毕**——现 `codec-api.test-d.ts:87` 为 `expectTypeOf<ProtocolError>().toMatchTypeOf<...>()`（SA2 R1 评审现场复核通过，本条闭案；行号引用已按 SA2 #5 更正为 :87）。

### 15.2 【已解决（SA6 R2 2026-08-27，SA2 R1 重审复核通过）】codec-fuzz-property.test.ts 生成器与 malformed nonce 规则互斥（SA2 #1，CRITICAL）

**状态：已解决（SA6 R2 2026-08-27，SA2 R1 重审复核通过）**——SA6 已按本节建议落地修正：`randomMessage()` case 0/1 改用 `fixedNonce()` 恰 16 字节并留防回归注释（`codec-fuzz-property.test.ts:98-99,162-163`），SA1 闭案时现场核实；本条闭案，§14.4 预期恢复「9 文件全绿」，以下原文保留作阻塞登记存档。

**矛盾**：`codec-fuzz-property.test.ts` 的 property roundtrip 块（:140-157）对 `randomMessage(rand)`（:95-138）产物**无 try/catch** 地调用 `encodeMessage`；其中 case 0（HELLO）与 case 1（HELLO_ACK）用 `randomBytes()` 填 `connectionNonce`，而 `randomBytes` 的长度是 `Math.floor(rand() * 64)` ∈ [0,63] 的随机值。但规范 §6.1 要求 nonce「固定 16 bytes」，且 `codec-malformed.test.ts:214-225`（decode 侧 15/17 必拒）与 `:388-427`（encode 侧 15/17 必拒）把「恰 16」钉成红灯契约。于是：

- 实现若按规范/malformed 拒绝 ≠16 nonce → property 测试在第 4 轮抛未捕获的 `MALFORMED_FRAME` 而红；
- 实现若接受 ≠16 nonce 以取绿 property → malformed 测试红 + 违反规范 §6.1。

**任何实现都无法使该文件与 malformed 同时全绿**——与 §15.1 同类的「红灯基线可实现性」缺陷，R0 漏检（R0 只做了 test-d 的可实现性核验，未覆盖 property 生成器），SA2 R1 攻击成立。

**SA1 独立确定性复现**（与 SA2 模拟逐数字吻合；mulberry32 seed 0x99aa，完整复刻测试的 rand 消耗序——每轮 pick 1 次 + `randomBytes` 的 1+len 次 + case 2/4/9/18 各 1 次）：

```
$ node /tmp/fuzzsim.mjs      # 2026-08-27，SA1 R1 修订期执行
nonce 抽取总数=32  其中≠16字节=32  首个违规轮次 i=4
全部 nonce 抽取记录: [{"i":4,"kind":"HELLO","len":36},{"i":11,"kind":"HELLO","len":15},
  {"i":17,"kind":"HELLO","len":21},{"i":35,"kind":"HELLO_ACK","len":45}, …（共 32 条，无一为 16）
  {"i":142,"kind":"HELLO","len":17}, … {"i":298,"kind":"HELLO_ACK","len":19}]
```

300 轮中 HELLO/HELLO_ACK 共出现 32 次，**32 次 nonce 长度全部 ≠16**（i=4 首爆 36 字节；i=11 恰 15、i=142 恰 17——正是 malformed 锚定必拒的长度）。1/64 命中率下 32 抽全空合理且确定（固定种子）。

**SA6 修正建议**（最小改动，生成器语义不变）：

1. `randomMessage()` case 0/case 1 的 `connectionNonce` 改用**固定 16 字节**：如 `Uint8Array.from({ length: 16 }, (_, i) => i)` 或全零 `new Uint8Array(16)`；
2. `randomBytes()` 仅保留给无长度规则的字段（case 10 snapshot / case 13 stateVector / case 14 update / case 17 update），维持随机载荷的 roundtrip 覆盖价值；
3. （防回归，采纳 SA2 红灯测试思路 #1）生成器内联 `connectionNonce.byteLength === 16` 断言，或加一条对 mulberry32(0x99aa) 全 300 轮的生成器元测试；malformed 的 15/17/36 拒绝用例两侧对照保留，锁死「恰 16」契约不再被任一侧软化。

**处置流程**：与 §15.1 相同——SA6 owned 文件，须总控授权 SA6 执行；SA3 **不得代改**，也不得为绕过该红而放宽 nonce 校验。修正落地前，SA3 的验收预期为「8 文件绿 + 本文件红于已登记阻塞点」（§14.4 已改写）。**在此正式向总控报告该阻塞点。**

---

## §16. 协议假设依据 (Protocol Assumption Evidence)

| 假设 | 依据类型 | 依据内容（具体引用） | 风险等级 |
|---|---|---|---|
| lib0 `readVarString` 原生路径为 fatal TextDecoder，但存在非 fatal polyfill 回退 | 源码引用 | `node_modules/.pnpm/lib0@0.2.117/node_modules/lib0/string.js:98`（`new TextDecoder('utf-8',{fatal:true,ignoreBOM:true})`）+ `:101-110`（Safari 探测失败置 null 走 `_readVarStringPolyfill`） | 高（若依赖之，非法 UTF-8 用例取决于运行时）→ 已用自建 fatal decoder 规避（D-2） |
| lib0 `readVarUint8Array` 无边界检查、声明超界抛 RangeError；`readVarUint` 不查最短形 | 源码引用 | `lib0/decoding.js:122`（组合式定义）、`:95-107`（`new Uint8Array(buffer,pos,len)` 直接构造）、`:245-265`（无 minimality 检查） | 高（fuzz 未分类异常 + canonical 红灯）→ 已自研 CanonicalReader 规避（D-1） |
| lib0 `readUint32BigEndian` 越界读返回 0（NaN→0） | 源码引用 | `lib0/decoding.js:188-197`（`undefined` 算术后 `>>>0`） | 中（截断 capability 静默 0）→ `readUint32BE` 先检查 remaining≥4 |
| lib0 encoding 产出 canonical 且与 golden 一致 | 源码引用 + 现有测试引用 | `lib0/encoding.js:260-267`（最短 LEB128）、`:232`（writeUint32BigEndian）、`:344`（writeVarString）；fixtures.ts:9-15 注释「golden 已与 lockfile lib0@0.2.117 行为逐项核对」 | 低（写路径直接采用） |
| y-protocols@1.0.7 与 yjs@13.6.32/lib0@0.2.117 兼容 | 官方 registry 实测 | 本会话 `npm view y-protocols@1.0.7` → `dependencies: {lib0: ^0.2.85}`、`peerDependencies: {yjs: ^13.0.0}`；lockfile `pnpm-lock.yaml:663,834` | 低 |
| 包名自引用经 package.json exports 解析（无需根链接） | 类比已有 job 验证 + 设计期实测 | `pnpm exec vitest run packages/vfsl-protocol` → `Test Files 3 passed / Tests 20 passed`（2026-08-27，本 worktree）；根 `node_modules` 无 `@nomicore/`（`ls` 实证），vfsl-protocol 包内亦无 self-link | 低 |
| test-d type-only 值用位不可编译 | 设计期实测验证 | §15.1 引用的最小复现输出（vitest 3.2.7 TypeCheckError 原文） | 高（不改则该文件永红）→ **已解决**：SA6 2026-08-27 修订，现 :87 类型实参形式（SA2 复核） |
| fuzz-property 生成器 nonce 与「恰 16」规则互斥（R1 新增） | 设计期实测验证 | SA1 独立复现脚本（mulberry32(0x99aa) 全消耗序复刻）：32 次 nonce 抽取全 ≠16、首爆 i=4/36B、i=11/15B、i=142/17B，输出内嵌 §15.2；与 SA2 模拟逐数字吻合 | 高（不改则 property 与 malformed 互斥，红灯套件不可全绿）→ §15.2 OPEN 阻塞登记，待总控授权 SA6 修正 |
| 根 typecheck 链需追加新包、vitest include 无需改 | 源码引用 | 根 `package.json` scripts.typecheck（逐包列举）；`vitest.config.ts` include `packages/*/test/**/*.test.ts` + typecheck.include `packages/*/test/**/*.test-d.ts`；`tsconfig.typecheck.json` include `packages/*/src|test/**` | 低 |
| 本设计无 HTTP/WS 端点、端口、进程时序类假设 | — | 纯 codec 库，不触网络/进程/CI 资源 | — |

## §17. 契约改动连锁审计 (Contract Change Caller Audit)

**无契约改动**：本设计只新建 `packages/replication-protocol`（greenfield，当前零 caller、零既有导出被修改）。不改变任何既有函数的返回/抛出契约、不修改既有包的公共类型。

唯一的跨文件改动是根 `package.json` 的 `typecheck` 脚本链追加一段 `tsc -p packages/replication-protocol/tsconfig.json`（构建脚本串联，非函数契约，无 caller 语义影响）；`pnpm-lock.yaml` 因新增依赖由 `pnpm install` 自然更新。

（后续 ws-replication 将成为本包首个 caller，其调用面即 §3 公共 API；届时属新任务，另行审计。）

## SA2 反馈逐条回应（R1）

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| #1 CRITICAL：fuzz-property 的 `randomMessage()` 对 HELLO/HELLO_ACK 用随机长度 nonce 与 malformed「恰 16 字节」互斥，红灯套件不可全绿；须按 §15 同类流程登记阻塞报告（含确定性复现）+ SA6 修正建议 + 修正 §12/§14.4 的「全绿」错误声明 | ✅ | §15.2（新增）、§0 F12、§12 fuzz 行、§14.4 | SA1 独立复现 SA2 结论（32/32 nonce ≠16、首爆 i=4/36B、i=11/15B、i=142/17B，脚本+输出内嵌 §15.2）；登记 OPEN 阻塞 + SA6 修正建议（固定 16 字节 nonce、randomBytes 留给无长度规则字段、生成器元断言防回归）；§12/§14.4 声明改写为「8 绿 + 该文件红于已登记阻塞点，SA6 修正后全绿」 |
| #2 MEDIUM：`PROTOCOL_OVERHEAD_BYTES=64` 算术失真（BOOTSTRAP 真实最小 91/最坏 101+），存在「启动绿灯 + 运行时 FRAME_TOO_LARGE」假绿灯；提为 ≥96 或保守 128，注明逐消息最坏开销推导，同步修正 §3 常量注释 | ✅ | §3 常量行、§2 模块注释、§10 | 常量 64→**128**（覆盖 SA1 重算的最坏 102：epoch varUint 上限按 MAX_SAFE_INTEGER 取 8 字节而非 SA2 的 7，故 102 > 101）；§10 新增逐消息最坏开销推导表（BOOTSTRAP 102 / SYNC_STEP2 71 / UPDATE 61，最小 91）；假绿灯反例 `{1000,936}` 修正后正确被拒；确认常量未被红灯钉死 |
| #3 LOW：decodeFrame 输入为 Buffer 时 payload 视图原型为 `Buffer.prototype`，与「输出原型恒 Uint8Array.prototype」措辞冲突；文档化或规范化 | ✅ | §4.2 新增决策 D-5、§11.2 | 选**文档化**（保持零拷贝，SA2 推荐项 a）：JSDoc 明示 payload 视图原型跟随输入、调用方不得以原型嗅探；§11.2 输出原型承诺改为准确边界——自产输出（encode 结果 + decodeMessage 字段 bytes）恒 `Uint8Array.prototype`，唯一例外即 decodeFrame 视图 |
| #4 LOW：ProtocolError 未注册码兜底的 `this.code` 保留语义未写死 | ✅ | §9 构造器注释 | 写死：兜底路径 `this.code` **保留调用方原字符串**（message 已含原码，保住「错误码 ∈ 注册表」不变式的可测试性）；注明该分支只应被编程错误触达、运行期触达即为 SA3 缺陷信号（loud，非降级） |
| #5 INFO：§15 行号漂移（test-d :85 → :87，SA6 已修订） | ✅ | §15.1、§0 F10、§16、§12 类型层行 | 行号更正为 :87 并标注「已由 SA6 2026-08-27 修订、SA2 R1 评审复核通过」，§15.1 闭案 |

## §18. 文件清单（File Scope）

### ALLOW LIST

- `packages/replication-protocol/package.json` — 新建（SA3）：包 manifest，§11.1，≈20 行
- `packages/replication-protocol/tsconfig.json` — 新建（SA3）：extends base + include src/test，4 行
- `packages/replication-protocol/src/constants.ts` — 新建（SA3）：§2/§7.0 常量与正则，≈40 行
- `packages/replication-protocol/src/errors.ts` — 新建（SA3）：ProtocolError + 37 条错误注册表 + lookupError，≈220 行
- `packages/replication-protocol/src/messages.ts` — 新建（SA3）：17 条消息注册表 + 类型联合，≈180 行
- `packages/replication-protocol/src/canonical.ts` — 新建（SA3）：CanonicalReader/PayloadWriter，≈160 行
- `packages/replication-protocol/src/envelope.ts` — 新建（SA3）：encodeFrame/decodeFrame，≈120 行
- `packages/replication-protocol/src/payloads.ts` — 新建（SA3）：17 种 payload 编解码+验证，≈500 行
- `packages/replication-protocol/src/limits.ts` — 新建（SA3）：FieldLimits/validateCodecLimits，≈50 行
- `packages/replication-protocol/src/negotiation.ts` — 新建（SA3）：selectProtocolVersion/selectCapabilities，≈40 行
- `packages/replication-protocol/src/index.ts` — 新建（SA3）：公共 API re-export，≈40 行
- `pnpm-lock.yaml` — 修改（SA3 `pnpm install` 产物）：新增 y-protocols 解析与新包 importer 条目
- `package.json`（根）— 修改（SA3）：typecheck 链追加 1 段（§14.3），1 行
- `packages/replication-protocol/test/fixtures.ts` — `[SA6 owned]` 已有红灯 fixture；SA3 不得改断言/golden（SA6 仅在 golden 与规范冲突时可依流程修订）
- `packages/replication-protocol/test/codec-envelope.test.ts` — `[SA6 owned]` 已有红灯测试；SA3 可修测试基础设施但**不得改断言逻辑**
- `packages/replication-protocol/test/codec-messages-golden.test.ts` — `[SA6 owned]` 同上
- `packages/replication-protocol/test/codec-roundtrip-truncation.test.ts` — `[SA6 owned]` 同上
- `packages/replication-protocol/test/codec-malformed.test.ts` — `[SA6 owned]` 同上
- `packages/replication-protocol/test/codec-registries.test.ts` — `[SA6 owned]` 同上
- `packages/replication-protocol/test/codec-version-interop.test.ts` — `[SA6 owned]` 同上
- `packages/replication-protocol/test/codec-fuzz-property.test.ts` — `[SA6 owned]` 已有红灯测试；SA3 可修测试基础设施但**不得改断言逻辑**。**R1 登记 §15.2 OPEN 阻塞**：`randomMessage()` case 0/1 的 `connectionNonce` 须改为固定 16 字节、`randomBytes()` 仅留无长度规则字段（snapshot/stateVector/update），并建议生成器元断言防回归——须总控授权 SA6 执行，SA3 不得代改、不得为绕红放宽 nonce 校验
- `packages/replication-protocol/test/codec-package-contract.test.ts` — `[SA6 owned]` 同上（不含阻塞项）
- `packages/replication-protocol/test/codec-api.test-d.ts` — `[SA6 owned]` 已有类型层红灯测试；R0 §15.1 所报断言缺陷（type-only 值用位，TS1361）**已由 SA6 于 2026-08-27 修订闭案**（现 :87 为 `expectTypeOf<ProtocolError>()` 类型实参形式，SA2 R1 评审现场复核通过）。SA3 不得改断言逻辑
- `wiki/raw/task_replication-protocol-v1-codec_design.md` — 本文档（SA1 产出与后续 R 修订）

### DENY LIST

- `packages/ws-replication/**` — 后续切片（连接/namespace/sync 状态机），本票不动
- `apps/**`、`domains/**` — 应用与领域层，纯 codec 无涉
- `packages/namespace-registry/**`、`packages/namespace-runtime/**`、`packages/persistence/**`、`packages/dsh-persistence/**`、`packages/doc-runtime/**`、`packages/clock/**`、`packages/vfsl/**`、`packages/vfsl-protocol/**`、`packages/vfsl-codegen/**` — 既有稳定包，本票零改动
- `vitest.config.ts` — include 模式已覆盖新包（F11），不改
- `tsconfig.base.json`、`tsconfig.typecheck.json` — include 已覆盖 `packages/*/src|test`，不改
- `docs/protocols/instance-replication-v1.md`、`docs/adr/**`、`docs/phases/**` — 规范/决议文本，实现票不得反向修改
- `pnpm-workspace.yaml` — `packages/*` 已涵盖，不改
- `CONTEXT.md` — 词汇表为全仓基准，本票不改
