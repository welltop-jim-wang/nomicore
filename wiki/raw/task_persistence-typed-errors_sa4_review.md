# SA4 静态验尸报告 — issue #108 persistence：typed load/create 错误与 committed-aware create fatal（Phase 3）

- **Date**: 2026-06-0x（SA3 实现后静态评审会话）
- **Reviewer**: SA4（Red Team / 静态验尸）
- **评审对象**: `git diff ba1b6b4`（工作树 vs base，无专属 commit）——src 6 文件（SA3 5 + SA6 testing.ts）+ 测试 4 文件
- **依据**: design R1.1（675 行，唯一权威）/ SA3 impl（D-1~D-4）/ SA6 red（21 红）/ SA2 R2（PASS + io.write=2 静态检查项交办）
- **独立复跑证据**: `npx vitest run packages/persistence`（后台独立进程）→ **exit 0，Test Files 10 passed (10)，Tests 94 passed (94)，Type Errors no errors，无 Unhandled Errors 段**（/tmp/sa4-vitest.log）；`npx tsc -p packages/persistence/tsconfig.json --noEmit` → **exit 0**（/tmp/sa4-tsc.log）

---

# Verdict: **pass**

（附 2 条非驳回级发现：1 MINOR 注释级 + 1 TRIVIAL 排序级，均要求随 PR 顺手闭合；零 HIGH/零 REJECT。设计逐点落实、行为不变量、SA2 交办三项、红灯→绿灯证据链、DENY 合规全部核验通过。）

---

## 维度 1 — 设计逐点落实（逐文件过堂）

### 1.1 contract.ts（§1.1–§1.3 / §4.1）✅

| 设计点 | 核验结果 |
|---|---|
| `DocLoadOperationalError` §1.1 逐字签名 | ✅ `code:'DOC_LOAD_OPERATIONAL'` 字面类字段、默认 message 常量、`name`、cause 构造器赋值；JSDoc 含「Corruption/validate failures and disposed-race failures are NOT this type」边界段 |
| `DocCreateOperationalError` §1.2 | ✅ `committed: false = false` 字面字段；JSDoc Boundary 段（R1/A-5）逐字（信任 §3.1 契约、(c) 复核已否、seam 违约 ⇒ adapter bug、AC6 by CONTRACT not by mechanism） |
| `DocCreateFatalPhase` 四值 | ✅ `'probe-read' \| 'snapshot-encode' \| 'store-write' \| 'post-commit'`，逐值注释含与 Registry 三值零词面重叠说明 |
| 冻结映射 | ✅ `export const DOC_CREATE_FATAL_PHASE_COMMITTED: Readonly<Record<…, boolean>>` + `Object.freeze`，post-commit 唯一 true |
| `DocCreateFatalError` §1.3 | ✅ `committed` 由冻结映射派生（构造器内 `DOC_CREATE_FATAL_PHASE_COMMITTED[phase]`，I-2 机制成立）；JSDoc 永不 rollback/committed:true 禁重试 |
| 无共享基类（§1.4） | ✅ 四类互相独立的 Error 直接子类，两两 instanceof 互斥（EC8 双向断言锁定） |
| `DocDuplicateError` 逐字节不动（§6.1） | ✅ `git diff` 全 hunk 为纯新增（contract.ts 删除行数 = 0） |
| **D-1（override cause）** | ✅ **接受**。等价性三重亲证：①tsconfig 事实成立——`tsconfig.base.json` `target/lib: ES2022`（`Error.cause?: unknown` 存在）+ `noImplicitOverride: true` ⇒ 设计原签名必产 TS4114，不可编译；②node 运行时对照（/tmp 现场执行）：`override` 为纯类型修饰（emit 擦除），两种写法均产出 `Object.keys = ["cause"]`、`cause` own-enumerable、`cause === 注入实例` identity、`JSON.stringify(err) = {"cause":{}}`（Error 型 cause 不泄漏文本，R-2 面安全）——与 `DocDuplicateError.code` 类字段模式完全同构；③绿灯套件中 `toMatchObject({code, committed})`、cause `toBe`、`JSON.stringify` 负锁（assertNoSensitiveText/EC9 N3）全部通过即运行时形状的经验证明。设计 §8「实现需要等价微调」预授权成立 |

### 1.2 lifecycle.ts（§4.2）✅

