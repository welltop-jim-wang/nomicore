# Rebase 冲突解决档案 — fix/issue-74-on-docs-doc-runtime-validation → origin/docs/doc-runtime-validation (8a42501)

- run_id: issue-74-1787396362-3288866
- 分支: `fix/issue-74-on-docs-doc-runtime-validation`
- rebase onto: `origin/docs/doc-runtime-validation` = `8a42501d208640439066541c7350ff7c477c4bf6`（issue #75 readLogicalValueAtPath 已合入）
- 执行时间: 2026-08（修订轮 rev2 前置）
- 解决原则（总控裁决）: 逐 hunk union-merge，禁止整文件 ours/theirs；版本取语义化更高者；语义无法判定则停摆交总控。

## 1. Rebase 前后 head SHA

| 阶段 | SHA | 说明 |
|---|---|---|
| rebase 前分支 head | `135c79e` | origin/fix/issue-74-on-docs-doc-runtime-validation（rev1 dispatch 终态） |
| rebase 目标（onto） | `8a42501` | docs/doc-runtime-validation（issue #75 合入后） |
| rebase 后新 head | `0c3242b` | 6 个 commit 全部重放成功，工作树干净 |

rebase 后 commit 链（自新至旧）：

```
0c3242b docs(wiki): rev1 dispatch log 终态收口 (issue #74)
f17ee18 docs(wiki): materializeRoot 修订轮 rev1 全流程档案入库 (issue #74)
8e83eaf feat(doc-runtime): materializeRoot ⑤ verifyInstall 顶层完整性校验 + CI 存在性门禁 (issue #74)
365e0f6 docs(wiki): materializeRoot 任务全流程档案入库 (issue #74)
409bd6b test(doc-runtime): 修复 materialize-root 验收测试自身缺陷 (issue #74)
d0e992f feat(doc-runtime): materializeRoot 验证后安全物化 logical ROOT 到 Yjs (issue #74)
8a42501 feat(doc-runtime): readLogicalValueAtPath ... (issue #75) (#83)   ← onto
```

## 2. 冲突清单与解决策略

### 2.1 commit ac0f487（→ d0e992f）—— 3 个文件冲突

#### 2.1.1 `packages/doc-runtime/package.json`（1 处，第 3-7 行）
- 冲突: HEAD `"version": "0.1.4"` vs 本分支 `"version": "0.1.2"`
- 策略: 保留版本更高者 → 取 `0.1.4`（与总控既定策略一致：后续 commit 版本冲突同理取语义化更大值）。

#### 2.1.2 `packages/doc-runtime/src/extract.ts`（1 处，第 228-261 行）
- 冲突: HEAD 侧为 issue #75 新增的 `makeRefResolver` 导出函数块（含 D8 JSDoc + `@internal 包内复用接缝（issue #75）` 说明）；本分支侧为空（分支在该位置把 makeRefResolver 纯移动到 resolve.ts，并新增了 copyPlainValue 的 doc 注释开头 `/**`）。
- 策略（总控裁决）: 保留 HEAD 整个 makeRefResolver 块，然后在其后保留本分支侧的 `/**` 行 → 冲突区替换为「HEAD 内容 + 换行 + `/**`」。
- 实际解决: 冲突区仅删 `<<<<<<<`/`=======`/`>>>>>>>` 三个标记行，天然得到「HEAD makeRefResolver 块 + 空行 + `/**`」；该 `/**`（现第 258 行）与下方既有的 copyPlainValue 注释体（第 259-265 行）衔接为合法 JSDoc。三向合并考古确认：merge-base（3e22795）中 makeRefResolver 为非导出 `function`，HEAD 改为 `export function` 并加 #75 seam 说明；分支则将其移入 resolve.ts。两侧对 copyPlainValue 注释体文本一致，故注释体在冲突区外共同保留。
- **额外发现（超出可见 hunk，同属本冲突解决）**: 分支侧在文件头第 21 行新增的 `import { makeRefResolver } from './resolve.js'`（「自本文件纯移动」）与按裁决保留的 HEAD `export function makeRefResolver`（第 234 行）构成同名冲突（TS2440 Import declaration conflicts with local declaration），文件无法编译。按与 index.ts 出口去重同类的「去重原则」处理：保留 HEAD 定义（裁决要求），删除第 21 行分支侧 import。分支侧其余改动（第 62 行调用点注释措辞「包内自建解析器」→「包内共享解析器」）保留——语义仍准确（extract.ts 定义仍被 read.ts 与自身消费）。resolve.ts（分支新文件）自身定义的 makeRefResolver 不受影响，materialize.ts 继续消费 resolve.ts。

