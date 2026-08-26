# SA2 攻击评审报告

**Date**: 2026-08-25
**Verdict**: **reject**（攻击点 #1 CRITICAL、#2 HIGH、#3 HIGH 需 SA1 修订设计后重新评审；#4–#7 为裁决/确认/非阻塞项）
**被审对象**: `wiki/raw/task_namespace-runtime-registry-seam-rev1_design.md`（SA1 R0，395 行）
**评审输入**: 修订简报 + SA8 相关决议（ADR 基准 + N1–N8/RN1–RN8）+ SA8 冲突报告（verdict: clear，转交非阻塞发现 1–4）+ SA6 冻结资产（rev1 测试 19 it + fixture 树 19 文件，均盘上实测核对）
**ADR 约束基准**: ADR 0009 L18「模块边界测试限制该 internal subpath 只能由 Registry 生产代码消费」+ L18 首句「Registry 通过 `@nomicore/namespace-runtime/internal` 唯一导出的 `createNamespaceRuntimeForRegistry` 构造生产 Runtime」+ §公共 Interface「测试 seam 只位于受控 testing subpath」；ADR 0008 全部冻结面经 `src/**` 零改动结构性保持（本轮不触，审查确认属实）。

## 评审方法与实测证据基线

本轮全部攻击点均经 worktree 实测验证（非纸面推演）：

