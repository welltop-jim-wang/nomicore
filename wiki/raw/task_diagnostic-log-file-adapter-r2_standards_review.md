# 工程终审 Standards 轴报告 — File diagnostic-log adapter R2（issue #152 round=2）

**日期**：2026-08-29
**审查范围**：`git diff fde8034..HEAD`（HEAD=`f52eccb`，10 文件 +1498/−134）
**权威契约**：`task_diagnostic-log-file-adapter-r2_design.md`（SA1 R3 定稿）+ dispatch 第 12 行 G18 / 第 14 行 R2-G19/G20/G21（同等约束力）+ `task_diagnostic-log-file-adapter-r2_sa6_red.md` 红灯契约 + ADR 0011/0012 + CONTEXT.md
**审查方式**：基准文档通读 → 逐行 diff 审查 → 独立取证（只读命令 + 自建对抗探针 + 后台独立进程复跑，日志落 `.mabf-bg/standards-*.log`）。本轴无其它评审者上下文，全部结论独立取证得出。

---

## Verdict: pass-with-issues

零 reject 级发现；MINOR 1 项（注释失实，非阻断）、INFO 5 项。实现与设计定稿 + 总控四裁决逐条一致；工程纪律、错误处理、测试质量三面均经得起独立对抗取证。

---

## 一、发现清单（按严重度）

### REJECT 级（阻断发布必须修复）

无。

### MINOR

**M-1 `reader.ts:37` 接口注释「23 码封闭词表」失实（注释真实性，非阻断）**
`packages/namespace-diagnostic-log/src/reader.ts:37`：`/** 单条 stream/record issue（23 码封闭词表；segment/sequence/offset 归因）。 */`——本轮 reader 域新增六码（§2.6），封闭集合规模已非 23；同文件头注（reader.ts:1-16）已正确改写为「reader 稳定码词表 + R2 新增六码」，但这处接口级注释漏改，文件内部自相矛盾。同类残留：`storage-gate.ts:30`「reader 23 码词表」与 `file.ts:486`「复用 reader 23 码既有的 vfsl-invalid」均为本轮未触碰的既有上下文行（storage-gate.ts 不在 ALLOW LIST；file.ts:486 为 diff 上下文未改行），可一并留待后续文档轮清扫。reader.ts 在 ALLOW LIST 且本轮大改，头注已改而接口注释漏改，属本轮应带走的一致性尾巴。不阻断发布（码表行为正确、头注正确、测试锚定真实码），建议收尾轮或下一文档轮修订。

### INFO

**I-1 README「emit 返回 = 字节已入文件」未限定成功路径**（README.md:92）。R2 起 ambiguous outcome 下 emit 返回但字节未必落盘——同节下方新增的「R2 提交点纪律」bullet（README.md:103-106）已如实写明「sequence N may not be persisted」语义，头句沿袭 round-1 未加限定。同节内已有正确语义，属表述精度问题，非矛盾误导。

**I-2 CONTEXT.md:118「语义 emission」词条「emit 同步、不 throw、不阻塞」未动**——该词条定义的是 producer→emitter 语义 seam（ADR 0011 面），ADR-0012 amendment 以 write-slot 外接线 MUST 保持该 seam 契约；File adapter 级的阻塞现实已在 ADR 0012/README/AGENTS.md 三处如实成文。简报对 CONTEXT.md 的措辞为「如需」，维持不动可辩护；备案供中心知悉。

**I-3 SA7 域测试文件 `file-adapter-sa7-dynamic.test.ts`（9 用例）在审查时点为 untracked**——不在本轮 diff 范围（`fde8034..HEAD`）内；本轴的包测试复跑（20 文件/314 测试）含该文件。收尾固化 commit 必须将其与 wiki/REPORT 一并纳入，否则 PR 缺 9 条 AC 关联活链路锚（D-A1/D-B1/D-B2/D-C1–C6）。流程提示，非代码缺陷。

