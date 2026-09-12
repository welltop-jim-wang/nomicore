# SA2 设计攻击评审 — Issue #319 number 值域收窄核心（ADR 0021）

- 角色：SA2（mabf-sa2）· 阶段 design-review · 迭代 1（复审）· dispatch `sa-4cdc8f51-3f7f-45d1-8371-16ad208b3d6b`
- 评审对象：`wiki/raw/task_issue-319_design.md`（SA1 迭代 1 修订版，449 行——迭代 0 首版基础上原位修订，逐条落实本评审迭代 0 的 F1/F2）
- 评审产物：本文件（`wiki/raw/task_issue-319_sa2_review.md`；原位更新，取代迭代 0 版本）
- 裁决：**approve**（迭代 0 的 F1 BLOCKER / F2 MAJOR 均已按验收条件落实并经独立核验；无新增 BLOCKER/MAJOR）

## 1. Reviewed inputs

| 输入 | 状态 |
| --- | --- |
| `wiki/raw/task_issue-319.md`（任务简报，Issue #319 正文 + 5 条 AC） | 已读 |
| `wiki/raw/task_issue-319_design.md`（SA1 迭代 1 修订版，全文 449 行） | 已读全文，重点独立核验 §7 D-H、§7 D-C 合法形段、§11/§12/§13/§14 修订面 |
| 本评审迭代 0 版本（reject：F1 BLOCKER + F2 MAJOR） | 已读（作为修订验收基线） |
| `wiki/raw/task_issue-319_sa6_contract.md`（SA6 契约，approve，294 行） | 已读全文（T1/T2 断言规格、消息规则①–④、反事实三态、Q1–Q6 逐项比对） |
| `wiki/raw/task_issue-319_conflict_report.md`（SA8，verdict clear，requiresConflictRecheck=true） | 已读全文（Required actions 1–4、override 范围、冻结面清单） |
| `wiki/raw/task_issue-319_relevant_decisions.md`（SA8 决策摘录，91 行） | 已读全文 |
| `docs/adr/0021-vfsl-number-domain-narrowing.md`（裁决权威，156 行） | 已读全文；决策 1 公式、决策 3 消息、决策 4 条款 L80–83、决策 5/6/7、Consequences L133–134 逐条比对 |
| `docs/vfsl/v1-spec.md` 文法（L36–101，含注记 1/5/7）+ §8（L461–471）+ §9 头 | 已读比对（F2 合法性 + D-E 插入点） |
| 源码锚点核验：`validate.ts`（L125–165 resolveValues/refMemo/jsonTypeOf/enumContains、L275–394 countIssues/contradicts/contradictsInner/memoStore、L391–450 validateUnion 三段/argmin、L454–526 validateValue/array 分支 L499）、`derived.ts` L44–53、`evaluate.ts` L290–291、`validate-patch.ts` L35/L562–569/L1012–1019 | 已核 |
| **F1 事实核验（本迭代新增）**：`doc-runtime/test/materialize-root.test.ts`（L63–64 头注、L823–872 RAC-2 矩阵与断言模板、L875–958 R3 模板）、`test/replace-root-content.test.ts`（L460–519、L600–643）、`src/materialize.ts` L115–144、`src/replace.ts` L108–137、`namespace-registry/src/create-document.ts`（prepare/standalone 双路径）、`registry-create.test.ts` L712–751、`runtime-replace-schema-sequencer.test.ts` L620–660、`registry-plugin.test.ts` L245–259 | 已核 |
| 消费链核验（承迭代 0，抽核不变面）：`write.ts` L138–146/L205–209/L340–346、`canonical-json.ts` L57–64、`projection/input.ts` L85–96、`mutation-local.ts` 四调用点、`index.ts` 公共面 | 已核 |
| **全仓测试四值断言完整性扫描（本迭代重跑）**：`NaN|Infinity`（76 命中）+ `-0\b`（37 命中）跨 `packages/*/test` 全量 triage | 已核（D-H「恰 3 处」成立，见 §9/§12） |
| 测试面核验：vitest.config.ts L15 include、changelog `package.json` L22 `@nomicore/vfsl: workspace:*`、两枚新测试路径不存在（无同名冲突）、`parse-vfsl-errors.test.ts` L51–57 | 已核 |
| Issue #319 REST 评论 | 读取成功且为空数组——**无 Owner 评论要求**（与简报 L31–32、SA6 §2、SA8 §4 一致） |

SA2 未修改设计/生产代码/测试，未运行测试或服务；全部结论基于源码静态核验与上游证据。`packages/doc-runtime`、`packages/vfsl`、`docs` 的 AGENTS.md 契约（零写入承诺、读路径 schema-independent、兼容行为面、公共 API 纪律、行为变更同变更集修订规范）已读并作为审查基准。

## 2. Verdict

**approve**。

