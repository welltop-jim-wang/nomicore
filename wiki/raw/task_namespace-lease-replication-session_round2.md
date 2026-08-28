# 任务简报（Round 2 修订轮）— Phase 5: expose trusted NamespaceLease ReplicationSession（issue #134）

## 固定事实（Host 快照）

- 仓库：welltop-jim-wang/nomicore（本地 route id: nomicore）
- Issue：#134；对应 PR：#146（CI 已绿，评审 Request changes 后再合并）
- Worktree：/home/wangjian/nomicore-fix-issue-134
- 分支：fix/issue-134-on-docs-phase-5-websocket-replication（含 PR #146 当前代码，本轮在其上追加提交）
- run_id：issue-134-1787847658-8367；round：2
- Round 1 档案：`wiki/raw/task_namespace-lease-replication-session*.md`（设计 R1.1、relevant_decisions、ac_checklist、sa4/sa7 报告等）；round-2 产物一律以 `_round2_` 中缀命名，不覆盖 round-1 档案。

## 任务类型判定（总控）

修订轮 = 无标签任务，总控自判：**合同缺陷修复**（阻断项 1–5 为评审定位到 file:line 的契约违背，故障分析已由评审完成，**跳过 SA5**）+ 小型功能补全（项 8 plugin role 贯通）+ 测试/文档收口（项 9–12）。
自构工作流：SA8 前置门禁 → SA6 红灯锚定 → SA1 R2 设计增补 → SA8 设计复审 → SA2 攻击评审 → SA3 TDD 实现 → 总控亲验三档 → SA4 静态验尸 → SA7 动态验证 → AC 门禁（评审 12 项逐条）→ 双轴终审 → 收尾。
（先 SA6 后 SA1 沿用 round-1 序：评审反馈即验收合同，先锚定红；项 6/7 的语义二选一由 SA6 按评审者诚实向读法锚定、SA1 设计裁决确认，冲突则回流 SA6。）

## 评审反馈全文（issue #134 最新评论，逐字）

---

## PR #146 合并前修复项（独立完成质量审查）

结论：当前建议 **Request changes，暂不合并**。虽然 CI、本地 `pnpm typecheck` 与全量测试均通过（138 files / 1681 tests），但以下契约问题应在合并前修复并补回归测试。

### 阻断项

1. **Epoch fencing 必须立即停止旧 session 的 outbound fanout**
   - 当前 epoch bump 只更新 Runtime facts；旧 session 要等下一次 `applyRemoteUpdate()` 才在 `packages/namespace-runtime/src/replication-session.ts:417-429` 转为 `conflicted` 并 detach。
   - bump 后、下一次 inbound apply 前，旧 session 仍是 `open`，仍可能发送本地更新。
   - 应在 bump 的 sequencer 边界主动 fence/detach 旧 epoch session，或在每次投递前核对冻结 identity/epoch。
   - 补测：`apply A → bump → apply B` FIFO、bump 后旧 listener 立即停投、旧 session 状态与新 session 重建。

2. **Runtime close 必须终止并摘除现存 sessions**
   - `packages/namespace-runtime/src/runtime.ts:335-345` 当前只切换 lifecycle 并排 close barrier，session 仍可能保持 `open` 且 fanout channel 仍 attached。
   - 应在 Runtime close 同步停接纳时关闭/detach sessions，并明确 barrier/已接纳 apply 的排空语义。
   - 补测：Runtime close 后 session 终态、存量 listener 零投递、在途 apply 与 close 的确定性顺序。

3. **复制 subscriber 不得同步阻塞 write sequencer**
   - `packages/namespace-runtime/src/replication-session.ts:156-169` 在 Yjs transaction observer 中同步执行 listener。try/catch 只能隔离 throw，不能隔离慢、重入或不返回的 listener。
   - 这会阻塞 transaction 返回、dirty notification 和同 namespace 后续 sequencer 槽，违背 ADR 0010 的非阻塞要求。
   - 应复制 owned bytes 后进入有界异步队列投递；溢出按契约进入 `needs-resync`，不得阻塞 sequencer。

