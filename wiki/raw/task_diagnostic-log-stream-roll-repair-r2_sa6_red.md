# SA6 红灯重锚报告 — Issue #153 Round 2（PR #166 review High：无引用完整 orphan BIN 尾帧清零）

- repositoryId: nomicore / issue: 153 / round: 2（发布后修订轮，缺陷修复轮）
- worktree: /home/wangjian/nomicore-fix-issue-153
- 权威输入：`wiki/raw/task_diagnostic-log-stream-roll-repair-r2.md`（简报）+ `wiki/raw/task_diagnostic-log-stream-roll-repair_round2_feedback.md`（Round 2 验收契约 1–4）+ `wiki/raw/task_diagnostic-log-stream-roll-repair-r2_conflict_report.md`（SA8 R2 门禁 verdict=clear；**O1 备案：锚纠错不得补「防 frame-boundary-invalid」类伪需求断言**——首引用 expectedOffset=null 跳边界检查系既定链语义）
- 权威设计面：`task_diagnostic-log-stream-roll-repair_design.md` §5.2（L224「Refs 为空 → T=0」）/§5.4（L231–251 伪代码与链安全论证）
- 基线：**src 零改动**（round-1 交付态 HEAD 51b79b9；本次仅改 `test/file-adapter-reopen-roll-repair.test.ts`；`git diff --check` 干净；`tsc -p packages/namespace-diagnostic-log` 0 错误）
- 红灯验证命令：`cd /home/wangjian/nomicore-fix-issue-153 && node_modules/.bin/vitest run packages/namespace-diagnostic-log/test`（后台独立进程，无端口依赖）
- 红灯证据日志：`.mabf-bg/sa6-r2-red-run.log`（全包终态）、`.mabf-bg/sa6-r2-reopen-file-run.log`（主文件逐锚）、`/tmp/sa6-r2-baseline.log`（改动前基线 50/50 绿）

**最终红灯统计**：`Test Files 1 failed | 21 passed (22)；Tests 6 failed | 375 passed (381)；Type Errors: no errors；exit=1`。受影响文件仅 `file-adapter-reopen-roll-repair.test.ts`（**6 failed / 46 passed（52）**，两轮复跑一致）。6 项红全部为本轮重锚/新增锚（红因 = src 偏差未修：`reader.ts:1090-1093` 的 `walkCompletePrefixEnd` 例外仍在）；存量其余用例（375 条，含 §13.9/§13.10/窗口2/窗口4/§13.8a-b/§13.12/全部 SA7 repair-io 与 ac/layout/mismatch 等）**零回退**。

---

## 1. 逐锚期望 vs 实测证据表（本轮 6 个红灯锚）

