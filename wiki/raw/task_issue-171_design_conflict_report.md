# 冲突门禁报告 — issue #171（设计后复审，R1 最终版）

- 被审对象：`wiki/raw/task_issue-171_design.md`（SA1 设计 **R1**：SA2 reject 后修订版，773 行；8 个攻击点全部实质落实，修订记录见设计文末「SA2 反馈逐条回应（R1）」）
- 修订链：R0 设计 → SA2 攻击评审 `task_issue-171_sa2_review.md`（reject：2 CRITICAL + 2 MAJOR + 4 MINOR）→ R1 修订（#1 排队前捕获 / #2 删 CLOSE_OK 例外分支 / #3 身份守卫 / #4 GOAWAY 两层 / #5 取得后中止判别 / #6 waiter 裁决 (a) / #7 吞错纪律 / #8 SYNC_APPLIED 对称放行）
- 冲突基准：`docs/adr/` 全集 10 份（逐个全文读取，无抽样）+ `CONTEXT.md`（全文读取）——与 R0 复审同批读取；R1 仅改设计文档，ADR/CONTEXT 基准文件零变化
- 复审方式：聚焦 R1 增量决策点逐条对照 ADR 原文；R0 已裁定的 12 项对照中不受 R1 影响者维持原判，受 R1 修订者重新对照（#2/#4/#5/#6/#7/#12）
- 产出：本报告（替代 R0 版）+ `task_issue-171_relevant_decisions.md`「设计后复审 R1 追加」节（8 项 R1 决策点 + 6 项新锚建议登记）
- Worktree：`/home/wangjian/nomicore-fix-issue-171`；run_id `issue-171-1788042048-447205`；round 1

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0010 | Hub/Peer WebSocket Y.Doc 复制与最终一致（含 #134/#133/#161 修订节） | accepted | 是（核心） | no-conflict：R1 条款全部落在 L90/L143/L147/L149/L151/L179 与 #161 修订节、#134 修订节既有决策面内。**R1 #2 删除了 R0 唯一的解释性放宽**（hub 发起 CLOSE 的 CLOSE_OK 接受例外）——SA2 证伪其「§5 either 方向」推导后，R1 改为 closing 期除「有值且匹配」外一律 `ACK_STATE_VIOLATION` fatal，与 L147「错误ACK关联关闭连接」的对齐由「主路径对齐+例外存疑」提升为**全量对齐**。R1 #4 两层分工把同步层收窄为「订阅静默」——恰是 #161 修订节「同步静默**订阅**先于异步 drain」的逐字对位（R0 的全量收帧静默是超集合规，R1 是精确合规）；处置留 deadline 与协议 §6.3「现有 namespace 到 deadline 前自然收口」一致。R1 #8 SYNC_APPLIED 放行保持 L149「双方Step2完成…以SYNC_APPLIED确认」既有语义。wire 层零新增错误码/零 payload 变更（DENY LIST 保持） |
| ADR-0009 | NamespaceRegistry、调用方租约与 Host 生命周期（含 #131/#134 修订节） | accepted | 是 | no-conflict：R1 #3 身份守卫（`this.session === claim.session`）是 L32「旧异步操作只能按 **entry identity**/generation 清理自己」的**字面落实**（identity 判据比 R0 的 epoch 判据更贴合条款原文）；判据健全性依据 #134 修订节 L245（session 终态释放槽位、再 open = 新 session 对象不复用）。R1 #1 排队前捕获封死「T2 执行期捕获错代资源」杀新代路径——L32 纪律的严格执行。「恰一次释放」仍以 L42 幂等 same-promise 兑付（重复排队的第二次处置经身份守卫短路 + 幂等双保险）。多 Lease 并存（D-H1/H1）与 idle 语义（L48/L54）零触碰 |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器（含 #93/#132 修订节） | accepted | 是 | no-conflict：已接纳槽无条件排空（L93/#134 修订节 L271）逐处保持——§D2/§D3 的 `drainPendingApplies()`、总则 6、§14#15；R1 轻量层 `clearAllTimers`/`quiesceSync` 均为连接域簿记，不取消已接纳 apply 槽；R1 #8 的 SYNC_APPLIED 放行与 UPDATE_ACK 同属「已接纳工作正常 ACK」方向（协议 §9.4 义务同族）。#93/#132 稳定码与 status 域零触碰 |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge 分层 | accepted（Runtime/open/read 条款已被 ADR-0008 取代） | 弱 | no-conflict：被取代条款不构成约束；保留有效条款（零写入、observer no-rollback）零接触（R1 改动仍全部在 ws-replication 层） |
| ADR-0006 | Cordis 持久化插件与 doc 三条目布局（含 #64/#79/#133 修订节） | accepted | 弱 | no-conflict：持久层零触碰（DENY LIST 保持）；lease/handle 引用计数（L32）仅作消费背景，R1 只调用既有幂等 release |
| ADR-0001 | VFSL 单一真相源 | accepted | 否 | no-conflict：零触及 |
| ADR-0002 | nomicore 重写定位、authority 出范围 | accepted | 否 | no-conflict：零触及 |
| ADR-0003 | 求值器与派生 schema | accepted | 否 | no-conflict：零交集 |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 否 | no-conflict：零交集 |
| ADR-0005 | 投影生成管线 | accepted | 否 | no-conflict：零交集 |

