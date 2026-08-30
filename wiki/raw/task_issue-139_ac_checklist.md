# Issue #139 验收清单（Acceptance Checklist）— 独立审计

**Date**: 2026-08-30
**Auditor**: SA5（acceptance audit；只读审计，未修改任何代码/测试/配置、未提交）
**Audited tree**: `/home/wangjian/nomicore-fix-issue-139` @ commit `381b9fd`（branch `fix/issue-139-on-docs-phase-5-websocket-replication`，ahead 4 vs `origin/docs/phase-5-websocket-replication`；`git status` 仅 `?? wiki/raw/task_issue-139_*` SA 产物，零业务改动）
**输入**: TASK.md（issue #139 AC×7）、`wiki/raw/task_issue-139_design.md`（READY R2）、`wiki/raw/task_issue-139_dispatch.md`（SA2 R3 PASS → SA6 红 → SA3 R1/R2/R3 → SA4 R2 PASS → SA7 R2 PASS 全链）、`wiki/raw/task_issue-139_sa7_report_r2.md`、实现源码、测试、部署文档。

**独立动态复验（本轮实测，worktree 根目录）**:

| 命令 | 结果 |
|---|---|
| `./node_modules/.bin/vitest run apps/yjs-server/test` | ✅ **7 files / 35 tests 全绿，EXIT=0**（37.98s；与 SA7 R2 报告数字一致）；跑后无孤儿进程（`pgrep -f 'yjs-server/src/main.ts'` 空） |
| `./node_modules/.bin/tsc -p apps/yjs-server/tsconfig.json` | ✅ **EXIT=0** |

## 总判定

| AC | 判定 | 一句话依据 |
|---|---|---|
| AC1 静态角色 + 全量配置校验 | **PASS** | `config.ts` 全量 loud 校验（22 用例绿）+ registry 显式传 role |
| AC2 独立 Persistence root / 共享拒 | **PASS** | 每 config 独立 memory/file root + rootDir 锁守卫（wx/pid/文案区分）+ 文档 unsupported 声明 |
| AC3 幂等 add/remove + restart 语义 | **PASS** | add/remove-target 幂等实现、URL/token/authz 零运行期变更 op、重启/SIGHUP 换装生效（含 T6 blocked-recovery） |
| AC4 有序停机 | **PASS** | 停机序 replication→registry→persistence→timer/clock 严格递增断言 + 60s watchdog |
| AC5 部署文档 | **PASS** | 本机三进程 + 跨机器示例 + 生产必须外置 TLS 醒目条款 + runbook |
| AC6 第三方公共面组合 | **PASS** | T4 零 app-internal import 组合 NamespaceLease/ReplicationSession；复制插件经 `@nomicore/ws-replication` 公共入口 |
| AC7 真进程冒烟 | **PASS** | smoke-skeleton 3/3 绿：真进程起 hub+peer、认证、开 target、verify-write 同步、SIGTERM exit 0 |

**7/7 PASS；无缺失验收项**（每条 AC 均有实现 + 测试/文档双重证据；证据缺口仅属观测项，见「观测与缺口」）。

---

## AC1 — 恰好一个静态角色 + 全量配置校验 → **PASS**

**要求原文**（TASK.md）: "The application starts in exactly one static role and validates instanceId, listen/Hub URL, bearer configuration, exact Peer targets with local owners, resource limits, timeouts, and Persistence settings."

**实现证据**（`apps/yjs-server/src/config.ts`，`parseAppConfig`）:

