# 任务简报 — Issue #153 Reopen streams, roll segments, and repair provable tails

## 任务身份

- repositoryId: nomicore
- issue: 153（Parent: PR #142，docs/namespace-diagnostic-change-log）
- round: 1（首轮，非修订轮）
- worktree: /home/wangjian/nomicore-fix-issue-153
- branch: fix/issue-153-on-docs-namespace-diagnostic-change-log
- run_id: issue-153-1787937652-3942974
- 基线 commit：8611e68（= origin/docs/namespace-diagnostic-change-log HEAD，含 #148/#152 全部交付）
- 前序档案：wiki/raw/task_diagnostic-log-v1-contract*.md（#148）、wiki/raw/task_diagnostic-log-file-adapter{,-r2}*.md（#152）

## Blocked-by 消解结论（总控开工勘察）

- issue 标注 "Blocked by #152"。实证：issue #152 状态 CLOSED；其交付 PR #159 已于 2026-08-28T17:19:48Z MERGED 进 base 分支 docs/namespace-diagnostic-change-log；本 worktree 分支基线 8611e68 即该 merge commit，#152 成果（File adapter/manifest/NDCL frame/strict reader/连续 sequence 契约）已在本分支可用。
- 结论：**无硬阻塞，正常推进**。

## 任务类型自判

功能开发（新增能力：stream 续写 reopen / segment group 滚动 / 启动尾部修复）。**工作流裁剪**：验收红灯契约依赖设计裁决（roll 触发边界与配置面、修复判定语义、新 generation 选择的确定性规则、健康事件形状），故循 issue #152 round=2 先例，SA6 红灯锚定置于设计定稿（SA8 设计复审 clear + SA2 pass）之后。流程：SA8 前置门禁 → SA1 设计 → 总控裁决 → SA8 设计复审 → SA2 攻击评审 → SA6 红灯 → SA3 TDD 实现 → 总控绿灯亲验 → SA4 静态验尸 → SA7 动态验证 → AC 门禁 → 双轴终审 → 收尾。跳过 SA5（非缺陷复现任务）。

## Issue 正文（What to build，逐字）

Make File diagnostic streams survive normal restarts and long-running append workloads. Healthy streams resume in append order, JSONL/BIN groups roll at bounded targets, and startup repairs only provable final-tail damage; middle corruption, incompatible formats, and exhaustion leave old history untouched and move future logging to an honest new generation or disabled stream.

## 验收标准（Acceptance Criteria，逐字）

- AC1: A healthy stream reopens and continues sequence allocation and append order across Runtime generations and normal process restarts using one logical writer per namespace stream.
- AC2: JSONL and BIN roll as one segment group before the next record when any configured byte or record target is reached, with fixed segment numbering and explicit exhaustion behaviour.
- AC3: Startup safely truncates only incomplete final JSONL lines, incomplete final frames, and complete unreferenced tail frames, reporting each repair through logger health observability.
- AC4: Middle corruption, missing referenced frames, validation/CRC mismatch, unknown format, schema incompatibility, and unsafe locator ambiguity never rewrite history; the old stream remains read-only and a new generation is selected deterministically where allowed.
- AC5: Crash-window and restart tests cover BIN-before-JSONL, partial writes, orphan tail frames, middle damage, sequence/segment exhaustion, and manifest/config changes.

## 设计基线（先读，以此为准）

- `docs/adr/0011-best-effort-namespace-diagnostic-change-log.md`（产品语义：best-effort、业务隔离、健康观测）
- `docs/adr/0012-vfsl-validated-jsonl-and-framed-sidecar-change-log.md`（存储契约）——本票直接对应章节：
  - §Stream 与 generation：正常重启继续健康 stream；冻结配置改变/无法安全续写时新建 generation；locator 损坏不得按 wall clock 猜测，须确定性恢复或显式处置；
  - §Segment rolling 与耗尽：JSONL/BIN 作为一个 segment group 成对滚动；默认 targets 64 MiB/256 MiB/100,000 records 可配置；任一 target 达到时**在写下一条 record 前**滚动；segment 从 `00000001` 起（`00000000` 保留）、固定 8 位十进制不回绕；`99999999` 后 stream exhausted（丢弃并上报，业务不受影响）；
  - §打开与尾部恢复：writer 交叉扫描 JSONL 与 BIN；只自动修复可证明的最终尾部（不完整尾 JSONL 行、不完整尾 frame、完整但未被引用的尾部 orphan frames）；修复经 observer 上报；中间损坏/VFSL 失败/CRC 错/引用缺失 frame/offset 越界重叠/未知 format 一律不修复——旧 stream 标 corrupt/incompatible 保持只读，创建新 generation；不得从 BIN 猜回 JSONL 语义；
  - §Writer/append + 2026-08-28 amendment：首切片有界同步 append、BIN-first、无 queue/batch/fsync/常驻 fd；提交点 sequence 纪律（#152 R2 §3.2/§3.2.1）；
  - §验收门槛 7/8/9/12（崩溃窗口、坏尾修复与中间损坏、segment 滚动与耗尽、Runtime reopen 单 writer 有序 append）。