无整份 superseded 的 ADR；分条取代关系（0007←0008、0009 复合 key←0010、0006 创建语义←#64 修订节）均按「被取代条款不构成约束」处理，R1 未与任何被取代条款发生需要援引的冲突。

## 冲突点

（verdict 为 clear：下列为 R1 设计决策点 × ADR 条款的逐条对照记录，全部 no-conflict；**0 hard-violation / 0 evolution / 0 override-declared**。#1–#12 为 R0 已裁定的对照面经 R1 复核（#2/#4/#5/#6/#7/#12 因 R1 修订重新对照），#13–#15 为 R1 新增决策点对照）

| # | 严重度 | ADR 条款 | 被审对象设计决策 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | — | ADR-0010 L90「channel 关闭先关闭 session，再释放 Lease」；ADR-0009 L42「重复 release 返回 exact same Promise」；#134 修订节 L246「close()：幂等 same-promise……永不 reject」 | §D1 `runDisposal`：退捕获 unsubscribe → `session.close()` → `lease.release()`；R1 #7 各步局部吞错、幂等 same-promise 兑付恰一次 | no-conflict | 释放次序逐字保持；吞错纪律不改变释放语义（close/release 本身「永不 reject」，吞错仅防御实现偏差） |
| 2 | — | ADR-0009 L32「旧异步操作只能按 entry identity/generation 清理自己，不得删除后来建立的新 entry」 | §D1 **R1 #1 排队前捕获**（claim 于 caller 同步栈求值，封死「T1 挂 drain 期间 fatal 补排 T2 → gen2 建成后 T2 执行期捕获错代资源」路径）+ **R1 #3 身份守卫**（`this.session===claim.session` 判定字段清空/aux teardown；新代已建 session2 → 零触碰）+ §D2/§D3 捕获时点同步对齐 | no-conflict | R1 两项修订均为 L32 的**强化落实**：排队前捕获消灭执行期错代捕获；身份守卫是「按 entry identity 清理自己」的字面实现（比 R0 的 epoch 判据更贴合条款原文）；P3b 杀新代路径（§14#17）与「新代永不 open」泄漏面（§14#18）双覆盖 |
| 3 | — | ADR-0008 L93「此前已接纳任务无条件排空，不取消、不设内部 timeout」；ADR-0010 #134 修订节 L271 | 总则 6 + §D2/§D3 `drainPendingApplies()`；R1 轻量层 `clearAllTimers` 仅清 ns 级 timer，不动 apply 槽 | no-conflict | 三点注记 1 保持：中止迟到续体未外溢为取消已接纳任务 |
| 4 | — | ADR-0010 L147「gap、repeat或错误ACK关联关闭连接」；L165「framing、认证等连接级错误才关闭整条连接」 | **R1 #2 重写 §D4**：closing 期除「closeSequence 有值且匹配」外一切入站 CLOSE_OK（错配，或 closeSequence===undefined 即 hub 发起窗口——本端从未发出 CLOSE_NAMESPACE，帧按定义 unmatched）→ `connectionFatal('ACK_STATE_VIOLATION',1002)`；活跃态未请求同款 fatal；终态/disconnected 静默（迟到纪律，见补充核对） | no-conflict | **R1 相对 R0 的对齐提升**：R0 例外分支是唯一依赖「§5 注册表 either 方向」解释的放宽，SA2 证伪（Result 语义决定 CLOSE_OK 发送方恒为 CLOSE_NAMESPACE 接收方）后 R1 删除——L147 现为全量落实；该窗口收口结算由 §D2 续体承担，无 silent completion；新增锚 C4b（§13.4）同向 |
| 5 | — | ADR-0010 L147「GOAWAY提供相对drain timeout」；#161 修订节「GOAWAY/blocked/连接收口同步静默订阅先于异步 drain」 | **R1 #4 两层分工 §D6/§D5.1**：RESTARTING 收帧同步段轻量层 `onConnectionQuiesce`（摘订阅/清 timer/closing 结算/投影 disconnected，**零处置排队**）；deadline 回调全量层（处置排队）+ transport close(1001)；处置时点与现状逐点一致（D5 计面逐值不变，§13.2 重推）；SHUTTING_DOWN/REAUTH → `enterBlocked` 收帧即全量（现状不变） | no-conflict | #161 修订节措辞是「同步静默**订阅**先于异步 drain」——R1 把同步层精确限定为订阅静默（+timer/投影），异步层 = drain 处置与 transport，逐字对位（R0 全量收帧静默为超集合规，R1 收窄后仍合规且更精确）；L147 的 drain timeout 归属面不变；处置留 deadline 与协议 §6.3「现有 namespace 到 deadline 前自然收口」一致；G5 红灯锚（收帧段订阅已摘除 + 零 UPDATE）由轻量层兑付 |
| 6 | — | #161 修订节「peer pong 超时 close(1001) + 代际安全脱离后重连」；ADR-0010 L151「连接断开即close sessions/release Leases，不保留outbox；重连重新OPEN并reconcile」 | §D5.1 全分支 `clearAllTimers`+`quiesceSync`+投影+处置；§D5.2 新代 aux 重置、gen1 未发送队列丢弃；R1 后 drain 窗口内失联 → `onConnectionLost` 活跃分支排队处置（§9 明文） | no-conflict | 「代际安全脱离」全分支补全保持；不保留 outbox 纪律字面保持；两层化不改变失联路径处置义务 |
| 7 | — | ADR-0009 L30/L42/L54；#134 修订节 L245「同一 Runtime 被多 Lease 共享」 | D-H1（R1 保持）：authorize 成功后 registry.open 取得阶段完整执行+中止显式回收；H1 场景 gen1/gen2 lease 并存；**R1 #5 补齐取得后每个失败出口先判 `isOpenAborted()`**（中止 → `finishOpenSilently` 静默回收，不补发 ERROR） | no-conflict | registry.open 语义零改动（ADR 无条款规定续体中止时点）；R1 #5 是「迟到续体零 wire」（L151 恢复纪律家族）的行为面收紧，方向同向 |
| 8 | — | ADR-0010 L35「removeTarget 停止同步并释放复制 lease，但保留本地持久副本」；L179「不无限等待网络 ACK」 | §D3 seq≤0 本地收口立即结算（R1 #7 加 `.catch`） | no-conflict | 资源语义完整保持；等待时序属协议域且与 L179 同向收紧 |
| 9 | — | ADR-0010 L143「同一连接内同一 namespace只允许一个生命周期，关闭后重开必须重建连接」 | §D8.1 hub 通道静默态判定（`isOpenAborted`）；peer 侧新 session ⇒ 新连接代（身份守卫以 session 为代际载体判 aux 归属） | no-conflict | hub 通道 per-connection 结构与 L143 一致；peer「重开必须重建连接」⇒ 新 session 只能建于新连接 ⇒ 身份守卫判据与 L143 结构互相印证 |
| 10 | — | （无对应 ADR 条款——L173–174 只约束包职责面，不约束包内抽象归属） | §D9 生命周期权威归一 + 死抽象清除（R1 保持；新增内部方法 `onConnectionQuiesce`/`quiesceControllersLite` 均为包内非公共面，§16 已登记） | no-conflict | 包内抽象组织决策；行为边界（L90/L93/L151）保持；公共导出面零变更 |
| 11 | — | ADR-0010 L147（对照 #165 G4 旧行为） | §13.1 AC3b 翻转（R1 保持）+ **§13.4 新增锚 C4b**（hub 发起 closing 窗口错配 CLOSE_OK → fatal，不得 silent completion） | no-conflict | 被推翻的 #165 G4 旧行为从未进 ADR（#161 修订节八项不含）；翻转与新锚方向均与 L147 对齐 |
| 12 | — | CONTEXT 术语警示与硬性惯例（connection generation ≠ replication epoch；停接纳≠取消；网络状态不入 Runtime capability status） | §1 术语节（R1 保持）；CleanupClaim 删 epoch 字段后 peer 代际判别收敛为「session 身份 + §D2 局部 epoch 门（wire 副作用）」，全部留在 ws-replication 层 | no-conflict | 术语纪律全文遵守且 R1 后 epoch 使用面进一步收窄；三点边界注记逐条保持 |
| 13 | — | ADR-0010 L149「每个sync round由Peer以uint32 roundId发起，双方Step2完成sequenced apply + dirty后以SYNC_APPLIED确认」 | **R1 #8 对称放行 §D5.4**：drain 窗口（连接存活、epoch 未变）SYNC_APPLIED 照发（peer 既有 epoch 门零改动；hub 补 `isQuietState` 门）；初稿「消耗死连接出站序列」理由撤回（drain 窗口连接存活） | no-conflict | L149 的 round 确认语义保持（在途 round 收尾 ACK 是协议自身语义，非「新数据」）；与 UPDATE_ACK（§9.4 已接纳工作 ACK 义务）统一口径；hub 侧 isQuietState 门属「通道已静默迟到续体零 wire」（L151 家族） |
| 14 | — | #134 修订节 L245「`closed`（显式 close 或 Lease release 同步调用 `session.close()`）与 `conflicted`（epoch fence）皆终态并释放槽位；终态后同 Lease 可再 open（新 open 冻结新 epoch）」 | **R1 #3 身份守卫判据健全性**：session 对象一经终态不复用（再 open = 新 session 对象）⇒ `this.session===claim.session` 的「先不等后复等」不可达 | no-conflict | 判据的事实前提（session 不复用）直接由 L245 终态/槽位语义支撑——新 open 产生新 session 对象，identity 比较无假阳性面 |
| 15 | — | （无对应 ADR 条款——hub 侧 open waiters 应答义务属协议 §7 域，L151 指定协议文档为唯一 wire 权威） | **R1 #6 裁决 (a) §11.4**：startOpen 续体中止时 openWaiters 静默丢弃（零 wire 优先；peer 由 openTimeout→failed→重连后收 reopen 错误闭环；与现状一致非回归），登记 §13.3 不变式 | no-conflict | ADR 全集无条款约束 waiters 应答时序；设计明文登记裁决与恢复闭环，未推翻任何既有决策（现状行为保持） |

