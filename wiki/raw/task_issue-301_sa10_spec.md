# SA10 Spec 审查 — issue #301（#295 切片 3）：完备性、observer 与新旧互通矩阵

- **dispatch**: sa-9d6ea948-8904-400d-b947-c8eb20b42e17（mabf-sa10 / spec-review / iteration 0）
- **被审对象**: 已提交最终交付 commit `799a6182b818ee0ba6372423c63ea59715a7435d`（`feat(ws-replication): complete chunked observer events`，单提交，parent 实测 = `0f3eca53315574d1ceab823f1e98a648d3bb157a` = dispatch 声明的 Parent PR #298 稳定 head，逐字一致）
- **裁决**: **approve**——AC1–AC5 全部覆盖；8 型 observer 事件字段集与 ADR 0019 L78–81 / 协议 §23.1 第 29–36 型冻结行逐字一致；范围零越界、零 scope creep；无需 PR 披露的未达成项；2 条 MINOR 观察不阻断
- **Owner-feedback 记录**: REST comments endpoint 返回空（与 dispatch / SA6 §2 / SA2 §4 / SA3 / SA4 头部一致）——无适用 owner 要求，无 override 需并入
- **SA10 纪律声明**: 本审查独立核对 issue 正文/AC、批准验收契约（SA6 含 Revision R1）与规范冻结文本，对提交 diff 逐文件实读、对契约断言体逐条实读、对发射点与类型面源码直读复核；未修改代码/设计/测试，未运行测试，未启动服务。运行时绿灯证据（契约 17/17、全包 516、根 3503、typecheck）引自 SA3/SA6/SA7 并经提交内 `artifacts/sa7-issue301-*.log` 与 md5 跨 SA 指纹互证（本审查实测 5 个实现文件 md5 与 SA3 §2/SA6 §16/SA4 §2 记录逐字相同：`912350fc…`/`2089bfe4…`/`200744a0…`/`935c3fcf…`/`dead8d68…`）——被提交字节 = 被审查/被验证字节，证据链无断裂。

---

## 1. 审查输入

| 输入 | 状态 | 用途 |
|---|---|---|
| `gh issue view 301`（title/body/AC1–AC5/labels；comments 空） | 实测 | 验收基准原文 |
| `wiki/raw/task_issue-301.md` | 实读（HEAD 版 38 行） | 任务简报（与 issue 正文逐字一致） |
| `wiki/raw/task_issue-301_sa6_contract.md` | 实读 | 批准验收契约（approve；8 红 R1–R8 + 9 负控 N1–N9；Revision R1 §17 判别式修订） |
| `wiki/raw/task_issue-301_design.md` | 实读 | 批准设计（OD1–OD9、ALLOW/DENY、§12 验证映射、非目标） |
| `wiki/raw/task_issue-301_sa3_impl.md` / `_sa4_review.md` / `_sa7_report.md` / `_sa2_review.md` | 实读 | 实现/静态审查/动态验证/设计攻击评审（全部 approve） |
| `wiki/raw/task_issue-301_{design,implementation}_conflict_report.md` | 实读 | SA8 双复查（均 clear；`requiresConflictRecheck: false`） |
| `docs/adr/0019-chunked-sync-transfer.md` L70–83 | 实读 | 规范：超时两向收口 + observer 8 型字段表 + 非目标 |
| `docs/protocols/instance-replication-v1.md` §9.2 L246、§22、§23.1 L746–755/L783–785、§23.3/§23.4 | 实读 | 规范唯一权威：8 型行、改道子句、键集冻结、safe-field/隔离纪律、ACK 锚定语义 |
| commit `799a618` 全量 diff（21 文件）+ HEAD 源码/契约断言体 | 逐文件实读 | 被审实体 |

## 2. AC 逐条裁决

### AC1 — chunk 丢失、重复、错序、超时、close、GOAWAY、断线、epoch fence 测试矩阵完备，assembly 丢弃零 durable 残留 → **met**

