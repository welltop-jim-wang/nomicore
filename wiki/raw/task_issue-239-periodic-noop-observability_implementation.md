# 实现证据 — issue #239: periodic reconciliation 的 no-op 与有效同步可观测性（SA3 落地）

> 阶段：implementation（SA3）。裁决文档：`wiki/raw/task_issue-239-periodic-noop-observability_design.md`（SA1，approved）
> + `..._sa2_review.md`（SA2 attack review，`approve`）。冻结契约：
> `packages/ws-replication/test/ws-replication-issue239-ac-red.test.ts`（不改一字转绿）。
> Issue comments 于本阶段派发前完整读取：0 条评论，无额外 Owner 要求。

## 1. 改动清单（与设计 §4/§5/§6 逐条对应）

| 条目 | 文件 | 内容 |
|---|---|---|
| P1 | `packages/ws-replication/src/types.ts` | `sync-step2-sent` 追加必在字段 `syncRoundId: number`、`encodedUpdateBytes: number`；`sync-diff-applied` 追加 `syncRoundId`、`encodedUpdateBytes` + 效果字段组（`stateVectorChanged?`、`applyEffect?: 'changed'\|'noop'`、`stateVectorBeforeHash?`、`stateVectorAfterHash?`）。事件型数维持 20 |
| P2 | `packages/ws-replication/src/observer.ts` | 新增纯观测 helper：`safeStateVector`（捕获折叠，safeNow 同款）、`stateVectorBytesEqual`（长度+逐位）、`stateVectorSafeDigest`（双泳道 FNV-1a-32：basis 2166136261 / prime 16777619 / mod 2³²，恒 16 位小写 hex） |
| P3 | `packages/ws-replication/src/round-engine.ts` | `RoundHost.applyStep2` 接口增第三参 `syncRoundId`；`onStep2` 与 `applyStep2Safely` 纯参数化透传（onStep2 L140-149 既有校验后传帧内 roundId）。违例矩阵/结算/reset 零改动 |
| P4 | `packages/ws-replication/src/peer-namespace.ts` | ① sent 发射点追加 `syncRoundId`/`encodedUpdateBytes`；② `applyStep2` 签名增第三参；③ `applyRemoteUpdate` 增第四参 `syncRoundId?`，接纳段 t0 旁 before 捕获（`isStep2 && observerOn` 门控），结算续体 after 捕获 + 效果派生（单命运：`effect` 整组 spread/整组缺），`sync-diff-applied` 附着新字段；接线 lambda 同步加参。degraded 分支事件零新字段 |
| P5 | `packages/ws-replication/src/hub-namespace.ts` | P4 的镜像（无 degraded 分支） |
| P6 | `packages/ws-replication/src/testing.ts` | re-export `safeStateVector`/`stateVectorBytesEqual`/`stateVectorSafeDigest`（显式测试面，不进 index.ts） |
| P7 | `docs/protocols/instance-replication-v1.md` | §23.1 两行替换 + issue #239 语义注记（含 delete-set-only 边界一句——SA2 观察 2 建议）；§23.3 允许清单 append（`applyEffect`/`stateVectorChanged`/`syncRoundId`/`encodedUpdateBytes` + documented safe digest 注册即冻结）；§23.4 捕获纪律段；§23.6 label 白名单 `applyEffect`、禁默认 label `syncRoundId`/hash；§23.7 conformance 招募。§9/§16/§18/§21 一字不动 |
| T1 | `packages/ws-replication/test/ws-replication-api.test-d.ts` | 事件 union 20 型协锁 L246-247 两成员形状同步追加（`toEqualTypeOf` 精确锁定） |
| T2 | `packages/ws-replication/test/ws-replication-observer-red.test.ts` | ALLOWED_KEYS 白名单两行 append；数值守卫名单 += `syncRoundId`/`encodedUpdateBytes`；assertSafe 内全 sync 事件语义断言（`encodedUpdateBytes === bytes`、roundId/长度在场、效果组单命运四键同现同缺、组内一致性、hash `/^[0-9a-f]{16}$/` 文法）；新增 helpers 单元面 describe（digest 基准向量 hardcode 锁算法冻结：空输入 `811c9dc5811c9dc5`、`[0,0]` `117697cd117697cd`、递增 0..9 `2f8540720825a114`——独立于被测模块以 Python+Node 双实现交叉验证；throwing reader → undefined；字节比较三态） |
| T3 | `packages/ws-replication/test/ws-replication-issue239-repro.test.ts` | SA5 复现按 failure_analysis §3.3 预告翻转（见 §3 偏差说明）；T4 冻结件不改；T5 driver.ts 不改（SA5 seam 原样） |

## 2. 验证矩阵（worktree 根执行；`NODE_OPTIONS=--conditions=nomicore-source`）

