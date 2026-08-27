verdict: clear

# 冲突门禁报告 — issue #133 设计后复审（Phase 2）

- **被审对象**：`wiki/raw/task_phase5-bootstrap-archive-reset_design.md`（1053 行冻结设计，D-1..D-14 + INV-1..13 + §7 File Scope）
- **冲突基准**：ADR 全集（重点 0006/0008/0009/0010，逐行全读）+ `docs/phases/phase-5-websocket-replication.md` + `CONTEXT.md`；代码/测试仅作事实核对，不构成阻断依据
- **参照**：Phase 0 前置门禁报告（verdict: clear，N-1..N-9）、SA6 红灯报告 + 5 个红灯测试文件
- **裁决词汇**：no-conflict / override-declared / evolution / hard-violation
- **工作区**：`/home/wangjian/nomicore-fix-issue-133`（HEAD=ebc5419 实证；`archiveDoc/importDoc/importReplica/resetReplica` 在 src 零命中，基线缺席属实）
- **说明**：Phase 0 未产出独立 relevant_decisions 文档（仅冲突报告）；本报告 §「设计引入的新决策点」即设计后复审追加的全链复用决议记录。

## ADR 盘点（设计后复审范围）

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001..0005 | VFSL/投影域 | accepted | 否 | 设计不触碰 schema/投影/生成管线，无交集 |
| ADR-0006 | Server Persistence docstore | accepted（含 #64/#79/#131 节） | 是 | no-conflict（项 2/3/4/7/8） |
| ADR-0007 | 逻辑校验与 Yjs bridge | accepted（部分被 0008 取代） | 间接 | no-conflict——Registry 全程不做 raw apply，zero-write 管线不触碰（设计 §4.2 明示） |
| ADR-0008 | Runtime 读写能力与 sequencer | accepted（含 #93/#132 节） | 是 | no-conflict（项 3/9/10） |
| ADR-0009 | Registry、Lease 与 Host 生命周期 | accepted（identity 节被 0010 修订；含 #131 节） | 是 | no-conflict（项 1/6/9/13） |
| ADR-0010 | Hub/Peer WebSocket 复制 | accepted | 是（核心） | no-conflict（全部复审项） |
| phase-5 | 实施切片/场景/测试 seam | —— | 是 | no-conflict（切片 2/8 边界与措辞逐字核对） |
| CONTEXT.md | 词汇与硬性惯例 | —— | 是 | no-conflict（复制谱系/epoch/namespaceId 词汇） |

## 逐复审项核对表

### 1. D-1 暴露面（importReplica/resetReplica 为公共方法 + 文档化信任纪律）

**结论：no-conflict。**

- **编排归属**：ADR 0010:222「Registry 仍负责本地 Runtime generation、Lease、**reset/archive 编排**和 Host 生命周期」逐字在场；phase:113 点名 `Peer resetReplica(owner, namespaceId, expectedLocalIdentity)`、0010:28/65 点名内部受信任导入——方法级入口为权威文本直接蕴含（签名与 phase:113/phase:63 逐字一致）。
- **0009:114 公共面纪律不被触碰**：0009:114 禁的是「list、entry status、lease count、queue、timer handle、explicit eviction、**按 key close** 或公共 events」这类**通用**管理面；importReplica/resetReplica 是 ADR 0010（后法，且 0009 修订节 1 明示 identity 节被 0010 取代）授权的**身份受卫**编排入口，不是通用按 key 管理面。设计 §4.1 论证成立；SA6 surface 负向守卫（无 removeNamespace/closeNamespace/forceClose/listNamespaces）保持绿。0009:114「测试 seam 只位于受控 testing subpath」不受影响。
- **0010:79 同款授权核实**：0010:79 原文（对 `lease.openReplicationSession`）：「所有 Lease 都可调用该入口，**不设置不可伪造 capability**；Host 搭建方负责只把 Lease 交给可信代码。API 文档必须明确……」——设计将「无 capability token + Host 装配信任边界 + API 文档表述」纪律**对称适用**于导入/reset 面。0010:28「内部受信任导入」未规定执行机制；无任何权威要求 capability token；0010:79 对 Lease 面显式否决了不可伪造 capability 机械——模式转移与权威方向一致（且避免发明无授权的新机械）。防绕过四层（普通 create owner-only 接纳零改动（0010:28/0009 #131）、导入核对严于 create、Persistence 二道 docId 门、无新增通用管理面）成立。「API 文档」落位为 types.ts JSDoc（ALLOW 内），与 docs/** DENY 不冲突。
- **被淘汰方案**（internal subpath/capability token/testing 注入）淘汰理由与权威相容（0009:18 的 internal 工厂先例是 static 工厂，导入需 Registry 实例闭包）。

