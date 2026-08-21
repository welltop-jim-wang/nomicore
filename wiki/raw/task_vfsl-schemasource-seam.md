# 任务简报 — 功能开发：SchemaSource 接缝与脚手架文件格式（Issue #25 / F1）

- **任务类型**: feature（ADR 0005 票拆分 F1：接缝 + FileSchemaSource + 方言断言 + 脚手架校验 CI，无依赖可即发）
- **Worktree**: /home/wangjian/nomicore-fix-issue-25
- **分支**: fix/issue-25-on-adr-vfsl-protocol（基点 55a55c0，无本地提交）
- **Parent**: PR #23
- **run_id**: issue-25-1787202593-27067

## 背景

ADR 0005 已冻结投影生成管线的接缝形状与脚手架文件格式（§1/§2）。本票 F1 落地该接缝与
`.vfsl` 脚手架格式，为 F2（生成器）、G（domains dogfood）铺路。ADR 0001 修订节的脚手架
纪律：一切消费方经 SchemaSource 接缝取文本，脚手架不长成承重墙；阶段实现 = 仓内文件源，
终态切 DocSchemaSource 时零消费方改动。

## 工作内容

实现 ADR 0005 §1/§2：

1. **`SchemaSource` 接口**：`load(id) → Promise<信封>`、`list() → Promise<id[]>`，async
   从第一天起（接缝按终态设计，不按脚手架现状设计）；返回完整信封
   `{ lang, version, id, text }` 而非裸文本；
2. **`FileSchemaSource`**：扫描 `domains/*/`，解析 `.vfsl` 头部指令注释
   `// @lang/@id/@version` 并组装信封，`text` = 整个文件原文（含头部，逐字节一致，
   内容哈希直接）；
3. **方言断言助手**：`lang==='vfsl' && version===1`，否则响亮失败（结构化错误，非静默兜底）；
   头部三键缺失 / 方言不符 / 未知 id → 响亮拒绝；
4. **CI 增加脚手架校验步骤**：全部领域文件可解析（`parseVfsl` ok）+ 头部三键齐备
   （`.github/workflows/ci.yml`）。

## Acceptance criteria

- [ ] 接缝形状符合 ADR 0005 §1（async、完整信封、list 枚举）
- [ ] 头部三键缺失 / 方言不符 / 未知 id → 响亮拒绝（结构化错误，非静默兜底）
- [ ] 带头部的 `.vfsl` 文件 `parseVfsl` 直接 ok（trivia 性质验证——行注释是方言 trivia，
      零预处理零微格式）
- [ ] `text` 与文件原文逐字节一致；`id`/`version` 解析自头部
- [ ] CI 步骤：全领域脚手架解析 + 信封校验

## 核心参考文档

- `docs/adr/0005-projection-generation-pipeline.md` — §1 接缝、§2 文件格式（本票冻结契约）
- `docs/adr/0001-vfsl-single-source-of-truth.md` — 修订节（目标态/阶段态二分、脚手架纪律）
- `docs/adr/0004-vfsl-protocol-type-projection.md` — D3 协议包边界（本票不含生成器/协议包）
- `CONTEXT.md` — 术语规范（信封/方言/脚手架纪律用词以此为准）
- `docs/vfsl/v1-spec.md` — v1 规格（注释 trivia 行为、§2 语法子集）

## 仓库事实（SA 共用）

- **术语规范**: `CONTEXT.md`（信封 = `{ lang, version, id, text }`；方言 = lang+version）
- **既有架构决策**: `docs/adr/0001–0005` 不得违反——特别是 0001 修订节「脚手架纪律」、
  0005 §1 接缝形状与 §2 文件格式（`@` 前缀指令注释是文件格式约定，不是语义层机器标签；
  ADR 0001 无机器标签条款不触及）、0005 §5（领域包位置：顶层 `domains/`）
- **关键代码**: `packages/vfsl/src/`（公共入口 `index.ts` 导出 `parseVfsl`/`evaluate`/
  `validateSnapshot`；信封类型尚未定义——F1 新增）
- **测试**: `packages/vfsl/test/`（现有 15 个测试文件；issue #29 收官时全量全绿）
- **测试命令**: 根目录 `pnpm test`（vitest run，include `packages/*/test/**/*.test.ts`）；
  类型检查 `pnpm typecheck`（tsc -p packages/vfsl/tsconfig.json）
- **CI**: `.github/workflows/ci.yml`（push main / PR；pnpm install → typecheck → test；
  matrix node 20/24）
- **workspace**: `pnpm-workspace.yaml` 现仅 `packages/*` + `apps/*`（`domains/` 是否入
  workspace 由 SA1 设计定夺）
