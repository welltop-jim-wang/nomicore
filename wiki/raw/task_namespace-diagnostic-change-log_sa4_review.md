# SA4 静态验尸报告 — Issue #150 namespace create 生命周期与 genesis 接入诊断变更日志

**Date**: 2026-08-31（R1）；同日 R2 固定范围复审（见文末「R2 复审」节）
**Verdict**: R1 **reject** → **R2 pass**（B1/B2 已于 commit 0f72527 关闭并经独立复验；**最新裁定 = pass**）

- 被审对象：baseline `origin/docs/namespace-diagnostic-change-log` (722bddf) → HEAD (80a2eb8)，即 SA3 实现 commit `85f36bd` + SA6 契约勘误 commit `80a2eb8`
- 审查基准：`task_namespace-diagnostic-change-log.md`（SA6 契约 16/16 + R2 AC5 勘误裁定）、`task_namespace-diagnostic-change-log_design.md`（SA1 R2，SA2 R2 pass）、`task_namespace-diagnostic-change-log_sa2_review.md`（R1 reject / R2 pass 全文）
- 审查方法：全新视角；§1.1–§1.7 全门禁逐项执行；18 插点逐行对位设计 §6.2/§7；独立复跑全部测试与 typecheck；对 seam 面构造越界注入 PoC 实证（临时文件，已删除，工作树无残留）

---

## 独立验证记录（命令 + 结果）

| 验证项 | 命令 | 结果 |
|---|---|---|
| SA6 冻结契约转绿 | `./node_modules/.bin/vitest run packages/namespace-registry/test packages/namespace-diagnostic-log/test --typecheck.enabled=false`（独立进程复跑） | **36 文件 / 554 测试全过，exit 0**；其中 `registry-create-diagnostic-red.test.ts` **16/16 passed**、`registry-create-diagnostic-code-source.test.ts` 2/2 passed |
| CI typecheck 门禁 | `./node_modules/.bin/tsc -p tsconfig.typecheck.json` | exit 0、0 errors |
| PoC（B1 漏洞实证） | 临时测试 `diagnosticLog: null` 与 Proxy throwing-getter 两种注入（文件已删） | **双双命中**：null → `TypeError: Cannot read properties of null (reading 'emitter')` 逃逸、成功 create 翻转为 rejection；Proxy getter → duplicate resolve 语义翻转为 rejection（详见 B1） |
| Scope 比对 | `git diff --name-only origin/docs/namespace-diagnostic-change-log HEAD` vs 设计 §10 ALLOW LIST | 非 whitelist 文件 8 个，7 个在 ALLOW；**1 个超出**（B2）；DENY LIST 零触碰；BLACKLIST 零命中 |
| CI 触发性 | `.github/workflows/ci.yml:39`（`pnpm test`）+ `vitest.config.ts` include | `packages/*/test/**/*.test.ts` 覆盖两个测试文件 ✅ |

---

## 审核结论

1. **设计一致性：⚠️ 偏离 1 处（B1，危险简化级）**；其余 18 插点 stage/code/sourcePhase/result/input/observedAt/initStream 映射与设计 §6.2 总表逐行一致；`registry.ts` 为纯旁路插入（唯一改写的语句 `if (acceptance!=='running') return …` 重构为块形，语义零变化）；DC-1（槽内 encode）/DC-2（initStream 在 factory 前、emit 在 initStream 后）/DC-3（clock 单读：成功路径业务 1 + 诊断 0）/DC-5（诊断包纯 `import type`）/DC-6（未冻结路径显式映射）全部落地；yjs 自 devDependencies 上移 dependencies 与 lockfile diff（workspace link + yjs 平移，版本 13.6.32 不变）一致。
2. **读写路径一致性：✅ 一致**——日志侧只读业务结算点事实；genesis bytes 取自已提交的同一 `initial.doc`（§8.2 无并发写证明成立）；emitter/initStream 单向 seam，无回写。
3. **静默失败：✅ 无新增**——#9 clock fatal 与 encode 失败的诚实缺席为设计 §6.3.2c/§8.5 明示备案（含检测手段），非本实现引入。
4. **降级方案：✅ 安全**——`diagnosticLog` 缺席 → 冻结 no-op 单例（既有 50 用例 + AC4 baseline 逐位一致断言全绿证实零漂移）；无掩盖性降级。
5. **极端攻击：❌ 发现漏洞（B1）**——seam 对象属性访问逸出吞没边界，null/Proxy 注入实证改变业务结局（见下）。
6. **错误处理：❌ 缺口 1 处（即 B1）**——模块自身承诺「任何路径都到不了业务调用栈」（设计 §6.3.4 注释/§6.4 防御表）被证伪；其余防御（emitter.emit throw / issues 三层投影防御 / initStream throw / clock 故障 / encode throw）实现完整且经 SA6 AC4 锚验证。
7. **架构评估：✅ 可行**——对齐 #149 `namespace-runtime/src/diagnostic.ts` 先例，无退回 SA1 信号；B1 为局部边界补齐，非架构制约。
8. **过度设计：✅ 精简**——create-diagnostic.ts 255 行承载 18 结局点 + 设计强制的三层防御，与设计规模预估（约 200 行）相当，无多余抽象。

