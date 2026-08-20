# SA7 动态验证报告 — 投影生成器 `@nomicore/vfsl-codegen`（Issue #26 / F2）

**Date**: 2026-08-20
**Verdict**: **pass**（SA4 pass 基础上动态复证全部命中；登记 3 项**新发现**非阻塞残留——均为「生成物编译干跑」暴露的 **G 票 #27 前移风险**（任务简报明示的预期风险类别），不构成 F2 AC 违约；另 2 项行为事实记录（EACCES）供总控定级）

- **验证对象**: commit `008e34c` + `9cd33d2` + `a23195e` + `fd9ebe7`（HEAD `79944b4` 之下业务终态；基点 `0be8c11`）
- **验证方法**: 全部探针在 `/tmp/sa7-work/` hermetic fixture + 临时 consumer 项目执行，**仓内零写入**（唯一仓内产物 = `.mabf-bg/sa7-baseline.log` 基线日志与本报告）；长任务（基线套件、CLI 探针集）均 `setsid nohup` 后台独立进程
- **环境**: node v24.13.0 / pnpm 10.28.2 / tsx 4.x（node_modules/.bin）/ vitest 3.2.7 / tsc 5.9（仓内 typescript）
- **日志与产物**: `/tmp/sa7-work/probe-cli.log`（CLI 探针全集）、`.mabf-bg/sa7-baseline.log`（基线三连）、`/tmp/sa7-work/{f1,f2,f2b,f2c,f3}/`（tsc 干跑变体）、`/tmp/sa7-work/gen/mapping.generated.ts`（真实生成物样本）

---

## Step 0 — SA4 verdict 校对

`wiki/raw/task_vfsl-codegen_sa4_review.md` L4: `**Verdict**: **pass**` → **进入动态验证**（不上发不下发约束遵守）。

## Step 1 — SA6 验收测试（红灯→应转绿）现状

`pnpm test`（--typecheck）输出实证四个 SA6 锚定文件**全部绿灯**：

```text
 ✓  TS  packages/vfsl-codegen/test/generate-discriminated-narrow.test-d.ts (6 tests)
 ✓ packages/vfsl-codegen/test/generate-cli-check.test.ts (3 tests) 2139ms
 ✓ packages/vfsl-codegen/test/generate-mapping-table.test.ts (13 tests)
 ✓ packages/vfsl-codegen/test/generate-discriminated-emission.test.ts (10 tests)
```

🟢 GREEN → 进入清单验证。

---

## 一、验证清单逐项证据（简报九项）

### 1. §9.4 watch-item 1 — CLI 启动耗时（SA2 #8b）✅ 余量充足

**单次 `pnpm generate --domains <hermetic-fx>` 实测**（6 次串行，含首次冷启动；`date +%s%N` 计时）：

| 轮次 | 1（冷） | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| 耗时 | 413ms | 401ms | 411ms | 417ms | 412ms | 417ms |

**成本分解**：tsx 直驱 `cli.ts`（无 pnpm 壳）= 156/156/160ms；pnpm 空载基线（`pnpm --version`）= 228–296ms；node 进程空转 = 18ms → **主要成本 = pnpm 壳 ≈ 240ms + tsx/vfsl 转译加载 ≈ 150ms**，CLI 自身逻辑微不足道（模块级零重活成立）。

**vitest 5s/it 余量评估（套件内活体证据，非仅外推）**——408 全绿跑中 `generate-cli-check.test.ts` 三 it 实测：

| it | 实测 | 默认超时 | 余量 |
|---|---|---|---|
| `pnpm generate` 存在性（1 spawn） | 431ms | 5000ms | 11.6× |
| generate→--check 新鲜（2 spawn 串行） | 845ms | 5000ms | 5.9× |
| 源漂移→--check 非零（2 spawn 串行） | 861ms | 5000ms | 5.8× |

**结论**：最坏 it（双 spawn 串行 861ms）对 5s 默认超时有 **≈5.8× 余量**——CI matrix 慢 runner 需退化 5.8 倍以上才会触超时。无需 `testTimeout` 调整（设计 §9.4-1 的处置边界：基础设施可调而未需调；不得加缓存——未涉及）。

### 2. §9.4 watch-item 2 — `--allow-empty-domains` 阶段门双向 ✅

六组探针（`generate`/`--check` × 无 domains//空 domains/ × 无/有 flag），全部命中 §5.5：

