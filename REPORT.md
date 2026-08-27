---
status: complete
run_id: issue-135-1787792421-862383
branch: fix/issue-135-on-docs-phase-5-websocket-replication
round: 1
issue: 135
---

# Phase 5: implement instance replication protocol v1 codec（issue #135）

## 概要

交付纯二进制包 `@nomicore/replication-protocol`（packages/replication-protocol，0.1.0，ESM only）：
严格实现 instance-replication-v1 wire contract——20-byte 大端 NMCR envelope（一 WS message 一 frame）、
17 种 v1 payload 的 normative 字段序与消息码、append-only 消息/错误注册表（连接 17 条 + namespace 20 条，
scope/fatal/retryable/terminal 元数据不可变推导）、显式版本/capability 协商纯函数、malformed 输入统一
注册表分类（ProtocolError）。纯包：无 Cordis/WebSocket/Registry/Node server/Buffer 依赖；直接依赖锁定
yjs ^13.6.30 / y-protocols / lib0（lockfile 实定 13.6.32 / 1.0.7 / 0.2.117）。

流水线全程：SA8 前置门禁 clear → SA6 验收锚定（9 测试文件红灯）→ SA1 设计 R1 → SA2 攻击评审 pass →
SA3 TDD 实现（4feb737）→ SA6 测试缺陷 A/B 修复（fa53d86）→ SA4 R0 reject（F1/F2/F3）→ SA3 回流（7489ca1）
→ **SA4 R1 pass**（非阻塞 INFO-1 登记）→ **SA7 PASS** → **AC 门禁 6/6 ✅** → **双轴终审双 pass**。
（恢复轮说明：SA7 曾两度因宿主重启/forks 多 worker 内存爆炸中断，本恢复轮在中心资源约束下收口。）

## 变更

- `packages/replication-protocol/`：新包 11 源文件（envelope/canonical/payloads/messages/errors/registries
  /negotiation/limits/constants/index + package.json/tsconfig），SA4 R0 回流修复 3 处（lookupError own-key、
  assertWellFormedString typeof 守卫、readU32Field 死分支）+ 3 个防回归锚点。
- `packages/replication-protocol/test/`：SA6 验收测试 9 文件（含 18 条 byte-level golden fixtures）；
  SA6 A/B 最小修复（HELLO golden 版本表 wire `03010203`→`03030201`、golden 计数断言 17→18）。
- 根 `package.json`：typecheck 链追加 `tsc -p packages/replication-protocol/tsconfig.json`（唯一根改动）。
- 流水线档案：wiki/raw/task_replication-protocol-v1-codec_{design,sa2_review,sa3_impl,sa4_review,
  sa7_report,ac_checklist,standards_review,spec_review,dispatch,...}.md。

## 验证（本恢复轮亲跑，单 worker/heap≤2GiB/显式 timeout 约束下）

| 项 | 命令（约束） | 结果 | 证据（.mabf-bg/） |
|---|---|---|---|
| 根 typecheck | `NODE_OPTIONS=--max-old-space-size=2048 pnpm typecheck`（10 包链含新包） | **EXIT=0** | final2-typecheck.log/.exit |
| 根全量测试 | `pnpm test --pool=forks --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1 --testTimeout=60000 --hookTimeout=60000` | **127/127 文件 · 1544/1544 测试 · Type Errors 0 · EXIT=0**（87.26s） | final3-test.log/.exit |
| 包级套件 | `vitest run packages/replication-protocol`（含 --typecheck） | 9/9 · 139/139 · EXIT=0 | sa7-vitest-pkg.log/.exit |
| fuzz 确定性 | 单文件 ×3 连跑 | 3× 5/5 EXIT=0，逐字一致 | sa7-fuzz-{1,2,3}.log |
| yjs 互通 | 锁定组合真实 update/SV/snapshot 往返 | 25/25 EXIT=0 | sa7-interop.log/.exit |
| **Buffer 遮蔽整套件** | `vitest run --config .mabf-bg/sa7-shadow.config.ts --pool=threads --poolOptions.threads.singleThread --testTimeout=60000 --hookTimeout=60000`（heap 2048） | **7/7 文件 · 127/127 · 451ms · EXIT=0** | sa7-shadow-suite6.log/.exit |
| 遮蔽内存裁决探针 | plain node+tsx 复刻 fuzz 三循环（同种子）+ golden 变异，遮蔽下 heap 采样 | 800+800 decode Δ=0.0MB、300 roundtrip Δ=0.2MB、1220 变异 Δ=0.0MB，全断言过，EXIT=0 | sa7-shadow-node-probe.{ts,log,.exit} |
| D-5 原型语义 | 探针 11 项（payload 原型跟随输入/自产输出恒 Uint8Array） | 11 pass / 0 fail | sa7-probe-d5.log |
| alloc-bound | 巨大声明短 body 200k×2（帧级/payload 级） | 全部注册表分类错误，heap Δ≤1.2MB 有界 | sa7-probe-allocbound.log |
| INFO-1 行为 | encodeFrame 非数值 messageType（'toString'/'constructor'）实测 | 产出 type=0x00 帧，decode 边界必拒 UNSUPPORTED_MESSAGE_TYPE（失败 loud） | sa7-probe-info1.log |

