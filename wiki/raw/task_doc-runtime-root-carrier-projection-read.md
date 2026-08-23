# MABF Task: doc-runtime：schema-independent ROOT 载体投影读取

- **Issue**: #86 (welltop-jim-wang/nomicore)
- **run_id**: issue-86-1787480031-378585
- **branch**: fix/issue-86-on-docs-namespace-runtime
- **base**: docs/namespace-runtime (Parent PR #85)
- **任务类型（总控自判）**: 功能开发 —— 新增「schema 准备完成前即可高频读取」能力：将既有 `readLogicalValueAtPath` 改为不依赖 VFSL/派生 schema 的同步载体投影读取（行为语义按 AC 重定义）。路由：SA6（验收锚定）→ SA1 → SA8 设计复审 → SA2 → SA3 → SA4 → SA7 → AC 门禁 → 收尾。

## Parent

PR #85（docs/namespace-runtime）

## What to build

将 ROOT 按路径读取改为不依赖 VFSL/派生 schema 的同步载体投影。读取只依据 live Y.Doc 中的实际 Yjs/plain 载体转换目标子树，返回隔离的普通逻辑值，使 Runtime 在 schema preparation 完成前即可高频读取。

## Acceptance criteria

- [ ] `readLogicalValueAtPath` 不再接收 derived schema，空 path 深拷贝完整 ROOT，非空 path 只转换目标子树
- [ ] Y.Map/plain object 使用 string segment，Y.Array/plain array 使用严格非负整数 segment；任一合法容器缺失均成功返回 `undefined`
- [ ] plain object 仅读 own enumerable data property，不走原型链、不执行 accessor
- [ ] plain subtree 只接受 JSON-compatible plain value，嵌套 Yjs shared type 响亮失败
- [ ] Y.XmlFragment 是返回语义字符串的不可下钻终态；未知 Yjs shared type 不使用通用 fallback
- [ ] 所有预期 path/载体失败返回同步结果联合，返回值不含 live 引用且不做运行时 freeze
- [ ] 调整调用面与行为测试，并通过全量 typecheck/test 和 Node 20/24 CI

## Blocked by

None (can start immediately).

## Working Directory

/home/wangjian/nomicore-fix-issue-86

## Branch

fix/issue-86-on-docs-namespace-runtime

## SA6 Phase 1 验收锚定（红灯测试，2026-08-23）

### 需求拆解（AC → 可观测契约）

| AC | 可观测锚点 | 测试 |
|---|---|---|
| AC1 | `readLogicalValueAtPath(doc: Y.Doc, path: readonly (string \| number)[])` 双参签名；空 path = 完整 ROOT 普通深拷贝；非空 path = 仅目标子树；无任何派生 schema 的文档可读（任意 string 段，含空格/点号段） | 行为 5 例 + 类型 1 例 |
| AC2 | Y.Map/plain object 用 string 段；Y.Array/plain array 用严格非负整数段；map/object 缺键与数组越界（含中间缺失）→ `ok:true, value:undefined`；段型与载体不符/负数/非整数 → `{ok:false, code:'PATH_NOT_ALLOWED', path 回显}` | 行为 7 例 |
| AC3 | plain object 仅读 own enumerable **data** property：accessor 不执行（副作用计数器零触发）且不产出；原型链（data+accessor）不参与；non-enumerable 不参与 | 行为 5 例 |
| AC4 | plain 子树 JSON-compatible 纪律：嵌套 Yjs shared type（Y.Map/Y.Array/Y.Text 在 plain 容器内）/ bigint / non-finite number / 数组内 undefined → 响亮失败（ok:false），绝不静默丢弃/转换 | 行为 6 例 |
| AC5 | Y.XmlFragment（含 Y.XmlElement 子类）目标 = XML 语义字符串（不锁逐字），不可下钻；Y.Text/Y.XmlText 等导航 vocabulary 之外 shared type → 失败（无 toJSON/toString fallback）；ROOT 载体异型 → 失败 | 行为 6 例 |
| AC6 | 返回值 = 可变普通深拷贝：无 live 引用（递归 Yjs instanceof 检查）、JSON 往返无损、不 freeze（顶层+嵌套均可写）、突变不影响 live doc；预期失败同步返回联合（不抛） | 行为 4 例 |
| AC7 | 调用面调整 + 全量 typecheck/test + Node 20/24 CI（实现期完成判据；SA3 需同步调整既有三参行为测试） | — |

### SA6 冻结契约（SA1 不得收窄，仅可补充）

- 公共接缝：`readLogicalValueAtPath(doc: Y.Doc, path: readonly (string | number)[])`，经 `packages/doc-runtime/src/index.ts` 导出；同步、不抛错。
- 结果联合（issue #75 注记 B 冻结形态的延续，签名改造不改变错误通道）：
  `{ ok: true; value: unknown } | { ok: false; code: 'PATH_NOT_ALLOWED'; path: readonly (string | number)[]; message?: string }`
  —— 预期 path/载体失败统一此通道；message 为诊断增补（非契约字段）。
- schema-independent 语义红线：`['任意string键']` 不再因「schema 未知字段」返回 PATH_NOT_ALLOWED，而是「容器缺键 → ok:true undefined」或「值域违规 → ok:false」。

### 产出文件

- `packages/doc-runtime/test/read-logical-value-at-path-schema-independent.test.ts`（行为层，33 例）
- `packages/doc-runtime/test/read-logical-value-at-path-schema-independent.test-d.ts`（类型层，4 例）

### 红灯验证证据（2026-08-23，双通道，均真实红）

命令 1：`npx vitest run --typecheck packages/doc-runtime/test/read-logical-value-at-path-schema-independent.test.ts packages/doc-runtime/test/read-logical-value-at-path-schema-independent.test-d.ts`
结果：`Test Files 2 failed (2)`；`Tests 37 failed (37)` —— 100% 红。
典型失败：`AssertionError: expected false to be true`（当前实现收 Y.Doc 于 derived 位 → 崩溃边界 `ok:false, path:[]`）；`expected [] to deeply equal ['items', -1]`（path 回显缺失）；TS2554 `Expected 3 arguments, but got 2`；TS2578 `Unused '@ts-expect-error' directive`（旧三参签名当前合法）。

命令 2：`npx tsc -p packages/doc-runtime/tsconfig.json`
结果：`TSC_EXIT=2`（TS2554×64 + TS2578×1）。

红灯机理（构造性）：当前实现为 issue #75 冻结的 schema-aware 三参签名；本文件全以双参调用——运行时 `derived.structure` 取空 → 顶层崩溃边界返回 `{ok:false, code:'PATH_NOT_ALLOWED', path:[], message:'DOCRT-E100…'}`，故全部 ok:true 断言与全部非空 path 回显断言红；类型层双参调用报 TS2554、三参行 `@ts-expect-error` 为 unused。SA3 实现新签名后转绿。

### 交接注意事项

- 既有 6 个 `read-logical-value-at-path*.test.ts`（含 rev1/rev2）锚定的是**已被 ADR-0008 取代**的 schema-aware 三参语义（未知字段 → PATH_NOT_ALLOWED 与新语义直接矛盾，且均以三参调用）；按 AC7「调整调用面与行为测试」，由 SA3 在实现期适配/移除，与本文文件共同达成全量 typecheck/test 绿灯。
- fixture 可行性已对 yjs@13.6 实证：plain 数组/对象引用原样入 Y.Map（getter 零触发、原型保留、identity 保留，仅 encode 时 JSON 化——读取契约是 live doc 内存视图，本测试从不 encode）；bigint/NaN/undefined/嵌套 Yjs 均可经公共 API 置入 plain 容器。
- 未新增包/端口依赖（仅既有 yjs/vitest/@nomicore/vfsl），`scripts/test-lock.sh` 不存在，无需更新。
