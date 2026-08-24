# AC 逐条确认门禁 — namespace-runtime：单 write sequencer 与 validated ROOT write（issue #90）

核对日期：2026-08-24。证据基线：全量 `pnpm test` 79 文件 1050 用例全绿 exit 0（.mabf-bg/verify-r2.log 为 SA3 后 1046 绿，SA7 补 4 用例后 1050 绿——SA7 报告末节）；`pnpm typecheck` 七包 exit 0（.mabf-bg/tsc.log）；`tsc -p tsconfig.typecheck.json --noEmit` exit 0（SA4 复核）。

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC1 | mutateRoot 调用时同步决定 FIFO 顺序，单项失败不毒死后续队列 | ✅ | runtime-mutate-root-sequencer.test.ts:314「AC1+AC6+AC8 严格 FIFO」（notifier 屏障 + 完成次序 ['A','B']）、:365「AC1 单项失败不毒死」（同步注册探针实证失败写 0 更新事件，后续写照常成功） | — |
| AC2 | 任务取得槽后先检查 lifecycle/fatal 与 DocHandle writable gate；不可写时不访问输入且零写入 | ✅ | sequencer.test.ts:423（fatal 后 FIFO 取得槽、Proxy 观测输入零访问、零写入、RUNTIME_WRITE_DISABLED）、:468（degraded 同组断言）；SA4 探针 released/getStatus-throw 边界全按契约结算 | — |
| AC3 | 输入在槽开始时复制为递归冻结的 plain-data snapshot，后续阶段不再读取调用方对象 | ✅ | sequencer.test.ts:553（排队期间输入改动、槽起点快照获胜）、:577（非 plain 六类拒绝）；snapshotter-array.test.ts 5 用例（symbol 键/非枚举键/accessor 下标 getter 零执行/path 数组同纪律/正例零误伤含调用方后改不影响已提交快照） | — |
| AC4 | ROOT write 使用执行时 active schema；preparing/schema-unavailable 时按已冻结能力语义结算 | ✅ | sequencer.test.ts:619（preparing 期接纳、P0 结算后按已安装 schema 成功提交）、:644（unavailable 零写入失败 + 读取保留） | — |
| AC5 | 调用 applyValidatedMutation 前后无额外 Y.Doc 写旁路，普通失败保持零写入结果联合 | ✅ | sequencer.test.ts:276（成功恰 1 次 update 事件 + 恰 1 次 notifier）、:365/:577/:644 各 ok:false 用例均断言 0 更新事件 + state 字节不变；SA4 §读写路径对账（S5 唯一写入口） | — |
| AC6 | transaction 成功后在同一槽内 await 窄 dirty notifier，resolve 后下一项才执行 | ✅ | sequencer.test.ts:314（gateA 挂住期间 pB 不执行、read 只见 A；resolve 后 B 才取得槽）；SA7 DV-1a（挂住窗口停滞语义锁定） | — |
| AC7 | persistence-degraded 阻止 ROOT write 但不阻止 read/P0；检查后降级的写仍登记最新 dirty 状态 | ✅ | sequencer.test.ts:468（degraded 拦截 + P0 照常 ready + read 保留）、:515（检查后降级照样提交登记）；persistence.test.ts:134（degraded 全链：retry 覆盖、全新实例看到该写） | — |
| AC8 | read 不进入 sequencer，只观察调用瞬间已提交状态；read-your-write 通过等待写 Promise 实现 | ✅ | sequencer.test.ts:314（B 已接纳未提交时 read 只见 A）、:276（await 写 Promise 后 read 到提交值） | — |
| AC9 | ROOT mutation 使用独立窄结果联合，fatal 走 Promise rejection | ✅ | sequencer.test.ts:682（committed:true → reject RuntimeWriteFatalError + best-effort notifier 恰一次 + 不虚假回滚 + FIFO 继续 + 写永久关闭读取保留）、:743（committed:false → reject + notifier 不调用 + 零写入）；RootMutationIssue/MutateRootResult 独立窄类型（设计 D9） | — |
| AC10 | 确定性并发测试与真实 Persistence 集成测试通过，并通过全量 typecheck/test、Node 20/24 CI | ✅（本地面） | persistence.test.ts:102/:134 真实 MemoryPersistence 跨实例集成 2 用例绿；SA7 补 4 动态用例绿；全量 79 文件 1050 用例 + 双 typecheck 通道 exit 0；本地 Node v24.13.0 腿绿。Node 20/24 CI 矩阵腿属发布后 runner 跟踪面（总控边界：不 push 不建 PR 不裁决 CI） | 本地全绿即完成事务；CI 触发证据由 runner push 后补核（SA7 报告已注明） |

结论：AC 10/10 全 ✅（AC10 的 CI 矩阵腿按职责边界归 runner），无修订轮，进入 Phase 4 收尾。
