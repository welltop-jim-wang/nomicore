# Issue #111 冻结设计攻击评审（SA2）

**Verdict: REJECT**（存在 HIGH）  
**审阅对象**：`wiki/raw/task_namespace-registry-create_design.md`（368 行，已通读）  
**权威对照**：ADR-0009、#110 冻结设计/Rev2、当前 Persistence/Runtime/doc-runtime/vfsl/Clock 源码。

## 发现清单

| # | 严重度 | 位置 | 攻击描述与证据 | 建议修法 / 红灯测试 |
|---|---|---|---|---|
| 1 | **HIGH** | §3、§7、§9（DQ-4） | **sanitized projection 与已冻结公开行为及 ADR 的“完整底层 issues”冲突，且没有真正实现零回显。** ADR-0009:87 明定“验证型 issue 内嵌对应完整底层 issues”；现有 lease 写路径把同类 `validateLogicalSnapshot` / builder issues 原样作为 `issues: unknown[]` 公开透传（`namespace-runtime/src/write.ts:146-148`，`schema-write.ts:175`）。设计却把 `message` 改常量，重定义“完整”为数量/顺序/path/分类，属于未获授权的公共契约改写。反过来，保留原始 `path` 同样会泄漏 hostile key：vfsl 对未知字段在 `path` 放入 `k`（`validate.ts:574-578`），Record key 也在 path 内（L270-279）；builder F7 同理（`detached-build.ts:151-157`）。故“固定 message + 保留 path”既不满足严格 zero-echo，又不能说是原样完整 issues。 | **裁决建议：选择“verbatim 透传”**，将 ADR 的“完整”按既有写路径解释为完整原对象（message/path/顺序/数量），并将零回显负锁限定于顶层公开 `message`、identity、输入整体、cause/stack，不能宣称每个 validation issue 无输入字节；这是唯一与既出货公开面及 ADR:87 一致的方案。若产品安全要求确实是“issue 内任何输入字节零回显”，必须由 ADR/AC 显式修订后采用**全 sanitize（message、path、分类中一切自由文本）**，并承认不再是 ADR 所称完整 issue；不得采用半吊子 SA1 方案。红灯：在 schema/root key 放 sentinel，verbatim 方案断言 result.issues 与底层结果深等；全 sanitize 方案断言 `JSON.stringify(result)` 不含 sentinel（含 path），同时断言稳定 index/count/category。 |
| 2 | **HIGH** | §5:130-141、§7:214-220（DQ-6） | **unknown `createDoc` 一律谎报 `committed:true`，违背事实准确性而非仅“保守”。** 当前 `PersistenceLifecycle.createDoc` 在任何 await 前同步执行 `assertWritable()` 与 `validateCreateDoc()`（`lifecycle.ts:181-184`）；disposed 时 `assertWritable` 是裸 Error（状态逻辑 L149-154，对应实现）；`validateCreateDoc` 的 META 不符也是裸 Error，且发生于 claim/写入前（L456-461）。registry 私有 seam 自己构造坏 META、或 adapter 调用前被 disposed 时，都会落入设计的“unknown → true”（设计 L139-141），调用方会被告知已提交，继而不重试，并可能去 open 一个根本不存在的 namespace。设计引用的 post-commit 窗口只证明“有些 unknown 可能 true”，不能将 Registry 可归因的 pre-commit unknown 伪造为 true。 | **裁决建议：按可知边界分类。** 在调用 `createDoc` 前记录 Registry 已完成准备但 Persistence 未返回；对已冻结 `PersistenceLifecycle` 的可识别 pre-call/同步 throw（尤其调用表达式同步 throw）包装 `committed:false`；但 TypeScript `async createDoc` 的同步 throw 会变为 rejected Promise，因而更稳妥的长期正确方案是把 Persistence 契约补为“所有 create failure 必须 typed，含 pre-commit internal/disposed”，Registry 只原样传播 `DocCreateFatalError.committed`；在该契约未成立前，不得断言 unknown=true，至少将其标为无法判明的 fatal（需要扩大 fatal 类型）而非 boolean 假事实。红灯：注入 `createDoc` 在无写前抛 `Error`、以及触发 `validateCreateDoc` META 不符，断言 fatal committed=false；另以 post-write/create-entry fault 注入验证 true。 |
| 3 | **HIGH** | §4:89-100（DQ-1） | **“接纳不执行敌意输入”与所选 descriptor-only identity 算法不可同时成立。** #110 已明确 invalid 零访问**不承诺零 Proxy/descriptor trap**（open design L181-203）。`Object.getOwnPropertyDescriptor(proxy,'owner')`、`Object.getPrototypeOf`、`Object.keys` 都会触发 Proxy traps。设计 L89/L91 却把接纳期对 `input.owner` 的 descriptor 读取描述为“最小读取”，但没有承认 trap 会执行，且 §4 L98 要求以枚举/descriptor 检查 payload 顶层，`ownKeys` trap 同样会执行。若 #104 story 40 的“同步接纳不执行敌意输入”是硬要求，该设计不可实现；若允许 trap，必须精确定义其异常只映射为普通 input/identity issue 而不会伤害 registry。 | 修改文字与 AC：接纳期只承诺“不读取 schema/root value、不调用 accessor getter、零 Registry/Persistence/Runtime side effect”，明确 Proxy 元操作 trap 在 JS 中不可避免且 catch→窄 issue；或若必须零敌意执行，则只能要求 primitive/可信预投影 API，属于破坏性接口改动。红灯：top-level proxy 的 `getOwnPropertyDescriptor` 计数/throw；owner proxy 的 proto/descriptor trap；槽内 payload ownKeys trap throw。分别断言所允许的 trap 次数、稳定结果、零 carrier/Persistence（identity 失败）或仅本 slot 失败（payload）。 |
| 4 | **MEDIUM** | §5:112-118（伪码） | closing 分支的 await 后仅判断 `after?.phase === 'active'`，随后直接 snapshot，而未明确重评估 `after==='closing'`、`after===undefined` 或 close 拒绝的行为。当前 #110 明说 closing/closePromise 是不可达预留（open design L18-20），但 #111 伪码声称 future-compatible。`closePromise?` 是 optional（L221），非空断言只能消除类型错误，不能建立运行时不变量；错误 future implementation 可造成 await undefined、再次 create 与未完成 close 并行，破坏单 key generation。 | 此切片最好删除不可达 closing 分支并写“#112 实现时统一接管”；若必须保留，建立 Entry invariant：`phase==='closing' => closePromise defined`，await 后 loop/re-evaluate until not closing，close reject 转 branded lifecycle fatal，且只在确认 no entry 后 snapshot。红灯：testing seam 人为置 closing + deferred close，验证 create 不读 payload/Clock/Persistence 直至 close settle；close 后 active、undefined、再次 closing、reject 四分支。 |
| 5 | **MEDIUM** | §6:184、§9:255（createInitialDocument） | 初始安装设计描述“验证 SCHEMA/META/ROOT”，但未指定对 fresh doc 的 ROOT 容器载体探针与初始**空置**断言，也没有给出 create seam 的精确 `DocRuntimeFatalError` phase 映射。`replaceSchemaAndRoot` 的健壮性依赖 `probeSchemaMap`/`probeRoot`、`transactGuarded`、`verifySchemaFourKeys`，其中 observer/verification 有 `post-commit-verification` 与 observer 逃逸路径（`schema-replace.ts:123-147, 299-324`）。新 seam 自持 fresh doc 可降低风险，却不是“E201/E203 不可能”的证明：`Y.Doc` observer 仍可被同步注册（例如测试或未来 hook），且 transact guard/verify 是对 API 契约的防线，不应仅靠“正常没有 observer”删除或弱化。 | 把 create seam 写成可编译的步骤及 phase 表：prepare（envelope/meta/derived/validate/build + probes）→ `transactGuarded` 一次 transaction → SCHEMA/META/ROOT 三组 verify + snapshot integrity；明确 `pre-commit-internal`、`post-commit-verification`、`observer-escape` 是否是 `DocRuntimeFatalError` 合法词表（必须以现有 `fatal.ts` 为准）。红灯：Y.Doc `afterTransaction` 计数恰 1；注册 observer 改 META/SCHEMA/ROOT 后验证 committed:true fatal；手造 envelope/META/derived 分别是返回领域 issue 还是 fatal，不能含混。 |
| 6 | **MEDIUM** | §7:222-224（DQ-7） | “release 后后续 open 通过 loadDoc 恢复”缺少对底层状态机的精确时序证明。Persistence 的 `loadDoc` 遇到 live cell 会直接 `issueHandle`（`lifecycle.ts:173-179`）；handle release 仅从 live entry handles 删除，可能异步/尚未执行。虽然这一结果通常仍安全（同一 live doc），设计没有说明 runtimeFactory 是否可与原 runtime/handle release 交错，以及 release 永不 settle 时 open 是否必须仍可恢复。#110 Rev2 已为 open factory failure 固化“不 await release，不能被永不 settle 阻塞”（`open_rev2.md:12-42`）；#111 仅说 fire-and-forget，未把 create recovery 测试扩到 live-cell 分支。 | 明确 release 是同步发起、不得阻断 fatal；定义后续 open 允许从 Persistence live cell 取得新 handle并构造新 Runtime，且原失败 Runtime 从未发布。红灯：createDoc resolve 后 runtimeFactory throw；让 handle.release 永不 settle；随后 open 必在 deferred load/handle 路径结算并得到 lease，且无 entries 残留、release 仅一次。 |
| 7 | **MEDIUM** | §2、§6、§14（Clock 迁移） | Clock 必需化的迁移审计没有完成，反而把工作推给 SA3。实际 `git grep -n -E 'createNamespaceRegistry|\\.create\\s*\\(' -- packages apps domains tests` 显示 `createNamespaceRegistryForTesting` 在 `registry-open.test.ts` 有大量调用，其中大量 `{}` 不提供 clock（如 L277、L310、L351 等），`registry-node-dispose.test.ts:82` 也为 `{}`。设计 §8 L241 声称 testing clock 必需、§14 L348 又承认未执行搜索，二者不能保证本票 compile/test 不破。生产 factory 现签名 `options = {}`（`registry.ts:341-347`），设计没有定义缺失 clock 的具体 Error 类型/message。 | 在设计中完成 caller 表（所有调用点或按 helper 归类并逐项迁移），明确生产/testing factory 的 `clock` shape gate：建议 `TypeError('NAMESPACE_REGISTRY_CLOCK_REQUIRED: ...')`，固定、不回显值；列出所有测试改为 manual clock。红灯：production/test factory 的 omitted/null/non-object/`now` 非函数均同步 throw稳定错误；每个 migrated open-only call 显式 clock 并保持原行为。 |
| 8 | **MEDIUM** | §9、§14（测试矩阵/审计） | 测试表列出宏观类别，但遗漏若干 AC/并发关键锚：没有明确 acceptance 已 `shutting-down` 时 create 必须 **零 identity/payload 访问**（ADR-0009:99）；未明确 createDoc gate 挂起期间同 key open 排队、异 key 可同时到达 Persistence；没有“create 成功后 open 返回同一 Runtime identity”的直接断言；并发双 create 的谁先谁后、第二个零 createDocument 调用；clock slot 精确一次（duplicate/payload failure不读）；single transaction 的可观测计数法。§14 声称“超过10 caller暂停”却没有实际搜索结果及暂停判定。 | 将上述逐条加入表并指定 deterministic seam：deferred createDoc/runtime gates + microtask flush；factory identity token；manual Clock call counter；Yjs `afterTransaction` counter（先安装 observer后调用 seam）；关闭/acceptance spies。将实际 grep 输出归档到 §14；本次结果已显示测试调用远超 10，必须按条款暂停总控裁决或将“10”规则改为可操作的分组迁移规则。 |
| 9 | **MINOR** | §8（observer） | 新事件 `create-persist-failed` 与现有 `open-load-failed` 是“资源动作-失败”对称（可接受），但设计没有确定现有 `RegistryObserverEvent` 的 exhaustive switch/测试是否将 `operation:'open'` 写成穷举字面，加入 `'create'` 可能是 source-breaking testing seam。§8 只说“扩展”，未列 consumer 审计。 | 在 §14 caller audit 加 observer event union consumers；若存在 exhaustive switch，更新其断言并做兼容迁移。红灯：open 旧事件断言不变，create event operation 精确 `'create'`、identity 为 frozen projection、observer throw 不改变结果。 |
| 10 | **MINOR** | §2.3、§12（导出/文件范围） | §2.3 只宣称 registry declaration 不含禁词，却未给出 `CreateNamespaceResult → NamespaceLease` 的可达 d.ts 展开审计方法；#110 已要求主入口及可达声明文本 gate（open design L81）。新增 doc-runtime 公共 `createInitialDocument` 直接返回 `Y.Doc`（设计 L167-171），虽非 registry 主入口导出，仍应核对 registry 私有模块没有将该类型推入公开 alias。文件范围允许 doc-runtime public export，但未列其 index declaration 的实际泄漏评估。 | 维持/扩展 declaration emit text test：registry 主入口递归可达声明不得含 `Y.Doc`/`DocHandle`/runtime internal；doc-runtime 主入口可单独含 Y.Doc，且 registry 不得 re-export。红灯：读取 emitted `.d.ts` 而非源码 grep，添加反向泄漏 fixture。 |

