# SA6 红灯锚定报告 — issue #134 Round 2（评审 12 项 → R2-1..R2-10 测试契约）

- 角色：SA6 Red Test Writer（修订轮；PR #146 评审 12 项 → 合同缺陷修复）
- 基线：branch fix/issue-134-on-docs-phase-5-websocket-replication（PR #146 当前代码）
- 盘点前结论（对 round-1 既有覆盖的核对，见 §5）：仅 R2-9 矩阵三格为真实缺口，其余按既有覆盖登记。
- 测试运行方式：`pnpm exec vitest run <file> --typecheck.enabled=false`（后台独立进程）；全量基线 `pnpm test`（vitest run --typecheck，138 文件/1681 用例）。

## 1. 产出文件（3 新增 + 2 加严改造）

| 文件 | 类型 | 规模 |
|---|---|---|
| `packages/namespace-runtime/test/runtime-replication-session-round2-red.test.ts` | 新增红灯/锁定套件 | 17 用例 |
| `packages/namespace-registry/test/registry-phase5-replication-session-round2-red.test.ts` | 新增红灯/锁定套件 | 12 用例 |
| `packages/namespace-runtime/test/runtime-replication-session.test.ts` | round-1 文件（R2-10 允许范围加严：仅 listener 直存原始参数一档 + 独立/buffer 断言） | 30 用例全绿 |
| `packages/namespace-registry/test/registry-phase5-replication-session-red.test.ts` | round-1 文件（同上，AC-6 用例） | 22 用例全绿 |

零生产代码改动；零源码 grep 断言；一切断言锚可观察运行时行为（status/结果联合/投递计数/时序探针/字节 identity）。

## 2. 逐用例红/绿实况（新套件）

### 2.1 runtime 侧 `runtime-replication-session-round2-red.test.ts`（17 用例：10 红 / 7 绿）

| # | 用例（标题摘要） | R2 | 实况 | 失败证据（当前代码实测） |
|---|---|---|---|---|
| 1 | bump settle 后旧 session listener 对后续本地写零投递 | R2-1 | **红** | `expected 3 to be 2`——bump 后 mutateRoot 仍投给存量 listener（fence 要等下一次 inbound apply） |
| 2 | bump settle 后旧 session getStatus 转 conflicted | R2-1 | **红** | `expected 'open' to be 'conflicted'`——bump 不触发终态化 |
| 3 | FIFO：apply A → bump → apply B 严格按序；A 落盘 B 被 fence 零写入 | R2-1 | 绿（锁定） | applyA ok → bump ok → B REPLICATION_EPOCH_CONFLICTED，顺序 [applyA, bump, applyB] |
| 4 | Runtime close 后 session getStatus 终态（非 open） | R2-2 | **红** | `expected 'open' not to be 'open'`——close 只切 lifecycle |
| 5 | Runtime close 后存量 listener 对后续 doc 写零投递 | R2-2 | **红** | `expected 2 to be 1`——close 后 direct doc 写仍投递（channel 未 detach） |
| 6 | 已接纳 apply 先于 close barrier 排空（FIFO） | R2-2 | 绿（锁定） | 门闩拉起：order [apply, close]，apply ok:true |
| 7 | 慢 listener（400ms 自旋）不阻塞 mutateRoot 槽 | R2-3 | **红** | `expected 400.32 to be less than 250`——槽被同步阻塞（阻塞面 = 评审阻断 3） |
| 8 | 慢 listener 不阻塞 apply 槽与后续 sequencer 槽 | R2-3 | **红** | `expected 400.33 to be less than 250`（apply 槽被跨 channel 慢 listener 同步阻塞） |
| 9 | 溢出可观测：慢消费者 + 64 突发写 → needs-resync 标记；突发槽零阻塞 | R2-3 | **红** | `expected undefined to be true`（status 无 needsResync 可观测面）；突发总耗时 968ms ≥ 64×15ms（同步阻塞累加） |
| 10 | META 含合法 object/array：ROOT-only update 放行 | R2-4 | **红** | `expected false to be true`——非 primitive 恒判变 → REPLICATION_PROTECTED_FIELDS_CHANGED 误拒 |
| 11 | peer 方向：META 结构值未变时 ROOT 更新放行 | R2-4 | **红** | 同上（peer 侧 META 全键保护同样误拒） |
| 12 | 真改受保护结构值（META 新键含对象）仍拒 | R2-4 | 绿（锁定） | REPLICATION_PROTECTED_FIELDS_CHANGED + 零写入 + 零 notify |
| 13 | beforeTransaction 抛错（零 mutation）→ committed:false | R2-6 | **红** | `expected true to be false`——当前对 live apply 一切异常恒 committed:true（过报） |
| 14 | afterTransaction 抛错（mutation 已发生）→ committed:true | R2-6 | 绿（锁定） | RuntimeWriteFatalError committed:true + ROOT 变更保留 |
| 15 | 重复 update apply 成功：rootValidation/memoryCaughtUp 置位不回落 | R2-7 | 绿（锁定） | 二次 apply ok:true（成功接纳即置位——SA8 放行方向） |
| 16 | 空效果 update apply 成功：同置位 | R2-7 | 绿（锁定） | ok:true + 置位 + notify 1 次（#79 互证） |
| 17 | callback 原始参数每投递独立：数组互异、byteOffset=0、length=全幅、buffer 不共享 | R2-10 | 绿（锁定） | 当前 slice() 实现已满足（每 listener 每投递独立副本）——加严锚 |

