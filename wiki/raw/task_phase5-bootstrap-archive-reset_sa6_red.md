# SA6 红灯验收报告 — issue #133「Phase 5: bootstrap import, archive, and guarded replica reset」Phase 1 验收锚定

- **基线 HEAD**：ebc5419（Phase 5: enable replication identity and epoch management，#132 已合入）
- **分支**：fix/issue-133-on-docs-phase-5-websocket-replication
- **Worktree**：/home/wangjian/nomicore-fix-issue-133
- **流水线 slug**：phase5-bootstrap-archive-reset（本文 = `task_phase5-bootstrap-archive-reset_sa6_red.md`）
- **前置门禁**：SA8 conflict report（verdict: clear；N-1/N-2/N-8 观察项直接指导了本锚定——参数形状不预设冻结、bootstrap eligibility 以可观察结果锚定、Memory 归档等价面只锚公共可观察语义）

## 1. 基线结论（缺什么面）

逐条 grep/类型面实证（基线零命中）：

| 面 | 基线事实 | 证据 |
|---|---|---|
| `archiveDoc(owner, docId, expectedReplicationIdentity)` | **全缺失**——`DocPersistence` 公共面仅 `createDoc/loadDoc/saveDoc`（packages/persistence/src/contract.ts:38-42、index.ts:1-35）；Memory/File 两 adapter 无该方法 | 一切 `asArchive(...).archiveDoc(...)` 调用抛 `TypeError: archiveDoc is not a function` |
| 受控复制导入 seam（persistence 侧） | **全缺失**——无任何复制导入/受控创建新面 | `TypeError: importDoc is not a function` |
| `resetReplica(owner, namespaceId, expectedLocalIdentity)` | **全缺失**——`NamespaceRegistry` 公共面仅 `open/create/getStatus/shutdown`（types.ts:364-385） | `TypeError: resetReplica is not a function` |
| 内部受信任 bootstrap 导入（registry 侧） | **全缺失**——无 importReplica/受信导入路径 | `TypeError: importReplica is not a function` |
| 归档/导入的错误分类族 | **全缺失**——仅 `DocDuplicateError`/`DocCreateOperationalError`/`DocCreateFatalError`/`DocLoadOperationalError`（contract.ts:44-156） | 归档/导入拒绝分类无对应类 |
| 类型面 | `DocPersistence`/`NamespaceRegistry` 两接口无上述方法成员；无未受身份守卫的删除面（既有纪律良好） | tsc 条件类型求值 `never`（4 处 TS2322 红锚） |

结论：本票 4 个功能面（persistence 归档、persistence 受控导入、registry reset 编排、registry 受信 bootstrap）在基线上**全部缺席**，红灯形态为特征缺失红（`is not a function`），与 issue #132 先例一致。

## 2. 测试文件清单 + 用例数 + 基线红/绿实测

### 2.1 交付物（5 个新文件，全部在 worktree 内；`git status` 实证零 src 改动、零既有测试改动）

| 文件 | 用例数 | 基线红 | 基线绿 | 说明 |
|---|---|---|---|---|
| `packages/persistence/test/persistence-phase5-archive-red.test.ts` | 23（14 it × 双 adapter 9 组共享矩阵 + 4 File 专属 + 1 保持性守卫） | 22 | 1 | AC-3/AC-5/AC-6 persistence 侧；Memory/File 双 adapter 平行验收 |
| `packages/persistence/test/persistence-phase5-import-red.test.ts` | 14（6 共享 ×2 + 1 File 重启 + 1 保持性守卫） | 13 | 1 | AC-2/AC-6 persistence 侧（导入排他创建；独立文件：导入/归档面分离编辑）。⚠️ 本文件经 SA3 实现期管道微调 + SA4 F-2 裁决留痕（见 §8.6） |
| `packages/namespace-registry/test/registry-phase5-bootstrap-reset-red.test.ts` | 18 | 17 | 1 | AC-1/AC-2/AC-4/AC-6 registry 侧（受信导入 + reset 编排 + 双真实持久化闭环） |
| `packages/persistence/test/persistence-phase5-archive-surface.test-d.ts` | 4 类型锚 | 2 | 2 | `archiveDoc`/`importDoc` 存在性（红）；无删除面旁路 + 三主方法面（绿守卫） |
| `packages/namespace-registry/test/registry-phase5-bootstrap-reset-surface.test-d.ts` | 4 类型锚 | 2 | 2 | `resetReplica`/`importReplica` 存在性（红）；无通用按 key 管理面 + create 恒三键（绿守卫） |

