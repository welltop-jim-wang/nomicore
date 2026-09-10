# SA7 动态验证报告 — issue #246：分块传输 wire 契约收口与新旧互通矩阵（切片 5，final verification）

- dispatch：`sa-3964ed28-6c40-4c71-a999-f4bb31dd3ea5`（mabf-sa7 / final-verification / iteration 0）
- 任务：对 issue #246 做 final verification——核验已批准的最终 diff 与必需的动态/重复 M2 互通证据，报告任何 material defect。
- 前置状态：SA4 iteration 1 **approve**（0 BLOCKER / 0 MAJOR；issue246-SA4-F1 已闭合）+ SA8 recheck **clear**（R26–R31 全部成立）。本轮在 SA4 pass 基础上独立动态验证。
- 结论速览：**approve**——工作树与 SA4 批准基线零漂移（五文件 md5 逐字节一致）；M2/全矩阵 **20/20 次全新进程重复运行零假红**（F1 正式验收完成）；#233 v1 基线 3/3、#243 real-transport（真实 TCP 协商分块主链路）+ chunked-live 17/17、File A 22/22、codec 三锚 80/80 全绿；AC5 六查零命中 + `git diff --check` 干净；零 material defect。

---

## 1. Inputs

| 输入 | 状态 | 用途 |
|---|---|---|
| `wiki/raw/task_issue-246.md`（issue 正文快照，5 AC） | 已读 | 验收要求来源 |
| Issue comments | REST 快照 `[]`（dispatch 声明） | 零 owner 评论需要落实 |
| `wiki/raw/task_issue-246_design.md`（SA1 iteration 1） | 已读关键节：§7.4.2（M2 行/三层确定性形态）、§8.3（零数据流变化声明）、§11（ALLOW/DENY）、§12.3–§12.5（契约/命令/验收映射，含「SA7 动态轮抽查 M2 ≥20 次重复零假红」与「真实 WebSocket transport 面复核」） | 动态验证范围定义 |
| `wiki/raw/task_issue-246_sa4_review.md`（approve） | 已读 | §11 后续动态验证项两条（≥20 次正式验收 + real-transport 复核）= 本轮义务 |
| `wiki/raw/task_issue-246_sa3_impl.md`（iteration 3） | 已读 | 交付自述与 Deviations；其 ×20 为佐证，本轮正式重做 |
| `artifacts/sa8-conflict-gate-issue-246.md` + `-recheck.md`（clear） | 已读 recheck 全文 | 协议边界（R26 冻结面、R28 interposer 等价性）不可改变 |
| 实际 diff（3 文档）+ File A/File B 全文 | 已读 | 批准终版核验对象 |
| `wiki/raw/task_issue-246_sa6_contract.md` | 不存在（设计 §0 登记） | 无 SA6 契约输入；以设计 §12 契约为验证契约 |

## 2. Runtime environment

| 项 | 值 |
|---|---|
| worktree | `/home/wangjian/nomicore-fix-issue-246`（`.git` → 主仓 worktree） |
| 基线 commit | `d1888cc`（`feat(ws-replication): observe chunked update lifecycle (#281)`，`git log --oneline -1` 实测） |
| node / pnpm / vitest | v24.13.0 / 10.28.2 / v3.2.7 |
| 运行前缀 | `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run <file>`（与根 `pnpm test` 同源条件） |
| 工作树状态（验证前后各测一次） | 3 M（CONTEXT.md、ADR 0013、协议文档）+ 2 未跟踪契约测试 + artifacts/wiki 证据；`git diff --stat` = 3 files / 36 insertions / 8 deletions（前后一致） |

## 3. Approved final diff verification（批准终版零漂移核验）

