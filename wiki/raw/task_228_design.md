# Issue #228 架构设计 — Host namespace 数据删除 ⇄ 诊断日志逻辑删除联动 + PR #142 阶段验收

> 设计产物（round 1，phase design）。任务简报权威来源 = GitHub issue #228（REST 亲读：OPEN，
> title「完成诊断日志删除联动与 PR #142 阶段验收」，评论 0 条、无 Owner 追加要求）。
> 输入产物：`task_228_relevant_decisions.md`（SA8 决议摘录）、`task_228_conflict_report.md`
> （verdict=clear；B1–B3 硬约束）、`task_228_sa6_acceptance_contract.md`（AC1 红灯契约
> D1–D4 + AC2 覆盖图）、红灯测试 `apps/yjs-server/test/host-namespace-delete-diagnostic-link-red.test.ts`
> （4 cases 实测红：`unknown-op`）。本设计不改业务代码、不 commit/push。
>
> **round 2（勘误轮，dispatch `sa-8ad6e2f2-9adf-4b57-b948-511f6c695d3f`，phase design，
> iteration 1）**：对已批准设计仅作**可审计文档勘误** E-1/E-2（§10）——AD-2/D4 转绿基线
> 改述 + §3.3/§6.2 表行 + R-1×D4 交叉注记（E-1）；AD-6 步骤 5 ActiveHandle 失败映射与
> 实现/ADR-0009 修订节 §5 一致化（E-2）。**明确为文档勘误而非架构变更**：AD-1~AD-9 架构
> 裁决、§3 文件范围、AD-8 失败矩阵对外语义零变化；本轮零生产代码/测试改动、不 commit/push。
> 勘误轮输入（亲读）：`task_228_sa4_review.md`（F-1~F-7）、`task_228_sa6_f1_ratification.md`
> （F-1 追认，verdict=approve）、`task_228_sa3_implementation_notes.md`（iteration 3）、
> `task_228_sa2_review.md`（只读评审输入）。Issue 评论权威 REST = `[]`（无 Owner 追加要求；
> 评论 ID/updated_at：无）。

---

## 0. 结论速览

| 项 | 裁决 |
|---|---|
| 数据删除落点（B1 首要架构决策） | **Persistence 新可选 seam `deleteDoc` + Registry 新公共方法 `deleteNamespace(owner, namespaceId)` + Host 编排**（AD-1/AD-5/AD-6） |
| Host 表面 | NDJSON 控制通道新增 op **`delete-namespace { namespaceId }`**（**批准** SA6 PROPOSAL 原名原形，零修订）；hub-only；回执 `{ok:true}` / `{ok:false, code}`（AD-2） |
| 同步窗口语义（B2） | 回执 `ok:true` ⟺ 同一回执周期内数据快照与诊断日志目录树均完成逻辑删除；失败 → 诚实失败回执，**重入重试是唯一完成路径**（AD-8） |
| 公共面演进 | ADR-0006（`deleteDoc`/`removeKey` IO）与 ADR-0009（`deleteNamespace`）**必须各加显式修订节**；ADR-0011 加澄清性修订节（AC3）；**需设计后 SA8 复审**（§8） |
| ws-replication / wire / config / schema | **零改动**（AD-7/AD-9）；既有 channel 经 released-lease 错误路径自然收口 |
| 复活向量 | 三个（debounce 迟到 flush、diag-pump 迟到 `runtimeEmitterFor` 重建、复制 channel 再引导）全部封死（AD-4/AD-5/AD-7） |

---

## 1. 现状与差距（亲证代码锚点，HEAD 当前）

| 面 | 现状 | 差距 |
|---|---|---|
| 诊断日志删除被调能力 | `deleteNamespaceDiagnosticLog(req)`（`packages/namespace-diagnostic-log/src/adapters/file.ts:1592`，公共导出于 `src/index.ts:100`）：`.deleting` 协议、deletion.json marker、orphan 清理、N1–N5 重入续走、INV-12 租约分区释放；结果 `deleted/absent/failed{code,step}` | 无——已由 #154 交付，本设计直接消费 |
| Host 控制通道 | `apps/yjs-server/src/app.ts` dispatch 闭集 11 op（L488-520），无 delete 类 | 新增 `delete-namespace` 分支 + 编排 |
| Registry 公共面 | `open/create/getStatus/shutdown/importReplica/resetReplica`（`packages/namespace-registry/src/registry.ts:1970-2043`）；无按 key 关闭/删除 | 新增 `deleteNamespace`（ADR-0009 修订节） |
| Persistence 公共面 | `createDoc/loadDoc/saveDoc/getStatus(+importDoc/archiveDoc/readPersistedReplicationIdentity 可选)`（`contract.ts:80-131`）；无 `deleteDoc` | 新增可选 `deleteDoc`（ADR-0006 修订节） |
| 复用资产 | `PersistenceIO.remove`（`persistence/src/lifecycle.ts:69`，主键移除、ENOENT 容忍）；`settleEntryForArchive`（L544，零-handle dirty 排空防复活）；claim/cell 状态机（L443-527）；`runResetSlot` 破坏性段（registry.ts:1669-1830：forceRelease + cancelIdleArm + close drain）；diag-pump macrotask 延迟投递（`namespace-registry/src/diag-pump.ts`） | `deleteDoc` 全部可镜像复用，仅差「删除不需要 flush 持久化」的 settle 变体与归档位清理 |
| Host 诊断管理器 | `apps/yjs-server/src/diagnostics.ts`：per-ns adapter 缓存 `Map`、`ensureAdapter` 懒构造、`close()` O(1) 收口 | 无 retirement 面——**diag-pump 迟到 drain 会在日志删除后重建 adapter 写残留**（AD-4 封堵） |

关键时序事实（设计约束来源）：

1. **debounce 复活**：file persistence dirty flush 走 debounce 调度（`lifecycle.ts:859-871`），
   `saveDoc → maxDirtyMs（缺省 5s）内提交`；app 停机为此等排空窗（`app.ts:434-437`）。若
   删除快照后仍有 pending flush，flush 会**重建快照文件** → 违反 D1「ack 后快照全缺席」。
2. **diag-pump 迟到重建**：`initStream`/`runtimeEmitterFor`/emit 被 #226 泵推迟到 macrotask
   drain，且「寿命与 shutdown 零耦合：不清泵、不等待」（diag-pump.ts 头注）。Runtime close
   barrier 排空 slot ≠ 排空泵——close 后仍可能有迟到的 `runtimeEmitterFor(ns)` → `ensureAdapter`
   重建 adapter → 对已删目录**重新建流写 genesis** → 违反 D4「不复活、无残留」。
3. **复制 channel 复活**：hub 侧 `hub-namespace` 持长寿命 lease（`ws-replication/src/hub-namespace.ts:79,276`）；
   已建立 channel 的后续 apply 若能重新 open 并 saveDoc，会复活数据。授权绑定表
   （`app.ts:239-244` bindings/knownNamespaces）是 Host 私有面，可先行摘除。

---

## 2. 架构决策

### AD-1 数据删除落点（B1 裁决）：Registry 编排 + Persistence 新 seam + Host 组合

**决策**：三段式——

1. `@nomicore/persistence` 新增**可选**公共 seam `deleteDoc(owner, docId)`（DocPersistence 层
   可选、ReplicaPersistence 层**必具**，镜像 `archiveDoc` 的放置先例）；实现落在共享 lifecycle
   （Memory/File 同一编排，IO 经新可选 `PersistenceIO.removeKey`）。
