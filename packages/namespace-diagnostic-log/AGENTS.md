# Agent Instructions — packages/namespace-diagnostic-log

本包是 namespace 诊断变更日志 v1 的**语义 emission 接缝 + 冻结 VFSL record schema +
有界内存 adapter**（issue #148）。修订本包前先读：
- `wiki/raw/task_diagnostic-log-v1-contract_design.md`（R2 唯一权威——§1 模块定位 /
  §3 冻结 schema / §4 管线失败隔离 / §5 输入捕获 / §6 投影 / §7 adapter / §8 健康面 /
  §12 文件清单）；
- 契约测试 `test/**`（SA6 owned——红灯契约即行为规格；改实现不改测试断言）。

## Contract

- **冻结 v1 record 契约**：schema id/指纹单源 `src/schema.ts`（`RECORD_SCHEMA_ID`、
  `RECORD_SCHEMA_ENVELOPE`、`RECORD_SCHEMA_TEXT`）；指纹
  `sha256:v1:dedad2ab93d9df9224960ca094924168f8bcc1c0512dfdd0a03dc6e66613e070`
  被 `test/schema-freeze.test.ts` 钉死。
- **emit 同步、不 throw、不阻塞、所有权移交**：emission 传入后 plain-data snapshot
  所有权移交日志管线（管线深冻结语义 record——producer 后变异在 strict mode 下 loud
  抛 TypeError，属 producer bug）；updateBytes 为 intake 复制隔离（slice 副本，
  producer 在 emit 后变异原 updateBytes **不影响**已接纳 record——R3 总控裁决，
  ADR 0011「已转移或已复制」）。
- **四策略输入捕获只消费既有安全快照**（不重读、不重试；事实优先于策略：
  not-accessed/unavailable/unsafe-input 原样入 record）。
- **line 预算先降级后丢弃**：full/redacted 超限 → digest + degraded；仍超限 →
  丢弃 + 健康上报，不影响业务。
- **update-omitted 稳定 reason 受控词表：v1 = `payload-too-large` /
  `update-capture-disabled` / `empty-update`**——新增 reason 属词表演进，须过
  设计评审并同步 CONTEXT.md。

## Boundaries

- **File adapter `emit` 为有界同步 append（ADR 0012 amendment，issue #152 R2）**：
  慢文件系统可阻塞调用方线程——**任何把 File adapter `emit` 接入 namespace 生命周期的
  接线必须位于 NamespaceRuntime write sequencer slot 之外或释放后**（slot 内接线为
  不合规；接线范围归 #149–#151/#155 等票，本包不实施）。「有界」只限制数据量/操作数，
  不承诺磁盘延迟上界；同步 append 不构成 fsync/掉电持久性承诺。
  **（#153）该纪律同样覆盖构造期**：reopen 健康证明、可证明尾部修复（truncate）
  与 locator 解析的全部同步 fs 操作必须在 write sequencer slot 外执行。
- **reopen 与续写（#153）**：构造期 locator 解析走确定性三分支（显式
  resumeStreamId > 可用 current.json > 恰一候选扫描恢复；≥2 候选 → disabled +
  `locator-ambiguous`，绝不猜测）。健康证明与 strict reader 共享同源判定（manifest
  门双形状：14 键 legacy 可读不可续写 / 17 键 current 含三 roll targets——17 键
  manifest 创建后不可变；证明失败 → `stream-generation-rotated{cause:…}` 新
  generation 承接，旧 stream 只读恒等；`stream-init-failed.reason` 只保留
  disabled 终态四值）。尾部修复仅作用于最大有文件 segment 的三类可证明残留
  （不完整尾行 / 不完整尾 frame / 未引用尾 orphan frames），中间损坏一律零修复
  rotate（全有或全无）。**耗尽 = disabled**（segment `99999999` 溢出与 sequence
  `UINT64_MAX` 共用 exhausted 门闩 + 恰一次 `stream-exhausted`），绝不新建
  generation。
- **sequence 提交点纪律（R2）**：candidate 只在准备门全过后取得；definitive
  pre-commit append 失败（open 期 EISDIR/EACCES/ENOENT）可复用 candidate，
  ambiguous outcome（write 期失败等）必须 reservation 并封闭旧 generation，
  绝不在旧 stream 写第二条相同 sequence——不要改回「分配即消耗」。
- **storage projection 归 adapter**：emitter 只做语义投影（不构造
  segment/frame/offset/Base64/CRC）；VFSL 校验唯一在最终 record（adapter 侧）。
- **环境绑定面（三处声明；#152 起）**：
  - `node:crypto` / `Buffer` 仅出现于 `src/digest.ts` 与 `src/carrier.ts`——
    （#152 扩展）Buffer 在 carrier.ts 收口 Base64 编解码两侧
    （`buildInlineCarrier` / `decodeBase64Strict`），reader/storage-gate 不得自起炉灶；
  - `node:fs` 仅出现于 `src/adapters/file.ts` 与 `src/reader.ts`——
    本包唯一 IO 面（File adapter；Node 内置模块，零新增依赖）；
    `node:path` 出现于 `src/adapters/file.ts`、`src/reader.ts` 与 `src/paths.ts`
    （后者仅 `join`——布局路径派生；终审 N-1 勘误声明：R2 声明漏列 paths.ts）；
  - 其余模块纯 TS（TextEncoder 全局可用，字节计量不引 Buffer）。
- 不依赖 yjs / clock / registry / persistence；只依赖 `@nomicore/vfsl`
  （compileSchemaEnvelope / validateLogicalSnapshot）。
- 不改 ADR（`docs/adr/**` 冻结源）；`VFSL 校验失败 = writer bug`——丢弃 +
  健康上报（只带 issuePaths，不带 message），**永不外抛**、不影响业务结果。
- 不 gen genesis-baseline 记录（#152 adapter 内部构造路径，设计 §10-J1 备案）；
  v1 不写 `result:'unknown'`（§11-G3）。

## Verification

- `pnpm test`（vitest run --typecheck）覆盖设计 §9 全清单（本包
  `packages/namespace-diagnostic-log/test/**`）。
- 改 `src/schema.ts` 任何字符必须同步 `test/schema-freeze.test.ts` 钉死指纹，
  并视为 schema 版本变更（id 升 `@2`、新 stream generation、旧 stream 只读）。
- 观察者事件只允许低基数白名单字段（§8.2）：type/reason/stage/field/fromPolicy/
  recordKind/operation/schemaId/schemaFingerprint/issuePaths/projectedRecordBytes/
  queueDepth/issueCount/code（storage-validation-failed 与 storage-write-failed 的
  code 字段——固定词表或稳定 errno；#152 新事件成员形状一致）——
  **（#153）追加 `repair` / `truncatedBytes`（`stream-tail-repaired`）与 `cause`
  （`stream-generation-rotated`）——均为封闭枚举/计数类字段；streamId/segment/
  offset 刻意不进事件**（身份经 adapter 实例上下文可得，低基数纪律）。
  禁原 record/input/Base64/update bytes/message/stack。