- #148 冻结契约：`record.ts`/`schema.ts`/`vocabulary.ts`/`pipeline.ts`/`health.ts`/memory adapter——**不改**。
- #152 交付面（本票的实现基座）：`src/adapters/file.ts`（799 行；当前恒写 `segments/00000001.{jsonl,bin}`；`resumeStreamId` 四分支全落新建 generation、无续写能力）、`src/reader.ts`（594 行 strict reader，含 manifest policy 执行与跨 segment 连续性状态机）、`src/paths.ts`（segment 名文法 P_SEGMENT 已有 8 位十进制单源）、`src/frame.ts`/`src/storage-gate.ts`。
- #152 R2 设计档案 `wiki/raw/task_diagnostic-log-file-adapter-r2_design.md`（提交点分配、definitive/ambiguous 分类、reader 连续性锚定——本票续写/滚动/修复必须与其兼容）。

## 本票范围（做什么）

1. **健康 stream 续写 reopen**：构造/打开既有 stream 时经 strict 检查证明健康（含 manifest 指纹/冻结策略匹配、sequence 连续、storage 校验通过）后，从既有 `lastCommittedSequence` 继续分配，append 顺序与 segment 位置续接；locator（current.json）确定性解析与歧义处置；同一 namespace stream 单逻辑 writer 语义保持。
2. **Segment group 滚动**：JSONL/BIN 成对滚动（写下一条 record 前判定任一配置 target 达到即滚）；三个 target 可配置并进 manifest 冻结面（如属「影响记录解释的配置」须按 ADR 判定）；固定编号与 `99999999` exhausted 语义落地。
3. **启动尾部修复**：仅三类可证明尾损（不完整尾 JSONL 行 / 不完整尾 frame / 完整未被引用尾部 orphan frames）自动截断，每次修复经健康 observer 上报；中间损坏等一律不修复，旧 stream 只读 + 确定性新 generation 或 disabled stream。
4. **耗尽**：sequence uint64 耗尽（#152 已有）与 segment `99999999` 耗尽两条路径的显式行为。
5. **测试**：崩溃窗口（BIN-before-JSONL、partial writes）、orphan 尾帧、中间损坏、sequence/segment 耗尽、manifest/config 变更的重启/重开测试。

## 明确排除（不做什么）

- 不实现 retention 删除（#154）、replay/Host 接线（#155/#149–#151）。
- 不改 #148 冻结面：record/schema 文本与指纹/vocabulary/emission/health 事件联合的词表**形状**（新增健康事件成员须走 #148 §10-J13 式预授权路径，由 SA1 设计、SA8 对照 ADR 裁决）。
- 不引入 writer queue/batch/fsync/常驻 fd（ADR-0012 amendment 首切片边界）。
- 不 push、不开 PR、不写 .mabf-done（发布归 Host/Runner）。

## 验证门槛（必须通过并记录）

- `git diff --check` 干净
- `pnpm typecheck` 全包 0 错误
- `pnpm test`（vitest run --typecheck 全量）绿，记录文件数/测试数并与基线（8611e68：138 文件 / 1719 测试）对比
- 版本 bump：改动包 `packages/namespace-diagnostic-log` patch 版本提升（硬门禁 9）

---

## SA6 红灯契约（设计定稿后落锚）

**权威锚点**：设计定稿 `task_diagnostic-log-stream-roll-repair_design.md` §13（33 条）+ §13.7 R1 变体 + §16 ALLOW/DENY LIST；裁决依据 `…_relevant_decisions.md`。

