# 冲突门禁报告 — R2 设计后复审（R2 轮）

## Verdict

`clear`

> R1 的唯一 hard-violation 已闭合：修订后 §3.4 将可信 sequence anchor 与 manifest-policy 诊断解耦；合法 genesis 和中间 policy-violating record 均不再制造后续虚假 `sequence-gap`。复核未发现新增 ADR/CONTEXT 冲突。

## R1 复审痕迹与闭合

| R1 冲突点 | R1 裁决 | R2 修订证据 | R2 裁决 |
|---|---|---|---|
| #1：§3.4 将 manifest-policy 不匹配 record 排除出连续性 anchor，可能令合法 capture=false genesis `sequence=1` 后的合法 `sequence=2` 被误报 gap。 | hard-violation | 设计 §3.4（168–193）规定可信 sequence 只依赖 JSON parse、VFSL/canonical decimal、streamId 和必要 carrier/frame 解释；policy 检查「永远不是 anchor 前置条件」。§3.4（191）明定合法 genesis 1 后 attempt 2 不得报 gap；§5.3 #6/#7 添加两项回归锚。 | **已闭合 / no-conflict** |

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted | 冻结 schema 边界 | no-conflict |
| ADR-0002 | rewrite / authority 出范围 | accepted | 否 | no-conflict |
| ADR-0003 | evaluator / derived schema | accepted | 否 | no-conflict |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 否 | no-conflict |
| ADR-0005 | 投影生成管线 | accepted | 否 | no-conflict |
| ADR-0006 | DocPersistence | accepted | 日志非 Persistence 真相源 | no-conflict |
| ADR-0007 | logical validation / Runtime bridge | accepted；open/read 部分由 0008 取代 | 否 | no-conflict |
| ADR-0008 | Runtime write sequencer | accepted | write-slot 隔离 | no-conflict |
| ADR-0009 | Registry / Host lifecycle | accepted | shutdown 间接关联 | no-conflict |
| ADR-0011 | best-effort diagnostic log | accepted | emitter seam、best-effort、replay | no-conflict |
| ADR-0012 | JSONL/framed-sidecar log | accepted；设计拟追加 amendment | 主规范 | no-conflict（amendment 为明确局部演进） |

## 冲突点

无。R2 轮未发现 `hard-violation`、`evolution` 或未声明 override。

## 前置五条解除条件复核

| # | 条件 | R2 设计证据 | 裁决 |
|---|---|---|---|
| 1 | amendment 明确取代当前 queue/batch，而非并列 | §4.1（209）明确现有「每 stream 一个逻辑 writer queue」与「默认周期 batch flush」在 File adapter 首切片当前范围「被以下条款取代」；§4.2–4.3 列出相应编辑与被否方案。 | **满足** |
| 2 | write-slot 外为规范性 MUST；ADR-0011 seam 保持；ADR-0011 正文不动 | §4.1（213）保留 `void`、non-throwing、无 durability promise，且以「必须位于……slot 之外」「不得在 slot 内」规定接线条件；§8 deny list（324）不改 ADR-0011。此与 ADR-0011 的 seam/不延长 write slot 条款和 ADR-0008 槽序一致。 | **满足** |
| 3 | queue/batch 演进保留、非当前强制 | §4.1（215）明确 queue/batch 是「目标演进形态而非与首切片并列的当前要求」，留待后续票定义生命周期、flush、队列满和 fsync。 | **满足** |
| 4 | sequence 在实际 JSONL 提交点分配；reader 自 1 连续；消除合法物理 gap 源；保留 best-effort | §3.2–3.3 只在 JSONL 成功后提交 `lastCommittedSequence`，涵盖 genesis 守卫、gate、BIN/JSONL 失败、exhausted 和注入接缝；§3.4 R2 修订使 policy mismatch 不破坏可信 sequence anchor；§3.5 保留仅证明已保存物理 records 的 best-effort 文案。 | **满足** |
| 5 | 新 reader 码为私有诊断面，不触碰 #148 冻结面 | §1.2、§2.6、§8 deny list 明定五个 policy code 和 `sequence-gap` 只属于 `reader.ts` 结果与测试，不改 record、VFSL schema、`update-omitted.reason`、health 或 emitter。 | **满足** |

## §4 amendment 与 ADR-0012 逐项复核

