# Design: File diagnostic-log adapter R2 — manifest policy、连续 sequence 与 ADR-0012 修订（Issue #152）

> SA1 设计产出；任务类型：发布后规格修正（功能开发/缺陷修复混合）。
>
> 约束优先级：任务简报 R2 > SA8 `task_diagnostic-log-file-adapter-r2_conflict_report.md` 五条解除条件 > ADR-0012/0011/0008 > round=1 实现与设计。本文只设计，不改变 #148 冻结 schema、emission 词表或 ADR-0011 正文。

## §1. 根因、边界与不可变约束

### 1.1 三个根因

1. `reader.ts` 的 manifest gate 只检查四项冻结策略的类型和枚举合法性，逐 record 时只做 VFSL/storage/frame 校验，故无法拒绝**逻辑 schema 合法、但与本 stream manifest 不一致**的记录。
2. writer 在 gate、物理投影和实际 append 之前调用 `allocate()`，且 genesis 的空/超载守卫也会先分配。这使健康磁盘流可出现未被 JSONL 保存的合法编号空洞；reader 因而只能做递增检查，无法可靠地将 `[1,3]` 判为物理删除。
3. 当前首切片的同步 `appendFileSync` 与 ADR-0012 已接受文本中的「内部逻辑 writer queue + 默认周期 batch flush」冲突；仅在实现设计中说明不足以取代 ADR。必须在 ADR-0012 正文做明确、局部、规范性的修订，同时保留 ADR-0011 的上层 emitter 契约。

### 1.2 不得触碰的边界

- #148 冻结的 `record.ts` 联合、VFSL schema 文本/指纹、`update-omitted.reason` 三值词表、memory adapter 与 emitter 管线均不改。
- 本轮新增的 strict-reader issue 是**reader/file-adapter 私有诊断面**，不写入 record，不改变 VFSL enum，不改变 emission/health 受控词表。
- `replay` 仍强制 strict reader；即使 strict 返回 `ok`，只能称为「所选静态 stream 的已保存物理 records 连续且通过校验」，绝不可称为业务尝试完整、恢复安全、exactly-once 或无崩溃丢失。
- 不实现 queue、batch、fsync、rolling、resume-tail repair、retention 或 replay/Host 接线；本轮的 write-slot 规则只作为规范性接线条件和验收约束。

## §2. Strict reader：manifest 冻结策略的逐行执行

### 2.1 读取前提与字节定义

在 manifest 通过现有严格 gate 后，读取其四个冻结值为本次扫描的只读 `policy`。每条 `.jsonl` 物理行的长度以该行的**原始 UTF-8 字节数、排除行终止符 `\n`**计算；不得以 JS code unit、`JSON.stringify(parsed)` 长度或规范化后的对象替代。这样可以发现空白填充、原始超长但解析后等价的敌意行。

行顺序固定：

```text
for segment in lexical/numeric ascending order:
  read raw JSONL bytes/text
  split preserving each physical line and its trailing-newline metadata
  for each non-empty physical line at 0-based offset:
    lineBytes = UTF8 byte length excluding its single separator '\n'
    policy issues first: lineBytes > manifest.jsonlLineLimitBytes ? line-limit-exceeded : none
    JSON.parse
    VFSL + canonical decimal mirror
    record.streamId cross-check
    manifest policy checks (§2.2–§2.4)
    existing carrier/frame storage checks
    create StrictRecordRead; mirror every record issue to stream issues
```

解析失败行仍执行行长检查，随后加 `invalid-json`；不尝试从损坏行提取 sequence，也不让它提供连续性证据。空的末尾 split 产物仅代表最后 `\n`，不是 record；中间空行是物理 JSONL 违规，照现有逻辑产生 `invalid-json`。

### 2.2 `committedUpdateCapture` 的 per-record 算法

定义 `updateCarrier(record)`：genesis 返回 `record.update`；attempt 只在 `result.effect === 'update'` 时返回 `result.update`；`noop`、`rejected`、未 committed 的 `fatal` 及 `update-omitted` 返回空。

```text
if policy.committedUpdateCapture === false:
  if recordKind === 'genesis-baseline':
      allow  // genesis 是 Host 显式基线，和 attempt capture 正交，沿用 ADR-0012/#148 边界
  else if updateCarrier(record) != null:
      add manifest-update-capture-violation
if policy.committedUpdateCapture === true:
  do not infer that every committed attempt must carry update:
  // update-omitted(empty-update/payload-too-large) 与真实 noop/fatal 仍是合法语义，不能误判。
```

该策略只禁止 `capture=false` stream 内 attempt 携带更新，不反向强迫存在更新；这避免把 best-effort 省略误诊为损坏。

### 2.3 `inputCapturePolicy` 的 per-record 算法

只对 `recordKind === 'attempt'` 检查 `input.capture`，genesis 无 input 字段且不参与。

**R3 修订（SA2 #3 MAJOR）——冻结 shape 的精确依据。** #148 的 TS 孪生 `record.ts:63–71` 定义唯一带 `degraded` 的成员为 `{ capture:'digest'; digest:string; degraded?: 'projected-input-too-large' }`；冻结 VFSL 文本 `schema.ts:157–167` 同样把该可选字段限定在 digest 分支、literal 仅为 `"projected-input-too-large"`，并以封闭联合排除 full/redacted/not-accessed/unavailable/unsafe-input/none 上的该字段。因此 reader 的 policy 校验只在 VFSL 已通过后运行；若非 digest capture 偷带 `degraded`、或 digest marker 值拼写/类型不符，正常会先由封闭 VFSL union 判为 `vfsl-invalid`，不把 schema 无法表达的对象伪称 policy 合法。

