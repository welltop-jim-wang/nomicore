# 工程终审 Spec 轴评审报告 — File diagnostic-log adapter R2（issue #152 round=2）

**日期**：2026-08-28（Phase 4 双轴终审 · Spec 规格符合性轴，独立评审）
**审查范围**：`git diff fde8034..HEAD`（HEAD=`f52eccb`，10 文件 +1498/−134；本轴零文件修改，仅产出本报告）
**规格基准**：任务简报 `task_diagnostic-log-file-adapter-r2.md`（反馈全文=最高权威 + R2-AC1/2/3）；issue #152 正文 AC1–AC5（round=1 已 ✅，本轮核不回退）；已接受设计 `…_r2_design.md`（SA1 R3）；SA6 红灯契约 `…_r2_sa6_red.md`（29 锚）；总控裁决 `…_r2_dispatch.md` 第 12/14 行（G18/G19/G20/G21）；ADR 0011/0012 原文；`…_r2_ac_checklist.md`、`…_r2_sa4_review.md`、`…_r2_sa7_report.md`。

---

## Verdict: pass

三项反馈逐条有实现落点、有真实测试锚（用例体+断言已抽查取证，非仅有锚名）、有本轴独立复跑证据；排除项零渗透；验证门槛三项全过且基线零回退。发现清单无 reject 级、无 MINOR 级；3 条 INFO 备案（均不阻塞，见 §6）。

---

## 1. 反馈 1（strict reader 执行 manifest 冻结四策略）— ✅ 逐条符合

反馈原文两反例（capture=false 带 update、超阈值仍 inline 不得返回 ok）均取证到测试用例名+断言：

| 反馈条款 | 实现落点（reader.ts @f52eccb） | 违规码 → 状态映射 | 测试锚（用例名 + 断言取证） | 证据 |
|---|---|---|---|---|
| `committedUpdateCapture`：capture=false 的 attempt 不得带 update carrier；genesis 正交豁免 | `!policy.committedUpdateCapture && carrier !== null && kind !== 'genesis-baseline'` → 违规（diff reader.ts ⑤段）；carrier 定义=genesis 取 `record.update`/attempt 仅 `effect:'update'` 取 `result.update` | `manifest-update-capture-violation` → corrupt（record 级+镜像 stream 级） | `capture=false + attempt committed/effect:update 携带 inline carrier → …+corrupt`；`fatal committed:true/effect:update → 同码`；豁免正例 `genesis update carrier → 合法`、`update-omitted → 合法`。断言体已读：`assertIsolatedR2Issue` 内 `expect(read.status).toBe('corrupt')` + `expect(issueCodes(record.issues)).toEqual([expectedCode])` + 镜像断言 | strict-reader.test.ts §「R2 轮：manifest committedUpdateCapture 政策」；SA7 D-C1（真实 writer+manifest 翻转活链路）|
| `inputCapturePolicy` 逐 attempt 执行（冻结七分支 + degraded marker 双向） | `inputPolicyViolation()`：digest 分支 markerValid 防御镜像 / none·digest+marker 违规 / full·redacted 无 marker 违规 / digest-in-none 违规；非 digest 带 marker 防御镜像；`{capture:'none'}` 全 policy 恒合法（G19）；not-accessed/unavailable/unsafe-input 在 none 下仍违规 | `manifest-input-policy-violation` → corrupt | 正例×3（唯一合法降级 marker / digest 纯 digest·none / 三不可得形态）；违规×3 组（full/redacted+无 marker、digest/none+marker、五格违规阶梯）；VFSL 先拒×2（marker 拼写变化、非 digest 偷带 marker → `vfsl-invalid` 不归 policy 码）；真实 writer 降级产物正例×2（full/redacted 超 line budget → digest+唯一 marker 判 ok，§5.3 #3 防漂移） | strict-reader.test.ts §「inputCapturePolicy 精确形状」「真实 writer 降级产物」；SA7 D-C5 |
| `inlineUpdateMaxBytes` 双向（超阈值不得 inline；≤阈值不得 sidecar；边界 ≤inline/>sidecar） | 本体校验（Base64/length/CRC 或 frame 交叉）成功后才运行表示政策：`inline && payloadLength > threshold → manifest-inline-threshold-violation`；`sidecar && payloadLength <= threshold → manifest-sidecar-threshold-violation`；genesis carrier 同受检 | 两码均 → corrupt | `4097B inline（>4096）→ manifest-inline-threshold-violation`（断言体已读：真实 4097B Base64 夹具+`toBe('corrupt')`）；`4096B sidecar（≤4096）→ manifest-sidecar-threshold-violation`（帧全量合法隔离 policy 判定）；正例 `4096B inline =阈值 → ok` + 既有 4097B sidecar 正例；`genesis 4097B inline → 同码` | strict-reader.test.ts §「阈值双向」；SA7 D-C2/D-C3（manifest 篡改活链路双向） |
| `jsonlLineLimitBytes` 行字节上限（原始 UTF-8 字节、排除 `\n`） | `splitRawLines()` 按 0x0A 字节扫描、行 byteLength=原始 UTF-8 字节数（不含 `\n`）；行长检查先于 JSON.parse，超限行不可解析也保留 issue+`invalid-json`（不跳过不隐藏） | `manifest-line-limit-exceeded` → corrupt | `多字节内容使原始行 UTF-8 字节数超上限（JS 字符数未超）→ …`（字节计量锚）；`等于上限 → 正例 ok`（边界为 `>`）；`超限且不可解析 → 同时报 …与 invalid-json` | strict-reader.test.ts §「jsonlLineLimitBytes」；SA7 D-C4 |