## DQ-4 明确裁决

**推荐：verbatim 透传底层 validation/build issues。**

1. ADR-0009:87 的“完整底层 issues”与现有 Runtime lease 写路径的逐字透传构成冻结先例；SA1 重新定义完整性没有权威授权。
2. SA1 的中间方案保留 `path`，而 path 已可含输入 key，不能达成其声称的 zero-echo；它只会牺牲诊断信息却未关闭泄漏。
3. 若安全需求确实高于完整诊断，必须修改权威契约，采取**全 sanitize**（message/path/free-form category 全部稳定化）并以 result JSON 的 sentinel 负锁测试证明；不能继续称为“完整底层 issue”。
4. 两方案均可测：verbatim 用底层输出深等 + 顶层 error/identity/cause sentinel 负锁；full sanitize 用 public JSON 全 sentinel 负锁 + count/order/stable-category 锁。SA1 当前“保留 path”方案无法通过任何“输入字节零回显”的负锁。

## DQ-6 明确裁决

**拒绝 unknown 一律 `committed:true`。**

`createDoc` 的真实 post-commit 窗口不足以覆盖 Registry 可知的 pre-commit 失败，当前 lifecycle 已存在 validate/disposed 裸 Error 前置路径。应推动 Persistence 将所有失败分类成 typed committed-aware error；Registry 原样传播已知 `committed`。过渡期遇到真正不能判定的 adapter breach，应使用显式“unknown commit state” fatal（需契约变更），而不是布尔 `true` 假报。至少，对 Registry/Persistence 可识别的 pre-write failure 应为 `false` 并有回归测试。

