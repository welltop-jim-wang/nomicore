# SA10 Spec 审查 — Issue #335 `[shape-budget] T2: 投影通道形状预算——解析入口三参化与截断标记`

- 派发：`sa-ff84501b-fa87-47d3-9fc5-4468cded2af5`（role `mabf-sa10`，phase `spec-review`，iteration 0）
- 审查对象：**已提交最终 diff** `ba11f32..c903ac5`（branch `mabf/issue-335`，工作树干净）——
  tracked：`packages/vfsl/src/resolve-schema-at-path.ts`（+407/−36）、`packages/vfsl/src/index.ts`（+24/−2）；
  新增：`packages/vfsl/test/resolve-schema-at-path-budget{,-fixture,-control}.test.ts`、
  `resolve-schema-at-path-budget.test-d.ts`（4 文件，63 用例：47 运行时 + 8 负控 + 8 类型面）+ `wiki/raw/task_issue-335*` 任务件。
- Issue comments：REST 读取 `[]`（派发确认）——无 Owner 评论 override 可应用；全部义务 = Issue 正文
  「What to build」+ AC1–AC5 + SA6 契约 + ADR 0024 决策 5。
- 方法：spec 符合性静态审查（本角色不运行测试/服务、不改任何文件）——Issue 正文逐句映射、AC1–AC5 逐项
  对实现与断言面核验、SA6 契约 G0–G10 落点核对、ADR 0024 决策 5 与 CONTEXT 词汇符合性核对、可选环
  （optional-cycle）处置独立重放、改动面/DENY 面 git 实测、冻结摘要逐字对账。门禁绿色性采用证据链
  （SA3 动态实跑 + SA4 静态对账），本报告不重跑。

## Verdict

**approve** —— Issue 正文「What to build」全部要素与 AC1–AC5 在最终 diff 中忠实落地；SA6 契约断言组
G0–G10 的落点全部在场且未弱化；ADR 0024 决策 5 的三参化/标记选型/计层规则/width 无操作/逐字节承诺
逐项符合；SA4 R1（optional 透明环截断谓词不终止）修复忠实、环语义与设计 §6.3.5 严格一致。无遗漏、
无部分实现、无错误实现、无 scope creep。须随 PR 披露的边界项（aliases 加宽、新失败码、脊柱键 pin、
SA6 矩阵算术修正、fn.length）均已被上游 SA8 实现后复审逐格裁定并登记（§6）。

---

## 1. Issue 正文「What to build」逐句映射

