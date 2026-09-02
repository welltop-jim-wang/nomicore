# 独立终审评审报告（Spec 轴）— issue #134 Round 2 修订轮（PR #146 评审 12 项修复）

- **Date**: 2026-08-28
- **评审人**: 独立终审评审员（Spec 轴）——不复述流水线档案自我声明，全部结论基于本评审独立读码/读测试/实测
- **审查 diff 范围（明示）**: `git diff 4cfaffd..HEAD`（worktree `/home/wangjian/nomicore-fix-issue-134`，branch `fix/issue-134-on-docs-phase-5-websocket-replication`，HEAD = `1128ef7`）——恰 5 commits：8a68d82（SA3 实现）+ 2a7117a（M-1 文字收口）+ 9cfc1b6（SA6 同步）+ 1e2c748（设计 R2.2.1）+ 1128ef7（F-1 补锚）
- **规格基准**: ① 评审 12 项全文（`wiki/raw/task_namespace-lease-replication-session_round2.md` L18–77 逐字收录 + R2-1..R2-12 合同映射 L79–94）；② issue #134 AC 7 条（`gh issue view 134` 实取）；③ 设计定稿 R2.2.1（`_round2_design.md`，含 F-1..F-6 冻结与 R2.2/R2.2.1 修订记录）；④ ADR 约束（0010 含 round-2 修订节、0008、0009、phase-5 文档）
- **方法**: 全量 diff 逐文件过（21 文件全部逐 hunk 读）+ 评审 12 项逐项独立抽核（每项至少一条关键声称读源码 + 读测试锚）+ AC 7 条复核 round-1 锚完好性 + scope creep 扫描（diff name-only vs 设计 §17 ALLOW LIST 程序化比对）+ 全量测试本评审独立后台复跑 + grep 实证（残留/引用/锁在场）

## Verdict: **pass**

评审 12 项全部落位（修复 + 回归锚 + 文档登记三面齐备），AC 7 条零破坏，scope 零越界（21 文件 = ALLOW LIST 20 + wiki 档案豁免 1），断言零弱化（两处演进均有冻结登记且方向为增强/时序归位），全量 141 文件/1735 用例/Type Errors 0 本评审独立复跑绿。**无 CRITICAL/HIGH/MEDIUM/LOW 级发现**；INFO 级观察 4 条（均为非规范文本的措辞漂移/时点计数，不影响合并门禁），登记于文末。

---

## 一、评审 12 项逐项复核结论（独立抽核，证据 = 文件:行）

### 阻断项 1–5