- 恰好一个静态角色：`role` 必填 `'hub'|'peer'` 无缺省（`config.ts:543-546`）；role×字段交叉拒绝——hub config 带 `peer` 块 / peer config 带 `hub` 块 → 拒（`:556-569`）；role=hub 顶层 `backoff`（peer 专属）→ 拒（`:570-572`）；registry 插件显式传 `role`（`app.ts:184-189`）。
- instanceId 文法 `^[a-z][a-z0-9-]{0,62}$`（`:24`,`:547`）；listen host 非空 + port 整数 0..65535（0=ephemeral，`:235-254`）；Peer Hub URL 仅 `ws:/wss:`、有 host、无 fragment（`:417-442`）。
- bearer 配置：`hub.tokens` 非空 map、key 合 instanceId 文法、value 非空且**全表唯一**（SA4 B1 重复值 loud 拒，`:256-288`）；`peer.hub.token` 非空（`:485-487`）；`hubInstanceId` 合文法（`:484`）。
- 精确 Peer targets + local owner：两字段精确 `{namespaceId, ownerUserId}`，多余键拒；nsId `^ns-[0-9a-f]{32}$`；重复拒；ownerUserId 非空（`:488-518`）。
- 资源限额/超时：`limits`/`timeouts` 键集白名单 + 正有限数校验（`:100-123`,`:552-554`）；`backoff` 同款且 peer 专属（`:125`,`:570-572`）。
- Persistence 设置：kind `memory|file`、file 必填 rootDir、schedule `{debounceMs,maxDirtyMs}` 正数且 `maxDirtyMs ≤ 30_000` 上界（`:186-233`,`:34`）；authorization 双形式（namespaceId/provisionId 恰一、直引必填 ownerUserId、provision 形式禁 ownerUserId、悬空 provisionId 拒、(peer,ns) 重复对拒，`:333-415`）；未知键一律 TypeError（`:538-542` 等）；结果深冻结（`:152-161`,`:595`）。

**测试证据**: `apps/yjs-server/test/app-config-red.test.ts`（T1，**22 用例**：缺 role、坏 instanceId、坏 port、未知键 TypeError、role×hub/peer 交叉、hub 顶层 backoff、缺 hub.url/hubInstanceId/token、非 ws(s) url、target 文法/重复、file 缺 rootDir、authorization 双形式全矩阵、深冻结）——本轮实测 22/22 绿。

## AC2 — Hub/Peer 独立 Persistence root；共享活跃 File root 拒绝/声明 unsupported → **PASS**

**要求原文**: "Hub and Peer run with independent Memory/File Persistence roots; shared active FilePersistence roots are rejected/documented as unsupported."

**实现证据**:

- 独立 root：每进程按自身 config 选择 memory/file persistence（`app.ts:170-181`）；file rootDir 独占锁 `<rootDir>/.nomicore-lock.json`（保留名，`lifecycle.ts:25`,`:60-99`：`wx` 独占创建、内容 `{instanceId,pid}`、锁冲突 pid 存活 → loud throw 且文案区分「同实例重复启动」vs「不同实例共享 root（unsupported）」、pid 已死 = stale 覆盖、EACCES/EPERM → loud 指向部署文档）；file boot 前取锁（`main.ts:180-188`），干净停机/换装删锁（`main.ts:71`,`:118`）。
- 文档声明：`docs/integration/hub-peer-deployment.md` §「锁文件与共享 root」（L151-163：共享活跃 root unsupported、每进程独立 rootDir、pid 复用人工删锁指引）+ §「生产要求摘要」L196。

**测试证据**: `apps/yjs-server/test/smoke-skeleton-red.test.ts`（本轮实测 3/3 绿）——用例 3「second instance sharing an active file root is rejected loudly」：不同 instanceId 同活跃 rootDir → exit 1 且输出含 `.nomicore-lock.json`（`smoke-skeleton-red.test.ts:290-311`）；用例 2「clean shutdown releases the rootDir lock」：同 rootDir 干净停机后重启成功 + durable 值回读相等（隐证锁随干净停机删除，`:244-288`）。

## AC3 — Peer targets 幂等运行期 add/remove；URL/token/授权走 update/restart 语义 → **PASS**

**要求原文**: "Peer targets support idempotent runtime add/remove while Hub URL, token, and authorization changes use plugin update/restart semantics."

**实现证据**（`apps/yjs-server/src/app.ts`）:

- `add-target`（`:538-552`）：文法校验 → 幂等守卫（已存在早退 `ok:true`、不重复发 `target-added`）→ 透传 `peer.addTarget`；`remove-target`（`:554-562`）：透传幂等 `peer.removeTarget`（未知 nsId 无副作用）+ 本地表删除幂等。角色不适用 → `unknown-op`（`:539`,`:555`）。
- URL/token/授权**零运行期变更 op**：`dispatch` 动词表（`:442-468`）无任何此类动词；文档明示「Hub URL/token/authorization 没有任何运行期变更 op——改动走进程重启或 SIGHUP 换装（restart-only）」（`docs/integration/hub-peer-deployment.md:133-134`）。
- restart 生效路径：进程重启（授权绑定先于 listen，`app.ts:200-272`）与 SIGHUP 换装（`main.ts:80-138`：单飞 `reload-ignored`、先验证后拆卸（坏 config → `config-error` + 旧实例继续服务）、停旧全序、装新、失败 loud `exit(1)`）；peer 恢复 seam `notify-auth-changed`（`:565-569`，透传公共 API）。

