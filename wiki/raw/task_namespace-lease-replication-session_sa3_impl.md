# SA3 实现报告 — issue #134（Phase 5 切片 3/4：expose trusted NamespaceLease ReplicationSession）

- **Date**: 2026-08-28
- **实现依据**: `wiki/raw/task_namespace-lease-replication-session_design.md`（R1，771 行，逐字执行）
- **基线**: ebc5419；worktree `/home/wangjian/nomicore-fix-issue-134`（branch `fix/issue-134-on-docs-phase-5-websocket-replication`）
- **结论**: 实现、测试与文档同步全部落位；**设计契约零偏离面**（机制层按 R1 逐项实现；下述「设计偏离声明」全部为可自证的落位精度/机制层调整与 SA6 锚点缺陷，无一改变语义或契约）。**SA6 红灯锚 20/20 未能全绿：7 个行为用例 + 1 处类型红经实证确认均为 SA6-owned 测试缺陷（回流 SA6，见 §5）；其余 13 行为用例 + 5 类型探针全绿。全量回归 1672/1679 通过，仅有的 7 个失败全部限于该 SA6 文件。**

---

## §1. 变更文件清单

### 新增（src）
- `packages/namespace-runtime/src/replication-session.ts`（新建，约 640 行）：fanout（`createSessionFanout`——构造期恰一 `doc.on('update')`、回声抑制谓词、快照迭代、每 listener 每投递独立副本、自捕获计数）、`RuntimeReplicationHost`、模块级 `WeakMap<NamespaceRuntime, host>`（`registerReplicationHost`）、会话 core 工厂（冻结四域 + 十键六能力）、apply 槽 R1–R7（fatal → 身份/epoch fence → writable(+degraded bypass 五条件合取) → scratch 预演（判据 (a) 内容投影相等）→ 一次 `Y.applyUpdate(doc, bytes, token)` → R5.5 标记 → `await notifyDirty` → 释槽）、`openReplicationSessionCoreForRegistry`（门序 host 缺席→lifecycle→fatal→disabled→冻结建 core；**无 schemaState gate**——显式裁决）、会话域拒绝 message（§6.2 冻结文案经 errors.ts 单一真相源）。

### 修改（src）
- `packages/namespace-runtime/src/errors.ts`：append-only——`FATAL_REPLICATION_APPLY_WRITE_INTERNAL_CODE/MESSAGE`（`NSRT-FATAL-REPLICATION-APPLY-INTERNAL`）、`REPLICATION_SESSION_CLOSED_CODE` + 五条会话域 message 常量、`ReplicationSessionClosedError` 类（不导出 index）。
- `packages/namespace-runtime/src/write.ts`：`WriteSlot` 追加 `'replication-apply'`；`markWriteFatal`/`writeFatalMessage` 增渲染分支（既有 `'root'/'schema'/'replication'` 渲染逐字节不变——`runtime-write-fatal-message-rev1.test.ts` 零改动即绿）。
- `packages/namespace-runtime/src/runtime.ts`：V3d'' fanout+host 一次成型（仅依赖已捕获局部量 + sequencer）；V3f `registerReplicationHost(frozen)` 在 Object.freeze 之后、返回之前——`Object.keys(runtime)` 仍恰十二键。
- `packages/namespace-runtime/src/internal.ts`：值导出由一键扩为两键（`createNamespaceRuntimeForRegistry` + `openReplicationSessionCoreForRegistry`）+ 六 type-only 导出；头注纪律更新（D-2）。
- `packages/namespace-registry/src/types.ts`：`InstanceRole`/`OpenReplicationSessionOptions`/`OpenReplicationSessionIssueCode`/`OpenReplicationSessionResult`/`ReplicationSessionApplyRefusalCode`/`ReplicationSessionApplyResult`/`ReplicationSessionStatus`/`ReplicationSession`（恰十键）+ 五条 message 常量 + `NamespaceLease.openReplicationSession`（第十四成员）+ `CreateNamespaceRegistryOptions.role`。
- `packages/namespace-registry/src/lease.ts`：open 编排 ①–⑥（released → 输入校验（单读捕获 + 全探测）→ role 匹配 → 每 Lease 一活跃计数 → seam → wrapCore 恰十键冻结）；`wrapCore`（apply 的 A0 revoked 前置 → `NAMESPACE_LEASE_RELEASED` 唯一产出点）；replaceSchema/enable/bump 三 role gate（冻结 `ROLE_PERMISSION_ISSUE` 常量）；`doRelease` 同步段调用活跃 `session.close()`（fire-and-forget；zero unhandled rejection 前提——close 恒绿 barrier）；`LeaseSessionOpen` 结构描述面 + `LeaseTypeAssertions.sessionOpenCore` Equal 断言。
- `packages/namespace-registry/src/registry.ts`：`assertRoleShape`（第五门，randomBytes 之后）+ `role` 闭包绑定 + `issueLease` deps 注入 `openReplicationSessionCore`；**跨包 Equal 真锁**（`Equal<RuntimeReplicationSessionCore, ReplicationSession>` + status 同款）。
- `packages/namespace-registry/src/testing.ts`：`overrides.role` 透传（同形同检查顺序）。
- `packages/namespace-registry/src/index.ts`：type-only 追加八类型（值导出面零变化）。