### 2. D-4 optional 成员 + ReplicaPersistence 派生接口

**结论：no-conflict。**

- **「0010:218 是否指名 required」——核实：未指名。** 0010:218 原文「它为 Persistence 增加复制导入与归档所需的受控能力」——只说 Persistence 获得能力，未指名接口落位、未指名 required/optional。phase:62「增加……受控 seam」/phase:63「增加 `archiveDoc(owner, docId, expectedReplicationIdentity)`」同样只给行为与签名，不给接口落位。设计声称「权威文档从未指名接口」**属实**（phase:63 的签名在设计的 optional 成员与 ReplicaPersistence required 成员上均逐字保持）。
- **ADR 0006 演进条款是否允许 optional 扩展**：0006 #64 修订节曾以 required 成员扩展接口（createDoc）——是「可以加成员」的先例而非「必须 required」的禁令；0006:59 v2 演进位「以**不改变 DocPersistence Interface** 的 Adapter 内部替换实现」约束的是规模优化路径，不禁止本票这种伴随新派生接口的能力扩展；0006 #79 修订节以「增量演进」方式追加 DocHandle.getStatus 成员——同为接口形状演进先例。optional + required 派生接口 + 三处 loud gate（INV-13：Registry typeof gate → fatal；lifecycle io gate → bare loud Error；Memory 缺 deleteSnapshot → loud 拒绝）使「受控能力」实质不降级（两生产 Adapter 恒实现，缺席必响亮失败，无静默降级路径）。
- **行号引用小误**（N'-2）：设计引「ADR 0006:86-92（第三方 Adapter 演进位）」，该区间实际是 dispose 义务与实施顺序；最接近条款是 0006:59 与 0006:82（两真实 Adapter）。不影响裁决。
- SA6 红锚改指 ReplicaPersistence（回流 R-2）是测试资产调整，非权威冲突（SA6 报告 §4.2 自身将锚标为「临时」并预留 SA1 冻结权）。

### 3. D-5 archiveDoc 状态机（settle→claim→guard-read→verify→relocate）

**结论：no-conflict。**

- **写公理**：提交点 = `io.writeArchive` resolve（File 为 tmp→rename 完成，0006:52 同款）；INV-4「resolve {ok:true} ⟺ 归档区持有已核对字节且主键已移除；此前任何拒绝 ⟹ 主键与归档区逐字节不变」与 0006:52（tmp 半写入非提交态、rename 即提交）+ 0006:121-123（「在 duplicate 判定路径上绝不覆盖已提交内容」）纪律同构。guard-read/verify 全只读；remove 后置于 write 之后。
- **flush/degraded/retry 纪律**：0006 #79 修订 2「降级等待期内……retry 退避即该 entry 的**唯一** flush 调度源」——设计 §4.5.2 retryTimer 武装时被动等待回退轮（不另设调度源、不热循环失败 store），逐字兼容；非降级路径直调 startFlush 跳过 debounce 属持久层**内部**调度（0006:34「不设**外部** flush/cron 协调器」的『外部』指持久层之外——archiveDoc 是持久层自身方法），且 N-5「不得以 reset 之名绕过 retry」被显式满足（§10-N5/§6 预答区）。dispose 无条件通知 waiters 防挂起（对齐 0008:93「不设内部 timeout」契约行为）。
- **phase:63 前置语义**：「仅在无有效 handle/Runtime generation 时执行」被读作含**在途 dirty flush 排空**（零-handle-but-dirty 直接归档会让 pending flush 复活主键、击穿后续 importDoc 排他）——这是对前置的**强化**（等待静默）而非削弱；「归档内容 = 写后终态」与 0006:58 单飞 flush + generation 保序一致（排空后读到的字节含全部已接纳写）。
- **单 rootDir owner**：0010:218「不改变……单 rootDir owner 语义」/0010:8——归档区在同 rootDir 子树内；无文件锁（0006 后果节「v1 限制：单进程」；0010:199「共享文件目录多写仍不受支持」），跨实例竞态以 DOC_ARCHIVE_DUPLICATE 等拒绝而非锁协调——一致。
- **committed 映射（false/false/true）与 phase:65**：phase:65「duplicate、identity mismatch、operational failure 与 **committed-aware fatal** 使用稳定分类」——DocArchiveFatalError 三 phase 携带冻结 committed 映射导出；relocate-remove（提交点已跨越）committed:true 与 0008:86「post-commit fatal 以带 committed:true……reject」的归档侧同构；DocCreateOperationalError 的 committed 是 `false` 字面量（#64/#79 冻结形状），committed 运营错误在该族不可表达 → 归 fatal 族诚实陈述（双副本并存 + 幂等收敛重试论证在案），与「不得虚报 committed 事实」纪律（0009:120）同向。

