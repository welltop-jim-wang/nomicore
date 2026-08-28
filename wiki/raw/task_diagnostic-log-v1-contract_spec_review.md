# Spec 符合性审查报告 — issue #148 `@nomicore/namespace-diagnostic-log`（spec 轴）

- **Date**: 2026-08-28
- **Reviewer**: spec 轴独立审查员（与 standards 轴并行、互不可见）
- **对象**: commit `ae3aeec`（`git diff 6de2f1d..HEAD`），worktree `/home/wangjian/nomicore-fix-issue-148`
- **规格基线**: issue #148 五条验收（逐字）、ADR 0011/0012、设计 R4（§11 总控裁决 G1–G6）、SA2（R1.1+R2 复审）/SA4/SA6（R3/R4 修订节）/SA7+ac_checklist 过程工件
- **总 Verdict**: **pass-with-issues**——5/5 AC 独立复核通过（全部有代码+测试+本机探针证据）；冻结纪律与切片纪律经脚本/逐文件核验成立；SA2/SA4/R3/R4 全部反馈闭环属实。新发现 **3 concern（均不阻断：fail-safe 路径、非默认策略或 producer 违约角落、无 schema/指纹影响）+ 4 nano**，建议 R5 文档/微修轮或 #149 接线前处置。

---

## 0. 独立复验证据（本机执行，非采信 SA7）

```text
npx vitest run --typecheck packages/namespace-diagnostic-log → 12 files / 152 tests 全绿 / Type Errors 0 / exit 0
npx tsc -p packages/namespace-diagnostic-log/tsconfig.json   → exit 0
/tmp/spec-freeze-check.mts（tsx）：
  RECORD_SCHEMA_TEXT == 设计 §3.3 围栏文本（含尾随 \n）：7040 == 7040 字符，firstDiff=-1（逐字符相等）
  compile ok: true
  envelopeFingerprint  = sha256:v1:dedad2ab93d9df9224960ca094924168f8bcc1c0512dfdd0a03dc6e66613e070（== 钉死常量）
  semanticFingerprint  = sha256:v1:7be7baf0…e3034
  envelope keys = id,lang,text,version（恰四键）；Object.isFrozen = true
/tmp/spec-probe.mts + spec-probe2.mts（行为探针，见 §5 各发现）
git diff 6de2f1d..HEAD --stat：47 文件、仅新包 + 根 package.json 一行 + CONTEXT.md +12 行 + pnpm-lock.yaml +16 行 + wiki 工件
```

---

## 1. AC 逐条独立复核（不采信 SA7 结论）

### AC1 — emitter 接受全 operation/result 分支 + 零物理细节 → **pass**

- **代码证据**：`vocabulary.ts:13-19` operation 6 值与 ADR 0012 L69-78 逐字一致；`emission.ts:15-23` EmissionResult 8 成员与 ADR 0012 L82-87 六形状展开一致；`pipeline.ts:88-136` intake 词表校验 + `canonicalResult` 逐成员重建（多余物理键结构性屏蔽，探针 P7 实证 rejected+update 被偷渡时输出干净 `{kind:'rejected'}`）。
- **测试证据**：`record-vocabulary.test.ts:71-204`（8 变体逐字段断言 × 6 operation 矩阵；rejected/fatal+false 无 update 键封闭性回归锚 117-135）；`identity.test-d.ts:70-102`（R2/F-c2 编译期黑名单：Emission/EmissionResult 键集 ∩ {base64,segment,frameOffset,crc32c,payloadLength,storage,retention} = ∅，UpdateCarrier 非空转正例）；intake 10 类违规 → emission-dropped 不消耗 sequence（229-259，探针确认 `lastSequenceAssigned` 保持 null）。
- emission 面无 retention/JSONL/frame 任何键（类型层 + 运行时双层锚定）。

### AC2 — 四策略输入捕获只消费安全快照、零重读 → **pass**