| manifest policy | 合法 input **精确形状** | policy 违规例子 |
|---|---|---|
| `none` | `{capture:'none'}` | 任意其他 capture；尤其 `{capture:'digest',…,degraded:'projected-input-too-large'}` |
| `digest` | `{capture:'digest', digest}`（**无 `degraded`**）、或 `{capture:'not-accessed'\|'unavailable'\|'unsafe-input'}` | `none` / `full` / `redacted`；digest 带正确或任意 degraded marker |
| `redacted` | `{capture:'redacted', value, digest}`；或 `{capture:'digest', digest, degraded:'projected-input-too-large'}`；或三种不可得形态 | `none` / `full`；digest **无** marker；digest marker 非唯一 literal（若能通过 VFSL）；其他 capture 带 marker（通常先 VFSL-invalid） |
| `full` | `{capture:'full', value, digest}`；或 `{capture:'digest', digest, degraded:'projected-input-too-large'}`；或三种不可得形态 | `none` / `redacted`；digest **无** marker；digest marker 非唯一 literal（若能通过 VFSL）；其他 capture 带 marker（通常先 VFSL-invalid） |

伪代码：

```text
// VFSL union 已通过，因而 input shape 是冻结七分支之一
if input.capture === 'digest':
  marker = own presence of input.degraded
  markerValid = !marker || input.degraded === 'projected-input-too-large'
  if !markerValid: add manifest-input-policy-violation  // defensive mirror; normally VFSL 已拒
  if policy ∈ {'none','digest'} and marker:
     add manifest-input-policy-violation
  if policy ∈ {'full','redacted'} and !marker:
     add manifest-input-policy-violation
  if capture/policy table rejects digest itself:
     add manifest-input-policy-violation
else:
  // non-digest 带 degraded 在冻结 schema 中不可达；若 parser/VFSL 接受异常对象，防御性归 policy violation
  if own presence of input.degraded:
     add manifest-input-policy-violation
  if capture/policy table rejects input.capture:
     add manifest-input-policy-violation
```

`digest + degraded` 是且仅是 full/redacted 投影超 line budget 的确定性降级，必须逐字为 `projected-input-too-large`；不能借此把普通 digest 伪装成强策略，也不能让 digest/none manifest 接受 marker。`not-accessed/unavailable/unsafe-input` 是输入不可得/不安全的既有语义结果，不是静默降级；其存在由冻结联合验证。

### 2.4 `inlineUpdateMaxBytes` 的双向 per-record 算法

对每个 `updateCarrier`，先完成既有 inline Base64 严格 decode 或 sidecar frame 完整交叉，使 payload byte length 为可信的 `N`：

- inline：`N = decoded base64 bytes.length`，并已验证 `N === payloadLength` 和 CRC；
- sidecar：`N = frame payloadLength`，并已验证 JSONL carrier、frame header、CRC 与 `record.sequence` 一致。

只有在上述本体校验成功时才运行表示政策，以免用不可信 `payloadLength` 掩盖问题：

```text
if carrier.storage === 'inline' and N > policy.inlineUpdateMaxBytes:
  add manifest-inline-threshold-violation
if carrier.storage === 'sidecar' and N <= policy.inlineUpdateMaxBytes:
  add manifest-sidecar-threshold-violation
```

边界是 `≤` inline、`>` sidecar；阈值为 0 时仅 0-byte update 可 inline（现有 writer 的 empty update 已会 omitted，但 reader 不假定 writer 未被篡改）。该检查同样适用于 genesis carrier。

### 2.5 `jsonlLineLimitBytes` 的 per-line 算法

`lineBytes > policy.jsonlLineLimitBytes` 即在该行的 `StrictRecordRead.issues` 中记录 `manifest-line-limit-exceeded`；若 line 不能解析，记录项仍保留该 issue 与 `invalid-json`。不得「超限即跳过」：跳过会隐藏后续 VFSL/sequence 证据，也违背 strict 的如实诊断。

writer 不改变其现有 final-record line budget gate；本轮 reader 补上事后执行，且测试会篡改既有文件以证明 reader 不信任 writer。

### 2.6 码表、状态映射与 #148 边界

扩展 `StrictReadIssue.code` 的 reader 域稳定集合，新增五码：

| 新码 | 触发 | 归属 | 状态 |
|---|---|---|---|
| `manifest-update-capture-violation` | capture=false 的 attempt 带 update carrier | record | corrupt |
| `manifest-input-policy-violation` | attempt input 不符合 frozen policy 表 | record | corrupt |
| `manifest-inline-threshold-violation` | payload `N > threshold` 却 inline | record | corrupt |
| `manifest-sidecar-threshold-violation` | payload `N ≤ threshold` 却 sidecar | record | corrupt |
| `manifest-line-limit-exceeded` | 原始 JSONL 行 UTF-8 bytes 超 manifest 上限 | record | corrupt |

另新增一个 stream 级码：`sequence-gap`（§3），也映射 `corrupt`。

不把以上加入 `INCOMPATIBLE_SET`：它们表示可由当前 v1 规范精确解释、但物理记录违反冻结 policy/完整性，属于 `corrupt` 而非未知格式。原有未知 dialect/version/frame 码及其 `incompatible → records:[]` 行为不变。所有新增码只出现在 `reader.ts` 结果与其测试中；**不修改** `record.ts`、VFSL schema、`update-omitted.reason`、`DiagnosticLogHealthEvent` 或 emitter 输出。

