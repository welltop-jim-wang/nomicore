# SA2 设计攻击评审 — issue #333（T0：readData 成功分支形状断言 helper 化 prefactor）

- 评审对象：`wiki/raw/task_issue-333_design.md`（SA1，iteration 0，首轮）
- 评审人：SA2（独立攻击审查；不修改设计/代码/测试）
- 仓库 / HEAD：`welltop-jim-wang/nomicore` @ `ba11f32`；worktree `/home/wangjian/nomicore-fix-issue-333`
- 评审日期：2026-09-12
- **Verdict：`approve`**（无 BLOCKER / MAJOR finding；4 条 MINOR 观察见 §13）

---

## 1. Reviewed inputs

| 输入 | 状态 | 说明 |
|---|---|---|
| `wiki/raw/task_issue-333.md` | 在场 | Issue 正文（AC1–AC3）+ Parent（PR #332 / ADR-0024） |
| `wiki/raw/task_issue-333_design.md` | 在场 | 被评审设计（14 节 + 逐点改写附录） |
| `wiki/raw/task_issue-333_sa6_contract.md` | 在场 | SA6 契约（verdict=approve；C1a/C1b/C2.1–C2.4/C3a–C3c） |
| `wiki/raw/task_issue-333_relevant_decisions.md` | **不存在** | SA8 产物缺失；设计 §6 已按 ADR 原文 + 模块 AGENTS 替代锚定（见 §5） |
| `wiki/raw/task_issue-333_conflict_report.md` | **不存在** | 同上；不构成评审缺口（本任务零 src/协议/schema 变更） |
| Owner 评论 | **无** | dispatch 记录 REST comment read 返回空数组；设计 §4 同证 |
| 源码核验 | SA2 独立执行 | 27 断言点 + 9 制造点逐行核对；扫描器/门全读；全仓 grep 独立复核作用域；配置面（tsconfig/vitest/package.json）核验；ADR-0016/0024 引用核验 |

SA2 独立核验方法：不信任 SA6/SA1 的转述，对每一处 file:line 逐行读原文；用独立 grep（单行 + 上下文窗口 + 全仓跨树）复核「24A+3B+9 制造点、别处无命中」的作用域断言；读扫描器源码逐条验证设计的过门证明；读 `runtime.ts`、`read-schema-projection.ts`、`resolve-schema-at-path.ts`、`derived.ts` 验证 `toStrictEqual` 等价论证的类型/运行时前提。

## 2. Verdict

**`approve`。**

核验结论：设计的全部可证伪事实断言（站点清单、扫描器命中规则、配置/类型检查入口、类型可赋值性、import 先例、ADR 引用、突变敏感性映射）经独立验证**全部成立**；反伪绿结构（断言面/构造面分离）机制上成立且验收面可强制；文件范围与 SA6 允许面一致；验收映射覆盖 SA6 全部契约条款且命令可执行。无 BLOCKER/MAJOR。MINOR 观察见 §13，不阻断实施。

## 3. 需求覆盖

