# SA6 红灯契约报告 — Issue #155: Expose diagnostic replay and Host lifecycle configuration

> 阶段：Phase 1 acceptance anchoring（实现前初始契约）。
> 输入：任务简报 `wiki/raw/task_expose-diagnostic-replay-host-lifecycle.md`、SA8 决策产物
> （`_relevant_decisions.md` / `_conflict_report.md`，verdict `clear`）、ADR-0011/ADR-0012-LOG
> （replay 报告形状与缺陷清单原文）、#150/#151 SA6 红灯契约先例。
> 角色声明：本报告只写测试，未改任何生产代码；未 push；未触碰既有测试。

## 交付物

| 项 | 值 |
|---|---|
| 测试文件 | `apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts`（新增，22 用例，~1050 行） |
| 运行命令 | `pnpm exec vitest run apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts` |
| 运行方式 | 独立进程后台执行（vitest run，两次独立复跑）；红灯期零 spawn、零端口占用（E2E 用例在 parse 断言门即止） |
| 运行结果 | **22/22 FAIL**（两次一致）；`Type Errors no errors`；Duration ~1.1s；exit 1 |
| 类型检查 | `pnpm exec tsc -p apps/yjs-server/tsconfig.json --noEmit` = 0 errors（git status 另见下） |
| 工作树改动 | 仅新增测试文件 + 本 wiki 档案追加（task brief 尾部 SA6 节 + 本文件）；`node_modules`/`.pnpm-store` 均已被 .gitignore 覆盖 |

## 红灯证据（实测，两次独立复跑一致）

```
Test Files  1 failed (1)
      Tests  22 failed (22)
Type Errors  no errors
Duration    1.07s（两次 1.06s / 1.07s）
exit code   1
```

失败形态两档（诚实、非伪红）：

1. **配置面红灯（11 用例 = Part1 6 + Part3 E1–E5 5）**：
   `ConfigValidationError: invalid yjs-server app config: diagnostics: unknown top-level key:
   diagnostics`（`violations: [{path:'diagnostics', reason:'unknown top-level key: diagnostics'}]`）——
   基线 config 校验器拒绝顶层 `diagnostics`；正例（期望接受）在 parse 处红；负例（期望精确
   violation path `diagnostics.wat` / `diagnostics.retention.maxAgeMs` / …）因今日仅粗粒度
   `diagnostics` 路径而红。
2. **replay 工具面红灯（11 用例 R1–R11）**：调用门
   `@nomicore/yjs-server` 入口无 `replayNamespaceDiagnosticLog` 导出
   （`typeof !== 'function'`，明示契约信息）——能力整体缺失；SA3 落地导出后同一批用例自动
   转为完整行为断言，测试文件零改动（#151 先例同款失败/转绿机制）。

## 表面提案（PROPOSAL — 供 SA1/SA2 设计仲裁；语义红线不变）

| 面 | 提案 | 依据/仲裁点 |
|---|---|---|
| `AppConfig.diagnostics` | `{ enabled: boolean; rootDir: string; retention?: { maxAgeMs?: number\|null; maxBytesPerNamespace?: number\|null }; updateCapture?: boolean; inputPolicy?: 'none'\|'digest'\|'redacted'\|'full' }`（hub/peer 通用、本地旁路） | AC1/AC2；键名/嵌套仲裁可改，行为断言不动 |
| `replayNamespaceDiagnosticLog(request: { rootDir; namespaceId })`（@nomicore/yjs-server 入口导出） | `{ status: 'complete'\|'partial'\|'failed'; lastAppliedSequence: string\|null; issues: { code: string }[]; snapshot?: Uint8Array }` | 报告形状逐字段 = ADR-0012-LOG §Strict reader 冻结文本；归 Host 工具面（ADR-0011 §Interface「完整查询、导出、重放…属于日志存储/工具模块的 interface」；yjs-server 为本仓唯一 Host 组合根且可依赖 yjs 构造 detached 快照）。归属/命名仲裁不同 → 仅 import/gate 行修订 |

replay issue 类别码（契约提案，语义类取 ADR-0011 五条件/ADR-0012-LOG 缺陷清单原文词，
物理类沿用 strict reader 既有码）：`genesis-missing` / `update-omitted` /
`history-trimmed` / `sequence-gap`（既有）/ `invalid-json`（既有）/ `incompatible-format` /
`identity-mismatch` / `stream-absent`。测试对缺陷类按「含类别词」断言（`arrayContaining +
stringContaining`），具体字面量仲裁可修订。

## 契约覆盖矩阵（AC → 用例）

