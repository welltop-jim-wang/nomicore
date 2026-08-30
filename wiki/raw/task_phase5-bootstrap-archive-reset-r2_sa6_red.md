# SA6 红灯锚定报告（round=2）— issue #133「Phase 5: bootstrap import, archive, and guarded replica reset」反馈 1/2 验收锚定

- **基线 HEAD**：6784645（round-1 close-out；SA3 已落地 round-1 全部 52 红用例 → 全绿）
- **分支 / Worktree**：fix/issue-133-on-docs-phase-5-websocket-replication ／ `/home/wangjian/nomicore-fix-issue-133`
- **流水线 slug**：`phase5-bootstrap-archive-reset-r2`（本文 = `task_phase5-bootstrap-archive-reset-r2_sa6_red.md`）
- **锚定范围**：owner review 反馈 1（reset 前置身份核对 + 竞态）与反馈 2（import 绑定 Hub 广告身份）→ 任务简报 R2-AC-1..R2-AC-4（行为类 AC）
- **前置门禁**：SA8 conflict report（relevancy clear；相关决议见 `…r2_relevant_decisions.md`）

## 1. 基线结论（round-1 已实现面 vs round-2 行为缺口）

round-1 已交付：`importReplica(owner, namespaceId, doc)` / `resetReplica(owner, namespaceId, expectedLocalIdentity)` / `importDoc` / `archiveDoc`（守卫在持久层、close **之后**执行）。round-2 反馈要求的**行为变更**在基线 HEAD 上**全部缺席**：

| round-2 要求 | 基线 HEAD 事实 | 红灯机制 |
|---|---|---|
| R2-AC-1：reset 在任何破坏性动作（forceRelease/close/archive）**之前**核对 live/persisted 身份；不匹配 → 拒绝 + **零破坏**（原 lease/runtime 保持可用） | `runResetSlot`（registry.ts:1468-1577）：① owner → capability gate → ② forceRelease + close → ③ loadDoc 探针 → ④ archiveDoc（身份守卫在持久层、close 之后）。不匹配时 generation **已**被关闭 | 零破坏断言全红：`lease:'released'`（已 forceRelease）、runtime 已 close、archiveDoc 已被触达 |
| R2-AC-2：dirty identity/epoch（bump 后未 flush、persisted 仍旧）竞态下不得关闭/归档错误 generation | 无任何竞态面：close 先行 ⟹ 旧身份期望（=persisted）的 reset 直接把 live（新身份）generation 关闭；守卫读的是 settle 排空后的字节（=live 新态）⟹ 错误 generation 被关闭 | 竞态 A：`lease:'released'` 红；竞态 B：当前实现直接 `ok:true`（close→drain→守卫放行→归档）红 |
| R2-AC-3/4：import 在 ownership 转移（importDoc resolve）前校验 META 复制事实与 Hub 广告 expected `{replicationId, replicationEpoch}` **完全一致**；格式正确但 lineage/epoch 不符 → 拒绝 + **零持久化写入、零 entry 登记** | `importReplica(owner, namespaceId, doc)` **无 expected 参数**；`runImportSlot`（registry.ts:1362-1441）②b 只做格式/在场性守卫，从未与外部广告身份比对 ⟹ 格式合规文档一律导入成功 | 拒绝码/零写入/零 entry 断言全红：`ok:true`（当前实现接受并登记） |

**红/绿标注（任务要求）**：本批 9 个红用例全部为**真红**（当前实现确实违反行为契约，非特征缺失红——round-1 的实现已存在，红在**新行为契约**上）；3 个守卫用例为**守卫绿**（当前已满足、预期保持绿，见 §5）。

## 2. 交付物清单（2 个新测试文件 + 本报告；零 src/既有测试改动）

| 文件 | 用例数 | 基线红 | 基线绿 | 说明 |
|---|---|---|---|---|
| `packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-red.test.ts` | 10（8 红 + 2 守卫绿） | 8 | 2 | R2-AC-1/2/3/4 运行时锚（stub 编排观测 + 真实 MemoryPersistence 竞态/零写入） |
| `packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-surface.test-d.ts` | 2 类型锚（1 红 + 1 守卫绿） | 1 | 1 | importReplica 第 4 参数类型锚（红）+ resetReplica 三参数签名保持（绿） |
| `wiki/raw/task_phase5-bootstrap-archive-reset-r2_sa6_red.md` | 本报告 | — | — | |

`git status --short` 实证：仅上述 2 个新测试文件（untracked）+ 流水线既有 wiki 文件；`git diff --check` 干净；零 `src/` 改动、零既有测试文件改动。

## 3. AC → 用例映射表

