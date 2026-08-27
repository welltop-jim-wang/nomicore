# 设计后复审冲突报告 — issue #134（Phase 5 切片 3/4：expose trusted NamespaceLease ReplicationSession）

- 被审对象：`wiki/raw/task_namespace-lease-replication-session_design.md`（SA1 设计，701 行）
- 冲突基准：与 Phase 0 前置门禁同一标准——`docs/adr/` 全集（重点 0010 / 0008 含 #93/#132 修订节 / 0009 含 #131 修订节 / 0007 / 0006 含 #79 修订节）+ `CONTEXT.md`；phase-5 切片 3/4 与任务简报作为规范依据文本参与对照（非自动阻塞基准）
- SA8 设计后复审，2026-08-28。不重复前置门禁全量盘点（见 `task_namespace-lease-replication-session_conflict_report.md`，verdict clear）。

## Verdict

`clear`

设计对 O-1..O-12 的裁决、新增稳定词汇、seam 方案、「零突破」声明与文档同步清单**均无 ADR/CONTEXT 级冲突**：无 hard-violation、无 evolution 项。设计声称的全部基线事实（既有冻结词、seam 键集锁演进先例、审计白名单谓词、SA6 红文件、错误类先例、WriteSlot 现成员）经本复审逐项 grep 验证属实。放行附带 2 项放行条件（文档同步补口）与 6 项残留风险（非阻塞，交 SA2/SA3/SA4 处置）。

---

## 1. O-1..O-12 裁决逐条核对

