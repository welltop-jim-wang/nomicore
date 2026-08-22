# AC 逐条确认清单 — DSH 持久化开发 profile 与 inspector 探针（Issue #59, P4）

> Phase 3.5 AC 门禁（2026-08-22，总控执行）。AC 来源：TASK.md / issue #59 body「Acceptance criteria」。
> 代码终态：commit `980c5a2`（SA3 实现 217d8a4 + 测试修订 eded79f + SA4 回流 d734352 + F-FILE 修复 980c5a2）。
> 验证基线：总控亲跑 `pnpm typecheck` exit 0 + `pnpm test` 40 文件 535 测试全绿（.mabf-bg/final-verify.log）。

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC1 | DSH profile 可选择 MemoryPersistence 或 FilePersistence Adapter（同一 contracts、零条件分支） | ✅ | `dsh-profile-acceptance.test.ts:144/176`（memory/file 双 profile 用例，`toBeInstanceOf` 真实 Adapter 实例 + `ctx.get` 同一身份）+ `:196`（未知 adapter 响亮拒绝）；设计决策 A/E（唯一分支点在 host 装配层）；SA4 验尸 §Scope（core 零条件分支、零 diff） | SA6 锚定 → SA3 实现 → SA4/SA7 双清 |
| AC2 | inspector 使用 handle：load → saveDoc 标脏 → 受控时钟/可观察调度触发 flush → release；重复 load 同 doc、不同 handle | ✅ | `dsh-profile-acceptance.test.ts:202` AC2 用例（dirty g1/g2、受控时钟 flush 窗口、load×2 独立 handle 同一 live doc、refs 2→1→0、R5 精确计数锚 t=1002 恰 1 条 evict / doc-alpha 恰 3 条 / 总 28）；探针 record 事件流（create/dirty/flush/load/release/evict） | 同上 |
| AC3 | userA/doc1 与 userB/doc1 隔离、META.docId 校验、SCHEMA/META/ROOT 三条目可观察 | ✅ | `:259` AC3 探针级 + `:304` AC3 service 级（file 用户分区快照隔离、META.docId 响亮失败）；S2/S3 场景（observed 三条目、duplicate=DOC_DUPLICATE、meta-mismatch 记录）；SA2 实测旁证（s3.mjs） | 同上 |
| AC4 | save 失败后 persistence-degraded、后续写拒绝、retry 成功恢复的探针记录完整 | ✅ | `:349` AC4 探针级 + `:373/:404` AC4 service 级（memory/file 双通道）；CLI `--fail-first-flushes 1/2` record 含 degraded→write-rejected→recovered 完整序列（SA7 R2 复跑：file n=1 ×52、n=2 ×30 全 0 异常、组内单一 sha256；n=2 双 ok=false 同代 @1508/2008、recovered@3008） | 同上（SA6 R3/R4 时序修订经 SA8 裁决 no-conflict） |
| AC5 | release 后由持久层内部决定真实 evict，probe 可观察引用归零与最终释放 | ✅ | AC2 用例 release 逐次断言 refs 归零后 evict；AC1-memory 修法 B 反黑帽守卫（release 后 `doc.isDestroyed===true`、`timer.pending()===0`——phantom-handle 抑制驱逐即爆红）；设计决策 G/A-evict（evict 即内核记账完成证明）；SA7 R2 ① file 52 跑逐字节一致含 evict 行 | 同上 |
| AC6 | 插件 reload/dispose 后无文件句柄、timer、监听器、Y.Doc cache 残留 | ✅ | `:437` AC6 用例（destroyed/service undefined/disposed/无 .tmp/无 fd/reload 全新实例读已提交快照）；设计决策 F（dispose 顺序+幂等）；SA7 失败 record 纯度验证（teardown 监听拆除闭环） | 同上 |
| AC7 | 持久化核心插件源码不 import DSH；DSH wrapper/profile 保持薄 Adapter | ✅ | `packages/persistence/test/core-dsh-boundary.test.ts` 绿色守卫 3/3（裸 Cordis 独立启动/停止 + `import.meta.resolve('@nomicore/dsh-persistence')` 方向守卫 + manifest 清单锚）；SA4 Scope 验尸：`packages/persistence` src/test 对基线**零 diff**、0.1.2 未 bump；依赖方向 `dsh-persistence → persistence` 单向 | 同上 |
| AC8 | DSH 中的探针结果形成可复制的命令 + 输出记录（供后续 NomicoreServer Host 复用验收） | ✅ | `dsh-probe-cli.test.ts` 7/7（`:72` 同命令双跑 stdout 逐字节一致、`:82` file 记录无 rootDir 痕迹、`:126` `dsh:probe` 包脚本入口）；`dsh-file-probe-determinism.test.ts` 2/2（进程内 3 连跑 + CLI 双跑逐字节一致、events=28 精确）；SA7 R2：file n=0/1 各 52 跑 + n=2 30 跑组内单一 sha256；memory 哈希与修复前逐字节相同 | 同上 |

## 结论

8/8 全部 ✅，无 ❌ 项，无需追加 SA 派发。评审双清：SA4 R2 复审 verdict **pass**（sa4_review.md 头部「Verdict (R2 复审，最终)」）；SA7 R2 复跑 verdict **pass**（sa7_report.md R2 复跑节）。

## 跟进项（不阻塞本任务）

- **F-REJECT-LEAK（LOW）**：`packages/persistence/src/file.ts:96` rm-on-directory EISDIR 场景 unhandled promise rejection 泄漏（record/exit 不受影响；SA7 R0 发现）。归属内核 DENY 区，超出本任务范围——SA1 R2/SA2 R2/SA4 R2/SA7 R2 一致建议立 P3 跟进项单独裁决。总控将为此开跟进 issue。
- **node 20 CI 矩阵面**：本机仅 node 24/25 实测一致；node 20 半边由 CI 矩阵在 PR checks 中验证（runner 职责）。
