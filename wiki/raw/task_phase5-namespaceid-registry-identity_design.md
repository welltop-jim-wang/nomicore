# 设计文档 — Phase 5 切片 1：generate namespaceId and migrate Registry identity

- **Issue**: #131（welltop-jim-wang/nomicore）
- **任务类型**: 功能开发（feature）
- **Worktree**: /home/wangjian/nomicore-fix-issue-131
- **设计（SA1）**: R2 修订（逐条落实 SA2 R1 攻击 #1–#4；架构内核 §4 经攻击验证成立、零回退；修订面 = §2 增 D-13、§5.1/§6/§7/§11/§12/§13 更新 + 新增 §14 逐条回应表）
- **输入**:
  - 任务简报 `wiki/raw/task_phase5-namespaceid-registry-identity.md`
  - 相关决议 `wiki/raw/task_phase5-namespaceid-registry-identity_relevant_decisions.md`（ADR 0006/0008/0009/0010 摘录 + CONTEXT.md 词汇 + phase-5 切片 1 文本——本文约束基准）
  - SA6 红灯锚定 `wiki/raw/task_phase5-namespaceid-registry-identity_sa6_red.md`
    + `packages/namespace-registry/test/registry-phase5-identity-red.test.ts`（15 条运行时用例）
    + `packages/namespace-registry/test/registry-phase5-identity-surface.test-d.ts`（5 条类型面契约）

---

## §1. 任务类型与需求推演

ADR 0010「Namespace identity、owner 与复制范围」节已裁决（accepted）：Registry entry key 由
`(owner.userId, namespaceId)` 改为仅 `namespaceId`；普通 create 不再接受调用方 namespaceId，由注入的
受控 128-bit CSPRNG 生成 `ns-` + 32 位小写 hex；碰撞（Registry entry 或目标 owner Persistence
duplicate）最多重试 8 次，耗尽以 `committed:false` Registry fatal 失败。本任务是该节 + phase-5 文档
§实施切片 1 身份部分（不含 `META.replicationId`/`enableReplication()`——总控拆片明确排除）的实现票。

**需求推演（Feature 切入点）**：现有实现（基线 `980b16a`）的 identity 模型有三处与 ADR 0010 冲突：

| # | 基线事实 | 代码位置 | ADR 0010 要求 |
|---|---|---|---|
| B-1 | create 输入恒四键（owner/namespaceId/schema/root），调用方自选 ID | `src/types.ts` `CreateNamespaceInput`；`src/registry.ts` `snapshotCreatePayload`（恰四键校验） | 恒三键（owner/schema/root）；ID 由注入 CSPRNG 生成 |
| B-2 | Registry entry/carrier key = 长度前缀复合键 `${userId.length}:${userId}\0${nsId.length}:${nsId}` | `src/identity.ts` `validateOpenIdentity` | key 仅 namespaceId；owner 是 open/create 必需本地属性 + 复用前核对；mismatch → `NAMESPACE_NOT_FOUND` 零泄露 |
| B-3 | 无随机源概念：duplicate 四源统一映射 `NAMESPACE_ALREADY_EXISTS` | `src/registry.ts` `runCreateSlot` | 碰撞重生成重试（至多 8 次）；耗尽 committed:false fatal（新 phase）；受控随机源 capability 注入 + 缺失响亮失败 |

推演结论：这是一次 **Registry 身份内核迁移**，变更半径全部落在 `packages/namespace-registry`（src
6 个模块 + 既有测试迁移），Persistence 零改动（AC-5），无跨包生产消费者（`apps/` 为空、
`domains/` 无引用、`namespace-runtime`/`doc-runtime` 仅注释级提及）。

---

## §2. 设计决策总表

| # | 决策 | 章节 |
|---|---|---|
| D-1 | 受控随机源 capability `randomBytes(length): Uint8Array`：`RegistryRandomBytes` 类型，**必需**进入 `CreateNamespaceRegistryOptions` / `NamespaceRegistryTestingOverrides` / `NamespaceRegistryInternalOptions`；构造期同步 TypeError 门禁（clock → scheduler → idleTimeoutMs → randomBytes 顺序）；主入口运行时 export 面与 testing 值面**零新增**（9/2 冻结保持） | §4.1 |
| D-2 | 生产随机源 = plugin.ts 桥接 Node `node:crypto`（Buffer → 独立 `Uint8Array` 拷贝）；核心（registry.ts 等）零全局 crypto 直调；不新建 Cordis service / 不新建包 | §4.1.3 |
| D-3 | 生成 ID = `randomBytes(16)` → `ns-` + 32 位小写 hex；返回值形状违约（非 Uint8Array / 非 16 字节）→ 立即 fatal（**不消耗重试预算**——能力契约缺陷不是瞬态碰撞，拒绝虚假降级） | §4.2 |
| D-4 | create 新主链：同步 owner 接纳（namespaceId 键出现 → `NAMESPACE_CREATE_INVALID_INPUT`，零随机消耗）→ 生成编排循环（**总生成次数 ≤ 9 = 首生成 + 至多 8 次重试**）→ 每候选 admit 到该候选 key 的 carrier FIFO → attempt slot：entry 碰撞检查（active/idle/closing 一律碰撞，**绝不等待 closePromise**）→（首个过门尝试一次性）payload 快照 + Clock 单读 + compile/validate →（每候选）build（META.docId=候选）→ createDoc（`DOC_DUPLICATE` → retry）→ factory → entry 登记 → lease | §4.3 |
| D-5 | 耗尽 → reject `NamespaceRegistryFatalError('create', 'namespace-id-generation', false, cause)`；`committed:false` 恒成立（耗尽路径零 createDoc 成功）；`namespace-id-generation` 为 ADR 0009 开放 phase 清单的新注册成员 | §4.3.5 |
| D-6 | entry/carrier key = `namespaceId` 本身（去长度前缀复合键）；open 在 entry 命中后、phase 分派前核对 owner，mismatch → `NAMESPACE_NOT_FOUND`（零 loadDoc、零新 Runtime）；closing recheck 复用同一 owner 谓词 | §4.4 |
| D-7 | `NAMESPACE_ALREADY_EXISTS` 码与 message **保留**于公共 issue 联合与稳定 message 注册表，普通 create 运行时不再产出（保留给切片 2 受信任导入路径）；`CreateNamespaceIssue` 类型面不变 | §4.7 |
| D-8 | create-document 模块拆分 `prepareCreateDocument`（compile+validate，一次/create）与 `buildInitialDocument`（构造步，一次/候选）；testing seam `createDocumentFactory` 签名不变、按候选调用 | §4.5 |
| D-9 | shutdown 新增等待「已接纳 create 编排终局」集（`admittedCreates`）——重试跨 carrier 再接纳不逃逸 shutdown 的结算屏障 | §4.6 |
| D-10 | Persistence 零改动；旧格式 namespaceId（如 `k-ns`）继续可 open（round-trip 兼容锚保持） | §4.8 |
| D-11 | AC-7 文档对齐 = ADR 0009 追加 issue #131 修订节 + ADR 0006 追加对齐说明；CONTEXT.md 已对齐（零改动）；ADR 0010 与 phase 文档不动 | §8 |
| D-12 | observer 新增**加法**事件 `create-id-generation-failed`（随机源 throw / 形状违约 / 耗尽时各恰一次）——沿用「内部故障必经 observer seam」纪律，不伪造 InternalIdentity | §4.3.5 |
| D-13（R2） | 三个零红灯锚的设计机制（D-9 shutdown×在途重试、D-3 随机源运行期违约、C-1 推论 1 同候选并发）**全部向 SA6 提回补锚请求**（3 条用例规格见 §12.3——均为可观察运行时行为、现有 scripted 源/fake scheduler 基建可低成本表达），并同表登记为 SA4 Phase-3 验证项（核对锚存在且与设计一致）——不留「设计声称、测试不见证」空档 | §12.3 |

---

## §3. 现状关键事实（设计依据的代码锚点）

以下事实已在设计期逐行核实（`packages/namespace-registry/src/`，基线 `980b16a`）：

1. `registry.ts` 的 entries/carriers 为 `Map<string, …>`，key 由 `identity.ts` `validateOpenIdentity`
   生成复合键；`removeOnlySelf` / `scheduleCarrierCleanup` / `beginIdleClose` 均以 key+generation 双守卫
   操作——**key 语义换成 namespaceId 后这些机制零结构改动**。
2. `runCreateSlot`（registry.ts:803-962）的 closing 分支（缺 closePromise fatal / await reject fatal /
   await 后仍 closing fatal / resolve 后消失放行）与 `ALREADY_EXISTS_ISSUE` 两个出口，在 D-4 新链下
   **结构性不可达**（entry 一律碰撞重试、duplicate 一律重试）→ 成为本切片删除的死代码。
3. 构造期门禁现有顺序：`assertClockShape` → `assertSchedulerShape` → `resolveIdleTimeoutMs`
   （registry.ts:447-451）。randomBytes 门禁插在最后（§4.1.2 论证）。
4. `registry-surface.test.ts` 冻结：主入口运行时 export 恰 9 值、testing 子路径恰 2 值、declaration
   可达图禁词（NamespaceRuntime/DocHandle/Y.Doc/internal subpath）、cordis import 白名单（仅
   plugin.ts）、host-global-timer 禁令（全部 src 含 testing.ts）。本设计的全部 src 改动不触发任何
   上述守卫（`node:crypto` 不在禁令面；plugin.ts 是 cordis 白名单成员）。
5. 测试工厂调用面：`createNamespaceRegistryForTesting` 在 11 个既有测试文件共约 145 处、
   `createRegistryInternal` 在 registry-create.test.ts 4 处（closing fixture，本切片删除其死路径用例）、
   生产工厂 `createNamespaceRegistry(` 的测试调用仅 SA6 红灯文件 1 处（门禁断言本身）。
6. `packages/persistence/src/file.ts` 以 `import * as fsp from 'node:fs/promises'` 证明
   **Host-facing 适配层使用 Node 内建模块是本仓库既定先例**（核心 seam 仍 Host 无关）。

---

## §4. 详细设计

### §4.1 受控随机源 capability（AC-1 注入面 + 缺失门禁）