| Requirement | Design section | Assessment |
|---|---|---|
| AC1：runtime+registry 测试中 readData 成功分支深等断言全部经统一 helper（或等价集中化形状构造） | §1.1/§7.1/§8.1 + 附录 | **覆盖**。27 处（24A+3B）逐点改写表齐全；SA2 逐行核对 24 处 family A 与 3 处 family B 的 file:line 与原文形态，全部吻合（含 hostile-guard L61 显式 `value: undefined`、L69 四键投影体字面量、registry-idle 11 处、registry-create 1769/1770 同测试体双点） |
| AC1 括号条款（集中化形状构造） | §7.2 决策一（9 制造点收敛） | **覆盖且已获 SA6 授权**（§10「可选 9 处」、§15「设计决定」）。9 处制造点 SA2 逐行核对（idle:242、create:381、open:184/804/858、concurrency:168、hostile:166、rev1:211、shutdown:190），与设计附录一致；理由链（T3 集中化目的 + M2 敏感保留）成立 |
| AC2：断言语义零变化，改写前后判定一致，全套绿 | §8.2/§8.4/§11（C2.1/C2.2/C2.3） | **覆盖**。§8.4 等价论证的前提经 SA2 源码级验证：actual 侧全部为普通对象字面量（`runtime.ts:486`；`detachReadSchemaProjection` 及 `cloneValueSchema` 逐 kind 构造普通对象、可选键仅在定义时写入 → 无 undefined 值键差、无原型差；替身字面量同）；唯一 undefined 用例 L61 两侧键均在场 → `toStrictEqual` ≡ `toEqual` 判定一致 |
| AC3：无产品代码/公共类型变化；root typecheck 与 test 通过 | §10/§11（C3a/C3b/C3c） | **覆盖**。C3a 两条 git diff 门命令与 ALLOW/DENY 一致；新增 helper 落在 `test/` 排除式内；root `pnpm typecheck`（14 个包级 tsconfig，均只含 `src/**`——SA2 已核对两包 tsconfig）不受测试树变更影响；`pnpm test` = `vitest run --typecheck`，类型程序 `tsconfig.typecheck.json` include `packages/*/test/**/*.ts` → helper 与改写文件进类型检查（B5 准确） |
| Issue 目的条款：T3 破坏性修订集中一处 | §7.3/§8.5 T3 演化钩子 | **覆盖**。36 处形状知识（27 断言 + 9 构造）收敛到单模块；§8.5 说明 T3 只改模块本体 + 站点期望值，调用式不变 |

## 4. Owner评论覆盖

| Comment ID | Updated at | Design section | Assessment |
|---|---|---|---|
| （无适用评论） | — | 设计 §4 | dispatch 记录 REST comment read 返回空数组；SA6 契约 §2 同证。无未决异议需要映射，设计未静默引入额外 scope。✓ |

## 5. 上游事实与SA8约束

| Fact or constraint | Design response | Assessment |
|---|---|---|
| SA8 产物不存在（relevant_decisions / conflict_report / sa8_*） | §6 以 ADR-0016/0024 原文 + 两包 AGENTS.md 边界替代锚定 | **成立**。SA6 §1/§3 同证缺失；按 skill 规则以现有证据继续，非缺口 |
| ADR-0016：成功分支恰三键 `{ok:true,value,schema}`，value 键恒在场，schema 为投影或 null，失败分支无 schema | §7.1 helper 语义按此锚定，三键原样保留 | **成立**。与 `runtime.ts:126-129` 类型定义、`:474-487` 实现一致（SA2 读源码核对） |
| ADR-0024 决策 4：恰三键 → 恒五键（破坏性）；「既有恰三键形状锚、深等断言与 docs/integration 形状注记全线修订」 | §3 根因承接；T0 为该修订的前置 reducer；零预演五键 | **成立**。SA2 核对 ADR-0024 L58-69 原文，设计引用（L60/L69）准确；五键形状 `{ok,value,schema,truncated,truncations}` 与设计 §8.5 演化钩子一致 |
| `packages/namespace-runtime/AGENTS.md`：公共面只暴露 detached 投影、test seam 不外泄 | §10 只动 `test/**`；helper 为测试树内部模块 | **成立**。无 src 变更、无公共导出面变化 |
| `packages/namespace-registry/AGENTS.md`：公共 API 只经 `src/index.ts`、test 控制留在 testing 面 | 不动 registry `src/**`；registry 测试经跨包相对 import 消费 runtime 测试 helper | **成立**。先例核验：`waitDurableSnapshot` / `realPersistenceScheduler` 跨包测试 import 实存（见 §9） |
| SA6 契约 C1–C3 全部条款 | §11 验收映射逐条承接（含 C2.3 突变重跑、C2.4 反向边界、C3a 范围门） | **成立**（逐条见 §11 验收设计审查） |
| SA6 §5/§15 报告项（9 制造点是否收敛留给设计） | §7.2 显式裁定收敛并给理由 | **成立**；裁定权与 SA6 授权一致 |

## 6. 设计内部一致性