### 测试文件清单（SA6 owned）

| 文件 | 处置 | 内容 |
|---|---|---|
| `test/file-adapter-reopen-roll-repair.test.ts` | **新建（主红灯文件）** | §13.1–29、§13.31–33 全部锚点：AC1 续写 reopen（3）、AC2 滚动（4）、AC3 三类尾部修复（8）、AC4 中间损坏/确定性 rotate（17，含 18/19/20 拆分）、AC5 locator/歧义/耗尽/无效 targets（8）、崩溃窗口矩阵（4）、R1 新增锚（5）。共 50 用例 |
| `test/file-adapter-layout.test.ts` | 修改 | manifest 17 键键集/配置冻结/默认值断言（§11.3） |
| `test/file-adapter-mismatch-interference.test.ts` | 修改 | resume 失败事件迁移：`stream-init-failed{manifest-mismatch}` → `stream-generation-rotated{cause:'stream-incompatible'}`（§11.3；14 键篡改指纹归因钉死） |
| `test/file-adapter-strict-reader.test.ts` | 修改 | §13.30 新码/双形状：17 键正例、14 键正例、15/16 键 invalid、`line-unterminated`（含可 parse 变体）、`manifest-roll-target-violation`（违例+正例+14 键跳过）、两码叠加 |
| `test/file-adapter-r2-supplemental.test.ts` | 修改 | 「第 15 键」用例改用 `legacyManifest`（保持真 15 键语义）；跨 segment 用例 manifest 声明 records target=1（闭段 §9.3 核查一致性） |
| `test/file-adapter-sa7-dynamic.test.ts` | 修改 | D-A1 终态补「reopen 后健康续写」正例锚（§13.17 后半） |
| `test/helpers/file.ts` | 修改 | `validManifest` 默认升级 17 键（+3 target 默认值）；新增 `legacyManifest`（14 键）、`eventsOfTypeRaw`（新事件成员类型面冻结期窄化）、`sidecarAttemptRecord`/`concatU8`（sidecar 夹具）；`writeStreamFixture` 支持 current.json 与多 segment |

### 红因总类（全部为 src 未实现本票语义）

1. **§4.1/§8：无 reopen 分析/续写能力** —— 重开构造仍新建 generation（streamId 变更、sequence 从 1 重头、current.json 指向新流）；
2. **§5：无尾部修复** —— 三类可证明尾损零处理、无 `stream-tail-repaired` 事件；
3. **§6.2：无滚动状态机** —— 恒写 `00000001`、无成对滚动/边界判定/续写期种子；
4. **§3.1：无 locator 解析/歧义处置** —— 无 `locator-ambiguous` disabled、无扫描恢复；
5. **§7：无双耗尽** —— 无 `exhaustedAtOpen`/构造期上报/segment 溢出丢弃；
6. **§8.1/§10：无配置门与新事件** —— `invalid-roll-targets` 未实现、`stream-generation-rotated`/`stream-init-failed` 新 reason 不存在；
7. **§9.1/§18：manifest 未升级 17 键** —— writer 仍写 14 键（layout 3 用例红）+ reader 拒 17 键（§13.30 新码用例与共存夹具的连带红）；
8. **§9.2/§9.3：reader 两新码未实现** —— `line-unterminated`/`manifest-roll-target-violation` 缺位。

### 红灯运行结果（基线 8611e68，src 零改动）

- 命令：`node_modules/.bin/vitest run packages/namespace-diagnostic-log/test`（后台独立进程）
- 结果：**Test Files 6 failed | 15 passed (21)；Tests 119 failed | 256 passed (375)；Type Errors: no errors；exit=1**
  - `file-adapter-reopen-roll-repair.test.ts`：47 失败 / 3 通过（13.5b 边界反向护栏、13.25 空命名空间护栏、13.27 sequence 耗尽 #152 既有回归锚——后两者当前即绿、实现后必须保持）
  - `file-adapter-strict-reader.test.ts`：62 失败（§13.30 新块 6 红/4 绿 + 56 条既有用例因 `validManifest` 默认 17 键而连带红——红因同为 §9.1 双形状未实现，实现后全部转绿：设计 §11.3「零既有断言破坏」）
  - `file-adapter-layout.test.ts`：3 失败（17 键表达）；`file-adapter-mismatch-interference.test.ts`：1 失败（事件迁移）；`file-adapter-sa7-dynamic.test.ts`：1 失败（D-A1 续写正例）；`file-adapter-r2-supplemental.test.ts`：5 失败（17 键夹具连带红）