| AC | 用例（文件 = REG-R2） | 断言锚 |
|---|---|---|
| R2-AC-1 reset 前置身份核对（破坏性动作之前，零破坏） | REG-R2「replicationId 不匹配 → NAMESPACE_RESET_IDENTITY_MISMATCH + 零破坏」；「同 id 不同 epoch → 同上」；「live 无复制身份（disabled）→ 同上」 | 拒绝码 + **原 lease 仍 active、runtime lifecycle 仍 ready、replication 投影原样（live 身份未扰动）、原 lease 读路径可用（read n → 5）、`archiveCalls === []`（归档 seam 零触达）、loadDoc 非 null** |
| R2-AC-2 dirty 竞态（真实 Memory，两向） | REG-R2「竞态 A：expected = persisted 旧身份（ID_A/1），live 已 bump 至 epoch 2 未 flush → 拒绝 + 零破坏 + 无强制 flush」；「竞态 B：expected = live 新身份（ID_A/2），persisted 仍旧 → 拒绝 + 零破坏 + 无强制 flush（严格口径，见 §8 flag 1）」 | 拒绝码 + 原 lease active + runtime ready（**epoch 2 的 live generation 未被关闭/归档**）+ read 可用 + `store.has(primaryKey) === true` + **持久化字节原样 = epoch 1（拒绝路径零副作用、不排空 dirty、不强制 flush）** |
| R2-AC-3 import 接收/绑定 Hub 广告 expected；ownership 转移前校验完全一致 | REG-R2「META 格式正确但 replicationId ≠ expected → 拒绝 + 零持久化写入 + 零 entry 登记」；「格式正确但 replicationEpoch ≠ expected → 同上」；「真实 Memory：拒绝 → store 零残留 + 零 entry；随后正确 expected 重试成功（key 未被毒化）」 | 拒绝码（临时拼写 `NAMESPACE_IMPORT_EXPECTED_IDENTITY_MISMATCH`，见 §7）+ `importCalls === []`（persistence 导入 seam 零触达）+ store 零残留 + `loadDoc === null` + `open → NAMESPACE_NOT_FOUND`（零 entry，与 open 同款零泄露）+ 重试导入成功（排他创建、身份/内容原样） |
| R2-AC-4 拒绝测试（格式正确但身份不符的两分支） | 同上三用例（lineage 分支 + epoch 分支 + 真实持久化 store 零残留） | 与 R2-AC-3 同一断言面 |

## 4. 红灯证据（全部亲跑；命令一律 setsid nohup 后台独立进程）

### 4.1 新红文件单独跑（`npx vitest run packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-red.test.ts`）

```text
Test Files  1 failed (1)
     Tests  8 failed | 2 passed (10)
Type Errors  no errors
Duration  697ms
```

逐用例失败形态（第一个失败断言 = 真红锚位）：

| 用例 | 失败断言（vitest 输出） | 红点 |
|---|---|---|
| R2-AC-1 replicationId 不匹配 | `AssertionError: expected 'released' to be 'active'` | 零破坏：原 lease 已被 forceRelease（generation 已破坏）|
| R2-AC-1 同 id 不同 epoch | `expected 'released' to be 'active'` | 同上 |
| R2-AC-1 live disabled | `expected 'released' to be 'active'` | 同上 |
| R2-AC-2 竞态 A（expected=persisted 旧） | `expected 'released' to be 'active'` | live（epoch 2）generation 被关闭——错误 generation |
| R2-AC-2 竞态 B（expected=live 新，strict） | `期望领域拒绝，实际：{"ok":true}` | 当前实现 close→drain→守卫放行→归档 **成功**——persisted ≠ expected 未被前置核对 |
| R2-AC-3/4 lineage 不符 | `期望领域拒绝，实际：{"ok":true,"lease":{…}}` | 第 4 参数被忽略，格式合规文档直接导入成功 |
| R2-AC-3/4 epoch 不符 | `期望领域拒绝，实际：{"ok":true,"lease":{…}}` | 同上 |
| R2-AC-3/4 真实 Memory 零写入 | `期望领域拒绝，实际：{"ok":true,"lease":{…}}` | 同上（store 已被写入、entry 已登记）|

**失败链完整性说明**（对 R2-AC-1/竞态 A 的后续断言——vitest 在首个断言处停止，按当前实现路径推证并在返回码上闭合）：
- R2-AC-1 三用例当前返回 `NAMESPACE_RESET_IDENTITY_MISMATCH`——该码**只能**来自 runResetSlot ④ 的 `DOC_ARCHIVE_IDENTITY_MISMATCH` 映射分支 ⟹ `archiveCalls` 必为长度 1（本锚断言 `[]` 必红）；且该映射发生在 archiveDoc **调用后** ⟹ close/forceRelease 确已先行（与 'released' 实测互为印证）。
- 竞态 A 当前返回 `NAMESPACE_RESET_IDENTITY_MISMATCH` ⟹ verify 在 settle 排空**之后**读到的是 post-flush 字节（epoch 2）——因为若未发生强制 flush，guard-read 必读旧字节（epoch 1 == expected）→ 归档应成功（ok:true）而实际拒绝 ⟹ **settle 强制 flush 已发生** ⟹ 「持久化字节原样 = epoch 1」断言必红（零副作用被破坏）。

