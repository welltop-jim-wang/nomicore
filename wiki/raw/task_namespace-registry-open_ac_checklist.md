# Issue #110 — 12 条验收标准核对清单（SA7）

- **Worktree**: `/home/wangjian/nomicore-fix-issue-110`
- **核对基准**: `TASK.md:15-26`；亲自阅读 Registry 源码与测试、ADR-0009；参考 SA4/SA5 仅作为既有执行记录。
- **SA4 前置状态**: `task_namespace-registry-open_sa4_review.md:6` 为 `APPROVED-WITH-CHANGES` 且阻断数 0（非字面 `pass`，但该报告明确放行并要求 SA7 动态复核）。
- **本次动态命令（Node 24 当前环境）**:
  ```bash
  pnpm exec vitest run packages/namespace-registry/test/registry-open.test.ts \
    packages/namespace-registry/test/registry-surface.test.ts \
    packages/namespace-registry/test/registry-node-dispose.test.ts \
    packages/namespace-runtime/test/runtime-registry-internal-seam-rev1.test.ts \
    --typecheck --passWithNoTests=false
  ```
  **结果：exit 0；4 files / 62 tests passed；Type Errors: no errors。**

## 一行汇总

| AC | 结论 | 一行依据 |
|---|---|---|
| 1 | PASS | 新包、主入口 Registry/Lease 类型及 `open/create/getStatus/shutdown` 均已实现，open 主链有动态覆盖。 |
| 2 | PASS | 同 key 单 Runtime、不同 key 并行的 deferred 并发测试通过。 |
| 3 | PASS | 同 key 同步 FIFO、unknown rejection 后绿尾 retry，以及 observer reentrant open 均通过。 |
| 4 | PASS | P0 deferred 时 `open` 已成功且 read/status 可用的动态测试通过。 |
| 5 | PASS | missing、invalid、typed load 各走窄结果；unknown load/factory 走稳定 branded fatal，均有测试。 |
| 6 | PASS | 注入 fatal/unavailable/degraded Runtime status 后仍成功 open 并如实代理能力的测试通过。 |
| 7 | PASS | 成功 open 签发独立冻结 lease；主入口/声明图不泄露 Runtime、DocHandle、Y.Doc 的测试通过。 |
| 8 | PASS | lease 全能力代理、同步 release、同一 Promise、asyncDispose、released status 已由代码及动态用例核对。 |
| 9 | PASS | release 后 read/两写为 `NAMESPACE_LEASE_RELEASED`，三 getter 为公开 coded throw，唯 status 成功；逐方法用例通过。 |
| 10 | PARTIAL | carrier ABA 防护有可达动态证据；entry generation 删除守卫是未触发的 #111/#112 预留，当前 #110 无 close/create 调用方，不能声称已端到端验证旧异步 entry 不删新 entry。 |
| 11 | PASS | 公开 issue/fatal/released error 的文本为常量；负锁测试覆盖本票所有可达公开 issue/error 及 observer exact-cause seam。 |
| 12 | PARTIAL | 确定性并发与本地全量 typecheck/test 有 SA5 证据，当前定向 62 tests 也绿；Node 24 asyncDispose 实测，Node 20/24 CI 收集与通过为本地不可验，留 Host CI 观察。 |

## 逐条核对

### AC1 — 新增包、公开 Registry/Lease、完成 open 主链：PASS

- **实现证据**：`packages/namespace-registry/src/index.ts:9-22` 只公开工厂、两类公开错误与 Registry/Lease 白名单类型；`types.ts:152-176` 定义 Lease/Registry（含 `open/create/getStatus/shutdown`）；`registry.ts:242-297` 是 load → factory → entry → lease 的 open 主链；`registry.ts:309-319` 为两项扩展位占位。
- **测试证据**：`registry-open.test.ts:497-677` 动态执行 open 分支及扩展位；`registry-surface.test.ts:38-72` 检查 exports，均在本次 62 tests 中通过。

### AC2 — 同 key 最多一个 Runtime；不同 key 并行：PASS

- **实现证据**：`registry.ts:143-146` 以 key 的 entries/carriers 管理；`registry.ts:196-206` 每 key carrier 同步接纳；`registry.ts:247-250` active entry 复用并仅签发新 lease。
- **测试证据**：`registry-open.test.ts:304-326` 断言同 key 两并发 open 仅一 load/一 factory、两独立 lease；`:347-364` 用 gate 证明不同 key 已并行进入 load。两项本次通过。

### AC3 — 同 key 同步接纳顺序串行；单项失败不毒化 tail：PASS

- **实现证据**：`registry.ts:197-205` 用旧 `carrier.tail` 链接 operation 并立即把 tail 更新为 rejection-safe green tail；`:268-275` unknown load 以 fatal rejection 结束单 slot。
- **测试证据**：`registry-open.test.ts:328-345` 验证 FIFO；`:366-377` 验证 unknown rejection 后 retry 成功；`:1045-1142` 验证 typed/fatal observer 回调内同步同 key reentrant open 仍排队、不双 factory、不毒尾。本次通过。

