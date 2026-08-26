---
status: complete
run_id: issue-108-1787670535-603033
branch: fix/issue-108-on-docs-namespace-registry
round: 1
---

# issue #108：persistence：typed load/create 错误与 committed-aware create fatal

## 需求理解

为 Persistence 的 `loadDoc`/`createDoc` 冻结可供 NamespaceRegistry 诚实映射的 typed operational error 与 committed-aware create fatal（ADR-0009 §Persistence 错误演进 L72–L83 的实施任务，Parent PR #105），使上层无需根据裸异常文本猜测运营失败、Adapter bug 或文档是否已经提交。基线：base `docs/namespace-registry`（ba1b6b4，经一次暂停-变基 279d3ba→ba1b6b4 纯快进，一致性已核对无影响）。阻塞依赖 #107 已 closed 并入基线。

验收（AC1–AC8）：稳定 typed load operational error（cause 保留、message 不拼接 cause）；稳定 typed create operational error（`committed:false`）；committed-aware create fatal（稳定 phase + committed + cause）；duplicate 独立类型不混合；File create 提交点与 post-commit failure 分类准确、不虚假声称 rollback；unknown/internal 不降级为 operational；Memory/File 同一组错误契约 + exact cause + 敏感文本负锁测试；全量 typecheck/test 绿。

## 变更（commit 4ca9d5c，22 文件：src 6 + 测试 4 + wiki 流水线档案 12）

### 错误类型谱系（`packages/persistence/src/contract.ts`，+102，纯 additive）

- **`DocLoadOperationalError`**（code `DOC_LOAD_OPERATIONAL`）：typed load operational error；exact cause 经 own-enumerable 字段保留（identity 可 `toBe` 断言）；稳定常量 message 永不拼接 cause/identity/路径。
- **`DocCreateOperationalError`**（code `DOC_CREATE_OPERATIONAL`）：typed create operational error；`readonly committed: false = false` 字面字段（构造点恒在提交点前）；JSDoc Boundary 段声明 AC6 以契约守恒（seam 违约=adapter bug，非伪降级）。
- **`DocCreateFatalError`**（code `DOC_CREATE_FATAL`）：committed-aware create fatal；稳定 phase 四值 `'probe-read' | 'snapshot-encode' | 'store-write' | 'post-commit'`（Persistence 管线词汇，与 ADR-0009 Registry fatal phase 三值零词面重叠）；`committed` 由 export 的冻结映射 `DOC_CREATE_FATAL_PHASE_COMMITTED` 唯一派生（post-commit 唯一 true）；永不声称/执行 rollback。
- **`DocDuplicateError` 逐字节不变**：独立类型、无共享基类、四 code 两两互斥（AC4）。

### 分类落地（`packages/persistence/src/lifecycle.ts`，+108/−12）

- `PersistenceIO` seam 契约注释重写为观察通道公理：write resolve ⟺ 提交段已执行（禁 silent no-op resolve）；reject ⟹ 基准 store 未被本次 write 改变；seam 方法不得同步 throw。
- load：`io.read` 拒绝（epoch current）→ `DocLoadOperationalError`（cells.delete 清理在前、exact cause、同 ticket 共享同一包装实例）；disposed 竞态/损坏校验/integrity 保持裸传（AC6）。
- create：claim 段 probe read 与写段失败按 epoch current/stale 分类——current → operational（committed:false），stale（dispose-abort 竞态）→ fatal（绝不谎报 operational）；`Y.encodeStateAsUpdate` 失败 → fatal 'snapshot-encode'；提交点跨越后任何失败 → fatal 'post-commit' committed:true（不删 store、message 无 rollback 字样）；duplicate 判定与外层 claim 清理守卫逐字不动；分类经私有 `classifyCreateStoreFailure` 单点承载。
- 修复潜伏 bug：`createReadTicket` 的 `completion` deferred 挂 `completion.catch(() => {})`，消除 create 起始 read ticket 拒绝时的进程级 unhandledRejection。
- saveDoc/flush/degraded/retry/generation/evict/dispose/seedForTest **零改动**。

### Adapter 与导出（memory.ts +75/−4、file.ts +14/−1、index.ts +7）

- **commit-fact 裁决（核心）**：Memory write 的 abort 门从「hook 后早退 resolve」移位为「io.write 入口 `throwIfAborted()`（hook 之前、无第二道门）」——「write resolved ⟺ committed」在两 Adapter 一致成立，delegation 模型的 committed:false 说谎窗口结构性消除；File 提交点（mkdir→tmp→rename，三道门全在 rename 前）逐字节不变。
- 两 Adapter 对称 additive `wrapIo` around-seam（AC7 确定性故障注入的统一机制；默认不传=现状）；两生产插件工厂 options 收紧 `Omit<…,'scheduler'|'wrapIo'>`（测试 seam 不泄入生产签名）。
- index.ts additive 导出：三新类型 + `type DocCreateFatalPhase` + `DOC_CREATE_FATAL_PHASE_COMMITTED` + `type PersistenceIO`；既有导出逐字不动。

