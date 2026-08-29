# Design: Reopen streams, roll segments, and repair provable tails（Issue #153）

> SA1 设计产出（**R1 修订版 + 定稿随附修订（SA2 R2 pass 附条件：N1 §4.3 H 豁免行 / N2 §14 运维指引可执行化，均已并入）**——此前已落实 SA2 R1 reject 全部 4 项必改：#1 MEDIUM 链中 orphan 生命周期、#2 RotateCause 判定次序、#3 不可读≠缺失、#4 writeCurrent 事件指名；+3 项 LOW 记档。逐条落实位置见 §15 表）；任务类型：功能开发。
>
> 约束优先级：任务简报 > SA8 前置门禁（`task_diagnostic-log-stream-roll-repair_conflict_report.md` verdict=clear + 七条钉死语义 + `…_relevant_decisions.md` ADR 摘录）> ADR-0012（含 2026-08-28 首切片 amendment）/ADR-0011/ADR-0008 > #148 冻结契约 > #152/R2 实现与设计（`wiki/raw/task_diagnostic-log-file-adapter-r2_design.md`）> SA2 R1 评审（`task_diagnostic-log-stream-roll-repair_sa2_review.md`，reject 窄范围）。
>
> 本文只设计，不改任何代码。SA6 红灯锚定按简报工作流裁剪置于本设计定稿（SA8 设计复审 clear + SA2 pass）之后——§13 给出 SA6 锚定的完整契约面。

---

## §0. 范围与钉死约束对照

本票五个范围项（简报 §本票范围）：①健康 stream 续写 reopen；②segment group 滚动；③启动尾部修复；④耗尽；⑤测试面。逐条对照 SA8 冲突报告移交的六组钉死约束，本设计全部落实：

| # | 钉死约束（冲突报告） | 本设计落点 |
|---|---|---|
| 1 | 耗尽＝丢弃并上报（disabled），**不得**新建 generation 续写（冲突点 #2） | §7：segment `99999999` 与 sequence uint64 两条耗尽路径统一为 exhausted 门闩 + 恰一次 `stream-exhausted` + 后续丢弃；新建 generation 仅适用于 corrupt/incompatible/冻结配置改变/无法安全续写 |
| 2 | roll targets 冻结归类须给出结论与 ADR 依据；manifest 追加字段合法且创建后不可变（冲突点 #1） | §2-D5/§4.2：三个 target 冻结进 manifest（17 键新形状），归类论证 + reader 逐 segment 执行 |
| 3 | write-slot 纪律覆盖 reopen 检查与尾部修复的一切同步文件操作；不引入 queue/batch/fsync/常驻 fd（冲突点 #3） | §12：构造期扫描/修复全部是同步 fs 操作，必须在 sequencer slot 外执行；运行期 append 模式不变 |
| 4 | 修复上报事件走预授权路径，内容限于稳定码与受控字段，遵守 observer 数据纪律与低基数（冲突点 #4） | §10：新增 2 个事件成员 + 2 个 reason 扩值，逐字段对照 ADR observer 内容纪律 |
| 5 | 新建 generation 尽力写 genesis；不按 wall clock 猜测 locator；「可证明尾部」按后缀性质严格判定（冲突点 #5/#6/#7） | §3（locator 确定性算法，禁 mtime/createdAt/目录序）；§5（三类可修复尾部的严格判定式 + 后缀性质）；§8.3（新 generation 走既有 genesis 路径） |
| 6 | AC1「across Runtime generations」＝ stream 跨 Runtime generation 存续，不得与 stream generation 混同 | §1.2/§8：streamId 在健康 reopen 时不变；Runtime generation 更迭只是「顺序复用同一 stream 的下一位单逻辑 writer」 |

**明确排除**（简报）：不实现 retention（#154）、replay/Host 接线（#155/#149–#151）；不改 #148 冻结面（record/schema 文本与指纹/vocabulary/emission/健康事件既有成员形状——新增成员走 §10 预授权路径）；不引入 queue/batch/fsync/常驻 fd；不 push、不开 PR。

---

## §1. 现状、差距与术语钉死

### 1.1 #152 交付面与本票差距

| 能力 | #152 现状（基线 8611e68） | #153 目标 |
|---|---|---|
| segment 布局 | 恒写 `segments/00000001.{jsonl,bin}`（`file.ts:309` 硬编码 `'00000001'`；`paths.ts:59-60` 固定派生） | JSONL/BIN 成对滚动，固定 8 位编号，`99999999` 耗尽 |
| reopen | `resumeStreamId` 四分支（missing/mismatch/未提供/匹配）全落**新建 generation**（`file.ts:751-759` 注释明示「#152 无续写能力」） | 健康证明通过 → 从既有 `lastCommittedSequence` 续写；locator 确定性解析 |
| 尾部修复 | 无（README 明示「由 strict reader 诚实判定损坏，不做自动修复」） | 三类可证明尾部截断 + 逐次健康上报 |
| manifest | 恰 14 键（`file.ts:149-176` buildManifest；`reader.ts:104-119` MANIFEST_KEYS 精确键集） | 追加 3 个 roll target 键（17 键），冻结面扩展 |
| 健康事件 | 12 成员（`health.ts:22-82`） | +2 成员（stream-tail-repaired / stream-generation-rotated）+ stream-init-failed 2 个 reason 扩值 |
| 耗尽 | sequence uint64 一条（`file.ts:253-259`） | + segment `99999999` 一条；reopen 时已耗尽的再上报 |

### 1.2 术语钉死（防 SA2 攻击点：概念混同）

- **Runtime generation**（ADR-0008/0009 的进程内 Runtime 更迭）≠ **stream generation**（本日志的一代 stream）。AC1 的「across Runtime generations」指前者：同一 streamId 的 stream 被**顺序复用**的多位 writer 接力，不绑定任何 Runtime generation（ADR-0012「stream不绑定 Runtime generation」）。
- **单逻辑 writer**（AC1）：本切片无 queue（amendment 首切片边界），emit 同步在调用栈内执行——单进程内对同一 `(rootDir, namespaceId)` 同时至多一个 adapter 实例是**部署约束**（ADR-0012「单进程独占根目录…不实现跨进程锁」）；正常重启是顺序复用，非并发。本票不添加任何锁原语。
- **可证明尾部（provable tail）**：以后缀性质定义的三个可截断集合（§5.1），判定只依赖**终止符/边界行走/引用交叉**三类机器可证事实，绝不依赖「内容恰好能解析」这类弱证据。

---

## §2. 总体架构决策（D1–D8）

| # | 决策 | 内容 | 依据 |
|---|---|---|---|
| D1 | locator 解析三分支 | 显式 `resumeStreamId` > 可用 current.json > manifests 扫描确定性恢复（恰一候选）；歧义（不可用 locator + ≥2 候选）→ disabled + 上报，绝不猜测 | ADR-0012 §File adapter 布局；冲突点 #6 |
| D2 | reopen = 构造期严格证明 | 健康证明复用 reader 同源校验（manifest 门 + 逐行 VFSL/storage/policy + 跨 segment sequence 状态机），**reader 判 ok（且尾损可修复）⇔ 可续写**；证明失败 → 确定性 rotate（新 generation，cause 封闭枚举） | ADR-0012 §打开现有 stream/§打开与尾部恢复；AC4 |
| D3 | 修复三类别 + 全有或全无 | 仅 §5.1 三类尾部截断；出现任何不可修复损坏 → **零修复**（含可修复尾巴也不动），旧 stream 只读 + rotate | ADR-0012「以下情况不尝试修复中间数据」；冲突点 #7 |
| D4 | 滚动状态由文件派生 | segment 编号/字节/行数在 reopen 时从磁盘扫描派生，运行期内存计数器推进；**不新增任何持久状态文件**（无内存-磁盘孪生真相源） | ADR-0012 amendment「无常驻 fd/无队列」精神；#152 fresh-stat 原则 |
| D5 | roll targets 归冻结面 | 三 target 写入 manifest（17 键）并按冻结配置比对；改变 → 新 generation | 冲突点 #1（SA8 裁决放行的保守分支）；论证见 §4.2 |
| D6 | 耗尽 = disabled（丢弃+上报） | segment `99999999` 滚动溢出与 sequence uint64 共用 exhausted 门闩，恰一次 `stream-exhausted`；**绝不**新建 generation 续写 | 冲突点 #2 钉死 |
| D7 | 健康事件只增不改 | 新增 2 成员 + 2 reason 扩值；既有成员形状零改动（`stream-exhausted` 复用原形状） | #148 §10-J13 式预授权路径；G3「扩值」先例（`health.ts:66-73` 注） |
| D8 | 修复只动最大 segment 的尾部 | 三类修复仅作用于**最大（编号最高）有文件 segment**；更早 segment 的同形状异常 = 中间损坏 → rotate | ADR「最终/尾部」后缀语义；冲突点 #7 |

---

## §3. Locator（current.json）确定性解析与歧义处置

### 3.1 候选解析算法（构造期，伪代码）

```text
resolveResumeCandidate(rootDir, namespaceId, config):
  # ① 显式处置优先（Host 明示的 resume 目标；不做任何静默回退）
  if config.resumeStreamId !== undefined:
      return { kind: 'explicit', streamId: config.resumeStreamId }

  # ② locator 可用性判定（current.json 只保存 format/version/streamId，是可重建 locator 而非完整性证明）
  current = read current.json（缺失/不可读/JSON 解析失败/非对象 → 不可用）
  if current 可用
     and current.format === 'ndcl-current' and current.version === 1
     and isSafeStreamId(current.streamId):
        return { kind: 'locator', streamId: current.streamId }
  # 不可用（含 current.streamId 指向的目录/manifest 不存在的情形——先落 ③ 重扫）

  # ③ manifests 扫描（确定性恢复；候选 = streams/ 下「目录名过 streamId 文法 且 manifest.json 文件存在」的 stream）
  candidates = sorted([dir for dir in readdir(streamsDir) if isSafeStreamId(dir) and exists(manifest.json)])
  #    readdir throw（streams/ 不存在）按零候选处理
  if |candidates| === 1: return { kind: 'recovered', streamId: candidates[0] }   # 确定性恢复
  if |candidates| === 0: return { kind: 'fresh' }                                # 首次启用
  return { kind: 'ambiguous' }                                                    # ≥2：不安全歧义
```

**确定性依据（钉死）**：

- 排序与选择只依赖**封闭字符串集合上的字典序**（streamId 是 `log-+32hex` 定长，字典序全序确定）；`readdir` 顺序不参与判定。
- **禁止**的猜测变体（全部属「按 wall clock 静默猜测」的等价物，冲突点 #6 钉死）：mtime/ctime 排序、manifest `createdAt` 比较（ISO 时间戳即 wall clock）、目录项顺序、manifest 文件大小、JSONL 覆盖行数比较。唯一的恢复路径是「不可用 locator + 恰一候选」这一**无歧义**情形。
- 「manifest.json 文件存在」只是候选资格（存在性是确定性事实）；其内容合法性留给 §4 健康证明裁决——恰一候选但 manifest 损坏 → 按证明失败 rotate，不回退重扫。
- **（R1 预防性澄清，与 §5.1 的纪律分界）** locator「不可读 → 按不可用 → 确定性扫描」**不是** §5.1 禁止的伪降级：current.json 是「可重建 locator 而非完整性证明」（ADR-0012 明文），其全部三个下游结局（恰一候选恢复 / 零候选 fresh / ≥2 候选 disabled+事件）均确定且响亮；而 §5.1 针对的是**历史载荷文件**（segment jsonl/bin）——把不可读历史当空串会以续写覆盖不可证状态，二者性质不同，纪律各自钉死。

