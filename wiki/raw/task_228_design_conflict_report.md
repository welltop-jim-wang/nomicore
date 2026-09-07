# 设计冲突门禁报告 — Issue #228（design 后 ADR 冲突复审）

> 本文件含两轮裁决：**iteration 1**（设计后复审，下方正文，verdict=clear）+ **iteration 2**
> （收尾复审：D4 追认/勘误 E-1/E-2 一致性 + T-H5–H8 + 全变更集公共面复核，见文末
> 「收尾冲突门禁报告」节，verdict=**clear**、`requiresConflictRecheck: false`——最终裁决）。

- 被审对象：`wiki/raw/task_228_design.md`（SA1 design，465 行，round 1）
- 输入产物：`task_228_relevant_decisions.md`（SA8 决议摘录）、`task_228_conflict_report.md`
  （前置门禁 verdict=clear + B1–B3 边界条件）、`task_228_sa6_acceptance_contract.md`
  （AC1 红灯契约 D1–D4 + AC2 覆盖图）、红灯测试
  `apps/yjs-server/test/host-namespace-delete-diagnostic-link-red.test.ts`
- 触发原因：SA1 structured_output 明示 `requiresConflictRecheck=true`——设计扩展公共面
  （persistence/registry/host op）、触及 Registry/Runtime 状态机与持久化删除语义、包含 B2
  同步联动失败语义（设计 §8 自判复审需求，与前置门禁移交条件一致）
- 冲突基准：`docs/adr/` 全 13 文件中被引 6 份的关键条款**本轮回查原文**（ADR-0011 全文；
  ADR-0014-LOG 首切片 amendment 与 Retention/删除节；ADR-0006 含 #64/#79/#133 修订节；
  ADR-0009 含 #131/#134 修订节与 L114 公共面排除条款；ADR-0008 #132 四方法槽修订；ADR-0010
  #172 §2）+ 根 `CONTEXT.md` 诊断日志词条（语义 emission/stream generation）+ `docs/AGENTS.md`
  Authority 节（L5/L10/L13）+ 三层 AGENTS.md（persistence/namespace-registry/yjs-server）
- 独立核验方式：设计引用的**全部**关键代码锚点亲读源码——`packages/namespace-diagnostic-log`
  file.ts:1592 `deleteNamespaceDiagnosticLog`（含 deletion.json marker 门 1438、step 词表
  marker|locator|stream|remove、N1–N5 重入头注）、index.ts 公共导出；`apps/yjs-server/src/app.ts`
  dispatch 闭集 11 op（L488-521，无 delete 类）、bootHub bindings/knownNamespaces（L234-246）、
  authorize（L256-264）、knownOwner 既有用法（L528 等）、opReplaceSchema 角色门（L650-651）、
  停机排空窗（L434-437）；`packages/namespace-registry/src/registry.ts` 公共面（open/create/
  importReplica/resetReplica/getStatus/shutdown，L1970-2043）、runResetSlot ①–⑧ 冻结次序与
  ② capability 前置门（L1669-1712）、forceReleaseOutstandingLeases/cancelIdleArm/entries.delete
  （L1113/1127/572/1792-1798）；`packages/persistence/src/contract.ts` DocPersistence 可选面 +
  ReplicaPersistence 必具面（L75-131）、lifecycle.ts `PersistenceIO.remove`（L69，明言「不触碰
  归档区」）、claim/cell 等待环（L443-461）、settleEntryForArchive（L545，archive 强制即时
  flush）、assertArchiveIo（L566-575）、scheduleFlush debounce/maxDirty（L859-871）、
  assertOwnedHandle（L969/582）；diag-pump.ts 头注「寿命与 shutdown 零耦合：不清泵、不等待」
  （L47）；ws-replication hub-namespace.ts 长寿命 lease 与 'lease released' 错误路径
  （L79/276/298/474）；AC3 矛盾文本三处亲证（CONTEXT.md 语义 emission 词条、README L312
  「绝不阻塞」、包 AGENTS.md L16）；红灯契约**独立重跑**（后台 Job `bash-5`，本 HEAD：
  **1 failed 文件 / 4 failed 用例 / Type Errors 0**，D1–D4 均在首个回执断言红，回执
  `{"ok":false,"code":"unknown-op"}`——与 SA6 档案逐项一致，红灯稳定）
- Issue 评论输入：GitHub Issue #228 评论本轮经 `gh api` 复读 = **0 条**（与派遣简报一致，
  无 Owner 追加要求；无任何评论要求需写入设计约束）
- 裁决人：SA8 Conflict Gatekeeper（设计后复审轮）
- Worktree：`/home/wangjian/nomicore-fix-issue-228`（branch `mabf/issue-228`，HEAD `6467078`）
- 时间：2026-09-07（UTC）

## Verdict

**clear**（`requiresConflictRecheck: false`）

SA1 自报的复审需求（公共面演进 / 状态机 / 持久化删除语义 / B2 失败语义 / AC3 文档面）本轮
逐项独立核验，结论分三层：

