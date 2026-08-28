# SA2 delta 攻击评审 — issue #133 round=2 R-FIX-1 分类学微演进

**Date**: 2026-08-28 07:52 (+0800)
**Review target**: commit `8b1398f`（`fix(#133 r2): snapshot resetReplica expected identity at the public entry (SA4 R-FIX-1)`）
**Scope**: 仅裁决 R-FIX-1 引入的 reset expected 输入拒绝分类学、公共类型面、入口次序/零副作用、测试锚强度与 round-1 冻结语义回归。SA4 全量报告对其余 R2 实现的结论不在本轮重验。
**Verdict**: **reject** —— 入口快照、零 Persistence 触达、TOCTOU 免疫和 open/create 运行时零回归本身通过；但当前采用「复用 `NAMESPACE_INVALID_IDENTITY` + 扩展共享 `InvalidIdentityIssue.field`」的分类学落位**未获得 SA1 显式设计授权，且公共 message 与实际缺陷字段相矛盾**。AC 门禁不得以当前形态通过，须按下方方案 B 返工并走 SA1 微设计追加 + SA2 复审。

---

## 1. 逐议题裁决表

| # | 议题 | 结论 | 关键证据 |
|---|---|---|---|
| 1 | `field` 判别字 additive 扩展 | **不通过（红线/公共类型面）**。设计 §3.2 只授权「格式错误按 `NAMESPACE_INVALID_IDENTITY` 语义族处理」，没有提出把 round-1 冻结的 `field: 'owner.userId' | 'namespaceId'` 扩为第三个成员；§8 类型变更清单也未登记该共享形状演进。当前扩展首先出现在 SA3 实现/SA3 报告，属于事后实现裁决，不满足任务简报「SA1 设计明确提出 + SA2 评审通过」的闭环。 | 任务简报 `task_phase5-bootstrap-archive-reset-r2.md:49-53`；R2 设计 `..._design.md:60-82`、`:465-472`；round-1 原始冻结 `task_namespace-registry-open_design.md:106-110`；`types.ts:112-122`；`8b1398f` 未改设计文档（`git diff --name-only 8b1398f^ 8b1398f -- wiki/raw/task_phase5-bootstrap-archive-reset-r2_design.md` 为空） |
| 1a | §3.2 是否足以授权类型面扩展 | **不足**。「沿既有 `NAMESPACE_INVALID_IDENTITY`/内部 API 前置约定处理」可以授权语义族与入口次序，但不能隐含授权一个共享公共判别字联合的演进。该 phrase 若按字面「零新错误码」解释，反而正暴露没有现成诚实落位的问题：既有 issue 的两个 field 均不能描述 expected 参数。 | R2 设计 `:81`；SA4 全量报告 `:42-47` 已认定该结果通道缺口并要求 SA1 微追加；`8b1398f` 的选择记录在 `..._sa3_impl.md:55-62`，非 SA1 设计 |
| 1b | 全仓既有 `field` 消费者 | 当前仓库**无运行时行为漂移证据**：生产代码没有按 `field` 分支/exhaustive switch；直接 `.field` 读取仅在 registry 测试断言。但这不能把共享类型演进降级为无影响——对未来调用方，`field` 联合扩大可使 exhaustive switch / 旧窄类型赋值失效。 | `git grep -n "\.field\b" -- 'packages/**/*.ts' 'apps/**/*.ts'` 仅命中 `registry-create.test.ts:961`、`registry-open.test.ts:304`、`registry-phase5-identity-red.test.ts:270,520`；`git grep -n "switch ... field"` 无命中；apps 无消费者 |
| 1c | 声明图/公共面影响 | **是公共契约演进**。`InvalidIdentityIssue` 虽未从主入口按名导出，但作为 `OpenNamespaceIssue` / `CreateNamespaceIssue` / `ImportReplicaIssue` / `ResetReplicaIssue` 的成员进入主入口导出的结果类型，field 联合随之进入公共声明图。不能称为「共享形状零破坏」。 | `types.ts:188-205`、`:253-288`、`:302-344`、`:351-378`；主入口 `index.ts:31-56` 导出四个 Issue/Result 类型 |
| 2 | message 精确性 / A vs B | **阻断：判 A 不可接受，采方案 B**。`NAMESPACE_INVALID_IDENTITY_MESSAGE` 是 round-1 冻结原文「owner.userId 或 namespaceId 不符合安全文法」；当前 reset expected 缺陷返回 `field='expectedLocalIdentity'` 却携带声称 owner/namespaceId 坏的 message，结构化判别与人类可读诊断相互矛盾。未来 Hub 调用方只看日志/message 会去检查本来已通过校验的 owner/namespaceId。`field` 承载真相不能洗白 message 的虚假枚举。 | 原始冻结 `task_namespace-registry-open_design.md:108`；当前 `types.ts:49-51`、`:112-122`；错误常量 `registry.ts:468-478`；import 侧专用先例 `types.ts:97-102`、`:325-334`，R2 设计 §4.2.1 `:370-379` |
| 3 | R-FIX-1 测试锚强度 | **行为锚总体真实，非自证循环**：16 形态、`probeCalls=[]`、零 archive、lease/runtime 保持、正确重试首次 probe 计数、可变对象冻结样本、observer 恰一次均为可失败行为断言。缺口是没有断言新分类学的 `field`/message——在本次争议正是核心对象；若采 B，测试必须锁新 code+message。 | internal 测试 `:98-121`（16 形态）、`:648-676`（hostile + 零触达/重试）、`:679-699`（TOCTOU 冻结样本）、`:704-738`（observer） |
| 4 | 入口零副作用与次序 | **通过**。源码顺序是 acceptance → `validateOpenIdentity` → `snapshotReplicationIdentityRef` → 才调用 `admitResetSlot`；carrier 创建/entry 查询/Persistence 访问均在后。getter/Proxy trap 由 `try/catch` 收编，产物冻结，message 恒定零回显。 | `registry.ts:1899-1916`；carrier 创建 `:1533-1545`；snapshot 判据与 catch `:252-280`；issue 常量 `:468-478` |
| 5 | 冻结语义回归 | **运行时通过，静态公共契约不通过**。`identity.ts`、open/create 构造点未改，open/create 仍只会产生旧两个 field；`NAMESPACE_INVALID_IDENTITY` 在 open/create 下的语义未漂移。但 `InvalidIdentityIssue.field` 公共类型被扩宽，正是议题 1 的未授权演进。 | `git show 8b1398f` 生产 diff 仅 `registry.ts` / `types.ts`；`identity.ts:69-85` 未变；`types.ts:117-122` 是唯一静态形状变更 |
| — | F-1 observer 测试 | **通过（LOW 注记）**。真实注入 `DOC_ARCHIVE_OPERATIONAL` 并断言事件恰一次、cause 不含 `ID_A/NS_B/u-alice`，不是标题/源码存在性断言。测试标题「事件载荷不含身份值」比实际断言宽：它只检查 cause；事件标准 `identity` 字段本来就携带受控 InternalIdentity。建议改标题为「cause 零复制身份/标识回显」，非阻断。 | internal 测试 `:704-738`；observer 契约 `observer.ts:1-8`、`:50-53` |

