# SA8 冲突门禁报告 — issue #301 设计复查（design conflict report）

- **Reviewed subject**: design（`wiki/raw/task_issue-301_design.md`，SA1 iteration 0）
- **Dispatch**: sa-8d2937f7-6a21-4a2f-86b4-b29366fa6b8c（mabf-sa8 / conflict-gate / iteration 0）
- **复审触发**: 设计 §15 显式提交 `requiresConflictRecheck: true`（公共 API 类型联合加性变更 + 两处冻结文本解释决策 + 本 iteration SA8 前置门禁缺失）
- **基线**: `0f3eca5`（与设计声明一致；`git status` 仅含本票 4 个未跟踪任务文件，决策文档零改动）

---

## 1. Inputs and decision set

| 输入 | 状态 | 说明 |
|---|---|---|
| `wiki/raw/task_issue-301_design.md` | 被审对象 | SA1 设计（OD1–OD9、ALLOW/DENY、§15 复查请求） |
| `wiki/raw/task_issue-301_sa6_contract.md` | 上游验收契约 | **approve**；8 红 R1–R8 + 9 负控 N1–N9；§12.3 四条解释边界 |
| `wiki/raw/task_issue-301_sa2_review.md` | **不存在** | 设计 §14 已如实登记；全维度攻击评审仍属 SA2，本报告不替代 |
| `wiki/raw/task_issue-301_conflict_report.md` / `_relevant_decisions.md` | **不存在** | 前置门禁缺失（设计 §4/SA6 §15 一致登记）；本报告为首个 SA8 产物 |
| Owner comments | 空 | 任务简报 §Comments 与 SA6 §2 一致——无 owner override 来源 |
| `docs/adr/0019-chunked-sync-transfer.md` | **已接受**（issue #295 设计冻结） | L72–83 Observer seam 8 型登记；L70 超时两向收口；非目标条款（同版本部署、无互通矩阵） |
| `docs/adr/0013-chunked-live-update-transfer.md` | 已接受（被 0019 **扩展**而非取代） | ACK durability、assembly 易失、observer 纪律沿用源；kind=0 分块先例（sent/applied/acked/aborted 四型） |
| `docs/adr/0010-hub-peer-websocket-ydoc-replication.md` | 已接受 | 基线架构；observer seam 注册源（§23 头部引用）；本设计不触碰其条款 |
| 其余 ADR（0001–0018） | 已接受，均不在本设计触碰面 | 无 superseded ADR 构成约束 |
| `docs/protocols/instance-replication-v1.md` | **规范权威**（wire 冻结值唯一权威） | §23.1 第 29–36 型行（L749–754、L783–784）、§23.3 safe-field、§23.4 隔离/时钟、§23.7 conformance、§8.1/§9.2/§9.4/§10.3/§13.2/§17/§18 |
| `CONTEXT.md` | 领域词汇 | 「分块复制传输」「UPDATE_CHUNK」「同版本部署假设」词条——均不枚举事件型（事件词汇权威在协议 §23.1，已登记） |
| `packages/ws-replication/AGENTS.md`、`docs/AGENTS.md` | 模块/文档契约 | observer 隔离、seam 注入、FSM 不变量；docs 权威分层（protocols 规范、wiki/raw 仅证据） |

源码仅用于确认当前事实（类型联合止于 28 型、slice 2 deferral 注释、发射点结构锚），不构成决策依据。

---

## 2. Decision analysis