1. **ADR 层：0 冲突、0 override、0 未备案演进**。设计的全部公共面扩展（`deleteDoc`/
   `removeKey`/`deleteNamespace`/Host op 11→12）均走**显式 ADR 修订节**通道且修订内容义务已
   进入实施清单（设计 §3.1/3.2/3.4）——正是前置门禁 B1 规定的唯一合法路径（docs/AGENTS.md
   L10「Amend or supersede prior decisions explicitly」；先例 #64/#79/#133 均为随实现落文）。
   B2 复合失败语义（AD-8）与 ADR-0011 隔离条款的边界划分成立（见 §1-4）。
2. **前置边界 B1–B3：全部兑现**（§2 逐条）。B1 演进正式化已落设计义务；B2 同步联动语义已
   显式裁决且调用点纪律合规；B3 对齐方向=向已接受 amendment 收敛、ADR 触碰走显式修订节、
   措辞红线（无 erase/purge/secure、不把 queue/batch 表述为现行特性）已写入设计。
3. **SA6 契约层：零对齐需求**。AD-2「批准 PROPOSAL 原名原形，零修订」——D1–D4 断言、文件名、
   语义红线（ack 同周期、幂等、invalid-op-args、重启不复活）与契约逐字兼容；红灯锚本轮独立
   重跑确认真实（非源码 grep、非假红）。

## 1. 设计决策 × ADR 逐条对照（ADR 层 0 冲突）

