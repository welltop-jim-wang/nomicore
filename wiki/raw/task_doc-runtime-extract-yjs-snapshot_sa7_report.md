# SA7 动态验证报告 — @nomicore/doc-runtime `extractYjsSnapshot` 活链路（Phase 4）

**Date**: 2026-08-22
**Verdict**: **pass**
**被验对象**: commit 79319a4（F-1 修复后基线，分支头 e71eb5b；51 files / 709 tests 全绿基线由本轮独立复跑确认）
**验证环境**: 宿主 Node v24.13.0 / pnpm 10.28.2 / vitest 3.2.7 / yjs 13.6.32；Node 20 复验 docker `node:20-slim` v20.20.2（本地镜像）
**验证方式**: 全新动态链路——SA6 四测试文件实跑（Node 24 + Node 20 双运行时）、全量 `pnpm test` / 根 `pnpm typecheck` 独立复跑、23 项 tsx 探针驱动真实实现公共接缝（`packages/doc-runtime/src/index.ts` → `extractYjsSnapshot`）；探针脚本临时落位跑毕即删，worktree 零残留（`git status` 清洁）。

---

## Step 0：校对 SA4 verdict

```
[SA7 Step 0 结论]
SA4 verdict: pass（R2，2026-08-22 —— R1 reject 的 F-1 已由修复回流 79319a4 + 设计 R2.2 + SA6 回归锚闭合）
操作: 进 Step 1
```

## Step 1：SA6 红灯测试实跑（第二关）

命令（独立进程，setsid nohup 模式；vitest 单测无 TCP 端口占用，`fuser` 端口释放不适用）：

```bash
$ pnpm exec vitest run packages/doc-runtime/test
 ✓ packages/doc-runtime/test/extract-record-keyspace.test.ts (2 tests) 12ms
 ✓ packages/doc-runtime/test/extract-plain-domain.test.ts (9 tests) 24ms
 ✓ packages/doc-runtime/test/extract-yjs-snapshot.test.ts (21 tests) 29ms
 ✓ packages/doc-runtime/test/extract-union-trial.test.ts (8 tests) 14ms
 Test Files  4 passed (4) / Tests  40 passed (40) / Type Errors no errors / EXIT=0
```

```
[SA7 Step 1 结论]
SA6 红灯: 🟢 GREEN（4 files / 40 tests / EXIT=0）
操作: 进入 Step 2
```

## Step 2：SA4「动态审核重点」清单逐条验证（R2 末更新版：第 1 项已闭合免做，第 2–5 项为本轮任务）

> 探针驱动真实实现（非 stub）：fixture 与冻结测试同源（vfs3.assets 全形态 schema + buildFullDoc），经 `packages/doc-runtime/src/index.js` 公共入口调用。全部探针输出见附录 A（PASS=23 / FAIL=0，EXIT=0）。

### 第 1 项（F-1 修复产物）——SA4 R2 已代验闭合，SA7 顺带复核

`extract-record-keyspace.test.ts`（2 用例）在本轮两趟实跑（Node 24 与 Node 20，见「vitest 触发证据」段）均绿——F-1 修复产物 own 键保留 + JSON 往返 + 原型未劫持在双运行时下复证，无回归。

### 第 2 项：解耦与跨端组合——✅ 8 探针全 PASS

| 探针 | 验证面 | 实测结果（verbatim 摘录） |
|---|---|---|
| 2a-1 | **INV-8**：同 doc 两次提取逐字节相同 | `PASS :: len=441/441 equal=true`（全形态 fixture，JSON.stringify 逐字节相同） |
| 2a-2 | Record 键插入序 + 覆写不换位（P7 经提取器复锚） | `keys=["b","a","c"] twice-equal=true` |
| 2b-1 | **跨端组合**：`encodeStateAsUpdate → applyUpdate` 后远端 doc 提取 | `local=true remote=true byte-equal=true`——远端快照与本地逐字节相同（含 XML `toString` 跨端确定） |
| 2b-2 | INV-8 跨端成立（远端 doc 两次提取） | `equal=true` |
| 2b-3 | **E2 提取级**：本地 Date → 真 issue | `actual=non-plain object path=["dt"]`（非 E100/internal） |
| 2b-4 | E2 提取级：跨端退化 plain `{}` → 远端 ok:true | `remote ok=true dt={}`（诚实边界——对端存储的确实是 plain {}） |
| 2b-5 | **E1 提取级**：跨端 bigint → 真 issue | `actual=bigint expected=plain value`（非 internal；与补充测试 extract-plain-domain E1 用例互证） |
| 2c-1~8 | **并发观察者在场时的遍历期只读性**（P4 只探过惰性创建零 update，此处探遍历期全量只读） | 见下 |

