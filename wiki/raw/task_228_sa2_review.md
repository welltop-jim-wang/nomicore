# SA2 独立攻击评审 — Issue #228 SA1 设计（design-review，round 1）

> 评审人：SA2（独立攻击评审，dispatch 见 `task_228_dispatch.md`）。
> 被审对象：`wiki/raw/task_228_design.md`（465 行）。
> 输入产物（全部亲读）：`task_228_design.md`、`task_228_design_conflict_report.md`
> （设计后 SA8 复审 verdict=clear）、`task_228_relevant_decisions.md`、
> `task_228_conflict_report.md`（前置门禁 clear + B1–B3）、
> `task_228_sa6_acceptance_contract.md`（AC1 红灯契约 D1–D4 + AC2 覆盖图）、红灯测试
> `apps/yjs-server/test/host-namespace-delete-diagnostic-link-red.test.ts`（389 行全读）。
> Issue 评论输入：本轮经 `gh api` / `gh issue view` 独立复读 = **0 条评论**（OPEN，
> title「完成诊断日志删除联动与 PR #142 阶段验收」）——与派遣简报一致，**无 Owner
> 追加要求**需写入评审约束。
> 评审方式：不采信 SA8 复审与 SA1 设计的任何代码断言，**全部关键锚点源码亲读复核**
>（亲证清单见 §1）；随后按六个攻击面独立攻击（AC 覆盖 / 删除联动的原子·失败·幂等 /
> 状态机·持久化·协议边界 / 测试触发性 / 文档元数据收口 / 复活向量穷举）。
> 本评审零业务代码改动、零 commit/push；唯一写入 = 本文件。

---

## Verdict

**approve**（`requiresConflictRecheck: false`）

设计在架构层无缺陷：落点选择（AD-1 三段式）、同步窗口语义（AD-3 全序）、失败/幂等
矩阵（AD-8）、三个复活向量的封堵（AD-4/AD-5/AD-7）、B1 公共面演进的修订节义务
（§3.1/3.2/3.4）、B2 复合谓词裁决、B3 文档对齐方向均经独立攻击后成立。红灯契约
D1–D4 的转绿路径逐用例推演可行（§5）。发现 **0 BLOCKER / 0 MAJOR**；4 项 MINOR
（M1–M4，均为实施精度与备案完备性要求，不改架构裁决）与 5 项观察（O1–O5），全部
作为 SA3 实施条件与 SA4/SA7 核对面移交（§6）。

---

## 0. 结论速览

| 攻击面 | 结论 |
|---|---|
| AC1–AC5 覆盖 | 成立（§2）；AC1 的「同步窗口」由 `deleteNamespaceDiagnosticLog` 全同步 fs + 单 async 串行全序支撑，亲证 |
| 删除联动原子/失败/幂等 | 成立（§3）；F1–F6 矩阵自洽、单调性成立、四幂等源真实存在 |
| 状态机/持久化/协议边界 | 成立（§4）；carrier per-key 序列化、cell 状态机扩展、零 wire 改动均与源码先例对齐；M1/M2 为 cell 新态消费完备性实施条件 |
| 测试触发性（红灯真实 + 转绿可行） | 成立（§5）；D1–D4 逐用例推演零断言改动可转绿 |
| 文档元数据收口 | 成立（§5.4/§7）；三处矛盾文本亲证仍在，编辑清单锚点精确 |
| 复活向量穷举 | 设计自报三向量全部封堵；本轮额外攻击 6 个衍生向量（含 diag-pump 中途让渡、close-drain 边界写、F5×重启×provision 交叉），结论见 §3.3/§6-M4 |

---

## 1. 亲证锚点复核（不采信设计断言，逐项源码验证）

以下锚点全部由本轮直接读取源码验证，与设计 §1/§3 的引用一致：