### 4. D-6 io seam 扩展（writeArchive/remove）

**结论：no-conflict。**

- **PersistenceIO 演进的公理保持**：writeArchive 契约「resolve ⟺ 归档区已持有该字节；reject ⟹ 归档区不变；禁同步 throw；不触碰主键存储」与既有 write 公理（lifecycle.ts:15-44，源于 0006:52）逐款同款——「write resolve⟺committed」公理在归档位面完整保持，主键写路径（read/write）零改动。PersistenceIO 未被任何 ADR 点名（0006 只冻结 DocPersistence/DocHandle 公共面），seam 扩展属 persistence 包内设计自由且在 ALLOW（lifecycle.ts/testing.ts）。
- **fault seam 并入 write 槽 vs #108 注入语义**：wrapIo 是单一 armed 位 around-seam（testing.ts 实证 wrap 只拦 `{read, write}`）；writeArchive 并入既有 `failWrite`/`holdWriteBeforeCommit`/`holdWriteAfterCommit` 槽位——**既有测试不受影响**（其臂动 failNextWrite/holdNextWrite 的路径不调用 writeArchive；注入语义「下一次写被拦」不变，只是「写」的集合扩为含归档写）；SA6 hold/fail-write 两锚即该假设的验收。remove 透传不加故障槽（无锚需求，append-only 预留）。被淘汰方案 (a')（remove 内联进 adapter 提交段、失败被写公理吞为 resolve）正是「拒绝虚假降级」要防的虚假完成态——裁决方向与诚实失败纪律一致。

### 5. D-7 身份映射（Registry 纯传递 + 守卫权威=持久快照）

**结论：no-conflict。**

- **形状**：`ReplicationIdentityRef = { replicationId: 32 位小写 hex; replicationEpoch: ≥1 安全整数 }` 与 0010:46-48 冻结域逐字一致；`expectedLocalIdentity`（0010:57/phase:113）与 `expectedReplicationIdentity`（phase:63）为同形状两角色名——权威未定义二者关系（Phase 0 N-1），设计显式冻结，消解 N-1。
- **守卫权威 = 排空后持久快照的复制事实**：与 phase:63「受**身份前置条件**保护的归档 seam」一致；「Registry 纯传递、不在 close 前做 live 预检」避免第二判据点（N-1「不得另立第二套判据」——live 事实可能领先持久事实，预检不能取消守卫）；settle 排空使「close 后事实取自何处」消解（= 最后已提交的 live 事实）。判据语义源 = readReplicationFacts 判据族（0008:132 两态/损坏判据冻结），以结构守卫副本三处互引落地（REPLICATION_ID_PATTERN 双守卫副本既有先例；N'-7）。
- **同 id 不同 epoch 算 mismatch**：CONTEXT:121-123「相同复制谱系但 epoch 不同的副本进入冲突状态，必须显式 reset/bootstrap」+ 0010:55「身份与 epoch **相同**才允许……」——epoch 是身份谓词的组成分量；全等判定（id+epoch+格式）与冲突定义一致，且实现 INV-9 stale 身份重放拒绝（reset→bootstrap(epoch 前进) 后旧身份重放被同一守卫拒绝）。race 语义（t₀ 观察 vs t₁ 守卫执行）以 t₁ 持久事实拒绝 = AC-4「identity races without partial deletion」的精确机制。

### 6. D-8 resetReplica 编排

**结论：no-conflict。**