### 测试
- `packages/namespace-runtime/test/runtime-registry-internal-seam.test.ts`（**既有文件唯一按简报允许的演进**）：internal 值导出键集锁 `['createNamespaceRuntimeForRegistry']` → 两键（沿文件头注既定先例）。
- `packages/namespace-runtime/test/runtime-replication-session.test.ts`（**新建 SA3 owned，30 用例**）：设计 §9.1 T-1..T-8 全部落位 + 包内单元锚（open 门序/direction 派生/R 门序短路逐项（fatal/writable 双分叉/notifier 未绑定/released/disposed/adapter 违约/lifecycle A3）/R4 受保护字段矩阵（hub SCHEMA/META/createdAt、peer SCHEMA 放行、判据 (a) 删后同值重写边界、畸形字节）/fanout 多 channel 与回声抑制/observer 抛错隔离与 `observerFailures` 计数/唯一 FIFO 提交序）。
- `packages/namespace-registry/test/registry-open.test.ts`（**1 行演进——见 §6 偏离声明 D3**）：lease 键集锁 `12 → 13` 键（+`openReplicationSession`），沿 #132（ebc5419 同文件同模式）既定先例。

### 文档（§10 四件套）
- `docs/adr/0010-hub-peer-websocket-ydoc-replication.md`：新增「issue #134 修订」节——open/apply 拒绝码注册全表、session status 词汇（含 memoryCaughtUp 初值 false、diskCaughtUp:false、observerFailures）、O-7/O-9/O-12 语义冻结、判据 (a) 边界点名（删后同值重写允许 + 历史膨胀注记）、hub 侧全 META 收紧登记、scratch 预演 O(doc)/apply 已知成本与演进位、role 注入点与缺省 'hub'、internal seam 第二导出指针、enable/bump 字节不得 raw 回灌踩坑注记、degraded 矩阵。
- `docs/adr/0009-namespace-registry-leases-and-host-lifecycle.md`：两处注记（internal 两键 + Lease 代理面/released 通道表增补行）。
- `docs/phases/phase-5-websocket-replication.md`：切片 3/4 落地锚定（方法名/role 注入/status 词汇/受保护常量与白名单空集）+ 切片 9 role 注记 + **切片 3 needs-resync 对账注记（SA8 C-1 原文）**。
- `CONTEXT.md`：`ReplicationSession` 词条扩写（六能力方法名/每 Lease 一活跃/终态词）+ 新增「实例角色」词条 + Hub/Peer 词条互补。

---

## §2. 测试矩阵绿灯证据

