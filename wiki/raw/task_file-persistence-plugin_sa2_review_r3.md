# SA2 攻击评审报告（R3 — PR #66 owner review 修订轮）

**Date**: 2026-08-21
**Reviewer**: SA2（Wallfacer，全新视角复审）
**被审对象**: `wiki/raw/task_file-persistence-plugin_design.md` 的 R3 修订部分——决策 G / 决策 H / 决策 E 理由 4 / 决策 I + §4.1/§4.3.2/§4.4/§5a/§5b/§6.4/§7(P11/P12)/§8/§9/§10 随动 + 文末「Owner Review 反馈逐条回应（R3）」
**评审输入**: `task_file-persistence-plugin_revision.md`（owner 反馈 5 项 + 总控研判 + 复审门禁 7 条）、`task_file-persistence-plugin.md`、`task_file-persistence-plugin_relevant_decisions.md`（ADR-0006 条款为约束基准）、分支 `fix/issue-58-on-adr-server-design` HEAD=e8e4fb8 实际代码
**Verdict**: **pass**（附 4 项非阻断 LOW 修订建议，见攻击点清单；五条设计层门禁全部满足）

---

## 一、复审门禁逐条对照（owner checklist 中设计层条目）

| # | 门禁 | 裁决 | 依据（设计位置 + 代码实证） |
|---|------|------|------|
| G2 | 无 `index → adapter → lifecycle → index` 循环 | **满足** | 决策 G 目标图为 owner 原文五边逐边落地；四个反向 import 点实测全部存在且全部在切换清单内：`src/lifecycle.ts:12-21`（**值**导入 provideDocPersistence/resolvePersistenceSchedule/systemPersistenceTimer ← barrel，环的实边）、`src/memory.ts:8`（type-only）、`src/file.ts:13`（type-only）、`src/testing.ts:2`（type-only）。切换后 contract.ts 为运行时零 import 叶子（provideDocPersistence 走 `ctx.provide` 方法、systemPersistenceTimer 走 `globalThis.setTimeout`，cordis/yjs 仅 type-only——已对 `src/index.ts:1-116` 现行实现逐名核对，成立）。index.ts 纯聚合零定义，图成 DAG |
| G3 | adapter 模块可直接导入，不依赖导入顺序 | **满足** | 无值边指向 barrel ⇒ 任意入口次序安全；`test/module-graph-regression.test.ts` 双锚点（深导入构造实例 + src 反向导入静态守卫）；vitest 配置未见 `isolate:false`，per-file 独立模块注册表成立，深入口被真实求值。根因论证链完整：P11（SA4 探针实测环=TDZ 根因，已标作废留档）→ P12（拆环后崩溃条件不复存在） |
| G4 | degraded/recovery 按 namespace/entry 隔离 | **满足** | 决策 H 五点机制：`CoreEntry.degraded` 初值 false；flush 失败仅置本 entry；`saveDoc` 门禁下沉至 ownership 之后仅查本 entry（消息逐字保留，实测 `lifecycle.ts:334` 原文一致）；test 工厂「命中 degraded entry 才拒、新建恒允许」；`degraded ⇒ dirty` 不变式由现行 flush 守卫（`lifecycle.ts:255`：clean 即 return）严格推出——degraded entry 永不满足 `maybeEvict` clean 前置（`:296`），标志无驱逐泄漏。全代码面清 degraded 的唯一位置 = 该 entry 自身 flush 成功（§4.1 伪代码 :309），无任何全局复位路径残留 |
| G5 | 无关 doc 成功不能提前恢复失败 doc | **满足** | flush 成功路径只执行 `entry.degraded = false`（本 entry）；`status` 存储字段删除（现行 5 处 `this.status` 引用实测全部位于 lifecycle.ts:98/150/265/268/334，无 adapter 侧引用，删除封闭）；getStatus() 改聚合现算纯观察视图、不参与门禁。旧「任一成功即全局 ready」窗口在机制上不可再现 |
| G6 | `.tmp` 非 ENOENT 删除失败按最终 ADR 语义处理并测试 | **满足** | 决策 E 理由 4 + §4.3.2 `sweepLeftoverTmp` 去掉 `.catch(() => undefined)`（现行代码 `file.ts:93` 实测确认该 catch 存在，为改动前状态）。语义精确性验证：`rm force:true` 下 ENOENT 永不产生错误（P4 实测），故去掉 catch 后浮出的错误集 ≡ 非 ENOENT 错误集——「仅 ENOENT 静默」与实现形态严格等价，无第三态。errno 原样透传（readCommittedSnapshot 无包装）。不修改 ADR（「忽略内容并删除」义务语义不变，错误处理收紧），与 owner 推荐方案及总控研判 #4 一致。测试锚点重写（SA7 test 1：EACCES → loadDoc rejects + tmp 原地 + 治愈后恢复）覆盖非 ENOENT 分支 |
| （G1/G7） | diff 无 `.mabf-bg/**`/TASK.md；全量 test/CI | 不属设计层 | 实测 `git ls-tree -r HEAD` 确认分支仍有 5 个 `.mabf-bg/**` 文件——owner #1 已路由 SA3 机械清理，设计 §10 步骤 5 含 push 前 `git ls-tree` 复核门禁，处置正确（登记于攻击点清单 #5 供追踪，非设计缺陷） |

