# SA6 红灯报告 — Reopen streams, roll segments, and repair provable tails（issue #153 round=1）

**日期**：2026-08-28（SA6 红灯锚定阶段；设计定稿后落锚——SA8 设计复审 clear + SA2 R2 pass + N1/N2 并入）
**权威契约**：`wiki/raw/task_diagnostic-log-stream-roll-repair_design.md`（670 行，§13 = 33 条红灯锚 + §13.7 R1 变体；§16 ALLOW/DENY LIST）；裁决面 `…_relevant_decisions.md`（SA8 前置门禁）；约束优先级：任务简报 > SA8 门禁 > ADR-0012/0011/0008 > #148 冻结 > #152/R2 设计 > SA2 评审。
**运行目录**：`/home/wangjian/nomicore-fix-issue-153`（基线 commit 8611e68；**src 零改动**——`git status` 仅 test/ 与 wiki/ 变化；`git diff --check` 干净）。
**红灯验证命令**：`cd /home/wangjian/nomicore-fix-issue-153 && node_modules/.bin/vitest run packages/namespace-diagnostic-log/test`（后台独立进程；无端口依赖，`fuser` 预检空跑）
**红灯证据日志**：`.mabf-bg/sa6-red-run.log`（首轮全量）、`/tmp/sa6c.log`（主红灯文件逐锚复跑）、`/tmp/sa6e.log`（终态全量）

**最终红灯统计**：`Test Files 6 failed | 15 passed (21)；Tests 119 failed | 256 passed (375)；Type Errors: no errors；exit=1`
- `file-adapter-reopen-roll-repair.test.ts`（新建，50 用例）：**47 失败 / 3 通过**（通过 = §13.5b 边界反向护栏、§13.25 空命名空间护栏、§13.27 sequence 耗尽 #152 既有回归锚——当前即绿、实现后必须保持）
- `file-adapter-strict-reader.test.ts`：62 失败（§13.30 新块 6 红 / 4 绿 + **56 条既有用例连带红**，见 §4）
- `file-adapter-layout.test.ts`：3 失败（17 键表达）；`file-adapter-mismatch-interference.test.ts`：1 失败（事件迁移）；`file-adapter-sa7-dynamic.test.ts`：1 失败（D-A1 续写正例）；`file-adapter-r2-supplemental.test.ts`：5 失败（17 键夹具连带红，见 §4）
- 复跑两次结果一致（47/3 与 119/256），无 fixture 性死锁、无不可复现红——**不触发「无法复现」中断门禁**。

---

## 1. 设计 §13 逐锚红灯证据

「期望 vs 实测」列引用**首条失败断言**的实际输出（当前 src 实测）。锚点引用格式：`§13.N`（设计 §13 原文编号）；「预期终态」列 = 实现后（SA3 完成）的绿态语义。

