**Verdict**: clear

# Standards/仓库标准轴 终审报告 — issue #133 round=2「Phase 5: bootstrap import, archive, and guarded replica reset」

- **审查轴**：MABF 双轴终审 · Standards/仓库标准轴（只读审查 + 本报告；未改任何其他文件）
- **审查对象**：worktree `/home/wangjian/nomicore-fix-issue-133`，`git diff 6784645..HEAD`（round-2 全量：feat 4fe3a02 + fix 8b1398f + 13 个 docs/wiki 提交；38 文件 +4727/-169，其中生产 src 8 文件、测试 5 新增 + 3 校准、ADR 0006/0010、wiki r2 档案 15 份）
- **基准文档**：AGENTS.md、CONTEXT.md、docs/AGENTS.md、packages/{persistence,namespace-runtime}/AGENTS.md（namespace-registry 无嵌套 AGENTS.md）、docs/adr/0006/0008/0009/0010、docs/phases/phase-5-websocket-replication.md、冻结设计 `task_phase5-bootstrap-archive-reset-r2_design.md`（514 行全读）、round-1 标准轴终审（判例校准）
- **审查方法**：仓库约定全读 → 生产 diff 逐行全读（2036 行 unified）+ 现行文件上下文复核 → 5 个新测试文件与 3 个校准文件抽读/全读 → 15 份 r2 档案交叉核对 → 可复现验证亲跑（§五）

---

## 一、硬违规检查结论：零硬违规

逐项核验五维度，**未发现阻断性违规**：

### 1. 仓库约定（AGENTS.md / CONTEXT.md）

- **ADR/文档约定**：ADR 0006/0010 修订均为文尾追加节，含日期（2026-08-28）、授权声明（owner feedback 3）、明示修订范围与取代关系（0010 修订节引原文逐字指出被替换的旧描述——docs/adr/0010:228 vs 原文 :57/:59-65），未触及条款声明继续有效。符合 docs/AGENTS.md「Amend or supersede prior decisions explicitly」。
- **附录-only 错误分类学**：contract.ts diff 零删除行（纯追加 3 错误类 + 2 类型 + phase 词表）；registry types.ts 两个新码追加进 `ImportReplicaIssue` 联合、`InvalidIdentityIssue.field` additive 扩 `'expectedLocalIdentity'`（types.ts:113-122），既有 code/message 零改动（diff 无 `-.*MESSAGE` 行）。
- **observer 事件词表纪律**：`reset-archive-after-arm-failed` 追加于联合尾部（observer.ts:53），既有事件形零改动；载荷不含复制身份值（测试锚 F-1 实证，见下）。
- **冻结词汇零改动**：CONTEXT.md 不在 diff 内；`NAMESPACE_*_MESSAGE` 冻结常量全部原样；新 message 为不可插值常量（types.ts:98-103；contract.ts 三个 probe 错误类 message 恒定、零 owner/identity/bytes 回显）。
- **零身份回显**：`snapshotReplicationIdentityRef`（registry.ts:252-280）拒绝路径不带任何字段值；probe 三错误类 message 为稳定常量（contract.ts:229-289）；F-1 测试断言 observer cause 序列化不含 ID_A/NS_B/u-alice（r2-internal.test.ts:734-737）。

### 2. 文档要求

- **ADR 修订体例**：两份修订节均为 append-only、scope/取代/授权三要素齐备（0006:207-217；0010:226-238）。被取代的旧文本仍在原文位（0010:57、:59-65），修订节引原文宣示取代——无静默矛盾。
- **wiki/raw 档案**：15 份 r2 档案全部存在且可读，链条完整（简报→SA8→SA6→设计→SA8 R2/R3-delta→SA2 三轮→SA3→SA4 全量+增量→SA7→AC 门禁→dispatch 21 行）；dispatch 日志含 Runner 裁决注记与证据误标更正（dispatch:32-38），档案诚实度高。round-1 档案零改动（diff 内 wiki 文件全部 r2 后缀新增）。
- **档案瑕疵 1 项**：见 §三 F-1（sa7_report.md 尾随空白 + AC 门禁证据声称失准）。

