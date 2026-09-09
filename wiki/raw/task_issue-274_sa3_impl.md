# SA3 Implementation Report — Issue #274 文档同步：typed-access 与 docs/integration 覆盖 readData 语义 schema 投影（ADR 0016）

- Worktree：`/home/wangjian/nomicore-fix-issue-274`（branch `mabf/issue-274`，HEAD `6ab8c87`）
- Phase：implementation（iteration 0，dispatch `sa-843a4a11-e5bf-4dda-93fa-435e5b633e28`）
- 任务类型：feature（纯文档同步，零生产/测试/规范面改动）
- 状态：**完成**——SA6 红契约 7/7 转绿（两种终态各复跑 1 次），负控 21/21 保持绿；registry 全套件 412/412 绿；`pnpm typecheck` exit 0；`git diff --check` 干净。

## Inputs consumed

| 输入 | 位置 | 使用 |
|---|---|---|
| 任务简报 | `wiki/raw/task_issue-274.md` | What to build 六要点 + AC1–AC3 |
| dispatch | `wiki/raw/task_274_dispatch.md` | Issue comments REST = `[]`，无 owner 要求 |
| SA1 设计（最新批准） | `wiki/raw/task_issue-274_design.md` | §6（typed-access 新节）/§7（cordis 注记）/§8（external 可选段）/D6（交叉指针）/§10 ALLOW+DENY/§12 验收映射 |
| SA2 设计评审 | `wiki/raw/task_issue-274_sa2_review.md` | approve（0 MAJOR/0 MINOR；F-1 LOW 勘误确认无 Required action） |
| SA6 验收契约 | `wiki/raw/task_issue-274_sa6_contract.md` | R1–R7 红契约 + 21 负控 + 夹具；裁决 approve |
| SA8 设计后冲突复审 | `wiki/raw/task_issue-274_design_conflict_report.md` | clear；§8.1（D6 行号勘误 L44→L43）、§8.2（D6 与「纯加法」表述分开陈述） |
| 夹具（SA6 冻结） | `packages/namespace-registry/test/readdata-docs-adr0016-contract-fixture.ts` | matcher 语义逐条亲读（R1–R7 + 负控 8 matcher） |

## Existing worktree reconciliation

- 进入时 `git status` = SA6 契约 3 文件 + wiki 输入/产物 6 文件 untracked；**生产实现与既有文档零改动**（无 SA3 先前行残留——本票 iteration 0 首次实现，不存在待修订状态）。
- 作用域文档现状与设计/SA6/SA2/SA8 描述一致（typed-access.md 153 行无 schema 投影覆盖、插入点 L106/L108 在位、D6 子弹实测 L43；cordis L340–341 两键注记在场；external §5 适配器段 L286 在位）。

## Changed paths

| Path | Design section | Change |
|---|---|---|
| `.agents/skills/nomicore/typed-access.md` | §6（必改，R1–R6）+ D6（可选推荐） | ① L106 段后、`## Mutation policy` 前插入新节「Read result: value plus semantic schema projection」五段（§6 建议文本**逐字采用**：R1 ADR 0016 相对链接 + R2 同段 readData+schema projection + R3 无空行四键 bullet 块 + R4 isomorphic/synthetic 键规约段 + R5 null 判读段 + R6 消费段）；② L43 子弹追加交叉指针（SA8 §8.1 行号勘误：以**文本匹配**定位，非 L44） |
| `docs/integration/cordis-plugin-hosting.md` | §7（必改，R7/AC2） | L340–341 替换：调用上方新增两行中文说明注释（三键恰形 + null 判读 + ADR 0016 指向），注记行替换为含 `schema` 的三键形状 `// { ok: true, value: 'first', schema: { valueSchema, aliases, docs, aliasDocs } }`；示例代码调用行本身与 L360 `readData(['count'])` 零改动 |
| `docs/integration/external-project-vfsl-codegen.md` | §8（可选推荐，采纳） | §5 L286 段之后新增一段（§8 建议文本逐字采用：schema 加法说明 + `[ADR-0016](../adr/0016-…md)` 首个 ADR 链接）；§5/§6 示例代码零改动 |
| `wiki/raw/task_issue-274_sa3_impl.md` | 实现报告 | 本文件（SA3 本轮写入） |

**与「纯加法」表述的关系（SA8 §8.2）**：新节插入与 §8 段增补为**纯加法**（既有内容逐字保留）；D6 是对 L43 既有子弹的一行**追加式编辑**（原文保留 + 括注交叉指针），与纯加法分开陈述。二者均为设计 ALLOW 内「可选推荐」项，终态采纳。

## SA2 Finding落实

| Finding ID | Implementation | Result |
|---|---|---|
| F-1（LOW，勘误确认，非阻塞）D6 行号 off-by-one（L44→实测 L43） | 以文本匹配定位子弹（`the adapter calls public NamespaceLease.readData() and mutateData();` 全仓唯一），未盲信行号；落位于 L43 | ✅ 关闭 |
| N-1（nit，可选润饰）CONTEXT.md 词条提及加链接 | 未采纳（保持 §6 建议文本逐字——链接权威源 ADR 0016 已在场，SA2 判不构成违规；零改动降低负控误触风险） | 不处理（MINOR/nit 级别，理由如上） |
| N-2/N-3（observation） | 无需动作 | — |
| SA2 §8 移交 2：两种终态（含/不含 §8）都验证 | 见 Verification——两种终态 red+control 均 7/7 + 21/21 绿 | ✅ 落实 |

## File scope check

