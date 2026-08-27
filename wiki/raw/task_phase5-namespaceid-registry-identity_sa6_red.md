# SA6 红灯锚定记录 — Phase 5: generate namespaceId and migrate Registry identity

- **Issue**: #131（welltop-jim-wang/nomicore）
- **任务类型**: 功能开发（feature）
- **分支**: fix/issue-131-on-docs-phase-5-websocket-replication
- **Worktree**: /home/wangjian/nomicore-fix-issue-131
- **阶段**: 第一阶段 验收锚定（AC-1..AC-7 → 红灯验收测试）
- **日期**: 2026-08-27（run_id issue-131-1787792522-3529662, round 1）

## 结论摘要

基线实现 = `(owner.userId, namespaceId)` 复合 Registry entry key + `create` 接受调用方
namespaceId（`CreateNamespaceInput` 恒四键）。SA6 编写 2 个验收测试文件（15 条运行时
行为用例 + 5 条类型面契约），**全部 18 条红灯锚在基线上真实失败**（15/15 运行时红、
3/5 类型红——另 2 条为保持性守卫、基线即绿）；现有全套既有测试保持全绿（本次未触碰
任何 src/ 与既有测试文件）。测试全部锚定可观察运行时行为或模块/类型契约，**零源码
grep 断言**。

## 测试文件清单

| 文件 | 类型 | 用例数 | 基线状态 |
|---|---|---|---|
| `packages/namespace-registry/test/registry-phase5-identity-red.test.ts` | 运行时行为（vitest） | 15 | 15/15 红 |
| `packages/namespace-registry/test/registry-phase5-identity-surface.test-d.ts` | 类型面契约（`pnpm test` 的 `--typecheck` 段） | 5 | 3 红 + 2 绿（保持性守卫） |

新增能力/依赖：无（未新增测试包、未新增端口依赖；`scripts/test-lock.sh` 无需更新）。
测试运行命令（标准链）：`pnpm test` / `pnpm vitest run packages/namespace-registry/test/...`。

## 契约锚点（SA6 锁定，SA1/SA3 需按此落位）

1. 注入的受控随机源 capability：`randomBytes(length: number): Uint8Array`，进入
   `CreateNamespaceRegistryOptions` 与 `NamespaceRegistryTestingOverrides`（均为类型面
   新增；主入口运行时 export 面与 testing subpath 值面**不得新增**——现有
   `registry-surface.test.ts` 冻结 9/2 export 值保持不变）。
2. 缺失随机源 → **构造期同步 TypeError**（生产工厂与 testing seam 皆然；ADR 0009 依赖
   纪律「缺失即响亮失败、禁 fallback 全局 crypto」）。
3. create 输入从四键（owner/namespaceId/schema/root）改为**恒三键**
   （owner/schema/root）；携带 namespaceId 的四键输入 → `NAMESPACE_CREATE_INVALID_INPUT`。
4. 生成 ID = `ns-` + 32 位小写 hex（128-bit = 16 字节），`^ns-[0-9a-f]{32}$`；
   idempotent 生成仅幸福路径恰 1 次。
5. 碰撞（active/idle/closing entry 或 target-owner Persistence duplicate）→ 重生成
   重试；「至多 8 次重试」读法宽容区间：总生成次数 ∈ [9,10]（首生成 + 8 重试 ±1 两种
   ADR 读法均收编）；耗尽 → reject `NamespaceRegistryFatalError`
   （code/operation='create'/committed=false/phase 为 ADR 0009 初始三 phase **之外**的
   新注册 phase——命名属 SA1 职权，SA6 仅锚定「非旧 phase」）。
6. entry 索引与 Runtime 复用仅按 namespaceId；同 namespaceId 第二 owner 的
   open → `NAMESPACE_NOT_FOUND`，且零 loadDoc、零新 Runtime、绝不构造第二 Runtime。
7. create/open 仍校验并投影 owner（非法 owner.userId → `NAMESPACE_INVALID_IDENTITY`、
   field='owner.userId'；lease.owner === 输入 owner）。
8. Persistence 继续按 owner 分区：`createDoc(owner, 生成ID, doc)`；同分区可恢复、
   跨分区 NOT_FOUND；Persistence 公共面无 list/listNamespaces/catalog 成员（保持性）。

## AC → 测试用例映射

### AC-1 普通 create 由注入 128-bit CSPRNG 生成 `ns-`+32 小写 hex，拒收调用方 namespaceId

