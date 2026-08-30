# SA3 实现报告 — Issue #139（`apps/yjs-server` Hub/Peer Cordis 组合根）

- **日期**：2026-08-30
- **基线**：`wiki/raw/task_issue-139_design.md`（READY R2）+ `wiki/raw/task_issue-139_sa2_review_r3.md`（PASS）+ `wiki/raw/task_issue-139_sa6_red.md`（红灯成立）
- **结论**：**实现完成，SA6 全量红灯测试 5 文件 28/28 转绿**；根全量 typecheck（12 包 + app）通过；零 `packages/**` 改动；已本地提交 2 个 commit（不含 wiki/raw 与 REPORT.md）。

## 1. 产出文件

```text
apps/yjs-server/
  package.json                   # deps: cordis@^4.0.1/timer@^1.1.3/@nomicore/{clock,persistence,namespace-registry,ws-replication}/ws@^8.21.3；devDeps: @types/ws 等
  tsconfig.json                  # 沿 packages 模板 + allowImportingTsExtensions（Node 原生 TS 加载需 .ts specifier）
  AGENTS.md                      # app 局部说明（apps/AGENTS.md 要求）
  src/
    index.ts                     # 公共库入口：createNomicoreApp / parseAppConfig / ConfigValidationError / 锁与事件面
    config.ts                    # §3.2 严格校验 + 深冻结（约 420 行）
    app.ts                       # createNomicoreApp：Cordis 组装、provision、授权绑定、listen/start、有序停机、控制通道
    lifecycle.ts                 # NDJSON sink、rootDir 锁守卫（.nomicore-lock.json）、稳定码注册表
    main.ts                      # CLI：--config/NOMICORE_CONFIG、stdin 控制通道、SIGTERM/SIGINT/SIGHUP、watchdog
    transport/ws-server.ts       # node:http + ws(noServer) upgrade 适配、wrapWs（5+3 成员全适配）
    transport/ws-client.ts       # peer 拨号（Authorization: Bearer 头）
    replication/hub-plugin.ts    # createHubReplication + ctx.effect 有序 disposer + node timer 桥
    replication/peer-plugin.ts   # createPeerReplication（同款纪律）
  test/                          # [SA6 owned] 5 文件（28 用例）全部转绿
docs/integration/hub-peer-deployment.md   # AC5 部署文档（本机/跨机器/TLS/runbook）
apps/README.md                             # apps 空置声明更新
package.json（根）                          # typecheck 追加 `tsc -p apps/yjs-server/tsconfig.json`
vitest.config.ts                           # include 追加 apps/*/test/**/*.test.ts（SA6 已加，保留）
pnpm-lock.yaml                             # 生成物：ws@8.21.3 / @types/ws@8.18.1 + app importer（仅 +58 行）
```

零 `packages/**` 改动；未触碰 DENY LIST 文件。

## 2. 验证命令与真实结果

### 2.1 应用测试（SA6 红灯套件，后台独立进程执行）

```bash
fuser -k 8000/tcp 8081/tcp 3005/tcp 43113/tcp 2>/dev/null; sleep 2
./node_modules/.bin/vitest run apps/yjs-server/test
```

结果（`/tmp/sa3-139-final.log`，EXIT=0）：

```text
 ✓ apps/yjs-server/test/ordered-shutdown-red.test.ts (2 tests)
 ✓ apps/yjs-server/test/app-config-red.test.ts (20 tests)
 ✓ apps/yjs-server/test/third-party-composition-red.test.ts (2 tests)
 ✓ apps/yjs-server/test/hub-restart-static-target-red.test.ts (1 test)
 ✓ apps/yjs-server/test/smoke-skeleton-red.test.ts (3 tests)
 Test Files  5 passed (5)
      Tests  28 passed (28)
Type Errors  no errors
```

逐文件（多次迭代前的红→绿过程）：T1 20/20（配置契约）；T4 2/2（公共组合 seam + 应用入口）；T5 2/2（停机序 + 幂等 + 端口释放）；T3-skeleton 3/3（事件序、durable 重启、锁反例）；T6 1/1（hub 重启 ⇒ peer blocked-recovery：goaway-received → blocked → 静默窗口 → notify-auth-changed → 收敛）。

### 2.2 类型检查