### 2.2 实跑命令与退出码（worktree 根）

```text
$ npx vitest run packages/persistence/test/persistence-phase5-archive-red.test.ts
  → exit 1（22 failed | 1 passed，Type Errors: no errors，Duration 390ms）
$ npx vitest run packages/persistence/test/persistence-phase5-import-red.test.ts
  → exit 1（13 failed | 1 passed，Type Errors: no errors）
$ npx vitest run packages/namespace-registry/test/registry-phase5-bootstrap-reset-red.test.ts
  → exit 1（17 failed | 1 passed，Type Errors: no errors）
$ npx vitest run --typecheck packages/persistence/test/persistence-phase5-archive-surface.test-d.ts \
  packages/namespace-registry/test/registry-phase5-bootstrap-reset-surface.test-d.ts
  → 4 failed | 4 passed（4 条红锚 TS2322：Type 'true' is not assignable to type 'never'）
$ npx tsc -p tsconfig.typecheck.json --noEmit
  → 恰 4 条错误，全部位于两个 surface.test-d.ts 的红锚位；3 个红运行时文件零类型错误
$ 三红文件连跑 2 次（flake 检查）：
  RUN 1: Test Files 3 failed | Tests 52 failed | 3 passed (55)
  RUN 2: Test Files 3 failed | Tests 52 failed | 3 passed (55)   ← 零 flake
```

**红轨一致**：52 个红用例全部以特征缺失形态失败（`TypeError: archiveDoc/importDoc/resetReplica/importReplica is not a function`——基线方法不存在即红），无任何「意外变绿」用例；3 个保持性守卫（绿）逐条声明见 §4.3。

## 3. AC → 用例映射表

| AC | 用例（文件缩写：ARC=archive-red，IMP=import-red，REG=registry-red） | 断言锚 |
|---|---|---|
| AC-1 受信导入保留 Hub namespaceId + detached 完整应用 + META 核对先于 ownership 转移 | REG「成功导入：namespaceId 原样保留…」；REG「复制身份核对失败（缺失）」；REG「（格式违约）」；REG「（与期望不符）」；REG「普通 create 面不受导入路径影响」 | lease.namespaceId === 传入 Hub ID；META.docId/replicationId/epoch 原样；ROOT 完整值在场；open 复用同一身份；缺失/格式违约/docId 不符 → `NAMESPACE_IMPORT_INVALID_IDENTITY` / `NAMESPACE_IMPORT_IDENTITY_MISMATCH`（临时拼写）+ `importCalls === []` + `loadDoc === null`（零持久化写入）；import 后 create 仍生成 `ns-+32hex` 且不与导入重复 |
| AC-2 排他不覆盖不合并 | REG「本地已有 live entry」；REG「本地无 entry 但已有 committed snapshot」；REG「同 key 并发两个导入 → 恰一成功」；IMP「duplicate（已存在 committed snapshot）」；IMP「cache 命中即拒（并发恰一）」；IMP「跨面排他：导入后 createDoc 仍 DOC_DUPLICATE」；IMP「META.docId ≠ docId → 零持久化写入」 | 双形态拒绝 + `NAMESPACE_ALREADY_EXISTS`（已冻结词汇）/ `DOC_DUPLICATE`（已冻结错误族）；live 内容与 META 零改动（身份未被合并入）；旧快照字节与内容原样；并发恰一成功；导入不绕过 create 排他纪律 |
| AC-3 Memory/File 行为等价归档 + 身份守卫 | ARC 共享矩阵 9 组 × 双 adapter：成功归档（loadDoc→null + slot 可重建）、身份不匹配（id/epoch 两式）、META 身份损坏、active handle 拒绝、duplicate archive、hold-before-commit 诚实、读失败 fault、owner 分区独立 | 全部经真实 yjs/真实 adapter/真实持久化面（Memory hook store 字节级、File 真实 fs 文件级）断言；双 adapter 同一组断言（ADR 0006:157-159 平行验收纪律） |
| AC-4 resetReplica 串行化与 race 拒绝 | REG「成功闭环」；REG「owner mismatch → NAMESPACE_NOT_FOUND」；REG「identity mismatch → 稳定拒绝 + 本地文档完好」；REG「missing key → NOT_FOUND」；REG「在途 ROOT 写 + 同 key reset 串行」；REG「并发 open + reset 串行」 | close→archive→bootstrap eligibility 三序可观察：原 lease released、归档期望身份 = 本地 META 事实、open → NOT_FOUND、loadDoc → null、随后 import 成功（完整 reset→bootstrap 闭环）；owner mismatch 零归档副作用零泄露；identity mismatch 后文档可 open 且 META/ROOT 零改动（零部分删除）；在途写完整结算后归档（归档内容含写后值）；并发 open+reset 无部分状态 |
| AC-5 File 受控路径 + 原子 rename + WS 不触文件 | ARC「归档落点在 rootDir 内受控路径…」；ARC「fault seam：目录树与快照字节零变化」；ARC「模块纪律（行为侧）：rootDir 外零新增」 | snapshot 文件移除、恰一份新归档文件、decode 后 META 身份完整、零 `.tmp` 残留；写失败 → 目录树逐文件一致（原子 rename 无部分状态）；专用父目录前后对比 rootDir 外零新增（文件访问封闭在包内——行为侧锚） |
| AC-6 duplicate/crash committed/active/identity/恢复/owner 分区 | ARC + IMP + REG 全矩阵（见上各行列）；ARC「File 重启恢复」；IMP「File 重启恢复」；REG「Memory 真实全链闭环」；REG「File 真实全链闭环（waitDurableSnapshot）」 | 归档/导入各阶段故障注入（读失败/写失败/hold-before-commit）→ 稳定分类 + 失败前不发生；File 重启（dispose → 同 rootDir 新实例）归档副本保留可 decode、导入副本完整恢复；owner 分区独立（A 归档/导入零影响 B 同 key 分区） |