**I-4 `sequence-out-of-order` 本轮顺带补齐 segment/offset/sequence 归因字段**（reader.ts:552）。round-1 该码无归因；StrictReadIssue 三字段均 optional，属 reader 私有诊断面的加性扩展，与 G20「与兄弟码一致」同方向，非冻结面改动。行为变化仅在诊断信息丰富度，无兼容性风险。

**I-5 设计 §3.4 伪代码 `continue` 单元格与其自身行内注释及 §3.4 末段正文自相矛盾**（详见 §四.1 独立判定）。实现从正文+锚，正确；建议 SA1 后续触碰该设计文档时给伪代码加勘误注，避免未来轮次按字面返工。

---

## 二、审查面 1：实现 vs 设计定稿 + 总控裁决（逐条）

### §2.1 读取前提与原始字节行定义 —— ✅
`splitRawLines`（reader.ts:233-247）按 0x0A 字节扫描、`byteLength` 排除单个 `\n`、逐行子串 `TextDecoder` 解码（避免 whole-buffer 字节索引切串错位）；行长检查先于 `JSON.parse`（reader.ts:473-476），超限且不可解析行同 record 携带 `manifest-line-limit-exceeded` + `invalid-json`（独立探针 P11a/b 字节精度双边实证：==上限 ok、上限−1 违规、JS 字符数<字节数前提成立）；空文件零行、末尾残尾照常一行（P7）、中间空行 `invalid-json`（P3）——与 §2.1 逐句相符。policy 仅在 manifest 严格门通过后提取（reader.ts:382-393 `extractFormatPolicy` 防御性复核，null 兜底不可达）。

### §2.2 committedUpdateCapture —— ✅
reader.ts:514-517：`!committedUpdateCapture && carrier !== null && kind !== 'genesis-baseline'` → `manifest-update-capture-violation`；`carrierFromParsed`（reader.ts:188-202）对 genesis 返回 `update`、attempt 仅在 `result.effect === 'update'` 时返回 carrier（fatal committed:true/effect:update 计入——SA6 锚 1 第二例锚定；fatal committed:false 无 effect 字段不可达）。capture=true 不反向强迫（无代码路径）。genesis 正交豁免经探针 P10（capture=false + genesis sidecar 4097B → ok）独立实证。

### §2.3 inputCapturePolicy + R2-G19 —— ✅
`inputPolicyViolation`（reader.ts:250-272）仅在 attempt 上运行（reader.ts:518-523）。逐路径核对：digest±marker × 四 policy 双向规则、`{capture:'none'}` 全 policy 恒合法（G19）、none policy 下 not-accessed/unavailable/unsafe-input 仍违规（探针 P13 实证）、marker 拼写错误防御镜像（VFSL 先拒路径由 SA6 锚实证保持 `vfsl-invalid`）、非 digest 偷带 degraded 防御镜像（冻结 union 不可达）。违规阶梯五组合经测试锚 + 探针 P14a/b 双向实证。

### §2.4 inlineUpdateMaxBytes 双向阈值 —— ✅
reader.ts:530-538：storage 本体校验（`validateInlineCarrier` / `checkSidecar`）成功后才运行阈值政策（else-if 短路，不可信 payloadLength 不参与）；inline `N > 阈值` / sidecar `N ≤ 阈值` 双向两码；genesis carrier 同测（SA6 锚 4）。探针 Q1（阈值 0 + 1B inline → 违规）、Q2（0B inline 仅报既有冻结面 `base64-invalid`，阈值码不叠加——本体校验先行短路实证）、Q3（负阈值忠实执行）独立确认边界语义。writer 侧 `projectCarrier`（file.ts:296 `<= inlineUpdateMaxBytes → inline`）与 reader 恰互补，同一 config 值喂 `buildManifest`（file.ts:150-176）与投影——writer 自产记录不可能违反自身 manifest。

