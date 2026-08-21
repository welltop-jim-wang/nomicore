# SA4 静态验尸报告

**Date**: 2026-08-21
**Target**: SA3 实现 commit `0bfdaed`（HEAD，base `origin/phase-2-engine-gaps` = `901726f`）——`packages/vfsl/src/validate-patch.ts`（新建 686 行）+ `validate.ts`/`resolve.ts`/`index.ts` 修改 + `test/validate-patch.test.ts`（SA6 owned）
**Reviewer**: SA4（Red Team，静态绿光验尸）
**Verdict**: **pass**（附 1 项 LOW 级非阻断偏离回流 SA1 裁定，3 项 INFO 备注）

---

## 0. 硬门禁核查（总控点名项）

### 0.1 Hard Gate #9 —— vfsl 包版本 bump

✅ **已 bump**。`git diff origin/phase-2-engine-gaps HEAD -- packages/vfsl/package.json`：唯一变更行 `"version": "0.1.8" → "0.1.9"`，无其他改动。

### 0.2 §1.4 vitest 触发性自检（Hard Gate #14，总控点名必查）

✅ **结论：非黑洞，测试确被 runner 触发**。证据链：

1. **测试文件落位**：`packages/vfsl/test/validate-patch.test.ts` 匹配根级 `vitest.config.ts` 的 `include: ['packages/*/test/**/*.test.ts', …]`（根级单配置、无 per-package 排除、无 projects 分片）。
2. **runner 命令**：根 `package.json` `"test": "vitest run --typecheck"`——全量跑，无 `--filter`/`--project` 排除面。
3. **CI 接通**：`.github/workflows/ci.yml` 的 `test` job（Node 20/24 矩阵）执行 `pnpm test`，该步骤**无** `continue-on-error`、无路径过滤 → 本文件随全量跑进 PR CI。本次 diff 未触碰 `.github/**`、`vitest.config.ts`、根 `package.json`（`git diff` 为空，核实）。
4. **运行实证（本 SA4 亲跑）**：`npx vitest list packages/vfsl/test/validate-patch.test.ts` 枚举出全部 36 用例；`npx vitest run packages/vfsl/test/` → `✓ packages/vfsl/test/validate-patch.test.ts (36 tests)`，包内 18 文件 392/392 绿（exit=0）。

（§1.3 E2E spec 门禁：本 diff 无 `*.spec.ts`，不触发。）

### 0.3 §1.5 协议假设审查

设计 §9「协议假设依据」章节存在且声明**无协议级假设**——核实成立：纯引擎层（新增函数 + 包内机械重构），无 HTTP/WS/端口/进程/第三方库假设。设计中的全部源码引用级断言经 SA4 运行时探针复证（见 §2 F1 fixture 家族），无「应该/通常」类无据推断。

### 0.4 §1.6 契约改动连锁审计

设计 §10 声明无契约改动——核实成立：

| 函数 | diff 实况 | 判定 |
|---|---|---|
| `resolveChain`（resolve.ts） | 循环体移入 `walkRefChain`，透镜工厂逐字节还原报错（`引用环: X`/`未声明别名 X` 无冒号）；`t===undefined → TypeError` 前置保留；签名不变；`evaluate.ts` **零改动**（5 处 caller 不受影响） | ✅ 无契约变化 |
| `resolveValues`（私有） | 薄包装委托 `walkRefChain`；memo next-hop 语义、in-flight 时机、`Object.hasOwn` 守卫逐位一致（与旧循环逐行比对） | ✅ 无外部 caller |
| `validateSnapshot` | 主体抽取进 `interpret()`；旧版「先 resolveValues(root) 再 validateValue」变为「validateValue 内部 resolveValues」——`validateValue` 首行即 `resolveValues(node, ctx)`（validate.ts:456），行为恒等；E100/预算/截断措辞逐字节未动 | ✅ 65 例绿基座全绿（见 §3 证据） |
| `validateSubtree`（新增内部导出） | 不进 `index.ts` 公共面（grep 核实）；全仓唯一 caller = `validate-patch.ts` | ✅ |
| 四公共函数（新增） | `index.ts` 纯追加 4 导出；`walkRefChain`/`RefChainLens` 未泄漏进公共面（grep index.ts 零命中） | ✅ |