## 4. 核心契约锚点清单（SA1/SA3 落位基准）

### 4.1 已冻结名（测试直接锚，非临时）

| 冻结名 | 权威出处 | 测试锚位 |
|---|---|---|
| `archiveDoc(owner, docId, expectedReplicationIdentity)` | phase-5 §实施切片 2（:63） | ARC 全部 22 个红用例的调用面；类型锚 ARC-surface |
| `resetReplica(owner, namespaceId, expectedLocalIdentity)` | phase-5 §实施切片 8（:113）/ ADR 0010:57 | REG AC-4 全部 6 用例；类型锚 REG-surface |
| `META.docId === docId`（0006:50 冻结规则） | ADR 0006 | IMP「META.docId ≠ docId」用例 |
| `DOC_DUPLICATE`（排他创建分类，已冻结） | contract.ts:44-51 | IMP duplicate 断言 `rejects.toThrow(DocDuplicateError)`；REG duplicate 断言 `NAMESPACE_ALREADY_EXISTS`（create 面已冻结词汇同款映射） |
| `NAMESPACE_NOT_FOUND`（owner 存在性零泄露） | types.ts:48 | REG owner mismatch / missing key |
| `NAMESPACE_ALREADY_EXISTS` | types.ts:63 | REG 导入 duplicate（借用 create 面冻结词汇，语义同「已存在，不能重复创建」） |
| `waitDurableSnapshot`（issue #108 正式耐久等待模式） | namespace-runtime/test/durable-snapshot-wait.ts | REG「File 真实全链闭环」：enable 后双字段（epoch+id）落盘才 reset——零 real sleep 轮询 |

### 4.2 临时契约名 / 临时形状（**全部显式标记「临时，待 SA1 冻结」**）

