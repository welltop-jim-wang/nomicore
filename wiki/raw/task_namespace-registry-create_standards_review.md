# Standards 轴独立审查 — issue #111（namespace-registry create / doc-runtime createInitialDocument）

- 审查面：worktree `/home/wangjian/nomicore-fix-issue-111` 相对基线 `cdcf28b` 的未提交改动（只读审查，未改任何文件）
- 审查轴：标准 / 架构 / 纪律（仓库现行惯例为基准，逐项对照既有代码）
- 实证基座：双包 `tsc -p` 零错误（tsconfig.base.json `strict` + `exactOptionalPropertyTypes`）；`vitest run packages/namespace-registry packages/doc-runtime` 全绿（27 文件 / 414 用例）；`git diff --check cdcf28b` 零空白错误

**Verdict: findings**（BLOCKER × 1，ADVISORY × 5）

---

## 发现清单

### BLOCKER-1 包卫生：namespace-registry 漏 version bump（item 7 半完成）

- **位置**：`packages/namespace-registry/package.json:3`（`"version": "0.1.1"`，diff 仅 +1 行 clock 依赖声明）
- **问题**：本票对 namespace-registry 公共面是**破坏性变更**——主入口移除 `RegistryOperationUnavailableIssue` re-export、`CreateNamespaceRegistryOptions.clock` 变为必需、`create` 签名整体替换——但版本号未动；同一 diff 内 doc-runtime 已按惯例 0.1.10 → 0.1.11。
- **证据**：
  - 本 diff：`packages/doc-runtime/package.json` 0.1.10→0.1.11 ✓；`packages/namespace-registry/package.json` 版本行无改动 ✗。
  - 仓库惯例（逐变更 patch bump）：doc-runtime 0.1.4(#75)→0.1.5(#74)→0.1.6(#94)→…→0.1.10(#110 期)→0.1.11(本票)；namespace-runtime 0.1.5(#85)→0.1.7(#116)。namespace-registry 在 cdcf28b 以 0.1.1 降生（#110），本票为其首次演进。
  - 设计/流程档案（design/ac_checklist/sa7_report/dispatch）grep 无任何「豁免 registry bump」的裁决记录 → 属遗漏而非有意偏差。
- **修法**：`packages/namespace-registry/package.json` version 0.1.1 → 0.1.2（一行；private 包不影响发布，仅惯例记账一致性）。

### ADVISORY-1 Entry 预留字段注释已过时（item 1 注释准确性）

- **位置**：`packages/namespace-registry/src/registry.ts:123-126`
- **问题**：注释仍写「以下字段为 #111（create 共用 lifecycleTail）/ #112（closePromise + phase:'closing' 关闭聚合）的冻结设计预留，**本票不消费、不改动**」。事实上本票 `runCreateSlot`（registry.ts:604-650）已读取 `phase === 'closing'` 与 `closePromise`（R2-M1 fail-closed 三分支），而 create 实际共用的是 **carrier FIFO** 而非 `entry.lifecycleTail`（该字段仍无消费者）。注释与代码现状两面不符。
- **证据**：上述行号对照；HIGH-1 四变体测试（registry-create.test.ts:1545-1813）即以该消费行为为锚。
- **修法**：重写该注释为「#111 create 只读消费 closePromise/phase:'closing'（fail-closed，不建 loop）；lifecycleTail 仍待 #112」，约 3 行。

### ADVISORY-2 `assertClockShape` 无理由导出（item 7 exports 面卫生）

- **位置**：`packages/namespace-registry/src/registry.ts:234`
- **问题**：该函数以 `export` 导出，但全仓消费者只有本文件内部两处（registry.ts:380、812）；测试不直调（构造门禁经工厂行为锚定）。既有的模块级导出先例都带正当性注释——`removeOnlySelf`（「模块级导出（包内模块通道纪律…）：仅供 test/ 相对导入直接消费」）、`createRegistryInternal`（testing.ts 真实消费）；本导出既无消费者也无注释。registry.d.ts 在主入口可达声明图内，无理由导出会静默扩大声明面（token 禁词审计抓不住此类扩张）。
- **修法**：去掉 `export` 变模块私有（生产/testing 工厂同文件调用不受影响），或补一段导出正当性注释。

### ADVISORY-3 identity.ts 模块头注缺 #111 provenance（item 2 头注齐整）

- **位置**：`packages/namespace-registry/src/identity.ts:1-17`
- **问题**：本文件新增 `acceptCreateIdentity` / `CreateIdentityOutcome` / `CREATE_INVALID_INPUT_ISSUE`（#111 设计 §4 DQ-1），但模块头注仍只标「issue #110 设计 §4」。同期所有兄弟模块头注均已追加 #111 引用（types.ts「issue #111 设计 §2.1/§3」、errors.ts、observer.ts「#111 扩展为七形」、testing.ts「issue #111 设计 §8 DQ-8」、registry.ts「#111 设计 §5」）。函数级 JSDoc 引用齐全，仅模块级头注掉队。
- **修法**：头注首行追加「issue #111 设计 §4 DQ-1（create 最小 identity 接纳）」。

### ADVISORY-4 registry-open.test.ts clock 迁移的格式化毛边（item 1 风格一致性）

- **位置**：`packages/namespace-registry/test/registry-open.test.ts` 全文件 28 处；`packages/namespace-registry/test/registry-node-dispose.test.ts:21-23`
- **问题**：为保持单行 diff，迁移把 clock 键胶合到开括号行——21 处 `{ clock: manualClock(),\n      runtimeFactory: …`（clock 独占 `{` 同行、其余键次行缩进），7 处 `{ clock: manualClock(),}`（`}` 前缺空格，如 :283/:316/:357）；node-dispose 在 helper 后留下**两个连续空行**。仓库无 prettier/eslint 强制（已核实无配置），属风格一致性层面。
- **证据**：`git diff cdcf28b -- registry-open.test.ts` 全部 hunk 逐一抽查，除 clock 注入外仅 1 处占位断言迁移（sentinel create 改为 `as never` + 注释更新，:1076-1081），符合 item 6「94 行 ≈ 全部 clock 迁移+占位断言迁移」的预期。
- **修法**：接受（最小 diff 取舍）或做一次纯格式化 pass（建议后者，单独提交保持语义 diff 干净）。

### ADVISORY-5 两处有意「镜像」复制（item 2 单一真相源——已证当前最优解，留档）

- **位置**：`packages/doc-runtime/src/create-initial-document.ts:240-297`（verifySchemaFourKeys/verifyMetaTwoKeys）；`packages/namespace-registry/src/registry.ts:288-360`（clonePlainData）
- **问题与核验**：
  - `verifySchemaFourKeys` 与 schema-replace.ts:299 模块私有版本逐字同义（拼接 reflow 后渲染串**逐字节相同**，已比对）；verifyMetaTwoKeys 为其对称新写。schema-replace 版本未导出，复用需先改造既有模块（非最小改动）；头注已明示「镜像」来源——当前形态是约束下的最优解，非偷懒复制。
  - `clonePlainData` 对照 namespace-runtime write.ts:266 `copyFrozen`（模块私有、不可跨包导入），数组/对象分支对齐其四查纪律，且头注明示**唯一有意差异**（WeakSet 全图去重拒共享引用）。
- **修法**：无需本票动作；若未来出现第三处消费者，把 verify/copy 机械上移到共享模块。

---

## 逐审查项结论表

| # | 审查项 | 结论 | 要点 |
|---|--------|------|------|
| 1 | 代码风格一致性 | ADVISORY | 中文 JSDoc 头注/命名/错误构造/Object.freeze 纪律与既有一致；exactOptionalPropertyTypes 双包 tsc 零错（fixture 以条件展开保持 closePromise 键缺席，test:1661-1662 注释明示）。毛边见 ADVISORY-1/3/4 |
| 2 | 架构纪律 | 通过（留档 ADVISORY-5） | 单一真相源：create-document.ts 复用 vfsl compile/validate；create-initial-document.ts 复用 buildTopEntries/transactGuarded/verifyInstall/verifySnapshotIntact 既有导出。tx-guard 的 `assertOutermostTransactionContext` 未调用——**核验为正当**：seam 自持 fresh `new Y.Doc()`，外层未闭合事务结构性不可达，设计 §6 三相 fatal 词表不含 E202。包边界：registry 只消费 doc-runtime/vfsl/clock 公共入口 + namespace-runtime/internal（既有特许，surface 测试锚定）；doc-runtime 零反向依赖。头注 provenance 除 identity.ts 外齐 |
| 3 | 零回显与安全纪律 | 通过 | 5 条新公开 message 常量 + Clock 门禁 TypeError 全部顶层恒常量零插值（types.ts:48-58、registry.ts:239）；非法 Clock 读数插值只进内部 cause（registry.ts:444-446），stable message 不含 cause 文本（errors.ts 既有纪律）；负锁测试锚定 sentinel 不进 message/name/stack（test:899-955）。observer 五形→七形在头注与类型注释双处明示（observer.ts:13），新事件载荷与既有同构（typed cause + identity）；内嵌底层 issues verbatim 属 DQ-4 明示豁免并在 types.ts 注释声明 |
| 4 | 并发/资源纪律 | 通过 | `admitCreateSlot` 与 open 同一 carrier FIFO/green-tail/cleanup 三件套逐行同构（registry.ts:588-601 vs 483-496）；release fire-and-forget 经 `releaseHandleBestEffort` 内部 try/catch 全包（:503-513、:769）；永不 settle 的 release 不阻塞 fatal 交付有专测（test:1406-1450）。`removeOnlySelf`/`scheduleCarrierCleanup` 零改动；Map 清理守卫无回归（414 用例含 carrier ABA 全绿）。无浮动 promise（`void p.then` 双侧 handler 齐） |
| 5 | 测试纪律 | 通过 | 零 real sleep（grep setTimeout/sleep/fake timers 仅命中注释；`setImmediate` 宏任务排空有 registry-open.test.ts:692-698 既有先例）；deferred/flushMicrotasks 按既有每文件自备原语惯例复用。断言强度抽查（成功全链/hostile/数组四查/domain verbatim/负锁/post-commit/closing 四变体）：计数锚、零副作用锚、exact cause 同一性、逐字 message、深等 verbatim issues，未见恒真断言或过宽 toMatchObject 吞字段。三个新测试文件头注均引用设计节号 |
| 6 | 最小改动 | 通过 | 全 diff 无顺手重构；registry-open.test.ts 94 行抽查=纯 clock 迁移+1 处占位断言迁移（ADVISORY-4 仅为格式毛边）；registry-surface.test.ts 给两个既有 emit 测试补 `{ timeout: 30_000 }`——与声明图变重直接相邻的预防性改动，判定为相关而非 churn |
| 7 | 包卫生 | **BLOCKER-1** | registry 漏 version bump（见上）；clock 依赖声明+pnpm-lock 3 行仅 clock importer ✓；doc-runtime bump ✓；主入口 exports 面变化=设计 §2.3/§14 冻结的三类型新增+一别名移除（surface 测试锚定），无意外扩张；`assertClockShape` 无理由导出见 ADVISORY-2 |
| 8 | git 卫生 | 通过 | `git diff --check cdcf28b` 零空白错误；5 个新增文件 grep ` $` 零 trailing whitespace |

---

## 声明

本审查为只读标准轴审查，未修改任何文件；结论基于 diff 全文通读（registry.ts +499 逐 hunk、types/identity/observer/testing/errors/index 全量、5 个新增文件全读、registry-open.test.ts 94 行全抽查）+ 实证（双包 typecheck 零错、414 用例全绿、git 卫生检查）。

**遗留清单**：
- BLOCKER-1（必修，一行）：namespace-registry version 0.1.1 → 0.1.2。
- ADVISORY-1/2/3/4（建议随本票顺手修，均为数行注释/格式级）；ADVISORY-5 留档无需动作。
- 其余 6 个审查项无发现。

---

# 闭合轮复审（2026-08-26，SA4）

- 复审对象：终审 findings（BLOCKER×1 + ADVISORY×5）之后的一轮受控 SA3 修订（见 sa3_impl.md「# Standards BLOCKER/D1 闭合修订轮」冻结清单 5 处改动）
- 复审方式：纯只读静态审查——`git diff cdcf28b` 逐 hunk、全仓 grep、终审锚点复验；未运行任何测试/tsc/vitest（总控后台独占跑全量验证），未修改任何 src/test/package 文件
- 复审查询命令：`git diff cdcf28b -- packages/namespace-registry/src/identity.ts packages/namespace-registry/src/registry.ts packages/namespace-registry/package.json packages/namespace-registry/test/registry-node-dispose.test.ts`；`grep -rn "assertClockShape" packages/ apps/`；`git diff --check cdcf28b`（exit 0，零空白错误）

**Verdict: clean**（BLOCKER-1 闭合，ADVISORY-1/2/3/4 全部处置到位，ADVISORY-5 留档裁决仍成立；本轮 delta 未引入新增 HIGH/MEDIUM 问题）

## 逐项处置核对表

| 项 | 冻结改动 | 落地证据 | 结论 |
|---|---|---|---|
| BLOCKER-1 | package.json version 0.1.1→0.1.2 | diff 确认 :3 `"version": "0.1.2"`；该文件全 diff 仅 +2/-1（另一行为原轮已有的 `@nomicore/clock` 依赖声明）；与同 diff 内 doc-runtime 0.1.10→0.1.11（已核实）构成「逐变更 patch bump」惯例一致 | ✅ 闭合 |
| ADVISORY-1 | registry.ts Entry 头注重写 | :124-126 新注释逐字落地（「#111 create 只读消费 closePromise / phase:'closing'（R2-M1 fail-closed，不建 loop、不改动其写入）；lifecycleTail 仍无消费者，留 #112 关闭聚合统一接管」）；旧 3 行→新 3 行行数中性，终审引用锚点 :380/:503/:589/:769/:812 零漂移 | ✅ 闭合 |
| ADVISORY-2 | assertClockShape 去 export | registry.ts:234 现为 `function assertClockShape`（无 export 修饰）；全仓 grep（packages/ + apps/）仅 3 处命中：:99 注释引用、:234 定义、:380/:812 本文件调用——零外部 import、零测试直调；声明面净收缩、无残留引用 | ✅ 闭合 |
| ADVISORY-3 | identity.ts 模块头注补 #111 provenance | :2-3 追加「issue #111 设计 §4 DQ-1 —— create 最小 identity 接纳」；:16-18「accessor 拒绝」段同步扩展为「#111 起 input 顶层 owner/namespaceId 读取同为 descriptor-only、accessor 零执行」；与兄弟模块（types/errors/observer/testing/registry）双 issue 头注惯例对齐 | ✅ 闭合 |
| ADVISORY-4 | node-dispose helper 后双空行折叠 | cat -A 现场确认 helper `}` 后恰 1 空行；awk 全文件扫描零连续双空行；numstat +7/-1 与单空行吻合（双空行残留应为 +8）；上一轮已完成的 registry-open.test.ts 清理复验：7 处 `,}` grep 零命中 | ✅ 闭合 |
| ADVISORY-5 | 留档无需动作 | doc-runtime create-initial-document.ts:240 verifySchemaFourKeys / :270 verifyMetaTwoKeys「镜像」注仍在；registry.ts:288 clonePlainData 对齐注仍在（行号未漂移）；本轮零触碰两处 | ✅ 裁决仍成立 |

## D1 核心（identity.ts descriptor-only）落地质量核验

- **位置与判别式**：acceptCreateIdentity 现为 identity.ts:139-166。accessor 判别式 `!('value' in desc) || desc.get !== undefined || desc.set !== undefined`（:151/:158）与 validateOpenIdentity:104、snapshotCreatePayload（registry.ts:271）逐字同一——「同一判别式」声明成立。
- **零回显纪律（终审 item 3 复扫）**：拒绝路径全部 4 个 return（:142 非 object、:153 owner accessor、:160 namespaceId accessor、:164 catch）均返回冻结单例 `CREATE_INVALID_INPUT_ISSUE`（identity.ts:51-58），其 message 为顶层常量 `NAMESPACE_CREATE_INVALID_INPUT_MESSAGE`（types.ts:48-49，字符串字面量、零插值、不含任何输入片段）；缺键路径经 `?.value` = undefined 交 #110 `validateOpenIdentity` → `invalid()` 同为常量 message。冻结单例返回与 registry.ts `NOT_ACCEPTING_ISSUE` 既有先例同构。**零插值纪律保持。**
- **try/catch 收编完整性**：函数体全量位于 try 块内——`Object.getOwnPropertyDescriptor` 的 Proxy trap throw（含 getOwnPropertyDescriptor trap 抛错、以及理论上 validateOpenIdentity 的意外 throw）一律收编为窄 CREATE_INVALID_INPUT，无裸冒泡路径；validateOpenIdentity 自身内部 try/catch（identity.ts:95-122）双层结构不冲突。
- **缺键/语义保持**：`{ owner: null, … }`（identity 表 :785 直构锚）为 own data descriptor → 正确路由 NAMESPACE_INVALID_IDENTITY(field:'owner.userId') 而非 CREATE_INVALID_INPUT；零回显探针 registry-open.test.ts:1100（缺 owner/namespaceId 的 create → 恒定 message、sentinel 零外泄）与新控制流静态一致；identity 表（registry-create.test.ts:782-803）全部为 data-descriptor 构造，路由不变、field 断言保持。
- **D1 红灯锚静态可满足性**：registry-create.test.ts:718-752——accessor getter 计数 0（descriptor 读取不触发 getter ✓）、零 carrier-created（接纳失败在 `carriers.get` 之前 return，registry.ts:592-594 ✓）、`clock.calls` 0（Clock 读数在 runCreateSlot 槽内、接纳失败不可达 ✓）、零 Persistence ✓、keeper 复用不受毒化（同一 Registry 后续 create 成功，槽失败不污染 carrier）。
- **边界攻击扫描（无新增漏洞）**：Proxy getOwnPropertyDescriptor trap throw → catch 收编窄拒；lying descriptor（value 与 get 并存）→ 判别式 fail-closed 拒绝；继承（原型链）owner/namespaceId 不再被属性 GET 拾取 → 按缺键窄拒为 NAMESPACE_INVALID_IDENTITY——较旧属性 GET 语义**更严**且方向 fail-closed，正是冻结设计「descriptor-only、与 snapshot 同判别式」的题中之义（原型链拾取本身是污染向量），且全仓无任何测试锚定「继承身份可接纳」旧行为，无回流需求。

## 越界改动扫描

- 4 文件 diff 全部 hunk 逐一归因，无不属于「原 #111 工作」或「冻结清单 5 项」的改动：
  - registry.ts 12 个 hunk = 原轮 10 处（模块头注 runCreateSlot 文档、imports、options/testEntries 文档、issue 常量群、create 内部大块、create() 实现、生产工厂 Clock 门禁）+ 闭合轮 2 处（Entry 注释 hunk、assertClockShape 去 export）；numstat +487/-18 与终审通读时的全量体量吻合，无离群膨胀。
  - identity.ts 4 个 hunk = 头注 2 处（provenance + accessor 表述扩展，冻结 item 2）+ 原轮 CreateIdentityOutcome/CREATE_INVALID_INPUT_ISSUE + acceptCreateIdentity 替换为 descriptor 版（冻结 item 1，JSDoc 第 2 条同步重写 ✓）；validateOpenIdentity/digestKey/isMinimalSafeString 等 #110 存量零改动。
  - package.json +2/-1、node-dispose.test.ts +7/-1，均与冻结清单严格一致。
- 终审引用锚点复验零漂移：registry.ts :380/:503/:589/:769/:812、snapshotCreatePayload:257、clonePlainData:288、runCreateSlot 接纳次序（acceptance 检查 → identity 接纳 → carrier 获取）全部原位。

## 新增问题扫描结论

对照终审 8 项审查表逐项过 delta：本轮改动不触及读写路径一致性（item 2 之外的维度）、并发/资源纪律（item 4，carrier FIFO 零改动）、降级/错误链路（item 6）；零回显纪律（item 3）在新控制流上保持（见上）；包卫生（item 7）版本行补齐 + 声明面收缩（去 export 属净收缩，不可能触发 surface 扩张告警）；git 卫生（item 8）`git diff --check cdcf28b` 零输出。

**未发现新增 HIGH/MEDIUM 问题。**

登记性备注（不入 findings，零代码影响）：sa3_impl.md R3-1 改动清单 item 4 行号登记为 `registry.ts:236`，实际去 export 位于 :234（该编辑不改行数，终审时即为 234；同表 item 3 的 124-126 登记正确）——属档案行号笔误，不涉及任何代码或结论偏差。

**最终 Verdict: clean**——终审全部遗留（BLOCKER-1 + ADVISORY-1/2/3/4）处置到位，D1 闭合修法与冻结设计一致且零回显纪律保持，无越界改动、无新增 HIGH/MEDIUM；Standards 轴不再持有阻塞项。
