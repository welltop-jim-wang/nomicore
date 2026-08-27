# SA4 静态验尸报告 — issue #134（Phase 5 切片 3/4：expose trusted NamespaceLease ReplicationSession）

- **Date**: 2026-08-28
- **审查对象**: `git diff ebc5419..HEAD`（666f9b1 实现 + 08b49fd SA6 R2 测试修复；基线 ebc5419 = #145 完成点）
- **实现依据**: `wiki/raw/task_namespace-lease-replication-session_design.md`（R1，771 行，逐字对照）
- **上游档案**: conflict_report / design_conflict_report / sa2_review / sa2_review_r2 / sa6_red / sa3_impl / dispatch / relevant_decisions / 任务简报（7 AC）
- **Verdict**: **pass**（0 MAJOR / 0 MINOR / 6 INFO；详见发现清单）

---

## 一、审查面逐面结论

### 1. 设计符合性 — ✅ 一致

- **D-1..D-16 逐条核验**：全部按 R1 落位。抽查要点——D-1（core 落位 `namespace-runtime/src/replication-session.ts`，index 零 re-export，registry 经 internal 消费 ✓）；D-2（WeakMap host 登记 + internal 第二值导出 ✓，见 §3 面）；D-3（R1–R7 槽序逐位对照 ✓，见 §2 面）；D-4（`Y.applyUpdate(doc, bytes, symbol token)` 受控 origin + 唯一否定谓词 ✓）；D-5/D-6/D-7/D-8/D-9/D-10/D-11/D-15 逐项在码内可指认；D-12/D-13/D-14 见 §3/§6 面；D-16 非目标面（队列/背压/needs-resync/WS/reset/archive/replication-protocol 依赖）零提前实现 ✓。
- **apply 槽序 R1–R7**（replication-session.ts:405–511）：R1 fatal（零 doc 访问）→ R2 身份/epoch（`state.replication` 投影链单点比对；不等 → 终态 conflicted + **同步 `fanout.detach(channel)`**——与 close() 共用摘除点）→ R3 writable（getStatus try/catch → `markWriteFatal(env, err, 'replication-apply')` + `RuntimeWriteFatalError('write-slot-internal', committed:false)`；degraded bypass 五条件合取；notifier 未绑定拒绝）→ R4 scratch 预演 → R5 单次 `Y.applyUpdate(doc, bytes, ctx.applyOrigin)`（catch → 保守 committed:true `unknown-pipeline-throw`）→ R5.5 标记（rootValidation 置位 + memoryCaughtUp=true）→ R6 同槽 `await notifyDirty()`（catch → committed:true `notify-dirty-failed`，**不重试**——不走 `rejectWithWriteFatal` 的 best-effort 重通知路径，与设计「不重试」逐字一致）→ R7 释槽。与设计 §4.4 表逐行同构。
- **INV-S1..S16**：逐项静态核验通过（关键项见 §2 面）；S15（`new Uint8Array(update)` 陷阱安全拷贝，绝不 `slice()`——replication-session.ts:309–324 且有防御 catch 分支）、S16（getStatus 全新深冻结 + durability 子对象深冻结）在码内可指认。
- **冻结词汇**：§6.1 五条 registry message 常量与设计逐字节一致（types.ts:88–98）；§6.2 runtime 六条 message（errors.ts:191–208）与 `writeDisabledMessage` 四域分域文案（replication-session.ts:591–605）与设计原文逐字一致（含全角破折号与括注）；`NSRT-FATAL-REPLICATION-APPLY-INTERNAL` 码/文案逐字 ✓。
- **ALLOW/DENY**：DENY 全清——`runtime/src/index.ts`、两包 `package.json`、`plugin.ts`、`observer.ts`、`packages/persistence|doc-runtime|vfsl|replication-protocol/**`、`runtime-write-fatal-message-rev1.test.ts`、`apps|domains/**` 均不在 diff。ALLOW 全覆盖，唯一例外见 INFO-2（registry-open.test.ts，D3 已声明）。
- **SA3 偏离声明核验（§3 六项）**：**全部如实且契约零变化**——
  - **D1**（seam 消费注入点 registry.ts 而非 lease.ts 直调）：已实证 `registry-surface.test.ts:364`（「Registry 包内仅 registry.ts 消费 internal subpath」单消费者精确断言）确在基线——lease.ts 直调确会击穿该测试且其不在 ALLOW。实现以 `deps.openReplicationSessionCore` 注入（registry.ts:747–751），lease.ts 零 internal import（已 grep 确认）；runtime internal 函数的生产行为、门序、结果联合零改动。偏离成立、正当。
  - **D2**（T-2 敌意载荷改畸形字节）：实证合理——全零 8 字节在 Yjs 是合法空操作 update，设计原载荷无法触发 RAW_UPDATE_INVALID；实现保留敌意子类陷阱（覆写 `slice()` throw）+「绝不同步 throw + resolved ok:false + 零写入 + 零 notify」全部设计意图断言（runtime-replication-session.test.ts:276–305）。意图零丢失。
  - **D3**：见 INFO-2。
  - **D4**（SameValue/Object.is）：`protectedPrimitiveEqual`（replication-session.ts:578–585）——NaN 自等、±0 分辨；「内容投影相等」字面语义的精确化，无 SA6 锚点影响。
  - D5/D6：纯落位精度（durability 深冻结；分域 message 单点 helper，插值仅闭集字面量——设计 §6.2 自身的 `{closing|closed}` 记法即插值语义）。

