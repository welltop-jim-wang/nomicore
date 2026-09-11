# SA2 设计攻击评审 — issue #300（#295 切片 2）：chunked BOOTSTRAP_SNAPSHOT / SYNC_STEP2 端到端（r1 复审）

- **dispatch**: sa-507ab5d4-b19b-416d-89da-ddb9b0b83bac（mabf-sa2 / design-review / iteration 1）
- **评审对象**: `wiki/raw/task_issue-300_design.md`（SA1 **修订版 r1**，568 行，iteration 1，逐条响应 iteration 0 的 reject）
- **裁决**: **approve**（iteration 0 的 SA2-B1 + SA2-M1–M5 全部经源码逐条复核为**已落实且机制成立**；7 条非阻塞观察全部采纳/吸收；无新增 BLOCKER/MAJOR；3 条新非阻塞观察 + 1 条转 SA6/总控的上游事实更正在案）
- **替代范围**: `pass` 仅指设计通过审查；实现与活链路验证归 SA4/SA7。

---

## 1. Reviewed inputs

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-300.md`（任务简报；comments REST = `[]`） | 实读 |
| `wiki/raw/task_issue-300_design.md`（r1，568 行，评审对象） | 实读（全文） |
| `wiki/raw/task_issue-300_sa2_review.md` iteration 0（reject：B1 + M1–M5 + 非阻塞 1–7） | 实读（修订映射核对基准） |
| `wiki/raw/task_issue-300_sa6_contract.md`（approve，8 红 + 4 负控） | 实读 |
| `wiki/raw/task_issue-300_conflict_report.md`（clear，R42–R47 + N6） | 实读 |
| `wiki/raw/task_issue-300_relevant_decisions.md`（SA8 决策摘录） | 实读 |
| `docs/adr/0019-chunked-sync-transfer.md`（全文 116 行） | 实读 |
| `docs/protocols/instance-replication-v1.md`（§5/§8.1/§8.2/§9.2–9.4/§10.3/§13.2/§17/§22/§23.1/§23.3） | 实读 |
| 源码复核（本轮新增锚点 C14–C21 逐条）：`errors.ts`（全文）、`payloads.ts` decodeError/encodeError、`error-mapping.ts`、`update-channel.ts`（onAck L215 / sendOneChunk L421–427）、`backpressure.ts`（L218/L226）、`peer-namespace.ts`（applyRemoteUpdate L1383–1389/L1466–1490、resync 边沿 L617/L623/L1153–1169/L1192+、teardown L467–470/L1811–1814）、`hub-namespace.ts`（L861/L867/L996/L1037–1038/L1226–1232/L1459–1461、shed L157–158）、`peer-connection.ts` L395–396、`hub-connection.ts` L63–66、`test/driver.ts` L537–552 | 实读 |
| 测试面复核：`codec-issue242-ac-red.test.ts`（L462 计数）、`test/fixtures.ts`（NAMESPACE_ERROR_TABLE L535–538）、`codec-registries.test.ts`（L109/L127–165）、`codec-fuzz-property.test.ts`（注册表驱动）、`codec-messages-golden.test.ts` / `codec-issue299-ac-red.test.ts`（零注册表引用——DENY 安全性）、`ws-replication-issue256-namespace-failed.test.ts` 场景 14（L752–780）、`ws-replication-issue300-chunked-sync-ac-red.test.ts`（R4/R6/R7 断言面） | 实读 |
| `packages/ws-replication/AGENTS.md`、`packages/replication-protocol/AGENTS.md`（append-only 注册表纪律 L11）、docs/AGENTS.md | 实读 |

Owner 评论：无（REST 快照空；简报/SA6/SA8 三方一致）——无评论映射义务。

---

## 2. Verdict

**approve。** r1 对 iteration 0 全部 6 条阻断 finding 的修订均为**机制级落实**而非措辞修补，且每条都经本轮源码独立复核成立：

- **B1 → D12**：errors.ts 入 ALLOW LIST，按协议 §13.2 L445–448 冻结值 append-only 首登四行（本轮逐值核对：VIOLATION=yes/no/failed、TOO_LARGE=yes/config/failed ×2，与协议表及 ADR 0019 L68 三方一致）；类型联合扩展、三处计数注释（L5/L31/L145 实测存在）、fixtures 镜像（codec-registries L109 键集等价断言实测）、issue242 计数用例（L462 `toHaveLength(22)` 实测）同步面完整；**全库扫描确认无任何 DENY LIST 测试持有会因 22→26 转红的注册表枚举/计数断言**（codec-fuzz/codec-registries 为注册表驱动自动覆盖；golden 与 issue299 零注册表引用）；DENY 收窄为 codec 形态面（payloads/messages/index/golden）；#242 先例（errors.ts L136–139）与 AGENTS L11 append-only 明文路径均实测成立。
- **M1 → D3 抑制门**：C16 复核确认现状发射序 `isStep2 → sync-diff-applied`（无条件、先于 chunked 判别，双侧同构）；`{syncChunked:true}` 判别联合 + `isStep2 ∧ ¬syncChunked` 门控使单帧/kind=0/else 三路逐字节不变、kind=2 完成点零事件——与 §23.3 L753 第 33 型「该结算点不再发普通族 sync-diff-applied（窗口内归零）」一致；D3/D8 的假论据均已按修订要求改正，§10 补 applyRemoteUpdate 行。
- **M2 → D1 abort 面 4**：三族 resync-declared 边沿挂点全部实测存在（`onResyncReceived` 内 `markResyncReceived` 同点 peer L617/hub L861；本端声明漏斗 `declareLocalResync` L1192+/`onLocalResyncEdge` L996（channel host L226 接线）；ack-timeout funnel peer L1153–1169/hub L1037–1038）；协议 §10.3 L333「中止复用既有机制（…RESYNC_REQUIRED…）」冻结文本实测在案；边沿后出站静止性 + 残渣矩阵（kind=2 与 kind=0 F3 同构）论证成立。
- **M3 → D7 唤醒路径**：C17 复核确认 `onAck` 仅 `queued.length>0` 触发 drain（L215 实测）；扩展条件 `∨ host.hasBulkTransferWork()`（channel host seam 只读判据）+ facet 聚合 queuedCount 保持 wheel 留轮（backpressure L218）构成闭合唤醒链；R47 等价论证（无 bulk 工作时条件与现状逐字节同义）成立；§13 首行登记该构型风险。
- **M4 → §11 场景 14 三要素**：C21 复核确认 peer 单旋钮决定协商（peer-connection L395–396 `optionalCapabilities`）、hub 恒支持（L66）、`test/driver.ts` 现无 `chunkedUpdate`（全文件 grep 零命中）且 `createPeerReplication` 的条件展开惯用法与设计透传方案同构；driver.ts 入 ALLOW（附理由）、issue137-driver.ts 入 DENY 保护；场景 14 现断言面实测（issue256 L752–780，现锚 BOOTSTRAP_TOO_LARGE）与改写三要素（协商 + 超聚合构型 + 新码断言）可执行。
- **M5 → D1 出站被拒转移**：C18 复核确认 #243 先例形态（seq≤0 → 失败明细先采样 → discardQueued → needsResync → `declareLocalResync('send-failed')`，update-channel L421–427）；kind=2 镜像该族、kind=1 → `BOOTSTRAP_FAILED` + `finalize('failed','send-failed')`——两 cause 字面量均在 §23.3 L780 闭集合内（实测）；§23.3 L814 send-failed 行「出站发送异常族」读法已列入 §15 复查焦点（诚实处置）。

SA6 契约（8 红 4 负控零修改）、SA8 R42–R47/N6、ADR 0019、协议冻结文本与 append-only 范围逐条符合（见 §5–§12）。残余 3 条非阻塞观察见 §14，不构成实现前修订义务。

---

## 3. 需求覆盖

| Requirement | Design section | Assessment |
|---|---|---|
| AC1 超限 snapshot → kind=1 分块 + BOOTSTRAP_ACK 锚末 chunk 帧序 | §7 D4/D5、§8 ① | 覆盖；R4/R5 错误码经 D12 首登后可发射（B1 闭合）✓ |
| AC2 双向超限 diff → kind=2 + 单 SYNC_APPLIED | §7 D3/D5、§8 ②③ | 覆盖；M1/M2/M3 修订后状态机闭合 ✓ |
| AC3 帧上限 + data 路径记账 + control reserve 零 chunk | §7 D1/D7 | 覆盖；M3 唤醒路径补齐活性 ✓ |
| AC4 四新码 + 既有绑定块码映射 | §7 D6/D10/D12 | 覆盖；D12 = 发射面前置项，分类与协议 §13.2 逐字一致 ✓ |
| AC5 R1/R3 收敛绿灯 + 刻画文件不动 + 一次 apply 零写入 | §7 D0/D5、§11 | 覆盖；D0 v1 门保持三方交叉验证（iteration 0 已核实，r1 原样保留并注记双方核对一致）✓ |
| R42 三 kind 共用计数器 | §7 D2 | 覆盖（allocateTransferId 包内单点；teardown 归 1 单点保持）✓ |
| R43 解码门不弱化 + 发送沿既有协商面 | §7 D0/D3/D5、§10 | 覆盖（pre-parse 门在 connection 层先于全部接收管线；frame-io 零改动入 DENY）✓ |
| R44 首 chunk 全四条校验 | §7 D6 | 覆盖（五步校验序、`≤` 含等号、控制器/assembler 分层）✓ |
| R45 发送端聚合超限 + 场景 14 改写 | §7 D3/D4、§11、§12 | 覆盖；M4 修订后改写可执行 ✓ |
| R46 observer/生命周期归 #301 + 显式处置 | §7 D8 | 覆盖；M1 门控后归零声明与机制一致 ✓ |
| R47 冻结面零顺手改 + 文档同步 | §7 D5/D8/D12、§11、§12 | 覆盖；D12 = append-only 首登（兑现 §13.2 冻结面而非改表），DENY 收窄有据 ✓ |
| 非目标（零协议外新码/零新配置键/#301 边界/不跨重启） | §1 | 无静默扩大；「不新增错误码」表述已按 B1 修正为「协议冻结值的注册表首登」✓ |

## 4. Owner评论覆盖

| Comment ID | Updated at | Design section | Assessment |
|---|---|---|---|
| （无 — issue #300 comments 为空，三方一致） | — | — | 无义务；设计未虚构评论要求 ✓ |

## 5. 上游事实与SA8约束

| Fact or constraint | Design response | Assessment |
|---|---|---|
| SA6 §8 能力缺口链（G1–G8） | §2/§3 逐条承接（r1 增补 G8 = M2/M3/M5 缺口） | C1–C13 iteration 0 已核实；**C14–C21 本轮逐条复核全部准确**（见 §1 锚点清单）✓ |
| SA6 §12 8 红 4 绿契约 | §11 逐条映射、契约文件零修改入 DENY | R4/R6/R7 wire 断言路径经 D12 成立；转绿判据不变 ✓ |
| **SA6 §8/§11「四码已注册」事实错误** | §5 更正行 + D12 按真实状态（C14：文档有、registry 无）承接 | 设计不依赖 SA6 回执、显式更正承接——正确处置；更正建议仍转 SA6/总控（§14 观察 4）✓ |
| SA8 Frozen surfaces 全表 | §6 逐项 + §12 DENY | 单帧路径/ACK payload/死码保留/v1 组合保持/配置链/observer 注册表/transferId 计数器逐项相容；错误码注册表行的准确读法（首登 = 兑现冻结面）成立 ✓ |
| R42–R45、N6 | §6 逐行 | 全部落实（R45 场景 14 含协商前提）✓ |
| ADR 0019 L12/L39–51/L47/L68/L70/L98–103 | D0/D3/D4/D5/D6/D9/D10/D12 | 逐条同源；D9 kind=1 收口对齐 §8.1「BOOTSTRAP_FAILED 语义族终局」（协议 L202 实测）✓ |
| 协议 §10.3 L325–345 / §9.4 L270 / §17 | D1/D6/D9/D7 | 发送端规则/接收端校验/pre-parse 门/SYNC_TRANSFER_EXPIRED 登记/control 边界逐字符合（实测）✓ |
| docs/AGENTS.md（Authority：wiki/raw 为 evidence 非规范） | 设计引用规范权威 = ADR + 协议 | 一致 ✓ |

---

## 6. 设计内部一致性

| 检查项 | 结论 |
|---|---|
| §7 D12 vs §12 ALLOW/DENY | **一致（B1 闭合）**：errors.ts/fixtures/issue242 测试三行入 ALLOW；DENY 对 replication-protocol 收窄为 codec 形态面（payloads/messages/index/golden/issue299），与 §10 零改动行逐项对得上 |
| §7 D3 vs §7 D8（M1） | **一致（M1 闭合）**：D3 明示「结算单点与锚值逻辑不变、唯一函数内变化 = 第 5 参形态」；D8 论据改为「经 M1 显式门控成立」并保留结构性成立的两项（sync-step2-sent/bootstrap-snapshot-sent 不经单帧点） |
| §7 D1 abort 面 vs C19 挂点 vs §7 D7 | 一致：三族边沿挂点与 channel 同点；§10 双侧行、§8 路线②③错误列、§11 M2 探针相互呼应 |
| §7 D1 出站被拒 vs D10 两行 vs §23.3 | 一致：kind=1/kind=2 处置分族、cause 字面量均在闭集合内；L814 读法入 §15 复查焦点（诚实） |
| D0 判据 vs C12/C21/刻画文件 | 一致：issue137-driver 未协商 → R3 v1 终局保持绿；`test/driver.ts` 透传只影响显式 opts 场景（undefined 零传，条件展开惯用法与现状 L537–552 同构） |
| 死引用/旧 API | 未发现（C14–C21 全部符号/行号实测存在；计数注释 L5/L31/L145、fixtures L535、issue242 L462、onAck L215、sendOneChunk L421+、markResyncReceived L617/L861、onLocalResyncEdge L996 等逐一对上） |
| §14 修订映射表 vs 正文 | 逐行核对一致（B1/M1–M5/非阻塞 1–7 的修订位置与处理结果声明均能在正文找到对应文本） |

---

## 7. 状态机与并发攻击（r1 复审）

| ID | Initial state | Trigger | Expected behavior | Design gap | Required revision |
|---|---|---|---|---|---|
| S1（原 M3 构型） | 窗口 8/8 占满 + channel 队列空 + bulk queued | ACK 释放槽位 | drain 被请求 → ② 出站 chunk | **已闭合**：onAck 条件扩展 `∨ host.hasBulkTransferWork()`；facet 聚合 queuedCount > 0 使 wheel 留轮（L218）；② 在窗口空位判据通过后 pullOne | 无（探针 §11 M3 行 + §13 风险首行在案） |
| S2（原 M2 构型） | kind=2 transfer 进行中，resync-declared 边沿 | 收对端 RESYNC / 本端声明 / ack-timeout | 载体弃置 + 归 idle + 零新增出站 | **已闭合**：D1 abort 面 4 三族挂点（C19 实测）；边沿后残渣 = 真正在途帧，接收端残渣矩阵良性消化（与 kind=0 F3 同构） | 无（完备矩阵归 #301，机制接线在本票） |
| S3（原 M5 构型） | bulk active，`sendChunk` 返回 ≤0（dataGateOpen=true 仍可达） | 出站被拒 | 确定性终局/恢复动作 | **已闭合**：镜像 #243（C18 实测）——采样→弃置→kind=2 declareLocalResync('send-failed') / kind=1 BOOTSTRAP_FAILED+failed；零静默零自旋 | 无 |
| S4 | kind=1 传输中 teardown/新代 session | 连接收口 | carrier 弃置 | 已覆盖（D11 三调用点实测 hub L1459–1461 / peer L467–470、L1811–1814） | 无 |
| S5 | `ownStep2Seq === undefined` 期收 SYNC_APPLIED | 迟到/重复 ACK | 既有 violation 防御 | 已覆盖（锚与末 chunk 出站同一同步栈；round-engine L166 防御 iteration 0 已核实） | 无 |
| S6 | 同 (ns,方向) kind=0 与 kind=2 并存 | wire 交错 | 单 assembler 不误伤 | 已覆盖（D7 ①→②→③ 互斥；发送端 FIFO 论证） | 无 |
| S7 | admitChunkedStep2 通过后停滞/round 重置/混形 | 各形态 | 违例/恢复语义 | 已覆盖（receivedStep2 每 round 复位；D9 busyKind 选路；SYNC_TRANSFER_EXPIRED 词表已登记 §9.4 L270 实测） | 无 |
| S8（r1 新核） | D12 落地后 `NamespaceErrorCode` 联合扩宽 | 类型面消费 | 无 exhaustive-switch 破坏 | **无缺口**：全库唯一值级消费 = ws-replication `types.ts` L277 联合成员（扩宽安全）；无 switch/exhaustive 断言；codec-fuzz/codec-registries 注册表驱动自动覆盖新码 | 无 |

---

## 8. 错误与恢复攻击（r1 复审）

| ID | Failure | Current design behavior | Risk | Required revision |
|---|---|---|---|---|
| E1（原 B1） | 发射四新码 | D12 首登（ALLOW + append-only + 测试同步三面） | **已闭合**：四值与协议 §13.2 L445–448 逐字一致（本轮逐值核对）；encode/decode 由 fail-closed 转可编码；error-mapping `terminalStateOf` 经 lookupError 自动导出 'failed'（L37–39 实测）；**DENY 面零隐藏计数断言**（全库扫描：唯一 `toHaveLength(22)` 在 issue242 = ALLOW） | 无 |
| E2（原 M1） | kind=2 完成点 observer 发射 | D3 syncChunked 门控 | **已闭合**（机制见 §2）；§11 探针行在案（载体建议见 §14 观察 2） | 无 |
| E3 | kind=1 绑定块不符 | wire 既有码 + 接收方 failed/protocol-violation | 裁定成立（iteration 0 E3 评估 + SA6 R5 锚定；r1 保留理由并修正「发送方」笔误）；§15 复审确认在案 | 无 |
| E4（原 M4） | 场景 14 改写 | §11 三要素 + driver 透传 | **已闭合**（C21 实测：协商经 peer 单旋钮可达；现断言面实测可改写） | 无 |
| E5 | kind=1 接收端 assembly 停滞 | D9 精确闭包：弃 partial → `sendNsError('BOOTSTRAP_FAILED')` → `finalize('failed','bootstrap-timeout', assemblyTimeoutMs)` | 选路正确（§8.1 L202 实测要求）；cause 字面量在闭集合内（§23.3 L780 实测含 bootstrap-timeout）；timeoutMs 取实际到期上限 assemblyTimeoutMs 与 §23.3 括号枚举（open/bootstrap/reconcileTimeoutMs）存在**措辞级张力**——见 §14 观察 3（非阻塞：缺省配置下 bootstrap timer 10s 先于 assembly 30s 触发，该分支为防御性收口） | 无（建议 §15 复查焦点补录该读法） |
| E6 | 双端重启/断线/GOWAY 期 partial | D11 + clearInboundAssembly 全出口 | 已覆盖 | 无 |

---

## 9. 契约影响审查

| API or contract | Missing or weak caller handling | Evidence | Required revision |
|---|---|---|---|
| `NAMESPACE_ERRORS` 注册表消费（encode/decode/terminalStateOf/fuzz/golden） | 无——DENY 面测试零注册表枚举依赖；ALLOW 面同步完整（errors.ts 注释 ×3 + fixtures + issue242 计数）；fixtures 表为 `Record<string,…>`（非类型强制），同步由 codec-registries L109 键集等价断言 fail-loud 兜底 | 本轮全库 grep 实测 | 无 |
| `NamespaceErrorCode` 联合扩宽 | 无 exhaustive 消费者（唯一值级消费 types.ts L277 联合成员） | grep 实测 | 无 |
| `UpdateChannel.onAck` / channel host seam | M3 扩展条件 + `hasBulkTransferWork()` 只读判据已列 §10 双行；无 bulk 工作时逐字节同义论证成立 | update-channel L215 实测 | 无 |
| `applyRemoteUpdate` 第 5 参判别联合 | §10 行已补（双侧签名 + 发射门控 + degraded 先行保持）；单帧/kind=0/else 逐字节不变论证成立 | peer L1383–1389/L1466–1490、hub L1226+ 实测 | 无 |
| resync 边沿挂点（双侧三族） | §10 行已补（加法式：同点追加 `abortForResyncDeclared()`） | C19 实测 | 无 |
| `sendUpdateChunk`（两 connection）/ UPDATE_CHUNK 分发 | 类型面透传，零行为改动（iteration 0 已核实分发形态） | C5/C6 | 无 |
| 间接调用方（plugin/apps/其它包） | `BulkTransferSender` 包内私有不经 index 导出；公共面零变化 | §10 末行 | 无 |

---

## 10. 架构一致性与惯例审查

### 责任归属

| Behavior | Expected owner | Design location | Assessment |
|---|---|---|---|
| kind=1/2 发送端载体 | 命名空间通道域，经宿主 seam | D1（BulkTransferSender 同域构造/持有） | ✓ AGENTS 边界保持（transport 不直入 Runtime/Persistence/live Y.Doc） |
| 错误族映射单点 | 控制器（assembler 纯字节重组） | D5 族中性符号原因 + 控制器映射 | ✓ |
| transferId 分配 | 既有计数器唯一载体 | D2（包内 allocateTransferId；teardown 归 1 单点） | ✓ 不设第二计数器（R42） |
| 注册表首登 | codec errors.ts（协议 §13.2 的字节层实现） | D12（append-only 四行 + 联合 + 注释/测试同步） | ✓ 与 #242 先例同款纪律；AGENTS L11 明文允许 |

### 相似能力对照

| Similar capability | Existing implementation | Proposed design | Consistent or divergent | Reason |
|---|---|---|---|---|
| kind=0 分块发送端 | `UpdateChannel` | 新 `BulkTransferSender`（不复用队列/窗口/ACK 记账） | 有据偏离（iteration 0 已裁定接受；r1 维持） | 结算帧/溢出语义/ackTimer 归属不同构；同时复用计数器、几何纯函数、wheel/RR、data 闸门、shed 账本、sendUpdateChunk 出站点 |
| 接收端 assembler | 单实例 per (ns,方向) | kind 泛化 | 一致 | 「每 (ns,方向) 至多 1 assembly」冻结保持 |
| 出站被拒处置 | #243 send-failed 族（sendOneChunk） | M5 镜像该族 | 一致 | 同款采样/弃置/声明序（C18 实测） |
| resync 边沿中止 | channel 三族挂点 | M2 同点追加 bulk abort | 一致 | 同一边沿挂点（C19 实测） |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| 错误码注册 | errors.ts 注册表（§13.2 字节层） | fixtures 镜像表 | 低（键集等价断言 fail-loud；无第三镜像） |
| observer 归零判定 | §23.3 冻结矩阵 | D3 syncChunked 门 | 无（声明与机制一致，M1 闭合） |
| 切片几何 / transferId | update-transfer 纯函数 / channel 计数器 | 两发送器共用 | 无 |

### 生命周期对称性

| Start or acquire | Stop or release | Failure recovery | Assessment |
|---|---|---|---|
| enqueue/armed timers | teardown 三点 + shed + epoch fence + round 终止 | abort 面（含 M2 三族 + M5） | ✓ 对称（r1 补齐 resync-declared 与出站被拒后的 timer 拆除） |
| 连接级 assembly 槽 | endAssemblyScope 单点（kind 无关） | 违例/超时/清理全出口 | ✓ 零改动 |

### 平行机制检查

| Candidate duplicate | Existing path | Proposed path | Disposition |
|---|---|---|---|
| 第二调度器 / cleanup / 错误发射点 | wheel / clearInboundAssembly / sendNsError+finalize | 复用 | 无平行 ✓ |
| 第二 ACK 记账 | channel.inFlight | bulk 自持 awaiting-ack | 有据（结算帧不同；iteration 0 已裁定） |
| 第二唤醒机制 | onAck→requestDataDrain | 条件扩展（非新机制） | ✓ 最小实现（M3 备选 4 明确拒绝自建监听/轮询） |

---

## 11. 文件范围审查

| Path or scope issue | Evidence | Required revision |
|---|---|---|
| `packages/replication-protocol/src/errors.ts` 入 ALLOW（B1） | 注册表 22 条无四码（实测）；协议 §13.2 L445–448 已登记 | 无——append-only 四行 + 联合 + 计数注释，理由充分（先例 #242 + AGENTS 明文） |
| `fixtures.ts` / `codec-issue242-ac-red.test.ts` 入 ALLOW（D12 同步面） | L535 表 / L462 计数实测；codec-registries L109 键集等价要求同步 | 无 |
| `test/driver.ts` 入 ALLOW（M4） | BootOptions 无 chunkedUpdate（实测）；条件展开惯用法同构 | 无——undefined 零传，其余测试零影响 |
| 新增 bulk-edge 探针文件入 ALLOW | M2/M3/M5 契约外机制探针 | 无（建议补 M1 符合性探针，见 §14 观察 2） |
| DENY：契约测试/刻画文件+issue137-driver/codec 形态面/其余包/ADR/CONTEXT/apps | 与冻结面一致；issue299/golden 零注册表引用（实测，D12 不使其红） | 无 |
| follow-up（#301/N6/SA6 回执） | 未掩盖本票必要项（B1/M1–M5 全在本票闭合，§13 显式裁定） | 无 |

---

## 12. 验收设计审查

| Requirement or risk | Proposed evidence | Gap | Required revision |
|---|---|---|---|
| AC1–AC3（R1/R2/R2b/R3 + N1–N4） | SA6 契约零修改 + 全包回归 | 无（M3 构型探针补契约外活性） | 无 |
| AC4（R4/R5/R6/R7） | 契约转绿 + D12 codec 套件（计数 26 + 四码断言 + 往返） | 无——发射面前置闭合 | 无 |
| 场景 14 改写 | §11 三要素（协商/构型/断言） | 无（M4 闭合；现断言面实测可改写） | 无 |
| M1 observer 归零 | §11 探针行（载体可并入 bulk-edge 或 #301） | 轻微：载体未钉死（§14 观察 2，非阻塞——SA6 契约本身零 observer 断言，R46 显式推迟至 #301） | 建议性 |
| M2/M3/M5 机制探针 | bulk-edge 探针文件三条 | 无 | 无 |
| kind=0 逐字节等价 | N4 + #243–#246 回归 + M3 等价论证 | 无 | 无 |
| 文档同步（§22 L701 + 场景 14 + `git diff --check` + 术语扫描） | §11 行 + ALLOW | 无（L701 现措辞实测在案） | 无 |
| 全量门 | SA6 §13 命令集 + replication-protocol 套件 | 无 | 无 |

---

## 13. Required revisions

无。iteration 0 的 SA2-B1、SA2-M1–SA2-M5 全部落实并经本轮源码独立复核（逐条证据见 §2/§7/§8）；无新增 BLOCKER/MAJOR。

## 14. Non-blocking observations

1. **`packages/ws-replication/src/types.ts` L275 既有过期计数注释**：`ReplicationObserverNamespaceCode` 注释称「协议 §13.2 注册表全 20 码」，基线实际 22、D12 后 26——**基线即已漂移**（非 D12 引入；该文件在 DENY）。建议设计注记其为既有漂移、显式排除出本票（或经 SA3 以一行注释同步并入 D12 同步面），避免 SA7/SA8 复审误判为 D12 造成；不改不影响正确性（联合经 codec 同源 import 自动扩宽）。
2. **M1 符合性探针载体建议钉死**：§11 M1 行「可并入 bulk-edge 探针文件或 #301 动态面」与 §12 探针文件「M2/M3/M5 三条」存在轻微松动。建议并入 bulk-edge 文件第四条（kind=2 分块完成点 observer 在场 → 零普通族 `sync-diff-applied`；单帧 Step2 对照 → 发射不变），使 §23.3 第 33 型符合性在本票即可执行验证——SA6 契约零 observer 断言（R46），无它则该冻结面在 #301 前不可测。
3. **D9 kind=1 收口的 `timeoutMs` 读法**：cause `bootstrap-timeout` ∈ §23.3 L780 闭集合 ✓，但该行括号枚举的 timer 族上限为 open/bootstrap/reconcileTimeoutMs，设计传 `assemblyTimeoutMs`（实际到期的配置上限）。缺省配置下该分支为防御性收口（bootstrap 10s 先于 assembly 30s）。建议把该读法补入 §15 复查焦点清单（现 7 项未含）。
4. **SA6 §8/§11「四码已注册」事实错误的回执**（iteration 0 非阻塞 #6 的延续）：设计已按 C14 真实状态承接且不依赖回执；更正仍需 SA6/总控确认落档，避免后续切片再次引用该前提。
5. **正面核实记录（r1 增补，供 SA3/SA4/SA7 复用）**：C14–C21 全部准确（注册表 22 条/三处计数注释、fail-closed encode/decode、isStep2 无条件发射序、onAck 门、#243 采样序、三族 resync 挂点、键集等价断言、issue242 计数用例、peer 单旋钮协商 + driver 缺面）；DENY 面测试零注册表枚举依赖（D12 不产生隐藏红灯）；`NamespaceErrorCode` 扩宽无 exhaustive 消费者；§23.3 L780 cause 闭集合含 `send-failed`/`bootstrap-timeout`；§10.3 L333 中止面冻结文本与 M2 接线同源。

---

## Verdict

**approve。** r1 设计对 iteration 0 全部阻断 finding 的修订均为可实施机制且经源码独立复核成立；SA6 契约、SA8 约束（R42–R47/N6/Frozen surfaces）、ADR 0019、协议冻结文本与 append-only 范围逐条符合；文件范围 ALLOW/DENY 与正文改造点一一对应。`requiresConflictRecheck: true`（维持设计 §15 自报：D12 触碰 codec 注册表面、M5 入口面读法、R5 终态裁定、场景 14 改写等需设计后 ADR 冲突复查确认）。残余 4 条非阻塞观察不构成实现前义务。