### 3.2 四种解析结局

| 结局 | 后续 | 事件 |
|---|---|---|
| `explicit` / `locator` / `recovered` | 进入 §4 健康证明 | 证明通过：静默（G1 先例）；修复/耗尽另发 §5/§7 事件 |
| `fresh` | §8.3 新 generation（CSPRNG streamId + `'wx'` 碰撞重试 ≤8，现状不变） | 无（首次启用成功静默） |
| `ambiguous` | **disabled**：不创建任何新 stream、不写任何文件（含 current.json）、emitter 照常构造但静默丢弃（J6 形状完备） | `stream-init-failed{code:'LOG_STREAM_INIT_FAILED', reason:'locator-ambiguous'}`（reason 扩值，§10） |
| `explicit` 目标证明失败 | rotate（显式处置失败不静默回退 locator——防意图猜测） | `stream-generation-rotated{cause:…}`（§10） |

歧义终态是 ADR 明文支持的「要求显式处置」：操作员下一次以 `resumeStreamId` 显式指定、或修复/删除多余 stream、或恢复 current.json。disabled 不影响业务（ADR-0011 业务隔离）。

---

## §4. 健康证明（reopen 的严格检查）

### 4.1 证明内容与 verdict

新增**内部函数** `analyzeStreamForResume`（落 `reader.ts`，与 `readStreamStrict` 共享 manifest 门/行分割/逐行校验/连续性状态机的内部实现，防双份漂移；**不从 index.ts 导出**——SA6 经公共行为测试）。签名（SA3 实现契约）：

```ts
type ResumeRepairKind = 'jsonl-incomplete-line' | 'bin-incomplete-frame' | 'bin-orphan-frames'
interface ResumeRepair { kind: ResumeRepairKind; segment: string; truncateToBytes: number; truncatedBytes: number }
interface ResumeStreamState {
  lastCommittedSequence: string | null       // 扫描锚定的最后 sequence（无 record → null）
  currentSegment: string                     // 最大有文件 segment；无 → '00000001'
  jsonlBytes: number; binBytes: number; records: number   // 修复后该 segment 计数（§6.3 种子）
  exhaustedAtOpen: 'sequence' | 'segment' | null
}
type ResumeAnalysis =
  | { verdict: 'resume'; repairs: ResumeRepair[]; resume: ResumeStreamState }
  | { verdict: 'rotate'; cause: RotateCause }   // 见 §4.4 封闭枚举
function analyzeStreamForResume(req: {
  rootDir: string; namespaceId: string; streamId: string
  resolved: { updateCapture: boolean; inputPolicy: string; inlineUpdateMaxBytes: number;
              lineBudgetBytes: number; targetJsonlSegmentBytes: number;
              targetBinSegmentBytes: number; targetRecordsPerSegment: number }
}): ResumeAnalysis
```

证明链条（任一失败即得 rotate verdict）。**R1 修订（SA2 #2）：判定次序钉死**——manifest 门（含 incompatible 全部判定）**先于** resume 特有的 17 键要求执行，使 analysis cause 与 reader 对同一 manifest 的判定严格同向（14 键被篡改指纹 → reader incompatible ⇒ cause `stream-incompatible`，而非 `legacy-manifest`）；同一磁盘状态 + 同一配置 ⇒ 唯一 cause：

1. **manifest 门（与 reader 同源、同序）**，按以下短路次序：
   a. `readFileSync(manifestPath)` ENOENT → `manifest-missing`；
   b. 不可读（非 ENOENT 读失败）/JSON ✗/非对象/键集形状（14/17 之外的 15、16、多余、缺失键）/类型核对/身份互核/`format`/`version` 异常 → `manifest-invalid`；
   c. INCOMPATIBLE_SET 七码（dialect-unknown / schema-fingerprint-mismatch / record-version-unknown / frame-version-unknown / frame-payload-type-unknown / frame-flags-nonzero / frame-reserved-nonzero）→ `stream-incompatible`；
   d. **（resume 特有，最末位）** 门全过但恰 14 键 legacy 形状 → `legacy-manifest`（14 键 manifest 是 ADR 合法产物、reader 仍可读，但缺冻结 roll targets 无法证明续写策略一致，属「无法安全续写」）。
2. **冻结策略比对**（§4.2 表；仅 17 键形状可达）任一不等 → `frozen-policy-mismatch`。
3. **交叉扫描**：逐 segment（8 位名升序）逐行执行与 reader 同源的行长/parse/VFSL/canonical decimal/streamId/policy/storage 帧交叉校验 + 跨 segment `expectedSequence=1n` 连续性状态机（R2 §3.4 语义原样）；同时收集：每 segment 完整行引用的 sidecar `(segment, frameOffset, payloadLength)` 集合（引用帧起点/终点）、每 segment jsonl 完整行数与字节、每 segment bin 字节数、最大有文件 segment。**segment 文件读取的二分纪律见 §5.1 R1 修订**（ENOENT ≠ 不可读）。
4. **损坏分类**（§5）：除「最大 segment 的三类可修复尾部」外，任何 record/stream 级 issue（中间坏行、VFSL/storage/CRC 错、sequence-gap/out-of-order、policy 违规、闭段 roll-target 违规 §9.3、非最大 segment 的未终止尾行、§5.1 的不可读文件等）→ `stream-corrupt`；未知 format/dialect/frame/payload 类 → `stream-incompatible`。
5. **修复安全性 S**（§5.2）结构性验证通过 → 输出 repairs + resume state。

### 4.2 冻结策略比对表（D5 归类论证）

| 解析后配置（file.ts 现行默认） | manifest 键 | ADR 归类 |
|---|---|---|
| `updateCapture ?? false` | `committedUpdateCapture` | 冻结（ADR-0012 明列） |
| `inputPolicy ?? 'digest'` | `inputCapturePolicy` | 冻结（明列） |
| `inlineUpdateMaxBytes ?? 4096` | `inlineUpdateMaxBytes` | 冻结（明列） |
| `lineBudgetBytes ?? 1 MiB` | `jsonlLineLimitBytes` | 冻结（明列） |
| `targetJsonlSegmentBytes ?? 67108864`（64 MiB） | `targetJsonlSegmentBytes` | **本票扩展冻结** |
| `targetBinSegmentBytes ?? 268435456`（256 MiB） | `targetBinSegmentBytes` | **本票扩展冻结** |
| `targetRecordsPerSegment ?? 100000` | `targetRecordsPerSegment` | **本票扩展冻结** |
| `payloadMaxBytes` | 无此键 | 非冻结：ADR 冻结清单与 manifest「至少保存」均不含；只影响 payload 是否被 omit，不影响已落 record 解释 |
| `issuesPolicy` | 无此键 | 非冻结：emitter 侧投影策略（#148），不进 manifest |

**roll targets 归冻结面的论证**（冲突点 #1 要求 SA1 给出结论与依据）：

1. targets 直接决定每条 sidecar record 的**物理表示字段** `storage.segment` 的取值序列（storage projection 的一部分；CONTEXT.md「先决定 inline/sidecar 并构造最终 record（segment/frameOffset/…）」）——「影响记录解释的配置」的字面落点。
2. 一致可验证性：若 targets 归动态类（与 retention/queue 容量/batch/fd cache/metrics sampling 同类），则同一 stream 前后 segment 可按不同 targets 分组；而 §9.3 的 reader 闭段核查以 manifest 单值为准——动态 targets 会使按旧值滚动的闭段被误判违规。**流内常量 + 变更即新建 generation** 是唯一自洽方案。
3. manifest「至少保存」为非穷举（SA8 冲突点 #1 原文），追加字段合法且创建后不可变（`'wx'` 一次写入）；归类冻结比归类动态**更保守**（多冻结一项），与「冻结项改变时新建stream generation」机制自洽。

### 4.3 与 strict reader 的健康等价性（D2 核心）

**不变量 H**：`analyzeStreamForResume` verdict=`resume` 且 repairs 应用后，`readStreamStrict` 对该 stream 的判定必为 `ok`；verdict=`rotate`（corrupt/incompatible 类）时，`readStreamStrict` 对未修复旧 stream 的判定必非 `ok`（损坏如实可见）。实现上两者共享同一扫描核心（SA3 落地要求：`readStreamStrict` 现行为零变化，分析函数只增不改动其聚合路径），保证「能续写 ⇔ reader 认健康」不自相矛盾。

**〔N1 豁免行·定稿随附修订（SA2 R2 附条件）〕H 逆命题的唯一豁免族——不可读且不被引用消费的容器**：SegMax `.bin` 存在但不可读且**无引用**时（闭段 bin stat 失败且无引用同族），analysis 按 §5.1 保守 `rotate('stream-corrupt')`，而 reader 因惰性读取判 `ok`——`readBinOrNull` 仅在 `checkSidecar` 的有引用路径被调用（`reader.ts:436-438`），无引用则该 bin 字节永不被消费。**钉死：`rotate(corrupt 类) ⇏ 必 reader 非 ok`——分析须证明「可续写性」（SegMax bin 将被续写、其字节是链安全证明的必需输入，§5.1 R1），证明义务严于 reader 的「可解释性」，故分析判定是 reader 判定的严格下界（resume ⇒ ok 恒成立；ok ⇏ resume）。** 此行同时是 SA4 复核 H 的验收依据：实现中出现「analysis rotate(corrupt) 而 reader ok」时，仅当属本豁免族（SegMax bin 不可读且无引用 / 闭段 bin stat 失败且无引用）为合规，其余一律判实现违反 H，不得按 H 字面误报或漏报。

特例备案（SA7 动态测试 D-A1 终态，`file-adapter-sa7-dynamic.test.ts:70-138`）：bin 中**首个被引用帧之前**存在完整 orphan 帧（definitive JSONL 失败 + candidate 复用的合法终态）——reader 判 ok（首引用不做 boundary 检查、orphan 无引用不产 issue），本分析同样判健康：§5.4 的 T 取「最后被引用帧末尾」，该 orphan 位于 T 之前、不在截断范围，续写后新帧 fresh-stat 落在文件末尾＝引用链末端，链完整性保持。**未被引用的中间字节不是损坏**（ADR 不修复清单不含它；reader 不检它）；只有「最后被引用帧之后」的字节才同时是修复候选与续写链安全威胁（§5.4 论证）。

