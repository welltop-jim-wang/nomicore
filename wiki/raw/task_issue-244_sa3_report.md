# SA3 实现报告 — issue #244：分块传输有界性加固与中止清理矩阵（issue #233 切片 3）— iteration 1（SA4-1 返工）

- Dispatch（iteration 0）：`sa-884de57f-d0cc-43a8-987d-435e8fb70619`（mabf-sa3 / implementation）
- Dispatch（本 iteration）：`sa-37f06ab8-1c8e-47bf-b6ac-37427ed7b98b`（mabf-sa3 / implementation / iteration 1）——Issue #244：SA4 reject（BLOCKER SA4-1）→ 修复连接级入站 assembly 槽位生命周期 + 回归测试（>4 串行完成的跨 namespace 分块传输后合法首 chunk 必须被接纳）；不弱化既有验收测试。
- 依据：SA1 设计（D1–D8、ALLOW/DENY）+ SA2 评审（approve；R11–R14/W1/W2）+ SA6 契约（R1a–R5b/N1–N4）+ SA8 两轮 clear + SA4 评审 `wiki/raw/task_issue-244_sa4_review.md`（reject：SA4-1 BLOCKER + SA4-2 MAJOR + O1–O6）。
- 结果：**SA4-1 修复完成**（2 生产文件各 1 处置位）；新增 3 例回归测试（hub 入站串行 / peer 入站串行 / peer 断线重连跨代际），**修复前逐例红（第 5 个 distinct ns 合法首 chunk 误 `UPDATE_TRANSFER_VIOLATION`）、修复后全绿**；SA6 红灯契约 **11/11 绿**（文件零改动）；全包回归绿；包 typecheck exit 0。
- SA4-2（MAJOR，跨字段链生效口径）不在本 dispatch 范围：SA4 §9 已路由 design + acceptance-contract 显式收口，本 iteration 零触碰（见 §6）。
- 验证留痕：`artifacts/sa3-issue244-iter1-verify.log`（逐命令输出，SA4 O3 修正）。

## 1. 本 iteration 改动（SA4-1 修复面）

### 1.1 根因与修复

SA4-1：两通道（hub `onUpdateChunk` / peer `onHubUpdateChunk`）idle 首 chunk 准入成功处只调用了连接侧 `host.tryBeginInboundAssembly(ns)`（写入连接级 `inboundAssemblySlots` Set），**从未置位通道侧镜像旗标 `assemblySlotHeld`**——`endAssemblyScope()` 的归还守卫 `if (!this.assemblySlotHeld) return;` 恒早退，`host.endInboundAssembly`（唯一归还调用点）不可达 → Set 只增不减 → 第 5 个 distinct ns 起任何后续新 ns 的合法首 chunk 永久误 `UPDATE_TRANSFER_VIOLATION` + 终局 failed（hub 侧持续连接生命周期；peer 侧 `PeerConnectionImpl` 跨拨号代际存活 → 跨代际累积）。既有绿灯全部掩盖（R4 止于 5 ns 并发不再新增 ns；同 ns 重试被 `has(ns)→true` 幂等吸收）。

修复（获取-归还闭环的唯一缺口补位——槽获取唯一点 = 首 chunk 准入成功处、accept 之前同步置位镜像旗标）：

| 文件 | 位置 | 改动 |
|---|---|---|
| `packages/ws-replication/src/hub-namespace.ts` | `onUpdateChunk` idle 首 chunk 尾段（D2 门后、`tryBeginInboundAssembly` 返回 true 后、`afterAssemblyAccept`/accept 前） | `this.assemblySlotHeld = true;`（含 SA4-1 注释：单 chunk 即收齐/首 chunk 即违例的 `!busy` 出口在同一同步段内经 `endAssemblyScope` 幂等归还） |
| `packages/ws-replication/src/peer-namespace.ts` | `onHubUpdateChunk` 同构位置 | 同上（对称） |

归还面零改动：`endAssemblyScope`（complete / 首 chunk 即违例 / busy 违例 / 超时 / 全部清理挂点经 `clearInboundAssembly`）仍为唯一归还汇入点；连接侧 `endInboundAssembly` 幂等 delete；busy→idle 与旗标-集合镜像对称性恢复（SA4 §5「对称性断裂」消除）。单 chunk transfer（chunkCount===1）在 accept 内即 complete → `afterAssemblyAccept` `!busy` 出口即时归还——置位必须发生在 accept 之前，本修复即此序。

### 1.2 回归测试（新文件，SA4 §9 SA4-1 acceptance 面）

`packages/ws-replication/test/ws-replication-issue244-slot-reclaim-regression.test.ts`（新增；契约文件零改动）——单连接 6 个 distinct ns（TAGS a–f），真实 chunked 协商 + `BIG`(20KB) > maxUpdateBytes 8KiB → 每笔恰 3 chunk 分块帧（每 ns 断言 ≥2–3 帧 + transferId 单一，证明 chunked 路径真实走通——否则 D3 槽位门不被触发，回归即失效）：

