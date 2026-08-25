# SA7 动态验证报告 — issue #93 round 2（Phase 4：干净环境 + 双 Node 全量 + CI 本地对等）

- **Date**: 2026-08-25（round 2 Phase 4）
- **被验对象**: HEAD `0e31b8e`（交付链 526edc2 → 56d38c5 → 0e31b8e）
- **Verdict**: **pass**（双 Node 干净克隆全量 14/14 步 exit 0；92 文件 1118 用例双口径全绿；四探针全 OK；零环境阻塞）
- **验证环境**: 独立干净克隆（非本 worktree），本 worktree 零改动（见 §7）

---

## 0. Step 0 门禁——SA4 verdict 校验

- `wiki/raw/task_namespace-runtime-integration-acceptance-rev1_sa4_review.md` L6：`**Verdict**: **pass**`（无 MUST 级问题；3 项 LOW 观察记录不回流）。
- SA4 pass → SA7 正常进入动态验证；本报告 verdict 只在 SA4 pass 基础上独立裁定。

## 1. 验证环境（实测值）

| 项 | 实测值 |
|---|---|
| Node 24 口径 | **v24.13.0**（`/usr/local/bin/node`，系统默认） |
| Node 20 口径 | **v20.20.2**（`/home/wangjian/.n20/bin/node`，官方 dist 二进制目录前置 PATH；与 round 1 实测版本一致） |
| pnpm | **10.28.2**（`corepack pnpm`，按根 package.json `packageManager` 解析——与 CI `pnpm/action-setup@v4` 同版本） |
| corepack | 0.34.5（随 v24）/ 0.34.6（随 v20） |
| 干净克隆 | `git clone <worktree>` ×2 → `git checkout 0e31b8e`（detached，`git status --porcelain` 零脏）；目录 `/tmp/sa7-r2-n24`、`/tmp/sa7-r2-n20` |
| 全新装配 | 每克隆独立 `pnpm install --frozen-lockfile`（不复用任何既有 node_modules；pnpm store 温缓存，n24 "Done in 552ms"，node_modules 61 MB / 63 包） |
| 执行方式 | 双 leg 串行（避免 CPU 争抢干扰 T3.4 负载结论），全程 `setsid nohup` 独立进程后台跑，逐 step 记录 exit code |

## 2. 双 Node 全量验证矩阵（每 leg 14 步，全部独立进程）

| Step（命令） | n24 (v24.13.0) | n20 (v20.20.2) |
|---|---|---|
| `corepack pnpm --version` | exit 0（10.28.2） | exit 0（10.28.2） |
| `pnpm install --frozen-lockfile` | **exit 0** | **exit 0** |
| `pnpm typecheck`（七包 tsc 链） | **exit 0** | **exit 0** |
| `pnpm exec tsc -p tsconfig.typecheck.json --noEmit` | **exit 0** | **exit 0** |
| `pnpm test`（= `vitest run --typecheck`） | **exit 0 · Test Files 92 passed (92) · Tests 1118 passed (1118)** | **exit 0 · Test Files 92 passed (92) · Tests 1118 passed (1118)** |
| CI: persistence-contract 显式 run（`--typecheck --passWithNoTests=false`） | exit 0 · 1 文件 7 用例 | exit 0 · 1 文件 7 用例 |
| CI: domains-scaffold 显式 run（`--passWithNoTests=false`） | exit 0 · 1 文件 2 用例 | exit 0 · 1 文件 2 用例 |
| CI: materialize-root 显式 run（`--typecheck --passWithNoTests=false`） | exit 0 · 1 文件 59 用例 | exit 0 · 1 文件 59 用例 |
| CI: `pnpm generate --check` | **exit 0** | **exit 0** |
| 探针 a: production-assembly 单文件 run | exit 0 · 1 文件 2 用例 | exit 0 · 1 文件 2 用例 |
| 探针 a: schema-carrier-split 单文件 run | exit 0 · 1 文件 4 用例 | exit 0 · 1 文件 4 用例 |
| 探针 a: fullchain 单文件 run | exit 0 · 1 文件 7 用例 | exit 0 · 1 文件 7 用例 |
| 探针 b: T3.4 所在文件单文件 run | exit 0 · 1 文件 11 用例 | exit 0 · 1 文件 11 用例 |
| 探针 c+d: tsx 运行时探针脚本 | **exit 0 · PROBE_ALL_PASS** | **exit 0 · PROBE_ALL_PASS** |

- 双 leg 计 28 步，`EXIT=0` 28/28，非零 0（`grep -c 'EXIT=0$'` 全对账）。
- 全量 `pnpm test` Duration：n24 67.40s / n20 67.84s（transform+collect+tests+typecheck 全真实执行，含 `--typecheck` 的 9 个 `.test-d.ts` 类型面）。
- 完整日志：`/tmp/sa7-r2-n24.log`、`/tmp/sa7-r2-n20.log`（leg 脚本 `/tmp/sa7-r2-leg.sh`、总控 `/tmp/sa7-r2-run.sh`）。