### 2. 正确性 — ✅ 无缺陷

| 核验点 | 结论 | 证据 |
|---|---|---|
| sequencer 同一实例（INV-S1） | ✅ 结构性成立 | runtime.ts V3d `const sequencer = new WriteSequencer()`（L241）被 V3d'' `replicationHost` 捕获（L253–257）；mutateRoot（L306）/replaceSchema（L316）/enable（L326）/bump（L333）/close barrier（L344）/session apply 与 close barrier（replication-session.ts:335, 389）全部 `enqueue` 该闭包局部量——全仓无第二写队列（`new WriteSequencer` 全仓仅 runtime.ts 一处） |
| 构造期恰一 `doc.on('update')`（INV-S2） | ✅ | 全 src grep `\.on('update'` 唯一命中 replication-session.ts:158（`createSessionFanout`，构造期无条件挂接，runtime.ts:249）；空 channel 集合零成本快路径 |
| 回声抑制（INV-S3） | ✅ | 唯一谓词 `if (origin === channel.applyOrigin) continue`（L160）；null origin（业务/管理写）恒投全部——T-3 测试实证 bump 的 META 写投给存量订阅（events=1） |
| 每 listener 独立副本 + 自捕获计数（INV-S4/T-2 和解） | ✅ | `listener(update.slice())` + `catch { channel.failures += 1 }`（L161–166）；快照迭代 `[...channel.listeners]` 防重入变异；计数经 `getStatus().observerFailures` 投影（L372）；测试断言 `observerFailures` 1→2 递增、他 session 照收、fatal null |
| detach 摘除点（SA2 R1 #4） | ✅ | 两处：close() 首调同步段（L385–388，仅 `terminal==='open'` 时——conflicted 已在 R2 摘除）；R2 conflicted 转换处（L427–428）。T-3 红灯实证 conflicted 后存量订阅零新增投递 |
| scratch-check 判据 (a)（INV-S8） | ✅ | `protectedContentEvaluated`（L529–545）：scratch 全量装载 → 装载待审 → 投影比对；`RAW_PROTECTED_FIELDS` 冻结常量（hub: schema+meta / peer: meta）；`protectedPrimitiveEqual` primitive 直比（SameValue）、非 primitive/undefined/bigint/symbol 保守判变；载体异型 getMap catch → 'changed'；键集不等/缺键 → 'changed'（长度检查 + scratch 键全覆盖 live） |
| degraded bypass 五条件合取（INV-S7/O-1） | ✅ | replication-session.ts:447–459：`handleStatus==='persistence-degraded' ∧ ctx.direction==='hub-to-peer' ∧ host.notifyDirty!==undefined`（lifecycle ready 由 A3、fatal 未置位由 R1 在合取前保证）；bypass 路径同走 R6 notify（测试 notifyCount=1 实证）；hub degraded/任意方向 released/disposed/notifier 未绑定全拒 |
| epoch fence 槽内重读（INV-S6/T-6） | ✅ | R2 读 `host.state.replication`（#132 投影链单点，E5.5 整替写入点在 sequencer 内——构造栈注释 runtime.ts:226–229 可证）；不读 live META |
| committed 诚实（INV-S12） | ✅ | R6 catch → `markWriteFatal` + `RuntimeWriteFatalError('notify-dirty-failed', true, ...)`（L498–507）；R5 catch → `rejectWithWriteFatal(host, true, ...)`（L485，内部先 markWriteFatal 再 best-effort notifier 恰一次——与既有 S/E 槽 fatal 序同构）；SA6 用例 19 + SA3 fatal 测试双重实证 |
| close barrier + never-reject（INV-S11） | ✅ | 幂等 same-promise（L384）；首调同步段标记终态+摘除；`sequencer.enqueue(async () => {})` 恒绿空槽体（L389–391）——结构性无 reject 面；T-4 实证结算序 [apply, close] + 全路径 unhandledRejection 计数 0 |
| A0–A4 接纳序 | ✅ | wrapper revoked 前置（lease.ts wrapCore）→ core A1 终态（closed→SESSION_CLOSED / conflicted→EPOCH_CONFLICTED 两分支）→ A2 `instanceof Uint8Array` + `new Uint8Array(update)`（含防御 catch）→ A3 lifecycle → A4 enqueue——与设计 §4.4 逐位一致 |