## §3. 连续 stream sequence：提交点分配与 reader 校验

### 3.1 新的不变量

**R3 修订（SA2 #1 CRITICAL）——不变量以 append 结果可证明性为边界。** 对于无 ambiguous append outcome 的健康 generation，已保存 JSONL records 的 sequence 必唯一且为从 `1` 起、每次加 1 的连续前缀；definitive pre-commit failure 不消耗 candidate。若同步 append 进入**ambiguous outcome**（无法证明完整 JSONL line 未写入），writer 为保 sequence 唯一性而封闭地提交该 candidate，故真未写入时可能形成 strict reader 可检测的 `sequence-gap`；该 stream 从此是不健康 stream，reader 的 gap 是诚实报告而非健康流误判。无论哪种情况，writer 不得向同一 stream 写入第二条相同 `(streamId, sequence)`。该不变量只描述**物理保存序列**，不表示每个业务 attempt 都被 emitter 接收、更不表示业务提交序列完整。

### 3.2 writer：将分配移到实际 append 提交点

**R3 修订（SA2 #1 CRITICAL）——删除「任何 catch 都复用 candidate」的错误假设。** 删除 `appendSemantic` 和 `runGenesis` 的入口处 `allocate()`。改为双阶段：先以无 sequence 的临时语义/物理投影进入所有可失败、会丢 record 的准备门；只有 record 已通过 line/VFSL/storage gate 且即将进入 JSONL append 的提交分支时，才取得 sequence，并立刻把该 sequence 填入 JSONL record 和（若 sidecar）frame。

### 3.2.1 append failure 分类（规范性）

- **definitive pre-commit failure**：在本次 append 触达目标文件写入之前即可证明为零字节，例如打开目标路径即失败的 `EISDIR`、`EACCES`、`ENOENT`（以及测试 seam 明确声明 `wroteBytes:0` 的失败）。只有此类 failure 可保持 `lastCommittedSequence` 不变，并安全复用 candidate；目录占位被移除后的下一次 append 因此可恢复。
- **ambiguous outcome**：任何发生在 open/write 后、不能由 adapter 证明「该完整 JSONL line 未出现」的错误或 throw，包括部分写入、完整写入后抛 `EIO`、未知 wrapper/interceptor throw。不得从 errno 名称猜测为零写入；默认归入 ambiguous。
- **BIN append 的分类**：BIN failure 也按上述分类。definitive BIN failure 可复用 candidate；ambiguous BIN failure 可能留下部分 frame 或完整 orphan，但在 JSONL 尚未尝试前，它不可能形成 `(streamId,sequence)` 的 JSONL 重复。writer 仍将该 candidate 标为已消耗/不复用，并封闭本 generation，避免随后的 frame/JSONL 用同 sequence 污染 orphan 诊断。下一 generation 可用新 streamId 重新开始；不能在旧 stream 继续。

规范性伪代码：

```text
prepare(record template, payload):
  perform guards, policy-neutral physical choice, line-budget, VFSL prerequisite, storage prerequisite
  if any failure: notify/drop; return // never allocate

commitPrepared(prepared):
  candidate = next(lastCommittedSequence)  // first is '1'; candidate is local until classified
  materialize record.sequence = candidate
  if sidecar:
    frame = encodeFrame(candidate, payload)
    outcome = appendBin(frame)
    if outcome is definitive-pre-commit-failure:
       notify storage-write-failed; return  // do not advance; candidate is reusable
    if outcome is ambiguous:
       commitAmbiguous(candidate, stage:'bin'); return  // no reuse; seal old generation
  outcome = appendJsonl(line)
  if outcome is success:
     commitConfirmed(candidate)
  else if outcome is definitive-pre-commit-failure:
     notify storage-write-failed; return  // do not advance; candidate is reusable
  else:
     commitAmbiguous(candidate, stage:'jsonl')  // no reuse; seal old generation

commitConfirmed(candidate):
  lastCommittedSequence = candidate
  if candidate == UINT64_MAX: set exhausted latch; emit one stream-exhausted

commitAmbiguous(candidate, stage):
  lastCommittedSequence = candidate       // permanently reserves candidate; never reuse
  mode = 'failed' / old generation readonly
  notify storage-write-failed(stage, ambiguous outcome) and pipeline-crashed/stream-init failure as existing stable channels permit
  // health payload/log line must state: `sequence <candidate> may not be persisted`; no claim that it was absent
  // no later append to this generation; recovery is a new generation, not an in-place retry
```

候选只在 confirmed success 或 ambiguous reservation 时写入 `lastCommittedSequence`。ambiguous 时的前进不是「成功声明」：它是为了不重复身份的保守封闭。若完整行实际存在，已保存 JSONL 仍连续；若完整行未出现，旧 stream 留下可由 strict reader 的 `sequence-gap` 发现的非健康 gap。writer 不把未知持久状态伪装为可重试的正常失败。

**BIN-first / fresh-stat 同步规则：** definitive BIN failure 没有写入字节，candidate 可重试；下一次 sidecar 仍由 fresh stat 计算 offset。ambiguous BIN failure 可能有 partial frame 或 orphan，旧 generation 随即封闭，禁止以同一 candidate 或更高 candidate 继续 append；这避免相同 frame sequence 的第二次写入。JSONL ambiguous 时，BIN-first 可能已有完整 orphan/关联 frame；同样封闭 generation，保留其作为 strict reader/恢复工具的诚实残态。fresh stat 只服务 definitive failure 后的下一尝试，绝不被用来把 ambiguous 结果伪装为已恢复。