**R1 修订（SA2 #1 MEDIUM）——上述备案的翻转边界（writer 自产「链中 orphan」）**：同一 D-A1 机制把前置 record 从 inline 换成 **committed sidecar 引用**（同段已有 ref₁ 落 `[0..a)`）即翻转结论——后续 sidecar 的 BIN 落盘 `[a..b)` 后 JSONL definitive 失败（EISDIR/EACCES/ENOENT，`file.ts:576-579` 分类），故障清除 + candidate 复用续写，新帧 fresh-stat 落 `[b..c)` 并 committed：ref₂.offset=b ≠ ref₁.end=a，`storage-gate.ts:88` 严格相等链断，reader 判 `frame-boundary-invalid`（corrupt）——**writer 经 R2 合法的恢复路径自产 reader-corrupt 终态**。此为 #152 遗留自伤路径（R2 §334 已由「strict reader 如实报告 corruption」吸收），#153 逐字保留 R2 语义（§11.1）故不消除其产生；#153 的行为是**诚实检测**：该 orphan 夹在两被引用帧之间＝ADR 后缀性质之外的中间损坏（冲突点 #7）→ reopen 判 `stream-corrupt` rotate（AC4 授权处置：不改写历史、旧流字节恒等只读、新 generation 承接后续）。后果边界与缓解取舍见 §14 R1 风险行与 §13.31 全生命周期锚。

### 4.4 rotate cause 封闭枚举

```ts
type RotateCause =
  | 'manifest-missing'          // manifest ENOENT（含 explicit 目标不存在）
  | 'manifest-invalid'          // 解析/键集/类型/身份互核失败
  | 'legacy-manifest'           // 恰 14 键（#152 时代产物）：可读不可续写
  | 'frozen-policy-mismatch'    // §4.2 任一冻结值 ≠ 当前解析配置
  | 'stream-corrupt'            // 中间损坏/引用缺失/CRC/越界/序列断裂/闭段违规/不可证尾部/§5.1 不可读文件（R1：与 reader invalid-json/frame-missing 同向）
  | 'stream-incompatible'       // INCOMPATIBLE_SET（未知 dialect/version/frame/payload/flags/reserved）
  | 'repair-io-failure'         // §5.5 修复截断 IO 失败（file.ts 层追加，非分析产出）
```

枚举是健康证明失败原因的**确定性全划分**：同一磁盘状态 + 同一配置 ⇒ 唯一 cause（SA6 可对每 cause 独立红灯锚定）。

---

## §5. 可证明尾部修复（三类 + 安全性 + 全有或全无）

### 5.1 三类可修复尾部的严格判定式（仅最大有文件 segment）

记 `SegMax` = 最大编号的有 `.jsonl` 或 `.bin` 文件的 segment；`J` = SegMax 的 `.jsonl` 原始字节；`B` = SegMax 的 `.bin` 字节；`Refs` = **全部**完整 JSONL 行（跨所有 segment）中 sidecar carrier 指向 SegMax 的引用集合，元素 `(off, end)`，`end = off + 25 + carrier.payloadLength`（该帧已逐 record 交叉校验通过）。

**R1 修订（SA2 #3）：`J`/`B` 的读取三分支——ENOENT（真缺失）≠ 不可读 ≠ 可读，禁止把「不可读」并入「缺失→空串」伪降级**：

| 读取结果 | `J`（SegMax jsonl） | `B`（SegMax bin） |
|---|---|---|
| ENOENT（stat 证明缺失） | `J = ∅`（合法 BIN-first 崩溃窗口：BIN 已写、JSONL 未建文件；reader 同款豁免 `reader.ts:462-463`） | `B = ∅`（合法：`.bin` 惰性创建，该组尚无 sidecar） |
| 存在但不可读（非 ENOENT 读失败，如 EACCES）或非常规文件（目录占位 EISDIR——恰是 D-A1 注入手段） | **verdict rotate(`stream-corrupt`)**：与 reader 对 EISDIR jsonl 记 `invalid-json`→corrupt 同向（`reader.ts:461-467` 只豁免 ENOENT），不变量 H 两侧一致；把不可读当空串会以「零行健康续写」洗掉 IO 故障并向不可读文件续 append——撕裂 H 的伪降级实现面 | **verdict rotate(`stream-corrupt`)，无论有无引用**：SegMax bin 将被续写，链安全证明（§5.4 行走/T 计算）必须以其字节为可证输入；且「跳过修复继续续写」是陷阱——新 sidecar 引用落在不可读 bin 上，reader `readBinOrNull` → null → 后续每条引用判 `frame-missing`，自产必然 corrupt |
| 读取成功 | 字节即 `J` | 字节即 `B` |

非 SegMax segment 的同款二分：jsonl 不可读 → `stream-corrupt`（reader `invalid-json` 同向）；bin 在**该段存在 sidecar 引用**时必须可读（读失败 → 引用帧不可证 → `stream-corrupt`，与 reader `frame-missing` 同向）；bin 无引用时其内容不需读（§5.4 闭段惰性残渣原则），§9.3 闭段核查以 stat 尺寸计（stat 自身失败 → 同款 `stream-corrupt`）。

| 类 | ADR 原文 | 判定式（机器可证） | 动作 |
|---|---|---|---|
| C1 不完整尾 JSONL 行 | 「截断最终不完整 JSONL 行」 | `J` 非空 **且** `J` 最后一字节 ≠ `0x0A` ⇒ 末块（最后一个 `0x0A` 之后的全字节；`J` 全文无 `0x0A` ⇒ 末块=整个 `J`，截断至 0 字节——首条 record 撕裂即此退化形，锚定见 §13.7 变体）为不完整行。终止符证明，**与该块内容是否恰好可 parse 无关**（writer 格式每行必以 `\n` 结束——ADR §JSONL record） | `truncate(jsonl, J 中最后 0x0A 的下一字节偏移)` |
| C2 不完整尾 frame | 「截断最终不完整 frame」 | 按 §5.4 从 T 行走后若停在 `p < |B|` 且尾块 `[p,|B|)` 满足：`\|尾块\| < 25`，或 25 字节头 magic=`NDCL` ∧ frameVersion=1 ∧ payloadType=1 ∧ flags=0 ∧ reserved=0 ∧ `p+25+payloadLength > \|B\|` | `truncate(bin, T)`（§5.4；含同范围内的完整 orphan，单一截断单一事件） |
| C3 完整未引用尾部 orphan frames | 「截断完整但未被任何完整 JSONL record引用的尾部 orphan frames」 | 从 T 行走逐帧完整且恰好落 EOF（`Refs` 与 `[T,|B|)` 无交，结构性成立 §5.4） ⇒ `[T,|B|)` 为连续未引用后缀 | `truncate(bin, T)` |

**后缀性质（冲突点 #7 钉死的落实）**：C1 只能是文件最末一个物理块（`\n` 是行分隔符，中间块不可能缺终止符——非最大 segment 出现未终止末块即中间损坏 → corrupt）；C2/C3 的截断点 T 之后不得再有任何被引用帧或完整数据。**夹在已引用帧之间/位于 T 之前的 orphan、其后还有引用数据的残块，一律不修复**（前者是 reader-ok 的惰性残渣 §4.3，后者根本不可能在引用链完整时出现）。

### 5.2 修复安全性不变量 S

> 对每个 repair，被丢弃的字节区间不得与任何**完整** JSONL 行引用的帧区间 `[off, end)` 相交，也不得移除任何完整 JSONL 行。

- C1：只删最后一个 `0x0A` 之后的字节——不可能触达任何完整行。结构性成立。
- C2/C3：`T = max{ end | (off,end) ∈ Refs }`（Refs 为空 → T=0）。任何 `(off,end) ∈ Refs` 有 `end ≤ T`，且若有 `off ≥ T` 则 `end > T` 矛盾——`Refs ∩ [T, |B|) = ∅`。结构性成立。
- S 失败不可达（按上述定义构造）；若实现中引用校验与 T 计算脱钩导致 S 可违反，视实现 bug → 该 stream 按 `stream-corrupt` 处理（保守）。**S 是设计不变量而非运行期兜底**。

### 5.3 全有或全无（D3）

健康证明输出 verdict 前已全量扫描：凡存在任一不可修复损坏（§4.1 第 4 步任一 issue），**不应用任何修复**（包括本可修复的尾巴）——旧 stream 整体只读 + rotate。理由：ADR「以下情况不尝试修复中间数据……旧stream标为corrupt或incompatible并保持只读」是对 stream 整体的裁决；对已判腐的 stream 做部分改写会制造「半修复」中间态，且修复价值为零（不再续写）。

### 5.4 T 与 bin 尾部行走（C2/C3 共用）

```text
T = max(end for (off,end) in Refs) if Refs 非空 else 0
if T == |B|: 无 bin 尾部修复
p = T
while p < |B|:
    if |B| - p < 25: break            # 尾块不足 header → C2
    header = B[p .. p+25]
    if magic ≠ 'NDCL':                # 不可证明为撕裂帧的字节 → 非三类 → stream-corrupt
        verdict = rotate('stream-corrupt'); stop
    if frameVersion ≠ 1 or payloadType ≠ 1 or flags ≠ 0 or reserved ≠ 0:
        verdict = rotate('stream-incompatible'); stop   # 未知 frame 事实 → ADR 不修复清单
    L = payloadLength
    if p + 25 + L > |B|: break        # header 合法而 payload 越界 → C2（partial payload）
    p += 25 + L
# 循环正常退出（p == |B|）→ [T,|B|) 全为完整未引用帧 → C3
# break 于 p < |B| → C2（truncate 到 T；同范围内完整 orphan 一并移除，事件 kind='bin-incomplete-frame' 终局证据优先）
```

**为什么尾部必须清零才能续写（链安全）**：reader/writer 的 per-segment 引用链模型（`storage-gate.ts:78-110` expectedOffset 链；`file.ts:241` injectedFrameOffsets 同款）要求后续被引用帧从「上一被引用帧末尾」连续衔接。若 `[T,|B|)` 残留任意字节，续写的新帧 fresh-stat 落在残渣之后，其 offset ≠ 链末端 → 未来读取判 `frame-boundary-invalid`（自伤）。C3 因此不只是空间回收，而是续写前置条件；同理 C1 残行不清除会让续写行拼在残块之后形成不可解析超长行。**闭段（非 SegMax）bin 的未引用尾字节不影响任何未来 append，不构成修复条件，也不构成损坏**（reader-ok 一致性 §4.3）——闭段惰性残渣与开段链安全威胁的区分是功能性的，非美学取舍。

### 5.5 修复应用与上报（file.ts 层）

```text
applyRepairs(analysis):
  for repair of analysis.repairs（顺序：C1 在前，C2/C3 在后——分析函数输出序）:
      try truncateSync(目标文件路径, repair.truncateToBytes)
      catch err → notify(stream-generation-rotated{cause:'repair-io-failure'}) → 走 rotate 新 generation
                  （已成功的修复保留、其事件保留——截断只删 §5.2 证明无引用字节，无历史改写）
      notify({ type:'stream-tail-repaired', repair: repair.kind, truncatedBytes: repair.truncatedBytes })
  # 全部成功 → 进入 resume 状态装配（§6.3 种子）+ writeCurrent(locator 愈合)
```

- `truncateSync` 收缩语义：POSIX `ftruncate` 截断为指定长度；进程在截断中断电只会留下旧长度或新长度之一，不产生中间撕裂态——比「重写文件」安全，这是选 truncate 而非 rewrite 的依据（§17 协议假设）。
- 修复事件**逐次**上报（AC3「reporting each repair」）：一次构造至多 2 个事件（C1 至多 1 + bin 至多 1；C2/C3 合并为单一截断单一事件，终局证据类 `bin-incomplete-frame` 优先——若移除范围全为完整 orphan 帧则为 `bin-orphan-frames`）。

