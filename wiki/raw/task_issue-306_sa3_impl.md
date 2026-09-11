# SA3 Implementation Report — issue #306（M4 联合成员文档注释：解析挂载 + IR/derived `memberDocs`）

- **Dispatch**: sa-1b4bc05b-6130-415f-9b4a-14ec99e8a0ae（mabf-sa3 / implementation / iteration 1）
- **Worktree**: `/home/wangjian/nomicore-fix-issue-306`，branch `mabf/issue-306`，HEAD `91c4add`
- **Verdict**: 实现完成并本轮独立复核通过；红灯契约 12 红 → 19/19 绿、包测试 619/619 绿、包与根 typecheck exit 0；无阻塞、无越界改动、无设计偏离。

---

## Inputs consumed

| 输入 | 状态 | 用途 |
| --- | --- | --- |
| `wiki/raw/task_issue-306.md`（Host 简报，issue 正文 + AC1~AC6） | 已读 | 需求面；issue 无适用 Owner 评论（Host dispatch「REST comment read returned an empty array」，与 SA6/SA8 复核一致） |
| `wiki/raw/task_issue-306_design.md`（SA1 设计，417 行，唯一实施依据） | 已读 | §7 D1~D7 决策、§11 ALLOW/DENY、§12 验证命令 |
| `wiki/raw/task_issue-306_sa2_review.md`（SA2 评审，verdict approve，无 BLOCKER/MAJOR） | 已读 | O-1~O-5 MINOR 逐条核销（见下） |
| `wiki/raw/task_issue-306_sa6_contract.md`（SA6 契约，19 用例/12 红 7 绿，冻结验收输入） | 已读 | 红/绿集合、E-1~E-5 证据、金样本常量 |
| `.scratch/sa8-conflict-report-issue-306.md`（前置门禁 verdict clear；C-1~C-6） | 已读 | 约束落实核对 |
| `wiki/raw/task_issue-306_design_conflict_report.md`（设计后复查 verdict clear；O-1/O-2 实现红线） | 已读 | 两条实现红线已落为代码注释 |
| `wiki/raw/task_issue-306_relevant_decisions.md` / `task_issue-306_conflict_report.md` | 不存在 | 设计 §6 已登记；等价产物为上述 SA8 两份报告 |
| `packages/vfsl/test/{parse-vfsl-union-member-docs,evaluate-derived-member-docs}.test.ts`、`union-member-docs-fixture.ts` | 全文核读 | 冻结契约（本轮未改动一字；无 `skip/only/todo`） |
| `packages/vfsl/src/{parser,ir,semantic,derived,evaluate,tokenizer,validate,resolve,shapes,index,fingerprint}.ts` | 全文/锚点核读 | 实施落点与 D7 冻结不变式基线 |
| `wiki/raw/task_issue-306_sa3_impl.md`（上一 SA3 dispatch sa-b5b03808… 的报告） | 已读 | 既有待修订状态；本轮原位更新 |
| SA4/SA7 返工报告 | 不存在 | 本迭代无返工输入 |

## Existing worktree reconciliation

- **既有实现**：上一 SA3 dispatch（sa-b5b03808-6576-4ad5-96b5-a272dd6b7936，iteration 0）在该 worktree 留下了 5 个源文件改动（`git status`：`M packages/vfsl/src/{parser,ir,semantic,derived,evaluate}.ts`；151 insertions / 14 deletions）与一份实现报告；该次 dispatch 因执行观察者故障未产出业务 verdict，Host 本次要求完成实现并给出证据。
- **本轮核对动作**：逐行复核 5 文件 diff 对照设计 §7 D1~D7 与 SA8 O-1/O-2 红线——
  - `parser.ts`：附着点 A（`recordPipeAnchor`，`|` 记号 leadDocs 尾部区间，DocLead 引用不拷贝）、附着点 B（`recordStartAnchor`，peek 记号 `leadDocs` 引用 + 消费前下标快照）、`settleMemberDocs`（仅 `members ≥ 2` 调用、按成员逆序 `===` 同一性核对、splice + `claimed += n`、失配/越界 → 该成员 `[]` 且不动 dangling）、坍缩不结算、AST union 变体恒带必填等长 `memberDocs`——与设计伪代码逐要素一致；`claimDocs`/`depositedByLast`/`docTotal`/三锚位调用点零改动。
  - `ir.ts` / `semantic.ts`：条件键（`some(d => d.length > 0)` 才附加）、键序 `kind → members → memberDocs`、指纹纪律注；E305 正文枚举补「联合成员」（前缀 `VFSL-E305: ` 冻结）。
  - `derived.ts` / `evaluate.ts`：`memberDocs?: Record<string, string[]>` 条件稀疏类型注；`DocsTables` 第四表；`walkDocs` union 分支先 `guardMemberDocs()`（`undefined` 缺席合法；在场非「与 members 等长的数组的数组」→ `TypeError` → 顶层 catch → 恰一条 E100、无 derived）再按既有 `<member N>` 文法收非空条目；返回字面量末位条件展开第八键。