---

## 阻断项（本轮全部已知项，一次性列出；修复后按固定范围复验）

### B1【reject · 流回 SA3】seam 对象访问逸出吞没边界——违约/畸形 `diagnosticLog` 注入可改变 create 业务结局

**证据（源码 + PoC 双重）**：

- `create-diagnostic.ts:235-243`（emitOutcome/emitEarlyOutcome 闭包）：
  ```ts
  emitOutcome: (observedAt, e) => {
    emitAttempt(diagnosticLog.emitter, observedAt, e);   // ← 属性读取在 arrow body，无 try 包裹
  },
  ```
  `diagnosticLog.emitter` 的求值发生在 `emitAttempt` **函数体 try 之外**（实参在调用前求值）。对照设计 §6.3.1 冻结拓扑：`emitAttempt` 签名收 `diag: { emitter: … }` 整对象、在 **try 内** 读 `diag.emitter.emit(...)`——实现把读取提升出了吞没边界，属 SA2 R2-M2 同类问题的残留变体（SA2 当时只审了 registry.ts 调用点实参面，未覆盖 create-diagnostic.ts 闭包内这一处）。
- 同类对照：`initStream` 包装（:247-253）的 `diagnosticLog.initStream?.(...)` **在 try 内** ✅——同一模块内自证该缺口非必要。
- PoC 实证（临时测试，跑毕已删，`git status` 无残留）：
  - 注入 `diagnosticLog: null`（两个工厂透传均为 `!== undefined` 判断，null 畅通到达闭包）→ 成功路径 create() **rejection**：`TypeError: Cannot read properties of null (reading 'emitter')`。且该 throw 落在 factory try 内（插点 #17 在 `entries.set` 之后）→ 被 #18 catch 吞成 runtime-construction fatal 路径，随后 #18 的 diag 调用**再次** throw 同款 TypeError 直接冲出 catch 块——create() 以裸 TypeError reject（非 `NamespaceRegistryFatalError`），且 entry 已入 map（「结构性零 entry」假设被击穿：entry 泄漏 + committed fatal 误报）。
  - 注入 Proxy（`emitter` getter throw）→ duplicate 路径 create() rejection（应 resolve `NAMESPACE_ALREADY_EXISTS` issue）。

**违反的冻结约束**：ADR-0011「Runtime/Registry/复制实现仍防御 adapter 违约」producer 义务（emitter seam 违约防御是本模块存在理由——AC4 已锚 `emit()` throw 隔离，属性读取 throw 是同一违约类一跳之前）；设计 §6.3.1 吞没拓扑、§6.4 防御表「任何路径都到不了业务调用栈」承诺；AC4「日志侧行为不改变 create 返回值」不变量。

**影响**：违约/畸形 Host 注入（null、throwing getter）下，成功 create 翻转为 rejection（含 entry 泄漏 + fatal 误报）、resolve 语义的拒绝路径翻转为 rejection——业务面零漂移的核心承诺被打破。正常装配（真实 adapter / 缺省）不受影响（554/554 绿证实）。

**修复（SA3，仅 `create-diagnostic.ts`，约 2-4 行）**：二选一—— 两条 arrow body 整体包 try/catch 吞没； 按 §6.3.1 原形把 `diagnosticLog`（或捕获后的 emitter，捕获动作也须在 try 内/或在 no-op 判定处一并做 null 防御）传入 `emitAttempt`、在函数体 try 内读取。同时建议把 `createCreateDiag` 的缺席判定从 `=== undefined` 收紧为 `== null`（null 一并走 no-op，与「缺 emitter = 日志禁用」语义对齐——可选，但能消除最简注入形态）。修后须保持：emit 恰一次尝试、不重试、AC4 全锚不回归。

