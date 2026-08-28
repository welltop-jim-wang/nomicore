# AC 门禁清单 — Issue #152 修订轮 round=2（diagnostic-log-file-adapter-r2）

> 第 3.5 阶段 AC 逐条确认门禁（2026-08-21 立法）。核对对象：HEAD `f52eccb`（基线 `fde8034` → HEAD diff）。
> AC 来源：issue #152 正文 Acceptance Criteria（AC1–AC5，round=1 已 ✅，本轮核不回退）+ 任务简报 `task_diagnostic-log-file-adapter-r2.md` §验收标准（R2-AC1/2/3）。
> 证据引用：SA6 红灯契约 `task_diagnostic-log-file-adapter-r2_sa6_red.md`、SA4 `…_r2_sa4_review.md`、SA7 `…_r2_sa7_report.md`（含活链路 D-* 用例）、验证命令均为后台独立进程（日志在 `.mabf-bg/`）。

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC1 | 新 stream 有不可变 manifest（冻结 VFSL 信封 + format policy）+ 原子可替换 current-stream locator | ✅ | round=1 已验（task_diagnostic-log-file-adapter_ac_checklist.md）；本轮零回退：全仓 138 文件 1719 测试绿（`.mabf-bg/sa7-full-test2.log`），manifest 严格门相关既有用例全绿；R2 的 policy 校验以「manifest 先过既有严格 gate」为前提（设计 §2.1/§5.1） | 无需处理 |
| AC2 | ≤阈值 update 以 padded standard Base64 + payloadLength + CRC32C 内联；>阈值用 NDCL v1 sidecar frame + JSONL 引用关联 | ✅ | round=1 已验；R2 强化双向执行：超阈值 inline → `manifest-inline-threshold-violation`、≤阈值 sidecar → `manifest-sidecar-threshold-violation`（SA6 锚 4 四象限 + SA7 D-C2/D-C3 真实 writer 产物 + manifest 篡改活链路） | 无需处理 |
| AC3 | 最终物理 record 先过内建 VFSL schema + storage 校验再 append；sidecar frame 先于其 JSONL 引用落盘（BIN-first） | ✅ | round=1 已验；本轮 writer 重构（§3.2 双阶段提交点）保持「全部门禁先于 candidate 分配与落盘」：candidate 前 gate 失败零消耗有锚（SA6 锚 8/policy-continuity）；BIN-first 顺序不变（SA7 D-A1 交错终态实测 orphan 语义保持） | 无需处理 |
| AC4 | strict reader 校验 JSON/VFSL/Base64/长度/CRC32C/frame 元数据/引用/offset/格式/stream sequence，未知版本不近似解释 | ✅ | **本轮强化点**：(a) stream sequence 由「仅递增」升级为「自 1 连续」（设计 §3.4；SA6 锚 6：[1,3]/起始[2]/跨 segment gap 全判 `sequence-gap`/corrupt；SA7 D-B1 物理删除活链路实证）；(b) 新增 manifest 冻结四策略逐 record/line 执行（R2-AC1）；(c) 未知版本/incompatible 语义不变（六新码全归 corrupt、不入 INCOMPATIBLE_SET；SA4 §1 核实） | 无需处理 |
| AC5 | 公共 adapter 测试覆盖 inline/sidecar round-trip、阈值边界、全 result 分支、malformed 引用/帧、schema-envelope mismatch、producer 零干扰 | ✅ | round=1 已验；本轮包测试 20 文件 314 测试全绿（node 24）+ node 20.19.0 双版本一致（SA7 §验证门槛）；既有用例零回退（SA6 报告：HEAD 基线 27 条 strict-reader 既有用例全绿） | 无需处理 |
| R2-AC1（反馈 1） | strict reader 对 manifest 冻结四策略（committedUpdateCapture / inputCapturePolicy / inlineUpdateMaxBytes / jsonlLineLimitBytes）逐条落地执行；敌意 fixture 被响亮判定且有测试锚 | ✅ | SA6 锚 1–5（capture 违规×2 + genesis/update-omitted 合法豁免、input policy 真值表含 marker 双向 + VFSL 先拒、阈值双向四象限、行上限字节计量）；SA7 D-C1–C5 真实 writer 产物 + manifest 物理翻转活链路全部响亮判坏五码；R2-G19（`{capture:'none'}` 恒合法）由 dispatch 第 14 行裁决并经 SA4 §3 核实落实 | 无需处理 |
| R2-AC2（反馈 2） | 物理删除中间 record（[1,2,3]→[1,3]）被 strict reader 发现并如实判定；健康 stream（含全部合法终态）不误判；有测试锚 | ✅ | SA6 锚 6（[1,3]、起始[2]、跨 segment、.bin 保留帧删 JSONL 2 必 gap；[1,2(sidecar 坏),3] 无假 gap×2；身份不可解释行不拼接缺口×3）+ 锚 9/10（genesis 正交 + policy/anchor 解耦）；SA7 D-B1（物理删除 seq 2、bin 保留 → corrupt + sequence-gap 归因发现 record，records 保留逐条 ok）、D-B2（混合合法终态 ok 零误判）、D-A1（definitive 恢复交错终态 ok） | 无需处理 |
| R2-AC3（反馈 3） | ADR 0012 修订落地（状态/决策/被否方案/后果相应更新），同步首切片取舍与接线纪律成文，演进路径明确；ADR 0011 正文不动 | ✅ | `docs/adr/0012-….md` dated amendment（L244 起）：「在首切片 File adapter 的当前实现范围内被以下条款取代」（取代非并列）、有界同步 append 范围（≤1 JSONL 行 + BIN-first ≤1 帧、无 queue/batch/fsync 开关/常驻 fd）、write-slot 外接线 MUST（#149–#151/#155 修复后方可启用）、演进路径（公共 seam 不变前提）、被否方案新增 4 条、后果取舍段；状态头保留 accepted；`git diff --name-only -- docs/adr/0011-….md` = 0 文件（SA7 §R2-AC3 实核 diff） | 无需处理 |

## 门禁结论

8/8 全 ✅，无 ❌ 项 → AC 门禁通过，进入第四阶段（双轴终审 → 收尾固化）。

## 验证命令汇总（全部后台独立进程，SA4/SA7 独立复跑互证）

| 命令 | 结果 | 日志 |
|---|---|---|
| `node_modules/.bin/vitest run packages/namespace-diagnostic-log/test` | 20 文件 / 314 测试全绿，0 type errors，EXIT=0 | `.mabf-bg/sa7-pkg-run4.log` |
| 同命令 @ node v20.19.0 | 20 文件 / 314 测试全绿，EXIT=0 | `.mabf-bg/sa7-pkg-node20.log` |
| `pnpm test`（全仓 vitest run --typecheck） | 138 文件 / 1719 测试全绿，EXIT=0（基线 136/1664 零回退） | `.mabf-bg/sa7-full-test2.log` |
| `pnpm typecheck` | EXIT=0 | `.mabf-bg/sa7-typecheck.log` |
| `git diff --check`（fde8034..HEAD + 工作区） | 干净 | — |