---

## 2. 攻击点清单

| # | 严重度 | 攻击面 | 触发条件与影响 | 可执行修订要求 |
|---|---|---|---|---|
| D-1 | **CRITICAL / BLOCKER（冻结分类学红线）** | `InvalidIdentityIssue.field` 共享判别字被 SA3 直接扩为 `'expectedLocalIdentity'` | 任何外部或未来 Hub 调用方依赖该公共结果类型穷尽处理 field 时出现编译/行为兼容面变化；更根本的是该演进没有 SA1 设计文本提出，违反 round=2 任务简报设计约束。 | 采方案 B：回退 `InvalidIdentityIssue.field` 到 `'owner.userId' | 'namespaceId'`；reset expected 缺陷走 reset 专属 append-only issue。SA1 必须先在设计 §3.2/§8 登记确切 code/message/结果联合成员，再交 SA2 复审。 |
| D-2 | **HIGH / BLOCKER（诊断诚实）** | 复用 `NAMESPACE_INVALID_IDENTITY_MESSAGE` 但实际坏参数是 expected | 返回对象同时说 `field='expectedLocalIdentity'` 与「owner.userId 或 namespaceId 不符合安全文法」。调用方日志/工单会误指向 owner/namespaceId，形成真实误诊向量；import 侧同类输入已有专用 code+message 先例，reset 无理由不对称。 | 方案 B：新增 `NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID` + 专用恒定 message，如 `'NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID: 期望本地复制身份（reset expectedLocalIdentity）不符合安全文法'`，并加入 `ResetReplicaIssue`。 |
| D-3 | MEDIUM | 新测试未锚定争议分类学 | hostile matrix 只断言 `code='NAMESPACE_INVALID_IDENTITY'`，不检查 `field` 或 message；SA4 增量报告以 field 精确性为辩护，但测试并未锁定该行为。 | B 落地后断言完整 `{ok:false, code:'NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID', message:<新常量>}`（并可视需要断言无 `field`），同时保留 `probeCalls=[]`、零 archive、lease active/ready、正确重试成功。 |
| D-4 | LOW | F-1 测试标题过宽 | 标题声称「cause/事件载荷不含身份值」，实际只序列化 cause；事件标准 identity 字段按既有 observer 契约携带受控标识。 | 修改测试标题/注释措辞为「cause 零身份值回显」；不要求改变事件契约。非本轮阻断。 |