| 检查点 | 结果 |
|---|---|
| 正文 §1 目标 ↔ §7 决策 ↔ §8 改写式 ↔ §10 ALLOW ↔ 附录逐点表 | **一致**。附录 27+9 与 §10.1 行级清单、SA6 附录三方吻合（SA2 逐行核对） |
| §7.1 helper 代码块 ↔ §8.3 过门证明 ↔ 扫描器真实规则 | **一致**。SA2 读 `readdata-shape-assertion-scan.ts` 逐条验证：①站点 `expectReadDataOk(x,{...})` callee 是 Identifier → `readDeepEqualCall` 要求 PropertyAccess → 不命中；②helper 内 `toStrictEqual(expectedShape)` 实参是 Identifier → `readObjectShape` null / `readExactKeySetArgument` 非数组字面量 → 不命中；③`toStrictEqual(READDATA_OK_KEYS)` 双保险不命中；④`READDATA_OK_KEYS = [...] as const` 是变量声明非断言实参 → 不命中 family B |
| §7.3 反伪绿不变量 ↔ §7.1 模块头注 ↔ §11 C2.3 重跑规格 | **一致且可执行**：M2 突变面收敛为「只改 `readDataOk` 函数体」，期望红数用 `≥19` 表达（开放下界正确——concurrency/shutdown 替身同源受染但无形状断言，不增红不假绿） |
| §8.4 等价论证 ↔ 源码事实 | **一致**（见 §3 AC2 行：原型/undefined 键差被源码级排除） |
| §8.5 T3 钩子 ↔ SA6 §15（T3 四/五键字面量会被门判红、family B 仪器扩展属 T3） | **一致**，无越界预演 |
| 旧 API / 死引用 | 未发现。所有引用的文件、行号、类型名（`NamespaceRuntimeReadDataResult`、`ReadDataSchemaProjection`、`ReadDataOkShape` 拟名）与导出面（`@nomicore/vfsl` index.ts:126 实导出）核对无误 |
| 数值口径 | 一处小口径混用（§11 C3c 行「338 基线」与「门已在树 +0」并置，见 §13-O3），不影响判定 |

## 7. 状态机与并发攻击

本任务无状态机、无异步时序、无持久化（纯测试树内同步断言/构造改写）。仍按模板攻击：

| ID | Initial state | Trigger | Expected behavior | Design gap | Required revision |
|---|---|---|---|---|---|
| S1 | 既有测试（绿） | 改写后同实现重跑 | 判定逐点一致（AC2） | 无——改写为表达式对表达式原位替换，断言次序、调用次数（`leaseN.readData(['x'])` 单次求值）、后随断言（L62 `'schema' in r`、L79-82 isFrozen 抽检）全部保留 | — |
| S2 | 断言失败态 | helper 内 `toStrictEqual` 失败 | throw + diff，vitest 捕获；无吞错 | 无（§9 明示无 try/catch/fallback） | — |
| S3 | 并发原语（deferred gate / scheduler.advanceBy） | 改写触及与否 | 不触碰 | 无——改写点全部为同步表达式；§9 明示并发原语不动 | — |
| S4 | 重复运行 | 同一测试多次执行 | 确定性 | 无——`readDataOk` 每次新鲜对象、无共享可变状态（§9 幂等） | — |
| S5 | 进程重启/迟到回调 | 不适用（无 IO/计时器/后台任务引入） | — | 无 | — |

## 8. 错误与恢复攻击

| ID | Failure | Current design behavior | Risk | Required revision |
|---|---|---|---|---|
| E1 | helper 断言失败 | vitest throw + diff，失败帧指向 helper、测试名定位站点（§8.6） | 低（诊断定位弱于站点内联 diff，但栈帧保留站点；纯测试面） | — |
| E2 | 改写遗漏（门仍红） | 门 family A/B 用例带逐条 file:line 清单失败 | 低（自动暴露） | — |
| E3 | 越界改写（误伤 toMatchObject 负控） | C2.1 重跑打红 + C2.4 diff 审查（§11） | 低 | — |
| E4 | 实现期发现原型/undefined 差异（现有证据排除） | 设计内回退：helper 匹配器降 `toEqual`，须记录证据，禁 `toMatchObject`（§8.4） | 低（见 §13-O4：回退会弱化键在场严格性，属条件路径） | — |
| E5 | 回滚 | 单提交 revert 完全恢复（门回 2 红/18 绿缺口态，§9） | 无 | — |
| E6 | 静默失败/伪成功路径 | 无吞错通道；`ok:false` 结果在 `toStrictEqual` 三键期望下必红（C2.2.5） | 无 | — |