- `node -e path.relative` 三方案对照：三根模式 relPath = `namespace-registry/src/registry.ts`（`packages/` 段剥离）；fixture 根 / 单根 REPO_ROOT 模式 = `packages/namespace-registry/src/registry.ts`（带段，谓词可命中）；
- 旧 AC5 实现（`runtime-registry-internal-seam.test.ts` L317/370，Round 1 已落地当前绿）read 校对：relPath 计算是 `path.relative(REPO_ROOT, full)`——**基准与谓词前缀对齐**；
- `find` 实测：仓内 test/tests/__tests__ 目录 8 个全部在包级（`packages/*/test`、`domains/vfs3-assets/test`），**无一在 `src/` 子树内**；
- `git grep -nE "\.\s*require\s*\("` 生产树零命中；`find -iname` 大小写变体段仅存在于 fixture 树内部；
- 设计 F1–F13 抽查（F2 it 行号 L102/117/125/145/194/374/379/388、F5 69 文件全 .ts、F6 消费面仅 README/注释、F7 require 零、F8 fixture 19 文件、F13 apps 仅 README、vitest/聚合 tsc include glob）：**全部属实，无虚报**。

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| 1 | **CRITICAL** | §D-A/§D-D relPath 基准 vs §D-C 谓词前缀（SA8 转交发现 1，裁决：**攻击成立，必须修订**） | 默认 `scanRoots = REPO_ROOT/{packages,domains,apps}` 三根 + `path.relative(root, file)` 相对**扫描根** → 真实门禁下未来消费方 `packages/namespace-registry/src/registry.ts` 的 relPath 为 `namespace-registry/src/registry.ts`（`packages/` 段被剥离，path.relative 实测确认）→ 谓词① `startsWith('packages/namespace-registry/src/')` 永假 → 必入 violators。**默认门禁配置下 allow 集合结构上为空**，ADR 0009 L18 首句授权的 Registry 生产构造路径不可达。详析见下文「发现 1 深挖」。 | 方案 A（推荐）：默认扫描根改单根 `REPO_ROOT` + walk 顶层目录过滤（仅进 packages/domains/apps，其余顶层剪枝）——「relPath 相对各自扫描根」统一语义完整保持，扫描面与三根方案逐文件等价（今日 69 文件不变），existsSync 过滤可删。方案 B：三根保持，默认模式 relPath 改 `path.relative(REPO_ROOT, file)`（恢复 R1 基准），但须文档化双模语义。两方案均零触碰 19 it 与 fixture 树（实测核对：fixture 显式 roots 行为不变；真实门禁两 it 仅断言 prodFiles>0 + violators=[]，无路径常量）。同步修订 §4 R6 缓解声明、§6 增补 P7（见 #5） |
| 2 | **HIGH** | §D-D SKIP_DIRS vs §D-C NON_PROD_SEGMENTS 交集冲突（SA8 转交发现 2/张力 5，裁决：**攻击成立，要求条件化**） | `SKIP_DIRS ∩ NON_PROD_SEGMENTS = {test, tests, __tests__}`：谓词明文拒绝这三段（rev1 矩阵 L182–183 断言 `src/test/case.ts`、`src/__tests__/case.ts` deny），但 SKIP_DIRS 同名剪枝使 `src/{test,tests,__tests__}/**` 整树不入扫描面 → 消费不被检测 → **门禁绿 = fail-open 漏检**。与设计自身 D-D 规则 3（「扫描面跳过非生产目录会造成『非生产目录消费不可见』的新盲区」——据此把 testing/fixtures/mock 移出 SKIP_DIRS）自相矛盾：同一原则未应用于冲突三段。威胁现实性：`src/__tests__/` 是 Jest 系主流惯例目录，未来开发者误置概率不低，非纯对抗场景 | 跳过规则条件化：`test/tests/__tests__` 段名跳过**仅当不在 `src/` 子树内**（父链含 `src` 段则照常扫描，谓词 deny 兜底）；testing/fixtures/mock 维持不跳过。实测兼容性已验证：今日仓内 src 子树内零此类目录 → 扫描面零变化、门禁保持绿；fixture 隔离不受影响（fixture 位于 `packages/namespace-runtime/test/`，非 src 子树）。该修订属 SA8 已裁定的「扫描面/跳过集合策略 = 审计设计自由」（RN4），探针行为零变化，19 it 不动；设计须明文修订 RN4 语义并知会 SA6 契约文本同步。配套红灯构想见下文 |
| 3 | **HIGH** | §D-B 扩充 E1（属性访问 `.require` callee）（SA8 转交发现 3，裁决：**删除回 SA6 冻结五形态**） | E1 超出 SA6 冻结五形态契约，fixture 树冻结不可增 → E1 分支**零红/绿锚定**。§D-G 表声称 RAC1 由「五形态 + E1」承载——E1 的承载为空。实测：生产树 `.require(` 零命中、`.cjs` 生产文件为零 → E1 今日不提供任何保护，只提供「覆盖 module.require 通道」的**未验证承诺**——恰是本轮要消灭的「声称 > 证明」结构（RAC1 证明义务上的自我矛盾）。将来 helper 重构/TS 升级使 E1 静默失效（漏检）或误报（假红），无测试可观测 | **裁决：删除 E1**（设计预置退让点：删一行 `\|\|` 分支即回五形态）。理由：① 超冻结契约的能力必须伴随锚定，否则不许进；② 防御通道今日零暴露而可信度成本实付；③ 删除后把「属性访问 require（module.require/this.require）」如实登记进 §D-B 残差清单（与计算式说明符同类）——诚实优于半覆盖；④ 未来真出现 .cjs 生产载体时走 SA6 契约演进加形态+探针（有锚定扩展）。**不接受第三态「无锚定保留」**；若 SA1/总控坚持保留，必须走契约演进补 fixture（`bypass/carrier-module-require.cjs`）+ it |
| 4 | 裁决（非阻塞） | §D-C 扩充 E2（大小写不敏感段拒绝）（总控特别提示项） | **裁决：保留，可接受。** 与 E1 不同类：E2 是纯函数内字符串变换（`toLowerCase`），行为完全确定、零运行时 API 假设、零外部依赖；方向单调收紧（deny 面扩大）；跨平台语义合理（Windows FS 大小写不敏感，`src/Test/` 即 `src/test/`，审计跨平台一致性要求支持不敏感比较）；实测仓内无大小写变体段（今日真实门禁零影响）；矩阵全小写 → 19 it 零影响；无锚定状态已如实声明（L196） | 保留。后续轮若因任何原因走 SA6 契约演进，顺带补 `src/Test/case.ts` deny 断言锚定（本轮不强制） |
| 5 | **MEDIUM** | §6 协议假设覆盖缺口（发现 1 的验证面根源） | P1–P6 全部验证「今日零消费前提下的行为」与「fixture 基准」，**无一条覆盖「默认门禁下 allow 路径可达性」**。SA6 临时实现 19/19 绿之所以没能暴露发现 1，正因真实门禁两 it 只做空集断言（violators=[]）——形式上「依据可被 SA4 验证」，实质上关键假设缺席，「绿」对基准错配不敏感 | 设计 §6 增补 **P7**：「默认门禁 relPath 基准与谓词前缀基准对齐（未来 Registry 生产消费方放行路径可达）」，依据 = #1 修复方案的机理论证 + fixture `repo/` 正例与真实门禁基准的等价性说明；R6 缓解声明改写为以修复后基准为前提。前瞻验收锚写进设计边界：切片 5/6 首个真实消费方落地时，真实门禁 it 必须保持绿（该时点的绿灯即 P7 的实测兑现） |
| 6 | LOW（非阻塞建议） | §D-D 规则 5 符号链接环 | 「扫描树内无符号链接环」是断言非机制。今日成立（实测 69 文件树），未来扫描树出现指向祖先的符号链接 → walk 无限递归。旧实现同语义（零漂移），非本轮回退 | 后续轮：`lstatSync` 或递归深度上限。本轮不阻塞 |
| 7 | LOW（确认项） | §D-B 残差宣称（SA8 转交发现 4） | 设计已如实声明残差（计算式说明符 / eval·Function / 经允许包的传递再导出）并归属验收域（R12/RN7），无虚假宣称。**确认合格** | 纪律确认：后续轮次不得把 RN7 残差静默当作已覆盖；传递再导出防线在切片 5/6 Registry 包导出面验收域，届时 SA8 按 L18 复审。若采纳 #3 删除 E1，残差清单同步增补「属性访问 require」一条 |

