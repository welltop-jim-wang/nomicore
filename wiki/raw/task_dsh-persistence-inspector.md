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

## 5. R1 修订记录（2026-08-22，SA1 设计 §9 阻塞项，总控协调）

> 背景：SA1 设计 §9 在**已实现且全绿**的 P3 `FilePersistence` 上以 SA6 逐字复刻的 FakeTimer 实测，证明 `packages/dsh-persistence/test/dsh-profile-acceptance.test.ts` 两处断言在**正确实现**下不可满足（原型 V4/V5/V6，§13 P5/P6/P7）。按简报 §2「SA6 固定，改动须与 SA6 协调」条款由总控协调 SA6 修订。**断言目标值一字未改，仅修测试时序基础设施。**

### R1-1 缺陷 1：AC4 file service 级用例（`AC4（service 级）：file profile 写路径被阻塞…`）

- **问题**：`saveDoc` → `advanceBy(debounceMs)` → **立即**断言 `getStatus()==='persistence-degraded'`。FakeTimer 的 `advanceBy` 只排空微任务；flush 的 `fsp.mkdir/writeFile/rename` 在 libuv 线程池结算，实测需 ~5 轮 `setImmediate` 才 degraded（复刻输出：`T+0 advance 返回后立刻 getStatus: ready`）。恢复侧 `toBe('ready')` 同理。
- **不可满足性**：任何正确实现都无法让真实文件 I/O 在纯微任务排空内完成——除非改 P3 生产代码（DENY + 语义错误）或包装 timer（外部 flush 协调器，违反 ADR）。
- **修订**：该用例两处 `advanceBy` 之后、`getStatus` 断言之前插入 `await settleRealIo()`（新增测试助手：12 轮 `setImmediate` 轮转，注释引用 SA1 §9）。降级/恢复断言目标值、注入手法（普通文件占据用户目录路径）不变。

### R1-2 缺陷 2：AC6 dispose 用例（`AC6：dispose 后无 timer/监听器/文件句柄/Y.Doc cache/.tmp 残留…`）

- **问题**：`createDoc` → `ROOT.rev=1` → `saveDoc` → `pending()>0` → **立即** `dispose()` → reload 断言 `rev===1`。内核 dispose 语义 = 清计时器 + abort I/O + 销毁 doc，**不 flush 未决脏数据**（`lifecycle.ts` dispose 与 `maybeEvict` clean 前置）；复刻输出：`AC6 reload rev = undefined`。
- **不可满足性**：profile 无法替调用方推进其传入的 timer（外部 flush 协调）；改内核 dispose 加 flush-dirty 语义 = 改 P3 行为契约（DENY + 冲击既有 P3 套件）。
- **修订**：`dispose()` 之前插入 `await timer.advanceBy(debounceMs)` + `await settleRealIo()`（让 debounce flush 提交 rev=1 并真实结算，原型 V6 已验证）。用例其余断言（pending=0、doc destroyed、service undefined、status disposed、无 .tmp、无 fd 残留、reload 新实例）全部不受影响。

### R1-3 修订后红灯仍成立（2026-08-22 实跑）

```bash
pnpm exec vitest run packages/dsh-persistence/test/dsh-profile-acceptance.test.ts
#   → Test Files 1 failed（收集期 Failed to load url ../src/index.js——功能模块仍不存在；
#     修订后的 10 个用例随文件整体红灯，与 R0 相同，真红非伪红）
pnpm exec vitest run --reporter=basic   # 全量复跑
#   → Test Files 2 failed | 37 passed (39)；Tests 6 failed | 517 passed (523)；退出码 1
#     格局与 R0 完全一致：仅两个红灯文件失败，既有 37 文件 + 绿色守卫全绿
```

其余用例（AC1 memory/file、AC2/AC3/AC4 probe 级、AC4 memory service 级、CLI 全部、绿色守卫）经 SA1 §9 盘点 + §13 原型实证可满足，零改动。`dsh-probe-cli.test.ts` 与 `core-dsh-boundary.test.ts` 本轮未触碰。

## 6. R2 修订记录（2026-08-22，SA1 设计 §9 缺陷 3，总控协调）

> 背景：SA2 攻击点 1 揭出，SA1 独立复核成立并补齐实证（V8 证伪 / P14 配方验证）。按简报 §2「SA6 固定，改动须与 SA6 协调」条款由总控协调 SA6 R2 修订。**断言目标值一字未改，仅调整断言序 + 新增反黑帽守卫。**

### R2-1 缺陷 3：AC1 memory service 级用例——release 后 loadDoc 同实例断言与内核驱逐语义冲突