| 探针 | 命令变体 | exit | 判定 |
|---|---|---|---|
| WI2a 无 domains/、无 flag | `generate --domains <fx>` | **2** | ✅ |
| WI2b 无 domains/、带 flag | `generate --allow-empty-domains …` | **0** | ✅ |
| WI2c 空 domains/ 目录、无 flag | `generate --domains <fx>` | **2** | ✅ |
| WI2d 空 domains/ 目录、带 flag | `generate --allow-empty-domains …` | **0** | ✅ |
| WI2e `--check` 无 flag | `generate --check --domains <fx>` | **2** | ✅ |
| WI2f `--check` 带 flag | `generate --check --allow-empty-domains …` | **0** | ✅ |

无 flag 时 stderr 逐字（两成因说明均在场，§5.5 承诺兑现）：

```
vfsl-codegen: 零领域集：domains/ 不存在或为空——若 G 尚未落地属预期，请加 --allow-empty-domains；若非预期请检查 --domains 路径
```

### 3. §9.4 watch-item 3 — idBase 约定诊断 ✅

hermetic fixture：目录 `domains/foo/`、头部 `@id: bar@1`（idBase=bar 与目录名 foo 背离）→ **exit 2**，stderr 含规则本体全文（与设计 §5.3 模板逐字一致）：

```
vfsl-codegen: id base 必须等于领域目录名（domains/bar/generated.ts 才是生成位）：id 'bar@1' → base 'bar'，但目录 '/tmp/sa7-work/cli/idbase/domains/bar/' 不存在
```

### 4. §9.4 watch-item 4 — Record/联合 ROOT 限界 ✅

| fixture | exit | stderr 摘录 |
|---|---|---|
| WI4a `type ROOT = Record<Id, Entity>;` | **2** | `ROOT 形态不支持（F2 仅支持封闭 map 形：裸对象/YMap；得到 Record 形（动态键））——…由总控开后续票登记` |
| WI4b `type ROOT = \| { a: YLeaf<string> } \| { b: YLeaf<number> };` | **2** | `ROOT 形态不支持（…得到 联合形（2 个成员））——…` |

两形态均前缀「ROOT 形态不支持」（UnsupportedRootShapeError）+ 消息尾「由总控开后续票登记」（R3-3 ③ 同步落地）。形态检查先于引用走查的错误次序未受干扰。

### 5. §9.4 watch-item 5（重点）— ref→ROOT CLI 层兜底 ✅ + 异形联合 CLI 路径 ✅

**dispatch #21 裁决的 D CLI 半部，动态复证（SA4 P5 静态预验 → 本轮闭环）**：

| 探针 | fixture | exit | stderr 摘录 |
|---|---|---|---|
| WI5a 字段位（`generate`） | `type ROOT = YMap<{ a: YLeaf<string> }>; type Node = YMap<{ r: ROOT }>;` | **2** | `ROOT 不可被引用（F2 仅支持 ROOT 作入口根——顶层键 = ROOT 的字段；引用位 Node.r 抵达 ROOT）——被引用 ROOT 需协议层引用目标语义，由总控开后续票登记` |
| WI5d 同 fixture 经 `--check` | 同上 | **2** | 同上（两路径同一顶层 catch） |

**顺带探 UnsupportedUnionKindError 的 CLI 路径（双位点）**：

| 探针 | fixture | 位点 | exit | stderr 摘录 |
|---|---|---|---|---|
| WI5b | `u: A \| B`（A=map 别名, B=array 别名） | inline 段② 路径（008e34c） | **2** | `联合成员结构 kind 异形（F2 仅支持全员同形联合；得到 map \| array）——…` |
| WI5c | `type U = A \| B; u: U` | **kindOf 引用位**（9cd33d2 返修点） | **2** | 同上逐字 |

WI5c 命中即 **9cd33d2 返修（kindOfAlias union→unionKind 同形裁决）的 CLI 可达性实证**——SA2 R3-3 探针曾实锤的 `u: PathSchema<U,'map'>` 误标路径，如今在 CLI 端到端层响亮拒绝。

### 6. 生成物 tsc 干跑（SA2 R2.6 残留 3 / G 票前移风险项）⚠️ 核心通过 + 3 项新发现登记（见 §二）

`generateProjection` 对 mapping fixture（SA6 契约 fixture 逐字节复刻）的真实输出（1239B/31 行）写 `/tmp/sa7-work/gen/mapping.generated.ts`，经独立 consumer program（tsconfig：bundler 解析 + `paths` 指向仓内 protocol src + `types: []`）`tsc --noEmit`：

