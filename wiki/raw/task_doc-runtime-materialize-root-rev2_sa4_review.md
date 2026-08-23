# SA4 静态验尸报告 — materializeRoot 修订轮 rev2（commit fdcf757）

**Date**: 2026-08-23
**Verdict**: pass

- 被审对象：commit `fdcf757`（SA3 实现，4 文件：materialize.ts +377 / xml-parse.ts +31 / index.ts +13 / package.json 0.1.5）+ SA6 红灯测试两文件（工作区暂存未 commit，SA6 owned）
- 设计锚：`wiki/raw/task_doc-runtime-materialize-root-rev2_design.md`（1014 行 R4 终版，SA2 R4 pass）
- 交叉档案：rebase 冲突解决档案 §2.1.2 超判定、SA2 R4 报告（4 nit + 观察项 O-R4-4）、简报 SA6 红灯锚定小节
- 验证命令与结果（后台独立进程）：
  - `pnpm --filter @nomicore/doc-runtime typecheck` → **exit 0**
  - `pnpm typecheck`（根，6 包全量）→ **exit 0**
  - `node_modules/.bin/vitest run packages/doc-runtime/test/materialize-root.test.ts packages/doc-runtime/test/materialize-root-rev2.test.ts` → **Tests 83 passed (83)**（materialize-root 60 + rev2 23），**Type Errors no errors**，exit 0——SA6 锚定的 15 红用例全部转绿，8 对照/诚实用例保持绿，既有 60 用例零回归

---

## 审核结论

1. 设计一致性：✅ 一致（逐项见「必查项核验」；无 scope creep）
2. 读写路径一致性：✅ 一致——⑥ 双侧走同一公共读入口 `extractYjsSnapshot` 与同款构造管线（② buildTopEntries 共享 + ④ 同款单事务安装），无数据源分叉
3. 静默失败：✅ 无——全部分支 loud（⓪/⑤/⑥ throw）或结构化返回（①②③ issues）；⑥ 的 catch-all 收敛为 E201-D 是「校验未运行」的诚实归类，非吞错降级
4. 降级方案：✅ 无降级——⑥ 异常分流（scratch 异常→D④ / extract throw→D / exReal fail→C / exScratch fail→D / 比较器异常→D①②③ / cmp 不等→C）与设计 §4.2 逐支吻合，无一处返回伪 ok
5. 极端攻击：✅ 未发现可静态确认漏洞（推演记录见「攻击推演记录」节；3 项理论边角登记观察项，均 fail-safe 方向）
6. 错误处理：✅ 完整——E100/E200/E201(A/B/C/D)/E202(A/B/C) 七码语义互斥无混用；guard 物理上位于一切 try/catch 之外（materializeRoot:98 第一句）
7. 架构评估：✅ 可行——对称重物化以构造性对称根除三轮判据缺陷（R1 假阳性/R2 值攻击/R3 删除攻击），比较器较 R3 版净简化（三值 cmp/无损谓词退役），无绕架构约束迹象
8. 过度设计：✅ 精简——⑥ 相关新增 ~240 行（含 JSDoc/诊断辅助/错误构造器），对照设计估 ~150 行超出部分为注释与 detail 渲染（detailOf/keysetOf/summarize/errDetail），密度正常；无投机抽象层

---

## 必查项核验（总控交办 7 项）

### 1. 实现 vs 设计逐分支等价 — ✅

**⓪ guard vs §3.4 伪代码**：`assertOutermostTransactionContext`（materialize.ts:132-146）与设计伪代码**逐字一致**（含分支结构与注释）：

| 分支 | 设计伪代码 | 实现 | 判定 |
|---|---|---|---|
| 窗口 A | `tx !== null && tx !== undefined` → throw A | 同（:138-140） | ✓ |
| 窗口 B | `Array.isArray(cleanups) && cleanups.length > 0` → throw B | 同（:141-142，B 检查在 A 之后） | ✓ |
| 唯一放行口 | `tx === null` 且队列空 → return | 同（:143） | ✓ |
| 窗口 C fall-through | 其余一切 → throw C | 同（:145，无独立谓词、无形态嗅探） | ✓ |

