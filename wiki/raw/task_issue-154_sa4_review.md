# SA4 静态验尸报告 — Issue #154：Retain, lease, and delete namespace diagnostic logs

**Date**: 2026-08-31
**Reviewer**: SA4（独立静态红队；只读审查，零代码/测试改动）
**Review 对象**: `722bddf..c0f6cbc`（SA3 实现提交 `c0f6cbc`，diff = 15 files, +2642/−32）
**上游输入**: `task_issue-154_sa1_analysis.md`、`task_issue-154_sa2_design.md`（绑定设计）、`task_issue-154_sa6_red.md`（45 红灯/护锚测试）、`task_issue-154_sa3_impl.md`

---

## Verdict: **REJECT**（1 项 P1 阻断；其余维度全部通过）

阻断项唯一且修复面极小（sweep 字节遍历中一行条件 + 注释 + 一个新钉死测试）。不触发 needs-redesign——架构、协议、状态机、事件面、测试方法学均成立，无需退回 SA1。

---

## 0. 独立复核证据（本审查实际执行的命令与结果）

| 命令 | 结果 |
|---|---|
| `git diff --name-only 722bddf c0f6cbc` | 15 文件，全部落在 SA2 §3 ALLOW LIST 内（见 §1.1）；DENY 面（`schema.ts`/`adapters/memory.ts`/`docs/adr/**`/`namespace-runtime`/`namespace-registry`/`src/testing.ts`）零触碰 |
| `npx tsc -p packages/namespace-diagnostic-log/tsconfig.json` | exit 0（与 SA3 §3.1 一致） |
| `npx vitest run packages/namespace-diagnostic-log/test/file-adapter-retention-deletion-windows.test.ts` | 5 passed（W0–W3 + T-E8 实测绿） |
| `npx vitest run packages/namespace-diagnostic-log/` | **27 files / 426 tests / Type Errors 0 全绿**（381 既有 + 45 新增——与 SA3 §3.2 声明一致） |
| BLACKLIST 扫描（`package-lock.json`/`yarn.lock`/`TASK.md`/`*.bak`/`.DS_Store`） | diff 内零命中 |

测试绿灯声明**属实**；REJECT 依据是绿灯覆盖不到的设计偏离（SA6 的字节边界测试全部以 `maxAgeMs: null` 或 `0` 构造，恰好绕开该偏离——见 §2）。

---

## 1. 设计一致性审查

### 1.1 文件清单 Scope Creep Guard —— ✅ PASS

ALLOW LIST 提取自 SA2 design §3（含 §2/§4/§9 全部反引号路径）。actual diff（15 文件）逐一比对：

- src：`retention.ts`（新）、`read-session.ts`（新）、`adapters/file.ts`、`reader.ts`、`health.ts`、`index.ts` —— 全部在列；
- 测试：SA6 五文件 + `test/helpers/file.ts`（fixture 纯增量，设计明列）；
- 文档/工程：`README.md`、`AGENTS.md`、`package.json`（0.1.4→0.1.5）—— 在列；
- 越界文件：**无**；BLACKLIST：**无**。`src/paths.ts` 未改（SA1 建议过、SA2 裁决由 file.ts `markerPathOf` 内联派生——遵 SA2）。

### 1.2 设计偏离审查 —— ❌ 1 项 P1 阻断（详见 §2），其余一致

逐条款核对结论：公共 API 形状（§2.1–2.5 类型/语义表）、删除协议 S0→S3、namespace 删除 N0–N5 + `deletion.json` 线性化门、读会话状态机（TTL 惰性/maxLifetime 越界即拒/劝告锁语义）、构造序（config-invalid 事件 → marker 门**先于** roll-target 门与 resume 编排、零写入 → 构造完成自动 sweep 仅 ready）、事件面（只增不改、低基数、有动作才发）、INV-1/2/3/4/5/6/8/9/13/14 全部落点正确。SA6 §4 的 10 条歧义裁决（renew 判定时点、`.deleting` 组整体剔除、T-B9 等价替代、非法配置零事件等）均已按 SA6 钉死读法实现。

