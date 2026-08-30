# SA2 设计 — Issue #154：有界 namespace 诊断存储：保留（retention）、读租约（lease）与逻辑删除（deletion）

**Date**: 2026-08-30
**Author**: SA2（design dispatch 342da82a-2e27-4dfa-8d59-cf3833bd5282）
**Status**: 待 SA4/SA8 门禁审查
**任务简报**: 根目录 `TASK.md`（MABF issue #154；dispatch log `wiki/raw/task_issue-154_dispatch.md`）
**父 PR**: #142 = commit `6de2f1d`（`docs/adr/0011-best-effort-namespace-diagnostic-change-log.md` + `docs/adr/0012-vfsl-validated-jsonl-and-framed-sidecar-change-log.md` + CONTEXT.md 增量）
**约束基准**: ADR 0011（best-effort 隔离语义）、ADR 0012（§Retention 与删除 / §打开与尾部恢复 / §File adapter 布局 / 2026-08-28 first-slice amendment）

---

## §0. 范围、非目标与依赖验证

### §0.1 交付范围（对应简报「What to build」）

File adapter 的有界存储三件套，全部落在 `packages/namespace-diagnostic-log`：

1. **Retention**：按 namespace 可配置 `maxAge` / `maxBytesPerNamespace` 裁剪**已关闭且无读租约**的 segment group（`null` 关限制、`0` 保持其「非无限」文档语义）；删除协议以 JSONL 为 group 提交标记、可跨重启恢复。
2. **读租约**：`openReadSession()` 短期可续租 segment 租约，使 cleanup 不会删除正在被检视的 segment；过期租约不得永久阻塞 retention。
3. **namespace 日志逻辑删除**：管理能力一次性移除 active locator、manifests、JSONL、BIN、deletion 标记与 adapter 索引；只承诺活跃存储的逻辑删除，绝不暗示 SSD/备份/对象存储版本的安全擦除。

### §0.2 非目标（明示排除，防范围蔓延）

- **不改** record schema 文本/指纹（`schema-freeze.test.ts` 钉死）、manifest 17 键形状、`emit` seam、v1 词表、CRC/frame 格式、`#148` 冻结面任何既有成员。
- **不做** replay 工具与 Host/Registry 接线（#155/#149–#151）；`namespace-runtime` 现有依赖面零强迫变更（本设计全部为**增量导出**，见 §2.8）。
- **不做** queue/batch/fsync、常驻 fd、跨进程锁（ADR 0012 部署约束：单进程独占根目录——本设计的租约注册表正确性建立在该约束上，见 §11-A6）。
- **不做** memory adapter（`adapters/memory.ts`）的 retention/删除：ADR 0012 retention 条款是 File adapter 布局规范；memory adapter 生命周期由持有者控制。`deleteNamespaceDiagnosticLog` 是 File 布局管理操作。
- **不承诺**按 wall clock 的 locator 判定（ADR 0012 §File adapter 布局既有纪律）；retention 的年龄判定用 **record 自带 `observedAt`**，绝不用文件 mtime（§4.5-R3）。

### §0.3 依赖 #153 接口可用性验证（Blocked-by 门禁）

静态验证（本 worktree `fix/issue-154-on-docs-namespace-diagnostic-change-log` @ `722bddf`）：

| #153 交付面 | 位置 | 本设计的消费方式 |
|---|---|---|
| `analyzeStreamForResume` / `ResumeStreamState`（reopen 健康证明 + 滚动状态种子） | `src/reader.ts:792`（导出于模块层，`file.ts:55` 消费） | §7.5 prefix 容差改造的唯一改动点；`currentSegment`/计数器种子直接复用 |
| segment group 滚动（三 roll target、8 位段名、`'99999999'` 耗尽） | `src/adapters/file.ts:604-622`（`beforeCommit`）、config `:89-94`、manifest 17 键 `:177-210` | 「闭组」判定 = 段号 < writer `currentSegment`（§4.1） |
| `segmentFilePaths` / `streamLayoutPaths` 布局派生 | `src/paths.ts:49-72` | 删除协议/namespace 删除全部路径经此派生，不自起路径拼接 |
| 交叉扫描 + 尾部修复（C1/C2/C3、orphan 帧语义、ENOENT≠不可读三分支） | `src/reader.ts:736-783, 915-1021` | §7.2 orphan BIN 清理与其「最终尾部」语义边界对齐（只清整组孤儿，不碰 SegMax 尾帧） |
| `readStreamStrict` 连续性状态机（expected 锚从 `1n` 起） | `src/reader.ts:460-620` | §7.1 结构化 trim 判定插入该状态机（保既有钉死测试，见 §7.1-E） |

动态验证（本 worktree 实测）：

```text
$ pnpm install --frozen-lockfile --prefer-offline
Done in 426ms using pnpm v10.28.2
$ npx vitest run packages/namespace-diagnostic-log/
Test Files  22 passed (22)
     Tests  381 passed (381)
Type Errors  no errors
```

结论：#153 契约面在当前基线**可用且全绿**，#154 可开工。

---

## §1. 验收标准 → 设计条款映射

| 简报 AC | 设计条款 | 红灯测试 |
|---|---|---|
| 1. age/bytes 可配置；`null` 关限制；`0` 保持文档化「非无限」语义 | §2.1（配置面与语义表）、§4.5（两遍算法）、INV-11 | T-A1–T-A8 |
| 2. 只有 closed+unleased 闭组可删；JSONL/BIN 成对删除走可恢复的 JSONL-as-commit-marker 协议（跨重启窗口） | §4.1–§4.2、INV-1/2/3/4、§6 矩阵 W0–W3 | T-B1–T-B10 |
| 3. strict reader 短期可续租读会话租约；过期租约不得永久阻塞 retention | §2.3、§4.3、INV-4/9 | T-C1–T-C8 |
| 4. namespace 日志删除覆盖 locator、manifests、JSONL、BIN、deletion 标记、adapter 索引；不暗示 secure erase | §2.4、§4.4、INV-8/12 | T-D1–T-D9 |
| 5. 测试覆盖 age/byte 前沿、开组保护、活跃/过期租约、每一步中断删除、orphan 清理、保留历史报告、完整 namespace 删除 | §9 全表 | §9 |

---

## §2. 公共 API（Public API）

> 全部为**增量**：既有导出一字不动（#152 纪律「既有导出一字不动」延续）。类型新增字段对既有消费者向后兼容（可选字段）。

### §2.1 Retention 配置与 `null`/`0`/缺省语义（AC-1）

```ts
/** src/retention.ts —— retention 配置（纯类型；不冻结进 manifest）。 */
export interface FileRetentionConfig {
  /**
   * 年龄上限（毫秒）。缺省 = 30 天（ADR 0012 默认）。
   * - undefined        → 默认 2_592_000_000（30d）
   * - null（显式）     → 关闭年龄限制（ADR 0012「显式 null 关闭某个限制」）
   * - 0                → 一切闭组立即过期（「0 不表示无限」）
   * - n > 0            → group 内最晚 committed record 的 observedAt 距 now ≥ n 时过期
   */
  maxAgeMs?: number | null | undefined
  /**
   * 每 namespace 字节上限（JSONL+BIN 之和，跨全部 stream generation）。
   * 缺省 = 1 GiB。null → 关闭字节限制；0 → 裁掉全部可删闭组（开组永不计删）。
   */
  maxBytesPerNamespace?: number | null | undefined
  /** 构造完成后自动执行一次 sweep；默认 true（ADR「File adapter 内置可配置 retention」）。 */
  sweepOnOpen?: boolean | undefined
}
```

