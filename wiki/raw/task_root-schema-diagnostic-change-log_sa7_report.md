# SA7 动态验证报告 — task_root-schema-diagnostic-change-log（issue #149）

**Date**: 2026-08-29
**Verifier**: SA7（Dynamic Verifier；独立动态验证，未参与 SA1–SA6 任一环节）
**被验对象**: worktree `/home/wangjian/nomicore-fix-issue-149`（commit `96cd085` + SA7 测试层修复，基线 `eaf0484`）
**输入**: 任务简报 / SA4 静态审核报告（Verdict: pass，§3 DV-1..DV-6）/ SA5 报告 / SA6 红灯契约
**Verdict**: **pass**（附 1 项 fail 级发现 **已由 SA7 在测试层修复**——commit 96cd085 原样推送必红 CI `Test` 步；修复为纯类型层、零行为变更，修复后全部 CI 等价门禁本地全绿。详见 §3 SA7-F-1 与 §5。）

---

## 0. Step 0/Step 1 结论（技能立法）

```
[SA7 Step 0 结论]
SA4 verdict: pass（sa4_review.md L7）
操作: 进 Step 1

[SA7 Step 1 结论]
SA6 红灯: 🟢 GREEN —— npx vitest run packages/namespace-runtime/test/runtime-root-schema-diagnostic-red.test.ts
  --typecheck.enabled=false → 14/14 通过（453ms，exit 0，独立进程 setsid 执行）
操作: 进入 Step 2（DV-1..DV-6 清单验证）
```

## 1. 执行方法

全部测试命令独立进程执行（`setsid nohup … & disown`，技能 2026-05-08 立法）；本包为纯 vitest 库包，无端口/服务依赖（`fuser -k 8000/tcp 8081/tcp 3005/tcp` 例行清场，无占用）。SA7 新增补充测试文件：

**`packages/namespace-runtime/test/runtime-root-schema-diagnostic-sa7.test.ts`（16 it，16/16 绿，722ms）**

---

## 2. DV-1..DV-6 逐条验证结果

### DV-1 慢 emit 槽间延迟 ✅ 通过（I-2 动态证据）

**方法**：人为延迟 emitter（emit 内同步自旋 40ms，无 await/定时器）+ 测试侧 `doc.on('update')` 时间戳（槽内事务时点）+ 第二笔写输入 Proxy get-trap 时间戳（S3 快照 = 槽 2 起点首个可观测动作）+ `performance.now()` 单调时钟。

**实测断言（全部通过）**：
- emit 严格在**槽间**：`emit1-start > tx1`、`emit2-start > tx2`（emit 不在槽窗口内——amendment C「slot 已释放后的微任务」动态面成立）；
- FIFO 不变：`emit1-end < emit2-start`；记录 sequence `['1','2']` 升序 ≡ emit 顺序 ≡ 写入顺序；终值 `ROOT.n === 7`（第二笔胜）；
- **耦合确认（I-2 实测）**：自旋真实生效（`emit1 时长 ≥ 40-5ms`），且 `slot2 首次输入读取 ≥ emit1-end`（慢 emit 确实推迟下一槽 thunk 启动）；`slot2 读取 - emit1-end < 200ms`（除 emit 外无额外隐藏延迟）；
- 槽窗口不受 emit 影响：`tx2 > emit1-end` 且 `tx2 < emit2-start`（槽 2 事务在 emit1 之后、emit2 之前正常发生）；
- 两笔 carrier 链式重放（base→tx₁→tx₂）观察 `n===7`；`getStatus().fatal === null`。

### DV-2 acceptance 同步 emit 延迟 ✅ 通过（I-3 动态证据）

**方法**：慢 emitter（30ms 自旋）装配，`close()` 后调用 `mutateRoot()`，测同步段墙钟 + settle 判定。

**实测断言（全部通过）**：
- `emitCalls === 1` 且在 `mutateRoot()` 调用返回**前**计数即到 1（公共方法调用栈内同步 emit）；
- 同步耗时 `≥ 30-5ms`（慢 emitter 耦合进纯同步拒绝路径——I-3 量化确认）；对照组（快 emitter）同一拒绝路径 `< 20ms`（实测量级差全部来自 emit 本身）；
- **无隐藏 await/异步化**：返回 promise 在 `await null` 两个微任务轮回内必已 settle（`settled === true`）——业务返回仍为已 settle 的 `Promise.resolve`；
- 记录分类：`acceptance / RUNTIME_WRITE_DISABLED / rejected / input not-accessed`（full 策略下仍零输入访问），业务 `ok:false` 含稳定码。