**决策 I 专项（owner #5，非门禁但本轮被审）**：三处 JSDoc（rootDir 完整声明 / 类一行交叉引用 / 工厂一行交叉引用，§4.3.1–4.3.3）与 owner 原文「同一 rootDir 同时只能由一个活跃实例拥有；HMR 必须等待旧实例 dispose/drain 后再加载」逐点对应；"dispose() drains all in-flight flushes" 措辞有 §4.7 的 `allSettled(inFlight)` 支撑。与决策 E 的 HMR 语义自洽：旧实例 abort 在途 flush 遗留的 tmp 由新实例 load 惰性清扫兜底。行为不变（决策 F），仅契约入代码面。**通过**。

## 二、伪代码与既有 R0–R2 文本 / 分支现行代码一致性验证

对「除标注 ← R3 的行外与分支现行代码逐字一致」的自称做了独立抽查（逐字级）：

| 声明 | 实证 |
|---|---|
| 现行 saveDoc/工厂门禁 = §8「改动前契约」列（全局、先于 identity/ownership） | `lifecycle.ts:120`（`assertWritable()` 首位）、`:164` 同 ✓ |
| 错误消息逐字 | `'persistence-degraded: writes are rejected until retry succeeds'`（:334）、`'foreign or released DocHandle'`（:124/:326）✓ |
| `status` 字段全部引用点被 R3 四处定点改动覆盖 | :98（getStatus 聚合替代）、:150（dispose 行删除）、:265/:268（flush 两处 → entry.degraded）、:334（assertWritable 删除）✓ 无遗漏引用 |
| flush 守卫/finally/maybeEvict/scheduleRetry 语义 | :255/:270-282/:295-300/:285-293 与 §4.1 伪代码逐行对应 ✓ |
| P2 测试行号 | :277/:284/:285/:288、:315/:322/:325、dispose getStatus ×5（:423/:451/:472/:494/:509）grep 实测精确命中 ✓ |
| SA6 零改动声明 | `file-persistence.test.ts` getStatus 仅 :317（ready，单 entry 成功）/ :338/:362（disposed，closed 优先）——聚合语义下可观察等价 ✓；tmp 两用例走可写/ENOENT 路径 ✓ |
| SA7 现状 = 反向冻结 | 头部「Module-entry discipline」workaround 实测存在（:29-36）；test 1 (a) 断言「load 成功 + tmp 保留」、test 2 断言「跨用户传染 + 任一成功全局恢复」——均为待重写的错误语义冻结，§5a 重写规格与之逐点对应 ✓ |
| P2 `:285` 翻转可行性 | 逐步推演：翻转后 `saveDoc(other)` 排 500ms debounce；`advanceBy(500)` 同时结算 doc1 retry（failures 已耗尽→成功→degraded 清除）与 other flush（成功）；:288 聚合 ready、:289 saveDoc(second) resolves——同块其余断言在 entry 级语义下保持绿 ✓。第二个 degraded 用例（:289-327）在 R3 下为「release 后 cache hit（dirty entry 未被驱逐）→ saveDoc 拒绝 → retry 成功恢复」，逐断言推演通过 ✓ |
| memory.ts `??` 回落缝隙 | §4.2 注释与 `memory.ts` 现行表达式逐字同构（含 R1 三分支语义注记）✓ |
| 版本 bump 起点 | package.json `"version": "0.1.1"` 实测，R3 → 0.1.2 正确 ✓ |
| 包外涟漪面 | grep 实测 `persistence-degraded`/`FilePersistence`/`PersistenceLifecycleCore` 在 packages/persistence 之外零命中；test 侧 `../src/index.js` 导入（contract/memory/file-persistence/memory-testkit/sa7-dynamic）均为正向边、不在守卫范围 ✓ |