- **结论**：既有改动符合最新批准设计，无过时/不完整/冲突实现需要修正或删除；本轮**未新增代码改动**（仅重跑验证并原位更新本报告）。恢复性校验：临时 stash 后 `git diff` 与 stash 前逐字节相同（`diff -q` 通过），确认复核过程未扰动实现。

## Changed paths

| Path | Design section | Change |
| --- | --- | --- |
| `packages/vfsl/src/parser.ts` | §7 D1/D2 | `AstType` union 变体 +必填 `memberDocs: string[][]`；私有 `M4Pending`；`recordPipeAnchor()`/`recordStartAnchor()`/`settleMemberDocs()`；`parseUnionType` 两锚位记录 + `members ≥ 2` 终局逆序结算 + 坍缩不结算 |
| `packages/vfsl/src/ir.ts` | §7 D3 | union 变体 +条件键 `memberDocs?: string[][]` ＋ 指纹纪律注（键序、不得补空槽/二次规范化） |
| `packages/vfsl/src/semantic.ts` | §7 D3/D6 | `toIRType` union 分支条件展开；E305 消息正文枚举补「联合成员」 |
| `packages/vfsl/src/derived.ts` | §7 D4 | `DerivedSchema` +`memberDocs?: Record<string, string[]>` ＋ 条件稀疏差异常态化类型注（第八键居末） |
| `packages/vfsl/src/evaluate.ts` | §7 D4/D5 | `DocsTables` 增第四表；`guardMemberDocs()` 手造 IR loud 守卫；`walkDocs` union 分支逐成员收非空条目；返回字面量末位条件展开 |

无其他改动：`tokenizer.ts`/`fingerprint.ts`/`validate.ts`/`validate-patch.ts`/`resolve.ts`/`shapes.ts`/`resolve-schema-at-path.ts`/`index.ts`/`envelope.ts`/`schemasource.ts` 与全部测试、docs、其余 packages 零改动（`git status --short` 的 `M` 条目恰为上表 5 条）。

## SA2 Finding落实

SA2 裁定：无 BLOCKER、无 MAJOR；MINOR O-1~O-5：

| Finding ID | Implementation | Result |
| --- | --- | --- |
| O-1（测试文件计数口径偏差，非契约断言） | 无实现动作；本轮实测以 runner 输出为准：`packages/vfsl/test` → 34 files / 619 tests 全绿（与 SA6 口径一致） | 已核销（数字口径非缺陷） |
| O-2（调用方矩阵 doc-runtime 未点名） | 无实现动作（评审已抽查确认具名键访问、零影响；#306 不动 doc-runtime） | 无动作（符合 SA2 建议） |
| O-3（验证命令 `NODE_OPTIONS` 旗标不一致） | 契约/包测试命令统一加 `--conditions=nomicore-source`；`tsc`/`pnpm typecheck` 无需旗标（照抄设计 §12） | 已核销（命令均 exit 0） |
| O-4（SA8 两条实现红线以注释落进 `settleMemberDocs`/记录助手） | 已落实：`M4Pending` 定义处与 `recordPipeAnchor()`/`recordStartAnchor()`/`settleMemberDocs()` JSDoc 显式写明「leads 为 DocLead 引用、不得拷贝/重建」与「逆序结算、不得改尾部追加次序/插入中段 splice」 | 已处理（纯注释，不越范围） |
| O-5（用例 5/7 双方向封死双挂，记录其充分性） | 无实现动作 | 无动作（符合 SA2 结论） |

