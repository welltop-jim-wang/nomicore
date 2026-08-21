# SA4 静态验尸报告

**Date**: 2026-08-21（R1）｜ 2026-08-21（R2 复审，见文末「R2 复审节」）｜ 2026-08-21（R3 补录：§1.4 窄幅补项，verdict 维持 pass，见文末「1.4 vitest 触发性自检（R3 补录）」）
**Verdict**: R1 = reject（R1 高危已复现 + R2 文件清单台账违约）→ **R2 复审 = pass（R1/R2 均解除，commit `4e802b8`）**；R3 补录 = 窄幅自检，**verdict 维持 pass**；R1 记录原文保留于下

- 被审对象（R1）：commit `081a3b3`（SA3 R1，分支 `fix/issue-64-on-adr-server-design`，base `origin/adr/server-design` = `37561ac`）；被审对象（R2 复审）：commit `4e802b8`（SA3 R2 修复）+ 设计 R4 版（1046 行）
- 审查基准：设计 R3 pass 版（950 行）/ R4 版（1046 行）+ SA2 三轮评审 + SA8 两份冲突报告 + `_relevant_decisions.md` + SA6 红灯套件源码逐行 + base 版 `memory.ts` 逐函数对照
- 绿灯核验（引用，非 SA4 重跑）：`.mabf-bg/sa3-verify-issue64.log` = typecheck no errors + 32 files / 491 tests passed，exit 0；红灯基线 `.mabf-bg/red-confirm-issue64.log` = 14 failed | 25 passed，与 SA6/SA1/SA2 记录逐条一致

---

## 一、攻击发现（reject 项）

### R1（HIGH，已复现）进程级共享快照存储：跨 store 数据泄漏 + 假 `DOC_DUPLICATE` + dispose 不清理

**SA3 注记 1 对账结论：锚定主张为真，但所选机制的作用域过宽，属未被设计覆盖的危险偏差。**

**静态证据**（`packages/persistence/src/memory.ts`）：

- L39-48：模块级 `const sharedSnapshots = new Map<string, StoredSnapshot>()`——进程全局、仅以 `userId\0docId` 为键、与「hooks 指向哪个外部 store」完全无关。
- L46-48：构造器只要 `readSnapshot` **或** `writeSnapshot` 任一存在即挂接该全局 map；无 hooks 实例保持实例私有 map（与 base 一致，逐字保留）。
- 全文件 grep：该 map 无任何清理点（`dispose()` 不清；base 版 dispose 有 `this.snapshots.clear()`，此行为已丢失）。
- L59-63：`read = external ?? fallback`，fallback 于读发起时同步捕获——外部 store 返回 undefined 时**静默**顶替为镜像内容。

**复现证据**（独立进程 vitest，2026-08-21 22:30，临时文件跑后即删、worktree 零残留）：

```ts
// adapter A：hooks 指向 storeA → createDoc(alice,'doc1',A-content) → dispose()
// adapter B：hooks 指向全新空 storeB（read/write 均指向 storeB）
B.loadDoc(alice, 'doc1')     // 实测输出: LEAKED content who=A-content（应为 null）
B.createDoc(alice,'doc1',…)  // 实测输出: rejected: DOC_DUPLICATE（应成功）
```

**三重违约**：

1. **跨 store 数据泄漏 + 假 duplicate**：任一进程内两个 hooks 实例指向不同 store，B 会读到 A（哪怕是已 dispose 的 A）的快照；createDoc 的排他判定前提「store 存在性读见快照」读到的是**别的 store** 的快照 → 公共 API `createMemoryPersistence` / `MemoryPersistenceOptions` 上的正确性缺陷。
2. **base 行为回归 + ADR 违反**：base dispose 清空私有 store；新实现全局 map 永不清理，已 dispose 实例数据可被后续实例复活——违反 ADR-0006「插件采用工厂/实例模型而非全局单例，以支持测试隔离、不同 rootDir 与 HMR/reload」。
3. **设计 §5.3 被违反且未修订**：设计草图为构造器内 per-instance `const snapshots = new Map()`。当前 491 绿灯是「侥幸」——各用例 docId 恰好互不重叠（`memory-persistence.test.ts` 内 19 条既有 hook 用例全部使用 `alice/doc1` 并向全局 map 写镜像，仅因无后续用例经 fallback 读同 key 而未爆）。

