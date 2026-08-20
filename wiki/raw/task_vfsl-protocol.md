# 任务简报 — vfsl-protocol 类型协议包：编译期路径投影机制（issue #24）

- **Worktree**: /home/wangjian/nomicore-fix-issue-24
- **Branch**: fix/issue-24-on-adr-vfsl-protocol（base 为父 PR #23；push/PR 由外部 issue-runner/check.sh 负责，总控与 SA 一律禁止 `git push` / `gh pr create`）
- **任务类型**: 功能开发（Feature）
- **完成事务**: run_id `issue-24-1787203233-7108`
- **术语规范**: `/home/wangjian/nomicore-fix-issue-24/CONTEXT.md`（VFSL / 结构树 / 值 schema / 判别联合 / ROOT / 标记类型——用词以该词汇表为准；注意 `YPlainArray` 大小写是契约）
- **必读架构决策（不得违反）**:
  - `docs/adr/0004-vfsl-protocol-type-projection.md` — **本任务主 ADR**：D1 数组语义 / D2 联合投影宽度 / D3 包形态（纯类型零运行时 + 空 `VfslPathMap` fail-closed）/ D4 类型测试装置 / D5 路径不含 ROOT 前缀
  - `docs/adr/0001-vfsl-single-source-of-truth.md` — 修订节（目标态/阶段态二分；投影回到范围内、不参与运行时判定）
  - `docs/adr/0005-projection-generation-pipeline.md` — 生成器（票 F）与协议包的边界：协议包**不含生成器**，本票用手写迷你增广
  - `docs/adr/0003-evaluator-derived-schema.md` — 结构树 kind 词汇与联合表示的语义依据（投影映射的对象）
- **现有代码**: `packages/vfsl/`（引擎包，`@nomicore/vfsl` 0.1.7，parser/evaluate/validateSnapshot 已交付）；**`packages/vfsl-protocol` 尚不存在**——本票从零建包
- **根配置现状**: `vitest.config.ts`（`include: packages/*/test/**/*.test.ts`，未开 typecheck）；根 `package.json` scripts：`test: vitest run`、`typecheck: tsc -p packages/vfsl/tsconfig.json`；`.github/workflows/ci.yml`：Node 20/24 矩阵，`pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm test`
- **包版本纪律**: 新包 `@nomicore/vfsl-protocol` 起始 `0.1.0`

## ⚠️ 本轮环境约束（所有 SA 必读，2026-08-24 立案）

本 worktree 所在主机**命令执行能力不可用**（沙箱后端缺失，bash 一律被拒，且无审批通道）：

1. **禁止尝试执行任何命令**（`pnpm` / `npx` / `git` / `node` / `acpx` 等，一律失败）。一切检查用文件读取/检索工具完成，一切产出用文件写入工具完成。
2. **测试无法在本轮真实运行**。红灯/绿灯验证**延期**到具备命令执行能力的会话补跑。任何 SA 不得伪造测试运行输出——「未执行」必须如实标注为「未执行，延期验证」。
3. **`pnpm install` 无法运行** → 新增 workspace 包必须**手工补 `pnpm-lock.yaml` 的 `importers` 条目**（照抄 `packages/vfsl` 条目格式：typescript ^5.9.3 / vitest ^3.2.4，锁版本 5.9.3 / 3.2.7），否则 CI 的 `pnpm install --frozen-lockfile` 必炸。该文件必须出现在 SA1 设计的 ALLOW LIST，SA4 需专项复核其格式与既有条目逐字一致。
4. SA 派遣机制本轮以 harness 子代理替代 `acpx`（dispatch log 有记录）。SA 各自 SKILL.md 中凡涉及「跑测试/起服务/git diff」的步骤，均按上述第 1/2 条改写为「静态检查 + 如实标注延期」。

## SA6 红灯测试记录（2026-08-25 追加）

> 上一任 SA6 因环境故障未产出任何文件；本轮 SA6 按分支 A.2（Feature 验收测试）从头完成本阶段。

### 测试文件清单

| 文件（均相对 worktree `packages/vfsl-protocol/test/`） | 类型 | 锚定验收点 |
|---|---|---|
| `vfsl-protocol-projection.test-d.ts` | vitest typecheck（含 `declare module` 增广） | §8.4 正/负例矩阵、D1、D2、D5（路径无 ROOT 前缀、`kindOf([])`→'map'）、增广经 declare module 生效 |
| `vfsl-protocol-empty-fail-closed.test-d.ts` | vitest typecheck（独立编译单元，**无**增广） | 空 `VfslPathMap` fail-closed（任何 patch/read 编译错误） |
| `vfsl-protocol-empty-module.test.ts` | 普通 vitest 运行时 | 编译产物为空模块（零运行时）——namespace import 后 `Object.keys(...).toEqual([])` |