### 3.3 genesis、gate failure、exhausted 与测试注入

- **genesis 守卫**：空 bytes、超 `payloadMaxBytes`、projection/stat 失败、VFSL/storage/line 失败均在 candidate 前结束，不分配也不消耗 sequence。若 genesis confirmed success，它提交 sequence `1`；否则首个成功 attempt 仍为 `1`。这消除 round-1 的「跳过 genesis 消耗 1」合法 gap。
- **attempt gate / append failure（R3，SA2 #1）**：line budget、VFSL/storage gate 等 candidate 前 drop 不推进。append 失败必须按 §3.2.1 分类：仅 definitive pre-commit failure 可复用 candidate；BIN 或 JSONL ambiguous outcome 必保守 reservation candidate、封闭该 generation，绝不在旧 stream 继续写。故 ambiguous 未落盘可形成不健康 stream 的可检测 gap，而不是健康 stream 的合法 gap。
- **exhausted（R3，SA2 #1）**：confirmed JSONL success 到 `UINT64_MAX` 时才触发一次 `stream-exhausted` 并封闭后续 append。ambiguous `UINT64_MAX` 不发 `stream-exhausted`（它不是确认耗尽），而是走 failed/readonly 封闭；不会在未知状态下允许越界写。这样 stream 的 confirmed 连续前缀可恰好到 uint64 max。
- **`injectFinalRecordFile`**：它是测试注入 seam，不代表 writer 正常 append；保留不自动分配/推进的接口，但测试 fixture 必须自带连续合法 sequence 才能期待 strict `ok`。注入重复、空洞或越界 sequence 由 strict reader 以 `sequence-out-of-order` / `sequence-gap` 响亮判坏；其不应被用来证明正常 writer 行为。
- **`presetLastSequence`**：测试 factory 预置值表示「此前已提交的连续前缀末尾」，不可配成任意未落盘值来期待健康 reader。邻近 max 的测试须按该前提建立前缀 fixture，或只断言后续 writer 不产生超域序列。

### 3.4 reader：跨 segment 的连续性算法

**R3 修订（SA2 #2 MAJOR，继承 SA8 policy/anchor 解耦）——sequence anchor 只锚定 JSONL 自身身份事实。** 在所有 segment 的行扫描中维护 `expectedSequence: bigint = 1n`。参与连续性比较的最小**可信 sequence**前提仅为：JSON parse 成功、VFSL/canonical-decimal 通过、并且 `record.streamId` 与请求 streamId 交叉一致。carrier/frame、CRC、Base64、offset、segment、manifest-policy 均是该 record 的独立 storage/policy usability 诊断，**不得**取消已经可信的 JSONL sequence anchor。故 `StrictRecordRead.ok === false` 不等于该 record 不参与连续性；`ok` 表示全量 record usability，不是 sequence 事实的开关。

```text
expected = 1n
for each record in physical segment/line order:
  parse JSON; validate VFSL/canonical decimal; cross-check record.streamId
  anchorable = all three identity/sequence conditions pass
  independently evaluate manifest policy and carrier/frame/storage; append all resulting issues
  if !anchorable:
    report its own parse/VFSL/stream-identity corruption only; continue
    // sequence continuity is unknown across this uninterpretable identity line; do not infer a numerical gap
  actual = BigInt(record.sequence)
  if actual < expected:
    add stream issue sequence-out-of-order (segment/offset/sequence); do not change expected
  else if actual > expected:
    add stream issue sequence-gap (segment/offset/sequence); expected = actual + 1n
  else:
    expected = actual + 1n

// no special end-of-file issue: EOF after any continuous prefix is legal best-effort tail.
```

- 起点固定为 1，而非「第一条看到的 sequence」。故 `[2]`、`[1,3]`、跨 segment `[... segment1:1; segment2:3]` 均被检测为 `sequence-gap`。
- segment 扫描顺序保持 8 位名称的升序；跨 segment 不重置 `expected`。
- `committedUpdateCapture:false` 的合法 genesis（sequence 1）虽带 update carrier，但因 genesis 与 attempt capture 正交、且 policy issue 不影响 anchor，必须锚定 sequence 1；其后合法 attempt sequence 2 不得产生 gap。任何中间 policy-violating record 也同理：报告 policy corrupt，但不得让其后的连续 record 产生二次虚假 gap。
- `[1 inline, 2 sidecar-but-bin-missing-or-frame-corrupt, 3 inline]`：sequence 2 仍锚定，stream 因 storage issue 为 corrupt，但不得报告 `sequence-gap`；反之物理删除 JSONL sequence 2 时，sequence 3 必报告 gap，不取决于 `.bin` 是否仍存在。
- `UINT64_MAX` 合法；命中后若后续还有任何可信 sequence record，则其数值不可能满足 uint64 v1 range（VFSL 应先拒），reader 不生成虚假的 wrap 解释。EOF 位于任意连续前缀（包括 `[1..UINT64_MAX]`）不额外报错。
- JSON 破损、VFSL/canonical decimal/stream identity 失败而致 sequence 身份不可解释的行，本身已足以令 stream `corrupt`；算法只报告该行自身损坏，不猜测其序列，也不把可见的下一条与其前一条拼接出「精确缺口」。这比伪造具体 gap 更诚实。

