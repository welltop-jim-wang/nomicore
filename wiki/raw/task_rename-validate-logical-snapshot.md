# MABF Task: 重命名逻辑快照验证器：validateLogicalSnapshot

## Issue #71

## Parent

PR [#70](https://github.com/welltop-jim-wang/nomicore/pull/70)（docs/doc-runtime-validation）

## Task Type

refactor

## What to build

将现有公共 API `validateSnapshot` 直接更名为 `validateLogicalSnapshot`，一次性迁移全仓源码、测试、文档与导出，不保留 deprecated alias。新名称必须明确表达：输入是普通 JSON logical ROOT snapshot，不接受 Y.Doc、Y.Map 或 Y.Array；既有值语义、issues、资源预算、纯函数与零写入行为保持不变。

## Acceptance criteria

- [ ] 公共导出只存在 `validateLogicalSnapshot`，旧名在模块导出与调用方中均不存在
- [ ] 全仓调用方、测试和文档完成迁移，行为测试证明既有校验契约零回归
- [ ] JSDoc 明确 logical JSON 与 live Yjs 载体的边界
- [ ] 全量 test、typecheck 与 Node 20/24 CI 通过

## Blocked by

Blocked by: None - can start immediately

## Working Directory

/home/wangjian/nomicore-fix-issue-71

## Branch

fix/issue-71-on-docs-doc-runtime-validation

---

## SA6 Phase 1 测试记录（2026-08-22 定稿，红灯契约锚定）

### 去重取舍（总控确认后执行）

两套候选方案（单文件 Part A 绿基线+Part B 红锚 vs 共享断言集+红灯测试 双跑）经实跑评估后**保留双跑方案**，合并两套覆盖为唯一一套连贯契约：
- 共享断言集补齐单文件方案独有锚点：E100 崩溃边界（删 values.ROOT）、恰 100 条无截断边界；
- 单文件方案（`validate-logical-snapshot.contract.test.ts`）已删除，不并存。

### 最终保留文件清单（唯一交付套件）

| 文件 | 角色 | 状态 |
|---|---|---|
| `packages/vfsl/test/validate-logical-snapshot.contract.ts` | 共享行为回归断言集 `registerBehaviorRegression(fn)`（27 条：issues 语义 / 资源预算 / 纯函数 / 零写入 / E100 / 截断边界），可对任意校验函数执行 | 不直接运行（非 *.test.ts） |
| `packages/vfsl/test/validate-logical-snapshot.test.ts` | 公共导出面验收（AC1 新名存在 / AC2 旧名不存在）+ 以新名执行共享断言集（共 29 条） | **红灯**（29/29 fail） |

### 删除文件清单

| 文件 | 原因 |
|---|---|
| `packages/vfsl/test/validate-logical-snapshot.contract.test.ts` | 单文件方案（Part A 绿基线 + Part B 红锚），与保留方案覆盖高度重叠，去重后删除（Part A 曾实测 20/20 绿、Part B 5/5 红，锚点已并入保留方案） |
| `packages/vfsl/test/validate-logical-snapshot.greencheck.test.ts` | 临时绿验文件（以旧名执行共享断言集），验证完成即删，不得入库 |

### 契约覆盖（全部锚定可观测行为，无源码 grep）

1. **公共导出面**：`validateLogicalSnapshot` 为函数；`validateSnapshot` 不在模块导出（`toBeUndefined`，真·模块级锚）。
2. **issues 语义**：结果形状/JSON 往返；未知键/必填缺失精确消息；嵌套 path 段数组；Record 键零转义（`["assets","abc.123"]`）；数组下标 number 段；非对象顶层整体拒绝；枚举/Record 键 Pattern/联合 any-of + no-match 最近成员（「联合成员 1/2」）；判别式缓存透明；XML 良构；E100 崩溃边界（删 values.ROOT → 单条 E100、path []）。
3. **资源预算**：全收集 + 100 上限 + 截断标记精确消息（150 条→101 输出「另有 50 处未报告」）；**恰 100 条边界无截断标记**；Pattern 匹配步数 4M 钳制精确消息；**全局工作预算 2×10⁸ 耗尽 fail-closed**（NFA 步跨 80 次匹配累计 ≈3.2×10⁸，单条 issue、path []、与 E100/截断/Pattern 三重可区分，实测 4.6s）。
4. **纯函数 / 零写入**：同输入同输出、确定性、派生物不被修改；**深度冻结 derived 与 snapshot 输入**下校验照常完成（写输入尝试 → 严格模式 TypeError → 断言失败，零写入行为锚）。

### 红灯验证（最终交付状态，当前实现必然失败）

```bash
npx vitest run packages/vfsl/test/validate-logical-snapshot.test.ts
# Test Files  1 failed (1)   Tests  29 failed (29)   EXIT=1   Duration 762ms
# 关键断言失败证据：
# × AC1：expected 'undefined' to be 'function'             （validateLogicalSnapshot 未导出）
# × AC2：expected [Function validateSnapshot] to be undefined （旧名仍在导出）
# × 行为回归 27 条：TypeError: validate is not a function   （新名缺失）
```

### 绿验证明（A.3 步骤 1：契约精确描述当前行为）

以旧名 `validateSnapshot` 临时执行同一共享断言集（greencheck 文件，验证后已删除）：

```bash
npx vitest run packages/vfsl/test/validate-logical-snapshot.greencheck.test.ts
# Test Files  1 passed (1)   Tests  27 passed (27)   EXIT=0   Duration 5.30s
```

→ 共享断言集（含 E100/截断边界）对当前实现 27/27 全绿，证明其精确描述既有行为；SA3 更名后新名执行转绿即「行为零回归」的行为证明。

### 既有套件未扰动

```bash
npx vitest run packages/vfsl/test/validate-snapshot.test.ts packages/vfsl/test/validate-patch.test.ts
# Test Files  2 passed (2)   Tests  71 passed (71)   EXIT=0
```

### SA3 迁移提示

- `validate-logical-snapshot.test.ts` 断言零改动：`src/index.ts` 导出 `validateLogicalSnapshot` 且移除 `validateSnapshot` 后本文件整体转绿（namespace 取成员，无静态旧名 import）。
- `validate-logical-snapshot.contract.ts` 为共享断言集，不直接运行、无需迁移。
- 全仓其余测试文件（validate-snapshot.test.ts / sa7 / validate-patch / docscope-guards / fullchain-e2e 等）按常规机械更名。
