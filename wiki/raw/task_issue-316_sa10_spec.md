# SA10 Spec 审查 — issue #316：codegen 与 readData 投影适配 int/range 叶子（ADR 0020 决策 7/8）

- Dispatch：`sa-db35f528-839a-4398-b88c-ce01104a1864`（mabf-sa10 / spec-review / iteration 0）
- 审查对象：交付提交 `cb207b22172b2c6505e7ab62f6b636e066de73aa`（`test: cover int and range schema projections`），其父即 Parent PR #311 当前 head `bd9fb93dd69d6b27f10113cd98d8dfca9184ce8c`（`feat(vfsl): add Int and Range number constraints (#351)`）——`git log` 亲验 containment 成立
- 审查方式：独立只读复核（Issue body、ADR 0020 决策 7/8、SA6 契约、SA1 设计 iteration 1、SA2/SA3/SA4 产物、`git diff bd9fb93..cb207b2` 全量、源码锚点、sha256 钉值）；不运行测试、不修改任何文件（SA10 技能约束）
- Owner 评论：REST snapshot 为空（派工单明文）⇒ 需求全集 = Issue body 4 条 AC + ADR 0020 决策 7/8，无评论映射义务

---

## 1. Verdict

**`approve`** —— 交付 diff 忠实满足 Issue #316 全部 4 条 AC 与 ADR 0020 决策 7/8，无遗漏、无部分实现、无错误实现、无 scope creep；可选未做项均系设计/契约明示许可，须随 PR 披露（§5）。

## 2. 需求对照（Issue AC → 交付证据 → 判定）