- [红] `registry-phase5-identity-red.test.ts > AC-1 … > 三键输入（owner/schema/root）成功：lease 投影生成 ID 与 owner，Persistence 按生成 ID 落盘，随机源恰取 128-bit 一次`
  （断言：ok；`lease.namespaceId === 'ns-'+32hex` 且匹配 `/^ns-[0-9a-f]{32}$/`；
  `lease.owner === {userId}`；randomBytes 恰调用 1 次；`createDoc(owner, 生成ID)`；
  Runtime 以生成 ID 构造。）
- [红] `AC-1 … > 调用方选定 namespaceId 的四键输入被拒绝（NAMESPACE_CREATE_INVALID_INPUT），零随机源消耗、零 Persistence`
- [红] `AC-1 … > 缺失受控随机源 → 构造期同步 TypeError（生产工厂与 testing seam 皆然，绝不 fallback 全局 crypto）`
- [红] `registry-phase5-identity-surface.test-d.ts > 类型面：受控随机源注入 … > CreateNamespaceRegistryOptions 暴露 randomBytes(length: number): Uint8Array`
- [红] `同左 > NamespaceRegistryTestingOverrides 暴露同款 randomBytes`
- [红] `registry-phase5-identity-surface.test-d.ts > 类型面：create 输入无调用方 namespaceId（AC-1） > CreateNamespaceInput 不得存在 namespaceId 键`

### AC-2 碰撞（active/idle/closing entry / target-owner Persistence duplicate）重试至多 8 次；耗尽 committed:false fatal

- [红] `AC-2 … > 与 active entry 碰撞 → 重生成新 ID 成功，Persistence 依次落两个 ID`
- [红] `AC-2 … > 与 idle entry 碰撞 → 重生成新 ID 成功（release 后 idle 保留态仍占用命名空间）`
- [红] `AC-2 … > 与 closing entry 碰撞 → 重生成新 ID 成功（close 在途不阻塞也不放行同 ID）`
  （经 fake scheduler advanceBy 到达 closing；随后 close 结算、entry 移除、open 重建
  generation 的全链断言。）
- [红] `AC-2 … > 与 target-owner Persistence duplicate 碰撞 → 重生成新 ID 成功（createDoc 抛 DOC_DUPLICATE 后换 ID）`
- [红] `AC-2 … > entry 碰撞重试至预算耗尽 → committed:false Registry fatal（新 phase、零重复落盘、无伪成功）`
  （断言：reject `NamespaceRegistryFatalError`；code/operation/committed:false；
  phase 非 ADR 0009 初始三 phase；总生成 ∈ [9,10]；重复 createDoc 零新增。）
- [红] `AC-2 … > Persistence duplicate 重试至预算耗尽 → 多次 createDoc 均 duplicate 后 committed:false fatal`
  （断言：reject fatal；committed:false；phase 非旧三；duplicate 尝试 ∈ [9,10]。）

### AC-3 Registry 生命周期串行与 Runtime 复用仅按 namespaceId

- [红] `AC-3/AC-4 … > 同 namespaceId 第二 owner open → NAMESPACE_NOT_FOUND，且零 loadDoc、零新 Runtime（复用前核对 owner）`
  （entry 命中后 owner 核对失败：`loadCalls === []`、Runtime 构造恰 1 个——复合 key
  基线会 loadDoc(B, nsId)。）
- [红] `AC-3/AC-4 … > owner mismatch 不暴露另一 owner 的持久化文档：即便 (ownerB, nsId) 分区已有文档，open 仍 NOT_FOUND`
  （基线在 (ownerB, nsId) 分区有文档时会成功暴露第二 Runtime——本用例红在结果面。）

### AC-4 open/create 仍校验并投影 owner；mismatch 返回既有 not-found 结果

- [红] `AC-3/AC-4 … > 同 namespaceId 第二 owner open → NAMESPACE_NOT_FOUND …`（同上，NOT_FOUND 面）
- [红] `AC-3/AC-4 … > create 仍校验 owner：非法 owner.userId → NAMESPACE_INVALID_IDENTITY（field=owner.userId，零生成、零 Persistence）`
  （基线 field='namespaceId'——红在判别字段。）
- lease.owner 投影断言内含于 AC-1 首用例。

### AC-5 Persistence 继续按 owner 分区，无跨 owner catalog

- [红] `AC-5 … > create 将生成 ID 写入 (owner, nsId) 分区；全新 Registry 可同分区 open 恢复，跨 owner 得 NOT_FOUND`
  （全链：createDoc(owner, 生成ID) → 新 Registry 实例同分区 open 恢复 ok → 跨 owner
  NOT_FOUND → 全链 createDoc 均落 A 分区。）
