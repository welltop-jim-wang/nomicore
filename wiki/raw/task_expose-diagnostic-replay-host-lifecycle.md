# Task Brief — Expose diagnostic replay and Host lifecycle configuration

- **Repository:** welltop-jim-wang/nomicore
- **Issue:** #155
- **Task Type:** Feature
- **Source:** GitHub issue #155

## What to build

Expose the namespace diagnostic change log as optional local Host/Registry observability with bounded lifecycle management and strict diagnostic replay. Operators can independently enable Hub and Peer logging, tune non-format policy, inspect health, drain best-effort during shutdown, and receive owned snapshot bytes with an honest complete, partial, or failed report.

## Acceptance Criteria

1. Host/Registry configuration enables logging locally from namespace creation onward without writing policy into SCHEMA, META, ROOT, Persistence snapshots, or replication wire state.
2. Stream-format policy changes create a new generation, while retention, queue, batching, flush, file-descriptor, and metrics tuning can change without altering record interpretation.
3. Multiple Runtime generations share one ordered namespace writer, and shutdown performs only a bounded best-effort drain that cannot indefinitely delay Registry or Persistence shutdown.
4. Replay always uses strict reading, applies a valid genesis and continuous committed updates, returns detached owned snapshot bytes, and never exposes a live Y.Doc or automatically joins generations.
5. Replay reports complete only under the frozen continuity conditions and reports partial or failed for missing genesis, omitted updates, retention cuts, gaps, corruption, identity mismatch, or incompatible formats, while preserving the best-effort disclaimer.
6. End-to-end tests combine create, ROOT/SCHEMA, replication, restart, retention, logging failure, Host shutdown, and complete/partial/failed replay scenarios.

## Blocked by

- #149
- #150
- #151
- #153
- #154

---

## SA6 红灯契约记录（Phase 1 acceptance anchoring — 实现前初始契约）

> SA6 阶段产出（2026-08-31；Phase 1 anchoring acceptance contract before design）。完整档案：
> `wiki/raw/task_expose-diagnostic-replay-host-lifecycle_sa6_red.md`。只写测试，零生产代码改动。

### 交付物

| 项 | 值 |
|---|---|
| 测试文件 | `apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts`（新增，22 用例） |
| 运行命令 | `pnpm exec vitest run apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts` |
| 运行结果 | **22/22 FAIL**（两次独立复跑一致；exit 1；`Type Errors no errors`；Duration ~1.1s） |
| 类型检查 | `pnpm exec tsc -p apps/yjs-server/tsconfig.json --noEmit` = 0 errors |

### 红灯形态（诚实、可复现、两档）

1. **配置面（11 用例）**：AppConfig 顶层携带 `diagnostics`（PROPOSAL 键）→ 当前基线
   `parseAppConfig` 抛 `ConfigValidationError`（`diagnostics: unknown top-level key`）——操作员
   启用意图被拒，正是 AC1 缺失面的诚实失败形态；负例断言 violation path 粒度
   （`diagnostics.wat` / `diagnostics.retention.maxAgeMs` …）亦红（今日 path 为粗粒度 `diagnostics`）。
2. **replay 工具面（11 用例）**：`@nomicore/yjs-server` 入口无 `replayNamespaceDiagnosticLog`
   导出 → 每个用例在调用门（`typeof !== 'function'` + 明示信息）红灯——能力整体缺失的诚实失败
   形态（#151 先例同款）。SA3 落地导出后同一批用例自动转为完整行为断言（complete/partial/failed
   语义、快照复现、缺陷分类码），测试文件零改动。

### 表面提案（PROPOSAL，供 SA1/SA2 设计仲裁；语义红线不变）

- `AppConfig.diagnostics`（hub/peer 通用、本地旁路）：
  `{ enabled: boolean; rootDir: string; retention?: { maxAgeMs?: number|null;
  maxBytesPerNamespace?: number|null }; updateCapture?: boolean;
  inputPolicy?: 'none'|'digest'|'redacted'|'full' }`（AC1/AC2；键名/嵌套仲裁可改，行为断言不动）。
- `replayNamespaceDiagnosticLog({ rootDir, namespaceId }): { status: 'complete'|'partial'|'failed';
  lastAppliedSequence: string|null; issues: {code}[]; snapshot?: Uint8Array }`
  —— 报告形状逐字段取 ADR-0012-LOG §Strict reader 冻结形状；归 Host 工具面（ADR-0011
  「完整查询、导出、重放…属于日志存储/工具模块的 interface」，yjs-server 为本仓唯一 Host
  组合根且可依赖 yjs 构造 detached 快照）。归属/命名若仲裁不同 → 仅 import/gate 行修订。