- **与 0010:57 逐字对照**：「Registry **先关闭**本地 Runtime generation，**再**通过 Persistence **归档**旧副本，**最后允许**重新 bootstrap」⟹ 设计 §4.8 ②close（强制 lease 失效→cancel idle→closePromise barrier）→ ④archiveDoc → ⑤资格（key 缺席，无显式动作）——三步逐句对应。③存在性探针是 close 与 archive 之间的**只读**判定（NOT_FOUND 路径不触达归档 seam），loadDoc 不构造 Runtime、不打开新 generation，不扰乱次序；归档前置「无有效 Runtime generation」始终成立。
- **强制失效未决 lease 的授权判定**：无 ADR 条款直接命名，也无条款禁止。授权链 = 0010:57「关闭本地 Runtime generation」（存在未决 lease 时关闭 generation 的必要组成——lease 代理 runtime，generation 交还新 bootstrap 后旧 lease 不得回入）+ 0010:222「Registry 仍负责本地 Runtime generation、**Lease**、reset/archive 编排」（Lease 编排权显式在 Registry）。机制走公共 `release()`（0009:42-44 冻结语义：同步置 released；release 不等待已接纳写——已接纳写由 close barrier 排空（0008:93），归档在后，写完整结算（INV-7））；removeOnlySelf/generation 纪律（0009:32）沿用。与 shutdown 的不对称（0009:99「不等待外部 lease release」）差异已显式记录非隐藏（§4.8.2/§6-R5）。判 **no-conflict**（权威沉默内的必要落地，见 N'-1）。
- **bootstrap 资格 = key 缺席**：0010:57「最后允许重新 bootstrap」的最小操作化——归档完成 + entry 清理 ⟹ 阻塞物移除即允许（open→NOT_FOUND、loadDoc→null、importReplica 必可成功）；无显式标记/新状态枚举/wire 可见面（0009:114 ✓；Phase 0 N-2 建议逐字采纳）。stale 重放由守卫天然拒绝（INV-9）。
- **owner mismatch 零泄露**：0010:30「不匹配统一返回 `NAMESPACE_NOT_FOUND`」/0009:138——reset ①第一谓词 owner 核对（镜像 open）；entry 缺席时探针按 identity.owner 分区读（0006 #131 对齐说明：不同 owner 同 docId 属不同 entry）⟹ 跨 owner 零存在性泄露、零归档副作用（INV-10）。
- **carrier FIFO 串行**（0009:32 同 key 串行域、后项不继承前项失败）：并发 open+reset 两序确定；import 槽对 closing entry 不等待即拒（镜像 create ①，0009:34 先例）——一致。

### 7. D-9 File 归档布局（archive/users/\<u\>/\<ns\>.snapshot + tmp→rename + latest-wins）

**结论：no-conflict。**

- **phase:64 逐字**：「FilePersistence 使用**同 rootDir 内**受控 archive 路径和**原子 rename**」——`{rootDir}/archive/users/{userId}/{namespaceId}.snapshot` 同 rootDir 子树 ✓；writeArchive = mkdir→writeFile(tmp)→rename(tmp→归档 .snapshot)，归档文件**原子出现**（0006:52 tmp→rename 纪律同构，abort 门位镜像既有 writeCommittedSnapshot）✓。跨「归档写+主键删」两步不声称单操作原子性，由失败分类 + 收敛重试保证——phase:64 未要求跨步原子，诚实。
- **安全文法**：SAFE_PATH_SEGMENT 双段守卫（0006:50「userId 与 namespaceId 共用安全文法」同级纪律）——N-6 要求落实。
- **tmp 协调**：0006:52「启动发现遗留 .tmp 时一律忽略并删除」的作用域按其上下文是 v1 `users/` 主键布局；归档区为 phase:64 新增面。设计取：每 key 至多一份 tmp、下次归档覆盖式清理、tmp 永非提交态（归档区提交态唯 .snapshot）、主键区读路径清理结构性不触及归档区——满足 N-6「不得误删一半写入态、不得无限残留」（残留按未竟归档 key 有界）。（N'-3）
- **latest-wins 单槽覆盖**：无任何权威条款要求归档保留历史——0010:57 只要求「归档旧副本」（移出活槽）；0010:201「hub 备份仍是权威灾难恢复手段」支持归档区非灾备权威定位；0010:218「不增加跨 owner catalog」——单槽镜像布局无枚举/编址面，与防 catalog 蔓延精神一致；被淘汰的代际命名方案会发明保留语义（零权威要求）。与 0010:55「绝不自动覆盖或合并」（身份冲突副本间）不冲突——latest-wins 是**身份守卫通过后**的受控归档动作，非冲突自动消解。判 no-conflict（数据保留策略属权威沉默内裁决，N'-1/N'-4）。

