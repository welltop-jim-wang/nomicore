# SA4 静态验尸报告

**Date**: 2026-08-31
**Verdict**: pass
**被审对象**：commit `6fde7ea`（HEAD，分支 `refactor/ws-replication-bound-early-frame-admission-in-acce`，基线 `b66615c`）
**审查方法**：全量 diff 逐语句比对 SA1 设计（R1 版，666 行）+ SA2 R2 放行条件核验 + 独立进程实跑验证 + 红→绿因果复现（基线源码临时恢复 + trap 保证还原）

---

## 审核结论

1. **设计一致性**：✅ 一致
   - **§1.1 Scope Creep Guard**：actual diff 3 文件（`src/hub-connection.ts`、`test/ws-replication-issue190-red.test.ts`、`test/ws-replication-issue190-guard.test.ts`）全部落在 design §11 ALLOW LIST；DENY LIST 文件（`types.ts`、`frame-io` 等邻接模块、`apps/**`、`docs/protocols/*`、`harness.ts`/`driver.ts`）零触碰；BLACKLIST 零命中。`set` 比对差集为空（`comm -23` 输出空）。
   - **§1.2 设计偏离**：零偏离。D1 共享单点 `installEarlyFrameAdmission`（三检逐语句 = 设计 §3.2 伪代码：幂等早退 → 单帧界 → 条数界 → push，全部先于保留）；D2 `accept()` 等价换轨（门 0/1/2 原样、auth timer `markRejected()+detach()`、门 4 五处 `isRejected()` 复核、`queueMicrotask` 让出保留、门 5 顺序、`rejectUpgrade` 传 `admission.detach`、构造传 `admission.frames`）；D3 `acceptTrusted()` 收口段检查序与设计 §5.1 精确一致（`isRejected()` 先于 `transport.closed`——拒绝不误分类 `peer-disconnected`）；§3.4 `closeAdmission` try/catch 守卫落地（全设计唯一强化点，与 `safeCloseTransport` 同款纪律）；`MAX_EARLY_FRAMES` 注释 #172 双标注落地（权威指向 `docs/protocols/instance-replication-v1.md` §14 + 历史证据 phase5 R2 A2/R3 N1，且采纳 SA2 N1 的「§23 observer reason 闭集——local seam」精化措辞）。
   - **§1.3 E2E spec 触发性**：不触发（diff 无 `*.spec.ts`）。
   - **§1.4 vitest 触发性**：✅ 通过。根 `vitest.config.ts` include `packages/*/test/**/*.test.ts` 覆盖两新测试文件；`.github/workflows/ci.yml` test job `pnpm test`（= `vitest run --typecheck`，无 filter 全 workspace）+ typecheck job 含 `tsc -p packages/ws-replication/tsconfig.json`。
   - **§1.5 协议假设**：✅ 抽验通过。P1/P2 锚 `instance-replication-v1.md:389-390`（「1008 身份或连接 policy 错误 / 1009 外层 frame 超限」）实测吻合；P3 锚 `:636` reason 闭集含 `frame-too-large`/`early-frame-limit` 实测吻合。
   - **§1.6 契约改动连锁**：✅ 无 throw/return 契约改动（检测命令零命中 `return→throw` 类变化；`return undefined` 换轨为等价重写，新增函数全部模块私有）。`acceptTrusted` 唯一生产 caller `apps/yjs-server/src/app.ts:274`（fire-and-forget）零改动需要——签名零变化、I6 恒 resolve 成立且 §3.4 守卫反而**收窄**了 unhandledRejection 风险面（issue #259 家族反向操作）。
   - **§1.7 源码 grep 断言禁令**：✅ 通过。两测试文件零 `readFileSync`，全部为运行时行为断言（快照式 `toEqual` + unhandledRejection probe）。

2. **读写路径一致性**：✅ 一致。写路径（listener 内三检后 `frames.push` 唯一保留点）与读路径（`admission.frames` 同一数组引用 → `HubConnectionImpl` 构造尾重放 `for (const bytes of earlyFrames)`）闭环；`HubConnectionImpl` 及构造尾重放代码未被 diff 触及（源文件唯一改动即 hub-connection.ts 两入口段 + 顶部机制）。

3. **静默失败**：✅ 无。拒绝路径三可观察面齐全：`close(1009|1008, 'upgrade-frame-limit')`（wire 层）+ `auth-upgrade-rejected` observer 事件（事件层）+ 恒 resolve `undefined`（调用方契约层，`index.ts:375` 注释文档化）。`closeAdmission` catch 吞的是契约外 transport close 异常，拒绝效果（标志 + 事件）仍发生——非静默。

4. **降级方案**：✅ 安全。修复是显式 fail-closed 拒绝（非降级）；§3.4 守卫为契约外防御（SA2 已裁决：与 `safeCloseTransport` 生产先例同款，残局归属 transport 所有者，已成文于源码注释）。

