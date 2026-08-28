# 冲突门禁报告 — 设计后复审（round 1）

> SA8 设计后复审。被审对象：`wiki/raw/task_diagnostic-log-stream-roll-repair_design.md`（SA1 round 1，628 行全读）。
> 冲突基准：`docs/adr/` 全集（11 文件）+ `CONTEXT.md`（与前置门禁同一基准；#148/#152 契约与 R2 设计档案不构成自动阻塞依据）。
> 复审范围：设计决策 vs ADR/CONTEXT 一致性 + 前置门禁七条钉死语义逐条落实核验（总控指定 ①–⑦）。设计优劣与实现可行性属 SA2/SA4/SA7，此处不裁。

## Verdict

`clear`

> 七项钉死核验全部通过；未发现 hard-violation、evolution 或未声明 override。设计全部扩展（manifest 17 键、冻结面 +3 项、reader +2 码、健康事件 +2 成员 +2 reason、构造期 write-slot 条件）均落在 ADR-0012 非穷举清单空间内，无任何 mandated 行为被改写；「无需 ADR 修订」的宣称（§16 DENY LIST `docs/adr/**`）经逐条复核成立。

## 前置门禁钉死项逐条核验（总控指定 ①–⑦）

| # | 钉死项 | 设计落点 | 核验 | 裁决 |
|---|---|---|---|---|
| ① | roll targets 冻结归类的 ADR 依据是否成立（§4.2 论证 + manifest 14→17 键 + reader 新码 `manifest-roll-target-violation`） | §2-D5 / §4.2 / §9.1 / §9.3 | **成立**。三分论证逐条核验：(a)「物理表示字段 `storage.segment` 取值序列的決定者」——且比设计所述更强：ADR-0012 冻结清单已含 `inlineUpdateMaxBytes`，ADR 明文「该阈值**只影响物理表示**」仍入冻结面——纯物理表示配置入冻结面有 ADR 内部直接先例，targets 同类且影响面更广（segment 字段本身是 record 的物理组成，CONTEXT.md storage projection 词条）；(b) 一致可验证性——§9.3 闭段核查以 manifest 单值为准，动态 targets 会使按旧值滚动的闭段被误判违规，冻结是自洽唯一解；(c) manifest「至少保存」非穷举 + 归冻结更保守——与前置门禁冲突点 #1「两分支皆在清单空间内、冻结为保守合法分支」的裁决完全一致。**14→17 键扩展合规**：原子三键同进同出、类型核对（整数 ≥1 ≤2^53-1）、15/16 键 → `manifest-invalid`；恰 14 键 legacy → `legacy-manifest` rotate（可读不可续写）是 ADR「旧 stream 无法安全续写……建立新 stream」的直接适用，且不改写旧 manifest（门槛 10 落实，§13.13/18 锚定字节恒等）。**新 reader 码合规**：reader issue 码词表非 ADR 穷举（#152 R2 SA8 裁决 (c) 先例）；闭段核查是 ADR「任一target达到时，在写入下一条record前关闭当前group并开启新group」的逆否实施，推导健全——滚动仅在达标时发生、计数器单调不减、闭段终态计数 ≥ 滚动时点值；「闭段」由更大编号 segment **文件**存在性定义（惰性创建下崩溃留下的空组不构成假闭段），不产生误报路径。 | **no-conflict** |
| ② | 耗尽＝丢弃上报/disabled，全设计无「耗尽新建 generation」残留 | §2-D6 / §7 / §8.1 | **无残留**（全设计 grep 实证：`耗尽|exhaust` 全部 30 处命中均为 disabled/latch/丢弃语义）。新建 generation 的全部触发集 = `fresh`（首次启用）+ rotate 七因（manifest-missing/invalid/legacy/frozen-policy-mismatch/corrupt/incompatible/repair-io-failure）——恰为 ADR「首次启用、旧 stream 无法安全续写、冻结配置改变、显式 rotate/reset」授权集；segment `99999999` 溢出与 sequence uint64 共用 `exhaustedLatch`、恰一次 `stream-exhausted`、触发 record 及后续丢弃、「不新建 segment、不新建 generation」明文。reopen 已耗尽经 `exhaustedAtOpen` 从磁盘重导出（sequence=max 或 seg=99999999 且计数达标），构造期恰一次再上报——上报义务满足（ADR「后续日志 emission 丢弃并上报」），每进程寿命恰一次的抑制沿 #152 既有形状先例。issue「new generation or disabled stream」析取被正确收窄为 disabled 分支。 | **no-conflict** |
| ③ | reopen/修复同步 IO 的 write-slot 纪律成文 | §12 / §16（README+AGENTS 更新入 ALLOW LIST）/ §17 | **成文**。§12.1 将 ADR-0012 amendment 规范性条款（「任何将 File adapter 的 `emit` 接入 namespace 生命周期的调用点，必须位于 NamespaceRuntime write sequencer slot 之外，或在该 slot 已释放之后；不得在 slot 内执行同步 File adapter `emit`。」）经前置门禁冲突点 #3 钉死**扩展覆盖构造期**：reopen 全量交叉扫描（O(stream 总字节)）+ 修复截断全部同步，Host 必须在 slot 外构造 adapter；接线票 #149–#151/#155 验收核验；README/AGENTS 记载（§16 ALLOW LIST）。与 ADR-0011「adapter 慢、失败或队列满都不得延长 write slot 或阻塞 close/shutdown」、ADR-0008 单 sequencer 槽序一致——O(stream) 构造扫描若入 slot 将比单条 emit 更重地违反该条款，设计的接线门正确堵住。§12.2–4：构造失败终态只发事件不抛不改业务、无锁/无 queue/无常驻 fd（部署约束重申）、无新增后台任务（shutdown 不等日志）。运行期 append 模式零变化（§8.2 唯一新增调用点 `beforeCommit()` 在 emit 调用栈内、有界）。 | **no-conflict** |
| ④ | rotate 走既有 genesis 路径、resume 忽略 `genesisUpdateBytes` 的合规性 | §8.1 要点 / §8.3 / §13.13 | **合规**。rotate → `initNewGeneration()` 保留现状流程「segments mkdir → manifest `'wx'` → genesis → current.json」（§8.3 仅增量 17 键 + 段态清零）——ADR「每个新 stream 尽力先记录当前完整 Y.Doc 的 genesis baseline」义务履行（§13.13 锚定「新 generation 尽力 genesis」）。resume 不写 genesis：ADR 的 genesis 义务主体是**新 stream**；对续写中的既有 stream 中途插入 genesis 会伪造基线时点，与 ADR「其 genesis 只代表从该时点开始，不能伪称从 namespace 创建时起连续」的诚实纪律相逆——忽略并文档化（README）是正确方向。Host 需要新基线时应走显式 rotate（ADR「显式 rotate/reset 时建立新 stream」），该配置面归接线票（简报范围排除），非本票缺口。 | **no-conflict** |
| ⑤ | +2 健康事件成员（`stream-tail-repaired`/`stream-generation-rotated`）与 +2 reason 扩值逐字段满足 observer 数据纪律 | §10（D7/§10.1–10.3） | **逐字段通过**。对照 ADR-0012「observer只包含稳定 code……与 projected record byte size；不包含原 record、input、Base64、update bytes、底层 message、Error/cause或stack」+ ADR-0011「日志字段不得进入默认低基数 metrics label」：`repair`（3 值封闭枚举）/`cause`（7 值封闭枚举）＝稳定码 ✅；`truncatedBytes` ＝计数类数值（ADR observer 白名单含 projected record byte size 同类）✅；`'repair-io-failure'` 只携带枚举字面量、不携带底层错误对象/文本 ✅；不携带 record/input/bytes/message/stack ✅；streamId/segment/offset **刻意不进事件**（高/半高基数身份经 adapter 实例上下文可得）——比 ADR 低基数条款更保守 ✅；事件走既有 freezeEvent+safeNotify 隔离、不入 JSONL（无递归 health record）✅；事件总量有界（单次构造 ≤2 repair + 1 rotate/1 exhausted，无逐 record 洪泛）✅。`stream-tail-repaired` 是 ADR-0012「自动修复通过observer上报」强制要求的落实；`stream-generation-rotated` 是诚实可观测补充（ADR 不禁止）；reason 扩值沿 G3 扩值先例、#148 冻结面经本预授权路径裁决——本复审即该 ADR 对照，通过。 | **no-conflict** |
| ⑥ | 「可证明尾部」后缀性质判定与 ADR §打开与尾部恢复三类列表逐字对照 | §5（D3/D8/§5.1–5.5）/ §4.3 | **逐字对应、后缀性质落实**。C1 ↔「截断最终不完整 JSONL 行」：`J` 非空且末字节 ≠ `0x0A` ⇒ 末块为不完整行——**终止符证明**（writer 格式每行必以 `\n` 结束，ADR §JSONL record），与「内容恰好可 parse」无关，证据强于弱证据依赖；仅限 SegMax（`00000001` 文法下中间块不可能缺终止符），非最大段同形状 → corrupt ✅。C2 ↔「截断最终不完整 frame」：尾走停于 `p<\|B\|` 且尾块 `<25 字节`（可证非完整帧：帧最小 25 字节）或 `合法 25 字节头 + payload 越界` ✅。C3 ↔「截断完整但未被任何完整 JSONL record引用的尾部 orphan frames」：`Refs` 取自**全部**完整 JSONL 行（跨所有 segment）指向 SegMax 的引用，`[T,\|B\|)` 全为完整帧且恰落 EOF 的连续未引用后缀 ✅。后缀性质：T = max(被引用帧 end) 之后不得再有被引用帧；夹在引用帧之间/位于 T 之前的 orphan 不修复（§4.3 D-A1 终态＝reader-ok 惰性残渣，与 ADR「崩溃可能留下完整 orphan frame……符合 best-effort 语义」一致）✅。§5.2 不变量 S（被删区间不交任何完整行引用的帧区间、不删完整行）结构性成立 ✅。§5.3 全有或全无 ＝ ADR「以下情况不尝试修复中间数据……旧stream标为corrupt或incompatible并保持只读」的 stream 整体裁决 ✅。§5.4 未知 magic → corrupt、未知 frameVersion/payloadType/flags/reserved → incompatible（ADR 不修复清单逐项对应）；全设计无任何从 BIN 重建 JSONL 语义的机制（被否方案维持） ✅。 | **no-conflict** |
| ⑦ | 与 #152 R2 提交点纪律/definitive-ambiguous 分类的兼容宣称 | §6.2 / §8.2 / §11.1–11.2 | **兼容宣称成立（ADR 层核验）**。R2 纪律本身是 wiki/代码层档案（非 SA8 基准），但其 ADR 锚点逐项保持：`beforeCommit()` 位于 `candidateSequence()` 之前、滚动不消耗/不分配 sequence、gate 丢弃不触发滚动——与 ADR「writer 准备 append 时才分配 stream sequence」一致（§11.1 提交点纪律逐字保留；§8.2 `commitPrepared` 唯一新增调用点）；BIN-first、fresh-stat offset、无 queue/batch/fsync/常驻 fd、emit void 不抛全部不变（amendment 条款）。§11.2 跨进程 candidate 复用澄清合规：reopen 以磁盘可证明性重证——C1 未终止末行 ⇒ 该 sequence 可证从未完整持久化（reader §9.2 不锚定其身份）⇒ 分配给下一条 record 不产生重复 `(streamId, sequence)` 完整记录（ADR record 身份以完整 record 为前提；ADR-0012「进程在最终 emission 前终止时，该尝试可以完全缺失，属于 ADR 0011 的 best-effort 语义」许可）；完整行 ⇒ 锚定后继续。不变量 H（resume ⇔ reader ok）+ 共享扫描核心（`readStreamStrict` 行为零变化）防止「能续写 ⇔ 认健康」自相矛盾——落实而非削弱 reader 诚实性。 | **no-conflict** |

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted | record schema 冻结纪律（设计不改 schema/指纹，DENY LIST） | no-conflict |
| ADR-0002 | rewrite / authority 出范围 | accepted | 否 | no-conflict |
| ADR-0003 | 求值器与派生 schema | accepted | 否 | no-conflict |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 否 | no-conflict |
| ADR-0005 | 投影生成管线 | accepted | 否 | no-conflict |
| ADR-0006 | DocPersistence | accepted | 日志非 Persistence；snapshot 面零触碰（§16 包外不触） | no-conflict |
| ADR-0007 | logical validation / Runtime bridge | accepted；open/read 部分被 0008 取代 | 否 | no-conflict |
| ADR-0008 | Runtime write sequencer | accepted | write-slot 纪律依据（③通过） | no-conflict |
| ADR-0009 | Registry / Host lifecycle | accepted | 构造在 Host 装配路径（slot 外天然位置）；shutdown 不等日志（§12.4） | no-conflict |
| （0010） | trusted replication（被引用） | 文件不存在 | 否 | 不在基准内 |
| ADR-0011 | best-effort diagnostic log | accepted | 业务隔离/健康 observer/数据保护（②③⑤通过） | no-conflict |
| ADR-0012 | JSONL/framed-sidecar log（含 amendment） | accepted | 主规范：stream/generation、locator、滚动、耗尽、尾部恢复、门槛 7/8/9/10/12（①②④⑥⑦通过） | no-conflict |

