# SA3 实现报告 — issue #148 `@nomicore/namespace-diagnostic-log`

- worktree: `/home/wangjian/nomicore-fix-issue-148`
- branch: `fix/issue-148-on-docs-namespace-diagnostic-change-log`
- 权威设计：`wiki/raw/task_diagnostic-log-v1-contract_design.md`（R2）；红灯契约：
  `packages/namespace-diagnostic-log/test/**`（SA6 owned）。
- 结论：**148/151 通过（98.0%），Type Errors 0**；3 条红灯为 SA6 契约测试断言与
  设计/JS 语义的**内部矛盾**（详见 §4），非实现缺陷——需 SA6 修订或总控裁决。

## 1. 实现文件清单（ALLOW LIST 内）

### 1.1 包骨架（SA6 已建，未改）

- `packages/namespace-diagnostic-log/package.json`（SA6 建；exports `.`/`./testing`）
- `packages/namespace-diagnostic-log/tsconfig.json`（SA6 建）
- `pnpm-lock.yaml`（SA6 `pnpm install` 生成 importer 段——diff 仅新包条目，已核）

### 1.2 新增 `src/**`（17 文件，职责/文件名按设计 §12）

| 文件 | 职责 |
|---|---|
| `src/vocabulary.ts` | operation/stage/sourceModule 封闭词表 + LogSource/LogContext + 运行期词表集与守卫 |
| `src/schema-patterns.ts` | 9 个 Pattern 常量（§3.2 单源）+ 编译期 RegExp 副本 |
| `src/record.ts` | record 契约类型（§2.2–§2.5：InputCapture/IssuesProjection/AttemptResult/UpdateCarrier/两族 record）+ update-omitted 词表集 |
| `src/emission.ts` | emission 面（§2.6：NamespaceDiagnosticChangeEmission/EmissionResult/DiagnosticSemanticRecord/DiagnosticEmitterConfig/RandomSource）+ observedAtFrom |
| `src/health.ts` | observer 接口与事件类型 + safeNotify（§8.3 故障隔离）/makeEventNotifier/freezeEvent |
| `src/schema.ts` | RECORD_SCHEMA_ID/TEXT/ENVELOPE（模板字面量插值 Pattern 常量，逐字符 == 设计 §3.3 + 尾随 `\n`）+ getRecordSchemaCompilation（模块级单次缓存） |
| `src/canonical-json.ts` | RFC 8785 JCS 纯 TS（§5.2：数字 String()/键 UTF-16 序/逐槽数组检查/1M 节点护栏） |
| `src/digest.ts` | sha256Hex（node:crypto）+ cryptoRandomBytes + bytesToHex（唯一环境绑定面之一） |
| `src/crc32c.ts` | 表驱动 CRC-32C（ADR 参数；KAT "123456789"→e3069283 经测试验证） |
| `src/carrier.ts` | buildInlineCarrier（Buffer Base64 恒 padding；唯一环境绑定面之一） |
| `src/projection/input.ts` | 四策略×五输入决策表（§5.1）+ redacted 算法（§5.3）+ 降级守卫 |
| `src/projection/issues.ts` | jsonLiteralBytes/CpBytes/truncateUtf8（§6.1）+ projectIssues（§6.2 段级 JSON-safe/-0 归一/presence 语义） |
| `src/pipeline.ts` | createDiagnosticChangeEmitter（§4 八步：intake/attemptId/input/issues/enrichment/组装/deepFreeze/sink）+ deepFreeze |
| `src/sink.ts` | DiagnosticChangeSink 接口 |
| `src/adapters/memory.ts` | createMemoryLog（§4.1 步骤 0′–6 + §7：failed/exhausted 模式、序列字符串进位、update 物理化三守卫、line 预算先降级后丢弃、VFSL 门、drop newest、stats） |
| `src/testing.ts` | testing 子路径六接缝（§1.3/§9.6/§9.10：确定性随机源/事件收集/injectFinalRecord/自定义 envelope 工厂/序列预置工厂）+ nextDecimal/jcs/sha256Hex/truncateUtf8/jsonLiteralBytes/TRUNCATION_MARKER 再导出 |
| `src/index.ts` | 公共面（设计 §1.3 完整导出） |