2. `@nomicore/namespace-registry` 新增公共方法 `deleteNamespace(owner, namespaceId)`：单 key
   破坏性编排（关 Runtime → `persistence.deleteDoc`），走既有 carrier per-key 序列化域。
3. Host（`apps/yjs-server`）拥有**删除工作流编排**：角色门/参数门/known-set 门 → 摘除复制
   授权暴露 → `registry.deleteNamespace` → 诊断 manager retirement + `deleteNamespaceDiagnosticLog`
   → bookkeeping + NDJSON 事件 + 回执。

**依据**：(a) ADR-0014-LOG L299 把联动义务放在 Host，日志删除函数是包公共导出，Host 直接
消费合规（app AGENTS「只消费包公共导出」）；(b) Registry 是唯一能**同步**关闭单 namespace
Runtime 的层（idle 逐出最长 300s、shutdown 是全量操作，均不可用作同步回执路径）；(c)
`resetReplica` 先例（registry.ts:1669 起）已经证明「Registry 编排 Persistence 破坏性操作 +
forceRelease/close drain」的形态可行，`deleteNamespace` 是同型减法（减身份前置、减 reset fence、
减 bootstrap）；(d) Host 不触碰 `requireNomicorePersistence` 直调数据面，capability 门禁单点
在 Registry（镜像 reset 的 ② 前置门）。

**否决的替代**：

- **Alt-1 Host 直接文件操作**（rm `{persistRoot}/users/...`、手搬日志目录）：违反 app AGENTS
  包边界 + 越过 persistence 单一真相源 + 绕过 live-handle/debounce 记账 → 复活向量不可封。
- **Alt-2 复用 `archiveDoc`（归档后删归档文件）**：archive ≠ delete（#133 语义）；会先写一份
  全量归档快照（浪费且制造新数据副本）；身份前置（expected replication identity）与删除语义
  无关且会把删除变成存在性+身份预言。
- **Alt-3 Host 直调 persistence.deleteDoc + 依赖 idle 逐出**：活 Runtime 持 handle →
  deleteDoc 只能拒绝或等待（最长 idleTimeoutMs）→ 回执无法同步；capability 门禁双处重复。
- **Alt-4 ws-replication 新增 per-namespace channel 拆除 API**：扩 ADR-0010 冻结面，收益仅是
  「channel 更早得知删除」的通知及时性；数据安全由 AD-7 的三重封堵保证 → **出范围 v1**，
  备案为未来演进（§7 残余风险）。

### AD-2 Host op `delete-namespace`（批准 SA6 PROPOSAL，零修订）

- **表面**：stdin NDJSON `{ "op": "delete-namespace", "namespaceId": string, "id"?: … }`；
  回执经 `handleControlLine` 通用包装 `{event:'reply', op, id?, …result}`。红灯测试文件
  `host-namespace-delete-diagnostic-link-red.test.ts` **保留文件名**（契约连续性），头注由
  「红灯契约」更新为「已转绿」。转绿基线（勘误 E-1，§10）：**D1–D3 零断言改动**即应转绿；
  **D4 = 断言级仲裁后的 R-1 行为约束集**——重启健康（provisioned/ready + SIGTERM exit 0）+
  provision 重建为**新 CSPRNG 身份**（`.not.toBe(已删 id)`：`registry.create` 每次经
  `randomBytes(16)` 派生 `ns-`+32 hex，registry.ts L204/L854-892——「重启后确定性派生同
  namespaceId」物理不可满足，等概率 2^-128）+ 已删旧日志目录树/旧 stream 重启后零复活 +
  新流 ≠ 旧流 + 重建树无 deletion.json 半态残留。该行为集与 R-1（新 namespace、新流、
  新身份）、AD-4（重建走全新流）及 D4 实际契约一致；SA6 追认已批准
  （`task_228_sa6_f1_ratification.md` verdict=approve；SA4 F-1）。
- **门禁次序（全部先于任何 fs 触达）**：
  - G1 角色门：`role !== 'hub' || registry === undefined` → `{ok:false, code:'unknown-op'}`
    （镜像 `opReplaceSchema` L652；peer → unknown-op——peer 副本删除属 `reset-replica`
    archive 语义，不在此面）。
  - G2 参数门：`typeof namespaceId !== 'string' || !NAMESPACE_ID_PATTERN.test(...)` →
    `{ok:false, code:'invalid-op-args'}`（D3：零文件触达——参数门先于一切 IO）。
  - G3 known-set 门：`knownOwner(namespaceId)` 命中 → 用该 owner；未命中但
    `deletedNamespaces` tombstone 命中 → 用 tombstone owner（**D2 幂等二删路径**）；
    两者皆未命中 → `{ok:false, code:'namespace-unknown'}`（镜像 read/verify-write，零 fs）。
  - G4 单飞：`deleteInFlight: Map<nsId, Promise<Result>>`；并发第二请求 await 首请求结算后
    走幂等重入路径（结果一致性由两段删除的幂等性保证）。
- **成功回执**：`{ok:true}`；**生命周期事件**：`{event:'namespace-deleted', namespaceId}`
  （回执前发射）。失败回执稳定码族：`invalid-op-args` / `namespace-unknown` /
  `delete-namespace-failed`（数据段 issue/fatal 折叠）/ `log-delete-failed`（附 `step`
  （marker|locator|stream|remove）与 `errno`（稳定 errno 码或 `invalid-namespace-id`）——
  直接透传 `deleteNamespaceDiagnosticLog` 的 failed 形状，不发明第二词表）。
- **诊断禁用分支**：`config.diagnostics?.enabled !== true` → 无 logRoot、按构造不存在日志面，
  跳过日志删除步（数据删除照常），回执 `ok:true`。设计注记：AC1 的联动义务以「存在日志面」
  为前件；D1–D4 均在 enabled:true 下运行。

### AD-3 编排次序（同步窗口内的全序）

```
op delete-namespace(ns)：                          [stdin macrotask，不持任何 write slot/carrier]
 1. G1–G4 门禁（零 fs）
 2. diagnostics?.retireNamespace(ns)               [先封 diag-pump 迟到重建（AD-4）]
 3. 摘除复制暴露（内存同步）：bindings 中 key 以 \0+ns 结尾的条目全删；
    knownNamespaces.delete(ns)；deletedNamespaces.set(ns, owner)
 4. registry.deleteNamespace({userId: owner}, ns)  [carrier 槽内：关 Runtime → deleteDoc（AD-6）]
 5. diagnostics enabled ?
      deleteNamespaceDiagnosticLog({rootDir: diagnostics.rootDir, namespaceId})
      → 'deleted' | 'absent'  → 继续
      → 'failed{code,step}'   → 回执 {ok:false, code:'log-delete-failed', step, errno:code}
    （manager 缓存条目已在 2 中驱逐；INV-12 租约分区释放由该函数内部完成）
 6. sink({event:'namespace-deleted', namespaceId})；回执 {ok:true}
```

