# Spec 轴独立审查 — issue #111：namespace-registry 排他 create 与完整初始 generation

> 审查者：独立代码审查员（Spec 轴）· 只读 · 2026-08-26
> 被审对象：worktree `/home/wangjian/nomicore-fix-issue-111`（基线 cdcf28b）全部未提交改动
> 权威基准：issue #111 原文 12 条 AC（`gh issue view 111` 实测读取）、ADR-0009、
> 冻结设计（SA2 R3 PASS，含 SA4 补遗）、设计冲突报告（DQ-4/DQ-6/R2-M1/HIGH-1 裁决链）
> 方法：12 条 AC 逐条独立核实（实现落点行号 + 测试锚真实性 + 独立结论），非复述总控 AC 核对表。

**Verdict：faithful**（12/12 AC 满足；0 BLOCKER；2 ADVISORY + 3 观察/遗留登记）

---

## 一、12 条 AC 逐条核实表

行号 = 当前工作树文件行号；测试锚文件缩写：`RC`=packages/namespace-registry/test/registry-create.test.ts，
`CI`=packages/doc-runtime/test/create-initial-document.test.ts，`RO`=registry-open.test.ts。

| AC | 实现落点（独立核查结论依据） | 测试锚（用例） | 结论 |
|---|---|---|---|
| **1** 输入面：只接收 owner/namespaceId/schema/完整 ROOT；不接收 META/createdAt；不生成默认 ROOT | `registry.ts:257-277` snapshotCreatePayload：own 键集**恰四个**且键名恰为四者（`keys.length!==4` 拒多/缺键，含 META/createdAt 多键）、逐键 own data descriptor 拒 accessor；`identity.ts:136-146` 顶层非 object→CREATE_INVALID_INPUT。全链路无默认 ROOT 路径：`create-document.ts:112-119` 只消费调用方 root；`create-initial-document.ts:142-149` root 缺失/畸形必 root-invalid。 | RC:877（缺 root→INVALID_INPUT）、620-656（12 变体 payload 矩阵）、533-559（ownKeys trap）。**缺口**：多键/META/createdAt 多键无专属锚（机制已逐行核实覆盖，见偏差 D2）。 | **满足**（机制逐行核实；锚点小缺口见 D2） |
| **2** 槽始读取/冻结；输入缺陷仅本调用失败不毒化 queue | 接纳段 `registry.ts:589-605` + `identity.ts:136-146`：**只 GET owner/namespaceId 两键**，schema/root 值零读取、零 accessor 触及；槽内 `runCreateSlot:668` 才快照，`clonePlainData:288-366` cycle-safe 深克隆+深冻结，下游只消费克隆（`:682-683` payload.schema/root）。排队突变生效/槽后无效由「inputRef 引用入槽、槽始克隆」机制保证。缺陷仅 `return CREATE_INVALID_INPUT_ISSUE`，carrier green tail（`:598-602` catch 化绿尾）继续。 | RC:439-472（排队突变生效）、474-493（槽后突变无效）、495-529（owner 冻结不改 key/owner/docId）；tail 继续 554-558、651-655、857-868、1162-1173、1518-1542。 | **满足**（DQ-1 冻结解释下）。接纳段 GET vs descriptor 的设计措辞偏差见 D1（ADVISORY，不构成本 AC 偏离） |
| **3** identity 校验在 entry/Persistence 前；错误不回显原值 | `admitCreateSlot:592-596`：acceptCreateIdentity 先于 carriers.get/createCarrier；`identity.ts:89-121` validateOpenIdentity（#110 既有，diff 零改动）descriptor-only、typeof 短路先行；issue 只含 field 名+常量 message（`types.ts:64-70`）。 | RC:720-772（21 变体全窄 issue + diagnostics 零 carrier-created + 零 createDoc/loadDoc/factory/Clock）、774-794（namespaceId 短路，owner Proxy trap 零执行）、899-955（sentinel 负锁）。 | **满足** |
| **4** Clock 生成固定 UTC toISOString createdAt；非法输出 pre-commit internal fatal | `registry.ts:423-446` readCreatedAtOrFatal：payload 快照后、compile 前（`:674` 在 `:678` 前）**单次**读数；`new Date(ms).toISOString()`（`:440`）；throw/NaN/Infinity/\|ms\|>8.64e15/RangeError→observer lifecycle-slot-failed(create)+fatal **create/create-document-internal/false**（参数精确）。构造门禁 `assertClockShape:234-242`（生产 `:812`/testing 经 `:380`）固定 TypeError 零回显。 | RC:346/365（FIXED_ISO 精确锚 1700000123456→'2023-11-14T22:15:23.456Z'）、1180-1219（门禁 4+3 变体逐字 message）、1221-1273（now throw/NaN/±Infinity/超界 fatal false 零 Persistence）、1275-1282（±8.64e15 边界接受）、1284-1306（counter 恰读一次：payload 失败/duplicate 不读）。 | **满足** |
| **5** 私有 create-document：编译、原样封闭校验、detached 构造、**恰一个** transaction 安装 SCHEMA/META/ROOT | `create-document.ts:104-119`：compileSchemaEnvelope→validateLogicalSnapshot→构造步（默认 doc-runtime seam）；`create-initial-document.ts:97-108`：**单个** transactGuarded（`fatal.ts:64-76` 确认其内恰一次 doc.transact）安装 SCHEMA 四键+META 二键+ROOT clear+entries。写后四验齐全：verifySchemaFourKeys（`:110`，本地镜像——schema-replace.ts:299 的同名函数为模块私有不可 import，镜像是唯一在 ALLOW 内的形态）、verifyMetaTwoKeys（`:111`，无既有对应物）、verifyInstall（`:112`，**复用** install-verify.ts:44）、verifySnapshotIntact（`:117`，**复用** install-verify.ts:122，R1 裁决②落实）。 | RC:332-392（SCHEMA 四键逐值/META 二键逐值/ROOT 内容 + afterTransaction 恰 1 + fresh-map 空置 369-372）、CI:252-294（seam 成功面同锚 + 读回/extract 一致）。 | **满足** |
| **6** validation/construction failure 不返回 partial Y.Doc 且不调用 Persistence | seam 自持 `new Y.Doc()`（`create-initial-document.ts:152`）**在 validate（:142）与 build（:146）成功之后**才创建——失败时 doc 根本不存在；fail 分支零 doc 出站；三类 fatal throw（pre-commit/observer-cleanup/post-commit-verify）均不携带 doc 引用。Registry 侧：`initial.doc` 仅在 `initial.ok` 后 `:724` 触及；`:685-702` catch 与 `:703-720` 失败分支零 doc 引用、零 createDoc。**逃逸面逐行核查：零逃逸。** | RC 零 createCalls 锚：552/649/714/818/852/1254/1270/1621/1703/1727/1776/1841；CI:196/215/246（`'doc' in result === false`）。 | **满足** |
| **7** active/idle/concurrent/persisted duplicate 统一 NAMESPACE_ALREADY_EXISTS；不退化 open/upsert | 逐分支：`registry.ts:618-621` active（含 lease-zero 临时保留态——entry 不删即 active phase）；`:650-652` closing await 后 active→同码；`:597-603` 同 key carrier FIFO 使并发后项在前项真相后判断；`:726-728` persisted DocDuplicateError→同码。create 路径**零 loadDoc、零 saveDoc**（不退化 open/upsert）。 | RC:958-974（active，零 load/零二次 createDoc/零 Clock 追加）、976-988（lease-zero 临时态）、990-1018（并发 FIFO deferred gate 定先后手，第二个零 createDocument 调用零 Clock 读）、1020-1033（persisted duplicate）。 | **满足**（四源逐分支核实；「idle」=本切片 lease-zero 保留态，符合设计 §1.3） |
| **8** operational→窄结果；fatal committed 原样；unknown committed:false（DQ-6）；duplicate→ALREADY_EXISTS | catch 分支逐行对账（`registry.ts:725-757`）：DocDuplicateError→`ALREADY_EXISTS_ISSUE`（无 observer，符合 §7 表）；DocCreateOperationalError→observer `create-persist-failed` exact cause + `CREATE_FAILED_ISSUE`；DocCreateFatalError→observer + fatal **phase 改写 lifecycle-slot-internal、committed=cause.committed 原样**；unknown→observer + fatal **committed:false 固定**（DQ-6 总控裁决）。四类为 sibling class（contract.ts:45/64/94/142 均直接 extends Error），instanceof 次序安全。 | RC:1037-1061（operational + exact instance 锚）、1063-1095（fatal false，message 逐字）、1097-1117（fatal true 原样）、1119-1139（unknown 锁 false + exact cause）、1141-1160（observer throw 隔离不改结果）、1162-1173（失败后 tail）。SA7-r2 变异「unknown false→true」被击红。 | **满足** |
| **9** createDoc 成功后仍走普通 P0 路径构造 Runtime | 同一 factory 绑定：`registry.ts:381-384`（默认 `createNamespaceRuntimeForRegistry`）；调用点与 open **逐字同形**——`:760` `factory(handle, () => persistence.saveDoc(handle))` 对照 `:569`（open）。entry/lease 建立复用 makeEntry/issueLease。 | RC:332-392（**默认真实工厂**全链：lease.read(['n'])=42、P0 结算后 schema.state ready、真实 getMetadata 投影）、394-412（preparing→ready 轨迹透传）、414-435（factory(handle, notifyDirty) 形状锚）。 | **满足** |
| **10** post-create Runtime 构造失败：释放 handle、保留文档、清理 entry、committed:true fatal、后续 open 恢复 | `registry.ts:759-772` 逐行核查：factory throw→`void releaseHandleBestEffort(handle, id)`（**恰一次**、同步发起、绝不 await；内部 catch→`handle-release-failed` observer，`:503-512`）→observer `create-runtime-construction-failed`→fatal **create/runtime-construction/true**。entry 只在 factory 成功后 `:762-763` 登记（**结构性零 entry**）；零删除/零补偿；后续 open 经 loadDoc 恢复。 | RC:1310-1364（真实恢复链：open 得 lease、createdAt/内容完整、`loadCalls===1` 反证零 entry 残留——若留 entry 首次 open 必零 load）、1366-1404（release reject：恰一次 + handle-release-failed exact + 主 fatal 不被替换）、1406-1450（release 永不 settle 不阻塞 fatal 交付）。SA7-r2 变异「void→await」「entries.set 前移」均击红。 | **满足**（测试锚真实：释放计数/零残留/恢复均有行为级证据） |
| **11** create/open 顺序、独立结算、异 key 并行、失败后 tail 的确定性测试 | 矩阵全覆盖：create→open（RC:1454-1475，factory 恰 1 + marker 同一 Runtime identity + 零 loadDoc）、open→create（1477-1492，NOT_FOUND 不毒化）、createDoc gate 挂起期同 key open 排队/异 key 并行到 Persistence（1494-1516）、unknown fatal 后 tail（1518-1529）、payload 拒后同 key open/create 正常（1531-1542）、mutation 时机三例（438-530）。**零 real sleep**：全 deferred+flushMicrotasks；唯一 setImmediate（:1434）为宏任务排空非 sleep。 | 同左全矩阵。 | **满足** |
| **12** 全量 typecheck/test 与 Node 20/24 CI | 证据存在（按授权不重跑）：sa3_impl.md R2-2 记录 exit code——两包 414/414 exit 0、全仓 `npx vitest run --typecheck` 1333/1333 + Type Errors no errors exit 0、`pnpm typecheck` exit 0、`tsc -p tsconfig.typecheck.json --noEmit` exit 0；R1 记录 `pnpm install --frozen-lockfile` exit 0（锁文件 +3 行已收口，本审核实 diff 属实）；SA7-r2 Node 20.19 docker（node:20-slim）两包 exit 0（412 pass/2 skip，skip 为 #110 既有 await-using 语言级条件跳过）。Node 20/24 CI 矩阵为 PR 级外层门禁（本地双版本已实测，CI 待跑属流程态非实现缺口）。 | sa3_impl.md §R1-2/R2-2 exit code 表；sa7_report.md L96。 | **满足**（本地证据链完整；CI 矩阵待外层门禁执行） |

