# Issue #139 最终审查（Spec 轴 / Issue-AC）— 独立对抗性核对

**Date**: 2026-08-30
**Reviewer**: 最终审查·Spec 轴（只读；未修改任何业务代码/测试/配置/前序 SA 档案；本文件为唯一新增产物）
**审查对象**: worktree `/home/wangjian/nomicore-fix-issue-139` @ commit `381b9fd`（branch `fix/issue-139-on-docs-phase-5-websocket-replication`，ahead 4；基线 `git diff d911025...HEAD` = 199be62 / 758c3c4 / 4d9fff5 / 381b9fd，24 files / +4035/−6）
**Issue**: welltop-jim-wang/nomicore#139「Phase 5 deliver deployable Hub and Peer yjs-server app」（正文经 `gh api` 原文取回；"Blocked by #138" 依赖已核实 **closed**）
**规格源**: issue 正文 7 条 AC + What-to-build 总括；`task_issue-139_design.md`（SA1 R3）；`task_issue-139_sa7_report_r2.md`（动态验证）；`task_issue-139_ac_checklist.md`（SA5）；`docs/integration/hub-peer-deployment.md`；`apps/yjs-server/**` 实现。

**独立性声明**：本审查不采信任何前序报告的运行结论——套件、typecheck、配置校验行为均本轮亲测（§3 验证记录）；所有 file:line 证据经本轮源码重读核对。对 SA5 结论中可复核的每条判定做了反向攻击（找反例），未发现失实。

---

## 1. Issue 需求逐条映射表

### U0（What to build 总括）：可运行 Cordis 应用，可部署为 Hub 或 Peer，组合 Clock/Timer/独立 Persistence/NamespaceRegistry/认证授权/WS 复制，带配置校验与有序拆卸

| 维度 | 证据 |
|---|---|
| 实现 | `apps/yjs-server/src/app.ts` 装配序 clock fiber(`:166-168`)→TimerService(`:169`)→persistence fiber(`:170-182`)→registry fiber(显式 role, `:184-192`)→hub/peer 复制插件(`:233-241`/`:333-350`)；CLI `main.ts`（--config/NOMICORE_CONFIG、stdin NDJSON、SIGTERM/SIGINT/SIGHUP） |
| 测试 | 本轮亲测 app suite **7 files / 35 tests 全绿**（串行模式，§3-R1）；tsc EXIT=0（§3-R2） |
| 判定 | **覆盖** |

### AC1 — 恰好一个静态角色 + 全量配置校验（instanceId/listen/Hub URL/bearer/精确 Peer targets with local owners/资源限额/超时/Persistence 设置）

| 需求项 | 实现证据 | 测试证据 | 判定 |
|---|---|---|---|
| 恰好一个静态角色 | `config.ts:543-546` role 必填无缺省；`:556-569` role×hub/peer 块交叉拒；`:570-572` role=hub 顶层 `backoff` 拒；registry 显式传 role `app.ts:184-189` | app-config-red「缺 role」「hub 带 peer 块」「peer 带 hub 块」「hub 带 backoff」4 用例 | 覆盖 |
| instanceId 文法 | `config.ts:24` `^[a-z][a-z0-9-]{0,62}$` + `:547` | 「uppercase/leading digit 拒」用例 | 覆盖 |
| listen / Hub URL | listen host 非空 + port 整数 0..65535（0=ephemeral）`config.ts:235-254`；peer.hub.url 仅 ws/wss、有 host、无 fragment `:417-442` | 「坏 port」「非 ws(s) url」用例；smoke 用例 1 断言 port 0 上报实际端口 | 覆盖 |
| bearer 配置 | `hub.tokens` 非空 map、key 合文法、value 非空且**全表唯一**（`config.ts:269-284` seenTokenValues 查重，violation 锚靠后键）；`peer.hub.token` 非空 `:485-487` | 「duplicate token values … last-wins identity aliasing」用例（app-config-red:238-254）；**本轮直接执行 parseAppConfig 复核**：文档同形配置 + 重复 token 值 → loud 拒（§3-R3） | 覆盖 |
| 精确 Peer targets + local owner | 两字段精确 `{namespaceId, ownerUserId}`，多余键拒、nsId `^ns-[0-9a-f]{32}$`、重复拒、owner 非空 `config.ts:488-518` | 「target 文法/重复」用例 | 覆盖 |
| 资源限额/超时 | limits/timeouts 键集白名单 + 正有限数 `config.ts:100-123,552-554`；backoff peer 专属同款 | 「unknown key」类用例 | 覆盖 |
| Persistence 设置 | kind memory/file、file 必填 rootDir、schedule 正数且 `maxDirtyMs ≤ MAX_MAX_DIRTY_MS=30_000`（`config.ts:186-233,34,223-228`）；authorization 双形式全矩阵（恰一/直引必填 owner/provision 禁 owner/悬空 provisionId/重复对，`:333-415`）；未知键一律 violation；深冻结 `:595` | 22 用例全绿；**本轮直接执行复核**：maxDirtyMs 30001 → loud 拒（§3-R3）；lifecycle-watchdog-red 锚定 `maxDirtyMs:60000` boot 即 config-error + exit 1 且无 watchdog 击穿 | 覆盖 |