次序论证：**2 先于 4**（否则步骤 4 的 close drain 期间泵仍可重建 adapter）；**3 先于 4**
（否则删除期间可再建立新 channel/新 open 授权）；**4 先于 5**（数据先消失 → 日志删除后
任何迟到 open 都得 NAMESPACE_NOT_FOUND，不会对已删日志再写）；5 的 marker 协议本身
（deletion.json → 构造一律 disabled）对乱序迟到者提供第二道防线。全序在单个 async 函数内
`await` 串行 → 「同一回执周期」可观察结局成立（D1 无 poll 断言）。

**调用点纪律（B2）**：整个 op 运行于 stdin 控制 dispatch（macrotask），不位于任何
NamespaceRuntime write sequencer slot、也不位于 registry carrier 槽内；`registry.deleteNamespace`
槽内只含异步 IO（`io.removeKey` 走 `fsp.rm`）与 close drain，无同步重 fs；
`deleteNamespaceDiagnosticLog`（同步重 fs）在步骤 5、即 registry 槽外调用——满足
ADR-0014-LOG amendment「同步 fs 调用点必须在 slot 之外」。

### AD-4 Host 诊断 manager retirement（封 diag-pump 迟到重建）

`apps/yjs-server/src/diagnostics.ts` 扩展（app 内部面，非包公共面）：

- `HostDiagnosticsManager` 新增 `retireNamespace(namespaceId: string): void`：
  `retiredNamespaces.add(ns)` + `adapters.delete(ns)`（first-slice adapter 无常驻 fd/队列，
  弃引用即收口）；幂等。
- `DiagnosticEmissionDropReason` 词表**追加 `'namespace-deleted'`**（app 内部冻结词表演进；
  产生方唯一 = retirement 之后的 `runtimeEmitterFor`/共享通道迟到流量；沿用 §4-D8
  「三值各有唯一产生方」纪律扩展为四值）。`runtimeEmitterFor(ns)`：`retiredNamespaces.has(ns)`
  → `dropStub(ns, 'namespace-deleted')`（计数事件
  `{event:'diagnostic-log-emission-dropped', reason:'namespace-deleted', namespaceId}`——
  ADR-0011 隔离：丢弃不改任何业务结果）。
- `initStream(ns, …)`：**先 `retiredNamespaces.delete(ns)` 再 `ensureAdapter`**——同进程内
  以同 namespaceId 重新 create（如运维显式重建）时新 namespace 可正常建流（D4 第二分支
  「重建走全新流」的进程内同构）。
- `close()` 语义不变（O(1)；retirement 不影响 close）。

ADR-0011 合规论证：被丢弃的 emission 属「已进入删除流程的 namespace 的迟到日志流量」，
其宿主日志正在/已被逻辑删除——丢弃是 best-effort 隔离的正向运用，不改变删除工作流或任何
其它业务操作的返回值。

### AD-5 Persistence `deleteDoc`（ADR-0006 修订节）

**契约**（`packages/persistence/src/contract.ts`）：

```ts
/** issue #228：按 (owner, docId) 逻辑删除主键 committed snapshot 与同 key 受控归档位。
 *  幂等（两处均已缺席 → 仍 resolve {ok:true}；缺席与已删不可区分——删除不是存在性预言）。
 *  拒绝分类：DocDeleteActiveHandleError（live handle 存在，调用方释放后重试）/
 *  DocDeleteOperationalError（io.removeKey reject——重试收敛）/
 *  DocDeleteFatalError('lifecycle-disposed' | 'adapter-violation')。
 *  只承诺活跃存储逻辑删除（ADR-0014-LOG L299 同款措辞纪律），不承诺 secure erase。 */
readonly deleteDoc?: (owner: User, docId: string) => Promise<Readonly<{ ok: true }>>;
```

- `DocPersistence` 可选、`ReplicaPersistence` **必具**（镜像 `archiveDoc` 放置）；Memory/File
  共享 lifecycle 实现，`index.ts` 导出新错误族。
- **新 IO seam**（`PersistenceIO`，lifecycle.ts）：`removeKey?(key, signal): Promise<void>`
  ——移除该 key 的**全部持久副本**：主键 `.snapshot` + 同名 `.tmp` + 受控归档位
  `{rootDir}/archive/users/{userId}/{docId}.snapshot`（+tmp）。resolve ⟺ 两处此后缺席；
  全程 ENOENT 容忍（`fsp.rm force:true` 逐处）；reject ⟹ 可能部分完成（重试收敛）。
  File 顺序：主键先（提交点）、归档位后；Memory：主 mirror（+`deleteSnapshot` hook 若接线）
  + `archiveSnapshots` 分区 delete。
  **不复用** 既有 `remove`（archive 流程语义 = 仅主键；重载它会破坏归档「不触碰归档区」契约）。

**lifecycle 编排**（镜像 `runArchiveDoc`，三处刻意差异）：

1. `track(runDeleteDoc(key))`（in-flight 记账覆盖全程，dispose allSettled 兼容）。
2. 等待环：`reading/creating/archiving/deleting` cell → await 后重读（镜像 L443-461）。
3. **settle-for-delete**（`settleEntryForArchive` 的删除变体，关键差异）：
   - live 且 `handles.size > 0` → `DocDeleteActiveHandleError`（诚实拒绝）；
   - 零 handle：**取消全部定时器（debounce/maxDirty/retry）并直接驱逐 cell**——被删除的
     doc 不需要 flush 持久化（与归档的「强制即时 flush」不同：删除语义下 flush 是纯浪费，
     且 flush-then-remove 窗口更宽）；
   - `flushing === true`（在途 flush）→ **必须等待其结算**（in-flight `write` 一旦越过入口门
     会跑完 rename → 复活）——经既有 `archiveWaiters` 通知面等待，结算后重入循环。
4. claim `{state:'deleting'}` cell（ABA 守卫，成功/失败路径均 identity 守卫清理，镜像 L527-533）。
5. `io.removeKey!(key, signal)`：reject → epoch 当前 ⟹ `DocDeleteOperationalError`；
   disposed 竞态 ⟹ `DocDeleteFatalError('remove-aborted')`。resolve → cells 守卫删除 →
   `{ok:true}`。
6. capability gate `assertDeleteIo()`（`typeof io.removeKey !== 'function'` → bare loud Error，
   镜像 `assertArchiveIo` L566-575；生产 Memory/File 恒具备）。

**复活向量封堵证明**：(i) pending debounce flush——settle 取消定时器（未点火）或等待
（已点火 in-flight）后 removeKey，之后无任何定时器/句柄能再写该 key；(ii) 新 saveDoc——
cell 已驱逐，`saveDoc` 的 `assertOwnedHandle` → `foreign or released DocHandle` 拒绝；
(iii) 新 loadDoc/createDoc——删除后 key 缺席，loadDoc → null；createDoc 是新 namespace 的
合法重建（D4 语义）。**无需 Host 级 maxDirtyMs 排空 sleep**（Alt-5 否决：既慢又弱）。

### AD-6 Registry `deleteNamespace`（ADR-0009 修订节）

**公共面**（`types.ts` + `registry.ts` + `index.ts` 导出）：

```ts
type DeleteNamespaceIssue =
  | 'NAMESPACE_INVALID_IDENTITY' | 'REGISTRY_NOT_ACCEPTING'
  | 'NAMESPACE_NOT_FOUND'        // 仅 live entry 的 owner 不符（零存在性泄露，镜像 ①）
  | 'NAMESPACE_DELETE_FAILED';   // deleteDoc operational
type DeleteNamespaceResult = Readonly<{ ok: true }> | Readonly<{ ok: false; code: DeleteNamespaceIssue }>;
// registry.deleteNamespace(owner, namespaceId): Promise<DeleteNamespaceResult>
```