| # | 设计决策 | ADR 条款（本轮回查原文） | 裁决 | 依据 |
|---|---|---|---|---|
| 1 | **AD-1/AD-5 Persistence `deleteDoc` + `PersistenceIO.removeKey`**（DocPersistence 可选、ReplicaPersistence 必具；主键+tmp+归档位全清；ENOENT 容忍；active-handle 诚实拒绝） | ADR-0006 接口闭集（无删除 seam）+ #133 `archiveDoc`（归档≠删除：身份前置、写归档快照、移主键）；contract.ts 亲证 optional-on-DocPersistence/required-on-ReplicaPersistence 放置先例（importDoc/archiveDoc/probe 三成员同款，L75-131「13 个既有测试 stub …绿守卫」注记） | **evolution（已正式化备案，非冲突）** | B1 预授权通道：「若设计需新增持久层删除能力属 ADR-0006 演进，须显式修订节」——设计 §3.1 把 0006 修订节（deleteDoc/removeKey 契约、放置、幂等、与 archive 的语义区分、逻辑删除措辞）列入实施清单。不复用既有 `remove` 的论证成立：lifecycle.ts:69 契约注释明言 remove「不触碰归档区」——重载它破坏归档语义，新 `removeKey` 是正确的 seam 切分 |
| 2 | **AD-1/AD-6 Registry `deleteNamespace(owner, namespaceId)`**（acceptance→身份→carrier per-key 串行→owner 核对→capability 前置门→forceRelease+cancelIdleArm+close drain→deleteDoc；减 reset fence） | ADR-0009 L114「v1 不公开 …explicit eviction、按 key close 或公共 events」+ #131/#134 修订节；runResetSlot ①–⑧ 冻结次序亲证（L1669-1712：② capability 门 loud branded fatal 先于一切破坏性动作；⑥ forceRelease+cancelIdleArm+close drain+I2 记账） | **evolution（已正式化备案，非冲突）** | B1 预授权通道同上；设计 §3.2 把 0009 修订节（公共面增量 + 与 eviction/按 key close 的语义区分 + owner 零存在性泄露 + carrier 序列化）列入清单，且修订节要求「逐字区分终态删除 vs 逐出复用」——该区分有实质语义支撑（删除含持久移除+不可复活，非 Runtime 复用面）。编排形态是 resetReplica 先例的同型减法，②门镜像（`typeof persistence.deleteDoc !== 'function'` → loud fatal，与 L1697-1712 同款）；「减 fence」论证（终态=关闭+删除，fence 窗口内新接纳 slot 被 close barrier 排空且 dirty 不 flush）不触碰 ADR-0008 #132 四方法槽纪律（close 走既有 `runtime.close()`，Runtime 公共面零改动） |
| 3 | **AD-2 Host op `delete-namespace`（11→12）**：G1 hub 角色门（peer→unknown-op）/ G2 参数门（invalid-op-args，零 fs）/ G3 known-set+tombstone / G4 单飞 | apps/yjs-server/AGENTS.md（Management verbs 角色门先例；stdin 控制通道「one reply per line；control input 不致崩溃」）；app.ts 亲证 opRead/opReplaceSchema 同款 G1/G2/G3 门禁与 `NAMESPACE_ID_PATTERN` 既有用法；NDJSON 控制通道非 ADR 冻结面（ADR-0010 管复制 wire，不管本地 stdin op 集） | **no-conflict** | op 扩展是 app 私有面 + AGENTS.md 管理动词段同步更新（§3.3 已列）；门禁次序镜像既有 verb，参数门先于一切 IO 满足 D3；`namespace-deleted` 生命周期事件走既有 sink 通道，stdout NDJSON 纪律不变 |
| 4 | **AD-3/AD-8 B2 复合失败语义**：`ok:true` ⟺ 数据+日志均完成逻辑删除；日志删除失败 → `ok:false + log-delete-failed{step,errno}`；重入重试是唯一完成路径 | ADR-0011 §产品契约 L20-24（隔离枚举：emit/排队/持久化/背压/丢弃/关闭失败不得改变**业务操作**返回值；保护对象枚举：createDoc/Yjs transaction/dirty notification/replication ACK）；ADR-0014-LOG §Retention L299「**Host 执行数据删除请求时必须同时调用日志删除能力**」 | **no-conflict（B2 裁决成立）** | 边界划分：隔离条款的失效面枚举不含「删除能力失败」，保护对象枚举不含数据删除工作流——delete-namespace 本身就是 L299 义务的载体，其 ok 谓词携带伴随义务不构成对其它业务操作的隔离破坏；设计明言该条款对 emit/append 面继续全额适用（零改动）。重入唯一完成路径 = #154 先例的 Host 级推广（`deleteNamespaceDiagnosticLog` N1–N5 重入续走，file.ts 头注亲证）。失败码族直接透传包内 failed 形状（step 词表 marker\|locator\|stream\|remove 亲证于 file.ts:1566），不发明第二词表 |
| 5 | **AD-3 调用点纪律**：op 全程在 stdin dispatch macrotask，不持 write slot/carrier 槽；`registry.deleteNamespace` 槽内只含异步 IO+close drain；`deleteNamespaceDiagnosticLog`（同步重 fs）在步骤 5、registry 槽外 | ADR-0014-LOG 首切片 amendment L244-252（「任何将 File adapter 的 emit 接入 namespace 生命周期的调用点，必须位于 write sequencer slot 之外…不得在 slot 内执行同步 File adapter emit」）；ADR-0011 §时序（adapter 慢/失败不得延长 write slot 或阻塞 close/shutdown） | **no-conflict** | 前置 B2 明文要求「deleteNamespaceDiagnosticLog 这类同步重 fs 操作自身的调用点纪律（write sequencer slot 外）须显式裁决」——AD-3 逐字裁决且满足。amendment 条款字面管 `emit`；设计对删除能力做**同类从严**适用（合规方向的类比扩展，非放松）。registry 槽内异步 IO 有 loadDoc 读/archive 写先例（reset ⑦ archive 在 carrier 槽内），非新面 |
| 6 | **AD-4 诊断 manager retirement + drop reason `'namespace-deleted'`** | ADR-0011 隔离条款（丢弃不改业务结果）+「队列溢出可以丢弃记录。实现应尽力上报 dropped count…」；diagnostics.ts:41 亲证 `DiagnosticEmissionDropReason = 'unattributed' \| 'stream-unavailable' \| 'manager-closed'`（app 内部三值，唯一产生方纪律） | **no-conflict（零规范词表演进）** | 该词表是 app 内部类型，**不是** CONTEXT.md「语义 emission」词条的 update-omitted reason 词表（payload-too-large 等）——后者才是「新增 reason 属词表演进，须过设计评审」的约束对象；app 内部追加第四值沿用既有「唯一产生方」纪律（设计明言）。迟到流量丢弃 = best-effort 隔离的正向运用。diag-pump 头注亲证「不清泵、不等待」——retirement 面确为必要封堵（否则迟到 `runtimeEmitterFor` 重建 adapter 对已删目录重新建流，D4 违约） |
| 7 | **AD-7 复制暴露收口（零 ws-replication 改动）**：摘除 bindings/knownNamespaces；已建 channel 走 lease released 错误路径失败收口 | ADR-0010 冻结面（无 per-namespace 拆除 API）；hub-namespace.ts 亲证长寿命 lease（L79）+ `lease.getStatus().runtime === null → 'lease released'`（L298/474）；app.ts authorize 亲证 bindings 缺席 → `{ok:false}`（L256-264） | **no-conflict（设计裁量成立）** | R-2「异步失败通知而非优雅拆除」是既有错误路径的自然行为，不扩 ADR-0010 面（Alt-4 出范围备案合规）；复活向量论证（apply 需活 Runtime、重 open 得 NOT_FOUND）与亲证的 released-lease 路径一致。T-H5 钉死该行为裁决 |
| 8 | **AD-9 零漂移面**（config/schema/投影/wire/Runtime 公共面/Registry 三态/既有 persistence 方法零变化） | ADR-0005（生成物纪律继续成立）；ADR-0008（零触碰）；ADR-0010（零帧变化） | **no-conflict** | 纯不变性声明，与亲证的现状面一致 |
| 9 | **§3.4/AD-4 AC3 文档对齐**（CONTEXT.md 词条、包 README、包 AGENTS、ADR-0011 澄清性修订节；方向=向 ADR-0014-LOG 2026-08-28 amendment 收敛） | ADR-0014-LOG amendment 正文（权威源，本轮逐字复核）；docs/AGENTS.md L13「update every normative document whose stated contract changed」+ L10；矛盾文本三处亲证（CONTEXT.md「emit 同步、不 throw、不阻塞」/ README「绝不阻塞」/ 包 AGENTS 同款且同文件 §Boundaries 已正确——自相矛盾） | **no-conflict（整改型，方向合规）** | 后决优先（amendment 2026-08-28 晚于三处文档的「绝不阻塞」表述）；ADR-0011 触碰走**显式澄清性修订节**且明示「非决策变更」——与 amendment 自身「ADR 0011 emitter seam 不变」声明一致，不静默改写；目标措辞显式把 queue/batch/fsync/fd 标注为「目标演进形态而非现行特性」（B3 红线逐字满足） |
| 10 | **AC5 内容规格（§5）**：REPORT.md/PR #142/issue #141 更新 defer 给 runner；公共行为表述只引权威文档 | ADR-0010 #172 §2「wiki/raw 非规范：公共行为表述必须指向 CONTEXT.md、ADR 或 docs/protocols/」 | **no-conflict（B3 兑现）** | 设计明言 REPORT 是普通 artifact 非机器状态；发布动作归 runner 不属本设计执行面 |

