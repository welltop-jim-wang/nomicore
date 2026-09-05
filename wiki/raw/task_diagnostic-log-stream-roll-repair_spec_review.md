# Spec 轴终审报告 — Issue #153 Reopen streams, roll segments, and repair provable tails

- **审查会话**：双轴终审 Spec 轴（独立审查，未与 Standards 轴交换上下文）
- **Worktree**：`/home/wangjian/nomicore-fix-issue-153`（branch `fix/issue-153-on-docs-namespace-diagnostic-change-log`）
- **审查 diff 范围**：`git diff 8611e68..215a18e`（基线 8611e68 = #152 merge commit；3536360 = SA3 实现；001ff80 = SA7 补验；215a18e = Phase 4 回流 3H+N1 修复——注释与测试护栏 only；首轮审查面为 8611e68..001ff80，R 轮 delta 复审见 §9）
- **对照基准**：任务简报（`….md`）、AC checklist、设计定稿 670 行（`…_design.md`，SA8 clear + SA2 pass + N1/N2）、dispatch log 行 10 总控裁决 G1–G4、ADR-0012（含 2026-08-28 amendment）、ADR-0011
- **diff 构成**：src 4 文件（file.ts +344 净值 / reader.ts +567 / paths.ts +12 / health.ts +15）+ package.json bump + README/AGENTS + 测试 7 文件（1 新建主红灯 1239 行 + 1 新建 SA7 补验 241 行 + 5 修改）+ wiki 档案。全在 §16 ALLOW LIST 内；DENY LIST 零触碰（record/schema/vocabulary/pipeline/emission/sink/memory/frame/storage-gate/carrier/crc32c/canonical-json/digest/schema-patterns/index/testing/docs/adr 均无 diff 行）。

## Verdict: **pass**（R 轮 delta 复审后维持——215a18e 纯注释/测试护栏性质确认，spec 结论不变，验证门槛复跑全绿；见 §9）

五条 AC 全部有实现落点与真实测试锚；设计 §3–§12 逐节对照一致；G1–G4 全部落实；零范围蠕变；验证门槛独立复跑全绿。未发现阻断项。非阻断观察 3 条（见下），均系已裁决/已记档面或保守方向偏差。

---

## 1. 五条 AC 逐条核验

### AC1 健康 stream 跨重启 reopen、续接 sequence 与 append 顺序、单逻辑 writer — ✅ 满足

- **实现落点**：`src/adapters/file.ts` 构造主流程（`resolveResumeCandidate` 三分支 → `analyzeStreamForResume` → 种子装配 + `writeCurrent` 愈合）；`src/reader.ts:684+` `analyzeStreamForResume`（与 reader 共享 manifest 门/行分割/逐行校验/连续性状态机）；resume 后 `lastCommittedSequence`/`currentSegment`/三计数器从磁盘扫描派生（§6.3 种子）。
- **测试锚**：`file-adapter-reopen-roll-repair.test.ts` §13.1（L143 无 resumeStreamId 重启同 streamId 续写）、§13.2（L175 current.json 指向稳定 + sequence 全序）、§13.3（L193 显式处置路径）；§13.12（L466 修复后种子推演）；SA7 活链路 E2E（sa7_report §2-S1 真进程退出链 A→B→C）。
- **单逻辑 writer**：无锁原语新增（设计 §1.2 部署约束立场），README/AGENTS 重申单进程独占根目录。emit 同步在调用栈内（amendment 边界），顺序复用语义成立。
- **补充核验**：resume 路径不写 genesis（`initializeGeneration` 只在 fresh/rotate 走；resume 分支直接种子装配）——符合 §8.1「genesis 系新 stream 义务」；`presetLastSequence` 仅 fresh 生效（`file.ts:862` 在 `initializeGeneration` 内；resume 分支被扫描值覆盖）。

### AC2 JSONL/BIN 成对滚动、target 达到时写下一条前滚动、固定编号、显式耗尽 — ✅ 满足