### 1.3/1.4 spec/vitest 触发性 —— ✅ PASS

新测试 5 文件均位于 `packages/namespace-diagnostic-log/test/*.test.ts`；`.github/workflows/ci.yml:39` 的 `pnpm test` = `vitest run --typecheck`（全仓、无 package 过滤）覆盖之；本地全量实测 426 绿。

### 1.5 协议假设 —— ✅ PASS（抽查）

A1（同目录 rename 原子）、A2（ENOENT 幂等 + `errnoOf` 稳定码）、A4（`rmSync force` ENOENT 静默）均落在既有先例代码上（`file.ts:151-155,880-894` 现行实现）；A5 单线程同步模型经核对成立——`sweepNow`/`deleteGroup`/`openDiagnosticReadSession` 全同步、无 async fs。无「应该/通常」类无据假设。

### 1.6 契约改动连锁 —— ✅ PASS

无既有 export 函数的 throw/return 契约翻转：`readStreamStrict` 仅**增**两个必填返回字段（对象形状增量，消费者只读不构造——`pnpm typecheck` 全仓绿佐证零涟漪）；`analyzeStreamForResume` 返回类型不变（trim 容差仅改变 `historyTrimmed===true` 流的 verdict，属设计内行为变更且有 T-E4/T-E5 双向钉死）。`FileDiagnosticLog` 增 `sweepRetention` 为对象形状增量。新 standalone 函数（`deleteNamespaceDiagnosticLog`）绝不抛（结构化 result）；`openDiagnosticReadSession` 对**调用方入参错误**loud throw（新 API、零既有 caller、SA2 §2.3 未规定失败面——可接受，见 §5-R5）。

### 1.7 源码 GREP 断言禁令 —— ✅ PASS

5 个新测试文件扫描：T-A8 的 `readFileSync(manifestPath)` + `.equals()` 是**运行时产物字节恒等**断言（manifest 文件本身），非源码字符串断言；T-D7 的 `not.toMatch(/erase|purge|wipe|secure/)` 断言对象是**运行时返回值** JSON。全部断言面向磁盘字节/事件/返回值——合规。

---

## 2. ❌ 阻断项（唯一）：P2 字节遍历被年龄前沿门控 —— 字节上限在 `maxAgeMs ≠ null` 时（含默认 30d 配置）完全不可执行

**Severity**: P1（功能性契约违背：TASK.md AC-1 + SA2 §4.5/§2.1/§12-AT12 + 实现自带 README 自相矛盾）
**回流目标**: **SA3**（修实现）+ **SA6**（补钉死测试）。不需要 SA1 重新设计——SA2 §4.5 已有明确语义。

### 2.1 证据（file:line）

`packages/namespace-diagnostic-log/src/adapters/file.ts:1274`（P2 字节遍历内层组循环）：

```ts
if (maxAgeMs !== null && !groupAgeExpired(stream.segmentsDir, segment, now - maxAgeMs, report)) break
```

配套注释 `file.ts:1235-1236` 自认把「未过期」加进 P2 止步原因（「无可删候选（全被开组/租约/**未过期**/失败止步）→ 停」）——该词为 SA3 自增，上游任何文档均无此裁决。

### 2.2 为什么违背需求（推理链）