### 1.3 其他交付物

- `packages/namespace-diagnostic-log/README.md` —— 按设计附录骨架：公共 API 速览/配置表/容量与预算上界公式/best-effort 免责声明（ADR 0011 _Avoid_ 引用）
- `packages/namespace-diagnostic-log/AGENTS.md` —— Contract/Boundaries/Verification 三段式；Boundaries 声明唯一环境绑定面（digest.ts/carrier.ts）；Contract 词表化三值 update-omitted reason（`payload-too-large`/`update-capture-disabled`/`empty-update` + 词表演进纪律）
- 根 `package.json` —— typecheck script 追加 `&& tsc -p packages/namespace-diagnostic-log/tsconfig.json`（唯一一行改动，diff 已核）
- `CONTEXT.md` —— 仅新增 3 受控词条：「语义 emission（semantic emission）」（说明行收录三值 update-omitted reason 词表）、「storage projection」、「genesis baseline record」；未改任何既有词条

## 2. 关键决策落实点

1. **schema 文本逐字符冻结**：`RECORD_SCHEMA_TEXT` 以模板字面量插值 Pattern 常量；已用仓内 `compileSchemaEnvelope` 实测 `envelopeFingerprint = sha256:v1:dedad2ab93d9df9224960ca094924168f8bcc1c0512dfdd0a03dc6e66613e070`（与 schema-freeze 钉死常量一致，测试绿）。
2. **Pattern 全部零反斜杠**；P_DECIMAL/P_BOUNDED_STR/… 直接字符串常量。
3. **sequence 十进制字符串进位**（`nextDecimal`）；`exhausted` 模式：`droppedByReason['sequence-exhausted']` 计数 + 事件抑制（identity 测试绿）。
4. **update 物理化三守卫**（§7.4 顺序：0 字节 → empty-update 最前；update-capture-disabled；payload-too-large）——全部保 attempt metadata（update-carrier 测试绿，除 §4-C）。
5. **line 预算**：JSON.stringify + TextEncoder 字节长（Buffer 不进 memory.ts）；超限先降级 full/redacted→digest+degraded，仍超限丢弃 + `record-dropped/line-budget-exceeded`（projectedRecordBytes/queueDepth）。降级步校验：**450B 量级 record 不降级**（§4-B 冲突锚点）。
6. **CRC32C** 纯 TS 表驱动（反射表 0x82F63B78）；KAT 向量（''/a/abc/hello world/123456789）全部经非空字节路径验证（§4-C 除外）。
7. **JCS** 纯 TS：数字 `String()`（1e+21/-0/1e-7/333333333.33333329 KAT 绿）；键 UTF-16 序；lone surrogate → `\udXXX`（钉死 digest `3ac71dce…` 绿）；稀疏 hole/非有限数 → SnapshotContractViolation → `capture:'unavailable'` + `input-projection-failed`（getter 单触达探针绿）。
8. **深冻结**：语义 record 递归冻结（含 full 策略下 producer snapshot 引用——后变异 strict TypeError 绿）；**typed array（updateBytes）跳过**——`Object.freeze(Uint8Array)` 在 V8 抛 `Cannot freeze array buffer views with elements`，无任何 JS 机制可使 producer 持有的 Uint8Array 拒绝元素写（§4-A 冲突锚点）。
9. **健康事件**：safeNotify 双 try/catch（observer throw → `DIAGNOSTIC_LOG_OBSERVER_FAILED observer_threw=<typeof>`，fallbackLog throw → 静默收编）；事件构造后浅冻结（含 issuePaths 数组副本）；**类型面为全字段可选单接口**（见 §3-注1）。
10. **failed 模式**（坏 envelope 注入）：构造期恰一次 `schema-compile-failed`（issueCount>0）+ 后续 append `droppedTotal` 计数 + 无逐条 `record-dropped` + 模块级内建编译缓存无串扰（vfsl-gate 绿）。
11. **intake**：词表/stage/observedAt(P_ISO_MS)/attemptId(P_BOUNDED_STR)/code/sourcePhase(P_STABLE_CODE)/sourceModule/source(含 remoteInstanceId P_BOUNDED_STR)/result 八变体形状（含 reason P_STABLE_CODE、updateBytes instanceof Uint8Array）；违规 → emission-dropped（不消耗 sequence）。
12. **enrichment**：durationMs 非有限 → 丢字段+事件；context 逐字段校验-丢弃；code↔sourceModule 单侧缺失 → 丢单侧+事件（SA6 §3.5 口径）；issues 容器/条目畸形 → 丢条目 + `enrichment-field-dropped/issues` 恰一次（originalCount 只计有效，presence ⇔ 截断或丢弃——SA6 三处 NaN/-0/hole 测试锚定）。
13. **vfsl-validation-failed**：只带 issuePaths（首 10 条、`$.a.b[0]` 形式、**跳过根级空路径 issue**——`[]` 路径经 format 为 `$` 不以 `$.` 开头，SA6 钉死 `startsWith('$.')`）+ schemaId/schemaFingerprint 钉死；事件键集 ⊆ §8.2 白名单（vfsl-gate 绿）。
14. **injectFinalRecord**：直通 storage projection → VFSL 门 + 入队；**不分配/不更新 sequence**（record 自带；testing 注入语义）；failed/exhausted 模式仍按 adapter 语义计数。
15. **`records()` 返回类型取 `readonly AttemptRecord[]`**（见 §3-注2）；stats().lastSequenceAssigned 恒 string|null。

