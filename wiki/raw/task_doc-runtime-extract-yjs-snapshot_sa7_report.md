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
