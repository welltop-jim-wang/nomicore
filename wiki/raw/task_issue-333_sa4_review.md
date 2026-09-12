# SA4 实现静态审查 — issue #333（T0：readData 成功分支形状断言 helper 化 prefactor）

- 审查对象：SA3 实现（工作树未提交变更：10 个 `M` 测试文件 + 1 个新增 `??` helper；base `ba11f32`）
- 审查人：SA4（实现静态审查；不修改实现/设计/测试，不运行测试）
- 仓库 / worktree：`welltop-jim-wang/nomicore` @ `/home/wangjian/nomicore-fix-issue-333`，分支 `mabf/issue-333`
- 上游：Issue #333 AC1–AC3；SA6 契约（approve，C1a/C1b/C2.1–C2.4/C3a–C3c）；SA1 设计；SA2 评审（approve，O1–O5）
- **Verdict：`approve`**（无 BLOCKER / MAJOR / MINOR 阻断项；4 条非阻断观察见 §12）

---

## 1. Reviewed inputs

| 输入 | 状态 | 说明 |
|---|---|---|
| `wiki/raw/task_issue-333.md` | 在场 | Issue 正文 AC1–AC3 |
| `wiki/raw/task_issue-333_design.md` | 在场 | SA1 设计（§7.1 helper 全文、§8.1 改写式、§10 ALLOW/DENY、附录 27+9 逐点表） |
| `wiki/raw/task_issue-333_sa2_review.md` | 在场 | approve；O1–O5 观察 |
| `wiki/raw/task_issue-333_sa3_impl.md` | 在场 | SA3 实现报告（changed paths / verification / deviations） |
| `wiki/raw/task_issue-333_sa6_contract.md` | 在场 | 验收契约与仪器语义 |
| `task_issue-333_relevant_decisions.md` / `_conflict_report.md` / `_sa8_*` | 不存在 | 与 SA6 §1/SA2 §1/设计 §6 三方一致；按 skill 以现有证据继续 |
| Owner 评论 | 无 | dispatch 记录 REST comment read 返回空数组；SA6 §2 / SA2 §4 / SA3 同证 |
| 实现源码 | SA4 独立核验 | 逐文件读全部 11 个 diff hunk；helper/扫描器/门全文精读；独立 grep 复扫两树（family A/B 残留、生产者残留、escape 形态、skip/only、五键预演残留）；只读 git 命令复核范围门 |

SA4 独立核验方法：不信任 SA3/SA6 转述——对每处改写逐 hunk 对照设计附录；用独立 grep 复演扫描器 family A/B 判定规则（含 6 种键序排列、`.not` 形态、`deepEqual/deepStrictEqual` 家族、escape 形态 `Object.keys().length` / `JSON.stringify` 全等）；核对 vitest include / tsconfig.typecheck 入口与跨包 import 先例原文。

## 2. Verdict

**`approve`。**

核心结论（全部经静态证据独立复核）：

1. **范围精确**：改动集 = 10 个测试文件 `M` + 1 个新增 helper，与设计 §10.1 ALLOW LIST 11 行逐一对应；C3a 两条范围门命令实测输出为空；DENY 面（`packages/*/src/**`、`runtime.ts`、control 负控文件、3 个 `.test-d.ts`、SA6 仪器两文件、doc-runtime、docs/package.json）零触碰。
2. **断言语义精确**：helper 以 `toStrictEqual` 三键全等实现 C2.2 五条判定语义；24 处 family A + 3 处 family B 改写为逐表达式原位替换（subject/期望值/行尾注释/后随断言全部保留）。
3. **反伪绿分离成立**：`expectReadDataOk`（L39 内联期望）与 `readDataOk`（L29 内联构造）互不派生，模块头注固化不变量；生产者字面量恰收敛为 helper 内 2 处（独立 grep 复演扫描器规则确认两树无其他三键对象字面量）。
4. **收敛完整**：24 A + 3 B + 9 生产者全部经 helper 表达（逐文件计数核对：hostile-guard 4 / idle 11 / create 3 / rev1 3 / open 2 / sa7-hostile 1 = 24 A；sync-control 2 + red 1 = 3 B；producer 9）；两树零残留、零 escape 形态。
5. **无 unintended change**：无 skip/only/todo、无断言删除或弱化、无 `truncated/truncations` 五键预演残留（M1/M2 探针已完全还原，`runtime.ts` diff 为空）。