| # | 锚（验收契约） | 文件 · 用例 | 期望（实现后绿态） | 实测（当前 src 51b79b9，红线） | 红因 |
|---|---|---|---|---|---|
| 1 | 契约 1：§13.11 重写——C1+C2 并存（无引用完整 orphan 帧 + 撕裂尾块）→ 两事件两截断；bin 修复后实际长度 = 0；bin 事件 `truncatedBytes = FRAME_BYTES + 7`；jsonl 截到最后 `0x0A` 后断言保持 | `file-adapter-reopen-roll-repair.test.ts` · `§13.11 [红灯·R2]`（:440-471） | bin 事件 `truncatedBytes = 4129`（完整 orphan 帧 4122 + 撕裂尾 7 全部移除）；`binPath.byteLength === 0`；不再有 `truncatedBytes===0` 事件 | `AssertionError: expected 7 to be 4129`——当前实现 `t = walkCompletePrefixEnd(bin) = 4122` 保留完整 orphan 帧，只截 7B 撕裂尾（`truncatedBytes = 4129-4122 = 7`） | src 偏差未修（§5.4 字面 T=0 未落地） |
| 2 | 契约 2（反馈建议 4）：§13.11 修复后的 stream 再 emit 一条 sidecar record → `update.frameOffset === "0"` 且 `readStreamStrict.status === 'ok'` | 同文件 · `§13.11b [红灯·R2，反馈建议 4]`（:473-497） | 修复后 bin=0 → 新帧 fresh-stat 落 0 → `frameOffset === "0"` + reader ok（首引用 expectedOffset=null 豁免；本锚只断 frameOffset 与 reader，O1 合规） | 先于 frameOffset 断言的 `expected 4122 to be +0`——修复构造后 bin 仍 4122B（orphan 帧保留） | 同上 |
| 3 | 契约 2/反馈 ③④ 原样（任务 2 的「refs 空 + 完整 orphan 尾帧」逐字场景）：全完整 C3、修复后 bin 长度 0 + 续写 sidecar `frameOffset="0"` + reader ok | 同文件 · `§13.11c [红灯·R2，反馈 ③④ 原样]`（:499-529） | 恰 1 次 `bin-orphan-frames{truncatedBytes: 4122}`（>0 真实移除量）；bin 长度 0；续写 sidecar `frameOffset === "0"` + reader ok | `AssertionError: expected +0 to be 4122`——当前实现发 `truncatedBytes: 0` 零字节「修复」事件（`t=4122=|B|` 后对全文件无操作） | 同上（零字节不诚实观测） |
| 4 | 契约 4（反馈建议 3 同形）：全 orphan、refs 空、bin 全完整帧——事件照常上报、`truncatedBytes = 真实移除量`（= 完整帧全量），绝不再是 0 | 同文件 · `窗口1`（:1085-1111） | `truncatedBytes === FRAME_BYTES`（4122）且 `binPath.byteLength === 0` | `AssertionError: expected +0 to be 4122`——`truncatedBytes: 0` 事件；bin 4122B 保留 | 同上 |
| 5 | 契约 4（窗口3 同形）：帧完整 + 行撕裂 → C1 + C3 双修复 | 同文件 · `窗口3`（:1133-1155） | bin 事件 `truncatedBytes === FRAME_BYTES` 且 bin 长度 0 | `AssertionError: expected +0 to be 4122` | 同上 |
| 6 | 契约 1/3 同形（§13.32c 对照强化）：jsonl ENOENT + bin 完整帧（refs 空 C3） | 同文件 · `§13.32c`（:1270-1295） | 恰 1 次 `bin-orphan-frames{truncatedBytes: 4122}`；bin 长度 0；续写 seq 1 | `AssertionError: expected +0 to be 4122` | 同上 |

**中断门禁结论**：红灯稳定可复现（主文件 6 红复跑一致；红因全部指向 `reader.ts` 的 `walkCompletePrefixEnd` 例外这一单一偏差；无 fixture 性死锁）——不触发「无法复现」门禁。

## 2. 存量断言零回退证据（反馈契约 3）

全包 381 条测试中 375 条绿；受影响文件仅 `file-adapter-reopen-roll-repair.test.ts` 一个。逐面确认：

| 面 | 断言 | 结论 |
|---|---|---|
| §13.9 / §13.10（有引用 C3/C2+C3，refs 非空 → `T = max ref end`） | 修复后 bin = 4122 / 4122 + 事件 truncatedBytes 常量 | ✅ 绿（不受本轮影响：T 非空分支不动） |
| §13.8a / §13.8b（refs 非空 C2a/C2b） | bin = 4122、frameOffset 链衔接 | ✅ 绿 |
| §13.12（SegMax 种子，bin 10B 撕裂 → refs 空 C2 → T=0） | 2 事件 + 滚段种子 | ✅ 绿（当前与修正后同一 T=0 结果——walkCompletePrefixEnd 对 <25B 纯垃圾返回 0） |
| §13.29 窗口2（10B 撕裂尾，refs 空） | `bin-incomplete-frame` 事件 + 续写 | ✅ 绿（同 §13.12 理由） |
| §13.29 窗口4（行完整 + 帧完整，refs 非空） | 零修复健康续写 | ✅ 绿 |
| `file-adapter-sa7-repair-io.test.ts` 全部 | repair-io-failure 终态（bin 恒等、C-失败事件缺失、权限恢复后修复）——断言的是「截断失败后文件不变」与事件存在性，与被修正的 T 语义无关（fixture 引用路径均为 refs 非空或失败终态） | ✅ 绿 |
| `file-adapter-mismatch-interference` / layout / strict-reader / r2-* / sa7-dynamic 及其余包外文件 | — | ✅ 绿（21 文件全过） |

