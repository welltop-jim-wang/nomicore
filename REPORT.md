---
status: complete
run_id: issue-151-1788125506-4073122
branch: fix/issue-151-on-docs-namespace-diagnostic-change-log
round: 1
---

# Issue #151 — Record trusted replication and management writes

## 需求摘要

将 trusted replication apply、replication enable 和 replication epoch bump 接入 namespace diagnostic change log；记录冻结的 v1 operation、受控 source/context、既有 phase/code/issues/committed 事实与事务级 owned Yjs update bytes，同时不改变 identity gate、ACK、write-sequencer 顺序、dirty notification 或 transport observability。

## 变更摘要

- 新增最小 replication 业务闭包：管理写 enable/bump、lease 复制会话及 apply 路径；保持主线形状并显式登记未物化的 fanout/角色编排范围。
- 在 `NamespaceRuntime`/registry 接入 replication diagnostics：三种 operation、受控 source/context、槽外或槽后 emit、稳定结果映射、transaction update 捕获和 update-omitted 投影。
- 修复审查发现的两项实现问题：apply 的 capture window 无条件挂接以保持无 emitter 基线的 dirty notification；enable 成功路径记录 frozen input snapshot。
- 升级 `@nomicore/namespace-runtime` 至 `0.1.9`、`@nomicore/namespace-registry` 至 `0.1.4`。
- 增加并保留 15 项 SA6 端到端契约、2 项 SA4 探针和 4 项 SA7 动态测试；所有任务档案位于 `wiki/raw/task_trusted-replication-management-diagnostic-change-log*`。

## 验证证据

最终本地验证（本控制器前台执行）：

- `pnpm typecheck`：exit 0。
- `pnpm exec vitest run packages/namespace-runtime`：31 files / **201 tests passed**，Type Errors no errors，exit 0。
- `pnpm exec vitest run packages/namespace-registry`：13 files / **164 tests passed**，Type Errors no errors，exit 0。
- 隔离复核 `pnpm exec vitest run packages/namespace-registry/test/registry-surface.test.ts`：1 file / **12 tests passed**，exit 0。

前序独立门禁：

- SA6 由真实红灯（缺失 operation surface）转为 **15/15 PASS**；包含 owned update 链式重放、noop、identity/epoch、fatal、emitter/queue isolation 和 enable input-capture 锚点。
- SA4 R2：**pass**；F1/F2/F3 均独立复验闭合，探针 2/2、两包回归 361/361、typecheck 0 errors。
- SA7：**pass**；动态测试 4/4，覆盖 `updateCapture:false`→`update-omitted`、runtime-close/in-flight FIFO、无 emitter 等价，以及 F1 mutation 反证。
- 双轴终审：standards **pass**（无 blocker）及 spec **pass**（AC1–AC5 独立核验）。

一次合并运行 `pnpm exec vitest run packages/namespace-runtime packages/namespace-registry` 曾使未触及的 `registry-surface.test.ts` 在满载条件下触发 5 秒超时并令外层 120 秒执行上限终止。该文件隔离复跑 12/12 通过，且本报告所列 runtime/registry 分包复跑均通过；standards/spec 双轴亦以历史、隔离复跑和零 diff 证据将该现象定性为负载敏感环境伪影，而非 #151 回归。

## 最终验证 HEAD

最终验证时业务 HEAD 为 `b5b0cb8`：`fix(namespace-runtime,namespace-registry): close SA4 R1 F1/F2 - apply capture window unconditional, enable E3 input snapshot (#151 R2)`。

本报告表示本地 MABF 验收完成；未执行 push、PR、标签、`.mabf-done` 或任何 Host 生命周期操作。
