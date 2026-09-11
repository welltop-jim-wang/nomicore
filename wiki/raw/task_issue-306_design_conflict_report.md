# SA8 设计后冲突复审报告 — issue #306（M4 联合成员文档注释）

- **Dispatch**: sa-28769d9f-1716-41b5-8a66-2afa334b3fc7（mabf-sa8 / conflict-gate / iteration 1）
- **审查对象**: SA1 设计产物 `wiki/raw/task_issue-306_design.md`（dispatch sa-aba44c9b…，iteration 0，HEAD `91c4add`）——设计自报 `requiresConflictRecheck: true`（§14），本报告即该复查。
- **基准（baseline）**: ADR 全集（docs/adr/ 0001–0019，无一被取代；0019 为最新、已接受、未被取代）+ CONTEXT.md + 规范规格 `docs/vfsl/v1-spec.md`（§4/§5/§8/§10）+ `packages/vfsl/AGENTS.md`（规定 CONTEXT/v1-spec/ADR 0001/0003/0007/0016 为规范来源）。代码仅作可行性佐证（设计机制主张逐锚点复核），不构成阻塞依据；`wiki/raw/` 其余产物是证据非规范（docs/AGENTS.md）。
- **复审焦点（按 dispatch）**: parser 附着/回收、IR 与 derived 变更、校验边界、兼容路径。
- **Owner feedback**: issue #306 无适用评论（REST 评论空数组；前置门禁与设计 §4 均复核一致）。
- **流程备注**: 会话技能目录无 `sa8-conflict-gate` 技能（加载报 unknown）；按系统角色定义执行：只读、基准仅 ADR + CONTEXT.md + 规范规格、唯一产出为本报告（补齐设计 §6 指出的固定位置产物缺席——本文件即 `task_issue-306_design_conflict_report.md`）。

## 一、总裁决

**verdict: clear（设计后复审通过：无阻塞冲突，设计无需修订；`requiresConflictRecheck` 就此消解为 false）。**

裁决分布：**阻塞冲突 0 项；授权中的规范修订 1 项（承自前置门禁，排期依赖边经本轮独立复核成立）；逐条一致性确认 14 项（§二矩阵）；非阻塞观察 6 项（§四 O-1~O-6，均已有归属票或属实现注意）；前置门禁约束 C-1~C-6 全部经设计落实且映射核实（§五）。**

核心结论：设计是 ADR 0019 决策 1–5/8/9/10 的忠实机制化，四条复审焦点（附着/回收、IR/derived、校验边界、兼容）全部落在授权面内；设计自报的复查理由（公共类型面加性变化、指纹语义面、`evaluate` 失败语义扩展、ADR 0003 冻结条款修订）逐条核对均有 ADR 0019 显式授权条款承接，无越权项、无静默矛盾。

## 二、逐条裁决矩阵（设计决策 × 基准条款）