| # | 设计裁决 | 权威锚点核对 | 结论 |
|---|---|---|---|
| O-1 | bypass 五条件合取（ready ∧ 无 fatal ∧ 冻结 hub-to-peer ∧ degraded ∧ notifier 绑定）；released/disposed/peer→hub+degraded/closing/closed/fatal 全拒；复用 `RUNTIME_WRITE_DISABLED` 码族、message 分域 | ADR 0010 L131–139（唯一例外 = 冻结 hub-to-peer session；closing/fatal/handle 失效不得绕过）逐条满足；ADR 0006 #79 L187 四态词精确化「handle 失效」✓；hub 侧 L125–129 拒 peer→hub ✓；notifier 绑定条件是 L135「仍调用 saveDoc 登记」义务的必要条件（无法登记则不得写），与 ADR 0008 #93 修订节第 2 条第 (3) 类「notifyDirty 未绑定 loud gate」同族 ✓；**复用码族**精确命中 #93 修订节第 2 条「区分域靠 issue message 文案，不另设新码」的注册纪律（该条列举的四类零写入拒绝与设计 R1/R3/A3 用法一一对应）✓ | **一致** |
| O-2 | internal subpath 第二值导出 `openReplicationSessionCoreForRegistry` + 模块级 WeakMap host 登记；apply 挂同一 WriteSequencer 闭包实例 | ADR 0008 L91（handle/Y.Doc/生产构造器不公开；seam 保留包内）✓ 新机制全在包内；ADR 0009 L18 语义核对：「唯一导出的」经查为**事实描述而非基数不变量**（该句冻结的实质 = 主入口不公开生产构造器 + internal subpath 只能由 Registry 生产代码消费——两者均保持；审计白名单谓词 `packages/namespace-registry/src/` 前缀已验证，新 caller lease.ts 自动放行）✓；ADR 0010 L96「唯一 write sequencer」结构性满足（同一实例 enqueue，INV-S1）✓；备选否决理由（Symbol.for 绕过审计/第十三键/工厂签名）与 ADR 0009 L18 治理面一致 ✓ | **一致**（以 ADR 0009 注记收口，见放行条件 C-2） |
| O-3 | 类型落位 registry types.ts 纯结构性；Equal 断言在 lease.ts（声明图外）；两侧主入口值导出面零突破；released 通道表增补 open → Promise 结算 `NAMESPACE_LEASE_RELEASED` | types.ts 头注纪律（主入口声明图零 Runtime 命名类型/零内部 subpath 字面量）✓；lease.ts 头注「public alias 与 Runtime 对应成员逐字段锁死（编译期 Equal 断言）——本文件位于主入口不可达声明图之外，允许引用 Runtime 命名类型作断言锚」——设计的新 Equal 断言沿用同先例 ✓；ADR 0009 L44（released 后除 getStatus 外经既有通道返回 `NAMESPACE_LEASE_RELEASED`）与「四写 resolve released issue」同款 ✓；index.ts 白名单纪律 type-only 追加 ✓ | **一致** |
| O-4 | role 经 Registry 构造 options 注入，缺省 `'hub'`；peer 三管理写 Lease 接纳段稳定拒绝（`REPLICATION_ROLE_PERMISSION`）；session open 校验 localRole===role | ADR 0010 L118「peer 本地调用以稳定角色权限错误拒绝」✓ 稳定 message 常量 + JSON 逐字节稳定；L120（复制身份 hub-only）✓ enable/bump 同拒；L12/L18（实例静态配置 hub/peer）——ADR 未规定注入点，Registry 构造注入是合规选择；**缺省 'hub'**：ADR 无缺省条款，基线无角色 = 全权限面 = hub 权限面 ⇒ 缺省 'hub' 是零回归唯一解，误配风险见残留风险 R-1；L117（ROOT 双角色可写）✓ 设计明确 ROOT 写不受限 | **一致** |
| O-5 | (a) hub-degraded 拒 = O-1 direction 分支；(b) peer replaceSchema 角色拒 = §5.4 gate——SA6 用例 12/13 锚 | ADR 0010 L125–129 / L118 ✓；前置门禁 O-5 覆盖缺口闭合 ✓ | **一致** |
| O-6 | 「authenticated」等价物 = peer 实例上 localRole:'peer' 开 session（direction 冻结 hub-to-peer）+ Host 只交 Lease 给可信代码 | ADR 0010 L79（Host 搭建方负责）+ L139（bypass 只属冻结 hub-to-peer session）✓；与前置门禁 O-6 要求（写明认证等价物、不提前拖入 WS 层）逐字满足 ✓ | **一致** |
| O-7 | disabled 命名空间 open → `REPLICATION_NOT_ENABLED`（零新词） | **已验证**：`REPLICATION_NOT_ENABLED_MESSAGE` 为 #132 既有冻结词（`errors.ts:174`「REPLICATION_NOT_ENABLED: 复制身份未安装（disabled）——先 enableReplication()；本调用零写入」），registry 侧结构复制副本沿 `REPLICATION_ID_PATTERN` 双副本先例 ✓；裁决理由（L81 四域冻结前置 + L55 身份匹配）与 ADR 一致 ✓；码族复用符合 append-only（不新增码，新增结果面用法）✓ | **一致** |
| O-8 | 槽内重读 facts 比对冻结 id+epoch；不等 → 终态 `conflicted` + `REPLICATION_EPOCH_CONFLICTED` 零写入；终态释放槽位；新 open = 显式 reset/bootstrap 等价物；在途槽照常提交 | ADR 0010 L53（旧 epoch 必须显式 reset/bootstrap）+ L55（不同进入**稳定 conflicted**、绝不自动覆盖或合并）✓ 终态语义吻合；ADR 0008 L47「gate 是瞬时观察：检查后才发生的降级不撤销已提交事务」同构 ✓；facts 源 = #132 投影链单点（L131/L134/L135）✓ 不读 live META、无第三读取点 ✓ | **一致**（码名 EPOCH 同时覆盖 id 见残留风险 R-5） |
| O-9 | 「最多一个 duplex session」= 至多一个**活跃** session、计数在 Lease 层；终态释放槽位、终态后可再 open；release = 同步段调用既有 close()；已接纳槽照常排空 | ADR 0010 L81 措辞歧义（前置门禁 O-9 点名）——设计取「并发活跃一」解释，不与任何条款冲突（L151 重连重建 Lease/channel，终身制与并发制在既有授权下均可行，设计选择更宽且自洽：SA6 用例 2+17 同时成立）；L90「Lease release 同步停止 session 接纳」由 release 同步调 close() 字面满足 ✓；ADR 0009 L42「release 不追踪或等待此前已经由 Runtime 接纳的写」✓ 已接纳槽排空同款；生命周期词义已列入 ADR 0010 增补节登记 ✓ | **一致** |
| O-10 | 构造期恰一 `doc.on('update')`、同步扇出；每 listener try/catch 自捕获 + `observerFailures` 计数；每投递独立 Uint8Array 副本；回声抑制 = origin===本 session token 排除、null origin 全投；本切片无队列 | ADR 0010 L109–113 三条逐项：L111「只交付复制需要的 owned bytes 和受控 origin，不暴露 live Y.Doc」——**上限型条款**（交付子集不违约；origin 用于内部回声抑制、不透出公共订阅面），L111–112 observer 失败不回滚不 fatal ✓（T-2 和解：自捕获=ADR 0007 L54「Runtime 自有 observer 必须记录或异步上报」的记录面），L113 队列溢出→needs-resync 在切片 3 无队列 ⇒ 条款不可达（见放行条件 C-1）；ADR 0007 L54「不得向事务调用栈抛异常」✓ 结构性满足 | **一致**（needs-resync 推迟见 C-1） |
| O-11 | status 词汇：state 三态 + 冻结四域 + direction + currentEpoch + rootValidation（只置不清）+ durability（memoryCaughtUp + **diskCaughtUp:false 字面量类型**）+ observerFailures | ADR 0010 L139「状态必须区分『内存已追上』与『磁盘未追上』，不得声称 peer 副本已经 durable」——`diskCaughtUp: false` 字面量类型**结构性**永不声称 durable ✓（比运行时纪律更强）；L107 + CONTEXT `复制未校验` 词条 ✓ rootValidation 只置不清与「不表示 transaction 可回滚或享有 zero-write」同向；T-4 ✓（session 状态零入 Runtime status，ADR 0008 #132 L135 replication 域仍两态） | **一致** |
| O-12 | 判据 (a) 内容投影相等；受保护常量：hub = SCHEMA 全容器+META 全键、peer = META 全键（SCHEMA/ROOT 放行）；peer META 白名单首版空集；非 primitive 判「已改变」 | ADR 0010 L105 hub 侧最小集（SCHEMA + 复制身份保留字段）——设计 **META 全键为收紧非放宽**：不违反任何条款（ADR 设定的是保护下限；L121「未来其他非保留 META 字段可另行决定双向语义」= 未决定空间，保守拒绝是可逆默认值，且已声明在 ADR 0010 增补节登记 ✓）；peer 侧 L105「允许同步 ROOT、SCHEMA 和允许的 META 字段」——「允许的 META 字段」集合 ADR 未定义，空集 = 保守读法，且与 epoch 纪律互证（L53/L120 + phase-5 切片 6 L98「在线 epoch bump 发送 IDENTITY_CHANGED fencing」——epoch 变更不经 live apply 传播，META 空集白名单恰是该流程的 session 层对应物）✓；L121「raw caller 不得逐次自定义受保护字段集合」→ 冻结常量 ✓；判据 (a) 是 L105「不改变」的内容语义读法，(b)/(c) 否决论证 + §13 实测成立 ✓ | **一致**（收紧项的 ADR 登记为收口动作，已列 §10） |

