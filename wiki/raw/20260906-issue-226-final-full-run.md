# Issue #226 最终验证 — 全量回归完整运行输出（2026-09-06，Job bash-45，--testTimeout=30000）

```text

> nomicore@0.1.0 test /home/wangjian/nomicore-fix-issue-226
> NODE_OPTIONS=--conditions=nomicore-source vitest run --typecheck --testTimeout=30000

Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 RUN  v3.2.7 /home/wangjian/nomicore-fix-issue-226

 ✓  TS  domains/vfs3-assets/test/vfs3-assets-migration.test-d.ts (6 tests)
 ✓  TS  domains/vfs3-assets/test/vfs3-assets-projection.test-d.ts (19 tests)
 ✓  TS  packages/clock/test/clock-contract.test-d.ts (7 tests)
 ✓  TS  packages/doc-runtime/test/public-surface-type-guard.test-d.ts (2 tests)
 ✓  TS  packages/doc-runtime/test/read-logical-value-at-path-schema-independent.test-d.ts (4 tests)
 ✓  TS  packages/instance/test/instance.test-d.ts (1 test)
 ✓  TS  packages/namespace-diagnostic-log/test/identity.test-d.ts (9 tests)
 ✓  TS  packages/namespace-registry/test/registry-data-interface.test-d.ts (1 test)
 ✓  TS  packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-surface.test-d.ts (4 tests)
 ✓  TS  packages/namespace-registry/test/registry-phase5-bootstrap-reset-surface.test-d.ts (4 tests)
 ✓  TS  packages/namespace-registry/test/registry-phase5-identity-surface.test-d.ts (5 tests)
 ✓  TS  packages/namespace-registry/test/registry-phase5-replication-session-surface.test-d.ts (5 tests)
 ✓  TS  packages/namespace-registry/test/registry-phase5-replication-surface.test-d.ts (6 tests)
 ✓  TS  packages/namespace-runtime/test/runtime-close-lifecycle-type-guard.test-d.ts (3 tests)
 ✓  TS  packages/namespace-runtime/test/runtime-data-interface.test-d.ts (2 tests)
 ✓  TS  packages/namespace-runtime/test/runtime-registry-internal-type-guard.test-d.ts (3 tests)
 ✓  TS  packages/namespace-runtime/test/runtime-replace-schema-type-guard.test-d.ts (1 test)
 ✓  TS  packages/persistence/test/persistence-phase5-archive-surface.test-d.ts (4 tests)
 ✓  TS  packages/replication-protocol/test/codec-api.test-d.ts (7 tests)
 ✓  TS  packages/vfsl-codegen/test/generate-discriminated-narrow.test-d.ts (6 tests)
 ✓  TS  packages/vfsl-protocol/test/vfsl-protocol-empty-fail-closed.test-d.ts (3 tests)
 ✓  TS  packages/vfsl-protocol/test/vfsl-protocol-projection.test-d.ts (16 tests)
 ✓  TS  packages/ws-replication/test/ws-replication-api.test-d.ts (16 tests)
 ✓ packages/vfsl/test/validate-patch-sa7.test.ts (22 tests) 80596ms
   ✓ SA7 补充：WorkBudgetExceeded 穿透 validateSubtree（SA4 动态重点#3） > 预算内对照：100k 键 × 120 成员联合经 validatePatch 新键写 -> 101 条截断输出（不误伤）  15699ms
   ✓ SA7 补充：WorkBudgetExceeded 穿透 validateSubtree（SA4 动态重点#3） > 超预算 loud fail-closed：900k 键 × 120 成员联合写入 -> 单条预算 issue + rebase 边界前缀 [m]  64721ms
 ✓ packages/vfsl/test/validate-snapshot-sa7.test.ts (14 tests) 65998ms
   ✓ SA7 补充：四类 pattern loud 消息逐一触发（设计 §6.5；此前仅两类被间接覆盖） > 匹配步数预算耗尽：(?=.*;)z × 5000 码元 → 4M 钳制 loud（「无法判定」，非「不匹配」）  349ms
   ✓ SA7 补充：全局工作预算 WorkBudgetExceeded（设计 §3.4——首次动态触发的持久锚定） > 预算内照常完成（WORK_LIMIT 是上界不是配额）：100k 键 × 120 成员联合 → 101 条截断输出  6846ms
   ✓ SA7 补充：全局工作预算 WorkBudgetExceeded（设计 §3.4——首次动态触发的持久锚定） > 超预算 loud fail-closed：900k 键 × 120 成员联合（≈2.2×10⁸ 单位 > 2×10⁸）→ 单条预算耗尽 issue  55657ms
   ✓ SA7 补充：崩溃边界 E100 收编（设计 §10 R3——RangeError 触发面） > 深 ref 链（解析后深度 3×10⁴，表达式嵌套每层=2）× 等深快照 → RangeError 收编为单条 E100  1496ms
   ✓ SA7 补充：memo 65,536 封顶清空重建后正确性（设计 §3.4） > 70k distinct (节点,值) 对 → 封顶多次重建，输出仍精确（101 条 + 截断计数 300）  723ms
   ✓ SA7 补充：SA2 R2-1 前瞻攻击构造回归锚（设计 §6.4 包络表 202 行） > lookMemo 稀疏物化：200 条空前瞻 × 10⁷ 码元 → 4M 钳制 loud，无 GB 级内存面（毫秒级返回）  858ms
stdout | apps/yjs-server/test/phase5-mgmt-verbs-sa7.test.ts > Phase-5 SA7 补充：bump-epoch 回执值正确性 + fence 检出延迟实测 > 回执 replicationEpoch=2 与权威代际交叉验证；fence 事件时延记录（<30s 契约余量）
[SA7] fence detection latency: peer-1=7398ms peer-2=2466ms (contract upper bound ackTimeoutMs=10s, assert <30s)

stdout | apps/yjs-server/test/phase5-mgmt-verbs-sa7.test.ts > Phase-5 SA7 补充：file 适配器 reset-replica 全周期 > reset ok + replica-reset 事件 + archive 落盘 + 进程内重引导收敛 + 崩溃重启恢复收敛
[SA7] file reset 后崩溃重启恢复路径: reconcile/sync（本地副本在档）

 ✓ apps/yjs-server/test/phase5-mgmt-verbs-sa7.test.ts (5 tests) 55737ms
   ✓ Phase-5 SA7 补充：bump-epoch 回执值正确性 + fence 检出延迟实测 > 回执 replicationEpoch=2 与权威代际交叉验证；fence 事件时延记录（<30s 契约余量）  15861ms
   ✓ Phase-5 SA7 补充：replace-schema 额外键响亮拒绝 + SCHEMA 未变 + 干净重提传播 > 5 键信封 → write-failed；旧 schema 写行为/读数不变；四键重提 ok；hub 写新字段收敛  4853ms
   ✓ Phase-5 SA7 补充：file 适配器 reset-replica 全周期 > reset ok + replica-reset 事件 + archive 落盘 + 进程内重引导收敛 + 崩溃重启恢复收敛  8490ms
   ✓ Phase-5 SA7 F1 回归锁：两轮 bump→fence→reset 运维循环的第二轮重引导 > 第二次成功 reset-replica 后重引导收敛；文档化恢复入口 add-target 有效  13383ms
   ✓ Phase-5 SA7 O-R3-1：终态通道（conflicted）+ peerOwners 在册 → add-target 放行 → target-added + 重建 > fence 终态下 add-target 不被幂等集短路：target-added 事件 + 通道离开终态 + 重建后 reset 收敛  13129ms
 ✓ apps/yjs-server/test/smoke-skeleton-red.test.ts (4 tests) 52587ms
   ✓ T3-skeleton real-process smoke (design §5-T3 minimized / AC7/AC2) > deployable hub rejects missing and invalid bearer credentials before WebSocket upgrade  7269ms
   ✓ T3-skeleton real-process smoke (design §5-T3 minimized / AC7/AC2) > hub emits provisioned→listening(actual port)→ready; peer authenticates static target; verify-write converges to hub read; SIGTERM exits 0  14711ms
   ✓ T3-skeleton real-process smoke (design §5-T3 minimized / AC7/AC2) > clean shutdown releases the rootDir lock: same rootDir restarts and reads back the durable value  22192ms
   ✓ T3-skeleton real-process smoke (design §5-T3 minimized / AC7/AC2) > a second instance sharing an active file root is rejected loudly (lock guard, AC2)  8411ms
 ✓ apps/yjs-server/test/stdin-error-chain-red.test.ts (4 tests) 51195ms
   ✓ T7 stdin error chain + F1 verify-write bounded materialization wait (design §5-T7 / SA7 §2.5) > error chain: malformed-line / unknown-op / namespace-unknown; verify-write on a never-live known ns waits to the bounded deadline then verify-write-timeout (never a ~50ms write-failed)  9822ms
   ✓ T7 stdin error chain + F1 verify-write bounded materialization wait (design §5-T7 / SA7 §2.5) > F1 race: verify-write fired immediately after peer ready (zero settle) converges for a live namespace — fresh peer per round, concurrent burst  14155ms
   ✓ T7 stdin error chain + F1 verify-write bounded materialization wait (design §5-T7 / SA7 §2.5) > F1 race (deterministic window): verify-write issued while the hub is down stays in bounded wait (zero fast replies), then converges once the hub restarts  16938ms
   ✓ T7 stdin error chain + F1 verify-write bounded materialization wait (design §5-T7 / SA7 §2.5) > F1 race under load: verify-write fired immediately after peer ready while CPU burners contend — must converge, not fast write-failed (SA7 loaded repro shape)  10279ms
 ✓ apps/yjs-server/test/phase5-three-instance-acceptance-red.test.ts (6 tests) 49409ms
   ✓ Phase-5 close AC1/AC6 已交付验收（三实例收敛 / crash recovery 回归锁） > AC1（MemoryPersistence）：hub+p1+p2 并发 ROOT 写 → 三处收敛（独立 rootDir）  4661ms
   ✓ Phase-5 close AC1/AC6 已交付验收（三实例收敛 / crash recovery 回归锁） > AC1（FilePersistence）：hub+p1+p2 并发 ROOT 写 → 三处收敛（独立 rootDir）  4792ms
   ✓ Phase-5 close AC1/AC6 已交付验收（三实例收敛 / crash recovery 回归锁） > AC6（FilePersistence）：peer-2 崩溃（SIGKILL 真实 app pid）→ hub 期间写入 → 同 rootDir 重启 → 收敛  8555ms
   ✓ Phase-5 close AC3 红灯锚（hub SCHEMA 传播 / epoch fencing / guarded reset 管理面） > AC3-①: hub 合法 SCHEMA 替换单向传播到双 peer（replace-schema 动词）  6331ms
   ✓ Phase-5 close AC3 红灯锚（hub SCHEMA 传播 / epoch fencing / guarded reset 管理面） > AC3-②: hub bump-epoch → 双 peer channel 立即 identity-conflicted（epoch fencing）  20283ms
   ✓ Phase-5 close AC3 红灯锚（hub SCHEMA 传播 / epoch fencing / guarded reset 管理面） > AC3-③: 受控 reset-replica —— 错误 expected identity 稳定拒绝零破坏；正确 identity 归档重引导后收敛  4781ms
 ✓ apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts (22 tests) 46383ms
   ✓ issue #155 — strict diagnostic replay 工具契约（AC4/AC5） > R1 健康链完整重放：genesis + create + 3 committed 增量 + noop → complete + owned snapshot 复现终态  448ms
   ✓ issue #155 — Host 生命周期 E2E（AC1/AC3/AC6） > E1 启用从 namespace 创建起：provision create → genesis-baseline + create/replication-enable 记录落地，策略不进数据面与 snapshot  7438ms
   ✓ issue #155 — Host 生命周期 E2E（AC1/AC3/AC6） > E2 ROOT/SCHEMA 变更链记录：verify-write 与 replace-schema 产生 committed 记录且 sequence 连续  7175ms
   ✓ issue #155 — Host 生命周期 E2E（AC1/AC3/AC6） > E3 Host 停机有界且日志完好：SIGTERM 干净退出（30s 界），停机后日志 strict 一致  7248ms
   ✓ issue #155 — Host 生命周期 E2E（AC1/AC3/AC6） > E4 日志故障隔离：diagnostics.rootDir 指向普通文件（stream init 失败）→ 业务不受影响（provision/read 照常）  7186ms
   ✓ issue #155 — Host 生命周期 E2E（AC1/AC3/AC6） > E5 hub 重启（多 Runtime generation）延续同一 stream；peer 不启用（Hub/Peer 独立本地旁路）且复制数据面无策略  16244ms
 ✓ apps/yjs-server/test/hub-restart-static-target-red.test.ts (1 test) 32218ms
   ✓ T6 hub restart ⇒ peer blocked-recovery (design §5-T6 / AC1+AC3) > hub restart drives peer to blocked; negative silence window; notify-auth-changed recovers to live and converges  32217ms
stderr | packages/namespace-registry/test/registry-surface.test.ts
Using an object as a third argument is deprecated. Vitest 4 will throw an error if the third argument is not a timeout number. Please use the second argument for options. See more at https://vitest.dev/guide/migration
Using an object as a third argument is deprecated. Vitest 4 will throw an error if the third argument is not a timeout number. Please use the second argument for options. See more at https://vitest.dev/guide/migration
Using an object as a third argument is deprecated. Vitest 4 will throw an error if the third argument is not a timeout number. Please use the second argument for options. See more at https://vitest.dev/guide/migration

 ✓ packages/namespace-registry/test/registry-surface.test.ts (12 tests) 22356ms
   ✓ declaration emit 审计：主入口可达声明图无 Runtime/DocHandle/Y.Doc / internal subpath > 主入口可达声明图文本不包含任何禁用标识符，且审计本身非空（覆盖 wrapper 链，含 #112 plugin.ts）  9664ms
   ✓ declaration emit 审计：主入口可达声明图无 Runtime/DocHandle/Y.Doc / internal subpath > 主入口 index.d.ts：#112 增量类型/值导出在（ShutdownError/PluginConfig/ShutdownFailure/RegistryTimeoutScheduler/plugin 工厂）；RegistryOperationUnavailableIssue 删除后不在  6668ms
   ✓ declaration emit 审计：主入口可达声明图无 Runtime/DocHandle/Y.Doc / internal subpath > testing 入口声明允许内部类型 import（Runtime/DocHandle 仅出现在受控子路径）  4281ms
   ✓ 模块边界活链路（SA2 B3；REPO_ROOT relPath，非 fixture-only） > 真实生产树扫描收集 registry.ts 的 internal import 且 violators=[]  762ms
   ✓ 模块边界活链路（SA2 B3；REPO_ROOT relPath，非 fixture-only） > Registry 包内仅 registry.ts 消费 internal subpath（testing.ts 不消费）  635ms
 ✓ packages/vfsl-codegen/test/generate-cli-check.test.ts (8 tests) 20803ms
   ✓ AC4 — pnpm generate 存在且幂等（全量重新生成 + 写盘） > pnpm generate 命令存在且成功退出（退出码 0）——被测 CLI 存在的事实锚点  1365ms
   ✓ 单领域自定义输出 > 将指定领域生成到宿主 package 路径，内容与默认 projection 逐字节相同  2586ms
   ✓ 单领域自定义输出参数与 freshness > 自定义输出 --check：fresh=0；stale/missing=1 且不写盘  5331ms
   ✓ 单领域自定义输出参数与 freshness > 无效参数响亮失败：["generate","--domain","demo"]  1036ms
   ✓ 单领域自定义输出参数与 freshness > 无效参数响亮失败：["generate","--out","x.ts"]  1350ms
   ✓ 单领域自定义输出参数与 freshness > 无效参数响亮失败：["generate","--domain","missing","--out","x.ts"]  1723ms
   ✓ AC4 — generate --check 对过期生成物退出非零，对新鲜生成物退出 0 > generate 后再 --check → diff 为空 → 退出 0（新鲜生成物）  4805ms
   ✓ AC4 — generate --check 对过期生成物退出非零，对新鲜生成物退出 0 > 源漂移后 --check → 退出非零（源改动 → 重新生成后 diff 非空）  2599ms
 ✓ packages/vfsl/test/validate-logical-snapshot.test.ts (29 tests) 14770ms
   ✓ 行为回归 — 资源预算 II：Pattern 匹配步数 4M 钳制 loud（「无法判定」非「不匹配」） > (?=.*;)z × 5000 码元 → 单条精确 budget issue，path ["v"]  388ms
   ✓ 行为回归 — 资源预算 III：全局工作预算 WORK_LIMIT=2×10⁸ 耗尽 fail-closed > NFA 步数跨多次匹配累计超 2×10⁸ → 单条预算耗尽 issue（非 E100、非截断、非 Pattern），path []  14187ms
 ✓ packages/dsh-persistence/test/dsh-probe-cli.test.ts (7 tests) 14137ms
   ✓ DSH 探针命令（AC8：可复制的命令 + 输出记录） > memory profile：命令输出完整记录（AC2/AC3 链路标记）并以 0 退出  1381ms
   ✓ DSH 探针命令（AC8：可复制的命令 + 输出记录） > 可复制性：同一命令两次运行 stdout 逐字节一致  2790ms
   ✓ DSH 探针命令（AC8：可复制的命令 + 输出记录） > file profile：命令落盘快照（users/<user>/<doc>.snapshot），记录不携带 rootDir 痕迹；两次运行记录一致  3456ms
   ✓ DSH 探针命令（AC8：可复制的命令 + 输出记录） > AC4 完整性：--fail-first-flushes 1 使记录包含 degraded → save-degraded → recovered 完整序列  2962ms
   ✓ DSH 探针命令（AC8：可复制的命令 + 输出记录） > 异常输入：file adapter 缺 rootDir → 非零退出并报错  1919ms
   ✓ DSH 探针命令（AC8：可复制的命令 + 输出记录） > 异常输入：未知 adapter → 非零退出并报错  1610ms
 ✓ apps/yjs-server/test/issue164-slice9-red.test.ts (10 tests) 10587ms
   ✓ issue #164 切片 9：apps/yjs-server 组合根（真实 WebSocket） > FS2 全链路：101 → HELLO_ACK → OPEN(bootstrap) → BOOTSTRAP_SNAPSHOT → ACK → round 1 diff 应用 → hub 文档收敛  3029ms
   ✓ issue #164 切片 9：apps/yjs-server 组合根（真实 WebSocket） > FS7 namespace 权限接线：未经授权 namespace → NAMESPACE_UNAUTHORIZED（连接不杀）  331ms
   ✓ issue #164 切片 9：apps/yjs-server 组合根（真实 WebSocket） > FS8 活性链路：hub 经真实 adapter 发送 WS ping；回 pong 连接保持（G5.1）  4013ms
   ✓ issue #164 切片 9：apps/yjs-server 组合根（真实 WebSocket） > FS9 活性链路反向：不回 pong → hub 以 pong-timeout 收口（onPong 面真实接线）  3007ms
stdout | packages/ws-replication/test/ws-replication-sa7-r1-transport-auth.test.ts > issue #138 SA7 R1：真实 TCP 认证窗口动态验证（SA4 D3/D4/D5） > D3-①条数界：未认证 socket 灌 40×1MiB → 第 17 帧即 close(1008)、零分配、后续帧零驻留（40MiB 上 wire 活外部内存增量 ≤24MiB）
[SA7-DIAG] D3-① flood40MiB framesParsed=17 extDeltaAfterClose=17.1MiB rssDelta=106.2MiB

stdout | packages/ws-replication/test/ws-replication-sa7-r1-transport-auth.test.ts > issue #138 SA7 R1：真实 TCP 认证窗口动态验证（SA4 D3/D4/D5） > D3-②封顶+回收：认证等待 helloTimeoutMs(2s) 到点 close(1008/upgrade-timeout)；16×1MiB 早到帧活外部内存驻留有界（8–40MiB ≪ 128MiB 结构界）、迟归验证器不复活、放行后驻留释放过半
[SA7-DIAG] D3-② cap16MiB extHeldDelta=17.0MiB extReleasedDelta=1.0MiB rssRawPeak=55.6MiB rssSteady=50.8MiB rssFinal=0.5MiB gc=expose-gc

 ✓ packages/ws-replication/test/ws-replication-sa7-r1-transport-auth.test.ts (5 tests) 10881ms
   ✓ issue #138 SA7 R1：真实 TCP 认证窗口动态验证（SA4 D3/D4/D5） > D5：verifyToken 异步窗口内 HELLO 早到——积压重放（after-first-frame）与直达（immediate）两形态均恰 1 个 HELLO_ACK、零 SEQUENCE_VIOLATION/ERROR、live 双向收敛  331ms
   ✓ issue #138 SA7 R1：真实 TCP 认证窗口动态验证（SA4 D3/D4/D5） > D4：hub.close() → peer 原始 socket 先收 GOAWAY(SERVER_SHUTTING_DOWN, drain>0) 帧再收 close 事件；hub 侧 close(1001)；peer 终态 blocked  5122ms
   ✓ issue #138 SA7 R1：真实 TCP 认证窗口动态验证（SA4 D3/D4/D5） > D3-①条数界：未认证 socket 灌 40×1MiB → 第 17 帧即 close(1008)、零分配、后续帧零驻留（40MiB 上 wire 活外部内存增量 ≤24MiB）  1360ms
   ✓ issue #138 SA7 R1：真实 TCP 认证窗口动态验证（SA4 D3/D4/D5） > D3-②封顶+回收：认证等待 helloTimeoutMs(2s) 到点 close(1008/upgrade-timeout)；16×1MiB 早到帧活外部内存驻留有界（8–40MiB ≪ 128MiB 结构界）、迟归验证器不复活、放行后驻留释放过半  2855ms
   ✓ issue #138 SA7 R1：真实 TCP 认证窗口动态验证（SA4 D3/D4/D5） > D3-③单帧界：首帧 > maxFrameBytes(8MiB) → close(1009)，零协议连接分配、零协议帧  1207ms
 ✓ packages/namespace-runtime/test/runtime-replace-schema-sa7-dynamic.test.ts (11 tests) 7295ms
   ✓ SA7 动态验证 — T3.4（rev2）：深 doc × keep-root → E 层吸收为领域失败 + 零写入 + fatal 零置位 + provide-root 修复通道开放 > 深 doc × keep-root replaceSchema({schema: ENV_DEEP}) → resolved ok:false（/DOCRT-E100|VFSL-E100|校验工作预算耗尽/）+ 零写入 + fatal 零置位 + 写位未禁（运行时修复通道开放）；同 runtime provide-root 修复尝试的实测结果按 SA6 偏差锚登记（见注释）  7001ms
stderr | packages/doc-runtime/test/doc-runtime-surface.test.ts
Using an object as a third argument is deprecated. Vitest 4 will throw an error if the third argument is not a timeout number. Please use the second argument for options. See more at https://vitest.dev/guide/migration

 ✓ packages/doc-runtime/test/doc-runtime-surface.test.ts (2 tests) 7738ms
   ✓ declaration emit：doc-runtime 主入口合法出现 createInitialDocument 与 Y.Doc（§8 正向 fixture） > 主入口可达声明图包含 createInitialDocument 且合法出现 Y.Doc（正向 fixture）  7727ms
 ✓ packages/vfsl/test/schema-check-cli.test.ts (6 tests) 8149ms
   ✓ pnpm schema:check schema validation > accepts a valid schema without requiring a domain layout  1266ms
   ✓ pnpm schema:check schema validation > rejects an invalid schema with line and column diagnostics  1361ms
   ✓ pnpm schema:check ROOT data validation > validates ROOT data read from a JSON file  1239ms
   ✓ pnpm schema:check ROOT data validation > validates ROOT data read from stdin  1695ms
   ✓ pnpm schema:check ROOT data validation > reports JSON-path issues for invalid ROOT data  1342ms
   ✓ pnpm schema:check ROOT data validation > rejects malformed JSON input as a usage error  1238ms
stdout | apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts > SA7 动态重点 1 — C1 并发 create 交错（数据键控归因，跨 namespace 误归因不可达） > Promise.all([create A(挂 gate), create B(createDoc 注入 OperationalError)])：B 以 NS_B 归属落自己的流（attempt transaction/NAMESPACE_CREATE_FAILED/rejected、目录存在）；全程零 unattributed 丢弃；A 流干净（genesis+#17、无 B marker、replay complete/issues=[]）
[SA7-DV] C1 并发交错：A 流 2 条记录（genesis+#17）；B 流 1 条（NS_B 归属 attempt）；sink 事件 [{"event":"diagnostic-log","namespaceId":"ns-00000000000000000000000000000001","type":"retention-swept","deletedGroups":0,"reclaimedBytes":0,"orphanBinsDeleted":0,"deletingMarkersCompleted":0,"leaseBlockedGroups":0,"failedSteps":0}]

stdout | apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts > SA7 动态重点 3 — issues 镜像双份运行时复核（保守方向：只多不少，不影响三态） > 中段两行垃圾：invalid-json 恰 3 份（镜像 2 + 停止点 1）、partial、lastAppliedSequence 停在停止点前、snapshot 仍在
[SA7-DV] §六(a) 镜像双份实测：issues=[{"code":"invalid-json"},{"code":"invalid-json"},{"code":"invalid-json"}] status=partial

stdout | apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts > SA7 动态重点 5 — D8 健康事件面 + D1 无泛滥（enabled 态进程级 NDJSON 摘录） > 启用态全生命周期：provision→write→SIGTERM exit 0；停机恰一次 diagnostics-closed；健康运行零 emission-dropped；数据通道记录落地
[SA7-DV] D8 enabled 态全生命周期 diagnostic* NDJSON 事件流：[{"event":"diagnostic-log","namespaceId":"ns-5f663cf04d4a314170d239cdd89239f4","type":"retention-swept","deletedGroups":0,"reclaimedBytes":0,"orphanBinsDeleted":0,"deletingMarkersCompleted":0,"leaseBlockedGroups":0,"failedSteps":0},{"event":"diagnostics-closed"}]

 ✓ apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts (6 tests) 8567ms
   ✓ SA7 动态重点 1 — C1 并发 create 交错（数据键控归因，跨 namespace 误归因不可达） > Promise.all([create A(挂 gate), create B(createDoc 注入 OperationalError)])：B 以 NS_B 归属落自己的流（attempt transaction/NAMESPACE_CREATE_FAILED/rejected、目录存在）；全程零 unattributed 丢弃；A 流干净（genesis+#17、无 B marker、replay complete/issues=[]）  508ms
   ✓ SA7 动态重点 5 — D8 健康事件面 + D1 无泛滥（enabled 态进程级 NDJSON 摘录） > 启用态全生命周期：provision→write→SIGTERM exit 0；停机恰一次 diagnostics-closed；健康运行零 emission-dropped；数据通道记录落地  7837ms
 ✓ packages/namespace-registry/test/registry-phase5-replication-session-red.test.ts (22 tests) 5104ms
   ✓ AC-5 peer degraded 只允许 hub→peer trusted apply；O-5 补锚 (a)(b) > peer persistence-degraded：业务写禁用（RUNTIME_WRITE_DISABLED）；hub→peer apply 允许（内存生效 + saveDoc 仍登记 + 内存/磁盘可区分）  2506ms
   ✓ AC-5 peer degraded 只允许 hub→peer trusted apply；O-5 补锚 (a)(b) > 补锚 (a)：hub persistence-degraded 拒绝 peer→hub raw apply；读取、身份检查和 state-vector 交换保留  2278ms
 ✓ apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts (7 tests) 5049ms
   ✓ root lock atomic ownership > recovers a directory lock left by a dead process  486ms
   ✓ root lock atomic ownership > real-process stale reclaim race has exactly one live owner  4547ms
 ✓ packages/ws-replication/test/ws-replication-sa7-issue171-real-transport.test.ts (4 tests) 3774ms
   ✓ SA7 RT-F1（issue #171，SA4 §4.1）：真实 TCP + 真实 timer 下 GOAWAY drain 窗口 removeTarget——deadline 关 socket 触发本地 onClose 后资源收口恰一次 > RT-F1：live → GOAWAY(RESTARTING) → 窗口内 removeTarget → deadline close(1001) 本地 onClose → lease-released 恰一次 + watchdog 零空转 + 字段清空  1870ms
   ✓ SA7 RT-F1（issue #171，SA4 §4.1）：真实 TCP + 真实 timer 下 GOAWAY drain 窗口 removeTarget——deadline 关 socket 触发本地 onClose 后资源收口恰一次 > RT-G5：GOAWAY 收帧同步静默——drain 窗口内 peer 业务写零 UPDATE 出站；deadline 才关 transport；deadline 全量层处置 lease 恰一次  1578ms
 ✓ packages/namespace-runtime/test/runtime-registry-internal-seam-rev1.test.ts (20 tests) 6026ms
   ✓ RAC1 真实全仓门禁：审计 helper 对仓库生产代码树的既有门禁保持绿 > 防空扫（真实侧）：仓库有生产代码文件被审计（helper 默认 roots = packages/domains/apps）  2907ms
   ✓ RAC1 真实全仓门禁：审计 helper 对仓库生产代码树的既有门禁保持绿 > 真实全仓：internal subpath 的生产代码消费方 ⊆ 白名单（violators 为空）  1593ms
   ✓ RAC1 真实全仓门禁：审计 helper 对仓库生产代码树的既有门禁保持绿 > REPO_ROOT relPath 活链路（issue #110 SA2 B3）：真实 registry.ts 生产 import 必须被收集  1465ms
 ✓ packages/dsh-persistence/test/dsh-file-probe-determinism.test.ts (2 tests) 3649ms
   ✓ SA7 补充回归锚：file 通道探针确定性（AC8 + 设计 §5 钉死时间线） > CLI 连跑 2 次（各自独立 rootDir）：均以 0 退出、尾行精确 events=28，且 stdout 逐字节一致  3376ms
 ✓ packages/vfsl-codegen/test/generate-protocol-import.test.ts (5 tests) 2690ms
   ✓ AC-1 — 生成物原样（孤立 program）tsc --noEmit 可编译（编译级锚） > 具名别名域生成物孤立编译零诊断（N1：TS2304/TS2664 治愈锚）  1747ms
   ✓ AC-1 — 生成物原样（孤立 program）tsc --noEmit 可编译（编译级锚） > 零别名域生成物 + 协议消费方同 program 编译零诊断（N2：script 遮蔽治愈锚——消费方不被毒化）  922ms
 ✓ apps/yjs-server/test/issue164-sa7-dynamic.test.ts (7 tests) 3002ms
   ✓ issue #164 SA7 动态验证：SA4 §5 动态审核重点 > DV2（A1）：无 alert + 缺面 transportFactory → uncaughtException 捕获 TypeError(含 bufferedAmount)，unhandledRejection 零触达，零 HELLO_ACK + 1011 收口  1864ms
   ✓ issue #164 SA7 动态验证：SA4 §5 动态审核重点 > DV3（A2）：永不 resolve 的 verifier → helloTimeoutMs + slack 内 503 Auth Timeout（pre-auth 封顶），服务存活  321ms
   ✓ issue #164 SA7 动态验证：SA4 §5 动态审核重点 > DV6a（FS6 深水·被动 deadline）：活跃 channel 下 close() → GOAWAY(SERVER_SHUTTING_DOWN, drain=closeTimeoutMs) → drain 窗末 1001 收口 → close() 结算 + Registry stopped + 端口拒绝  444ms
stdout | packages/namespace-registry/test/registry-sa7-phase5-dynamic.test.ts > SA7 动态验证 #131 — plugin 生产随机链路 / File 持久化 / CSPRNG 抽样 / 真实调度锚 A > D1 真实 cordis host 下 plugin 桥接的生产随机链路：create 产物 namespaceId 锚 ^ns-[0-9a-f]{32}$、两次互异、lease 可读
[SA7-DYN] D1 plugin 链生成 ID: ns-66d899d808c6b36f43d7b4f0f161b5ab / ns-6ad07c5dab7a7952ff9b5d8735bff5dc

stdout | packages/namespace-registry/test/registry-sa7-phase5-dynamic.test.ts > SA7 动态验证 #131 — plugin 生产随机链路 / File 持久化 / CSPRNG 抽样 / 真实调度锚 A > D2 真实 File Persistence round-trip：生成 ID 按 owner 分区落盘（35 字符文件名）→ 全拆 → 新 host 同 rootDir 恢复；跨 owner NOT_FOUND
[SA7-DYN] D2 落盘文件: ns-07d0e3227fcf8ce96738c26f9ccd616f.snapshot, ns-f3afbdf523926638533777e7dfaf7d9b.snapshot（rootDir=/tmp/nomicore-sa7-131-ke0WzA）

stdout | packages/namespace-registry/test/registry-sa7-phase5-dynamic.test.ts > SA7 动态验证 #131 — plugin 生产随机链路 / File 持久化 / CSPRNG 抽样 / 真实调度锚 A > D3 生产 CSPRNG 抽样：plugin host 100 次 create 全唯一 + 桥接形状 60,000 抽样零重复/16 字节/分布 ±6σ
[SA7-DYN] D3 (a) plugin host 100 create → 100 唯一；(b) 60000 抽样 → 0 重复，字节频率界 [3383, 4117]（期望 3750）

stdout | packages/namespace-registry/test/registry-sa7-phase5-dynamic.test.ts > SA7 动态验证 #131 — plugin 生产随机链路 / File 持久化 / CSPRNG 抽样 / 真实调度锚 A > D4 锚 A 真实调度复跑：事件驱动 6 次（shutdown 构造性落在重试 write 在途窗口）+ real-sleep 抖动 6 次；不变量逐次成立、零 unhandled
[SA7-DYN] D4 12 次真实调度迭代，shutdown 落点分布: {"in-write":7,"pre-write":5,"post-write":0}

 ✓ packages/namespace-registry/test/registry-sa7-phase5-dynamic.test.ts (4 tests) 2662ms
   ✓ SA7 动态验证 #131 — plugin 生产随机链路 / File 持久化 / CSPRNG 抽样 / 真实调度锚 A > D3 生产 CSPRNG 抽样：plugin host 100 次 create 全唯一 + 桥接形状 60,000 抽样零重复/16 字节/分布 ±6σ  2271ms
 ✓ packages/namespace-registry/test/registry-phase5-replication-red.test.ts (16 tests) 2595ms
   ✓ AC-6 close/fatal 竞态与 Memory persistence 恢复 > persistence-degraded：gate 通过后降级——enable 成功、后续 bump 被 RUNTIME_WRITE_DISABLED 拒绝零写入；恢复后 retry 覆盖、bump 成功；Memory 恢复可见  2354ms
 ✓ packages/ws-replication/test/ws-replication-sa7-175-dynamic.test.ts (6 tests) 2267ms
   ✓ issue #175 SA7：主动 reauth 生命周期动态验证（SA4 六项动态重点） > D1（SA4 重点 1）：真实 TCP——requestReauth 后 peer 原始 socket 先收 GOAWAY(REAUTH_REQUIRED, drain>0) 再 socket-close；hub close=(1001,"hub-reauth")；全 wire 字节零 token；收口后 blocked 保持零重拨  2187ms
 ✓ packages/vfsl/test/parse-vfsl-sa7-supplementary.test.ts (8 tests) 4644ms
   ✓ SA7 补充 — 资源界 / 必终止 / 声明序不变性（设计 §11 SA7 动态验证位） > T-l：20k 裸引用链 + Record 键 → ok:true（栈安全回归，无 RangeError、无挂起）  1209ms
   ✓ SA7 补充 — fuzz 烟雾（SA4 动态审核重点 #3：不抛异常 / 二态 union / 兜底通道不可达） > 记号汤：3000 组种子随机输入全部落契约内  1299ms
   ✓ SA7 补充 — fuzz 烟雾（SA4 动态审核重点 #3：不抛异常 / 二态 union / 兜底通道不可达） > fixture 变异/截断：3000 组 + 全前缀截断全部落契约内  2069ms
 ✓ packages/ws-replication/test/ws-replication-sa7-r2-transport.test.ts (2 tests) 2594ms
   ✓ issue #137 R2 SA7：真实 transport control 额度边界抽样（真实 TCP + 真实 bufferedAmount） > A（存活侧）：真实暂停段 + 缺省 8MiB 额度内 control 流量（4 ns × 32 ACK = 128 ≈ 7.3KiB）——全部上 wire、零 ERROR、连接 ready  662ms
   ✓ issue #137 R2 SA7：真实 transport control 额度边界抽样（真实 TCP + 真实 bufferedAmount） > B（耗尽侧）：真实暂停段 + 跨越显式 64KiB 对照额度的 control 流量（40 ns × 32 ACK = 1280 ≈ 73KiB）——恰 1 ERROR(CONNECTION_BACKPRESSURE) + close(1011) + peer backoff  1930ms
 ✓ packages/ws-replication/test/ws-replication-sa7-issue169-dynamic.test.ts (2 tests) 2390ms
   ✓ issue #169 SA7-D2（SA4 动态重点 2）：Δ≡0 write-through-0 悬崖——真实 TCP 长寿命连接饱和签名 > D2：帧间 settle 节奏下累计 data 超过 cap → data 准入恒拒（RESYNC_REQUIRED 恢复环）/ UPDATE 字节平 / 零 1011、零 close（无终局信号）  2374ms
 ✓ packages/ws-replication/test/ws-replication-sa7-issue170-real-transport.test.ts (2 tests) 1589ms
   ✓ SA7 issue #170 真实 transport：pong 超时收口 → backoff 重拨 → hub 只留新连接 → 数据收敛（真实 TCP + 真实 timer） > 真实链路：死对端 pong 超时 close(1001) → 重拨后 hub.connections===1、旧传输零僵尸 ping/零 ws 抛错、新代健康、写值收敛  1000ms
   ✓ SA7 issue #170 真实 transport：pong 超时收口 → backoff 重拨 → hub 只留新连接 → 数据收敛（真实 TCP + 真实 timer） > A4 故障注入：适配器 ping() 首调抛错（socket 仍开放）→ liveness catch 吸收 → close(1001,pong-timeout) + backoff → 重连健康收敛（零未捕获异常）  586ms
 ✓ packages/vfsl-codegen/test/generate-alias-collision-guard.test.ts (4 tests) 1526ms
   ✓ AC-3 — CLI 端到端：碰撞域响亮失败（exit 2 + 结构化 stderr，非 exit 0 静默产出） > pnpm generate 对碰撞域 → exit 2，stderr 含独立错误码与碰撞别名  1444ms
 ✓ packages/namespace-registry/test/registry-issue-226-red.test.ts (13 tests) 1415ms
   ✓ #226 日志 I/O 与业务关键路径隔离（SA1 复现红灯） > T12 慢同步 append 不得阻塞 create 之后的下一个业务写槽（B3：write-sequencer 窗口隔离——经 Registry 生产装配全链路）  314ms
 ✓ packages/vfsl-codegen/test/generate-error-message-tail.test.ts (4 tests) 1211ms
   ✓ AC-4 — CLI 端到端：错误消息尾串经结构化 stderr 可见（exit 2） > 异形 ROOT 域经 pnpm generate → exit 2 且 stderr 消息尾串 = 见 #44  1190ms
 ✓ apps/yjs-server/test/lifecycle-watchdog-red.test.ts (1 test) 1349ms
   ✓ B2: total-timeout watchdog vs configured dirty-flush drain window (SA4 §R-B2) > boot rejects maxDirtyMs above the stop-watchdog budget loudly (config-error + exit 1, never a watchdog-killed flush)  1348ms
 ✓ packages/namespace-diagnostic-log/test/file-adapter-reopen-roll-repair.test.ts (52 tests) 1127ms
 ✓ packages/namespace-runtime/test/runtime-mutate-root-sa7-dynamic.test.ts (4 tests) 986ms
   ✓ SA7 动态验证 — SA4 重点 1：notifier 挂住双窗口 > DV-1a S6 成功路径挂住：槽停滞、后续写永排队（非 disabled 结算）、read 照常、无 fatal 降级  465ms
   ✓ SA7 动态验证 — SA4 重点 1：notifier 挂住双窗口 > DV-1b fatal committed:true 路径挂住：status.fatal 先于（永不送达的）rejection 可观测、pA 永 pending、提交值保留、新调用因队列停滞不结算  450ms
 ✓ packages/namespace-diagnostic-log/test/file-adapter-strict-reader.test.ts (70 tests) 973ms
 ✓ packages/namespace-diagnostic-log/test/issues-projection.test.ts (23 tests) 902ms
 ✓ packages/namespace-diagnostic-log/test/file-adapter-inline-sidecar.test.ts (9 tests) 767ms
   ✓ AC2 验收门槛 1：小 update 内联 round-trip（VFSL + Base64 + length + CRC） > 恰 4096B（默认阈值）→ inline：payloadLength/crc32c/标准 Base64 逐字段 + 全量校验  398ms
 ✓ packages/namespace-registry/test/registry-create-diagnostic-red.test.ts (16 tests) 476ms
 ✓ packages/namespace-runtime/test/runtime-root-schema-diagnostic-sa7.test.ts (16 tests) 683ms
 ✓ packages/replication-protocol/test/codec-fuzz-property.test.ts (5 tests) 414ms
 ✓ packages/namespace-diagnostic-log/test/file-adapter-retention.test.ts (17 tests) 652ms
 ✓ packages/namespace-diagnostic-log/test/file-adapter-r2-supplemental.test.ts (22 tests) 426ms
 ✓ packages/ws-replication/test/ws-replication-sa6-hardening-g3-g4-red.test.ts (16 tests) 699ms
 ✓ apps/yjs-server/test/ordered-shutdown-red.test.ts (2 tests) 708ms
   ✓ T5 ordered shutdown (design §3.6 / AC4) > createNomicoreApp + stop() emits ordered teardown events and is idempotent  646ms
 ✓ packages/namespace-runtime/test/runtime-replication-session.test.ts (30 tests) 224ms
 ✓ packages/ws-replication/test/ws-replication-observer-red.test.ts (29 tests) 656ms
 ✓ packages/namespace-runtime/test/runtime-acceptance-degraded-two-adapter.test.ts (4 tests) 424ms
 ✓ packages/namespace-registry/test/registry-sa7-phase5-bootstrap-reset-dynamic.test.ts (10 tests) 603ms
 ✓ packages/namespace-runtime/test/runtime-replication-diagnostic-red.test.ts (15 tests) 634ms
 ✓ packages/ws-replication/test/ws-replication-ac7-faults.test.ts (12 tests) 286ms
 ✓ packages/ws-replication/test/ws-replication-issue172-contract-anchors.test.ts (16 tests) 498ms
 ✓ apps/yjs-server/test/app-config-red.test.ts (23 tests) 690ms
   ✓ T1 strict app config contract (design §3.2 / AC1) > rejects config without a static role (mandatory, no default)  664ms
 ✓ packages/namespace-diagnostic-log/test/input-capture.test.ts (26 tests) 542ms
stdout | packages/namespace-registry/test/registry-create-diagnostic-sa7-dynamic.test.ts > SA7 动态重点 2 — File adapter first-slice 同步落盘与同 key FIFO > first-slice 同步证据：initStream 返回前 stream/manifest/genesis 已可严格读回；每 namespace 至多一次（duplicate 不再付 stream 成本）
[SA7-DV] first-slice initStream（同步 mkdir+manifest('wx')+genesis append+current.json rename）耗时 111.04ms；含日志 create 总耗时 158.63ms

 ✓ packages/namespace-registry/test/registry-create-diagnostic-sa7-dynamic.test.ts (10 tests) 529ms
 ✓ packages/namespace-diagnostic-log/test/file-adapter-sa7-dynamic.test.ts (10 tests) 488ms
 ✓ packages/namespace-runtime/test/runtime-acceptance-fullchain.test.ts (8 tests) 626ms
 ✓ packages/ws-replication/test/ws-replication-issue137-r2-red.test.ts (9 tests) 1037ms
 ✓ packages/persistence/test/persistence-phase5-archive-red.test.ts (23 tests) 171ms
 ✓ packages/namespace-runtime/test/runtime-root-schema-diagnostic-red.test.ts (14 tests) 419ms
 ✓ packages/namespace-diagnostic-log/test/record-vocabulary.test.ts (29 tests) 422ms
 ✓ packages/ws-replication/test/ws-replication-review-revisions-r1-r7-red.test.ts (14 tests) 419ms
 ✓ packages/namespace-runtime/test/runtime-replication-sa7-dynamic.test.ts (4 tests) 450ms
 ✓ packages/namespace-diagnostic-log/test/file-adapter-read-session.test.ts (9 tests) 411ms
 ✓ packages/ws-replication/test/ws-replication-auth-lifecycle-red.test.ts (16 tests) 452ms
 ✓ packages/ws-replication/test/ws-replication-sa7-issue137-dynamic.test.ts (8 tests) 374ms
 ✓ packages/namespace-diagnostic-log/test/file-adapter-genesis-results.test.ts (9 tests) 429ms
 ✓ packages/namespace-runtime/test/runtime-replication-session-round2-red.test.ts (17 tests) 389ms
 ✓ packages/namespace-diagnostic-log/test/file-adapter-mismatch-interference.test.ts (11 tests) 351ms
 ✓ packages/namespace-diagnostic-log/test/memory-adapter.test.ts (9 tests) 328ms
 ✓ packages/namespace-diagnostic-log/test/file-adapter-r2-policy-continuity.test.ts (13 tests) 372ms
 ✓ packages/namespace-diagnostic-log/test/schema-freeze.test.ts (13 tests) 464ms
 ✓ packages/ws-replication/test/ws-replication-periodic-reconcile.test.ts (5 tests) 202ms
 ✓ packages/ws-replication/test/ws-replication-r3-r4-regressions.test.ts (11 tests) 386ms
 ✓ packages/namespace-diagnostic-log/test/file-adapter-retention-deletion-windows.test.ts (5 tests) 334ms
 ✓ packages/namespace-diagnostic-log/test/file-adapter-namespace-deletion.test.ts (10 tests) 387ms
 ✓ packages/namespace-diagnostic-log/test/vfsl-gate.test.ts (16 tests) 320ms
 ✓ packages/namespace-diagnostic-log/test/emitter-isolation.test.ts (8 tests) 317ms
 ✓ packages/namespace-diagnostic-log/test/file-adapter-retention-history.test.ts (7 tests) 282ms
 ✓ packages/ws-replication/test/ws-replication-reauth-lifecycle-red.test.ts (7 tests) 563ms
 ✓ packages/ws-replication/test/ws-replication-sa7-dynamic.test.ts (6 tests) 669ms
 ✓ packages/namespace-diagnostic-log/test/file-adapter-sa7-repair-io.test.ts (4 tests) 361ms
 ✓ packages/namespace-diagnostic-log/test/update-carrier.test.ts (10 tests) 268ms
 ✓ packages/ws-replication/test/ws-replication-issue176-red.test.ts (9 tests) 280ms
 ✓ packages/namespace-diagnostic-log/test/file-adapter-layout.test.ts (17 tests) 272ms
 ✓ packages/ws-replication/test/ws-replication-sa7-hardening-dynamic.test.ts (8 tests) 265ms
 ✓ packages/ws-replication/test/ws-replication-ac6-resync-close.test.ts (7 tests) 254ms
 ✓ packages/doc-runtime/test/materialize-root-rev2.test.ts (23 tests) 249ms
 ✓ packages/namespace-registry/test/registry-create.test.ts (47 tests) 267ms
 ✓ packages/doc-runtime/test/replace-root-content.test.ts (13 tests) 86ms
 ✓ packages/ws-replication/test/ws-replication-ac5-live.test.ts (7 tests) 243ms
 ✓ packages/vfsl/test/validate-snapshot.test.ts (35 tests) 242ms
 ✓ packages/namespace-registry/test/registry-phase5-identity-red.test.ts (20 tests) 137ms
 ✓ packages/namespace-diagnostic-log/test/identity.test.ts (10 tests) 211ms
 ✓ packages/persistence/test/file-persistence.test.ts (21 tests) 250ms
 ✓ packages/ws-replication/test/ws-replication-issue137-ac1-ac7-red.test.ts (4 tests) 241ms
 ✓ packages/namespace-registry/test/registry-create-diagnostic-code-source.test.ts (6 tests) 226ms
 ✓ packages/namespace-runtime/test/runtime-replication-session-round2.test.ts (25 tests) 237ms
 ✓ packages/ws-replication/test/ws-replication-ac1-ac2-open.test.ts (12 tests) 233ms
 ✓ packages/dsh-persistence/test/dsh-profile-acceptance.test.ts (12 tests) 233ms
 ✓ packages/ws-replication/test/ws-replication-spec-b1-b2-red.test.ts (5 tests) 237ms
 ✓ packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts (6 tests) 233ms
 ✓ packages/namespace-runtime/test/runtime-registry-internal-seam.test.ts (5 tests) 233ms
 ✓ packages/namespace-runtime/test/runtime-acceptance-production-assembly.test.ts (2 tests) 241ms
 ✓ packages/ws-replication/test/ws-replication-issue174-goaway-drain-red.test.ts (7 tests) 579ms
 ✓ packages/ws-replication/test/ws-replication-issue171-red.test.ts (5 tests) 340ms
 ✓ packages/namespace-registry/test/registry-sa7-phase5-replication-dynamic.test.ts (4 tests) 170ms
 ✓ packages/namespace-registry/test/registry-phase5-bootstrap-reset-red.test.ts (19 tests) 231ms
 ✓ packages/vfsl/test/compile-schema-envelope.test.ts (28 tests) 91ms
 ✓ packages/namespace-runtime/test/runtime-replace-schema-persistence.test.ts (2 tests) 214ms
 ✓ apps/yjs-server/test/ws-replication-issue190-sa7-real-transport.test.ts (3 tests) 244ms
 ✓ apps/yjs-server/test/third-party-composition-red.test.ts (3 tests) 259ms
 ✓ packages/namespace-runtime/test/runtime-replication-sa4-probe.test.ts (2 tests) 174ms
 ✓ packages/replication-protocol/test/codec-roundtrip-truncation.test.ts (8 tests) 156ms
 ✓ packages/namespace-registry/test/registry-plugin.test.ts (9 tests) 190ms
 ✓ packages/namespace-runtime/test/runtime-replace-schema-sequencer.test.ts (13 tests) 191ms
 ✓ packages/persistence/test/memory-persistence.test.ts (41 tests) 186ms
 ✓ packages/namespace-diagnostic-log/test/observer-isolation.test.ts (5 tests) 163ms
 ✓ packages/namespace-diagnostic-log/test/line-budget.test.ts (6 tests) 187ms
 ✓ packages/doc-runtime/test/materialize-root.test.ts (59 tests) 183ms
 ✓ packages/namespace-runtime/test/runtime-registry-internal-sa7-dynamic.test.ts (4 tests) 240ms
 ✓ packages/vfsl/test/docscope-guards.test.ts (6 tests) 191ms
 ✓ apps/yjs-server/test/ws-server-upgrade-admission.test.ts (3 tests) 160ms
 ✓ packages/namespace-runtime/test/runtime-mutate-root-sequencer.test.ts (12 tests) 171ms
 ✓ packages/ws-replication/test/ws-replication-sa6-hardening-g1-g2-red.test.ts (5 tests) 163ms
 ✓ packages/namespace-runtime/test/runtime-mutate-root-persistence.test.ts (2 tests) 152ms
 ✓ packages/ws-replication/test/ws-replication-issue170-r1-r4-red.test.ts (7 tests) 164ms
 ✓ packages/persistence/test/persistence-sa7-phase5-bootstrap-dynamic.test.ts (14 tests) 189ms
 ✓ packages/ws-replication/test/ws-replication-sa7-issue174-dynamic.test.ts (3 tests) 140ms
 ✓ packages/ws-replication/test/ws-replication-ac4-reconcile.test.ts (5 tests) 168ms
 ✓ packages/ws-replication/test/ws-replication-sa4-f1-f2-f3-red.test.ts (3 tests) 160ms
 ✓ packages/namespace-registry/test/registry-phase5-replication-session-round2-red.test.ts (12 tests) 305ms
 ✓ apps/yjs-server/test/node-hub-peer-live.test.ts (1 test) 410ms
   ✓ public Node Hub/Peer adapters > carries the immediate Peer HELLO through a real WebSocket and reaches live  397ms
 ✓ packages/persistence/test/persistence-phase5-bootstrap-reset-r2.test.ts (11 tests) 109ms
 ✓ packages/doc-runtime/test/read-logical-value-at-path-guards.test.ts (39 tests) 177ms
 ✓ packages/namespace-registry/test/registry-sa7-concurrency.test.ts (4 tests) 152ms
 ✓ packages/namespace-registry/test/registry-sa7-rev1.test.ts (6 tests) 149ms
 ✓ packages/ws-replication/test/ws-replication-plugin.test.ts (15 tests) 134ms
 ✓ packages/namespace-registry/test/registry-sa7-cordis.test.ts (4 tests) 146ms
 ✓ packages/doc-runtime/test/extract-yjs-snapshot.test.ts (21 tests) 67ms
 ✓ packages/vfsl/test/vfsl-assets-fullchain-e2e.test.ts (16 tests) 109ms
 ✓ packages/ws-replication/test/ws-replication-sa7-issue171-dynamic.test.ts (3 tests) 134ms
 ✓ packages/ws-replication/test/ws-replication-issue168-hello-timeout-close-peer-red.test.ts (3 tests) 138ms
 ✓ packages/namespace-runtime/test/runtime-boundary-supplementary.test.ts (3 tests) 133ms
 ✓ packages/vfsl/test/parse-vfsl-root-convention.test.ts (36 tests) 47ms
 ✓ packages/ws-replication/test/ws-replication-ac3-bootstrap.test.ts (4 tests) 128ms
 ✓ packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-internal.test.ts (16 tests) 110ms
 ✓ packages/ws-replication/test/ws-replication-sa7-issue168-dynamic.test.ts (3 tests) 111ms
 ✓ packages/namespace-registry/test/registry-idle.test.ts (18 tests) 108ms
 ✓ packages/namespace-runtime/test/runtime-close-sa7-dynamic.test.ts (4 tests) 111ms
 ✓ packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-red.test.ts (10 tests) 108ms
 ✓ packages/ws-replication/test/ws-replication-issue169-backpressure-accounting-red.test.ts (19 tests) 109ms
 ✓ packages/doc-runtime/test/sa7-fatal-dynamic-verify.test.ts (8 tests) 47ms
 ✓ packages/vfsl/test/schemasource-seam.test.ts (13 tests) 82ms
 ✓ packages/doc-runtime/test/read-logical-value-at-path-schema-independent.test.ts (33 tests) 95ms
 ✓ packages/ws-replication/test/ws-replication-sa7-r2-supplement.test.ts (1 test) 92ms
 ✓ packages/persistence/test/persistence-phase5-import-red.test.ts (14 tests) 93ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts (37 tests) 113ms
 ✓ packages/ws-replication/test/ws-replication-sa7-issue170-minor3-observation.test.ts (1 test) 104ms
 ✓ domains/vfs3-assets/test/vfs3-assets-tsdoc.test.ts (6 tests) 117ms
 ✓ packages/vfsl/test/validate-patch.test.ts (36 tests) 289ms
 ✓ packages/ws-replication/test/ws-replication-issue171-blockers.test.ts (1 test) 110ms
 ✓ packages/namespace-runtime/test/runtime-replication-write.test.ts (14 tests) 89ms
 ✓ packages/namespace-registry/test/registry-open.test.ts (32 tests) 107ms
 ✓ packages/vfsl/test/evaluate-derived-docs-typecls.test.ts (8 tests) 45ms
 ✓ packages/vfsl/test/parse-vfsl-forbidden-matrix.test.ts (79 tests) 90ms
 ✓ packages/ws-replication/test/ws-replication-sa4-issue171-review-red.test.ts (1 test) 75ms
 ✓ packages/namespace-runtime/test/runtime-p0-sequencer.test.ts (7 tests) 111ms
 ✓ packages/namespace-registry/test/registry-persistence-contract.test.ts (2 tests) 89ms
 ✓ packages/namespace-runtime/test/runtime-close-lifecycle.test.ts (10 tests) 94ms
 ✓ packages/doc-runtime/test/xml-attr-quote-domain.test.ts (26 tests) 87ms
 ✓ packages/ws-replication/test/ws-replication-sa4-r4-1-red.test.ts (1 test) 92ms
 ✓ packages/namespace-registry/test/registry-phase5-replication-channels.test.ts (14 tests) 79ms
 ✓ packages/persistence/test/file-persistence-sa7-dynamic.test.ts (4 tests) 80ms
 ✓ packages/doc-runtime/test/apply-validated-mutation-operations.test.ts (14 tests) 78ms
 ✓ packages/namespace-runtime/test/runtime-sync-read-face.test.ts (4 tests) 72ms
 ✓ apps/yjs-server/test/issue164-transport-faces-red.test.ts (3 tests) 70ms
 ✓ packages/namespace-runtime/test/runtime-mutate-root-snapshotter-array.test.ts (5 tests) 68ms
 ✓ packages/vfsl/test/parse-vfsl-containers-markers.test.ts (33 tests) 64ms
 ✓ packages/vfsl/test/evaluate-derived-docs-audit.test.ts (15 tests) 59ms
 ✓ packages/doc-runtime/test/transaction-fatal-materialize-contract.test.ts (16 tests) 49ms
 ✓ apps/yjs-server/test/ws-transport-liveness.test.ts (3 tests) 57ms
 ✓ packages/doc-runtime/test/xml-attr-quote-domain-sa7.test.ts (11 tests) 67ms
 ✓ packages/vfsl-codegen/test/generate-mapping-table.test.ts (13 tests) 57ms
 ✓ packages/doc-runtime/test/create-initial-document.test.ts (9 tests) 58ms
 ✓ packages/namespace-runtime/test/runtime-public-surface-ownership.test.ts (6 tests) 53ms
 ✓ packages/vfsl/test/docscope-getcompiled.test.ts (14 tests) 63ms
 ✓ packages/vfsl/test/domains-scaffold.test.ts (2 tests) 91ms
 ✓ packages/vfsl/test/parse-vfsl-cycle-detection.test.ts (16 tests) 56ms
 ✓ packages/namespace-runtime/test/metadata-proto-key.test.ts (6 tests) 56ms
 ✓ packages/namespace-registry/test/registry-sa7-hostile.test.ts (6 tests) 116ms
 ✓ packages/replication-protocol/test/codec-version-interop.test.ts (25 tests) 99ms
 ✓ packages/doc-runtime/test/extract-nonfinite-number.test.ts (8 tests) 94ms
 ✓ packages/namespace-runtime/test/runtime-phase5-reset-fence-r2.test.ts (7 tests) 92ms
 ✓ packages/doc-runtime/test/extract-plain-domain.test.ts (9 tests) 61ms
 ✓ packages/vfsl/test/parse-schema-envelope.test.ts (13 tests) 50ms
 ✓ packages/instance/test/instance.test.ts (9 tests) 55ms
 ✓ packages/namespace-registry/test/registry-shutdown.test.ts (12 tests) 42ms
 ✓ packages/namespace-runtime/test/runtime-schema-carrier-split.test.ts (4 tests) 45ms
 ✓ packages/vfsl/test/docscope-sha256.test.ts (13 tests) 35ms
 ✓ packages/replication-protocol/test/codec-malformed.test.ts (37 tests) 33ms
 ✓ packages/namespace-runtime/test/runtime-write-fatal-message-rev1.test.ts (3 tests) 46ms
 ✓ packages/persistence/test/issue-79-entry-status.test.ts (6 tests) 37ms
 ✓ packages/vfsl/test/parse-vfsl.test.ts (11 tests) 37ms
 ✓ packages/doc-runtime/test/extract-union-trial.test.ts (8 tests) 48ms
 ✓ packages/replication-protocol/test/codec-registries.test.ts (13 tests) 43ms
 ✓ packages/persistence/test/issue-79-file-entry-status.test.ts (2 tests) 43ms
 ✓ packages/vfsl-codegen/test/generate-discriminated-emission.test.ts (10 tests) 39ms
 ✓ packages/vfsl/test/compile-schema-envelope-sentinel.test.ts (7 tests) 33ms
 ✓ packages/vfsl/test/parse-vfsl-errors.test.ts (19 tests) 35ms
 ✓ packages/replication-protocol/test/codec-messages-golden.test.ts (26 tests) 33ms
 ✓ packages/persistence/test/persistence-encode-fatal.test.ts (1 test) 30ms
 ✓ packages/namespace-registry/test/registry-entry-removal-guard.test.ts (7 tests) 17ms
 ✓ packages/doc-runtime/test/apply-validated-mutation-fatal-contract.test.ts (4 tests) 30ms
 ✓ packages/clock/test/clock-contract.test.ts (17 tests) 38ms
 ✓ packages/persistence/test/sa7-supplementary.test.ts (3 tests) 27ms
 ✓ packages/doc-runtime/test/public-surface-guard.test.ts (3 tests) 9ms
 ✓ packages/clock/test/clock-plugin-lifecycle.test.ts (5 tests) 28ms
 ✓ packages/doc-runtime/test/apply-validated-mutation-nested-path-repro.test.ts (2 tests) 25ms
 ✓ packages/clock/test/clock-surface.test.ts (5 tests) 19ms
 ✓ packages/persistence/test/core-dsh-boundary.test.ts (6 tests) 31ms
 ✓ packages/vfsl/test/parse-vfsl-jsdoc.test.ts (7 tests) 25ms
 ✓ packages/ws-replication/test/ws-replication-sa7-issue190-dynamic.test.ts (5 tests) 24ms
 ✓ packages/ws-replication/test/ws-replication-issue190-guard.test.ts (1 test) 22ms
 ✓ packages/doc-runtime/test/extract-record-keyspace.test.ts (2 tests) 23ms
 ✓ packages/vfsl/test/parse-vfsl-r3-regression.test.ts (7 tests) 22ms
 ✓ packages/namespace-registry/test/registry-node-dispose.test.ts (2 tests) 33ms
 ✓ packages/replication-protocol/test/codec-package-contract.test.ts (5 tests) 33ms
 ✓ packages/replication-protocol/test/codec-envelope.test.ts (13 tests) 18ms
 ✓ packages/persistence/test/persistence-contract.test.ts (6 tests) 21ms
 ✓ packages/ws-replication/test/ws-replication-issue190-red.test.ts (4 tests) 21ms
 ✓ packages/persistence/test/module-graph-regression.test.ts (4 tests) 17ms
 ✓ packages/namespace-runtime/test/runtime-acceptance-exports-audit.test.ts (4 tests) 7ms
 ✓ packages/vfsl-protocol/test/vfsl-protocol-empty-module.test.ts (1 test) 4ms
⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯

Vitest caught 2 unhandled errors during the test run.
This might cause false positive tests. Resolve unhandled errors to make sure your tests are not affected.

⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯
Error: [vitest-worker]: Timeout calling "onTaskUpdate"
 ❯ Object.onTimeoutError node_modules/.pnpm/vitest@3.2.7_@types+node@20.19.43_tsx@4.23.12/node_modules/vitest/dist/chunks/rpc.-pEldfrD.js:53:10
 ❯ Timeout._onTimeout node_modules/.pnpm/vitest@3.2.7_@types+node@20.19.43_tsx@4.23.12/node_modules/vitest/dist/chunks/index.B521nVV-.js:59:62
 ❯ listOnTimeout node:internal/timers:605:17
 ❯ processTimers node:internal/timers:541:7


⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯
Error: [vitest-worker]: Timeout calling "onTaskUpdate"
 ❯ Object.onTimeoutError node_modules/.pnpm/vitest@3.2.7_@types+node@20.19.43_tsx@4.23.12/node_modules/vitest/dist/chunks/rpc.-pEldfrD.js:53:10
 ❯ Timeout._onTimeout node_modules/.pnpm/vitest@3.2.7_@types+node@20.19.43_tsx@4.23.12/node_modules/vitest/dist/chunks/index.B521nVV-.js:59:62
 ❯ listOnTimeout node:internal/timers:605:17
 ❯ processTimers node:internal/timers:541:7

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯


 Test Files  260 passed (260)
      Tests  2869 passed (2869)
Type Errors  no errors
     Errors  2 errors
   Start at  13:10:29
   Duration  881.40s (transform 13.86s, setup 0ms, collect 92.67s, tests 656.70s, environment 195ms, prepare 38.16s, typecheck 13.41s)

 ELIFECYCLE  Test failed. See above for more details.
```
