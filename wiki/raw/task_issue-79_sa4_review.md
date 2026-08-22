# SA4 静态验尸报告 — task_issue-79（Persistence：DocHandle entry status 与 degraded 期间 dirty registration）

**Date**: 2026-08-22
**Verdict**: **pass**

- 被审对象：当前工作树未提交改动（`git diff HEAD`，16 个实现文件 + wiki 档案）；基线 HEAD=6531b09（branch `fix/issue-79-on-docs-doc-runtime-validation` ← `docs/doc-runtime-validation`）
- 依据：设计 R1（`wiki/raw/task_issue-79_design.md`，SA2 R2 verdict: pass）、SA3 实现摘要（`task_issue-79_sa3_impl.md`）、ADR 基准（`task_issue-79_relevant_decisions.md`）、SA2 R2 复审节（含实验 A–D 判别力记录）
- 方法：静态验尸（逐 hunk 对照设计代码块 + 状态机不变式独立重推 + 全仓 caller/词表 grep）+ 独立进程复跑目标套件与全量 typecheck（不修改任何生产代码）

---

## 一、强制检查项结论

### 1. 硬门禁 #14 → §1.4 vitest 触发性自检：✅ 通过

本任务新增/改动 7 个 `*.test.ts`（含 2 个 SA6 红灯文件），全部落在 `packages/persistence/test/` 与 `packages/dsh-persistence/test/`。CI 触发链核验（`.github/workflows/ci.yml` + `vitest.config.ts` + 根 `package.json`）：

| 测试文件 | 所在 package | 触发 job/步骤 | 证据 |
|---|---|---|---|
| 全部 7 个改动测试文件 | `@nomicore/persistence`、`@nomicore/dsh-persistence` | `test` job 的 `Test` 步骤（`pnpm test` = `vitest run --typecheck`），Node 20/24 矩阵 | `vitest.config.ts` include=`packages/*/test/**/*.test.ts` 通配两包全部测试文件；两包 tsconfig `include: ["src/**/*.ts", "test/**/*.ts"]` 被 `Typecheck` 步骤（`pnpm typecheck` 五包链）覆盖 |
| `persistence-contract.test.ts`（结构义务面） | `@nomicore/persistence` | 额外显式步骤 `Persistence contracts`（L44，`--passWithNoTests=false`） | 双保险：单独步骤 + typecheck |

无「测试存在但从未被 CI 触发」的黑洞。SA7 动态阶段须从 `gh run view --log` 摘录 Node 20/24 两次矩阵运行中 issue-79 两文件的触发证据。

### 2. 硬门禁 §9 → §1.5 协议假设审查：✅ 通过

设计 §9 存在且声明「无协议级假设」——与实现事实一致：本任务纯进程内 TS 接口扩展与调度逻辑（timer 走既有 `PersistenceTimer` 注入面），无 HTTP/WS/端口/跨进程资源/第三方库行为假设，无「应该/通常/预计」类无据推断。两项测试机械学前提的证据锚点核验属实：

| 假设 | 声明依据 | SA4 复核 |
|---|---|---|
| chmod 0o500 目录上 `writeFile` EACCES | 既有绿灯 `file-persistence-sa7-dynamic.test.ts` 同款注入法 | ✅ 该文件 L162 `chmodSync(bobDir, 0o500)`（基线分支即绿，CI 先例成立）；新测试 `issue-79-file-entry-status.test.ts:98` 逐字同款 |
| ManualTimer 插入序确定性（fireOldest=最低 id 先火） | 既有 ManualTimer 绿灯依赖 | ✅ 同款类复制于 `issue-79-file-entry-status.test.ts:58-76`；`fireOldest()` 对空表 loud throw，无静默吞 |

（SA2 R1/R2 已对设计文本做过实测核验；本节为 SA4 侧的锚点存在性复核，无 mismatch。）

### 3. 硬门禁 #9 → 版本 bump：✅ 落实

- `packages/persistence/package.json`：`0.1.2` → **`0.1.3`**（diff 实证）
- `packages/dsh-persistence/package.json`：`0.1.0` → **`0.1.1`**（diff 实证）