## 新攻击面（超出题列重点）

1. **隐式 API 兼容破坏未被版本/迁移约束吸收。** #110 将 `create` 冻结为 `Promise<RegistryOperationUnavailableIssue>`（open design L129-138），#111 直接改为命名输入及可能 fatal reject（设计 L343-345）。这是合法的功能切片演进，但所有已编译调用方的未处理 rejection 风险必须被真实 caller audit 覆盖；当前 §14 明确没有执行。
2. **`createInitialDocument` 的 public API 带出 Y.Doc。** 它与 registry 主入口的隔离可共存，但其 package 级公共扩张应有独立 API/surface 测试，避免以后有人从 registry type alias 间接暴露。
3. **“plain/null prototype + descriptor”不是 Proxy 鉴别。** Proxy 可以伪装全部 descriptor/prototype facts，并在 value get/ownKeys 时作状态化响应；设计必须将其视为 hostile execution、只保证 catch/slot isolation，而不能宣称“拒 Proxy trap”。

## 协议假设依据审查

设计 §13 的“无 HTTP/WS 等协议假设”成立；没有发现需补充网络/端口/第三方服务实测证据的协议假设。Promise run-to-completion、Yjs transaction、Persistence cell 交互属于代码契约，仍须以上述 deterministic tests 锁定。

