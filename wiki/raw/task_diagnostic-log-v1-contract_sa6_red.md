# SA6 红灯契约测试报告 — issue #148 `@nomicore/namespace-diagnostic-log`

- worktree: `/home/wangjian/nomicore-fix-issue-148`
- branch: `fix/issue-148-on-docs-namespace-diagnostic-change-log`
- 阶段：SA6（红灯契约编写），测试先行——`src/**` 尚无实现，全部测试为红灯。
- 权威设计：`wiki/raw/task_diagnostic-log-v1-contract_design.md`（R2）；SA2 R2 复审（`task_diagnostic-log-v1-contract_sa2_review.md`）十项反馈全部落地为机器锚。

## 1. 交付物清单

### 1.1 包骨架（按 `packages/clock` 模板）

| 文件 | 说明 |
|---|---|
| `packages/namespace-diagnostic-log/package.json` | name `@nomicore/namespace-diagnostic-log`、0.1.0、private、type module；exports `.`→`./src/index.ts`、`./testing`→`./src/testing.ts`；deps 仅 `@nomicore/vfsl`（workspace:*）；devDeps @types/node ^20 / typescript ^5.9.3 / vitest ^3.2.4 |
| `packages/namespace-diagnostic-log/tsconfig.json` | extends `../../tsconfig.base.json`，include src+test（对齐 clock） |
| `pnpm-lock.yaml` | `pnpm install` 生成：仅新增 `packages/namespace-diagnostic-log` importer 段（+16 行，diff 已核：无其他改动）——设计 §12 R2/G-b1 ALLOW |

### 1.2 契约测试（11 个 `.test.ts` + 1 个 `.test-d.ts` + 2 个共享 helper）