### §2.5 jsonlLineLimitBytes —— ✅
原始 UTF-8 字节计量（非 JS code unit、非序列化后长度）；超限行不跳过、不隐藏后续证据（SA6 锚 5 双码例 + P11）。writer 行预算门 `measure = utf8Length(JSON.stringify(record))`（file.ts:110-112，不含 `\n`）与 reader 计量定义同源一致。

### §2.6 码表与 #148 边界 —— ✅
六新码逐字落实（reader.ts:512-537、555；五 record 码 + stream 级 `sequence-gap`）；无族 A `policy-*` / `sequence-start-invalid`（G18 (a)）；六码均不入 `INCOMPATIBLE_SET`（成员集 diff 零改动，仅注释更新）；`corrupt` 映射下 records 逐条保留（P1/P9 等实证）；record.ts/schema.ts/vocabulary.ts/health.ts 零触碰（见 §三）。

### §3.4 连续性状态机（含 anchor 收窄） —— ✅
reader.ts:542-559：`expectedSequence: bigint|null = 1n` 起点固定 1；跨 segment 不重置（segment 8 位定宽排序 = 数值序，reader.ts:418）；anchor 最小前提 = JSON parse + VFSL/canonical decimal + streamId 交叉三项，policy/storage 诊断不取消锚定（ok=false 仍参与）；`actual < expected` → `sequence-out-of-order` 且不推进 expected（倒序后续不产生二次噪音，探针 P8/P12 实证）；`actual > expected` → `sequence-gap` 归因发现缺口的物理 record（G20，reader.ts:553-556；探针 P4b 跨 segment 归因 seg2/offset0/seq4 实证）；身份不可解释行（坏 JSON/VFSL/streamId）置未知基线 `null`、不拼接精确缺口（P1/P2/P3 实证无 gap 且无 false-ok——不可锚定行必携自身 corrupt issue）。EOF 不额外报错（P7 间接）。`[2]`/`[1,3]` 统一 `sequence-gap`（G18 (a)）。

### §3.2 双阶段提交点 + §3.2.1 definitive/ambiguous —— ✅
`candidateSequence()` 无副作用纯读（file.ts:248-250）；`prepareRecord`（file.ts:434-503）line 预算→VFSL→P_DECIMAL 镜像→storage 门全在 candidate 前，失败 notify/drop 零消耗；`commitPrepared`（file.ts:594-601）提交点物化 candidate 进 JSONL record 与（若 sidecar）frame（`encodeFrame(record.sequence,…)` 同源）；preview 与提交点之间无状态写入路径，恒一致。`classifyAppendFailure`（file.ts:510-513）errno 封闭集 {EISDIR, EACCES, ENOENT} = definitive，其余一律 ambiguous（`errnoOf` 无 code → 'EUNKNOWN' → ambiguous，file.ts:124-127——「未知 throw 默认 ambiguous」落实）；BIN-first 顺序不变；definitive BIN failure 后 fresh stat 重算 offset（`planFrameOffset` file.ts:289-292 无缓存）；ambiguous → `commitAmbiguous`（file.ts:268-280）reservation + `sealed` + `mode='failed'` + 冻结形状 `storage-write-failed` 事件 + fallbackLog「sequence N may not be persisted…old generation sealed, no in-place retry」（G21 逐字）。探针 W1（首发 emit ambiguous → 密封零新增、无 exhausted）、W2（genesis 后 ambiguous → 密封持久、reader 对残留前缀诚实 ok）、W3（EISDIR definitive → 同 candidate 复用 → [1,2] 连续 → reader ok）独立端到端实证。

