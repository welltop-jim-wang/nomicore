---
status: complete
run_id: issue-134-1787847658-8367
task_type: feature
branch: fix/issue-134-on-docs-phase-5-websocket-replication
round: 1
issue: 134
started_at: 2026-08-28T00:21:00+08:00
finished_at: 2026-08-28T05:00:00+08:00
---

# Phase 5: expose trusted NamespaceLease ReplicationSession（issue #134）

## 概要

交付 Phase 5 切片 3/4：`NamespaceLease.openReplicationSession(options)` 受信任 duplex 复制会话——
可信 transport 可编码 state vector/diff、订阅 owned updates、经唯一 write sequencer 应用远端 Yjs
update，全程不取得 live Y.Doc。会话创建时冻结 localRole/remoteInstanceId/replicationId/
replicationEpoch；Hub 方向对 Peer update 执行 scratch clone 预检（SCHEMA 容器与 META 保留字段
内容投影不变才放行）；Peer persistence-degraded 下仅冻结 hub-to-peer 方向 session 可内存 apply
并继续 saveDoc 登记；单 Runtime observer 扇出不可变字节至多 session、排除源 origin、listener
失败自捕获不影响已提交事务；raw apply 不做 VFSL 预校验、状态标记 `replication-unvalidated`。
实例静态角色（hub/peer）经 Registry 构造注入；peer 本地 replaceSchema/enable/bump 以稳定
REPLICATION_ROLE_PERMISSION 拒绝。

流水线全程：SA8 前置门禁 **clear**（O-1..O-12 开放点）→ SA6 验收锚定（20 行为红+2 类型红）
→ SA1 设计 R1.1（SA2 R1 reject：HIGH×2 修复）→ SA8 设计复审 clear → SA2 R2 **pass** →
SA3 TDD 实现（666f9b1）→ SA6 R2 修复 8 项测试口径缺陷（08b49fd）→ 总控亲验三档全绿 →
SA4 静态验尸 **pass**（0 MAJOR/0 MINOR）→ SA7 动态验证 **PASS**（0 缺陷）→
AC 门禁 **7/7 + O-5 补锚 2/2** → 双轴终审**双 pass** → 终审非阻断项回流收口（04849fe）。

## 变更（diff ebc5419..HEAD = 666f9b1 + 08b49fd + 04849fe）

- `packages/namespace-runtime/src/replication-session.ts`（新，~660 行）：fanout（构造期恰一
  doc.on('update')、origin 回声抑制、每 listener 独立副本+自捕获计数、detach 摘除）、WeakMap
  host 登记、session core 十键六能力、apply 槽 R1–R7（fatal→身份/epoch fence→writable+
  degraded bypass 五条件合取→scratch 判据 (a) 预演→一次 Y.applyUpdate(origin token)→R5.5 标记
  →await notifyDirty→释槽）、open 门序。
- `packages/namespace-runtime/src/`：runtime.ts 构造期挂接（十二键公共面不变）；internal.ts 第二
  值导出 openReplicationSessionCoreForRegistry（Registry-only 消费边界不变）；errors.ts
  append-only（NSRT-FATAL-REPLICATION-APPLY-INTERNAL、ReplicationSessionClosedError）；
  write.ts WriteSlot +'replication-apply'（append-only，既有渲染逐字节不变）。**index.ts 零改动
  （值导出仍恰一键）**。
- `packages/namespace-registry/src/`：types.ts（ReplicationSession 结构性公共类型、open 输入/输出、
  稳定 message 常量、CreateNamespaceRegistryOptions.role）；lease.ts（open 编排①–⑥、wrapCore
  恰十键冻结、每 Lease 一活跃 session 计数、三 role gate、released 通道、doRelease 同步 close、
  Equal 断言锁）；registry.ts（role 门禁第五门、deps 单点注入、跨包 Equal 真锁）；testing.ts
  role 透传；index.ts type-only 追加（exports 不变）。
- 测试：SA6 红转绿套件 `registry-phase5-replication-session-red.test.ts`（22 行为用例）+
  `registry-phase5-replication-session-surface.test-d.ts`（5 探针）；SA3 包内
  `runtime-replication-session.test.ts`（30 用例，含设计 R1 T-1..T-8）；既有
  `runtime-registry-internal-seam.test.ts` 与 `registry-open.test.ts` 键集锁各演进一键（沿头注先例）。