1. **P1 已删尽同口径候选**：P1（`file.ts:1200-1233`）沿同一候选序（createdAt↑/streamId↑/段号↑）、同前缀纪律删除**全部**「闭组 ∧ 无活跃租约 ∧ 年龄过期」的组。P2 开始时，不存在任何剩余的年龄过期闭组。
2. **P2 的年龄门 ⇒ P2 恒死代码**：P2 组循环遇首个「未过期」组即 `break`（`file.ts:1274`）。而 P2 能走到的每个候选要么已被 P1 删除（不在枚举）、要么正是那个让 P1 止步的未过期/被租约/开组/失败组——后三者同样使 P2 止步。故 **`maxAgeMs ≠ null` 时 P2 的删除数恒等于 0**；字节遍历仅在 `maxAgeMs === null` 时才有行为（恰是 SA6 唯一测到的形态）。
3. **默认配置下字节上限失效**：ADR 0012 / SA2 §2.1 / README 的缺省 = `maxAgeMs=30d ∧ maxBytes=1GiB`。任一 namespace 在 30 天内写入 >1 GiB（高流量场景常态）：P1 无一过期 → 零删除；P2 首组未过期 → 止步 → `total` 永远压不进预算。**「有界 namespace 诊断存储」的字节界在数据新鲜期内不可执行，磁盘可无界增长至 30 天**。
4. **违背的三处上游文本**：
   - TASK.md AC-1：「Retention **enforces** configurable maximum age **and bytes** per namespace」；
   - SA2 §4.5 P2：「无可删候选（全被**开组/租约/失败**止步）→ break」——止步原因穷举式列明三种、**刻意不含「未过期」**（对照同节 P1 的止步清单「（开组 / 租约 / **未过期**）」显式含之——同一作者在两处清单的差异即设计意图）；
   - SA2 §2.1 语义表 + §12-AT12：「`maxBytesPerNamespace: 0` → 下限 = 开组字节 + **被租约/开组阻塞**的组」——下限语义无「age-fresh」项；该表被实现自己的 README（新增节「`maxBytesPerNamespace` | `1 GiB` …`0` = 裁掉全部可删闭组」及「下限 = 开组 + 被租约/开组阻塞的组」）原样复述——**实现与自己的文档相互矛盾**。
5. **SA1 §4.4 同向佐证**：「仅剩 **open/leased** group 而仍超预算 → 停 + 事件」——字节驱动的止步条件不含年龄。
6. **红灯缺口**：T-A3（`test/file-adapter-retention.test.ts:167,174` 用 `maxAgeMs: null`）、T-A5（`0/0`）、T-B10（`:443` `maxAgeMs: null`）——全部绕开「年龄非空非零 + 字节驱动」交叉面，偏离因此漏绿。

### 2.3 修正（specific correction）

1. **SA3**：删除 `file.ts:1274` 整行条件（P2 止步原因收敛为 {开组、活跃租约、IO 失败}——开组/租约/失败三个既有 `break` 分支保留，前缀纪律不变），并同步修正 `file.ts:1235-1236` 与 `:1288` 注释（移除「未过期」）；README 无需改动（其文本本就是正确语义）。
   - 回归安全性预核（SA4 已静态推演）：T-A3/T-A5/T-B10 用 `maxAgeMs: null|0`（门不存在或恒过期）；T-A7 数据 ≪1GiB（P2 循环不进入）；T-B4/T-C* 的开组/租约止步分支先于该行触发——**移除该行不破坏任何既有 45 测试**。
2. **SA6**：补一个钉死测试（建议 T-A9）：`maxAgeMs` 为非空非零（如 30d 缺省或 1000ms）+ 数据龄 0（新鲜）+ `maxBytesPerNamespace < total` ⇒ 最旧闭组被删至 ≤ 预算、开组原样、`retainedBytes` = 开组+阻塞组字节（顺带钉死 §2.2-4 的下限语义）；另加反向锚：删后 `historyTrimmed` 报告正确。

### 2.4 固定复验范围（fixed revalidation scope）

SA3 修复后，SA4 只复审：(a) `sweepNow` P2 块（`file.ts:1235-1290`）及两处注释；(b) 新 T-A9 测试的行为覆盖面；(c) 全量 `npx vitest run packages/namespace-diagnostic-log/`（27 files / 427 tests）+ `npx tsc -p packages/namespace-diagnostic-log/tsconfig.json` 佐证。其余模块（reader/read-session/health/index/删除协议/文档）本轮已验，不在复验范围。

---

## 3. 读写路径一致性 —— ✅ PASS