### 3.5 reader/replay 文案

`readStreamStrict.status === 'ok'` 的文案改为：**「在本次静态读取中，已解析的该 stream v1 物理 records 自 sequence 1 连续，且通过 manifest/storage/frame 校验。」**

不得写成「所有业务变更完整」「无业务 attempt gap」「可恢复 namespace」。replay 的成功文案仍附加 ADR-0011 既有限定：只对所选 strict stream 的 committed records 进行诊断性 replay，并且仅在没有已知 gap、截断、损坏或版本不兼容时陈述诊断性成功；它不提供持久性、事务性或跨副本顺序保证。

## §4. ADR-0012 正式修订文本草稿（反馈 3）

> 本节是要写入 `docs/adr/0012-vfsl-validated-jsonl-and-framed-sidecar-change-log.md` 的 diff 级设计。ADR 状态保留 `accepted`，追加 dated amendment；ADR-0011 正文不修改。

### 4.1 取代/新增条款（规范性文本）

在 ADR-0012 的 writer/emitter 段追加：

> **Amendment — File adapter first slice.** 本 ADR 中「日志 adapter 提供有界、non-blocking emitter，内部每个 stream 同时最多一个逻辑 writer queue」及「默认周期 batch flush，不逐条 fsync」两句，**在首切片 File adapter 的当前实现范围内被以下条款取代**：每个 `emit` 在调用栈内执行至多一条 final JSONL record 的有界同步 append；若其携带 sidecar，则额外执行至多一帧 BIN append，顺序为 BIN-first。该首切片不维护 writer queue、不做 batch flush、不提供 fsync 开关，也不保持常驻 file descriptor。同步 append 完成不构成 fsync 或掉电持久性承诺。
>
> 此处「有界」仅指 adapter 主动处理的数据量与操作数量受配置 payload/line limits 和单-record/单-frame 范围限制；它**不**表示底层文件系统延迟有时间上界，亦不表示 emit 可在任意调用点不阻塞。
>
> 为保持 ADR-0011 的 emitter seam，本首切片 `emit` 必须保持 `void`、non-throwing、不得返回 durability promise，并以 catch-and-health-report 处理 adapter 故障。**规范性接线条件：任何将 File adapter 的 `emit` 接入 namespace 生命周期的调用点，必须位于 NamespaceRuntime write sequencer slot 之外，或在该 slot 已释放之后；不得在 slot 内执行同步 File adapter emit。** 不满足该条件的接线为不合规，必须由 #149–#151/#155 或后续接线票修复后方可启用。
>
> queue/batch 是目标演进形态而非与首切片并列的当前要求：未来切片可在不改变 emitter 公共 seam、record schema、manifest policy 或上述 write-slot 隔离条件的前提下，以每 stream 至多一个逻辑 writer queue 替换同步 append，并采用有界队列、drop/health 语义和周期 batch flush；该切片须另行定义 close/shutdown、flush、队列满与 fsync 配置语义。

### 4.2 ADR 的具体编辑点

| ADR-0012 现有位置/主题 | 修改动作 | 结果 |
|---|---|---|
| 「有界、non-blocking emitter；每 stream 最多一个逻辑 writer queue」 | 追加 amendment 明确取代其对**当前 File first slice**的 queue 必然性 | queue 不再与同步直写同时强制 |
| 「默认周期 batch flush，不逐条 fsync；真正 fsync 可配置且默认关闭」 | 追加 amendment 的首切片替代段 | 当前无 batch、无 fsync 开关；仍不承诺掉电持久性 |
| File adapter writer 行为说明 | 追加同步 append 上限、BIN-first、无常驻 fd 的范围 | 使 PR #159 行为有 ADR 依据 |
| 与 ADR-0011 的关系/后果 | 新增 write-slot 外接线的 MUST 条件与 void/non-throwing/no-durability-promise 重申 | 不能以「同步有界」逃避慢 I/O 延长 write-slot 的风险 |
| 被否方案/后果段 | 见 §4.3 | 记录被否而非保留矛盾文本 |
| Future evolution 段 | 新增 queue/batch 的后续切片表述 | 保留终态路线，但非当前强制 |

### 4.3 被否方案与后果的更新

ADR-0012 的「每条 fsync 或业务 await 日志 append」继续为被否方案，后果维持：会把诊断持久性耦合到业务路径，违背 best-effort。

新增被否方案：

1. **在不修订 ADR 的前提下把同步 append 称为现行 queue/batch 的实现细节**：被否；文本会同时要求 queue/batch 和无 queue/batch，无法审计。
2. **允许同步 File adapter emit 在 namespace write slot 内执行**：被否；慢文件系统仍可无限延长业务写槽，直接违反 ADR-0011/0008 的业务隔离。
3. **把「有界」解释成对磁盘 latency 的承诺**：被否；文件系统延迟不可由 payload/line budget 限定。
4. **现在直接实现异步 queue/batch 以回避文本修订**：被否（本票范围）；会引入内存—磁盘状态、关闭/flush/队列满和 EISDIR 恢复语义，超出首切片纪律。

后果/权衡须明确：首切片保持同步可观察性与无常驻 fd，简化 EISDIR 占位恢复、消除 queue 状态；代价是调用方线程可能被文件系统阻塞。因此只有 write-slot 外规范性接线可以保持 ADR-0011 的业务隔离；未来 queue/batch 可改善 producer 延迟，但必须独立设计其故障和寿命语义。