| # | 锚点 | 文件 · 用例 | 红灯证据（当前 src 实测） | 预期终态 |
|---|---|---|---|---|
| 1 | AC1 无 resumeStreamId 重启 → 同 streamId 续写、sequence 续接、reader 全绿 | reopen-roll-repair · `§13.1` | `expected ['00000001.bin','00000001.jsonl'] to include '00000002.jsonl'`（A 无滚动——§6.2 未实现；同时 B 亦无续写能力） | A 滚出 00000002 → B.streamId==A → B 首条 seq=4 → reader ok |
| 2 | AC1 B 续写后 current.json 仍指向该 stream；A/B 记录全序 | reopen-roll-repair · `§13.2` | `expected 'log-46a3…' to be 'log-2582…'`（B 新建 generation，streamId 不同） | current.json==A.streamId；序列 [1..4] |
| 3 | AC1 显式 resumeStreamId → 续写 | reopen-roll-repair · `§13.3` | `expected 'log-ca5e…' to be 'log-1eb8…'`（match → 恒新建，`file.ts:759`「#152 无续写能力」） | 同 §13.1 |
| 4 | AC2 小 targets 成对滚动 + 闭组达标 + 单条超大记录独占新组 | reopen-roll-repair · `§13.4` | `expected ['00000001.bin','00000001.jsonl'] to include '00000002.jsonl'` | segments 00000001..03 成对；闭组 2 条=target；seg3 单条 4122B > jsonl target 2000 仍落盘 |
| 5a | AC2 边界：恰达 target → 下一条前滚 | reopen-roll-repair · `§13.5a` | `expected ['00000001.jsonl'] to deeply equal ['00000001.jsonl','00000002.jsonl']`（第 3 条 emit 未滚） | 2 条后仅 seg1；第 3 条入 seg2 |
| 5b | AC2 边界反向：未达 → 不滚 | reopen-roll-repair · `§13.5b` | ✅ 绿（当前即满足；护栏） | 保持绿 |
| 6 | AC2 续写期滚动（§6.3 种子） | reopen-roll-repair · `§13.6` | `expected ['1','2','3'] to deeply equal ['1','2','3','4','5']`（B 未续写） | B 首条 seg2（1<2 不滚）、次条滚入 seg3 |
| 7a | AC3 C1 末行截断去 `\n` + 事件 + 续写复用该号 | reopen-roll-repair · `§13.7a` | `expected [] to have a length of 1 but got +0`（无 `stream-tail-repaired`） | 1 事件 `jsonl-incomplete-line`、截到最后 `\n`、B seq 2、reader ok |
| 7b | AC3 R1 变体：J 全文无 0x0A（含合法 JSON 形）→ 截 0 字节、lastCommitted=null、首条 seq=1 | reopen-roll-repair · `§13.7b` | 同上（无事件） | truncatedBytes=|J|、字节 0、B seq '1' |
| 8a | AC3 C2a 尾块 <25B | reopen-roll-repair · `§13.8a` | 同 7a | 1 事件 `bin-incomplete-frame`、bin→4122、B 帧 offset=4122 |
| 8b | AC3 C2b 合法头 + payload 越界 | reopen-roll-repair · `§13.8b` | 同 7a | 同上 |
| 9 | AC3 C3 完整未引用尾 orphan 帧 | reopen-roll-repair · `§13.9` | 同 7a | 1 事件 `bin-orphan-frames`、truncatedBytes=8244、B 首帧 offset=4122（链衔接） |
| 10 | AC3 C2+C3 混合 → 单截断单事件 | reopen-roll-repair · `§13.10` | 同 7a | 1 事件 `bin-incomplete-frame`（终局证据类优先） |
| 11 | AC3 C1+C2 并存 → 两事件两截断 | reopen-roll-repair · `§13.11` | `expected [] to have a length of 2 but got +0` | 2 事件（jsonl+C2）各自截断 |
| 12 | AC3 修复后 reader ok + SegMax 种子 | reopen-roll-repair · `§13.12` | `expected [] to have a length of 2 but got +0` | 2 事件 → B 首条滚入 00000003（种子 records=1=target 的推演） |
| 13 | AC4 中间坏行 + 可修复尾巴 → 零修复 + corrupt rotate + 新 gen genesis | reopen-roll-repair · `§13.13` | `expected [] to have a length of 1 but got +0`（无 rotate 事件） | 恰 1 事件 `stream-generation-rotated{cause:'stream-corrupt'}` + 旧文件字节恒等 + genesis 落新流 |
| 14a/b/c | AC4 引用帧 CRC 翻位 / offset 越界 / 帧缺失 → corrupt rotate | reopen-roll-repair · `§13.14a/b/c` | 均 `expected [] to have a length of 1 but got +0` | cause `stream-corrupt`；14b/c 另断言 cfg 字节恒等 |
| 15a | AC4 bin 中部 magic 垃圾尾（不可证撕裂）→ corrupt rotate | reopen-roll-repair · `§13.15a` | 同 13 | cause `stream-corrupt` + 零修复 + bin 字节恒等 |
| 15b | AC4 未知 frameVersion 尾块 → incompatible rotate | reopen-roll-repair · `§13.15b` | 同 13 | cause `stream-incompatible`（ADR 不修复清单） |
| 16a | AC4 sequence-gap（删中间行）→ corrupt rotate | reopen-roll-repair · `§13.16a` | 同 13 | cause `stream-corrupt` + reader corrupt |
| 16b | AC4 orphan 夹在引用帧之间（链断）→ corrupt rotate | reopen-roll-repair · `§13.16b` | 同 13 | cause `stream-corrupt` + reader corrupt（frame-boundary-invalid） |
| 17a | AC4 非 SegMax 未终止末行 → corrupt rotate（后缀性质） | reopen-roll-repair · `§13.17a` | 同 13 | cause `stream-corrupt` + 零修复 + reader `line-unterminated` |
| 17b | AC4 非 SegMax bin 尾孤儿 → **§5.4 裁决：健康 resume 零修复** | reopen-roll-repair · `§13.17b` | `expected 'log-95dc…' to be 'log-aaaa…'` | B.streamId==FX、零事件、闭段字节恒等、reader ok（**见 §6 歧义 1**） |
| 18a | AC4 17 键篡改 → stream-incompatible rotate + 旧 manifest 恒等 | reopen-roll-repair · `§13.18a` | 同 13 | cause `stream-incompatible` + reader incompatible（同向） |
| 18b | AC4 14 键健康 → legacy-manifest rotate + reader ok | reopen-roll-repair · `§13.18b` | 同 13 | cause `legacy-manifest` + reader ok（双形状正例） |
| 18c | AC4 14 键篡改指纹 → stream-incompatible（**非** legacy-manifest；R1 判定次序） | reopen-roll-repair · `§13.18c` | 同 13 | cause `stream-incompatible`（manifest 门 incompatible 判定先于 17 键要求） |
| 19 | AC4 14 键 legacy + sidecar 帧 → legacy rotate；同文件 reader 可读 | reopen-roll-repair · `§13.19` | 同 13 | cause `legacy-manifest` + reader ok（读≠续写） |
| 20a | AC4 冻结配置改变（roll target）→ frozen-policy-mismatch + 新 manifest 新值 | reopen-roll-repair · `§13.20a` | 同 13 | cause `frozen-policy-mismatch`；新 manifest.targetRecordsPerSegment=3 |
| 20b | AC4 冻结配置改变（capture/policy/inline/line）四 case | reopen-roll-repair · `§13.20b` | `case updateCapture: expected [] to have a length of 1 but got +0`（4 case 全同） | 4 case 均 cause `frozen-policy-mismatch` + 新值入 manifest |
| 21 | AC5 current.json 坏 JSON + 恰一 stream → 恢复 + 愈合 | reopen-roll-repair · `§13.21` | `expected 'log-16fb…' to be 'log-aaaa…'` | 恢复同流 + current.json 三键愈合 + seq 续 2 |
| 22 | AC5 current.json 缺失 + 2 候选 → disabled + locator-ambiguous + 零文件 | reopen-roll-repair · `§13.22` | `expected [] to have a length of 1 but got +0` | 恰 1 `stream-init-failed{reason:'locator-ambiguous'}` + 文件数恒等 |
| 23a | AC5 current.json→不存在 + 恰一候选 → 恢复 | reopen-roll-repair · `§13.23a` | `expected 'log-594a…' to be 'log-aaaa…'` | 恢复候选 + 愈合 |
| 23b | AC5 current.json→不存在 + ≥2 候选 → disabled（零猜测） | reopen-roll-repair · `§13.23b` | 同 22 | `locator-ambiguous` + 文件数恒等 |
| 24 | AC5 显式目标 manifest 缺失 → rotate manifest-missing（不回退 locator） | reopen-roll-repair · `§13.24` | 同 22 | cause `manifest-missing`；fixture 流零触碰 |
| 25 | AC5 空命名空间 → fresh 无 rotate | reopen-roll-repair · `§13.25` | ✅ 绿（护栏） | 保持绿 |
| 26a | AC5/耗尽：reopen 已耗尽 → 构造期恰一次 stream-exhausted | reopen-roll-repair · `§13.26a` | `expected [] to have a length of 1 but got +0` | 构造期 1 事件 + 后续丢弃 + 文件恒等 + 无新段 |
| 26b | AC5/耗尽：segment 99999999 滚动溢出（emit 触发） | reopen-roll-repair · `§13.26b` | `expected [] to deeply equal ['1']`（未续写——99999999.jsonl 仍空） | 首条 seq1 落盘、次条丢弃 + 恰 1 事件 + 无新段 |
| 27 | AC5/耗尽：sequence uint64（#152 既有回归锚） | reopen-roll-repair · `§13.27` | ✅ 绿（当前即满足） | 保持绿 |
| 28 | AC5/配置门：非法 targets → disabled + invalid-roll-targets + 零文件 | reopen-roll-repair · `§13.28` | `targetJsonlSegmentBytes=0: expected [] to have a length of 1 but got +0`（12 组合全同） | 每组合 1 `stream-init-failed{reason:'invalid-roll-targets'}` + 零文件 |
| 29 W1 | AC5 崩溃窗口：完整 orphan 帧 + jsonl ENOENT | reopen-roll-repair · `窗口1` | `expected [] to have a length of 1 but got +0` | `bin-orphan-frames` 修复（截 0）→ B seq1、reader ok |
| 29 W2 | 撕裂帧 + jsonl ENOENT | reopen-roll-repair · `窗口2` | 同 W1 | `bin-incomplete-frame` → 同上 |
| 29 W3 | 帧完整 + 行撕裂 | reopen-roll-repair · `窗口3` | `expected [] to have a length of 2 but got +0` | C1+C3 双事件 → B seq1、reader ok |
| 29 W4 | 行完整 + 帧完整 | reopen-roll-repair · `窗口4` | `expected 'log-d4a1…' to be 'log-aaaa…'` | 零修复健康续写 → B seq2、reader ok |
| 30a | reader 17 键正例 | strict-reader · `§13.30a` | `expected 'corrupt' to be 'ok'`（17 键被拒 → manifest-invalid；§9.1 未实现） | ok |
| 30b | reader 14 键正例（读能力双形状） | strict-reader · `§13.30b` | ✅ 绿 | 保持绿 |
| 30c | reader 15 键 → manifest-invalid | strict-reader · `§13.30c` | ✅ 绿（既有 reader 已拒 15 键） | 保持绿 |
| 30d | reader 16 键 → manifest-invalid | strict-reader · `§13.30d` | ✅ 绿 | 保持绿 |
| 30e | reader `line-unterminated`（末块缺 `\n`） | strict-reader · `§13.30e` | `expected ['manifest-invalid'] to include 'line-unterminated'` | corrupt + `line-unterminated`（§9.2） |
| 30f | reader `line-unterminated` 变体（合法 JSON 无 `\n`） | strict-reader · `§13.30f` | 同上 | 同上 |
| 30g | reader `manifest-roll-target-violation`（闭段未达标） | strict-reader · `§13.30g` | `expected ['manifest-invalid'] to include 'manifest-roll-target-violation'` | corrupt + 该码 + segment='00000001' |
| 30h | reader roll-target 正例（闭段达标） | strict-reader · `§13.30h` | `expected 'corrupt' to be 'ok'` | ok |
| 30i | reader 14 键跳过闭段核查 | strict-reader · `§13.30i` | ✅ 绿 | 保持绿 |
| 30j | reader `line-unterminated` + `invalid-json` 叠加 | strict-reader · `§13.30j` | `expected ['manifest-invalid'] to include 'line-unterminated'` | 两码共存 |
| 31 | **核心红灯** writer 自产链中 orphan 全生命周期（EISDIR 注入 → candidate 复用 → 进程内 reader corrupt → 重启 corrupt rotate） | reopen-roll-repair · `§13.31` | ①-④ 全过（含 `storage-write-failed{stage:'jsonl',code:'EISDIR'}` 与进程内 reader `frame-boundary-invalid`——既有 R2 行为锚）；⑤ `expected [] to have a length of 1 but got +0`（无 rotate 事件） | ⑤ 恰 1 `stream-generation-rotated{cause:'stream-corrupt'}` + B.streamId≠A + 旧文件字节恒等 + B emit 落新 gen |
| 32a | 不可读≠缺失：SegMax jsonl 目录占位 | reopen-roll-repair · `§13.32a` | `expected [] to have a length of 1 but got +0` | cause `stream-corrupt` + B≠FX + 零 repair（绝无「按空文件续写」） |
| 32b | 不可读≠缺失：SegMax bin chmod 000（无引用） | reopen-roll-repair · `§13.32b` | 同 32a | cause `stream-corrupt`（保守 rotate：不修复、不跳过续写）+ 文件 mode 0o000 保留 |
| 32c | 对照：SegMax jsonl ENOENT（BIN-first 窗口） | reopen-roll-repair · `§13.32c` | `expected 'log-9429…' to be 'log-aaaa…'` | 健康 resume + `bin-orphan-frames` 修复 → B seq1（ENOENT 豁免） |
| 33 | locator 愈合失败：writeCurrent 注入 EISDIR → storage-write-failed{stage:current} + 续写不受影响 + 再恢复析 | reopen-roll-repair · `§13.33` | `expected 'log-83ce…' to be 'log-aaaa…'` | B 续写（seq2 正常）+ 事件 + C 再续 seq3、不落 locator-ambiguous |
| 17-后半 | D-A1 终态 reopen 健康续写正例 | sa7-dynamic · `D-A1-续` | `expected 'log-…' to be 'log-…'`（B 新建 gen） | B.streamId==A、零修复、seq3 落盘、reader ok |

