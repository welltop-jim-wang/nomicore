# 任务简报：vfs3.assets 全链路端到端演示 — parseVfsl → evaluate → validateSnapshot（issue #32，Phase 0 收官）

- **任务类型**: 功能开发（Feature）
- **Worktree**: /home/wangjian/nomicore-fix-issue-32
- **Branch**: fix/issue-32-on-adr-union-representation
- **Parent PR**: #17（stacked，base 由外部 issue-runner/check.sh 推导；总控与 SA 一律禁止自行创建 PR / push）
- **Blocked by**: #21（validateSnapshot）—— 已合入（HEAD `705575b` 已含 validateSnapshot 整份 JSON 快照校验）

## 背景与术语

- 术语规范见仓库根 `CONTEXT.md`（VFSL / 求值器 / 派生 schema / 整文档校验 validateSnapshot / 判别联合 / 封闭对象 / 结构树 / 值 schema / 路径索引 / 零写入等，措辞必须对齐）。
- ADR：`docs/adr/0001`（单一真相源）、`docs/adr/0002`（authority 范围外）、`docs/adr/0003`（求值器与派生 schema：evaluate 接缝、ROOT 约定、§3 联合 any-of + 判别式缓存 + 「联合成员 i/N」、§4 按名引用、§5 YXmlFragment 不透明终态——**fixture 修订版 ROOT=YMap，YXmlFragment 位于 AssetEntity text 成员 body 字段**）。**不得违反任何 ADR。**
- 规格：`docs/vfsl/v1-spec.md` §10 = vfs3.assets 参考 fixture（修订版）。**fixture 文本以 §10 为准**；`packages/vfsl/test/` 内已有 fixture 副本，如发现副本与 §10 不一致，以 §10 为准修正。
- 既有实现：`packages/vfsl/src/`，公共导出 `parseVfsl` 与 `evaluate`（`src/index.ts`）；`validateSnapshot` 已在 #21 落地。测试在 `packages/vfsl/test/*.test.ts`（vitest，仓库根 `pnpm test`）。

## What to build

Phase 0 收官演示：一个端到端编排测试文件，以 spec §10 fixture 走通三层——「同一段文本驱动解析、物化推导、数据校验」：

1. `parseVfsl(fixture)` → ok（解析）
2. `evaluate(module)` → ok（派生 schema）
3. `validateSnapshot(derived, snapshot)`（整文档校验）

内容要求：

- **正例**：构造内容完整的合法资产文档快照（image/text/file 三类资产 + audit + attachments + notes + keywords 全覆盖）→ validateSnapshot `ok:true`。
- **派生 schema 关键节点断言**：ROOT map 形态、assets Record 键模式、AssetEntity 判别式缓存（kind 三值）、text 成员 body 的 xml-fragment 终态、attachments 的 plain 终态。
- **docs 抽查**：派生 schema 的 ROOT/Audit/AssetEntity 节点携带 fixture 的 JSDoc 原文。
- **非法快照矩阵**（每面至少一例，断言 issue 的 path **段数组**精确）：未知键 / 必填缺失 / 值类型错 / AssetId Pattern 键违例 / 联合 no-match（带「联合成员 i/N」）/ YPlainArray 子树值错 / XML 非良构字符串 / kind 枚举外值。

## 边界（重要）

- **不重复单点覆盖**：解析行为属 #9 既有测试（`parse-vfsl*.test.ts`）、校验器单点属 #21 既有测试（`validate-snapshot*.test.ts`）。本票只做**全链路编排断言**——同一 fixture 驱动三层串联的证据。
- 预期为纯测试票：不改 `packages/vfsl/src/`。如全链路串联暴露实现缺陷，按 MABF 流程记录于 wiki 并回报总控，不得静默绕过或删断言。

## Acceptance criteria（全部满足才算完成）