| 正文要素 | 实现落点 | 判定 |
|---|---|---|
| `resolveSchemaAtPath(derived, path, options?)` 加法三参化（ADR-0024 决策 5） | 重载签名 `resolve-schema-at-path.ts` L194–207（两参在前保纯度；实现签名三参）；`options !== undefined` 分叉 L220 | 符合 |
| valueSchema 与值同 depth 截断 | `BudgetWalk.render` 计层表 L462–546：object/array 各耗一层（`budget-1`）、`budget===0` 先于一切子位触达；终点以完整预算起算 L315（计层原点 = 路径终点，游走段不进预算） | 符合 |
| 截断处放投影层截断标记（投影包装联合，不扩展 ValueSchema 语义联合） | `SchemaTruncationMarker{kind:'truncated',clue}` L82–85 + `BudgetedValueSchema = ValueSchema \| SchemaTruncationMarker` L88；`derived.ts`/`evaluate.ts` 零 diff、`'truncated'` 在二者 grep 0 命中（实测）；九 kind 联合原样（derived.ts L44–53） | 符合 |
| 标记携带成员级类型线索（ref 名优先，无 ref 名时容器 kind） | 线索嵌套判别联合 `SchemaTruncationClue` L72–74：`{via:'ref',name}` / `{via:'container',containerKind:'object'\|'array'}`；ref 位标记 L519、容器位标记 L465/L485 | 符合（嵌套判别避免别名恰好命名 `object`/`array` 的二义——设计 §6.4 pin） |
| 别名传递闭包在同一次遍历内随展开层收缩 | walk 内 `closureNames`/`closureOrder`/`closureEntries`：仅 budget≥1 的展开 ref 登记（L521–530），被裁 ref（b=0）不查 `values`、不登记 ⟹ `{depth:0}` 恒不触达别名体；发现序 = DFS 序 | 符合 |
| docs/aliasDocs 注释切片在同一次遍历内随展开层收缩 | 渲染位集 `emitted` 随 walk 单次遍历产出；选键 `want = spine.has(k) \|\| walk.emitted.has(k)` 精确匹配（L322–326）；标记位及其后代零 emit（先裁后 emit + `isTruncated` 剥离 optional 判定 L473/L488/L501） | 符合 |
| 计层规则——discriminated/literal union 透明、ref 为终态边界 | union 同 `budget` 透传且宿主位永不整位标记（L492–509）；optional 同 budget 同 path、包装保留（L511–516）；enum/pattern/scalar/xml 终态 no-op（L534–544）；ref 终态边界（L517–533：b=0 → ref 位标记；b≥1 → 体以**同 b** 渲染、名集先登记终止） | 符合 ADR 0024 L81 与 CONTEXT L42 |
| width 对投影无操作 | `validateBudgetOptions` 只返回 `depth`（L355–371）——`maxChildrenPerNode` 校验（≥0 整数）后弃用，walk 不接收、不比较、不计数 | 符合 ADR 0024 L74/L125 |
| 无 options 时行为逐字节不变 | 分支隔离：`budgeted=false` → 既有三步（合成 → `collectAliasClosure` → `sliceDocs`）逐字运行（L297–309）；`sliceDocs` 仅参数化 `want` 谓词——`noBudgetWant`（L553–570）与 ba11f32 版内联谓词**逐字相同**（git show 对账）；扫描序/三源合并序/空过滤/memberDocs 稀疏兼容未动（L820–866） | 符合 ADR 0024 L29/L103 |

## 2. 验收标准逐项核验（AC1–AC5）

### AC1「同 depth 下 valueSchema 截断标记位置正确，标记携带 ref 名或容器 kind（vfsl 单元面）」— **达成**

- 位置 = 被裁位置的类型位：`BUDGET_MARKER_MATRIX`（fixture L140–270）10 路径 × depth {0,1,2,3,4,9}
  逐格断言标记集合**精确相等**（`G3.1/G3.5`，budget.test.ts L187–199）——多标/少标/仅弱断言均红；
  union 成员位按 `<member N>` 索引寻址（`['inlPair']` d0、`['u','x']` d0 合成 union 终点 L1001–1010）。
- 线索：ref 位 → ref 名全等（`['assets','img1']` d0 → `ref:AssetEntity`，`['audit']` d0 → `ref:Audit`，
  L259–297）；容器位 → object/array 可区分（`[]` d0 → container:object、`['modes']` d0 → container:array，
  L330–344）。
- 反例锚：无预算读恒零标记（G3.1，L201–207）；`[]` d=0 终点折叠为单枚位置标记（非骨架呈现——
  设计 Q2 pin，CONTEXT L42「截断处的类型子树以投影层截断标记呈现」一致）。

### AC2「别名闭包随展开层收缩；被裁路径的 docs/aliasDocs 切片省略」— **达成**

- 闭包精确集：预算夹具 `[]` d0/d1 `{}`、d2 `{Ledger,Pair,Mode}`、d3 +`Audit`、d4 全量（G4.1，
  L379–397）；#272 `['assets','img1']` d0 `{}` → d1 `{AssetEntity}` → d2 `{AssetEntity,Audit}`
  （L399–421）；展开 ref 的闭包条目与无预算读同名别名**引用相等**（`toBe`，L419–420）。