#### §4.1.1 类型面（SA6 类型锚 3/5 的落位）

`src/types.ts` 新增（对齐 `RegistryTimeoutScheduler` 的 property-signature 先例）：

```ts
/**
 * Registry 受控随机源 capability（phase-5 切片 1；ADR 0009 依赖纪律 + ADR 0010 身份条款）。
 * 契约：实现必须是密码学安全随机（CSPRNG）；每次调用返回**新鲜、无偏、恰 length 字节**的
 * Uint8Array；不得是可 fallback 的全局 crypto 直调。缺失/非函数 → 构造期同步 TypeError，
 * 绝不 fallback（禁 Math.random / crypto.getRandomValues 缺省）。
 */
export interface RegistryRandomBytes {
  (length: number): Uint8Array;
}

export interface CreateNamespaceRegistryOptions {
  readonly clock: Clock;
  readonly scheduler: RegistryTimeoutScheduler;
  readonly randomBytes: RegistryRandomBytes;   // ← 新增必需（原字段全部保持）
  readonly idleTimeoutMs?: number;
  readonly observer?: RegistryObserver;
}
```

`src/testing.ts` `NamespaceRegistryTestingOverrides` 同步新增**必需** `randomBytes: RegistryRandomBytes`
（SA6 类型锚：`HasRandomCapability<NamespaceRegistryTestingOverrides>` 必须为 true——必需键才满足
`T extends { readonly randomBytes: (length: number) => Uint8Array }`）。

`src/registry.ts` `NamespaceRegistryInternalOptions` 新增必需 `randomBytes`。`src/index.ts` type
导出清单**追加** `RegistryRandomBytes`（类型导出不影响运行时 9 值冻结；declaration 测试为
toContain 断言，加法安全）。

类型面判定（SA6 `registry-phase5-identity-surface.test-d.ts`）：
- `HasCallerNamespaceId<CreateNamespaceInput>`：三键化后为 false → `CallerNsIdMustBeAbsent` = true ✓（§4.3.1）。
- `CreateNamespaceInput extends ThreeKeyShape`（恰 owner/schema/root 三键）✓。
- 两个选项类型的 `HasRandomCapability` = true ✓。

#### §4.1.2 构造期门禁（SA6 契约锚点 2 / AC-1 第 3 用例）

`src/registry.ts` 新增形状门禁并在 `createRegistryInternal` 顶部执行：

```ts
export const NAMESPACE_REGISTRY_RANDOM_REQUIRED_MESSAGE =   // types.ts 单一真相源
  'NAMESPACE_REGISTRY_RANDOM_REQUIRED: Registry 必须提供受控随机源 randomBytes(length): Uint8Array';

function assertRandomBytesShape(value: unknown): asserts value is RegistryRandomBytes {
  if (typeof value !== 'function') {
    throw new TypeError(NAMESPACE_REGISTRY_RANDOM_REQUIRED_MESSAGE);
  }
}
```

- **执行点**：`createRegistryInternal`（生产工厂与 testing seam 共用），故
  `createNamespaceRegistry` 与 `createNamespaceRegistryForTesting` 双双获得构造期同步 TypeError
  （SA6：`expect(() => …(persistence, { clock, scheduler })).toThrow(TypeError)` 双断言均绿）。
- **检查顺序**：clock → scheduler → idleTimeoutMs（resolve）→ **randomBytes**。理由：
  (a) clock/scheduler 先序是既有测试锚（`{clock:{}}` 必须抛 CLOCK 文案），不可动；
  (b) idleTimeoutMs 的 TYPE/RANGE 二分先于 randomBytes，使「非法 idleTimeoutMs + 缺随机源」的既有
      用例语义不漂移（错误二分文案稳定）。
- `testing.ts` 的 `internal` 透传对象补 `randomBytes` 直通（与 clock/scheduler 同款必需直通）。

#### §4.1.3 生产随机源：plugin.ts 桥接 Node CSPRNG（D-2）

`src/plugin.ts`（本包唯一 cordis 白名单模块，Host-facing 适配层）：

```ts
import { randomBytes as nodeRandomBytesSource } from 'node:crypto';
import type { RegistryRandomBytes } from './types.js';

/**
 * 生产受控随机源（phase-5 切片 1）：Node CSPRNG 桥接。核心（registry.ts 等）零全局 crypto
 * 直调——生产来源只在本 Host-facing 适配层接线。Buffer → new Uint8Array 拷贝：交付精确契约
 * 类型（独立普通 Uint8Array，防 Buffer 池化/子类语义外泄进核心）。
 */
const productionRandomBytes: RegistryRandomBytes = (length: number): Uint8Array =>
  new Uint8Array(nodeRandomBytesSource(length));
```

`apply(ctx)` 内 `createNamespaceRegistry(...)` 调用补 `randomBytes: productionRandomBytes`。

**为什么不新建 Cordis service / 新包**：(a) 仓库无 random service，切片 1 无 AC 要求新建；
(b) clock 成服务是因为**多消费者**（persistence + registry），random 当前仅 registry 一个消费者；
(c) `node:fs/promises`（file.ts）先例确立「Host-facing 适配层可用 Node 内建」；(d) 注入 seam 是
Host 无关契约本体，未来若出现第二消费者，可无损抽出 `@nomicore/random` 服务替换本桥接（核心零改动）。
plugin config 仍单键 `idleTimeoutMs`（严格子集校验不变）；`assertNamespaceRegistryHostDependencies`
依赖清单不变（clock/timer/nomicorePersistence）。

守卫核对：`node:crypto` specifier 非 cordis 系（白名单扫描不命中）；`randomBytes(` 调用是属性/
模块限定调用且不在 host-global-timer 三正则面（setTimeout/setInterval/clearTimeout/clearInterval/
globalThis.*/Date.now）——`registry-surface.test.ts` 两静态守卫保持绿。declaration emit 中
`node:crypto` 值导入被 TS 剥离（仅 `RegistryRandomBytes` 类型引用留存），不进 .d.ts specifier 面。

### §4.2 ns-+32hex 生成与响亮守卫（AC-1 / D-3）

`src/registry.ts` 新增（核心私有，不导出）：

```ts
const NAMESPACE_ID_RANDOM_BYTES = 16;                       // 128-bit
const NAMESPACE_ID_PATTERN = /^ns-[0-9a-f]{32}$/;           // 35 字符，满足 ADR 0006 共享安全文法
const MAX_NAMESPACE_ID_RETRIES = 8;                          // 首生成 + 至多 8 次重试 = 总生成 ≤ 9

function generateNamespaceIdOrFatal(owner, attempt): string {
  let bytes: unknown;
  try {
    bytes = randomBytes(NAMESPACE_ID_RANDOM_BYTES);
  } catch (cause) {                                          // 能力 throw → 立即 fatal，不重试
    dispatchObserver(observer, { type: 'create-id-generation-failed', owner, attempt, cause });
    throw new NamespaceRegistryFatalError('create', 'namespace-id-generation', false, cause);
  }
  if (!(bytes instanceof Uint8Array) || bytes.length !== NAMESPACE_ID_RANDOM_BYTES) {
    const cause = new Error('NAMESPACE_ID_RANDOM_SOURCE_INVALID: 受控随机源必须返回 16 字节 Uint8Array');
    dispatchObserver(observer, { type: 'create-id-generation-failed', owner, attempt, cause });
    throw new NamespaceRegistryFatalError('create', 'namespace-id-generation', false, cause);
  }
  let hex = '';
  for (let i = 0; i < NAMESPACE_ID_RANDOM_BYTES; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');           // 小写 hex，零 Buffer 依赖
  }
  const namespaceId = `ns-${hex}`;
  if (!NAMESPACE_ID_PATTERN.test(namespaceId)) {             // 编码自身产物恒真——防未来回归的结构守卫
    const cause = new Error('NAMESPACE_ID_ENCODING_INVALID: 生成的 namespaceId 不符合 ns-+32hex');
    dispatchObserver(observer, { type: 'create-id-generation-failed', owner, attempt, cause });
    throw new NamespaceRegistryFatalError('create', 'namespace-id-generation', false, cause);
  }
  return namespaceId;
}
```

设计裁决（拒绝虚假降级）：
- **随机源 throw / 形状违约不消耗重试预算**。碰撞重试的前提是「ID 合法但被占用」（瞬态、概率
  2^-128）；随机源 throw 或返回 15 字节是**能力契约缺陷**（正常路径的缺陷，不是降级场景）——按
  SKILL 纪律响亮 fatal，绝不静默重摇掩盖坏源（坏 CSPRNG 重摇 9 次仍是坏源）。
- 随机源每调用恰请求 16 字节（SA6 scripted 源的 `length !== 16 → throw` 契约）。
- hex 自编码（`toString(16).padStart(2,'0')` 恒小写）；产物结构守卫使非法 ID 结构性无法离开生成器。

### §4.3 create 新主链（AC-1/AC-2/AC-6 / D-4/D-5/D-12）

#### §4.3.1 同步接纳段（公共入口）

`acceptCreateIdentity`（identity.ts）重写为 owner-only 接纳：

```ts
/** create 接纳结果：ok 携带冻结 owner 投影（namespaceId 不存在——槽内生成）。 */
export type CreateIdentityOutcome =
  | { readonly ok: true; readonly owner: Readonly<{ readonly userId: string }> }
  | { readonly ok: false; readonly issue: CreateNamespaceIssue };

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
    if (ownerDesc !== undefined &&
        (!('value' in ownerDesc) || ownerDesc.get !== undefined || ownerDesc.set !== undefined)) {
      return { ok: false, issue: CREATE_INVALID_INPUT_ISSUE };
    }
    // ③ owner 文法校验 + 冻结投影（field='owner.userId'；零随机/零 carrier/零 Persistence）
    return validateOwnerIdentity(ownerDesc?.value);   // validateOpenIdentity 的 owner 段抽出复用
  } catch {
    return { ok: false, issue: CREATE_INVALID_INPUT_ISSUE };
  }
}
```

- `validateOwnerIdentity` 从 `validateOpenIdentity` 抽出 owner 校验段（open 路径零行为变化；
  open 的 namespaceId 先行短路次序不变）。