## 发现 1 深挖（CRITICAL 定级的完整论据）

1. **机理实证**：`path.relative('/repo/packages', '/repo/packages/namespace-registry/src/registry.ts')` = `namespace-registry/src/registry.ts`——`packages/` 顶层段被扫描根吸收。谓词① 前缀永假。domains/apps 两根下任何文件同理永不可达白名单。默认门禁的 allow 集合 = ∅。
2. **对 Round 1 已正确行为的静默回退（本次评审新发现，SA8 未点透）**：旧 AC5 实现（L317 `REPO_ROOT` + L370 `path.relative(REPO_ROOT, full)`）基准与谓词**对齐**——旧门禁在切片 5/6 落地时会正确放行未来 Registry 生产消费方。新设计为服务 fixture 探针（SA6 契约「relPath 相对各自扫描根」）把默认门禁基准改为相对扫描根，**在真实门禁侧静默丢弃了 R1 的正确基准语义**。这直接击穿两处设计声明：
   - §D-E「rev1 文件对旧 AC5 三 it 是**严格超集**」——在「未来合法消费放行」行为维度上，rev1 不是超集而是退化（旧放行 → 新假红）；
   - §4 R6「白名单收窄误伤未来 Registry 生产代码（假红阻塞切片 5/6）→ 已缓解」——缓解只在谓词纯函数/fixture 基准成立，在默认门禁基准下为假。
3. **「单一实现双输入」核心主张的自我否定**：§2 架构切入点声称探针与真实门禁共用同一实现「杜绝两类输入的不一致裂缝」——实现确实单一，但 **relPath 基准语义随输入模式分叉**（fixture 根内含 `packages/` 层级 → 探针 relPath 带前缀、谓词语义可达；真实三根 → 剥离、不可达）。探针证明的谓词语义 ≠ 真实门禁实际生效的谓词语义——探针给不出它声称要给的证明。
4. **门禁失败语义被结构性污染（虚假降级同族，立法依据）**：切片 5/6 落地时门禁必红，而 §D-H 处置协议与 rev1 测试 L224–226 注释的病因诊断文案（「说明真实仓内存在漏检形态的真实消费方」）会把 ADR 0009 L18 首句**授权的合法消费**误诊为「边界破坏」。「门禁红 = 有人违规」这一失败契约被设计缺陷劫持——红既可能意味着真实违规也可能意味着基准错配，且诊断文案系统性指向后者误诊。这属于「把内部设计缺陷伪装成外部仓库信号」的伪信号结构，与 2026-05-07 三度立法的虚假降级识别同族（把 bug 的产物当作正常可降级信号处理），SA2 按立法标 CRITICAL。
5. **为何必须本轮修、不能等切片 5/6**：SA8 定性 no-conflict 的前提是「fail-closed 方向、今日观察等价」——安全侧成立，但若放任 SA3 按本设计实现，缺陷被固化为已 commit 的 helper 行为，届时修复要走新一轮修订；而本轮修复成本 = 设计文档修订 + 实现前基准选择，**零触碰 19 it 与 fixture 树**（实测核对断言形态后确认），是全生命周期最小成本窗口。
6. **修复后正向锚**：fixture `repo/` 侧正例（`packages/namespace-registry/src/registry.ts` 检测到且非 violator）在修复后与真实门禁基准**同构**（两者 relPath 均带 `packages/` 顶层段）——fixture 正例从「探针基准下的证明」升格为「真实门禁基准的等价性证明」。真实侧活链路正向锚待切片 5/6 首个消费方（写入设计边界，见 #5）。