- 切片省略：docs/aliasDocs 精确键集矩阵 `BUDGET_DOCS_MATRIX`（fixture L291–383）逐格断言
  （G5.2，L461–471）——含脊柱键保留 pin（`['shallow']` d0 → `{ROOT.shallow}`；`['shallow','audit']`
  d0 双脊柱位保留）、被裁别名无 aliasDocs（#272 d1 `{AssetEntity}` 缺 Audit，L489–506）、
  切片 ⊆ 无预算且共享键逐字相等（G5.1，L473–487）、不发明新键（G5.3，L508–518）。
- 先裁后收集的行为级证明：毒化哨兵 `{depth:0}` ok vs 无预算读 `throw InternalError` 差分
  （G4.4，L433–455；#272 型三态 d0 ok / d1 ok / d2 throw）。

### AC3「union 透明 / ref 终态的计层规则符合 ADR；width 不影响投影（width 触发时投影与无预算读一致）」— **达成**

- 计层对偶：optional 透明孪生（opt/req 同 depth 裁切、包装保留，G2.2 L209–226）；union 透明 +
  去 union 孪生同 depth 裁切（G2.3 L228–244）；enum 终态不计层不产生标记（G2.4 L246–257）；
  ref 终态边界不内联（G2.5）；终态终点任意 depth no-op（G2.6 L299–308）；depth 单调前沿下移
  不跨层跳变（G2.7 L310–328）。
- width 无操作：width-only（k ∈ {0,1,3,1000}）全部路径与无预算读 `JSON.stringify` **逐字节相等**
  （G6.1，L524–533）；`{depth,maxChildrenPerNode}` ≡ `{depth}`（G6.2，L535–547）；非法 width 走
  options 失败面不静默忽略（G6.3，L549–556）——负控表注「今日相等不得作绿灯」的处置正确：断言在
  预算真实生效的实现上重验。
- SA6 §12.4 矩阵算术漂移（`['u']` d=2）按设计 §6.3.4 修正格断言（L989–999）——SA6 §1/§12.4 明文
  授权 SA1 确认或改写，G0.2 oracle 独立对账（control L108–161），SA2 重放确认、SA8 已核。

### AC4「投影包装类型进入投影契约公共面；无 options 逐字节回归锚全绿」— **达成**

- 公共面：6 新类型（`BudgetedValueSchema`/`SchemaTruncationMarker`/`SchemaTruncationClue`/
  `ResolveSchemaBudgetOptions`/`BudgetedReadDataSchemaProjection`/`BudgetedResolveSchemaAtPathResult`）
  + 1 守卫（`isSchemaTruncationMarker`）只经 `packages/vfsl/src/index.ts` 出口（diff 实测 L138–148）；
  类型面断言全部从 `../src/index.js` 导入（test-d L12–24）。
- 纯度：两参重载结果恒 `ResolveSchemaAtPathResult`（`valueSchema`/`aliases` 纯 `ValueSchema`，
  `@ts-expect-error` 锚定标记不可达，test-d G1.1/G1.3）；九 kind 冻结（G1.4）；预算面容纳标记
  成员（G1.5）；缺省实例化逐字段同型（G1.2）。
- 逐字节锚：#272 14 路径冻结前缀与 SA6 §13.5 **逐字对账一致**（control L79–94，14/14 相符）+
  预算夹具 17 摘要（G0.4/G8.1）；显式 `undefined` ≡ 缺省（G8.2）；充足 depth ≡ 无预算（G8.3，
  含 #272 14 路径含两枚失败码 L709–731）；零跨调用状态（G8.4）；M4 型 23 键基线 + 零标记三态
  （`{}`/充足 depth/width-only）逐字节差分（F2 锚 L736–783）。

### AC5「全套包门禁 + root typecheck/test」— **达成（证据链）**

本角色不运行测试；采用 SA3 动态实跑证据 + SA4 静态对账，且本审查对账目算术独立复核一致：

