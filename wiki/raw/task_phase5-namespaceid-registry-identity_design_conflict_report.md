# 冲突门禁报告（设计后复审）

- 被审对象：`wiki/raw/task_phase5-namespaceid-registry-identity_design.md`（SA1 R1 设计：§2 决策总表 D-1–D-12 + §4 详细设计 + §5 SA6 锚点矩阵 + §6 红灯面内部冲突上报 + §7 既有测试迁移矩阵 + §8 AC-7 文档对齐范围 + §10 caller 审计 + §11 ALLOW/DENY LIST）
- 冲突基准：`docs/adr/` 0001–0010 全集（10 份，本次设计后复审逐份全读，未抽样）+ `CONTEXT.md`；前置门禁相关决议 `wiki/raw/task_phase5-namespaceid-registry-identity_relevant_decisions.md` 作对照底稿
- 上游结论：前置门禁 verdict `clear`（`task_phase5-namespaceid-registry-identity_conflict_report.md`，9 项张力点均 no-conflict）
- 复审日期：2026-08-27（SA8，run_id issue-131-1787792522-3529662，round 1）

## Verdict

`clear`

## ADR 盘点（轻量：仅设计与各 ADR 的实际触碰点）

| 编号 | 状态 | 设计触碰点 | 对照结论 |
|---|---|---|---|
| 0001 | accepted（2026-08-19 修订节） | 无触碰（schema 真相源/方言主题；§11 DENY 覆盖 vfsl 系包） | no-conflict |
| 0002 | accepted | 无触碰 | no-conflict |
| 0003 | accepted | 无直接触碰（create-document 模块逐字复用 `compileSchemaEnvelope`/`validateLogicalSnapshot`，契约零变化） | no-conflict |
| 0004 | accepted | 无触碰（编译期投影轨道） | no-conflict |
| 0005 | accepted | 无触碰 | no-conflict |
| 0006 | accepted（含 #64/#79 修订节） | 是——生成 ID 安全文法（§4.8）、Persistence 零改动（AC-5/D-10，DENY `packages/persistence/**`）、`DOC_DUPLICATE` 信号消费（§4.3.3 ④）、`META.docId` 校验天然成立、ADR 0006 追加对齐说明（D-11） | no-conflict |
| 0007 | accepted（Runtime/open/read 条款由 0008 部分取代） | 无触碰（余留有效条款属校验/物化层，设计经既有 create-document 模块间接消费，零改写） | no-conflict |
| 0008 | accepted（含 #93 稳定码注册修订） | 是（轻）——Runtime 冻结身份投影条款不触碰（§11 DENY `packages/namespace-runtime/**`、`packages/doc-runtime/**`）；lease/owner 投影语义经 Registry 侧保持 | no-conflict |
| 0009 | accepted（**Registry identity / create 输入 / duplicate 映射条款已被 ADR 0010 显式修订**） | 高度——key 迁移（D-6）、create 三键（D-4）、重试取代 already-exists（D-4/D-7）、新 fatal phase（D-5）、randomBytes 注入门禁（D-1/D-2）、observer 加法事件（D-12）、shutdown 编排等待（D-9）、create-document 拆分（D-8）、修订节追加（D-11） | no-conflict（被 0010 修订的三处以 0010 为准，其余条款全部遵守；见明细 1–11 与 N1） |
| 0010 | accepted（**本设计的操作性授权来源**） | 高度——「Namespace identity、owner 与复制范围」节逐句决定 D-3/D-4/D-5/D-6/§4.4.2 | no-conflict |
| CONTEXT.md | 现行 | namespaceId / 复制谱系（边界）/ createdAt / 零写入 / 空闲 Runtime 术语用法；D-11 判定零改动 | no-conflict（namespaceId 词条 113–115 行经本次复核确已是 ADR 0010 词汇，零改动判定成立） |

## 冲突点

（无 hard-violation、无 override-declared、无 evolution。裁决分布：no-conflict × 16 项设计决策对照 + 3 项解读澄清（N1–N3）。）

逐条对照明细（设计决策 → 冲突基准条款 → 裁决）：