**锚定依据核验（为何 SA3 被迫偏差）**：`testing.ts:327-330` case 4 的写门控是丢弃型 no-op（`store.write = async () => { enteredWrites += 1; await gate }`，payload 不落 fixture store），随后 `:352-356` 断言 fresh 实例可读 winner 内容。按设计 §5.3 草图（per-instance mirror + external-first read），fresh 实例 external 读得 undefined、私有 mirror 为空 → 返回 null → **case 4 必红**。设计 R3 文本与 SA6 验收套件在这一点上互斥；SA3 在冻结设计 + 冻结测试 + 冻结 options 形状下无正确解。**这是设计层缺口，非 SA3 实现失误。**

**回流目标与修法（二选一，SA1 主责）**：

- (a) **SA6 侧修 case 4 门控**为「计数 → `await gate` → 透传真实写」（gate 释放后仍写 store），恢复设计 §5.3 草图原样实现（per-instance mirror，隔离语义完整）——最小改动，推荐；
- (b) SA1 显式设计 **store 作用域**共享机制（如按 store 身份键控的注入式共享 store + dispose 清理 + 隔离约束入册），SA3 按新设计重接线。

任一路径落地后 SA4 复审 R1。附带子项：`external ?? fallback` 的 fallback 于读发起时预捕获（设计草图语义为 hook 后求值）——该子偏差随 R1 一并按最终设计定稿。

### R2（MEDIUM，台账）版本 bump 击穿 §14 DENY LIST

- actual − allow − 白名单 = `{ packages/persistence/package.json }`（唯一越界文件），且该文件在 §14 DENY LIST 明文（`packages/persistence/{package.json,tsconfig.json}`）。
- 改动仅 `version 0.1.0 → 0.1.1`；出处为总控 dispatch row 10（21:53，「含 §12 ADR 修订节逐字落地与版本 bump」）——**晚于**设计 R3 冻结（21:49），设计 ALLOW LIST 未同步扩展。
- 历史核查：#61 contracts 落 0.1.0、#63 memory adapter 未 bump——仓库无「每票必 bump」惯例，本次纯属总控指令。
- 处置：**不要求回滚代码**（总控明令在先）；要求 **SA1** 修订 §14，将该文件从 DENY 移入 ALLOW 并注明总控指令依据，使护栏台账自洽。

---

## 二、审核结论

1. **设计一致性**：⚠️ 偏离——`lifecycle.ts` 状态机/算法与 §4/§6/§7 逐行对齐（supersede 采纳块、三分支 driver、ownerRoute/routeEvidence、防自环所有权复验、U8 派生式唯一结算——grep 确认 claim 结算仅 `op.then` 一处，无 deferred 字段）；owner 迁移 §9 全清单落实（`User` 接口名保留、`toKey` 不变）；§5.3 纪律 1「逐字搬移」经与 base 逐函数比对一致（scheduleFlush/onDebounce/onMaxDirty/startFlush/flush/scheduleRetry/maybeEvict/cancel*/clearTimers/track/assert* 控制流与 await 层数不变；唯一结构差异 = writeSnapshot 拆解为 seam，纪律 5 逐项落点全对：saveDoc live-cell 寻址 L220-221、maybeEvict 条件删 L542-543、releaseHandle L469-470、dispose 遍历 live-only L255-262、assertOwnedHandle 不依赖 cell L570-573、`status='ready'` 落 core flush isCurrent 后 L509）；§5.2 seam 承诺（aborted 后不执行提交段）落地 L66；§10 `DocDuplicateError` 逐字（ES2022 类字段 → 自有可枚举，tsconfig 亲核）；lifecycle.ts 不进公共导出（index.ts 无 re-export）。**偏离仅两处 = R1（store 作用域）+ R2（文件清单）。**
2. **读写路径一致性**：同一 `PersistenceIO` seam、同一 `toKey` 分区，单实例内读写同源；#58 按同 seam 自动获得全语义。❌ 分叉点 = R1 跨 store 镜像。
3. **静默失败**：✅ 无（duplicate/META/degraded/disposed/原始 IO 错误全部响亮上抛；`observeLateReadOutcome` 分支 A/B-胜出双覆盖，非空快照 console.error、READ_ERR console.warn）。❌ 例外 = R1 的 `external ?? fallback` 静默顶替（已复现为静默假数据）。
4. **降级方案**：create 失败不进 retry/degraded ✅；seedForTest 撞协调态 loud throw ✅；lost-update 走告警不进 degraded ✅。❌ R1 的 fallback 属「替另一个 store 兜底」型伪隔离 → REJECT。
5. **极端攻击**：双 supersede（`supersededBy` 被第二个 create 覆写）活性安全——driver 醒时读当前引用，claim.promise 恒 settle（U8）；resolveLoad/branch-B 无自环（所有权复验互斥完备）；`rawSettled` 标志两种时序配对无死锁；case 4 胜者任意性为 §15 明示豁免（仍恰一成功、`enteredWrites===1`）。R1 之外未发现新漏洞。
6. **错误处理**：✅ 消息锚定全保留（`'foreign or released DocHandle'`、degraded 消息原文、`/disposed/`、`/META\.docId.*doc1/` restore 侧原文）。
7. **架构评估**：✅ lifecycle core 本身可行，无需整体退回 SA1；仅 §5.3 IO wiring 一处需窄幅修订（随 R1 路由）。
8. **过度设计**：✅ 无。core 抽取为简报强制；进程级 map 是共享作用域过宽，非过度抽象。

