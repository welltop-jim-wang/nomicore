# SA4 静态验尸报告

**Date**: 2026-08-21
**Verdict**: reject（R1 高危已复现 + R2 文件清单台账违约；核心状态机与 owner 迁移本身质量过硬，全部通过项见下）

- 被审对象：commit `081a3b3`（SA3 R1，分支 `fix/issue-64-on-adr-server-design`，base `origin/adr/server-design` = `37561ac`）
- 审查基准：设计 R3 pass 版（950 行）+ SA2 三轮评审 + SA8 两份冲突报告 + `_relevant_decisions.md` + SA6 红灯套件源码逐行 + base 版 `memory.ts` 逐函数对照
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
