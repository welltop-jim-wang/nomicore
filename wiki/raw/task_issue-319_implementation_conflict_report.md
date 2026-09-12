# Issue #319 实现后冲突复查报告（SA8）

1. **Reviewed subject**: implementation（SA3 实现变更集：worktree `mabf/issue-319` @ HEAD `ff2dc64` 未提交 diff——6 modified + 2 新建测试；对照 SA1 设计迭代 1、SA2 迭代 1 approve、SA6 契约 approve、前序 SA8 前置门禁 verdict `clear` / `requiresConflictRecheck=true` 的三项复查义务 (a)(b)(c)）

2. **Inputs and decision set**
   - 输入：任务简报 `wiki/raw/task_issue-319.md`；设计 `wiki/raw/task_issue-319_design.md`（迭代 1，SA2 approve）；`wiki/raw/task_issue-319_sa2_review.md`（approve，F1/F2 已闭合，O1–O6）；`wiki/raw/task_issue-319_sa6_contract.md`（approve）；`wiki/raw/task_issue-319_sa3_impl.md`；`wiki/raw/task_issue-319_sa4_review.md`（approve）；**SA9 产物不存在**（本任务 artifact 集无 SA9——无额外标准面输入）。实际 diff：`git status --porcelain` + `git diff --numstat` + 六文件全量 diff + 两枚新测试全文抽核（本复查独立执行）。
   - 决策集：`CONTEXT.md` + `docs/adr/**`（0001–0018、0021，全部 accepted、无 superseded 在集）+ 规范文本（`docs/vfsl/v1-spec.md`、`docs/protocols/`）+ 模块 `AGENTS.md` 明确收录决策。**ADR 0020 仍不在决策集**（`docs/adr/` 无 0020 文件——int/range 与文本侧条款依旧无约束对象，边界纪律前提不变）。
   - Issue #319 REST 评论：读取成功且为空数组——无 Owner 评论要求、无评论级 override（与简报 L31–32、SA6 §2、SA8 前置 §4、设计 §4、SA2 §4、SA3、SA4 七方一致）。
   - 摘录依据：`wiki/raw/task_issue-319_relevant_decisions.md`（前置门禁产物，条款定位经本复查对当前文件复核仍准确）。