`FileDiagnosticLogConfig` 追加（`src/adapters/file.ts`）：

```ts
/** null / undefined = 默认（30d + 1 GiB）；对象 = 显式配置。 */
retention?: FileRetentionConfig | null | undefined
```

**值域与失败语义**：`number` 分支必须 `Number.isSafeInteger(value) && value >= 0`；违规（负数、NaN、∞、小数、非数字类型）→ **retention 失活**（不删任何东西）+ 恰一次健康事件 `retention-config-invalid{field}`，**stream 照常工作**（与 `invalid-roll-targets → disabled` 刻意不同：roll targets 是冻结进 manifest 的身份，retention 属 ADR 明文的「可动态调整」类，配置错不应杀死日志能力）。

**`0` 语义表（文档化「非无限」含义，测试钉死）**：

| 配置 | 语义 |
|---|---|
| `maxAgeMs: 0` | 每次 sweep 时所有闭组年龄已过期（cutoff = now，group 年龄恒 ≥ 0）→ 尽删全部可删闭组 |
| `maxBytesPerNamespace: 0` | 字节遍历目标把「闭组字节」压到 0；下限 = 开组字节 + 被租约/开组阻塞的组 |
| `maxAgeMs: null` | 年龄遍历整体跳过 |
| `maxBytesPerNamespace: null` | 字节遍历整体跳过 |
| 两者皆 `null` | 无限制驱动删除；**卫生遍历仍执行**（遗留 `.deleting` 完成 + orphan BIN 清理——协议卫生不属「限制」，ADR 步骤 4/5 无条件） |

**不变式**：retention 配置**不持久化任何地方**（不进 manifest、不写状态文件）——ADR 0012「manifest 不承担频繁变化的 retention 状态」+「retention…可动态调整」；变更配置**不**产生新 generation（对照：冻结项变更才 rotate）。

### §2.2 Sweep API 与报告

```ts
/** src/adapters/file.ts —— FileDiagnosticLog 追加成员（对象形状增量）。 */
export interface FileDiagnosticLog {
  // …既有 emitter/streamId/rootDir/namespaceId 一字不动…
  /**
   * 执行一次 retention sweep：卫生遍历（遗留 .deleting 完成、orphan BIN）→
   * 年龄遍历 → 字节遍历。纯同步、绝不 throw；一切 fs 失败计数进报告。
   * now 可注入（缺省 = config.clock.now()）。
   */
  sweepRetention(options?: { now?: number }): RetentionSweepReport
}

/** src/retention.ts */
export interface RetentionSweepReport {
  sweptStreams: number                       // 参与判定的 stream generation 数
  deletedGroups: number                      // 成对删除完成的闭组数
  reclaimedBytes: number                     // 上述组 jsonl+bin 字节合计
  orphanBinsDeleted: number                  // orphan BIN 文件数
  deletingMarkersCompleted: number           // 本次完成的遗留 .deleting 协议数
  leaseBlockedGroups: number                 // 因活跃租约跳过（并止步）的组数
  openProtectedStops: number                 // 因开组保护止步的 stream 数
  failedSteps: number                        // 任一 IO 失败步骤计数
  retainedBytes: number                      // sweep 后 namespace 全部留存字节
  /** 每个仍有文件的 stream 的最早保留 sequence（扫描重建——ADR 明文）。 */
  earliestRetained: Array<{ streamId: string; sequence: string | null }>
  /** 最低幸存段 ≠ '00000001' 的 stream（历史已裁剪，见 §7.1）。 */
  historyTrimmedStreams: Array<{ streamId: string }>
}
```

触发面（**仅两处**，均 write-slot 外）：

1. 构造完成时自动一次（`sweepOnOpen` 默认 true）；
2. Host 显式 `log.sweepRetention()`。
**禁止**挂在 `emit`/`beforeCommit` 路径上：first-slice amendment 的「有界」= 每 emit 至多一条 record + 至多一帧 BIN；sweep 是可变数量 fs 操作，挂载即违反该纪律精神（§12-AT8）。

### §2.3 读会话与短期可续租租约（AC-3）

```ts
/** src/read-session.ts */
export interface DiagnosticReadSessionRequest {
  rootDir: string
  namespaceId: string
  streamId: string
  /** 单次租期 ms；默认 15_000；须 ≥1 的 safe integer。 */
  ttlMs?: number | undefined
  /** 会话最长可续租总时长（自 open 起）；默认 null = 显式续租模式（ADR 允许：
   *  「长期 reader 必须有最大 lease 时长**或**显式续租」——取后者为默认）。 */
  maxLifetimeMs?: number | null | undefined
  clock?: { now(): number } | undefined
}

export interface DiagnosticReadSession {
  readonly rootDir: string
  readonly namespaceId: string
  readonly streamId: string
  /** open 时刻枚举的 segment 快照（升序；§4.3 快照语义）。 */
  readonly segments: readonly string[]
  /** 当前租期到期时刻（epoch ms；close 后无意义）。 */
  readonly leasedUntil: number
  readonly closed: boolean
  /** 续租：已 close 或超出 maxLifetimeMs → false；否则全员续 ttl 并 true。
   *  注意：租约是对 retention 的劝告锁，不是数据持久性承诺——过期窗口内数据
   *  可能已被裁剪；renew() === true 不保证快照仍完整（调用方仍须容忍 ENOENT/裁剪）。 */
  renew(): boolean
  /** 立即释放全部租约（幂等）。 */
  close(): void
}

export function openDiagnosticReadSession(req: DiagnosticReadSessionRequest): DiagnosticReadSession
```

- 枚举规则与 reader/sweep 同源（`reader.ts` 内部导出 `enumerateSegmentGroups(segmentsDir)`，见 §3——防双份漂移，同 `storage-gate` 共享原语先例）。
- **注册表**：模块级 `Map<nsKey, Map<leaseKey, LeaseEntry[]>>`，`nsKey = rootDir + '\u0000' + namespaceId`，`leaseKey = streamId + '\u0000' + segment`。进程内共享是**正确性要求**：writer adapter 实例的 sweep 必须看见无亲缘关系的 reader 会话持有的租约；单进程独占根目录（ADR 0012 §Writer）使进程内注册表充分（INV-9）。跨进程部署不在 v1 契约内。
- 过期条目惰性清理：sweep/open 检查时 `expiresAt > now` 才算活跃；**过期租约永不阻塞删除**（AC-3 后半句，INV-4）。
- 裸 `readStreamStrict`（不经会话）仍是**静态/离线工具**，与并发 retention 的一致性不在其契约内（其文件头注已声明「面向静态 stream」）；会话包装是受支持的并发读路径。Host 文档责任在接线票（#155）。

### §2.4 namespace 日志逻辑删除（AC-4）

```ts
/** src/adapters/file.ts */
export interface NamespaceLogDeletionRequest {
  rootDir: string
  namespaceId: string
}

export type NamespaceLogDeletionResult =
  | { status: 'deleted'; streamsRemoved: number }   // 本次（或幂等重试）完成
  | { status: 'absent' }                            // namespace 目录不存在（幂等成功）
  | { status: 'failed'; code: string; step: 'marker' | 'locator' | 'stream' | 'remove' }
  // code = 稳定 errno 码（'EACCES'/'ENOTEMPTY'…）或 'invalid-namespace-id' 字面量；无 message

export function deleteNamespaceDiagnosticLog(req: NamespaceLogDeletionRequest): NamespaceLogDeletionResult
```