## 三、专项门禁结果（skill 立法项）

| 门禁 | 结果 |
|---|---|
| §1.1 Scope Creep | creep = `packages/persistence/package.json`（→R2）；BLACKLIST 零命中（无 TASK.md / package-lock.json / yarn.lock / .bak / .DS_Store 入 diff） |
| §1.3 E2E spec 触发性 | 无 `.spec.ts` 改动，N/A |
| §1.4 vitest 触发性 | 两个 `.test.ts` 均落 CI `pnpm test`（根 vitest.config `include: packages/*/test/**/*.test.ts`）+ `persistence-contract.test.ts` 另有专步（`--passWithNoTests=false`）；**无 CI 黑洞** |
| §1.5 协议假设 | §15 存在，7 行依据全部亲核为真（tsconfig ES2022+strict+noUncheckedIndexedAccess+exactOptionalPropertyTypes；abort⟺epoch 同步块 lifecycle.ts:251-254；base getMap 模式；无「应该/通常」无据推断）✅ |
| §1.6 契约连锁 | 无既有导出行为契约改动（loadDoc/saveDoc/dispose/getStatus 语义逐行比对 base 不变）；外部消费 `git grep nomicore/persistence` 排除包自身 = 0（亲核）；§16 stub 补桩逐字落地 ✅ |
| §1.7 源码 grep 断言禁令 | 改动测试零命中 `readFileSync`+`toMatch/toContain`；新增模块契约测试为运行时行为断言（instance typeof）✅ |
| §12 ADR 逐字落地 | 程序化字节比对：design §12 围栏内草案（1994B）vs ADR-0006 落地节（1994B）= **exact match** ✅ |
| U1–U8 逐条对账 | 全部通过：U1（write→assertCurrentEpoch→注册→签发，L185-196）；U2（catch 回滚+`cur.claim===claim` 守卫 L198-208，无 timer，doc 不销毁）；U3（I6 复验：快路径同步签发 L138-139 / loadSlowPath 同块复验 L283-286 / create 收尾块 L188-196）；U4（create 路径零 timer 调用）；U5（duplicate 全走 `duplicateError()`）；U6（分支 A L363-366 + 分支 B-胜出 L371-374 双告警）；U7（sawEntry loud 守卫 L273-278）；U8（`claim.promise = op.then(→undefined,→undefined)` L213 为唯一结算，CreateClaim 无 deferred） |

**备案（非违规）**：SA6 与 SA3 工作合并于单一 commit `081a3b3` 落地，`testing.ts` 的归属无法从 git 历史切分；红灯日志（20:33）佐证 SA6 部分先于 SA3（21:53）存在，且 §14 已预告三者会出现于 base→HEAD diff。仅记录供后续追溯。

