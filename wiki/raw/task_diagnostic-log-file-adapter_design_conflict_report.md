# 冲突门禁报告（设计后复审 R1）

- 被审对象：SA1 R1 设计 `wiki/raw/task_diagnostic-log-file-adapter_design.md`（729 行，含文末总控 §11 六项裁决 G1–G6）
- 冲突基准：ADR 全集（`docs/adr/` 11 文件，与前置门禁同集，已复核未变动）+ CONTEXT.md——**不变**；代码与其他 wiki 文档不构成自动阻塞依据（本次仅用于核验设计的事实性声明：冻结 schema 形状、健康词表、#148 基线行为）
- 复审范围：设计决策 vs ADR 条款一致性。设计优劣归 SA2，实现质量归 SA4/SA7
- 配套更新：`task_diagnostic-log-file-adapter_relevant_decisions.md` 已追加「设计后复审追加（R1）」节

## Verdict

`conflict` —— **1 条 evolution 级冲突点，0 条 hard-violation，0 条 override-declared**。

按 SA8 四级裁决表：evolution「不自动停，报告上报 Jim 裁决」；hard-violation 才触发停止协议。本报告**不构成停止依据**，构成 1 条需 Jim 裁决的上报项（见冲突点 #1）。

## ADR 对照结论（增量盘点：仅设计触及的条款组）

| ADR / 条款组 | 设计触及点 | 对照结论 |
|---|---|---|
| 0012 §JSONL record（sequence 纪律 / exhausted / operation 词表 / result 判别联合 / source·context / observedAt） | §2.4、§4.1、§4.2、§8、J3/J9/G2 | **1 条 evolution（J9）**；其余 no-conflict（sequence「准备 append 时分配」、gap 合法性依「不证明业务尝试无缺」、词表零扩） |
| 0012 §Writer、append 与背压（单 writer queue / BIN-first / drop-newest / batch·fsync / shutdown） | §4.1、§4.3、J1/J2/G6 | no-conflict（依据链见冲突报告结论 3.1；被否方案「每条 fsync 或业务 await」两者皆未触犯；queue/batch 为 ADR 许可式与可调策略项） |
| 0012 §Stream 与 generation（续写条件 / genesis 尽力 / LOG_STREAM_INIT_FAILED / 旁路状态） | §3.1、§3.4、§4.2、J5/G1 | no-conflict（「无法安全续写→新建」在 #152 验证能力边界内的诚实适用；genesis 尽力、失败不禁用、不虚称完整重放均保持） |
| 0012 §File adapter 布局（目录树 / 安全文法 / current.json / manifest 不可变与最少内容 / owner 等不冻结） | §2.1–§2.3、§2.6、J7/J12 | no-conflict（14 键 ⊇「至少保存」清单；恰三键 locator；temp+rename；'wx' 一次写；违规零 fs 触达、不静默另存） |
| 0012 §Inline 与 sidecar + §Binary frame v1（4 KiB 阈值 / RFC 4648 padded / payloadLength+CRC32C / 64 MiB uint32 上限 / 25B header / CRC 输入域 / 非零 flags·reserved 判 incompatible） | §2.5、§4.1、§5、J8 | no-conflict（逐字段一致；`min(配置, uint32)` clamp 满足「不得超过 uint32」） |
| 0012 §VFSL record schema + storage validator 分工（内建冻结 / manifest 指纹匹配 / append 前双门 / observer 内容限制 / 不建第二份 VFSL） | §3.1③④、§4.1、§6、§8 | no-conflict（writer/reader 双侧只信内建冻结常量；observer 只带稳定 code/issuePaths/指纹/字节数；零 schema 改动） |
| 0012 §Strict reader（strict 全量校验 / 未知版本 incompatible 不近似解释 / 不同 stream 互不连带） | §7 全节 | no-conflict（七码 incompatible 集 → records:[] + manifest 照常展示；corrupt 保留逐条判定；单 stream 作用域） |
| 0012 §输入、issues 与资源投影（input.capture 纪律 / digest 默认 / JCS+SHA-256 / projected-input-too-large / 限额 / 1 MiB line 上限） | §1.3、§4.1 | no-conflict（默认值逐一等于 ADR 默认；降级链与丢弃上报同构） |
| 0012 延后条款（segment rolling 与耗尽、打开与尾部恢复、retention、replay、manifest-scan 恢复、fsync 开关） | §2.1、§3.2、§4.3 | no-conflict（按简报切分延后至 #153/#154/#155 与后续票；设计不与这些条款字面冲突——不滚动因不超限、不续写走「无法安全续写」分支、不猜 locator） |
| 0011（best-effort 隔离 / emitter seam / 不引入第二排序机构 / 数据保护 / 时序与 sequencer / shutdown 有界） | §1.3、§4.3、§4.4、§8 | no-conflict（事件全走独立 observer、低基数白名单、streamId/namespaceId 不入事件、emit 同步 void 不抛；附接线期注意项，见结论 3.4） |
| 0001/0006/0007/0008/0009（边界引用） | §1.1、§1.5、§12 | no-conflict（不改 DocPersistence/Runtime/Registry 契约；不改 #148 冻结面与 schema；node:fs 绑定面属包级 AGENTS 纪律非 ADR 基准） |
| CONTEXT.md 术语（genesis baseline record / storage projection / 语义 emission / update-omitted 三值词表 / 诊断日志 stream generation） | §4.1、§4.2、§6、§7 | no-conflict（genesis 形状与术语逐字段一致；物理键构造全部收口 adapter；update-omitted reason 恰用三值；generation 不自动拼接） |
| 总控 §11 六项裁决（G1–G6） | 设计文末 | no-conflict（六项逐一对照 ADR：G1/G2/G4/G5 无对应 ADR 强制条款或为防御性收紧；G3 扩值不违反 observer 内容纪律；G6 见 J1 依据链） |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | 中（物理不可达路径；词表缺口而非架构矛盾） | ADR-0012 §JSONL record：「达到 uint64 最大值后 stream 进入 exhausted，后续日志 emission 丢弃**并上报**，业务不受影响。」 | 设计 §4.1：「exhausted(lastSequence) → 丢弃（**静默**；§10-J9 护栏）」；§10-J9：「事件词表无 exhausted reason（SA6 未给）；物理不可达（~10¹⁹ 次 append）；词表演进留给实际需要时」 | **evolution**（不自动停，上报 Jim 裁决） | ①「并上报」为无条件行为要求，设计的 exhausted 丢弃无任何上报通道：`record-dropped.reason` 冻结两值 `line-budget-exceeded \| queue-full`（`src/health.ts:43` 核实），File adapter 又无 stats 面（设计 §1.4 明示「无 records()/stats() 读面」）。②设计对基线的转述失准：#148 memory adapter 实为「丢弃 + stats 计数」（`src/adapters/memory.ts:12` 及 323-324 `countDrop(book,'sequence-exhausted',…)`，经 `stats()` 可观测），File 设计较已合入基线更弱。③设计自身承认完全满足该条款需词表演进（新增 reason 值或事件成员）而未走正式声明、总控六项裁决（G1–G6）未覆盖 J9——构成「未声明的能力收窄/条款缓期」。④不判 hard-violation：丢弃护栏存在、业务隔离保持、路径物理不可达（uint64 max ≈1.8×10¹⁹；仅确定性随机源/预置接缝的测试可触达）、设计诚实备案而非隐匿，修复为小型词表决策而非架构返工 |

