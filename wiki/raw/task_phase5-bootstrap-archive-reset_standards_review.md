Conclusion: clear

# Standards/工程标准轴 终审报告 — issue #133「Phase 5: bootstrap import, archive, and guarded replica reset」

- **审查轴**：MABF 双轴终审 · Standards/工程标准轴（只读审查，未改任何文件）
- **审查对象**：worktree `/home/wangjian/nomicore-fix-issue-133`，`git diff ebc5419..dcda564`（30 文件：11 src +1214/-14、7 测试新增 +3686、12 wiki 档案新增 +2705）
- **基准文档**：docs/adr/0006（含 #64/#79/#131 节）、0008（含 #93/#132 节）、0009（含 #131 节）、0010；docs/phases/phase-5-websocket-replication.md；CONTEXT.md；冻结设计 wiki/raw/task_phase5-bootstrap-archive-reset_design.md（R4，1166 行——已全读并作为审查基准）
- **审查方法**：基准文档全读 → src diff 逐行（1674 行 unified diff 全读 + 现行文件上下文复核）→ 7 个测试文件抽读/全读 → 12 个档案交叉核对 → 可复现验证亲跑（§七）

---

## 一、分项核验表

| # | 分项 | 结论 | 关键证据 |
|---|---|---|---|
| 1 | ADR 纪律保持 | **通过** | 见 §二逐项（单 rootDir owner / tmp→rename / dirty-notification / degraded-retry / 三判定 / append-only / 零回显 / carrier FIFO·entry generation·idle I4·shutdown 三相 / 唯一 sequencer） |
| 2 | 代码质量 | **通过**（4 项 LOW 登记：J-2/J-3/J-4/J-6） | 无调试残留、无注释代码、无未使用导入、无 any（grep 扫描零命中）；cast 逐处论证见 §三；风格一致性（中文注释密度、设计节引用、模块注记）与既有面一致 |
| 3 | 测试质量 | **通过** | 零 real sleep（Date.now/Math.random 仅用于 tmpdir 唯一命名，与既有 File 测试同款）；fake scheduler + advanceBy、seeded PRNG（mulberry32 固定种子）确定性；fault 注入仅经规格化 seam；保持性守卫有效（转绿后仍绿） |
| 4 | 公共面卫生 | **通过** | persistence 主入口 +7 值 +4 类型与 §4.0.4 逐字一致；registry 主入口 +5 type-only、零新增值导出（九值冻结清单不动，registry-surface 审计含声明图禁词全绿）；零禁词面守卫（removeDoc/listNamespaces 等）转绿后保持绿 |
| 5 | 档案一致性 | **通过**（2 项瑕疵登记：J-1/J-5） | 档案链（简报→SA8→SA6→设计→SA2 R1/R2→SA3→SA4→SA7→AC 门禁→dispatch）与 git log/diff 交叉一致；全部关键计数/命令/退出码声称经亲跑复现（§五） |
| 6 | 可复现验证 | **通过**（1 处 whitespace 警告登记为 J-1） | 亲跑记录见 §七：typecheck exit 0；全量 test 142 文件 1711 用例 exit 0；5 文件单跑 79 用例 exit 0；`git diff --check` exit 2（仅 sa6_red.md:219 一处 EOF 空行） |

---

## 二、分项 1：ADR 纪律逐项核验