## 3. 上游要求落实

| Requirement or finding | Implementation evidence | Assessment |
|---|---|---|
| AC1：runtime+registry 成功分支深等断言全部经统一 helper | 24 处 `expectReadDataOk(` + 3 处 `expectReadDataOkKeys(`（grep 逐文件计数：4/11/3/3/2/1 + 2/1） | **落实** |
| AC1 括号条款：集中化形状构造（9 制造点） | 9 处 `readDataOk(...)` 调用（idle:246、create:383、open:186/806/860、concurrency:171、hostile:169、rev1:214、shutdown:193）；另 2 处 `readDataOk(` 字符串为 SA6 仪器自述，非制造点 | **落实**（§7.2 设计裁定收敛，SA6 §10 授权） |
| AC2：断言语义零变化、判定一致 | helper `toStrictEqual` 三键全等；§8.4 等价论证的源码前提（runtime.ts:487 恒写三键、替身普通对象）经 SA4 复核成立 | **落实**（严格性只增不减，见 §12-O2 说明） |
| AC3：零产品代码/公共类型变化 | `git diff --name-only` 全集 = 10 个测试文件；`runtime.ts`/`src/**`/`docs`/`domains`/`apps`/`package.json` 零 diff | **落实** |
| SA2 O1–O5 观察 | O1 import 方向按先例落地；O2 无需动作；O3 基线口径在 SA3 报告显式化；O4 回退未触发（helper 保持 `toStrictEqual`）；O5 不变量入模块头注 | **全部落实** |
| Owner 评论 | 无适用评论（空数组，三方同证） | 无映射项 ✓ |

## 4. 设计落实审查

| Design decision | Implementation location | Assessment | Finding |
|---|---|---|---|
| §7.1 helper 模块三导出 + 头注不变量 | `packages/namespace-runtime/test/helpers/readdata-ok-shape.ts`（46 行，与设计代码块逐行一致：`READDATA_OK_KEYS`/`ReadDataOkShape`/`readDataOk`/`expectReadDataOk`/`expectReadDataOkKeys`） | **一致** | — |
| §7.1 键集常量不 import 扫描器 `SUCCESS_SHAPE_KEYS` | helper 独立定义 L17；`@nomicore/vfsl` `import type` L14 | **一致**（仪器/基建分层） | — |
| §8.1 family A 改写式（`expect(x).toEqual({ok:true,...})` → `expectReadDataOk(x, {value, schema})`） | 24 处逐点核对：subject（`leaseN.readData(['x'])` 单次求值）、期望值、行尾注释（idle 4 条）原样 | **一致** | — |
| §8.1 hostile-guard L61 显式 `value: undefined` | 新 L62 `expectReadDataOk(r, { value: undefined, schema: null })`；后随 `'schema' in r` 断言保留（L63） | **一致** | — |
| §8.1 hostile-guard L69 四键投影体 | 新 L70-78；后随 `Object.isFrozen` 抽检保留（L79-82，pre-existing if-guard 未被改写） | **一致** | — |
| §8.1 family B 改写式（3 处） | sync-control L145/156、red L103；`readOk`/`oracle`/`PROJ`/分字段断言/`JSON.stringify` toContain/四键投影键集全部原样 | **一致**（C2.4 反向边界保持） | — |
| §8.1 生产者改写式（9 处：5 类 stub + 工厂默认 + 2 内联 override + makeMarkerRuntime） | 全部落地；D7 注释按设计更新为指向 `ReadDataOkShape` 类型锁 | **一致** | — |
| §8.3 门兼容（标识符实参不触发扫描） | 站点形态均为 `expectReadDataOk(<subject>, {...})`/`expectReadDataOkKeys(<subject>)`；helper 内 `toStrictEqual(expectedShape)`/`toStrictEqual(READDATA_OK_KEYS)` 实参均非字面量——对照扫描器 `readObjectShape`/`readExactKeySetArgument` 源码逐条验证不命中 | **成立**（SA4 静态复演扫描规则） | — |
| §7.3/§8.4 `toStrictEqual` 语义与等价论证 | actual 侧全部普通对象字面量（runtime.ts:487 / `readDataOk`）；唯一 undefined 用例两侧键均在场 → 判定不变 | **成立** | — |
| §12 回退路径（`toEqual` 降级） | 未触发（SA3 报告明示；helper 保持 `toStrictEqual`） | **一致** | — |
| T3 零预演 | 两树 + `runtime.ts` grep `truncated|truncations` = NONE | **一致** | — |

