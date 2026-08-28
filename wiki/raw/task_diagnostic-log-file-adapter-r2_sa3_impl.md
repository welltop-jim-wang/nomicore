# SA3 实现报告 — File diagnostic-log adapter R2（issue #152 round=2）

**日期**：2026-08-28
**权威契约**：`wiki/raw/task_diagnostic-log-file-adapter-r2_design.md`（SA1 R3，SA2 R2 pass + SA8 R3 delta clear）+ 总控勘误裁决 R2-G19/G20/G21（dispatch 第 14 行）
**红灯基线**：`wiki/raw/task_diagnostic-log-file-adapter-r2_sa6_red.md`（29 failed / 276 passed / 0 type errors，exit=1）
**实现 commit**：`f52eccb`（branch `fix/issue-152-on-docs-namespace-diagnostic-change-log`；10 文件 +1498/−134；**未 push**，wiki 档案由总控统一 commit）

---

## 1. 变更清单

| 文件 | 变更 |
|---|---|
| `packages/namespace-diagnostic-log/src/reader.ts`（ALLOW） | ① 新增 `ManifestFormatPolicy`（manifest 严格门通过后提取的只读四值，`extractFormatPolicy` 防御性复核）；② 原始字节行分割 `splitRawLines`——按 0x0A 字节扫描，行字节数 = 原始 UTF-8 字节排除单个 `\n`（多字节行逐行解码，避免 whole-buffer 字节索引切串错位）；③ §2.5 行长检查先于 JSON.parse（超限且不可解析 → 同 record 携带 line-limit + invalid-json）；④ §2.2 update-capture 政策（capture=false 的 attempt 携 carrier → `manifest-update-capture-violation`；genesis 正交豁免）；⑤ §2.3 input-policy 政策（R2-G19：`{capture:'none'}` 全 policy 恒合法；not-accessed/unavailable/unsafe-input 在 none 下仍违规；digest±marker 双向规则 + 防御镜像）；⑥ §2.4 双向阈值（carrier 本体校验成功后才运行：inline `N>阈值` / sidecar `N≤阈值`）；⑦ §3.4 连续性状态机（`expectedSequence: bigint|null = 1n` 起点固定 1；跨 segment 不重置；anchor 仅 = JSON/VFSL/canonical/streamId；policy/storage 违规不取消锚定；身份不可解释行置未知基线、不拼接精确缺口；`sequence-gap`/`sequence-out-of-order` 归因 = 发现问题的物理 record 的 segment/offset/sequence——R2-G20）；⑧ 六新码不入 `INCOMPATIBLE_SET`（corrupt + records 逐条保留），文档注释同步 |
| `packages/namespace-diagnostic-log/src/adapters/file.ts`（ALLOW） | ① `lastSequence` → `lastCommittedSequence`（仅 confirmed success / ambiguous reservation 写入）；② `allocate()` → 无副作用 `candidateSequence()` + `commitConfirmed()`（UINT64_MAX → 恰一次 stream-exhausted）+ `commitAmbiguous()`（reservation + `sealed` + mode='failed' + storage-write-failed 字段照发 + fallbackLog「sequence N may not be persisted」行——R2-G21）；③ `writeRecord` 拆为 `prepareRecord`（line 预算 → VFSL → P_DECIMAL 镜像 → storage 门；失败返回 undefined、**不消耗 sequence**）+ `commitRecord`（encode 自检 → BIN-first → JSONL；`classifyAppendFailure`：EISDIR/EACCES/ENOENT = definitive（零字节可证明，candidate 可复用），其余 = ambiguous（保守封闭，绝不复用））+ `commitPrepared`（提交点物化 candidate）；④ `runGenesis`：守卫/投影/门全在 candidate 前（0 字节/超 payloadMax/offsetFailed 不消耗；confirmed success 提交 '1'；append 失败与 attempt 同一分类）；⑤ 构造期 genesis ambiguous 密封经 `sealed` 标记不被 mode='ready' 覆盖；⑥ inject 路径（appendFinal）不推进/不分配，ambiguous 同样保守封闭 |
| `docs/adr/0012-vfsl-validated-jsonl-and-framed-sidecar-change-log.md`（ALLOW） | 见 §4 |
| `packages/namespace-diagnostic-log/README.md`（ALLOW） | 同步写契约 amendment 化（有界同步 append 的定义、write-slot 外接线 MUST 纪律、无 fsync 承诺、R2 提交点纪律）；「两个声明」新增 strict `ok` 语义边界（自 sequence 1 连续 + 通过校验；物理删除 [1,3] → gap/corrupt） |
| `packages/namespace-diagnostic-log/AGENTS.md`（ALLOW） | Boundaries 新增：sync File adapter emit 不得在 namespace write slot 内接线（ADR-0012 amendment MUST；接线归 #149–#151/#155）；sequence 提交点纪律（definitive 复用 / ambiguous 封闭，禁回退「分配即消耗」） |
| `packages/namespace-diagnostic-log/package.json`（硬门禁 9） | `0.1.1` → `0.1.2` |
| `test/file-adapter-r2-supplemental.test.ts`（SA6 域，一处夹具政策一致化） | 见 §6 遗留说明 3：R-1a 100B sidecar 夹具加 `inlineUpdateMaxBytes: 64` manifest 覆盖（同文件 EISDIR/truncate 用例的 64 阈值先例） |
| 其余测试文件（strict-reader / policy-continuity / helpers） | 仅 SA6 既有红灯契约内容，本次 commit 含其最终态（helpers 为 SA6 `validManifest` 默认 capture:true 修订） |

