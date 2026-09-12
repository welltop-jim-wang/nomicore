# SA4 实现红队评审 — Issue #244（issue #233 切片 3：分块传输有界性加固与中止清理矩阵）

- Dispatch：`sa-41664258-a3a9-408c-8f6c-d08fec20ebc3`（mabf-sa4 / implementation-review / iteration 1——**复审轮**：SA4-1 修复与 SA4-2 收口后的固定再评审）
- 评审对象：当前 worktree 全量实现树（SA3 iteration 0 全量 + iteration 1 SA4-1 槽位归还修复 + iteration 2 SA4-2 双键门收口）+ SA1 修订设计（iteration 1）+ SA6 契约修订（iteration 1，14 用例）+ 协议文档 §17 二轮注记
- 工作区：worktree `nomicore-fix-issue-244`，分支 `mabf/issue-244`，基线 HEAD `e2178f3`（`git status` 实测：12 文件 tracked 修改 + 2 测试文件/3 证据日志/3 SA8 报告/8 wiki 产物 untracked）
- 方法：静态实现审查（`skills/exploit-vulnerability` 程序）——逐文件实读现行源码（槽位生命周期全路径、双构造器门、validate 链、timer 族、六 reason 接线）、契约测试全文（1134 行/14 用例）与回归文件全文（442 行/3 用例）核读、三方验证日志（`artifacts/sa3-issue244-iter1-verify.log`、`artifacts/sa3-issue244-iter2-verify.log`、`artifacts/sa6-issue244-iter1-verify.log`）交叉核对；未运行测试、未启动服务、未创建临时进程（SA4 纪律）
- 结论：**approve** —— 前轮 SA4-1（BLOCKER：槽位归还死代码）与 SA4-2（MAJOR：链生效口径与设计相悖）均经正确路由闭环：修复实现忠实、回归与契约覆盖实质、四方口径（设计/契约/实现/文档）一致；无新增 BLOCKER/MAJOR

## 1. Reviewed inputs

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-244.md`（Host 简报；`## Comments` 空，AC1–AC7） | 已读 |
| `wiki/raw/task_issue-244_dispatch.md`（`issue-comments: none (REST [])`——零 owner 要求；与本次 dispatch 声明一致） | 已读 |
| `wiki/raw/task_issue-244_design.md`（SA1 **iteration 1 修订**：§7-D1 链生效口径裁决 + 边界语义表、§7-D8 §17 二轮规格、§8.1/§8.2 SA4-1 伪码保真同步、§11 ★ 行与三测试文件补登、§12 R1c/N5/N6 路由、§14 修订映射） | 已读（507 行全文） |
| `wiki/raw/task_issue-244_sa2_review.md`（approve；W1/W2/R11–R14 裁决——未被修订重开） | 已读 |
| `wiki/raw/task_issue-244_sa6_contract.md`（**iteration 1 修订**：14 用例 = 冻结 11 + R1c/N5/N6；红→绿证据链） | 已读（161 行全文） |
| `wiki/raw/task_issue-244_sa3_report.md` + `_r2.md`（iteration 1 SA4-1 修复报告 + iteration 2 SA4-2 收口报告） | 已读 |
| `artifacts/sa8-conflict-gate-issue-244.md`、`-design.md`、`-design-recheck.md`（三轮 clear；recheck R15–R19） | 已读 |
| `artifacts/sa3-issue244-iter1-verify.log`（REG 修复前红 3/3 → 修复后绿；全包 62/448；根 300/3211；tsc 0） | 已读 |
| `artifacts/sa3-issue244-iter2-verify.log`（R1c 修复前红 → 17/17 绿 ×3；全包 62/451；根 300/3214；tsc 0；`git diff --check` 0） | 已读 |
| `artifacts/sa6-issue244-iter1-verify.log`（基线 11/11 → 补例后 1 failed(R1c)/13 passed ×3；全包 450/451 唯一失败 = R1c；tsc 0） | 已读 |
| `packages/ws-replication/test/ws-replication-issue244-ac-red.test.ts`（14 用例契约全文）+ `ws-replication-issue244-slot-reclaim-regression.test.ts`（REG1–REG3 全文） | 已读 |
| ADR 0013（冻结面）、`docs/protocols/instance-replication-v1.md`（§9.4/§13.2/§17/§18/§23.1 现行文 + §17 双键注记） | 已读 |
| 生产源码：`types/defaults/validate/plugin/update-transfer/hub-namespace/hub-connection/peer-namespace/peer-connection`（现行态逐点实读） | 已读 |