### B2【reject · 流回 SA1（总控转达）】ALLOW LIST 外新增文件——`packages/namespace-registry/test/registry-create-diagnostic-code-source.test.ts`

**证据**：`git diff --name-only` 实际清单含该新建文件；设计 §10 ALLOW LIST（HEAD 终态）只列 `registry-create-diagnostic-red.test.ts` 一个测试文件，未含此守护测试。

**定性与从宽情节**：该文件是 SA2 R2 遗留 #1 的显式交办（sa2_review.md「建议 SA3/SA4 阶段新增独立测试文件（不改 SA6 冻结文件）」），SA3 实现报告 §1/§5 已透明披露；内容为纯测试（真实 registry + 真实 memory adapter 的运行时断言，质量合格：`SCHEMA_ENVELOPE_4`/`SCHEMA_TEXT_INVALID` 与 p0 同串锚 + `VFSL-ENV-E` 反向锚，无源码 grep 断言）。**文件本身不须回滚**，但 §1.1 硬门禁要求文件清单单源：ALLOW LIST 未随授权链修订即属程序性越界（SA3 已为另外 3 条 INFO 修订过设计文档，却漏改自己新增文件的 §10 登记）。

**修复（SA1，一行）**：设计 §10 ALLOW LIST 追加该文件并标注理由（SA2 R2 遗留 #1 交办）。SA6 冻结契约零牵连。

### 版本 bump（备案放行，非阻断）

`package.json` 0.1.3 → 0.1.4：文件本身在 ALLOW LIST（条目描述只提 dependencies，但授权对象是文件）；与仓库「硬门禁 9」惯例一致（#156/#159/#166 先例：包能力新增即 patch bump；本票新增公共导出类型 + 可选 option 属能力新增）。注意：紧邻同构票 #149（722bddf）**未** bump（仅加依赖）——仓库实践存在不一致，本票取 bump 方向合规且 `private: true` 无发布影响；建议总控在后续票对齐口径，不构成本票阻断。

---

## 非阻断观察（INFO，随 B1/B2 修复顺手处理或交后续）

1. **设计 §12 与实现导出面措辞矛盾**：§12 称 `fatalFromBytes`「模块内私有」，实现将其（连同 `encodeDetachedState`/`fatalFromCommitted`/`createCreateDiag`）模块级导出供 registry.ts 相对导入——§7 伪码本就要求 registry 侧调用它们，实现的取舍正确且 impl 报告已披露；建议 SA1 修订 §12 措辞消除自相矛盾（「不经 CreateDiag 接口暴露 + index.ts 零 re-export」的实际不变量成立）。
2. **#17 emit 位于 `entries.set` 之后**（设计 §6.3.5 冻结次序如此）：若 emitOutcome 可 throw（当前恰因 B1 可能），catch 会把已登记 entry 误判为 runtime-construction fatal——**B1 修复即同时闭合此路径**；修后 emitOutcome 结构性不可抛，该次序安全。残留理论角：`issueLease`/`createLeaseController` 在 emit 后 throw 会产生 #17+#18 双记录（不可达：纯对象构造），交 SA7 动态面知悉即可。
3. **AC5 勘误忠实性核验通过**：commit 80a2eb8 对冻结测试的改动与 SA6 R2 裁定（preferred correction A）逐条对应——首次 initStream 以 `targetRecordsPerSegment:0` 真实失败（`LOG_STREAM_INIT_FAILED/invalid-roll-targets` + 零落盘）、ROOT n:1→n:2、重试 fresh stream（records.length===1、seq 1、物化 n=2 反向锚保留、streams 目录恰 1）；diff 未触碰其余 15 it 的断言（仅 header 注释 + `readdirSync` import + AC5 本体重写）。16 it 计数保持。
4. **#16a 实参 `cause.committed`**：`DocCreateFatalError.committed` 为普通只读 boolean（persistence/contract.ts:142-158，冻结 phase map 派生，非 getter）——SA2 R2「不可抛形态」裁定复核成立。
5. dispatch 第 11 行（SA4 派发）为未提交的工作树修改——总控档案事务，非阻断。

## 各门禁快览

