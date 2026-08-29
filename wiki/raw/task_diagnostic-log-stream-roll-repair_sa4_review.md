# SA4 静态验尸报告 — Issue #153 Reopen streams, roll segments, and repair provable tails

**Date**: 2026-08-29
**Reviewer**: SA4（Red Team）
**审查范围**: diff `8611e68..3536360`（SA3 TDD 实现 commit）
**Verdict**: **pass**（SA3 备案偏差裁定：**成立**，见 §一.4；附 3 条非阻断记档 + SA7 动态清单）

---

## 0. 审查方法与独立证据

- 设计定稿（670 行 §0–§18）、任务简报、dispatch log G1–G4 裁决（行 10）、SA2 评审、SA6 红灯报告全量通读后逐项验尸。
- 独立复跑包级测试（独立进程、非 ACP session）：`node_modules/.bin/vitest run packages/namespace-diagnostic-log/test` →
  **Test Files 21 passed (21)；Tests 375 passed (375)；Type Errors: no errors；exit=0**（`/tmp/sa4-pkg-test.log`）——与总控亲验（ctl-green.log）一致。
- `tsc -p packages/namespace-diagnostic-log/tsconfig.json --noEmit` exit=0；`git diff --check 8611e68..3536360` 干净。

## 一. 门禁清单逐项结论

### 1.1 文件清单 Scope Creep Guard — ✅ PASS

- actual（22 文件）− ALLOW LIST（§16 提取 37 项）− 白名单（`wiki/raw/task_*` 8 项 SA 流水线档案）= **零 creep**。
- DENY LIST 零命中：`record.ts`/`schema.ts`/`vocabulary.ts`/`pipeline.ts`/`emission.ts`/`sink.ts`/`memory.ts`/`frame.ts`/`storage-gate.ts`/`carrier.ts`/`crc32c.ts`/`canonical-json.ts`/`digest.ts`/`schema-patterns.ts`/`index.ts`/`testing.ts` 全部未动（#148 冻结面 + 编解码原语完整性成立）。
- BLACKLIST 零命中（无 npm lockfile/`.bak`/`TASK.md`/`.DS_Store`）。
- `test/file-adapter-r2-policy-continuity.test.ts` 未修改——design §16 标注「如受影响」为条件项，全量绿证实不受影响，合规。
- 硬门禁 9：`package.json` 0.1.2 → 0.1.3 ✅。

### 1.2 设计偏离审查 — ✅ 一致（一项备案偏差裁定成立，见 1.2.1）

逐项对照（src 实现坐标以 3536360 为准）：