---

## 3. 方案 B 最小返工面

1. **SA1 微设计追加先行**（不能由 SA3 报告事后补记）：
   - §3.2 将 expected 格式错误的结果通道从含糊的「沿既有 code」改为明确的：
     - code：`NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID`
     - message：`NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID: 期望本地复制身份（reset expectedLocalIdentity）不符合安全文法`
     - 归属：仅 `ResetReplicaIssue` append-only 成员；`InvalidIdentityIssue` 继续只描述 owner.userId/namespaceId。
   - §7/§8 登记 `types.ts` 的 reset issue/message 与测试/公共联合影响。
2. **生产代码**：
   - 回退 `packages/namespace-registry/src/types.ts:120` 为二元 field 联合，恢复「open/create 共用」注释。
   - 删除 `RESET_EXPECTED_IDENTITY_INVALID_ISSUE` 的旧形状，改为新 code + 专用 message 的 frozen issue。
   - `resetReplica` 的安全快照与次序保持 `registry.ts:1907-1916` 不动，仅替换失败返回常量。
3. **测试**：
   - R-FIX-1 16 形态断言新 code + 新 message；保留 `probeCalls=[]`、`archiveCalls=[]`、lease active、runtime ready、正确 expected 重试成功且 probe 首次计数为 1。
   - 增加保持性类型锚：`Extract<OpenNamespaceIssue, {code:'NAMESPACE_INVALID_IDENTITY'}>['field']` 仍为二元旧联合；`ResetReplicaIssue` 含新 code。由于 `InvalidIdentityIssue` 未按名导出，经公开 result alias 断言即可。
   - 保留可变 expected 冻结样本用例与 F-1 observer 用例。
4. **流程**：SA1 addendum → SA2 快速 delta 复审 → SA3/SA4 增量复审 → SA7 仅重跑受影响目标集。当前 SA7 pass 不能替代这个类型/分类学闭环。

---

## 4. 对 SA4 增量报告 A 方案论证的回应