---

## §6. Segment group 滚动

### 6.1 编号与路径

- segment 名沿用 `P_SEGMENT`（`schema-patterns.ts:34` `^[0-9]{8}$`，`paths.ts:42-44` isSegmentName 单源）：从 `00000001` 起、`00000000` 保留不用、固定 8 位十进制、**不回绕**。
- `paths.ts` 新增导出（纯增量，既有 `streamLayoutPaths` 返回形状不动——其 `jsonlPath`/`binPath` 语义收窄注释为「segment 00000001 的别名」）：

```ts
export function segmentFilePaths(segmentsDir: string, segment: string): { jsonlPath: string; binPath: string }
```

- 文件惰性创建：滚动只推进内存编号，**不预建文件**；`.jsonl` 在该组首条 record append 时由 `appendFileSync` 创建、`.bin` 在该组首条 sidecar append 时创建（与 #152「`.bin` 惰性创建」一致；`file-adapter-layout.test.ts:190` 锚定的行为保留）。

### 6.2 滚动判定（写下一条 record 前）

writer 内存态（fresh generation 或 resume 种子后）：

```ts
currentSegment: string                  // 8 位十进制
segJsonlBytes / segBinBytes / segRecords: number
```

判定与推进（仅 emission/genesis 路径，见下）：

```text
beforeCommit():   # commitPrepared 内、candidateSequence() 之前
  if segJsonlBytes ≥ targetJsonlSegmentBytes
  or segBinBytes   ≥ targetBinSegmentBytes
  or segRecords    ≥ targetRecordsPerSegment:
      next = 十进制 +1（'99999999' → 无 9 位表示 → 溢出）
      if currentSegment === '99999999': 段耗尽路径（§7）；丢弃当前 record（含触发 record）
      else: currentSegment = next; jsonlPath/binPath 重派生; 三计数器清零
```

- **「任一 target 达到」语义**：以**当前用量**（本组已落盘字节/行数）与 target 比较——`≥` 即达；判定发生在准备门全部通过、即将进入 JSONL append 的提交分支之前（R2 §3.2 提交点纪律不动：sequence candidate 仍只在提交分支取得；滚动不消耗也不分配 sequence）。gate 丢弃的 record 不触发滚动。
- **单条超限豁免**：单条合法 record 可让新 group 超过 target（ADR 原文），但不得超过 record/payload 硬上限（line 预算与 payloadMaxBytes 门既有）。空 group（全零计数）对 `target ≥ 1` 恒不滚——不会形成空转滚动。
- **计数器推进**：`appendFileSync(bin)` 成功（含 JSONL definitive 失败留下的 orphan 字节——物理字节如实计数）即 `segBinBytes += 25+payloadLength`；JSONL confirmed 成功即 `segJsonlBytes += lineBytes+1`、`segRecords += 1`。definitive 失败（零字节可证）不推进。ambiguous → generation 封闭，计数器失效。
- **计数器 vs fresh-stat 的非对称（有意）**：frameOffset 仍恒 fresh-stat（`file.ts:289-292` planFrameOffset 不变——offset 是正确性关键的引用事实，不许孪生）；roll 计数器是软阈值，漂移只导致早滚/晚滚，不产生损坏，故取内存计数（每 record 两次 statSync 的开销无正确性收益，且行数本无法 stat）。行数计数在构造/续写期由扫描派生，运行期只由本 writer append 推进——无第二真相源（D4）。
- **注入接缝（injectFinalRecordFile）不滚动**：testing 直通接缝沿用「不分配/不推进」语义，也不做滚动判定——SA6 夹具对 segment 内容有完全控制权（`testing.ts:94-98` 注释语义扩展备案）。

### 6.3 reopen 种子

resume 成功（含修复应用后）：

```text
currentSegment = SegMax（无任何 segment 文件 → '00000001'）
segJsonlBytes  = |SegMax .jsonl 修复后字节|（缺文件 → 0）
segBinBytes    = |SegMax .bin 修复后字节|（缺文件 → 0）
segRecords     = SegMax .jsonl 修复后 0x0A 计数
lastCommittedSequence = 扫描锚定的最后 sequence（§4.1；无 record → null）
```

首条续写 record 若计数已达标即自然滚入下一 segment（与崩溃前决策一致——决策无持久化，由文件事实重导出，同一磁盘状态必得同一决策）。

### 6.4 滚动与 sequence/链的一致性

- sequence 是 stream 级（跨 segment 连续），reader 状态机不按 segment 重置（`reader.ts:424-425`/`556-559` 现行语义即跨 segment）——滚动对 sequence 透明。
- sidecar carrier 的 `segment` 字段取**当前** segment（替换 `file.ts:309` 硬编码 `'00000001'`）；frame 仍写**当前** segment 的 bin、fresh-stat 取 offset（同段引用链在滚动后从新 bin 的 0 开始——per-segment 链模型天然支持）。
- 滚动不产生任何「关闭标记」文件或 manifest 变更（manifest 不可变；闭段由「存在更大编号 segment」这一事实定义，§9.3 据此核查）。

---

## §7. 耗尽（两条路径，显式行为）

| 路径 | 触发 | 行为 |
|---|---|---|
| sequence uint64 | confirmed JSONL success 且 sequence = `UINT64_MAX`（#152 既有，`file.ts:253-259`） | `exhaustedLatch = true` + 恰一次 `stream-exhausted`；后续 emission 丢弃（静默——沿 #152 既有事件抑制策略：一次转换事件 + 后续丢弃不逐条发，`memory.ts:186-197` 同款备案） |
| segment `99999999` | `beforeCommit()` 时三计数器已达任一 target 且 `currentSegment === '99999999'`（+1 无 8 位表示，不回绕） | 同上：恰一次 `stream-exhausted` + 触发 record 及后续全部丢弃；**不**新建 segment、**不**新建 generation |

- 两条路径共用 `exhaustedLatch`（同 latch 防二次事件）；事件复用既有 `{ type:'stream-exhausted' }` 形状零改动（D7；成因由 stream 状态机械可判：sequence=max vs segment=99999999 且达标，不加字段避免改冻结成员形状）。**〔LOW-1 记档（SA2 #5）〕** 消费方仅凭事件不可分成因——受「只增不改」约束（加判别字段＝改既有成员形状，超出 §10 预授权路径授权面）；补偿事实：成因对持有 stream 状态的方机械可判（读 last sequence / 最大 segment 名），且两条路径的处置完全相同（disabled + 丢弃），成因只影响运维诊断粒度，不影响任何自动化决策分叉。
- **钉死（冲突点 #2）**：耗尽终态是 disabled（日志能力不可用 + 上报），**不是** rotate。新建 generation 仅属 corrupt/incompatible/冻结配置改变/无法安全续写四类触发（ADR §Stream 与 generation / §打开与尾部恢复）。AC4 的「or disabled stream」析取在耗尽分支被 ADR 收窄为 disabled——issue 正文两种终态分别落位：可修复/可换代的走新 generation，耗尽的走 disabled。
- **reopen 时已耗尽**：resume 扫描导出 `exhaustedAtOpen`——`lastCommittedSequence === UINT64_MAX` → `'sequence'`；`currentSegment === '99999999'` 且修复后计数已达任一 target → `'segment'`。两者任一非 null → 构造期即置 latch + 恰一次 `stream-exhausted`（Host 重启后需要知道日志已死；每进程寿命恰一次，非每次 emit）。二者同时成立只发一次（latch 守卫）。
- 耗尽是**终局**：无自动解除；操作员处置（显式 rotate 配置面）归 Host 接线票。

---

## §8. writer 构造流程重构（伪代码总览）

### 8.1 新构造主流程（替换 `file.ts:736-784` try 块；crash 包络/schema-compile/路径文法检查/形状完备返回全部保留原样）

```text
try:
  if !isSafeNamespaceId(namespaceId): disabled + stream-init-failed('invalid-namespace-id')       # 既有
  if resumeStreamId ≠ ∅ and !isSafeStreamId(...): disabled + stream-init-failed('invalid-stream-id')  # 既有
  if 任一 roll target 非法（非整数 / < 1 / > 2^53-1 / NaN / ∞）: disabled + stream-init-failed('invalid-roll-targets')  # 新（loud 配置门，绝不静默钳制）
  compiled = getRecordSchemaCompilation(); !ok → failed + schema-compile-failed                     # 既有

  cand = resolveResumeCandidate()                                # §3.1
  switch cand.kind:
    case 'fresh':      initNewGeneration()                        # §8.3（现状路径 + 17 键 manifest + 段态清零）
    case 'ambiguous':  mode = disabled; notify(stream-init-failed{reason:'locator-ambiguous'})
    case 'explicit' | 'locator' | 'recovered':
        a = analyzeStreamForResume({streamId: cand.streamId, resolved})    # §4
        if a.verdict === 'rotate':
            notify(stream-generation-rotated{cause: a.cause}); initNewGeneration()
        else:
            ok = applyRepairs(a.repairs)                          # §5.5；失败 → rotate('repair-io-failure') → initNewGeneration()
            if !ok: break
            装配 resume 态（§6.3 种子；currentStreamId = cand.streamId；jsonlPath/binPath 重派生）
            if a.resume.exhaustedAtOpen ≠ null: exhaustedLatch = true; notify(stream-exhausted)
            writeCurrent(cand.streamId)                           # locator 愈合（temp+rename，现状函数复用）
            # R1（SA2 #4）：写失败复用既有事件通道 storage-write-failed{stage:'current', code:<errno>}
            #（file.ts:720-734 现行为——事件形状/errno 码零新增）；失败不降级 resume（stream 已证明可续写）
            mode = sealed ? 'failed' : 'ready'                    # 构造期 genesis 不存在于 resume 路径；sealed 恒 false，保留防御位
catch: mode = failed; notify(pipeline-crashed{stage:'adapter'})   # 既有构造级 crash 包络
```

要点：

- **resume 不写 genesis**：genesis 是「新 stream」义务（ADR §Stream 与 generation；冲突点 #5）。resume 时 `config.genesisUpdateBytes` 被忽略（文档化优先级：续写语义下重写 genesis 会伪造基线时点；README 记载）。
- `presetLastSequence`（testing seam）仅在 fresh 路径生效；resume 路径扫描结果优先（文档化；`testing.ts:108-118` 签名零改动）。
- rotate 路径的 `stream-generation-rotated` 事件先于新 generation 初始化发出（因果序）；新 generation 初始化失败（collision 耗尽 → disabled + EEXIST 事件；mkdir 失败 → disabled）沿用现状。

### 8.2 append 路径差异（对 `appendSemantic`/`runGenesis`/`commitPrepared`）

```text
appendSemantic:  现状不动（mode/exhaustedLatch/jsonlPath/binPath 门 + 准备门 + 顶层 catch）
commitPrepared:  beforeCommit()   # ← 唯一新增调用点（§6.2；段耗尽在此丢弃触发 record）
                 candidate = candidateSequence(); record.sequence = candidate   # 现状
                 commitRecord(...)                                                # 现状（BIN-first、definitive/ambiguous 分类、fresh-stat offset 全不动）
```