### DV-3 unhandledRejection 抑制面 ✅ 通过（I-4 动态证据）

**方法**：`void runtime.mutateRoot(...)`（故意不 await）触发 R5 fatal（getStatus 抛错注入），装配/未装配 emitter 两形态 + `process.on('unhandledRejection')` 探针 + 6 轮 setImmediate/setTimeout macrotask 观察；阳性对照在隔离子进程执行（不污染 vitest 进程）。

**实测断言（全部通过）**：
- 装配 emitter：`unhandled === []`（事件不触发）；
- 未装配 emitter：`unhandled === []`（`void settled.then(...)` 无条件附加——两形态均抑制，与 SA4 I-4 静态结论一致）；
- 子进程阳性对照（`node -e`，status 0）：裸拒绝 `FIRED=1`（探针语义有效）+ 附加反应形态（本实现挂点形状）不计发——抑制机制双证；
- **生产面零依赖**（grep 证据）：`unhandledRejection` 在 `packages/**` 仅命中 9 个**测试**文件（registry×6、runtime-close-sa7、file-persistence-sa7 等），全部为「断言不发生」方向探针；`packages/*/src/**` 零命中——无任何生产调用方依赖该信号。

### DV-4 未钉死结局点运行时行为 ✅ 通过（§13.7 清单 + seam 守卫）

| 结局点 | 注入方式 | 实测记录分类（与 §9 表逐项一致） | 业务面 |
|---|---|---|---|
| R3（handle.release 后写） | `await handle.release()` 后 `mutateRoot` | `capability-gate / RUNTIME_WRITE_DISABLED / rejected / not-accessed`（full 策略仍 not-accessed；code↔sourceModule 成对） | ok:false；live doc 零写入 |
| S2′a（SCHEMA 槽 fatal 门） | ROOT 槽 R5 置位 fatal 后 `replaceSchema` | 同上四元组；`schema-replacement` | active schema 不变 |
| S2′b（SCHEMA 槽 notifyDirty 未绑） | 不注入 notifyDirty | 同上四元组 | 零写入 |
| S2′c（SCHEMA 槽 getStatus 抛错） | Proxy 劫持 getStatus | `fatal committed:false / capability-gate / NSRT-FATAL-SCHEMA-WRITE-INTERNAL / write-slot-internal / not-accessed` | 零写入；`status.fatal` 为 SCHEMA 独立摘要码 |
| S3′b（replaceSchema 未知键） | `{schema, extra:1}` | `validation / rejected / 无顶层 code / input full 快照已捕获 / issues 非空` | 零写入 |
| S5′a（keep-root 不兼容） | ENV_REPLACE 未提供 root | `validation / rejected / input digest / issues 非空` | SCHEMA/ROOT 均不变 |
| S6′（SCHEMA 槽 notifyDirty 失败） | notifier throw | `dirty-notification / NSRT-FATAL-SCHEMA-WRITE-INTERNAL / notify-dirty-failed / fatal committed:true / effect update`；**三联成立**：carrier 基态重放见新 `SCHEMA.text` 且 ROOT 未动 + live doc `getSchemaEnvelope().text` 已切换 + fatal 置位 | rejects `{phase:'notify-dirty-failed', committed:true}` |
| R8（S4 结构不可达） | 动态演示：`p0Gate` 挂住 | 写被接纳但槽 40ms 内不启动（`done===false`、0 记录、`preparing`）；放行后写正常 `{ok:true}`、`fatal===null`——**'preparing' 在槽体永不可观测 ⇒ R8 前置结构性成立**；机制面：p0.ts L164-165 `activeTools` 与 `schemaState='ready'` 单点同时写入 | — |
| seam 守卫 | doc 无 on/off + emitter | 构造期 `TypeError`（message 含 `on/off`，throw 前置于 enqueue）；真 Y.Doc 装配不 throw 且正常 emit/写 | — |