2c 组细节（六类深度观察者 ROOT/assets/img1/tags/xml/keywords + doc 级 update/beforeTransaction/afterTransaction/destroy 全部在场，随后执行提取）：

```
2c-1 提取成功（观察者在场不影响结果）        :: ok=true
2c-2 零 update 事件                          :: update events=0
2c-3 零事务                                  :: before=0 after=0
2c-4 零深度观察者回调（六观察点）             :: deep observer fires=0
2c-5 state vector 不变                       :: sv equal=true
2c-6 live doc toJSON 不变                    :: toJSON equal=true len=441/441
2c-7 对照组：一次写入触发 update=1 after=1 deep=1（证明上面的零是只读性、非观察者失效）
2c-8 P4 复锚：缺席 ROOT 提取 → ok:true {} 且 updates=0
```

**结论**：提取遍历期对 live doc 完全只读（零 update / 零事务 / 零观察者回调 / 状态向量与 toJSON 逐位不变），且观察者机制经对照组证明有效——「并发观察者在场时的只读性」成立；跨端组合（E1/E2 + 全形态快照逐字节一致）成立。

### 第 3 项：大文档性能面（D11 无预算论证的实测抽样）——✅ 4 探针全 PASS

**3a. vfs3.assets 形 Record 大文档**（`Record<string, YMap<{v leaf, tags YArray, audit YMap}>>`，每键 Y.Map×2 + Y.Array×1）：

```
N= 2000  median=5.5ms   (runs: 9.3, 5.5, 9.0, 3.4, 4.1)
N= 4000  median=8.8ms   (runs: 10.6, 13.7, 6.7, 8.8, 6.3)
N= 8000  median=21.0ms  (runs: 23.9, 30.4, 14.7, 21.0, 18.6)
→ 翻倍时延比 4k/2k=1.60、8k/4k=2.38；每键均摊 2k=0.0028ms、8k=0.0026ms（均摊随 N 微降）
```

**3b. union 全软拒最坏面**（三成员封闭联合，live 每键空 Y.Map → 三成员全缺必填全软拒 → B6 出口 3 回退成员 0 提交；fail-fast 约束下无可短路的最大试验面）：

```
N= 2000  median=2.4ms  / N= 4000  median=2.4ms  / N= 8000  median=4.6ms
→ 翻倍时延比 4k/2k=1.00、8k/4k=1.88
→ 语义锚：全软拒 → ok:true 出口 3 快照 {"assets":{"only":{}}}（B6 契约实测复证）
```

**结论**：数千 Record 键（8k）下主遍历与 union 试验最坏面均无超线性路径（时延比 ≤ 2.4、每键均摊不升），D11「真实 schema 下成本与文档规模线性同阶」在实测面成立。绝对量级：8k 键全形态 21ms——远低于任何交互预算。

### 第 4 项：Node 20 矩阵——✅ 本地 Node 20 真实运行时复验全绿；CI run log 摘录环境阻塞（见下节）

宿主无 Node 20（仅 24.13.0 / 25.6.0 / 18.19.1），改用本地已有 docker 镜像 `node:20-slim`（v20.20.2）挂载 worktree 直跑同一 vitest 入口：

```bash
$ docker run --rm --user $(id -u):$(id -g) -v $PWD:/w -w /w -e HOME=/tmp \
    node:20-slim node node_modules/vitest/dist/cli.js run packages/doc-runtime/test
 ✓ packages/doc-runtime/test/extract-union-trial.test.ts (8 tests) 17ms
 ✓ packages/doc-runtime/test/extract-plain-domain.test.ts (9 tests) 22ms
 ✓ packages/doc-runtime/test/extract-yjs-snapshot.test.ts (21 tests) 32ms
 ✓ packages/doc-runtime/test/extract-record-keyspace.test.ts (2 tests) 8ms
 Test Files  4 passed (4) / Tests  40 passed (40) / Type Errors no errors / DOCKER_EXIT=0
```

40/40 用例在真 Node 20 下全绿——yjs 13.6.32 的载体判定（instanceof 矩阵/Symbol.hasInstance 无关路径）与提取行为在 Node 20 运行时与 Node 24 一致（同一套断言两运行时均过）。**CI run log 摘录子项为环境阻塞**，详见下节登记。

### 第 5 项：B17 E100 message 可排障性——✅ 4 探针全 PASS