- `commitRecord` 内 sidecar 帧写入**当前 segment** 的 bin（binPath 已随滚动重派生）；`projectCarrier` 的 `segment` 字段取 `currentSegment`。
- R2 §3.2/§3.2.1 提交点纪律、definitive/ambiguous 分类、`commitAmbiguous` 封闭语义**逐字保留**（§11.1）。

### 8.3 新 generation 初始化（initializeGeneration 扩展）

现状流程（segments mkdir → manifest `'wx'` → genesis → current.json，`file.ts:684-718`）保留，增量：manifest 17 键（§9.1）；段态清零（currentSegment='00000001'、三计数器 0、lastCommittedSequence=preset??null）；`buildManifest` 签名 +3 参（私有函数）。genesis 尽力语义（含守卫跳过不消耗 sequence、ambiguous 密封）不变。

---

## §9. Strict reader 增量（三处，全部只增）

### 9.1 manifest 双形状（14 键 legacy ∪ 17 键 current）

- `manifestGateIssue` 的精确键集检查改为接受两个**封闭**键集之一：恰 14 键（现状 MANIFEST_KEYS）或 14 键 + `targetJsonlSegmentBytes`/`targetBinSegmentBytes`/`targetRecordsPerSegment`（**原子扩展**：三键必须同进同出，任一部分出现 → `manifest-invalid`）。三键类型核对：`Number.isInteger` ∧ ≥1 ∧ ≤ 2^53-1。
- 依据：ADR「至少保存」非穷举——恰 14 键 manifest 是 #152 writer 的合法产物，reader 拒绝它会将合法历史误判 corrupt；17 键是本票冻结扩展。**读能力（两形状皆可读）≠ 续写能力（仅 17 键，§4.1）**。
- 15/16 键或三键类型违规 → `manifest-invalid`（corrupt）。
- **〔LOW-2 记档（SA2 #6）：前向断裂〕** 17 键 manifest 对 #152 旧版 reader（0.1.2，`reader.ts:135` 精确 14 键比对）＝ `manifest-invalid`——混版本部署下旧 reader 把新 writer 的流误判 corrupt。可接受性：§18 已证包外零 reader（接线未发生），本包 `private` + 同仓 co-deploy（版本随票 bump 0.1.3），不存在长期混版本面；README 记载升级顺序要求「reader 先于 writer 部署」（新 reader 读新旧两形状，旧 reader 只读旧形状——先升 reader 则读写两侧均安全）。

### 9.2 新 reader 码 `line-unterminated`（corrupt，不入 INCOMPATIBLE_SET）

任一 segment 的 `.jsonl` 末物理块缺终止符 `\n`（文件非空且末字节 ≠ 0x0A）→ 该行 record 记 `line-unterminated`（附 segment/offset）。依据：ADR §JSONL record「每行……并以 `\n` 结束」是格式要求；#152 reader 把无 `\n` 末块当正常行解析（`reader.ts:230-241` splitRawLines 注释）是在尚无修复能力时的宽容——本票修复判定改为终止符证明（§5.1 C1）后，reader 与 writer 必须同一事实基础：**未终止末块＝不完整行**，无论其字节是否恰好可 parse（可 parse 的半行被修复截断，reader 若判 ok 即自相矛盾）。该行其余诊断（parse/VFSL 失败等）照常叠加，sequence 不锚定（身份不可解释行现行语义）。
多 segment 时每个 segment 文件独立检查（非最大 segment 的未终止末块同样报告——静态读取不区分开/闭段）。

### 9.3 新 reader 码 `manifest-roll-target-violation`（corrupt，stream/segment 级）

manifest 为 17 键形状时，对每个**闭段**（存在更大编号 segment 的段）：该段 `jsonlBytes ≥ targetJsonlSegmentBytes ∨ binBytes ≥ targetBinSegmentBytes ∨ 完整行数 ≥ targetRecordsPerSegment` 必须成立（滚动只在达标时发生——ADR「任一target达到时…关闭当前group」的逆否）；不成立 → 该段记 `manifest-roll-target-violation`。最大段不核查（当前组未关闭）。14 键 legacy manifest 无 targets → 跳过（无可执行的冻结声明）。
依据：R2 先例——reader 逐行执行 manifest 冻结 policy（§2.2–§2.5 四策略）；targets 成为第五项冻结 policy 后同纪律执行，防「writer 从不滚动」这类 policy 违规被 strict 读隐瞒。

### 9.4 reader 不改的部分

`readStreamStrict` 签名/同步/绝不抛/聚合语义、INCOMPATIBLE_SET 七码边界、跨 segment expectedSequence 状态机、`splitRawLines` 字节行分割、storage-gate 共享原语、`streamLayoutPaths` 使用方式（reader 只用 segmentsDir/manifestPath）——全部不动。两新码均映射 `corrupt`（可由 v1 规范精确解释的 policy/格式违规），不入 INCOMPATIBLE_SET。

---

## §10. 健康事件词表演进（#148 §10-J13 式预授权路径）

**只增不改**（D7）：既有 12 成员形状零改动；`stream-exhausted` 复用原形状（§7）。

### 10.1 新成员 ×2

```ts
| {
    type: 'stream-tail-repaired'                       // ADR-0012 §打开与尾部恢复「自动修复通过observer上报」的强制要求
    repair: 'jsonl-incomplete-line' | 'bin-incomplete-frame' | 'bin-orphan-frames'   // 封闭枚举
    truncatedBytes: number                              // 截断字节数（计数，非 label）
  }
| {
    type: 'stream-generation-rotated'                   // rotate 决策的诚实可观测（旧 stream 保持只读、未改写）
    cause: RotateCause                                   // §4.4 封闭枚举（含 'repair-io-failure'）
  }
```

### 10.2 reason 扩值 ×2（沿 G3「复用既有成员扩值」先例，`health.ts:66-73` 注）

`stream-init-failed.reason` 增加：`'locator-ambiguous'`（§3.2 歧义 disabled）、`'invalid-roll-targets'`（§8.1 配置门 disabled）。

### 10.3 observer 数据纪律逐字段核验（冲突点 #4）

| 字段 | 纪律 | 核验 |
|---|---|---|
| `repair` / `cause` | 稳定 code（封闭枚举） | ✅ 3 值 / 7 值封闭集合 |
| `truncatedBytes` | 计数类数值（类比 `projectedRecordBytes` 先例） | ✅ 非 label、无内容 |
| （不含） | 原 record/input/Base64/update bytes/底层 message/Error/cause 文本/stack | ✅ 均未携带；segment/streamId/offset **刻意不进事件**（streamId 高基数、segment 半高基数——身份经 adapter 实例上下文可得，ADR-0011「日志字段不得进入默认低基数 metrics label」保守执行） |
| 事件冻结 | freezeEvent + safeNotify 隔离 | ✅ 走既有 makeEventNotifier（`health.ts:128-134`） |

事件总量有界：单次构造至多 2 个 repair 事件 + 1 rotate/1 exhausted + 既有初始化事件——无逐 record 洪泛面。

---

## §11. 与 R2 冻结纪律的兼容（SA2 必查点预答）

### 11.1 保留不动的 R2 契约

- **提交点纪律**：candidate 只在准备门全过、提交分支取得；gate drop / definitive pre-commit failure（open 期 EISDIR/EACCES/ENOENT 零字节可证）不消耗 candidate；ambiguous outcome 保守 reservation + 封闭旧 generation，绝不在旧 stream 写第二条相同 `(streamId, sequence)`（`file.ts:248-280` 全部保留）。
- **fresh-stat offset / BIN-first / 无 queue·batch·fsync·常驻 fd / emit void 不抛**：全部不变。
- **reader 连续性锚定**（R2 §3.4：anchor 只依赖 JSON/VFSL/canonical decimal/streamId；`ok=false` 不取消 anchor）不变——本票的 rotate 判定用「任一 issue 即不健康」，比 anchor 规则更严，二者不冲突。

### 11.2 「永不复用 candidate」的跨进程语义（关键澄清）

R2 的 ambiguous-reservation 是**进程寿命内**的不可证明性防线（EIO-after-write 等）。进程终止后防线随内存消失，#153 的 reopen 以**磁盘事实重新证明**：末行未终止（C1）⇒ 该 sequence 可证明从未完整持久化 ⇒ 续写把它分配给下一条 record，不构成「写第二条相同 sequence」（第一条从未存在）；末行完整 ⇒ 扫描锚定其为已提交 ⇒ 续写从其后继续。两分支都不产生重复 `(streamId, sequence)`——不变量以**可证明性**而非**进程记忆**维持。进程内的 ambiguous 封闭（mode='failed'）与跨进程的证明式续写是同一纪律的两个时相。

### 11.3 行为变更清单（既有测试受影响面，SA6 锚定）

| 变更 | 受影响既有测试 | 性质 |
|---|---|---|
| manifest 14 → 17 键 | `file-adapter-layout.test.ts:108/149`（键集逐项断言）、`helpers/file.ts:137-155` validManifest | 键集断言扩 3 键；helper 默认加三 target（默认值） |
| 健康 resumeStreamId → 真续写（不再恒新建） | `file-adapter-mismatch-interference.test.ts:257`（该例为指纹不符——结局不变 rotate，仅事件改；**R1/SA2 #2**：其 fixture 为 14 键篡改指纹，按 §4.1 R1 次序归因 `stream-incompatible`，见 §13.18(c)） | 「match → 静默新建」类断言若存在须改为「match → 续写」 |
| resume 失败事件 stream-init-failed → stream-generation-rotated | mismatch 测试 `eventsOfType(events,'stream-init-failed').some(reason='manifest-mismatch')` | 事件通道迁移（init-failed 仅保留给 disabled 终态：invalid-namespace-id/invalid-stream-id/locator-ambiguous/invalid-roll-targets）；rotate 侧断言 `stream-generation-rotated{cause:'stream-incompatible'}` |
| 无 locator + 恰一 manifest-bearing stream → 自动恢复续写 | 写 fixture 后在同一 root 构造 adapter 的测试（如 mismatch:257 tampered manifest → 现走 rotate+新事件，结局同） | 构造语义升级的主特征 |
| reader 新码 line-unterminated / manifest-roll-target-violation / 17 键 | strict-reader 测试新增用例；既有夹具全部以 `\n` 结尾（grep 实证，`jsonlText` 用例均在行尾带 `\n`）→ 零既有断言破坏 | 只增 |

---

## §12. 业务隔离与 write-slot 纪律（ADR-0011/0008/0012 amendment）