- 复跑两次结果一致（`/tmp/sa6b.log`→首轮 47/3、最终全量 `119/256`），无 fixture 性死锁、无不可复现红。
- 类型面：`tsc -p packages/namespace-diagnostic-log` 0 错误（新配置键/新事件成员以断言收敛与 raw 窄化保持冻结期可编译；SA3 加类型后仍编译）。

### 挂起歧义（报告 §6 详述，交 SA1/SA8 裁决口径）

§13.17 「非 SegMax 段 bin 尾 orphan → corrupt rotate」与 §5.4/§5.1 规范性文本（闭段 bin 未引用尾字节 = 惰性残渣、不构成损坏）不一致；本契约以 §5.4（+SA2 评审「orphan 变闭段尾部字节=reader-ok 惰性残渣」的引用口径）为测试 oracle（§13.17b 断言健康 resume + 零修复），若 SA8 裁决取 §13.17 字面（corrupt rotate）则 §13.17b 需按裁决翻转。

---

## Round 2 附记（SA6 红灯重锚，round2_feedback.md 裁决）

**背景**：PR #166 review High 阻断——owner 裁决推翻 round-1 已锚定语义（无引用时保留完整 orphan BIN 尾帧），要求 §5.4 字面「Refs 为空 → T=0」：完整未引用 orphan 尾帧全部截断、修复后 bin 实际长度 = 0。

**测试修订**（`packages/namespace-diagnostic-log/test/file-adapter-reopen-roll-repair.test.ts`，唯一测试改动文件）：

- §13.11 重写：断言 bin 修复后实际长度 = 0、bin 事件 `truncatedBytes = FRAME_BYTES + 7`（真实移除量）、jsonl 截到最后 `0x0A` 断言保持；新增负向断言（不存在 truncatedBytes===0 的 stream-tail-repaired 事件）；
- §13.11b 新增（反馈建议 4）：§13.11 fixture 修复后 emit 一条 sidecar record → `update.frameOffset === "0"` 且 `readStreamStrict.status === 'ok'`（链从 offset 0 重新衔接）；
- §13.11c 新增（反馈 ③④ 原样：refs 空 + 完整 orphan 尾帧的纯 C3 场景）：修复后 bin 长度 0、事件 truncatedBytes = 真实移除量、续写 sidecar `frameOffset === "0"` + reader ok；
- §13.29 窗口1/3 与 §13.32c 增补 `truncatedBytes = FRAME_BYTES`（真实移除量）+ bin 长度 0 断言——消除 `truncatedBytes: 0` 事件（round-1 遗留风险 #2 / 契约 4）。

**红灯运行结果**（基线 51b79b9 = round-1 交付态，src 零改动；命令 `node_modules/.bin/vitest run packages/namespace-diagnostic-log/test`，后台独立进程）：

- 受影响文件：**6 failed / 46 passed（52）**，exit=1；复跑一致（`.mabf-bg/sa6-r2-reopen-file-run.log`）；改动前基线 50/50 绿（`/tmp/sa6-r2-baseline.log`）。
- 红因（全为 src 偏差未修——`reader.ts:1090-1093` walkCompletePrefixEnd 例外）：§13.11 `expected 7 to be 4129`（bin 事件只计撕裂尾块 7B）；§13.11b `expected 4122 to be +0`（bin 保留 4122B → 新帧 offset 4122）；§13.11c `expected +0 to be 4122`（零字节事件）；窗口1/3 与 §13.32c 同 `expected +0 to be 4122`。
- 全包：**1 failed file / 22；6 failed / 375 passed（381）；Type Errors: no errors**——既有断言零回退，受影响断言清单逐条结论见 `wiki/raw/task_diagnostic-log-stream-roll-repair-r2_sa6_red.md` §2。
- 非测试面注记：`walkCompletePrefixEnd`（`src/reader.ts:785-804`）删除例外后成死码，须一并删除（SA3 范围；SA6 未动 src）。