- **F1（迭代 0 BLOCKER）已落实**：§11 ALLOW 增列两 doc-runtime 测试文件（用例级限定）与两注释行（comment-only 限定），DENY 行同步收窄为例外制；§7 D-H 给出逐用例迁移规格（C-7 迁移裁决、域词断言删除裁决、注释更正裁决均显式记录）；§12 AC6 增枚举变更集 diff 门 + 新增 F1 验收行；§10 调用方矩阵与 §13 风险表补行。「AC6 全仓全绿 × 文件范围 × 调用方矩阵」联合不可满足的矛盾**消除**。逐用例规格与测试文件现状逐行吻合（锚点核验见 §9/§12）；全仓四值断言重扫确认受影响面**恰为 3 处**（第 4 处不存在），迁移后全仓套件可全绿。
- **F2（迭代 0 MAJOR）已落实**：§3/§7 D-C/§12 三处非法括号分组文本全部替换为 `type U = number | string; type ROOT = { xs: U[]; };`——经 v1 冻结文法（`ArrayType = PrimaryType, { "[", "]" }`、`PrimaryType ⊇ TypeRef`、TypeAlias/UnionType）与实现链（`evaluate.ts` L290–291 数组元素经 valueOf 保 ref、`validate.ts` L499 `resolveValues(t.element)` + L136–138 refMemo 解析到同一 union 成员节点对象）双向核验**合法且语义等价**；⑤ Record 值位 `Record<string, number | string>`（RecordType 实参为 TypeExpr）合法；双层方括号笔误已修；memo 序独立性覆盖（AC1-5 ①–⑤）完整保留，敏感性经三段算法独立重推成立（见 §7 C1/C2）。
- 核心机制面（D-A 共享谓词 / D-B 双点同步收窄 / D-C 哨兵键 / D-D 消息冻结粒度 / D-E §8 例外落文 / D-F 落位与强度 / D-G 枚举排除 / §1 排除面）迭代 1 **零变化**，本迭代全部锚点复核对源码与 ADR 0021 仍然成立。
- 无新增 BLOCKER/MAJOR；3 项非阻塞观察见 §14（其中 1 项为本迭代新记）。

`pass`/`approve` 仅表示设计通过审查，不替代 SA4 实现复核与 SA7/SA8 活链路验证。

## 3. 需求覆盖

| Requirement | Design section | Assessment |
| --- | --- | --- |
| Issue L17：四值全拒 + 消息细分 + `-0` 经 `Object.is` 识别 + 双路径同口径 | §1 目标 1–3；§7 D-A/D-B/D-D | 覆盖（与迭代 0 同，复核成立）：`isJsonFaithfulNumber` 与 ADR 0021 决策 1 公式（L44）逐字一致；`renderNumberValue` 以 `Object.is(v,-0)` 先于 `String` 回落识别 -0；消息规则①–④满足「消息细分正确」的可执行判据 |
| Issue L21（AC1）validate 四值全拒 + 0/0.0/有限小数放行 | §12 T1-AC1-1~4 + AC1-5 | 覆盖；**AC1-5 输入已改 v1 合法形**（F2 修订），断言语义经独立重推正确（§12） |
| Issue L22（AC2）validate-patch 写路径同口径 | §12 T1-AC2-1；§7 D-A；B4 | 覆盖：`validate-patch.ts` L35 导入 `validateSubtree`、`finish`（L562–569）/`validateBoundary`（L1012–1019）消费——同口径由共享解释器结构性保证，validate-patch 零改动成立（本迭代复核对源码吻合） |
| Issue L23（AC3）changelog 结构性闭合锁定测试 | §12 T2（AC3-1~5）；B10 | 覆盖：`canonical-json.ts` L61–63（非有限 → `SnapshotContractViolation`）与 `projection/input.ts` L85–96（catch → `capture:'unavailable'`）机制锚复核一致；T2 落位 changelog 包依赖方向正确（package.json L22 在场） |
| Issue L24（AC4）IR/derived/codegen/fixture 指纹逐字节零改动 | §12 T1-AC6；D-F Q5；§6 决策 6 行 | 覆盖，且迭代 1 的 B12 修订注记诚实标明「基线绿中恰 3 处为旧语义断言，迁移后同套件全绿」——锁定目标与可行性论证现已自洽 |
| Issue L25（AC5）包测试、typecheck 全绿 | §12 验证映射 | 覆盖（F1 落实后可达） |
| SA8 R1：v1-spec §8 同变更集例外条款 | §7 D-E；§11 ALLOW | 覆盖（见 §5） |
| SA8 R2：消息原 emit 锚位、issue 顺序、单错误量 | §7 D-A 性质核对 | 覆盖：`ctx.emit([...path], thunk)` 门控结构保持（L458–464 现状复核）；每标量节点至多 1 条不变 |
| SA8 R3：排除面纪律 | §1 非目标 + DENY + T1-AC7 | 覆盖（见 §11） |
| SA8 R4（可选）：CONTEXT.md 术语 | §4 表末行**不采纳** | 可接受（理由与迭代 0 同：链接权威源而非复制；无既有术语被违反） |
| **迭代 0 F1/F2 修订义务** | §1 目标 7；§7 D-H/D-C；§14 修订映射 | 逐条落实（见 §2/§13） |