| 变体 | 程序构成 | 结果 |
|---|---|---|
| **F2 消费者态**（样板 test-d 同款 `import type { PathSchema } from '@nomicore/vfsl-protocol'` 置顶 + PathAt/PathKind/PathValue/判别联合窄化编译期断言 c1–c6） | 生成物 + 消费文件 | **exit 0 全绿** ✅ |
| F1 生成物**原样**（孤立 program） | 仅生成物 | **exit 2**：TS2304 ×N（段② `export type Entity/Meta` 引用 `PathSchema` 无 import）+ TS2664（augmentation 目标模块不在 program） |
| F2b 生成物原样 + 同 program 他文件 import 协议 | 生成物 + 消费文件 | **exit 2**：段② TS2304 ×6 仍在（模块作用域名解析不因 program 内他文件 import 而豁免） |

**F2 判定（本项主结论）**：mapping fixture 生成内容在标准消费者语境下**编译级全绿**——含 D1 下标段（`entityList→'0'`）、plain 终态、Record 键位下钻（`byId→someId`）、规则 0 按名引用（`leafRef→string`）、**判别联合 read 宽度**（`PathValue<PathAt<Map,['entityList','0']>>` = `{kind:'image';url:string} | {kind:'text';richBody:string;title:string}` 精确相等断言）——无别名碰撞、无畸形类型、D2 语义编译级成立。**但生成物自身缺 import 行 → 原样不可编译**（登记 N1，§二）。

### 7. EACCES 可达性（SA4 残留 R1 联动）📋 行为事实记录（不裁决）

非 root（uid 1000）下两组 hermetic 探针：

| 探针 | 构造 | 实测 |
|---|---|---|
| EACCES-1 | 先 `generate` 成功 → `chmod 000 domains/demo/generated.ts` → `generate --check` | **exit 1** + stderr `--check 失败 — 生成物缺失：<path>`（读错误被 `checkFreshness` catch 归并为缺失报告——**SA4 R1 静态结论的动态确认**：响亮非零不静默，但错误类别归并 exit 1 而非 §5.4 字面的硬错误 exit 2） |
| EACCES-2 | `chmod 000 domains/demo/schema.vfsl` → `generate` | **exit 2** + 结构化 stderr `vfsl-codegen: [EACCES] EACCES: permission denied, open '<path>'`（§5.4 硬错误行在 source.load 冒泡路径**兑现**） |

事实移交总控：R1 的「归并」面**确实可达且已实测**（exit 1 + 误导性「缺失」文案）；同一 CLI 的接缝读路径 EACCES 则正确走 exit 2 结构化。SA4 建议（catch 内仅 ENOENT 置 null、其余 rethrow，一行修复）可与其 G 票前任意返修同车——定级权在总控。

### 8. 全量基线复跑 ✅ 与总控基线逐字一致

后台独立进程三连（`.mabf-bg/sa7-baseline.log`）：

```text
pnpm test        → Test Files 24 passed (24) / Tests 408 passed (408) / Type Errors no errors，exit 0（23.31s）
pnpm typecheck   → tsc -p vfsl && tsc -p vfsl-protocol && tsc -p vfsl-codegen，exit 0（三包）
pnpm generate --check --allow-empty-domains → exit 0
```

与总控亲验基线（408/408、typecheck 三包、gen --check exit 0）**完全一致**。

### 9. vitest 触发证据（Hard Gate 14 配套）✅ 三包全部实际执行

本地全量跑的逐文件 `✓` 行摘录（`vitest run --typecheck`）：

| Workspace 包 | 触发结果 | log 摘录（抽样） |
|---|---|---|
| `vfsl`（17 runtime 文件） | ✓ 17/17 | `✓ packages/vfsl/test/validate-snapshot-sa7.test.ts (14 tests) 15233ms`、`✓ packages/vfsl/test/parse-vfsl-forbidden-matrix.test.ts (79 tests)`、`✓ packages/vfsl/test/domains-scaffold.test.ts (2 tests)` 等 |
| `vfsl-protocol`（1 runtime + 2 typecheck） | ✓ 3/3 | `✓ packages/vfsl-protocol/test/vfsl-protocol-empty-module.test.ts (1 test)`、`✓ TS packages/vfsl-protocol/test/vfsl-protocol-projection.test-d.ts (16 tests)`、`✓ TS …empty-fail-closed.test-d.ts (3 tests)` |
| `vfsl-codegen`（3 runtime + 1 typecheck） | ✓ 4/4 | `✓ packages/vfsl-codegen/test/generate-cli-check.test.ts (3 tests) 2139ms`、`✓ …generate-mapping-table.test.ts (13 tests)`、`✓ …generate-discriminated-emission.test.ts (10 tests)`、`✓ TS …generate-discriminated-narrow.test-d.ts (6 tests)` |