### 补充核对（不构成冲突的边界说明）

- **drain 窗口（disconnected）内入站错配 CLOSE_OK 静默忽略（§D7 表）**：该域连接已承诺关闭（deadline 强制 transport close 1001），「错误ACK关联关闭连接」（L147）的实效由 deadline 兜底兑付；迟到帧静默属协议 §13.4 迟到纪律（wire 权威在协议文档，非门禁基准）。C4 红灯契约的构造域为 closing（fatal 路径已覆盖），无锚冲突。
- **R1 轻量层在 drain 窗口投影 `disconnected` 但不处置 session/lease**：drain 窗口连接存活，不触发 L151「连接断开即 close/release」；处置由 deadline 全量层或失联点完成（§9 明文覆盖），AC2 零泄漏由身份守卫保证任意路径最终命中处置。
- **§13.2 D5 四检查点计面重推**：R1 把处置时点钉回与现状相同位置（deadline 回调），绿灯论证前提修正——属测试兼容性论证（SA2/SA6 域），无 ADR 冲突面。
- **§13.4 六项新锚（P3b/C4b/L1/W1/W2/W3）**：SA6 决策项；方向与 ADR-0010 L147/L151、ADR-0009 L32 一致，无 ADR 违反面。
- **R0 版报告中「hub 发起例外」相关补充核对条目已随 R1 #2 失效**，以本版对照 #4 为准。