**码表/状态映射总核（设计 §2.6 + G18）**：五 record 码 + stream 级 `sequence-gap` 全部映射 `corrupt`、**不入 `INCOMPATIBLE_SET`**（reader.ts 头注释 + 七码集原文未动 + ⑦聚合段 `allIssues.some(INCOMPATIBLE_SET)` 语义不变）——incompatible → records:[] 的既有行为未受影响；六码均为 reader 私有诊断面，#148 冻结面（record.ts/schema.ts/vocabulary.ts/pipeline.ts）零改动（diff 文件清单实证）。

## 2. 反馈 2（stream sequence 连续性，非仅递增）— ✅ 逐条符合

| 反馈/设计条款 | 实现落点 | 测试锚（实证） | 证据 |
|---|---|---|---|
| 反馈原例：`[1,2,3]` 删 2 → `[1,3]` 不得 ok | §3.4 连续性状态机（`expectedSequence=1n` 起点固定；`actual>expected` → `sequence-gap`）替代旧 `orderSequences` 仅递增循环（旧 `<=` 循环已删） | `[1,3]（物理删除 seq 2）→ corrupt + stream 级 sequence-gap`——断言体已读：`expect(read.status).toBe('corrupt')`、`gapIssueOf(read)` 归因 `{segment:'00000001', offset:1}`（G20：发现缺口的 record）、records ['1','3'] 逐条仍 ok（record 级判定不反转）、不含 `sequence-out-of-order` | strict-reader.test.ts §「stream sequence 连续性」；SA7 D-B1（真实 writer+物理删除+bin 帧保留活链路） |
| 起点=1：`[2]` 判 gap | `expectedSequence: bigint \| null = 1n` | `起始 [2] → sequence-gap` | 同上 |
| 跨 segment 不重置 | 状态机变量声明于 segment 循环外 | `跨 segment：seg1=[1]+seg2=[3] → sequence-gap`；正例 `seg1=[1]+seg2=[2] → ok` | 同上 |
| 合法终态不误判（健康 stream） | 状态机只锚 JSONL 身份事实；EOF 于连续前缀不额外报错 | SA7 D-B2：混合合法终态（committed inline/sidecar、fatal-committed sidecar、noop、fatal-rejected）[1..5] → `ok` 零 issue；D-A1：definitive 恢复交错终态（orphan 帧+[1,2]）→ `ok` | sa7-dynamic.test.ts（SA7 域）；D-A1 见 SA7 §D2 |
| genesis 豁免（capture=false 下 genesis(1,update)+attempt(2) 不误判） | §2.2 genesis 正交 + §3.4 anchor 与 policy 解耦 | `#9 …→ ok、零 issue、无 sequence-gap`——断言体已读：`toBe('ok')` + `issues` 长度 0 + sequences ['1','2'] | strict-reader.test.ts §「policy/anchor 解耦回归」 |
| policy 违规中间记录不产生二次虚假 gap | anchor 前提=JSON parse+VFSL/canonical+streamId 三者；policy/storage issue 独立、不取消 anchor（`ok=false ≠ 不参与连续性`） | `#10 [genesis(1),attempt(2,policy 违规),attempt(3)] → record2 policy corrupt；record3 无虚假 sequence-gap` | 同上 |
| sidecar 损坏中间记录不产生虚假 gap；物理删 JSONL 2 无论 bin 保留与否必 gap | 同上（carrier/frame 损坏不取消 anchor） | `R3 解耦：[1 inline, 2 sidecar-bin 被删, 3 inline] → frame-missing+corrupt；不得产生虚假 sequence-gap`（断言体已读：`not.toContain('sequence-gap')`）；`…CRC 损坏…` 变体；`物理删除 JSONL 2 且 .bin 保留帧 2 → 仍必须 sequence-gap` | strict-reader.test.ts §「stream sequence 连续性」 |
| 身份不可解释行的诚实边界（坏 JSON/VFSL/streamId 不一致） | 该三类行置 `expectedSequence=null`（未知基线），不锚定、不拼接精确缺口；行自身必携 corrupt issue（无 false-ok 通道）；下一可信记录以 `actual+1n` 重建基线 | 三变体锚：`身份不可解释行（VFSL 违规）/（streamId 不一致）/（坏 JSON）… 无 sequence-gap` | strict-reader.test.ts；SA4 §3.1 对伪代码 vs 正文张力的裁决备案（INFO-2） |
| 重复/倒序仍覆盖 | `actual<expected` → `sequence-out-of-order`（expected 不变；归因 segment/offset/sequence 与兄弟码一致） | 既有 round-1 锚全绿（SA6：HEAD 基线 27 条既有用例零回退）+ 本轴全量复跑 1719 绿 | `.mabf-bg/spec-test-root.log` |
| UINT64_MAX 边界（设计 §3.3） | `commitConfirmed`：confirmed success 到 max 才恰一次 `stream-exhausted`；`commitAmbiguous` 不触 latch | policy-continuity 三边界锚：confirmed max 恰一次+后续零落盘；definitive@max 不发 exhausted、恢复后同 candidate 落盘；ambiguous@max 不发 exhausted+密封 | file-adapter-r2-policy-continuity.test.ts §「exhausted 边界」 |
| 重复 `(streamId,sequence)` 零写入（设计 §3.1 不变量） | writer 双阶段提交点：`candidateSequence()` 无副作用；`commitAmbiguous` reservation+`sealed`/`mode='failed'` 封闭旧 generation，恢复后同 generation 零新增 | §5.3 #7/#8 全锚：write 期 ENOSPC（/dev/full 真实注入）ambiguous → 密封+「sequence N may not be persisted」fallbackLog 证据（G21 通道）；open 期 EISDIR/EACCES/ENOENT definitive → candidate 复用、恢复后同 candidate 无 gap；`ambiguous 与 definitive 的可观察差异` | file-adapter-r2-policy-continuity.test.ts（13 用例全绿） |