| Issue 要求 | 交付证据（本轮独立复核） | 判定 |
| --- | --- | --- |
| **AC1** 含 Int/Range 字段的 schema 生成 TS 为 `number`，生成物可编译 | 生产锚点本轮亲验在位：`valuetype.ts:35-39`（`case 'int': case 'range': return 'number'`，注释明引决策 7）、`emitter.ts:335` 起 leaf 白名单显式放行 scalar/enum/pattern/int/range/union；既有 10 用例（发射文本逐字 `PathSchema<number, 'leaf'>` + 真实编译器 0 诊断）零改动保留；**新增 C1c**：generated + typed-access consumer 同 program 0 诊断、`@ts-expect-error` 写 `'42'`/`true` 反噬锁定、独立负例恰 1×TS2322（把「投影确为 number」升级为编译器事实）；**新增 C1e**：leaf 结构 + `{kind:'xml'}` 篡改派生物必抛 `structure/value desync`（白名单非 catch-all 的负控） | **满足** |
| **AC2** `pnpm generate --check` 既有生成物零漂移（字节稳定基线不变） | `git diff bd9fb93..cb207b2 --name-only` 对 `packages/*/src`、`domains/`、`docs/`、`.github/`、根配置**零命中**（本轮实测）；`sha256sum domains/vfs3-assets/generated.ts` = `342d8c1f…e6707` 与 SA6/SA1/SA2 钉值逐字节一致（本轮实测）；`schema.vfsl` 无 `Int`/`Range`（0 命中） | **满足** |
| **AC3** 投影路径落在 int/range 叶子上与 pattern 叶子同构（终态/拒绝分类一致） | 生产锚点本轮亲验：`resolve-schema-at-path.ts:289-291` `default` 值级终态（注释列 int/range 与 enum/pattern/scalar/xml 同层）、两枚冻结码定义 `:63-71/:98-103`、形状守卫 `:100-104` 对非 string/number 段判 `SCHEMA_PATH_INVALID` 且 path 新鲜副本；`read-schema-projection.ts:170-183` `cloneValueSchema` int（条件键逐键携带、裸形不补 undefined 槽）/range（双键必在场）。既有 7 用例零改动；**新增 C3b**：FIXTURE 纯追加 `u`/`r` + 无碰撞配对面 `pp`/`ppe`/`ppr`/`ppu`，7 组配对逐组同 ok 性、同码、path 新鲜回显（6×`SCHEMA_PATH_NOT_FOUND` + 1×`SCHEMA_PATH_INVALID`），码集合断言 ⊆ 两枚冻结码；**新增 C3c**：readData 端到端 10 用例（三键恰 `['ok','schema','value']`、预写值 50 可观察、裸 Int 键恰 `['kind']`、range 双键、元素/Record/union 叶、docs 切片含 `ROOT.b`、detached 隔离与污染重读、失败配对 `['b','x']↔['p','x']` 同码 `PATH_NOT_ALLOWED` 且无 `schema` 键） | **满足** |
| **AC4** 包测试、typecheck 全绿 | SA3 报告记录：焦点 3+1 文件 44 用例全绿、`pnpm typecheck` exit 0（14 工程）、新文件 strict tsc 单检 exit 0、`pnpm generate --check` exit 0；SA4 静态复核用例计数与代码逐条可数吻合（13=10+3、16=7+9、10、44=13+16+10+5）；本轮静态复核：三文件无 skip/only/todo/failing（grep 零命中），新增引用（`compileInTempDir`/`formatDiagnostics`/`OUT`/`DERIVED`/`projectedValueSchema`/`DerivedSchema`/`generateProjection`）均解析到既有模块级符号，装置 imports（`@nomicore/persistence`、`@nomicore/vfsl`、`./real-persistence-scheduler.js`、`../src/runtime.js` seam）与既有 #273 测试同款先例 | **满足**（动态运行事实依 SA3/SA4 证据链；SA10 技能约束不复跑） |
| What to build：品牌类型不做（决策 7）；不新增拒绝路径与失败码（决策 8） | 决策 7/8 原文本轮亲验（`docs/adr/0020-vfsl-number-constraints.md:148-159`）：codegen `number` 原样、生成物形状不胀；投影按标量叶下钻、与 pattern 同构、不新增拒绝路径与失败码。交付零生产改动 ⇒ 两决策无被破坏面；C1e/C3b 恰为两决策的回归哨兵 | **满足** |
| Blocked by #315 | HEAD 起点即 #315 集成 PR #351（`bd9fb93`），#316 生产能力已由前序 PR 整体交付（SA6 §4 溯源：`git show --stat bd9fb93` 4 文件 32 行，resolve 文件仅注释级）；本票交付 = 把 SA6 契约的 4 项覆盖缺口固化为回归哨兵测试——与批准设计（iteration 1）的硬性结论一致 | **满足** |

## 3. 设计/契约落实与偏差

- **文件范围**：交付 diff = 3 个测试路径（2 扩展 + 1 新增）+ 5 件 wiki/raw 流程产物（design/sa2/sa3/sa4/sa6）。3 个测试路径与设计 §10 ALLOW 下半段逐字吻合；生产 src、`domains/vfs3-assets/**`、docs、CI/根配置、`readdata-schema-projection-fixture.ts`、`real-persistence-scheduler.ts` 及其余既有测试**零触碰**（本轮 `git diff --name-only` 实测）。wiki 产物随提交入库系仓内既有惯例（父提交 `bd9fb93` 同含 10 件 wiki/raw），非 scope creep。
- **既有断言零改动**：两扩展文件 diff 逐行核验——`generate-int-range.test.ts` 仅头注增补 + 尾部新增 2 个 describe（既有 10 用例原样）；`resolve-schema-at-path-int-range.test.ts` 仅 FIXTURE 首行注释替换 + 末尾追加 6 字段 + 尾部新增 describe（既有 7 用例与字段 `a~e/p/q` 原样）。与 SA2 F2 修订（无碰撞命名 `pp*`）一致。
- **SA2 F1（MAJOR）落实**：T-4 为文件内自包含装置（私有 `TXT_316`/`ENV_316`/`seedRoot316`/`makeHandle316`/`makeReadyRuntime316`），#273 共享 fixture 只读零 diff，`readData(['b'])` 预写值 50 可观察——F1 验收三条件满足。
- **记录在案的偏差**（SA3 Deviations、SA4 §4 均已接受，断言强度不降）：(i) 数组元素类型锚由 `PathValue<PathAt<M,['e',0]>>` 改为 `PathElementValue<PathAt<M,['e']>>`（访问面 path 段限 string，原形态必产 `UnknownPath<[0]>` 假红）；(ii) 野段 `{}` 经 `as unknown as string` 注入形状守卫（仓内 `runtime-readdata-hostile-path-guard.test.ts` 同款先例）。两处均为测试装置精度修正，非验收语义变化。