| 设计条款 | 实现落点 | 判定 |
|---|---|---|
| §3.1 locator 三分支（显式>current>恰一候选；歧义 disabled 零写入） | `file.ts` `resolveResumeCandidate`：显式最先；current.json 三键校验 + 目标 manifest 存在性检查，不可用/指向缺失 → 落③重扫；`candidates.sort()` 纯字典序；≥2 → disabled + `locator-ambiguous` | ✅（§13.21–23b 绿） |
| §4.1 manifest 门短路次序（incompatible 先于 17 键要求） | `reader.ts` `analyzeStreamForResume`：`manifestGateIssue`（含 INCOMPATIBLE_SET 七码 → `stream-incompatible`）先执行，`shape !== '17'` → `legacy-manifest` 最后判 | ✅（§13.18a/b/c 三拆分绿；14 键篡改 → incompatible 非 legacy） |
| §4.2 冻结策略比对（7 值） | analysis 第 2 步逐值 `!==` 比对（4 旧值 + 3 targets） | ✅（§13.20a/b 绿） |
| §5.1 读取三分支（ENOENT≠不可读≠可读） | `readSegmentJsonl`/`readSegmentBin`：stat 感知（`throwIfNoEntry:false` + `isFile()`）；不可读/目录占位 → corrupt（SegMax bin 无论有无引用；非 SegMax jsonl 同向；引用段 bin 不可读 → corrupt） | ✅（§13.32a/b/c 绿） |
| §5.2 修复安全性 S | C1 只删最后 `0x0A` 之后字节；C2/C3 截断点 ≤ max(ref end)（有引用时），Refs∩[T,\|B\|)=∅ 结构性成立 | ✅ |
| §5.3 全有或全无 | analysis 全量扫描后 `corrupt/incompatible` 任一为真即 rotate，repairs 不输出 | ✅（§13.13 零修复 + 字节恒等绿） |
| §5.5 修复应用与上报 | `file.ts` `applyRepairs`：C1 先 C2/C3 后（分析输出序）；`truncateSync` 失败 → `stream-generation-rotated{repair-io-failure}` + 已成功修复保留；逐次 `stream-tail-repaired{repair,truncatedBytes}` | ✅ |
| §6.1/§6.2 滚动状态机 | `paths.ts` `segmentFilePaths` 新增；`beforeCommit()` 在 `commitPrepared` 内、`candidateSequence()` 之前判定（当前用量 ≥ 任一 target 即滚）；计数器推进：bin append 成功即 +25+len（含 orphan）、JSONL confirmed 即 +lineBytes(含\n)+1 record；`nextSegmentName` BigInt +1 padStart 8 | ✅（§13.4–6 绿；R2 提交点纪律保留：candidate 在提交分支取得） |
| §6.3 reopen 种子 | currentSegment=SegMax（无文件段→'00000001'）；三计数=修复后文件事实（records=修复后 0x0A 计数） | ✅（§13.12 落段推演绿） |
| §6.4 滚动后 carrier 重投影 | `reprojectSidecarCarrier`：sidecar carrier 的 segment/frameOffset 以滚定后状态重取（offset 恒 fresh-stat——`planFrameOffset` 无缓存）；stat throw → `storage-write-failed{stage:'bin'}` + candidate 未消费 | ✅ |
| §7 双耗尽 | `beforeCommit` 段溢出分支 + `commitConfirmed` UINT64_MAX 分支共用 `exhaustedLatch`（恰一次事件）；`exhaustedAtOpen` 构造期再上报；耗尽终态 disabled 绝不新建 generation | ✅（§13.26a/b/§13.27 绿） |
| §8.1 构造主流程 | 配置门（invalid-roll-targets）→ locator 解析 → 分析 → rotate（事件先于新 generation）/resume（种子装配 + writeCurrent 愈合 + preset 仅 fresh 生效） | ✅（§13.24/25/28/33 绿） |
| §8.3 新 generation 17 键 + 段态清零 | `buildManifest` +3 参；`initializeGeneration` 段态清零、preset 语义 | ✅ |
| §9.1 reader manifest 双封闭形状 | `manifestKeyShape`：恰 14 / 恰 17 / 其余 null→invalid；三 target 键原子扩展（15/16 键→invalid）；值域 `Number.isSafeInteger ∧ ≥1` | ✅（§13.30a–d 绿） |
| §9.2 `line-unterminated` | reader 逐 segment 末物理块缺 `\n` → 记该码；sequence 不锚定（expectedSequence=null 同身份不可解释语义）；与 parse 成败无关 | ✅（§13.30e/f/j 绿） |
| §9.3 `manifest-roll-target-violation` | 17 键形状对每个闭段核查三维达标（jsonl 字节/bin stat 尺寸/完整行数）；最大段不核查；14 键跳过 | ✅（§13.30g/h/i 绿） |
| §10 健康事件只增不改 | `health.ts`：+2 成员（形状逐字段对照 §10.3——封闭枚举/计数、刻意排除 streamId/segment/offset）；`stream-init-failed.reason` 四值恰等 G3 裁决（manifest-mismatch/-missing 已删除，迁移至 rotated cause） | ✅ |
| §11.1 R2 冻结契约保留 | 提交点纪律/definitive-ambiguous 分类/`commitAmbiguous` 封闭/BIN-first/fresh-stat offset/emit 不抛全部原样 | ✅（`§13.27`、D-A1 系列回归绿） |
| §12 write-slot 纪律覆盖构造期 | 构造期全部同步 fs（locator 读/交叉扫描/截断）在构造函数内完成；README/AGENTS 均记档「Host 必须在 slot 外构造」 | ✅ |
| §16 README/AGENTS 记档义务 | ①链中 orphan 运维面（含 N2 可执行时间窗处置）②current.json 愈合失败复合效应（告警语义）③「reader 先于 writer 部署」升级顺序——三段全部落地 | ✅ |