| 设计断言 | 亲证结果 |
|---|---|
| Host op 闭集 11 个、无 delete 类 | ✅ `app.ts` dispatch switch（status/shutdown/read/verify-write/add-target/remove-target/notify-auth-changed/request-reauth/replace-schema/bump-epoch/reset-replica → default `unknown-op`） |
| G1/G2/G3 门禁先例 | ✅ `opReplaceSchema`（`role !== 'hub' \|\| registry === undefined` → unknown-op；`NAMESPACE_ID_PATTERN` → invalid-op-args；`knownOwner` → namespace-unknown）与 `opRead` 同款；`opResetReplica` 另证 **branded fatal 的 try/catch 收编先例**（`catch → reset-replica-failed`） |
| `NAMESPACE_ID_PATTERN` | ✅ `config.ts:25` `/^ns-[0-9a-f]{32}$/`——D3 的 `'not-a-namespace-id'` 必然落参数门 |
| `knownOwner` | ✅ `app.ts:800`（hub → `knownNamespaces`，peer → `peerOwners`） |
| bindings/knownNamespaces 键形与 authorize | ✅ 键 `${peerInstanceId}\u0000${namespaceId}`；authorize 查 bindings 缺席 → `{ok:false}`——AD-3 步骤 3 的「以 `\0+ns` 结尾全删」与键形吻合 |
| 停机排空窗 | ✅ `runShutdown`：registry shutdown → `diagnostics.close()`（O(1)）→ file 排空窗 sleep(maxDirtyMs+margin) → persistence dispose——AD-8 停机有界性论证与实际链条一致 |
| `deleteNamespaceDiagnosticLog` | ✅ `file.ts:1592`，**对象参数** `NamespaceLogDeletionRequest`（设计 AD-3 步骤 5 的调用形状正确；注意前置门禁报告 §1 写的 `(rootDir, namespaceId)` 双参是笔误，设计本身无误）；结果三值 `deleted{streamsRemoved}/absent/failed{code,step}`；step 词表 `marker\|locator\|stream\|remove`；全程同步 fs；N1–N5 重入续走与 INV-12 租约分区释放在函数尾部亲证 |
| 构造期 deletion.json marker 门 | ✅ `file.ts:1438` 附近：`isNamespaceDeletionMarked` → `mode='disabled'` + `stream-init-failed{reason:'namespace-log-deleted'}`——AD-3「marker 是第二道防线」与 M4 场景推演的事实基础 |
| Host 诊断管理器 | ✅ `diagnostics.ts`：`adapters` Map 懒构造、`DiagnosticEmissionDropReason` 现三值（`unattributed/stream-unavailable/manager-closed`，注释明言「三值各有唯一产生方」）、`runtimeEmitterFor` 每次查 Map、`close()` O(1) 幂等——AD-4 的第四值演进面与「唯一产生方」纪律扩展吻合 |
| diag-pump 头注 | ✅ 「寿命与 shutdown 零耦合：不清泵、不等待」逐字在；drain 在 macrotask（setImmediate）——AD-4 retirement 面的必要性成立：close barrier 排空 slot ≠ 排空泵 |
| Registry 公共面 | ✅ `registry.ts` registry 对象：open/create/importReplica/resetReplica/getStatus/shutdown，无按 key 删除；`runResetSlot` ①–⑧ 冻结次序、② capability 前置门（typeof 窄化 + loud branded `NamespaceRegistryFatalError` + observer `lifecycle-slot-failed`）、⑥ `cancelIdleArm → startCloseAfterFence → forceReleaseOutstandingLeases → closePromise 记账（I2）→ await close → ⑦ archive` 全部亲证——AD-6「同型减法」的每个构件真实存在 |
| Persistence 契约放置 | ✅ `contract.ts`：`importDoc/archiveDoc/readPersistedReplicationIdentity` 在 `DocPersistence` 可选、`ReplicaPersistence` 必具，注释明言「13 个既有测试 stub 绿守卫」——`deleteDoc` 同款放置先例成立（SA8 N2 连带更新要求据此） |
| lifecycle 关键机制 | ✅ `PersistenceIO.remove` 契约注释明言「不触碰归档区」（`removeKey` 新 seam 切分论证的事实基础）；`settleEntryForArchive`（零-handle dirty 强制即时 flush / handles>0 抛 ActiveHandle / archiveWaiters 等待面）；`runArchiveDoc` 的 claim/identity-守卫清理范型；`assertArchiveIo` bare loud Error；`saveDoc` 的 `assertOwnedHandle` + `foreign or released DocHandle` 拒绝——AD-5 复活封堵证明的三个支点全部与源码吻合 |
| hub-namespace lease 路径 | ✅ `lease.getStatus().runtime === null → 'lease released'` 错误路径（open 后双读、encodeDiff 前重读）——AD-7「已建 channel 异步失败收口」成立 |
| AC3 矛盾文本三处 | ✅ `CONTEXT.md` 语义 emission 词条「emit 同步、不 throw、不阻塞」；`packages/namespace-diagnostic-log/README.md`「**绝不阻塞**」；同包 `AGENTS.md`「不阻塞、所有权移交」——§3.4 编辑清单的五文件锚点与目标措辞方向（后决优先）核实 |