## 错误处理链路审查

无前端/API UI 状态闭环，适用面为 Promise 结果与 fatal rejection。主要风险是 DQ-6 将确定 pre-commit failure 错报 `committed:true`，属于错误事实而非安全降级；DQ-4 的半 sanitize 则同时造成信息泄漏和诊断契约破坏。未发现把正常必满足前提伪装为降级的独立 CRITICAL，但 create seam 对 envelope/META/derived 的失败分类必须具体化，不能把 internal invariant 静默返回普通 input issue。

## 验证证据

- `git grep -n -E 'createNamespaceRegistry|\\.create\\s*\\(' -- packages apps domains tests`：exit code 0；发现 testing factory 大量 `{}` 调用（Clock 必需迁移未完成），并发现 create placeholder 调用。
- 源码定位：`packages/persistence/src/lifecycle.ts:181-184,456-461`；`packages/namespace-runtime/src/write.ts:146-148`；`packages/namespace-runtime/src/schema-write.ts:175`；`packages/vfsl/src/validate.ts:270-279,574-578`；`packages/doc-runtime/src/detached-build.ts:151-157`。

## 剩余风险清单

在解决 HIGH #1（DQ-4 契约裁决）与 HIGH #2（DQ-6 committed 事实）前，设计不得进入实现。随后仍须落实 hostile Proxy 语义、closing 状态机、Clock 全调用点迁移、initial-doc seam phase/transaction verification 及补全并发矩阵。