3. **Decision analysis**

   | Decision | Clause | Subject behavior（实际 diff） | Classification | Evidence | Required action |
   | --- | --- | --- | --- | --- | --- |
   | ADR 0021 决策 1 | 判定公式 `typeof === 'number' && Number.isFinite && !Object.is(v,-0)`（L39–51） | `isJsonFaithfulNumber`（validate.ts L174–176）逐字落地公式；经 `scalarAccepts`（L190–196）供 `validateValue`（L506）与 `contradictsInner`（L372）**双判定点同步消费**（D-B「both」形态）；string/boolean/null/unknown 分支逐分支等价（diff 前 `unknown→true / null→value===null / typeof` 三分支被等价吸收） | **implements-existing-decision**（闭合） | `git diff packages/vfsl/src/validate.ts`（本复查逐行核对）；0021 L43–45 | 无 |
   | ADR 0021 决策 1（实现义务侧） | 「number 判定」收窄后的 memo 正确性 | `memoKey` 归一化（L67–69）+ 哨兵 `NEG_ZERO_MEMO_KEY`（L64，模块级不可变常量）覆盖**恰三触点**：countIssues 读 L338、contradicts 读 L361、memoStore 写 L429——消除 SameValueZero `-0≡0` 共键导致的「-0 静默接受 / 0 伪报」；grep 全文件无第四处值键 `.get(value)/.set(value` 残留 | **implements-existing-decision**（决策 1 忠实实现的必要内部正确性项；模块局部、零公共面/零冻结面变化，SA2 approve 的 D-C 设计在案） | validate.ts L64–69/L338/L361/L429；SA2 §6 D-C 行 | 无 |
   | ADR 0021 决策 3 | typeof 失配维持既有消息；四值给「期望 number（有限数且非 -0），实际 NaN/Infinity/-Infinity/-0」；-0 经 `Object.is` 识别；validate 与 validate-patch 同口径；文案不进冻结面（L65–73） | `scalarRejectMessage`（L199–205）：通用分支模板 `类型不匹配：期望 ${type}，实际 ${jsonTypeOf(value)}` 与旧 L462 **逐字节相同**（本复查比对 diff 删除行与新增行）；四值分支 `期望 number（有限数且非 -0），实际 ${renderNumberValue(value)}`，`renderNumberValue`（L180–188）以 `Object.is(v,-0)` 先于 String 回落（-0 不显示为 "0"）；同口径由 `validate-patch.ts` **零 diff** + 共享 `validateSubtree` 结构达成 | **implements-existing-decision**（闭合，复查项 (a)） | validate.ts diff；`git status` 证实 validate-patch.ts 未触碰；0021 L65–73 | 无 |
   | ADR 0021 决策 4 | §8 增补「语义收窄例外」条款，条款全文在 ADR 中给出（L75–85） | `docs/vfsl/v1-spec.md` §8 L469–472 插入：引导行（结构标签 + 「首例 = ADR 0021，issue #312」事实陈述，指向裁决权威源）+ 条款正文与 ADR L80–83 **逐字一致**（仅 blockquote 换行合并，语义零变化）；插入点 = 规则 3（L467）后、「对历史文本的解释」段（L473）前；三条既有规则、「只增不改」表述、解释段、`version` 全部逐字未动；`git diff --check` exit 0 | **implements-existing-decision**（闭合，复查项 (b)——override 已落文且与代码同变更集） | v1-spec diff +4/−0；0021 L80–83 逐字比对（本复查执行） | 无 |
   | ADR 0021 决策 5 | 不侦察、不迁移、不自动修复；存量 loud 失败（L87–92） | diff 无任何迁移/扫描/修复工具文件（untracked 仅两枚测试 + wiki 报告）；既有 3 处把旧四值语义编码为「构造失败支路前置」的 doc-runtime 测试断言按设计 D-H **用例级迁移**到新失败面（① 逻辑校验拒）：C-7 迁出 RAC-2 + R2b 新逻辑失败用例；G3 L486 前置翻转 + 收窄消息锚；G5 L630 前置翻转 + mat/rep 等价锚保留——**不放宽任何拒绝**（三用例仍断言 ok:false）、**不删除覆盖**（构造域支路由 C-3/C-4a/C-4b unknown 位行结构性保留） | **implements-existing-decision**（决策 5 breaking 姿势的测试侧后果收编，闭合） | 两测试文件 diff 逐行核对；设计 §7 D-H 裁决；SA2 F1 验收；0021 L87–92 | 无 |
   | ADR 0021 决策 6 | IR / derived 两树 / codegen 生成物 / 语义指纹零影响（L96–97） | `git status --porcelain` 全量：codegen/生成物/fixtures/`pnpm-lock.yaml`/`packages/vfsl-codegen`/`domains`/`apps` **零 diff**；vfsl src 改动收敛于 `validate.ts` 单文件（+56/−10），parser/tokenizer/evaluate/derived/schema-envelope 未触碰；`index.ts` 零改动（公共 API 面不变） | no-conflict（锁定兑现，复查项 (c)） | git status/numstat；validate.ts 为唯一 vfsl src 改动 | 无 |
   | ADR 0021 决策 7 | 观测降级/出口腐化对合法写入结构性闭合；种子/直构面排除（L99–105） | T2 新测试 `write-path-number-domain-closure.test.ts`（changelog 包，经 `@nomicore/vfsl` workspace 依赖 + 本包 `testing.js`/helpers——依赖方向正确）锁定闭合不变量；changelog `src/**` 零 diff（record schema/JSONL 不动）；`persistence/**`、`extract.ts`/`detached-build.ts` 消费侧守卫零 diff（种子/直构面排除保持） | **implements-existing-decision**（闭合锁定测试落地） | 新测试文件抽核；git status；0021 L99–105 | 无 |
   | ADR 0021 Consequences L133–134 | 无新增错误码（四值拒绝走 validate 消息） | 全 diff grep `^+.*VFSL-E`：唯一命中为新测试的**负向断言** `expect(message.startsWith('VFSL-E100')).toBe(false)`——非新码；四值拒绝经既有 `ctx.emit` 消息通道 | no-conflict | diff grep；validate.ts L506–509 emit 结构 | 无 |
   | ADR 0008 | L25「plain subtree 仅允许 JSON-compatible plain value」；snapshotter 只接受 finite number | 收窄使执行值域对齐声明值域（§8 条款 (a) 项的落地基础——ADR 0008 实际文本在场，本复核确认）；写路径快照面（namespace-runtime S3）零改动 | **implements-existing-decision** | ADR 0008 声明段（本复查复读）；§8 条款 (a)；git status namespace-runtime 零 diff | 无 |
   | ADR 0007（issue #237 修订节） | 校验拓扑：路径级/边界级 + validateLogicalSnapshot 完整校验 | 双路径同口径在既有 `validateSubtree` 拓扑内达成，零拓扑改动、零零写入管线改动 | no-conflict | validate-patch.ts 零 diff；mutation-local.ts 零 diff | 无 |
   | ADR 0010 R2-4 | SameValue 判据（-0≠0）；契约外形态仅种子/直构面 | 判据代码零触碰；四值对合法写入结构性不可达后兜底姿势与决策 7 同构 | no-conflict | 0010 L273；相关文件零 diff | 无 |
   | ADR 0014 / ADR 0017 | changelog record schema / JSONL 不动；指纹输入为兼容行为 | changelog `src/**` 与 `input-capture.test.ts` 零 diff；指纹相关代码路径零触碰 | no-conflict | git status；0021 决策 6/7 | 无 |
   | packages/vfsl/AGENTS.md | 错误码 / issue 顺序 / 路径报告 / 信封严格性 / 指纹输入 = 兼容行为；公共 API 只经 `src/index.ts` | 新符号（六辅助 + 哨兵常量）全模块局部、无导出；emit 锚位仍为 scalar 分支单一 `ctx.emit([...path], thunk)`（L506–509，消息构造留 thunk 内——R4 门控）；遍历序/单条量/计费常量（ISSUE_LIMIT/WORK_LIMIT/MEMO_CAP）不变；`index.ts` 零改动；`jsonTypeOf`（L153）/`preview`（L218）/`enumContains`（L211）逐字未动 | no-conflict（实现期核对义务全部兑现） | validate.ts diff hunk 边界（无这些符号的改动 hunk）；AGENTS.md Boundaries | 无 |
   | docs/AGENTS.md | 「行为变更须同步修订 stated contract 变化的规范文档」；「链接权威源而非复制」 | §8 例外条款与代码同变更集（单一未提交 diff 同时含两者）；两处失准注释（`materialize.ts` L128 / `replace.ts` L120「① 逻辑校验（值域宽域）」→「number 值域经 ADR 0021 收窄」，各 1 行 comment-only，零代码语义——「旧引用已更新」义务兑现）；§8 条款正文为 ADR 0021 决策 4 自身给出的落地文本且引导行显式链接 ADR/issue——复制来自 ADR 的明示指令，非擅自多文档复制 | no-conflict | materialize.ts/replace.ts diff（各 ±1）；docs/AGENTS.md | 无 |
   | 排除面纪律（前置 SA8 §8-R3；0021 决策 2 依赖的 0020 缺席） | 文本侧 -0 E100 / int/range / seed/直构面收窄均不得顺带落地 | parser/tokenizer/evaluate/derived 零 diff（`-0` 字面量维持现状 E100、`int/range` 维持 E301）；无任何 int/range 判定代码；persistence/extract/detached-build 零 diff；T1-AC7 负控锁现状 | no-conflict（override 未扩大） | git status；新测试 AC7 块（L416/L423 断言 E100/E301 现状） | 无 |

