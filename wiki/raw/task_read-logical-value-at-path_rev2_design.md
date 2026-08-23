# SA1 修订设计（rev2）— union 仲裁包内纯函数 seam 抽取 + 变异判别力补缺（Issue #75 / PR #83 owner 第二轮 Review）

- **任务类型**：深度重构（可测性重构 + 测试硬化）。owner 第二轮 Review 定性：rev1 生产实现正确、无 correctness blocker；剩余问题 = R1/R2/R3 回归测试对 D17 value-first 核心分支**缺乏变异判别力**。修订 = 生产代码零可观测行为变更（INV-13）下的测试注入点构造。
- **worktree**：`/home/wangjian/nomicore-fix-issue-75`（branch `fix/issue-75-on-docs-doc-runtime-validation`，run_id `issue-75-rev-1787397220`）
- **授权链**：rev2 简报 `task_read-logical-value-at-path_rev2.md`（owner 第二轮 Review 全文 + AC-R2-1..R2-5）→ SA8 修订轮冲突门禁 `clear`（`task_read-logical-value-at-path_rev2_conflict_report.md`，verdict clear + 注记 R2-1..R2-5）→ SA6 rev2 红灯锚定已入库（commit `7f77384`：`read-logical-value-at-path-rev2-union-arbitration-pure.test.ts` 六行表驱动 + R1/R2/R3 措辞勘误 AC-R2-3）→ 本设计（首版）→ SA2 R1 攻击评审 **reject（窄域）**（`task_read-logical-value-at-path_rev2_sa2_review.md`：架构本体 D19/D20/D21/INV-15、§3.1.2/§3.2.1 伪代码主体、五点等价论证**全部存活，无需重新设计**；5 项验证协议层发现）→ **本修订（R1，5 项逐条落实，见文末回应表）**→ SA2 复审（仅核 5 项）→ SA3 实现 → 总控亲跑验收 → SA4 静态验尸 → SA7 动态验证（含 AC-R2-4 mutation proof 证据义务）→ AC 门禁。
- **修订基底**：rev1 设计 `task_read-logical-value-at-path_rev1_design.md`（D16/D17/D18/D13 重述/INV-12..14 与首轮 D1–D15/INV-1..11 **全部继续有效**）。本文件是增量修订：只裁决 seam 抽取与判别力补缺，不重述未变内容；与 rev1 冲突处以本文件为准（附 A 对照表）。

---

## 摘要（一页看懂）

**问题定性**：owner P1 指认的机理真实存在——rev1 R1/R2/R3 测试宣称覆盖「前序 missing → 后序 value」竞争场景，但 fixture 在现行合法 schema/live 模型下**结构性构造不出该执行路径**（Record 在场合键直读真值 / optional 在场直读 / 数字段仅数组成员接受）：前序成员要么直接产出 value、要么与后序同见同一缺席。因此把实现退回「首 missing 即返回」旧策略，R1/R2/R3 仍全绿。**深层原因不是 fixture 设计缺陷，而是 rev1 §3.5 观测等价定理 Case 2 的必然**——「首 missing 即返回」与 value-first 在一切合法输入上观测等价（SA5 四步归谬），**任何**合法 schema/live fixture 都不可能判别它；判别力只能来自**直接注入 NavOutcome 序列**的可控 seam（rev2 测试文件头同款结论：「纯函数 seam 是可控注入该场景的唯一途径」）。

**核心改动**（全部在 `packages/doc-runtime/src/read.ts` + 1 行 version bump，~35 行 delta）：

1. **D19**：union 三态仲裁循环（read.ts 现行 351-360 行）抽取为**包内纯函数 seam** `export function arbitrateUnion(outcomes: Iterable<NavOutcome>): NavOutcome`，与 `export type NavOutcome`（现 read.ts:268 加 `export` 关键字）一起做**模块级导出**——不经 `src/index.ts` 转出口，INV-14（约束单位 = **包边界**，SA8 特别审查点裁决 + extract.ts `walk`/`makeRefResolver` 先例）维持，test-d 冻结形态锁保持绿；SA6 红灯测试的 deep import（`../src/read.js`）是经简报/SA8 注记 R2-1 明文批准的唯一破例，成文于 §3.1/§8。
2. **D20**：`navigate` union 分支改经 seam 仲裁；成员 `resolveLive` 试探包装为**惰性 generator**（`function* memberOutcomes(...)`）——每拉动一个成员恰触发一次 `resolveLive`，首 value 短路时后序成员零试探；声明序迭代（INV-7）、memo 挂点（D13，调用序逐位相同）、行为观测（INV-13）零变更；**normative 禁令**：seam 内与 union 分支调用点均禁 `Array.from`/数组展开/`.map()` 物化。
3. **D21**：mutation proof 协议成文（AC-R2-4）——必做变异体 **M-A「首 missing 即返回」+ M-C「物化后仲裁」**（R1 修订：M-C 自可选升格，SA2 #4——它是 D20 惰性契约的唯一动态杀伤证据）、预期红（M-A：rev2 新文件行 1/3/5，行 1 双红；M-C：行 2 拉动断言）、对照事实（R1/R2/R3 及全部既有套件在两变异下仍全绿 = 判别力仅由新增测试提供）、还原协议**双路径**（R1 修订，SA2 #3：提交基线 `git checkout` / 非破坏性 sha256 快照——堵假 PASS 与数据丢失路径；SA8 注记 R2-3：变异不得随 commit/push 泄漏）、证据入 SA7 报告；可选变异体 M-B/M-D（M-B 红集合 = {3,4,6}，R1 勘误，SA2 #2）。
4. **AC-R2-3 已由 SA6 完成**（commit `7f77384`：R1/R2/R3 文件头 + describe 措辞改写为「现行合法 schema/live 模型下不可构造竞争场景的行为一致性锁」，行为断言零改动）——本设计仅记录该事实，SA3 不得再触碰。
5. **版本与冻结面**：`packages/doc-runtime` patch bump 0.1.3 → 0.1.4（硬门禁 #9）；DENY 面延续 rev1（`packages/vfsl/src/**`、extract.ts/carrier.ts/index.ts、read.ts Phase A 等，§8.3）。

**为什么这是最小修订**（owner 建议逐字兑付）：不抽 seam 则仲裁逻辑内联在 `navigate` 的闭包依赖（live/segs/i/resolveS/fullPath/memo）里，测试无法绕过 schema/live 管线注入结局序列；抽取是**唯一**能制造注入点且零行为变更的手段。owner 建议形态 `arbitrateUnion(outcomes: Iterable<NavOutcome>): NavOutcome` 逐字采纳（含 `Iterable` 参数形态——它是惰性契约的类型载体，§3.2）。

### 决策增量总表

| # | 决策 | 一句话理由 | 详节 |
|---|---|---|---|
| D19（rev2） | seam 落位：`arbitrateUnion` + `NavOutcome` 自 `read.ts` 模块级导出，不经 index.ts | SA6 红灯契约钉死导入路径 `../src/read.js`；INV-14 判据 = 包边界；extract.ts 先例；最小 delta | §3.1 |
| D20（rev2） | 惰性仲裁管线：union 分支经 generator 包装成员试探传入 seam；禁物化 | INV-7 精确化（首 value 短路不预先消费后序成员）的类型/控制流兑付；D13 memo 调用序不变 | §3.2 |
| D21（rev2） | mutation proof 协议：必做 M-A + M-C（R1 升格）+ 可选 M-B/M-D 杀伤矩阵 + 还原双路径（R1 修订） | AC-R2-4 成文；「判别力仅由新增测试提供」的证据底座；D20 惰性契约动态杀伤 = M-C 行 2 | §3.3 |
| INV-15（rev2） | 仲裁单点权威：union 分支成员结局聚合唯一经 `arbitrateUnion`；seam 零 doc/零 memo 访问；惰性契约由纯测试拉动断言锚定 | 防未来双轨仲裁/绕过 seam 的漂移 | §3.2/§7 |

D16/D17/D18/D13 重述、INV-12/13/14、首轮 D1–D15/INV-1..11 全部**原样有效**（§3.4 显式复核；D17 四规则逐字保持——seam 是其载体迁移而非修改）。

---

## §1. 问题定性与修订性质（可测性重构根因推演）

### 1.1 owner P1 指认的机理（全部属实，现行代码逐行核实）

