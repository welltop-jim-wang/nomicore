# 任务简报 — doc-runtime materializeRoot 修订轮 rev2（PR #84 owner review / issue #74）

- run_id: issue-74-1787396362-3288866
- branch: fix/issue-74-on-docs-doc-runtime-validation
- base: docs/doc-runtime-validation（rev2 rebase 目标：origin/docs/doc-runtime-validation = 8a42501d208640439066541c7350ff7c477c4bf6）
- PR: #84（head 135c79e → rebase 后更新）
- 任务类型: unspecified（发布后修订轮）→ 总控自判：缺陷修复性质（运行时 guard 缺失导致假成功）→ 按 Bug 修复路由（SA5 已有 rev1 分析档案可复用，可裁剪；SA6 红灯→SA1→SA8→SA2→SA3→SA4→SA7→AC 门禁）
- owner 反馈原文: issuecomment-5383810572（`gh api repos/welltop-jim-wang/nomicore/issues/comments/5383810572 --jq .body`）

## 前置硬约束（先于修订流水线）

1. rebase 到 origin/docs/doc-runtime-validation（8a42501）；
2. 逐个解决冲突，禁止整文件 ours/theirs；
3. 每个冲突的解决策略记录到 `wiki/raw/task_doc-runtime-materialize-root-rev2_rebase_resolution.md`；
4. 特别检查与近期 doc-runtime / persistence / CI workflow 变更的交叉；
5. rebase 后重跑 pnpm typecheck、pnpm test、materialize 专项门禁。

## P1 / Major：禁止或响亮拒绝在活动的外层 Yjs transaction 内调用

位置：`packages/doc-runtime/src/materialize.ts:54-71`、`packages/doc-runtime/test/materialize-root.test.ts:708-735`

当前仅通过 JSDoc 声明 materializeRoot() 必须运行在该 Y.Doc 的最外层 transaction，但没有运行时 guard。如果调用方在尚未结束的 doc.transact() 中调用：1) materializeRoot() 内部 transaction 会并入外层 transaction；2) observer/update cleanup 尚未发生；3) verifyInstall() 会在 observer 执行前通过；4) 函数返回 {ok:true}；5) 外层 transaction 结束后 observer 才修改 ROOT；6) 新增的成功保证和 DOCRT-E201 检测失效。当前测试还将这一"先返回成功，后发生未检测偏离"的行为固化为 characterization。

修订要求（优先运行时响亮拒绝）：
- 在任何写入前检测当前 doc 是否已经处于活动 transaction；
- 若在外层 transaction 内调用，必须 loud fail，且 doc 零写入；
- 不得返回 {ok:true}；
- 将现有 characterization 测试改成拒绝测试，断言错误身份/消息、update === 0、state bytes 不变。
若不使用 Yjs 私有字段检测，应由 Runtime 包装层维护 transaction context 并保证该公共入口不可在活动 transaction 中调用。不能只依赖 JSDoc。

## Medium：明确并测试 observer 对嵌套子树的就地修改边界

位置：`packages/doc-runtime/src/materialize.ts:94-115`。verifyInstall() 只检查 ROOT 顶层 key 数与顶层 value 引用 identity。同步 observer 若保持顶层引用不变、仅原地修改已安装子树（如 `const u = root.get('u') as Y.Map<unknown>; u.set('n', 2)`），顶层 identity 校验仍通过、函数返回 {ok:true}，但 logical snapshot 已偏离输入。

修订要求（成功语义二选一）：
1. 若 ok:true 要保证完整 logical snapshot 在返回时未被 observer 修改，应增加完整语义校验（如 extract/fingerprint），并增加嵌套 Y.Map/Y.Array/Y.XmlFragment 就地修改测试；
2. 若只保证 ROOT 顶层 keyset + identity，则必须在公共 API/ADR 中明确这一有限保证，并增加嵌套就地修改 characterization test，避免调用方误解为完整 snapshot 保证；Runtime 层还必须禁止 observer/业务方取得可写子树引用。
当前源码 JSDoc 已提到不覆盖嵌套修改，但 issue/公共契约需要同步明确。

## Minor hardening

- CDATA / PI / comment 当前按 raw Y.XmlText opaque span 承载；请明确这是 lexical-token round-trip 而非结构化 XML 节点语义，并补元素内部混合内容测试。
- 构造失败矩阵已很好，但尚未确定性覆盖 detached XML/Yjs assembly 抛异常进入 DOCRT-E200 后仍零写入；可通过受控 seam 或极深树测试补强。

## Review 结论

Request changes：先 rebase 到最新 base 并解决冲突，再修复外层 transaction 假成功；同时明确嵌套子树 observer 的成功语义。

