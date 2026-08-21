# MABF Task: DSH 持久化开发 profile 与 inspector 探针（P4）

## Issue #59

## Parent

PR #55

## Task Type

功能开发（总控自判：issue body 无 Task Type 标记；诉求为新增能力 —— DSH 开发宿主 profile + inspector 探针，非缺陷复现）

## What to build

在 DSH 作为 Cordis 开发宿主加载 P1–P3 的同一持久化插件实现，提供仅开发环境使用的 inspector 探针，验证插件不依赖 NomicoreServer 且可在真实 DSH 生命周期中 start/stop/reload。inspector 只消费 DocPersistence service，不得成为核心插件依赖。

## Acceptance criteria

- [ ] DSH profile 可选择 MemoryPersistence 或 FilePersistence Adapter（同一 contracts、零条件分支）
- [ ] inspector 使用 handle：load → saveDoc 标脏 → 受控时钟/可观察调度触发 flush → release；重复 load 同 doc、不同 handle
- [ ] userA/doc1 与 userB/doc1 隔离、META.docId 校验、SCHEMA/META/ROOT 三条目可观察
- [ ] save 失败后 `persistence-degraded`、后续写拒绝、retry 成功恢复的探针记录完整
- [ ] release 后由持久层内部决定真实 evict，probe 可观察引用归零与最终释放
- [ ] 插件 reload/dispose 后无文件句柄、timer、监听器、Y.Doc cache 残留
- [ ] 持久化核心插件源码不 import DSH；DSH wrapper/profile 保持薄 Adapter
- [ ] DSH 中的探针结果形成可复制的命令 + 输出记录（供后续 NomicoreServer Host 复用验收）

## Blocked by

#58（FilePersistence Cordis 插件）— 已合入（HEAD: 2aa22f4 PR #66）

## Working Directory

/home/wangjian/nomicore-fix-issue-59

## Branch

fix/issue-59-on-adr-server-design（base: adr/server-design）

---

# Phase 1 验收锚定（SA6 Red Test Writer）

> 执行时间：2026-08-22。功能开发分支 A.2：先锚定红灯验收测试，再进入 SA1 设计 / SA3 实现。
> 契约基准：ADR-0006（含 2026-08-21 createDoc/owner 修订节）+ 冲突门禁报告结论提示 1–4。
> 无 `scripts/test-lock.sh`（本仓库不存在该脚本），本次未新增端口/常驻服务依赖，无需更新。

## 1. 交付的测试文件

| 文件 | 状态 | 锚定验收条款 |
|---|---|---|
| `packages/dsh-persistence/test/dsh-profile-acceptance.test.ts` | 🔴 红灯（`../src/index.js` 收集期解析失败） | AC1/AC2/AC3/AC4/AC5/AC6 |
| `packages/dsh-persistence/test/dsh-probe-cli.test.ts` | 🔴 红灯（`src/cli.ts` 不存在，子进程非零退出；6 failed / 1 passed） | AC8（+ AC4 记录完整性、异常输入） |
| `packages/persistence/test/core-dsh-boundary.test.ts` | 🟢 绿色守卫（当前即绿） | AC7（核心不 import DSH 的持续回归锚） |
| `packages/dsh-persistence/package.json` | 测试脚手架（`@nomicore/dsh-persistence`，`dsh:probe` 脚本） | AC8 命令入口固化 |

## 2. 测试契约面（SA1/SA3 必须交付的模块面；SA6 固定，改动须与 SA6 协调）

新包 `packages/dsh-persistence/`（host 侧薄 Adapter；核心插件包 `@nomicore/persistence` 不依赖它）：