- 谓词实际覆盖**严于**「truthy 即命中」：`tx = 0/''/false/NaN` 等 falsy 垃圾同样命中 A（`!== null && !== undefined` 非 truthiness 检查）——fail-closed 方向，与伪代码唯一规范锚逐字一致。
- 触发点：materializeRoot 函数体第一句（:98）、prepare 之前、一切 try/catch 之外 ✓（零写入论证成立：throw 时未触碰 probeRoot 的惰性 getMap）。
- **E202 三变体消息**：以脚本抽取设计 §3.4 消息块与实现三常量做归一化比对——去排版空白后**三变体逐字符等价**（E202_MSG_C 完全一致；A/B 两处差异仅为 markdown 硬换行的排版空格，实现按中英排版惯例在换行恢复点补空格：`doc._transaction 非空`、`DOCRT-E201 检测面失效`、`（此前 update/…`——语义零偏离）。全部测试文本锚（`/DOCRT-E202/`、「派发期间」「无法确认」「版本兼容性」「doc._transaction 非空」「队列异常残留」）在实现消息中命中。

**⑥ 对称重物化 vs §4.2/§4.3**：

| 设计要求 | 实现 | 判定 |
|---|---|---|
| scratch 直建不递归调用 materializeRoot | `buildScratchInstall`（:220-229）= buildTopEntries + `new Y.Doc()` + 同款单事务 set 循环，零 materializeRoot 递归 | ✓ |
| 不复用 entries_real | `verifySnapshotIntact(derived, snapshot, doc)` 重新执行 `buildTopEntries(derived, snapshot)`（fresh detached + fresh resolver），不取 prepare 产物 | ✓ |
| productEqual 九 kinds 覆盖 | switch 覆盖 StructureNode 全部 8 个 kind 常量（root/ref/map/array/xml-fragment/leaf+plain/union），无 default；TS 穷尽性由根 typecheck exit 0 证明；map 行封闭形与 Record 同规（`slot ?? declaredFieldOf`，:317-319） | ✓ |
| map 全键集（undefined 视同缺席，双侧同规） | :312-316（`length 相等 + every 双向包含` ⟺ 集合相等）；未声明键按值深度相等兜底、不做声明字段过滤（:321-324） | ✓ |
| array 长度 + 逐元素顺序敏感 | :332-340 | ✓ |
| xml canonical 经 canonicalXmlOf（共享扫描器，不另造词法） | :341-354，经 xml-parse.ts `canonicalXmlOf`（:63-79，复用 `scan()` 中间树）；任一侧扫描失败 → throw → D（:345-352），不谎报偏离 | ✓ |
| union 角色分发 any-of（成员仅决定 canonical/exact 角色） | :358-370（声明序，首个 equal 即胜，firstDiff 诊断保留） | ✓ |
| root/ref resolve 下钻（环/缺名 → D） | :304-307，resolve 抛出被 :278-287 收编 e201D | ✓ |

**E201 变体 C/D 分流**：与设计 §4.2 触发类枚举逐支对齐——scratch 构造 throw/fail → D④（:246-254）；双侧 extract throw → D（:261-266）；`exReal.ok === false` → **C**（提取失败支「已安装子树载体与结构树不符」，:267-269）；`exScratch.ok === false` → D（:270-272）；比较器异常（canonical 扫描失败/ref 环/深栈）→ D 触发类①②③（:278-287）；`cmp.equal === false` → C（值支/键集支 detail，:288 + detailOf :407-415，措辞与设计 §4.2 detail 例一致，值摘要 120 字符有界）。变体 C/D 主消息骨架（「ROOT 逻辑快照安装后语义校验偏离」「ROOT 安装后完整性校验无法完成……不代表已检测到偏离」）与设计逐字一致。

### 2. rebase 超判定 §2.1.2（删除 extract.ts 的 resolve.js import）— ✅ 无重复定义/死代码/语义漂移