### 资源约束合规与排障记录

- 全程 Vitest 参数兼容性先行核对（v3.2.7 `--pool/--poolOptions.{forks,threads}/{singleFork,singleThread,maxForks}/--maxWorkers/--testTimeout/--hookTimeout` 均经 `--help` 确认）。
- forks 池 + Buffer 遮蔽下 vitest worker 堆线性增长（~17MB/s）至 2GiB OOM（fuzz/截断/golden 三文件同现，
  117s 触顶）：经 node 探针裁决为 **vitest/tinypool forks IPC 管线对 Buffer 缺席的基础设施假象**
  （codec 运行时 heap 全平），非产品缺陷；遮蔽验证改用 threads singleThread 一次通过。
- threads singleThread 下根全量测试出现 1 例**与本文无关的既有测试**失败
  （namespace-runtime runtime-replace-schema-sa7-dynamic T3.4，`expected 'resolved' to be 'rejected'`）：
  该文件源自 PR #85，全仓无任何包依赖 @nomicore/replication-protocol（grep 零命中），今日同树内容
  默认池两次全绿；单文件对照实验：threads 池确定性失败 / forks 池通过 → 递归深度（栈尺寸）敏感型
  既有环境假设，非本任务回归。最终全量验证按约束采用 forks 单 worker（maxForks=1 逐文件新进程、
  顺序执行、heap 2048、显式 timeout）→ 1544/1544 EXIT=0。
- 宿主内存全程平稳（验证后 available 13.8GiB）。

## 门禁结论

- **SA4 R1：pass**（F1/F2/F3 闭环逐行复核）；登记 **INFO-1 非阻塞**：encodeFrame 非数值 messageType 入参
  产出 type=0x00 帧，decode 边界必拒，TS 类型面不可达、非 wire 攻击面。处置：SA7 §3.3 实测记录确认，
  建议后续切片顺手加 `typeof messageType === 'number'` 守卫（纯纵深项）。
- **SA7：PASS**（wiki/raw/task_replication-protocol-v1-codec_sa7_report.md）。
- **AC 门禁：6/6 ✅**（ac_checklist.md；非目标五项零越界：WS 连接/状态机、namespace 状态机、认证授权、
  背压调度、Runtime/Registry 集成均未实现，属后续切片）。
- **双轴终审（980b16a...HEAD diff，并行双 subagent）**：
  - Standards 轴（standards_review.md）：**pass**，0 hard violation / 6 judgement call（Fowler smell 类，
    最重为 payloads.ts marker/limit 校验形状各重复 6 处，建议后续提取 helper）；
  - Spec 轴（spec_review.md）：**pass**，1 LOW（sequence 纪律以 expectedSequence seam 委托状态层，
    与简报非目标一致；后续 ws 切片恒传 expectedSequence）+ 1 INFO（AC5 依赖锁定经 lockfile 落地）；
    scope creep 零、实现有误零，INFO-1 独立复核同意非阻塞。
- 两轴均无阻断问题，无需修复回流。CI 跟踪与发布（push/PR/标签/.mabf-done）移交 Host。
