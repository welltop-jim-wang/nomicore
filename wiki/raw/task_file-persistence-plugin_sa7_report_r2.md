# SA7 动态验证报告（R2 — PR #66 owner review 修订轮）

**Date**: 2026-08-21
**Verifier**: SA7（Dynamic Verifier）
**被验对象**: HEAD commit `6c895fb`（SA3 对 owner 5 项反馈的 R3 实现），worktree `/home/wangjian/nomicore-fix-issue-58`
**输入**: `task_file-persistence-plugin_revision.md`（owner 5 项 + 复审门禁 7 条）、`task_file-persistence-plugin_sa4_review_r2.md`（verdict: pass，移交 4 项动态审核重点）、`task_file-persistence-plugin_design.md` §5a/§8
**方法**: 独立进程全量复跑 + 活链路探针（跑毕即删）+ **变异验证**（对生产码做 6 组定点退化突变，逐条证明测试断言真实可翻红，突变后 `git checkout` 还原，终态 `git diff HEAD --stat -- packages/` 为空）
**环境事实**: uid=1000（`wangjian`，**非 root** — chmod r-x 手法有效的前提成立）；本地仅 Node v24.13.0（无 nvm/Node 20，本地无法复现 Node 20 档）；`.mabf-bg/` 已在 `.gitignore:6`（本轮日志不入仓，G1 未来 push 不受污染）

---

## Step 0 — SA4 verdict 校对

`task_file-persistence-plugin_sa4_review_r2.md` 顶部 `**Verdict**: **pass**` → 进动态验证。

## Step 1 — 全量独立复跑（独立后台进程，非 ACP 内同步阻塞）

| 命令 | 结果 | 日志（gitignored） |
|---|---|---|
| `pnpm test` | **35 files / 499 passed / Type Errors no errors / EXIT=0** | `.mabf-bg/sa7-r2-full-test.log` |
| `pnpm typecheck` | **EXIT=0**（4 个 tsconfig 全过，含 `packages/persistence`） | `.mabf-bg/sa7-r2-typecheck.log` |
| `vitest run packages/persistence/test/`（还原后终态复核） | **5 files / 47 tests passed / EXIT=0** | 见本报告命令记录 |

与总控亲跑结果（35/499/EXIT=0）一致。SA6 套件（`file-persistence.test.ts` 13 用例）绿灯 — Step 1 关通过。

## Step 2 — Owner 复审门禁活链路逐条动态验证

### 门禁 3+4/5（entry 级 degraded 4 条语义）— 变异矩阵逐点击杀

活链路运行：`file-persistence-sa7-dynamic.test.ts` test 2 **7 次全绿**（套件 1 次 + flake 连跑 6/6）。断言非永真的证明 = 4 组退化突变，每组恰好击穿对应覆盖点：

| Owner 覆盖点 | 突变（临时注入 pre-R3 语义，已还原） | 实测结果（非永真证据） |
|---|---|---|
| C0/C1 失败→本 entry 降级、Bob 被拒 | **F**：删 `entry.degraded = true`（flush 失败不降级） | 🔴 test 2 翻红：`bob flush failure degrades the adapter: expected false to be true`（waitFor 2s 有界兜底触发，非永真） |
| C2 Alice/doc2 仍可读写 + CAROL 新建成功 | **A**：`assertEntryWritable` 改查「任一 entry degraded」（pre-R3 全局门禁） | 🔴 翻红于 `saveDoc(aliceHandle)`：`promise rejected "persistence-degraded: writes are r…" instead of resolving`（全局门禁同样会拒绝 CAROL 工厂） |
| C3 Alice 成功不得恢复 Bob | **B**：flush 成功路径改清**所有** entry 的 degraded（pre-R3「任一成功即全局翻回」） | 🔴 翻红于聚合断言：`expected 'ready' to be 'persistence-degraded'`（alice 落盘后 Bob 被错误恢复） |
| C4 Bob 自身 retry 成功才恢复 | **G**：删 `entry.degraded = false`（成功永不清降级） | 🔴 翻红于：`expected 'persistence-degraded' to be 'ready'`（retry 落盘但状态不恢复） |

聚合 `getStatus()` 视图行为随 C3/C4 突变分别双向钉死（degraded 观察与恢复观察各有独立击杀）。**结论：4 条语义断言全部有牙齿，entry 级隔离在活链路成立。**

### 门禁 2/3（深路径直接导入无 TDZ）— 探针 + 双锚点击杀

- **逐入口隔离探针**（3 个临时测试文件，各自独占 vitest 模块注册表，零 index.js 依赖，跑毕即删）：
  - 仅 `../src/file.js`：求值无 TDZ，`new FilePersistence` → saveDoc → 真实落盘断言（`d1.snapshot` exists）→ dispose `disposed` — ✅
  - 仅 `../src/memory.js`：求值无 TDZ，handle/save/load round-trip — ✅
  - 仅 `../src/lifecycle.js`：求值无 TDZ，内联最小子类真实跑通 CORE_TEST_FACTORY/saveDoc/flush（`writes.length===1`；探针首跑失败系我方假设错误——默认 debounce 500ms > 120ms 等待，非被验代码问题，探针改显式 schedule 后绿）— ✅