---

# R2 修订验证与二次攻击

**R2 Verdict: REJECT**（R1 HIGH 全部闭合；但发现 1 个新的 HIGH，另有 1 个 MEDIUM 未闭合。）

## R1 发现逐条闭合状态

| R1 项 | 状态 | 修订证据 | R2 核验结论 |
|---|---|---|---|
| HIGH-1 DQ-4 半 sanitize / 完整 issues 冲突 | **closed** | 设计 §3:58-71、§7:214-215、§9:266-267、§11:301 | 已按总控终裁改 `readonly unknown[]` verbatim；明确 message/path/顺序/数量不改，且内嵌 issues 不列入 sentinel 负锁。与 ADR-0009:87 和既有 Runtime 透传一致。 |
| HIGH-2 DQ-6 unknown 错报 true | **closed** | §5:135-145、§7:220、§7:224-226、§9:269、§11:303 | 已固定 `committed:false`，给出 typed-only 合法结果、duplicate 自愈及 disposed/META pre-commit 证据；符合总控终裁。 |
| HIGH-3 DQ-1 Proxy/敌意执行措辞不诚实 | **closed** | §1:22、§4:91-101、§9:265、§11:298 | 已承认 JS 元操作可执行 Proxy trap，只承诺 catch 与 slot/Registry 隔离，不再宣称可识别/零执行 Proxy。 |
| MEDIUM-4 closing 分支不完整 | **not-closed** | §5:114-120 | 见下方 R2-M1：`closePromise === undefined` 时仍直接继续 snapshot/create；这正是 #110 预留 optional 字段的危险态，双条件不是安全处理。 |
| MEDIUM-5 initial seam 缺空置/phase/verify | **closed** | §6:188-190、§9:263/274、§11:299；`fatal.ts:12-15,64-76` | 已明确 fresh maps size=0、一个 `transactGuarded`、三类 verifier、三项合法 phase 和 committed 事实；与现行 fatal 词表一致。 |
| MEDIUM-6 post-commit factory recovery | **closed** | §7:230、§9:270；`persistence/lifecycle.ts:173-179` | 设计明确 fire-and-forget、live cell 重签 handle、never-settle release 不阻塞，并列出可执行红灯。 |
| MEDIUM-7 Clock 迁移/门禁 | **closed** | §8:247-251、§9:272、§14:359-369 | 已给固定 TypeError、完整调用点分组和显式 manual Clock 迁移策略。R2 `git grep` 实测行号与 §14:364-365 列表匹配（现状仍是未实施基线，正是待迁移面）。 |
| MEDIUM-8 并发/AC 测试盲区 | **closed** | §9:263-275 | 已列 same-key gate、different-key 并行、Runtime identity、double-create zero factory、Clock count 与 afterTransaction 方法。shutdown 不可达明确留给 #112，而非伪测试。 |
| MINOR-9 observer consumers | **closed** | §8:253、§9:275 | 已要求实际 grep 审计和 exhaustive switch 迁移。R2 搜索确认当前消费者集中于 `observer.ts`、`registry.ts`、`registry-open.test.ts`，可实施时逐项更新。 |
| MINOR-10 声明泄漏审计 | **closed** | §8:255、§9:275、§12:330 | 改为 Compiler API emitted `.d.ts` 递归文本检查并补 doc-runtime surface test。 |
| 新攻击面-1 create rejection 迁移 | **closed** | §14:359-373 | 已记录无现有外部 create caller、测试必须 await/rejects、未来 caller 处置。 |
| 新攻击面-2 doc-runtime Y.Doc 公共面 | **closed** | §8:255、§9:275、§12:330 | 已明确 doc-runtime 可合法泄漏 Y.Doc、Registry 不得间接泄漏并添加独立 surface test。 |
| 新攻击面-3 Proxy 非可鉴别 | **closed** | §1:22、§4:100-101、§9:265 | 已将 Proxy 视作 hostile execution，而非“plain descriptor”可鉴别类别。 |

