# SA2 R2 复审报告 — issue #108 persistence typed errors（SA1 R1 修订闭合核验）

- **Date**: 2026-05-29（R2 会话）
- **被审对象**: `wiki/raw/task_persistence-typed-errors_design.md`（**R1 版，661 行**，头部标注 R1；文末 SA2 反馈回应表 8 行）
- **复审人**: SA2（对照本报告前版 `task_persistence-typed-errors_sa2_review.md` 的 A-1~A-8 逐条核验；**全部读修订原文 + 代码交叉验证，不采信 SA1 声称**）
- **环境核对**: worktree 已 rebase 至 `ba1b6b4`（新增 `4cfb804`/`ba1b6b4` 两提交）；`git log -- packages/persistence` 亲证 persistence 包最后触达仍为 `279d3ba` ⇒ R1 评审期的全部源码亲读（lifecycle/memory/file/testing/contract/index/service + 各测试 + probe/profile）**仍然有效**，仅 namespace-runtime 有无关变更。
- **核验方法**: 逐条对照修订原文落点；对 A-1 的关键技术断言（EC10 构造确定性、§5.4.2 新构造的确定性与死锁、dispose「排空+清序」不变量、既有 L437/L461/L490 绿灯在方案 (a) 下的结局）**独立做微任务级 trace 推演**；对 A-3/A-4 的引用事实（插件工厂调用方清单、ADR 日期次序、SA8 冲突点 #1 原文）重新 grep 亲证。

## Verdict

# **PASS（附 6 条非驳回级注记，见「新发现」——均为措辞/引用级，须随 SA3/PR 顺手闭合，不构成复审驳回依据）**

一句话理由：**A-1~A-8 全部真闭合**。A-1 采纳了本评审推荐的方案 (a)（abort 门移至 io.write 入口、hook 之前），四维对照表、观察通道公理、EC10 公共面自洽锚、§5.4.2 确定性重构、dispose 不变量「排空+清序」重述、probe 观察通道显式声明六项连带修订**全部在文且经本人独立 trace 验证成立**；委托模型 committed 说谎窗口被结构性消除而非文档化合法化。其余七项均为收敛性落实且落点准确。

---

## A-1~A-8 逐条闭合核对表

### A-1（HIGH）— delegation 模型 committed:false 说谎窗口 → **CLOSED** ✅