## 5. 架构一致性与惯例

### 责任归属

| Behavior | Expected owner | Actual location | Assessment |
|---|---|---|---|
| readData 成功形状断言/构造单点面 | namespace-runtime 测试树（readData 契约 Owner，ADR-0016） | `packages/namespace-runtime/test/helpers/readdata-ok-shape.ts` | **一致** |
| 验收仪器 | SA6 交付面（DENY） | 扫描器 + 门未被修改（未跟踪、内容与 SA6 契约描述的规则/自控结构逐条吻合） | **一致** |

### 相似能力对照

| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
|---|---|---|---|---|
| 跨包测试 helper 共享（registry → runtime 测试树） | `durable-snapshot-wait.js`（4 文件 import，SA4 复核在树） | 同款相对路径 `../../namespace-runtime/test/helpers/readdata-ok-shape.js`（8 个 registry 文件） | 一致 | B4 先例 |
| 测试树内非测试 helper 模块 | `readdata-schema-projection-fixture.ts`、`durable-snapshot-wait.ts`（kebab-case、无 `.test.ts` 后缀、`import { expect } from 'vitest'` 先例 ×2，SA4 复核在树） | `helpers/readdata-ok-shape.ts` 同款 | 一致 | 命名/位置/不被 vitest 收集 |
| 类型导入 | 各测试文件 `import type` 惯例 | helper L14 `import type { ReadDataSchemaProjection }`（vfsl `src/index.ts:126` 实导出，SA4 复核） | 一致 | verbatimModuleSyntax 安全 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| 成功形状（T0：三键） | helper 模块内断言面（L39）/构造面（L29）/键集（L17）三处内联 | 36 个调用站点零形状知识（grep 证：两树无其他三键字面量） | 低——反伪绿要求的有意三写；漂移由 C2.3 探针 + 生产者报告「恰 2 条」哨兵捕获（见 §12-O4） |

### 生命周期对称性

无资源获取/释放、无订阅、无后台任务、无计时器引入；`readDataOk` 无状态、每次新鲜对象；helper 纯断言。对称性不适用且无隐藏生命周期。✓

### 平行机制检查

| Candidate duplicate | Existing path | Actual path | Disposition |
|---|---|---|---|
| 第二套形状 helper/常量 | 无（SA6 H3） | 单一模块三导出 | 非平行——补齐缺失单点面 |
| 复用扫描器常量 | `readdata-shape-assertion-scan.ts` | 独立定义 | 有意分层（设计 §7.1），非平行 |

## 6. 文件范围审查