**测试证据**（本轮实测全绿）:

- `stdin-error-chain-red.test.ts` 用例 1：`add-target`（`ok:true` + `target-added` 事件，`test:323-334`）；错误链 `malformed-line`/`unknown-op`/`namespace-unknown`/`verify-write-timeout` 有界窗口（`:290-355`）。
- `hub-restart-static-target-red.test.ts`（T6）：hub SIGTERM → peer `goaway-received(SERVER_SHUTTING_DOWN)` → `connection-state-changed(to=blocked)` → 负例静默窗口（零自动重拨）→ hub 同 rootDir 重启（直引形式授权生效 = restart 语义）→ `notify-auth-changed` → 有界收敛 verify-write/read（`test:243-289`）。
- `smoke-skeleton-red.test.ts` 用例 2：重启后 authorization 换直引形式生效并 durable 回读。
- SA4 R2 对 SIGHUP 换装链（含 reload watchdog）静态 trace 确认（`task_issue-139_sa4_review_r2.md` §2.2）。

**证据缺口（不阻断判定，见观测 O1）**: `remove-target` 无自动化用例；重复 add 的「恰一次 `target-added`」未显式断言；SIGHUP 换装行为面（坏 config 后旧实例仍服务、`reload-ignored`、换装后旧 token 拒绝）仅静态审查 + SA3 手工验证（`task_issue-139_sa3_impl.md` §107 明示），无自动化红测。

## AC4 — 停机顺序：复制 drain/会话清理/Lease 释放 → Registry 停机 → Persistence dispose → Timer/Clock 拆卸 → **PASS**

**要求原文**: "Shutdown orders replication drain/session cleanup/Lease release before Registry shutdown, Persistence dispose, and Timer/Clock teardown."

**实现证据**（`apps/yjs-server/src/app.ts` `performStop` `:371-413`）:

1. 停止接纳（`wsServer.close()`，`ws-server.ts:165-174`）→ `hub.close()`（GOAWAY→drain→deadline 后 WS 1001，会话清理由包完成）/ `peer.stop()` → 事件 `replication-drained`；
2. `registry.shutdown()`（lease 释放/apply 排空/idle 回收）→ `registry-stopped`；
3. file 模式排空窗（`maxDirtyMs + 500ms`，上界 `MAX_MAX_DIRTY_MS=30_000` 保证 < 60s watchdog）→ `persistenceFiber.dispose()`（adapter dispose 落盘）→ `persistence-disposed`；
4. 根 `ctx.fiber.dispose()`（Timer/Clock 最后）→ `app-stopped`。
- `stop()` 幂等 single-flight（`:364-369`）；总超时 watchdog 60s 超时 `exit(1)`（`main.ts:24`,`:64-68`）；SIGTERM/SIGINT/`shutdown` op 三入口同链（`main.ts:148-151`,`:200-201`）。

**测试证据**: `apps/yjs-server/test/ordered-shutdown-red.test.ts`（T5，2 用例，本轮实测绿）——NDJSON 停机序 `replication-drained < registry-stopped < persistence-disposed < app-stopped` 严格递增断言 + 重复 `stop()` 幂等 + 端口释放后同配置重建（`:77-90`,`:92-134`）；真进程侧 SIGTERM exit 0 由 smoke/T6/T7 各用例断言。

**机制注记（观测 O5）**: 实现以显式 `await registry.shutdown()` / `await persistenceFiber.dispose()` 编排停机序（app.ts:385-401），设计 §3.6 末段曾表述「不手工调 registry.shutdown()…由依赖图级联兑现」——可观察停机序（AC4 的判定对象）一致且被测试锚定；显式编排的必要性（file dirty-flush 排空窗）已在 `task_issue-139_sa3_impl.md` §89 记录。

## AC5 — 部署文档：本机三进程 + 跨机器示例 + 生产必须外置 TLS → **PASS**