| 位置 | 现状 | 机理 |
|---|---|---|
| read.ts:351-360 | `case 'union'` 内联 `sawMissing` + 声明序 `for (const m of node.members)` 循环 + 首 `kind:'value'` 即 return | 仲裁逻辑**内联**在 `navigate` 中，闭包捕获 `live/segs/i/resolveS/fullPath/memo`——测试唯一驱动途径是 schema（parseVfsl→evaluate）× live（Y.Doc）管线 |
| rev1 测试 R1（4 it）/R2（3 it）/R3（3 it） | fixture：`Record<string,YLEaf> | { foo: YLeaf }`、`{ foo?: YLeaf } | { foo: YLeaf }`、`YArray<YLEaf> | Record<string,YLEaf>` 两序 × live 在场/缺席 | owner 三点指认逐条复核属实：(1) live `{foo:'v'}` 时前序 Record 成员经 `ymap.get('foo')` 直读 `'v'`，**不产 missing**；(2) optional 字段在场时同理直读；(3) index 界内时前序数组成员直读 value；越界时后续 Record 无法消费 number 段只会 reject——「前序 missing + 后序 value」的竞争路径在 fixture 中**零执行** |

**推论（owner 原文复述）**：把实现退回旧逻辑（union 遇第一个 missing 立即返回、不继续扫描），R1/R2/R3 仍全绿——它们是行为一致性 green lock，不是 D17 value-first 核心分支的有效回归锚。

### 1.2 深层根因：观测等价使任何合法 fixture 都不可能判别（这不是 fixture 缺陷，是结构定理）

「首 missing 即返回」恰是 rev1 硬化前的旧策略在 missing 维度的形态。rev1 §3.5 观测等价定理 Case 2（SA5 四步归谬第 4 步）：合法输入上若某成员以合法缺席收场，则**一切存活后序成员面对同一缺席 live，不可能产出真实 value**——故「首 missing 返回」与「missing 记账继续」在**一切合法 schema/live 输入**上产出逐字相同的公共结果。这意味着：

- **不存在**任何合法 fixture 能让「首 missing 即返回」与 value-first 产生可观测分叉（rev1 设计 §4-H-b 已诚实成文：「对『首 missing 即返回』两序均无检测力——这不是缺口，是观测等价的必然」；owner 第二轮 Review 把这个「必然」升级为合并阻塞项）；
- 判别力的唯一来源 = **绕过 schema/live 构造管线、直接以包内 `NavOutcome` 序列驱动仲裁器**——即 owner 建议的包内纯函数 seam（rev2 测试文件头：「纯函数 seam 是可控注入该场景的唯一途径」）；
- seam 不存在 ⇒ 必须先做一次**生产代码可测性重构**（零行为变更，INV-13），这正是任务类型判定为「深度重构」的依据。

### 1.3 为什么不虚构 fixture / 不放宽结构系统（边界义务重申）

SA5 Fix direction + SA8 注记 R2-4 已立法：不得为「凑红灯」虚构 schema/live 可达性、不得放宽 `packages/vfsl` 结构系统（E309 混合联合禁令等是归谬成立的前提事实）。本设计严格遵守：竞争场景的执行锚**只**由纯函数 seam 注入（AC-R2-2 六行表），R1/R2/R3 保持 green lock 定位并已由 SA6 勘误措辞（AC-R2-3，commit `7f77384`）——两条证据链分工成文，互不冒充。

---

## §2. 修订影响面（改动半径）

- **只动**（§8.1 ALLOW 全集）：
  - `packages/doc-runtime/src/read.ts`（~35 行 delta，区域受边界约束）：(a) `NavOutcome` 类型声明加 `export` 关键字 + JSDoc 增补（§3.1）；(b) 新增包内导出纯函数 `arbitrateUnion`（§3.1 伪代码逐字）；(c) 新增包内私有 generator `memberOutcomes`（§3.2 伪代码，**不导出**）；(d) `navigate` union 分支（现行 351-360 行）10 行内联仲裁改写为经 seam 的 2 行调用（§3.2）；(e) 文件头 JSDoc 追加一行 rev2 注记。
  - `packages/doc-runtime/package.json`（1 行）：version `0.1.3 → 0.1.4`（硬门禁 #9；仅 version 字段）。
- **不动**：read.ts 其余一切区域——Phase A 全部（`isPathAllowed`/`decide`/`makeValuesResolver`/`vChild`/`keyAllowed`）、`notAllowed`（含 SA4-F2 守卫）、顶层 try/catch 编排、map/array/leaf/plain/xml-fragment 分支与终点 `walk` 委托、`resolveLive` 本体（memo 挂点结构）；`src/index.ts`（公共导出零新增——INV-14/test-d 锁）；`src/extract.ts`/`src/carrier.ts`；`packages/vfsl/**`；全部既有测试文件的行为断言（§8.1 注记 SA6 owned 纪律）。
- **SA6 已完成项**（本设计零义务、SA3 零触碰）：rev2 红灯锚定文件（commit `7f77384`）+ R1/R2/R3 措辞勘误（AC-R2-3）。

---

## §3. 修订设计

### 3.1 D19：seam 落位——`arbitrateUnion` + `NavOutcome` 自 read.ts 模块级导出（AC-R2-1）

#### 3.1.1 落位裁决：read.ts 原地导出（备选方案显式否决）

| 备选 | 裁决 | 理由 |
|---|---|---|
| **A. read.ts 原地导出**（本设计采纳） | ✅ | (1) SA6 冻结红灯契约钉死导入路径 `import { arbitrateUnion } from '../src/read.js'` + `import type { NavOutcome } from '../src/read.js'`——落位即履约，零中间层；(2) `NavOutcome` 居住地不动：`resolveLive`/`navigate`/`memoB` 类型注解零扰动；(3) 最小 delta（~35 行），DENY 面零扩张 |
| B. 新建 `src/arbitrate.ts` + read.ts `export { arbitrateUnion } from './arbitrate.js'` 转出口 | ❌ | 技术上可满足红灯导入（转出口经 read.js），但：`NavOutcome` 需搬家或双文件互相 import（循环依赖风险：arbitrate.ts 要 `NavOutcome`，read.ts 要 `arbitrateUnion`）；10 行纯函数配一个新文件 + 转出口是纯间接层；ALLOW 面多一个文件无对应收益 |
| C. 经 `src/index.ts` 公共导出 | ❌ | **直接违反 INV-14**（三态不泄漏公共面）与 AC-R2-1 明文「index.ts 公共导出零新增」；test-d 冻结形态锁将仍绿（它只锚定既有五项）但公共面被污染——SA8 特别审查点已裁决否决 |

**INV-14 判据精确化（成文，非语义变更——SA8 特别审查点 + rev2 relevant_decisions 同款表述）**：INV-14「`NavOutcome` 包内私有」的约束单位是**包边界**（`packages/doc-runtime/src/index.ts` 公共导出面），不是模块边界（src/ 内单文件）。「包内私有」= 不经 index.ts 转出口；模块级 `export`（自 `read.ts` 供同包测试 deep import）仍属包内私有，对 `@nomicore/doc-runtime` 消费方不可见。**先例**：extract.ts `walk`/`makeRefResolver` 包内导出（首轮落地、经 SA2/SA4 评审与 owner rev1 Review「生产实现修复正确」确认）；ADR-0003 §4「解析动作由**包内共享解析器**完成」为家族级模式。实测现行 index.ts 导出恰为冻结五项（`extractYjsSnapshot`/`ExtractIssue`/`ExtractResult`/`readLogicalValueAtPath`/`ReadLogicalValueResult`），rev2 要求维持。

**deep import 破例成文（SA8 注记 R2-1 义务，防 SA4 误报）**：doc-runtime 现有 11 个测试文件中 10 个从 `../src/index.js` 导入；唯 `read-logical-value-at-path-rev2-union-arbitration-pure.test.ts` deep import `../src/read.js`——这是经 rev2 简报 AC-R2-1/AC-R2-2 与 SA8 注记 R2-1 **明文批准的破例**（包内 seam 测试的合法消费形态），不构成「测试绕过公共面」违规；任何未来测试文件 deep import 包内模块须有同等明文授权。**包外消费者零授权**：`arbitrateUnion`/`NavOutcome` 不出现在任何 `apps/**`、其他 packages 的 import 中（§6 caller 清单），且公共面负锁见 §4-H-d 可选锚点。

**INV-14 结构性后盾（R1 修订补引，SA2 #5）**：`packages/doc-runtime/package.json` 实测 `"private": true` + `"exports": { ".": "./src/index.ts" }`——exports 映射使包外 deep import（`@nomicore/doc-runtime/src/read.js`）在 Node 运行时（`ERR_PACKAGE_PATH_NOT_EXPORTED`）与 TS bundler 解析两侧均被**结构性阻断**。INV-14 的包边界判据因此不是纯纪律约束，而是**被包管理器强制的事实**——这是比 caller 清单审计与 H-d 负锁更硬的验收锚（SA4/SA7 可直接引用）。据此：H-d 负锁只需锁 barrel 面（index.ts 转出口不得新增）；包外 deep import 的类型层拒绝由 exports map 自动生效、无需额外测试。**前瞻注记**：若未来该包解除 `private` 或正式发布，exports 面即成为公共契约边界，届时须重审 INV-14 判据与 seam 可见性（本设计不预期该变化）。