#### 1.2.1 SA3 备案偏差裁定：**成立（accepted）**

**偏差内容**（`reader.ts` `analyzeStreamForResume` C2/C3 段）：SegMax bin **无任何引用**（`refsToSegMax` 为空）时，截断点取「从 0 起完整帧前缀边界」（`walkCompletePrefixEnd`）而非设计 §5.4 字面 `T=0`——即保留完整未引用帧，仅截断其后的撕裂尾块。有引用路径不受影响（`t = max(ref end)`，代码 `if (refsToSegMax.length === 0)` 守卫实证）。

**裁定依据（六条）**：

1. **链安全论证不绑定该场景**：§5.4「[T,|B|) 残留字节 → 新帧 offset ≠ 链末端 → frame-boundary-invalid」的论证前提是引用链非空（新帧必须从「上一被引用帧末尾」衔接）。Refs 为空时链尚不存在：续写新帧 fresh-stat 落保留帧之后，构成该段**首个被引用帧**——reader 对首引用不做 boundary 检查（`storage-gate.ts` `expected===null` 路径；设计 §4.3 D-A1 备案同款）。保留帧永久处于「首个被引用帧之前」的惰性残渣位置（N1/G2 豁免族认可的位置语义）。
2. **不变量 H 保持**：resume ⇒ reader ok——保留帧无引用、reader 惰性不读（`readBinOrNull` 仅被引用路径消费）→ 续写后 reader ok。实证：§13.29 窗口1/窗口3、§13.32c、D-A1-续四锚均断言续写后 `readStreamStrict` ok 且全绿。
3. **安全性不变量 S 保持**：Refs 为空 ⇒ 被丢弃区间 `[prefixEnd,|B|)` 与「完整行引用帧区间」之交为空集——结构性成立（不存在任何引用帧）。
4. **数据保守方向正确**：偏差比设计字面**少删**字节——保留的是「不可证明损坏」的完整帧（ADR 授权截断而非强制截断：AC3 "safely truncates **only** …" 界定的是许可边界）。少删不触碰「不改写历史」红线；多删（设计字面）反而更接近主动清除不可证字节。
5. **契约面已由 SA6 红灯锚钉死**：任务简报明示权威锚点=设计定稿 §13；SA6 §13.11（C1+C2 并存夹具：inline-only JSONL + orphan 完整帧 + 7B 撕裂尾 → 断言修复后 bin 保留 `FRAME_BYTES`）与 §13.29 窗口1/3（断言恰一次 `bin-orphan-frames` 事件 + 健康续写）共同构成该行为的验收契约——设计字面 T=0（bin 截为 0 字节）反而无法通过 §13.11。实现与红灯契约一致，119 锚全绿（本 SA4 独立复跑 375/375）。
6. **无副作用扩散**：保留字节计入 §6.3 `binBytes` 种子 → 仅影响滚动早/晚（软阈值，D4 非对称论证成立）；§9.3 闭段核查以实际字节计，方向自洽；`exhaustedAtOpen('segment')` 以修复后计数判定，语义正确。

**残余记档（LOW-1，非阻断）**：Refs 为空且 bin 全为完整帧时（§13.29 窗口1 形），实现输出 `stream-tail-repaired{repair:'bin-orphan-frames', truncatedBytes:0}`——一次「零字节修复」事件（截断为 no-op）。事件语义轻微失真（报告了未发生字节移除的「修复」；实义是「残渣保留」）。该行为被窗口1「恰一次事件」断言钉死，属契约现状而非实现 bug；建议后续票将 `truncatedBytes:0` 的事件语义在 README 注明（或演进为独立 `residue-retained` 语义），不阻塞本票。