| 验收标准 | 用例 | 断言锚点（全部为运行时行为） |
|---|---|---|
| AC1 本地旁路配置、创建起记录、不进 SCHEMA/META/ROOT/snapshot/wire | 配置面 6（hub/peer 各自接受、enabled:false、retention null/0、未知子键/非法形状精确 path）；E1；E4；E5 | parse 接受并原样保留；provision create → `current.json` + 单一 stream + 首条 `genesis-baseline` + `namespace-create`/`replication-enable` attempt；ROOT 业务值照常；persistence snapshot 文件 bytes 无 `updateCapture/inputPolicy/diagnostics/logRoot` 标记；peer 配置不携带 diagnostics（独立本地旁路）且复制收敛后 peer 数据面无策略 |
| AC2 冻结格式策略改变 → 新 generation；非格式可调不改解释 | R10 | 同 rootDir/namespaceId 冻结策略改变（inlineUpdateMaxBytes 4096→8192）→ 新 streamId（rotate）、current.json 指向新 generation、旧 generation 独立存留；replay 基于当前 generation 自身链（complete + lastAppliedSequence = 当前流尾）——不自动拼接 |
| AC3 多 Runtime generation 共享单 writer；shutdown 有界 drain | E3；E5 | hub SIGTERM（同 file persistence + 同 logRoot 重启 → 新 Registry/Runtime generation）→ streamId 不变、stream 目录数恒 1、strict read ok 且 sequence 连续、genesis 仍在首条、重启后记录续写同一流；SIGTERM 30s 界内 exit 0（Registry/Persistence 停机不被日志无限延迟）；停机后日志 strict 一致 |
| AC4 replay 强制 strict、valid genesis + 连续 committed updates、owned detached bytes、不暴露 live Y.Doc、不自动跨 generation | R1；R2；R10 | 健康链（genesis + create + 3 真实 Yjs 增量 + noop）→ `complete`、issues 空、`lastAppliedSequence` = 末记录序列；snapshot 应用到 detached 新 Y.Doc 复现生产终态（逻辑状态逐键相等）；重复调用字节稳定、篡改返回 bytes 不影响后续（owned 副本非 live 引用）；replay 不改动磁盘日志流 |
| AC5 complete 仅限冻结连续性条件；七类缺陷 → partial/failed；disclaimer | R3–R9；R11 | 缺 genesis / retention 裁剪 / 中段 gap / 中段损坏 / update omitted（capture=false → `update-omitted`/`update-capture-disabled` 落盘形状先验）/ identity mismatch（doc META.docId ≠ 请求 namespaceId）/ 不兼容格式（manifest frameVersion=99）/ 无日志 —— 一律 `status !== 'complete'` + issues 报类；R11 无日志钉死 `failed` + snapshot 缺席 + lastAppliedSequence null；complete 语义边界（best-effort disclaimer）随 R1 报告形状保留 |
| AC6 E2E 组合场景 | E1–E5 + R 系列 | 真实进程（tsx main.ts + NDJSON + stdin 控制通道，T6 套件同款原语）；hub file persistence + provision；verify-write（ROOT）→ replace-schema（SCHEMA）→ 记录链存在且 sequence 连续；日志故障隔离（diagnostics.rootDir = 普通文件 → provision/read 照常）；hub 重启 + peer 收敛 + 续写；三态 replay 缺陷矩阵 |

## 夹具健全性（红线之外依赖既有行为的探针，7/7 PASS；探针已删除）

绿灯期夹具所依赖的 adapter/reader 行为以临时 tsx 探针独立验证：①健康链 seq 1..6 且首条
genesis-baseline、strict ok；②capture=false 落盘 `effect:update-omitted,
reason:update-capture-disabled`；③rolling target=1（5 段）+ 注入 clock + retention sweep
（maxAge 60s）删除 4 闭组、trim 后 strict read ok（发现并修正夹具：genesis observedAt 与
manifest createdAt 同源注入时钟，否则组年龄按真实时钟永不超期）；④冻结策略改变（inline
threshold）→ rotate 新 generation + locator 更新；⑤中段删完整行 → `sequence-gap`；
⑥垃圾行 → `invalid-json`；⑦manifest frameVersion=99 → `incompatible`。

## 依赖与风险注记（供 SA1/总控）

1. **表面提案即契约锚**（#150 先例）：SA1 设计必须显式对照本契约；键名/归属/函数名仲裁差异
   → 仅修订本文件对应 import/gate/断言字面量行，行为红线（complete 条件、七类缺陷不完整、
   owned bytes、数据面隔离、重启续流、停机有界）不可弱化；仲裁结果须在设计档案中记录。
2. **partial/failed 细分未冻结**（ADR 仅冻结「只能 partial/failed」）：除 R11（无日志 = failed
   已钉死）外，缺陷类用例断言 not-complete + 类别码；partial（部分应用+前缀快照？）与 failed
   （不可重放）的细分语义归设计裁决，必要时按仲裁在断言中补精确状态。
3. **E5 绿色期复核点**：hub 重启 + peer 显式恢复 + 续写同一 stream 的编排沿用既有 T6 模式，
   但「hub 重启后日志续写」为本票新接线；SA3 落地后首轮绿灯验证若与既有重启语义交互有出入，
   属实现缺口（由 SA3 修），不是夹具缺陷（夹具已按 T6 实测模式构造）。
4. **环境注记**：pnpm 默认全局 store 在本次沙箱为只读（EROFS），安装改用
   `--store-dir <worktree>/.pnpm-store`（已被 .gitignore 覆盖，无工作树污染）；测试运行零固定
   端口（freePort 动态分配），红灯期零 spawn；`scripts/test-lock.sh` 本仓不存在，未更新。
5. 未触碰任何生产文件与既有测试；`git status` 仅新增测试文件 + wiki 档案（简报追加 + 本报告）。

## 验证命令与证据（复现）

```bash
cd /home/wangjian/nomicore-fix-issue-155
pnpm install --frozen-lockfile --store-dir .pnpm-store        # exit 0（沙箱 store 只读 workaround）
pnpm exec tsc -p apps/yjs-server/tsconfig.json --noEmit       # TSC_EXIT=0，0 errors
pnpm exec vitest run apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts --reporter=verbose
# → Test Files 1 failed (1); Tests 22 failed (22); Type Errors no errors; Duration ~1.07s; exit 1
#   （两次独立复跑一致：2026-08-31 20:31 / 20:34）
```
