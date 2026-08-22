# SA4 静态验尸报告（R2 — PR #66 owner review 修订轮）

**Date**: 2026-08-21
**Reviewer**: SA4（Red Team Hacker，静态绿光验尸）
**被审对象**: HEAD commit `6c895fb`（`fix(persistence): PR #66 owner review R3 — contract leaf, entry-scoped degraded, loud tmp sweep, ownership docs, drop .mabf-bg`），基线 e8e4fb8
**评审输入**: `task_file-persistence-plugin_revision.md`（owner 反馈 5 项 + 复审门禁 7 条）、`task_file-persistence-plugin_design.md`（SA1 R3 定稿：决策 G/H/E4/I + §9 ALLOW/DENY）、`task_file-persistence-plugin_sa2_review_r3.md`（verdict: pass，4 项 LOW 建议）
**前置绿灯**: 总控亲跑 `pnpm typecheck` EXIT=0、`pnpm test` 35 files / 499 passed / EXIT=0
**Verdict**: **pass**（附 2 项 LOW 非阻断边界披露 + 3 项动态审核重点；无 reject 项）

---

## 一、Owner 复审门禁 7 条逐条裁决

| # | 门禁 | 裁决 | 静态证据 |
|---|------|------|------|
| G1 | PR diff 不含任何 `.mabf-bg/**` / `TASK.md` | ✅ | `git ls-tree -r HEAD --name-only \| grep -E '^\.mabf-bg/\|TASK\.md'` **空输出**（grep exit=1）；5 个 `.mabf-bg/*.log` 在 6c895fb 中实际删除（diff stat：baseline-test/baseline/final-verify/red-confirm/sa3-verify 共 -543 行，全是删除） |
| G2 | 无 `index → adapter → lifecycle → index` 循环 | ✅ | src 五模块 import 图实测：`contract.ts` 仅 2 个 `import type`（cordis Context / yjs），**运行时零 import 的依赖叶子**；`lifecycle.ts:12-21` 值导入 `./contract.js`；`memory.ts:2-8` → lifecycle + contract(type)；`file.ts:12-13` → lifecycle + contract(type)；`testing.ts:2` → contract(type)；`index.ts` 纯聚合。`grep -rn "index.js'" packages/persistence/src/` **零命中**——无任何反向 barrel 边，图为 DAG |
| G3 | adapter 模块可直接导入，不依赖导入顺序 | ✅ | 值边仅 contract←lifecycle←{memory,file}←index 单向；SA7 动态测试头部 workaround 已删（新版 import 全部 `'../src/file.js'` / `'../src/contract.js'` 深路径，:20-22 注释明示 "No index.ts barrel import and no entry-order discipline are needed"）；`test/module-graph-regression.test.ts` test 1 以「零 index 依赖的纯深导入 + `new FilePersistence(...)` 真实构造」固化运行时锚点 |
| G4 | degraded/recovery 按 namespace/entry 隔离 | ✅ | `CoreEntry.degraded`（lifecycle.ts:55）；flush 失败仅置本 entry（:286）、成功仅清本 entry（:283）；`saveDoc` 门禁 `assertEntryWritable(entry)` 只查本 handle 所属 entry（:138）；工厂「命中已存在且 degraded 才拒、新建恒允许」（:183-189）；错误消息逐字 `'persistence-degraded: writes are rejected until retry succeeds'`（:354）。**`degraded ⇒ dirty` 不变式独立推演成立**：flush 入口守卫（:273，clean 即 return）⇒ 进入 flush 必 saved<dirty；失败路径不推进 savedGeneration ⇒ degraded entry 恒 dirty ⇒ `maybeEvict`（:314）clean 前置永不满足 ⇒ **永不蒸发** |
| G5 | 无关 doc 成功不能提前恢复失败 doc | ✅ | 全代码面清 degraded 的唯一位置 = 该 entry 自身 flush 成功路径（:283）；`status` 存储字段已删除（grep `this.status` / `status:` 在 src **零残留**；`assertWritable` 仅存在于注释引用），`getStatus()` 聚合现算（:105-111，disposed > 任一 entry degraded > ready）纯观察视图不参与门禁——「任一成功即全局翻回 ready」在机制上不可再现。SA7 test 2 coverage 3 显式钉死（alice flush 落盘后聚合仍 degraded + bob 仍拒） |
| G6 | `.tmp` 非 ENOENT 删除失败按最终 ADR 语义处理并测试 | ✅ | `sweepLeftoverTmp` 的 `.catch(() => undefined)` 已删（diff 确认），现为裸 `await fsp.rm(tmpPath, { force: true })`（file.ts:117）；错误链路无包装：rm 错误 → readCommittedSnapshot :84（try 只包 readFile，清扫在 try 外）→ restoreEntry → loadDoc rejects，**errno 对象原样透传**；`force:true` 下 ENOENT 不产生错误（Node 契约，设计 §7 P4 实测）⇒ 浮出错误集 ≡ 非 ENOENT 错误集，无第三态。SA7 test 1 结构化锚点 `rejects.toMatchObject({ code: 'EACCES' })` 钉死 errno 保留 + tmp 原地 + chmod 治愈后恢复且 tmp 被清 |
| G7 | 全量 test / typecheck / Node 20/24 CI | ✅（静态面） | 总控亲跑 EXIT=0（499 passed）；CI `.github/workflows/ci.yml` matrix `node: [20, 24]` 跑 `pnpm typecheck`（含 `tsc -p packages/persistence/tsconfig.json`，其 include `src/**/*.ts` 覆盖新 contract.ts）+ `pnpm test`（根 vitest，include `packages/*/test/**/*.test.ts` 覆盖全部 5 个 persistence 测试文件）。**CI 实跑证据归 SA7/runner 动态复核** |