### 2.2 registry 侧 `registry-phase5-replication-session-round2-red.test.ts`（12 用例：11 红 / 1 绿）

| # | 用例 | R2 | 实况 | 失败证据（当前代码实测） |
|---|---|---|---|---|
| 1 | bump settle 后旧 session listener 对后续本地写零投递（Lease 面） | R2-1 | **红** | `expected 3 to be 2` |
| 2 | bump settle 后旧 session getStatus 转冲突终态 | R2-1 | **红** | `expected 'open' to be 'conflicted'` |
| 3 | bump settle 后同 Lease 可 open 新 epoch session | R2-1 | **红** | `REPLICATION_SESSION_EXISTS`——旧 session 未终态未释放槽位 |
| 4 | release：getStatus 同步抛错 → 不同步抛 + released/onReleased/close 全完成 | R2-5 | **红** | `expected Error: session status seam down to be undefined`（release 同步抛出；close 与 onReleased 被跳过） |
| 5 | release：close 同步抛错 → 不同步抛 + onReleased 恰一次 | R2-5 | **红** | 同上（close 抛错同步穿透跳过 onReleased） |
| 6 | 终态 session（state 非 open）release 仍幂等直调 close | R2-5 | **红** | `expected 0 to be 1`——先查状态再 close，终态跳过 close |
| 7 | plugin config 接受 role:'hub'/'peer'（可组合 idleTimeoutMs） | R2-8 | **红** | `TypeError: NAMESPACE_REGISTRY_PLUGIN_CONFIG`（仅接受 idleTimeoutMs 单键） |
| 8 | 非法 role 值 loud 拒绝（NAMESPACE_REGISTRY_ROLE_INVALID 域） | R2-8 | **红** | 实测报 `NAMESPACE_REGISTRY_PLUGIN_CONFIG`（键集误报——不是 ROLE_INVALID 域） |
| 9 | peer-role Registry 经 plugin 组合：replaceSchema/enable 以 REPLICATION_ROLE_PERMISSION 拒；hub 对照 | R2-8 | **红** | 插件工厂对 {role} 直接抛 PLUGIN_CONFIG → peer 装配结构性不可达 |
| 10 | accepted apply → Lease release：在途 apply 不被取消、先于 close barrier 结算 | R2-9 | 绿（锁定） | order [apply, close]、apply ok:true、release 同步失效、后 apply NAMESPACE_LEASE_RELEASED |
| 11 | accepted apply → Runtime close（registry shutdown）：apply 先排空 + session 终态 | R2-9 | **红** | order [apply, shutdown] FIFO ✓，但 `expected 'open' not to be 'open'`（session 未终止） |
| 12 | accepted apply → epoch bump：FIFO 结算序 + 旧 session 终态 | R2-9 | **红** | order [apply, bump] FIFO ✓，但 `expected 'open' not to be 'open'`（bump 后旧 session 未终态） |

## 3. 语义分歧点 / 待 SA1 冻结清单（如实上报）

