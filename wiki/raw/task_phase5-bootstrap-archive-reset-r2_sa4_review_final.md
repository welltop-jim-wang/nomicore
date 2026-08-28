# SA4 最终闭环静态复核报告 — issue #133 round=2 方案 B（R-FIX-1 终局判定）

**Date**: 2026-08-28 08:55 (+0800)
**Reviewer**: SA4（静态验尸）
**Review target**: commits `1aa1994`（方案 B 分类学返工）+ `d52130b`（锚强化 + 标准轴 F-2/F-4）；基线 `8b1398f`（被 SA2 delta reject 的 A 变体）。HEAD 实为 `650c4d9`（docs-only，仅改 dispatch.md，已核）。
**权威设计**: `task_phase5-bootstrap-archive-reset-r2_design.md` §3.6（R4 微修订）+ §3.2:81-82。
**Verdict**: **pass**（无阻断修复项；2 条 LOW 备案观察，见 §3）

**取代声明**：`..._sa4_review_incremental.md`（8b1398f 增量 pass）中第 2 节「A' 变体成立」的分类学结论已被 SA2 delta reject 与本报告取代；其行为性结论（入口次序、零触达、TOCTOU 免疫）经本轮复验继续有效。

---

## 1. 逐项证据表（复核清单 1–8）

### 1.1 R4-D1：`InvalidIdentityIssue.field` 回退二元 ✅

| 检查 | 证据 | 结论 |
|---|---|---|
| field 联合回退二元 | `packages/namespace-registry/src/types.ts:120` = `readonly field: 'owner.userId' \| 'namespaceId';`；diff 8b1398f→HEAD 显示 `'owner.userId' \| 'namespaceId' \| 'expectedLocalIdentity'` → 二元 | ✅ |
| docstring 恢复 round-1 原文 | `types.ts:116` = `/** 无效身份窄 issue（open/create 共用；message 恒定、零回显字段值）。 */`；与 `git show 8b1398f^:...types.ts` 第 112 行逐字一致（R-FIX-1 扩写段整体删除） | ✅ |
| 全仓无 `'expectedLocalIdentity'` 作为 field 值残留 | `grep -rn "expectedLocalIdentity" --include="*.ts" packages apps` 仅命中：message 常量文本（types.ts:106）、docstring 引用（types.ts:350）、参数名（types.ts:533、registry.ts:1900/1915）、测试注释（r2-surface.test-d.ts:80 系「不得扩宽」的说明）；跨全文件类型 `grep -rn "field.*expectedLocalIdentity" --exclude-dir={node_modules,.git}` 排除 wiki 后 **零命中** | ✅ |

### 1.2 R4-D2：新常量 + append-only 成员 + 冻结常量形状 + 入口次序 ✅

| 检查 | 证据 | 结论 |
|---|---|---|
| 常量文本逐字 = 设计冻结文案 | `types.ts:105-106` = `'NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID: 期望本地复制身份（reset expectedLocalIdentity）不符合安全文法'`；design §3.6.1（:310）逐字一致；零插值、零值回显 | ✅ |
| `ResetReplicaIssue` 成员 append-only、无 field | `types.ts:378-382`：`Readonly<{ok:false; code:'NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID'; message: typeof ...}>` 追加于联合**末尾**（紧跟 `NAMESPACE_LOAD_FAILED` 成员后），联合其余 5 成员与次序零改动（diff 确认）；无 `field` 键 | ✅ |
| docstring 完整 | `types.ts:349-353`：R4 微修订段注明触发条件（入口快照校验失败即拒绝）、零 Persistence/probe/载体/entry 触达、无 field（判别由 code 承载）、常量 message 零值回显 | ✅ |
| registry.ts 冻结常量形状 = 设计 §3.6.1 代码块 | `registry.ts:474-478`：`Object.freeze({ ok: false as const, code: 'NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID' as const, message: NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID_MESSAGE })` —— 恰为设计 `ResetExpectedIdentityInvalidIssue` 三键形状（ok/code/message），无 field；8b1398f 旧形状（code `NAMESPACE_INVALID_IDENTITY` + field `'expectedLocalIdentity'`）整体替换 | ✅ |
| 常量单一真相源、不进 barrel | 定义仅 `types.ts:105`；引用仅 `registry.ts:119`（import）与 `:477`（常量体）；`grep index.ts` 零命中（设计 §3.6.1「不经主入口新增值导出」）；测试经包内相对导入 `../src/types.js`（internal 测试 :53，既有先例形态） | ✅ |
| 入口次序零改动 | `registry.ts:1910-1919`：acceptance（:1910）→ `validateOpenIdentity`（:1911）→ `snapshotReplicationIdentityRef`（:1915）→ 失败 `return RESET_EXPECTED_IDENTITY_INVALID_ISSUE`（:1917）→ `admitResetSlot`（:1919）；与 design §3.6.2 冻结伪码（:337-347）一致；对照 8b1398f 仅注释与常量内容变，控制流零变 | ✅ |