| 文件 | 设计节 | 契约锚点摘要 |
|---|---|---|
| `test/record-vocabulary.test.ts` | §9.1 | AC1 + §2.1/§2.6/§4.2/§10-J2/J3：8 个 result 变体逐字段断言（含 rejected/fatal+false 无 update 键、dirty-notification 场景）；6 operation 矩阵；code↔sourceModule 成对；10 类 intake 违规 → emission-dropped；违规不消耗 sequence；standalone emitter→sink 语义 record 形状（无 streamId/sequence/recordKind、深冻结、updateBytes 为 Uint8Array）、sink.append 抛错不外抛 |
| `test/emitter-isolation.test.ts` | §9.2 | ADR 0011 §Interface + §2.6/§4.1/§4.2/§5.2/§5.4：敌意 getter（只触达一次探针）、非 JSON 值（bigint/symbol/function/undefined/NaN/Infinity）、稀疏数组 hole、超深嵌套 → unavailable + input-projection-failed，emit 不 throw；所有权契约（变异已移交快照/updateBytes → TypeError）；混排不抛 |
| `test/input-capture.test.ts` | §9.3 | AC2 + §5.1–§5.4：决策表 5 输入行 × 4 策略全格；JCS KAT（键序=UTF-16 code unit、1e+21/-0/1e-7/1e-6/333333333.33333329、转义/lone surrogate/astral，canonical 文本逐字断言 + 端到端 digest 一致）；SHA-256 标准向量（空串/abc）；lone surrogate digest 钉死（3ac71dce…）；redacted 算法（叶→«redacted»、null 保留、结构保形）+ 1M 节点护栏 → unavailable；-0 full 视图契约（内存 -0、digest 同基、round-trip 合法）；getter 只触达一次 |
| `test/issues-projection.test.ts` | §9.4 | AC3 + §6.1/§6.2/§2.3：message 4096/4097B、多字节骑界（3B/4B 字符不拆分）、1365 lone surrogate（8190B→截断且 ≤4096）；path 257 段、string 段 1025B、1001/1000 条；truncated/originalCount presence 语义；redacted/none 策略；畸形条目丢弃（originalCount 只计有效）；**R2/C-b1 段级 JSON-safe**（NaN/±Infinity/undefined/稀疏 hole → 整条丢弃 + enrichment-field-dropped/issues 恰一次；`-0` → 归一 +0）；**R2/E-c2** 逐单位 KAT（lone surrogate 6B、`\n`/`"` 2B、astral 4B…）；**R2/E-c1** truncateUtf8(12) loud throw + 生产常量 4096/1024/256 不触发 |
| `test/line-budget.test.ts` | §9.5 | ADR 0012 §投影 + §5.5：full/redacted 超预算 → digest+degraded（事件 fromPolicy、value 不在 record、digest 不变）；digest-only 仍超限 → 丢弃 + line-budget-exceeded（projectedRecordBytes>预算）并产生序列 gap（诚实信号）；update Base64 单独超限丢弃（§10-J9 锚）且非 update-omitted 伪装 |
| `test/vfsl-gate.test.ts` | §9.6 | AC4 + ADR 0012 §VFSL record schema + §3.4/§4.1 步骤 5/§8.1/§8.2：9 类手工违规 record（坏 streamId/词表外 operation/stage/rejected+update/多余顶层键/坏 Base64/坏 CRC/坏 ISO/digest 缺）→ 丢弃 + vfsl-validation-failed（issuePaths ≤10 条、`$.` 前缀、事件键集 ⊆ 低基数白名单、schemaId/指纹钉死）；sidecar carrier 正例通过（#152 前置验收）；genesis-baseline 正例；**R2/F-c1** 坏 envelope 注入 → 构造期恰一次 schema-compile-failed + 后续全丢弃 + 无逐条 record-dropped + 无串扰 |
| `test/memory-adapter.test.ts` | §9.7 | AC5 + ADR 0012 §Writer + §7.1/§7.2/§4.3：capacity=3 + 6 条 → 前 3 保序、drop newest、事件 queueDepth=capacity、stats 对账（accepted/droppedTotal/droppedByReason/droppedByOperationReason/lastSequenceAssigned='6'）；交错 operation 保序；records() 数组与 record 冻结；lastSequenceAssigned string\|null 语义；实例隔离 |
| `test/schema-freeze.test.ts` | §9.8 | §3.4 + §9.8：envelopeFingerprint 钉死 `sha256:v1:dedad2ab93d9df9224960ca094924168f8bcc1c0512dfdd0a03dc6e66613e070`（已用 `compileSchemaEnvelope` 对 §3.3 文本实测一致）；semanticFingerprint 形状锚；RECORD_SCHEMA_ENVELOPE 恰四键深冻结；§9.1 全 record 形状复跑 validateLogicalSnapshot（外部一致性）+ 孪生 helper 全变体 |
| `test/update-carrier.test.ts` | §9.9 | ADR 0012 §Binary frame v1 + §7.3/§7.4/§2.1：CRC32C KAT（"123456789"→e3069283）+ 增量向量（''/a/abc/hello world）；inline 字段逐字断言 + Base64 round-trip；**R2/D-c1** empty-update（0 字节 → update-omitted + 无 vfsl-validation-failed）与守卫优先级；update-capture-disabled/payload-too-large 保 attempt metadata |
| `test/identity.test.ts` | §9.10 | §4.3/§4.4 + **R2/A-c1**：确定性 RandomSource（streamId/attemptId 各 16B）；attemptId 透传；observedAtFrom（ISO 毫秒 + P_ISO_MS 匹配 + 超域 throw）；nextDecimal 进位直测（9→10、99→100、…51614→…51615、2^53 邻域无失真）；预置 lastSequence=…51614 → 一次 append 得 …51615（接纳）→ 再 append exhausted（丢弃 + stats 计数 + `droppedByReason['sequence-exhausted']` + 无逐条事件 + 不 throw） |
| `test/observer-isolation.test.ts` | §9.11 | §8.1/§8.3 + AC4/AC5：observer 每次 throw → emit 不 throw、record 照常入队、fallbackLog 收到 `DIAGNOSTIC_LOG_OBSERVER_FAILED observer_threw=` 稳定码行；多事件多行；fallbackLog 自身 throw → 仍不外抛（最后防线）；健康事件不入日志队列 |
| `test/identity.test-d.ts` | §9.10 | §10-J2 + **R2/F-c2**：`@ts-expect-error` 反向锚（fatal+committed:false 不得携带 effect——EmissionResult/AttemptResult/AttemptRecord 三处；rejected 不得携带 update；emitter.emit 拒绝带 base64 的 excess property）；`expectTypeOf` 正向锚（Emission/EmissionResult 全成员键并集 ∩ 物理键黑名单 {base64,segment,frameOffset,crc32c,payloadLength,storage,retention} = ∅；UpdateCarrier 合法拥有物理键——黑名单非空转；recordKind 判别字面量） |
| `test/helpers/base.ts` | §1.3/§12 | 共享夹具：baseEmission（fresh 对象）/makeLog（装配+事件收集）/OBSERVED_AT/ALL_OPERATIONS/FROZEN_ENVELOPE_FINGERPRINT/mustCompile |
| `test/helpers/twin.ts` | §9.8 | **R2/C-b1 JSON round-trip 孪生不变量通用 helper**：`validateLogicalSnapshot(derived, JSON.parse(JSON.stringify(record)))` 必 ok——全部 suite 复用 |

