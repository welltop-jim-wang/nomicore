# SA4 静态验尸报告

**Date**: 2026-08-22
**Reviewer**: SA4（Red Team，静态验尸；实现后红队审查）
**评审对象**: SA1 设计 R1 定稿（`task_dsh-persistence-inspector_design.md`）、SA2 评审（R0 reject → R1 pass）、实现 diff（`git log 217d8a4..eded79f` + 全部新增文件，merge-base `origin/adr/server-design` = 2aa22f4 与简报基线一致）
**Verdict**: **reject**（1 项 P1：探针 evict 事件重复发射，污染 AC8 record 交付物；其余 8 项全 pass。修复面收敛在 `packages/dsh-persistence/src/probe.ts` 单函数 ~3 行，回流目标 SA3）

---

## 总判定与拒绝项

### 🔴 F1（P1，REJECT）`evict` 事件按 handle 重复发射 —— 同一次 doc 销毁产生 N 条 evict，AC8 record 交付物语义失真

- **根因（源码级）**：`packages/dsh-persistence/src/probe.ts:202-206` `watchEvict` 对每个 handle 的获取各注册一个 `'destroyed'` 监听：

  ```ts
  const watchEvict = (doc, owner, docId) => {
    const listener = () => emit({ type: 'evict', ... })
    doc.on('destroyed', listener)
    destroyedListeners.set(doc, listener)   // ← Map 以 doc 为键，后写覆盖前写
  }
  ```

  `createAndEmit`（:212）与 `loadAndEmit`（:222）各调用一次。S1 中 h1（create）+ h2/h3（两次 cache-hit load）共享**同一个 live Y.Doc d1**，于是 d1 上挂了 **3 个监听**；内核 `maybeEvict` 只 `doc.destroy()` **一次**（lifecycle.ts:463-469），yjs 对全部已注册监听各回调一次 → **3 条 evict 事件**。
- **可复现证据（SA4 实跑，2026-08-22，独立进程）**：

  ```bash
  cd /home/wangjian/nomicore-fix-issue-59
  pnpm exec tsx packages/dsh-persistence/src/cli.ts --adapter memory --fail-first-flushes 1
  # record 第 13–15 行（t=1002 连续三行，对应 d1 的**一次**销毁）：
  #   evict doc-alpha t=1002
  #   evict doc-alpha t=1002
  #   evict doc-alpha t=1002
  # 尾行：probe ok=true events=34   ← 设计 §5 时间线推演应为 32 条（多出 2 条 evict）
  pnpm exec tsx packages/dsh-persistence/src/cli.ts --adapter file --rootDir <mkdtemp>
  #   → 第 13–15 行同样 3× evict doc-alpha t=1002（file 通道同样复现）
  #   → events=30（设计推演 28，同因 +2）
  ```

  memory/file、n=1/n=2 四种组合全部复现；单 handle doc（d2/d3/d4）各只发 1 条 evict —— 与「监听数 = handle 数」假设完全吻合，实锤非偶发。
- **对照设计与契约**：
  - 决策 C：「evict：`doc.on('destroyed', …)`——**驱逐即销毁，销毁即事件**」——一次销毁 = 一条事件；
  - §5 时间线 t=1002 行明确只列 **1 条** `evict`；AC2 可满足性推演钉死「evicts = [1002, 1003, 1005]」（doc-alpha 恰 3 条）；
  - 实现产出 doc-alpha 5 条 evict（1002×3 + 1003 + 1005），事件总数 34 ≠ 32。
- **影响**：
  1. **AC8 交付物失真**：record 是本任务的核心交付（「供后续 NomicoreServer Host 复用验收」），下游按 ADR 语义读 record 会得出「发生 3 次驱逐」的错误结论；`events=` 计数同污。
  2. **测试面结构性失明**：SA6 AC2 用 `evicts.length >= 2` / `find` / `every` 型断言，重复事件全部通过——红转绿不能证伪此缺陷（总控亲跑 533/533 全绿亦然）。
  3. **失败路径次生污染（静态推演确认）**：teardown `finally` 按 `destroyedListeners` Map 逐 doc 只 `off` **最后写入的一个监听**（前 2 个仍挂在 doc 上）；若探针在 d1 仍 live 时失败（如 status-divergence），`profile.dispose()` 销毁 d1 → 残留监听再发 2 条 spurious evict，混入**失败 record**（renderProbeRecord 在 finally 之后执行）。
- **修复配方（SA3，~3 行，无契约面改动）**：`watchEvict` 开头加 `if (destroyedListeners.has(doc)) return`（每 doc 实例只注册一个监听）。同时消除 3× 重复与失败路径残留监听两个症状；`destroyedListeners` 键序、teardown 循环无需改动。修复后 record 应回到 §5 钉死的事件序（events=32/28/…）。
- **回流目标**：**SA3**（probe.ts）。建议（非阻塞，经总控协调）：SA6 在 AC2 追加 `expect(evicts.length).toBe(3)`（doc-alpha 精确计数）把该缺陷钉进回归锚——现网 `>=` 断言对本缺陷永久失明。