DENY LIST 全程零触碰：`record.ts` / `schema.ts` / `vocabulary.ts` / `pipeline.ts` / `adapters/memory.ts` / `docs/adr/0011-*.md` / `packages/namespace-runtime/**` 均未修改。

## 2. 逐红锚转绿证据（29/29）

最终态全量命令（后台独立进程）：`node_modules/.bin/vitest run packages/namespace-diagnostic-log/test` → **Test Files 19 passed (19)；Tests 305 passed (305)；Type Errors no errors；EXIT=0**（日志 `.mabf-bg/sa3-full-run.log`；中途 3 文件聚焦态 `.mabf-bg/sa3-red3-run.log` 亦 94/95 通过冗余校验）。基线 `.mabf-bg/sa3-baseline-red.log`：29 failed / 276 passed / exit=1——与 SA6 报告逐字一致。

**strict-reader 15 红**（全部转绿；`expected 'ok' to be 'corrupt'` 类断言现为 pass）：

| # | SA6 红锚（用例） | 实现落点 |
|---|---|---|
| 1 | capture=false + attempt committed/fatal 携 inline carrier → `manifest-update-capture-violation`+corrupt；genesis update / update-omitted 合法 | §2.2 `carrierFromParsed` + genesis 豁免 |
| 2 | full/redacted + digest 无 marker → 违规；digest/none + digest 带 marker → 违规；违规阶梯（none+full/none+digest/digest+full/digest+redacted/redacted+full）→ 同码；VFSL 先拒两类（marker 拼写/非 digest 偷带）保持 `vfsl-invalid` 不归 policy 码 | §2.3 `inputPolicyViolation`（G19 + marker 双向） |
| 3 | 真实 writer 降级产物（full/redacted 超 line budget → digest+唯一 literal）判 ok（漂移护栏，保持绿） | §2.3 对 `{capture:'digest', degraded:'projected-input-too-large'}` 在 full/redacted 下合法 |
| 4 | 4097B inline → `manifest-inline-threshold-violation`；4096B sidecar → `manifest-sidecar-threshold-violation`；4096B inline 正例；genesis 4097B inline 同码 | §2.4（carrier 校验通过后） |
| 5 | 多字节原始行超限 → `manifest-line-limit-exceeded`；等于上限正例；超限+坏 JSON → 双码 | §2.5 原始字节计量 + 先于解析 |
| 6 | [1,3] → gap+corrupt（归因 offset 1）；起始 [2] → gap（offset 0）；跨 segment [1\|3] → gap（seg2 offset 0）；[1,2(sidecar 坏),3] 无假 gap（bin 删/CRC 坏双变体）；身份不可解释行（坏 JSON/VFSL/streamId）无 gap；物理删 JSONL 2 且 bin 保留帧 2 → 仍 gap | §3.4 状态机 + anchor 最小前提 + 未知基线不拼接 |
| 10 | capture=false + [genesis(1,update), attempt(2 违规), attempt(3,noop)] → record2 恰一 policy 码、record3 无假 gap | §2.2 + §3.4 解耦 |