---

## 二、ADR-0009 §Create 七段逐项对照

| ADR 段 | 实现核对 | 结论 |
|---|---|---|
| L60 输入只含 owner/namespaceId/schema/完整 ROOT，不给 META/createdAt、不可省 ROOT | 恰四键机制（registry.ts:263-266）；无默认 ROOT 路径 | ✅ |
| L62 槽始读取冻结；排队可改；缺陷不毒化；snapshot→compile→validate→detached→Persistence→Runtime 同槽执行，无跨时间 prepared document | runCreateSlot 单槽全链（612-773），冻结次序与设计 §5 伪码逐步一致；payload 缺陷仅本槽窄 issue | ✅ |
| L64 私有 create-document 模块收 namespaceId/createdAt/schema/root；编译、原样封闭校验、detached、单事务安装；失败零 partial；ownership 转移 | create-document.ts + create-initial-document.ts 逐点兑现；doc 仅沿 createInitialDocument→createDocument→createDoc→handle 单向流动，Registry 不持有 | ✅ |
| L66 META.docId===namespaceId；createdAt=Clock toISOString；非法 Clock=create-document-internal/false fatal；owner 只作分区键不写入 META | create-document.ts:77/84 docId:namespaceId；registry.ts:440；fatal 参数精确；META 严格二键由 verifyMetaTwoKeys 强制+测试锚（RC:362-365）——owner 结构性不入 META | ✅ |
| L68 全备后才排他 createDoc；四源 duplicate 同码；不退化 open/upsert；成功后普通 P0；v1 接受 create compile 与 P0 compile 重复 | AC7/AC9 已核；默认工厂 createNamespaceRuntimeForRegistry 内 P0 重编译为设计明示接受项 | ✅ |
| L70 createDoc 已提交+Runtime 构造失败：释放 handle、保留文档、清理 entry、committed:true fatal；不补偿删除/fallback/声称 rollback；后续 open 可恢复 | AC10 已核（逐行+测试锚） | ✅ |
| §Persistence 错误演进（L74-83）：typed operational→窄 issue；duplicate→already exists；fatal committed 原样；unknown 不伪装 operational；稳定 message 不拼 cause | AC8 已核；全部公开 message 为常量（types.ts:48-57），fatal message 模板只插 operation/phase/committed（errors.ts:34） | ✅ |

