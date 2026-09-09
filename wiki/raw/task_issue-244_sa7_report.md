# SA7 动态验证报告 — Issue #244（issue #233 切片 3：分块传输有界性加固与中止清理矩阵）— final verification

- Dispatch：`sa-ed600f5c-97ec-4f22-8a25-00b5c87c79af`（mabf-sa7 / final-verification / iteration 0）
- 验证对象：worktree `nomicore-fix-issue-244`（branch `mabf/issue-244`，基线 HEAD `e2178f3`）当前**未提交**最终实现树 = SA3 iteration 0 全量 + iteration 1（SA4-1 槽位归还修复 + REG1–REG3）+ iteration 2（SA4-2 双键门收口）+ SA6 iteration 1 契约（14 用例）
- 上游 verdict 链（本轮输入）：SA4 iteration-1 **approve**（0 BLOCKER/MAJOR）、SA9 standards **approve**（3 MINOR）、SA10 spec **approve**、SA2 approve、SA8 三轮 clear、SA6 iteration-1 approve
- 方法：真实运行链路验证（真实 yjs / Registry / Runtime / fake-duplex + fake scheduler 虚拟时间，与契约套件同 seam）——复跑 SA6 契约与 REG 回归、新写 11 用例动态补充套件（`ws-replication-issue244-sa7-dynamic.test.ts`）驱动 SA4 §10「后续动态验证项」全部三行动态面 + 五行 reason 接线双侧，另以一次性诊断探针复核 SA9-M3；全量回归与类型门复跑留痕
- 证据日志：`artifacts/sa7-issue244-final-verify.log`（逐命令输出）
- **结论：approve** —— 六项需运行时证据的行为面全部动态成立；SA4 §10 三行残差 + 五行 reason 接线（含 `side` 双侧）+ 中止型槽位归还全部获得运行时证据；SA9-M3 静态窄边在公网路径四步构造下未复现；无新增阻断项

---

## 0. Step 0/1 结论（先决门）

