# SA3 实现报告 — task_active-reauthentication-lifecycle（issue #175：主动 reauthentication 生命周期）

- 实施者：SA3（TDD Executor），2026-08-30
- 依据：`wiki/raw/task_active-reauthentication-lifecycle_design.md`（SA1 设计 §3-§6/§13，SA2
  verdict: pass——三裁决均维持 SA1 主张）+ `task_active-reauthentication-lifecycle_sa2_review.md`
  （4 项 MINOR 不阻断）+ SA6 红灯契约
  `packages/ws-replication/test/ws-replication-reauth-lifecycle-red.test.ts`（6 IT；
  简报 §SA2 修正后复跑记录在案——IT4 drainTimeoutMs=300_000 / IT6 `hubSideCloseInfo`
  toBeUndefined 两处锚点已由 SA6 落地）。
- 实施范围：严格按设计 §13 ALLOW LIST（src 三文件）；DENY LIST 零触碰；测试文件
  （红测 + driver.ts 镜像）为 `[SA6 owned]`，SA3 未做任何修改（工作树中的这两处改动
  为 SA6 阶段产物，与 SA3 实现同提交收录）。

## 一、改动文件清单（3 个，均在设计 §13 ALLOW LIST 内；106 insertions / 1 deletion）

| 文件 | 改动 | 对应设计 |
|---|---|---|
| `packages/ws-replication/src/types.ts` | `HubReplication` 接口追加 `requestReauth(instanceIdentity: string): Promise<void>`；`PeerReplication` 接口追加 `notifyAuthChanged(): void`；头注追加 #175 SA6 冻结契约扩展引注（SA2 MINOR #2） | §3（纯新增，既有成员零变化；API test-d 的 toMatchTypeOf 结构超集匹配不受影响） |
| `packages/ws-replication/src/hub-connection.ts` | `HubReplicationImpl.requestReauth`（closed 早退 + 拷贝迭代 + 认证身份键匹配）；`HubConnectionImpl.beginReauth`（幂等 `reauthRequested`；handshaking 分支直接 close(1001) 镜像 shutdownWithGoaway；GOAWAY(REAUTH_REQUIRED, drain=closeTimeoutMs) 直发豁免 + hub 侧 deadline → close(1001,'hub-reauth')）+ `reauthRequested`/`reauthDeadlineHandle` 字段 + `cleanupAll` 头部清句柄 | §4.1/§4.2/§4.3/§4.5/§4.6；§7 竞态矩阵 1/2/3/5 |
| `packages/ws-replication/src/peer-connection.ts` | `PeerReplicationImpl.notifyAuthChanged`（stopping/非 blocked 早退 → requestRebuild('auth-change')）；`onGoaway` blocked 分支追加 `drain>0 → armBlockedDeadline()`；新增 `armBlockedDeadline`（复用 drainCloseHandle；回调状态守卫 + transport 守卫；close(1001,'blocked-deadline')）；`requestRebuild` 追加 `clearDrainClose()` | §5/§6.1/§6.2/§6.3/§6.4；§7 竞态矩阵 6/7 |

设计关键点逐项落实：

- **drain 预算** = `timeouts.closeTimeoutMs`（validate.ts positiveSafeInteger 构造期保证 >0），
  零新 knob；与 `hub.close()` 的零 drain 窗语义区别按 §4.3 实现（beginReauth 等 deadline
  再收口）。
- **resolve 语义** =「请求已受理」：`requestReauth` 同步冲刷 GOAWAY + 同步武装 deadline 后
  即 resolve（IT1/IT5 时序依赖，§4.4）。
- **receiver 侧 deadline 覆盖面**：blocked 两 reasonCode（SERVER_SHUTTING_DOWN /
  REAUTH_REQUIRED）都武装（SA2 裁决三 3a 维持）；`drainTimeoutMs === 0` 不武装（D5-B1
  冻结语义钉死，SA2 裁决三 3b）。
- **零 token 暴露**：以 `authenticatedInstanceId` 为键；close reason / GOAWAY reasonCode
  均为静态安全码；本包 src 零日志面（AC7 结构保证）。
- **零 unhandled rejection**：requestReauth/notifyAuthChanged 全路径零 throw；两个
  deadline 回调仅调用既有同步 close 路径；两处 stale-fire 守卫（closedFlag / 状态守卫）。

## 二、验证输出摘要（worktree 根执行，全部通过）

1. **红灯转绿**：`npx vitest run packages/ws-replication/test/ws-replication-reauth-lifecycle-red.test.ts`
   ```
   Test Files  1 passed (1)
        Tests  6 passed (6)   ← 与红灯基线 6 failed/0 passed 对比
   Type Errors  no errors
   ```
   6 条 IT 全部在冻结锚点通过：requestReauth 端到端（恰 1 GOAWAY(REAUTH_REQUIRED, drain>0)、
   blocked、drain 窗开放、deadline 后 1001 收口、60s 零重拨）、定向性（未知实例 no-op、
   beta 仅收 GOAWAY / alpha 零影响）、接收侧 deadline（60ms 自行 1001 收口）、恢复
   （blocked 零通知零重拨 + token 轮换 + notifyAuthChanged → 重建 → 新 token 认证 →
   ready/live/收敛）、幂等与竞态（×3 恰 1 GOAWAY、迟到 no-op、与 hub.close 背靠背双
   resolve、连接消失后 no-op、零 unhandled rejection）、零 token 暴露（wire 字节 + 双侧
   close reason）。

2. **冻结绿套件回归**：`npx vitest run ...sa7-dynamic ...sa7-hardening-dynamic ...sa7-r1-transport-auth`
   ```
   Test Files  3 passed (3)
        Tests  19 passed (19)   ← 与 SA6 红灯基线 19/19 一致，零回归
   Type Errors  no errors
   ```

3. **全量套件**：`npx vitest run packages/ws-replication/test/`
   ```
   Test Files  25 passed (25)
        Tests  181 passed (181)
   Type Errors  no errors
   ```

4. **类型检查**：`npx tsc -p packages/ws-replication/tsconfig.json` → exit 0（含 test/**；
   `ws-replication-api.test-d.ts` 9 条结构超集断言全绿——接口纯新增成员不破坏冻结面）。

## 三、实施要点确认

- 生产代码无任何 env-override / fallback 软兜底（SKILL 禁令 1 合规）；三类降级
  （未知身份 no-op / 非 blocked 通知 no-op / drain=0 不武装）均为设计 §9 判定的
  合法降级（冻结契约/冻结绿测试锚定）；GOAWAY 发送失败 → fail-closed close(1001)
  （非静默吞）。
- 测试文件零修改（红测 6 IT 与 driver.ts 镜像为 SA6 产物；设计 §13 `[SA6 owned]`
  标注；SA3 落盘时未触碰）。
- DENY LIST 零触碰：`hub-namespace.ts` / `peer-namespace.ts` / codec / 协议 / docs /
  apps / domains 全部零改动。
- 公共面为两个**新增**方法（requestReauth / notifyAuthChanged），无既有函数契约变更；
  全仓唯二实现者（HubReplicationImpl / PeerConnectionImpl）同 PR 补齐，编译即验证。
- git commit 已落（不 push）；本报告与 SA1/SA2/SA6 档案同留 wiki/raw，由收尾/归档步骤
  统一入库（repo 惯例：`docs(wiki): ... 任务档案 ... 入库` 提交）。
