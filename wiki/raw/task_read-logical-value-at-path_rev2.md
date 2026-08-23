# MABF 修订任务简报（rev2）— union 仲裁回归测试变异判别力补缺

- **run_id**: issue-75-rev-1787397220
- **branch**: fix/issue-75-on-docs-doc-runtime-validation
- **关联**: PR #83 / Issue #75；rev1 简报 `task_read-logical-value-at-path_rev1.md`；原始简报 `task_read-logical-value-at-path.md`
- **任务类型判定**: **深度重构**（可测性重构 + 测试硬化）。依据：owner 第二轮 Review 明确「生产实现修复正确，当前无新的 correctness blocker」——无缺陷需复现（裁剪 SA5）；剩余问题为回归测试对 D17 value-first 核心分支缺乏变异判别力，修订手段含生产代码变更（抽取包内纯仲裁函数 seam）→ 按「有代码变更必须有 SA3+SA4+SA7、有设计必须有 SA1+SA2、验收型任务必须有 SA6 锚定」排定工作流：SA8 前置门禁 → SA6 红灯锚定 → SA1 设计 → SA8 设计复审 → SA2 攻击评审 → SA3 实现 → 总控亲跑验收 → SA4 静态验尸 → SA7 动态验证 → AC 门禁 → 收尾（commit + push，修订轮允许 push；严禁提交 `.mabf/**` 与 `.mabf-bg/**`）。

## Owner 反馈全文（PR #83 第二轮 Review：剩余需要修订的问题，welltop-jim-wang @ 2026-08-22T13:50:59Z）

上一轮指出的生产代码问题已经正确修复：`read.ts` 现在使用 `value / missing / reject` 三态，union 遇到 `missing` 会继续尝试后续成员，首个真实 `value` 胜出；没有 value 但存在 missing 才返回 `undefined`，全 reject 才返回 `PATH_NOT_ALLOWED`。

当前剩余问题是 **回归测试缺乏对核心修复分支的变异判别力**。

### P1：新增 R1/R2/R3 测试没有真实执行 `missing → later value`

位置：

- `packages/doc-runtime/test/read-logical-value-at-path-rev1-union-arbitration.test.ts:89-220`
- 被测核心逻辑：`packages/doc-runtime/src/read.ts:351-360`

新增测试宣称覆盖：

- 前一 Record 成员 missing，后一成员 actual value；
- 前一 optional 成员 missing，后一成员 actual value；
- 前一数组成员越界，后一成员可解析同一路径。

但当前 fixture 中并未实际产生该执行路径：

1. `Record<string, YLeaf<string>> | { foo: YLeaf<string> }`，live 为 `{foo:'v'}` 时，前一 Record 成员自身就直接读到 `v`，不会返回 missing；
2. optional 字段在场时，前一 optional 成员也直接返回 value；
3. 数组 index 界内时前一数组成员直接返回 value；越界时后续 Record 无法消费 number segment，只会 reject。

因此，如果把实现错误地退回旧逻辑——union 遇到第一个 `missing` 就立即返回、不继续扫描后续成员——这些 R1/R2/R3 测试仍然会全绿。它们是行为一致性 green lock，但不是 D17 value-first 核心分支的有效回归锚。

### 建议的最小修订

将三态仲裁抽成包内纯函数，例如：

```ts
function arbitrateUnion(outcomes: Iterable<NavOutcome>): NavOutcome
```

或提供等价的可控包内测试 seam，然后增加表驱动测试：

```text
[missing, value('v')]  → value('v')
[value('v'), missing]  → value('v')
[missing, reject]      → missing
[reject, missing]      → missing
[missing, missing]     → missing
[reject, reject]       → reject
```

其中第一条必须证明：前序成员已经产生 missing 后，仲裁仍继续并由后序真实 value 胜出。

同时建议：

- 将 R1/R2/R3 的说明改为"现行合法 schema/live 模型下不可构造竞争场景的行为一致性锁"，不要宣称它们动态覆盖了 `missing → later value`；
- 做一次 mutation proof：临时把循环改成"首 missing 即返回"，确认新增纯仲裁测试会失败。

### 已有效覆盖、无需返工的部分

- all-missing → 显式 `undefined`；
- mixed missing + reject 的双顺序；
- nested union 三态上浮；
- 全 reject → `PATH_NOT_ALLOWED`；
- 受限于 leaf/标量终点的成员顺序交换；
- value-first 新试探面的 memo 性能护栏；
- Issue #75 原 AC1–AC6。

### Review 结论

生产实现修复正确，当前无新的 correctness blocker；但按"修复必须有能杀死旧错误逻辑的回归测试"标准，仍建议：

**Request changes：补充可真实驱动 `missing → later value` 的包内仲裁测试后 Approve。**

## 验收标准（本修订轮 rev2）

- [ ] AC-R2-1: 三态仲裁抽为包内纯函数（如 `arbitrateUnion(outcomes: Iterable<NavOutcome>): NavOutcome`）或等价可控包内测试 seam；`read.ts` union 分支经该 seam 仲裁；INV-14 不破坏——seam 与 `NavOutcome` 保持包内私有（`packages/doc-runtime/src/index.ts` 公共导出零新增，test-d 冻结形态锁保持绿）；声明序迭代与首 value 短路惰性（不预先消费后序成员）语义不变。
- [ ] AC-R2-2: 新增表驱动包内仲裁测试，六行全齐：`[missing, value('v')] → value('v')`（首行必须证明前序 missing 后仲裁继续、后序真实 value 胜出）、`[value('v'), missing] → value('v')`、`[missing, reject] → missing`、`[reject, missing] → missing`、`[missing, missing] → missing`、`[reject, reject] → reject`。
- [ ] AC-R2-3: R1/R2/R3 测试说明（文件头注释 + describe/it 措辞）改写为「现行合法 schema/live 模型下不可构造竞争场景的行为一致性锁」，删除/修正一切「动态覆盖 missing → later value」的宣称；行为断言零改动。
- [ ] AC-R2-4: mutation proof 执行并留证：临时把仲裁改为「首 missing 即返回」，确认新增纯仲裁测试转红（并记录 R1/R2/R3 在该变异下仍全绿的对照事实——即变异判别力仅由新增测试提供）；随后还原变异，全量测试复绿。证据写入 SA7 报告。
- [ ] AC-R2-5: 不回归既有测试（rev1 五组绿灯锁 + H-a/H-b/H-c hardening 护栏 + SUP 系列 + 全仓其余套件）；`packages/doc-runtime` patch 版本 bump（0.1.3 → 0.1.4，硬门禁 #9）；`packages/vfsl` 等 DENY 面零改动。

## 关键约束摘录（全链复用，详见 rev1 relevant_decisions）

- INV-14：三态不泄漏——`NavOutcome` 包内私有，missing/reject 不进公共联合；顶层映射恒收束冻结两态（test-d 锁）。
- INV-7 / D17：union 仲裁声明序迭代、首个真实 value 胜、missing 继续、全 missing → missing、全 reject → reject；观测等价定理（INV-13）——本轮对合法输入仍须零可观测行为变更。
- D13/memo：抽取 seam 不得破坏 per-call memo 挂点与 H-a 性能护栏（value-first 试探面成本上界）；惰性消费后序成员为首 value 短路前提。
- DENY（rev1 延续）：`packages/vfsl/src/**`、extract.ts / carrier.ts / index.ts 的行为变更、read.ts Phase A 全部。
- SA6 owned 测试文件纪律：rev1 已入库测试的行为断言 SA3 不得改；rev2 措辞勘误（AC-R2-3）由 SA6 执行。