| 要求项（R1 报告原文） | 修订落点 | 本人核验 |
|---|---|---|
| 显式二选一 + 四维对照表 | §3.5 新增：攻击复述 + **四维对照表（cause 形态/观察通道/dispose 不变量/§5.4.2 与 EC7 取舍）**+ 裁决理由；方案 (b) 被拒的理由准确（「把字段级说谎写进契约，恰是本 issue 要消灭的不诚实」） | ✅ 四维齐全，与本报告 R1 要求逐字对应；(b) 的否决理由复述了我的论点且无歪曲 |
| 方案 (a)：门移至 hook 前 | §4.3.1 代码块：`throwIfAborted()` 提首 → hook → mirror set，无第二道门 | ✅ 与本报告推荐形态逐字一致 |
| 连带①abort-during-hook ⇒ committed:true 诚实性论证 | §3.5 观察通道行 + §2.3 I-5 + §3.3 表第一行「双结局」 | ✅ **独立 trace 验证**：写已进入 → abort → hook 完成（共享 store 有字节）→ mirror set → write resolve → op 的 `assertCurrentEpoch` 落入「提交后段」（§4.2.4 三段式）→ `DocCreateFatalError('post-commit', committed:true)`；读权威（hook store）可读 ⇒ 事实一致。**窗口真消除** |
| 连带②memory.ts dispose 不变量重述 | §4.3.2 + §6.5：「排空+清序」——晚到 mirror set 发生在 `core.dispose()` 的 `allSettled(inFlight)` 返回之前，随后 `snapshots.clear()` 清除 | ✅ **独立验证机制成立**：io.write 仅两个调用方（create op 经 `this.track`、flush 经 `startFlush` 的 `track`）⇒ 每个写确在 tracked promise 内；dispose 同步置 `closed` 后 create/flush 的入口守卫使新写不可能启动 ⇒ 不存在晚于 `snapshots.clear()` 的 mirror 写。论证严密 |
| 连带③probe 观察通道声明 | §3.3 末段 + §6.8 注记：「abort 先于 io.write 进入的尝试不再到达 writeSnapshot hook——probe 从不在写中途 dispose（SA2 亲证），不可观察；已进入的写照常被观察」 | ✅ 显式声明而非沉默，且正确引用了本评审的亲证结论 |
| EC10（窗口消除的直接证据） | §5.3 EC10 + §5.3 fixture 接线注（共享套件 Memory fixture 即委托模型，EC1–EC8 在其上通过即证明窗口消除）+ §8 行 | ✅ **独立 trace 验证构造确定性**：`enteredResolve() → await gate` 的 hook 在入口门通过后进入；测试 `await entered → dispose()（不 await，同步段先 closed/epoch++/abort/cells.clear）→ release() → hook 完成 store.write → mirror set → resolve → post-commit W4`。微任务序确定（entered 门消除唯一时序依赖）；**无死锁**（dispose 未先 await——若先 await 会与 op 等 hook、hook 等 release 成环，设计时序正确）；`makeFresh().loadDoc` 非 null 与 `committed:true` 自洽；`doc.isDestroyed === false` 成立（creating cell 被 `cells.clear` 无销毁） |
| §5.4.2 cause 形态调整 | 改为「entered 门 + dispose 后显式 reject」确定性构造（自持 `writeAborted` 实例） | ✅ **独立验证**：①确定性——`await writeEnteredPromise` 保证入口门已过（原 `await tick()` 3 微拍在 (a) 下会与「门先于 hook reject」竞态，重构必要且理由陈述准确）；②无死锁——同 EC10 模式（dispose 不先 await）；③契约合规——hook 在副作用开始前 reject；④四条原断言全保持（DocCreateFatalError instanceof Error ✓）；⑤与 EC7（`signal.reason` AbortError）互补双锚，四处表述（§2.2 W3/§3.5/EC7/§5.4.2）一致 |
| 对 SA2 预判的处理 | §3.5 明确「SA2 预判二者将同构（均 AbortError）」并以 entered 门构造保住 identity 锚 | ✅ 对本报告预判的复述准确，回应有效（覆盖面确实更宽：identity + AbortError 两变体） |
| 既有绿灯复核 | §3.3 末段逐一：L437（hook abort-上-reject）/L461（resolve）/L490（dispose during flush resolve） | ✅ **独立 trace 三条全过**：L437 门已过 → hook reject → catch stale 早退（同 R0 结局）；L461/L490 hook 完成 + mirror set → resolve → **try 段** stale 早退（结局同为 timers 0/status disposed/savedGeneration 不推进，晚到 mirror set 被排空+清序清除）；probe 的 flush 失败注入（hook throw，门已过）结局不变 |

**A-1 附带核验（R1 未明列但属 (a) 连带面）**：File 在 (a) 下零改动且其「入口门 + rename 运行至完成」结构与新公理天然一致；File 的 gate-3（writeFile 后、rename 前）reject 点 leaves `.snapshot` 不变 ⇒ 公理（reject ⟹ 基准 store 未被本次 write 改变）成立，两 Adapter 门位不对称不违反公理（公理只约束 resolve/reject 的真值，不约束门数）。✅

### A-2（MEDIUM）— 分类表完备性 → **CLOSED** ✅

- §2.1 新增 L5（loadSlowPath L277 `assertReadable` 出口，与代码行号亲证一致）/ L6（适配器层 validateIdentity/构造 TypeError；file 测试 L305–L327、L49–L51 引用与亲读吻合）/ L7（同步 throw 理论逃逸）三行，分类均为「保持裸传/契约封死」，零代码变更——与本报告要求完全一致。
- §3.1 bullet 3 增「**PersistenceIO 方法不得同步 throw，一切失败必须经 returned Promise 拒绝**」，§4.2.1/§8 lifecycle 行同步注明；L7 行明确违反属 seam 违约并与 §1.2 边界声明（A-5）衔接。✅

### A-3（MEDIUM）— wrapIo 泄入生产插件工厂 → **CLOSED** ✅

