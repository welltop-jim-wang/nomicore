# SA7 动态对抗验证报告（Issue #111）

**Worktree**: `/home/wangjian/nomicore-fix-issue-111`
**SA4 前提**: R2 `Verdict：pass`（review L102-104）
**SA7 verdict**: **found-issue / fail-needs-fix**

## 关键发现

### HIGH — 定向 Vitest 实际为 411/414，并非声称的 414/414

真实命令（独立后台进程）：

```bash
npx vitest run packages/namespace-registry packages/doc-runtime --cache=false
```

结果：`Test Files 3 failed | 24 passed (27)`，`Tests 3 failed | 411 passed (414)`，exit `1`。

三个失败均为 declaration emit 测试的 5 秒超时，涉及：

- `packages/doc-runtime/test/doc-runtime-surface.test.ts` 的 declaration emit 正向 fixture；
- `packages/namespace-registry/test/registry-surface.test.ts` 的两个 declaration emit 审计。

这不是静态推断，而是本机真实执行结果；故“定向 414/414 绿”在当前 worktree 不成立。

### HIGH — Node 20 实跑同样失败

真实命令（题给 Docker 命令，独立后台）：

```bash
docker run --rm --user $(id -u):$(id -g) -v "$PWD":/w -w /w -e HOME=/tmp \
  node:20-slim node node_modules/vitest/vitest.mjs run --cache=false \
  packages/namespace-registry packages/doc-runtime
```

结果：exit `1`；`Test Files 3 failed | 23 passed | 1 skipped (27)`，`Tests 3 failed | 409 passed | 2 skipped (414)`。同一 declaration emit 用例超时（5 秒），故 Node 20 门禁失败。

### HIGH — 同 key 300 轮 create×open 压力发现 carrier orphan

临时 `/tmp/sa7-probe.mts`（执行后已清理）实跑输出：

```text
stress-same { creates: 1, oks: 1, carrierCreated: 1, carrierDeleted: 0, rejected: 0 }
```

`createDoc` 至多一次、成功 lease 至多一个符合预期，但 diagnostics 的 `carrier-created/deleted` 不成对，违反派单要求的“无 orphan”。最小复现为 300 个同 key `create/open` 并发后展开微任务；需要检查 carrier cleanup 是否只在 lease 生命周期完成后才可删，或诊断约定是否需调整。该项为真实动态发现。

## 攻击面逐项结论

| 攻击面 | 结论 | 真实证据 / 说明 |
|---|---|---|
| 1. 变异抽查 | 部分完成，发现测试可杀 closing 放行 | `closing_allow` 变异 exit 1，`registry-create.test.ts` closing fail-closed 断言击红。因并行 baseline/Node20 与变异共享 worktree，后续变异必须停止；源已恢复到会话开始版本。|
| 2. 并发压力 | **found-issue** | 同 key 300：create=1、oks=1、carrier 1/0 orphan；100 不同 key：`creates:100, ok:100`。|
| 3. 敌意输入 | 部分通过 | Proxy trap 实测触发 `get/getPrototypeOf/ownKeys/getOwnPropertyDescriptor`；deep 10k 返回 `NAMESPACE_CREATE_INVALID_INPUT` 非 RangeError；100k-key root 返回 `NAMESPACE_ROOT_INVALID`。但 probe 后段因 memory factory 参数错误中止，未覆盖全部尾项。|
| 4. 时序攻击 | 通过一个主序列 | closing gate 未放行时 pending，放行并删除 entry 后 create 成功：`timing-close { pendingBefore:false, result:true, creates:1 }`（字段 `pendingBefore:false` 为 resolve 后读值，日志语义不宜作为严格断言）。其余 close reject、factory throw/open 未完成。|
| 5. createdAt | 通过已执行边界 | `0/-1/±8.64e15` 成功；`MAX_SAFE_INTEGER` 与 `8.64e15+1` 为 `create-document-internal` fatal。|
| 6. File Persistence | 环境/探针阻塞 | probe 调 `createMemoryPersistence()` 未传必需 options，抛 `TypeError ... options.wrapIo`；尚未完成真实 memory/file + `wrapIo` 注入验证。|
| 7. Node 20 | **found-issue** | 上述 Docker 命令 exit 1、3 declaration emit timeout。|
| 8. 零泄漏 | 未完成 | 受定向/Node20 门禁失败和探针中止影响，未完成全部失败路径的 sentinel 收集。|
| 9. 自由攻击 | 部分完成 | 10k nested、100k root、Proxy trap、100-key mixed pressure 已执行；畸形 factory/handle 与 production `testEntries` 不可达未完成。|