**协议**（`deletion.json` 为持久意图标记；每步幂等、可重入）：

```text
0. namespaceId 过安全文法（违规 → failed/invalid-namespace-id/marker，零 fs 触达——§2.6 既有纪律）
1. namespaceDir 存在？
   ├─ 不存在 → { status:'absent' }（若存在遗留删除半态也已由上一次调用清空）
2. 写 deletion.json（temp+rename 原子：{"format":"ndcl-deletion","version":1}）——意图线性化点
3. unlink current.json（+ best-effort unlink current.json.tmp）
4. 逐 stream：renameSync streams/{s} → streams/{s}.deleting → rmSync(recursive,force)
   （'{streamId}.deleting' 不满足 isSafeStreamId 文法 → 永不被扫描枚举为 stream——与段级
    '.deleting' 同一「文法不可达」论证，§12-AT5）
5. rmSync(namespaceDir, recursive, force)
6. 释放该 namespace 的租约注册表分区；该 namespace 全部会话置 closed
→ { status:'deleted', streamsRemoved }
```

**半态语义**（失败/崩溃任一步后重入即续走：步骤 2 的 marker 存在 ⇒ 3–6 续做；marker 不存在且目录存在 ⇒ 从 2 重走）：

- **步骤 2 之后、完成之前**，任何 `createFileDiagnosticLog` 构造：读 `deletion.json` 存在 → `mode='disabled'` + 恰一次 `stream-init-failed{reason:'namespace-log-deleted'}`（reason 枚举**只增一值**，#153 同款演进路径）。**禁止复活**：不 resume、不新建 generation、不写任何文件（INV-8）。
- 重入调用 `deleteNamespaceDiagnosticLog` 是**唯一**完成路径（Host 数据删除工作流重试即完成）；管理面也可手工移除 marker 复活残部（明示为部署裁量，不在代码路径内）。
- **只承诺活跃存储逻辑删除**：不暗示 SSD 削除、备份/快照/对象存储版本回收（ADR 0012 原文；文档与事件措辞均不得出现 secure erase 字样）。
- 存活 emitter 实例（同进程）不受强制停摆：其缓存路径随目录删除逐步 ENOENT → definitive pre-commit failure → `storage-write-failed` 事件 + 记录丢弃（ADR 0011 隔离：日志故障不影响业务）。v1 不提供 quiesce 钩子；Host 责任在删除后关闭/换装 adapter（接线票文档化）。

### §2.5 `readStreamStrict` 增量：保留历史报告（AC-5「retained-history reporting」）

```ts
export interface StrictStreamRead {
  // …既有字段一字不动…
  /** 历史已裁剪 iff 本次枚举到的最低段 ≠ '00000001'（纯结构判定，§7.1）。 */
  readonly historyTrimmed: boolean
  /** 最早保留 sequence（首条可枚举 record 的 sequence；无 record 时 null）。 */
  readonly earliestRetainedSequence: string | null
}
```

status 语义变更**仅限** `historyTrimmed === true` 的流：连续性锚改为「首条身份可解释 record 重定基」且**不产生** `sequence-gap` issue（状态保持 `ok`/其余 issue 照旧）；`historyTrimmed === false` 时行为**逐字节等同现状**（§7.1-E 证明既有钉死测试零回归）。

### §2.6 健康事件增量（只增不改，#152/#153 同款演进）

```ts
| {
    type: 'retention-swept'          // 每次「有动作」的 sweep 恰一次（全零动作不发，防 open 噪声）
    deletedGroups: number
    reclaimedBytes: number
    orphanBinsDeleted: number
    deletingMarkersCompleted: number
    leaseBlockedGroups: number
    failedSteps: number
  }
| { type: 'retention-config-invalid'; field: 'maxAgeMs' | 'maxBytesPerNamespace' }
```

`stream-init-failed.reason` 枚举追加 `'namespace-log-deleted'`（§2.4）。低基数纪律延续：**streamId/segment/offset 刻意不进事件**；报告对象（`RetentionSweepReport`）是数据面，可含 streamId。

### §2.7 不变面清单（改动禁入区）

manifest 17 键与 `'wx'` 不可变创建；`current.json` 恰三键 temp+rename；record schema 文本与指纹；`emit` 同步/不抛/有界；`readStreamStrict` 既有 issue 码词表与 `historyTrimmed===false` 行为；`resolveResumeCandidate` 三分支；sequence 提交点纪律（R2 §3.2——sweep 绝不推进/消耗 sequence）；环境绑定面（`node:fs` 仅 `src/adapters/file.ts` + `src/reader.ts`；`node:path` 仅 `file.ts`/`reader.ts`/`paths.ts`——**本设计不新增 fs 绑定文件**，新模块纯 TS，见 §3）。

### §2.8 对 `namespace-runtime`（唯一依赖方）的影响

零强迫变更：新导出全部增量；`retention` 配置缺省即生效（30d/1GiB 默认上界——ADR「retention 默认有界」自动获得）；Host 接线（把 `sweepRetention`/会话/删除接入 Registry 生命周期与数据删除工作流）归 #149–#151/#155。

---

## §3. 受影响模块与文件清单

| 文件 | 改动 | 性质 |
|---|---|---|
| `src/retention.ts`（**新**） | `FileRetentionConfig` 校验、`RetentionSweepReport`、年龄/字节前沿纯计算、候选排序策略 | 纯 TS，零 fs |
| `src/read-session.ts`（**新**） | `DiagnosticReadSession` + 模块级租约注册表（含 namespace 分区释放） | 纯 TS，零 fs（枚举经 reader 内部导出） |
| `src/adapters/file.ts` | config+`retention`；构造序插入 deletion 门/遗留 `.deleting` 完成/自动 sweep；`sweepRetention` 方法；`deleteNamespaceDiagnosticLog` | 既有 fs 绑定面内 |
| `src/reader.ts` | `enumerateSegmentGroups` 内部导出（去重三处现有枚举逻辑）；`readStreamStrict` 增两字段 + trim 锚规则；`analyzeStreamForResume` 同款锚规则 | 既有 fs 绑定面内 |
| `src/health.ts` | 事件联合 +2 成员；`stream-init-failed.reason` +1 值 | 只增不改 |
| `src/index.ts` | 增量导出 §2 全部公共名 | 只增不改 |
| `src/testing.ts` | **零新接缝**：确定性时钟经 `config.clock` 已可注入；中断态测试用磁盘状态直接合成（§9 方法论） | — |
| `packages/namespace-diagnostic-log/AGENTS.md` | 实现票同步：新模块绑定面声明、事件白名单增量、reason 新值、`.deleting`/`deletion.json` 文件名保留字 | 文档（非代码） |
| `test/file-adapter-retention.test.ts`（**新**） | T-A/T-B 主套件 | §9 |
| `test/file-adapter-retention-deletion-windows.test.ts`（**新**） | §6 矩阵逐窗口 | §9 |
| `test/file-adapter-read-session.test.ts`（**新**） | T-C 租约 | §9 |
| `test/file-adapter-namespace-deletion.test.ts`（**新**） | T-D | §9 |
| `test/file-adapter-retention-history.test.ts`（**新**） | §7 报告/恢复语义 + 钉死测试非回归断言 | §9 |