### §3.3 genesis / exhausted / 注入 —— ✅
`runGenesis`（file.ts:655-681）守卫（0 字节/超 payloadMax/offsetFailed）与全部门在 candidate 前；confirmed success 提交 '1'；append 失败与 attempt 同一分类。`commitConfirmed`（file.ts:253-259）仅 confirmed JSONL success 推进，`=== UINT64_MAX` 恰一次 `stream-exhausted`；ambiguous max 不触 latch 只密封（SA6 锚 11 三变体）；`presetLastSequence` 公共工厂 loud 校验 `< UINT64_MAX`（testing.ts:104-117，round-1 R2-1 既有），candidate 超域不可达（max 确认后门闩封闭 / max ambiguous 后密封——双路径均堵死）。`injectFinalRecordFile`（appendFinal file.ts:633-648）不分配不推进、ambiguous 保守密封（写入 inert——mode-gate 拦截后续 emit）。构造期 genesis ambiguous 密封经 `sealed` 标记防 `mode='ready'` 覆盖（file.ts:775-776）——公开面不可构造该交错，代码阅读确认正确。

### §3.5 文案 —— ✅
README.md:127-131 strict `ok` 语义边界为设计 §3.5 指定文案逐字（「在本次静态读取中，已解析的该 stream v1 物理 records 自 sequence 1 连续，且通过 manifest/storage/frame 校验」），并附 `[1,3]` → `sequence-gap/corrupt` 实例；无「业务完整/可恢复」过度声明。replay 实现不在本包（#155 范围），README 已前置声明该限定同适用于 replay 成功文案。

### ADR amendment §4.1–4.3 落实 —— ✅
ADR 0012 diff（+15 行）实核：dated amendment（L244-252）位于「默认周期 batch flush…」段之后、「### Segment rolling 与耗尽」之前（设计 §4.2 指定编辑点）；被取代两句（L218/L242）原文存在且逐字引用；「被以下条款取代」（非并列）；首段同步范围（≤1 JSONL 行 + BIN-first ≤1 帧、无 queue/batch/fsync 开关/常驻 fd、不构成掉电承诺）；「有界」定义（数据量/操作数，非延迟上界、非任意调用点不阻塞）；**write-slot 外 MUST** + 不合规接线由 #149–#151/#155 修复后方可启用 + void/non-throwing/no-durability-promise；演进路径段（seam/schema/policy/slot 隔离不变前提下可替换，须另行定义 close/flush/队列满/fsync）；被否方案新增 4 条逐条对应设计 §4.3；后果段「首切片取舍」权衡成文。增补句「retention、queue 容量、batch/flush 策略、fd cache 与 metrics sampling 可动态调整的既有条款对首切片继续成立」与 ADR L268 既有条款相呼应，保护既有可调条款不被取代关系误伤——与设计精神一致（SA4 备注①同判）。ADR 状态头保留 accepted；**ADR 0011 正文零改动**（diff --name-only 0 文件）；amendment 的 write-slot MUST 与 ADR 0011 L129「adapter 慢、失败或队列满都不得延长 write slot」契约一致。

### 总控裁决 —— ✅
- **G18 (a)-(d)**：六码/起点固定 1n/提交点分配+definitive-ambiguous 二分/genesis 正交/EISDIR 锚语义中立——全部落实（mismatch-interference 11 用例复跑绿，见 §六）。
- **R2-G19**：`{capture:'none'}` 恒合法（reader.ts:266-271 非 digest 分支 `policy === 'none' → capture !== 'none'`；none 下三种不可得形态仍违规）——代码+探针 P13/P14 实证。
- **R2-G20**：`sequence-gap` 归因 = 发现缺口的物理 record 的 segment/offset/sequence（reader.ts:553-556；兄弟码 `sequence-out-of-order` 同构补齐，I-4）；测试三向钉死 + 探针 P4b 实证。
- **R2-G21**：证据通道 = fallbackLog 行；事件保持冻结形状零新字段（file.ts:272-279；health.ts 不在 diff）；「may not be persisted」不断言缺失（探针 W1/W2 实证文案含 candidate 序号与密封说明）。

## 三、审查面 2：工程纪律 —— 全部 ✅