- 稳定 message 常量进 `types.ts` 单一真相源（新增 `NAMESPACE_DELETE_FAILED_MESSAGE`；
  其余三码复用既有冻结文本）。
- **编排**（`admitDeleteSlot` + `runDeleteSlot`，镜像 reset 的 ①②⑥⑦ 减法）：
  1. 公共入口同步段：acceptance 检查（`running`，否则 `REGISTRY_NOT_ACCEPTING`）→ 身份文法
     校验（`NAMESPACE_INVALID_IDENTITY`，零 entries/carriers/persistence 访问）→ carrier
     per-key 接纳（与 open/create/reset 同款串行域——**并发 open 与 delete 在同 key 上严格
     序列化**，删除槽结算后迟来 open 得 `NAMESPACE_NOT_FOUND`，原子性由此成立）。
  2. ① live entry owner 核对（不符 → `NAMESPACE_NOT_FOUND`）。
  3. ② capability 前置门：`typeof persistence.deleteDoc !== 'function'` → loud branded
     `NamespaceRegistryFatalError('delete', 'lifecycle-slot-internal', false, cause)` +
     observer `lifecycle-slot-failed`（镜像 L1696-1712；先于一切破坏性动作）。
  4. ③ entry 存在 → 破坏性关闭段（镜像 resetReplica ⑥，**减 beginResetFence**）：
     `forceRelease`（在途 lease 后续操作得 `NAMESPACE_LEASE_RELEASED`）→ `cancelIdleArm` →
     复用/发起 `entry.closePromise`（close barrier 排空已接纳 sequencer slot——slot 内
     完成的最后 saveDoc dirty 由 AD-5 步骤 3 的取消/等待语义吸收，**不复活**）→ await close
     → entries 删除 + I2 记账。**不需要 reset fence 的论证**：fence 防的是「破坏性转变后仍把
     旧 Runtime 当 live 证据/继续接纳写」；delete 的终态是 Runtime 关闭 + 数据删除，fence
     窗口内新接纳的写 slot 会被 close barrier 排空且其 dirty 不被 flush——无处需要 fence。
  5. ④ `persistence.deleteDoc(owner, nsId)`（`typeof` 窄化后 `.call`，防第三方 receiver）：
     - `DocDeleteOperationalError` → `NAMESPACE_DELETE_FAILED`（observer 记 cause）。
     - `DocDeleteFatalError` / **其它 throw（含 `DocDeleteActiveHandleError`）** →
       `NamespaceRegistryFatalError('delete', 'lifecycle-slot-internal', false, cause)`
       （committed 事实：removeKey resolve 后无失败路径，fatal 恒 committed:false）。
       `DocDeleteActiveHandleError` 理论不可达（close barrier 先释放 Runtime 持有的
       handle；T-R1 live-entry 删除绿锚）；若防御性到达，按 ADR-0009 修订节 §5
       （`docs/adr/0009-…md` L165：「`DocDeleteFatalError` / 其它 throw → branded fatal」）
       收敛为 branded fatal——「恒零破坏后无重试必要」以 committed:false 刻画更诚实。Host
       可观察结局与 `NAMESPACE_DELETE_FAILED` 路径相同（均 `delete-namespace-failed` 回执 +
       observer `lifecycle-slot-failed` 记账），**外部语义零变化**（勘误 E-2，§10；AD-8
       失败矩阵 F3/F4 行不受影响）。
  6. ⑤ `{ok:true}`（absent 与 deleted 不可区分——**删除幂等优先于存在性回显**；owner 不符
     仅在 live entry 可判，缺席输入对任意 owner 均 `{ok:true}`，零存在性 oracle）。
- **Registry 观察者/状态面零改动**：`getStatus` 三态不变；不加 observer 事件（Host 已发
  `namespace-deleted`；最小面）。
- **Runtime 公共面零改动**（ADR-0008 无触碰）：close 走既有 `runtime.close()`，不加方法。

**ADR-0009 修订节要点**：v1「不公开 explicit eviction、按 key close」的排除针对**逐出/复用**
语义；`deleteNamespace` 是**终态删除编排**（关闭 + 持久删除 + 不可复活），语义正交，修订节
须逐字区分两者并声明该公共面增量。

### AD-7 复制暴露收口（零 ws-replication 改动）

- 删除发起时（AD-3 步骤 3）同步摘除 bindings/knownNamespaces：新 channel 建立的
  `authorize` → `{ok:false}`（`app.ts:256-264`）→ 拒绝再引导；`read`/`verify-write`/
  `replace-schema`/`bump-epoch` → `namespace-unknown`。
- 已建立 channel：其 lease 指向的 Runtime 被 `deleteNamespace` 关闭 → 下一次 apply/encodeDiff
  读 `lease.getStatus()` 得 runtime 缺席 → 既有错误路径（`hub-namespace.ts:298,474`
  'lease released'）→ `closeSessionAndRelease` → channel 失败收口；peer 重连被 authorize
  拒绝。**无数据复活**（apply 需要活 Runtime；重 open 得 NOT_FOUND）。
- 声明为设计裁决（SA8 复审点）：删除对在途 channel 是**异步失败通知**而非优雅拆除；
  v1 不加 ADR-0010 面（Alt-4 出范围）。新增 host 测试钉死该行为（§6 T-H5）。

### AD-8 失败/幂等语义（B2 显式裁决）

**裁决**：`delete-namespace` 是**复合工作流**，其 `ok:true` 谓词 = 数据与日志**均**完成逻辑
删除（ADR-0014-LOG L299 把日志删除定义为数据删除请求的伴随义务——它不是「日志失败不影响
业务」条款的适用对象；该条款继续管 emit/append/排队/背压/关闭失败对**其它**业务操作的隔离，
本设计零改动）。任一段失败 → 诚实失败回执 + 结构化码；**重入重试是唯一完成路径**（镜像
#154「重入调用 `deleteNamespaceDiagnosticLog` 是唯一完成路径」的 Host 级推广）。

| # | 失败点 | 回执 | 落盘状态 | 重试收敛路径 |
|---|---|---|---|---|
| F1 | 参数/known-set 门 | `invalid-op-args`/`namespace-unknown` | 零触达 | — |
| F2 | registry：`REGISTRY_NOT_ACCEPTING`（停机竞态） | `delete-namespace-failed` | 未动 | 进程已停；**注记**：声明式 provision 下重启会按配置重建 ns（配置是权威，见 R-3） |
| F3 | registry：close 失败 / `NAMESPACE_DELETE_FAILED`（deleteDoc operational，如 EACCES） | `delete-namespace-failed` | Runtime 已关（或关失败）；数据可能仍在 | tombstone 已置 → 二删走幂等路径：close（缺席）→ deleteDoc 重试 → 收敛 |
| F4 | registry：fatal（capability 缺席等实施错误） | `delete-namespace-failed` | 零/部分 | 同 F3（loud，修 implementation 后重试） |
| F5 | 日志删除 `failed{code,step}`（marker/locator/stream/remove 段） | `log-delete-failed` + step + errno | **数据已删**；日志可能半态（deletion.json / `.deleting` 残部） | 重试：`deleteNamespaceDiagnosticLog` N1–N5 重入续走 → 收敛（D2 二删 ok:true 即此路径） |
| F6 | deleteDoc 成功 + 日志 `absent`/`deleted` | `ok:true` | 全清 | —（幂等重入仍 `ok:true`） |

