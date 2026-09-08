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

---

# R 修复轮（2026-08-28；SA4 R1 verdict=reject 的全部回流项 R-1/R-2/R-3 落地）

**被审对象**：commit `56ed694`（+ 总控勘误 `0ec62e9`——genesis-results.test.ts:90 自相矛盾断言按总控勘误修正为本报告裁决 1 建议的一行；SA4 §1.1 逐字确认）。
**验收基线**（SA4 独立复跑）：包套件 252 passed，全仓 136 文件 1657 passed，exit 0。

## 修复清单

| # | 严重度 | 修复 | 位置 |
|---|---|---|---|
| R-1 | REJECT | reader 的 P_DECIMAL 镜像扩展到 sidecar `frameOffset` 消费面：`checkSidecar` 入口先 `isCanonicalDecimal(carrier.frameOffset)` 复核（前导零/空串/非十进制字面 → record 级 `vfsl-invalid`，与 sequence 补齐同层同码；**先镜像后解析**——不依赖 Node 20/24 `BigInt('')` 行为分歧） | `src/reader.ts`（checkSidecar 入口）+ `src/storage-gate.ts`（新增共享 `isCanonicalDecimal`——sequence/frameOffset/preset seam 三处收口，消除第三份重复；SA4 建议采纳） |
| R-2 | MINOR | writer 注入门（writeRecord 的 VFSL 门旁）镜像复核注入 record 的 sequence 与 sidecar frameOffset 字面：违规 → `storage-validation-failed{recordKind, code:'vfsl-invalid'}` + 零落盘（与既有四类注入拒绝同构；code 值说明见下） | `src/adapters/file.ts`（writeRecord，VFSL 门后、storage 门前） |
| R-3 | MINOR | `decodeBase64Strict` 的 P_BASE64 字面量重打 → import `schema-patterns.ts` 冻结常量构 `RE_P_BASE64`（单源纪律；原第二枚正则逐字符相同，行为无差；原第一枚快速前置检查由 P_BASE64 镜像整体覆盖——已验证等价） | `src/carrier.ts` |

**code 值说明（SA4 要求的落点说明）**：R-2 的 P_DECIMAL 字面违规归属「schema Pattern 层」——与 reader 侧同违规的 issue 码 `vfsl-invalid` 同名复用（`storage-validation-failed.code` 类型为 `string`，且首 5 值的扩值先例 G3 即按「复用 reader issue 词表既有稳定码」原则批准 `frame-missing`——本修复同一原则，零新码）；事件类别按 SA4 明确指令取 `storage-validation-failed`（与既有四类注入拒绝同构）。emission 路径的 sequence/frameOffset 恒规范（allocate / String(offset)），该镜像仅在 testing 注入接缝可达。

## 新增锚定测试（追加至 `test/file-adapter-r2-supplemental.test.ts`，+4 条）

- R-1a：伪造流 `frameOffset:"0125"`（前帧 '0' 规范引用）→ **status corrupt** + records[1] 级 `vfsl-invalid`（修复前 PoC A：status ok）；
- R-1b：伪造流 `frameOffset:""` → **corrupt** + record 级 `vfsl-invalid`、不抛（修复前 PoC B：status ok / Node 24；Node 20 预期 reader 兜底 wipe——两种缺陷形态均已消除）；
- R-2a：`injectFinalRecordFile` 注入 `sequence:"01"` → 恰一次 `storage-validation-failed{code:'vfsl-invalid'}` + 零落盘（修复前 PoC C：无事件、违规 record 落盘）；
- R-2b：注入 sidecar `frameOffset:"01"` → 同上 + 零落盘。

## 上游根因备注（非本票修复面）

SA4 实证根因 = `packages/vfsl/src/pattern.ts` alternation codegen 的 `jmp` 目标缺陷（`'a|b'` 接受 `'ab'`、空匹配）——`packages/vfsl/**` 在本票 DENY LIST，**本修复轮未触碰**；总控备案另立上游票。上游修复后本包 4 处镜像（reader sequence / reader frameOffset / writer 注入门 / preset 接缝）可整体退役（仍保留为消费者侧防线）。

## 修复后验证（2026-08-28 于本 worktree）