---

## §4. 状态机与状态转移

### §4.1 segment group 生命周期（writer 视角）

```text
            (三 roll target 任一达标, beforeCommit)              (sweep, 协议 §4.2)
 [open] ─────────────────────────────────────▶ [closed·live] ────────────────▶ (gone)
 当前组：永不删除（INV-1）                       段号 < currentSegment          ↑
     ▲                                              │  ▲                        │
     └── resume 种子（#153 ResumeStreamState）──────┘  └── 租约活跃/IO 失败：止步 ┘
```

- **闭组判定**：writer 实例内 `segment < currentSegment`（精确）；sealed generation（非本 writer 的 stream）**全部组皆闭**（无开组概念）。sweep 绑定 adapter 实例执行（§2.2），因此**不存在**「无 writer 的 standalone sweep」分支——开组保护恒精确，无需保守近似。
- 闭组存在性以磁盘为准（`enumerateSegmentGroups`）：`.jsonl`/`.bin`/`.deleting` 三类文件决定组态（§4.2 状态表）。

### §4.2 删除协议状态机（JSONL = group 提交标记；ADR 步骤 1–5 逐字落地）

组级四态 + 迁移动作（全部同步、单线程内原子交接）：

```text
 S0 live            : {seg}.jsonl [+ {seg}.bin]           ← JSONL 在 ⇒ 组完整存活（reader 全量可见）
 S1 deleting-bin    : {seg}.deleting + {seg}.bin          ← rename(jsonl→.deleting)【意图提交点】
 S2 deleting-marker : {seg}.deleting                      ← unlink(bin)（ENOENT 容忍）
 S3 gone            : ∅                                    ← unlink(.deleting)
```

| 迁移 | 动作 | 崩溃后重启续走（无外部状态） | reader 视图 |
|---|---|---|---|
| S0→S1 | `renameSync` 同目录原子 | —（S1 起可续） | 组从枚举消失：`.deleting` 不满足段文法（`isSegmentName('00000001.deleting')===false`），bin-无-jsonl 段 reader 按「零行、无 issue」处理（`reader.ts:502-504` 既有语义） |
| S1→S2 | `unlinkSync(bin)` | S1 续走 | 同上（bin 亦消失） |
| S2→S3 | `unlinkSync(.deleting)` | S2 续走 | 无变化 |
| 构造期/每次 sweep 首步 | 扫 `streams/*/segments/*.deleting`，对每个执行 S1→S2→S3 续走 | ADR「启动时继续完成遗留 .deleting」 | — |

**为何 rename 必须先行（提交标记论证）**：JSONL 是引用源；若先删 BIN，崩溃窗口留下「JSONL 引用不存在帧」→ reader `frame-missing` → 该 stream 判 corrupt → resume rotate（#153 语义）。JSONL 先行后，任何中间态都落在 reader 的**既有合法窗口**内（bin-无-jsonl = BIN-first 崩溃语义），删一半的流永不产生 `frame-missing`/`sequence-gap`——这就是「JSONL-as-commit-marker」的全部含义，也是 INV-3 的机制。

**orphan BIN 清理**（ADR 步骤 5，卫生遍历，无条件执行）：闭组、无 `.jsonl` 且无 `.deleting` 且有 `.bin` → 直接 `unlink(bin)`（无协议：无引用者；删除中断 = 下次重试，幂等）。**绝不**触碰（a）开组（BIN-first 写帧后、首条 JSONL 提交前的瞬态是活状态）与（b）SegMax 尾帧（#153 C2/C3 的领域——本设计只清**整组**孤儿，两者边界：C2/C3 处理「有 JSONL 的最大段的尾部」；本清理处理「无 JSONL 的闭组的整个 bin」）。

### §4.3 读会话状态机

```text
 [opened] ──renew()──▶ [leased(t+ttl)]（可重复；maxLifetimeMs 未超时）
     │                     │
     │ TTL 到期（惰性判定）│ close() / 释放
     ▼                     ▼
 [expired]（可再 renew 重租；数据可能已删——劝告锁语义）   [closed]（终态，幂等）
```

open 时**快照租用**：租约覆盖当次枚举的整个 segment 集（升序）。reader 顺序消费，retention 前缀止步（§4.5）⇒ 会话期间新增滚出的更高段不在快照内、也不需要（会话读的是 open 时刻快照集）。sweep 查询注册表：`(nsKey, streamId, segment)` 上任一条目 `expiresAt > now` ⇒ 该组 leased ⇒ 跳过**并止步该流**（前缀纪律）；过期条目视同不存在（AC-3「过期租约不得永久阻塞」）。namespace 删除释放整个 `nsKey` 分区并将会话置 closed。

### §4.4 namespace 删除状态机

```text
 [absent]◀────────────────────────────rmSync(namespaceDir)──────────────┐
    ▲ reopen(after full deletion): fresh 新 lineage（新 stream + genesis）│
    │                                                                   │
 [live] ──写 deletion.json（线性化点）──▶ [deleting] ──unlink current.json│
                                           │  构造一律 disabled           │
                                           │ +stream-init-failed/         │
                                           │  namespace-log-deleted       │
                                           ▼                              │
                                     逐流 {s}→{s}.deleting→rm ────────────┘
```

任意步崩溃 ⇒ 状态停在 `[deleting]` ⇒ 构造被门挡住（无复活写入）、重入调用续走到 `[absent]`。**不设 namespace 目录级兄弟重命名方案**：`{namespaceId}.deleting` 可能与真实 namespace 名（文法允许点号）冲突并导致误删他Namespace 日志——该攻击记录于 §12-AT5，`deletion.json` 内置标记方案即为其裁决。

### §4.5 Sweep 算法（两遍 + 卫生；每流前缀纪律）

```text
sweep(now):
  P0 卫生遍历（无条件，即使两限制皆 null）：
     a. 遍历 namespace 全部 stream 的 segments/，对每个 *.deleting 续走 S1→S3
     b. orphan BIN 清理（§4.2 条件）
  P1 年龄遍历：maxAgeMs ≠ null 时——
     候选序 = 流按 (manifest.createdAt ↑, streamId ↑)；流内段号 ↑
     对每流：walk 段号升序：
       组闭 ∧ 无活跃租约 ∧ 年龄过期(now − max(group 内 committed records 的 observedAt) ≥ maxAgeMs)
         → 执行 §4.2 协议；任一步 IO 失败 → failedSteps++ 并【止步该流】
       否则（开组 / 租约 / 未过期）→ 【止步该流】（前缀纪律，绝不跳洞）
  P2 字节遍历：maxBytes ≠ null 时——
     total = Σ 全部流全部组 (jsonl+bin bytes)（stat；ENOENT=0；stat throw=计 0+failedSteps++，宁少删）
     while total > maxBytes：沿 P1 同一候选序取下一可删闭组（前缀纪律同 P1）
       → 删除；total -= 组字节；无可删候选（全被开组/租约/失败止步）→ break
  报告 + （有动作时）retention-swept 事件
```