- **当前态**：extract.ts 头部 import 仅 `yjs / @nomicore/vfsl / ./carrier.js`——`import { makeRefResolver } from './resolve.js'` 已删除（TS2440 同名冲突消除，typecheck exit 0 佐证）。
- **两份 `makeRefResolver`**（extract.ts:233-255 与 resolve.ts:15-37）：**函数体逐字符等价**（仅注释差异：resolve.ts 版多两处行内注释、错误码注释分别为 E100/E200 收编指向）。属 rebase 裁决既定的平行实现，各自命名空间独立，无运行时/类型冲突。
- **无死代码**：extract.ts 版消费方 = extract.ts:62（自身）+ read.ts:26（`import { makeRefResolver, walk } from './extract.js'`，`walk` 亦 export 于 extract.ts:89）；resolve.ts 版消费方 = materialize.ts:38。两份均活跃。
- **read.ts 消费路径不受影响**：issue #75 seam（extract.ts:230-231 `@internal` JSDoc）完整保留，`readLogicalValueAtPath` 经 index.ts:27 公共导出。
- **copyPlainValue JSDoc 衔接**：extract.ts:257-264 `/** … */` 与注释体衔接为合法 JSDoc（§2.1.2 档案所述第 258 行 `/**` 实际落在 257 行，1 行行号偏移，结构合法）。
- §2.1.2 的其余保留项（第 62 行调用点措辞「包内共享解析器」）在位且语义准确。

### 3. Hard Gate #9（版本 bump）— ✅

`packages/doc-runtime/package.json:3` = `"version": "0.1.5"`（fdcf757 内 0.1.4 → 0.1.5，RD11 patch 推进，无公共 API 签名变更）。

### 4. Hard Gate #14（vitest 触发性自检）— ✅ 成立（附 1 项观察项）

- 本任务测试文件：`packages/doc-runtime/test/materialize-root.test.ts`（改动）+ `materialize-root-rev2.test.ts`（新增）。
- CI 通道核查（`.github/workflows/ci.yml`，唯一 workflow）：
  - **「Test」job（:38-39，matrix node 20/24）`pnpm test` = `vitest run --typecheck`**，vitest.config.ts include = `packages/*/test/**/*.test.ts` 全仓 glob → **两个测试文件均落在 CI vitest 运行范围内**，23+60=83 用例在 CI 触发 ✓；
  - rev1 引入的「Materialize root tests」存在性门禁（:54-55）锚定 materialize-root.test.ts（含 `--typecheck --passWithNoTests=false`）——T-1 拒绝测试在专项门禁内 ✓。
- **判定：`vitest-package-not-triggered` 不成立**——packages/doc-runtime 被 CI「Test」job 全量覆盖。
- **观察项 O-S4-1（非阻塞）**：专项存在性门禁命令未随 rev2 扩展至 `materialize-root-rev2.test.ts`（rev2 设计 DENY 明确 `.github/workflows/**` 零触碰、SA8 双门禁 clear，故非越权）；后果是该文件「被删/改名后静默假绿」的存在性保护缺位（全量 glob 下单文件删除不触发 `passWithNoTests`）。建议下轮 housekeeping 将门禁命令扩为两文件路径或目录 glob（需 SA1 设计显式扩展 ALLOW LIST 含 workflows）。**交 SA7 在动态阶段摘录 CI run 日志中 rev2 文件 23 用例的实际触发证据**。

### 5. DENY 清单零触碰 + 测试文件归属 — ✅