- **代码证据**：`input.ts:50-88` 决策表 5 输入行 × 4 策略全格；「事实优先于策略」在 status 分支先于快照触达返回（57-64）；policy=none 不触碰快照（72-75）；digest=SHA-256(JCS bytes)（`canonical-json.ts:57-86` + `digest.ts:13-21`）；快照契约违反 → `unavailable` + `input-projection-failed`，不重读不重试（84-87）。
- **测试证据**：`input-capture.test.ts:22-90`（全格）；92-152（RFC 8785 键序/数字/转义 KAT + SHA-256 标准向量 + lone surrogate 钉死 digest）；212-227（**同一敌意 getter 只触达一次**探针）；`emitter-isolation.test.ts:17-96`（getter 抛错/bigint/symbol/稀疏 hole/10 万层深嵌套 → unavailable，emit 不 throw）。
- 结构上原始请求对象从不进入日志模块（emission 只携带 snapshot）——ADR 0011 L73「不得再次遍历调用方原对象」由接缝形状保证。

### AC3 — 确定性投影 + 预算 + 降级 digest → **pass（附 1 条 concern，见 C-S1）**

- **代码证据**：`issues.ts:29-72` JSON 字面量字节基准 + code-point 对齐截断（R2/E-c2/R4/C-4：marker 精确 14B，无 U+2026 特例）；`issues.ts:105-179` 预算 4096/1024/256 段/1000 条逐字落地 + 段级 JSON-safe + -0 归一 + R4/C-3 两键同现同缺（174-179）；`memory.ts:256-279` line 预算「先降级 digest → 仍超限丢弃」与 ADR 0012 L136 逐字同序。
- **测试证据**：`issues-projection.test.ts:24-238`（4096/4097B、多字节骑界、1365 lone surrogate、257 段、1025B 段、1001/1000 条、presence、NaN/±Infinity/undefined/hole 段、-0、truncateUtf8(12) loud throw、KAT marker=14B）；`line-budget.test.ts:13-105`（full/redacted 降级 + digest 不变 + 丢弃 + 诚实 sequence gap + §10-J9 大 update 丢弃非伪装）。
- **C-S1（concern）**：`issuesPolicy:'redacted'` 分支（issues.ts:142-149）**不施加 path 预算**（256 段/段 1024B）也不置 `truncated`——设计 §6.2 的 path 行无 policy 条件（无条件适用），ADR 0012 L134 预算是 record 形状规范。探针 P1 实证：redacted 下 301 段 + 2000B 段原样入 record、`truncated` 缺席、零事件。缓解：默认策略为 full（预算生效）；1000 条总数预算在 redacted 下仍生效（探针 P4）；整行 line 预算（1 MiB）兜底总量。设计 §9.4「code/path 保留」与 §6.2 存在内部张力，SA6/SA3 按 §9.4 字面落地且未披露——需 R5 勘误二选一（设计改口接受 + 备案，或实现对齐 §6.2 补截断）。

### AC4 — 冻结 VFSL 信封校验 + 故障只走健康面 → **pass（附 1 条 concern，见 C-S3）**

- **代码证据**：`memory.ts:168-178` 构造期急切编译 + failed 模式（恰一次事件 + 后续只计数）；281-301 VFSL 门失败 → 丢弃 + `vfsl-validation-failed`（只带 issuePaths 首 10 条、`$.a.b[0]` 形式、跳根级空路径、schemaId/指纹钉死；`ValidateIssue.message` 含 40 字符值预览整体丢弃——G4 落地）；`health.ts:83-98` observer throw → `DIAGNOSTIC_LOG_OBSERVER_FAILED observer_threw=` 单行 fallback，fallback 再 throw → 静默最后防线。
- **测试证据**：`vfsl-gate.test.ts:59-204`（9 类违规注入 + 白名单键集断言 104-108 + sidecar/genesis 可表达性正例 + R2/F-c1 failed 模式四断言）；`observer-isolation.test.ts:14-98`（observer 全 throw 业务不受影响、fallback 稳定码、最后防线、健康事件不入队）。
- **指纹独立复现**：本机脚本（§0）指纹 === 钉死常量，信封恰四键深冻结。
- **C-S3（concern）**：producer 违约在 `source` 上塞多余键时，intake（`vocabulary.ts:86-97` 不查多余键）放行 → 最终 record 被 VFSL 封闭对象门拒 → 报 `vfsl-validation-failed`（探针 P5 实证，issuePaths=['$.source.base64']）——把 **producer 输入缺陷误标为 ADR 0012 的「writer bug」信号**，与 SA2/D-c1（empty-update）同类污染语义；设计 §4.2 把「source 违形」分配给 intake（emission-dropped）。仅在 JS 侧绕过类型的 producer 违约可达，行为本身 fail-safe（丢弃+健康面，业务零影响）。

