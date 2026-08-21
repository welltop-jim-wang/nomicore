# SA7 动态验证报告 — parseSchemaEnvelope（Issue #52 / H1）

**Date**: 2026-08-21
**Verdict: pass**
**验证对象**：SA3 实现 commits `cb7a2c7`（envelope.ts 187 行 + index.ts 编排 + 导出）+ `14f56f0`（F1 修复 crashDetail 守卫）；对照 SA4 R2 pass 报告「动态审核重点」清单（两条）。
**验证方法**：全部命令独立进程实跑（`setsid nohup` 后台 + exit code 落盘），不采信任何转述；不修改生产代码。

---

## Step 0 — SA4 verdict 校对

- `wiki/raw/task_vfsl-schema-envelope_sa4_review.md` 顶部（第 4 行）：**`Verdict（当前，R2）: pass`**。
- 操作：进 Step 1。

## Step 1 — SA6 红灯测试（修复后必须全绿）

- 文件：`packages/vfsl/test/parse-schema-envelope.test.ts`（13 用例 = 原 12 验收锚 + F1 回归锚）
- 命令（独立进程，日志 `/tmp/sa7-sa6.log`）：`pnpm exec vitest run packages/vfsl/test/parse-schema-envelope.test.ts`
- 结果：**🟢 GREEN** —— `✓ packages/vfsl/test/parse-schema-envelope.test.ts (13 tests) 14ms` / `Test Files 1 passed (1)` / `Tests 13 passed (13)` / `Type Errors no errors` / **exit 0**
- 结论：原 12 条验收锚与 SA6 追加的 F1 回归锚（对抗 getter/Proxy 三向量）全部转绿，SA4 R1 reject 的 F1 缺陷在动态层确认已修复。

## Step 2 — SA4 R2「动态审核重点」清单逐条验证

### 清单 1：vitest 触发证据（§1.4 静态接线的动态确认）

**口径声明（重要）**：本任务 PR **尚未发布**（push/PR 由外部 `check.sh` 负责，SA7 不越权），`gh run view --log` 无从取数。按总控指令，CI 触发证据以**本地全量实跑**为准，并附静态接线链作为 CI 必然触发的推导依据。PR 发布后如需补 CI run log 摘录，属总控收尾动作，不影响本报告结论。

**动态证据（本地全量实跑，独立进程，日志 `/tmp/sa7-full.log`）**：

```
 ✓ packages/vfsl/test/parse-schema-envelope.test.ts (13 tests) 14ms
 Test Files  31 passed (31)
      Tests  465 passed (465)
Type Errors  no errors
   Duration  27.41s
```

**exit 0**。执行行在 runner 列表真实出现且全绿——`vitest run --typecheck`（根 `package.json` scripts.test）经 `vitest.config.ts` include `packages/*/test/**/*.test.ts` 把本票文件自动入列，与设计 §8.4「零 CI 改动、自动入列」声称一致。

**静态接线链（CI 必然触发，PR 后即可按此路径取数）**：`.github/workflows/ci.yml:38-39` `Test` job → `pnpm test` → 同上 include 模式（另 `ci.yml:36` `pnpm typecheck` 含 `tsc -p packages/vfsl/tsconfig.json`）。SA4 §1.4 静态门禁 + 本节动态门禁双层一致。

**结论**：✓ 触发且通过，无 `vitest-package-not-triggered`。

### 清单 2：超长 text 透传冒烟（设计 §7 资源行）

脚本 `/tmp/sa7-smoke-envelope.ts`（独立进程，`NODE_OPTIONS=--expose-gc pnpm exec tsx`，日志 `/tmp/sa7-smoke2.log`，**exit 0 / ALL PASS**）。v1 构造文本不合法（直调 parseVfsl 亦 ok:false，透传一致性未破坏但幸福路径未覆盖）后按仓内合法文法（`parse-vfsl.test.ts` MINI_FIXTURE 同款）修正重跑，最终证据以 v2 为准：

| # | 向量 | 断言 | 结果 |
|---|---|---|---|
| S1 | **4.71 MB**（4,935,575 字符 / 60,001 行类型别名）合法超长 text，合法信封 `{lang:'vfsl',version:1,id:'sa7-smoke-huge',text}` | 直调 parseVfsl ok:true（前提）；经信封 ok:true；`module` 与直调 JSON 全等；envelope 回显恰四键且 text 同值同长 | **PASS**（via-envelope 880ms vs direct 612ms，信封层开销 +268ms，均为一次全量解析，无超线性放大） |
| S2 | 200 层内联深嵌套（`{ a: { a: … } }` > `MAX_TYPE_NESTING=100`）经信封 | 不抛、ok:false；首条 issue 命中「`VFSL-E100: 嵌套深度超过实现上限 100`」深度预算口径；issues 与直调完全一致；落文本通道 VFSL-E 码空间（非 ENV 层拦截） | **PASS**——parseVfsl 既有三层防护（语法相位深度预算/语义迭代 DFS/顶层 E100 catch）经信封层语义不变 |
| S3 | 引用直通内存对照：GC 后 retained heap，直调持 module vs 经信封持 module+envelope，各 3 轮取中位数 | 增量 < 文本体量 10%（0.47 MB）——排除 text/module 整体拷贝 | **PASS**（直调 57.7/57.7/57.7 → **57.70 MB**；经信封 57.7/57.7/57.7 → **57.67 MB**；中位数增量 **−0.03 MB**。module 本身 57.7 MB，若存在拷贝必远超阈值） |
| S4 | 超长场景下信封层自身通道：`text: <number>`（超长文本长度值） | ENV-3 结构化拒绝、码空间正确、无逃逸 | **PASS**（`VFSL-ENV-E3: 信封键类型错误: text 应为 string，实际 number`） |