**policy-continuity 12 红**（全部转绿）：

| # | SA6 红锚 | 实现落点 |
|---|---|---|
| 1 | line 预算 gate drop → 后续 record '1' | candidate 前门（prepareRecord 返回 undefined） |
| 2/3 | genesis 0 字节 / 超 payloadMax 守卫跳过 → 首 attempt '1' | runGenesis 守卫先于 candidate |
| 4/5/6 | jsonl EISDIR / bin EISDIR（BIN-first）/ segments ENOENT definitive → 恢复后同 candidate '1'（bin 恢复后 frameOffset '0'），reader ok 无 gap | definitive 分类不消耗 candidate + fresh-stat |
| 7/8 | JSONL write 期 ENOSPC（/dev/full）ambiguous：恢复后同 generation 零新增（inline ['1']）；sidecar 场景 bin 恰 2 帧（orphan 保留）、JSONL 零新增；两场景均含「sequence 2 may not be persisted」可观察证据 | `commitAmbiguous` reservation+sealed+fallbackLog 行（G21） |
| 9 | ambiguous/definitive 可观察差异（事件面存在） | 同上（事件通道存在性锚） |
| 10 | confirmed UINT64_MAX 恰一次 stream-exhausted、落盘、后续零落盘；reader corrupt+sequence-gap | `commitConfirmed` 恰一次 |
| 11 | definitive 失败于 max 候选 → 不发 exhausted；恢复后同 candidate 落盘且恰一次 | exhausted 仅在 confirmed success |
| 12 | ambiguous 失败于 max 候选 → 不发 exhausted、密封（恢复也不得写） | 同上 + seal |

**r2-supplemental 2 红**：预置 UINT64_MAX−1 流 / genesis-exhausted 预置流 → reader `corrupt + sequence-gap` 存在（record 级 ok 仍 true）——§3.4 起点固定 1 的诚实 gap（SA6 归因放宽为存在性，与 G20 不冲突）。

## 3. 测试命令与退出码

| 命令 | 结果 | 证据日志 |
|---|---|---|
| `node_modules/.bin/vitest run packages/namespace-diagnostic-log/test`（基线，实现前） | 29 failed / 276 passed / 0 type errors，EXIT=1 | `.mabf-bg/sa3-baseline-red.log` |
| `node_modules/.bin/vitest run packages/namespace-diagnostic-log/test`（实现后） | **305 passed (305)**，0 type errors，EXIT=0 | `.mabf-bg/sa3-full-run.log` |
| `pnpm test`（vitest run --typecheck 全仓） | **137 files / 1710 tests 全绿**，0 type errors，EXIT=0 | `.mabf-bg/sa3-pnpm-test.log` |
| `pnpm typecheck`（全仓 10 包） | 0 错误，EXIT=0 | `.mabf-bg/sa3-typecheck.log` |
| `git diff --check` | 干净，EXIT=0 | — |

所有测试均经 `setsid nohup` 独立进程后台运行，日志/退出码落 `.mabf-bg/`。

## 4. ADR-0012 amendment 落点

`docs/adr/0012-vfsl-validated-jsonl-and-framed-sidecar-change-log.md`（状态保留 `accepted`，ADR-0011 正文未动）：

