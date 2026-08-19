# 任务简报 — ROOT 约定实现：E310/E311 命名空间根完整性检查（Issue #19）

> Worktree: `/home/wangjian/nomicore-fix-issue-19`
> 分支: `fix/issue-19-on-adr-union-representation`（base: `adr/union-representation`）
> 任务类型: **功能开发**（mabf.tasktype 登记为 refactor，路由相同：SA6 验收测试 → SA1 设计 → SA2 评审 → SA3 编码 → SA4 静态 → SA7 动态；SA5 仅 Bug 修复，不适用）
> run_id: `issue-19-1787121781-17717`
> Parent: PR #17

## 一、任务目标（来自 Issue #19）

parseVfsl 语义相位新增命名空间根完整性检查（规格 §3「命名空间根（ROOT 约定）」，ADR 0003 §2）：模块必须恰好声明一个名为 `ROOT` 的别名，且 **ROOT 固定物化为 Y.Map**——仅接受 map 形（裸对象默认物化即 YMap / 显式 `YMap` / `Record` / 全 map 形联合；clsOf 三分类经别名链解析后判定）。缺 ROOT → VFSL-E310（锚模块起始 1:1）；ROOT 非 map 形 → VFSL-E311（锚 ROOT 类型表达式起点记号），标量形与 `YArray` / `YXmlFragment` 一律拒绝。E310/E311 进入语义相位候选池，与既有 E30x 按 min-position 聚合。存量测试 fixture 全部按规格 §10 修订版对齐（ROOT=YMap，`YXmlFragment` 位于 text 成员 body 字段）并补齐 ROOT，断言意图不变、不删任何断言。

**背景（issue #19 评论，2026-08-19）**：owner 决策修订了 ROOT 规则（固定物化为 Y.Map，YArray/YXmlFragment 也拒绝）+ YXmlFragment 改不透明语义，规格与 ADR 已在集成分支更新（e0c9cb2）。旧 run 已中断清理（SA2 曾 reject 旧设计，返工内容已被新规则覆盖）。**一切以 e0c9cb2 之后的规格/ADR 为准，旧 wiki 档案中与本规则冲突的设计结论一律作废。**

## 二、Acceptance Criteria（全部满足才算完成）

- [ ] `type Foo = string;`（无 ROOT）→ ok:false，VFSL-E310，line 1 column 1
- [ ] 标量 ROOT：`type ROOT = string;` / `YLeaf<string>` / `YPlainArray<string>` / `string & Pattern<"a">` / 全标量联合 → VFSL-E311，锚 ROOT 类型表达式起点
- [ ] 非 map 容器 ROOT：`type ROOT = YArray<string>;` / `YXmlFragment<{…}>` → VFSL-E311
- [ ] 正例全形态：裸对象 / `YMap` / `Record` / 全 map 联合（含经别名间接）→ ok:true
- [ ] 大小写契约：`type root = {…}`、`type Root = {…}` → E310（视为缺 ROOT）
- [ ] 别名链穿透：`type S = string; type ROOT = S;` → E311；`type M = YMap<{x: string}>; type ROOT = M;` → ok
- [ ] ROOT 被其他别名引用 → ok（既当根又当积木）；游离积木别名 → ok
- [ ] 存量测试全部转绿（fixture 以规格 §10 修订版为准并补 ROOT），零断言删除
- [ ] 错误码注册表与规格 §4（21 码）一致

## 三、现状基线（总控 2026-08-19 14:44 实测，SA 必读）

- 分支 HEAD `e0c9cb2` == `origin/adr/union-representation`，零领先零 diff，工作区干净（仅 TASK.md 与 `.mabf-bg/`）。
- 基线 `pnpm typecheck` EXIT=0；`pnpm test` 8 文件 **180/180 全绿**（forbidden-matrix 79 + cycle-detection 16 + containers-markers 33 + sa7-supplementary 8 + jsdoc 7 + errors 19 + parse-vfsl 11 + r3-regression 7）。
- `grep -rE 'E31[01]'` 于 `packages/vfsl/src` 与 `packages/vfsl/test` **零命中**——E310/E311 完全未实现，本任务为纯新增语义检查 + 存量 fixture 对齐。
- 注意：E310/E311 落地后，**存量测试中无 ROOT 的输入将按新语义变为合法拒绝**——AC 第 8 条的「存量测试全部转绿」正是要求 SA3 按 §10 修订版对齐 fixture 并补 ROOT（断言意图不变、不删任何断言）。基线 180 绿是**改动前**的事实，不是改动后不得触碰的红线；红线是「断言意图不变、零删除」。