#### 3.1.2 seam 全量伪代码（normative，SA3 逐字落地基准）

`NavOutcome` 声明（read.ts:268 起）仅两处改动：加 `export` 关键字 + JSDoc 追加 rev2 段；**类型形状零改动**（INV-12 三态完备互斥原样）：

```ts
/**
 * 活导航三态结局（rev1/D16，AC-R1；owner 建议形态逐字采纳；包内私有类型——
 * 公共结果联合冻结为两态，missing/reject 不得泄漏（INV-14，SA8 注记 3）：
 * rev2/D19 注记：INV-14 约束单位 = 包边界（不经 index.ts 转出口）；本类型自 rev2 起
 * 做模块级 export，供同包测试 deep import（SA8 注记 R2-1 批准的破例）——包外零消费授权。
 * - value  = 实际产出：路径耗尽处 walk 快照（恒非 undefined，见完备性论证）或中段不下钻场景不产此态；
 * - missing = 合法缺席：且仅由三源产生（Record 缺键 / optional 缺席 / 非负整数越界，D8 三源）；
 * - reject = 本分支拒绝：段型不符 / 载体错位 / required 缺席 / 成员无此字段 / 终点 walk issue。
 */
export type NavOutcome =
  | { kind: 'value'; value: unknown }
  | { kind: 'missing' }
  | { kind: 'reject' };

/**
 * union 三态仲裁纯函数（rev2/D19，AC-R2-1；owner 第二轮 Review 建议形态逐字采纳）。
 * 包内可测试 seam：模块级导出、不经 index.ts 转出口（INV-14 判据 = 包边界；
 * 先例 extract.ts walk/makeRefResolver）；deep import 仅为同包测试破例，包外零消费授权。
 *
 * 契约 = D17 四规则逐字保持（rev1 §3.2）+ INV-7 精确化惰性（AC-R2-1 尾句）：
 * 1. 声明序逐个拉动 outcomes（for-of，一次恰拉一个，不预取）；
 * 2. 首个 kind:'value' 立即原样返回——此后序成员【不再拉动】（短路惰性；
 *    禁一切预先构造数组的物化形态——禁形清单与静态验尸口径见设计 §3.2.3，函数注释
 *    不含禁形字面量以保证验尸命令零自命中；物化即破坏短路，rev2 纯测试行 2 拉动断言锚死）；
 * 3. missing 只记账（sawMissing）不返回；reject 跳过——两者均继续后序成员；
 * 4. 迭代耗尽：sawMissing → { kind:'missing' }（D17 规则 3 + mixed 优先级
 *    value > missing > reject，rev1 §3.3.2）；否则 → { kind:'reject' }（规则 4）。
 *    空 iterable → reject（与 rev1 空成员 union 行为逐字一致：循环零次、sawMissing=false）。
 *
 * 纯函数纪律（INV-15）：零 doc 访问、零 memo 访问、零模块级状态、零可变捕获——
 * 一切输入经 outcomes 流入；value 结局按引用原样返回（同 rev1 `return r`，不改写不复制）。
 * 异常语义：不捕获不转换——源 iterable（generator 内 resolveLive）throw 时沿 for-of
 * 原样上浮（E100 域传播路径与 rev1 内联循环逐点相同，§3.2.3）。
 */
export function arbitrateUnion(outcomes: Iterable<NavOutcome>): NavOutcome {
  let sawMissing = false;
  for (const o of outcomes) {
    if (o.kind === 'value') return o; // D17 规则 1：首个真实 value 胜出（短路——后序零拉动）
    if (o.kind === 'missing') sawMissing = true; // D17 规则 2：missing 不胜出、继续后序成员
  }
  return sawMissing ? { kind: 'missing' } : { kind: 'reject' }; // 规则 3/4 + mixed 优先级
}
```

放置位置（R1 修订成文，SA2 #1(c)）：`read.ts` 顶层函数序固定为 **`NavOutcome` 类型声明 → `arbitrateUnion` → `memberOutcomes`（§3.2.1）→ `resolveLive` → `navigate`**——seam 紧随其类型、generator 紧随 seam，二者先于消费它们的 `resolveLive`/`navigate`（函数声明提升，无 TDZ/顺序问题）；该固定序即 §3.2.3 静态验尸区域行界的锚点。签名**逐字冻结**为 `arbitrateUnion(outcomes: Iterable<NavOutcome>): NavOutcome`（SA6 红灯契约 + owner 建议形态；参数名 `outcomes`、参数型 `Iterable<NavOutcome>`、返回型 `NavOutcome` 三者均不得偏离——`Iterable` 形态是惰性契约的类型载体，见 §3.2.1）。

### 3.2 D20：惰性仲裁管线——union 分支经 generator 包装接入 seam（AC-R2-1 尾句 / SA8 注记 R2-2）

#### 3.2.1 union 分支改写全量伪代码（normative）

`navigate` union 分支（现行 read.ts:351-360 的 10 行内联仲裁）替换为：

```ts
/**
 * union 成员结局惰性序列（rev2/D20；包内私有，不导出）。
 * generator：每次 next() 恰按声明序试探一个成员（触发一次 resolveLive）——
 * 消费端（arbitrateUnion）首 value 返回即关闭序列，后序成员【零试探】（INV-7 精确化）。
 * ⛔ 禁物化（normative，D20）：本函数与 union 分支调用点禁止一切预先构造数组的形态
 * （禁形清单与静态验尸四命令见设计 §3.2.3；函数注释不含禁形字面量与本函数标识符，
 * 保证验尸命令零自命中）。
 */
function* memberOutcomes(
  node: Extract<StructureNode, { kind: 'union' }>,
  live: unknown,
  segs: readonly (string | number)[],
  i: number,
  resolveS: (node: StructureNode) => StructureNode,
  fullPath: readonly (string | number)[],
  memo: Map<StructureNode, Map<unknown, Map<number, NavOutcome>>>,
): Generator<NavOutcome, void, unknown> {
  for (const m of node.members) { // 声明序（INV-7，零改动）
    yield resolveLive(m, live, segs, i, resolveS, fullPath, memo);
  }
}
```

`navigate` 内：

```ts
    case 'union': {
      // rev2/D19+D20：仲裁经包内纯函数 seam（AC-R2-1）；成员试探为惰性 generator——
      // 首个真实 value 胜出时后序成员零试探（INV-7 精确化 / SA8 注记 R2-2）
      return arbitrateUnion(memberOutcomes(node, live, segs, i, resolveS, fullPath, memo));
    }
```

（R1 修订：原「可接受等价变体：union 分支内联 IIFE generator」**撤销**——SA2 #1(b) 形态锁锚定具名 `function* memberOutcomes`（§3.2.3 命令 2/3），内联 IIFE 形态会使静态门禁失锚、且与「普通函数返回数组」漂移形态失去静态区分度；**具名 generator 为唯一 normative 形态**，调用表达式必须是 `arbitrateUnion(memberOutcomes(…))` 直接实参形。）

#### 3.2.2 语义等价论证（INV-13 兑付，逐位对照 rev1 内联循环）

设 rev1 循环 R（read.ts 现行 351-360）与 rev2 管线 P（generator + seam）：

1. **成员试探序列逐位相同**：R 第 k 次迭代调 `resolveLive(m_k, live, segs, i, resolveS, fullPath, memo)`；P 中 arbitrateUnion 第 k 次 `next()` 触发 generator body 执行到第 k 个 `yield`，调用**同参**同一 `resolveLive`。控制流同构：每次拉动/迭代后先查 `kind === 'value'`（R: return r；P: return o——**同一对象按引用返回**），再查 missing 记账（sawMissing 更新点同位），reject 落空继续。
2. **首 value 短路等价**：R 在 value 处 return，循环终止、后序成员零 `resolveLive` 调用；P 在 value 处 return，for-of 提前退出触发 generator `.return()` 关闭，后序 yield **零执行**——后序 `resolveLive` 同样零调用。短路两侧试探集相等。
3. **异常传播逐点相同**：throw 源仍在 `resolveLive` 内（lockstep 断裂/深层违规形状等 E100 域）；generator 不捕获、for-of 不捕获、arbitrateUnion 不捕获——冒泡路径 `resolveLive(内层) → generator body → arbitrateUnion for-of → navigate → resolveLive(外层) → … → readLogicalValueAtPath 顶层 catch → C3(DOCRT-E100)`，与 rev1 内联形态**同点同序同形态**（rev1 H-2 风险面不变）。
4. **耗尽收尾同构**：迭代耗尽后 `sawMissing ? {kind:'missing'} : {kind:'reject'}`——构造点、对象新鲜性（每次聚合产出新对象，与 rev1 同）、空成员 union（`members: []` → 空 iterable → reject，rev1 循环零次同判）逐字一致。
5. **memo 写序不变（D13 挂点复核）**：`resolveLive` 每次调用的入口 memo 查询/出口写入 = 调用序的确定函数；P 的调用序与 R 逐位相同（论证 1）⟹ memoB 的键集、值、写入顺序完全一致——**D13 健全性论证零新假设，H-a 护栏（26 层链 × 中段 optional 缺席 <2s）锚点不变**。
6. **成本**：每成员新增 1 次 generator 帧切换 + iterator 协议调用——O(1)/成员 常数因子；渐近界 **O(触及节点数 × 路径长 × 成员扇出)** 同式不变（ADR-0007「普通读取成本与目标 path 子树规模相关」继续满足）。