```
5-1 leaf 位 throwing getter → ok:false 单 issue                 :: ok=false issues=1
5-2 message 含 DOCRT-E100 码 + 原异常文案                        :: message="DOCRT-E100: 内部错误（意外异常）: sa7-boom-leaf"
5-3 plain 数组内嵌 throwing getter → E100                        :: message="DOCRT-E100: 内部错误（意外异常）: sa7-boom-nested"
5-4 深层 throwing getter（嵌套两层）→ E100                       :: message="DOCRT-E100: 内部错误（意外异常）: sa7-boom-deep"
```

**结论**：B17「维持 E100 归类」的裁量面动态成立——不外抛、单条结构化 issue、message 同时携带错误码与原异常文案（三个注入位含深层嵌套均可定位原异常文本），可排障性达标。

## Step 3：E2E spec 触发证据

**N/A** —— 本任务无 `*.spec.ts`（SA4 §1.3 同判；SA1 设计文件清单仅含 `*.test.ts`）。

## vitest 触发证据（硬门禁段落 · 2026-06-15 立法）

### 测试文件清单（SA1 design 全部 `*.test.ts` → 同一 workspace package `packages/doc-runtime`）

| 测试文件 | 用例数 | 来源 |
|---|---|---|
| `packages/doc-runtime/test/extract-yjs-snapshot.test.ts` | 21 | SA6 Phase 1 冻结 |
| `packages/doc-runtime/test/extract-plain-domain.test.ts` | 9 | SA6 R2 增补 |
| `packages/doc-runtime/test/extract-union-trial.test.ts` | 8 | SA6 R2 增补 |
| `packages/doc-runtime/test/extract-record-keyspace.test.ts` | 2 | SA6 R2.2 F-1 回归锚 |
| **合计** | **40** | 4 files |

触发机制（静态依据，SA4 §1.4 已核，本轮引用）：根 `vitest.config.ts` include `packages/*/test/**/*.test.ts`（无 --filter 排除）；CI `Test` step = `pnpm test`（ci.yml）；根 `package.json` `typecheck` 串联第 6 项 `tsc -p packages/doc-runtime/tsconfig.json`。

### 实跑统计（本轮，动态证据）

| 运行 | 命令 | 结果 |
|---|---|---|
| 全仓（Node 24 宿主） | `pnpm test` | `Test Files 51 passed (51)` / `Tests 709 passed (709)` / `Type Errors no errors` / **EXIT=0**（Duration 42.97s）——四文件逐一出现：`✓ extract-yjs-snapshot (21)` / `✓ extract-plain-domain (9)` / `✓ extract-union-trial (8)` / `✓ extract-record-keyspace (2)` |
| 单包（Node 24 宿主） | `pnpm exec vitest run packages/doc-runtime/test` | `4 passed (4)` / `40 passed (40)` / **EXIT=0**（Step 1 原文） |
| 单包（**Node 20.20.2** docker） | 见第 4 项命令 | `4 passed (4)` / `40 passed (40)` / **DOCKER_EXIT=0** |
| typecheck 链 | `pnpm typecheck` | 六包串联（vfsl → vfsl-protocol → vfsl-codegen → persistence → dsh-persistence → **doc-runtime**）/ **EXIT=0** |

### CI Run 摘录——⚠ 环境阻塞登记（非 spec/vitest-not-triggered）

- 本分支 `fix/issue-73-on-docs-doc-runtime-validation` **未推送**（`git status -sb`：ahead 8，跟踪 origin/docs/doc-runtime-validation）→ GitHub 无本分支任何 CI run（`gh run list --branch fix/issue-73-on-docs-doc-runtime-validation` 空；gh 已登录、其他分支 run 正常可见，最近一次 `docs/doc-runtime-validation` run 为 doc-runtime 包存在之前）。
- SA7 职责边界不含 push/建 PR，故 **CI run log 中 doc-runtime 四文件的执行摘录本轮无法产出**——这是环境阻塞，不是「workflow 未覆盖」（静态覆盖 SA4 §1.4 已过；本地动态触发与 Node 20 复跑已实证）。
- **移交总控**：push 后按 SKILL Step 4 以 `gh run view <run-id> --log` 摘录 node 20/24 两 matrix 项下 `Test` step 的 `Test Files 51 passed` 与四文件行即可收口（预期与上表一致）。

**verdict**: ✅ all-vitest-packages-triggered（本地双运行时动态实证：doc-runtime 四文件全部被 vitest 拾取并执行，40/40 全绿；CI 层摘录待推送后补，不构成本轮 FAIL 因素）

---

## 补充测试与生产代码纪律说明