**AC1 判定：覆盖**（22/22 配置用例 + 真进程事件序断言 + 本轮独立执行复核）。

### AC2 — 独立 Memory/File Persistence root；共享活跃 File root 拒绝/声明 unsupported

| 需求项 | 实现证据 | 测试证据 | 判定 |
|---|---|---|---|
| 独立 root | 每进程按自身 config 选 memory/file（`app.ts:170-181`） | smoke 用例 1/2（hub/peer 各自独立 rootDir） | 覆盖 |
| 共享活跃 root 拒绝 | rootDir 内保留名锁 `.nomicore-lock.json`（`lifecycle.ts:25,60-99`：`wx` 独占创建、内容 {instanceId,pid}、冲突 pid 存活 → loud throw 且文案区分同实例重复启动 vs 不同实例共享 unsupported、pid 死 = stale 覆盖、EACCES/EPERM → loud 指向部署文档）；boot 前取锁 `main.ts:180-188`、干净停机/换装删锁 `main.ts:71,118` | smoke 用例 3（不同 instanceId 同活跃 rootDir → exit 1 + 输出含 `.nomicore-lock.json`）；用例 2 隐证锁随干净停机删除（同 rootDir 重启成功） | 覆盖 |
| 文档声明 unsupported | `docs/integration/hub-peer-deployment.md` §锁文件与共享 root（L151-163）+ §生产要求摘要（L196） | —（文档证据） | 覆盖 |

**AC2 判定：覆盖**。

### AC3 — Peer targets 幂等运行期 add/remove；URL/token/授权走 update/restart 语义

| 需求项 | 实现证据 | 测试证据 | 判定 |
|---|---|---|---|
| add-target 幂等 | `app.ts:538-552`：文法校验 → 已存在早退 ok（不重复发 target-added）→ 透传 `peer.addTarget` | stdin-error-chain 用例 1（add-target ok + target-added 事件）；「恰一次事件」显式断言缺（见 F7） | 覆盖（带测试债） |
| remove-target 幂等 | `app.ts:554-562`：透传幂等 `peer.removeTarget`（未知 nsId 无副作用）+ 本地表删除幂等 | 无自动化用例（见 F7）；实现直读简单 | 覆盖（带测试债） |
| URL/token/授权零运行期变更 op | dispatch 动词表 `app.ts:442-468` 无任何此类动词；文档 L133-134 明示 restart-only | 反向核对：动词表穷举核对无变更 op ✓ | 覆盖 |
| restart 生效路径 | ① 进程重启：授权绑定先于 listen（`app.ts:200-272`，绑定表 :203-232 → provision :244-250 → 才 listen :253-271）；② SIGHUP 换装 `main.ts:80-138`（单飞 reload-ignored / 先验证后拆卸 config-error 且旧实例继续 / 停旧全序 / 装新 / 运行期失败 loud exit(1) / 60s watchdog 全链覆盖） | ①动态覆盖：T6 hub SIGTERM→重启 + **直引形式授权变更经重启生效**（hub-restart:203-218,264-266）+ blocked→notify-auth-changed→收敛（:242-287）；smoke 用例 2 重启后授权换直引生效 durable 回读；②SIGHUP 半程：SA4 R2 §2.2 静态 trace + SA3 手工验证，**零自动化用例**（见 F1） | 覆盖（SIGHUP 半程证据弱，minor） |

**AC3 判定：覆盖**——AC 文字要求的语义（幂等 add/remove + 变更走 update/restart）已实现且 restart 半程有动态证据；SIGHUP 行为面自动化缺口记 F1（minor）。