- fdcf757 恰好 4 文件 = 设计 §12 ALLOW LIST 前 4 项（materialize.ts / xml-parse.ts / index.ts / package.json），**零超出**；工作区暂存的测试两文件 + wiki 档案均属 ALLOW LIST `[SA6 owned]` 项与白名单豁免（`^wiki/raw/task_`）。
- DENY 清单逐项：`packages/vfsl/**`、`packages/persistence/**`、`packages/dsh-persistence/**`、`packages/vfsl-codegen/**`、`packages/vfsl-protocol/**`、`docs/adr/**`、`.github/workflows/**`、`extract.ts`/`read.ts`/`carrier.ts`/`resolve.ts`——**fdcf757 全部零触碰**（全分支 diff 中 extract.ts/resolve.ts/ci.yml 的变更均来自 rebase 重放的既有 commit，非 rev2 面）。
- 测试文件 SA3 零改动：fdcf757 的文件清单不含任何 test 文件 ✓（staged 测试改动属 SA6 红灯/R2 批交付，diff 内容与简报 SA6 小节逐条吻合：T-1 整块替换 + 头注释追加 rev2/RAC-P1/RT-6 说明、其余用例零改动）。
- 「只增不改既有语义」核实：fdcf757 对 materialize.ts 的删除行全部为 JSDoc 措辞升级、version bump、import 扩展，以及 prepare 内②构造逻辑抽取为共享函数 `buildTopEntries` 的等价重构——①②③④⑤ 运行时语义零改动（E201 变体 A/B 消息原文未动）。

### 6. SA2 R4 遗留 4 nit 已修 + 观察项登记 — ✅（附编号勘误）

4 nit 逐项验证（设计「R4 后 nit 修订」表 :983-989 声称已修，实测均落实）：

| nit | 声称位置 | 实测验证 | 判定 |
|---|---|---|---|
| nit 1 §10 部件清单陈旧名 `firstSemanticDifference` | §10 括注（:860-863） | 已更新为现行清单（assertOutermostTransactionContext / verifySnapshotIntact / scratch 构造内部件含「不得递归」注意点 / productEqual / canonicalXmlOf）+ 旧名标注 | ✓ |
| nit 2 §12 ALLOW list「三值投影比较器」陈旧 | §12 materialize.ts 条目（:1000） | 已更新为「对称重物化：scratch 构造 + 双侧 extract + productEqual，~150 行」+ 行数估计下调标注 | ✓ |
| nit 3 §9.5 表头 canonical 保真度 + 悬空引用 `r4-optionb-xml.ts` | §9.5 表头（:812-815） | 表头已加「canonical xml 在探针中以字面比较代替……XML canonical 面由 §4.3 生产规格 + SA6 语义比较器锚定」如实化标注；`r4-optionb-xml.ts` 在 §9.5 正文已删（全文仅存于 nit 修订表自身的说明文字） | ✓ |
| nit 4 R-8「工程上不可达」措辞偏强 | §4.2 union 行（:385）+ §8 R-8 行（:677） | 已如实分级为「**构造可达、触发面对抗性**……且终态在 W3 语义下等价」 | ✓ |

观察项登记核对：
- **O-R4-4（对齐式对抗输入）**→ §8 R-5 行（:675）已补登记「自伤等价，出威胁模型」+ 防未来误报定性 ✓。
- **编号勘误（如实报告）**：任务简报必查项所述「O4/O5 观察项」在 SA2 R4 报告中**无对应字面编号**——R4 pass 的遗留面实为「非阻塞 nit 4 项」+「观察项 O-R4-4」+「R-8 可选 characterization（SA6 可选）」。本报告按实际档案逐项核对完毕（4 nit 全修、O-R4-4 已登记）；R-8 可选 characterization 用例 SA6 未落地（设计措辞为「可选」，非阻塞）→ 登记 O-S4-2。

### 7. yjs 私有字段 fail-closed 静态核对 — ✅

guard 对 `_transaction`/`_transactionCleanups` 一切**字段形态异常**的走向全景推演：

| 输入形态 | 分支走向 | 判定 |
|---|---|---|
| `tx` 缺失（`delete`，cleanups 仍空 Array） | A 跳过（undefined）→ B 块内 length 0 不命中、`tx === null` 不成立 → **fall-through C** | ✓ |
| `cleanups = {}`（非 Array，tx 保持 null） | A 跳过 → `Array.isArray` false 跳过 B 块 → **C** | ✓ |
| `tx = {}`（truthy 垃圾） | **A**（消息「doc._transaction 非空」事实为真，§3.1 收敛口径） | ✓ |
| `tx = 0/''/false/NaN`（falsy 垃圾） | **A**（`!== null && !== undefined` 非 truthiness，fail-closed 方向） | ✓ |
| `tx === null` + `cleanups` 缺失 | **C** | ✓ |
| `tx === undefined` + 非空 Array 队列 | **B**（真实 yjs doc 上该状态即真窗口 B，指引正确——R-1 已登记手造 stub 残余） | ✓ |
| `tx === null` + 空 Array | 唯一放行口 return | ✓ |