| # | Decision | Clause | Subject behavior（设计行为） | Classification | Evidence | Required action |
|---|---|---|---|---|---|---|
| D1 | ADR 0019 L78–81；协议 §23.1 L749–754/L783–784 | 8 型字段集逐字冻结（sent：`connectionId?/namespaceId/transferId/chunkCount/totalBytes`（sync 另携 `syncRoundId`）；applied：`+bytes/chunkCount/applyLatencyMs?`（sync 另携 `syncRoundId`）；acked：`+bytes/ackLatencyMs?`；aborted：`namespaceId/transferId/reason/receivedChunks/receivedBytes`（无 connectionId）） | OD1 追加第 29–36 型判别成员——字段名/可选性/键集排除逐字对齐冻结行；side 信封：snapshot 成功三型字面量 hub/peer/hub、aborted 与 sync 四型 `ReplicationObserverSide`——与 §23.1 各行 side 列逐一相符 | **implements-existing-decision** | 逐行比对 §23.1 L749（29 型 hub）、L750（30 型 peer）、L751（31 型 hub）、L752–754（32–34 型 hub/peer）、L783–784（35/36 型 hub/peer）；键集冻结条款（sent 恒无 latency、applied 无 transferId/sequence/效果组、sync-acked 无 sequence/syncRoundId、aborted 无 connectionId）与 OD1 文本一致；`ChunkedUpdateAbortReason` 复用零新词（types.ts L397 现存六值闭集 = §23.1 L782 词表） | 无（实现后由 R6 exact-keyset 与 api 型镜像核对） |
| D2 | ADR 0019 L72–74（append-only，对齐 §23 纪律）；协议 §23 头部 L714–715（Seam 追加式、GA 后字段语义冻结） | 公共导出类型联合加性变更 | `ReplicationObserverEvent`（index.ts L59 已导出）追加 8 判别成员——非穷尽 switch 消费者零破坏；穷尽镜像仅 `ws-replication-api.test-d.ts`（L240 起 `toEqualTypeOf` 全联合精确断言，标题「26 型」已滞后两型） | **implements-existing-decision** | §23 L714–715「事件类型、reason/cause/via 词表、稳定码表只增不改」；append-only 纪律允许加性成员；OD9-1 同步镜像为既有 build gate 的义务性后果 | 无（`pnpm typecheck` 自带防漂移，设计 §13-3 已登记流程顺序风险） |
| D3 | 协议 §23.1 L746/749/752（sent 语义） | sent = transfer 完成出站恰一（末 chunk 结算记账点），非逐 chunk、非起始发射 | OD2：`onLastChunkSent` 结算记录扩展（`BulkTransferOutboundSettlement`），三调用点发射——发射点名字不变、`pullOne` 末 chunk 分支同一同步栈；拒绝逐 chunk / 起始发射备选 | **implements-existing-decision** | §23.1 L746（kind=0 先例「完成出站时恰一（末 chunk 结算记账点），非逐 chunk」）逐字平移至 L749/752；bulk-transfer.ts L50/L188–193 现存结构锚（`state.phase='awaiting-ack'; state.request.onLastChunkSent(seq)` 同一转移）；签名加宽为包内私有（bulk-transfer.ts 不经 index.ts——已核实） | 无 |
| D4 | 协议 §23.1 L748/751/754（acked 语义）；§10.3 L331（ACK 计时锚 = 末 chunk 出站时刻） | acked = 末 chunk 帧序的单 ACK 收妥结算恰一；zombie 迟到 ACK 零事件；单帧路径无对应事件 | OD3：`settle(kind)` 返回结算记录（awaiting-ack 真实结算 ⇔ 返回记录；否则 undefined → 零事件）；t0 = 末 chunk 出站采样、t1 = ACK 处理时刻，差值注入时钟域 | **implements-existing-decision** | §23.1 L748（「ACK timeout 弃置后 zombie 迟到 ACK 零事件」）、L751/754（「普通族无对应事件——本型为分块路径独有观测点」）；bulk-transfer.ts L197–201（`settle(kind): void` 现状 = 返回 undefined 的结构基础）；`ackLatencyMs` 语义 = §23.4 L920（收 ACK 时刻 − 帧实际出队时刻）平移 | 无 |
| D5 | 协议 §23.1 L783（35 型终局失败族条款）；§18 L628（assemblyTimeoutMs 按 kind 收口：snapshot → BOOTSTRAP_FAILED 语义族 terminal failed）；§8.1 L202 | **解释决策①（OD7）**：kind=1 停滞超时零 aborted | `clearInboundAssembly(kind === 1 ? undefined : 'timeout')`——kind=1 超时收口即 BOOTSTRAP_FAILED 族终局 ⇒ 零 aborted；kind=0/2 非终态 ⇒ aborted{timeout} 照发 | **no-conflict** | 冻结文本直接支持而非仅容许：§18 明文「snapshot → 弃 partial + namespace 收口对齐 `BOOTSTRAP_FAILED` 语义族（terminal failed）」，§23.1 L783 明文「终局失败族不发本事件（`SNAPSHOT_TRANSFER_*`/`BOOTSTRAP_FAILED` 族的可观测信号 = `namespace-error`/`namespace-failed`）」——超时收口**就是**该族终局 ⇒ 零 aborted 是唯一相容读法；kind=0/2 对照：§18/§9.2/§9.4 超时 = 非终态 RESYNC 族 + §23.1 L782 接线行含 timeout；hub `onAssemblyTimeout` 现行为（kind=1 → `sendNsError('BOOTSTRAP_FAILED')` + `finalize('failed','bootstrap-timeout',...)`）已核实一致；SA6 §12.3-1 同读法且契约不锁计数 | 无（单点可逆已登记；SA7 动态面可加计数断言） |
| D6 | 协议 §9.3 L255（违例 SYNC_APPLIED = `SYNC_STATE_VIOLATION`）；§23.4 L900–902（决策落定后发射）；§23.1 L748（收妥结算语义） | **解释决策②（OD3 quiet 门）**：round 校验失败（被拒 ACK）时载体仍 settle 释放但零 acked | `onSyncApplied`：`round.onApplied(message)` 违例（→ `onViolation` → failed 终局）后不发射；载体释放行为不变 | **no-conflict** | 被拒/违例 SYNC_APPLIED 按规范即协议违例非「收妥」；kind=0 先例已核实：hub `onUpdateAck`（L1028–1035）quiet 门 + `ACK_STATE_VIOLATION` → connectionFatal 先于发射 return——violated settlement 零事件为既有裁决；与「与 aborted 互斥」不变量无张力（该路径无中止边沿） | 无（契约不覆盖该组合已由设计 §13-2 登记，SA7 动态面探测） |
| D7 | 协议 §23.1 L750/L753 + L787–796（apply 成功路径互斥规则六选一、degraded 先行 R23）；L746–748（R21 改道条款） | 接收侧第五/第六形态：分块窗口普通族 `sync-diff-applied`/`bootstrap-imported` 归零、新族在既有抑制点原位发射；单帧路径逐字节不变 | OD4/OD5：`{syncChunked:true, chunkCount}` 形态扩展 + 改道发射；`finishBootstrapImport` form 参数化（`'single'` 行为不变）；chunkCount 穿线（现 `complete.chunkCount` 在双侧调用点被丢弃——已核实 hub L942/peer L906）；peer degraded 判别先行胜出保持 | **implements-existing-decision** | §23.1 L787–796「六选一」+「degraded 判别先于 chunked 判别胜出（R23）」+ 第 29–34 型「改道」子句；slice 2 抑制点已在位（hub L1446–1458 / peer L1728–1741 `syncChunked` 抑制分支——源码核实）；N6 单帧锚 = 抑制分支的 else 路径不动；效果组捕获跳过（OD4-4）与第 33 型键集排除（无效果组键）一致且单帧路径捕获保留 | 无 |
| D8 | 协议 §23.1 L783–784（aborted 纪律与 `chunked-update-aborted` 逐字同构）；L782（六 reason 接线行、busy 守卫恰一、last-writer-wins、终局失败族不发） | **解释决策③（OD6）**：`clearInboundAssembly` kind 门泛化（busyKind → 事件型三选路），全部 reason 置位点零改动自动接线 | hub L995–1016 / peer L955–978 泛化；hub 侧 `chunked-snapshot-aborted` 结构性不可达（hub 无 kind=1 入站合法上下文——admission 即拒）但类型保留双侧 | **implements-existing-decision** | 源码 deferral 注释明文登记（hub L993–994 / peer L953–954「kind=1/2 分块中止的对应事件类型归 #301，本切片零发射」）——本票兑付已登记义务；busy 守卫恰一不变量原样继承（现有 `busyKind === 0` 门结构同构）；GOAWAY 无独立 reason 归 connection-teardown 行（L782）与 R8/SA6 §12.3-3 一致；side 双侧 = L783 行 side 列「hub/peer」 | 无 |
| D9 | 协议 §23.3（safe-field 清单 + 禁止项）；§23.4 L896–928（throw 隔离、决策落定后发射、无 observer 等价、clock 缺省整键缺失、clock-throw 折叠、绝对时间戳禁入）；ADR 0019 L83 | 纪律面：全部发射经 `emitObserver` → `dispatchReplicationObserver` 单点；latency 两态条件展开；新字段全集落入 §23.3 允许类别 | OD8：safe-field（稳定字面量 + `cidField` 受控标识 + 有限数值；`syncRoundId` 属 issue #239 已登记 uint32 投影类别）；无 observer = 零事件构造/零时钟调用（`host.now` 连接层 observer 门控——§23.4 L912–914 已登记该门） | **implements-existing-decision** | observer.ts L36 `dispatchReplicationObserver`（try/catch 静默单点，无 per-type 白名单——issue #287 域分离）、L113 `cidField` 已核实；R6/R7/N7 契约锚对应 §23.7 L991–999 通用纪律 + issue #245 L1054–1064 chunked 族两态先例 | 无 |
| D10 | 协议 §22（Conformance tests 资产锚惯例，L699–701 每票登记验收资产）；docs/AGENTS.md（行为变化时更新受影响规范文档；protocols 为规范权威） | OD9-2：`docs/protocols/instance-replication-v1.md` 仅 §22 补记本票契约测试资产锚一句；§23.1/§23.3/§23.4 冻结文本零改动 | 规范文档的**登记性**加法，非契约语义变更 | **implements-existing-decision** | §22 L699–701 既有模式（issue #242/#246/#295/#300 各票资产锚登记）；事件词汇第 29–36 型已在冻结文本登记（L717 头注），无需也不得改 §23.1；与「wire 冻结值以协议文档为唯一权威」边界一致 | 无 |
| D11 | ADR 0019 非目标 L107（新旧互通矩阵显式放弃）；CONTEXT「同版本部署假设」词条；issue body「新旧互通矩阵不在本票范围」 | 设计非目标：零互通面、零 capability bit、零协商 | §1 非目标明文对齐；DENY 锁 `packages/replication-protocol/**` 与配置链 | **no-conflict** | 三处来源（ADR/CONTEXT/issue）同向；AC 面零互通断言（SA6 §15） | 无 |
| D12 | ADR 0019 L45–70（ACK/发送/接收/记账、超时两向、资源上限——slice 2 已交付面）；协议 §8.1/§9.2/§10.3/§13.2/§17/§18 | 设计零生命周期/调度/恶意声明面实现改动；N1–N9 负控保持绿为回归门 | §1 非目标「零 wire 变化」；§12 验证映射只锁负控转绿保持 | **no-conflict** | SA6 §6/§13（N1–N9 当前即绿、全包 499 用例零回归基线实测）；设计 ALLOW LIST 七文件不含任何 wire/配置/状态机文件 | 无 |
| D13 | `packages/ws-replication/AGENTS.md`（observer/adapter 失败遵循文档化隔离与关闭分类；FSM 不变量；公共导出面经 index.ts） | 设计只动观测发射点，状态机零变化（§8.1「BulkTransferSender/namespace/round/assembly 状态机全部不动」）；零新导出符号 | 包内私有签名加宽（bulk-transfer/round-engine/applyRemoteUpdate/finishBootstrapImport）不经 index.ts | **no-conflict** | index.ts 核实无 BulkTransfer 导出；FSM 转移零新增（只在既有结算点追加发射） | 无 |
| D14 | 协议 §23.7 L1042–1053（issue #245 矩阵纪律：白名单行不得为死行；扩场景须同步扩 `ALLOWED_KEYS`） | 设计论证 observer-red 矩阵零新事件：assertSafe 场景不进入 chunked snapshot/sync 窗口，无需扩白名单；DENY 锁该文件 | §13-6 论证 + DENY「共享锚文件防顺手改」 | **no-conflict** | **已核实**：`assertSafe` 仅两处调用（T9 matrix L1404 / sentinel L1541）；matrix 用 `observedBoot({chunked:{}})` ——chunked 选项只压 `maxUpdateBytes`（缺省 8KiB，kind=0 协商腿），`maxBootstrapBytes`/`maxSyncDiffBytes` 保持包缺省 4MiB/2MiB；sentinel 无 limits——两场景 8 型不可达；T5 背压场景虽压 512B 三限但**不调用 assertSafe** 且其锚按 type 过滤——不受新事件影响（设计措辞「该文件分块腿」限定 assertSafe/chunked 腿场景，准确） | 无（若未来该文件构造超限 snapshot/diff 场景，须同步扩 ALLOWED_KEYS——设计 §13-6 已作 follow-up 登记，非本票义务） |