| R2 | 评审要求 | 实现核验（本评审读码） | 测试锚核验（本评审读测试） | 结论 |
|---|---|---|---|---|
| R2-1 | bump 后立即停止旧 session outbound fanout | **落位**。bump 槽 E5.5' 主动 fence：`replication-write.ts:423` `env.fanout.fenceStale(facts.replicationId, nextEpoch)`（facts 整替之后、`await notifyDirty` 之前——L413-423 逐行核过）；谓词实现 `replication-session.ts:272-279`（冻结 `(replicationId, replicationEpoch)` 与传入不等 → `finalize('conflicted')`）；finalize（L375-384）= 终态置位 + `fanout.detach` + `queue.length = 0`（bump 自身 META 写已入队项被取消 ⇒ 旧 session 对 bump 写零投递，F-3 兑现）；apply 槽 R2 被动 fence 改用**同一** `channel.finalize('conflicted')`（L573）——零新增终态语义 ✓；enable 槽零 fence 调用（grep 全 src 证实 fenceStale 生产调用点恰一处）✓ | runtime round2-red #1（L165-186 bump 后零投递）/#2（L188-201 conflicted + currentEpoch=2 + 冻结 epoch=1 不漂移）/#3（L203-240 applyA→bump→applyB FIFO + B 零写入 + notify=2）；registry round2-red #1/#2/#3（L289-352 Lease 面 + 再 open 冻结 epoch=2）；SA3 包内锚：fenceStale 谓词正反（L363-383 身份不等/epoch 落后命中、完全相等幸存、二次幂等）、双 channel 直构一命中一不命中无跳过无过栅（L385-406）、fence 取消排队项（L408-423 积压 5 项 bump 后零投递）、conflicted 不降级（L425-435）——全部在场且为行为断言 | ✅ |
| R2-2 | Runtime close 终止并摘除 sessions | **落位**。`runtime.ts:346-356`：`lifecycle='closing'` → `fanout.terminateAll('runtime-close')` → barrier 入队——顺序冻结兑现（翻转后、barrier 前、同一同步段）；`terminateAll`（replication-session.ts:281-287）逐 channel `finalize('closed','runtime-close')`；`closedBy` 记账**不进 status 形状**（L342-344 类型注记 + L379 置位点）；A1 码域精化（L436-446）：`closedBy==='runtime-close'` → `RUNTIME_WRITE_DISABLED`（`writeDisabledMessage('lifecycle', …)` 同模板——round-1 双锚相容），显式 close 保持 `REPLICATION_SESSION_CLOSED`；排空语义零新增机制（barrier 队尾既有结构）✓ | runtime round2-red #4（L246-257 终态）/#5（L259-279 close 后直写 doc 零投递）/#6（L281-310 门闩拉开 in-flight apply、FIFO [apply, close]、落盘）；registry round2-red #11（L671-696 shutdown × in-flight：FIFO + 终态非 open）；SA3 锚：closedBy 映射 + `RUNTIME_WRITE_DISABLED` + 文案子串「close 已停止接纳会话 apply」（L441-462）、终态 throw + 重复 close 同实例恒绿（L464-478）；round-1 锚 runtime L736 / registry L1290 未被 diff 触及（hunk 清单比对）且全量绿 | ✅ |
| R2-3 | subscriber 不得同步阻塞 write sequencer | **落位**。observer（replication-session.ts:255-267）只做：回声抑制谓词 → 终态双保险 → 容量检查（**先于**字节复制，溢出零分配）→ `update.slice()` 入队 → 调度泵——listener 调用全部移出 transaction 栈；泵（L214-240）自延伸微任务链：单飞守卫、每项投递前让步 20（`FANOUT_DELIVERY_DEFERRAL_MICROTASKS` L151）、让步后重检双闸、交付时刻 listener 快照、每 listener 每投递 `item.slice()`（两级副本）、逐 listener 自捕获计数 + 最外层 catch 兜底、finally 复位与退出判定同同步段（无丢失唤醒——本评审读码确认退出检查与复位间零 await）；容量 16 冻结常量（L145）不可配置；溢出弃新保旧 + `needsResync` sticky（status 第 11 字段，L107-111 + getStatus L522 投影）——ADR 0010 L113 字面落地 ✓ | runtime round2-red #7（L316-336 400ms 自旋不阻塞 mutateRoot 槽 <250ms）/#8（L338-369 不阻塞 apply 槽与后续槽、跨 channel 回声抑制面）/#9（L371-396 64 突发 + 15ms 慢消费者 → needsResync=true + 总耗时 <400ms）；SA3 泵/队列锚 8 件（L169-357：16 入 17 弃、弃新保序重放真值、sticky+继续投递、两级副本 byteOffset/buffer、零订阅者消费、投递前退订零投递、交付集 ×2、isTerminal 抛错替身兜底零 unhandledRejection）；本评审复跑全量绿（含该套件） | ✅ |
| R2-4 | 内容投影相等支持允许结构值 | **落位**（SA8 路径 a）。`protectedPrimitiveEqual` 删除，`protectedValueEqual`/`isWhitelistedValueContainer`/`projectOf`/`deepEqualPlain`（replication-session.ts:744-809）与设计 §5.1 逐字一致；白名单 = Y.Map/Y.Array（显式容器）∪ plain array ∪ plain object（proto∈{Object.prototype,null}）——判别次序正确（`instanceof Y.Map/Y.Array` 先于 AbstractType 拒，白名单不自击穿）；键集先行保留（protectedMapEqual L736 仅替换值判等函数）；SameValue（NaN=NaN、-0≠0）；契约外容器/标量/非 plain 实例保守拒；META 值域零收窄（ADR 0008 L31 未触）✓ | runtime round2-red #10（L402-421 plain object/array 存量 ROOT-only 放行 + notify=1）/#11（L423-439 peer 侧同款）/#12（L441-459 真改仍拒零写入零 notify）；SA3 规则矩阵 9 锚（L484-695：键序无关放行 / 数组有序拒 / NaN 放行 + -0 拒 / 种子 Y.Text 拒 / Y.Text vs plain 'abc' 跨形态拒 / 嵌套契约外子值投影放行 / **F-1 补锚三件**：Date 种子经跨形态分叉拒 + undefined/bigint typeof fallthrough 拒 + Map/Set/symbol/function 种子面 loud throw 豁免）——与设计 R2.2.1 §5.2 表逐行对应 | ✅ |
| R2-5 | release 不得因 session seam 抛错半释放 | **落位**。`lease.ts:207-239` doRelease 同步段：① `released=true` ② `entry.leases.delete` ③ `releasePromise=Promise.resolve()` + dispatchObserver（均无 seam 依赖、先于 seam 调用）→ ④ `activeSession.close()` 无条件幂等直调（`Promise.resolve(closing).catch(()=>{})` 原生同化 + try/catch 同步隔离）→ ⑤ `onReleased?.()` 无条件到达；**getStatus 前置查询已删除**（diff 旧行确认）——半释放结构性不可达 ✓ | registry round2-red #4（L447-477 getStatus 抛错：release 不同步抛 + released + entry 删除 + onReleased 恰一次 + close 仍被尝试 + same-Promise）/#5（L479-500 close 同步抛错隔离）/#6（L502-524 终态 session 仍直调 close——`counts.close===1`）；hostile core 注入面 = 包内 `createLeaseController` deps（F-5 声明面，L412-437 直构）✓ | ✅ |