| # | 设计决策 | 基准条款 | 裁决 | 复核说明（含代码锚点核验） |
|---|---|---|---|---|
| 1 | D1 附着点 A（`\|` 记号锚：doc 紧邻 `\|` 前挂后继成员；含首前导与成员分隔 `\|`） | ADR 0019 决策 1 第 1 子句 | ✅ 一致 | 子规则逐字对齐。tokenizer pending→leadDocs 机制零改动（决策 10）；`next()` 只追加尾部（parser.ts:141-146），A 锚记录「尾部 depositedByLast 条」的区间与引用，正确。 |
| 2 | D1 附着点 B（首成员无前导 `\|` 时锚成员起始记号） | ADR 0019 决策 1 第 2 子句 | ✅ 一致（附 O-1） | `start: dangling.length`（消费前快照）＋ `leads: peeked.leadDocs`——该 token 的 doc 恰沉积于 `[start, start+len)`，与决策 4「记录区间与 DocLead 引用」等价（实现细节注记，非偏离）。成员起始记号为标记名时由 M3 抢先，见 #5。 |
| 3 | D1 连续多条 doc 按序同挂一成员 | ADR 0019 决策 1 第 3 子句 | ✅ 一致 | pending 累积天然保序（tokenizer.ts:72-82）；契约用例 4 锚定逐字序。 |
| 4 | D1 `\|` 夹缝 doc 不属 M4：非标记成员 E305 维持 | ADR 0019 决策 1 第 4 子句；决策 9.2 | ✅ 一致 | A/B 两锚只认 `\|`/成员起始两类记号的 leadDocs；夹缝 doc 挂在成员起始记号上、不入任何 pending → 留 dangling → E305（现行行为，semantic.ts:71-83）。 |
| 5 | D1/D2 同一性核对 → M3 优先、不双挂；坍缩不结算 → E305 | ADR 0019 决策 2/3/4（机制段） | ✅ 一致 | 「记录位置 + 终局核对、≥2 成员、按成员逆序、引用同一性核对、核对失败=已被 M3 等内部锚位回收、坍缩整条不回收」——决策 4 机制段逐要素在场。M1/M2/M3 回收点均为「紧跟锚记号 next()」无延迟窗口（parser.ts:209/434/522 逐点核实），M4 结算（union 出口）不与任何 claimDocs 窗口竞争；被 M3 整段取走的 leads 必失配（claimDocs 整取 depositedByLast 条，无部分取走），无双挂路径。坍缩两形态维持 E305 逐字节（决策 2）。 |
| 6 | D1 嵌套联合结算次序论证 | ADR 0019 决策 4 机制段（无冲突推论） | ✅ 一致（附 O-2） | 沉积只追加 ⇒ 记录区间按记录时序单调递增；内层 union 在成员解析内结算（先于外层后续 pending 的记录）；逆序结算使先结算者不触及更低下标。论证成立，非 ADR 违反。 |
| 7 | D2 AST union 恒携带必填 `memberDocs: string[][]`（等长） | ADR 0019 决策 4 第 2 段 | ✅ 一致 | 逐字对齐；AST 内部结构非公共契约（packages/vfsl/AGENTS.md；index.ts 不导出 AstType），唯一构造点 parseUnionType，消费方只读 kind/members（§2.3 已核）。 |
| 8 | D3 IR 条件键 `memberDocs?: string[][]`（some(non-empty) 才在场；键序 kind→members→memberDocs；指纹纪律注入 ir.ts） | ADR 0019 决策 4 第 1 段 + 后果节 | ✅ 一致 | 条件附加为强制项（非风格）；ir.ts:45 现形状核讫；semantic.ts:222-223 现转换核讫。独立重推「新键只出现在 v1 原本 E305 拒绝的文本」：被 M4 新回收的 doc 此前必然 dangling（`\|` 与非 M3 成员起始记号均不在三锚位内），无任何存量合法文本的 IR 变化。 |
| 9 | D3/D4 指纹兼容：存量 IR/derived/指纹逐字节不变；`sha256:v1:` 不升级；单一生产者不变量保持 | ADR 0019 决策 4；ADR 0007 指纹条款；ADR 0017（指纹对比契约）；fingerprint.ts D2-CONTRACT-MARKER | ✅ 一致 | fingerprint.ts 在 DENY LIST（零改动）；semantic 指纹 = `{domain,lang,version,module}` 插入序 canonical JSON SHA-256（fingerprint.ts:55-57 核讫）——条件键对存量输入构造性不入场，前缀不触发 v2 升级（D2 触发器=第二生产者/跨实现互认，均未引入）。金样本 A/B 已先于实现录制（契约文件常量，HEAD `91c4add`）。ADR 0017/0018 消费方（META.schema、peer re-arm）输入不变、零触发。 |
| 10 | D4 derived 条件稀疏 `memberDocs?: Record<string,string[]>`（`<member N>` 键、只收非空、整键缺席、差异常态化入类型注；第八键居末；不进 StructureNode/ValueSchema/index） | ADR 0019 决策 5（显式修订 ADR 0003 docs 表条款）；ADR 0003 后果「形状变更须走设计修订流程」；ADR 0003 决策 3（联合分支列表表示不动） | ✅ 一致 | 修订链完整：ADR 0019 即 ADR 0003 要求的设计修订流程产物（docs/AGENTS.md「显式修订而非静默矛盾」满足）；DocsTables 现三表、walkDocs union 分支现只递归（evaluate.ts:338-342/380-382 核讫）；`<member N>` 文法既有；返回字面量七键核讫（evaluate.ts:63-73），条件追加末位保键序；DerivedSchema 现恰七键核讫（derived.ts:69-84）。ADR 0005 §3「派生 schema 必须携带 docs」方向一致（#307 消费）。 |
| 11 | D5 手造 IR 守卫：`memberDocs` 在场但非「与 members 等长的数组的数组」→ TypeError → evaluate 顶层 catch → `{ok:false}` 恰一条 E100、无 derived；缺席合法 | ADR 0019 决策 5 loud 边界条款；packages/vfsl/AGENTS.md「公共畸形输入走判别结果而非 throw」 | ✅ 一致 | 守卫集合（整体非数组/短/长/元素非数组）= 决策 5 文义「非等长数组的数组」的同一集合；抛点在 evaluate 内部、公共面仍判别结果（顶层 catch evaluate.ts:74-77 既有同族核讫）；口径与既有 put/appendDocs 守卫一致（仅 Array.isArray，不校验元素字符串性——evaluate.ts:344-354 核讫）；「缺席=合法条件键」的有意不对称是决策 5 明文边界。单错误模型（v1-spec §4）不破：恰一条 issue。 |
| 12 | D5/D7 校验/物化零读取 memberDocs | ADR 0019 决策 8；ADR 0001「无机器标签」；CONTEXT.md「语义层」 | ✅ 一致 | validate.ts:350/517、validate-patch.ts:160/247、resolve-schema-at-path.ts:279/394、resolve.ts/shapes.ts union 分支逐点核讫：全部只读 `members`/`marker`/`arg`；validate*.ts 与物化路径在设计 DENY LIST。 |
| 13 | D6 E305 消息正文补「联合成员」（前缀冻结） | v1-spec §4（错误码传递通道：前缀冻结、正文不冻结）；ADR 0019 决策 9.3 | ✅ 一致（附 O-3） | 现行正文核讫（semantic.ts:76 与设计引用逐字一致）；全仓断言锚仅前缀正则（parse-vfsl-jsdoc.test.ts:127 核讫）；`tests/acceptance/vfsl_spec_acceptance.py` 断言的是**规格文本**而非运行时消息——#306 不改规格（DENY LIST）故保持绿，#309 须同支同步修订规格与该检查器（C-1 既有范围）。 |
| 14 | 兼容路径整体（公共类型加性、无新错误码、E305 触发面只缩小、`parseVfsl`/`evaluate` 签名不变、blind-read 消费方零改动、回滚单 revert） | v1-spec §8；ADR 0019 决策 9；packages/vfsl/AGENTS.md「错误码/排序/路径/信封严格性/指纹输入是兼容行为」 | ✅ 一致 | `VfslType`/`DerivedSchema` 经既有导出自然携带可选键（index.ts:60-78 核讫），无新增导出（「公共 API 只经 index.ts」满足）；codegen emitter 显式挑五槽、对其余键盲读（emitter.ts 核讫）；E100 新触发属决策 5 授权的既有守卫族同族延伸；方言层「只增不改」论证（EBNF 零改动——注释是 trivia，§2 注记 9）成立。 |