### 1.3 D-3 测试锚（internal，d52130b 强化版）✅

| 检查 | 证据（`registry-phase5-bootstrap-reset-r2-internal.test.ts`） | 结论 |
|---|---|---|
| 16 形态逐项 `toEqual` 深等 | `HOSTILE_INPUTS`（:104-125）恰 16 条（null/undefined/array/function/string/number/getter-throw/proxy-throw/inherited/accessor-id/invalid-id/NaN/Infinity/zero/fractional/missing-epoch-key，覆盖 design §3.6.2 敌意清单全类）；循环 :663-681 对每形态 `expect(issue, hostile.name).toEqual({ok:false, code:'NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID', message: NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID_MESSAGE})`（:670-674）——导入常量（:50-53）非本地重抄；toEqual 双向结构相等，任何已定义 `field` 键即红 | ✅ |
| 常量文本字面量锁 | :682-685 `expect(NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID_MESSAGE).toBe('<冻结文案逐字>')` | ✅ |
| 逐形态零触达/零破坏锚（d52130b 强化） | :677-680 每形态循环内 `probeCalls=[]`、`archiveCalls=[]`、`leaseStatus(lease).lease==='active'`、`runtime?.lifecycle==='ready'`；:686-691 循环外汇总锚保留 | ✅ |
| 正确 expected 重试（首次 probe 计数 1） | :693-700：重试成功、`archiveCalls` 长度 1、`probeCalls.length===1`（:699 注释「重试才首次触达」）、原 lease released | ✅ |
| 边界用例（owner/namespace 非法仍走旧二元） | :726-758 新增：`resetReplica(null, …)` → 完整 `toEqual` `{code:'NAMESPACE_INVALID_IDENTITY', field:'owner.userId', message: NAMESPACE_INVALID_IDENTITY_MESSAGE}`（:737-742）；`resetReplica(ALICE,'bad/ns',…)` → `field:'namespaceId'`（:747-752）；上游拒绝零触达（:754-756）——design §3.6.3 第 4 条「防专属 reset code 劫持上游 identity 分类」落锚 | ✅ |
| TOCTOU 冻结样本锚零损伤 | :704-724（调用后改写 `replicationEpoch=999`，archive 收到冻结 `{ID_A,1}`）——不在任何 diff hunk 内，零改动 | ✅ |
| F-1 observer 锚零损伤 | :780-798 断言体零改动（diff 仅命中 it/describe 标题行） | ✅ |

### 1.4 D-4：F-1 标题收窄 ✅

- internal 测试 :763 describe 尾注 `（cause/事件载荷不含身份值）` → `（cause 零身份值回显）`；:764 it 尾段同改——与 design §3.6.3 第 5 条措辞一致；断言体（cause 序列化后 not.toContain ID_A/NS_B/u-alice）与事件标准 `identity` 字段语义注释（:789-792）零改动。

### 1.5 surface test-d：四 alias 恒等锚 + 新码可达/无 field 锚真实有效 ✅

文件：`registry-phase5-bootstrap-reset-r2-surface.test-d.ts`