### AC5 — 有界 adapter drop-newest/保序/不 throw + 契约测试全分支/故障隔离 → **pass（附 1 nano）**

- **代码证据**：`memory.ts:304-309` 满员 drop newest 且绝不入队；231-232 + 36-50 sequence 十进制字符串进位（无 number 失真）、丢弃消耗 sequence（诚实 gap）、uint64 max exhausted 模式；314-329/333-347 append 双路径 catch-all；records()/stats() 返回冻结副本。
- **测试证据**：`memory-adapter.test.ts:14-140`（capacity=3+6 条 drop newest + stats 对账 + lastSequenceAssigned='6'、保序、冻结、实例隔离）；`identity.test.ts:82-135`（nextDecimal 进位链 + 2^53 邻域 + exhausted 预置接缝）；全 result 分支覆盖同 AC1 矩阵；故障隔离见 AC2/AC4 各文件。
- **N-S1（nano）**：`queue.push(Object.freeze(effective))`（memory.ts:309）为浅冻结——adapter 新建嵌套对象（`result`/`result.update` carrier）未冻结（探针 P3 实证：top/result=false，issues/input/source=true 因管线深冻结）。`records()` 消费者可静默改写 `record.result.update.base64`。§7.1「冻结引用」与 §9.7 测试锚（只测顶层变异）字面满足，属加固缺口。

---

## 2. ADR 0011/0012 逐节抽查

| 抽查点 | 结论 | 证据 |
|---|---|---|
| 输入零重读（ADR 0011 L67-75 / ADR 0012 L116-122） | ✅ | not-accessed/unavailable/unsafe-input 事实优先（input.ts:57-64）；快照失败不重读（单触达探针绿）；原始请求结构性不进入 |
| 结局词表不折叠（ADR 0011 L33-51） | ✅ | stage 8 值逐字（vocabulary.ts:22-30）；rejected 未折叠；`unknown` 不落存储（G3：schema 无该成员） |
| 数据保护默认（ADR 0011 L77-87） | ✅ | inputPolicy 默认 digest、updateCapture 默认 false（memory.ts:160-162）；full/update 显式启用；脱敏 policy 自标；事件白名单零敏感字段（vfsl-gate:104-108）；日志字段不进 metrics label（stats 键 = operation:reason 低基数） |
| emitter interface 语义（ADR 0011 L107-119） | ✅ | `emit(emission): void` 同步不 throw 不阻塞（全路径 catch；SA7 性能探针 ~3ms/256KiB）；所有权「已转移或已复制」= snapshot 深冻结 + updateBytes intake slice 复制（R3 裁决，emitter-isolation:99-120 双锚）；接口名保留 ADR 0011 命名 |
| VFSL 失败 = writer bug（ADR 0012 L214） | ✅（除 C-S3 角） | 丢弃 + 低基数事件 + 不影响业务；空 update/超 payload 经前置守卫转 update-omitted，不污染该信号（update-carrier:93-114） |
| sequence 语义（ADR 0012 L61-67） | ✅ | append 时才分配、十进制无前导零、字符串进位无 2^53 失真、不回绕、丢弃消耗（诚实 gap）、uint64 max exhausted 丢弃+上报（计数）业务不受影响 |
| line 预算顺序（ADR 0012 L136） | ✅ | 降级 digest → 仍超限丢弃，逐字同序（memory.ts:258-279） |
| rejected/fatal+false 禁携 update（ADR 0012 L89） | ✅ | schema 封闭对象机器强制 + canonicalResult 重建 + 测试双锚 |
| sidecar/inline 双形状一次冻结（issue 关键约束） | ✅ | schema UpdateCarrier 双成员含 crc32c（G1 裁决）；vfsl-gate:122-162 sidecar/genesis 正例过门 |
| observer 只含白名单字段（ADR 0012 L214） | ✅ | 事件构造点全集（pipeline.ts 5 处 + memory.ts 4 处）逐字段比对 §8.2 无越界；事件深冻结 |
| 不写递归 health record（ADR 0012 L214） | ✅ | 事件只走 observer/fallbackLog，不入队（observer-isolation:89-98） |
| streamId/attemptId CSPRNG（ADR 0012 L16-20/L61-65） | ✅ | 默认 node:crypto randomBytes 16B；log-/att- + 32 hex；注入接缝仅测试用（identity:27-59） |
| P_BASE64 空串引擎差异（SA6 §3.2 备案） | 已知悉 | vfsl 引擎接受 `''`；empty-update 前置守卫结构性规避（memory.ts:209-213）——不构成本包缺陷 |

