# SA7 动态验证报告 — issue #168（ws-replication: hello 超时同步关闭 peer transport）

**Date**: 2026-08-30（SA4 pass 后独立动态验证轮）
**Verifier**: SA7（Dynamic Verifier）
**Worktree**: `/home/wangjian/nomicore-fix-issue-168`（HEAD `1092d34`，基线 `ffca4f6`）
**Verdict: pass**

---

## Step 0 — SA4 verdict 校对

- `wiki/raw/task_ws-replication-close-peer-transport-synchronously_sa4_review.md` 顶部：`**Verdict**: pass（终裁依据见 §8；动态复核点 3 项移交 SA7，均非阻断）`
- SA4 = pass → SA7 进入验证（不上发限制：SA7 只能在 SA4 pass 基础上独立发现 fail；本轮未发现）。

## Step 1 — SA6 红灯契约复跑（修绿面）

```
$ npx vitest run packages/ws-replication/test/ws-replication-issue168-hello-timeout-close-peer-red.test.ts \
                   packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts
 ✓ …issue168-hello-timeout-close-peer-red.test.ts (3 tests)   ← T1 红转绿 + T2/T3 冻结面绿
 ✓ …sa7-round2-dynamic.test.ts (6 tests)                      ← D5 翻转绿 + D1–D4 绿
 Test Files  2 passed (2) / Tests  9 passed (9) / Type Errors  no errors
```

**结论：🟢 GREEN** — 进入 Step 2 清单驱动验证。

---

## SA4 移交三项动态复核（逐条）

### 移交点 1 — 红基线契约非空转（fixture 修正未使契约空转）：✅

**方法**：scratch 检出（`cp -a` worktree → `/tmp/sa7-scratch-168`），**仅**将 `packages/ws-replication/src/peer-connection.ts` 回退到基线 `ffca4f6`（`git show ffca4f6:… > scratch/…`；scratch 内 `git diff --stat` 确认该文件 −59 行、`detachCloseTimedOutTransport` 不存在），零其他改动。

```
$ npx vitest run …issue168-hello-timeout-close-peer-red.test.ts …sa7-round2-dynamic.test.ts   # 于 scratch
 × T1（red.test.ts）  AssertionError: hello 超时同步关闭 peer 侧旧 transport（孤儿窗口收口）: expected false to be true
                      ❯ ws-replication-issue168-hello-timeout-close-peer-red.test.ts:296:76
 × D5（round2-dynamic）AssertionError: hello 超时同步关闭 peer 侧旧传输（孤儿窗口收口）: expected false to be true
                      ❯ ws-replication-sa7-round2-dynamic.test.ts:802:68
 ✓ T2 / T3（冻结面）+ D1a/D1b/D2/D3/D4（D5 之外的既有锚）= 7 passed
 Tests  2 failed | 7 passed (9)
```

**判定**：仅回退生产改动即令 T1（:296）与 D5（:802）在同消息断言处稳定转红、冻结面 7 项保持绿——SA3 的 fixture 增补（+12 行观测管道/排空）**没有**使契约测试空转；失败行号与 SA4 §4 记录（:296 / 同消息）一致。✅

### 移交点 2 — 真实 adapter hello 路径 close 同步重入语义（R3 实证补全）：✅

SA4 指出：hello 路径此前仅经内存 wire 驱动，且该 wire 的 peer 侧 close() 从不把 close 事件通知回 peer 自己——「close() 派发 onClose 的重入被滤除」缺实证。分两面验证：

**(2a) 生产 adapter 真实链路**（新增 `apps/yjs-server/test/ws-hello-timeout-close-issue168.test.ts`）——使用**生产代码** `wrapWs`（ws 库，hub/peer 双侧）+ `startHubWsServer` upgrade + 真实 Registry/Runtime/yjs + 真实 timer + node loopback；注入仅在 gate 层（首代扣 hub→peer 出站帧 =「hub 无响应」）：

```
$ npx vitest run apps/yjs-server/test/ws-hello-timeout-close-issue168.test.ts    # ×4 次重复全绿（各 ~985ms）
 ✓ RT（1 test, 987ms）
```

