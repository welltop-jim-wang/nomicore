# AC Checklist — issue #148 `@nomicore/namespace-diagnostic-log`（SA7 验收）

- worktree: `/home/wangjian/nomicore-fix-issue-148`（branch `fix/issue-148-on-docs-namespace-diagnostic-change-log`）
- 验收标准原文：`wiki/raw/task_diagnostic-log-v1-contract.md` §验收标准（5 条，逐字）
- 证据基线：`pnpm test` 全仓 exit 0（130 files / 1557 tests / Type Errors 0，`.mabf-bg/sa7-test.log`），其中新包 12 个测试文件 152 用例全绿（log 内逐文件 ✓）
- 设计基线：`task_diagnostic-log-v1-contract_design.md`（R4）；ADR 0011/0012
- 汇总结论：**5/5 pass**

| # | 验收标准（原文摘要） | 结论 |
|---|---|---|
| AC1 | 语义 emitter 接受全部冻结 v1 operation 与 result 分支；不暴露 JSONL/Base64/segment/frame/offset/retention | ✅ pass |
| AC2 | 输入捕获 none/digest/redacted/full 四策略；只消费既有安全快照；拒绝/失败不重读 | ✅ pass |
| AC3 | issues 与可变尺寸字段在文档化 UTF-8/count/path/line 预算内确定性投影，含降级 digest | ✅ pass |
| AC4 | 内建冻结 VFSL 信封校验最终 record；校验/observer 故障只走低基数健康 observability | ✅ pass |
| AC5 | 有界 memory/test adapter 饱和 drop newest、保序、永不 throw/阻塞；契约测试覆盖全部分支与故障隔离 | ✅ pass |

---

## AC1 — 语义 emitter 全词表接纳 + 零物理细节暴露 → **pass**

**原文**：语义 emitter 接受全部冻结 v1 operation 与 result 分支的 detached namespace change-attempt 结局，不向 producer 暴露 JSONL、Base64、segment、frame、offset 或 retention 细节。

| 证据 | 位置 | 断言内容 |
|---|---|---|
| result 8 变体全矩阵 | `test/record-vocabulary.test.ts:71-190`（§9.1） | committed+noop/update/update-omitted、rejected、fatal×committed:false、fatal×committed:true×unknown/update/update-omitted 逐字段断言；rejected 与 fatal+false 无 update 键（117-135，封闭性回归锚）；dirty-notification 可表达（176-190） |
| operation 6 值矩阵 | `test/record-vocabulary.test.ts:192-204` | 全部 6 operation 各至少一次被接纳 |
| 语义 record 形状 | `test/record-vocabulary.test.ts:16-47` | sink 收到 DiagnosticSemanticRecord：无 streamId/sequence/recordKind 物理字段 |
| 运行时物理键缺席 | `test/record-vocabulary.test.ts:216-227` | 最终 record 无物理字段 |
| **编译期物理键黑名单** | `test/identity.test-d.ts:70-102`（R2/F-c2） | Emission 与 EmissionResult 键集 ∩ {base64,segment,frameOffset,crc32c,payloadLength,storage,retention} = ∅；excess-property 拒绝（90-102）；UpdateCarrier 合法拥有物理键（非空转正例，79-89） |
| intake 违规隔离 | `test/record-vocabulary.test.ts:229-259` | 10 类违规 → emission-dropped，不消耗 sequence |
| 设计依据 | 设计 §2.1/§2.6/§9.1/§9.10-R2/F-c2；ADR 0011 §Interface | — |

## AC2 — 输入捕获四策略 + 零重读 → **pass**

**原文**：输入捕获支持 none/digest/redacted/full 四种策略，只消费既有安全快照；input 前拒绝与不安全快照失败不得重读调用方输入。