| Changed path | ALLOW entry | Purpose | Assessment |
|---|---|---|---|
| `packages/namespace-runtime/test/helpers/readdata-ok-shape.ts`（新增） | §10.1 行 1 | 单点断言/构造面 | ✓ |
| `runtime-readdata-hostile-path-guard.test.ts` | §10.1 行 2（4 断言 + import） | C1a | ✓（diff = import + 恰 4 处改写） |
| `runtime-readdata-schema-projection-red.test.ts` | §10.1 行 3（仅 L102 + import） | C1b + C2.4 | ✓（diff = import + 恰 1 处；`readOk`/`oracle`/`PROJ` 零改动） |
| `readdata-docs-adr0016-sync-control.test.ts` | §10.1 行 4（L143/154 + import） | C1b + C2.4 | ✓（同测试体其余断言原样） |
| `registry-idle.test.ts` | §10.1 行 5（11 断言 + 生产者 + import） | C1a + §7.2 | ✓ |
| `registry-create.test.ts` | §10.1 行 6（3 断言 + 生产者 + import） | C1a + §7.2 | ✓ |
| `registry-open.test.ts` | §10.1 行 7（2 断言 + 3 生产者 + import） | C1a + §7.2 | ✓ |
| `registry-sa7-rev1.test.ts` | §10.1 行 8（3 断言 + 生产者 + import） | C1a + §7.2 | ✓ |
| `registry-sa7-hostile.test.ts` | §10.1 行 9（1 断言 + 生产者 + import） | C1a + §7.2 | ✓ |
| `registry-sa7-concurrency.test.ts` | §10.1 行 10（仅生产者 + import） | §7.2 | ✓ |
| `registry-shutdown.test.ts` | §10.1 行 11（仅生产者 + import） | §7.2 | ✓ |

范围门实测（SA4 只读复跑）：

- `git diff --name-only | grep -vE '^packages/(namespace-runtime|namespace-registry)/test/'` → **空**（grep exit 1 = 无越界行）。
- `git diff --name-only -- 'packages/*/src' 'domains' 'apps' 'docs'` → **空**。
- `git status --porcelain`：恰 10 `M`（全在两测试树）+ `??` helper + `??` SA6 仪器两文件（未跟踪、无 diff 面）+ `??` wiki 产物（Host-owned）。
- diff 统计 65 insertions / 42 deletions，全部 hunk 逐一目检为设计附录所列改写 + import 行 + D7 注释更新，无夹带。

DENY 复核：`runtime.ts`（M1 探针施加点）diff 空、L474-490 原文在；`runtime-readdata-schema-projection-control.test.ts` 零 diff（其 `toMatchObject`/两键面 grep 确认原样）；3 个 `.test-d.ts` 零改动；`doc-runtime/**` 零改动。

## 7. 契约连锁审查

| Contract | Caller | Actual handling | Risk | Finding |
|---|---|---|---|---|
| 新 helper 模块对两测试树可用性 | 10 个测试文件（runtime 2 相对 `./helpers/`、registry 8 相对 `../../namespace-runtime/test/helpers/`） | 先例同款（`durable-snapshot-wait.js` ×4，SA4 复核在树）；vitest include 收集 10 个 `.test.ts` 消费者 | 无 | — |
| helper 不被 vitest 收集为测试 | vitest include `packages/*/test/**/*.test.ts` | helper 无 `.test.ts` 后缀（`test/helpers/` 与既有 `registry-seam-audit.ts` 同列） | 无 | — |
| 类型检查入口 | root `pnpm test`（`vitest run --typecheck`，程序 `tsconfig.typecheck.json` include `packages/*/test/**/*.ts`） | helper 及 10 个改写文件进该程序（110 文件计数吻合：107 + 扫描器 + 门 + helper） | 无 | — |
| 包级 `pnpm typecheck`（只含 `src/**`） | 14 个包 tsconfig | 测试树变更不进入包级程序；跨包测试 import 不影响 src 类型面 | 无 | — |
| `ReadDataSchemaProjection` 可赋值性（hostile-guard 四键字面量） | `expectReadDataOk` 第二参 | `resolve-schema-at-path.ts:49-61` 四键接口；scalar 成员 `derived.ts`；上下文类型成立 | 无 | — |
| typed stub 类型锁迁移（D7/TS2322） | 5 个 `implements NamespaceRuntime` stub + `makeRuntime` 默认 | `readDataOk` 返回精确 `ReadDataOkShape`（非联合/any）；T3 接口加键 → 类声明处 TS2322 | 无（锁保留） | — |
| 生产代码/公共类型/wire/schema 消费方 | 无 caller 变化 | 零 src 变更；`NamespaceRuntimeReadDataResult` 等类型仅 import | 无 | — |