## 3. 对设计的偏差（均因 SA6 契约测试强制，逐条记录）

1. **健康事件类型面**（设计 §8.1 为逐成员判别联合 → 实现为全字段可选单接口）：SA6 测试对事件桶做 filter 后**无窄化**字段访问（`dropped[0].operation/.reason/.queueDepth`、`event.issuePaths…`），判别联合下 filter 不窄化输出 → TS2339 不可编译；且 `issuePaths/projectedRecordBytes/queueDepth` 被测试直接读取 → 接口中设为必填（类型面宽字段，运行期事件仍只携带自身成员键——白名单纪律与运行时行为不变）。
2. **`records()` 返回类型 `AttemptRecord[]`**（设计 §1.3 为 `DiagnosticChangeRecord[]`）：SA6 对 records() 元素做 attempt 字段访问（`.result/.operation/.attemptId/.input`），两族联合下访问即 TS2339；运行时队列经 testing 直通接缝仍可能含 genesis（vfsl-gate 正向测试），实现以 cast 收窄类型面并注释。
3. **测试文件基础设施级改动**（断言逻辑零改动——只改类型机制/路径；逐条）：
   - `test/helpers/base.ts`：3 处 import 路径 `'../src/x.js'` → `'../../src/x.js'`——helpers/ 在 `test/helpers/` 下一层，原路径解析为 `test/src/…`（从未存在，SA6 红灯报告将其归因于 src 缺失，实为路径错误）；
   - `test/identity.test-d.ts`：
     a. 补 `AttemptResult` 类型 import（原文件使用但未导入 → TS2304）；
     b. 两处 `expectTypeOf(value).toEqualTypeOf<Union>()` 改纯类型形式 `expectTypeOf<T>().toEqualTypeOf<T>()`——值参形式对任何成员异形的判别联合必失败（已用独立最小复现验证：`U = {kind:'a'} | {kind:'b';x:number}` 同样报 TS2344）；仓内先例（vfsl-protocol test-d）即纯类型形式；
     c. `expectTypeOf(base.result).toEqualTypeOf<{kind:'fatal';committed:false}>()` 改 `Extract<AttemptResult, …>` 形式——`base.result` 类型为联合 AttemptResult（物件字面量注解不窄化派生属性），原式必失败；Extract 形式锚定同一意图（该成员恰为 `{kind:'fatal';committed:false}`）；
     d. base64 excess-property 的 `@ts-expect-error` 移至 `base64:` 属性行正上方——TS2353 报在属性行，指在 `emitter.emit({` 上方恒为 unused（已独立复现）；
   - `test/vfsl-gate.test.ts`：badRecords 数组类型 `Array<[string, DiagnosticChangeRecord]>` → `Array<[string, unknown]>` + 调用处 cast——条目故意注入词表外值（'nope' 等），与封闭字面量类型（Operation/Stage/InputCapture）不可赋值是**必然**类型错误（任何实现下均如此）；fault-injection 运行期语义不变。