合计 21 runtime + 3 typecheck = **24 文件 / 408 测试，三包测试文件均实际执行且全绿**（`Test Files 24 passed (24)`）。

**CI 侧证据状态**：分支 `fix/issue-26-on-adr-vfsl-protocol` 未推远端（`git branch -r` 无此分支；纪律禁 push/建 PR）→ CI run 不存在，**本轮以本地执行为触发证据**；远端 CI 触发证据归 publish 管线（supervisor/check.sh）后补，SA7 不宣称 CI 已绿。workflow 静态面（SA4 已核 `ci.yml` regen-diff 步骤 + `pnpm test` 覆盖三包）+ 本轮本地动态面双证齐备，无 `vitest-package-not-triggered` 迹象。

---

## 二、新发现登记（非阻塞，全部属「G 票前移风险」类别——任务简报 item 6 明示的预期风险面）

> 三项均由**编译干跑探针**（item 6 的目的即暴露此类）动态实证；均不违反 F2 任何 AC（AC1–5 不含生成物孤立可编译性）与 SA6 契约断言（无一断言 import 行），且**当前仓内零 domains/ → 现有测试/CI 零破坏**（408 全绿佐证）。实施面全部落在 G 票 #27 的消费接线时刻。

### N1（MEDIUM·登记）生成物缺协议 import 行——消费者语境外不可编译

- **事实**：生成物段②（`export type Entity = { 'kind': PathSchema<'image','leaf'>; … }` 等别名声明）与增广体内引用 `PathSchema`，但**全文无任何 import**。孤立 program → TS2304 ×6+（段②）+ TS2664；program 内他文件 import 协议亦救不了段②（F2b 实证 TS2304 仍在——模块作用域名解析规则）。
- **对照**：样板 `vfsl-protocol-projection.test-d.ts` 自身 L42-43 有 `import type { PathSchema … } from '@nomicore/vfsl-protocol'`——设计 §3.1 L117「`declare module` 增广……与 test-d 增广同机制」的机制前提（文件自 import 协议）未在生成物复刻；设计 §3.9 冻结样板亦无 import → **实现与设计一致，缺口在设计层假设**。
- **后果与路由**：G 票将 `domains/*/generated.ts` 纳入任何 typecheck program 即红。处置二选一（总控定夺）：① 开后续票让生成器发射 `import type { PathSchema } from '@nomicore/vfsl-protocol';`（一行增量，走 SA1 契约→SA6 锚定→SA3 流程，SA7 不越权改发射器）；② G 票消费接线自带包装约定。**F2 内容本身类型学正确**（F2 消费者态 exit 0 + c1–c6 编译期断言全过）。

### N2（MINOR·登记）零别名域生成物退化为 script → `declare module` 变整体声明，遮蔽协议模块

- **事实**：仅含封闭 map ROOT、无任何别名的域（如 CLI 测试的 demo fixture），其生成物段②为空 → 文件无 top-level import/export → **是 script 不是 module**（设计 §3.1 L117「文件因 `export type` 成为 module」的假设在此形态不成立）→ 其 `declare module '@nomicore/vfsl-protocol'` 退化为**整体环境模块声明**而非增广。实测（f2c）：同 program 内该声明**遮蔽 paths 解析的真实协议模块**——消费文件 `import { PathAt }` 报 TS2305（has no exported member）+ 生成物自身 TS2304。
- **后果与路由**：G 票种植的域若恰无别名（最小域形态完全合法），将其 generated.ts 纳入 program 会**破坏同 program 内所有协议消费方**。N1 的处置①（发射 import 行）顺带治愈本项（文件成 module → 增广语义恢复）——两项同票同修的强理由。

### N3（MINOR·登记）域别名与协议导出名碰撞无守卫——生成物自碰撞不可编译