未发现 R3 修订破坏决策 A–F 任何未改写条款；R1/R2 已通过的修订内容（E 理由 2/3、TS2379 修正、`??` 注释、degraded 披露〔已被 H 全文替换且替换正确〕、P1-P11 依据）与 R3 文本无矛盾。

## 三、攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 修订要求（非阻断） | 红灯测试构想 |
|---|--------|--------|---------|------|------|
| 1 | LOW | 决策 G / §4.4 / §9 / 文末回应表 | **「P1 契约面 12 名」计数错误**：§4.4 re-export 块实际枚举 11 名（User/DocHandle/DocPersistence/DOC_PERSISTENCE_SERVICE/DEFAULT_PERSISTENCE_SCHEDULE/PersistenceSchedule/PersistenceTimer/systemPersistenceTimer/resolvePersistenceSchedule/provideDocPersistence/requireDocPersistence），与 `src/index.ts:1-116` 现行定义逐一核对恰为 11 名 + Context 模块增强（12 **项**而非 12 **名**）。枚举集合完整正确（无漏迁风险），但「逐字搬迁」类任务中的计数错误会诱发 SA3/复审者寻找幽灵第 12 名 | 三处统一改为「11 名 + Context 模块增强」或「12 项（11 导出名 + 1 模块增强）」 | `module-graph-regression.test.ts` 追加公共导出面快照断言：`Object.keys(await import('../src/index.js'))` 精确等于 23 名集合（11+3+5+4），把计数机械化钉死，同时充当「公共面逐字不变」的永久守卫 |
| 2 | LOW | §10 步骤 1 | **指令不可执行**：`pnpm --filter @nomicore/persistence test` ——该 package.json 无 `scripts` 段（实测确认，仅 name/version/private/type/exports/dependencies），pnpm 将报 "None of the selected packages have a test script"。loud fail 无静默风险，但它是修订轮给 SA3 的第一条命令，失效会诱发自行发挥 | 改为根目录 `pnpm test`（vitest run --typecheck 全仓）或 `pnpm exec vitest run packages/persistence`；步骤 5 已用根命令，两处对齐 | 无需测试（文档指令修正） |
| 3 | LOW | 决策 E.1 措辞 | **「滞留 tmp ……不阻塞任何读写路径」缺一句限定**：E.1 为 R1 旧文，在新语义下残留 tmp 被再次访问且 rm 以非 ENOENT 失败时，load 该 namespace 会响亮拒绝——**即使 `.snapshot` 完整可读**（读可用性与 tmp 可删性耦合）。该耦合是 owner 裁定的预期行为且已被重写后 SA7 test 1 显式钉死（r-x 分区下 readFile 成功、rm EACCES → loadDoc rejects），非缺陷；但 E.1 现文与 E4 并读会产生「tmp 永不影响读路径」的误读 | E.1 补一句：「健康磁盘上残留 tmp 在该 namespace 被访问时即被删除、不影响任何路径；仅当删除以非 ENOENT 失败时，load 该 namespace 按决策 E 理由 4 响亮拒绝（与残留集合正交的磁盘故障路径）」 | 建议性增强：SA7 test 1 追加对照断言——alice/d1（tmp 不可删）loadDoc rejects 的**同时**，同实例 alice/d2（无 tmp、快照在）loadDoc 正常成功，证明响亮失败按 namespace 键控、非适配器级读瘫痪（补强 G4 门禁在读路径的隔离证据） |
| 4 | LOW | §5a module-graph 静态守卫 | **守卫匹配语义未定义到可实施精度**：对 src 源文本直搜 `./index.js` 会被注释误伤（lifecycle.ts 头注释、迁移期注释可能含该字符串），也可能漏掉 `import('./index.js')` 动态导入与双引号形态——守卫假阳性会阻断 CI、假阴性则环回潮不可检 | §5a 该行补匹配规则：对 import/export/from 语句行匹配（含单/双引号、动态 import），或对去注释源码断言无 `from './index.js'` 与 `import('./index.js')` | 守卫自测：测试内构造两段样例（含注释提及 `./index.js` 的合法源 / 含真实反向 import 语句的违规源）分别断言 pass/fail，锁定守卫判定边界 |
| 5 | INFO | owner #1（非设计缺陷，追踪登记） | 分支 HEAD 实测仍提交 5 个 `.mabf-bg/**`（baseline.log、final-verify.log、sa3-verify.log、baseline-test.log、red-confirm.log）——已正确路由 SA3，设计 §10 步骤 5 含 push 前 `git ls-tree` 空输出门禁 | 无（SA3 机械清理 + 总控 push 前复核） | 总控 push 前执行 `git ls-tree -r HEAD --name-only \| grep -E '^\.mabf-bg/\|TASK\.md'`，必须空输出 |

