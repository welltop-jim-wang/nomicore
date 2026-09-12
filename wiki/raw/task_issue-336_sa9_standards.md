# SA9 Standards Review — Issue #336（T3：readData 五键组合——两通道同预算与截断清单）

> SA9（独立 Standards 审查者），iteration 0。被审对象：worktree
> `/home/wangjian/nomicore-fix-issue-336` 上**最终已提交**的 Issue #336 diff——commit
> `ea0044a`「fix(namespace): compose budgeted readData results」（基线 `cdfdff6`；
> 9 源/测试文件修改 + 6 新测试文件 + 10 wiki 过程产物）。审查面**仅限**仓库/工程标准：
> AGENTS、ADR 条款、模块责任、既有架构惯例、单一事实源、生命周期对称性、文件范围与
> 测试质量。Issue 需求完整性属 SA10 面，不在本报告裁决。Issue #336 REST comments 经
> Host 重读为空——**无 Owner 评论要求适用**。本迭代全部关键结论均经本人对最终 diff
> 与源码亲自核对（非仅转述上游 SA 产物）。

## Inputs

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-336.md`（任务简报；Issue 正文同源，comments 空） | 已读 |
| `wiki/raw/task_issue-336_design.md`（SA1 iteration 1；§7 决议 / §11 文件范围 / §12 验收规格 / §13 风险登记） | 已读全文 |
| `wiki/raw/task_issue-336_sa2_review.md`（SA2 iteration 1 approve；F1 销项） | 已读 |
| `wiki/raw/task_issue-336_sa3_impl.md`（SA3 实现报告 + Verification 表） | 已读全文 |
| `wiki/raw/task_issue-336_sa4_review.md`（SA4 approve） | 已读全文 |
| `wiki/raw/task_issue-336_sa7_report.md`（SA7 approve；95/95 动态证据） | 已读全文 |
| `wiki/raw/task_issue-336_implementation_conflict_report.md`（SA8 实现后复查 clear / requiresConflictRecheck=false） | 已读 |
| `wiki/raw/task_issue-336_relevant_decisions.md`（ADR 0024/0016/0008/0009/0003 摘录） | 已读 |
| 最终 diff 亲核 | `git show ea0044a` 全部代码 hunk；runtime.ts / read-schema-projection.ts / 两包 index / registry types+lease / T0 三件 / 6 新测试文件全文；doc-runtime `read.ts` L316–377（T1 读纪律权威）独立比对；`apps/yjs-server/src/app.ts` L594–615 消费面；sequencer grep；`.editorconfig` / `tsconfig.base.json` / 版本号 / commit 惯例 |

## Verdict

**approve** —— 最终已提交 diff 全面符合仓库与工程标准；无 BLOCKER / MAJOR。MINOR
观测（均不阻断）见 §7。

---

## 1. 仓库 AGENTS 与模块契约

| 标准 | 证据 | 判定 |
|---|---|---|
| 根 AGENTS「改 packages/ 前读最近嵌套 AGENTS 并守其边界」 | 实现与两模块 AGENTS 逐条对账（下四行）；SA1 设计 §2/§6 已锚定 | ✅ |
| namespace-runtime AGENTS「Reads stay outside that sequencer」 | `readData` 组合体（runtime.ts 工厂闭包内函数声明，S1 gate → S2a/S2b → C → P）全同步、零 sequencer 触达——grep `sequencer` 23 处命中无一在 readData 路径 | ✅ |
| namespace-runtime AGENTS「Public APIs expose detached projections only」 | 值通道 = doc-runtime 新鲜深拷贝透传；投影通道 = `detachReadSchemaProjection` 全量深拷贝（含新增 `case 'truncated'` 标记 clue 全新普通副本、memo 统一登记）；不冻结、零缓存；control detach 用例断言引用互异/mutation 不污染 | ✅ |
| namespace-runtime AGENTS「close() 同步停接纳……」+ ADR-0008/#92 停接纳纪律 | lifecycle gate 保持**先行**且先于一切 options 读取与 doc 触碰（B-1）；F7 锚：closing/closed + 非法 options → `RUNTIME_READ_DISABLED` | ✅ |
| namespace-registry AGENTS「Add public APIs only through `src/index.ts`」 | registry 新增公共面 = `NamespaceLeaseReadDataBudgetResult` 经 index.ts **+1 type-only** 导出；lease 行为改动只在包内工厂函数 | ✅ |
| 模块验证门（root `pnpm typecheck` + `pnpm test`） | SA3 记录 root typecheck 14 包绿、`pnpm test` 350 文件 3841 测试绿；SA7 独立复跑两包 95 文件 864 测试 + 4 层 tsc 全 exit 0；SA9 按边界不复跑，静态核对命令入口真实（root package.json / vitest.config.ts） | ✅（运行证据为 SA3/SA7 面） |

## 2. ADR 条款符合性（架构契约）

| ADR 条款 | 实现落点 | 判定 |
|---|---|---|
| 0024 决策 4（L58–69 恒五键；失败分支不带新键；空清单恒空数组、形状唯一） | 两联合成功成员恰五键；无 options 分支 `truncated:false` + **每调用新鲜 `[]` 字面量**（禁共享常量——调用方可变副本纪律）；三既有失败分支形状零变化（PATH 透传 / readDisabled 仅提取 `echoReadPath` 共用 / RELEASED_ISSUE 原文未动） | ✅ |
| 0024 决策 6（L85–87 两通道同预算、lease 原样透传、**不新增第二条读路径**）+ L116 否决 runtime 事后裁剪 | 一次 readData 内同一预算贯通；grep 无 `readDataBudgeted` 类第二路径；裁剪全部在 T1/T2 递归内，组合层零事后裁剪；lease active 期 raw 引用直传 | ✅ |
| 0024 决策 1（L29–31 `READ_OPTIONS_INVALID` 同步不抛、不借路径/生命周期码、含未知键） | 新增第四失败分支恰四键 `{ok,code,path,message}`，三来源同形状（T1 首拒透传 / A-2b 出口① 重派发单源成员 / 出口② 接缝终态成员）；无 options 分支结构上不可达该码；F 矩阵 14 例 + 定序锚（path > options、lifecycle > options） | ✅ |
| 0024 决策 3（L43–56 清单条目三字段 / 尾段键名 / omitted=直接子项数 / width 父路径单条） | `truncated`/`truncations` **逐字段透传** T1 结果（零合成、零合并、零投影侧清单）；语义全部单源于 T1 | ✅ |
| 0024 决策 5（L81 对齐契约级承诺；L74 width 对投影无操作；L75 schema:null 单义） | canonical 净化保证两通道同预算；主缝 D1–D6 位置集相等断言 + F-x 敌意夹具延拓；E1 width-only 逐字节相等；D3a 状态守卫位置零变化、净化失败在投影调用**之前**短路（绝不经 `!resolved.ok→null` 静默化） | ✅ |
| 0016 L19 恰三键条款 | 经 0024 决策 4 + 修订节第 1 条合法修订（corpus 内授权链）；always-on / null 单义 / detached 纪律全部保持 | ✅ |
| 0003 L46 冻结面（ValueSchema 9-kind；标记不下沉） | `cloneValueSchema` 新增**显式** `case 'truncated'`，10-case 穷尽、**仍无 default**（fail-loud 保持）；`packages/vfsl/**` 零触碰；纯/预算双重载保住 legacy 侧静态纯度 | ✅ |
| 0008 读取保留不变量 / 0009 L38 代理语义 / 0011·0014·protocols（读面不触诊断与 wire） | 读路径零资源获取/释放；lease 透传 = 代理语义最小加法扩展（released 先行）；replication/diagnostic/protocols 包零触碰（diff 亲核） | ✅ |

## 3. 单一事实源

| 事实 | 单源 | 派生方式 | 判定 |
|---|---|---|---|
| options 类型 | doc-runtime `ReadLogicalValueAtPathOptions` | `NamespaceRuntimeReadDataOptions = ReadLogicalValueAtPathOptions` 别名（零复制）；registry 直接 import 该命名类型 | ✅ |
| 失败成员形状 | doc-runtime 两结果联合 | `Extract<…, {ok:false}>` 派生（`ReadLogicalValueFailure` / `ReadLogicalValueBudgetFailure`）——零泄漏双联合，READ_OPTIONS_INVALID 只在预算联合 | ✅ |
| A-2c 接缝终态成员（D1 登记豁免） | 类型仍单源：返回注解 = `ReadLogicalValueBudgetFailure`（T1 加必填键即编译红）；唯一触发点（grep 亲核）；`echoReadPath` 与 readDisabled 同纪律（提取式重构，回显语义逐字保持）；message 恒非空 | 设计 §7.1-A-2c 已登记、SA8 实现后复查裁决在授权范围内 | ✅ |
| 截断清单 | T1 每调用新鲜累加器 | 逐引用透传，单所有者移交 | ✅ |
| 形状断言 | T0 helper（`readdata-ok-shape.ts`） | 恰三键→五键**单点**修订：常量/形状/生产者/断言侧同步；`expectReadDataOk` 期望值仍独立内联构造（反伪绿不变量保持）；`readDataOk` 缺省参数使 10 个消费文件零手改（diff 亲核零触碰）；scanner `SUCCESS_SHAPE_KEYS` 五键化（family A 超集判定零改动——gate 正样本含三键字面量仍命中，语义正确） | ✅ |
| 净化器读纪律 | T1 `validateReadOptions`（read.ts L326–361） | **SA9 独立逐行比对确认**：`Object.keys` 键空间 / `getOwnPropertyDescriptor` data-property 取值（零 `[[Get]]`）/ 谎报键 continue / accessor 拒 / present-undefined 剥离 / ≥0 有限整数 / `-0` 归一 / 整体 try 收编——七项全同；唯一刻意差异（省 `getPrototypeOf`）有设计注记且结构论证成立（继承键在两通道键空间之外）；注释互指锚定 T1 演进复查点 | ✅ |

## 4. 生命周期对称性与错误面

- 读路径零资源获取/释放：无缓存、无订阅、无 sequencer 槽位；调用局部状态（新鲜 `[]` /
  T1 新鲜累加器 / 每调用新鲜 canonical 与 detach 副本）——无跨调用共享可变状态。
- 定序对称：runtime lifecycle gate 先行 ∧ lease released 短路先行，两级拒绝面均先于
  一切透传/options 触达；SA7 动态证据（close 后敌意 Proxy `get=0 desc=0 ownKeys=0`）佐证。
- 错误面互斥、全同步、零 throw（`InternalError` 唯一逃逸 throw 通道不变；resolver 调用
  零新增 catch）；净化失败双出口均恰四键响亮失败，绝不 `schema:null` 静默化、绝不带截断键。
- 非确定性「合法值交替」不可检测残余：设计 §13 诚实登记（闭合需 doc-runtime 新公共 API，
  越本票「只消费」非目标），实现未伪装闭合——符合诚实登记纪律，非标准违例。

## 5. 文件范围

- 最终 commit 代码面 = **恰 15 个文件**，与设计 §11 ALLOW LIST 15 行一一对应（亲核
  `git show --name-only`）：runtime 3 src + registry 3 src + T0 三件 + 6 新测试文件。
- DENY LIST 零触碰（diff 亲核）：`packages/doc-runtime/**`、`packages/vfsl/**`、
  `apps/yjs-server/**`、`docs/**`、`CONTEXT.md`、replication/diagnostic 各包、既有
  `readdata-schema-projection-fixture.ts` 与 docs 负控三件、既有 readData 行为套件。
- wiki/raw 10 件过程产物同票提交——与 T0/T1/T2 既有提交惯例一致（`80d59f8`/`b8e2947`/
  `cdfdff6` 均含本票 wiki 文件），非越界。
- 版本 bump（runtime 0.1.12 / registry 0.1.10 未动）按设计 §13 属发布流随动——登记在案，
  非本票代码面。

## 6. 测试质量标准

| 标准 | 证据 | 判定 |
|---|---|---|
| 红绿 + 负控（#273 打法） | red 组 A–H（五键恒形/清单语义/对齐/width/失败矩阵/敌意净化面 F-x1–F-x6/零物化哨兵/schema:null 共存）+ control 独立预言机（doc-runtime 值 + vfsl resolver 直调，`toStrictEqual` + `JSON.stringify` 逐字节）；SA3 记录实现前 27 failed/10 passed → 实现后 37 全绿 | ✅ |
| 类型面锚 | 双 `*.test-d.ts`：`keyof` 五键精确集、schema 纯/预算分型、零泄漏双向探针、失败面无新键、重载序 `ReturnType` 锁、`@ts-expect-error` 反向锁；lease.ts 内 `_readAlias` 原文保持 + `_readBudgetAlias`/`_readOverloadOrder` 两新 Equal 锁 | ✅ |
| 断言纪律（N3） | 预算读结果只用 `expectReadDataOkKeys` + 定点断言；全文无 `expectReadDataOk` 整形状断言用于含标记投影、无 `as any`（唯一 cast = 敌意通道单点 `asOptions` 与 F6 敌意 path cast，均有注记、不改值不吞错） | ✅ |
| 无弱化 | grep 无 `.skip/.only/.todo`；`ok()`/`failure()` 前提断言 loud throw（无假绿通道）；gate 断言语义不变（正负样本随动，三键 family B 正确移入负样本） | ✅ |
| fixture 卫生 | 每用例独立 MemoryPersistence + Y.Doc；F-x2 `Object.prototype` 污染 try/finally 还原；新 fixture 复制既有构造形态、原文件零编辑（N4） | ✅ |
| 真实 runner 入口 | vitest include / typecheck include 覆盖新文件（SA4 亲核）；registry 跨包相对导入沿既有 `readdata-ok-shape` 先例 | ✅ |

## 7. MINOR 观测（不阻断 approve）

1. **提交信息惯例偏差**：最终 commit「fix(namespace): compose budgeted readData results」
   未带 `#336` 引用与 `[shape-budget]` 谱系标签——前序 T0/T1/T2 提交（`fix(#333)…`/
   `fix(#334)…`/`fix(#335)…`）与仓库多数历史均为 `type(#issue):` 格式，SA3 建议稿亦含
   `#336`。仓库无 commitlint 强制，属可追溯性惯例层面的修饰性偏差（不影响代码标准）。
2. **死导入**（SA4 §12.1 同裁）：red L21 / control L14 `import * as Y from 'yjs'` 无使用
   点；tsconfig 未开 `noUnusedLocals`，门禁不受影响，后续顺手清理即可。
3. **冗余 cast**（SA4 §12.2 同裁）：passthrough L213 `as NamespaceLeaseReadDataBudgetResult`
   非必需（双重载已使命中预算别名）；不改值不吞错。
4. **文档面滞后为已登记 follow-up**：docs/integration 形状注记与 `readDataOptionUsages`
   负控正则仍处三键时代——T5 #338 面（DENY 明令不触），合并窗口期由 #338 闭合，非本票缺陷。

## 8. 结语

最终已提交 diff 在模块责任（runtime 组合 / registry 纯代理 / doc-runtime·vfsl 只消费）、
ADR 授权链（0024 决策 1/3/4/5/6 + 0016 修订注册 + 0003 冻结面）、单一事实源（别名/
Extract/透传/T0 单点/A-2c 登记豁免带类型锁）、生命周期对称性（gate 先行、released 先行、
读路径零资源）、文件范围（ALLOW 精确 / DENY 零触碰）与测试质量（红绿+负控+类型锚+
反伪绿纪律）六个标准面全部符合；SA4 approve、SA7 approve、SA8 实现后复查 clear
（requiresConflictRecheck=false）与本轮独立核对互证。无 BLOCKER / MAJOR，**approve**。