- 枚举单源：reader/resume/sweep/read-session 四面共享 `enumerateSegmentGroups`（`reader.ts:356-374`，`.deleting` 组整体剔除）——无第二份漂移枚举。
- 写读闭环：writer append（jsonl+bin 成对）→ retention 只 rename/unlink 段文件（**永不写** manifest/current.json，INV-6，T-A8 manifest 字节恒等钉死）→ reader/resume 同源枚举解释幸存后缀。删除协议中间态（W1 bin-无-jsonl）落在 reader 既有合法窗口。
- namespace 删除：deletion.json 门（构造侧 `file.ts:1358-1362`）与删除侧（`file.ts:1513-1596`）同一 marker 路径派生（`streamLayoutPaths` + 固定名），无路径分叉。

## 4. 静默失败 / 错误处理链路 —— ✅ PASS（1 项阻断外无缺口）

逐失败路径核对：sweep 任一 IO 失败 → `failedSteps++` + 止步 + （有动作时）`retention-swept` 事件；配置违规 → 恰一次 `retention-config-invalid`（`file.ts:1346-1350`，任何磁盘访问前）；marker 门 → 恰一次 `stream-init-failed{namespace-log-deleted}` + 零写入（T-D4 字节恒等实测）；删除失败 → 结构化 `failed{code,step}` 可重入（N2/N3/N4 续走实测）；`renew()` 拒绝 → 返回值即反馈；被租约阻塞 → `leaseBlockedGroups` 计数。无三无（无请求/无状态/无反馈）路径。INV-5 实证：`sweepNow` 全体包 try/catch（`file.ts:1317-1322`），T-B9 只读目录下不 throw。

## 5. 极端条件攻击 / 降级 / 架构 / 过度设计

- **开组保护（INV-1）**：✅ 双形态钉死（T-B4/T-B5/T-E7）；orphan 清理对开组 `continue`（`file.ts:1132`）。
- **前缀纪律（INV-2）**：✅ P1/P2 每流首不可删组即止步；T-B6/T-B7（含 `.deleting` 目录占位态下幸存集仍连续后缀——枚举剔除保证）。
- **输入/路径安全**：✅ `deleteNamespaceDiagnosticLog` 文法前置零 fs（T-D3：`..`/分隔符/控制符 → `invalid-namespace-id` 且不建 `namespaces/`）；segment 名恒经 `isSegmentName`；stream 条目恒经 `isSafeStreamId`（`{s}.deleting` 分支对 slice 后的 base 判定）。
- **事件基数**：✅ 恰一次语义（config-invalid / namespace-log-deleted / 有动作 swept）；低基数（计数+封闭枚举，无 streamId/segment）。
- **并发/竞态**：进程内全同步序列化（A5）；多实例重叠期仅欠保护方向（SA2 AT7 已备案，实现一致）；见 §6-R1/R4 残余。
- **架构**：✅ 可行，无死胡同信号（无绕过堆叠、无 FIXME 层积、降级面均为结构性保守且有计数）。
- **过度设计**：✅ 精简——两新模块均为设计指定的纯 TS 切分；无多余抽象层。

---

## 6. 残余非阻断风险（residual，交 SA7 动态/交后续票；不阻塞本票）

