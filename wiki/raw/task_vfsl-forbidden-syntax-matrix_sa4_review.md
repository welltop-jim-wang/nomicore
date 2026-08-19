# SA4 静态验尸报告 — Parser 禁止语法负例矩阵（Issue #8）

**Date**: 2026-08-19
**Verdict**: **pass**
**评审对象**: SA3 commit `a35ab48`（test-only 工作单执行，SA1 设计 §4.3 R1 版 + SA2 R2 轮 pass 附 F1 勘误）
**任务类型**: 功能开发（验证资产交付）

---

## 0. 审核方法与独立取证总览

SA4 不采信 SA3 commit message 与 dispatch log 自述，全部结论以独立取证为准：

| # | 取证项 | 方式 | 结果 |
|---|---|---|---|
| E1 | Scope 比对（§8 R2 口径） | `git diff --name-only b076d41..HEAD -- packages/` | 恰 1 行 = ALLOW LIST 条目 ✅ |
| E2 | 黑名单 / DENY LIST | 全量 actual-files 扫描 + `git diff b076d41..HEAD -- packages/vfsl/src/ packages/vfsl/package.json` | 零命中；src diff 为空；版本实测 `0.1.2` ✅ |
| E3 | 工作单四条 it 逐字比对 | 实读矩阵文件（79 it 全量通读）vs 设计 §4.3 规格 | 4/4 逐字一致（it 名 + 块体 + 位置）✅ |
| E4 | F1 位置检查（SA2 R2 §5 指派） | describe 块边界定位 | E103-08 对在 E103 describe 块（:214–:278）末尾，未落入 E102 块 ✅ |
| E5 | pos/neg 断言形态机械扫描 | python3 解析 79 个 it 块体 | 39 pos 全含 `expectOk(`、40 neg 全含 `expectSingleIssue(`，违规 0 ✅ |
| E6 | 既有 76 it 断言未改动 | 38 个既有负例锚（码， line, column）+ pos 形态逐格比对 SA1 §2.2 审计表（该表出具于 SA3 动手前） | 38/38 一致；pos 槽位除 E102-06-pos（工作单改写对象）外全部原样 ✅ |
| E7 | 独立复跑 | 后台独立进程（setsid nohup + disown） | `pnpm test` exit 0：**7 文件 164/164**（矩阵文件 79）；`pnpm typecheck` exit 0 ✅ |
| E8 | E103-08 红灯防护力静态推演 | parser.ts parseIdentType 全路径审读 | 删 :351-353 分支 → 走非保留名 ref 路径 → 后随 `B` 在 `;` 期望位报 E100@1:18（或语义相位 E301），与期望 E103@1:10 码列皆异 → **必红**，防护力成立 ✅ |
| E9 | vitest 触发性 | `.github/workflows/ci.yml` + 根 `vitest.config.ts` | `pnpm test`（ci.yml:39）→ `vitest run` include `packages/*/test/**/*.test.ts` 直接覆盖矩阵文件；`pull_request` + `push: main` 双触发 ✅ |

计数自洽：矩阵 79 it = 40 neg + 39 pos（E102-09 为对照负例、无独立 pos，设计 §2.2 显式记录）；全套件 164 = 基线 85 + 矩阵 79；六个冻结测试文件逐文件计数 33+7+19+7+11+8 = 85 无回归。三组计数与设计 §2.1/§2.2/§4.3/§6/§8 预期态逐数吻合。

---

## 审核结论

1. **设计一致性：✅ 一致**
   - §4.3 工作单四条 **逐字执行**：R1-a（E102-06-pos 改写为真正例 `expectOk(parseVfsl('type Foo = string; type T = Foo;'), 2)`，:185-187）、R1-b（E102-09-neg 对照负例，原断言原样保留仅改名，:189-192，紧随 R1-a 之后）、R4-a/b（E103-08-neg/pos，:271-277）。
   - **F1 勘误落实**：SA2 R2 指派的静态检查项（E103-08 对必须位于 E103 describe 块内）通过——设计原文的 `:205` 错行号未被照抄，SA3 按「E103 describe 块末尾」描述锚执行，AC-3 组织契约（describe 名 = 错误码类别）保持。
   - 裁决内核落实：零 src 改动（E2）、版本不 bump（`0.1.2` 实测）、公共接缝 `parseVfsl` 仅被消费。
   - 非阻塞注记：E102 块内 it 顺序为 01~06、09、07、08（编号非单调）——系设计 R1-b「紧随 R1-a 之后」的必然结果，it 名自述单元格编号，AC-3 可指认性不受损，不构成偏离。

2. **读写路径一致性：✅ 一致（N/A——test-only）**：测试仅消费冻结接缝 `parseVfsl`（../src/index.js 导入），无数据源分叉面。

3. **静默失败：✅ 无**：正例全部走 `expectOk`（断言 `ok:true` + `aliases` 数组长度，封死「静默截断为 ok」伪绿）；负例全部走 `expectSingleIssue`（断言 issues 恰 1 条 + 前缀正则 + 行列整数性）。E5 机械扫描证明 SA2 攻击点 #1 的伪正例缺陷已闭合且无新错标。