- 文档同步四件套：ADR 0010 增补节（稳定词汇注册、hub 侧 META 全键收紧登记、needs-resync 推迟
  对账注记 C-1、判据 (a) 边界、observerFailures 显式化、回灌注记）；ADR 0009 两注记（internal
  第二导出、Lease 面新增）；phase-5 切片 3/4 锚定 + C-1 注记；CONTEXT.md（ReplicationSession
  词条扩写 + 新增「实例角色」词条）。
- 流水线档案：wiki/raw/task_namespace-lease-replication-session_{,conflict_report,relevant_decisions,
  sa6_red,design,design_conflict_report,sa2_review,sa2_review_r2,sa3_impl,sa4_review,sa7_report,
  ac_checklist,standards_review,spec_review,dispatch}.md。

## 验证（总控亲跑，最终 HEAD 04849fe；forks 单 worker/heap 默认/显式 timeout 约束）

| 项 | 命令 | 结果 | 证据（.mabf-bg/） |
|---|---|---|---|
| diff 卫生 | `git diff --check ebc5419..HEAD` | **exit 0** | 终端输出 |
| 根 typecheck | `pnpm typecheck`（10 包链） | **exit 0** | final-typecheck.log/.exit |
| 根全量测试 | `pnpm test --pool=forks --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1 --testTimeout=60000 --hookTimeout=60000` | **138/138 文件 · 1681/1681 测试 · Type Errors 0 · exit 0**（95s） | final-test.log/.exit |
| 基线对照 | 同命令于 ebc5419 | 1624/1624 exit 0（零回归；+57 = 本任务新增用例） | baseline-test.log |

SA7 动态验证摘要（PASS；探针全在 .mabf-bg/）：确定性三文件×3 连跑逐字一致；close barrier×停机序
17/17；scratch O(doc) 实测 5k 键 7.8ms/50k 键 102.7ms 近线性、heap 无泄漏增长；degraded retry
Memory+File 两路 16/16；observerFailures 3002 次投递计数精确、fatal 恒 null；Yjs 13.6.32 锚定
19/19；敌意/变异 22/22。

## 门禁结论

- SA4：pass（0 MAJOR/0 MINOR/6 INFO）；SA7：PASS（0 缺陷）。
- AC 门禁：7/7 + O-5 补锚 2/2（ac_checklist.md）；非目标零越界（WS/状态机/认证/resetReplica/
  transport 抽取/replication-protocol 包零改动）。
- 双轴终审（diff ebc5419..08b49fd，并行双 subagent）：Standards **pass**（0 hard/2 minor/5 info）；
  Spec **pass**（0 CRITICAL/0 HIGH/1 MEDIUM/2 LOW/2 INFO，AC 逐条独立抽查、scope creep 零）。
- 终审非阻断项已全部收口：Spec MEDIUM-1/LOW-1/LOW-2 → SA6 R3 补锚（22/22 直接绿）；Standards
  minor×2 → SA3 R2 机械修复；INFO 项归属切片 6/9 或知情接受（明细见 ac_checklist.md 终审后补记）。

## 遗留风险（全部已登记归属，不阻断本切片）

- `INSTANCE_ID_PATTERN` 双副本（lease.ts ↔ replication-protocol constants.ts，互指注释结构守卫）：
  切片 6 接线时收敛为单一真相源或加跨包一致性测试（Spec INFO-1）。
- `PEER_ALLOWED_META_KEYS` 占位常量首版空集、needs-resync 队列/背压、scratch 增量检查演进位：
  均属切片 6（ADR 0010 增补节已对账）。
- 实例角色缺省 'hub'（O-4 零回归唯一解）：切片 9 部署切片必须显式配置（SA8 R-1 登记）。
- observerFailures 无界计数、scratch O(doc)/apply 成本：O-10/O-12 显式裁决并登记，演进位属切片 6。

CI 跟踪与发布（push/PR/标签/.mabf-done）移交 Host。
