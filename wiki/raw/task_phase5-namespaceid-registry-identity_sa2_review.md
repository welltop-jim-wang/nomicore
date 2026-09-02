# SA2 攻击评审报告

**Date**: 2026-08-27（R1）/ 2026-08-27（R2 复审追加，见文末「R2 复审」节）
**Reviewer**: SA2（Reviewer / Wallfacer），独立全新视角
**审查对象**: `wiki/raw/task_phase5-namespaceid-registry-identity_design.md`（R1 初版 → R2 修订版）
**辅助参照**: SA6 红灯契约（`..._sa6_red.md` + 两个测试文件）、SA8 复审（verdict `clear`）、ADR 0006/0008/0009/0010 摘录（`..._relevant_decisions.md`）
**最终 Verdict（R2）**: **pass**——R1 四点修订全部闭合（逐点实证见文末 R2 复审节；R1 的 reject 由其取代，R1 记录原样保留供追溯）

## 审查方法与证据基础

- 逐行读取 `packages/namespace-registry/src/` 全部 9 个模块（registry.ts 1092 行全读、identity.ts、types.ts、testing.ts、plugin.ts、create-document.ts、observer.ts、errors.ts、index.ts）；
- 逐行读取 SA6 两个红灯文件（528 行运行时 + 71 行类型面）与 `registry-surface.test.ts` 守卫全文；
- 实跑 `npx tsc -p tsconfig.typecheck.json --noEmit`（见攻击点 #1 证据）；
- 核对 `tsconfig.typecheck.json` / `vitest.config.ts` / 根 `package.json` 的 typecheck 管道覆盖面；
- grep 核实 §3 现状断言（`createNamespaceRegistryForTesting` 计数 ≈143≈145 ✓、`testEntries` 仅 registry-create.test.ts 4 处 ✓、apps/ 无代码 ✓、domains/ 无引用 ✓、open 测试 keyDigest 仅格式锚 ✓、无跨 owner 复合键既有用例 ✓、`snapshotCreatePayload` 为深克隆+深冻结 ✓）。

**架构内核结论（先行声明，避免 SA1 过度修订）**：以下经攻击后确认成立，R2 **不得**回退——