---

## 审核结论（验尸清单 1–8）

1. **设计一致性**：⚠️ 偏离 1 项（F1）。其余逐条核对**高度忠实**：决策 A（薄装配、`svc === profile.persistence` identity 自检 :187-189）、B（memory 顶层注入缝 / file 外部提交态观察）、C（`savedByKey` 仅 resolve 后 +1，:231 —— retry 成功 flush 与首发失败同 generation，实测 record 第 28/31 行 `generation=1` 两条、`dirty generation=2` 落在 `recovered` 之后，P16 语义锚在真实实现上闭环）、D（`resolveProbeClock` 缺 advanceBy → TypeError :492-499）、E（memory+rootDir / file+memoryIo / 未知 adapter / file 缺 rootDir 四类 loud reject :45-64,79-85）、F（dispose 幂等 + adapter 先 fiber 后 :89-96）、G（相邻 release 间 `advanceBy(1)` :300-304）、H（create-commit 不发 flush :123）全部按设计落地；时间线刻度（0/500/1000/1001/1002/1003/1004/1005/1006/1007/1008/1508/2008/2508/2509）与 §5 表**逐刻度吻合**。
2. **读写路径一致性**：✅ 无分叉。探针全部 service 调用经 `requireDocPersistence(profile.ctx)`（Cordis service，与 `profile.persistence` 同一实例）；file 通道读的 `.snapshot` 正是内核 flush 的提交产物（同一数据源）；memory 通道观察走 `MemoryPersistenceOptions` 顶层公开注入缝（P18 展平已按 §7 修订版伪代码实现 :52-53）。
3. **静默失败**：✅ 主链路无。CLI 用法错误→stderr+退出 2；探针失败→`probe-failed {封闭词表}` + `ok=false` + stderr 原始错误；`loadDoc null`、key 解析失败、快照读失败均 loud。⚠️ 1 项潜在掩蔽（F2，LOW，见「次要发现」）：S4 降级期的 saveDoc「意外接受」哨兵错误被 catch 吞掉后误发 `write-rejected`——当前内核契约（lifecycle.ts:200 拒绝）下不可达，且 service 级测试以 `rejects.toThrow(/persistence-degraded/)` 直接锚定该契约，故非阻塞。
4. **降级方案**：✅ 无伪降级。clock 不可推进 = 正常路径缺陷 loud TypeError（决策 D）；file 通道 `waitFor` 5s 超时 → `file-settle-timeout:{docId}:g{n}` loud 失败，不静默跳过。
5. **极端攻击**：❌ 发现 F1（如上）。其余攻击面核过：CLI 入参（非非负整数 / 未知 flag / 缺 --adapter / file 缺 rootDir / 值缺失）全部非零退出；`--fail-first-flushes 2` 的退避镜像（500→1000，cap 5000）与内核 `retryDelayMs` 翻倍规则（lifecycle.ts:455-456 初值 :383）逐刻度吻合（实测失败 1508/2008、成功 3008）；`failFirstFlushes=0` 走 else 分支正常 flush。
6. **错误处理链路**：✅ 完整。`probe-failed` reason 全部落在 §6.2 封闭词表（file-settle-timeout / status-divergence / scenario-error:{step} / service-identity / clock-not-drivable / io-read-error:{docId}）；原始错误走 console.error→stderr，实测 record（成功与双跑）零环境痕迹（无墙钟、无 rootDir、无 pid）。
7. **架构评估**：✅ 可行。无 FIXME/TODO/hack 标记；零架构绕行；未触发退回 SA1 信号。
8. **过度设计**：✅ 精简。7 个模块行数与 §7 预估同量级（probe.ts 499 vs ~380、profile 98 vs ~110）；无多余抽象层；变更半径严格限于新包 + 根 package.json 1 行 typecheck 追加。

## 次要发现（非阻塞，SA3 后续顺手修）

- **F2（LOW）** `probe.ts:388-394`：S4 `saveDoc` 意外 resolve 时抛的哨兵 `Error('saveDoc unexpectedly accepted…')` 被同一 catch 捕获后无条件 emit `write-rejected`——若内核回归为「degraded 仍接受写」，探针会记一条**假 write-rejected** 而非 loud 失败（S3 的 duplicate/meta-mismatch handler 均对意外错误 rethrow，此处不一致）。修法：catch 内识别哨兵（或改为 `if (await svc.saveDoc(h6).then(()=>false, ()=>true)) throw …` 形态）。
- **F3（INFO）** `probe.ts:487-489` `isMetaMismatch` 以 `/META\.docId/` 匹配错误消息文本（core 未导出类型化错误）；核心消息变更时会退化为 scenario-error（loud，不静默），可接受。
- **F4（INFO，归属卫生）** SA6 Phase 1 脚手架（`packages/dsh-persistence/package.json`、`packages/persistence/test/core-dsh-boundary.test.ts`、`pnpm-lock.yaml`）实际随 SA3 的 feat commit 217d8a4 入库，而非 SA6 自身 commit（简报 §4 声称 Phase 1 已就位）。内容与 ALLOW LIST 零偏差，仅提交归属叙事与简报略有出入，无需动作。

