# Task: Freeze the v1 diagnostic record contract and memory adapter

- issue: #148（parent PR #142 / docs/namespace-diagnostic-change-log）
- worktree: /home/wangjian/nomicore-fix-issue-148
- branch: fix/issue-148-on-docs-namespace-diagnostic-change-log
- run_id: issue-148-1787889316-3529662
- round: 1
- 规格冻结源：`docs/adr/0011-best-effort-namespace-diagnostic-change-log.md`、`docs/adr/0012-vfsl-validated-jsonl-and-framed-sidecar-change-log.md`、`CONTEXT.md`（namespace 诊断变更日志词条）

## 需求理解（issue 原文）

提供第一条完整、可测试的 namespace 诊断变更日志路径：**non-throwing 语义 emitter** + **有界内存 adapter**。Producer 以冻结的 v1 operation/result 词表提交 detached 语义结局；日志队列压力、校验缺陷、observer 故障必须与 namespace 业务行为隔离。

## 验收标准（5 条，逐字）

1. 语义 emitter 接受全部冻结 v1 operation 与 result 分支的 detached namespace change-attempt 结局，不向 producer 暴露 JSONL、Base64、segment、frame、offset 或 retention 细节。
2. 输入捕获支持 none/digest/redacted/full 四种策略，只消费既有安全快照；input 前拒绝与不安全快照失败不得重读调用方输入。
3. issues 与其他可变尺寸字段在文档化 UTF-8、count、path、line 预算内确定性投影，含按要求降级 digest。
4. 内建冻结 VFSL 信封校验最终 v1 record；校验或 observer 故障只经低基数 logger 健康 observability 上报。
5. 有界 memory/test adapter 饱和时 drop newest、保持已接纳顺序、永不 throw 或阻塞 producer；契约测试覆盖全部 result 分支与故障隔离。

## 切片边界（同系列 issue 勘察结论）

- **本票做**：v1 语义词表 + record 契约（TS 类型 + 内建冻结 VFSL schema）+ 语义 emitter 管线（投影→最终 record→VFSL 校验→adapter）+ 健康 observability 接缝 + 有界内存 adapter + 契约测试。
- **不做（后续票）**：#149 接线真实 NamespaceRuntime ROOT/SCHEMA 写；#150 namespace create 生命周期与 genesis；#151 replication 记录；#152 File adapter（manifest/JSONL/NDCL frame/strict reader）；#153 重开/滚动/尾部修复；#154 retention/删除；#155 replay/Host 配置。
- 关键约束：本票冻结的 VFSL record schema 必须不加修改即可服务 #152 的 File adapter（inline Base64 + sidecar reference 两种 storage 形状都要能表达）。

## 勘察结论（总控已核实）

- 仓库：pnpm 10.28.2 monorepo，Node >= 20（本地 v24.13.0），`packages/*` 布局；测试 `pnpm test`（vitest run --typecheck，include `packages/*/test/**/*.test.ts`）；`pnpm typecheck` 在 root package.json 逐包列举（新包须加入）。
- VFSL 工具链（`@nomicore/vfsl`）：`compileSchemaEnvelope(input)` 严格封闭四键信封编译 → `{ envelope; module; derived; envelopeFingerprint; semanticFingerprint }`，深冻结、不抛错；`validateLogicalSnapshot(derived, snapshot)` 对普通 JSON 逻辑 ROOT 快照做全量值语义校验（全收集 issues 上限 100 + 截断标记），同步纯函数不抛错。
- VFSL v1 语法（docs/vfsl/v1-spec.md）：ROOT 必须 map 形（裸对象/YMap/Record）；容器内原始类型/字面量联合等价 YLeaf 值语义；封闭对象默认拒绝未声明键；判别联合由字面量字段自动识别；`string & Pattern<"...">` 约束（NFA 模拟，ReDoS 防护）；YLeaf<unknown> 合法；负数/小数字面量在 schema 语法层禁止。
- 仓内无 CRC32C、无 RFC 8785 JCS、无 Base64 工具实现；`packages/vfsl/src/sha256.ts` 是纯 TS text→hex SHA-256（不导出公共面，带 KAT）。新包是否用 node:crypto 由 SA1 论证决定。
- Clock 接缝（`@nomicore/clock`）：`interface Clock { now(): number }`，Cordis service 注入。
- 模块规范：新包需自带 README.md + AGENTS.md（ Contract/Boundaries/Verification 三段式）；根 CONTEXT.md 维护受控词汇。
- tsconfig：strict + exactOptionalPropertyTypes + noUncheckedIndexedAccess + verbatimModuleSyntax。

## 留给 SA1 的设计问题

1. 新包命名与位置（建议 `packages/namespace-diagnostic-log` / `@nomicore/namespace-diagnostic-log`，须论证）。
2. 语义 emission 类型与 emitter interface 命名/形状（对齐 ADR 0011 §Interface 与 ADR 0012 「producer 只提交 semantic emission」）；streamId/sequence/attemptId 在 memory adapter 路径的分配与默认值；随机源/时钟注入接缝。
3. v1 record 的 TS 类型与 VFSL schema 文本逐字段设计（operation/result 判别联合、stage 封闭枚举、code/sourcePhase Pattern、source/context、input capture 四策略形状、issues 投影形状、update inline/sidecar 两种 storage 形状、observedAt/durationMs、sequence 十进制字符串）。
4. 输入捕获管线：digest=SHA-256(RFC 8785 JCS bytes) 的实现策略；redacted/full 的投影与 line 预算超限降级 digest + `projected-input-too-large`。
5. issue 投影：message 4KiB/path 256 段/段 1KiB/issues 1000 条/Unicode code point 不拆分的确定性截断 + truncated/originalCount。
6. line 硬上限（默认 1 MiB）处理顺序：降级 digest → 仍超限丢 record + 健康上报。
7. 内存 adapter：容量、drop-newest、顺序、健康指标（dropped by operation/reason 低基数）、observer 故障隔离。
8. 健康 observability 接缝形状（低基数字段白名单：稳定 code、schema id/fingerprint、operation、source module、VFSL issue codes/paths、projected record byte size；禁 record/input/Base64/update/message/stack）。