### 4.4 SA8 解除条件对应

| SA8 条件 | 本设计落实 |
|---|---|
| 1. 明确取代 queue/batch、记录同步范围/取舍 | §4.1 首段、§4.2、§4.3（明确「被取代」而非并列） |
| 2. 保持 ADR-0011 seam，write-slot 外为规范性条件 | §4.1 第二段；`void/non-throwing/no durability promise` + MUST outside slot |
| 3. 保留 queue/batch 演进，非同时强制 | §4.1 第三段、§4.2 future evolution |
| 4. 实际提交点分配且 best-effort 限定 | §3.2–§3.5 |
| 5. policy 码表声明且不改冻结 schema/emission | §2.6 |

## §5. 实现落点与测试锚

### 5.1 `reader.ts`

- 增加 typed `ManifestFormatPolicy`（从已通过 manifest gate 的 object 提取）；不得在未验证的 manifest 上执行策略。
- 原始行分割改为能获得每一行原始 UTF-8 bytes；每条按 §2.1 写入 line-limit issue。
- **R3 修订（SA2 #2）**：先完成 JSON parse → VFSL/canonical decimal → `streamId` 交叉并确定 sequence anchor；随后独立执行 §2.2–§2.5 manifest policy 与 carrier/frame storage 检查。一条可拥有多个 issue，且 `StrictRecordRead.ok=false` 不得取消已建立的 anchor。
- 把 `orderSequences` 单纯递增循环替换为 §3.4 `expectedSequence=1n` 连续状态机；仅 JSON/VFSL/streamId 不可解释时不锚定，issue 必须带可用的 `segment/offset/sequence` 归因。
- 扩展 `StrictReadIssue.code` 文档和 `INCOMPATIBLE_SET` 边界：新增六码不加入 incompatible 集。

### 5.2 `adapters/file.ts`

- **R3 修订（SA2 #1）**：将 `lastSequence` 的语义改名/收紧为 `lastCommittedSequence`；candidate 前 gate drop 与 definitive pre-commit failure 不写它；ambiguous BIN/JSONL append outcome 以 reservation 写入该 candidate 后立即封闭旧 generation，永不复用。
- 将 `allocate()` 拆为无副作用 `candidateSequence()`、`commitConfirmed(candidate)` 和 `commitAmbiguous(candidate, stage)`；只有前者的 JSONL success 可触发 `stream-exhausted`，后者只能 failed/readonly 封闭。
- `runGenesis` 的前置守卫和所有 gate 通过后才取得候选；守卫跳过不消耗序列；其 append 失败与 attempt 走同一 definitive/ambiguous 分类。
- sidecar 的 frame 序列必须从同一个候选生成；definitive BIN failure 才允许 fresh-stat 后复用候选。ambiguous BIN/JSONL 失败保留 partial frame/orphan 并封闭 generation，禁止后续用同 candidate 或更高 candidate 写旧 stream。
- `injectFinalRecordFile` 的 testing-only 非分配语义不改变；注入 fixture 与 strict 连续性契约由测试明确覆盖。

### 5.3 测试锚（SA6 owned）

在 strict reader 测试新增（或同包专用 R2 测试新增）以下验收：

1. `committedUpdateCapture:false` 的 attempt `effect:update` → `manifest-update-capture-violation/corrupt`；同 manifest 下 genesis update 仍合法。
2. **R3 修订（SA2 #3）**：input policy 精确形状：full/redacted + digest + 唯一 literal `degraded:'projected-input-too-large'` 为正例；full/redacted + digest 无 marker、marker 拼写/值变化 → `manifest-input-policy-violation`；digest/none + digest marker → 同码；非-digest capture 携带 marker 由冻结封闭 union 先判 `vfsl-invalid`（若测试 seam 绕过 VFSL，则 reader 防御性同码）。
3. **R3 修订（SA2 #3）**：真实 writer 产物：`inputPolicy='full'|'redacted'` 且 full/redacted input 超 line budget 时，`file.ts:385–397` 产生 digest + 唯一 marker；该实际记录须由 strict reader 接受为 policy 正例，防止设计与 #148 冻结 schema 漂移。
4. 4097 bytes inline（threshold 4096）与 4096 bytes sidecar → 各自阈值码；4096 inline、4097 sidecar 为正例；对 genesis 同测一种。
5. 在原始 JSON text 填充使行字节超 `jsonlLineLimitBytes`，即使可 parse/VFSL 合法也判 `manifest-line-limit-exceeded`；等于上限正例。
6. `[1,2,3]` 删除物理中间 JSONL 行得到 `[1,3]` → `sequence-gap/corrupt`；起始 `[2]`、跨 segment gap、重复/倒序仍覆盖。**R3（SA2 #2）**：`[1 inline,2 sidecar-bin 被删/CRC 损坏,3 inline]` 必报告 sequence 2 storage issue 且 stream corrupt、但不得产生虚假 `sequence-gap`；物理删除 JSONL 2 时无论 bin 是否保留都必须 gap。
7. **R3 修订（SA2 #1）**：append seam 模拟「完整 JSONL 行写入后抛 EIO」（ambiguous）：后续 emit 不得写第二条相同 sequence，旧 generation 必 failed/readonly 并有「sequence N may not be persisted」健康证据；不得把 sequence 2 伪作同 generation 连续恢复。
8. **R3 修订（SA2 #1）**：append seam 模拟 open 期 `EISDIR/EACCES/ENOENT` 且证明零字节（definitive pre-commit）：candidate 可安全复用，移除目录占位/恢复可写后下一成功 record 使用同一 candidate 且不形成 gap。
9. **R2 修订（SA8 设计后复审 hard-violation #1）**：`committedUpdateCapture:false` manifest 下的合法 genesis（sequence 1、带 update）后接合法 attempt（sequence 2）→ strict 不得报告 `sequence-gap`；验证 genesis 的 capture 正交性和 policy/anchor 解耦。
10. **R2 修订（SA8 设计后复审 hard-violation #1）**：sequence 2 的中间 record 制造 manifest-policy 违规、sequence 1/3 其余可信 → 仍报告该 record 的 policy `corrupt` issue，且 sequence 3 不得因 sequence 2 policy 违规而产生虚假 `sequence-gap`。
11. max 边界：confirmed 保存 `UINT64_MAX` 后恰一次 exhausted，之后零 record；ambiguous max candidate 不得触发 exhausted、必须封闭 generation；definitive failure 后下一成功仍可使用该 candidate。