## 3. CI 本地对等复现（.github/workflows/ci.yml，matrix node: [20, 24]）

CI job `test`（ubuntu-latest）逐步本地复现，两口径 exit code 全 0：

| ci.yml 步骤（行号） | 本地复现命令 | n24 | n20 |
|---|---|---|---|
| Install dependencies (L33) | `pnpm install --frozen-lockfile` | 0 | 0 |
| Typecheck (L36) | `pnpm typecheck` | 0 | 0 |
| Test (L39) | `pnpm test` | 0（92/1118） | 0（92/1118） |
| Persistence contracts (L44) | `pnpm exec vitest run packages/persistence/test/persistence-contract.test.ts --typecheck --passWithNoTests=false` | 0（7） | 0（7） |
| Domain scaffolds check (L49) | `pnpm exec vitest run packages/vfsl/test/domains-scaffold.test.ts --passWithNoTests=false` | 0（2） | 0（2） |
| Materialize root tests (L55) | `pnpm exec vitest run packages/doc-runtime/test/materialize-root.test.ts --typecheck --passWithNoTests=false` | 0（59） | 0（59） |
| Generated projection freshness (L62) | `pnpm generate --check` | 0 | 0 |

pnpm 版本对齐：CI 由 `pnpm/action-setup@v4` 读 `packageManager: pnpm@10.28.2`；本地经 corepack 得同版本 10.28.2。**CI 全链在本地双 Node 口径下无一对等缺口。**

## 4. 重点动态探针（干净克隆内、双 Node）

### 4a. 新验收面抽查——逐文件真实执行全绿

| 文件 | 断言面 | n24 | n20 |
|---|---|---|---|
| `runtime-acceptance-production-assembly.test.ts` | D-5 生产工厂全链 ×2（MemoryPersistence 全链 + **FilePersistence 真实磁盘 + crash-restart** + close 停接纳） | 2/2 ✓（229ms） | 2/2 ✓（229ms） |
| `runtime-schema-carrier-split.test.ts` | D-4 SCHEMA 载体**异型注入** ≠ 缺席（public getSchemaEnvelope 行为面） | 4/4 ✓ | 4/4 ✓ |
| `runtime-acceptance-fullchain.test.ts` | AC1 Memory / AC1 File / AC5 committed fatal + **U-1..U-4**（pre-commit × Memory/File、committed × File 经生产工厂、P0 期 compile throw） | 7/7 ✓（563ms） | 7/7 ✓（548ms） |

verbose reporter 复核（双 Node 各一次，13 用例全 ✓）：carrier-split 4 条 D-4 行、production-assembly「MemoryPersistence 全链」+「FilePersistence 全链」两行、fullchain「AC1 Memory/File」「AC5 committed」「D-6 pre-commit fatal 真实持久化全链」×4（=U-1..U-4）逐条出现。n20 复核显式证明运行时 Node：`env node=v20.20.2`、`pnpm-exec node=v20.20.2`。

### 4b. T3.4 负载稳健性复测（56d38c5 修复在干净环境双 Node 下仍稳）

T3.4 用例：`runtime-replace-schema-sa7-dynamic.test.ts` 内「深 doc × keep-root → E 层吸收」（DEEP=6_000，两相触发：extract 3× / clear 2.7× 边际）。vitest 单测超时阈 60s（修复前 20_000 深度实测 60308ms 超时）：

| 场景 | n24 | n20 | 60s 阈余量 |
|---|---|---|---|
| **全量并行跑**（92 文件满载下）T3.4 单测耗时 | **6687ms ✓** | **6596ms ✓** | ~9× |
| 单文件 run T3.4 单测耗时 | 2878ms ✓ | 2615ms ✓ | ~21× |

全量并行（tests 150.18s/149.37s 满载）与单文件两场景、双 Node 四组合均无超时——6_000 重标定在干净环境成立。

### 4c. 公共面运行时探测（与 T1.1 独立互证）

干净克隆 `pnpm exec tsx` 真实 import 包入口 `src/index.ts`：

```
PROBE_C entry value-export keys = ["RuntimeWriteFatalError"]
PROBE OK   PROBE_C keys 恰 [RuntimeWriteFatalError] :: RuntimeWriteFatalError
PROBE OK   PROBE_C RuntimeWriteFatalError 为 class 值（function）
```

（n24/n20 输出逐字一致）——运行时值导出键集**恰一键**，与 T1.1 静态审计独立互证成立。

### 4d. close 停接纳行为探测（与 T2.x 独立互证）

生产工厂 `createNamespaceRuntime(handle, notifyDirty=saveDoc 绑定)` + 真实 MemoryPersistence 构造 → `await close()` →（双 Node 输出一致）：