- **版本**: `packages/vfsl/package.json` 当前 0.1.7；改动该包须 bump patch（Hard Gate 9）
- **`domains/` 现状**: 尚不存在（F1 首建；是否放置首个领域 `.vfsl` 文件由 SA1 定夺——
  ADR 0001 修订节已放行仓内脚手架，测试 fixture 除外条款亦在）

## ⚠️ 本会话环境约束（总控 2026-08-20 记录，所有 SA 必读）

本会话运行环境**无 shell**：DSH 进程沙箱后端缺失（bubblewrap/Landlock 均不可用），
任何命令执行（bash/exec/git/pnpm/vitest/tsc）一律被 harness 拒绝——总控与子代理均已
实测确认。因此：

1. SA 只能用文件工具（read/glob/grep/write/edit）工作；
2. **禁止任何 SA 声称「已运行测试/命令」**——一切验证只能做静态推演（读代码逐行追踪
   行为），并在产出文件中明确标注「未执行（本会话无 shell），静态推演」；
3. 红灯证据以构造性论证代替运行证据：被测导出尚不存在 → vitest import 即失败 →
   测试文件必然全红；
4. 测试执行、tsc、git commit 由后续会话（shell 恢复后）补做；总控在 REPORT.md 如实
   记录 blocked 状态，绝不伪造绿灯。

> ✅ **环境恢复更新（2026-08-20 ≈13:39，总控）**：会话恢复后 shell 已可用（bwrap 后端
> 在线）。自本时刻起：执行类验证一律实跑（后台独立进程）；SA 派发回归 `acpx exec`
> 正规机制（SA3/SA6 走 claude-deepseek，其余走 claude）。上节约束仅对恢复前的产物
> （SA6 R1 的静态推演记录）有效。总控亲跑 SA6 R1 红灯发现**伪红**：测试文件块注释内
> 含 `domains/*/`（`*/` 提前终止注释）→ esbuild 转译失败、套件未收集（证据：
> .mabf-bg/sa6-red.log）。已打回 SA6 R2 修复并要求真红灯证据。

## 纪律

- TDD：先写红测试再改代码；SA3 不得在测试契约锚定前动生产代码
- 本地测试红必须修，禁止屏蔽/跳过/排除测试
- **TASK.md 是调度器写入的工作区文件，不得进入分支 commit**；`.mabf-bg/` 同纪律
- 改动模块 bump patch 版本（Hard Gate 9）
- wiki/raw/ 产出文件必须随分支 commit（由具备 shell 的会话执行）
- PR 创建与推送由外部 `check.sh` 负责，总控与所有 SA 一律不得执行

---

## SA6 红灯测试记录（issue #25 / F1 — SchemaSource 接缝）

> 本记录由 SA6 于 2026-08-20 写入。**所有验证均为「未执行（本会话无 shell），静态推演」**
> ——本会话进程沙箱后端缺失，任何命令（vitest/tsc/git）被 harness 拒绝；红灯证据由
> **构造性论证**给出（见「红灯构造性论证」节）。vitest 执行/tsc 类型检查由 shell 恢复后
> 的会话补做；总控在 REPORT.md 如实记录状态。
>
> ⚠️ **R2 更新（2026-08-20）**：shell 恢复后，SA6 已实跑验证红灯——真红灯证据见
> 「R2 修复与真红灯证据」节。上述「未执行」标注仅对 R1 静态推演产物有效。

### 测试文件

```
packages/vfsl/test/schemasource-seam.test.ts
```

- vitest include 为 `packages/*/test/**/*.test.ts` → 本文件落在 `packages/vfsl/test/` 下，
  `pnpm test` 可跑到。
- 类型检查：`pnpm typecheck`（tsc -p packages/vfsl/tsconfig.json）。

### 选址理由

SchemaSource 接缝 + FileSchemaSource + 方言断言是 F1 落地的核心，属 vfsl 包职责边界
（ADR 0005 §2 的 `.vfsl` 文件格式、方言 `lang==='vfsl' && version===1`，与 `packages/vfsl`
既有的方言/解析逻辑同域）。任务简报明确「公共入口 `index.ts` 导出 parseVfsl/evaluate/
validateSnapshot；**信封类型尚未定义——F1 新增**」——信封与接缝形状预期在本包新增。
生成器包 `@nomicore/vfsl-codegen`（F2 落地）不承载本票接缝，`domains/`（顶层）是业务
schema 包不暴露公共导出。故测试锚定 `packages/vfsl/test/`，import 沿用既有 ESM 惯例
`../src/index.js`（同 `parse-vfsl.test.ts` / `validate-snapshot.test.ts`）。
**若 SA1 后续设计把接缝放到新包/新目录，须与总控协调、不得擅改本测试语义**（简报纪律）。