- [ ] 全链路正例：fixture → parse ok → evaluate ok → 完整合法快照 validateSnapshot ok:true
- [ ] 派生 schema 关键节点断言：ROOT map 形态、assets Record 键模式、AssetEntity 判别式缓存（kind 三值）、text 成员 body 的 xml-fragment 终态、attachments 的 plain 终态
- [ ] docs 抽查：派生 schema 的 ROOT/Audit/AssetEntity 节点携带 fixture 的 JSDoc 原文
- [ ] 非法快照矩阵（每面至少一例，断言 issue 的 path 段数组精确）：未知键 / 必填缺失 / 值类型错 / AssetId Pattern 键违例 / 联合 no-match（带「联合成员 i/N」）/ YPlainArray 子树值错 / XML 非良构字符串 / kind 枚举外值
- [ ] fixture 文本以 spec §10 为准（测试文件中已有副本可对齐，如发现副本与 §10 不一致以 §10 为准修正）
- [ ] 不重复单点覆盖（解析行为属 #9 既有测试、校验器单点属 #21 既有测试），本票只做全链路编排断言

## 核心参考文档（SA 前置阅读，≤10 文件）

1. `CONTEXT.md`（术语规范）
2. `docs/vfsl/v1-spec.md` §10（fixture 原文）+ §3（标记类型语义：xml-fragment / YPlainArray 物化）
3. `docs/adr/0003-evaluator-derived-schema.md`（联合表示 / ROOT 约定 / docs 三表）
4. `packages/vfsl/src/index.ts`（公共导出接缝）
5. `packages/vfsl/test/evaluate-derived-docs-typecls.test.ts`（派生 schema / docs 既有断言风格）
6. `packages/vfsl/test/validate-snapshot.test.ts`（#21 校验器单点既有断言风格）

## 工程纪律

- 测试跑法：仓库根 `pnpm test`（vitest run）；类型检查 `pnpm typecheck`（tsc -p packages/vfsl/tsconfig.json）。无 scripts/test-lock.sh。
- 测试命令一律后台独立进程（setsid nohup），禁止前台同步阻塞。
- 如本票修改了 `packages/vfsl` 包代码 → bump 其 `package.json` patch 版本（Hard Gate #9）；纯测试新增不改 src 则无需 bump。
- 所有产出沉淀到 `wiki/raw/task_vfsl-assets-fullchain-e2e*.md`；每个 SA 阶段红/绿落地后**立即在 worktree 内 git commit**（防 supervisor 剪枝丢工作）。
- 禁止 `git push`、禁止自行创建 PR（PR 由外部 issue-runner/check.sh 负责）。

---

## SA6 红灯测试记录（2026-08-20，SA6 Phase 1 验收锚定）

### 测试文件

- `packages/vfsl/test/vfsl-assets-fullchain-e2e.test.ts`（16 条用例 / 4 个 describe）
- 测试命令：`pnpm vitest run packages/vfsl/test/vfsl-assets-fullchain-e2e.test.ts`（或全量 `pnpm test`）
- 类型检查：`pnpm typecheck` —— 通过（tsc -p packages/vfsl/tsconfig.json，exit 0）
- 无新增测试包 / 端口依赖；仓库无 `scripts/test-lock.sh`，无需更新

### 测试设计（AC 映射）