## 8. 错误、恢复与并发

| 检查点 | 结论 |
|---|---|
| 吞错/伪成功 | 无 try/catch/fallback/env override；helper 失败 = vitest throw + diff；`ok:false` 实际值在 `ok:true` 期望下必红（无静默通过路径） |
| 部分完成诚实性 | 纯测试树改写，无部分完成语义；遗漏站点会被门 family A/B 清单点名（结构保证） |
| 并发/幂等 | 全部改写点为同步断言/构造；`readDataOk` 每次新鲜对象、无共享可变状态；各文件 deferred gate / scheduler 原语零触碰（diff 证） |
| 回滚 | 单提交 revert 即完全恢复（门回 2 红/18 绿缺口态）；无迁移/持久化 |
| 突变残留 | `runtime.ts` diff 空；helper `readDataOk` 函数体恰三键；两树 grep `truncated\|truncations` = NONE → SA3 的 M1/M2 探针已完全还原，无失败后复活 |
| 静态不可确认项 | M1（预期 6 红）/M2（预期 ≥19 红）的实际红数、全套绿、typecheck exit 0 属动态结果——SA4 不运行测试，静态结构论证见 §9 与 §10，独立复跑归 SA5（SA6 §12.2 C2.3 明示） |

M2 反伪绿静态论证（SA4 独立）：`readDataOk` 函数体是构造面唯一字面量来源；`expectReadDataOk` 期望对象在 L39 独立内联（`{ ok: true, value: expected.value, schema: expected.schema }`），不经过 `readDataOk`。故 M2 突变（构造面追加键）只改 actual 一侧，19 处 registry 断言（idle 11 / open 2 / create 2 / hostile 1 / rev1 3）必然 toStrictEqual 失败——伪绿在结构上不可达。

## 9. 测试质量审查

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
|---|---|---|---|---|
| `readdata-shape-assertion-consolidation-gate.test.ts`（20 tests，SA6 交付、DENY 未改） | family A/B 清单为空（C1a/C1b）；作用域 ≥80 文件 + 4 锚文件；7 正/8 负仪器自控 | vitest include `packages/*/test/**/*.test.ts`（配置在树，SA4 复核）；root `pnpm test` 同入口 | 无 skip/only/todo；失败消息带 file:line 清单。SA4 静态复演扫描规则于当前树：两树 110 `.ts` 中深等+对象字面量（ok:true+schema）命中 0、三键键集数组字面量命中 0（唯一 `['ok','schema','value']` 数组字面量为 helper/扫描器 const 声明与门内字符串样本，均不在断言实参位）→ 门 20/20 绿的结构前提成立 | — |
| `runtime-readdata-hostile-path-guard.test.ts`（4 tests） | 敌意 path 守卫下成功分支恰三键（含 `value: undefined` 键在场、四键投影体深等） | 同 include | 改写后断言强度不降（toStrictEqual 严查键集 + undefined 键在场）；后随 `'schema' in r`、`Object.isFrozen` 抽检保留 | — |
| `runtime-readdata-schema-projection-red.test.ts`（15 tests） | 键集恰三键 + 分字段投影内容 = 独立预言机 | 同 include | `readOk` 窄接口/oracle/PROJ/分字段断言零改动（C2.4） | — |
| registry 8 文件（idle 18 / create 47 / open 32 / sa7-hostile 6 / sa7-rev1 6 / concurrency / shutdown / docs-sync-control 21） | lease.readData 行为 + 替身形状 | 同 include | 27 处改写均为表达式对表达式原位替换；行尾注释保留；无断言删除 | — |
| `runtime-readdata-schema-projection-control.test.ts`（6 tests，DENY） | 加法兼容负控（`toMatchObject`/两键/分字段） | 同 include | 零 diff（grep 复核原文在）——C2.4 保持 | — |
| 3 个 `.test-d.ts` 类型锚（DENY） | 类型面 | `vitest run --typecheck`（`typecheck.include`） | 零改动 | — |

