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

rebase 到最新 base 后的最终本地验证：

- `pnpm typecheck`：exit 0。
- `pnpm exec vitest run packages/namespace-runtime packages/namespace-registry`：70 files / **661 tests passed**，Type Errors no errors，exit 0。
- `pnpm exec vitest run packages/namespace-runtime/test/runtime-replication-diagnostic-red.test.ts packages/namespace-runtime/test/runtime-replication-sa4-probe.test.ts packages/namespace-runtime/test/runtime-replication-sa7-dynamic.test.ts`：3 files / **21 tests passed**，Type Errors no errors，exit 0。
- `pnpm test`：257 files / **2826 tests passed**，Type Errors no errors，exit 0。
- `git diff --check`：clean。

前序独立门禁：

- SA6 由真实红灯（缺失 operation surface）转为 **15/15 PASS**；包含 owned update 链式重放、noop、identity/epoch、fatal、emitter/queue isolation 和 enable input-capture 锚点。
- SA4 R2：**pass**；F1/F2/F3 均独立复验闭合，探针 2/2、两包回归 361/361、typecheck 0 errors。
- SA7：**pass**；动态测试 4/4，覆盖 `updateCapture:false`→`update-omitted`、runtime-close/in-flight FIFO、无 emitter 等价，以及 F1 mutation 反证。
- 双轴终审：standards **pass**（无 blocker）及 spec **pass**（AC1–AC5 独立核验）。

rebase 后曾因生产接线缺失、测试 fixture 使用旧 API 及 noop dirty 语义过期而出现 20 项 focused 失败；本轮已完成三条 operation 的生产接线、fixture 迁移与现行 ADR 对齐，并以上述 661/661 结果闭环。

## 最终验证 HEAD

最终验证基于 PR #200 rebase 后分支及本轮修复工作树；提交与推送信息由 Host 操作记录确定。

本报告表示本地验收完成。