### 8. D-10 Memory 等价（archive-scoped key + deleteSnapshot hook + loud 配置门）

**结论：no-conflict。**

- **phase:64「MemoryPersistence 提供行为等价、可测试的归档语义」**：等价面 = 九组共享断言在双 adapter 上同一组（0006:157-159「两 Adapter 必须通过同一组……shared contract tests」/0006:197 平行验收纪律的归档侧应用）✓；writeArchive=writeSnapshot hook（archive-scoped key）+ 私有 mirror、remove=deleteSnapshot hook + mirror 删除——行为可观测（hook store 字节级）。
- **恢复面归 File**：phase:183「**FilePersistence** 做进程重启、归档和恢复验收」逐字支持（N-8/§6-R9）——Memory 不新造公共恢复读取面（避免新增公共可观测面，0009:114/0010:218 精神），测试侧经 hook store 已可观察归档副本。成立。
- **loud 配置门**（read hook 接线而缺 deleteSnapshot → 归档时 bare loud Error，运行时而非构造期）：语义 = 配置缺陷响亮失败（read hook 是唯一读权威（IO-2），无删除钩子则「主键移除」对外部 store 虚假 no-op）——与「拒绝虚假降级」立法一致；构造期门禁会炸全部既有 hook 接线夹具（零回归考量）；bare Error 通道与「persistence is disposed」同款（非四分类领域拒绝）——phase:65 四分类辖领域拒绝，配置/契约违约不属其列。无权威冲突。
- **R-1 回流**（两 Memory 夹具补 deleteSnapshot）：SA6 测试资产的前置缺口（`store.has===false` 断言 + 只读 hook 权威 ⟹ 夹具必缺删除能力），非设计保守——已列 §11 交总控（N'-8）。

### 9. D-11 错误词表（operation +'reset'|'import' 等）

**结论：no-conflict。**

- **append-only 授权链成立**：0010:222「Registry 仍负责……reset/archive 编排」是对 0009 公共面/fatal 面的演进授权；0009:89-93 是「**初始** phase 是」列举且「**至少**携带 operation、stable phase、committed 和 cause」未冻结 operation 值域；程序先例 = 0009:139（#131 修订节 2 增补 `namespace-id-generation` phase，append-only，既有值语义不变）——`operation + 'reset' | 'import'` 同款 append-only。observer 是内部 seam（0009:95「v1 不提供公共事件订阅」），事件联合 append-only + 消费方无穷尽 switch（设计 §9 grep 实证）。
- **Persistence 新码授权**：0010:218「为 Persistence 增加复制导入与归档所需的受控能力」+ phase:65 四分类；注册表归属 = 0008:125「以包内**各稳定码定义处**的 append-only 注册表为准……ADR 记录决策词汇，不复制实现注册表」——新码落 contract.ts 定义处（不入 ADR）正确。
- **「phase 词表零新增」声称属实**：Registry fatal phase 四值不动（reset/import 失败落 `lifecycle-slot-internal`/`runtime-construction` 既有值，语义吻合：close 失败/编排内部失败归 lifecycle-slot-internal 论证成立）；Persistence 侧 `DocArchiveFatalPhase` 是新族**自有**词表，不触碰 DocCreateFatalPhase 冻结面。
- **SA6 临时拼写全冻结 vs phase:65 四分类兼容**：归档四类恰为 duplicate（DOC_ARCHIVE_DUPLICATE）/identity mismatch（DOC_ARCHIVE_IDENTITY_MISMATCH，单一谓词收编损坏——SA6 边缘提示 8 预留的两可裁决之一，其用例只锚「拒绝+零改动」）/operational（DOC_ARCHIVE_OPERATIONAL）/committed-aware fatal（DOC_ARCHIVE_FATAL + 冻结映射）——四分类齐备无第五类；导入面 duplicate 复用 DOC_DUPLICATE、identity mismatch 新码、operational/fatal 复用冻结 create 族（code 为分支面，契约自宣示「callers branch on code」；message 含 createDoc 字样的取舍已文档化，Registry 映射后公共面无歧义）。兼容。