## §6. 风险与防御性决策

| 风险 | 防御 |
|---|---|
| 使用 parsed/serialize 后长度漏掉敌意原始超长行 | 严格按原始物理行 UTF-8 bytes 计数 |
| 将 policy mismatch 当 incompatible 导致隐藏所有可解析 record | 新码全部 `corrupt`，records 保留逐条诊断 |
| definitive 与 ambiguous append failure 混同，导致 candidate 重复或假恢复 | §3.2.1 分类：仅可证明零字节的 pre-commit failure 复用；任何 ambiguous outcome 永不复用、reservation candidate 后封闭 generation |
| BIN 成功/JSONL 失败导致候选序列重复或 orphan 被污染 | definitive 才 fresh-stat 重试；ambiguous BIN/JSONL 保留 partial/orphan 作为残态、封闭旧 stream，strict reader 如实报告 gap/corruption |
| 同步 IO 再次进入 write slot | ADR-0012 amendment 以 MUST 写成接线门禁，后续 Host 接线验收必须验证 |
| carrier/frame 损坏被误当作 sequence 不可信 | §3.4 将 anchor 限至 JSON/VFSL/streamId；`ok=false` 仍可锚定，storage corruption 单独报告 |
| 伪造/错用 degraded marker 降低 input policy 强度 | §2.3 用冻结 union 的唯一 digest literal 与 manifest-relative双向规则验证 |
| 借 reader 码扩展偷改 #148 | 新码只属 reader 输出，不入 record/schema/emission/health 词表 |

## §7. SA2 反馈逐条回应

> 本轮为 SA8 conflict gate 先行约束；尚未收到针对本 R2 设计的 SA2 reject。以下记录总控指定的三项反馈及 SA8 五项绑定解除条件，供 SA2 逐项攻击。

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|:--:|---|---|
| 反馈 1：strict reader 执行 manifest 四策略 | ✅ | §2、§5.1 | 每行/每 record 算法、双向 threshold、输入策略表、六码与 corrupt 映射 |
| 反馈 2：stream sequence 连续且健康 stream 不误判 | ✅ | §3、§5.2 | 分配收紧到 JSONL commit 成功点；跨 segment 从 1 连续校验，保留 best-effort 限定 |
| 反馈 3：同步 I/O 与 ADR 的冲突须 ADR 化 | ✅ | §4 | ADR-0012 amendment diff 草稿；取代关系、write-slot MUST、演进路径、被否方案 |
| SA8 条件 1–3：ADR amendment 完整性 | ✅ | §4.1–§4.4 | queue/batch 取代、ADR-0011 seam 与 slot 外条件、未来演进分别写为规范性文本 |
| SA8 条件 4：sequence 提交点及语义边界 | ✅ | §3.1–§3.5 | definitive failure 无合法 gap；ambiguous outcome 以封闭 reservation 留下可检测的不健康 gap；不声称业务尝试完整 |
| SA8 条件 5：码表/冻结面边界 | ✅ | §2.6 | 明确 reader 私有码、corrupt 映射，不改 schema/emission |
| SA8 设计后复审 hard-violation #1：policy mismatch 不得破坏 continuity anchor | ✅ | §3.4、§5.3 #9–#10 | 删除 manifest-policy 作为 sequence eligibility 条件；可信 sequence 独立锚定，policy 违规仍单独 corrupt；补 genesis 与中间违规回归锚 |
| SA2 #1 CRITICAL：ambiguous append outcome 不得复用 candidate | ✅ | §3.1、§3.2.1、§3.3、§5.2、§5.3 #7–#8 | 定义 definitive-zero-byte 与 ambiguous 分类；后者 reservation candidate、封闭旧 generation，禁止重复 sequence；BIN partial/orphan 与 fresh-stat 规则同步收紧 |
| SA2 #2 MAJOR：carrier/frame 错误不得取消 JSONL sequence anchor | ✅ | §3.4、§5.1、§5.3 #6 | anchor 最小前提收窄至 JSON/VFSL/canonical decimal/streamId；`StrictRecordRead.ok=false` 不等于不参与连续性；storage corruption 独立报告 |
| SA2 #3 MAJOR：degraded marker 必须受冻结 union 与 manifest policy 双向钉死 | ✅ | §2.3、§5.3 #2–#3、§9 | 引用 record/schema 精确 union；唯一 literal、出现/禁止条件、VFSL 先拒规则和真实 writer 降级正例均明确 |

## §8. 文件清单（File Scope）