**结论**：数 MB 级合法超长 text 经 `parseSchemaEnvelope` 透传保真、仍受 parseVfsl 既有三层防护约束、ENV 侧引用直通零额外内存放大——设计 §7「本接缝不新增预算点」的声称经实测成立。

---

## vitest 触发证据 (verdict 升级 — 2026-06-15)

CI Run: **N/A — PR 未发布（外部 `check.sh` 负责 push/PR），按总控口径以本地全量实跑为证据**（见「清单 1」；PR 后取数路径：`gh run view <run-id> --log --job=Test`，grep `parse-schema-envelope.test.ts`）。

| Workspace Package | CI Step Name | 触发结果 | log 摘录 |
|---|---|---|---|
| `@nomicore/vfsl`（packages/vfsl） | Test（`pnpm test` = `vitest run --typecheck`；本地全量同命令实跑） | ✓ 13 tests passed（本地全量 465/465 绿） | `✓ packages/vfsl/test/parse-schema-envelope.test.ts (13 tests) 14ms` |

**verdict**: ✅ all-vitest-packages-triggered（本地实跑口径）

---

## 独立复跑汇总（本会话全部命令 + 结果）

| 命令（均独立进程 setsid nohup） | 结果 | 日志 |
|---|---|---|
| `pnpm exec vitest run packages/vfsl/test/parse-schema-envelope.test.ts` | Tests 13 passed (13) / Type Errors no errors / **exit 0** | `/tmp/sa7-sa6.log` |
| `pnpm test`（全量 `vitest run --typecheck`） | **Test Files 31 passed (31) / Tests 465 passed (465) / Type Errors no errors / exit 0**（27.41s）——与 SA4 R2 复跑口径 31/465 逐字一致，存量零回归 | `/tmp/sa7-full.log` |
| `pnpm typecheck`（三包 tsc 链） | 零输出零报错 / **exit 0** | `/tmp/sa7-tc.log` |
| `NODE_OPTIONS=--expose-gc pnpm exec tsx /tmp/sa7-smoke-envelope.ts` | S1–S4 ALL PASS / **exit 0** | `/tmp/sa7-smoke2.log`（v1 首跑 `/tmp/sa7-smoke.log`，构造缺陷已修正，保留备查） |

## 纪律与边界

- **生产代码零改动**：`git diff HEAD -- packages/ domains/` 为空；工作区仅两条既有 wiki 档案修改（`dispatch.md` / `_sa4_review.md`，`^wiki/raw/task_` 白名单内）。
- **未新增补充测试文件**：SA4 R2 清单仅余两条且均属一次性动态证据（数 MB 冒烟含 `--expose-gc` 内存测量与 880ms 级全量解析，入常驻 CI 套件性价比为负）；设计 §12 ALLOW LIST 已冻结（新测试文件不在 ALLOW 内，SA4 §1.1 Scope Guard 将判 creep），F1 回归已由 SA6 第 13 条锚钉死。冒烟脚本按 DENY LIST 约定保留于 `/tmp/sa7-smoke-envelope.ts`（不进分支 commit）；若总控希望将超长 text 透传锚入常驻套件，需先扩 ALLOW LIST（设计修订），非 SA7 职权。
- 无端口/进程清理诉求（纯 vitest/tsx 单元级验证，无服务拉起）；未使用 `fuser -k` 于任何未知进程。

## 结论

**Verdict: pass。** SA4 R2 动态审核重点两条全部经独立进程实跑确认：① vitest 触发证据以本地全量实跑口径成立（13/13 执行行亲见，31/465 全绿零回归，静态接线链完整，PR 未发布口径已在报告中声明）；② 超长 text 透传冒烟四向量全过（透传保真 / 三层防护不变 / 零内存放大 / ENV 通道不受体量影响）。SA6 红灯测试修复后全绿（含 F1 回归锚），typecheck 0 错，生产代码零触碰。SA3 实现在动态层无新发现缺陷，可交总控进入 push/PR 收尾（CI run log 摘录建议作为发布后补录项）。