4. **`emit()` 顶层 catch 收编 `safeOperationOf`**：敌对 emission 下 operation 事件位缺省（emission-dropped/pipeline-crashed 的 operation 为可选位，设计 §8.1 允许）。
5. **context 非对象**：整体丢弃、不发事件（不发明字段名；设计未定义该形状，无测试锚）。
6. **记号记账**：`jsonLiteralCpBytes(0x2026) = 2`——设计 §6.1 钉死「TRUNCATION_MARKER JSON 字面量字节 = 13B」（SA6 KAT 同锚），而设计自带的 utf8-2 公式与精确 UTF-8 字节为 14B（`…` U+2026 = 3B + `[truncated]` 11B）。为同时满足设计钉死值（13B）×其自身公式 × SA6 KAT 三者，按设计钉死值记账（U+2026 记 2B）；`jsonLiteralBytes` 实现为逐 code point 累计表（与 truncateUtf8 同基——「测量」与「截断」同标尺，§6.1 语义），单字符 KAT（a/€/😀/\n/"/\\/\u0001/\ud800）全部与 UTF-8 精确值一致，仅 U+2026 记账差 1B。
7. **`operationOf` 词表外值**：vfsl-validation-failed/record-dropped 事件对词表外 operation（仅 fault-injection 可达）省略 operation 键（SA6 §3.6 明确不断言该值）。
8. **injectFinalRecord 不更新 lastSequence**：sequence 属于注入 record 自身（测试注入 sequence:'1'）；设计未定义直通接缝的 sequence 记账（§9.6 只锚定 VFSL 门 + 入队）。

## 4. 遗留红灯（3 条 —— SA6 断言内部矛盾，需修订测试或总控裁决）

**A. `emitter-isolation.test.ts`「变异已移交 updateBytes：抛 TypeError」（设计 §9.2 所有权契约）**
- 断言：`bytes[0] = 0` 在 emit 后抛 TypeError。JS 语义下**不可能**：`Object.freeze(Uint8Array)` 直接抛 `Cannot freeze array buffer views with elements`；detach（`ArrayBuffer.transfer`）后写为静默 no-op（V8 实测不抛）；TypedArray 整数下标不能 defineProperty `writable:false`；无法用 proxy 替换 producer 持有的引用。快照（普通对象）侧的同一契约断言已绿（deepFreeze 生效）。
- 建议：SA6 改为断言「语义 record 深冻结（不含 updateBytes 位）且 physicalize 后 Base64 字节不变」或删除该断言；设计 §2.6 的 typed-array 冻结面需修订表述（或由总控裁决用 detach 语义并放宽为「变异后记录不被改写」）。