- **未新增常驻测试文件**：清单第 2/3/5 项的验证面为一次性动态性质（时序只读性、性能抽样、CI 证据），以临时 tsx 探针完成（跑毕即删，`git status` 零残留）；设计 §11 ALLOW LIST 对 `packages/doc-runtime/test/` 实行 [SA6 owned] 管辖，SA7 不越权落新文件。如总控希望将「遍历期只读性（2c）」与「INV-8 两次提取逐字节相同（2a）」固化为常驻回归锚，建议走 SA6 增补流程扩展 §11（两探针断言均为公共接缝可观测输出，直接可锚）。
- **生产代码零改动**：全程仅新增探针临时文件 + 本报告；`packages/doc-runtime/src/` 未触碰。

## 结论

1. SA6 四测试文件 40 用例：Node 24 与 Node 20 双运行时全绿；全仓 51 files / 709 tests、六包 typecheck 独立复跑 EXIT=0——与总控亲验基线一致，零回归。
2. SA4 移交的第 2–5 项动态审核重点全部实证闭合：跨端组合 + INV-8 + 遍历期只读性（8 探针）、大文档性能面线性同阶（4 探针，8k 键 21ms）、Node 20 复验全绿（CI 摘录阻塞已登记移交）、B17 E100 message 可排障（4 探针）。
3. 无新增 fail 级发现；SA4 R1 的 F-1–F-5 均无复发迹象（F-1 经回归锚双运行时复证闭合）。

**Verdict: pass** —— 唯一未收口项为 CI run log 摘录（环境阻塞：分支未推送，移交总控 push 后按上节步骤补摘录，不影响本轮裁决）。

---

## 附录 A：探针输出全文（tsx 驱动真实实现，2026-08-22，Node 24.13.0 / yjs 13.6.32）

```
$ pnpm exec tsx <临时探针文件>（fixture 与冻结测试同源 vfs3.assets；探针跑毕已删）
=== [SA7] Node v24.13.0 | yjs 13.6.32 ===

## 2a. INV-8 同 doc 两次提取逐字节相同（含 Record 键插入序/覆写不换位 P7 复锚）
PASS 2a-1 fixture 两次提取 ok 且 JSON 逐字节相同 :: len=441/441 equal=true
PASS 2a-2 Record 键插入序稳定 + 覆写不换位 :: keys=["b","a","c"] twice-equal=true

## 2b. 跨端组合：encodeStateAsUpdate → applyUpdate → 远端 doc 提取（E1/E2 提取级复锚）
PASS 2b-1 远端提取 ok 且与本地快照 JSON 逐字节相同（XML toString 跨端确定） :: local=true remote=true byte-equal=true
PASS 2b-2 远端 doc 两次提取逐字节相同（INV-8 跨端成立） :: equal=true
PASS 2b-3 E2 提取级：本地 Date → 真 issue（actual non-plain object） :: actual=non-plain object path=["dt"]
PASS 2b-4 E2 提取级：跨端退化 plain {} → 远端 ok:true 快照 {dt:{}}（诚实边界） :: remote ok=true dt={}
PASS 2b-5 E1 提取级：跨端 bigint → 真 issue actual bigint 非 internal :: actual=bigint expected=plain value

## 2c. 并发观察者在场时的遍历期只读性（P4 只探惰性创建；此处探遍历期全量只读）
PASS 2c-1 提取成功（观察者在场不影响结果） :: ok=true
PASS 2c-2 零 update 事件 :: update events=0
PASS 2c-3 零事务（beforeTransaction/afterTransaction 均零） :: before=0 after=0
PASS 2c-4 零深度观察者回调（ROOT/assets/img1/tags/xml/keywords 六观察点） :: deep observer fires=0
PASS 2c-5 state vector 不变 :: sv equal=true
PASS 2c-6 live doc toJSON 不变 :: toJSON equal=true len=441/441
PASS 2c-7 对照组：写入触发 update/事务/深度观察者（观察者机制有效） :: update=1 after=1 deep=1
PASS 2c-8 P4 复锚：缺席 ROOT 提取 → ok:true {} 且零 update 事件 :: ok=true snapshot={} updates=0

## 3a. vfs3.assets 形 Record 数千键：时延抽样（Record<string, YMap{v leaf, tags Y.Array, audit Y.Map}>）
  N= 2000  median=5.5ms  (runs: 9.3, 5.5, 9.0, 3.4, 4.1)
  N= 4000  median=8.8ms  (runs: 10.6, 13.7, 6.7, 8.8, 6.3)
  N= 8000  median=21.0ms  (runs: 23.9, 30.4, 14.7, 21.0, 18.6)
PASS 3a-1 无超线性路径（两次翻倍的时延比均 < 2.6） :: ratio 4k/2k=1.60 8k/4k=2.38
PASS 3a-2 每键均摊时延不随 N 增长（8k 均摊 ≤ 2k 均摊 × 1.5） :: per-key 2k=0.0028ms 8k=0.0026ms

## 3b. union 全软拒最坏面（fail-fast 约束下：三成员 map 试验全软拒 → 出口 3 回退成员 0）
  N= 2000  median=2.4ms  (runs: 2.7, 2.4, 1.9, 1.9, 7.4)
  N= 4000  median=2.4ms  (runs: 2.6, 2.5, 2.4, 2.4, 2.4)
  N= 8000  median=4.6ms  (runs: 4.9, 4.6, 4.6, 8.2, 4.5)
PASS 3b-1 语义锚：全软拒 → ok:true 出口 3 快照 {assets:{only:{}}} :: snapshot={"assets":{"only":{}}}
PASS 3b-2 union 最坏面无超线性（两次翻倍时延比均 < 2.6） :: ratio 4k/2k=1.00 8k/4k=1.88

## 5. B17：plain 对象 throwing getter → E100 结构化返回，message 含原异常文案
PASS 5-1 leaf 位 throwing getter → ok:false 单 issue :: ok=false issues=1
PASS 5-2 message 含 DOCRT-E100 码 + 原异常文案 sa7-boom-leaf（可排障） :: message="DOCRT-E100: 内部错误（意外异常）: sa7-boom-leaf"
PASS 5-3 plain 数组内嵌 throwing getter → E100 且 message 含 sa7-boom-nested :: message="DOCRT-E100: 内部错误（意外异常）: sa7-boom-nested"
PASS 5-4 深层 throwing getter → E100 且 message 含 sa7-boom-deep :: message="DOCRT-E100: 内部错误（意外异常）: sa7-boom-deep"

=== [SA7] probes done: PASS=23 FAIL=0 ===  （EXIT=0）
```