## 2. B1–B3 前置边界兑现核验（本轮复审的硬性mandate）

| 边界 | 前置门禁要求 | 设计兑现点 | 本轮核验 |
|---|---|---|---|
| **B1 公共面演进正式化** | 扩展冻结 v1 接口必须显式 ADR 修订节/新 ADR 备案，不得静默扩面；app 只消费包公共导出 | §3.1 ADR-0006 修订节（deleteDoc/removeKey/幂等/active-handle/archive 区分/措辞）+ §3.2 ADR-0009 修订节（deleteNamespace/eviction 区分/零存在性泄露/carrier 串行）+ §3.4 ADR-0011 澄清节；§0 明示「需设计后 SA8 复审」；AD-9 包边界（只消费 registry+diagnostic-log 公共导出） | ✅ 演进通道已正式化为**交付内义务**（修订节与代码同一变更集落文，#64/#79/#133 先例同款）；Host 零直调数据面（AD-1 依据 (a)/(d)）。**落文核验移交 SA4**：实现变更集必须包含两份 ADR 修订节，缺任一即 B1 违约回退 |
| **B2 同步联动 + 隔离语义** | 失败语义与重入收敛、同步重 fs 调用点纪律须显式裁决并锚定 ADR-0011 隔离条款 | AD-8 六行失败矩阵（F1–F6：落盘状态 × 重试收敛）+ AD-3 调用点纪律 + 「同步窗口」可观察结局定义（ack 同周期、无轮询） | ✅ 见 §1-4/§1-5；单调性论证（部分完成后只前进不回退）与三处幂等源（registry absent→ok / deleteDoc ENOENT 容忍 / 日志 N1–N5 + Host tombstone）自洽 |
| **B3 文档对齐方向与措辞** | 向 amendment 收敛；CONTEXT 走领域术语正道；触 ADR 原文必须显式修订节；不得把 queue/batch/fsync/fd 表述为现行特性 | §3.4 精确编辑清单（五文件逐处目标文本）+ 措辞红线（只说「活跃存储逻辑删除」，禁 erase/purge/secure） | ✅ 见 §1-9；红灯测试与设计中词汇亲证无 erase/purge 面（#154 纪律延续） |

## 3. SA6 契约与 AC 覆盖对齐

- **AC1**：AD-2 语义红线与契约 D1–D4 逐字兼容（ack ok ⟺ 数据快照+`{logRoot}/namespaces/{ns}`
  目录树全 absent；幂等二删；invalid-op-args；重启不复活）。**PROPOSAL 批准零修订**——红灯
  文件保留、断言零改动转绿的路径成立（本轮独立重跑：4 failed 全在首回执断言，前置条件真实
  通过，转绿判据无歧义）。
- **AC2**：SA6 §4 矩阵 8 行均有既有锚；设计补 3 个 host 级缺口（T-H6 restart 正向/T-H7
  retention/T-H8 trusted+diag）+ 删除×复制场景（T-H5）——与本复审无冲突面（验收执行型）。
- **AC3/AC4/AC5**：§1-9/§1-10 + AD-9 零漂移（`generate --check` 应零 diff 通过）。

## 4. 卫生注记（非冲突，登记移交）

- **N1（行号微漂移）**：设计引 `opReplaceSchema L652`——角色门实际在 app.ts L650-651；
  `settleEntryForArchive L544` 实际 ~L545。锚点存在、语义不变；SA3/SA4 注释引用时更正。