### 4.2 类型面单独跑（`npx vitest run --typecheck packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-surface.test-d.ts`）

```text
Test Files  1 failed (1)
     Tests  1 failed | 1 passed (2)
Type Errors  1 failed
  × importReplica 声明面接收 expected {replicationId, replicationEpoch}（第 4 参数）
    → TypeCheckError: Type 'true' is not assignable to type 'never'  （:59 锚位）
  ✓ resetReplica 三参数形状不漂移（守卫绿）
```

### 4.3 全程序 typecheck（`npx tsc -p tsconfig.typecheck.json --noEmit`）

```text
恰 1 条错误：registry-phase5-bootstrap-reset-r2-surface.test-d.ts(59,11): error TS2322:
Type 'true' is not assignable to type 'never'   ← 唯一错误，位于红锚位；零噪音
```

（基线 round-1 的两个 surface 文件已全绿；本文件红锚采用 `Parameters<...>` 元组捕获——方法签名赋值式条件类型在 TS 参数数量逆变规则下会把 3 参数方法误判为满足 4 参数契约，故弃用，见文件头注释。）

### 4.4 全量套件（`npx vitest run`，含 typecheck 与全部新红文件）

```text
Test Files  2 failed | 142 passed (144)
     Tests  9 failed | 1714 passed (1723)
Type Errors  1 failed
```

- 唯一 2 个失败文件 = 本批 2 个新文件；既有 **142 个测试文件全绿**。
- **1714 passed = round-1 基线 1711 + 3 个新守卫绿**（2 运行时 + 1 类型）⟹ **既有 1711 用例零回归**；9 failed = 本批 8 运行时红 + 1 类型红。
- 红轨一致：`Type Errors no errors`（运行时红文件零类型错误）；3 个 r2 红运行时文件在 tsconfig.typecheck 程序内零噪音。

### 4.5 flake 检查（新红文件连跑 2 次 + 首次 = 共 3 次）

```text
RUN 1:  8 failed | 2 passed (10)
RUN 2:  8 failed | 2 passed (10)
RUN 3:  8 failed | 2 passed (10)
```

零 flake：计数与失败形态逐次一致。

## 5. 红/绿用例清单（真红 9 + 守卫绿 3 + 基线绿 1711）

**真红（9）**：
1. R2-AC-1 replicationId（lineage）不匹配 → NAMESPACE_RESET_IDENTITY_MISMATCH + 零破坏
2. R2-AC-1 同 id 不同 epoch → NAMESPACE_RESET_IDENTITY_MISMATCH + 零破坏
3. R2-AC-1 live 无复制身份（disabled）→ NAMESPACE_RESET_IDENTITY_MISMATCH + 零破坏
4. R2-AC-2 竞态 A（expected=persisted 旧、live 已 bump 未 flush）→ 拒绝 + 零破坏 + 无强制 flush
5. R2-AC-2 竞态 B（expected=live 新、persisted 旧）→ 拒绝 + 零破坏 + 无强制 flush（严格口径，§8 flag 1）
6. R2-AC-3/4 lineage ≠ Hub 广告 expected → NAMESPACE_IMPORT_EXPECTED_IDENTITY_MISMATCH + 零写入 + 零 entry
7. R2-AC-3/4 epoch ≠ Hub 广告 expected → 同上
8. R2-AC-3/4 真实 Memory 拒绝 → store 零残留 + 零 entry + 重试成功（key 未毒化）
9. 类型锚：importReplica 声明面接收 expected 身份（第 4 参数）

**守卫绿（3，基线已满足、预期保持绿）**：
1. `importReplica` 在 expected 与文档身份完全一致时导入成功（身份/内容原样）——防新增核对过度收窄；
2. 普通 create 随机生成纪律不变（`ns-`+32hex、owner 分区持久化）——防导入/重置路径扰动 create 接纳；
3. 类型守卫：`resetReplica(owner, namespaceId, expectedLocalIdentity)` 三参数公共签名不漂移（R2-AC-1 行为变更只发生在编排内部）。

**基线绿（1711）**：全量套件实测通过（§4.4），零回归。

## 6. 锚定纪律声明