## 发布要求

修订轮允许 push：完成后 commit + `git push --force-with-lease origin HEAD`（rebase 后必须），更新 PR #84。严禁提交 `.mabf-bg/**`；REPORT.md/.mabf-done 本地元数据不入仓。

## SA6 红灯锚定（Phase 1，run_id: issue-74-1787396362-3288866）

红灯契约已落盘（SA6，2026-08-23；决议/红线基准：`-rev2_relevant_decisions.md` / `-rev2_conflict_report.md`，W1/W2/W2'/W3/W4 全遵守）。测试文件：

- `packages/doc-runtime/test/materialize-root.test.ts` — P1 改造（原 708-735 T-1 characterization 整块替换为拒绝测试，文件头注释追加 rev2/RAC-P1 说明；其余用例零改动）。
- `packages/doc-runtime/test/materialize-root-rev2.test.ts` — 新增（Medium ×3 攻击 + 1 正向对照；Minor-1 混合内容 round-trip；Minor-2 极深树 E200 零写入；自包含辅助/XML 语义比较器，黑盒锚定、无源码 grep）。

用例 → 红灯证据（vitest run 实测，命令见下）：

| 用例 | 红灯断言 | 实测失败信息首行（当前实现） |
|---|---|---|
| P1：活动外层 transaction 内调用 → 绝不为 ok:true + doc 零写入（T-1 拒绝测试） | `result?.ok` 不为 true；0 update；state/vector 字节不变；ROOT 空置；observer 未触发 | `AssertionError: expected true not to be true`（主锚 762 行；当前实现返回 ok:true；scratch 实证同场景 `{"result":{"ok":true},"events":3,"stateChanged":true,"keys":["count","extra"]}`——后续零写入断言同红） |
| Medium Y.Map：嵌套 u.set('n',2) → 不得 ok:true（throw E201 家族） | `toThrow(/DOCRT-E201/)` | `AssertionError: expected [Function] to throw an error`（当前返回 ok:true，uN=2 偏离已落地、顶层引用未变） |
| Medium Y.Array：嵌套 tags.insert(1,['z']) → 不得 ok:true | `toThrow(/DOCRT-E201/)` | `AssertionError: expected [Function] to throw an error`（当前 ok:true，tags=['a','z','b']） |
| Medium Y.XmlFragment：body.insert 追加 → 不得 ok:true | `toThrow(/DOCRT-E201/)` | `AssertionError: expected [Function] to throw an error`（当前 ok:true，body='<p>x</p>HACKED'） |
| Medium 正向对照：observer 只读嵌套 → ok:true + extract 语义等价 | （当前已绿——防过度拒绝假阳性的守卫） | 绿（现状表征） |
| Minor-1：元素内部混合内容 lexical-token round-trip | （round-trip characterization，语义比较器） | 绿（现状表征；CDATA/PI/comment 逐字 opaque span 往返） |
| Minor-2：极深树（20_000 层）→ DOCRT-E200 + 零写入 | （确定性触发锚，scracth 实证：depth≥10_000 溢出点落在 ② 装配；depth=2_000 落在 ④ 安装期，不可用） | 绿（现状表征；ok:false + E200 单 issue + 0 update + state 不变） |

红灯命令（后台独立进程）：`node_modules/.bin/vitest run packages/doc-runtime/test/materialize-root.test.ts packages/doc-runtime/test/materialize-root-rev2.test.ts`，日志 `.mabf-bg/sa6-red-verify.log`。

形态占位说明（P1/Medium 均标注，待 SA1 定稿后对齐，不阻塞形态选择）：P1 拒绝形态 throw 或 {ok:false} 两相容（W1 澄清，SA8 重点裁决一），断言按「绝不为 ok:true」主锚 + 占位形态断言；Medium 写后偏离检测受 W1 约束 = throw，占位 E201 家族（错误码/消息按 SA1 设计对齐）。若 SA1 定稿选 Medium 选项 2（有限保证 + characterization），Medium 组按设计调整为 characterization 断言。

### R2 批（SA1 设计 §7.1 测试规格落地，SA2 R4 pass 后；2026-08-23）

设计定稿（`-rev2_design.md`，RD7/RD8/INV-11 终版）后按 §7.1 规格落地的第二批复用锚。新增/修改：

- `packages/doc-runtime/test/materialize-root-rev2.test.ts` — 追加 R2 批 describe（RT-2 主+对照 / RT-3 ×3 / RT-4 / RT-5 / RT-1.5 攻击×3+诚实×3 / RT-1.6 攻击×2+诚实×2，共 17 用例）。
- `packages/doc-runtime/test/materialize-root.test.ts` — **RT-6**：T-1 throw 支占位正则 `/DOCRT-/` 收紧为 `/DOCRT-E202/`（设计 §3.4 三变体消息逐字定稿、§3.5 定稿 throw；返回支保留为兼容占位），头注释同步。