| # | 设计决策 | 对照基准条款 | 裁决 | 依据 |
|---|---|---|---|---|
| 1 | D-6：entry/carrier key = `namespaceId`（去长度前缀复合键）；`InternalIdentity` 结构与 `digestKey` 机制不变 | ADR 0009「Registry key 是 `(owner.userId, namespaceId)`。同一 Registry 进程内，每个 key 同时最多存在一个 Runtime」 | no-conflict | ADR 0010 §取代与关联显式修订：「本 ADR 修订 ADR 0009 的 Registry identity：entry key由`(owner.userId, namespaceId)`改为仅namespaceId」；「每 key 至多一个 Runtime」由 §4.3.4 C-1（carrier FIFO）按新 key 语义保持 |
| 2 | D-4/§4.3.1：create 输入三键 {owner,schema,root}；`namespaceId` 键出现即 `NAMESPACE_CREATE_INVALID_INPUT`，零随机/零 carrier/零 Persistence 副作用 | ADR 0009「create 输入只包含 owner、namespaceId、schema 和完整 logical ROOT」 | no-conflict | ADR 0010：「普通 `Registry.create()` 不再接受调用方指定 namespaceId」——同一显式修订节；输入缺陷仅使当前 create 失败不毒化队列（0009）同向保持 |
| 3 | D-4/D-7：碰撞（entry active/idle/closing 或目标 owner Persistence duplicate）一律重生成重试；`NAMESPACE_ALREADY_EXISTS` 码与 message 保留于公共联合、普通 create 不再产出 | ADR 0009「active、idle、并发或 persisted duplicate 统一映射为 `NAMESPACE_ALREADY_EXISTS`；create 不退化为 open 或 upsert」 | no-conflict | ADR 0010：「撞到当前 Registry entry 或目标 Persistence duplicate 时最多重试 8 次，耗尽以 `committed:false` Registry fatal 失败」——映射条款对普通 create 被 0010 重试语义取代（前置门禁张力点 3 同源）；保留联合成员是保守选择（删除属超出授权的契约破坏，切片 2 受信任导入仍需该语义，ADR 0010「复制 bootstrap……不是普通 create」预留该路径），「不退化 open/upsert」保持 |
| 4 | D-5：耗尽 → `NamespaceRegistryFatalError('create','namespace-id-generation',false)`；`committed:false` 恒成立；phase 不在初始三 phase 内 | ADR 0009「初始 phase 是：`runtime-construction`；`create-document-internal`；`lifecycle-slot-internal`」；ADR 0010「耗尽以 `committed:false` Registry fatal 失败」 | no-conflict | 0009 清单明言「**初始**」（开放清单，注册制）；0010 已裁决耗尽 fatal 存在；命名属 SA1 职权（前置门禁事实性提示 1 已登记）；committed:false 论证成立——耗尽路径零 createDoc 成功（任何成功 createDoc 直接登记 entry 返回，结构性不可进入耗尽分支），与 0009「已提交 create 不能被误报为普通可重试失败」的诚实纪律一致 |
| 5 | D-4 预算语义：总生成次数 ≤ 9 = 首生成 + 至多 8 次重试 | ADR 0010「最多重试 8 次」 | no-conflict | 字面读法「重试 8 次」= 初次生成之外再试 8 次（共 9 次生成）；SA6 锚定以宽容区间 [9,10] 收编两种 ADR 读法，设计取严格读法 9 并落位区间内（见 N2） |
| 6 | D-1：`randomBytes` 为 `CreateNamespaceRegistryOptions`/`NamespaceRegistryTestingOverrides`/`NamespaceRegistryInternalOptions` 必需键；`createRegistryInternal` 构造期同步 TypeError；禁 Math.random/全局 crypto fallback | ADR 0009 依赖纪律「缺失任何依赖均在 plugin 启动时响亮失败，不 fallback 到 `Date.now()` 或全局 timer」 | no-conflict | 纪律同款迁移：门禁置于生产工厂与 testing seam 共用构造点，plugin `apply` 内构造缺失 → cordis 加载失败（响亮）；ADR 0010「由**注入的**受控 128-bit CSPRNG 生成」授权该 capability 存在与必需性；检查顺序（clock→scheduler→idleTimeoutMs→randomBytes）保持既有测试锚不动 |
| 7 | D-2：生产随机源 = plugin.ts 桥接 Node `node:crypto`（Buffer→独立 Uint8Array 拷贝）；核心（registry.ts 等）零全局 crypto 直调；不新建 Cordis service / 不新建包；`assertNamespaceRegistryHostDependencies` 依赖清单不变 | ADR 0009 plugin 强依赖清单（Timer/`ctx.timeout()`/Clock/Persistence 三项 Cordis service）；phase-5 切片 1「为Host增加可测试的随机字节/ID capability；核心不得直接调用不受控全局crypto」（补充设计基准，非阻塞依据） | no-conflict | 0009 清单限定 **Cordis service** 依赖，未规定随机源形态；0010 仅要求「注入的受控 CSPRNG」；plugin.ts 是 0009「Host 无关的 Registry 核心、通用 Cordis plugin Adapter」二分中的 Adapter——node 内建于 Host-facing 适配层接线有 ADR 0006 FilePersistence（file.ts `node:fs/promises`）先例；「核心不得直调」由注入 seam + 核心零 crypto 直调满足（见 N3） |
| 8 | D-12：observer union 追加加法事件 `create-id-generation-failed`（owner 投影 + attempt + cause；随机源 throw/形状违约/耗尽各恰一次）；不伪造含 namespaceId 的 InternalIdentity | ADR 0009「Registry核心通过内部结构化 observer seam上报生命周期与故障；event可携带受控 identity和exact cause」+ 公共 Interface「v1不公开……公共events」 | no-conflict | 内部 seam 加法成员，非公共事件订阅；「内部故障必经 observer seam」纪律同向；owner 投影属「受控 identity」许可面；dispatchObserver 隔离语义（observer throw 静默）不变 |
| 9 | D-9：shutdown 在 carrier 等待后追加 `admittedCreates` 编排等待集（重试跨 carrier 再接纳不逃逸结算屏障） | ADR 0009 Shutdown「等待此前已接纳的 lifecycle 操作结算」 | no-conflict | **实施**该条款而非修订：重试使一次 create 跨多个候选 key 的 carrier，「已接纳的 lifecycle 操作」被正确读作调用方的 create（含其全部重试）；等待集在 acceptance 关门后只减不增，快照等待安全 |
| 10 | D-8/§4.3.3：`prepareCreateDocument`（compile+validate，一次/create）与 `buildInitialDocument`（构造，一次/候选）拆分；每候选 admit 到该候选 key 的 carrier 槽；entry 检查先于 payload/Clock/compile；Clock 单读 | ADR 0009「完整 snapshot、compile、validate、detached construction、Persistence create 和 Runtime construction 均在同一个 lifecycle 槽中执行，不产生跨时间 prepared document」 | no-conflict | 0010 的 key 修订 + 重试语义使「单槽执行」结构性不可满足（槽 = per-key carrier，重试必换 key）；条款安全意图四要素全部保持：快照在槽内冻结后才触 Persistence、compile/validate 先于构造、prepared bundle 仅存活于单次 create 编排内部（不外泄、不跨 create）、每候选 build+createDoc 在其自身槽内（详见 N1——本报告最实质的解读点） |
| 11 | §4.3.3 ⑤：createDoc 成功后 Runtime 构造失败 → `releaseHandleBestEffort` + `committed:true` fatal，不进 ID 重试预算 | ADR 0009「如果 createDoc 已提交而 Runtime 构造失败，Registry 释放 handle、保留持久化文档、清理 entry，并以 `committed:true` Registry fatal reject。不得补偿删除、fallback 或声称 rollback」 | no-conflict | 该条款在 0010 修订范围外、持续有效；设计逐字保持并明确重试预算仅碰撞语义（0010「撞到……时最多重试」），已提交事实不被误报为可重试 |
| 12 | §4.3.3 ④：`DOC_DUPLICATE` → retry（未进写路径）；`DocCreateOperationalError` → `CREATE_FAILED_ISSUE`；`DocCreateFatalError` → committed 原样传播 | ADR 0006 #64 修订「`createDoc(owner, docId, doc)`……拒绝 `DocDuplicateError`……在 duplicate 判定路径上绝不覆盖已提交内容」；ADR 0009 Persistence 错误演进节（typed operational / committed-aware fatal / duplicate 稳定类型） | no-conflict | Persistence 契约零改动（AC-5/D-10，DENY `packages/persistence/**`）；duplicate 信号被 Registry 消费后换 ID 重试、从不进入写路径，与「绝不覆盖已提交内容」同向；既有 §7 错误映射表逐字保持 |
| 13 | D-10/§4.8：Persistence 零源码改动；生成 ID `ns-`+32hex（35 字符）满足共享安全文法；旧格式 namespaceId（`k-ns`）继续可 open；跨实例同 Persistence 分区语义不受影响 | ADR 0006「userId 与 namespaceId 共用安全文法 `^[a-z][a-z0-9-]{0,62}$`」「存储按用户分区，namespaceId 在用户目录内唯一」「`META.docId` 必须等于请求的 namespaceId」「v1 不提供 list」 | no-conflict | 文法实测成立：35 字符、首字符 `n`、字符集 `[a-z0-9-]` ⊂ 文法，可直接作目录/META/REST path/WS room；owner 分区与「用户目录内唯一」不受影响（同 namespaceId 不同 owner 分区并存是 0010 明文合法面）；open 文法零改动保持存量文档 round-trip；无 list/catalog 新增（SA6 保持性守卫） |
| 14 | D-11/§8：ADR 0009 追加 issue #131 修订节、ADR 0006 追加对齐说明；CONTEXT.md 零改动；ADR 0010 与 phase 文档零改动 | ADR 修订体例惯例（0006 #64/#79 修订节、0008 #93 注册节均以追加节形式记录、演进经 owner 放行）；任务简报 AC-7「ADR 0006/0009 implementation-facing docs and package contracts are aligned with ADR 0010 vocabulary」 | no-conflict | 追加节内容全部是 0010 已裁决条款的 implementation-facing 记录 + 开放清单注册（新 phase、capability 纪律、already-exists 保留位），无新决策伪装成记录；AC-7 明文授权；CONTEXT.md 113–115 行经本次逐行复核确已对齐（零改动判定成立）；不改 0010 裁决原文与 phase 计划文档 |
| 15 | D-1 类型面：`src/index.ts` type 导出追加 `RegistryRandomBytes`；主入口运行时 export 9 值与 testing 2 值冻结保持 | ADR 0009 公共 Interface「Registry v1公开：open；create；同步 getStatus；shutdown。v1不公开list、entry status、lease count、queue、timer handle、explicit eviction、按key close或公共events」 | no-conflict | 类型导出不新增运行时公共方法或可观测面；禁止清单八项零触碰；testing subpath 增补 randomBytes 替换能力符合 0009「测试 seam……允许替换Runtime/document factory、Clock、timeout和observer」同款用途（确定性测试注入），且不读取内部 entry 结构 |
| 16 | §4.4.2：open 在 entry 命中后、phase 分派前核对 owner，mismatch → 既有 `NAMESPACE_NOT_FOUND` 常量（同码同 message，零 loadDoc、零新 Runtime）；closing recheck 同谓词；entry 无而 (ownerB, nsId) 分区有文档 → 正常 loadDoc 建 Runtime | ADR 0010「普通 open仍显式接收 owner并在复用 active entry前核对；不匹配统一返回 `NAMESPACE_NOT_FOUND`」「Hub 与 Peer可为同一 namespaceId使用不同 owner」；CONTEXT namespaceId 词条「Registry 在当前进程内只以 namespaceId 排他索引」 | no-conflict | 直接实现条款；「不暴露」精确边界 = 不暴露他人 entry/Runtime，非禁止 owner 打开自己分区的同 ID 文档——与 0010 owner=本地属性+分区键语义逐句一致；零存在性泄露（不区分「属他人」与「不存在」） |