断言面（全部通过）：
- **RT-1 序列签名真机面**：peer `close(1001,'hello-timeout')` 的 code/reason **经真实 WS close 握手帧穿越内核 TCP**，hub 侧 'close' 事件观测恰 `{ code: 1001, reason: 'hello-timeout' }`（`hubGate1.hubCloseInfo` toEqual）。
- **RT-2 退订先行实证**：close() 调用入口时刻，peer 侧 gate 活跃 onClose/onMessage 监听数均为 0（closeCalls 账本字段 `closeListeners: 0, messageListeners: 0`）——detach-close 序列「先退订后 close」在生产链路成立。
- **RT-3 真实异步重入零副作用**：ws 客户端 close 握手完成后本地 'close' 事件到达 gate（`innerCloseDeliveries ≥ 1`），该时刻活跃监听为 0（`listenersAtInnerCloseDelivery[0] === 0`）→ PeerConnection 零重入：恰一次 `connection-backoff-scheduled{reason:'hello-timeout', attempt:1}`、零 `connection-failed`、无 socket-closed 二次分类、无 blocked。
- **RT-4 恢复链**：backoff(40ms) → 重拨（gate 放行）→ ready → live（bootstrap 经真实链路收敛）；hub 经真实 close 事件收口旧连接（`hub.connections → 1`）；400ms 稳定窗零复发；旧代传输关闭态保持。
- **非空转锚**：首代 hub→peer 被扣帧数 ≥ 1（超时由 ACK 缺席驱动，非连接失败）；`dialCount===1`（超时前无早熟重拨）。

**(2b) 同步重入注入（epoch 闸纵深）**（新增 `packages/ws-replication/test/ws-replication-sa7-issue168-dynamic.test.ts` V1）——「粘性 adapter」违约注入：退订后监听器仍保留在派发表、close() **同步**派发 onClose 给含已退订者：

```
$ npx vitest run packages/ws-replication/test/ws-replication-sa7-issue168-dynamic.test.ts
 ✓ V1（粘性同步重入）… ✓ V2（hello close-throw）… ✓ V3（pong close-throw）— 3 passed
```

V1 断言面：同步派发真实到达（`syncReentryDeliveries ≥ 1`，注入非空转）；close 调用时刻活跃监听 0/0（退订先行）；**backoff 恰一次且 reason 保持 `hello-timeout`**（若 epoch 闸失效，重入会在 `handshaking` 态经 onClose → `onTemporaryFailure('socket-closed')` 抢先把分类改写——reason 断言即判别器）；零 connection-failed；迟到 in-flight HELLO_ACK 落旧 wire 零扰动；恢复链完好（wire2 ready/live）。

**判定**：真实 adapter 链路上「close → onClose 重入」被退订闸滤除（RT-2/RT-3），退订闸被 adapter 违约绕过时由 epoch 闸独立滤除（V1 + 下述变异 2）——R3 双闸语义在 hello 路径完成实证补全。✅

### 移交点 3 —（可行）close 抛错后 backoff 仍达：✅

内存 wire close 不抛错、helper catch 分支零执行面。V2/V3 以「close() 同步抛错 adapter」覆盖 helper 的两个调用点：

- **V2（hello 路径）**：close 尝试恰 1 次且抛错（`peerCloseThrown` 非空——吸收分支真实执行）；**backoff 必达恰一次 `{hello-timeout, attempt:1}`**、零 connection-failed（异常未劫持恢复链）；迟到 ACK 零扰动；重拨 wire2 → ready → live。
- **V3（pong 路径，helper 第二调用点）**：前置锚 `peerPings().length === 1`（liveness 已武装且 ping 已发——超时驱动非空转）；close 抛错被吸收 → backoff 恰一次 `{pong-timeout, attempt:1}`、零 connection-failed；恢复后代健康 wire（auto-pong）再推 ping/pong 周期零复发。

**判定**：SA4 标记的可选/info 项已按其建议的故障注入先例完成——「close 抛错 → onTemporaryFailure 必达」在两个调用点均实证。✅

---

## 变异检验（判别力证明 — scratch 上执行，worktree 零触碰）

| 场景 | scratch 生产码状态 | V1 | V2 | V3 | 判定 |
|---|---|---|---|---|---|
| 基线（`ffca4f6` peer-connection.ts） | 无 helper/close | ✗（close 账本空） | ✗（attempts 0） | ✗（attempts 0） | 三个新测试对缺陷本体非空转 |
| 修复版（HEAD `1092d34`） | — | ✓ | ✓ | ✓ | 全绿 |
| 变异 2：epoch 递增移至 close() 之后（catch 吸收保留、净 +1 不变） | 次序纪律破坏 | ✗ `reason 保持 hello-timeout（未被重入改写为 socket-closed）` | ✓ | ✓ | V1 精确判别「epoch 先于可重入 close 失效」；V2/V3 判别面（catch 吸收）与之独立 |