- **DENY LIST 零触碰**（独立实证）：`git diff fde8034..HEAD --name-only` 全量 10 文件；对 `record.ts / schema.ts / vocabulary.ts / pipeline.ts / adapters/memory.ts / docs/adr/0011-*.md / packages/namespace-runtime/** / packages/vfsl/**` 逐项过滤 → **零命中**。
- **版本 bump**：package.json `0.1.1 → 0.1.2` 单行（硬门禁 9；ALLOW 外文件但系总控明令，dispatch 第 15 行）。
- **ALLOW 外文件三处均合规**：package.json（硬门禁 9）、test/helpers/file.ts（dispatch 13 授权 SA6 域；diff 核验仅 `committedUpdateCapture: false→true` 单值 + 注释）、r2-supplemental（dispatch 13 授权的 2 处预置接缝断言回改 + SA3 备案② R-1a 夹具一致化——见 §四.2）。
- **冻结面零改动实证**：schema.ts（VFSL 文本/指纹）不在 diff；vocabulary.ts（emission 词表）不在 diff；health.ts（`storage-write-failed` 等事件字段形状）不在 diff；`commitAmbiguous` 事件构造仅用既有 `{type, stage, code, operation?}` 字段（file.ts:272-276 对 health.ts:75-81 形状逐字相符）。
- **无静默 catch**（diff 全量扫描）：reader 三处 catch（readBinOrNull→null 既有、segment ENOENT 零行/其他→invalid-json、JSON.parse→invalid-json）全为如实判坏；file.ts 新增 catch 均经 `classifyAppendFailure` 分类 → notify +（ambiguous 时）fallbackLog；顶层 catch → `pipeline-crashed` 包络不变；`writeCurrent` 的清理吞异常为 round-1 既有且有注释说明合法性（file.ts:726-733）。
- **无屏蔽测试**：diff 全文 grep `it.skip/describe.skip/it.only/test.skip/.todo` → 零命中。
- **无欺骗性注释**：除 M-1 的失实残留外，抽查的新增注释（splitRawLines 字节语义、commitAmbiguous 封闭语义、genesis preview 注释、sealed 防覆盖注释）与代码行为逐句相符。`git diff --check fde8034..HEAD` 干净。

## 四、审查面 4：SA3 备案三点 + SA4 观察 O-1..3 独立判定

### 1. SA3 备案①（§3.4 伪代码 `continue` vs 正文「不拼接精确缺口」）——**独立判定：实现取舍正确**
伪代码 `if !anchorable: …continue`（expected 不变）会使其后首条可信记录 `actual > expected` 报精确 gap——与该伪代码自带行内注释「do not infer a numerical gap」及 §3.4 末段「不把可见的下一条与其前一条拼接出精确缺口」直接冲突（坏行真实 sequence 不可知，可能恰为被「报缺」的那条）。正文 + SA6 已绿返回锚（三变体断言**无** gap）+ SA8 hard-violation #1 回归锚三方一致。实现置 `expectedSequence = null`、其后首条可信记录以 `actual+1n` 重建基线。**无 false-ok 路径**：任何不可锚定行必携自身 corrupt issue（invalid-json/vfsl-invalid/stream-mismatch），stream 永不 ok；物理删除本身仍由相邻可信序号差异发现（[1,3] → gap）。本轴探针 P1/P2/P3 独立实证该行为。结论：无需返工；I-5 建议后续文档轮给伪代码加勘误注。

### 2. SA3 备案②（R-1a 夹具政策一致化）——**独立判定：成立**
r2-supplemental R-1a 原断言集（status corrupt / records[0].ok / records[1].ok=false / vfsl-invalid）逐字未动；100B sidecar 在默认 4096 阈值下按 §2.4 必叠加 `manifest-sidecar-threshold-violation` 击穿「首帧照常 ok」隔离断言；manifest 覆盖 `inlineUpdateMaxBytes: 64`（同文件 EISDIR/truncate 用例既有先例）恢复政策正例，锚定的 frameOffset 前导零镜像语义不变。与 SA6 获授权的「4097B ×2」属同一冲突类同一处置模式；SA6 域文件 + 总控接受 + SA4 复核，流程闭环。