- 运行时行为测试全部用**真实 yjs / 真实 Registry+Runtime / 真实 MemoryPersistence（hook store 字节级权威）**；stub 仅作 registry 编排面观测（`importCalls`/`archiveCalls`/归档内容——真实调用面）；fake scheduler 脚本化驱动（零 real sleep）。
- **零源码 grep 断言**：2 个文件不含任何 `readFileSync(src).toMatch` 类断言；模块纪律锚定均为行为侧或类型面负向守卫。
- 零 mock 本地服务：竞态与零写入断言全部经真实持久化面（store 字节 decode 验证身份值）。
- 类型面红锚经 `Parameters<...>` 元组捕获 + 约束（`T extends { readonly importReplica: (...args: never[]) => unknown }`）——全程序 tsc 仅 1 条错误且恰在锚位（§4.3）。

## 7. 临时契约清单（全部显式标记「临时，待 SA1 冻结」；沿 round-1 回流惯例）

| 临时项 | 测试侧形态 | 备注 |
|---|---|---|
| `importReplica(owner, namespaceId, doc, expectedReplicationIdentity)` | **round-2 临时签名**（第 4 参数 = Hub 广告 expected 身份） | 若 SA1 冻结为其它绑定机制（如 Registry 构造期绑定/独立 setter），本文件调用面回流校准；行为断言（拒绝码/零写入/零 entry）不变 |
| `NAMESPACE_IMPORT_EXPECTED_IDENTITY_MISMATCH` | 拒绝码（**round-2 临时拼写**） | 与 round-1 冻结的 `NAMESPACE_IMPORT_IDENTITY_MISMATCH`（= META.docId ≠ namespaceId）语义区分：本码特指「格式合规但与 Hub 广告身份不一致」；message 恒定、零身份/输入回显 |
| `NAMESPACE_RESET_IDENTITY_MISMATCH` | 拒绝码 | round-1 已冻结词汇，直接复用（零改名） |
| `ReplicationIdentityRef` 形状 | `{ replicationId; replicationEpoch }` | round-1 已冻结形状，沿用户 |
| 竞态核对口径（live vs persisted 判定规则） | 严格口径：live 与 persisted **均**与 expected 核对、任一不匹配即拒绝（R2-AC-1 原文直读） | **SA1 冻结时需确认的判定规则**（R2-AC-2 原文「判定规则写进设计」）——见 §8 flag 1 |

## 8. 回流点 / SA1 冻结挂点（沿 round-1 边缘提示体例）

**Flag 1（最关键）——r2 竞态 B 的核对口径**：本锚按 R2-AC-1 原文「先将 live/persisted replication identity 与 expectedLocalIdentity 做可靠核对；不匹配 → 领域拒绝」的**严格直读**为竞态 B 冻结「persisted ≠ expected → 前置拒绝 + 零破坏」（当前实现此场景 `ok:true` 成功，红）。若 SA1 冻结为「前置核对读 live（破坏前），持久层守卫读 settle 排空后的字节（既有 archiveDoc 机制）」的**排空后核对**口径，则竞态 B 在修复后应**成功**（close→drain→persisted 变新→守卫放行）——该用例需按 round-1 回流惯例改写为成功路径断言。**竞态 A 两种口径下均拒绝（live 核对必命中），无回流风险**。建议 SA1 冻结时明示「live vs persisted 的判定规则」并对照本锚落位。

**Flag 2——import 期望身份的落点**：本锚把期望身份校验放在 Registry `importReplica`（ownership 转移之前）——满足 R2-AC-3「在 persistence ownership 转移（importDoc resolve）之前校验」。若 SA1 决定把该校验同时下沉到 `importDoc` 下层 seam（新增 expected 参数与 persistence 侧拒绝分类），属增强（防御纵深），本锚不依赖；若 SA1 仅下沉不改 Registry 入口签名，Flag 2 的「第 4 参数」回流为构造期绑定/其它形态（见 §7 表）。

**Flag 3——修复期不得影响的既有绿**：全量套件已锁 baseline 1711；SA3 修复时上述 9 个红用例转绿 + 守卫绿/基线绿保持即满足 R2-AC-6。特别注意：reset 前置核对不得改变 round-1 成功路径（`reset → ok:true` 后在 open → NOT_FOUND、loadDoc → null、随后 import 成功）——该闭环由 round-1 `registry-phase5-bootstrap-reset-red.test.ts` 全部用例继续锁绿。

## 9. 交付物绝对路径

```text
/home/wangjian/nomicore-fix-issue-133/packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-red.test.ts
/home/wangjian/nomicore-fix-issue-133/packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-surface.test-d.ts
/home/wangjian/nomicore-fix-issue-133/wiki/raw/task_phase5-bootstrap-archive-reset-r2_sa6_red.md（本报告）
```