锚点复核结论：设计的事实底座**零失实**（SA8 N1 备案的两处行号微漂移不在此列，语义不变）。

---

## 2. 攻击面一：AC1–AC5 覆盖（Issue #228 交付 ①–⑤）

- **AC1（同步联动 + 逻辑删除全清单）**：攻击点 = 「同步触发」是否可兑现、清单是否全。
  `deleteNamespaceDiagnosticLog` 是**纯同步 fs 函数**（无 await 点），AD-3 把它放在唯一
  async 编排函数的最后一个 fs 段、回执发射之前——「ack ⟺ 同一周期完成」在 Node
  单线程 run-to-completion 下是严格真值，D1 的无 poll 断言有语义支撑（不是靠运气
  的时间窗）。清单侧：locator（current.json + tmp）、manifests/JSONL/BIN（streams/
  子树 rename→rm）、deletion marker（deletion.json 在成功路径随 namespaceDir 整树
  消失）、adapter indexes（INV-12 租约分区释放亲证在函数尾部）——与 AC1 列表逐项
  对上。「逻辑删除/不暗示 secure erase」措辞红线贯穿 AD-5 契约注释与 §3.4。**过**。
- **AC2（阶段验收组合）**：SA6 §4 矩阵 8 行均有既有锚（本轮抽查套件名与目录吻合）；
  设计补 T-H5（删除×复制）+ T-H6/H7/H8（restart 正向/retention/trusted+diag）三个
  host 级缺口——攻击点「补足项是否被设计悄悄甩出交付」不成立：§6.3 明确纳入最终
  门组合、§4 AC2 行落点清晰。**过**（编排归属见 O5）。
- **AC3（文档一致性）**：见 §5.4。**过**。
- **AC4（工程门）**：AD-9 零 schema/config/生成物漂移 + §6.3 G 门（typecheck/test/
  generate --check/git diff --check + 尾随空格）。`generate --check` 零漂移应过（无
  schema 文本改动）。**过**。
- **AC5（REPORT/PR #142/issue #141 元数据）**：§5 只定内容规格、发布动作归 runner
  ——与 MABF 职责边界和 ADR-0010 #172「wiki/raw 非规范」一致；Git 配置残留（mabf.
  branch/base-branch 与本票不符）维持「总控向 runner 核对」的备案，不属设计缺陷。
  **过**。

**AC 覆盖攻击结论：5/5 成立，无偷换、无范围漂移。**

---

## 3. 攻击面二：删除联动的原子 / 失败 / 幂等语义（B2 核心）

### 3.1 原子性（对外可观察结局）

「数据 + 日志均完成才 ok:true」的复合谓词由全序保证：G 门（零 fs）→ retire（内存
同步）→ 摘除复制暴露（内存同步）→ `registry.deleteNamespace`（carrier per-key 串行
域内：close drain → deleteDoc）→ 同步日志删除 → 回执。攻击尝试与结果：

1. **「回执后仍有 fs 在途」**——不成立：日志段同步；deleteDoc 在回执前 resolve；
   removeKey resolve ⟺ 两处缺席（File 顺序主键先 = 提交点）。回执经 stdout 异步写
   出，但测试以收到回执为观察点，fs 事实先于回执成立。
2. **「并发 delete / delete×open 交错打破原子」**——不成立：G4 单飞 + carrier per-key
   序列化（reset 先例同款串行域亲证）；删除槽结算后迟来 open 得 NOT_FOUND。
3. **「窗口内新写插入」**——不成立：摘除暴露先于 registry 调用（新 authorize 拒绝、
   host op 走 known-set 门 → namespace-unknown）；已建 channel 的在途 apply 被 close
   barrier 排空且其 dirty 由 settle-for-delete 取消（见 3.3-(b)）。

### 3.2 失败语义（F1–F6 矩阵攻击）

- F5「数据已删、日志半态」的诚实失败 + `log-delete-failed{step,errno}` 直接透传包内
  failed 形状（值域透传、字段名 `errno` 承载 code——SA8 N3 已备案，无第二词表）。
- F3 重试收敛链逐环验证：tombstone 已置 → 二删过 G3 → registry（entry 缺席/数据
  缺席 → ok）→ deleteDoc ENOENT 容忍重试 → 日志 N1–N5 续走。**单调性**（只前进不
  回退）在全部六行成立：没有任何路径把「已删」翻回「存在」——provision 重启重建
  是**配置权威**行为（R-1 明示为新 namespace 语义），不是回退。