**要求原文**: "Deployment documentation includes local three-process and cross-machine examples and clearly requires external TLS for production."

**文档证据**: `docs/integration/hub-peer-deployment.md`（199 行，commit `758c3c4`）：

- 本机三进程示例（§L24-63）：hub.json + peer-1.json 完整可运行配置，三进程各用独立 rootDir，hub `tokens` 同时声明 peer-1/peer-2；启动/停机顺序说明。
- 跨机器示例（§L80-88）：`listen.host: 0.0.0.0`/内网地址、防火墙放行、`ws://<hub-dns-or-ip>:8080/replication`、独立密钥与 `hubInstanceId`。
- **生产必须外置 TLS** 醒目条款：§跨机器 L86-88（「生产必须外置 TLS…没有 TLS 时 bearer token 明文传输，只允许本机/受信内网联调」）+ §「生产要求摘要」L195（首条）。
- 附加完整度：provision/authorization 双形式说明（L64-78）、配置参考（L90-102）、stdin 动词表 + 稳定码注册表（L104-131）、SIGHUP 换装语义（L136-149）、锁文件与共享 root（L151-163）、hub 正常重启 ⇒ peer 恢复 runbook（L173-191）。
- `apps/README.md` 更新为指向 `apps/yjs-server` 与部署文档。

**测试证据**: smoke-skeleton 真进程链即文档启动命令形态（`node_modules/.bin/tsx apps/yjs-server/src/main.ts --config …`）；T3 设计映射见 SA6 红报 §0。

## AC6 — 第三方 Cordis Host 不 import 应用内部即可组合公共 NamespaceLease/ReplicationSession/复制插件 → **PASS**

**要求原文**: "A third-party Cordis Host can compose the same public NamespaceLease/ReplicationSession and replication plugins without importing application internals."

**证据**:

- `apps/yjs-server/test/third-party-composition-red.test.ts`（T4，2 用例，本轮实测绿）：**零 app-internal specifier**——只 import `@deepseek-ai/cordis`、`@deepseek-ai/cordis-plugin-timer`、`@nomicore/clock`、`@nomicore/persistence`、`@nomicore/namespace-registry`（`test:10-18`），复刻 hosting 文档装配 clock→TimerService→persistence→registry，`registry.create`（NamespaceLease）+ `lease.enableReplication()` + `lease.openReplicationSession`（ReplicationSession）全部成功（`:21-59`）；第 2 用例锚定应用公共入口 `@nomicore/yjs-server` 暴露 `createNomicoreApp`/`parseAppConfig`（`:61-65`）。import 清单已经 SA4 静态比对（设计 §5-T4 冻结要求）。
- 复制插件公共面：`createHubReplication`/`createPeerReplication` 自 `@nomicore/ws-replication` 公共入口导出（`packages/ws-replication/src/index.ts:4-5`）；app 自身即普通第三方消费者形态（`apps/yjs-server/src/replication/hub-plugin.ts:19-29`、`peer-plugin.ts:16-27`、`app.ts:26-49` 全部经包公共入口，无 `/testing` 子路径/内部模块）；包级真实链路（harness/driver + sa7-* 测试）同样经公共面消费。
- 设计 §4 冻结「app 只 import 各包公共入口」+ 零 `packages/**` 改动（`git diff d911025..381b9fd --stat` 范围内仅 `apps/**`、docs、vitest.config.ts、根 package.json、pnpm-lock.yaml、apps/README.md，全部在 ALLOW LIST 内）。

## AC7 — 冒烟测试：真进程起 Hub/Peer、认证、开 target、同步写、干净停机 → **PASS**

**要求原文**: "Smoke tests start Hub and Peer processes, authenticate, open a target, synchronize a write, and shut down cleanly."

**测试证据**: `apps/yjs-server/test/smoke-skeleton-red.test.ts`（T3 骨架，真 `tsx` 子进程）：

