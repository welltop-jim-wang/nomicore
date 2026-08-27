---
status: complete
run_id: issue-133-1787847735-3529662
branch: fix/issue-133-on-docs-phase-5-websocket-replication
round: 1
issue: 133
---

# Phase 5: bootstrap import, archive, and guarded replica reset（issue #133）

## 概要

交付 Phase 5 切片 2+8 的本地复制生命周期（ADR 0010 §复制谱系与 epoch / §Bootstrap 与重连、
phase-5 文档 §实施切片 2/8）：Peer 侧从可信 Hub 快照安装缺失副本的受信导入路径，与冲突
Peer 的安全重置（关闭 Runtime generation → 归档旧持久文档 → 允许重新 bootstrap）。

- **Persistence**（packages/persistence）：`importDoc(owner, docId, doc)` 受控复制导入——
  复用 createDoc 同一 per-key 排他 claim 管线（exclusiveCreate 抽取），duplicate 复用冻结
  DOC_DUPLICATE 族；`archiveDoc(owner, docId, expectedReplicationIdentity)` 受身份前置条件
  保护的归档——settle 排空（零-handle dirty entry 强制即时 flush、尊重 degraded 回退）→
  archiving cell claim → guard-read（io.read）→ 单一身份谓词（错 id/错 epoch/缺失/损坏/
  docId 不符统一 DOC_ARCHIVE_IDENTITY_MISMATCH）→ relocate（writeArchive→remove，提交点
  = 归档写 resolve；remove 失败 = committed:true fatal、重试收敛）。PersistenceIO 扩展
  optional writeArchive/remove；DocPersistence 以 optional 成员建模 + 派生 ReplicaPersistence
  （required）+ 三处 loud capability gate（13 个既有 stub 零回归）。
- **File/Memory 行为等价**（AC-3/AC-5）：File 归档落点 `{rootDir}/archive/users/<u>/<ns>.snapshot`
  + tmp→rename 原子提交 + latest-wins 单槽覆盖；Memory 独立 archiveSnapshots Map 分区 +
  deleteSnapshot hook（受钩缺删钩实例归档 loud 拒绝）。文件访问封闭在 persistence 包内。
- **Registry**（packages/namespace-registry）：公共方法 `importReplica`（保留 Hub
  namespaceId——非普通 create；槽内核对次序 META.docId → 复制事实两键（readReplicationFacts
  判据族结构守卫副本）→ 才触 Persistence，拒绝零持久化写入）与 `resetReplica`（carrier
  FIFO 串行：owner 核对零泄露 → 强制失效未决 lease（forceReleasing 旗标抑制 idle 假事件）→
  close（I2 纪律）→ loadDoc 探针 → archiveDoc 纯传递期望身份 → key 缺席即 bootstrap 资格；
  owner/identity race 拒绝零部分删除，stale 身份重放由归档守卫天然拒绝）。
- **错误分类学**：Persistence +DocImportIdentityError + 归档四类 + DocArchiveFatalError
  （三 phase 冻结 committed 映射 false/false/true）；Registry +5 message 常量与结果联合，
  operation 词表 append-only +'reset'|'import'；稳定文案单点表，零回显纪律。

流水线全程：SA8 前置门禁 clear → SA6 验收锚定（52 红 + 3 守卫绿 + 类型锚）→ 总控亲验 →
SA1 设计 R1 → SA8 设计复审 clear → SA2 R1 reject（BLOCKER×2：settle×dispose 挂起、claim 失败
善后）→ SA1 R2 修订 → SA2 R2 pass → SA6 回流 R-1/R-2 + SA1 R3/R4 注记 → SA3 TDD 实现 →
总控亲验绿灯 → SA4 静态验尸 pass（LOW2+INFO5 分流闭环）→ SA7 动态验证 pass（零缺陷）→
AC 门禁 6/6 ✅ → 双轴终审双 clear（非阻断项总控裁决留痕并修复 3 处档案瑕疵）。

## 变更

提交：dcda564（实现+测试+档案 30 文件 +7605/-14）+ 3e60188（终审裁决档案修正 2 文件）+
终审报告与 REPORT 收口提交（见 HEAD）。