**裁决分布**：implements-existing-decision × 8（D1/D2/D3/D4/D7/D8/D9/D10）；no-conflict × 6（D5/D6/D11/D12/D13/D14）；evolution-required × 0；hard-conflict × 0。

---

## 3. Overrides

| Old decision | Override authority | Scope | New obligation |
|---|---|---|---|

（空——无需任何 override。8 型字段集、改道纪律、超时两向收口、aborted 词表全部为 ADR 0019/协议 §23.1 **已登记冻结值**，本设计是接线不是决策演进；Owner comments 为空，不存在 Owner 覆盖；设计自身也未主张任何 override。）

---

## 4. Frozen surfaces

| Surface | Must remain unchanged | Evidence | Actual result |
|---|---|---|---|
| Wire 面 | 0x42 codec/字段序/消息码、§13.1/§13.2 错误码注册表、§9.4 RESYNC reason 词表、§17 配置键与校验链 | ADR 0019 L20–37/L66–69；协议 §5/§10.3/§13 | **符合**：设计 §1 非目标明文零 wire 变化；DENY 锁 `replication-protocol/**`、`defaults/validate/backpressure/frame-io` 等；ALLOW 七文件全在观测面 |
| §23.1 第 29–36 型字段集/side 信封/键集排除 | 逐字冻结（GA 后字段语义冻结） | 协议 §23 头 L714–715 + L749–754/L783–784 | **符合**：OD1 逐字对齐（本报告 D1 逐行核对）；零新字段、零新词表值 |
| §23.3/§23.4 纪律文本 | 规范文本零改动 | 设计 OD9-2 显式承诺 + ALLOW 范围仅 §22 一句 | **符合** |
| CONTEXT.md「分块复制传输」词条 | 不枚举事件型（事件词汇权威在 §23.1） | CONTEXT L153–155（词条内容已核实无事件型） | **符合**：DENY 锁 CONTEXT.md；无新领域词引入（8 型事件名 = 协议词汇，非 CONTEXT 术语） |
| ADR 0019/0013 文本 | 冻结决策文本 | 设计 DENY「本票是接线不是决策修订；ADR 面零触碰」 | **符合**：git status 无决策文档改动 |
| kind=0 chunked 族 + 单帧普通族发射 | 逐字节不变（N6/N7 锚、R47/R21 遗产） | 协议 §23.1 L746–748；设计 §5.1/§5.2 现状锚 | **符合**：单帧路径分支（`chunked === undefined` else 腿）不动；kind=0 面文件（update-channel/update-transfer）在 DENY |
| Observer 分发单点/无 per-type 白名单 | `observer.ts` 零改动（issue #287 域分离） | observer.ts L36–46 已核实；设计 DENY | **符合** |
| 验收契约与回归锚 | 契约文件 + issue300/299/244/245/246/239/233 等既有测试零改动 | SA6 §16 冻结；设计 DENY | **符合**（git status 核实契约文件未再改动） |
| 状态机/生命周期/失败语义 | FSM 转移、终局规则、RESYNC/BOOTSTRAP_FAILED 收口零变化 | ADR 0019 L70；协议 §16/§18；设计 §8.1/§9.2 | **符合**：OD3 quiet 门只影响事件发射（载体 settle 释放行为不变）；OD7 只影响 reason 实参（kind=1 终局收口不变）——均非失败语义演进 |