### AC4 — 停机序：复制 drain/会话清理/Lease 释放 → Registry 停机 → Persistence dispose → Timer/Clock 拆卸

| 需求项 | 实现证据 | 测试证据 | 判定 |
|---|---|---|---|
| 全序 | `app.ts performStop:371-413`：wsServer.close（停接纳，不 await close 回调）→ hub.close（GOAWAY→drain→1001）/peer.stop → `replication-drained` → registry.shutdown（lease release/apply 排空）→ `registry-stopped` → file 排空窗（maxDirtyMs+500，上界 30.5s）→ persistenceFiber.dispose（落盘）→ `persistence-disposed` → 根 fiber dispose（Timer/Clock 最后）→ `app-stopped` | ordered-shutdown-red 2 用例：NDJSON 序 `replication-drained < registry-stopped < persistence-disposed < app-stopped` 严格递增 + 重复 stop 幂等 + 端口释放后同配置重建；真进程 SIGTERM exit 0 由 T3/T6/T7 各用例断言 | 覆盖 |
| 健壮性 | stop() single-flight `:364-369`；任一步异常 → `app-stop-failed` 后 rethrow `:406-411`；main.ts 60s 总超时 watchdog exit(1) `:64-68`；排空窗 ≤30.5s < 60s 的数值链由 config 上界保证（边界值双向测试锚定） | lifecycle-watchdog-red（boot 期 loud 拒绝路径）；触发臂动态验证缺（见 F2） | 覆盖 |

**AC4 判定：覆盖**。

### AC5 — 部署文档：本机三进程 + 跨机器示例 + 生产必须外置 TLS

| 需求项 | 文档证据 | 独立复核 | 判定 |
|---|---|---|---|
| 本机三进程 | `docs/integration/hub-peer-deployment.md` §本机三进程示例（L24-63）：hub.json + peer-1.json 完整配置、三进程独立 rootDir、hub tokens 声明 peer-1/peer-2、启动/停机顺序 | **本轮实测**：hub.json 与 peer-1.json 原文过 `parseAppConfig` 均 VALID（§3-R3）；peer-2 配置未显式给出（F9, info） | 覆盖 |
| 跨机器 | §跨机器示例（L80-88）：listen.host 0.0.0.0/内网、防火墙、`ws://<hub-dns-or-ip>:8080/replication`、独立密钥与 hubInstanceId | 文内一致 | 覆盖 |
| 生产必须外置 TLS | L86-88 醒目条款（无 TLS 时 bearer token 明文传输，仅限本机/受信内网联调）+ §生产要求摘要首条 L195 | 文内一致 | 覆盖 |
| 附加完整度 | 配置参考（L90-102）、stdin 动词表 + 稳定码注册表（L104-131）、SIGHUP 换装语义（L136-149，含 tsx 不转发 SIGHUP 的投递警示）、锁文件语义 + pid 复用指引（L151-163）、hub 重启 ⇒ peer 恢复 runbook（L173-191） | 与实现行为逐项对照一致 | — |

**AC5 判定：覆盖**。

### AC6 — 第三方 Cordis Host 不 import 应用内部即可组合公共 NamespaceLease/ReplicationSession 与复制插件

| 需求项 | 证据 | 判定 |
|---|---|---|
| 第三方组合（零 app-internal import） | `third-party-composition-red.test.ts:10-18` 仅 import `@deepseek-ai/cordis`、`cordis-plugin-timer`、`@nomicore/{clock,persistence,namespace-registry}`，复刻 hosting 装配 clock→TimerService→persistence→registry，`registry.create`（NamespaceLease）+ `lease.enableReplication()` + `lease.openReplicationSession`（ReplicationSession）成功（:21-59）；第 2 用例锚定 `@nomicore/yjs-server` 公共入口暴露（:61-65） | 覆盖 |
| 复制插件公共面 | `packages/ws-replication/src/index.ts:4-5` 导出 `createHubReplication`/`createPeerReplication`；app 自身即纯公共入口消费者形态（`hub-plugin.ts:19-29`、`peer-plugin.ts:16-27`、`app.ts:26-49`，零 `/testing` 子路径/内部模块）；零 `packages/**` 改动（diff 范围核对 ✓） | 覆盖（第三方身份直接组合插件的用例缺——F8, info：app 形态证明 + T4 import 清单共同锚定意图） |

