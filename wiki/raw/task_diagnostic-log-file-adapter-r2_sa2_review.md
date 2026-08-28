# SA2 攻击评审报告 — File diagnostic-log adapter R2

**Date**: 2026-08-28  
**Verdict**: **reject**（1 × CRITICAL、2 × MAJOR；须由 SA1 修订设计后复审。）

**被审对象**: `wiki/raw/task_diagnostic-log-file-adapter-r2_design.md`（SA1 R2，341 行）  
**审查基准**: 任务简报 R2、`task_diagnostic-log-file-adapter-r2_relevant_decisions.md` 的 ADR-0011/0012/0008 摘录，以及 R2 现有源码与测试锚。  
**审查范围**: 设计，不替代后续 SA4/SA7 对实现与活链路的验证。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|---|---|---|---|
| 1 | **CRITICAL** | §3.2 提交点 / BIN-first orphan | 候选 sequence 在 BIN 成功、JSONL 失败后会复用；但 writer 仍以未提交的 `lastCommittedSequence` 计算下一候选。若 JSONL 的失败是“实际已写入后才向调用方报错”的不确定结果，重试会把相同 `(streamId, sequence)` 写入第二条 JSONL，形成重复 sequence；或者 writer 改为不复用则形成 gap。设计没有定义 append 结果不确定时的可恢复协议，故“健康 writer 一定无合法 gap/重复”没有成立。 | 明确区分 **definitive pre-commit failure** 与 **ambiguous JSONL append outcome**。对后者不得重用 candidate：进入 failed/readonly（或创建新 generation），上报稳定健康事件；只有能证明 JSONL 未出现该完整行的失败才可复用。相应重写 §3.2 的“下一成功 JSONL 可复用同一 candidate”限定和测试锚。 |
| 2 | **MAJOR** | §2.4 policy 与 §3.4 continuity anchor | §3.4 把 sidecar frame 解释/交叉校验作为“可信 sequence”的前提。物理删除一个 `.bin` 或篡改其 frame 会使该 JSONL record 的 sequence 不可信，状态机跳过它；若后续 JSONL 是连续的，reader 只报告 frame 损坏而**漏报物理 JSONL record 的连续性证据被破坏**。更糟的是删除含 sequence=2 的 JSONL 与使 sequence=2 sidecar 不可解释的情形，在连续性诊断上得到不同且不完整的结论。任务 R2-AC2 要求删除中间 record 必发现，并要求 strict storage validator 诚实说明连续性。 | 将 anchor 的最小可信前提收窄为：JSON parse、VFSL/canonical decimal、record.streamId 交叉通过；carrier/frame 错误仅作为同 record 的 storage corruption，不得取消该 record 的 sequence anchor（与 manifest-policy 已解耦的原则一致）。若坚持载体错误取消 anchor，则须增加明确 stream 级 `sequence-continuity-unknown` 状态/码并使 replay 绝不以“连续”措辞成功；当前六码集合与 `ok` 文案不足。 |
| 3 | **MAJOR** | §2.3 degraded digest 标记防伪 / 输入策略 | 表格把 `full`/`redacted` 下 `digest + degraded:'projected-input-too-large'` 一概允许，却没有规定 `degraded` 字段的**精确对象形状、唯一允许值、与 capture=digest 的双向排他关系**。若 VFSL 当前容许 `digest` 携带该字段，攻击者可伪造该 marker，把普通 digest 记录伪装成 line-budget 降级；若 VFSL 不允许，则设计要求的 writer 合法降级又会被 reader 判 VFSL-invalid。设计不能依赖“已有联合验证”来证明 manifest-policy 的语义防伪。 | 在 §2.3 明示并核对 frozen record schema 的准确形状：`degraded` 只允许在 manifest=full/redacted 且 `input.capture==='digest'` 时出现，且值必须精确为 `projected-input-too-large`；manifest=digest/none、`capture` 为 full/redacted/not-accessed/unavailable/unsafe-input 时出现该字段均为 `manifest-input-policy-violation`（或先被 VFSL 拒绝）。同时要求源码/fixture 锚定该字段在 #148 冻结 schema 中的实际可达性；如不存在该字段，必须停止假设并以既有 schema 的真实降级编码重写设计，不能改 schema。 |