## 二、决策逐项深度验尸

### 2.1 决策 G：contract.ts 逐字搬迁 + 公共面逐字等价（owner #2）

- **逐字搬迁核对（diff 实证）**：pre-R3 `index.ts` 行 1-116（P1 契约面全体）与 `contract.ts` 行 10-125 **逐字节 diff 为空**（`diff` 输出 VERBATIM-IDENTICAL）——11 个导出名（User / DocHandle / DocPersistence / DOC_PERSISTENCE_SERVICE / DEFAULT_PERSISTENCE_SCHEDULE / PersistenceSchedule / PersistenceTimer / systemPersistenceTimer / resolvePersistenceSchedule / provideDocPersistence / requireDocPersistence）+ Cordis `declare module` Context 增强 + 全部 JSDoc 逐字保全，仅新增文件头注释 9 行（非契约面）。
- **index.ts 纯聚合**：38 行 = 头注释 7 行 + 5 个 `export … from` 语句块，**零定义、零包内 import 之外的语句**；尾部三块（testing 3 名 / memory 5 名 / file 4 名）与 pre-R3 行 118-135 **逐字 diff 为空**。公共导出面 23 名与 R3 前完全一致，仅来源变为 contract.ts 定义 + index.ts re-export。
- **lifecycle/memory/file/testing 四处 import 切换**：每处恰 1 行（`./index.js` → `./contract.js`）+ 尾注释标记 `// R3 (owner #2)`；memory.ts / testing.ts 全文件 diff **各恰 1 行**，无任何夹带。
- **静态守卫有效性攻击（探针实测）**：对 `hasReverseBarrelImport` 正则以 11 组边界样例 node 探针验证——标准单空格单/双引号静态 import、**type-only 反向 import**、动态 `import('./index.js')`（含括号内空格）全部正确命中；注释/字符串/模板字面量提及 `./index.js` 零误伤；守卫自测 test 3（正/负样例 16 例）锁定判定边界。**边界披露见 §四-1**。

### 2.2 决策 H：degraded entry 化（owner #3）

lifecycle.ts diff 与设计 §4.1「四处定点改动 + 两处随动」**逐行对应、零夹带**（全 diff 复核）：