## 总控特别要求逐项结论

### ① vitest 触发性自检（技能 §1.4）—— ✅ PASS

- 触发条件命中：本任务新增 `*.test.ts` 共 3 个文件（dsh-persistence 两个红灯验收 + persistence 绿色守卫）。
- 证据链：根 `vitest.config.ts` `include: ['packages/*/test/**/*.test.ts', …]` 通配覆盖 `packages/dsh-persistence/test/**`；`.github/workflows/ci.yml` job `test`（node 20/24 矩阵）第 39 行 `run: pnpm test` → 根 script `vitest run --typecheck`（吃上述 include）；本仓库 CI 无 `--filter` 式包裁剪，include 通配即唯一且充分的触发通道。
- typecheck 通道同样接通：ci.yml:36 `pnpm typecheck` → 根 script 已追加 `tsc -p packages/dsh-persistence/tsconfig.json`（SA3 commit 217d8a4，设计 §11 预留项）；新包 tsconfig 镜像 persistence 包（extends tsconfig.base.json + include src/test）。
- 结论：3 个测试文件均落在 CI `test` job 的运行范围内，无「孤儿测试」风险。

### ② 协议假设审查（技能 §1.5，§13 P1–P18）—— ✅ PASS（假设本身全部成立；实现侧缺陷见 F1，非假设错误）

- **章节存在性**：✓ §13 存在，18 行假设各带类型与依据，无「应该/通常/预计」类无据推断。
- **源码锚点复核（SA4 本轮静态核对）**：P18 `memory.ts:15-22` 顶层 `writeSnapshot`/`readSnapshot` ✓；P6/P13 `lifecycle.ts:463-469` `maybeEvict` clean 前置 + `doc.destroy()` ✓；P17 退避 `lifecycle.ts:455-456` 翻倍 cap `maxDirtyMs` + `:383` 初值 `debounceMs` ✓；P15 `lifecycle.ts:200` degraded 拒绝写 + `:201` generation 递增 ✓；P7 勘误 `testing.ts:126/129` 每轮 3 微任务 ✓；P11 `vfsl-codegen/src/cli.ts:19-20` `./collect.js` 说明符 ✓；P12 vitest include 见①。
- **SA2 移交项重跑（「红转绿即天然复核」）**：P16（n=1 全场景）与 P17（n=2 退避）已由 SA4 在**真实实现**上重跑：时间线、retry 同 generation、`dirty g2` 在 `recovered` 之后、双跑逐字节一致全部吻合（证据见 F1 节命令输出 + file 双跑 diff IDENTICAL）。P13/P14/P15/P18 已由 SA2 R1 独立重跑，本轮抽核源码锚点一致，不重复。
- 唯一与 §5 钉死时间线的偏差是 evict 事件条数（F1）——那是**探针观察层实现缺陷**（监听重复注册），不是协议假设错误：yjs「销毁即事件」本身成立（单监听 doc 恰发 1 条）。

### ③ 版本号 bump 纪律 —— ✅ PASS

- `packages/persistence`：对基线 **零改动**（`git diff origin/adr/server-design HEAD -- packages/persistence/ ':!…core-dsh-boundary.test.ts'` 为空；src/test 既有一行未动），版本保持 **0.1.2 未 bump** ✓。
- `packages/dsh-persistence`：新包 **0.1.0** ✓（`private: true`，workspace 依赖 `@nomicore/persistence: workspace:*` 单向；`dsh:probe` 脚本与简报 §1 锚一致）。

### ④ §9 盘点表 ↔ §13 证据行对号（SA2 建议检查项）—— ✅ PASS

8 行逐行核对，引用的 §13 编号全部存在且指向匹配内容：AC1 memory→P13+P14；AC1/AC3 file→P8；AC2/AC3/AC4 probe 级→P16(+P3)；AC4 service memory→P15；AC4 service file→P5+P9；AC6→P7+P6；CLI 7 用例→P16+P11+P12；core-dsh-boundary→P2+P12。无「未验证」行，无空挂编号。

### 其他技能门禁

