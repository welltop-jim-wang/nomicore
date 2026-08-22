# SA3 实现报告 — task_issue-79（Persistence：DocHandle entry status 与 degraded 期间 dirty registration）

- 实施者：SA3（TDD Executor），2026-08-22
- 依据：`wiki/raw/task_issue-79_design.md`（SA1 设计 R1，SA2 verdict: pass）+ `task_issue-79_sa2_review.md`（R2 复审 LOW 残留措辞顺带更正）+ `task_issue-79_design_conflict_report.md`（SA8 verdict: clear）
- 实施范围：严格按设计 §11 ALLOW LIST（含 R1 追加 3 项）；DENY LIST 零触碰

## 一、改动文件清单（15 个，均在设计 ALLOW LIST 内）

### 生产代码（6 个）

| 文件 | 改动 | 对应设计 |
|---|---|---|
| `packages/persistence/src/contract.ts` | 新增 `DocHandleStatus` 类型（冻结词表 4 态）；`DocHandle` 接口追加 `getStatus(): DocHandleStatus` 成员（纯增量，既有成员零改动） | §2.1 |
| `packages/persistence/src/lifecycle.ts` | `PersistenceHandle.getStatus()` 委托 + `PersistenceLifecycle.handleStatusOf()`（closed→released→entry 优先级；不可达分支 loud throw 不静默降级）；**删 saveDoc degraded throw**（§3.2）；**删 seedForTest degraded throw**（§3.3）；`scheduleFlush` 增加 retryTimer guard（单一调度器纪律，§3.4） | §3 |
| `packages/persistence/src/index.ts` | 追加导出 `type DocHandleStatus`（纯增量） | §2.1 |
| `packages/dsh-persistence/src/events.ts` | `write-rejected` → `save-degraded` 联合成员 + 注释词表 | §4.1 |
| `packages/dsh-persistence/src/record.ts` | 渲染分支 `save-degraded` | §4.1 |
| `packages/dsh-persistence/src/probe.ts` | S4 哨兵重写：entry 级 `h6.getStatus()==='persistence-degraded'` 断言 + degraded 窗口 `saveDoc` resolve 即契约（reject → scenario-error loud）+ 哨兵 resolve 后递增 savedByKey（决策 C）+ emit `save-degraded`；`saveAndEmit` 返回探针 generation；恢复腿 `observeFlush` 改用返回值（§4.3，两通道皆准） | §4.2/§4.3 |

### 测试（6 个，均按 §5 处置或 R1 授权锚点）

| 文件 | 改动 |
|---|---|
| `packages/persistence/test/memory-persistence.test.ts` | L307/L350：`rejects.toThrow(/persistence-degraded/)` → `getStatus()` 状态断言 + `resolves`；L320 用例标题「keeps writes rejected」→「registers dirty writes」 |
| `packages/persistence/test/file-persistence-sa7-dynamic.test.ts` | L188/L207：断言反转（degraded 状态 + saveDoc resolve）；L189：`createFileHandleForTest` 从 rejects 改为 resolve 并断言 twin degraded 后 release；Coverage 1/3 注释与标题同步（rejected → degraded） |
| `packages/dsh-persistence/test/dsh-profile-acceptance.test.ts` | L349-371：标题/变量/事件断言 `write-rejected` → `save-degraded`；**追加 3 条 record 精确断言**（`flush doc-degraded generation=2 ok=true` / `dirty doc-degraded generation=3` / `flush doc-degraded generation=3 ok=true`，钉死决策 C 与 §4.3）；L392/L421：断言反转 + `handle.getStatus()` 状态断言；两处 service 级标题同步 |
| `packages/dsh-persistence/test/dsh-probe-cli.test.ts` | L105-112：标题与 L110 断言改 `save-degraded`；L11 注释词表同步；L108/L109/L111 三条断言不变 |
| `packages/persistence/test/persistence-contract.test.ts` | L122 `DocHandle` 类型标注字面量补 `getStatus() { return 'ready' }` + 追加 `expect(handle.getStatus()).toBe('ready')` 行为断言（SA2 R1 #1 CRITICAL：否则 CI typecheck TS2741 必红） |
| `packages/persistence/test/issue-79-file-entry-status.test.ts` | **[SA6 owned]** AC3 retry 成功后、fresh 实例块与任何 release 前插入单一调度器纪律锚点 `expect(timer.pending).toBe(0)`（设计 §3.4/§5 R1 授权；既有断言零改动，L159 原样保留） |

SA6 两个红灯文件（`issue-79-entry-status.test.ts` 6 用例 / `issue-79-file-entry-status.test.ts` 2 用例）的既有断言**零改动**，全部转绿。

### 文档与版本（3 个）

| 文件 | 改动 |
|---|---|
| `docs/adr/0006-server-persistence-docstore.md` | 文末（「supersede 裁决撤销」节之后）追加修订节：**「DocHandle entry status 与 saveDoc 职责修订（2026-08-22，issue #79；演进经 owner 裁决放行——issue #79 AC1/AC8 明文授权）」**，全文按设计 §6 草案（接口契约追加 getStatus / saveDoc 职责边界 / 实施注记） |
| `packages/persistence/package.json` | version 0.1.2 → **0.1.3**（硬门禁 #9） |
| `packages/dsh-persistence/package.json` | version 0.1.0 → **0.1.1**（硬门禁 #9） |

### 设计文本顺带更正（1 个）

| 文件 | 改动 |
|---|---|
| `wiki/raw/task_issue-79_design.md` | L292 判别力句按 SA2 R2 复审 LOW 残留建议更正：「漏做决策 C → 第二/三条断言红（第一条空转命中恢复腿属已知盲区）；漏做 §4.3 → memory 通道 record 不变、本组断言不判别——残余风险由第三条断言与决策 C 锚点联合覆盖；彻底钉死须补 file n≥1 探针断言（后续任务）」；n=0 `events=28` 安全句保留 |

## 二、验证输出摘要（worktree 根执行，全部通过）

1. **目标套件**：`npx vitest run packages/persistence packages/dsh-persistence`
   ```
   Test Files  12 passed (12)
        Tests  92 passed (92)
   Type Errors  no errors
   ```
   含 8 条 issue-79 红灯转绿（issue-79-entry-status 6 + issue-79-file-entry-status 2，其中 file 含新增 pending=0 锚点）；dsh 钉死值安全：`dsh-file-probe-determinism.test.ts`（n=0 `events=28`）绿、`dsh-probe-cli.test.ts`（CLI 子进程 n=1）绿、`dsh-profile-acceptance.test.ts` 10/10 绿（含 AC4 三条新 record 精确断言）。

2. **类型检查**：`pnpm typecheck` → exit 0（vfsl / vfsl-protocol / vfsl-codegen / persistence / dsh-persistence 五包 tsc 全部通过，persistence-contract 字面量 TS2741 消除）。

3. **全仓**：`pnpm test`（= `vitest run --typecheck`）
   ```
   Test Files  51 passed (51)
        Tests  712 passed (712)
   Type Errors  no errors
   ```

## 三、实施要点确认

- 生产代码无任何 env-override / fallback 软兜底（SKILL 禁令 1 合规）；`handleStatusOf` 不可达分支 loud throw（不静默降级）。
- `memory.ts` / `file.ts` / `testing.ts` / `profile.ts` / `cli.ts` / `clock.ts` / `dsh index.ts` / `dsh-file-probe-determinism.test.ts` 等 DENY LIST 文件零改动。
- git commit 由总控统一收尾；本报告仅落盘工作树改动。
