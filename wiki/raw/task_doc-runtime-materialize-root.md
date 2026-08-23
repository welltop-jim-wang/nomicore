# MABF Task: 验证后安全物化 logical ROOT 到 Yjs

- Issue: [#74](https://github.com/welltop-jim-wang/nomicore/issues/74)
- Parent: PR [#70](https://github.com/welltop-jim-wang/nomicore/pull/70)（docs/doc-runtime-validation）
- Task Type: feature（功能开发）
- Branch: fix/issue-74-on-docs-doc-runtime-validation
- Base: docs/doc-runtime-validation
- run_id: issue-74-1787396362-3288866
- Worktree: /home/wangjian/nomicore-fix-issue-74
- Blocked by: #71（已合入 PR #78）、#73（已合入 PR #81）——阻塞已解除

## What to build

实现唯一公共入口 `materializeRoot(derived, snapshot, doc)`。入口内部强制逻辑校验，按 structure tree 在 detached 状态构造完整 Yjs 子树，确认目标 ROOT 为空后以一次 transaction 安装；任何验证或构造失败都不得留下目标 doc 部分写入。

## Acceptance criteria

- [ ] AC-1: logical 失败保留完整 issues；materialization 失败返回单 issue
- [ ] AC-2: 目标 ROOT 非空响亮失败，不 overwrite、merge 或 fallback
- [ ] AC-3: detached 构造正确区分 Y.Map、Y.Array、Y.XmlFragment 与 plain deep clone
- [ ] AC-4: 全部构造成功后才执行单次 transaction；前置失败时 Y.Doc state/update 不变
- [ ] AC-5: XML string 物化后提取可再次通过逻辑校验，不要求字符串逐字相同
- [ ] AC-6: observer 抛错边界按 ADR 0007 处理，不虚假承诺事务回滚

---

## Phase 1 验收锚定（SA6 红灯测试，2026-08-22 19:13）

### 测试文件

`packages/doc-runtime/test/materialize-root.test.ts` — 13 用例 / 6 组 describe，覆盖 AC-1~AC-6 逐条。

### 契约冻结（SA3 唯一行为锚点；SA1 设计不得收窄）

- 公共接缝：`materializeRoot(derived: DerivedSchema, snapshot: unknown, doc: Y.Doc)` 经
  `packages/doc-runtime/src/index.ts` 包公共入口导出（与 extractYjsSnapshot 同文件）；
  同步、错误经返回值传递。
- 结果联合（沿仓内 `{ ok, issues }` 惯例）：`{ ok: true } | { ok: false; issues:
  MaterializeIssue[] }`；逻辑校验失败**保留完整 issues**（与 validateLogicalSnapshot
  直调结果 `toEqual` 完全一致，全收集非 fail-fast）；物化失败（ROOT 非空等）**恰 1 条**
  issue（ADR-0007「Yjs 结构与路径/操作错误 fail-fast」）；issue.message 非空字符串。

### AC 逐条锚点

| AC | 锚点断言（全部为运行时行为，无源码 grep） |
|---|---|
| AC-1 | 多违规快照（类型错×2 + 未知键×1）→ `ok:false` 且 `issues` 与 `validateLogicalSnapshot` 直调结果完全一致（≥2 条）；ROOT 非空 → `ok:false` 且恰 1 条 issue |
| AC-2 | ROOT 已含数据 → 响亮失败单 issue + 0 update 事件 + state 逐字节不变 + `title` 不被 overwrite + 新键不被 merge（fallback 缺席）；ROOT 异型（Y.Array）→ 同款失败；正向对照：ROOT 缺席/空 map → 成功 |
| AC-3 | 全形态 fixture 物化后 doc 侧载体：map→`instanceof Y.Map`、array→`instanceof Y.Array`、xml-fragment→`instanceof Y.XmlFragment`、plain（YPlainArray）→ 纯 JS 数组且 `not instanceof Y.AbstractType`；plain 深拷贝：物化后突变输入快照（数组 push / 嵌套对象改值）doc 内容不变（yjs 实证 `set` 按引用存储，故引用隔离必须行为断言） |
| AC-4 | 成功物化恰 1 次 `update` 事件（单次 Y.transact 安装）；逻辑校验失败 → 0 事件 + `encodeStateAsUpdate` 逐字节不变；ROOT 非空 → 0 事件 + state 不变；SCHEMA/META 兄弟条目物化前后不变（ADR-0006 写入边界） |
| AC-5 | XML string 物化 → `extractYjsSnapshot` 提取 → `normalizeXml` 语义等价（折叠标签间空白，不承诺逐字）且 `validateLogicalSnapshot` 再次 `ok:true` |
| AC-6 | ROOT observer 抛错 → 错误 loud 传播（`toThrow`），不吞并成伪 ok/伪「已回滚」结果；写入已实际提交（恰 1 次 update 事件 + ROOT 值已落盘——yjs 实证 observer 抛错不触发回滚，测试不承诺回滚） |

### 红灯验证（2026-08-22 19:13 实测）

- 命令：`pnpm exec vitest run packages/doc-runtime/test/materialize-root.test.ts`（独立
  进程 setsid nohup，日志 /tmp/sa6-materialize-red.log）
- 结果：`Test Files 1 failed | Tests 13 failed (13)`，EXIT=1
- 失败根因：`TypeError: (0, materializeRoot) is not a function` —— 包入口未导出
  materializeRoot（功能未实现），全部 13 用例红，真实红灯（构造性红灯，同
  extract-yjs-snapshot.test.ts 先例）。SA3 实现并导出后转绿。
- 回归确认：`pnpm exec vitest run packages/doc-runtime/test/` → `1 failed | 5 passed
  (6)`，既有 48 用例（extract 侧）全绿，本文件 13 用例红，无连带破坏。
- 断言可达性实证：`.mabf/scratch*.mjs` 模拟正确实现（detached 构造 + 单事务安装 +
  深拷贝 + observer 抛错）验证全部断言在正确实现下成立（单事务恰 1 update、载体
  全对、extract 归一化等价 + 重校验 ok、突变隔离成立、observer 抛错传播且不回滚）；
  临时脚本已清理。