幂等性来源汇总：registry.deleteNamespace（absent→ok）+ deleteDoc（ENOENT 容忍）+
deleteNamespaceDiagnosticLog（`absent` 二值重入）+ Host tombstone（二删不过 known-set 门）。
**单调性**：删除一旦部分完成，重试只前进不回退；无任何路径把「已删」翻回「存在」。

**停机有界性**（AC2 bounded shutdown 兼容）：op 全链为有界 fs 工作 + close drain（slot 级）+
carrier tail（shutdown 已等待的同一机制）；SIGTERM 落在删除中 → `runShutdown` 的 carrier
tail 等待覆盖删除槽；诊断删除在槽外但为有界同步协议；`diagnostics.close()` 语义不变。
不引入任何无界等待、不等待外部 lease release（forceRelease 先例）。

### AD-9 零漂移面（明确不变项）

- **config**：无新键（op 无参数化；`diagnostics.rootDir` 既有）——`config.ts` 零改动。
- **schema/投影/生成物**：零 schema 文本改动；`generate --check` 仍须过（AC4 既有纪律）。
- **wire 协议**（`docs/protocols/instance-replication-v1.md`）：零帧变化。
- **Runtime 公共面 / Registry 状态机三态 / persistence 既有方法**：零语义变化。
- **包边界**：Host 仅消费 `@nomicore/namespace-registry`、`@nomicore/namespace-diagnostic-log`
  公共导出；不 import 包内部 subpath、不触 testing seam。

---

## 3. 变更范围（实施清单；行号为当前 HEAD 锚点）

### 3.1 `packages/persistence`（ADR-0006 修订节伴随）

| 文件 | 变更 |
|---|---|
| `src/contract.ts` | `DocPersistence.deleteDoc?` / `ReplicaPersistence.deleteDoc`（必具）；`DocDeleteActiveHandleError` / `DocDeleteOperationalError` / `DocDeleteFatalError`（含 phase 词表 `lifecycle-disposed` / `adapter-violation` / `remove-aborted`）；`PersistenceIO.removeKey?` 声明移入 `lifecycle.ts`（现状所在），contract 只加 deleteDoc 面 |
| `src/lifecycle.ts` | `PersistenceIO.removeKey?` 接缝注释契约；cell 状态联合 + `'deleting'`；`settleForDelete`；`runDeleteDoc`；`assertDeleteIo`；`deleteDoc` 公共入口（`track` 包装） |
| `src/file.ts` | io 构造加 `removeKey`：`fsp.rm(force)` 主键 snapshot/tmp + 归档 snapshot/tmp（`resolveSnapshotPaths`/`resolveArchivePaths` 复用，SAFE_PATH_SEGMENT 双段守卫既在） |
| `src/memory.ts` | io 构造加 `removeKey`：主 mirror delete（`deleteSnapshot` hook 若接线，纪律同 `remove`）+ `archiveSnapshots.delete(key)`；`dispose` 面零变化 |
| `src/index.ts` | 导出 deleteDoc 类型 + 三个错误类 |
| `docs/adr/0006-server-persistence-docstore.md` | **显式修订节**（issue #228）：deleteDoc/removeKey 契约、放置（可选/必具）、幂等与 ENOENT 容忍、active-handle 拒绝、与 archive 的语义区分（delete ≠ archive：无身份前置、无归档写、清理归档位）、逻辑删除措辞纪律 |
| `test/` | 新增 `doc-delete-*.test.ts`（§6 T-P*） |

### 3.2 `packages/namespace-registry`（ADR-0009 修订节伴随）

| 文件 | 变更 |
|---|---|
| `src/types.ts` | `DeleteNamespaceResult` / `DeleteNamespaceIssue` / `NAMESPACE_DELETE_FAILED_MESSAGE`；`NamespaceRegistry` 面 + `deleteNamespace` |
| `src/registry.ts` | 公共入口（acceptance → 身份 → admitDeleteSlot）；`admitDeleteSlot`/`runDeleteSlot`（§AD-6 编排；破坏性关闭段复用 reset ⑥ 机制） |
| `src/index.ts` | 导出新类型 |
| `docs/adr/0009-namespace-registry-leases-and-host-lifecycle.md` | **显式修订节**（issue #228）：公共 Interface 增 `deleteNamespace`；与「v1 不公开 explicit eviction/按 key close」的语义区分（终态删除 vs 逐出复用）；owner 零存在性泄露；carrier 序列化保证 |
| `test/` | 新增 `registry-delete-*.test.ts`（§6 T-R*） |

### 3.3 `apps/yjs-server`

| 文件 | 变更 |
|---|---|
| `src/app.ts` | dispatch + `case 'delete-namespace'`；`opDeleteNamespace`（G1–G4 + AD-3 全序）；`deletedNamespaces`/`deleteInFlight` 字段；bindings 摘除助手 |
| `src/diagnostics.ts` | `retireNamespace` + `retiredNamespaces` + drop reason `'namespace-deleted'` + `initStream` un-retire（AD-4） |
| `src/config.ts` / `src/main.ts` | **零改动**（op 无配置；stdin 回执路径通用） |
| `test/host-namespace-delete-diagnostic-link-red.test.ts` | 头注更新（红灯→转绿）；D1–D3 断言零改动；D4 断言级仲裁（R-1 行为约束集，SA6 已追认——勘误 E-1，§10） |
| `test/`（新增） | §6 T-H4/T-H5 + AC2 三补足 T-H6–H8 |
| `AGENTS.md` | Management verbs 段补一句：hub-owned `delete-namespace`（终态删除编排 + 日志联动；peer → unknown-op） |

### 3.4 文档/词汇（AC3 对齐——方向 = ADR-0014-LOG 首切片 amendment，后决优先）

| 文件 | 现矛盾文本（亲证） | 目标表述 |
|---|---|---|
| `CONTEXT.md` 「语义 emission」词条（L157 附近） | 「emit 同步、不 throw、不阻塞」 | 「emit 同步、不 throw、不返回 durability promise、不留调用方可变引用（interface 契约）；File adapter 首切片为每 record 至多一条 final JSONL record 的有界同步 append（携带 sidecar 时先一帧 BIN append）——可被文件系统延迟阻塞，任何接入 namespace 生命周期的调用点必须在 NamespaceRuntime write sequencer slot 之外或该 slot 释放之后；不维护 writer queue、不做 batch flush、无 fsync 开关、无常驻 fd（queue/batch/fsync/fd cache 为目标演进形态而非现行特性）」 |
| `packages/namespace-diagnostic-log/README.md` L311-312 | 「`emit`/`append` 同步、**绝不 throw**、绝不阻塞」 | 同上措辞（包 README 版；显式指向 ADR-0011 interface 契约 + ADR-0014-LOG amendment） |
| `packages/namespace-diagnostic-log/AGENTS.md` L16 | 「emit 同步、不 throw、不阻塞、所有权移交」 | 同款修订（消除与同文件 §Boundaries 首切片正确陈述的自相矛盾） |
| `docs/adr/0011-best-effort-namespace-diagnostic-change-log.md` | L24「non-throwing、有界、非阻塞的 emitter seam」 | **澄清性修订节**（issue #228，非决策变更）：『非阻塞』为 interface 级契约（void、不 throw、无 durability promise）；File adapter 实现属性（首切片同步 append 可被 fs 延迟阻塞）由 ADR-0014-LOG 2026-08-28 amendment 定义并为准；调用点纪律（slot 外）援引该 amendment——两文由此一致 |
| `docs/adr/0014-vfsl-validated-jsonl-and-framed-sidecar-change-log.md` | amendment 正文（权威源） | 预期零改动；实施时全文校对一遍，若发现漂移按显式修订节处理（不允许静默改写） |