| 设计点 | 核验结果（行号引用现文件） |
|---|---|
| §4.2.1 seam 注释重写 | ✅ L15–L40：观察通道公理、resolve⟺committed（禁 silent no-op resolve）、reject⟹store 未变 + abort 入口门（Memory hook 前 / File 三道门全在 rename 前）+ 已进入运行至完成、seam 违约定义①部分提交后 reject ②**同步 throw 禁句**（R1/A-2 逐义）、read 同款 honor signal。接口签名逐字不动 |
| §4.2.2 import 扩展 | ✅ 三类并入既有 `./contract.js` import（L3/L4/L6）；DAG 不变，无反向 barrel |
| §4.2.3 claim 段两位点 + assertCurrentEpoch | ✅ L196–L209（pending-load ticket）与 L216–L223（self-probe ticket）各一 try/catch，`this.isCurrent(epoch) ? new DocCreateOperationalError(err) : new DocCreateFatalError('probe-read', err)`——R1（raw 拒绝+current→operational）/R2（raw 拒绝+stale→fatal）/R3（raw 成功但 assertCurrentEpoch 拒绝→恒 stale→fatal，旧 disposed Error 成 cause）三格全中。**duplicate 判定（L210/L224）在 try 之外，C1 逐字不动** |
| §4.2.4 三段式 | ✅ L239–L266：encode 段→`'snapshot-encode'` fatal（W1）；write 段→current/stale 三元（W2/W3）；提交后段（assertCurrentEpoch+createEntry+cells.set+issueHandle 整体）→`'post-commit'` fatal（W4/W5，write resolved ⇒ committed:true，无 rollback 声称）。**外层 catch（L267–L273）仅做 claim 清理（`cur?.state==='creating' && cur.claim===claim` 守卫逐字保留，diff 为纯 context 行）后原样 rethrow——零二次包装**。`claim.promise = op.then(...)` U8 接线逐字不动（L277） |
| §4.2.5 routeOwnedRead 包装 | ✅ L435–L442：`cells.delete(key)` 清理保持在前，`throw snapshot.err` → `throw new DocLoadOperationalError(snapshot.err)`（exact identity；同 ticket 共享 ⇒ 同一包装实例，EC1 `toBe` 断言绿）。disposed-first（L431–L434）与 restore/validate（L449–L455）分支逐字不动 |
| §4.2.6 completion.catch | ✅ L393–L397：deferred 构造后立即挂 no-op 吸收 + 设计文案注释（awaited consumers still observe——多订阅者各自观察，EC1 双 load 同实例证明 load 路径观察未被吞） |
| §4.2.7 零改动 | ✅ saveDoc/flush/scheduleRetry/maybeEvict/dispose/seedForTest/句柄状态机——diff hunk 清单中这些区域零触碰（flush L531–L559 与 base 逐字节一致） |

### 1.3 memory.ts（§4.3）✅（附 F-2）

- **门移位（§4.3.1/§3.5 方案 (a)）**：✅ `signal.throwIfAborted()` 在 io.write 入口（flat hook 之前），旧 `if (signal.aborted) return` 早退 resolve 已删除，hook 后直接 mirror set（`snapshot.slice()` 保留）**无第二道门**——与设计代码块逐字一致。async 闭包内同步 throw ⇒ returned Promise 拒绝，不违反同步 throw 禁句。
- **io 闭包注释（R1.1/N-3 新文案）**：✅ 「the abort gate sits at io.write ENTRY (before any hook side effect); a write that has entered runs to completion — hook side effects + mirror set — and resolving means committed (§3.5/ADR observable-channel axiom)」；「Byte-order and await-depth identical…」句保留；read 侧注释（`??` 短路、hook 唯一读权威）逐字不动。
- **dispose 排空+清序注释（§4.3.2）**：✅ drain-then-clear 机制陈述（tracked op 排空 ⇒ 晚到 mirror set 先于 `allSettled` 返回 ⇒ `snapshots.clear()` 清除）。全 src grep「aborted-signal guard」残留 = NONE；类 doc（R4/IO-3）本就机制中立，无需改写，SA3 判断正确。
- **writeSnapshot 义务改写（§4.3.4）**：⚠️ 新契约句已写入（run-to-complete / 副作用前 reject / 不得部分提交后 reject / abort 检查归入口门）——**但保留了陈旧首句，见 F-2**。
- **wrapIo + 装配（§3.4）**：✅ JSDoc 逐字；`const io = options.wrapIo !== undefined ? options.wrapIo(baseIo) : baseIo`——显式传 `undefined`（exactOptionalPropertyTypes 下合法）亦走 baseIo 恒等，默认路径不可被改变。
- **工厂 Omit 收紧（R1/A-3）**：✅ `Omit<MemoryPersistenceOptions, 'scheduler' | 'wrapIo'>`。