---

## 5. Evolution requirements

无 `evolution-required` 项。本设计不改任何 ADR/CONTEXT/协议契约语义：

- 唯一的规范文档改动（§22 资产锚一句）属 §22 既有登记惯例的兑付（D10），非契约修订——无需修订计划；
- 公共 API 联合加性变更在 §23 append-only 纪律的显式允许面内（D2）；
- 两处冻结文本解释决策（OD7/OD3）经本报告裁定为冻结文本的**直接相容读法**（D5/D6），不构成语义偏移，无需条款化——SA6 §12.3 已作「不进断言」的边界登记，冻结文本无需为此改写。

---

## 6. Hard conflicts

无。全部对照项落在 no-conflict / implements-existing-decision。

---

## 7. Required actions

1. **实现期核对（非阻塞）**：OD1 字段集/api 型镜像（`toEqualTypeOf` 精确断言）与 OD9-1 同步落地——typecheck 门自带防漂移；
2. **实现期核对（非阻塞）**：OD3 quiet 门（被拒 ACK 零 acked）与 OD7（kind=1 超时零 aborted）按本报告 D5/D6 裁决读法实现；SA7 动态验证面可补 shed/epoch-fence/GOAWAY 行、side 双侧覆盖与被拒 ACK 组合的计数断言（§23.1 L782「动态断言归 SA7」既有归口）；
3. **实现后复查（implementation 复查触发条件已满足其一）**：设计显式登记公共 API 类型联合加性变更——实现落地后按 skill「implementation 复查」核对本报告 §4 Frozen surfaces 逐项 vs 实际 diff（尤其：单帧路径逐字节不变、`observer.ts`/`index.ts` 零改动、ALLOW 七文件边界、§22 仅加一句且 §23.x 零改动）；
4. 无需 Owner 裁决事项：两处解释决策均有冻结文本直接支持（D5/D6），不上升 Owner。