交付契约 `packages/ws-replication/test/ws-replication-issue301-chunked-completeness-ac-red.test.ts`（1392 行 / 17 用例 / 零 skip·only·todo·env——本审查 grep 实测）的矩阵覆盖（断言体逐条实读）：

| 矩阵行 | 承载用例（断言要点实读核对） |
|---|---|
| 丢失（kind=1 尾部停滞） | N1：`BOOTSTRAP_FAILED` 终局 + `namespace-failed{bootstrap-timeout,30000}` + 零写入/零 dirty |
| 丢失（kind=2 尾部停滞） | R5：seal 丢末 chunk、12/13 已收前置 → 超时收口 + 进度断言 |
| 丢失（中途帧缺口） | N4：连接级 `SEQUENCE_VIOLATION` + 零部分导入（可靠有序 transport 的忠实丢帧模型） |
| 重复（kind=1） | N2 分支一：同 transferId 再发 chunkIndex=0 → `SNAPSHOT_TRANSFER_VIOLATION` + failed + apply 前零写入 |
| 重复（kind=2） | N3：chunk1 原位改写为 chunk0（同 sequence、codec 自洽注入）→ `SYNC_TRANSFER_VIOLATION` + hub 值不变 + saveCount 不变 |
| 错序（kind=1） | N2 分支二：缺 i1 直达 i2 → `SNAPSHOT_TRANSFER_VIOLATION` + failed + 零写入 |
| 超时 | N1（kind=1，虚拟时间推进 30_001ms = assemblyTimeoutMs+1）+ R5（kind=2 同法，reconcile 上限隔离单变量） |
| close/终态 | R3：crafted CLOSE_NAMESPACE → `chunked-snapshot-aborted{channel-teardown}` 恰一 + 进度=wire 实测 + 零 applied + 零写入/零 dirty |
| GOAWAY drain | R8：crafted `GOAWAY{SERVER_RESTARTING,drain=1000}` + advance(1000) → draining + aborted{connection-teardown} 恰一（§23.1「GOAWAY 无独立 reason」行）+ 零残留 |
| 断线 | R4：closeHubSide 1001 → aborted{connection-teardown} 恰一 + 进度一致 + 零残留 |
| epoch fence | N9：partial kind=1 全部丢弃、零写入/零 dirty、终态 ∈ {conflicted, disconnected}、零成功型事件 |
| 零 durable 残留 | R3/R4/R5/R8/N1/N3/N4/N5/N9 均以 `docPresent=false` / `saveCount` 不变 / 对端值不变逐例断言 |

补充动态面（非交付测试资产、探针已删）：SA7 P5/P6/P7a-c 再证 timeout/resync-declared/epoch-fence 行恰一与 fence reason last-writer-wins 归并（§23.1 既有裁决内）；kind=0 同发射点面由 issue-244 套件 75/75 锁绿。

### AC2 — 超时两向收口 → **met**

- snapshot 向：N1 断言 kind=1 超时 → `BOOTSTRAP_FAILED` 语义族终局（terminal failed + `namespace-failed{bootstrap-timeout, timeoutMs=30000}`）；实现面 hub L1939 / peer L2348 `clearInboundAssembly(kind === 1 ? undefined : 'timeout')`——终局失败族零 aborted（§23.1 第 35 型明文），终局收口代码逐字未改（diff 仅 reason 实参）。
- sync-diff 向：R5 绿半断言 `RESYNC_REQUIRED{SYNC_TRANSFER_EXPIRED}` 出向、零 ERROR、零 `namespace-failed`、peer 非 failed、hub 值不变、零 dirty——非终态。

### AC3 — 恶意声明不导致无界分配 → **met**

N5 双半（断言体实读）：(a) kind=1 crafted chunkCount=65（> maxChunksPerUpdate 64）→ `SNAPSHOT_TRANSFER_TOO_LARGE` + 零写入；(b) kind=2 真实 transfer chunk0 原位改写 totalBytes=1MiB（> maxChunkedSyncDiffBytes 512KiB）→ `SYNC_TRANSFER_TOO_LARGE` + 零写入 + 零 dirty。「分配前校验 + 按已验证上界一次性分配」的承载实现位于 `update-transfer.ts`（assembler 二维上界 + 几何校验，L184–195 注释与逻辑直读核对），slice 2 已交付、本票 diff 零触碰（基线↔HEAD 该文件 diff 空实测）——负控锁绿即回归门。