### 用例 → 验收标准映射表

| 用例（文件内 describe/it） | 锚定验收标准/契约 |
|---|---|
| 正例 1/2/3：`patch(["name"], string)`、`patch(["portraitResourceId"], string\|null)`、整实体写入（判别联合形态） | §8.4 正例 1/2/3；AC「写 name 接受 string、portraitResourceId 接受 string\|null、整实体写入接受实体类型」 |
| 正例 4：read 返回精确类型（name/portraitResourceId/成员独有字段/判别字段/整实体） | §8.4 正例 4；D2（成员独有字段 read→T\|undefined、判别字段精确字面量联合、整值编辑判别联合） |
| 正例 5：整值读出判别联合，按 kind 窄化访问成员独有字段 | D2「整值读出发射判别联合（可 tsc 窄化）」 |
| 正例 6：kindOf 投影 kind，含 `kindOf([])→'map'` | §8.4 正例 5；D5 路径无 ROOT 前缀 + 空路径根分支 |
| D1 正例：数组下标段可解析、值类型精确 | D1 数组 Record<string, 元素子树> |
| D1 负例：YPlainArray 下钻 → UnknownPath | D1 YPlainArray 终态 |
| D2 正例：成员独有字段 patch 值→声明处类型 T、判别字段精确字面量 | D2 member-only patch→T |
| 负例 1：`patch(["name"], 42)` | §8.4 负例 1（值类型错误） |
| 负例 2：未知路径（未声明字段/不存在下标段） | §8.4 负例 2；D1/D2 键空间语义 |
| 负例 3：整实体写入缺必填字段 | §8.4 负例 3 |
| 负例 4：数组下标值类型错误 | §8.4 负例 4 |
| fail-closed 1/2/3：patch/read/kindOf 任意路径 | AC「空 VfslPathMap fail-closed」 |
| 空模块：运行时 namespace 键集为空 | AC「编译产物为空模块（零运行时）」 |

### 预期红灯表现（运行验证延期）

`@nomicore/vfsl-protocol` 包**尚不存在**——三个测试文件对 `@nomicore/vfsl-protocol` 的 import 一律抛 TS2307（module not found）：类型测试编译单元全红、运行时测试 import 失败即红。这是预期的红灯锚点。实现后（SA1 设计 + SA3 落地），上述文件应在 `vitest run --typecheck` + `vitest run` 下转绿：正例 `expectTypeOf` 相等、负例 `@ts-expect-error` 均为真实错误（任何负例被误放行即自我反转失败）、空模块运行时键集为空。

### ⚠️ 运行验证延期声明

**本环境命令执行不可用**（任务简报 §环境约束第 1/2 条）：本轮 SA6 未实际执行任何测试命令，未伪造任何测试运行输出。「红灯需带执行证据」的门禁由后续具备命令执行能力的会话补跑红灯验证（`pnpm vitest --typecheck` / `pnpm vitest run`）后，将 PASS/FAIL 证据回填本记录。

## What to build

实现 ADR 0004 冻结的 `@nomicore/vfsl-protocol` 包（设计文档 §8.3 机制的落地）：**纯类型、零运行时、零依赖**的编译期路径投影协议，位于 `packages/vfsl-protocol`。导出：

- 幻影 `unique symbol` 口袋（防任意类型冒充投影节点）
- `PathSchema<Value, Kind>` 载体
- `PathAt<Map, Path>` 类型级路径解析（**含空路径 `[]` → 根节点分支**）
- `PathValue` / `PathKind` 取值
- `UnknownPath<Path>` fail-closed 标记
- `VfslPathMap` 空表（接口；未增广时一切路径解析为 `UnknownPath` → 任何 `patch`/`read` 调用编译错误）
- `VfslTypedAccess` 接口：`patch` / `read` / `kindOf` + D1 序列编辑三件套 `appendToArray` / `insertIntoArray` / `deleteFromArray`（下标为显式参数）

语义约束（ADR 0004）：