## 4. 测试质量与防伪绿

- 断言纪律符合 SA6 §12.0：只观察公共接缝（`generateProjection` 发射文本、真实 TS 编译器诊断、`resolveSchemaAtPath`、`readData`/`getStatus`）；正例前置判别在场（C3b 前提用例、C3c ready/预写值前置、C1c 负例反证）；无 skip/软化/吞错；文案不冻结（desync 只钉稳定片段）。
- 敏感性行状齐全（杀死弱实现的证据）：负例恰 1×TS2322（投影退化 any/string ⇒ 0 条红）、`@ts-expect-error` 反噬、desync 负控（白名单放成 catch-all 红）、7 组配对同码 + 码集合 ⊆ 两枚冻结码（新增第三码红）、裸 Int 键恰 `['kind']`（补 undefined 槽红）、detached 污染重读（不 detached 红）、失败配对同码 `PATH_NOT_ALLOWED`（组合面不同构红）。
- 装置 fail loud：`readOk`/`oracle`/篡改前提守卫均显式 throw；ready 轮询有界 5s 超时即红；逐例 `finally await runtime.close()` 生命周期对称。

## 5. 未达成项与 PR 必须披露的内容

| # | 项 | 性质 | 披露要求 |
| --- | --- | --- | --- |
| 1 | T-5 / C1d（CLI 领域端到端：临时领域 `pnpm generate --domains <tmp>` + 新鲜/陈旧 `--check`）未实现 | 设计 §7 T-5 与 SA6 §12.2 均明示**可选强化**；既有 `generate-cli-check.test.ts` 已覆盖新鲜度语义本体 | PR 描述宜注明「可选 CLI 端到端未做，按设计缓做」 |
| 2 | `.test-d.ts` 镜像形态未新增 | 设计 §7 T-1 明示 program 级 / 镜像**二择一**；主落点 program 级已落地 | 宜一句话说明选择 |
| 3 | SA4 N1 未采纳：T-4 首条用例标题仍含 `writeData` 字样（runtime 无 `writeData` 公共键；预写值系构造前 Y.Doc 播种） | MINOR 文案级，无行为影响 | 不阻断；可顺手修正 |
| 4 | AC4 的全量门禁（353+ 文件全量 `vitest run --typecheck`、CI 六分片与 codegen-freshness 作业）未在本交付链内复跑；SA10 亦不运行测试 | 流程性验证缺口（SA3 已跑焦点集 + typecheck + `--check` 全绿；diff 为纯加法测试 + 零生产改动，回归面受控） | PR 合并前由 CI 门禁终验 |

**关键 AC 判定**：无 partial / unmet / unachievable 项。上表均为可选范围外项或流程披露项，不构成本票 AC 缺口。

## 6. 结论

- **Verdict：`approve`**。交付提交 `cb207b2` 是对 Issue #316（What to build + AC1~AC4）与 ADR 0020 决策 7/8 的忠实验收收尾：生产能力（codegen `number` 原样、投影标量叶同构、零新增拒绝路径/失败码）经本轮源码锚点独立复核确在基线 #351 中已交付且未被本票破坏；本票以纯加法测试把 4 项真实覆盖缺口固化为防回归哨兵，字节稳定基线（sha256 钉值）逐字节保持。
- `requiresConflictRecheck: false`：零生产改动、零接口/协议/schema/持久化语义变化；不触碰任何 ADR 冻结面（错误码集合、指纹前缀、docs 切片、域字节基线全部原样）。