### 1.3 E2E spec 触发性 — N/A（本票无 `*.spec.ts`；全部为 vitest 单测，见 1.4）

### 1.4 vitest 触发性自检 — ✅ PASS

- 新增/修改的 7 个 `*.test.ts` 全部位于 `packages/namespace-diagnostic-log/test/`。
- 根 `vitest.config.ts` include=`packages/*/test/**/*.test.ts` 全覆盖；CI（`.github/workflows/ci.yml` "Test" step）执行 `pnpm test` = `vitest run --typecheck`；"Typecheck" step 显式含 `tsc -p packages/namespace-diagnostic-log/tsconfig.json`。无「测试存在但 CI 不触发」黑洞。

### 1.5 协议假设审查 — ✅ PASS（§17 表全量复核）

- §17 章节存在且 8 行假设**全部**为「源码引用 / 官方文档引用 / ADR 摘录」类型，零「应该/通常/预计」类无据推断。
- 源码引用逐条静态复核成立：appendFileSync 惰性创建（`file.ts` commitRecord 现行实现）、truncateSync 收缩（applyRepairs；POSIX ftruncate 语义）、readdirSync throw→零候选（`resolveResumeCandidate` catch 分支）、8 位定宽字典序=数值序（`segments.sort()` + `reader.ts` 既有注释）、streamId 定长 32hex（`schema-patterns.ts` P_STREAM_ID）。
- 两条「中」风险项（单进程独占根目录部署纪律、Host slot 外构造）为部署约束非代码可证——已列入 §三 SA7 动态清单。

### 1.6 契约改动连锁 — ✅ PASS

- 无 return→throw / 同步变 async / catch 改 rethrow 类改动（设计 §18 预判与 diff 一致）。
- `createFileDiagnosticLog` 仍绝不抛：新增全部构造期 IO（locator 读/分析/截断/writeCurrent）均在既有构造级 crash 包络 try 块内；`analyzeStreamForResume` 自带全函数兜底（内部异常 → rotate 收敛，不外抛）。
- `readStreamStrict` 签名/同步性/绝不抛零变化；`streamLayoutPaths` 形状不变（`segmentFilePaths` 纯增量导出）；`index.ts` 无新公共导出（分析函数/类型仅模块级导出供 `file.ts`/`health.ts` 包内消费——grep 实证 index.ts 零 re-export）。

### 1.7 源码 GREP 断言禁令 — ✅ PASS

7 个改动测试文件零命中 `readFileSync(<源码>) + toMatch/toContain` 反模式；全部断言面向运行时产物（磁盘字节 / 健康事件 / reader 返回），符合 `helpers/file.ts:14-15` 纪律。`eventsOfTypeRaw` 为事件对象窄化（按 type 过滤后对事件**字段值**断言），非源码文本断言。

### 2. 读写路径一致性 — ✅ 一致

- 写路径（writer：17 键 manifest + 当前 segment jsonl/bin + current.json）与读路径（reader/analysis：双形状 manifest 门 + 全 segment 升序扫描 + 跨段 sequence 状态机）同源同盘点。
- 无内存-磁盘孪生真相源（D4）：滚动状态 reopen 时由磁盘文件事实重导出（§6.3），运行期仅本 writer append 推进；frameOffset 恒 fresh-stat 不孪生。
- G1 落实实证：§13.17b（闭段 bin 尾 orphan = 惰性残渣）健康 resume + 零修复 + 闭段字节恒等 + reader ok——analysis 对非 SegMax bin 只 stat 尺寸不做尾部行走，与 §5.4 闭段原则一致；§13.17a（非 SegMax 未终止末行）corrupt rotate 与 reader `line-unterminated` 同向。

### 3. 静默失败扫描 — ✅ 无新增静默路径