| 机制 | 攻击验证结论 |
|---|---|
| C-1/C-2/C-3（每 key 槽串行、entry 只在槽内增加、重试再接纳） | 与基线 carrier/slot 代码逐点吻合（`admitOpenSlot`/`admitCreateSlot`/`scheduleCarrierCleanup` 的 get-or-create + tail 链 + settle 后清理在单线程下无交错窗口）；①与⑤之间仅 `await createDoc` 与同步 factory，同 key 一切 slot 走同一 FIFO；`beginIdleClose`/`activateEntry`/shutdown/testEntries 均不新增 entry（移除方向安全）。「同 ID 每进程至多一个 Runtime」由结构保证，不依赖 Persistence duplicate——成立 |
| preparedBox 跨候选复用 vs 排队期变异 | `snapshotCreatePayload` → `clonePlainData` 是 cycle-safe 深克隆+深冻结（registry.ts:324-433），复用的是快照副本非调用方引用——跨槽窗口无变异注入面 |
| D-9 admittedCreates 屏障 | 接纳检查→`admittedCreates.add` 全同步（run-to-completion，无交错点）；集合在 acceptance 关门后只减不增；carrier 快照遗漏的晚建 carrier 全部归属已接纳 create 编排，被编排等待覆盖；`tracked` 恒绿尾零 unhandled rejection——论证严密 |
| D-2 静态守卫兼容 | `node:crypto` 不命中 cordis specifier 正则（仅 `@deepseek-ai/cordis` 前缀）；`randomBytes(` 不在 host-global-timer 三正则面；declaration 可达图 `reachableFrom` 只跟相对 specifier——设计 §9 依据与 surface 测试实际断言逐字相符 |
| 耗尽 committed:false | 耗尽分支仅在「全部 attempt 返回 retry」后可达；任何 createDoc 成功直接登记 entry 返回——结构性不可带 committed 事实进耗尽 |
| 拒绝伪降级（D-3） | 随机源 throw/形状违约不消耗重试预算、立即 fatal——正确识别「能力契约缺陷 ≠ 瞬态碰撞」 |
| open owner 谓词 | mismatch 短路于 phase 分派前（含 closing 分支前），零 loadDoc、零新 Runtime、不区分「属他人/不存在」——与 ADR 0010 逐句一致 |

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议修订（SA1 R2） |
|---|--------|--------|---------|------|
| 1 | **CRITICAL** | 红灯验收面 × 类型契约（§4.1.1 × §6 × §12） | **红灯文件第二处内部矛盾（类型轴），设计 §6 漏检**。AC-1 门禁用例（`registry-phase5-identity-red.test.ts:287-288`）以**无 cast 的对象字面量**直呼两个工厂来断言「缺 randomBytes → 构造期 TypeError」：`createNamespaceRegistry(persistence, { clock, scheduler })` 与 `createNamespaceRegistryForTesting(persistence, { clock, scheduler })`。而 SA6 类型锚（surface.test-d.ts:31 `T extends { readonly randomBytes: (length:number)=>Uint8Array }`，可选键不满足 extends）**强制 randomBytes 为两选项类型的必需键**。SA3 按设计实现后，这两行即产生 TS2345（missing property 'randomBytes'）。该文件位于 `tsconfig.typecheck.json` 的 include（`packages/*/test/**/*.ts`）——**已实测证明在 vitest `--typecheck` 程序内**（见下方证据）；vitest 将非 test-d 文件的类型错误计为 unhandled source errors（SA6 自己的运行证据格式就有「0 unhandled source errors」栏），默认使 run 失败。⇒ 设计 §12 的绿判命令（`pnpm test` = `vitest run --typecheck`；命令 1 亦按 SA6 证据把 red.test.ts 列入 --typecheck）**不可达**，且红灯文件是 `[SA6 owned]`、§11 明令 SA3 不得改——与 §6 已修复的 registryB fixture 矛盾**同类**（fixture × 门禁互斥），设计只发现了一处。 | 把 §6 扩为「第二项必需修正（SA6 执行，2 行）」：为 287/288 两行补 cast（先例即本仓库门禁测试自身的既有模式 registry-create.test.ts:1294 `c.options as never`），如 `{ clock, scheduler } as CreateNamespaceRegistryOptions` / `as NamespaceRegistryTestingOverrides`；断言逻辑（toThrow TypeError）零变化。同步更新 §12 绿判注释与 §11 该文件行的修订说明。SA6 完成前 SA3 绿判不得宣布 |
| 2 | **HIGH** | §7 迁移矩阵 × §11 ALLOW LIST（文件范围契约） | **迁移矩阵系统性低估、文件清单漏列必改文件**。实测发现四个键的 create 调用点必须三键化，但矩阵表述为「零必改/如需/仅补 randomBytes」：(a) `registry-sa7-cordis.test.ts:154` `CREATE_PAYLOAD(namespaceId)` 恒四键，:179/:247 两处期望成功——**必须迁移**，而 §7 该行写「预期零改动」、**§11 ALLOW LIST 完全漏列该文件**（不属 ALLOW 也不属 DENY——SA3 的 diff 边界出现悬空必改文件）；(b) `registry-plugin.test.ts:180-183`（`namespaceId:'ns-1'`）与 :504-507（`namespaceId:'k'`）期望成功——必须三键化，§7 行首「零必改预期」表述错误（其括注只覆盖「断言锚具体 ID」情形）；(c) `registry-persistence-contract.test.ts:75-79` 四键期望成功——必须迁移，行内只提「补 randomBytes」；(d) 旧 message 文本锚 2 处（`恰含 owner、namespaceId、schema 与 root`）随 §4.7 文案更新必须同步。非健全性漏洞（失败响亮、纪律 (c) 会兜住），但 §11 是 SA3 的执行边界——漏列可致 SA3 停摆或越权改动。 | R2 修订 §7 四行 + §11：sa7-cordis 移入 ALLOW LIST（迁移内容：CREATE_PAYLOAD 三键化 + ID 断言改格式锚）；plugin 行改为「2 处 create 输入三键化 + ID 断言改格式锚」；persistence-contract 行补「create 输入三键化」；补一句「旧 CREATE_INVALID_INPUT message 文本锚 2 处同步新文案」。注：registry-shutdown.test.ts:802 的四键 create 因 acceptance 门先行短路（期望 `REGISTRY_NOT_ACCEPTING`、零输入访问）可不动——建议矩阵明示这一豁免理由，防 SA3 误改 |
| 3 | MEDIUM | 设计机制 × SA6 锚覆盖缺口（非设计缺陷，登记为回补项） | 三个设计裁决**没有任何红灯锚**，SA4/SA7 活链路验证前处于「设计声称、测试不见证」状态：(a) **D-9 shutdown×重试 interleaving**——已接纳 create 在重试中途遇 shutdown：shutdown 必须等编排终局、晚登记 entry 恰被关闭一次、终态 stopped（SA6 的 shutdown 用例是 create 完成后串行调用，不覆盖在途重试）；(b) **D-3 随机源 throw / 形状违约（15 字节、非 Uint8Array）→ 立即 fatal、零重试消耗、零 Persistence**（SA6 只锚了「缺失 → 构造期 TypeError」，未锚运行期违约）；(c) **C-1 推论 1 同候选并发**——两个 create 经敌意脚本源生成同一候选 K：恰一个成功、另一个重生成（SA6 并发用例用 X/Y 互异脚本）。 | 非阻塞。R2 二选一：向 SA6 提回补锚请求（3 条用例，均可在现有 scripted 源+fake scheduler 基建上低成本表达），或在 §12 显式登记为 SA4 活链路验证项。不得静默留空 |
| 4 | LOW | §6 过渡条款时效 | §6「在 SA6 完成此修正前，SA3 的实现绿判以 14/15 + 已知 fixture 缺陷为准」已过时——SA8 复审核实且本次评审重读确认：red.test.ts:482-485 的 registryB 修正**已落盘**（含空剧本随机源与注释）。过时条款留着会让 SA3 误取 14/15 为绿判基准。 | R2 删除或标注该过渡条款已被 SA6 修订记录（2026-08-27）取代，绿判恒以 15/15 为准 |

