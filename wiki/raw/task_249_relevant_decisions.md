# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文行号，需要时按编号回查 ADR 全文。

## 任务标识

- 任务：Issue #249 — 修复 diagnostic pump 单飞竞态并补齐 duplicate 诊断（Bug 修复）
- 简报：Issue #249 正文（`gh issue view 249`）与 `wiki/raw/task_diagnostic-pump-singleflight-duplicate.md`（同源摘要，AC1–AC8 一致）
- Worktree：`/home/wangjian/nomicore-fix-issue-249`（branch `mabf/issue-249`，HEAD `ac91a6b`）
- 冲突基准：`docs/adr/` 全集 **13 个文件（0001–0012；注意 0012 有两份不同主题文档，见下）逐个全读，无抽样** + 根目录 `CONTEXT.md` 全读
- 前置任务链（同一诊断能力谱系，供 SA1 回查先例）：
  PR #142（ADR-0011/0012 文档落地）→ #148（`@nomicore/namespace-diagnostic-log` 冻结词表与 record schema）→ #149/#150/#155（Runtime/Registry 诊断接线）→ #152（File adapter 首切片 + ADR-0012 amendment）→ #226 / PR #248（create 诊断覆盖 + `diag-pump.ts` —— 本票修复对象）

## 相关 ADR

### ADR-0011 Best-effort namespace 诊断变更日志（accepted）

`docs/adr/0011-best-effort-namespace-diagnostic-change-log.md`

- 与本任务的关联点：本任务全部 AC 的产品语义母法——pump 的有界/隔离/丢弃/健康上报纪律、create duplicate 诊断覆盖、输入零访问、时序与 shutdown 隔离。
- 核心条款（原文摘录，编号=文件行号）：
  1. L20：「日志 emit、排队、持久化、背压、丢弃或关闭失败不得改变业务操作的返回值、rejection、提交事实、sequencer 顺序或 Runtime 状态」——AC6 隔离义务的原文。
  2. L23：「日志允许缺失、乱失尾部或因进程崩溃只留下尝试开始而没有结局；系统不承诺 exactly-once、at-least-once、无 gap……」——best-effort 定位允许丢失，**不要求**丢失；AC2 只消灭 drop-newest 策略之外的意外丢失，属允许域内的强化。
  3. L24：「日志 adapter 必须以 non-throwing、有界、非阻塞的 emitter seam 接收记录。Runtime/Registry/复制实现仍防御 adapter 违约；adapter 同步 throw 或异步失败均被隔离，并只进入独立的日志健康 metrics/observer」——AC1/AC3/AC6 的有界与隔离义务来源。
  4. L25：「日志队列溢出可以丢弃记录。实现应尽力上报 dropped count、sink failure 和 queue health，但这些健康信号本身也不构成日志完整性证明。」——AC3「不能只静默 return」的上报依据。
  5. L33–38：结局词表固定为 `committed` / `rejected` / `fatal` / `unknown`（`unknown` 仅用于缺可判定结局的诊断记录，正常操作路径不得主动代替既有结果分类）。
  6. L40–49：stage 至少保留 8 值——`acceptance` / `capability-gate` / `input-snapshot` / `schema-compile` / `validation` / `identity` / `transaction` / `dirty-notification`；「`rejected` 不得折叠成统一 `failed`」。
  7. L51：「每条结局记录保留所属模块已有的稳定 code、phase、issues 顺序与 committed 事实；日志层不得发明 retryable、rollback 或成功语义。」——AC4「不临时发明字段或枚举值」的母法。
  8. L57：首版覆盖范围含「namespace create，**包括输入、schema、ROOT、duplicate、Persistence 与 post-commit Runtime construction 结局**」——AC4 要补的 duplicate 诊断是该条款的**既有要求**（当前实现缺口，非新决策）。
  9. L69–77：输入捕获与零额外读取——gate 前拒绝只记 `input.capture = not-accessed`；快照成功后只消费同一份 detached frozen snapshot；快照失败记 `unavailable/unsafe-input`，不得重读 Proxy/accessor/循环引用（AC5 原文依据）。
  10. L87：「日志字段不得进入默认低基数 metrics label。」——pump 健康上报的基数红线。
  11. L117：emit 语义「立即接收一份由调用方持有权已转移或已复制的 detached record；不得阻塞、throw、返回 durability promise」；「日志模块可在其实现内部使用有界队列、batch、sampling、文件或远端 sink」——泵的有界内存队列为该条款明文允许的形态。
  12. L123–129（时序与 sequencer）：「变更尝试的业务排序继续由现有 Registry lifecycle slot 或 namespace write sequencer 决定，日志不得引入第二个业务排序机构」；「emitter 不被 `await`」；「adapter 慢、失败或队列满都不得延长 write slot 或阻塞 close/shutdown；Host shutdown 可 best-effort drain 日志，但 Registry/Persistence 的停止不得无限等待日志 sink」——AC2 FIFO（仅诊断面保序）/AC6 shutdown 上界的依据。