- **年龄前沿 R3**：`max(observedAt)` 必须全组扫描（observedAt 非严格单调——注入时钟可回拨）；**快速否决**优化：先读组 JSONL 末行（tail 读），末行 `observedAt > cutoff` ⇒ `max > cutoff` ⇒ 必未过期，跳过全扫（sound：max ≥ 末行值）。仅对否决失败的候选组做全量 parse 取 max。开销与构造期 resume 全量扫描同数量级（#153 现状基线），不引入新的延迟等级。
- **零记录闭组**（空 JSONL 文件，理论可达于 bin-orphan 滚动路径）：无 record ⇒ 无可保内容 ⇒ 恒视为年龄过期。
- **闭组字节照计入 total**（存在即占空间）但永不可删；`retainedBytes` 如实报告下限（诚实上界语义：`maxBytes: 0` 时报告值 = 开组 + 阻塞组字节）。
- **多实例并发 sweep**（同进程旧新 adapter 重叠期）：协议幂等（rename EEXIST/ENOENT、unlink ENOENT 均容忍续走或计数）；`currentSegment` 单调 ⇒ A 实例的开组对 B 实例必闭，仅欠保护方向，无洞风险（§12-AT7）。

---

## §5. 不变量（INV）

| # | 不变量 | 机制落点 |
|---|---|---|
| INV-1 | **开组保护**：writer `currentSegment` 组绝不被任何 retention 路径 rename/unlink | §4.1 闭组判定；测试 T-B4/T-B5 |
| INV-2 | **保留集连续后缀**：每流幸存组恒为段号连续后缀；sweep 遇首个不可删组即止步该流，永不跳洞 | §4.5 前缀纪律；测试 T-B6/T-B7 |
| INV-3 | **JSONL 提交标记**：`.jsonl` 存在 ⇔ 组对 reader 完整可见；删除序恒 rename→unlink(bin)→unlink(marker)；每个中间态 (a) reader 按既有合法窗口解释 (b) 重启可无外部状态续走 | §4.2；矩阵 W1/W2 |
| INV-4 | **租约门控**：任一未过期租约覆盖的组绝不被 rename；过期租约永不参与判定（过期 ≠ 阻塞） | §4.3；测试 T-C3/T-C4 |
| INV-5 | **retention 永不 throw、永不改业务/emitter 结果、永不阻塞构造就绪**：一切 IO 失败 → 计数 + 事件（ADR 0011 隔离） | §2.2/§4.5；测试 T-B9 |
| INV-6 | **manifest/locator 不可写**：retention 路径绝不写 `manifest.json`、绝不写/改 `current.json`（namespace 删除是**移除**而非改写）；retention 配置零持久化 | §2.1/§2.4 |
| INV-7 | **裁剪可解释性**：`historyTrimmed === true` ⇔ 枚举最低段 ≠ `'00000001'`（纯结构判定）；`false` 时 reader/resume 行为与现状逐字节等同；中部缺口恒 `sequence-gap`→corrupt/rotate | §7.1；测试 T-E1–T-E5 |
| INV-8 | **namespace 删除线性化**：`deletion.json` 落盘后构造一律 disabled（无复活、零写入）；完成态 = 目录消失（此后 fresh 新 lineage 合法） | §4.4；测试 T-D4/T-D5/T-D8 |
| INV-9 | **租约注册表进程内按 (rootDir, namespaceId) 共享**：正确性依赖 ADR 0012 单进程独占根目录部署约束 | §2.3/§11-A6 |
| INV-10 | **字节核算** = 全 generation JSONL+BIN 之和（stat 实测）；年龄前沿 = 组内 committed records 的 `max(observedAt)`（record 自带时间，**禁用 mtime**） | §4.5-R3 |
| INV-11 | **null/0/缺省语义表**（§2.1）逐项钉死；配置违规 ⇒ 仅 retention 失活 + 事件，stream 不受影响 | §2.1；测试 T-A6–T-A8 |
| INV-12 | **逻辑删除边界**：删除能力只作用于活跃存储目录树；措辞/事件/文档不得暗示 secure erase；adapter 索引 = 租约注册表分区（进程内）随删释放 | §2.4；测试 T-D7 |
| INV-13 | **保留字文件名文法不可达**：`{seg}.deleting` 不满足 `P_SEGMENT`；`{streamId}.deleting` 不满足 `P_STREAM_ID`；`deletion.json` 是 namespaceDir 内新固定名（与 current.json/current.json.tmp 并列，不与任何文法空间冲突）——三者均不可被任何既有枚举/扫描路径当作数据 | §4.2/§4.4；测试 T-B8/T-D6 |
| INV-14 | **emit 路径纯度**：sweep/删除永不挂载 `emit`/`beforeCommit`；emit 恒为「至多一条 record + 至多一帧 BIN」 | §2.2/§12-AT8 |

---

## §6. 故障/重启矩阵

### §6.1 组删除协议窗口（AC-5「every interrupted deletion step」）

| 窗口 | 磁盘态 | 重启/sweep 续走 | reader 视图 | writer resume |
|---|---|---|---|---|
| W0 崩溃于 rename 前 | jsonl[+bin] | 无需续走（组完整） | 完整可见 | 正常 |
| W1 崩溃于 rename 后、unlink(bin) 前 | `.deleting`+bin | 构造期卫生遍历/P0：unlink(bin)→unlink(marker) | 组不在枚举（零行无 issue）；bin-无-jsonl 属既有合法窗口 | 正常（组不在扫描，锚不受影响） |
| W2 崩溃于 unlink(bin) 后、unlink(marker) 前 | `.deleting` | 续走 unlink(marker) | 同上 | 正常 |
| W3 崩溃于 unlink(marker) 后 | ∅ | 完成 | 组消失；若为首组 → §7.1 trim 报告 | 正常（§7.5 容差锚） |
| 各步 IO 失败（EACCES/EPERM…） | 任一态 | 跳过该标记/止步该流；failedSteps++ + 事件；下轮重试 | 同上对应态 | 正常（INV-5：永不阻塞就绪） |

### §6.2 namespace 删除窗口

| 窗口 | 磁盘态 | 重入删除 | 期间构造 | 租约注册表 |
|---|---|---|---|---|
| N0 marker 写前崩溃 | 原样 | 从步骤 2 重走 | 正常（未删除） | 不变 |
| N1 marker 落盘后、current.json 尚在 | deletion.json + 完整树 | 步骤 3 续走 | **disabled** + `namespace-log-deleted`（零写入） | 不变（至 N6 释放） |
| N2 部分流已删（current.json 已无） | marker + 部分流 | 步骤 4 续走（流枚举按现存者） | disabled（marker 门先于 locator 三分支） | 不变 |
| N3 某流已 rename 为 `{s}.deleting`、未 rm | marker + `{s}.deleting` | rm `{s}.deleting` 续走（force） | disabled；`{s}.deleting` 不满足 streamId 文法， locator 扫描永不吞入 | 不变 |
| N4 全流已删、namespaceDir 尚在 | 空壳 dir(+marker) | 步骤 5 rm | disabled | 不变 |
| N5 rm 完成 | 无 namespaceDir | `{status:'absent'}`（幂等） | **fresh**：新 stream + genesis（新 lineage 合法——删除后重新启用 ≠ 复活） | 分区已释放；会话 closed |

### §6.3 组合与边缘