| 文件 | SA4 approve 记录 md5 | 本轮实测 md5 | 结果 |
|---|---|---|---|
| `packages/replication-protocol/test/codec-issue246-doc-contract.test.ts`（File A，357 行） | `f5fc29e684acd0d111704a0946f4fb79` | `f5fc29e684acd0d111704a0946f4fb79` | 一致 |
| `packages/ws-replication/test/ws-replication-issue246-interop-matrix.test.ts`（File B，687 行） | `4e7716518ce5297c7629369a5281e8fb` | `4e7716518ce5297c7629369a5281e8fb` | 一致 |
| `CONTEXT.md` | `2c5c9a73…`（SA3 登记） | `2c5c9a73aea6afdffb565ad5c4b62047` | 一致 |
| `docs/adr/0013-chunked-live-update-transfer.md` | `922307e7…` | `922307e7255004d796878709b3c3d922` | 一致 |
| `docs/protocols/instance-replication-v1.md` | `a3c8ade9…` | `a3c8ade9f62de4cc71d34ff60de1468b` | 一致 |

diff 全文复读与设计逐点对照：§1 实现代际词条（三层消歧）；§5「v1 代际」改挂；§10.3 占位句替换为完整跨帧契约（transfer 身份四元组作用域、发送端规则、接收端规则、错误码三分类显式分列 `UPDATE_TRANSFER_TOO_LARGE`/`UPDATE_TRANSFER_VIOLATION`/`RESYNC_REQUIRED{UPDATE_TRANSFER_EXPIRED}`、未协商 `UNSUPPORTED_MESSAGE_TYPE`+1002+payload 解析前门控保留）；§22 两条目（锁定值 `0x42`/`0x00000001` + golden/矩阵资产全路径 + 实现代际互通矩阵条目）；ADR 0013 L4 已接受 + wire 冻结值让渡 + observer 事件词表单列 local seam（F4）+ L122 两层权威已生效表述；CONTEXT L142/UPDATE_CHUNK 词条/新增代际词条（含 _Avoid_）。与 SA4/SA8 审查基线**逐字一致，零漂移**。R26 冻结面（§5 注册表行/§6.1/§13.2/§17/§23.1/六字段序表）diff 零触碰（hunk 落点实测）。

## 4. Changed Data Flow Verification

设计 §8.3 声明：**零运行时数据流变化**（ALLOW LIST 不含任何 `src/**` 路径）。动态复核：

| Route | Design change | Runtime driver | Observed | Expected result | Actual result | Verdict |
|---|---|---|---|---|---|---|
| 全部生产数据流 | 无变化（docs + tests only） | `git diff --stat -- packages/ apps/ domains/` | 空输出 | 生产面零改动 | 空输出，src 零字节改动 | 一致 |
| 唯一「新增数据」= 测试域 interposer 对 HELLO 单帧 `optionalCapabilities` 4 字节窗口的一次改写 | 测试域，出 vitest 进程即消失 | File B M2 字节对断言（等长/同 sequence/差异全落 [0,0,0,1]→[0,0,0,0] 窗口） | 21 次 File B 运行（1+20）全绿 | 改写严格限定 4 字节窗口、其余字段（peerInstanceId/expectedHubInstanceId/protocolVersions/requiredCapabilities/connectionNonce）原样 | 断言通过 ×21 | 一致 |

无设计声明改变的数据流需要按新路线验证——本票为文档收口 + conformance 证据票。

## 5. Preserved Data Flow Verification（设计声明不变的路线）