| 纪律 | 结论 | 证据（文件:行号） |
|---|---|---|
| 单 rootDir owner | 保持 | 归档封闭在 rootDir 内 `archive/users/<u>/<docId>.snapshot` 子树：packages/persistence/src/file.ts:213-227（`resolveArchivePaths` 以 `this.options.rootDir` 为根 + SAFE_PATH_SEGMENT 双段守卫 :222-223）；启动 `.tmp` 清理面不触及归档区（路径子树分离） |
| tmp→rename 原子提交 | 保持 | file.ts:158-167 `writeArchiveSnapshot` = mkdir(recursive)→writeFile(tmp)→rename，abort 门位 entry/after-mkdir/after-writeFile——与既有 `writeCommittedSnapshot` 同构；tmp 永非提交态 |
| saveDoc=dirty notification 不过度承诺 | 保持 | lifecycle.ts:501-511 saveDoc 原样未动；archiveDoc 成功返回 `Object.freeze({ok:true})` 不含任何落盘承诺（lifecycle.ts:437）；`DOC_ARCHIVE_FATAL_PHASE_COMMITTED` 冻结映射（contract.ts:195-199）由构造器派生 committed（:931），调用方不重推导 |
| degraded/retry 语义 | 保持 | settle 段尊重回退：lifecycle.ts:471-479——retryTimer 武装 ⟺ degraded 回退窗时被动等待（不强制 flush、不热循环），SA7 1b/1d 用例动态实证（write 尝试计数有界、逐步 +1）；saveDoc  degraded 非拒绝理由条款未动 |
| 排他创建三判定 | 保持 | importDoc 复用 createDoc 同一 claim 环（lifecycle.ts:226-283 `exclusiveCreate`）：live→duplicate（:240）、creating→duplicate（:241）、reading→await 探读证据见快照即拒（:248-266）、archiving→await claim 重评估（:242-247）；唯一差异位 = 身份校验分叉（:233-234），均先于 claim 与任何 io 访问 |
| 错误族 append-only | 保持 | contract.ts 全部为新追加（YjsDoc/ReplicationIdentityRef/ReplicaPersistence/6 错误类/phase 映射），既有类与 message 零改动；registry errors.ts:13-23 operation 联合 +`'reset'\|'import'`（append-only，授权注记在案）；observer.ts:45-49 三事件形追加于联合尾部、`lifecycle-slot-failed.operation` 联合扩展（:31）——既有 11 形零改动 |
| 稳定 message 零回显 | 保持 | 全部新 message 为不可插值常量：contract.ts:857-933（六类）、types.ts:86-96（五条 NAMESPACE_*_MESSAGE）；两处 bare loud Error（lifecycle.ts:493-499 assertArchiveIo、registry.ts:1394-1401/1489-1496 capability gate）message 恒定、零 identity/cause/输入回显 |
| carrier FIFO | 保持 | registry.ts:1344-1357（admitImportSlot）/:1446-1458（admitResetSlot）与 open 同一机械：`carrier.tail.then(...)` 串行 + green-tail + scheduleCarrierCleanup；reset/import 槽经 carrier tail 纳入 shutdown 已接纳屏障 |
| entry generation（I2/removeOnlySelf 双守卫） | 保持 | registry.ts:970-986 `beginCloseCurrent`：closePromise 先赋值后翻相（I2，:977-978）+ settle 处理器挂接 `removeEntryAfterClose`（双守卫移除）；close 同步 throw 收编为 rejected Promise（:973-975） |
| idle I4 / shutdown 三相 | 保持 | `cancelIdleArm`（registry.ts:955-961）clearTimeout + token 失配使迟爆回调 no-op；idle timer 回调的 token+phase 双守卫零改动；shutdown 三相与聚合面零改动；`forceReleasing` 抑制（:853）仅跳过 idle 武装与 entry-idle 事件，lease-released 照发（设计 §4.8.2 冻结语义） |
| 唯一 write sequencer | 保持（本票无绕过面） | 本票不新增任何 live Y.Doc 写路径：导入后 Runtime 走单一构造路径（registry.ts:1430-1440，`factory(handle, () => persistence.saveDoc(handle))` 与 open/create 同款，P0 照常入队）；archive 只操作持久字节与 scratch Y.Doc（lifecycle.ts:398-407）；reset 仅关闭 generation；Registry 对调用方 detached 输入 doc 的只读核对（registry.ts:156-217）发生于 ownership 转移之前，不属 sequencer 管辖（设计 §4.2 TOCTOU 声明在案） |

---

## 三、分项 2：cast 安全性逐处论证