- 五种解析结局全部响亮：fresh（新 generation 文件可见）/ resume（修复事件 + current.json 愈合）/ rotate（`stream-generation-rotated` + 新 generation）/ ambiguous（disabled + `stream-init-failed{locator-ambiguous}` + 零写入 §13.22/23b 实证）/ 耗尽（恰一次 `stream-exhausted`）。
- emit 丢弃仅在 mode≠ready/exhaustedLatch 已置位后发生——属 §7 设计既定的「一次转换事件 + 后续静默丢弃」策略（#152 memory.ts 同款备案），非新增静默面。

### 4. 降级方案审查 — ✅ 安全

- ENOENT→∅（BIN-first 崩溃窗口）非伪降级：与 reader 同款豁免（`reader.ts` 既有 ENOENT 分支），且仅限「stat 证明缺失」；不可读（EACCES/EISDIR）一律保守 rotate（§13.32a/b 钉死「绝不按空文件续写」）——二分纪律落实，无「跳过修复继续续写」陷阱分支。
- locator 不可读→重扫非 §5.1 禁止的伪降级（current.json 是可重建 locator 非完整性证明，三分支结局均确定且响亮——设计 §3.1 R1 预防性澄清落实）。

### 5. 极端条件攻击 — ✅ 未发现可静态确认漏洞

攻击面逐项推演（要点）：非法 targets（0/1.5/负/2^53，§13.28 全值×全键 12 例）；非法 streamId/namespaceId 文法门（路径穿越阻断）；locator 指向不存在 stream（§13.23a/b）；99999999 段溢出不回绕（`nextSegmentName` 由守卫分支短路）；Refs 为空/全完整/含垃圾 magic/未知 frameVersion 的 bin 尾矩阵（§5.4 walk 四态穷尽：complete/incomplete/unknown-magic→corrupt/unknown-frame→incompatible，前缀行走与尾部行走断点语义一致）；跨段引用（carrier.segment 指向 SegMax 的引用自任意段收集——`refsToSegMax` 收集面=全部完整行，含敌意跨段引用）；重复/乱序 sequence（状态机 corrupt）；修复中断电（truncateSync 单点收缩，POSIX 语义无中间撕裂态——§17 依据）；applyRepairs 中途 IO 失败（已成功修复保留 + rotate，无半修复续写态）。全部收敛于设计钉死分支。

### 6. 错误处理链路 — ✅ 完整

构造级 crash 包络保留（`pipeline-crashed` 收敛）；分析函数绝不抛（兜底 rotate）；修复/locator 写失败各有专属事件通道（`repair-io-failure`/`storage-write-failed{stage:'current'}` §13.33 实证）；歧义/耗尽/配置门各有 disabled 终态事件。

### 7. 架构评估 — ✅ 可行

无绕过架构约束的补丁（0 FIXME/TODO/HACK）；修复/滚动/续写全部落在 ADR-0012 既有条文空间内；无触发退回 SA1 信号。

### 8. 过度设计审查 — ✅ 精简

src 净增约 +950 行对应五个范围项（issue 正文全文），无「为将来需求」的抽象层；唯一超设计文本的函数 `walkCompletePrefixEnd`（15 行）是备案偏差的最小支撑；防御性检查均可对应设计条款（如 `currentSegment===null` 守卫对应注入路径不滚动）。

---

## 二. G1–G4 裁决落实核验

| 裁决 | 落实证据 | 判定 |
|---|---|---|
| **G1** 闭段 bin 尾 orphan=惰性残渣（§13.17b 健康 resume/零修复/reader ok 为 oracle） | §13.17b 绿：`streamId` 不变、rotated/tail-repaired 零事件、闭段 bin 字节恒等、续写 seq 3、reader ok；§13.17a JSONL 半句（非 SegMax 未终止末行=中间损坏 corrupt）保留成立 | ✅ |
| **G2** H 逆命题豁免族（rotate 而 reader ok 合规 ⇔ 分歧源为 reader 不读的字节；§13.15a/b 只断 analysis 侧） | §13.15a/b 零 reader 侧断言（仅 rotated+字节恒等+零修复）；实现侧 SegMax bin 不可读→corrupt 无论有无引用（N1 豁免族）；§13.13/14a/16a/17a 等非豁免场景则双向断言（reader 同 corrupt/incompatible） | ✅ |
| **G3** `stream-init-failed.reason` 只留四值 disabled 终态；两旧值迁移 rotated | `health.ts` 类型联合恰四值（旧值物理删除）；mismatch 测试迁移为 `stream-generation-rotated{stream-incompatible}` + init-failed 零出现断言；§13.28/22/23b 新值全锚定 | ✅ |
| **G4** §13.31 数值标定 records=100/jsonl=100000/bin=100000 | §13.31 `cfg` 逐字一致（test:1105）；三 emit 同段注入窗口成立（①②③步全落 00000001） | ✅ |

