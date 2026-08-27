# SA4 静态验尸报告 — Phase 5: enable replication identity and epoch management

**Date**: 2026-08-27
**Issue**: #132（welltop-jim-wang/nomicore）
**被审对象**: SA3 实现 commit `8113083`（+ SA6 锚修订 `ec83429`），审查 diff 范围 `7425164..HEAD`
**Worktree**: /home/wangjian/nomicore-fix-issue-132
**Verdict**: **pass**

**攻击方法声明**：通读 SA1 设计 R2（808 行）/ SA2 评审（R2 pass）/ SA6 红灯记录（含 R1 回流修订）/
相关决议全文；对实际 diff（26 个 packages 文件，+2364/−40）逐文件审读；对设计声称的全部关键
锚点回查源码（replication-write.ts / runtime.ts / status.ts / p0.ts / write.ts / errors.ts /
index.ts ×2 / lease.ts / registry.ts / types.ts / sequencer.ts / schema-write.ts）；对 Yjs 语义
做设计期同款实证（getMap 异型 throw、`set(k, undefined)` round-trip 存活）；独立进程复跑
测试三链（两包全目录、CI 同链全量、red 文件 flake 复跑）。

---

## 一、门禁清单（按 SKILL 立法顺序）

### 1.1 文件清单 Scope Creep Guard

- **ALLOW LIST 抽取**（设计 §7）：生产 11 文件 + 测试 14 条目（12 迁移 + SA6 owned 2 +
  R2 追加 SA3-owned 2，其中 `registry-surface.test.ts` 为 ALLOW 成员但判定标准下无需改动）。
- **actual diff**（`git diff --name-only 7425164..HEAD`，packages 26 文件 + wiki 白名单 8 文件）：
  生产 11 文件全部 ⊆ ALLOW ✓；测试 13 文件 ⊆ ALLOW（`registry-surface.test.ts` 零改动——
  该文件无显式定型 fake 需补，全绿证实，非偏离）；SA6 两文件经 SA6 自身 R1 修订（见下）。
- **超出 ALLOW 的文件恰 2 个**：
  - `packages/namespace-registry/package.json`（`"version": "0.1.4" → "0.1.5"`，diff 仅 1 行）
  - `packages/namespace-runtime/package.json`（`"version": "0.1.7" → "0.1.8"`，diff 仅 1 行）
  判定 **LOW（非 creep）**：仓库既定惯例（#143 即 7425164 同型 bump 0.1.3→0.1.4；6472485/
  5db6f83 均随包变更 bump）；零依赖/exports/脚本变化。处置沿 #131 SA4 L1 先例：**要求 SA1
  在 design ALLOW LIST 补注该惯例条目，不要求回滚、不阻塞**。
- **BLACKLIST**：无 package-lock.json / yarn.lock / TASK.md / *.bak / .DS_Store 命中 ✓。
- **DENY LIST**：`packages/persistence/**`、`doc-runtime/**`、`vfsl*`、`namespace-runtime/src/
  internal.ts`（2 参工厂零改动 ✓）、`sequencer.ts`、`close.ts`、`projection.ts`、`plain-data.ts`、
  registry 侧 `testing.ts/plugin.ts/observer.ts/identity.ts/create-document.ts/errors.ts`、
  `clock/**`、`dsh-persistence/**`、`apps/**`、`docs/**`、`CONTEXT.md`——**全部零命中** ✓
  （`git diff --name-only` 显式核对）。
- **SA6 owned 文件监护**：`ec83429`（SA6 自身 commit）对 red/surface 两文件的修订逐行核验：
  (a) surface.test-d.ts 修复 `LeaseStatusCheck` 分布式联合恒 never 的结构性缺陷（改为先提取
  active 分支投影再单层判别——锚定语义不变，非弱化）；(b) red.test.ts FilePersistence 用例
  按 issue #108 正式模式（只读 import `waitDurableSnapshot`）修复 flush writeFile→rename 与
  dispose abort 的 harness 竞态——断言强度保持（磁盘 committed 事实先成立再重启断言）。
  修订均记录于 sa6_red.md R1，无 SA3 越权改锚迹象。

### 1.2 设计偏离审查（D-1..D-12 逐项对位）