```bash
./node_modules/.bin/tsc -p apps/yjs-server/tsconfig.json          # APP_TSC_OK
# 根 typecheck 全链（与 package.json 脚本逐条一致）：
# tsc -p packages/{vfsl,vfsl-protocol,vfsl-codegen,persistence,dsh-persistence,doc-runtime,namespace-runtime,clock,namespace-registry,replication-protocol,ws-replication}/tsconfig.json && tsc -p apps/yjs-server/tsconfig.json
# → ROOT_TSC_ALL_OK（EXIT=0；经 pnpm 直跑会因 corepack pnpm 11 vs 仓库 pnpm 10.28.2 的
#   depsStatusCheck 先行失败——与 tsc 无关，故用仓库本地 tsc 目录直跑等效链条）
```

### 2.3 手工真链验证（进程级，超出 SA6 红测骨架）

- hub `config-loaded → provisioned → listening{实际port} → ready` 事件序 ✓；
- peer 静态 target 认证 → `connection-state-changed(…ready)` → OPEN → bootstrap → `live` ✓；
- peer `verify-write`(count=5) → hub `read` 回读 5 ✓；
- hub SIGTERM → 停机序事件 + exit 0 ✓；
- SIGHUP 坏配置 → `config-error{violations}` + 旧实例继续服务 ✓；SIGHUP 好配置 → `reload-starting → reload-complete` ✓；
- stdin `shutdown` 回执 ok → 有序停机 → 脚本进程 exit 0 ✓。

## 3. SA6 红测试修正（仅测试栅栏级缺陷；验收意图零变更）

按总控许可修正 3 处可论证的测试-栅栏问题，均在 `apps/yjs-server/test/`：

1. **`ordered-shutdown-red.test.ts`——跨用例共享 `stdoutChunks` 累加器**（真缺陷，实测致假绿 + 未处理拒绝）：第二个用例的 `waitFor('"event":"ready"')` 会被第一用例的残留事件立即满足，导致 `stop()` 与**在飞 boot** 竞态（cordis 根 fiber 被停机卸载后续体 `new TimerService` 抛 INACTIVE_EFFECT 未处理拒绝；用例仍“通过”）。修正：`beforeEach(() => { stdoutChunks.length = 0; })`（1 行）。**同时** app 侧配套加固：boot 在每次 `await` 边界检查 `stopRequested`（停机中的 boot 静默取消——这也让 CLI 在 boot 窗口收 SIGTERM 时干净 exit 0，见 §4-4）。
2. **`ordered-shutdown-red.test.ts`——strict-TS 栅栏**：`vi.spyOn(process.stdout,'write')` 的声明类型不匹配（`MockInstance<typeof process.stdout.write>` + chunk 参数显式化）；`indexes[0]<indexes[1]…` 在 `noUncheckedIndexedAccess` 下 possibly-undefined（解构默认值）。改法只动类型/解构，断言值零变化。
3. **`third-party-composition-red.test.ts`——strict-TS 判别联合收窄**：`expect(created.ok).toBe(true)` 不产生类型收窄，`created.lease` / `opened.session` 报 TS2339。改法为窄化守卫 `if (!created.ok) throw new Error(...)`（断言仍保留）。`if (!opened.ok) …` 同理。

## 4. 实现要点与设计偏差（全部为设计范围内的实现级必要修正，已逐项说明）