| 门 | 结果 |
|---|---|
| Step 0 — SA4 verdict | `task_issue-244_sa4_review.md` 顶部结论行 = **approve**（前轮 SA4-1 BLOCKER / SA4-2 MAJOR 均已闭环，无新增 BLOCKER/MAJOR）→ 进入动态验证（SA4 pass 是 SA7 前提；本报告只可独立发现 fail，未发现） |
| Step 1 — SA6 红灯契约 + SA4-1 回归（fresh 复跑） | 契约 14/14 绿（R1a/R1b/**R1c**/R2/R3/R4/R5a/R5b + N1–N4/**N5/N6**）+ REG 3/3 绿 = **17/17**，Type Errors no errors（verify.log §[2]） |

**本轮验证的行为面与 dispatch 要求映射**：bounded chunk admission（契约 R2/N2/R4 复跑绿）· dual-key construction validation（契约 R1c/N5/N6 复跑绿）· slot acquire/release across completion/abort/reconnect（REG1–REG3 复跑绿 + 本文件 D-SLOT1/D-SLOT2 补中止型归还面）· sliding expiry and RESYNC convergence（契约 R3/N4 复跑绿 + D-SLIDE 补跨窗形态）· teardown observer reason wiring（契约 R3/R5a/R5b 复跑绿 + 本文件 D-RD/D-QO/D-SHED/D-FENCE/D-GOAWAY 补五行接线）· no partial durable writes（全部用例内嵌断言）。

## 1. SA4 §10「后续动态验证项」逐行闭环（本轮核心清单）

| SA4 §10 行 | 本轮动态场景（新增用例） | 运行时观测 | Verdict |
|---|---|---|---|
| 行 1：中止型槽位归还（timeout/收口 caller）后新 distinct ns 首 chunk 接纳 | **D-SLOT1**（hub · timeout caller）：ns-a partial 停滞 31s 超时中止（aborted{timeout} 恰一 + §9.4 恢复 round 收敛）→ 同连接串行完成 b/c/d → 第 5/第 6 个 distinct ns（e/f）整笔收敛 | e/f 各 3-chunk 单 transferId 收敛、saveDelta===1、**零 UPDATE_TRANSFER_VIOLATION**、双侧零 failed、连接全程 ready——timeout caller 归还闭环成立（若泄漏 a 槽，e 为第 5 持槽者必误 VIOLATION） | **pass** |
| （同上 · 收口 caller × 跨代际） | **D-SLOT2**（peer · connection-teardown caller）：代际 1 ns-a partial 下行被断线中止（aborted{connection-teardown, side:peer} 恰一、receivedChunks=1、peer doc 'seed'、零 durable 写入）→ 重拨新代际 → 串行完成 b/c/d → e/f 收敛 | 新代际 5 笔全部整笔收敛、saveDelta===1、**零 VIOLATION**、跨代际零 failed——abort 型归还跨 `PeerConnectionImpl` 拨号代际成立（REG3 只锁完成型，本例锁中止型） | **pass** |
| 行 2：shed/epoch-fence/GOAWAY/queue-overflow/resync-declared 五行动态断言 + `side` 双侧 | **D-RD1/D-RD2**（resync-declared 行·收对端声明边，hub/peer 双侧）、**D-QO1/D-QO2**（queue-overflow 行·本端声明漏斗，hub/peer 双侧）、**D-SHED1/D-SHED2**（shed 行·连接级背压弃置，hub/peer 双侧）、**D-FENCE**（epoch-fence 行，hub/peer 同场景双侧 + `side` 字段逐侧断言）、**D-GOAWAY**（GOAWAY drain 行·R13 归并 connection-teardown，peer 侧） | 每行：busy 在场时 `chunked-update-aborted{reason}` **恰一** + `side` 字面量正确（hub/peer）+ receivedChunks=1/receivedBytes>0 + 互补事件在场（resync-required{remote-declared/queue-overflow/connection-shed}、identity-conflicted、IDENTITY_CHANGED wire 帧）+ 零 ERROR 违例帧 + 零 failed（fence=conflicted 族除外——非 failed）+ **零部分写入**；cause 判别正确（connection-shed → 'shed'，其余声明 → 'resync-declared'，D-SHED 断言不互串）；D-RD2 同时证明 busy 守卫（hub 声明时自身入站不 busy → hub 零事件） | **pass** |
| 行 3：跨窗滑动形态（chunk1@T+20s、chunk2@T+40s 均不超窗） | **D-SLIDE**：chunk0@t0 → 20s 停滞 → drip 放行 chunk1@≈t20.7s → 19.3s 停滞 → drip 放行 chunk2@≈t40.7s（累计 ≈40.7s > 缺省 30s 窗、逐段 < 30s） | 全程**零 RESYNC_REQUIRED{UPDATE_TRANSFER_EXPIRED}、零 aborted{timeout}**；收齐恰一次 apply（saveDelta===1）+ 单 ACK + 3 chunk 单 transferId + 回 live；完成后再推进 31s 零动作（busy→idle 清 timer）——deadline 确随每 chunk 到达重置（若 deadline 固定于 chunk0，t=30s 必误触发） | **pass** |
| 行 4：`new Uint8Array(totalBytes)` 极端内存压力同步抛出 | 未构造（SA4 已标注「进程级故障注入——超出本切片验收面」；accept 分配恒在 validateFirst 两维上界后，R2/N2/K4 契约面已锁） | — | 非目标（维持 SA4 口径） |

## 2. 五行 reason 接线逐用例明细（Step 2 清单驱动验证）

| 用例 | 行 | 驱动输入（真实链路） | 每跳运行时证据 | 最终读取/投影 | 错误与 cleanup 证据 | Verdict |
|---|---|---|---|---|---|---|
| D-RD1 | resync-declared（hub 侧收对端声明边） | peer data 闸门停摆 chunk0 后注入 RESYNC_REQUIRED 帧（发送方静默窗口，序列=接收端期望） | wire 帧（peerToHub RESYNC）→ hub `onResyncReceived` → aborted{resync-declared, side:hub, receivedChunks:1} 恰一 + 互补 resync-required{remote-declared} 恰一 | hub doc 'seed'、saveDelta 0（弃 partial 零 apply） | 零 ERROR、零 failed；放行残渣 chunk1/2 → needs-resync 域**良性丢弃**（零违例零 apply） | pass |
| D-RD2 | resync-declared（peer 侧收对端声明边） | hub 真实声明（出向队列溢出 24KiB 门）→ RESYNC_REQUIRED{send-queue-overflow} 真帧到达 busy peer | wire 帧（hubToPeer RESYNC）→ peer aborted{resync-declared, side:peer} 恰一 + remote-declared 恰一；**hub 自身入站不 busy → hub 零事件**（busy 守卫动态证） | peer 恢复 round（Step1/2 control 不受 data 闸门）→ BIG 整笔收敛 + saveDelta===1 | 零 ERROR、双侧零 failed | pass |
| D-QO1 | queue-overflow（hub 本端漏斗） | hub data 闸门关死 + 3×20KB 写（45KiB 队列门，第 3 笔溢出） | 入队溢出 → declareHubResync('queue-overflow') → aborted{resync-declared, side:hub, receivedChunks:1} 恰一 + RESYNC_REQUIRED{send-queue-overflow}（wire）+ resync-required{queue-overflow} 恰一 | hub 本地写整值 BIG；peer 经 round 整值收敛 | 零 ERROR 违例帧（needs-resync 软收口）、零 failed | pass |
| D-QO2 | queue-overflow（peer 本端漏斗） | 镜像：peer 闸门关死 + 3×20KB 写 | peer aborted{resync-declared, side:peer} 恰一 + RESYNC peerToHub + resync-required{queue-overflow}（peer 侧）恰一 | hub 经 round 收敛 BIG；peer 本地写整值在场 | 零 failed | pass |
| D-SHED1 | shed（hub · 连接级背压弃置） | maxQueuedBytesPerConnection 256KiB（同步下调 highWater 128KiB/lowWater 16KiB 合法链）+ hub 闸门伪 bufferedAmount 600KiB + 首个 data 入队 | enforceConnectionCap 总压超限 → victim ns 弃置 → live 通道声明边 → aborted{shed, side:hub, receivedChunks:1} 恰一 + RESYNC_REQUIRED{send-queue-overflow} + resync-required{connection-shed} 恰一；**零 resync-declared 误标**（cause 判别） | hub 本地写整值 BIG；peer 经 round 收敛 | 零 ERROR、零 failed | pass |
| D-SHED2 | shed（peer · 连接级背压弃置） | 镜像（peer 侧总压超限） | peer aborted{shed, side:peer} 恰一 + RESYNC peerToHub + resync-required{connection-shed}（peer 侧）恰一；零误标 | hub 经 round 收敛 BIG；peer 本地写整值在场 | 零 failed | pass |
| D-FENCE | epoch-fence（conflicted 族 carve-out：fence **发射**） | 双侧 busy（peer 写 BIG_P / hub 写 BIG_H，各 chunk0 出站后停摆）→ hub lease `bumpReplicationEpoch()` → 推进 6s（ackTimeoutMs=5s 探测节奏） | hub：aborted{epoch-fence, side:hub, receivedChunks:1} 恰一 + IDENTITY_CHANGED 恰一帧 + identity-conflicted 恰一；peer：IDENTITY_CHANGED 到达 → aborted{epoch-fence, side:peer, receivedChunks:1} 恰一 + identity-conflicted 恰一 | 双向哨兵保持：peer blurb=BIG_P（BIG_H 零落地）、hub blurb=BIG_H（BIG_P 零落地）——**双向零部分写入**；peer saveDelta 0、hub 唯一新增 = epoch bump META 落盘 | fence=conflicted 族（双侧零 namespace-failed）；peer ns 终局 conflicted | pass |
| D-GOAWAY | GOAWAY drain（R13 归并 connection-teardown） | peer busy（hub chunk0 下行）+ 注入 GOAWAY{SERVER_RESTARTING, drainTimeoutMs:3000} → draining → 推进 3.5s deadline | drain deadline `quiesceControllers → onConnectionFatal` 置因 → disposal 消费 → aborted{connection-teardown, side:peer, receivedChunks:1} 恰一；close(1001) 后（harness 以 closePeerSide 同模交付本地 close 事件）backoff 重拨 | peer doc 'seed' + saveDelta 0（零部分写入、零 durable）；重连后经既有 reconciliation 整笔收敛 BIG 并回 live | GOAWAY=临时失败面：零 namespace-failed；中止事件恰一保持（恢复后不重复） | pass |

## 3. 数据流路线动态证据（Step 2.5 — 对照 SA1 设计 §8.4 路线表）

| 路线 | 驱动输入 | 每跳运行时证据 | 最终读取/投影 | 错误与 cleanup 证据 | Verdict |
|---|---|---|---|---|---|
| 恶意 count 申报（R2 复跑） | 注入 chunkCount=65_536 首 chunk | D2 门先于槽获取/accept → ns ERROR{UPDATE_TRANSFER_TOO_LARGE} wire 帧 | hub 终局 failed ×1、doc 'seed'、saveDelta 0、零 ACK | assembly 保持 idle、槽未占 | pass |
| 并发超额（R4 复跑） | 单连接 5 ns 并发首 chunk | 连接级 Set 判满 → 第 5 ns ERROR{UPDATE_TRANSFER_VIOLATION} | victim failed、4 健康 ns 各恰一次 apply、连接 ready | 其余 4 槽不动（slot 隔离） | pass |
| 停滞超时（R3 复跑 + D-SLOT1） | data 闸门停摆 + 推进 31s | timer fire → 弃 partial → RESYNC_REQUIRED{UPDATE_TRANSFER_EXPIRED} wire → aborted{timeout} 恰一 | 双侧零 failed、恢复 round 整笔收敛、新写自愈 | 槽归还 + timer 清 + needs-resync + resyncEpisode；D-SLOT1 证归还后第 5/6 distinct ns 接纳 | pass |
| 通道收口中止（R5a 复跑） | removeTarget → CLOSE_NAMESPACE | teardownAbortReason 记忆位 → 收口链 clear → aborted{channel-teardown} 恰一 | doc 'seed'、saveDelta 0、零 failed | 槽/timer 清 | pass |
| 连接断线中止（R5b 复跑 + D-SLOT2/D-GOAWAY） | closePeerSide(1006) / GOAWAY drain deadline | 失联入口（/drain quiesce→fatal）置因 → disposal 消费 → aborted{connection-teardown} 恰一（含 side:peer 镜像） | doc 'seed'、saveDelta 0、零 failed；重连后 reconciliation 收敛 | 跨代际槽归还（D-SLOT2 e/f 接纳） | pass |
| 中止矩阵五行（新增 §2 表） | shed/queue-overflow/resync-declared/epoch-fence/GOAWAY | 每行 aborted{reason} 恰一 + `side` 正确 + 互补事件在场 | 各终态/恢复态正确投影 | 零部分写入、零误标、零 spurious | pass |
| 健康 transfer（N3 复跑 + D-SLIDE） | 合法 3-chunk（含跨窗滑动形态） | 分块→重组→恰一次 sequenced apply→单 ACK | 收敛、零 RESYNC、零事件、saveDelta===1 | complete → 槽/timer 清（完成后 31s 推进零动作） | pass |

跨边界结论：唯一 wire 新形态 = 既有 `RESYNC_REQUIRED` 帧型携带已登记 reasonCode（D-SLIDE 断言健康路径零 RESYNC；五行场景 RESYNC 均带 `send-queue-overflow`/超时行带 `UPDATE_TRANSFER_EXPIRED`——R3/RD/QO/SHED 逐帧取证）；事件为 local seam 零 wire；**零持久化新面**——全部中止/违例路径 saveDelta=0 或哨兵值保持，apply 只在 complete 后（D-FENCE 双向哨兵 + 各用例 saveCount 断言）。

## 4. SA9-M3 残留位诊断探针（一次性，未入套件）

- 场景（SA9 §6-M3 四步序列公网路径构造）：`removeTarget`（peer 控制器终态 closed）→ `closePeerSide(1006)`（onConnectionLost :1010 置位先于 :1012 closed 早退——静态残留点）→ `addTarget` 复用控制器（peer-connection :282-287 requestRebuild('re-add')）→ 新代际 hub→peer chunk0（busy）→ 注入 `ERROR{UPDATE_TRANSFER_VIOLATION}`（failed 族终局）。
- 观测：**aborted events=[]（零 spurious chunked-update-aborted）**；互补面正确（namespace-error=1、namespace-failed=1）；peer doc 'seed'（零部分写入）。
- 结论：M3 静态窄边在该构造下**未复现**——残留位在重建链路中被无害消费/清除（busy 守卫至多一事件 + 重建路径先清位的合成效果）。SA9 的 follow-up 硬化建议（早退分支清位/代际重置清位）维持登记为非阻断 MINOR；不构成本切片动态阻断项。探针文件运行后已删除（`[SA7-DIAG]` 一次性诊断纪律）。

## 5. 验证门与留痕（`artifacts/sa7-issue244-final-verify.log`）

| 门 | 命令 | 结果 |
|---|---|---|
| 契约 + REG（fresh） | `vitest run …issue244-ac-red.test.ts …slot-reclaim-regression.test.ts` | 17/17 passed |
| SA7 动态套件确定性 | `vitest run …issue244-sa7-dynamic.test.ts` ×3 | 3× 11/11 passed |
| 全包回归 | `vitest run packages/ws-replication/test` | **63 文件 / 462 测试 passed**（62/451 + 新 11） |
| 包类型面 | `tsc -p packages/ws-replication/tsconfig.json` | exit 0 |
| 根类型面 | `pnpm typecheck`（14 项目） | exit 0 |
| 根测试面 | `pnpm test`（vitest --typecheck 全仓） | **301 文件 / 3225 测试 passed**（300/3214 + 新 11）；Type Errors no errors |
| 卫生 | `git diff --check` | clean（exit 0） |

## 6. Spec/vitest 触发证据（Step 3/4 口径）

- **E2E spec（Step 3）**：本任务设计（§11）与 SA6 契约均**不含** `*.spec.ts` 文件——触发条件不成立，N/A。
- **vitest（Step 4）**：新增 `packages/ws-replication/test/ws-replication-issue244-sa7-dynamic.test.ts` 被根 `vitest.config.ts` include（`packages/*/test/**/*.test.ts`）真实发现并运行（全包回归 63 文件含本文件、11 用例全绿；根 `pnpm test` 同）。**CI runner 侧证据**：本轮未 push/建 PR（SA7 权限边界——push/PR/CI 归总控）；总控合入后按 Step 4 程序以 `gh run view` 摘录 `ws-replication` 包 job log 的 `Test Files … passed (63)` 行补登。

## 7. 约束与产物

- 生产代码零改动（`git status`：本轮仅新增测试文件 + wiki/证据产物）；冻结契约 `ws-replication-issue244-ac-red.test.ts`、REG 文件、issue243/233 套件、`harness.ts`、DENY 面零触碰。
- 测试纪律：全部行为断言（wire 帧/observer 事件/持久化计数/状态投影）；零源码 grep；零 real sleep（虚拟时钟 advanceBy + 微任务排空）；无 skip/only/todo；闸门/注入经 transport seam（与既有套件同惯例——`bufferedAmount` 伪压/帧注入均模拟真实 WS 语义，harness 保真度注记沿用）。

## 8. 结论

| 需运行时证据的行为面 | 动态证据来源 | Verdict |
|---|---|---|
| bounded chunk admission（count 门/totalBytes 门/并发槽） | 契约 R2/N2/R4 复跑绿（17/17） | ✅ |
| dual-key construction validation（双激活键门 + 非追溯边界） | 契约 R1a/R1b/R1c/N1/N5/N6 复跑绿 | ✅ |
| slot acquire/release across completion/abort/reconnect | REG1–REG3 复跑绿 + **D-SLOT1**（timeout caller）/ **D-SLOT2**（teardown caller × 跨代际） | ✅ |
| sliding expiry and RESYNC convergence | 契约 R3/N4 复跑绿 + **D-SLIDE**（跨窗滑动形态，累计 40.7s > 30s 窗零误报） | ✅ |
| teardown observer reason wiring（六 reason 全接线 + side 双侧） | 契约 R3/R5a/R5b 复跑绿 + **D-RD1/D-RD2/D-QO1/D-QO2/D-SHED1/D-SHED2/D-FENCE/D-GOAWAY**（五行 + 双侧 + cause 判别 + busy 守卫） | ✅ |
| no partial durable writes | 全部用例内嵌（saveDelta=0 / 哨兵值保持 / 'seed' 投影 / D-FENCE 双向哨兵） | ✅ |

**verdict = approve**。SA4/SA9/SA10 静态链全 approve 之上，SA4 §10 全部三行动态残差、设计 §13/SA6 §15 登记的五行事件动态断言 + `side` 双侧覆盖、SA9-O3/SA10-O3 中止型槽位归还回归缺口均以运行时证据闭环；SA9-M3 探针未复现（维持非阻断登记）。`requiresConflictRecheck = false`（无设计修订、无冻结面触碰）。

## 附：artifactPaths（worktree-relative）

1. `packages/ws-replication/test/ws-replication-issue244-sa7-dynamic.test.ts` —— SA7 动态补充套件（11 用例；确定性 ×3 绿；tsc 干净）
2. `artifacts/sa7-issue244-final-verify.log` —— 本轮验证证据日志（契约/REG 复跑、×3 确定性、全包/根门、diff-check、M3 探针记录）
3. `wiki/raw/task_issue-244_sa7_report.md` —— 本报告