| Route | Preserved invariant | Runtime driver | Baseline observation | Current observation | Verdict |
|---|---|---|---|---|---|
| 未协商（v1 代际任一端）超限 live update | 发射侧丢弃 + `resync-required{cause:'send-failed', reason:'update-too-large', channelState:'needs-resync'}` 恰一；接收侧 `remote-declared` 恰一；wire 恰一 `RESYNC_REQUIRED`；该写零 UPDATE/零 UPDATE_CHUNK；经 >8KiB SYNC_STEP2 reconciliation 收敛；连接保持 ready | File B M1/M2 `assertV1Fallback`（peerToHub + hubToPeer 双方向腿 ×2 会话） | #233 刻画（v1 基线 3/3 绿，本票零改动） | M1+M2 全部断言通过 ×21 次运行；N4 按观测侧分别断言（禁双 observer 汇总）在位 | 一致 |
| v2 peer ↔ v1 hub 等价性（R28） | M2 ≡ M1：(a) post-HELLO 每方向 `kind#sequence` 序列逐项全等；(b) 确定性字段帧逐字段相等（HELLO_ACK/RESYNC_REQUIRED/UPDATE_ACK/OPEN 族/BOOTSTRAP_ACK；排除 connectionNonce/connectionId/Yjs 字节）；(c) Yjs 承载帧只比 kind+计数（+namespaceId）；**零跨会话字节/长度相等项** | File B M2 三层比对（L571-581，位于全四腿之后，覆盖超限 hub→peer 载荷腿） | —（本轮为正式首验） | 三层全等 ×21 次运行零假红（含 hub 写镜像腿在时间线内） | 一致 |
| 协商分块（v2↔v2） | 超限写 ⇒ UPDATE_CHUNK ≥2 帧（transferId=1、chunkIndex 0..n-1 连续、Σbytes=totalBytes、每帧 ≤maxUpdateBytes）+ 恰一 UPDATE_ACK（ackedSequence=末 chunk 帧序）+ 零 resync + 零 >8KiB SYNC_STEP2；双方向 | File B M3 `assertChunked`（peerToHub + hubToPeer） | #243 chunked-live 16/16 绿（本票零改动） | M3 双方向断言通过 ×21；#243 套件 16/16 复绿 | 一致 |
| 未协商 0x42 解码分类 | payload 解析前 `UNSUPPORTED_MESSAGE_TYPE`、connection scope、fatal、close 1002；已协商同帧正常解码 | File B 第 4 测（协商数学 + 分类等同锚） | codec-issue242-ac-red AC3 | 通过 ×21；codec 三锚（version-interop/golden/242-ac-red）80/80 复绿 | 一致 |
| 真实 WebSocket transport 主链路（SA4 §11 指定） | 真实 TCP（node:net）上 `chunkedUpdate: true` 协商分块主链路保持 | `ws-replication-issue243-real-transport.test.ts`（L203 `chunkedUpdate: true`，L240-285 经协商上下文解码 UPDATE_CHUNK） | #243 交付时绿 | 1/1 绿（与 chunked-live 合计 17/17） | 一致 |
| #233 刻画文件（v1 基线） | 文件不动、继续全绿（AC3 末句） | `ws-replication-issue233-repro.test.ts` | md5 未变（不在 diff 内） | 3/3 绿 | 一致 |

## 6. State Machine Verification

| Initial state | Trigger | Expected transitions | Observed transitions | Forbidden transitions absent | Verdict |
|---|---|---|---|---|---|
| namespace live（连接 ready） | 未协商端 20KB 写（>8KiB） | live → needs-resync（发射侧 send-failed）→ 接收侧 remote-declared → reconciliation（>8KiB SYNC_STEP2）→ live；连接保持 ready | `settleUntil` 谓词（副本收敛 ∧ 离开 needs-resync/reconciling）满足；`connectionState()==='ready'` 断言在位（M1 L515 / M2 L569） | 该写零 UPDATE/UPDATE_CHUNK 承载、无 connection fatal、无重复 resync（恰一×两侧）| 一致 |
| namespace live（协商） | v2↔v2 20KB 写 | live →（分块传输）→ live；零 resync | namespaceState 全程 'live'、collector 零 resync-required（M3 L628-632） | 无 needs-resync、无 SYNC_STEP2 承载该写（#233 R1 反向断言 L634-641） | 一致 |
| 协商位状态 | HELLO offered=CAP → interposer 剥除 → hub 交集 | hub `selectedCapabilities=0` 单点决定全部后续行为 | `helloHubVisible.optionalCapabilities===0` ∧ `helloAck.selectedCapabilities===0`（M2 L471-472/568） | 无「hub 内部已协商但 wire 未协商」的拜占庭分歧（ACK 未被外部改写，交集由真实 v2 hub 计算） | 一致 |

## 7. Error and Cleanup Flow