SA8 设计后复查 O-1/O-2 两条实现红线亦按上表落为代码注释；未改 `next()` 沉积次序、未在结算前插入任何中段 splice。

## File scope check

| Changed path | ALLOW entry | Purpose |
| --- | --- | --- |
| `packages/vfsl/src/parser.ts` | §11 ALLOW「AST union 变体 +必填 memberDocs；附着点 A/B 记录、settleM4 逆序同一性结算；私有 M4Pending 与记录助手」 | D1/D2 落地 |
| `packages/vfsl/src/ir.ts` | §11 ALLOW「union 变体 +`memberDocs?: string[][]` ＋ 指纹纪律注」 | D3 落地 |
| `packages/vfsl/src/semantic.ts` | §11 ALLOW「`toIRType` union 分支条件展开；E305 消息正文补联合成员」 | D3/D6 落地 |
| `packages/vfsl/src/derived.ts` | §11 ALLOW「`DerivedSchema` +`memberDocs?: Record<string, string[]>` ＋ 条件稀疏差异注」 | D4 落地 |
| `packages/vfsl/src/evaluate.ts` | §11 ALLOW「`DocsTables` 增表；`walkDocs` union 分支守卫 + 逐成员收集；返回字面量末位条件展开」 | D4/D5 落地 |

实际 changed path 集合 = 上表 5 条，无 ALLOW 外路径、无 DENY 路径触碰（含 `packages/vfsl/test/**` 三件冻结契约零改动）。实现自由度说明（非偏离）：结算助手命名 `settleMemberDocs`（设计伪代码作 `settleM4`）；守卫元素判定写作 `md.every((d) => Array.isArray(d))`（与 `md.every(Array.isArray)` 等价）；`recordStartAnchor` 用 `tok?.leadDocs ?? []` 防御 peek 边界（SA2 S-12 已核无空引用路径）。

## Verification

| # | Command | Result | Evidence |
| --- | --- | --- | --- |
| 1 | 红灯基线复现（`git stash push -- packages/vfsl/src` 临时剥离实现后）`NODE_OPTIONS=--conditions=nomicore-source npx vitest run packages/vfsl/test/parse-vfsl-union-member-docs.test.ts packages/vfsl/test/evaluate-derived-member-docs.test.ts` | **Test Files 2 failed (2) / Tests 12 failed \| 7 passed (19)**；`Type Errors no errors`；失败集合逐条 = SA6 §13 红表（parse 7 + evaluate 5），红因全部为 E305 / 键缺席 / 措辞未补 | `.scratch/sa3-red-baseline.log` |
| 2 | 恢复实现：`git stash pop`；`git diff` 与剥离前备份逐字节比对 | `PATCH_IDENTICAL`（151 insertions / 14 deletions 复原） | 复核过程无实现扰动 |
| 3 | 同一命令（实现在场） | **Test Files 2 passed (2) / Tests 19 passed (19)**；`Type Errors no errors`（12 红转绿、7 存量绿保持） | `.scratch/sa3-contract-green.log` |
| 4 | `NODE_OPTIONS=--conditions=nomicore-source npx vitest run packages/vfsl/test` | **Test Files 34 passed (34) / Tests 619 passed (619)**；`Type Errors no errors`（存量 607 + 契约 12 全绿，零回归） | `.scratch/sa3-pkg-vfsl-run.log` |
| 5 | `npx tsc -p packages/vfsl/tsconfig.json` | exit 0 | 包类型面（含 `test/**` 三件契约文件） |
| 6 | `pnpm typecheck` | exit 0（14 个 tsconfig 全链） | `.scratch/sa3-root-typecheck.log` |
| 7 | `git diff --stat` / `git diff --check` / `git status --short` | 5 个 `M` 路径 = ALLOW LIST；151 insertions / 14 deletions；`--check` exit 0（无空白错误） | 范围与卫生证据 |
| 8 | 契约文件 `grep -nE "\.(skip\|only\|todo)\("` | 0 命中（exit 1） | 无 skip/only/todo、无软化 |