- **N2（ReplicaPersistence 必具面的连带）**：`deleteDoc` 进 required 派生接口后，类型契约测试
  `packages/persistence/test/persistence-phase5-archive-surface.test-d.ts`（钉 required 成员集）
  与任何 `ReplicaPersistence` 类型的 fixture 需同变更集更新；DocPersistence 可选建模保住
  contract.ts:75-79 所述 13 个既有 stub 绿守卫——设计放置正确，实施不得倒置。
- **N3（失败码透传命名）**：包内 failed 形状为 `{status:'failed', code, step}`；设计回执字段
  名 `errno` 承载 `code` 值。值域逐字透传即可（「不发明第二词表」），字段名是实现裁量；SA4
  核对值不重映射。
- **N4（删除×停机竞态）**：SIGTERM 落在删除中——registry 段由 carrier tail 覆盖（设计已证）；
  日志段为槽外有界同步协议，理论上存在「回执未发即进程退出」窗口，收敛由 N1–N5 重入保证
  （D2 路径）。建议 T-H 系列或 SA4 评审补一条注记性核验（非阻断）。
- **N5（provision 重建与 G3 优先级）**：provision 重建会重填 knownNamespaces（app.ts:328 亲证）
  ——G3 known-set 优先于 tombstone 的次序保证重建后 owner 取自 live 集；`initStream` un-retire
  （AD-4）与之配套。D4 第二分支语义自洽，无需设计修改。
- **N6（Git 配置残留）**：前置报告备案的 `mabf.branch`/`mabf.base-branch` 残留维持原状——
  属 runner 职责，本复审不改 git 配置（与设计 §5 一致）。
- **N7（AC2 三补足的编排归属）**：T-H6–H8 建议随实现轮后最终验收组合运行（设计 §6.3 与
  SA6 §4 注记一致）；总控编排时纳入，不属本复审面。

## 5. 裁决与移交

1. **Verdict：clear**；`requiresConflictRecheck: false`——SA1 自报的五项复审需求（公共面/
   状态机/持久化/B2/文档面）全部核验通过，无条款违反、无 override、无未备案演进。
2. **路由**：SA2 design review（知悉 N1–N5）→ SA3 实现（变更集必须原子包含：ADR-0006/0009
   修订节 + ADR-0011 澄清节 + §3.4 文档对齐 + 代码/测试）→ SA4 review（重点核 B1 落文、
   N2/N3）→ SA7 验证（D1–D4 转绿零断言改动 + §6.3 全量门）。红灯契约无需 SA6 对齐修订
   （PROPOSAL 被原样批准）。
3. **本轮边界**：零产品代码改动、零测试改动（全部只读）；唯一写入 = 本报告文件；测试运行经
   后台 Job（`bash-5`）；未 commit/push。

Verdict: **clear** — `requiresConflictRecheck: false`

---

# 收尾冲突门禁报告 — Issue #228（iteration 2：D4 追认/勘误 + ActiveHandle 一致性 + T-H5–H8 收尾复审）

- 被审对象：SA1 勘误轮设计（`task_228_design.md` round 2 §10 勘误 E-1/E-2）+ SA6 追认
  （`task_228_sa6_f1_ratification.md` verdict=approve）+ 当前工作树全量 diff（27 M + 13 ??，
  HEAD `6467078`）
- 派发：`sa-4908fb08-1828-4390-8bce-3849cbe51fc6`（mabf-sa8，phase conflict-gate，iteration 2）
- 输入产物（全部亲读）：`task_228_design.md`（553 行，§10 勘误）、`task_228_sa6_f1_ratification.md`、
  `task_228_sa6_acceptance_contract.md`（含 §7 追认节）、`task_228_sa4_review.md`（F-1~F-7）、
  `task_228_sa3_implementation_notes.md`（iteration 2+3）、`task_228_conflict_report.md`（前置
  clear + B1–B3）、本文件 iteration 1（设计后 clear + N1–N7）、`task_228_relevant_decisions.md`
- 冲突基准：`docs/adr/` 全 13 文件**本轮全部重读**（含本轮新落文的 0006 逻辑删除修订节、0009
  issue #228 修订节 §1–§5、0011 澄清性修订节）+ 根 `CONTEXT.md`（含已修订的「语义 emission」
  词条与 `namespaceId` 词条）+ `docs/AGENTS.md` Authority 节。无 superseded ADR。
- Issue 评论输入：派遣简报明示 REST 已读 = `[]`，无 Owner 追加要求（评论 ID/updated_at：无）。
- 独立核验方式：关键代码锚点全部亲读——registry.ts（`NAMESPACE_ID_RANDOM_BYTES=16 // 128-bit
  CSPRNG` L203-204、`generateNamespaceId` L858-892、`runDeleteSlot` ①–⑥ 全体含 ⑤ catch 分支与
  注释）、app.ts（provision() 无条件三键 `registry.create`、`opDeleteNamespace` G1–G4、
  `runDeleteNamespace` ①–⑤ 全序）、红灯契约 D4 断言区（L383-412 仲裁注记 + 断言组）、
  T-H5–H8 四文件全文头注与结构、persistence contract/lifecycle/file/memory/index/testing、
  registry types/errors/observer/index、diagnostics.ts retirement 面、AGENTS/CONTEXT/README/
  hub-peer-deployment 文档 diff、SA7 动态守卫与两个 surface test-d 守卫更新；本轮独立抽测复跑：
  `doc-delete-semantics + doc-delete-storage + registry-delete-orchestration` **24/24 绿、
  Type Errors no errors、exit 0**。