4. **Overrides**
   - | Old decision | Override authority | Scope | New obligation |
     | --- | --- | --- | --- |
     | v1-spec §8「只增不改」（语义不改条款） | ADR 0021 决策 4（accepted；issue #312 owner 裁决，ADR 文本 (c) 项记载） | number 家族运行时值域收窄为 JSON 可忠实表示数（本变更集仅裸 `number`） | **已兑现**：§8 例外条款 L469–472 落文（逐字）；**override 未扩大**——int/range、文本侧 -0 E100、ADR 0020 保留名条款均未引入（0020 仍不在决策集） |
     | （记录性，惰性）ADR 0020 决策 9 supersede / 决策 3 修订 | ADR 0021（accepted） | int/range 三形态基线与 -0 字面量翻转 | 0020 依旧不在决策集；本 diff 未引用 0020 作为依据或义务 |
   - Owner 评论 override：无（评论空数组）。

5. **Frozen surfaces**（逐项核对实际 diff——复查项 (c)）

   | Surface | Must remain unchanged | Evidence | Actual result |
   | --- | --- | --- | --- |
   | 语义指纹（`sha256:v1:`）与既有 fixture 指纹 | 逐字节不变 | 0021 决策 6；ADR 0017；task L24 | **零 diff**——codegen/生成物/fixtures 无任何改动（git status 全量）；指纹 KAT 所在既有测试未触碰 |
   | IR 形状 / derived 两树 / codegen 生成物 | 零改动 | 0021 决策 6 | **零 diff**——vfsl src 改动仅 `validate.ts`（运行时判定），parser/evaluate/derived/schema-envelope 未触碰 |
   | 错误码集合 | 无新增码；四值拒绝走 validate 消息 | 0021 L133–134 | **无新码**——diff 中唯一 `+VFSL-E` 为新测试负向断言；四值消息非 `VFSL-Exxx` 形态并经测试锁定 |
   | issue 顺序与路径报告锚位 / emit 结构 | 不变（新消息在原 emit 位发出、thunk 门控、单条量） | packages/vfsl/AGENTS.md | **保持**——validateValue scalar 分支仍为单一 `ctx.emit([...path], thunk)`（L506–509）；遍历序与计费常量不变 |
   | 公共 API 面（`src/index.ts`） | 不新增 | packages/vfsl/AGENTS.md | **零改动**（git status）；新符号全模块局部；T1-AC6 以 `Object.keys(pkg)` 负向锁定 |
   | 复制 wire / Yjs 二进制载体 | 不动 | 0021 背景；ADR 0010 | **零 diff**（ws-replication 相关文件未触碰） |
   | changelog record schema / JSONL 格式 | 不动（仅可达性变化 + 锁定测试） | ADR 0014；0021 决策 7 | **src 零 diff**；`input-capture.test.ts` 原样未触碰；T2 为纯新增测试 |
   | validate 失败零写入管线 | 收窄经同一管线拒绝，无旁路 | CONTEXT.md「零写入」；ADR 0007 | **保持**——`{kind:'fail'}` 通道、mutation-local/namespace-runtime 零改动；迁移后 doc-runtime 用例保留 0 update + state 字节不变双证 |
   | v1-spec §8 既有三条规则 / 解释段 / `version` | 逐字不动 | 设计 D-E「只增不改」 | **逐字未动**（diff 上下文行核对）；+4 行全部为新增例外条款 |
   | `jsonTypeOf` / `preview` / `enumContains` / 计费常量 | 不动（兼容行为面 / D-G 枚举排除） | packages/vfsl/AGENTS.md；设计 D-G | **逐字未动**（无对应 hunk） |