---

## 三. 动态审核重点（交 SA7）

> SA4 为静态审核者，以下需真实运行环境验证；SA7 在 `task_diagnostic-log-stream-roll-repair_sa7_report.md` 逐条回复。

1. **`repair-io-failure` 路径零测试覆盖**：`applyRepairs` 的 `truncateSync` 失败分支（rotate cause `repair-io-failure`）无任何红灯/绿灯锚（设计 §13 未列锚，SA6 未落，SA3 实现但未验证）。建议 SA7 注入只读 stream 目录（chmod 555 目录 / 只读挂载）于「存在可修复尾巴」的 fixture，断言恰一次 `stream-generation-rotated{cause:'repair-io-failure'}` + 新 generation 承接 + 已成功的前序修复保留。
2. **非 root 运行身份下的 EACCES 语义**：§13.32b（chmod 000 bin）与上述注入依赖 EACCES 真实生效——若 CI runner 以 root 运行会静默失效（root 可读 000 文件）。SA7 须在 `gh run` 日志环境确认运行身份（`id -u`）非 0。
3. **真实崩溃窗口（kill -9）而非磁盘写模拟**：§13.29 系列以直接写盘模拟崩溃窗口；SA7 可用真进程 kill -9 于 BIN/JSONL append 间隙复现四窗口终态（验证「模拟夹具 ≡ 真实撕裂产物」假设——本票 §17 未含该实测）。
4. **构造期 O(stream) 同步扫描的量级**：大 stream（如 ≥64 MiB×多段）下构造耗时与 Host slot 外构造纪律的实际接线面（归 #149–151/#155 验收，本票仅记档）。
5. **全仓 `pnpm test`（139 文件/1780 测试）+ `pnpm typecheck` 在 CI 环境复绿**（本 SA4 已独立复跑包级 375/375；全仓面交 SA7/CI 日志确认）。

## 四. 非阻断记档汇总

| # | 级别 | 内容 | 处置 |
|---|---|---|---|
| LOW-1 | 观测语义 | Refs 空 + bin 全完整帧 → `stream-tail-repaired{bin-orphan-frames, truncatedBytes:0}`（零字节「修复」事件；残渣保留义）。被 §13.29 窗口1「恰一次事件」锚钉死为契约现状 | 后续票 README 注明或语义演进；不阻塞 |
| LOW-2 | 归因粒度 | `analyzeStreamForResume` 外层兜底 catch 与 segmentsDir readdir 失败均归 `manifest-invalid`（闭枚举内无更优 cause；reader 对同盘判 corrupt，H 方向保持） | 记档；实际不可达（所有 IO 已逐点 catch） |
| LOW-3 | 测试缺口 | `repair-io-failure` 零覆盖（见 §三.1） | 交 SA7 动态补验 |

---

## 五. 结论

**Verdict: pass**

- SA3 实现与设计定稿（§0–§18）、G1–G4 裁决、SA6 33+ 锚红灯契约全面一致；备案偏差（Refs 空 bin 截断点=完整帧前缀边界）经六条依据裁定**成立**——链安全/H/S/数据保守性/契约面（§13.11 钉死）全部支持，且已被红灯锚定为验收契约的组成部分。
- 独立复验：包级 375/375 绿、typecheck 0 错、`git diff --check` 干净、版本 bump 0.1.3、ALLOW/DENY 边界零违例、#148 冻结面零触碰。
- SA7 可进入动态验证（重点见 §三）。
