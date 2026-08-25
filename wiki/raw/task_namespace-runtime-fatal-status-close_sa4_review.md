# SA4 静态验尸报告

**Date**: 2026-08-25 10:10 CST
**Verdict**: pass
**被审对象**: commit 91103db（SA3 实现交付；基线 588fa2b..HEAD，实际代码 diff = 9 个 src 文件 + package.json + 2 个 SA6 测试文件 + wiki 档案）
**方法**: 按 SA4 skill 验尸清单 §1.1–§9 逐项执行；全部门禁由 SA4 在独立进程重跑取证（非沿用 SA3/总控声明）

---

## 审核结论

1. **设计一致性：✅ 一致**（含 SA2 R1 修订四要求逐条兑现）
   - §1.1 Scope Creep Guard：design §11 ALLOW LIST 存在；actual diff（`git diff --name-only 588fa2b HEAD`）11 个代码文件**全部落在 ALLOW**；DENY LIST（sequencer.ts / projection.ts / doc-runtime / persistence / vfsl 族 / workflows / 根配置）**零命中**；BLACKLIST（npm lockfile / TASK.md / *.bak）零命中。冻结锚 `runtime-public-surface-ownership.test.ts` 与 rev1 措辞锚**未被触碰**（R-5 立法遵守）。
   - 逐决策比对：`close.ts` = D3 逐句兑现（含 R-4 function-thenable 判定分支，close.ts:38）；`runtime.ts` = D2/D4/D5.1/D10（含 R-2 重入语义 JSDoc，runtime.ts:119-124；D10 release 形状守卫，runtime.ts:304-306）；`status.ts` = D6 全量一致（handle 观察仅 ready 期执行，status.ts:53 短路）；`p0.ts` = D1 三字段 + R-3 注释裁决标注（P0 槽体行为零改动，diff 仅 8 行类型 + 2 行注释）；`errors.ts` = D9 append-only（fatal 域字符串零字节改动）；`index.ts` = D11 恰 +2 类型导出（`NamespaceRuntimeCloseError` 不导出——D9 裁决遵守）；版本 0.1.4→0.1.5。
   - SA6 锚断言面：8 运行时用例 + 3 类型面用例与简报 L77-113 覆盖矩阵逐条吻合（含 R-1 修订轮补的 D7 getter post-close 断言，test.ts:184-221）；无断言弱化痕迹（该文件本任务首次入库，比对基准为简报记录的 SA6 断言规格）。
2. **读写路径一致性：✅ 一致**——lifecycle/closeIssue 单可变源 `RuntimeState`（p0.ts）；`state.lifecycle` 写点恰 3 处（close() 同步段 runtime.ts:225 + barrier 成功/失败 close.ts:45/47——INV-C1）；`closeIssue`/`closeCause` 写点恰 1 处（close.ts:48/53）；buildStatus/getStatus/接纳门全部读同一 state，无分叉。
3. **静默失败：✅ 无**——close 三种结局全可观测（成功：lifecycle closed + promise resolve + release 计数；失败：closed + closeIssue 冻结注册**先于** throw + rejection cause；永挂起：ADR 契约行为且 JSDoc 文档化）；read/write 停接纳走结果联合（code/message 明确），非吞没。
4. **降级方案：✅ 安全**——release 失败无任何降级尝试（不虚假当成功）；非 thenable 返回被 loud 收敛为失败通道（反伪降级立法）；closing/closed 期 handle 观察短路非降级（release 后观察无信息增益，ready 期路径逐字节不变）；`readDisabled` spread-catch→[] 是敌意 Proxy 输入防御（沿 safeSpreadPath 纪律）。
5. **极端攻击：✅ 未发现静态可确认漏洞**。已攻击并排除：
   - 敌意 read path（Proxy 数组 iterator throw）→ gate 先拒 + echo catch 回退 [];
   - 敌意 thenable（`.then` getter throw）→ try 内收敛失败通道，与 ECMAScript await 语义同结局；
   - release 同步 throw / reject / 非 thenable / 永不 settle → INV-C12 全 catch / 契约性挂起（R2 登记）；
   - close 并发/重复/已结算后调用 → closePromise 缓存恒同实例（幂等不依赖 state）；
   - close 时 P0 preparing / 排空期写槽 fatal（committed:true）→ FIFO + 链尾恒绿保证 barrier 照常（sequencer.ts:38-42 `tail.then(run, run)` + `settled.then(noop, noop)` 实读确认）；
   - fatal×close 交叉 → 字段级分离（fatal 域 vs close 域写点互不触碰），fatal 后 read.enabled=true、close 后才 false（D6 公式）；
   - `sequencer.enqueue` 无同步 throw 路径 → 「lifecycle='closing' 但 closePromise 未赋值」中间态不可达。
6. **错误处理：✅ 完整**——barrier async 全 catch 三路收敛；失败通道 closeIssue 注册先于 throw（rejection 送达时 getStatus().close 已可观测）；close rejection cause 零信息损失；术语分域维持（fatal 域常量 + S1 gate 文案零改动、无 closing/closed 措辞——grep 复验；close 域新串不含 'stack'/哨兵面）。
7. **架构评估：✅ 可行**——无 FIXME/绕过/临时补丁；变更半径与 ALLOW 逐文件吻合；lifecycle gate 住接纳层、槽内只留 fatal gate 的裁决与 ADR「已接纳任务无条件排空」自洽。
8. **过度设计：✅ 精简**——close.ts 56 行、status.ts 净改 ~30 行、注释级改动守约（≤4 行/文件）；thenable 守卫与 spread-catch 防御均有设计与 SA2 修订背书，非投机抽象。