### 3. 测试要求

- **断言锚行为**：竞态 A/B 用真实 MemoryPersistence + hook store 字节级 decode 断言「持久化仍旧值、无强制 flush、零破坏」（r2-red.test.ts:504-561）；armed 矩阵五路 typed 拒绝逐码断言（r2-internal.test.ts:343-422）；P8 归档 remove-fatal 断言 committed:true + latest-wins 重试收敛（persistence r2 测试:349-395）。无凑数断言。
- **敌意输入矩阵**：16 形态（null/undefined/array/function/string/number/getter-throw/proxy-throw/inherited/accessor/invalid-id/NaN/Infinity/0/小数/缺键）module 级共享于 import 侧与 reset 侧（r2-internal.test.ts:100-121），双入口同判据同拒绝 + 零 doc 访问/零 Persistence 触达分界锚（probeCalls/importCalls 空断言）+ 正确重试不毒化。
- **命名与放置**：5 个新文件遵既有 `test/<task-slug>` 惯例与 `-r2` 后缀；类型锚 `*.test-d.ts` 与既有 surface 文件同位。
- **版本 bump**：改了代码的 3 包全部 bump patch（persistence 0.2.1→0.2.2、namespace-runtime 0.1.9→0.1.10、namespace-registry 0.1.5→0.1.6）；未改代码的包（含依赖方 dsh-persistence，workspace:* 私有包）无需 bump——符合既定惯例。
- **既有测试校准**：3 个既有文件的修改 = 机械第 4 参适配 + stub probe 能力补充 + 1 例并发用例按 R2 冻结语义（设计 §3.4 ④ / SA2 R1-1）确定性拆分改写（registry-phase5-bootstrap-reset-red.test.ts:713-758），行为演进在注释中留痕且授权链完整（dispatch:22、SA4 §Scope Creep Guard）；无静默断言削弱。

### 4. 生命周期/防御模式规则

- **committed 事实诚实（INV-12）**：probe 三错误类 `committed:false` 恒真（该 seam 从不写/转移所有权）；armed 后 archive fatal 经 `committedOf(cause)` 原样传播（registry.ts:1767-1773），duck-typed fatal 不改写 committed；unknown → fatal false 不发明证据（registry.ts:1775）。
- **零存在性泄露**：import/reset 双路径 owner 先核对 → NOT_FOUND（registry.ts:1441-1445、:1567-1570）；closing 重评估后 owner 再核对（:1617-1620）。
- **degraded/retry 语义保持**：saveDoc/flush/retry 路径零改动；probe 不经 scheduler、不排空 dirty、不强制 flush（竞态测试字节级实证）。
- **capability loud gate**：archive + probe + fence 三能力在任何破坏性动作/probe 之前 `typeof` 窄化，缺席即 branded fatal committed:false、零 TypeError、零 fallback（registry.ts:1572-1595；legacy fake 测试锚 r2-internal.test.ts:424-456）。
- **无静默失败/伪降级**：probe I/O 失败保持 loud/typed（Operational→LOAD_FAILED 唯一普通映射；corrupt→fatal 绝不折叠为 mismatch/load-failed，registry.ts:1729-1744）；probe 绝不读 live Y.Doc 冒充持久事实（ADR 0006:217 明文 + lifecycle.ts:377-433 实现一致）。

### 5. 可维护性

