---
status: complete
run_id: issue-148-1787889316-3529662
branch: fix/issue-148-on-docs-namespace-diagnostic-change-log
round: 1
---

# Issue #148：Freeze the v1 diagnostic record contract and memory adapter

## 需求理解

为 namespace 诊断变更日志（ADR 0011/0012）交付第一条完整、可测试的路径：**non-throwing 语义 emitter** + **有界内存 adapter**。Producer 以冻结的 v1 operation/result 词表提交 detached 语义结局；输入捕获四策略（none/digest/redacted/full）只消费既有安全快照；issues 等可变字段按文档化预算确定性投影；内建冻结 VFSL schema 校验最终 v1 record；日志侧一切故障（队列压力、校验缺陷、observer 异常）与 namespace 业务行为完全隔离。

切片边界：本票只做契约 + 内存 adapter。#149–#151（真实 Runtime/Registry/replication 接线）、#152（File adapter/manifest/NDCL frame/strict reader）、#153（滚动/修复）、#154（retention）、#155（replay）均不在范围。冻结的 VFSL schema 不加修改即可服务 #152（inline 与 sidecar 两种 update carrier 形状均可表达，有测试锚）。

## 改动摘要（2 commits：ae3aeec + 687aa94，基线 6de2f1d）

**新包 `@nomicore/namespace-diagnostic-log`**（packages/namespace-diagnostic-log/，17 src + 12 test + 2 helper + 骨架）：

- `src/vocabulary.ts` / `record.ts` / `emission.ts`：冻结 v1 词表与类型——6 operation、8 stage、8 成员 result 判别联合（TS 字面量锁死 fatal committed↔effect 相关性）、source/context 形状、七值 InputCapture、语义 emission（不含任何物理表示）。
- `src/schema.ts` / `schema-patterns.ts`：内建冻结 VFSL record schema（id `nomicore.namespace-diagnostic-change-record@1`，ROOT = AttemptRecord | GenesisBaselineRecord 两族 recordKind 判别联合；Pattern 常量 TS↔schema 单源插值、零反斜杠）。envelope 指纹 `sha256:v1:dedad2ab93d9df9224960ca094924168f8bcc1c0512dfdd0a03dc6e66613e070` 钉死为编译期常量断言。
- `src/pipeline.ts`：emitter 管线（intake 结构校验 → attemptId 缺省 CSPRNG → 输入投影 → issues 投影 → enrichment 清洗 → 组装深冻结语义 record → sink）；全路径顶层兜底，任何失败不 throw/不阻塞。
- `src/projection/input.ts` / `canonical-json.ts` / `digest.ts`：四策略输入捕获（事实优先于策略）；digest = SHA-256(RFC 8785 JCS bytes)（JCS 纯 TS + node:crypto）；plainness 守卫（非 plain 对象 → unavailable，不重读）；redacted 确定性脱敏 + 1M 节点护栏。
- `src/projection/issues.ts`：确定性截断（JSON 字面量字节基准、code point 完整、marker 14B 精确预留、小预算 loud 断言）；段级 JSON-safe 判定；presence 严格 ⇔ 预算截断（与冻结 schema JSDoc 逐字一致）。
- `src/adapters/memory.ts`：有界内存 adapter（默认容量 1024、drop newest、保序、sequence 十进制字符串进位 + exhausted 模式、line 预算先降级 digest 后丢弃、VFSL 门、stats 对账）；`src/crc32c.ts`（纯 TS，ADR KAT e3069283）、`src/carrier.ts`（Buffer Base64 inline 物理化）。
- `src/health.ts`：8 型健康事件判别联合（低基数字段白名单，禁 record/input/Base64/message/stack），observer 故障双层隔离 + fallback logger。
- `src/testing.ts`：确定性 RandomSource、事件收集 observer、final-record 直通注入、自定义 envelope 工厂、sequence 预置、内部原语直测导出。

**根文件最小改动**：`package.json` typecheck 追加新包一段；`pnpm-lock.yaml` 仅新增本包 importer（+16 行）；`CONTEXT.md` 仅新增 3 受控词条（语义 emission / storage projection / genesis baseline record，含 update-omitted 三值 reason 词表）。

