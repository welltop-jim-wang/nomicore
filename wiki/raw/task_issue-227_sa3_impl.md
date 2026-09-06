# SA3 实现报告 — Issue #227：strict replay 读取租约与完整性判定（实现轮）

- 角色/阶段：SA3 implementation（Bug 修复流水线：SA5 → SA6 → SA1 → SA2 → SA3）
- Worktree：`/home/wangjian/nomicore-fix-issue-227`（branch `mabf/issue-227`，HEAD `ac91a6b` pre-change）
- 权威契约：`wiki/raw/task_issue-227_design.md`（R1.1 §7 实现清单 / INV-227-1..10）；
  SA2 复审 `wiki/raw/task_issue-227_sa2_review.md`（approve + K-1..K-5 binding）；
  SA6 红灯契约 `wiki/raw/task_issue-227_sa6_red.md`（§2 命令 / §3.3 红基线 / §3.4 绿灯 pin）
- 边界：改动限 §0.2 ALLOW 路径；**零 DENY 面触碰**（schema.ts/record.ts/emission/pipeline/
  sink/memory/删除协议/analyzeStreamForResume 零改动——`git status` 亲证）；未 commit/push；
  无测试抑制（SA6 文件零 `.skip/.only/.todo`）。

## Verdict

**approve-ready（实现完成：全部 SA6 红→绿 + 绿灯 pin 零回退；typecheck/全量测试退出码 0）**

## 1. 变更清单（文件 → 改动 → 设计/不变量锚点）

| 文件 | 改动 | 锚点 |
|---|---|---|
| `packages/namespace-diagnostic-log/src/read-session.ts` | 新增导出 `DEFAULT_READ_SESSION_TTL_MS=15_000`、`READ_SESSION_RENEW_MARGIN_MS=1_000`（单源化原内联 15_000）；`DiagnosticReadSession` 增 `enumerationFailed: boolean` 与 `renewIfDue(marginMs)`（非法 margin 宽容视同 0——G-227-1 裁定）；open 枚举失败承载 `enumerationFailed:true`（不 throw） | 设计 §3.1 / G-227-1 / INV-227 无新增 |
| `packages/namespace-diagnostic-log/src/reader.ts` | 头注码表 29→31（+`lease-expired`/`segment-vanished`）；`StrictReadRequest.session?`（可选增量）；`readStreamStrict` ①′ 会话防御门（身份不符 → `corrupt+locator-invalid`、已 close → `corrupt+lease-expired`，零 fs）；④′ 会话取得（提供 → 快照即枚举 INV-227-2、`enumerationFailed` → 保持既有 corrupt+manifest-invalid 包络逐字节等同；缺省 → 自开自关 ttl15s/显式续租/真实时钟）；⑤ 逐段 `renewIfDue(READ_SESSION_RENEW_MARGIN_MS)` 检查点（拒续 → `lease-expired` + break 保留已读 records）；jsonl ENOENT 分支增 vanished 判定（bin 在 ∧ 无 marker → BIN-first 窗口零行零 issue 保留；marker 在 ∨ bin 缺 → `segment-vanished`——INV-227-9）；⑦/⑧ 恒释放自开会话；`StrictRecordUpdate` 增第五成员 `{kind:'unknown'}`、`none` 域收窄（materialize 谓词：`fatal∧committed:true∧effect∉{'update','update-omitted'}` → unknown——effect 缺席与字面 'unknown' 同归，INV-227-5） | 设计 §3.2/§4.2/§5/INV-227-1/2/5/9 |
| `packages/namespace-diagnostic-log/src/adapters/file.ts` | 新增 `deleteGroupIfUnleased`（S0′ 提交点复查：S1 rename 前同 `now` 的 `segmentLeased` 复核——`'lease-blocked'`/`'deleted'`/`'failed'`），P1/P2 两处 deleteGroup 直呼替换（双门：判定点初查保留）；`hygieneStream` 增 `now` 参 + orphan-BIN unlink 前租约门（跳过计入 `leaseBlockedGroups`——N-3）；P0 调用点传 `now`；事件规则注释 N-3 备案 | 设计 §3.3.1/§3.3.2/INV-227-3/4 |
| `packages/namespace-diagnostic-log/src/retention.ts` | `leaseBlockedGroups` JSDoc 扩写（P1/P2 止步 + P0 跳过）——零形状变更 | 设计 §3.3.2 |
| `packages/namespace-diagnostic-log/src/index.ts` | 增量 re-export 两常量（既有导出一字不动） | 设计 §7 |
| `apps/yjs-server/src/diagnostic-replay.ts` | 头注五条件措辞随语义收紧同步（K-4/N-C——fatal-committed-unknown/effect 缺席不再推进）；`DiagnosticReplayReadSessionOptions`/`readSession?` 请求增量；locator 成功后自开 session（open 非法供参 throw → 顶层 catch 收敛 `failed`+`replay-internal-error`，K-3/N-B 零新码）→ 内层 try/finally 恒 close（INV-227-8）；`readStreamStrict({...strictRequest, session})` 全程持约；④ 重写为 materialize switch 唯一分类源（app 侧 committed/hasUpdateCarrier 推导整体删除——包边界纪律强化）：连续性复核先于物化/omitted（N-1 翻转）、物化前续租检查点（`lease-expired`）、`update`→apply（undecodable→break）/`omitted`→`update-omitted`+break/`unknown`→`update-unknown`+break（INV-227-6）/`none`→genesisSeen 时推进/`invalid`→m.code+break；complete 门表达式逐字保留（INV-227-7） | 设计 §3.4/§4.3/§5/INV-227-5/6/7/8、K-2/K-3/K-4 |
| `apps/yjs-server/src/index.ts` | 增量 re-export `DiagnosticReplayReadSessionOptions` | 增量导出 |
| `packages/namespace-diagnostic-log/AGENTS.md`、`README.md` | #227 增量段（reader 自持约/sweep S0′+P0 门/materialize unknown 成员/词表恰四新码）；README 示例改传 session + orphan-BIN 租约门 + N-3 报告说明 | 设计 §5 文档义务 |