| 门禁 | 结果 |
|---|---|
| §1.1 Scope Creep（ALLOW/DENY/BLACKLIST） | ❌ B2（ALLOW 外 1 文件）；DENY/BLACKLIST 零违规 |
| §1.2 设计偏离 | ❌ B1（吞没拓扑偏离 + 实证业务漂移）；其余逐点一致 |
| §1.3 E2E spec 触发性 | N/A（无 .spec.ts） |
| §1.4 vitest 触发性 | ✅ 两测试文件均落 `pnpm test` include 范围（ci.yml:39 + vitest.config.ts） |
| §1.5 协议假设 | ✅ §11 六项内部接缝依据均有源码锚，无「应该/通常」类无据推断，无外部协议假设 |
| §1.6 契约改动连锁 | ✅ 零契约改动（纯插入 + 可选字段宽化；plugin 路径零影响） |
| §1.7 源码 grep 断言禁令 | ✅ 两测试文件零 `readFileSync`+`toMatch/toContain` 反模式 |
| AC 覆盖（AC1–AC5） | ✅ 16/16 独立复跑绿；AC5 勘误忠实（见观察 3） |
| 测试隔离 | ✅ 独立 tmpdir/memory adapter、无端口无外部服务；554/554 无互扰 |

---

## 动态审核重点（交 SA7）

1. **B1 修复后回归面**：`diagnosticLog` 注入 null / throwing-getter / `emitter: undefined` 三形态 → create 全部结局路径业务结果与无日志基线逐位一致（尤其成功路径不被 fatal 翻转、entry 无泄漏）；emit 仍恰一次尝试。
2. **File adapter first-slice 同步成本实测**：AC2/AC4/AC5 的 Host binding 在 Registry create 槽内同步 mkdir/manifest('wx')/genesis append/current.json rename——设计 §8.5 已声明归属，SA7 在活链路确认同 key FIFO 排队无异常放大（一次性、每 namespace 至多一次）。
3. **shutdown 与在途 create**：`await carrier.tail` 对含同步 emit/initStream 的在途槽的等待行为（设计 §8.5 三条：不调 initStream、不 drain、零新增异步状态）。
4. **双记录理论角**（观察 2 残留）：不可达路径，仅确认日志无 #17+#18 双 attempt 即可。
5. **CI 触发证据**：`gh run view --log` 摘录 `registry-create-diagnostic-red` 与 `registry-create-diagnostic-code-source` 两文件在 PR CI `pnpm test` 步骤真实执行的行（§1.4 静态结论的动态确认）。

## 复验范围（固定）

B1 修复 diff（限 `packages/namespace-registry/src/create-diagnostic.ts`）+ B1 直接影响面（SA6 冻结套件 16 it、`registry-create.test.ts` 50 用例、AC4 隔离锚全量重跑）+ B1 修复后按观察 1 补的 §12 措辞（SA1 侧）+ B2 的 §10 一行修订。其余已审项（18 插点映射、AC 覆盖、触发门禁、DENY 边界）本轮已过，除非修复 diff 越出上述范围否则不再重审。

**Verdict: reject** —— B1（SA3，create-diagnostic.ts 吞没边界补齐）+ B2（SA1，§10 ALLOW LIST 一行修订）共同修复后，按上述固定复验范围复审；预期 residual = pass。

---

# R2 复审（2026-08-31）— 固定范围 — Verdict: **pass**

**复审对象**：SA3 修复 commit `0f72527`（B1/B2）+ `6ae689f`（dispatch 档案）。
**复审范围**：严格限定 R1 声明的固定复验范围——B1 `create-diagnostic.ts` 边界修复 + 直接影响面（SA6 16 契约、`registry-create.test.ts` 50、AC4 隔离锚）+ B2 §10 登记 + 观察项 1 落实。R1 已过项不重审。**未发现新暴露阻断项，未扩scope。**

## B1 关闭核验（源码 + PoC A/B + 回归三重）

**修复拓扑（create-diagnostic.ts:227-281）**：
- `createCreateDiag` 缺席判定收紧 `diagnosticLog == null`（null/undefined 均 = 日志禁用——R1 建议选项落地）；
- `emitter` 在**构造栈内一次读取 + 最小形状校验**（非 null object 且 `emit` 为 function），读取与校验整体在 try 内——敌意 Proxy getter（emitter/emit getter throw）→ 收敛 NOOP_DIAG（日志禁用）；畸形 emitter（`{emitter:{}}`）同收敛；
- emit 路径（emitOutcome/emitEarlyOutcome）**只使用构造期捕获的 emitter 引用，零 `diagnosticLog` 本体属性读取**；`emitter.emit` 读取+调用留在 `emitAttempt` 吞没 try 内（含构造后 Host 把 emit 换成非函数/throwing getter 的后变形态——TypeError 被 emitAttempt try 收编）；
- `initStream` 属性读取（含敌意 getter）与函数调用在**同一吞没 try** 内；
- 全模块再无任何 `diagnosticLog` 属性读取逸出吞没边界的路径（`== null` 比较不触发 get trap）。合规装配（真实 adapter）行为逐位不变：emitter 同一对象，捕获语义等价——16/16 + 50/50 复跑证实。
- emit 恰一次尝试/不重试/AC4 全锚语义未受修复影响。