- 对本任务影响：AC1–AC6 均为该 ADR 既有条款的兑现或允许域内的实现强化，无条款需要修订。

### ADR-0012（诊断格式）VFSL 校验的 JSONL 与 framed sidecar 诊断日志格式（accepted；含 issue #152 round-2 amendment）

`docs/adr/0012-vfsl-validated-jsonl-and-framed-sidecar-change-log.md`

- 与本任务的关联点：冻结词表（operation/stage/result/code/sourceModule）、writer queue 满丢弃纪律、File adapter `emit` 的 write-slot 隔离 amendment——AC3/AC4 的直接约束源。**注意：Registry 侧 diag-pump 是生产者→emitter 的投递载体，不是本 ADR L218/L252 所述 adapter 内部「逻辑 writer queue」**（每 record 仍由 drain 内一次同步单-record append 落盘；storage projection 一字不动）。
- 核心条款（原文摘录，编号=文件行号）：
  1. L69–80：v1 operation 是封闭词表（`namespace-create` / `root-mutation` / `schema-replacement` / `replication-apply` / `replication-enable` / `replication-epoch-bump`）；「新增 operation 需要新的 record schema 版本与 stream generation」。
  2. L80–87：result 严格判别联合——committed+`noop`/`update`/`update-omitted`、`rejected`、fatal+`committed:false`、fatal+`committed:true`（effect 为 `update | update-omitted | unknown`）；「rejected 与 fatal committed:false 禁止携带 update」。
  3. L89：「顶层诊断 `stage` 使用日志 schema 的封闭枚举；`code` 与 `sourcePhase` 使用安全 Pattern 字符串并标注 source module，不复制 Registry、Runtime、Persistence 与 replication 的全部错误枚举，也不发明 retryable、rollback 或提交事实。」——`DOC_DUPLICATE` 等模块稳定码经 `code`+`sourceModule`（'persistence'/'registry'）承载的合法通道；stage 新增值属词表演进。
  4. L22：streamId「碰撞时有限重试；耗尽只使日志能力不可用并上报健康故障，不改变 namespace 业务结果」；L24：「初始化失败不影响 namespace create；独立健康 observer 上报 `LOG_STREAM_INIT_FAILED`」——AC6 initStream 失败隔离依据。
  5. L61–67：record 身份是 `(streamId, sequence)`；`attemptId` 复用已有受控关联 ID，缺失时 CSPRNG 生成；writer 准备 append 时才分配 stream sequence。
  6. L240：「writer queue 满时 drop newest，保留已排队顺序；**不得为了记录 drop 再挤占同一队列**。按 operation/reason 增加低基数 dropped metrics，并走独立 observer。」——AC3 的逐字来源（含「不占同一队列记录 drop」）。
  7. Amendment L244–252（issue #152 R2，File adapter 首切片）：「每个 `emit` 在调用栈内执行至多一条 final JSONL record 的有界同步 append……本首切片不维护 writer queue、不做 batch flush」；「**任何将 File adapter 的 `emit` 接入 namespace 生命周期的调用点，必须位于 NamespaceRuntime write sequencer slot 之外，或在该 slot 已释放之后；不得在 slot 内执行同步 File adapter `emit`**」；L252：queue/batch 是目标演进形态，未来切片不得改变 emitter 公共 seam、record schema、manifest policy 或 write-slot 隔离条件，且须另行定义 close/shutdown、flush、队列满与 fsync 配置语义。
- 对本任务影响：泵修复保持「macrotask drain（业务槽外）+ 槽内 O(1) 入队」结构即天然满足 amendment；不得把泵改造成 adapter 存储语义（batch/flush/fsync/queue 满的 L252 义务域）；AC4 若需词表演进必须走「新 record schema 版本 + 新 stream generation + 设计评审」冻结通道。

### ADR-0010 Hub/Peer WebSocket Y.Doc 复制与最终一致（accepted；含 #133/#134/#161 修订节）

`docs/adr/0010-hub-peer-websocket-ydoc-replication.md`

