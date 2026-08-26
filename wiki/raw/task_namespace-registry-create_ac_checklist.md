# AC 核对表 — issue #111：namespace-registry 排他 create 与完整初始 generation

核对基准：issue #111 十二条验收标准（`gh issue view 111`）。核对时间：2026-08-26（round 1）。核对者：总控。
证据源：冻结设计（task_namespace-registry-create_design.md，SA2 R3 PASS）、SA6 红灯档案（sa6_red.md，含 R-fix/R-fix2/加固轮）、SA3 实现档案（sa3_impl.md，含 R1/R2）、SA4 评审（sa4_review.md，R2 pass）、SA7 动态报告（sa7_report.md，含总控裁决节）、总控亲跑验证。

| AC | 描述 | 状态 | 证据 |
|---|---|---|---|
| 1 | create 只接收 owner、namespaceId、schema 与完整 logical ROOT；不接收 META/createdAt，不生成默认 ROOT | ✅ | 设计 §3/§4/§5；registry-create.test.ts 输入形状矩阵（恰四键 descriptor 检查、缺 root/多键/META/createdAt 全拒为 NAMESPACE_CREATE_INVALID_INPUT）；snapshotCreatePayload 无默认 ROOT 路径（registry.ts:249+） |
| 2 | create 在 lifecycle 槽开始后才读取并冻结输入；输入缺陷仅使本调用失败，不毒化 queue | ✅ | 设计 §4 DQ-1；snapshot 时机测试（排队突变生效/槽后突变无效）；hostile 12+5 变体仅本调用失败且 tail 继续（绿灯锚：失败后同 key 后续操作正常）；SA7-r2 变异「Clock 读数挪到 payload 前」被击红 |
| 3 | identity 校验发生在 entry/Persistence 访问前，错误不回显原值 | ✅ | acceptCreateIdentity（identity.ts:123-145）descriptor-only；invalid 零 carrier/entries/Persistence/factory/createDocument（diagnostics 无 carrier-created 锚）；负锁 sentinel 测试（registry-create.test.ts 负锁 describe）；SA7-r2 零泄漏实测 pass |
| 4 | lifecycle 层从 Clock 生成固定 UTC toISOString() 的 META.createdAt；非法 Clock 输出为 pre-commit internal fatal | ✅ | readCreatedAtOrFatal（registry.ts 槽内单次读数）；FIXED_ISO 精确锚（1700000123456 → '2023-11-14T22:15:23.456Z'）；±8.64e15 边界接受、NaN/Infinity/超界/now() throw → fatal create/create-document-internal/false 零 Persistence；构造期 TypeError 门禁 4+3 变体；SA7-r2 createdAt 边界实测 pass |
| 5 | 私有 create-document 能力编译 schema、原样封闭校验 ROOT、detached 构造，并用一个 transaction 安装 SCHEMA/META/ROOT | ✅ | create-document.ts（compileSchemaEnvelope → createInitialDocument 编排）；create-initial-document.ts（validateLogicalSnapshot + buildTopEntries + 恰一个 transactGuarded + SCHEMA 四键/META 二键/ROOT entries）；afterTransaction per-doc 恰 1 锚（SA6 探针）；成功链内容断言（SCHEMA/META/ROOT 逐键） |
| 6 | validation/construction failure 不返回 partial Y.Doc 且不调用 Persistence | ✅ | seam 自持 new Y.Doc()、失败零出站（设计 §6）；domain 测试：schema/root 失败零 Persistence createCalls、零 doc 引用可达；seam 直调 9 灯（三分支+成功面+篡改面） |
| 7 | active/idle/concurrent/persisted duplicate 统一为 NAMESPACE_ALREADY_EXISTS；create 不退化为 open/upsert | ✅ | 四源 duplicate 测试：active/lease-zero 临时态/concurrent FIFO（deferred gate 固定先后手，第二个零 createDocument 调用）/persisted DocDuplicateError；零 loadDoc 锚；总控 300 混合压力复核 createCalls=1 |
| 8 | Persistence operational create failure 映射为窄领域结果；Persistence fatal 的 committed 事实原样传播 | ✅ | DocCreateOperationalError → NAMESPACE_CREATE_FAILED + observer create-persist-failed exact typed cause；DocCreateFatalError → fatal lifecycle-slot-internal committed 原样（false/true 双锚）；unknown → committed:false（DQ-6 总控裁决+冗余风险登记）；SA7-r2 真实 Memory adapter wrapIo fault 注入实测 pass |
| 9 | createDoc 成功后仍通过普通 P0 路径构造 Runtime | ✅ | 成功链走默认内部工厂（createNamespaceRuntimeForRegistry）：lease.read(['n'])=42、P0 结算后 schema.state preparing→ready 轨迹锚（registry-create.test.ts 成功全链 1-3 灯） |
| 10 | post-create Runtime construction failure 释放 handle、保留文档、清理 entry 并以 committed:true Registry fatal reject；后续 open 可恢复访问 | ✅ | createDoc resolved→factory throw：release 恰一次（reject/never-settle 双变体均不阻塞交付）、fatal create/runtime-construction/true、entries 零残留、文档保留、后续 open 得 lease 且内容完整；SA7-r2 时序实测 pass；总控亲核 persistence release/load 双路恢复（lifecycle.ts:110-114/334-360/511-516） |
| 11 | create/open 顺序、独立结算、不同 key 并行与失败后 tail 继续有确定性测试 | ✅ | ordering 矩阵：create→open（open 不见 transient missing）、open→create（NOT_FOUND 不毒化）、createDoc gate 挂起期同 key open 排队/异 key 并行到 Persistence、create 成功后 open 复用同一 Runtime identity、hostile 失败后 tail 继续；全部 deferred+flushMicrotasks 零 real sleep |
| 12 | 通过全量 typecheck/test 与 Node 20/24 CI | ✅（本地） | 总控亲跑：全仓 `npx vitest run --typecheck` 109 文件 1333 passed/0 failed + Type Errors no errors（SA3 R2 证据，最终收口前总控复跑复核）；`pnpm typecheck` exit 0；`tsc -p tsconfig.typecheck.json --noEmit` exit 0；Node 20.19 docker（node:20-slim）两包 exit 0（412 pass/2 skip——skip 为 #110 既有 await using 语言级条件跳过，基线已有）；CI 矩阵（Node 20/24 × pnpm install --frozen-lockfile + typecheck + test）为外层 CI 门禁，锁文件已收口（frozen-lockfile exit 0） |

结论：12/12 ✅（AC12 的 CI 部分为外层 Runner/CI 门禁，本地双版本已实测）。无 ❌/PARTIAL 项。