**中断门禁结论**：红灯稳定可复现（主文件 47 项 + 全量 119 项，两轮运行一致；红因均为 §1 的 8 类「src 未实现本票语义」），**不触发「无法复现」门禁**。

## 2. 存量用例迁移（设计 §11.3 明确列出的既有断言更新）

| 文件 | 用例 | 更新 | 红灯证据 |
|---|---|---|---|
| `file-adapter-layout.test.ts` | manifest 键集逐项 | 14 → 17 键 + 3 target 值断言 | `expected ['committedUpdateCapture',…(13)] to deeply equal […(16)]`；`expected undefined to be 12345`；`expected undefined to be 67108864` |
| `file-adapter-layout.test.ts` | 配置值冻结 / 默认值 | + target 断言（默认 64 MiB/256 MiB/100,000） | 见上行 |
| `file-adapter-mismatch-interference.test.ts` | 门槛 10 resume mismatch | 事件迁移：`stream-init-failed{manifest-mismatch}` → `stream-generation-rotated{cause:'stream-incompatible'}`（14 键篡改指纹归因钉死 §4.1 R1） | `expected [] to have a length of 1 but got +0` |
| `file-adapter-strict-reader.test.ts` | 跨 segment 两用例 | manifest 声明 `targetRecordsPerSegment: 1`（闭段 §9.3 核查一致性；防实现后「跨 segment 正例 → ok」被 roll-target-violation 误判） | 该两用例自身当前绿（14 键夹具）；实现后依赖 §9.1 双形状转绿 |
| `file-adapter-r2-supplemental.test.ts` | 「第 15 键」 | `validManifest` → `legacyManifest`（14+1 保持真 15 键语义） | 用例当前绿；实现后保持 |
| `test/helpers/file.ts` | `validManifest` 默认 | +3 target 键（默认值 = ADR §Segment rolling 默认） | —（夹具层） |
| `test/helpers/file.ts` | 新增 | `legacyManifest` / `eventsOfTypeRaw` / `sidecarAttemptRecord` / `concatU8`；`writeStreamFixture` +`current`/`segments` | —（夹具层） |