| 场景 | 预期 |
|---|---|
| 崩溃于 W1 + 显式 `resumeStreamId` 指向该流 | resume 分析忽略 `.deleting`（文法不可达）→ 正常续写；卫生遍历已完成删除 |
| sweep 中构造并发（同进程两实例重叠期） | 单线程同步序列化；协议幂等；欠保护方向无洞（§12-AT7） |
| retention 配置违规 + 构造 | stream 正常 ready；retention 失活 + 恰一次 `retention-config-invalid`；自动 sweep 跳过限制遍历、卫生遍历仍走（若 `sweepOnOpen`） |
| `deletion.json` 存在 + 手工伪造合法 manifest 等 | 仍 disabled（marker 门先于一切流健康判定） |
| 活跃租约 + `maxBytes:0` 持续施压 | 被租约首组止步该流；其他流继续；报告 `leaseBlockedGroups`、`retainedBytes` 如实 > 0；**不**绕过前缀纪律去删新组（§12-AT2） |
| 全部闭组删尽（如 0/0 配置） | 流收敛到「空 segments 目录 + manifest」= 既有「manifest 落盘后、首 record 前崩溃」状态；resume 于 `'00000001'`/seq 1（§7.4 权衡已备案） |
| 14 键 legacy 流上 sweep | 全组皆闭可删（sealed）；`currentSegment` 语义不适用；行为同 sealed generation |

---

## §7. 恢复、orphan 与历史语义

### §7.1 Trim 报告与连续性锚的**结构化**判定（保住全部既有钉死测试）

**规则**：`historyTrimmed ⇔ 枚举最低段 ≠ '00000001'`；此时 reader/resume 的连续性锚初始化为 `null`（首条身份可解释 record 重定基——即 reader 既有 `expectedSequence === null → actual + 1n` 路径），且 prefix 跨越不产生 `sequence-gap`。`historyTrimmed === false`（最低段 = 00000001）时锚恒 `1n`，行为与现状逐字节等同。

**为何以段边界而非 sequence 边界判定**（关键裁决）：retention 只删**整组**；组粒度裁剪的缺失前缀必然表现为「最低幸存段 > 00000001 ∧ 首 record sequence > 1」。而「最低段 = 00000001 ∧ 首 record sequence > 1」只能是**组内行丢失**（真损坏）——两者可区分：

- **E（既有测试零回归证明）**：钉死「首 record sequence > 1 → sequence-gap/corrupt」的两个夹具（`file-adapter-r2-supplemental.test.ts:211-220` 与 `:420-427`）**均只含段 00000001**（UINT64_MAX 预置接缝产物）→ 最低段 = 00000001 → `historyTrimmed=false` → 断言不变。钉死「删中间行 → rotate stream-corrupt」的 `file-adapter-reopen-roll-repair.test.ts:697`（§13.16a）夹具亦单段 → 不变。实现票必须在 PR 说明中引用本条并跑全量既有套件佐证。

**不可进一步区分的残余（备案）**：手工/磁盘故障删除前缀段与 retention 裁剪在磁盘上不可区分——按 retention 解释并诚实报告 `historyTrimmed`+`earliestRetainedSequence`，符合 best-effort 定位（ADR 0011「日志允许缺失」）；归因超出存储层可证明范围。

### §7.2 orphan 语义边界（与 #153 尾部修复的正交切分）

| 现象 | 归属 | 动作 |
|---|---|---|
| SegMax（最大有文件段）尾部：不完整帧 / 未引用完整尾帧 / 未终止末行 | #153 C1/C2/C3（构造期修复） | 本设计**不碰** |
| 闭组：无 jsonl、无 `.deleting`、有 bin（整组孤儿） | #154 卫生遍历 | unlink(bin)，幂等 |
| 闭组：`.deleting`（±bin） | #154 协议续走 | §4.2 S1→S3 |
| 开组：bin 有帧、jsonl 无提交行 | 活状态（BIN-first 瞬态） | 任何路径**不碰**（INV-1） |

### §7.3 保留历史报告（earliest retained sequence 扫描重建）

不引入持久 retention 状态：`earliestRetained` / `earliestRetainedSequence` 恒由当次扫描重建（ADR 明文「earliest retained sequence 通过扫描重建」）。工具面消费：replay（#155）在 `historyTrimmed === true` 时只能 partial——本设计只提供诚实事实，不提供跨裁剪连续性承诺。

### §7.4 全量裁剪收敛权衡（备案的已知取舍）

闭组删尽 + 开组零 record ⇒ resume 于空流（`currentSegment='00000001'`、seq 重自 1）。该状态与既有「manifest 落盘后首 record 前崩溃」状态**同构**（#153 已容忍的先例），且被删记录已不在活跃存储，磁盘自洽；代价：同一 `streamId` 内 sequence 字面量跨裁剪可复用（早前导出的 (streamId, sequence) 引用可能指向新记录）。**接受理由**：(a) ADR 明文禁止持久 retention 状态（否则违反「manifest 不承担 + 扫描重建」精神，且引入撕裂状态文件新故障面）；(b) best-effort 日志无审计连续性承诺（ADR 0011「不能宣传为可靠恢复日志」）；(c) 规避方案（retention 高水位文件）成本/风险不成比例。**测试钉死该行为**（T-E6）以防未声明漂移；若后续 Host 需要更强唯一性，走 ADR 演进另立切片。

### §7.5 resume 容差 = 防 rotate 风暴（本设计最大的隐性陷阱，正面裁决）

不做 §7.1 的 resume 侧容差 ⇒ 每次裁剪后重启：`analyzeStreamForResume` 首条幸存 record `actual > expected(1n)` → `corrupt` → rotate 新 generation → 下一轮又裁剪 → **retention 自毁**（裁一次换一代，sequence 谱系碎裂）。故 `analyzeStreamForResume` 与 reader 同步采用 §7.1 结构化锚规则：最低幸存段 ≠ 00000001 ⇒ 锚初始化 null。`manifest-roll-target-violation` 闭段核查不受影响（幸存闭段达标事实不变）；frozen-policy 比对、17 键要求、耗尽门闩均不变。

---

## §8. 错误处理链路审查（静默失败 / 状态闭环 / 降级检查）

本票无 UI/请求面；「错误链路」= 健康/报告闭环。逐失败路径核对（每行必须有事件或报告计数，禁止静默）：

| 失败路径 | 可观察闭环 | 静默? |
|---|---|---|
| sweep 任一 IO 失败 | `RetentionSweepReport.failedSteps` + `retention-swept` 事件 | 否 |
| retention 配置违规 | `retention-config-invalid`（恰一次，构造时） | 否 |
| 遗留 `.deleting` 续走失败 | 报告 `failedSteps` + 事件；下轮重试 | 否 |
| namespace 删除失败 | 返回值 `failed{code,step}`（调用方同步可见）+ 部分态可续走 | 否 |
| 删除半态期间的构造 | `stream-init-failed{reason:'namespace-log-deleted'}`（恰一次） | 否 |
| 会话续租被拒（超 maxLifetime/closed） | `renew() === false`（返回值即反馈） | 否 |
| 被租约阻塞的裁剪 | 报告 `leaseBlockedGroups` + 事件 | 否 |
| 名义「降级」复核（伪降级检查） | 本设计所有「跳过/止步」都有明确结构性原因（开组保护/前缀纪律/租约门控），均为**设计内保守**而非把 bug 当降级；无「应该总是满足却当降级处理」的条件 | — |

---

## §9. 红灯测试计划（red-test plan；SA6 落笔依据）