| 门（SA6 §12.6） | SA3 证据（iteration 1） | 算术复核 |
|---|---|---|
| `pnpm exec tsc -p packages/vfsl/tsconfig.json` | exit 0 | — |
| vfsl vitest `--typecheck --passWithNoTests=false` | exit 0；40 files / **714 tests**；0 type errors | 651 基线 + 63 新（47+8+8）= 714 ✓；37+3=40 ✓ |
| root `pnpm typecheck`（14 project） | exit 0 | 含 namespace-runtime 两参消费 + 逐 kind 穷举拷贝零改动（该包零 diff 实测） |
| root `pnpm test`（全部包 + `--typecheck`） | exit 0；341 files / **3651 tests**；0 type errors | 3588+63=3651 ✓；338+3=341 ✓ |

新文件命名命中 `vitest.config.ts` include/typecheck.include 既有 glob（与既有同目录同后缀文件同型）；
运行时红灯文件动态接缝纪律保持（顶层不静态 import 新名目，守卫经 `(vfsl as unknown)` 取，L360–363）。

## 3. SA6 契约断言组落点核对（G0–G10）

| 组 | 落点 | 判定 |
|---|---|---|
| G0 前提/oracle | control 全文件：G0.1 五表在场、G0.2 层结构字面量对账（独立 oracle）、G0.3 毒化前提、G0.4 冻结摘要 + 键序（ok 恰五键/失败恰三键） | 在场 |
| G1 类型面 | test-d 8 用例（G1.1–G1.5 全覆盖）+ 运行时守卫判别（budget L359–373） | 在场 |
| G2 计层 | G2.1（矩阵逐格）/G2.2/G2.3/G2.4/G2.5/G2.6/G2.7 逐条有用例 | 在场 |
| G3 标记 | G3.1（iff 裁切 + 无预算反例）/G3.2/G3.3/G3.4（derived 零变异 + 九 kind 扫描）/G3.5（精确集） | 在场 |
| G4 闭包 | G4.1 精确集/G4.2 净体引用相等/G4.3 递归别名终止可序列化（已按 SA4 观察 2 强化为非恒真）/G4.4 越界哨兵三态差分 | 在场 |
| G5 切片 | G5.1 ⊆+共享键逐字/G5.2 精确键集 + 被裁省略/G5.3 不发明键 | 在场 |
| G6 width | G6.1/G6.2/G6.3 | 在场 |
| G7 options 校验 | `{}`≡无预算/非法矩阵（含 present-undefined、NaN、±∞、未知键）/次序（path 胜、options 先于 derived 与游走）/合法预算恰五键无回显/敌意 getter/Proxy 收敛不泄漏 | 在场 |
| G8 逐字节锚 | G8.1 冻结摘要/G8.2 显式 undefined/G8.3 充足 depth/G8.4 交错无状态 | 在场 |
| G9 门禁 | G9.1 改动面（git 实测 ⊆ ALLOW）、G9.2/G9.3（§2 AC5 证据链）、G9.4（skip/only/todo grep 0 命中、无源码字符串断言——断言全经运行时返回结构）、G9.5（变异复核归 Controller；SA3 已抽查 D1/D2/D5 + R1 修复前实跑红） | 在场/证据链 |
| G10 跨票对账 | 可复用 oracle（矩阵 + G0.2 + 环语义 oracle）+ T3 归一化 recipe/options 规则集对齐前提已写入 SA3「T3 前提交付」四件 | 前提已交付（组合验收属 #336，非本票义务） |

## 4. 可选环（optional-cycle）处置核验（派发指定复核项）

SA4 R1（MAJOR）：`isTruncated` 的 optional 剥离循环对手造 optional 自环/2-环不终止。核验结论：**修复忠实、语义正确、回归足额**。

- **修复机制**（L404–413）：剥离链按**节点对象身份**去重，`stripped.has(current)` → `return false`
  （未截断）并终止。语义与设计 §6.3.5 严格一致——透明环任意预算下首次重入即由 walk 的进行中集
  **透传原节点引用**（L453），环上不可能存在标记 ⟹ 「未截断」是唯一正确且可终止的判定。