| Changed path | ALLOW entry | Purpose |
|---|---|---|
| `.agents/skills/nomicore/typed-access.md` | ALLOW 表第 1 行（必改：L106/L108 间插入 §6 新节；可选推荐：D6 交叉指针） | AC1 六要点唯一落点（R1–R6） |
| `docs/integration/cordis-plugin-hosting.md` | ALLOW 表第 2 行（必改：L340–341 注记同步；L360 不动） | R7/AC2 矛盾注记修正 |
| `docs/integration/external-project-vfsl-codegen.md` | ALLOW 表第 3 行（可选推荐：§5 L286 后新增一段；示例代码零改动） | 加法闭合指引缺口（§8） |
| `wiki/raw/task_issue-274_sa3_impl.md` | 实现报告（skill 固定输出） | 记录改动与验证 |

**DENY LIST 零触碰**（`git status` 实测）：SA6 三契约文件仍 untracked 原样（未改）；ADR 0016/0008、CONTEXT.md 未动；`packages/**`、`apps/**`、`domains/**`、`tests/**`、根 AGENTS.md、其余 skill/integration 文档、README 均未动。

## Verification

| Command | Result | Evidence |
|---|---|---|
| 基线（实现前）：`NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run …sync-red.test.ts …sync-control.test.ts --typecheck.enabled=false` | 红契约 **7/7 红**（R1–R7 断言失败消息逐条点名缺口，R7 精确定位 L341）、负控 **21/21 绿** | Test Files 1 failed / 1 passed；Tests 7 failed / 21 passed |
| 终态 A（含 §8）：同上命令 | 红契约 **7/7 绿** + 负控 **21/21 绿** | Test Files 2 passed；Tests 28 passed（1.38s） |
| 终态 B（临时移除 §8 段后）：同上命令 | 红契约 **7/7 绿** + 负控 **21/21 绿** | Test Files 2 passed；Tests 28 passed——§8 可选项不破坏验收（设计 §12） |
| 终态 A 恢复后 registry 全套件：`… vitest run packages/namespace-registry/test --typecheck.enabled=false` | **35 files / 412 tests 全绿**（= SA6 基线 405 + 本票红契约 7；无任何回归） | Test Files 35 passed；Tests 412 passed（50.48s） |
| `pnpm typecheck`（仓根） | **exit 0**（14 个 package/app tsconfig 顺序 tsc，零错误） | AC3 终态门 |
| `git diff --check` | **clean**（docs/AGENTS 验证面） | 零输出 |
| 新相对链接可达性 | 两处均实测可达：`../../../docs/adr/0016-readdata-semantic-schema-projection.md`（自 `.agents/skills/nomicore/`）、`../adr/0016-…md`（自 `docs/integration/`） | `ls -l` 命中（8409 bytes） |
| D6 锚 slug | `Read result: value plus semantic schema projection` → `#read-result-value-plus-semantic-schema-projection`，与文本锚逐字一致 | 目检 |
| 陈旧注记全仓扫描：`grep -rEn "// *\{ *ok *: *true" --include="*.md"`（排除 wiki/raw、ADR 0016 自身） | 仅剩 cordis L343 一处且**含 `schema`**（修正后站点）——0 违规残留 | R7 契约同口径 |
| `readData(path, …)` 带参/opt-in 扫描（负控，控制文件内建，扫三作用域文档） | 0 命中 | 负控 21/21 绿含该项 |

## Deferred verification

- 全仓 `pnpm test`（`vitest run --typecheck`，AC3 全仓终态门另一半）：文档改动不进 tsc Program，本票 zero 代码变更；registry 全套件已实测 412/412 绿。全仓聚合跑由总控/SA7 执行（skill 边界：SA3 不承担全仓测试）。
- SA6 三契约文件在本票终态仍为 untracked（冻结产物由总控在 commit 时收纳）。
- SA4 语义评审焦点（SA2 §8.3）：§6 段 1 括注「(value domains, literal unions, constraints)」为 ADR L8/L10 的举例式转述——文本逐字采用 SA1/SA8 已对照措辞，无窄化。

## Deviations or blockers

**无 blocker、无 reject、无偏差。**

- 设计建议文本（§6 新节 / §7 注记 + 说明 / §8 段）**逐字采用**，未改写句式——消除「SA3 改写丢锚」风险（设计 §13）。
- 可选推荐项（D6、§8）均采纳：SA2 模拟 + 本会话实测证明两种终态契约全绿；D6/§8 属 ALLOW 明列预期改动。
- N-1（CONTEXT 链接润饰）未采纳——nit 级、零义务；采纳反而偏离 SA2/SA8 逐字验证过的文本。
- 未运行 `git add`/`commit`/`push`/PR（skill 边界）。

## Suggested commit message

```
docs(#274): typed-access 与 docs/integration 同步 readData 语义 schema 投影（ADR 0016）

- .agents/skills/nomicore/typed-access.md：新增「Read result: value plus
  semantic schema projection」小节（成功读三键形状/四键投影体/docs 键规约同构/
  null 判读/detached 深拷贝/读后 mutation 消费），并给 Process item 6 子弹加交叉指针
- docs/integration/cordis-plugin-hosting.md：readData(['title']) 示例注记同步为
  含 schema 的三键形状 + null 判读说明（L360 加法兼容不动）
- docs/integration/external-project-vfsl-codegen.md：§5 追加 readData schema
  加法说明段（示例代码零改动）

SA6 验收契约 7/7 红转绿，负控 21/21 保持；registry 面 412/412；pnpm typecheck exit 0
```
