# SA6 红灯报告 — File diagnostic-log adapter R2（issue #152 round=2）

**日期**：2026-08-28（round=2 重派，SA6 红灯锚定阶段）
**权威契约**：`wiki/raw/task_diagnostic-log-file-adapter-r2_design.md`（SA1 R3，393 行；SA2 R2 pass + SA8 R3 delta clear）——族 B 定稿。族 A（旧线/未提交的「Round 2 修订」章、`file-adapter-r2-policy-continuity.test.ts` 旧版）一律不采信，仅处置。
**运行目录**：`/home/wangjian/nomicore-fix-issue-152`（round=1 HEAD `fde8034`，src 未实现 R2 语义；本轮只改测试/fixture/报告，未动 `src/`）。
**红灯验证命令**：`node_modules/.bin/vitest run packages/namespace-diagnostic-log/test`（后台独立进程）
**红灯证据日志（.mabf-bg/ 独立进程）**：
- `.mabf-bg/sa6-red-run.log`（首轮：两 SA6 文件 + supplemental；含 2 个 fixture 缺陷修复痕迹）
- `.mabf-bg/sa6-red-run2.log`（strict-reader 修复后复跑）
- `.mabf-bg/sa6-full-run.log`（全包 19 文件最终态）

**最终红灯统计**：`Test Files 3 failed | 16 passed (19)`；`Tests 29 failed | 276 passed (305)`；`Type Errors no errors`。
- `file-adapter-strict-reader.test.ts`：15 失败 / 45 通过（HEAD 基线 27 条既有用例全绿，零回退；新增 33 条中 18 条绿色护栏/正例 + 15 条红灯锚）
- `file-adapter-r2-policy-continuity.test.ts`：12 失败 / 1 通过（通过项 = genesis confirmed success 正例）
- `file-adapter-r2-supplemental.test.ts`：2 失败（存量族 B 化回改的 reader 断言——预置接缝 [UINT64_MAX] 流对当前 reader 仍判 ok，族 B reader 应在实现后判 corrupt+gap；**非本轮引入**）
- 其余 16 个文件全绿（含 `file-adapter-mismatch-interference.test.ts` EISDIR 锚——复核确认语义中立，见 §4）

---

## 1. 设计 §5.3 十一锚逐锚红灯证据

锚点引用格式：`§5.3 #N`（对应设计）；「族 A 处置」列说明旧版同面断言的处理。红灯证据列写「期望 vs 实测」的实际断言输出（当前 src 实测）。

