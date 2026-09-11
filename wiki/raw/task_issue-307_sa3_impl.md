# SA3 Implementation Report — issue #307

- 派发：`sa-f06aedf7-3448-487a-b93c-ca3e4294f56d`（role `mabf-sa3`，phase `implementation`，iteration 1）
- Worktree：`/home/wangjian/nomicore-fix-issue-307`（branch `mabf/issue-307`，HEAD `f63b0a5c2fa845aa64b1cf0c5eadb7057b5c20d2`）
- 产出日期：2026-09-11
- 任务：`feat(vfsl-codegen): 联合成员 doc 四发射位（别名联合/枚举多行 + 内联行内前置）`
- 本轮范围：SA9 F1（MINOR，注释枚举措辞与代码/W1 钉死值不符）的最小注释级修正。不改变运行时行为、测试、文件范围或其他产物。

## Inputs consumed

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-307.md`（任务简报，Issue 正文 + AC1–AC4，`## Comments` 空） | 实读 |
| `wiki/raw/task_issue-307_design.md`（SA1 批准设计，D1–D8 / §11 ALLOW-DENY / §12.4 验证门） | 实读（实现依据；§11 ALLOW 行 1 明文含「相关注释更新」） |
| `wiki/raw/task_issue-307_sa9_standards.md`（SA9 `approve`，F1 MINOR + O1/O2 OBS） | 实读（本轮修正依据，修正为 SA9 建议原文） |
| `wiki/raw/task_issue-307_sa6_contract.md`（approved 契约，33 例 + W1/W2 钉死值 + §12.4 五门） | 实读（**未修改**） |
| `wiki/raw/task_issue-307_sa2_review.md`（SA2 `approve`，O1/O2/O3 非阻断精化） | 实读（iteration 0 增量要求基准） |
| `wiki/raw/task_issue-307_sa4_review.md`（SA4 `approve`）、`…_sa7_report.md`（SA7 `approve`）、`…_sa10_spec.md`（SA10 `approve`） | 实读（上游结论；F1 为唯一遗留 MINOR） |
| `wiki/raw/task_issue-307_conflict_report.md`（SA8 `clear`；W1/W2/B1–B3） | 实读 |
| `packages/vfsl-codegen/src/emitter.ts`（L243 W1 闸门注释） | 实读 + 修正（本轮唯一改动点） |

派发说明「Issue 反馈 REST 快照：无评论（none applicable）」与简报 `## Comments` 空一致，无 owner 覆盖性输入。

## Existing worktree reconciliation

- iteration 0 实现（3 个 ALLOW src 文件已修改、契约测试为未跟踪文件）仍在工作树未提交。本轮核对最新设计/SA9 后**保留全部既有实现**，只落实 SA9 F1；未回改任何 iteration 0 逻辑。
- 本轮修正前：`emitter.ts` L243 = 「闸门闭合（无 M4 输入、M3 优先位、部分/全部成员无条目、非 leaf 结构形）」。其中「部分成员无条目」与紧邻代码 `.some((d) => d !== undefined)`（任一成员有非空条目即开闸）及 SA6 §12.2 W1 钉死值（部分成员有 doc → 全成员多行）矛盾。
- 本轮修正后：L243 = 「闸门闭合（无 M4 输入、M3 优先位、全部成员无条目、非 leaf 结构形）」，与代码及契约一致；同注释前两句 W1 判据原文未动。
- 契约测试（DENY 行 1）未触碰：sha256 `b9c87b9ea0360f04362214a2eaeb769f5d03ec17ac11e158742edf1676189e64`、mtime `2026-09-11 14:09:56`、mode 600——与 iteration 0 报告记录逐字相同。
- 无其他同类失实措辞残留：`grep -rn "部分" packages/vfsl-codegen/src/` 无命中。

## Changed paths