- §3.4 bullet + §4.3.5 + §4.4.2 + §6.10：两工厂 options 改 `Omit<…,'scheduler' | 'wrapIo'>`（一行级）；§10 新增「插件工厂 options 类型」通道行 + 调用方 caller 行；提供可选 SA6 typecheck 静态锚。
- **事实核验**：重新 grep 全部工厂调用方（core-dsh-boundary.test.ts L44/L45/L64/L71/L78、file-persistence.test.ts L394、profile.ts L59/L75）——**均不传 wrapIo** ⇒ `Omit` 收紧零破坏，主张成立。profile 只传 schedule/memoryIo ✓ 兼容。✅（caller 行里 memory 侧行号有误，见 N-4 注记，不影响主张）

### A-4（MEDIUM）— ADR-0006 #64「原样上抛」张力 → **CLOSED** ✅

- §7 R-5 重写：点名该句、给出取代权威（ADR-0009 §Persistence 错误演进 L72–L83）、「原样」意图载体（`error.cause` exact identity，AC7 `toBe` 级锁定，不重抛/不改写/不拼接）、#64 其余条款逐字有效、PR 描述必须点名。
- **事实核验**：ADR-0009 头部日期 **2026-08-25**，ADR-0006 修订节 **2026-08-21/08-22** ⇒「晚于 0006 全部修订节」**属实**；SA8 gate 冲突点 #1 原文亲读确系该裁决（「唯一字面张力…属于 ADR-0009 已明文授权的契约演进，非真矛盾」），引用无歪曲。✅

### A-5（MEDIUM）— W2 边界进类型 doc → **CLOSED** ✅

§1.2 `DocCreateOperationalError` doc 追加 Boundary 段（信任 seam 契约、(c) 复核已否、seam 违约 ⇒ adapter bug 而非伪降级、AC6 以契约守恒而非机制）；§2.2 W2 行互指 §1.2/§3.1，§3.1 seam 违约定义（①部分提交后 reject ②同步 throw）互指 §1.2——**双向互指闭合**。✅

### A-6（MINOR）— 草图 entered() 矛盾 → **CLOSED** ✅

§5.3 内部 `armHold(): { enteredResolve(): void; gate; release; hold }`，草图统一改调 `enteredResolve()`；公开面维持 `PersistenceHold.entered: Promise<void>`；§5.1 W4/W5 行同步。形态自洽，可照抄编译。✅

### A-7（MINOR）— 冻结映射导出/基类代价 → **CLOSED** ✅

§1.3 `export const DOC_CREATE_FATAL_PHASE_COMMITTED`（doc 注明 R1/A-7）+ §1.5/§4.1/§8（index +7）+ §1.4「无共享基类代价登记」段（枚举 4 类或判 code 前缀；届时加中间基类属 additive 重构）。双管齐下。✅

### A-8（MINOR）— 规模估算 → **CLOSED** ✅

§4.6 与 §8 均改 **+≈250–300**/−≈15 并注明依据。✅

**闭合计数：8/8。**

---

## 新发现（R2；均非驳回级——不改行为、不改范围、不改测试结局，但须随 SA3/PR 顺手闭合）