### AC4 — 多 namespace 公平调度与 control reserve → **met**

N8（断言体实读）：双 namespace 分块 snapshot 同连接复用，hub data 闸门起始关闭期 OPEN_OK 控制帧照常穿透、零 chunk 出站、双 ns 非 failed；闸门释放后双 ns 全部收敛（公平调度无饿死）、连接 ready。既有 issue137 多 ns 公平锚在全包 516 绿内（SA3 V4 / SA7 C2 + 提交内 `artifacts/sa7-issue301-package-tests.log` 终态实测 `71 passed (71) / 516 passed (516)`）。本票对该面零实现改动（新状态仅 per-controller 内存字段 `chunkedAckT0`，不进调度/账本）——「不回归」由负控 + 全包锁绿承载，与 AC 措辞一致。

### AC5 — observer 8 事件型 → **met**

- **发射点**：11 处物理发射点（sent 3 = hub L604/hub L776/peer L1620；acked 3 = hub L674/hub L722/peer L702；applied 3 = hub L1528/peer L1808/peer L636；aborted 2 = hub L1071/peer L1016——grep + 直读逐点复核）。sent = `pullOne` 末 chunk 分支同一同步栈恰一（非逐 chunk；awaiting-ack 后早退 + 中止载体不可达 ⇒ 结构性单发）；acked = `settle(kind)` 三条件门返回结算记录后、决策落定（状态推进）后发射；applied 在 `importResult.ok`/epoch 判别之后、成功结算点发射；aborted 在 `clearInboundAssembly` busy 守卫快照→reset 后按 kind 三选路发射。
- **改道归零**：R1 断言分块窗口 `bootstrap-snapshot-sent`/`bootstrap-imported` 归零；R2 断言 `sync-step2-sent`/`sync-diff-applied` 增量零；N6 反向锚单帧路径普通族照常 + 零 chunked 事件（改道条件与单帧面分离）。
- **互斥**：R3/R4/R5/R8 断言 aborted 恰一 + 零 applied；R1/R2 断言成功族恰一 + 普通族零；N9 零成功型；apply 成功六选一由 `finishBootstrapImport` form 判别（peer L564–568）与 `applyRemoteUpdate` `'syncChunked' in chunked` 判别（hub L1526/peer L1803）结构性互斥，单帧 else 腿逐字节不变（diff 实读）。
- **safe-field/secret-free**：R6 四次真实运行收集全 8 型——键集 ⊆ 冻结白名单、深扫无 `Uint8Array`/`ArrayBuffer`/`DataView`/`Error`、JSON 无 token/owner/内容哨兵。
- **throw isolation / 无 observer 逐字节等价**：N7 断言 observer 全 throw 与无 observer 基线 wire 帧序列逐字节全等 + 值全等 + 无 observer 零事件；全部新发射经 `emitObserver` → `dispatchReplicationObserver` 单点（observer.ts diff 空）。
- **clock 缺省两态**：R7 断言 applied/acked 四键整键缺失（`'applyLatencyMs' in event === false`，非 undefined 值）。
- **syncRoundId safe-field**：R2 断言 sync 族 sent/applied 携 syncRoundId=wire round、acked 冻结无 syncRoundId/sequence；R2 wire 锚 = Revision R1 判别式（L714 `ackedSequence === kind=2 末 chunk 帧序` 恰一，直读在位）——与协议 §9.2 L246 规范身份一致；SA6 §17.6 + SA3 V10 双向 mutation 实证非恒真。

## 3. 规范一致性独立比对

