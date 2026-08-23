# MABF Task: doc-runtime：复用 detached builder 并原子替换 ROOT 内容

## Issue #88

## Parent

PR #85（docs/namespace-runtime）

## What to build

将 materialization 的 detached 构造能力收敛为包内可复用 seam，并提供保留顶层 ROOT Y.Map identity 的原子内容替换能力，为 SCHEMA 与完整 ROOT generation 的单 transaction 切换提供底层支撑。

## Acceptance criteria

- [ ] materializeRoot 与新替换能力复用同一个 detached builder，不复制 Y.Map/Y.Array/XML/plain 构造规则
- [ ] detached builder 保持包内能力，不作为业务公共 API 或可跨时间执行的 prepared mutation 暴露
- [ ] 完整验证和 detached 构造成功后，才允许 transaction 内清空并安装 ROOT 内容
- [ ] 顶层 doc.getMap('ROOT') identity 保持，旧子类型 identity 可失效
- [ ] 前置验证/构造失败时 Y.Doc state/update 零变化
- [ ] transaction observer/fatal 服从 committed-aware no-rollback 契约
- [ ] 行为测试覆盖空/非空 ROOT、全部载体种类、构造失败和 observer 边界
- [ ] 全量 typecheck/test 和 Node 20/24 CI 通过

## Blocked by

- #74

## Working Directory

/home/wangjian/nomicore-fix-issue-88

## Branch

fix/issue-88-on-docs-namespace-runtime

## Phase 1 验收锚定（SA6 红灯测试，2026-08-23 15:45）

### 测试文件

`packages/doc-runtime/test/replace-root-content.test.ts` — 13 用例 / 7 组 describe，覆盖
AC-1~AC-7 逐条（新增公共接缝 `replaceRootContent` 的行为矩阵 + 与 materializeRoot 的
构造等价锚 + 包内 seam 封装边界锚）。

### 契约冻结（SA3 唯一行为锚点；SA1 设计不得收窄）

- 公共接缝：`replaceRootContent(derived: DerivedSchema, snapshot: unknown, doc: Y.Doc)`
  经 `packages/doc-runtime/src/index.ts` 包公共入口导出（与 materializeRoot 同文件同款）；
  同步、可预期失败经返回值传递（ADR-0008「普通、可预期且零写入的失败使用领域化结果联合」）。
- 结果联合（沿仓内 `{ ok, issues }` 惯例）：`{ ok: true } | { ok: false; issues:
  ReplaceIssue[] }`；逻辑校验失败**保留完整 issues**（与 validateLogicalSnapshot 直调
  结果逐条一致）；materialization 失败（构造失败 / ROOT 载体非 Y.Map）**恰 1 条** issue
  （fail-fast，ADR-0007）；issue = `{ message: string; path: Array<string|number> }`。
- 语义：**非空 ROOT 亦可替换**（与 materializeRoot「只安装到空 ROOT」互补；ADR-0008
  明文授权的独立职责）；单 transaction 内 `clear()` + 安装已 detached 构造的内容。
- 前置保证（与 materializeRoot rev2/RD7-P1 同款事务纪律）：未闭合外层 `doc.transact`
  内调用 → 任何写入前 throw `DOCRT-E202`、本函数零写入。
- ⚠️ 设计决策点（留给 SA1 显式裁决，不在本文件收窄）：G7 锚定「未闭合外层事务 → 零写入
  loud 拒绝」，与包内已生效的 materializeRoot ⓪ guard（#74 rev2/RD7-P1）同族——嵌套调用
  会使「单 transaction 清空并安装」的可观测承诺（恰 1 次 update）与写后校验窗口失效。
  ADR-0008 SCHEMA write 的「一个 transaction 中原子替换 SCHEMA 与 ROOT」语境若要求
  replaceRootContent 支持外层事务内调用，SA1 须在设计中显式定义嵌套调用下的保证面
  （或经 owner 裁决调整）；本测试默认按包内既有 hard contract 锚定最外层语境。

### AC 逐条锚点（全部为运行时行为，无源码 grep / 无源码文本断言）