### 门禁复跑证据（SA4 独立进程，2026-08-25 10:07–10:09，Node v24.13.0）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 全量测试 | `pnpm test`（vitest run --typecheck） | **exit 0：86 files / 1089 tests / Type Errors: no errors**（简报基线 84 files/1078 tests + 恰 +2 文件/+11 用例 = 本任务两锚文件 8+3，无意外增删） |
| 七包类型 | `pnpm typecheck` | **exit 0** |
| 全仓测试类型 | `pnpm exec tsc -p tsconfig.typecheck.json --noEmit` | **exit 0**（SA6 红灯期 4 错已清零） |

- 新锚确实执行：`runtime-close-lifecycle.test.ts (8 tests) 27ms ✓`、`runtime-close-lifecycle-type-guard.test-d.ts (3 tests) ✓`；无 skipped/todo；确定性（27ms，零网络零端口）。
- 触发性（§1.3/§1.4）：vitest.config include `packages/*/test/**/*.test.ts` 与 `.test-d.ts` 覆盖本包；ci.yml `Test: pnpm test`（Node 20/24 matrix）+ `Typecheck: pnpm typecheck` 接通——无孤儿 spec（E2E spec 本任务为零，N/A）。
- 契约连锁（§1.6）：`@nomicore/namespace-runtime` 包外零消费者（grep 复验）；read 联合宽化对 14 个 seam caller / 11 个 read 消费文件编译兼容（全量 typecheck 实证）；captureSeamInput 新 throw 路径零回归（8 处 fakeHandle release: grep 复验 + 其余经真实 persistence handle，全测试绿实证）；closePromise rejection 由 sequencer 链尾 noop 消化 + 调用方责任（JSDoc 文档化）。
- 测试质量（§1.7）：两锚文件零 `readFileSync`/源码字符串断言——全部为运行时行为锚（状态机迁移、Promise 身份/结算、release 计数、Y.Doc 字节、notifier 计数）。**通过**。

### 1.4 vitest 触发性自检

**检查对象**：本任务涉及的 `*.test.ts` 文件——`packages/namespace-runtime/test/runtime-close-lifecycle.test.ts`（8 运行时用例）与 `packages/namespace-runtime/test/runtime-close-lifecycle-type-guard.test-d.ts`（3 类型面用例，经 `--typecheck` 通道）。

**接通事实（SA4 实读复验，2026-08-25）**：
- `vitest.config.ts:5` include `packages/*/test/**/*.test.ts` → 行为锚在收集范围；`vitest.config.ts:9` typecheck.include `packages/*/test/**/*.test-d.ts` → type-guard 锚被类型通道收集；
- `.github/workflows/ci.yml:38-39` `Test: run: pnpm test`（= `vitest run --typecheck`，Node 20/24 matrix）→ 上述 include 配置即 CI 执行面，无 `--filter`/`--project` 收窄漏包；
- `.github/workflows/ci.yml:35-36` `Typecheck: run: pnpm typecheck` 含 `tsc -p packages/namespace-runtime/tsconfig.json`（include `src/**`，新增 close.ts 自动入检）；
- SA4 本地全量复跑日志实证两文件被实际执行：`runtime-close-lifecycle.test.ts (8 tests) ✓`、`...-type-guard.test-d.ts (3 tests) ✓`。

**结论**：`@nomicore/namespace-runtime` 包被 vitest include 模式与 CI `pnpm test`（Node 20/24）接通，本任务全部 vitest 测试文件落在 CI 触发范围内——**verdict token: `all-vitest-packages-triggered`**（无 `vitest-package-not-triggered` 项）。附带：§1.3 E2E spec 触发性 N/A——本任务 diff 无任何 `*.spec.ts` 文件。

### INFO 级观察（不阻塞，无需处置）

- 用例 5 未断言 close rejection 的 `reason.code` 字面量（`NamespaceRuntimeCloseError` 按设计不导出，分类消费走 `getStatus().close`）——与 SA6 冻结边界声明一致，非缺陷。
- 接纳门实现读 `state.lifecycle` 两次（if 判定 + refusal 插值）vs 设计注「单读到局部量」——同步段内无交错，零行为差异；设计 §5 已声明「以等价最小实现为准」。

## 动态审核重点（交 SA7）

1. **Node 20/24 双矩阵 CI 证据（AC9）**：SA4 本地仅 Node v24.13.0 复跑；SA7 须从 `gh run view --log` 摘录 ci.yml 两 matrix leg 全绿 + `pnpm test` 步骤含 `runtime-close-lifecycle` 两文件通过行。
2. **未 catch 的失败 close → unhandledRejection（R1 登记）**：API 契约（与 fatal rejection 同款责任归属）；当前包外零消费者故无现实面——SA7 验证仓库无 process 级 `unhandledRejection → exit` handler 会因测试/宿主误用被引爆。
3. **真实 handle 的 close 冒烟**：close 锚全部用 fakeHandle（fixture 纪律明示）；SA7 至少一次用真实 `createMemoryPersistence` handle 走 close（release 真实实现 + `handle.getStatus()==='released'` 终态）。
4. **release 永不 settle → close 永挂起（R2）**：契约行为、vitest 不可锚——SA7 确认该语义已在 close JSDoc 可见（runtime.ts:112-124 已文档化，抽查即可）。
5. **function-thenable release（§6.2 #15）**：静态已核判定分支存在（close.ts:38 含 function 分支）；无运行时锚。SA2 红线思路 #3 为可选项——若 SA6 后续修订轮采纳则补，非本任务缺口。

**Verdict = pass** —— SA3 交付与 SA1 设计（R1 修订版）逐条吻合，SA2 五项修订要求全部兑现，全量门禁经 SA4 独立复跑全绿，无静态可确认漏洞。SA7 可进入动态验证。
