# Issue #140 Phase 5 收口 — app 黑盒管理动词面（`replace-schema` / `bump-epoch` / `reset-replica`）防弹设计

- 工位：`/home/wangjian/nomicore-fix-issue-140`（branch `fix/issue-140-on-docs-phase-5-websocket-replication`）
- 任务类型：Feature（Phase 5 收口，切片 10）
- 输入锚：
  - 任务简报 `wiki/raw/task_issue-140-phase-5-websocket-replication.md`（八条 AC + Phase 1 SA6 记录）
  - SA6 红灯报告 `wiki/raw/task_issue-140_sa6_red.md`（3 failed / 3 passed 基线 + 实现方向意图声明）
  - 红灯测试 `apps/yjs-server/test/phase5-three-instance-acceptance-red.test.ts`（6 用例，SA6 owned）
  - 相关决议 `wiki/raw/task_issue-140-phase-5-websocket-replication_relevant_decisions.md`（ADR 0010 全条款 + #134/#133 round-2/#161/#172 修订节）
- 基线：HEAD `469ca36`（Phase 5: deliver deployable Hub and Peer yjs-server app (#186)）
- 修订记录：
  - R1（2026-08-30，响应 SA2 reject）：**A-1**（MAJOR）§3.3 G5 显式裁决 `peerOwners` 三步维护（G5a delete 于 removeTarget 前 / G5c set 于成功后 / catch 保持 deleted）+ 竞态表补 `remove-target`/`add-target` 并发两行（三交错窗终态推演）+ §4.3 闭环补充 + §6.1 重试指引对齐 + §9 补 E11/E12 依据锚；**A-2** G5 catch 改标结构性防御边界（引 no-throw 证据）、§3.5 `replica-reset` 事件收敛为仅成功分支（去 `restarted` 字段）、§4.6/§7 失败表述拆「结构性防御」与「现实重引导链失败」两态；**A-3** §3.1 G2 增补 `root` 形状门禁（非 plain object 含 `null` → `invalid-op-args`）+ null 二义性论证 + §6.1 动词表注明；**A-4** §6.2 修改半径补 phase-5 切片 9 行事实修正；观察项 O-1/O-2/O-3 吸收（§3.3 竞态表停机/读并发两行扩充 + §3.2 断言序依赖段），O-4 核实**不适用**（`BumpReplicationEpochResult` ok 分支为窄 `{ok:true}` 不携带 epoch，`replication-write.ts:90`，SA1 复核与 SA2 观察前提相反）。AD-1/AD-2/AD-3 与 §8 文件清单半径不变（SA2 确认 `peerOwners` 维护在 ALLOW LIST 的 `app.ts` 内）。
  - R2（2026-08-30，响应 SA4 R1 reject）：**R1** §3.1「root 参数契约」补 keep-root × schema 演进条目（`schema-replace.ts:181-188` 双证 + 泛化口诀）+ §9 补 E15；**R2** §3.1 补「原样透传、严禁重建对象」裁量（app 不重复语义校验也不静默剥离额外键）；**R3/R4** 锚测试 `signal ?? undefined` 基建修正与锚入库（SA6/SA3 分工，见 §8）。
  - R3（2026-08-30，响应 SA7 fail-needs-fix / F1）：**F1** §3.3 G5b 增补「addTarget 前等待 controller 收口结算」（预算 closeTimeoutMs+边距，超限 → `reset-replica-failed`——CLOSE 路径 removeTarget 结算与 controller 到达 closed 之间可存在竞争窗口，引擎 addTarget 对 closing 态落入合流分支零动作 → 通道永久 closed、多轮 bump→fence→reset 循环断裂）+ `opAddTarget` 幂等短路改**状态感知门**（终态 closed/conflicted/failed 放行 re-add——文档化恢复入口不被 G5c 恢复的幂等集拦截为伪 ok:true 零动作）；§3.3「G5 失败的二分」→ 三分（throw 结构性防御 / 收口结算超限真实失败 / 重引导链失败）+ §4.6/§7 同步拆行 + §3.3 竞态表 add-target 行短路门语义修正 + §9 补 E16（E11 同步标注 F1 修正）+ §6.1 部署文档措辞（reset 行 ok 语义、add-target 行幂等语义、管理动词节冻结次序）。
  - R4（2026-08-30，响应 SA4 R3 narrow reject **B1**）：§8 ALLOW LIST 显式追加 `apps/yjs-server/test/phase5-mgmt-verbs-sa7.test.ts`（`[SA7 owned]`，与 SA6 锚同款模式）——纯 scope-accounting 修正：SA7 复验收编测试文件此前未列入 ALLOW，SA4 file-set 比对缺口；设计正文、架构决策、其余清单条目零变化。

---

## 0. 任务定位（一句话）

三个红灯共享**同一实现缺口**：`apps/yjs-server/src/app.ts` 的 stdin 控制面 dispatch 表（`app.ts:444-470`）只暴露自检动词，hub 侧 `replaceSchema` / `bumpReplicationEpoch` 与 registry 侧 `resetReplica` 这三个已交付的嵌入宿主能力没有黑盒管理入口——本设计 = **app 控制面三个新动词的薄接线 + 重引导编排 + 文档对齐**，不引入任何新引擎语义。

## 1. 需求推演（Feature 切入点分析）

### 1.1 红灯根因矩阵（全部 = 同一根因，非三件事）

| 红灯 | SA6 断言 | 失败证据 | 根因 |
|---|---|---|---|
| AC3-① `replace-schema` | `replaced.ok === true` 后 hub 写 `note` 三处收敛 | 回执 `{ok:false, code:'unknown-op'}` | dispatch 表无 case；hub lease `replaceSchema()`（`packages/namespace-registry/src/types.ts:584`）已交付但黑盒不可达 |
| AC3-② `bump-epoch` | `bumped.ok === true` 后双 peer stdout 出现 `identity-conflicted` 事件；hub 后续写不收敛 | 回执 `{ok:false, code:'unknown-op'}` | dispatch 表无 case；lease `bumpReplicationEpoch()`（`types.ts:597`）+ hub fence 链（watchdog → `IDENTITY_CHANGED` → 双侧 conflicted，`packages/ws-replication/src/hub-namespace.ts:720-750`）已交付但触发面不可达 |
| AC3-③ `reset-replica` | 错误 expected → `code === 'NAMESPACE_RESET_IDENTITY_MISMATCH'` 零破坏；正确 expected → 归档重引导收敛 | 回执 `{ok:false, code:'unknown-op'}` | dispatch 表无 case；registry `resetReplica()`（`packages/namespace-registry/src/registry.ts:1943`，编排槽 `runResetSlot:1605-1758`）+ peer `removeTarget`/`addTarget`（`packages/ws-replication/src/peer-connection.ts:216-254`）已交付但编排不存在 |

### 1.2 已交付能力盘点（本设计只做接线，不重造）

逐项带证据行号（SA2/SA4 可复核）：

| 能力 | 证据 | 对本任务的含义 |
|---|---|---|
| hub lease `replaceSchema(input)`：SCHEMA 唯一写槽（compile → 单事务 → installActive → notifyDirty），入 FIFO write sequencer | `packages/namespace-runtime/src/schema-write.ts:102`（`runSchemaWriteSlot`）；lease 面 `types.ts:584` | AC3-① 的本地写入面直接可用 |
| SCHEMA update 向 peer 单向复制（hub→peer 受保护字段集 = META 全键，SCHEMA/ROOT 放行） | ADR 0010「SCHEMA 与 META 权限」节（决议摘录 L55）；peer apply 放行链为切片 3/4 既有绿测覆盖 | AC3-① 传播零新代码 |
| hub lease `bumpReplicationEpoch()`：epoch 管理槽，overflow 拒绝 | `packages/namespace-runtime/src/replication-write.ts:372`；lease 面 `types.ts:597` | AC3-② 的本地提升面直接可用 |
| fence 链：hub-namespace 每通道 `FenceWatchdog`（`idleProbeMs = timeouts.ackTimeoutMs`，缺省 10s + 每通道事件微任务节奏）探测 `session.currentEpoch !== replicationEpoch` → `oneShotTerminal()` 发 `IDENTITY_CHANGED` 帧 + `identity-conflicted('fence')` + `finalize('conflicted')` | `packages/ws-replication/src/hub-namespace.ts:187-193`（watchdog 构造）、`720-750`（one-shot 终结器）；`packages/ws-replication/src/fence-watchdog.ts:98-122`（probe 谓词）；`packages/ws-replication/src/defaults.ts:39`（ackTimeoutMs=10s） | AC3-② 的 fencing 零新代码，只需触发 |
| peer 收 `IDENTITY_CHANGED` → `identity-conflicted('identity-changed-frame')` + `finalize('conflicted')` | `packages/ws-replication/src/peer-namespace.ts:617-618` | AC3-② 断言的事件源已存在 |
| app observer 直通：包事件 `type` 字段改名 `event` 后 NDJSON stdout | `apps/yjs-server/src/app.ts:157-160` | peer 侧 `identity-conflicted` 事件测试可直接消费 |
| registry `resetReplica(owner, nsId, expected)`：owner 零存在性泄露核对 → capability 门 → fence 双源（live + persisted committed）严格核对 → mismatch 零破坏拒绝 → armed 后 close admission（先终止 session）+ forceRelease + 归档 → `{ok:true}` = bootstrap 资格 | `packages/namespace-registry/src/registry.ts:1605-1758`；issue 联合 `types.ts:372-404` | AC3-③ 的 guarded reset 核心直接可用 |
| Memory/File 双 adapter 的 `importDoc` / `archiveDoc` / `readPersistedReplicationIdentity`（ReplicaPersistence 级能力） | `packages/persistence/src/memory.ts:141-160`；`file.ts:98-105` | AC3-③ 在 memory（测试）与 file（运维）均可行 |
| peer `removeTarget`：生命周期矩阵全态有界结算（conflicted/failed → 立即零 wire；live → `CLOSE_NAMESPACE` → `CLOSE_OK` 或 `closeTimeoutMs` 兜底 = 缺省 5s） | `packages/ws-replication/src/peer-namespace.ts:644-705`；timer 缺省 `defaults.ts:38` | reset 后通道收口面 |
| peer `addTarget`：终态（closed/conflicted/failed）重 add → §14.1 整连接重建 → `targeted` → 重 OPEN → bootstrap | `packages/ws-replication/src/peer-connection.ts:228-233` | reset 后重引导面 |
| peer bootstrap：hub 广告身份为 expected 的 `importReplica`（detached apply + 严格核对 + 排他创建） | `packages/ws-replication/src/peer-namespace.ts:412-455` | 重引导后的身份继承零新代码 |

**推论**：三个红灯的修复半径 = `apps/yjs-server/src/app.ts` 的 dispatch 表 + 三个 handler + 一个编排 helper；外加稳定码注册表与两份文档。`packages/**` 零改动。

## 2. 架构决策（三条，均给出推翻现状的检查与理由）

### AD-1 reset 编排归属 composition root（app 层薄组合），不进 `@nomicore/ws-replication` 公共 API

- `docs/phases/phase-5-websocket-replication.md:186-187` 将「peer 侧 resetReplica 编排（ws-replication 层未暴露 reset 面）」登记为 known gap。本设计**显式裁决该 gap 的闭合方式 = app 层组合**（registry `resetReplica` + peer `removeTarget`/`addTarget`），不新增 `PeerReplication.resetReplica()` 公共方法。
- 理由：
  1. ADR 0010 的冻结动词是 Registry API（「Peer 冲突恢复使用带 expectedLocalIdentity 的 resetReplica()」，L57），从未要求 transport 层持有编排权；「包、应用与生命周期」节把 apps/yjs-server 定位为「装配 …… 配置加载」的 composition root——宿主编排职责。
  2. ADR 0010 L84 明示第三方 Host 直接基于公开 `NamespaceLease`/`ReplicationSession` 构造可信 transport——编排在包内会固化单一拓扑假设，违反「不提前提取 transport-independent replication package」的边界。
  3. SA6 红灯报告 §2.3 的意图声明同向（「registry resetReplica + peer removeTarget/addTarget 重开通道」）。
- 兼容性检查：不推翻任何现有设计；phase-5 文档「未交付边界」节对应行将在本任务中改写为「编排已随 app 管理动词交付（归属 composition root），ws-replication 不引入 reset 编排 API」——登记口径修正，非契约变更。

### AD-2 reset 编排冻结次序：`resetReplica` 先行（前置核对），成功后才 `removeTarget` → `addTarget`

两种次序的对比推演：

| | 方案 A：先 `removeTarget` 再 reset | **方案 B（采纳）：先 reset 再 removeTarget/addTarget** |
|---|---|---|
| 错误 expected（mismatch） | channel 已被关闭——本地数据零破坏（fence 在 armed 前拒绝），**但复制通道停摆且不自动恢复**（需运维再 add-target）；「零破坏」被 app 编排收窄为「零数据破坏」 | `resetReplica` 在 fence 双源核对处直接返回 `NAMESPACE_RESET_IDENTITY_MISMATCH`（`registry.ts:1707-1709`），**channel 全程不动，复制继续**——与 ADR 0010 #133 round-2「零破坏性动作」逐字对齐 |
| 正确 expected | removeTarget 收口后走 ⑤ active generation（entry idle 在册）| reset 槽 ⑥ `close admission`（先终止/detach ReplicationSession）+ `forceReleaseOutstandingLeases`（`registry.ts:1715-1737`）——registry 已编排 session 终止，channel 的 lease 被强制释放后由后续 removeTarget 收口 controller |
| 幂等/竞态 | removeTarget 与 reset 之间引入额外窗口 | 单一权威编排（registry carrier FIFO 串行域），app 只做后置清理 |

方案 B 的收尾依赖一个已核实的行为：`resetReplica` 成功后 peer-namespace controller 的**投影不自动迁移**（peer 侧 watchdog 只探测 `needsResync`，`fence-watchdog.ts:112-113`；session `runtime-close` 不触发 peer channel 状态机收口）——因此**必须由 app 显式 `removeTarget` 收口 controller**（live 态发 `CLOSE_NAMESPACE`，hub 侧回 `CLOSE_OK`，`closeTimeoutMs` 5s 兜底），再 `addTarget` 走 §14.1 整连接重建重引导。这不是可选清理，是编排的必要后半段。

**次序冻结**（实现伪代码见 §3.3）：
1. `await registry.resetReplica(owner, nsId, expected)` —— 失败即透传回执，**零通道动作**；
2. `await peer.removeTarget(nsId)` —— 幂等收口（conflicted/failed 立即；live ≤ 5s）；
3. `peer.addTarget({namespaceId, localOwner:{userId}})` —— 同步入队 §14.1 重建 + 重 OPEN + bootstrap；
4. sink `replica-reset` 事件 → 回执 `{ok:true}`。

### AD-3 稳定码策略：hub 两动词折叠 `write-failed`，reset 动词透传 registry 窄 issue 码

- `replace-schema` / `bump-epoch` 的一切 runtime/lease 层失败（SCHEMA compile issues、`REPLICATION_NOT_ENABLED`、`RUNTIME_WRITE_DISABLED` 系、released、`RuntimeWriteFatalError` rejection）折叠既有码 `write-failed`——与 `opVerifyWrite` 对 `mutateRoot` 失败的折叠先例（`app.ts:533`）一致；这两类失败的诊断归属嵌入宿主 API 面，黑盒回执不承诺 issues 透传。
- `reset-replica` **必须透传**：SA6 断言 `wrong.code === 'NAMESPACE_RESET_IDENTITY_MISMATCH'`（红灯报告声明「动词命名与回执稳定码以本文件断言为契约起点」）。透传集合 = registry `ResetReplicaIssue` 全联合（`types.ts:372-399`）：`NAMESPACE_INVALID_IDENTITY` / `REGISTRY_NOT_ACCEPTING` / `NAMESPACE_NOT_FOUND` / `NAMESPACE_RESET_IDENTITY_MISMATCH` / `NAMESPACE_RESET_FAILED` / `NAMESPACE_LOAD_FAILED` / `NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID`。branded fatal（`NamespaceRegistryFatalError` rejection）→ catch 折叠新码 `reset-replica-failed`。
- `lifecycle.ts` 的 `STABLE_OP_ERROR_CODES`（append-only 注册表，`lifecycle.ts:102-110`）追加 8 个码（7 透传 + `reset-replica-failed`）。该常量仅从 `index.ts:28` 公共导出、无测试形状锚定（全仓 grep 仅两处引用，见 §9 假设表 E7），append 不破坏导出面。

## 3. 详细设计

### 3.1 D1 `replace-schema`（hub 专属）

**请求**：`{"op":"replace-schema","id":…,"namespaceId":"ns-…","schema":{lang,version,id,text},"root"?:<plain JSON>}`

**回执**：成功 `{"event":"reply","op":"replace-schema","id":…,"ok":true}`；失败 `{ok:false, code:<稳定码>}`。

伪代码（handler `opReplaceSchema`，挂 `app.ts` dispatch 表）：

```ts
case 'replace-schema': return this.opReplaceSchema(args);

private async opReplaceSchema(args): Promise<Reply> {
  // G1 角色守卫（与 request-reauth 同款：hub 专属，peer → unknown-op）
  if (this.role !== 'hub' || this.registry === undefined) return { ok:false, code:'unknown-op' };
  // G2 参数门禁 → invalid-op-args
  const { namespaceId, schema } = args;
  if (typeof namespaceId !== 'string' || !NAMESPACE_ID_PATTERN.test(namespaceId)) return invalid;
  // schema 四键形状门禁（最小分层：形状归 app、编译语义单源归 runtime compile）
  if (!isPlainObject(schema)
      || typeof schema.lang !== 'string' || typeof schema.id !== 'string'
      || typeof schema.text !== 'string'
      || typeof schema.version !== 'number' || !Number.isSafeInteger(schema.version)) return invalid;
  // root 形状门禁（R1/A-3）：提供时必须 plain object（ROOT 恒 Y.Map 物化——ADR 0003，
  // logical ROOT snapshot 合法域 = plain JSON 对象；null/数组/标量一律 invalid-op-args，
  // 与 schema 形状错同码族——write-failed 只留给真实写失败）
  if ('root' in args && !isPlainObject(args.root)) return invalid;
  // G3 known-set 门禁（owner 来源 = hub 侧 knownNamespaces，与 read/verify-write 同款）
  const ownerUserId = this.knownOwner(namespaceId);
  if (ownerUserId === undefined) return { ok:false, code:'namespace-unknown' };
  // G4 open → replaceSchema → release（与 opRead 同款 lease 模式；无 F1 重试——见 §4.4）
  const opened = await this.registry.open({ userId: ownerUserId }, namespaceId);
  if (!opened.ok) return { ok:false, code:'write-failed' };
  try {
    const input: NamespaceLeaseReplaceSchemaInput =
      'root' in args ? { schema, root: args.root } : { schema };   // 键存在性判定（schema-write.ts:73-77）；
                                                                    // G2 已保证存在即 plain object
    const result = await opened.lease.replaceSchema(input);   // 结果联合 resolve，不 reject（fatal 除外）
    return result.ok ? { ok:true } : { ok:false, code:'write-failed' };
  } catch {
    return { ok:false, code:'write-failed' };            // RuntimeWriteFatalError 折叠
  } finally {
    await opened.lease.release().catch(() => undefined);
  }
}
```

**root 参数契约（R1/A-3 完全规格）**：
- **提供性**：键存在性判定（`'root' in args`）。缺省 = 不修改 ROOT（`schema-write.ts:73-77` 的 runtime 契约）。
- **合法域**：plain JSON **对象**（`isPlainObject`——非数组、非 null、非标量）。依据：ROOT 固定物化为 Y.Map（ADR 0003「ROOT 固定物化为 Y.Map」），完整最终 logical ROOT snapshot 的 JSON 投影结构性恒为对象。
- **null 二义性裁决**：JSON 有 `null` 无 `undefined`——`"root":null` **不是**「未提供」（键存在），也不表示「清除 root」（runtime 契约无此语义），而是形状违约 → `invalid-op-args`。R1 之前该输入会漏到 runtime 形状拒绝并折叠 `write-failed`，与 schema 形状错（`invalid-op-args`）形成双码族稀释诊断——R1 收敛为同码族。
- **语义校验分层**：形状归 app G2；键集封闭校验/未声明键拒绝/detached 构造单源在 runtime SCHEMA 写槽（`schema-write.ts:72-85`）——app 不重复语义校验。**R2（SA4 复验修正）**：app 对 `schema` **原样透传**（G2 门禁后仅类型收窄 cast，严禁重建对象——重建会静默剥离额外键，令 runtime 封闭防线失活、回执契约漂移为伪 `ok:true`）。
- **keep-root × schema 演进（R1/SA4 复验补证，2026-08-30）**：不带 `root` 时写槽走引擎 keep-root 分支——**保留的旧 root 必须通过新 schema 校验**（`packages/doc-runtime/src/schema-replace.ts:181-188`：`extractYjsSnapshot(derived, doc)` + `validateLogicalSnapshot(derived, snapshot)` 双证，ADR 0008「证明逻辑值与实际载体均已兼容；ROOT 零修改」冻结契约）。schema 演进**新增必填字段**而旧 root 缺该字段 → 校验合法拒绝、槽 `{ok:false}` → app 按 AD-3 折叠 `write-failed`（引擎与 app 实现均正确，非缺陷）。泛化口诀：keep-root 成功 ⇔「旧 ROOT ⊆ 新 SCHEMA 合法域」——兼容演进（新增可选字段/放宽类型）不带 root 即成功；收紧演进（新增必填字段/类型收窄）**必须同时提供合规 `root`**（满足新 SCHEMA 的完整 ROOT 对象）。部署文档 replace-schema 行与 SA6 锚（SCHEMA_V2 以可选字段 `note?: string` 表达兼容演进）同步此口径。

**传播链（零新代码，全既有）**：SCHEMA 写槽单事务 → Runtime observer 产出 owned update → session fanout → `hub-namespace.onOwnedUpdate`（live 态 `deliver(bytes,'live')`，`hub-namespace.ts:690-695`）→ wire → peer apply（hub→peer 受保护集 = META 全键，SCHEMA 放行）→ peer installActive。AC3-① 后续 hub `verify-write note`（V2 schema 合法字段）→ 传播 → `waitConverged(['note'])`。

**回执语义文档化（重要，防 SA2 攻击）**：`ok:true` 仅表示本地 SCHEMA 写槽完成（live commit + dirty 登记），**不承诺**：(a) 传播已发生（channel 可能 conflicted/needs-resync——传播由复制状态机自行修复或等待运维 reset）；(b) dirty 已落盘（file adapter 的 flush 归 persistence 调度，ADR 0006）。与 ADR 0010「本地业务写成功仍只表示 live Y.Doc 已提交且本地 dirty notification 已登记」的诚实口径一致。

### 3.2 D2 `bump-epoch`（hub 专属）

**请求**：`{"op":"bump-epoch","id":…,"namespaceId":"ns-…"}`

**回执**：成功 `{ok:true, replicationEpoch:<新值>}`；失败 `{ok:false, code:'write-failed'}`。

伪代码：

```ts
case 'bump-epoch': return this.opBumpEpoch(args);

private async opBumpEpoch(args): Promise<Reply> {
  if (this.role !== 'hub' || this.registry === undefined) return { ok:false, code:'unknown-op' };
  const { namespaceId } = args;
  if (typeof namespaceId !== 'string' || !NAMESPACE_ID_PATTERN.test(namespaceId)) return invalid;
  const ownerUserId = this.knownOwner(namespaceId);
  if (ownerUserId === undefined) return { ok:false, code:'namespace-unknown' };
  const opened = await this.registry.open({ userId: ownerUserId }, namespaceId);
  if (!opened.ok) return { ok:false, code:'write-failed' };
  try {
    const bumped = await opened.lease.bumpReplicationEpoch();   // ok | issues | released；fatal → reject
    if (!bumped.ok) return { ok:false, code:'write-failed' };
    // 新 epoch 投影（bump ok ⟹ replication 两态联合必为 enabled——结构性；
    // 防御分支读不出 enabled 时回执省略该字段，绝不虚构数值）
    const status = opened.lease.getStatus();
    const epoch = status.lease === 'active'
      && status.runtime.replication.state === 'enabled'
      ? status.runtime.replication.replicationEpoch : undefined;
    return { ok:true, ...(epoch !== undefined ? { replicationEpoch: epoch } : {}) };
  } catch {
    return { ok:false, code:'write-failed' };
  } finally {
    await opened.lease.release().catch(() => undefined);
  }
}
```

**fence 时序推演（AC3-② 断言可达性论证）**：

1. `bumpReplicationEpoch()` resolve ⟹ epoch 管理槽已过 sequencer（槽完成 = dirty 登记完成），`Runtime` 投影链 epoch 已是新值；hub-namespace 各通道 session 的 `currentEpoch`（Runtime 投影链读取）随之漂移。
2. 检出面 = 每通道 `FenceWatchdog` 双节奏：idle timer 每 `idleProbeMs = timeouts.ackTimeoutMs`（缺省 **10s**，`hub-namespace.ts:193` + `defaults.ts:39`）+ 通道事件驱动的有界微任务链（每 8 让步探测一次，`fence-watchdog.ts:84-96`）。测试未覆写 timeouts → 上界 10s。
3. 检出 → `oneShotTerminal()`（记忆化恰一帧）→ `IDENTITY_CHANGED` 帧（携带新 replicationId/epoch）→ hub 侧 `identity-conflicted('fence')` 事件 + `finalize('conflicted')`（`hub-namespace.ts:720-744`）。
4. peer 收帧 → `identity-conflicted('identity-changed-frame')` + `finalize('conflicted')`（`peer-namespace.ts:617-618`）→ 经 app observer 直通 NDJSON（`app.ts:157-160`）。
5. SA6 窗口 30s ≥ 10s 上界 ✓（3 倍余量）。
6. fenced 后 hub 写 `count=5` 不传播：hub-namespace `onOwnedUpdate` 在终态走 default 分支忽略交付（`hub-namespace.ts:703-704`）→ peer 读数保持旧值（provision root 的 `count=0`）≠ 5 ✓。

**SA6 断言序依赖（R1/O-3 点名，SA7 动态复核注意）**：第 6 步成立的前提 = SA6 测试**先** `waitForEvent(identity-conflicted)` **再**发 `verify-write count=5`（`phase5-three-instance-acceptance-red.test.ts:412-427` 的既定顺序）。hub 侧 `oneShotTerminal` 的 IDENTITY_CHANGED 帧发送与 `finalize('conflicted')` 在同一同步段（`hub-namespace.ts:735-743`）——peer 事件出现 ⟹ hub channel 已终态 ⟹ 此后 hub 写结构性走 default 忽略。若 SA7 复核调整断言序（写先于等事件），则进入「写是否赶在 fence 检出前投递」的自由竞态，不属于本设计的承诺面。

**O-4 核实（R1，不适用）**：SA2 观察项建议「若 bump 结果联合 ok 分支已携带新 epoch 可直取」——经核实 `BumpReplicationEpochResult = { ok: true } | { ok: false; issues: unknown[] }`（`replication-write.ts:90`），ok 分支为窄形状**不携带 epoch**，前提不成立；保留 `getStatus()` 二次投影与防御分支设计不变。

**回执语义文档化**：`ok:true` = epoch 提交完成，**fencing 是异步传播**（上界 `ackTimeoutMs`）；双 peer 的 `identity-conflicted` 事件是 fenced 的观测面，不在回执内同步承诺。`replicationEpoch` 字段是受控数值（safe-field 纪律内），非 secret。

### 3.3 D3 `reset-replica`（peer 专属，编排动词）

**请求**：`{"op":"reset-replica","id":…,"namespaceId":"ns-…","ownerUserId":"alice","expectedReplicationId":"<32hex>","expectedReplicationEpoch":1}`

**回执**：成功 `{ok:true}`；失败 `{ok:false, code:<registry 窄 issue 码 | reset-replica-failed>}`。

伪代码：

```ts
case 'reset-replica': return this.opResetReplica(args);

private async opResetReplica(args): Promise<Reply> {
  // G1 角色守卫（peer 专属，hub → unknown-op）
  if (this.role !== 'peer' || this.peer === undefined || this.registry === undefined) {
    return { ok:false, code:'unknown-op' };
  }
  // G2 参数门禁 → invalid-op-args
  const { namespaceId, ownerUserId, expectedReplicationId, expectedReplicationEpoch } = args;
  if (typeof namespaceId !== 'string' || !NAMESPACE_ID_PATTERN.test(namespaceId)) return invalid;
  if (typeof ownerUserId !== 'string' || ownerUserId.length === 0) return invalid;
  if (typeof expectedReplicationId !== 'string' || !/^[0-9a-f]{32}$/.test(expectedReplicationId)) return invalid;
  if (typeof expectedReplicationEpoch !== 'number'
      || !Number.isSafeInteger(expectedReplicationEpoch) || expectedReplicationEpoch < 1) return invalid;
  // G3 无 known-set 门禁（显式 owner 参数 + registry 零存在性泄露核对——论证见 §4.3）
  // G4 编排第 1 步：guarded reset（冻结次序 AD-2）
  let reset: ResetReplicaResult;
  try {
    reset = await this.registry.resetReplica(
      { userId: ownerUserId },
      namespaceId,
      { replicationId: expectedReplicationId, replicationEpoch: expectedReplicationEpoch },
    );
  } catch {
    return { ok:false, code:'reset-replica-failed' };   // branded fatal（committed 事实见 registry observer）
  }
  if (!reset.ok) return { ok:false, code: reset.code };  // 窄 issue 码透传（含 MISMATCH——零通道动作、
                                                          // 零 peerOwners 动作：幂等集原样，read/verify-write 不受影响）
  // G5a（R1/A-1）peerOwners 先删——幂等集在重引导入队完成前不得持有该 ns：
  //   防两处撕裂——(i) 重引导链失败后运维重试 add-target 被 opAddTarget 幂等短路
  //   （app.ts:549 `if (this.peerOwners.has(...)) return {ok:true}`）拦截为伪 ok:true 零动作；
  //   (ii) 本步与并发 remove-target 的 delete 幂等合流（见竞态表 w1/w2）。
  this.peerOwners.delete(namespaceId);
  // G5b 编排第 2/3 步：收口旧 channel + 重引导
  try {
    await this.peer.removeTarget(namespaceId);   // 幂等；恒 resolve（结构性：peer-namespace.ts:644-705 全分支结算）
    // F1（SA7 复验收编，2026-08-30）：await removeTarget 返回时 controller 可能仍处 closing
    //   （CLOSE 路径结算与 CLOSE_OK 往返竞争）——引擎 addTarget 的 re-add 分支只在终态
    //   （closed/conflicted/failed）触发，closing 态落入合流分支（intent='active' 零动作），
    //   close 完成后无人再触发重建：通道永久 closed、重引导不发生（第二/多轮
    //   bump→fence→reset 循环在此断裂——F1 红锚实证）。等待 controller 离开 closing 再
    //   addTarget：终态 → re-add 分支（§14.1 整连接重建）；disconnected → 连接重建机制
    //   （openActiveTargets，intent='active'）自恢复。预算 = closeTimeoutMs（缺省 5s）+
    //   边距 2s；超限 = 真实异常 → 诚实失败（peerOwners 保持 deleted，add-target 重试可达）。
    const settleBudgetMs = (this.config.timeouts?.closeTimeoutMs ?? 5_000) + 2_000;
    if (!(await this.waitPeerTargetSettled(namespaceId, settleBudgetMs))) {
      return { ok:false, code: 'reset-replica-failed' };
    }
    this.peer.addTarget({ namespaceId, localOwner: { userId: ownerUserId } });  // 同步无 throw（peer-connection.ts:216-248）
                                                // §14.1 re-add → 重建 → OPEN → bootstrap
  } catch {
    // 结构性不可达的纯防御边界（R1/A-2：removeTarget 恒 resolve、addTarget 同步无 throw 面，
    // SA1 与 SA2 双重核验一致）——不进事件面（事件不承诺不可达行为）；peerOwners 保持
    // deleted（add-target 重试真正可达）；回执稳定码足够诊断。
    return { ok:false, code: 'reset-replica-failed' };
  }
  // G5c（R1/A-1）重引导已入队后恢复幂等集：此后 add-target 幂等短路 = 真 no-op 语义
  // （target 事实已在集合中）；remove-target→reset-replica 运维序列经此恢复
  // read/verify-write 的 knownOwner 来源（§4.3 闭环）。
  this.peerOwners.set(namespaceId, ownerUserId);
  this.sink({ event: 'replica-reset', namespaceId });
  return { ok:true };
}
```

**完整时序推演（两场景）**：

场景 S1 = AC3-③（channel live，无 bump）：

```
wrong expected (epoch 999)：
  registry.resetReplica → fence 双源核对 mismatch → {ok:false, NAMESPACE_RESET_IDENTITY_MISMATCH}
  → app 透传回执；channel 不动（peer 读 tags 继续服务 'hub' ✓——SA6 断言「零破坏」）

correct expected (epoch 1)：
  fence 双源核对通过 → armed → close admission（session runtime-close 终止）
  → forceRelease（controller lease 一并强制释放）→ close barrier 排空 → archive（users→archive/users）
  → {ok:true}（key 缺席 = bootstrap 资格）
  → app G5a: peerOwners.delete（幂等集先行摘除——R1/A-1）
  → app G5b: removeTarget（controller 投影 live 但 session 已死：发 CLOSE_NAMESPACE → hub 收口回 CLOSE_OK
    → closed + cleanup；lease release 幂等；≤5s 兜底）
  → app G5b: addTarget（existing closed → §14.1 targeted + requestRebuild('re-add')）
    → 整连接重建（关旧 wire 1000 → dial → HELLO → openActiveTargets）
    → OPEN → hub 新 channel（open lease）→ BOOTSTRAP_SNAPSHOT（hub live doc 全量基线，广告当前身份）
    → peer importReplica（detached apply + expected=hub 广告身份核对 + 排他创建——key 缺席 ✓）
    → 新 entry + session → reconcile/live → tags='hub' 收敛（SA6 waitConverged 60s ✓）
  → app G5c: peerOwners.set（幂等集恢复——read/verify-write 的 knownOwner 来源闭环）
  → replica-reset 事件 + 回执 {ok:true}
```

场景 S2 = bump 后恢复流（AC3-② 后接 reset，现实运维闭环，测试未直测但设计必须自洽）：

```
bump(1→2) → 双 peer conflicted → peer reset-replica(expected = 本地旧身份 {repId, epoch:1})
  → fence 双源核对本地副本（仍 epoch 1）通过 → 归档 → G5a delete
  → G5b removeTarget（conflicted 态立即零 wire）→ addTarget（re-add 重建）→ 新 OPEN → hub 广告 epoch 2
  → importReplica expected={repId,2} → peer 副本继承新身份 → live → G5c set。闭环 ✓
```

**G5 失败的二分（R1/A-2 诚实化；F1 复验收编 2026-08-30）**：
- **G5b throw**（catch 分支）= **结构性不可达的纯防御边界**——`removeTarget` 全状态矩阵分支均 resolve（`peer-namespace.ts:644-705`，SA1/SA2 双核验）、`addTarget` 同步无 throw 面（`peer-connection.ts:216-248`）。设计保留 catch（防御未来实现漂移），但事件面与运维指引**不承诺**其可达。
- **G5b 收口结算超限（F1 新增的真实失败面）**：`removeTarget` 的 CLOSE 路径结算与 controller 到达 `closed` 之间可存在竞争窗口（CLOSE_OK 往返与控制回执竞争）——引擎 `addTarget` 对非终态（closing 等）落入合流分支（`intent='active'` 零动作），close 完成后无人再触发重建 → 通道永久 closed。F1 修复后 G5b 在 addTarget 前等待 controller 离开 closing（预算 = closeTimeoutMs 缺省 5s + 边距 2s；引擎 closeTimeout 兜底保证必有结算点），**超限 → `reset-replica-failed` 诚实回执**（peerOwners 保持 deleted——add-target 重试真正可达；观测面 = 回执码，不进新事件）。
- **现实的 reset 后失败 = 重引导链失败**（bootstrap failed / hub 不可达 backoff / needs-resync）——发生在 G5c 之后、`addTarget` 返回之后的异步链上：观测面 = 既有 `channel-state-changed` / `connection-state-changed` / `bootstrap-*` observer 事件（零新观测面）；恢复入口 = `add-target`（**F1 复验收编后真正可达的语义**：`opAddTarget` 幂等短路改为**状态感知门**——仅非终态通道短路；终态（closed/conflicted/failed）必达底层 re-add 分支 + `target-added` 事件发射——恢复不再依赖「重引导失败期间 peerOwners 无条目」这一与 G5c 冲突的前提，`app.ts:563-574`）。

**重复调用幂等性**：首次成功后 key 缺席；再次同 expected → registry ④ 无 entry committed probe → `NAMESPACE_NOT_FOUND` 透传（文档化：reset 成功不可重放，第二次到达返回 NOT_FOUND 是正确行为，非缺陷）。

**并发与竞态**（控制通道为并发模型——`main.ts:142-155` 每行独立 IIFE 不排队，SA6 `waitConverged` 的 `Promise.all` 三路并发为实证；交错真实可达）：

| 竞态 | 行为 | 依据 |
|---|---|---|
| reset 与 hub 侧 bootstrap 帧同时在途 | registry 每-ns carrier FIFO 串行域（`admitResetSlot`，`registry.ts:1576-1589`）；peer 侧 importReplica 与 resetReplica 同域串行 | 切片 8 交付 |
| reset 进行中 peer 断线 | controller disconnected/terminal 态 removeTarget 全部有界结算（§13.1 矩阵） | `peer-namespace.ts:644-705` |
| **reset 进行中并发 `remove-target`**（R1/A-1） | 三交错窗终态：(w1) G4 resolve 前完成 → controller 关闭 + `peerOwners.delete`（`app.ts:563`）；若 G4 随后 mismatch → 终态 = channel 已关 + 幂等集已删（**运维经 `add-target` 恢复——A-1 修订后真正可达**）；若 G4 成功 → G5a 的 delete 幂等合流该删除，G5c set 恢复 → 终态 = 重引导 + 幂等集恢复 ✓。(w2) G5b 的 removeTarget 与 addTarget 之间到达 → opRemoveTarget 的底层调用幂等（intent 已 removed）+ `peerOwners.delete`，随后被 G5c set 覆盖 → 终态恢复 ✓（remove-target 意图被 reset 编排超越——last-writer-wins，stdin 并发序无全局排序保证）。(w3) G5c 后到达 → 正常 remove-target 语义（channel 关闭 + 幂等集删除）| `app.ts:549-564`；§4.3 |
| **reset 进行中并发 `add-target`**（R1/A-1；F1 修正短路门语义） | (w1) G5a 前（`peerOwners` 有条目且通道非终态）→ `opAddTarget` 幂等短路 `{ok:true}` 零动作（语义正确——target 仍在集合与 channel 中）。(w2) G5a–G5c 间（deleted）→ 走底层 `peer.addTarget`（与 G5b 的重引导合流/幂等，§14.1）+ `peerOwners.set` + `target-added` 事件 ✓。(w3) G5c 后 → 通道非终态 → 幂等短路（真 no-op——target 事实已在集合）；**通道终态（closed/conflicted/failed，如重引导链失败后）→ 短路门放行**，走底层 re-add（恢复入口真正可达，发射 `target-added`）✓。任何窗口无害 | `app.ts` opAddTarget（短路门 = peerOwners.has && 非终态）；`peer-connection.ts:216-248` |
| **reset 与 app 停机并发**（R1 吸收 O-1） | `registry.shutdown` 后 reset → `REGISTRY_NOT_ACCEPTING` 透传（回执后进程按停机序走）。**停机窗口伪回执**：G5b 进行中 `peer.stop()` 完成 → `addTarget` 的重建被 `stopping` 守卫静默拦截（`peer-connection.ts:271/279/705`——controller 置 targeted 但不再拨号）→ 回执 `{ok:true}` + `replica-reset` 事件而重引导**不发生**（「ok = 重引导已入队」在停机窗口为假——诚实登记为已知有限偏差）。实际无害：进程将退出、重启后按配置 `peer.targets` 重引导、数据零丢失（归档先于回执完成）。不为引入 `stopRequested` 回执翻转：回执发射时序不可撤回 + 有限窗口 + 数据安全 | `peer-connection.ts:271/279/705`；`app.ts:373-415`（performStop） |
| **reset 成功后 bootstrap 完成前并发 `read`**（R1 吸收 O-2） | opRead 无 F1 重试（`app.ts:472-493`）：G5a–G5c 间到达 → `namespace-unknown`（幂等集暂缺）；G5c 后到达 → `read-failed`（registry.open NOT_FOUND——entry 已清、新 generation 未建立）。两者均瞬态，bootstrap 完成后自愈；与 verify-write 的 F1 差异同源（§4.4 管理动词诚实报告原则） | `app.ts:472-493` |
| 两份 stdin 行并发 reset 同 ns | carrier FIFO 串行；后到者按 key 状态返回 NOT_FOUND | 同上 |
| reset 与 verify-write 并发 | verify-write 的 open 与 reset 的 carrier 串行；若 reset 先 armed，后续 open 等新 generation（bootstrap 后）或 NOT_FOUND | 既有面 |

### 3.4 dispatch 接线与回执总表

dispatch 表（`app.ts:444-470`）追加三 case（加法，default 分支不动）。全部回执经既有 `handleControlLine` 包装（`event:'reply'` + `op` + `id` 直通，每行恰一回执，进程不因控制输入退出）。

| 动词 | 角色 | 成功回执 | 失败码集 |
|---|---|---|---|
| `replace-schema` | hub | `{ok:true}` | `unknown-op`(角色) / `invalid-op-args` / `namespace-unknown` / `write-failed` |
| `bump-epoch` | hub | `{ok:true, replicationEpoch:N}` | 同上 |
| `reset-replica` | peer | `{ok:true}` | `unknown-op`(角色) / `invalid-op-args` / registry 窄 issue 七码透传 / `reset-replica-failed`（G4 branded fatal，或 G5b 结构性防御——见 §3.3 二分） |

### 3.5 事件面

- 新增 app 级事件恰一个：`{"event":"replica-reset","namespaceId":"ns-…"}`——**仅在 G5c 成功分支发射**（R1/A-2：原设计的 `restarted:boolean` 字段及其 `false` 分支依赖结构性不可达的 G5 catch，事件面不承诺不可达行为，已收敛为单字段；字段 = 受控标识，safe-field 纪律内，与 `target-added` 同族，`app.ts:552`）。
- 不新增其他事件：AC3-② 的 `identity-conflicted`、重引导的 `channel-state-changed`/`bootstrap-imported` 均为既有 observer 判别联合成员（`packages/ws-replication/src/types.ts:260-428`），经 `app.ts:157-160` 直通——**重引导链失败的观测面即这些既有事件**（§3.3 G5 失败二分）。

## 4. 边界条件与防御性分析

### 4.1 拒绝虚假降级（loud assert 纪律）

- D2 中 bump ok 后 `getStatus()` 读不出 enabled epoch：**这不是降级场景是结构性不可达**（bump 的前置拒绝集含 `REPLICATION_NOT_ENABLED`，ok ⟹ enabled）——处置 = 回执省略 `replicationEpoch` 字段（不虚构、不静默 fallback 到旧值），不 console.error 打断回执通道（回执面是黑盒契约，一行一回执不可多行）。该防御分支的存在是防御性编程，不是设计的降级路径。
- D1/D2 中 `registry === undefined`（boot 未完成或已停机）：现有动词先例返回 `namespace-unknown`——本设计对 hub 动词用 `unknown-op`（角色守卫合并判断）维持与 `request-reauth`/`add-target` 的角色-就绪复合守卫先例一致。**不是**静默降级：控制通道在 boot 前后语义本来就可能拒答（read 的 `namespace-unknown` 先例），码值区分度足够。
- dispatch 内**零静默吞错**：一切 catch 都映射稳定码回执（`write-failed` / `reset-replica-failed`），回执本身即 loud 面。

### 4.2 secret-free 纪律

三个动词的请求/回执/事件字段集：`namespaceId`（受控标识）、`ownerUserId`（运维显式提供的分区键，非 owner 值泄漏——它本来就是调用方自述）、`expectedReplicationId`（32hex 谱系标识，ADR 0010 允许受控日志；非 token）、`replicationEpoch`（数值）。无 token、无 Yjs bytes、无 SCHEMA/ROOT 内容。错误回执不回显输入值（registry 窄 issue 的 message 是冻结常量、零插值，`types.ts:110-123`）——app 只透传 `code`，不透传 `message`（避免未来 registry message 变化破坏回执稳定性，且 code 已足够诊断）。

### 4.3 `reset-replica` 不做 known-set 门禁的论证（与 read/verify-write 的刻意差异；R1 补 A-1 闭环）

read/verify-write 需要 `knownNamespaces`/`peerOwners` 做**owner 来源**（请求不带 owner，map 是唯一本地记录）。`reset-replica` 显式携带 `ownerUserId`，owner 判定权回归 registry（① 零存在性泄露核对 + persistence owner 分区）。跨 owner 探测不存在放大面：owner 不匹配与 missing 同码 `NAMESPACE_NOT_FOUND`（`registry.ts:1609-1613`）。附带收益：运维序列 `remove-target` → `reset-replica`（channel 已拆、`peerOwners` 已删，`app.ts:563`）仍可达——若加 known-set 门禁，该合法序列会误拒 `namespace-unknown`。

**R1/A-1(a) 闭环补充**：R1 之前该序列只对 reset 本身可达——reset 成功后的重引导产物会撕裂（channel live 而 `peerOwners` 缺失 → 该 ns 的 `read`/`verify-write` 永久 `namespace-unknown`：数据在、通道在、黑盒不可达，只能重启进程恢复）。R1 的 G5c `peerOwners.set` 修复该撕裂：序列终态 = 重引导完成 + 幂等集恢复 + `read`/`verify-write` 正常服务。若 reset 在该序列中 mismatch 失败：channel 已被 remove-target 关闭 + 幂等集已删——终态诚实一致（无通道也无条目），运维经 `add-target` 重建（入口可达——幂等集无条目；F1 复验收编后即使幂等集有条目，终态通道也不被状态感知短路门拦截），非撕裂。

### 4.4 管理动词不引入 F1 物化等待环（与 opVerifyWrite 的刻意差异）

`opVerifyWrite` 的 `openWriteNamespace` 重试环（`app.ts:613-627`）服务「peer 复制收敛中的瞬态 NOT_FOUND」。管理动词语义相反——**操作失败即诚实报告**：

- hub 侧两动词：known-set 来源于 provision 完成（`provisioned` 事件前 `knownNamespaces.set` 已发生在 `create` 提交后，`app.ts:297-298`），物化无窗口；open 的 NOT_FOUND 只会来自 rootDir 数据被外部清理（真实运维故障，应报告而非等待）。
- peer 侧 reset：副本未物化（bootstrap 前）→ registry ④ probe missing → `NAMESPACE_NOT_FOUND` 透传，正确（无可重置之物）。

### 4.5 `addTarget` 整连接重建的全通道副作用（§14.1 既定行为，显式登记）

conflicted/closed 终态后的 re-add 触发 `requestRebuild('re-add')` —— 整连接重建（同 peer 的**所有** namespace channel 一并重建，`peer-connection.ts:228-233` + §14.1）。这是 ws-replication 冻结行为（ADR 0010「同一连接内同一 namespace 只允许一个生命周期，关闭后重开必须重建连接」的级联结果），不是本设计新引入的破坏面。部署文档将显式说明：多 namespace peer 上执行 `reset-replica` 会导致同连接其余 channel 短暂重连（round 重新收敛，无数据丢失——bootstrap/reconcile 幂等）。

### 4.6 失败矩阵总表（三动词 × 关键拒绝路径）

| 输入/状态 | replace-schema | bump-epoch | reset-replica |
|---|---|---|---|
| 错误角色 | `unknown-op` | `unknown-op` | `unknown-op` |
| 畸形参数 | `invalid-op-args` | `invalid-op-args` | `invalid-op-args` |
| hub 未知 ns | `namespace-unknown` | `namespace-unknown` | n/a（peer 动词） |
| peer 副本不存在 | n/a | n/a | `NAMESPACE_NOT_FOUND` 透传 |
| 复制未启用 | issues→`write-failed` | `REPLICATION_NOT_ENABLED`→`write-failed` | `NAMESPACE_RESET_IDENTITY_MISMATCH` 透传（fence live 源 disabled → `{ok:false}` → 恒不等，`packages/namespace-runtime/src/runtime.ts:257-268`——与 ADR 0010 #133 round-2「二者都必须是合规 enabled 复制身份」逐字一致；expected 文法本身不合规时为 `NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID`，app 层 G2 预校验后结构性不可达） |
| 身份不匹配 | n/a | n/a | `NAMESPACE_RESET_IDENTITY_MISMATCH` 透传（零破坏零通道动作） |
| degraded/fatal/close | `RUNTIME_WRITE_DISABLED`→`write-failed` / fatal→`write-failed` | 同左 | fatal→`reset-replica-failed` |
| epoch 溢出 | n/a | issues→`write-failed` | n/a |
| registry 停机 | open→`write-failed` | 同左 | `REGISTRY_NOT_ACCEPTING` 透传 |
| G5b throw（removeTarget/addTarget） | n/a | n/a | `reset-replica-failed`——**结构性不可达纯防御边界**（R1/A-2：两调用方无 throw/reject 面）；`peerOwners` 保持 deleted，`add-target` 重试可达 |
| **G5b 收口结算超限**（F1 复验收编） | n/a | n/a | `reset-replica-failed`——**真实可达失败面**：addTarget 前等待 controller 离开 closing（预算 closeTimeoutMs+边距，引擎 closeTimeout 兜底保证结算）超限 = 真实异常 → 诚实回执；`peerOwners` 保持 deleted，`add-target` 重试可达 |
| 重引导链失败（bootstrap failed / backoff / needs-resync） | n/a | n/a | **非回执域**（G5c 后异步发生，回执已 `ok:true`）：观测面 = 既有 channel/连接 observer 事件；恢复入口 = `add-target`（F1 复验收编：短路门状态感知——终态通道放行 re-add，恢复不再依赖「幂等集无条目」前提） |

### 4.7 停机序不变

三动词不注册新 fiber/disposer/timer——`performStop` 的拆卸链（`app.ts:373-415`）零变化。reset 编排中的 `removeTarget`/`addTarget` 已是 `peer.stop()` 管辖面。

## 5. 架构一致性与全局兼容检查

| 检查项 | 结论 |
|---|---|
| 与 ADR 0010 冲突？ | 无——三个动词是 ADR 0010 既有条款（SCHEMA hub-only 修改 L54-55、`bumpReplicationEpoch` L57、peer guarded reset L57/L73-79）的黑盒到达面；epoch 传播走控制面（IDENTITY_CHANGED）不动 raw 回灌（#134 修订节「META 触碰的管理写字节不得经 raw 回灌」——bump 的 wire 效果只有控制帧，本设计不触碰该路径） |
| 与 ADR 0008（写槽序）冲突？ | 无——replaceSchema/bump 复用既有 FIFO 槽序，app 只是新 caller |
| 与 ADR 0009（lease/registry 生命周期）冲突？ | 无——lease 即取即释；reset 编排是 registry 公开 API 的新 caller |
| 与 ADR 0006（持久化语义）冲突？ | 无——归档经 registry→persistence seam（WS 层不直接读写 snapshot 文件的纪律保持：app 层零 persistence 触达） |
| 推翻现有设计？ | 无推翻；一处登记口径修正（AD-1 的 phase-5 文档边界行）+ SA6 已声明的动词表扩展（AC7 文档对齐义务） |
| 既有动词回归 | dispatch 表纯加法；`unknown-op` default 不动；既有 8 动词的回执形状零变化 |
| 公共导出面 | `packages/**` 零改动；app 的 `index.ts` 导出零变化（`STABLE_OP_ERROR_CODES` 值 append，形状不变） |

## 6. 文档对齐（AC7 义务，与代码同 PR）

1. `docs/integration/hub-peer-deployment.md`：
   - 动词表追加三行（verb/角色/参数/说明——含回执语义的诚实边界：replace-schema 的 ok ≠ 传播完成、bump-epoch 的 ok ≠ fence 已广播、reset-replica 的 ok = 归档 + 通道收口结算完成 + 重引导已入队）；`replace-schema` 行注明 `root` 为可选 plain JSON 对象、`null`/数组/标量不是「未提供」而是 `invalid-op-args`（R1/A-3）；keep-root × schema 演进句（R1/SA4）；
   - 稳定码注册表（L129-131）append 8 码（7 透传 + `reset-replica-failed`，注明 = branded fatal / 结构性防御边界 / **旧通道收口结算超限**）；
   - 新增「管理动词」小节：reset 编排冻结次序（**含 F1 补步：addTarget 前等待 controller 收口结算完成，预算 closeTimeoutMs+边距，超限 → reset-replica-failed**）、§14.1 整连接重建副作用（§4.5）、重复 reset 的 NOT_FOUND 幂等语义、bump 后的完整恢复闭环（S2 场景）、**reset 后重引导失败的恢复指引（R1/A-1/A-2；F1 复验收编）**——观测既有 channel/连接事件，恢复入口 = `add-target`（**短路门状态感知——终态通道放行 re-add**，重试必达底层，`target-added` 事件为成功信号）；
   - 事件列表（L17-19 一带）补 `replica-reset`（仅成功路径发射）。
   - `add-target` 动词行（既有行改）——幂等语义修正：非终态通道短路、终态通道走底层 re-add（恢复入口语义）。
2. `docs/phases/phase-5-websocket-replication.md`：「交付现状与边界」节——切片 8 行（L158）与切片 10 行补记 app 管理动词交付；**切片 9 行（L159）事实修正（R1/A-4）**：基线 HEAD `469ca36` 中 apps/yjs-server 已随 #186 交付，「未交付 \| #164」与事实矛盾，修正为已交付（composition root/装配断言/§21 停机编排随 #164+#186 落地）——同一张表三行（8/9/10）状态一致（AC7 口径）；切片 7 行的 #170/#171 已知偏差另有修复票、状态自洽，不动。「未交付边界」（L186-187）的 peer reset 编排行改写为 AD-1 的归属裁决表述。
3. 不动：`docs/protocols/instance-replication-v1.md`（wire 契约零变化——无新帧型，IDENTITY_CHANGED 既有）、`docs/adr/**`（无新架构决策）、`CONTEXT.md`（无新引擎概念——管理动词是 app 部署面词汇，非内核术语）。

## 7. 风险登记与不做的事

| 风险 | 等级 | 缓解 |
|---|---|---|
| fence 检出依赖 ackTimeoutMs（10s）与 SA6 30s 窗口的比例 | 低 | 3 倍余量；且 bump 后 hub 的 verify-write（count=5）本身是通道事件，会触发事件驱动微任务探测加速检出 |
| G5b throw（removeTarget/addTarget 失败） | 结构性不可达 | 纯防御边界（R1/A-2：`removeTarget` 恒 resolve、`addTarget` 同步无 throw——SA1/SA2 双核验）；回执 `reset-replica-failed` + `peerOwners` 保持 deleted；不进事件面 |
| **G5b 收口结算超限**（F1/SA7 复验收编新增） | 低 | 真实可达失败面：addTarget 前等待 controller 离开 closing（预算 closeTimeoutMs 缺省 5s + 边距 2s；引擎 closeTimeout 兜底保证必有结算点）→ 超限 = 真实异常 → `reset-replica-failed` 诚实回执 + `peerOwners` 保持 deleted + `add-target` 重试可达。修复前该窗口内 addTarget 落入引擎合流分支（intent='active' 零动作）→ 通道永久 closed、多轮 bump→fence→reset 循环断裂（F1 红锚） |
| reset 成功后重引导链失败（bootstrap failed / hub 不可达 backoff / needs-resync） | 低 | **现实恢复场景**（R1/A-2 改写；F1 复验收编）：观测面 = 既有 `channel-state-changed`/`connection-state-changed`/`bootstrap-*` observer 事件（零新观测面）；恢复入口 = `add-target`（**短路门状态感知——终态通道 closed/conflicted/failed 放行 re-add**，`target-added` 事件为成功信号——不再依赖「幂等集无条目」与 G5c 冲突的前提）；数据已归档零丢失，bootstrap 资格持续有效 |
| memory adapter 上 reset 的归档不可持久（进程退出即失） | 无害 | memory 拓扑本就无重启承诺（AC6 仅 file）；行为= 排他创建资格即时恢复 |
| 多 namespace peer 的整连接重建抖动 | 低 | §4.5 登记 + 文档说明；round 幂等收敛 |
| SA6 断言与本设计动词面漂移 | 无 | 本设计逐字采用 SA6 契约起点（动词名、参数名、回执 ok/code 语义、事件名 identity-conflicted）——零测试改动预期 |

**不做**：不实现 hub 级联/多 hub/自动晋升（非目标）；不做 channel 数上限（SA6 报告 §0 已声明 evolution item 非红锚）；不动 `packages/**`；不新增配置键（三动词纯运行期控制面，配置零变化——`config.ts` 不动）。

## SA2 反馈逐条回应

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|---|---|
| A-1（MAJOR）：G5 补 `peerOwners` 三步维护（delete 于 removeTarget 前 / set 于成功后 / catch 保持 deleted）+ 竞态表补 `remove-target`/`add-target` 并发两行 + §6.1 文档对齐 | ✅ | §3.3 伪代码 G5a/G5c + catch 注释；§3.3 竞态表新增两行（三交错窗 w1/w2/w3 终态推演）；S1/S2 时序图同步 G5a/G5c 步骤；§4.3 R1/A-1(a) 闭环补充；§6.1 管理动词小节 reset 重试指引；§9 补 E11/E12 依据锚 | 幂等集维护点显式裁决：G4 mismatch 路径零动作；**G5a** delete 于 removeTarget 前（防重引导失败后 `add-target` 被 `app.ts:549` 幂等短路拦截为伪 `ok:true` 零动作）；**G5c** set 于 G5b 成功后（修复 `remove-target`→`reset-replica` 序列的 channel live + `peerOwners` 缺失撕裂——read/verify-write 永久 `namespace-unknown`）；catch 保持 deleted；并发两动词三交错窗全部推演终态（remove-target 意图可被编排超越 = last-writer-wins，stdin 并发无全局排序） |
| A-2：G5 catch/`restarted:false` 行为与实际 no-throw 实现对齐（选择建议 (i) 诚实化） | ✅ | §3.3 catch 注释改「结构性不可达纯防御边界」（引 E13：`peer-namespace.ts:644-705` 全分支 resolve + `peer-connection.ts:216-248` 同步无 throw）；§3.3 新增「G5 失败的二分」段；§3.5 `replica-reset` 事件收敛为仅成功分支、去 `restarted` 字段（事件面不承诺不可达行为）；§4.6 失败矩阵拆两行（结构性防御 vs 重引导链失败——后者非回执域，观测面 = 既有 observer 事件）；§7 风险表同步拆行 | catch 保留为防御边界（防实现漂移）但事件/文档/运维指引不再承诺其可达；现实 G5 后失败 = 重引导链失败，恢复入口 = `add-target`（依赖 A-1 修订后真正可达，`target-added` 事件为成功信号） |
| A-3：`replace-schema` `root:null` 定为 `invalid-op-args` 或完全规格化 | ✅ | §3.1 伪代码 G2 增补 `'root' in args && !isPlainObject(args.root) → invalid-op-args`；§3.1「root 参数契约（R1/A-3 完全规格）」重写：提供性（键存在性）/合法域（plain JSON 对象——ROOT 恒 Y.Map 物化，ADR 0003）/null 二义裁决（JSON null ≠ 未提供 ≠ 清除语义，= 形状违约）/语义校验分层（形状归 app、键集封闭与 detached 构造单源 runtime）；§6.1 动词表注明 | root 形状错与 schema 形状错同码族 `invalid-op-args`；`write-failed` 只留给 compile 失败/degraded/fatal 等真实写失败——诊断分辨度恢复 |
| A-4：phase-5 文档切片 9 行登记修正 | ✅ | §6.2 补切片 9 行（L159）事实修正：「未交付 \| #164」与基线 `469ca36`（apps/yjs-server 已随 #186 交付）矛盾 → 修正为已交付；同表 8/9/10 三行状态一致（AC7 口径）；切片 7 的 #170/#171 已知偏差行另有修复票、状态自洽不动 | — |
| O-1（建议）：停机窗口伪回执终态补入竞态表 | ✅ 吸收 | §3.3 竞态表「reset 与 app 停机并发」行重写：`addTarget` 重建被 stopping 守卫静默拦截（`peer-connection.ts:271/279/705`，E14）→ 回执 `ok:true` 但重引导不发生——诚实登记为已知有限偏差（数据零丢失、重启按配置 targets 重引导）；不引入 stopRequested 回执翻转（回执发射时序不可撤回 + 有限窗口） | — |
| O-2（建议）：reset 与 read 并发终态声明 | ✅ 吸收 | §3.3 竞态表新增行：G5a–G5c 间 → `namespace-unknown`（幂等集暂缺）；G5c 后 bootstrap 完成前 → `read-failed`（NOT_FOUND）；均瞬态自愈，与 §4.4 管理动词诚实报告原则同源 | — |
| O-3（建议）：SA6 断言序依赖点名 | ✅ 吸收 | §3.2 新增「SA6 断言序依赖」段：推演第 6 步前提 = 先 `waitForEvent(identity-conflicted)` 再写 `count=5`（`oneShotTerminal` 帧发送与 `finalize('conflicted')` 同一同步段，`hub-namespace.ts:735-743`）；SA7 若调整断言序即入自由竞态，非设计承诺面 | — |
| O-4（建议）：bump 结果联合直取新 epoch | ❌ 核实不适用 | §3.2 新增「O-4 核实」注：`BumpReplicationEpochResult = { ok: true } \| { ok: false; issues }`（`replication-write.ts:90`）——ok 分支为窄形状不携带 epoch，建议前提不成立；保持 `getStatus()` 二次投影与防御分支 | SA1 R1 复核（sed 直读类型定义）与 SA2 观察的前提相反 |

## §8. 文件清单（File Scope）

### ALLOW LIST

- `apps/yjs-server/src/app.ts` — 修改：dispatch 表 +3 case（`replace-schema`/`bump-epoch`/`reset-replica`）+ 3 个 handler 方法（§3.1/§3.2/§3.3 伪代码，约 +125 行；既有方法零改动）。R1 增量：G2 root 形状门禁（A-3）+ G5a/G5c `peerOwners` 维护两步（A-1）——均在 `opResetReplica`/`opReplaceSchema` 新方法体内，SA2 确认不扩文件半径
- `apps/yjs-server/src/lifecycle.ts` — 修改：`STABLE_OP_ERROR_CODES` append 8 个稳定码（§3.4/AD-3，约 +8 行）
- `docs/integration/hub-peer-deployment.md` — 修改：动词表 +3 行（含 root 参数注明）、稳定码注册表 append、「管理动词」小节（含 R1 reset 重试指引与幂等集语义）、事件列表补 `replica-reset`（§6.1，约 +55 行）
- `docs/phases/phase-5-websocket-replication.md` — 修改：「交付现状与边界」切片 8/9/10 三行交付登记更新（含 R1/A-4 切片 9 事实修正）与未交付边界行改写（§6.2，约 +7 行）
- `apps/yjs-server/test/phase5-three-instance-acceptance-red.test.ts` — `[SA6 owned]` 验收红灯测试（已存在，本设计契约起点）。SA3 预期零改动；若 SA2/SA4 裁决调整断言，按其指定最小范围由 SA6 修（SA3 可修测试基础设施但不准改断言逻辑）
- `apps/yjs-server/test/phase5-mgmt-verbs-sa7.test.ts` — `[SA7 owned]` 管理动词动态复验收编测试（R4/SA4 R3 B1 显式登记：SA7 创建的测试文件进 ALLOW LIST 而非 DENY——`DENY LIST` 含义是「任何 SA 都不准动」）。覆盖 §7 风险表 F1 收编面（G5b 收口结算超限 / 重引导链恢复入口）与管理动词边界复核；SA3 可修测试基础设施（hook timeout / fixture 隔离）但不准改断言逻辑

### DENY LIST

- `packages/ws-replication/**` — 引擎层冻结；reset 编排归属 composition root（AD-1 裁决）
- `packages/namespace-registry/**` — `resetReplica` 已交付，零改动
- `packages/namespace-runtime/**` — `replaceSchema`/`bumpReplicationEpoch` 写槽已交付，零改动
- `packages/persistence/**` — import/archive/probe 能力已交付，零改动
- `apps/yjs-server/src/main.ts` — 控制通道接线已就绪（`attachControlChannel`），零改动
- `apps/yjs-server/src/config.ts` — 三动词是运行期控制面，无配置键，零改动
- `apps/yjs-server/src/replication/**`、`apps/yjs-server/src/transport/**` — hub/peer 插件与传输层零改动
- `docs/protocols/instance-replication-v1.md` — wire 契约零变化（无新帧型）
- `docs/adr/**`、`CONTEXT.md` — 无新架构决策、无新术语
- `apps/yjs-server/src/index.ts` — 公共导出面零变化

## §9. 协议假设依据 (Protocol Assumption Evidence)

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险等级 |
|---|---|---|---|---|
| E1 | hub epoch fence 检出延迟上界 = `idleProbeMs = timeouts.ackTimeoutMs`（缺省 10s），SA6 30s 事件窗口可达 | 源码引用 | `packages/ws-replication/src/hub-namespace.ts:193`（`idleProbeMs: host.timeouts.ackTimeoutMs`）；`fence-watchdog.ts:56-65`（idle 节奏重武装）；`defaults.ts:39`（`ackTimeoutMs: 10_000`）；SA6 红灯报告基线实测 fence 链引擎级绿测（`ac6-resync-close` 等） | 低 |
| E2 | peer `removeTarget` 在 live 态的有界结算 = `closeTimeoutMs`（缺省 5s） | 源码引用 | `peer-namespace.ts:670-688`（CLOSE_NAMESPACE → `armTimer('close')`；未上线即本地收口）；`peer-namespace.ts:1341-1350`（close timer 用 `timeouts.closeTimeoutMs`）；`defaults.ts:38`（`closeTimeoutMs: 5_000`） | 低 |
| E3 | conflicted/closed 终态后 `addTarget` → §14.1 整连接重建 → 重 OPEN → bootstrap | 源码引用 | `peer-connection.ts:228-233`（`existing.state === 'closed' \|\| 'conflicted' \|\| 'failed'` → `setState('targeted')` + `requestRebuild('re-add')`） | 低 |
| E4 | registry `resetReplica` mismatch 路径零破坏（channel 不受影响的前提） | 源码引用 | `registry.ts:1707-1709`（`fence.kind === 'mismatch'` → return RESET_IDENTITY_MISMATCH_ISSUE，fence 在一切破坏性动作之前，槽注释 ②「先于一切 Persistence 探针/forceRelease/close admission/archive」）；既有 registry 级绿测（SA6 报告 §0.b） | 低 |
| E5 | observer 包事件 `type` 直通 NDJSON 为 `event` 字段 | 源码引用 | `apps/yjs-server/src/app.ts:157-160`（`const { type, ...rest } = event; this.sink({ event: type, ...rest })`）；事件名 `identity-conflicted` 在 `packages/ws-replication/src/types.ts:423` | 低 |
| E6 | Memory adapter 具备 archive/probe/import 三能力（AC3-③ memory 拓扑可行） | 源码引用 | `packages/persistence/src/memory.ts:141-160`（`importDoc`/`archiveDoc`/`readPersistedReplicationIdentity` 委托 core）；`contract.ts:124-130`（ReplicaPersistence 冻结面） | 低 |
| E7 | `STABLE_OP_ERROR_CODES` append 不破坏公共面（无形状锚定测试） | 源码引用 + 全仓 grep | `lifecycle.ts:102-110` 定义；`index.ts:28` 唯一导出点；全仓 grep `STABLE_OP_ERROR_CODES`（apps/yjs-server 内）仅此两处、无测试引用 | 低 |
| E8 | provision 启用的复制身份 epoch 恒为 1（SA6 correct-expected 断言前提） | 源码引用 | `packages/namespace-registry/src/types.ts:585-587`（enableReplication「原子安装随机 128-bit 复制谱系 + epoch 1」）；`app.ts:311-315`（provisioned 事件的 replicationId 投影链） | 低 |
| E9 | bump 后 hub 新写不向 conflicted channel 传播（SA6 `count ≠ 5` 断言） | 源码引用 | `hub-namespace.ts:690-705`（`onOwnedUpdate` switch：live/reconciling 系列之外的 default 分支忽略交付——conflicted 终态不投递） | 低 |
| E10 | 控制通道回执包装既有（三动词零 main.ts 改动的前提） | 源码引用 | `app.ts:436-441`（dispatch 结果包装 `event:'reply'`+`op`+`id`）；`main.ts:140-157`（`attachControlChannel` 每行恰一回执） | 低 |
| E11（R1/A-1；F1 修正短路门语义） | `opAddTarget` 幂等短路以 `peerOwners.has` **且通道非终态**为判据；`opRemoveTarget` 同步删除条目——G5a delete / G5c set 维护点的撕裂与伪成功路径依据（F1：终态通道按原短路门被拦截为伪 ok:true 零动作——已修正为状态感知门） | 源码引用 | `app.ts` opAddTarget（短路 = `peerOwners.has(nsId) && state ∉ {closed,conflicted,failed}`——终态放行 re-add）；`app.ts` opRemoveTarget（`peerOwners.delete`）；`app.ts:122/761-763`（`peerOwners` = peer 侧 `knownOwner` 唯一来源——read/verify-write 的 owner 解析） | 低 |
| E16（F1/SA7 复验收编） | 引擎 `addTarget` 对非终态 controller（含 closing）落入合流分支（`intent='active'` 零动作）、对终态触发 §14.1 re-add——G5b 等待结算后 addTarget 的修复依据；CLOSE 路径 removeTarget 结算与 controller 到达 closed 之间可存在竞争窗口 | 源码引用 | `peer-connection.ts:216-248`（existing 分支：blocked/rebuildPending → config-change 重建；closed/conflicted/failed → re-add；**其余（closing 等）→ 合流零动作**）；`peer-namespace.ts:644-705`（removeTarget 矩阵——live 等走 CLOSE_NAMESPACE + closeMemo 事件驱动结算）；`peer-namespace.ts:1369-1380`（closeTimeout 兜底结算点——预算上界依据）；`app.ts:829-848`（`waitPeerTargetSettled` 等待帮助） | 低 |
| E12（R1/A-1） | peer-connection 的 controllers map 无 delete 路径——removeTarget 后 controller 留存 map（终态），re-add 分支结构性可达（G5b addTarget 走 existing 终态分支的前提） | 源码引用 + grep | `peer-connection.ts:216-248`（addTarget 的 existing 分支）；全文件 grep `controllers.delete` **零命中**（SA2 交叉核验 + SA1 R1 复核一致） | 低 |
| E13（R1/A-2） | `removeTarget` 恒 resolve、`addTarget` 同步无 throw——G5b catch 为结构性防御边界 | 源码引用 | `peer-namespace.ts:644-705`（removeTarget 状态矩阵全分支 resolve，closeTimeout 兜底结算）；`peer-connection.ts:216-248`（addTarget 同步、无 throw 面） | 低 |
| E14（R1/O-1） | 停机后 addTarget 的重建被 stopping 守卫静默拦截——停机窗口伪回执终态依据 | 源码引用 | `peer-connection.ts:271/279`（`if (this.stopping) return`——dialNow/requestRebuild 入口守卫）、`705`（onConnectionStopped 域守卫）；`app.ts:373-415`（performStop 中 `peer.stop()` 先于进程退出） | 低 |
| E15（R2/SA4 复验补证） | replace-schema 不带 root 的 keep-root 路径：保留的旧 root 必须通过新 schema 校验——「schema 演进新增必填字段 + 无 root」必然 `{ok:false}` → 折叠 `write-failed`（R1 修复锚后用可选字段表达兼容演进） | 源码引用 | `packages/doc-runtime/src/schema-replace.ts:181-188`（keep-root 分支 extractYjsSnapshot + validateLogicalSnapshot 双证）；`packages/vfsl/src/validate.ts:568-573`（封闭对象必填缺失检查跳过 optional 字段——optional 演进合法）；`packages/vfsl/test/parse-vfsl-containers-markers.test.ts:225-226`（`notes?: YLeaf<string>` 可选字段语法锚） | 低 |

无其他协议级假设：本设计不新增 HTTP/WS 端点行为、不引入端口/进程生命周期假设、不依赖第三方库「应该会」行为（全部引用本仓源码与已交付测试）。

## §10. 契约改动连锁审计 (Contract Change Caller Audit)

**无契约改动**：本设计仅含**新增**（dispatch 表新 case、新私有 handler、稳定码数组 append、文档行追加）——不修改任何既有函数的签名、返回类型、throw 行为或错误通道；不新增 unconditional throw（一切新路径经结果对象/稳定码回执结算；handler 内 catch 全覆盖，`handleControlLine` 外层 catch 兜底既有）。

被调用方（全部为既有 API 的**新 caller**，非被改动方）：

| 被调用方 | 定义位置 | 本设计的调用点 | 既有错误通道（不变） |
|---|---|---|---|
| `NamespaceLease.replaceSchema` | `packages/namespace-registry/src/types.ts:584` | `opReplaceSchema` G4 | Promise resolve 结果联合；fatal 经 `RuntimeWriteFatalError` rejection（handler catch） |
| `NamespaceLease.bumpReplicationEpoch` | `types.ts:597` | `opBumpEpoch` G4 | 同上 |
| `NamespaceRegistry.resetReplica` | `types.ts:668-672`；实现 `registry.ts:1943` | `opResetReplica` G4 | Promise resolve 窄 issue 联合；branded fatal rejection（handler catch） |
| `PeerReplication.removeTarget` | `peer-connection.ts:250-254` | `opResetReplica` G5b | Promise resolve（事件驱动结算，不 reject） |
| `PeerReplication.addTarget` | `peer-connection.ts:216-248` | `opResetReplica` G5b | 同步、幂等（无 throw 面） |

（caller 侧审计不适用于「新调用方」场景——上表即完整调用清单；既有 caller 集合零变化。）
