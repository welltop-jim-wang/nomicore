# SA2 攻击评审报告 — issue #148 设计（R1.1）

- **Date**: 2026-08-28
- **Reviewer**: SA2（设计对抗评审）
- **对象**: `wiki/raw/task_diagnostic-log-v1-contract_design.md`（R1.1，1075 行）
- **任务类型**: Feature（冻结 v1 diagnostic record 契约 + 有界内存 adapter）
- **总 Verdict**: **reject（轻量修订后放行）**——2 个 blocker（G-b1、C-b1）均为设计文档级小改；核心架构（词表、schema、管线切分、失败隔离）经逐字核对成立，无需结构性返工。
- **裁决边界**：§11 六项总控裁决（G1–G6）不重审；本报告只攻击其落地方式。

---

## 0. verdict 汇总表

| 攻击面 | verdict | 一句话理由 |
|---|---|---|
| A. 规格符合性 | **concern** | 词表/结局/阶段/零重读/数据保护逐字对齐成立；sequence uint64 耗尽语义缺失、`update-capture-disabled` 未入受控词汇表（均为小改） |
| B. VFSL schema 可编译性 | **pass** | 逐字段核对 v1-spec 文法 + pattern.ts/validate.ts 实际实现：全部 Pattern 可编译可判定、判别联合仅失速不失正确、无 E309/E311/E305/环/保留名命中 |
| C. 类型与 schema 孪生一致性 | **blocker** | issues[].path 的 number 段允许 NaN/±Infinity：VFSL 放行（typeof 判定）而 JSON 序列化为 `null`——「内存 JSON 与 #152 JSONL 逐字段同构」承诺被击穿 |
| D. 管线完备性 | **concern** | BigInt/敌意 getter/undefined 可选字段/deep-freeze×Uint8Array 均有兜底或被引擎语义吸收；但 0 字节 updateBytes 会产出 schema 无法表达的 inline carrier、genesis record 在冻结 sink 面无构造路径 |
| E. 算法确定性 | **concern** | JCS/截断/边界条件总体确定；truncateUtf8 在预算 <13B 时静默超预算、lone surrogate 的「预算字节数」在序列化前后二义 |
| F. 测试可落地性 | **concern** | §9 与 AC1–AC5 映射完整、VFSL 注入接缝足够；`schema-compile-failed` failed 模式无注入接缝成死代码、AC1「不暴露物理细节」缺直接类型锚 |
| G. 切片纪律 | **blocker** | ALLOW LIST 遗漏 `pnpm-lock.yaml`——CI `pnpm install --frozen-lockfile` 在 install 步即红，全部测试无法落地；其余（vitest include、typecheck、workspace 通配）已核实无需改动且设计正确未列 |

---

## 1. 攻击点清单（concern / blocker 全量）

| # | 严重度 | 攻击面 | 具体漏洞 | 修复建议 |
|---|---|---|---|---|
| G-b1 | **blocker** | G 切片纪律 | ALLOW LIST 未含 `pnpm-lock.yaml`，新包依赖必改 importers，CI frozen-lockfile 必红 | ALLOW LIST 增补 `pnpm-lock.yaml`（仅新包 importer 差异） |
| C-b1 | **blocker** | C 孪生一致 / D 管线 | issues[].path number 段 NaN/±Infinity 通过 VFSL 但 `JSON.stringify` → `null`，#152 落盘即产生 strict reader 必拒的坏行 | §6.2 有效性判定升级为段级 JSON-safe（string 或 finite number），畸形段随条目丢弃 + 既有事件 |
| D-c1 | concern | D 管线 | `updateBytes.length === 0` → base64 `""` 不匹配 P_BASE64（其尾部组强制非空）→ 记录被当 writer bug 丢弃 | physicalize 前置守卫：0 字节 → `update-omitted` 新稳定 reason（或 intake 拒绝），二选一写死 |
| D-c2 | concern | D 管线 / G 边界 | `GenesisBaselineRecord` 在冻结的 emission/sink 公共面无构造路径，与「#152 复用同一管线只换 sink」自述矛盾 | §10-J1 补备案：#152 需扩 sink 语义或走内部直通构造；修正 §1.3 复用声明 |
| A-c1 | concern | A 规格符合 | ADR 0012 明文 sequence 达 uint64 最大值 → exhausted + 丢弃上报；设计无该分支、事件词表无对应 reason、JS number 超 2^53 失精 | sequence 以十进制字符串自增（或声明内存路径上限），并在 §8.1 预留/备案 exhausted reason 的 #152 扩展 |
| E-c1 | concern | E 确定性 | `truncateUtf8` 在 budget < 13B（marker 长度）时 target 为负 → cut=0 → 输出 13B marker，静默超预算 | 入口 loud 断言 `budget ≥ marker 字节数`（或定义确定性行为）+ 红灯测试 |
| E-c2 | concern | E 确定性 | 预算按序列化前字符串的 UTF-8 计，lone surrogate 计 3B（U+FFFD 替换）而 JSONL 转义后 6B——「4 KiB message」在两种表示下不一致 | §6.1 明文规定预算基准（建议 `Buffer.byteLength(JSON.stringify(s))-2`，或声明按替换语义并接受 JSONL 行更大），补 KAT |
| F-c1 | concern | F 测试 | `schema-compile-failed` failed 模式（§4.2/§8.1）无法注入（schema 为内建常量）、§9 无锚 → 冻结公共面上的死代码 | testing 子路径加 envelope 注入工厂，或在 §10 明文接受不可测并降级该事件为内部信号 |
| F-c2 | concern | F 测试 | AC1「不向 producer 暴露 JSONL/Base64/segment/frame/offset/retention」无直接锚 | §9.10 test-d 补一条 emission/EmissionResult 类型键位黑名单断言（`expectTypeOf` 键集合） |
| A-c2 | concern | A 规格符合 | `update-capture-disabled` 为设计自造稳定 reason（ADR 0012 只给了 `payload-too-large`），schema 开放 StableCode 不违约，但未进受控词汇表 | §12 CONTEXT.md 新增词条时一并收录，或 AGENTS.md 词表化该 reason |

