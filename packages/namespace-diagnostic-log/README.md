# @nomicore/namespace-diagnostic-log

namespace 诊断变更日志 v1 的语义 emission 接缝、冻结 VFSL record schema 与有界内存
adapter（issue #148 / ADR 0011 / ADR 0012）。

> **定位**：叶子 observability 模块——从 namespace 创建开始尽力记录所有变更尝试及其
> 结构化结局的可选诊断流；**不构成 Persistence 真相源**（ADR 0011 §Interface），
> 日志不参与业务提交、不承诺完整性或恢复能力。
> _Avoid_: 审计账本、WAL、event sourcing、可靠恢复日志（ADR 0011 _Avoid_ 清单）。
> 消费方 [`@nomicore/namespace-runtime`](../namespace-runtime)、
> [`@nomicore/namespace-registry`](../namespace-registry) 与复制路径（#149/#150/#151 接线）。

## 公共 API 速览

```ts
import {
  createBoundedMemoryDiagnosticLog,   // emitter + sink 一体装配（本票交付物）
  createDiagnosticChangeEmitter,      // 可复用语义管线（#152 复用，只换 sink）
  getRecordSchemaCompilation,         // 冻结 schema 编译（指纹单源）
  RECORD_SCHEMA_ENVELOPE,             // 恰四键深冻结信封（#152 manifest 内嵌）
  observedAtFrom,                     // producer 侧 Clock 兼容 helper
} from '@nomicore/namespace-diagnostic-log'

const log = createBoundedMemoryDiagnosticLog({
  inputPolicy: 'digest',   // 默认 'digest'（ADR 0011）
  issuesPolicy: 'full',    // 默认 'full'
  updateCapture: false,    // committed Yjs update 捕获默认关闭（ADR 0011 §数据保护）
})

// producer 提交语义 emission（同步、不 throw、不阻塞；所有权移交后不得再变异）
log.emitter.emit({
  operation: 'root-mutation',
  stage: 'transaction',
  observedAt: observedAtFrom(() => Date.now()),
  source: { kind: 'local' },
  input: { snapshot: { /* 操作已生成的同一份 detached frozen plain-data 快照 */ } },
  result: { kind: 'committed', effect: 'update', updateBytes },
})

log.records()      // 冻结引用数组（sequence 升序；含 streamId/sequence/recordKind 的最终 record）
log.stats()        // accepted / dropped by reason / dropped by operation×reason / queueDepth / lastSequenceAssigned
```

`@nomicore/namespace-diagnostic-log/testing`（确定性 RandomSource、事件收集型
observer、final-record 直通注入、自定义 envelope 工厂、sequence 预置工厂与纯 helper）——
仅测试可用性服务，不是产品面。

## 配置（DiagnosticLogConfig，全部带默认）

| 键 | 默认 | 说明 |
|---|---|---|
| `inputPolicy` | `'digest'` | `none` / `digest` / `redacted` / `full`（ADR 0011 输入捕获） |
| `issuesPolicy` | `'full'` | `none` / `full` / `redacted`（issues 统一投影策略） |
| `updateCapture` | `false` | committed update 捕获（Host 明确启用，ADR 0011 §数据保护） |
| `lineBudgetBytes` | `1 MiB` | 最终 record 紧凑 JSON UTF-8 字节硬上限（不含结尾 `\n`） |
| `payloadMaxBytes` | `64 MiB` | 单个 update payload 字节硬上限（≤ uint32） |
| `capacity` | `1024` | 内存队列容量（条数） |
| `observer` | — | 低基数健康观察者（同步；故障经 fallbackLog 隔离） |
| `fallbackLog` | `console.error` | observer 故障的单行稳定码 fallback logger |
| `randomSource` | `node:crypto` | CSPRNG 注入接缝（仅 streamId/attemptId 用途；测试注入确定性源） |

## 容量与预算上界

- **驻留上界**：`capacity × lineBudgetBytes`（每条已接纳 record 必过 line 预算；
  最坏 ≈ 1024 × 1 MiB ≈ 1 GiB）。按业务调整 `capacity`/`lineBudgetBytes`。
- **line 预算顺序**（ADR 0012 §投影）：超限先降级 input（full/redacted → digest +
  `degraded:'projected-input-too-large'`）；仍超限则丢弃整条 record 并健康上报，
  不影响业务。无 sidecar 环境大 update（Base64 后超预算）必走丢弃分支
  （`§10-J9` 备案；#152 文件 adapter 的 sidecar 天然免除该分支）。
- **超预算更新**：超 `payloadMaxBytes` 的 update 转
  `update-omitted` + 稳定 reason（见 AGENTS.md 词表），attempt metadata 保留。

## 契约与纪律

- 冻结 v1 record schema：`RECORD_SCHEMA_ID` +
  `RECORD_SCHEMA_ENVELOPE`（指纹 `sha256:v1:dedad2ab…`，单源 `src/schema.ts`）。
  文本任何改动 = 新 schema 版本（`@2` + 新 stream generation + 旧 stream 只读）。
- `emit` / `append` 同步、**绝不 throw**、绝不阻塞；全部失败路径走健康 observer
  （低基数白名单字段），不改业务结果。
- 存储投影（inline/sidecar/segment/frame/offset/CRC/Base64）归 adapter；emitter 只做
  语义投影。本包内存 adapter 只产出 inline 形状，记录 JSON 与文件 JSONL 逐字段同构。
- best-effort：进程中断的尝试直接缺失（不落 `result:'unknown'`；ADR 0011/0012 拼接
  结论 `§11-G3`）；replay 不得把缺失推断为任何结局。