**writer 侧配套（消除合法 gap 源，设计 §3.2/§3.3）**：genesis 空/超 payloadMax/投影失败守卫与 line/VFSL/storage 门全部移至 candidate 前（gate drop 零消耗有锚：「line 预算 gate drop → 后续成功 record 的 sequence 为 "1"」「genesis 0 字节守卫跳过 → 首个 attempt 为 "1"」×2）；genesis confirmed success 提交 '1'——round-1「跳过 genesis 消耗 1」「门禁失败消耗 sequence」两个合法 gap 源均已消除。`sealed` 标记保证构造期 genesis ambiguous 密封不被 `mode='ready'` 覆盖（file.ts diff 末段）。

## 3. 反馈 3（ADR 0012 dated amendment；ADR 0011 零改动）— ✅ 逐条符合

`git diff fde8034..HEAD -- docs/adr/0012-….md`（+15 行）逐字比对设计 §4：

| 设计要求 | ADR 0012 落点（行号 @f52eccb） | 判定 |
|---|---|---|
| §4.1 第一段（取代关系+同步 append 范围+无 queue/batch/fsync/常驻 fd+非掉电承诺） | L244–248：「Amendment — File adapter first slice（2026-08-28，issue #152 round 2）」+「**在首切片 File adapter 的当前实现范围内被以下条款取代**」（取代非并列）+ 每 emit ≤1 JSONL 行/sidecar BIN-first ≤1 帧 | ✅ |
| §4.1 第二段（「有界」非延迟承诺 + write-slot 外 MUST + void/non-throwing/no-durability-promise + #149–#151/#155 修复后方可启用） | L250：全部要素在（seam 重申句置于接线条件后，语序微调、要素无缺） | ✅ |
| §4.1 第三段（queue/batch 演进路径：公共 seam/schema/policy/slot 隔离不变前提；须另行定义 close/flush/队列满/fsync） | L252：逐字落实 + 增补「retention/queue 容量/batch/fd cache/metrics 可动态调整条款对首切片继续成立（仅指未来切片）」——与 L268 既有条款自洽的澄清单句 | ✅ |
| §4.2 六个编辑点 | queue 必然性取代/batch-fsync 替代段/writer 行为范围/write-slot MUST+seam 重申/被否方案/future evolution —— 六行全覆盖 | ✅ |
| §4.3 四条新增被否方案 | L331–334 逐条在（未修订 ADR 称实现细节 / slot 内同步 emit / 有界=延迟承诺 / 现在实现异步回避修订），既有「每条 fsync 或业务 await」被否条（L330）保留 | ✅ |
| §4.3 后果取舍段 | L345「首切片取舍（2026-08-28 amendment）」：同步可观察性/无常驻 fd/EISDIR 恢复简化/消除孪生状态/代价=调用方线程可阻塞/write-slot 外接线保持 ADR 0011 隔离/未来 queue/batch 独立设计 | ✅ |
| 状态头 accepted 保留 | L4「状态：已接受」未动 | ✅ |
| ADR 0011 正文零改动 | `git diff fde8034..HEAD -- docs/adr/0011-….md` 输出 **0 字节**（本轴独立取证：`.mabf-bg/spec-adr0011-diff.log`） | ✅ |
| 实现保持同步语义（简报裁决选项 b） | file.ts 仍 `appendFileSync` 同步落盘；grep 无 queue/batch/fsync/setImmediate 实现面（仅事件字段 `queueDepth:0` 与注释） | ✅ |