1. **R2-3 needs-resync 可观测标记形状**：本套件以 `getStatus().needsResync: boolean` 为溢出可观测锚（评审措辞「channel 标记 needs-resync」，ADR 0010 L113「标记为 needs-resync」）。**SA1 冻结：标记字段名（needsResync / 独立 channelState 词 / observerFailures 旁路计数等）、标记后 channel 投递行为（继续投递 vs 等同 detach——冲突门禁 D-1 义务）、队列有界尺寸语义与溢出触发条件**。若冻结形状与本锚不同（如标记放 status 之外、字段命名不同），本套件 #9 需按冻结改写——属 SA1 裁决职责，非实现缺陷。
2. **R2-2 session 终态词汇**：本套件锚「终态 = `state !== 'open'`」（`closed` vs `conflicted` 的具体选用由 SA1 冻结，D-2b 义务——冲突报告明文「session 终态词汇选择由 SA1 冻结」）；报告内建议 `closed`（显式 close 语义），但未锁死。
3. **R2-1 bump 槽边界 fence 与 bump 自身 META 写的相对序**：本套件只锚「bump settle 后零投递」，未锚「bump 自身的 META 写是否投给旧 session」（round-1 T-3 已观察到 bump 写投递 events=1；若 SA1 冻结 fence 在 bump 事务前则 round-1 该断言需联动演进——提请 SA1 注意该联动面）。
4. **R2-6**：beforeTransaction 零 mutation ⇒ committed:false 已实测可判（Yjs 13.6.32 `transact` 的 beforeTransaction emit 位于事务函数之前——本套件 #13 注入证实零 mutation + 当前过报 committed:true）。**结论：无需保守过报规范——可精确区分**；SA1 只需冻结「beforeTransaction/afterTransaction 异常二分的精确判据」与 ADR 修正措辞（D-4 随 D-3 同批）。例外注记：区分仅在「注入面为 yjs 事务钩子」时成立；applyUpdate 解码期异常（R4 已拦为 RAW_UPDATE_INVALID）与 notifyDirty 失败（committed:true 已被既有用例锁定）不在此判据内。
5. **R2-5**：hostile seam 注入面为 lease.ts 包内直构（`createLeaseController` 经 deps.openReplicationSessionCore 注入敌意 core）——绕过真实 runtime seam（该 seam 无测试注入点）。**行为契约与注入面分离**：断言全部锚公共可观察行为（release 同步面/onReleased/close 尝试/释放事实），修复改 doRelease 顺序即绿，无需改测试。
6. **R2-9b/c 的终态断言**：与 R2-1/R2-2 的终态红同源（真实缺口是「in-flight apply 的 FIFO 序」——已绿的部分 + 「终态」——红的部分）；若 R2-1/R2-2 修复落地，两用例自然转绿，无新增语义分歧。

## 4. 中断门禁说明

- 全部 12 项中 10 项按简报预期红（R2-1..R2-6、R2-8、R2-9 终态部分、R2-2 部分）；R2-7 与 R2-10 与预期一致为**绿锁定**（SA8 放行方向「成功接纳即置位」当前实现已满足；owned-bytes 加严当前 slice() 实现已满足）。**无「红灯写出来是绿」的假绿/不可复现情形。**
- 测试执行全部后台独立进程；耗时敏感用例（R2-3）使用有界同步自旋 + 宽裕墙钟阈值（400ms 自旋 vs 250ms 阈值；实测当前 400.3/968ms——判别裕度 >150ms），零 real sleep、零真实网络。

## 5. R2-9 竞态矩阵盘点（七场景 → 覆盖状态）

| 场景 | round-1 既有覆盖 | 本轮补锚 |
|---|---|---|
| accepted apply → Lease release | 无（MEDIUM-1 只锚「subscribe → release」，非 in-flight apply） | #10（绿锁定——release 不取消已接纳 apply、FIFO、释放后拒） |
| session close | 有（AC-2 幂等 close + T-4 close barrier/in-flight apply；runtime 侧 30 用例） | ——（无需补） |
| Runtime close | 有（AC-7 用例 16 apply 拒 + runCloseBarrier）但**无 in-flight apply 排空序** | #11（FIFO 序绿 + session 终态红） |
| 真实 idle expiry | 有（AC-7 用例 18 idle 保留；fake-timer scheduler `advanceBy`——简报允许 fake-timer 路径） | ——（无需补） |
| Registry shutdown | 有（AC-7 用例 16） | #11 联动（shutdown × in-flight apply） |
| epoch bump | 有（AC-7 用例 17 + runtime T-3）但无 in-flight 序、无 bump 边界主动 fence | #1/#2/#3 + #12 |
| committed fatal | 有（AC-7 用例 19 notify 失败 committed:true） | ——（无需补） |