- **B2 隔离边界攻击**：ADR-0011 产品契约的失效面枚举（emit/排队/持久化/背压/丢弃/
  关闭）与保护对象枚举（createDoc/Yjs transaction/dirty notification/replication
  ACK）均不含「删除能力失败」与「数据删除工作流」——AD-8 的边界划分（delete 自身
  是 ADR-0012-LOG L299 义务载体，复合谓词不构成对**其它**业务操作的隔离破坏）经
  条文比对成立，且明示该条款对 emit/append 面继续全额适用。**过**。
- **调用点纪律**：op 全程 stdin macrotask、不持 write slot/carrier 槽；`registry
  .deleteNamespace` 槽内只含异步 IO + close drain（archive 写/reset ⑦ 槽内先例）；
  同步重 fs（日志删除）在槽外——对 amendment「slot 内不得同步 emit」做同类从严类比
  适用，方向合规。**过**。

### 3.3 幂等与复活向量穷举（本轮超出设计自报三向量的补充攻击）

设计自报三向量（debounce 迟到 flush / diag-pump 迟到重建 / 复制 channel 再引导）
的封堵机制均与源码吻合。本轮追加攻击：

- **(a) diag-pump 中途让渡**：delete op 在 await registry.deleteNamespace 处让出事件
  循环，已排定的 pump drain macrotask 可在此间隙执行——但 retireNamespace（步骤 2）
  先于该 await，drain 内 `runtimeEmitterFor(ns)` 命中 retired → dropStub，不重建
  adapter。单线程下「已解析 emitter 的同步 append」与删除段的同步 fs 不可能交错。
  **封死**。
- **(b) close-drain 边界的最后写**：sequencer slot 内 `await notifyDirty()`（saveDoc
  只标 dirty + 排定时器，fs 写在槽外 debounce）——close barrier 排空 slot ≠ 排空
  flush；这正是 settle-for-delete「取消定时器（未点火）/ 等待在途 flush（已点火）后
  removeKey」要吃的窗口，与 archive 的 settle 先例同构且更保守（删除不需要 flush）。
  **封死，但见 M2 的实施次序条件**。
- **(c) 删除后新 saveDoc**：cell 已驱逐 + `assertOwnedHandle` → `foreign or released
  DocHandle`（源码亲证）。**封死**。
- **(d) 删除后新 loadDoc/createDoc**：key 缺席 → loadDoc null；createDoc = 新建
  namespace 合法重建（D4 语义）。**按语义收口**。
- **(e) 已建 channel 的 apply/encodeDiff**：lease released 错误路径（亲证）→
  closeSessionAndRelease；peer 重连 authorize 拒绝。**封死（R-2 异步通知语义如实
  备案，T-H5 钉死）**。
- **(f) F5 半态 × 重启 × provision 重建交叉**：见 M4——不是复活向量（marker 门使
  构造一律 disabled，绝不 resume/新建 generation 于半态之上），但交叉语义需备案。

**攻击结论：原子/失败/幂等三性质成立；无 BLOCKER。**

---

## 4. 攻击面三：状态机 / 持久化 / 协议边界

- **Registry 状态机**：`deleteNamespace` 复用 carrier per-key 接纳 + reset ⑥ 破坏性段
  （forceRelease/cancelIdleArm/closePromise 记账/entries 删除）。「减 reset fence」
  论证成立：fence 防的是「破坏性转变后把旧 Runtime 当 live 证据/继续接纳写」，delete
  终态 = 关闭 + 删除，窗口内新接纳 slot 被 barrier 排空且 dirty 不 flush——无证据复用
  点。`getStatus` 三态不动、observer 零新增（Host 发 `namespace-deleted` 走 app stdout
  通道，非 registry 公共 events——与 ADR-0009「不公开公共 events」无冲突）。**过**。
- **Persistence cell 状态机**：新 `'deleting'` claim 态镜像 `'archiving'`（ABA 守卫、
  成败双路 identity 守卫清理）。**发现 M1**：§3.1 只写「cell 状态联合 + 'deleting'」，
  未枚举**既有每个 cell 消费方**（loadDoc/createDoc 等待环、`seedForTest` 的
  reading/creating/archiving 拒绝清单、runArchiveDoc 等待环、importDoc 路径）都必须
  同变更集消费新态——漏一处即 busy-loop 或错误分类。属实施完备性条件（架构不变），
  移交 SA3 必做 + T-P 补并发用例。