配套文案（设计 §3.5/§4.2 README·AGENTS 同步要求）：README 新增 strict `ok` 语义边界段（「…自 sequence 1 连续，且通过 manifest/storage/frame 校验」逐字 = §3.5 规定文案，无业务完整/可恢复过度声明）+ write-slot 接线纪律 + R2 提交点纪律；并发半行/静态 stream 声明逐字保留未回退（SA7 D3 口径本轴抽核一致）；AGENTS.md +9 行接线边界提示与 amendment MUST 一致。

## 4. 简报排除项核实 — ✅ 零渗透

| 排除项 | 核实方法与结果 |
|---|---|
| 不实现异步 writer queue / batch flush / fsync 开关 | file.ts 全文 grep 无实现面；ADR amendment 明文「首切片不维护 writer queue、不做 batch flush、不提供 fsync 开关」；演进仅成文于 ADR |
| #148 冻结面零改动（memory adapter、emitter 管线、schema 词表、record 联合） | diff 文件清单 10 文件实证：`record.ts`/`schema.ts`/`vocabulary.ts`/`pipeline.ts`/`adapters/memory.ts` 均不在列；六新码只在 reader 输出与测试中 |
| #153（rolling/尾部恢复）/#154（retention）/#155（replay/Host 接线）零渗透 | diff 不涉及 segment rolling、retention、replay、namespace-runtime（DENY LIST 全零触碰，SA4 §1 set 比对本轴复核一致） |
| ALLOW LIST 外文件 | `package.json`（0.1.1→0.1.2 单行 bump=总控硬门禁 9 明令）、`test/helpers/file.ts` 与 `r2-supplemental.test.ts`（dispatch 第 13 行授权的 SA6 测试域；diff 核验：helpers 仅 `committedUpdateCapture:false→true` 单值+注释；supplemental 2 处预置接缝断言放宽为 gap 存在性+R-1a 夹具阈值一致化且断言集逐字未动）——均有授权出处，合规 |