- [绿·守卫] `registry-phase5-identity-surface.test-d.ts > 类型面：Persistence 不新增跨 owner catalog（AC-5 保持性守卫） > DocPersistence 无 listNamespaces/listDocs/catalog 成员`

### AC-6 测试覆盖（生成、重试耗尽、owner mismatch、并发、shutdown、公共面兼容）

- [红] `AC-6 … > 两个并发普通 create：各自生成唯一 ID、并行落盘、双 lease 独立`
- [红] `AC-6 … > shutdown 关闭全部已创建 Runtime 恰一次并到达 stopped`
- 类型面：`registry-phase5-identity-surface.test-d.ts`（公共面兼容锚）。

### AC-7 ADR 0006/0009 面向实现的文档与 package contracts 与 ADR 0010 词汇对齐

- 包契约（类型面）锚点：`CreateNamespaceInput` 无 namespaceId、options/testing
  overrides 有 randomBytes、Persistence 无 catalog API（见上）；运行时契约锚点即
  本表全部行为用例。文档内容对齐（CONTEXT.md/ADR 文本）属 SA1/SA3 交付面，非可观测
  运行时契约，SA6 以包契约类型面 + 运行时行为面代锚。

## 红灯运行证据摘要

基线（当前 HEAD `980b16a docs: specify instance replication protocol v1`，
`pnpm test`）：**全绿**（约 150+ 既有用例 + 全部类型守卫通过）。

锚定后实测（三条命令，均为独立进程）：

1. `pnpm vitest run packages/namespace-registry/test/registry-phase5-identity-red.test.ts`
   → **exit 1；15/15 失败**（0 通过）。失败签名四类：
   - 11 例：`期望成功（生成 ID），实际：{"ok":false,"code":"NAMESPACE_INVALID_IDENTITY","field":"namespaceId",…}`——三键新输入被基线拒绝；
   - 1 例：`期望窄 issue，实际：{"ok":true,"lease":{…,"namespaceId":"ns-caller-selected"}}`——四键旧输入被基线接受；
   - 1 例：`expected function to throw an error, but it didn't`——缺失随机源构造门禁不存在；
   - 1 例：`expected null to be an instance of NamespaceRegistryFatalError`——耗尽 fatal 不存在；
   - 1 例：`expected 'namespaceId' to be 'owner.userId'`——create owner 校验缺判别面。
2. `pnpm vitest run --typecheck packages/namespace-registry/test/registry-phase5-identity-surface.test-d.ts packages/namespace-registry/test/registry-phase5-identity-red.test.ts`
   → **exit 1；18 失败 | 2 通过；Type Errors 3 failed；0 unhandled source errors**。
   类型红签名：`Type 'true' is not assignable to type 'never'` × 3
   （CreateNamespaceInput 仍有 namespaceId；两个选项类型面均无 randomBytes）。
3. `pnpm vitest run packages/namespace-registry/test`（整目录，无 typecheck）
   → 既有 12 个测试文件全部 ✓（registry-surface 12、registry-create 50、registry-open 32、
   registry-idle 18、registry-plugin 9、registry-sa7-* 20、registry-persistence-contract 2 等）；
   仅新文件红（15/15）。

**门禁结论**：红灯真实、可稳定复现——当前实现确实仍为复合 key + 调用方 namespaceId
契约，与 AC-1..AC-7 不符；不存在「绿灯假红」或无法复现情形，流水线可继续进入
SA1 设计 / SA3 实现。

## SA3 实现后的绿判标准（供复核）

- 15 条运行时用例全部转绿：三键 create 成功生成 `ns-`+32hex、四键输入被拒、缺失随机源
  构造 TypeError、三类 entry 碰撞 + Persistence duplicate 重生成、两类耗尽
  committed:false fatal（新 phase）、owner mismatch NOT_FOUND 零暴露、owner 校验
  field 正确、owner 分区全链、并发双 create、shutdown 恰一次关闭。
- 3 条类型锚转绿：`CreateNamespaceInput` 无 namespaceId；两选项类型面含
  `randomBytes(length: number): Uint8Array`。
- 2 条保持性守卫持续绿：三键形状仍在；`DocPersistence` 无 catalog API。
- 既有测试（含 `registry-surface.test.ts` 的 9/2 export 冻结面）保持全绿。

