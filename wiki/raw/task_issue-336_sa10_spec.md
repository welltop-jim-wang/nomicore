# SA10 Spec Review — Issue #336（[shape-budget] T3: readData 五键组合——两通道同预算与截断清单）

> SA10（独立 Spec 审查，iteration 0）。被审对象：worktree `/home/wangjian/nomicore-fix-issue-336`
> 上**已提交**的 Issue #336 最终 diff——HEAD `ea0044a`（`fix(namespace): compose budgeted
> readData results`，基线 `cdfdff6`；9 文件修改 + 6 新测试文件 + 10 wiki 产物）。只判断实现
> 是否忠实满足 Issue 正文 / 适用 Owner 评论 / 验收标准与规范契约；不评通用架构风格（SA9 面）、
> 不修改任何文件、不运行测试。全部关键证据锚点经本迭代亲自读取核对（非转述 SA 报告）。

## 1. Reviewed inputs

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-336.md`（任务简报 = Issue 正文同源） | 已读 |
| Issue #336 REST comments | **空**（dispatch 指令重读确认）——**无 Owner 评论要求适用**，需求权威 = Issue 正文 + ADR-0024 验收节 |
| `wiki/raw/task_issue-336_design.md`（SA1 iteration 1，1070 行，SA2 approve 版） | 已读全文 |
| `wiki/raw/task_issue-336_sa2_review.md`（SA2 iteration 1，verdict **approve**；F1 销项 + M1/M2 MINOR） | 已读 |
| `wiki/raw/task_issue-336_sa3_impl.md` / `task_issue-336_sa4_review.md`（approve）/ `task_issue-336_sa7_report.md`（approve） | 已读全文 |
| `wiki/raw/task_issue-336_conflict_report.md` / `_design_conflict_report.md`（clear）/ `_implementation_conflict_report.md`（SA8 实现后复查，**clear / requiresConflictRecheck=false**） | 已读 |
| `task_issue-336_sa6_contract.md` | **不存在**（设计 §5 登记；验收权威 = Issue AC + ADR-0024 验收节 L120–130，SA2/SA4/SA8 同裁——本迭代复核一致） |
| 规范契约 | `docs/adr/0024-readdata-shape-budget.md` 全文（决策 1–7、修订节、验收 L120–130）；上游单源面亲核：doc-runtime `read.ts` L90–160/L326–377（T1 双联合 + 读纪律权威）、vfsl `resolve-schema-at-path.ts` L72–153/L194–228 + `index.ts` 导出面（T2 标记/包装联合/三参） |
| 实现 diff 亲核 | `git show ea0044a` 全部 15 个代码文件逐 hunk 亲读；`git show --name-only` 全量路径清点；跨包消费链亲核（`apps/yjs-server/src/app.ts` opRead、`packages/ws-replication/src/testing.ts` L47 bind）；root `package.json` 门禁脚本；helper 消费面 grep |

## 2. Verdict

**approve** —— 已提交 diff 逐点忠实满足 Issue #336 正文与全部 7 条验收标准，无遗漏、无
部分实现、无错误实现、无 scope creep。AC 级 partial/unmet/unachievable 项 = 零。

核心独立核验结论：

1. **五键恒形真实落地**：两联合成功成员恰五键（runtime.ts 类型块 + S2a/S2b 组装体）；
   无 options 分支 `truncated:false` + 每调用新鲜 `[]` 字面量（grep 无共享常量）；三既有
   失败分支形状零变化（PATH_NOT_ALLOWED 原样透传；readDisabled 仅提取 `echoReadPath`
   共用、回显纪律逐字保持；RELEASED_ISSUE 原文未动）。
2. **两通道同预算贯通**：raw options 原样入 T1 三参（单一校验权威）；`canonicalReadOptions`
   读纪律与 T1 `validateReadOptions`（read.ts L326–361）**逐行比对一致**——`Object.keys`
   键空间 / `getOwnPropertyDescriptor` data-property 取值（**零 `[[Get]]`**）/ 整体 try
   收编 / present-undefined 剥离 / ownKeys 谎报 continue / ≥0 有限整数 / `-0` 归一七项全同；
   唯一刻意差异（省 getPrototypeOf）与设计注记一致。投影通道只吃 canonical（组合体亲核）。
