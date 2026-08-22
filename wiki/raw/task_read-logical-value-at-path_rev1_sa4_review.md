# SA4 静态验尸报告 — rev1 实现（readLogicalValueAtPath Phase B union value-first 硬化）

**Date**: 2026-08-22
**Verdict**: **pass**
**被审对象**: SA3 实现 commit `c4c2c73`（`packages/doc-runtime/src/read.ts` 三态化 + value-first 仲裁 62 行 delta、`package.json` 0.1.2→0.1.3、rev1 契约测试 5 行基础设施修复）
**设计基准**: `wiki/raw/task_read-logical-value-at-path_rev1_design.md`（D16/D17/D18/D13 重述，含 SA2 R1 勘误回流）；SA2 评审 pass；SA8 复审 clear
**验收输入**: 总控亲跑 `pnpm typecheck` 六工程 exit 0 + `pnpm test` 58 文件 821 例全绿（`.mabf-bg/verify-after-sa3-rev1.log`，本报告独立复核其中 rev1 文件 18 例确实在列）

---

## 审核结论

1. **设计一致性：✅ 一致**（§1 详述：D16/D17/D18 伪代码与实现逐行比对零偏离；公共契约冻结/DENY/版本 bump 全部核验）
2. **读写路径一致性：✅ 一致**（纯只读 API；live 数据源单一 = `probeRoot(doc)` 的 ROOT Y.Map；本次 diff 零写入路径）
3. **静默失败：✅ 无**（`navigate` 一切出口必产 NavOutcome；顶层映射 `value/missing/else reject` 三分支穷尽；throw 路径收束 D11 顶层 catch → E100 结构化返回）
4. **降级方案：✅ 安全**（无新增降级。missing→undefined 为 D8 契约吸收；**H-4 风险未实现**——required 缺席仍 reject（read.ts:340），SUP-2 Phase B 26 层 required 缺席 → `PATH_NOT_ALLOWED` 护栏在本轮 120 例中保持绿）
5. **极端攻击：✅ 安全**（零成员 union/嵌套 union/-0/2^53 下标/显式 undefined map 值/undefined 数组元素/空路径/26 层深链成本——静态推演 + 14 项探针实证，见 §5；未发现漏洞）
6. **错误处理：✅ 完整**（D6 失败单通道原样；reject 顶层 message 措辞 `'路径无法在 live 数据上解析（不变量外输入）'` 与修订前逐字一致）
7. **架构评估：✅ 可行**（单文件 62 行策略层改动，零绕过、零 FIXME、零临时补丁；无退回 SA1 信号）
8. **过度设计：✅ 精简**（62 行 vs 设计 ~50 行预估（含 JSDoc），量级相符；除 owner 明文要求的三态类型外零新抽象）

---

## §1 设计一致性审查（重点核验项 1）

### 1.1 文件清单 Scope Creep Guard — ✅ 无越界

- **ALLOW LIST**（设计 §8.1，rev1 轮以 `23851e1` 为对账基线）：`read.ts`（修改）、`package.json`（version bump）、`read-logical-value-at-path-rev1-union-arbitration.test.ts`（SA6 owned，仅基础设施级修复）、`read-logical-value-at-path-rev1-hardening.test.ts`（可选，SA4/SA7 owned）。
- **actual diff**（`git diff --name-only 23851e1..c4c2c73`）：代码面恰好 3 文件 = read.ts + package.json + rev1 测试文件，**全部 ⊆ ALLOW**；其余为 `wiki/raw/**` 流水线档案（白名单豁免）。
- **BLACKLIST**：零命中（无 package-lock.json / yarn.lock / TASK.md / *.bak / .DS_Store）。
- **DENY LIST 核验（零改动实证）**：`git diff --name-only 23851e1..c4c2c73 -- packages/vfsl packages/doc-runtime/src/extract.ts packages/doc-runtime/src/carrier.ts packages/doc-runtime/src/index.ts` → **空**。Phase A（`isPathAllowed`/`decide`/`makeValuesResolver`/`vChild`/`keyAllowed`）、`notAllowed`（含 SA4-F2 守卫）、顶层 try/catch 编排在 c4c2c73 diff 中**零字节触碰**（diff 逐行核读确认）。
- **版本 bump（硬门禁 #9）**：`packages/doc-runtime/package.json` `"version": "0.1.2" → "0.1.3"`，仅 version 单行，✅。
- 本报告附带产物：`packages/doc-runtime/test/read-logical-value-at-path-rev1-hardening.test.ts`（SA4 裁量落地，见 §4——设计 §8.1 显式列名的可选条目，SA4 owned，非 SA3 越界）。