- **§1.1 Scope Creep Guard**：✅ actual（15 个文件）⊆ ALLOW ∪ 白名单（wiki/raw/task_*、pnpm-lock.yaml）；无 BLACKLIST 命中（无 npm/yarn lockfile、无 TASK.md、无 .bak）；DENY 全未触碰（`packages/persistence/src|test/**` 零 diff 除 SA6 owned 守卫；vfsl*/domains/apps/docs/CONTEXT.md/vitest.config.ts/tsconfig.* 零改动）。root `package.json` 唯一改动 = typecheck 追加 1 处，与 §12 ALLOW 精确一致。
- **§1.3 E2E spec 触发**：N/A（无 `.spec.ts`）。
- **§1.6 契约改动连锁**：N/A（设计 §14 声明无契约改动，SA4 核实 persistence src 零 diff、无任何既有 export 的 throw/return 契约变化；全部为新增代码）。
- **§1.7 源码 GREP 断言禁令**：✅ 合规。扫描命中 3 文件，人工分诊：`toContain` 断言对象均为 `result.record` / `result.stdout`（探针/CLI **运行时输出**，行为断言）；`readFileSync` 仅读快照文件（运行时磁盘副作用）与 package.json manifest（依赖图锚，非 .ts 源码文本）。core-dsh-boundary 的 manifest 断言与 `import.meta.resolve` 方向守卫均为运行时行为锚。

## 验证证据（SA4 实跑，2026-08-22）

```bash
cd /home/wangjian/nomicore-fix-issue-59
# 1) F1 复现（独立进程，memory n=1 / memory n=2 / file×2）：
pnpm exec tsx packages/dsh-persistence/src/cli.ts --adapter memory --fail-first-flushes 1
#   → t=1002 处 3×「evict doc-alpha」；probe ok=true events=34（设计 32）
pnpm exec tsx packages/dsh-persistence/src/cli.ts --adapter memory --fail-first-flushes 2
#   → 同 3× evict；退避 1508→2008→3008 与 P17 逐刻度吻合；events=36
pnpm exec tsx packages/dsh-persistence/src/cli.ts --adapter file --rootDir <A>  (+ <B>)
#   → 同 3× evict；diff 两跑 stdout → IDENTICAL（AC8 双跑一致性）；无 rootDir/tmp/墙钟痕迹
# 2) 基线与边界：
git merge-base origin/adr/server-design HEAD        # → 2aa22f4（简报基线一致）
git diff origin/adr/server-design HEAD --name-status # → 15 文件全落 ALLOW∪白名单
git diff origin/adr/server-design HEAD -- packages/persistence/ ':!packages/persistence/test/core-dsh-boundary.test.ts'
#   → 空（核心包零改动；版本 0.1.2 未 bump）
grep -rn "dsh" packages/persistence/src/             # → 无命中（AC7 源级）
# 3) CI 触发锚：
grep -n "pnpm test\|pnpm typecheck" .github/workflows/ci.yml   # → 36/39
grep -n "include" vitest.config.ts                   # → packages/*/test/**/*.test.ts
```

## 动态审核重点（交 SA7）

1. **F1 修复后回归**：SA3 落 `watchEvict` 去重后，CLI 三组合（memory n=1/n=2、file）record 应为 events=32/34/28 且 t=1002 单条 evict；同参双跑逐字节一致保持。
2. **失败 record 纯度**：人为制造 file settle 超时（如 chmod 只读 rootDir / 占死 `.tmp`），确认失败 record 无 spurious evict 行、`probe-failed` reason 落封闭词表、退出码 1。
3. **CLI 退出码矩阵**：`--adapter file`（缺 rootDir）当前走 TypeError → main reject → **退出码 2**（stderr 含 rootDir）——设计 §8 只钉「非零」，SA7 确认可接受即可；`--fail-first-flushes -1` / `abc` / 未知 flag 均 2。
4. **并发**：dsh-probe-cli 测试并行起两个 CLI 子进程（同 test file 内 Promise.all），慢机上的 60s 超时 guard 是否充裕（本机实测单跑 <3s）。
5. **yjs 版本面**：设计 P1 实测于 yjs@13.6.32，包声明 ^13.6.30（与 persistence 包一致，lockfile 单版本解析）；SA7 在 CI 环境（node 20/24）确认 'destroyed' 事件行为一致。

## 裁决

**reject** → 回流 **SA3**：修复 `probe.ts:202-206` `watchEvict` 重复注册（每 doc 实例一监听），顺手可修 F2（哨兵吞没）。修复不触碰 SA6 测试与 `packages/persistence`（DENY 维持）；修后 SA4 复跑本报告「验证证据」节三条 CLI 命令核对 events 计数与单条 evict 即可闭环。设计（SA1）与测试契约面（SA6）无需改动；建议（非阻塞）总控协调 SA6 在 AC2 补精确 evict 计数断言，堵死 `>=` 断言的结构性失明。