### 1.3 testing 子路径接缝（SA6 按设计 §1.3/§9 定义的测试面，SA3 按此实现）

- `createDeterministicRandomSource(bytes: Uint8Array): RandomSource`（循环供应，仅 streamId/attemptId 两用途）
- `createEventCollectingObserver(): Observer & { events: DiagnosticLogHealthEvent[] }`
- `injectFinalRecord(log, record): void`（直通 storage projection → VFSL 门 + 入队，§9.6）
- `createBoundedMemoryDiagnosticLogWithSchema(config, envelope): BoundedMemoryDiagnosticLog`（R2/F-c1）
- `createBoundedMemoryDiagnosticLogPresetSequence(config, lastSequence): BoundedMemoryDiagnosticLog`（R2/A-c1）
- `nextDecimal(s): string`、`jcs(value): string`、`sha256Hex(text): string`、`truncateUtf8(s, budget): string`、`jsonLiteralBytes(s): number`、`TRUNCATION_MARKER`

## 2. 红灯验证（证据）

命令（唯一）：`npx vitest run --typecheck packages/namespace-diagnostic-log`（后台进程，日志 `.mabf-bg/sa6-red.log`，退出码 `.mabf-bg/sa6-red.exit`）。

- **exit code：1**（红灯 ✅）
- 失败原因定性：**src 模块缺失/未实现**——全部 12 个测试文件失败的唯一根因是 `Cannot find module '../src/index.js'` / `'../src/testing.js'`（26 errors，均为 TS2307 模块缺失及其下游衍生：`Cannot find name 'AttemptResult'`、`Unused '@ts-expect-error'`（导入类型不可解析退化为 any）、`implicitly has an 'any' type`）；**无任何测试文件自身语法错误**（独立 `tsc --noEmit` 语法预检仅见 TS2307 及其衍生）。
- 基线对照：`.mabf-bg/baseline-test.log`（本次改动前）118 文件 / 1405 测试全绿、Type Errors no errors——红灯为本次新增契约测试特有。
- 输出尾部（摘录）：

```text
❯  TS  packages/namespace-diagnostic-log/test/identity.test-d.ts (9 tests | 4 failed)
   × …EmissionResult：fatal+committed:false 不得携带 effect（编译期拒绝）→ Unused '@ts-expect-error' directive.
   × …AttemptResult：rejected 与 fatal+committed:false 均无 update/effect 位 → Cannot find name 'AttemptResult'.
…

FAIL  packages/namespace-diagnostic-log/test/emitter-isolation.test.ts …
Error: Cannot find module '../src/index.js' imported from '…/test/helpers/base.ts' (lines 24-81, 11/11 suites 同因)
FAIL  packages/namespace-diagnostic-log/test/input-capture.test.ts …
Error: Cannot find module '../src/testing.js' imported from '…/test/input-capture.test.ts'
…
TypeCheckError: Cannot find module '../src/testing.js' or its corresponding type declarations.
 ❯ packages/namespace-diagnostic-log/test/vfsl-gate.test.ts:18:8
…

 Test Files  12 failed (12)
      Tests  4 failed | 5 passed (9)
Type Errors  4 failed
     Errors  26 errors
   Duration  3.66s
```

- 复现命令（SA3 修绿后应为 0 退出）：`npx vitest run --typecheck packages/namespace-diagnostic-log`（全仓 `pnpm test` 同口径）。

## 3. 已知假设与实现期澄清需求