4. **受保护字段的"内容投影相等"必须正确支持允许的结构值**
   - `packages/namespace-runtime/src/replication-session.ts:575-584` 将任何非 primitive 值恒判为不相等。
   - 若现有 META/SCHEMA 含 object/array，即便 update 只修改 ROOT，也可能被误判为 protected fields changed。
   - 应对允许值做规范化深比较；或在更早的不变量中明确禁止这些值并锁定测试。

5. **Lease release 不得因 session seam 抛错形成半释放状态**
   - `packages/namespace-registry/src/lease.ts:224-227` 在 lease 已标记 released、已从 entry 删除后调用 `activeSession.getStatus()`；若同步抛错，会跳过 `session.close()` 与 `onReleased()`，导致 session 未停、Registry idle cleanup 未武装，同时破坏稳定 same-Promise release 语义。
   - 不应先查询状态；直接调用幂等 `close()`，并确保 `onReleased()` 在 guaranteed cleanup 路径执行/隔离。
   - 补 hostile seam 测试：`getStatus`/`close` 异常不能造成部分释放、漏清理或首次 release 同步抛出。

### 需要明确并验证

6. **`Y.applyUpdate` 异常的 `committed` 标记必须诚实**
   - `replication-session.ts:480-485` 当前对 live apply 的所有异常无条件标记 `committed:true`。
   - 增加 `beforeTransaction`/observer 抛错测试，区分实际是否发生 mutation；如只能保守过报，应明确规范，不能宣称精确 committed 事实。

7. **空/重复 no-op update 的 session 状态语义**
   - 当前每次成功返回的 `Y.applyUpdate` 都设置 `rootValidation='replication-unvalidated'` 和 `memoryCaughtUp=true`，即使 update 未推进文档状态。
   - 明确"成功接纳即计数"还是"实际状态推进才置位"，并补测试与 ADR 文字。

8. **生产 Cordis plugin 的 peer role 装配缺口**
   - Registry core 已支持静态 `role`，但 plugin config 仍仅接受 `idleTimeoutMs`，生产 composition 无法构造 peer Registry。
   - 应将 `role` 贯通 plugin config、校验、构造、README 和 hub/peer 装配测试；若本切片明确延后生产 peer 支持，则需收窄当前完成声明。

### 测试与文档收口

9. 补齐 AC7 竞态矩阵：accepted apply→Lease release、session close、Runtime close、真实 idle expiry、Registry shutdown、epoch bump、committed fatal。
10. owned bytes 测试应直接保存 callback 原始参数并断言数组及 buffer 均不共享；不要在 listener 内先复制后再断言。
11. 更新 `packages/namespace-runtime/README.md` 与 `packages/namespace-registry/README.md`：登记 ReplicationSession、trusted raw/VFSL 例外、degraded hub→peer apply、静态 role、peer 权限与生命周期边界。
12. 删除或实际使用 `PEER_ALLOWED_META_KEYS` 空占位；减少 runtime/registry/session seam 类型手工重复，避免后续 shotgun surgery。

修复后建议重新运行：`git diff --check`、`pnpm typecheck`、`pnpm test`，并重新进行 Standards / Spec 双轴审查。

---

## 评审 12 项 → Round 2 验收合同（AC-R2 映射）