- **实现落点**：`beforeCommit()`（`file.ts` §6.2 唯一新增调用点，在 `commitPrepared` 内 `candidateSequence()` 之前）；三计数器（`segJsonlBytes/segBinBytes/segRecords`）`≥` target 即滚；`nextSegmentName` BigInt+1 padStart 8 位不回绕；`'99999999'` 溢出 → exhaustedLatch + 恰一次 `stream-exhausted` + 返回 false 丢弃触发 record；滚动后 `jsonlPath/binPath` 经 `segmentFilePaths` 重派生、`reprojectSidecarCarrier` 重投影 sidecar carrier 的 segment/frameOffset（fresh-stat 重取，`file.ts` commitPrepared 内）。
- **计数推进**：bin append 成功即 `segBinBytes += frame.byteLength`（含 orphan 物理字节，§6.2 明文）；JSONL confirmed 即 `segJsonlBytes += utf8Length(line)`（line 含 `\n`，=物理字节）+ `segRecords += 1`；definitive 失败零字节不推进。
- **测试锚**：§13.4（L213 成对滚动 + 闭组达标 + 单条超大独占新组）、§13.5a/5b（L251/266 边界双向）、§13.6（L274 续写期滚动种子）、§13.26a/b（L943/963 双耗尽路径）、§13.28（L999 invalid-roll-targets 门）。
- **耗尽=disabled 不新建 generation**（冲突点 #2/D6）：`beforeCommit` 段耗尽分支只置 latch + 事件，无 `initNewGeneration` 调用；`appendSemantic`/`appendFinal` 门 `exhaustedLatch` 即丢（`file.ts:747/777`）。reopen 已耗尽再上报恰一次（`analyzeStreamForResume` `exhaustedAtOpen` → 构造期 latch + 单事件）。
- **注入接缝不滚动**（§6.2）：`appendFinal` 不调 `beforeCommit`，确认。
- **空组不空转**：target ≥ 1（配置门强制），全零计数 `0 ≥ target` 恒假，确认。

### AC3 启动只截断三类可证明尾损、每次修复经健康 observer 上报 — ✅ 满足

- **三类判定式落点**（`reader.ts` `analyzeStreamForResume` 修复计算段）：
  - C1 不完整尾 JSONL 行：SegMax jsonl 末字节 ≠ 0x0A → 截到最后 0x0A+1（全文无 0x0A → 截 0 字节，`truncatedBytes=|J|`，R1 退化变体）——终止符证明、与可 parse 无关；
  - C2 不完整尾 frame：`walkBinTail`（`reader.ts` 新增）——`len-p<25` 或合法头 + `p+25+payloadLength>len` → 'incomplete'；magic ≠ NDCL → 'unknown-magic' → corrupt rotate；frameVersion/payloadType/flags/reserved 异常 → 'unknown-frame' → incompatible rotate（header 字节布局与 `frame.ts:25-70` 逐字节核对一致）；
  - C3 完整未引用尾 orphan frames：T = max(ref end)（有引用）/ 完整帧前缀边界（无引用，§13.11 裁决面——见非阻断 #1），walk 全程完整帧落 EOF → 'complete'。
- **后缀性质**：非 SegMax 段未终止末行 → `corrupt = true`（`reader.ts` 分析循环 `unterminated && !isMax`）；非 SegMax bin 尾 orphan 不读不修不判腐（G1 闭段惰性残渣，stat 计尺寸即可）；夹在引用链中间的 orphan → `validateSidecarFrame` expectedOffset 链断 → corrupt。
- **全有或全无（§5.3）**：`if (incompatible) return rotate…; if (corrupt) return rotate…` 先于修复计算——任一不可修复损坏即零修复。
- **逐次上报**：`applyRepairs`（`file.ts`）逐 repair `truncateSync` + `stream-tail-repaired{repair,truncatedBytes}`；失败 → `stream-generation-rotated{cause:'repair-io-failure'}` + false → 调用方 `initNewGeneration`（已成功修复保留）。
- **测试锚**：§13.7a/7b、§13.8a/8b、§13.9、§13.10、§13.11、§13.12（L299–488）；§13.29 崩溃窗口矩阵（L1022–1097）；SA7 补验 `file-adapter-sa7-repair-io.test.ts` 4 用例（repair-io-failure 注入，uid≠0 护栏）。

