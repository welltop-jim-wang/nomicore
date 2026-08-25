# SA4 静态验尸报告 — namespace-runtime Registry 专用受限生产构造 seam（issue #109）

**Date**: 2026-08-25
**Verdict**: **pass**
**被审对象**: SA3 实现 commit `b233ea4`（worktree `/home/wangjian/nomicore-fix-issue-109`，branch `fix/issue-109-on-docs-namespace-registry`，base = `docs/namespace-registry`（= 父提交 `3451eca`，diff 范围恰单 commit））
**输入**: 任务简报 / SA1 design R0 / SA2 review（pass）/ SA8 relevant_decisions + design_conflict_report（clear）/ SA6 红灯 2 文件 11 用例

---

## 0. 验证证据总表（全部真实运行，2026-08-25 19:39–19:41）

| # | 命令 | 结果 |
|---|---|---|
| E1 | `npx vitest run packages/namespace-runtime/test/runtime-registry-internal-seam.test.ts packages/namespace-runtime/test/runtime-registry-internal-type-guard.test-d.ts` | `Test Files 2 passed (2); Tests 11 passed (11); Type Errors no errors`，exit 0 |
| E2 | `npx vitest run packages/namespace-runtime/test/runtime-acceptance-exports-audit.test.ts` | `4 passed (4)`，exit 0（含 T1.4 演进后键集断言） |
| E3 | `pnpm test`（vitest run --typecheck 全量） | `Test Files 95 passed (95); Tests 1146 passed (1146); Type Errors no errors`，exit 0；新 2 文件 + 演进 audit 均被收集（log 中 `✓ …runtime-registry-internal-type-guard.test-d.ts (3 tests)` / `✓ …runtime-registry-internal-seam.test.ts (8 tests)` / `✓ …runtime-acceptance-exports-audit.test.ts (4 tests)`） |
| E4 | `pnpm typecheck`（逐包 tsc，含 `tsc -p packages/namespace-runtime/tsconfig.json`） | exit 0 |
| E5 | `pnpm exec tsc -p tsconfig.typecheck.json --noEmit`（聚合） | exit 0 |
| E6 | `git diff --name-only docs/namespace-registry..HEAD` / `git diff 3451eca HEAD --name-only -- <DENY 路径集>` | 实际改动恰 6 个非 wiki 文件 + 7 个 `wiki/raw/task_*`；全部 DENY 路径零 diff |

## 1. 设计一致性审查

### 1.1 文件清单 Scope Creep Guard — ✅ 通过

- design §6 ALLOW LIST 存在（含 DENY LIST）。实际 diff（E6）非 wiki 部分：
  `src/internal.ts`（新建）、`package.json`、`test/runtime-acceptance-exports-audit.test.ts`、`README.md`、`test/runtime-registry-internal-seam.test.ts`（SA6 owned）、`test/runtime-registry-internal-type-guard.test-d.ts`（SA6 owned）——**六者全部在 ALLOW LIST 内，零越界**。
- `wiki/raw/task_namespace-runtime-registry-seam*.md` 7 件 → 白名单模式 `^wiki/raw/task_` 豁免。
- BLACKLIST（package-lock.json / yarn.lock / TASK.md / *.bak / .DS_Store）：全仓 diff 零命中。`pnpm-lock.yaml` 未改动（SA2 A9：workspace 包 bump 不入 lockfile，`--frozen-lockfile` 安全——本轮 diff 复核一致）。
- DENY LIST 全量点名比对（index.ts / runtime.ts / errors·p0·projection·sequencer·status·close·write·schema-write / 两 tsconfig / vitest.config.ts / docs/adr / CONTEXT.md / persistence·doc-runtime·vfsl*·dsh-persistence / domains / apps）：**零 diff**。
- SA6 两测试文件与简报锚定记录逐项吻合（seam 8 it：AC1/AC6×3 + AC2×1 + AC4×1 + AC5×3；type-guard 3 it），无断言弱化迹象（无 skip/only/soft；该二文件此前未单独入 commit，比对基准为简报 §SA6 验收锚定记录——如实注明验证 basis）。

### 1.2 设计偏离审查 — ✅ 零偏离