## 9. 契约影响审查

| API or contract | Missing or weak caller handling | Evidence | Required revision |
|---|---|---|---|
| 新 helper 模块对两侧测试树的可用性 | 无。registry→runtime 测试树跨包相对 import 先例实存：`registry-phase5-bootstrap-reset-red.test.ts:75`、`registry-phase5-replication-red.test.ts:59`、`registry-phase5-replication-session-red.test.ts:84`、`registry-sa7-phase5-replication-dynamic.test.ts:43-44`（4 文件 5 条 import，含值导入） | grep 实证 | — |
| `import { expect } from 'vitest'` 于非测试 helper | 无。直接先例：`durable-snapshot-wait.ts:25`、`readdata-schema-projection-fixture.ts:12`（均测试树内非 `.test.ts` 模块导入 vitest）；vitest 为 namespace-runtime devDependency | 源码核对 | — |
| `import type { ReadDataSchemaProjection } from '@nomicore/vfsl'` | 无。`packages/vfsl/src/index.ts:126` 实导出该类型；runtime package.json 声明依赖；`import type` 运行时擦除，`--conditions=nomicore-source` + vitest alias 双路可解析 | 源码核对 | — |
| 调用点类型可赋值性 | 无。①stub `readData()` 返回 `ReadDataOkShape` 结构等同 `NamespaceRuntimeReadDataResult` 成功成员（`runtime.ts:127`），readonly→mutable 可赋值；②`makeRuntime` 返回位 `NamespaceRuntime` 同理；③`expectReadDataOkKeys(actual: object)`——`NamespaceLeaseReadDataResult = NamespaceRuntimeReadDataResult \| NamespaceLeaseReleasedIssue`（`types.ts:448-450`）与 red 文件 `readOk` 返回 `{ok:true;value:unknown;schema:TargetProjection\|null}`（`:56-60`）均为对象联合，可赋值；④L69 投影字面量经上下文类型可赋给 `ReadDataSchemaProjection`（`resolve-schema-at-path.ts:49-61` 四键接口；scalar 成员 `derived.ts:51`） | 源码核对 | — |
| 既有断言契约（failure 分支、doc-runtime 两键、加法兼容） | 无弱化。C2.4 + DENY 明列；SA2 读 `runtime-readdata-schema-projection-control.test.ts` 全文证实其 `toMatchObject`/两键/失败分支面与设计描述一致，不在改写表 | 源码核对 | — |
| 生产代码/公共类型/测试替身消费方 | 零变化（无 src 变更；替身改写为逐键等价构造，`this.marker` 调用时求值语义保留） | §8.1 改写式 + 源码核对 | — |

## 10. 文件范围审查

| Path or scope issue | Evidence | Required revision |
|---|---|---|
| ALLOW LIST 11 行（1 新增 helper + 10 改写文件）与 27+9 站点分布 | SA2 逐行核对：每个含站点的文件恰在 ALLOW；8 个 registry 文件 + 2 个 runtime 文件与 import 面（§8.1）吻合 | — |
| ALLOW 无无理由扩张 | `registry-sa7-concurrency.test.ts`、`registry-shutdown.test.ts` 仅制造点 + import，理由 = §7.2 决策一（SA6 §10 明示允许） | — |
| DENY 与正文无冲突 | DENY 含全部 src、SA6 仪器两文件（门 + 扫描器——防自证陷阱）、projection-control 负控、3 个 test-d 锚、docs/domains/apps/package.json、doc-runtime、其余无命中测试文件；改写表无任何 DENY 命中项 | — |
| C3a 门命令与 ALLOW 同构 | `grep -vE '^packages/(namespace-runtime\|namespace-registry)/test/'` 排除式覆盖新 helper 路径 `packages/namespace-runtime/test/helpers/readdata-ok-shape.ts` | — |
| follow-up 未掩盖必要项 | T3（五键本体、门 family B 仪器扩展、ADR-0024 文档负控正则）显式列为非本任务（§12）；本任务必要项（27+9 收敛）无遗留（「任务内解决项」明示） | — |