- **「ResetReplicaIssue 已含 InvalidIdentityIssue，故有诚实落位」**：不成立。含的是冻结形状 `field:'owner.userId'|'namespaceId'`；expected 缺陷没有现成诚实 field。为了让旧容器容纳新事实而扩共享 field，正是需要 SA1 明示的公共契约演进。
- **「message 没有宣称本地 mismatch」**：这只是避开了最严重误报，不代表 message 准确。它仍明确宣称 owner.userId 或 namespaceId 不符合安全文法，而这两个参数已经通过前置校验。诊断诚实要求 code、field、message 对同一事实一致。
- **「无当前 exhaustive switch，零 caller ripple」**：当前仓库成立，但公共声明图已经扩大。以「当前没人消费」豁免冻结分类学审批，会架空任务简报红线。
- **「expectedLocalIdentity 是设计已有参数名，非新词」**：参数名不是 issue 判别字 vocabulary。把参数名字符串加入公共 error field 联合，仍是分类学/类型面演进。
- **import 先例**：`NAMESPACE_IMPORT_EXPECTED_IDENTITY_INVALID` + 专用 message（`types.ts:101-102`、`:330-334`）是同构场景下的既定设计选择。reset 采用 B 才与该先例和爆炸半径原则一致。

---

## 5. 红线测试思路（B 后）

1. **分类学精确性红灯**：对 16 个 hostile expected 逐项断言完整新 issue（code/message，无 owner/ns mismatch）；owner/namespaceId 各自非法时仍返回旧 `NAMESPACE_INVALID_IDENTITY` + 正确二元 field + 旧 message。
2. **公共类型保持锚**：编译期断言 `OpenNamespaceIssue` / `CreateNamespaceIssue` 中 invalid identity field 仍是旧二元联合；`ResetReplicaIssue` append-only 含 `NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID`。
3. **零副作用分界锚**：保留 `stub.probeCalls=[]` 与 `archiveCalls=[]`；正确 expected 重试成功，且 probe 首次计数恰为 1。
4. **TOCTOU 冻结锚**：保留 public call 后改写 mutable expected 的用例，断言 archive 收到 `{ID_A,1}` 冻结样本。
5. **observer 零回显锚**：F-1 继续断言事件恰一次，并将标题收窄为 cause 不含 `ID_A/NS_B/u-alice`；不要声称整个事件 payload 无标准 identity 字段。

---

## 6. 验证证据

- 审查对象与 diff：
  - `git show --stat --format=fuller 8b1398f`：生产变更仅 `registry.ts`、`types.ts`、internal 测试；另改 SA3 档案。
  - `git diff --name-only 8b1398f^ 8b1398f -- wiki/raw/task_phase5-bootstrap-archive-reset-r2_design.md`：无输出，证明未做 SA1 设计追加。
- 消费者审计：
  - `git grep -n "\.field\b" -- 'packages/**/*.ts' 'apps/**/*.ts'`：仅 4 处 registry 测试读取；无生产消费者、无 switch。
  - `git grep -n -E "\bfield\b" -- packages/namespace-registry apps`：生产侧仅 `identity.ts` 构造旧二元 field 与本次 `registry.ts/types.ts` 新增。
- 类型检查：`pnpm typecheck` → exit 0（全 10 个 package tsconfig）。
- target commit whitespace：`git diff --check 8b1398f^ 8b1398f` → exit 0。
- 本轮未重跑 vitest，以遵守「唯一可写产物为本报告」的约束；SA7 已提供 internal 15/15 与全量 1757/1757 的运行证据。本 reject 不否定那些行为结果，只阻断其分类学/公共契约落位。

---

## 7. 结论

`8b1398f` 对 R-FIX-1 的**行为修复是真实且有效的**：入口快照先于 carrier/entry/Persistence，敌意 getter/Proxy 被收编，TOCTOU 双读分叉被冻结样本消除，open/create 运行时语义未回归。这部分通过。