## 协议假设依据审查（2026-06-13 立法）

- **章节存在性**：§6 完整存在，P1–P6 六条，含依据类型/具体引用/风险等级 ✓。
- **依据可验证性**：P1/P4/P5/P6「设计期实测验证」均引自 SA6 锚定记录（命令 + 输出关键行在简报在案：`Test Files 1 passed / Tests 19 passed / Type Errors no errors`、聚合 tsc 2 条 TS2307）；临时实现已删除不可重跑，但 SA4 静态门禁将以 helper 落地后的同命令重跑覆盖——形式合规。P2/P3 源码引用可定位（`vfs3-assets-tsdoc.test.ts:34`、`vitest.config.ts` include——本轮实测复核一致）✓。
- **「应该/通常/预计」类无据推断**：未发现 ✓。
- **实质缺口（引用合规性之上的覆盖问题）**：P1–P6 无一条锚定「默认门禁 relPath 基准与谓词前缀对齐」——发现 1 恰从这个盲区漏过，且 SA6 19/19 绿对此不敏感（真实门禁断言不含路径常量 + 今日消费面为零的空集断言）。「依据可被验证」不能替代「关键假设被列入」——修订要求见攻击点 #5（增补 P7）。

## 错误处理链路审查（2026-05-07 立法）

- **静默失败**：helper 无吞错路径——`readFileSync`/`statSync`/`readdirSync` IO 错误直接上抛 → 测试红（响亮）✓；显式 roots 不做存在性过滤 → fixture 根缺失 ENOENT 响亮红（§D-D 规则 1）✓。§7 caller 审计三个同步调用点（beforeAll + 两 it）裸调用无 catch——设计意图即测试红，正确 ✓。
- **状态闭环**：N/A（同步纯函数 + 无异步状态机；无 `exStatus` 类状态面）。
- **降级路径**：默认 roots `existsSync` 过滤（apps 缺席）——实测 apps 仅含 README.md（F13），缺席属合法仓形态而非「正常路径前提缺失」；全部默认 roots 缺席的退化场景由防空扫 it（prodFiles>0）兜底变红 ✓。**非伪降级**。
- **虚假降级/伪信号识别（本轮实质问题）**：发现 1 使「门禁红」信号在未来被设计缺陷劫持（详析见发现 1 深挖第 4 点）——不是传统意义的降级路径缺失，而是**失败信号语义污染**：把内部基准缺陷的外显（假红）伪装成「存在真实违规消费方」的仓库信号，且处置协议的诊断文案会系统性误诊。按立法精神标 CRITICAL。真实门禁变红处置协议本身（停止回禀、不绕过）方向正确，但其病因分支表缺少「基准错配」这一病因——修复 #1 后该缺口自然消除。
- **极端输入**：语法错误文件经 `ts.createSourceFile` 产出恢复 AST 不抛（真实仓文件经 tsc 门禁本就语法清洁）；超深目录递归与符号链接环见 #6（非阻塞）；非 UTF8 内容 `readFileSync(utf8)` 不抛 ✓。

## 红线测试思路（逐漏洞对应）