### 1.4 file.ts（§4.4）✅

- `FilePersistenceOptions.wrapIo`（§3.4 JSDoc 逐字，D-4 登记跨文件重复为共享文案）；构造器 io 闭包提为 `baseIo` + 同款装配——read/write 两行闭包为纯 context（逐字节不变），`readCommittedSnapshot`/`writeCommittedSnapshot`/身份校验零改动；**默认 IO = 真实 mkdir→tmp→rename（L120–L125 亲证三道门全在 rename 前）**。工厂 Omit 同款收紧。✅

### 1.5 index.ts（§1.5）✅（附 F-1）

- 6 项 additive 导出（4 值 + `type DocCreateFatalPhase` + `export { type PersistenceIO } from './lifecycle.js'`）；**导出集合 diff 亲证 = 纯新增、零删除/零改名**（base/head 集合比对仅 5 行 `>` + 独立 lifecycle 再导出块）。⚠️ 既有行被字母序重排——见 F-1。

---

## 维度 2 — 行为不变量（§6）逐条静态核对 ✅

1. **DocDuplicateError 逐字节**：contract.ts 零删除行；lifecycle `duplicateError()` 动态 message 构造（含 owner/key）未被任何 hunk 触碰。✅
2. **裸通道字面**（逐字 grep 亲证在位）：`'persistence is disposed'`（L607/L610 → loadDoc/saveDoc/createDoc 入口 L0/C0；L343 loadSlowPath L5；routeOwnedRead L433 disposed-first L2）；`'createDoc rejected: persistence is disposed'`（L614 定义；调用位 L198/L218/L260 **全部包在分类 try 内** ⇒ 仅作 fatal cause 存续，§6.2 精确满足）；`'foreign or released DocHandle'`（L285/L603）；META.docId 双文案（L463/L477）；`persistence integrity:*`（L168/L347）。✅
3. **saveDoc/flush/retry/evict/seedForTest 零改动**：diff hunk 清单逐一排除，flush 区段逐字节一致。✅
4. **loadDoc null 语义/合流/U8**：未触碰。✅
5. **dispose 语义 + Memory 排空+清序**：静态论证成立——io.write 调用点恰 2（见维度 3a）且均在 tracked op 内；`closed=true` 后 createDoc/flush 入口守卫使新写不可能启动 ⇒ 不存在晚于 `snapshots.clear()` 的 mirror 写。✅
6. **File 默认 IO 逐字节**：✅（1.4）。R1.1/N-1 措辞修正已按 SA2 要求落进设计 §6.6（本评审以 §4.3+§3.3 末段 bullet 为 Memory abort 行为权威基线）。
7. **模块图守卫**：contract.ts 叶地位不变（lifecycle→contract 单向）；新代码无 `./index.js` 反向 import（memory→lifecycle、testing→lifecycle type-only）；diff 新增行 grep `setTimeout(|setInterval(|Date.now(` = **NONE**；module-graph-regression（4）+ core-dsh-boundary（6）在复跑中全绿。✅
8. **probe 确定性**：dsh-persistence 零改动（DENY 核证）；「abort 先于 io.write 进入不再到达 writeSnapshot hook」为设计 §3.3 末段显式声明的不可观察变化——动态面归 SA7（重点 5）。
9. **导出面纯 additive**：✅（1.5）。
10. **插件工厂签名**：✅ 两工厂均 `Omit<…, 'scheduler' | 'wrapIo'>`（维度 6 附调用方核证）。

---

## 维度 3 — SA2 R2 交办项 ✅