- **AC1 全链路正例**（2 条）：同一段 §10 fixture 文本逐层串联——`parseVfsl(fixture)` ok → `evaluate(parse 的 module)` ok → `validateSnapshot(evaluate 的 derived, 完整合法快照)` `{ ok: true }`。快照覆盖 image/text/file 三类资产 + audit + attachments + notes + keywords 全字段（AC1 内容要求逐项在场性先验断言）。
- **AC2 派生 schema 关键节点**（5 条）：ROOT map 形态（structure root 包裹 map，字段声明序 assets/attachments/audit/notes/keywords，notes optional:true）；assets Record 键模式（`index['ROOT.assets.<key>']` = pattern 条目，keyPattern = AssetId 解码后正则 `^[A-Za-z0-9_\-]{1,64}$`，node = union）；AssetEntity 判别式缓存（`{ field:'kind', byValue:{image:0,text:1,file:2} }`，成员 3 个）；text 成员 body = `{ kind:'xml-fragment' }` 终态（ADR 0003 §5 不透明、无 children）；attachments = `{ kind:'plain' }` 终态（YPlainArray 纯值上下文不可下钻）。
- **AC3 docs 抽查**（1 条）：派生 aliasDocs 的 ROOT / Audit / AssetEntity 三条 JSDoc 与 fixture 原文逐字相等（含前导/尾随空白）。
- **AC4 非法快照矩阵八面**（8 条，每面断言 issue 的 path 段数组精确）：① 未知键 `['extraKey']`；② 必填缺失 `['attachments']`；③ 值类型错 `['assets','img1','url']`；④ AssetId Pattern 键违例 `['assets','abc.123']`（path 含违例键段）；⑤ 联合 no-match——`{kind:'video'}` 触发「联合成员 2/3」（text 成员失败距离最小，与 #21 既有冻结契约一致）+ path `['assets','img1']`；⑥ YPlainArray 子树值错 `['attachments',1]`（含下标段）；⑦ XML 非良构字符串 `['assets','text1','body']`；⑧ kind 枚举外值——其余字段齐全仅 kind 不匹配 → 「联合成员 1/3」（image 成员失败距离最小）+ path `['assets','img1']`。
- **AC5 fixture 对齐**：§10 原文与既有测试副本 diff 仅差 TS 源码转义层（源码 `\\\\` → 运行时 `\\`，与 §10 文本逐字一致），无实际偏差；本文件副本与 §10 对齐。
- **AC6 不重复单点覆盖**：全部 16 条断言均以同一 §10 文本驱动 parse → evaluate → validate 三层串联（`chainDerived()` 逐层传递：evaluate 消费 parse 的 module、validate 消费 evaluate 的 derived），未重写 #9 解析单点 / #21 校验器单点（ReDoS、截断上限、判别式缓存透明等均不重复）。

### 运行证据（真实结果，2026-08-20 11:00 运行）

单文件：`Test Files 1 passed (1) / Tests 16 passed (16)`；全量套件：`Test Files 15 passed (15) / Tests 341 passed (341)`（基线 325 + 本文件 16，零回归）；`pnpm typecheck` exit 0。

### 结论（红/绿定论与本票性质说明）

- **全链路验收锚定**：16/16 首跑即绿——三层实现（parse #9 / evaluate #28 / docs #30 / validateSnapshot #21）均已合入且满足本票全部 AC；**全链路串联未暴露任何实现缺陷**，无需按简报「如串联暴露缺陷」路径回报总控。
- **红灯语义说明（非伪红）**：本票为收官演示的纯测试票（简报明确「预期为纯测试票：不改 `packages/vfsl/src/`」），「待实现物」即本编排验收锚本身。断言全部锚定可观测运行时行为：负例断言仅在校验器**真实拒绝**非法快照且 path 段数组精确时才通过（AC4-4/5/8 的 path 与「联合成员 i/N」定位为既有测试从未断言过的新锚点）；任一三层实现回归（如 path 不精确、判别式缓存缺失、docs 丢失）即红灯。测试非「永远通过」假绿——缺任一契约面即失败。
- 工程纪律：纯测试新增未改 `packages/vfsl/src/`，按 Hard Gate #9 无需 bump 版本。

> **总控勘误（2026-08-20，据 SA2 R1 攻击点 2）**：上文 SA6 记录中「path 与『联合成员 i/N』定位为既有测试从未断言过的新锚点」表述不准确——「联合成员 2/3」消息锚已被 #21 既有用例冻结（`validate-snapshot.test.ts:399-411`）；准确表述为：**path 段数组断言与面 8 的「联合成员 1/3」定位为新增锚点，面 5 的 2/3 消息锚与 #21 同构（增量 = 链式驱动 + path 数组断言）**。SA6 原文保留以存档，以本勘误为准。