| # | 锚点（设计 §5.3 / 关联章节） | 文件 · 用例名 | 红灯证据（当前 src 实测） | 族 A 资产处置 |
|---|---|---|---|---|
| 1 | `committedUpdateCapture:false` + attempt `effect:update` → `manifest-update-capture-violation/corrupt`；同 manifest genesis update 合法（§2.2） | strict-reader · `capture=false + attempt committed/effect:update 携带 inline carrier → manifest-update-capture-violation + corrupt`；`capture=false + fatal committed:true/effect:update → 同码`；`capture=false + genesis update carrier → 合法`；`capture=false + update-omitted → 合法` | `expected 'ok' to be 'corrupt'`（violation 二例；现 reader 无 policy 执行） | 族 A 码 `policy-capture-mismatch` → 按 §2.6 改为 `manifest-update-capture-violation`（码表裁决 G18：六码统一） |
| 2 | input policy 精确形状：full/redacted + digest + 唯一 literal 正例；无 marker / 拼写变化 / digest-none+marker 违规；非 digest 带 marker 先 VFSL（§2.3/§5.3 #2） | strict-reader · `正例（唯一合法降级）：full/redacted … → ok`（绿）；`违规：full/redacted manifest + digest 无 marker → …`（红）；`违规：digest/none manifest + digest 带 marker → …`（红）；`违规阶梯：none+full / none+digest / digest+full / digest+redacted / redacted+full → 同码`（红）；`VFSL 先拒：digest marker 拼写/值变化 → vfsl-invalid`（绿）；`VFSL 先拒：非 digest capture 偷带 marker → vfsl-invalid`（绿）；`正例：三种不可得形态 … 均合法`（绿） | 违规三类 `expected 'ok' to be 'corrupt'`；VFSL 先拒类既对（`vfsl-invalid`，经 probe 实证冻结 union 拒错字面量/封闭未知字段） | 族 A `policy-input-mismatch` → `manifest-input-policy-violation`；族 A「none+not-accessed 无违规」控制组被移除（见 §5 设计歧义 2：`none` 行与事实优先原则的张力，本报告未锚定该行，交 SA1 裁决） |
| 3 | 真实 writer 降级产物（full/redacted 超 line budget → digest+唯一 marker）被 strict reader 接受为政策正例（§5.3 #3，防与 #148 schema 漂移） | strict-reader · `inputPolicy=full + full 大 input 超 line budget → … 判 ok`（绿）；`inputPolicy=redacted + redacted 大结构 input 超 line budget → … 判 ok`（绿） | 绿（设计漂移护栏；当前即通过，实现后必须保持） | 族 A 无对应锚；新增。注意：首版 fixture 用 `inputPolicy:'redacted'+字符串 snapshot` 无法触发降级（redact 投影使值变小）——已改用 full/大结构 snapshot 两种可触发形状 |
| 4 | 4097B inline（>4096）与 4096B sidecar（≤4096）→ 各自阈值码；4096 inline / 4097 sidecar 正例；genesis 同测一种（§2.4） | strict-reader · `4097B inline（> 4096）→ manifest-inline-threshold-violation`（红）；`4096B sidecar（≤ 4096）→ manifest-sidecar-threshold-violation`（红）；`正例：4096B inline … → ok`（绿）；`genesis 4097B inline … → 同码`（红） | 三条 `expected 'ok' to be 'corrupt'` | 族 A `policy-threshold-mismatch`（双向一码）→ §2.6 双向两码 `manifest-inline-threshold-violation` / `manifest-sidecar-threshold-violation`；族 A 的 100B-sidecar 违规例保留原意但改用设计钉死的边界 4096/4097 |
| 5 | 原始行 UTF-8 字节超 `jsonlLineLimitBytes` → `manifest-line-limit-exceeded`；等于上限正例（§2.5） | strict-reader · `多字节内容使原始行 UTF-8 字节数超上限（JS 字符数未超）→ …`（红）；`等于上限 → 正例 ok`（绿）；`超限且不可解析 → 同时报 … 与 invalid-json`（红） | 多字节例 `expected 'ok' to be 'corrupt'`；超限+坏 JSON 例 `expected ['invalid-json'] to include 'manifest-line-limit-exceeded'` | 族 A `policy-line-limit-exceeded` → `manifest-line-limit-exceeded`；族 A 的「空白填充」fixture 因 JSON 前导非法已被替换为「多字节内容置于 record 内」的字节计量锚（首版用 `'界'×100` 作行前缀 → 非法 JSON，属 fixture 缺陷，已修正） |
| 6 | `[1,3]` → gap/corrupt；起始 `[2]`、跨 segment gap、重复/倒序仍覆盖；R3：`[1,2(sidecar 坏),3]` 无假 gap、物理删 JSONL 2 必 gap（§3.4） | strict-reader · `[1,3]（物理删除 seq 2）→ …`（红）；`起始 [2] → sequence-gap`（红）；`跨 segment：seg1=[1] + seg2=[3] → sequence-gap`（红）；`跨 segment 正例 … → ok`（绿）；`R3 解耦：[1 inline, 2 sidecar-bin 被删, 3 inline] → … 不得产生虚假 sequence-gap`（绿）；`R3 解耦：[1 inline, 2 sidecar 帧 CRC 损坏, 3 inline] → …`（绿）；`身份不可解释行（VFSL 违规/坏 JSON/streamId 不一致）… 无 sequence-gap`（绿，3 条）；`物理删除 JSONL 2 且 .bin 保留帧 2 → 仍必须 sequence-gap`（红） | gap 四条 `expected 'ok' to be 'corrupt'` + `expect(issueCodes(read.issues)).toContain('sequence-gap')` 失败；解耦/不可解释行护栏全绿（现 reader 已符合 §3.4 该面） | 族 A `sequence-start-invalid` 码删除（G18：起点固定 1n，`[2]` 归 `sequence-gap`）；族 A「genesis 缺失则首条 '2' 合法」语义废止 |
| 7 | append seam 模拟「完整 JSONL 行写入后抛 EIO」（ambiguous）：不写第二条同 sequence、旧 generation failed/readonly、`sequence N may not be persisted` 健康证据、不得伪作同 generation 连续恢复（§3.2.1/§5.3 #7） | policy-continuity · `JSONL write 期 ENOSPC（/dev/full）→ 恢复后同 generation 零新增（密封）…`（红）；`sidecar BIN-first：JSONL write 期 ENOSPC → BIN orphan 保留、JSONL 零新增、同 generation 密封`（红）；`ambiguous 与 definitive 的可观察差异…`（红） | `expected '1' to be '3'`（恢复后同 generation 继续写 seq 3——未密封）；`缺少「sequence 2 may not be persisted」可观察证据（events=[storage-write-failed jsonl ENOSPC] logLines=[]）`；BIN 侧 `expected 8244 to be 12366`（当前 3 帧，族 B 应 2 帧：保守封闭保留 orphan） | 族 A 无 ambiguous/definitive 分类锚（其「分配即消耗」无失败分类）——全新增。**注入说明**：设计 §3.2.1 的「append seam」按「有 seam 可依赖」起草，本 SA6 改用**无新接缝的真实运行失败注入**：JSONL 路径替换为 `/dev/full` 符号链接（open 成功、write(2) 恒 ENOSPC——write 期失败，非「打开前确定零字节」三类 → 设计默认归 ambiguous，禁 errno 猜零写入）；definitive 用目录占位 EISDIR/open 期 ENOENT。若 SA3 实现自定义 seam，本组测试不依赖其存在、不冲突 |
| 8 | seam/EISDIR·EACCES·ENOENT 证明零字节（definitive pre-commit）：candidate 可安全复用、恢复后同 candidate、不形成 gap（§3.2.1/§5.3 #8） | policy-continuity · `jsonl 目录占位（open 期 EISDIR）→ 恢复后 … 同一 candidate（"1"）、reader ok 无 gap`（红）；`bin 目录占位（… BIN-first open 期 EISDIR）→ … 复用 "1"、frame offset 0、reader ok`（红）；`segments 目录删除（open 期 ENOENT）→ 恢复后复用 "1"`（红） | `expected '1' to be '2'` ×3（当前分配即消耗；恢复后成功记录跳到 '2'） | 族 A 无「零字节可证明失败 → 复用」锚——全新增；与族 A `sequence-start-invalid`+「gap 合法」叙事不兼容，按 G18 以族 B 为准 |
| 9 | capture=false manifest 下合法 genesis(1,update)+合法 attempt(2) → 不得 sequence-gap（genesis 正交+policy/anchor 解耦）（§3.4/§5.3 #9） | strict-reader · `#9 capture=false + 合法 genesis(1,update) + 合法 attempt(2,noop) → ok、零 issue、无 sequence-gap`（绿） | 绿（护栏：现 reader 已满足；实现后不得回归） | 族 A 无此锚——新增回归锚 |
| 10 | seq2 中间 record manifest-policy 违规 → 报 policy corrupt issue，且 seq3 无虚假 gap（§3.4/§5.3 #10） | strict-reader · `#10 capture=false + [genesis(1,update), attempt(2,update 政策违规), attempt(3,noop)] → record2 政策 corrupt；序列 2 不得使 record3 产生虚假 sequence-gap`（红） | `expected 'ok' to be 'corrupt'`（当前无 policy 执行；[1,2,3] 判 ok） | 族 A 无此锚——新增 |
| 11 | confirmed `UINT64_MAX` 恰一次 exhausted 后零 record；ambiguous max 不发 exhausted 且密封 generation；definitive 后同 candidate 可重试（§3.3/§5.3 #11） | policy-continuity · `confirmed UINT64_MAX → 恰一次 …`（红——reader 断言面）；`definitive 失败于 max 候选 → 不发 stream-exhausted；恢复后同 candidate 落盘且恰一次 exhausted`（红）；`ambiguous 失败于 max 候选 → 不发 stream-exhausted（未确认耗尽）、密封 generation`（红） | confirmed 例：`expected 'corrupt' to be 'ok'`（reader 对 [UINT64_MAX] 无 gap 检查）；definitive 例：`expected [ { type: 'stream-exhausted' } ] to have a length of +0 but got 1`（当前分配即 exhausted，先于确认落盘）；ambiguous 例：同「0 vs 1」 | 族 A「分配即 exhausted」语义废止；consume 时点改为「confirmed JSONL success」（§3.3）。与 r2-supplemental 已回改的 2 处预置接缝断言一致（预置流对族 B reader 判 corrupt+gap） |