- kind 词汇表：`'map' | 'array' | 'xml-fragment' | 'leaf' | 'plain'`
- **D1**：数组节点带 `Record<\`${number}\`, 元素子树>` 子树（patch 下标段可解析，值类型精确）；`YPlainArray` 终态（下钻 → `UnknownPath`）
- **D2**：联合键空间 = 各成员字段键集之并集；成员独有字段 read → `T | undefined`、patch 值 → `T`；判别字段为精确字面量联合；整值读出发射判别联合（可 tsc 窄化）；路径级窄化不做
- **D3**：全部内容为类型空间产物——编译产物为空模块；devDependencies 仅 tsc/vitest；不含生成器、不含工厂/默认值、不进引擎包
- **D5**：`VfslPathMap` 顶层键 = ROOT 的字段（路径无 `ROOT` 前缀）；`kindOf([])` → `'map'`

测试装置（D4）：**vitest typecheck 模式**；正例 `expectTypeOf`（类型相等断言）、负例 `@ts-expect-error`（自我反转断言：该行被错误放行时测试反而失败）。**手写**迷你 `VfslPathMap` 增广（生成器是票 F 的职责，本票用精简手写表复刻设计文档 §8.4 实测矩阵）——增广经 `declare module '@nomicore/vfsl-protocol'` 生效。

## §8.4 实测矩阵（本票权威来源——外部设计文档不可达，以本节为准）

手写迷你增广表须覆盖以下正负例（字段名按此使用）：

**正例矩阵**：
1. 写 `name` 接受 `string`（如 `patch(['…','name'], 'ok')` 编译通过）
2. 写 `portraitResourceId` 接受 `string | null`（可空 leaf）
3. 整实体写入接受实体类型（判别联合形态）
4. `read` 返回精确类型（`name` → `string`；`portraitResourceId` → `string | null`；成员独有字段 → `T | undefined`；判别字段 → 精确字面量联合；整实体 → 判别联合且可被 tsc 以判别字段窄化）
5. `kindOf` 投影出 kind（含 `kindOf([])` → `'map'`）

**负例矩阵**（`@ts-expect-error`）：
1. `patch(name, 42)` — 值类型错误
2. 未知路径（未声明字段 / 不存在的下标段）
3. 整实体写入缺必填字段
4. 数组下标值类型错误

**D1 行为**：数组下标段可解析且值类型精确；`YPlainArray` 节点终态（继续下钻 → `UnknownPath` → 编译错误）。
**D2 行为**：见上「正例矩阵 4」。
**D5 行为**：路径无 `ROOT` 前缀。

## Acceptance criteria

- [ ] 包导出齐备且编译产物为空模块（零运行时）、devDependencies 仅 tsc/vitest
- [ ] 空 `VfslPathMap` fail-closed：未增广时任何 `patch`/`read` 调用编译错误
- [ ] §8.4 正例矩阵复刻：写 `name` 接受 string、`portraitResourceId` 接受 `string | null`、整实体写入接受实体类型、`read` 返回精确类型、`kindOf` 投影出 kind
- [ ] §8.4 负例矩阵复刻（`@ts-expect-error`）：`patch(name, 42)`、未知路径、整实体缺必填字段、数组下标值类型错误
- [ ] D1 行为：数组下标段可解析且值类型精确；`YPlainArray` 节点终态（下钻 → UnknownPath）
- [ ] D2 行为：联合成员独有字段 read 类型为 `T | undefined`；判别字段为精确字面量联合；整值读出发射判别联合（可 tsc 窄化）
- [ ] D5 行为：路径无 ROOT 前缀；`kindOf([])` → `'map'`
- [ ] 增广经 `declare module` 生效；CI 纳入 `vitest --typecheck`（Node 20/24 均过）

## 工程接线要求（SA1 设计须钉死，SA3 落地）

1. 新包 `packages/vfsl-protocol/package.json`：name `@nomicore/vfsl-protocol`、version `0.1.0`、private、type module、exports `.` → `./src/index.ts`、devDependencies 仅 typescript ^5.9.3 + vitest ^3.2.4（照抄 `packages/vfsl/package.json` 形态）
2. `pnpm-lock.yaml` importers 手工补条目（见环境约束第 3 条）
3. 根 `vitest.config.ts` 接入 typecheck 模式（含新包 type 测试文件的 include / tsconfig 指向）
4. 根 `package.json`：`test` 脚本须使 `pnpm test` 在 CI 内跑 `vitest run --typecheck`（或等价接线）；`typecheck` 脚本覆盖新包
5. `.github/workflows/ci.yml` 的 Test 步骤经由根脚本获得 typecheck 覆盖（如仅改根脚本即可满足则不动 yml）
6. Wiki 文件（本简报、design、sa2/sa4/sa7 报告、dispatch log）随代码一起 commit