- **独立重放**：自环 `cycle.value=cycle` 两步重访即 false；2-环 `a→b→a` 三步重访即 false；无环线性链
  每节点至多出现一次 ⟹ visited 集对既有输出零影响（G2.2 d0 精确形态断言保持为证）。
- **纪律保持**：不拒收输入、不新增 throw（修复体仅 Set add/has）、零跨调用状态（调用内局部 Set）。
- **回归覆盖**：`optionalRingDerived`/`optionalTwoCycleDerived` 把同一环节点布在截断谓词**全部三个
  调用点**（object 字段位 `x` / array `<item>` / union 成员位）+ 闭包体内环（`RingAlias.self`）；
  `expectOptionalRingProtocol`（L821–887）四态（`{depth:0}`/`{depth:N}`/`{}`/width-only/显式 undefined）
  断言终止且 ok、无裸异常（结算检查 `result===undefined` 即红）、`{}`/充足 depth 与无预算读**引用级**
  同构（环状输出不可 stringify，用 `toBe` 引用相等——观察 5 纪律遵守）、`{depth:1}` 有界壳形态
  （环位透传 + array/ref 位标记）、重复调用逐引用确定。
- **红/绿证据**（SA3）：修复前两用例外部 timeout 强杀 exit 124（挂起=红）+ 最小探针定位（无预算 ok /
  预算 `{depth:1}` 不返回）；修复后 47/47 绿。挂起型红的 CI 呈现已由 SA4 §11.3 如实记录（缺陷类固有）。

## 5. 改动面与越界核对（scope creep）

- **ALLOW**：diff 仅含 2 src + 4 新测试/夹具（git `--name-status` 实测）+ `wiki/raw/task_issue-335*` 任务件
  （Host 流程产物，与 task_228 等先例同款，非产品面）。
- **DENY 零触碰**（git 实测）：`derived.ts`/`evaluate.ts`/`validate-patch.ts`/`resolve.ts`/`pattern.ts`、
  既有 8 测试/夹具（`resolve-schema-at-path{.test,-control,-member-docs,-member-docs-control,-pattern-errors,.test-d,-fixture,-member-docs-fixture}.ts`）、
  `packages/doc-runtime|namespace-runtime|namespace-registry|vfsl-protocol/**`、`docs/**`、`CONTEXT.md`、
  `packages/vfsl/AGENTS.md`、`.github/**`、`vitest.config.ts`、`tsconfig*.json`、`package.json`。
- **负控**：新测试文件 `readData(` 0 命中（registry 文档负控不触发）；`'truncated'` 在 `derived.ts`/
  `evaluate.ts` 0 命中（九 kind 冻结面）。
- **游走段零 diff**：路径游走（drillStep/matchValueCandidate/matchValueNode/acceptRecordSlot）与
  `collectAliasClosure` 本体逐字保留（diff hunk 边界 + 全文判读）——预算读与无预算读在同一
  (derived, path) 上 throw 行为一致；`sliceDocs` 重构为纯参数化（`noBudgetWant` 与旧内联谓词逐字相同，
  git show 对账）。
- **唯一生产消费方**：`namespace-runtime/read-schema-projection.ts` L56 两参调用零改动（grep 全仓
  确认唯一）；第一重载保纯度，其逐 kind 穷举拷贝编译面不受染。

## 6. PR 必须披露的未达成/边界项（均已在上游裁定登记，非新增缺口）

