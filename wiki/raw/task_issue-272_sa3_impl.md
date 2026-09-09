# SA3 Implementation Report — issue #272：vfsl 公开 `resolveSchemaAtPath` 路径解析器（ADR 0016）

## Inputs consumed

- 任务简报：`wiki/raw/task_issue-272.md`（issue #272，open；issue comments REST 读取为空——无 owner 反馈）
- 批准设计：`wiki/raw/task_issue-272_design.md`（SA1 iteration 1——SA2-F1 修订版，§8 接口/算法为落地蓝本；§11 ALLOW/DENY LIST 为范围硬边界）
- SA2 设计评审：`wiki/raw/task_issue-272_sa2_review.md`（verdict reject：1 MAJOR SA2-F1——keyPattern 引擎错误通道修订已并入设计迭代 1，本实现照迭代 1 执行）
- SA6 红灯契约：`wiki/raw/task_issue-272_sa6_contract.md` + 契约测试四文件（`packages/vfsl/test/resolve-schema-at-path{,-fixture,-control,.test-d}.ts`，红 34 + 类型 3 + 负控 11，DENY LIST 只读，零改动）
- SA8 冲突报告/复审：`wiki/raw/task_issue-272_conflict_report.md`（clear）、`task_issue-272_conflict_recheck.md`（clear）——红线 1（InternalError throw 逃逸公共面，不降级联合）与红线 3（drillStep 同构不分叉）为硬约束
- 基线：HEAD `a6b2a79`（branch `mabf/issue-272`）

## Changed paths

| Path | Design section | Change |
|---|---|---|
| `packages/vfsl/src/resolve-schema-at-path.ts`（新建） | §8.1–§8.6、§9（D9 模块落位） | 公共类型 `ReadDataSchemaProjection` / `ResolveSchemaAtPathResult` + 公开函数 `resolveSchemaAtPath` + 私有助手（值侧规范化/形态匹配/Record keyPattern 单点分类器/闭包收集/docs 切片/失败分类） |
| `packages/vfsl/src/index.ts` | §11 ALLOW 行 2（AC1） | 新增导出块：`export { resolveSchemaAtPath }` + `export type { ReadDataSchemaProjection, ResolveSchemaAtPathResult }`（自新模块，带 JSDoc 注释） |
| `packages/vfsl/src/validate-patch.ts` | §11 ALLOW 行 3（D1/D9 同构单源） | `drillStep` / `DrillResult` / `structureLens` 三处新增模块级 `export` + 包内复用注释（零行为改动——git diff 核验仅关键字/注释） |
| `packages/vfsl/AGENTS.md` | §11 ALLOW 行 4（SA8 红线 5） | Contract normative 清单补 ADR 0016（含 0008 D8 修订节指引）；Boundaries 补「resolveSchemaAtPath 的 derived 为可信域入参 → throw InternalError 显式例外 + keyPattern 引擎四类错误 fail-closed 对偶句」 |
| `packages/vfsl/test/resolve-schema-at-path-pattern-errors.test.ts`（新建） | §11 ALLOW 行 5 / §12（SA2-F1 验收锚） | 三枚确定性引擎错误夹具（`Pattern<"[">` 编译失败 / `\1` 子集外 / `a{20000}` 超限）：parse+evaluate ok 前置 + 值树 keyPattern 携带断言 + `['r','k']` → NOT_FOUND（不 throw）+ `['r',7]` → INVALID（形状隔离）+ 红线 1 对照（同派生物 ref 缺失仍 throw InternalError） |