无 `return → throw`、无同步变异步、无 nullable 收紧——caller 三层防御审查不触发。

---

## 1. 文件清单 Scope Creep Guard（§1.1）

**ALLOW LIST**（设计 §8）抽取：`packages/vfsl/src/validate-patch.ts`、`validate.ts`、`resolve.ts`、`index.ts`、`test/validate-patch.test.ts`。

**actual diff**（`git diff --name-status origin/phase-2-engine-gaps HEAD`）：

| 文件 | 判定 |
|---|---|
| 上述 5 个 ALLOW 文件 | ✅ 全部命中（A/M 形态与设计一致） |
| `packages/vfsl/package.json`（M） | ⚠️ **ALLOW 外**——但 diff 仅 1 行（version 0.1.8→0.1.9），为流水线 Hard Gate #9 强制项（总控简报明示须核查其已 bump）。属**总控授权的管线级例外**，非 SA3 越界；建议 SA1 回写设计 §8 一行注记（回流 SA1，非阻断） |
| `wiki/raw/task_vfsl-validate-patch*.md` ×7 | ✅ 白名单（SA 流水线档案） |

**DENY LIST 全数未触碰**（核实）：`evaluate.ts`/`derived.ts`/`shapes.ts`/`ir.ts`/`parser.ts`/`semantic.ts`/`tokenizer.ts`/`pattern.ts`/`xml.ts`/`errors.ts`/`schemasource.ts` 零改动；`test/` 下既有测试文件零改动；`vfsl-codegen/**`/`vfsl-protocol/**`/`domains/**`/`docs/**`/`.github/**`/根配置零改动。

**BLACKLIST 零命中**：无 `TASK.md`、无 `package-lock.json`/`yarn.lock`、无 `.bak`、无 `.DS_Store`。

---

## 2. 设计一致性深审（D1–D18 逐条 + R2 红线 fixture 家族运行时复证）

SA4 以 99 项断言的对抗探针（tsx 只读脚本，经公共面 `index.ts` 导入）对实现做运行时复核——**99/99 全过**，关键证据：