- **问题（原断言链 129–132 行）**：`createDoc`（**无 saveDoc**，entry 处于 `savedGeneration(0)===dirtyGeneration(0)` 的 clean 态）→ `await handle.release()` → `loadDoc` → `expect(loaded!.doc).toBe(doc)`。内核 `maybeEvict`（lifecycle.ts:463-469）三前置全过 → **同步驱逐并 `doc.destroy()`**（销毁调用方传入的 doc 实例）；随后 `loadDoc` 走 store 路径从 mirror 还原**新 Y.Doc 实例**（V8 实测：`release 后 doc.isDestroyed: true`、`loaded.doc===doc: false`）。
- **这是 P2/P3 既定契约而非巧合**：P2 内核测试 `memory-persistence.test.ts:366` 明文 `expect(restored!.doc).not.toBe(oldDoc)`；ADR-0006「引用归零仅使缓存项成为可驱逐候选……仅在保存成功、缓存/空闲策略满足后才真正释放实例」与 AC5 正依赖同一语义——原断言与 AC2/AC5/AC6 语义锚点互相矛盾。
- **不可满足性证明（实现侧无解）**：让 `loaded.doc === doc` 成立只有两条邪路——profile 偷持 phantom handle 抑制驱逐（打翻 AC2/AC5/AC6 与 ADR 驱逐条款）、或改内核 `maybeEvict` 对 clean 态不驱逐（推翻 P2 契约 + Y.Doc cache 永不释放）。均属 §9 已排除黑帽。
- **修订（修法 B，R1 选定 ✅）**：`loadDoc` 前移到 `release` 之前（cache-hit 路径，同 live 实例），断言集原样保留，新增三守卫：
  1. `expect(loaded!.doc).toBe(doc)` —— 断言目标值**原样**（cache-hit 下共享 live Y.Doc，ADR「共享 doc、独立 handle」）；
  2. `expect(loaded).not.toBe(handle)` —— 独立 lease（ADR「每次 load 返回独立 DocHandle/lease」）；
  3. 双 release 后 `expect(doc.isDestroyed).toBe(true)` + `expect(timer.pending()).toBe(0)` —— **反黑帽守卫**：phantom-handle 抑制驱逐的邪路在此立即爆红。
  - 选 B 论证（SA1 §9）：断言语义零反转；「共享 doc、独立 handle」cache-hit 语义在 service 级无其他用例覆盖（AC2 只经探针事件间接覆盖），驱逐/新实例语义已被 AC2/AC5/AC6 三方锚定；P14 实测修法 B 全断言可满足。
- **其余用例零触碰**：AC1 file / AC3 file / AC4 两 service 级 / probe 级全部 / CLI 全部 / 绿色守卫均已有证据（P8/P15/P16 等）。

### R2-2 修订后红灯仍成立（2026-08-22 实跑）

```bash
pnpm exec vitest run packages/dsh-persistence/test/dsh-profile-acceptance.test.ts
#   → Test Files 1 failed（收集期 Error: Cannot find module '../src/index.js'——功能模块仍不存在；
#     修订后的 10 个用例随文件整体红灯，与 R0/R1 相同，真红非伪红）
pnpm exec vitest run --reporter=basic   # 全量复跑
#   → Test Files 2 failed | 37 passed (39)；Tests 6 failed | 517 passed (523)；退出码 1
#     格局与 R0/R1 完全一致：仅两个红灯文件失败，既有 37 文件 + 绿色守卫全绿
```

## 7. R3 修订记录（2026-08-22，总控协调，SA1 设计 §11 风险预警落盘）

> 背景：SA3 实现完成，但 R1 引入的固定轮数 `settleRealIo()`（12 轮 setImmediate）在本机不足以等完真实文件 I/O——SA3 实测：裸 mkdir→writeFile→rename 链需 10~103 轮，内核 retry 恢复链需 14~40 轮；plugin 级复刻（不经任何 dsh 代码）同样失败，确认与实现无关。SA1 设计 §11 已预警此风险（设计探针用 deadline 式 `waitFor` 5s 上限规避）。**断言目标值一字未改，仅换等待基础设施。**

### R3-1 改了什么（`packages/dsh-persistence/test/dsh-profile-acceptance.test.ts`）