## 四、动态审核重点（交 SA7）

1. **R1 修复后回归**（最高优先）：复跑本报告第一节复现脚本——期望 `B.loadDoc(alice,'doc1') → null`、`B.createDoc(…) → 成功`；并补一条「两个 hooks 实例不同 store 互不可见」的稳定契约测试（归属 SA6）。
2. SA2 R3 建议动点：红线测试 1–4 / 设计 §4.4 5a–5d（假 null / 旧内容复活 / ghost handle / hung-read 早期采纳）、R2-1 活性钉（门控读 + create 写失败 + `withTimeout` 断言被取代 waiter 真实 settle）、U7 守卫触发、degraded→ready 与 dispose-during-flush 三绿灯保持。
3. `console.error`（lost-update anomaly / integrity violation）真实触发路径的 spy 断言。
4. 观测项（无契约）：`createDoc` 传入已 `destroy()` 的 Y.Doc 时的行为；进程级共享 map（若保留方案 b）的常驻内存增长。

## 五、结论

核心交付物（lifecycle core 状态机、owner 全链迁移、DocDuplicateError、U1–U8、§12 逐字落地、491 绿零回归）静态质量高，可保留。**但 R1 的进程级共享快照存储是被验收套件强迫出的未设计偏差，已复现为公共 API 上的跨 store 数据泄漏与假排他拒绝，且 dispose 清理语义相对 base 回归——须 SA1 窄幅修订 §5.3（推荐与 SA6 协调修 case 4 门控为透传写）后由 SA3 重接线，SA4 复审；R2 由 SA1 一行 ALLOW LIST 修订解除。** 驳回范围明确限于 memory.ts IO wiring 与文件清单台账，`lifecycle.ts` / `index.ts` / ADR 落地不在驳回范围内。

---

# R2 复审节（2026-08-21，commit `4e802b8`）

**R2 Verdict: pass（R1 / R2 驳回项全部解除）**

- 被审对象：commit `4e802b8`（`fix(persistence): SA4 R1 — restore instance-private snapshot mirror (IO-1/2/3)`，6 文件 +279/−52）+ 设计 R4 版（1046 行，含新设 §5.3.1）
- 复审范围：仅 R1/R2 驳回项及其直接波及（memory.ts / testing.ts / 设计 §14 与 §5.3.1）；R1 轮已核验通过项（§12 ADR 逐字、U1–U8、专项门禁 §1.3–§1.7、lifecycle core、owner 迁移）按约定不回炉
- 绿灯核验：总控亲验全量 `pnpm test` 491/491 + typecheck exit 0（引用）；SA4 局部独立复跑（独立进程 vitest，见下证据 3）：`memory-persistence.test.ts + persistence-contract.test.ts`（含 case 4 透传版）**41/41 绿 + Type Errors 0 + exit 0**

## ① R1（HIGH）复审：IO-1/2/3 逐项对账 + 泄漏复现回归 —— ✅ 解除

| 铁律 | 设计 §5.3.1 要求 | 实装对账（memory.ts @ 4e802b8） | 判定 |
|---|---|---|---|
| IO-1 实例私有镜像 | 禁止模块级可变状态；镜像 = 实例私有 Map，仅含本实例 io.write 提交内容 | 模块级 `sharedSnapshots` **已删除**；`private readonly snapshots = new Map<StoredSnapshot>()` 实例字段；write 闭包写 `this.snapshots`；grep 全文件无模块级 `const x = new Map/Set` / `let` 残留 | ✅ |
| IO-2 hook 唯一读权威 | `??` 在 Promise 对象层短路，与 base `restoreEntry` 逐字同构；禁 await 后回退 | `read: async (key, signal) => options.readSnapshot?.(key, signal) ?? this.snapshots.get(key)?.snapshot`——R1 版的「fallback 预捕获 + `external ?? fallback` await 后回退」**已删**；求值序与 base `await (hook?.() ?? mirror)` 逐字同构（hook 存在 ⇒ mirror 永不求值；hook resolve undefined = store 无此 key → null） | ✅ |
| IO-3 dispose 清理 | `await core.dispose(); snapshots.clear()`，恢复 base 语义 | `async dispose() { await this.core.dispose(); this.snapshots.clear() }`；顺序无竞态（core.dispose 先 `allSettled(inFlight)` 收束全部在飞 I/O，write 闭包 aborted 守卫已杜绝 dispose 后的镜像写入，clear 后无新写可达） | ✅ |