### 1.2 D16/D17/D18 伪代码逐行比对 — ✅ 零偏离

以设计 §3.2 伪代码（`// rev1` 标注行）对照实现 read.ts L305-367 + L78-82，**逐行一致**：

| 设计条款 | 实现落点 | 比对结果 |
|---|---|---|
| D16 `NavOutcome` 三态（value/missing/reject，包内私有） | read.ts:268-271，**无 `export`**（INV-14 三态不泄漏 ✓）；JSDoc 逐字采纳设计 §3.1 注释 | ✅ |
| D17 union 分支：`sawMissing` 记账 + 声明序循环 + 首 value 胜 + `sawMissing ? missing : reject` | read.ts:351-360，逐字符等价（含规则 1/2/3/4 注释锚） | ✅ |
| D18 十处结局编码：M1 Record 缺键→missing（:332）/ M2 optional→missing vs M4 required→reject（:339-340）/ M3 越界→missing（:348）/ M5 载体错位→reject（:326/:346）/ M6 段型→reject（:325/:345）/ M7 无字段→reject（:336）/ M8 终点 issue→reject + M9 快照→value（:317-318）/ M10 终态下钻→reject（:364） | 实现与三分法表 M1-M10 **一一对应、无遗漏分支**（missing 产出点恰三处，与 INV-12 声明一致） | ✅ |
| 顶层三态→两态映射（value→显式 value 键 / missing→显式 value:undefined / reject→notAllowed 同款 message） | read.ts:79-82，message 措辞逐字一致 | ✅ |
| `memoB` 键形 `Map<StructureNode, Map<unknown, Map<number, NavOutcome>>>` 值域扩展 | read.ts:56 形不变 | ✅ |
| root 委托零消耗 / ref throw 防御 / walk 终点委托 `[...fullPath]` | :322-323 / :365-366 / :316 | ✅（零改动区逐字保持） |
| 「未标注行与现行逐字一致」声明 | diff 中未标注行为仅注释级改写（Record 分支 D15 长注释压缩为单行、union 循环注释更新），**行为零变更** | ✅ |

**公共契约冻结核验**：`ReadLogicalValueResult` 联合（read.ts:33-35）、函数签名（:42-46）、同步不抛错（FC-1）、`test-d.ts` 形态锁——diff 零触碰；caller 全景 grep 复核（`grep -rn readLogicalValueAtPath packages/ apps/`）= read.ts 本体 + index.ts 转出口 + extract.ts/vfsl-index 两处 JSDoc/注释级提及（非调用）+ 测试四文件——**无生产调用点**，§1.6 契约连锁审计无 rippling 面（无 return→throw / 同步→异步 / nullable 变化）。

### 1.3 E2E spec 触发性（技能 §1.3）— **N/A**

本任务 diff 无任何 `*.spec.ts` 文件（纯 vitest 单测包）。无 E2E 接线义务。

### 1.4 vitest 触发性自检（硬门禁 #14）— ✅ 已接通，`verdict: ok`

- 本轮涉及 `*.test.ts`：`read-logical-value-at-path-rev1-union-arbitration.test.ts`（SA3 修改）+ `read-logical-value-at-path-rev1-hardening.test.ts`（SA4 新增），均位于 workspace package `@nomicore/doc-runtime`（`packages/doc-runtime/package.json` name 字段核实）。
- CI 接线证据（`.github/workflows/ci.yml`，全仓唯一 workflow）：`test` job（node 20/24 双矩阵）第 38-39 行 `pnpm test` → 根脚本 `"test": "vitest run --typecheck"` → 根 `vitest.config.ts` `include: ['packages/*/test/**/*.test.ts', ...]`——**通配覆盖 `packages/doc-runtime/test/**`，两文件均落入触发范围**（本包无 --filter 需求，root 级全量触发）。
- 类型面：`pnpm typecheck`（ci.yml 第 35-36 行）串联 `tsc -p packages/doc-runtime/tsconfig.json`，其 `include: ["src/**/*.ts", "test/**/*.ts"]` 覆盖测试文件——`.test.ts` 内类型错误（如 TS2339 类）由该步拦截（本轮 A/B 实证即走此通道）。
- 定向步骤（persistence-contract / domains-scaffold）为附加可见性步骤，不影响本包覆盖判定。
- **结论：无 `vitest-package-not-triggered` 黑洞；SA7 动态验证时按 §动态重点 #1 摘 CI 日志实证。**