3. **READ_OPTIONS_INVALID 公共分支零泄漏**：只在预算联合（Extract 单源派生）；legacy
   联合失败源仍为两参联合 Extract；test-d 双向锁 + `@ts-expect-error` 反向锁在场。
4. **文件范围精确**：diff 恰 15 代码文件 = 设计 ALLOW 15 行一一对应；DENY 全零触碰
   （`git show --name-only` 清点：doc-runtime/vfsl/apps/docs/CONTEXT/wire·复制·诊断·
   既有 fixture·既有行为套件零命中）；10 个既有 helper 消费文件零手改（diff 中既有测试
   文件仅 T0 三件）。

## 3. Issue 正文与 AC 逐条核对

| 来源 | 要求 | 实现证据（本迭代亲核锚点） | 判定 |
|---|---|---|---|
| What to build | runtime `readData(path, options?)` 两通道同预算组合（决策 3/4/5/6） | runtime.ts readData 双重载组合体（lifecycle gate → S2a 两参逐字节 → S2b 三参 + 净化 + 五键）；projection 双重载显式分支 | ✅ met |
| What to build | 成功分支恒五键（恰三键 → 五键破坏性修订，经 T0 集中 helper 落地） | 两联合五键；`readdata-ok-shape.ts` 单点修订（READDATA_OK_KEYS/ReadDataOkShape/readDataOk 缺省参/expectReadDataOk 独立内联五键——反伪绿不变量保持） | ✅ met |
| What to build | 截断清单恒在场空数组、条目三字段（path 同基/kind/omitted） | B-4 逐引用透传（零合成）；red B1 条目三字段 + 尾段键名断言 | ✅ met |
| What to build | `READ_OPTIONS_INVALID` 进入公共结果联合 | 预算联合第四失败分支，恰四键 `{ok,code,path,message}`，三来源同形状 | ✅ met |
| What to build | registry lease 原样透传 options | lease.ts 双重载（released 先行；raw 同一引用直传）；passthrough 引用同一性捕获断言 | ✅ met |
| AC1 | 五键恒形（预算 + 无预算空清单）；失败分支不动；主缝契约测试红绿 + 负控 | red A1–A3（两模式五键 + B14）+ control 失败键集（PATH/DISABLED 恰四键）+ released 三键；SA3 红灯记录 27 failed→37 passed；F2 无 options 恒无该码 | ✅ met |
| AC2 | 两通道截断位置一一对应（主缝断言） | red D1–D6：标记位归一 recipe（数字段→`<item>`、union 成员剥离、闭包弱断言分层）+ F-x1/x2/x3 敌意夹具延拓（「相等 ∨ 响亮失败」）；SA7 独立驱动器复证 | ✅ met |
| AC3 | width 触发时 schema 投影与同路径无预算读逐字节相等 | red E1：`toStrictEqual` + `JSON.stringify` 逐字节（含 key 序）；canonical 保留 width 轴（组合层零轴名过滤） | ✅ met |
| AC4 | depth 条目 path 尾段即被裁键名（枚举语义）；omitted 计数语义（直接子项数 ≠ 后代总数 fixture） | red B1 尾段键名断言；B2/B3 depth:0 骨架 + 单条目；C1 `omitted===2` ∧ `≠6` 显式双断言（blob fixture 2 直接子项 / 6 后代）；C2 width 父路径单条、被裁子键零罗列 | ✅ met |
| AC5 | READ_OPTIONS_INVALID（含未知键）公共失败分支；无 options 逐字节现行为回归锚 | red F1 14 例矩阵（含未知键 ×2、数组、类实例、自定义原型、accessor、抛错 Proxy）恰四键 + path 新鲜回显 + message 非空；F6/F7 定序锚（path 优先、lifecycle 先行）；control 独立双预言机（doc-runtime 值 + vfsl 投影直调）7 路径 `toStrictEqual` + JSON 逐字节 | ✅ met |
| AC6 | T0 集中 helper 恰三键 → 五键修订；lease 透传断言（既有 registry 测试延伸） | helper/scanner/gate 三件单点修订（gate 正负样本五键化：五键 family A/B 正样本、三键 family A 超集保留正样本、三键 family B 移入负样本——仪器敏感性语义正确）；registry 测试树新增透传行为 + 类型双锚文件（设计批准的「新聚焦文件」解读，位于 registry 测试树内并复用既有 fixture/helper——实质满足） | ✅ met |
| AC7 | 全套包门禁 + root typecheck/test | SA3/SA7 运行证据：root `pnpm typecheck`（14 包含 `apps/yjs-server`）绿、root `pnpm test`（`vitest run --typecheck`，350 文件/3841 测试）绿、包级 95 文件/864 测试绿、4 层 tsc 全 exit 0；本迭代亲核命令入口真实（root `package.json` L11–13）——SA10 按边界不复跑 | ✅ met（运行证据在案） |