**(a) io.write 调用点 = 2 且均 tracked（亲证）**：
`grep -rn "io\.write(" packages/persistence/src/` → lifecycle 恰 2 处：**L250**（createDoc 写段，位于 `const op = this.track((async () => …))` 内）与 **L537**（flush，唯一起动方 `startFlush` L528 `void this.track(this.flush(…)).catch(…)`——onDebounce/onMaxDirty/retry 三路均汇于此）。testing.ts 的 2 处是 fault-seam 包装层对**内层 io 的委托**（wrap.write → io.write），非 lifecycle 新调用点。SA2「io.write=2 且均 tracked」前提在实现后保持成立 ⇒ §6.5 排空+清序不变量的机制前提未被破坏。✅

**(b) N-1~N-6 在 R1.1 的闭合状态抽查（消项）**：
- N-1 ✅ §6.6 已改写为「零行为增量 + Memory abort 语义变化权威见 §4.3/§3.5」+ 显式声明 SA4/SA7 基线（design L548–549）；
- N-2 ✅ §3.3 表头/flush 行三结局化 + §10 flush 行同步（L270–274/L632）；
- N-3 ✅ §4.3 第 3 条列入 io 闭包注释并给出新文案（L376）——且实现侧确实照抄（1.3）；
- N-4 ✅ §10 插件工厂 caller 行改为 core-dsh-boundary L44–45/L64/L71/L78 + profile L59/L75 + file-persistence L394，并显式标注 L116 修正说明（L637）；
- N-5 ✅ 头注更新为 ba1b6b4 + rebase 说明（L5）；
- N-6 ✅ §5.3 wrap 草图注释改为「wrap 自洽契约保证 / 对当前两 Adapter 属冗余防御」措辞（L471–475）——testing.ts 实现注释与之同义（"keeps ANY inner io within the PersistenceIO contract"）。六条全部消项。✅

**(c) D-1（override cause）等价性核验**：见 1.1 表末行——tsconfig 事实成立（设计签名不可编译）、`override` 类型擦除运行时零差异（node 对照：own-enumerable/identity/JSON 面三同）、与 `DocDuplicateError.code` 类字段模式一致、绿灯 toMatchObject/toBe/JSON 负锁经验证明。**接受，非伪偏离**。✅

---

## 维度 4 — 红灯→绿灯证据链 ✅

- **独立复跑**：`npx vitest run packages/persistence`（独立进程）→ **94/94、exit 0、Type Errors no errors、输出无 Unhandled Errors 段**（vitest 对 unhandled rejection 判败 ⇒ 其缺席即 §4.2.6 修复的进程级证据）；`npx tsc … --noEmit` → exit 0。与 SA3 报告 §1 及总控验收一致。✅
- **21 红 × 根因映射抽查**：EC1/EC3/EC4（缺类型 + wrapIo 未接线 + routeOwnedRead/claim/write 分类缺失）→ §2.2.5/§2.2.3/§2.2.4 + contract/index/wrapIo，逐点对上；EC5/EC6/EC7（hold 超时红）→ seam 接线 + 提交后段/claim 段分类 + completion.catch，绿；EC8 → 类型互斥（EC8 用例在场且绿）；EC9 → encode 段分类（独立文件在场且绿，`cause toBe(encodeFault)` identity 锚过）；EC10 → memory 门位移（专属 describe 在场且绿：phase post-commit + committed true + makeFresh 读回 + L0/C0 裸传四断言全过）；§5.4.1（W2 + cause identity + message 负锁 + 保留断言齐全：doc 未销毁/pending 0/fresh null/同 doc 重试——testing.ts L460–476 亲读）/§5.4.2（W3 + `cause === writeAborted` identity 变体 + 原 4 断言保持）/§5.4.3（`DOC_LOAD_OPERATIONAL` + cause EACCES 保真 + tmp 留存断言保留）。根因映射与代码实况一致，无「红→绿但锚错位」迹象。✅

---

## 维度 5 — 静态漏洞狩猎 ✅（零命中；两点风险转 SA7 动态）