- `src/index.ts` 导出（值导出缺失即红灯）：
  - `createDshPersistenceProfile(options: DshPersistenceProfileOptions): DshPersistenceProfile`
    - `DshPersistenceProfileOptions = { adapter: 'memory' | 'file'; rootDir?: string; schedule?: Partial<PersistenceSchedule>; timer?: PersistenceTimer; memoryIo?: { writeSnapshot?; readSnapshot? } }`（`rootDir` 仅 file 必需；`memoryIo` 为 dev/test 注入缝，透传给 MemoryPersistence 选项）
    - `DshPersistenceProfile = { ctx: Context; persistence: DocPersistence; getStatus(): 'ready' | 'persistence-degraded' | 'disposed'; dispose(): Promise<void> }`；`ctx.get('docPersistence')` 必须是 `@nomicore/persistence` 的 `MemoryPersistence` / `FilePersistence` 真实实例（薄 Adapter：复用 P2/P3 工厂，零条件分支在 core 之外）
  - `runPersistenceProbe(options: ProbeRunOptions): Promise<ProbeRunResult>`
    - `ProbeRunOptions = { adapter; rootDir?; schedule?; timer?; failFirstFlushes?: number }`；`timer` 缺省时探针自建确定性虚拟时钟（CLI 可复制的关键）
    - `ProbeRunResult = { ok: boolean; events: readonly ProbeEvent[]; record: string }`；`record` 是 events 的确定性文本渲染，不含墙钟时间戳、rootDir 绝对路径等环境痕迹
  - `ProbeEvent` 判别联合（所有成员带 `t: number` 虚拟时钟刻度；`owner`/`docId` 全带）：
    `create { handle, docInstance }` / `dirty { generation }` / `flush { generation, ok }` / `load { handle, docInstance }` / `release { refs }` / `evict` / `observed { metaDocId, entries, rootKeys }` / `degraded` / `write-rejected` / `recovered` / `duplicate { code }` / `meta-mismatch { expected, actual }`
- `src/cli.ts`：命令入口 `pnpm exec tsx packages/dsh-persistence/src/cli.ts --adapter <memory|file> [--rootDir <dir>] [--fail-first-flushes <n>]`；stdout=记录，stderr=错误；file 缺 rootDir / 未知 adapter → 非零退出。

## 3. 探针固定场景（受控时钟；inspector 只经 Cordis 消费 `docPersistence`，不得引入外部 flush 协调器）

1. user-a/doc-alpha：createDoc（SCHEMA/META{docId}/ROOT 三条目）→ ROOT.rev=1 + saveDoc（dirty g1）→ 虚拟时钟推进（debounce 前无 flush；flush g1 落在 [debounce, maxDirty)）→ load×2（独立 handle、同一 live Y.Doc）→ rev=2 + saveDoc（dirty g2）→ flush g2 → release 逐次（refs 2→1→0，归零后持久层内部 evict）→ 再 load → 新 Y.Doc 实例（store 还原）→ observed 三条目
2. user-b/doc-alpha：独立分区 create + observed（隔离）
3. 异常输入：META.docId=doc-other 的 createDoc → meta-mismatch 记录；重复 createDoc → duplicate 记录（code=DOC_DUPLICATE）
4. 降级（仅 `failFirstFlushes ≥ 1`，memory）：user-a/doc-degraded create → saveDoc → flush 失败 → degraded → saveDoc 拒绝（write-rejected）→ 内部退避 retry → flush 成功 → recovered → 恢复可写

## 4. 红灯验证证据（2026-08-22 实跑）

```bash
# 全量（含既有 6 包套件）：既有套件全绿，仅两个新红灯文件失败 → 退出码非零
pnpm test -- --reporter=basic
#   → Test Files  2 failed | 37 passed (39)
#     Tests       6 failed | 517 passed (523)
#     退出码 1（红灯成立；37 个通过文件含全部既有套件 + core-dsh-boundary 绿色守卫）
# 红灯文件 1：收集期 import 失败（功能模块不存在）
pnpm exec vitest run packages/dsh-persistence/test/dsh-profile-acceptance.test.ts
#   → FAIL: Cannot find module '../src/index.js' imported from
#     packages/dsh-persistence/test/dsh-profile-acceptance.test.ts:33:1（10 个用例随文件整体红灯）
# 红灯文件 2：CLI 命令不存在
pnpm exec vitest run packages/dsh-persistence/test/dsh-probe-cli.test.ts
#   → Test Files 1 failed; Tests 6 failed | 1 passed（ERR_MODULE_NOT_FOUND: src/cli.ts；
#     passed 1 为 package.json scripts.dsh:probe 清单锚）
# 绿色守卫：AC7 边界
pnpm exec vitest run packages/persistence/test/core-dsh-boundary.test.ts
#   → Test Files 1 passed; Tests 3 passed（独立启动/停止 + import.meta.resolve 方向守卫 + 清单补充锚）
```

红灯结论：**功能确实不存在，非伪红**。修绿路径 = SA1 设计 + SA3 实现第 2 节契约面。`pnpm-lock.yaml` 已随新包 manifest 更新（SA6 执行 `pnpm install` 产物）。
