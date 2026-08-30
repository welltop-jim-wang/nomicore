# SA3 实现报告 — Issue #151: Record trusted replication and management writes

> 阶段：Phase 3 implementation（SA1 设计 R1 终稿 + SA2 R2 **pass** + SA8 设计复审 **clear** + SA6 15 用例契约已按 R-3.2 完成勘误）。
> 输入：`wiki/raw/task_trusted-replication-management-diagnostic-change-log_design.md`（659 行）、SA6 红灯契约（15 用例，`runtime-replication-diagnostic-red.test.ts` 914 行）、主线 `b66615c` 形状锚。
> 基线：`722bddf`（branch `fix/issue-151-on-docs-namespace-diagnostic-change-log`）。
> 角色声明：SA3 只写实现与必需的测试改面；未修改 SA6 红灯测试的断言逻辑；未 push。

---

## 1. 变更摘要

### 新建（物化层，设计 §0.2/R-2）

| 文件 | 说明 |
|---|---|
| `packages/namespace-runtime/src/replication-write.ts`（512 行） | enable/bump 两写槽 E1–E7（主线 `b66615c` 逐字端口）：共享 gate（含 diag 行）、`readReplicationFacts` 四出口读取器、E3 单读捕获 + 全探测收编、E5 单事务 + **D-6 捕获窗口**、E5.5 事实整替、bump E5.5' 经 `sessions.fenceStale` 主动 fence（enable 不 fence——主线显式裁决）、E6 notifier、全部结局点 diag 写入（§9.1/§9.2 映射表） |
| `packages/namespace-runtime/src/replication-session.ts`（720 行） | 最小会话核心（主线 889 行最小闭包）：`RuntimeReplicationHost`/WeakMap 登记、`SessionRegistry`（attach/detach/fenceStale/terminateAll——替代主线 fanout）、open 门序（host→lifecycle→fatal→facts disabled）、`createSessionCore` 冻结四域 + applyRemoteUpdate/getStatus/close 三能力、apply 槽 R1–R7（R2 被动 fence、R3 degraded bypass 五条件、R4 scratch 预演 `protectedContentEvaluated` 全套、R5 `Y.applyUpdate` + beforeTransaction 二分探针 + 捕获窗口、R5.5 标记、**R-3.1**：捕获窗口零字节 ⇒ 跳过 R6）、A 层同步拒绝发射（acceptance/identity/validation + 受控 source/context）、槽后 `settled.then(emitSlot)`（amendment C）。**无** outbound 扇出/角色门/会话计数/wrapCore（§12-L1/L2/L3） |

### 修改（runtime 侧）