```
PROBE OK   PROBE_D 构造后 schema.state=ready :: ready
PROBE OK   PROBE_D ready 期 getSchemaEnvelope / getActiveSchema / getMetadata 可用
PROBE OK   PROBE_D close 后 lifecycle=closed
PROBE OK   PROBE_D getSchemaEnvelope 同步 throw（非 Promise）+ code=RUNTIME_READ_DISABLED
            message: "RUNTIME_READ_DISABLED: getSchemaEnvelope 已停接纳——Runtime lifecycle 为 closed（close 已停止接纳公共数据投影读取）…"
PROBE OK   PROBE_D getMetadata    同步 throw + code=RUNTIME_READ_DISABLED + message 含 getter 名
PROBE OK   PROBE_D getActiveSchema 同步 throw + code=RUNTIME_READ_DISABLED + message 含 getter 名
PROBE OK   PROBE_D close 后 getStatus 可用（closed + schema 摘要）
PROBE OK   PROBE_D close 后 read() 非抛 union 分支 ok:false + RUNTIME_READ_DISABLED
PROBE_ALL_PASS
```

三 getter 全部**同步 throw**（非 Promise）、code/message 双闭集插值正确、getStatus/read() 观测面保留——D-2 契约行为面独立成立。

## 5. HG#14 vitest 触发证据（真实执行日志摘录）

全量 `pnpm test`（vitest run --typecheck，非 TTY 全量列表）中的目标文件行（两 leg 原文）：

| 文件 | n24（全量套件内） | n20（全量套件内） |
|---|---|---|
| runtime-acceptance-fullchain.test.ts | `✓ …fullchain.test.ts (7 tests) 716ms` | `✓ …fullchain.test.ts (7 tests) 634ms` |
| runtime-replace-schema-sa7-dynamic.test.ts | `✓ …runtime-replace-schema-sa7-dynamic.test.ts (11 tests) 6914ms` | `✓ …(11 tests) 6845ms` |
| runtime-acceptance-production-assembly.test.ts | `✓ …production-assembly.test.ts (2 tests) 265ms` | `✓ …(2 tests) 269ms` |
| runtime-schema-carrier-split.test.ts | `✓ …schema-carrier-split.test.ts (4 tests) 47ms` | `✓ …(4 tests) 28ms` |
| 套件总计 | `Test Files 92 passed (92)` / `Tests 1118 passed (1118)` | 同左 |

显式单文件 run（CI 显式步骤同款形态）双 Node 均出现 `Test Files 1 passed (1)` 且无 skip/未收集。**verdict: ✅ all-vitest-targets-triggered（触发且全绿，零 skip）**。

## 6. 环境差异观察（均不构成阻塞）

1. 系统 Node 只有 v24.13.0（/usr/local）与 v18.19.1（/usr，不可用）；Node 20 取 round 1 遗留官方安装 `~/.n20`（v20.20.2）。CI setup-node 在 ubuntu-latest 会解析 20.x/24.x 最新 minor——本机两版本与 round 1 实测一致，结论可迁移。
2. pnpm 10 默认忽略依赖 build script：`Ignored build scripts: esbuild@0.28.2`——与 CI 同栈同行为（pnpm/action-setup@4 + 10.28.2），esbuild 二进制经 optional deps 就位，全量测试无影响。
3. pnpm store 温缓存使 `install --frozen-lockfile` 极快（552ms）——语义与 CI `cache: pnpm` 一致，不影响"全新 node_modules"事实（克隆初始零 node_modules，61 MB 装配产物）。
4. 双 leg 全部汇总数字逐项一致（92/1118；各显式步骤用例数相同；探针输出逐字一致）——未观察到任何 Node 版本敏感或非确定性行为。
5. 总控亲验（worktree 内 `.mabf-bg/verify-rev1b.log`）与本次干净克隆双 Node 结果完全一致——无"仅本机 node_modules 可绿"的隐性依赖。

## 7. 纪律声明

- **本 worktree 零改动**：验证全程只读；`git status` 仅含 MABF Host 预存三项（REPORT.md / dispatch.md / sa4_review.md），与本报告（本文件）外无任何新增或修改。
- **临时脚本已清理**：探针脚本 `.sa7-probe.mts` 曾置于干净克隆 `packages/namespace-runtime/`（验证后 `rm`，两克隆 `git status --porcelain` 回到零脏）；克隆与日志位于 /tmp（`/tmp/sa7-r2-n24`、`/tmp/sa7-r2-n20`、`/tmp/sa7-r2-{n24,n20,leg,run,probe}.*`），不属仓库。
- 未 push、未建 PR、未宣称远端 CI 已绿——CI 为**本地对等复现**（§3）。

## 8. 结论

**verdict: pass** —— 0e31b8e 在干净克隆、Node v24.13.0 与 v20.20.2 双口径下：全量 92 文件 1118 用例全绿、typecheck 七包 + typecheck.json 均 exit 0、CI 七步命令链本地对等全 0、四个重点探针（生产装配全链含真实 FilePersistence 磁盘与 crash-restart、异型载体、U-1..U-4、公共面值导出键集、close 停接纳）全部与契约一致，T3.4 负载修复在满载并行下仍有 ~9× 超时余量。无失败、无环境阻塞。