## 3. 未落锚/未变绿说明（诚实披露）

- **§13.30 的 15/16 键、14 键正例**：当前 reader 已满足（15/16 键拒、14 键读）——绿灯护栏，实现后必须保持（防回归）。
- **§13.25/§13.27/§13.5b**：当前即绿（fresh 无事件、sequence 耗尽 #152 既有语义、未达不滚）——护栏与回归锚。
- **§13.17b**：以 §5.4/§5.1 规范性文本为 oracle（见 §6 歧义 1），非 §13.17 字面。

## 4. helper 默认 17 键的连带红（设计 §11.3 明确要求「helper 默认加三 target」）

`validManifest` 默认升级 17 键后，使用默认 fixture 的既有 reader 用例在实现前全数红——**红因全部为 §9.1（reader 未接受 17 键双形状）未实现**，即本票语义本身；实现后按设计 §11.3「零既有断言破坏」全部回绿（读者接受双封闭形状；既有夹具单 segment、行尾均带 `\n`——不触发 §9.2/§9.3 新码）。数量：

| 文件 | 连带红用例 | 红因类别 |
|---|---|---|
| `file-adapter-strict-reader.test.ts` | 56 条（未知版本/inline/storage/sidecar/sequence/政策/连续性等既有断言） | `expected ['manifest-invalid'] to include '<原码>'` 或 `expected 'corrupt' to be 'ok'`（17 键被当前 reader 拒） |
| `file-adapter-r2-supplemental.test.ts` | 5 条（fs 包络 ×2、streamId 互核、R-1a/R-1b） | 同上 |