- 与本任务的关联点：仅「Namespace identity、owner 与复制范围」节（create 候选碰撞预算）与数据保护节；WS/复制 transport 其余条款与本任务无交集。
- 核心条款：
  1. L28：「普通 `Registry.create()` 不再接受调用方指定 namespaceId，而由注入的受控 128-bit CSPRNG 生成 `ns-` + 32 位小写 hex；**撞到当前 Registry entry 或目标 Persistence duplicate 时最多重试 8 次，耗尽以 `committed:false` Registry fatal 失败**。」——AC4 前半句的原文；duplicate 诊断不得改变该预算与结局。
  2. L159：「Token、Yjs update、SCHEMA/ROOT 内容以及未经控制的 owner/namespace 不得出现在默认日志或高基数指标标签中。」——泵健康/observer 上报的第二条基数红线。

### ADR-0009 NamespaceRegistry、调用方租约与 Cordis Host 生命周期（accepted；含 #131/#134 修订节）

`docs/adr/0009-namespace-registry-leases-and-host-lifecycle.md`

- 与本任务的关联点：create lifecycle 槽边界（泵入队点纪律）、Registry 内部 observer seam（AC3 上报通道）、公共面冻结与 shutdown 语义（AC6）。
- 核心条款：
  1. L62：「完整 snapshot、compile、validate、detached construction、Persistence create 和 Runtime construction 均在同一个 lifecycle 槽中执行」——泵入队只能发生在槽内 O(1) 纯内存动作，drain 在槽外。
  2. L95：「Registry 核心通过内部结构化 observer seam 上报生命周期与故障；event 可携带受控 identity 和 exact cause，由日志/metrics/trace Adapter 负责访问控制、脱敏与采样。v1 不提供公共事件订阅。」——AC3 drop 健康上报的既有通道。
  3. L107–114：Registry v1 公共面冻结为 `open` / `create` / `getStatus` / `shutdown`；「v1 不公开 list、entry status、lease count、queue、timer handle、explicit eviction、按 key close 或公共 events」——泵与健康上报不得新增公共 API。
  4. L99–101：shutdown「停止接纳 → 等待已接纳 lifecycle 操作结算 → close 全部 Runtime → 聚合失败」——AC6「不无限延长 shutdown」的既有形态。
  5. #131 修订 L140：「create 的跨候选重试仍受 lifecycle carrier 串行化与 shutdown 已接纳操作屏障约束」——duplicate 诊断补齐不得松动 retry 串行化。

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted；含 #93/#132 修订节）

`docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md`

- 与本任务的关联点：ADR-0012 amendment 所引用的 write sequencer 槽定义；本任务不改写路径。
- 核心条款：
  1. L40–51：同一 namespace 所有受控 Y.Doc 写共享唯一严格 FIFO write sequencer；槽序为「lifecycle/fatal gate → `DocHandle.getStatus()` writable gate → 输入快照 → 领域校验与 detached 构造 → 一次 Yjs transaction → `await notifyDirty()`」——「slot 内不得同步 File adapter `emit`」所指的槽。
  2. #93 修订节：`RUNTIME_READ_DISABLED` / `RUNTIME_WRITE_DISABLED` / `NSRT-CLOSE-RELEASE-FAILED` 稳定码注册——供 SA1 理解停接纳/写禁用码族，本任务零接触。

### ADR-0006 Cordis 持久化插件 DocPersistence 与 docstore（accepted；含 #64/#79/#131/#133 修订节）

`docs/adr/0006-server-persistence-docstore.md`

- 与本任务的关联点：`DOC_DUPLICATE` 稳定码与排他创建语义——AC4 duplicate 诊断的事实源。
- 核心条款：
  1. #64 修订 L121–123：`createDoc(owner, docId, doc)` 对 `(owner.userId, docId)` 排他创建；「cache/store 已存在或并发创建 → 拒绝 `DocDuplicateError`（稳定错误码 `DOC_DUPLICATE`）；**在 duplicate 判定路径上绝不覆盖已提交内容**」——诊断只能观察该结局，不得改变其判定。
  2. #79 修订（entry status / saveDoc dirty notification）与 #133 修订（import/archive/probe）——非本任务直接对象，登记备查。

### ADR-0007 逻辑校验与 Yjs Runtime Bridge 分层（accepted；open/read 条款被 ADR-0008 取代）

`docs/adr/0007-logical-validation-and-yjs-runtime-bridge.md`

- 残余有效条款：L52–54 零写入承诺与「Yjs observer 不得向事务调用栈抛异常」的 no-rollback 纪律。与本任务交集小（create 管线沿用其 validated mutation 底座），无冲突。

### 其余 ADR（与本任务无关联，仅盘点登记）