#### 3.2.3 惰性契约的锁与诚实缺口声明（SA8 注记 R2-2 义务）

| 层 | 锁 | 证据/执行锚 |
|---|---|---|
| **seam 自身惰性** | arbitrateUnion 不物化、首 value 后零拉动 | rev2 纯测试行 2 `[value('v'), missing]` 断言 `pulled == [0]`（trackedOutcomes 拉动记录为具象化证据）——**动态锁，SA6 已锚定**；行 3-6 断言无 value 场景全量拉动 `[0,1]` |
| **调用点惰性**（union 分支以 generator 而非数组喂 seam） | memberOutcomes 为**具名 generator**（唯一 normative 形态，§3.2.1）；界定区域内零禁形命中 | **§3.2.3 静态门禁四命令**（下文；R1 修订成文：注释剥离口径 + generator 形态锁 + 唯一调用点锁 + 无第二仲裁实现锁）+ §3.2.1 伪代码 normative |
| **诚实缺口** | 调用点若违规物化（如 `node.members.map(m => resolveLive(...))`），**合法输入上公共面观测等价**（物化只多算被 memo 摊销的试探，结果不变；E100 域 throw 时序偏移仅在手造派生物上可见）——纯测试锁不到调用点 | 与 rev1 对竞争场景 green lock 缺口同款定性：观测等价必然，非设计疏漏；由 normative 伪代码 + §3.2.3 静态门禁四命令 + 代码评审三重防御。**不得**为锁它而给 `resolveLive` 加计数 seam（过度工程，且触碰 memo 挂点区域风险大于收益） |

**静态验尸四命令（normative，R1 修订成文——SA2 #1 三连缺陷修复；SA4 复跑、可直接入检查单）**：

```bash
f=packages/doc-runtime/src/read.ts
# 命令 1（禁形零命中——注释剥离后在界定区域内 grep 三形；JSDoc 已零字面量，剥离为双保险）：
sed -n '/^export function arbitrateUnion/,/^}/p' $f > /tmp/u-span1
sed -n '/function\* memberOutcomes/,/^}/p' $f      > /tmp/u-span2
sed -n "/case 'union':/,/case 'leaf':/p" $f        > /tmp/u-span3
cat /tmp/u-span1 /tmp/u-span2 /tmp/u-span3 \
  | perl -0777 -pe 's{/\*.*?\*/}{}gs; s{//[^\n]*}{}g' \
  | grep -nE 'Array\.from|\.map\(|\[\.\.\.'        # 验收：零命中（grep exit=1）= CLEAN
# 命令 2（generator 形态锁——封死「普通函数返回数组」漂移形态）：恰 1
grep -cE 'function\*[[:space:]]+memberOutcomes' $f
# 命令 3（唯一调用点锁）：恰 2 行命中（定义行 + arbitrateUnion(memberOutcomes(…)) 直接实参调用行）
grep -n 'memberOutcomes' $f
# 命令 4（INV-15 无第二仲裁实现——声明式锚点）：恰 1
grep -c 'let sawMissing' $f
```

口径与边界说明：(i) **区域行界** = 三条 sed span——seam 定义块、generator 定义块、`case 'union':`…`case 'leaf':` 块（放置序锚点见 §3.1.2）；span3 会按文件序同时命中 Phase A `decide` 与 Phase B `navigate` 两处 union case——**确定性成立且纳入无害**（Phase A 块现只含 `.some(`（非禁形），顺带守护 Phase A union 区域）；(ii) **注释剥离**为双保险——§3.1.2/§3.2.1 的 normative JSDoc 已按 R1 修订剔除禁形字面量与 `memberOutcomes` 标识符（两函数 JSDoc 亦不得引用该标识符），剥离使门禁对未来注释改动鲁棒（span 内字符串字面量无 `//`/`/*`，剥离无副作用）；(iii) **命令 4 采声明式锚点**（`let sawMissing` 恰 1）而非 SA2 原案字面 `grep -c 'sawMissing' == 1`——后者与已批准的 §3.1.2 伪代码自冲突（sawMissing 在 arbitrateUnion 体内合法见于声明/记账/收尾 3 行）；「`let sawMissing` 声明唯一 ⟺ 仲裁循环唯一」判据等价且对合规实现零误报，偏离理由成文于此；(iv) 四命令对冻结伪代码（§3.1.2/§3.2.1 落地后形态）**预期全过**——normative 条款与验收命令零自冲突的构造性保证（SA2 #1(a) 类缺陷不再有藏身处）。

### 3.3 D21：mutation proof 协议（AC-R2-4 成文；SA7 执行与证据义务）

#### 3.3.1 变异体定义

- **M-A（必做，owner 指认变异体）**：「首 missing 即返回」——施于 seam 内（read.ts `arbitrateUnion`），把规则 2 的记账行改为立即返回：

```ts
  // 变异 M-A（临时，验证后必须还原）：
  for (const o of outcomes) {
    if (o.kind === 'value') return o;
    if (o.kind === 'missing') return o; // ← 变异点：记账继续 → 立即返回（rev1 前旧策略语义）
  }
  return { kind: 'reject' };
```

（等价于 owner 原文「临时把循环改成『首 missing 即返回』，不继续扫描后续成员」；因 rev2 后 seam 是仲裁唯一权威（INV-15），单点变异即覆盖全部 union 仲裁路径——这正是可测性重构的兑付。）

- **M-C（R1 修订升格为必做，与 M-A 并列；SA2 #4）**：「物化后仲裁」——seam 函数体先 `const arr = Array.from(outcomes)` 再循环 arr。升格理由：M-C 是 D20 惰性契约（首 value 短路不预消费后序成员）的**唯一动态杀伤证据**（行 2 拉动断言 `[0,1]`≠`[0]`；结果断言仍绿——「物化只毁惰性不毁结果」的双断言语义恰由该行验证）；若跳过，D20 防线只剩静态锁。成本：1 行变异 + 单文件运行 + 同款还原纪律。
- **可选变异体（SA7 裁量，非 AC 义务）**：M-B「首 reject 即返回」（`if (o.kind === 'reject') return o;`）；M-D「missing 不记账视同 reject」（记账行改 `continue` 且删 sawMissing 收尾分支）。
- **矩阵基线注（R1 修订成文，SA2 #2）**：§3.3.2 矩阵是 SA7 证据记录基线——实测红集合若与矩阵冲突，须先按 §3.3.1 变异体定义逐行复查变异形态是否施加正确，再定性「实现被破坏」或「矩阵有误」；不得直接以实测覆盖矩阵记档。

#### 3.3.2 六行表 × 变异体杀伤矩阵（预期红的逐行依据）

| 变异体 | 行1 `[missing,value]→value` | 行2 `[value,missing]→value` | 行3 `[missing,reject]→missing` | 行4 `[reject,missing]→missing` | 行5 `[missing,missing]→missing` | 行6 `[reject,reject]→reject` | 公共面对照（R1-R5/H-a/H-b/H-c/SUP/主20） |
|---|---|---|---|---|---|---|---|
| **M-A 首 missing 即返回（必做）** | 🔴 结果断言（missing≠value）**且** 拉动断言（`[0]`≠`[0,1]`）双红 | 🟢 | 🔴 拉动断言（`[0]`≠`[0,1]`；结果碰巧同 missing） | 🟢 | 🔴 拉动断言（`[0]`≠`[0,1]`） | 🟢 | **全 🟢**（观测等价定理 Case 2 的实证——判别力仅由新增测试提供，即 owner P1 的兑付） |
| M-B 首 reject 即返回（可选；R1 勘误，SA2 #2：红集合 = {3,4,6}） | 🟢 | 🟢 | 🔴 结果（第 2 项 reject 返回 ≠ 期望 missing） | 🔴 结果（reject≠missing）+ 拉动（`[0]`≠`[0,1]`）双红 | 🟢 | 🔴 拉动（首项即返回，`[0]`≠`[0,1]`；结果碰巧同 reject） | H-b 🔴（`{bar}\|{foo?}` + live `{}` → PATH_NOT_ALLOWED ≠ undefined）；R4-3 同理 |
| M-C Array.from 物化（**必做**，R1 升格，SA2 #4） | 🟢 | 🔴 拉动断言（`[0,1]`≠`[0]`——短路被破坏，SA8 注记 R2-2 攻击面的直接锚；结果断言仍绿 = 「物化只毁惰性不毁结果」的双断言语义验证） | 🟢 | 🟢 | 🟢 | 🟢 | 全 🟢（结果不变，仅成本/惰性违例） |
| M-D missing 不记账（可选） | 🟢 | 🟢 | 🔴 结果（reject≠missing） | 🔴 结果（reject≠missing） | 🔴 结果（reject≠missing） | 🟢 | R4 组 🔴（全 missing → PATH_NOT_ALLOWED ≠ undefined）；H-b/H-c-2 同理 |