| 设计条款 | 实现事实（E6 diff + read） | 判定 |
|---|---|---|
| §D-A/D-C internal.ts：恰一键值导出、零类型导出、纯委托、相对导入、leaf 无环 | `src/internal.ts` 32 行与设计代码体逐字等价：唯二 import 为 `@nomicore/persistence`（type-only）与 `./runtime.js`；唯一语句 `return createNamespaceRuntime(handle, notifyDirty)`；不 import `index.ts`、不被其 import（无环验证：全 src 树无任何文件 import internal） | 一致 |
| §D-B 两参形 `(handle: DocHandle, notifyDirty: () => Promise<void>)` | 签名逐字一致；委托目标 `createNamespaceRuntime`（runtime.ts:274-279）同为两参形——委托即恒等 | 一致 |
| §D-D package.json 恰两处 diff | diff 仅 `version 0.1.5→0.1.6` + exports 增 `"./internal": "./src/internal.ts"`；`private: true`/依赖零变化 | 一致 |
| §D-E T1.4 演进限单 it 块、其余三 it 逐字不动 | diff 单 hunk（@@ -53,15 +53,18 @@）：仅第 4 it 标题/头注/期望键集 `['.']`→`['.', './internal']`；前三个 it（值导出恰一键、禁导清单缺席、唯一值导出是 function）零改动 | 一致 |
| §D-G README 一句对齐 | 第 9 行替换文本与设计 §D-G 逐字一致（SA2 A12 建议保留，已保留） | 一致 |
| §D-F 三硬规则 | ①生产零消费：grep 全仓 `namespace-runtime/internal` 仅 internal.ts 头注（注释文本、非 import）+ test 目录两文件；②internal.ts 只走相对导入（:13 显式）；③测试文件未被移动 | 一致 |

### 1.3 E2E spec runner 触发性 — N/A（本任务无 `*.spec.ts`；无 playwright 面）

### 1.4 vitest 触发性自检 — ✅ 通过（**结论：全部 3 个测试文件已被 CI `test` job 的 vitest 命令覆盖**）

- design 含新增/改动 `*.test.ts` → 门禁触发。涉及文件：`runtime-registry-internal-seam.test.ts`（新）、`runtime-registry-internal-type-guard.test-d.ts`（新）、`runtime-acceptance-exports-audit.test.ts`（改）。
- 触发链静态证据：`.github/workflows/ci.yml` `test` job（node matrix [20,24]，:18）step `pnpm test`（:39）→ 根 `package.json` `"test": "vitest run --typecheck"` → `vitest.config.ts` include `packages/*/test/**/*.test.ts`（覆盖 2 个 .test.ts）+ typecheck.include `packages/*/test/**/*.test-d.ts`（覆盖 test-d）。另 `pnpm typecheck`（:36）显式含 `tsc -p packages/namespace-runtime/tsconfig.json`（src 含 internal.ts）。无 `--filter` 缺口——本仓 vitest 为根级全仓 run，不按包过滤。
- 触发链运行时证据（E3）：全量 run 的 95 个文件中三文件全部被收集且绿——**不存在「测试存在但从未被触发」的 CI 黑洞**。
- 无需改 workflow；design 无需补节（触发性已由仓内既有根级配置自然承载，SA7 动态阶段可从 CI log 复核同一证据）。

### 1.5 协议假设审查 — ✅ 通过（P1–P5 复跑确认）

design §7 章节存在，五条假设依据类型全部为「实测验证/现有测试引用/官方机制文档」，无「应该/通常/预计」类无据推断。本轮复跑：

| 假设 | 复跑结果 |
|---|---|
| P1 vite subpath 解析 | E1：specifier 解析成功、11/11 绿（红灯期为 vite `Missing "./internal" specifier`，加键后闭环） |
| P2 tsc bundler resolution + typecheck 翻转 | E1 `Type Errors no errors` + E4/E5 exit 0；`tsconfig.base.json:6 moduleResolution:"bundler"`、`:12 verbatimModuleSyntax` 本轮 read 复核 |
| P3 Node 20/24 自引用 | 机制在当前 Node 经 E1/E3 验证；跨 20/24 双版本由 CI matrix 承载 → 移交 SA7 动态确认（见 §动态重点 1） |
| P4 动态 import namespace 只含值导出 | E1 seam it#2 运行时断言 `Object.keys(entry).sort() === ['createNamespaceRuntimeForRegistry']` 实测通过 |
| P5 根 entry 不受影响 | E2 4/4 绿（值导出恰一键断言仍在） |