## 协议假设依据审查

**结论：通过。** 设计 §9 章节存在，含 4 条假设、每条标注依据类型与具体引用：

- 章节存在性 ✓（无 HTTP/WS/端口/进程时序假设的声明与切片范围一致）；
- 依据可验证性 ✓：`node -e` 实测命令可重跑且贴了输出（`16 true` / `isBuffer: false` / hex 校验）、Node 官方文档锚（nodejs.org/api/crypto）、源码引用可定位（`registry-surface.test.ts:147-178` 的 `if (!spec.startsWith('.')) continue` 经本次全文重读逐字核实存在）、TS lib 标准行为；
- 无「应该/通常/预计」类无据推断 ✓（风险栏均为「低」且有实证）。

一处备忘（非缺陷）：实测环境 node v24.13.0，仓库 engines 为 `>=20`——`randomBytes`/TypedArray copy-constructor 语义在两者间无差异，不构成依据缺口。

## 错误处理链路审查

**结论：通过（含显式反伪降级）。**

- **静默失败**：新链全部终局可观察——四键/坏 owner → resolve 窄 issue；碰撞重试有界（9）且耗尽 reject fatal；随机源 throw/形状违约 → reject fatal + `create-id-generation-failed` observer 事件（恰一次）；Persistence operational/fatal、Runtime 构造失败均沿既有通道。零「无结果 + 无信号」路径。
- **状态闭环**：`admittedCreates` add/delete 经 finally 闭环（over-inclusive 快照方向安全）；carrier green tail 吸收全部 rejection；entry 登记仅成功路径、失败路径 `releaseHandleBestEffort` fire-and-forget 且内部全包。
- **降级路径**：依赖服务不可用（随机源故障）不降级——直接 fatal，**正确**（注入 capability 缺损不是瞬态故障）。与既有 `idle-arm-failed` 的「上报后保持 active」同为响亮处理。
- **虚假降级识别**：D-3 明确拒绝「坏源静默重摇 9 次」——形状违约是正常路径前提（受控 CSPRNG 契约）被破坏，按 bug 处理而非降级。✓ 符合三度立法判别标准。
- 用户可感知性：create 调用方对每种失败拿到窄 issue（resolve）或 branded fatal（reject），无吞错通道。

## 红线测试思路

对应攻击点 #1（SA6 修正后、SA3 实现后各跑一次）：

1. **类型轴回归门**：`npx tsc -p tsconfig.typecheck.json --noEmit` 于 SA3 实现后必须仅剩 surface.test-d.ts 的 3 锚转绿、**零新增错误**；专门断言 red.test.ts:287-288 无 TS2345（修正前为 2 处 TS2345——这本身就是红灯：证明「必需键类型 × 直呼缺键构造」矛盾真实存在）。
2. **验收命令**：`pnpm vitest run --typecheck packages/namespace-registry/test/registry-phase5-identity-surface.test-d.ts packages/namespace-registry/test/registry-phase5-identity-red.test.ts` → 0 unhandled source errors + 15/15 + 3 类型锚绿。