### AC4 中间损坏/缺失引用帧/CRC/未知格式/schema 不兼容/locator 歧义永不改写历史；旧 stream 只读；允许处确定性新 generation — ✅ 满足

- **rotate cause 封闭枚举七值**（`reader.ts` `RotateCause`）与设计 §4.4 逐字一致；判定次序 R1 钉死：manifest 门（ENOENT→missing / 解析·键集·类型·身份→invalid / INCOMPATIBLE_SET 七码→incompatible）**先于** 17 键要求（恰 14 键→legacy-manifest）→ 冻结策略比对（7 字段）→ 交叉扫描。同一磁盘状态 + 同一配置 ⇒ 唯一 cause（§13.18a/b/c 三锚拆分验证）。
- **旧 stream 只读**：rotate 路径只对旧 stream 做读操作（`analyzeStreamForResume` 纯读；修复仅在 verdict=resume 时发生）；§13.13/§13.31 断言旧 segments/manifest 字节恒等。
- **不可读≠缺失二分**（§5.1 R1/SA2 #3）：`readSegmentJsonl`/`readSegmentBin` 三分支（stat 感知 ENOENT/非文件/读失败）；SegMax jsonl 或 bin 不可读 → corrupt rotate 无论有无引用；闭段 bin stat 失败 → corrupt；引用帧所在 bin 不可读 → corrupt（与 reader frame-missing 同向）。ENOENT 合法豁免（BIN-first 窗口 / bin 惰性创建）保留。
- **locator 歧义**：≥2 候选 → disabled + `stream-init-failed{reason:'locator-ambiguous'}` + 零文件写入（`resolveResumeCandidate` 纯读，歧义分支无任何写调用）；§13.22/§13.23b 锚定。
- **测试锚**：§13.13–20 全矩阵（L493–825，含 CRC 翻位/offset 越界/帧缺失/magic 垃圾/未知 frameVersion/sequence-gap/链中 orphan/闭段未终止行/17 键篡改/14 键双形状/冻结配置 5 case）；§13.31–33 R1 锚（L1102–1239）；§13.32a/b/c 不可读≠缺失。

### AC5 崩溃窗口与重启测试覆盖 BIN-before-JSONL、partial writes、orphan 尾帧、中间损坏、双耗尽、manifest/config 变更 — ✅ 满足

- §13.29 四窗矩阵（BIN 成功/JSONL 前后各窗，L1022–1097）逐字对应 AC5 场景；§13.21–25 locator/歧义/恢复/显式失败/空命名空间；§13.26–28 双耗尽 + 配置门；§13.18/20 manifest 篡改与 config 变更；§13.31–33 链中 orphan 全生命周期/不可读/愈合失败。
- SA7 动态面：322 轮 SIGKILL 真实崩溃矩阵 + 多进程 E2E 74/74 + 双 Node（v24.13.0 / v20.18.1）全量 140/1784（sa7_report §1.3/§5）；W3 物理窗口 µs 级不可竞速命中的等价性三面论证已诚实记档（sa7_report §1.3）。

---

## 2. 设计符合性逐节对照（§3–§12 重点节）