- **事实**：域内声明 `type PathSchema = YMap<{ x: YLeaf<string> }>;`（解析层合法——非保留标记名）→ 生成物段② `export type PathSchema = { 'x': PathSchema<string, 'leaf'> };`（体内 `PathSchema` 解析到正被声明的本地别名）→ TS2315「Type 'PathSchema' is not generic」+ 增广体 `PathSchema<PathSchema, 'map'>` TS2314——**编译期自碰撞**，发射器无保留名守卫、无响亮拒绝。
- **后果与路由**：G 票种植领域须避开 `@nomicore/vfsl-protocol` 导出名（PathSchema/VfslPathMap/PathAt/…）——G 票验收注记项；或后续票给 emitter 加保留名 loud 拒绝（与 N1 同流程）。与任务简报 item 6 点名的「别名碰撞」风险点**精确对应并已实证存在**。

### 行为事实（随附）：EACCES 类别归并可达性

见 §一·7——SA4 R1 的静态预判（checkFreshness 全吞 → exit 1「缺失」）与接缝路径的 exit 2 结构化均已实测复现。总控定级（保持 MINOR 顺手项 / 升格）。

---

## 三、结论

| 验证面 | 结果 |
|---|---|
| SA4 verdict 校对（Step 0） | pass → 进入 |
| SA6 验收测试现状（Step 1） | 🟢 4 文件全绿 |
| watch-item 1 启动耗时 | ✅ 最坏 it 861ms / 5000ms（5.8× 余量） |
| watch-item 2 阶段门双向 | ✅ 6/6 探针命中 |
| watch-item 3 idBase 诊断 | ✅ exit 2 + 规则本体 |
| watch-item 4 ROOT 形态限界 | ✅ Record/联合双形态 exit 2 + 前缀 |
| watch-item 5 ref→ROOT CLI 兜底（重点） | ✅ generate/--check 双路径 exit 2 +「ROOT 不可被引用」；异形联合 inline + kindOf 双位点 ✅ |
| 生成物 tsc 干跑 | ✅ 消费者态编译级全绿（含 D2 窄化断言）；⚠️ 登记 N1/N2/N3（G 前移风险，非 AC 违约） |
| EACCES 可达性 | 📋 两路径行为事实记录（归并 exit 1 / 结构化 exit 2） |
| 基线复跑 | ✅ 24 文件/408 测试 + typecheck 三包 + gen --check，与总控基线逐字一致 |
| vitest 触发证据 | ✅ 三包 24 文件实际执行（本地；CI 侧归 publish 管线后补） |

**verdict: pass** —— F2 契约与 AC 在真实运行链路全数兑现；三项新发现均为任务简报预判的 G 票前移风险类别（生成物消费接线时刻才显影），登记移交总控路由（建议与 N1 同票处置 N2，G 票验收注记 N3；EACCES R1 维持 SA4 顺手项定级或随车升格由总控定夺）。SA3 无需为本轮任何发现立即返修。

## 四、证据清单（可复现命令 → 结果）

| 命令（后台独立进程 / /tmp 沙箱） | 结果 |
|---|---|
| `pnpm test`（`--typecheck`） | exit 0；`Test Files 24 passed (24)` / `Tests 408 passed (408)` / `Type Errors no errors` |
| `pnpm typecheck` | exit 0（vfsl + vfsl-protocol + vfsl-codegen 三连 tsc） |
| `pnpm generate --check --allow-empty-domains` | exit 0 |
| `/tmp/sa7-work/probe-cli.sh`（WI1–WI5 + EACCES 共 16 组探针） | 全部命中（§一表；日志 probe-cli.log） |
| `tsx /tmp/sa7-work/p0-dump.ts`（mapping fixture → 真实生成物） | 1239B/31 行落盘 gen/mapping.generated.ts |
| `tsc -p` 于 `/tmp/sa7-work/f{1,2,2b,2c,3}/tsconfig.json` | f2 exit 0；f1/f2b/f2c/f3 exit 2（N1/N2/N3 实证） |
| 计时：`date +%s%N` 包 `pnpm generate`×6 / tsx 直驱×3 / `pnpm --version`×3 / `node -e`×2 | §一·1 表 |
| 完整日志 | `.mabf-bg/sa7-baseline.log`、`/tmp/sa7-work/probe-cli.log` |

## Spec / vitest 触发证据 (verdict 升级配套)

- E2E spec：N/A（本任务无 `*.spec.ts`，SA4 §三同判）。
- vitest：见 §一·9 表——三包全部触发且通过，`verdict: ✅ all-vitest-packages-triggered`（本地运行动态证据；CI run 证据待 publish 管线 push 后由总控/check.sh 补录，SA7 不越权宣称）。