4. **降级方案：✅ 安全（N/A）**：纯函数断言，无降级路径引入。

5. **极端攻击：✅ 未发现漏洞**：
   - E8 红灯防护力推演：E103-08-neg 的防护是真实的（分支删除 → E100@1:18 / E301，码与列均失配 → 必红），SA2 攻击点 #2 的「删分支全绿通过」盲区消除；
   - E102-06-pos 修复后带 ok·2 声明数断言，截断伪绿路径封死；
   - E102-09-neg 锚 `Foo`@1:10 推导复核：t1·y2·p3·e4·␣5·T6·␣7·=8·␣9·F10 ✅；E103-08-neg 锚 `extends`@1:10 同法复核 ✅（与 SA2 探针动态结果一致）。

6. **错误处理：✅ 完整（N/A）**：无生产路径变更；index.ts 兜底 catch 语义未触碰（设计 §6 + SA2 §3 已评审结论维持）。

7. **架构评估：✅ 可行**：无需退回 SA1。#5 递归下降 + 判定顺序映射架构被矩阵（含 R4 双实现位覆盖）反向验证成立，无绕过架构约束的痕迹。

8. **过度设计：✅ 精简**：diff 恰 1 个测试文件、净增 3 it + 改写 1 it，与工作单零偏差；无额外抽象/防御层/基建文件（可选 CI grep 防线依设计 §4.3 裁量未落地，正确）。

### 立法门禁逐项记录

| 门禁 | 结果 |
|---|---|
| §1.1 Scope Creep Guard（ALLOW LIST 存在性 + set 比对 + 黑名单） | ✅ ALLOW LIST 在（设计 §8）；packages/ 范围恰 1 文件；黑名单零命中；4 个 wiki 流程文档命中白名单豁免（`^wiki/raw/task_`），`TASK.md`/`.mabf-bg/` 未跟踪未入 commit |
| §1.2 设计偏离 | ✅ 零偏离（见结论 1） |
| §1.3 E2E spec runner 触发性 | N/A（diff 无 `*.spec.ts`） |
| §1.4 vitest 触发性自检 | ✅ 矩阵文件被 ci.yml `pnpm test` → 根 vitest include 模式直接覆盖（E9），非 CI 黑洞 |
| §1.5 协议假设依据 | ✅ 设计 §9「无协议级假设」判定正确（进程内纯函数断言）；SA4 复跑 E7 重现验证表全部结果 |
| §1.6 契约改动连锁 | N/A（零 src 改动 → 无 throw/return 契约变化；设计 §10 已记载） |
| §1.7 源码 GREP 断言禁令 | ✅ 测试文件零 `readFileSync`，全部断言为 `parseVfsl` 运行时行为断言 |

---

## 动态审核重点（交 SA7）

1. **复绿复现**（SA2 R2 §6 放行条件 2 的动态侧）：`pnpm test` 7 文件 164/164 exit 0、`pnpm typecheck` exit 0（SA4 静态期已独立复现一轮，E7；SA7 需在 HEAD 上再摘录一次运行日志作为动态证据）。
2. **Spec/vitest 触发证据**（SKILL §1.4 联动）：从 PR CI run（`gh run view --log`）摘录 `parse-vfsl-forbidden-matrix.test.ts (79 tests)` 在 `Test` job 出现且通过的行——静态结论 E9 的动态确认。
3. **变异抽检（可选但强烈建议）**：临时删除 parser.ts:351-353 首记号位 `extends` 分支 → 复跑矩阵文件，`E103-08-neg` 必须红（E8 静态推演的动态确认；跑完恢复原状并复绿）。同法可抽 E102-06-pos（临时使已声明裸引用误判为越界 → 该格红）。
4. **Scope 终检**：`git diff --name-only b076d41..<最终 HEAD> -- packages/` 仍恰 1 行（若 SA7 期间产生新的 packages/ 改动即违 §8 R2 口径）。

## 结论

**Verdict: pass。** SA3 对 §4.3 工作单的执行零偏差、零越界；SA2 两轮评审的全部修订要求（R1~R4）与 F1 勘误在 diff 层面闭环；164/164 + typecheck exit 0 经 SA4 独立复现。设计 §4.2.4 的闭环前置条件（工作单落地 + 复绿）已满足——Issue #8 可按「测试资产交付」闭环（AC-1/AC-2/AC-3 三项此时均可诚实勾选），是否补走 SA7 动态相位由总控/Jim 裁量。

---

**勘误说明（2026-08-19，本轮唯一实质改动）**：立法门禁逐项记录表中「§1.4 vitest 触发性」条目名称补全为「§1.4 vitest 触发性自检」，对齐 SKILL.md 2026-06-15 立法原文标题（MABF 硬门禁 #14 字面 grep 口径）。门禁结论（✅）、取证证据（E9）与其余全部内容不变，不构成重审；Verdict 维持 **pass**。

— SA4 Red Team（静态验尸），2026-08-19