| 冻结条款 | 探针结果 |
|---|---|
| **D13/R2① 归一化**（F1 HIGH） | `type P={d:string}; type ROOT={p:P;po?:P}` 深层写 `['p','d']`/`['po','d']`（mid-walk ref + optional ref）→ `ok:true`（**不再假 E100**）；与 `validateSnapshot` 同重建值 issue 全等；双层 ref 链（`type A=B`）、`type ROOT=M`（ROOT 身体 ref）均通过 |
| **D14/R2② 两段式**（F2 MEDIUM） | `base={assets:42}` 写 `['assets','k']` → 恰 1 issue、path=`['assets','k']`、行 11 措辞（含 `需要 plain object，实际 number`）；`{profile:42}` 写 `['profile','displayName']` 同拒——**spread 塌缩静默 ok:true 路径实证清零** |
| **D15/R2③ 去重/工作量界**（F3 MEDIUM） | 12 层嵌套 union-of-ref 链 + 60+ 段路径 → **0ms** 同步返回、不抛错（每步 visited 身份去重核实于 drillStep/targetHasArrayCandidate） |
| **D16/R2④ 消息取序**（F4 LOW） | `m: {x:string}\|string[]` 混合联合：`['m',0]`/`['m','x']` 各自放行、`['m',1.5]` 恰 1 issue 按 array 形消息（leaf>plain>xml>array>map 序核实于 `KIND_ORDER`） |
| **D17/R2⑤ 行 12**（F5 LOW） | `validateAppendToArray(d,{items:42},['items'],1)` → path=`['items']`（path 参数原样）、消息含 `实际 number`；目标缺失 → `实际 undefined` |
| **D18/R2⑥ E100 path**（F6 LOW） | 删 `values['ROOT']`、structure 非 root、两树分歧（值树缺字段）三种手造派生物 → E100 且 `issues[0].path=[]` ✅。**例外见 Finding-1** |
| D1/D2/D3 | 四导出名与 SA6 逐字一致；insert 闭区间 `[0,len]`（index=len 过、index=len+1 拒 path=`path++[index]`、负数拒）；delete `[0,len-1]`；守卫拒绝 path 全取完整尝试路径 |
| D4/D5/D8 | Record 规则 2 边界：新键违反键 Pattern → issue path=`['r','BAD_KEY']` Record 键措辞；规则 2 重建与整快照 validateSnapshot issue **全等**；存量键不复检（D8） |
| D6/D7/D9 | 守卫拒绝恰 1 issue；值级全收集（整值替换 3 字段错 → 3 issue 非短路）；`[0]` 数值段打 ROOT map → 行 6 措辞；`''`/boolean/null/object 段、空 path、非数组 path → 规整拒绝 path=`[]`；base null/数组/number、value=undefined（replace/append/insert 三入口）→ 全部以结果拒绝不抛错 |
| D10/D11 | optional 字段缺席基座写入 `ok:true`；optional 数组缺席 → 行 11/行 12 拒；undefined 值一律拒 |
| D12 | `derived.index` 零消费（grep 核实，仅注释提及） |
| §3.3 规则 1>4 | 穿透 union 的三操作：`['assets','file1','tags']` append → 边界=整个 file1，坏元素报重建后下标 `['assets','file1','tags',1]` + 「联合成员 3/3」；对 img1（无 tags 成员）append → 行 12 loud 拒（与设计 §3.3 闭合段推演一致） |
| §3.3 规则 3 | 数组元素写入重建单位=数组：嵌套数组邻位残留坏元素 42 → 拒绝 path=`['matrix',0,1]` |
| §3.5 安全纪律 | Record 键 `'__proto__'`/`'constructor'` 落为自有属性被正常校验（坏值 → issue path 含 `'__proto__'` 段）、`Object.prototype` 零污染；封闭对象未知键 `'__proto__'` → 结构拒绝 |
| AC1 纯函数 | 深冻结 derived+base 后六种调用全部 `ok:true`（零突变尝试）；四函数连环调用后 derived+base 逐字节不变；失败结果 JSON 往返全等（含 number path 段）；symbol 写入值结果仍可 JSON 序列化 |
| 次序纪律 | 结构段先于 base 检查：垃圾 base + 未知键 → 报「未知字段」（行 1）非行 11；垃圾 base + leaf 下钻 → 报 leaf 终态 |

**SA2 R1 攻击点 F1–F7 的实现侧消除**：全部经探针实证消除（上表 F1–F6 行 + F7 计数已在设计勘误且与实测一致：sa7 14 例、resolveChain 5 处调用点零改动）。

## 3. 零行为变化门禁（validateSnapshot）

本 SA4 亲跑：`npx vitest run packages/vfsl/test/` → **18 文件 392/392 绿**（含 validate-snapshot 35 + validate-snapshot-sa7 14 + fullchain-e2e 16 = 65 例绿基座 + validate-patch 36 新例），exit=0；`pnpm typecheck`（三包 tsc）exit=0。与总控 `.mabf-bg/phase3-verify.log`（全仓 488/488 + tsc exit=0）相互印证。

## 4. 审核结论（skill 八项）

1. **设计一致性**：✅ 一致（D1–D18 逐条探针复证；1 项 LOW 偏离见 Finding-1）
2. **读写路径一致性**：✅ 一致（纯函数无数据源；「重建值 ↔ 子 schema 校验 ↔ rebase」闭环经三组与 validateSnapshot 的全等探针证实）
3. **静默失败**：✅ 无（R1 唯一静默 ok:true 路径实证封死；一切异常收编 E100 loud）
4. **降级方案**：✅ 安全（无降级路径；顶层 catch → E100 是崩溃边界非降级）
5. **极端攻击**：✅ 未发现可利用漏洞（原型污染/冻结输入/非 JSON 值/越界/NaN/Infinity/混合联合/嵌套 union DoS 全部通过）
6. **错误处理**：✅ 完整（拒绝矩阵行 1–12 全部落位且 path/措辞与冻结一致）
7. **架构评估**：✅ 可行（无绕行、无 FIXME/TODO、无临时补丁；「一算法三透镜」兑现——全仓 while 循环恰一份 `walkRefChain`）
8. **过度设计**：✅ 精简（686 行 vs 设计估计 ~450，差额为 JSDoc/注释；复杂度由冻结条款 D13–D18 强制，非自发膨胀）