1. 新增 deadline 式等待助手 `waitFor(predicate, what, timeoutMs=5_000)`：真实 `setTimeout` 轮询（25ms 间隔）谓词直到成立或真实时间上限耗尽，超时 loud throw；不推进虚拟时钟，无固定轮数校准。
2. **AC4-file 恢复侧**：`fs.rmSync(blocker)` → `advanceBy(debounceMs)` 之后，原 `await settleRealIo()` 替换为 `await waitFor(() => profile.getStatus() === 'ready', ...)`，随后 `expect(profile.getStatus()).toBe('ready')` 断言目标值原样。
3. **AC6 dispose 前**：`advanceBy(debounceMs)` 之后，原 `await settleRealIo()` 替换为 `await waitFor(快照提交态)`——谓词 = `.snapshot.tmp` 不存在 且 `.snapshot` 解码出 `ROOT.rev===1`（rename 完成即 ADR-0006 提交态），随后 `dispose()` → 既有全部断言原样（.tmp 残留、fd、reload rev===1 等）。
4. **AC4-file 降级侧等其余已绿位置保持不动**（指令授权实测判断）：降级侧为单跳错误路径（mkdir EEXIST → 1 次 libuv 回调），12 轮 setImmediate 充裕；修订后连跑 5 次全绿（见 R3-3），维持现状不引入多余改动。

### R3-2 为什么

固定轮数校准是机器/负载相关的时间假设：libuv 线程池结算轮次随系统负载波动（实测 10~103 轮），任何固定轮数都存在慢机/CI 波动下不足的风险；deadline 式等待锚定的是「状态/快照达预期」这一语义目标（SA1 §6.2 `waitFor` 5s 上限同款设计），与断言目标值解耦，慢机只多等、不误报。

### R3-3 实测证据（2026-08-22，修订前后各跑单文件）

```bash
# 修订前（SA3 实现已就位，R1 settleRealIo(12) 不足）：
pnpm exec vitest run packages/dsh-persistence/test/dsh-profile-acceptance.test.ts
#   → Test Files 1 failed; Tests 2 failed | 8 passed (10)
#     × AC4（service 级）file：expected 'persistence-degraded' to be 'ready'（:395 恢复侧断言）
#     × AC6：expected [ Array(1) ] to deeply equal []（:436 .tmp 残留——flush 未及 rename，
#       reload rev===1 同因未提交）
# 修订后：
pnpm exec vitest run packages/dsh-persistence/test/dsh-profile-acceptance.test.ts
#   → Test Files 1 passed; Tests 10 passed (10)   ← 两条目标用例在 SA3 当前实现下转绿
# 稳定性（降级侧保留固定轮数 settleRealIo 的实测判断依据）：连跑 5 次 → 10 passed ×5，无波动
# 全量复跑：pnpm exec vitest run --reporter=basic（结果见下）
```

> 若修订后两条目标用例仍红 → 说明是实现缺陷（非测试时序），按总控指令立即回报，不以改断言迁就实现；本轮实测已转绿，无此情况。

## 8. R4 修订记录（2026-08-22，总控协调，与 R3 同模式）

> 背景：R3 后 AC4-file 降级侧仍保留一处固定轮数 `settleRealIo(12)`（R3 实测 5 连跑稳定），但 SA3 后续隔离运行实测该处约 **1/8 偶发 flake**（`expected 'persistence-degraded', received 'ready'`）——再次印证固定轮数校准是负载相关的时间假设。**断言目标值不变，仅把该处替换为 R3 同款 deadline 式 waitFor。**

### R4-1 改了什么（`packages/dsh-persistence/test/dsh-profile-acceptance.test.ts`）

1. **AC4-file 降级侧**（原 :411-412）：`advanceBy(debounceMs)` 后 `await settleRealIo()` 替换为 `await waitFor(() => profile.getStatus() === 'persistence-degraded', ...)`（真实时间上限 5s），随后 `expect(profile.getStatus()).toBe('persistence-degraded')` 断言目标值原样。
2. **固定轮数校准全面移除**：`settleRealIo` 助手自此零调用点，连同定义一并删除；`waitFor` 成为本文件唯一真实等待基础设施（文件头修订史 + 助手注释同步更新）。
3. 文件头追加 R4 追溯注记。

### R4-2 为什么

降级侧虽是单跳错误路径（mkdir EEXIST），但 libuv 线程池回调在隔离运行下仍可能被事件循环调度推迟超过 12 轮 setImmediate（实测约 1/8 概率）；deadline 式等待锚定「状态达预期」语义（`getStatus()==='persistence-degraded'`），慢机只多等、不误报，与 R3 同模式（SA1 §6.2/§11 设计同款）。

### R4-3 实测证据（2026-08-22）

```bash
# 隔离连跑 AC4-file 用例 10 次（修订后）：
for i in $(seq 1 10); do pnpm exec vitest run packages/dsh-persistence/test/dsh-profile-acceptance.test.ts -t "AC4（service 级）：file profile 写路径被阻塞" --reporter=basic; done
#   → Tests 1 passed | 9 skipped × 10 连跑，0 flake
# 全量复跑：
pnpm exec vitest run --reporter=basic
#   → Test Files 39 passed (39)；Tests 533 passed (533)；退出码 0
```

> 修订由 SA3 落盘 commit——SA6 只改测试与简报，未 commit。