### 3. 公共面纪律 — ✅ 零突破

- **runtime index.ts 不在 diff**（DENY 遵守）：值导出仍恰 `RuntimeWriteFatalError` 一键（index.ts:31）；`ReplicationSessionClosedError` 不导出主入口（errors.ts 定义、index 无 re-export——沿 `RuntimeReadDisabledError` 先例 ✓）。
- **runtime 十二键对象面不变**：WeakMap 登记在 `Object.freeze(runtime)` 之后（runtime.ts:348–350），零属性污染；`runtime-registry-internal-seam.test.ts` 十二键锁（L283–296）零改动且全量绿。
- **internal subpath 恰两值导出**：`createNamespaceRuntimeForRegistry` + `openReplicationSessionCoreForRegistry`（internal.ts:47–55）+ 六 type-only；键集锁测试按文件头注既定先例同步演进（设计 §12 ALLOW 显式列出，D-2）。
- **registry 主入口 type-only**：八类型追加（index.ts diff——InstanceRole/Open*×3/ReplicationSession*×4），值导出面零变化。
- **types.ts 声明纪律**：新增类型全部纯结构性——零 Runtime 命名类型、零 internal subpath 字面量、零 Y.Doc/DocHandle/sequencer 引用（types.ts:315–318 注释 + 全文核验）；`registry-surface.test.ts` 主入口可达声明图审计全量绿。
- **Equal 断言锁完备**：lease.ts `LeaseTypeAssertions.sessionOpenCore`（`Equal<ReplicationSessionOpenCore, ReplicationSession>`）+ registry.ts 跨包真锁 `_sessionCoreAlias`/`_sessionStatusAlias`（`Equal<RuntimeReplicationSessionCore, ReplicationSession>` + status 同款，registry.ts:117–127）；三方转置封闭，typecheck 即红/绿门（本人复跑 exit 0）。
- **lease 运行时键集**：wrapCore 恰十键冻结字面量（lease.ts:246–266）；SA6 用例 5 属性探测 + FORBIDDEN 键断言全绿。

### 4. 错误与词汇 — ✅ append-only + 逐字节不变

- errors.ts diff **纯加法**（无一行删除/修改——git diff 佐证）；types.ts 同（既有 const 零触碰）。
- `markWriteFatal`/`writeFatalMessage` 重构为 if/else 但 `'root'/'schema'/'replication'` 三槽渲染输出与基线逐字节相同（常量同源、模板字符串不变）；`runtime-write-fatal-message-rev1.test.ts` 零改动全量绿 = 逐字节不变的测试证据。
- 新码注册单点：fatal 码/message 在 errors.ts；session 域拒绝 message 六条在 errors.ts（runtime 侧单一真相源）；registry 侧五条在 types.ts；`NAMESPACE_LEASE_RELEASED` 复用既有 const。
- `WriteSlot` append-only 追加 `'replication-apply'`（write.ts:80），既有调用（参数缺省/既有字面量）零影响。

### 5. 测试质量 — ✅ 高强度、确定性、零削弱