两处均为 version 字段单行改动，无其他字段夹带。

### 4. §11 ALLOW/DENY 核验 → §1.1 Scope Creep Guard：✅ 零越界（附 1 条 LOW 形式性备注）

机械比对（`git diff HEAD --name-only` 去除 wiki 白名单后 16 文件 vs 设计 §11 ALLOW LIST 14 条）：

- **ALLOW 全命中**：14 条 ALLOW 文件全部出现在 diff 中（无遗漏实现项），逐文件 diff 与设计章节逐 hunk 吻合（见 §二）。
- **ALLOW 之外仅 2 项**：`packages/persistence/package.json`、`packages/dsh-persistence/package.json`——设计 §11 未列，但系 dispatch #9（「须 bump persistence + dsh-persistence patch 版本」）与本审查强制检查项 #3 明文要求的硬门禁产物，改动内容恰为规定的版本号。**实质性授权成立，不判 scope-creep**。
- **DENY LIST 零触碰**：`memory.ts`/`file.ts`/`testing.ts`/`profile.ts`/`cli.ts`/`clock.ts`/dsh `index.ts`/`dsh-file-probe-determinism.test.ts`/`sa7-supplementary`/`core-dsh-boundary`/`module-graph-regression`/`file-persistence.test.ts`/`CONTEXT.md`/`.github/**` 均 `git diff --stat` 为空（实证）。
- **BLACKLIST 零命中**：无 `package-lock.json`/`yarn.lock`/`.DS_Store`/`TASK.md`/`*.bak`。

> **LOW 备注 N1（记录，非阻塞）**：设计 §11 ALLOW LIST 未登记两个 package.json（dispatch #9 的版本 bump 指令晚于设计定稿）。属设计文件清单的形式性缺口，实质改动与总控指令逐字一致。建议后续任务设计在收到 dispatch 版本 bump 指令时同步扩展 ALLOW LIST，避免 SA4 机械比对出现名义越界。

**SA6 两红灯文件核查（重点）**：

| 文件 | 核查结果 |
|---|---|
| `issue-79-entry-status.test.ts` | `git diff`（staged→worktree）**零改动**——SA3 完全未触碰，SA6 交付原样转绿 ✅ |
| `issue-79-file-entry-status.test.ts` | 唯一改动 = 设计 §3.4/§5 R1 授权的单一调度器锚点（5 行：注释 + `expect(timer.pending).toBe(0)`），插入位置精确符合授权（L146 retry 成功 `ready` 断言之后、fresh 实例块与任何 release 之前）；既有断言零改动——release 后的既有 pending 断言原样保留（现 L164）✅ |

### 5. ADR 0006 修订节一致性 + 状态词表冻结：✅ 逐字一致

- 修订节（ADR L167 起）与设计 §6 草案**逐字比对一致**：节标题（含「演进经 owner 裁决放行——issue #79 AC1/AC8 明文授权」放行措辞）、增量演进引言、接口代码块、三条状态语义 bullet、saveDoc 职责四条 bullet（含「任一**可观察**时刻」+ catch→finally 瞬态并存说明）、实施注记。
- **落点正确**：追加于文末「createDoc 与 owner 语义修订」节第 4 条「supersede 裁决撤销」之后（grep + sed 实证）。
- **状态词表冻结措辞一致**：`'ready' | 'persistence-degraded' | 'released' | 'disposed'` 与优先级「`disposed` > `released` > entry 状态」在 contract.ts（§2.1）、ADR 修订节、relevant_decisions 索引三处逐字一致；`ready` 含 flush 在途、`persistence-degraded` =「最近一次 flush 失败且尚未 retry 成功」措辞冻结。

---

## 二、审核结论（九项清单）