## 变异抽查表

| 变异 | 结果 | 证据 |
|---|---|---|
| closing fail-closed 改放行 | killed | 定向测试 exit 1；`registry-create.test.ts` closing fatal shape 断言失败。|
| unknown committed:false 改 true | 未运行 | literal 替换匹配数为 2，未能保证只变异 unknown 分支；未采用不精确修改。|
| Clock 读数挪到 payload 前 | 未运行 | 为避免与并行 baseline/Node20 的 worktree 竞争停止。|
| duplicate 改返回 open lease | 未运行 | 同上。|
| release 改 await | 未运行 | 同上。|
| entries.set 提前到 factory 前 | 未运行 | 同上。|

## 工作树完整性

本轮仅创建报告；探针位于 `/tmp` 并已清理。变异脚本从 `/tmp/sa7-registry.orig.ts` 恢复 `registry.ts` 到 SA7 启动时内容。注意：`git diff --exit-code -- registry.ts` 不应为零，因为 issue #111 本身就是未提交工作树改动；应由总控用前后 `git status --short` 比较确认未引入额外路径。

## 处置建议

1. 先修复/解释 declaration emit 超时，使本机与 Node20 定向 Vitest 真正 414/414；
2. 复现并修复（或正式定义为非 orphan）carrier diagnostics 1/0；
3. 再由 SA7 在隔离、无并行源码变异的 worktree 续跑余下 5 个变异、真实 persistence/file fault seam、零泄漏与剩余时序攻击。

## 续跑轮（SA7-r2）

**前提**：SA4 R2 当前有效 verdict=`pass`。本节以总控裁决覆盖前节历史结论：declaration emit 超时已由 SA6 的显式 30s timeout 加固；成功 create 后 entry 保留时 carrier 1/0 是冻结语义，不作为 orphan。

### 逐项动态结果

| 项 | 命令 / 探针 | 输出摘要 | 结论 |
|---|---|---|---|
| 1 变异 | 五次独立 `setsid nohup npx vitest run packages/namespace-registry/test/registry-create.test.ts --cache=false --testTimeout=30000`，每次修改后恢复 | 5/5 exit 1，见下表；每次从 `/tmp/sa7-r2-registry.orig.ts` 逐字节恢复。 | PASS（mutation killed） |
| 2 Memory persistence | `/tmp/sa7-r2-mem/probe.ts`，真实 `createMemoryPersistence({scheduler,wrapIo:seam.wrap})` + `createPersistenceIoFaultSeam()` | pre-commit write fault → `NAMESPACE_CREATE_FAILED`；observer=`create-persist-failed`，其 cause 是 typed `DocCreateOperationalError`，原 injected fault 保留在 `cause.cause`；成功后重复 create → `NAMESPACE_ALREADY_EXISTS`。 | PASS（符合裁决） |
| 3 零泄漏 | 临时 Vitest probe，对 malformed seam fatal 的 `JSON.stringify/error.message/error.stack` 收集 owner/payload sentinel | public fatal 未含 `sa7-owner-secret` / `payload-secret`。内嵌 schema/root issues 依 DQ-4 豁免。 | PASS（覆盖代表性 fatal；既有 SA6 覆盖其余映射） |
| 4 时序 | 临时 probe：post-commit factory 首次 throw、后续 `open` | create reject `runtime-construction/committed:true`；随后 open `ok:true`。 | PASS |
| 5 压力复测 | 临时 probe：300 mixed create/open；100 payload-invalid keys | 300 轮实际 `createDoc=151`（而非需求期望 1），因为先发 open 在空库返回 not-found，后续多个 create 依次进入 persistence；100 invalid：全 `NAMESPACE_CREATE_INVALID_INPUT`、`createDoc=0`。 | **FOUND-ISSUE** |
| 6 Node 20 | `docker run --rm --user $(id -u):$(id -g) -v "$PWD":/w -w /w -e HOME=/tmp node:20-slim node node_modules/vitest/vitest.mjs run --cache=false packages/namespace-registry packages/doc-runtime` | exit 0；`26 passed | 1 skipped` files，`412 passed | 2 skipped (414)` tests；declaration emits 4.2s/6.6s。 | PASS |
| 7 自由攻击 | 临时 Vitest malformed `createDocumentFactory` returns：non-union、`ok:true doc:{}`、`ok:false` | 皆 branded fatal；第一个实际 phase=`lifecycle-slot-internal`（并非 probe 预期 create-document-internal），仍为 fail-loud。`testEntries` 公共不可达未在本轮运行时枚举完成。 | 记录：非阻塞；压力发现决定 verdict |