**B. `line-budget.test.ts`「redacted 超预算同降级（fromPolicy=redacted）」**
- 断言：`{data:'x'.repeat(2000)}` + redacted 策略 + 1000B 预算 → input 降级 digest+degraded。实测该记录的**红acted 投影**仅 441B（`{data:'«redacted»'}`），远低于 1000B 预算——按设计 §5.5（measure(record) > 预算才降级）不可能触发降级。SA6 显然未考虑红acted 值收缩（`full` 同款用例 2350B 超限而降级，该用例绿）。
- 建议：SA6 改用超限输入构造红acted 记录（如 message 巨型 issues 或 lineBudgetBytes 调小到 ~300），或删改该断言。

**C. `update-carrier.test.ts`「增量向量："" → 00000000…」**
- 断言：`encode('')`（0 字节）+ updateCapture:true → **inline carrier**（crc32c '00000000'/payloadLength 0/base64 ''）。同一文件 §9.9「R2/D-c1 empty-update」对**同输入**（0 字节 + updateCapture:true）断言 **update-omitted/empty-update（无 update 键）**；SA6 红灯报告 §3.2 亦明文「0 字节 → update-omitted/empty-update，绝不落 inline 空 Base64」。两者互斥，任何确定性实现只能满足其一。本实现按设计 §7.4 守卫（empty-update 最前）——`''` 向量断言失败（其余 3 向量 a/abc/hello world 绿，CRC32C 实现本身正确）。
- 建议：SA6 删除 `''` 向量或将 CRC32C KAT 经直接接缝（crc32cHex 导出）验证空串 → '00000000'。

## 5. 验证证据

### 5.1 主验证命令（任务原文）

```bash
cd /home/wangjian/nomicore-fix-issue-148
setsid nohup bash -c 'npx vitest run --typecheck packages/namespace-diagnostic-log > .mabf-bg/sa3-green.log 2>&1; echo $? > .mabf-bg/sa3-green.exit' >/dev/null 2>&1 </dev/null & disown
```
- `.mabf-bg/sa3-green.exit` = **1**（3 条遗留红灯，见 §4）
- 尾部：

```text
 Test Files  3 failed | 9 passed (12)
      Tests  3 failed | 148 passed (151)
Type Errors  no errors
   Duration  9.99s
```

### 5.2 类型检查

- `tsc -p packages/namespace-diagnostic-log/tsconfig.json` → exit 0（零错误）
- `tsc -p tsconfig.typecheck.json`（根 typecheck 同口径，含全部 packages\*/\*\* src+test）→ exit 0（.mabf-bg/sa3-root-tsc.exit=0）

### 5.3 指纹锚点

- `RECORD_SCHEMA_TEXT` 与设计 §3.3 文本（脚本提取）逐字符相等（match: true）；`compileSchemaEnvelope` 实测 `envelopeFingerprint = sha256:v1:dedad2ab93d9df9224960ca094924168f8bcc1c0512dfdd0a03dc6e66613e070`、`semanticFingerprint = sha256:v1:7be7baf0b1d3b8e2da1edd1e06f185dd4fc1492b7cf2d3fae1b9265fa00e3034`。
- schema-freeze.test.ts（指纹钉死/恰四键/外部一致性/孪生不变量）全绿。

### 5.4 验收对应

记录/验收标准对账（绿的部分）：AC1（6 operation × 8 result 变体 + intake 违规 + 物理键黑名单类型锚）绿；AC2（四策略决策表 + digest KAT + redacted + 护栏 + 所有权快照侧）绿；AC3（issues 预算全部边界 + 段级 JSON-safe + line 预算降级/丢弃/诚实 gap）绿（除 §4-B）；AC4（VFSL 门 9 类注入 + 事件只带 issuePaths + 白名单 + 冻结 schema 自证 + failed 模式注入 + sidecar/genesis 可表达）绿；AC5（容量/drop newest/保序/冻结/永不 throw/stats 对账/exhausted 邻域）绿；observer 隔离（fallback 稳定码/多事件/自身 throw 最后防线/不入队列）绿。