1. import 源切 contract（✓）；2. `CoreEntry.degraded: boolean` + 不变式注释（:51-55 ✓）；3. `protected status` 字段删除 + `getStatus()` 聚合现算（:105-111 ✓）；4. `assertWritable()` 删除 → `assertEntryWritable(entry)`，saveDoc/工厂门禁 entry 化且检查次序移至 ownership 之后（saveDoc :132-141：disposed → identity → ownership → degraded；✓ 与 §8 契约审计一致）；5. flush 成功/失败两处 `entry.degraded`（:283/:286 ✓）；6. `createEntry` 追加 `degraded: false`（:239 ✓）；7. dispose 删 `status='disposed'` 赋值（:164-165 ✓）。

- **memory `:285` 翻转块**：diff 恰 6 行（1 删 6 增）全部在单一 it 块内——`createMemoryHandleForTest(user,'other')` rejects→resolves + `saveDoc(other)` resolves 断言 + `other.release()` 随动释放，与 §5a 规格逐字对应。时序独立推演：`failures=1` 已耗尽 → `advanceBy(500)` 同时结算 doc1 retry（成功→degraded 清除）与 other flush（成功→clean→release 后驱逐）→ `:293` 聚合 ready、`:294` saveDoc resolves，块内其余断言（:277/:284/:288）entry 语义下原绿。
- **意外收获（不变式的有效牙齿）**：第二个 degraded 用例（:297-332）在 entry 语义下成为 `degraded ⇒ dirty ⇒ 永不蒸发` 的真实守卫——release 后若实现误驱逐 dirty/degraded entry，`:324` loadDoc 将 cache miss 重建 fresh entry，`:327` `saveDoc rejects /persistence-degraded/` 即翻红。该用例不是永真断言。
- **攻击确认（非缺陷记录）**：degraded 期间（含 retry flush 在途窗口）被拒的 saveDoc 不递增 dirtyGeneration，而 Y.Doc 修改本身已发生——此窗口 pre-R3 全局语义下同样存在，根因是「saveDoc throw = 脏通知被拒、调用方负责重试」的既有契约（ADR「saveDoc 是脏通知不是落盘承诺」），**非 R3 回归**；列入动态观察项供 SA7 知悉（§五-3）。

### 2.3 决策 E4：tmp 清扫响亮化（owner #4）

- `.catch(() => undefined)` 删除（diff 实证）；`rm` 错误从 `sweepLeftoverTmp`（file.ts:112-118，函数体无 try/catch）→ `readCommittedSnapshot` :84（清扫调用在 readFile 的 try/catch **之外**）→ `restoreEntry`（无 catch）→ loading pending promise reject（lifecycle :124 双分支清理，无半还原状态）→ `loadDoc` rejects。errno 结构化透传（无 `new Error(...)` 包装、无 `{ cause }` 重抛）。
- ENOENT 语义由 `force:true` 等价实现（缺失路径直接 resolve，不产生错误）——与「仅 ENOENT 静默」严格等价，无第三态。注释（:113-116）与实现一致。
- ADR 零改动确认：`git diff e8e4fb8 HEAD --stat -- docs/` 空输出（ADR 未触碰）。

### 2.4 决策 I：三处所有权 JSDoc（owner #5）

file.ts diff 中三处全部落字，与设计 §4.3.1-4.3.3 文案逐点对应：
1. `FilePersistenceOptions.rootDir` JSDoc（:16-26）：single-writer ownership（AT MOST ONE active instance）+ 固定 tmp 名竞态机理 + caller error not handled in v1 + HMR "dispose() drains all in-flight flushes"（有 §4.7 `allSettled(inFlight)` 支撑）；
2. `FilePersistence` 类 JSDoc（:48-54）：Ownership 段 + 交叉引用；
3. `createFilePersistencePlugin` JSDoc（:133-136）：一行交叉引用。
另含 `FilePersistenceStatus` 聚合语义注释（:32-36，决策 H 随动，属授权文档范围）。

## 三、测试质量审查