### 需要明确并验证 6–8

| R2 | 评审要求 | 核验 | 结论 |
|---|---|---|---|
| R2-6 | committed 标记诚实区分 | **落位（精确二分路）**。R5（replication-session.ts:626-649）：槽内注册 `beforeTransaction` 探针（晚于一切先注册 listener——敌意先抛 ⇒ 探针不运行 ⇒ `txStarted=false` ⟺ 零 mutation ⇒ `committed:false`；否则保守 true）；finally `off` 零泄漏；fatal 码/词不变（只精化布尔）；例外注记（复合敌意 under-report 方向）入 ADR round-2 D-4 段 ✓。测试：runtime round2-red #13（L465-489 beforeTransaction 抛错 → committed:false + ROOT 零变更 + fatal 置位）/#14（L491-510 afterTransaction → committed:true + mutation 保留）；SA3 锚：探针卸载经 lib0 `_observers` 表零残留（L708-736）、两分支 message 渲染（L738-759） | ✅ |
| R2-7 | no-op update 置位语义明确 | **落位（「成功接纳即置位」明文）**。零代码改动（R5.5 无条件置位即规范——SA8 放行方向）；明文规范入 ADR 0010 round-2 小节末段（成功接纳即置位全文 + L241/L107/CONTEXT/#79 依据链）+ runtime README 第 8 条；测试：runtime round2-red #15（重复 update 置位不回落 + notify=2）/#16（空效果 update 同置位）绿锁定——本评审读测试确认断言即「成功接纳即计数」语义 | ✅ |
| R2-8 | plugin peer role 装配缺口 | **落位（贯通路）**。plugin.ts：`NamespaceRegistryPluginConfig` +`role?: InstanceRole`（L98-102）；校验序 ①形状→②键集 ⊆{idleTimeoutMs,role}→③role 值域（`NAMESPACE_REGISTRY_ROLE_INVALID` 既有 const，非键集误报）→④`resolveIdleTimeoutMs`（L151-166 逐行核过）；apply 透传 `role`（L193）；**第二根因修复**：registry.ts:1343 工厂补转发 `options.role`（diff 确认 L1333-1339 展开原缺 role 键）；types.ts:75 文案「仅接受 idleTimeoutMs 与 role 键」+ registry-plugin.test.ts:240 同步一行。测试：registry round2-red #7（L530-538 config 接受 role 组合/缺省）/#8（L540-555 非法值 ROLE_INVALID 域）/#9（L557-606 真实 Cordis Context 装配 peer Registry + replaceSchema/enable 以 REPLICATION_ROLE_PERMISSION 稳定拒 + hub 对照）；README 两包均登记（§12 大纲落盘） | ✅ |