- ADR-0001（VFSL 单一真相源）、ADR-0002（重写定位/authority 出范围）、ADR-0003（求值器/ROOT/联合表示）、ADR-0004（类型投影）、ADR-0005（投影生成管线）——schema/引擎/投影领地，本任务不触及；无冲突。
- **ADR-0012（实例身份单一真相与 WebSocket plugin 所有权）**（`docs/adr/0012-instance-identity-and-websocket-plugin-ownership.md`）——Instance service / Hub/Peer WS plugin 生命周期，与本任务无交集；无冲突。
- ⚠ 编号提示：`docs/adr/` 存在**两份 0012 文件**（instance-identity 与 diagnostic-format，主题无关）。下游 SA 与文档引用「ADR-0012」时必须带主题限定词（如「ADR-0012 诊断格式」），避免歧义；本两份产物均以文件全名区分。

## CONTEXT.md 相关术语与惯例

- **namespace 诊断变更日志**（L144–146）：「尽力记录所有变更尝试及其结构化结局的可选 observability 流……日志不参与业务提交、不承诺完整性或恢复能力。」_Avoid_: 审计账本、WAL、event sourcing、可靠恢复日志。→ 泵的 best-effort 定位锚。
- **变更尝试**（L148–150）：「结局区分 committed、rejected 与 fatal，并标明 acceptance、capability gate、input snapshot、validation 等阶段。被拒请求也属于变更尝试。」→ collision/`DOC_DUPLICATE` 候选结局属变更尝试，应记录。
- **语义 emission**（L156–158）：「producer → 诊断日志 emitter 提交的 detached 语义结局——operation/stage/observedAt/source/context/result……emit 同步、不 throw、不阻塞」；「update-omitted 稳定 reason 受控词表（v1）：`payload-too-large` / `update-capture-disabled` / `empty-update`——**新增 reason 属词表演进，须过设计评审**。」→ AC4 词表演进纪律的 CONTEXT 锚（同款纪律覆盖 operation/stage/sourceModule）。
- **storage projection**（L160–162）：「日志 adapter 独占的物理表示决策……emitter 只做语义投影，不构造物理字段。」→ 泵/duplicate 诊断不得构造 segment/offset/Base64/CRC。
- **genesis baseline record**（L164–166）与 **诊断日志 stream generation**（L152–154）：建流与 genesis 语义归 adapter；泵只搬运 `initStream` 调用。
- **写序列器**（L77–79）：「每个 NamespaceRuntime 独有的严格 FIFO……」→ slot 隔离 amendment 的术语锚。
- **namespaceId**（L121–123）：Registry 以 namespaceId 排他索引；owner 不上 wire——collision 归属键的术语依据。

## 代码层冻结契约（证据登记，非冲突基准；SA1/SA3 红线来源）

> 以下为包内 AGENTS.md 与冻结实现注记，按 docs/AGENTS.md 属 ADR 条款的落地载体；冲突门禁仅经 ADR-0011/0012 收录关系核验，不单独构成基准。

1. `packages/namespace-diagnostic-log/src/vocabulary.ts`：operation（6 值）/ stage（8 值）/ sourceModule（4 值：`registry` / `runtime` / `persistence` / `replication`）封闭；「词表外值在 emitter intake 直接丢弃 emission」。
2. `packages/namespace-diagnostic-log/AGENTS.md`：`src/schema.ts` 任何字符变更 = schema 版本变更（id 升 `@2`、新 stream generation、旧 stream 只读、`test/schema-freeze.test.ts` 指纹钉死，当前指纹 `sha256:v1:dedad2ab…`）；v1 不写 `result:'unknown'`（§11-G3）；不 gen genesis-baseline 记录（#152 adapter 内部构造路径）。
3. `packages/namespace-registry/src/diag-pump.ts`（PR #248 现状，本票修复对象）：`enqueue` 以 `!draining.has(namespaceId)` 判定是否 `setImmediate(drainNamespace)`——首 drain 执行前的 burst 窗口内 `draining` 尚未置位，**每次 enqueue 都会再排一个 setImmediate**（AC1 缺陷）；queue 满（per-ns 上界 256）静默 drop-newest、无健康上报（AC3 缺陷）；drain 同步排空后 `queues.delete` + finally `draining.delete`，scheduled/running 状态与队列清理的交错域即 AC2 缺陷域。
4. `packages/namespace-registry` registry-surface 静态守卫三正则（裸/globalThis `setTimeout`/`setInterval`/`clearTimeout`/`clearInterval` 与 `Date.now`）**有意不含 `setImmediate`**（#226 R4 注释契约，见 `registry-surface.test.ts`）——修复不得引入被守卫的裸调度/计时原语。
5. `wiki/raw/task_issue-226_*.md` 等 #226 设计工件中「泵满静默丢弃、Registry 不代发健康」属历史设计证据（docs/AGENTS.md：wiki/raw 是 evidence 不是 normative contract）；AC3 对其强化不构成 ADR 冲突，但新上报通道必须落在 ADR-0009 L95 既有内部 observer seam 内。