以上 5 项均不构成架构/语义漏洞：#1/#3/#4 为文档精度与守卫实施精度问题，#2 为指令勘误，#5 属 SA3 职责。**无需 SA1 重开设计轮**；建议 SA1 在 SA3 动工前顺手落字修正 #1–#4（合计约 6 行文本改动），是否强制由总控裁定。

## 四、攻击后确认无漏洞的面（正面结论，供 SA4/SA7 复用）

1. **拆环完备性**：四个反向 import 点（lifecycle 值边 + memory/file/testing type 边）全部在 G 的切换清单内，无第五个漏网点（grep 实测 src/ 仅 5 文件）；contract.ts 零运行时 import 论证对现行实现逐名核验成立；`index ⇄ memory` 类型环同步消失。
2. **`degraded ⇒ dirty` 不变式**：由 flush 入口守卫（clean 即 return）+ 失败不推进 generation + saveDoc 门禁先于 dirtyGeneration 递增，三段联合严格成立；degraded entry 永不蒸发、标志无泄漏路径；恢复唯一出口 = 本 entry flush 成功。
3. **聚合 getStatus 可观察等价性**：单 entry 场景（P2 :277/:288/:315/:325、SA6 :317）逐断言推演原绿；多 entry 场景为纯聚合观察、不参与门禁——与 owner「保住适配器级可观测性」意图一致。
4. **E4 无第三态**：`force:true` 使 ENOENT 永不浮出（P4 实测），去 catch 后浮出错误集 ≡ 非 ENOENT；loading 合流下清扫失败使同一 loading promise reject，无半还原状态残留（loading.delete 在 then/catch 双分支执行）。
5. **错误链路**：文法违例 / META.docId 不一致 / 损坏字节 / 非 ENOENT 读错误 / 非 ENOENT 清扫错误 / disposed / foreign-released / rootDir 非法全部 loud；唯一静默分支 = ENOENT（≡ 无文件，语义正确）。
6. **伪降级排查（2026-05-07 立法专项）**：degraded 仅由真实 I/O 失败触发（磁盘故障），非正常路径前提缺失被降级掩盖的场景——未发现伪降级。
7. **包外涟漪封闭**：行为契约改动（§8 表 4 行）的 caller 全部为包内测试，grep 实测包外零消费者。

