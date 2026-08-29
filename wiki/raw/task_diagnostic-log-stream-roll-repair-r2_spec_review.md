# Spec 轴 R2 delta 终审报告 — Issue #153 round=2（T=0 收敛：无引用完整 orphan BIN 尾帧清零）

- **审查会话**：双轴终审 Spec 轴 R2（独立审查，未与 Standards 轴交换上下文；本轴 round-1 报告见 `task_diagnostic-log-stream-roll-repair_spec_review.md`）
- **Worktree**：`/home/wangjian/nomicore-fix-issue-153`（branch `fix/issue-153-on-docs-namespace-diagnostic-change-log`）
- **审查 diff 范围**：`git diff 51b79b9..a2cf3a5`（基线 51b79b9 = round-1 HEAD；a2cf3a5 = SA3 R2 修复 commit）
- **对照基准**：round-2 修订简报（`…-r2.md`，含总控核验裁决 G1 与机制勘误）、权威反馈输入（`…_round2_feedback.md`）、SA8 R2 冲突报告（clear + O1/O2）、SA6 R2 红灯、SA4 R2（pass）、SA7 R2（pass）、r2_ac_checklist；round-1 设计定稿 §5.2/§5.4/§6.3 与 ADR-0012 §打开与尾部恢复继续有效

## Verdict: **pass**

反馈建议 ①–④ 逐条落地核验成立，⑤ 未做符合「非必须」且简报明示排除；AC3/AC1 重证证据链充分（含本轴独立动态探针 6 组全中）；round-1 非阻断①（设计字面 T=0 vs 实现偏差）完全消解；delta 范围恰 3 文件零蠕变；验证门槛独立复跑全绿。未发现阻断项；非阻断观察 1 条。

---

## 1. 复核点①：反馈建议 ①–⑤ 逐条落地核验

| 建议 | 要求 | 落地证据 | 结论 |
|---|---|---|---|
| ① | 删除 `walkCompletePrefixEnd()` 例外，保持 T=0 | `reader.ts` diff：`if (refsToSegMax.length === 0) { t = walkCompletePrefixEnd(bin) }` 分支删除，T 计算回归「`let t = 0; for (const ref of refsToSegMax) if (ref.end > t) t = ref.end`」——与设计 §5.2 L224/§5.4 伪代码首行逐字同义 | ✅ |
| ② | 完整 orphan 后缀全部截断 | 同上：Refs 空 → T=0，`walkBinTail(bin, 0)` 全量行走；探针 P2 实证：refs 空 + 单完整 orphan 帧 → `{kind:'bin-orphan-frames', truncateToBytes:0, truncatedBytes:4122}`（全截） | ✅ |
| ③ | 测试断言修复后 BIN 实际长度 0 | §13.11 R2（`expect(readJsonlBytes(p.binPath).byteLength).toBe(0)`）、§13.11b/§13.11c、§13.29 窗口1/3、§13.32c 五处均新增 `byteLength).toBe(0)` 断言 | ✅ |
| ④ | 修复后再写 sidecar 断言 `frameOffset="0"` + strict reader ok | §13.11b（§13.11 fixture 修复后 emit sidecar → `carrier2.frameOffset === '0'` + reader ok）；§13.11c（纯 C3 场景同款）——反馈建议 4 原样落地 | ✅ |
| ⑤ | 共享原语抽取（非必须） | 未做。反馈原文「后续可考虑…本轮以修复 High 阻断问题与回归测试为主」；修订简报「明确排除」第 2 条明示「不做反馈建议 ⑤…留给后续切片」——符合「非必须」，范围纪律正确 | ✅ 不做合规 |

附带义务核验：