## 5. 验证门槛符合性（本轴独立复跑，后台独立进程，日志落 .mabf-bg/）

| 门槛 | 本轴复跑结果 | 日志 |
|---|---|---|
| `git diff --check fde8034..HEAD` | **干净（exit=0，无输出）** | `.mabf-bg/spec-diff-check.log` |
| `pnpm typecheck`（全仓 10 tsconfig 链） | **EXIT=0**；包级 `tsc -p` 亦 EXIT=0 | `.mabf-bg/spec-typecheck-root.log` / `spec-typecheck.log` |
| `pnpm test`（根 `vitest run --typecheck` 全量） | **138 文件 / 1719 测试全绿，Type Errors no errors，EXIT=0** | `.mabf-bg/spec-test-root.log` |
| 基线对比（fde8034 = 136 文件 / 1664 测试，SA7 记录口径） | +2 文件 / +55 测试（含 SA7 域未跟踪文件，见 INFO-1）；仅 committed diff 为 137/1710（SA7 `sa7-full-test.log`）——**零回退**（SA6：HEAD 基线 27 条 strict-reader 既有用例全绿；29 红锚全转绿） | 同上 |

注：本轴首跑包级 `pnpm test` exit=1（`.mabf-bg/spec-test.log`）系该包 `package.json` 无 `test` 脚本所致（门槛命令以根脚本 `vitest run --typecheck` 为准），非测试失败；已按简报口径以根命令复跑取证如上。AC1–AC5 不回退由全量绿 + AC 门禁清单 8/8（round=1 证据链援引）共同支撑，本轴抽查 AC4 强化面与反馈 1/2 条款全部属实。

## 6. 发现清单

**reject 级：无。MINOR：无。**

- **INFO-1（发布面备案）**：SA7 域补充测试 `packages/namespace-diagnostic-log/test/file-adapter-sa7-dynamic.test.ts`（9 用例，dispatch 17c 裁定保留入 CI）当前为**未跟踪文件**，不在本评审 diff（fde8034..HEAD）内；本轴复跑的 138/1719 含该文件，仅 committed HEAD 为 137/1710（均绿）。发布前需将其纳入提交，或以 137/1710 为准登记门禁数字。不影响本 diff 的规格符合性结论。
- **INFO-2（设计文本瑕疵，已闭环）**：设计 §3.4 伪代码对不可锚定行的 `continue`（expected 不变）与正文「不拼接精确缺口」存在字面张力；实现按正文+已绿锚（三变体断言无 `sequence-gap`）以 `expectedSequence=null` 未知基线落地，SA4 §3.1 已判取舍成立、无 false-ok 通道（不可锚定行必携自身 corrupt issue）。建议后续轮次给该伪代码行加注，非本票阻塞项。
- **INFO-3（测试 seam 边界语义备案）**：`appendFinal`（injectFinalRecordFile 直通接缝）正常路径不分配/不推进（设计 §3.3 符合）；其 ambiguous 分支复用 `commitAmbiguous` 会把注入 record 自带 sequence 写入 `lastCommittedSequence` 作 reservation——超出「注入绝不推进」字面，但属 §3.2.1 保守封闭语义且 `mode='failed'` 后该值不再可消费，testing-only seam 无生产面影响。