| 套件 | 命令 | 结果 | 日志 |
|---|---|---|---|
| 设计 §9.1 T-1..T-8 + 包内单元锚（SA3 owned） | `npx vitest run packages/namespace-runtime/test/runtime-replication-session.test.ts --pool=forks --poolOptions.forks.maxForks=1 ...` | **30/30 passed**（Type Errors: no errors） | `.mabf-bg/sa3-rt-session-test2.log` / `sa3-targeted2.log` |
| SA6 红线文件（行为面） | `npx vitest run packages/namespace-registry/test/registry-phase5-replication-session-red.test.ts ...` | **13/20 passed；7 failed（全部为 SA6 锚点缺陷，见 §5）** | `.mabf-bg/sa3-red-test.log` / `sa3-full-regression.log` |
| SA6 类型探针 | `npx vitest run packages/namespace-registry/test/registry-phase5-replication-session-surface.test-d.ts ... --typecheck` | **5/5 passed**（连同 phase5-replication-surface 6 探针共 11 通过；Type Errors: no errors） | `.mabf-bg/sa3-surface-td.log` |
| 全量回归 | `pnpm test --pool=forks --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1 --testTimeout=60000 --hookTimeout=60000` | **1672/1679 passed（Test Files 137/138）**；唯一失败文件 = SA6 红线文件（7 个用例）；基线（#132/#110/#109/registry-open/registry-surface/import-graph 审计等）零回归 | `.mabf-bg/sa3-full-regression.log` |
| 包 typecheck | `pnpm --filter @nomicore/namespace-runtime --filter @nomicore/namespace-registry typecheck` | **exit 0（两包 Done）** | `.mabf-bg/sa3-typecheck3.log` |
| 全仓 typecheck | `pnpm typecheck`（10 包 tsc） | **exit 0** | `.mabf-bg/sa3-typecheck-all2.log` |
| `git diff --check` | — | **exit 0** | — |

其余验证证据：Yjs 语义探针（`packages/namespace-runtime/node_modules/probe-yjs*.mjs` → 输出于 `.mabf-bg/sa3-probe-yjs*.log`）：origin token 回传（`['Symbol(sessionA)']`）、`new Uint8Array(敌意子类)` 中性化、`encodeStateAsUpdate` 装载重放、畸形字节 scratch throw。degraded-retry 复现探针（`.mabf-bg/sa3-probe-retry.log`）：**确立 AC-5 失败机理 = reader 活单元缓存（与 #132 单次读取模式的差异），实现侧零缺陷**。

---

## §3. 设计偏离声明