CONTEXT.md：无词表演进可备案（零新 reason、零 health 事件成员、词汇均为包/工具局部；
#154/#155 先例同样未触碰 CONTEXT.md——亲证 CONTEXT.md 自 8a58aec 起未变）→ 不改，理由如上。

## 2. 关键实现决策与实现期发现

- **D3 首版实现缺陷（自发现并修复）**：materialize switch 的终止分支用裸 `break` 只退出
  switch、不退出 entry 循环 → D3（fatal-unknown 后接 update）实测 issues
  `[update-unknown, sequence-gap]`（后续 update 的连续性复核误命中）。修复：`entryLoop:`
  标签循环 + 终止分支 `break entryLoop`；同 class 隐患一并修复 `update-undecodable`
  catch 分支（switch 内裸 break 会继续处理后续 entry）。修复后 D1..D9/K-3 全绿。
- **reader 恒释放结构**：readStreamStrict 的函数级 `ownedSession` + ⑦（聚合前）与 ⑧
  （catch）两处 close——同步函数内 ④′ 之后仅 ⑦ 两 return 与异常逃逸三条出口，注释成文
  防后续维护者新增 return 漏关（INV-227-1 异常臂）。A5 双用例以「自租约读后 0/0 sweep
  立即删 3 闭组 + 重复读零累积」可观测证明零泄漏。
- **materialize 谓词次序**：`update-omitted` → omitted 分支无条件（不查 kind/committed——
  K-2 翻转依赖）；`update` ∧（committed ∨ fatal-committed:true）→ carrier；其余
  `fatal∧committed:true` → unknown（字面 'unknown' 与 effect 缺席同归）；余 → none
  （R-4 残差 `fatal∧committed:false∧effect:'update'` 维持 #155 推进——G-227-2 裁定兑现）。
- **零回退面论证**：无 session 自租约路径的快照与旧裸枚举同源同值（open 即枚举，无
  await 面）；检查点仅每段一次 `now()` 比较（真实时钟下恒过）；vanished 判定只在 jsonl
  ENOENT 罕见分支、且旧豁免矩阵（bin 在 ∧ marker 不在）逐字保留 → 既有 259+ 测试文件
  预期零行为漂移（实测全量绿佐证）。

## 3. 验证命令与结果（全部本机实跑）