| 位置 | cast | 论证 |
|---|---|---|
| registry.ts:1684 | `doc as YjsDoc`（公共入口 unknown→YjsDoc） | 敌意输入契约面：槽内 `readMetaDocId`/`readImportedReplicaFacts` 对非 Y.Doc 形状全程 try/catch 收编为拒绝（:156-217），cast 不带来未防护面 |
| registry.ts:1699 | `expectedLocalIdentity as ReplicationIdentityRef` | 失败安全：畸形/缺席期望身份在 archiveDoc 守卫内恒判 mismatch（lifecycle.ts:391-401 的 `expected.replicationId` 访问在 try 内，null 亦收编为 DocArchiveIdentityError）→ 稳定拒绝、零删除 |
| registry.ts:165 | `doc.getMap('META') as unknown as MetaProbe` | 结构子集（has/get 形状）；目的 = 不命名 yjs 类型；getMap 载体异型 throw 由外层 try/catch 收编（:163-168） |
| registry.ts:1412 / 1561 | `cause as DocCreateOperationalError` / `as DocArchiveOperationalError`（observer 事件字段） | code-first 判别后的名义收窄（§4.8.3 裁决：code 即契约分支面，contract.ts:181 自宣示）；duck-typed 实现的事件字段名义类型或不准，但 observer 是内部 seam（ADR 0009:95 允许携带 exact cause），无公共面后果 |
| lifecycle.ts:403,415 `this.io.writeArchive!`/`this.io.remove!` | 非空断言 | 由 archiveDoc 入口 `assertArchiveIo()`（lifecycle.ts:342/:493-499）背书：io 构造期成型不可变，入口单查覆盖全程（设计 §4.4 放置点表） |
| testing.ts:787,789,800 | 内层 `io.writeArchive!`/`io.remove!` | 生产 Memory/File baseIo 恒提供两方法；假设性「fault seam 包装缺席 io」场景会绕过 lifecycle gate 以 TypeError-as-operational 浮出——仓内不可达，登记 J-8 |
| `KeyClaim = { promise: undefined! }`（lifecycle.ts:286/379） | 非空断言 | 既有 CreateClaim 同款范型（基线既有）；promise 在紧随的同步赋值点落位（:330/:450） |

其余质量面：调试残留/注释代码/未使用导入/`any`/TODO 扫描零命中（`git diff -- packages/*/src | grep` 实测）；新增注释为仓库既有风格（中文密注 + 设计节 §/ADR 引用 + 裁决留痕）；无新增 src 文件，既有文件头模块注记未动（contract.ts/lifecycle.ts 基线即无文件头注记，registry.ts 既有头部保留）。

---

## 四、分项 3/5 补充证据

**测试质量**：7 个新文件全部经真实 yjs/真实 Memory·FilePersistence/真实 Registry+Runtime（真实 tmpdir、真实 fs rename）；`Date.now`/`Math.random` 仅出现于 tmpdir 唯一命名（5 处，与既有 file-persistence 测试同款）；`schemaReady` 为 400 次微任务预算栅栏（非定时等待）；SA7 两文件全部竞态用例包 `withTimeout`（超时即失败）+ seeded PRNG（mulberry32，种子 0x5a7a_0011/0xb00b_1e5e 等）×50 轮且两形态命中数均有 >0 断言守卫；fault 注入仅经 `createPersistenceIoFaultSeam` 或构造期 `wrapIo` 规格化 seam；保持性守卫（DOC_DUPLICATE 不变 / create 恒三键 / 无删除枚举面）在转绿后仍绿（全量 run 实证）。

**档案一致性**（交叉核验全过，瑕疵见 J-1/J-5）：
- 提交链：dcda564 单提交；diffstat 30 文件 +7605/-14 与 dispatch 第 20 行声称逐字一致；src 11 文件 +1214/-14 与 SA3 报告/AC 门禁/任务简报一致（numstat 亲算复核）。
- 设计 R4 = 1166 行（与 dispatch 第 17 行「1160→1166」一致）；R1 1053/R2 1146/R3 1160 修订链与 SA2 两报告、SA4 报告基线声称互洽。
- 测试计数：SA6 §2.1（22+13+17=52 红 / 3 守卫绿）与本审复跑总数（23/14/18）一致；SA7 24 用例（14+10）、类型锚 8（4+4）与 AC 门禁「55+24+8」一致；dispatch 第 13 行「140 文件 1687」→ 终态 142/1711 的增量恰为 SA7 两文件（+2 文件/+24 用例）。
- SA3 两项偏差（ImportReplicaIssue additive 补 NAMESPACE_NOT_FOUND；import-red File 夹具 ENOENT 容错 6 行）在 SA4 F-1/F-2、设计 R4 注记、SA6 §8.6 三处留痕互洽；实现侧逐字核验一致（types.ts:679-683 含 R4 补列成员；import-red.test.ts:137-146 为 6 行 walk 容错、零断言改动）。

---

## 五、发现清单（J-1..J-8；无 BLOCKER/HIGH）

