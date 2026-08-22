# SA7 动态验证报告 — persistence createDoc（issue #64）

**Date**: 2026-08-21（Phase 3，单轮）
**被验对象**: commit `4e802b8`（SA3 R2，分支 `fix/issue-64-on-adr-server-design`，worktree `/home/wangjian/nomicore-fix-issue-64`）
**上游门禁**: SA4 静态验尸 R2 **verdict = pass**（2026-08-21，见 `task_persistence-create-doc_sa4_review.md` R2 复审节）
**验证基准**: 设计 R4 §5.3.1「SA7 复跑清单」（四点）+ SA4 R2 动态审核重点 + SA2 R3 节末建议动点（红线 1–4 / §4.4 5a–5d、R2-1 活性钉、U7 守卫、console spy、三 status 绿灯）

## Verdict: ✅ **pass**

四点复跑清单全部通过；SA2 R3 动点清单中除「U7 守卫触发」一条经论证在单进程内确定性地不可达（与 SA2 R2 评审自身结论一致，见 §3.3）外，其余全部以活链路证据验证通过。全量 `pnpm test` **499/499 绿**（491 基线 + SA7 新增 8 条补充测试）+ `pnpm typecheck` exit 0，零回归。SA7 在 SA4 pass 基础上未发现新 fail。

**产物**：
- 本报告：`wiki/raw/task_persistence-create-doc_sa7_report.md`
- 补充测试（新增文件，CI 将随 `pnpm test` 运行）：`packages/persistence/test/sa7-supplementary.test.ts`（8 用例）
- 一次性复现/观测脚本：跑后即删，worktree 零残留（`git status` 仅 wiki 文档 + 上述新增测试文件）

---

## Step 0 — SA4 verdict 校对

- `task_persistence-create-doc_sa4_review.md` 顶部：`Verdict: R1 = reject → R2 复审 = pass（R1/R2 均解除，commit 4e802b8）`
- **SA4 verdict: pass → 进 Step 1**（SA7 不下调、不上发伪造）

## Step 1 — SA6 红灯套件复跑（第二关）

```
命令: node_modules/.bin/vitest run packages/persistence/test/memory-persistence.test.ts \
        packages/persistence/test/persistence-contract.test.ts   # 独立进程（setsid nohup）
结果: Test Files 2 passed (2) / Tests 39 passed (39) / Type Errors no errors / exit 0
```

**SA6 红灯: 🟢 GREEN（39/39）→ 进入 Step 2。** 端口：本票测试无任何端口依赖，未执行 `fuser -k`（无未知进程清场必要）。

---

## Step 2 — 清单驱动验证（设计 R4 §5.3.1「SA7 复跑清单」四点 + SA2 R3 动点）

### 2.1 ① SA4 R1 泄漏复现脚本回归 —— ✅ PASS

一次性独立进程复现（R1 同款攻击：A@hooks→storeA `createDoc`+release+`dispose()` → B@hooks→**全新空 storeB**；跑后即删）：

```
SA7-RERUN loadDoc-over-empty-storeB:  null (isolated OK)      ← R1 实测: LEAKED who=A-content
SA7-RERUN createDoc-over-empty-storeB: created                ← R1 实测: rejected: DOC_DUPLICATE
SA7-RERUN mirror-after-dispose:       null (cleared OK)       ← IO-3 附加（R1: 镜像可复活）
Test Files 1 passed (1) / exit 0
```

三重违约（跨 store 泄漏 / 假 DOC_DUPLICATE / dispose 清理丢失）在动态链路上全部消除。该攻击已按 SA4 R2 建议升格为**持久化契约用例**（`sa7-supplementary.test.ts` 用例 1「keeps two hooked instances over different stores mutually invisible, even after dispose」），把 IO-1/IO-2 从实现约束固化为套件锚定——覆盖「A 存活期间」与「A dispose 之后」两个时点。

### 2.2 ② 用例 4（透传门控版）—— ✅ PASS

```
命令: node_modules/.bin/vitest run packages/persistence/test/memory-persistence.test.ts \
        -t "exactly one concurrent create"
结果: Tests 1 passed | 31 skipped (32) / Type Errors no errors / exit 0
```

`enteredWrites === 1`、恰一胜者、loser 不销毁断言随全量 39/39 绿通过；fresh 实例经**真实 store** 读得 winner 内容（透传后 U1 锚定保真）。

### 2.3 ③ IO-3 dispose 清理（镜像不复活）—— ✅ PASS

持久用例 2「clears the instance mirror on dispose so a later no-hook instance cannot resurrect it」：
- 无 hooks 实例 A `createDoc` → 同实例 load 可见（live cell）✓
- **第二个存活**无 hooks 实例 B：`loadDoc → null`（实例私有镜像不跨存活实例共享）✓
- A `dispose()` 后**新建**无 hooks 实例 C：`loadDoc → null`（镜像已清，不复活）✓；C 再 `createDoc` 同 key → 成功（无假 duplicate）✓；`timer.pending() === 0` ✓