| Path | Design section | Change |
|---|---|---|
| `packages/vfsl-codegen/src/emitter.ts` | §11 ALLOW 行 1「四发射位唯一生产改动面 + 相关注释更新」；SA9 F1 | iteration 0 实现全部保留（D1 EmitTables 第四槽/接线、D2 发射位 1、D3 发射位 2 W1 闸门多行、D4 发射位 3、D5 发射位 4、`memberDocsAt`/`memberBlock`/`memberInlinePrefix`、「七槽→八槽」注释）；**本轮唯一改动**：L243 闸门闭合枚举「部分/全部成员无条目」→「全部成员无条目」（删「部分/」二字） |
| `packages/vfsl-codegen/src/docs.ts` | D7 | iteration 0 保留：抽 `tsdocBlock`（保形）+ 新增 `tsdocInline`；文件头三槽→四槽 |
| `packages/vfsl-codegen/src/valuetype.ts` | D6 | iteration 0 保留：新增 `projectUnionMembers`；`projectValue` enum/union 保形重构 |
| `wiki/raw/task_issue-307_sa3_impl.md` | 本报告 | SA3 固定产物位（skill 规定路径；非生产路径，不在 DENY 列表内） |

生产改动合计仍 3 文件、+120/−14 行（本轮为已加入行的文本替换，行数统计不变）；无新增/删除生产文件。emitter.ts 当前 sha256 `63fd9150f34ac24896bb70abf0f95f9cbec39ebd6a2771472512ac82b88fc56f`。

## SA2 Finding 落实（iteration 0，保留有效）

| Finding ID | Implementation | Result |
|---|---|---|
| O1（MINOR）空 memberDocs 条目应视同缺席 | `memberDocsAt` 判据 `docs !== undefined && docs.length > 0 ? docs : undefined`——空数组条目既不开 W1 闸门也不产行内前缀 | 落实。探针 A/B：手造全空数组条目的输出与「表缺席」逐字节相同；无 doc 金样本单行形态保持 |
| O2（MINOR）畸形非 leaf 坍缩别名必须保留既有 desync | D3 闸门含 `node.kind === 'leaf'`——非 leaf 结构形闸门恒闭合，继续走既有 `emitInner`（case `'union'` → `desync`） | 落实。探针 A/B：与 HEAD 抛同一条 `structure/value desync` 诊断 |
| O3（MINOR，R3 行内位多行 doc 体） | 设计已登记为「已定义语义、非未决」 | 无需动作（维持登记） |

## SA9 Finding 落实（本轮）

| Finding ID | Implementation | Result |
|---|---|---|
| F1（MINOR）L243 枚举「部分/全部成员无条目」不实：部分成员有条目时闸门**开启** | 逐字采纳 SA9 建议，删「部分/」二字 → 「全部成员无条目」；前文 W1 判据（存在非空条目 → 多行）原文保持 | **落实且为本轮唯一改动行**。机械证明：变更源行数 = 1（纯注释），去注释 JS 逐字节相同；W1「部分成员有 doc → 全成员多行」契约用例仍绿（95/95） |
| O1（OBS）契约测试权限位 600 | 非本任务动作项（git 仅跟踪可执行位） | 无需动作（维持登记） |
| O2（OBS）头注「实测 HEAD 4d4208b」为 rebase 前历史基线锚引 | 非本任务动作项；f63b0a5 未触 codegen 字节面 | 无需动作（维持登记） |

## File scope check

| Changed path | ALLOW entry | Purpose |
|---|---|---|
| `packages/vfsl-codegen/src/emitter.ts` | ALLOW 行 1（含「相关注释更新」） | iteration 0 D1–D5 + 助手；本轮 SA9 F1 注释修正 |
| `packages/vfsl-codegen/src/docs.ts` | ALLOW 行 2 | D7 |
| `packages/vfsl-codegen/src/valuetype.ts` | ALLOW 行 3 | D6 |
| `wiki/raw/task_issue-307_sa3_impl.md` | 非生产路径；skill 规定的 SA3 固定产物位；不在 DENY | 本实现报告 |

DENY 核对（本轮与 iteration 0 均未触碰）：`packages/vfsl-codegen/test/generate-union-member-docs.test.ts`（hash/mtime/mode 三重比对未变）、其余 `test/**` 与 `tsc-helper.ts`、`packages/vfsl/**`（含 `resolve-schema-at-path.ts`=#308）、`docs/vfsl/**`（#309）、`cli.ts`/`collect.ts`/`index.ts`/`header.ts`/`protocol-surface.ts`、`domains/**`（含 `domains/vfs3-assets/generated.ts`）、`packages/vfsl-protocol/**` 及其余 `packages/**`/`apps/**`、Host 只读 wiki 输入（设计/契约/评审产物）。未执行任何 git 操作（无 add/commit/push/PR/finalize）。