## R2 新/残留攻击点

### R2-H1 — createInitialDocument 的公共签名无法表达 schema-invalid（HIGH）

**位置**：设计 §6:170-186、§7:214-216，§8:248。  
**触发条件**：Registry 的 `createDocument` 先调用 `compileSchemaEnvelope(schema)`，因此 `schema-invalid` 在 Registry 私有层返回；但 `createInitialDocument` 被设计为 **doc-runtime public** API，输入 `envelope/derived/meta/root`，却只声明：`{ok:true;doc} | {ok:false;kind:'root-invalid';issues}`（§6:170-175）。现行/拟议 doc-runtime 直接调用者可以传入 malformed envelope、meta，或手造 derived；§6:188 又规定 envelope/META/derived 的 prepare 检查，其中“任一领域失败返回 result”。这与其仅允许 `root-invalid` 的 union 矛盾：envelope/meta 值失败究竟是 root-invalid、未定义 kind，还是 pre-commit fatal？

**影响**：实现者会被迫把公共 seam 的调用方输入错误误分为 internal fatal，或把 schema/meta 形状错误伪装为 root-invalid；两者都使公共 API 不能可靠窄化，且 Registry 的 `mapCreateDocumentIssue` 无法根据 `kind` 做稳定映射。此为可实现性/公共契约 HIGH。

**建议修法**：将 public result 精确定义为至少：
`{ok:false; kind:'input-invalid'; issues: readonly LogicalSnapshotIssue[]}`（覆盖 envelope/meta/derived public-boundary domain failure）与 `{ok:false; kind:'root-invalid'; issues: ...}`，或把 envelope/derived/meta 变为不可公开构造的 branded prepared capability；同时定义 Registry 对每种 kind 的 mapping（本票应保证已 compile 的 Registry 路径不会意外产出 input-invalid，出现则 internal fatal，而 doc-runtime direct caller 可得到窄 result）。不可只写“任一领域失败”。