| # | 级别 | 位置 | 问题 | 修订要求 |
|---|---|---|---|---|
| N-1 | MEDIUM（注记） | §6.6 | 「`wrapIo` 不传时两 Adapter **与现状不可区分**」在 R1 下成为陈旧/歧义表述：Memory 的 abort 语义**本就因本设计而变**（门移位是 §4.3.1 的核心变更），与「不可区分」字面自相矛盾。§6 是 SA4/SA7 的**回归基线**章节，此句可能触发 SA4 误报冲突、或被 SA3 误引为「不动门」的依据 | 改为「不传 wrapIo ⇒ io 装配走默认实现（该选项零行为增量；Memory 默认实现的 abort 语义变化见 §4.3/§3.5）」。在 SA4/SA7 任务传递中明确：§4.3 + §3.3 末段 bullet 为权威，§6.6 该短语以本注记为准 |
| N-2 | MINOR | §3.3 表第 3 行（flush）+ §10 flush 行 | 表列头「新语义（aborted ⇒ write reject）」与「resolve→try-早退 vs reject→catch-早退」二元框架是 R0 遗留：方案 (a) 下实为**三种**结局（入口门 reject / 已进入后 hook reject / 已进入后运行至完成 resolve）。紧随其后的 bullet（L461/L490 复核）已把 resolve 情形补全且结论正确，但表格与 §10 行单独读时不完备 | 表列头改「abort ⇒ 入口门 reject 或（已进入）运行至完成 resolve」；两处补一句「见下方 bullet 的三情形复核」 |
| N-3 | MINOR | §4.3.2 | 注释重写清单只列了「类 doc 与 dispose 处注释」；memory.ts **io 闭包内联注释 L50–L55**（「the commit segment (mirror set) sits after the aborted-signal guard」）在 (a) 下变假（提交段 = hook 副作用 + mirror set，门在入口）——亲证该注释现存于代码 | §4.3.2 清单补第三处：io 闭包注释同步改写（顺带「Byte-order and await-depth identical…」句复核——await 深度不变，语义句需更新） |
| N-4 | MINOR | §10 插件工厂 caller 行 | 行号引用「memory-persistence.test.ts L116」有误——亲证 L116 是 `Y.encodeStateAsUpdate(persisted)`；memory 侧工厂调用方实为 core-dsh-boundary.test.ts L44/L64/L71（该行已另行正确引用）。**主张本身（零调用方传 wrapIo）不受影响** | 删去 memory L116 引用或改为 core-dsh-boundary.test.ts L44/L64/L71 |
| N-5 | TRIVIAL | 设计头注 | 「基线 HEAD 279d3ba」已过时（rebase 后实际 HEAD `ba1b6b4`；亲证 persistence 包未触达、两新提交仅 namespace-runtime，与本设计无关） | 头注更新为 ba1b6b4 或加一行 rebase 说明（总控已核对，登记即可） |
| N-6 | MINOR | §5.3 wrap.write 草图注释 | 「否则 Memory fixture 的 flat hook 会在内层**入口门**拒绝之前先把字节写进共享 store」是 R0 世界的推理——(a) 下内层入口门在 hook **之前**，该情形结构性不可能；wrap 的 `throwIfAborted()` 自查变为冗余防御（保留无害，且对任意被包装 io 仍是自洽契约保证） | 注释理由改写为「wrap 自身维持 PersistenceIO 契约的自查（对任意内层 io 形状成立；对当前两 Adapter 内层门已覆盖此情形）」，防 SA3 把陈旧推理抄进 testing.ts 注释 |

**为何不据此驳回**：N-1~N-6 全部是文档一致性/引用级修正，无一条改变代码行为、文件范围、测试构造或分类结果；§4（变更规格）作为实现权威在所有歧义点上都明确无歧义（§4.3.1 代码块逐字给出门位）；且本管线对注记级要求的执行记录良好（R1 的三条 MINOR A-6/A-7/A-8 均被逐条落实）。为单句措辞再次驳回属「为挑刺而挑刺」。**条件：N-1~N-6 须在 SA3 动工前或随首个实现 commit 由 SA1 闭合（每条一行级），SA4 静态门禁应核对这些注记已消。**

---

## 复审方法学附记（供 SA4/SA7 复核用）

1. **A-1 的三处独立 trace**（EC10、§5.4.2、L461/L490 既有绿灯）均以当前 worktree 的 lifecycle.ts/memory.ts 实际代码为底本做微任务序推演，结论与设计 §3.3/§3.5/§5.3/§5.4.2 的声称一致；SA7 动态阶段应以 EC5/EC7/EC10/§5.4.2 四用例实测复核。
2. **「排空+清序」不变量**（§6.5）的机制前提（io.write 仅 create op 与 flush 两个调用方、均经 `track`）在当前代码成立；若 SA3 实现引入新的 io.write 调用点，该不变量须重新论证——建议 SA4 把「io.write 调用点数 = 2 且均 tracked」列为静态检查项。
3. rebase 影响面：`git log -- packages/persistence` 止于 279d3ba ⇒ 本设计与 R1 评审的全部代码引用仍然有效；namespace-runtime 两新提交（#116 seam + 测试 scheduler）不触及 persistence 消费面（§10 caller 清单未变，亲证 grep）。

## 结论

**PASS。** A-1 的方案 (a) 落地完整、六项连带修订齐备且经独立验证；A-2~A-8 收敛性闭合无遗漏。N-1~N-6 六条注记（1 MEDIUM-note + 4 MINOR + 1 TRIVIAL）随 SA3/PR 一行级闭合即可，不构成本次驳回依据。设计可进入 SA3 TDD 实现；pass 不替代 SA4 静态与 SA7 动态对实现与活链路的验证（尤其 EC10、§5.4.2 重构、§6.5 排空+清序不变量三点须实测锚定）。