### 10. D-12 单一 Runtime 构造路径（namespace-runtime 零改动）

**结论：no-conflict。**

- **0008 #132 修订节一致性**：0008:131 构造期窄例外（发布前同步读两保留字段）已由 #132 交付；导入走**同一**构造路径 = 0010:66「Registry 打开新 Runtime generation」+ 0009:68 先例（「v1 接受 create compile 与 P0 compile 重复，以换取**单一 Runtime 构造路径**」）——不因「已核对过身份」跳过构造期预投影，窄例外（0008:131）不被扩张（Registry 侧读取不是 Runtime 读取面）。
- **构造失败分类**：TOCTOU 窗口下 `ReplicationMetaCorruptError` → `NamespaceRegistryFatalError('import','runtime-construction', committed:true)`，镜像 0009:70（createDoc 已提交而 Runtime 构造失败：释放 handle、保留持久化文档、清理 entry、committed:true fatal、不补偿删除）——导入侧同构成立（importDoc resolve ⟹ 快照已提交）。
- **namespace-runtime 零改动**：DENY 成立——#132 已交付全部 runtime 侧需求；判据以结构守卫副本落地（不击穿 runtime 值导出恰一键冻结审计）；open 路径逐字节不变（零回归）。

### 11. D-13 零文档改动

**结论：no-conflict（附 N'-1 知悉项）。**

- **授权内落地核对**：D-1..D-14 逐项均有已接受 ADR/phase 授权锚（见上各条）：受信导入（0010:28/65/phase:62）、排他创建（0006:118-133）、归档 seam 与守卫（0010:57/phase:63）、File/Memory 归档（phase:64）、四分类（phase:65）、reset 编排（0010:57/phase:113/0010:222）、Runtime 构造（0010:66/0009:68/0008:131-132）——**实现是对已接受 ADR 的落地而非新决策**的读法总体成立。
- **两项机制级裁决的定性**：强制 lease 失效（项 6）与 latest-wins 单槽覆盖（项 7）是**权威沉默**（而非权威条款）内的落地选择，且均有授权方向的组合支撑（0010:57+222 / 0010:57+201+218）并在设计中显式论证记录（§4.8.2/§4.9/§6-R5/R6）——不构成未声明演进（evolution 需「意图修订既有决策」，二者均不修订任何既有条款）。零文档改动声称因此成立；若 owner 在后续审查中认定任一属「应记录的新决策」，按既有修订节程序补记即可，不构成本门禁阻断（N'-1）。
- **稳定码不入 ADR**：0008:125 直接依据（「ADR 记录决策词汇，不复制实现注册表」）。**CONTEXT 无新词汇**：复制谱系/epoch/reset/bootstrap 均已定义（CONTEXT:117-123；bootstrap/reset/archive 为 ADR 0010/phase 既有词汇）；`ReplicationIdentityRef` 等为代码类型名非 CONTEXT 词汇。**先例**：#132 D-12（Runtime/Lease 复制管理面在 ADR 0010 已授权下零文档落地）同构。

### 12. §5 INV-1..INV-13 逐条抽查

**结论：全部 no-conflict。**

| INV | 对照 | 结论 |
|---|---|---|
| INV-1 排他永不让步 | 0006:121-123 三判定 + 跨面共享 claim 链 | 兼容 |
| INV-2 核对先于所有权转移 | 0010:65/AC-1（ownership 转移点 = 0006:126 lease 签发） | 兼容 |
| INV-3 导入字节原样继承 | 0010:54「首次 bootstrap 继承 hub 的完整 META 身份」（encodeStateAsUpdate 直写、零改写） | 兼容 |
| INV-4 归档提交不变式 | 0006:52 提交点纪律同构（见项 3） | 兼容 |
| INV-5 身份守卫单点 | phase:63 + 0008:132 判据族（语义单点，N'-7） | 兼容 |
| INV-6 零部分删除 | AC-4（拒绝即未删；守卫/探针先于一切存储变更） | 兼容 |
| INV-7 close→archive 次序 + 写结算 | 0010:57 + 0008:93（barrier 排空、不设内部 timeout） | 兼容 |
| INV-8 资格 = key 缺席 | 0010:57/N-2/0009:114（无新状态枚举） | 兼容 |
| INV-9 stale 重放拒绝 | CONTEXT:121-123 推论（同一守卫覆盖） | 兼容 |
| INV-10 owner 分区隔离 | 0010:30/0009:138/0006 #131 对齐 | 兼容 |
| INV-11 文件访问封闭 | 0010:57「WS 层不得直接读写 snapshot 文件」 | 兼容 |
| INV-12 词表 append-only + 零回显 | 0009:95 message 纪律（零 identity/cause 回显，设计 message 恒定单点）+ 0008:125 | 兼容 |
| INV-13 capability 显式 loud | 设计自有立法（拒绝虚假降级），无权威冲突 | 兼容 |

