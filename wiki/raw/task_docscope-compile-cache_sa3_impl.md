# SA3 实现记录 — DocScope 作用域绑定与编译缓存（issue #54 / H3，Phase 3 TDD 实现）

**Date**: 2026-08-21
**输入**：SA1 设计 R2 定稿（`task_docscope-compile-cache_design.md`，698 行）+ SA2 R2 verdict **pass**（`task_docscope-compile-cache_sa2_review.md`）+ SA8 设计后复审 verdict clear（`task_docscope-compile-cache_design_conflict_report.md`）+ 任务简报（`task_docscope-compile-cache.md`）
**实现半径**：严格按设计 §8 ALLOW LIST 六项（sha256.ts 新建 / envelope.ts 增两导出 / index.ts getCompiled 编排 / 两个设计强制守卫测试 / package.json bump 0.1.9→0.1.10）；DENY LIST 全零触碰

## §1. 实现动作清单

| # | ALLOW LIST 项 | 动作 | 结果 |
|---|---|---|---|
| 1 | `packages/vfsl/src/sha256.ts`（新建） | 实现 `utf8Bytes`（R2/A1：WTF-8 单射字节化——lone surrogate 走 `ED A0 80–ED BF BF` 段，不替换）+ `sha256Hex`（FIPS 180-4 纯 ES2022，零 import 叶子模块） | ✅ 与 node:crypto 对拍全过（见 §3） |
| 2 | `packages/vfsl/src/envelope.ts`（修改 +~30 行） | 新增 `envelopeTextGate`（形状 ENV-1/2/3 → 方言 ENV-4 → 恰四键回显信封）+ `vfslIssues`（kind:'vfsl' 包装单点）；**既有函数零改动**（git diff 仅追加） | ✅ |
| 3 | `packages/vfsl/src/index.ts`（修改） | evaluate 改值导入 + 同源 re-export；`parseSchemaEnvelope` 内部改用 gate/vfslIssues（行为逐字节不变）；新增 `CompiledOk`/`GetCompiledResult` 类型导出、`compiledCache` Map、`deepFreeze` 私有助手、`getCompiled`（D1/D2/D4/D6/D7/D9/D11：全函数体顶层崩溃边界 ENV-100） | ✅ |
| 4 | `packages/vfsl/test/docscope-sha256.test.ts` | 已由总控预置（内容与设计 §5.4 逐字一致，含 R2/A1 RT-1 两层）；SA3 复核零改动 | ✅ 13/13 |
| 5 | `packages/vfsl/test/docscope-guards.test.ts` | 已由总控预置（设计 §5.5 断言形态）；SA3 做 **5 处 TS 类型层修正**（`unknown`→`DerivedSchema` 返回值、对抗 getter 断言改 `as unknown as` 双段收窄——断言语义不变，纯 noUncheckedIndexedAccess/strict 适配） | ✅ 6/6 |
| 6 | `packages/vfsl/package.json` | `version: 0.1.9 → 0.1.10`（已由总控预置，SA3 复核确认；`dependencies` 维持空集——AC6 清单守卫绿） | ✅ |

**设计偏差登记（1 处，类型层）**：设计 §4.1 字面签名 `getCompiled(input: string | SchemaEnvelope)` 改为 `getCompiled(input: unknown)`。理由：SA6-owned 测试 `docscope-getcompiled.test.ts` 的 `compiledOf(input: unknown)`（:129-139）直调 `getCompiled(input)`，窄签名下 `unknown` 不可赋值 → tsc TS2345（该文件「预期零改动」，SA3 禁改）；设计 §4.1/§6 本身明文运行时接受任意输入（`getCompiled(42)`/`null`/函数 → ENV-1，与 H1 `parseSchemaEnvelope(input: unknown)` 同源防御姿态）。运行时行为与设计 §5.2 伪代码逐语句一致（typeof 判别 → 非 string 交 gate）。

## §2. ALLOW / DENY LIST 边界核验

- DENY LIST（evaluate/parser/tokenizer/semantic/shapes/resolve/pattern/xml/errors/ir/derived/validate/validate-patch/schemasource/vfsl-protocol/vfsl-codegen/配置/既有测试/apps/domains/tests）：`git diff --stat` 证实**零改动**（仅 ALLOW 三文件 + package.json + wiki 记录）。
- H1 回归护栏（RT-4）：`parse-schema-envelope.test.ts` **零改动**，13/13 全绿——D5 gate 重构「行为逐字节不变」的活体证明。
- 无 env-override / fallback / 测试侧特判（铁律合规）；getCompiled 生产路径单控制流，失败全部结构化 issues 返回。

## §3. 验收绿灯实测证据（2026-08-21，本 worktree）