| 用例 | 场景 | 修复前（实测红） | 修复后（实测绿） |
|---|---|---|---|
| REG1（hub 入站 · peer→hub） | a→f 六 ns **串行**整笔分块 transfer（每笔收齐后才发起下一笔）；每 ns 恰一次 apply；零 VIOLATION/零 failed/连接 ready | ns-e（第 5 个 distinct ns）合法首 chunk 误 `UPDATE_TRANSFER_VIOLATION` → 永不收敛 | 6/6 收敛（e、f 均被接纳）；每 ns 恰 3 chunk、恰一次 apply |
| REG2（peer 入站 · hub→peer） | 同构镜像：hub 业务写六 ns 分块下行，peer 串行收齐 | ns-e 误 `UPDATE_TRANSFER_VIOLATION`（peer 侧槽泄漏） | 6/6 收敛 |
| REG3（peer 入站 · 断线重连跨代际） | 代际 1 串行完成 a–d 四笔 → `closePeerSide(1006)` 网络断线 → 自动退避重拨（断言 dials 1→2、新代际 ready + 全 ns live）→ 代际 2 对**此前从未传输**的新 ns e、f 分块传输 | 代际 1 泄漏的 4 槽跨代际存活 → 代际 2 ns-e 误 VIOLATION | 代际 2 e、f 均正常收敛，零 failed |

## 2. Changed paths（worktree-relative；`git status`/`git diff` 实测）

**本 iteration 改动：**

| Path | ALLOW/DENY 归属 | 改动 |
|---|---|---|
| `packages/ws-replication/src/hub-namespace.ts` | ALLOW（设计在册） | +`assemblySlotHeld = true`（§1.1） |
| `packages/ws-replication/src/peer-namespace.ts` | ALLOW（设计在册） | 同上（对称） |
| `packages/ws-replication/test/ws-replication-issue244-slot-reclaim-regression.test.ts` | **新增测试文件**（不在设计 ALLOW 清单、不在 DENY）——dispatch + SA4 §9 SA4-1 Required change 明确要求新增回归测试；不改动任何既有测试文件 | REG1–REG3（§1.2） |
| `artifacts/sa3-issue244-iter1-verify.log` | 报告证据留痕 | 验证输出日志 |
| `wiki/raw/task_issue-244_sa3_report.md` | 本报告 | 原位更新 |

**iteration 0 既有改动（本 iteration 未触碰，仍为当前实现面）：** `types.ts`、`defaults.ts`、`validate.ts`、`plugin.ts`、`update-transfer.ts`（snapshot()）、`hub-connection.ts`、`peer-connection.ts`（D3 Set + 两 facet + 显式链构造期门）、`docs/protocols/instance-replication-v1.md`（§9.4/§13.2/§17/§18/§23.1）、`test/ws-replication-api.test-d.ts`、`test/ws-replication-observer-red.test.ts`（后两者 = 类型面加宽的强制编译联动，SA4 O2 已记录建议设计侧补登）。

**DENY 面零触碰**：`replication-protocol/**`、`update-channel.ts`、`docs/adr/**`、`CONTEXT.md`、`apps/**`、`src/index.ts`、issue243/233 套件、`test/harness.ts`、SA6 契约文件 `ws-replication-issue244-ac-red.test.ts`。

## 3. SA4 Required revisions 落实

| Finding | Severity | 处置 | 结果 |
|---|---|---|---|
| SA4-1 槽位归还死代码（`assemblySlotHeld` 永不置位 → `endInboundAssembly` 不可达 → 槽位只增不减 → 第 5+ 个 distinct ns 合法流量永久误 VIOLATION） | BLOCKER | 两通道准入成功处置位（§1.1）；回归三例（§1.2）修复前实测红/修复后绿 | **修复完成**（SA4 acceptance 判据逐条满足：4 健康 ns 收齐后第 5/第 6 个新 ns 传输正常收敛、零 VIOLATION、零 failed；peer 断线重连新代际后新 ns 传输正常；修复前该测试红——见证据日志 [1]/[3]） |
| SA4-2 跨字段链生效口径（显式 `maxChunkedUpdateBytes` 才校验）与批准设计 D1 相悖 | MAJOR | 按 SA4 §9 路由 = design + acceptance-contract 二选一显式收口（实现侧保持现状、协议 §17 注记如实）——**非本 dispatch 范围，本 iteration 零触碰**（改动需 SA1/SA6 修订授权） | 待 design/契约轮 |
| O1 R3 断言重排 | 非阻断 | 保持 iteration 0 状态（断言逐字保留） | — |
| O2 测试文件超 ALLOW | 非阻断 | iteration 1 新增回归文件同属此类（dispatch 授权）；建议设计侧补登 ALLOW 注记 | 记录 |
| O3 验证留痕缺口 | 非阻断 | 本 iteration 附 `artifacts/sa3-issue244-iter1-verify.log` 逐命令输出 | 修正 |

## 4. Verification（本 iteration）