静态复核（IO-1）：`memory.ts` 全文件无模块级 `const/let/var` 可变容器、`sharedSnapshots` 零命中——方案 (b) 的常驻内存增长观测项随之 **N/A**（进程级共享 map 已不存在）。

### 2.4 ④ 全量零回归 + SA2 R3 动点 —— ✅ PASS（U7 触发见 §3.3）

```
命令: node_modules/.bin/vitest run --typecheck   # 全量 = pnpm test
结果: Test Files 33 passed (33) / Tests 499 passed (499) / Type Errors no errors / exit 0
      （491 基线 + SA7 补充 8 = 499；基线部分零回归）
命令: pnpm typecheck   → exit 0（vfsl / vfsl-protocol / vfsl-codegen / persistence 四包）
```

三条 status 锚定全部保持绿（随 `memory-persistence.test.ts` 32 条通过）：
- `:307-309` degraded→ready 恢复后 `saveDoc` 可写 ✓
- `:471` dispose 竞态中 never-settling writer 收束后 `status === 'disposed'` ✓
- `:492` dispose-during-flush 后 `status === 'disposed'` + `saveDoc` 拒绝 `/disposed/` ✓

#### SA2 R1 红线 1–4 / 设计 §4.4 5a–5d（补充套件用例 3–6，全部一次通过）

| 用例 | 攻击构造（确定性微任务序） | 实测结果 |
|---|---|---|
| **5a 假 null**（adoption 路径） | 门控读 → create 胜出 → release create handle → `releaseRead(undefined)` | `loading` → **非 null**，内容 = `'committed-new'`，`isDestroyed === false`，`timer.pending() === 0` |
| **5a/5c 驱逐竞态**（claim-join 路径） | 门控 create 写 → load 并入 claim → 放行写 → **claim-waiter 续体运行前**同步 release create handle（clean entry evict、doc destroy） | `loading` → 非 null 且 `loaded.doc !== created.doc`（从已提交快照 restore 的**新 Y.Doc**）、内容 = 提交内容、`isDestroyed === false`；`saveDoc` 可用且 499ms 不写 / 500ms 写 1 次（debounce 语义保持）——**无假 null、无 ghost handle** |
| **5b 静默复活 + console.error spy** | OLD 已提交 → 门控读（将返 OLD）→ create 提交 NEW 胜出 → release → `releaseRead(OLD bytes)` | `loaded` 内容 = **NEW**（OLD 不复活）；spy 捕获 `'[persistence] lost-update anomaly: createDoc superseded a pending load whose store read returned a pre-existing snapshot'` ✓ |
| **5d hung-read 早期采纳** | 门控读**永不放行** + create 胜出（handle 保持持有） | `withTimeout(loading, 2000)` 正常返回 entry，`loaded.doc === created.doc`（读悬挂不阻塞 waiter）；随后放行门控、dispose 干净收束 |

> 交错可达性说明（实测+微任务序推演双确认）：被取代读的 waiter 其续体在 create 提交块内 `settleOnce` 时入队，**恒先于**测试续体运行——因此 supersede 路径下 waiter 总是采纳存活 entry；「采纳后、签发复验前被驱逐」的攻击面只能经 **claim-join 路径**确定性构造（load 于 `creating` 态并入 `claim.promise`，其续体晚于 create promise settle，测试恰在该窗口释放 handle 触发 evict）。补充套件按此双路径分别锚定。

#### R2-1 活性钉（U8）—— ✅ PASS（用例 7）

门控读挂起被取代 load → `store.write = throw` → `createDoc` 拒绝（`/create write exploded/`）→ 放行门控（undefined）：

- `withTimeout(loading, 2000, 'superseded load must settle after create failure')` 以**真实结局** settle：`loaded === null`（非超时守卫、非挂起）——`claim.promise = op.then(→undefined, →undefined)` 派生式在失败路径同样结算（U8 活性成立）
- 无 stale claim：恢复真实写后同 key `createDoc` → 成功且内容正确
- `timer.pending() === 0`，dispose 干净

#### console spy（SA4 动点 3）—— ✅ PASS

- lost-update `console.error`：见 5b（真实触发路径捕获）✓
- superseded READ_ERR `console.warn`（用例 8）：门控读以 reject 收束于 create 胜出之后 → spy 捕获 `'[persistence] superseded store read failed after createDoc won the key; ignoring stale read error'`，且 `loading` 不受扰动（`loaded.doc === created.doc`）✓
- integrity `console.error`：见 §3.3（守卫在位，触发路径单进程内不可达）

---

## 3. 观测项与限制（无契约影响）

### 3.1 createDoc 传入已 `destroy()` 的 Y.Doc（SA4 动点 4）