- `packages/persistence/src/`（6 文件）：contract.ts（YjsDoc/ReplicationIdentityRef/
  ReplicaPersistence 类型 + DocPersistence optional 成员 + 6 错误类 + committed 映射常量）、
  lifecycle.ts（exclusiveCreate 抽取 + importDoc、archiving cell 态、archiveDoc 全编排
  含三通知点与 identity 守卫善后、seedForTest 守卫扩 archiving）、memory.ts（archiveSnapshots
  分区 + deleteSnapshot hook + loud 配置门）、file.ts（archive/ 子树 tmp→rename + remove）、
  index.ts（+7 值 +4 类型导出）、testing.ts（fault seam writeArchive 并入 write 槽 + remove 透传）。
- `packages/namespace-registry/src/`（5 文件）：types.ts（+5 message 常量 + import/reset 结果
  联合 + 接口 +2 方法）、registry.ts（importReplica/resetReplica 槽 + readImportedReplicaFacts
  私有读取器 + forceReleasing 旗标 + capability gate + 映射矩阵）、errors.ts（operation
  +reset/import）、observer.ts（+3 事件形）、index.ts（type-only +5）。
- 测试（7 新文件，89 用例）：SA6 验收锚 5 文件（archive-red 23 / import-red 14 /
  registry-red 18 / 双 surface 8 类型锚）+ SA7 动态 2 文件 24 用例（settle 活性/并发矩阵
  ×50 轮/forceReleasing 观测/dispose 双窗口/File 崩溃恢复实机/identity 动态边界/公共面探针）。
- 流水线档案：wiki/raw/task_phase5-bootstrap-archive-reset_{简报,conflict_report,design(R4),
  design_conflict_report,sa2_review,sa2_review_r2,sa3_impl,sa4_review,sa6_red,sa7_report,
  ac_checklist,standards_review,spec_review,dispatch}.md。

## 验证（总控亲跑 + SA4/SA7/终审三方互证）

| 项 | 命令 | 结果 | 证据 |
|---|---|---|---|
| 基线 | git 跟踪 133 测试文件全量（SA6 红文件排除） | 1599/1599 绿、零类型错误 | .mabf-bg/baseline-test.log |
| 红灯真实 | 3 红文件 vitest run + tsc 程序 | 52 failed \| 3 passed；恰 4→3 错全在锚位 | .mabf-bg/red-verify.log / red-tsc.log |
| 绿灯（实现后） | `pnpm typecheck`（10 包链）+ `pnpm test` | exit 0；140 文件 1687/1687 绿、零 Type Errors | .mabf-bg/green-{typecheck,test}.log |
| 动态（SA7） | 2 新文件 3 连跑 + node 探针 + 全量 | 24/24 ×3 零 flake；探针 exit 0 零禁词；142/1711 全绿 | sa7_report.md §九 |
| 终审（双轴亲跑） | typecheck + 全量 + 5 文件单跑 79 用例 + diff --check | exit 0 全绿；diff --check 修复后 exit 0 | standards_review.md / spec_review.md |
| 封口终验（HEAD=3e60188） | `pnpm typecheck` + `pnpm test` + `git diff ebc5419..HEAD --check` | 见下方最终结果 | .mabf-bg/final-{typecheck,test}.log |

## 遗留风险

- **切片边界**：本票只交付本地生命周期；WS transport/ReplicationSession/wire 集成属切片 3-7
  （importReplica 输入为 detached Y.Doc，字节物化在未来 WS 插件；observer 事件域
  open-load-failed 复用等留痕项已在档案登记）。
- **非阻断项**（双轴终审裁决留痕，dispatch 第 22 行）：J-2 命名/J-3 注释笔误/J-4 陈旧行号
  自引用为注释级瑕疵；J-6 readMetaDocId 拒绝路径对调用方 doc 的空 META 创建副作用（被拒
  doc 绝不持久化、零实际危害）——均登记 phase-5 收口切片评估。
- **聚合 `tsc --noEmit` 与 CI**：本地 typecheck（10 包链 + tsconfig.typecheck 程序）全绿；
  CI 观察由 Host 发布阶段执行，不属本地完成门槛。