5. **极端攻击**：✅ 未发现漏洞。逐项推演：空积压（直通构造，与原一致）；恰 16 帧（第 17 帧才拒——A2-e 契约值）；恰 `maxFrameBytes`（`>` 严格不等式，等值接纳）；并发多入口（每调用独立 admission 状态，I8）；拒绝 close 触发 onClose 置 `earlyClosed`（收口段 `isRejected()` 先行短路，无误分类——实现注释明载设计 §5.1 论证）；拒绝后 pump 帧（listener 已 detach + 幂等早退双重吸收，AC3 实证）。E12 敌意无限同步重放（CPU 面）维持 SA2 定性：transport 同步回调契约通性问题，非本层可解，内存界不受影响。

6. **错误处理**：✅ 完整。`accept()` 各出口（invalid-credentials / 验证器抛错 / invalid-instance-id / hub-shutdown / peer-disconnected / auth-timeout / 迟归复核）全部换轨且行为等价；帧限拒绝出口与既有 `accept()` 语义逐项对齐（红灯快照 AC1/AC2/AC3 实证）。

7. **架构评估**：✅ 可行。结构性根因（两入口独立实现）以共享单点收敛——正是 SA5 根因结论要求的形态；零绕过、零 FIXME、单生产文件、机制模块私有（不导出）；不触发退回 SA1 信号。

8. **过度设计**：✅ 精简。零新 knob（`MAX_EARLY_FRAMES` 仍模块常数）、零新导出、零新错误码、零协议文档变更；净增约 147 行中约半数为 #172 双标注义务要求的注释（SA2 MAJOR 攻击点 #1 的成文义务）；与根因复杂度同数量级。

## 测试证据（独立进程实跑）

| # | 验证 | 命令 | 结果 |
|---|---|---|---|
| 1 | 红灯转绿 + 保真锚 | `npx vitest run packages/ws-replication/test/ws-replication-issue190-red.test.ts` | **4 passed (4)**，Type Errors no errors，exit 0 |
| 2 | RT-1 守卫锚 | `npx vitest run packages/ws-replication/test/ws-replication-issue190-guard.test.ts` | **1 passed (1)**，exit 0 |
| 3 | 全聚焦套件 | `npx vitest run packages/ws-replication/test` | **45 文件 317 tests 全绿**（SA6 基线 44 文件 316 + 新 guard 1 文件 1 test，精确吻合），typecheck no errors，exit 0 |
| 4 | 根 typecheck | `pnpm typecheck`（12 个 `tsc -p` 链） | exit 0 |
| 5 | 空白检查 | `git diff --check b66615c HEAD` | clean |
| 6 | **红→绿因果性** | 临时恢复基线源码（`git checkout b66615c -- …hub-connection.ts`，trap 还原）后跑两测试文件 | 基线上 **AC1/AC2/AC3 红 + RT-1 红 + 保真锚绿**（`4 failed \| 1 passed`）——与 SA6 简报记录的 Received 偏差面逐项一致；RT-1 在无守卫基线上天然红（`replayedCount:1` + promise reject），「守卫在/不在」区分度实证成立。还原后 `git status` 干净 |
| 7 | 全仓 `pnpm test` | HEAD 与基线 `b66615c` 完整树各跑一次 | **两者同崩于 `ERR_IPC_CHANNEL_CLOSED`**（tinypool worker IPC 崩溃）——基线对照证明为本机环境问题（进程资源受限，实测 `spawn bash EAGAIN`/`fork: retry`），非本任务回归。ws-replication 单包 317 tests 全绿已覆盖本任务改动面 |
| 8 | yjs-server caller 面 | `npx vitest run apps/yjs-server/test` | 本机进程资源饥饿无法完成（`spawn bash EAGAIN`，环境限制）——caller ripple 以静态证据链闭合（见结论 1 §1.6），动态验证交 SA7/CI |

SA6 冻结锚核验：`ws-replication-issue190-red.test.ts` 为新入库文件（SA6 红灯本体随 SA3 commit 入库，非 SA3 篡改），断言快照与任务简报「SA6 红灯测试契约」表逐字段一致（AC1 `replayedCount:1`/AC2 `17`/AC3 `64`+pump 复活免疫/保真锚 `replayedCount:2`+`state:'closed'`）。

## 动态审核重点（交 SA7）

1. **全仓 `pnpm test` 于 CI 环境执行**：本机两次全仓跑（HEAD 与基线）均崩于 tinypool `ERR_IPC_CHANNEL_CLOSED`（进程资源饥饿，`fork: retry`/`spawn bash EAGAIN` 实证）——非代码回归（基线同形态）。SA7 须在 PR CI（`.github/workflows/ci.yml` test job）确认全仓绿，并在报告留 `gh run view --log` 摘录。
2. **CI 触发证据**：PR CI 日志中应出现 `packages/ws-replication/test/ws-replication-issue190-red.test.ts`（4 tests）与 `ws-replication-issue190-guard.test.ts`（1 test）的执行记录（§1.4 静态判定已通过，动态确认接棒）。
3. **yjs-server 回归**（caller ripple 动态面）：`apps/yjs-server/test` 全套件（本机资源无法完成）——重点合法 trusted upgrade 路径（`app.ts:274` → `acceptTrusted`）行为不变。
4. （可选）真实链路 smoke：生产 `wrapWs` transport + 合法 HELLO 的 trusted upgrade 分配行为（保真锚的运行时确认）。