| 项 | 裁决 | 证据 |
|---|------|------|
| SA7 test 1（非 ENOENT 响亮） | ✅ 有牙齿 | 真实 I/O（chmod 0o555 r-x 分区）；`rejects.toMatchObject({ code: 'EACCES' })` **结构化 errno 断言**（非仅 message 匹配）；tmp 原地保留断言；chmod 治愈后 load 成功 + 快照内容还原（`ROOT.v === 'committed'`）+ tmp 被清——三段闭环，非永真 |
| SA7 test 2（owner 4 覆盖点） | ✅ 逐点钉死 | C1：bob saveDoc rejects + 命中同 entry 的工厂 rejects（双门禁锚点）；C2：alice loadDoc cache-hit（`doc` 同一实例）+ saveDoc resolves + **CAROL 全新 doc 工厂成功**（旧「新建被拒」断言的反向翻转锚点）；C3：alice flush 落盘（`fine.snapshot` exists）后聚合仍 `persistence-degraded` + bob 仍拒 + `doomed.snapshot` 不存在（bob 从未提交）；C4：chmod 0o755 治愈 + bob **自身** retry 落盘 + 聚合 `ready` + bob saveDoc 恢复。`waitFor` 有界轮询（400×5ms=2s 上限 + 最终 expect 兜底）非永真；dispose 后 `timer.pending === 0` 收尾 |
| SA7 test 3（键控清扫） | ✅ 保留 | d1 load 清 d1 tmp、d2 tmp 原地（no tree walk）——行为断言 |
| module-graph test 1（运行时锚点） | ✅ 有牙齿 | 零 index 依赖深导入三模块 + `typeof === 'function'` + `new FilePersistence(mkdtemp)` 真实构造 + getStatus/dispose；环回潮将在模块求值期 TDZ crash |
| module-graph test 2/3（静态守卫 + 自测） | ✅ 合规（豁免条款） | 源码 grep 断言属**模块图结构契约的本质形态**（图结构只能静态验证），且 test 1 运行时行为断言覆盖同一契约的行为面；test 3 以 16 组正/负样例锁定守卫判定边界（含注释不误伤、动态导入不漏检、type-only 反向 import 命中）——非 PR #540 式伪测试 |
| 屏蔽/跳过扫描 | ✅ 干净 | `grep -rnE "\.(skip\|only\|todo)\(\|xit\(\|xdescribe\(" packages/persistence/test/` 零命中 |
| SA6 零改动 | ✅ | `file-persistence.test.ts` / `persistence-contract.test.ts` / `memory-testkit.ts` 在 e8e4fb8..HEAD diff **为空** |

## 四、边界披露（LOW，非阻断）

1. **静态守卫正则的 3 个非格式化漏检形态**（探针实测）：① `from` 与引号间**多空格**（`from   './index.js'`）——lookbehind `from\s` 只容忍恰好 1 个空白，多空格时 specifier 字符串被注释剥离器误剥，静态正则随之不命中；② 同行分号双 import（`import … './x.js'; import … './index.js'`）——第二个 import 不满足行首锚；③ `from` 后换行+缩进 specifier。三者均为 **prettier 非格式化写法**，标准格式（单空格、换行分隔）全覆盖；且形成真实值环的回潮仍被 test 1 运行时锚点兜底——仅「type-only 反向 import + 非常规空格」这一交集双漏。守卫威胁模型是防意外回潮而非防恶意规避，可接受；建议 follow-up 把 lookbehind 放宽为 `(?<!from\s+|\(\s*)` 即消除①③。
2. **守卫目录遍历非递归**：test 2 的 `readdirSync(srcDir)` 只扫 src 平铺层；未来若 src 出现子目录，其内文件不在守卫范围（当前 src 恰 6 个平铺文件，无现实影响）。
3. INFO：设计 §5b 预期「合计 34 个测试文件」与总控实测 35 不符——全仓 30 个 `.test.ts` + 5 个 `.test-d.ts` = 35（vitest --typecheck 计入后者）；§5b 只按 `.test.ts` 语境计数，属文档精度偏差（同 SA2 R3 攻击点 #1 类），非实现问题。