但分类学微演进选择了错误的落位：它未经 SA1 显式提案即扩宽 round-1 冻结的共享 `InvalidIdentityIssue.field`，并让公共 message 与实际坏参数直接矛盾。SA2 不追认该事后演进。**当前 commit 不得进入 AC 门禁；按方案 B 返工并完成 SA1 addendum + SA2 复审后重审。**

---

# 第二轮：R4 微设计复审（方案 B）

**Date**: 2026-08-28 08:03 (+0800)
**Review target**: 当前未提交的 SA1 R4 设计增量——`wiki/raw/task_phase5-bootstrap-archive-reset-r2_design.md`（514→615 行；diff 102 insertions / 1 deletion）。本轮只复审该设计增量对第一轮 D-1..D-4 的闭合；`8b1398f` 代码尚未按 R4 返工，代码/测试仍留待 SA3/SA4/SA7 增量验证。
**Verdict**: **带修复项 pass** —— D-1..D-4 全部实质闭合，方案 B 的机制、词汇、公共面与测试口径可批准；但 §3.6.2 三码表对 `NAMESPACE_RESET_IDENTITY_MISMATCH` 的触发条件有一处必须修正的语义歧义（R4-F1）。SA1 按本节给定原句替换后即可进入 SA3；若改用其他措辞需再交 SA2 复审。

## 1. D-1..D-4 闭合裁决

| 原阻断项 | R4 闭合证据 | 裁决 |
|---|---|---|
| D-1：`InvalidIdentityIssue.field` 未授权扩宽 | §3.2:82 明示旧「沿既有 `NAMESPACE_INVALID_IDENTITY`」表述作废并由 §3.6 取代；§3.6.1 R4-D1（design:303）明确回退二元联合、撤销 `'expectedLocalIdentity'`、恢复 open/create 共用语义，并声明共享判别面本轮零演进、不提案任何扩宽；§7 R4 增量（design:539-547）与 §8 R4 ALLOW 注记（design:575-584）登记公共联合/文件触达面。 | **闭合**。「明确不提案扩宽」不是回避：它把共享 shape 恢复为 round-1 冻结状态；唯一新词汇被限定在 `ResetReplicaIssue` append-only 成员，符合「SA1 显式提出 + 本 SA2 复审」闭环。 |
| D-2：message 误述 actual bad parameter | §3.6.1 R4-D2（design:304、309-316）冻结 `NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID_MESSAGE` 专用常量，文本与 SA2 建议原文完全一致，零插值/零值回显；R4-D3（design:305、313-315）规定 reset append-only 成员无 `field`；§3.6.2（design:330-338）区分旧 owner/ns invalid、新 expected input invalid、合法 expected 后的 mismatch。 | **闭合**。code、message、member 归属一致；不再复用 owner/ns 文案。 |
| D-3：hostile 测试未锚分类学 | §3.6.3:342-354 要求 16 形态逐项完整 `toEqual` `{ok:false, code, message:导出常量}`；明确禁止降级回单属性断言；说明 `toEqual` 会拒绝多出的已定义 `field`；要求常量文本字面量锁、保留 `probeCalls=[]`/零 archive/lease ready/重试 probe 首计 1/TOCTOU 冻结样本/owner+ns 旧行为锚；并要求 surface 编译期断言四个公共 alias 中 invalid field 仍为二元联合、新 reset member 非 never。 | **闭合**。测试口径覆盖分类学、常量、公共类型和行为分界。实现时 message 常量需从 `../src/types.js` 包内相对导入（既有先例 `registry-create.test.ts:39`），因为设计同时正确规定 index barrel 零改动。 |
| D-4：F-1 标题宽于断言 | §3.6.3:355 要求 `it` 标题改为「cause 零身份值回显」，断言体与 observer 事件契约零改动。 | **闭合**。 |

## 2. 新增发现