## 11. 验收设计审查

| Requirement or risk | Proposed evidence | Gap | Required revision |
|---|---|---|---|
| C1a/C1b 归零 | `npx vitest run --no-typecheck readdata-shape-assertion-consolidation`（T0 后 20/20 绿） | 无。SA2 验证改写形态逐条过扫描器规则（§6）；门自控 7 正/8 负样本与作用域覆盖断言（≥80 文件、4 锚文件）不受 helper 新增影响（109→110） | — |
| AC1 全量收敛（含 9 制造点） | 生产者扫描报告项：站点 9→0、helper 内恰 2 | 无。SA2 验证：站点改写后 `{value,schema}` 无 ok:true → 非生产者；helper 内 2 处字面量（`readDataOk`/`expectReadDataOk` 各一）恰含 ok:true+value+schema → 报告恰 2 条。该期望同时充当「两面分离未被折叠」的结构化哨兵（折叠为单一构造会使报告降至 1 条，验收可见） | — |
| C2.1 行为零变化 | 10 文件命令 + concurrency/shutdown 两套件（12 件超集） | 无 | — |
| C2.2 五条判定语义 | §8.2 表逐条 + 三类代表用例（undefined/投影体/ok:false） | 无 | — |
| C2.3 反伪绿（突变重跑） | M1（`runtime.ts:486` 追加两键 → hostile-guard 4 + red 1 + docs-sync 1 红）；M2（**只改 `readDataOk` 函数体** → registry ≥19 红）；任一不红即拒绝 | 无。重跑规格精确到突变施加点与期望红数，M2 突变面从 5 文件简化为 helper 单行且语义等价（9 制造点同源受染）；期望计数与 SA6 实测映射一致（idle 11/open 2/create 2/hostile 1/rev1 3；create 1769/1770 同测试体） | — |
| C2.4 反向边界 | projection-control 重跑 + 零 diff 审查 | 无 | — |
| C3a/C3b/C3c | 两条 git diff 门 + 公共面/类型面锚 + root typecheck/test | 无（C3c 数值口径小瑕疵见 §13-O3） | — |
| 测试观察行为而非源码文本 | 门为 AST 结构门 + 行为面由 C2.1/C2.3 承担；SA6 §12.3 分层论证成立 | 无 | — |
| 建议测试落在真实入口 | 门路径匹配 `vitest.config.ts` include `packages/*/test/**/*.test.ts`；helper 非 `.test.ts` 不被收集（`durable-snapshot-wait.ts` 头注同款先例）；SA6 §14 已双模式实测触发 | 无 | — |

## 12. Required revisions

无 BLOCKER / MAJOR finding。无需修订即可实施。

## 13. Non-blocking observations