- **死代码移除**：`walkCompletePrefixEnd` 函数定义已删；`grep -rn walkCompletePrefixEnd packages/` 仅余测试文件 1 行历史注释（L444「废止 round-1『walkCompletePrefixEnd 例外』」——记档性引用，非代码引用）。✅
- **事件诚实性结构性成立**：外层守卫 `bin !== null && bin.byteLength > t` 保证 `truncatedBytes = bin.byteLength - t > 0`——零字节修复事件结构性绝迹（SA8 R2 O2「LOW-1 备案随之作废」坐实）；§13.11/§13.11c 均带 `truncatedBytes > 0` 负向断言。
- **版本 bump**：package.json 0.1.3 → 0.1.4（硬门禁 9）。✅
- **文档残留核查（简报范围 3）**：`grep "前缀边界|惰性残渣" README.md AGENTS.md src/reader.ts src/adapters/file.ts` 零命中——round-1 代码注释「§13.11 契约面」段已随例外分支一并删除，无同源表述残留。✅
- **round-1 简报附记**：`task_diagnostic-log-stream-roll-repair.md` +20 行 Round 2 附记（锚纠错登记 + 红灯运行结果）——档案更新，非代码面。

## 2. 复核点②：AC3/AC1 重证证据链充分性

**AC3（重证）——证据链三层充分**：

1. **静态锚**（SA6 R2，6 锚红转绿）：§13.11 R2 重写（两事件两截断、bin 实长 0、`truncatedBytes = FRAME_BYTES+7` / `Buffer.byteLength(partial)`、零字节事件负向断言）；§13.11c（纯 C3：事件 truncatedBytes=4122>0、bin 实长 0）；窗口1/3 + §13.32c 增补真值断言。SA6 R2 红灯记录：基线 51b79b9 上 6 锚红（exit=1，红因唯一指向 walkCompletePrefixEnd 例外）、存量 375 零回退。
2. **动态活链路**（SA7 R2 §1，24/24）：真进程退出重启 + 字节级物理篡改三形态（复合撕裂 / 全完整单帧 / ENOENT+双完整帧）——修复后 bin 实长恒 0、truncatedBytes===修复前长度（4129/4122/8244）、零字节事件绝迹、同 streamId 续写零 rotate、序列连续（1..4/1..3）、reader ok；真实 SIGKILL 命中 W1 `bin-orphan-frames{truncatedBytes:4194329}`（4MiB 全截）。
3. **本轴独立探针**（§5 见下）：refs 空三形态（垃圾尾→corrupt rotate / 完整 orphan→C3 全截 / 未知帧尾→incompatible rotate）与 refs 非空三形态全部实测命中设计语义。

**AC1（重证）**：§13.11b/§13.11c 锚「修复后首条续写 sidecar `frameOffset==="0"` + reader ok」+ SA7 R2 三形态续写序列连续——修复后链自 offset 0 重衔接，安全续写闭合。机制基础：首被引用帧 `expectedOffset=null` 跳边界检查（`storage-gate.ts:88` 既有语义，round-1 D-A1 锚实证）——SA8 R2 O1 勘误（不得补「防 frame-boundary-invalid」伪需求断言）在测试头注与断言面中遵守（grep 实证断言仅限 frameOffset/reader ok/长度/事件值）。

**AC2/AC4/AC5 零回退**：存量锚全绿（全仓 140/1786）；R2 diff 不触滚动/判腐/窗口面；walkBinTail 四态与事件映射零变化（diff 逐行核对）。

## 3. 复核点③：round-1 非阻断①的消解确认

本轴 round-1 报告非阻断 #1 记录「设计 §5.4 字面 Refs 空→T=0 vs 实现取完整帧前缀边界」的已裁决偏差，并建议后续票同步设计文字。本轮：

- owner 质量审查推翻 round-1「SA3 备案 → SA4 裁定」链，以设计字面为准（round2_feedback.md 头部 + r2 简报 G1）；
- 实现向设计 §5.2/§5.4 字面收敛（例外删除、T=0 全截），设计文档零改动（简报明确排除，且设计本就正确）；
- 派生偏差（`truncatedBytes:0` 零字节事件，round-1 LOW-1 备案）随结构性 `truncatedBytes>0` 一并作废（SA8 R2 O2）。