| 临时项 | 测试侧形态 | 备注 |
|---|---|---|
| `importReplica(owner, namespaceId, doc: Y.Doc)`（registry 侧受信导入路径） | 结果面 `{ok:true; lease} \| {ok:false; code; message}`（仿 create 窄结果先例） | **临时名**——ADR 0010 只称「内部受信任导入/受控复制导入能力」；行为锚（保留 Hub namespaceId、detached 完整应用、META 核对先于 ownership 转移、排他不覆盖不合并）才是断言主体 |
| `importDoc(owner, docId, doc: Y.Doc)`（persistence 侧导入 seam） | 返回 `Promise<DocHandle>` | **临时名**——与 createDoc 同通道结果 |
| `ReplicationIdentityRef = { replicationId: string; replicationEpoch: number }` | 作为 expectedReplicationIdentity / expectedLocalIdentity 参数形状 | **临时形状**（N-1）：字段冻结（32 小写 hex / 从 1 起安全整数），包装形状待 SA1；测试只锚「reset 把本地事实传给归档守卫」的可观察结果（REG 成功闭环断言 `archiveCalls[0].expected` 与本地 META 事实一致），并读档可判据必须复用 readReplicationFacts 单点（N-1 建议，测试未另立判据） |
| `NAMESPACE_IMPORT_INVALID_IDENTITY` | registry 导入缺失/格式违约拒绝 | **临时拼写**（identity mismatch 稳定分类的词汇位） |
| `NAMESPACE_IMPORT_IDENTITY_MISMATCH` | META.docId ≠ namespaceId | **临时拼写** |
| `NAMESPACE_RESET_IDENTITY_MISMATCH` | reset 身份不符 | **临时拼写** |
| `DOC_ARCHIVE_IDENTITY_MISMATCH` / `DOC_ARCHIVE_ACTIVE_HANDLE` / `DOC_ARCHIVE_DUPLICATE` / `DOC_ARCHIVE_OPERATIONAL` | 归档四分类 | **临时拼写**（phase 文档冻结了四分类，拼写待 SA1；duplicate 分类复用方向建议对齐 `DOC_DUPLICATE` 先例） |
| `DOC_IMPORT_IDENTITY_MISMATCH` | 导入 docId 违约 | **临时拼写** |

**改写成本提示**：若 SA1 冻结的拼写/形状与临时项不一致，仅需在 5 个新文件里改对应常量/接口声明（每个约 1-3 处）；测试的**行为断言结构与红/绿机制**不受影响。建议 SA3 落地时先对齐本报告 §4.2 清单再动 src。

### 4.3 保持性守卫（基线为绿，逐条声明）

1. ARC「既有排他创建语义不变：createDoc 同 key 仍 DOC_DUPLICATE」——绿（防导入/归档面破坏 0006 排他纪律回潮）；
2. IMP「导入不新增跨 owner catalog：无 list/enumerate/removeDoc/deleteDoc 公共面」——绿（ADR 0010「Persistence 不增加跨 owner catalog」防回潮）；
3. REG「普通 create 随机生成纪律不变：ns-+32hex + owner 分区持久化」——绿（#131/#132 冻结行为防回潮）；
4. ARC-surface「DocPersistence 无 removeDoc/deleteDoc/listDocs/enumerateDocs/moveDoc 成员」+「三主方法面不变」——绿；
5. REG-surface「NamespaceRegistry 无 removeNamespace/deleteNamespace/evict/closeNamespace/forceClose/listNamespaces」+「普通 create 输入恒三键（namespaceId 仅经注入 CSPRNG 生成）」——绿。

### 4.4 锚定纪律声明

- 运行时行为测试全部用**真实 yjs / 真实 MemoryPersistence·FilePersistence（真实 tmpdir、真实 fs rename）/ 真实 Registry+Runtime**；stub 仅作 registry 编排面观测（记录 importCalls/archiveCalls/归档内容——真实调用面，非 mock 服务）；故障注入仅经既有 `createPersistenceIoFaultSeam`（issue #108 wrapIo around-seam）；fake scheduler 脚本化驱动（零 real sleep）；File flush 落盘等待走 `waitDurableSnapshot` 正式模式。
- **零源码 grep 断言**：5 个文件不含任何 `readFileSync(src).toMatch` 类断言；模块纪律被锚为**行为侧**（专用父目录 readdir 前后对比：归档移动后 rootDir 外零新增文件）+ 类型面负向守卫（无删除/枚举公共面），而非源码文本形状。
- 类型面红锚经本地结构声明 + `as unknown as` cast（沿 registry-phase5-replication-red.test.ts 先例），3 个红运行时文件在 tsconfig.typecheck.json 程序内**零类型错误**（tsc 全量实证：仅 surface 红锚 4 条 TS2322，无噪音）。

## 5. 既有套件零回归证据