1. **#1 基准错配（CRITICAL）——红灯 IT 构想**：
   - **基准锚定断言**（helper 行为层，随 SA3 实现或 SA6 契约演进）：对默认模式扫描，任取一个 `packages/**` 下已知文件（如 `packages/namespace-runtime/src/index.ts`），断言其在 `importers` 域内的 relPath 形态以 `packages/` 顶层段开头——可用「临时消费者」演练：在测试内构造临时目录树 `<tmp>/packages/namespace-registry/src/registry.ts`（内容 = 真实消费语句）作为**显式根**传入 + 对默认根的 relPath 形态断言双管齐下；
   - **等价性断言**：fixture `repo/` 正例 relPath（`packages/namespace-registry/src/registry.ts`）与「默认门禁下同路径文件的 relPath」字符串相等——修复后二者同构，一条 `expect` 即把基准对齐钉死；
   - **前瞻验收锚**（设计边界，切片 5/6）：Registry 首个生产消费方落地当轮，真实门禁 it（violators=[]）必须保持绿——绿即 P7 兑现，红即回退。
2. **#2 扫描面盲区（HIGH）——红灯 IT 构想**：fixture 树 `repo/` 侧补 `packages/namespace-registry/src/__tests__/case.ts`（内容 = `import '@nomicore/namespace-runtime/internal'`）+ 对应 it：断言该文件被检测（`importers` 含）且判违规（`violators` 含）——当前设计下此 it 必红（SKIP_DIRS 剪枝 → 不可见），条件化修复后转绿。这是「存在该消费 → 审计判违规」在非生产目录段的直接延拓（RAC2 精神）。走 SA6 契约演进（fixture + it 增补）。
3. **#3 E1（HIGH）——测试构想**：采纳删除路径则无需新测试（D-B 回五形态 + 残差清单增补一条）；若走保留路径，补 `bypass/carrier-module-require.cjs`（`module.require('@nomicore/namespace-runtime/internal')`）+ it「属性访问 require 形态 → 检测 + 判违规」。
4. **#5 P7（MEDIUM）**：无独立红灯——以 #1 修复的等价性断言 + 切片 5/6 前瞻验收锚承载。
5. **#6 符号链接环（LOW）**：后续轮——构造指向祖先的符号链接 fixture，断言 helper 响亮抛错或深度截止，而非挂死。

## SA8 转交发现逐条裁决汇总

| SA8 发现 | SA2 裁决 | 处置 |
|---|---|---|
| 1（relPath 基准错配，首优先级） | **成立，升级为 CRITICAL**——附加「对 R1 已正确行为的静默回退」加重情节（旧实现 `path.relative(REPO_ROOT, full)` 基准对齐，本轮实测确认） | 必须本轮修订（方案 A/B 见攻击点 #1）；零触碰 SA6 资产 |
| 2（src/{test,tests,__tests__} 扫描面盲区） | **成立，HIGH**——fail-open 方向（与 SA8「不产生任何漏放行」表述相左：扫描不可见 = 不检测 = 漏放行；SA8 该句仅在「谓词判定层面」成立，集成层面确为漏检），违反设计自身规则 3 原则 | 条件化跳过（src 子树内不剪枝）；实测今日零扫描面变化 |
| 3（E1 无独立探针） | **成立，HIGH**——裁决删除回五形态（或契约演进补锚定，二选一） | 删一行即回退，或补 fixture+it |
| 4（残差宣称边界） | **确认合格**——设计已如实声明 | 后续轮纪律：不得静默当作已覆盖；切片 5/6 按 L18 复审 Registry 再导出面 |

## E1/E2 防御性扩充去留（总控特别提示项，最终裁决）

| 扩充 | 裁决 | 一句话理由 |
|---|---|---|
| **E1**（属性访问 `.require` callee） | **删除**（或补锚定，不接受无锚定保留） | 超冻结契约 + 零探锚 + 零暴露面（实测 `.require(` 生产树零命中）= 纯可信度成本的「声称>证明」结构——本轮要消灭的正是这类结构 |
| **E2**（大小写不敏感段拒绝） | **保留** | 确定性纯函数变换、单调收紧、跨平台语义合理（Windows FS 不敏感）、今日零影响、无锚定状态已如实声明——与 E1 的 AST 行为假设不同类 |

## 结语