补充：§Fatal 词表（runtime-construction/create-document-internal/lifecycle-slot-internal）与 types.ts:80-83 完全一致；§公共 Interface（open/create/getStatus/shutdown + testing seam 纪律）一致。

## 三、设计裁决落实核对

| 裁决 | 落实证据 | 结论 |
|---|---|---|
| DQ-4 verbatim issues（内嵌完整底层 issues 原对象逐字透传；负锁仅 Registry 自创面） | registry.ts:180-196 仅冻结外层、数组本体保持底层引用；RC:815/848 与底层直接输出**深等**（同测试内现算 direct 对照，非恒真）；RC:899-955 负锁只查顶层 message/name/stack 且正向断言 observer 侧可见 sentinel（豁免边界正确） | ✅ |
| DQ-6 unknown committed:false | registry.ts:750-756 固定 false + 注释引裁决；RC:1119-1139；SA7-r2 变异击红 | ✅ |
| closing 三态 fail-closed（R2-M1/SA4 HIGH-1） | registry.ts:622-666：missing closePromise→fatal false（payload/Clock/Persistence 前）；await reject→exact cause 包装不裸传；await 后 active→ALREADY_EXISTS/undefined→放行/仍 closing→fatal false 不建 loop。RC:1546-1813 四变体（含 hostile schema Proxy 全程零 trap 执行锚 1674-1729、变体 C 种子函数 generation 迁移对照绿锚） | ✅ |
| testEntries 边界（§8 补遗） | 仅 registry.ts:121 NamespaceRegistryInternalOptions；index.ts/testing.ts 零导出（testing.ts:24-38 无此键）；package.json exports 仅 `.`/`./testing`；唯 RC:36 经 `../src/registry.js` 相对通道消费 | ✅ |
| Clock 必需化迁移（§14 caller 表） | RO/RC/dispose 测试全部显式 manualClock；生产工厂 options 去默认值（diff 核实 `-options = {}`）；无生产 caller（全仓 grep 实测） | ✅ |