目标与非目标无静默扩大；排除面各条权威依据复核成立（`ValueSchema` 无 int/range kind——derived.ts L44–53 核实；tokenizer `-0` 即 E100——SA6 探针 4；seed/直构面——决策 7 L104–105；枚举——`enumContains` L162–165 严格相等）。

## 4. Owner评论覆盖

Issue #319 REST 评论读取成功且返回**空数组**（dispatch 声明 + 简报 L31–32「Comments」节为空 + SA6 §2 / SA8 §4 三方一致）。无 Owner 评论级要求、无 override、无待并入验收项——设计 §4 的收敛（Issue 正文 + ADR 0021 + SA8 R1–R4）正确，无遗漏可查。

## 5. 上游事实与SA8约束

| Fact or constraint | Design response | Assessment |
| --- | --- | --- |
| ADR 0021 决策 1 判定公式（L44） | `isJsonFaithfulNumber` 逐字落地（D-A） | 一致（逐字符比对） |
| ADR 0021 决策 3 消息形态（L65–73） | D-A `scalarRejectMessage` 双分支 + D-D 冻结粒度 | 一致；typeof 失配消息与源码 L462 现行逐字节相同（推演复核：`scalarRejectMessage('number','x')` 走通用分支）；规则④四个尾 token 正则与 `renderNumberValue` 输出一一对应（NaN/Infinity/-Infinity/-0），互异成立 |
| ADR 0021 决策 4 §8 条款（L80–83） | D-E 逐字落文 + 结构引导行 | 一致：条款正文与 ADR L80–83 逐字相同（仅去 blockquote 换行）；引导行「首例 = ADR 0021」与 ADR L85 事实陈述一致；插入点（L467 规则 3 后 / L469 段前）实测有效；三条「只增不改」规则与解释段不动；不引入 0020 保留名条款；`version` 不升 |
| ADR 0021 决策 5 存量姿势 + **测试侧后果** | §1 非目标、§9、§13；**§7 D-H（新增）** | 一致且迭代 1 补全：既有测试的旧语义断言被识别（B13）并按用例级迁移收编——这是决策 5 breaking 姿势在测试面的直接后果，处置不放宽任何拒绝 |
| ADR 0021 决策 6 + ADR 0017 冻结面 | T1-AC6 + `generate --check` + 枚举变更集 diff 门 | 一致（可行性经 F1 修复后成立） |
| ADR 0021 决策 7 观测闭合 + 种子/直构面排除 | T2 + §1 非目标 + B9 保持 | 一致（extract L268–272 / detached-build L183–186 守卫复核：只拒非有限数、-0 直通，保持不动正确） |
| ADR 0008 L25 声明值域 / L49 snapshotter finite | §3 根因链 | 一致（源文件复核；ADR 0021 引作「L31」的行号偏差见 O2） |
| ADR 0007 校验拓扑不改 | §7 D-A | 一致（共享解释器结构 L456–526 复核） |
| ADR 0010 R2-4 SameValue 判据不动 | §1 非目标 + §6 | 一致 |
| ADR 0014 record schema/JSONL 不动 | DENY LIST | 一致（record 值域经投影期 finite 过滤/-0 归一，行为零变化；SA6 §10 行 5 同证） |
| packages/vfsl/AGENTS.md 兼容行为（错误码/issue 顺序/路径报告/指纹输入；公共 API 只经 index.ts） | D-A 性质核对 + DENY | 一致：新符号全模块局部；`unique symbol` const 声明合法 TS；`index.ts` 零改动 |
| docs/AGENTS.md 行为变更同步规范 | D-E 同变更集 + **D-H 注释更正裁决** | 一致：§8 条款与代码同变更集；materialize.ts/replace.ts 失准注释（「值域宽域」）与刚落地 ADR 直接矛盾，comment-only 最小更正入 ALLOW 是该纪律的注释侧同构，裁决及备选拒绝理由在案 |
| B12/SA6 基线（313 files/3298 tests 绿） | §2 B12 修订注记 + B13 | **完整**：迭代 1 显式标明基线中恰 3 处为旧四值语义断言并给出收编方案——迭代 0 指出的「基线绿与实现后全绿之间的落差」已闭合 |

## 6. 设计内部一致性