## 四、权威输入（必读）

| 输入 | 角色 |
|---|---|
| `docs/vfsl/v1-spec.md` | v1 方言唯一规范来源（frozen）：§3「命名空间根（ROOT 约定）」（E310/E311 语义与锚点）、§4 错误判定顺序（规范性）+ 错误码总表（21 码）、§10 附录 `vfs3.assets` 参考 fixture **修订版**（ROOT=YMap、YXmlFragment 位于 AssetEntity text 成员 body 字段） |
| `docs/adr/0003-evaluator-derived-schema.md` | §2 根指定：显式 ROOT 别名约定；§5 YXmlFragment 不透明语义；§4 别名按名引用不内联 |
| `CONTEXT.md` | 术语规范：ROOT（大小写是契约、固定物化 Y.Map、getMap('ROOT')）、标记类型、惰性积木、求值器等 |
| `wiki/raw/20260818-prd-vfsl-v1.md` | PRD 归档：公共接缝 `parseVfsl(text)` 冻结、测试决策 |
| `wiki/raw/task_vfsl-forbidden-syntax-matrix*.md`、`task_vfsl-parser-containers-markers*.md`、`task_vfsl-parser-cycle-detection*.md`、`task_vfsl-jsdoc-capture*.md` | 前序档案：错误相位/聚合机制、clsOf 三分类与标记语义、E106 环检测、JSDoc 挂载的既有实现来历（凡与 e0c9cb2 新 ROOT 规则冲突处以其为准） |
| `packages/vfsl/src/` + `packages/vfsl/test/` | 现状代码与 180 个基线已绿测试 |

## 五、环境与验证命令

- pnpm 单仓库 + workspace，唯一业务包 `packages/vfsl`（`@nomicore/vfsl`，当前 `0.1.3`）。
- 本仓库**没有** `scripts/test-lock.sh`；命令（在 worktree 根执行）：
  - 全量测试：`pnpm test`（= `vitest run`）
  - 类型检查：`pnpm typecheck`（= `tsc -p packages/vfsl/tsconfig.json`）
  - 单文件：`pnpm vitest run <file>`
- 零运行时依赖红线：`packages/vfsl/package.json` 不得引入任何 `dependencies`。
- 本任务必然产生 `packages/vfsl` 代码/测试改动，须 bump patch 版本号 0.1.3 → 0.1.4（Hard Gate #9）。

## 六、产出文件命名约定（均写入 `<worktree>/wiki/raw/`）

| 文件 | 来源 |
|---|---|
| `task_vfsl-root-convention.md` | 本简报（已存在） |
| `task_vfsl-root-convention_design.md` | SA1 设计 |
| `task_vfsl-root-convention_sa2_review.md` | SA2 评审 |
| `task_vfsl-root-convention_sa4_review.md` | SA4 静态验尸 |
| `task_vfsl-root-convention_sa7_report.md` | SA7 动态验证 |
| `task_vfsl-root-convention_dispatch.md` | 派遣日志（总控维护） |

功能开发任务**不产出** `YYYYMMDD-bug-<slug>.md`（那是 SA5 故障分析，仅 Bug 修复任务）。

## 七、约束与红线

1. 发布与远程操作（push、开 PR、CI 跟踪）全部由外部 `check.sh` 负责；总控与所有 SA 均不得执行任何远程写操作，也不得改动 PR base。
2. `parseVfsl` 返回形状（`{ ok: true; module } | { ok: false; issues }`）、issues 字段形状（`{ message, line, column }`）、错误码消息前缀（`VFSL-E<三位>: `）按 #5 冻结契约延续，只增不改。
3. E310/E311 的判定相位与聚合遵守规格 §4「错误判定顺序（规范性）」：语义相位候选池、相位内 min-position 聚合；ROOT 重复声明走既有 E302，不是新码。
4. 存量测试修订边界：fixture 对齐 §10 修订版 + 补 ROOT，**断言意图不变、不删任何断言**；基线 180 用例一个都不许静默消失（skip/删除均视为删断言）。
5. 测试文件为 vitest `*.test.ts`：SA1 design 涉及 `*.test.ts` 新增/改动时，SA4 review 须含「1.4 vitest 触发性自检」结论、SA7 report 须含「vitest 触发证据」段落（Hard Gate #14）。
6. 评审 verdict 行格式约定：dispatch log 中 verdict 单独成格（`| pass |`）；SA4/SA7 报告主 verdict 行 `**Verdict**: pass` 且为文件最后一条 verdict。
7. 错误码注册表（`errors.ts` 或等价物）必须与规格 §4 总表 21 码一一对应（AC 第 9 条）。