---

## 3. 过程反馈闭环核对（报告宣称 vs 最终代码/文档实证）

### SA2 R1.1 → R2（2 blocker + 8 concern）——**10/10 落实属实**

| 项 | 核验结论 | 实证 |
|---|---|---|
| G-b1 lockfile | ✅ | pnpm-lock.yaml diff 恰 +16 行、仅 `packages/namespace-diagnostic-log` importer（vfsl link + 复用既有版本，无漂移） |
| C-b1 段级 JSON-safe | ✅ | issues.ts:77-92 段级判定 + 129-131 -0 归一；canonical-json.ts:66-75 逐槽检查；twin.ts round-trip helper 全 suite 复用 |
| D-c1 empty-update | ✅ | memory.ts:209-213 守卫最前；update-carrier:93-114 双断言（保 metadata + 无 vfsl-validation-failed） |
| D-c2 genesis 备案 | ✅ | 设计 §10-J1/§1.3 注释收窄；CONTEXT.md genesis 词条同步收录 |
| A-c1 sequence 纪律 | ✅ | memory.ts:36-50 nextDecimal + exhausted；stats 键 `sequence-exhausted`（采纳 R2.3-n3）；identity:101-135 锚 |
| E-c1 小预算 loud | ✅ | issues.ts:58 throw TruncationBudgetBelowMarker；issues-projection:207-216 红灯 |
| E-c2 预算基准 | ✅ | issues.ts:29-51 JSON 字面量字节；逐单位 KAT 绿；1365 lone surrogate 向量绿 |
| F-c1 failed 模式开缝 | ✅ | testing.ts:65-70 工厂；vfsl-gate:165-204 四断言 |
| F-c2 物理键黑名单 | ✅ | identity.test-d.ts:70-102 双锚 + 非空转正例 |
| A-c2 reason 词表 | ✅ | CONTEXT.md emission 词条说明行收录三 reason；AGENTS.md:25-27 词表化 + 演进纪律 |

### SA2 R2.3 四 nano：n1 部分残留（见 N-S3 同类，SA7 已备案设计文档 4 处旧「13B」措辞）；n2 接受；n3 ✅ 采纳；n4 ✅（replicationEpoch -0 已归一 pipeline.ts:184；durationMs 残差设计 §5.4 已备案）。

### R3 总控裁决（3 处）——**落实属实**：updateBytes intake slice 复制隔离（pipeline.ts:120-136 + emitter-isolation:111-120）；crc32cHex 直测导出（testing.ts:20）；redacted 键重型降级用例（line-budget:37-53 绿）。

### SA4（C-1..C-5 + 5 nano）——**5/5 concern 落实属实**