### 断言清单与 AC 映射

| AC | 断言（describe / it） | 断言条数 |
|----|----------------------|---------|
| AC1 接缝形状 async/完整信封/list 枚举 | AC1: load/list 返回 Promise（`toBeInstanceOf(Promise)`，async from day one）；AC1: load 返回完整信封 `{lang,version,id,text}` 四键（`objectContaining` + `Object.keys` 精确等于四键，防夹带）；AC1: list 枚举多 `.vfsl` id（`toContain` ×2 + 数量上限） | 8 |
| AC2 响亮拒绝 | AC2a 缺 lang / 缺 id / 缺 version 逐键缺 → `missing-directive`（`rejects.toMatchObject({kind,code})`，每键 2 断言）；AC2a 三键全缺 → 结构化拒绝不静默兜底（2 断言）；AC2b lang≠vfsl / version≠1 → `dialect-mismatch`（各 2 断言）；AC2c 未知 id → `unknown-id`（2 断言） | 14 |
| AC3 trivia 性质 | 带头部指令注释的合法 vfsl 文本 `parseVfsl` 直接 `ok: true`（断言 ok + module 含 Info 别名最小锚点；顺带验证头部指令注释不要求剥头/免微格式） | 2 |
| AC4 text 逐字节 + id/version 解析自头部 | `text === 盘上原文 body`（`toStrictEqual`）；text 含三键头部（`toContain` ×3）；`env.id`/`env.version`/`env.lang` 自头部解析（`toBe`）；`version` 为 `number` 类型（非字符串） | 8 |
| AC5 CI 脚手架校验 | 无独立单元测试（为 ci.yml 工作流步骤，infra 面向）；由 list()+load() 完整信封 + parseVfsl-ok 的**运行时断言**组合支撑（CI 步骤「全领域解析 + 信封校验」正是这些行为的批量化）。CI 步骤存在性由 SA3 实现 + SA4/SA7 验证覆盖 | — |
| **合计** | 6 个 describe · it 用例 **13**；断言总数 **32**（`expectStructuredReject` 助手单文件 2 断言 × 6 次调用复用 → 运行时断言 = 文件级 +10） | 32 |

### 红灯构造性论证（为何必然红 — 未执行，静态推演）

> ⚠️ **R2 已以实跑证据取代本节**：本节的构造性论证结论已被实跑证实——套件可收集、
> 失败模式恰为「被测导出不存在」（`FileSchemaSource is not a constructor`），实跑统计
> 见下节「R2 修复与真红灯证据」。本节保留作 R1 历史记录。

本测试文件 `import { FileSchemaSource, parseVfsl } from '../src/index.js'`。当前
`packages/vfsl/src/index.ts` **不导出** `FileSchemaSource`（公共面仅 parseVfsl/evaluate/
validateSnapshot 及其类型）——接缝 + FileSchemaSource + 信封类型全部尚不存在（F1 新增）。
ESM import 解析时，vitest 加载该模块因「不存在导出 FileSchemaSource」立即失败 →
**整个测试文件在文件加载阶段即崩溃，13 个用例无一能跑绿（不可能经过行为断言）**。
这是构造性论证：被测导出不存在 → import 即失败 → 必然全红；不需要实际运行即可确定。
（注：`parseVfsl` 是既有公共导出；AC3 单凭它原本是绿，但因文件整体 import 失败而一并红。）

### R2 修复与真红灯证据（2026-08-20，SA6 亲跑实跑）

**修复内容（仅两处块注释，断言/契约/用例结构零改动）**：

1. 文件头注释（原第 26 行）：`domains/*/` → `domains/<domain>/`（该行两处出现）；
2. `makeDomainsFixture` 的 JSDoc（原第 56 行）：`domains/*/` → `domains/<domain>/`。

根因：块注释内字面量 `domains/*/` 含 `*/` 序列 → 提前终止注释 → 余文被 esbuild 当代码
解析（`Expected ";" but found "domains"`，总控 R1 证据 `.mabf-bg/sa6-red.log`）。改后全文件
`*/` 仅存于块注释终止符 / 单行 `/** */` 注释 / 字符串字面量（grep 复核）；字符串字面量中的
`domains/*/`（it 标题第 149 行）无害，未动。其余代码语义零改动。

**红灯运行（SA6 亲跑，后台独立进程 setsid nohup + 退出码捕获，2026-08-20 13:43）**：

```
cd /home/wangjian/nomicore-fix-issue-25 && pnpm exec vitest run packages/vfsl/test/schemasource-seam.test.ts
```