### 契约覆盖矩阵（AC → 用例）

| 验收标准 | 用例 | 断言锚点 |
|---|---|---|
| AC1 本地旁路启用（创建起、不进数据面/wire） | 配置面 6 例；E1/E4/E5 | parse 接受（hub/peer 各自、enabled:false、retention null/0）；provision create → genesis-baseline + namespace-create/replication-enable 记录；ROOT 业务值照常；snapshot 文件 bytes 无策略标记（updateCapture/inputPolicy/diagnostics/logRoot）；peer 不启用且复制数据面无策略 |
| AC2 冻结-可调二分（新 generation vs 解释不变） | R10 | 冻结格式策略改变（inline threshold 4096→8192）→ 同 namespace 旋转新 generation（streamId 变更、current.json 指向新流），replay 基于当前 generation 自身链报告（不自动拼接） |
| AC3 多 Runtime generation 单 writer / 有界 drain | E3/E5 | hub 重启（SIGTERM → 同 rootDir/logRoot 新 Registry generation）→ streamId 不变、stream 数恒 1、sequence 连续、genesis 仍在首条；SIGTERM 30s 界内干净退出（exit 0），停机后日志 strict 一致 |
| AC4 strict replay、valid genesis + 连续 committed、owned bytes、不暴露 live Y.Doc、不自动拼接 | R1/R2/R10 | complete 仅健康链；snapshot 应用到 detached 新 Y.Doc 复现生产终态；重复调用稳定、篡改返回 bytes 不影响后续（owned 副本）；日志流不被改动 |
| AC5 诚实三态：七类缺陷 → partial/failed + disclaimer | R3–R9/R11 | 缺 genesis、retention 裁剪、中段 gap、中段损坏、update omitted、identity mismatch、不兼容格式、无日志 → 均不得 complete + issues 报类；complete 保留 best-effort 边界（ADR：仅证明重放了所持记录） |
| AC6 E2E 组合（create/ROOT/SCHEMA/replication/restart/retention/logging failure/停机/三态 replay） | E1–E5 + R 系列 | 真实进程（tsx main.ts，T6 套件同款 spawn/NDJSON/控制通道原语）；file 持久化 + 真实 WebSocket hub/peer；verify-write（ROOT）与 replace-schema（SCHEMA）记录链；日志故障（rootDir 为普通文件）隔离；R 系列覆盖 retention 裁剪与三态 |

### 夹具健全性探针（红线之外的部分，已独立验证）

绿灯期夹具依赖的既有 adapter/reader 行为以临时探针（已删除）实测 7/7 PASS：健康链
seq 1..6 + genesis 首位；capture=false → update-omitted/update-capture-disabled；rolling
target=1 + retention sweep（注入 clock）删除 4 闭组、trim 后 strict read ok；冻结策略改变
→ rotate 新 generation（locator 更新）；中段删行 → sequence-gap；垃圾行 → invalid-json；
manifest frameVersion=99 → incompatible。

### 依赖/风险注记（供 SA1/总控）

1. **表面提案为契约锚**：`diagnostics` 配置键与 `replayNamespaceDiagnosticLog` 导出为 SA6
   契约提案（#150 先例：seam 形状由契约锚定）。设计仲裁若选不同键名/归属/函数名 → 修订仅限
   本文件对应行（行为断言与红线语义零改动），需在设计中显式记录仲裁结果。
2. **partial/failed 精确取值未冻结**：ADR 只冻结「七类缺陷只能 partial/failed、complete 仅限
   五条件」；本契约对缺陷类断言 `status !== 'complete'` + 类别码（genesis/gap/omitted/
   identity/invalid-json 等，物理类沿用 strict reader 既有码族），partial 与 failed 的细分
   语义留给设计裁决（除 R11 无日志 = failed 已钉死）。
3. **E5 重启链路（绿色期）**：hub 重启 + peer 收敛 + 续写同一 stream 的完整编排沿用既有
   T6（hub-restart-static-target）模式（SIGTERM/notify 等语义），但日志接线为本票新增——
   该用例的 fixture 步骤需在 SA3 落地后首次绿灯验证时复核（若既有 hub 重启语义与日志接线
   交互有出入，属实现缺口而非夹具缺陷，由 SA3 修复）。
4. **环境注记**：本 worktree 沙箱 pnpm 默认 store 只读（EROFS），已用
   `--store-dir <worktree>/.pnpm-store` 安装（.gitignore 已含 .pnpm-store）；测试无端口依赖
   （freePort 动态分配；E2E 用例红灯期在 parse 门即止、零 spawn）。
5. **scripts/test-lock.sh**：本仓库不存在该脚本，未更新（无新增固定端口依赖）。