| ID | 观察 | 建议 |
|---|---|---|
| O1 | §2-B4/§7.4-A4 的跨包先例方向措辞（「runtime test → registry test 方向」「runtime→registry 方向」）易误读——实际先例方向是 **registry 测试 import runtime 测试树**（证据本身正确；B4 记「4 处」，实测 4 文件 5 条 import 语句，证据强于转述） | 实现者以路径证据为准；无需改设计正文 |
| O2 | §8.1 引 `packages/vfsl/src/derived.ts:52`（scalar 成员）实际在 L51；不影响可赋值性结论（SA2 已按 L51 验证） | 实现时无需动作 |
| O3 | §11 C3c 行混用两个基线口径：pristine 基线 338 文件/3588 tests **不含门**；当前树（含门）= 339/3608（其中 2 红）。T0 后应为 339 文件/3608 tests 全绿。设计表述「+0（门已在树）、tests +20」相对口径不同 | SA5 报告时显式写明对比基线（建议：T0 后 `pnpm test` = 339 files / 3608 tests / exit 0） |
| O4 | §8.4 的设计内回退（`toStrictEqual`→`toEqual`）会弱化「显式 undefined 键在场」的严格性（C2.2.3 最严读法下 `toEqual` 放过漏键实现）。SA2 源码级验证该回退前提不存在（runtime 成功字面量恒写三键；`detachReadSchemaProjection` 仅在定义时写可选键、无 undefined 值键；替身全普通字面量），回退应不触发 | 若实现中确需触发回退，按设计要求记录逐站点证据，并同步降级 §8.2 表第 3 条的措辞 |
| O5 | 反伪绿「两面分离」不变量的持久执行依赖：模块头注（人工评审锚）+ C2.3 一次性重跑 + 生产者报告「恰 2 条」期望（§11 已固化）。T3 修改本模块时该不变量最易被无意识折叠（届时 M2 同类探针应随 T3 验收重跑） | 在 T3 任务简报中显式继承「断言面期望不得派生自构造面」不变量与 M2 同类突变探针 |

## 14. 架构一致性与惯例审查（附表）

### 责任归属

| Behavior | Expected owner | Design location | Assessment |
|---|---|---|---|
| readData 成功形状的断言/构造单点面 | namespace-runtime（readData 契约 Owner，ADR-0016；类型导出于该包） | `packages/namespace-runtime/test/helpers/readdata-ok-shape.ts` | **一致**（A4 备选对照成立：registry 树/根 tests/ 均无先例或不匹配 include） |
| 验收仪器（扫描器/门） | SA6 交付面 | 不修改（DENY） | **一致**（防自证陷阱） |

### 相似能力对照

| Similar capability | Existing implementation | Proposed design | Consistent or divergent | Reason |
|---|---|---|---|---|
| 跨包测试 helper 共享 | `durable-snapshot-wait.ts`（runtime 树，registry 侧 4 文件相对 import） | 同款位置 + 同款相对 import | 一致 | B4 先例 |
| 测试树内非测试 helper 模块 | `readdata-schema-projection-fixture.ts`、`real-persistence-scheduler.ts`、registry `test/helpers/registry-seam-audit.ts` | `test/helpers/readdata-ok-shape.ts`（kebab-case、无 `.test.ts` 后缀） | 一致 | 命名/位置/不被收集均同先例 |
| 键集常量 | 扫描器 `SUCCESS_SHAPE_KEYS` | helper 自持 `READDATA_OK_KEYS`，**不 import** 扫描器 | 有意分层（一致） | 永久测试基建不依赖可退役验收仪器；理由已写明（§7.1） |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| 成功形状（T0：三键） | helper 模块内两处独立内联字面量（断言面/构造面，反伪绿要求的有意双写） | 36 个调用站点（零形状知识残留） | 低——双写漂移由 C2.3 M2 探针 + 生产者报告「恰 2 条」期望捕获；T3 集中改写时同步演化 |

### 生命周期对称性

无资源获取/释放、无订阅、无后台任务（纯函数 + 纯断言）；`readDataOk` 无状态、每次新鲜对象。对称性不适用且无隐藏生命周期。✓

### 平行机制检查

| Candidate duplicate | Existing path | Proposed path | Disposition |
|---|---|---|---|
| 第二套断言 helper / 形状常量 | 无（SA6 H3：AST+grep 双证无既有 helper） | 单一模块三导出 | 非平行——正是补齐缺失的单点面 |
| 复用扫描器常量作形状源 | `readdata-shape-assertion-scan.ts` | 独立定义 | 有意分层，非平行机制（仪器 vs 基建） |
| 第二 cleanup/重试/状态机 | 不适用 | 无 | — |

---

## 15. 是否需要设计后 ADR 冲突复查

**不需要（`requiresConflictRecheck: false`）**——与设计 §14 一致：零公共 API/协议/wire/schema/持久化/状态机语义变化；ADR-0016 现状逐点保留、ADR-0024 决策 4 仅前置执行不改写；SA8 产物缺失已按替代权威锚定。SA2 独立核验未发现新的 ADR 触碰面。