## 补充核对（解读澄清，均裁决 no-conflict）

- **N1「同一个 lifecycle 槽 / 不产生跨时间 prepared document」vs 重试跨槽**（本报告最实质的解读点）：ADR 0009 该条款成文于单 key 身份模型（create 目标唯一 key、槽即该 key 的 carrier）。ADR 0010 显式修订 entry key 为仅 namespaceId 并裁决「最多重试 8 次」后，重试候选必落**新 key 的新 carrier 槽**——「全部步骤同一槽」与「重试」联合不可满足，条款字面在新模型下结构性失效。裁定不构成冲突、亦不构成 evolution：设计的跨槽形态是 0010 已声明修订的机械推论（设计无意修订 0009 该条款，且 §4.3.4 C-3 明示「原单 key 单 slot 冻结次序在 key 维度上保持」）；条款的安全意图经逐要素核验全部保持——(a) 输入快照在槽内冻结后才触 Persistence（排队期变异语义保持）；(b) compile/validate 先于构造、createDoc 仅在全部准备成功后调用（0009「只有全部准备成功才调用排他的 `createDoc()`」）；(c) prepared bundle（envelope+derived+快照+createdAt）仅在单次 create 编排内部跨候选复用，从不外泄、从不跨 create 存活、不是公共面（对照 ADR 0007「不公开可跨时间执行的 prepared mutation」的 TOCTOU 关切）；(d) 每候选的 build+createDoc+登记在候选自身的槽内完成。ADR 语料整体读法：后接受的 ADR（0010）在重叠处生效，与 ADR 0007/0008 先例同款。
- **N2 重试预算读法**：「最多重试 8 次」的自然读法为初次生成之外再试 8 次（总生成 9）；另一种读法（总尝试 8）会使字面「重试」与「尝试」混用。ADR 文本只钉死「重试次数 = 8」，未钉死总生成数；SA6 锚定以宽容区间 [9,10] 显式收编两种读法，设计取严格读法 9 并给出两种耗尽用例的落点证明（entry 碰撞 9 次生成零 Persistence 触碰；duplicate 每代过 entry 门后 9 次 createDoc 尝试）。两读法均不与 ADR 文本冲突，属文本 ambiguity 内的设计裁量。
- **N3 随机源形态（非 Cordis service）**：ADR 0009 强依赖清单限定三项 Cordis service（Timer/Clock/Persistence），未要求一切 capability 皆成 service；ADR 0010 仅要求「注入的受控 CSPRNG」。设计以选项必需键 + plugin.ts Adapter 内桥接 `node:crypto` 落地：核心（registry.ts/identity.ts/create-document.ts/testing.ts）零 crypto 直调、保持 Host 无关，注入 seam 即契约本体（未来第二消费者可无损抽出 service——设计 §4.1.3 已留此路径）。`node:fs/promises`（file.ts）先例确立 Adapter 层可用 Node 内建。phase 文档「核心不得直接调用不受控全局crypto」为补充设计基准（非阻塞依据）且被满足：plugin.ts 非「核心」，`node:crypto` 为受控注入源而非 fallback 全局 crypto。留档观察（非冲突）：`randomBytes` 不进 `assertNamespaceRegistryHostDependencies` 依赖断言——该断言面是 Cordis service 依赖，纯函数 capability 不属其词域；若 owner 未来希望随机源服务化，属新 ADR 决策。