## 修订记录（回流修订，2026-08-27）

**SA1 设计 §6 发现的锚定内部矛盾（确认为 fixture 遗漏）**：AC-5 用例中 `registryB`
原以 `makeRegistry(persistence, { factory })` 构造——未注入 `randomBytes`，与 AC-1
「缺 randomBytes → 构造期 TypeError」门禁自相矛盾（registryB 只做 open、永不消耗随机
源，但 SA3 实现门禁后该构造会直接 throw，导致原本干净的 AC-5 用例在实现期报错）。

**修正**（仅 `registry-phase5-identity-red.test.ts` 一处一行 + 注释）：

```ts
// 全新实例（同 Persistence，零内存 entry）：同分区恢复。
// 构造门禁契约（AC-1：缺 randomBytes → 构造期 TypeError）对任何实例均适用，
// 故 registryB 亦注入受控随机源（仅 open、永不消耗——空剧本即验证零消耗）。
const registryB = makeRegistry(persistence, {
  factory,
  randomBytes: makeScriptedRandomBytes([]).randomBytes,
});
```

- AC-1 门禁用例（「缺失受控随机源 → 构造期同步 TypeError」）**未改动**；
- registryB 注入空剧本随机源：`makeScriptedRandomBytes([]).randomBytes`——空剧本在
  任何调用时即 throw，等价于「构造合法 + 一旦被消耗即失败」的严格契约；该用例零消耗
  断言面（正常路径）保持不变。

**修正后复跑验证**（`pnpm vitest run packages/namespace-registry/test/registry-phase5-identity-red.test.ts`，
独立进程，exit 1）：

- **15/15 失败（与修正前一致）**——其余 14 例保持红；AC-5 用例仍为红，失败点不变
  （registryA 三键 create 被基线以 `NAMESPACE_INVALID_IDENTITY` 拒绝，
  `期望成功（生成 ID），实际：{"ok":false,"code":"NAMESPACE_INVALID_IDENTITY","field":"namespaceId",…}`）
  ——Persistence 分区行为断言链未被 fixture 修正扰动，SA3 实现后仍按原契约转绿。

## 修订记录 R2（回流修订，2026-08-27）

**SA2 R1 CRITICAL（类型轴矛盾）**：AC-1 门禁用例（`registry-phase5-identity-red.test.ts`
287-288 行）以无 cast 字面量直呼 `createNamespaceRegistry(persistence, { clock, scheduler })`
与 `createNamespaceRegistryForTesting(persistence, { clock, scheduler })` 断言「缺
randomBytes → 构造期 TypeError」。但类型锚（surface.test-d.ts）要求 randomBytes 为
**必需键**，SA3 落地后这两行 options 字面量缺必填键 → **TS2345**；本文件在
`tsconfig.typecheck.json` 程序内（`packages/*/test/**/*.ts`），vitest `--typecheck`
会把该错误计为 **unhandled source errors**——类型轴噪声污染红灯信号。

**修正**（仅 `registry-phase5-identity-red.test.ts` 两处调用，`as never` cast，
照 `registry-create.test.ts:1294` 既有先例）：

```ts
// as never（registry-create.test.ts:1294 既有先例）：类型锚要求 randomBytes 为
// 必需键，无 cast 字面量在 SA3 落地后会产生 TS2345（本文件在 typecheck 程序内）；
// cast 仅为类型面消除——运行时仍按原样传入缺随机源的 options，构造必须同步 throw。
expect(() => createNamespaceRegistry(persistence, { clock, scheduler } as never)).toThrow(TypeError);
expect(() => createNamespaceRegistryForTesting(persistence, { clock, scheduler } as never)).toThrow(TypeError);
```

- 断言语义不变：`as never` 是纯类型面消除（类型断言不改变运行时对象），两个工厂
  运行时仍收到缺随机源的真实 options 对象，构造期必须同步 throw TypeError；
- 其余用例零改动。

**修正后复跑验证**（独立进程）：

1. `pnpm vitest run packages/namespace-registry/test/registry-phase5-identity-red.test.ts`
   → **exit 1，15/15 失败（与修正前一致）**；门禁用例失败签名不变
   （`expected function to throw an error, but it didn't`——cast 未改变运行时路径）。
2. `pnpm vitest run --typecheck <两个新文件>` → **exit 1，18 失败 | 2 通过，
   Type Errors 3 failed，0 unhandled source errors**——类型轴仅保留 3 条预期类型红
   （CreateNamespaceInput 仍含 namespaceId；两选项类型面无 randomBytes），无新增
   TS2345/unhandled 噪声。