## 附录 B：本轮可重跑命令清单

```bash
cd /home/wangjian/nomicore-fix-issue-73
pnpm exec vitest run packages/doc-runtime/test          # Step 1 + 单包触发证据（Node 24）
pnpm test                                               # 全量 51 files / 709 tests（/tmp/sa7-full.log）
pnpm typecheck                                          # 六包串联 EXIT=0（/tmp/sa7-tc.log）
docker run --rm --user $(id -u):$(id -g) -v $PWD:/w -w /w -e HOME=/tmp \
  node:20-slim node node_modules/vitest/dist/cli.js run packages/doc-runtime/test   # Node 20 复验
gh run list --branch fix/issue-73-on-docs-doc-runtime-validation --limit 5          # CI 阻塞证据（当前为空）
# 探针重建要点：fixture = 冻结测试 packages/doc-runtime/test/extract-yjs-snapshot.test.ts 的
# FIXTURE/derivedOf/buildFullDoc 同源拷贝；import { extractYjsSnapshot } from './src/index.js'；
# 探针文件置于 packages/doc-runtime/ 内以解析 yjs/@nomicore/vfsl，pnpm exec tsx 驱动，跑毕删除。
```

---

## 修订轮 R3 动态验证（2026-08-22，PR #81 review P1，commit f8f2ddd）

**Date**: 2026-08-22
**被验对象**: commit f8f2ddd（`copyPlainValue()` number 拆支：仅 `Number.isFinite` 直通，否则 `plainDomainIssue(path, loc, 'non-finite number')`；已 push 至 `fix/issue-73-on-docs-doc-runtime-validation`，PR #81 head）
**验证环境**: 宿主 Node v24.13.0 / pnpm 10.28.2 / vitest 3.2.7 / yjs 13.6.32；Node 20 复验 docker `node:20-slim`（本地镜像，同 R1 方式）；探针 tsx 独立进程驱动真实公共接缝（`packages/doc-runtime/src/index.ts` → `extractYjsSnapshot`），跑毕即删、worktree 零残留（`git status` 仅余本轮前已存在的 SA1/SA4 wiki 修订）。

### Step 0：校对 SA4 verdict（R3.1）

```
[SA7 Step 0 结论]
SA4 verdict: pass（R3.1 复审，2026-08-22 —— R3 的 F-R3-1（§11 DENY 治理）已经 SA1 设计 touch-up 闭环；
             R3 已裁决的技术维度 8/8 通过、29/29 探针、红灯真实性 6R/2G 复验、三线基线一致）
操作: 进 Step 1
```