---

## 8. Verdict

**clear**

- 全部 14 项对照 = no-conflict（6）或 implements-existing-decision（8）；零 evolution-required、零 hard-conflict、零所需 override；
- 设计对缺失的前置 SA8 产物处置得当（§4 以 ADR 0019 + 协议冻结文本 + 源码 deferral 注释显式登记约束，且如实标注复查需求而非伪造门禁产物）；
- 三处自标解释决策（§13-1 OD7、§13-2 OD3、§13-5 epoch-fence last-writer-wins）均经冻结文本核实为直接相容读法（D5/D6/D8）；
- SA6 契约 §12.3 四条解释边界与设计读法逐条一致，无张力。

## 9. requiresConflictRecheck

**true**。理由（skill 规则：公共 API 尚待实现核对时为 true）：

1. `ReplicationObserverEvent` 公共导出联合 +8 成员尚未落地——实现后需核对类型面逐字一致、api 型镜像同步、穷尽消费者零破坏；
2. ALLOW 七文件的实际 diff 需逐项对照本报告 §4 Frozen surfaces（单帧路径逐字节不变、DENY 面零触碰、§22 加法限定）；
3. OD7/OD3 两处读法的行为面（零 aborted / 零 acked 的实际计数）待实现 + SA7 动态验证闭合。

本报告闭合**设计后复查**；**实现后复查**按 Required action 3 在实现落地时另行运行（输出 `task_issue-301_implementation_conflict_report.md`）。

---

*SA8 只读裁决：本报告为唯一产出；未修改任何被审对象、决策文档、代码或测试；未运行测试；未派发其他 SA。*