SA6 契约四文件（DENY）、`derived.ts`/`resolve.ts`/`evaluate.ts`/`validate.ts`/`pattern.ts`/`parser.ts`/`semantic.ts`（DENY）、doc-runtime/namespace-runtime/registry（DENY）、docs/adr/**（DENY）零改动。

## 实现要点（设计对位）

1. **双游标逐段**：结构侧逐字复用 `drillStep`（模块级导入，同构单源——SA8 红线 3）；值侧镜像游走（optional 透明解包路径不变；ref 逐跳 own 守卫查表 + in-flight 名集防环、锚名切换为该 ref 名；union 全成员静态展开、成员 i 语法路径 0 基）。
2. **Record keyPattern 单点分类器（D7/SA2-F1）**：`acceptRecordSlot` 单层 try/catch 包 `compile`+`match`；`instanceof` 精确识别四类引擎错误 → 一律内容级 keyPattern 拒绝（与失配同标记同码 NOT_FOUND、不细分）；四类之外 → 包装 `InternalError`（throw 通道纯度）；成功编译产物按正则串每调用局部缓存、失败不缓存。
3. **失败分类（D8）**：结构侧 out 空时按尝试形态集分类——既无「map+string」也无「array+非负整数」可行组合且无终态（leaf/plain/xml-fragment）在场 → INVALID；其余 → NOT_FOUND（分类先于且独立于 keyPattern 判定）。契约锚定 9 例全部命中预期码。
4. **两树分歧（D7a）**：值侧 out 空且无 keyPattern 拒绝标记 → `InternalError`（可信域畸形，无顶层 catch）。
5. **终点合成/闭包/切片（§8.4–8.6）**：单候选原样引用（optional/ref/判别式全保留）；多候选合成 `{kind:'union',members}` 恰两键恒无判别式；闭包 DFS 发现序 + 名集去重 + 节点身份防环；docs = 脊柱 ∪ 终点子树后代 ∪ 闭包别名内部（field 在前 marker 在后逐字合并、空条目过滤）；aliasDocs 仅闭包别名浅拷贝；ok 分支恰五键；失败 path 为全量新鲜副本。
6. **入口规整（§8.2 + 通道纯度硬化）**：path 形状守卫先于一切 derived 访问（非数组 → INVALID path=[]；野段 → INVALID 全量副本）；derived 可信域守卫把**本函数消费的全部七项**（structure/values/aliases/fieldDocs/markerDocs/aliasDocs + root/ROOT）缺失统一收为 `InternalError`——手造垃圾派生物（如 `{}`）不向调用方泄漏裸 TypeError，维持「本函数 throw 的只有 InternalError」通道纯度（自检探针实证后硬化，见 Verification）。

## Verification

| 门 | 命令 | 结果 |
|---|---|---|
| 契约翻绿（红 34 + 新增 Pattern 锚 4） | `vitest run packages/vfsl/test/resolve-schema-at-path.test.ts packages/vfsl/test/resolve-schema-at-path-pattern-errors.test.ts` | 2 files passed / 38 tests passed / type errors none |
| vfsl 全量（含负控 11 + 类型面 test-d） | `vitest run packages/vfsl/test` | 32 files passed / 600 tests passed / Type Errors no errors（基线 29 文件 560 + 红 34 + Pattern 家族；零 skip/only） |
| vfsl 包 typecheck | `tsc -p packages/vfsl/tsconfig.json` | exit 0 |
| 根仓 typecheck（14 包） | `pnpm typecheck` | exit 0（TS2305 ×3 消失；其余包零回归） |
| 根仓 test | `pnpm test` | 见文末 run 输出（全仓零回归） |
| 自检探针（设计未锚定路径，临时文件跑后即删） | `['u']`→ref U+闭包{U}；`['keywords',1.5]`/`['assets',1.5]`→INVALID；跨别名 union 终点合成两键；敌意 path → INVALID 新鲜副本；`null`/`{}`/`[]` derived → InternalError | 4/4 pass（探针文件已删除，不在提交面） |

偏差说明：无设计偏差。设计 §8.2 入口守卫在「derived 非对象/根缺失 → InternalError」前提下按本函数消费面补全为七项在场检查（含三张 docs 表），属守卫完备化而非行为分歧——SA6 契约与设计 §8.6 对照表全部断言逐条通过，实现后未修改任何契约测试。