**泄漏复现回归（独立进程 vitest，2026-08-21 22:5x，临时文件跑后即删、worktree 零残留）**——R1 同款攻击 A@storeA create+dispose → B@全新空 storeB：

```
SA4-R2 loadDoc-over-empty-storeB:  null (isolated ✓)     ← R1 实测为 LEAKED who=A-content
SA4-R2 createDoc-over-empty-storeB: created              ← R1 实测为 rejected: DOC_DUPLICATE
SA4-R2 mirror-after-dispose:       null (cleared ✓)      ← IO-3 附加验证（dispose 后新无 hook 实例不复活镜像）
```

三重违约（跨 store 泄漏 / 假 DOC_DUPLICATE / dispose 清理丢失）全部消除；ADR-0006 工厂/实例隔离条款恢复。

## ② R2（MEDIUM 台账）复审：§14 ALLOW/DENY 修订 —— ✅ 解除

- **ALLOW LIST 追加**：`packages/persistence/package.json` 行已落——注明 version `0.1.0→0.1.1`、依据 = 总控 dispatch row 10 指令（**硬门禁 9**：改过代码的模块必须 bump）、时间线（指令 21:53 晚于设计 R3 冻结 21:49 故当时未同步）、SA4 明示不回滚。
- **DENY LIST 留痕移出**：原 `packages/persistence/{package.json,tsconfig.json}` 条目改为 `tsconfig.json` 保留 + 显式注记「`package.json` 原在此列，R4 因总控 dispatch row 10 的版本 bump 指令移入 ALLOW，DENY 解除依据 = SA4 R2 处置意见」——「只增不删」立法以「DENY 解除 + 注明依据」形式满足，历史不重写。
- **差集归零复核**：`4e802b8` 改动文件 = memory.ts（ALLOW）、testing.ts（ALLOW，§14 已补 R4 追加授权行）、wiki×4（白名单）；actual − allow − 白名单 = ∅。
- **「硬门禁 9」出处核实（R1 备案修正）**：本仓历史任务档案多处引用该编号（`task_vfsl-domains-assets-dogfood_design.md:253`「§8. D5 — 版本 bump 计划（硬门禁 9）」、其 sa4_review.md:39「版本 bump 检查（硬门禁 9）✅」）——系 MABF 流水线既有编号门禁，非虚构引用。R1 报告「仓库无每票必 bump 惯例」的表述据此修正为：git 历史上 #63 未 bump 属该票台账缺口（漏执行硬门禁 9），而非门禁不存在；本票 bump 有据，台账自洽成立。

## ③ SA6 用例 4 门控透传化对账 —— ✅ 通过

- **diff 精确对账**（testing.ts +3/−1，仅此一处）：`const originalWrite = store.write`（替换前捕获，与同文件用例 6 惯用法一致）→ `enteredWrites += 1` → `await gate` → `await originalWrite(key, snapshot, signal)` 透传真实写（含注释「gate 只门控时序，不吞 payload」）——与设计 §5.3.1 修订规格**逐字一致**；其余用例零改动（用例 5 的丢弃型 `store.write = async () => {}` 无 fresh 读断言，按设计明示保持）。
- **断言保真**：`enteredWrites === 1` / 恰一胜者 / loser 不销毁断言全部保留且仍有效（门控包装仍先计数，loser 在写路径前被拒）；fresh 断言代码未动——透传后 `createDocStore` Map 真实收到 winner payload，fresh 实例经 external read 验证的是 **U1 真实提交点**而非 adapter 镜像副产物（锚定保真度提升，恰是 #58 temp→rename 提交点语义所需）。
- **绿灯证据**：case 4 透传版随 41/41 局部复跑通过；总控全量 491/491 绿。