6. **Evolution requirements**
   - 前置门禁唯一 evolution-required 项（v1-spec §8「语义收窄例外」条款）**已随本变更集执行完毕并核对闭合**：条款在场（L469–472）、与 ADR 0021 决策 4 逐字一致、与代码同变更集（同一未提交 diff）、override 未扩大（仅裸 number）、旧矛盾引用已更新（spec 缺口消除 + 两处源注释更正）。无未决 evolution-required 项。
   - 修订计划七要素复核（随实现兑现状态）：修订文件 ✅（已落文）；新旧语义 ✅（决策 1+3 已实现并经 T1 锁定）；兼容与迁移 ✅（决策 5 loud 失败姿势，无工具引入，发版说明 breaking 为运营 follow-up）；失败语义 ✅（双路径同口径 + 四值细分消息）；版本 ✅（无新码、`version` 不升）；验证 ✅（T1/T2 63 用例 + 全仓套件，SA3 报告声称绿、SA4 静态复核自洽——动态结果属 SA4/SA7 面，非冲突门禁判据）；冻结面 ✅（见 §5，全部零 diff）。

7. **Hard conflicts**
   - 无。实现与在集全部决策兼容；唯一触碰冻结纪律的语义收窄已有 accepted ADR 0021 的合法 override，且 override 文本已按裁决落文；diff 未触碰任何 DENY 面、未扩大 override、未引入新决策面（memo 哨兵键为模块局部实现细节，无 wire/schema/持久化/API/状态机面）。

8. **Required actions**
   - 无阻塞项。两项非阻塞记录：
     1. （非阻塞，已知在案）ADR 0021 引「ADR 0008 L31」实为 L25 的行号偏差随「逐字落文」要求传播至 §8 条款（SA2 O2 / SA4 O4 已记录）——本复查确认 ADR 0008 实际文本在场且语义指称正确，属未来 ADR 勘误项，不构成决策间冲突。
     2. （非阻塞）D-H 迁移注释为 3 行而非规格的「一行」、另有两处测试头注同步（SA2 O1 授权的「用例级修订合理延伸」）——comment-only 且限 ALLOW 两测试文件内，SA4 O2 已知悉；无契约面影响。

9. **Verdict**: **clear**
   - 前置门禁三项复查义务全部闭合：(a) 失败/消息语义——公式、双判定点、消息分支、emit 锚位、兼容面逐字节保持均经实际 diff 核实；(b) §8 例外条款——在场、逐字、同变更集、override 未扩大、旧引用已更新；(c) 冻结面与排除面——实际 diff 恰为枚举变更集（`validate.ts` +56/−10、两枚新测试、v1-spec +4/−0、两 doc-runtime 测试用例级修订 +48/−4 与 +22/−8、两注释行各 ±1），DENY 全未触碰。全部对照项为 no-conflict 或 implements-existing-decision；无 hard-conflict、无缺失裁决权威、无证据不足。

10. **requiresConflictRecheck**: **false**
    - 实现后复查已闭合：失败语义、正式 override 落文、冻结面 diff 三项均经本报告核对完毕；无公共 API / wire / schema / 持久化 / 状态机 / 生命周期 / 失败语义面尚待实现核对，无未兑现的正式 override。后续 SA7 活链路验证属验证面接力，不构成新的冲突复查触发。