```bash
$ npx tsc -p packages/namespace-diagnostic-log/tsconfig.json   # 0 errors
$ npx vitest run --typecheck packages/namespace-diagnostic-log  # 全部通过（含 +4 条 R 修复轮锚定）；Type Errors: no errors
```

---

# 终审回流修复轮（2026-08-28；双轴终审（standards/spec review）pass-with-issues 的闭合清单；总控 G13 裁决必修 + 锚定补全 + 文档同步）

## 代码修复（G13 裁决必修）

- **spec F-1（genesis exhausted 门闩缺失）**：`src/adapters/file.ts` `runGenesis` 补上与 attempt 路径同一门闩语义——genesis 的 `allocate()` 产出 `UINT64_MAX` 即置 `exhaustedLatch` + 恰一次 `notify({type:'stream-exhausted'})`（置于守卫检查之前——J9「分配完成即触发，无论该 record 后续守卫/门/落盘成败」）；该 genesis record 照常走门与落盘，此后 append/注入静默丢弃。修复前：预置 max−1 + genesis 时门闩不置，下一条 emit 会 `nextDecimal(UINT64_MAX)` = '18446744073709551616'（超域）并落盘。

## 测试锚定补全（+3 条；追加至 `test/file-adapter-r2-supplemental.test.ts`）

- **F-1/G13**：预置 UINT64_MAX−1 + genesis（32B inline）→ genesis 落盘 sequence=UINT64_MAX + 恰一次 `stream-exhausted` + 后续 emit 丢弃零落盘（唯一 record 仍是 genesis——p 上无超域 sequence）→ reader 对 genesis ok；
- **N-3**：`lineBudgetBytes:512` + `inputPolicy:'full'` + 4 KiB snapshot → `input-degraded{fromPolicy:'full'}` 恰一次 + 落盘 record 携带 `input:{capture:'digest', degraded:'projected-input-too-large', digest:64hex}` + reader ok（file adapter 的 line 预算降级分支锚定）；
- **N-4**：敌意 `namespaceId ('../evil')` / `streamId ('not-a-stream-id')` 入参 + **不存在的 rootDir** → corrupt + `locator-invalid` + manifest null + records []（rootDir 不存在即证伪「fs 先行」——若 fs 先行码会是 manifest-invalid；零 fs 触达）。

## 文档/声明同步（一行级 × 4）

- **N-1/F-2（node:path 声明勘误）**：`src/paths.ts` 头注（纯 TS → 唯一环境依赖 node:path `join`、零 node:fs）、包 `AGENTS.md` 环境绑定面（node:fs 限 file/reader；node:path 列 file/reader/paths 三模块、标注终审 N-1 勘误）、设计 §1.5 表（新增 paths.ts 行 + R3 勘误标注——R2 的「其余新模块零环境绑定」误列，更正为「其余新模块（frame/storage-gate）零环境绑定」）；
- **N-2**：`AGENTS.md` 事件低基数百名单补 `code` 字段（storage-validation-failed / storage-write-failed 的固定词表或稳定 errno；与 #152 新事件成员形状一致）；
- **N-5**：`file.ts:58` 注释「毫秒级守卫」笔误 → 「守卫取 min(配置值, 0xFFFFFFFF)」；
- **N-6**：任务简报 `wiki/raw/task_diagnostic-log-file-adapter.md` :49 死引用（`task_diagnostic-log-file-adapter_sa6_red.md` 不在树）→ 改为指向简报自身 SA6 锚定节（N-6 勘误标注）；
- **N-7**：`test/helpers/file.ts` 删除与 `base.ts:96` 逐字重复的 `eventsOfType` 本地实现 → `export { eventsOfType } from './base.js'`（file.ts 已单向 import base.ts，无循环）。

## 验证（2026-08-28 于本 worktree）

```bash
$ npx tsc -p packages/namespace-diagnostic-log/tsconfig.json   # 0 errors
$ npx vitest run --typecheck packages/namespace-diagnostic-log  # 全部通过（+3 条终审锚定）；Type Errors: no errors
```

## 备注

- 本修复轮未触碰 DENY LIST；`packages/vfsl/**` 上游 alternation 缺陷仍归另立上游票。
- 终审遗留 N-2（frameOffset 镜像折入原语）按交付说明归 #153 建议，本票不做。