| 证据 | 位置 | 断言内容 |
|---|---|---|
| 决策表全格 | `test/input-capture.test.ts:22-90`（§9.3/§5.1） | 省略/`not-accessed`/`unavailable`/`unsafe-input`/`{snapshot}` 五输入行 × none/digest/redacted/full 四策略全组合的 capture 断言；「事实优先于策略」四列皆同 |
| digest KAT | `test/input-capture.test.ts:92-152` | RFC 8785 向量（键序 UTF-16、数字 String()、转义、lone surrogate）canonical 文本逐字断言 + SHA-256 标准向量 + lone surrogate 确定性 digest（3ac71dce…） |
| redacted 算法 | `test/input-capture.test.ts:154-179` | 叶值→`«redacted»`、null 保留、结构保形；digest 恒为全量快照摘要（§10-J7） |
| 1M 节点护栏 | `test/input-capture.test.ts:181-188` | >1,000,000 节点 → unavailable + input-projection-failed |
| **不重读（单触达探针）** | `test/input-capture.test.ts:190-227` | symbol/bigint/function/非有限数 → unavailable；**同一敌意 getter 只触达一次**（212-227） |
| none 不触碰快照 | `test/input-capture.test.ts:59-63` + `src/projection/input.ts:72-75` | 策略 none 时快照不被遍历 |
| 设计依据 | 设计 §5.1-§5.4、§10-J7；ADR 0011 §输入捕获 | — |
| SA7 动态复核 | `.mabf-bg/sa7-perf.mts` B/C 段 | 1.000005M 节点与 60k 深嵌套快照各 emit 一次 → capture=unavailable + 恰一次 input-projection-failed 事件，无重读、无崩溃（exit 0） |

## AC3 — 可变尺寸字段确定性投影 + 降级 digest → **pass**

**原文**：issues 与其他可变尺寸字段在文档化 UTF-8、count、path、line 预算内确定性投影，含按要求降级 digest。

| 证据 | 位置 | 断言内容 |
|---|---|---|
| message 4 KiB 预算 | `test/issues-projection.test.ts:24-75` | 恰 4096B 不截断 / 4097B 截断且序列化 ≤4096；多字节骑界不拆 code point；逐单位 KAT（lone surrogate 6B、`\n`/`"` 2B、astral 4B）；1365 lone surrogate 8190B → 截断（67-75） |
| path/count/code 预算 | `test/issues-projection.test.ts:77-121,140-147` | path 257 段保前 256；string 段 1025B→1010B 前缀+14B marker；1001 条保前 1000；code 256B；truncated/originalCount 同现同缺（R4/C-3） |
| 段级 JSON-safe | `test/issues-projection.test.ts:149-198` | NaN/±Infinity/undefined 段整条丢弃 + enrichment-field-dropped 恰一次；-0 归一 |
| 策略投影 | `test/issues-projection.test.ts:123-139` | redacted：message→`«redacted»`、code/path 保留；none：空 items |
| **line 预算降级 digest** | `test/line-budget.test.ts:13-54` | full/redacted 超预算 → input 降级 digest+degraded + input-degraded 事件（fromPolicy），record 仍接纳 |
| 仍超限丢弃 | `test/line-budget.test.ts:56-82` | digest-only 超限 → record-dropped/line-budget-exceeded + 诚实 sequence gap |
| R4 marker 14B | `test/issues-projection.test.ts:87`（"前缀 1010B + marker 14B"）、设计 §6.1:798 | R4/C-4 勘误落地（U+2026 精确 3B 记账，无 2B 特例） |
| 设计依据 | 设计 §6.1/§6.2/§5.5；ADR 0012 §投影 | — |
| SA7 动态复核 | `.mabf-bg/sa7-c4-demo.mts`（exit 0） | `'…'.repeat(2048)` 字面量 6144B → 确定性截断至 4094B、结尾 marker、truncated=true、两次 emit 逐字节相同、record 接纳 |

## AC4 — 内建 VFSL 信封校验 + 低基数健康面 → **pass**

**原文**：内建冻结 VFSL 信封校验最终 v1 record；校验或 observer 故障只经低基数 logger 健康 observability 上报。

