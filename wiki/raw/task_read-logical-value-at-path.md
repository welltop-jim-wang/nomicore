# MABF Task: 按 LogicalPath 同步读取 Yjs 子树逻辑值

## Issue #75

## Parent

PR [#70](https://github.com/welltop-jim-wang/nomicore/pull/70)（docs/doc-runtime-validation）

## Task Type

feature

## What to build

实现同步 `readLogicalValueAtPath(derived, doc, path)`，在 Runtime 已经由加载/更新验证维持结构不变量的前提下，不重复全树验证，只定位和转换目标子树。返回普通值副本，不泄漏 Yjs 类型。

## Acceptance criteria

- [ ] path 统一为 `readonly (string | number)[]`；空 path 显式读取完整 ROOT
- [ ] schema 不允许的路径返回 `PATH_NOT_ALLOWED`
- [ ] 合法 optional/Record 缺键和非负整数数组越界返回 `ok:true, value:undefined`
- [ ] 负数、非整数或字符串数组下标非法
- [ ] leaf/plain/XML 为不可下钻终态；plain 数组只允许整体读取
- [ ] 读取成本与目标子树规模相关，返回值修改不影响 live doc

## Blocked by

Blocked by: #73

## Working Directory

/home/wangjian/nomicore-fix-issue-75

## Branch

fix/issue-75-on-docs-doc-runtime-validation

## SA6 Phase 1 验收锚定（红灯测试）

### 产出文件

- `packages/doc-runtime/test/read-logical-value-at-path.test.ts` — 运行时行为验收（20 用例 / 6 组）
- `packages/doc-runtime/test/read-logical-value-at-path.test-d.ts` — 类型层签名契约（AC1 path 形态 + 结果联合）

### 冻结契约（SA1 设计不得收窄，仅可补充）

1. **公共接缝**：`readLogicalValueAtPath(derived: DerivedSchema, doc: Y.Doc, path: readonly (string | number)[])`
   经 `packages/doc-runtime/src/index.ts` 导出；同步、不抛错（错误经返回值传递）。
2. **结果联合**（冲突报告注记 B：`{ ok:false, code:… }` 领域化形态，不并入逻辑 issues 体系）：
   - `{ ok: true; value: unknown }` — 成功 = 目标子树普通值深拷贝；空 path = 完整 ROOT 副本；
   - `{ ok: false; code: 'PATH_NOT_ALLOWED'; path: readonly (string | number)[] }` —
     schema 不允许的路径；fail-fast 单错，path 回显整条尝试路径（与 ExtractIssue.path 先例一致）。
3. **AC3 缺键形态**：`{ ok: true; value: undefined }` — value 键必须显式存在且为 undefined（禁省略键）。
4. **无 Yjs 泄漏**：成功 value 为普通值副本（JSON 往返无损、无 Y.Map/Y.Array/Y.XmlFragment/Y.Text）；
   XML 为字符串投影，只承诺语义等价（不锁逐字）。
5. **AC6 行为锚点**（不锁实现）：目标子树读取只返回目标子树（非全树）；与目标无关的兄弟子树结构
   损坏不影响目标读取（=「普通读取不重复验证，只按 path 快速执行」的可观测面）；返回值修改不影响
   live doc（重读原值 + extractYjsSnapshot 实证）。

### 验收标准 → 测试映射

| AC | 测试锚点 | 用例 |
|----|----------|------|
| AC1 | `[]` → 完整 ROOT 副本（JSON 往返 + 无泄漏）；`readonly (string|number)[]` 变量/`as const` 元组可传；空 doc 边界 `[]` → `{}`；点号字符串/裸 string/裸 number path 类型层编译错误（@ts-expect-error 自我反转） | test: 1–3；test-d: 全部 |
| AC2 | 未知 ROOT 字段、Record 键违反 Pattern（含空格/!）、union 成员内未知字段 → `{ ok:false, code:'PATH_NOT_ALLOWED', path 回显 }` | test: 4–6 |
| AC3 | 缺席 optional、缺席 Record 键（键合法）、非负整数越界 → `{ ok:true, value:undefined }`（value 键存在）；在场正向对照 | test: 7–10 |
| AC4 | `-1`、`1.5`、`'0'` 数组下标 → PATH_NOT_ALLOWED；合法下标正向对照 | test: 11–14 |
| AC5 | leaf 下钻、xml-fragment 下钻 → PATH_NOT_ALLOWED；plain 数组元素读取 → PATH_NOT_ALLOWED、整体读取 → 全量副本 | test: 15–17 |
| AC6 | 目标子树读取只含子树；返回值 push/改写/嵌套写后重读原值 + extract 实证；坏兄弟子树不影响目标读取（双向） | test: 18–20 |

### 红灯运行记录（Phase 1 验证）

**命令 1（运行时行为）**：`pnpm exec vitest run packages/doc-runtime/test/read-logical-value-at-path.test.ts`

```
Test Files  1 failed (1)
      Tests  20 failed (20)
Type Errors  no errors
```

关键断言输出（全 20 用例同一根因，构造性红灯——公共导出缺失）：

```
FAIL ... > AC1 — 空 path 读取完整 ROOT ... > [] → ok:true，value 为完整 logical ROOT 普通值副本 ...
TypeError: (0 , readLogicalValueAtPath) is not a function
```

**命令 2（类型层）**：`pnpm exec tsc -p packages/doc-runtime/tsconfig.json`（exit 2）

```
packages/doc-runtime/test/read-logical-value-at-path.test-d.ts(21,10): error TS2305:
  Module '"../src/index.js"' has no exported member 'readLogicalValueAtPath'.
packages/doc-runtime/test/read-logical-value-at-path.test-d.ts(36,5): error TS2578:
  Unused '@ts-expect-error' directive.   （×3：import 断裂时 TS 无法校验调用，指令暂显 unused；
  SA3 实现正确签名后 3 条负例均为真实编译错误 → 指令被消费 → 转绿）
packages/doc-runtime/test/read-logical-value-at-path.test.ts(61,10): error TS2305: ...
```

**回归对照（同仓既有测试）**：`pnpm exec vitest run packages/doc-runtime/test/` → 5 个 extract 既有文件全绿
（48 用例通过），仅本任务 2 个新文件红（20 运行时 + 1 类型层）——无回归。

**红灯判定**：✅ 成立。`index.ts` 尚无 `readLogicalValueAtPath` 导出（ESM 命名导出解析失败 +
TS2305），全部验收用例必失败；SA3 实现公共导出后按冻结契约转绿。