| # | 命令 | 结果 |
|---|---|---|
| V1 | `pnpm exec vitest run packages/ws-replication/test/ws-replication-issue239-ac-red.test.ts --reporter=verbose` | **2 passed**（冻结契约不改一字转绿：no-op rounds=3 groups=4 periodicGroups=3；hub-drift delta={"hub":false,"peer":true} changedEvents=1；修复后 no-op changedEvents=0） |
| V2 | `pnpm exec vitest run packages/ws-replication/test/ws-replication-issue239-repro.test.ts --reporter=verbose` | **2 passed**（翻转后断言：7 轮 periodic 全 noop；漂移修复 round hub noop / peer changed；修复后 next round 回 noop 非粘滞） |
| V3 | `pnpm exec vitest run packages/ws-replication/test/ws-replication-observer-red.test.ts --reporter=verbose` | **32 passed**（T1-T13 + 新单元块；含 T8 三运行基线与 T9 深扫——新捕获 observer 门控只读，逐字节等价保持） |
| V4 | `periodic-reconcile` + `ac4-reconcile` + `ac5-live` + `issue231-send-failure` | **27 passed**（SA5 回归清单） |
| V5 | `pnpm exec vitest run packages/ws-replication/test/ws-replication-api.test-d.ts`（typecheck 模式） | **16 passed**，Type Errors: no errors |
| V6 | `pnpm exec tsc -p packages/ws-replication/tsconfig.json` | exit 0（含 test/**） |
| V7 | `pnpm typecheck`（根） | exit 0 |
| V8 | `pnpm test`（根，两次全量） | ws-replication 包全量 353 passed / 1 failed（见 §4）；根全量失败项全部为环境性（§4），非本改动回归 |
| V9 | V1+V2 各连续 10 次 | **10/10 + 10/10 = 20/20 绿，0 flake** |

## 3. 实现偏差说明（均不触及冻结契约/硬约束）

1. **repro T3 场景 1 (5) 的 noop 断言范围**：设计 §6 T3.1 字面写「全部事件含初始
   reconcile 段…全部 sync-diff-applied 报 noop」。实证（修复后字段首次可见）表明：
   boot 初始 reconcile round（绝对 round 1）把 import 期 peer 本地写收编为 **hub 侧
   changed**（26 B 真实收敛，hub before/after hash 分歧；连续多轮复现确定）。周期
   no-op 判定与冻结契约（`expectNoopApplied` 只约束 periodic 组）同口径——
   实现把 noop 语义断言落到 boot 后的 7 轮 periodic round（(4b) 逐轮 + (5) 末段
   复核），(5) 全事件面保留关联/长度/单命运/一致性断言（对 round 1 的 changed apply
   同样成立：组内一致性不变式逐事件成立）。该差异是「窗口语义 = 观测投影，非因果
   归因」（设计 §4.3 自声明 + SA2 注记 2）的实例，非设计缺陷；转绿判据（冻结件）
   不受影响。
2. **协议文档 §5.1 语义注记**：按 SA2 review 观察 2（非阻断）补一句 delete-set-only
   修复盲区边界声明——纯文档，不改任何字段/算法。
3. 其余与设计 §4/§5/§6 逐字一致（含 SA2 观察 1：两处接线 lambda 第三参均已同步，
   V6/V7 typecheck 兜底）。

## 4. 根全量 `pnpm test`（V8）环境性失败取证

两次根全量各出现 20-21 项失败，失败集每次不同且全部位于本改动零触及的路径：
- **真实 TCP/OS-timer 时序测试**（`ws-replication-sa7-issue171-real-transport.test.ts`
  RT-G5、`sa7-r1-transport-auth` D3-②）：**在 pristine HEAD（stash 全部 issue #239
  改动后）同样间歇失败**（RT-G5 两次基线：1 failed / 4 passed 与 4 passed），
  非本改动回归；
- **5s 测试超时**（`vfsl-codegen` generate-cli/semicolon-free CLI 子进程、
  `namespace-registry` phase5 degraded flush 周期、`dsh-persistence` dsh-probe-cli、
  worker `Timeout calling onTaskUpdate`）：本机单跑大多通过（dsh-probe-cli 单独 7/7；
  generate-cli 单独仅 2 项超时且为 5s 硬超时被本机 CLI 启动耗时击穿），属环境性能
  flake，与本改动无关（这些包/路径零触碰）。
- ws-replication 包全量（353 tests）：唯一失败即 RT-G5（同上 HEAD 基线复现）。

## 5. 约束合规复核

- **wire bytes 零变化**：零改动 `@nomicore/replication-protocol` codec/帧构造/发送；
  V4 状态机守护（roundId 单调、回 live）+ V1 守护断言全绿。
- **§9.4/§16 状态机零变化**：round-engine 改动 = 3 处参数透传（接口 + onStep2 +
  applyStep2Safely），违例矩阵/结算/reset 未动；peer/hub 改动全在 observer 门控
  分支与类型面。
- **append-only**：`bytes` 冻结；新增 `encodedUpdateBytes === bytes` 澄清、效果字段组
  单命运、§23.3 documented safe digest（注册即冻结，基准向量 hardcode 锁定）。
- **observer gating**：before 捕获门控 `isStep2 && observerOn`（UPDATE 热路径与
  无 observer 零新增读取——T8 三运行基线全等持续把守）；捕获 throw → `safeStateVector`
  折叠 → 效果组整组缺失，绝不伪造 `noop`；不进 Registry write sequencer 槽。
- **syncRoundId 单连接代际**：sent 侧取帧内 wire roundId；applied 侧经 `applyStep2`
  第三参显式透传（onStep2 校验后），事件 roundId 集 === wire Step1 roundId 集断言
  （V1/V2/V3）全绿；零新增跨连接/跨重启状态。
- 20 型事件数不变（types.ts / ALLOWED_KEYS / api 型断言三处互证，V3/V5 绿）。

## 6. 交付文件

- 生产：`packages/ws-replication/src/{types,observer,round-engine,peer-namespace,hub-namespace,testing}.ts`
- 测试：`packages/ws-replication/test/ws-replication-api.test-d.ts`、
  `ws-replication-observer-red.test.ts`、`ws-replication-issue239-repro.test.ts`（翻转）
- 协议文档：`docs/protocols/instance-replication-v1.md`（§23 append-only）
- 冻结件未动：`packages/ws-replication/test/ws-replication-issue239-ac-red.test.ts`
- 既有 seam 未动：`packages/ws-replication/test/driver.ts`（SA5 additive，未提交）