补充横向核查（本迭代亲测）：新测试零 `skip/only/todo`、零 `as any`、预算断言纪律
（N3）遵守——预算读只用 `expectReadDataOkKeys` + 定点断言，零 `expectReadDataOk` 整形状
断言；跨包消费链无断裂（yjs-server opRead 单参 + 只读 ok/value；ws-replication
`readData.bind(lease)` 命中 legacy 末签名、legacy ⊆ budget 返回协变可赋值——root
typecheck 面覆盖）。

## 4. 规范契约符合性（ADR-0024 验收节 L120–130 对照）

| ADR 验收条款 | 落实 | 判定 |
|---|---|---|
| 主缝：五键恒形 / 清单条目 / depth:0 骨架 / READ_OPTIONS_INVALID 含未知键 / 无 options 逐字节回归锚 / schema:null 语义不变——红绿 + 负控 | §3 表 AC1/AC4/AC5 + red B2/B3/F1 + control 预言机 + red H1/H2 | ✅ |
| omitted 计数语义显式断言（fixture 直接子项数 ≠ 后代总数） | red C1 | ✅ |
| 零物化行为哨兵（被截子树埋 non-finite → 预算 ok；退化实现红） | red G1（折叠 ok + 无预算读 PATH_NOT_ALLOWED 双锚） | ✅ |
| width 对投影无操作（逐字节相等） | red E1 | ✅ |
| registry lease 透传断言 | passthrough 4 行为用例 + test-d | ✅ |
| 影响包全套门禁 + root typecheck/test | §3 AC7 | ✅ |
| 载体单元 / 类型面 / 文档负控条款 | 归 T1 #334 / T4 #337 / T5 #338 票面（SA8 前置门禁 §6 裁决：非本票义务） | 不适用（归票正确） |

ADR-0024 决策 1/3/4/5/6 条款级符合性经 SA8 实现后复查 16 行逐项裁决
（10 implements-existing-decision + 6 no-conflict，零 hard-conflict，三项正式 override
落地范围未扩大）；本迭代对其中高风险行（决策 1 码面、决策 4 五键、决策 5 L81 对齐、
决策 6 透传）独立复核与 diff 一致。

## 5. Scope creep 与错误实现排查

- **无 scope creep**：未做 T4 `DeepOptional`（value 保持 `unknown`，归 #337）、未触文档负控
  正则与形状注记（归 #338）、未触 ADR/CONTEXT、未做版本 bump（发布流随动，设计 §13 钉死）、
  零 wire/诊断/复制面改动、无第二读路径 / 无 runtime 事后裁剪（ADR L116 否决项未复活）。