| 设计决策 | 实现锚点（实测） | 判定 |
|---|---|---|
| D-1 随机源 Registry 层抽取 + 值输入 | registry.ts `drawReplicationId()`（包内私有、永不 throw、无重试环、结构守卫 pattern）；Lease 接纳段同步抽取；`/internal` 工厂零改动 | ✅ |
| D-2 复制写槽共享唯一 sequencer，E1–E7 镜像 ROOT 槽 | replication-write.ts:160-275（enable）/281-359（bump）；runtime.ts:311/318 与 mutateRoot:291/replaceSchema:301/close barrier:329 同一 `sequencer.enqueue` | ✅ |
| D-3 has() 判别损坏判据（SA2 #1） | replication-write.ts:124-141：两键真缺席→disabled；恰一键→corrupt；**键存在而值 undefined→corrupt**；格式违约→corrupt；载体异型→corrupt（getMap try/catch 收编） | ✅ |
| D-4 status 第八键 + V2.5 预投影 | status.ts `replication` 域 + `Object.freeze({...state.replication})` 每调用全新；runtime.ts:203-216 V2.5 位于 V2 状态门（:189）之后、V3 之前 | ✅ |
| D-5 幂等 enable = `{ok:true}` 零写零通知 | replication-write.ts:227-232 | ✅ |
| D-6 overflow 结果面拒升，判据先于 +1 | replication-write.ts:321-325（`>= MAX` 检查在 `nextEpoch = facts.replicationEpoch + 1`（:329）之前） | ✅ |
| D-7 Lease 两方法 + 第 4 参 deps.drawReplicationId | lease.ts:151-165（released→RELEASED_ISSUE；drawn.ok:false→结果联合）；registry.ts:706-708 接线（全仓唯一 caller） | ✅ |
| D-8 类型面 type-only 追加 | runtime index.ts 追加 5 类型导出（值导出面仍恰 `RuntimeWriteFatalError` 一键）；registry index.ts 追加 3 类型；lease.ts Equal 断言 ×2 | ✅ |
| D-9 WriteSlot 词表 + NSRT-FATAL-REPLICATION-WRITE-INTERNAL | write.ts:70 `'replication'`（缺省 'root' 渲染逐字节不变——rev1 子串锚测试全绿证实）；errors.ts 新 code/message；E5-throw→unknown-pipeline-throw committed:true；E6→notify-dirty-failed committed:true + E5.5 不回滚 | ✅ |
| D-10 zero-touch 结构性保证零新代码 | mutation 管线/persistence 零改动（DENY 核对）；red AC-4 用例实测 `['META','replicationEpoch']` 路径领域拒绝 | ✅ |
| D-11 键集锁迁移 | runtime-close-lifecycle（10→12 键、status 7→8 键）、internal-seam（12 键/8 键）、registry-open（lease 12 键 + fake 两方法）、idle/shutdown/sa7×3 定型 fake 补齐——全绿 | ✅ |
| D-12 零改动证明 | DENY LIST 全零命中（见 1.1） | ✅ |

### 1.3 E2E spec runner 触发性自检

**N/A**——本任务设计不含任何 `*.spec.ts`（新增/改动测试均为 vitest `*.test.ts` /
`*.test-d.ts`）。

### 1.4 vitest 触发性自检（硬门禁 #14）【本次触发】

本任务设计含新增 `*.test.ts` 文件（runtime-replication-write.test.ts、
registry-phase5-replication-channels.test.ts 新建 + 11 个既有文件改动）→ 门禁触发。

1. **抽 test 文件**：改动面 `*.test.ts` 集中在 `@nomicore/namespace-runtime` 与
   `@nomicore/namespace-registry` 两个 workspace package；`*.test-d.ts` 一个
   （registry 包）。
2. **抽 CI vitest 配置**（`.github/workflows/ci.yml`）：
   - `test` job（matrix node 20/24）第 39 行 `pnpm test` = 根 `package.json` scripts
     `"test": "vitest run --typecheck"`；
   - 根 `vitest.config.ts`：`include: ['packages/*/test/**/*.test.ts', ...]` +
     `typecheck.include: ['packages/*/test/**/*.test-d.ts', ...]`；
   - 另有三个显式单文件步骤（persistence-contract / domains-scaffold / materialize-root，
   均为**补充门禁**，不构成对 namespace 包的排除）。
3. **比对**：`packages/namespace-runtime/test/*.test.ts`、`packages/namespace-registry/
   test/*.test.ts`、`packages/namespace-registry/test/registry-phase5-replication-surface.test-d.ts`
   全部落入根 glob `packages/*/test/**`——**每个新测试文件均在 CI `Test` 步骤触发范围内**。
4. **动态复核**：本次独立进程跑 CI 同链 `pnpm test` → 125 files / 1474 tests 全绿
   （含全部 4 个复制相关测试文件被收集执行）。

**结论：`vitest-package-not-triggered` 不成立，本门禁 PASS。** SA7 动态阶段应从
`gh run view --log` 摘录 `Test` 步骤中 4 个复制测试文件的执行证据（见动态审核重点 #4）。