设计在识别面（AST 五形态 + 八扩展名）、白名单收窄谓词、单一实现双输入、残差如实声明、§6/§7 合规性上质量扎实（F1–F13 实测全数核实，无虚报）；但 **relPath 基准错配（#1）使核心主张「探针证明 = 门禁行为」在默认门禁下失效，且是对 Round 1 已正确行为的静默回退**，叠加 #2 fail-open 盲区与 #3 无锚定分支，三项均可在零触碰 SA6 冻结资产的前提下于设计/实现前修正——这正是最低成本窗口，故 reject 而非放行。修订后 SA1 只需更新设计文档（D-A/D-B/D-D/E1 删除/R6/§6-P7/相关决策点表），无需重跑红灯锚定（19 it 与 fixture 树零变化，红灯语义「helper 缺席」保持）。

---

# R1 复审（2026-08-25，续传）

**被审对象**: `wiki/raw/task_namespace-runtime-registry-seam-rev1_design.md`（R1 修订版，435 行，修订历史与文末「SA2 反馈逐条回应」表 #1–#7 全登记）
**Verdict**: **pass**（#1/#2/#3/#5 全部核实落实且经机器验证；两项 LOW 观察项与一项流程前置提醒，均不阻塞）

## R1 修订逐项核验

| R0 要求 | 核验结论 | 证据 |
|---|---|---|
| #1 CRITICAL 方案 A（单根 REPO_ROOT + 顶层白名单） | **✅ 落实且正确**：`isDefaultMode = roots === undefined` → 默认单根；`TOP_LEVEL_SCAN_DIRS` 仅在扫描根层生效；relPath 统一 `path.relative(root, file)` → 默认门禁下 packages/** 恒带顶层段；`existsSync` 过滤删除（F16 按名过滤天然容忍缺席）；R6 缓解声明以修复后基准重写；§D-E 超集声明补基准维度；§D-H 红病因单一化（「基准错配」假红分支消除，红即真实违规） | 机器验证 V1/V2/V4a/V4b（下文）+ F5/F14/F16 复核一致 |
| #2 HIGH 条件化剪枝（ALWAYS/SRC_CONDITIONAL 拆分 + inSrc 传递） | **✅ 落实且正确**：拆分并集恰为 R0 SKIP_DIRS（7+3，无遗漏）；`SRC_CONDITIONAL_SKIP_DIRS = {test, tests, __tests__}` 仅 `!inSrc` 时剪枝；`inSrc` 精确段判定（`name === 'src'`，src2 不触发，与谓词前缀语义一致）且递归单调置位；包级 test 剪枝保持（fixture 隔离 + 审计器不审计自己）；谓词承诺拒绝的全部六段 {testing, test, __tests__, fixtures, mock} 在 R1 下扫描面全部可见——「谓词 deny 的路径必扫描可见」完整成立 | 机器验证 V3/V5 + F9/F15 复核一致 |
| #3 HIGH E1 物理删除回五形态 | **✅ 落实**：形态⑤ 仅 `ts.isIdentifier && text === 'require'`（属性访问分支物理删除）；残差清单第 1 条新增「属性访问 require」（module.require/this.require/x.require）+ 今日零暴露依据（F8 补 `.require(` 零命中）+ 未来 SA6 契约演进路径；§D-G RAC1 承载改「五形态」；R12 同步 | §D-B 伪代码逐行核对 |
| #4 E2 保留 | **✅ 维持零改动**，SA2 裁决理由并入声明段 | §D-C L171–174/L202 |
| #5 MEDIUM §6 增补 P7 | **✅ 落实**：四重依据（方案 A 机理 F14 实测 + fixture repo/ 正例与默认门禁逐字符同构 + 旧 AC5 基准同款 F5 + 前瞻验收锚：切片 5/6 首个消费方落地当轮真实门禁 it 保持绿） | §6-P7 + §D-H 前瞻验收锚 |
| #6 LOW 符号链接环 | 登记不改（§D-D 规则 6），符合 R0 裁定 | — |
| #7 残差纪律 | 残差清单扩至五条 + SA2 #7 纪律条款引用 | §D-B L149–157 |

## 机器验证（R1 §D-D 伪代码对真实仓库的可执行转录，2026-08-25）