金样本核验（契约内断言，本轮未重录，实现与断言常量均未变更）：SPEC_FIXTURE / FIXTURE_B 的 IR 紧凑 JSON SHA-256、`sha256:v1:` semantic 指纹精确值、derived 紧凑 JSON SHA-256 全部逐字节不变（用例 18/19 与 derived 稳定用例绿）——存量文本不出现 `memberDocs` 键。

## Deferred verification

以下不在 SA3 职责面内，留待 SA4/SA7（设计 §12/§13、SA6 §15 已登记）：

1. 全仓 `pnpm test`（含 `--typecheck` 全仓面）、真实环境验收与 CI（#306 验收面 = `packages/vfsl` 包测试 + typecheck，E-5）。
2. #307 `packages/vfsl-codegen` 四发射位与 `generate --check`；#308 `resolveSchemaAtPath` docs 切片第三来源合并；#309 v1-spec §5 / 编写指南 / `tests/acceptance/vfsl_spec_acceptance.py` 的「三锚位」措辞同支同步（C-1/C-5 中间态豁免）。
3. 契约未锁定的类型声明细节（`readonly` vs 可变）与元素字符串性口径——按 SA6 §15.1 由 SA7 以 typecheck + 只读审查确认。
4. ADR 0017 生命周期元数据 / ADR 0018 peer re-arm 的存量指纹对比行为（输入构造性不变，SA7 按需动态复核）。

## Deviations or blockers

- **无设计偏离、无阻塞**：实现逐项落在设计 §7 D1~D7 与 §11 ALLOW 内；SA8 C-1~C-6 全部满足（未改规格文本、未动 `fingerprint.ts`、E305 触发面只缩小、validate/物化零读取、codegen/投影盲读、消息前缀冻结）。
- **上一 iteration 执行观察者故障**：上一 SA3 dispatch 未产出业务 verdict（其报告与实现留在 worktree）；本轮按 dispatch 要求完成实现核对与独立验证，未发现需要修正的实现缺陷。
- **Owner 评论**：issue #306 无适用评论（Host dispatch「REST comment read returned an empty array」；SA6 §2 / SA8 两份报告独立复核一致），无评论约束需映射。
- **临时产物**：`.scratch/sa3-{red-baseline,contract-green,pkg-vfsl-run,root-typecheck}.log` 为本轮证据保留；实现备份补丁已删除。
- **`git add` / commit / push / PR / finalize**：未执行（不在 SA3 职责面）。

## Suggested commit message

```
feat(vfsl): M4 联合成员文档注释解析与 IR/derived memberDocs (#306)

解析（ADR 0019 决策 1/2，parser.ts）：
- parseUnionType 新增附着点 A（前导/分隔 | 记号的 leadDocs 归后继成员）与
  附着点 B（首成员无前导 | 时其起始记号 leadDocs 归首成员）；
  | 与成员之间的夹缝 doc 不入 A/B 记录（非标记成员维持 E305，标记成员按 M3 挂载）
- 终局按成员逆序做 DocLead 引用同一性核对后 splice + claimed 记账；
  members === 1 坍缩不结算（E305 逐字节维持）；AST union 节点恒携带必填等长 memberDocs

IR/derived（ADR 0019 决策 4/5）：
- ir.ts：union 条件键 memberDocs?: string[][]（条件附加、键序 kind→members→memberDocs，
  指纹纪律注）；semantic.ts：some(non-empty) 才附加
- derived.ts/evaluate.ts：条件稀疏 memberDocs 表（<member N> 既有文法、只收非空、
  第八键居末）；手造 IR 畸形 memberDocs → TypeError → 恰一条 E100、无 derived 载荷

消息（ADR 0019 决策 9.3）：E305 正文可挂载节点枚举补「联合成员」，前缀 VFSL-E305: 冻结。

存量兼容：无成员 doc 文本的 IR/derived 紧凑 JSON 与 sha256:v1: 指纹逐字节不变。
```