---

## 2. blocker 详述

### G-b1 · ALLOW LIST 遗漏 `pnpm-lock.yaml` → CI 在 install 步即红（切片纪律）

**证据**：
- `.github/workflows/ci.yml:33`：`run: pnpm install --frozen-lockfile`
- `pnpm-lock.yaml` importers 段逐包列出现有 9 个 workspace 包（`packages/clock`、`packages/vfsl` 等，L36–L220 区域）——pnpm 对每个 workspace 包按其 `package.json` 的 dependencies/devDependencies 维护 importer 条目。
- 设计 §1.2 明文：新包依赖 `@nomicore/vfsl`（唯一 workspace 运行时依赖）；仓内包模板（`packages/clock/package.json`）同时声明 `@types/node`/`typescript`/`vitest` devDeps。
- 设计 §12 ALLOW LIST：仅 `packages/namespace-diagnostic-log/**`、根 `package.json`（typecheck 一行）、`CONTEXT.md`、设计文档本身；DENY LIST 未列 lockfile，ALLOW 也未列。

**影响**：新包 `package.json` 一旦声明任何依赖（必然——至少有 `@nomicore/vfsl`），`--frozen-lockfile` 将以 `ERR_PNPM_OUTDATED_LOCKFILE` 失败于 install 步骤：SA6 红灯测试、SA4 静态门禁、SA7 活链路全部无法执行。这不是运行时风险，是「测试无法落地」的第一块石头；且因 ALLOW LIST 治理，SA3 无权顺手改 lockfile，会卡在 scope 争议上。

**修复要求（SA1 修订 §12）**：ALLOW LIST 增补一行：

```text
- `pnpm-lock.yaml` — 新包 importer 段差异（`pnpm install` 生成；除新包条目外无其他改动）
```

**红灯测试思路**：SA4 静态门禁核对 `git diff pnpm-lock.yaml` 的变更仅新增 `packages/namespace-diagnostic-log` importer；CI 全绿本身即锚。

---

### C-b1 · issues[].path 的 number 段 NaN/±Infinity：VFSL 放行、JSON 序列化变 `null` —— 孪生断裂（类型/schema 一致性 + 管线完备性）