1. **`### Writer、append 与背压` 段内**（「默认周期 batch flush…」段之后、「### Segment rolling 与耗尽」之前）新增 `#### Amendment — File adapter first slice（2026-08-28，issue #152 round 2）`：① 以首切片条款取代 queue 必然性与「默认周期 batch flush」两句在本首切片范围内的强制力——每 emit 至多一条 final JSONL record 的有界同步 append（sidecar 则 BIN-first 至多一帧），无 writer queue / 无 batch / 无 fsync 开关 / 无常驻 fd，同步 append 完成不构成 fsync 或掉电持久性承诺；②「有界」定义（数据量/操作数受 payload/line limits 与单 record/单帧限制，不代表磁盘延迟有上界、不代表任意调用点不阻塞）；③ **规范性接线条件**：任何接入 namespace 生命周期的 File adapter `emit` 调用点必须位于 NamespaceRuntime write sequencer slot 之外或释放后（slot 内接线不合规，由 #149–#151/#155 修复后方可启用），`emit` 保持 void/non-throwing/no-durability-promise；④ 演进路径：未来切片可在不改 emitter seam/record schema/manifest policy/write-slot 隔离的前提下替换为每 stream 至多一逻辑 writer queue + 有界队列/周期 batch flush（须另行定义 close/shutdown/flush/满队列/fsync 语义）。
2. **`## 被否方案`** 新增 4 条：不修订 ADR 即称同步为 queue/batch 细节；同步 emit 在 write slot 内执行；把「有界」解释为磁盘延迟承诺；现在直接实现异步 queue/batch 回避修订。
3. **`## 后果`** 新增首切片取舍条：同步可观察性/无常驻 fd 简化 EISDIR 恢复、消除内存—磁盘孪生态；代价 = 调用方线程可能被文件系统阻塞——只有 write-slot 外接线保持 ADR-0011 业务隔离，未来 queue/batch 需独立设计故障/寿命语义。

设计 §4.4 的 SA8 五条解除条件对应（取代关系 / seam 保持 + slot 外 MUST / 演进保留非同时强制 / 提交点分配 / 码表不改冻结面）均已覆盖。

## 5. 设计歧义处置（实现侧裁决，供 SA4/SA7 及总控复核）

1. **§3.4 伪代码与 §5.3 锚 6 的张力（SA6 报告 §5.1 之外新发现）**：伪代码对不可锚定行 `continue`（expected 不变）会让其后首条可信记录报 gap——与 §3.4 末段「不把可见的下一条与其前一条拼接出精确缺口」及 SA6 已绿返回锚（坏 JSON / VFSL 违规 / streamId 不一致三变体均断言**无** `sequence-gap`）直接冲突。实现采 §3.4 正文 + 已绿锚：不可锚定行将基线置未知（`expectedSequence = null`），其后首条可信记录建立新基线（不推断数值缺口）。若总控认为伪代码为唯一权威，需 QA 复核此点。
2. **definitive 分类的实现方式**：无 append seam 依赖（SA6 明示不要求）；以 errno 封闭集 {EISDIR, EACCES, ENOENT} 判定 definitive（设计列出的三类 open 期零字节可证明失败），其余默认 ambiguous（ENOSPC 不猜零写入）。理论上的 write 期 EACCES 会误归 definitive——实践中 open 成功后写 EACCES 极罕见，且比「一律 ambiguous」更贴合设计的恢复语义（EISDIR 占位恢复锚依赖它）。
3. **R-1a 夹具政策一致化（SA6-owned 文件）**：`file-adapter-r2-supplemental.test.ts` R-1a（frameOffset "0125" 前导零）的 100B sidecar 在默认 4096 阈值下按 §2.4 为 `manifest-sidecar-threshold-violation`，会污染「首帧照常 ok」隔离断言——与 SA6 本轮对 strict-reader「4097B ×2 政策一致化」属同一类既有夹具与族 B 定稿的冲突，按同批先例把该夹具 manifest 覆盖为 `inlineUpdateMaxBytes: 64`（同文件 EISDIR/truncate 用例先例；100 > 64 → 政策正例），断言语义未变。若 SA4 判范围越界，可回退该夹具改动并要求 SA6 重锚（需同步放宽/重构造该用例）。