## 修订记录 R3（设计 §12.3 回补锚，2026-08-27）

**来源**：设计 `task_phase5-namespaceid-registry-identity_design.md` §12.3（D-13 / SA2
攻击 #3「设计声称、测试不见证」）——D-9 shutdown×在途重试、D-3 随机源运行期违约、
C-1 推论 1 同候选并发三机制此前零红灯锚；本次按设计完整用例规格回补，均基于现有
scripted 随机源 / fake scheduler / fake runtime 基建确定性表达。

**新增用例**（`registry-phase5-identity-red.test.ts`，全部在基线下为红——与 AC 套件
同款红灯机制：三键 create 被基线以 `NAMESPACE_INVALID_IDENTITY` 拒绝 / 无 fatal）：

1. **锚 A（D-9 shutdown × 在途重试 interleaving 结算屏障）**：剧本 [X, X, Y]；
   create#1 settle（entry X active）；create#2 首选候选 X 撞 entry、重试候选 Y 的
   createDoc 以 `persistence.gateCreate(Y_ID)` deferred gate 停在在途（确定性「重试在途」
   窗口）；此后 `shutdown()`；释放 gate。断言：shutdown settle 晚于 create#2 终局
   （`order === ['create2','shutdown']`，§4.6 屏障）、create#2 成功得 Y（不被击穿）、
   X/Y 各恰关闭一次、`getStatus()` === `{state:'stopped'}`、零 unhandled rejection
   （显式 `collectUnhandledRejections` 探针，registry-idle.test.ts 先例）。
   基建增量：`Phase5StubPersistence.gateCreate(docId)`（duplicate 检查后 await gate）；
   `deferred()` 与 `collectUnhandledRejections()` helper。
2. **锚 B（D-3 随机源运行期形状违约 → 立即 fatal、零重试预算消耗）**，三变体共用
   `expectGenerationFatal` 公共断言面（reject `NamespaceRegistryFatalError`：
   code/operation='create'/**phase='namespace-id-generation'**（§12.3 命名，∉ 旧三）/
   committed=false；零 Persistence 调用；observer **恰一次** `create-id-generation-failed`；
   可选 cause exact identity 与生成次数断言）：
   - B1 源直接 throw：+ cause 为原异常（exact identity）；
   - B2 源返回 15 字节 Uint8Array：+ 恰一次生成（`calls === 1`，零重试预算消耗）；
   - B3 源返回非 Uint8Array（普通对象）：同 B1 全断言 + 恰一次生成（并案）。
3. **锚 C（C-1 推论 1 同候选并发排他）**：同一 registry、`Promise.all` 并发两 create、
   共享剧本 [X, X, Y]（两调用同步接纳段先后消耗 X、X 同候选；create#1 先入 carrier X
   登记 entry，create#2 的 X-attempt 经同 carrier FIFO 排队后命中碰撞 → 重生成 Y）。
   断言：两 lease 的 namespaceId 恰为 {X, Y}；`constructed` 按 ID **各恰 1**（绝不出现
   第二个 X Runtime）；`createDoc` 恰 [X, Y] 两笔（FIFO 次序）；零 fatal。

**复跑验证**（独立进程，无回归）：

1. `pnpm vitest run packages/namespace-registry/test/registry-phase5-identity-red.test.ts`
   → **exit 1，20/20 失败**——15 条既有 AC 用例保持红（零回归、零转绿），新增 5 条锚
   用例全部红（锚 A/锚 C 因三键 create 被拒；锚 B 因 `expected null to be an instance
   of NamespaceRegistryFatalError`——基线无该 fatal）。无超时、无挂起（锚 A 的 gated
   重试窗口全程确定性 settle）。
2. `pnpm vitest run --typecheck <两个新文件>` → **exit 1，23 失败 | 2 通过，
   Type Errors 3 failed，0 unhandled source errors**——类型轴无新增噪声。

**SA3 绿判补充**（锚 A/B/C 落位后并入设计 §12「命令 2」）：锚 A 见证 shutdown 结算屏障
与重试跨 carrier 再接纳（§4.6 admittedCreates 等待集）；锚 B 见证 §4.2 生成违约立即
fatal（phase='namespace-id-generation'、不耗重试预算、observer 恰一次）；锚 C 见证
§4.3.4 carrier FIFO 结构性排他。SA4 Phase-3 按 §12.3 同表双登记核对本三锚已落盘。