**证据链**（三点共同构成漏洞）：
1. **schema 侧放行**：§3.3 `type PathSegment = string | number;` → 值语义为标量联合。`packages/vfsl/src/validate.ts:458-464`（scalar 分支）判定只做 `typeof value === t.type`——`typeof NaN === 'number'`、`typeof Infinity === 'number'`，NaN/-Infinity/**+Infinity** 全部通过校验。
2. **投影侧无守卫**：设计 §6.2 的条目有效性判定只写到条目级形状（`{ code?: string, message: string, path: (string|number)[] }`）；§4.2 enrichment 行覆盖 `context.*` 与 `durationMs` 的「非有限」，**唯独没有 issues.path 的 number 段**。
3. **序列化侧断裂**：`JSON.stringify(NaN)` / `JSON.stringify(Infinity)` → `"null"`。内存 adapter 校验的是**对象**（`validateLogicalSnapshot(compiled.derived, record)`，§4.1 步骤 5），而 §5.5 的 `measure(record) = Buffer.byteLength(JSON.stringify(record))` 与 #152 的 JSONL 落盘字节都来自**序列化结果**——两种数据形态在 NaN 上分叉。

**影响**：
- 本票内存路径：`records()` 返回的对象带 NaN，与设计 §2.5 的承诺「内存 adapter 的记录 JSON 与文件 JSONL 记录**逐字段同构**」直接矛盾；
- #152 File adapter（复用同一管线）：writer 会写出含 `null` path 段的行，其 schema `string | number` 拒绝 `null` → strict reader 判中段损坏 → 按 ADR 0012 §打开与尾部恢复，**整个旧 stream 转 corrupt 只读、新建 generation**——一次 producer 端数据缺陷（issue 里混入 NaN 段）被放大为 stream 级损坏；
- 健康语义误报：本票内若 record 恰在内存路径被拒（不会——NaN 能通过），或 #152 端 reader 报损坏时，都对应不到任何 writer 侧健康事件，违背「writer 产出的行必须自己能读」的隐含不变量。

**修复要求（SA1 修订 §6.2，一行级改动）**：条目有效性判定升级为**段级 JSON-safe**：

```text
valid 段判定：typeof seg === 'string'
            ∨ (typeof seg === 'number' ∧ Number.isFinite(seg))
含非法段的条目整条丢弃（与既有「畸形条目丢弃」同桶，enrichment-field-dropped/issues 上报）
```

并在 §6.1/§5.4 快照契约注记里顺带钉死两个邻近孪生点：`-0`（序列化为 `"0"`，静默改值）与稀疏数组 hole（`JSON.stringify([,1])` → `[null,1]`，jcs 的 `map/join` 跳洞产出 `[,]`——digest 与嵌入值表示分叉）。

**红线测试思路（SA6 §9.4 增补）**：
- `issues: [{ message: 'm', path: [0, NaN, 'x'] }]` → 条目被丢弃、`originalCount` 只计有效、`enrichment-field-dropped/issues` 事件、`items` 不含该条；
- `path: [1, Infinity]` 同上；`path: [-0]` → 落盘表示为 `0`（或按修订后的明文规定断言）；
- #152 前置锚：对任一被接纳 record 断言 `JSON.parse(JSON.stringify(record))` 再次通过 `validateLogicalSnapshot`（JSON round-trip 孪生不变量——本条测试同时永久防住同类漏洞，建议作为 §9.8 通用断言）。

---

## 3. concern 详述

### D-c1 · 0 字节 updateBytes 产出 schema 无法表达的 inline carrier

**证据**：§3.2 `P_BASE64 = '^(?:[A-Za-z0-9+/]{4})*(?:…{2}==|…{3}=|…{4})$'`——尾部强制恰一组（2+pad / 3+pad / 4），**空串不匹配**（已逐语义核对：star 允许零组但尾部组必≥2 字符）。§7.4 physicalize 对 `bytes.length === 0` 无守卫：`Buffer.from(new Uint8Array(0)).toString('base64')` → `''`。空串在 RFC 4648 里本是合法（空输入→空输出）Base64，Pattern 比规范收紧本身没错，但管线没有配套分支。

**影响**：producer 传 `{ kind:'committed', effect:'update', updateBytes: new Uint8Array(0) }`（空事务更新捕获边界、或 #150 空 Y.Doc 的 genesis 路径）→ VFSL 拒绝 → 记录丢弃 + `vfsl-validation-failed`（**writer bug 信号**）——把 producer 输入缺陷误标为 writer 缺陷，污染健康信号语义（ADR 0012：「append 前 VFSL validation failure 是日志 writer bug」——这条 ADR 句子会被错误触发）。

**修复要求**：§7.4 前置守卫二选一并写死：(a) `bytes.length === 0` → `update-omitted` + 新稳定 reason（如 `empty-update`，与 `payload-too-large` 同桶，并把该 reason 补进 §2.1 词表与 A-c2 一并处理）；(b) intake 阶段拒绝该 emission（`emission-dropped`）。**红线测试**：空 bytes emission → 断言选定分支的行为 + 事件，且**不得**出现 `vfsl-validation-failed`。

### D-c2 · GenesisBaselineRecord 在冻结公共面无构造路径，与「#152 只换 sink」自述矛盾

**证据**：§1.3 `DiagnosticChangeSink.append(record: DiagnosticSemanticRecord)`；§2.6 `DiagnosticSemanticRecord` 是纯 attempt 形状（attemptId/operation/stage/result，无 recordKind、无 carrier 位）。§2.4 `ROOT = AttemptRecord | GenesisBaselineRecord`（§11-G2 裁决生效）。§1.3 注释自述「#152 File adapter 复用同一管线，只换 sink」。而 ADR 0012 §Stream 与 generation L22 要求「每个新 stream 尽力先记录当前完整 Y.Doc 的 genesis baseline」。

**影响**：#152 无法经由冻结的 emission/sink 面产出 genesis-baseline record——必然要扩接缝（新增 genesis emission 变体，或走 §9.6 同款的 adapter 内部直通构造）。本票验收不受影响（schema 可表达性由 §9.6 手工 record 测试锚定），但 §10-J1 只备案了「形状被 #152 否决」的风险，没备案「接缝缺 genesis 路径」这一确定事实；#152 勘察若按 §1.3 字面理解会误判接缝已就绪。

**修复要求**：§10-J1 追加一句备案（或修正 §1.3 注释为「attempt 记录路径复用同一管线」），明确 #152 需为 genesis 增设构造路径且**不需要**改 schema。

### A-c1 · sequence uint64 耗尽语义缺失 + JS number 精度

**证据**：ADR 0012 §JSONL record L67：「达到 uint64 最大值后 stream 进入 exhausted，后续日志 emission 丢弃并上报，业务不受影响」。设计 §4.3 只写「从 1 起单调递增、不回绕」；§8.1 `record-dropped` 的 reason 词表冻结为两值（`line-budget-exceeded | queue-full`）；§7.2 `lastSequenceAssigned: number | null`。

**影响**：(a) 内存路径物理不可达（需 1.8×10¹⁹ 次 append），但 `sequence` 生成若用 `number` 自增，超过 2^53 后 `next++` 失精（出现重复或跳 2 的十进制串），`String(next)` 产出仍匹配 Pattern——损坏是静默的；(b) 冻结的事件 reason 词表没有 exhausted 位，#152（文件路径 frame sequence 是 uint64 BE，ADR 同节）补该语义时要么改冻结词表要么绕开。

**修复要求**：§4.3 写明 sequence 生成实现纪律（建议：缓存十进制字符串 + 数字符串进位，或 number 上限 2^53 断言），并在 §8.1 或 §10 备案「exhausted reason 由 #152 引入时的词表演进方式」。**红灯测试**：注入式 sequence 生成器推到 uint64 max 的邻域，断言内存路径行为符合修订后条文。

### E-c1 · truncateUtf8 预算小于 marker 长度时静默超预算

**证据**：§6.1 `target = budgetBytes - Buffer.byteLength(TRUNCATION_MARKER)`（13B）；`budgetBytes < 13` → target < 0 → 循环首轮 `bytes + cpBytes > target` 即 break → `cut = 0` → 返回 13B marker，**输出 > 预算**。v1 全部调用点为冻结常量（4096/1024/256）> 13，不可达；但该原语是通用 helper（§6.1 独立成节），常量演进或复用即触雷。

**修复要求**：函数入口 loud 断言（throw 属内部 bug 信号）或定义 `budget < marker` 时返回「预算内最大 code-point 前缀 + 无 marker」的确定性行为，写进 §6.1 并补一条红灯测试（直接以小预算调用内部函数断言输出 ≤ 预算）。

### E-c2 · lone surrogate 下「UTF-8 字节预算」在序列化前后二义

**证据**：§6.1 用 `Buffer.byteLength(s)`（序列化前字符串）计预算——Node 对 lone surrogate 计 3B（U+FFFD 替换语义）；而 JSONL 中 `JSON.stringify` 按 ES2019 well-formed 语义转义为 `\udXXX` = 6 ASCII 字节。例：message 由 1365 个 lone surrogate 构成 → 计 4095B ≤ 4096 不截断 → 序列化后该字符串占 8190B。ADR 0012「资源限制统一按 UTF-8 bytes 计算」未指明基准表示。§5.2 已对 JCS 的同类问题做了显式确定性扩展并配 KAT，§6 却没有。

**修复要求**：§6.1 一句话钉死预算基准（建议：按 JSON 字符串字面量字节 `Buffer.byteLength(JSON.stringify(s)) - 2`，与 JSONL 行字节严格一致；或明文接受替换语义并记录后果），补 KAT。**红灯测试**：lone-surrogate 密集 message 的序列化后字节 ≤ 4096 + 2（引号）或符合修订条文。

### F-c1 · `schema-compile-failed` failed 模式不可注入、无测试锚

**证据**：§4.1 步骤 0′/§4.2「schema 编译失败 → failed 模式，后续 append 全丢弃并计数，不再逐条发事件」；§8.1 事件词表含 `schema-compile-failed`。§3.1 冻结 schema 是内建常量，§1.3 testing 子路径只列「确定性 RandomSource、事件收集 observer、final-record 直通接缝」——没有 envelope 覆盖注入。§9 无任何文件锚定该分支。

**影响**：冻结公共面上的事件变体 + failed 模式状态机成为零覆盖死代码；SA7 活链路也无法验证「failed 模式不逐条发事件」的抑制逻辑。

**修复要求**：testing 子路径增补「带自定义 envelope 的 adapter/emitter 工厂」（生产构造器内部函数化即可），§9.6 或 §9.11 加一条：注入坏 envelope → 构造期一次事件 + 后续 append 全丢弃且**无**逐条 `record-dropped` + stats 对账。若 SA1 判断不值得开此缝，则须在 §10 明文降级备案（该事件为不可测防御分支）。

### F-c2 · AC1「不暴露物理细节」缺直接锚

**证据**：验收标准 1 原文「不向 producer 暴露 JSONL、Base64、segment、frame、offset 或 retention 细节」。§9.10 test-d 只锚 TS 字面量相关性与 excess property；§1.3 却把 `Base64`/`SegmentName`/`FrameOffset`/`Crc32cHex` 类型**导出在公共面**（属 record 契约类型，正当），更需要一条显式断言把「emission 面无物理键」钉死，防 #149–#151 接线时顺手往 emission 塞字段。

**修复要求**：§9.10 增补 type-level 断言：`expectTypeOf<NamespaceDiagnosticChangeEmission>()` 的键集合 ∩ {base64, segment, frameOffset, crc32c, payloadLength, storage, retention} = ∅（EmissionResult 同理）。

### A-c2 · `update-capture-disabled` 未入受控词汇表

**证据**：ADR 0012 §Inline 与 sidecar 仅给出 `payload-too-large` 一例；设计 §2.1 自造 `update-capture-disabled`（论证正当：默认 `updateCapture:false` 时 committed 事实要诚实保留）。schema 侧 reason 为开放 `StableCode`，不构成规格违反；但 §12 计划新增的 CONTEXT.md 词条（「语义 emission」「storage projection」「genesis baseline record」）未含该 reason 值，稳定码游离在受控词汇之外。

**修复要求**：把 `update-capture-disabled`（连同 D-c1 可能新增的 `empty-update`）列入 AGENTS.md/README 的 reason 词表，或并入 CONTEXT.md 新增词条的说明行。

---

## 4. 逐项核对通过记录（防止复审重复劳动）

### A. 规格符合性（通过项）
- operation 6 值 / stage 8 值：与 ADR 0012 L69-78、ADR 0011 §变更尝试与结局 L42-49 **逐字一致**（含 `dirty-notification`）；`rejected` 未折叠、v1 不新增。
- result 判别联合：ADR 0012 L80-87 六形状 → §2.1 八成员展开忠实（fatal+committed:true × effect 三值）；`rejected`/`fatal+committed:false` 禁携 update 由 schema 封闭对象机器强制（成员无 update 键 → 携带即未知键被拒，validate.ts:574-578 封闭对象未知键路径）。
- 结局 `unknown` 不落 v1 存储：总控 G3 已裁决，落地方式（§11-G3 + §2.1 注）自洽。
- 输入零重读：原始请求**结构性不进入**日志模块（§5.4）；not-accessed/unavailable/unsafe-input 三事实优先于策略（§5.1 表，与 ADR 0011 L71-74 逐字对齐）；「事实优先」防住「策略改写事实」这一隐蔽违规路径。
- 数据保护：默认 `inputPolicy:'digest'`、默认 `updateCapture:false`、issues 脱敏时 `policy` 字段自标、健康事件白名单禁 record/input/Base64/update/message/stack 且 `ValidateIssue.message` 整体丢弃（正确处理了 validate.ts:27 的 40 字符值预览外泄面，即总控 G4 裁决的落地）、`streamId`/`namespaceId` 不进事件。
- emitter 接口：`emit(emission): void` 同步不抛不阻塞；ADR 0011 §Interface 草图的参数名 `record` 被设计改为 `emission`——由 ADR 0012 L212「业务 producer 只提交 semantic emission」正当化，接口名 `NamespaceDiagnosticChangeEmitter` 保留，不算违反。
- `emitterSequence` 与 stream `sequence` 合一（§4.3）：单写者模型下等价，ADR 0011 L95 不禁止。

### B. VFSL schema 可编译性（全项通过，附独立复核证据）
- **Pattern 引擎子集**（独立核对 `packages/vfsl/src/pattern.ts` 全文）：`(?:)` 非捕获组（L303-307）、`|` 交替（split 指令，L646-665）、`{n}`/`{n,m}` 量词（tryParseBraceQuantifier L261-285）、字符类含区间/字面 `-` 尾位/类内 `.` 字面量（L437-483）、`^$` 锚（assertStart/assertEnd）。全部设计 Pattern 零反斜杠（E202 免疫，v1-spec 注记 6）。
- **锚定语义**：引擎 `match` 为非锚定搜索但逐位重播种（L913-918）；`^` 断言在 pos>0 被剪枝（L798）→ `^…$` 模式等价全串匹配，设计的全锚定 Pattern 语义正确。
- **指令规模**：`^.{1,256}$` 展开 ≈ 515 指令、`{64}` ≈ 66、Base64 尾部星循环**不展开**（max=null 走星循环 L731-739）< 100 指令——全部远离 10_000 上限（L98）。
- **判别联合**：`detectDiscriminator`（evaluate.ts §5.2）要求公共字面量字段值两两互异——`AttemptResult` 的 `kind` 值重复（committed×3/fatal×4）→ 不附加判别式快速路径，走 validate.ts 段 1–3 全扫（any-member-zero-issue 接受）；`InputCapture`/`UpdateCarrier`/`LogSource` 的 capture/storage/kind 互异 → 启用。**判别式只是加速，语义正确性不依赖它**——无攻击面。
- **E309**：`PathSegment = string | number` 全标量联合（v1-spec §3 三分类第 4 行），数组元素位合法；`LogSource`/`InputCapture`/`AttemptResult`/`UpdateCarrier`/`ROOT` 全容器形成员，无混合。
- **E311**：`ROOT = AttemptRecord | GenesisBaselineRecord` 经别名解析后全 map 形联合——v1-spec §3 命名空间根明文允许（「全 map 形联合（clsOf = map）」）。
- **其余**：无括号分组（E100）、无布尔/负数/小数字面量（注记 7/8）、无循环引用（E106）、别名无一命中保留名集合（E303）、前向引用合法、JSDoc 全部可挂载（首个文档注释挂 `StreamId` 声明、carrier 内文档注释挂 `payloadLength` 属性，均 §5 合法挂载位；无悬空 E305）、`value: unknown` 为 §2 PrimitiveType 合法成员。
- **`^.{1,256}$` 的 `.` = UTF-16 码元**（pattern.ts L68 注释一致）：256 个 astral 字符（512 码元）会被拒——对受控 ID 是收紧非放松，违规走已文档化的丢字段/丢 emission 路径，无假阴性。

### C. 孪生一致性（通过项）
- fatal `committed ↔ effect` 相关性：schema 侧放松（`{kind:"fatal";committed:boolean}` 成员自身合法）已文档化（§10-J2）且方向安全（TS/emitter/测试三重收紧，schema 永不拒绝合法 record）——攻击点 C 提问的「残差是否已文档化」：**已文档化，合格**。
- `code ↔ sourceModule` 成对残差：§10-J3 已文档化。
- 显式 `undefined` 可选字段：`packages/vfsl/src/validate.ts:157-160` `present()` 将「own 且值非 undefined」定为在场——显式 undefined 键视同缺席，与 `JSON.stringify` 丢弃行为一致，`exactOptionalPropertyTypes` 下无假阳性/假阴性。
- `reason: string`（TS）vs `StableCode`（schema）的收紧差由 §6.3「reason 由 emitter 自有词表构造」闭环。

### D. 管线完备性（通过项）
- **BigInt**：唯一可达 `JSON.stringify` 抛点的路径已被前序步骤封死（snapshot 经 jcs 的非有限/类型守卫 → `unavailable`；durationMs/replicationEpoch 非有限 → enrichment 丢字段；path 段形状检查 + VFSL 兜底），残余意外由「sink.append 任意点 → adapter 顶层 catch」（§4.2）收编——兜底位置明确。
- **deep freeze × Uint8Array**：最终 record 已物化为 Base64 字符串（无 typed array）；语义 record 冻结时 `Object.freeze(Uint8Array)` 合法不抛。
- **measure 与 JSONL 字节一致性**：紧凑 `JSON.stringify`、不含 `\n`、固定构造键序（ADR 0012 L59 允许）——除 C-b1 的 NaN 分叉外一致。
- **降级顺序**：§5.5 与 ADR 0012 L136 逐字对齐（先降级 input→digest，仍超限才丢整条）；J9 对「无 sidecar 时 ≳780 KiB update 必丢」的诚实后果已备案并有 §9.5 测试锚。

### E. 算法确定性（通过项）
- JCS：键序按 UTF-16 code unit（RFC 8785 §3.2.3，comparator 显式）、数字按 ECMAScript toString（§3.2.2.3，`1e+21`/`-0` 进 KAT）、lone surrogate 的确定性全函数扩展已文档化并配 KAT（§9.3）；非有限数 throw → `SnapshotContractViolation`。
- issues 边界：空数组（无 truncated/originalCount）、恰 1000 条（不截断）、1001 条、4096/4097B、多字节骑界、257 段、1025B 段、presence 语义——§9.4 全覆盖。
- truncateUtf8 的 code-point 对齐（cpBytes 累计、代理对不拆）：正确（唯 E-c1 的 <13B 角）。

### F. 测试可落地性（通过项）
- AC 映射：AC1→§9.1、AC2→§9.3（+9.2 探针）、AC3→§9.4/§9.5、AC4→§9.6/§9.11、AC5→§9.7——五条验收全部有锚。
- VFSL 失败注入：§9.6 经 testing 子路径 final-record 直通，逐类违规形状枚举充分（坏 streamId/词表外/多余顶层键/坏 Base64/坏 CRC/坏 ISO/缺 digest + **sidecar 可表达性正例**）。
- 确定性接缝：RandomSource 注入、observer 收集器、`observedAtFrom` Pattern 匹配断言齐备。

### G. 切片纪律（通过项）
- 无 Runtime 接线/manifest/frame 构造（§7.3 明示「本票只算 CRC 值本身，不构造 25-byte frame header」）/reader/retention/replay；sidecar 仅 schema 可表达性 + 手工 record 验证——与切片边界「本票做/不做」清单一致。
- 工程配置已独立核实：`vitest.config.ts` include `packages/*/test/**/*.test.ts` 与 typecheck include `packages/*/test/**/*.test-d.ts` 均为通配（新包自动覆盖，设计正确地未列改动）；根 `tsconfig.typecheck.json` include 亦为 `packages/*` 通配；`pnpm-workspace.yaml` `packages/*` 通配（DENY LIST 免改声明正确）；根 `package.json` typecheck 逐包列举 → ALLOW LIST 的一行追加正确且必要。
- §14 连锁审计（零 caller、grep 为空）与 §13 协议假设依据均可被 SA4 复核。

---

## 5. 协议假设依据审查（skill 立法项）

**结论：通过。**

- §13 章节存在，本设计为纯进程内库，无 HTTP/WS 端点/端口/跨进程时序假设——声明与正文一致。
- 6 条运行时库假设全部给了可验证依据，且本次评审**独立复核了两条最关键的**：
  - pattern 引擎子集支持（`packages/vfsl/src/pattern.ts` 全文核对：分组/交替/量词/字符类/锚、10_000 上限 L98、多项式完成 L13-16）——§13 引用的行号与内容相符；
  - `unknown` 恒接受（`packages/vfsl/src/validate.ts:323`「unknown 永不矛盾」、L458-460、L564-568）——行号与内容相符。
- `node:crypto` 先例（`packages/vfsl-codegen/src/header.ts:10`）、Buffer Base64 先例（`packages/vfsl/src/schema-check-cli.ts`）、`new Date(ms).toISOString()` 毫秒 3 位格式——均可由 SA4 重跑验证；无「应该/通常/预计」类无据推断；无声称实测却缺命令输出的条目。

## 6. 错误处理链路审查（skill 立法项）

- **静默失败**：全管线 void + 分层 catch（emit 顶层 → intake → 投影 → enrichment → adapter 顶层 → observer 隔离 → fallback logger → 最终空 catch）。唯一静默点是「fallback logger 自身 throw 后的空 catch」——设计已明文注明「此处无更外层通道」并要求代码注释标明，属可接受的最后防线。`pass`。
- **状态闭环**：每种失败模式都有确定的去路（丢弃/降级/丢字段）+ 健康事件 + stats 计数（§4.2 表逐行核对无漏行——除 blocker/concern 已列者）。
- **降级路径**：依赖面仅 vfsl（同步纯函数不抛错）与 node:crypto（构造期绑定）；无外部服务依赖，无需运行时降级策略。
- **虚假降级识别**：重点审查了 §5.4「快照契约违反 → capture:'unavailable'」——设计明确论证这是**文档化异常路径**（producer 违约）而非正常路径前提缺失，配 health 事件（`input-projection-failed`）+ §9.3 红灯（含「同一 getter 只触达一次」探针），不是吞 bug。`failed 模式`（schema 编译失败）同理是构建期 bug 信号而非降级。**无虚假降级**。

## 7. 红线测试思路汇总

（逐条已并入 §2/§3 各攻击点；此处列新增于 §9 计划之外的）

1. **JSON round-trip 孪生不变量**（对应 C-b1，建议进 §9.8）：每个被接纳 record 断言 `validateLogicalSnapshot(derived, JSON.parse(JSON.stringify(record)))` ok——一次性防住所有「对象合法、字节非法」类漏洞（NaN/Infinity/undefined/hole/-0）。
2. **空 updateBytes**（D-c1）：断言选定分支行为 + 事件类型 ≠ `vfsl-validation-failed`。
3. **truncateUtf8 小预算**（E-c1）：内部函数直测输出 ≤ 预算。
4. **lone surrogate 消息预算**（E-c2）：序列化后字节符合修订条文。
5. **failed 模式注入**（F-c1）：坏 envelope → 一次事件 + 后续全丢且无逐条事件 + stats 对账。
6. **emission 物理键黑名单**（F-c2）：type-level 键集合断言。
7. **sequence 邻域**（A-c1）：注入式生成器推到边界断言修订条文。

---

## 8. 总体结论

**design 暂不进入 SA6 红灯测试阶段；完成一轮轻量修订（预计 ≤ 半页文档改动）后放行。**

- **必须修**（blocker）：G-b1（ALLOW LIST 补 `pnpm-lock.yaml`——否则 SA6 写好的测试在 CI 上根本跑不动）、C-b1（path 段 JSON-safe 判定——否则 SA6 会把带洞的投影算法钉进红灯契约，#152 复用时返工）。
- **强烈建议同轮修**（concern 中影响冻结面的）：D-c1（空 updateBytes 分支）、D-c2（genesis 接缝备案）、A-c1（sequence 耗尽/精度纪律）、F-c1（failed 模式可测性或备案）、E-c1/E-c2（确定性边界条文）。
- **可延后**：F-c2、A-c2（词表登记类）。
- 设计的**架构骨架**——词表冻结、schema 单源纪律、语义/物理投影切分、失败隔离表、健康白名单、测试计划映射——经逐字对抗核对**全部成立**，修订不需要触碰任何结构性决策；§11 六项裁决的落地方式均合格。

---

# R2 复审（2026-08-28 · 对设计文档 R2，1157 行）

- **复审范围**：仅核对本报告 R1.1 的 2 blocker（G-b1/C-b1）+ 8 concern（D-c1/D-c2/A-c1/E-c1/E-c2/F-c1/F-c2/A-c2）落地是否正确、有无引入新矛盾；§3.3 冻结 schema「零改动」声明核实。R1.1 的通过项（A 通过项/B 全项/D 通过项等）未重审——其依据（pattern.ts/validate.ts/index.ts/CI 配置）本轮未变。
- **方法**：设计全文重读 + §3.2/§3.3 与 R1.1 逐行目测比对 + 修订处语义独立复核（jsonLiteralCpBytes 逐 code point 对照 JSON.stringify 转义规则；nextDecimal/exhausted 边界；jcs 逐槽检查与 §4.2/§5.4 闭环）。

## R2.1 冻结 schema 零改动声明核实 —— ✅ 属实

§3.2 十个 Pattern 常量与 §3.3 全部 24 个类型别名（StreamId…ROOT）的文本、Pattern 实参、JSDoc 措辞、字段顺序与 R1.1 **逐行一致**（R2 行 380–589 ↔ R1.1 行 373–582）；语法自检清单（行 591–599）未动。修订确实全部落在投影/工程配置层——`envelopeFingerprint` 语义无漂移，§9.8 指纹钉死测试的前提成立。

## R2.2 十项反馈逐条核验

| 项 | 落地 | 核验细节 | 新矛盾 |
|---|---|---|---|
| **G-b1** blocker | ✅ 修妥 | §12 ALLOW LIST 增补 `pnpm-lock.yaml`，引 ci.yml:33 `--frozen-lockfile` 依据 + SA4 核对口径（diff 仅含新包 importer）。CI install 步可过。 | 无 |
| **C-b1** blocker | ✅ 修妥 | 三层闭环齐备：①§6.2 段级判定 `string ∨ Number.isFinite(number)`，非法段（NaN/±Infinity/undefined/稀疏 hole）**整条丢弃** + `enrichment-field-dropped/issues`；②§5.2 jcs 数组分支逐槽检查（`!(i in value) ∨ value[i]===undefined` → SnapshotContractViolation → `unavailable`）——比 R1.1 的「map 跳洞 + 隐式 TypeError」更确定；③§9.8 JSON round-trip 不变量升级为全 suite helper（`validateLogicalSnapshot(derived, JSON.parse(JSON.stringify(record)))` ok）——正是 R1.1 建议的通用锚。`-0`：path 段投影处 `Object.is` 归一 +0（§6.2），full value 保留 -0 但 §5.4 明文「序列化视图为准」且 round-trip 合法——残差成文、确定、有测试（§9.4 `[-0]→0`、稀疏 `[,1]` 丢弃）。 | 无 |
| **D-c1** | ✅ 修妥（方案 a） | §7.4 守卫置于最前（empty-update > update-capture-disabled > payload-too-large，优先级确定）；§2.1 词表三值成文且 `empty-update` 匹配 P_STABLE_CODE（`-` 在字符类内）；§4.2 行明示「**不得**产生 vfsl-validation-failed」；§9.9 双断言（保 metadata + 无该事件）。 | 无 |
| **D-c2** | ✅ 修妥 | §1.3 注释收窄为「attempt 记录路径复用同一管线」；§10-J1 备案「genesis 在 v1 emission/sink 面无构造路径 = 设计事实，#152 增设 adapter 内部构造路径，不改 schema、不动 emission 面」。 | 无 |
| **A-c1** | ✅ 修妥（十进制字符串进位） | §4.3 `nextDecimal` 逐位进位、全程无 number 算术（2^53 失真根除）、上界 `18446744073709551615`；exhausted 模式语义逐字对齐 ADR 0012；§7.2 `lastSequenceAssigned: string \| null`；§1.3/§9.10 预置接缝（`…51614 → 一次 …51615 → 再 append exhausted`，边界语义自洽：分配到 max 的那条仍接纳）；§8.1 + §10-J13 双备案（v1 事件词表不含 exhausted 位，#152 以联合成员追加）。 | 见 R2.3-n3（nano） |
| **E-c1** | ✅ 修妥（loud 断言） | §6.1 入口 `TruncationBudgetBelowMarker` throw，经 emitter 顶层 catch 收编 `pipeline-crashed`（内部 bug 信号，不静默超预算）；§9.4 budget=12 红灯 + 生产常量 ≥13B 断言。 | 无 |
| **E-c2** | ✅ 修妥（JSON 字面量字节，即 R1.1 建议方案） | `jsonLiteralBytes = Buffer.byteLength(JSON.stringify(s)) - 2`；`jsonLiteralCpBytes` 逐项独立复核与 JSON.stringify 转义规则**一一对应**：`"`/`\`→2、短转义 \b\t\n\f\r→2、cp<0x20→6、lone surrogate→6（well-formed `\udXXX`）、ASCII→1、2/3 字节 UTF-8→2/3、合法 astral 对→4（不转义）——含 0x7f（不转义→1）与 U+2028/29（不转义→3）两个易错角均正确；与 §5.5 `measure()` 同基论证成立；§9.4 KAT（1365 lone surrogate = 8190B > 4096 → 截断）钉死。截断输出 = 前缀(≤budget−13) + marker(13B) ≤ budget，数学闭合。 | 见 R2.3-n1（nano） |
| **F-c1** | ✅ 修妥（开缝不降级） | §1.3 testing 子路径「带自定义 envelope 的 adapter/emitter 工厂（生产构造器内部函数化）」；§9.6 红灯四断言（构造期恰一次 `schema-compile-failed` + 后续全丢弃 + **无**逐条 `record-dropped` + stats 对账）——failed 模式抑制逻辑脱离死代码。形状合理：`getRecordSchemaCompilation()` 模块级缓存不受注入影响，无串扰。 | 无 |
| **F-c2** | ✅ 修妥 | §9.10 `expectTypeOf` 键集合 ∩ 7 物理键黑名单 = ∅，Emission 与 EmissionResult 双锚（UpdateCarrier 键合法存在于 record 类型、不在 producer 面——目标正确）。 | 无 |
| **A-c2** | ✅ 修妥 | §2.1 三值词表逐值论证；§12 CONTEXT.md 词条说明行收录；附录 AGENTS.md Contract 段词表化 +「新增 reason 须过设计评审并同步 CONTEXT.md」纪律。 | 无 |

## R2.3 新引入矛盾扫描 —— 无阻断项；4 条 nano 备注（实现期顺手处理，不构成返工）

- **n1（cosmetic）**：§6.1 marker 注释「13B（全 ASCII 可打印）」——`…` 是 U+2026 非 ASCII；字节数 13B 本身正确（3B UTF-8 + 10B ASCII，无需转义），代码经 `jsonLiteralBytes` 计算不依赖该注释。建议实现期改措辞。
- **n2（stale wording）**：§4.1 步骤 5 仍写「issue **条目级**违规」，而段级判定已随 §6.2 归入步骤 4；权威表 §4.2（issues 投影行）正确覆盖条目+段级。以 §4.2/§6.2 为准即可。
- **n3（未指明，不可达路径）**：exhausted 模式的 stats 计数落在 `droppedByReason` 的哪个 key 未写明（事件词表无 exhausted 位是备案过的，但 stats key 也未命名）。建议 AGENTS.md 写死（如 `droppedByReason['sequence-exhausted']`，stats 不属冻结事件词表）。同类：§4.3「事件抑制策略与 failed 模式一致」措辞略松（failed 构造期有一次事件、exhausted 无事件类型可用）——§9.10「无逐条事件」已定语义，建议措辞改为「stats 计数、不发事件」。
- **n4（覆盖完整性）**：`-0` 残差 §5.4 只列举了 full value 与 issues path 段，`durationMs`/`context.replicationEpoch` 的 `-0` 属同类（内存 -0 / JSON 0，round-trip 合法、§9.8 helper 兜底）——原则已覆盖，可在 AGENTS.md 一句话补全。

其余一致性复核（修订处交叉引用）：`empty-update` 五处出现语义一致；sequence 纪律六处一致；预算基准四处同基；round-trip 不变量（§9.8）↔ 段级 JSON-safe（§6.2）↔ jcs 逐槽检查（§5.2）互为前提闭环；§2.5「逐字段同构」承诺经 §5.4 carve-out + §9.8 机器锚后自洽。

## R2.4 最终 verdict

**✅ 放行（pass）——design 进入 SA6 红灯测试阶段。**

- 2 个 blocker 均已正确修复且无副作用；8 个 concern 全部落实，其中 4 项（C-b1/E-c2/F-c1/F-c2）采用的方案与 R1.1 建议逐字一致。
- §3.3 冻结 schema 零改动声明属实——指纹冻结纪律未受修订污染。
- 4 条 nano 备注均为措辞/未指明项，不构成设计缺陷，授权 SA3/SA6 在实现期顺手处理（无需再过 SA2）。
- SA6 注意：§9 新增的红灯（9.4 段级 JSON-safe/预算 KAT/小预算、9.6 failed 模式、9.8 round-trip helper、9.9 empty-update、9.10 sequence 纪律与物理键黑名单）是本轮修订的机器锚，**必须**全部落地，缺一则修订失去回归保护。