- **settle-for-delete 的取消/等待次序**：**发现 M2**——等待在途 flush 经
  archiveWaiters 苏醒后必须**重读状态、先取消全部定时器（含 flush 失败路径新武装的
  retryTimer）、再驱逐 cell**（cancel-then-evict）；驱逐应镜像 settleEntryForArchive
  的 `entry.doc.destroy()`（设计未写，内存卫生）。次序倒置 = 定时器在已驱逐 entry 上
  点火写回 = 复活。环结构（wait → re-enter → re-read）本身是安全的，但该次序必须成
  为 SA4 的显式核对面（T-P2 第二子句是绿锚）。
- **协议边界**：wire 零帧变化（AD-7 全走既有错误路径）；stdin op 闭集 11→12 是 app
  私有面（非 ADR-0010 复制 wire），AGENTS.md 管理动词段同步更新已列 §3.3。**过**。
- **capability 门**：`typeof persistence.deleteDoc !== 'function'` → loud branded
  fatal（镜像 reset ②，先于一切破坏性动作）——放置正确。**过**。
- **op 级 throw 收编**：**发现 M3**——`registry.deleteNamespace` 的 branded fatal 是
  **throw**（镜像 reset 先例），`opDeleteNamespace` 必须 try/catch 映射
  `delete-namespace-failed`（先例 `opResetReplica` 亲证）；设计的 F4 码族隐含此意但
  未写明「进程绝不因控制输入退出」的收编义务。实施精度条件，非架构缺陷。
- **放置面（N2 连带）**：`deleteDoc` 进 `ReplicaPersistence` 必具面后，
  `persistence-phase5-archive-surface.test-d.ts`（钉 required 成员集）与所有
  `ReplicaPersistence` fixture 须同变更集更新；DocPersistence 可选建模保住 13 个
  既有 stub 绿守卫——设计放置正确，SA8 N2 已备案，SA4 必核「不得倒置」。

---

## 5. 攻击面四：测试触发性（红灯真实 + 转绿可行）与文档收口

### 5.1 红灯真实性

红灯文件零新增静态 import（亲证 import 块仅 node/vitest），红灯只能来自运行时缺失
面；SA6 与设计后 SA8 两次独立运行均 4 failed 落在首回执断言（`unknown-op`）——
非假红、非编译红。本轮未重跑（前两轮证据一致且红灯机理已由 dispatch 闭集亲证：
无 `delete-namespace` case → default 分支），不构成评审缺口。

### 5.2 转绿路径逐用例推演

| 用例 | 推演 | 结论 |
|---|---|---|
| D1 | 回执 ok:true ⟹ 日志段同步完成（dir 树 absent 立即可判）+ 快照已被 removeKey 移除（resolve ⟺ 缺席）；SIGTERM 后停机链含 file 排空窗但 exit 0 不受删除影响 | 可零断言转绿 |
| D2 | 二删：G3 tombstone 命中 → registry absent → ok；日志 absent → ok | 可转绿 |
| D3 | `'not-a-namespace-id'` 不匹配 `/^ns-[0-9a-f]{32}$/`（亲证）→ G2 `invalid-op-args`；G2 先于一切 fs（D3 零文件触达由门禁次序保证）；进程存活由 M3 的收编纪律保证 | 可转绿（**依赖 M3 落实**） |
| D4 | 成功删除后 dir 整树消失（含 deletion.json）；重启 provision 重建同 namespaceId（确定性派生）→ marker 门不触发（marker 已随树消失）→ 新 stream ≠ 旧 stream、无 marker 残留 | 可转绿 |

### 5.3 新增测试面充分性

T-P1–P4（幂等/双 adapter/复活向量 (i)(ii)/存储清理/disposed/capability）与
T-R1–R4（编排/零泄露/并发序列化/失败映射）覆盖设计的全部语义承诺；T-H5 把 R-2
行为裁决钉死。**建议（非阻断）**：T-P 系列补一条「delete 与 loadDoc/archiveDoc/
seedForTest 在同 key 交错」（M1 的绿锚）；T-R3 已含 open×delete 并发，够用。

### 5.4 文档元数据收口（AC3/AC5）

- 三处矛盾文本亲证仍在（CONTEXT.md 语义 emission 词条 / README「绝不阻塞」/ 包
  AGENTS「不阻塞」同款且与同文件 §Boundaries 自相矛盾）；§3.4 目标措辞与 ADR-0012-LOG
  2026-08-28 amendment 逐字对齐（BIN-first、单 record/单 frame、queue/batch/fsync/fd
  标注为目标演进形态而非现行特性——B3 红线逐字满足）；ADR-0011 走澄清性修订节且
  明示非决策变更（与 amendment 自身「ADR 0011 emitter seam 不变」声明一致）。**过**。