### 1.5 协议假设复跑（技能 §1.5）— ✅ 全部相符

设计 §5 表六行假设，其中「设计期实测验证」四行本报告**独立重跑**（tsx 直跑 worktree 源码，临时脚本用后即删，worktree 源码零改动）：

| 假设 | 复跑结果 |
|---|---|
| 标量/容器混合联合被源头拒绝（E309） | ✅ `parseVfsl('{ foo?: YLeaf<string> } \| YLeaf<string>；…')` → `VFSL-E309: 同步物化上下文混合联合：标量形与容器形并存`（与 SA5 引文逐字一致） |
| `Y.Array` 显式 undefined 元素公共 API 不可构造 | ✅ 两种构造序均 loud 抛 `Cannot read properties of undefined (reading 'constructor')`（standalone `insert([undefined])` 后集成时抛 / 集成后 `insert` 时抛）——与 SA5 引文一致。**勘误注记**：抛点在集成边界，standalone 未集成数组的 insert 单独不抛（首轮探针不完备所致，非设计错误）；结论（界内 `get(i)` 恒非 undefined）不受影响 |
| map 显式 undefined 值 = D4 缺席 | ✅ `Y.Map.set('foo', undefined)` 可存 → 读 `['x','foo']` → `{ok:true, value:undefined}`（value 键显式存在） |
| 终点 walk 快照恒非 undefined（INV-12 支点） | ✅ 源码级复核：`walk` leaf/plain 分支 `carrierOf(undefined) → null ≠ 'plain value' → mismatch issue`（extract.ts:142 + carrier.ts 尾分支）——即使假设 2 被未来放宽，undefined live 在终点产 **issue→reject** 而非 value-undefined，INV-12 封闭性与设计 §1.3(b) 推演一致 |

「源码引用」两行（`Y.Map.get` 缺键判据、memo 哨兵）行号抽查命中且本轮 120 例 + A/B typecheck 背书。**无 `unverified-protocol-assumption` / `protocol-assumption-mismatch`**。

### 1.6 契约改动连锁（技能 §1.6）— ✅ 白名单通过

改动面 = 包内私有类型值域 + 三处包内消费点（`navigate`/`resolveLive`/`readLogicalValueAtPath` 尾部），公共 API 五类契约改动逐项为零；caller 仅测试文件（同步、expect 断言、无 fire-and-forget）；无 uncaught rippling 面。

### 1.7 源码 GREP 断言禁令（技能 §1.7）— ✅ 无命中

本轮改动/新增的两个测试文件均无 `readFileSync`+`toMatch/toContain` 源码字符串断言；全部为运行时行为断言（公共 API 返回值、`Object.hasOwn` 形态断言、extract ground truth 交叉、计时护栏）。

---

## §2 测试基础设施修复核验（重点核验项 2）— ✅ 声称成立（A/B 实证）

SA3 上报：expectOkValue 改 `asserts` 签名（5 行），收敛 rev1 契约测试入库后暴露的预存 TS2339。**A/B 实证**（`tsc -p packages/doc-runtime/tsconfig.json`）：

- **A（当前树 c4c2c73）**：exit 0，零错误；
- **B（还原 SA6 23851e1 原版 helper 后）**：**恰好 9 处 TS2339**，全部为 `Property 'value' does not exist on type 'ReadLogicalValueResult'`，全部位于测试文件 `expectOkValue(r); expect(r.value)` 调用点（行 112/119/164/171/211/290/297/304/311）——非 asserts 签名无法窄化联合，**与 read.ts 改动零关联（B 中 read.ts 无任何报错）**；
- **断言逻辑零改动**：diff 仅删 `return result.value;` 与签名行；`expect(result.ok).toBe(true)` + throw 分支逐字保留；**调用点零改动**（SA6 入库时即为 `r.value` 访问模式，首轮主测试文件的返回值消费模式不受影响）。