### 测试与文档收口 9–12

| R2 | 评审要求 | 核验 | 结论 |
|---|---|---|---|
| R2-9 | AC7 竞态矩阵七场景补齐 | **落位**。七场景覆盖：① accepted apply→Lease release = registry round2-red #10（L629-669 门闩 in-flight + FIFO [apply, close] + release 同步失效 + 后 apply `NAMESPACE_LEASE_RELEASED`，绿锁定）；② session close = round-1 AC-2/AC-7（在场未触）；③ Runtime close × in-flight = #11；④ 真实 idle expiry = round-1 AC-7 L1333-1357（fake-timer `advanceBy`，diff 未触）；⑤ Registry shutdown = round-1 AC-7 L1277-1293 + #11 联动；⑥ epoch bump × in-flight = #12（L698-724 FIFO [apply, bump] + 终态）；⑦ committed fatal = round-1 AC-7 L1359-1390（notify 失败 committed:true，diff 未触）+ round-2 red #13/#14 精化。全部确定性（门闩/微任务驱动，零 real sleep——本评审逐文件确认无 `setTimeout`/`sleep` 调用） | ✅ |
| R2-10 | owned bytes 测试直存原始参数 | **落位且为纯加严**。round-1 两文件 listener `u.slice()` 先复制后断言 → 直存 callback 原始参数 + 新增断言：数组互异 / byteOffset=0 / length=buffer.byteLength 全幅 / 底 buffer 不共享（含同一 session 相邻投递 buffer 互异——runtime L870-874、registry L1215-1233 diff 逐 hunk 核过）；round-2 red #17（L561-595）同口径绿锁定 + 内容真值重放（replay 到 n=8）。`replayDelta` 消费链保留——只增强零削弱 ✓ | ✅ |
| R2-11 | 两包 README 更新 | **落盘**。runtime README：Lifecycle 节 close 增补（同步终止 sessions/RUNTIME_WRITE_DISABLED/FIFO 排空）+ 新「ReplicationSession（内部宿主）」节 8 条（宿主与能力面/trusted raw 例外/degraded hub→peer/受保护字段/fanout 投递模型含 at-least-once 与 needsResync/epoch fence/生命周期边界/committed 诚实）——§12 大纲 8 条全落；registry README：ReplicationSession 节 5 条（登记句/plugin config+role/peer 权限边界/生命周期边界/status 词汇含 needsResync）+ Plugin configuration 节更新为 `{idleTimeoutMs?, role?}`——§12 大纲 5 条全落 | ✅ |
| R2-12 | PEER_ALLOWED_META_KEYS 删除/实用 + seam 类型收敛 | **落位**。常量已删除（grep 全域：仅 replication-session.ts:329 删除登记注释，零代码引用）——空集语义冻结由 ADR 0010 修订节 L253 文字承载；seam 类型收敛 = Equal 锁格架保留并即时演示：registry.ts:126-127 跨包双锁 + lease.ts:384 起自锁在场，`needsResync` 第 11 字段经「两点同步（runtime core + registry types）+ 编译器强制」落地（流水线期 TS2741 曾捕获 fixture 缺字段——编译器驱同步实证）；声明点未实际减少——设计 §13.2 以声明图纪律（主入口可达声明图不得引用 runtime 命名类型）论证保留三点、以编译器强制消除遗漏面，本评审认可该论证成立（遗漏即编译红，shotgun surgery 风险已闭环为两点 + 编译器）——见 INFO-4 | ✅ |