| R2# | 评审项 | 合同要点 | 主要触点 |
|---|---|---|---|
| R2-1 | 阻断 1 | epoch bump 后旧 session 立即停投（fence/detach 在 bump 槽边界或逐投递核对冻结 identity/epoch）；旧 session 转 conflicted 态可观测；新 epoch session 可重建 | runtime replication-write bump 槽 / replication-session fanout+session |
| R2-2 | 阻断 2 | Runtime close 同步停接纳时终止并 detach 现存 sessions；barrier/已接纳 apply 排空语义明确并入文档/测试 | runtime.ts close / replication-session |
| R2-3 | 阻断 3 | fanout listener 不再于 Yjs transaction observer 内同步执行；owned bytes 复制后有界异步队列投递；溢出 → needs-resync 契约（ADR 0010 L113）；零阻塞 sequencer | replication-session.ts createSessionFanout |
| R2-4 | 阻断 4 | 受保护字段投影相等正确支持允许结构值（规范化深比较），或在更早不变量禁止并锁定测试 | replication-session.ts protectedPrimitiveEqual |
| R2-5 | 阻断 5 | Lease release 不先查状态、直接幂等 close()；onReleased 在 guaranteed cleanup 路径执行/隔离；hostile seam（getStatus/close 抛错）不造成半释放 | lease.ts doRelease |
| R2-6 | 项 6 | applyUpdate 异常 committed 标记诚实区分（beforeTransaction/observer 抛错测试）；若保守过报则规范明文声明 | replication-session.ts R5 |
| R2-7 | 项 7 | no-op/重复 update 的 rootValidation/memoryCaughtUp 置位语义明文二选一 + 测试 + ADR 文字 | replication-session.ts R5.5 + ADR 0010 |
| R2-8 | 项 8 | role 贯通 plugin config/校验/构造/README/装配测试；或收窄完成声明 | registry plugin.ts + registry.ts |
| R2-9 | 项 9 | AC7 竞态矩阵七场景补齐确定性合同测试 | registry/runtime 测试 |
| R2-10 | 项 10 | owned bytes 测试直存 callback 原始参数，断言数组与 buffer 均不共享 | 既有 fanout 测试演进 |
| R2-11 | 项 11 | 两包 README 登记 ReplicationSession/trusted raw 例外/degraded apply/静态 role/peer 权限与生命周期边界 | 两 README |
| R2-12 | 项 12 | PEER_ALLOWED_META_KEYS 删除或实用；收敛 seam 类型手工重复 | replication-session.ts / lease.ts / types.ts |

## 既有约束提醒（round-1 门禁结论仍有效）

- 公共面纪律：Runtime 恰十二键、index.ts 值导出恰一键、session 恰十键 Equal 锁、registry/runtime seam 类型跨包 Equal 断言——改动不得突破（ADR 0009/0010、round-1 SA8 O-1..O-12）。
- ADR 0010 L113：「队列溢出只把 channel 标记为 needs-resync，不得阻塞 write sequencer」——R2-3 的合同原文出处。
- 既有全套测试 138 文件/1681 用例必须保持绿（演进键集锁按头注先例办理）。
- 改过代码的包必须 bump patch 版本号（namespace-runtime / namespace-registry）。
- Wiki 档案随代码入 git；`.mabf-bg/**` 不入仓；总控不 push、不开 PR、不写 .mabf-done（Host 收口）。

## SA6 红灯锚定记录（round 2，2026-08-28）

产出 `wiki/raw/task_namespace-lease-replication-session_round2_sa6_red.md`：
- 新增 `packages/namespace-runtime/test/runtime-replication-session-round2-red.test.ts`（17 用例：10 红/7 绿锁定，R2-1/R2-2/R2-3/R2-4/R2-6/R2-7/R2-10）；
- 新增 `packages/namespace-registry/test/registry-phase5-replication-session-round2-red.test.ts`（12 用例：11 红/1 绿锁定，R2-1/R2-5/R2-8/R2-9）；
- round-1 两文件按评审项 10 允许范围做 listener 直存原始参数加严（仅此一档，52 用例全绿）；
- 全量回归实测 140 文件/1710 用例/Type Errors 0：既有 138 文件 1689 用例全绿（1681 基线 + 8 新绿锁定）；21 个失败全部为新套件预期红灯；
- 语义分歧点 6 项（needs-resync 标记形状、R2-2 终态词汇、R2-1 bump 写相对序、R2-6 精确判据、R2-5 注入面、R2-9 联动）→ SA1 裁决，见报告 §3。