```text
$ npx vitest run packages/persistence packages/namespace-registry --typecheck=false \
    --exclude '**/persistence-phase5-archive-red.test.ts' \
    --exclude '**/persistence-phase5-import-red.test.ts' \
    --exclude '**/registry-phase5-bootstrap-reset-red.test.ts'
→ Test Files 28 passed (28) / Tests 313 passed (313)   [exit 0]
```

- 28 个既有测试文件 / 313 个既有用例全部通过（含 registry-phase5-replication-red.test.ts、registry-phase5-identity-red.test.ts、persistence 全部契约/错误契约/模块图回归等）。
- `git status --short` 实证：仅 5 个新测试文件 + 流水线既有 3 个 wiki 文件；`git diff` 零改动（无任何 src/ 或既有测试修改）。
- 三红文件连跑 2 次计数完全一致（52 failed | 3 passed），零 flake。

## 6. 边缘提示（超出锚定范围、需 SA1 裁决）

1. **N-1 落地观测**：本锚定不预设 `expectedLocalIdentity` → 归档守卫的推导路径，但 REG「成功闭环」断言 `archiveCalls[0].expected === 本地 META 事实`——若 SA1 决定「归档守卫读持久快照身份而非内存 META」，测试在「create 后立即 reset（未 flush）」场景会红。测试已通过「enable 后 advanceBy/kick + waitDurableSnapshot 或 Memory store 解码验证身份落盘」前置使两种读法均确定；SA1 若选内存读法，该前置无害，若选持久读法，该前置必需（现测试已内建）。
2. **归档提交写是否路由经 io seam**：ARC「hold-before-commit」与「failNextWrite」两用例断言归档的提交写进入 `wrapIo` seam（否则 hold 不触发 → 用例红）。phase 文档要求 fault-注入可测（§测试 seam），但 PersistenceIO 现契约只有 read/write 无 delete/rename——**File 的原子 rename 与 Memory 的移除可能绕过 io.write 直接做 adapter 级操作**。SA1 需裁定：归档的提交段是否经 io seam（建议：tmp 写经 io.write、rename/移除为 adapter 内提交段；或扩展 PersistenceIO——扩展属 ADR 0006 授权演进）。若裁定「不经 io seam」，请同步调整 AC-6 故障注入的注入点（本报告建议 SA3 若走此路，至少保证身份核对读经 io.read，使「读失败」用例仍可注入）。
3. **duplicate archive 的词汇**：phase 文档四分类含「duplicate」，本锚定临时用 `DOC_ARCHIVE_DUPLICATE`；若 SA1 裁定「二次归档 = NOT_FOUND 类拒绝」或「幂等 ok」，ARC 该用例需按 SA1 语义改写（现按「duplicate 稳定分类 + 首次归档完整保留」锚定，行为面断言不依赖拼写）。
4. **importReplica 的输入形态**：本锚定取 `doc: Y.Doc`（detached 完整 Y.Doc 直接输入——phase 文档措辞「从 detached、已核对身份的完整 Y.Doc」）。若 SA1 裁定输入为 `Uint8Array`（update 字节，由 Registry 内部 apply 到 detached doc），行为断言不变（内容/身份/排他/零写入全部经结果面锚定），仅接口声明与测试调用处微调；**但「META 核对先于 ownership 转移」在字节输入下仍是同一组断言**。
5. **reset 结果面的范围**：本锚定只锁 `{ok:true}`/`{ok:false;code;message}` 的 `ok` 判别（SA1 可扩展字段）；`importReplica` 成功面假定 `{ok:true; lease}`（仿 create）——若 SA1 让 importReplica 仅创建不返回 lease（调用方再 open），REG 用例需改为 open 后断言（行为断言链已覆盖 open 路径，改动小）。
6. **N-2 bootstrap eligibility 机制**：本锚定以「reset 后 open → NOT_FOUND + loadDoc → null」为资格判据（推荐最小实现：归档完成 + entry 清理），与 N-2 建议一致；未锚定任何新状态枚举（ADR 0009:114 公共面纪律）。
7. **N-8 Memory 归档「行为等价」的恢复面**：Memory 侧未锚定「归档内容可恢复」的字节级断言（无公开恢复面——File 侧经真实归档文件 decode 锚定；phase 文档测试 seam 亦明确 File 做归档/恢复验收）。SA1 若为 Memory 定义归档恢复面（如归档 store 探针），测试可加同款断言；现 Memory 等价面 = loadDoc→null + slot 复用 + 身份守卫 + active handle + 故障诚实（全部公共可观察）。
8. **归档 fault 注入的「META 身份损坏」分类**：ARC「持久化 META 复制身份损坏（双键在而格式违约）」只锚「拒绝 + 零改动」，未钉 code——SA1 若定独立 corrupt 族（如沿 #132 ReplicationMetaCorruptError 判据）或归 identity mismatch 族，该用例均按此锚成立。
9. **waitDurableSnapshot 只用于 File 的 create→enable 路径**：Memory 闭环以 store 字节 decode 验证身份落盘（同语义、无文件轮询）；File 闭环两处（enable 后双字段、import 后重启恢复前）均走正式模式，零 real sleep。
10. **并发恰一成功用例的 carrier FIFO 依赖**：REG「同 key 并发两个导入 → 恰一成功」依赖 SA3 的导入经每 key 串行槽（与 open/create 同 carrier 或等价排他 claim——ADR 0009 串行纪律）。若 SA1 让导入绕过串行槽直接并发 claim，Persistence claim 排他仍保证恰一成功（第 2 个得 DOC_DUPLICATE），断言结果面不变。