| AC | 锚点断言（G 组 → 用例） |
|---|---|
| AC-1 复用同一 detached builder | G5：全载体 fixture（map/array/xml/leaf/plain/union/ref/Record）同一输入分别经 `materializeRoot` 与 `replaceRootContent` 安装 → `extractYjsSnapshot` 读回 `toEqual` 全等；同一构造失败输入（leaf NaN）→ 两入口 `ok:false` 的 issues（message+path）逐条一致 |
| AC-2 包内 seam 不暴露 | G6：包公共入口导出面 `Object.keys` 恰为 4 个文档化接缝（无 builder/prepared mutation 泄漏——黑盒模块级断言）；结果联合精确 `{ok:true}` 无附加句柄 + 同参二次调用无跨调用捕获状态 |
| AC-3 验证+构造成功后单事务 | G1/G2：非空/空/缺席 ROOT 成功路径恰 1 次 `update` 事件（单 transaction 清空并安装）；G3：逻辑失败/构造失败先于任何事务（0 update + 字节不变 + 旧内容原封不动） |
| AC-4 顶层 identity 保持 | G1：`doc.getMap('ROOT')` 调用前后严格同一（`toBe`）；旧 Yjs 子类型（Y.Map/Y.Array/Y.XmlFragment）引用即失效（新实例替换 + 快照外键清除） |
| AC-5 前置失败零变化 | G3：逻辑失败（issues 与直调一致）/ 构造失败（NaN 过 ①、② 拒，单 issue）/ ROOT 载体非 Y.Map（Y.Array）→ 三者均 0 update + `encodeStateAsUpdate` 逐字节不变 |
| AC-6 observer/fatal no-rollback | G4：事务内未知 observer 抛错 → 原样 loud（`toThrow('observer-boom')`）+ 不虚假回滚（update 已发出、新值已落盘）+ 恰 1 次回调；observer 同步重入 delete 计划键 → 写后偏离不得 `ok:true`（throw E201 家族）+ 不补偿、不声称回滚 |
| AC-7 行为覆盖 | G2（空/缺席 ROOT）、G1/G5（全部载体种类）、G3（构造失败）、G4（observer 边界）；另 G7 锚定未闭合外层事务的零写入 loud 拒绝（事务纪律） |

### 红灯验证（2026-08-23 15:26 实测）

- 命令（独立进程 setsid nohup，日志 /tmp/sa6-red.log）：
  `pnpm exec vitest run packages/doc-runtime/test/replace-root-content.test.ts`
- 结果：`Test Files 1 failed | Tests 13 failed (13)`，EXIT=1
- 失败根因：`TypeError: (0, replaceRootContent) is not a function` —— 包入口未导出
  replaceRootContent（功能未实现），全部 13 用例红，真实红灯（构造性红灯，同
  materialize-root.test.ts 先例）。SA1 设计、SA3 实现并导出后转绿。
- typecheck 红灯（`pnpm exec tsc -p packages/doc-runtime/tsconfig.json`，日志
  /tmp/sa6-tc.log）：唯一错误为 `TS2305: Module '"../src/index.js"' has no exported
  member 'replaceRootContent'`——即构造性红灯；无其他类型错误（SA3 导出后 typecheck
  即绿，测试文件自身零类型缺陷）。
- 回归确认：`pnpm exec vitest run packages/doc-runtime` → `1 failed | 14 passed (15)`，
  215 passed（既有 materialize/extract/read 全部用例不受影响），仅本文件 13 用例红。
- 断言可达性实证（临时 scratch 已清理，21/21 通过）：以已实现的 materializeRoot 验证
  全载体 fixture（parse/evaluate/validate ok、安装 ok:true、extract 读回形状全对、XML
  投影 `<p a="1" b="2">hello</p>` 与输入 `<p b="2" a='1'>hello</p>` 经语义比较器等价）；
  NaN 过 ① 拒 ② 且 issue path=['count'] 含「non-finite number」；Y.Array ROOT → 单
  issue path=[]；未闭合外层事务 → throw DOCRT-E202；yjs 实证非空 ROOT 上 clear+set 单
  事务 identity 保持 + 恰 1 update + observer 原样抛 + 值已提交 + 旧子类型引用失效；
  重入 delete 后状态面（title 已提交、count 缺席）与 G4 断言一致。