| 项 | 性质 | 处置状态 |
|---|---|---|
| `aliases` 字段类型在预算读下随 `valueSchema` 同步加宽（`Record<string, BudgetedValueSchema>`）——超出 ADR 0024 L77 仅点名 `valueSchema` 的字面 | override 范围申报 | SA8 实现后复审 §4 第三行裁定：L81 一一对应承诺 + #331「值语义子树同预算截断」在 ref 按名引用/闭包自包含结构下的**必然结论**，在授权域内（implements-existing-decision）；建议随既有排期的 ADR 0016 回填批注显式登记（非阻塞） |
| 新稳定失败码 `SCHEMA_OPTIONS_INVALID`（判别联合、同步不抛、path 新鲜副本） | ADR 未钉死位的 SA1 收口（前置门禁 §8.3 预留） | SA8 实现后复审 #7 确认；即起为兼容行为；与 readData 接缝 `READ_OPTIONS_INVALID` 的分工已写入 T3 前提 |
| docs 脊柱键保留 pin（被裁终点位自身的在册键保留，如 `['shallow']` d0 的 `ROOT.shallow`） | ADR 0024 L73 延伸决定的边界 pin | SA8 实现后复审 #9 no-conflict；建议随回填批注一句定格 |
| SA6 §12.4 矩阵 `['u']` d=2 算术漂移修正 | SA6 §1/§12.4 明文授权 SA1 确认或改写 | 设计 §6.3.4 + G0.2 oracle 独立对账 + SA2 重放 + 测试锚（budget L989–999） |
| `fn.length` 2→3 | 加法第三参的固有结果；ADR「签名逐字不变」指调用形态与行为 | 设计 §6.8 尾注如实记录；红灯机制以行为差分为断言不受影响 |
| T3 前提交付（非本票验收面） | 跨票谱系分工 | 归一化 recipe、options 规则集对齐前提（含 present-undefined 拒收）、计层/环语义 oracle、`isSchemaTruncationMarker` 守卫均已交付（SA3 §「T3 前提交付」） |

## 7. MINOR 观察（不阻断 approve）

1. **#272 `['audit']` d=0 的 docs 脊柱保留无专属用例**——同一 pin 已由预算夹具 `['shallow']` d0
   （`{ROOT.shallow}`）与 `['shallow','audit']` d0（双脊柱位）两格等价锚定；属覆盖精度观察，非缺口。
2. **union 宿主位 docs 键保留 pin**（SA2 N1 自由度）：实现选择「宿主位照常 emit/保留」（union 永不
   整位标记），预算夹具新增可观察位 `inlPair` 并在 docs 矩阵定格（`[]` d1 → `{ROOT.inlPair}`）——
   pin 已显式断言，与设计 §6.10 多重标记语义一致。
3. **假想裸键 `'ROOT'` 在 `[]` d=0 下省略**（SA2 观察 3 对偶边）：两夹具均无该键、零可观察位，
   机械规则自洽（G5.1 ⊆ 与零标记等价均成立）——记录在案。
4. SA4 §11 观察 1/3/4（浅层包装静态可见性——T3 detach 须经守卫运行时判别；`in` 判别与无 own 键
   options 放行——设计 pin/readData 先例一致）跨轮 carried，无实现偏差。
5. 挂起型回归在 CI 无外部 timeout 时表现为作业级超时（SA4 §11.3）——缺陷类固有，非验收要求。

## 8. 审查约束声明

- 本角色不运行测试/服务（角色禁令）：AC5 门禁绿色性采用 SA3 动态实跑证据（§Verification 表）+
  SA4 静态对账 + 本审查的算术/范围/锚值独立复核（714/3651 用例算术、14 路径冻结前缀逐字对账、
  diff numstat 与 SA4 申报一致 +431/−38、DENY 面 git 实测）。四命令动态复跑与变异敏感性终态
  （SA6 §12.5 D1–D9）归 Controller 后续安排，非本票未达成项。
- SA8 前置门禁（clear）与实现后复审（clear，14 项对照 8 implements + 6 no-conflict、0 hard-conflict、
  `requiresConflictRecheck=false`）已对本 diff 的全部 ADR 冲突面闭合；本报告不复述其裁定细节，
  仅核对披露项与实现事实一致。

---

**结论**：Issue #335 正文与 AC1–AC5 在最终 diff `c903ac5` 中完整、忠实实现；可选环（optional-cycle）
处置正确且回归足额；无遗漏、无部分实现、无错误实现、无 scope creep；须披露的边界项全部已在上游
裁定登记。裁决：**approve**。