若总控认为连带面过大，最小回退方案：`validManifest` 保留 14 键默认 + `currentManifest` 单独 17 键——代价是偏离设计 §11.3 明文（SA4 复核口径变化）。本报告按设计明文执行。

## 5. SA6 对实现的边界说明（供 SA3 参考，非新增需求）

- **不需要新测试接缝**：全部注入用真实构造/真实 emit + 物理文件操作（EISDIR 目录占位、chmod 000、current.json.tmp 目录占位、truncate 后字节断言）——与 #152 R2 SA6 的「无新接缝」先例一致。
- **reader H 不变量侧**：§13.15a/b 的 bin 尾 Artifact（可读、不可证撕裂/未知版本）只断言 analysis 侧 rotate（事件），**未断言 reader 非 ok**——当前 reader 只读被引用帧、不扫描 bin 尾（§9.4「不改的部分」），analysis（可续写性证明）严于 reader（可解释性），与 §4.3 N1 豁免行的方向一致（见 §6 歧义 2）。
- **exhaustedAtOpen 的 fixture**：用 `segments/99999999` 空/单条 jsonl + targets=1 构造；实现按 §7 的「currentSegment==='99999999' 且修复后计数 ≥ target」判定即可对锚。

## 6. 设计文本歧义/挂起裁决点（不阻塞红色契约，影响实现终态）