| # | 严重度 | 问题 | 证据 | 修订要求 |
|---|---|---|---|---|
| R4-F1 | **MEDIUM（必须修复，阻塞进入 SA3/AC 门禁）** | §3.6.2 三码表把 `NAMESPACE_RESET_IDENTITY_MISMATCH` 触发写成「expected 合法但 **live/persisted 均不等于**该值」。严格口径是 live 与 persisted **都等于** expected 才可通过；**任一** `identityEquals` 为 false 即 mismatch（含一侧 disabled/不合规/值不等）。当前「均不等于」字面暗示必须两侧都不等，易被 SA3/测试误读成「仅一侧不等不是 mismatch」。 | design:336；与 §3.1:48-58、§3.2:69-76、§3.4:162-166 的「AND 通过 / 任一不等拒绝」冲突 | 将该行触发条件替换为：「expected 合法但 live 或 persisted 任一 `identityEquals` 为 false（含该侧 disabled/身份不合规/值不等）」。若逐字采用本句，视为本复审已批准，无需再开一轮 SA2；其他措辞需复审。 |
| R4-F2 | LOW（文档引用精度，非阻断） | 设计引用「SA2 delta §5.1 / §5.2」，但本报告只有 `## 5. 红线测试思路（B 后）` 下的编号列表，没有 5.1/5.2 子标题。概念可定位，但引用形态不精确。 | design:353-354；本报告 heading inventory：§5 下仅列表 1..5 | 改为「SA2 delta §5 第 1 条 / 第 2 条」。可与 R4-F1 同一文档修正顺手处理。 |

## 3. 三码表 / 取代关系其余审查

- **三码不重合**：`NAMESPACE_INVALID_IDENTITY` 限定 owner/ns；`NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID` 限定 expected 入口快照失败；`NAMESPACE_RESET_IDENTITY_MISMATCH` 限定合法 expected 后的双源 mismatch。除 R4-F1 的「均不等于」措辞外，边界与 Persistence 触达列无重叠。
- **取代关系无死引用**：§3.2:82 与 §3.6.2:338 均明示旧 reset 复用句作废；owner/ns 仍走旧路径并被 §3.6.3:353 要求测试保留。import 侧 §4.2.1 的「under `NAMESPACE_INVALID_IDENTITY` semantics」是既有语义族描述，不与 R4 reset 专属 code 冲突。
- **公共面/导出**：`ResetReplicaIssue` / `ResetReplicaResult` 已由 `index.ts:31-56` 导出，append-only member 经既有 alias 可达；message 常量不进 barrel，测试经包内 `../src/types.js` 导入有既有先例，非死引用。
- **类型锚可行性**：`Extract<OpenNamespaceIssue|CreateNamespaceIssue|ImportReplicaIssue|ResetReplicaIssue, {code:'NAMESPACE_INVALID_IDENTITY'}>['field']` 会命中共享 `InvalidIdentityIssue`，可用于编译期锁二元联合；`Extract<ResetReplicaIssue, {code:'NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID'}>` 在 R4 落地后非 never。
- **R4 diff 纪律**：本轮设计增量 `git diff --check -- wiki/raw/task_phase5-bootstrap-archive-reset-r2_design.md` exit 0；变更仅设计文档，未见代码偷跑。

## 4. 第二轮结论

R4 微设计已经把第一轮 reject 的四个问题全部落到可实现的冻结规格：共享 field 回退、reset 专属 code+message、无 field append-only member、完整深等/常量/公共类型测试锚、F-1 标题收窄。方案 B 本身**通过**。

不能直接 full pass 的唯一实质原因是 R4-F1：三码表对 mismatch 的「均不等于」措辞与全设计冻结的严格双源判定相冲突。完成该句替换（并建议顺手修正 R4-F2 引用形态）后，R4 设计即可放行给 SA3；后续仍需 SA4/SA7 对实际代码与运行链路做增量验证。