RT-3 三形态断言（C-1/C-2 → 「无法确认」「版本兼容性」；C-3 → 「doc._transaction 非空」）与上述走向一一对应且实测绿。**guard 内部无 try/catch**（设计要求：绝不落入 E200 崩溃边界）✓。属性读取、无 `instanceof` 类身份依赖（双 yjs 实例免疫，R-1 缓解④）✓。

唯一 raw throw 面：`doc` 本身为 null/undefined、或两字段为抛异常 getter——超出「字段形态异常」范畴（设计 §3.4 伪代码同款不设兜底；TS 签名 `doc: Y.Doc` 下不可达）→ 登记 O-S4-3，交 SA7 活链路确认无调用方以 null doc 调用。

---

## 攻击推演记录（未击穿项）

1. **⑥ 假阴性攻击（值改/删除/插入翻转）**：real 侧任何使 extract 输出变化的修改 → 全键集/逐元素/canonical 比较立判（D1 键集缩水 :314-316、Shape B 动态键值差 :321-324、Medium×3 值/序/span 差）——RT-1.5/RT-1.6/Medium×3 实测全绿。
2. **仲裁漂移攻击**：两侧走同一确定性管线，重叠联合（C1-C4）在两侧同样仲裁 → 产物逐位一致 → 诚实路径不假阳性（RT-1.5/RT-1.6 诚实对照 6 用例绿）。
3. **RT-5 不可扫描 XML**：observer 注入 `q="x"y"` → extract 读回经 scan 时属性解析错位（`y` 被读作属性名后缺 `=`）→ canonicalXmlOf 返回 err → throw → **E201-D** ✓（设计 §7.1 预期落 D；主锚「绝不假成功」实测绿）。
4. **scratch 面攻击**：scratchDoc 于 ④ observer 派发完毕后创建、无外部引用路径、零监听者 → 无 observer 注册面、零事件外发 ✓。
5. **对抗双读（R-5）**：getter 第二次读发散不抛 → 两侧产物不等 → C（loud）；抛出/失败 → D④——实现分支与设计双分支一致。
6. **NaN/deepEqualValue**：`===` 对 NaN 为 false——extract 产物纯 JSON（non-finite 已被读侧拒绝）不可达，防御性兜底可接受（实现注释 :376-377 已声明值域依据）。
7. **summarize 循环引用**：`JSON.stringify` throw → catch 兜底 `String(v)`（:425-434）——诊断文本路径不炸。
8. **深栈残余（R-3）**：canonical 渲染/比较递归溢出 → 被 :278-287 收编 D（fail-safe）；④ 集成递归仍是最浅先行闸门（Minor-2 用例维持绿佐证）。
9. **wedge doc（R-7/RT-4）**：cleanups 卡死非空 → 无辜顶层调用命中 B → E202-B 含「队列异常残留」诊断分支——实测绿。
10. **性能**：成功路径 +1 次构造安装 +2 次 extract + O(n) 比较，create-time 入口（③ 限定 ROOT 空置）非热路径，可承受。

---

## 测试质量审查（§1.7 源码 GREP 断言禁令）

两测试文件均无 `readFileSync` 源码读取；全部 `toMatch/toContain` 断言对象为**运行时抛出的 `Error.message`**（错误身份/文本锚），非源码字符串 grep——合规的行为断言。测试经 `../src/index.js` 公共入口 import（黑盒锚定）。断言面覆盖：错误码正则 + 变体文本锚 + 零写入双证（stateBytes 逐字节 + encodeStateVector）+ update 计数 + ROOT 空置 + observer 触发计数 + extract 投影锁定 + 语义比较器（W2/W3 禁逐字）。23 用例清点与简报 SA6 小节逐条吻合（Medium×4 / Minor×2 / RT-2×2 / RT-3×3 / RT-4×1 / RT-5×1 / RT-1.5×6 / RT-1.6×4）。

