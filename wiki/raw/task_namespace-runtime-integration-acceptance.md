# 任务简报 — namespace-runtime：全链集成验收与阶段收口（issue #93）

> **SUPERSEDED（已取代）**：本文是 issue #93 round 1 档案，其中 testing seam 公共导出结论已废止。当前裁决见 `task_namespace-runtime-integration-acceptance-rev1_design.md`：seam 仅保留包内模块通道，不从 package entry 导出。

- repositoryId: nomicore（GitHub: welltop-jim-wang/nomicore）
- issue: #93
- round: 1
- run_id: issue-93-1787626988-603033
- worktree: /home/wangjian/nomicore-fix-issue-93
- branch: fix/issue-93-on-docs-namespace-runtime
- 任务类型: 功能开发（集成验收/阶段收口；标签 feature）

## Parent

PR #85（docs/namespace-runtime）

## What to build

对 NamespaceRuntime 阶段执行全链集成验收，证明 schema-independent read、P0、ROOT/SCHEMA 写、Persistence gate、fatal 和 close 在真实 compiler/doc-runtime/Memory/File Persistence 组合下符合 ADR 0008，并收口公共 exports 与文档。

## Acceptance criteria

- [ ] 真实 VFSL compiler + doc-runtime + MemoryPersistence/FilePersistence 的端到端场景覆盖 Runtime 全能力
- [ ] 冷启动 P0 pending 时读取立即成功，早期写严格排在 P0 后
- [ ] ROOT write、SCHEMA replacement、active schema 切换和 dirty notification 顺序符合单 sequencer 契约
- [ ] persistence degraded/recovery、检查后降级竞态与最新 live Y.Doc 最终持久化通过两 Adapter 验收
- [ ] committed/pre-commit fatal、best-effort dirty notification、fatal 后只读和 close 全链通过
- [ ] 公共 exports 审计确认不暴露生产构造器、DocHandle/Y.Doc/writable Yjs reference 或包内 detached/testing seam
- [ ] ADR 0007/0008、CONTEXT、package docs 与最终 API/错误词汇一致
- [ ] 全仓 typecheck/test、Node 20/24 CI 全绿且无待处理 blocker

## Blocked by（均已合入本分支）

- #86 doc-runtime: schema-independent ROOT 载体投影读取（commit 2d805e9）
- #87 doc-runtime: committed-aware transaction fatal 契约（commit 1543ab3）
- #88（随 #89-#92 链路合入）
- #89 namespace-runtime: Runtime 骨架、同步读取面与队首 P0（commit df22660）
- #90 namespace-runtime: 唯一 write sequencer 槽与 validated ROOT 写（commit 1616c28）
- #91 namespace-runtime: 原子 SCHEMA replacement 与 ROOT generation（commit 588fa2b）
- #92 namespace-runtime: fatal、capability status 与 close 生命周期（commit 73811cd）

## 现状摘要（总控勘察 2026-08-24）

- packages: vfsl / vfsl-protocol / vfsl-codegen / persistence（memory+file adapter）/ dsh-persistence / doc-runtime / namespace-runtime
- packages/namespace-runtime/src: close.ts, errors.ts, index.ts, p0.ts, projection.ts, runtime.ts, schema-write.ts, sequencer.ts, status.ts, write.ts（v0.1.5）
- packages/namespace-runtime/test/：17 个测试文件（sequencer/persistence/snapshotter/sa7-dynamic/close-lifecycle/public-surface-ownership 等）
- 根 `pnpm test` = `vitest run --typecheck`（含 *.test-d.ts）；`pnpm typecheck` = 七包 tsc
- 前序任务 wiki 档案：wiki/raw/task_namespace-runtime-{skeleton-p0,write-sequencer,replace-schema-rev1,fatal-status-close}_*.md
- 已知仓库卫生问题：`.mabf-done` 曾被误提交（commit bfcb999），本轮收尾 commit 需固化其删除

## SA6 验收测试记录（issue #93 全链集成验收）