### 13. §7 ALLOW/DENY

**结论：no-conflict（未发现权威要求必须改的文件被误关）。**

- **ALLOW 覆盖核对**：权威要求的全部改动面——Persistence 双 Adapter/lifecycle/contract/io seam/fault seam（phase:62-65）→ persistence 6 文件 ✓；Registry 编排/词表/observer/导出（phase:113、0010:57/222）→ registry 5 文件 ✓；测试面（phase:184 故障注入、phase:183 File 恢复验收）→ SA6 5 文件（含 R-1/R-2 回流落位）✓。phase:65「不得由 WS 插件直接操作文件」无需 ws 包改动（包未建，AC-5 后半句由 seam 设计承载——简报:66 的读法一致）。
- **DENY 误关核对**：`docs/**`（项 11 论证成立）；`namespace-runtime/**`（#132 已交付构造期窄例外，本票判据走结构守卫副本，无需 runtime 改动）；`identity/lease/plugin/testing/create-document`（复用既有面：validateOpenIdentity 复用、强制失效走公共 release() 无新 lease 方法、无新注入需求）；`replication-protocol`（切片 5 已冻结）；`service.ts`（装配无关）。均正确。

## 设计引入的新决策点（全链 SA 复用；Phase 0 无 relevant_decisions 文档，此节即追加记录）

1. `importReplica`/`resetReplica` = `NamespaceRegistry` **required** 公共方法；信任模型文档化（0010:79 同款纪律：无 capability token、Host 装配信任边界、API 文档表述）。
2. `DocPersistence`/`PersistenceIO` 复制能力以 **optional 成员**建模 + 派生接口 `ReplicaPersistence`（required）；第三方 Adapter 可缺席，消费方 typeof 窄化 + 三处 loud gate（INV-13）。
3. `archiveDoc` 状态机 settle→claim(`archiving` 态)→guard-read→verify→relocate(writeArchive→remove)；**提交点 = writeArchive resolve**；`DOC_ARCHIVE_FATAL_PHASE_COMMITTED = {guard-read:false, relocate-write:false, relocate-remove:true}` 冻结导出。
4. 身份谓词单一：`ReplicationIdentityRef` 全等判定（id+epoch+格式合法），损坏/缺失/docId 不符统一 `DOC_ARCHIVE_IDENTITY_MISMATCH`；同 id 不同 epoch 算 mismatch。
5. `writeArchive`/`remove` 为 PersistenceIO optional 成员；fault seam 将 writeArchive 并入既有 write 故障/hold 槽；remove 透传。
6. reset 编排：owner 核对→强制失效未决 lease（公共 release()）→cancel idle→close→loadDoc 探针→archiveDoc；bootstrap 资格 = key 缺席（无显式标记）。
7. File 归档布局 `{rootDir}/archive/users/{u}/{ns}.snapshot` + tmp→rename + **单槽 latest-wins 覆盖**；Memory archive-scoped key `archive\0{primaryKey}` + optional `deleteSnapshot` hook + loud 配置门。
8. 词表 append-only：`NamespaceRegistryFatalError.operation + 'reset'|'import'`；Persistence 新增导入/归档错误族；Registry fatal phase 零新增；SA6 临时拼写全部原样冻结。
9. 复制事实判据语义源 = `readReplicationFacts` 判据族，以三处结构守卫副本（runtime/registry/persistence）互引落地。
10. SA6 回流 R-1（两 Memory 夹具补 deleteSnapshot）与 R-2（两类型锚改指 ReplicaPersistence）为转绿前置，交总控转 SA6。

## 冲突点

**无。**

- hard-violation：0；override-declared：0；evolution：0；全部对照项 no-conflict。
- 逐项核实要点：0010:218 确未指名 required/接口落位（设计的「未指名」声称属实）；0010:57 三步次序与 §4.8 逐句对应；phase:63/113 签名逐字保持；committed 映射与 phase:65/0008:86 纪律同构；latest-wins 与强制 lease 失效均为权威沉默内、有授权方向组合支撑的落地选择且已显式记录。