## 2. 新增稳定词汇 / 错误码 vs append-only 注册纪律

| 词汇/码 | 落位 | 纪律核对 | 结论 |
|---|---|---|---|
| `NSRT-FATAL-REPLICATION-APPLY-INTERNAL` + WriteSlot 追加 `'replication-apply'` | runtime `errors.ts` / `write.ts` 定义点 | ADR 0008 #93 修订节第 5 条「以包内各稳定码定义处的 append-only 注册表为准」✓ 纯加法；**已验证** `WriteSlot = 'root'\|'schema'\|'replication'`（write.ts:74）——追加为加法，既有渲染逐字节保持（rev1 测试零改动）可在 SA4 验证；命名沿 `NSRT-FATAL-{WRITE,SCHEMA-WRITE}-INTERNAL` 族 ✓ | 一致 |
| `REPLICATION_SESSION_INPUT_INVALID / ROLE_MISMATCH / SESSION_EXISTS / ROLE_PERMISSION`（registry const）+ `SESSION_CLOSED / EPOCH_CONFLICTED / RAW_UPDATE_INVALID / PROTECTED_FIELDS_CHANGED / SESSION_UNSUPPORTED`（runtime session 域） | §6.1 types.ts 单一真相源 const / §6.2 | types.ts 头注「稳定 message 单一真相源……const 声明字符串自动收窄」同款 ✓；零插值、零值回显 ✓；`NAMESPACE_LEASE_RELEASED`/`RUNTIME_WRITE_DISABLED`/`REPLICATION_NOT_ENABLED` 零改名复用 ✓（后者存在性已验证）；`REPLICATION_SESSION_CLOSED` getter/编码域 throw 通道沿 `RuntimeReadDisabledError` 先例（类在 errors.ts、不导出 index——已验证该先例真实存在）✓ | 一致 |
| `NAMESPACE_REGISTRY_ROLE_INVALID`（构造 TypeError） | registry types.ts | 构造期形状门禁沿 #112 scheduler/idleTimeoutMs 先例；逐码入 ADR 非要求（#93 第 5 条定义点注册原则）✓ | 一致 |