- **module-graph 运行时锚点有效性（突变 E）**：向 `lifecycle.ts` 注入一行反向 barrel 导入 `import { DOC_PERSISTENCE_SERVICE } from './index.js'`（复现 owner 指控的环）→ `module-graph-regression.test.ts` 与深路径消费者探针**双双在模块求值期崩溃**：`TypeError: Class extends value undefined is not a constructor or null`（与 SA4 P11 记录的历史 TDZ 逐字同型），exit=1 — 运行时锚点真实有效，非「测试绿即通过」。
- **静态守卫有效性（同突变下独立验证）**：以 node 探针复跑 `hasReverseBarrelImport` 于被突变源码 → `guard flags mutated lifecycle.ts: true`。双锚点（运行时 + 静态 grep）互为冗余，任一形态回潮至少一锚命中。

### 门禁 6（tmp 非 ENOENT 响亮失败）— OS 层 + 断言层双证

- **OS 层探针**（uid 1000 非 root，实测输出）：0o555 目录下 `fsp.rm(path, {force:true})` → rejects `EACCES`，errno 对象完整保留 `{"code":"EACCES","errno":-13,"syscall":"unlink","path":"…"}`；tmp 原地保留；chmod 0o755 后 rm resolve；缺失路径 `force:true` resolve（≡ ENOENT 静默）。**chmod 手法在本环境真实触发，无需替代方案。**
- **活链路**：test 1 绿（`rejects.toMatchObject({ code: 'EACCES' })` 结构化 errno 断言 + tmp 原地 + 治愈后 load 成功/内容还原/tmp 被清三段闭环）。
- **变异 D**：恢复 `.catch(() => undefined)`（pre-R3 吞错）→ 🔴 test 1 翻红：`promise resolved "CoreDocHandle{…}" instead of rejecting` — errno 断言非永真。

### 门禁 7（test/typecheck/CI）— 本地全绿 + CI 证据缺口披露（移交）

- 本地：全量 test/typecheck 双 EXIT=0（见 Step 1）。
- **CI 现状（重要披露）**：branch `fix/issue-58-on-adr-server-design` **ahead 1** — HEAD `6c895fb` 未 push。现存唯一成功 run `32475357433`（`test (20)` + `test (24)` 双绿）headSha = **e8e4fb8（R3 之前的基线）**，PR #66 `statusCheckRollup.headRefOid` 同为 e8e4fb8。**R3 改动（contract.ts / entry-scoped degraded / loud tmp sweep / module-graph 测试）目前没有任何 CI 实跑证据。**
- 覆盖面静态确认（push 后将自动触发）：`ci.yml` matrix `node: [20, 24]`，步骤 Typecheck（含 `packages/persistence/tsconfig.json` → 覆盖 contract.ts）+ Test（根 vitest include `packages/*/test/**/*.test.ts` → 覆盖全部 5 个 persistence 测试文件）+ Persistence contracts + scaffolds + regen-diff。
- Node 20 档风险面：本地无 Node 20 可执行文件（无 nvm），无法本地复跑；唯一 Node-20 敏感点是守卫正则的 variable-length lookbehind（V8 ≥ 6.2 / Node ≥ 8.10 支持，远低于 20），且本地 Node 24 实际执行通过；e8e4fb8 双档绿证明 matrix 基础设施本身可用。
- **处置**：CI-on-HEAD 属「push 之后才能产生」的下游证据，按修订轮工作流（SA7 报告 → 确认 push → runner 跟踪 CI）移交总控/runner；本报告**不构成 CI 已绿声明**（见 Verdict 条件）。

## Step 2.5 — SA4 移交 4 项动态审核重点逐条核销