红灯实测（同一 vitest 后台进程，日志 `.mabf-bg/sa6-red-verify-r2.log`）：`Tests 15 failed | 68 passed`（新增 11 红 + 既有 P1/Medium×3 仍红；RT-2 对照 / RT-1.5 诚实×3 / RT-1.6 诚实×2 及既有全部绿；Type Errors no errors；`tsc -p packages/doc-runtime/tsconfig.json` exit 0）。

| R2 批用例 | 红灯断言 | 实测失败信息首行（当前实现：无 ⓪ guard 无 ⑥） |
|---|---|---|
| RT-2 窗口 B（OTHER observer 回调内调用） | throw /DOCRT-E202/ + 「派发期间」+ stateBytes 跨调用不变 + update 计数不增 + ROOT 空置 | `AssertionError: expected undefined to be an instance of Error`（当前假成功 ok:true，§9.2 同型） |
| RT-2 对照（afterAllTransactions 内调用） | ok:true + extract 投影等价（防 SA3 误拒） | 绿（现状表征；PA-9 队列已重置） |
| RT-3 C-1（delete _transaction） | throw /DOCRT-E202/ + 「无法确认」「版本兼容性」+ stateBytes 不变 | `AssertionError: expected 'Cannot read properties of undefined (…' to match /DOCRT-E202/`（yjs 内部 raw TypeError——fail-closed 缺失） |
| RT-3 C-2（cleanups={}） | 同上 | `AssertionError: expected 'transactionCleanups.push is not a fun…' to match /DOCRT-E202/` |
| RT-3 C-3（truthy 垃圾 tx） | throw /DOCRT-E202/ + 「doc._transaction 非空」（§3.1 收敛口径 A） | `AssertionError: expected 'Cannot read properties of undefined (…' to match /DOCRT-E202/` |
| RT-4（wedge：update 回调抛异常卡死队列） | 前置 outerThrown；顶层调用 throw /DOCRT-E202/ + 「队列异常残留」 | `AssertionError: expected undefined to be an instance of Error`（wedged doc 上 ④ 不触发 cleanup → 假成功 ok:true，R-7 同型） |
| RT-5（XmlElement 注入 `x"y` 属性） | toThrow(/DOCRT-E201/)（变体 C 或 D——主锚绝不假成功） | `AssertionError: expected [Function] to throw an error`（当前 ok:true） |
| RT-1.5 形态 A（窄成员掩盖宽成员声明键，u.k→9） | toThrow(/DOCRT-E201/)（前置 ① validate ok） | `AssertionError: expected [Function] to throw an error`（当前 ok:true） |
| RT-1.5 形态 B（必填缺席成员掩盖 Record 动态键，u.q→HACKED） | 同上 | `AssertionError: expected [Function] to throw an error`（当前 ok:true） |
| RT-1.5 形态 C（判别联合经 ref 掩盖成员独有字段，body 追加） | 同上 | `AssertionError: expected [Function] to throw an error`（当前 ok:true） |
| RT-1.5 诚实对照 A/B/C | ok:true + extract 投影锁定（A/B 精确投影；C body 语义比较器） | 绿（现状表征；R4 对称重物化下诚实路径双侧同管线产物一致） |
| RT-1.6 D1（宽严格联合 delete k） | toThrow(/DOCRT-E201/)（前置 ① validate ok） | `AssertionError: expected [Function] to throw an error`（当前 ok:true） |
| RT-1.6 D2（判别联合经 ref delete body） | 同上 | `AssertionError: expected [Function] to throw an error`（当前 ok:true） |
| RT-1.6 诚实对照 D1/D2 | ok:true + extract 投影锁定 | 绿（现状表征） |
| RT-6（收紧 T-1 正则 /DOCRT-E202/） | （改既有 P1 断言形态；当前实现走返回支 → 主锚不变） | P1 仍红：`AssertionError: expected true not to be true`（762 行主锚，同 R1 批） |

红/绿语义对齐（设计 §4.2 对称重物化 extract(real)≡extract(scratch)）：全部 15 红用例在 SA3 实现 ⓪+⑥ 后转绿——E202 家族（RT-2/RT-3/RT-4，写前 throw + 零写入）与 E201 变体 C/D（RT-5/RT-1.5/RT-1.6/Medium，写后 throw）；8 个对照/诚实用例保持绿（防过度拒绝 + 判据演进回归锚）。RT-1（重叠联合正/负四用例）不在本批派单内，如总控需要可补。
