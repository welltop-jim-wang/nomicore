# SA3 实现报告 — File diagnostic-log adapter（issue #152）

**Date**: 2026-08-28
**Objective**: SA1 R2 设计（含总控 §11 六项裁决 + J9 裁决）与 SA2 R2 (pass) 的落地；红灯契约 5 文件 72 测试 + R2 补充测试。

## 交付（全部在 ALLOW LIST 内）

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/frame.ts` | 新建 | NDCL v1 25B frame codec（encode/decode/frameCrcOf；CRC 输入域 = header 前 21B + payload） |
| `src/paths.ts` | 新建 | 路径安全文法（namespaceId 安全文法 / streamId P_STREAM_ID / segment P_SEGMENT）+ 布局派生 |
| `src/storage-gate.ts` | 新建 | `validateInlineCarrier` + `validateSidecarFrame`（§7.4 15 步短路链；writer 注入门与 reader 共用） |
| `src/adapters/file.ts` | 新建 | 构造状态机 + 构造级 crash 包络 + append 管线（fresh-stat offset、exhausted 门闩）+ genesis + FILE_INTERNAL 接缝 |
| `src/reader.ts` | 新建 | `readStreamStrict`（manifest 14 键严格门 + 身份互核 + per-segment 帧状态机 + fs 包络 + 全函数兜底） |
| `src/index.ts` | 修改（只增） | `createFileDiagnosticLog` / `readStreamStrict` 及类型导出 |
| `src/testing.ts` | 修改（只增） | `injectFinalRecordFile` + `createFileDiagnosticLogPresetSequence`（**R2-1**：P_DECIMAL ∧ BigInt < UINT64_MAX，违规 loud throw） |
| `src/health.ts` | 修改（只增） | `DiagnosticLogHealthEvent` +4 成员（SA6 三成员 + `stream-exhausted`——J9 裁决） |
| `src/carrier.ts` | 修改（只增） | `decodeBase64Strict`（canonical 判定收口） |
| `AGENTS.md` | 修改 | Boundaries 段三行环境绑定面声明（§1.5） |
| `README.md` | 修改 | File adapter 配置/布局/best-effort 节 + genesis 缺失判别法 + 并发读写语义声明 |
| `test/helpers/file.ts` | 修（基础设施） | 补 `createFileDiagnosticLog` 值导入 + makeFileLog 的 Partial 装配 seam（**非断言修改**——SA6 红线日志自身锚定了这两处 TypeCheckError；无此修复 helper 无法编译） |
| `test/file-adapter-r2-supplemental.test.ts` | 新建 | R2 补充测试 15 条（设计 §9 R2 映射；独立文件，未动 SA6 断言） |

DENY LIST 零触碰（schema.ts/memory.ts/pipeline.ts 等冻结面只 import 不改）；零新增依赖（node:fs/node:path 内置）。

## 实现期强制项与备注

- **R2-1** ✅：`createFileDiagnosticLogPresetSequence(config, X)`：`X` 须匹配 P_DECIMAL 且 `BigInt(X) < BigInt(UINT64_MAX)`，违规 throw（`'18446744073709551615'`/`'18446744073709551616'`/`'01'`/`'abc'` 均拒；`'0'` 合法——后续 allocate 产出 '1'）。
- **备注 1** ✅：`appendFinal`（inject 接缝）显式顶层 try/catch → `pipeline-crashed{stage:'adapter'}`（getter 陷阱注入测试锚定）。
- **备注 2** ✅：R2 补充测试以独立新文件落地（非改 SA6 断言）。

## 实现期裁决（未决事项——需总控/SA6 复核）

### 1. 一处 SA6 契约断言自相矛盾（绿灯不可达；SA3 未改测试）

`test/file-adapter-genesis-results.test.ts:90`（「committed+update 与 fatal+true+update 两载体分支」）：

```ts
for (const [idx, bytes] of [[0, a], [1, b]] as const) {
  const result = records[idx]!.result as { ... }
  expect(result.kind).toBe('committed')   // ← 对 idx=1（fatal 记录）不可满足
  if (idx === 1) expect(result.committed).toBe(true)   // ← 要求 idx=1 是 fatal+committed:true
}
```

证据（三条独立）：
1. 同文件 line 67（同 suite 上一测试）断言 fatal+committed:true+unknown 落盘为 `{ kind: 'fatal', ... }`；
2. #148 冻结契约 `record-vocabulary.test.ts:148-155` 断言 fatal+committed:true+update 落盘为 `{ kind: 'fatal', committed: true, ... }`（且该测试为既有绿）——设计 §4.1 要求 file adapter 复用同一 result 形状；
3. schema 判别字面量为 `'fatal'`——写 `kind:'committed'` 即破坏 VFSL 封闭对象（writer 门会拒，测试将改为 TypeError 而非断言失败）。

即：**records[0]=committed、records[1]=fatal 为唯一合法实现**，line 90 对 idx=1 失败。SA3 按「不改断言逻辑」红线未动测试；**建议 SA6 将 line 90 改为 `expect(result.kind).toBe(idx === 1 ? 'fatal' : 'committed')`（一行）**。当前 suite 状态：`251 passed | 1 failed`（唯一红即此条；其余 72 条 SA6 + 15 条 R2 补充全绿）。

### 2. VFSL Pattern 引擎「非锚定前缀匹配」语义的 reader 侧补齐（实现面，非测试面）

实证（2026-08-28 运行时核验）：`validateLogicalSnapshot` 对 `sequence:'01'` 返回 ok——vfsl Pattern 引擎的 match 语义为「非锚定搜索 + 前缀匹配」（`packages/vfsl/src/pattern.ts` 头注），`^(0|[1-9][0-9]*)$` 对 '01' 返回 true。设计 §7.1 B 的落点（「P_DECIMAL 拒 '01'」→ vfsl-invalid）由 reader 以冻结常量 `P_DECIMAL` 的 JS 正则镜像在 VFSL 门同层复核实现（`src/reader.ts` RE_P_DECIMAL 注记；零新码、零测试改动、单源纪律保持）。SA6 前导零红灯由此转绿。

### 3. test/helpers/file.ts 基础设施修复（SA6 owned 文件的非断言最小修复）

SA6 红线日志（`.mabf-bg/sa6-red.log`）自身锚定了两处 TypeCheckError：`Cannot find name 'createFileDiagnosticLog'`（helper 缺值导入）与 makeFileLog 的 Partial 装配类型错误（随导出面出现而显现）。两处均为 fixture 基础设施（导入与类型 seam），非断言逻辑；修后 helper 编译、运行时行为不变。按设计 §12「SA3 仅可改测试基础设施（hook/fixture 隔离），不得改断言逻辑」执行。

## 验证证据（2026-08-28 于本 worktree）

```bash
$ npx tsc -p packages/namespace-diagnostic-log/tsconfig.json   # 0 errors
$ npx vitest run packages/namespace-diagnostic-log/test/file-adapter-* 
  # 72 passed | 1 failed（即上文裁决 1 的自相矛盾断言）；Type Errors: no errors
$ npx vitest run packages/namespace-diagnostic-log/test/file-adapter-r2-supplemental.test.ts  # 15 passed
$ npx vitest run   # 全仓 1656 passed | 1 failed（同上）；Type Errors: no errors
# 红灯基线：72 failed | 1 passed（.mabf-bg/sa6-red.log 锚定）→ 实现后 72/73 转绿（1 条契约缺陷除外）
```