## 五、动态审核重点（交 SA7）

1. **CI Node 20/24 实跑证据**：`ci.yml` matrix 两档均须绿（owner 门禁 7 的运行时半边）；module-graph 守卫的 variable-length lookbehind 在 Node 20/24 V8 均支持（≥8.10），理论无风险但需 CI 日志确认。
2. **SA7 test 2 的 `ManualTimer.fireOldest()` 插入序稳定性**：fire 顺序假设「插入序 = 期望触发序」（bob maxDirty → alice maxDirty → bob retry）；若实现侧 timer 分配次序变化，`waitFor` 状态断言会真实失败（非永真）——跨平台慢 I/O 下关注 flake。
3. **degraded 窗口内被拒 saveDoc 的调用方契约**（知悉项，非缺陷）：degraded 期间（含 retry flush 在途）saveDoc throw 不登记 dirty，而 Y.Doc 修改已发生；恢复后需调用方再次 saveDoc 才落盘。pre-R3 行为相同（ADR 脏通知契约固有），建议 SA7 在动态验证时确认测试无对此窗口的意外依赖。
4. **chmod EACCES 语义在 CI runner（非 root 用户）下的有效性**：test 1/test 2 依赖 r-x 目录的 rm/writeFile 以 EACCES 拒绝——Linux 自托管 runner 标准行为，CI 日志确认即可。

## 六、审核结论（skill 模板）

1. **设计一致性**：✅ 一致——决策 G/H/E4/I 逐条落地，lifecycle diff 与 §4.1 定点改动逐行对应，memory/testing/package.json diff 各恰 1 行无夹带；改动文件集合 = §9 ALLOW LIST R3 精确集合（.mabf-bg 5 删除 + ALLOW 6 文件 + SA7/memory-test 重写翻转），DENY 零命中（SA6 三文件零改动、ADR 零触碰、结构性字段零改动、version 恰 1 行 `0.1.1→0.1.2`）
2. **读写路径一致性**：✅ 一致——degraded 状态的写入口（saveDoc/工厂）与读出口（getStatus 聚合/getStatus 门禁分离）同源于 `CoreEntry.degraded` 单一存储；无第二状态源
3. **静默失败**：✅ 无——R3 恰好消除了链路上最后一个静默吞掉点（sweep catch）；全错误矩阵每条路径均 loud throw 或等价于「无文件」的 ENOENT
4. **降级方案**：✅ 安全——degraded 半径修正为 ADR 逐字语义（entry 级），`degraded ⇒ dirty` 不变式保证降级 entry 永不蒸发、恢复唯一出口 = 本 entry retry 成功；无新增降级路径
5. **极端攻击**：✅ 安全——不变式推演（flush 守卫 × maybeEvict 前置 × generation 保序）闭合；degraded 期间 saveDoc 拒绝窗口为既有契约非回归；dispose/epoch/abort 路径逐字继承
6. **错误处理**：✅ 完整——errno 透传无包装、loading 双分支清理、错误消息逐字保留（`/disposed/`、`/persistence-degraded/`、`foreign or released DocHandle`、`/META\.docId/`）
7. **架构评估**：✅ 可行——无环 DAG 结构性根除 TDZ，owner 五边目标图逐边落地；无退回 SA1 信号
8. **过度设计**：✅ 精简——contract.ts 逐字搬迁零新逻辑；改动半径严格收敛于 owner 5 项授权范围

---

## Verdict: pass

owner 复审门禁 7 条静态面全部满足；决策 G/H/E4/I 逐项实证落地且无越界改动；测试断言真实有牙齿（errno 结构化断言、owner 4 覆盖点逐点钉死、守卫正/负样例自测、`degraded ⇒ dirty` 不变式的隐性守卫）；2 项 LOW 边界披露与 4 项动态审核重点移交 SA7。SA7 可进入动态验证（CI Node 20/24 实跑证据 + entry 级 4 语义活链路复验）。