- **无错误实现**：净化器读纪律逐行对齐权威（SA2 F1 三触发路径结构不可达）；A-2b 双出口
  仅在净化失败分支；A-2c 接缝终态成员触发点唯一（grep 亲核）且以 Extract 单源类型注解锁死
  形状漂移；重载序（预算前/legacy 后）经 `_readOverloadOrder` + test-d `_legacyReturnType`
  双锁；`cloneValueSchema` 显式 `case 'truncated'`（10-case 穷尽、仍无 default——fail-loud
  保持）；无 `readDataBudgeted` 类平行方法。
- **无部分实现**：Issue 正文五要素与 AC1–AC7 全部闭合，无「形状按参数分叉」「清单缺席
  表无截断」等隐式约定残留。

## 6. PR 必须披露的未达成 /  deferred 项（均非 AC 缺口，不阻断 approve）

| # | 项 | 性质 | 依据 |
|---|---|---|---|
| D1 | **版本 bump 未随票落地**（runtime 0.1.12→0.1.13、registry 0.1.10→0.1.11） | 发布流随动（ADR L69 破坏面论据的兑现动作），非代码面 | 设计 §13；SA8 实现后复查 §8-3 |
| D2 | **文档负控正则与 docs/integration 形状注记仍处三键时代**（`readDataOptionUsages`「禁一切带参」未修订、sync-red 文案含「恰三键」） | T5 #338 票面（本票 DENY 明令不触）；SCOPE_DOCS 无预算用法故门保持绿——已知窗口期 | 设计 §1/§11；SA4 §12-4 |
| D3 | **接缝不可检测残余**：非确定性 descriptor 在两个 T1 可接受合法视图间交替（如 depth 5↔1）无法被接缝识别——完全闭合需 doc-runtime 暴露已校验预算（新公共 API，走公共契约变更流程） | 已登记 follow-up，实现未伪装闭合；可检测漂移面（键集漂移/accessor 显形/值非法/trap 抛）已全部响亮拒绝 | 设计 §7.1 诚实登记 + §13；SA8 §6 条件性登记 |
| D4 | **SA6 验收契约产物缺席**（`task_issue-336_sa6_contract.md` 不存在） | 验收权威 = Issue AC + ADR-0024 验收节 L120–130（两者同源），全流程角色一致裁决不阻塞 | 设计 §5 |
| D5 | **M1 设计文本措辞**（「键集漂移已全部响亮拒绝」表述过宽——键在场性交替不可检测） | 措辞修订属 SA1/Controller 面；实现与测试行为与修订语义一致（F-x5/F-x6 仅断言可检测面） | SA2 M1；SA3 §Deviations；SA8 §8-1 |
| D6 | **修饰性测试卫生**：red/control 两文件 `import * as Y from 'yjs'` 无使用点（tsconfig 未开 noUnusedLocals，不影响门禁）；passthrough L213 冗余 cast（不改值不吞错） | MINOR，可随手清理 | SA4 §12-1/2；本迭代 grep 复证 |
| D7 | **提交信息未沿谱系约定**：`fix(namespace): compose budgeted readData results` 未含 `#336` / `[shape-budget] T3` 标识（T0–T2 提交均带票号前缀） | 可追溯性 MINOR（已提交事实，登记备查） | `git log` 对照 `80d59f8`/`b8e2947`/`cdfdff6` |

## 7. requiresConflictRecheck

**false** —— SA8 实现后冲突复查（iteration 3）已对实际 diff 闭合全部待核对面并标记
`requiresConflictRecheck=false`；本迭代对公共 API 面（双重载 + 五键 + 新失败码 + type-only
导出）、三项 override 落地、A-2b/A-2c 触发点唯一性、两通道对齐断言独立复核一致，未发现
新的待复查冲突面。

## 8. 结语

已提交 diff（HEAD `ea0044a`）忠实、完整、精确地满足 Issue #336 正文五要素与 AC1–AC7，
符合 ADR-0024 验收节与相关冻结面；文件范围 = ALLOW 精确对应、DENY 零触碰；无 scope
creep、无错误实现、无部分实现。六项披露项（D1–D7）均为已登记的 deferred/随访/修饰性
事项，建议随 PR 描述列示，不构成 AC 缺口。**approve**。