- 退出码：**1**（套件失败，预期红灯；log 见 /tmp/sa6-r2-red.log）
- 统计：**Test Files 1 failed (1)** · **Tests 12 failed | 1 passed (13)**
- 失败模式（12/12 全部一致，无其他种类混入——`grep -oE 'TypeError: .*'` 唯一种类计数 12）：
  `TypeError: FileSchemaSource is not a constructor`——被测导出 `FileSchemaSource` 尚不
  存在（F1 未实现），正是「缺导出」失败模式；套件**可收集**（无 esbuild 转译错误残留、
  无 fixture 路径错误）。
- 唯一通过用例：AC3 `parseVfsl` 直接 ok——锚定既有公共导出（R1 简报已注明 AC3 单凭
  自身即绿），非伪绿；SA3 落地 FileSchemaSource 后本用例保持绿属预期。

**全量存量（零回归确认，2026-08-20 13:43）**：

```
cd /home/wangjian/nomicore-fix-issue-25 && pnpm exec vitest run
```

- 退出码：**1**（唯一原因即本红灯文件，符合预期；log 见 /tmp/sa6-r2-full.log）
- 统计：**Test Files 1 failed | 15 passed (16)** · **Tests 12 failed | 342 passed (354)**
- 唯一失败文件为 `packages/vfsl/test/schemasource-seam.test.ts`（预期红）；其余 **15 个
  既有测试文件全绿**，342 条既有断言零回归。

> **R2 结论**：红灯为真——套件可收集、失败模式恰为「缺导出」、全量存量零回归。
> R1 的「红灯构造性论证」结论成立，但已由本节实跑证据取代（上节注明）。

### 契约定形说明（SA3 / SA1 必须遵守）

1. **接缝形状**（ADR 0005 §1 冻结，不再二次议价）：
   `SchemaSource { load(id): Promise<SchemaEnvelope>; list(): Promise<string[]> }`，
   信封 `SchemaEnvelope { lang: string; version: number; id: string; text: string }`
   ——`load` 返回**完整信封**而非裸文本；`load`/`list` 均 async。
2. **响亮失败渠道 = Promise rejection**：`load` 返回类型是 `Promise<SchemaEnvelope>`
   （非结果联合），因此失败必须走 **reject**，而非 `{ok:false}` 联合值（那会改变签名）。
   **绝不静默兜底**：不得 resolve 降级/空信封、不得吞错返回空串/null。这呼应
   `parseVfsl` 的「不抛错、错误走返回值」纪律——两条接缝按各自签名定渠道。
3. **错误形状（结构化、可判别）**：reject 值须为带判别字段的 `Error` 子类：
   `{ kind: 'schema-source'; code: 'missing-directive'|'dialect-mismatch'|'unknown-id'; id? }`。
   三个 code 语义：
   - `missing-directive`：头部三键缺失（逐键缺或全缺）；
   - `dialect-mismatch`：`lang !== 'vfsl'` 或 `version !== 1`（方言断言失败）；
   - `unknown-id`：`load` 传入的 id 无任何已注册文件命中。
   测试断言用 `rejects.toMatchObject({ kind, code })`——SA3 可在结构 `StructureError` 基类
   + `extends Error` 上实现。
4. **构造入参**：`new FileSchemaSource(domainsRoot)`，其中 `domainsRoot` 目录下含
   `domains/*/`，扫描 `domains/*/` 全部 `.vfsl`。若 SA1 定不同入参/字段语义，需与总控
   协调改本测试的构造行（当前按 ADR §5「顶层 domains/」多级扫描的最小合理形状定形）。
5. **id/version 解析**：`id` 解析自头部的 `// @id:`、`version` 解析自 `// @version:`（数值），
   `lang` 自 `// @lang:`；`list()` 返回所有已注册 id。
6. **fixture hermetic**：测试在临时目录（`mkdtemp`）内联生成 `domains/*/` 文件（node
   `fs/promises`/`os`/`path` 内置，零 npm 依赖，不依赖仓内 `domains/` 真实文件、不依赖
   网络/端口），每用例独立建目录、无共享状态 → 可独立运行、顺序无关。

### 变更清单（本 SA 阶段）

- 新增测试：
  `packages/vfsl/test/schemasource-seam.test.ts`（行为断言，无源码 GREP → 合规）。
- 未改：`src/`、`vitest.config.ts`、`package.json`（bump patch 属 SA3）、`.github/workflows/ci.yml`（AC5 属 SA3）、`scripts/test-lock.sh`（未新增端口/常驻进程依赖，故无需更新）。