---

## 逐项攻击论证与修订要求

### #1 CRITICAL：JSONL append 结果不确定时复用 candidate 会破坏唯一序列不变量

**触发条件**：sidecar 或 inline 的 `append JSONL` 在文件系统层已接受、写入了完整行，但调用处因 I/O、拦截器、异常包装或错误注入收到失败。设计 §3.2（146–156）规定 JSONL append 失败不推进 `lastCommittedSequence`，下一成功 JSONL 复用同一 candidate；§3.3 又把所有 JSONL IO failure 都归入“不推进”。

**影响**：

1. 磁盘可留下两条相同 sequence 的 JSONL records；strict reader 只能在事后报 `sequence-out-of-order`，而健康 writer 已违反 §3.1 的连续唯一前缀不变量。
2. 若为避免重复而盲目前进，则会留下合法 gap，重新击穿 R2-AC2 的“健康 stream 不误判”。
3. BIN-first 放大此问题：第一次 JSONL 结果不确定时已经有 orphan frame；第二次以同 candidate 再写可能有两个相同 frame sequence，reader 的 frame/offset 诊断与 stream sequence 都被污染。

**可执行修订要求**：

- 对 JSONL append 失败定义结果分类。仅“写入前已确定失败”才允许 candidate 重用；无法证明未形成完整 JSONL line 的失败必须令该 generation 停止接受 append（failed/readonly）并上报，或转交后续票以新 generation 恢复。
- 同步更新 §3.1 不变量、§3.2 伪代码、§3.3 的 IO failure 表述，以及 §5.2/§5.3 测试锚；不可把“所有 catch 都可重试同一 candidate”保留为实现自由度。

**红灯测试思路**：在 `appendFileSync(jsonl)` 的测试 seam 中模拟“先追加完整 line，再抛 EIO”。emit sequence=1 sidecar/inline 后再次 emit；断言设计选定的保护行为发生（旧 stream 禁用或新 generation），绝不能落下第二条 sequence=1，也不得把 sequence=2 伪作连续同 generation。另测“确认零字节写入的失败”可以安全重用 candidate。

### #2 MAJOR：carrier/frame failure 被错误地作为 continuity anchor 的取消条件

**触发条件**：`[1 inline, 2 sidecar, 3 inline]` 的 JSONL 都可 JSON parse、通过 VFSL、sequence 字面规范且 streamId 正确；删除 `.bin`、使 2 的 frame CRC 错，或使 frame 读取 EACCES。设计 §3.4（168）要求带 update carrier 的 record 必须通过必要 frame 解释/交叉才能提供可信 sequence，故 sequence=2 不进状态机。

**影响**：reader 对物理 JSONL 的事实已有足够证据可以确定 `[1,2,3]` 数值连续，却因 sidecar 不可用丢弃 anchor；它既不能表达“已保存 JSONL sequence 连续但存储载体损坏”，也不能稳定表达“连续性未知”。这破坏 §3.5 所承诺的“已解析 physical records 自 1 连续”的可解释边界，且会让后续 replay/工具把 sequence 结果与载体结果混淆。

**可执行修订要求**：

- 对连续性采用两层事实：**sequence anchor** 仅依赖 JSONL 记录自身可验证的身份/数值；**record usability** 仍要求 frame/CRC 成功。
- 如发生 JSON/VFSL/streamId 本身无法解释才不推进 anchor；这时应明确连续性为 unknown，而不是从下一条推测精确 gap。
- 更新 §3.4、§5.1 顺序描述、§5.3 测试，并明确 `StrictRecordRead.ok=false` 不等同于其 sequence 无法参与 stream 连续性。

**红灯测试思路**：构造 `[1 inline,2 sidecar,3 inline]`，分别删除 bin、篡改 2 的 CRC、令 bin 成目录。断言：record 2 发生 `frame-missing`/frame CRC issue、stream corrupt；但连续性状态按设计明确报告为“JSONL sequence 连续”（不得额外制造 `sequence-gap`，也不得把它默认为无结论）。再物理删除 JSONL 的 sequence=2 并保留/删除 bin，均必须稳定有 `sequence-gap`。