1. **§13.17「非 SegMax 段 bin 尾 orphan → corrupt rotate」与 §5.4/§5.1 不一致**：§5.4 明文「闭段（非 SegMax）bin 的未引用尾字节……不构成修复条件，也不构成损坏」「闭段惰性残渣与开段链安全威胁的区分是功能性的」；§13.17 字面却把非 SegMax bin 尾 orphan 判 corrupt rotate。SA2 评审（`…_sa2_review.md` line 50）也以「orphan 变闭段尾部字节=reader-ok 惰性残渣」为确定事实引用 §5.4。**本报告以 §5.4 为 oracle**（§13.17b 断言健康 resume、零修复、reader ok；同时锚定「不修复」半句）。若 SA8 裁决按 §13.17 字面（corrupt），§13.17b 需按裁决翻转（并把「闭段残渣」按同族豁免补入 §4.3 N1 行才能与 H 自洽）。
2. **H 逆命题的 bin 尾 Artifact 面**：§4.3 的不变量 H 写「verdict=rotate（corrupt/incompatible 类）时 reader 必非 ok」，而 bin 尾可读魔术垃圾/未知 frameVersion 只被 analysis 拒绝、reader 惰性不读（§9.4）——rotate(corrupt/incompatible) 而 reader ok。§4.3 N1 仅覆盖「不可读且无引用」族；本面是否并入豁免族需 SA8 澄清（本报告未对 §13.15a/b 断言 reader 侧，规避实现侧自相矛盾）。
3. **`stream-init-failed.reason` 的旧值处置**：§11.3 指 init-failed 仅保留 disabled 终态（invalid-namespace-id/invalid-stream-id/locator-ambiguous/invalid-roll-targets）——即 `manifest-mismatch`/`manifest-missing` 两旧值被移除。本报告按此执行（mismatch 用例断言 init-failed 零出现）；若 SA8 保留旧值（只增不改），mismatch 用例的 `toHaveLength(0)` 需改为「不出现 manifest-mismatch」。
4. **§13.31 的「小 targets」表述**与单段孤儿注入窗口存在数值张力（bin target 需 ≥3×4122B 才可能在 3 次 emit 内不滚）；本报告取 records=100/jsonl=100000/bin=100000（同段注入窗口成立，且「closing 后」滚动的能力由 §13.4/§13.6 另行锚定）。若维持「小 targets」字面（bin target 256B），孤儿将跨段、链断不再可复现——需 SA1 澄清。