```
V1 扫描面文件数: 69 ✓ 等价（与三根方案逐文件一致，方案 A 无扫描面漂移）
V2 packages 域 relPath 全部带 packages/ 前缀: ✓（样本: packages/doc-runtime/src/carrier.ts）
V3 fixture/helper 隔离: ✓（包级 test 剪枝保持，条件化不影响隔离）
V4a 未来消费方 relPath: packages/namespace-registry/src/registry.ts | 谓词判定: ✓ allow（可达）
V4b 与 fixture repo/ 正例逐字符同构: ✓（探针证明 = 门禁行为的等价性有实测支撑）
V4c 生产子目录/深层 allow: ✓
V5 src 子树内 test/tests/__tests__ 目录: ✓ 零命中（条件化剪枝今日扫描面零变化）
V6 非 Registry deny: ✓（fail-closed 方向保持）
```

R0 CRITICAL 缺陷（默认门禁 allow 集结构性为空）的修复经此从纸面论证升级为**实测事实**。

## SA6 资产零漂移核验

`git status --porcelain` + 行数/文件数对照：rev1 测试 233 行（=R0）、fixture 树 19 文件（=R0）、旧 seam 测试 396 行（未动，AC5 块删除属 SA3 实现阶段）、helper 仍缺席（`test/helpers/` 不存在 → 红灯语义「探针目标缺席」保持）、代码域无 SA6 资产外任何改动——**「R1 修订只改设计文档」声明属实**。

## R1 新引入代码的全新视角攻击（结论：无 CRITICAL/HIGH 新漏洞）

1. **`auditInternalSubpathImporters([])`（显式空数组）**：`roots === undefined` 判定 → 空数组走显式模式 → 空扫描 → prodFiles=0 → 防空扫兜底红（响亮）。rev1 测试无此调用形态。行为合理，非缺陷。
2. **顶层过滤先于 statSync**：被过滤顶层条目免 IO，无行为影响。
3. **ALWAYS_SKIP 段在 src 子树内保持剪枝（预答性论证，非缺陷）**：docs/wiki/dist/coverage/node_modules 与 SRC_CONDITIONAL 三段不同类——谓词**不承诺拒绝**这些段（视为生产路径），且其内容（构建产物/文档/依赖目录）本就不是审计对象（如 `src/dist/` 内的 require 是编译输出，审计本就不该扫）。「谓词 deny 的必可见、谓词 allow 的可剪枝（非审计对象）」——R1 的拆分恰好划对了这条线。
4. **LOW 观察项 O-1（登记，不阻塞）**：`walk(root, true, false)` 初始 `inSrc=false` 未把扫描根自身名 `src` 纳入判定——若未来有人显式传 `…/src` 目录为根，其下 test/ 会被剪枝（谓词 deny + 扫描不可见的盲区在该用法下重现）。今日无此用法（SA6 契约 roots = fixture 树根 repo/、bypass/；默认 = REPO_ROOT）。**建议 SA3 实现时一行加固**：初始 `inSrc` 由根 basename 判定（`path.basename(root) === 'src'`），或在 helper JSDoc 声明 roots 语义不含 src 根。

## 放行前置流程提醒（总控执行项，非设计缺陷）

**RN4 知会项（设计 §D-D L281 / R15 已登记）**：简报 §SA6 helper 契约的「目录跳过」「roots 缺省」两行**文本表述**（三根 + 无条件跳过）需由总控知会 SA6 同步为 R1 语义（单根 + 顶层白名单 + 条件化剪枝）。行为契约不变（扫描面今日逐文件等价、relPath 仍相对各自扫描根、19 it 探针行为零变化——本文机器验证 V1/V3 佐证），但若不同步，SA4 静态门禁比对简报契约文本时会出现「实现 ≠ 契约字面」的假差异。**SA3 实现启动前执行。**

## R1 最终裁决

**pass。** 四项必修（#1/#2/#3/#5）全部正确落实，其中 #1 的修复经可执行转录对真实仓库六项机器验证确认（allow 可达 + 基准同构 + 扫描面等价 + 隔离保持）；R1 未引入新的 CRITICAL/HIGH 漏洞；两项 LOW 观察项（O-1 初始 inSrc 边界、#6 符号链接环）留 SA3 实现时顺手处置或后续轮。设计可进入 SA3 实现阶段。