## 二、issue #134 AC 7 条复核（round-2 改动未破坏）

| AC | 复核（本评审独立核对 diff 触及面） | 结论 |
|---|---|---|
| AC1 openReplicationSession 一 Lease 一活跃 + role/remote/lineage/epoch 冻结绑定 | open 门序未被 diff 触及（replication-session.ts diff hunk 清单比对：门序段零改动）；R2-1 fence 后终态**释放**槽位 ⇒ 同 Lease 可再 open（registry round2-red #3 锚——冻结新 epoch=2）——语义增强非破坏 | ✅ 未破坏 |
| AC2 六能力 + 不暴露 Y.Doc/DocHandle/sequencer/live shared types | 公共面零变化：session 能力对象恰十键未动（channel 内部结构扩展不泄漏）；Equal 锁（registry.ts:126-127 / lease.ts:384+）编译绿；surface guard 测试全量绿（本评审复跑） | ✅ 未破坏 |
| AC3 apply 共享 write sequencer + dirty notification 先于 resolve | R5.5/R6 段未被 diff 触及（diff hunk 止于 R5 探针段与受保护判据段）；runtime round2-red #3 断言 notify=2（A 槽 + bump 槽各一次）、#15 notify=2——锚保持 | ✅ 未破坏 |
| AC4 hub scratch-check SCHEMA/META 先于 live apply；ROOT raw 保持 replication-unvalidated | R4 scratch 预演结构零改动；受保护判据仅值判等函数演进（primitive 直比语义逐字保留于 protectedValueEqual 末支）；round-1 受保护字段锚全为 primitive 真改变（SA2 复核 + 本评审抽读 L742-809 域确认无深比较隐藏冲突）；red #12 真改仍拒绿锁定 | ✅ 未破坏 |
| AC5 peer persistence-degraded 仅许已冻结 hub→peer trusted apply | A3 bypass 五条件合取段未被 diff 触及；round-1 degraded 锚全量绿 | ✅ 未破坏 |
| AC6 单 observer 扇出 immutable owned updates 多 session + 源 origin 排除 + observer 失败不影响已提交事务 | 单 `doc.on('update')` 监听不变（INV-S2）；回声抑制谓词不变（origin===token 唯一排除）；每 listener 每投递独立 slice 副本保持且升级为两级复制（字节面 INV-S4 逐条保持——R2-10 加严锚实证）；listener 失败隔离从「异常域」升级为「异常域+时序域」（捕获点移出 transaction 栈——对 AC6「不影响已提交事务」是**加强**）；round-1 AC-6 锚演进为直存+buffer 断言（仅增强，replay 断言保留） | ✅ 未破坏（隔离加强） |
| AC7 生命周期/竞态/fencing/fatal 确定性合同测试 | 七场景矩阵见 R2-9 行——round-1 锚（AC-7 describe L1276 起：shutdown 拒/epoch fencing/idle 保留/fatal committed）全部在场未被 diff 触及 + round-2 补 4 格；全量复跑绿 | ✅ 未破坏且补齐 |

## 三、Scope 结论（diff 文件集 vs 设计 §17 ALLOW/DENY）