#### 2.1.3 `packages/doc-runtime/src/index.ts`（2 处）
- hunk 1（第 2-6 行，文件头注释）: 合并 issue 编号 → ` * @nomicore/doc-runtime —— Yjs 桥接包公共入口（ADR-0007，issue #73 / #74 / #75）。`（HEAD 侧 #73 / #75，分支侧 #73/#74）。
- hunk 2（第 13-35 行）: 双侧各新增一条公共接缝 bullet + export 语句，全部保留。顺序: 先 HEAD 侧 `readLogicalValueAtPath` bullet + 其两组 export（extract / read），再接本分支侧 `materializeRoot` bullet + 其两组 export（materialize）。单 `/** ... */` 内含 extract、read、materialize 三条 bullet；随后依次 extract exports、read exports、materialize exports。去重: 双侧重复的 `export { extractYjsSnapshot } ...` 与 `export type { ExtractIssue, ExtractResult } ...` 两行只保留一份。

### 2.2 commit 638ad94（→ 8e83eaf）—— 1 个文件冲突 + 1 个自动合并

#### 2.2.1 `packages/doc-runtime/package.json`（1 处，第 3-7 行）
- 冲突: HEAD `"version": "0.1.4"` vs 本分支 `"version": "0.1.3"`（rev1 的 patch bump 0.1.2 → 0.1.3）
- 策略: 保留语义化版本更高者 → 取 `0.1.4`。

#### 2.2.2 `.github/workflows/ci.yml`（自动合并，无冲突标记）
- 分支侧新增「Materialize root tests」存在性门禁（RAC-6，`vitest run packages/doc-runtime/test/materialize-root.test.ts --typecheck --passWithNoTests=false`），与 HEAD 侧 ci.yml 自动三向合并成功（+6 行），无重复、无丢失，门禁块位于「Domain scaffolds check」之后、regen-diff 注释块之前。无整文件覆盖。

### 2.3 其余 commit（d25beb6、529f774、f17ee18、0c3242b）
- 全部干净重放，无冲突（wiki/raw/*.md 双侧新增文件不冲突，rev1 档案与 rev2 档案并存）。

## 3. 交叉检查结论

### 3.1 与 issue #75（readLogicalValueAtPath，HEAD 侧）的交叉
- `read.ts` 第 26 行 `import { makeRefResolver, walk } from './extract.js'` → 合并后 extract.ts 保留 HEAD 的 `export function makeRefResolver`，接缝完整满足；`readLogicalValueAtPath` 及其类型经 index.ts 公共入口导出（保留）。
- extract.ts 内调用点（第 63 行）使用本地定义，行为与 HEAD 一致。
- 结论: issue #75 语义在合并树中零破坏，且与分支侧 resolve.ts 的平行实现（materialize.ts 消费）互不干扰——两套 makeRefResolver 实现各自命名空间独立，无运行时/类型冲突。

### 3.2 与 persistence（issue #79，3e22795）的交叉
- rebase 重放未触碰 persistence 包任何文件；onto 链上 persistence 变更（3e22795）与 6 个重放 commit 无文件交集。无交叉影响。

### 3.3 与 CI workflow 的交叉
- 分支侧门禁与 HEAD 侧 ci.yml 结构自动合并成功；「Materialize root tests」存在性门禁保留且仅一份；`--typecheck --passWithNoTests=false` 语义与 persistence-contract 门禁同款，未引入冲突或重复 job。

## 4. 验证证据

- `git status`: 干净（无 rebase in progress，仅未跟踪的本地元数据 .mabf-done/.mabf/REPORT.md 及 rev2 简报，不入仓）。
- `git log --oneline -8`: 6 个 commit 全部重放于 8a42501 之上（见 §1）。
- 类型检查: `pnpm --filter @nomicore/doc-runtime exec tsc --noEmit` → exit 0（无输出、无错误）。
- 全量测试未跑（总控另行后台执行）；未 push、未新增任何 commit（rebase --continue 重放的 6 个 commit 除外）。

## 5. 遗留说明

- 无「待总控裁决」项。§2.1.2 的 import 去重为本轮唯一超出可见冲突 hunk 的判定，依据总控「保留 HEAD makeRefResolver 块」裁决与 index.ts 出口去重先例作出，已在 §2.1.2 完整记录，供 SA4/总控复核。