| ADR-0012 现行条款 | §4 amendment 的处理 | 结论 |
|---|---|---|
| 每 stream 同时最多一个逻辑 writer queue | §4.1 对 File first slice 明示「被以下条款取代」，以单 record（可另加一 BIN frame）同步 append 替代。 | 无并列强制 |
| 默认周期 batch flush / fsync 可配置 | §4.1 对同一首切片明确无 batch、无 fsync 开关，同时保留不承诺掉电持久性。 | 无并列强制 |
| ADR-0011 的 non-blocking seam 与不得延长 write slot | §4.1 区分有界工作与无 latency 上界，保持 void/non-throwing/no-durability-promise，并以 slot 外 MUST 排除业务写槽内同步 I/O。 | 一致；无需改 ADR-0011 正文 |
| 「writer 准备 append 时才分配 stream sequence」 | §3.2 使用无副作用 candidate，且仅 JSONL append 成功后提交 `lastCommittedSequence`。 | 一致的收紧解释 |
| sequence 不证明业务尝试无缺 | §3.1/§3.5 限定为静态读取中已保存物理 records 的连续，不宣称业务尝试完整、恢复安全或 exactly-once。 | 一致 |
| BIN-first 与 orphan 允许 | §3.2 允许 BIN 成功、JSONL 失败留下 orphan；candidate 不提交、下一成功写重用该 sequence 并使用 fresh offset。 | 一致 |
| exhausted 后丢弃并上报 | §3.3 仅在 JSONL 已成功持久化 `UINT64_MAX` 后 latch，并 emit 一次 exhausted。 | 一致 |
| 被否方案：每条 fsync 或业务 await 日志 append | §4.3 保持被否；同步 append 不被解释为 fsync 或 durability await。 | 一致 |
| strict/replay 对 gap、损坏与不兼容的诚实状态 | §2、§3.4–3.5：可信 record 从 1 连续校验；无法解释 sequence 的行只报自身 corruption；policy mismatch 独立 corrupt；不伪造 gap。 | 一致 |

## R2 连续性修订复核

- §3.4 的可信 sequence 前提足以保障跨记录比较的数值、stream identity 和有 update 时的必要物理载体事实；policy 是解释规则，独立报错但不篡改已可信的物理序列事实。
- `committedUpdateCapture:false` 下合法 genesis update 仍可作为 `sequence=1` anchor；后续合法 attempt `sequence=2` 不会被误判。
- 中间 record 的 manifest policy 违规会令 stream `corrupt`，但不阻断其可信 sequence 对后继 record 的连续性锚定；因此不产生 R1 所述二次虚假 gap。
- JSON/VFSL/canonical decimal/stream identity/必要 carrier-frame 无法解释时不推断数值缺口，符合 ADR-0012 对中间损坏响亮标记而非猜测恢复的边界。

## 结论

R2 设计复审通过，Verdict 为 `clear`。R1 hard-violation 已由 §3.4 与 §5.3 #6/#7 正面闭合；五项前置解除条件均满足，且本轮未引入新的 ADR 或 CONTEXT.md 冲突。可放行后续评审/实现链路。

---

# R3 Delta 复审（SA2 R1 reject 后修订）

## Verdict

`clear`

> R3 的三项 delta 均与 ADR/CONTEXT 一致：ambiguous append 以保守 reservation + 旧 generation 只读/新 generation 继续，落实而非削弱 best-effort 与 sequence 身份纪律；reader anchor 收窄为 JSONL 身份事实，避免 sidecar 损坏伪造 gap；degraded marker 规则收紧到冻结 record union 的解释空间。未发现新的 `hard-violation`、未声明 `evolution` 或 override。

## R3 delta 裁决