## 6. 遗留风险

| 风险 | 处置/现状 |
|---|---|
| §3.4 伪代码 vs 已绿锚（上表 1） | 实现取正文+锚；若下游按伪代码字面复审需裁决 |
| definitive 分类边界（errno 封闭集） | 记入 §5.2；EACCES write 期误分类概率极低 |
| BIN-ok + JSONL-definitive 交错：设计伪代码允许 candidate 复用 → 同 sequence 第二帧 + unreferenced orphan；后续 sidecar 引用可能被判 frame-boundary-invalid（best-effort 诚实） | 无测试锚覆盖；按设计伪代码实现；记录为已知容忍 |
| inject 路径 ambiguous → 保守封闭（mode=failed） | 设计 §5.2 未细述注入失败面；保守方向与 emission 一致 |
| lineage：emit 在 write slot 内的接线风险 | 已在 ADR-0012 amendment 以 MUST 成文；实施归 #149–#151/#155（DENY LIST 未动） |
| 行长检查以文件当前字节为准（reader 静态流前提） | 与 README「静态 stream」声明一致；不承诺与活跃 writer 并发一致性 |

## 7. 交付回放

```text
git commit f52eccb （未 push）
git status 遗留：REPORT.md（M）、wiki/raw/**（总控域：M/MM/?? 均为 SA6+总控资产，未纳入本 commit）
```

---

## 8. 终审回流 M-1 修复（双轴终审 R2-G22 裁决，必修项）

**来源**：终审 Standards 轴——本轮新增六码后「23 码封闭词表」计数失实三处。
**修复**：仅改注释、零行为变更；DENY LIST 不变；commit `81a6863`（未 push）。

| 文件:行 | 改动（23 → 29 码等价如实表述） |
|---|---|
| `packages/namespace-diagnostic-log/src/reader.ts:37` | StrictReadIssue doc：`23 码封闭词表` → `reader 稳定码词表共 29 码——23 码 v1 基表 + R2 六码；见文件头注` |
| `packages/namespace-diagnostic-log/src/storage-gate.ts:30` | StorageIssueCode doc：`reader 23 码词表` → `reader 29 码词表中 storage/frame 交叉面——23 码 v1 基表 + R2 六码` |
| `packages/namespace-diagnostic-log/src/adapters/file.ts:486` | 注释：`复用 reader 23 码既有的 vfsl-invalid` → `复用 reader 29 码词表既有的 vfsl-invalid` |

**计数依据**（核实过程）：23 码 v1 基表 = incompatible 7（dialect-unknown / schema-fingerprint-mismatch / record-version-unknown / frame-version-unknown / frame-payload-type-unknown / frame-flags-nonzero / frame-reserved-nonzero）+ manifest/locator/identity 6（manifest-invalid / locator-invalid / invalid-json / vfsl-invalid / stream-mismatch / reference-invalid）+ storage/frame 交叉 9（base64-invalid / base64-length-mismatch / crc-mismatch / frame-missing / frame-magic-invalid / frame-sequence-mismatch / frame-length-mismatch / frame-crc-mismatch / frame-boundary-invalid）+ sequence-out-of-order 1 = 23；本轮六码（manifest-update-capture-violation / manifest-input-policy-violation / manifest-inline-threshold-violation / manifest-sidecar-threshold-violation / manifest-line-limit-exceeded / sequence-gap）= 29。

**验证**：
- `node_modules/.bin/vitest run packages/namespace-diagnostic-log/test`（setsid nohup 后台独立进程）→ **20 files passed (20)；Tests 314 passed (314)；Type Errors no errors；EXIT=0**（日志 `.mabf-bg/sa3-m1-rerun.log`：314 = 305 修改轮态 + 本轮新增 9 测试）
- 三处修复后 `grep -rn "23 码" src/` 残留仅为新表述内部的「23 码 v1 基表」事实引用（等价如实表述），无失实旧措辞。`git diff --check` 对本次改动干净。