| 规范条款 | 交付核对（本审查三源比对：types.ts ↔ 协议表行 ↔ api.test-d 镜像） | 结论 |
|---|---|---|
| ADR 0019 L78–81 + §23.1 L750–755/L784–785（8 型字段集/side/键集排除） | types.ts L870–983 八成员：字段名/可选性/side 信封（snapshot 成功三型字面量 hub/peer/hub；sync 四型与两 aborted 型 `ReplicationObserverSide`）逐字一致；sent 恒无 latency、applied 无 transferId/sequence/效果组、sync-acked 无 sequence/syncRoundId、aborted 无 connectionId | 一致 |
| `reason` 复用 `ChunkedUpdateAbortReason` 闭联合零新词 | 两 aborted 型 `reason: ChunkedUpdateAbortReason`（六值既有闭集）；api.test-d L291 镜像同值 | 一致 |
| §23 头部 append-only / GA 冻结 | `ReplicationObserverEvent` 纯加性第 29–36 型；api.test-d 36 型全联合 `toEqualTypeOf` 镜像 + 8 型逐字段 `Extract` + 3 处负向 keyof 锚同步（types 加成员而镜像不同步即 typecheck 红——自带防漂移）；外部穷尽消费者排查（`apps/yjs-server/src/fatal-policy.ts` 含 default 腿，SA2/SA4/SA8 三层复核） | 一致 |
| §23.1 第 35 型「终局失败族不发本事件」 | `onAssemblyTimeout` 双侧 kind=1 → reason undefined → 零构造零发射；SA7 P1 行为面确认（aborted=0 + namespace-failed 终局恰一） | 一致 |
| §23.4 决策落定后发射 / clock 缺省整键缺失 / 无 observer 零时钟调用 | hub onBootstrapAck：settle→setState→发射（直读 L668–683）；latency 全部条件展开；`sampleAckT0` 仅 observerOn 时触 host.now | 一致 |
| §22 Conformance 资产锚惯例 | 协议文档 diff = **1 insertion / 0 deletion**（hunk 头 `@@ -699,6 +699,7 @@`，新行 L702 落 §22 列表内，登记本票契约 + 类型镜像）；§23.x 冻结文本零改动 | 一致 |
| issue body 括注「新旧互通矩阵不在本票范围」 | 交付零互通矩阵断言/实现（全 diff 无该面） | 一致（正确排除） |

## 4. 范围与 scope creep 审查

- **提交全集**（21 文件）：7 个 ALLOW 文件 M（types/bulk-transfer/hub-namespace/peer-namespace/round-engine + api.test-d + 协议 §22 一句）+ SA6 契约 A（1392 行）+ 4 个 SA7 证据日志 A + 9 个 wiki 固定产物 A——全部属本票交付集；`packages/`+`docs/` 内变更恰为上述 8 文件（本审查 `--name-only` 实测）。
- **DENY 面零触碰**（基线↔HEAD pathspec 实测 = 0 命中）：`observer.ts`/`update-channel.ts`/`update-transfer.ts`/`index.ts`/`replication-protocol/**`；ADR/CONTEXT 未改。
- **零 wire/配置/FSM 改动**：0x42 codec、消息码/错误码注册表、配置链、状态机转移全集未动；唯一生命周期面改动 = `onAssemblyTimeout` 的 reason 实参选择（kind=1 零 aborted，规范明文要求）。
- **无 scope creep**：未顺手改 observer-red 白名单、未扩 issue300 锚、未做互通矩阵、未引入新错误码/新词。`wiki/raw/task_issue-301.md` 的 EOF 空行删除属 iteration 2 dispatch 点名的 commit-readiness 空白卫生（SA3 §8-4 登记、SA4 §6.2 blob 级取证内容中性），非交付语义变更。
- `git show --check 799a618` exit 0（本审查实测）。

## 5. PR 必须披露的未达成项

**无。** AC1–AC5 全部 met；无 partial / unmet / unachievable 项。以下为已在批准契约与设计内登记的**规范解释边界**（非未达成项，供 PR 描述参考即可）：