### 1.6 契约改动连锁审查 — ✅ N/A-PASS（无函数契约改动）

生产 diff 除新 leaf `internal.ts` 外为零（grep `-`/`+` 行证实）。新增函数 `createNamespaceRuntimeForRegistry` 当前全仓零 caller（未来 caller 为切片 5/6 Registry）。唯一触碰的既有契约是**配置级** `package.json` exports 键集，其全部消费方（exports-audit T1.4、SA6 seam.test AC1、vite/tsc 解析器、包外生产方=空集）与 design §8 审计表逐项吻合，T1.4 已按预授权演进且不变量（无测试子路径）保持。

### 1.7 源码 GREP 断言禁令 — ✅ 通过（一处豁免已注明）

- 改动测试文件中唯一 `toContain`（seam.test.ts:292）作用于**运行时结果对象**（写拒绝结果的 JSON），非源码文本。
- seam.test.ts AC5 用 `readFileSync` + 正则扫生产源码——**豁免**：被测契约本身就是静态 import 图边界（ADR 0009「模块边界测试限制该 internal subpath 只能由 Registry 生产代码消费」、简报钦定「以静态审计实现」），静态性质契约无运行时行为等价物可锚；且同文件 AC1/AC2/AC4 均为真·运行时行为断言（动态 import 探测、注入哨兵、FIFO/close 全链），源码扫描非唯一或主要契约锚点。package.json 读取（T1.4/AC1-it1）为配置元数据审计（issue #93 存量模式），非源码断言。

## 2. 读写路径一致性 — ✅ 一致

单一构造路径：`createNamespaceRuntimeForRegistry → createNamespaceRuntime → createNamespaceRuntimeWithSeam({handle, notifyDirty})`（第三跳对象上 `p0Gate`/`compile` 缺席，runtime.ts:278）。Runtime 的写序列器/读取/status/close 与包内既有实现为**同一份代码**，结构上不存在读写源分叉。跨实例落盘闭环由 seam.test AC4-⑥ 实测（全新 reader 读到 n=20）。

## 3. 静默失败专项 — ✅ 无

internal.ts 零分支/零 catch/零 finally，无静默路径；V1 形状守卫 loud `TypeError`、V2 状态门 loud `HANDLE_NOT_USABLE`（构造 throw 前置、零副作用、所有权归调用方）经 subpath 同步透传给调用方。

## 4. 降级方案审查 — ✅ 安全（零降级）

未引入任何 fallback：notifyDirty 必填、无缺省 no-op（写槽 S2 loud gate 保留在委托实现内）；多余位置实参（注入哨兵）由 JS 调用语义天然忽略——「无守卫代码」即无「承认注入但静默丢弃」的伪降级（E1：compile spy 零调用、never-resolve p0Gate 零消费、P0 真实 vfsl 编译 ready）。

## 5. 极端条件攻击 — ✅ 安全（1 项前瞻性发现，非阻塞）

静态推演的攻击面与处置：

| 攻击 | 结果 |
|---|---|
| 第 3 位置实参注入 compile/p0Gate/fault | 语言级忽略 + 行为测试双锚（E1 绿）——不可达 |
| `null`/畸形 handle、非函数 notifyDirty | V1 loud TypeError（captureSeamInput :354-379 逐字段 typeof 守卫，委托继承） |
| released/disposed handle 构造 | V2 loud `NamespaceRuntimeConstructionError(HANDLE_NOT_USABLE)`，所有权归调用方（既有测试锚定） |
| 深导入绕行 `@nomicore/namespace-runtime/src/internal.js` | exports 封装阻断（exports map 存在时无 `./src/*` 子路径即不可解析，Node/tsc bundler 同规则）——**exports map 反而收紧了边界，被审计 specifier 是唯一通道** |
| **[前瞻] AC5 审计正则盲区**（非阻塞，SA2 #1 同源，本轮 node 探针实证） | `import 'spec';` 裸副作用导入、`require('spec')`、经变量的间接 `import(var)` 三形态均不命中 importRe；walk 仅扫 `.ts/.tsx/.mts/.cts`（.js/.mjs/.cjs 不可见）。**当前暴露面为零**（全仓无 .js/.mjs/.cjs 生产文件——find 实证；internal subpath 消费方空集）→ 登记为切片 5/6 落地前审计加固项，不阻塞本 ticket |
| **[前瞻] SKIP_DIRS 按目录名豁免** | 任意名为 `test/tests/__tests__` 的目录被跳过——未来 `packages/namespace-registry/src/test/` 形态的生产目录会被误豁免（同上，切片 5/6 一并裁定） |