### #3 MAJOR：degraded digest marker 没有被冻结 policy 精确认证

**触发条件**：在 `inputCapturePolicy='full'` 或 `'redacted'` 的 manifest 下，注入一个 `input.capture='digest'`，带任意/伪造 `degraded` 字段；或在 manifest=digest 下额外塞入 `degraded:'projected-input-too-large'`。§2.3 只以自然语言“仅带 degraded”允许，未要求 exact literal，也未规定无关 capture/policy 的 marker 应否拒绝。

**影响**：R2-AC1 明列“degraded digest 标记防伪”。当前设计无法区分真正由 line budget 决定性降级的 record 与攻击者伪造的 digest，从而将 frozen input capture policy 的强度降级为可伪装的声明。并且若 schema 真正不承载该字段，设计与冻结 #148 契约冲突，实施者会在 reader 中误设不存在的结构规则或暗改 schema。

**可执行修订要求**：

1. 引用 `record.ts/schema.ts` 的实际 frozen union，并逐字段规定 policy 表的合法形状；不是只列 capture 枚举。
2. 明确 `degraded` 文字值、出现条件和禁止条件；该校验在 VFSL 通过后仍要执行，因为它是 manifest-relative storage policy，不是新 schema。
3. 对 schema 不允许的字段说明它将先走 `vfsl-invalid`；不得把它误归为 policy 允许。

**红灯测试思路**：

- full/redacted + digest + 正确 literal → 唯一正例；
- full/redacted + digest 无 marker、marker 拼写变化、额外 marker 值 → `manifest-input-policy-violation`；
- digest/none manifest + digest 有 marker → 同码；
- non-digest capture 带 marker → `vfsl-invalid` 或 policy violation（由 frozen schema 的真实规则固定）；
- 确认 writer 的 full/redacted 超 line budget 路径产生的实际 record 可被 strict reader 接受，防止设计与 #148 schema 漂移。

---

## 协议假设依据审查

**结论：有条件不通过。** §9 存在，且列出的 Node/当前源码引用可定位，没有 HTTP/WS/端口时序类无据假设。

但 §9 没有给出以下两个实现该设计不可或缺的可验证依据，且直接导致上述攻击点未被约束：

1. **同步 JSONL append 失败是否可证明零写入**：设计把所有失败视为可重用 candidate，必须提供 API/测试 seam 的可证明原子结果，或承认结果不确定并采用 #1 的失败封闭策略。
2. **冻结 input union 中 `degraded` 的精确形状与 literal**：§2.3 声称“既有 line-budget 确定性降级”，却未给出 schema/源码行号和真值表依据；必须补充。

其余 §9 引用（原始 UTF-8 计量、BIN-first、旧 sequence 递增检查、旧 allocation 时点、同步 append）可由 SA4 按位置复核。

## 错误处理链路审查

- **静默失败**：§4 的同步 append 经 catch/health 路径处理，且 ADR amendment 承认底层 latency 无上界，表述较诚实。✅
- **状态闭环**：#1 暴露 JSONL append 的“失败但可能已提交”没有状态；仅 notify/drop 并不能让 writer 在未知持久状态下继续安全工作。❌
- **降级路径**：full/redacted 的 input 降级被设计为可接受路径，但 #3 未验证 marker 真伪，当前属未经认证的降级。❌
- **虚假降级识别**：未把“不能判断 append 是否已成功”当作可安全重试的正常失败；这是将未知持久状态伪装为未提交，属 CRITICAL。❌
- **用户可感知性**：reader 的新增 code 和 health 事件应在 #1 修订后定义稳定映射；当前 `storage-write-failed` 不足以告知调用方该 stream 已不能继续安全 append。

## 词表卫生与 ADR amendment 复核