1. **指纹常量已实测确认**：§3.3 冻结文本（**含尾随 `\n`**）+ `{lang:'vfsl',version:1,id:'nomicore.namespace-diagnostic-change-record@1'}` 经仓内 `compileSchemaEnvelope` 实测 `envelopeFingerprint = sha256:v1:dedad2ab93d9df9224960ca094924168f8bcc1c0512dfdd0a03dc6e66613e070`——SA3 必须让 `RECORD_SCHEMA_TEXT` 的字节序列恰为设计 §3.3 围栏内文本 + 尾随换行（即 "……ROOT = …;\n"），否则指纹漂移、本测试转红（有意行为：指纹变更 = schema 版本变更）。
2. **P_BASE64 空串行为与设计 §D-c1 论证不一致（实测发现，提请总控/SA3 知悉）**：仓内 pattern 引擎的 `{n}` 编译为「split 直达 after」语义（`(?:[A-Za-z0-9+/]{4})*` 尾组被判定为可跳过）——`matchPattern(P_BASE64, '')` 实测返回 **true**，`validateLogicalSnapshot` 接受 `base64:''` 的 inline carrier（已实测）。设计 §D-c1 的「空串不匹配」前提不成立；**但 empty-update 前置守卫本身仍按设计冻结**（0 字节 → update-omitted/empty-update，绝不落 inline 空 Base64），§9.9 红灯语义不受影响。坏 Base64 案例改用「5 字符无 padding」（实测被拒）。
3. **`fallbackLog` 配置键**：§8.3 明文「config `fallbackLog?: (line: string) => void`」，但 §1.4 配置清单未列；以 §8.3 为准（SA6 已在 observer-isolation 测试中使用该键）。
4. **stats reason 键命名**：failed 模式与 exhausted 模式的计数键取 `droppedByReason['schema-compile-failed']` / `droppedByReason['sequence-exhausted']`（SA2 R2.3-n3 建议口径）；测试对 failed 模式只断言 droppedTotal（不钉键名），对 exhausted 钉 `sequence-exhausted`。
5. **code↔sourceModule 非成对输入的处理**：设计 §10-J3 只冻结「成对出现」不变量、未指明单侧缺失时保留哪边；SA6 只断言「成对时两边保留」与「record 中不出现未成对 code」路径的化取值（记录接受 + code 不出现在 record——实现可选丢 code 或丢 sourceModule，SA6 断言不变量本身）。
6. **vfsl-validation-failed 事件的 operation 字段**：对「词表外 operation」的注入记录，事件 operation 取何值设计未指明；SA6 只断言事件存在、issuePaths、白名单键集，不断言该字段值。
7. **`getRecordSchemaCompilation()` 引用恒等**：§3.4「模块级单次缓存」→ 断言两次调用同引用；若 SA3 选择每次重建冻结副本，请总控裁决（SA6 按单实例缓存解读）。
8. **RECORD_SCHEMA_ENVELOPE 深冻结**：§3.1/§1.3 明文深冻结；已断言 `Object.isFrozen`。
9. **SA6 未改任何 src/production 文件**：`git status` 仅含新包骨架 + 测试 + wiki + lockfile importer 段。
10. **root `package.json` typecheck 追加一行不属 SA6**（归 SA3/总控另行处理；vitest `--typecheck` 经 `tsconfig.typecheck.json` 的 `packages/*` 通配已覆盖本包，不影响红灯落地）。

## 4. 与 SA2 R2 的逐项对应（机器锚齐全性核对）

| SA2 R2 机器锚 | 落点 |
|---|---|
| C-b1 段级 JSON-safe | issues-projection（NaN/±Infinity/undefined/稀疏/-0）+ emitter-isolation（快照 hole）|
| D-c1 empty-update | update-carrier（双断言：保 metadata + 无 vfsl-validation-failed）|
| A-c1 sequence 纪律 | identity（nextDecimal 直测 + 预置邻域 + exhausted 抑制 + lastSequenceAssigned 类型）|
| E-c1 小预算 loud | issues-projection（truncateUtf8(12) throw + 生产常量 ≥13B）|
| E-c2 预算基准 | issues-projection（逐单位 KAT + 1365 lone surrogate 向量）|
| F-c1 failed 模式 | vfsl-gate（坏 envelope 注入四断言）|
| F-c2 物理键黑名单 | identity.test-d.ts（emission/EmissionResult 双锚 + 非空转正例）|
| G-b1 lockfile | §1.1（importer 段 16 行，diff 已核）|
| A-c2 reason 词表 | update-carrier（三 reason 全断言）|
| C-b1 round-trip 通用 helper | helpers/twin.ts（all suites 复用）|

## 5. R3 修订节（总控 R3 裁决 · 3 处测试断言缺陷修正）