# 3. 测试改动清单（唯一测试改动文件 `test/file-adapter-reopen-roll-repair.test.ts`，净 +106/-2）

1. **§13.11 重写**（:440）：fixture 不变（jsonl = inline record + 撕裂行 → Refs 空；bin = [完整未引用 orphan 帧][7B 撕裂块]）；断言删旧 `bin === FRAME_BYTES`（round-1 固化偏差），改断 `bin 长度 === 0` + bin 事件 `truncatedBytes === FRAME_BYTES + 7` + jsonl 事件 `truncatedBytes === |partial|` + `jsonl 内容 = line1` 保持 + **新增负向：所有 stream-tail-repaired 事件 truncatedBytes > 0（不存在零字节事件）** + reader ok。
2. **§13.11b 新增**（:473，反馈建议 4）：§13.11 fixture → 修复构造（2 事件 + bin 清零前置断言）→ emit 一条 sidecar record（4097B > 阈值）→ 断言 `sequence='2'`、`storage='sidecar'`、`frameOffset === "0"`、reader ok。**注释按 SA8 O1 勘误口径**（首引用 expectedOffset=null 既定链语义；不补 frame-boundary-invalid 伪需求断言）。
3. **§13.11c 新增**（:499，反馈 ③④ 原样 / 任务「refs 空 + 完整 orphan 尾帧」逐字）：jsonl = [inline rec1]（Refs 空）+ bin = [完整 orphan 帧]（全完整 C3）→ 恰 1 事件 `bin-orphan-frames{truncatedBytes: FRAME_BYTES}` + `bin 长度 0` + 续写 sidecar `frameOffset === "0"` + reader ok + 负向零字节事件断言。
4. **窗口1 / 窗口3**（:1085/:1133）：各补 `truncatedBytes === FRAME_BYTES`（真实移除量）与 `bin 长度 === 0` 断言。
5. **§13.32c**（:1270）：补 `bin-orphan-frames` 事件核对 + `truncatedBytes === FRAME_BYTES` + `bin 长度 === 0`。
6. 文件头注记更新为 Round-2 重锚说明（含 O1 纪律句）。

## 4. SA6 边界与交付注记

- 只动 test/ 域（`test/file-adapter-reopen-roll-repair.test.ts`）；helpers 无需改（`eventsOfTypeRaw`/`readJsonlBytes`/`validAttemptRecord` 等 round-1 已有）；**src 零改动**。
- 实现侧（SA3 范围，非本报告）：删除 `reader.ts:1090-1093` 的 `refsToSegMax.length === 0 → t = walkCompletePrefixEnd(bin)` 例外分支并使 `walkCompletePrefixEnd`（:785-804）成死码移除；C2/C3 截断点严格 `T = max ref end`（Refs 空 → 0）；事件仅真实截断时发出（外层 `bin.byteLength > t` 保证 `truncatedBytes > 0` 结构性成立）——与 feedback 建议 ①②、简报范围 1 一致；版本 bump 0.1.3 → 0.1.4（硬门禁 9）。
- 非必须项：反馈建议 ⑤（共享 stream-analysis 原语抽取）本轮不做（范围纪律）。
- 类型面：`tsc -p packages/namespace-diagnostic-log` 0 错误；`git diff --check` 干净；无新增包/端口依赖（`scripts/test-lock.sh` 无需更新）。

## 5. 交付物与命令回放

- 修正/新增锚：`packages/namespace-diagnostic-log/test/file-adapter-reopen-roll-repair.test.ts`（6 红锚：§13.11 R2、§13.11b、§13.11c、窗口1、窗口3、§13.32c）
- 回放：`cd /home/wangjian/nomicore-fix-issue-153 && node_modules/.bin/vitest run packages/namespace-diagnostic-log/test` → `6 failed | 375 passed (381) / Type Errors no errors / exit=1`（两轮一致）
- 日志：`.mabf-bg/sa6-r2-red-run.log`、`.mabf-bg/sa6-r2-reopen-file-run.log`、`/tmp/sa6-r2-baseline.log`

实现与修绿属于 SA3；SA6 侧红灯已就绪（6 锚全部真实为红且红因唯一指向 src 偏差）。
