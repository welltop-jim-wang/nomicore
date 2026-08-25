# AC 逐条确认清单 — issue #93 namespace-runtime 全链集成验收与阶段收口

> 来源：issue #93 Acceptance criteria（TASK.md 同步）。核对时间：2026-08-24（本地 12:30–12:50）。
> 证据等级：runtime=可执行测试；static=静态审计/文档核对；ci=CI/流程证据。

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| 1 | 真实 VFSL compiler + doc-runtime + MemoryPersistence/FilePersistence 端到端覆盖 Runtime 全能力 | ✅ | runtime：新增 `runtime-acceptance-fullchain.test.ts`（Memory 全链 + File 真实磁盘 mkdtemp 全链 + crash-restart 恢复，SA6 首跑即绿）；存量 `runtime-mutate-root-persistence.test.ts`/`runtime-replace-schema-persistence.test.ts`（Memory 集成）。SA7 干净克隆复跑 3 files/8 tests 双 Node 全绿 | 无需修复 |
| 2 | 冷启动 P0 pending 读立即成功，早期写严格排在 P0 后 | ✅ | runtime（存量锚定，SA6 映射表核实存在）：`runtime-sync-read-face.test.ts` AC8（p0Gate 未 resolve 五读取面立即工作）；`runtime-mutate-root-sequencer.test.ts` AC4（preparing 期接纳写 FIFO 排 P0 后）；`runtime-p0-sequencer.test.ts` AC5/AC7（P0 真实队首节点） | 无需修复 |
| 3 | ROOT write、SCHEMA replacement、active schema 切换、dirty notification 顺序符合单 sequencer 契约 | ✅ | runtime（存量）：`runtime-mutate-root-sequencer.test.ts`（恰 1 update+1 notifier、严格 FIFO、失败不毒队列）；`runtime-replace-schema-sequencer.test.ts`（共享 FIFO 双向、active 切换）；`runtime-replace-schema-sa7-dynamic.test.ts` AC9 时序 | 无需修复 |
| 4 | persistence degraded/recovery、检查后降级竞态、最新 live Y.Doc 最终持久化（两 Adapter） | ✅ | runtime：新增 `runtime-acceptance-degraded-two-adapter.test.ts`（Memory I/O hook 注入 + File 真实 ENOTDIR 平行：gate 后降级写照常、后续写 RUNTIME_WRITE_DISABLED 零写入、恢复 retry 覆盖最新 live doc、跨实例可读）；存量 `packages/persistence/test/issue-79-{,file-}entry-status.test.ts` | 无需修复 |
| 5 | committed/pre-commit fatal、best-effort dirty notification、fatal 后只读、close 全链 | ✅ | runtime：新增 fullchain fatal 用例（真实 saveDoc 恰一次 + 全新实例可见已提交值 + 写禁读留 + close 照常）；存量 `runtime-close-lifecycle.test.ts`（fatal×close、排空、release 恰一次）、`runtime-write-fatal-message-rev1.test.ts`、`runtime-replace-schema-sa7-dynamic.test.ts`（α/β/γ 注入）、doc-runtime `apply-validated-mutation-fatal-contract.test.ts` | 无需修复 |
| 6 | 公共 exports 审计：不暴露生产构造器、DocHandle/Y.Doc/writable Yjs reference、包内 detached/testing seam | ✅ | runtime：新增 `runtime-acceptance-exports-audit.test.ts`（值导出恰 RuntimeWriteFatalError+createNamespaceRuntimeWithSeam 两键 + forbidden 模块级缺席探测）；存量 `runtime-public-surface-ownership.test.ts`、doc-runtime `public-surface-guard.test.ts`。static：SA1 D4 三层证据收口确认（11+1 类型清单逐项核对、seam 注入通道属 ADR 0008 L91 授权）；SA4 §6 复核 pass | 无需修复 |
| 7 | ADR 0007/0008、CONTEXT、package docs 与最终 API/错误词汇一致 | ✅ | static：SA6 发现 RUNTIME_READ_DISABLED 缺口 → SA1 R2 设计（§2 全量矩阵 16 词汇×5 文档面）→ SA3 落盘（commit 2cf4879：ADR 0008 追加稳定码注册修订节五条、CONTEXT.md 停接纳词条）；SA2 R2 pass；SA4 §5 协议六组断言独立复跑全过（含 13 码穷尽性差集双向空）；ADR 0007 核对零改动（SA8 设计后复审裁决成立） | 已通过 SA1→SA2→SA3→SA4 流水线修复并复核 |
| 8 | 全仓 typecheck/test、Node 20/24 CI 全绿、无待处理 blocker | ✅（本地全绿；CI 观察期属 Host） | runtime：总控亲跑 `pnpm test` 90 files/1101 tests exit 0 + `pnpm typecheck` 七包 exit 0（.mabf-bg/verify-retry.log、verify-tc.log）；SA7 干净克隆双 Node（v24.13.0/v20.20.2）同绿 + CI 六步本地对等复现全 EXIT=0。ci：ci.yml matrix node[20,24]（SA6/SA4 核实）；真实 GitHub Actions run 待 PR 建立后由 Host 观察期补录（职责边界：总控不 push 不建 PR）。Blocked by #86-#92 均已合入（git log 证实），无待处理 blocker | 本地部分完成；CI run 移交 Host |

## 结论

8/8 AC 全部 ✅（AC8 的 GitHub Actions 真实 run 按职责边界移交 Host 观察期，本地已用双 Node + CI 六步对等复现压平风险）。无 ❌ 条目，无需追加 SA 修订轮。