## 6. 错误处理链路 — ✅ 完整

无用户交互面；构造通道全部失败模式（TypeError / HANDLE_NOT_USABLE / 写槽稳定码族）以稳定 code/message 同步可见，AC4-⑤ 对 `RUNTIME_READ_DISABLED`/`RUNTIME_WRITE_DISABLED` 停接纳语义实测锚定（E1 绿）。

## 7. 架构评估 — ✅ 可行

纯委托 + 模块边界，零绕过、零 FIXME、零临时补丁；「消灭第二构造通道」的 ticket 目标以「同一份构造代码 + 单一可审计入口」结构性达成。无退回 SA1 信号。

## 8. 过度设计审查 — ✅ 精简

32 行 leaf（其中 24 行 JSDoc/注释）、单 return 语句、零守卫；配置改动恰两 diff；存量测试演进恰单 it；变更半径与 issue 面精确重合。

## 9. AC 达成判定

| AC | 判定 | 证据 |
|---|---|---|
| AC1 internal 仅导出一个 Registry factory | ✅ | E1 it#2 运行时键集恰一键 + type-guard it#1 |
| AC2 只收 handle + notifyDirty，无 compile/fault/testing seam | ✅ | 两参形类型判别（E1 TS 3 it）+ 哨兵行为双锚（spy 零调用/gate 零消费/fault 零效果） |
| AC3 主 entry 继续封闭 | ✅ | E2 前 3 it 零改动全绿 + @ts-expect-error 副锚 |
| AC4 Runtime 全部现有语义保持 | ✅ | E1 AC4 全链（构造即读→P0 队首真实编译→FIFO notify 严格按序→status 七键/十键→close 幂等/停接纳→跨实例落盘）；同一实现承载（纯委托） |
| AC5 仅 Registry 生产代码可消费 | ✅ | E1 AC5 三 it（防空扫 prodFiles>0、谓词自检含 internal.ts deny 例、消费方 ⊆ 白名单=空集）；前瞻盲区见 §5 |
| AC6 testing seam 不进任何 entry | ✅ | 键集无测试子路径 + internal 禁导探测（seam with / SeamInput / 工厂别名 / 运行态全体缺席） |
| AC7 全量门禁 | ✅（本地） | E3/E4/E5 全绿；Node 20/24 CI 双版本 → SA7/CI 动态确认 |

## 动态审核重点（交 SA7）

1. **CI Node 20/24 双版本运行**（P3 剩余面）：`pnpm install --frozen-lockfile` + `pnpm test` 在 matrix 两 Node 版本上复跑——本地仅当前 Node 验证了 exports subpath + 包自引用机制；建议从 `gh run view --log` 摘录 `runtime-registry-internal-seam.test.ts (8 tests)` 与 `runtime-registry-internal-type-guard.test-d.ts (3 tests)` 两行的触发证据（§1.4 的动态半环）。
2. **`pnpm generate --check` 等四附加 CI 门禁**（SA2 #5）：静态判定与本改动零交集（不触 domains/codegen/persistence/doc-runtime），以 CI 实跑结果闭环确认即可。
3. （前瞻，切片 5/6 前置，非本 ticket 验收项）AC5 审计正则加固：裸 import / require / 非 TS 扩展名三盲区——落地 Registry 前按 SA2 红灯思路 #1 扩展 `importRe` 与扩展名过滤。

## 结论

**Verdict: pass** —— SA3 实现与 SA1 设计零偏离，全部 7 条 AC 在静态与本地运行时证据下达成；无静默失败、无降级、无过度设计、无契约连锁风险。两条前瞻性审计加固项（AC5 正则盲区、SKIP_DIRS 目录名豁免）责任在切片 5/6，与本 ticket 验收无关。SA7 可进入动态验证（重点见上）。