## 2. Verdict

**approve**。本轮为前轮两项 finding 的修复复审：

- **SA4-1（前轮 BLOCKER）已修复且验收面成立**：`assemblySlotHeld` 镜像旗标在两通道首 chunk 准入成功处同步置位（hub-namespace.ts:721 / peer-namespace.ts:704，`tryBeginInboundAssembly` 返回 true 后、`accept` 前），`endAssemblyScope` 归还守卫由死代码转为可达，获取-归还闭环成立。归还漏斗保持单点（complete/首违例经 `afterAssemblyAccept`；busy 违例/超时/全部清理挂点经 `clearInboundAssembly`；**全部终局路径**经 `finalize → settleClose/cleanupResources → closeSessionAndRelease/runDisposal 的同步段**收口——含 remote-ERROR 等矩阵外终局，无挂起点）；peer 新代际经 `tryOpenReplicationSession` 代际卫生清槽。回归文件 REG1–REG3（修复前红、失败点恰为 SA4-1 症状）锁死 hub/peer 双方向串行 >4 distinct ns 与 peer 跨拨号代际三面。
- **SA4-2（前轮 MAJOR）已按授权路由收口**：SA1 修订设计把链生效口径裁决为「分块族链上键显式表达门」（`maxChunkedUpdateBytes ∨ maxChunksPerUpdate`，合并结果校验）并经 SA8 设计复审 clear（唯一替代读法与冻结契约不可同时满足的反向验证在册）；SA6 契约补例 R1c/N5/N6 落笔（14 用例，红→绿证据链完整）；SA3 iteration 2 将 hub/peer 两构造器门放宽为双激活键（链判据/合并语义/值门先于链均不变）并同轮联动 validate.ts 注释与协议 §17 口径句——**设计-契约-实现-文档四方一致**，前轮「实现单方收窄」的劈叉形态消除。
- 其余面（D2 count 门、D4 滑动超时、D5 第 23 型 + 六 reason 接线、D6 发送端/codec 零改动、D7/D8 文档五处、SA2 R11–R13、plugin 对称性）复审无回归；文件范围在修订 ALLOW 内、DENY 零触碰（SA3）；全量回归与类型门留痕完整（62 文件/451 测试、根 300 文件/3214、tsc exit 0）。

## 3. 上游要求落实（Issue AC + SA6 契约 + SA8/SA2 裁决）

| Requirement or finding | Implementation evidence | Assessment |
|---|---|---|
| Owner 评论（REST `[]`，零要求） | 无评论面（dispatch 快照与本轮声明一致） | 无遗漏 |
| AC1 四配置缺省 + 启动期校验链 + 零运行时 clamp | `defaults.ts:28-31,47`（4MiB/64/4/30_000）；`validate.ts:152-155,239`（两键 ≥1 + timeout 门，无条件）；`hub-connection.ts:200-206`/`peer-connection.ts:114-120`（**双激活键门** + 值门先于链的调用序）；`validateChunkedTransferChain`（validate.ts:220-231）对**合并结果**判两链；运行期只读 resolved 值 | **成立**（前轮 SA4-2 缺口闭合：`{maxChunksPerUpdate: 4}` + 缺省 envelope 的链②违例现构造期 TypeError——R1c 绿） |
| AC2 恶意 totalBytes/chunkCount 分配前拒绝 | hub `onUpdateChunk` D2 门（hub:707-709，`>` 判定保 ==64 边界）/ peer `onHubUpdateChunk`（peer:690-692），先于槽获取与 `assembler.accept`（分配）；totalBytes 维度 assembler `validateFirst` 既有 | 成立 |
| AC3 两错误码分类（R10：并发超额 → VIOLATION） | D2 → TOO_LARGE；D3 `tryBeginInboundAssembly` false → VIOLATION（hub:714-716/peer:697-699）；两码经 `transferViolation` 单点 → ns ERROR + 终局 failed；准入序 D2→D3→置位→accept 符 W2 | 成立（含槽位归还后「其余不受影响」的真实化） |
| AC4 滑动超时 → 弃 partial + RESYNC{EXPIRED} + 收敛 | TimerKind+'assembly'（hub:99/peer:103-111）、每 chunk `armTimer` 重置（`afterAssemblyAccept` busy 分支）、`onAssemblyTimeout`（hub:1553-1565/peer:1831-1843 附近）：busy 守卫 → `clearInboundAssembly('timeout')`（弃 partial + **归还槽** + 清 timer + aborted{timeout}）→ 独立 `sendChecked RESYNC{UPDATE_TRANSFER_EXPIRED}` → needs-resync + resyncEpisode；peer 尾行 `maybeStartRecovery`；`clearAllTimers` 双侧含 'assembly'（hub:1576/peer:1850） | 成立 |
| AC5 中止矩阵全行丢弃 | 丢弃面 = DD-4 挂点全部经 `clearInboundAssembly(reason?)`；事件面六 reason 全接线（见 §5）；**终局路径兜底**：`finalize` → `settleClose`/`cleanupResources` → 收口体同步段 `clearInboundAssembly(teardownAbortReason)`（hub:1409-1411/peer:1668-1670）——矩阵外终局（remote-ERROR/revoke 等）亦收口，无槽挂起 | 成立（含兜底面加固） |
| AC6 发送端中止簿记 | `update-channel.ts` 零 diff（`git status` 核实）；R3 尾自愈由契约覆盖 | 成立 |
| AC7 全路径零部分写入 | 全部拒绝/中止先于分配或先于 apply；apply 仅 complete（Σbytes 精确核对）后经既有管线；R2–R5 内嵌断言 + N3 哨兵 + REG saveDelta===1 | 成立 |
| SA6 契约 14 用例（iteration 1 修订） | 逐条核读：R1a/R1b/R1c/R2/R3/R4/R5a/R5b/N1–N6 断言面与 SA6 §5/§6/§12 一致；SA3 iter2 日志：修复前 R1c 红 ×1/13 绿 → 修复后 14/14 绿、确定性 ×3、全包 62/451、tsc + 根门 exit 0 | 成立（SA4 未复跑——纪律；三方日志交叉自洽：iter1 448 → SA6 补例 451 → iter2 451） |
| SA2 R11（shed/epoch-fence wiring） | 漏斗 cause 判别（hub:1022/peer:1201）；epoch-fence 三入口（hub:982、peer:863、peer:1506）；failed 族 carve-out 落实 | 成立（复审无回归） |
| SA2 R12（side 字段）/ R13（GOAWAY 归并） | hub:796/peer:779 `side` 字面量；hub:916 + peer:1010/1055/1072 `connection-teardown`；§23.1 登记行 | 成立（复审无回归） |
| R8/D8 协议文档（五处 + §17 二轮） | §9.4/§13.2/§18/§23.1 iteration 0 落地；**§17 双激活键口径句**（「显式配置 `maxChunkedUpdateBytes` **或** `maxChunksPerUpdate`（两链不等式的分块族操作数键）时响亮生效…非追溯性」）与设计 §7-D8 第 1 条逐字一致；src/协议文档单键口径零残留（grep 实测） | 成立 |

## 4. 设计落实审查（对照 SA1 iteration 1 修订设计）

| Design decision | Implementation location | Assessment | Finding |
|---|---|---|---|
| D1 配置面（含 **SA4-2 裁决：双激活键显式表达门**） | types.ts/defaults.ts/validate.ts/plugin.ts + `hub-connection.ts:200-206`/`peer-connection.ts:114-120` 门条件 `hasOwnProperty('maxChunkedUpdateBytes') \|\| hasOwnProperty('maxChunksPerUpdate')`；validate.ts:205-219 函数头「调用契约」段改双键口径；边界语义表五行逐行核对：显式 bytes 键（R1a/N1）✓、显式 count 键（R1c）✓、仅显式既有键（N5）✓、非链操作数键（N6）✓、`chunkedUpdate` 旋钮（契约全场景构造成功）✓ | **忠实**——门探测在 `options.limits`（用户表达键集）、链判据在 resolved 合并结果、值门无条件先于链；plugin 路径 `mergeNested`（plugin.ts:214-217 纯 spread 用户 Partial）使两路径探测语义一致（实读验证） | — |
| D2 count 准入门 | hub:702-709/peer:688-692 | 忠实（W1 peer 无 submit 门亦忠实） | — |
| D3 连接级槽位（含 **SA4-1 修复：获取侧同步置位**） | hub-connection.ts:469,521-533/peer-connection.ts:99,146-155（Set + 两 facet，`has`→true 幂等、满额 false、`delete` 幂等）；hub-namespace.ts:714-721,774-778/peer-namespace.ts:697-704,756-760（置位 + `endAssemblyScope` 唯一归还点）——设计 §8.1 伪码含 `this.assemblySlotHeld = true;` 一行、§8.2 不变量补获取侧置位，与实现逐行一致 | **忠实**（获取-归还闭环成立；详见 §8） | — |
| D4 滑动超时 | hub:1527-1532,1548-1565,1575-1577/peer:103-111,708-717,1831-1843,1850-1856 | 忠实（stale fire busy 守卫、peer `onTimerFired` 终态防御、closing/终态先杀 timer） | — |
| D5 第 23 型 + 六 reason + busy 守卫 + observerOn 门 + 快照先于 reset | types.ts 联合第 23 型；update-transfer.ts:88-99 `snapshot()`；hub:786-804/peer:769-787（快照→收尾→reset→决策后发射）；六 reason 接线点 §3 表 | 忠实（`teardownAbortReason` 一次性消费 hub:1409-1411/peer:1668-1670、failed 族 carve-out、last-writer-wins 均落实） | — |
| D6 发送端/codec/状态机零改动 | `git status`：update-channel.ts、replication-protocol/**、src/index.ts、docs/adr 零 diff | 成立 | — |
| D7 R10 固化 + D8 文档五处（§17 二轮） | 协议 §13.2 注记；§17/§18/§9.4/§13.2/§23.1 | 成立（§17 与门放宽同轮落地——R15 暂存窗口闭合） | — |
| SA1 §11 ★ 四行（SA4-2 实现轮路由） | hub/peer-connection 门、validate.ts 注释、§17 口径句——四行全落地且与 SA6 契约补例同轮衔接（先契约后实现的顺序由 R1c 单键门下红守卫证明） | 忠实 | — |
| SA1 §8.1/§8.2 SA4-1 伪码保真同步 | 设计伪码与 hub:718-722/peer:701-705 逐行一致（含注释锚点） | 忠实（未重开 D3 机制面——SA8 §5 核验维持） | — |

## 5. 架构一致性与惯例

### 责任归属

| Behavior | Expected owner | Actual location | Assessment |
|---|---|---|---|
| 连接级并发计数 | 连接实现方 | `HubConnectionImpl`/`PeerConnectionImpl` 持 Set + 两 facet；通道只调用 | 正确 |
| 链激活探测 vs 链判据 | 构造器（探测用户表达）/ validate（判合并结果） | 门在构造器读 `options.limits`，链在 `validateChunkedTransferChain(resolved)` | 正确（两层事实分离干净） |
| 单 assembly 几何/一致性 | assembler | `UpdateChunkAssembler` 仅 +`snapshot()` | 正确 |
| 超时 timer | 通道（注入 timer seam） | TimerKind 槽位扩展，并入 `clearAllTimers` 纪律 | 正确 |

### 相似能力对照

| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
|---|---|---|---|---|
| 显式性探测先例 | `hasOwnProperty` 类条件（plugin `mergeNested` Partial 保留惯例） | 双键 `Object.prototype.hasOwnProperty.call` | 一致 | 与直连/plugin 两路径语义统一 |
| 连接级资源准入 | `maxQueuedBytesPerConnection`（连接层） | `inboundAssemblySlots` Set（连接层） | 一致 | 同层同惯例 |
| ns 级 timer 收口 | TimerKind 族 + `clearAllTimers` | `assembly` kind 并入 | 一致 | 无平行 timer 机制 |

### 单一事实源 / 生命周期对称性 / 平行机制

- 槽位事实源 = 连接侧 Set（单一）；通道侧 `assemblySlotHeld` 为对称镜像——**获取（置位）与归还（复位+delete）现已对称闭合**（前轮断裂点消除）。
- `teardownAbortReason` 一次性记忆位置位/消费对称；`resyncEpisode`、`resyncDeclared` 既有记忆位未被新面触碰。
- 无平行 cleanup worker / retry loop / 第二日志面；事件经 `dispatchReplicationObserver` 隔离单点。
- SA4-2 门放宽复用既有 `validateChunkedTransferChain` 单点，仅改激活条件——无第二校验路径。

### 文件范围审查

| Changed path | ALLOW entry | Purpose | Assessment |
|---|---|---|---|
| `packages/ws-replication/src/{types,defaults,validate,plugin,update-transfer,hub-namespace,hub-connection,peer-namespace,peer-connection}.ts`（9 文件 tracked 修改） | ALLOW 逐文件在册（§11 表与 git status 一致） | D1–D5 + SA4-1/SA4-2 修复 | 在范围内 |
| `docs/protocols/instance-replication-v1.md` | ALLOW（§9.4/§13.2/§17/§18/§23.1，含 §17 二轮 ★ 行） | D7/D8 + SA4-2 联动 | 在范围内 |
| `packages/ws-replication/test/ws-replication-api.test-d.ts`、`ws-replication-observer-red.test.ts` | ALLOW（**iteration 1 设计 §11 已补登**——前轮 O2 处置闭环） | 类型面强制编译联动 | 在范围内（补登后合规） |
| `packages/ws-replication/test/ws-replication-issue244-slot-reclaim-regression.test.ts`（新增） | ALLOW（iteration 1 §11 补登 + SA4 §9 授权） | SA4-1 回归面 | 在范围内 |
| `packages/ws-replication/test/ws-replication-issue244-ac-red.test.ts`（untracked，含 R1c/N5/N6） | DENY（对 SA3）——**SA6 iteration-1 dispatch 落笔**（SA6 报告 §2/§14：diff = 头部注记 + 3 新用例，冻结 11 用例断言零改动；11 用例名与前轮评审逐字一致） | 契约补例 | 合规（owner/SA6 路由执行，非 SA3 越权） |
| `artifacts/*.log`、`artifacts/sa8-*.md`、`wiki/raw/task_issue-244*` | 证据/评审产物（非生产面） | 各 SA 留痕 | 合规 |
| DENY 面（replication-protocol/**、update-channel.ts、docs/adr/**、CONTEXT.md、apps/**、src/index.ts、issue243/233 套件、harness.ts） | — | `git status` 零触碰 | 零触碰 ✓ |

## 6. 契约连锁审查

| Contract | Caller | Actual handling | Risk | Finding |
|---|---|---|---|---|
| 双激活键门（构造期 TypeError 族扩一档） | 全仓 `createHubReplication`/`createPeerReplication` 构造点 | SA8 recheck §3-Q2 全仓穷尽 grep：经构造器表达 `maxChunksPerUpdate` 者仅 R1b（值门先抛，同为 TypeError）；包外 `maxChunkedUpdateBytes` 表达 = issue243-chunked-live（6/10KiB）与 issue243-sa7-dynamic（4096）——链满足 | 低（实测零翻转：全包 62/451 绿、根 300/3214 绿） | — |
| plugin 配置路径 | plugin 宿主 | `mergeNested` spread 只合并用户 Partial（plugin.ts:214-217 实读）→ `hasOwnProperty` 探测两路径一致；`LIMIT_KEYS` 已含双键 | 低 | — |
| `ReplicationLimits` +2 必填键 | 直接构造方（含测试字面量） | 编译期强制；observer-red 已补 | 低 | — |
| 事件联合第 23 型（append-only） | ws-server adapter（转发型）、test-d（精确联合 23 型 + 字段/reason/side 断言） | 转发型零破坏 | 低 | — |
| `tryBeginInboundAssembly` 满额拒纳 | 通道首 chunk 管线 | 拒纳 → `transferViolation` → 终局 failed；**归还闭环修复后满额条件 = 真实并发数**（不再随历史 distinct ns 单调增长） | 低（REG1–REG3 锁定） | — |
| `assemblyTimeoutMs` 新 timer 对既有虚拟时间套件 | 62 测试文件 | timer 仅 busy 在场武装/每 chunk 重置/busy→idle 与终态即清；全包回归绿（两轮日志） | 低 | — |
| 协议文档读者（§17 口径句） | 配置消费者 | 与门行为逐字一致（双激活键 + 非追溯性注记） | 低 | — |

## 7. 错误、恢复与并发

- **错误分类**：TOO_LARGE（config-retryable）/VIOLATION（no）经单点，fatal/terminal failed；值门 TypeError（构造期）先于链 TypeError——R1b 语义保持。
- **槽位生命周期（本轮核心复核项）**：获取唯一点（D3 门通过后同步置位）；归还唯一点 `endAssemblyScope`；出口封闭枚举：complete/首 chunk 即违例（`afterAssemblyAccept` !busy 分支）→ busy 违例（`transferViolation`→clear）→ 超时（`onAssemblyTimeout`→clear）→ 收口挂点（`closeSessionAndRelease`/`runDisposal` 消费 `teardownAbortReason`）→ **全部终局路径**（`finalize`→`settleClose`/`cleanupResources` 同步段 clear——含 remote-ERROR 等 failed 族矩阵外终局）→ peer 新代际（`tryOpenReplicationSession` clear）。timer 句柄与槽同生共死（`endAssemblyScope` 先清 timer；`clearAllTimers` 含 assembly；peer `onTimerFired` 终态防御）。peer 跨拨号代际无泄漏面（REG3 绿证据）。
- **并发/幂等**：`tryBegin` 幂等（`has→true`）、`end` 幂等 delete、`reset()` 幂等、`clearInboundAssembly` busy 守卫至多一事件、`teardownAbortReason` 消费即清——静态闭合；前轮风险 2（设计 §13 自认最高危形态）由修复 + 回归消除。
- **零部分写入**：全部拒绝/中止先于分配或先于 apply；REG/契约 saveDelta 与 'seed' 断言在场。
- **accept 同步抛出的理论残余**：`assembler.accept` 为纯状态机（校验失败返回 violation 结果而非 throw；分配上限 = 已验证 `maxChunkedUpdateBytes`）——若极端 OOM 使 `new Uint8Array` 抛出，异常将沿连接分发层上冒（进程级故障面），槽位滞留非该场景主伤害；非实现缺陷（见 §11 动态项）。

## 8. 测试质量审查

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
|---|---|---|---|---|
| `ws-replication-issue244-ac-red.test.ts`（14 用例） | R1a（显式 6MiB → TypeError + 三缺省冻结值）；R1b（0 值 → TypeError）；**R1c（`{maxChunksPerUpdate: 4}` 双入口 TypeError + 冻结缺省自检 4MiB>4×512KiB + 双键显式反证）**；R2（TOO_LARGE+failed+零写入）；R3（RESYNC{EXPIRED}+aborted{timeout,1}+收敛+自愈）；R4（victim VIOLATION+failed、4 健康 ns 收恰一次、连接 ready）；R5a/R5b（aborted 恰一+零写入+零 failed）；N1–N4 负控；**N5（`{...LIMITS}` 零分块族键逐键断言 + 合并违链①探针 → 不抛）**；**N6（并发键不激活）** | 根 `vitest.config.ts` include `packages/*/test/**/*.test.ts` 真实发现 | 无 skip/only/todo；无源码字符串断言；R1c 反证证明红精确落在激活键集（非链机制空转）；N5 探针自检防空转；fixture 逐测试 stop 收尾 | — |
| `ws-replication-issue244-slot-reclaim-regression.test.ts`（REG1–REG3） | REG1：hub 入站 6 distinct ns **串行整笔**（每笔 3-chunk 真实分块 + transferId 唯一 + saveDelta===1 + 零 VIOLATION + 双侧零 failed + 连接 ready）；REG2：peer 入站镜像；REG3：代际 1 串行 4 笔 → `closePeerSide(1006)` → 自动重拨（新 wire 断言）→ 代际 2 新 ns e/f 收敛恰一次 apply | 同上 include | 修复前红证据精确（iter1 日志 [1]：三例均失败于「第 5 个 distinct ns 误 UPDATE_TRANSFER_VIOLATION」）；谓词以「收敛或违例」终止防伪红挂起；`wires` 代际隔离断言只读当前代际 | 残余：中止型归还（timeout/收口 caller）后的**新 distinct ns** 首 chunk 未被直接断言（同 ns 重试被 `has→true` 吸收）——归还漏斗单点共享使该残余低危，见 §12-O1 |
| `ws-replication-api.test-d.ts` | 联合 23 型精确形状 + reason/side/receivedChunks 类型断言 | typecheck include `packages/*/test/**/*.test-d.ts` | 强化（无弱化） | — |
| `ws-replication-observer-red.test.ts` | 既有面回归 | 同上 | 字面量编译修复，语义不变 | — |
| SA3 验证门 | 契约 14/14、REG 3/3（确定性 ×3）、全包 62/451、包 tsc + 根 typecheck（14 项目）+ 根 test（300/3214）exit 0、`git diff --check` 0 | `artifacts/sa3-issue244-iter2-verify.log` 逐命令留痕 | 前轮 O3（留痕缺口）已闭环：iter1/iter2 两日志逐段在册，数字链自洽（448 → 451 → 451） | — |

## 9. Required revisions

无。前轮两项 finding 的处置核验：

| Finding ID | 前轮 Severity | 处置核验 | 状态 |
|---|---|---|---|
| SA4-1 | BLOCKER | 置位修复（hub:721/peer:704）+ 归还闭环（§7 全路径复核）+ REG1–REG3（修复前红/修复后绿，含跨代际）+ 设计 §8.1/§8.2 伪码保真同步 | **已解决** |
| SA4-2 | MAJOR | SA1 修订设计裁决（§7-D1 边界语义表）+ SA8 recheck clear + SA6 契约补例 R1c/N5/N6（owner/SA6 路由）+ SA3 双键门放宽 + validate 注释 + §17 口径句同轮联动 | **已解决** |

## 10. 后续动态验证项

| Risk | Driver | Expected observation | Failure condition |
|---|---|---|---|
| 中止型槽位归还（timeout/收口 caller）后新 distinct ns 首 chunk 接纳 | 后续动态/回归补充：ns X assembly 超时后对第 6 个 distinct ns 发起分块传输 | 新 ns 正常收敛、零 VIOLATION | 第 5+ distinct ns 误 VIOLATION（漏斗单点共享使该形态低概率，但无直接断言） |
| shed/epoch-fence/GOAWAY/queue-overflow/resync-declared 五行动态断言 + `side` 双侧覆盖 | SA7 既有规划（设计 §13 残差；wiring 已静态核对齐全） | 各行 busy 在场时 aborted{reason} 恰一 + 互补事件在场 + 零部分写入 | 事件缺失/双发/错 reason |
| 跨窗滑动形态（chunk1@T+20s、chunk2@T+40s 均不超窗） | SA6 §15 已记录虚拟时间不可构造项，SA7 动态 | 每 chunk 到达重置 deadline，均不触发 RESYNC | 提前误报或漏报 |
| `new Uint8Array(totalBytes)` 极端内存压力下的同步抛出路径 | 进程级故障注入（超出本切片验收面） | 异常沿连接分发层上冒为进程故障信号，无静默吞没 | 静默吞掉导致槽/timer 滞留且无诊断 |

## 11. Non-blocking observations

- **O1（回归覆盖残余）**：REG1–REG3 锁定完成型归还（hub/peer 双方向）与跨代际归还——恰为 SA4-1 的 Required change 验收面；中止型 caller（timeout/teardown）与完成型 caller 汇入**同一** `clearInboundAssembly → endAssemblyScope` 单点（同一守卫、同一 Set.delete），独立回归仅防「caller 级断裂」（如未来某中止路径绕过漏斗）——建议随 SA7 动态面或后续回归补一例（§10 第 1 行），非本轮阻断。
- **O2（表达式语义固有性质，已文档化）**：显式 = 缺省值亦激活（`{...LIMITS, maxChunksPerUpdate: 64}` 将抛而 `{...LIMITS}` 不抛）——hasOwnProperty 条件触发的固有性质，边界语义表行 1/行 2 与 SA8 R17 均已登记；纯 JS 调用方显式 `undefined` 值键亦激活（TS 类型面阻止该形态；激活后缺省自洽则不抛，误伤方向为响亮非静默）。
- **O3（R3 断言重排，前轮已裁）**：两条停滞期断言前移至 deadline 前、文本逐字保留——维持前轮「实质审查不构成弱化」判定，未变。
- **O4（注释时效）**：hub-connection.ts:468/peer-connection.ts:97-98 及 `endAssemblyScope` 注释声称的「busy→idle 经 endInboundAssembly 幂等归还」**随置位修复由假转真**（前轮 O4 自然闭合）。
- **O5（SA6 契约文件所有权）**：DENY 面的契约文件补例由 SA6 iteration-1 dispatch 落笔（冻结 11 用例断言零改动、diff = 头注记 + 3 新用例）——路由合规；SA3 两轮均未触碰（r2 报告 §1 与日志 [1] 声明一致）。
- **O6（#245/SA7 移交面）**：成功路径三型（sent/applied/acked）、五行动态断言、#245 body 措辞同步——设计 §13 残差登记一致，无越权调度。

## 12. 结论

复审范围内（SA4-1 修复、SA4-2 收口、全 SA6 契约、前轮实现义务、文件范围、测试质量）逐项核实：**两项前轮 finding 均已按正确路由闭环且实现忠实**——槽位获取-归还闭环在完成/违例/超时/收口/终局/跨代际全路径成立并有修复前红证据的回归锁定；双激活键门在 hub/peer 两构造器对称落地、链判据恒对合并结果、值门先于链、plugin 路径语义一致，且与修订设计、SA8 复审、SA6 契约（R1c 红→绿、N5/N6 全程绿）、协议 §17 口径句四方一致；全量回归与类型门留痕完整自洽。无 BLOCKER/MAJOR；残余项均为非阻断观察（§11）或已路由动态面（§10）。**verdict = approve**；`requiresConflictRecheck = false`（SA4-2 的 ADR 0013 L71 执行口径解释已经 SA8 设计复审 clear，实现与该裁决一致，无新增冻结面冲突）。