- §2.6 的五个 record code + 一个 stream code 不写入 `record.ts`、VFSL、emitter/health，且均映射 `corrupt`，符合相关决议对私有 reader 域扩码的边界；命名未与现有 reader 码产生字面冲突。**这一项暂通过。**
- §4.1 对 queue/batch 的“当前 File first slice 被以下条款取代”、对 ADR-0011 `void/non-throwing/no durability promise` 的保留、以及 slot 外 MUST 都是无歧义的；被否方案和演进路径也与简报选择 b 一致。**这一项通过。**
- 但 ADR amendment 不应被解释为 #1 情形下同步 append 可以无限次无状态复用；修订后的 failure semantics 必须同步体现在“BIN-first orphan”后果描述，避免逻辑队列被删后丢失唯一性保护。

## 结论

设计已正确覆盖许多 R2 主路径：原始行 UTF-8 计量、阈值双向校验、genesis 的 capture 豁免、policy issue 不取消 anchor（就 policy 而言）、slot 外接线 MUST，以及 ADR-0012 的局部 amendment 均有清晰文本。

但是，**JSONL commit 不确定性**会直接打破连续 sequence 的核心新不变量；而 carrier/frame 与 degraded marker 两个边界又使 strict reader 的“连续/策略合规”结论不够可验证。三项均影响 R2-AC1/AC2 的诚实性，故：

**Verdict: reject。** SA1 修订 #1–#3 后提交复审；通过后的实现仍须由 SA4/SA7 验证。

---

## 验证证据（本轮审查）

在 worktree `/home/wangjian/nomicore-fix-issue-152` 对照读取：

- `wiki/raw/task_diagnostic-log-file-adapter-r2_relevant_decisions.md`：ADR-0012 要求 storage validator 负责 stream 连续性、BIN-first/orphan 允许，ADR-0011 保持 non-throwing/写槽隔离。
- `wiki/raw/task_diagnostic-log-file-adapter-r2.md`：R2-AC1 明列 degraded digest 标记防伪；R2-AC2 要求 `[1,2,3]→[1,3]` 必发现且健康流不误判。
- `wiki/raw/task_diagnostic-log-file-adapter-r2_design.md:132–156, 166–193`：验证 candidate 复用和 carrier/frame 作为 anchor 前提的设计文本。
- `wiki/raw/task_diagnostic-log-file-adapter-r2_design.md:64–82`：验证 input policy 表及未精确定义 marker 的设计文本。
- `packages/namespace-diagnostic-log/src/adapters/file.ts:455–497,499–525,544–574`：现有实现确为 BIN-first，JSONL catch 后直接 return，且当前 allocation 早于落盘；R2 正在重定义此行为。
- `packages/namespace-diagnostic-log/src/reader.ts:313–399`：现有 reader 的 carrier/frame 判定与 sequence 收集目前耦合方式，作为拟改动风险的代码基线。
- `docs/adr/0012-vfsl-validated-jsonl-and-framed-sidecar-change-log.md:204–214,216–242`：验证 storage validator 职责、BIN-first/orphan 和旧 queue/batch 条款。

---

# SA2 R2 复审（R3 设计修订）

**Date**: 2026-08-28  
**Verdict**: **pass**（R1 的 1 × CRITICAL 与 2 × MAJOR 均已完整闭合；未发现新的阻塞性设计漏洞。此 pass 仅放行设计，不能替代 SA4/SA7 对实现、测试和活链路的验证。）

**复审对象**: `wiki/raw/task_diagnostic-log-file-adapter-r2_design.md`（SA1 R3，393 行）  
**复审范围**: 仅核验 R1 #1–#3 的修订及其相邻新增面；不重开已通过的 ADR amendment / 写槽隔离裁决。

## R1 攻击点闭合核验