措辞红线（SA8 B3）：一切公共行为表述指向 `CONTEXT.md`/ADR/`docs/protocols/`；删除语义只说
「活跃存储逻辑删除」，**不出现** erase/purge/secure 字样（#154 词汇纪律延续）。

---

## 4. AC1–AC5 覆盖对照

| AC | 设计落点 | 验收路径 |
|---|---|---|
| **AC1** 同步联动 + 逻辑删除全清单（locator/manifests/JSONL/BIN/deletion markers/indexes；不暗示 secure erase） | AD-2/AD-3/AD-5/AD-6：`ok:true` ⟺ 数据 + `{logRoot}/namespaces/{ns}` 目录树整体 absent（`deleteNamespaceDiagnosticLog` 覆盖清单逐项 = AC1 列表）；措辞纪律 §3.4 | D1（同步窗口断言）+ T-P*/T-R*（单元）转绿 |
| **AC2** 阶段级验收组合（create、ROOT/SCHEMA、trusted replication、restart、retention、logging failure、bounded shutdown、complete/partial/failed replay） | 矩阵既有锚 = SA6 契约 §4 表；本设计补 3 个 host 级缺口 + 1 个删除×复制场景 | §6 验收组合（全量 `pnpm test` + T-H6/H7/H8/H5） |
| **AC3** ADR 0011/0012、CONTEXT.md、README 阻塞特性/调用位置/首切片范围一致 | §3.4 精确编辑清单（后决优先向 amendment 收敛；ADR 触碰走显式修订节） | 文档 diff 评审 + SA8 复审 |
| **AC4** 全量 typecheck、test、生成物/发布检查、`git diff --check`、尾随空格清理 | 零 schema/config 漂移（AD-9） | §6 G 门（root `pnpm typecheck`、`pnpm test`、`generate --check`、`git diff --check`；触达文档尾随空格清理） |
| **AC5** REPORT.md 汇总 + PR #142 title/body + issue #141 同步 | 内容规格 §5（B3：公共行为表述只引权威文档；发布动作归 runner，不属本设计执行面） | 发布阶段（runner） |

---

## 5. AC5 元数据内容规格（发布侧执行；本设计只定内容）

- **根 `REPORT.md`**（阶段汇总，普通 artifact 非机器状态）：新增 issue #228 章节——
  #141/PR #142 阶段结论；#148–#155、#226–#227 各票一行阶段结果（交付物 + 验证证据路径）；
  本票验证证据（D1–D4 绿、全量门结果）；残余风险（§7）。公共行为表述引用
  `CONTEXT.md`/ADR 0011/0014-LOG/0006/0009，不引 `wiki/raw`。
- **PR #142 title/body**：body 增补「namespace 删除联动交付（issue #228）」段——op 面、
  删除语义（逻辑删除/幂等/失败码族）、ADR 修订节清单（0006/0009/0011）、文档对齐清单、
  验证命令与结果。title 若需反映阶段终态由 runner 裁量。
- **tracking issue #141**：验收材料同步（指向 REPORT.md 与 PR #142；引用权威文档）。
- Git 配置残留（冲突报告备案的 `mabf.branch`/`mabf.base-branch` 与本票不符）：总控收尾时
  向 runner 核对，本设计不改 git 配置。

---

## 6. 测试与验收路径

### 6.1 单元/契约级（新增）

| ID | 套件 | 用例要点 |
|---|---|---|
| T-P1 | `packages/persistence/test/doc-delete-semantics.test.ts` | 幂等 absent → `{ok:true}`；内存/file 双 adapter 一致；active handle → `DocDeleteActiveHandleError`，release 后重试成功 |
| T-P2 | 同上 | **复活向量 (i)**：零-handle dirty entry（虚拟钟推进前）delete → 推进钟越过 maxDirtyMs → 快照仍缺席（定时器被取消）；`flushing` 在途 → 等待后删除、无重建 |
| T-P3 | `packages/persistence/test/doc-delete-storage.test.ts` | file：主键 + `.tmp` + 归档位全清、ENOENT 容忍、部分失败重试收敛；memory：双分区清理、`deleteSnapshot` hook 纪律 |
| T-P4 | 同上 | disposed → `DocDeleteFatalError('lifecycle-disposed')`；`removeKey` 缺席 → capability gate loud Error |
| T-R1 | `packages/namespace-registry/test/registry-delete-orchestration.test.ts` | live entry（持 lease）删除：slot 排空、lease 后续操作得 released、entry 移除、deleteDoc 恰一次；idle entry；无 entry + 无数据 → `{ok:true}` |
| T-R2 | 同上 | owner 不符（live）→ `NAMESPACE_NOT_FOUND` 零泄露；shutting-down → `REGISTRY_NOT_ACCEPTING`；文法违约 → `NAMESPACE_INVALID_IDENTITY` 零访问 |
| T-R3 | 同上 | **并发序列化**：open 与 delete 同 key 交错 → open 在删除后得 NOT_FOUND；carrier tail 语义 |
| T-R4 | 同上 | deleteDoc operational → `NAMESPACE_DELETE_FAILED` + 重试收敛；fatal 映射（observer `lifecycle-slot-failed`）；capability 缺席 → branded fatal |

### 6.2 Host 级（进程 E2E）

| ID | 文件 | 用例 |
|---|---|---|
| T-H1–H4 | `host-namespace-delete-diagnostic-link-red.test.ts`（现有红灯） | D1 同步联动+干净停机 / D2 幂等二删 / D3 参数门+进程存活（三者零断言改动转绿）；D4 重启不复活 = R-1 行为约束集（重启健康 + provision 重建**新 CSPRNG 身份** `.not.toBe(旧 id)` + 旧目录树/旧 stream 零复活 + 新流≠旧流 + 无 deletion.json 半态）——断言级仲裁，SA6 追认已批准（勘误 E-1，§10） |
| T-H5 | 新增 `host-namespace-delete-under-replication.test.ts` | 活跃 peer channel（trusted 复制中）发起 delete → 数据/日志全清；channel 失败收口不崩溃；后续 peer 重连/重试窗口内**无快照复活**；hub 健康（AD-7 行为锚） |
| T-H6 | 新增 `host-diagnostic-restart-resume.test.ts`（AC2 restart 正向补足） | 正常重启（无删除）→ current.json 续写同 stream、记录 sequence 连续（#153 语义 host 级锚） |
| T-H7 | 新增 `host-diagnostic-retention-sweep.test.ts`（AC2 retention 补足） | config retention 透传 → 关闭段被 sweep、open group 不删、reader lease 门（包级行为的 host 级组合证据） |
| T-H8 | 新增 `host-trusted-replication-diagnostics.test.ts`（AC2 trusted+diag 补足） | peer trusted apply → committed 记录落盘 + strict replay 与数据一致（complete 态） |