1. **设计一致性**：✅ 一致。生产代码 6 文件逐 hunk 对照设计 §2.1/§3.1–§3.4/§4.1–§4.3 代码块逐字吻合（含注释）；测试 6 文件与 §5 处置表（含 R1 追加 3 项）逐条对应；ADR 修订节 = §6 全文。`handleStatusOf` 优先级序、`saveDoc` 判定顺序（disposed→身份→登记）、`seedForTest` 收窄、`scheduleFlush` retry guard 与设计完全一致。无偏离项。
2. **读写路径一致性**：✅ 一致。`getStatus()` 读的正是 flush/retry 在 lifecycle core 内变更的同一 `LiveEntry.degraded`（单一事实源）；两 Adapter 零改动（DENY 守住），无聚合/entry 双源分叉；探针 S4 观察面（entry 级 `h6.getStatus()` + degraded 窗口 saveDoc resolve）与内核状态同源。
3. **静默失败**：✅ 无。degraded 窗口 saveDoc 有可观察效果（dirtyGeneration 递增 + retry 承接）；`handleStatusOf` 不可达分支 loud throw（`persistence integrity: …`），不静默降级；探针哨兵两个回归方向（内核回退拒绝 / entry 状态错答）均 loud（ProbeFailure / scenario-error:S4-degradation）；`scheduleFlush` 的 retry guard 提前 return 不是失败路径（retry 即调度器，设计 §3.4 已论证且锚点钉进 CI）。
4. **降级方案**：✅ 安全。本任务未引入任何 env-override / fallback 软兜底（SA3 报告声明属实，diff 复核无此类代码）；唯一「降级样式」代码是 integrity loud throw——方向正确（响亮失败）。
5. **极端攻击**：✅ 安全（静态）。E1–E14 逐条独立重推：flush 在途=ready（degraded 仅 catch 翻转）；twin handle 同 entry 同状态；released→dispose 后报 disposed（closed 先判）；degraded+dirty entry 不可驱逐（maybeEvict 三重门：handles/flushing/saved≠dirty）；degraded 窗口 dispose 清 retryTimer；retry 再失败退避 ×2 cap maxDirtyMs；retry 在途 saveDoc 由 finally 重排承接（`retryTimer===undefined` 条件与新 guard 自洽）。`handleStatusOf` 不变式论证独立复核成立：entry 移除仅三条路径（maybeEvict 要求 handles.size===0 / dispose 先置 closed / reading-creating 清理无 handle），unreleased+open+无 live entry 确不可达，loud throw 分支为纯 integrity 防线。锚点判别力算术独立重算：无 guard 时 degraded saveDoc 武装 maxDirty+debounce 对（锚点处 pending=2），有 guard 时 pending=0——与 SA2 实验 B 实测一致。
6. **错误处理**：✅ 完整。AC6 四类非 degraded 拒绝（foreign/伪造/released/disposed）判定顺序不变且全部有测试锚（`issue-79-entry-status.test.ts:302-319`）；探针 `saveAndEmit` 意外失败仍冒泡 scenario-error。
7. **架构评估**：✅ 可行。状态机单点收敛于 lifecycle core 保持（Adapter 零改动）；无绕过、无 FIXME、无临时补丁；不触发退回 SA1 信号。
8. **过度设计**：✅ 精简。生产代码净变更约 +60 行（1 类型 + 1接口成员 + 2方法 + 删2 throw + 1 guard + 探针适配），与设计「最小变更半径」声明一致；无投机抽象。
9. **测试行为质量（§1.7 源码 GREP 断言禁令）**：✅ 合规。改动测试文件反模式扫描的 2 个启发式命中均为**误报**（`dsh-probe-cli.test.ts:128` 读 package.json 断言 scripts 存在；`dsh-profile-acceptance.test.ts:468` 读运行时落盘快照做 Y.applyUpdate 行为断言）——两处均非「读 .ts 源码字符串做 toMatch/toContain 断言」，且均非本次改动行。全部新增/反转断言锚定运行时行为（resolve/reject、状态返回值、磁盘可见性、record 输出）。

### 契约改动连锁（§1.6 caller ripple）补记