**owner 首行要求兑付**：M-A 下行 1 双红——前序成员已产出 missing 后，仲裁**结果**（应继续由后序真实 value 胜出）与**拉动证据**（应继续拉动第 2 成员）双双判别——正是 rev1 R1/R2/R3 缺失的变异判别力（AC-R2-2 首行语义）。

#### 3.3.3 执行协议（normative，SA7 报告记载全流程；R1 修订：还原双路径堵假 PASS/数据丢失——SA2 #3）

```bash
# Phase 0 基线（SA3 实现落地后）：全量绿（含 rev2 新文件 6 it 转绿）
pnpm test                                    # = vitest run --typecheck（root）

# Phase 0.5 前置条件（normative，R1 新增）：施加任何变异前，先确立「可还原基线」——二选一：
# 路径 P（首选：提交基线）——seam 实现先行 commit（实现提交 ≠ 变异提交，不违「变异态严禁
#   commit」纪律；变异只存在于工作树；总控裁量执行提交）后，下述命令必须为空输出：
git status --porcelain packages/doc-runtime/src/read.ts   # 空 ⟺ 基线已提交 ⟹ Phase 2 的 git checkout 可安全还原
# 路径 Q（备选：工作流禁中途 commit 时）——非破坏性快照：
cp packages/doc-runtime/src/read.ts /tmp/read.pre-mut.ts
sha256sum packages/doc-runtime/src/read.ts /tmp/read.pre-mut.ts   # 记录哈希（两者应相等）；保留至 Phase 2 验收通过

# Phase 1 施加变异（逐变异体执行：M-A 与 M-C 必做（§3.3.1），M-B/M-D 可选裁量；
#   每个变异体独立走完「施加 → 被测文件红 → 对照组绿 → 还原 → 复绿」再进入下一变异体）
#   M-A：seam 内规则 2 记账行 → 立即返回（§3.3.1 变异代码）；M-C：函数体首行物化（Array.from 后循环）
pnpm vitest run packages/doc-runtime/test/read-logical-value-at-path-rev2-union-arbitration-pure.test.ts
#   预期红（§3.3.2 矩阵基线）：M-A → 行 1/3/5（行 1 双红）；M-C → 行 2（拉动断言）
pnpm vitest run packages/doc-runtime/test/read-logical-value-at-path-rev1-union-arbitration.test.ts   # 对照：R1/R2/R3 所在，仍须全绿
pnpm vitest run packages/doc-runtime/                                          # 对照：全包其余套件，仍须全绿
#   记录：每变异体 diff、红文件/红用例逐条（对照 §3.3.2 矩阵，冲突时按 §3.3.1 矩阵基线注处置）、对照组绿清单

# Phase 2 还原（按 Phase 0.5 所选路径执行，两变异体各自还原）：
# 路径 P：git checkout -- packages/doc-runtime/src/read.ts
#         验收：git status --porcelain packages/doc-runtime/src/read.ts 为空输出（基线复原 = diff 归零）
# 路径 Q：cp /tmp/read.pre-mut.ts packages/doc-runtime/src/read.ts
#         验收：sha256sum packages/doc-runtime/src/read.ts == Phase 0.5 记录值
#               且 git diff packages/doc-runtime/src/read.ts 与 Phase 0.5 快照时的 diff 逐字节一致
pnpm test                                    # 全量复绿（最后兜底：任何残留变异都会在此暴露）
```

**证据义务**：Phase 0/0.5/1/2 的命令与关键输出（基线路径选择及依据、每变异体红清单、对照组绿、还原验收、复绿）记入 SA7 报告（AC-R2-4）；对照事实（R1/R2/R3 在 M-A/M-C 下仍全绿）同时是 AC-R2-3 措辞改写（「判别力仅由新增测试提供」）的证据底座。

**纪律与中断恢复（R1 修订改写——原「git status 检查并还原」在基线未提交场景下不可辨识，废除）**：

- **变异态严禁 commit/stage**（SA8 注记 R2-3(c)）——变异只存在于工作树；路径 P 的「实现提交」在施加变异**之前**完成，两者时序强制分离（实现提交 ≠ 变异提交）；
- **中断可辨识性**：路径 P 下 `git status --porcelain …read.ts` 非空 ⟺ 变异在场（基线已提交，唯一脏源即变异）⟹ 重走 Phase 2；路径 Q 下 `cmp /tmp/read.pre-mut.ts packages/doc-runtime/src/read.ts` 不一致 ⟺ 变异在场（或实现被误改）⟹ cp 回写后重走 Phase 2 验收；
- **路径 Q 应急**（/tmp 快照丢失且基线未提交）：以 `pnpm test` 全绿 + §3.2.3 静态门禁四命令全过作为「M-A/M-C 不在场」的替代判定（两变异体的定义性质即 rev2 文件必红/行 2 必红，全绿构成反证），同时在 SA7 报告记录事故并复核 SA3 实现完整性。

### 3.4 不变项显式复核（修订不触的 rev1/首轮裁决）

| 条款 | 复核结论 |
|---|---|
| **D17 四规则 + mixed 优先级**（rev1 §3.2/§3.3.2） | **逐字保持**——seam 函数体即 rev1 循环体的逐行迁移（§3.2.2 论证 1/4）；表驱动六行是对同一规则的第二锚（纯函数直驱） |
| **D16/INV-12 三态完备互斥** | 类型形状零改动；seam 出口仅三态规范化构造（value 按引用回传、missing/reject 新鲜构造） |
| **D13 memo**（挂点/键形/值域/上界） | `resolveLive` 本体零改动；调用序逐位相同 ⟹ 写序一致（§3.2.2 论证 5）；上界同式（论证 6）；H-a 护栏锚点不变 |
| **INV-13 观测等价** | §3.2.2 五点论证——rev2 对一切合法输入零可观测行为变更（公共结果逐字相同） |
| **INV-14 三态不泄漏** | 判据 = 包边界（§3.1.1 精确化）；index.ts 零新增导出；test-d 冻结形态锁保持绿；可选 H-d 负锁（§4） |
| **INV-7 精确化**（声明序 + 首 value 短路惰性） | generator 保序 for-of + seam 短路（§3.2.1/§3.2.2 论证 1/2）；red test 行 2 拉动断言动态锚定 |
| **Phase A / notAllowed / 顶层 try/catch / D5/D6/D8/D9/D10/D11/D12/D14/D15、C1-C2-C3、INV-1..11、INV-8 提交层** | 零触碰（§2 改动半径；DENY §8.3） |

---

## §4. 测试映射（AC-R2-1..R2-5 逐条对账）

### 4.1 AC 对照总表

| AC | 设计落点 | 验证锚（现状/落地后） |
|---|---|---|
| **AC-R2-1** seam + INV-14 + 惰性 | §3.1 D19（落位/导出形态/破例成文）+ §3.2 D20（惰性管线） | SA6 红灯文件 6 it：当前红签名 = `../src/read.js` 导出缺失（vitest 运行时 + typecheck TS2305 双通道）；seam 落地即转绿。test-d 冻结锁（从 `../src/index.js` 导入锚定五项公共面）不受影响保持绿。可选项 H-d（下）裁量补强 |
| **AC-R2-2** 六行表 | §3.3.2 矩阵（每行的契约语义 + 变异判别力逐行注明） | SA6 已锚定（commit `7f77384`，六行全齐：行 1 `[missing,value('v')]→value('v')` 含拉动证据 `pulled==[0,1]`；行 2 短路惰性 `pulled==[0]`；行 3-6 表驱动 + 全量拉动 `[0,1]`）——本设计不收窄、不重复 |
| **AC-R2-3** R1/R2/R3 措辞 | §1.3（分工成文：执行锚只在 seam，green lock 定位不冒充） | **SA6 已完成**（commit `7f77384`：文件头 rev2 勘误段 + describe 措辞「现行合法 schema/live 模型下不可构造竞争场景的行为一致性锁」；行为断言零改动）——SA3/后续 SA 零触碰 |
| **AC-R2-4** mutation proof | §3.3 D21 全协议（R1 修订：M-C 升格必做 + 还原双路径 + 矩阵基线注） | SA7 报告证据义务（Phase 0/0.5/1/2 命令 + M-A 红（行 1/3/5）+ M-C 红（行 2 拉动）+ R1/R2/R3 对照绿 + 还原验收（路径 P：porcelain 空 / 路径 Q：sha256 一致）+ 复绿） |
| **AC-R2-5** 不回归 + bump + DENY | §3.4 复核表 + §8 清单 | 全量套件复绿（rev1 18 绿灯 + H-a/H-b/H-c + SUP + 主 20 + extract 5 文件 + 全仓）；`package.json` 0.1.4；DENY 面零改动（SA4 set 比对） |