| 文件 | 说明 |
|---|---|
| `errors.ts` | +复制稳定码族：`FATAL_REPLICATION_WRITE_INTERNAL_*` / `FATAL_REPLICATION_APPLY_WRITE_INTERNAL_*`（常量名含 WRITE、**值**不含 WRITE——R-3.2 裁决值 `'NSRT-FATAL-REPLICATION-APPLY-INTERNAL'`）/ `REPLICATION_META_CORRUPT_CODE`+`ReplicationMetaCorruptError` / `REPLICATION_EPOCH_OVERFLOW|NOT_ENABLED|INPUT_INVALID|META_ABSENT` CODE+MESSAGE（CODE 常量沿 `RUNTIME_WRITE_DISABLED_CODE` 先例补充——诊断 emission 顶层 code 字段引用）/ `REPLICATION_SESSION_CLOSED|EPOCH_CONFLICTED|RAW_UPDATE_INVALID|PROTECTED_FIELDS_CHANGED|SESSION_UNSUPPORTED` CODE+MESSAGE / `ReplicationSessionClosedError`；全部主线原值原文案 |
| `write.ts` | `WriteSlot` 四值（+'replication'/'replication-apply'）；`markWriteFatal`/`writeFatalMessage` 两新分支（既有 'root'/'schema' 渲染逐字节不变——fatal-message-rev1 测试全绿）；`rejectWithWriteFatal` 签名不变 |
| `p0.ts` | `RuntimeState.replication?: NamespaceRuntimeReplicationStatus`（内部投影，不进 buildStatus——§12-L4） |
| `diagnostic.ts` | **四点向后兼容扩展**（§7/§17）：①`SlotEmissionArgs.source?`（缺省 `{kind:'local'}`）②`context?`（缺省省略）③`sourceModule?`（缺省 'runtime'，与 code 恒成对）④**【R1，SA2 #1】**`SlotEmissionArgs.input` 与 `SlotDiag.input` 可选化（`EmissionInput \| undefined`）+ `emitAttempt`/`emitSlot` **条件展开**（省略 → 不携带 `input: undefined` 值键 → record 面 `{capture:'none'}`——`projection/input.ts` 单点）；`SlotDiag` +source/context；`SlotOutcome` +sourceModule；`diagCapGate`/`diagFatalCapGate`/`diagFatalTx`/`diagDirtyFatal` +可选 sourceModule 参（缺省 'runtime'，既有调用零改动）；新增 `diagValidationCode(diag, code, issues, sourceModule?)`。ROOT/SCHEMA 既有发射字节面零变化（全量回归证明） |
| `runtime.ts` | 十键→**十二键**：`NamespaceRuntime` 接口 +两成员（主线签名逐字）；构造序 V2.5 复制事实预投影（损坏 → 构造 throw 零副作用）、state 初始化携带、V3c''''' `createSessionRegistry()` + `replicationWriteEnv` 一次成型、V3d'' `replicationHost` 一次成型（含 diagEnv/sessions）、两公共方法体（lifecycle 接纳门同步 emit + `settled.then(emitSlot)` 槽后挂点——enable E-a input not-accessed；bump B-a input 省略）、close() 同步段 `sessions.terminateAll('runtime-close')`（lifecycle 置位后、barrier 入队前——close.ts 零改动）、V3f `registerReplicationHost`（WeakMap，零属性污染） |
| `internal.ts` | 值导出恰两键（+`openReplicationSessionCoreForRegistry`）+ 会话类型 re-export（registry.ts 类型级锁消费；import 图审计谓词自动放行） |

### 修改（registry 侧）

| 文件 | 说明 |
|---|---|
| `types.ts` | +`REPLICATION_SESSION_INPUT_INVALID_MESSAGE` 冻结文案（主线逐字）；+公共类型族：`OpenReplicationSessionOptions` / `OpenReplicationSessionIssueCode`（本 worktree 可产出闭集五码——无角色门/会话计数门，R-3.3）/ `OpenReplicationSessionResult` / `ReplicationSessionApplyRefusalCode`+`ReplicationSessionApplyResult`（**六码闭集，主线逐字**——Equal 锁面要求）/ `ReplicationSessionStatus`（主线减扇出域）/ `ReplicationSession`（冻结四域+三能力恰七键）；`NamespaceLease` +`openReplicationSession` |
| `lease.ts` | `LeaseControllerDeps`（第 4 参必选）；`ReplicationSessionOpenCore`+`ReplicationSessionOpenCoreResult`（结构性描述面——本文件不 import internal，模块边界审计「仅 registry.ts 消费 internal」）；`INSTANCE_ID_PATTERN` 本地常量 + `parseOpenSessionOptions`（单读捕获 + 全探测收编）；`openReplicationSession` 方法（released 门 → 输入形状校验 → 委托 core，session 即冻结 core——无 wrapCore）；`_sessionOpenCoreAlias` Equal 自锁 |
| `registry.ts` | issueLease 处注入 `{ openReplicationSessionCore: openReplicationSessionCoreForRegistry }`；跨包 Equal 断言锁（`RuntimeReplicationSessionCore ≡ ReplicationSession`、`RuntimeReplicationSessionStatus ≡ ReplicationSessionStatus`） |
| `index.ts` | 主入口类型 re-export +7（新公共类型）——设计 §18 未列，属 §6.5「新增公共类型」的公共面收口（type-only，零运行时面变化） |

### 测试改面（公共面扩张的必然改面）

| 文件 | 说明 |
|---|---|
| `runtime-close-lifecycle.test.ts` | runtime 键集断言 10→12 键 |
| `runtime-registry-internal-seam.test.ts` | runtime 键集 10→12；internal 值导出键集 1→2 |
| `registry-open.test.ts` | lease 键集 10→11（+openReplicationSession） |
| `registry-idle/shutdown/sa7-hostile/sa7-rev1/sa7-concurrency.test.ts` + `registry-open.test.ts makeRuntime` | `implements NamespaceRuntime` 测试替身类/对象补齐 `enableReplication`/`bumpReplicationEpoch` **loud stub**（`{ok:false, issues:[REPLICATION_NOT_STUBBED]}`，绝不静默伪装 ok）——**设计 §15.2 清单遗漏项**（SA2 E-8 只审计了 `Object.keys` 断言，未覆盖接口实现替身；不变更替身将断 CI typecheck，登记见 §3-偏差 2） |

### 版本 bump

- `@nomicore/namespace-runtime` `0.1.8 → 0.1.9`
- `@nomicore/namespace-registry` `0.1.3 → 0.1.4`
- `pnpm install --frozen-lockfile` 预期零 lockfile 变化（workspace 包版本不入 lockfile——#149 B-2 复核面；已实测无 diff，见 §2）

---

## 2. 验证命令与结果

### 2.1 SA6 红灯契约（15 用例）

```bash
cd /home/wangjian/nomicore-fix-issue-151
pnpm exec vitest run packages/namespace-runtime/test/runtime-replication-diagnostic-red.test.ts
```

**结果：14/15 通过；1 处失败（bump 用例的重放锚，见 §3-偏差 1）；`Type Errors: no errors`。**

通过清单（14）：enable committed（AC1/AC2/AC3，含 META 两键 92B 增量链式重放 + 空 doc 不物化）；幂等重入 noop（AC3）；enable 输入格式拒绝（validation/REPLICATION_INPUT_INVALID）；apply hub-to-peer（精确 owned bytes + direction 字面量）；apply peer-to-hub（AC5 双向）；apply noop（committed+noop、saveCalls 不变——R-3.1）；fence 后 apply（identity/REPLICATION_EPOCH_CONFLICTED）；session closed（acceptance/REPLICATION_SESSION_CLOSED/`{capture:'not-accessed'}`）；raw update 损坏（validation/REPLICATION_RAW_UPDATE_INVALID）；notifier 失败（fatal committed:true + dirty-notification + `NSRT-FATAL-REPLICATION-APPLY-INTERNAL` + 精确 bytes）；getStatus 抛错（fatal committed:false + capability-gate + 同码）；emitter 违约 throw（enable+bump 业务不变，calls()===2）；队列满（capacity:1 → accepted=1/dropped=1，业务 FIFO 不变）；transport 隔离（open/status/close 零记录，emissions 恰 2）。

### 2.2 两包全量回归

```bash
pnpm exec vitest run packages/namespace-runtime packages/namespace-registry
```

**结果：358/359 通过（42 文件）；唯一失败 = 上文 2.1 的同一 bump 重放锚用例。** `Type Errors: no errors`。
覆盖：#149 ROOT/SCHEMA 诊断 14/14、16/16 SA7 动态、close/sequencer/schema/registry 全部既有冻结行为零回归（含 `runtime-write-fatal-message-rev1` 子串锚、registry-surface 声明图审计 12/12、internal import 审计）。

### 2.3 类型检查（CI 等价）

```bash
pnpm exec tsc -p tsconfig.typecheck.json --noEmit     # TSC_EXIT=0，0 errors（全仓 src+test）
pnpm exec tsc -p packages/namespace-runtime/tsconfig.json --noEmit   # 0 errors
pnpm exec tsc -p packages/namespace-registry/tsconfig.json --noEmit  # 0 errors
pnpm install --frozen-lockfile                                        # exit 0，lockfile 零 diff
```

---

## 3. 偏差登记（任何偏差）

### 偏差 1【必须登记，阻塞性契约缺陷——SA4 转绿验证前需 SA6 一行修订】

**现象**：红灯用例 4（`AC1/AC2/AC3 epoch bump committed`）唯一失败：

```
expect(fresh.getMap('META').get('replicationEpoch')).toBe(2)   // received: undefined
```

**根因（经 yjs 协议解码 + 设计证据双重确认，非实现缺陷）**：bump 槽 E5 的纯单键事务
（设计 §9.2 B-g「epoch+1 **精确单键增量**」+ §16 P1 实测 **27 字节**单事件）产出的增量
update 是对 enable 事务创建的结构（clock 9）的**替换项**（`Y.decodeUpdate` 实证：
`{id:{client,clock:10}, origin:{client,clock:9}, parent:null}`——parent/parentSub 需从被
替换项解析）。该替换项应用到**只含 baseState 的文档**（缺少 enable 创建的结构）时被
yjs 丢弃——这就是测试的 `applyCarrier(updateCarrierOf(rec.result), baseState)` 得
`undefined` 的原因。**测试的期望（增量在无 enable 前置的 baseState 上重放出双键）与
yjs 更新协议结构性不相容**；而设计本身在 §13.8 明确消费形态为「基态 → enable 增量 →
apply 增量」**链式重放**，且同一测试文件里 apply 用例 5/6/11 正是链式重放
（`prior: [enableCarrier]`）。

**验证**：以同文件 apply 用例的既有链式重放形态（`prior: [updateCarrierOf(recs[0])]`）
对 bump 用例做**临时副本探针**（未改动原文件），15/15 全绿：

```
✓ zz-probe-151.test.ts (15 tests) 733ms  →  15 passed
```

**建议修订（SA6 按注记 2 协议，红线不变——重放锚按设计 §13.8 链式形态对齐）**：
bump 用例 `applyCarrier` 增加 `prior: [enableCarrier]`（与 apply 用例同款）。**该一行修订后
生产代码零改动即 15/15**。SA3 未改此文件（`[SA6 owned]` + 设计明文「SA3 禁改断言逻辑」），
任何为满足该断言而改写 bump 事务（如重写 replicationId 键/删除重建）都违反设计 B-g
「精确单键增量」与 INV-R1「bump 只写 epoch」——属「为测试改业务语义」红线，SA3 拒绝。

### 偏差 2【已修订，登记】设计 §15.2 存量测试改面清单不完整

设计列了三处键集测试；实际还需 6 处 `implements NamespaceRuntime` 测试替身（
registry-idle / registry-shutdown / registry-sa7-hostile / registry-sa7-rev1 /
registry-sa7-concurrency / registry-open(makeRuntime 对象字面量)）补齐两个新方法。
SA2 E-8 断言「无遗漏」只覆盖 `Object.keys` 断言。处理：替身补 **loud stub**（结果面
`REPLICATION_NOT_STUBBED` 拒绝，绝不冒充 ok）。均为类型面收容，测试语义零变化。

### 偏差 3【登记】registry `index.ts` 增量（设计 §18 未列）

`index.ts` 增 7 个 type-only re-export（新公共类型必需经主入口可达才称「公开类型」，
对齐主线 b66615c registry index 的 re-export 面）。零运行时值变化（registry-surface
「恰九个 value」断言全绿）。

### 偏差 4【登记】SA6 修订后红灯契约与设计 §11「测试文件零改动即应 15/15 转绿」不符

设计 §11 的转绿声明以「两处 fatal 码字面量修订」为唯一前置；实测发现第三处前置
（偏差 1 的重放锚）——属设计/契约审计遗漏，非实现偏移。实现侧已按设计 §9 映射表
逐结局点落实，14/15 断言与设计逐条吻合。

---

## 4. commit

见 `git log -1`：`<hash>`（see §5）——中英双语，含实现 + 必要测试改面 + SA6 红灯契约文件 + wiki 归档；未 push。

## 5. 遗留风险（移交 SA4/SA7/总控）

1. **SA6 一行修订先于 SA4 转绿**（偏差 1；排程序同 R-3.2 前置先例）。
2. SA7 (a) 物化面对账：`git diff b66615c -- packages/namespace-runtime/src/replication-write.ts packages/namespace-runtime/src/replication-session.ts`——SA3 自检差异面全部落在 R-3.1（零字节跳过 R6）、R-3.3（方向无关通道，registry 侧）、§0.2 不物化清单（fanout/编码面/observerFailures/needsResync）、diag 接线行/捕获窗口/SessionRegistry 适配（豁免）内；无登记外差异。
3. SA7 (b) `updateCapture:false` 活链路（update-omitted 为存储面分支——producer 恒不产出，需 adapter 配置路径验证）。
4. 全仓并发运行的历史负载伪影（#149 REPORT 已登记 spawn/RPC 超时）与本次无关；局部复跑 358/359 已将其与 #151 分离。