## Verification

| Command | Result | Evidence |
|---|---|---|
| comment-only 机械证明（`/tmp/sa3-f1/proof.mts`，tsx 调 TypeScript `transpileModule`；F1 前副本 = 当前文件反向 sed 还原文本） | **变更源行数 = 1**（仅 L243 注释）；`removeComments: true` 去注释 JS **逐字节相同**（sha256 `e74c0ae84c5957b2604944a7a1f3ce82c6951cf302051165bcc75a4be23db470`，14221 B，前后同值） | 本轮改动为零可执行语义变化的纯注释修正 |
| `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/vfsl-codegen --reporter=basic` | **9 文件 / 95 passed (95)**，Type Errors: no errors，exit 0 | 33 契约例全绿（含 W1「部分成员有 doc → 全成员逐行多行」钉死用例、CLI 双格式端到端、孤立 tsc 零诊断）+ 既有 62 例金样本全绿 |
| `pnpm --filter @nomicore/vfsl-codegen typecheck` | **exit 0** | 受影响 package typecheck（`tsc -p packages/vfsl-codegen/tsconfig.json`） |
| `pnpm generate --check`（仓根） | **exit 0** | 存量 `domains/vfs3-assets/generated.ts` 新鲜；注释级改动零生成物字节影响 |
| `pnpm typecheck`（仓根，14 tsconfig 串行） | **exit 0** | AC4 根 typecheck 门 |
| `pnpm test`（仓根，`vitest run --typecheck`） | **316 文件 / 3351 passed (3351)**，Type Errors: no errors，exit 0，时长 591.69s | 包 AGENTS 收官门（含 codegen 95 例、`packages/vfsl` M4 输入链、`domains/vfs3-assets` 类型用例）；最终裁决仍属 SA7 |
| `git status --short` / `git diff --stat` | 仅 3 个 ALLOW src 文件被修改 + 未跟踪契约测试与 Host wiki 输入；生产 diff +120/−14 | 无越界、无新增生产文件、无残留探针文件（临时脚本在 `/tmp/sa3-f1/`，不在 worktree 内） |

## Deferred verification

- SA7 收官：干净环境（`pnpm install --frozen-lockfile`）复跑设计 §12.4 全部门并作验收裁决；本报告根 `pnpm test` 结果可供参考，但不替代 SA7 独立复跑。
- SA9 F1 已闭环，无新增遗留项；SA9 O1/O2 维持登记（非动作项）。
- R3（行内位多行 doc 体）设计登记为「已定义语义、非未决」；SA4 N2（发射位 1 部分 doc 无专属契约用例）为覆盖面注记，非实现缺陷——均非本任务欠账。
- 回滚 = revert 三个 src 文件（无持久化状态、存量生成物零影响）。

## Deviations or blockers

- 无阻塞项。本轮为 SA9 建议的逐字落实（删「部分/」二字），未扩大范围：未改测试、未改设计/契约/其他 wiki 输入、未改运行时行为、未引入 env override/fallback/静默降级/skip。
- 唯一自主判断：修正措辞选用 SA9 建议原文「全部成员无条目」（语义 = 该位点无任一成员携带非空条目，与 `.some((d) => d !== undefined)` 及 W1 判据「存在非空条目」一致）；未改任何代码或断言。

## Suggested commit message

```
feat(#307): vfsl-codegen 联合成员 doc 四发射位（别名联合/枚举多行 + 内联行内前置）

- emitter: EmitTables 接线 derived.memberDocs；emitAlias 块位（判别联合）+ W1 闸门多行（坍缩别名）；
  emitInner union/leaf 行内前置；memberDocsAt/memberBlock/memberInlinePrefix
- valuetype: projectUnionMembers 分段单一真相源（projectValue enum/union 保形重构）
- docs: tsdocBlock 抽取 + tsdocInline（W2 行内位）
- 注释：修正 W1 闸门闭合枚举（SA9 F1）——「部分/全部成员无条目」→「全部成员无条目」（零行为变化）
- 无成员 doc 路径逐字节不变（存量 generate --check fresh）；契约 33 例红转绿（95/95）
```