唯一契约变化 = saveDoc 在 degraded 路径 throw→resolve（**只删 throw，无新增 throw 路径**，无同步变异步、无返回类型翻转）。全仓 `saveDoc(` caller 穷举复核：生产透传 2 处（memory.ts:76 / file.ts:70，未改动）；`testing.ts` 契约套件全部健康 entry 调用 + 跨 Adapter foreign 拒绝断言（不依赖被删 throw）；探针 2 处（已按 §4.2/§4.3 重写）；测试 5 文件（已按 §5 反转）。**全仓 `write-rejected` 残留引用为零**（grep apps/packages/domains/tests/docs，wiki 任务档案除外）。apps/ 无消费者（§0 结论复核成立），无生产 P0 面。

---

## 三、LOW 级备注（非阻塞，供后续任务）

- **N1**：设计 §11 ALLOW LIST 未含两个 package.json（见 §一.4）——dispatch #9 晚于设计的形式性缺口，建议后续设计同步登记。
- **N2**：`probe.ts:128` 注释「被拒的 saveDoc 从未进入计数（决策 C）」措辞源自旧契约语境；新契约下 degraded 窗口 saveDoc 不再被拒，计数规则实质（仅 resolve 的 saveDoc 计数）仍准确。纯注释措辞，可在下次触碰该文件时顺带更新。
- **N3（承接 SA2 R2 残留）**：§4.3 返回值路径在 memory 通道 record 上无判别力（实验 D：漏做 §4.3 全绿）——已知盲区，实质风险由第三条断言（恢复 flush 存在性）+ 决策 C 锚点联合覆盖；彻底钉死需 file n≥1 探针 record 断言，属后续任务。

---

## 四、验证证据（SA4 独立复跑）

1. 目标套件（独立进程，worktree 根）：
   `npx vitest run packages/persistence packages/dsh-persistence`
   → `Test Files 12 passed (12)` / `Tests 92 passed (92)` / `Type Errors no errors` / exit 0
   ——含 issue-79 两文件 8 用例转绿（file 含新 pending=0 锚点）、`dsh-file-probe-determinism`（n=0 `events=28` 钉死值）绿、`dsh-probe-cli` 7/7 绿（真实 CLI 子进程 n≥1，SA2 /tmp 实验无法覆盖的面）、三条 generation record 钉死断言绿。
2. 全量类型检查：`pnpm typecheck` → exit 0（五包 tsc 链，含 persistence/dsh-persistence 两包 tsconfig 覆盖 test/**，persistence-contract 结构义务 TS2741 消除）。
3. Scope 比对：`git diff HEAD --name-only`（去 wiki）16 文件 vs ALLOW 14 → 差集恰为两个授权 package.json；DENY 文件 `git diff --stat` 全空；BLACKLIST grep 零命中。
4. 词表残留：`grep -rn "write-rejected"` 全仓（除 wiki 档案）零命中。

（总控 15:13 已独立复验全仓 `pnpm test` 51 文件/712 用例全过；SA4 复跑聚焦受影响两包 + typecheck，与总控结果互证。）

---

## 五、动态审核重点（交 SA7）

1. **CI 触发证据摘录**：从 `gh run view --log` 确认 Node 20 与 24 两次矩阵运行中 `issue-79-entry-status.test.ts`（6）与 `issue-79-file-entry-status.test.ts`（2）确实执行且绿（§1.4 静态结论的动态确认）。
2. **EACCES 注入在 ubuntu-latest 的行为**：chmod 0o500 目录 `writeFile` 在 CI runner（非 root）上同样以 EACCES 失败——本地复跑已绿，但需 CI 实跑日志确认（既有同款测试绿灯为强先例）。
3. **真实时钟测试的 runner 时延敏感性**：`issue-79-file-entry-status.test.ts` 的 `waitFor` 轮询上界 400×5ms=2s、Memory AC7 `withTimeout` 2s——慢 runner 上观察 CI 时长是否逼近上限（flake 风险，非正确性风险）。
4. **CLI 子进程 n≥1 时间线**：`dsh-probe-cli` AC4（n=1）在 CI 子进程环境的 `save-degraded`/generation 序列与本地一致。
5. **探针 S4 两条回归腿的动态复核**（可选加强）：临时回退内核 guard/决策 C 验证锚点在真实 CI 环境爆红（SA2 实验 B/C 已在 /tmp 端态证复现，静态算术亦吻合；仅在有疑点时执行）。