## 结论

**Verdict `conflict`：无 hard-violation，不触发停止协议。** 裁决分布：no-conflict（含六项总控裁决复核）为其余全部，evolution × 1（冲突点 #1 / J9），hard-violation × 0，override-declared × 0。

### 1. 需 Jim 裁决的条目（唯一）

**J9 exhausted 上报缺口**，三选一（任一均不推翻 ADR 0012 条款本身）：
- (a) 批准缓期：维持「丢弃静默」，记入 REPORT 遗留风险，#153+（rolling 与耗尽同票）落地「上报」；
- (b) 授权本票扩 `record-dropped.reason` 第 3 值（如 `'sequence-exhausted'`——#148 联合只增不改，与 G3 扩值同型）；
- (c) 授权新增独立健康事件成员承载 exhausted 转换。

SA1 依 G1 同款纪律「不擅自扩词表」是正确的；该缺口应在总控层裁决而非设计层默认。

### 2. 核验过的关键事实（供 SA2/SA3 免重复取证）

- 冻结 schema：`GenesisBaselineRecord.update: UpdateCarrier` 强制、无 omitted 变体（`src/schema.ts:210-218`）→ 设计 §4.2「genesis 无 update-omitted 逃生门」成立；
- 健康词表：`record-dropped.reason` 两值封闭（`src/health.ts:43`）→ J9 词表缺口属实；
- #148 基线：exhausted = 丢弃 + stats 计数（`src/adapters/memory.ts:12,323-324`）→ 设计「复用 #148 语义（丢弃静默）」转述失准（见冲突点 #1 依据 ②）。

### 3. 非冲突备案（SA2 可攻击，不构成门禁阻塞；已同步登记进相关决议文档）

1. **J1 同步写契约**：#148 基线已将「非阻塞」确立为「有界同步工作」的解释；ADR 0011「可在其实现内部使用…文件…sink」为许可式；ADR 0012 将 batch/flush 列为可动态调整策略；被否方案仅否「每条 fsync 或业务 await」。emit 有界性由 line 预算 + payload 上限保证。
2. **§3.4 resume 恒新建 + §4.2 genesis 超限跳过**：分别为「无法安全续写→新建」的诚实适用、schema 保形的唯一选项（后果由「不得声称完整重放」条款覆盖）。
3. **延后项重申**：rolling/尾部恢复/retention/replay/fsync 开关按简报切分延后，设计不与条款字面冲突。
4. **接线期注意（转 #149–#151，非本票冲突）**：ADR 0011「adapter 慢…不得延长 write slot」——同步 emit 含有界磁盘 IO，emit 调用点须置于 namespace write sequencer 槽外或槽后；默认 `updateCapture:false` 下常规 emit 载荷仅 ≤1 MiB JSONL 行。