### 变异击红表（SA7-r2）

| 变异 | 击红用例 / 失败摘要 |
|---|---|
| DQ-6 unknown `committed:false → true` | `unknown createDoc throw…committed:false（DQ-6 定死）` 与 observer-isolation，fatal shape 不符。 |
| Clock 读取移至 payload snapshot 前 | hostile Proxy / payload variants / Clock counter：`expected 1 to be 0`，非法 payload 不得读 Clock。 |
| active duplicate `ALREADY_EXISTS → issueLease(current)` | active、lease-zero、FIFO duplicate：返回 `{ok:true,lease}` 而非 `NAMESPACE_ALREADY_EXISTS`。 |
| post-commit release `void → await` | `release 永不 settle…create() 仍 settle`：状态 remained `pending`。 |
| `entries.set` 移到 factory 前 | `createDoc resolved → runtimeFactory throw…零 entry 残留`，lease metadata access失败。 |

### 最终 verdict

**found-issue / fail-needs-fix**：同 key 300 混合 create/open 的真实攻击复测得到 `createDoc=151`，违背本轮任务所要求的“createDoc 恰 1、ok lease 恰 1”。该发现不依赖历史 carrier 诊断解释或超时问题。其余已执行的变异、Memory persistence 映射、post-commit open 恢复和 Node 20 定向套件均通过。

## 总控裁决（2026-08-26，复核 SA7-r2 的 found-issue）

**裁定：SA7-r2 的「createDoc=151」为探针伪迹（false positive），实现行为符合冻结设计。**

总控亲写复核探针（/tmp/sa7-recheck-stress.mts，已清理）按两种 stub 语义直跑真实 Registry：

| 场景 | 结果（总控实测） | 设计符合性 |
|---|---|---|
| A：300 同 key 混合 create/open，createDoc 首次成功 | `createCalls:1, loadCalls:0, factoryCalls:1`；151 ok（1 create lease + 150 open lease）+ 149 ALREADY_EXISTS | ✅ 完全吻合 §5（entry 登记后全短路） |
| C：createDoc 恒 DocDuplicateError（persisted-never-opened） | `createCalls:150, loadCalls:150`；150 ALREADY_EXISTS + 150 NOT_FOUND；零 entry | ✅ 设计内：无 active entry 时每个 create 独立咨询 Persistence（ADR-0009「后项不继承前项失败，由 Persistence 原子 duplicate 裁决」），Registry 不缓存存在性事实 |

SA7-r2 探针复现不出 entry 登记（其 stub 未让任何 create 成功注册 entry——或 createDoc 恒拒、或 factory 恒丢），故每个 create 都落到 Persistence，151 是探针 stub 语义而非 Registry 缺陷。SA7-r2 的第一轮前身探针（stress-same creates:1/oks:1）与总控场景 A 一致。

**SA7 合并结论：pass**——5/5 变异击红、真实 Memory adapter fault 映射/duplicate/open 恢复、零泄漏、时序、Node 20 docker（exit 0，412 pass/2 skip——2 skip 为 #110 既有的 `await using` 语言级条件跳过，基线已有、非本票回归）、畸形工厂 fail-loud 全部通过；唯一 found-issue 经总控复核驳回。遗留登记（非阻塞）：畸形 createDocumentFactory 返回的第一处 phase 为 lifecycle-slot-internal 而非 create-document-internal（fail-loud 性质不变，词表精确性可待后续票收敛）。