| 锚 | 证据 | 真实性判定 |
|---|---|---|
| 四 alias field 恒等 | :84 标准 `Equal<A,B>` 同构 idiom；:86-89 `InvalidIdentityFieldVia` 经 `Extract<Union,{code:'NAMESPACE_INVALID_IDENTITY'}> extends {readonly field: infer F}`；:103-110 对 Open/Create/Import/Reset 四联合逐一 `Equal<…, 'owner.userId' \| 'namespaceId'> = true` | **非恒真**：field 联合任何扩宽/收窄 → `Equal` 求值 `never` → `never = true` 编译红（若 8b1398f 的三元联合存在即红——历史性反证） |
| 新码可达 | :92-93 `Extract<ResetReplicaIssue,{code:…}> extends never ? never : true`；:116 赋值锚 | **非恒真**：成员被删 → `never extends never` → 取 never 分支 → 红 |
| 无 field 键 | :96-99 `'field' extends keyof Extract<…> ? never : true`；:118 赋值锚 | **非恒真**：成员加 field（含 optional）→ keyof 含 'field' → 红 |
| 既有签名锚零改动 | :61-73（import 4 参 / reset 3 参）不在 diff hunk | ✅ |
| 运行证据 | 本轮亲跑 `vitest run --typecheck.only`：`✓ TS r2-surface.test-d.ts (4 tests)`，Type Errors: no errors，exit 0 | ✅ |

### 1.6 F-2 / F-4：注释与措辞修复零行为改动 ✅

| 项 | 证据 | 结论 |
|---|---|---|
| F-2（registry.ts 注释） | diff hunk 仅 `@@ -1677,8 +1677,11 @@`：`-//`×2 → `+//`×5（`beginCloseCurrent` → `beginIdleClose` ①-③ + `fence.startCloseAfterFence()` 懒创建 + closePromise 幂等缓存共用）；代码行 `if (current.closePromise === undefined) {` / `current.closePromise = closePromise;` 等全部为 context 行。registry.ts 其余 3 hunk 为 import（:110 区）/常量体（:465 区）/resetReplica 注释（:1896 区） | ✅ 注释-only |
| F-4（r2-red 措辞） | 非注释变更行过滤后全 diff 仅 1 行 it 标题（`（临时拼写）`→`（已冻结拼写）`，:567 区）；其余全为 ` *`/`//`/`/**` 注释行（头注三码措辞、契约声明段、本地 interface docstring、§banner）；`expect(`/调用面零变化（`grep -E "^[+-]" | grep -v 注释` 仅命中该 it 行） | ✅ 零行为断言改动 |

### 1.7 回归红线 ✅

- `git diff --name-only 8b1398f..d52130b`（实现范围）= registry.ts、types.ts、三个 r2 测试文件 + wiki/raw 档案（白名单）；`650c4d9`（HEAD）仅 `..._dispatch.md`。
- `git diff 8b1398f..HEAD -- identity.ts index.ts observer.ts packages/namespace-runtime/src packages/persistence/src docs/adr` → **空 diff**。
- registry.ts 内 open/create/import 路径零触碰：4 个 hunk 位于 :110（import 表）、:465（新常量体）、:1679（F-2 注释）、:1902（resetReplica 注释）；importReplica 入口（:1873-1895）与 `identity.ts` 的二元 field 构造点不在任何 hunk。
- 文件面 ∈ 设计 §8 ALLOW LIST（design:498-499 registry/types R4 注记、:510-512 三测试文件 F-4/R4 授权）；DENY LIST 零命中；`git diff --check 8b1398f..HEAD` exit 0。
- CI 触发：`.github/workflows/ci.yml:39` `pnpm test` = 根 `vitest run --typecheck`（package.json:11），include 含 `packages/*/test/**/*.test.ts` 与 typecheck include `packages/*/test/**/*.test-d.ts`——三个 r2 测试文件与 test-d 全部在矩阵（node 20/24）触发面内。

### 1.8 SA2 delta 第二轮 R4-F1：三码表触发句 ↔ fence 槽判定语义一致 ✅