---

## 观察项（非阻塞，不构成驳回）

| # | 观察 | 定性 | 回流目标 |
|---|---|---|---|
| O-S4-1 | CI「Materialize root tests」存在性门禁未含 rev2 新测试文件（可触发性已由「Test」job 全量 glob 兑现，但「防文件被删静默假绿」的存在性保护面只覆盖旧文件） | 门禁强度缺口，非触发缺口；rev2 设计 DENY workflows 零触碰已由 SA8 clear，非越权 | SA1（下轮设计若涉及）+ housekeeping；SA7 动态摘录 CI 触发证据 |
| O-S4-2 | R-8 残余的可选 characterization（同槽联合 + canonical 等价改写 → ok:true + 终态 canonical 等价断言）SA6 未落地 | 设计标注「可选」；R-8 已如实登记 §4.2/§8 | SA6（可选补齐） |
| O-S4-3 | guard 对 `doc = null/undefined` 或字段 getter 抛异常会 raw TypeError（不落 C）——超出「字段形态异常」范畴，设计伪代码同款不设兜底，TS 签名下不可达 | 理论边角，fail-safe 方向无（异常本身即 loud），仅错误码身份非 E202 | SA7 活链路确认零此类调用方 |
| O-S4-4 | 任务简报必查项「O4/O5 观察项」与 SA2 R4 档案实际编号体系（「非阻塞 nit 4 项」+ 观察项 O-R4-4）不对应——本报告按实际档案核对：4 nit 全修 ✓、O-R4-4 已登记 ✓ | 简报措辞 vs 档案编号偏差，非缺陷 | 总控（后续简报措辞对齐档案编号） |

---

## 动态审核重点（交 SA7）

1. **CI 触发证据**：PR CI run 的 `gh run view --log` 中摘录 (a)「Test」job 对 `packages/doc-runtime/test/materialize-root-rev2.test.ts` 23 用例的实际执行行；(b)「Materialize root tests」门禁步骤绿——静态自检（Hard Gate #14）的动态确认。
2. **RT-2 窗口 B / afterAllTransactions 例外在真实链路的复核**：单元级已绿；若有接入方（未来 NamespaceRuntime），在其事务回调链路中复核 E202-B 诊断分支与 wedge 指引的可操作性。
3. **⑥ 性能抽查**：大 snapshot（深嵌套/多键）下双 extract + scratch 构造耗时（create-time 非热路径，仅确认无意外平方级）。
4. **O-S4-3 确认**：仓内/未来调用方无以 null doc 或 getter 化 stub 调 materializeRoot 的路径。
5. ** Minor-2 栈上限环境方差**：CI runner（ubuntu-latest，node 20/24 矩阵）上 20_000 层极深树用例仍落 ② 装配溢出 → E200（R-4：若引擎栈上限漂移，用例以非 E200 形态显式变红而非静默假绿——确认失败方向）。

---

## Verdict 论证

- 总控交办 7 项必查全部 ✓（含两项 Hard Gate）；
- 83/83 测试绿 + 根/doc-runtime 双 typecheck exit 0——SA6 红灯 15 用例全部按设计 §7「红/绿语义对齐」转化，既有 60 用例零回归；
- 实现与设计 §3.4/§4.2/§4.3 在伪代码、算法、消息、分流四个维度逐字/逐支等价；scope 严格收敛于 ALLOW LIST；
- rebase 超判定（§2.1.2）遗留态无重复定义/死代码/语义漂移，read.ts 消费链完好；
- 四轮判据演进的全部击穿向量（R1 假阳性/R2 值攻击/R3 删除攻击）在 RT-1.5/RT-1.6/RT-1.4 红绿锚下永久锁定。

**Verdict: pass**——SA7 可进入动态验证（重点见上节 5 项）。