### 4.2 转绿机制与「不收窄 SA6 冻结契约」声明

SA6 红灯文件的契约锚点 = (a) deep import 路径与命名导出（`arbitrateUnion` 值导入 + `NavOutcome` type 导入，`verbatimModuleSyntax` 兼容）；(b) 六行表断言（结果 kind/value + 拉动序列）。本设计 §3.1/§3.2 的导出形态与签名**逐字满足** (a)；§3.2.2 论证 seam 行为满足 (b) 全部断言。**不收窄、不重写、不删改任何 SA6 断言**；如实现与冻结断言冲突，错在实现侧，按真实状态上报。

### 4.3 可选补充锚点（SA4/SA7 裁量落地，SA3 不编写）

- **H-d（INV-14 公共面负锁，建议优先纳入）**：新建 `packages/doc-runtime/test/read-logical-value-at-path-rev2-inv14-negative.test-d.ts`——`// @ts-expect-error` 自反转断言 `import { arbitrateUnion } from '../src/index.js'` 与 `import type { NavOutcome } from '../src/index.js'` 均编译失败（test-d 方法学出处 ADR-0004 D4；同文件正锁 `import { arbitrateUnion } from '../src/read.js'` 编译通过）。红灯触发条件：未来实现者把 seam 挂上公共 barrel（H-3 诱惑面的类型层死锁）。**不改既有 test-d 冻结文件**（新增文件承载，SA6 owned 纪律）。
- **M-B/M-D 可选变异体**（§3.3.1/§3.3.2）：SA7 在 M-A/M-C 必做之外裁量执行，同款还原纪律（M-B 验收口径 = 红集合 {3,4,6}，按 R1 勘误后矩阵）。

### 4.4 既有测试在 rev2 后保持全绿的理由（AC-R2-5 前半句）

- rev1 18 绿灯（R1-R5）：公共行为零变更（INV-13，§3.2.2）——fixture 经 `readLogicalValueAtPath` 公共面观测，seam 迁移对其不可见；
- H-a 成本护栏：memo 写序与调用序不变（§3.2.2 论证 5），`<2s` 锚点维持；H-b/H-c：mixed/嵌套 union 语义经 seam 逐字保持（D17 复核）；
- SUP/主 20/extract 5 文件：读取路径外或公共面行为锁，零触碰面；
- test-d 冻结形态锁：`../src/index.js` 公共面零变更。

---

## §5. 协议假设依据 (Protocol Assumption Evidence)

**无新增协议级假设**（本修订是纯包内代码重构：无 HTTP/WS/端口/进程/第三方库行为假设）。实现依赖的语言级/工具链事实及依据：

| 假设 | 依据类型 | 依据内容（具体引用） | 风险等级 |
|---|---|---|---|
| for-of 逐项拉动：循环体 return 后不再调用 iterator.next()（短路惰性的语言基础） | 现有测试引用 + 源码引用 | rev2 红灯文件行 2 断言 `pulled == [0]` 即该语义的可执行证明（trackedOutcomes harness 按此协议构造，SA6 commit `7f77384`）；rev1 read.ts:354-358 同款 for-of 短路已被 66 例绿锁覆盖 | 低 |
| generator 惰性：body 逐 next() 执行到下一个 yield，外部提前 return 触发 `.return()` 关闭、后序 body 零执行 | 源码引用 + 现有测试引用 | ES2015 generator 语义；rev1 实现零 generator 依赖、rev2 引入后的行为锚 = 行 1 `pulled==[0,1]` 与行 2 `pulled==[0]`（两断言合取即「该拉的都拉、不该拉的零拉」） | 低 |
| `.js` 后缀相对导入解析到同目录 `.ts`（deep import 通道成立） | 源码引用 | tsconfig.base.json `moduleResolution: "bundler"` + 既有先例：read.ts:24-25 `import ... from './extract.js'`、10 个测试文件 `from '../src/index.js'` 在 vitest + `tsc -p packages/doc-runtime/tsconfig.json` 双通道现绿；rev2 红灯文件已被 SA6 提交且红因**导出缺失**（非路径/解析失败）——通道本身已实证 | 低 |
| vitest include 面覆盖 deep import 测试文件 | 源码引用 | 根 vitest.config.ts `include: ['packages/*/test/**/*.test.ts']`（无按导入路径过滤）；typecheck 通道 `include: ['packages/*/test/**/*.test-d.ts']` | 低 |

## §6. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数/接缝

| 接缝 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `arbitrateUnion`（包内纯函数） | `packages/doc-runtime/src/read.ts`（新增，§3.1.2） | —（不存在；仲裁内联于 navigate） | `(outcomes: Iterable<NavOutcome>) => NavOutcome`，同步、纯（零 doc/memo/模块态）、不捕获异常（上浮）；**包内模块级导出，不经 index.ts**（INV-14） |
| `NavOutcome`（包内类型） | `packages/doc-runtime/src/read.ts:268` | 模块私有 `type`（形状：三态联合） | **形状零改动**；可见性：模块私有 → 模块级 `export`（仍包内私有，INV-14 判据 = 包边界） |
| `memberOutcomes`（包内 generator） | `packages/doc-runtime/src/read.ts`（新增，§3.2.1） | —（不存在） | `(union 节点, live, segs, i, resolveS, fullPath, memo) => Generator<NavOutcome, void, unknown>`，惰性；**不导出** |
| `navigate` union 分支 | `packages/doc-runtime/src/read.ts:351-360` | 内联 10 行仲裁，返回 `NavOutcome` | 经 seam 2 行调用，返回 `NavOutcome`（签名与值域零改动，控制流等价 §3.2.2） |
| `readLogicalValueAtPath`（公共） | `packages/doc-runtime/src/read.ts:42` | `(derived, doc, path) → ReadLogicalValueResult`，同步、不抛错 | **契约零改动**（签名/返回类型/语义逐字不变，INV-13）；index.ts 公共面零新增 |

**公共契约改动 = 无**：五类契约改动（return→throw / Promise 形态 / 同步→异步 / catch rethrow / nullable 翻转）逐项为零；新增接缝全部包内（`arbitrateUnion` 不上 index.ts）；`NavOutcome` 仅可见性包内放宽，形状冻结。

### Caller 清单

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| `arbitrateUnion` ← `navigate` union 分支 | `packages/doc-runtime/src/read.ts:351`（改写后） | 否（同步） | ❌ 裸调用（有意：异常沿 rev1 同路径上浮，§3.2.2 论证 3） | ✅ `readLogicalValueAtPath` 顶层 try/catch（D11/E100 收编） | 现有 catch 已处理；调用点按 §3.2.1 伪代码落地 |
| `arbitrateUnion` ← SA6 rev2 测试 deep import | `packages/doc-runtime/test/read-logical-value-at-path-rev2-union-arbitration-pure.test.ts:37` | 否 | 测试内 `expect`（纯函数直驱，无 throw 路径——trackedOutcomes 不 throw） | — | 契约满足即绿（§4.2）；SA6 owned 冻结 |
| `NavOutcome` 消费者 | `read.ts` 内部（`navigate`/`resolveLive`/`memoB` 注解 L56/L284 等）+ rev2 测试 `import type`（L38，`verbatimModuleSyntax` 合规） | — | — | — | 类型形状零改动 ⟹ 全部消费点零适配 |
| `memberOutcomes` ← `navigate` union 分支 | `read.ts`（§3.2.1，唯一 caller） | 否 | ❌（同 arbitrateUnion——throw 上浮路径不变） | ✅ 同上 | 包内私有，无其他 caller |
| `readLogicalValueAtPath` 存量 caller | doc-runtime 测试 6 文件（`grep -rn "readLogicalValueAtPath" packages/ apps/` 全部命中；公共面消费全经 `../src/index.js`） | 否（同步） | 测试内 `expect` | — | 行为零变化（INV-13）；AC-R2-5 全量复绿即护栏 |

**风险评估**：改动半径 = 包内 2 个新增函数 + 1 处分支改写 + 1 个类型可见性放宽；公共 API 面零变化；包外零新 caller；不存在 return→throw / 同步→异步 / nullable 类 rippling。异常路径唯一性论证见 §3.2.2 论证 3（throw 点仍在 resolveLive 内，传播序不变）。