### 共享错误契约测试（testing.ts +514/−18 + 4 测试文件）

- `createPersistenceIoFaultSeam`（单发槽故障注入 + before/after-commit hold 门）+ `describePersistenceErrorContract` 共享套件 **EC1–EC8**，Memory/File 两 Adapter 以同一断言组（N1 类型/字段、N2 exact cause `toBe`、N3 敏感文本四面负锁 message/name/stack/JSON.stringify、N4 稳定 message 字面全等、N5 rollback 负锁+行为证伪、N6 裸传负锁）接入；**EC9**（新文件 persistence-encode-fatal.test.ts，vi.mock yjs 部分 mock 锚定 'snapshot-encode'）；**EC10**（委托模型 committed:true 公共面自洽锚）。
- 三处预授权既有修订：'io down' 断言改锚 typed operational + cause identity；dispose-race 用例改确定性 entered 门构造并加严为 'store-write' fatal；File EACCES 用例改锚 `DOC_LOAD_OPERATIONAL` + cause errno 保真。

### 契约演进说明

ADR-0006 #64「原始 I/O 错误原样上抛」由 ADR-0009 §Persistence 错误演进取代（SA8 门禁裁决）：「原样」的诚实意图经 `error.cause` exact identity 载体保全（不重抛、不改写、不拼接）。

## 验证（总控亲跑，后台独立进程）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 基线（变基后） | `pnpm test` / `pnpm typecheck` | 101 文件 1205 passed（exit 0）/ 八包 tsc exit 0 |
| 红灯锚定（SA6 后） | `npx vitest run packages/persistence` | exit 1：21 failed | 73 passed（18 新用例全红+3 授权修订红，意外绿 0，既有新增失败 0）——总控复跑一致 |
| 实现绿灯（SA3 后） | `npx vitest run packages/persistence` | exit 0：**94/94**（21 红全绿 + 73 保持，0 unhandled errors） |
| 最终全量（amended HEAD 4ca9d5c） | `pnpm test` | exit 0：**102 文件 1223 passed / 0 failed**（Type Errors no errors） |
| 最终类型 | `pnpm typecheck` | exit 0：八包 tsc 无错误 |
| 双版本 | persistence 套件 Node 24 ×5 连跑 + Node 20.20.2（docker 非 root）×1 | 全 94/94、0 flake、0 unhandled；DOMException AbortError `instanceof Error` 三版本实测（20/24/18） |
| 动态攻击（SA7） | 7 项零放弃 | EC5(File) 磁盘事实探针（hold.entered 时 .snapshot 在盘可解码→fatal committed:true→fresh 读回→重试 DOC_DUPLICATE）；dsh probe CLI 双跑逐字节一致；wrapIo 泄漏 TS2353 封死；自由攻击 4 项（300 轮 EC1 高压/单发槽语义/失败后重试 memory+真实 File IO 零残留）全未击穿 |

流水线：SA8 前置门禁 clear → SA1 设计（R1.1 定稿，675 行）→ SA8 设计复审 clear → SA2 攻击评审 R1 REJECT（1 HIGH delegation 说谎窗口 + 4 MEDIUM + 3 MINOR）→ SA1 R1 闭合 8/8 → SA2 R2 PASS → SA6 红灯 21 红 → SA3 TDD 实现 → SA4 静态 pass（F-1/F-2 闭合）→ SA7 动态 pass（7 项零放弃）→ AC 门禁 8/8 ✅ → 双轴终审（Standards 5 judgement 全闭合→clean；Spec faithful 零发现）。

## 遗留事项

- **Node 20/24 CI 矩阵**：外层 CI 门禁（本地已双版本实测 94/94）；发布后由 ci-watch 核对。
- **ADR-0006 交叉引用卫生**：建议后续 docs PR 给 ADR-0006 #64 补一条指向 ADR-0009 §Persistence 错误演进的交叉引用（本 issue 不改 ADR 正文，已登记设计 §7 R-5）。
- **File 未接入 issue-64 旧 createDoc 共享套件**：预存拓扑缺口（base 即如此，非本任务回归）；错误契约面已由新共享套件双 Adapter 覆盖，建议专项任务收口（设计 §7 OQ-2）。
- **Registry 侧映射**（typed operational → 公开 issue、duplicate → already exists、fatal committed 原样传播）：后续 Registry 实施任务消费本契约，不在本 issue 范围。
- `REPORT.md` 遵循 #115/#116/#117 已合并 PR 既定约定随分支提交。