- fence/close 无自等待协议与设计 §3.5 逐句对应（runtime.ts:231-283；lazyCloseBarrier 幂等共享 closePromise，:360-366；non-enumerable 键零公共面漂移，:466-471 + T0 测试锚）；close barrier 入队语义零改动（close.ts:37-39 纯提取）。
- 死代码：`beginCloseCurrent` 删除干净（全仓零残留调用）；唯一残留是新注释中的一处符号引用（§三 F-2）。
- 无调试残留/TODO/console.log（diff 新增行 grep 零命中）；无未使用导入（typecheck exit 0 实证）。
- 设计 §8 ALLOW 与实际偏差均有留痕：observer.ts 超清单经 SA4 关注项 4 追认（设计 §3.5.2 明文依据）；`namespace-runtime/src/types.ts`（基线不存在，设计笔误）与 registry index.ts（无需 barrel 扩张——新 issue 类型随既有 `ImportReplicaIssue` 导出流动）未改动，ALLOW 为许可非义务，SA3/SA4 档案已记录。

---

## 二、设计与 ADR 一致性抽查（关键断言抽样核实）

| 抽查点 | 结果 | 证据锚 |
|---|---|---|
| fence 槽内先 persisted 后 live、匹配后同步 arm closing、槽内绝不建 barrier | 一致 | runtime.ts:249-268 |
| fence 结算后 lazy continuation 才创建 barrier（无自等待） | 一致 | runtime.ts:270-282；close.ts:37-39 |
| import 槽 ②c Hub equality 在格式核对之后、capability/importDoc 之前 | 一致 | registry.ts:1462-1469 |
| 入口 expected 安全快照先于 carrier/entry/Persistence（双入口同款） | 一致 | registry.ts:1897-1900（import）、:1924-1927（reset） |
| armed 后 archive 四类 typed → RESET_FAILED + 新 observer 事件；fatal 保 committed | 一致 | registry.ts:1746-1776 |
| 无 entry/closing 重评估：probe missing→NOT_FOUND、主键仍在→RESET_FAILED、零 archive | 一致 | registry.ts:1606-1642 |
| probe 契约：owner 分区 key + io.read + abort signal；detached Y.Doc 解码；META.docId 校验；判据族与归档 verify 单点共享（readPersistedReplicaFacts） | 一致 | lifecycle.ts:377-433、:1005 |
| File/Memory 双 adapter probe 委托 + SAFE_PATH_SEGMENT 入口校验同款 | 一致 | file.ts:114-122、memory.ts:154-161 |
| ADR 0006 §1-4 / ADR 0010 §1-5 与实现逐条对应（含 dirty 诚实表达、无自等待、armed 矩阵） | 一致 | 0006:207-217；0010:226-238 |

---

## 三、发现清单（全部非阻断；硬违规零项）