- **diff name-only 全集（21 文件）** = ALLOW LIST 20 文件**逐路径命中**（runtime src×3、registry src×4、runtime test×3、registry test×3、ADR 0010、phase-5、两 README、CONTEXT.md、两 package.json）+ wiki/raw 设计文档 1（流水线档案豁免 + 简报 L102「Wiki 档案随代码入 git」授权）。**零 creep。**
- **DENY LIST 结构性零触碰**：`index.ts`/`internal.ts`/`write.ts`/`close.ts`/`sequencer.ts`/`status.ts`/`p0.ts`/`errors.ts`/`projection.ts`/`read.ts`（runtime）、`observer.ts`/`testing.ts`/`index.ts`/`errors.ts`/`identity.ts`/`create-document.ts`（registry）、`surface.test-d.ts`、persistence/doc-runtime/vfsl/replication-protocol/apps/domains——全部不在 diff 文件集（name-only 比对）。
- **版本 bump**：runtime 0.1.9→0.1.10 / registry 0.1.5→0.1.6，恰 `version` 单字段（diff 逐行核过，exports/dependencies 零改动）——简报 L101 义务兑现。
- **文档声称 vs 代码事实漂移扫描**：ADR 0010 round-2 小节六段（D-1 异步化/D-2a fence/D-2b close/D-3 深比较/D-4 二分+成功接纳即置位）与实现逐点一致（容量 16/让步 20/[16,24]/at-least-once 句/E5.5 落点/closedBy 码映射/白名单口径/探针判据——本评审逐句对照源码）；M-1 残留扫描：「仅有两种本地形态」docs/CONTEXT/README **零命中**；phase-5 C-1 改写 + 冻结词汇段在场；CONTEXT.md needs-resync 句在场。零漂移。
- `git diff --check 4cfaffd..HEAD`：exit 0。

## 四、断言弱化 / 行为正确性专项扫描（本评审对抗面）

- **断言演进审计**：全 diff 内既有断言改动恰两类，均有冻结登记且方向非弱化——① T-3 锚值 `1→0`（F-3：fence 取消未投递排队项 ⇒ bump 写零投递；依据 ADR 0010 L262「bump 字节不得经 raw 回灌」既有踩坑注记——是**向 ADR 回归的加强**，注释随值改写非孤儿断言）；② AC-2 ③ fixture 一行 `flushMicrotasks`（写后订阅前排空积压——at-least-once 语义下的时序归位；`received.length===1` 断言本体零变化）。R2-10 全部为加严。**未发现断言弱化。**
- **终态机正确性**：finalize 幂等守卫（`terminal !== 'open'` return）+ conflicted 不降级 + closedBy 记账全序（显式 close 先手保持 undefined / runtime-close 先手记账 / conflicted 先手两者均 no-op）——读码逐序核过；Set 迭代删当前元素安全 + 禁级联摘除不变量注记在场 + 双 channel 正反锚锁定。
- **泵正确性**：单飞守卫 + finally 复位与退出判定同同步段（无丢失唤醒）；让步后重检双闸；最外层 catch 收敛非 listener 抛点为计数（零 unhandled rejection 锚在场）。
- **探针正确性**：槽内注册 = 最后 listener（敌意先抛 ⇒ 探针不运行 ⇒ committed:false 精确）；finally off 零泄漏锚（lib0 `_observers` 表观测）。
- **深比较保守方向**：单侧白名单即拒（跨形态分叉）；敌意 toJSON 覆写 → scratch 恒诚实物化 → 投影必不匹配 → 拒；proto 门排除 Date/Map/Set/子类/跨 realm；嵌套契约外子值归一化边界（投影相等放行）为设计明文登记边界，种子面专属。
- **doRelease 敌意面**：`Promise.resolve(closing).catch(()=>{})` 原生同化逐病态走查（假 catch 对象/then getter 同步 throw/异步 reject/真 Promise）全部闭合；①②③ 先于 ④ 完成 ⇒ 半释放结构性不可达。
- **本评审独立全量复跑**：`pnpm test`（vitest run --typecheck，独立后台进程）= **141 文件 / 1735 用例全绿 / Type Errors: no errors / exit 0 / 46.1s**——与 SA4/SA7 声称逐字一致（1732+3 恰为 F-1 补锚）。

## 五、Findings（分级）