- 排序裁决：①（四键拒收）在 ③（owner 文法）之前——「携带 namespaceId 的四键输入」与「owner 好坏」
  的组合以 CREATE_INVALID_INPUT 结算（SA6 四键用例 owner 合法，两种排序均可满足锚点；本排序与
  既有 descriptor-先-值的分层一致）。
- 快照层 `snapshotCreatePayload` 的恰 N 键校验从 4 改 3（允许键集 {owner,schema,root}）——接纳后
  追加/改名键的排队期变异仍在槽内快照被拒（既有排队变异语义保持）。
- message 常量更新（单一真相源 types.ts）：
  `NAMESPACE_CREATE_INVALID_INPUT_MESSAGE = 'NAMESPACE_CREATE_INVALID_INPUT: create 输入必须恰含 owner、schema 与 root'`。

#### §4.3.2 公共入口与生成编排

```ts
// registry.ts
const admittedCreates = new Set<Promise<void>>();   // §4.6 shutdown 屏障用

create(input: unknown): Promise<CreateNamespaceResult> {
  if (acceptance !== 'running') return NOT_ACCEPTING_ISSUE;   // 停接纳先于输入访问（既有）
  const admission = acceptCreateIdentity(input);
  if (!admission.ok) return Promise.resolve(admission.issue); // 零随机/零 carrier 副作用
  return orchestrateCreate(admission.owner, input);
}

/** 一次/create 的准备产物（§4.5 拆分产物 + 快照/时钟；跨重试候选复用）。 */
interface CreatePreparedState {
  readonly schema: unknown;
  readonly root: unknown;
  readonly createdAt: string;
  readonly bundle: PreparedDocumentBundle;
}

function orchestrateCreate(owner, inputRef): Promise<CreateNamespaceResult> {
  const preparedBox: { current?: CreatePreparedState } = {};
  const run = (async (): Promise<CreateNamespaceResult> => {
    for (let retry = 0; ; retry += 1) {
      if (retry > MAX_NAMESPACE_ID_RETRIES) {                  // 已完成 9 次生成 → 耗尽
        const cause = new Error(
          `NAMESPACE_ID_RETRY_BUDGET_EXHAUSTED: 受控随机源生成与重试预算耗尽(attempts=${MAX_NAMESPACE_ID_RETRIES + 1})`);
        dispatchObserver(observer, { type: 'create-id-generation-failed', owner, attempt: retry, cause });
        throw new NamespaceRegistryFatalError('create', 'namespace-id-generation', false, cause);
      }
      const candidate = generateNamespaceIdOrFatal(owner, retry);   // fatal 直接冒泡
      const outcome = await admitCreateAttempt(owner, inputRef, candidate, preparedBox);
      if (outcome.kind === 'retry') continue;                  // entry 碰撞 / DOC_DUPLICATE → 换 ID
      return outcome.result;                                   // 成功 lease / 领域 issue / （fatal 已 throw）
    }
  })();
  const tracked = run.then(() => undefined, () => undefined);  // 恒绿跟踪尾
  admittedCreates.add(tracked);
  void tracked.finally(() => { admittedCreates.delete(tracked); });
  return run;
}
```

**预算语义**：`retry ∈ [0,8]` → 总生成次数 ≤ 9（首生成 + 至多 8 次重试）。SA6 锚定宽容区间
[9,10] 收编两种 ADR 读法，本设计取**严格读法 9**：
- entry 碰撞耗尽用例：script 10×X，consumed = 9 ∈ [9,10] ✓；纯 entry 碰撞零 createDoc（第二次
  create 全程不触 Persistence）✓；
- Persistence duplicate 耗尽用例：每代均过 entry 门并尝试 createDoc → duplicate 尝试 = 9 ∈ [9,10] ✓。

#### §4.3.3 每候选 carrier 接纳与 attempt slot

```ts
type CreateAttemptOutcome =
  | { readonly kind: 'final'; readonly result: CreateNamespaceResult }
  | { readonly kind: 'retry' };

function admitCreateAttempt(owner, inputRef, candidate, preparedBox): Promise<CreateAttemptOutcome> {
  const identity: InternalIdentity = { owner, namespaceId: candidate, key: candidate };
  const carrier = carriers.get(identity.key) ?? createCarrier(identity.key);
  const operation = carrier.tail.then(() => runCreateAttempt(identity, inputRef, preparedBox));
  const operationGreenTail = operation.then(() => undefined, () => undefined);
  carrier.tail = operationGreenTail;
  scheduleCarrierCleanup(identity.key, carrier, operationGreenTail);
  return operation;
}

async function runCreateAttempt(id: InternalIdentity, inputRef, preparedBox): Promise<CreateAttemptOutcome> {
  // ① entry 碰撞：active / idle / closing 一律碰撞 → 重生成（不等待 closePromise、不 fail-closed）
  if (entries.has(id.key)) return { kind: 'retry' };

  // ② 首个过门尝试的一次性准备：payload 快照 → Clock 单读 → compile+validate（§4.5）
  if (preparedBox.current === undefined) {
    const payload = snapshotCreatePayload(inputRef);              // 恰三键 {owner,schema,root}
    if (!payload.ok) return { kind: 'final', result: CREATE_INVALID_INPUT_ISSUE };
    const createdAt = readCreatedAtOrFatal(id);                   // 既有 fatal 语义原样
    const prepared = prepareCreateDocument(payload.schema, payload.root);
    if (!prepared.ok) {
      return { kind: 'final',
               result: prepared.kind === 'schema-invalid'
                 ? schemaInvalidIssue(prepared.issues) : rootInvalidIssue(prepared.issues) };
    }
    preparedBox.current = { schema: payload.schema, root: payload.root, createdAt, bundle: prepared.bundle };
  }
  const p = preparedBox.current;

  // ③ 构造步（每候选：META.docId = 候选 ID；testing seam 按候选调用）
  let initial: CreateDocumentGatewayResult;
  try {
    initial = buildInitialDocument(documentFactory, id.namespaceId, p.createdAt, p.schema, p.root, p.bundle);
  } catch (cause) {
    dispatchObserver(observer, { type: 'lifecycle-slot-failed', identity: id, operation: 'create', cause });
    if (cause instanceof DocRuntimeFatalError) {
      throw new NamespaceRegistryFatalError('create', 'create-document-internal', cause.committed, cause);
    }
    throw new NamespaceRegistryFatalError('create', 'create-document-internal', false, cause);
  }
  if (!initial.ok) {
    if (initial.kind === 'schema-invalid') return { kind: 'final', result: schemaInvalidIssue(initial.issues) };
    if (initial.kind === 'root-invalid')   return { kind: 'final', result: rootInvalidIssue(initial.issues) };
    const cause = new Error('createInitialDocument 返回不可达 input-invalid');   // 既有 fail-loud
    dispatchObserver(observer, { type: 'lifecycle-slot-failed', identity: id, operation: 'create', cause });
    throw new NamespaceRegistryFatalError('create', 'create-document-internal', false, cause);
  }

  // ④ Persistence 排他创建：DOC_DUPLICATE → retry；其余映射逐字保持既有 §7 表
  let handle: DocHandle;
  try {
    handle = await persistence.createDoc(id.owner, id.namespaceId, initial.doc);
  } catch (cause) {
    if (cause instanceof DocDuplicateError) return { kind: 'retry' };           // ← 唯一新增 retry 源
    if (cause instanceof DocCreateOperationalError) {
      dispatchObserver(observer, { type: 'create-persist-failed', identity: id, cause });
      return { kind: 'final', result: CREATE_FAILED_ISSUE };
    }
    if (cause instanceof DocCreateFatalError) {
      dispatchObserver(observer, { type: 'lifecycle-slot-failed', identity: id, operation: 'create', cause });
      throw new NamespaceRegistryFatalError('create', 'lifecycle-slot-internal', cause.committed, cause);
    }
    dispatchObserver(observer, { type: 'lifecycle-slot-failed', identity: id, operation: 'create', cause });
    throw new NamespaceRegistryFatalError('create', 'lifecycle-slot-internal', false, cause);
  }

  // ⑤ Runtime factory + entry 登记 + lease（既有语义逐字保持，key/namespaceId = 候选）
  try {
    const runtime = factory(handle, () => persistence.saveDoc(handle));
    const entry = makeEntry(id, runtime);
    entries.set(id.key, entry);
    return { kind: 'final', result: issueLease(entry) };
  } catch (cause) {
    void releaseHandleBestEffort(handle, id);
    dispatchObserver(observer, { type: 'create-runtime-construction-failed', identity: id, cause });
    throw new NamespaceRegistryFatalError('create', 'runtime-construction', true, cause);  // committed:true
  }
}
```

**次序不变量（对 ADR 0009 #111 冻结次序的迁移映射）**：entry 检查仍先于 payload/Clock/compile
（纯 entry 碰撞 → 零 Clock 读、零 build——DQ-5 精神保持）；payload 快照仍在槽内（排队期变异语义
保持）；Clock 仍单读（一次/create，不随重试递增——既有 clock 计数锚保持）；compile/validate
一次/create（不随重试重复）；createDoc 仅在全部准备成功后调用（保持）。

**删除的死代码**：`runCreateSlot` 原 closing 分支全部四变体（缺 closePromise fatal / await reject
fatal / await 后仍 closing fatal / resolve 后消失放行）与 `ALREADY_EXISTS_ISSUE` 的两个产出点。
`ALREADY_EXISTS_ISSUE` 常量随之从 registry.ts 移除（类型/message 留在 types.ts——§4.7）。

#### §4.3.4 关键并发论证（防弹核心）