| 项 | 核验结论 | 实证 |
|---|---|---|
| C-1 事件判别联合恢复 | ✅ | health.ts:22-57 恢复 8 成员判别联合；测试经 eventsOfType 窄化（base.ts:96-101） |
| C-2 records() 两族联合 | ✅ | memory.ts:97 `readonly DiagnosticChangeRecord[]`，cast 已去；测试经 assertAttempt/attemptRecords 窄化 |
| C-3 truncated/originalCount 同现同缺 | ✅ | issues.ts:174-179；issues-projection:149-205 断言同现/同缺 |
| C-4 marker 14B 精确基准 | ✅ | issues.ts:16-17/42-51 无 U+2026 特例；KAT `jsonLiteralBytes(MARKER)===14` 绿；SA7 C-4 演示行为成立 |
| C-5 两事件 operation 可选化 | ✅ | health.ts:44/51 `operation?: Operation` + 注释 |
| nano-1 test-d 同义反复 | 仍存在（接受） | identity.test-d.ts:36/44；契约力由相邻 @ts-expect-error 承担——SA4 定级 nano 且 R4 未要求修，维持 |
| nano-2 AGENTS 措辞 | ✅ | AGENTS.md:16-20 已改 R3 复制隔离口径 |
| nano-3 非对象 context 静默丢弃 | 仍存在（接受） | pipeline.ts:155-158；设计未定义该形状，SA3 §3-5 披露 |
| nano-4 testing.ts 注记 | ✅ | testing.ts:52-57 直通接缝不更新 lastSequence 注记 |
| nano-5 issuePaths 先滤后切 | 仍存在（接受） | memory.ts:290-293；schema 合法白名单合规极角 |

### SA6 R4 测试对齐（4 项）——**落实属实**（eventsOfType/assertAttempt helpers、C-3 断言、14B KAT 全绿）。

**闭环核对总结**：未发现「报告宣称完成但代码没改」项；全部宣称修订均经本机代码核验 + 测试绿 + 探针/脚本复验。

---

## 4. 冻结纪律核验

- **RECORD_SCHEMA_TEXT ↔ 设计 §3.3**：脚本逐字符比对 7040 == 7040（含尾随 `\n`），firstDiff=-1 ✅（§0）。
- **指纹常量**：`envelopeFingerprint = sha256:v1:dedad2ab…e070` 独立复现，`schema-freeze.test.ts:26-29` + `helpers/base.ts:34-35` 钉死 ✅；`semanticFingerprint` 形状锚 ✅；信封恰四键深冻结 ✅。
- **R2→R4 文本零改动**：SA2 R2.1 核验 R1.1→R2 逐行零改动；SA4 item 2 核验 R4 时刻 7040 字符相等 + 同指纹；本审查在当前 HEAD 复算同值——三轮证据链一致 ✅。
- **单源纪律**：schema.ts 全部 Pattern 经 schema-patterns.ts 常量插值（零反斜杠）✅。
- **已知文档残差（nano N-S2）**：schema JSDoc（schema.ts:148-149/设计 §3.3 同文）「truncated/originalCount 仅在实际发生预算截断时出现」与 R4/C-3 后 §6.2「截断或有损丢弃 ⇔ 同现」口径不一——冻结纪律下 v1 内不可改（改 JSDoc = 指纹变更 = 新版本），备案即可。

## 5. 新发现问题清单（本轮首报）

| # | 级别 | 问题 | 证据 |
|---|---|---|---|
| C-S1 | concern | redacted issues 策略跳过 path 段数/字节预算且不置 truncated（设计 §6.2 path 行无条件 vs §9.4「保留」内部张力；ADR 0012 L134 预算） | issues.ts:142-149；探针 P1（301 段+2000B 段原样保留、truncated 缺席、零事件）；P4（1000 条预算仍生效） |
| C-S2 | concern | emission `issues` 形状为 `{ items: DiagnosticIssue[] }`（IssuesInput），与冻结设计 §2.6 `issues?: DiagnosticIssue[]` 不符；按设计字面传数组的 producer 将静默丢失全部 issues（仅一次 enrichment-field-dropped/issues 事件）；SA3 偏差清单与 SA4 均未披露、未经裁决 | emission.ts:33-51 vs 设计 §2.6:320；探针 P2；grep 证实 `IssuesInput` 零文档出现 |
| C-S3 | concern | `source` 多余键逃过 intake（isLogSource 不查封闭性）→ VFSL 门拒 → producer 违约被报为 `vfsl-validation-failed`（writer bug 信号污染，D-c1 同类）；附带：`context` 未知键静默剥离无事件（与 nano-3 同族） | vocabulary.ts:86-97；探针 P5（issuePaths=['$.source.base64']）/P6 |
| N-S1 | nano | records() 浅冻结：adapter 新建 result/update carrier 未冻结，消费者可静默改写嵌套字段 | memory.ts:309；探针 P3（result/result.update isFrozen=false） |
| N-S2 | nano | 冻结 schema JSDoc 的 presence 口径滞后于 R4/C-3（见 §4；v1 内不可改，备案） | schema.ts:148-149 vs 设计 §6.2:850 |
| N-S3 | nano | AGENTS.md:5 仍指「设计 R2 唯一权威」（R4 已生效）+ L8「契约契约测试」叠字 | AGENTS.md:5,8 |
| N-S4 | nano | 设计文档 4 处旧「13B」措辞残留（SA7 §6-1 已备案，本文仅登记不重复计） | 设计 §6.1:813/826、§9.4:1011、文末历史表 |