- 正文/伪代码/接口/数据流（R1–R4）与源码锚点逐项吻合；无死引用、无旧 API。
- D-B「恰 2 条」联合形态与 `validateUnion` 源码（L409–434）重推一致：`both` 变体下四值入 `number | string` → 段 1 无候选（L410–413）→ 段 2 全员计距（L417）→ 无候选分支汇总（L432）+ 下钻（L433）恰 2 条；argmin 严格 `<`（L437–444）平局取声明序在前 = number 成员 → 四值 detail 在场；判别式快速路径（L396–407）仅作用于对象值联合，与本面无交集。`string | number` 序 winner=string、detail 为 typeof 失配消息——设计说明与代码一致。
- D-C 三触点（L289 读 / L312 读 / L382 写，`memoStore` 双 memo 共用）与源码逐行吻合，**无第四触点**（countMemo/contraMemo 内层 Map 的值键读写仅此三处，外层键为节点对象）；`Map` SameValueZero `-0 ≡ 0` 双向碰撞、NaN 自等、Symbol 身份唯一——消歧方案正确且必要。
- **F1 修订一致性**：§1 目标 7 ↔ §2 B13 ↔ §3 影响面段 ↔ §7 D-H ↔ §10 测试级消费者行 ↔ §11 ALLOW/DENY ↔ §12 AC6+F1 验收行 ↔ §13 风险/回滚 ↔ §14 映射——九处引用同一组事实（3 断言、2 测试文件、2 注释行），无互相矛盾；「生产代码零改动（两注释行除外）」表述在 §10/§11/§12 三处一致。
- **F2 修订一致性**：§3 根因示例、§7 D-C「测试输入的 v1 合法形」、§12 AC1-5 三处均为 `type U = number | string; type ROOT = { xs: U[]; };`，与文法依据（v1-spec L38–57 + 注记 5 L78–79）和等价性依据（validate.ts L136–138/L499）引用一致；全文档无残留括号分组活文本（§14 对迭代 0 缺陷的历史引述属修订映射记录，非指令）；双层方括号笔误已清。
- 轻微（不阻断）：§2 B11 与 SA6 §4 的 §8 行界（L461–471 vs L461–473）相差 §9 标题行，插入点判断不受影响（D-E 已按文本锚表述）。

## 7. 状态机与并发攻击

| ID | Initial state | Trigger | Expected behavior | Design gap | Required revision |
| --- | --- | --- | --- | --- | --- |
| C1 | 一次 `interpret` 调用内，`xs[0]=0` 已在 memo 落键（schema `type U = number\|string; type ROOT={xs:U[];}`） | `xs[1]=-0` 查同节点缓存 | **双重碰撞**：contraMemo[number][0]=false 命中 → -0 成候选；countMemo[number][0]=0 命中 → 距离 0 → 静默接受 | 无——D-C 哨兵键修复；本迭代以合法 TypeRef 形重推仍成立（`resolveValues(t.element)` L499 → 同一 union 成员节点对象 → memo 外键同一） | 无（T1-AC1-5 ① 锁定，输入已合法可编写） |
| C2 | `contraMemo[N][-0]=true` 已落键 | 后续 `0` 查同节点 | 命中 -0 缓存 → 0 被判矛盾 → 无候选 → 汇总 issue 注入 `['xs',1]`（下钻 detail 因 0 合格而为空，恰 1 条伪汇总） | 无——D-C 第二类错误已识别；AC1-5 ② 的「无 `['xs',1]` issue」断言对该伪汇总真实敏感 | 无 |
| C3 | MEMO_CAP（65536）触顶清空重建 | 哨兵键在场 | 清空后重填，键归一化一致性不变；`memoEntries` 计数语义不变 | 无（memoStore L371–383 复核） | 无 |
| C4 | 计数态（issues ≥ 100）/ 计数 sink 期间四值到达 | emit thunk | 不构造消息、不跑 preview（R4 门控）——`renderNumberValue` 留在 thunk 内 | 无 | 无 |
| C5 | 候选分支 annotated Ctx（L428 spread）下钻期间 memoStore 写入 | spread 副本 | Map 引用共享 → 写入落共享桶，正确性不受影响；标量记账在副本漂移为既有冻结行为 | 无（非本设计引入） | 无 |
| C6 | 进程重启/重入/并发调用 | — | 同步纯函数、per-call Ctx；`NEG_ZERO_MEMO_KEY` 不可变模块常量（与 ISSUE_LIMIT 同类），不携带跨调用状态 | 无 | 无 |
| C7 | **D-H 迁移后用例与同套件其余用例共存** | 全仓 vitest 单进程顺序执行 | 迁移用例不依赖执行序/共享状态（各自独立 `derivedOf` + `new Y.Doc()`）；RAC-2 其余行（C-1~C-6、unknown 位）前置 `ok:true` 不受收窄影响（`scalarAccepts('unknown',…)` 恒真，L833–840 核实） | 无 | 无 |

## 8. 错误与恢复攻击