### 1.5 协议假设审查（任务简报点名复核项）

设计 §8 存在且声明「无协议级假设」。**定性复核成立**：本票纯进程内库层（TS 包间函数调用、
Yjs 内存事务、Promise 微任务次序），无 HTTP/WS 端点、端口、跨进程资源或第三方工具假设。
§8 列出的 4 条次序性论断逐条复验：

| 论断 | 复验证据 | 结果 |
|---|---|---|
| 同一 sequencer FIFO：接纳序=完成序=通知序 | sequencer.ts:38-42（promise-chain 尾接尾 + `settled.then(noop, noop)` 链尾恒绿）实读 | ✅ |
| enable 已接纳后 close 不取消 | runtime.ts:329 close barrier 与 :311/:318 复制槽共用同一 sequencer 实例（队尾排队→已接纳任务无条件排空）；red AC-6 close 竞态用例实测通过 | ✅ |
| `Promise.all` 三调用同步依次接纳 | lease.ts enable/bump 方法体无前置 await（released 检查 + 同步 draw + 直接委托）；runtime.ts:287-291「同步接纳定序」既有注释同款 | ✅ |
| `doc.transact` 同步执行后事务方结束 | yjs 13.6.32；red AC-2 用例以 stub saveDoc 通知时刻快照实测「通知时刻 META 已含两字段」 | ✅ |

附带实证（本次重跑 SA2 R1 实验，node 24 + yjs 13.6.32）：
- `getMap('META')` 于同名 Y.Text 载体 → **throw** `Type with the name META has already been
  defined with a different constructor`——设计「载体异型→corrupt」的事实前提成立；
- `meta.set(k, undefined)` → `has()===true && get()===undefined`，且经
  `Y.encodeStateAsUpdate→applyUpdate` **round-trip 存活**——SA2 #1 的损坏家族判据前提成立。

**结论：`unverified-protocol-assumption` / `protocol-assumption-mismatch` 不成立，本门禁 PASS。**

### 1.6 契约改动连锁审查（Caller Audit）

diff 全量扫描结论：**无既有公共导出函数的 throw/return 契约翻转**（无 `return false→throw`
类改动；`markWriteFatal`/`writeFatalMessage` 扩 slot 分支，缺省 `'root'` 渲染逐字节不变）。
唯一签名扩展为**包内函数**：

| 函数 | 改动 | Caller | 三栏判定 |
|---|---|---|---|
| `createLeaseController`（lease.ts，包内） | 3 参→4 参（+`deps.drawReplicationId` 必选；`onReleased` 由可选改显式 union） | 恰一个：registry.ts:706（同 commit 扩参；`git grep createLeaseController` 全仓唯一） | 同步构造无 await 面；throw 仅构造期由 registry factory try/catch 收编为 `runtime-construction` fatal（既有通道）；无 process.exit catch-all |

接口加法扩波（§9 表格）逐项核对：`NamespaceRuntime` 唯一生产 implementor = runtime.ts
对象字面量（本 PR 实现）；`NamespaceRuntimeStatus` 唯一生产构造点 = buildStatus；Lease
唯一构造点 = lease.ts；测试 fake 迁移全绿。**PASS**。

### 1.7 测试质量审查：源码 GREP 断言禁令

对 diff 全部 13 个测试文件扫描 `readFileSync + toMatch/toContain` 反模式：
- 唯一机械命中 `runtime-registry-internal-seam.test.ts`：其 `readFileSync` 读的是
  **package.json**（既有 exports 映射审计，非 .ts 源码字符串断言），`toContain` 作用于
  运行时结果 JSON——且**均非本次 diff 引入**（diff 零触碰该两行）。
- 4 个新增测试文件（red / surface / channels / runtime-replication-write）**零源码 grep
  断言**（通读核验：全部断言驱动真实 Runtime/Yjs/Persistence 行为或类型面）。

**结论：`source-grep-assertion` 不成立，本门禁 PASS。**

---

## 二、验尸清单逐项结论