| # | 偏离点 | 类型 | 说明 |
|---|---|---|---|
| D1 | internal seam 消费注入点：设计 §5.1 谓「lease.ts 直调 `openReplicationSessionCoreForRegistry`」，实现为 **registry.ts 单点注入 deps**（lease.ts 零 internal import） | 机制层落位精度（契约零变） | 设计 §0 O-2/D-2 假设「import 图审计谓词（`packages/namespace-registry/src/` 前缀）自动放行」；仓库实际契约（registry-surface.test.ts）为**单消费者**（仅 `registry.ts`）精确断言——lease.ts 直调将击穿该基线测试且该测试不在 ALLOW。实现改为 registry.ts（seam 唯一消费者，import 图审计谓词零改动、测试零改动）注入 `openReplicationSessionCore` deps；类型面以 lease.ts 结构性描述接口 + 双重 Equal 锁（registry.ts 跨包真锁 `RuntimeReplicationSessionCore ≡ ReplicationSession`；lease.ts 自锁 `ReplicationSessionOpenCore ≡ ReplicationSession`）转置封闭 |
| D2 | §9.1 T-2 敌意字节载荷：设计锚 `new EvilBytes(8)`，实现为 `new EvilBytes(畸形字节[0xff,0xff,0xde,0xad,…])` | 测试载荷精度（设计意图保留） | 设计期实测（probe）：**8 字节全零 update 在 Yjs 13.6.32 是「合法空操作 update」**——`new EvilBytes(8)` 无法触发 `REPLICATION_RAW_UPDATE_INVALID`（与设计 T-2 期望矛盾；SA2 R2 注记「全零字节→scratch 预演拒」经实证不成立）。敌意子类陷阱（覆写 `slice()` 同步 throw）与「拒绝全经 Promise 结算 + 零写入 + 零 saveDoc」的设计意图以畸形载荷完整保留并断言 |
| D3 | `registry-open.test.ts` lease 键集锁 12→13 键演进（+1 行） | 必要的既有测试演进（简报未显式列出） | 设计 §14 契约连锁审计未覆盖该运行时键集锁测试；实现 NamespaceLease.openReplicationSession（设计硬性要求）必然改变 `Object.keys(lease)`。沿 **#132 完全同款先例**（ebc5419 对同一测试添加 enableReplication/bumpReplicationEpoch 两键、同一 commit 亦演进 internal-seam 键集锁）演进一行——与简报「internal 键集锁演进（该文件头注有演进先例）」为同一既定先例类别。**此改动已超出简报 ALLOW 显式清单，提交中明示，如总控要求回退请指示（回退将直接导致设计不可实现）** |
| D4 | 判据 (a) 数值比较用 SameValue（`Object.is`）而非 `===` | 实现精度（无契约变化） | NaN/±0 边界：`===` 会将「未触碰的 NaN 值字段」误判为已改变（拒绝合法空操作 update）。SameValue 语义与「内容投影相等」字面一致；不影响任何 SA6 锚点 |
| D5 | `durability` 子对象同样 Object.freeze | 实现精度（INV-S16 深冻结一致） | 设计 JSDoc 已断言「全新深冻结对象」；子对象深冻结为字面落实 |
| D6 | open 拒绝的 `RUNTIME_WRITE_DISABLED` message 经单点 helper（lifecycle/fatal 两域文案） | 文案落位精度 | §6.2 冻结文案逐字使用；插值仅生命周期/doc 状态闭集字面量 |

## §4. 遗留风险

1. **SA6 红灯锚 7+1 未绿（本轮阻塞项，回流 SA6，§5 诊断）**——实现侧无任何可修面；SA6 修复后即可全绿（对应修复建议已给，SA6 预期是机械修改）。
2. **FIFO proof 语义**：apply 的 dirty 先于 resolve 已由 T-4/唯一 FIFO 测试与 AC-3 的 13 绿用例锚定；AC-3 计数断言（0 基准错位）为 SA6 测试口径问题，非实现问题。
3. **observerFailures 无界计数**（O-10 显式选择）：熔断/退订/背压属切片 6——文档已登记。
4. **scratch O(doc)/apply**：ADR 0010 增补节已登记已知成本与增量检查演进位（切片 6+）。
5. **close barrier 的 notifier 永挂 → close 永挂**：与 runtime.close 同款契约行为（不设内部 timeout）——ADR 0010 增补节已有对应表述（T-4 测试未覆盖永挂路径，属既有契约同款，非本切片新增风险面）。
6. 全量回归的 7 个失败文件全部限定在 SA6 红线文件；基线 1624 用例 + 新增 55 用例（30 session + 20 SA6 红线 + 5 探针）无其他回归。

## §5. SA6-owned 红文件缺陷诊断（回流 SA6，供其机械修复）

（实证均在 `.mabf-bg/sa3-red-test.log` / `sa3-full-regression.log` / `sa3-probe-retry.log`；修复建议只列形状，最终措辞归 SA6。）