| ID | Failure | Current design behavior | Risk | Required revision |
| --- | --- | --- | --- | --- |
| E1 | 四值 @ 裸 number 叶 | `ok:false` + 单条收窄 issue（精确 path）；写路径经既有零写入管线（`{kind:'fail'}` / R9 `validation/rejected`，write.ts L205–209 复核） | 低 | 无 |
| E2 | `renderNumberValue` 收到有限非 -0 值 | 防御性回落 `String(v)`（调用点已过滤，正常不可达） | 无 | 无 |
| E3 | 含四值存量 doc 在 rearm/重校验点 | loud 失败 = ADR 决策 5 既定姿势 | 既定 | 无 |
| E4 | 写路径失败后重试 | 修正 payload 重提交即成功；纯函数无残留状态 | 低 | 无 |
| E5 | NaN/±Inf 输入先经 runtime S3 | `copyFrozen`（L340–346 复核：仅 `!Number.isFinite` 抛）既有拒绝先于 vfsl；`-0` 穿透后在 vfsl 新拒点被拒 | 无缺口 | 无 |
| E6 | 旧语义测试在实现后失败 | **D-H 已定义完整处置**（迭代 0 的 HIGH 风险消除）：3 用例按逐用例规格迁移，ALLOW/DENY/验收门三处自洽，实现者不再有两难 | 低 | 无 |
| E7 | 伪绿风险：AC1-5 在无 memo 修复实现上 | ① 双重碰撞静默接受 → `ok:true` 红；② 伪汇总 → 「无 `['xs',1]` issue」红——敏感性真实（独立重推） | 无 | 无 |
| E8 | D-H 迁移用例写错失败面（把 ① 拒绝误断成 ② 构造域词） | 规格已指明新失败面消息必须满足 D-D 规则①–④且 `result.issues` 与直调 `toEqual`（零损透传锚，materialize L130–131 / replace L122–123 复核）——错误锚即红 | 低 | 无（SA4 复核兜底，§12 F1 验收行在案） |

## 9. 契约影响审查

| API or contract | Missing or weak caller handling | Evidence | Required revision |
| --- | --- | --- | --- |
| `validateLogicalSnapshot` 行为增量（四值 ok:true→ok:false） | 无缺口：生产调用方矩阵完备（mutation-local 四点、materialize L130、mutation L105/112、replace L122、registry create-document 双路径、changelog memory.ts L285——`!logical.ok → {kind:'fail'}`/`root-invalid` 通道既有，create-document.ts 双路径复核） | §10 表逐行源码复核 | 无 |
| `validateLogicalSnapshot` 的测试级消费者 | **迭代 1 已补全**：§10 新增测试级消费者行；D-H 逐用例规格覆盖全部 3 处（materialize-root C-7 / replace-root L486 / L630） | B13 与两测试文件原文逐行核对一致（L841/L853/L486–506/L630–643 在案） | 无 |
| **第 4 处旧语义断言排查**（本迭代全仓重扫） | **不存在**：76 处 NaN/Infinity + 37 处 -0 测试命中逐一 triage——registry-create L727–728 断言 `ok:false`+`NAMESPACE_CREATE_INVALID_INPUT`（收窄后经 `root-invalid` 同码，仍绿）；runtime-replace-schema L638 NaN 经 S3 snapshotter `MUTATION_INPUT_NOT_PLAIN_DATA`（先于 vfsl，不变）；registry-plugin L254 为 idleTimeoutMs JS 域检查；phase5-bootstrap epoch/META 面（JS 判据非 vfsl number 叶）；extract-nonfinite / read-logical-value / input-capture / replication-session SameValue 均非 vfsl 判定面（B9 守卫、读路径、直投投影、META R2-4） | 本迭代 grep 全量 triage | 无 |
| `validate-patch` 家族四入口 + `applyMutationAtBoundary` | 覆盖完备（AC2-1 四类 + 消息逐字节同字面 + path rebase——L562–569/L1012–1019 rebase 结构复核）；`validateDeleteFromArray` 无 value 参数，四值不适用，正确排除 | 签名核实 | 无 |
| `ValidateResult`/`ValidateIssue` 形状、公共导出面 | 不变；新符号全模块局部 | 复核成立 | 无 |
| 下游间接（Hub/Peer 复制、Registry 生命周期） | 形状不变；四值对合法写入结构性不可达后 R2-4 契约外形态仅存种子/直构面 | SA8 §3 一致 | 无 |

## 10. 架构一致性与惯例审查

### 责任归属

| Behavior | Expected owner | Design location | Assessment |
| --- | --- | --- | --- |
| number 值域判定 | vfsl 校验核心（值语义唯一 Owner） | `validate.ts` 单文件、`scalarAccepts` 单一事实源供两判定点 | 正确——消除既有双谓词分叉 |
| 既有测试语义迁移 | 测试文件自身（用例级） | D-H 规格落在两测试文件内，生产代码零触碰 | 正确——不因测试失准而改生产行为 |
| 规范修订 | v1-spec §8 | D-E | 正确 |