1. **设计一致性**：✅ 一致。D-1..D-12 全部按 R2 设计落地；§4.10.1 六通道场景全部核销
   （见下表）；E3 单读捕获、has() 判别、overflow 先判后加、幂等零通知等 R2 修订要点逐条在码。

   | §4.10.1 场景 | 落位（实测） | 判定 |
   |---|---|---|
   | REPLICATION_NOT_ENABLED | channels（Lease 集成：含码+两键仍缺席+saveDoc 0 次）+ runtime 侧 | ✅ |
   | REPLICATION_META_ABSENT | channels + runtime（`withMeta:false` 种子；`doc.share.has('META')` 仍 false） | ✅ |
   | REPLICATION_RANDOM_SOURCE_INVALID | channels 两型（非 16 字节 / throw）：ok:false 含码、不 fatal、不同步 throw | ✅ |
   | REPLICATION_INPUT_INVALID (a) Proxy 双读分叉 | runtime 侧：`reads===1` 断言 + META ≠ 'ZZZ'（单读捕获闭合实证） | ✅ |
   | REPLICATION_INPUT_INVALID (b) trap throw | runtime 侧 (b)/(b2)/(c)：ok:false 含码 + `.then(null)` 断言无 raw rejection | ✅ |
   | 损坏 META 构造 throw（V2.5） | channels 种子族 7 用例 + 反向守卫（真缺席 open 成功）+ 双读者一致性 | ✅（带 L2 注记） |
   | 槽内 E4 corrupt fatal | runtime 侧：write-slot-internal + committed:false + status.fatal 置位 + 后续写禁 | ✅ |

2. **读写路径一致性**：✅ 一致。写端 = 复制槽 E5 单事务（唯一 Y.Doc 写入口）+ E5.5 同步
   整替 `state.replication`（零 await 间隔）；读端 = `getStatus().replication`（state）与
   `getMetadata()`（live META，projection.ts 未动自动投影新键）同源对齐；新 open 经 V2.5
   从 live META 预投影。唯一陈旧窗口 = E5 throw 跳过 E5.5（INV-R5 已登记例外，生产不可达、
   fatal 后无放大面）——非分叉。
3. **静默失败**：✅ 无。enable/bump 全部路径终局 = `{ok:true}` / `{ok:false,issues}`（含稳定码
   进 message）/ `RuntimeWriteFatalError` rejection / released issue——四通道均有可观察结算；
   lease 层随机源违约经结果联合（不 throw、不伪装成功）。
4. **降级方案**：✅ 安全（无新增降级路径）。反向立法落实：损坏 META 三族（恰一键/undefined
   值/格式违约/载体异型）一律 loud（构造 throw / 槽内 fatal），`disabled` 仅限两键真缺席或
   载体缺席（事实性真命题，META 缺席的 loud 面在 getMetadata NSRT-META-E2 保留）。
5. **极端攻击**：✅ 未发现可静态确认的漏洞。攻击面与防御实证：
   - 敌意 Proxy 双读分叉 → E3 单读捕获（测试断言恰 1 次属性读，'ZZZ' 无法入 META）；
   - ownKeys/getter trap throw → 全探测 try/catch 收编为 INPUT_INVALID（绝不成 fatal——防
     敌意 value→永久禁写 DoS）；
   - null/undefined/primitive/多键/大写 hex/非 string → 收编拒绝（测试 8 型实测）；
   - overflow 判据 `>= MAX` 先于任何 +1，MAX+1 永不被计算；
   - 敌意 randomBytes（Proxy 返回超域值）→ hex 编码长度破坏 pattern → 结构性 {ok:false}；
   - 载体异型 → getMap throw 收编为 corrupt（Yjs 行为本报告实证）。
6. **错误处理**：✅ 完整。§4.8 稳定文案注册表全部落地于 errors.ts/types.ts 且被消费
   （NSRT-FATAL-REPLICATION-WRITE-INTERNAL / NSRT-REPLICATION-META-CORRUPT /
   REPLICATION_EPOCH_OVERFLOW / REPLICATION_NOT_ENABLED / REPLICATION_INPUT_INVALID /
   REPLICATION_META_ABSENT / REPLICATION_RANDOM_SOURCE_INVALID；RUNTIME_WRITE_DISABLED 复用
   零新码）；message 零值回显、零原始异常插值（describeOf 只含 typeof）。
7. **架构评估**：✅ 可行。加法扩展沿既有写管线纪律，零绕过、零 FIXME、零新数据流方向；
   无退回 SA1 信号。
8. **过度设计**：✅ 精简。replication-write.ts 360 行（设计预算 ~260，注释占比高）；无
   「为将来预留」的抽象；registry/runtime 双份 `REPLICATION_ID_PATTERN` 有结构性论证
   （跨包值导出会击穿恰一键冻结审计，两副本互为守卫、注释互引）。

---

## 三、发现清单（全部非阻断）

