# Spec 评审报告 — File diagnostic-log adapter（issue #152）

- **评审轴**：Spec（diff ↔ issue / ADR 0012 / 已接受设计 R2 / SA6 契约 逐条比对）
- **评审员**：工程终审 Spec 评审（独立评审，无其它评审者上下文）
- **日期**：2026-08-28
- **Verdict**：**pass-with-issues**（5 条 AC 全覆盖且证据充分；0 项阻断性发现；3 项 MINOR + 3 项 INFO，建议回流总控裁量，均不阻断本票）

---

## 一、审查的精确 diff 范围

```
git diff 7ceede1..HEAD   （HEAD = 79ac342）
```

7 个 commit，31 文件，+6073/−11：

| commit | 内容 |
|---|---|
| `56ed694` | 实现主体：file.ts / reader.ts / frame.ts / paths.ts / storage-gate.ts 新建 + carrier/health/index/testing 追加 + 5 测试文件 + 2 helper |
| `0ec62e9` | SA6 契约断言勘误（总控 R 裁决，fatal 分支 kind 断言） |
| `cb44bcd` | SA4 R1 修复轮：P_DECIMAL 镜像补 frameOffset 消费面 + writer 注入门（R-1/R-2/R-3） |
| `98d5280` / `5830612` | wiki 派遣日志 / SA4 评审归档（流程档案） |
| `e311326` | package.json 0.1.0→0.1.1 + health.ts code 注释同步 6 值集（总控「硬门禁 9」） |
| `79ac342` | SA7 动态验证归档 + AC 核对表（流程档案） |