**中断门禁结论**：红灯稳定可复现（29 项失败全部为契约违规证据，无 fixture 性死锁/无不可复现；三轮复跑结果一致）。不触发「无法复现」门禁。

---

## 2. 缺锚补齐清单（相对族 A 旧文件）

- `manifest-sidecar-threshold-violation` 独立码（族 A 双向一码）；
- `sequence-gap` 的：起始 `[2]`、跨 segment、`.bin` 保留帧的物理删除变体；
- `[1,2(sidecar bin 删/CRC 坏),3]` 无假 gap 双变体（§5.3 #6 R3）；
- 身份不可解释行（坏 JSON/vfsl/streamId）不拼接精确缺口 3 变体（§3.4 末段）；
- 真实 writer 降级产物正例 ×2（full/redacted 两形态，§5.3 #3）；
- ambiguous（write 期 ENOSPC）inline + sidecar-BIN-orphan 双场景 + max 变体；definitive（EISDIR jsonl/bin、ENOENT）三场景 + max 变体（§5.3 #7/#8/#11）；
- genesis 0 字节/超 payloadMax 守卫不消耗 + genesis confirmed 正例（§3.3）；
- line 预算 gate drop 不消耗（§3.2 candidate 前门禁）；
- 每 record issue → stream issue 全量镜像断言（§2.1「mirror every record issue」）；
- 多字节 UTF-8 字节计量 line-limit 锚（§2.1 原始字节定义）。