---

## §7. 不变量增量表（并入 rev1 INV-1..14）

| # | 不变量 | 验证锚 |
|---|---|---|
| **INV-15（rev2）** | 仲裁单点权威：read.ts union 分支的成员结局聚合**唯一**经 `arbitrateUnion` seam；seam 零 doc 访问、零 memo 访问、零模块级状态；惰性契约（首 value 不拉后序、无 value 全量拉动）由纯测试拉动断言锚定 | rev2 纯测试行 1-6；**§3.2.3 静态门禁四命令**（含 `function* memberOutcomes` 形态锁恰 1 / `memberOutcomes` 恰 2 行 / `let sawMissing` 恰 1 = 无第二仲裁实现，R1 修订）；mutation proof M-A/M-C（单点变异即全路径转红） |
| INV-14（判据精确化，成文非语义变更） | 「三态不泄漏」约束单位 = **包边界**（index.ts 转出口）；模块级 export 属包内私有；deep import 破例仅限同包测试（SA8 注记 R2-1 批准） | test-d 冻结锁保持绿；index.ts 导出面 grep 零新增；可选 H-d 负锁；**package.json exports map（`".": "./src/index.ts"`）+ `private: true` 结构性强制——包外 deep import 被 Node `ERR_PACKAGE_PATH_NOT_EXPORTED` / TS bundler 双侧阻断（R1 补引，SA2 #5）** |

---

## §8. 文件清单（File Scope）

> 对账基线：rev2 修订轮以 `7f77384`（SA6 红灯锚定入库点）为 diff 基线——**§8.1 即该基线下的预期改动面**。若 SA4 采用 origin/main 基线，PR #83 全程面 = §8.1 ∪ §8.2 ∪ 首轮/rev1 已评审面（rev1 §8 注记同款）。

### 8.1 ALLOW LIST（rev2 修订轮改动面）

- `packages/doc-runtime/src/read.ts` — 修改（~35 行 delta，区域边界见 §2）：(a) `NavOutcome` 加 `export` + JSDoc rev2 段（§3.1.2）；(b) 新增 `export function arbitrateUnion`（§3.1.2 逐字）；(c) 新增包内私有 `function* memberOutcomes`（§3.2.1，具名 generator 唯一 normative 形态）；(d) union 分支（现行 351-360 行）改经 seam（§3.2.1）；(e) 文件头 JSDoc 一行 rev2 注记。**SA4 静态义务**：本文件 diff 不得触及 Phase A/`notAllowed`/顶层编排/其余分支；**§3.2.3 静态门禁四命令全过**（注释剥离后界定区域禁形零命中 + `function* memberOutcomes` 恰 1 + `memberOutcomes` 恰 2 行 + `let sawMissing` 恰 1；R1 修订）
- `packages/doc-runtime/package.json` — 修改（1 行）：version `0.1.3 → 0.1.4`（硬门禁 #9；仅 version 字段）
- `packages/doc-runtime/test/read-logical-value-at-path-rev2-union-arbitration-pure.test.ts` — `[SA6 owned]` rev2 红灯锚（commit `7f77384` 已入库，零新改动预期）：SA3 实现使其转绿，**不得改断言/不得收窄契约**；仅测试基础设施级修复允许
- `packages/doc-runtime/test/read-logical-value-at-path-rev1-union-arbitration.test.ts` — `[SA6 owned]` rev2 措辞勘误已由 SA6 完成（commit `7f77384`，AC-R2-3，行为断言零改动）；后续阶段零改动预期（同上纪律）
- `packages/doc-runtime/test/read-logical-value-at-path-rev2-inv14-negative.test-d.ts` — 新建（**可选**，SA4/SA7 裁量锚点 H-d：公共面 `@ts-expect-error` 负锁，§4.3；SA3 不编写）

### 8.2 ALLOW LIST（预期零改动 · SA6 owned 冻结锁——仅测试基础设施级修复可触，不入 DENY）

- `packages/doc-runtime/test/read-logical-value-at-path.test.ts` / `read-logical-value-at-path.test-d.ts` / `read-logical-value-at-path-supplementary.test.ts` / `read-logical-value-at-path-rev1-hardening.test.ts` — `[SA6 owned]` 首轮/rev1 冻结契约与护栏；test-d 冻结形态锁的**保持绿**即其存在形态
- `packages/doc-runtime/test/extract-*.test.ts`（5 文件） — `[SA6 owned]` #73 回归基线

### 8.3 DENY LIST（rev1 延续 + rev2 收紧表述；生产面护栏）

- `packages/vfsl/src/**`（pattern.ts / evaluate.ts / derived.ts / validate.ts / envelope.ts 等）— 结构系统冻结；**不得为凑测试虚构可达性而放宽**（SA5 Fix direction + SA8 注记 R2-4；E309 等禁令是竞争不可达论证的前提事实）
- `packages/doc-runtime/src/index.ts` — 任何改动禁止（rev2 收紧：**公共导出零新增**——`arbitrateUnion`/`NavOutcome` 不得经此转出口；INV-14/test-d 冻结锁/SA8 实测冻结五项）
- `packages/doc-runtime/src/extract.ts` / `carrier.ts` — 行为变更禁止；extract.ts 首轮已评审的 `walk`/`makeRefResolver` 包内导出属存量，不回退、本轮零新改动（SA8 注记 R2-4）
- `packages/doc-runtime/src/read.ts` 中 Phase A 全部（`isPathAllowed`/`decide`/`makeValuesResolver`/`vChild`/`keyAllowed`）、`notAllowed`（含 SA4-F2 守卫）、顶层 try/catch 编排、map/array/leaf/plain/xml-fragment 分支、终点 `walk` 委托、`resolveLive` 本体（memo 挂点结构） — **子文件级 DENY**：read.ts 整体在 ALLOW，但改动仅限 §2/§3.1/§3.2 划定的 seam 与 union 分支区域
- `packages/vfsl-protocol/**`、`packages/persistence/**`、`packages/dsh-persistence/**`、`packages/vfsl-codegen/**`、`apps/**`、根配置（vitest.config.ts / tsconfig*.json / package.json 根） — 与本修订无交集
- 注：`wiki/raw/**`、`.mabf*/**`、`REPORT.md` 为 SA 工作流档案（本设计文档自身所在），非代码面，不参与代码 scope 比对；**严禁提交 `.mabf/**` 与 `.mabf-bg/**`**（修订轮 push 纪律）

---

## 附 A. 与 rev1 设计的条款对照（本修订取代/增补哪些条款）

| rev1 条款 | rev2 处置 |
|---|---|
| §3.2 navigate union 分支内联仲裁伪代码 | **载体迁移**（§3.2.1）：10 行内联 → seam 2 行调用 + generator；D17 四规则逐字保持（§3.4 复核） |
| §3.1 D16 `NavOutcome`（模块私有） | **可见性放宽**（§3.1.2）：模块级 export；形状零改动；INV-14 判据精确化（§7） |
| §4 H-b 注记「对『首 missing 即返回』两序均无检测力——观测等价必然，非缺口」 | **缺口补齐**（§1.2/§3.3）：判别力经 seam 注入（owner 第二轮 Review 把观测等价必然升格为合并阻塞项——green lock 定位不变，执行锚由纯函数测试承担）；该注记的历史定性作为对照事实的机理依据保留 |
| §6 caller 表 / §8 文件清单 | **增量更新**（§6/§8）：新增 seam caller 行；ALLOW 面换 rev2 基线（read.ts seam 区域 + version bump） |
| D17/D18/D13 重述/INV-12/13/14、其余全部条款 | **原样有效**（§3.4 显式复核） |

## 附 B. 设计自检（SKILL 一致性）