**红灯测试**：直接从 doc-runtime 主入口调用 seam，分别传缺 `text`/多键 envelope、空 docId/non-string createdAt、`derived.structure.kind !== 'root'` 的手造 derived；断言每个有指定、可判别的结果或指定 branded fatal，且零 Y.Doc 出站、零 transaction。另从 Registry 注入畸形 createDocumentFactory result，验证 mapping 不把 input-invalid 错报 root/schema。

### R2-M1 — closing 的 optional closePromise 仍导致并发 create（MEDIUM）

**位置**：设计 §5:112-120、§5:162-164。  
**触发条件**：`entries.get(key)` 返回 `{phase:'closing', closePromise:undefined}`。伪码的 if 条件为 `current?.phase === 'closing' && current.closePromise !== undefined`；条件失败便越过 entry/closing gate，继续 payload/Clock/Persistence create。

**影响**：虽然本切片当前 closing 不可达，#110 的 Entry 将 `closePromise?: Promise<void>` 明确建模为 optional 预留；设计不能将不满足 closePromise 的 closing 态静默当作“不存在 entry”。未来 #112 的部分状态更新、测试 seam、或 bug 可使 create 在未关闭 generation 上运行，破坏 create/open 同 key serialization/唯一 Runtime。标注“future由 #112 定义”并不能让当前伪码安全。

**建议修法**：本票不消费 closing 时，任何 `current?.phase==='closing'` 都应 fail loud（branded lifecycle fatal false）或 await 经 invariant 强制存在的 promise；更简单是沿 #110 exact branch：`if (current?.phase==='closing') { if (current.closePromise===undefined) throw fatal(...false); await current.closePromise; re-evaluate/loop }`。不要以 `&& closePromise!==undefined` 放行。

**红灯测试**：通过 testing-only internal fixture/controlled Entry hook 置 closing + undefined promise，断言 create 不读 payload/Clock、不调用 Persistence，并得到稳定 fatal；deferred promise 情况断言等待与 re-evaluate。

## 新内容二次核验

- **fresh-map 空置断言可测性**：可用 create seam 内部 hook 或在 `new Y.Doc()` 后注册同步 observer 触发 map mutation；但不能仅靠外部调用者“预填 fresh doc”，因为 doc 自持。设计的 afterTransaction=1 和 observer 篡改方案可测。
- **phase 词表**：§6:190 与 `packages/doc-runtime/src/fatal.ts:12-15,64-76` 完全一致：`pre-commit-internal` / `observer-cleanup-throw` / `post-commit-verification`；此项通过。
- **Clock TypeError 文本**：§8:251 的 `TypeError('NAMESPACE_REGISTRY_CLOCK_REQUIRED: Registry 必须提供可调用的 Clock.now')` 是稳定、零回显且可同步断言的具体文案；通过。
- **caller 表真实性**：执行 `git grep -n -E 'createNamespaceRegistry|createNamespaceRegistryForTesting' -- packages apps domains tests`（exit 0）；§14:364-367 的 factory 调用点/行号与当前基线一致，且无生产实例化调用。此为设计期待迁移清单，不应误读为已改代码。
- **测试矩阵新增行可测性**：deferred promise/microtask、manual Clock counter、Yjs `afterTransaction` 均为可确定性实现；但 R2-H1 的 result union 未定会阻塞 initial-doc direct surface tests，须先修正。

## R2 剩余风险

R1 的两个 HIGH 已依据总控终裁闭合。R2 仍有 **HIGH R2-H1**（doc-runtime public result union/领域失败映射自相矛盾）和 **MEDIUM R2-M1**（closing 无 promise 被错误放行）。在修正 R2-H1 前不得进入实现。

---

# R3 修订验证与三次攻击