（R8 无法经公共 seam 注入 `'ready' + tools===undefined` 状态——FIFO 使 P0 未 settle 时槽体不启动；结论与 SA4 静态穷举一致。）

### DV-5 CI 触发证据 ⚠️ 本地全绿 + CI run 级证据**环境阻塞**（分支未推送）；另见 §3 SA7-F-1（已修复的 CI 必红缺陷）

**环境事实**（命令+输出）：
- `git branch --show-current` → `fix/issue-149-on-docs-namespace-diagnostic-change-log`；`git log origin/<branch>` → **unknown revision（分支未 push）**；
- `gh pr list --head <branch>` → 空；`gh run list --branch <branch>` → 空（无 PR、无 CI run）；
- SA7 职责边界：不 push、不建 PR、不宣称 CI 已绿 → **run 级 log 摘录（`gh run view --log`）不可得，属环境阻塞而非验证失败**；
- 历史旁证：`gh run list --limit 5` → 该仓库其余 5 个近期 CI run 全部 `success`（GitHub runner 无本沙箱工件）。

**本地等价验证**（CI `Test` 步命令逐项）：

| CI 步 | 本地命令 | 结果 |
|---|---|---|
| Typecheck | `pnpm typecheck` | **exit 0** |
| Test | `pnpm test`（= `vitest run --typecheck`） | **142 文件 / 1816 测试全过；Type Errors no errors**；exit 1 仅因 2 条 `[vitest-worker]: Timeout calling "onTaskUpdate"`（纯 vitest 内部 RPC 栈、零应用帧——与 SA4 改动前观察的工件签名/条数一致，本沙箱满载环境工件；受影响三包单独运行 exit 0 零工件佐证非本改动引入） |
| Persistence contracts | `vitest run packages/persistence/test/persistence-contract.test.ts --typecheck` | **exit 0（6/6）** |
| Domain scaffolds check | `vitest run packages/vfsl/test/domains-scaffold.test.ts` | **exit 0（2/2）** |
| Materialize root tests | `vitest run packages/doc-runtime/test/materialize-root.test.ts --typecheck` | **exit 0（59/59）** |
| Generated freshness | `pnpm generate --check` | **exit 0** |

**收集触发性**（动态）：红灯文件与 SA7 新文件均在本地 vitest 收集列表实际出现（include glob `packages/*/test/**/*.test.ts`）；SA4 静态门禁（grep workflow）+ 本地动态收集双确认。**CI run 级最终证据待总控 push 后以 `gh run view --log` 摘录 `Running N tests` 行补档。**

### DV-6 队列满 + inputPolicy=full ✅ 通过

**方法**：`createBoundedMemoryDiagnosticLog({capacity:1, inputPolicy:'full', updateCapture:true})` + 计数 emitter 包装（等两次 emit 尝试都发生后再断言），两笔 committed 写。

**实测断言（全部通过）**：
- `stats(): accepted===1 / droppedTotal===1 / queueDepth===1`；`droppedByReason['queue-full']===1`；`droppedByOperationReason['root-mutation:queue-full']===1`（比现有 AC4 digest 用例多钉 operation×reason 维度）；
- **drop 对 input 投影无副作用**：已接纳记录保持完整 full 投影 `{capture:'full', digest:…, value:{op,path,value}}`（第二笔的 drop 未降级/篡改/覆盖第一笔投影；record 冻结完好；`result.kind==='committed'`）；
- 业务面：两写均 ok、FIFO 正确（终值 22）、`fatal===null`。

---

## 3. 发现清单