---

## 八、SA6 红灯测试记录（2026-08-19，SA6 追加）

### 8.1 测试文件与设计

新增 `packages/vfsl/test/parse-vfsl-root-convention.test.ts`（34 用例，vitest）。断言一律经公共接缝 `parseVfsl(text)` 验证可观测行为（ok / issue 码 / 行列），无源码读取、无 grep 伪测试。覆盖 AC 映射：

| AC 条目 | 测试 |
|---|---|
| AC1 无 ROOT → E310@1:1 | `type Foo = string;`；多别名无 ROOT；前导文档注释后无 ROOT 仍锚 1:1；空文本 → E310@1:1（§3「每个模块」无例外） |
| AC5 大小写契约 | `type root = {…}` / `type Root = {…}` → E310@1:1；`Root` 与真 `ROOT` 并存 → ok |
| AC2 标量 ROOT → E311 | `string` / `number` / `YLeaf<string>` / `YPlainArray<string>` / `string & Pattern<"a">` / `string \| number` 全标量联合 → E311，锚类型表达式起点（单行 col 13） |
| AC3 非 map 容器 ROOT → E311 | `YArray<string>` / `YXmlFragment<{ a: string }>` / 裸数组 `string[]` → E311 |
| AC6 别名链穿透 | `type S = string; type ROOT = S;` → E311 锚引用记号（col 30）；多跳链（col 42）；全标量联合经别名（col 47） |
| 锚点 = 类型表达式起点 | 多行文本锚第 2 行起点（2:3 / 2:13），非 `type` 关键字 |
| 候选池 min-position 聚合 | E311@13 先于其内 E301@20 胜出；ROOT 重复声明 → 既有 E302@33（非新码）；ROOT 位未知名 `type ROOT = Foo;` → E301（形状不裁决，防误报 E311） |
| AC4 正例全形态 → ok | 裸对象 / 空对象 / `YMap` / `Record` / 全 map 联合（内联）/ map 经别名 / 全 map 联合经别名 / ROOT 被引用（既当根又当积木）/ 游离积木 |
| AC4 + §10 | 规格 §10 **修订版** vfs3.assets fixture（ROOT=YMap、YXmlFragment 位于 text.body）→ ok |

### 8.2 红灯验证（2026-08-19 实测，后台独立进程 `pnpm vitest run`）

**单文件**：`pnpm vitest run packages/vfsl/test/parse-vfsl-root-convention.test.ts` → **21 failed | 13 passed (34)**，EXIT=1。

- 21 个失败全部为 E310/E311 反例断言（当前 `src/` 零命中 E31[01]——E310 场景现返回 ok:true、E311 场景现返回 ok:true 或既有错误码），红灯真实。
- 13 个通过 = 11 正例契约锚 + 2 锁定测试（E302 重复 ROOT、E301 ROOT 位未知名）——现在绿、实施后必须保持绿。

**全量基线**：`pnpm test` → **8 个存量文件 180/180 全绿无回归**；新文件 21 failed | 13 passed；合计 21 failed | 193 passed (214)，EXIT=1（红灯存在，符合预期）。

关键失败证据（节选）：

```
FAIL … > E310 缺少 ROOT > AC1：无 ROOT 的模块 → VFSL-E310，line 1 column 1
  AssertionError: expected false to be true    （实际 ok:true，module 已产出）
FAIL … > E311 标量 ROOT > AC2：`type ROOT = string;` → VFSL-E311
  AssertionError: expected ok:false，实际 ok:true
FAIL … > E311 非 map 容器 ROOT > AC3：`type ROOT = YArray<string>;` → VFSL-E311
  AssertionError: expected ok:false，实际 ok:true
FAIL … > 候选池聚合 > E311 先于其内未知名 E301 → E311 胜出
  AssertionError: expected 'VFSL-E301: 未知名引用: Foo' to match /^VFSL-E311: /
```

### 8.3 存量影响扫描（SA3 必须处理的 fixture 对齐面）