| # | 级别 | 位置 | 发现 |
|---|---|---|---|
| F-1 | MEDIUM | wiki/raw/task_phase5-bootstrap-archive-reset-r2_sa7_report.md:3,4,5,49；wiki/raw/task_phase5-bootstrap-archive-reset-r2_ac_checklist.md:13 | 本审亲跑 `git diff --check 6784645..HEAD` **exit 2**：sa7_report.md 4 行行尾尾随空白（markdown 双空格硬换行形态）。AC 门禁 R2-AC-6 证据声称「`git diff --check 6784645..HEAD` exit 0」——该声称在 HEAD 不成立（sa7_report 由 24db0fa 引入空白，晚于两次 trim 提交 de446f9/009c697；AC 门禁 f34179d 在其后）。注：SA7 报告自身曾诚实披露同类问题（sa7_report.md:58）并促成 009c697 清理，但遗漏了本文件。与 round-1 判例 J-1 同类（MEDIUM 非阻断）；**建议合入前一次 trim 提交消除**（并据此校正 AC 证据留痕）。 |
| F-2 | LOW | packages/namespace-registry/src/registry.ts:1680 | 本轮新增注释「镜像 beginCloseCurrent ①-③」引用了**本轮已删除**的同名函数（全仓仅剩此注释命中）——符号引用悬空。建议改写为「镜像 beginIdleClose ①-③」或直接描述 I2 模式（先赋值后翻相）。 |
| F-3 | LOW/INFO | packages/namespace-registry/src/observer.ts:47 | 旧事件 `reset-archive-failed` 在 R2 后零派发点（round-1 派发点随旧 reset 路径删除），union 成员成为死声明。append-only 词表纪律下保留为既定裁决（SA4 F-2 已登记「禁止移除成员」）；建议在注释中补记「当前零派发/保留词表位」以免后来者误查派发点。无需本轮动作。 |
| F-4 | LOW/INFO | packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-red.test.ts:7,15,19-20,39,71,567；…-r2-surface.test-d.ts:24-27 | SA6 锚定期措辞「临时拼写/临时签名，待 SA1 冻结」在 SA1 原样冻结该拼写后已失时效（it() 标题 :567 仍称「（临时拼写）」）。SA6-owned + 最小触碰纪律下可容忍（round-1 判例 J-7 同款）；留作后续清理候选。 |
| F-5 | INFO | packages/persistence/src/lifecycle.ts:377-433 vs :620-645 | probe 未入 `track()`：`dispose()` 的「await every tracked operation」不覆盖在途 probe。仓库内 adapter 遵 abort signal 纪律（挂起读 → typed `read-aborted`，P6b 测试锚定）；迟到成功读仅返回只读真实事实、零副作用。dispose docstring 列举范围为 restore/flush/create，未承诺覆盖只读 probe——无契约违约，记录在案。 |
| F-6 | INFO | docs/adr/0006-server-persistence-docstore.md:213 | 修订节 §2 措辞「committed-aware 重定位语义保留 round-1 条款」——ADR 0006 本身并无 round-1 归档文本（round-1 仅以代码/wiki 记录该契约，正是 feedback 3 本轮要补的正式登记）；该句历史指称略易误导，但条款自体自完备（映射已显式列出），无规范缺口。 |
| F-7 | INFO | docs/phases/phase-5-websocket-replication.md:113 | phase 文档仍述「close→archive→允许 bootstrap」旧次序；ADR 0010 修订节已明示取代且为权威源。设计 §8 DENY 有意排除 phase 文档（「phase roadmap is not the normative target of feedback 3」），经 SA8 复审 clear——判定调用：可接受；后续若做文档对齐可在该行加指针。 |

---

## 四、与 round-1 判例的一致性说明

round-1 标准轴终审对同类 `git diff --check` whitespace 问题判 MEDIUM 非阻断、verdict clear（J-1）；对 SA6 临时契约残留判 INFO 保留（J-7）；对档案计数笔误判 LOW（J-5）。本轮 F-1/F-3/F-4 的定级与该判例一致。本轮新增的差异点：F-1 同时涉及 AC 门禁证据声称失准（round-1 J-1 无此维度）——仍定 MEDIUM 非阻断，因为失准内容为档案留痕而非生产/测试/契约事实，且修复为一行级 trim；但明确建议**合入前处置**，避免门禁证据链在 publish 后继续失真。

## 五、审查期间的并发流水线索引（范围外，如实留痕）

本审进行期间（2026-08-28 07:52–08:04+），worktree 工作区出现**未提交**的并发变更，均不在本审 diff 范围（6784645..HEAD，HEAD=f34179d 未变）内，但对 R-FIX-1 分类学区块有实质影响，如实记录：

1. 新增 `wiki/raw/task_phase5-bootstrap-archive-reset-r2_sa2_review_delta.md`（untracked）：SA2 delta 评审对 8b1398f 的 R-FIX-1 分类学落位（复用 `NAMESPACE_INVALID_IDENTITY` + 扩 `InvalidIdentityIssue.field` 至 `'expectedLocalIdentity'`——即本审所见的 types.ts:113-122 / registry.ts:473-478 形态）给出 **reject**（D-1..D-4：缺 SA1 显式授权 + 共享 message 与缺陷字段相矛盾），要求按方案 B 返工。
2. `wiki/raw/task_phase5-bootstrap-archive-reset-r2_design.md` 工作区改动（未提交，+102 行）：R4 微修订 §3.6 冻结**方案 B**——reset expected 输入缺陷改用专属码 `NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID` + 专用 message 常量，`InvalidIdentityIssue.field` 回退 round-1 二元联合；入口次序/零副作用纪律不变。