- 用例 1（`:200-242`，本轮实测 11.9s 绿）：hub 启动序严格 `provisioned → listening(实际 port) → ready`（port 0 ephemeral 上报）→ peer（静态 target + Bearer token 认证连接）`ready` → `verify-write` 收敛（`ok:true`）→ hub `read` 回读 `value === 1`（端到端同步）→ SIGTERM 双进程 **exit 0**。
- 用例 2（17.2s 绿）：同 rootDir 干净停机→重启→durable 回读 41（持久化 + 锁释放）；用例 3（6.2s 绿）：共享活跃 root 第二实例 loud 拒（AC2）。
- 交叉验证：SA7 R2 隔离 smoke ×5 连绿（`task_issue-139_sa7_report_r2.md` §3）；T6/T7 补充认证错误面、blocked-recovery、满载收敛链路（`hub-restart-static-target-red.test.ts`、`stdin-error-chain-red.test.ts` 4 用例）。

**CI 收集面**: 根 `vitest.config.ts` include 含 `apps/*/test/**/*.test.ts`（本轮 7 files 全部被收集执行）；`.github/workflows/ci.yml` `pnpm typecheck` + `pnpm test`（typecheck 链含 `apps/yjs-server`，本轮 EXIT=0；见观测 O4：分支未推送、暂无远程 CI run）。

---

## 缺失项识别

**无缺失验收项**：TASK.md 的 7 条 AC 与 issue 需求（经设计 §1/§9 映射）全部有对应实现 + 证据；未发现「AC 要求但完全未实现/未文档化」的条目。

设计 §5 原计划的 **T2（ws-transport-red 单元测）被 SA6 显式 descoped**（`task_issue-139_sa6_red.md` §0：`ws` 库已存在非红锚，防污染红灯基线）——其验证目标由真实 WS 端到端链路（smoke/T6/T7）+ SA7 动态验证承接，属测试手段取舍而非 AC 缺口（无 AC 指向 T2）。

## 观测与缺口（均非阻断，供后续轮/Host 裁定）

| # | 级别 | 发现 | 证据 | 建议 |
|---|---|---|---|---|
| O1 | MINOR | SIGHUP 换装行为面（坏 config → `config-error` 且旧实例仍接纳、换装中重复 SIGHUP → `reload-ignored`、换装后旧 token 拨号被拒）与 `remove-target`、重复 add 幂等（恰一次 `target-added`）无自动化测试——已实现 + SA4 R2 静态 trace + SA3 手工验证 + 文档化 | `task_issue-139_sa3_impl.md:107`；`task_issue-139_sa4_review_r2.md` O2；grep `SIGHUP|reload|remove-target` 于 `apps/yjs-server/test/` 仅命中 T6 的 notify-auth-changed | 后续轮补 T3/T7 换装步骤自动化（注意 tsx 不转发 SIGHUP，需发实际脚本进程） |
| O2 | MINOR | worktree 根 `REPORT.md` 仍是上一任务 issue #175 的内容（run_id/branch/HEAD 均旧），未更新为 #139 | `REPORT.md:1-38` | Host 在 completion/publish 前更新 |
| O3 | INFO | SA4 R2 O4 登记的设计补注（§3.2 token 全表唯一句、maxDirtyMs 上界句、§3.5 `reload-failed` 词条）仍未落入设计文档 | grep 设计文档 `reload-failed`=0、`全表唯一`=0 | SA1 三句补注（非重新设计） |
| O4 | INFO | 分支未推送（ahead 4），无远程 CI run/PR 可摘录——与 SA7 R2 §7 记账一致；本地 CI-parity（app 套件 + `pnpm typecheck` 等价命令）本轮独立复跑全绿 | `git status -sb`；SA7 R2 §7/§8-O3 | 发布后由 Host 补 CI 证据 |
| O5 | INFO | 停机以显式 `registry.shutdown()`/`persistenceFiber.dispose()` 编排，与设计 §3.6 末段「不手工调」表述存在机制措辞差；可观察顺序（AC4 判定对象）一致且有测试锚定 | `app.ts:384-401`；`task_issue-139_sa3_impl.md:89` | 设计文档措辞对齐（可随 O3 一并） |

## 审计方法与现场

- 只读审计：未修改任何生产/测试/配置文件、未 commit/push（`git status` 复核仅新增本清单与本轮 SA 产物）。
- 独立复验不采信前序报告的运行结果：套件 + typecheck 本轮亲测（数字与 SA7 R2 一致：7 files/35 tests）。
- 无残留进程/后台作业；本清单为唯一新增产物：`wiki/raw/task_issue-139_ac_checklist.md`。