## 结论

**Verdict：clear。放行。** 15 项对照全部 no-conflict，0 条冲突点：
0 hard-violation、0 evolution、0 override-declared。

R1 修订不仅未引入新的 ADR 冲突，而且**净提升**了与冲突基准的对齐度：

1. **R0 的唯一解释性放宽已被消除（对照 #4）**：`closeSequence===undefined` 接受例外分支删除后，ADR-0010 L147「错误ACK关联关闭连接」从主路径对齐升级为全量对齐——SA2 #2 的证伪结论（协议 §5 Result 语义）与 ADR 条款方向一致，R1 的 fatal 处置是协议 + ADR 双重对齐。
2. **generation 纪律双重强化（对照 #2/#14）**：R1 #1 排队前捕获 + R1 #3 身份守卫是 ADR-0009 L32「按 entry identity/generation 清理自己」的严格执行与字面落实；身份判据的事实前提（session 终态不复用）由 #134 修订节 L245 直接支撑。
3. **#161 修订节词汇的精确化对位（对照 #5）**：两层分工把同步层限定为「订阅静默」——与「同步静默**订阅**先于异步 drain」逐字对位；处置留 deadline 同时满足协议 §6.3「现有 namespace 到 deadline 前自然收口」的自然收口语义；G5 红灯锚不受影响。
4. **R0 已裁定的其余对照面（#1/#3/#8–#11）不受 R1 影响**，维持原判；受影响者（#2/#5/#6/#7/#12）均为收紧方向，重新对照后仍 no-conflict。
5. 前置门禁三点边界注记（不取消已接纳槽、释放次序与幂等、术语纪律）在 R1 中逐条保持且部分强化（#7 零 wire 收紧、#13 SYNC_APPLIED 与 UPDATE_ACK 统一「已接纳工作 ACK」口径）。

无需 override，无需 Jim 裁决条目。设计可进入 SA3 实现（SA2 八项修订的落实完整性由总控/SA2 复核；G5/C4 帧级时序与 D5 计面重推的自洽性验证属 SA2/SA4/SA6 域，不在冲突门禁范围）。