### AC4 — open 不等待 P0/schema compile/ROOT verify：PASS

- **实现证据**：`registry.ts:260-296` 仅 await `loadDoc` 并同步调用 Runtime factory；没有 P0、schema 或 ROOT await/检查。
- **测试证据**：`registry-open.test.ts:733-769` 构造未 resolve 的 P0 gate，断言 open 已成功、`p0Resolved === false`、status 为 preparing 且 read 可用。本次通过。

### AC5 — missing/invalid/typed load 独立窄结果，unknown 为 stable fatal：PASS

- **实现证据**：`identity.ts:67-98` invalid 恒返回窄 issue；`registry.ts:260-277` null→NOT_FOUND、`DocLoadOperationalError`→LOAD_FAILED、unknown→`NamespaceRegistryFatalError`；`errors.ts:17-36` 提供 stable code/operation/phase/committed 与稳定 message。
- **测试证据**：`registry-open.test.ts:147-264` invalid；`:498-565` null/typed/unknown；`:567-643` factory fatal。均通过。

### AC6 — fatal、unavailable、persistence-degraded Runtime 仍可 open 且保真：PASS

- **实现证据**：factory 成功后 `registry.ts:294-296` 无 Runtime status 二次拒绝；`lease.ts:84-112` 对 read/status/writes 直接代理 active Runtime。
- **测试证据**：`registry-open.test.ts:680-730` 的 runtimeFactory 分别构造 `fatal`、`schema.state:'unavailable'`、root/schema write capability 不同的退化 status；断言 open 成功、fatal/status/read 真实透传。本次通过。说明：这些状态由受控 fake Runtime 注入，而不是通过真实 Runtime 内部故障链构造；它足以验证 Registry 不二次拒绝与代理链路。

### AC7 — 成功 open 独立 lease，不暴露 Runtime/DocHandle/Y.Doc/live Yjs：PASS

- **实现证据**：`registry.ts:209-213` 每次 `issueLease` 新建 controller；`lease.ts:56-118` closure 持有 entry/runtime、对外只给冻结 lease/owner；`index.ts:9-22` 无内部对象导出。
- **测试证据**：`registry-open.test.ts:304-326,787-818,914-925` 断言不同 lease、冻结 owner/lease、无 runtime/doc 字段；`registry-surface.test.ts:46-67,148-181` 对运行时 export keys 和实际 `.d.ts` 可达图审计无 `NamespaceRuntime`/`DocHandle`/`Y.Doc`/internal subpath。本次通过。

### AC8 — 除 close 外代理能力；同步幂等 release / same Promise / asyncDispose / released status：PASS

- **实现证据**：`lease.ts:66-79` 在首次 release 同步置 `released`、删 lease、缓存 `Promise.resolve()`；`:84-115` 代理 read/三 getter/status/两写，并以 `ASYNC_DISPOSE` 直接使用同一 `doRelease`；接口无 `close`（`types.ts:152-165`）。
- **测试证据**：`registry-open.test.ts:820-847` active 代理；`:849-874` 未 await 即 released、重复 release 与 asyncDispose Promise identity；`:927-947` 已接纳写不取消；`registry-node-dispose.test.ts:90-107` `await using` 正常/throw 退出真实 dispose。本次通过。

### AC9 — release 后仅 status 成功，其余操作为 `NAMESPACE_LEASE_RELEASED`：PASS

- **逐方法代码通道**：`lease.ts:84-86` read 同步 issue；`:88-99` `getSchemaEnvelope/getMetadata/getActiveSchema` 同步 throw；`:100-105` getStatus 是唯一成功且返回 released/null；`:106-112` mutateRoot/replaceSchema resolve issue；`:66-79` release/asyncDispose 自身为幂等 release protocol。
- **coded throw 可公开识别**：`errors.ts:44-50` 导出 `NamespaceLeaseReleasedError`（stable `code`），`index.ts:9` 从主入口导出；因此同步 getter 不依赖 message 识别。
- **测试证据**：`registry-open.test.ts:876-912` 实际逐项调用并断言 read、三个 getter、两写、status，以及 `instanceof`/`code`；本次通过。

### AC10 — generation/entry identity 防止旧异步操作删除新 entry：PARTIAL

- **实现证据**：`registry.ts:123-129` 的 `removeOnlySelf()` 正确要求 map 内对象 identity 和 generation 都匹配；carrier cleanup 也在 `registry.ts:174-194` 以无 entry + carrier identity + 当前 tail 三条件守卫。
- **已达动态证据**：`registry-open.test.ts:380-471` 覆盖失败 carrier 的 create/delete 配对、cleanup 前第二 slot 与新 carrier generation；`:1045-1142` 增补 reentrant FIFO/green-tail 证据。本次通过。
- **为什么是 PARTIAL**：#110 没有可调用 `close/create` 链，`removeOnlySelf()` 目前没有调用点（仅 future #111/#112 预留）；所以没有真实 old-entry completion 与 new-entry generation 并存的可达链路，无法做所要求的旧异步 entry 删除新 entry 的端到端动态验证。不可把 carrier ABA 测试表述为 entry ABA 完整证明。后续首次实现 entry removal 必须令 close completion 唯一经该 helper 并增设 old-entry/new-entry ABA 测试。