**流程工件**：wiki/raw/task_diagnostic-log-v1-contract{,_design,_sa2_review,_sa6_red,_sa3_impl,_sa4_review,_sa7_report,_ac_checklist,_standards_review,_spec_review,_dispatch}.md。

## 验证证据（最终状态 687aa94，全部后台进程亲跑）

| 命令 | 结果 |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0（SA7 独立复跑；lockfile 与 CI install 步同口径） |
| `pnpm typecheck`（11 包链含新包） | exit 0（`.mabf-bg/r5-typecheck.log`） |
| `npx vitest run --typecheck packages/namespace-diagnostic-log` | exit 0，**12 文件 / 164 测试全绿，Type Errors 0**（`.mabf-bg/r5-green.log`） |
| `pnpm test`（全仓） | exit 0，**130 文件 / 1569 测试全绿，Type Errors 0**（`.mabf-bg/r5-test.log`；基线 118/1405 → 净增 12 文件 164 测试） |
| 指纹独立复现（干净 tsx 进程，公共面导入） | envelopeFingerprint === 钉死常量 ✓，信封恰四键深冻结 ✓（SA7） |
| 冻结文本一致性 | RECORD_SCHEMA_TEXT 与设计 §3.3 逐字符相等（7040B，含尾随 \n；SA4/spec 轴双脚本实证） |

**AC 验收**（wiki/raw/task_diagnostic-log-v1-contract_ac_checklist.md，SA7 + spec 轴双重独立复核）：AC1–AC5 全部 pass。

**性能量级**（SA7，node:perf_hooks）：默认 digest 策略 256 KiB 快照 ×1000 emit：总 2997.6ms，p50 2.80ms / p95 4.13ms；1M 节点护栏 49.3ms 收编 unavailable；全程同步无 IO/await。

**流水线纪律**：测试先行（SA6 红灯 exit 1，根因均为 src 缺失）→ SA3 实现 → SA4 审查（5 concern 经 R4 处理）→ SA7 验收 pass → 双轴终审（standards + spec 并行，各 pass-with-issues）→ R5 修复（7 concern 全修）→ 双轴复审**均 pass**。总控裁决记录：§11 六项（G1–G6）、R3（updateBytes 复制隔离——V8 无法冻结非空 typed array，ADR「已转移或已复制」取复制）、R4/R5 勘误批（含 C-3 presence 再裁决：严格 ⇔ 预算截断，与冻结 schema JSDoc 一致）。

## 遗留风险

1. **GenesisBaselineRecord 形状是设计裁决**（§11-G2，总控批准）：ADR 0012 要求 genesis baseline 但未定义形状；v1 冻结 emission/sink 面无 genesis 构造路径（#152 需增设 adapter 内部构造，**不改 schema**）。若 #152 评审否决该形状，须 bump schema 版本（冻结纪律本身是安全网）。
2. **fatal committed↔effect 相关性不被 VFSL 机器锁死**（VFSL v1 无布尔字面量）：由 TS 字面量类型 + emitter 唯一构造点 + 契约测试三重强制；schema 只放松不收紧，不会拒绝合法 record。
3. **内存路径超大 update 必丢**（无 sidecar，≳780 KiB Base64 后超 1 MiB line 预算）：ADR 字面顺序的诚实后果，有测试锚；#152 sidecar 天然免除。
4. **P_BASE64 引擎接受空串**（SA6 实测 vfsl 引擎行为，与设计原论证前提不同）：0 字节 update 由 empty-update 前置守卫结构性覆盖，不依赖 Pattern 拒绝；备案。
5. **Nano 台账**（standards 轴 7/14 未修，均「记录即可」级：死 eslint-disable、同义反复 expectTypeOf、弱断言标题等）；spec 轴残留 3 nano（records() 浅冻结、AGENTS.md 历史轮次措辞、设计文档旧措辞已修）。不阻塞。
6. **CI 矩阵（Node 20/24）证据属发布阶段**：本地 Node 24 全绿 + `--frozen-lockfile` 前置验证已过；最终 CI 状态由 Host 发布流程确认。