## 6. 遗留问题（对后续票）

- #152 复用：emitter 管线（createDiagnosticChangeEmitter）只换 sink；sidecar 形状已由 schema 冻结可表达（正向测试绿）；genesis 构造路径为 adapter 内部（§10-J1）；CRC32C/JCS/Base64 可直接复用本包实现（carrier/crc32c 内部模块）。
- `records()` 类型面（AttemptRecord[]）与运行时可能含 genesis 的缝隙：若 #152 需公共面表达 genesis，建议重新审视 §1.3 签名（本次依 SA6 测试强制取窄）。
- 词表外 `operation` 事件位缺省：v1 事件类型 `operation?`（SA6 §3.6 未锚值），#152 若需可再裁定。
- 无 git commit/push（按纪律）；`pnpm-lock.yaml` 由 SA6 生成、仅新包 importer 段。

## 7. R3 增补（总控裁决 2026-08-28 后）

1. **updateBytes 复制隔离**（设计 §2.6 R3）：`canonicalResult`（src/pipeline.ts intake
   层）对 `effect:'update'` 的 `updateBytes` 做 `slice()` 副本——语义 record 与最终
   record 均消费副本；producer 在 emit 后变异原 updateBytes 不影响已接纳 record
   （已实测：变异后记录 base64/crc 保持原始值）。plain-data snapshot 维持冻结语义
   不变（deepFreeze）。相应地更新了 pipeline.ts/emission.ts 的所有权契约注释。
2. **testing.ts 增补 `crc32cHex(bytes): string` 直测导出**（复用 src/crc32c.ts）：
   供 CRC KAT 空输入直测；0 字节经 emit 路径按 R2/D-c1 为 update-omitted/empty-update
   （与 inline carrier KAT 互斥，R3 裁决实证）。已实测：''→'00000000'、
   '123456789'→'e3069283'。
3. 上述两项不动任何测试文件（SA6 将同步修 3 条断言：updateBytes 变异断言改复制隔离
   断言；redacted 超预算用例改键重型输入；CRC '' 向量改直测）。

## 8. R4 勘误批落实（总控 R4 · SA4 审查 C-1/C-2/C-3/C-4 + nano-2/nano-4）

1. **C-1** health.ts `DiagnosticLogHealthEvent` 恢复为设计 §8.1 的 8 成员判别联合
   （type 判别）；record-dropped 与 vfsl-validation-failed 的 operation 为
   `operation?: Operation`（R4/C-5：genesis 无 operation 属形状事实）；input-degraded
   构造点保证 operation 键恒在（词表外注入值以 record 原值携带——降级只对 attempt
   发生）。makeEventNotifier 的 Record 参数面不变（构造点自证窄化）。
2. **C-2** `records()` 恢复 `readonly DiagnosticChangeRecord[]`（去掉 AttemptRecord
   cast——genesis 与 attempt 两族均可读，窄化归测试侧）。
3. **C-3** issues 投影 presence 不变式：truncated 与 originalCount 两键同现同缺
   （truncated ⇔ 预算截断或条目丢弃）。
4. **C-4** 删除 `jsonLiteralCpBytes(0x2026)=2` 特例——U+2026 走 `cp<0x10000 → 3B`；
   marker 精确 14B（截断按 14B 预留）；头注/注释同步。
5. **nano-2** AGENTS.md Contract 段所有权口径改 R3：snapshot 深冻结（变异抛
   TypeError）+ updateBytes intake 复制隔离（producer 事后变异不影响已接纳 record）。
6. **nano-4** testing.ts injectFinalRecord 头注：直通接缝不更新 lastSequence——注入后
   可出现重复 sequence 字符串，仅测试用。

验证：src-only tsc exit 0（测试侧窄化适配归 SA6，未跑全量）；探针确认 marker 14B、
presence 两键同现、input-degraded 事件携带 operation。