**CRITICAL / HIGH / MEDIUM / LOW：零。**

**INFO（4 条——非阻断，供后续参考）：**

1. **INFO-1（文档指针时点）**：ADR 0010 round-2 小节标题尾注「依据 `..._round2_design.md` R2.1」，而设计终态为 R2.2.1——append-only 小节的时点指针未随 R2.2/R2.2.1 更新；小节正文内容（白名单口径、二分、置位）与 R2.2.1 逐字一致，纯指针陈旧。
2. **INFO-2（测试头注措辞漂移）**：`runtime-replication-session-round2.test.ts` L24-26 头注称 SA2 #5 可选锚「由 registry 侧（SA6 或后续包内锚）承接」，而设计 R2.2 另核 2 的终态裁决为「SA7 动态验证可选直构（不入仓）」——SA7 已实际承接（probe-hostile 六型敌意 unhandledRejection Δ0）。头注为裁决前措辞，非规范文本。
3. **INFO-3（plugin 注释措辞）**：plugin.ts 两处「单读捕获」注释与实际有一步之差——`config.role` 在 `resolvePluginIdleTimeoutMs`（校验）与工厂体（`?? 'hub'` 绑定）各读一次（SA4 N-a 同款观察）；两次读取均在工厂调用期同步段，下游 `createRegistryInternal` 的 `assertRoleShape` 对域外值 loud 拒兜底，实际风险≈0。
4. **INFO-4（R2-12 收敛形态说明）**：seam 类型手工重复未实际减少声明点（仍 runtime core / registry types / lease 结构面三点），收敛的实现形态 = Equal 锁编译期强制两点同步（本轮 needsResync 第 11 字段即演示：fixture 缺字段曾被 TS2741 捕获）。评审项 12 后半的「减少手工重复、避免 shotgun surgery」以「编译器驱两点同步」释义落地——本评审认可其等效性（遗漏面已由编译器闭合），登记以备评审者原始措辞的不同解读。
5. **INFO-5（已登记表征的确认）**：SA7 N 级表征 4 条（跨 channel 首投递墙钟交错 / Proxy 种子延迟至 encode 期抛 / live 投毒经 R4 收编为 RAW_UPDATE_INVALID 的码语义面向 / 无节流突发弃新计数）——本评审读码确认均属种子/信任域或契约明文行为（§4.4 弃新保旧/sticky），与设计 §18/SA7 §十 登记一致，非缺陷。

## 六、审查范围与方法明示（可复现）

- **diff 范围**：`git diff 4cfaffd..HEAD`（21 文件，+3249/−87）；本评审逐 hunk 全量读（7 src + 6 test + 6 doc + 2 version）。
- **抽核深度**：评审 12 项逐项至少一条关键声称读源码 + 读测试锚（上表文件：行全部为本评审实际打开核对）；AC 7 条逐条 diff-hunk 位置比对确认未触及面 + 锚在场 grep。
- **独立实测**：`pnpm test` 后台独立进程复跑（141/1735/0 type errors/exit 0）；`git diff --check` exit 0；grep 实证三件（PEER_ALLOWED_META_KEYS 零代码引用 / 「仅有两种本地形态」零残留 / fenceStale 生产调用点恰一处= bump 槽）。
- **未轻信项**：流水线档案（SA3/SA6/SA2/SA4/SA7/AC checklist）的全部关键自我声明均经上述独立面复核；未发现档案声称与仓库事实的新偏差（SA2 N'-1 失实已在流水线内自我更正并有 SA4 F-1 复审闭合——本评审复核该更正属实）。

## 结论

**Verdict: pass。** 评审 12 项三面（修复/回归锚/文档登记）全部落位且经独立抽核属实；AC 7 条零破坏；scope 零越界；断言零弱化（两处演进均向 ADR 回归或时序归位且有冻结登记）；文档与代码零漂移；全量测试本评审独立复跑全绿。INFO 级观察 5 条均不阻断。建议：可以合并。
