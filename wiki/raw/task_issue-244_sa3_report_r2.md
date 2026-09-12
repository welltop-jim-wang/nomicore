# SA3 实现报告（iteration 2）— issue #244：SA4-2 收口——跨字段链生效门放宽为双激活键（分块族链上键显式表达门）

- Dispatch（本 iteration）：`sa-3d23be4d-34ac-4869-af41-09ed8e606c43`（mabf-sa3 / implementation / iteration 2）——Issue #244：implement the approved SA4-2 repair；SA6 iteration-1 红灯守卫 `{maxChunksPerUpdate: 4}` + 缺省必须在 hub/peer 双入口构造期 TypeError（链②）；保持 N5/N6 非追溯边界；验证触发条件 = 显式 `maxChunkedUpdateBytes` **或** `maxChunksPerUpdate` 激活合并值链校验；不弱化 14 用例验收契约、不回退 SA4-1 槽位生命周期修复。REST `[]` 零 owner 要求。
- 依据：SA1 修订设计 `wiki/raw/task_issue-244_design.md`（iteration 1，§7-D1 边界语义表 + §7-D8 第 1 条 + §11 ★ 行 + §12 顺序）；SA8 设计修订复审 clear（`artifacts/sa8-conflict-gate-issue-244-design-recheck.md`：R15/R18 归实现轮与 SA6/owner，已就绪）；SA6 契约补例已落笔（14 用例，`artifacts/sa6-issue244-iter1-verify.log`：R1c 现行单键门下红 ×3 确定性）。
- 结果：**SA4-2 修复完成**——两构造器门条件由单键（仅 `maxChunkedUpdateBytes`）放宽为双激活键（`maxChunkedUpdateBytes` ∨ `maxChunksPerUpdate`），对合并结果校验链①②不变；**契约 14/14 绿**（R1c 红→绿，R1a/R1b/N1 + N5/N6 保持绿）、REG 3/3 绿、全包 62 文件/451 测试绿、包 tsc + 根 tsc（14 项目）+ 根 `pnpm test`（300 文件/3214 测试）exit 0。
- 验证留痕：`artifacts/sa3-issue244-iter2-verify.log`（逐命令输出）。

## 1. 本 iteration 改动（SA4-2 修复面，设计 §11 ★ 四行）

| 文件 | 位置 | 改动 |
|---|---|---|
| `packages/ws-replication/src/hub-connection.ts` | `HubReplicationImpl` 构造器链门（L197-205） | 门条件 `hasOwnProperty('maxChunkedUpdateBytes')` → `hasOwnProperty('maxChunkedUpdateBytes') || hasOwnProperty('maxChunksPerUpdate')`；注释改 SA4-2 双键门口径（含 R1c 算术 4MiB > 4×512KiB 与缺省自洽 4MiB ≤ 4MiB ∧ ≤ 32MiB 引注） |
| `packages/ws-replication/src/peer-connection.ts` | `PeerConnectionImpl` 构造器链门（L113-121） | 同上（对称） |
| `packages/ws-replication/src/validate.ts` | `validateChunkedTransferChain` 函数头注释「调用契约」段 | 单键 → 双键（分块族链上键显式表达门；非追溯性 N5/激活键集闭合 N6 注记）；**纯注释，零行为变化** |
| `docs/protocols/instance-replication-v1.md` | §17 配置清单与校验链块后注记（L569） | 口径句改双激活键（设计 §7-D8 第 1 条逐字规格）：「显式配置 `maxChunkedUpdateBytes` **或** `maxChunksPerUpdate`（两链不等式的分块族操作数键）时响亮生效；…（非追溯性）」 |

校验对象不变：`validateChunkedTransferChain` 恒对 **resolved 合并结果**判定链①（≤ `maxQueuedUpdateBytes`）与链②（≤ `maxChunksPerUpdate × maxUpdateBytes`）；值门（`validateLimits`）无条件且先于链（构造器既有调用序）；零运行时 clamp；plugin 路径（`mergeNested` 保留用户 Partial → 构造器内 `options.limits` 即用户表达键集）自动对称，零改动（设计 §7-D1）。

**DENY 面零触碰**：SA6 契约文件 `ws-replication-issue244-ac-red.test.ts`（14 用例文件一字未动）、issue243/233 套件、`replication-protocol/**`、`update-channel.ts`、`docs/adr/**`、`CONTEXT.md`、`apps/**`、`src/index.ts`、`test/harness.ts`。SA4-1 槽位生命周期实现（hub-namespace.ts:721 / peer-namespace.ts:704 置位 + 归还闭环）零改动。

## 2. Changed paths（本 iteration，worktree-relative）

1. `packages/ws-replication/src/hub-connection.ts` — 门放宽（注释 + 条件）
2. `packages/ws-replication/src/peer-connection.ts` — 门放宽（注释 + 条件）
3. `packages/ws-replication/src/validate.ts` — 链校验函数头注释改双键口径（行为零变化）
4. `docs/protocols/instance-replication-v1.md` — §17 链生效口径注记改双激活键
5. `artifacts/sa3-issue244-iter2-verify.log` — 本 iteration 验证留痕（新增）
6. `wiki/raw/task_issue-244_sa3_report_r2.md` — 本报告（新增）

（iteration 0/1 的既有实现面与文档面未触碰。）

## 3. Verification（本 iteration；逐命令输出见 artifacts 日志）

| 门 | 命令 | 结果 |
|---|---|---|
| 修复前红基线（自证） | `vitest run packages/ws-replication/test/ws-replication-issue244-ac-red.test.ts` | 1 failed（R1c：hub 入口不抛 TypeError）\| 13 passed（14）；Type Errors no errors —— 与 SA6 记录一致 |
| 契约（修复后） | 同上 | **14/14 passed**（R1c hub+peer 双入口均 TypeError；R1a/R1b/N1–N4 + N5/N6 全绿） |
| SA4-1 回归 | `vitest run …ws-replication-issue244-slot-reclaim-regression.test.ts` | 3/3 passed（REG1–REG3，无回退） |
| 确定性 | 契约+回归 ×3 连续 | 3× 17/17 passed |
| 全包回归 | `vitest run packages/ws-replication/test` | 62 files / 451 tests passed（零存量绿面翻转） |
| 包类型面 | `pnpm exec tsc -p packages/ws-replication/tsconfig.json` | exit 0 |
| 根类型面 | `pnpm typecheck`（14 项目） | exit 0 |
| 根测试面 | `pnpm test`（vitest --typecheck 全仓） | 300 files / 3214 tests passed；exit 0 |
| 卫生 | `git diff --check` + 单键措辞扫描 | exit 0；src/协议文档零残留单键口径 |

## 4. Deviations or blockers

无阻塞、无偏离。契约补例（R1c/N5/N6）为 SA6 落笔，本轮零触碰（DENY）；SA4-2 剩余联动（§17 注记）已按设计 §7-D8 第 1 条随门放宽同轮落地，R16/R17 就绪注意项随本报告内容落笔完成。
