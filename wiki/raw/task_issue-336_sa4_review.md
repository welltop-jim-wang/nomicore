# SA4 实现后红队静态审查 — Issue #336（T3：readData 五键组合）

> SA4（实现静态审查，iteration 0）。被审对象：worktree `/home/wangjian/nomicore-fix-issue-336`
> （基线 HEAD `cdfdff6`）上未提交的 Issue #336 实现 diff——9 文件修改 + 6 新测试文件。
> 只做静态审查：读取源码/设计/ADR/AGENTS/测试与只读 Git 状态；不修改实现、设计或测试，
> 不运行测试/typecheck、不启动服务、不创建进程。全部证据锚点为本迭代亲自读取核对。

## 1. Reviewed inputs

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-336.md`（任务简报；Issue 正文同源，REST comments 空——无 Owner 要求） | 已读 |
| `wiki/raw/task_issue-336_design.md`（SA1 iteration 1，1070 行） | 已读全文 |
| `wiki/raw/task_issue-336_sa2_review.md`（SA2 iteration 1，verdict **approve**；F1 销项 + M1/M2 MINOR） | 已读全文 |
| `wiki/raw/task_issue-336_sa3_impl.md`（SA3 iteration 0 实现报告） | 已读全文 |
| `wiki/raw/task_issue-336_conflict_report.md`（SA8 前置门禁，clear / requiresConflictRecheck=true） | 已读（经 SA3/SA2/SA8 实现报告转述核对，关键行经设计 §6 映射复核） |
| `wiki/raw/task_issue-336_relevant_decisions.md`（SA8 决议摘录） | 已读（经设计 §2/§6 与 ADR 全文交叉核对） |
| `wiki/raw/task_issue-336_design_conflict_report.md`（SA8 设计后复审 iteration 2，clear / §8 八项） | 已读（经 SA3 §SA8 表逐项与源码核对） |
| `wiki/raw/task_issue-336_implementation_conflict_report.md`（**SA8 实现后冲突复查 iteration 3，clear / requiresConflictRecheck=false**） | 已读全文 |
| `task_issue-336_sa6_contract.md` | **不存在**（设计 §5 登记；验收权威 = Issue AC + ADR-0024 验收节 L120–130，SA2/SA8 同裁） |
| 实现源码亲核 | runtime.ts 全部 diff hunk + 读纪律权威逐行比对（doc-runtime read.ts L94–155/L230–238/**L326–377**）；read-schema-projection.ts 全文（重载分流/10-case 克隆/normalizeReadPath）；两包 index.ts；registry types.ts/lease.ts；T0 三件 diff；6 新测试文件全文；vfsl resolve-schema-at-path.ts L64–229/**L331–375** + derived.ts L44–53（9-kind 亲核）；vitest.config.ts + tsconfig.typecheck.json + root package.json；消费面 grep（readData 全部生产调用点、readdata-ok-shape 14 处引用、LeaseTypeAssertions、ws-replication testing.ts bind、apps/yjs-server opRead）；docs 负控 fixture SCOPE_DOCS/正则；registry-surface 与 runtime-exports-audit 两门 |

## 2. Verdict

**approve** —— 实现逐点忠实落实批准设计（SA1 iteration 1 / SA2 approve 版），未发现
BLOCKER 或 MAJOR。核心验证结论：

1. **F1 修订（SA2 iteration 0 BLOCKER）真实落地**：`canonicalReadOptions`
   （runtime.ts L856–884 区域，包内不导出——grep 亲核零导出）与 T1 权威
   `validateReadOptions`（read.ts L326–361）读纪律**逐行比对一致**——(a) `Object.keys`
   own-enumerable 键空间、(b) `getOwnPropertyDescriptor` data-property 取值（**零 `[[Get]]`**，
   代码中不存在对 raw 的属性读）、(c) 整体 try 收编、(d) present-undefined 剥离 /
   ownKeys 谎报 continue / ≥0 有限整数 / `-0` 归一（`value === 0 ? 0 : value` 镜像 L353）；
   唯一刻意差异（不重查宿主原型）与设计 §7.1-A-2 注记一致，且经结构论证成立（继承键在
   两通道键空间之外）。净化仅在 T1 三参调用**成功后**执行（L581→L586 定序亲核）。
2. **五键恒形 + 失败面零漂移**：两联合成功成员恰五键（runtime.ts L146–158/L160–172）；
   无 options 分支 `truncated:false` + 每调用新鲜 `[]` 字面量（L575–576，无共享常量）；
   三既有失败分支形状零变化（PATH 透传 L570/L582；readDisabled 仅提取共用
   `echoReadPath`，回显纪律逐字保持；RELEASED_ISSUE 原文未动）；`READ_OPTIONS_INVALID`
   为唯一新增失败分支，三来源同一四键形状。
3. **A-2b 双出口 / A-2c 登记豁免按设计落地且触发点唯一**：出口① 重派发（L592）、
   出口② `seamReadOptionsInvalid`（L597，全文件唯一调用点——grep 亲核）；返回类型注解
   `ReadLogicalValueBudgetFailure`（Extract 单源派生 L134–135），`echoReadPath` 与
   readDisabled 同纪律（L806–815），message 恒非空。
4. **两通道同预算贯通**：投影只吃 canonical（L602）；canonical（全新 plain 字面量，
   键集 ⊆ 两轴、值全 ≥0 有限整数）经 T2 `validateBudgetOptions`（L355–375 亲核：对象
   + 键集封闭 + 在场键 ≥0 整数）**结构性不可达 `SCHEMA_OPTIONS_INVALID`**；净化失败在
   投影调用之前短路，绝不经 `!resolved.ok → null` 收敛静默化（该收敛点代码原样保留）。
5. **文件范围**：git status 恰 15 个代码文件（9 改 + 6 新）= ALLOW 15 行一一对应；
   DENY（doc-runtime/vfsl/`readdata-schema-projection-fixture.ts`/docs 负控三件/docs/adr/
   CONTEXT/wire·复制·诊断/apps/yjs-server/既有行为套件）**零触碰**（grep 亲核）。
6. **测试质量**：主缝红灯契约（组 A–H 含 F-x1–F-x6）+ 负控 + 双类型锚 + registry 透传，
   全部经真实 runner 入口发现（vitest include/typecheck include 亲核）；无 skip/only/todo；
   断言为行为断言（键集 + 定点 + JSON 逐字节 + 计数器锚），非源码字符串断言。

MINOR 观测见第 12 节（均不阻断）。SA8 实现后复查（iteration 3）clear 且
requiresConflictRecheck=false，与本轮独立静态核验结论一致。

## 3. 上游要求落实

| Requirement or finding | Implementation evidence | Assessment |
|---|---|---|
| Issue What to build：五键组合 / 两通道同预算 / READ_OPTIONS_INVALID 公共联合 / lease 原样透传 | runtime.ts L551–606（双重载组合体）、L129–172（双联合 + options 别名）、registry types.ts L459–463 / lease.ts L286–299 | 全部落实 |
| AC1 五键恒形（预算 + 无预算空清单）；失败分支不动 | red A1–A3 + control 失败键集；`expectReadDataOkKeys` 五键常量（readdata-ok-shape.ts L31）；实现体 L571–577/L599–605 | 落实（红绿 + 负控形态） |
| AC2 两通道截断位置对齐（主缝断言） | red D1–D6（标记位 recipe 归一 + F-x1/x2/x3 延拓 + 弱断言分层）；实现 = canonical 单一预算贯通 | 落实 |
| AC3 width 触发时投影与无预算读逐字节相等 | red E1（toStrictEqual + JSON.stringify）；canonical 保留 `maxChildrenPerNode`（组合层不按轴名过滤） | 落实 |
| AC4 depth 尾段枚举语义 / omitted = 直接子项数 | red B1–B3（尾段键名断言 L220）、C1（2 ≠ 6 显式双断言 L251–252）、C2（width 父路径单条） | 落实 |
| AC5 READ_OPTIONS_INVALID（含未知键）公共失败分支；无 options 逐字节回归锚 | red F1 基础矩阵 14 例 + F2/F6/F7 定序 + F3 差分；control 独立预言机逐字节（doc-runtime 值 + vfsl 投影直调，L99–119） | 落实 |
| AC6 T0 helper 恰三键→五键 + lease 透传断言 | readdata-ok-shape.ts 五键单点修订（10 消费文件 git status 零手改——亲核）；registry passthrough 4 用例 + 真实装配 | 落实 |
| AC7 全套包门禁 + root typecheck/test | SA3 Verification 表（root `pnpm typecheck` 14 包 / `pnpm test` 350 文件 3841 测试全绿）；SA4 静态核对命令入口真实（root package.json L10–11、vitest.config.ts） | 落实（运行为 SA3 证据面；SA4 不复跑，列入第 11 节动态验证项） |
| SA2 F1（BLOCKER）required changes (a)–(e) | (a)–(d) = canonicalReadOptions 四纪律；(e) 两条失实论断未在实现面复现，JSDoc/注释按修订版不变量表述（L180–213） | 落实（见第 2 节结论 1） |
| SA2 M1（措辞精度） | 实现与测试仅断言可检测面（F-x5/F-x6），未声称键在场性交替被拒；设计文本修订属 SA1/Controller 面（SA3 §Deviation 登记一致） | 承接正确，非实现缺陷 |
| SA2 M2（门禁命令精度） | SA3 采用 `pnpm exec vitest run <路径>` + `tsc -p <tsconfig>`，覆盖面未缩小 | 落实 |
| SA2 N1/N2/N3/N4 | yjs-server DENY 零改（N1）；10 消费文件零手改（N2，git status 亲核）；helper schema 保持纯面 + 预算断言纪律（N3，预算测试零 `expectReadDataOk` 整形状断言、零 `as any`）；新 fixture 复制形态、原文件零编辑（N4，git status 亲核） | 落实 |
| SA8 实现后复查 §3 行 1–16 / §4 三 override / §5 冻结面 | 本轮独立静态核验：双联合五键（行 1）、零泄漏（行 2）、组合无第二读路径（行 3）、读纪律逐字对齐（行 4）、清单逐引用透传（行 5）、width 无操作（行 6）、值内形态单源（行 7）、三既有分支形状（行 9）、schema:null 单义（行 10）、lease 透传（行 11）、零 sequencer（行 12）、标记包装联合（行 13）、零 wire/诊断（行 14）、模块 AGENTS（行 15）、敌意三特性（行 16） | 逐行独立复核成立 |

## 4. 设计落实审查

| Design decision | Implementation location | Assessment | Finding |
|---|---|---|---|
| A-1 T1 单一校验权威（raw 原样入三参；失败成员原样透传） | runtime.ts L581–582 | 一致（零复制、零改写；`ReadLogicalValueFailure`/`ReadLogicalValueBudgetFailure` 均 Extract 单源派生） | 无 |
| A-2 接缝净化读纪律逐字对齐 T1 | runtime.ts `canonicalReadOptions`（L856 起）vs read.ts L326–361 | **逐行比对一致**（键空间/取值通道/收编/present-undefined/谎报键/整数判定/-0 归一七项全同；差异仅省 getPrototypeOf——设计注记在案） | 无 |
| A-2b 双出口（① 重派发单源收编 / ② 接缝终态） | runtime.ts L587–597 | 一致；出口②丢弃一次值读（敌意-only，读路径零副作用） | 无 |
| A-2c 接缝终态成员（D1 登记豁免 + Extract 类型锁 + echoReadPath + message 非空） | runtime.ts L597 唯一调用点 + L880–890 | 一致（grep 亲核全文件唯一触发点；类型注解 = L134–135 派生） | 无 |
| A-3 width 轴净化后原样保留 | canonical 两轴同写（L874–875 区域） | 一致 | 无 |
| B-1 lifecycle gate 先行（先于一切 options 读取与 doc 触碰） | runtime.ts L564–567 | 一致（gate 在 options 判别之前；F7 锚） | 无 |
| B-2 组合实现（S2a 逐字节两参 / S2b 三参 + 净化 + 五键组装） | runtime.ts L568–605 | 与设计 §7.2-B-2 代码块**逐句对应** | 无 |
| B-3 失败面冻结（四分支形状） | 见第 3 节；red F1/F6/F7 + control + registry released 键集断言 | 一致 | 无 |
| B-4 truncations 逐引用透传、零合成 | runtime.ts L603–604（逐字段）；grep 无第二清单构造点 | 一致 | 无 |
| B-5 schema:null 单义 + 预算非 schema 开关 | projection D3a 守卫位置零变化（L69–80）；H1/H2 共存断言 | 一致 | 无 |
| C-1/C-2/C-3 双联合 + 重载序（预算前/legacy 后）+ type-only 导出 +3 | runtime.ts L137–172/L214–219；index.ts +3（含 `ReadLogicalValueTruncationEntry` 转出） | 一致；`_legacyReturnType` 锁在 test-d 在场 | 无 |
| D-1 projectReadDataSchema 纯/预算双重载 + 显式分支（无 cast） | read-schema-projection.ts L57–93（`options === undefined` 显式两分支调两参/三参） | 一致 | 无 |
| D-2/D-3 detach + cloneValueSchema/Record 双重载 + 显式 `case 'truncated'`（10-case 无 default） | 同文件 L142–241/L257–276 | 一致（ValueSchema 恰 9 kind 亲核 derived.ts L44–53 + truncated = 10；clue 全新普通副本 + memo 统一 + 叶节点） | 无 |
| D-4 无预算读恒纯 | 纯重载链（legacy 实参静态 `ValueSchema` 命中纯重载）；type-d `_legacySchema` 锁 | 一致 | 无 |
| E-1/E-2/E-3 lease 透传 + 双重载 + `_readAlias` 原文保持 + 两新 Equal 锁 | types.ts L459–463/L672–679；lease.ts L286–299/L410–421 | 一致（released 先行 L291；raw 同引用直传 L293–294） | 无 |
| F-1/F-2 T0 helper 五键化（schema 纯面）+ scanner 常量随动 + gate 正负样本 | readdata-ok-shape.ts / scanner / gate diff | 一致（family A 超集判定零改动——L254–255 亲核；`readDataOk` 缺省参数、`expectReadDataOk` 独立内联、`READDATA_OK_KEYS` 五键字母序） | 无 |
| 设计 §7.7 否决项未复活 | grep 无 `readDataBudgeted`/共享冻结空数组常量/清单合成/单一联合签名/lease 层净化 | 一致 | 无 |
| 红灯机理（当前 HEAD 三键 + 第二参被忽略） | SA3 红灯运行记录（27 failed / 10 passed）；静态推断一致（旧实现单参三键） | 成立 | 无 |

## 5. 架构一致性与惯例

### 责任归属

| Behavior | Expected owner | Actual location | Assessment |
|---|---|---|---|
| options 拒绝语义 | doc-runtime（T1 单源） | runtime 只透传/重派发；未复制校验器 | 正确 |
| 接缝净化 | runtime 组合层（T2 §6.10 许可） | runtime.ts 包内 `canonicalReadOptions` | 正确（不导出） |
| 截断清单计数 | 值通道载体（T1） | 逐引用透传 | 正确 |
| lease | 纯代理 | released 先行 + raw 直传，零预算解释 | 正确 |

### 相似能力对照

| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
|---|---|---|---|---|
| 双结果联合 + 重载（零泄漏） | read.ts L94–131（T1） | runtime C-1/C-2、lease E-1 同款 | 一致 | 先例形态直接复用 |
| 敌意输入 descriptor 读 + try 收编 | read.ts L326–361 / read-schema-projection L114–132 | canonicalReadOptions 同款 | 一致 | F1 修订核心，逐行比对 |
| 接缝自构失败成员的 path 回显 | runtime readDisabled L671–679 纪律 | `echoReadPath` 提取共用（同纪律非新形状） | 一致 | 提取式重构零行为变化 |
| 投影三参入口消费 | resolve-schema-at-path L194–228 | projection D-1 显式分支 | 一致 | 无 cast 过重载 |
| typed stub 形状锁 | T0 helper（10 文件） | 五键化单点 + 缺省参数 | 一致 | T0 交付目的兑现 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| options 合法性 | T1 校验 | canonical（同一读纪律派生视图） | 确定性输入零漂移；非确定性输入不可检测交替 = 设计 §13 已登记残余（检测需 doc-runtime 暴露 `ValidatedBudget`，read.ts L303 非导出亲核） |
| 截断清单 / truncated | T1 结果 | 无（逐引用透传） | 无 |
| 失败成员形状 | doc-runtime 构造 | A-2c 接缝成员（唯一豁免点） | 低——Extract 单源类型注解编译锁 |
| 形状断言 | T0 helper 常量 | 10 消费文件 | 无（单点随动，git status 亲核零手改） |

### 生命周期对称性

读路径零资源获取/释放（零 sequencer、零缓存、零订阅——runtime.ts 组合体亲核无
sequencer 引用）；lifecycle gate 与 lease released 短路对称前置。无不对称项。

### 平行机制检查

| Candidate duplicate | Existing path | Actual path | Disposition |
|---|---|---|---|
| 第二读路径 / `readDataBudgeted` | — | grep 零命中 | 无平行 |
| runtime 复制校验器 / purify-then-forward / canonical 回喂 T1 | read.ts 校验器（非导出） | 备选 (α)/(γ)/(δ)/(ε) 均未出现（重派发传 raw，L592 亲核） | 无平行 |
| 清单合成 / 投影侧清单 | resolver 标记带内 | 逐引用透传 | 无平行 |
| lease 层净化 | runtime 接缝 | raw 直传 | 无平行 |

## 6. 文件范围审查

| Changed path | ALLOW entry | Purpose | Assessment |
|---|---|---|---|
| `packages/namespace-runtime/src/runtime.ts`（+279/−96 中主体） | 行 1 | 双重载 + 双联合 + 三包内 helper + JSDoc | ✅ 恰列内容 |
| `packages/namespace-runtime/src/read-schema-projection.ts`（+91） | 行 2 | 四函数双重载 + `case 'truncated'` + 头注 | ✅ |
| `packages/namespace-runtime/src/index.ts`（+12） | 行 3 | type-only +3 + 头注 | ✅ 值导出面仍恰一键（exports-audit 门不受影响——该门只断值键，亲核） |
| `packages/namespace-registry/src/types.ts`（+16） | 行 4 | 预算别名 + 双重载 + import | ✅ |
| `packages/namespace-registry/src/lease.ts`（+40） | 行 5 | 透传 + 字面量引用 + 2 Equal 锁（`LeaseTypeAssertions` 追加两成员——grep 亲核无外部值消费） | ✅ |
| `packages/namespace-registry/src/index.ts`（+1） | 行 6 | type-only +1 | ✅（registry-surface 九值键门不受影响——亲核） |
| `packages/namespace-runtime/test/helpers/readdata-ok-shape.ts` | 行 7 | 五键单点修订 | ✅ |
| `packages/namespace-runtime/test/helpers/readdata-shape-assertion-scan.ts` | 行 8 | 常量五键化 + 注释 | ✅ family A 判定逻辑零改动 |
| `packages/namespace-runtime/test/readdata-shape-assertion-consolidation-gate.test.ts` | 行 9 | 正负样本随动 | ✅ 三键 family A 保留为正样本（超集命中）、三键 family B 移入负样本——仪器敏感性语义正确 |
| 6 新测试/fixture 文件 | 行 10–15 | red / control / fixture / runtime test-d / passthrough / registry test-d | ✅ 全部在 ALLOW |

- **DENY 零触碰**：`git status --porcelain` 23 项 = 15 代码文件 + 8 wiki 输入；对
  doc-runtime/vfsl/apps/docs/CONTEXT/复制·诊断·wire/`readdata-schema-projection-fixture.ts`
  的 grep 过滤零命中（亲核）。
- **ALLOW 未列路径零改动**；无越界。

## 7. 契约连锁审查

| Contract | Caller | Actual handling | Risk | Finding |
|---|---|---|---|---|
| `NamespaceRuntime.readData` 属性类型（箭头函数 → 重载对象类型） | 全仓生产调用点 grep：`apps/yjs-server/src/app.ts` L609（单参，只读 ok/value——L610–611 亲核）；`ws-replication/src/testing.ts` L47（`.bind(lease)`——单签名可赋给重载目标：参数少收窄 + legacy ⊆ budget 返回协变）；`ws-replication/test/...issue287...` L325（单参属性读） | 全部命中 legacy 重载或可赋值 | 无 | 无 |
| 五键信封破坏性修订（仓内测试消费方） | 10 个 helper 消费文件 + `readdata-docs-adr0016-sync-control`（真实装配，经 helper 自动五键） | helper 单点随动；零手改（git status） | 无 | 无 |
| registry 测试替身 `readData: () => readDataOk(...)` | 10 文件 typed stub | ReadDataOkShape（纯面）⊆ 两联合成功成员（纯 ⊆ Budgeted 单向）——可赋值性静态成立 | 无 | 无 |
| `Extract` 谓词型测（runtime/registry data-interface、#273 red test-d） | 结构子类型加键不破坏 | 单参调用命中 legacy 联合 | 无 | 无 |
| `projectReadDataSchema`/`detach`/`clone` 加宽 | 唯一消费方 runtime.ts（grep 亲核） | 显式分支无 cast | 无 | 无 |
| `LeaseTypeAssertions` 追加成员 | grep 仅注释引用 | 加法 | 无 | 无 |
| docs 负控（`readDataOptionUsages`） | 只扫三份 SCOPE_DOCS（fixture L40–44 亲核） | runtime JSDoc 新增 `readData(path, options?)` 文本不在扫描面 | 无 | 无 |
| DSH 部署链 / T4 #337 / T5 #338 | 设计 §10/§13 登记 follow-up | 本票零义务 | 无 | 无 |

## 8. 错误、恢复与并发

- **零静默**：净化失败短路于投影调用前（L587），两出口均返回恰四键失败成员；red
  F-x5/F-x6 + D5 负断言（无 `ok ∧ schema:null ∧ truncated` 组合）锚定。
- **零外抛**：canonical 整体 try（L884 收编）+ T1 E100 顶层 try 双保险（read.ts L132/L230
  亲核）；`InternalError` 仍是唯一逃逸 throw（projection resolver 调用零新增 catch——亲核）。
- **零洗白**：canonical 不回喂 T1（重派发传 raw L592——备选 (δ) 未复活）。
- **定序**：lifecycle > G0(path) > options > 游走/投影 > 成功——F6/F7 锚与 T1 V1/V2 一致。
- **敌意 trap 全景**：stateful/alternating descriptor（F-x5/F-x6 计数锚 4/5 与
  `Object.keys` 的 spec 级 enumerability 探测（每 own key 一次 `getOwnPropertyDescriptor`）
  + 显式 descriptor 读的调用序列**静态推演一致**）；descriptor/get 分叉 Proxy 双盲对齐
  （D5 getCalls()===0）；非 enumerable/继承键双盲（D3/D4，后者 try/finally 还原原型污染）。
- **并发/幂等**：全同步、零 sequencer 槽位、调用局部状态（新鲜 `[]`/新鲜累加器/每调用
  新鲜 canonical 与 detach 副本）；同参确定性输入逐字节确定。非确定性敌意 options 的
  不可检测交替 = 设计 §13 登记残余，实现未伪装闭合（诚实）。
- **重派发副作用边界**：敌意 options trap 可在校验期执行任意 JS（含变异 doc）——最坏
  使重派发返回 T1 合法失败成员（含 PATH_NOT_ALLOWED），属既有暴露面（设计 ER-7 登记），
  返回面仍为预算联合合法成员。非新增风险。
- **detach 纪律**：control 断言连续读引用互异（含 marker.clue）、mutation 不污染、不冻结。

## 9. 测试质量审查

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
|---|---|---|---|---|
| `runtime-readdata-shape-budget-red.test.ts`（组 A–H） | 五键恒形/B14；depth 省略 + 尾段键名 + depth:0 骨架；omitted 2≠6；两通道位置集相等（归一 recipe + F-x1/2/3 延拓 + 闭包弱断言）；width 逐字节；F 矩阵 14 例 + 差分 + `{depth:undefined}` + 定序 F6/F7 + F-x5/x6 计数锚；零物化哨兵（G1 预算 ok ∧ 无预算响亮失败）；schema:null 共存 | `vitest run`（include `packages/*/test/**/*.test.ts` 亲核） | `ok()`/`failure()` 前提断言 loud throw——无假绿通道；无 skip/only | 无 |
| `runtime-readdata-shape-budget-control.test.ts` | 无 options 逐字节回归（doc-runtime + vfsl 双预言机，JSON 逐字节）；失败键集；敌意 path 预算对偶（schema:null、ok 恒真、零 throw）；detach 三性质 | 同上 | 预言机独立于被测组装（#273 形态） | 无 |
| `runtime-readdata-shape-budget.test-d.ts` | 五键 keyof 精确集 ×2、schema 类型 ×2、零泄漏双向、失败面无新键 ×2、重载序、options 别名、`@ts-expect-error` 反向锁 | `vitest --typecheck`（include `packages/*/test/**/*.test-d.ts` + tsconfig.typecheck 覆盖 `packages/*/test/**/*.ts`——亲核） | 声明期证明 + export type 断言对象 | 无 |
| `registry-readdata-budget-passthrough.test.ts` | 同一引用捕获（path/options）、argc===1 legacy 通道、敌意 options lease 层零触达（trap 计数 0）、released 先行冻结单例 + 零 runtime 触达、真实装配逐字段相等 | 同上 | 记录型 fake + 真实 runtimeFactory 双面 | 无 |
| `registry-readdata-budget-passthrough.test-d.ts` | 别名组合等式、released 成员、五键 ×2、零泄漏双向、失败面、重载序 | typecheck | 同上 | 无 |
| gate（随动） | family A/B 归零 + 仪器敏感性正负样本（五键 family A/B 正样本、三键 family A 仍正样本〔超集〕、三键 family B 负样本） | 同上 | 断言语义不变，未弱化 | 无 |
| 红灯真实性 | SA3 记录实现前 27 failed / 10 passed，失败原因 = 恰三键/第二参被忽略/哨兵整读——与旧实现行为静态推断一致 | — | — | 无 |

**断言纪律核验**（N3）：预算读结果只用 `expectReadDataOkKeys` + 定点断言——red/control
全文 grep 无 `expectReadDataOk` 用于预算投影、无 `as any`（唯一 cast 为敌意通道单点
`asOptions` 与真实装配冗余 cast，均不改值不吞错）。**fixture 隔离**：每用例独立
MemoryPersistence + Y.Doc；F-x2 原型污染 try/finally 还原。

## 10. Required revisions

无 BLOCKER / MAJOR / MINOR 级阻断项。下表为空。

| Finding ID | Severity | Evidence | Problem | Required change | Acceptance | Suggested routing |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — |

## 11. 后续动态验证项

| Risk | Driver | Expected observation | Failure condition |
|---|---|---|---|
| SA3 报告的全量绿（root `pnpm typecheck` 14 包 / `pnpm test` 350 文件 3841 测试；包级 95 文件 864 测试）为运行时证据，SA4 未复跑 | Controller/SA7 复跑门禁 | 全绿、Type Errors no errors | 任一既有套件因五键化转红（即集中化遗漏或 stub 不可赋值） |
| F-x5/F-x6 descriptor 调用计数锚（4/5）依赖 `Object.keys` 对 Proxy 的 spec 级 enumerability 探测（每 own key 一次 `getOwnPropertyDescriptor`） | 包级定向复跑 | 计数恰 4/5 | 引擎差异导致计数漂移（spec 上不应发生；若发生需改为区间断言并登记） |
| `readdata-docs-adr0016-sync-control` 真实装配行为锚在 T3 后自动绿（运行时五键 + helper 五键） | 包级复跑 | 绿 | 红 = 真实 registry 装配与 runtime 直调漂移 |
| 重派发路径（出口①/②）在全套件下的性能与稳定性（敌意-only，无正确性风险） | 观测项 | 无超时/无泄漏 | — |

## 12. Non-blocking observations

1. **死导入（修饰性）**：`runtime-readdata-shape-budget-red.test.ts` L21 与
   `-control.test.ts` L14 的 `import * as Y from 'yjs'` 无使用点（grep 亲核零 `Y.`）。
   tsconfig 未开 `noUnusedLocals`，不影响门禁；后续顺手清理即可。
2. **冗余 cast（修饰性）**：passthrough 真实装配用例 L213
   `lease.readData([], { depth: 1 }) as NamespaceLeaseReadDataBudgetResult`——双重载已使
   双参调用命中预算别名，cast 非必需；不改值不吞错。
3. **测试收尾纪律**：新测试在断言失败路径上不 `close()` runtime（仅成功路径收尾）——与
   既有 projection-red/fixture 套件风格一致（亲核 L114–204 同款），非本票引入的弱化。
4. **文档面滞后为已登记 follow-up**：`cordis-plugin-hosting.md` 形状注记与
   `readDataOptionUsages` 正则仍处三键/禁带参时代（sync-red 测试 L97 文案含「恰三键」）——
   本票 DENY 明令不触（T5 #338 面_SA8 §6 同裁）；合并顺序上 T3 先行会产生已知窗口期，
   由 #338 兑现闭合,非实现缺陷。
5. **M1 措辞遗留**（SA2 M1 / SA8 §8-1）：设计文本「键集漂移已全部响亮拒绝」的收敛仍属
   SA1/Controller 面——实现与测试行为均按修订语义（仅可检测面响亮失败），无行为偏差。
6. **版本 bump**（runtime 0.1.12→0.1.13、registry 0.1.10→0.1.11）属发布流随动（设计 §13
   钉死非代码面）——合并时由发布流兑现，SA3 未改 package.json 正确。

## 13. 结语

实现与批准设计（SA2 approve 版）逐点对应：F1 修订面（读纪律逐字对齐 + 双出口 + 类型锁
+ 唯一触发点）、五键恒形、零泄漏双联合、两通道 canonical 单预算贯通、lease 原样透传、
T0 单点修订、文件范围 ALLOW/DENY 精确、测试为真实行为断言且经真实 runner 入口发现。
SA8 实现后复查（iteration 3，clear / requiresConflictRecheck=false）与本轮独立静态核验
互证。无阻断项，**approve**。