## 5. Findings

| # | 级别 | 内容 | 处置 / 回流 |
|---|---|---|---|
| **F-1** | **LOW（非阻断）** | **子树解释器内部 E100 的 issue path ≠ `[]`**。场景：篡改派生物使值树**边界之下**含 ref 环（`values['P2']={kind:'ref',name:'P2'}` + `type ROOT={p:{d:P2}}`，`validatePatch(d,base,['p'],{…})`）→ 异常被 `interpret()` 内部 catch 收编为 E100（相对 path `[]`），再经 `finish()` rebase 前缀 → 实测 `issues[0].path=["p"]`。D18 冻结「E100=[]」，D5 冻结「值级 issue 绝对路径」——两条款在该场景交叠且设计未显式裁定。行为**确定性、loud、仅篡改派生物可达**（合法派生物经 descendValues 归一化先行拦截，探针证实三种手造场景 path 均为 `[]`），无功能危害 | **回流 SA1**：一句话裁定（建议采现状——子树 E100 按 D5 取绝对前缀更利于定位，回写 D18 加「子树解释器内部 E100 除外」注记）；SA3 无需改码 |
| F-2 | INFO | 任务简报 SA6 记录写「6 组 describe」，实际文件 5 组（AC5+AC6 合并一组）；**36 用例总数吻合**。属 Phase-1 档案文字漂移，非 SA3 所为 | 存档备注，无动作 |
| F-3 | INFO | 垃圾 base + 越界 number 段（`base={items:'garbage'}` 写 `['items',5]`）报**行 11**（父形态检查先于越界检查）——与设计 §3.2 伪代码「①形态→②在场/越界」次序逐字一致，非缺陷 | 交 SA7 知悉，防误报 |
| F-4 | INFO | `packages/vfsl/package.json` 不在设计 ALLOW LIST（见 §1）——Hard Gate #9 管线强制项 | 回流 SA1 补设计 §8 注记 |

## 6. 动态审核重点（交 SA7）

1. **CI vitest 触发证据**（§0.2 静态结论的动态确认）：从 PR CI `gh run view --log` 摘录 `validate-patch.test.ts (36 tests)` 出现在 `pnpm test` 步骤日志（Node 20 与 24 两矩阵至少其一）。
2. **F-1 复现对账**（可选）：按 §5 F-1 场景构造篡改派生物，确认 `issues[0].path` 与 SA1 裁定后的冻结值一致。
3. **WorkBudgetExceeded 穿透 validateSubtree**（可选）：构造边界子树超 2×10⁸ 预算的写入（如 90 万键 Record 整体替换），确认预算耗尽单条 issue + rebase 前缀（静态核实接线共享 `interpret()`，运行时量级未测）。
4. **fullchain 生成物新鲜度**：`pnpm generate --check` 在 CI 绿（本票未触碰 codegen 面，静态核实零关联，CI 步骤兜底）。

## 7. 验证证据汇总（命令 + 结果）

| 命令 | 结果 |
|---|---|
| `git diff --name-status origin/phase-2-engine-gaps HEAD` | 13 文件（5 ALLOW + package.json 版本行 + 7 wiki），DENY/BLACKLIST 零命中 |
| `npx vitest list packages/vfsl/test/validate-patch.test.ts` | 36 用例全枚举（非黑洞） |
| `npx vitest run packages/vfsl/test/` | 18 文件 392/392 passed，Type Errors no errors，exit=0 |
| `pnpm typecheck` | 三包 tsc exit=0 |
| SA4 对抗探针（tsx，99 断言，/tmp/sa4-probe.mts + probe2） | **99 ok / 0 FAIL** |
| 总控 phase3-verify.log 复核 | 全仓 488/488 + vitest_exit=0 + tsc_exit=0 |

**Verdict: pass**——SA3 实现与 R2 定稿设计逐条吻合，SA2 R1 全部攻击点在实现侧实证消除，无静默失败、无 scope creep（管线授权项除外）、无过度设计；F-1 为低危条款交叠，回流 SA1 一句话裁定即可，不构成驳回理由。