- **SA6 20 行为锚**：全部真·行为断言（真实 Yjs round-trip 重放、字节级比较、saveEvents 快照序、JSON 逐字节稳定、双 Registry 对照）；**零源码 grep 断言**（全测试文件扫描无 readFileSync+toMatch 反模式）。
- **SA6 5 类型探针**：条件类型结构探针（HasSessionCaps/HasForbiddenRefs/HasOpenReplicationSession/HasLeaseRawApply 保持性守卫）——对真实导出类型求值，非文本形状。
- **SA3 30 包内测试**：T-1..T-8 全部落位（Equal 双向自锁/敌意子类 Promise 结算/conflicted 停投/close barrier 结算序+unhandledRejection 0/status 新鲜冻结/memoryCaughtUp 初值与置位/敌意 SV 与非函数 listener/P0 preparing 期 open）+ R 门序短路逐项（含 statusCount 恰一次的 gate 访问计数锚）+ R4 矩阵（hub SCHEMA/META.replicationId/META.createdAt、peer SCHEMA 放行 META 拒、判据 (a) 删后同值重写边界、畸形字节）+ fanout 三锚 + 唯一 FIFO。
- **SA6 R2 修复零语义削弱**（08b49fd 逐行复核）：①saveEvents 绝对计数→基准化：**精确计数保持**（`=== saveBaseline + 3` / `+1` / `=== saveBaseline` 零新增——仍是恰 N 次断言，仅基准含 enable/bump 的既有 E6 notify，机械上绝对计数本就错误）；②AC-5 磁盘断言：首读 release + freshReader（新 MemoryPersistence 实例读同一 store）——`ext===7 && n===2` 断言原样保留，只是绕开 MemoryPersistence 活单元缓存（lifecycle.ts L177 事实，总控复核成立）；③fixture dispose 透传（纯测试助手）；④类型窄化（`if (result.ok) throw` 后断言 code——锚定码不变）。无一处放宽。
- **确定性**：固定时钟、受控 scheduler、计数随机源、微任务栅栏（`flushMicrotasks`/`schemaReady` 微任务循环）、Yjs 新键纪律（并发键随机 clientID 决胜的规避在两文件头注显式声明）；唯一真实时间面 = SA3 `readyOf` 的 `expect.poll`（10ms/5s，仅失败路径上限——见 INFO-4）与 File 测试的真实 tmpdir 读写（内容确定，无时序依赖）。
- **覆盖 vs 设计 §9/§9.1**：20+5 矩阵逐行有落位（§9 表）；T-1..T-8 逐行有测试（§9.1 表）；7 AC + O-5a/b 全覆盖。

### 6. 文档同步 — ✅ 四件套逐字落位（1 项 INFO 落位差异）

- **ADR 0010 增补节**（39 行）：open/apply 拒绝码注册全表（六码+六码，含 `NAMESPACE_LEASE_RELEASED` wrapper 唯一产出点注记）、session status 词汇（memoryCaughtUp **初值 false**、diskCaughtUp:false 字面量、observerFailures 无界纯计数）、O-9 生命周期词义（Lease 级计数/终态释放/close barrier 永不 reject/双摘除点）、O-12 判据（内容投影相等 + **「删后同值重写 = 内容未变 = 允许」边界点名** + 历史膨胀注记 + hub 侧全 META 收紧登记 + **scratch O(doc)/apply 已知成本与增量演进位**）、O-7、O-4 role 注入与缺省 'hub'、internal seam 第二导出指针、**enable/bump 字节不得 raw 回灌 + epoch 走控制面踩坑注记**、degraded 矩阵——设计 §10 ADR 0010 行的**全部登记项**逐项在场。
- **ADR 0009 两注记**：internal 两键（消费边界/import 图审计谓词零改动）+ Lease 代理面第十四成员与 released 通道表增补行 ✓。
- **phase-5 切片 3/4 锚定**：方法名六能力 + open 两域、role 注入、status 词汇、受保护常量与白名单空集、切片 9 role 注记、**C-1 needs-resync 对账注记原文逐字在场**（「本切片无队列 ⇒ ADR 0010 L113 唯一触发面（队列溢出）结构性不可达；needs-resync 与队列属主 = 切片 6」——与设计 L657 原文比对一致）✓。
- **CONTEXT.md**：ReplicationSession 词条扩写（六能力方法名/每 Lease 至多一个活跃/终态 closed|conflicted 释放槽位）+ 新增「实例角色」词条（options.role 注入/缺省 'hub'/peer 三管理写拒绝/localRole 必须等于实例角色/切片 9 必须显式传）。与设计 §10 行的唯一差异见 INFO-3。
- 文档与代码一致性抽查（method 名、码表、常量、初值、缺省值、检查顺序 randomBytes 之后）：全部与实现一致。

### 7. SA2 移交核对点（sa2_review_r2.md §6）— ✅ 三项全闭合