## 范围外登记（非设计-ADR 冲突）

1. **SA6 红灯 fixture 遗漏**（设计 §6 上报：AC-5 registryB 缺 `randomBytes`）：总控已回流 SA6 修正，明确不属设计-ADR 冲突。本次复审实测复核 `packages/namespace-registry/test/registry-phase5-identity-red.test.ts:482`——修正**已落盘**（`makeRegistry(persistence, { factory, randomBytes: makeScriptedRandomBytes([]).randomBytes })`），红灯面自相矛盾已消除；设计 §6 的「修正前 14/15 绿判」过渡条款随之失效，SA3 直接以 15/15 为准。
2. **切片范围**：`META.replicationId`/`replicationEpoch` 投影与 `enableReplication()`/`bumpReplicationEpoch()` 不在本任务 AC-1..AC-7（总控拆片决定，前置门禁范围观察维持）。设计明确排除且未预支任何复制身份语义——CONTEXT「复制谱系」边界（replicationId ≠ namespaceId ≠ SCHEMA id）零触碰，切片 2 的受信任导入路径（保留 Hub namespaceId、非普通 create）未被本设计占用或收窄。

## 结论

**Verdict：`clear`——放行，可派 SA2 全维度攻击评审。**

- 冲突点数：0；裁决分布：no-conflict × 16 项设计决策对照 + 3 项解读澄清（N1–N3）；override-declared × 0；evolution × 0；hard-violation × 0。
- 设计的行为面完整落在三方交集内：(a) ADR 0010「Namespace identity、owner 与复制范围」节的显式裁决（key/create 输入/重试/耗尽 fatal/owner 核对——D-3/D-4/D-5/D-6/§4.4.2 逐句对应）；(b) ADR 0009 未被修订条款（lifecycle 串行、lease 投影、committed 诚实、shutdown 结算、observer seam、脱敏、公共面冻结、testing seam 纪律）；(c) ADR 0006 持久层契约（owner 分区、排他 create、duplicate 绝不覆盖、安全文法、无 list）——Persistence 零改动。
- 唯一的实质性解读点（N1：重试跨槽 vs「同一个 lifecycle 槽」）已论证为 ADR 0010 显式修订的机械推论且安全意图四要素全保持，无需 override、不构成未声明演进。
- 相关决议文档（`..._relevant_decisions.md`）维持前置门禁版本不更新：其「事实性提示」1–4 已覆盖本次设计全部注册点（phase 命名 / already-exists 保留 / 随机源注入纪律 / 安全文法），无新增 ADR 级决策需要摘录。

Verdict: clear