> 任务类型：功能开发（集成验收）。全部能力由已合入的 #86–#92 实现；**新验收测试首次运行即绿
> （能力已存在）→ 按任务规则如实标注「已绿/存量能力」，不伪造红灯**。新测试作为集成验收锚点
> 与回归防线，落库于 `packages/namespace-runtime/test/`。

### 新增验收测试（3 文件 / 8 用例，首次运行 8/8 绿）

- `runtime-acceptance-fullchain.test.ts`（AC1 + AC5，3 用例）：
  - MemoryPersistence 全链：真实 VFSL compiler（seam 缺省 compileSchemaEnvelope）→ P0 结算
    active schema 五键 → doc-runtime 载体投影读取（map/Y.Array）→ mutateRoot（标量+数组载体）→
    replaceSchema（提供完整 ROOT，单事务 1 update）→ 全新实例跨实例持久化验证 → close 全链；
  - FilePersistence 全链（真实磁盘 mkdtemp）：同链路 + 全新实例 crash-restart 三条目恢复
    （SCHEMA 四键/ROOT/META）→ close；「磁盘完整恢复」经公开 loadDoc，非 live 别名；
  - fatal × 真实 Persistence：ROOT observer 逃逸 → rejects RuntimeWriteFatalError（committed:true）
    → 槽内 best-effort saveDoc 恰一次 → 全新实例观察到 fatal-committed 的提交值（最终持久化）→
    rootWrite/schemaWrite 禁用、read 保留 → close 照常。
- `runtime-acceptance-degraded-two-adapter.test.ts`（AC4，2 用例）：同一场景函数在
  MemoryPersistence（公开 I/O hook 注入失败）与 FilePersistence（真实 fs 语义：删除
  users 分区后以普通文件占位使 mkdir 真失败 ENOTDIR——非 mock I/O）上平行执行：
  gate 通过后降级 → 写照常提交并登记 → 后续写 RUNTIME_WRITE_DISABLED 零写入（doc 字节不变）→
  恢复后 retry 覆盖最新 live doc → 两次全新实例分别读到降级前写与恢复后写。
- `runtime-acceptance-exports-audit.test.ts`（AC6，3 用例）：模块导出键集精确性（恰
  `RuntimeWriteFatalError` + `createNamespaceRuntimeWithSeam` 两个值导出）+ 生产构造器/
  运行态/持久层实现模块级缺席探测（运行时 import 探测，非源码 grep）。

### 8 条 AC 验收映射（测试证据）