**R3 Verdict: PASS**。R2-H1 与 R2-M1 均已按要求闭合；未发现 R2 新内容引入的 HIGH/MEDIUM 矛盾。本 PASS 仅放行设计，不替代 SA4/SA7 对实现、类型和活链路的验证。

## R2 问题逐条核验

| R2 项 | 状态 | 设计证据 | 核验结论 |
|---|---|---|---|
| R2-H1：`createInitialDocument` 公共 result union 未覆盖 envelope/META/derived 结局 | **closed** | §6:181-206；§5:137-143；§7:230-234；§9:294；§11:319 | Public union 现为 success / `input-invalid` / `root-invalid` 三分支。§6:200 精确规定 malformed envelope/META → input-invalid 单 issue、ROOT validate/build → root-invalid verbatim、手造 non-root derived → `pre-commit-internal,false` fatal。§5:137-143 与 §7:232-234 进一步规定 Registry 仅映射 root-invalid，若出现结构性不可达 input-invalid 则 observer + create-document-internal false fatal；三处一致。 |
| R2-M1：closing + undefined closePromise 被静默放行 | **closed** | §5:112-125；§7:235；§9:293；§11:328 | 所有 closing entry 先进入 branch；undefined promise 以稳定 internal cause observer 后 reject lifecycle-slot-internal,false，且发生在 payload/Clock/Persistence 前。defined promise 被 await，再查 active→ALREADY_EXISTS / undefined→继续；测试矩阵锁定该时序。§11:328 也登记 open 仍存同型旧坠落，明确 #112 统一修复，未伪称本票已修 open。 |

## R3 独立攻击结果

1. **三分支 kind 判别与 Registry 映射**：通过。`input-invalid` 只承载 doc-runtime direct-input shape/META failures；Registry 的 compile 后 envelope 和自构 META 是强前置条件，故该分支 fail-loud 是正确的内部不变量路线，而不是把用户 schema/root 误升格。schema compile 仍在 seam 前映射 schema-invalid（§6:198），root 失败仍 verbatim（§5:137-139、§7:231-233）。
2. **fatal 参数与 cause**：通过。Registry 不可达 input-invalid 及 closing-missing-promise 都使用 `operation:'create'`、各自稳定 phase、`committed:false`；cause 是新建内部 Error，仅走 observer/cause 属性，公开 branded error 的 stable message 不插入它。该用法符合既有 fatal 分层。
3. **closing 的 defined promise 后再 closing**：当前切片 closing 不可达，§5:124 不自行发明 #112 状态机，且 §11:328 将 open 的同型风险登记给 #112；没有把新 create 行为误称为完整 close 生命周期。后续 #112 必须测试“await 后仍 closing”的循环/失败语义，这是显式剩余工作而非 #111 假承诺。
4. **测试矩阵可测性**：通过。§9:293 的 undefined fixture 可在 testing-only entry hook 下断言零 payload/Clock/Persistence；deferred closePromise 能决定 active/undefined 两种结局。§9:294 的 direct seam 三分支、Registry injected input-invalid、afterTransaction 与 observer 篡改均具确定性，不依赖 sleep。
5. **权威基准一致性**：`DocRuntimeFatalError` 现有 phase 词表仍为 `pre-commit-internal` / `observer-cleanup-throw` / `post-commit-verification`（`packages/doc-runtime/src/fatal.ts:12-15`）；§6:206 未引入不存在的 phase。#110 open 当前实现在 closing+undefined 时仍会坠落（`packages/namespace-registry/src/registry.ts:264-271`），§11:328 如实登记，未把它掩盖为 #111 已解决。

## R3 剩余风险

- #112 必须将 open 与 create 的 closing 状态机统一：包括 `closePromise` 缺失、await reject、await 后仍 closing 的明确 fail-loud/循环策略。
- 实现阶段仍须执行 §9 的 typecheck、Node 20/24、declaration emit 与并发红灯；本轮只确认冻结设计自洽。