- AC5：REPORT.md 定位为普通 artifact（非机器状态）、公共行为表述只引权威文档、发布
  动作归 runner——与 B3/#172 和 MABF 边界一致。**过**。

---

## 6. 发现清单（移交 SA3 必做 / SA4·SA7 核对面）

### MINOR（实施条件——不满足则实现轮退回，不构成本轮 reject 理由）

- **M1 `'deleting' cell 的全消费方枚举**：§3.1 须补——loadDoc/createDoc 等待环、
  `seedForTest` 拒绝清单、`runArchiveDoc` 等待环、importDoc 路径全部消费新态；
  T-P 补「delete × load/archive/seed 同 key 交错」用例。（SA3 实施 + SA4 核对）
- **M2 settle-for-delete 次序**：苏醒后重读状态 → 取消全部定时器（含失败 flush 新
  武装的 retryTimer）→ 驱逐 cell（cancel-then-evict）；驱逐时 `entry.doc.destroy()`
  镜像 settle 先例。T-P2 第二子句为绿锚。（SA3 实施 + SA4 显式核对）
- **M3 op 级 throw 收编**：`opDeleteNamespace` 对 registry branded fatal（及任何意外
  throw）try/catch → `delete-namespace-failed`；「进程绝不因控制输入退出」（app
  AGENTS）是 D3「进程存活」断言的隐含前提。（SA3 实施 + SA4 核对）
- **M4 F5×重启×provision 交叉备案**：日志删除失败（marker 落盘）后若**重启**而非
  同进程重试：provision 按配置重建同 namespaceId，adapter 构造命中 marker 门 →
  disabled（`stream-init-failed{reason:'namespace-log-deleted'}`，亲证）——重建
  namespace 无诊断流，直至运维再发 delete（此时删的是**重建后**的 namespace，语义
  正确但与同进程「只补日志清理」不同）。该交叉未入 §7 残余风险清单；应在 REPORT.md
  残余风险节备案，SA7 验收知悉（D4 仅覆盖成功路径，不受影响）。（文档完备性；
  建议随 §3.4 变更集或 REPORT 内容规格补一句）

### OBSERVATIONS（备案，无需动作或实施时顺手）

- **O1** tombstone `deletedNamespaces` 进程内无界增长：hub 单进程生命周期内量级无害；
  重启清零。v1 可接受。
- **O2** `initStream` un-retire 在 v1 host 唯一可达路径是重启 provision（无进程内
  create op）；un-retire 次序（先删 retired 再 ensureAdapter）与重建语义自洽。
- **O3** `deleteInFlight` 需 finally 清理；并发第二请求在首请求（含失败）结算后重走
  全路径（含 G 门）——幂等性由两段删除保证，设计已述，实施勿缓存旧结果。
- **O4** 回执字段名 `errno` 承载包内 `code` 值（SA8 N3）：值域逐字透传、不重映射，
  SA4 核对值即可。
- **O5** AC2 三补足（T-H6–H8）与 T-H5 的执行归属 = 实现轮后最终验收组合（设计 §6.3
  与 SA6 §4 注记一致）——总控编排时纳入,勿在 SA3 单轮埋没。

---

## 7. 与既有评审链的一致性

- 前置门禁 B1–B3：全部兑现（B1 修订节义务入实施清单；B2 AD-8 显式裁决 + 调用点
  纪律；B3 对齐方向与措辞红线）——本轮独立复核与设计后 SA8 结论一致。
- 设计后 SA8（clear）：其 N1–N7 卫生注记本轮逐条知悉并吸收（N2→§4 放置面、
  N3→O4、N4→停机竞态已入 AD-8/N4、N5→G3 优先次序亲证、N7→O5）；M1–M4 为本轮
  **新增**发现（SA8 未覆盖的实施完备性面），无重叠冲突。
- SA6 契约：AD-2「批准 PROPOSAL 原名原形零修订」——红灯文件保留、断言零改动转绿
  的路径经 §5.2 逐用例推演成立。

## 8. 交付物

- 本文件：`wiki/raw/task_228_sa2_review.md`（独立攻击评审；verdict=approve；
  M1–M4 实施条件 + O1–O5 备案）。
- 结构化结果：`verdict = approve`，`requiresConflictRecheck = false`，
  `artifactPaths = [wiki/raw/task_228_sa2_review.md]`。