| # | SA4 移交项 | 动态核销结论 |
|---|---|---|
| 1 | CI Node 20/24 实跑证据 | **缺口披露**：现存双绿 run 属 e8e4fb8（基线），6c895fb 未 push 无 CI。matrix/步骤覆盖面已静态确认（上节）；lookbehind 在 Node 20 无版本风险。**移交：push 后 runner 复核双档绿** |
| 2 | ManualTimer `fireOldest()` 插入序稳定性 | **实测稳定**：插桩探针（LoggingTimer，逐次打印 pending id 集）实测序列 — 双 saveDoc 后 pending=`0,1,2,3`（bob maxDirty/debounce + alice maxDirty/debounce，Map 迭代序=插入序）；fire#1(id=0, bob 触发器) → degraded、pending=`2,3,4`（bob debounce 被兄弟触发器取消、retry 以 id=4 停靠）；fire#2(id=2, alice) → alice 落盘、聚合仍 degraded、pending=`4`；fire#3(id=4, bob retry) → ready、pending 空。**entry 内触发器种类无关紧要**（debounce/maxDirty 两路均汇入同一 `startFlush`，先触发者取消兄弟计时器）——即使实现侧 scheduleFlush 内部次序互换，序列不变；跨 entry 次序由测试 saveDoc 调用序决定（确定性，非 I/O 时序）。6/6 连跑零 flake，无 `now()` 时钟参与（ManualTimer.now()≡0），慢 I/O 仅影响 waitFor 轮询（400×5ms 有界），无跨平台 flake 风险面 |
| 3 | degraded 窗口调用方契约（知悉项） | **实证确认无意外依赖**：探针 (b) 实测 — 窗口内 `saveDoc` 拒绝（dirty 不登记）后，调用方对共享 Y.Doc 的编辑（`v2-during-window`）**仍被本 entry 的 retry flush 落盘**（flush 时点编码活文档，dirtyGeneration 来自降级前最后一次被接受的 saveDoc）；恢复后的新编辑若无新 saveDoc 则**不**触发 flush（快照字节 100ms 不变），补 saveDoc 后落盘 `v3`。现有测试 2 的恢复断言只依赖「retry 落盘 + 状态恢复」，与该窗口语义零耦合 — 无测试隐式依赖被拒 saveDoc 的 dirty 登记 |
| 4 | chmod EACCES 在 runner（非 root）有效性 | 本地 uid 1000 实测 EACCES 语义成立（OS 层探针，errno 全保留）；GitHub-hosted ubuntu runner 以非 root 用户运行，且 e8e4fb8 的双档 CI 已绿跑过含 chmod-555 场景的旧版 SA7 动态测试（P4 记录同手法）→ 手法在 CI 环境有效性有历史背书；6c895fb 版本的同等断言待 push 后 CI 确认（并入移交 #1） |

## 变异验证汇总（全部已还原，终态 `git diff HEAD --stat -- packages/` = 0 行）

| 突变 | 注入语义 | 击杀的断言 | exit |
|---|---|---|---|
| A | pre-R3 全局 degraded 门禁 | test 2 C2（alice 被拒） | 1 |
| B | 任一成功恢复所有 entry | test 2 C3（聚合翻 ready） | 1 |
| D | tmp rm 吞错 `.catch(()=>undefined)` | test 1（loadDoc resolve 非 reject EACCES） | 1 |
| E | lifecycle 反向 import barrel（复现环） | module-graph + 深路径消费者：求值期 `Class extends value undefined` TDZ 崩溃；静态守卫正则同查命中 | 1 |
| F | flush 失败不置 degraded | test 2 C0/C1（waitFor 降级观察假） | 1 |
| G | 成功永不清 degraded | test 2 C4（状态不恢复） | 1 |

每组突变仅触碰单一行为面，翻红位置与预期覆盖点一一对应 — 证明 R3 测试面对 owner 4 条语义 + tmp 语义 + 模块图契约的钉死均为**可失败断言**，非结构性绿灯。

## 门禁 1（diff 无 `.mabf-bg/**`）动态复核

`git ls-tree -r HEAD --name-only | grep -E '^\.mabf-bg/|TASK\.md'` 空输出（exit=1）— HEAD 树干净；本轮新增日志写入 `.mabf-bg/`（gitignored，`git check-ignore` 确认）不会进入未来提交。

## 阅读清单（≤15 文件约束内，11 个）

revision.md、sa4_review_r2.md、design.md（§3/§4/§5/§5a/§6/§7/§8 节选）、src/{contract,file,index,lifecycle}.ts、test/{file-persistence-sa7-dynamic,module-graph-regression,memory-persistence}.test.ts（:255-335 块）、ci.yml、vitest.config.ts

## 产物

- 本报告：`wiki/raw/task_file-persistence-plugin_sa7_report_r2.md`（新文件，未覆盖首轮 sa7_report.md；未提交，由总控处置）
- 临时探针 4 文件：**跑毕即删**（`git status packages/` 零残留）；未新增永久测试——现有 5 文件测试面经变异验证已证明充分，增补只会重复
- 验证日志：`.mabf-bg/sa7-r2-full-test.log`、`.mabf-bg/sa7-r2-typecheck.log`（gitignored）

## 环境阻塞与边界

- 本地无 Node 20 → Node 20 档只能由 CI 证实（无其他本地阻塞；所有命令独立进程执行）。
- CI-on-6c895fb 不存在（未 push）— 非 SA7 可解，属工作流下游步骤，移交总控。

---

## Verdict: pass

owner 复审门禁 7 条中，可在本地活链路验证的全部通过：entry 级 degraded 4 条语义经 4 组变异逐一击杀证明真实钉死（含聚合 getStatus 双向观察）；深路径逐入口探针无 TDZ 且模块图双锚点（运行时求值 + 静态守卫）在环回潮突变下双杀；tmp 非 ENOENT 响亮失败在非 root 环境以结构化 errno 断言实证且吞错突变翻红；全量 test/typecheck 独立复跑双绿。SA4 移交 4 项中 3 项动态核销，第 1 项（CI Node 20/24 on HEAD）因 HEAD 未 push 而属 push 后下游证据——**本 verdict 附明确条件：总控确认 push 后，runner 必须复核 `6c895fb` 上 `test (20)`/`test (24)` 双档绿；若任一档红，本 verdict 应回撤重审。本报告不构成、也不应被引用为「CI 已绿」的证据。**
