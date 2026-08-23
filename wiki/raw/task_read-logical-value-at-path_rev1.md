# MABF 修订任务简报（rev1）— readLogicalValueAtPath union 仲裁遮蔽缺陷

- **run_id**: issue-75-rev-1787397220
- **branch**: fix/issue-75-on-docs-doc-runtime-validation
- **关联**: PR #83 / Issue #75；原始简报 `task_read-logical-value-at-path.md`
- **任务类型判定**: Bug 修复（P1 正确性缺陷，owner 评审 Request changes）

## Owner 反馈全文（PR #83 Review：合并前需要修订）

发现一个 **P1 正确性问题**：Phase B 的 union 仲裁会把前序成员的"合法缺席"当作最终成功，从而遮蔽后续成员中实际存在的值。

### 问题位置

- `packages/doc-runtime/src/read.ts:323-325`：Record 缺键返回 `{ ok: true, value: undefined }`
- `packages/doc-runtime/src/read.ts:329-334`：optional 缺席同样返回成功的 `undefined`
- `packages/doc-runtime/src/read.ts:343-349`：union 以首个 `r.ok` 为胜者并停止尝试后续成员

### 最小反例

```vfsl
type U = Record<string, YLeaf<string>> | { foo: YLeaf<string> };
type ROOT = YMap<{ x: U }>;
```

当 live 数据为 `x = Y.Map({ foo: "v" })`，读取 `['x', 'foo']` 时：

1. 第一个 `Record` 成员把 `foo` 解释为缺失键并返回 `ok:true, value:undefined`；
2. union 立即结束成员试探；
3. 后续 `{ foo: ... }` 成员中实际存在的 `"v"` 被遮蔽；
4. API 静默返回错误的 `undefined`。

这违反按 LogicalPath 读取实际逻辑值及 union any-of/成员回退语义；调用方也无法区分"真正缺失"与"实现过早选择了错误成员"。

### 修订建议

Phase B 内部结果需要区分"实际产出""合法缺席""本成员拒绝"，例如：

```ts
type NavOutcome =
  | { kind: 'value'; value: unknown }
  | { kind: 'missing' }
  | { kind: 'reject' };
```

union 仲裁建议：

1. 首个真实 `value` 胜出；
2. 前序成员只得到 `missing` 时继续尝试后续成员；
3. 所有可行成员均只能得到 `missing` 时，才返回 `ok:true, value:undefined`；
4. 全部成员 `reject` 时返回 `PATH_NOT_ALLOWED`。

同时需结合现有 extract/union 声明序规则，明确 required-missing、载体错位和合法缺席的优先级。

### 必须补充的回归测试

- 前一成员 Record 缺键、后一成员封闭 map 字段实际在场；
- 前一成员 optional 缺席、后一成员实际值在场；
- 若结构系统允许：前一成员数组越界、后一成员可解析同一路径；
- 所有可行成员均合法缺席时仍返回 `ok:true, value:undefined`；
- 交换 union 成员声明顺序后，实际值读取结果不变。

现有 `read-logical-value-at-path-supplementary.test.ts` 的 SUP-1 只覆盖前序成员实际产出 XML 的情形，没有覆盖"前序成员合法缺席 vs 后序成员实际在场"的竞争。

**Review 结论：Request changes；修复该问题并补充测试后再合并 PR #83。**

## 验收标准（本修订轮）

- [ ] AC-R1: Phase B 导航结果区分 value / missing / reject 三态（或等价机制）
- [ ] AC-R2: union 仲裁：首个真实 value 胜出；前序仅 missing 时继续后续成员；全部可行成员 missing → `ok:true, value:undefined`；全部 reject → `PATH_NOT_ALLOWED`
- [ ] AC-R3: 明确 required-missing / 载体错位 / 合法缺席的优先级，并与现有 extract/union 声明序规则一致（在设计文档中成文）
- [ ] AC-R4: owner 要求的全部回归测试补齐（Record 缺键 vs 后序在场、optional 缺席 vs 后序在场、数组越界 vs 后序可解析（如结构允许）、全部合法缺席仍 undefined、交换声明序结果不变）
- [ ] AC-R5: 不回归既有测试（含 SUP-1 XML 情形）