- 错误传播：超限错误沿 v1 路径传播（send-failed → needs-resync → RESYNC_REQUIRED → reconciliation），分类断言（reason='update-too-large'、channelState='needs-resync'）逐条通过；未协商 0x42 解码拒绝分类（connection/fatal/1002）通过。零伪成功面：收敛谓词要求副本值 === BIG 且离开 needs-resync/reconciling，无静默通过。
- 清理：interposer 退订句柄原样透传（L164-183）；`before/after` 帧切片隔离每次写的增量，跨腿计数不混入；M1/M2/M3 每 `it` 独立组装（独立 Registry/Runtime/随机源），无跨用例状态复活。20 次全新进程重复零残留——运行后五文件 md5 与运行前逐字节一致、`git status` 集合不变（仅新增本轮 artifacts 日志与本报告）、`git diff --check` 干净。
- 重启/复活：无旧路径复活面（生产零改动；测试进程退出即消失 interposer 改写）。

## 8. Temporary Diagnostics

**零添加**。既有观测面（observer collector 事件、`makeWire` 双向原始字节捕获 + `decodeWire`、`helloRewrites` 字节对记录、`rootValue` 持久副本读取）已足以观察全部关键跳点与状态转换，未达 ALLOW LIST 添加临时日志的必要条件。收尾核验：全仓 `grep -rn "SA7-DATAFLOW"` 零命中（添加项=0、删除项=0）；关键场景在无任何诊断注入状态下运行（即第 5–7 节全部证据本身）。

## 9. Dynamic Evidence Matrix

| Source | Requirement or risk | Driver | Expected | Actual | Evidence | Result | Suggested routing |
|---|---|---|---|---|---|---|---|
| Design §12.5（AC3 行）/ SA2 F1 | M2（含 hub 写腿）≥20 次重复零假红——正式验收归 SA7 | 20 次串行全新进程 `vitest run` File B | ≥20 次全绿 | **20/20 exit=0，20 次 `Tests 4 passed (4)`，零 failed** | `artifacts/sa7-issue246-fileB-20x.log` | pass | — |
| SA4 §11 行 2 | 真实 WebSocket transport 语境协商分块主链路保持绿 | `ws-replication-issue243-real-transport.test.ts` | 绿 | 1/1 绿（真实 TCP + chunkedUpdate:true + UPDATE_CHUNK 协商解码） | 终端输出（见 §10） | pass | — |
| SA4 §3（AC3 末句） | #233 刻画 v1 基线继续全绿 | `ws-replication-issue233-repro.test.ts` | 3/3 绿 | 3/3 绿 | 终端输出 | pass | — |
| Design §12.4 | File B 全矩阵绿（M1/M2/M3/数学锚） | 同 20× 循环内每次运行 + 首跑 | 4/4 绿 | 4/4 绿 ×21 | `artifacts/sa7-issue246-fileB-20x.log` + 终端输出 | pass | — |
| Design §12.2/§12.5（AC1/AC2/AC4） | File A 文档契约 22 条绿 | `vitest run` File A | 22/22 绿 | 22/22 绿（`Type Errors no errors`） | 终端输出 | pass | — |
| Design §7.5/§12.5（AC4 锚） | codec 层三锚（version-interop/golden/242-ac-red）绿 | `vitest run` 三文件 | 全绿 | 80/80 绿 | 终端输出 | pass | — |
| Design §12.4 后七行（AC5） | 过期术语六查 + `git diff --check` | 六条 grep + git diff --check | 全零命中/干净 | 六者 exit=1（零命中）；diff --check exit=0 | 终端输出 | pass | — |
| SA4 §2/§6（批准基线） | 工作树与 SA4 approve 对象零漂移 | 五文件 md5 前后对照 + diff stat | 一致 | 前后均逐字节一致；3 files/36+/8- | 本报告 §3 | pass | — |
| SA4 §12 N-OBS1（登记性） | File A D2-3 错误码「对调」不红 | —（静态登记项） | 非阻断 | 未处理，与 SA4/SA3 登记一致（后续测试强化票） | SA4 §12 | 登记 | 后续票 |

## 10. Commands and Evidence