**取代链核查（复审）**: ADR 0019 未被取代；其对 ADR 0003（决策 5）与 ADR 0016（决策 7）的修订均为显式修订条款，两 ADR 其余条款维持效力（ADR 0003 决策 1/3/4/5 与 ADR 0016 投影形状均不受 #306 触碰）。ADR 0007 指纹条款、ADR 0017 对比契约、ADR 0018 re-arm 均无叠加冲突。

## 三、§14 复查焦点的三项显式回答

1. **D1 结算机制是否忠实决策 4 文义** —— 是。「记录位置（区间下标）＋ DocLead 引用、确认 ≥2 成员、按成员逆序、引用同一性核对回收、核对失败=已被 M3 等内部锚位回收、坍缩整条不回收」六要素逐一在场（矩阵 #5）；`claimDocs`/三锚位/tokenizer 零触碰（D7.1/7.2），记账不变量 `claimed + dangling.length === docTotal` 由 splice 同步 `claimed` 保持，算术缺陷将以 loud E100 暴露（parser.ts:220-222）而非静默丢 doc。
2. **D5 守卫边界与决策 5 口径是否一致** —— 是。「在场但非等长数组的数组 → TypeError → E100」与设计的四类畸形集合同延；缺席合法（条件键）；良性等长放行且条件稀疏使其零产出；不校验元素字符串性与既有三槽守卫口径一致（不超面）。
3. **C-2 指纹纪律无第二生产者** —— 是。fingerprint.ts DENY LIST 零改动；无第二规范化层；条件键构造性保证存量输入的 IR/derived JSON 逐字节不变（矩阵 #8/#9 独立重推）；`sha256:v1:` 前缀与 D2 升级触发器均不命中。