> **不变量 C-1（每 key 槽串行）**：候选 K 的「entry 碰撞检查（①）」与「entry 登记（⑤）」之间只
> 有 `await createDoc` 与同步 factory——同 key 的任何其他 slot（open/create attempt/generation
> close 后的 open）都在同一 carrier FIFO 上排队，不会在两者之间交错。因此 check-then-register 对
> 同 key 是原子的。
>
> **推论 1（同进程唯一 Runtime，AC-3）**：两个并发 create 生成同一候选 K（仅敌意/脚本随机可达）
> → 同 carrier 串行 → 先者登记 entry，后者 slot 启动即 ① 命中 → 重生成。不同 owner 亦然
> （entry 以 namespaceId 索引，与 owner 无关）。**「同一 namespaceId 每进程至多一个 Runtime」由
> carrier FIFO 结构性保证，不依赖 Persistence duplicate**（不同 owner 分区的 duplicate 信号不触发）。
>
> **推论 2（在途 create 碰撞）**：create#1 attempt K 在 createDoc await 中；create#2 生成同 K →
> admit 进同 carrier → 排在 #1 之后 → 见 #1 已登记 entry → 重生成。AC-6「并发双 create 各自唯一
> ID、并行落盘」= 不同候选 → 不同 carrier → 并行 ✓。
>
> **不变量 C-2（entry 只在 slot 内增加）**：entry 的增加只发生在 open/create attempt slot 内；
> idle-close timer 与 shutdown 只移除 entry（方向安全：移除只会让后来者走 loadDoc/新登记，不会
> 造成双登记）。closing entry 的 closePromise settle 回调（removeOnlySelf）不在 carrier 上，但它
> 只删除自己（identity+generation 双守卫），不与新 slot 竞争登记位。
>
> **不变量 C-3（重试再接纳不破坏 FIFO 语义）**：每次重试把 attempt 追加到**新候选 key** 的
> carrier 尾部——对任意 key K，作用于 K 的 slots 仍严格按接纳顺序串行；create 编排在键间迁移
> 是 ADR 0010 新重试语义的自然结果（原「单 key 单 slot」冻结次序在 key 维度上保持）。

#### §4.3.5 耗尽 fatal 与 observer 事件（D-5/D-12）

- 耗尽 → `throw new NamespaceRegistryFatalError('create', 'namespace-id-generation', false, cause)`：
  - `code='NAMESPACE_REGISTRY_FATAL'`（类常量）、`operation='create'`、`committed=false`（耗尽时
    零 createDoc 成功——任何成功 createDoc 都直接登记 entry 返回，不可能进入耗尽分支）；
  - `phase='namespace-id-generation'` ∉ LEGACY_PHASES（`runtime-construction` /
    `create-document-internal` / `lifecycle-slot-internal`）——SA6 `not.toContain` 锚绿。
  - **命名裁决**：`namespace-id-generation` 覆盖该阶段的三类终局（随机源 throw / 形状违约 / 预算
    耗尽）——它们都是「create 管线中 ID 生成阶段」的内部故障，与既有 phase 的「管线阶段 + -internal
    后缀（仅内部子步骤）」词风一致；不用 `-exhausted`（只覆盖三终局之一）、不用
    `create-document-internal`（语义混淆且committed 传播规则不同）。
- observer 新增加法事件（`src/observer.ts` union 追加一员；既有十形零改动）：

```ts
| { type: 'create-id-generation-failed';
    owner: Readonly<{ readonly userId: string }>;
    attempt: number;          // 失败时的生成序号（0 起；耗尽时 = MAX+1）
    cause: unknown }
```

  发射点恰三处：随机源 throw、形状违约、预算耗尽（各恰一次）。不复用
  `lifecycle-slot-failed`——它强制携带 `InternalIdentity`（含 namespaceId），而生成失败时 ID 尚
  不存在；伪造占位 ID 违反 identity 诚实纪律。dispatchObserver 隔离语义（observer throw 静默）
  不变。逐次碰撞重试**不**发事件（敌意/脚本随机才可达，运行噪音为零；列为显式非目标）。

### §4.4 entry key 迁移与 open owner 核对（AC-3/AC-4）

#### §4.4.1 key 派生（identity.ts）

`validateOpenIdentity` 的 key 派出：

```ts
// 旧：key: `${userId.length}:${userId}\u0000${namespaceId.length}:${namespaceId}`
// 新：key: namespaceId
```

单成分键无拼接碰撞注入面，长度前缀机制随复合键一并退役。`InternalIdentity` 结构不变
（owner/namespaceId/key 三字段；open 与 create attempt 都产出完整 identity）。
`digestKey(key)` 机制不变（现摘要 namespaceId 本体——open 测试仅锚
`/^keydigest:v1:[0-9a-f]{16}$/` 格式）。

#### §4.4.2 runOpenSlot 的 owner 核对投影

```ts
async function runOpenSlot(identity: InternalIdentity): Promise<OpenNamespaceResult> {
  const key = identity.key;
  const current = entries.get(key);
  if (current !== undefined && current.owner.userId !== identity.owner.userId) {
    return NOT_FOUND_ISSUE;              // ← 新增第一谓词：mismatch 在 phase 分派之前
  }
  if (current !== undefined && current.phase === 'active')  return issueLease(current);
  if (current !== undefined && current.phase === 'idle')    return issueLease(activateEntry(current));
  if (current !== undefined && current.phase === 'closing' && current.closePromise !== undefined) {
    try { await current.closePromise; } catch { /* 既有注释语义保持 */ }
    const recheck = entries.get(key);
    if (recheck !== undefined && recheck.owner.userId !== identity.owner.userId) {
      return NOT_FOUND_ISSUE;            // ← recheck 同谓词：新代际属他人 → 与「现在才到达」同结果
    }
    if (recheck !== undefined && (recheck.phase === 'active' || recheck.phase === 'idle')) {
      return issueLease(activateEntry(recheck));
    }
    // recheck undefined / 结构性不可达 closing：落穿 loadDoc（既有）
  }
  // loadDoc(identity.owner, identity.namespaceId) …（以下零改动）
}
```

- **零暴露语义**：mismatch 返回**既有 NOT_FOUND 常量**（同 message），不区分「entry 属他人」与
  「不存在」——存在性零泄露（ADR 0010「不匹配统一返回 NAMESPACE_NOT_FOUND」）。
- **零 Persistence 触碰**：mismatch 短路在 loadDoc 之前 → `loadCalls === []`（SA6 锚）。
- **零第二 Runtime**：mismatch 不进 factory → `constructed` 恰 1（SA6 锚）。
- **entry 无而 (ownerB, nsId) 分区有文档**：走正常 loadDoc(ownerB, nsId) → 成功建 Runtime——这是
  ADR 0010 合法面（Hub/Peer 同 namespaceId 不同 owner，各自 open 各自副本）；「不暴露」约束的精确
  边界是**不暴露他人 entry/Runtime**，不是禁止 owner 打开自己分区的同 ID 文档。SA6 第二 mismatch
  用例（B 分区已 seed 文档）红点在「alice 的 entry 命中后不得为 bob 建 Runtime」——本谓词精确命中。
- open 身份校验（grammar、namespaceId 先行短路、field 判别）**零改动**——旧格式 namespaceId
  （`k-ns` 等）继续可 open（§4.8 兼容锚）。

#### §4.4.3 Entry/Lease/Shutdown 结构

`Entry.key = namespaceId`（makeEntry 以完整候选 identity 构造）；owner 投影照旧来自 identity.owner
（admission 冻结）→ lease.owner === 输入 owner（AC-4 投影锚）。shutdown 聚合 failures 携带
owner/namespaceId（既有）零改动；idle 状态机（handleLeaseReleased/beginIdleClose/activateEntry）
零改动——全部经 key 间接寻址，key 语义变化对它们透明。

### §4.5 create-document 拆分（D-8）

`src/create-document.ts` 重构为两段（模块私有编排，包外零可见）：

```ts
export interface PreparedDocumentBundle { readonly envelope: SchemaEnvelope; readonly derived: DerivedSchema; }

export type PrepareCreateDocumentResult =
  | { readonly ok: true;  readonly bundle: PreparedDocumentBundle }
  | { readonly ok: false; readonly kind: 'schema-invalid' | 'root-invalid'; readonly issues: readonly unknown[] };

/** compile + 封闭校验（一次/create，ID 无关）。compile/validate 本身是结果联合，零 throw。 */
export function prepareCreateDocument(schema: unknown, root: unknown): PrepareCreateDocumentResult {
  const compiled = compileSchemaEnvelope(schema);
  if (!compiled.ok) return { ok: false, kind: 'schema-invalid', issues: compiled.issues };
  const logical = validateLogicalSnapshot(compiled.derived, root);
  if (!logical.ok) return { ok: false, kind: 'root-invalid', issues: logical.issues };
  return { ok: true, bundle: { envelope: compiled.envelope, derived: compiled.derived } };
}

/** 构造步（一次/候选）：META.docId = 候选 namespaceId；testing seam 按候选调用。 */
export function buildInitialDocument(
  factory: CreateDocumentFactory | undefined,
  namespaceId: string, createdAt: string, schema: unknown, root: unknown,
  bundle: PreparedDocumentBundle,
): CreateDocumentGatewayResult {
  const build = factory ?? defaultDocumentFactory;
  return build(namespaceId, createdAt, schema, root, { envelope: bundle.envelope, derived: bundle.derived });
}
```

- 原 `createDocument` 单入口删除（唯一调用方 registry.ts 同步迁移；无测试直接 import 本模块）。
- `CreateDocumentFactory` / `CreateDocumentGatewayResult` / testing seam 4 参签名零变化；
  seam 在无碰撞的既有用例中仍恰调用一次（计数锚保持）。
- `META.docId` = 候选 ID、`createdAt` 一次生成跨候选复用（ADR 0009「`new Date(ctx.clock.now())`
    单次」语义保持）；owner 不入 META（保持）。

### §4.6 shutdown × create 编排（D-9）

`runShutdown` 在 carrier 等待后追加编排等待：

```ts
async function runShutdown(): Promise<void> {
  await Promise.resolve();
  for (const carrier of [...carriers.values()]) await carrier.tail;      // 既有：当前全部槽
  const pending = [...admittedCreates];                                  // 新增：已接纳 create 编排
  if (pending.length > 0) {
    await Promise.all(pending.map((p) => p.then(() => undefined, () => undefined)));  // 恒绿等待
  }
  // …（关闭全集枚举、聚合、entries.clear、acceptance='stopped'——零改动）
}
```