| # | Command | Result |
|---|---|---|
| 1 | `md5sum` File A/File B/CONTEXT/ADR/协议（验证前+验证后各一次） | 五者与 SA4 approve 基线逐字节一致（§3 表） |
| 2 | `git diff --stat` / `git diff --check` | 3 files, 36 insertions(+), 8 deletions(-)；check 干净 |
| 3 | `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/ws-replication/test/ws-replication-issue246-interop-matrix.test.ts` | `Test Files 1 passed (1)` / `Tests 4 passed (4)` / `Type Errors no errors`，tests 67ms |
| 4 | 同上 ×20（串行、每次全新进程=全新随机 Yjs clientID） | `run=1..20 exit=0  Tests 4 passed (4)`，`summary: 20 runs, 0 failed` → `artifacts/sa7-issue246-fileB-20x.log` |
| 5 | `… vitest run packages/ws-replication/test/ws-replication-issue233-repro.test.ts` | 3/3 绿（v1 基线） |
| 6 | `… vitest run packages/ws-replication/test/ws-replication-issue243-real-transport.test.ts packages/ws-replication/test/ws-replication-issue243-chunked-live.test.ts` | 2 文件 17/17 绿（真实 TCP 协商分块主链路 + live 构型） |
| 7 | `… vitest run packages/replication-protocol/test/codec-issue246-doc-contract.test.ts` | 22/22 绿 |
| 8 | `… vitest run packages/replication-protocol/test/codec-version-interop.test.ts codec-messages-golden.test.ts codec-issue242-ac-red.test.ts` | 3 文件 80/80 绿 |
| 9 | AC5 六查：`grep -rn "提议" docs/ CONTEXT.md`；`grep -n "状态：提议" docs/adr/0013-*.md`；`grep -n "ADR 0013 提议" CONTEXT.md`；`grep -n "属后续切片" docs/protocols/instance-replication-v1.md`；`grep -n "后续切片承接" CONTEXT.md`；`grep -nE "UPDATE_CHUNK\|CAP_CHUNKED\|分块" docs/adr/0010-*.md` | 六者全部零命中（exit=1） |
| 10 | `grep -rn "SA7-DATAFLOW"`（全仓，排除 wiki/raw） | 零命中（零临时诊断） |

## 11. Deviations

1. **未运行全仓 `pnpm test` / 根 `pnpm typecheck`**：SA7 职责边界不运行一般回归；全量证据由 SA3 iteration 3 留档（304 files / 3261 tests 全绿 + 根 typecheck 绿），且本轮已 md5 证明工作树与其证据对象逐字节一致（零漂移 ⇒ 该证据仍有效覆盖当前状态）。两个新测试文件的类型面由每次 vitest 运行的 `Type Errors no errors` 在位复验（×22 次）。
2. **N-OBS1 维持登记不处理**：File A D2-3 错误码同句存在性锚对「两码对调」不敏感——SA4/SA3 均已登记为非阻断后续测试强化票，非 material defect（当前文本三向正确性另由 D5-1 恒绿锚 + 本轮 #243/#233 行为面复核佐证）。
3. **SA3 的 ×20 不被采信为本轮结论来源**：本轮以独立 20 次全新进程重跑作为正式验收（SA3 日志仅作先例参照）；两者结论一致（20/20）。
4. 无其他偏差；无阻塞。

## 12. Verdict

**approve**。

- 批准终版核验：五文件 md5 与 SA4 approve 基线逐字节一致，diff 3 files/36+/8-，`git diff --check` 干净——「approved final diff」零漂移。
- 必需动态/重复证据：M2（含对称 hub 写腿与三层确定性等同）随 File B 全矩阵 **20/20 次全新进程重复运行零假红**（设计 §12.5 F1 正式验收完成）；真实 transport 协商分块主链路、#233 v1 基线、codec 三锚、File A 22 条全绿。
- 5 条 AC 动态面全数成立：AC1/AC2/AC4（File A 22/22 + 三锚 80/80）、AC3（矩阵 ×21 绿 + 基线 3/3 + real-transport）、AC5（六查零命中 + diff --check 干净）。
- 零临时诊断、零生产改动、零残留（运行后 md5/status 复测一致）；唯一登记项 N-OBS1 为既登记非阻断后续票。
- 未发现 material defect。SA4 approve 维持；本票动态验证闭合，无待办阻塞项（N-OBS1 归后续强化票）。