## 7. 评审留痕

- 规格通读：简报反馈全文/R2-AC、设计 R3 全文（§2/§3/§4/§5.3/§9）、SA6 红灯 29 锚表、dispatch 第 12/14 行 G18–G21、ADR 0011/0012 原文、AC 门禁、SA4（pass）/SA7（pass）。
- 代码审查：reader.ts / file.ts 全量 diff 逐 hunk 比对设计；测试用例体抽查 6 处（capture=false 违规、4097B inline、[1,3] gap、#9 genesis 豁免、R3 sidecar 解耦、assertIsolatedR2Issue 断言器）确认断言真实有效（非锚名空挂）。
- 独立复跑：`diff --check` 干净 / 全仓 typecheck EXIT=0 / 全仓 vitest 138 文件 1719 测试绿 0 type errors（后台独立进程，日志 `.mabf-bg/spec-*.log`）；ADR 0011 diff 0 字节取证。

**Verdict: pass**

---

## R 轮复审（修复-重复规则；M-1 回流，HEAD `f52eccb` → `81a6863`）

**对象**：累计 diff 扩为 `fde8034..81a6863`；delta = 单 commit `81a6863`（3 文件 +3/−3，comment-only，总控裁决 R2-G22 授权）。

| 复审项 | 取证 | 判定 |
|---|---|---|
| delta 内容为纯注释 | `git show 81a6863` 逐 hunk 核验：reader.ts:37（`StrictReadIssue` 文档注释）、storage-gate.ts:30（`StorageIssueCode` 文档注释）、file.ts:486（P_DECIMAL 镜像行注释）——三处均为注释单行替换，**零可执行代码变更** | ✅ |
| 修正后计数属实 | 新表述「reader 稳定码词表共 29 码——23 码 v1 基表 + R2 六码」与既有事实链一致：round-1 基表 23 码（fde8034 reader 头注「23 码词表」）+ R2 §2.6 六码（五 manifest-* record 码 + stream 级 sequence-gap，本报告 §1 已核）= 29 | ✅ |
| 无残留失实计数 | `grep -rn '23 码' src/` 仅存两处新事实表述（均带「29 码 + 基表构成」限定），无第三处残留 | ✅ |
| 无新问题引入 / 规格结论不受影响 | 注释不进入任何规格条款、码表、测试锚；本报告 §1–§5 全部比对结论以行为与测试为据，delta 不触碰任一比对行 | ✅ |
| scope 面 | storage-gate.ts 首次进入累计 diff——不在设计 §8 ALLOW/DENY 清单；属 Standards 轴 M-1 回流、总控 R2-G22 明令的注释修正，DENY LIST 仍零触碰（commit message 备案，本轴复核 diff 确认） | ✅（INFO 级备案） |
| 验证门槛（本轴复跑，后台独立进程） | `git diff --check fde8034..81a6863` 干净（exit=0）；`pnpm typecheck` 全仓 EXIT=0；包套件 `vitest run packages/namespace-diagnostic-log/test` **20 文件 / 314 测试全绿、0 type errors、EXIT=0**（与 commit message 声明一致；含未跟踪 SA7 域文件，INFO-1 备案不变） | `.mabf-bg/spec-r1-pkg-test.log` / `spec-r1-typecheck.log` |

**R 轮结论**：M-1 修复如实、完整、零行为变更，不引入新规格偏差；原评审全部结论保持有效。

**更新后生效 Verdict（fde8034..81a6863）: pass**