| 门 | 命令 | 结果 | 证据 |
|---|---|---|---|
| 回归（修复前红） | `vitest run packages/ws-replication/test/ws-replication-issue244-slot-reclaim-regression.test.ts` | 3 failed——逐例在 ns-e（第 5 个 distinct ns）`expected [ 'UPDATE_TRANSFER_VIOLATION' ] … got 1` | `artifacts/sa3-issue244-iter1-verify.log` §[1] |
| 回归（修复后绿） | 同上 | 3 passed；Type Errors no errors | 日志 §[3] |
| 回归确定性 | 同上 ×3 连续 | 3× 3 passed | 日志 §[9] |
| SA6 契约（文件零改动） | `vitest run packages/ws-replication/test/ws-replication-issue244-ac-red.test.ts` | 11/11 passed（R1a–R5b、N1–N4）；Type Errors no errors | 日志 §[4] |
| 全包回归 | `vitest run packages/ws-replication/test` | 62 files / 448 tests passed（61/445 + 回归文件 1/3）；Type Errors no errors | 日志 §[5] |
| 包类型面 | `pnpm exec tsc -p packages/ws-replication/tsconfig.json` | exit 0 | 日志 §[6] |
| 根类型面 | `pnpm typecheck`（14 包/app） | exit 0 | 日志 §[7] |
| 根测试面 | `pnpm test`（vitest --typecheck 全仓） | 300 files / 3211 tests passed；exit 0 | 日志 §[8] |

## 5. 既有实现面摘要（iteration 0 交付，本 iteration 保持）

- D1 配置面：三新键缺省（64/4/30_000）+ 键表 + 正整数门 + 跨字段链（生效口径见 §6）；零运行时 clamp。
- D2 count 准入门（`>` 判定保 ==64 边界）→ TOO_LARGE；D3 连接级槽位（Set + tryBegin/end 两 facet，**本 iteration 修复归还路径**）；D4 滑动 assembly 超时（timer 槽位扩展、独立发射点 RESYNC{UPDATE_TRANSFER_EXPIRED}、收敛链复用既有 round）；D5 第 23 型 `chunked-update-aborted` 事件（六 reason 全接线 + `side` + busy 守卫 + 快照先于 reset + 决策落定后发射；failed 族 carve-out）；R11 shed/epoch-fence wiring；R12 side 字段；R13 GOAWAY=connection-teardown；D8 协议文档五处。

## 6. SA4-2 状态（未处置——路由归属 design/contract）

跨字段链生效口径 = 仅显式配置 `maxChunkedUpdateBytes` 时校验（`validateChunkedTransferChain`，双构造入口 `hasOwnProperty` 门）——SA4 判 MAJOR 且与批准设计 D1「合并结果上校验」相悖，但严格合并值校验与 SA6 冻结 fixture（`LIMITS` 不含 `maxChunkedUpdateBytes`、4MiB 缺省 > 1MiB）及受保护 slice-2 套件不可同时满足（设计 D1 与设计 §12 内部矛盾）。SA4 §9 要求 design + acceptance-contract 显式收口（(a) 固化显式口径 + 契约补边界例，或 (b) 修订冻结 fixture 后改回全量校验）；协议 §17 注记已如实登记当前口径。**本 dispatch（SA3 iteration 1）只含 SA4-1，该裁决不属实现侧授权，零触碰。**

## 7. Deferred verification

- SA4-1 修复的动态面（回归已覆盖 hub/peer 两方向 + 跨代际；`side` 双侧断言、shed/epoch-fence/GOAWAY/queue-overflow/resync-declared 五行动态断言）归 SA7 既有规划。
- 跨窗滑动形态（chunk1@T+20s、chunk2@T+40s 均不超窗）归 SA7。
- SA4-2 收口（无论方向）后的联动（validate.ts/协议 §17/契约）由 design/contract 轮完成后实现轮承接。

## 8. Deviations or blockers

无阻塞。一处范围注记（非阻断）：新增回归测试文件不在设计 ALLOW 清单（亦不在 DENY），由 dispatch + SA4 Required change 显式授权（SA4 O2 同款形态，建议设计侧补登 ALLOW 注记）。

## 9. Suggested commit message

```
fix(ws-replication): return connection-level inbound assembly slots on completion (SA4-1)

`assemblySlotHeld` mirror flag was never set after tryBeginInboundAssembly
succeeded, so endAssemblyScope's release guard made endInboundAssembly
unreachable and inboundAssemblySlots only grew: after >=4 distinct
namespaces had performed (even sequential, completed) chunked inbound
transfers, any later new namespace's legal first chunk was permanently
mis-rejected with UPDATE_TRANSFER_VIOLATION + terminal failed (hub for the
connection lifetime; peer across dial generations).

Set the mirror flag synchronously at slot acquisition (first-chunk
admission success, before accept) on both hub and peer channels; the
existing endAssemblyScope single release point now returns slots on every
busy->idle exit (complete / first-chunk violation / violation / timeout /
all clearInboundAssembly hooks). Add regression tests: 6 distinct
namespaces with sequential completed chunked transfers converge on hub
inbound (peer->hub) and peer inbound (hub->peer), plus peer inbound across
a disconnect/reconnect generation — all red before the fix at the 5th
distinct namespace with UPDATE_TRANSFER_VIOLATION, green after.
```