## 7. 交付物清单（绝对路径）

```text
/home/wangjian/nomicore-fix-issue-133/packages/persistence/test/persistence-phase5-archive-red.test.ts
/home/wangjian/nomicore-fix-issue-133/packages/persistence/test/persistence-phase5-import-red.test.ts
/home/wangjian/nomicore-fix-issue-133/packages/persistence/test/persistence-phase5-archive-surface.test-d.ts
/home/wangjian/nomicore-fix-issue-133/packages/namespace-registry/test/registry-phase5-bootstrap-reset-red.test.ts
/home/wangjian/nomicore-fix-issue-133/packages/namespace-registry/test/registry-phase5-bootstrap-reset-surface.test-d.ts
/home/wangjian/nomicore-fix-issue-133/wiki/raw/task_phase5-bootstrap-archive-reset_sa6_red.md（本报告）
```

## 8. 回流 R-1/R-2 修订记录（设计冻结后；对应设计 §4.4 D-4 / §4.10 D-10 / §4.14.1 D-14 回流清单）

**范围纪律**：只改 SA6 自己的 5 个红灯文件（其中 3 个涉及修订）+ 本报告；零 src 改动、零既有测试改动（git status 复证）；运行时行为断言**零改动**（52 个红用例的断言文本与失败形态逐字不变，见 §8.4）。

### 8.1 R-1（设计 §4.10：两个 Memory 夹具补 `deleteSnapshot` hook）

1. `packages/persistence/test/persistence-phase5-archive-red.test.ts` `makeMemoryArchiveFixture`：
   - `createMemoryPersistence({...})` 夹具补 `deleteSnapshot: async (key: string) => { store.delete(key); }`（+3 行本体 + 4 行 R-1 注记注释）；
   - 选项对象尾部改 `} as MemoryPersistenceOptions`（+1 行类型断言，import 行 +`type MemoryPersistenceOptions`）。
   - **与设计形态相容性**：hook 仅删除主键（`store.delete(key)`），不预设任何 archive-scoped key——与设计 R2「writeArchive 不经 writeSnapshot hook、独立 `archiveSnapshots` Map 分区（仅主键直传 deleteSnapshot）」一致；既有 readSnapshot/writeSnapshot 语义与 `store` 闭包引用零改动（`store` 仍是唯一外部 store，读/写/删三钩子同闭包）。
2. `packages/namespace-registry/test/registry-phase5-bootstrap-reset-red.test.ts`「Memory 真实全链闭环」writer 夹具：同款补 `deleteSnapshot`（+3 行本体 + 4 行注记）+ `} as MemoryPersistenceOptions` + import 行 +`type MemoryPersistenceOptions`。
   - 该用例断言 `store.has(primaryKey) === false`（reset 主键移除的真实持久面证据）——hook store 的 `Map.delete` 只能由夹具提供的能力触达；设计 §4.10 论证在案：无删除钩子则任何诚实设计都无法满足该断言（锚的前置缺口，非设计保守）。

   **类型层处理（预 SA3 的类型洁净性，必要偏离「+1 行」字面）**：SA3 落地前 `MemoryPersistenceOptions` 尚无 `deleteSnapshot` 成员——裸写会产生 (a) TS2353（对象字面量多余属性）与 (b) TS7006（无上下文类型的 `(key)` 隐式 any）。为保持「运行时红文件的 typecheck 程序零错误」纪律（§2.2 基线实证：`Type Errors: no errors`），以既有 cast 先例（`as MemoryPersistenceOptions` + 显式 `(key: string)` 参数注解）处理，两处各 +2 行。SA3 将 `deleteSnapshot` 加入 `MemoryPersistenceOptions` 后，cast 与注解即冗余但无害（不削断言、不影响转绿）；如需瘦身可删 cast（SA3 属可选项，非回流清单项）。