**非阻断①完全消解，无残留建议项**（原建议「同步设计文字」因设计无需改动而失效；SA8 R2 O1 备案「后续票若同步设计文字，仅修论证句不修判定式」留档即可）。round-1 报告 §7 非阻断 #2/#3（reader §9.3 stat 失败按 0 计 / 设计 LOW 记档项）与本轮无关，维持原状。

## 4. 复核点④：范围蠕变检查

- **delta 文件面**（`git diff 51b79b9..a2cf3a5 --stat`）：代码面恰 3 文件——`src/reader.ts`（-27 净：删例外 + 删死码 + 注释改）、`test/file-adapter-reopen-roll-repair.test.ts`（+106 净：锚纠错 + 2 新锚）、`package.json`（bump）——与简报修订范围 1/2/4 一一对应；其余为 wiki 档案（5 新 r2 文件 + 1 round-1 简报附记），属流水线自身工件，非蠕变。
- **DENY 面**：#148 冻结面、docs/adr/**、CONTEXT.md、包外全零触碰；README/AGENTS 本轮零改动且经残留核查无反句（SA8 R2 裁决③实证 AGENTS 现文与 T=0 同向，无需改）。
- **反馈建议 ⑤ 未做**——范围纪律遵守（简报明示排除）。
- **结论：零范围蠕变。**

## 5. 复核点⑤：疑似错误行为推演（T=0 边界）+ 独立动态探针

**推演矩阵**（结合代码逐行核对与本轴独立探针实证）：

| 场景 | 期望语义（设计 §5.1/§5.4 + ADR §打开与尾部恢复） | 探针实测 | 结论 |
|---|---|---|---|
| P1 refs 空 + bin 从 0 起垃圾（未知 magic） | 不可证明为撕裂帧 → `rotate(stream-corrupt)` 零修复 | `{"verdict":"rotate","cause":"stream-corrupt"}` | ✅ |
| P2 refs 空 + 单完整 orphan 帧 | C3：T=0 全截，真实 truncatedBytes | `resume, repairs:[{bin-orphan-frames, truncateToBytes:0, truncatedBytes:4122}]` | ✅ |
| P3 refs 空 + 完整帧 + 未知 frameVersion 尾 | 未知 frame 事实 → `rotate(stream-incompatible)` | `{"verdict":"rotate","cause":"stream-incompatible"}` | ✅ |
| P4 refs 非空 + 引用后 10B 撕裂尾 | C2：截到 max ref end（4122），种子 binBytes=4122 | `resume, repairs:[{bin-incomplete-frame, truncateToBytes:4122, truncatedBytes:10}], binBytes:4122` | ✅ |
| P5 D-A1 面（orphan 帧在首引用之前） | 惰性残渣零修复、健康 resume（round-1 §4.3 特例/§13.17 后半锚） | `resume, repairs:[], binBytes:8244`（orphan 与引用帧全保留，零误伤） | ✅ |
| P6 refs 非空 + 引用后完整 orphan 尾帧 | C3：截到 max ref end（4122） | `resume, repairs:[{bin-orphan-frames, truncateToBytes:4122, truncatedBytes:4122}], binBytes:4122` | ✅ |

**附加推演**：

1. **walk 起点变化对判腐面的影响**：round-1 例外分支下 `walkBinTail` 从「完整帧前缀末端」起走；R2 从 0（refs 空）起走。两种起点对 `unknown-magic`/`unknown-frame` 的判定**结论等价**（完整有效前缀无论从哪起走都会被正确步过，首个异常字节处出同一判定）——判腐/判 incompatible 面零漂移。实测 P1/P3 与 round-1 同向。
2. **S 不变量（§5.2）**：Refs 空时无引用区间可交，T=0 截断结构性安全；Refs 非空时 T=max ref end 不变——全有或全无与「只删无引用字节」纪律不变。
3. **种子一致性（§6.3）**：修复后 `binBytes = t`（T=0 时 0），续写首帧 fresh-stat 落 offset 0，引用链自 0 衔接（§13.11b/§13.11c 锚 + SA7 R2 实测）；滚动判定（`segBinBytes` 种子）与修复后物理字节一致。
4. **事件量有界**：C1 至多 1 + bin 至多 1 的 §5.5 上界不变；事件只在真实截断时发出（结构性 `truncatedBytes>0`）。
5. **勘误面**：owner 反馈所称下游后果「frame-boundary-invalid 自伤」在当前链语义下不成立（首引用跳边界检查）——总控 G1 勘误与 SA8 R2 O1 均如实记档，且测试断言面未引入伪需求断言（grep 实证）。规格违反（未截断 + 不诚实事件）独立于该机制成立，修复方向正确。