## R2 结论

1. R1（HIGH）：IO-1/2/3 逐项实装对账通过 + 泄漏复现回归三断言全绿（null / created / 镜像不复活）——**解除**。
2. R2（MEDIUM 台账）：ALLOW 追加 + DENY 留痕移出 + 差集归零 + 硬门禁 9 出处核实——**解除**。
3. 用例 4 透传化：逐字符合 §5.3.1 规格，断言保真且锚定增强——通过。
4. 修复范围纪律：`lifecycle.ts` / `index.ts` / ADR 零改动（与驳回范围一致），无新增越界文件，BLACKLIST 零命中。

**动态审核重点（交 SA7，取代 R1 第四节清单）**：按设计 R4 §5.3.1「SA7 复跑清单」执行——①本节泄漏复现脚本回归（期望 null / created）；②用例 4 透传门控版全绿；③IO-3 镜像不复活；④全量 491 零回归（含 :307-309/:471/:492 三 status 锚定）+ SA2 R3 动点（R2-1 活性钉、5a–5d、U7、lost-update/integrity console spy）。建议项（SA6 自行决定）：「两个 hooks 实例指向不同 store 互不可见」升格为套件锚定用例，把 IO-1/IO-2 从实现约束固化为契约。

---

# 1.4 vitest 触发性自检（R3 补录，2026-08-21，硬门禁 14 收尾窄幅）

**背景**：R1 报告第三节「§1.4 vitest 触发性」的结论覆盖当时 diff 中的两个 `.test.ts`（`memory-persistence.test.ts` / `persistence-contract.test.ts`）。此后 SA7 新增 `packages/persistence/test/sa7-supplementary.test.ts`（staged，将随代码入库）——本节对**当前工作树全部 vitest 测试文件**重跑触发性核验。

**结论：all-vitest-packages-triggered**（全部测试文件命中 CI 触发面，无黑洞）。

**证据链**（2026-08-21 静态核验 + 独立进程实跑，均可复核）：

1. **根配置接线**：`package.json` `test` script = `vitest run --typecheck` → 根 `vitest.config.ts` `include: ['packages/*/test/**/*.test.ts', 'domains/*/test/**/*.test.ts']`；CI `.github/workflows/ci.yml` `Test` 步跑 `pnpm test`（matrix node 20/24）。
2. **全树覆盖复核**：`find packages domains -name '*.test.ts'`（排除 node_modules）共 **28 个文件**，反例检索（不落在 `packages/*/test/**` 或 `domains/*/test/**` 的 `.test.ts`）= **∅**——全部被根 glob 收编，含新增 `packages/persistence/test/sa7-supplementary.test.ts`（`packages/persistence/test/` 直命中 `packages/*/test/**/*.test.ts`）。
3. **新增文件重点核验**：① 形状 = 标准 vitest 套件（`describe/it/vi`，8 个 `it` 用例，与 SA7 交付记录一致）；② imports 仅 `vitest` / `yjs` / 包内 `../src/index.js` 与 `../src/testing.js`——**无端口 / 进程 / 网络依赖**，不触发 test-lock 需求；③ 触发性双证据：静态 glob 命中 + 独立进程实跑 `vitest run packages/persistence/test/sa7-supplementary.test.ts` → **1 file / 8 tests passed + Type Errors 0 + exit 0**（文件能被 runner 发现并执行，非孤儿 spec）。
4. **专步补强（既有，未改）**：CI 另有 `Persistence contracts` 专步（`persistence-contract.test.ts --typecheck --passWithNoTests=false`）与 `Domain scaffolds check` 专步——persistence 包测试文件同时享有 `pnpm test` 主路径与专步双触发。

**备案**：`sa7-supplementary.test.ts` 将 SA4 R2 建议项（「不同 store 互不可见」升格为契约用例，IO-1/IO-2/IO-3 + SA2 红线 1–4 / 5a–5d / R2-1 活性钉 / console spy）落地为 8 条套件锚定——其内容由 SA7 报告（`task_persistence-create-doc_sa7_report.md`）对账，不在本窄幅补录范围内重审；本节仅核验触发面。

**R3 补录 verdict：维持 pass。**