### 相似能力对照

| Similar capability | Existing implementation | Proposed design | Consistent or divergent | Reason |
| --- | --- | --- | --- | --- |
| number 拆支 + 非有限 loud 拒 | `extract.ts` L268–272 / `detached-build.ts` L183–186（域词 `non-finite number`） | `isJsonFaithfulNumber` 独立谓词 | 一致 | 同款惯例；`-0` 为 ADR 0021 显式裁决的补缺 |
| -0 识别惯例 | `Object.is(v,-0)`（extract-nonfinite-number.test.ts L167 等）；ADR 0010 SameValue | 同 | 一致 | |
| 常量模块级声明 | `ISSUE_LIMIT`/`WORK_LIMIT`/`MEMO_CAP` | `NEG_ZERO_MEMO_KEY` | 一致 | 非第二事实源、非跨调用缓存 |
| TypeRef 数组写法 | v1 文法 `ArrayType = PrimaryType, {"[", "]"}`（PrimaryType ⊇ TypeRef）；authoring guide L110 `T[]` | AC1-5 用 `U[]` | 一致 | 仓内 TypeRef 常规用法（evaluate L290–291 元素经 valueOf 保 ref，运行期 resolveValues 解析） |
| RFC 8785 -0 归一 | `canonical-json.ts` L63 | 不触碰 | 一致 | |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
| --- | --- | --- | --- |
| number 合法值域 | ADR 0021 决策 1 | `isJsonFaithfulNumber` + §8 条款（内嵌 ADR 引用） | 低 |
| 判定实现 | `scalarAccepts`（两点共用） | — | 低（分叉被消除） |
| D-H 迁移后失败面语义 | vfsl 收窄判定（唯一事实源） | 两测试文件的断言锚 | 低——断言直接消费 `validateLogicalSnapshot` 直调结果（`toEqual`），无第二份判定 |

### 生命周期对称性

无运行时生命周期（同步纯函数、无 register/dispose、无后台任务、无持久化新增）；测试改动为既有文件用例级修订 + 纯新增文件，无对称性义务。成立。

### 平行机制检查

| Candidate duplicate | Existing path | Proposed path | Disposition |
| --- | --- | --- | --- |
| 第二判定实现 | — | D-B 备选 `accept-only` 被拒绝 | 正确拒绝 |
| 字符串哨兵键 | — | 备选被拒绝（用户值可碰撞） | 正确拒绝；Symbol 身份唯一 |
| 新错误码/新消息通道 | validate 消息通道 | 四值复用 | 无平行机制 |
| 测试期反向依赖 | 包依赖方向 | D-F Q4 拒绝 vfsl 自持 T2 | 正确拒绝 |
| 测试侧第二套「失败面」定义 | vfsl 判定直调 | D-H 断言锚 = 直调结果 `toEqual` | 无平行机制 |

**架构结论**：无错误 Owner、无绕过既有能力、无第二事实源、无生命周期不对称、无仅服务单一 Issue 的通用抽象。D-H 的注释更正（2 行 comment-only）不构成生产行为通道。

## 11. 文件范围审查

| Path or scope issue | Evidence | Required revision |
| --- | --- | --- |
| ALLOW `packages/vfsl/src/validate.ts`（唯一生产改动；辅助 6 符号 + 两消费点 + memo 三触点） | 与 B1–B3/B6 一致；改动面枚举与 D-A/D-C 伪代码一一对应 | 无 |
| ALLOW 两枚新测试文件 | 路径均不存在（实测）；vitest include `packages/*/test/**/*.test.ts`（L15）收录；两包 tsconfig 含 test（SA6 §14） | 无 |
| ALLOW `docs/vfsl/v1-spec.md` §8 单点插入 | 插入点实测有效；条款逐字；三条规则与「只增不改」不动；无 0020 保留名；`version` 不升 | 无 |
| **ALLOW 两枚 doc-runtime 测试文件（用例级限定）** | D-H 逐用例规格在案；限定语（「其余用例零改动」）明确；与 DENY 例外制表述互洽 | 无 |
| **ALLOW 两注释行（comment-only 限定）** | materialize.ts L128 / replace.ts L120 原文核实为单物理行首段（「① 逻辑校验（值域宽域）」）；更正建议措辞不引入新契约陈述 | 无 |
| DENY `packages/doc-runtime/**` 收窄为例外制 | 例外清单（两测试文件 + 两注释行）与 ALLOW 完全一致；src 生产语义（mutation-local/extract/detached-build/读路径）仍零改动——与 doc-runtime AGENTS「零写入/读 schema-independent」契约一致 | 无 |
| DENY 其余各面（validate-patch、index.ts、IR/codegen 文件、jsonTypeOf/preview/enumContains、changelog src、input-capture、namespace-runtime、persistence、adr、§8 以外章节、CONTEXT.md、生成物） | 与排除面一一对应；无正文冲突 | 无 |
| ALLOW 无无理由扩张；follow-up 未掩盖必要项 | 每行 ALLOW 有理由列；§13 follow-up 1–4 均真非必要 | 无 |
| §12 AC6 枚举变更集 diff 门 | 与 ALLOW 七行一一对应（validate.ts / 两新测试 / 两 doc-runtime 测试 / 两注释行 / v1-spec） | 无 |