**AC6 判定：覆盖**。

### AC7 — 冒烟测试：真进程起 Hub/Peer、认证、开 target、同步写、干净停机

| 需求项 | 测试证据（本轮亲测绿） | 判定 |
|---|---|---|
| 真进程 + 认证 | smoke 用例 1（11.9s 绿）：tsx 真子进程 hub（file+provision+authorization）启动序严格 `provisioned → listening(实际 port) → ready` → peer 静态 target + Bearer token 拨号认证 → ready | 覆盖 |
| 开 target | peer 配置态静态 targets（+ T7 用例 1 的 add-target 运行期开 target） | 覆盖 |
| 同步写 | `verify-write` 收敛 ok:true → hub `read` 回读 value===1（端到端复制收敛）；F1 修复后收敛稳定性由 T7 用例 2/3/4（零 settle 竞态 / hub-down 确定性窗口 / 满载）+ SA7 R2（34/34 无快速 write-failed、有界超时 10/10）闭合 | 覆盖 |
| 干净停机 | SIGTERM 双进程 exit 0（用例 1）；用例 2 同 rootDir 重启 durable 回读 41（持久化 + 锁释放）；用例 3 共享 root 拒 | 覆盖 |

**AC7 判定：覆盖**。

### 汇总

**7/7 AC + What-to-build 总括全部「覆盖」；无「未覆盖」项；无「偏差」级判定**（偏差类发现见 §2，均不改变覆盖判定）。

---

## 2. 发现列表（对抗性场景重点）

**0 blocker / 0 major / 4 minor / 5 info。**