## 3. seam 方案 vs 模块边界 / import 审计纪律

- **internal 第二值导出**：ADR 0009 L18 冻结实质（主入口封闭 + Registry-only 消费 + 边界测试）三项全保持；「唯一导出的」为描述性表述，键集演进有**明文先例**——已验证 `runtime-registry-internal-seam.test.ts` 头注「精确键集断言由 SA3 实现时同步演进」（exports 键集 `['.']`→`['.','./internal']` 的同款演进即该纪律的第一次行使）；本次一键→两键是第二次行使，沿既定纪律 ✓。
- **审计谓词零改动**：已验证 `test/helpers/registry-seam-audit.ts` 白名单谓词 = `packages/namespace-registry/src/` 前缀——新 caller `lease.ts` 自动放行 ✓。
- **ADR 0008 seam 纪律**：host/fanout/core 全在 `replication-session.ts` 包内模块，doc/handle/sequencer 引用不出包；index 零 re-export；测试经包内构造 seam（fanout 在 `createNamespaceRuntimeWithSeam` 装配 ⇒ 测试替身 Runtime 同样获得 fanout，SA6 确定性测试可测）✓。
- **十二键锁**：已验证 `runtime-registry-internal-seam.test.ts:270` 处 `Object.keys(runtime).sort()` 断言——WeakMap 登记不触碰对象，锁零改动即绿 ✓。

## 4. 「零突破」自洽性

- runtime 主入口：`index.ts` 列 DENY、零改动，值导出仍恰 `RuntimeWriteFatalError` 一键 ✓（internal.ts 一键→两键**不属主入口**，且为 D-2 显式裁决 + 键集锁测试同步演进，与前置门禁 T-5 裁决路径一致）。
- registry 主入口：type-only 追加（§12 ALLOW 明示）✓；`NamespaceLease` 十三成员→十四成员为接口加法，SA6 `HasLeaseRawApply=false` 守卫仍成立 ✓。
- Runtime 对象面：仍恰十二键（构造期 WeakMap 旁路登记）✓。
- **发现一处设计内部不自洽（笔误级，非冲突）**：§14 表第 5 行写 `openRuntimeReplicationSessionForRegistry`，§0/§3.2/D-2/§12 均为 `openReplicationSessionCoreForRegistry`——SA3 实现时必须冻结单一名称（见 R-4）。

## 5. 文档同步清单覆盖核对

| 文档 | 设计 §10 覆盖 | 缺口 |
|---|---|---|
| ADR 0010 增补节 | open/apply 拒绝码全表、session status 词汇、O-7 disabled 拒绝、O-9 生命周期词义、O-12 判据+受保护常量+白名单空集+**hub 侧全 META 收紧**、O-4 role 注入与缺省、internal seam 指针 | 无（覆盖完备；hub META 收紧的登记是 D-9 声明的收口动作） |
| ADR 0009 | (a) internal 第二导出注记；(b) Lease 面/released 通道表增补 | 无 |
| phase-5 | 切片 3/4 方法名/role/status 词汇/受保护常量/白名单；切片 9 role 必传注记 | **有**：切片 3 文本含「needs-resync 通知」而设计推迟至切片 6（D-16），§10 未列该推迟的对账注记 → 放行条件 C-1 |
| CONTEXT.md | ReplicationSession 词条扩写（六能力方法名/status 词汇/每 Lease 一活跃 session/终态词）、Hub/Peer 词条 role 注入注记 | 无 |
| ADR 0006/0007/0008 | 明确不改——理由核对成立：#132 修订节已覆盖 sequencer/status 纪律；T-1 和解按 lex posterior 在 ADR 0010 增补节陈述（与前置门禁 T-1 建议一致）；#93 第 5 条定义点注册原则支持新码不入 ADR 0008 | 无 |

---

## 冲突点

无 hard-violation / override-declared / evolution 项。前置门禁识别的 T-1..T-7 和解条件在设计中的闭合情况：T-1（O-1 谓词 + ADR 0010 增补节陈述）✓、T-2（fanout 自捕获 + observerFailures 记录面）✓、T-3（同一 sequencer 实例、按族槽体 R1–R7）✓、T-4（session 状态零入 Runtime status）✓、T-5（internal seam 显式裁决 + 先例沿袭）✓、T-6（投影链单点冻结/比对、无第三读取点）✓、T-7（四态词 + notifier 绑定条件精确化）✓——全部机制闭合。