## 四、测试-规格互证抽查

- **verbatim 深等锚真实**：RC:799-815/824-848 与 CI:236-248 均在测试内对同一输入现调 `compileSchemaEnvelope`/`validateLogicalSnapshot` 取 direct 输出做 `toEqual` 深等——非恒真、非绕路；并断言 `issues.length>0` 防空数组假绿。
- **负锁范围正确**：仅顶层 message/name/stack 做 sentinel 负锁；内嵌 issues 明确豁免且 observer exact cause 正向锚（RC:944-953，`.cause.cause` 先例对齐 open）。
- **per-doc afterTransaction 锚真实**：WeakMap 按 doc 登记、只锚目标 doc（RC:256-287/CI:122-153），scratch 重放事务归入 scratch 自身条目——与共享 verifySnapshotIntact 复用相容；`txCount===1` 为行为级单事务证据。
- **零 entry 残留锚巧妙且真实**：RC:1357-1363 以 `loadCalls===1` 反证（留 entry 则首次 open 必命中零 load），非口头断言。
- **closing 红灯非伪测试**：变体 A 以 hostile schema Proxy 的 `schemaTraps===0` 锁「等待期+失败后全程零 payload 读取」（RC:1700-1729）。
- 抽样未发现恒真断言；SA7-r2 五项变异全部击红佐证锚的咬合度。