| 验证项 | 命令 | 结果 |
|---|---|---|
| SHA-256 实现正确性（设计 §5.3 转写 vs node:crypto） | `node /tmp/verify-sha256.mjs`（9 合法向量 + 5 WTF-8 手构字节向量 + 单射互异） | 14 行全 `OK`；`legal-ALL: true`；`D800 vs FFFD / D800 vs DC00 / FFFD vs DC00 distinct: true ×3` |
| 守卫测试 A（KAT + 单射两层） | `pnpm exec vitest run packages/vfsl/test/docscope-sha256.test.ts` | **13 passed (13)**，exit 0 |
| 守卫测试 B（RT-2 崩溃边界 + RT-3 冻结等价） | `pnpm exec vitest run packages/vfsl/test/docscope-guards.test.ts` | **6 passed (6)**，exit 0 |
| H1 回归（RT-4） | `pnpm exec vitest run packages/vfsl/test/parse-schema-envelope.test.ts` | **13 passed (13)**，exit 0 |
| SA6 验收（13 用例） | `pnpm exec vitest run packages/vfsl/test/docscope-getcompiled.test.ts` | **11 passed | 2 failed**（2 处 SA6 fixture 缺陷，见 §4——非实现缺陷） |
| 全量 | `pnpm exec vitest run` | Test Files **35 passed (35)（36 文件 1 失败=SA6 文件）** / Tests **553 passed | 2 failed (555)**——唯一 2 失败即 §4 两处 |
| 类型检查 | `pnpm typecheck`（vfsl + protocol + codegen 三包） | 无错误输出，exit 0 |
| 深冻结语义（D4.3 附加实证） | `tsx /tmp/freeze-check.mts`（ESM 严格模式） | 容器/module/derived/aliases/structure 全 `Object.isFrozen: true`；变异抛 **TypeError**（loud）；对抗 getter → kind:'envelope'/code:'100'；`getCompiled(42)`/`null` → ok:false |

## §4. ⚠️ SA6-owned 测试遗留 2 处 fixture 缺陷（实现侧不可解，需总控路由 SA6 微修）

11/13 绿；2 红经隔离复跑（AC1.3 单独跑绿、AC5 单独跑红）证实为 **SA6 测试文件内部逻辑矛盾**，任何正确实现下都无法通过（与设计 §11 A/B/C 同类；该文件「预期零改动」，SA3 未触碰）：

| # | 用例 | 缺陷 | 证据 | 建议最小修正 |
|---|---|---|---|---|
| D1 | AC1.2「缓存命中不重算」→ 泄漏至 AC1.3「信封形式与文本形式」 | AC1.2（:224-227）武装的 `mockImplementationOnce` 失败注入因**命中路径不调 evaluate 而从不被消费**，泄漏到下一用例 AC1.3 的 `freshDerived`（:242 直调 evaluate）→ 注入失败被消费 → `freshDerived` 自检 `expect(e.ok).toBe(true)`（:177）红 | AC1.3 单独跑 **绿**、全文件跑 **红**（顺序依赖）；命中调 evaluate 会违反 AC1.2 自身计数断言（设计 §11.5 已否决），实现侧无解 | AC1.2 收尾消费武装失败并复位（如命中断言后 `evaluateMock.mockClear()` + 显式消费一次），或删除该武装块（计数断言 :233 已是「命中不重算」的规范证明） |
| D2 | AC5「evaluate 失败不污染缓存」 | `:379 freshDerived(TEXT_RETRY)` 自身直调 mock 的 evaluate（第 3 次），`:380 toHaveBeenCalledTimes(2)` 计数恒为 3 | AC5 **单独跑即红**（`expected "evaluate" to be called 2 times, but got 3 times` @:380）；freshDerived 为测试侧对照基准，无法不调 evaluate | 计数断言移至 :379 之前（重试成功后先断 2 次再深相等对照），末段断言改 3 并注释「+freshDerived 直调」；或 :379 改经 `JSON.parse(JSON.stringify(...))` 快照对照 |

两处均不动实现语义（getCompiled 控制流与设计 §5.2 逐语句一致：miss → 1 次 evaluate、命中零调用、失败不落缓存——AC1.1/1.2/2/3/4/6/边界 11 用例全绿即证明）。

## §5. 结论与移交

- **实现交付**：ALLOW LIST 六项全部落地；设计强制守卫 19 用例 + H1 回归 13 用例 + 全量 553/555 绿；`pnpm typecheck` 三包零错。
- **阻塞项**：SA6 验收 13 用例中 2 红 = SA6-owned 文件 fixture 缺陷（§4 D1/D2），**需总控核实并路由 SA6 最小修正**后 SA7 全绿闭环。
- **未 commit**（简报要求「commit 前告知总控，总控亲跑验收」）：工作区改动待总控验收 + SA6 微修后统一提交。改动清单：`src/sha256.ts`（新）、`src/envelope.ts`（+26 行）、`src/index.ts`（+152/-27）、`test/docscope-sha256.test.ts`（预置）、`test/docscope-guards.test.ts`（预置+SA3 类型适配）、`package.json`（0.1.10）。
- SA4/SA7 参照：验证命令与输出见 §3 可直接复跑；§4 两处缺陷的修正责任在 SA6-owned 文件，SA4 静态门禁不应归咎于实现侧。