（另跑过一次结构更重的变异 1——catch 一并移除——V1/V2/V3 全红，佐证 catch 分支承担吸收职责；以保留 catch 的变异 2 为准呈报。）

---

## 全量回归（worktree，独立进程）

```
$ npx vitest run packages/ws-replication
 Test Files  43 passed (43) / Tests  311 passed (311) / Type Errors  no errors
   （SA4 轮 42 文件/308 测试 + 本轮新增 1 文件/3 测试；含 pong 机械提取回归面与 SA6 冻结面）
$ npx vitest run apps/yjs-server
 Test Files  9 passed (9) / Tests  38 passed (38) / Type Errors  no errors
$ npx tsc -p packages/ws-replication/tsconfig.json --noEmit   → exit 0
$ npx tsc -p apps/yjs-server/tsconfig.json --noEmit           → exit 0
```

生产代码零改动（worktree `git status`：仅 2 个新增未跟踪测试文件 + wiki 档案）。

## 本轮新增测试文件（补充性，SA7 职责范围）

| 文件 | 内容 | 运行类 |
|---|---|---|
| `packages/ws-replication/test/ws-replication-sa7-issue168-dynamic.test.ts` | V1 粘性同步重入（epoch 闸）/ V2 hello close-throw / V3 pong close-throw | fake-duplex + fake scheduler（零 real sleep） |
| `apps/yjs-server/test/ws-hello-timeout-close-issue168.test.ts` | RT-1..RT-4 生产 ws adapter（`wrapWs`/`startHubWsServer`）真实链路 | 真实 WS loopback + 真实 timer + 有界 real wait（real-transport 套件同类，header 已声明） |

## vitest 触发证据（verdict 升级 — 2026-06-15 立法）

本任务含新增 `*.test.ts`（SA6 两个 + SA7 本轮两个）。**PR 尚未创建**（`gh pr list --head refactor/ws-replication-close-peer-transport-synchronously-` 为空、`gh run list --branch …` 无 run）——发布/publish 阶段未到，SA7 职责不含 push/建 PR/宣称 CI 已绿。本地等价触发证据：

| Workspace/位置 | CI 路径（`.github/workflows/ci.yml`） | 本地收集证据 | 触发结果 |
|---|---|---|---|
| `packages/ws-replication` | `pnpm test` = `vitest run --typecheck`（root include `packages/*/test/**/*.test.ts`）+ `pnpm typecheck`（`tsc -p packages/ws-replication`） | 全包运行列出 43 文件含 `ws-replication-issue168-…red.test.ts`、`ws-replication-sa7-round2-dynamic.test.ts`、`ws-replication-sa7-issue168-dynamic.test.ts`；tsc exit 0 | ✓ 311/311 |
| `apps/yjs-server` | 同上（root include `apps/*/test/**/*.test.ts`；`pnpm typecheck` 含 `tsc -p apps/yjs-server`） | 全 app 运行列出 9 文件含 `ws-hello-timeout-close-issue168.test.ts`；tsc exit 0 | ✓ 38/38 |

**verdict**: ✅ all-vitest-packages-triggered（本地收集面；CI run log 摘录留待 publish 阶段 Runner/Host 补录——无 `.spec.ts`，E2E 门禁不适用）

---

## 终裁

| 项 | 结论 |
|---|---|
| Step 0（SA4=pass） | ✅ 进入验证 |
| Step 1（SA6 红灯契约） | 🟢 9/9 绿 |
| 移交点 1（红基线非空转） | ✅ 仅回退生产改动 → T1(:296)/D5(:802) 同消息转红、冻结面 7 绿 |
| 移交点 2（真实 adapter 重入语义） | ✅ 生产 ws adapter 真实链路（签名穿真实 close 握手、退订先行、异步重入零副作用、恢复完好）+ 粘性同步重入注入（epoch 闸）+ 变异判别 |
| 移交点 3（close 抛错 → backoff 仍达） | ✅ hello/pong 双调用点注入实证 |
| 全量回归 | ✅ ws-replication 311/311、yjs-server 38/38、双 tsc exit 0、真实 timer 测试 4 次重复稳定 |

**Verdict: pass**

（SA3 修复在真实运行链路与故障注入两面均成立；未发现 SA4 静态结论之外的缺陷。遗留：CI run log 摘录待 PR 建立后由发布阶段补录，非本轮阻断项。）