## 五、公共契约兼容性

- create 签名替换完整：types.ts:288 `create(input: CreateNamespaceInput): Promise<CreateNamespaceResult>`；实现层 `unknown`（registry.ts:785-793）对齐 open 双层先例；`RegistryOperationUnavailableIssue.operation` 收窄为 `'shutdown'`（types.ts:141-146）并移出 index.ts 导出（diff 核实）；全仓 grep 无残留 create 占位断言（RO:722-737 仅剩 shutdown 占位断言且原样保留）。
- shutdown 占位零变化（registry.ts:798-801）；getStatus 恒 running 不变。
- open 既有行为零变化：registry.ts diff 中 runOpenSlot/admitOpenSlot **零删除行**；RO diff 全部为 `clock: manualClock()` 迁移注入 + create 占位断言迁出（迁至 RC 真实行为）+ 一处 sentinel 用例 `as never` 适配（零回显断言原样）——确为纯迁移。

## 六、偏差清单

**BLOCKER：0 项。**

| # | 级别 | 证据 | 影响 | 修法 |
|---|---|---|---|---|
| D1 | ADVISORY（冻结设计措辞偏差，不违反任何 AC） | `identity.ts:142` 以属性 **GET** 读取 `input.owner`/`input.namespaceId`；冻结设计 §4（DQ-1）明文「接纳**仅从顶层 descriptor** 获取 owner/namespaceId，**拒绝 accessor**」、§1.3 不变量「同步接纳…不执行 accessor getter」。RC:561-584 测试注释亦确认实现为 GET 语义。 | owner/namespaceId 的 accessor getter 会在**接纳段**执行（设计排除的敌意代码执行窗）；accessor 输入不在接纳段被拒（会产生 carrier-created diagnostics），而是在槽内快照段（registry.ts:268 拒 accessor）以同一窄 issue NAMESPACE_CREATE_INVALID_INPUT 收场。最终公开结果、queue 隔离、零 Persistence/Clock/createDocument 均与设计一致——差异仅为 getter 执行时机/位置与 carrier 一次性创建。 | 二选一：(a) 实现对齐设计——接纳段改 `Object.getOwnPropertyDescriptor(inputRef, k)` + `'value' in desc` 检查，accessor→CREATE_INVALID_INPUT（注意保持 trap throw→窄 issue 的 catch  semantics）；(b) 经总控修订设计 §4/§1.3 措辞为「身份两键容许 GET，getter throw→窄 issue」并补敌意 getter 红灯。建议 (a)，因设计措辞是 R3 PASS 的冻结面。 |
| D2 | ADVISORY（测试锚小缺口；机制已核实） | AC 核对表声称「缺 root/多键/META/createdAt 全拒」锚于 RC 输入形状矩阵；实测只有缺 root（RC:877）与 trap 变体，**多键/META/createdAt 多键与「四键但键名错」分支无专属用例**。机制（registry.ts:263-266 长度+键名双查）逐行核实覆盖，且长度分支已由缺 root 锚定。 | 规格点实现真实但锚定不完全；键名错分支（4 键含错名）无任何用例触达。 | RC 增补：5 键（多 META/createdAt）与 4 键错名（如 meta 替换 root）各一例断言 NAMESPACE_CREATE_INVALID_INPUT + 零 Clock/零 Persistence。 |