1. kind=1 超时零 aborted = §23.1 第 35 型终局失败族条款明文（SA6 §12.3-1 / OD7 / SA8 D7 no-conflict）；
2. peer 侧 epoch-fence 的 aborted reason 可被 connection-teardown 覆盖（§23.1 last-writer-wins 既有裁决；N9 只锁效果面；SA7 P7c 实测归并行为一致）；
3. 被拒 ACK（round 校验失败）零 acked（kind=0 `onUpdateAck` violation 先例平移；SA8 D6 no-conflict；SA7 P2 行为面确认）；
4. shed × kind=1/2 aborted 结构性不可达（非 live 门，§244 D5 既有裁决；shed reason 的 kind 选路接线由 kind=0 行 issue-244 D-SHED1/2 锁绿；SA7 §10-1 记录，行为符合设计）。

## 6. MINOR 观察（不阻断 approve）

- **M-1（MINOR）**：kind=2 的「错序」组合未以独立用例实例化——矩阵中错序检测由 N2（kind=1）承载、kind=2 违例族映射由 N3（重复）与 slice-2 R6（totalBytes/syncRoundId 漂移 → `SYNC_TRANSFER_VIOLATION`）承载；assembler 错序/重复判别为 kind 无关同一代码路径（`update-transfer.ts` busy 分支 chunkIndex !== expected → VIOLATION，族按在途 kind 投影），两轴各自独立覆盖。批准契约（SA6 §12.1 矩阵定义）即按此划界，满足 AC1「矩阵完备」；若后续要求逐格 (scenario × kind) 全组合，可补一条 kind=2 错序用例，非本票必要条件。
- **M-2（MINOR）**：GitHub issue 正文的 AC 复选框在 tracker 中仍未勾选——属 issue 状态维护事项（finalize 时勾选），与交付内容无关。

## 7. 运行时证据链（引用 + 互证；SA10 未运行测试）

| 证据 | 来源 | 结果 |
|---|---|---|
| 契约 17/17（R1–R8 + N1–N9，连续多次零抖动） | SA3 V3 / SA6 §13.2 / SA7 C1 | 绿 |
| 全包 71 文件 / 516 用例 | SA3 V4 / SA7 C2 + 提交内 `artifacts/sa7-issue301-package-tests.log`（终态实测 516 passed） | 绿，既有 499 零回归 |
| 根 `pnpm test` 332 文件 / 3503 用例 + typecheck 全绿 | SA3 V12/V7 | 绿 |
| 支撑套件 75/75（issue-244 动态面 + #300 契约/机制锚 + observer-red） | SA7 C4 + 提交内日志 | 绿 |
| 探针删除后 28/28 不变 | SA7 C5 + 提交内日志 | 绿 |
| 实现字节连续性 | 本审查实测 md5 五文件与 SA3 §2/SA6 §16/SA4 §2 逐字相同 | 证据链同源 |

## Verdict

**approve。** 交付 commit `799a618`（parent 与 dispatch 声明的 PR #298 稳定 head 逐字一致）忠实满足 issue #301 正文与 AC1–AC5：异常面生命周期矩阵（丢失/重复/错序/超时/close/GOAWAY/断线/epoch fence + 零 durable 残留）、超时两向收口、恶意声明分配前拒绝、多 ns 公平/control reserve 由契约 17 用例（R 系红转绿 + N 系锁绿）与全包回归承载；observer 8 型的发射点、R21 改道归零、成功型互斥、safe-field/secret-free/throw isolation/无 observer 逐字节等价全部落地且字段集与 ADR 0019 / 协议 §23.1 冻结行逐字一致；规范解释边界（终局失败族零 aborted、fence reason 归并、被拒 ACK 零 acked、shed 结构不可达）均按批准契约与 SA8 双复查（clear）收口。范围零越界、零 scope creep；无需 PR 披露的未达成项；2 条 MINOR（M-1/M-2）不阻断。

*SA10 未修改代码/设计/测试，未运行测试，未启动服务，未调度其他 SA，未 commit/push；唯一产出为本文件。*