### 6.3 AC2 阶段验收组合（最终门，总控在实现轮后编排）

全量 `pnpm test`（含上表全部 + 既有锚：`diagnostic-replay-host-lifecycle-red` E1–E4/R1–R11、
`-sa7` D8/M2、`file-adapter-*` 全系、`registry-phase5-replication*`、`node-hub-peer-live`、
`ordered-shutdown-red` 等——SA6 契约 §4 矩阵逐行闭合）＋ 工程门 G：

```
pnpm typecheck && pnpm test && <generate --check（ADR-0005 纪律，零漂移应过）> && git diff --check
```

---

## 7. 残余风险与非目标（如实备案）

- **R-1 声明式 provision 与删除的张力**：`hub.provision` 配置存在的 namespace，删除后重启会
  被 provision **按配置重建**（D4 第二分支即此语义：新 namespace、新流、新身份）。这是配置
  权威性的既定行为，不是缺陷；运维要「保持删除」须同时移除 provision 条目。REPORT.md 残余
  风险节明示。**R-1×D4 交叉注记（勘误 E-1，§10）**：provision 重建经 `registry.create`
  每次派生**新 CSPRNG 身份**（`randomBytes(16)` → `ns-`+32 hex，registry.ts L204/L854-892），
  与已删 id 相等概率 2^-128——不存在「重启后确定性派生同 namespaceId」机制；D4 的「不复活」
  由反锚刻画（新身份 `not.toBe` + 旧日志目录树/旧 stream 缺席 + 新流≠旧流），安全语义较原
  「同 id 派生」表述只增不减。确定性恢复同一 namespaceId 仅存在于「数据仍存续 + 直引
  authorization 显式 id」的重启形态（T-H6 boot2；#155 E5/T6 先例），与 D4 删除后场景互斥。
- **R-2 在途 channel 的异步通知**：删除不优雅拆除活跃复制 channel（Alt-4 出范围）；channel
  在下一次操作时失败收口。T-H5 钉住可观察行为；未来演进 = ws-replication per-namespace
  拆除 API（需 ADR-0010 修订节）。
- **R-3 非 Owner 输入的零预言边界**：缺席 namespace 的删除对任意 owner 回 `{ok:true}`
  （幂等优先）；live entry 的 owner 不符才回 `NAMESPACE_NOT_FOUND`。已在 ADR-0009 修订节
  明示该不对称。
- **R-4 归档位清理的防御性**：hub 侧正常流量不产生归档（reset-replica 是 peer 侧），归档位
  清理覆盖手工/迁移残留；Memory `deleteSnapshot` hook 接线纪律与 remove 同款。
- **非目标**：物理 secure erase（SSD/备份/对象存储版本——部署策略）；批量/按前缀删除；
  peer 侧 `delete-namespace`（reset-replica/archive 域）；诊断日志 writer queue/batch/fsync
  （目标演进形态，非现行特性，文档不得表述为已交付）。

---

## 8. SA8 复审需求判定（requiresConflictRecheck = **true**）

本设计触碰以下需设计后 SA8 复审的边界（对应任务简报「公共面、协议、状态机、持久化、安全
边界」逐项裁定）：

| 边界 | 触碰点 | 是否需复审 | 依据 |
|---|---|---|---|
| 公共面（冻结 v1 接口） | `DocPersistence/ReplicaPersistence.deleteDoc`、`PersistenceIO.removeKey`、`NamespaceRegistry.deleteNamespace`、Host op 闭集 11→12 | **是** | B1 明文：「扩展冻结 v1 公共接口……必须以显式 ADR 修订节/新 ADR 备案，不得静默扩面；设计后 SA8 复审须核对该演进已正式化」——本设计已定修订节义务（§3.1/3.2/3.4），SA8 须核对落文与语义区分（delete ≠ eviction ≠ archive） |
| 协议（wire） | 零帧变化；channel 失败收口走既有错误路径 | 否（备案） | AD-7；但 R-2 的行为裁决建议 SA8 一并过目 |
| 状态机（Registry/Runtime/复制） | per-key 破坏性关闭（forceRelease + close drain）在活 lease/活 channel 下执行；carrier 序列化原子性；减 reset fence 论证 | **是** | AD-6 步骤 4 的「减 fence」与 shutdown/reset 先例的边界外推属设计裁量，须 SA8 对 ADR-0008/#132 四方法槽纪律与 ADR-0009 shutdown 语义复核 |
| 持久化 | `deleteDoc`/`removeKey`/`settleForDelete`（取消定时器不 flush、等待在途 flush、claim 'deleting'） | **是** | ADR-0006 接口闭集演进 + 复活向量封堵证明的正确性（AD-5）须 SA8 复核 |
| 安全边界 | 路径文法（复用 SAFE_PATH_SEGMENT/isSafeNamespaceId）；owner 零存在性泄露；logRoot 信任边界；参数门零 fs 触达 | 是（轻） | AD-2 G2/G3、AD-6 ①；与既有门禁同款，SA8 抽查即可 |
| B2 同步联动 + 隔离语义 | 复合工作流 ok 谓词、重入唯一完成路径、调用点纪律（slot 外） | **是** | 冲突报告 B2 明文要求「设计须显式裁决并过 SA2/设计后 SA8」——AD-8 即该裁决，待复审确认 |
| 文档措辞（B3/AC3） | ADR-0011 澄清性修订节 + CONTEXT.md 词条 + 两处包文档 | 是 | 「触及 ADR 原文必须显式修订节」；对齐方向（后决优先）已定，SA8 核对措辞不引 queue/batch 为现行特性 |

---

## 9. 交付物

- 本文件：`wiki/raw/task_228_design.md`（架构设计；AC1–AC5 覆盖、变更范围、失败/幂等语义、
  测试与文档/元数据验收路径、SA8 复审判定；round 2 附勘误记录 §10）。
- 结构化结果（round 1 提交值）：`artifactPaths = [wiki/raw/task_228_design.md]`，
  `requiresConflictRecheck = true`（§8 依据）。
- 结构化结果（round 2 勘误轮提交值）：同 artifactPaths；
  `requiresConflictRecheck = false`（§10.4 判定——勘误非架构变更，不触碰 ADR 冻结面）。

---

## 10. 勘误记录（errata round 2 —— 文档勘误，非架构变更）

> 勘误轮（dispatch `sa-8ad6e2f2-9adf-4b57-b948-511f6c695d3f`，phase design，iteration 1）。
> **性质声明：本节为可审计文档勘误**——修正 round 1 设计文本与已批准事实（实现代码、
> ADR-0009 修订节 §5、SA6 已批准追认）之间的表述不一致。**不是架构变更**：AD-1~AD-9
> 架构裁决、§3 文件范围、AD-8 失败矩阵的对外语义均零变化；本轮零生产代码/测试改动、
> 不 commit/push、不创建 PR。Issue 评论权威 REST 读取 = `[]`（无 Owner 追加要求；
> 评论 ID/updated_at：无）。

### 10.1 评审修订映射