### Step 1：SA6 新测试实跑（第二关）

```bash
$ pnpm exec vitest run packages/doc-runtime/test
 ✓ packages/doc-runtime/test/extract-plain-domain.test.ts (9 tests)
 ✓ packages/doc-runtime/test/extract-nonfinite-number.test.ts (8 tests)   ← 本轮新增（PR #81 P1 行为锚）
 ✓ packages/doc-runtime/test/extract-yjs-snapshot.test.ts (21 tests)
 ✓ packages/doc-runtime/test/extract-union-trial.test.ts (8 tests)
 ✓ packages/doc-runtime/test/extract-record-keyspace.test.ts (2 tests)
 Test Files  5 passed (5) / Tests  48 passed (48) / Type Errors no errors / EXIT=0
```

```
[SA7 Step 1 结论]
SA6 红灯测试（修订轮新文件 extract-nonfinite-number.test.ts 8 用例）: 🟢 GREEN
操作: 进入 Step 2
```

### Step 2-A：端到端活链路——owner 复现 schema 三值实测（探针 verbatim）

owner 复现 schema 逐字（`type ROOT = { n: YLeaf<number> };` + `doc.getMap('ROOT').set('n', v)`），经公共入口实测：

| 写入值 | 实测结果（探针 verbatim） |
|---|---|
| `NaN` | `ok:false` 单 issue；`path=["n"]`；`expected="plain value"`；`actual="non-finite number"`；`message="纯值域违约（ROOT.n）：期望 plain value（JSON 值域），实际 non-finite number"`；expected/actual ≠ 'internal' |
| `Infinity` | 同上三值逐项一致 |
| `-Infinity` | 同上三值逐项一致 |

三项均与立法口径（fail-fast 单 issue / expected 'plain value' / actual 'non-finite number' / path 锚定声明节点 ['n']）逐字段一致。

### Step 2-B：owner 必补 8 条逐条端到端核对

| # | owner 要求 | 实测（探针 verbatim） |
|---|---|---|
| 1 | leaf 位 NaN | ✅ 立法口径单 issue（见上表 NaN 行） |
| 2 | plain object 内 Infinity | ✅ `path=["arr"]` + `message="纯值域违约（ROOT.arr，内部位置 [1].x）：…实际 non-finite number"`——内部位置线只进 message 不进 path |
| 3 | plain array 内 -Infinity | ✅ `path=["arr"]` + message 含 `内部位置 [1]` |
| 4 | ok:false + fail-fast 单 issue | ✅ 每例 `issues.length===1`；多违规加固：`[1,2,∞,NaN,-∞,3]` → 单 issue 且首违规 `内部位置 [2]`（首违规即止） |
| 5 | expected === 'plain value' | ✅ 全部失败例逐例断言精确值 |
| 6 | actual === 'non-finite number'（冻结词） | ✅ 全部失败例逐例断言精确值 + `actual !== 'internal'`（E100 误分类守卫） |
| 7 | path 锚定 schema 声明节点 | ✅ `JSON.stringify(path)` 深等 `["n"]` / `["arr"]`（声明节点位，非内部位置） |
| 8 | 有限 number 正向对照 + JSON 往返全等 | ✅ `{n:42,arr:[1,2,3]}` → ok:true 深等原值 + `roundtrip=YES`；边界 `0`/`0.1` 往返全等、`-0` ok:true 且内存级 `Object.is(-0)=true`（JSON 无符号零，SA6 docblock 登记边界） |

加固面（超出 8 条）：`XE-1` 运行期溢出 `1e308*10`（非字面量产生路径）→ 立法口径拒绝；`XE-2` 跨端 NaN（`encodeStateAsUpdate→applyUpdate` 远端提取）→ 立法口径拒绝非 internal；`XE-3` 跨端 plain 子树 -Infinity → 远端拒绝 + message 含 `内部位置 [1]`。

### Step 2-C：R1/R2 清单第 2–5 项回归复核（按既有报告验证面，36 探针全 PASS）

**第 2 项：解耦与跨端组合 + 遍历期只读性——✅ 13 探针全 PASS**