### 3. SA3 备案③（definitive errno 封闭集）——**独立判定：严格成立，残余有界**
封闭集 {EISDIR, EACCES, ENOENT} 恰为设计 §3.2.1 列举的三类 open 期零字节可证明失败；`errnoOf` 无 code → ambiguous。POSIX 层：`appendFileSync` = open(O_WRONLY|O_APPEND)+write+close；三码为 open(2) 期错误，write(2) 错误集（ENOSPC/EIO/EFBIG/…）与之不相交；write 期 ENOSPC 归 ambiguous 有 /dev/full 真实注入锚（SA6 锚 7）。唯一危险方向（ambiguous→definitive 误判 → candidate 复用）的理论残余（exotic fs write 期 EACCES）后果有界：最坏部分行/重复 sequence → reader 以 invalid-json/sequence-out-of-order **响亮**判坏，非静默错乱；SA7 D1 已在本 runner ext4 上实证 write 期 EACCES 不可达（open 后 chmod 000 仍写成功——DAC 检查在 open(2) 完成）+ D-C6 补锚后果有界性。接受。

### 4. SA4 §6 观察 O-1..3 ——**独立判定：三项均确属非阻塞**
- **O-1**（密封/耗尽后 emit 静默丢弃无 per-drop 事件）：emission 词表冻结（DENY）无 drop 码可发；mode-gate 静默为 round-1 既有契约；密封时刻已有 `storage-write-failed` + fallbackLog 行各一次（非无声进入密封）。契约正确。
- **O-2**（P_DECIMAL 正则不机械封 uint64 值域）：探针 P6 实证超域十进制串被判 corrupt（gap 方向）——诚实、无 false-ok；false-ok 需物理构造 2^64 条连续记录，不可达。封闭归 schema 演进票（#148 冻结，本票禁改）。
- **O-3**（SA3 于 SA6 域文件的一处夹具改动）：见 §四.2——同批先例、备案、总控接受、SA4 确认，流程闭环。

## 五、审查面 3：代码质量 —— ✅

- **错误处理链路**：reader 全函数 try/catch 兜底不抛（reader.ts:583-593，异常收敛 corrupt + manifest-invalid 码——诊断工具不在损坏状态下自崩）；emit 保持 void/non-throwing；append 失败分类 → 事件 + fallbackLog 双通道；gate drop → record-dropped/storage-validation-failed/vfsl-validation-failed 既有冻结码；构造级 crash → pipeline-crashed 恰一次。状态闭环：sealed/mode/exhaustedLatch 三态互斥覆盖全部后续 emit 路径（W1/W2 探针实证密封持久）。
- **降级路径**：无新增降级；§2.3 digest+degraded marker 是 #148 冻结降级面（file.ts:443-452 line 预算降级）的执行而非新降级；无虚假降级（writer 只在真实超预算时写 marker，真实 writer 产物正例锚防漂移——SA6 锚 3 双形态绿）。
- **边界条件**：UINT64_MAX 三变体（confirmed 恰一次 exhausted / definitive 不发 / ambiguous 不发且密封）有锚；阈值 0 双向（Q1/Q2）；负阈值忠实执行（Q3）；空行（P3）；残尾无换行（P7）；多 segment 连续与 gap（P4）；超 uint64 值域串（P6）；重复/倒序/多重组合（P8/P12）。
- **并发/半行声明一致性**：README 并发读写语义段（静态 stream 契约、半行误判 invalid-json 声明）逐字保留未回退；R2 行长检查以文件当前字节为准与该声明一致。
- **命名与注释真实性**：`lastCommittedSequence`/`candidateSequence`/`commitConfirmed`/`commitAmbiguous`/`sealed` 名实相符；头注全部同步改写（reader.ts:1-16、file.ts:1-22）。唯一例外 = M-1（接口注释漏改）。

## 六、审查面 5：测试质量 —— ✅