1. **T-1 跨包 Equal 落位**：采纳推荐路径 (a)（lease.ts src 断言——真锁）**并加码** registry.ts 跨包真锁（internal 命名类型 import 在合法方向 registry→runtime，registry.ts 本就是 internal 唯一生产消费者）；runtime 包测试**未** import `@nomicore/namespace-registry`（runtime-replication-session.test.ts:10–11 头注显式声明 + import 清单核验）——SA2 禁令遵守。
2. **§14 命名统一**：全仓 grep `openReplicationSessionCoreForRegistry` 统一无旧名残留（`openRuntimeReplicationSessionForRegistry` 零命中）。
3. **既有 fatal 渲染逐字节不变**：见 §4 面（rev1 测试零改动绿）。

### 8. vitest 触发性自检 — ✅ 亲跑复现

| 命令 | 结果 | 日志 |
|---|---|---|
| `npx vitest run packages/namespace-runtime/test/runtime-replication-session.test.ts`（forks=1） | **30/30 passed，Type Errors: no errors，exit 0** | `.mabf-bg/sa4-sample-rt-session.log` |
| `npx vitest run packages/namespace-registry/test/registry-phase5-replication-session-red.test.ts`（forks=1） | **20/20 passed，Type Errors: no errors，exit 0** | `.mabf-bg/sa4-sample-red.log` |
| `npx vitest run --typecheck packages/namespace-registry/test/registry-phase5-replication-session-surface.test-d.ts` | **5/5 passed，Type Errors: no errors，exit 0** | `.mabf-bg/sa4-sample-surface-td.log` |
| `pnpm --filter @nomicore/namespace-runtime --filter @nomicore/namespace-registry typecheck` | **exit 0（两包 Done）** | `.mabf-bg/sa4-typecheck.log` |

CI 触发性（§1.4 门禁）：根 `pnpm test` = `vitest run --typecheck`，include `packages/*/test/**/*.test.ts` + typecheck include `packages/*/test/**/*.test-d.ts`——三个新/改测试文件全部落在 CI `test` job 覆盖范围（`.github/workflows/ci.yml:39`），无孤儿测试。Scope Creep Guard：实际 diff 文件 = ALLOW 全集 + wiki 档案（白名单）+ registry-open.test.ts（INFO-2）；BLACKLIST（npm lockfile/yarn.lock/TASK.md/.bak）零命中。

---

## 二、发现清单（分级）

| # | 级别 | 位置 | 发现 | 证据 | 建议 |
|---|---|---|---|---|---|
| INFO-1 | INFO | `packages/namespace-runtime/src/replication-session.ts:219` | `PEER_ALLOWED_META_KEYS` 为声明未引用的语义占位常量（注释自证「零运行时差分」） | grep 全仓仅定义处+自身注释命中；typecheck 绿（无 noUnusedLocals 冲突） | 切片 6 接线 META 白名单时启用，或在 §4.6 注释中引用其定义处以闭合「占位」语义。不阻断 |
| INFO-2 | INFO | `packages/namespace-registry/test/registry-open.test.ts:923` | D3 偏离：lease 键集锁 12→13 演进超出设计 §12 ALLOW 显式清单（SA1 遗漏——§14 契约连锁审计未覆盖该运行时键集锁测试） | 设计硬性要求 NamespaceLease 第十四成员必然改变 `Object.keys(lease)`；ebc5419 同文件同模式先例（#132 增两键）；SA3 §3 已声明、总控 dispatch #8 已知情接受 | 回流 SA1：后续设计的 ALLOW LIST 应把「与 ALLOW 内文件机械耦合的键集锁测试」显式列入（或在 §14 表加行）。本案不构成阻断（零语义改动、单行、先例一致） |
| INFO-3 | INFO | `CONTEXT.md:126–129` | 设计 §10 CONTEXT.md 行表述为「Hub/Peer 词条注记实例角色经 Registry 构造注入」，实现为新增独立「实例角色」词条，Hub/Peer 词条本体未改动 | CONTEXT.md diff：仅 ReplicationSession 词条扩写 + 新增实例角色词条；Hub（L105）/Peer（L109）原文本就与角色语义一致（Peer 已含「不能本地修改 SCHEMA 或复制身份」） | 语义内容（注入点/缺省/peer 限制/切片 9 要求）已完整在册，词汇收口目的达成；可在切片 9 文档同步时顺手给 Hub/Peer 词条补一句指针。不阻断 |
| INFO-4 | INFO | `packages/namespace-runtime/test/runtime-replication-session.test.ts:104–106` | `readyOf` 用 `expect.poll`（interval 10ms / timeout 5s）轮询 P0 就绪——真实时间面（仅失败路径上限）；SA6 文件同场景用纯微任务循环 `schemaReady`（更强模式） | 两文件对照 | 统一为微任务循环模式可消除唯一真实时间依赖（非必须——就绪链有界，实践无 flake）。不阻断 |
| INFO-5 | INFO | `packages/namespace-registry/src/lease.ts:118–129` | `parseOpenSessionOptions` 以 `Object.keys` 计键——symbol 键不可见：携带两必需键 + 附加 symbol 键的输入可通过形状检查 | `Object.keys` 只返回 string 键 | 零安全影响（localRole/remoteInstanceId 值仍全验证，symbol 无下游消费面）；如需严格可在闭集外补 `Object.getOwnPropertySymbols` 判空。不阻断 |
| INFO-6 | INFO | `packages/namespace-runtime/src/replication-session.ts:534–540` | scratch 预演把「步骤 1（live doc 全量装载）」与「步骤 2（装载待审 bytes）」包在同一 try——live doc 读取失败（结构性不可达：live doc 已在槽前存活）会被归类 `REPLICATION_RAW_UPDATE_INVALID` 而非独立码 | 设计 §4.6 执行序未规定步骤 1 失败分类 | 拒绝方向保守（零写入）；保持现状即可，切片 6 若引入损坏文档场景可再分层。不阻断 |