测试真实性：全部改写文件为既有被 vitest include 收集的 `.test.ts`；无源码字符串断言替代行为断言（门为 AST 结构门 + 行为面由既有套件承担，SA6 §12.3 分层成立）；fixture 隔离与清理逻辑零触碰。

## 10. Required revisions

无 BLOCKER / MAJOR finding。无需修订。

## 11. 后续动态验证项

| Risk | Driver | Expected observation | Failure condition |
|---|---|---|---|
| C2.3 M1 独立重跑（SA6 §12.2 指派 SA5） | 生产 `runtime.ts` 成功分支（L487 字面量）追加 `truncated:false, truncations:[]` 后跑 hostile-guard + projection-red + docs-sync-control，再还原 | 6 tests 红（hostile 4A + red 1B + docs-sync 1B）；还原后 `git diff` 空 | 任一不红 = helper 被削弱（伪绿），验收拒绝 |
| C2.3 M2 独立重跑 | **只改** `readDataOk` 函数体追加同两键，跑 registry 五文件（idle/open/create/sa7-hostile/sa7-rev1），再还原 | ≥19 tests 红（11/2/2/1/3）；还原后与基线逐字节相同 | 任一不红 = 断言面与构造面耦合，验收拒绝 |
| C3c root 门禁 | `pnpm typecheck`；`NODE_OPTIONS=--conditions=nomicore-source pnpm test` | 前者 exit 0；后者 339 files / 3608 tests / `Type Errors: no errors` / exit 0（SA2 O3 口径） | 任何红/类型错误 |
| C2.1 十二文件 + 门复跑 | 见 SA6 §12.2 命令 | 全绿（门 20/20 含自控） | 任何红 |
| 生产者扫描报告 | `scanReadDataShapeAssertions()` | 站点制造点 0；helper 内恰 2 条（`isAssertionArgument=false`）——SA4 静态复演同结论（两树无其他三键对象字面量） | 报告 ≠ 2 或站点 >0 = 收敛不全或两面折叠 |

## 12. Non-blocking observations

| ID | 观察 | 建议 |
|---|---|---|
| O1 | `registry-create.test.ts` helper import 置于两个包导入之间（该文件 import 分组本就非严格排序）；SA3 已自报 | 无需动作；后续整理 import 顺序时顺带归组即可 |
| O2 | `toStrictEqual` 对 hostile-guard T3（`value: undefined`）用例的严格性高于原 `toEqual`：若实现漏写 `value` 键，新形态红而旧形态绿。这是 C2.2.3 明示方向的 fail loud，非行为回归（当前实现恒写键，判定不变） | 无需动作；设计 §8.4 回退路径未触发，保持现状 |
| O3 | `registry-phase5-bootstrap-reset-r2-internal.test.ts:271` 存在两键 `readData: () => ({ ok: true, value: 1 })` legacy fake（返回类型 `unknown`）——pre-existing、无 schema 键、不属三键形状面，SA6 盘点正确排除、T0 不改是对的；但 T3 五键修订时该 `unknown` fake 无类型锁保护 | 在 T3 任务简报中登记该 legacy fake（以及同类 `unknown`/`any` 替身）为五键漏改风险点 |
| O4 | helper 模块内三处形状内联（键集常量/构造面/断言面）可内部漂移；现有捕获机制 = C2.3 探针 + 生产者报告「恰 2 条」哨兵，均在验收时点一次性执行 | T3 修改本模块时三处必须同笔改并重跑 M2 同类探针（继承 SA2-O5 的建议） |

## 13. 是否需要设计后 ADR 冲突复查

**不需要（`requiresConflictRecheck: false`）。** 零公共 API/协议/wire/schema/持久化/状态机语义变化；ADR-0016 现状被逐点保留（恰三键断言语义与实现均未变），ADR-0024 决策 4 仅执行前置准备、零预演；SA4 独立复核未发现任何 ADR 触碰面。