**代码面实际触及**（wiki/raw/* 为流程档案，不计）：src 9 文件（新建 5 + 修改 4）、test 8 文件（新建）、AGENTS.md、README.md、package.json。**DENY 清单核验**：`git diff --name-only` 对 `schema.ts / record.ts / memory.ts / pipeline.ts / emission.ts / sink.ts / vocabulary.ts / crc32c.ts / digest.ts / schema-patterns.ts / canonical-json.ts / projection/** / packages/vfsl/** / pnpm-lock.yaml / 根 package.json` 全部为空 ✅；全仓无本包与 wiki 之外的改动 ✅。

**基准文件**：issue #152 全文（`wiki/raw/task_diagnostic-log-file-adapter.md:3-43`，含 SA6 Phase 1 验收锚定 §1–§5）；ADR 0012（354 行）与 ADR 0011；设计 R2（`…_design.md`，含总控 §11 G1–G6 + J9 裁决表）；AC 核对表（`…_ac_checklist.md`）；SA4 R1→R2 验尸（`…_sa4_review.md`）；SA7 动态报告（`…_sa7_report.md`）；上游 #148 冻结面源码。

**评审方法**：全量逐行审读 9 个 src 文件与 4 个既有文件 diff；测试用例名全量扫描核对 AC5 覆盖面；独立复跑 `npx vitest run --typecheck packages/namespace-diagnostic-log`（**18 文件 256 passed，Type Errors 0，exit 0**，本机 node v24.13.0，HEAD `79ac342`）；对唯一存疑点直打运行时 PoC 实证（脚本 `/tmp/spec-poc2.ts`，输出原文见 §五 F-1）。

---

## 二、任务指定核对项（逐条给证据）

### 1. manifest 14 键 vs ADR 0012「至少保存」清单 → ✅ 全覆盖

ADR 0012 §File adapter 布局（L46-53）六项最低要求 ↔ 实现 `buildManifest`（`src/adapters/file.ts:144-171`）：

| ADR 要求 | manifest 键 | 证据 |
|---|---|---|
| manifest format/version | `format:'ndcl-manifest'`、`version:1` | file.ts:156-157 |
| streamId、namespaceId、createdAt | 同左三键 | file.ts:158-160（createdAt = `observedAtFrom(clock.now)`，P_ISO_MS） |
| 完整 record schema VFSL 四键信封 | `schema: RECORD_SCHEMA_ENVELOPE`（恰四键逐字节内嵌） | file.ts:161；测试逐字断言 `toEqual(RECORD_SCHEMA_ENVELOPE)` + `text === RECORD_SCHEMA_TEXT`（layout.test.ts:138-140） |
| record、frame 与 schema 版本 | `recordVersion:1`、`frameVersion:1`、schema 版本在 `schema.version`（+`schemaId`/`schemaFingerprint` 身份钉死） | file.ts:162-165；指纹 === #148 冻结常量（layout.test.ts:146） |
| committed update capture、input capture policy | `committedUpdateCapture`、`inputCapturePolicy` | file.ts:166-167 |
| inline threshold 与 JSONL line 上限 | `inlineUpdateMaxBytes`、`jsonlLineLimitBytes` | file.ts:168-169 |

恰 14 键由 reader 门双向强制（键集精确相等，多余/缺失均拒：`reader.ts:76-91,107-109`）。owner/instanceId/replicationId/epoch 不进 manifest（ADR L55）✅。不可变性：唯一写点 `writeFileSync(…, { flag:'wx' })`（file.ts:588，grep 全仓确认无第二写点），emit 前后字节恒等有测试锚定（layout.test.ts:176）。

### 2. NDCL v1 25-byte 帧布局逐字节 → ✅ 与 ADR 0012 §Binary frame v1 逐字节一致

`src/frame.ts:53-74`（encode）/ `:85-108`（decode）逐字段核对：

| 字段 | 字节 | ADR 要求 | 实现 |
|---|---|---|---|
| magic | [0..3] | ASCII "NDCL" | `header.set([0x4e,0x44,0x43,0x4c])`（:54）✅ |
| frameVersion | [4] | 0x01 | `opts.frameVersion ?? 1`（:55，生产恒默认）✅ |
| payloadType | [5] | 0x01 = yjs-update-v1 | `?? PAYLOAD_TYPE_YJS_UPDATE_V1`（:56）✅ |
| flags | [6] | 0x00 | `?? 0`（:57）✅ |
| reserved | [7..8] | 0x0000 | BE 两字节（:58-59）✅ |
| sequence | [9..16] | uint64 BE | BigInt 逐字节 `>>` 大端（:60-61）✅ |
| payloadLength | [17..20] | uint32 BE | `>>> `四字节（:62-66）✅ |
| crc32c | [21..24] | uint32 BE | （:70-74）✅ |

frame 总长 `25 + payloadLength`；`frameOffset` 指向 magic 首字节、不存 frameLength（ADR L161）✅；v1 禁压缩、非零 flags/reserved/未知版本响亮 incompatible（reader/storage-gate 逐步短路，§二.6）✅。

### 3. CRC 输入域 → ✅ ADR 逐字

ADR L192：「CRC 输入是 header 前 21 bytes（magic 至 payloadLength）直接连接 payload，不包含 crc32c 字段」。实现：`encodeFrame`（frame.ts:67-70）与 `frameCrcOf`（:111-118）均为 `header[0..20]（FRAME_HEADER_BYTES−4 = 21）+ payload`；CRC 参数复用 #148 冻结 `crc32c.ts`（KAT `0xE3069283`，#148 已锚定）。inline 侧 8 位小写 hex 与 frame 侧 uint32 BE 同值两形（设计 §2.5）✅。

### 4. inline 阈值语义（≤ 阈值 inline）→ ✅ 精确

`file.ts:256`：`if (bytes.byteLength <= inlineUpdateMaxBytes) → inline`，与 AC2「at or below the configured threshold」逐字一致；边界 4096→inline / 4097→sidecar 与自定义 7↔8、N-1/N/N+1 三向测试锚定（inline-sidecar.test.ts:197-224）✅。默认 4096（ADR L140）✅。

### 5. BIN-first 顺序 → ✅

emission sidecar 路径：`appendFileSync(binPath, frame)` 成功后才 `appendFileSync(jsonlPath, line)`（file.ts:473-486）；bin 写失败 → `storage-write-failed{stage:'bin'}` + 丢弃，**JSONL 绝不引用未落盘帧**；jsonl 失败留 orphan frame（ADR L240 明文允许的崩溃窗口）✅。故障注入测试锚定（mismatch-interference.test.ts:159-228：EISDIR 占位 → 零 sidecar 引用 + 恢复后 reader ok）。frameOffset 恒 fresh stat（`statSync(throwIfNoEntry:false)` + `isFile()`，file.ts:249-252）——无内存-磁盘孪生状态，SA2 R1 #1 CRITICAL 的修复落地 ✅。

### 6. strict reader：incompatible/corrupt 划分与不近似解释 → ✅

- 七码 incompatible 集与 SA6 词表边界逐字（`reader.ts:63-71`）：`dialect-unknown / schema-fingerprint-mismatch / record-version-unknown / frame-version-unknown / frame-payload-type-unknown / frame-flags-nonzero / frame-reserved-nonzero`；其余全归 corrupt（聚合 `reader.ts:411-429`）。
- 不近似解释：任何 incompatible → `records: []` + status incompatible + **manifest 仍展示**（reader.ts:412-421；ADR L295「reader 可展示 manifest…但不得近似解释、跳过未知记录后继续声称连续」）✅。
- 校验面覆盖 AC4 全项：JSON parse（invalid-json）→ VFSL（vfsl-invalid，含 P_DECIMAL 镜像复核 sequence/frameOffset 两消费面——`reader.ts:372`、`:320`，先镜像后 `BigInt` 解析）→ streamId 交叉（stream-mismatch）→ inline 三步（base64-invalid/length/crc，`storage-gate.ts:53-63`）→ sidecar 15 步短路链（`storage-gate.ts:78-110`：reference-invalid → frame-missing → boundary → magic → version/type/flags/reserved → 越界 length → sequence → payloadLength → frame CRC → payload CRC）。
- 边界语义与 SA6 §2 逐字：首帧先验 magic、非首帧 offset ≠ 前帧 end → boundary-invalid 且判定先于 magic、失败帧不推进 expectedOffset（storage-gate.ts:86-110 + reader.ts:327-338）✅。
- stream sequence：跨 segment 严格递增（BigInt 比较，乱序/重复 → sequence-out-of-order），**gap 合法**（reader.ts:402-408；ADR L67「不证明业务尝试无缺」+ SA6 §5.2）✅。
- 绝不抛：全函数 try/catch 兜底 → corrupt + manifest-invalid（reader.ts:430-440）；敌意入参零 fs 触达 locator-invalid（:206-215，G5）✅。

### 7. genesis 形状 vs 冻结 schema → ✅ 一致

构造（file.ts:557-565）：`recordKind/streamId/sequence/observedAt/source:{kind:'local'}/update` 恰六键——与冻结 `GenesisBaselineRecord`（record.ts:123-131，context 可选缺省）一致；无 attemptId/operation/stage/result/input（SA6 §3 锚定）✅。运行时反证：genesis 记录必须过与 attempt 同一 VFSL 门（writeRecord 共用管线），genesis 测试（含大 update 走 sidecar offset 0）全绿 → 冻结 schema 接受该形状 ✅。#148 遗留风险 1（genesis 构造路径由 #152 adapter 内部增设、不改 schema）按预期闭合，schema.ts 零 diff ✅。

### 8. 健康事件词表演进只增不改 → ✅

`git diff` 显示 health.ts 既有 8 成员零改动（仅联合头注释更新为「8 + 4」表述），末尾追加 4 成员（health.ts:58-82）：SA6 契约三成员逐字（stream-init-failed 四 reason / storage-validation-failed / storage-write-failed 四 stage）+ 总控 J9 裁决第四成员 `{ type:'stream-exhausted' }`（零附加字段）。演进方式 = 联合成员追加，与 #148 §8.1 备案一致；设计 §14 审计（无 exhaustive switch、包外零消费者）成立。`vfsl-validation-failed` 事件只带 issuePaths/schemaId/指纹/字节数（file.ts:415-425，#148 §8.2 纪律）✅。errno 提取 `(err).code` string 原样、否则 `'EUNKNOWN'`（file.ts:119-122）——不含底层 message ✅。

---

## 三、AC 逐条结论

| AC | 结论 | 关键证据（除 §二已列外） |
|---|---|---|
| AC1 不可变 manifest + 原子 locator | ✅ 全满足 | current.json 恰三键 + temp+rename（file.ts:606-619）；失败仅事件不禁用 + tmp best-effort 清理（SA2 #9 落地）；6 种敌意 namespaceId → 零 fs 触达 + 恰一次 stream-init-failed + emit 不抛（layout.test.ts:213-236；file.ts:623-625 文法检查先于 mkdir） |
| AC2 ≤阈值 padded standard Base64 + payloadLength + CRC32C；>阈值 NDCL v1 + 关联引用 | ✅ 全满足 | §二.2/3/4；inline 恒 padding 标准 Base64（`buildInlineCarrier`，Buffer 编码收口 carrier.ts）；sidecar 引用含 segment/frameOffset(十进制串)/payloadLength(JSON number)/crc32c（file.ts:265-275，冻结形状 record.ts:82-89） |
| AC3 append 前过内建 VFSL + storage 校验；frame 先于引用 | ✅ 全满足 | writeRecord 门序：line 预算 → VFSL 门 → P_DECIMAL 镜像 → storage 门 → 落盘（file.ts:384-497）；注入接缝 `injectFinalRecordFile` 同门序、零落盘四类违规有测试锚定（mismatch-interference.test.ts:52-140）；BIN-first 见 §二.5 |
| AC4 strict reader 全校验面 + 不近似解释未知版本 | ✅ 全满足 | §二.6；incompatible 6 类 + corrupt 15 类测试锚定（strict-reader.test.ts 27 用例）+ R-1a/R-1b 差分锚定（r2-supplemental.test.ts:311-376） |
| AC5 公共测试覆盖（round trip / 阈值边界 / 全 result 分支 / malformed / envelope mismatch / 非干扰） | ✅ 全满足 | 6 测试文件 92 用例（用例名全量扫描核对）：8 result 分支逐字段（genesis-results.test.ts:51-152，含总控勘误 `idx===1?'fatal':'committed'`）；三守卫 update-omitted 保 metadata；envelope 不匹配 → 新 generation + 旧 manifest 字节恒等 + 旧 segments 零写入 + 旧 stream reader incompatible（mismatch-interference.test.ts:256-294）；observer 必 throw 不外溢 + fallback 稳定码行（:230-254）；**独立复跑 256/256 全绿** |

**缺失/部分需求：无。** ADR 0012 范围切分遵守：writer 恒写 segment `00000001`（rolling 归 #153）；resume 只做指纹匹配检查、四分支全落新 generation（§3.4 论证 + 总控 G1 裁决——「#152 无安全续写能力 → 恒新建」是 ADR L22「旧 stream 无法安全续写…时建立新 stream」的诚实适用）；retention（#154）/replay（#155）零触碰 ✅。已裁决形态选择（同步写 J1 / 无队列 G6 / 匹配静默 G1 / genesis 守卫豁免 G10 / exhausted 事件 J9）全部有总控裁决记录并按裁决落地，不计偏差。

---

## 四、Scope creep 核对

| # | 级别 | 事项 | 证据与判定 |
|---|---|---|---|
| S-1 | INFO（备案） | `package.json` version 0.1.0→0.1.1 触及设计 §12 DENY 清单文件 | diff 仅 version 一行；commit `e311326` 记录为总控「硬门禁 9（Phase 4 前置）」动作；`private:true`、零依赖/exports 变化。DENY 的立法意图（零新增依赖）未受损；属设计定稿后总控门禁的显式动作，**非 SA 擅动**，登记备查 |
| S-2 | INFO | index.ts 额外导出 `type StrictReadRequest`（SA6「导出面固定」五名之外） | index.ts:80；`readStreamStrict` 入参类型的必然伴随导出；SA4 §四.8 已判定「无害提取」。零运行时面 |
| S-3 | INFO（已裁决） | `storage-validation-failed.code` 第 6 值 `vfsl-invalid` | SA4 R1 R-2 修复轮引入；SA4 R2 复核「总控在修复轮指令中已明确该形状——合规」；类型为开放 `string`、复用 reader 23 码既有值（同 G3 原则）；health.ts:67-72 注释已同步 6 值集（e311326 关闭 SA4 backlog N-1） |
| S-4 | ✅ 合规 | 第 6 个测试文件 `file-adapter-r2-supplemental.test.ts` | 设计 §9「R2 补充测试映射」（SA2 R1 红灯构想）授权，SA3 落地；非断言逻辑改动 SA6 五文件 |

**结论：无未经裁决的 scope creep。** 既有文件（carrier/health/index/testing/AGENTS/README）全部只增不改；#148 冻结面与 packages/vfsl/** 零触碰（SA4 实证 vfsl 引擎 alternation 缺陷仍在原样——根因正确归上游票，本票以消费者侧镜像兜底，见 F-3 关联注记）。

---

## 五、疑似错误行为 / 字面·语义偏差（发现清单）

### F-1（MINOR）genesis 路径消耗 UINT64_MAX 不触发 exhausted 转换——超域 sequence 2^64 可静默落盘（PoC 实证）

- **位置**：`src/adapters/file.ts:545-566`（`runGenesis` 直接 `allocate()`，无 `sequence === UINT64_MAX` 判定）对照 `:505-510`（`appendSemantic` 的转换逻辑只存在于 emit 路径）。
- **规范依据**：ADR 0012 §JSONL record（L67）「达到 uint64 最大值后 stream 进入 exhausted，后续日志 emission 丢弃并上报」；设计 §4.2 R2 注（design.md:371-372）明示「预置 + genesis 组合时转换时刻**可能在构造期触发**」——实现未触发；总控 J9 裁决「转换时刻 = 产出 UINT64_MAX 的 sequence 分配完成……此后所有 append 走首行分支静默丢弃」未限定 emit 路径。
- **PoC 实证**（`/tmp/spec-poc2.ts`，HEAD `79ac342`，node v24.13.0，原文输出）：
  ```text
  [A1] genesis 后事件: []                                    ← 预置 UINT64_MAX−1 + genesisUpdateBytes：
  [A2] emit(inline) 后 sequences: ["18446744073709551615","18446744073709551616"]
  [A3] 事件: []                                              ← 2^64 超域 sequence 落盘且零事件（门闩永不置位）
  [B1] sidecar emit 后 sequences: ["18446744073709551615"]   ← sidecar 变体被写帧自检兜住（丢弃 +
  [B2] 事件: [{"type":"storage-validation-failed",…,"code":"crc-mismatch"}]   响亮但码值误导，门闩仍不置位）
  [C1] 无 genesis 对照 sequences: ["18446744073709551615"]
  [C2] 对照事件: ["stream-exhausted"]                        ← 无 genesis 时行为完全正确（恰一次 + 后续静默丢弃）
  ```
- **影响面**：仅经 testing 接缝 `createFileDiagnosticLogPresetSequence` + `genesisUpdateBytes` **组合**可达；生产物理不可达（约 1.8×10¹⁹ 次 append）；R2 既有锚定测试（r2-supplemental.test.ts:187）不携带 genesisUpdateBytes，故绿灯掩盖该组合。inline 变体后果最重（超域 sequence 静默落盘，reader 侧 BigInt 解析/P_DECIMAL/严格递增全部不拒——2^64 字典序与数值序均合法通过）。
- **建议**：回流总控裁量——最小修为 `runGenesis` 的 `allocate()` 后补同款 `=== UINT64_MAX` 转换块（约 4 行），或裁决「testing 接缝组合不补」并登记 backlog。不阻断本票（无 AC/生产路径受影响）。

### F-2（MINOR）`paths.ts` 实际 import `node:path`，与三处「零环境绑定 / node:path 仅两模块」声明字面矛盾

- **位置**：`src/paths.ts:12`（`import { join } from 'node:path'`）vs ① 本文件头注 :1-2「纯 TS、零环境绑定」；② 设计 §1.1/§1.5「其余新模块（frame/paths/storage-gate）零环境绑定（纯 TS）」「node:fs/node:path 唯一 IO 面 = file.ts/reader.ts」；③ 本 diff 改写的 `AGENTS.md:37-38`「`node:fs` / `node:path` 仅出现于 `src/adapters/file.ts` 与 `src/reader.ts`」。
- **判定**：行为零影响（`join` 是纯计算、无 IO；包本就经 digest.ts 绑定 Node）；IO 收口的设计意图（读写盘只在 file.ts/reader.ts）保持完好——但 AGENTS.md 作为本 diff 改写的边界合同，其字面声明自交付起即不成立。属文档/声明一致性缺陷：一行声明修正（paths.ts 增列为 node:path 消费方）或以字符串拼接替代 `join` 即可闭合。顺带指出：设计 §1.1「paths.ts 零包内依赖（叶子）」与 §10-J12「paths.ts 复用 schema-patterns 常量」在设计上已自相抵牾（实现按 J12 落地，正确），F-2 是同一声明粗心的延续。

### F-3（MINOR）`StrictRecordRead` 缺 SA6 锚定的 `recordKind` 字段——公共契约形状偏差未走 §11 缺口登记/裁决

- **位置**：SA6 契约（任务简报 L104-105）`interface StrictRecordRead { sequence; recordKind: 'attempt' | 'genesis-baseline'; ok; issues; record }`；实现 `reader.ts:42-50` 仅 `{ ok; record; sequence; issues }`——**`recordKind` 被静默去掉**；设计 §7 的 recordRead 形状同步缺失该字段，且 §11 缺口表无登记、无总控裁决记录。
- **缓冲事实**：(a) SA6 红灯测试不消费该字段（grep 实证 strict-reader 测试零引用），故红灯/绿灯均不可见；(b) SA6 形状对 invalid-json 行本不可满足（JSON 不可解析时 recordKind 不可知而类型非可选）——实现的取舍在工程上合理，且可解析行的 recordKind 可由 `record.recordKind` 导出；(c) 其余 SA6 形状（StrictStreamRead/StrictReadIssue/导出面/config）逐字段对合无偏差。
- **判定**：功能影响低、但属「分歧走总控裁决」流程的漏登记。建议总控一句裁决背书现状（或补字段为可选），并回写设计 §11。

### F-4（INFO）数值配置项无校验（未锚定域，登记备查）

`inlineUpdateMaxBytes` / `lineBudgetBytes` / `payloadMaxBytes` 直接取值（file.ts:218-220），NaN/负数/分数无守卫。极端形态：`lineBudgetBytes: NaN` → `bytes > NaN` 恒 false → 预算门失效，且 manifest 冻结 `jsonlLineLimitBytes: null`（JSON.stringify(NaN)）→ 自家 strict reader 判 `manifest-invalid`/corrupt（G8 严格形反向咬合一贯）。issue/ADR/SA6/设计均未锚定配置校验要求；误配置经健康事件/reader 可诊断、非静默腐化。登记为 INFO，供后续票裁量。

---

## 六、结论

**Verdict：pass-with-issues**

理由：
1. **五条 AC 全部完整实现且证据链充分**（§三），无缺失/部分需求；ADR 0012 本票范围内条款逐条对合（§二 八项指定核对全过），范围切分（#153/#154/#155）零越界。
2. **全部形态级偏离均有总控裁决记录**（G1–G6/J9/J1 同步写等），无擅自背离；#148 冻结面与上游语义零改动（diff 实证）。
3. 独立复跑 18 文件 256 测试全绿 + Type Errors 0（HEAD `79ac342`），AC 核对表与 SA4/SA7 的绿灯声明属实。
4. 四项发现（F-1/F-2/F-3 MINOR、F-4 INFO）均不触及 AC 与生产可达路径：F-1 为 testing 接缝组合边缘的 ADR exhausted 条款偏差（PoC 实证，建议 4 行最小修或裁决登记）；F-2 为边界声明与代码的一行级不一致；F-3 为公共契约字段的流程性漏登记（现状工程合理）；S-1/S-2/S-3 均已备案/裁决。

**回流建议（交总控裁量，不阻断发布）**：F-1 补 genesis 路径 exhausted 转换块或裁决不补；F-2 修正 AGENTS.md/design §1.5 声明；F-3 裁决 `StrictRecordRead.recordKind` 现状并回写 §11；F-4 记入 backlog。

---

# R 轮（修复后复审，repair-and-repeat）— 2026-08-28

- **复审范围**：更新后 diff `git diff 7ceede1..HEAD`（HEAD = `a811f06`；修复轮 = `0bbb17a`「genesis exhausted latch + final review closure (G13 F-1, standards N-1..N-7)」+ `a811f06` wiki 派遣日志归档）。修复轮代码面：`src/adapters/file.ts`（+8/−1）、`src/paths.ts`（头注）、`AGENTS.md`（绑定面 + 白名单）、`test/file-adapter-r2-supplemental.test.ts`（+80，3 条新锚定）、`test/helpers/file.ts`（N-7 去重）+ wiki（设计 §1.5 R3 勘误行 + §11 追加 G11/G12/G13 裁决表、SA3 修复轮报告、简报 N-6 勘误）。
- **R 轮 Verdict**：**pass**（F-1/F-2/F-3/F-4 全部按裁决闭合，独立实证；无新问题引入；附 1 条非阻塞残余注记）

## R.1 F-1（G13 必修）修复正确闭合 —— PoC 原场景重跑实证 ✅

修复内容（`file.ts:549-556`）：`runGenesis` 在 `allocate()` 后、守卫检查**之前**补 `sequence === UINT64_MAX` 转换块——置 `exhaustedLatch` + 恰一次 `notify({type:'stream-exhausted'})`，genesis record 照常走门落盘，此后 append/注入静默丢弃。放置点正确（J9「分配完成即触发，无论该 record 后续守卫/门/落盘成败」——先于守卫即覆盖「守卫跳过也消耗 UINT64_MAX」形态）；与 attempt 路径同一门闩语义，无第二套逻辑。

本评审 R1 的 PoC（`/tmp/spec-poc2.ts`，未改一行）原样重跑，前后对照：

| PoC 场景 | R1（修复前实测） | R 轮（修复后实测，HEAD `a811f06`） | 判定 |
|---|---|---|---|
| A：预置 max−1 + genesis，再 inline emit | genesis 后零事件；2^64 超域 sequence **落盘**、零事件 | genesis 后恰一次 `stream-exhausted`；JSONL 仅 `[UINT64_MAX]`；`2^64 落盘 = false` | ✅ 闭合 |
| B：同预置，sidecar emit | 写帧自检兜住但码值误导（`crc-mismatch`），门闩不置 | 门闩已置 → 静默丢弃、零误导事件（J9「此后静默」正语义） | ✅ 闭合且语义净化 |
| C：无 genesis 对照（既有锚定路径） | 恰一次 `stream-exhausted` + 后续静默 | 逐字同前 | ✅ 零回归 |

新增锚定测试（r2-supplemental.test.ts:380-406）与 PoC 同构且为**差分锚定**（断言 genesis=UINT64_MAX 落盘 + 事件恰一次 + 后续 emit 零落盘 + reader ok——在未修复代码上「后续 emit」会落 2^64 而使 `toHaveLength(1)` 失败），非 vacuous。

## R.2 F-2（N-1）声明同步属实 ✅（附 1 条残余注记）

三处同步逐一核验：
1. `paths.ts:1-4` 头注改为「唯一环境依赖：`node:path` 的 `join`……零 node:fs」——属实（`:12` import 唯一）✅；
2. `AGENTS.md:37-39` 拆分声明：`node:fs` 限 file.ts/reader.ts（唯一 IO 面）、`node:path` 列 file/reader/**paths** 三模块并标注 N-1 勘误——与 grep 实证（`node:fs` = file.ts+reader.ts；`node:path` = file.ts+reader.ts+paths.ts）一致 ✅；
3. 设计 §1.5 表新增 paths.ts 独立行 + R3 勘误标注（R2 的「paths 零环境绑定」误列已明文更正）✅。

**残余注记（INFO，非阻塞）**：设计 §1.1 模块清单注释行（:41「paths.ts……纯 TS」）与依赖图行（:57「paths.ts……零包内依赖（叶子）」——后者本即与 §10-J12「paths.ts 复用 schema-patterns 常量」相抵，R1 已指出）未在本轮同步。规范性声明面（§1.5 表 + AGENTS.md + 模块头注）已全部属实，§1.1 两处为注释级松散措辞，留待下次文档触碰时顺带即可。

## R.3 F-3（G11）/ F-4（G12）裁决回写核验 ✅

设计文末新增「总控裁决（2026-08-28，双轴终审回流——§11 追加）」表：G11 背书 `StrictRecordRead` 不携带 `recordKind` 现状（流程漏登记补登记，理由与 R1 缓冲事实一致）；G12 数值配置校验不增加、登记已知限制（入 REPORT 遗留风险）；G13 F-1 必修。F-3/F-4 按裁决闭合，无需代码变更 ✅。

## R.4 修复有无引入新问题 → 未发现 ✅

- **门闩语义全路径核对**：构造期置闩后 `mode='ready'` 正常完成；`appendSemantic`（file.ts:502）与 `appendFinal`（:532，注入路径）首行均检查 `exhaustedLatch` → 静默丢弃；「无分配即无转换」（注入不触发新事件）与「转换后一律丢弃」两纪律同时保持 ✅。
- **测试增量质量**：N-3（file adapter line 预算降级分支首锚定：512B 预算 + full 4KiB input → `input-degraded{fromPolicy:'full'}` + 落盘 digest 降级形 + reader ok）、N-4（不存在 rootDir 证伪 fs 先行——`locator-invalid` ≠ `manifest-invalid` 的零 fs 触达证明）均为真实行为断言、非 vacuous ✅。
- **N-7 去重等价性**：`helpers/base.ts:96` 与被删本地副本逐字同签名同实现；file.ts 本已单向 import base.ts（OBSERVED_AT），无循环 ✅。
- **AGENTS.md 白名单补 `code`**（N-2）：与已交付事件形状（stream-init-failed.code / storage-*.code）一致，文档追认真实行为 ✅。注释笔误修复（N-5）、死引用修复（N-6）均为 wiki/注释级 ✅。
- **DENY 清单**：本轮 diff 对冻结面/vfsl/lockfile/package.json 仍全空 ✅。

## R.5 独立复跑

`npx vitest run --typecheck packages/namespace-diagnostic-log`（HEAD `a811f06`，node v24.13.0）：**18 文件 259 passed（256+3 新锚定），Type Errors 0，exit 0**——与总控亲验声明一致。

## R 轮结论

R1 全部 4 项发现按总控 G11/G12/G13 裁决闭合（F-1 必修已修且 PoC 级实证、F-2 声明已同步、F-3/F-4 裁决回写）；3 条新锚定真实差分触发；259 全绿零回归；无新问题。**当前生效 verdict：pass**（残余：设计 §1.1 两处注释级措辞未同步——INFO，不阻塞）。