定性：**测试基础设施级**（类型窄化通道修复），符合设计 §8.1 对 SA6 owned 文件「仅允许测试基础设施级修复」的授权边界。`git checkout` 还原后 packages 区 clean。

---

## §3 行为等价与测试基线（AC-R4/AC-R5）— ✅

- **AC-R5 全绿护栏**：本报告独立复跑 doc-runtime 全包 `vitest run packages/doc-runtime/test/` → **10 文件 120 例全绿**（含首轮 20 + supplementary 28（12 it 展开）+ rev1 18 + extract 5 文件基线 + 本轮新增 3）；总控全量 821 例（58 文件）日志复核 rev1 文件 18 例在列。观测等价定理的行为锚未被推翻。
- **探针矩阵（SA5 24 矩阵关键项在新实现上复验）**：owner 反例翻案（Record 先 + live {foo:"v"} 读 [x,foo] → `"v"`）、真缺席 → 显式 undefined、载体错位 → reject、6a/6b 终点=union 投影 swap 合法变值（`{foo:"v",bar:"w"}` vs `{foo:"v"}`）、mixed 两序均 missing 胜——**全部与 SA5 旧实现实测逐字一致**（观测等价的独立实证）。
- **嵌套 union（SA2 攻击点 #5 成文条款的行为验证）**：5 例探针全 PASS——子 union value → 外层首 value 胜；子 union missing + 外层 reject → missing 胜 → undefined；子 union reject 不短路外层循环 → 后序成员 value 胜。递归聚合语义与设计 §3.2「嵌套 union 位」逐条吻合。
- **AC-R4**：owner 五类测试全部在库（R1-R5 组 18 例）+ 本轮 H-a/H-b 补锚（§4）。

---

## §4 SA2 移交锚点 H-a/H-b 裁量结论（重点核验项 4）— **裁量：双双落地，附两处对 SA2 红线原案的修正**

**裁量权来源**：设计 §8.1 显式列名 `-rev1-hardening.test.ts`（「新建（可选，SA4/SA7 裁量按 §4 可选锚点落地……SA3 不编写测试」）+ SA2 R1 攻击点 #3/#4 建议（#4「建议优先纳入」）。SA4 以绿灯行为锁 + 计时护栏形态落地并本地验证全绿（3/3，6ms），文件 `packages/doc-runtime/test/read-logical-value-at-path-rev1-hardening.test.ts`：

- **H-b（mixed 反序锚，落地）**：`{ bar } | { foo? }` + live `x={}` 读 `['x','foo']` → `ok:true` + value 键显式存在且 undefined。与 R4-3（missing 先）构成双向锚：错误实现「循环遇 reject 提前终止」在本锚转红、「见 reject 即整体 reject」在 R4-3 转红；「首 missing 即返回」（原 bug 行为）两锚均无检测力为观测等价必然（SA5 (c) 成文，非缺口）。**探针已预验行为正确**（mixed 两序均 missing 胜）。
- **H-a（value-first 新增成本面护栏，落地，附两处裁量修正）**：26 层链式重叠联合（SUP-2 同款形状、成员 0 的 x 改 optional）× 中段 optional 缺席 → 断言 `{ok:true, value:undefined}` 且 `<2s`。红灯触发 = memoB 丢失 / value-first 试探未摊销（指数回潮）。**修正 1（缺口深度 13 → 25）**：SA2 原案缺口在第 13 层时，无 memo 回潮仅 2^12 ≈ 4×10³ 次成员试探（毫秒级），`<2s` 红灯在 memo 丢失时**不会点亮**——护栏必须能红才有锚定力；缺口置于最深 optional 层（第 25 层，2^24 ≈ 1.7×10⁷ 次回潮）红灯才真实触发（量级口径与首轮 SUP-2「无 memo 为 2^25 级」同一惯例）。**修正 2（路径 `['e',x×12]` → `['e',x×25,'t1']`）**：原案路径耗尽在 union L13 自身，空 live 走终点 `walkUnion`（提交层仲裁）全软拒回退成员 0 → **产出 `{ok:true, value:{}}` 而非 undefined**（探针实证：`读 [e,x×12] 终点=union+空live → value:{}`），原案期望值即错且越权锚定提交层；修正案使缺席发生在**中段导航**（消费第 25 个 'x' 段时 live 缺该键）——恰是 D17 仲裁的管辖域，与设计 §4「中段 optional 缺席」语义一致。正向对照（底层 t1='v' → 读回 'v'）自证 fixture 正当性。
- 两处修正均为**锚点规格修正**，不触设计 normative 条款（设计 §4 H-a 原文「live 构造至中段缺 x，读深层路径」的表述兼容本落法）；修正依据已写入测试文件头注与本报告，供 SA7 复核。