```bash
# 1) SA6 §2 定向契约（6 文件并跑）——首次 1 红（D3，见 §2 修复）→ 修复后全绿：
NODE_OPTIONS=--conditions=nomicore-source ./node_modules/.bin/vitest run \
  packages/namespace-diagnostic-log/test/strict-reader-lease.test.ts \
  packages/namespace-diagnostic-log/test/file-adapter-retention-lease-gate.test.ts \
  packages/namespace-diagnostic-log/test/strict-reader-materialize-unknown.test.ts \
  packages/namespace-diagnostic-log/test/file-adapter-read-session.test.ts \
  apps/yjs-server/test/diagnostic-replay-lease-completeness-red.test.ts \
  apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts
# → 5 passed（含 68 用例中的 67）+ D3 单红修复后复跑：
#   vitest run apps/yjs-server/test/diagnostic-replay-lease-completeness-red.test.ts
#   → 18 passed / 18（D1 bounded/unbounded、D2 恒释放、D3/D4a-d/D5/D6a-b/D7/D8/D9/K-3a-b 全绿）

# 2) K-1（SA7 重点 4 改写 pin）：
NODE_OPTIONS=--conditions=nomicore-source ./node_modules/.bin/vitest run \
  apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts -t "重点 4"
# → 1 passed | 5 skipped（partial + update-unknown + lastSeq '2' + count=5 前缀态）

# 3) 包级零回退全量：
NODE_OPTIONS=--conditions=nomicore-source ./node_modules/.bin/vitest run packages/namespace-diagnostic-log
# → Test Files 30 passed (30) / Tests 448 passed (448) / Type Errors no errors

# 4) 单包 typecheck ×2（包/应用）与根 typecheck：
pnpm exec tsc -p packages/namespace-diagnostic-log/tsconfig.json --noEmit   # exit 0
pnpm exec tsc -p apps/yjs-server/tsconfig.json --noEmit                     # exit 0
pnpm typecheck                                                              # exit 0（全部 14 个 tsconfig）

# 5) 全量根测试（完成定义 pnpm typecheck && pnpm test）：
pnpm test     # 结果见 §4（vitest run --typecheck，maxWorkers 1）
```

## 4. 全量结果

（全量 `pnpm test` 输出尾部摘要——见本文件附录更新行；退出码 0 = 完成定义达成。
若附录未更新则以上一轮 30 文件/448 用例包级 + 定向 6 文件 68 用例 + K-1 的绿结果为
本轮局部证据，最终以总控亲跑/SA7 复核为准。）

### 附录（最终全量运行，2026-09-06）

```text
Test Files  264 passed (264)
     Tests  2906 passed (2906)
Type Errors  no errors
Duration  382.65s（vitest run --typecheck，maxWorkers 1）
test-exit=0
```

- `pnpm typecheck` → exit 0（全部 14 个 tsconfig 顺序通过）。
- 完成定义（设计 §9：`pnpm typecheck && pnpm test` exit 0、`git diff` 不含 DENY 路径）
  **达成**。
- DENY 路径审计（§0.3）：`git status` 改动面 = ALLOW 白名单十文件（src 六 +
  app src 二 + 包 AGENTS.md/README + SA6 已改的 sa7 测试）+ SA3 本证据文件；
  `schema.ts` / `record.ts` / `emission.ts` / `pipeline.ts` / `sink.ts` /
  `adapters/memory.ts` / 删除协议步序 / `analyzeStreamForResume` 零触碰（亲证
  `git diff --stat` 无上述路径）。

## 5. 残余与移交

- 无已知残余阻断；R-1..R-7 风险处置按设计 §10（vanished/检查点在单线程同步下结构性
  不可达——A3/A2 用例以公共 API 步进交错构造可测面，SA6 已落地）。
- 移交 SA4 静态复审：INV-227-1..10 逐条对照本文件 §1 锚点列。
- 移交 SA7：§3 命令 1/2 复跑 + `pnpm typecheck && pnpm test` 全量（含本批新文件）。
- 注意事项：本 change 未 commit/push（归总控 finalize）；SA6 已按 K-1 同 change 改写
  sa7.test.ts 重点 4 pin（工作树内既有未提交改动，本实现轮未触碰该文件语义）。