| # | 级别 | 发现 | 处置 |
|---|---|---|---|
| **SA7-F-1** | **fail 级（已修复）** | **commit 96cd085 原样推送必红 CI `Test` 步**：`pnpm test`（= CI 命令）经 `tsconfig.typecheck.json`（include 含 `packages/*/test/**/*.ts`）对普通测试文件做类型检查——SA3 commit 内的 `runtime-root-schema-diagnostic-red.test.ts` 含 **63 处 TS 错误**（`rec/recs[i] possibly undefined`×多数 + `carrier.base64` 未收窄 sidecar 变体 + `result.effect/.update` 未收窄 fatal:false 变体），vitest 以 114 条 Unhandled TypeCheckError 报出 → **exit 1（实测复现）**。根因：SA6/SA3/SA4 全部验证用 `--typecheck.enabled=false`，而 `pnpm typecheck` 只覆盖 `src/**`——该缺口在流水线中无人执行过。 | **SA7 已修复**（测试层职责范围）：纯类型层修复（收窄守卫 `firstAttempt`/`inlineBytes`/`updateCarrierOf` 正向判别 + `recs[i]!`），**零断言/零语义变更**；修复后 `tsc -p tsconfig.typecheck.json` 0 错误、红灯契约 14/14 与 SA7 16/16 行为不变、全仓 `pnpm test` Type Errors no errors。**请总控将本修复并入提交**（red 文件 diff：+38/−21 行，可逐行审） |
| SA7-I-1 | INFO | DV-1 实测确认 I-2 耦合真实存在（慢 emit 确推迟下一槽启动，40ms 自旋全额计入槽间间隔）——amendment C 合规、FIFO 不变；File adapter 装配票设计时须评估（与 SA4 I-2 处置一致） | 移交后续票 |
| SA7-I-2 | INFO | 全仓 `pnpm test` 在本沙箱稳定出现 2 条 vitest-worker RPC Timeout 工件（SA4 改动前同签名同条数；单独运行零工件；GitHub runner 历史 5/5 绿）——环境工件，非代码缺陷 | CI run 级证据待 push 后补档 |
| SA7-I-3 | INFO | 本机 `/tmp` 存在跨会话陈旧 `sa7-*-exit` 文件（本次曾致一次误读「已完成」）；SA7 已改用唯一文件名+预删除。对验证结论无影响 | 记录在案 |

## 4. 回归面

- 红灯契约：**14/14**（修复前后各一次全绿——类型修复零行为变更）；
- SA7 新增：**16/16**；
- 受影响三包（namespace-runtime + namespace-diagnostic-log + doc-runtime 全 test 目录）：**66 文件 / 855 测试全绿，exit 0**（含上述两文件）；
- 全仓 `pnpm test`：**142 文件 / 1816 测试全过 + Type Errors no errors**（exit 1 仅余 §3 SA7-I-2 环境工件）；
- `pnpm typecheck`（10 包）：exit 0；`pnpm generate --check`：exit 0。

## 5. 结论

**Verdict: pass。**

- SA4 verdict 为 pass，SA7 未发现任何**业务实现**缺陷：DV-1/DV-2/DV-3/DV-4/DV-6 全部实测通过，25 结局点中 SA4 移交的未钉死 12 点已有 9 点被 SA7 新测试钉死（R3/S2′a/S2′b/S2′c/S3′b/S5′a/S6′ + seam 守卫 + R8 不可达演示），微任务序/FIFO/事务增量真实性/故障隔离与静态结论逐项吻合。
- 唯一 fail 级发现（SA7-F-1）为**测试文件类型缺陷导致的 CI 门禁必红**，属 SA7 测试层职责，已在 worktree 修复且行为零变化；**推送前必须并入提交**，否则 CI `Test` 步将以 114 条 TypeCheckError 判红（与测试是否全部通过无关）。
- DV-5 的 CI run 级 log 摘录因分支未推送而环境阻塞；全部本地可复现的 CI 等价门禁（typecheck/test/三定向步/generate --check）已绿。待 push 后补 `gh run view --log` 证据即可闭环。

## 6. 产物清单

| 产物 | 位置 |
|---|---|
| 动态验证报告（本文件） | `wiki/raw/task_root-schema-diagnostic-change-log_sa7_report.md` |
| SA7 补充测试（16 it：DV-1/2/3/4/6 + R8 演示 + seam 守卫） | `packages/namespace-runtime/test/runtime-root-schema-diagnostic-sa7.test.ts`（新增） |
| 红灯契约类型层修复（SA7-F-1，零行为变更） | `packages/namespace-runtime/test/runtime-root-schema-diagnostic-red.test.ts`（修改 +38/−21） |
| 运行日志工件 | `/tmp/sa7-step1.log`（红灯 14/14）、`/tmp/sa7-dv2.log`（SA7 16/16）、`/tmp/sa7-three.log`（三包 855）、`/tmp/sa7-full2.log`（全仓 1816 + 2 RPC 工件）、`/tmp/sa7-full.log`（SA7-F-1 复现：114 TypeCheckError） |