| # | 用例 | 失败断言 | 机理（实证） | 建议修复形状 |
|---|---|---|---|---|
| 1 | AC-3 FIFO（L760/769） | `saveEvents[0].k1===1` / `length===3` | **enable 的 E6 槽 `await notifyDirty()` 已经推入 stub.saveEvents**（`SessionStubPersistence.saveDoc` 无条件 push；#132 基线测试自身断言 enable 后 `toHaveLength(1)`——registry-phase5-replication-red.test.ts L332）。实测事件序 = [enable(n=42), applyA(k1=1), write(n=9), applyB(k2=2)] | 在 enable 之后、session 阶段之前记录 `const saveBaseline = stub.saveEvents.length`，断言改为 `saveEvents.length === saveBaseline + 3`、`saveEvents[saveBaseline].k1===1` 等（或启用前清空 events；勿改断言语义——FIFO 序本身实现已满足） |
| 2 | AC-4 SCHEMA（L813） | `saveEvents.length===0`（实际 1） | 同上：基准 = enable 1 条 | 同 #1 基准化；`saveEvents.length === saveBaseline`（拒绝路径零新增） |
| 3 | AC-4 META.replicationId（L835） | `length===0`（实际 1） | 同上 | 同 #1 |
| 4 | AC-4 raw ROOT（L850/864） | `length===1`（实际 2） | 同上 | 同 #1（`saveBaseline + 1`；第二次 apply 前再取基线） |
| 5 | AC-5 peer degraded（L976） | `diskAfter…ext===7`（实际 undefined） | **MemoryPersistence 活单元缓存**：`reader.loadDoc` 对已 live 的 cell 直接 `issueHandle(cached.entry)`（lifecycle.ts L177 单行）——step 4 的 `diskFirst` loadDoc 未 release handle，step 5 的第二次 loadDoc 返回同一旧解码 doc（存储已更新但 read 走缓存）。隔离复现（probe-retry：`reader first load … second load ext= undefined`；单次读取的 #132 同型场景全绿） | step 4 后 `await diskFirst?.release()`（或改用 `fx.reader` 第二实例/在 step 5 前 dispose 重建 reader），使 step 5 的 loadDoc 重新读 store |
| 6 | AC-7 epoch fencing（L1193） | `saveEvents.length===0`（实际 2） | 基准 = enable 1 + bump 1（两者 E6 均 notify） | 同 #1 基准化；fence 断言 = `saveEvents.length === bumpBaseline`（零新增） |
| 7 | AC-7/AC-2 File 重启（L1324） | `first.persistence.dispose is not a function` | **DocCapturingPersistence fixture 不转发 `dispose`**（#132 同型场景直接使用 FilePersistence 实例——其有 dispose；本文件包装类缺转发） | fixture 增加 `async dispose()` 透传 inner（沿本文件 CountingDocPersistence 的 dispose 转发先例） |
| 8 | 类型红（L609 `result.code`） | TypeCheckError | `openReplicationSession` 落地真实类型后，`asSessionLease(lease)` 的交集方法签名解析为真实 `OpenReplicationSessionResult`——`result.ok` 判别处 `code` 在 ok:true 分支缺席（该文件的「本地结构声明 + cast 零 TS2339」假设在方法真实存在后不再成立） | 该断言处窄化：`if (result.ok) throw ...` 后再 `expect(result.code)`（或对 `result` 先 `as OpenSessionResult` 局部形状收窄） |

> 说明：#1–#4/#6 的绝对计数无法在保持基线语义（enable/bump E6 必 notify，ADR 0008/0006）与设计语义（apply 槽 R6 必 notify）两全下成立——设计 §9 矩阵自身表述为「saveEvents 序逐槽累计一致」（相对序），SA6 实现为绝对计数，属测试口径错位。

## §6. 交付状态

- git commit（本地，未 push）：`<见 §commit>`。
- 部署/运行位：代码、测试、文档全部落位；`git status` 仅剩 wiki/raw 任务文档与 SA6 红文件（本 round 未跟踪文件，一并提交进本轮 commit）。
- **总控处置请求**：① SA6 按 §5 修复 8 项红文件缺陷（机械修改，无语义争议）；② 确认 D3（registry-open 键集演进一行）为既定先例类允许（否则请指示）。