- Worktree：`/home/wangjian/nomicore-fix-issue-228`（branch `mabf/issue-228`，HEAD `6467078`，
  全部改动未提交）；时间：2026-09-07（UTC）。

## Verdict（iteration 2）

**clear**（`requiresConflictRecheck: false`）

三项收尾焦点逐项核验通过，0 冲突点、0 override、0 未备案演进：

1. **E-1/D4 追认未削弱 AC1，且与 ADR/CSPRNG/provision 事实一致**（§C-1）。
2. **ActiveHandle branded-fatal 三方表述一致**（design §10 勘误 = ADR-0009 修订节 §5 = 实现；
   §C-2）。
3. **T-H5–H8 覆盖成立；公共面/状态机/持久化影响全部与已正式化的 ADR 修订节一致**（§C-3）。

## ADR 盘点（收尾轮重读；状态含本变更集新落文的修订节）

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 单一真相源 | accepted（+2026-08-19 修订） | 否 | 零 schema 文本/投影改动（AD-9 维持；diff 无 schema/生成物文件） |
| 0002 | 重写权威出范围 | accepted | 否 | 不适用 |
| 0003 | 求值器与派生 schema | accepted | 否 | 不适用 |
| 0004 | vfsl-protocol 类型投影 | accepted | 否 | 不适用 |
| 0005 | 投影生成管线 | accepted | AC4 | 生成物零漂移纪律维持；`generate --check` 归收尾动态门（见移交） |
| 0006 | Persistence DocPersistence | accepted（+#64/#79/#131/#133/**#228 逻辑删除修订节**） | **AC1** | 修订节已随代码落文；实现逐条吻合（§C-3-持久化） |
| 0007 | 逻辑验证与 Yjs bridge | accepted（Runtime/open/read 由 0008 部分取代） | 否 | 不适用 |
| 0008 | Runtime 读写与单序列器 | accepted（+#93/#132） | AC3 | Runtime 公共面零改动（close 走既有 `runtime.close()`）；write-slot 调用点纪律经 ADR-0011 澄清节援引维持 |
| 0009 | Registry、租约与 Host 生命周期 | accepted（+#131/#134/**#228 终态删除修订节 §1–§5**） | **AC1/AC2** | 修订节已落文；实现逐条吻合（§C-3-Registry）；ActiveHandle 映射以 §5 为准（§C-2） |
| 0010 | Hub/Peer WS 复制 | accepted（+#134/#133R2/#161R2/#172） | AC2/AC5 | **零 ws-replication/wire 改动亲证**（diff 无该包文件）；CSPRNG 身份条款（L28）是 D4 仲裁的基准而非冲突源（§C-1） |
| 0011 | best-effort 诊断变更日志 | accepted（**+#228 澄清性修订节**） | AC1/AC2/AC3 | 澄清节自声明「非决策变更」；复合删除谓词边界划分（§3）与实现一致 |
| 0014-LOG | VFSL 校验 JSONL 日志格式 | accepted（+#152 首切片 amendment） | **AC1/AC2/AC3** | 零改动（设计预期一致）；L299 Host 联动义务经本变更集兑现；amendment 调用点纪律在删除编排中同款从严适用 |
| 0012-ID | 实例身份与 WS plugin 所有权 | accepted | AC2 | 不适用（composition root 停机序无变化） |

## 冲突点（收尾轮逐条对照记录；无 hard-violation / override / evolution 级未备案项）