| Finding | 勘误位置 | 处理结果 |
|---|---|---|
| SA4 F-1 + SA6 追认 §5.1-①（`task_228_sa6_f1_ratification.md`，verdict=approve）：AD-2「D1–D4 断言零改动即应转绿」隐含「重启后确定性派生同 namespaceId」前提——与 CSPRNG `randomBytes(16)` 事实物理不相容（原 D4 断言对任何正确实现不可满足） | AD-2「表面」段转绿基线；§3.3 红灯测试文件行；§6.2 T-H1–H4 行；§7 R-1 追加 R-1×D4 交叉注记 | **E-1 落实**：改述为「D1–D3 零断言改动；D4 = 断言级仲裁后的 R-1 行为约束集」（重启健康 + 重建新 CSPRNG 身份 `not.toBe` + 旧目录树/旧 stream 零复活 + 新流≠旧流 + 无 deletion.json 半态）——与 SA6 已批准追认、D4 实际契约（测试 L383-408）及已批准 R-1/AD-4 逐项一致（依据见 §10.2） |
| SA4 F-2 + SA3 notes §3.2（同批移交 SA1 勘误）：AD-6 步骤 5 将 `DocDeleteActiveHandleError` 写为「防御性映射 `NAMESPACE_DELETE_FAILED`」，与实现（registry.ts `runDeleteSlot` ⑤：Operational 之外一律 branded fatal）及 ADR-0009 修订节 §5 两方不一致（三方文本不一致，外部不可见） | AD-6 步骤 5 映射列表 | **E-2 落实**：对齐为「`DocDeleteFatalError` / 其它 throw（含 ActiveHandle）→ branded fatal（committed:false）」；**外部语义零变化**——Host 两映射路径可观察结局相同（均 `delete-namespace-failed` + observer `lifecycle-slot-failed`），AD-8 失败矩阵 F3/F4 行无需改动（依据见 §10.3） |

### 10.2 E-1 事实依据（本轮亲证）

| # | 事实 | 证据锚点 |
|---|---|---|
| 1 | namespaceId 每次 `registry.create` 由受控 128-bit CSPRNG 派生：`randomBytes(16)` → `ns-`+32 小写 hex；形状/编码违约立即 fatal；无任何「按配置固定 id / 确定性恢复」机制 | `packages/namespace-registry/src/registry.ts` L204（`NAMESPACE_ID_RANDOM_BYTES = 16 // 128-bit CSPRNG`）、L854-892（`generateNamespaceId`） |
| 2 | Host 每次启动对每条 provision 条目无条件执行 `registry.create`（无 namespaceId 入参）→ 恒 fresh id | `apps/yjs-server/src/app.ts` L241 `bootHub` → L278 → L315-327 `provision()`（`registry.create({owner, schema, root})`，拒绝时 throw） |
| 3 | 原 D4 断言「重启后 namespaceId 确定性派生 `.toBe(已删 id)`」物理不可满足（CSPRNG 均匀 16 字节，等概率 2^-128）——保留即永红 = 契约自毁 | SA6 追认 §2 T5–T7；SA3 notes §3.1 |
| 4 | D4 实际契约（仲裁后行为集）：重启健康（新 id 匹配 `/^ns-[0-9a-f]{32}$/`、provisioned/ready、SIGTERM exit 0）+ `.not.toBe(旧 id)` + 旧日志目录树/旧 stream 双缺席 + 新流 `.not.toBe(旧流)` + 重建树无 deletion.json | `apps/yjs-server/test/host-namespace-delete-diagnostic-link-red.test.ts` L383-408（用例内仲裁注记 + 断言）、L5-12（头注：D1–D3 零断言改动；D4 断言级仲裁） |
| 5 | 该仲裁已经 SA6 独立追认 approve（正确/充分/未削弱验收义务；D4 语义红线「重启不复活、进程健康、无 marker 半态」零改动，断言强度净增）；SA6 契约档案 D4 行随批修正 | `wiki/raw/task_228_sa6_f1_ratification.md` §0/§3；`task_228_sa6_acceptance_contract.md` §2/§7 |

### 10.3 E-2 事实依据（本轮亲证）

| # | 事实 | 证据锚点 |
|---|---|---|
| 1 | 实现：`runDeleteSlot` ⑤ 仅 `DocDeleteOperationalError`（或 code `DOC_DELETE_OPERATIONAL`）→ `NAMESPACE_DELETE_FAILED`；其余一切拒绝（含 `DocDeleteActiveHandleError`、`DocDeleteFatalError`、未分类 throw）→ branded `NamespaceRegistryFatalError('delete', 'lifecycle-slot-internal', false, cause)` + observer `lifecycle-slot-failed` | `packages/namespace-registry/src/registry.ts` L1962-1985（含 iteration 3 对齐后的注释） |
| 2 | ADR-0009 修订节 §5（已接受规范文本）与实现一致：「close 失败 / deleteDoc operational → `NAMESPACE_DELETE_FAILED`；`DocDeleteFatalError` / 其它 throw → branded fatal（committed:false 恒真）」 | `docs/adr/0009-namespace-registry-leases-and-host-lifecycle.md` L165（issue #228 修订节第 5 条） |
| 3 | ActiveHandle 分支理论不可达（close barrier 先释放 Runtime 持有 handle；T-R1 live-entry 删除绿锚在场）；防御性收敛为 fatal 的理由：恒零破坏后无重试必要，committed:false 刻画更诚实 | registry.ts L1976-1979 注释；`packages/namespace-registry/test/registry-delete-orchestration.test.ts` |
| 4 | 外部语义零变化：Host 侧两映射路径可观察结局相同（`delete-namespace-failed` 回执 + observer 记账）；SA4 F-2 裁定「外部不可见，不阻断」 | `task_228_sa4_review.md` 发现清单 F-2；`task_228_sa3_implementation_notes.md` §3.2 |

### 10.4 勘误轮冲突复查判定

`requiresConflictRecheck = false`。理由：(a) 两处勘误均为**文本与已批准事实的对齐**，零
公共 API/协议/wire/schema/持久化/状态机语义变化，不触碰任何 ADR 冻结面（ADR-0009 修订节
§5 为已接受文本，本勘误只引用不改写）；(b) 未修订任何已批准决策——D4 行为约束集是 SA6
已追认的既有 R-1 裁决的语言对齐，ActiveHandle 映射以已接受 ADR 修订节 §5 为准；
(c) §8 所列 round-1 复审需求已由设计后 SA8 复审闭合（`task_228_design_conflict_report.md`
verdict=**clear**）。SA8 收尾门禁轮对「F-1 仲裁 + 本勘误一致性」的追认属总控既有路由
（SA6 追认 §5.2、SA3 notes §4 均已列），非本勘误轮新增义务。

### 10.5 范围外备案（知悉、不在本勘误轮执行）

- **SA4 F-4**（design §3 ALLOW LIST 补录 4 个清单外落点：registry `src/errors.ts`/
  `src/observer.ts`、persistence `src/testing.ts`、`docs/integration/hub-peer-deployment.md`）：
  不在本 dispatch 勘误范围（本 dispatch 仅 E-1/E-2 两项）——移交总控另行路由；补录与否不
  影响本勘误的效力。
- **SA2 review §5.2 D4 行**「重启 provision 重建同 namespaceId（确定性派生）」同源错误：
  SA6 追认 §5.1 建议一并勘误，但 `task_228_sa2_review.md` 属其他 SA 产物（SA1 只读输入），
  本轮不修改；处置方式归总控决定。
- **AD-8 F2 行注记「（配置是权威，见 R-3）」交叉引用滑误**（该语义指向 R-1 provision 条目）：
  勘误范围外的表述性滑误，备案供收尾轮处置（不影响任何裁决语义）。