| 探针 | 实测（verbatim 摘录） |
|---|---|
| 2a-1 INV-8 同 doc 两次提取逐字节相同（修复后全形态 fixture） | `len=439/439 equal=true`（两次 JSON.stringify 逐字节相同；冻结测试 21 用例同跑全绿互证） |
| 2a-2 Record 键插入序 + 覆写不换位 | `keys=["b","a","c"] twice-equal=true` |
| 2b-1 跨端组合 encode→apply 远端提取 | `local=true remote=true byte-equal=true` |
| 2b-2 INV-8 跨端成立 | `equal=true` |
| 2b-3 E2 提取级本地 Date | `actual=non-plain object path=["dt"]`（非 internal） |
| 2b-4 E2 跨端退化 plain {} | `remote ok=true dt={}`（诚实边界） |
| 2b-5 E1 跨端 bigint | `actual=bigint expected=plain value`（非 internal） |
| 2c-1~8 六深度观察者（ROOT/assets/img1/tags/xml/keywords）+ doc 四事件（update/beforeTransaction/afterTransaction/destroyed）在场时提取 | `ok=true` / `update events=0` / `before=0 after=0` / `deep observer fires=0` / `sv equal=true` / `toJSON equal=true len=448/448`；对照组写入 `update=1 after=1 deep=2`（零是只读性非观察者失效）；`destroyed=0` |

**结论**：number 拆支未引入任何遍历期写路径/观察者扰动——第 2 项验证面无回归。

**第 3 项：大文档性能面——✅ 4 探针全 PASS**

```
3a Record 全形态（每键 Y.Map{v leaf, tags Y.Array, audit Y.Map}）：
  N= 2000  median=7.0ms   N= 4000  median=11.0ms   N= 8000  median=16.5ms
  → 翻倍时延比 4k/2k=1.56、8k/4k=1.50；每键均摊 2k=0.0035ms、8k=0.0021ms
3b union 全软拒最坏面（三成员封闭联合，每键空 Y.Map）：
  N= 2000  median=2.0ms   N= 4000  median=2.1ms   N= 8000  median=4.2ms
  → 翻倍时延比 4k/2k=1.05、8k/4k=2.02；语义锚：全软拒 → ok:true 出口 3 回退成员 0（首键 {}）复证
```

**结论**：拆支为 O(1) 值域判定，数千键（8k）主遍历与 union 试验最坏面均无超线性（比值 ≤ 2.1，与 R1 实测量级一致）——无回归。

**第 4 项：Node 20 矩阵——✅ 本地 docker 真实运行时 + CI Node 20 job 双复验全绿**（CI 侧证据见下节「vitest 触发证据」）

```bash
$ docker run --rm --user $(id -u):$(id -g) -v $PWD:/w -w /w -e HOME=/tmp \
    node:20-slim node node_modules/vitest/dist/cli.js run packages/doc-runtime/test
 ✓ packages/doc-runtime/test/extract-union-trial.test.ts (8 tests)
 ✓ packages/doc-runtime/test/extract-nonfinite-number.test.ts (8 tests)   ← 新文件在 Node 20 下同绿
 ✓ packages/doc-runtime/test/extract-yjs-snapshot.test.ts (21 tests)
 ✓ packages/doc-runtime/test/extract-record-keyspace.test.ts (2 tests)
 ✓ packages/doc-runtime/test/extract-plain-domain.test.ts (9 tests)
 Test Files  5 passed (5) / Tests  48 passed (48) / Type Errors no errors / DOCKER_EXIT=0
```

`Number.isFinite`/`Number.EPSILON` 级语义与 yjs 13.6.32 载体判定在 Node 20.20.2 与 Node 24 一致（同一套断言双运行时均过）。

**第 5 项：B17 E100 message 可排障性——✅ 4 探针全 PASS**

```
5-1 leaf 位 throwing getter → ok:false 单 issue                 :: ok=false issues=1
5-2 message 含 DOCRT-E100 码 + 原异常文案                        :: message="DOCRT-E100: 内部错误（意外异常）: sa7-boom-leaf"
5-3 plain 数组内嵌 throwing getter → E100                        :: message="DOCRT-E100: 内部错误（意外异常）: sa7-boom-nested"
5-4 深层 throwing getter（嵌套两层）→ E100                       :: message="DOCRT-E100: 内部错误（意外异常）: sa7-boom-deep"
```

**结论**：拆支未侵入崩溃边界路径——E100 归类与 message 形态无回归。

### 全量动态基线（独立后台进程复跑）

| 运行 | 命令 | 结果 |
|---|---|---|
| 全仓（Node 24 宿主） | `pnpm test` | `Test Files 52 passed (52)` / `Tests 717 passed (717)` / `Type Errors no errors` / **EXIT=0**（Duration 44.66s）——五文件逐一出现，新文件 `✓ extract-nonfinite-number (8)` |
| typecheck 链 | `pnpm typecheck` | 六包串联（vfsl → vfsl-protocol → vfsl-codegen → persistence → dsh-persistence → doc-runtime）/ **EXIT=0** |
| doc-runtime 单包（Node 24） | `pnpm exec vitest run packages/doc-runtime/test` | `5 passed (5)` / `48 passed (48)` / **EXIT=0** |
| doc-runtime 单包（Node 20.20.2 docker） | 见第 4 项 | `5 passed (5)` / `48 passed (48)` / **DOCKER_EXIT=0** |