1. **wrapWs：CONNECTING 期 send 缓冲**（设计 §3.3 一行式描述的必要落地）：真实 `ws` 客户端异步建连，而包在 `dial()` 返回后**同步**发送 HELLO——CONNECTING 期 `ws.send()` 抛 "WebSocket is not open"。适配层把 CONNECTING 期 send 入队、`open` 后冲刷（对包呈现“拨号即连通”；连接失败/拒绝经 `'close'`(1006) 投影 → 包侧 backoff；`closed` 在 CLOSE 前恒 false）。Hub 侧 upgrade 完成即 OPEN，该队列为空闲路径。
2. **`hub httpServer.close()` 不等连接收口**：node `server.close(cb)` 的回调要等**全部既有连接**（含 upgrade 交给 ws 的 socket）结束——若在其回调上 await，会在 `hub.close()`（GOAWAY→drain→强制收口）之前死锁。修正：`close()` = 立即停止接纳（listening socket 同步关闭），drain 由下一步 `hub.close()` 负责（与设计 §3.6「先停接纳、后复制 drain」一致；close 回调仅作无害收尾）。
3. **停机持久化排空窗口**（设计 §3.6 宿主义务 + A8「dispose and drain first」的落地）：file adapter 的 dirty flush 走 debounce 调度（saveDoc → maxDirtyMs 内提交），而 `dispose()` 只 abort+destroy、**不冲刷 dirty**。实测：provision 后立即 SIGTERM，`enableReplication` 的 META 写入随「registry.shutdown → 立即拆 persistence fiber」丢失（重启后复制身份 disabled → 对端 OPEN 被 REPLICATION_NOT_ENABLED 拒——这正是 T6 首轮红条件之一）。修正：`registry-stopped` 后、`persistenceFiber.dispose()` 前，file 模式等待 `maxDirtyMs + 500ms` 排空窗口（memory 无持久化语义，不等）。T3/T6 的 30s 停机断言余量充足。
4. **boot 取消感知**：`stop()` 置 `stopRequested`，boot 逐 await 边界检查并静默取消（在飞 boot 不再产生未处理拒绝；T5 的段间竞态与 CLI boot 窗口 SIGTERM 均干净）；hub boot 在 listen 后收到停机请求则立即关闭新 server 并返回（无泄漏、不再发射 listening/ready）。
5. **`.nomicore-lock.json` 获取前置 `mkdirSync(rootDir, {recursive:true})`**：rootDir 不存在时 `writeFileSync(..., {flag:'wx'})` 先抛 ENOENT（错误文案误导）。rootDir 是 file 模式前置条件（部署文档已写明），创建语义对测试/部署零影响。
6. **verify-write 的 `set`/`path` 语义**：实现取 `set` 为 mutateRoot 的 `{op:'set', path}` 目标；`path` 若提供必须与 `set` 深度相等，否则 `invalid-op-args`（loud，不做静默选择）。SA6 用例中两者恒相等，行为与设计一致。
7. **配置校验细节**：持久化 schedule 键校验、`idleTimeoutMs` 正数、provision 条目 schema 形状（lang==='vfsl'/version/id/text）与 root 键分离；`tokens` 反向表在 bootHub 内建（token 不进 NDJSON）；稳定码注册表零新增（设计 §3.4 冻结 7 码）。

## 5. 提交

```text
199be62 feat(apps/yjs-server): 可部署 Hub/Peer Cordis 组合根（issue #139）/ deployable Hub & Peer Cordis composition root
758c3c4 docs(apps): Hub/Peer 部署指南与 apps README 更新（issue #139）/ Hub & Peer deployment guide
```

（基于 `d911025`；工作区仅剩 `?? wiki/raw/*` 与 REPORT.md 类非提交物。）

## 6. 残留限制 / 留给后续 SA 的边界

- **`tsx` 开发运行器信号语义**（已在部署文档明示）：tsx 把脚本 fork 到子进程且**不转发 SIGHUP**（SIGTERM/SIGINT 转发）。dev 调试/测试须把信号发到实际脚本进程；生产以进程监督器直管 `node` 进程无此问题。另：tsx 包装进程在 `shutdown` 指令路径下（脚本自身 `process.exit(0)` 后）可能因探针持有管道而“不退出”——属 tsx CLI 生命周期伪影，真实 node 进程已退出（exit 0；SIGTERM 冒烟路径无此现象，因为包装进程被信号 handler 强制退出）。
- **SA6 未写 T7（stdin 错误链）与 T2（ws 传输单测）**（其红报 §0 明示取舍）：错误链行为（malformed-line/unknown-op/invalid-op-args/namespace-unknown/verify-write-timeout/write-failed/read-failed、SIGHUP 单飞 reload-ignored、换装断言）已按设计 §3.4/§3.7 实现并经手工验证，但无自动化红测覆盖；T7 补测时注意 tsx SIGHUP 投递语义。
- **hub 侧 `verify-write`**：实现对称路径（等 runtime ready + read enabled 后 mutateRoot），未被当前红测覆盖（红测仅 peer verify-write）。
- **`request-reauth`**（#175 seam 演示）实现并经参数校验，无端到端红测。
- 未做：跨机器真机、TLS 终止（设计明确外置）、压测/时序/fuzz（属 SA7 域）。
- 未推送、未建 PR；`pnpm install` 用仓库本地 pnpm 10.28.2 完成（corepack 默认 11.7.0 的 depsStatusCheck 会在根脚本先行失败——与本次代码无关，建议 CI 用 `packageManager` 声明的 pnpm 10）。