### 8.2 R-2（设计 §4.4 D-4：persistence surface 两红锚 `DocPersistence` → `ReplicaPersistence`）

`packages/persistence/test/persistence-phase5-archive-surface.test-d.ts`：

- import 行 +`ReplicaPersistence`（`import type { DocHandle, DocPersistence, ReplicaPersistence, User }`）；
- 两红锚泛型实参 `HasArchiveDoc<DocPersistence>` → `HasArchiveDoc<ReplicaPersistence>`、`HasImportDoc<DocPersistence>` → `HasImportDoc<ReplicaPersistence>`（+describe/it 标题改为 ReplicaPersistence 并附 R-2 缘由注记）；
- 文件头「锚定机制」注释块改写（红锚机制描述从 DocPersistence → ReplicaPersistence，含可选成员不可赋值论证与 TS2305 预期）；
- 同文件两绿守卫（无删除/枚举面、三主方法字面量）**零改动**——optional 成员设计下三成员字面量仍合法，保持绿。
- registry 侧 surface 文件**零改动**（importReplica/resetReplica 锚定 `NamespaceRegistry` 公共接口，D-1 已冻结为公共方法）。

**基线红形态变化（按总控验证义务记录）**：`ReplicaPersistence` 在基线上不存在 → `import type` 报 **TS2305**（`Module '"@nomicore/persistence"' has no exported member 'ReplicaPersistence'`，位置 = 本文件锚位 33:42），并抑制了两个下游 TS2322（条件类型对错误类型不求值）。即：persistence surface 的基线红形态从「2× TS2322」变为「1× TS2305（文件级 TypeCheckError）」；**两阶段锚机制**：SA3 导出 `ReplicaPersistence` → TS2305 消失 → 若接口缺 `archiveDoc`/`importDoc` 方法则 TS2322 锚臂上岗 → 方法齐备才转绿（条件类型 never→TS2322 机制在类型存在后恢复判别力）。registry surface 两个 TS2322 红锚不变（仍恰属两 surface 文件的红锚位，零污染其它文件）。

### 8.3 修订处行数汇总

| 文件 | 改动行 | 说明 |
|---|---|---|
| persistence-phase5-archive-red.test.ts | 1（import）+ 1（cast）+ 3（hook 本体）+ 4（注记）= 9 | R-1；其中「+1 行」回流本体 + 类型洁净性处理 + 注记 |
| registry-phase5-bootstrap-reset-red.test.ts | 1 + 1 + 3 + 4 = 9 | R-1 同款 |
| persistence-phase5-archive-surface.test-d.ts | 1（import）+ 2（锚行）+ 2（标题）+ ~14（头注释改写）= ~19 | R-2 |
| registry surface / import-red / 其余 | 0 | 零改动 |

（设计 §4.14.1 按「+1 行」字面估算；实际含类型洁净性 cast/注解与注释更新，行为断言零改动。）

### 8.4 修订后实测（全部亲跑）

```text
$ npx vitest run <三个红运行时文件> × 2
  RUN 1 / RUN 2 均：Test Files 3 failed | Tests 52 failed | 3 passed (55)，Type Errors: no errors
  → R-1 后红计数不变（基线无 archiveDoc/importDoc ⟹ 红形态不变）；绿守卫 3 个保持绿
$ npx vitest run --typecheck <两 surface 文件>
  → Test Files 2 failed | Tests 2 failed | 6 passed (8)，Type Errors 2 failed
  （persistence surface 红 = TS2305 文件级 TypeCheckError；registry surface 红 = 2× TS2322；绿守卫 6 个保持绿）
$ npx tsc -p tsconfig.typecheck.json --noEmit
  → 恰 3 条错误：registry surface 2× TS2322 + persistence surface 1× TS2305——全部位于两 surface
    红锚位；3 个红运行时文件零类型错误（R-1 cast/注解处理见效：无 TS2353/TS7006 污染）
$ npx vitest run packages/persistence packages/namespace-registry --typecheck=false \
    --exclude '<三个新红文件>' → 28 files / 313 tests 全绿（零回归复检通过）
$ git status --short → 仅 5 个测试文件 + wiki 档案；零 src/既有测试改动
```