| 证据 | 位置 | 断言内容 |
|---|---|---|
| 指纹钉死 | `test/vfsl-gate.test.ts:36-57` + `test/schema-freeze.test.ts:25-45` | envelopeFingerprint === `sha256:v1:dedad2ab…e070`；RECORD_SCHEMA_ENVELOPE 恰四键（lang/version/id/text）与编译产物同源 |
| 9 类违规注入 | `test/vfsl-gate.test.ts:59-110` | 坏 streamId/词表外 operation·stage/rejected 带 update/多余顶层键/坏 Base64/坏 CRC/坏 ISO/digest 缺 → 丢弃 + 不 throw + vfsl-validation-failed 事件**只含 issuePaths**（≤10、`$.` 前缀） |
| **白名单键集** | `test/vfsl-gate.test.ts:101-108` | 事件键集 ⊆ §8.2 低基数白名单；无 record/input/Base64/message/stack |
| 外部一致性 | `test/schema-freeze.test.ts:47-146` | §9.1 全 record 形状复跑 validateLogicalSnapshot + JSON round-trip 孪生不变量 |
| failed 模式 | `test/vfsl-gate.test.ts:165-204` | 坏 envelope → 构造期恰一次 schema-compile-failed + 后续全丢弃 + 无逐条事件 + 无串扰 |
| **observer 故障隔离** | `test/observer-isolation.test.ts:14-95` | observer 每 throw → emit 不 throw、record 照常入队、fallbackLog 稳定码行；fallbackLog 自身 throw 仍不外抛（67-87）；健康事件不入队列（89-95） |
| 设计依据 | 设计 §3/§8.1-§8.3、§11-G4；ADR 0012 §VFSL record schema | — |
| SA7 独立复现 | `.mabf-bg/sa7-fingerprint.mts`（exit 0） | 干净 tsx 进程从公共面导入：指纹 === 期望值、恰四键、深冻结 |

## AC5 — 有界 adapter：drop newest / 保序 / 永不 throw / 全分支覆盖 → **pass**

**原文**：有界 memory/test adapter 饱和时 drop newest、保持已接纳顺序、永不 throw 或阻塞 producer；契约测试覆盖全部 result 分支与故障隔离。

| 证据 | 位置 | 断言内容 |
|---|---|---|
| 饱和 drop newest | `test/memory-adapter.test.ts:14-64` | capacity=3 + 6 条：前 3 保序、后 3 drop newest + queue-full 事件 + stats 对账；drop 绝不入队（43-53）；capacity=1 已接纳不变（56-64） |
| 顺序保持 | `test/memory-adapter.test.ts:66-78` | 交错 operation 接纳序 == sequence 升序 |
| 只读快照 | `test/memory-adapter.test.ts:80-94` | records() 数组与 record 冻结（变异抛 TypeError） |
| stats 对账 | `test/memory-adapter.test.ts:96-126` | accepted=queueDepth、lastSequenceAssigned string\|null、实例隔离 |
| 同步无 IO | `test/memory-adapter.test.ts:128-140` | 批量 emission 同步完成且全部孪生合法 |
| sequence 纪律 | `test/identity.test.ts:82-131` | 十进制字符串进位直测；uint64 max 邻域 exhausted 模式（丢弃+计数+事件抑制+不 throw） |
| 全 result 分支覆盖 | `test/record-vocabulary.test.ts:71-190`（AC1 同源矩阵） | 8 变体全断言 |
| 故障隔离覆盖 | `test/emitter-isolation.test.ts`（敌意输入）、`test/observer-isolation.test.ts`（observer 故障）、`test/vfsl-gate.test.ts:165-204`（schema failed 模式） | — |
| 设计依据 | 设计 §7.1/§7.2、§4.3；ADR 0012 §Writer | — |
| SA7 动态复核 | `.mabf-bg/sa7-perf.mts` A 段 | 1024 连续 emit（24 预热+1000 计时）零丢弃零异常，全程同步（无 await/IO），mean 3.0ms/emit |

---

## 结论

5/5 pass。每条标准同时具备：机器断言锚（文件:行）、设计/ADR 章节依据、SA7 独立动态复核（指纹探针 / 性能探针 / C-4 演示，均 exit 0）。无 fail 项；发现的非阻塞事项见 `task_diagnostic-log-v1-contract_sa7_report.md` §发现。