## 7. 交付物与命令回放

- `packages/namespace-diagnostic-log/test/file-adapter-reopen-roll-repair.test.ts`（新建，50 用例，约 1240 行）
- `packages/namespace-diagnostic-log/test/helpers/file.ts`（+17 键默认/legacyManifest/eventsOfTypeRaw/sidecarAttemptRecord/concatU8/writeStreamFixture 扩展）
- `packages/namespace-diagnostic-log/test/file-adapter-layout.test.ts`（17 键断言 ×3）
- `packages/namespace-diagnostic-log/test/file-adapter-mismatch-interference.test.ts`（事件迁移）
- `packages/namespace-diagnostic-log/test/file-adapter-strict-reader.test.ts`（§13.30 十用例 + 跨 segment 两例 manifest 声明）
- `packages/namespace-diagnostic-log/test/file-adapter-r2-supplemental.test.ts`（第 15 键 → legacyManifest）
- `packages/namespace-diagnostic-log/test/file-adapter-sa7-dynamic.test.ts`（D-A1-续 正例锚）
- 回放：`cd /home/wangjian/nomicore-fix-issue-153 && node_modules/.bin/vitest run packages/namespace-diagnostic-log/test` → 119 failed / 256 passed / 0 type errors / exit=1（两次一致）；`tsc -p packages/namespace-diagnostic-log` 0 错误；`git diff --check` 干净
- 日志：`.mabf-bg/sa6-red-run.log`、`/tmp/sa6c.log`、`/tmp/sa6e.log`

实现与修绿属于 SA3：`src/reader.ts`（§4.1 分析函数 + §9 双形状/两码）、`src/adapters/file.ts`（§3/§5.5/§6/§7/§8 + §18 配置键）、`src/paths.ts`（`segmentFilePaths`）、`src/health.ts`（+2 成员、+2 reason）；本组红灯不新增任何测试接缝/端口/包依赖（`scripts/test-lock.sh` 无需更新）。