- **冻结契约不收窄**：SA6 rev2 红灯契约（deep import 路径/命名导出/六行断言）逐字满足（§4.2）；公共签名/两态联合/AC3 缺键形态零改动（§6）；R1/R2/R3 行为断言零触碰（§8.1 SA6 owned 注记）；
- **SA8 注记逐条落实**：R2-1 seam 落位 + deep import 破例成文（§3.1.1/§8.1）；R2-2 惰性攻击面（§3.2.1 normative 禁令 + §3.2.3 锁与诚实缺口 + 静态门禁四命令）；R2-3 mutation proof 卫生（§3.3.3 还原双路径 + 禁泄漏纪律 + 中断可辨识性）；R2-4 DENY 延续（§8.3）；R2-5 SA6 owned 分工（§4.1/§8.1）；
- **拒绝虚假降级**：无降级场景引入；E100 域异常传播路径逐点不变（§3.2.2 论证 3），不吞不转；手造派生物守卫零触碰；
- **架构一致性**：不推翻任何 ADR 与 rev1/首轮决策；seam 是 D17 的载体迁移（SA8：「既有不变量的实现载体迁移，不构成 ADR 演进」）；extract.ts 包内导出先例同款；
- **一致性 grep 自检**：「arbitrateUnion」在 §3.1（定义）/§3.2（调用）/§3.3（变异点）/§6（caller）/§8（ALLOW）五处口径一致（签名 `Iterable<NavOutcome> → NavOutcome` 统一）；「物化」禁形清单集中于 §3.2.3 静态门禁（代码内 §3.1.2/§3.2.1 两处 JSDoc **零禁形字面量与 memberOutcomes 标识符**——门禁零自命中前提，R1 修订）；「首 missing 即返回」仅指 M-A 变异体；「包内私有」均按 INV-14 包边界判据使用（R1 补 exports map 结构性后盾）；「短路」均指首 value 停止拉动；行号引用（read.ts:268/351-360）与 2026-08-22 现状实测一致；
- **协议假设**：无新增协议级假设，语言级事实四项全带依据（§5）；
- **契约审计**：公共面零改动、包内 caller 列全（§6 三栏齐备）；
- **ALLOW/DENY**：SA6 owned 测试全部在 ALLOW 且带标签、不入 DENY（§8.1/§8.2）；DENY 为生产面护栏；修订轮 push 纪律（禁 `.mabf/**`）成文（§8.3 注）；
- **SA2 R1 修订落实（5 项）**：#1 静态门禁四命令（§3.2.3）/JSDoc 零字面量（§3.1.2/§3.2.1）/IIFE 变体撤销/放置位置成文（§3.1.2）；#2 M-B 矩阵勘误（§3.3.2）+ 矩阵基线注（§3.3.1）；#3 还原双路径 + 中断可辨识（§3.3.3）；#4 M-C 升格必做（§3.3.1/§3.3.2/§3.3.3/§4.1/§4.3/摘要/决策总表）；#5 exports map 补引（§3.1.1/§7）。伪代码**语句主体**与五点等价论证零改动（R1 修订仅触及 JSDoc 措辞、协议条款、矩阵标注与验证锚点——SA2「无需重新设计」裁定的执行边界）；「承认但改」零条目。

---

## SA2 反馈逐条回应（R1 评审 verdict = reject（窄域）；5 项发现已逐条落实，2026-08-22）

评审报告：`wiki/raw/task_read-logical-value-at-path_rev2_sa2_review.md`（架构本体 D19/D20/D21/INV-15、§3.1.2/§3.2.1 伪代码主体、五点等价论证、INV-14 包边界判据——经独立攻击全部存活，无需重新设计；驳回限于验证协议层 5 项）。逐条落实记录：

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| #1（MAJOR）禁物化静态验尸三连缺陷：(a) JSDoc 字面量致 grep 自命中 (b) 「普通函数返回数组」形态锁不到 (c) 放置位置与 grep 区域行界未成文 | ✅ | §3.1.2（JSDoc + 放置位置）/ §3.2.1（JSDoc + IIFE 撤销）/ §3.2.3（静态门禁四命令 + 口径说明）/ §8.1 / §7 INV-15 锚点 | (a) 两处 normative JSDoc 禁物化表述改写为**零禁形字面量**（引 §3.2.3 禁形清单），grep 口径同时定为**注释剥离后**执行（双保险）；(b) 新增形态锁：`grep -cE 'function\*[[:space:]]+memberOutcomes'` 恰 1 + `grep -n 'memberOutcomes'` 恰 2 行（定义 + `arbitrateUnion(memberOutcomes(…))` 直接实参唯一调用点；两函数 JSDoc 不得引用该标识符）；原「IIFE 可接受变体」**撤销**（会使形态锁失锚），具名 generator 为唯一 normative 形态；INV-15「无第二仲裁实现」操作化为 `grep -c 'let sawMissing'` 恰 1——**采声明式锚点而非原案字面 `grep -c 'sawMissing'` 恰 1**（后者与已批准伪代码自冲突：sawMissing 在 arbitrateUnion 体内合法见于声明/记账/收尾 3 行；「let 声明唯一 ⟺ 仲裁循环唯一」判据等价且对合规实现零误报，偏离理由成文于 §3.2.3 口径说明 (iii)）；(c) 放置位置成文（顶层函数序固定：NavOutcome → arbitrateUnion → memberOutcomes → resolveLive → navigate），grep 区域行界以三条 sed span 精确界定（span3 按文件序同时覆盖 Phase A decide 与 Phase B navigate 两处 union case——确定性成立、Phase A 块无禁形，纳入无害，说明成文于口径说明 (i)） |
| #2（MAJOR）§3.3.2 M-B 矩阵行 3/6 预测错误（正确红集合 = {3,4,6}） | ✅ | §3.3.2 M-B 行 / §3.3.1 矩阵基线注 | 行 3 → 🔴 结果红（M-B 在第 2 项返回 reject ≠ 期望 missing）；行 6 → 🔴 拉动红（首项即返回，`[0]`≠`[0,1]`；结果碰巧同 reject）；行 4 维持结果+拉动双红；红集合更正为 {3,4,6}。§3.3.1 新增「矩阵为 SA7 证据记录基线，实测红集合与矩阵冲突时先复查变异形态再定性，不得直接以实测覆盖矩阵记档」。M-A/M-C/M-D 预测未动（SA2 复核确认无误） |
| #3（MAJOR）还原协议假 PASS/数据丢失路径（`git checkout` 隐含「已提交」前置；实现未提交时被抹且 porcelain 空输出假 PASS；中断不可辨识） | ✅ | §3.3.3 全节改写 | 新增 **Phase 0.5 前置条件双路径**：路径 P（首选）seam 实现先行 commit（成文「实现提交 ≠ 变异提交，不违『变异态严禁 commit』；变异只在工作树；时序强制分离」）+ `git status --porcelain` 空验证 ⟹ 还原用 `git checkout` 安全，验收 = porcelain 复空；路径 Q（禁中途 commit 时）cp + sha256 非破坏性快照，还原 = cp 回写，验收 = sha256 相等 **且** `git diff` 与施变异前逐字节一致（废除未提交基线下「porcelain 空输出」验收口径）；「中断恢复」按两路径改写为可辨识版本（P：porcelain 非空 ⟺ 变异在场；Q：cmp 判定）+ 路径 Q 应急（快照丢失：全绿 + §3.2.3 四命令反证 M-A/M-C 不在场 + 事故记录与 SA3 实现复核） |
| #4（MEDIUM）M-C 应升格（D20 惰性契约唯一动态杀伤证据） | ✅ | §3.3.1 / §3.3.2 / §3.3.3 / §4.1 / §4.3 / 摘要 / 决策增量总表 | M-C（物化变异）从可选**升格为必做**（与 M-A 并列），升格理由成文（行 2 拉动断言是 D20 惰性契约唯一动态杀伤证据；「物化只毁惰性不毁结果」的双断言语义恰由该行验证）；协议命令（Phase 1 逐变异体独立走完施加→红→对照→还原→复绿）、矩阵标注（必做）、AC-R2-4 对照行、可选锚点清单、摘要与决策总表七处口径同步；M-B/M-D 维持可选 |
| #5（LOW）INV-14 补引 package.json exports map + private:true 结构性后盾 | ✅ | §3.1.1 新增「INV-14 结构性后盾」段 / §7 INV-14 行锚点 | 补引实测事实：`"exports": { ".": "./src/index.ts" }` + `"private": true`——包外 deep import 被 Node（`ERR_PACKAGE_PATH_NOT_EXPORTED`）与 TS bundler 双侧结构性阻断，INV-14 是**被包管理器强制的事实**而非纯纪律；据此 H-d 负锁只需锁 barrel 面、包外 deep import 类型层拒绝自动生效无需额外测试；前瞻注记（解除 private/发布时 exports 面即公共契约边界，须重审 INV-14） |

**一致性自检（R1 修订后复跑）**：静态门禁四命令与冻结伪代码（§3.1.2/§3.2.1 落地形态）零自冲突（§3.2.3 口径说明 (iv)——含命令 4 对合规实现恰 1 的验证）；「必做 = M-A + M-C」在摘要/决策总表/§3.3.1/§3.3.2/§3.3.3/§4.1/§4.3 七处口径一致；M-B 红集合 {3,4,6} 在 §3.3.2 矩阵与 §4.3 两处一致；还原双路径在 §3.3.3 与摘要两处一致；IIFE 变体撤销后全文无「可接受等价变体」残留、具名 generator 唯一形态口径统一（§3.2.1/§3.2.3/§8.1）；伪代码**语句主体**与五点等价论证零改动（R1 修订仅触及 JSDoc 措辞、协议条款、矩阵标注与验证锚点——SA2「无需重新设计」裁定的执行边界）。