**结论：无疑似错误行为。**

## 6. 阻断发现清单

**无。**

## 7. 非阻断清单（1 条）

1. **测试文件 L444 残留 `walkCompletePrefixEnd` 字样**（注释「废止 round-1『walkCompletePrefixEnd 例外』对 §13.11 的固化」）——记档性历史引用，非代码引用，不构成死代码；若后续票清理注释可一并带走。非阻断。

## 8. 独立取证记录（命令 + 结果）

| # | 命令（worktree 内） | 结果 |
|---|---|---|
| 1 | `git log --oneline -8` / `git diff 51b79b9..a2cf3a5 --stat` | 修复 commit a2cf3a5；代码面恰 3 文件（reader.ts -27 净 / test +106 净 / package.json bump）+ wiki 档案 |
| 2 | `git diff --check 51b79b9..a2cf3a5` | 干净（DIFF_CHECK_CLEAN） |
| 3 | `setsid nohup pnpm typecheck`（/tmp/specreview153/typecheck-r2.log） | **exit=0**（全包 0 错误） |
| 4 | `setsid nohup pnpm test`（/tmp/specreview153/test-r2.log，串行执行避开 R1 记档的 pnpm 并发竞态） | **Test Files 140 passed (140)；Tests 1786 passed (1786)；Type Errors: no errors；exit=0**（round-1 基线 140/1784 → +2 测试 = §13.11b/§13.11c 新锚） |
| 5 | `grep -rn walkCompletePrefixEnd packages/` | 仅测试文件 1 行历史注释命中；函数定义与调用点零残留 |
| 6 | `grep "前缀边界\|惰性残渣" README.md AGENTS.md src/reader.ts src/adapters/file.ts` | 零命中（文档/注释残留核查通过） |
| 7 | 独立动态探针（tsx 直调 `analyzeStreamForResume`，/tmp/specreview153/probe/，真实 writer 造夹具 + 字节级篡改） | P1–P6 六组全中（见 §5 表）；探针过程两起夹具侧误用（observer 方法名/emission 缺 source 字段致 gate 拦截）已修正，与被测语义无关 |
| 8 | diff 逐行研读：reader.ts（例外删除 + 死码移除 + 注释改）/ 测试 delta（§13.11 重写 + §13.11b/c 新锚 + 窗口1/3/§13.32c 增补）/ package.json / round-1 简报附记 | 见 §1–§5 对照记录 |
| 9 | R2 档案核验：r2.md（G1 裁决 + 机制勘误）、round2_feedback.md、r2_conflict_report.md（clear + O1/O2）、r2_dispatch.md、r2_sa4（pass）/r2_sa7（pass）/r2_ac_checklist | 流水线声明与代码面证据一致；SA7 R2 24/24 活链路 + 68 轮 SIGKILL 零失败 + 双 Node 140/1786 与本轴复跑一致 |

---

**结论**：verdict = **pass**。round-2 High 缺陷（无引用完整 orphan BIN 尾帧未清除）修复忠实于设计 §5.2/§5.4 字面与 ADR-0012 授权修复集；反馈建议 ①–④ 落地、⑤ 未做合规；AC3/AC1 重证证据链充分（含本轴独立探针 6/6）；round-1 非阻断①完全消解；零范围蠕变；验证门槛独立复跑全绿（140/1786、typecheck 0、diff --check 干净）。