| 攻击面 | 静态结论 |
|---|---|
| 分类 catch 吞错/重复包装 | 无吞错：每个新 catch 均分类后 rethrow；外层 create catch 原样 rethrow（L272 `throw err`）。无重复包装：分类格点互不重叠（claim 两站点/三写段/routeOwnedRead 各自独立），已分类错误不会再进入任何分类器；flush 的 `catch {}`（degraded 通道）为既有行为零改动 |
| epoch 判别位点 | `isCurrent(epoch)` 全部在 catch 子句内（await 拒绝之后）求值——正确重取；R3 路径 `assertCurrentEpoch` 抛 ⇒ isCurrent 必为 false，无歧义窗口 |
| cells.delete 与 rethrow 顺序 | routeOwnedRead：清理在前包装在后（L436→L442）；外层 create catch：清理（守卫）在 rethrow 前；reading cell 清理归 driver（driveLoadRead→routeOwnedRead，机制未动） |
| wrapIo 默认路径 | `wrapIo !== undefined ? wrap(baseIo) : baseIo`——两 Adapter 同款，undefined（含显式）⇒ baseIo 恒等；File 默认真实 FS 路径字节不变 |
| memory 门移位 × hook 抛错 × dispose | hook throw（epoch current）→ W2 operational；dispose 后 hook 显式 reject → W3 fatal（§5.4.2 identity 锚 + EC7 AbortError 锚互补，两锚均在绿灯套件）；abort 先于进入 → 入口门 AbortError → W3；abort 落在 hook 在途 → 运行至完成 → resolve → W4 committed:true（EC10 锚）。四象限闭 |
| post-commit 段 cells.set 复活攻击 | `assertCurrentEpoch` 在 cells.set 之前（L260→L262）——stale 时永不重插 cell |
| completion.catch 吞观察 | `.catch` 派生新 promise，原 deferred 的全部 await 订阅者仍收到拒绝；EC1 双并发 load 同一实例 `toBe` 即直接证据 |
| io.read 同步 throw（L7） | `this.io.read` 调用不在分类 try 内——设计 L7 明裁以契约句封死（同步 throw 属 seam 违约），行为保持，非回归 |
| 排空+清序不变量 | 见维度 3a + 维度 2.5——静态成立 |
| 死锁 | EC5/EC6/EC7/EC10/§5.4.2 五处 hold 构造均「dispose 不先 await、release 后置」——无 await 环（与 SA2 R2 独立 trace 结论一致） |
| 新增 throw 点 | 每个新 throw 均为既有裸 throw/rejection 的 typed 包装替换，零新增裸逃逸面（§10 风险评估主张成立） |

转 SA7：EC7 cause（`signal.reason` DOMException）`instanceof Error` 的双 Node 版本确认；EC5(File) hold.entered 时刻磁盘 `.snapshot` 在位探针（共享套件未做、SA6 已登记）。

---

## 维度 6 — DENY LIST 合规 / Scope Creep Guard ✅

- **actual diff 文件集**（git status + `git diff ba1b6b4 --name-only`）：`src/{contract,lifecycle,memory,file,index,testing}.ts`（6）+ `test/{memory-persistence,file-persistence,file-persistence-sa7-dynamic}.test.ts`（3 改）+ `test/persistence-encode-fatal.test.ts`（1 新）+ wiki/raw 任务档案（白名单豁免）。**与 ALLOW LIST 10 项一一对应，comm 剩集为空——零 scope creep**。
- **DENY 核证**：`git diff --name-only | grep -E "service\.ts|package\.json|dsh-persistence|namespace-runtime|^docs/"` → 空。service.ts/package.json/dsh-persistence/namespace-runtime/docs 零改动。✅
- **BLACKLIST**：无 lockfile/TASK.md/.bak 类文件。✅
- **测试触发性（skill §1.4）**：新/改测试全在 `packages/persistence/test/`，被根 `vitest.config.ts` include（`packages/*/test/**/*.test.ts`）覆盖，由 `.github/workflows/ci.yml` `test` job（`pnpm test` = `vitest run --typecheck`）触发——无 CI 黑洞。✅
- **协议假设（skill §1.5）**：设计 §9 声明无协议级假设；三条底层依据均源码/既有测试引用（`throwIfAborted` 现存于 file.ts L120/122/124 亲证；chmod 用例现存）——无需复跑。✅
- **测试质量（skill §1.7 源码 grep 断言禁令）**：新/改测试文件无「readFileSync(源码) + toMatch/toContain」反模式——file-persistence.test.ts 的 readFileSync 均为读**数据快照文件**做 Yjs 解码行为断言（既有用法）；EC1–EC10 全部为运行时行为断言（instanceof/字段全等/cause identity/store 读回/负锁）。✅

---

## 发现清单