对应攻击点 #2（SA3 合入前）：

3. **迁移完整性 grep 门**：`grep -rn "namespaceId:" packages/namespace-registry/test/*.test.ts` 中剩余命中仅允许出现在 open 调用、期望对象、keyDigest 断言与豁免说明处——create 输入对象内零残留（重点核 sa7-cordis/plugin/persistence-contract 四处）；`pnpm vitest run packages/namespace-registry/test` 全绿。

对应攻击点 #3（回补锚，SA6 或 SA4 落地）：

4. **shutdown×在途重试**：scripted 源 [X(命中 entry), Y]、先 create#1 建 X entry、发起 create#2（将在 X 碰撞重试途中）、立即 `shutdown()` → 断言：shutdown resolve 晚于 create#2 settle；X/Y 两个 Runtime 各恰关闭一次；`getStatus()` 到 stopped；无 unhandled rejection。
5. **随机源运行期违约**：源返回 15 字节 Uint8Array → create reject `NamespaceRegistryFatalError`（phase 非旧三、committed:false）、consumed 恒 1（零重试消耗）、`persistence.createCalls === []`、observer 收到恰一次 `create-id-generation-failed`；throw 型源同构断言。
6. **同候选并发**：两个 create 共用 script [X, Y]（各自消耗）→ 恰一个得 X、另一个得 Y；`constructed` 按 ID 各 1；createDoc 落两个 ID。锁定 C-1 推论 1 的「carrier FIFO 结构性排他」不被未来回归侵蚀。

## 结论（R1）

设计的行为内核（key 迁移、生成/重试/耗尽、owner 核对、shutdown 屏障、静态守卫兼容、并发不变量）在本轮全维度攻击下**无一失守**，质量显著高于均值；但验收链自身存在第二处红灯内部矛盾（#1，类型轴，绿判不可达）与文件范围契约缺口（#2）。两者均为**狭窄、机械**的修订：扩 §6 的 SA6 修订请求（2 行 cast）+ 修 §7/§11 四行 + 清理 #4 过时条款。完成 R2 后预期可直接 pass，无需重审架构。

**R1 Verdict: reject**（已被下方 R2 复审取代）

---

# R2 复审（2026-08-27，SA2 第二轮）

**复审对象**: 设计 R2（§6 双修正记录 / §7 迁移矩阵 R2 修正 / §11 ALLOW 追加 / §12.1 命令 0+4 / §12.3 锚 A/B/C + D-13 / §14 逐条回应表 / §13 见证列）。
**复审方法**: 全文重读 R2 设计（§1–§14）；对 R2 的全部事实性声明逐项实证（非仅读 §14 自我回应）。

## 四点闭合核验（逐项实证）