| 节 | 核验点 | 结果 |
|---|---|---|
| §3 locator 三分支 | 显式 > current.json（format/version/isSafeStreamId + 目标 manifest 存在性 stat）> manifests 扫描（文法过滤 + manifest 存在 + 字典序排序恰一候选）；≥2 → ambiguous；零 wall-clock（无 mtime/createdAt/目录序/大小比较——逐行核对 `resolveResumeCandidate` 无此类调用） | ✅ |
| §4 analyzeStreamForResume | 内部函数落 `reader.ts`、**未从 `index.ts` 导出**（`index.ts:75-82` export 清单核对无 `analyzeStreamForResume`/`ResumeAnalysis`）；判定次序 R1 a–d 短路序一致；冻结比对 7 字段；交叉扫描与 reader 同源（`manifestGateIssue`/`splitRawLines`/`sequenceStringOf`/`validateSidecarFrame` 等共享调用，无复制漂移）；§4.3 H 与 N1 豁免族（SegMax bin 不可读无引用 → 分析严于 reader）实现方向一致 | ✅ |
| §5 三类判定式 + 后缀性质 | 见 AC3；§5.2 S 不变量结构性成立（T=max ref end / 前缀边界均不与引用区间相交）；§5.5 顺序 C1 前 C2/C3 后、逐次事件、IO 失败 repair-io-failure + 保留前序修复 | ✅（一处已裁决偏差见非阻断 #1） |
| §6/§7 滚动状态机 + 双耗尽 | 见 AC2；§6.3 种子五字段（segment/jsonlBytes/binBytes/records/lastCommitted）与分析输出一致；`exhaustedAtOpen` 双路径判定（sequence=UINT64_MAX / segMax=99999999∧修复后计数达标）与 §7 逐字一致 | ✅ |
| §9 manifest 17 键双封闭形状 | `manifestKeyShape` 原子扩展（三键同进同出，15/16/多余/缺失 → invalid）；三键 `Number.isSafeInteger ∧ ≥1` 类型核对（门 + `extractFormatPolicy` 双层）；reader 两新码 `line-unterminated`（全 segment 检查、可 parse 不豁免、sequence 不锚定）与 `manifest-roll-target-violation`（闭段逆否核查、最大段豁免、14 键跳过）落点与 §9.2/§9.3 一致 | ✅ |
| §10 健康事件 +2/+2 | `health.ts`：+`stream-tail-repaired{repair,truncatedBytes}`、+`stream-generation-rotated{cause}`；`stream-init-failed.reason` 迁移为 disabled 终态四值（invalid-namespace-id/invalid-stream-id/locator-ambiguous/invalid-roll-targets）——旧 manifest-mismatch/-missing 两值移除；既有 12 成员零改动（diff 逐行核对）；事件无 streamId/segment/offset 高基数字段（§10.3 纪律） | ✅ |
| §11 R2 兼容 | 提交点纪律零改动（candidate 仍在准备门后取得；definitive/ambiguous 分类 `classifyAppendFailure`/commitAmbiguous 原样）；fresh-stat offset 不变（`planFrameOffset` 未动；滚动后重投影仍 fresh-stat 重取）；无 queue/batch/fsync/常驻 fd（diff grep 零命中） | ✅ |
| §12 write-slot 纪律 | 构造期全部同步 fs（readdir/stat/read/truncate/write+rename），无新增异步/后台任务/常驻句柄；README + AGENTS 均记档「构造期同样必须在 slot 外」（接线验收归 #149–151/#155） | ✅ |

## 3. 总控裁决 G1–G4 落实核验（dispatch log 行 10）

- **G1**（§13.17 闭段 bin 尾 orphan = 惰性残渣，健康 resume 零修复）：实现非 SegMax bin 只 stat 不读、不修、不判腐（`reader.ts` 分析循环非 max 分支 + 修复计算仅 SegMax）；测试 §13.17b（L682）正例锚定健康 resume + 零修复，与 §5.4 oracle 口径一致；§13.17a 的 JSONL 半句（闭段未终止末行 → corrupt）保留。**落实**。
- **G2**（H 逆命题豁免族泛化；§13.15a/b 只断 analysis 侧）：实现 SegMax bin 不可读无论有无引用 → corrupt rotate（分析严）；reader 侧 `readBinOrNull` 惰性语义未动（reader.ts diff 未触该路径）；§13.15a/b（L587/606）断言锚定。**落实**。
- **G3**（init-failed reason 迁移 disabled 四值；manifest-mismatch/-missing 迁 `stream-generation-rotated`）：`health.ts:62` 四值精确；mismatch-interference 测试迁移断言 rotated{stream-incompatible} 恰一次 + init-failed 零出现（L288–296 diff）。src 内 grep 无残留旧 reason 发射点。**落实**。
- **G4**（§13.31 数值标定 records=100/jsonl=100000/bin=100000）：测试 L1105 `cfg = { targetJsonlSegmentBytes: 100000, targetBinSegmentBytes: 100000, targetRecordsPerSegment: 100 }` 逐字一致。**落实**。