## 四、非阻塞观察（登记，不构成停止条件）

- **O-1（实现注意，SA4）**：附着点 B 的 `leads` 取自 peek 记号的 `leadDocs` 引用（沉积前）——实现必须保持引用语义（不得拷贝数组/重建 DocLead），否则同一性核对失效；设计伪代码已正确，落地时不得「优化」掉。
- **O-2（实现注意，SA4）**：嵌套联合正确性依赖「沉积只追加＋逆序结算＋先记录者下标更低」三事实——SA4 不得改 `next()` 的沉积次序或在结算前插入任何中段 splice。
- **O-3（#309 范围，预登记）**：`tests/acceptance/vfsl_spec_acceptance.py` 硬编码「挂载目标: 类型别名 / 属性 / 标记类型」（对规格文本断言）——#306 期间保持绿（规格未动）；#309 修订 v1-spec §5 时必须同支更新该检查器与 schema-authoring-guide，否则 C-1 违反。
- **O-4（措辞时效）**：`packages/vfsl-codegen/src/emitter.ts`「派生 schema 七槽（输入形状冻结，不得改）」注释对新 schema 第八键过时——#307 范围（四发射位同支清理），#306 不得顺手改（DENY LIST packages/vfsl-codegen/**）。
- **O-5（文档中间态预期）**：v1-spec §5/编写指南在 #309 落地前仍写三锚位——分支中间态豁免由 C-1/C-5 覆盖（PR #305 收官门槛含 #309；依赖边 #309 ← #306/#307 本轮经 gh 复核成立，三票均 OPEN、Parent 链一致）。
- **O-6（验收面提醒，SA7）**：设计 §2.4 基线数字（43 files/682 宽过滤；607+12 红）来自 SA6 录制——SA7 复跑以实际输出为准；数字口径不构成冲突事项。

## 五、前置门禁约束落实核实（C-1~C-6 → 设计位置）

| 约束 | 设计落实 | 本轮核实 |
| --- | --- | --- |
| C-1 规格同支同步 | §1 非目标、§11 DENY LIST（docs/** 出界） | ✅ #306 零规格改动；#309 排期依赖边成立（O-3/O-5 预登记） |
| C-2 指纹纪律 | §7 D3/D4 条件附加、fingerprint.ts DENY | ✅ 矩阵 #9；§三.3 |
| C-3 E305 只缩小 | §7 D1/D6、§12 用例 8/9/10 | ✅ 矩阵 #4/#5/#13 |
| C-4 纯文档纪律 | §7 D5/D7、validate*/物化 DENY | ✅ 矩阵 #12 |
| C-5 中间态豁免 | §1 非目标、§10 矩阵、§13 残余 4 | ✅ codegen/投影 blind-read 代码核讫 |
| C-6 消息边界 | §7 D6（前缀冻结） | ✅ 矩阵 #13；断言锚复核 |

## 六、给总控的结论

1. **无停止运行条件**：SA1 设计与 ADR 全集 + CONTEXT.md + v1-spec（含授权修订链）零未授权冲突；唯一形式分歧（实现四锚位 vs §5 现文三锚位）是前置门禁已裁决的授权 override，排期与收官门槛本轮复核成立。
2. **设计无需修订**，`requiresConflictRecheck` 消解为 false；可进入 SA2 全维度攻击评审（本报告不预判设计优劣，仅裁冲突）。
3. 随附检查单：C-1~C-6（§五）＋ O-1/O-2（SA4 实现注意）＋ O-3/O-4/O-5（#307/#309 预登记）＋ E-1~E-5（前置门禁报告第四节，金样本已由 SA6 先于实现录制，SA4 不得重录）。

— SA8（Conflict Gatekeeper），只读审查；唯一产出为本报告（未修改任何仓库文件）。