**PoC A/B 对照（R1 同款临时测试，逐字重建，跑毕即删）**：

| 注入形态 | R1（85f36bd） | R2（0f72527） |
|---|---|---|
| `diagnosticLog: null` | ❌ `rejected TypeError: Cannot read properties of null (reading 'emitter')`（成功 create 被翻转，含 entry 泄漏 + fatal 误报路径） | ✅ `{"kind":"resolved","ok":true}` |
| Proxy `emitter` throwing getter | ❌ duplicate `rejected`（resolve 语义被翻转） | ✅ first `resolved ok:true`；duplicate `resolved + NAMESPACE_ALREADY_EXISTS` |

**SA3 回归测试（code-source 套件新增 4 it，运行时行为断言、无源码 grep 反模式）**：null / 敌意 Proxy（全 getter throw）/ 畸形 emitter 三形态共用 `assertSeamViolationIsolated`（create ok + lease.createdAt 精确 + duplicate resolve `NAMESPACE_ALREADY_EXISTS` + `getStatus()=={state:'running'}`）；第 4 it 锁 initStream 同步 throw → create ok + createdAt + running。与 R1 PoC 攻击面一一对应，防回归面完整。

## B2 关闭核验

设计 §10 ALLOW LIST 已登记 `packages/namespace-registry/test/registry-create-diagnostic-code-source.test.ts`（标注 SA2 R2 遗留 #1 + SA4 R1 B1 回归双理由，`[SA3 owned]`）。HEAD 全量 diff（剔 whitelist）与修订后 ALLOW LIST **逐文件精确一致，零越界**。附带（同属 R1 观察项 1 与可共同修复集）：§6.4 新增「diagnosticLog 对象违约」防御行（语义与实现一致）、§12 导出不变量措辞修正（「模块级导出但不经 CreateDiag 接口暴露、index.ts 零 re-export」——与实现实际一致）。

## 固定范围回归证据（独立进程复跑）

| 项 | 命令 | 结果 |
|---|---|---|
| SA6 冻结契约（含 AC4 四隔离锚：emitter throw/队列压力/禁用一致/stream-init 失败） | vitest（见下） | **16/16 passed** |
| `registry-create.test.ts`（业务零漂移既有面） | 同上 | **50/50 passed** |
| code-source 套件（2 守护 + 4 seam 回归） | 同上 | **6/6 passed** |
| 双包全量 | `./node_modules/.bin/vitest run packages/namespace-registry/test packages/namespace-diagnostic-log/test --typecheck.enabled=false` | **36 文件 / 558 测试全过，exit 0** |
| CI typecheck 门禁 | `./node_modules/.bin/tsc -p tsconfig.typecheck.json` | **exit 0、0 errors** |
| 修复 diff scope | `git show 0f72527 --stat` + §10 比对 | 业务代码仅 `create-diagnostic.ts`（B1 固定范围内）；测试文件已登记；其余为 wiki 档案（含本 R1 报告逐字节原样入档，完整性核验一致） |

## 残留（非阻断，交 SA7 备案）

1. 构造期捕获语义：emitter 形状在构造时判定、引用构造时冻结——Host 若在构造后动态替换 emitter/emit（违约邻接形态），行为 = 构造期快照（emit getter 后变 throw 已由 emitAttempt try 兜住；换对象则按旧引用继续）——已在 §6.4 新行文档化，ADR-0011 best-effort 允许；SA7 活链路无须专项。
2. 畸形 seam 收敛为「静默日志禁用」无独立健康通道（与「不代发健康事件」纪律一致，§6.4 已备案）。

## R2 裁决

**Verdict: pass** —— B1（吞没边界补齐，PoC A/B 红转绿 + 4 回归 it 锁定）与 B2（§10 登记，diff 与 ALLOW LIST 精确一致）均真关闭；固定范围回归面全绿（16/16、50/50、6/6、558/558、typecheck 0）；零新暴露阻断项。R1 五条动态审核重点中第 1 条已被本轮静态+PoC 关闭，其余四条（同步成本、shutdown tail、双记录理论角、CI 触发证据摘录）仍交 SA7。本 pass 不替代 SA7 活链路验证。