### 8.5 与设计 §4.14.1 一致性核对

- 「persistence-phase5-archive-red.test.ts 需回流 R-1：makeMemoryArchiveFixture 补 deleteSnapshot」✅ 落位（+类型洁净性 cast/注解）；
- 「registry-phase5-bootstrap-reset-red.test.ts 需回流 R-1：Memory 闭环 writer 夹具补 deleteSnapshot」✅ 落位（同款）；
- 「persistence-phase5-archive-surface.test-d.ts 需回流 R-2：两红锚 DocPersistence→ReplicaPersistence + 1 行 import」✅ 落位；基线红形态 TS2305 取代 TS2322 按总控验证义务记录（§8.2），两绿守卫零改动保持绿——与 D-4「optional 成员下三成员字面量仍合法」一致；
- 「registry-phase5-bootstrap-reset-surface.test-d.ts 零改动」✅；
- 「persistence-phase5-import-red.test.ts 零改动（本回流 R-1/R-2 范围）✅」——注：该文件另有 SA3 实现期管道微调（File 夹具 walk ENOENT 容错，6 行、零断言改动），SA4 F-2 裁决接受并留痕，见 §8.6；
- 设计 D-14「52 红用例中 50 个直接转绿 + 2 处 fixture/锚回流（R-1/R-2）」——本回流完成前置；断言逻辑零改动（SA3 仅按设计实现即可转绿，无需动断言）。

### 8.6 SA3 实现期管道微调留痕（SA4 F-2 建议并入）

- **位置与内容**：`packages/persistence/test/persistence-phase5-import-red.test.ts` 的 `makeFileImportFixture` 之 `readStoreFiles` walk（File 夹具，约 135-151 行区域）：`fsp.readdir(dir, { withFileTypes: true })` 包入 try/catch，`ENOENT` → 视为空清单（`return`，不产出文件），其余错误照抛。约 6 行，属 fixture 管道容错。
- **动机**：零写入拒绝路径（如「META.docId ≠ docId → 零持久化写入」用例：导入在 `new FilePersistence` 之后、任何写之前拒绝）下 rootDir 尚未被创建——`walk(dir)` 对不存在的目录读目录必然 ENOENT；原实现直接抛错，使「零持久化写入」断言被管道噪声淹没而非断言本体失败（语义上 ENOENT ≡ 空 store，正是「零持久化写入」观察意图的必然面）。
- **SA4 F-2 裁决**：接受——零断言改动（`expect(await fx.readStoreFiles()).toEqual([])` 等断言文本与意图逐字不变），ENOENT ≡ 空 store 是观察面自身语义而非减弱；不削弱任何锚定力（真实写入路径下 rootDir 由 `FilePersistence` 创建，ENOENT 分支永不误吞真实错误——非 ENOENT 错误照抛仍响亮）。
- **对 §2.1 交付物清单的影响**：已在该文件行标注「⚠️ 本文件经 SA3 实现期管道微调 + SA4 F-2 裁决留痕（见 §8.6）」；红/绿计数（13 红 / 1 绿，基线记录）不受该微调影响——微调只影响拒绝路径的读目录容错，基线红形态 `TypeError: importDoc is not a function` 在调用点先于一切 fixture 观察发生。**当前 worktree 复证（SA3 实现已落地，本留痕后实跑）**：`npx vitest run packages/persistence/test/persistence-phase5-import-red.test.ts` → **14 passed (14)**，`Type Errors: no errors`——SA3 实现 + 该容错微调下全绿（SA4 F-2 裁决「不削弱锚定力、零断言改动成立」获实证）；同批复跑 archive-red（22）与 registry-bootstrap-reset-red（19，含保持性守卫）亦全绿，转绿实现与 R-1/R-2 回流吻合。