裁决背景：SA3 绿灯验证发现 3 条遗留红灯，总控 R3 定为**测试断言缺陷**（SA3 分析成立；
`Object.freeze(Uint8Array)` 必抛 TypeError 已经 node 实测确认）。SA6 侧仅修自己的测试文件，
SA3 同步实现侧 2 项小改（intake 复制 + testing.ts 导出 `crc32cHex`）。

| # | 文件 | 原断言（缺陷） | R3 修订后断言 | 依据 |
|---|---|---|---|---|
| 1 | `test/emitter-isolation.test.ts` | 「变异已移交 updateBytes：抛 TypeError」——`Object.freeze(Uint8Array)` 必抛，冻结语义对 typed array 不成立 | 复制隔离断言：emit 后变异原 `updateBytes` → 已接纳 record 的 inline base64 解码仍等于**原始**字节（'123456789'），record 仍为 effect:'update' | 设计 §2.6 R3 修订为「intake 复制隔离」；ADR 0011 §Interface 允许「已转移**或已复制**」。plain-data snapshot 的冻结断言（full 策略变异抛 TypeError）保持不变 |
| 2 | `test/line-budget.test.ts` | redacted 降级用例 `{data:'x'×2000}`——redacted 投影收缩叶值后仅 ~441B，**永远不可能超预算** | 键重型输入：2000 键对象（`key0..key1999`，键在 redacted 下保留）→ redacted 投影后仍远超 `lineBudgetBytes:1000` → 断言降级 digest+degraded + `input-degraded{fromPolicy:'redacted'}` 事件 + record 被接纳（无 record-dropped） | 设计 §5.3 redacted 算法（结构保形、叶值收缩、键名保留）+ §5.5 降级顺序 |
| 3 | `test/update-carrier.test.ts` | 增量向量含 `'' → 00000000`——0 字节 + updateCapture:true 与同文件 R2/D-c1 empty-update 断言**互斥**（不可能既 inline 又 omitted） | 空输入 KAT 改为直测：从 `../src/testing.js` 导入 `crc32cHex`（SA3 正在补该导出）断言 `crc32cHex(new Uint8Array(0)) === '00000000'`；emit 路径增量向量仅保留非空（'a'/'abc'/'hello world'）；0 字节 emit 路径断言保持 update-omitted/empty-update 不变 | 设计 §7.4 守卫（empty-update 最前）+ §9.9 双断言 |

验证状态：SA6 已按总控指令**不跑全量**，等总控统一绿灯验证（`npx vitest run --typecheck packages/namespace-diagnostic-log` 预期 0 退出）。

## 6. R4 修订节（总控 R4 勘误批 · 4 项测试对齐，配合 SA3 实现）