| # | R1 要求 | 闭合判定 | 实证证据 |
|---|---|---|---|
| 1 | CRITICAL：§6 修正二（类型轴 cast）+ §12 类型轴回归门 | **闭合** | (a) §6 修正二小节含矛盾原理、registry-create.test.ts:1294 先例、2 行 `as never` cast 与落盘证据；(b) **实测落盘**：red.test.ts:283-288 现含双 `as never` cast + 成因注释（「类型锚要求 randomBytes 为必需键……cast 仅为类型面消除」）；(c) **实测类型轴**：`npx tsc -p tsconfig.typecheck.json --noEmit` → 仅 surface.test-d.ts 3 锚 TS2322（基线红灯本体），**零新增错误**——命令 0 在 SA3 实现前已有干净基线；(d) §12.1 命令 0 + §12.2「0 unhandled source errors」入绿判；(e) **实测红灯保持**：`pnpm vitest run .../registry-phase5-identity-red.test.ts` → **15 failed (15)**、Type Errors no errors——cast 修正未扰动任何断言，SA6 复跑声明属实；(f) SA3 执行注明确「不得以改测试消类型错」——防误修通道已封 |
| 2 | HIGH：§7 四行修正 + §11 ALLOW 追加 sa7-cordis + 普查 | **闭合** | (a) §7 引言普查的**全部 16 个枚举行号逐一实测命中**：idle 475/747/761/862/875/1025、open 1098、persistence-contract 75、plugin 180/504、sa7-cordis 179/247、sa7-hostile 481、sa7-rev1 368、shutdown 351/802；四个零站点文件（node-dispose/sa7-concurrency/surface/entry-removal-guard）实测确为 0——**枚举完整无漏**；(b) 修正内容与代码事实吻合：plugin 两处（`namespaceId:'ns-1'`/`'k'`）与 sa7-hostile:481、sa7-rev1:368 均四键期望成功，必须三键化；open:1098 实测为 `as never` 两键 sentinel（新旧契约均窄 issue）——豁免判定正确；(c) shutdown :351/:802 豁免理由（停接纳先于输入访问）与 §4.3.1 既有次序一致，实测 :351 期望 `REGISTRY_NOT_ACCEPTING` + `inputTraps===0`；(d) message 文本锚 :553/:958 实测两行均为旧文案 `'…恰含 owner、namespaceId、schema 与 root'`——定位准确；(e) §11 ALLOW 已含 sa7-cordis 行（含 R2 漏列自认）+ plugin/persistence-contract/idle/hostile/rev1 行同步；(f) **超出 R1 要求的加强**：R2 新识别 idle :761/:875/:1025「close 结算后同 key 重建」三处需语义重写——实测 :761 正是该形状（close 窗口后 `namespaceId:'k'` create 期望成功），R1 漏检、R2 补齐，矩阵因此更完整 |
| 3 | MEDIUM：三机制零锚——SA6 回补 或 SA4 登记（二选一） | **闭合（取最强项并双轨）** | (a) §2 D-13 入决策总表；(b) §12.3 给出锚 A/B/C **完整可执行规格**：锚 A（scripted [X,X,Y] + deferred gate 卡 createDoc await + shutdown 断言晚于 create#2 终局/双 Runtime 各恰关一次/stopped/零 unhandled rejection——精确对应 §4.6 屏障语义）；锚 B1/B2（throw 型与 15 字节形状违约：fatal、phase 非旧三、committed:false、零 Persistence、consumed===1、observer 恰一次——精确对应 D-3 反伪降级）；锚 C（共享剧本 [X,X,Y] 并发：lease 集 {X,Y}、每 ID 恰 1 Runtime、createDoc [X,Y]、零 fatal——精确对应 C-1 推论 1；JS 同步接纳段次序使「先后消耗 X、X」确定性成立，规格内部自洽）；(c) SA4 Phase-3 双登记（锚在盘核对 + MAX=8 + admittedCreates 闭环 + observer 三发射点）；(d) 「SA6 落位前不阻塞 SA3 绿判（非 AC 面）」的范围裁决合理；(e) §13 三行补「锚见证」交叉引用 |
| 4 | LOW：§6 过渡条款废止 | **闭合** | §6 开篇明示「两处均已落盘，绿判恒以 15/15 + 零 unhandled source errors 为准（R1 过渡条款废止）」；§12.1 命令 1 注释、§13 末行、§5.1 AC-5 行（实测已改为「§6 修正一已落盘」陈述）四点同步，无生效的 14/15 条款残留（§14 自检声明与全文抽读一致） |

## R2 新引入内容的攻击复核

- **架构零回退**：§4 全部机制（R1 先行声明清单）原样保留；R2 修订面全部位于验收面/文件范围/锚登记——符合 R1 的修订边界要求。
- **§14 回应表**：四行回应与正文修订逐一对照无出入；「R2 一致性自检」的关键术语交叉引用（sa7-cordis / message 锚 / 15/15 / 锚 A/B/C）经抽读核实成立。
- **一处新发现（LOW，不阻塞）**：§7 普查引言的计数「非 registry-create 文件 **33 处**」与其自身枚举（6+1+1+2+2+1+1+2 = **16 处**）不符（red.test.ts 的 18 处属 SA6-owned 非迁移面，不计入亦对不上）。**枚举本身经实测完整且准确**（每行号命中、零站点文件确认为 0），SA3 的执行依据是逐行判定而非总数，故无执行风险；建议后续轮次把计数订正为 16，SA4 复核时以逐行清单为准——不构成本轮驳回事由。

## R2 复审结论

R1 四点（1 CRITICAL + 1 HIGH + 1 MEDIUM + 1 LOW）全部闭合且经独立实证（两条命令实测：tsc 零新增错误、红灯 15/15 保持；16 个普查行号 + 2 个 message 锚 + 豁免理由逐项命中）；R2 在 #2 上还主动补齐了 R1 漏检的 idle 三处语义重写，迁移矩阵强于 R1 要求。唯一残留是上节 LOW 级计数笔误（枚举正确、总数标注错误），不影响绿判、执行边界与任何 AC。架构内核在两轮攻击下均无失守。

**Verdict: pass**