| # | 严重级 | 攻击面 | 具体发现 | 证据 | 修订要求 / 测试构想 |
|---|---|---|---|---|---|
| F1 | **minor** | SIGHUP/重启语义（对抗重点） | SIGHUP 换装**行为面**零自动化测试：坏 config → `config-error` 且旧实例继续接纳、换装中重复 SIGHUP → `reload-ignored`、换装后旧 token 拨号被拒（`auth-upgrade-rejected`）。实现存在且静态正确（`main.ts:80-138` 本轮逐行核verified；SA4 R2 §2.2 trace；SA3 手工 `sa3_impl.md` §107）；AC3 restart 半程已动态覆盖（T6 授权变更经重启生效），SIGHUP 是实现额外提供的 update 半程 | `grep -rn SIGHUP apps/yjs-server/test/` = **0 命中**（本轮亲测） | 红灯 IT 构想：spawn 真进程（**直接 node/可转发信号形态**，tsx 不转发 SIGHUP——文档 L138-141 已警示）→ 注坏 config SIGHUP → 断言 `reload-starting→config-error` 且旧 token 连接仍被接纳 → 改回好 config（换 token）SIGHUP → 断言 `reload-complete` + 一次性旧 token 裸 ws 拨号得 1008 + hub NDJSON `auth-upgrade-rejected(invalid-credentials)`；换装中途二次 SIGHUP → `reload-ignored` 恰一次 |
| F2 | **minor** | reload/stop watchdog（对抗重点） | watchdog **触发臂**无动态验证：60s 挂起 → `reload watchdog timeout` + NDJSON `reload-failed(reason=watchdog-timeout)` + exit(1)。静态核实无误（`main.ts:64-68,90-95`，武装先于 reload-starting、unref、finally 回收、覆盖验证/停旧/锁/装新全链）；数值链 30.5s<60s 有双向边界测试；SA4 R2 O2/O3 原计划交 SA7 动态清单，但 SA7 R2 聚焦 F1 未执行触发臂 | SA4 R2 §O2/O3；SA7 R2 报告无 watchdog 触发臂条目 | 测试构想：测试注入可控挂起点（如 config 指向 FIFO 使 readFileSync 阻塞，或占住 rootDir 锁使装新挂起）→ 断言 60s（测试可用较大 timeoutMs/注入替身缩短）后 exit 1 + `reload-failed` 事件到达 stdout（留意 SA4 O3 的管道截断风险：先 sink 再 exit 的顺序已实现，动态侧需以管道读取器证实末事件不丢） |
| F3 | **minor** | 设计-实现措辞偏差（token/授权绑定） | 设计 §3.2 承诺「含 provision 形式的 (peerInstanceId, nsId) 对在**绑定表构建期查重**，重复 = 启动失败」；实现 `app.ts:299-309` `bindings.set` **无条件覆盖、无查重**。可达性分析：config 期 `seenProvision` 已拦 (peer, provisionId) 重复（`config.ts:401-405`）；跨形式同 nsId 冲突需 provision 随机生成的 32-hex nsId 与直引 nsId 精确碰撞（≈2^-128）→ **实践不可达、零实际风险**；属设计文本与实现的措辞级偏差（与 SA5 O3/O5 同类补注债） | `app.ts:299-309` vs 设计 §3.2 校验纪律段 | 二选一：① 实现补 loud assert（`bindings.has(key)` → throw「duplicate authorization binding」）；② 设计侧更正措辞为「config 期按 (peer,provisionId) 查重 + 跨形式碰撞概率性不可能」。红灯构想：构造同 (peer,nsId) 双条目直引（已由 config 期拦）+ 直引与 provision 撞 nsId（需 mock nsId 生成器）断言启动失败 |
| F4 | **minor** | verify-write 有界等待的姊妹面（read） | `opRead` 对「已知集但未物化」ns 即时 `read-failed`（`app.ts:478-479`），无 verify-write 同款有界等待。设计有意只对 verify-write 冻结有界等待契约；read 无 AC 要求；行为已文档化（doc L120 read-failed）。SA7 R2 O1 同判 | `app.ts:470-491`；SA7 R2 §8-O1 | 交 SA1 裁定是否扩展（非本轮缺口）；若扩展，红灯构想：hub 重启窗口内 read 已知 ns → 有界等待或显式 `not-materialized` 稳定码，而非即时 read-failed |
| F5 | info | 验证环境（部署可运行性旁证） | 本机（4 核共享）**并行** vitest 触发 fork 预算耗尽：本轮首次并行跑 4 files failed，失败签名全部 `spawn tsx EAGAIN`（环境性，非产品缺陷）；串行复跑 7/35 全绿。与 SA4 R2 O5、SA7 R2 §0-O4（本机线程/进程预算上限）记账一致；观察期内同机另有 MABF runner 并发验证作业运行 | 本轮 §3-R0 vs §3-R1 对照 | CI（推送后）在更大 runner 上需留意并行真子进程用例的资源上限；必要时 CI 侧 `--no-file-parallelism` |
| F6 | info | 发布链 | 分支 ahead 4 未推送 → 无远程 CI run/PR 可摘录（SA5 O4 / SA7 R2 §7 同记）。本地 CI-parity（app 套件 + app tsc + `pnpm typecheck` 等价命令）全绿 | `git status -sb`；本轮亲测 | 发布（push/PR/CI run）属 Host 动作，非本轴判定输入 |
| F7 | info | AC3 幂等细节断言 | `remove-target` 与重复 add 的「恰一次 `target-added`」无显式自动化断言（SA5 O1 部分项）。实现直读简单且幂等守卫清晰（`app.ts:547` 已存在早退、`:560` 透传幂等 API） | grep `remove-target` test/ 仅命中实现侧引用 | 红灯构想：T7 用例 1 追加——同 nsId add×2 断言 `target-added` 事件恰一次且两次回执均 ok；add 后 remove → 再 read 该 ns 得 `namespace-unknown`（peerOwners 删除） |
| F8 | info | AC6 证据形态 | 第三方测试（T4）组合了 NamespaceLease/ReplicationSession 公共面，但未以第三方身份**直接组合复制插件**；复制插件公共面组合由 app 自身形态证明（仅经 `@nomicore/ws-replication` 公共入口）。AC6 意图（无需 app 内部）已由 T4 import 清单 + app 形态共同锚定 | `third-party-composition-red.test.ts:10-18`；`hub-plugin.ts:19-29` | 可选补强：T4 增一用例以公共 `createHubReplication`/`createPeerReplication` + 假 transport 组合最小生命周期 |
| F9 | info | AC5 文档完整度 | 三进程示例显式给出 hub.json/peer-1.json，peer-2 仅由 tokens 键与文字描述承载（克隆 peer-1 改 instanceId/token/rootDir 即得）。示例配置本身**实测可解析运行**（§3-R3），可运行性不受影响 | doc L28-59 | 可选：补 peer-2.json 或一句「peer-2.json = peer-1.json 改 instanceId=peer-2、token=secret-token-2、rootDir=/srv/nomicore/peer2-data」 |

**对抗重点五项结论汇总**：