| # | 严重度 | 位置 | 问题 | 证据 | 修复要求 | 回流目标 |
|---|---|---|---|---|---|---|
| F-1 | TRIVIAL（未登记偏离） | `packages/persistence/src/index.ts` | 既有导出行被字母序重排（`NOMICORE_PERSISTENCE_SERVICE` 与 `DEFAULT_PERSISTENCE_SCHEDULE` 换位并入新条目排序）——设计 §4.5 要求「既有导出与分组逐字不动」，且 D-1~D-4 未登记 | `git diff ba1b6b4 -- src/index.ts` 首个 hunk；导出集合 base/head 比对证明**集合恒等 + 6 纯新增**（零行为影响） | PR 描述一行注明（或恢复原相对顺序）。非阻塞 | SA3（随 PR） |
| F-2 | MINOR（陈旧注释残留，N-3 同类） | `packages/persistence/src/memory.ts` `writeSnapshot` JSDoc 首句 | 保留陈旧首句「**The hook must honor `signal` (abort ⇒ reject promptly)**」——与本块新契约（run-to-complete / 「Abort checks are the adapter entry gate's job: the hook may consult `signal` but is not required to」）**自相矛盾**，且文档化的正是被 §3.5 方案 (a) 否决的 R0 语义：委托模型 hook 若照首句在副作用后 reject 恰构成声明的 seam 违约。设计 §4.3.4 要求义务**改写**，SA3 改写不彻底 | memory.ts L24–L36 现文（首句 vs 末句冲突）；设计 §4.3.4 原文无此句 | 删除或改写该首句为设计 §4.3.4 文案（一行级）。非阻塞（纯注释、零运行时影响、分类与测试全对） | SA3（随 PR 一行闭合） |

**无 HIGH/REJECT 级发现。** 架构评估：无需退回 SA1（方案 (a) 落地完整，未绕过任何架构约束，无 FIXME/临时补丁）。过度设计评估：变更半径与设计规模吻合（src 5 文件 +102/+108/+75/+14/+9 ≈ 设计估算），wrapIo 为设计论证过的唯一新增 seam，无多余抽象。

---

## 动态审核重点（转 SA7）

1. **CI 全链路（AC8）**：PR 上 `pnpm typecheck` + `pnpm test`（含 persistence 94）在 Node 20/24 矩阵全绿；从 `gh run view --log` 摘录 persistence 段测试计数与「无 Unhandled Errors」证据。
2. **A-1 四锚稳定性**：EC5/EC7/EC10/§5.4.2（均含 2000ms withTimeout 护栏的时序构造）重复运行 ≥5 次防 flake；确认 0 unhandled errors 持续成立。
3. **EC7 cause 形态跨版本**：`signal.reason`（DOMException AbortError）`instanceof Error` 在 Node 20 与 24 双版本成立（本机单版本绿灯为隐式证据，双版本显式确认归 SA7）。
4. **EC5(File) 磁盘事实探针（可选）**：设计「hold.entered 时 File 可断言 `.snapshot` 已在盘上」共享套件未实现（fixture 不暴露 rootDir，SA6 §4.6 已登记；N5 行为证伪已覆盖契约）——SA7 可临时探针补证或显式登记放弃。
5. **dsh probe 确定性（§6.8）**：全仓套件中 probe/profile/dsh-profile-acceptance 全绿 + 事件流零漂移（本评审静态确认 dsh-persistence 零改动 + 总控 1223/1223；动态日志证据归 SA7）。
6. **flush 三结局（N-2）**：memory 既有 L437/L461/L490 类用例在新门位下结局不变——已含于 94 绿，SA7 抽 CI 日志确认即可。
7. **可选补遗**：wrapIo 不泄入生产插件工厂的 typecheck 级静态锚（design §3.4 可选 `.typetest`/expectTypeOf）未实现——SA7 可补或登记显式放弃（非阻塞）。

## 结论

**pass。** 设计 §1/§2/§3/§4/§6 逐点落实（唯一偏离 D-1 经三重亲证为编译必要且运行时零差异）；行为不变量逐条保持；SA2 交办三项（io.write=2 亲证 / N-1~N-6 消项 / D-1 等价）全部闭合；红灯→绿灯证据链与独立复跑（94/94、tsc 0、0 unhandled）一致；DENY/ALLOW 零违规。F-1/F-2 两条非驳回级发现随 PR 一行级闭合。SA7 可进入动态验证。
