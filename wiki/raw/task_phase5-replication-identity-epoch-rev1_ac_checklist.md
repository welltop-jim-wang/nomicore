# AC 逐条核对清单 — Phase 5 replication identity/epoch 修订轮（issue #132，round 2）

- **核对时间**: 2026-08-27（round 2）
- **核对人**: 总控（Phase 3.5 AC 门禁）
- **基线→HEAD**: 3841aff（round 1 封口）→ 本轮实现 commit ace6f83
- **验证基线**: 总控亲验 `pnpm test` 全仓 126 文件 1485/1485 绿（+7 新增）、Type Errors 无（.mabf-bg/r2-ctl-test.log，exit 0）；`pnpm typecheck` 9 包 exit 0（.mabf-bg/r2-ctl-typecheck.log）；`git diff --check` exit 0（当时检查范围：工作区/代码 diff；终审范围注记见下行）
- **范围注记（终审 S-1 处置）**: 双轴终审发现 3841aff..HEAD 全范围 `git diff --check` 曾 exit 2（3 个 wiki 证据文件 4 处行尾双空格，由 wiki 簿记 commit 引入；代码子范围 757bcd1..ace6f83 始终 exit 0）。已由各 SA 自行纯机械剥离（零内容变更，`git show -w` 为空）并 commit；收口前总控复验 3841aff..HEAD 全范围 exit 0。封口终验口径 = 全范围（代码+wiki+docs）
- **round 1 核对表**: `task_phase5-replication-identity-epoch_ac_checklist.md`（6/6 ✅）；本轮只对评审反馈引发的增量重新核对，未被反馈触及的 AC 沿用 round 1 证据
- **评审反馈处置总表**: 见 `task_phase5-replication-identity-epoch-rev1_design.md` §1 与 REPORT.md

## 评审反馈 ↔ AC 映射

| 反馈 | 处置 | 状态 | 证据 |
|---|---|---|---|
| 1（高）构造期 V2.5 与 ADR 0008:14 冲突 | 选择「修订 ADR 0008」路径（二选一之第一项）：保留构造期纯读，ADR 0008 新增「issue #132 修订」节登记窄例外 + 损坏拒绝构造语义 + 授权链 | ✅ | `docs/adr/0008-….md` 第 127–137 行增补节（七条款：授权链/两态与损坏通道/「原第 14 行保持不变」闭合边界/四窄方法/status.replication/dirty-not-durable/ADR 0010 权威）；SA8 设计复审 verdict: clear（override-declared，授权链=issue #132 PR #145 feedback 1）；SA2 R2 pass；SA4 pass 验尸面① |
| 2（中）公共契约文档同步 | ADR 0008「两个窄方法」限定为基础 2 + ADR 0010 授权 2；status 清单补 replication；Phase 5 Slice 1 扩充 Runtime/Lease 基础合同五条 | ✅ | ADR 0008 增补节条款 4/5；`docs/phases/phase-5-websocket-replication.md` Slice 1「Runtime/Lease 基础合同」五行 + 场景 15 拆 15a/15b；SA4 pass 验尸面② |
| 3（中）AC-6 恢复矩阵补全 | 新增两用例（见 AC-6 行） | ✅ | 见下 AC-6 |
| 4（低）E1/E2 重复 gate | 本 PR 处理：提取私有 `runReplicationWriteGate`（入口无关 Refusal 联合，零公共面扩散） | ✅ | `packages/namespace-runtime/src/replication-write.ts`（gate helper + 双槽调用）；`runtime-replication-write.test.ts` 新增 5 例双入口等价性（短路顺序/访问计数/hostile 输入边界）；SA7 变异验证（访问计数 0→1 确定性转红后还原） |

## AC 逐条核对

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC-1 | META reserves/projects replicationId/replicationEpoch，ADR 0010 格式 | ✅（沿用 R1） | 本轮未触及读取器/格式判据；ADR 0008 增补节条款 1/2 将既有行为登记为规范；既有锚（red AC-1 两条 + channels 损坏种子族 + SA7 动态 focus 3/5）在 1485 全绿内 | R1 已落地，本轮零回归 |
| AC-2 | enableReplication 原子安装 id+epoch 1，sequencer+dirty | ✅（沿用 R1） | 共享 gate 提取后槽序 E1–E7 不变（SA4 验尸面③：短路顺序/stable message/同步 markWriteFatal/rejection 通道逐字节等价）；双入口等价性 5 例绿 | R1 已落地，本轮重构等价性经测试+变异验证 |
| AC-3 | 重复 enable 幂等/稳定文档化结果 | ✅（沿用 R1） | E4 幂等分支未触碰；ADR 0008 增补节条款 2 记录两态判定 | R1 已落地 |
| AC-4 | bumpReplicationEpoch Hub-only/sequenced/monotonic/overflow/committed-fatal | ✅（沿用 R1，文档补强） | ADR 0008 增补节条款 4/6 记录 FIFO 槽序、overflow 拒升、committed≠durable、fatal committed facts 不回滚 | R1 已落地，本轮文档对齐 |
| AC-5 | Open/status 判别 disabled/enabled/identity change，不暴露可变 META | ✅（沿用 R1，文档补强） | ADR 0008 增补节条款 5 补 status.replication 域（两态、无 session/网络/队列/sync）；Phase 5 Slice 1 同步 | R1 已落地，本轮文档对齐 |
| AC-6 | 测试覆盖并发/degraded/close/fatal/retry/Memory/File 恢复 | ✅（**本轮补全**） | 既有矩阵（R1 核对表 5/5 子项）之上新增：① `registry-phase5-replication-red.test.ts` 用例 A「FilePersistence bump 恢复」：enable→bump 2→**双字段 waitDurableSnapshot**（id+epoch 2）→dispose→同 rootDir 重启 open 恢复 id0/2，status 精确等于 enabled 联合（SA7 变异验证：durable 目标 2→999 确定性超时转红，还原复绿——非假锚）；② 同文件用例 B「fatal committed-not-durable」：bump notify 失败 → RuntimeWriteFatalError committed:true → rejection 后仅从同一 live Y.Doc encode/clone seed（前后双断言 id0/2）→ 新 Registry 仅从 seed open，fatal 空、bump 至 3；failed notifier persistence 不充当 durable/reopen 前提（stub loadCalls/saveEvents 为空断言） | 评审反馈 3 两项缺口补齐，矩阵 6/6 子项 |

## 结论

6/6 全部 ✅，评审反馈 4/4 处置完毕，零回流。附注（沿 R1 惯例）：CI job-log 触发证据属发布后补证义务（SA7 报告已登记，未伪称 CI 已绿），非本地 AC 缺口。