一次性观测（跑后即删）：**`createDoc` 接受已销毁的 doc 并成功签发 lease**（`handle.doc === 传入 doc`、`isDestroyed === true`；yjs destroy 不抹除 state，`validateCreateDoc` 仍可读 META、快照仍可编码 44 bytes）；同 key 后续 create 正确拒绝 `DOC_DUPLICATE`；dispose 干净。简报/设计未定义此输入的契约——记录为**后续上游契约决策点**（Persistence 是否应拒绝 pre-destroyed doc），本票不判 fail。

### 3.2 公共入口的运行时 vitest 依赖（既有，非本票引入）

`src/index.ts` 运行时 re-export `./testing.js`（后者 `import 'vitest'`），故在 **vitest 之外**直接 import `@nomicore/persistence` 会因 vitest 内部状态缺失而崩。经 `git show 37561ac`（base）比对：该 re-export 在 base 即存在（`index.ts:121-122`），非本票改动引入。仅备案。

### 3.3 U7 守卫「触发」的可达性限制（唯一未以活链路触发的动点）

- **守卫在位**（静态亲核，`lifecycle.ts:269-280`）：`loadSlowPath` 的 `sawEntry` 跨轮检测 + `console.error('[persistence] integrity violation: …')` + `throw Error('persistence integrity: fresh store read found none after a resolved entry was evicted')`。
- **不可确定性触发**（动态论证）：U7 要求 round1 已向 waiter 返回 entry 且 round2 重读得 null。微任务序上，`resolveLoad` settle 与 `loadSlowPath` 签发复验之间不存在可插入测试续体的窗口（waiter 续体在 settle 时入队、复验在同一同步块；eviction 只能来自测试续体的 `release()` 或 flush finally，二者均排在 waiter 续体之后或不相交）；claim-join 驱逐路径下 round1 直接以重读结局返回（`sawEntry` 恒 false，此时 null 是合法 not-found）。**这与 SA2 R2 评审自身的结论一致**（「U7 把**单进程内不可达**的丢内容变为 integrity 错误——首层防护机制性消除，残余层防护响亮」）。
- **首层防护已动态验证**：§2.4 驱逐竞态用例证明 evict 后重读确实取回已提交内容（不会丢）；「U7 若被绕过则响亮」由静态在位 + §5b/§console.warn 两条告警链路真实验证旁证。结论：非缺陷，属设计明示的纵深防御层。

---

## 4. Spec / vitest 触发证据（Step 3/4 立法项）

- **E2E spec**：本票无任何 `.spec.ts` 改动（SA4 §1.3 已核 N/A）→ Step 3 **N/A**。
- **vitest package 触发**：
  - SA6 两测试文件：SA4 §1.4 静态门禁已核（根 `vitest.config.ts` `include: packages/*/test/**/*.test.ts` + `persistence-contract.test.ts` 专步）。
  - **SA7 新增 `sa7-supplementary.test.ts`**：落 `packages/persistence/test/`，命中同一 include glob——本报告全量运行（499/499）即其在本仓 `pnpm test` 下的触发证据（` ✓ packages/persistence/test/sa7-supplementary.test.ts (8 tests)`）。
  - **CI runner log**：分支尚未 push（push/PR 属总控职责，SA7 边界明示不执行）→ CI run URL 暂缺；总控 push 后 `pnpm test` job 应出现上述 33 个 test file（含 SA7 新文件）。**本地动态门禁 + SA4 静态门禁（§1.4）双层已绿，CI 待总控补录。**

## 5. 复现命令总表（全部独立进程，worktree 零一次性残留）

```bash
cd /home/wangjian/nomicore-fix-issue-64
node_modules/.bin/vitest run packages/persistence/test/memory-persistence.test.ts \
  packages/persistence/test/persistence-contract.test.ts        # Step 1: 39/39, exit 0
node_modules/.bin/vitest run packages/persistence/test/memory-persistence.test.ts \
  -t "exactly one concurrent create"                            # 复跑点②: 1 passed, exit 0
node_modules/.bin/vitest run packages/persistence/test/sa7-supplementary.test.ts  # 补充套件: 8/8, exit 0
node_modules/.bin/vitest run --typecheck                        # 复跑点④: 33 files / 499 tests, exit 0
pnpm typecheck                                                  # exit 0
```

## 6. 结论

1. §5.3.1 四点复跑清单：**①②③④ 全部 PASS**（④含三 status 锚定 + SA2 R3 动点）。
2. SA4 R2 驳回项（R1 泄漏三重违约 / R2 台账）在**活链路**上确认修复且已被持久化契约用例锚定。
3. SA2 三轮评审沉淀的全部可动态构造攻击面（假 null 双路径 / 旧内容复活 / ghost handle / hung read / R2-1 活性 / lost-update 与 READ_ERR 告警）实测通过；U7 为设计明示的单进程不可达纵深防御层，守卫在位（静态）+ 首层防护（重读保真）已动态验证。
4. 新增补充测试 8 条（新文件），全量 491→499 全绿、typecheck exit 0，**零回归、零生产代码改动**。

**SA7 verdict: pass** — 建议总控进入合并/PR 流程（push 后补录 CI run 证据）。