## 冲突点

**无阻塞冲突**（hard-violation ×0 / override-declared ×0 / evolution ×0）。以下 4 条为设计精度观察（already 界定为 SA2 攻击面而非 ADR 冲突，登记供 SA2/SA6 参考）：

| # | 观察 | ADR 对照 | 定性 |
|---|---|---|---|
| O1 | §5.4 尾块 `<25 字节` 一律按 C2 截断：无论字节来源是撕裂帧头还是外部垃圾，该尾块可证「非完整帧（帧最小 25 字节）且无引用」——属「不完整最终 frame」授权类的可证实例；≥25 字节垃圾走 magic 检查 → corrupt。边界机器可证、两分支诚实。 | ADR「截断最终不完整 frame」授权范围内 | 非冲突；判定边界正确性属 SA2 |
| O2 | C2+C3 同范围合并为单一截断单一事件（终局证据类优先：有撕裂帧报 `bin-incomplete-frame`，全 orphan 报 `bin-orphan-frames`）。AC3「reporting each repair」以修复**动作**（截断）为粒度——一次截断一事件，kind 按终局证据诚实标注。 | ADR「自动修复通过observer上报」未规定粒度；两类均在授权截断集内 | 非冲突；粒度解读自洽，SA2/SA6 按 §13.10/11 锚定 |
| O3 | §9.2 `line-unterminated` 使 #152「无 `\n` 末块宽容 parse」收严为 corrupt：ADR「每行……并以 `\n` 结束」是格式要求；「崩溃可能留下……不完整 JSONL 尾行；这些均符合 best-effort 语义」许可其**存在**（非 writer 缺陷、不违反 best-effort），不要求 reader 判其健康。收严后 reader 与修复判定同一事实基础（不变量 H 必要条件）。 | 格式条款一致；诚实性方向正确 | 非冲突；属行为变更清单（§11.3）已列 |
| O4 | §4.2 将 `payloadMaxBytes`/`issuesPolicy` 归非冻结（不进 manifest）：payload 上限只影响新 record 是否被 omit，不影响已落 record 解释（record 自带 payloadLength/CRC 自描述）；issuesPolicy 是 emitter 侧投影策略。两键均不在 ADR 冻结清单，#152 manifest 亦无此键。 | 冻结/动态二分的第三态（两清单皆不收录）——前置门禁已确认两清单非穷举，不收录+不执行＝无执行面冲突 | 非冲突；若 SA2 认为需要冻结可另议，非 ADR 义务 |

## 结论

**Verdict `clear`，解除编码门禁（SA2 攻击评审 → SA6 红灯 → SA3 实现可继续）。**

- 前置门禁七条钉死语义（冲突点 #1–#7）经设计 §0 对照表、§2 D1–D8、§3–§12、§13 锚点逐条落实，本报告 ①–⑦ 逐条复核通过；
- 设计的全部新决策点（manifest 17 键、冻结面 +3、RotateCause 枚举、C1/C2/C3 判定式、双耗尽 latch、+2 事件 +2 reason、reader +2 码、构造期 write-slot 条件、滚动状态机）已追加登记至 `task_diagnostic-log-stream-roll-repair_relevant_decisions.md`「设计后复审追加」节，供 SA2/SA3/SA6/SA7 复用；
- 「无需 ADR 修订」宣称成立：`docs/adr/**` 零改动且无条款被改写；若后续任何轮次把耗尽改为新建 generation、把 targets 改为动态却不撤 §9.3 核查、或把修复判定扩出三类后缀集合，即触发本门禁重新裁决（hard-violation）。