| AC | 覆盖 | 证据 |
| --- | --- | --- |
| 1 真实 compiler+doc-runtime+两 Adapter 端到端全能力 | 新增（绿）+ 存量 | 新 `runtime-acceptance-fullchain.test.ts`（Memory+File）；存量 `runtime-mutate-root-persistence.test.ts`、`runtime-replace-schema-persistence.test.ts`（Memory 集成） |
| 2 P0 pending 读立即成功/早期写排在 P0 后 | 存量（绿） | `runtime-sync-read-face.test.ts` AC8（p0Gate 未 resolve 时五读取面立即工作）；`runtime-mutate-root-sequencer.test.ts` AC4（preparing 期接纳写 FIFO 排 P0 后、槽开始时 active schema 绑定）；`runtime-p0-sequencer.test.ts` AC5/AC7（P0 真实队首节点） |
| 3 ROOT write/SCHEMA replacement/active 切换/dirty notification 顺序符合单 sequencer | 存量（绿） | `runtime-mutate-root-sequencer.test.ts`（幸福路径恰 1 update + 1 notifier；严格 FIFO 前项 notifier resolve 前不放行；失败不毒队列）；`runtime-replace-schema-sequencer.test.ts`（共享严格 FIFO 双向、active 切换、notifier 顺序、P0 unavailable 恢复）；`runtime-replace-schema-sa7-dynamic.test.ts` AC9 时序（准备期观察旧 committed generation、transaction 后同步切换） |
| 4 degraded/recovery + 竞态 + 最终持久化（两 Adapter） | 新增（绿）+ 存量 | 新 `runtime-acceptance-degraded-two-adapter.test.ts`（Memory+File 平行）；存量 `runtime-mutate-root-persistence.test.ts`/`runtime-replace-schema-persistence.test.ts`（Memory degraded 全链）；`packages/persistence/test/issue-79-entry-status.test.ts`+`issue-79-file-entry-status.test.ts`（Adapter 自身平行状态契约） |
| 5 committed/pre-commit fatal、best-effort、fatal 后只读、close 全链 | 新增（绿）+ 存量 | 新 fullchain fatal 用例（真实 saveDoc + 跨实例可见）；存量 `runtime-mutate-root-sequencer.test.ts`（committed:true/false 两通道）、`runtime-replace-schema-sa7-dynamic.test.ts`（α/β/γ 注入路径）、`runtime-write-fatal-message-rev1.test.ts`（rejection 形状/cause/message 稳定）、`runtime-close-lifecycle.test.ts`（fatal×close、排空、release 恰一次）、`runtime-close-sa7-dynamic.test.ts`（真实 handle release）、`packages/doc-runtime/test/apply-validated-mutation-fatal-contract.test.ts` |
| 6 公共 exports 审计 | 新增（绿）+ 存量 | 新 `runtime-acceptance-exports-audit.test.ts`（导出键集精确性）；存量 `runtime-public-surface-ownership.test.ts`（createNamespaceRuntime 缺席、无 DocHandle/Y.Doc/writable 引用、失败构造所有权不转移）、`runtime-close-lifecycle.test.ts`（十键+无事件订阅键）、`packages/doc-runtime/test/public-surface-guard.test.ts`（doc-runtime 面） |
| 7 ADR/CONTEXT/package docs 与 API/错误词汇一致 | 静态审计（非运行时可测）+ 可执行面存量 | 可执行面：`runtime-write-fatal-message-rev1.test.ts`（P2 术语纪律：可观测 message 无「永久关闭」/closing/closed、含「禁用/读取/保留」）、`runtime-close-lifecycle-type-guard.test-d.ts`（lifecycle 三态、close 摘要键）。静态核对：ADR-0008 已含 `RuntimeWriteFatalError`/`RUNTIME_WRITE_DISABLED`/close()/closing/closed/七键 status 措辞（docs/adr/0008 L86-95）；**发现缺口：字面量 `RUNTIME_READ_DISABLED` 未出现在 docs/adr/0008 与 CONTEXT.md**（仅存在于设计文档 task_namespace-runtime-fatal-status-close_design.md D4 与相关决议）→ 建议 SA1/SA3 在 docs 收口时补入（本任务记录为已知缺口） |
| 8 全仓 typecheck/test、Node 20/24 CI、无 blocker | 证据/CI（非红灯测试） | `pnpm test` 全仓绿（见下）；`pnpm typecheck` 七包绿（本地 Node v24.13.0）；CI workflow `.github/workflows/*.yml` matrix node [20, 24] + typecheck + test + persistence-contract + domains-scaffold + materialize-root + regen-diff；「Blocked by」#86/#87/#89-#92 均已合入本分支（git log 证实），无待处理 blocker |

### 运行结果（真实执行证据）

- 存量基线（新增文件加入前）：`pnpm test` → **87 files / 1093 tests 全绿**（exit 0）。
- 新增验收测试（3 文件 8 用例）：`pnpm exec vitest run packages/namespace-runtime/test/runtime-acceptance-*.test.ts` → **3 files / 8 tests 全绿**（exit 0；Type Errors: no errors）。
- **全仓最终（含新增文件）：`pnpm test` → 90 files / 1101 tests 全绿（exit 0；Type Errors: no errors）**。
- `pnpm typecheck` → 七包 tsc 全绿（exit 0）。
- 调试过程记录（非实现缺陷）：首轮 4 红均为测试端 fixture 问题——(a) 初始快照把 `tags` 以 plain array 写入 Y.Map（正确实现按 VFSL 载体契约 loud 拒绝「载体错位」——fixture 修正为 Y.Array 载体）；(b) FilePersistence createDoc 会先落初始快照，降级注入改为「删除 users 分区后以同名普通文件占位」（真 mkdir 失败），而非直接向目录路径写文件（EISDIR）。修正后 8/8 绿——**无实现红灯，无伪造红灯**。