1. **构造期同步 IO 的接线门**：reopen 健康证明（locator 读 + 全量交叉扫描 + 修复截断）与滚动判定的全部 fs 操作是同步的，量级 O(stream 总字节)。ADR-0012 amendment 的规范性条款（「任何将 File adapter 的 `emit` 接入 namespace 生命周期的调用点必须位于 write sequencer slot 之外或释放后」）经冲突点 #3 钉死**同样覆盖构造期**：Host 必须在 slot 外构造 adapter（Runtime/Host 装配路径天然在写槽外；接线票 #149–#151/#155 验收时核验）。
2. **不影响业务结果**：构造任何失败终态（disabled/failed/rotate）只发健康事件，不 throw、不改业务返回值/提交事实（既有构造级 crash 包络保留，`file.ts:780-784`）。
3. **无锁、无 queue、无常驻 fd**：单进程独占根目录是部署约束（ADR-0012）；同进程内对同一 `(rootDir, namespaceId)` 构造两个 adapter 实例属部署违规，本票不加防御原语（与 #152 立场一致，README 记载）。
4. **shutdown**：无新增后台任务/常驻句柄/后台 flush（滚动与修复都在构造/emit 调用栈内完成）；Registry/Persistence 停止不等日志（ADR-0011/0012 既有）。

---

## §13. SA6 红灯测试锚定（设计定稿后落 `test/file-adapter-reopen-roll-repair.test.ts` 等）

> 以下为验收契约锚点（非实现细节断言；全部针对运行时产物：磁盘字节/事件/reader 返回——`helpers/file.ts:14-15` 纪律）。崩溃窗口夹具直接写盘模拟（现有 `writeStreamFixture` 扩展 current.json 与多 segment 支持）。

**AC1 reopen/续写（门槛 12）**
1. adapter A（小 targets）emit 若干 → 同 root 同配置构造 adapter B（无 resumeStreamId）→ `B.streamId === A.streamId`；B 的首条 emit sequence = A 末条 +1；append 落入正确 segment；`readStreamStrict` 全绿（跨段连续）。
2. B 续写后 current.json 仍指向该 stream；A/B 的记录在 JSONL 中按 sequence 全序排列（顺序复用单 writer）。
3. `resumeStreamId` 显式指定健康 stream → 续写同 1（显式处置路径）。

**AC2 滚动**
4. targets 极小（如 jsonl 200B / bin 256B / records 2）+ 混合 inline/sidecar emit N 条 → `segments/` 出现 `00000001..0000000K`；逐组断言：闭组在滚动前至少一维达标（§9.3 的正例）；同组 JSONL/BIN 同号成对；单条超大 record 独占新组不越 record/payload 硬上限。
5. 恰达 target（jsonlBytes == target）→ 下一条前滚动；未达 → 不滚（边界双向）。
6. 续写期滚动：A 滚出多段后 B 续写 → 新 record 落入 SegMax 或依计数滚入下一段（§6.3 种子正确性）。

**AC3 尾部修复**
7. C1：SegMax jsonl 末行截断去 `\n`（含「截断后恰好仍是合法 JSON」变体——终止符证明不依赖 parse）→ 构造 → 事件 `stream-tail-repaired{repair:'jsonl-incomplete-line'}` + 文件截到最后 `\n` 后 + 续写 sequence 复用该号 + reader ok。**R1 变体（SA2 #7，LOW-3）：全文退化形**——`J` 为单条 record 且全文无 `0x0A`（首条 record 撕裂即此形；含「内容恰为合法 JSON」变体）→ 截为 0 字节 + `truncatedBytes = |J|` + resume `lastCommittedSequence = null` + 续写首条 sequence = `'1'`。
8. C2a：bin 末尾 <25 字节残块 → `bin-incomplete-frame` 修复续写；C2b：25 字节头合法 + payload 越界 → 同上。
9. C3：bin 末尾完整 orphan 帧（1+ 连续帧、无引用）→ `bin-orphan-frames` 修复续写；续写首帧 offset = 截断点（链衔接）。
10. C2+C3 混合（orphan 帧后接撕裂帧）→ 单次截断单事件（kind=bin-incomplete-frame）。
11. C1+C2 并存 → 两事件两截断。
12. 修复后 `readStreamStrict` ok 且 SegMax 计数种子正确（下一条 record 的落段与 §6.3 推演一致）。

**AC4 中间损坏不修复 + 确定性 rotate（门槛 8/10）**
13. 中间坏 JSON 行（complete 行 parse ✗）+ 末尾可修复尾巴 → **零修复**（文件字节恒等）+ `stream-generation-rotated{cause:'stream-corrupt'}` + 新 streamId + current.json 指向新 stream + 旧 manifest/segments 字节恒等 + 新 generation 尽力 genesis（提供 genesisUpdateBytes 时）。
14. 引用帧 CRC 翻位 / 引用 offset 越界 / 引用不存在帧 → corrupt rotate。
15. bin 中部 magic 垃圾尾（不可证撕裂）→ corrupt rotate；未知 frameVersion 尾块 → `stream-incompatible` rotate。
16. sequence-gap（删中间完整行）→ corrupt rotate；orphan 帧夹在被引用帧之间（链断）→ corrupt rotate（冲突点 #7 负例）。
17. 非 SegMax 段的未终止末行 / 非 SegMax 段 bin 尾 orphan → 不修复 → corrupt rotate（后缀性质）；**SegMax 之前的 orphan（D-A1 终态：orphan 在首个被引用帧之前）→ 健康 resume、零修复**（§4.3 特例备案的正例锚定）。
18. **R1 拆分（SA2 #2，cause 唯一性）**——两个独立 fixture 各自重启构造，断言唯一 cause 且与 `readStreamStrict` 对同流判定同向：(a) **17 键篡改** manifest（指纹/版本不符）→ `stream-incompatible` rotate、旧 manifest 字节恒等；(b) **14 键健康** manifest → `legacy-manifest` rotate + `readStreamStrict` 对同流仍 ok（双形状正例，与 19 呼应）。既有 mismatch 测试（`file-adapter-mismatch-interference.test.ts:257-308`）的 fixture 恰为 **14 键篡改指纹**——按 §4.1 R1 钉死次序（manifest 门 incompatible 判定先于 17 键要求）其迁移锚定为 (c)：14 键篡改 → `stream-incompatible`（**不是** `legacy-manifest`）。15/16 键 → `manifest-invalid`（与 30 尾项互参）。
19. 14 键 legacy manifest → `legacy-manifest` rotate；同文件 `readStreamStrict` 仍可读（双形状正例）。
20. 冻结配置改变（任一 target / inline 阈值 / capture / policy / line 上限）→ `frozen-policy-mismatch` rotate + 新 generation manifest 携带新值。

**AC5 locator/歧义/耗尽/重启矩阵**
21. current.json 损坏 JSON + 恰一 stream → 恢复续写 + current.json 愈合。
22. current.json 缺失 + 2 个 manifest-bearing stream → disabled + `stream-init-failed{reason:'locator-ambiguous'}` + 零文件写入（含 current.json）。
23. current.json 指向不存在 stream + 恰一其他候选 → 恢复该候选；≥2 → 歧义 disabled。
24. 显式 resumeStreamId 目标 manifest 缺失 → rotate `manifest-missing`（不回退 locator）。
25. 空命名空间 → fresh 新 generation、无 rotate 事件。
26. segment 耗尽：fixture SegMax=99999999 + targets=1（+匹配 manifest/current.json）→ 构造或首条 emit → 恰一次 `stream-exhausted` + record 丢弃 + 无新段 + 旧文件恒等；reopen 已耗尽 stream → 构造期再上报恰一次（exhaustedAtOpen）。
27. sequence 耗尽：presetLastSequence=UINT64_MAX-1 → 两条 emit → 首条 committed 至 max + 恰一次事件、次条丢弃（#152 既有锚回归）。
28. 非法 targets（0 / 1.5 / 负数 / >2^53）→ disabled + `stream-init-failed{reason:'invalid-roll-targets'}` + 零文件。
29. 崩溃窗口重启矩阵（AC5 逐字）：BIN-before-JSONL 全窗（完整 orphan / 撕裂帧 / 帧完整+行撕裂 / 行完整）× reopen → 修复或健康续写，reader 终态 ok。
30. reader 新码：line-unterminated（含可 parse 半行变体）/ manifest-roll-target-violation（闭组未达标）/ 17 键正例 / 15·16 键 manifest-invalid。

**R1 新增锚（SA2 #1/#3/#4）**

31. **【核心红灯·全生命周期】writer 自产链中 orphan（SA2 #1b）**：小 targets + `updateCapture: true`——① emit sidecar（ref₁ 落 bin `[0..a)`，committed）；② jsonl 路径换目录占位（EISDIR）→ emit sidecar（orphan 落 `[a..b)`；断言 `storage-write-failed{stage:'jsonl', code:'EISDIR'}`——制造瞬间的既有唯一信号）；③ 还原 jsonl → emit sidecar（fresh-stat 跳 orphan，新帧落 `[b..c)` 并 committed，candidate 复用）；④ **进程内** `readStreamStrict` = corrupt 且含 `frame-boundary-invalid`（writer 自产终态实证）；⑤ 同 root 同配置重启构造 adapter B → `stream-generation-rotated{cause:'stream-corrupt'}` 恰一次 + B.streamId ≠ A + 旧 segments/manifest **字节恒等** + B emit 落新 generation（旧历史永久只读、无数据丢失、业务零影响——§14 R1 风险行的行为锚定）。D-A1 健康变体（inline 前置）保持为对照组（17 后半）。
32. **不可读 ≠ 缺失（SA2 #3）**：(a) SegMax `.jsonl` 换成目录占位（EISDIR）+ 其余健康 → 重启构造 → `stream-generation-rotated{cause:'stream-corrupt'}`（**绝不断言**「续写成功/零事件/按空文件处理」）；(b) SegMax `.bin` chmod 000（无引用）→ 同款 `stream-corrupt` rotate（钉死「保守 rotate」分支：不修复、不跳过续写）；(c) 对照：SegMax `.jsonl` ENOENT + bin 健康（BIN-first 窗口）→ 正常 C2/C3 修复或健康续写（ENOENT 豁免不被 (a) 波及）。
33. **locator 愈合失败（SA2 #4）**：resume 成功路径注入 current.json 写失败（namespaceDir 只读 / current.json 目录占位）→ 断言 `storage-write-failed{stage:'current'}` 出现 + resume 续写**不受影响**（sequence 照常推进）；清除注入后再重启一次 → 仍经 locator/扫描确定性恢复同一 stream（不落 `locator-ambiguous`；§14 R1 复合效应记档的行为面）。

---

## §14. 风险与防御性决策