**标准轴立场**：该争议属设计授权/规格 adjudication（SA2 职权），非仓库标准维度违规——A' 变体与方案 B 在附录-only、零回显、常量纪律上均可合规落地；本审对 HEAD 已提交形态的各维度结论（含 types.ts:113-122 的 additive 扩张判定）在标准轴上仍然成立。**若方案 B 返工落地**，预期触及 registry.ts/types.ts/R-FIX-1 测试与 ADR 0010 §1 措辞，建议对改动 hunk 做增量标准复审（重点：新码/新 message 常量的附录-only 落位与零回显、`field` 回退后既有 open/create 断言零回归、档案链补记 R4 授权链）。本审 Verdict 不覆盖该未提交返工。

## 六、可复现验证记录（本审亲跑，非转述）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `pnpm typecheck`（前台复跑） | **0** | 10 包 tsc 链全过（日志 /tmp/std-review/typecheck2.log） |
| `pnpm test`（后台独立进程） | **0** | `Test Files 147 passed (147)` / `Tests 1757 passed (1757)` / `Type Errors no errors`（/tmp/std-review/full-test.log）——与 AC 门禁声称 1757（1711 基线 + 46 净增）一致 |
| `pnpm vitest run` r2 目标集（persistence-r2 + runtime-fence-r2；registry r2-red/r2-internal/round-1 校准红/sa7-dynamic，两批） | **0** | 18 + 54 用例全绿、零类型错误（/tmp/std-review/tests-a.log / tests-b.log） |
| `git diff --check 6784645..HEAD` | **2** | 4 行 trailing whitespace，全部位于 sa7_report.md:3,4,5,49（F-1）；38 文件其余零问题 |
| `git diff --name-only 6784645..HEAD` 范围审计 | — | 仅 packages/、docs/adr/0006+0010、wiki/raw/*-r2 档案；round-1 档案零改动；无 stray/黑名单文件 |

## 七、审查范围与证据锚声明

- **确切 diff 范围**：`git diff 6784645..HEAD`（6784645 = round-1 close-out；HEAD = f34179d）。生产代码：packages/persistence/src/{contract,lifecycle,file,memory,testing,index}.ts + package.json；packages/namespace-runtime/src/{runtime,close}.ts + package.json；packages/namespace-registry/src/{registry,types,observer}.ts + package.json。测试：5 新增（registry r2-red / r2-internal / r2-surface.test-d、runtime fence-r2、persistence r2）+ 3 校准（registry round-1 red / surface.test-d / sa7-dynamic）。文档：docs/adr/0006、0010。档案：wiki/raw/task_phase5-bootstrap-archive-reset-r2{,\_*} 共 15 份。
- **关键证据锚**：registry.ts:252-280（快照校验）、:1572-1595（capability 前置门）、:1649-1652（fence 调用）、:1676-1691（I2 记账，F-2 在 :1680）、:1746-1776（armed 矩阵）；runtime.ts:231-283（fence）、:360-366（lazyCloseBarrier）、:466-471（non-enumerable）；close.ts:37-39；lifecycle.ts:377-433（probe）；contract.ts:47-68（probe 结果类型）、:229-289（probe 错误三分类）；types.ts:98-103（新 message 常量）、:113-122（field additive）；observer.ts:49-53（新事件）；docs/adr/0006:207-217、0010:226-238（修订节）。
- **审查纪律**：全程只读 + 后台测试（setsid nohup & disown）；仅新建本报告文件，未改任何其他文件，未 push/PR。
- **审查人**：Standards 轴独立审查 subagent；日期 2026-08-28（round-2 双轴终审 · 标准轴）。