### AC11 — 公开错误不回显 identity/schema/root/input/cause；observer 保留结构化诊断：PASS

- **实现证据**：公开 issue 字符串均为常量（`registry.ts:89-119`、`identity.ts:36-44`、`lease.ts:45-50`）；fatal message 仅 operation/phase/committed（`errors.ts:24-36`）；released error 也是恒定文本（`:44-50`）。`observer.ts:14-35` 事件可携带 identity/exact cause 且 observer throw 隔离。
- **负锁覆盖完整性核对**：`registry-open.test.ts:967-1042` 对本票可达 public 输出逐一收集并查 sentinel：invalid、typed load failed、not found、unknown-load fatal 的 JSON/message、released read、released getter error JSON、create、shutdown、Registry status、released status；还断言 observer 收到 exact typed cause/identity，diagnostic key 不含原 identity。factory fatal 的 cause-message 不回显另在 `:567-607`（`factory-boom`）覆盖。该覆盖包含本票所有公开 issue/error 类型：NOT_FOUND、INVALID_IDENTITY、LOAD_FAILED、REGISTRY_FATAL（两 phase）、LEASE_RELEASED issue/error、OPERATION_UNAVAILABLE；`REGISTRY_NOT_ACCEPTING` 在本票占位 shutdown 不改变 acceptance，故无可达 public 触发链。
- **动态结果**：相关测试在本次命令通过。

### AC12 — 确定性并发、全量 typecheck/test、Node 20/24 CI：PARTIAL

- **确定性并发（PASS）**：`registry-open.test.ts:31-44` 只使用 deferred/microtask；上述 AC2/3/10 的并发用例本次通过。
- **本地全量（引用 SA5，未伪称本次重复执行）**：`task_namespace-registry-open_sa5_verify.md:52-100` 记录 `pnpm typecheck` 与 `tsc -p tsconfig.typecheck.json --noEmit` exit 0；`:102-137` 记录 `pnpm test` exit 0、105 files/1266 tests、Type Errors no errors；`:139-166` 记录新包 42 tests；`:168-196` 记录 runtime 定向 150 tests。SA5 使用本 worktree 的 Node 24.13.0（`:268-294`）。
- **本次本地动态补验**：页首命令 exit 0，4 files/62 tests，含 Registry 三文件和 runtime internal seam，Type Errors no errors。
- **Node 24（PASS）**：本次 `registry-node-dispose.test.ts` 两个真实 `await using` 用例通过；SA5 也记录 Node 24.13.0 下未 skip。
- **Node 20/24 CI（本地不可验，留 Host CI 观察）**：当前 worktree 未提供 Node 20 或 PR CI run/log；因此不能证明 Node 20 runner 已实际收集三个 Registry Vitest 文件，亦不能宣称 CI green。Host 应在 Node 20 和 Node 24 CI 日志确认 `registry-open.test.ts`、`registry-surface.test.ts`、`registry-node-dispose.test.ts` 被 `pnpm test` 收集，且 asyncDispose 两例未 skip。

## 范围诚实性与 ADR / #104 抽查

- **未越界到 #111 create 链**：`registry.ts:309-312` 的 `create(_input)` 固定 resolve `NAMESPACE_OPERATION_UNAVAILABLE`，不读 input、不访问 Persistence；`registry-open.test.ts:645-677` 以 getter trap 和 call counters 动态核验。
- **未越界到 #112 idle timer/plugin/shutdown 聚合**：`registry.ts:317-319` 的 shutdown 固定 unavailable，不改 acceptance；未引入 Clock/scheduler/Cordis。`lease.ts:66-79` 的最后 lease release 只删 lease、不会 close/runtime release/timer；`registry-open.test.ts:473-494` 动态证明 release 后同 key 重开复用已有 Runtime（load/factory 仍各一次）。
- **ADR-0009 一致性**：ADR `:30-44,52-56` 要求同 key serialization、lease 同步失效与 exact promise、released-only status、load+factory 后立即 open、窄 issue/unknown fatal/零回显；上述实现与动态证据相符。#104 原始 tracking issue 不在 worktree 可读文件集中；仅将其已被 SA2 摘录的决策作为交叉参考，未把不可读取的 issue 内容当作独立证据。

## 最终结论

**总体：PARTIAL（仅 AC10 的当前票可达性、AC12 的 Host CI/Node20 证据缺口）。** 未发现本地可复现的功能 FAIL。AC10 不是实现反例，而是 #110 当前不存在 close/create 调用方导致 entry ABA 的完整动态链不可达；AC12 的 CI 部分必须由 Host 在 Node 20/24 CI 中观察后闭环。