## 4. 范围蠕变检查（简报「明确排除」）

- retention（#154）：diff grep `retention` 仅 wiki 引用行，src 零实现。✅ 零渗透
- replay/Host 接线（#155/#149–151）：DENY LIST 包外零改动（diff stat 仅本包 + wiki）。✅
- queue/batch/fsync/常驻 fd：diff grep 零实现命中（仅文档/排除条款文字）。✅
- #148 冻结面：record.ts/schema.ts/vocabulary.ts/pipeline.ts/emission.ts/sink.ts/memory.ts 零 diff 行；health.ts 变更仅限 §10 预授权的 +2 成员 +2 扩值（形状只增）。✅
- docs/adr/**：零 diff 行（含 0012 amendment 未动）。✅
- **结论：零范围蠕变。**

## 5. 疑似错误行为推演（spec 角度）

逐项推演后**未发现疑似错误行为**；以下为推演记录（排除过程）：

1. **滚动发生在 prepareRecord 之后**（`beforeCommit` 在 `commitPrepared` 内）：sidecar carrier 在准备门按滚动前 segment/offset 规划，滚动后 `reprojectSidecarCarrier` 以 fresh-stat 重取新 bin offset 并重写 segment/frameOffset——重投影值（8 位段名 + 十进制 offset）仍过 VFSL 形状面，且设计 §6.4/§8.2 明文「carrier segment 取当前 segment」。语义闭合，非缺陷。
2. **段耗尽触发 record 丢弃但 candidate 未消耗**：`beforeCommit` 返回 false 时 `candidateSequence()` 未调用，无空洞；latch 置位后 emit 门拦截，事件恰一次（appendSemantic 门先行，`beforeCommit` 不可再达）。与 §7 一致。
3. **rotate 事件先于新 generation 初始化**（因果序 §8.1）：`notify(rotated)` → `initNewGeneration()`，若初始化失败（collision 耗尽/mkdir 失败）落 disabled，事件已如实发出。一致。
4. **`manifest-missing` vs `manifest-invalid` 归因**：manifest 读失败按 errno 二分（ENOENT→missing，其他含 EISDIR→invalid），与 §4.1 步 1a/1b 一致。
5. **`stream-exhausted` 恰一次不变量**：sequence 路径由 UINT64_MAX 单调可达一次性保证；segment 路径由 latch 门保证；exhaustedAtOpen 每进程构造一次。无二次发射路径。
6. **reader `line-unterminated` 与修复的事实基础同一**（§9.2 动机）：修复按终止符截断可 parse 半行后，reader 若宽容判 ok 即自相矛盾——实现两侧均以终止符为准，一致。
7. **ADR-0012 §Segment rolling 默认值/编号/耗尽语义**（64MiB/256MiB/100000、00000001 起、00000000 保留、8 位不回绕、99999999 exhausted 丢弃+上报）逐字核对实现与 manifest 默认值，一致。
8. **ADR-0012 §打开与尾部恢复不修复清单**（中间坏行/VFSL/CRC/引用缺失/越界/未知 format）→ 实现全落 rotate（corrupt/incompatible），无一被修复路径吞并。一致。

## 6. 阻断发现清单

**无。**

## 7. 非阻断清单（3 条，均已裁决/记档或为保守方向）

1. **§5.4 文字与 §13.11 锚定的截断点分歧（已裁决偏差，留档）**：设计 §5.4 字面「Refs 为空 → T=0」（无引用时整段 bin 截断）；实现按 §13.11 契约面取「从 0 起完整帧前缀边界」（`walkCompletePrefixEnd`），无引用完整帧保留为惰性残渣、仅截不完整尾块。证据：`reader.ts` `walkCompletePrefixEnd` 头注（自述偏差+SA6 锚定出处）、dispatch log 行 12（SA3 备案+留 SA4 复核）、行 13/14（SA4 裁定成立 + SA7 pass）。功能后果：ADR「截断完整但未引用尾 orphan frames」在无引用场景下变为保留——属已走通「自述→备案→复核→裁定」流程的接受偏差；副作用是窗口1 场景发出 `truncatedBytes: 0` 的 `bin-orphan-frames` 事件（零字节「修复」事件，SA7 LOW-1 记档实测吻合，sa7_report §6.3）。建议（非阻断）：后续票将设计 §5.4 文字同步至 §13.11 口径，消除文档漂移。
2. **reader §9.3 闭段 bin stat 失败按 0 尺寸计**（`reader.ts` readStreamStrict 闭段 stat catch → 0）：不可读闭段 bin 可能被多记一条 `manifest-roll-target-violation`（若三维均低于 target）。方向保守（多报不少报）；设计 §5.1 的 stat 失败→corrupt 钉死的是 analysis 侧（实现已照做），§9.3 对 reader 侧 stat 失败未明文。非阻断观察。
3. **设计已记档 LOW 项维持原状**：LOW-1（exhausted 无成因字段，§7 记档）、LOW-2（17 键对 0.1.2 旧 reader 前向断裂，§9.1 + README 升级顺序记档）、W3 物理窗口等价性论证（sa7_report §1.3）。均为已接受记档，非本终审新增发现。

## 8. 独立取证记录（命令 + 结果）

| # | 命令（worktree 内） | 结果 |
|---|---|---|
| 1 | `git log --oneline -3` / `git diff 8611e68..001ff80 --stat` | 两 commit（3536360 实现 + 001ff80 SA7 补验）；24 文件 +4239/-100；文件面全在 ALLOW LIST |
| 2 | `git diff --check 8611e68..001ff80` | 干净（DIFF_CHECK_CLEAN） |
| 3 | `setsid nohup pnpm typecheck`（后台独立进程，/tmp/specreview153/typecheck.log） | **exit=0**，全 10 包 0 错误 |
| 4 | `setsid nohup pnpm test`（后台独立进程，/tmp/specreview153/test.log） | **Test Files 140 passed (140)；Tests 1784 passed (1784)；Type Errors: no errors；exit=0**（基线 138/1719 → +2 文件 / +65 测试；与 SA7 双 Node 记录一致） |
| 5 | `node_modules/.bin/vitest run packages/namespace-diagnostic-log/test` | **22 文件 / 379 测试全绿**（375 SA6 面 + 4 SA7 补验），0 类型错误 |
| 6 | `git diff … \| grep -in "fsync\|queue\|batch\|retention\|replay"` | 仅 wiki/文档引用行，src 零实现命中 |
| 7 | `grep analyzeStreamForResume src/index.ts` | 无匹配——内部分析函数未公共导出（§4.1/§18 契约） |
| 8 | diff 逐行研读：src/adapters/file.ts（344 行）、src/reader.ts（567 行）、src/health.ts、src/paths.ts、全部测试 diff、README/AGENTS diff | 见 §1–§5 对照记录 |
| 9 | ADR-0012 原文核对（§Segment rolling L254–266、§打开与尾部恢复 L270–278、amendment L244–250、§File adapter 布局 L44） | 实现语义逐字对齐（见 §5.7/§5.8） |
| 10 | 测试锚存在性核对：主红灯文件 §13.1–§13.33 全锚（describe/it 标题逐一 grep）；strict-reader §13.30a–j；sa7-repair-io 4 用例 | 全数在位（本报告 §1 各 AC 行内引 L 号） |

---

**结论**：verdict = **pass**。AC1–AC5 全部满足且锚定真实；设计符合性高；G1–G4 落实；零范围蠕变；验证门槛独立复跑全绿。非阻断 3 条均为已裁决/已记档面，不构成发布阻塞。

---

## 9. R 轮 delta 复审（215a18e，Phase 4 回流 3H+N1 修复后）

**背景**：Standards 轴首轮报 3H+N1（file.ts 头注/config 注释陈旧失实、测试死代码 `rotatedProof`、§13.32b chmod 000 EACCES 注入缺 root 护栏——均行为面零影响项）；SA3 以 215a18e 修复（2 文件 +20/-22）。本轴对更新后 diff（8611e68..215a18e）做 delta 复审。

### 9.1 delta 逐行核验（`git diff 001ff80..215a18e`）

| hunk | 性质 | 核验 |
|---|---|---|
| `file.ts` 头注重写（+13/-4） | **纯注释**：契约摘要更正为 #153 现状（17 键 manifest、reopen 三分支/rotate、滚动与耗尽语义）；更正后与实现行为逐句核对一致（locator 优先级、全有或全无、`≥ target` 判定、99999999 exhausted 不新建 generation 均与本报告 §1–§2 核验过的实现相符） | ✅ 注释真实性修复成立 |
| `file.ts` `resumeStreamId` JSDoc（+2/-1） | **纯注释**：旧文「#152 无续写能力——四分支全落新建 generation」更正为显式续写/确定性 rotate 语义，与 §3.1 ①/§3.2 一致 | ✅ |
| 测试头注 +3 行 | **纯注释**：EACCES 注入族 root 身份前提记档（与 sa7-repair-io 同款约定；SA7 §1.2 实证） | ✅ |
| `isRoot` 常量 +3 行 | 测试辅助常量（`process.getuid() === 0`），非断言语义 | ✅ |
| 删除 `rotatedProof`（-18 行） | **死代码移除**：`grep -rn rotatedProof packages/namespace-diagnostic-log/` 零命中（删除前即无任何调用点）——零行为影响实证 | ✅ |
| §13.32b 改 `it.skipIf(isRoot)`（+1/-1） | **测试护栏**：root 下 chmod 000 可读、EACCES 注入失效 → 显式 skip 而非假绿；与 `file-adapter-sa7-repair-io.test.ts` 既有 `it.skipIf(uid===0)` 护栏同型。本机 uid=1000（非 root），该用例在复跑中**真实执行并通过**（1784 总数与 R 轮前一致——skipIf 未在本环境跳过任何用例） | ✅ 护栏语义正确 |

**delta 定性**：零 src 行为变更（file.ts 仅注释块）；测试面仅死代码移除 + 条件 skip 护栏 + 注释。无新断言、无断言放宽（§13.32b 在非 root 环境断言语义一字未动）。

### 9.2 spec 结论影响评估

- 五条 AC 核验、设计 §3–§12 对照、G1–G4 落实核验的全部证据锚（实现行号、测试用例、事件形状）在 215a18e 中**零触碰**——首轮 §1–§8 结论原样成立。
- 范围面：delta 后全量 diff 仍 24 文件（4240/+103），全在 §16 ALLOW LIST 内；DENY LIST 零触碰维持。
- 注释修复方向与 spec 侧核验过的实现语义一致——未引入新的文实不符。

### 9.3 验证门槛复跑（后台独立进程，setsid nohup）

| 门 | 命令 | 结果 |
|---|---|---|
| diff 干净 | `git diff --check 8611e68..215a18e` | DIFF_CHECK_CLEAN |
| 类型 | `pnpm typecheck`（/tmp/specreview153/typecheck-r1.log） | **exit=0**（全包 0 错误） |
| 测试 | `pnpm test`（/tmp/specreview153/test-r1b.log） | **Test Files 140 passed (140)；Tests 1784 passed (1784)；Type Errors: no errors；exit=0**（与首轮一致） |

注：首次并行复跑中 test 进程因 pnpm 11 `runDepsStatusCheck` 竞态（两 pnpm 进程并发触发 deps 检查、子进程 cwd 落入会话目录）失败退出（TEST_EXIT=1，错误为 `ERR_PNPM_NO_PKG_MANIFEST`，非测试失败）；单独串行复跑后全绿——基础设施工具竞态，与被测 diff 无关，如实记档。

### 9.4 R 轮结论

**delta 复审通过：verdict 维持 pass。** 215a18e 纯注释/测试护栏性质经逐 hunk 核验确认；spec 轴首轮全部结论不受影响；验证门槛复跑全绿。