> 方法论：不新增 fault-injection 接缝——**中断态一律直接合成磁盘状态**（沿用 `test/helpers/file.ts` 的 fixture 手法：手工写 `.deleting`/半删目录），构造/调用后断言行为。红灯性：当前主干无这些 API/行为，测试编译期即红（新导出缺失）或断言期红。

**T-A retention 语义（AC-1）**
- T-A1 年龄前沿包含性：`now − observedAt == maxAgeMs` ⇒ 过期（≥ 语义）；`+1ms` ⇒ 不过。
- T-A2 组内取 max：末行 observedAt 新、中间行老（注入回拨时钟合成）⇒ 以 max 判定（末行新 ⇒ 组保留——同时验证 tail 快速否决正确性）。
- T-A3 字节前沿：total == maxBytes ⇒ 不删；total == maxBytes+1 ⇒ 删最老闭组至 ≤。
- T-A4 `maxAgeMs:null` ⇒ 年龄遍历零动作（构造超龄数据后 sweep 断言零删除、卫生遍历仍清 orphan——§2.1「两者皆 null 仍卫生」）。
- T-A5 `0/0` ⇒ 尽删全部闭组；开组（含其 bin/jsonl）原样；`retainedBytes` == 开组字节。
- T-A6 `maxAgeMs:-1` / `NaN` / `1.5` / `Infinity` ⇒ `retention-config-invalid` 恰一次 + 零删除 + stream ready 且 emit 正常落盘。
- T-A7 默认值：缺省配置 ⇒ 30d/1GiB 生效（构造 31 天前数据被裁 / 1GiB+1 被裁）。
- T-A8 配置不持久化：sweep 前后 manifest 字节恒等；改配置重开**不**产生新 generation（对照 frozen-policy rotate 测试）。

**T-B 闭组资格与删除协议（AC-2）**
- T-B1 只有闭组被删：构造滚到段 3（小 targets），sweep ⇒ 1、2 删、3 原样。
- T-B2 协议产物序：删后段目录恰无 `00000001.*` 任何残留（jsonl/bin/.deleting 全无）。
- T-B3 成对性：被删组的 bin 与 jsonl 同轮消失；幸存组 jsonl 引用的 bin 帧可读（strict reader ok）。
- T-B4/T-B5 开组保护双形态：(a) 开组有记录；(b) 开组刚滚出、零记录、仅有 bin 瞬态——均不得删（INV-1 后者是 orphan 清理的照妖镜）。
- T-B6 前缀纪律-租约洞：租约锁组 1，0/0 sweep ⇒ **零删除**（止步），绝不出现「删 2 留 1」的洞（INV-2 核心红灯）。
- T-B7 前缀纪律-IO 失败：使组 2 的 `.deleting` unlink 失败（目录占位等手法）⇒ 该流止步，组 3 不删。
- T-B8 文法不可达：目录中手工放置 `00000009.deleting`、`00000009.bin` ⇒ reader 枚举不含 00000009；构造期卫生遍历将其清为无。
- T-B9 永不 throw / 永不阻塞：只读根目录（chmod 0555 或平台等价）下构造 + sweep ⇒ ready 照常、事件/计数如数、无异常外抛（skip-if 平台不支持）。
- T-B10 多 generation：同 namespace 两代流（旧 sealed + 当前）⇒ 候选序 createdAt↑、旧代先裁；字节预算跨代合计。

**T-C 读会话租约（AC-3）**
- T-C1 活跃租约阻塞：会话锁组 1，超龄 sweep 不删组 1（`leaseBlockedGroups≥1`）。
- T-C2 close 立即释放：close 后同轮 sweep 删之。
- T-C3 TTL 过期放行：时钟前进越过 `leasedUntil` ⇒ sweep 照删（AC-3 后半红灯核心）。
- T-C4 过期后 renew 重租：过期窗口数据被删后 `renew()` 行为符合 §2.3 文档（不复活数据）。
- T-C5 maxLifetime 拒续：注入小 maxLifetime ⇒ 超时后 `renew()===false`。
- T-C6 快照集语义：会话 open 后新滚出的段不在 `segments`；retention 删旧前缀不受影响。
- T-C7 跨实例可见性：adapter A 构造后，进程内另一处 `openDiagnosticReadSession` 持租约 ⇒ A 的 sweep 尊重（INV-9 红灯）。
- T-C8 注册表隔离：不同 namespaceId / rootDir 互不可见。

**T-D namespace 删除（AC-4）**
- T-D1 全量覆盖断言：删除后 namespaceDir 不存在（locator/manifests/jsonl/bin/`.deleting`/`deletion.json`/`current.json.tmp` 全无）——AC-4 逐对象清单。
- T-D2 幂等：二次调用 `{status:'absent'}`。
- T-D3 非法 namespaceId：failed + 零 fs 触达（以 spy 或只读根佐证）。
- T-D4 半态门：手工合成 N1 态 ⇒ 构造 disabled + 恰一次 `stream-init-failed{reason:'namespace-log-deleted'}` + 零写入（目录字节恒等）。
- T-D5 半态续走：N1/N2/N3 合成态 ⇒ 重入删除完成至 absent。
- T-D6 `{s}.deleting` 文法：合成 N3 态 ⇒ locator 扫描（破坏 current.json 后）不把 `{s}.deleting` 当候选。
- T-D7 语义措辞：结果类型/事件字段集断言无 secure-erase 暗示面（API 形状测试）。
- T-D8 完成后 fresh：删除完成后构造 ⇒ 新 streamId + genesis（新 lineage）。
- T-D9 租约分区释放：删除后旧会话 `closed===true`、注册表无残留。

**T-E 恢复/orphan/历史报告（AC-5）**
- T-E1 trim 报告：合成「段 1、2 已删」流 ⇒ `historyTrimmed===true`、`earliestRetainedSequence===首条幸任 sequence`、status ok、无 `sequence-gap`。
- T-E2 中洞仍腐：段 1、3 在、段 2 无 ⇒ `sequence-gap`/corrupt 不变量保持。
- T-E3 单段首 record >1 仍腐（钉死测试复刻版）：`historyTrimmed===false` + `sequence-gap`（§7.1-E 的回归锚）。
- T-E4 resume-after-trim：真删前缀后重开 ⇒ **resume 同 streamId**（streamId 断言相等）、无 rotate 事件、续写 sequence 接续幸存最大值（§7.5 红灯核心）。
- T-E5 resume-after-middle-loss 仍 rotate（复刻 §13.16a 语义不回归）。
- T-E6 全裁剪收敛：0/0 + 仅开组零记录崩溃态 ⇒ 重开 resume 空流 seq 1（§7.4 备案行为钉死）。
- T-E7 orphan 清理：闭组「bin 无 jsonl 无 .deleting」⇒ 清；开组同形态 ⇒ 不清。
- T-E8 遗留 `.deleting` 构造期完成：W1/W2 合成态 ⇒ 构造后消失 + `retention-swept` 计数。

**非回归门**：`npx vitest run packages/namespace-diagnostic-log/` 全绿（381 既有 + 新增；§7.1-E 三处钉死引用必须原样通过）。

---

## §10. 验证命令候选（exact validation commands）