| R1 攻击点 | R3 修订位置 | 判定 | 独立核验结论 |
|---|---|---|---|
| #1 CRITICAL：ambiguous JSONL/BIN append 后复用 candidate | §3.1–§3.3、§5.2、§5.3 #7/#8/#11、§9 | ✅ 闭合 | R3 严格二分 definitive pre-commit（仅可证明零字节）与 ambiguous（默认），后者 reservation candidate 后封闭旧 generation、永不复用。完整行后抛错不再能生成第二条同 `(streamId, sequence)`；真未写入时形成的 gap 被定义为已封闭不健康 stream 的诚实残态，而非健康流误判。BIN ambiguous 也封闭，避免 orphan frame 的同 sequence 重写。 |
| #2 MAJOR：carrier/frame 失败取消 sequence anchor | §3.4、§5.1、§5.3 #6、§6 | ✅ 闭合 | anchor 最小前提准确收窄为 JSON parse + VFSL/canonical decimal + record.streamId 交叉。Base64、frame、CRC、offset、policy 只影响 record usability；`StrictRecordRead.ok=false` 不撤销已经建立的 anchor。明确覆盖 `[1,2(sidecar坏),3]` 无假 gap 与删除 JSONL 2 必 gap 两个反例。 |
| #3 MAJOR：degraded digest marker 无精确防伪 | §2.3、§5.3 #2/#3、§9 | ✅ 闭合 | R3 引用了冻结的 `record.ts:63–71` 与 `schema.ts:157–167`。实查二者均限定 `degraded?: 'projected-input-too-large'` 只存在于 digest 分支；R3 又实施 manifest-relative 双向约束：full/redacted 必有 marker，digest/none 禁止 marker，非 digest 偷带字段先 VFSL-invalid。真实 writer 降级产物正例也有测试锚。 |

## 新增攻击面复核

### 1. definitive / ambiguous 分类与状态闭环

**通过。** R3 没有以 errno 名称猜测安全重试；除“打开前确定零字节”的 `EISDIR/EACCES/ENOENT` 和测试 seam 明示 `wroteBytes:0` 外，所有错误默认 ambiguous。对 ambiguous JSONL，`lastCommittedSequence` 的 reservation 不是伪称成功，而是唯一性保护，并立即 `failed/readonly` 封闭旧 generation。对 ambiguous BIN，尽管 JSONL 尚未出现，R3 同样封闭 generation，避免同 sequence frame 重写及 orphan 解释污染。这个保守策略满足 ADR-0012 的 best-effort 边界与 CONTEXT 所述“旧 stream 损坏或无法安全续写时新 generation”。

需实施时保持的纪律（已是 R3 规范性要求，不构成 reject）：`appendBin/appendJsonl` 的 wrapper 必须能表达三态 `success | definitive-pre-commit-failure | ambiguous`；绝不可把普通 Node `catch` 自动映射为 definitive。health 输出不得伪造持久性结论，必须保留 `sequence N may not be persisted` 的稳定可观察证据。

### 2. exhausted 与 reservation 的边界

**通过。** confirmed JSONL success 到 `UINT64_MAX` 才发一次 `stream-exhausted`；ambiguous max 走 failed/readonly 而不宣称 exhausted，因而不会在未知提交结果后生成超域 next sequence。definitive pre-commit max 失败仍可安全用同 candidate 重试。§5.3 #11 覆盖这三个边界。

### 3. 连续性状态机与敌意 record

**通过。** R3 保留“JSON/VFSL/streamId 自身不可解释时不虚构精确 gap”的诚实边界；对可解释 JSONL 身份事实，则无论 policy/frame 是否损坏都进入 anchor。这将 stream sequence 的数值事实与 payload 可用性正确分层，符合 ADR-0012 把跨记录连续性和 storage/frame 交叉都交给 storage validator 的职责划分。

### 4. 词表、冻结面及 ADR amendment

**通过。** 新增的六个 reader issue 仍限制在 `reader.ts` 私有诊断结果，均为 `corrupt` 而非 `incompatible`，没有触及 `record.ts`、VFSL schema、emission reason 或 health 词表。§4 的 amendment 仍明确局部取代 queue/batch、保留 void/non-throwing/no-durability-promise 与 write-slot 外 MUST，且不修改 ADR-0011 正文，满足任务简报 R2-AC3 和相关 ADR 基准。

## 协议假设依据审查

**通过。** §9 新增两条此前缺失且可复核的依据：