| 风险 | 防御 |
|---|---|
| locator 恢复按时间/顺序猜测 | §3.1 只承认「恰一候选」恢复；歧义 disabled + 上报；显式处置优先且失败不回退 |
| 修复截断误删被引用帧（伪 length 溢出） | T = max(被引用帧 end)（§5.4），S 不变量结构性成立；行走遇未知 header → rotate 而非截断 |
| 半修复中间态 | 决策层全有或全无（§5.3）；IO 失败中断只可能发生在「删无引用字节」的截断上，保留已修复部分 + rotate 上报（§5.5） |
| 续写帧 offset 脱链 | C1/C2/C3 修复正是链安全前置（§5.4 论证）；闭段惰性残渣不威胁链 |
| 内存计数器与磁盘漂移 | offset 恒 fresh-stat（正确性关键）；roll 计数器仅软阈值（§6.2 非对称论证）；reopen 从文件重导出 |
| 歧义/耗尽被静默吞掉 | disabled/rotate/exhausted 全部有专属事件（§7/§10）；无任何「静默成功」新路径 |
| 健康证明与 reader 判定漂移 | 不变量 H + 共享扫描核心（§4.3）；两新 reader 码与修复判定同一事实基础（终止符/引用交叉） |
| manifest 扩键破坏旧流可读性 | 双封闭形状联合（§9.1）；legacy 只禁续写不禁读取 |
| 事件词表膨胀突破 observer 纪律 | 只增不改 + 封闭枚举 + 计数字段 + 刻意排除高基数身份字段（§10.3） |
| 构造期 O(stream) 同步扫描阻塞业务 | write-slot 外构造为规范性接线条件（§12）；量级有界（stream 总字节），属一次性启动成本；优化（增量检查点）会引入持久状态文件，明确不做（D4） |
| 跨进程并发写同一 stream | 部署约束（单进程独占根）重申于 README/AGENTS；不加锁（ADR-0012「不实现跨进程锁」） |
| **〔R1 记档·SA2 #1a〕writer 自产「链中 orphan」不可修复终态**：同段已有 committed sidecar 引用后，一次瞬时 jsonl definitive 故障（EISDIR/EACCES/ENOENT）+ 故障清除 + R2 candidate 复用续写 → ref 链断（`frame-boundary-invalid`）→ #153 起每次重启必然 `stream-corrupt` rotate，该段历史永久只读、后续日志另起 generation。制造瞬间仅有一个泛化信号 `storage-write-failed{stage:'jsonl',code:<errno>}`，与后果的因果链不可由单事件推出。**〔N2 修订·定稿随附（SA2 R2 附条件）：可执行运维指引〕链中 orphan 无法手工处置——正确处置是抢时间窗**：收到 definitive `storage-write-failed{stage:'jsonl'}` 事件后、**后续 sidecar append 提交前**尽快重启进程——此刻 orphan 仍位于 §5.4 尾部（T=最后被引用帧末尾 之后），重启后 C3 自动截断尾部 orphan、健康续写（§13.9 链路）；期间 inline append 不移动 bin 尾、不破坏该窗口。若后续 sidecar append 已提交（orphan 已成链中），手工处置不可行，重启按 corrupt rotate（本行其余后果与缓解取舍照旧）——README 记档该运维面 | 行为锚定 §13.31（全生命周期红灯）+ §13.9（C3 链衔接）；边界论证 §4.3 R1 段；ADR 合规性：corrupt→新 generation 是 AC4/ADR-0012 授权处置、无数据丢失（旧流字节恒等可检、逐 record 诊断仍可用）、业务零影响。**缓解取舍（SA2 #1c，明示拒绝）**：(i)「definitive-JSONL-失败留 orphan 后强制滚段隔离」被拒——ADR-0012 §Segment rolling 只定义 target-触发滚动，未达标强制滚段是未审计的新滚动触发器，且其闭段必被 §9.3 逆否核查判 `manifest-roll-target-violation`（闭段⇒达标的推导只认 target 触发；豁免「尾部含未引用字节的段」会让 never-rolling writer 逃检——无标记可区分二者，拆掉 §4.2 冻结归类的一致可验证性论证）；(ii)「writer 内存 lastRefEnd 链跳检测 + 专属健康事件」被拒（本票）——终态在 reopen 已有专属信号（`stream-generation-rotated{cause:'stream-corrupt'}`），制造瞬间信号缺失的补偿以 N2 时间窗指引 + README 记档承担；新事件成员+新 writer 状态面的词表/复杂度成本不抵收益，且根治须动 R2 冻结的 candidate 复用语义（`file-adapter-sa7-dynamic.test.ts` D-A1 锚定），超出本票边界——记为未来切片候选（连同 §12 接线票评估） |
| **〔R1 记档·SA2 #4b〕locator 愈合失败的复合效应**：rotate/resume 成功但 `writeCurrent` 失败（复用 `storage-write-failed{stage:'current'}`，§8.1 R1）→ current.json 仍指旧 stream：下次重启 valid locator 权威 → 依其指向重走证明——若所指为本次 rotate 的成因流（corrupt/incompatible/legacy），再次 rotate → **每次重启铸造一个新 generation 直至 current.json 某次写成功愈合**；若期间 current.json 彻底损坏/丢失且扫描 ≥2 候选 → `locator-ambiguous` disabled。机制确定性成立（无猜测、valid locator 权威），无数据丢失/无历史改写（每个中间 generation 均完整：manifest+genesis 尽力+字节恒等），增殖有界（每重启至多一个） | 行为锚定 §13.33；README 记档运维面（current 写失败事件应触发运维告警——持续出现即处于未愈合窗口）；不增设新事件（`storage-write-failed{stage:'current'}` 已语义完备） |
| **〔LOW-2 记档·SA2 #6〕17 键对旧版 reader 前向断裂** | §9.1 LOW-2 段：包外零 reader（§18 实证）+ 同仓 co-deploy + README「reader 先于 writer 部署」升级顺序 |

---

## §15. SA2 反馈逐条回应

> round 1 首版预登记 SA8 六组钉死约束（落实完毕）；**R1 修订追加 SA2 R1 reject 全部 7 项**（4 必改 + 3 LOW 记档——LOW 不阻塞但均已记档落位）；**定稿随附追加 N1/N2 两项**（SA2 R2 pass 附条件，文字级）。SA2 评审全文：`task_diagnostic-log-stream-roll-repair_sa2_review.md`。

| 要求/约束 | 是否落实 | 位置 | 摘要 |
|---|:--:|---|---|
| SA8 钉死 1：耗尽=disabled 不新建 generation | ✅ | §7 | 双路径共用 latch，恰一次事件 |
| SA8 钉死 2：roll targets 冻结归类 + 依据 | ✅ | §2-D5/§4.2 | 三键入 manifest（17 键）；物理表示字段/流内常量可验证性/更保守三分论证 |
| SA8 钉死 3：write-slot 覆盖 reopen/修复 | ✅ | §12 | 构造期同步 IO 的 slot 外规范性条件 |
| SA8 钉死 4：修复上报预授权 + observer 纪律 | ✅ | §10 | 2 成员 + 2 扩值；逐字段纪律表 |
| SA8 钉死 5：genesis/wall-clock/后缀性质 | ✅ | §3/§5.1/§8.1/§8.3 | 禁 mtime/createdAt；终止符+边界行走+引用交叉；rotate 走既有 genesis |
| SA8 钉死 6：Runtime generation ≠ stream generation | ✅ | §1.2/§8 | streamId 健康续写不变；顺序复用单 writer |
| **SA2 #1（MEDIUM）(a) 链中 orphan 风险表+README 记档** | ✅ | §14 R1 风险行①/§16 README 条目/§4.3 R1 段 | writer 自产不可修复终态全链记档：触发机制（代码坐标实证）、后果边界（每次重启必然 rotate、历史永久只读、无数据丢失）、制造瞬间既有信号（`storage-write-failed{stage:'jsonl'}`）与因果链不可推性、运维对策 |
| **SA2 #1 (b) 全生命周期红灯锚** | ✅ | §13.31 | 注入（EISDIR）→ 复用续写 → 进程内 reader corrupt 实证 → 重启 rotate + 字节恒等 + 新 generation 承接；D-A1 健康变体保持对照组（§13.17 后半） |
| **SA2 #1 (c) 强制滚段缓解取舍明示** | ✅ | §14 R1 风险行①「缓解取舍」段 | 双变体均拒绝并给理由：(i) 强制滚段违反 ADR target-only 滚动契约 + §9.3 逆否核查封死（豁免即拆 §4.2 论证）；(ii) lastRefEnd 检测+新事件词表成本不抵收益且根治须动 R2 冻结语义——记为未来切片候选 |
| **SA2 #2（MINOR）RotateCause 判定次序** | ✅ | §4.1 步骤 1 a–d 钉死次序/§4.4/§13.18 拆分/§11.3 | manifest 门（invalid/incompatible 全判）先于 17 键要求；14 键篡改 → `stream-incompatible`（与 reader 同向），14 键健康 → `legacy-manifest`；§13.18 拆 (a)17键篡改/(b)14键健康/(c)mismatch fixture 归因三锚 |
| **SA2 #3（MINOR）不可读≠缺失二分** | ✅ | §5.1 R1 三分支表/§4.4 注/§13.32 | ENOENT=合法窗口（空串）≠ EACCES/EISDIR=不可证（SegMax jsonl/bin 一律保守 `stream-corrupt`，与 reader invalid-json/frame-missing 同向）；bin 无引用不可读**不选**「跳过修复续写」（自产 frame-missing 陷阱），钉死保守 rotate；非 SegMax 二分同段钉死 |
| **SA2 #4（MINOR）writeCurrent 事件指名 + 复合效应记档** | ✅ | §8.1 R1 注释/§14 R1 风险行②/§13.33 | 指名复用 `storage-write-failed{stage:'current'}`（形状/errno 零新增）；复合效应（重启期 generation 增殖直至愈合 / 恶化为 ambiguous disabled）确定性机制+有界性+运维告警面记档；红灯锚 33 |
| **SA2 #5（LOW）exhausted 无成因字段** | ✅ 记档 | §7 LOW-1 段 | 受只增不改约束；两路径处置相同、成因机械可判——观测粒度限制，非功能缺口 |
| **SA2 #6（LOW）17 键对旧 reader 前向断裂** | ✅ 记档 | §9.1 LOW-2 段/§14 LOW-2 行 | 包外零 reader + co-deploy + README「reader 先于 writer」升级顺序 |
| **SA2 #7（LOW）C1 全截断退化变体锚** | ✅ | §13.7 R1 变体 | `J` 全文无 `0x0A` → 截 0 字节 + `lastCommittedSequence=null` + 续写首条 sequence='1' |
| **N1（MINOR·定稿随附）H 逆命题豁免行** | ✅ | §4.3 N1 豁免行 | SegMax bin 不可读且无引用（闭段 bin stat 失败且无引用同族）→ analysis 保守 rotate(corrupt) 而 reader 惰性判 ok（`reader.ts:436-438`）；钉死 `rotate(corrupt 类) ⇏ 必 reader 非 ok`——分析证「可续写性」严于 reader 证「可解释性」（resume ⇒ ok 恒真、ok ⇏ resume）；该行为 SA4 复核 H 的验收依据（豁免族之外一律判违反 H） |
| **N2（LOW·定稿随附）运维指引可执行化** | ✅ | §14 R1 风险行① N2 段/§16 README ① | 删除不可执行的「重启前手工处置 orphan 尾」；改为时间窗处置：definitive `storage-write-failed{stage:'jsonl'}` 后、后续 sidecar append 提交前尽快重启 → 此刻 orphan 仍在 §5.4 尾部，C3 自动截断、健康续写（§13.9 链路；期间 inline append 不破坏窗口）；已链中则不可手工处置、重启 corrupt rotate |

---

## §16. 文件清单（File Scope）

### ALLOW LIST