## 12. 验收设计审查

| Requirement or risk | Proposed evidence | Gap | Required revision |
| --- | --- | --- | --- |
| AC1（四值全拒+消息+放行） | T1-AC1-1~4（行为断言：公共面、path、恰 1 条、规则①–④、互异、尾 token、声明序 3 条） | 无（规则①–④与 D-A 文案推演吻合；旧实现 ok:true 必红） | 无 |
| **memo 序独立性（AC1-5，F2 修订后）** | ①`{xs:[0,-0]}`→`['xs',1]` 拒；②`{xs:[-0,0]}`→仅 `['xs',0]`；③NaN 对照；④混序；⑤Record 值位 | **无**：schema 已合法（文法 + 实现链双向核验，无 E100）；断言逻辑经三段算法独立重推正确——①在无修复实现上经 contra+count 双重碰撞静默接受（红）；②伪汇总注入 `['xs',1]`（红）；⑤ Record 形态值位同款 | 无 |
| AC2（写路径同口径） | T1-AC2-1 四入口 × 四值，消息逐字节同字面、path rebase、恰 1 条 | 无 | 无 |
| AC3（观测闭合） | T2 AC3-1~5 + 机制锚新旧同绿 | 无（依赖/落位/emitter 复用核实；AC3-5 既有 `input-capture.test.ts` L200–209 在场） | 无 |
| AC4/AC6（零改动锁定） | 既有套件 + typecheck + `generate --check` + **枚举变更集 diff 门** | 无（F1 落实后联合可满足：3 迁移用例 + 3295 项零改动原样绿） | 无 |
| AC5 | 全仓 test + typecheck | 无 | 无 |
| **F1 既有测试迁移（D-H）** | 逐用例规格：C-7 迁移（删行 + 原位注释 + 新逻辑失败用例，按同文件 R3 模板 L938–958——直调 `ok:false` 恰 1 条 → materialize `ok:false` + `issues` toEqual 直调 + 0 update + state 不变）；L486 前置翻转 + 收窄消息 + G3-1 锚（L478）零损透传 + 删域词断言 + 保留零写入双证与旧内容原封；L630 前置翻转 + mat/rep issues 等价保留 | **无**：三用例规格与文件现状逐行吻合；迁移目标模板/锚型在场；全仓重扫确认无第 4 处；「不放宽、不删除覆盖、无第三种处置」达成 | 无 |
| 排除面负控 T1-AC7 / 相近负控 T1-AC5 | E100/E301 现状锁 + 5 类 typeof 失配 + unknown/null/枚举不变 | 无（`enumContains` L162–165 严格相等复核） | 无 |
| §8 落文（D1 review 门） | 在场/一致/不扩面/不重编四查 + `git diff --check` + 报告携带 diff | 无——正确拒绝写成字符串断言测试 | 无 |
| 测试红灯真实性 | SA6 反事实三态（base 35 红 / both·accept-only 104 绿）+ AC1-5 序敏感性 | 无缺口（设计锁定 `both` 后联合位条数随之可锁，偏离 SA6 Q1 中立表述已由 D-B 显式裁决并论证） | 无 |

## 13. Required revisions

**无未决 BLOCKER/MAJOR。** 迭代 0 两项 finding 的处置与验收核对如下（稳定 ID 保留作修订映射，均不再阻断）：