- **锚定真实（非自我实现的预言）**：全部断言针对运行时产物（磁盘字节、reader 返回、observer 事件、fallbackLog 行）；零 mock 桩、零源码文本 grep 断言（SA4 §1.7 同判，本轴抽查 42 处 toContain 均为行为断言）；`assertIsolatedR2Issue` 用 `toEqual([expectedCode])` **恰一码**隔离断言，防绿灯噪音；红灯→绿色链完整（sa3-baseline-red.log `29 failed | 276 passed` EXIT=1 与 sa6-full-run.log 逐字一致，sa3-full-run.log 305/305 EXIT=0）。
- **失败注入全部真实运行时行为**：目录占位 open 期 EISDIR、segments 删除 ENOENT、/dev/full 符号链接 write 期 ENOSPC、帧字节翻转 CRC 损坏——无自定义 seam 依赖（SA6 明示，本轴核实 policy-continuity 全文无 mock）。
- **控制组充分**：每个敌意锚均有正例配对——genesis update / update-omitted 合法豁免、4096 inline / 4097 sidecar 正例、==上限行正例、跨 segment 连续正例、#9 健康 stream（capture=false + genesis(1,update) + attempt(2,noop) → ok 零 issue）、真实 writer 降级产物双形态正例、D-B2 混合合法终态（committed inline/sidecar + fatal-committed + noop + fatal-rejected）零误判。
- **无欺骗性绿灯**：多字节行超限锚以「JS 字符数==上限 < 字节数」构造（字符计量实现会假绿、字节计量才真判）——本轴 P11 以 ±1 字节精度独立复证；存量回改（supplemental 两处 ok→corrupt+gap）方向为语义收紧而非放宽，断言仍含 record 级 ok=true 的双层钉死；族 A 380 行语义冲突文件未采信（G18），整体重写为族 B 13 用例。
- **唯一流程面提示**：SA7 域 9 用例文件 untracked（I-3），需随收尾 commit 入库。

## 七、本轴独立验证证据（全部后台独立进程/只读命令）

| 命令/探针 | 结果 | 证据 |
|---|---|---|
| `vitest run packages/namespace-diagnostic-log/test` | **20 文件 / 314 测试全绿，0 type errors，EXIT=0**（含 untracked SA7 文件） | `.mabf-bg/standards-pkg-run.log` |
| `pnpm test`（全仓 vitest run --typecheck） | **138 文件 / 1719 测试全绿，0 type errors，EXIT=0** | `.mabf-bg/standards-full-test.log` |
| `pnpm typecheck`（全仓 10 包，显式退出码复跑） | **TC-EXIT=0** | `.mabf-bg/standards-typecheck2.log` |
| `git diff --check fde8034..HEAD` | 干净 | 本报告 §三 |
| DENY LIST 过滤（diff --name-only） | 零命中 | 本报告 §三 |
| 基线对账（`git ls-tree`） | fde8034=136 测试文件 / HEAD=137（+1 = r2-policy-continuity；族 A 原版基线时为 untracked，dispatch 11c 记载一致）→ 与 SA7「136 文件/1664 测试基线、+46 测试」算术闭合（1664+33+13=1710，+SA7 9=1719） | 本报告 §七 |
| 对抗探针 P1–P14（reader 面 14 组 24 断言） | 全 PASS | `.mabf-bg/standards-probe.ts` 运行输出 |
| 对抗探针 Q1–Q3（阈值 0/负阈值边界） | 全 PASS | `.mabf-bg/standards-probe2.ts` 运行输出 |
| 对抗探针 W1–W3（writer 密封/证据/复用端到端 10 断言） | 全 PASS | `.mabf-bg/standards-probe3.ts` 运行输出 |
| SA3/SA6/SA7 证据链交叉核对 | sa3-baseline-red（29F/276P/EXIT=1）≡ sa6-full-run 逐字一致；sa3-full-run 305/305/EXIT=0；sa7-full-test2 138/1719 | `.mabf-bg/sa3-*.log` / `sa6-full-run.log` / `sa7-full-test2.log` |