背景：SA3 实现与设计 §8.1（健康事件判别联合）、§2.4（records() 为 `readonly DiagnosticChangeRecord[]` 两族联合）、§6.2（畸形丢弃与 truncated/originalCount 同现同缺）及 marker 字节数勘误（13B → 14B）对齐。SA6 侧仅改 test/**。

| # | 文件 | 修订内容 | 依据 |
|---|---|---|---|
| C-1 | `test/helpers/base.ts` + 全部 `.test.ts` | 新增类型守卫 `eventsOfType<T>(events, type): Extract<DiagnosticLogHealthEvent, {type:T}>[]`；全部 15 处 `filter(e=>e.type===…)` 后访问成员字段的断言点改经该 helper 窄化（record-dropped / vfsl-validation-failed 的 operation R4 后为可选：line-budget 的 drop 事件 operation 有值仍断言 'root-mutation'；vfsl-gate 坏 operation 注入用例不断言该字段） | 设计 §8.1 判别联合；R4 operation 可选化 |
| C-2 | `test/helpers/base.ts` + 全部 `.test.ts` | 新增 `assertAttempt(record)`（expect recordKind==='attempt' + 类型收窄）与 `attemptRecords(records)`（filter+谓词）；69 处 attempt 字段访问（.result/.operation/.stage/.input/.attemptId）前先断属；genesis-baseline 区域（vfsl-gate 160 行 recordKind 判别访问）保持公共键访问 | 设计 §2.4 两族联合 |
| C-3 | `test/issues-projection.test.ts` | 畸形条目丢弃三用例（缺 message / path 非数组；NaN/±Infinity 段级；undefined 段）断言从「originalCount===1」改为「`truncated===true` 且 `originalCount===1` **同现**」；无截断/无丢弃的 presence 用例（恰 1000 条、正常单条）保持两键同缺 | 设计 §6.2 R4：两键同现同缺 |
| C-4 | `test/issues-projection.test.ts` | `jsonLiteralBytes(TRUNCATION_MARKER)` KAT 13 → **14**；依赖 marker 预留的预算算术同步 14B 基准：多字节骑界用例 4083→4082（`'a'.repeat(4082)+MARKER`，总 4096）、string 段注释 1011→1010、code 截断注释 243→242、小预算注释 13B→14B（budget=12 仍 throw：12 < 14） | R4/C-4 marker 勘误（SA3 实现按 14B） |

验证状态：SA6 已按总控指令**不跑全量**（SA3 src 已同步落地，SA6 仅做了 `tsc --noEmit` 轻量预检：无测试文件语法错误）；绿灯验证由总控统一执行（`npx vitest run --typecheck packages/namespace-diagnostic-log` 预期 0 退出）。

## 7. R5 修订节（总控 R5 双轴终审勘误批 · 7 项测试对齐，配合 SA3 实现修复）

背景：R4 之后 SA3 实现继续对齐（判别联合构造点、plainness 守卫、intake 形状校验、redacted path 预算、issues 数组形状、source 封闭键）。SA6 侧仅改 test/**，追加以下修订与新用例：

| # | 文件 | 修订内容 |
|---|---|---|
| R5/C-3 | `test/issues-projection.test.ts` | **presence 回摆**：R4 改过的三处畸形丢弃用例（缺 message/path 非数组；NaN/±Infinity 段级；undefined 段）断言再次回摆为「`truncated` 与 `originalCount` **两键均缺席**」（`'truncated' in proj === false` + `'originalCount' in proj === false`）；enrichment-field-dropped/issues 事件断言保留。预算截断用例（1001 条、4097B message、C-S1）保持两键同现断言不变。依据：R5 再裁决 presence 严格 ⇔ 预算截断（与冻结 schema JSDoc 逐字一致），畸形丢弃只经事件上报 |
| std C-2 | `test/input-capture.test.ts` | 新 describe：`emission.input` 为 primitive（42 / 'x' / true，`it.each` 逐值）→ emission-dropped 事件 + 不 throw + **无 pipeline-crashed 事件** + sequence 不消耗（后续合法 emission 仍 sequence '1'） |
| std C-3 | `test/input-capture.test.ts` | 新 describe：快照含非 plain 对象（Date / Map / Uint8Array 嵌套在普通对象里，逐类）→ capture:'unavailable' + input-projection-failed 事件；full 策略下同守卫（不得嵌入 typed array）；plainness 判定后不重读（同一属性 getter 只触达一次探针） |
| spec C-S1 | `test/issues-projection.test.ts` | 新用例：redacted 策略下 path 301 段（首段 1025B string）→ 截断到 256 段 + string 段 ≤1024B + message 仍为 «redacted» + truncated/originalCount 同现 |
| spec C-S2 | `test/issues-projection.test.ts` | 新 describe：emission.issues 按设计 §2.6 传 **DiagnosticIssue[] 裸数组** → record.issues.items 逐条对应、保序、policy 自标、无截断无丢弃两键缺席（防「数组被静默丢弃」回归）。**既有全部 emission 内 `issues: { items: [...] }` 传法同步改为裸数组**（issues-projection 全部 project() 调用、line-budget 两处、record-vocabulary standalone emitter 一处） |
| spec C-S3 | `test/record-vocabulary.test.ts` | violations 表增两行：source 带多余键（`{kind:'local', extra:1}` / `{kind:'replication', direction:'hub-to-peer', remoteInstanceId:'r1', junk:1}`）→ emission-dropped；it.each 增补「**无 vfsl-validation-failed 事件**」断言（结构违规只走 intake，绝不产生 writer-bug 信号） |
| nano | `test/line-budget.test.ts` / `test/memory-adapter.test.ts` | 注释错字「红action」→「redacted」；删除 `assertAttempt(r as DiagnosticChangeRecord)` 冗余 cast（r 已是记录联合元素） |

验证状态：SA6 已按总控指令**不跑全量**；仅做 `tsc --noEmit` 轻量预检（无语法错误，且修复了 C-S1 插入位置造成的 describe 闭合问题——已验）。绿灯验证由总控统一执行（`npx vitest run --typecheck packages/namespace-diagnostic-log` 预期 0 退出）。