| Delta | 设计证据 | ADR / CONTEXT 对照 | 裁决 |
|---|---|---|---|
| append definitive / ambiguous 二分；ambiguous reservation candidate 后封闭旧 generation | §3.1、§3.2.1、§3.3、§5.2–§5.3 #7/#8/#11 | ADR-0012 要求 sequence 仅代表 stream append 顺序、不得回绕，BIN-first 允许 orphan/坏尾；旧 stream 无法安全续写时建立新 generation，且中间损坏旧 stream 只读、新建 generation。ADR-0011 不承诺无 gap、允许尾部缺失并要求日志失败隔离。 | **no-conflict** |
| sequence anchor 仅依 JSON parse + VFSL/canonical decimal + streamId；carrier/frame 错误独立 corrupt | §3.4、§5.1、§5.3 #6 | ADR-0012 将 stream 连续性与 frame/storage 交叉校验都交给 storage validator，但未规定 carrier failure 可抹除 JSONL record 身份。读取 JSONL `sequence` 可解释时仍锚定，正避免 sidecar 损坏造成假 gap；物理删 JSONL 才可检测真实 gap。 | **no-conflict** |
| input `degraded` marker 按冻结 union 与 manifest 双向规则校验 | §2.3、§5.3 #2/#3 | ADR-0012 明定 full/redacted 因 line budget 降为 digest 并记录 `projected-input-too-large`；VFSL 是 record 形状真相。R3 只严格解释冻结 record/schema 形状，不改 schema/emission/health 词表。 | **no-conflict** |

## 重点条款复核

### 1. 「writer 准备 append 时才分配 stream sequence」

R3 在所有 prepare gate 后才生成局部 candidate（§3.2.1）。definitive pre-commit failure 不消耗 candidate；ambiguous outcome 则不把它宣称为 confirmed append，而是为避免同一 `(streamId, sequence)` 可能重复而永久 reservation 并关闭旧 stream。该规则仍在 ADR-0012 的「准备 append」文字空间中，且更严格地区分“候选”与“已确认 JSONL append”。没有把 sequence 解释成业务尝试完整性或 durability 证明。

### 2. ambiguous outcome、尾部残态与 generation 封闭

ADR-0012 明示 BIN-first 崩溃可留下 orphan frame、不完整尾 frame 或不完整 JSONL 尾行；对不可安全续写或中间损坏旧 stream 要只读并建新 generation（Stream/generation 与打开/尾部恢复条款）。R3 的 ambiguous append 无法证明完整 JSONL line 未出现，封闭旧 generation、保留残态并以新 streamId 新建 generation，属于“旧 stream 无法安全续写”的直接适用，不是未授权的 retention/delete、自动中间修复或跨 generation 拼接。

R3 的 `sequence N may not be persisted` 健康文案如实表述未知状态，不宣称 record 缺失/存在、业务失败或 durability；它走独立 health/observer，符合 ADR-0011/0012 的日志失败隔离与健康上报要求。其闭合旧 generation 只影响日志能力，不得改变业务返回值、提交事实、Runtime 状态或 write-sequencer 顺序。

### 3. best-effort、gap 与 replay 限定

ambiguous candidate 真未写入时出现 strict 可检测 gap，与 ADR-0011 的“不承诺无 gap”及 ADR-0012 replay 仅在无已知 gap/截断/损坏时可 complete 一致。若完整 JSONL line 实际已写入，则 sequence 连续；若未写入，则旧 stream 因 gap/健康故障不可称健康。R3 没有将任何 stream 的连续性提升为业务 attempt 完整、exactly-once、WAL 或恢复保证。

### 4. R3 anchor 收窄与 policy/storage 诊断

R3 保持 R2 对 policy/anchor 解耦的闭合，并进一步规定 carrier/frame/CRC/Base64 失败不取消已经通过 JSON/VFSL/canonical-decimal/streamId 的 JSONL identity anchor。该选择与 ADR-0012 “storage validator”双职责一致：同一 record 可以 storage-corrupt 且 sequence 事实仍可参与连续性；strict 仍报告其 storage issue、stream 仍为 corrupt。对 JSON/VFSL/identity 不可解释行不编造数值 gap，符合 ADR-0012 不从 BIN 猜回 JSONL attempt 语义和中间损坏 loud-fail 的边界。

### 5. 冻结词表与 marker 规则

R3 §2.3 只将 `projected-input-too-large` 作为 ADR-0012 已有 full/redacted line-budget 降级的解释规则；新增 reader issue 仍局限 `reader.ts` 私有诊断面。没有修改 #148 record schema、VFSL schema/fingerprint、`update-omitted.reason`、emitter 或 health 受控词表，故无 CONTEXT/ADR 词表演进冲突。

## 结论

R3 delta 复审通过，最终 Verdict 维持 `clear`。R1/R2 历史裁决继续有效；R3 对 ambiguous I/O 的 generation 封闭是 ADR-0012 已授权的安全续写/新 generation 机制，而非额外架构演进。可继续后续实现与验证链路。