## 非阻断观察项（N'）

- **N'-1（两项沉默内裁决提请总控知悉）**：强制失效未决 lease（§4.8.2）与归档 latest-wins 单槽覆盖（§4.9）无 ADR 条款直接命名——判 no-conflict 的依据是「0010:57+222 / 0010:57+201+218 授权方向内的必要/最小落地 + 设计显式论证记录」。零文档改动声称依赖该定性。若 SA2 或 owner 复审认定任一达到「应记录决策」级别（例如 lease 强制失效的可观测语义、归档保留策略），按修订节程序补记 ADR 即可，不阻断本票。
- **N'-2（引用行号小误）**：§4.4/§2-D-4 引「ADR 0006:86-92（第三方 Adapter 演进位）」——该区间实为 dispose 义务与实施顺序；最接近条款是 0006:59（Adapter 内部替换实现不改 Interface）与 0006:82（两真实 Adapter）。optional 裁决的实质支撑（权威未指名接口 + 13 stub/绿守卫零回归事实 + loud gate）不受影响；建议 SA3/文档引用时更正。
- **N'-3（归档 tmp 启动清理作用域）**：0006:52「启动发现遗留 .tmp 一律忽略并删除」按上下文辖 `users/` 主键布局；设计对归档区取 per-key 单 tmp + 覆盖式 lazy 清理（无生产读路径）。满足 N-6 实质（不误删一半写入态、残留按 key 有界、tmp 永非提交态）；未来若统一启动清扫，须保持归档区「不删进行中的 tmp」边界。
- **N'-4（latest-wins 的数据面可见性）**：reset→bootstrap→再 reset 场景下上一轮归档副本被覆盖、不可恢复。权威无保留要求（0010:201 hub 备份为灾备权威），但该行为宜在后续 ws/部署切片的运维文档中明示（非本票 docs/** 义务）。
- **N'-5（observer 事件名复用的归因偏移）**：reset 探针路径复用 `open-load-failed`、`handle-release-failed` 事件形（§4.8 ③）且 `lifecycle-slot-failed` 有 operation 区分而 load-failed 形无——内部 seam append-only 无冲突（0009:95），但 metrics 诊断上 reset 路径的 load 失败会混入 open 域。建议 SA2/SA3 评估低成本区分（cause 类型可判别，非必须）。
- **N'-6（事实性小勘误）**：§9 称 `implements DocPersistence` grep「17 命中」，实测 16（registry/test 13 个文件的论据属实）；不影响任何裁决。
- **N'-7（判据三副本漂移风险）**：registry/persistence 各新增一份 readReplicationFacts 判据副本（与 runtime 原点三处互引）。0008:132 冻结的是判据**语义**（两态+损坏），未强制实现单点；副本做法不违反 N-1「不得另立第二套判据」的语义要求，但漂移防护依赖注释互引 + SA6 格式违约三分支用例——SA7 验收时应确认三分支锚在三个消费包内均有覆盖。
- **N'-8（SA6 回流是流程项非冲突项）**：R-1/R-2 涉及修改 SA6 owned 测试文件（两处 +1 行、两锚改型参 + import）；设计已列 §11 交总控按回流流程转 SA6 确认，SA3 仅按回流清单微调、不得改断言逻辑。

## 结论

**verdict: clear。放行（设计后复审通过）。**

- 冲突点数：0；裁决分布：no-conflict × 全部 13 个复审项 + INV-1..13 + ALLOW/DENY 核对；hard-violation / override-declared / evolution 均为 0。
- 设计对 Phase 0 观察项 N-1..N-9 逐条给出落位（§10 索引核对无误）；对权威条款的引用（0010:28/30/46-48/54/55/57/65/66/79/201/218/222、phase:62-65/113/183、0006:50/52/121-123/126-127/132/157-159、0008:86/93/125/131-132、0009:32/42/68/70/89-95/99/107-114/138-139、CONTEXT:113-123）经逐条回查属实（除 N'-2 一处行号小误）。
- 需总控知悉：N'-1（两项沉默内裁决与零文档改动定性）、N'-8（SA6 回流 R-1/R-2 为转绿前置）。