```bash
# 0) 环境（本 worktree 已执行：Done in 426ms）
pnpm install --frozen-lockfile --prefer-offline

# 1) 包级全量（基线证据：22 files / 381 tests / no type errors；实现后必须全绿含新文件）
npx vitest run packages/namespace-diagnostic-log/

# 2) 本票新文件逐个（红灯→绿灯跟踪）
npx vitest run packages/namespace-diagnostic-log/test/file-adapter-retention.test.ts
npx vitest run packages/namespace-diagnostic-log/test/file-adapter-retention-deletion-windows.test.ts
npx vitest run packages/namespace-diagnostic-log/test/file-adapter-read-session.test.ts
npx vitest run packages/namespace-diagnostic-log/test/file-adapter-namespace-deletion.test.ts
npx vitest run packages/namespace-diagnostic-log/test/file-adapter-retention-history.test.ts

# 3) 钉死面非回归（schema 指纹 / 既有 gap 语义 / reopen-roll-repair #153 契约）
npx vitest run packages/namespace-diagnostic-log/test/schema-freeze.test.ts
npx vitest run packages/namespace-diagnostic-log/test/file-adapter-r2-supplemental.test.ts
npx vitest run packages/namespace-diagnostic-log/test/file-adapter-reopen-roll-repair.test.ts

# 4) 仓库门（CI 同款）
pnpm test        # vitest run --typecheck（全仓）
pnpm typecheck   # 含 packages/namespace-diagnostic-log/tsconfig.json
```

---

## §11. 协议假设依据（Protocol Assumption Evidence）

| # | 假设 | 依据（可验证） |
|---|---|---|
| A1 | 同目录 `renameSync` 原子（崩溃后要么旧名要么新名，无中间名） | 本包既有负载先例：`writeCurrent` 的 current.json temp+rename（`src/adapters/file.ts:880-894`）已把该假设作为 locator 一致性的承重墙；Node fs 文档 rename(2) 语义（nodejs.org/api/fs.html#fsrenamesyncoldpath-newpath）；POSIX 同卷原子性 |
| A2 | `unlinkSync` ENOENT 可作为幂等续走信号；EACCES/EPERM 等 errno 经 `errnoOf` 收敛为稳定码 | 本包既有 `classifyAppendFailure`/`errnoOf` 同款处理（`src/adapters/file.ts:151-155, 593-596`）；事件 code 词表纪律（AGENTS.md「固定词表或稳定 errno」） |
| A3 | `readdirSync` 枚举 + `.jsonl`/`.bin` 后缀剥离可安全忽略一切其他文件名（含 `.deleting`） | `src/reader.ts:447-454`（reader）与 `:854-861`（resume）现行实现即此语义；INV-13 以文法（`P_SEGMENT` 8 位十进制 / `P_STREAM_ID` `log-`+32hex）证明 `.deleting` 后缀名不可达 |
| A4 | `rmSync(recursive, force)` 幂等且 ENOENT 静默 | Node 文档 fs.rmSync（force:true 时目标不存在不抛）；用于 namespace 删除续走 |
| A5 | 单线程同步模型内「检查租约→删除」无撕裂窗口 | 本包全同步 IO 风格（无 async fs 调用——`file.ts`/`reader.ts` 全量 `*Sync`）；sweep 与会话 open 均为同步函数，事件循环序列化 |
| A6 | 单进程独占 rootDir ⇒ 进程内租约注册表充分 | ADR 0012 §Writer 原文「File adapter 沿用单进程独占根目录的部署约束，不实现跨进程锁」（`docs/adr/0012:218`） |
| A7 | `observedAt` 由注入 Clock 产生、可回拨 ⇒ 年龄判定必须全组取 max | `FileDiagnosticLogConfig.clock`（`file.ts:101-103`）+ ADR 0012「`observedAt` 由完成操作的 producer 使用注入 Clock 生成」；快速否决的 soundness 推理见 §4.5-R3 |
| A8 | 1 MiB 行可拆多个 write(2) ⇒ 并发裸 reader 可见半行，与并发 retention 一致性均不在静态工具契约内 | `reader.ts:335-338` 文件头注既有声明（§4.3）；会话包装为受支持路径 |

---

## §12. 攻击自审（SA2 对自身设计的攻击记录与裁决）

| # | 攻击点 | 裁决 |
|---|---|---|
| AT1 | **裁剪→rotate 风暴**：按现网 resume 语义，裁掉前缀后重开必判 corrupt→换 generation，retention 自毁 | §7.5：resume/reader 双侧结构化锚容差（最低段 ≠ 00000001 ⇒ 锚 null 重定基）；T-E4 红灯钉死 |
| AT2 | **租约洞**：锁旧放新（删 2 留 1）造成中洞 → 假 sequence-gap | §4.5 前缀纪律：流内遇首个不可删组止步，保留集恒连续后缀（INV-2）；T-B6 |
| AT3 | **先删 BIN 的反序协议**会制造 frame-missing→corrupt | §4.2 论证：JSONL 先 rename 使一切中间态落入 reader 既有合法窗口（bin-无-jsonl）；W1/W2 矩阵 |
| AT4 | **全裁剪后 sequence 复用**破坏 (streamId, sequence) 身份 | §7.4 显式接受 + 备案（与既有空流崩溃态同构；持久状态文件被 ADR 精神禁止）；T-E6 钉死防未声明漂移 |
| AT5 | **namespace 目录级 `.deleting` 兄弟重命名**会与文法合法的真实 namespace 名冲突 → 误删他 namespace | 弃用；改 namespaceDir 内 `deletion.json` 固定名标记（INV-13/§4.4）；T-D3/T-D6 |
| AT6 | **删除半态复活**：崩溃后重开在残部上 resume/重建，数据「复活」且 Host 不自知 | marker 门线性化：构造 disabled + `namespace-log-deleted`；重入删除唯一完成路径（INV-8）；T-D4/T-D5 |
| AT7 | **重叠实例 sweep 互踩**（reopen 期旧新 adapter 并存） | 协议幂等 + currentSegment 单调 ⇒ 仅欠保护方向；无洞（§4.5）；T-B2 幂等性覆盖 |
| AT8 | **sweep 挂进 emit** 放大文件系统延迟、违反 first-slice「有界」 | INV-14：仅构造期 + 显式调用两个触发点，均 write-slot 外 |
| AT9 | **orphan 清理误杀开组瞬态**（BIN-first 写帧后、JSONL 未提交） | 开组绝对豁免（INV-1）；T-B5/T-E7 双形态照妖镜 |
| AT10 | **伪降级**检查：把「应该总是满足」的条件当降级掩盖 | §8 复核：一切跳过/止步均有结构性理由并进入报告/事件，无静默分支 |
| AT11 | **`historyTrimmed` 语义漂移破坏钉死契约** | §7.1 结构化判定保三处钉死夹具（引用行号）；T-E3 复刻锚 + §10 命令 3 非回归门 |
| AT12 | **字节下限谎言**：`maxBytes:0` 时报告仍 >0 被误读为实现缺陷 | `retainedBytes` 语义 = 如实下限（开组 + 阻塞组）；T-A5 断言精确值 |

---

## §13. 实现顺序建议（非约束）

1. `src/retention.ts` 纯策略 + `reader.ts` 枚举去重/锚容差（T-E1–T-E5 先红）；
2. `src/adapters/file.ts` 协议 + sweep（T-A/T-B/T-E6–T-E8）；
3. `src/read-session.ts` + 接线（T-C）；
4. `deleteNamespaceDiagnosticLog` + marker 门（T-D）；
5. AGENTS.md 同步 + 全量门（§10 命令 1/4）。

—— 以上为完整设计。无实现代码；未触碰 src/test/package 任何文件。