| # | 严重度 | 基准条款 | 被审对象 | 裁决 | 依据 |
|---|---|---|---|---|---|
| C-1 | 核心追认 | CONTEXT.md `namespaceId` 词条（「普通 create 由受控 128-bit CSPRNG 生成 `ns-`+32 hex」）+ ADR-0010 L28（「由注入的受控 128-bit CSPRNG 生成……不是普通 create」）+ 设计 R-1（已批准：「新 namespace、新流、新身份」） | D4 断言仲裁（原「重启后 `.toBe(已删 id)`」→ R-1 行为约束集）+ design §10 勘误 E-1 | **no-conflict（纠错型追认——消除潜在冲突）** | (a) 亲证 registry.ts L203-204/L858-892（`randomBytes(16)`、无固定 id 机制）+ app.ts provision 无条件三键 create——原断言对该事实**物理不可满足**（2^-128），保留即契约自毁；原断言本身才是与 CONTEXT.md/ADR-0010 的潜在冲突源，仲裁将其消除。(b) **AC1 未削弱**：AC1 权威文本（同步联动 + 全清单逻辑删除 + 不暗示 secure erase）由 D1–D3 钉死且零断言改动；D4 语义红线（重启健康/旧 generation 零复活/无 marker 半态）全保留并新增 `.not.toBe(旧 id)`、新流≠旧流反锚（测试 L383-412 亲证；SA6 追认 §3.2 义务对照表）。(c) 程序合规：SA6 独立追认 approve + 档案 D4 行随批修正；四处披露（测试头注/用例内注记/REPORT/SA3 notes）；#155「裁定不同按设计仲裁修订」通道。(d) 勘误文本与已批准 R-1/AD-4 逐字一致；T-H6 提供互补锚（确定性同 id 恢复仅存于直引无 provision 重启形态）——两场景互斥无矛盾 |
| C-2 | 核心一致性 | ADR-0009 修订节 §5（L165）：「`DocDeleteFatalError` / 其它 throw → branded fatal（committed:false 恒真）」 | design §10 勘误 E-2 / AD-6 步骤 5：「`DocDeleteFatalError` / 其它 throw（含 `DocDeleteActiveHandleError`）→ branded fatal（committed:false）」 | **no-conflict（三方一致达成）** | 亲证 registry.ts `runDeleteSlot` ⑤：仅 `DocDeleteOperationalError`（或 code `DOC_DELETE_OPERATIONAL`）→ `NAMESPACE_DELETE_FAILED`；其余一切 throw（含 ActiveHandle）→ branded `NamespaceRegistryFatalError('delete','lifecycle-slot-internal',false)` + observer `lifecycle-slot-failed`——**设计勘误 = ADR §5 = 实现**三方逐字一致（SA4 F-2 的三方不一致就此闭合）。分层无矛盾：ADR-0006 §3 在 persistence 层把 ActiveHandle 定义为合法 typed 拒绝，ADR-0009 §5 在 registry 编排层把它防御性收敛为 fatal（close barrier 先释放 handle，理论不可达）——两层各司其职。**外部语义零变化**亲证：app.ts `runDeleteNamespace` ③ 对窄 issue `!ok` 与 branded fatal catch 均回 `delete-namespace-failed`（F3/F4 行不动）。registry.ts 注释中「design AD-6 待勘误」标注现由 §10 勘误闭环（该注释指向的分歧已消解，属历史记录） |
| C-3 | 公共面/状态机/持久化收尾 | ADR-0006 逻辑删除修订节；ADR-0009 修订节 §1–§4；ADR-0011 澄清节；ADR-0014-LOG amendment/L299；ADR-0010 冻结面 | 当前 diff 全量（含 T-H5–H8 四新文件、SA7 动态守卫、surface test-d、AGENTS/CONTEXT/README/hub-peer-deployment 文档面） | **no-conflict（演进已正式化 + 验收执行型）** | 逐面亲证见下「§C-3 分面核验」；T-H5–H8 为黑盒 E2E 验收锚（零新公共面、零决策变更），落入 root `pnpm test` CI include 面（`apps/*/test/**/*.test.ts`），SA3/SA4 实测 1/1 绿×4 |

### §C-3 分面核验

- **持久化（ADR-0006 修订节逐条）**：`DocPersistence.deleteDoc?` 可选 / `ReplicaPersistence.deleteDoc`
  必具（N2 放置未倒置亲证）；`removeKey` IO seam 独立于 `remove`（归档区语义保持）；`'deleting'`
  cell + 全部消费方（exclusiveCreate/loadSlowPath/runArchiveDoc/seedForTest/runDeleteDoc 五处亲证）；
  错误族三 phase 词表逐字；File 主键先（提交点）→ 归档位后、逐处 `fsp.rm force:true` ENOENT 容忍；
  Memory loud 配置门（readSnapshot 无 deleteSnapshot → 拒绝）；`assertDeleteIo` 镜像先例。
- **Registry（ADR-0009 修订节逐条）**：`deleteNamespace` + `DeleteNamespaceIssue/Result` +
  `NAMESPACE_DELETE_FAILED_MESSAGE`（零插值零回显）；编排 ①–⑥ 与修订节 §3 次序逐字吻合
  （acceptance → 身份 → carrier FIFO → owner 核对 → capability 前置门 → closing 等待 →
  forceRelease/cancelIdleArm/close admission → deleteDoc → 幂等 ok）；fatal operation `'delete'`
  与 observer operation 联合为 **append-only 加宽**（既有事件类型的 operation 联合，非新公共事件
  ——「v1 不提供公共事件订阅」维持）；`getStatus` 三态零变化。
- **Host（app AGENTS + docs/AGENTS.md L13 法定义务）**：op 闭集 11→12，G1–G4 与 AD-3 全序
  ①retire→②摘除+tombstone→③registry→④槽外同步日志删除→⑤事件+回执 亲证；M3 全链 try/catch；
  `apps/yjs-server/AGENTS.md` 管理动词段 + `docs/integration/hub-peer-deployment.md` 稳定码注册表
  （append-only：`delete-namespace-failed | log-delete-failed`）同变更集更新。