---

**Verdict: pass-with-issues**（零 reject 级；MINOR ×1 = M-1 注释失实残留，INFO ×5 = I-1..I-5；全部非阻断，M-1 建议收尾轮或下一文档轮带走）

---

## R 轮复审（修复-重复规则；2026-08-29，复审对象 `fde8034..81a6863`）

**触发**：总控 R2-G22 裁 M-1 必修复（注释真实性 = 纪律面；三处「23 码」计数失实一并修）；SA3 回流 commit `81a6863`（3 文件 +3/−3）。
**delta 范围**：`f52eccb..81a6863` = reader.ts / storage-gate.ts / file.ts 各 1 行注释；全范围 `fde8034..81a6863` = 11 文件 +1501/−137（原审 10 文件 + storage-gate.ts——不在 DENY LIST，进 diff 有 G22 明文授权）。

### M-1 三处闭合核验 —— 全部 ✅

| 位置 | 新表述 | 闭合判定 |
|---|---|---|
| reader.ts:37 | 「reader 稳定码词表共 29 码——23 码 v1 基表 + R2 六码；见文件头注」 | ✅ 头注确列六码；计数实证（下） |
| storage-gate.ts:30 | 「reader 29 码词表中 storage/frame 交叉面——23 码 v1 基表 + R2 六码」 | ✅ StorageIssueCode 15 成员均为该词表子集且 reader 可达 |
| file.ts:486 | 「复用 reader 29 码词表既有的 vfsl-invalid」 | ✅ vfsl-invalid 属 v1 基表既有码 |

**「29 码」事实性独立实证**（防止以新失实换旧失实）：reader 域稳定码全集 = INCOMPATIBLE_SET 7 码 ∪ reader.ts 直接产出 12 码（invalid-json/locator-invalid/manifest-invalid/stream-mismatch/sequence-out-of-order/vfsl-invalid + R2 六码）∪ StorageIssueCode 15 码；去重（storage ∩ incompatible = 4、storage ∩ reader 直接 = 1）→ 7+12+15−4−1 = **29**；v1 基表 = 29−6 = **23**（与 fde8034 基线并集复算一致）。新注释计数精确成立。

### 无新问题引入 —— ✅

- **comment-only 实证**：`git diff f52eccb..81a6863` 全部变更行经非注释行扫描（剔除 `//`、`/* */` 行）→ **零非注释变更行**，零行为变更成立。
- **验证门槛复跑**（81a6863 工作区，后台独立进程）：包测试 **20 文件 / 314 测试全绿、0 type errors、EXIT=0**（`.mabf-bg/standards-r-pkg-run.log`）；`git diff --check fde8034..81a6863` 干净。
- **DENY LIST 复核**：全范围 11 文件对 record.ts/schema.ts/vocabulary.ts/pipeline.ts/adapters/memory.ts/ADR 0011/namespace-runtime/**/vfsl/** 逐项过滤 → 仍零命中。

### 原报告其余发现状态（经 R2-G22 裁决）

I-1（README 头句）/I-2（CONTEXT 词条）/I-4（out-of-order 归因补齐）/I-5（设计伪代码勘误）裁**备案不修复**（理由在案：同节已有如实限定 / amendment 背书 / 加性方向正确 / 留后续文档轮）；I-3（SA7 域测试文件 untracked）裁**由收尾 commit 闭合**——复审时点 git status 仍为 `??`，该项保持开放至收尾固化，为本轮唯一待闭合项（非代码缺陷）。

### R 轮更新后生效 Verdict

**Verdict: pass**（M-1 三处闭合且计数经独立实证；零新问题引入；残余 INFO×5 全部经 R2-G22 裁决备案或有明确收尾闭合路径——I-3 待收尾 commit 纳入 SA7 域测试文件后全链闭合）