| # | 级别 | 位置 | 发现 |
|---|---|---|---|
| J-1 | MEDIUM | wiki/raw/task_phase5-bootstrap-archive-reset_sa6_red.md:219 | `git diff ebc5419..dcda564 --check` exit 2：该档案文件 EOF 多一个空行（blank-at-eof，core.whitespace 默认规则）。phase-5 文档 §阶段门禁（:213）点名「git diff --check 通过」。30 文件中唯一一处；一行可修（删末行空行）。不影响代码/测试/契约，但形式上会绊住该具名门禁命令，建议合入前顺手清除。 |
| J-2 | LOW | packages/persistence/src/lifecycle.ts:288,330-331 | 中间名 `op2`：`exclusiveCreate` 内局部变量由基线的 `op` 改名为 `op2`，同作用域并无 `op`/`op1`，而兄弟方法 `runArchiveDoc`（:403-451）使用 `op`——同名语义两写，读起来像存在第二个操作对象。建议复名 `op`。 |
| J-3 | LOW | packages/persistence/src/lifecycle.ts:703 | 注释笔误：「Persistenced 持久层校验面」应为「Persistence 持久层校验面」（多一个 d）。 |
| J-4 | LOW | 8 处（下列） | 新增注释引入**文件内行号自引用**且全部已漂移（基线惯例：ebc5419 全仓 src 零此类自引用，grep 实证）——① registry.ts:1363 与 :1472「runOpenSlot:854-856」（runOpenSlot 现行 :1032；854-856 现为 handleLeaseReleased 函数体）；② registry.ts:1366「registry.ts:237-241」（NOT_FOUND_ISSUE 现行 :320）；③ registry.ts:220「contract.ts:44」（该 docstring 现行 contract.ts:181）；④ contract.ts:151「contract.ts:115-131」（映射表现行 :263）；⑤ file.ts:103「file.ts:128-131」（validateIdentity 现行 :180）；⑥ lifecycle.ts:223「lifecycle.ts:456-461」（validateCreateDoc 现行 :696-701）；⑦ lifecycle.ts:459/:475「maybeEvict（590-596）」（现行 :859）；⑧ memory.ts:181「MEMORY.ts:124-127」（dispose 现行 :176，且文件名大小写笔误）。这些是设计文档基线锚点被原样搬进代码注释所致；建议删行号留符号名（§ 设计节引用保留即可）。 |
| J-5 | LOW | wiki/raw/task_phase5-bootstrap-archive-reset_sa6_red.md:218；wiki/raw/task_phase5-bootstrap-archive-reset_dispatch.md 第 2 行 | 档案计数笔误（与可复现结果不符）：SA6 §8.6 声称复跑「archive-red（22）与 registry-bootstrap-reset-red（19，含保持性守卫）亦全绿」——本审亲跑实际总数为 23 与 18（§2.1 表自身亦记 23/18，52 红+3 守卫口径在别处均正确）；dispatch 第 2 行「4 类型红（2 保持类型绿）」——实际类型绿守卫为 4（两 surface 文件各 2，SA6 §2.1「4 failed | 4 passed」自证）。语义零影响，属档案留痕瑕疵。 |
| J-6 | LOW | packages/namespace-registry/src/registry.ts:209-217 | `readMetaDocId` 用 `doc.getMap('META')` 探测：META 缺席时会在**调用方输入 doc** 上创建空 META 再判 mismatch（Yjs getMap 的创建语义）；同文件 `readImportedReplicaFacts`（:179-206）已用 `doc.share.has('META')` 前置规避该副作用，两者不对称。仅在拒绝路径发生、裁决结果不受影响；可考虑补 `share.has` 前置以纯化。 |
| J-7 | INFO | 三个 SA6 红灯文件（asImport/asArchive/asResetRegistry/asImportRegistry 等 cast 辅助） | 契约冻结后这些「临时契约」cast 已冗余（方法已在公共接口上）；按「SA6 owned + 最小触碰」纪律保留，接口形状由两个 surface test-d 锚（HasResetReplica/HasImportReplica/HasArchiveDoc/HasImportDoc）兜底，无回归风险。留作后续清理候选。 |
| J-8 | INFO | packages/persistence/src/testing.ts:787,789,800 | fault seam wrap 对内层 `io.writeArchive!`/`io.remove!` 的非空断言：若第三方以本 seam 包装一个缺归档能力的 io，lifecycle 的 capability gate（检查的是包装后对象，四方法恒在）不触发，违约以 TypeError 落入 operational 分类而非 loud gate。仓内不可达（Memory/File baseIo 恒提供），设计 §4.6 已声明「内层缺席属 capability 违约」。记录在案。 |