## 五、协议假设依据审查（§7）

- 章节存在，R3 增补 P12、作废 P11（保留根因记录，作废标记明确）。
- P12 三支柱：owner 给定目标图（权威规格，非无据推断）、SA4 F-1 探针实测（崩溃点/入口次序记录可复跑）、回归测试前瞻锚点（深导入构造 + 静态守卫）——依据类型与内容均可被 SA4/SA7 定位复验。
- P4 补充 EACCES 实测（chmod 555 → `rm` EACCES 拒绝，PR #66 SA7 test 1 实测）为 E4 的语义基础——命令与现象在案。
- 残留假设仅「type-only 导入运行时擦除」，由 `verbatimModuleSyntax` + 既有全绿背书，风险标注「低」恰当。
- 未发现「应该/通常/预计」类无据推断承载关键结论。**通过**。

## 六、错误处理链路审查

- **静默失败**：R3 恰好消除了全链路最后一个静默吞掉点（sweep 的 catch）；矩阵无新增静默路径。✓
- **状态闭环**：degraded 置位/清除均闭环于 entry；errno 透传无包装丢失；dispose 幂等 + closed 驱动聚合 disposed。✓
- **降级路径**：读路径在 degraded 下保留（ADR「保留读/查询」），写拒绝仅限失败 namespace；retry 指数退避至成功或插件停止（ADR 逐字）。✓
- **用户可感知性**：loadDoc/saveDoc 的全部失败模式均以 throw 显式上抛至宿主调用方。✓
- **虚假降级**：未发现（见四-6）。✓

## 七、红线测试思路汇总

见攻击点清单 #1/#3/#4「红灯测试构想」列 + 以下门禁级回归（SA3 落地、SA7 复查时必须全绿）：

1. **module-graph**：三个 src 深路径（file/memory/lifecycle）零 index 依赖直入 → `new FilePersistence(mkdtemp)` → `getStatus()==='ready'` → dispose；公共导出面快照 = 23 名。
2. **entry 级 degraded（owner 4 条最低覆盖，重写后 SA7 test 2）**：Bob/doomed flush EACCES → 仅 Bob saveDoc 与命中该 entry 的工厂被拒（`/persistence-degraded/`）；Alice/fine saveDoc 照常；Alice flush 成功落盘后 Bob 仍被拒、聚合 getStatus 仍 `persistence-degraded`；chmod 治愈后触发 Bob 自身 retry → 聚合 `ready`、Bob saveDoc 恢复。另含 CAROL 全新 doc 工厂调用成功（旧「新建被拒」断言的反向翻转）。
3. **非 ENOENT 清扫响亮（重写后 SA7 test 1）**：committed snapshot + leftover tmp + r-x 分区 → loadDoc rejects 且 errno（EACCES）保留、tmp 原地；chmod 恢复后 load 成功且 tmp 被清。
4. **P2 :285 翻转块**：degraded 期间 `createMemoryHandleForTest(user,'other')` resolves + `saveDoc(other)` resolves + 随动 release；同块 :277/:284/:288/:289 原断言不动。
5. **静态守卫**：src/*.ts（除 index.ts）import/export 语句无 `./index.js` 反向导入（含动态形态），守卫自身对正/负样例判定正确。

## 八、Verdict

**pass** —— 决策 G/H/E4/I 完整、自洽、可实施；五条设计层复审门禁全部满足；R3 伪代码与分支现行代码、R0–R2 既有文本及 ADR-0006 条款无矛盾。4 项 LOW 文档精度建议（攻击点 #1–#4）不构成阻断，建议随 SA3 交接顺手修正。`pass` 不替代 SA4 静态复查与 SA7 对实现/活链路（含 entry 级 degraded 4 条语义、深导入无 TDZ、非 ENOENT 响亮）的最终验证。