**基线对账注记**：本轮新增 1 文件 / 3 例后，doc-runtime 包为 10 文件 120 例（SA3 自验口径 9 文件 117 例 + 3）；全仓全量口径相应 59 文件 / 824 例。总控后续复核请以此对账。

---

## §5 极端条件攻击记录（技能 §5）— 未发现漏洞

| 攻击面 | 推演/实证 | 结果 |
|---|---|---|
| 零成员 union（手造） | 循环体不执行 → `sawMissing=false` → reject；旧实现 `{ok:false}` 同顶 | 观测等价 ✓ |
| 嵌套 union 递归聚合 | 5 例探针（§3） | 与设计成文逐条一致 ✓ |
| `-0` / `2^53` / 负数 / 非整数下标 | array 分支段型检查逐字未动（仅编码改写）；SUP 既有例绿 | 行为不变 ✓ |
| map 显式 undefined 值 | 探针：D4 先收 → missing → 显式 undefined（与 extract.ts:107/118 同判） | 两层一致 ✓ |
| undefined 数组元素 | 公共 API 不可构造（双序探针均 loud 抛）；即便放宽：中段 `carrierOf(undefined)=null` → reject、终点 mismatch → reject——**不产 missing、不产 value-undefined**（INV-12 双保险） | 封闭 ✓ |
| 空路径 `[]` | i=0=n → walk 整树快照；D12 零改动；首轮用例绿 | 行为不变 ✓ |
| value-first 新增试探成本 | H-a 护栏 6ms 通过（memo 摊销生效）；上界 O(触及节点数×路径长×成员扇出) 不变 | 无性能回潮 ✓ |
| E100 面扩大（H-2，手造派生物） | missing 后继续试探可触达旧短路跳过的违规分支 → throw 先于旧实现暴露 → D11 顶层 catch 结构化返回 | 防御域（C3），非契约面；与设计 §3.5 H-2 成文一致 ✓ |
| memo 三态值域扩展 | memo 存 outcome 对象引用（`hit !== undefined` 判引用），三态对象恒非 undefined | 哨兵安全 ✓ |

---

## 动态审核重点（交 SA7）

1. **CI 触发证据（硬门禁 #14 动态半边）**：从 PR CI run 日志摘录 `pnpm test` 步骤中 `packages/doc-runtime/test/read-logical-value-at-path-rev1-hardening.test.ts`（3 tests）与 `read-logical-value-at-path-rev1-union-arbitration.test.ts`（18 tests）的执行行，确认双矩阵（node 20/24）下均触发。
2. **H-a 红侧量级抽验（可选）**：H-a 护栏绿灯已过（6ms）；红灯侧（memo 丢失 → 2^24 回潮 >2s）为静态推演 + SUP-2 同类惯例，如需实证可在隔离分支临时移除 memoB 验证转红（不进主干）。
3. **H-b/mixed 与嵌套 union 行为在 CI 环境复现**：本报告探针为本地 tsx 直跑；SA7 可在 vitest 上下文复跑既有 R4-3 + 新 H-b 对偶（同断言集）。
4. **全量基线对账**：合并后全仓应为 59 文件 / 824 例（58/821 + 本轮 1 文件 3 例）——若 CI 数字不符需排查测试丢失。

---

## 结论

SA3 实现 commit `c4c2c73` 与设计 D16/D17/D18 逐行零偏离；公共契约冻结、DENY（packages/vfsl 及 extract/carrier/index 零改动）、版本 bump（0.1.2→0.1.3）全部兑现；「预存 TS2339 修复」经 A/B 实证确为测试基础设施级、断言逻辑零改动、与生产改动无关；AC-R1..R5 全部满足（观测等价护栏 120 例 + 全量 821 例全绿）；SA2 移交锚点 H-a/H-b 裁量落地（附锚点规格两处修正，均有探针实证）。未发现漏洞、无静默失败、无降级风险、无架构死胡同、无过度设计。

**Verdict = pass，SA7 可进入动态验证。**