**为什么必须**：重试会把新 attempt admit 到**新 carrier**——若 shutdown 只等 carrier 快照，mid-retry
的编排在快照后建的新 carrier 不在等待集，shutdown 会在其登记 entry 前进入 close/清空阶段。ADR 0009
「等待此前已接纳的 lifecycle 操作结算」的「操作」= 调用方的 create（含其全部重试）。admittedCreates
在公共入口 acceptance 检查后同步注册、终局（成功/issue/fatal）后异步注销——shutdown 同步段关门后
集合只减不增，快照等待安全。`run` 的 rejection 交付原调用方（create 结果契约）；tracked 恒绿尾
被 Promise.all 吸收，零 unhandled rejection。

### §4.7 错误注册表变更汇总（D-7）

| 项 | 变更 | 理由 |
|---|---|---|
| `NamespaceRegistryFatalPhase` | 追加 `'namespace-id-generation'` | 耗尽/随机源故障的稳定 phase（ADR 0009 开放清单新注册） |
| `NAMESPACE_ALREADY_EXISTS` code + message | **保留**于 `CreateNamespaceIssue` 联合与 types.ts 常量；registry.ts 删除全部产出点 | (a) 删公共联合成员是超出本切片授权的破坏性契约变更；(b) 切片 2「复制 bootstrap 受信任导入保留 Hub namespaceId」需要 already-exists 结果语义，届时经受信任路径产出——本切片先保留注册位；(c) 零死运行时分支（常量只是不再被普通 create 产出） |
| `NAMESPACE_CREATE_INVALID_INPUT_MESSAGE` | 文案枚举去 namespaceId | 三键输入文法 |
| `NAMESPACE_REGISTRY_RANDOM_REQUIRED_MESSAGE` | 新增 | 门禁单一真相源 |
| observer 事件 | 追加 `create-id-generation-failed` | §4.3.5 |

### §4.8 Persistence 零改动与兼容性不变量（AC-5）

- `packages/persistence` **零源码改动**：`createDoc(owner, 生成ID, doc)` 继续按 owner 分区排他创建；
  `DOC_DUPLICATE` 信号被 Registry 重试环消费（语义不变、消费方反应变化）；无 list/catalog API
  （SA6 保持性守卫绿）；`META.docId === namespaceId` 校验对生成 ID 天然成立。
- 生成 ID `ns-`+32hex（35 字符）满足 ADR 0006 共享安全文法 `^[a-z][a-z0-9-]{0,62}$`（事实性提示 4）
  → 可直接用于 owner 目录内文件名、META.docId、未来 REST path/WS room，零编码/转义。
- **旧 ID 兼容锚**：open 的 identity 文法（isMinimalSafeString）零改动——基线时代创建的
  `k-ns` 等旧格式 namespaceId 继续可 open/复用/空闲保留/shutdown（§9 round-trip 兼容保持）。
- 跨 Registry 实例（测试中同 Persistence 双实例）：entry 各自独立，Persistence 分区语义不受影响。

---

## §5. SA6 红灯锚点落位矩阵

### §5.1 运行时 15 条（registry-phase5-identity-red.test.ts）

| # 用例（缩写） | 设计落位 |
|---|---|
| AC-1 三键成功：lease 投影生成 ID/owner、createDoc(owner, ID)、随机恰 1 次、Runtime 以生成 ID 构造 | §4.3 全链（单生成：consumed=1；makeEntry/lease 投影 §4.4.3） |
| AC-1 四键拒收：CREATE_INVALID_INPUT、零随机、零 Persistence | §4.3.1 接纳段 ①（先于生成） |
| AC-1 缺失随机源：双工厂构造期 TypeError | §4.1.2（createRegistryInternal 共用门禁） |
| AC-2 active entry 碰撞 → 重生成 | §4.3.3 ① + C-1 推论 2 |
| AC-2 idle entry 碰撞 → 重生成 | §4.3.3 ①（idle 亦占 key） |
| AC-2 closing entry 碰撞 → 重生成不等待；close 结算后 open 重建 generation | §4.3.3 ①（closing 一律碰撞）+ §4.4.2（open 落穿 loadDoc 既有路径） |
| AC-2 Persistence duplicate 碰撞 → 换 ID | §4.3.3 ④（DOC_DUPLICATE → retry） |
| AC-2 entry 碰撞耗尽：fatal、committed:false、新 phase、总生成 ∈[9,10]、零重复落盘 | §4.3.2（9 次生成）+ §4.3.5 |
| AC-2 duplicate 耗尽：多次 createDoc 均 duplicate 后 fatal（∈[9,10]） | §4.3.2/④（每代过 entry 门 → createDoc） |
| AC-3/4 第二 owner open → NOT_FOUND、零 loadDoc、零新 Runtime | §4.4.2 第一谓词 |
| AC-3/4 owner mismatch 不暴露 B 分区文档 | §4.4.2（entry 命中短路；B 分区文档仅无 entry 时经 loadDoc 合法可见——SA6 用例有 alice entry 命中） |
| AC-4 create 校验 owner：INVALID_IDENTITY(field=owner.userId)、零生成、零 Persistence | §4.3.1 ③（接纳段先于生成） |
| AC-5 owner 分区全链：同分区恢复、跨 owner NOT_FOUND、createDoc 全落 A 分区 | §4.8（Persistence 零改动）+ §4.4.2（§6 修正一已落盘：registryB 注入空剧本随机源） |
| AC-6 并发双 create：唯一 ID、并行落盘、双 lease | C-1 推论 2（不同候选不同 carrier 并行） |
| AC-6 shutdown 恰一次关闭 + stopped | §4.6（编排等待）+ 既有 shutdown 机制零改动 |

### §5.2 类型面 5 条（registry-phase5-identity-surface.test-d.ts）

| # | 设计落位 |
|---|---|
| CreateNamespaceInput 无 namespaceId 键 | §4.3.1 + types.ts 三键化 |
| 三键形状保持性守卫 | 同上 |
| CreateNamespaceRegistryOptions 暴露 randomBytes | §4.1.1（必需键 + `RegistryRandomBytes` 可赋 inline 函数型） |
| NamespaceRegistryTestingOverrides 暴露同款 | §4.1.1 |
| DocPersistence 无 catalog 成员（保持性） | §4.8（零改动） |

---

## §6. 红灯面双修正记录（R2：两处均已落盘——契约原理 + 落盘证据）

红灯验收面曾存在**两处 fixture × 契约互斥**（运行时轴 + 类型轴），均为 SA6 `[SA6 owned]` 文件的
必需修正。R2 时点复核：**两处均已落盘**，绿判恒以 **15/15 + 零 unhandled source errors** 为准
（R1 的「修正前以 14/15 为准」过渡条款废止——SA2 攻击 #4）。

### 修正一（R1 发现，运行时轴）：AC-5 registryB 缺随机源

- **矛盾**：AC-1 门禁用例（red.test.ts:287-288）要求 `createNamespaceRegistryForTesting(persistence,
  { clock, scheduler })` 缺 randomBytes **必须构造期 throw TypeError**（SA6 契约锚点 2 的直接断言，
  且总控任务简报明列「缺失门禁」为设计必覆盖项）；而 AC-5 分区用例原 registryB
  `makeRegistry(persistence, { factory })` 的 overrides **不含 randomBytes** 却必须能构造并 open——
  两者不可同真（差异仅 idleTimeoutMs/runtimeFactory 两个与随机源无关的键；「注入 runtimeFactory
  则豁免随机源门禁」是无原则的反向拟合，本设计拒绝）。
- **裁决**：锚点 2（显式契约文本）+ 类型锚（randomBytes 为两选项类型的必需键）优先；registryB
  fixture 属遗漏。该用例的**意图**（全新 Registry 零内存 entry、同分区可恢复、跨 owner 不可见）
  不需要无随机源构造——open-only 的 Registry 注入任意随机源即可表达。
- **修正内容**：registryB 补空剧本随机源（本用例只 open、永不消耗）。
- **落盘证据（R2 复核）**：red.test.ts:482-485 现为
  `const registryB = makeRegistry(persistence, { factory, randomBytes: makeScriptedRandomBytes([]).randomBytes });`
  并附「构造门禁契约对任何实例均适用」注释 ✓。

### 修正二（R2 新增，类型轴——SA2 攻击 #1）：门禁用例无 cast 直呼 × 必需键类型锚

- **矛盾**：AC-1 门禁用例原以**无 cast 对象字面量**直呼两工厂：
  `createNamespaceRegistry(persistence, { clock, scheduler })` /
  `createNamespaceRegistryForTesting(persistence, { clock, scheduler })`。SA6 类型锚
  （surface.test-d.ts:31 `T extends { readonly randomBytes: (length: number) => Uint8Array }`，
  可选键不满足 extends）**强制 randomBytes 为两选项类型的必需键**——SA3 按设计实现后，这两行
  产生 **TS2345（missing property 'randomBytes'）**。red.test.ts 位于
  `tsconfig.typecheck.json` include（`packages/*/test/**/*.ts`），在 vitest `--typecheck` 程序内；
  非 test-d 文件的类型错误计为 **unhandled source errors**（SA6 基线运行证据格式自带
  「0 unhandled source errors」栏），默认使 run 失败 ⇒ §12 绿判命令不可达。与修正一同类
  （fixture × 门禁互斥），R1 只发现运行时轴一处。
- **修正内容（2 行 cast，断言逻辑零变化）**：按本仓库门禁测试既有先例
  `registry-create.test.ts:1294`（`c.options as never`），为两行补 `as never`——cast 仅为类型面
  消除，运行时仍按原样传入缺随机源的 options，构造必须同步 throw：

```ts
expect(() => createNamespaceRegistry(persistence, { clock, scheduler } as never)).toThrow(TypeError);
expect(() => createNamespaceRegistryForTesting(persistence, { clock, scheduler } as never)).toThrow(TypeError);
```

- **落盘证据（R2 复核）**：red.test.ts:283-288 现已含上述两行 `as never` cast + 成因注释
  （「类型锚要求 randomBytes 为必需键，无 cast 字面量在 SA3 落地后会产生 TS2345」）✓。
- **配套回归门**（写入 §12 命令 0）：`npx tsc -p tsconfig.typecheck.json --noEmit` 于 SA3 实现
  后必须仅剩 surface.test-d.ts 三锚转绿、**零新增错误**（修正前该文件即为 2 处 TS2345——这本身
  是「必需键类型 × 直呼缺键构造」矛盾真实存在的红灯证据）。