## 3. 存量回改复核（dispatch 11c 记录的 4 处；dispatch 13 备案本 SA6 复核）

| 存量回改 | 复核结论 | 处置 |
|---|---|---|
| `test/helpers/file.ts`：`validManifest` 默认 `committedUpdateCapture: true` | ✅ 正确。默认夹具 record 携带 update carrier，policy 校验（§2.2）下必须与 manifest 一致，否则基线夹具自判 corrupt | 保留，不再动 |
| `file-adapter-strict-reader.test.ts`：sidecar 帧载荷 4097B ×2（`第二个 frame offset 非连续` + `纯侧车正例交叉验证`） | ✅ 正确。4096B sidecar 在族 B `manifest-sidecar-threshold-violation`（§2.4，≤ 阈值必 sidecar 即违规）下不再构成静默正例；4097B 保持 sidecar 合法 | 保留（本轮已在其上叠加 4096B sidecar 违规锚） |
| `file-adapter-r2-supplemental.test.ts`：预置 exhausted ×2 改为 `corrupt + sequence-gap('1')` | ⚠️ 方向正确（族 B：预置流非自 1 连续 → 诚实 gap），但**归因字段过钉**：设计 §3.4 状态机以「发现缺口的 record」的 segment/offset/sequence 归因 issue（与 `sequence-out-of-order` 兄弟码一致），断言 `i.sequence === '1'`（缺失值语义）与族 B 伪代码文本不符 | 已放宽为 `expect(…).some((i) => i.code === 'sequence-gap')`（归因不绑具体值），并加注依据 |
| `file-adapter-mismatch-interference.test.ts` EISDIR 恢复两断言（dispatch 12(d) 指定复核） | ✅ 语义中立确认。`ns-binfirst-1`/`ns-binfirst-3` 未钉死具体 sequence 值：族 A「分配即消耗」下恢复记录为 seq 3/2，族 B「definitive 复用」下为 seq 2/1——两个语义下的断言 `read.status === 'ok'` 恰好都在「该语义正确实现时」成立（族 A 现状绿；族 B 最终态需 writer+reader 双修后仍绿）。它实际构成「EISDIR 后连续恢复」的行为回归护栏 | 无需回改（复核确认） |

## 4. 族 A 资产处置汇总