1. `file.ts:473–495` 的现有 catch 没有提交/字节数回执，足以证明不能将一般 throw 当作零写入；R3 因此采取 default-ambiguous 的保守分类。
2. `record.ts:63–71`、`schema.ts:157–167` 与 `file.ts:385–397` 可定位地证明 degraded 的冻结 literal、封闭分支及真实 writer 产物。

未见以“应该/通常/预计”替代可验证证据的关键协议假设。

## 错误处理链路审查

- **静默失败**：ambiguous 与 definitive append failure 均要求 health 通道，且 ambiguous 明示 sequence 持久性未知；不再静默重试。✅
- **状态闭环**：ambiguous 进入 failed/readonly，禁止后续旧 stream append；confirmed exhaustion 与 ambiguous max 的分支明确。✅
- **降级路径**：input 降级已用冻结 union + manifest 双向政策认证；不可得 input 仍与 projected degradation 区分。✅
- **虚假降级**：未把“未知是否写入”伪装成可安全恢复；未把任意 digest 伪装成 full/redacted 的预算降级。✅
- **用户可感知性**：实现必须按 §3.2.1 输出既有稳定 health channel 加 `sequence N may not be persisted` 证据；该具体实现及对外呈现由 SA4/SA7 验证。✅（设计层）

## R2 红线测试思路（实施验收重点）

1. **JSONL complete-then-throw**：seam 先追加完整 sequence=1 行后抛 EIO；再次 emit 后断言旧 stream 没有第二个 sequence=1、模式封闭、health 带“may not be persisted”。
2. **BIN partial/complete-then-throw**：seam 写入部分或完整 frame 后抛错；断言旧 stream 不再 append，不能写出同 sequence 或更高 sequence JSONL/frame。
3. **definitive zero-byte failure**：目标为目录或 seam `wroteBytes:0`；恢复后重试同 candidate 成功，strict reader 连续且无 gap。
4. **carrier corruption不取消anchor**：`[1 inline,2 sidecar,3 inline]` 删除 bin、CRC 损坏、bin 为目录三变体；record 2 corrupt，但不得 `sequence-gap`。删除 JSONL 2 的对应变体必须 `sequence-gap`。
5. **marker truth table**：full/redacted+正确 digest marker 的实际 writer record 为正例；digest/none+marker、full/redacted+无 marker、伪造 literal 依规则分别为 policy violation 或 VFSL-invalid。
6. **UINT64_MAX**：confirmed max 恰一次 exhausted；ambiguous max 不发 exhausted、封闭旧 stream；definitive max failure 可重试 max。

## R2 复审结论

R3 的关键改动不是把不确定持久化“换一种说法”，而是将其转化为不可继续写的、可观察的 generation 封闭状态；同时把 JSONL sequence 身份、payload 可用性和 manifest-relative input policy 分层处理。R1 的 1C+2M 均已以可执行算法、状态转移和测试锚闭合。

**Verdict: pass。** 允许进入实现与后续 SA4/SA7 验证。

## R2 验证证据

- `wiki/raw/task_diagnostic-log-file-adapter-r2.md:32–35,50–55`：R2-AC1/AC2/AC3 和范围边界。
- `wiki/raw/task_diagnostic-log-file-adapter-r2_design.md:64–99`：R3 degraded 精确形状与双向 policy 算法。
- `wiki/raw/task_diagnostic-log-file-adapter-r2_design.md:145–204`：R3 definitive/ambiguous 分类、reservation、generation 封闭、genesis/exhausted 语义。
- `wiki/raw/task_diagnostic-log-file-adapter-r2_design.md:208–241`：R3 anchor 收窄与 reader/replay 诚实文案。
- `wiki/raw/task_diagnostic-log-file-adapter-r2_design.md:311–325,381–387`：R3 红灯测试锚和协议依据。
- `packages/namespace-diagnostic-log/src/record.ts:63–71`、`packages/namespace-diagnostic-log/src/schema.ts:157–167`：冻结 union 的 degraded 唯一 literal 与分支范围。
- `packages/namespace-diagnostic-log/src/adapters/file.ts:455–497`：现有 BIN-first 与仅 catch/no-byte-receipt 基线，支持 default-ambiguous 的设计选择。