### ALLOW LIST
- `packages/namespace-diagnostic-log/src/reader.ts` — 修改；实现 manifest policy 的 per-line/per-record 校验、六个 reader 诊断码和跨 segment 连续性状态机（约 120 行）。
- `packages/namespace-diagnostic-log/src/adapters/file.ts` — 修改；把 sequence 的持久状态提交时点移至 JSONL append 成功、修正 genesis/exhausted 语义（约 110 行）。
- `packages/namespace-diagnostic-log/test/file-adapter-strict-reader.test.ts` — `[SA6 owned]` 修改；新增 policy mismatch、行上限、sequence-gap 和跨 segment 验收断言（约 180 行）。
- `packages/namespace-diagnostic-log/test/file-adapter-r2-policy-continuity.test.ts` — `[SA6 owned]` 修改；覆盖 gate/IO/genesis 不消耗 sequence、提交点与 exhausted 边界（约 100 行；现有 R2 专用测试域）。
- `docs/adr/0012-vfsl-validated-jsonl-and-framed-sidecar-change-log.md` — 修改；写入 §4 的 accepted amendment、被否方案与演进路径（约 70 行）。
- `packages/namespace-diagnostic-log/README.md` — 修改；纠正 strict `ok` 的连续物理记录限定与静态读取/同步 write-slot 使用边界（约 25 行）。
- `packages/namespace-diagnostic-log/AGENTS.md` — 修改；增加同步 File adapter emit 不得在 namespace write slot 接线的工程边界提示（约 10 行）。

### DENY LIST
- `packages/namespace-diagnostic-log/src/record.ts` — #148 冻结 record 类型/词表，本票 reader 码不写入该文件。
- `packages/namespace-diagnostic-log/src/schema.ts` — VFSL schema 文本与指纹冻结，本票不改。
- `packages/namespace-diagnostic-log/src/vocabulary.ts` — emission 受控词表冻结，本票不改。
- `packages/namespace-diagnostic-log/src/pipeline.ts` — #148 emitter 管线稳定，本票不改。
- `packages/namespace-diagnostic-log/src/adapters/memory.ts` — memory adapter 不属于 File reader/commit-point 修正面。
- `docs/adr/0011-best-effort-namespace-diagnostic-change-log.md` — 简报明确 ADR-0011 正文不动；适用性由 ADR-0012 amendment 澄清。
- `packages/namespace-runtime/**` — 本票不实施 Host/write-slot 接线；仅规定后续接线的 MUST 条件。

## §9. 协议假设依据 (Protocol Assumption Evidence)

| 假设 | 依据类型 | 依据内容（具体引用） | 风险等级 |
|---|---|---|---|
| JSONL line byte limit 不含 `\n`，writer 以 UTF-8 计量 | 源码引用 | `file.ts:99–106` 的 `TextEncoder` 与 `measure(JSON.stringify(record))`，且 config 注释 `file.ts:56–57` 已声明不含结尾换行 | 低 |
| sidecar 先 BIN 后 JSONL，BIN 成功 JSONL 失败可留 orphan | 源码引用 | `file.ts:455–496`：sidecar 分支 `appendFileSync(binPath)` 后才 append JSONL，JSONL catch 仅报告并返回 | 中 |
| 现行 reader 的 sequence 只检查递增 | 源码引用 | `reader.ts:402–408` 仅使用 `<=`，没有 `expected+1` 比较 | 低 |
| 现行 writer 先 allocate 后 gate/append | 源码引用 | `file.ts:499–517` 和 `file.ts:544–574`；`allocate()` 在 `file.ts:235–240` 立即写 `lastSequence` | 低 |
| 同步 append 可能延长调用方 | 源码引用 + ADR 摘录 | `file.ts:473–490` 调用同步 `appendFileSync`；相关决议 `task_diagnostic-log-file-adapter-r2_relevant_decisions.md:34–35` 摘录 ADR-0011 write-slot 隔离 | 高 |
| append failure 能否安全复用 candidate | 源码引用 + 设计保守分类 | `file.ts:473–495` 现有 catch 只接收 thrown error、没有字节数/atomic-commit 回执；因此代码无法证明 `appendFileSync` throw 前完整 JSONL line 未写。R3 §3.2.1 只将 open 期、测试 seam 明确 `wroteBytes:0` 的失败归 definitive，其余默认 ambiguous 并封闭 generation。 | 高 |
| frozen input union 的 `degraded` 精确形状 | 源码引用 | `record.ts:63–71`：仅 digest 分支有 `degraded?: 'projected-input-too-large'`；`schema.ts:157–167`：VFSL 同一封闭 union/literal；`file.ts:385–397`：真实 full/redacted line-budget 路径写入该唯一 marker。 | 低 |

## §10. 契约改动连锁审计 (Contract Change Caller Audit)

无公共函数签名、返回类型、throw/return 行为或 async 时序的契约改动：`readStreamStrict` 仍同步且不抛，File adapter `emitter.emit` 仍为 void/non-throwing；本轮仅收紧它们对损坏存储和 sequence 分配时点的内部语义。

需要后续接线票审计的规范性部署条件（非本票代码 caller 改动）：所有将 File adapter `emit` 从 NamespaceRuntime 业务路径调用的 Host caller，都必须验证调用发生在 write sequencer slot 外或释放后。此设计不列为本票 caller 改动，因为 `packages/namespace-runtime/**` 明确在 DENY LIST，且 #149–#151/#155 才拥有接线范围。