> **SA3 执行注**：两处修正均属 `[SA6 owned]` 文件、已落盘，SA3 不得触碰 red.test.ts；若实现后
> 该文件仍现类型错误，说明实现未按必需键契约落位（回查 §4.1.1），而非改测试。

---

## §7. 既有测试迁移矩阵（SA3 执行面；R2 按 SA2 攻击 #2 修正四行 + 补充豁免/语义说明）

> 全量 create 调用点普查（R2 复核，`grep -rn "\.create(" *.test.ts` 非 registry-create 文件
> 33 处）：idle ×6（475/747/761/862/875/1025）、open ×1（1098）、persistence-contract ×1（75）、
> plugin ×2（180/504）、sa7-cordis ×2（179/247）、sa7-hostile ×1（481）、sa7-rev1 ×1（368）、
> shutdown ×2（351/802）——下表逐行给出迁移/豁免判定。

| 文件 | 规模 | 迁移内容 |
|---|---|---|
| registry-create.test.ts | 50 例，最重 | (1) 全部 create 输入四键→三键（`makeCreateInput` 去 namespaceId 键）；(2) 全部工厂调用补 `randomBytes`（建议引入**确定性计数随机源 helper**：第 n 次生成 = `ns-` + n 的 32 位 hex——多数既有断言只需把期望 ID 换成确定性生成 ID）；(3) duplicate 组（9 处 ALREADY_EXISTS 断言）：entry-duplicate（active/idle/concurrent）改锚「重生成后成功」（scripted 源两段式）；persisted-duplicate 改锚「换 ID 成功 / 耗尽 fatal」；(4) closing 组 4 个 `createRegistryInternal`+testEntries fixture 及其断言**删除**（§4.3.3 死路径）——open 侧 closing 用例保留；(5) create 的 namespaceId 文法用例（''/'.'/'..','x/y' 等）改锚 CREATE_INVALID_INPUT（open 侧同形用例保留 field='namespaceId'）；(6) hostile namespaceId 用例同 (5)；(7) clock/seam 计数锚保持（单生成场景调用数不变）；**(8)（R2）旧 CREATE_INVALID_INPUT message 文本锚 2 处（:553、:958 断言 `'NAMESPACE_CREATE_INVALID_INPUT: create 输入必须恰含 owner、namespaceId、schema 与 root'`）随 §4.7 新文案同步为 `'…恰含 owner、schema 与 root'`** |
| registry-open.test.ts | 32 例 | 工厂调用补 randomBytes；keyDigest 断言为格式锚（零改动）；无跨 owner 复合键既有用例（已核实零命中）——语义面零迁移；:1098 sentinel create 已是 `as never` 两键输入（新旧契约均窄 issue、sentinel 泄漏扫描不受影响）——零改动 |
| registry-idle.test.ts | 18 例 | 工厂调用补 randomBytes；:475/:747/:862 三处 duplicate create 的 ALREADY_EXISTS 断言改锚重生成成功；**(R2) :761/:875/:1025 三处「close 结算后同 key 重建成功」用例需语义重写**——新契约下普通 create 不能指定 key，原「同 key 'k' 重建」表达失效，等价改写：scripted 源两段式 + Persistence duplicate stub 精确建模（首建提交 ID 后，close 结算 entry 移除，第二 create 若源再生成同 ID 则经 DOC_DUPLICATE 重试成功），或改锚「close 结算后 open 同 ID 重建新 generation」（open 侧既有语义）——二选一由 SA3 按用例意图就近选择，断言强度不降 |
| registry-plugin.test.ts | 9 例 | **(R2 修正) :180-183（`namespaceId:'ns-1'`）与 :504-507（`namespaceId:'k'`）两处 create 输入四键且期望成功——必须三键化**（plugin 内部自供 node 随机源，无需注入）；产物 namespaceId 断言改锚 `/^ns-[0-9a-f]{32}$/`（若原锚具体 ID） |
| registry-shutdown.test.ts | 14 例 | 工厂调用补 randomBytes；shutdown 语义零变化；**(R2) :351 与 :802 两处 create 的四键/敌意输入豁免不动**——二者均在 `await registry.shutdown()` 之后调用、期望 `REGISTRY_NOT_ACCEPTING` 且断言零 descriptor/trap 访问：公共入口停接纳检查先于一切输入访问（§4.3.1 既有次序），四键字面量永不被校验，shape 无关结果——改三键反而是无意义扰动 |
| registry-node-dispose / sa7-concurrency / sa7-hostile / sa7-rev1 | 2/5/10/5 例 | 工厂调用补 randomBytes；sa7-hostile :481 与 sa7-rev1 :368 的四键 create 期望成功——**三键化**；hostile create 输入按三键契约调整期望码 |
| registry-persistence-contract.test.ts | 2 例 | **(R2 修正) :75-79 create 输入四键（`namespaceId:'contract-doc'`）期望成功——必须三键化** + 工厂调用补 randomBytes；「重开恢复持久态」链路改锚生成 ID（确定性计数源或断言回读 lease.namespaceId 传递给 open——推荐后者，契约面更诚实） |
| registry-sa7-cordis.test.ts | — | **(R2 修正，SA2 攻击 #2 漏列必改) :154 `CREATE_PAYLOAD(namespaceId)` 恒四键工厂 + :179（`'ns-p1'`）/:247（`'ns-p2'`）两处期望成功——必须迁移**：CREATE_PAYLOAD 去 namespaceId 参数改三键；两调用点零参化；产物 ID 断言（`lease.read` 前的 namespaceId 使用、`stub.createCalls` 配对）改锚生成 ID 格式或经 lease.namespaceId 间接传递。已相应补入 §11 ALLOW LIST |
| registry-surface.test.ts | 12 例 | **零改动且必须保持全绿**（9/2 值冻结、declaration 加法、两静态守卫——见 §3.4/§4.1.3 核对） |
| registry-entry-removal-guard.test.ts | — | key 无关（任意字符串直驱 removeOnlySelf），零改动 |

**迁移纪律**：(a) 断言强度不降——重写用例必须锚定新契约的等价保证（排他性由「重生成 + 耗尽
fatal」承载）；(b) 确定性随机源 helper 只在测试内定义（禁止从 src 导出）；(c) 每文件迁移后
`pnpm vitest run packages/namespace-registry/test` 全绿再合入；**(d)（R2）迁移完整性 grep 门**
（SA2 红线 3，入 §12 命令 4）：`grep -rn "namespaceId:" packages/namespace-registry/test/*.test.ts`
剩余命中仅允许出现在 open 调用、期望对象、keyDigest 断言与豁免说明处——**create 输入对象内零残留**
（重点核 sa7-cordis/plugin/persistence-contract）。

---

## §8. AC-7 文档对齐范围（D-11）

| 文档 | 动作 | 内容 |
|---|---|---|
| `docs/adr/0009-namespace-registry-leases-and-host-lifecycle.md` | **追加修订节**「issue #131 修订（Phase 5 切片 1：Registry identity 迁移，依据 ADR 0010）」 | (1) Registry key → 仅 namespaceId（指向 ADR 0010）；(2) create 输入三键化 + ID 生成/重试 8 次/耗尽 fatal；(3) 新稳定 phase `namespace-id-generation` 注册进开放清单；(4) 依赖纪律扩展：randomBytes 为必需注入 capability（缺失构造期响亮失败，禁 fallback 全局 crypto）；(5) `NAMESPACE_ALREADY_EXISTS` 对普通 create 不再可达（保留注册位，切片 2 受信任导入路径使用）；(6) open 复用前 owner 核对、mismatch 统一 NOT_FOUND 零存在性泄露 |
| `docs/adr/0006-server-persistence-docstore.md` | **追加对齐说明**（issue #131） | 普通_create 的 namespaceId 由 Registry 注入 CSPRNG 生成（`ns-`+32hex，满足共享安全文法——仍属「系统分配、非调用方自选」）；Persistence 契约零变化：仍 owner 分区、`(owner, docId)` 排他 createDoc、`DOC_DUPLICATE` 信号由 Registry 重试环消费；不新增跨 owner catalog/全局唯一约束（重申） |
| `CONTEXT.md` | **零改动** | 已对齐（113-115 行 namespaceId 词条已是 ADR 0010 词汇：CSPRNG 生成、`ns-`+32hex、仅 namespaceId 排他索引、owner 分区不上 wire）——设计期已核实 |
| `docs/adr/0010-*` / `docs/phases/phase-5-*.md` | **零改动** | 0010 是本任务的操作性裁决原文（accepted，不改）；phase 文档是计划文档，无状态列 |
| package contracts | 代码即对齐 | types.ts 公共类型（§4.1.1/§4.3.1/§4.7）+ package.json exports 恰 `.`,`./testing` 不变 + 错误注册表常量（§4.7） |

---

## §9. 协议假设依据 (Protocol Assumption Evidence)

本设计含以下第三方库/运行时行为假设（无 HTTP/WS/端口/进程时序假设）：

| 假设 | 依据类型 | 依据内容（具体引用） | 风险 |
|---|---|---|---|
| Node `node:crypto` `randomBytes(n)` 返回恰 n 字节 CSPRNG 字节，产物 `instanceof Uint8Array`（Buffer） | 设计期实测验证 + 官方文档 | 实测（本 worktree，node v24.13.0）：`node -e "const {randomBytes}=require('node:crypto'); const b=randomBytes(16); console.log(b.length, b instanceof Uint8Array)"` → `16 true`；Node docs `crypto.randomBytes(size)`：「Generates cryptographically strong pseudo-random data… size \| number」（nodejs.org/api/crypto.html#cryptorandombytessize-callback） | 低 |
| `new Uint8Array(buffer)` 产出独立普通 Uint8Array 拷贝（非 Buffer、改拷贝不动原值） | 设计期实测验证 + TS lib 标准 | 同上实测：`plain copy length: 16 isBuffer: false`；`independent copy (orig untouched): true`；TypedArray copy-constructor 是 ES2015 标准行为（lib.es5.d.ts `new (array: ArrayLike<number>): Uint8Array`） | 低 |
| TS declaration emit 剥离纯值导入（`node:crypto` 不进 plugin.d.ts specifier 面） | 源码引用/既有测试行为 | `registry-surface.test.ts:147-178` `reachableFrom` 只跟随相对 specifier（`if (!spec.startsWith('.')) continue`）——即使残留 `node:crypto` 声明也不入可达图审计；且值导入默认 elide（TS 标准行为） | 低 |
| `Number.prototype.toString(16).padStart(2,'0')` 恒产出 2 位小写 hex 段 | 设计期实测验证 | 同上实测：`hex len: 32`，`/^ns-[0-9a-f]{32}$/.test('ns-'+hex)` → `true`（0→'00'、255→'ff'） | 低 |

无其他协议级假设：本切片不新增端点、端口、进程生命周期或跨 job 资源假设。

---

## §10. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数/签名

| 契约 | 文件 | 改动前 | 改动后 |
|---|---|---|---|
| `createNamespaceRegistry(persistence, options)` | `src/registry.ts:1080` | options 缺 randomBytes 时正常构造 | **新增无条件 throw**：randomBytes 缺失/非函数 → 构造期同步 `TypeError`（§4.1.2） |
| `createNamespaceRegistryForTesting(persistence, overrides)` | `src/testing.ts:102` | 同上 | 同上（共用 createRegistryInternal 门禁） |
| `createRegistryInternal(persistence, options)` | `src/registry.ts:443` | 同上 | 同上（内部；testing.ts 与包内测试直驱） |
| `NamespaceRegistry.create(input)` | `src/types.ts:315` | 四键输入（含 namespaceId）合法 | 三键契约：namespaceId 键出现 → resolve `NAMESPACE_CREATE_INVALID_INPUT`；**结果通道不变**（领域 issue resolve / internal fatal reject） |
| `CreateNamespaceInput` | `src/types.ts:179` | 四键 | 三键（类型收窄） |
| `CreateNamespaceRegistryOptions` / `NamespaceRegistryTestingOverrides` | `src/types.ts:352` / `src/testing.ts:28` | — | 新增必需键 `randomBytes`（类型收窄） |
| `createDocument(factory, nsId, createdAt, schema, root)`（模块私有） | `src/create-document.ts:97` | 单入口 | 拆为 `prepareCreateDocument` + `buildInitialDocument`（唯一调用方 registry.ts 同步迁移） |

### Caller 清单（全部 caller 已 `git grep` 核实）

| Caller | 位置 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| Registry plugin apply | `src/plugin.ts:164`（`createNamespaceRegistry(...)`） | 否（同步构造） | ❌ 裸调用（apply 内 throw → cordis fiber 失败，响亮） | cordis plugin 加载失败通道 | **同切片修复**：补 `randomBytes: productionRandomBytes`（§4.1.3）——修复后永不 throw |
| SA6 红灯门禁用例 | `test/registry-phase5-identity-red.test.ts:287-288` | 否 | ✅ `expect(...).toThrow(TypeError)` | N/A | 期望 throw 本身即断言（绿） |
| 既有测试 ×11 文件 ~145 处 | `createNamespaceRegistryForTesting`（registry-create/open/idle/shutdown/node-dispose/persistence-contract/sa7-concurrency/sa7-hostile/sa7-rev1 等） | 是/否混合 | ✅ 测试断言 | vitest | **§7 迁移矩阵**：全部补 randomBytes（确定性计数源 helper） |
| 包内 closing fixture ×4 | `registry-create.test.ts:1709/1793/1862/1911`（`createRegistryInternal` 直驱） | 是 | ✅ | vitest | **删除**（死路径用例，§4.3.3） |
| `orchestrateCreate` → `admitCreateAttempt` → slot | registry.ts 内部 | 是 | slot 内逐段 catch（既有 §7 表映射） | carrier green tail | 同切片新建（§4.3.2/§4.3.3），异常路径全枚举 |
| `create(input)` 运行时调用方 | 生产：无（apps/ 空、domains 零引用、跨包仅注释级） | — | — | — | 无生产 caller 需迁移（§3.5 核实）；未来 caller 按新三键契约编码 |

**风险评估**：新 throw 仅在「缺必需 capability」时发生——生产唯一接线点（plugin）同切片补齐，
运行期不可达；测试面为机械迁移。create 结果通道（resolve issue / reject fatal）无新增 throw 路径
（fatal 仅在既有映射点 + 新生成阶段，均走 reject）。

---

## §11. 文件清单（File Scope）

### ALLOW LIST

- `packages/namespace-registry/src/types.ts` — 修改：`RegistryRandomBytes` 新类型 + 三个选项类型
  必需键 + `CreateNamespaceInput` 三键化 + phase/message 常量（约 ±40 行）
- `packages/namespace-registry/src/identity.ts` — 修改：key=namespaceId 派生、`validateOwnerIdentity`
  抽出、`acceptCreateIdentity` 重写（约 ±70 行）
- `packages/namespace-registry/src/registry.ts` — 修改：随机门禁、生成器、create 编排/attempt slot
  重写、runOpenSlot owner 谓词、runShutdown 编排等待、死代码删除（约 ±260 行）
- `packages/namespace-registry/src/create-document.ts` — 修改：prepare/build 拆分（约 ±60 行）
- `packages/namespace-registry/src/testing.ts` — 修改：overrides 必需 `randomBytes` 直通（约 +8 行）
- `packages/namespace-registry/src/plugin.ts` — 修改：node:crypto 生产随机源桥接 + 工厂调用补参
  （约 +18 行）
- `packages/namespace-registry/src/index.ts` — 修改：type 导出追加 `RegistryRandomBytes`（+1 行）
- `packages/namespace-registry/src/observer.ts` — 修改：union 追加 `create-id-generation-failed`
  事件形（约 +6 行）
- `packages/namespace-registry/test/registry-phase5-identity-red.test.ts` — `[SA6 owned]` 验收红灯
  测试：**§6 双修正（registryB 空剧本源 + :287-288 两行 `as never` cast）均已由 SA6 落盘**；
  SA3 不得改断言逻辑与该文件任何内容
- `packages/namespace-registry/test/registry-phase5-identity-surface.test-d.ts` — `[SA6 owned]` 类型面
  契约：SA3 零改动（实现即转绿）
- `packages/namespace-registry/test/registry-create.test.ts` — 修改：§7 迁移矩阵（三键化/随机注入/
  duplicate 重写/closing 死路径删除/文法用例改锚/**message 文本锚 :553/:958 同步新文案（R2）**）
- `packages/namespace-registry/test/registry-open.test.ts` — 修改：工厂调用补 randomBytes
- `packages/namespace-registry/test/registry-idle.test.ts` — 修改：工厂调用 + 3 处 duplicate 断言重写
  + **:761/:875/:1025 同 key 重建用例语义重写（R2，§7 idle 行）**
- `packages/namespace-registry/test/registry-plugin.test.ts` — 修改：**:180-183 / :504-507 两处 create
  输入三键化 + 产物 ID 断言改格式锚（R2 修正——原「零必改预期」表述错误，SA2 攻击 #2）**
- `packages/namespace-registry/test/registry-shutdown.test.ts` — 修改：工厂调用补 randomBytes
  （:351/:802 两处 create 输入豁免不动，理由见 §7 shutdown 行）
- `packages/namespace-registry/test/registry-node-dispose.test.ts` — 修改：工厂调用补 randomBytes
- `packages/namespace-registry/test/registry-persistence-contract.test.ts` — 修改：**:75-79 create 输入
  三键化 + 工厂调用补 randomBytes（R2 修正——原仅列「补 randomBytes」低估，SA2 攻击 #2）**
- `packages/namespace-registry/test/registry-sa7-concurrency.test.ts` — 修改：工厂调用 + hostile 输入期望
- `packages/namespace-registry/test/registry-sa7-hostile.test.ts` — 修改：同上 + **:481 四键 create 三键化（R2）**
- `packages/namespace-registry/test/registry-sa7-rev1.test.ts` — 修改：同上 + **:368 四键 create 三键化（R2）**
- `packages/namespace-registry/test/registry-sa7-cordis.test.ts` — 修改（**R2 修订追加，SA2 攻击 #2：
  R1 完全漏列该必改文件**）：:154 `CREATE_PAYLOAD` 三键化 + :179/:247 调用迁移 + 产物 ID 断言改
  格式锚（走 plugin 路径自供 node 随机源，无需注入）
- `docs/adr/0009-namespace-registry-leases-and-host-lifecycle.md` — 修改：追加 issue #131 修订节（§8）
- `docs/adr/0006-server-persistence-docstore.md` — 修改：追加 issue #131 对齐说明（§8）

### DENY LIST

- `packages/persistence/**` — AC-5 明令零改动（owner 分区/duplicate 信号/无 catalog 全保持）
- `packages/namespace-runtime/**`、`packages/doc-runtime/**` — Runtime 与文档构造契约零变化
- `packages/vfsl/**`、`packages/vfsl-protocol/**`、`packages/vfsl-codegen/**`、`packages/clock/**`、
  `packages/dsh-persistence/**` — 无关联
- `packages/namespace-registry/src/lease.ts`、`src/errors.ts` — 本切片零改动（phase 类型经 types.ts
  扩充；fatal 类结构不变）
- `packages/namespace-registry/test/registry-surface.test.ts` — 9/2 导出冻结 + 静态守卫的保持性锚，
  必须原样全绿（SA6 历史守卫，本任务无人应改它）
- `packages/namespace-registry/test/registry-entry-removal-guard.test.ts`、`test/helpers/registry-seam-audit.ts`
  — key 无关/扫描器，零改动
- `CONTEXT.md` — 已与 ADR 0010 词汇对齐（§8 核实），零改动
- `docs/adr/0001-0005、0007、0008、0010`、`docs/phases/**` — 裁决原文与计划文档，不改
- `apps/**`、`domains/**`、根 `package.json`/`vitest.config.ts`/各 tsconfig — 无生产消费者、无新
  依赖、无配置变化

---

## §12. 验证计划（SA3 实现后；R2 增命令 0/4 与 §12.3 回补锚登记）

### §12.1 命令

```bash
# 0.（R2，SA2 红线 1）类型轴回归门：SA3 实现后必须仅剩 surface.test-d.ts 三锚、零新增错误；
#    专门确认 red.test.ts:287-288 无 TS2345（§6 修正二的 cast 已落盘——修正前该文件即 2 处 TS2345）
npx tsc -p tsconfig.typecheck.json --noEmit
# 1. 红灯面转绿（§6 双修正均已落盘——绿判恒 15/15，无过渡条款）
pnpm vitest run packages/namespace-registry/test/registry-phase5-identity-red.test.ts
pnpm vitest run --typecheck packages/namespace-registry/test/registry-phase5-identity-surface.test-d.ts \
  packages/namespace-registry/test/registry-phase5-identity-red.test.ts
#    （命令 1 第二条 --typecheck 段必须报 0 unhandled source errors + 15/15 + 3 类型锚绿）
# 2. 整包（既有 12 文件迁移后全绿；surface 9/2 冻结保持）
pnpm vitest run packages/namespace-registry/test
# 3. 全仓门禁
pnpm test
pnpm typecheck
git diff --check
# 4.（R2，SA2 红线 3）迁移完整性 grep 门：剩余命中仅允许出现在 open 调用、期望对象、
#    keyDigest 断言与豁免说明处——create 输入对象内零残留（重点核 sa7-cordis/plugin/persistence-contract）
grep -rn "namespaceId:" packages/namespace-registry/test/*.test.ts
```

### §12.2 绿判标准

15 运行时用例 + 3 类型锚转绿、**0 unhandled source errors**、2 保持性守卫持续绿、既有测试迁移后
全绿（迁移后总用例数只增不减）、export 冻结面 9/2 不变、命令 0/4 零违规。

### §12.3（R2，D-13）零锚机制回补——SA6 回补锚请求 + SA4 Phase-3 验证登记

三个设计机制此前**没有任何红灯锚**（SA2 攻击 #3：「设计声称、测试不见证」）。裁决：**全部三条
向 SA6 提回补锚**（均为可观察运行时行为、现有 scripted 源 + fake scheduler 基建可低成本表达，
归 SA6 锚定职权），并同时登记为 SA4 Phase-3 验证项（SA4 静态评审时核对锚已存在且断言与设计
一致）。SA6 回补落位前，SA3 绿判不含此三条（它们不是 AC-1..AC-7 验收面）；落位后并入命令 2。

**锚 A（D-9：shutdown × 在途重试 interleaving）**
- 布置：scripted 源剧本 [X, X, Y]；create#1 建立并 settle（entry X active）；发起 create#2（不
  await）——其首选候选 X 撞 entry、重试候选 Y 的 attempt 用 deferred gate 停在 `createDoc`
  await 中（确定性制造「重试在途」窗口）；此时调用 `shutdown()`；释放 gate。
- 断言：shutdown Promise 的 settle **晚于** create#2 终局（§4.6 屏障：admittedCreates 等待晚建
  carrier）；X/Y 两个 Runtime 各恰关闭一次（`closed` 按 ID 计数恰 1）；`getStatus()` ===
  `{state:'stopped'}`；零 unhandled rejection。

**锚 B（D-3：随机源运行期违约 → 立即 fatal、零重试消耗）**
- B1（throw 型）：注入源直接 throw → create reject `NamespaceRegistryFatalError`
  （operation='create'、phase='namespace-id-generation' ∉ 旧三、committed=false、cause 为原异常）；
  零 Persistence 调用；observer 恰一次 `create-id-generation-failed`。
- B2（形状违约型）：注入源返回 15 字节 `Uint8Array` → 同 B1 全部断言 + `consumed === 1`（恰一次
  生成、**零重试预算消耗**）+ `persistence.createCalls === []`。（非 Uint8Array 返回值同构，SA6
  可并案。）

**锚 C（C-1 推论 1：同候选并发排他）**
- 布置：同一 registry、`Promise.all` 并发两个 create，共享注入源剧本 [X, X, Y]——两调用的同步
  接纳段先后消耗 X、X（同候选），create#1 的 attempt 先入 carrier X 并登记 entry，create#2 的
  X-attempt 经同 carrier FIFO 排队后命中 ① 碰撞 → 重生成 Y 成功。
- 断言：两 lease 的 namespaceId 恰为 {X, Y}；`constructed` 按 ID 各恰 1（**绝不出现第二个 X
  Runtime**）；`createDoc` 恰 [X, Y] 两笔；零 fatal。锁定「carrier FIFO 结构性排他」不被未来回归
  侵蚀。

**SA4 Phase-3 验证登记（同表双登记）**：SA4 静态评审除 §10 caller 审计比对外，加验——锚 A/B/C
已由 SA6 落盘且断言面与 §4.6/§4.2/§4.3.4 一致；`MAX_NAMESPACE_ID_RETRIES` 常量为 8（总生成 ≤ 9）；
`admittedCreates` 的 add/delete 闭环（finally）；observer 新事件仅在 §4.3.5 三处发射。

---

## §13. 风险与显式非目标

| 风险/边界 | 处置 |
|---|---|
| 重试跨 carrier 再接纳 vs shutdown 结算屏障 | §4.6 admittedCreates 等待集（结构性关闭窗口）；**锚 A 见证（§12.3）** |
| 敌意/脚本随机源使两 create 同候选 | C-1 推论 1：carrier FIFO 串行化，后者必然碰撞重生成；**锚 C 见证（§12.3）** |
| 随机源 throw / 返回形状违约 | §4.2 立即 fatal（不耗预算）；**锚 B 见证（§12.3）** |
| 随机源返回复用/退化字节（非 throw） | 形状守卫只查 16 字节 Uint8Array；**值质量不可检**（CSPRNG 契约由注入方负责——文档明示；拒绝在核心做统计检测的伪安全） |
| 逐次碰撞重试的 observer 可观测性 | 非目标（敌意才可达）；仅 fatal 发 `create-id-generation-failed` |
| `NAMESPACE_ALREADY_EXISTS` 类型保留但运行时不可达 | §4.7 裁决（切片 2 受信任导入复用；文档修订节明示） |
| node:crypto 使 plugin Node-only | file.ts node:fs 先例 + 注入 seam 保持 Host 无关；未来可无损抽服务 |
| 旧格式 namespaceId 兼容 | open 文法零改动（§4.8） |
| 红灯面 fixture × 契约互斥（运行时轴 + 类型轴） | §6 双修正记录——两处均已由 SA6 落盘（R2 复核证据在内），绿判恒 15/15 + 0 unhandled source errors |

---

## §14. SA2 反馈逐条回应（R2 修订汇总）

**评审来源**：`wiki/raw/task_phase5-namespaceid-registry-identity_sa2_review.md`（verdict: reject，
攻击 #1–#4）。SA2「架构内核先行声明」确认成立、R2 未回退 §4 任何机制；修订面全部为验收面/文件
范围/锚覆盖登记。

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| #1 CRITICAL：§6 扩为第二项必需修正（类型轴）——red.test.ts:287-288 无 cast 直呼 × 必需键类型锚 → 实现后 TS2345 → `--typecheck` unhandled source errors → §12 绿判不可达；按 registry-create.test.ts:1294 先例补 2 行 cast；同步更新 §12/§11 | ✅ | §6 修正二（新增小节，含矛盾原理/先例/2 行 cast/落盘证据）、§12.1 命令 0 + 命令 1 注释、§11 red.test.ts 行、§12.2 绿判加「0 unhandled source errors」、§5.1 AC-5 行 | SA6 已落盘（R2 复核：:283-288 含双 `as never` cast + 成因注释）；设计记录契约原理与回归门（tsc --noEmit 零新增错误），并明示 SA3 不得以改测试消类型错 |
| #2 HIGH：修 §7/§11——sa7-cordis（:154/:179/:247）漏列必改须补入 ALLOW；plugin（:180/:504）与 persistence-contract（:75）必须三键化（原标注低估）；2 处旧 message 文本锚同步；shutdown 四键 create 豁免理由明示 | ✅ | §7 sa7-cordis 行（必改+迁移内容）、§7 plugin 行、§7 persistence-contract 行、§7 registry-create 行 (8)、§7 shutdown 行（:351/:802 豁免理由）、§11 ALLOW（sa7-cordis R2 追加；plugin/persistence-contract/idle/sa7-hostile/sa7-rev1 行 R2 修正） | 全部 create 调用点普查（33 处清单）入 §7 引言；message 文本锚定位 :553/:958；豁免理由 = 停接纳检查先于输入访问、四键字面量永不被校验 |
| #3 MEDIUM：D-9/D-3/C-1 三机制零红灯锚——二选一（SA6 回补锚 或 §12 登记 SA4 验证项），不得静默留空 | ✅（取最强项并双登记） | §2 D-13、§12.3（新增小节：锚 A/B/C 完整用例规格 + SA4 Phase-3 验证登记）、§13 三行补「锚见证」 | 裁决：三条**全部**向 SA6 提回补锚（主——均为可观察运行时行为、现有基建可表达），同时登记 SA4 Phase-3 核对项（副）；并明确 SA6 落位前不阻塞 SA3 绿判（非 AC 验收面） |
| #4 LOW：删除/更新 §6 已过时过渡条款（registryB 修正已落盘，绿判直接 15/15） | ✅ | §6 开篇（「两处均已落盘，绿判恒以 15/15 + 零 unhandled source errors 为准；R1 过渡条款废止」）、§12.1 命令 1 注释、§13 末行 | 过渡条款整体移除，改为落盘证据记录；§5.1 AC-5 行同步去除依赖注 |

**R2 一致性自检**（SKILL 修订协议）：关键术语全文比对——`as never`（§6/§11/§14 一致，仅门禁
两行 + 既有测试先例）；「15/15」（§6/§12.1/§12.2/§14 一致，14/15 仅存于 §6 废止声明、无生效
条款残留）；sa7-cordis（§7 必改 ↔ §11 ALLOW 追加 ↔ §14 回应一致）；message 文本锚（§7
registry-create (8) ↔ §11 registry-create 行一致）；锚 A/B/C（§12.3 ↔ §13 见证列 ↔ §14 #3
一致）。§4 架构内核零改动（SA2 先行声明禁止回退项全部原样保留）。