| 族 A 资产 | 处置 |
|---|---|
| `file-adapter-r2-policy-continuity.test.ts`（380 行，族 A 语义） | **整体重写**为族 B 定稿（writer 面：提交点/definitive/ambiguous/exhausted；码表/起始值语义全部换成 §2.6/§3.4）；族 A 的 `policy-*` 四码、`sequence-start-invalid`、`[2]→起始非法`、`genesis 缺失首条 '2' 合法`、`分配即消耗`、`分配即 exhausted` 叙事全部废止 |
| `file-adapter-strict-reader.test.ts` 旧 R2 相关（`boundary`/`正例` 等 4097B 一致化） | 保留（已族 B 化），本轮叠加新增 11 锚 reader 面 |
| wiki/raw/task_diagnostic-log-file-adapter.md / `_design.md` 未 commit 的「Round 2 修订」章 | 族 A 语义文档，仅对照、不采信（G18）；**未修改** |
| 旧 SA6 线的 `sequence === '1'` 归因断言 | 放宽为 gap 存在性（见 §3 第三行） |

## 5. 需要 SA1/总控裁决的设计文本歧义（不阻塞本轮红色契约，但影响实现终态）

1. **§2.3 input policy 表的 `{capture:'none'}` 违规行**：表在 digest/redacted/full 行的违规例中列出 `none`；但 `projectInput`（src/projection/input.ts:58）在所有 policy 下对「无 input 的 emission」产出 `{capture:'none'}`，且 `input-capture.test.ts:31` 冻结该行为（四策略皆同）。若 reader 严格按表执行，健康 writer 的常规无 input 记录（含既有 `AC4 正例`、`mismatch/interference` 等多处基线）会被判 `manifest-input-policy-violation`，与「事实优先于策略 + writer 自洽」冲突。本报告**未锚定**该行（被锚定的都是无歧义面）；建议 SA1 明确「`{capture:'none'}`（无 input emission）在所有 policy 下恒合法；policy 违规仅为 capture-class 强于 policy 阶梯 + marker 双向规则」并微调表，否则实现按现表将击穿多个既有基线。
2. **`sequence-gap` issue 的归因字段**：§3.4 伪代码 `add stream issue sequence-gap (segment/offset/sequence)` 未明示取值；本报告按「发现缺口的 record」（与 `sequence-out-of-order` 兄弟码一致）锚定，且两测试文件均未把 `sequence` 字段值钉死（只钉 segment/offset），对两种实现均稳健。
3. **`may not be persisted` 证据通道**：§3.2.1 要求「health payload 或 log line」；健康词表冻结（`storage-write-failed` 无 sequence 字段），故本报告断言覆盖 **events 序列化文本 ∪ fallbackLog 行** 两通道任一含 `sequence <candidate> may not be persisted` 即可。实现可任选通道，但需经 fallbackLog 或扩展事件字段之一呈现（SA4/SA7 已验证口径）。

## 6. 交付物与命令回放

- `packages/namespace-diagnostic-log/test/file-adapter-strict-reader.test.ts`（+~660 行 R2 锚；包含 2 处既有用例补充断言与 4097B 一致化保留）
- `packages/namespace-diagnostic-log/test/file-adapter-r2-policy-continuity.test.ts`（全重写，13 用例）
- `packages/namespace-diagnostic-log/test/file-adapter-r2-supplemental.test.ts`（2 处断言放宽 + 注释）
- `packages/namespace-diagnostic-log/test/helpers/file.ts`（复核确认，未改动）
- 回放：`cd /home/wangjian/nomicore-fix-issue-152 && node_modules/.bin/vitest run packages/namespace-diagnostic-log/test` → 29 failed / 276 passed / 0 type errors（复跑两次一致）
- 日志：`.mabf-bg/sa6-red-run.log`、`.mabf-bg/sa6-red-run2.log`、`.mabf-bg/sa6-full-run.log`

实现与修绿属于 SA3：实现侧仅需 `src/reader.ts`（六码 + §2.2–§2.5 per-record per-line 政策 + §3.4 连续性状态机 + 归因）与 `src/adapters/file.ts`（§3.2 双阶段/§3.2.1 分类/§3.3 genesis+exhausted）按设计落地；本组测试不要求新增 append seam（真实 /dev/full 与 EISDIR/ENOENT 已覆盖 definitive/ambiguous 两分类的可观察面）。