## 放行条件（非阻塞，SA3/文档同步阶段必须完成）

- **C-1（文档对账缺口）**：phase-5 切片 3 文本明列「Observer failure 隔离和 `needs-resync` 通知」，设计 D-16 将 needs-resync 推迟至切片 6（理由成立：ADR 0010 L113 的唯一触发「队列溢出」在切片 3 无队列语境下结构性不可达；CONTEXT 无 needs-resync 词条 ⇒ 不构成门禁冲突）。但 §10 文档同步清单**未包含**该推迟的对账注记——必须在 phase-5 文档增补中显式登记（切片 3「needs-resync 通知」→ 切片 6 队列属主），或设计补充「切片 3 无队列 ⇒ 空实现不可达」的明示声明；否则 phase 文档与实现留下未对账偏差，Phase 5 收口一致性审查（阶段门禁第 1 条）会撞上。
- **C-2（和解收口动作）**：ADR 0009 L18 注记、ADR 0010 增补节（含 hub META 收紧、O-9 词义、role 缺省）、internal 键集锁测试一键→两键演进——设计已全部列入 ALLOW/§10，实施时必须实际执行且与本设计文本一致；任一缺执行即造成「设计声明 vs 仓库事实」漂移。

## 残留风险（非阻塞，交下游 SA 处置）

- **R-1（role 缺省 'hub' 的误配 containment）**：peer 误配为 hub 将本地获得 SCHEMA/复制身份写面。危害有界（hub 侧 scratch-check 全 META 收紧会持续拒绝由此产生的漂移 update；degraded bypass 因 direction='peer-to-hub' 不可获得），但属部署卫生问题——切片 9 composition root「必须显式传 role」注记（设计 §10 已列）+ 部署文档强调为唯一防线。SA2 可评估是否值得未来加显式 opt-in。
- **R-2（origin 不透出公共订阅面）**：ADR 0010 L111「只交付 owned bytes 和受控 origin」为上限型条款，设计只交付 bytes（origin 用于内部回声抑制）——合规；若切片 6 ws-replication 需要 origin 可观测性，属加法扩展（新增带 origin 的订阅形态），当前不构成缺口。
- **R-3（同步扇出的槽内耗时）**：listener 在 Yjs transaction 内同步执行（sequencer 槽内）；自捕获保证不抛、不 fatal，但慢 listener 会延长槽占用。ADR 无禁止性条款；有界队列/背压在切片 6 属主侧解决。SA2/SA7 可在观测面确认。
- **R-4（命名笔误）**：§14 `openRuntimeReplicationSessionForRegistry` vs `openReplicationSessionCoreForRegistry`——SA3 冻结单一名称（以 §3.2/D-2 的 `openReplicationSessionCoreForRegistry` 为准），SA4 静态验尸核对导出名与 ADR 0009 注记一致。
- **R-5（O-8 码名覆盖面）**：R2 同时比对 id+epoch 但码名只说 EPOCH——replicationId 一经安装不可改写（#132），id 分支结构性不可达，码名单义性无害；message 文案可顺带点名。
- **R-6（fatal phase 字符串示意性）**：§4.4 R3/R5/R6 中 `'write-slot-internal'/'unknown-pipeline-throw'/'notify-dirty-failed'` 为示意值——SA3 必须对齐 `RuntimeWriteFatalPhase` 实际词汇与 `writeFatalMessage` 既有渲染分支（append-only、既有渲染逐字节不变）。

## 结论

**verdict: clear，放行进入 SA2 攻击评审。** 设计对 O-1..O-12 的裁决与 ADR 0010/0008(#93/#132)/0009/0007/0006(#79)、phase-5 切片 3/4、CONTEXT.md 逐条一致（12/12 一致）；新增词汇全部落 append-only 定义点注册、复用词零改名且存在性经验证；seam 方案沿 ADR 0009 L18 既定演进先例且冻结实质全保持；「零突破」声明经基线核验自洽（仅 §14 一处命名笔误）；文档同步清单覆盖完备——唯 needs-resync 推迟的对账注记为缺口（C-1）。C-1/C-2 两项放行条件与 R-1..R-6 残留风险移交总控分发（C-1/C-2 → SA3/文档同步；R-4/R-6 → SA3；R-1 → 切片 9 注记；R-2/R-3 → SA2/SA7 观测）。