- **诊断面（ADR-0011 隔离）**：`retireNamespace` + drop reason `'namespace-deleted'`（app 内部
  词表第四值，唯一产生方纪律注释在场；CONTEXT.md update-omitted reason 词表**未被触碰**——iteration 1
  裁定 #6 维持）；`initStream` 先 un-retire（与 R-1/D4 第二分支自洽）；丢弃走计数事件不改业务结果。
- **AC3 文档对齐**：CONTEXT.md「语义 emission」词条、包 README「绝不阻塞」、包 AGENTS 措辞均向
  ADR-0014-LOG amendment 收敛（「不返回 durability promise」「可被文件系统延迟阻塞」「queue/batch/
  fsync/fd 为目标演进形态」逐字在场）；ADR-0011 走显式澄清性修订节且自声明非决策变更。
- **零漂移面（AD-9）**：ws-replication 包、`docs/protocols/`、config.ts/main.ts、schema/生成物
  均 0 行 diff 亲证。
- **措辞红线（B3）**：diff 中 erase/purge/secure 命中仅为禁词表守卫（SA7 动态守卫 forbidden 列表）
  与「不承诺 secure erase」类否定表述——无违规面。
- **冻结面守卫同变更集更新**：registry surface test-d 把 `deleteNamespace` 移出禁词表并加正向
  required 锚（注明 ADR-0009 修订节语义区分）；SA7 动态守卫改「恰七面」；persistence surface
  test-d 的 deleteDoc required 锚；import-red 保持性守卫断言翻转并注明理由——B1「不得静默扩面」
  的守卫面闭环。
- **本轮独立抽测**：3 个删除单元套件 24/24 绿（Type Errors no errors，5.0s）。

## 收尾移交（登记不阻塞；均无 ADR 冲突面）

1. **AC2/AC4 最终组合门**：全量 root `pnpm test`（含 T-H5–H8 与既有锚）+ `generate --check`
   归总控动态验证轮编排（design §6.3、SA2 O5、SA4 F-5 处置、SA3 notes §4 一致）。
2. **SA4 F-3（REPORT M4 备案失准）**：REPORT.md 残余风险节「provision 按配置重建**同
   namespaceId**」场景在 CSPRNG 下物理不可达（marker 门现实路径 = importReplica 显式同 id）——
   REPORT 自身「未决移交」已列；REPORT 非规范（ADR-0010 #172 §2），行为面（marker 门对同 id
   重建防御）正确保留，待收尾改述。
3. **SA4 F-4（design §3 ALLOW LIST 补录 4 文件）**：errors.ts/observer.ts/testing.ts/
   hub-peer-deployment.md 四个清单外落点均为设计行为必要落点或 docs/AGENTS.md L13 法定义务
   （SA4 §2.1 逐文件裁定），design §10.5 已备案移交总控——wiki/raw 非规范，不影响冲突裁决。
4. **SA2 review §5.2 D4 行**（「重建同 namespaceId（确定性派生）」同源错误）：他 SA 产物，
   design §10.5 备案处置归总控。
5. **表述性微瑕（本轮新登记，零语义影响）**：design AD-8 F2 行注记「（配置是权威，见 R-3）」
   交叉引用滑误（语义指向 R-1；§10.5 已备案）；T-H5 头注「AD-3 步骤 ②」用的是实现侧
   `runDeleteNamespace` ② 编号（design AD-3 六步编号下为步骤 3）——对象同一、编号体系不同。
6. **F-6（runDeleteDoc break fall-through 并发观察项）→ SA7 动态抽查；F-7（registry 既有 5s
   预算边际用例，基线 A/B 已证非本 diff 回归）→ 收尾轮显式 timeout/拆分**。
7. **Git 配置残留**（`mabf.branch`/`mabf.base-branch` 与本票不符）：维持前置/设计后两轮备案，
   归 runner（本门禁零 git 操作、未 commit/push）。

## 结论（iteration 2）

**Verdict: clear — `requiresConflictRecheck: false`。**

- D4 断言仲裁 + SA1 勘误 E-1：与 ADR/CONTEXT.md/代码事实一致，AC1 主体义务（D1–D3）零触碰、
  D4 语义红线保留且断言强度净增——**无削弱**。
- ActiveHandle branded-fatal（E-2）：设计勘误、ADR-0009 修订节 §5、实现三方一致，外部可观察
  语义零变化。
- T-H5–H8 落地与全变更集公共面/状态机/持久化影响：全部落在已正式化的 ADR 修订节（0006/0009/0011）
  与既有纪律内，无静默扩面、无 wire/协议/配置/schema 漂移。
- 收尾链剩余事项均为已登记的验证编排与文档卫生项（上列移交 1–7），不构成冲突。
- 本轮边界：零业务代码/测试改动、零 commit/push；唯一写入 = 本报告 + `task_228_relevant_decisions.md`
  追加节（SA8 技能规定的设计后复审双产出）。