## 6. 结论

- 新增 29 用例：**21 红（预期红，全部锚定可观察行为）+ 8 绿锁定**；touch 的 round-1 两文件 52 用例全绿（R2-10 加严未破坏既有语义）。
- 全量基线回归（`pnpm test` = vitest run --typecheck）实测：**140 文件 / 1710 用例 / Type Errors 0 / 零 unhandled error**——其中既有 138 文件 **1689 用例全绿**（1681 基线 + 8 新绿锁定），21 个失败**全部**为新套件的预期红灯（仅两个新文件）；被 R2-10 改造的 round-1 两文件零回归。
- 类型面纪律：R2-5 敌意 core 替身以**完整类型化字面量**满足 `ReplicationSessionOpenCore`（getStatus 返回全形 `Readonly<ReplicationSessionStatus>`——`makeHostileStatus` 冻结产物；close 返回 `Promise<void>`），敌意行为（抛错/计数）仅注入实现体内——**零 `as unknown as` 键面放宽、零 TS2339**；R2-8 plugin config 的新契约键 `role` 沿用 round-1 先例以本地 cast 表达（config 类型面缺 role 正是被锚定的契约缺口，行为断言以运行时为准）。
- 待 SA1 冻结项见 §3（现 6 项，均已有 SA8 冲突门禁方向或为文档义务）；实现与修绿属 SA3，本报告不提供修复代码建议之外的实现细节。

---

## R2.2 同步执行记录（SA2 R2.2 复审 pass 后；§15.3 三项，全部零断言语义变化纪律）

三项落位：

1. **§15.3-1（fixture 类型面同步）**：`packages/namespace-registry/test/registry-phase5-replication-session-round2-red.test.ts` 的 `makeHostileStatus`（全形 status 字面量唯一处——SA3 核对）追加 `needsResync: false`（`ReplicationSessionStatus` 增第 11 字段后的编译必需，TS2741 消除）——文件内其余 status 消费经 cast，零改动；断言本体零改动。runtime 侧 round-2 文件按 §15.3-2 零同步（status 消费经 `as unknown as` cast，类型面已兼容）。
2. **发现 1（AC-2 ③ 一行时序演进，SA1 R2.2 裁决 2 授权）**：`packages/namespace-registry/test/registry-phase5-replication-session-red.test.ts` AC-2 ③ 用例——步骤 ② `mutateRoot(n→8)` 之后、步骤 ③ 订阅之前插入一行 `await flushMicrotasks()`（含注释：异步 fanout 交付集 = 交付时刻 listener 快照（§4.2 要点 8 at-least-once）——排空积压使锚回到「订阅先于写」时序域）。`received.length===1` 断言本体零变化。
3. **发现 2（spin fixture 收尾，SA1 R2.2 裁决 3(a) 授权）**：`packages/namespace-runtime/test/runtime-replication-session-round2-red.test.ts` 慢 listener 自旋用例测试末尾追加 close 收尾——red #7（`await session1.close()`）、red #8（`sessionA`+`sessionB` 均 close）、red #9（15ms fixture 同款义务，`await session1.close()`）——终止 channel + 清队 ⇒ 自延伸泵于下一让步点退出，消除跨测试泵泄漏（§4.3(d) 测试隔离义务）；断言零改动。

复跑证据（全部后台独立进程）：

| 验证 | 命令 | 结果 |
|---|---|---|
| 三个受影响文件（round-2 runtime 17 + round-2 registry 12 + round-1 AC-2 ③ 所在 22） | `pnpm exec vitest run <3 files> --typecheck` | **3 文件 / 51 用例全绿，Type Errors no errors，exit 0** |
| 全量回归 | `pnpm test` | **141 文件 / 1732 用例全绿，Type Errors no errors，零 TypeCheckError / 零 Unhandled，exit 0**（46.2s） |

结果对齐 §15.4 预期：「21 预期红转绿 + 新绿锁定 8 例」⇒ 140→141 文件（+SA3 新包内套件）、1710→1732 用例全绿；零类型/零 unhandled。