- `packages/namespace-diagnostic-log/src/adapters/file.ts` — 修改：locator 解析、reopen 编排与修复应用、segment 滚动状态机、双耗尽、三配置项、17 键 manifest、事件接线（约 +260 行净值，§3/§5.5/§6/§7/§8）。
- `packages/namespace-diagnostic-log/src/reader.ts` — 修改：manifest 双形状门、`line-unterminated`/`manifest-roll-target-violation` 两码、内部 `analyzeStreamForResume`（与 readStreamStrict 共享扫描核心；后者行为零变化）（约 +240 行，§4/§9）。
- `packages/namespace-diagnostic-log/src/paths.ts` — 修改：新增 `segmentFilePaths` 导出（纯增量 ~8 行，§6.1）。
- `packages/namespace-diagnostic-log/src/health.ts` — 修改：+2 事件成员、stream-init-failed reason +2 值（只增，~25 行，§10）。
- `packages/namespace-diagnostic-log/test/file-adapter-reopen-roll-repair.test.ts` — `[SA6 owned]` 新建：§13 全部锚点的主红灯文件。
- `packages/namespace-diagnostic-log/test/file-adapter-layout.test.ts` — `[SA6 owned]` 修改：manifest 17 键断言（§11.3）。
- `packages/namespace-diagnostic-log/test/file-adapter-mismatch-interference.test.ts` — `[SA6 owned]` 修改：resume 分支事件迁移 + rotate 语义断言（§11.3）。
- `packages/namespace-diagnostic-log/test/file-adapter-strict-reader.test.ts` — `[SA6 owned]` 修改：新码/双形状用例（§9/§13.30）。
- `packages/namespace-diagnostic-log/test/helpers/file.ts` — `[SA6 owned]` 修改：validManifest 加三 target 默认、writeStreamFixture 支持 current.json 与多 segment 夹具。
- `packages/namespace-diagnostic-log/test/file-adapter-r2-policy-continuity.test.ts` — `[SA6 owned]` 修改（如受影响）：preset 语义文档化后的回归微调。
- `packages/namespace-diagnostic-log/test/file-adapter-r2-supplemental.test.ts` — `[SA6 owned]` 修改（如受影响）：manifest 键集相关断言微调。
- `packages/namespace-diagnostic-log/test/file-adapter-sa7-dynamic.test.ts` — `[SA6 owned]` 修改（如受影响）：D-A1 终态补「reopen 后健康续写」正例锚（§13.17 后半）。
- `packages/namespace-diagnostic-log/README.md` — 修改：reopen/滚动/修复/耗尽/新配置/新事件/write-slot 构造期条件/「不做自动修复」表述更新（~40 行）；**R1 追加（SA2 #1a/#4b/#6 记档义务）**：①「writer 自产链中 orphan」运维面专段（触发机制、每次重启必然 rotate 的后果、`storage-write-failed{stage:'jsonl'}` 制造瞬间信号与 **N2 可执行处置**：该事件后、后续 sidecar append 提交前尽快重启 → C3 自动修复尾部 orphan 健康续写；链中 orphan 不可手工处置）；② current.json 愈合失败复合效应（`storage-write-failed{stage:'current'}` 持续出现 = 未愈合窗口告警）；③「reader 先于 writer 部署」升级顺序一句。
- `packages/namespace-diagnostic-log/AGENTS.md` — 修改：健康事件字段白名单 +repair/truncatedBytes/cause；write-slot 纪律覆盖构造期一句；17 键 manifest 备案（~8 行）。
- `packages/namespace-diagnostic-log/package.json` — 修改：版本 0.1.2 → 0.1.3（硬门禁 9）。

### DENY LIST

- `packages/namespace-diagnostic-log/src/record.ts` / `src/schema.ts` / `src/vocabulary.ts` / `src/pipeline.ts` / `src/emission.ts` / `src/sink.ts` — #148 冻结面（record 联合/schema 文本与指纹/词表/管线），本票零改动。
- `packages/namespace-diagnostic-log/src/adapters/memory.ts` — memory adapter 不属 File reopen/滚动面；UINT64_MAX/nextDecimal 复用不修改。
- `packages/namespace-diagnostic-log/src/frame.ts` / `src/storage-gate.ts` / `src/carrier.ts` / `src/crc32c.ts` / `src/canonical-json.ts` / `src/digest.ts` / `src/schema-patterns.ts` — 编解码/校验原语稳定；P_SEGMENT 8 位文法已满足滚动需求。
- `packages/namespace-diagnostic-log/src/index.ts` — 无新公共导出（新事件成员经既有 `DiagnosticLogHealthEvent` 类型自动可见；分析函数保持包内）。
- `packages/namespace-diagnostic-log/src/testing.ts` — 无新测试接缝（preset/inject 语义仅文档化收窄）。
- `docs/adr/**` — ADR 冻结源；本票按冲突点 #1/#2 裁决在既有条文空间内实施，无需 ADR 修订。
- `packages/namespace-runtime/**`、`packages/namespace-registry/**`、其余 `packages/**`、`apps/**`、`domains/**` — 接线归 #149–#151/#155；本票不触包外。
- `CONTEXT.md` — 无新术语（locator/segment group/orphan frame/exhausted 均为 ADR-0012 既有词条）。

---

## §17. 协议假设依据 (Protocol Assumption Evidence)

| 假设 | 依据类型 | 依据内容（具体引用） | 风险等级 |
|---|---|---|---|
| `appendFileSync(path, data)` 在文件缺失时创建（O_APPEND\|O_CREAT\|O_WRONLY） | 源码引用 + 现有测试 | #152 `file.ts:559/573` 以此实现惰性创建；`file-adapter-layout.test.ts:190`「.bin 惰性创建」用例锚定该行为 | 低 |
| `truncateSync(path, len)` 将文件收缩至 len 字节；截断中途中电只可能留下旧/新长度之一，不产生撕裂中间态 | 官方文档引用 + POSIX 语义 | Node docs `fs.truncateSync`（ftruncate 语义：size 更新为 len）；POSIX `ftruncate` 对收缩为元数据长度更新。与 #152 `writeCurrent` 依赖的 temp+rename 原子性同级保守 | 低 |
| `readdirSync(streamsDir)` throw（目录缺失）可按零候选处理 | 源码引用 | `reader.ts:397-409` 对 segmentsDir 同款 throw→corrupt 收敛先例；构造协议保证 streams/ 由 mkdir recursive 建立 | 低 |
| 8 位定宽十进制名字典序 = 数值序（segment 排序确定性） | 源码引用 | `reader.ts:418` 注释「8 位定宽十进制 → 字典序 = 数值序」（现行实现已依赖） | 低 |
| streamId 定长 32hex 字典序全序（恢复候选排序确定性） | 源码引用 | `schema-patterns.ts:13` `P_STREAM_ID='^log-[0-9a-f]{32}$'`（定长小写 hex） | 低 |
| 单进程独占根目录下无并发写者（reopen 派生状态的唯一 writer 前提） | ADR 摘录 | 相关决议 B 节「File adapter沿用单进程独占根目录的部署约束，不实现跨进程锁」 | 中（部署纪律，非代码可证） |
| reopen 扫描可在构造期同步完成且 Host 在 slot 外构造 | ADR 摘录 + 冲突点 #3 钉死 | amendment 接线纪律经 SA8 扩展覆盖 reopen 检查与尾部修复的一切同步文件操作 | 中（接线票验收项） |
| 无 HTTP/WS/端口/跨进程生命周期类协议假设 | — | 本票仅涉及 node:fs 同步原语（既有绑定面内：`adapters/file.ts`+`reader.ts`，AGENTS.md 声明） | — |

---

## §18. 契约改动连锁审计 (Contract Change Caller Audit)

本票**无**「return→throw / 同步变 async / catch 改 rethrow / nullable 变 non-null」类契约改动；全部为**加性类型扩展 + 构造期行为升级**。逐项审计：

### 改动函数/类型

| 对象 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `createFileDiagnosticLog` | `src/adapters/file.ts:797` | 同步构造，恒新建 generation，绝不抛 | 同步构造，绝不抛；既有健康 stream 上改为续写（§8），rotate/disable 终态见 §3.2/§4.4 |
| `FileDiagnosticLogConfig` | `src/adapters/file.ts:46` | 12 可选键 | +3 可选键（roll targets；§6.2 校验规则） |
| `readStreamStrict` | `src/reader.ts:303` | 同步、绝不抛、三态 status | 签名/同步性/绝不抛不变；manifest 门接受双形状、+2 issue 码（§9） |
| `DiagnosticLogHealthEvent` | `src/health.ts:22` | 12 成员联合 | +2 成员、`stream-init-failed.reason` +2 值（§10）——消费方按 type 判别，旧消费者不受新成员影响（穷尽 switch 若存在需补 default，包内无此消费模式） |
| `streamLayoutPaths` | `src/paths.ts:47` | 返回含 jsonlPath/binPath（segment 1 别名） | 形状不变；新增独立导出 `segmentFilePaths`（加性） |

### Caller 清单（`git grep` 实证，2026-05 基线 8611e68；包外零 caller——接线未发生）

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| 公共工厂 `createFileDiagnosticLog` | `src/index.ts:71`（re-export） | 否（同步） | — | 构造函数自带构造级 crash 包络（`file.ts:780-784`）→ 任何新扫描/修复异常收敛 `failed`+`pipeline-crashed`，不外抛 | 无需 caller 改动 |
| 测试工厂 `makeFileLog` | `test/helpers/file.ts:128` | 否 | 否（依赖不抛契约） | 同上 | SA6 按 §11.3 更新断言 |
| preset 工厂 | `src/testing.ts:108-118` → `createFileLog` | 否 | 入参 loud 校验（现状保留） | 同上 | 语义文档化（fresh-only），签名零改动 |
| `readStreamStrict` 包内调用 | `src/adapters/file.ts`（新：经共享核心间接，不直接调用） | 否 | — | reader 自带全函数兜底（`reader.ts:583-593`） | 分析函数同款兜底收敛 rotate |
| `readStreamStrict` 测试调用 | `test/file-adapter-{strict-reader,r2-supplemental,r2-policy-continuity,mismatch-interference,sa7-dynamic}.test.ts`（grep 计 100+ 处） | 否 | 否（依赖不抛契约） | — | 既有断言零破坏（§11.3 实证：新码不触既有夹具）；新用例属 SA6 新增 |
| `streamLayoutPaths` | `src/adapters/file.ts:685`、`src/reader.ts:317`、`test/helpers/file.ts:78` | 否 | — | — | 形状不变零改动；writer 滚动路径改用 `segmentFilePaths` |
| observer 消费 | `src/health.ts:108-123` safeNotify + 测试收集器 | 否（同步回调） | safeNotify 隔离（现状） | fallbackLog 最后防线（现状） | 新成员走同一隔离管线（§10.3） |

### 风险评估

- 遗漏 caller 的代价：包外零 caller（grep 实证），最大风险是包内测试断言漂移——§11.3 列全受影响文件并全部进 ALLOW LIST。
- 抓全 caller 的方法已执行：`git grep -n "readStreamStrict\|createFileDiagnosticLog\|streamLayoutPaths" -- 'packages/**/*.ts' 'apps/**/*.ts' 'domains/**/*.ts'`（排除 src 自身与 node_modules）→ 输出仅本包 test/ 与 helpers。