| Finding ID | Severity（迭代 0） | 处置核对（迭代 1） | 验收条件达成 |
| --- | --- | --- | --- |
| F1 | BLOCKER | §11 ALLOW 增两测试文件（用例级）+ 两注释行（comment-only），DENY 收窄为例外制；D-H 逐用例规格与两测试文件原文逐行吻合（C-7 L841/模板步 L853；replace L486–506/L630–643；R3 迁移模板 L938–958、G3-1 锚 L478 在场）；C-7 迁移/删除二选一显式记录（选择迁移，C-3/C-4a/C-4b 继续覆盖构造域支路）；`toContain('non-finite number')` 删除裁决有据（构造域词非冻结兼容面）；注释更正裁决有据（docs/AGENTS 同变更集纪律的注释侧同构）；全仓重扫确认受影响面恰 3 处（registry-create L727 / replace-schema L638 / 其余 70+ 命中均非 vfsl 判定面或断言即拒绝） | ✅ 设计文本含 ALLOW 行与逐用例规格；AC6 与文件范围联合可满足；diff 门（§12 AC6）+ SA4 复核（§12 F1 行）在案 |
| F2 | MAJOR | 三处非法文本全部替换为 `type U = number | string; type ROOT = { xs: U[]; };`——v1 冻结文法（TypeAlias/UnionType/ArrayType/PrimaryType⊇TypeRef，注记 5 反证）+ 实现链（evaluate L290–291 保 ref → validate L499 resolveValues → L136–138 refMemo 同一 union 节点对象）核验合法且 memo 碰撞语义等价；⑤ `Record<string, number \| string>` 合法（RecordType 实参 TypeExpr）；笔误已修；全文档无残留括号分组活文本（§14 历史引述除外，属映射记录） | ✅ AC1-5 输入经 parser 可产出 ok 派生物（无 E100）；① 在无 memo 修复实现上红、完整实现上绿（独立重推）；§3/D-C/§12 无残留非法文本 |

## 14. Non-blocking observations

| ID | Observation |
| --- | --- |
| O1 | `materialize-root.test.ts` 文件头注释 L63–64（「10 行矩阵（… + number 标量位 NaN）」）在 C-7 行删除后将轻度失准（且现状已含对已删 C-8 行的既往失准）。D-H 的「原位一行迁移注释」部分覆盖了解释需要；建议 SA3/SA4 将该头注一行的最小同步更正视作「用例级修订」的合理延伸，或在 SA4 复核时知悉即可。不阻断。 |
| O2 | ADR 0021（及随之逐字落入 v1-spec §8 的条款）引「ADR 0008 L31」，而实际在 L25——accepted ADR 的既有行号偏差随逐字落文传播。不建议本任务偏离「逐字」要求改写；留作未来 ADR 勘误项。（承迭代 0 O1） |
| O3 | §8 插入以文本锚（「第 3 条规则之后、解释段之前」）表述——D-E 已按文本锚执行，迭代 0 O2 的行号盲插风险已在设计层面消解。（承迭代 0 O2，已闭合） |
| O4 | `preview` 在其他消息分支对 `-0` 渲染为 `0`——既有兼容面，§13 follow-up 1 在案。（承迭代 0） |
| O5 | 候选分支 annotated Ctx（validate.ts L428 spread）对 `work`/`memoEntries` 标量记账漂移为既有冻结行为，本设计未触碰。（承迭代 0 O5） |
| O6 | D-H 对 L486 用例的修订保留「恰 1 条」断言——收窄后 ① 失败面恰 1 条成立（单标量违例），与 `result.issues` toEqual 直调锚自洽；实现时注意直调 issues 需在 replace 调用前捕获引用（同文件 G3-1 L461–478 既有写法即可），无须设计变更。 |

## 15. 是否需要设计后 ADR 冲突复查

本评审**未发现新的 ADR 冲突面**，不额外置 `requiresConflictRecheck`：

- F1 落实（doc-runtime 两测试文件用例级修订 + 两注释行）是 ADR 0021 决策 5 breaking 姿势的直接测试侧后果，不触碰任何决策文本或新冻结面；设计 §15 第 3 条已将该 diff 并入 SA8 复查项 (c) 的核对范围。
- 注释更正为 comment-only：不改变任何规范文档的 stated contract（materialize/replace 的行为契约由 ADR 0007/0008 与包 AGENTS 表述，注释仅是滞后的行内说明）；更正使其与 ADR 0021 对齐，方向是消除矛盾而非制造冲突。
- F2 落实（测试输入改合法语法）无冲突面。

SA8 既定三项复查（(a) 消息面、(b) §8 落文、(c) 冻结面 diff——含 F1 引入的 doc-runtime 测试与注释 diff）仍然必要且充分。

## 16. 评审结论

迭代 1 设计将迭代 0 的两项 finding 精确落实为有界、可执行的修订：F1 以「ALLOW 用例级/comment 级限定 + D-H 逐用例迁移规格 + 枚举变更集 diff 门」消除「全绿验收 × 文件范围」的联合矛盾，且经全仓四值断言重扫确认受影响面恰为规格覆盖的 3 处——迁移语义与 doc-runtime 零写入/零损透传契约逐条相容；F2 以文法与实现链双重依据的合法等价形（`U[]` TypeRef 数组）恢复 AC1-5 的可编写性，memo 碰撞覆盖与红灯敏感性完整保留。核心机制面（共享谓词、双点同步收窄、memo 哨兵键、§8 例外逐字落文、排除面纪律）经全锚点复核与 ADR 0021 逐条比对持续成立。设计达到可安全实施状态，**approve**；后续由 SA3 实现、SA4 复核（含 D-H 断言修订与枚举变更集 diff）、SA8 三项复查与 SA7 活链路验证接力。