| # | 风险 | 等级 | 说明与建议处置 |
|---|---|---|---|
| R1 | **字节核算/`retainedBytes` 不计 `.deleting` 态组**（`file.ts:1237-1252,1293-1303` 仅计 `enumeration.live`） | Low | 中断删除窗口内 total/retainedBytes 低报（方向保守：少删）。SA1 §4.4 建议「计入直到删除完成」为 advisory；构造期卫生遍历先完成后 P2 才算账，窗口极窄。交 SA7 观测即可。 |
| R2 | **manifest 缺失/不可读的流整体不参与 sweep（含卫生遍历）**（`file.ts:1013`） | Low | 该类流的遗留 `.deleting`/orphan 永不清理、字节不计入预算。SA3 已备案（deviation #3）；保守方向。交 SA7 造一个无 manifest 流验证无副作用。 |
| R3 | **租约注册表 key 为 rootDir 原始字符串**（`read-session.ts:54-56`）：别名拼写（尾斜杠/相对路径/符号链接）产生不同分区 → 租约对 sweep 不可见 | Low | 劝告锁弱化，非正确性破坏（单进程 Host 以同值传 rootDir）。建议 #155 Host 接线票文档化「rootDir 必须规范化同值」。 |
| R4 | **sweep 对他实例 open 组的欠保护**（openSegmentOf 仅认本实例 currentStreamId，`file.ts:1195-1196`） | Low | SA2 §12-AT7 已接受（单写者模型 + 重叠期旧实例应已停写）。交 SA7 做一次重叠双实例烟测确认无数据损毁即可。 |
| R5 | **`openDiagnosticReadSession` 对非法入参 loud throw**（`read-session.ts:159-171`） | Info | 新 API 无既有 caller；SA2 未规定失败面。建议 README/Host 文档（#155）注明 throw 契约。 |
| R6 | **「有动作」判定把 leaseBlockedGroups/openProtectedStops>0 计为动作**（`file.ts:1325-1334`） | Info | 仅被阻塞（零删除）的 sweep 也发一次 `retention-swept`——可辩护读法（阻塞可见性），构造期租约活跃时每次构造一条事件，噪声有界。备案即可。 |
| R7 | **未关闭会话的注册表条目无上限积累**（惰性清理仅 close 时删除） | Info | Host 需调用 `close()`；长期进程建议接入方自律。 |
| R8 | **1 GiB 字节默认仅间接覆盖**（SA6 §4.5 已备案） | Low | 修复 §2 后可由 T-A9 一并真实钉死大数语义（不必写 1GiB 数据）。 |

---

## 7. 审核结论汇总（skill 八项）

1. 设计一致性：⚠️ **偏离 1 项（P2 年龄门，§2）**——REJECT 依据；其余（API/协议/状态机/事件/构造序/INV）一致。
2. 读写路径一致性：✅ 一致（枚举单源；INV-6 钉死）。
3. 静默失败：✅ 无。
4. 降级方案：✅ 一切止步/跳过均有结构性原因并计数/报告；无伪降级。
5. 极端攻击：✅ 除 §2 外未发现可静态确认漏洞（R1–R8 为残余面）。
6. 错误处理：✅ 完整（INV-5 实证）。
7. 架构评估：✅ 可行。
8. 过度设计：✅ 精简。

## 8. 动态审核重点（交 SA7）

1. **§2 修复后的字节边界动态验证**：默认 30d/1GiB 配置下写入超预算新鲜数据，确认 P2 删除最旧闭组至 ≤ 预算、开组/租约组字节不变（对应新 T-A9 的真机版）。
2. **W1/W2 真实崩溃窗口**（非合成）：kill -9 于 rename/unlink 之间后重开，断言 no-rotate + 卫生续走完成（静态已核，动态补证）。
3. **R4 重叠双实例**：同进程新旧 adapter 并存时 sweep 只删 sealed 代（欠保护方向无数据损毁）。
4. **R2 无 manifest 流**：置于 namespace 内跑 sweep，断言零副作用、计数诚实。
5. **`retention-swept` 事件基数**（R6）：长租约 + 反复构造下事件频率有界。

---

## 9. 结论

实现质量整体扎实：协议、状态机、恢复次序、reader/resume 兼容、事件纪律、测试方法学均达标，426 测试实测全绿。但 **P2 字节遍历的年龄门（`file.ts:1274`）使字节上限在默认配置下不可执行**，违背 TASK.md AC-1、SA2 §4.5/§2.1/AT12 及实现自带 README 的下限语义，且恰处测试盲区。**Verdict: REJECT**——按 §2.3 修正（SA3 一行删除 + 注释同步；SA6 补 T-A9）后，SA4 仅按 §2.4 固定范围复验。