| # | 级别 | 事项 | 处置建议 |
|---|---|---|---|
| L1 | LOW（scope 注记） | 两个 package.json 版本 bump（0.1.4→0.1.5 / 0.1.7→0.1.8）不在设计 §7 ALLOW LIST——各 1 行、零依赖/exports 变化，仓库惯例（7425164/6472485/5db6f83 同型先例） | SA1 在 design ALLOW LIST 补一行惯例注记（沿 #131 SA4 L1 先例）；无需回滚、不阻塞 |
| L2 | INFO（测试精度注记） | channels.test.ts 损坏族用例标签「仅 id 无 epoch（恰一键存在）」实际种子形态为 id 合法 + epoch `set(undefined)`（即「键存在而值 undefined」分支）；真·恰一键缺席分支由 runtime-replication-write.test.ts:220 覆盖（E4 corrupt fatal 用例仅 set replicationId）。契约矩阵整体无缺口，仅标签措辞与种子形态不一致 | 后续修订轮把该用例标签改为「id 合法 + epoch undefined 值」，或改用 hasOwnProperty 条件种子真·单键；不影响本票验收 |
| L3 | INFO | `registry-surface.test.ts` 在 ALLOW LIST 但零改动——判定标准「显式定型必补」下该文件无 `NamespaceRuntime`/`NamespaceRuntimeStatus` 定型字面量需补（全绿 + declaration 审计零误伤证实） | 无需动作（ALLOW 是上界非下量） |
| L4 | INFO→SA7 | 载体异型（META 同名为 Y.Text）分支无专门测试用例——代码有 try/catch 收编且本报告实证 yjs 13.6.32 getMap 确实 throw；生产不可达（create/loadDoc 管线不可能产生异型载体） | SA7 可选：种子异型载体 → open rejection 断言（锦上添花） |

---

## 四、动态审核重点（交 SA7）

SA7 在 `wiki/raw/task_phase5-replication-identity-epoch_sa7_report.md` 中逐条回复：

1. **FilePersistence 全链耐久时序**：red AC-6 File 用例含真实 fs `writeFile→rename` +
   `waitDurableSnapshot` 有界轮询（issue #108 模式）——本地绿，但 CI runner 磁盘时序更慢，
   需从 CI 日志确认无超时 flake（建议连续 3 次 CI run 观察）。
2. **真实调度交错**：本票并发用例基于微任务确定性栅栏（`Promise.all` + 受控 scheduler）；
   SA7 可补真实 timer 下的 enable-已接纳-后-shutdown 排空观测（registry.shutdown 驱动）。
3. **undefined 值经 FilePersistence 磁盘格式 round-trip**：SA2/本报告实证了
   `encodeStateAsUpdate→applyUpdate` 内存链；FilePersistence 磁盘快照同一编码面
   （lifecycle.ts 全量 snapshot），可选做磁盘级双键 undefined 种子 → open rejection 复核。
4. **vitest 触发证据**：从 `gh run view --log` 摘录 `Test` 步骤中
   `registry-phase5-replication-red` / `registry-phase5-replication-channels` /
   `runtime-replication-write` / `registry-phase5-replication-surface` 四文件被执行的
   日志行（§1.4 静态结论的动态确认）。
5. **载体异型分支**（可选，对应 L4）。

---

## 五、测试验证证据（独立进程，全部 exit 0）

1. `pnpm vitest run --typecheck packages/namespace-registry/test packages/namespace-runtime/test`
   → **46 files / 383 tests 全绿；Type Errors: no errors**。
2. CI 同链 `pnpm test`（全仓）→ **125 files / 1474 tests 全绿；Type Errors: no errors**；
   `pnpm typecheck`（9 包 tsc）→ exit 0。
3. 定点四文件（red / surface.test-d / channels / runtime-replication-write）→
   **14 + 6 + 14 + 9 全绿**；red 文件复跑一次再绿（flake 检查，累计本地 3 次）。
4. 键集锁实测翻绿：runtime 十二键、status 八键、lease 十二键 + asyncDispose；
   exports-audit 禁止清单追加 3 个复制槽体名（设计 §4.10 可选加固已落实）。

---

## 六、结论

SA3 实现与 SA1 R2 设计逐决策一致（D-1..D-12 + §4.10.1 六通道全核销）；SA2 R1 三必修
（#1 has() 判别、#2 单读捕获、#3 本地常量）在实现层真实落地；SA6 红灯 14+4+2 全部转绿且
锚文件修订（ec83429）经逐行核验为合法 harness 缺陷修复、无断言弱化；既有 125 文件套件
零回归；全部硬门禁（scope / vitest 触发性 / 协议假设 / 契约连锁 / 源码 grep 禁令）通过；
发现项均为 LOW/INFO 级文档性与标签精度注记，无可驳回缺陷。

**Verdict: pass** —— 可进入 SA7 动态验证（重点见 §四）。