### vitest 触发证据（硬门禁段落 · 2026-06-15 立法；本轮为 R1 环境阻塞项的收口）

**CI Run**: https://github.com/welltop-jim-wang/nomicore/actions/runs/32557115782（run id 32557115782，event `pull_request`，branch `fix/issue-73-on-docs-doc-runtime-validation`，headSha `f8f2ddd6629c4733c54374a47d08bca0aee54b22` —— 与被验 commit 逐位一致；PR #81 headRefOid 同值）

| Workspace Package | CI Step Name（matrix job） | 触发结果 | log 摘录（verbatim） |
|---|---|---|---|
| doc-runtime（含新文件 `extract-nonfinite-number.test.ts`） | `test (20)`（job id 96992956562） | ✓ 触发且通过 | `✓ packages/doc-runtime/test/extract-nonfinite-number.test.ts (8 tests) 18ms`；`Test Files 54 passed (54)`；`Tests 752 passed (752)` |
| doc-runtime（同上） | `test (24)`（job id 96992956728） | ✓ 触发且通过 | `✓ packages/doc-runtime/test/extract-nonfinite-number.test.ts (8 tests) 21ms`；`Test Files 54 passed (54)` |

**CI 与本地文件数差异说明（诚实登记）**：CI `Test` step 54 files / 752 tests vs 本地 f8f2ddd 52 files / 717 tests——差异 2 文件（`packages/vfsl/test/compile-schema-envelope{,-sentinel}.test.ts`，35 用例）来自 PR base 分支 `docs/doc-runtime-validation` tip 6531b09（PR #80 / issue #72 合入；`git ls-tree` 实核：base tree 有、本分支 tree 无），`pull_request` 事件 checkout 的是 PR merge commit 故含之——纯加性、与 doc-runtime 无关，且 merge 树上全量仍绿（即修复与 base 最新工作合并无冲突回归）。两项 matrix job 均为 `test (20)` / `test (24)` Node 版本矩阵，触发证据如上；**job 顶层绿不绿的裁决归 runner/总控，本段仅摘录触发证据**（本地双运行时 48/48 为 SA7 亲测）。

**verdict**: ✅ all-vitest-packages-triggered（新测试文件在本地 Node 24 / Node 20 双运行时实跑 8/8 绿 + CI 双矩阵 job log 均出现该文件的 `✓ (8 tests)` 触发原文——R1 遗留的「CI 摘录环境阻塞」正式收口）

### 其他登记

- **F-R3-1（§11 touch-up）**：纯文档修订，无动态面——SA4 R3.1 已复审 pass，SA7 无动态验证义务项。
- **探针纪律**：36 探针（A/B/XE/C2/C3/C5）以临时 tsx 文件驱动，跑毕即删（`git status` 零探针残留；仅余本轮开始前已存在的 SA1/SA4 wiki 工作区修订与总控产物 `.mabf-done`/`REPORT.md`）。首轮探针 2 项 FAIL（2a-2/3b-1）经定位均为探针自身构造错误（键写错层级 / 语义锚误比全量快照），修正后 36/36 全 PASS——非实现缺陷，如实记录。
- **生产代码零改动**：全程未触碰 `packages/doc-runtime/src/`；未 commit/push。

### R3 结论

1. owner 复现 schema 三值端到端实测全部命中立法口径（ok:false 单 issue / expected 'plain value' / actual 'non-finite number' / path 锚 ['n']），owner 必补 8 条逐条端到端核对全过（含 plain object 内 Infinity、plain array 内 -Infinity、有限 number 正向对照 + JSON 往返全等 + 0/-0/0.1 边界）。
2. 全量动态基线独立复跑：52 files / 717 tests + 六包 typecheck 双 EXIT=0，与 SA4 R3 三线基线一致。
3. R1/R2 第 2–5 项验证面（跨端组合只读性 / 大文档性能 / Node 20 矩阵 / B17 E100 message）按既有报告同款方式复核——无任何回归。
4. R1 遗留的 CI 触发证据阻塞正式收口：f8f2ddd 触发的 run 32557115782 双矩阵（Node 20/24）job log 均摘录到新测试文件 `✓ (8 tests)` 触发原文。

**Verdict: pass**