**处置建议**（不阻塞本票）：C-S1/C-S2/C-S3 均建议 R5 轻量勘误轮处置——C-S1 二选一（设计改口接受 redacted path 不截断 + 备案 line 预算兜底，或实现补截断）；C-S2 二选一（设计 R5 把 §2.6 改为 `IssuesInput` 容器追认现状 [推荐，测试面已成事实标准]，或实现改回数组）；C-S3 二选一（intake 对 source 重建/封闭校验转 emission-dropped [推荐，与 context 重建同构]，或设计备案该角由 VFSL 门兜底）。三项均不动 schema 文本与指纹。

## 6. 切片纪律核验

- 实际 diff = 设计 §12 ALLOW LIST 精确匹配：新包 17 src + 12 test + 2 helper + 骨架四件、根 package.json 仅 typecheck 一行、CONTEXT.md 仅 +3 词条（含 reason 词表）、pnpm-lock.yaml 仅新 importer、wiki 工件。DENY LIST 零命中（docs/adr、vfsl、runtime/registry、clock 等均未触碰）。
- **无越界**：grep 实证无 NDCL frame magic/manifest/reader/retention/replay 实现；sidecar 仅以 schema/类型可表达（§2.5 验收方式内）；无 Runtime/Registry 接线（新包对外零 caller，`grep -rln namespace-diagnostic-log packages apps domains` 除自身为空）；不依赖 yjs/clock。
- #149–#155 事项一件未做 ✅。

## 7. 总体 Verdict

**pass-with-issues**。

- 五条验收标准全部独立复核通过，证据链 = 代码位置 + 测试位置 + 本机复跑/探针；ADR 抽查 13 项全过（1 项角落见 C-S3）；反馈闭环 10+4+3+5+4 项全部实证落实，无虚假宣称；冻结纪律三轮证据链一致；切片零越界。
- 3 条新 concern 全部属「冻结文本与实现/披露的落差」而非运行时危险：fail-safe、非默认路径或 producer 违约角、schema/指纹零影响。建议总控开 R5 文档/微修轮（或并入 #149 接线前维护轮）按 §5 建议处置；本票交付可进入发布流程。

---

## 8. R5 复审（commit `687aa94`，聚焦 C-S1/C-S2/C-S3）

- **Date**: 2026-08-28（R5 修复轮后）
- **范围**: `git diff ae3aeec..HEAD -- packages/namespace-diagnostic-log` + 设计 R5 头部/§6.2
- **复审结论**：**3/3 concern 全部真实修复、各有新测试锚，无引入新问题**；standards 轴 presence 再裁决与冻结文本一致；附带改动逐项核验良性。包测试 **164/164 绿**（R4 时 152 → +12 新用例）、Type Errors 0、根 `pnpm typecheck` exit 0（均本机复跑）。

### 8.1 C-S1（redacted 策略 path 预算）→ **fixed**