---

## 六、分项 4：公共面卫生核验明细

- `packages/persistence/src/index.ts`：+7 值（DocImportIdentityError、DocArchive{Identity,ActiveHandle,Duplicate,Operational,Fatal}Error、DOC_ARCHIVE_FATAL_PHASE_COMMITTED）+4 类型（YjsDoc、ReplicationIdentityRef、ReplicaPersistence、DocArchiveFatalPhase）——与设计 §4.0.4 逐字一致；persistence 主入口无「恰 N 键」冻结审计，增量为授权最小面。
- `packages/namespace-registry/src/index.ts`：type-only +5（ImportReplicaIssue/ImportReplicaResult/ResetReplicaIssue/ResetReplicaResult/ReplicationIdentityRef），**零新增值导出**；registry-surface.test.ts 九值冻结清单未动、声明图禁词审计（NamespaceRuntime/DocHandle/Y.Doc/internal subpath）在全量 run 中通过——`YjsDoc` 别名达成禁词规避（声明图文本不含 `Y.Doc`）。
- optional 成员建模：`DocPersistence.importDoc?/archiveDoc?` + `PersistenceIO.writeArchive?/remove?` optional，required 保证面由派生接口 `ReplicaPersistence` 表达（contract.ts:814-850）；13 个既有 stub + 三成员字面量绿守卫 + 既有 wrapIo 字面量零改动合法（typecheck exit 0 实证）；Registry typeof 窄化 + loud fatal gate（registry.ts:1394-1401/1489-1496）、lifecycle io gate（lifecycle.ts:493-499）、Memory loud 配置门（memory.ts:122-131）——能力缺席三处响亮拒绝，无静默降级。
- 零禁词面：无 removeDoc/deleteDoc/listDocs/enumerateDocs/moveDoc/listNamespaces/removeNamespace 等成员（两个 surface 文件的负向守卫全绿）。

---

## 七、分项 6：可复现验证记录（本审亲跑，非转述）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `git diff ebc5419..dcda564 --check` | **2** | 1 处 whitespace 警告：`wiki/raw/task_phase5-bootstrap-archive-reset_sa6_red.md:219: new blank line at EOF`（J-1）；30 文件其余零问题 |
| `pnpm typecheck`（后台，日志 /tmp/std-review-typecheck.log） | **0** | 10 包 tsc 链全过 |
| `pnpm test`（后台：`setsid nohup bash -c 'pnpm test > /tmp/std-review-test.log 2>&1; echo $? > /tmp/std-review-test.exit' &`，轮询 .exit 收集） | **0** | `Test Files 142 passed (142)` / `Tests 1711 passed (1711)` / Duration 125.63s；日志中 6 处「fail」字样均为 fail-closed 用例名，非失败 |
| `pnpm vitest run` 五文件单跑（persistence-phase5-archive-red / persistence-phase5-import-red / registry-phase5-bootstrap-reset-red / persistence-sa7-phase5-bootstrap-dynamic / registry-sa7-phase5-bootstrap-reset-dynamic；后台同法，/tmp/std-review-5files.log） | **0** | `Test Files 5 passed (5)` / `Tests 79 passed (79)`（23+14+18+14+10，与各文件声称计数一致） |

全量 run 中本票 7 个测试文件逐一在列且全过（含两个 surface test-d 的 vitest typecheck 相位）；AC 门禁声称的「142 文件 1711 用例全绿、typecheck 10 包链 exit 0」由本审独立复现。

---

## 八、结论陈述

**Conclusion: clear。** 交付与冻结设计 R4 逐节一致，ADR 0006/0008/0009/0010 纪律逐项保持，测试真实性与确定性纪律达标，公共面增量最小且守卫在位，档案链可交叉复现。无 BLOCKER/HIGH。登记 1 项 MEDIUM（J-1：wiki 档案 EOF 空行使 `git diff --check` 非零——一行可修，建议合入前清除）、5 项 LOW（J-2..J-6：命名/注释笔误/陈旧行号自引用/档案计数瑕疵/读取副作用不对称）、2 项 INFO（J-7/J-8）。全部为非阻断项，不构成合入障碍。

- 审查纪律：只读 + 本报告；未改任何 src/test/wiki/docs 文件。
- 审查人：Standards 轴独立审查 subagent；日期 2026-05-30（流水线 Phase 4 双轴终审）。