1. **verify-write 有界等待**：✅ 闭合——`openWriteNamespace`（NOT_FOUND 在单 op deadline 内 50ms 重试，`app.ts:611-625`）与 `waitNamespaceLive`（共用同一 deadline 剩余预算 `Math.max(0, deadline-now)`，`:526`）总预算不叠加；`write-failed` 收缩为真实错误/物化后失败。动态证据：T7 用例 1（never-live 已知 ns → ≥450ms 且 <8s 的 `verify-write-timeout`）+ 用例 2/3/4（零 settle 竞态/确定性窗口/满载收敛）本轮全绿；SA7 R2 34/34 + 有界超时 10/10 + 未知集 ns 负例保持即时 `namespace-unknown`（契约未被泛化）。
2. **token 唯一性 loud 拒绝**：✅ 闭合——`validateTokens` 全表查重锚靠后键（`config.ts:269-284`）；boot 与 SIGHUP 前置验证共用 `parseAppConfig` 双路径 loud；自动化用例（app-config-red:238-254）+ **本轮直接执行复核**（文档同形配置注入重复 token 值 → loud 拒）。
3. **reload watchdog**：✅ 代码闭合 / ⚠ 触发臂动态验证缺（F2）——武装先于 reload-starting、覆盖全链、unref、finally 回收、`reload-failed`+exit(1)；boot 期防击穿（maxDirtyMs 上界）有双向边界测试 + 真子进程用例。
4. **SIGHUP/重启语义**：✅ restart 半程动态闭合（T6 授权变更经重启生效 + blocked 恢复 runbook 全链断言）/ ⚠ SIGHUP 半程静态+手工（F1）——零运行期变更 op 反向核对成立。
5. **部署可运行性**：✅ 文档示例配置本轮实测 parseAppConfig 全 VALID；smoke 即文档命令形态（`tsx apps/yjs-server/src/main.ts --config …`）真进程跑通认证/开 target/写同步/干净停机。

---

## 3. 本轮验证记录（只读复跑，命令 + 结果）

| # | 命令 | 结果 |
|---|---|---|
| R0 | `./node_modules/.bin/vitest run apps/yjs-server/test`（默认并行） | ❌ 4 files failed / 7 tests failed——失败签名全部 `spawn tsx EAGAIN`（本机 fork 预算耗尽，环境性；同机另有 runner 并发作业）；孤儿已清场（仅清理本轮自产进程） |
| R1 | `./node_modules/.bin/vitest run apps/yjs-server/test --no-file-parallelism` | ✅ **7 files / 35 tests 全绿，EXIT=0**（99.59s；与 SA7 R2 / SA5 报告数字一致；跑后复核无本轮残留进程） |
| R2 | `./node_modules/.bin/tsc -p apps/yjs-server/tsconfig.json` | ✅ EXIT=0 |
| R3 | `tsx /tmp/spec139/check.mjs`（文档 hub.json/peer-1.json 原文 + 对抗变体过 `parseAppConfig`） | ✅ hub.json VALID / peer-1.json VALID；重复 token 值 → loud 拒（`duplicate token value`）；maxDirtyMs 30001 → loud 拒 |
| R4 | `grep -rn SIGHUP apps/yjs-server/test/` | 0 命中（F1 证据） |
| R5 | `gh api repos/welltop-jim-wang/nomicore/issues/139 --jq .body` / `issues/138 --jq '{state,title}'` | issue 正文取回（7 AC）；#138 state=**closed**（blocked-by 满足） |
| R6 | `git status --porcelain`（收尾） | 仅 `?? wiki/raw/task_issue-139_*` SA 产物（含本文件）；零业务改动 |

注：R0 的 EAGAIN 与 R1 的全绿对照本身构成 F5 的证据；串行模式是 SA7 R2 已记录的本机纪律（§0「六阶段严格串行」同因）。

---

## 4. 覆盖率与结论

- **需求覆盖率：8/8**（What-to-build 总括 + AC1–AC7 逐条「覆盖」；其中 AC3/AC6 携带 minor/info 级测试债或证据形态注记，不影响覆盖判定）。
- **发现计数：0 blocker / 0 major / 4 minor（F1–F4）/ 5 info（F5–F9）**——全部 minor 项均为测试债或措辞对齐债，存在对应实现且静态/手工证据在案；无任何「AC 要求但未实现/未文档化」项。
- reject 条件（存在 blocker）不成立。

**Verdict: pass**