- **代码**：issues.ts 把 path 预算（前 256 段 + string 段 truncateUtf8 1024 + 截断探测置 `truncated`）上移到策略分支之前，对 full/redacted 一致生效；redacted 分支复用截断后 path。设计 R5 头部 ④ 注记。
- **实证（探针 R5-P1）**：redacted 下 301 段 + 2000B 段 → 保 256 段、`truncated:true`、`originalCount:1` 同现、message=`«redacted»`——与 ADR 0012 L134 预算及设计 §6.2 无条件 path 行一致。
- **测试锚**：issues-projection.test.ts R5 用例（redacted 257 段/1025B 段断言截断 + 两键同现）。

### 8.2 C-S2（emission issues 裸数组对齐设计 §2.6）→ **fixed**

- **代码**：emission.ts 删 `IssuesInput` 容器，`issues?: DiagnosticIssue[]` 恢复设计 §2.6 逐字形状；issues.ts `projectIssues` 改收裸数组（非数组 → 一次 enrichment-field-dropped/issues + 字段缺席，fail-safe）；pipeline.ts 注释同步。
- **实证（探针 R5-P2/P2b）**：裸数组正常投影；旧 `{items}` 容器现按畸形容器丢弃 + 恰一次事件（无静默）。
- **测试锚**：record-vocabulary/line-budget/issues-projection 全部改用裸数组；畸形容器用例保留。

### 8.3 C-S3（source 封闭键 intake 校验）→ **fixed**

- **代码**：pipeline.ts `intakeValid` 增 source 封闭键校验（local 恰 `{kind}`；replication 键 ⊆ `{kind,direction,remoteInstanceId}`，必需键存在性仍由先行的 isLogSource 保证）→ 多余键归 emission-dropped/emission-shape，不再触达 VFSL 门。
- **实证（探针 R5-P3/P3b）**：local+extra 与 replication+junk 均 → emission-dropped、records 0、**零 vfsl-validation-failed**——writer-bug 信号纯度恢复（ADR 0012 L214）。
- **测试锚**：record-vocabulary.test.ts 违规表 +2 用例，并断言整个 intake 表 `vfsl-validation-failed` 恒 0。

### 8.4 附带改动核验（防新问题）

| 改动 | 核验 |
|---|---|
| presence 再裁决（truncated/originalCount 严格 ⇔ 预算截断；畸形丢弃只走事件） | ✅ 与冻结 schema JSDoc 逐字一致（本报告 N-S2 以此方式消解）；设计 §6.2:850 已改；探针 R5-P6/P6b 双向实证；schema.ts 零改动（脚本复验 7040 字符相等、指纹不变） |
| plainness 守卫（jcs/redact 拒 Date/Map/typed array） | ✅ 契约正确（快照本为 plain-data）；探针 R5-P5 三型 unavailable + 恰一次事件；getter 单触达零重读纪律保持（新测试锚） |
| input 非对象 intake 拒绝（std C-2） | ✅ 探针 R5-P4（null/42/'x'/[1] → emission-dropped，非 pipeline-crashed，sequence 不消耗） |
| makeEventNotifier 参数收窄为判别联合（std C-1） | ✅ 纯类型面收紧，运行时不变；事件构造点恢复编译期校验 |
| 死导出清理（UPDATE_OMITTED_REASONS、未用 RE_* 六枚） | ✅ grep 全包零引用；三 reason 词表仍由 CONTEXT.md/AGENTS.md 承载 |
| TextEncoder 单例 / testing.ts 空字节 loud throw / AGENTS.md 叠字 | ✅ 良性 |

### 8.5 残留项（均 nano，不阻断）

- **N-S1（records() 浅冻结）**：R5 未触及——adapter 新建 result/update carrier 仍未深冻结；维持 nano（§9.7 测试锚字面满足）。
- **N-S3（半残留）**：AGENTS.md 叠字已修；L5「设计 R2 唯一权威」版本指引仍滞后（现 R5）。
- **N-S4**：设计文档旧「13B」措辞残留处未随 R5 清理（SA7 已备案，文档级）。

### 8.6 最终 verdict

**pass**——spec 轴 3 条 concern 全部真实修复并有测试锚与本机探针实证；R5 未触碰冻结 schema（文本/指纹复验不变）；切片仍零越界；测试无弱化（断言全部同向或加强）。本票从 spec 轴放行发布。