- **设计侧**（design:333，由 `00f2fb2` 引入——`git log -L 333,333` 确认）：`NAMESPACE_RESET_IDENTITY_MISMATCH` 触发 = 「expected 合法但 live **或** persisted **任一** `identityEquals` 为 false（含该侧 disabled、身份不合规、值不等）」。触发主句与 SA2 批准句逐字一致。
- **实现侧**：判定不在 registry.ts 而在 Runtime 侧 fence 槽——`packages/namespace-runtime/src/runtime.ts:262-266`：`!fenceIdentityEquals(liveChecked, expected) || !fenceIdentityEquals(persisted.identity, expected)` → `{kind:'mismatch'}`；`fenceIdentityEquals`（runtime.ts:216-223）逐字实现 design §3.2:69-76 的 `identityEquals`（`actual.ok && replicationId === && replicationEpoch ===`）：
  - live disabled → `{ok:false}`（runtime.ts:257-260）→ 恒 false ✅（「含该侧 disabled」）
  - persisted 解码不合规 → probe 产出 `{ok:false}` → 恒 false ✅（「身份不合规」）
  - 值不等 → false ✅（「值不等」）
  - **任一** false（`||`）即 mismatch，不是「两侧都不等」✅（R4-F1 消除的误读方向）
- registry.ts 侧接线：`runResetSlot` 步 ⑤ `beginResetFence(expected, () => readPersistedIdentity(identity))`（registry.ts:1647-1655）；`fence.kind==='mismatch'` → `RESET_IDENTITY_MISMATCH_ISSUE`（registry.ts:1664-1666，常量体 :440）；armed 后 archive 消费同一冻结 expected（:1704）。

---

## 2. 本轮亲跑验证证据（辅助；动态验证仍归 SA7）

```
vitest run r2-red + r2-internal（filter）→ Test Files 2 passed / Tests 26 passed（red 10 + internal 16）, exit 0
vitest run --typecheck.only r2-surface.test-d.ts → ✓ TS (4 tests), Type Errors: no errors, exit 0
git diff --check 8b1398f..HEAD → exit 0
```

与 sa3_impl.md R4 段申报数字（internal+red 25→本轮 26 系 d52130b 追加边界用例后的 +1；surface 4 锚）一致。

## 3. 备案观察（LOW，非阻断）

1. **R4-F1 措辞「逐字」精度**：design:333 括注用 `、` 分隔（`disabled、身份不合规、值不等`），SA2 批准句为 `/` 分隔（`disabled/身份不合规/值不等`）。触发主句（「live 或 persisted 任一 `identityEquals` 为 false」）逐字一致，括注为纯标点差异、语义零漂移。SA2 规则原文「其他措辞需复审」按字面可覆盖标点差异，但本偏差不改变任何判定语义，备案供总控裁量，不设为修复项。
2. **r2-surface.test-d.ts:62 既有 it 标题**仍含「临时形状待 SA1 冻结」（import 第 4 参数锚）。F-4 授权范围仅 r2-red.test.ts，SA3 未越权清理属正确遵守 ALLOW 边界行为；建议未来标准轴顺手统一，不属本轮。

## 4. 审核结论（技能清单映射）

1. 设计一致性：✅（§3.6 R4 冻结逐条落位；偏离零）
2. 读写路径一致性：✅（常量单一真相源 types.ts；barrel 零导出；测试包内相对导入）
3. 静默失败：✅ 无新路径（入口拒绝为显式窄 issue，零副作用有逐形态锚）
4. 降级方案：✅ 无新增降级
5. 极端攻击：✅（16 敌意形态 + TOCTOU + 边界 owner/ns 双向，全锚定）
6. 错误处理：✅（三码不重合、判别面诚实）
7. 架构评估：✅ 可行（方案 B 与 import 侧先例对称，无需退回 SA1）
8. 过度设计：✅ 精简（append-only 一成员 + 一常量 + 测试锚）

## 5. 动态审核重点（交 SA7，增量）

- 无新增动态风险点。SA7 仅需按既有计划重跑受影响目标集（r2-red/internal/surface typecheck + 全量回归），确认 CI 矩阵（node 20/24）`pnpm test` 全绿即可封口。

## 6. Verdict

**pass**。方案 B 分类学返工（1aa1994）与锚强化/标准轴（d52130b）对 SA2 delta D-1..D-4 + R4-F1/F2 的闭环全部成立，回归红线零触碰，测试锚为可失败的真实断言。R-FIX-1 最终闭环判定：**达成**。本报告为该议题 SA4 终局结论。