对 8 个存量测试文件的 193 个 parseVfsl 输入逐条用当前实现解析分类（临时扫描脚本，`/tmp/sa6-scan`），E310/E311 落地后受影响的输入（断言将转红，需补 ROOT fixture）：

| 文件 | 受影响输入 | 构成 | 修复方向 |
|---|---|---|---|
| parse-vfsl-containers-markers.test.ts | 25/31 | 14 ok→E310；11 语义错误（E304/E306/E307/E309/E301）被 E310@1:1 抢胜 | 补 ROOT；**§10 fixture 仍是旧版（`AssetsDoc = YXmlFragment<{…}>`）须整体替换为修订版（ROOT=YMap、YXmlFragment 降为 text.body）** |
| parse-vfsl-forbidden-matrix.test.ts | 41/77 | 37 ok→E310；4 E301 被抢胜 | 补 ROOT（注意 unknown/Pattern/联合等正例输入） |
| parse-vfsl-cycle-detection.test.ts | 9/9 | 9 × E106 全部被 E310@1:1 抢胜 | 补 ROOT（环锚点列号随补入位置前移，须重算） |
| parse-vfsl-errors.test.ts | 5/19 | E301×2、E302×1、E106×2 被抢胜 | 补 ROOT；E303/E100~E203 输入为语法相位不受影响 |
| parse-vfsl-jsdoc.test.ts | 5/5 | 4 ok→E310；1 E305 被抢胜 | 补 ROOT；注意 E305 悬空注释场景补 ROOT 后仍须保持 E305 语义 |
| parse-vfsl-r3-regression.test.ts | 3/7 | E106×2、E106+E302×1 被抢胜 | 补 ROOT；负数/注释类语法相位输入不受影响 |
| parse-vfsl-sa7-supplementary.test.ts | 8/8（推断） | 语义相位输入（含 `lines.join` 变量输入）无 ROOT | 补 ROOT（变量构建的输入在行数组中加入 ROOT 行） |
| parse-vfsl.test.ts | 13/13（含 MINI_FIXTURE 命名 fixture） | 全部 ok:true 断言 → E310 | 补 ROOT；**⚠ 空文本 / 纯空白 / 纯注释 3 条断言无法补 ROOT**（见 8.4） |

要点：
1. **E310 锚 1:1 = 语义相位最前位置**，凡缺 ROOT 的模块，其全部语义相位错误（E301/E302/E106/E304~E309）都会被 E310 抢胜——这是规格 min-position 聚合的必然推论，非缺陷。SA3 修法：给相关输入补 ROOT 别名（如 `type ROOT = { … };` 或引用既有别名），并**重算受影响断言的期望行列**（补入位置会推移后续记号列号）；断言意图不变、零删除。
2. 语法 / 词法相位错误（E100~E105、E201~E203、E303）在语法相位即失败，不受 E310/E311 影响。

### 8.4 需 SA1/SA2/SA3 裁决的存量冲突（已在 8.1 按规格锁定）

- **空模块 × E310**：规格 §3「每个模块必须恰好声明一个名为 ROOT 的别名……缺失 → E310」无例外条款；SA6 已锁定 `parseVfsl('')` → E310@1:1。存量 `parse-vfsl.test.ts` 三条断言（空文本 / 纯空白 / 仅注释 → ok:true）与之一致语义冲突——无法以「补 ROOT」对齐，建议 SA1 设计裁决：将期望改为 E310@1:1（用例保留、断言意图从「语法容忍空模块」转为「语义相位要求 ROOT」）。
- **E305 悬空注释 × E310**：`type A = string;\n/** 悬空文档注释 */` 当前 E305@2:1，实施后 E310@1:1 抢胜；补 ROOT 后 E305 恢复胜出——SA3 补 ROOT 时须验证该断言恢复原码。

### 8.5 SA3 实现提示（非约束，供参考）

- `errors.ts` ErrCode 注册表须补 `E310` / `E311`（19 → 21 码，AC 第 9 条 / 红线 7）。
- E311 形状判定建议复用 shapes.ts 的 `clsOf`（map / scalar / container 三分类经别名解析，`YPlainArray` 在根位按标量形拒绝）；锚点 = `AstAlias.type.pos`（类型表达式起点记号）。
- E310 锚点 = 模块起始 (1:1)，与声明位置、前导 trivia 无关。
- ROOT 重复声明不产生 E310/E311，走既有 E302。
- 版本 bump 0.1.3 → 0.1.4（Hard Gate #9）。