**观察项（非偏差，如实登记）：**

1. create-document.ts:108-111 在 Registry 私有层**预校验** ROOT（设计 §6 行文中校验位于 seam 内；实现两层各校验一次）。结局逐字节一致（同一 vfsl 函数、verbatim issues）；副作用是注入 testing factory 永不收到 invalid root（RC:851 `documentFactoryCalls===0` 已锚）。与 ADR L64「私有模块…原样封闭校验」措辞一致；属设计行文与实现分层的选择差，不改变任何可观测结局。
2. CreateDocumentFactory 内部类型带第 5 参 `compiled`（create-document.ts:52-58），超出设计 §8 的 4 参 testing 形状——JS 语义安全（注入方忽略多余参数），testing.ts 公开声明面仍为 4 参，未泄漏。
3. SA3 档案 §1 记「namespace-registry patch 0.1.1→0.1.2」，实际 diff 无版本变更（基线即 0.1.1）。private 包版本非规格面；仅档案记载失准。

**遗留登记（沿用 SA7/总控既有裁决，非本审新发现）：**

- 注入 createDocumentFactory 返回畸形（非 union）时首处 fatal phase 为 lifecycle-slot-internal 而非 create-document-internal——fail-loud 性质不变，总控已登记待后续票收敛词表精确性（sa7_report.md L126）。
- open 既有 closing+closePromise===undefined 静默坠落为 #110 残留，设计 §11 明示 #112 统一收敛，本票按约束未改 open。

## 七、结论声明

12 条 AC 全部独立核实**满足**（实现落点+真实测试锚双重证据），ADR-0009 §Create/§Persistence 错误演进/§Fatal/§公共 Interface 零偏差，冻结设计 DQ-4/DQ-6/R2-M1/HIGH-1/testEntries 边界全部落实，公共契约替换完整且 open/shutdown 零行为漂移。**除第六节 2 项 ADVISORY（D1 接纳段 GET-vs-descriptor 设计措辞偏差、D2 输入形状测试锚小缺口）与 3 项观察/遗留登记外，无其它偏差。** 两项 ADVISORY 均不改变任何 AC 的可观测结局，不构成 divergent。