**MAJOR：0；MINOR：0。** 无阻断项。

---

## 三、静态攻击面推演记录（§5 极端条件）

敌意 `Uint8Array` 子类（slice 覆写 throw）→ A2 陷阱安全拷贝中性化（T-2 实证）；敌意 Proxy options（ownKeys/getter trap throw）→ parseOpenSessionOptions 全探测 try/catch 收编 INPUT_INVALID；listener 重入（投递中退订/订阅/调 close）→ 快照迭代 + enqueue 微任务化无同步重入；listener throw 非 Error 值 → bare catch 兜住；detach 后 channel 再入 Set（conflicted→close 双摘除）→ Set.delete 幂等 + close 仅在 open 态摘除；SCHEMA/META 载体异型（同名 Y.Array）→ getMap try/catch 保守 'changed'；非 primitive 值（Y 容器入 SCHEMA/META）→ 保守判变；detached buffer 输入 → `new Uint8Array` 产出全零字节 → scratch 预演拒（良性闭环）；R4→R5 间状态漂移 → 同槽零 await 不可能；fence 在途竞态（两 apply 槽间 bump）→ FIFO + 逐槽重读确定性判定（前者提交后者 fence，与 ADR 0008 瞬时观察同构）。未发现可静态确认的漏洞。

## 四、动态审核重点（交 SA7 / 后继动态审核）

1. **close barrier × 真实停机序**：T-4 已锚受控 notify 门；真实 transport 停止序（session close → lease release → registry shutdown → persistence dispose）下 barrier 排序与 dispose 后观测面违约行为建议动态复验。
2. **scratch O(doc)/apply 实测量级**：大文档（MB 级 ROOT）下每 apply 全量装载+投影比对的延迟基线（ADR 已登记为已知成本；切片 6 增量检查演进的输入数据）。
3. **degraded retry 落盘真实性**：AC-5 以 MemoryPersistence 验证；真实 FilePersistence/adapter 的 degraded→retry→落盘合一建议动态复验（含 MemoryPersistence 活单元缓存这一读路径事实对 slice 6 读面的影响）。
4. **observerFailures 长寿命行为**：永久失败 listener 的无界计数与每投递 slice 副本内存（切片 6 队列属主接管前的运行期表现）。
5. **Yjs 版本锚定**：origin 回传/applyUpdate 语义在 yjs 13.6.32 实证；升级 Yjs 时 §13 四项假设需回归（建议 CI 锁版本 + 升级专项）。

---

## 五、结论

**verdict: pass**。实现与设计 R1 逐节一致（D-1..D-16 / R1–R7 / INV-S1..S16 / 冻结词汇逐字节 / ALLOW-DENY 遵守）；SA3 六项偏离声明全部如实且契约零变化；SA6 R2 修复零语义削弱；公共面纪律零突破；文档四件套逐字落位；SA2 三项移交核对点全闭合；三个新测试文件本人独立复跑全绿 + 两包 typecheck exit 0 + CI 触发性确认。6 项 INFO 均不阻断，回流建议已逐条给出（INFO-2 → SA1，其余 → 切片 6/9 档案化）。
