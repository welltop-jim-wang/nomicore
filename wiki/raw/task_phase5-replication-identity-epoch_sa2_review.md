# SA2 攻击评审报告 — Phase 5: enable replication identity and epoch management

**Date**: 2026-08-27（run_id: issue-132-1787809226-3529662，round 1）
**被审对象**: SA1 设计 R1：`wiki/raw/task_phase5-replication-identity-epoch_design.md`（701 行，通读）
**Verdict**: **reject**（3 项必修修订 + 2 项文档性修订；架构骨架本身成立，修订面窄且无架构返工——修订后可快速复审放行）

**攻击方法声明**：全新视角通读设计，并对设计声称的全部代码锚点（§3-1..§3-13）逐条回查源码
（`sequencer.ts`/`write.ts`/`schema-write.ts`/`runtime.ts`/`status.ts`/`p0.ts`/`internal.ts`/
`projection.ts`/`lease.ts`/`registry.ts`/`types.ts`/`index.ts` ×2/`mutation.ts`/`create-initial-document.ts`/
`replace.ts`/persistence `lifecycle.ts`），对 Yjs `Doc.share`/`Y.Map` undefined 语义做了**实证验证**（见 #1
证据），对红灯两测试文件逐行核对 D-1/D-2 的驱动面兼容性，对 §4.10 迁移清单与全仓
`NamespaceRuntime`/`NamespaceRuntimeStatus` 定型点、键集锁断言、导出面审计做了穷举核对。

---

## 一、总评

设计的**架构骨架是对的**，且对既有纪律的镜像质量高于历史均值：

- D-1（随机源 Registry 层抽取 + 值输入）是四个候选中唯一同时满足红灯契约（red.test.ts:484-489
  经 2 参 `runtimeFactory` + Lease 驱动 enable 成功——已核实该用例确实不直接调 Runtime 方法）、
  ADR 0009 修订节 3（禁全局 fallback）与 `/internal` 2 参签名冻结的方案。§4.1 候选表的排除论证成立。
- E1–E7 槽序对 S1–S7 逐位镜像（含 E5.5 照抄 SCHEMA 槽 S5.5 installActive 时序——schema-write.ts:177-180
  已核实先例存在）；fatal 机械（markWriteFatal 同步先行 / committed 事实 / best-effort notifier）全部
  复用既有单点。
- overflow 走结果面（SA8 专项确认）与 SA6 锚点零回流；幂等 enable 取 AC-3 二选一之幂等路径，
  零写入零通知与 ADR 0006「每次变更后」条件性义务一致。
- D-10 zero-touch 的结构性论证属实：`applyValidatedMutation` 读写面钉死 `doc.getMap('ROOT')` 全量重建
  （mutation.ts:49-75 已核实），`replaceSchemaAndRoot` 注释明文「SCHEMA/META 零接触」。
- §4.10 迁移清单与全仓穷举结果一致（typed fake 恰 7 文件 + 2 个 SA6 owned；loose fake（`any` 返回 /
  `as never` cast / `unknown` 返回经 testing.ts `=> any` 门）确实零改动——已逐一验证逃逸路径成立）。
- V2.5 纯读预投影的时序论证成立：`doc.share` 在本仓 yjs 13.6.32 类型为
  `Map<string, AbstractType>`（Doc.d.ts:44，与 projection.ts 既有守卫同源），`share.has` 守卫 +
  缺席早退不触发 `getMap` 惰性建图。

但设计在**三个具体点上没有兑现它自己立下的法**：#1 违反自身「拒绝虚假降级」立法与 §6 纵深防御
声明；#2 违反 INV-R9/INV-R7 的槽体输入纪律（对标既有 copyFrozen 四查立法的回潮）；#3 是一处跨包
规格自相矛盾、且错误解法会击穿一条冻结的导出面审计。三条都是窄修订，不触碰分层、槽序、通道归属
与文件清单结构。

---

## 二、攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞（触发条件 → 影响） | 修订要求 |
|---|--------|--------|------------------------------|----------|
| 1 | **HIGH** | D-3/§4.3 损坏判据：显式 `undefined` 值的保留键被判 `disabled` | 触发：META 中 `replicationId`/`replicationEpoch` 两键**存在但值为显式 undefined**（Yjs `meta.set(k, undefined)` 后 `has()===true && get()===undefined`——已实证，且该状态**经 `Y.encodeStateAsUpdate`/`applyUpdate` round-trip 持久化存活**，实测 keys 保留）。设计 §4.3 判据 `id === undefined && epoch === undefined → disabled` 把这种文档判为「未启用」。影响：(a) 与设计自己的立法自相矛盾——§4.3 自检称「两键要么都不在、要么都在且合法应恒真」，但**键存在而值 undefined** 正是「部分存在/格式违约」家族的成员（唯一合法写入面 E5 永不写 undefined），按设计自己的 unreachable-即-corrupt 逻辑应 loud；(b) §6 末行「INV-R9 的读取器损坏判据使任何绕道写入在下次 open 即响亮失败」对双键 undefined **不成立**：open 正常、status=disabled，随后 enable **静默安装全新谱系并把 epoch 重置为 1**——「replicationId 是不可变复制谱系身份」（ADR 0010）被无声击穿，下游只能靠 wire 身份核对事后发现；(c) 双读者分歧：同一文档上 `getMetadata()` 对 undefined 值 loud throw NSRT-META-E1（projection.ts:182-183 已核实），而 status.replication 说 `disabled`——两个只读面对同一持久事实给出相反判断。所引「projection.ts:32 冻结语义」类比对 META 面不成立：那是 SCHEMA 四键**投影输出**的省略语义，projectMetadata 对 undefined **值**是 loud。 | `readReplicationFacts` 以 `meta.has(k)` 判「键存在」：键存在且 `get(k)===undefined` → `ReplicationMetaCorruptError`（与「恰一键存在」「格式违约」同族同通道：构造 throw / 槽内 internal fatal）。`disabled` 仅保留给**两键真缺席**。同步删除 §4.3 中「键缺席与显式 undefined 同判（projection.ts:32）」的类推并说明理由（SCHEMA 面的宽容有 compile ENV-2 下游兜底且无状态变迁后果；复制面的宽容直接导向静默换谱系）。 |
| 2 | **MEDIUM** | §4.2 E3/E5 槽体输入纪律：双读 TOCTOU + 探测非异常安全 | 触发：经 `/internal` 构造的 Runtime 上以敌意对象调用 `enableReplication(input)`（Proxy/getter；公共 Lease 面不可达——registry 自造 plain literal——故非生产漏洞，但 INV-R9 声称的是**结构性**保证）。两个具体缺口：(a) **双读分叉**：E3 校验 `input.replicationId`（第 1 次读，过 `/^[0-9a-f]{32}$/`），E5 `meta.set('replicationId', input.replicationId)`（第 2 次读）。Proxy get trap 两次返回不同值（首读合法 32-hex、次读 `'ZZZ'`）→ **非法值穿越格式门直入 META**，INV-R9「三重守卫」的第二重（槽 E3 格式门）对敌意输入实际不闭合。(b) **裸异常逃逸**：E3 的 `Object.keys(input)`/own-键集/属性读取在敌意 trap 上 throw → async 槽体把原始 TypeError 直接 reject 给调用方——既非结果联合亦非 `RuntimeWriteFatalError`，击穿 INV-R7「二通道」纪律。对照：mutateRoot/schema-write 的 S3 用 `snapshotMutation`（内部全 try/catch，敌意面 → 类 B issue——write.ts:248-257 立法注释「防一次敌意 value → 永久禁写 DoS」）。设计 §4.2 以「string 为不可变标量，无快照语义，copyFrozen 不适用」为由跳过快照——该理由把快照器的**深结构复制**职责与**敌意陷阱中和 + 单读捕获**职责混为一谈，后者对任何调用方持有的输入（含单字符串信封）都适用。 | E3 改为**单读捕获**：`const replicationId = input.replicationId`（恰一次属性读），校验该捕获值，E5 消费同一捕获常量；E3 全部探测（typeof/键集/属性读/正则）包进 try/catch，任何 throw → `{ok:false, issues:[REPLICATION_INPUT_INVALID]}`（绝不裸 reject、绝不升格 fatal）。在 §4.2 显式记录「单读捕获 = 快照纪律在不可变标量载荷上的最小实现」以锚定与 S3 的等价性。 |
| 3 | **MEDIUM** | §4.1.2 ↔ §4.6 跨包常量自相矛盾（含一条会击穿冻结审计的错误解法分支） | 触发：§4.1.2 的 `drawReplicationId()` 伪代码（registry.ts 内）引用 `REPLICATION_ID_PATTERN.test(hex)`，而 §4.6 明文该常量是 namespace-runtime `replication-write.ts` **模块级**导出、「index 仅 re-export 五个类型」且运行时值导出面冻结为恰 `RuntimeWriteFatalError` 一键。registry 是**另一个包**，无法 import 对方非 index 模块。若 SA3 采取「从 runtime index 导出该 RegExp 值」的解法 → `runtime-acceptance-exports-audit.test.ts:29`（`Object.keys(publicEntry)` 恰 `['RuntimeWriteFatalError']`，已核实）立即红——一条冻结审计被击穿；若 SA3 静默在 registry 复制正则而设计不改文，则 §4.6 的「单点」表述失真。 | 设计显式规定：registry.ts 本地定义 `const REPLICATION_ID_PATTERN = /^[0-9a-f]{32}$/`（沿 `NAMESPACE_ID_PATTERN` registry.ts:142 本地常量先例——已核实该先例存在），注明与 runtime 侧常量互为结构守卫副本、注释互相引用；§4.6 同步澄清 runtime 侧常量不跨包。 |
| 4 | LOW | INV-R5 陈述过强：E5 transaction-throw 路径存在未声明的例外窗口 | 触发：E5 `doc.transact` 中途 throw（保守 `committed:true` fatal）。Yjs 事务不回滚，META 可能已前进而 E5.5 被跳过 → `status.replication` 陈旧、`getMetadata()`（读 live doc）较新——INV-R5「status.replication ≡ 最后已提交的 META 复制事实」在该路径不成立。生产不可达（E5 只写已验证的 string/number，两键同事务无现实 throw 面），且与 SCHEMA 槽 S5.5 先例同构（installActive 跳过 → getActiveSchema 陈旧 vs getSchemaEnvelope 新）。但 INV-R5 声称的是无条件等价。 | 二选一：(a) 在 INV-R5/§4.2 显式登记例外（「E5 unknown-pipeline-throw 保守 committed:true 时 state.replication 不重读，与 SCHEMA S5.5 先例一致」）；(b) fatal 路径 best-effort 重读一次 facts 收敛状态。取 (a) 即可（零代码）。 |
| 5 | LOW | 测试面：设计新文档化的拒绝/损坏通道零新增测试锚 | §7 ALLOW LIST 测试文件全部是键集锁迁移 + 可选加固；设计新引入的稳定通道——`REPLICATION_NOT_ENABLED`（红灯套件的 bump 全部发生在 enable 之后，未覆盖）、`REPLICATION_META_ABSENT`、`REPLICATION_RANDOM_SOURCE_INVALID`、`REPLICATION_INPUT_INVALID`、损坏 META 构造 throw（V2.5）、槽内 E4 corrupt fatal——**没有任何用例锚定**。SA6 套件按 AC 锚定是合理边界，但设计既已把这些行为写进 §4.8 稳定文案表，就应给出验证面，否则 SA4 对这些条款只能静态审。 | §4.10 增补一行：SA3 实现时为上述通道各补至少一条单元/集成红灯（详见「红线测试思路」#5 的场景清单）；或显式声明哪些通道接受「仅文档化 + SA4 静态审」并给理由。 |
| 6 | INFO | 规格精度两处 | (a) `ReplicationIdDraw` 类型在 §4.1.2 落位于 registry.ts，但 §4.5 lease.ts 的第 4 参签名引用它——registry.ts import lease.js，类型反向引用构成包内循环（type-only 可编译但不洁）；(b) §4.2 E4 的 `REPLICATION_META_ABSENT` 分支需要「META 载体在场」信息，而 `readReplicationFacts` 按签名只返回两态 status——槽体还需二次 `doc.share.has('META')`。 | (a) `ReplicationIdDraw` 放 types.ts 或 lease.ts 内联；(b) 在 §4.2/§4.3 之一明示载体在场信号的获取点（读取器返回富事实或槽内二次 share.has——同步域内二次纯读无害）。 |
| 7 | INFO | 持久化损坏的通道不对称（记录，不要求改） | META.replication 字段损坏 → open 以 `NamespaceRegistryFatalError('open','runtime-construction')` **rejection** 终局；而 META.docId 损坏在 loadDoc 层 → `NAMESPACE_LOAD_FAILED` 结果 **issue**。两类「持久化损坏」走不同通道。判读：可接受——检测层不同（persistence 校验 vs Runtime 构造门）、两者均 loud 且均已文档化（§4.3 表格）；但运维诊断面会看到两种形状。 | 建议仅在 §4.3 表格补一句对照说明，引导诊断者两个通道都查。不改判。 |

### 已攻击且确认无懈的面（负结果清单，供 SA4/SA7 复用）

- **并发/FIFO**：Lease 同步接纳定序 + 同一 `WriteSequencer` 实例（sequencer.ts:38 promise-chain）→
  `[enable,bump,bump]` 通知序 `[1,2,3]`、每提交槽恰一次 notifyDirty、幂等 enable 零通知——与红灯
  AC-2/AC-3 断言逐条对位成立；`Promise.all` 对数组字面量逐项同步求值，抽取零 await 不改时序。
- **close/fatal 竞态**：enable 已接纳 → close barrier 经同 sequencer 队尾 → 无条件排空（ADR 0008 +
  runtime.ts:253-264 barrier 机制已核实）→ flush → 重启恢复链成立。
- **degraded**：E2 瞬时观察 → gate 后降级保留事务、saveDoc 照常登记（ADR 0006 #79 机械）→ 恢复 retry
  覆盖 → bump 复通——与红灯 AC-6 对位成立。
- **溢出**：判据 `epoch >= MAX` 先于任何 `+1`，MAX+1 永不被计算/存储；MAX-1 → MAX → 拒——无回绕面。
- **持久化 round-trip**：persistence 以 `Y.encodeStateAsUpdate(doc)` 全量编码（lifecycle.ts:238/554），
  META 新键为 plain JSON 值随快照往返——DENY LIST「Persistence 零改动」的前提成立。
- **导出面**：registry 主入口运行时九值、runtime 值导出恰一键、声明图禁词（新类型名均不含
  `\bNamespaceRuntime\b` 整词）、`MutateRootResult` 类型导入先例（types.ts:35-41 已核实）——D-8 的
  兼容性论证全部成立（除 #3 的常量矛盾外）。
- **类型锚**：`HasEnableReplication`/`HasBumpReplicationEpoch`（ Lease 零参方法 + 联合各成员协变携带
  `ok:boolean`，`RELEASED_ISSUE {ok:false;code;message}` 亦满足）、`HasReplicationStatus`（恰两态、
  必选键）、`LeaseStatusCheck`（projection 同步扩域 + Equal 断言双侧同文本）——四红锚可转绿，
  两保持性守卫保持绿。
- **V2.5 时序**：构造栈纯读（`share.has` 守卫防惰性建图；`getMap` 异型 throw 被 catch 收编）→
  INV-N4 零副作用成立；预启用种子文档 open 即 enabled（红灯 overflow 用例依赖）成立。
- **§4.9-1（不强制 id ≠ namespaceId）**：同意 SA8 注记 5 的裁量保留——强制拒绝会把无害巧合升格为
  open 失败，wire 身份核对同时携带两者；红灯 `not.toBe` 断言由生成面（无 `ns-` 前缀 + CSPRNG）满足。
  不列为漏洞。

---

## 三、协议假设依据审查（2026-06-13 立法）

- **章节存在性**：§8 存在，且声明「无协议级假设」的定性正确——本票纯进程内库层，无 HTTP/WS
  端点、端口、进程时序或第三方工具假设。
- **依据可验证性**：四条次序性论断全部给了源码/测试锚，本次评审**逐条复核均命中**：
  `sequencer.ts:38-42`（promise-chain 尾接尾）✓；`runtime.ts:253-264`（close barrier 经同 sequencer
  队尾）✓；Lease 方法体无前置 await（§4.5 伪代码 + ECMAScript `Promise.all` 同步求值）✓；
  `doc.transact` 同步执行后事务方结束 + write.ts S5→S6 槽序先例（red.test.ts:180-188 stub 通知时刻
  快照）✓。
- **无据推断**：未发现「应该/通常/预计」类措辞承载判据；无「实测验证」却缺命令的条目（设计未
  声称新实测，全部引既有源码——合规）。
- **结论**：本节通过。SA4 静态门禁可直接复用上述锚点。

## 四、错误处理链路审查（2026-05-07 立法）

- **静默失败**：无——全部拒绝路径经返回 Promise 结算（结果联合 issue / `RuntimeWriteFatalError`
  rejection / `RELEASED_ISSUE`），稳定码进 message、零值回显。唯一例外是 #2(b) 的敌意输入裸 throw
  逃逸（已列攻击点，要求收编）。
- **状态闭环**：`markWriteFatal` 同步先行置位 → notifier 挂起窗口内 status.fatal 可观测；
  replication 域经 E5.5 同步整替 → 提交事实在通知挂起窗口可观测（镜像 S5.5）；fatal/closing 期
  读取不冻结不回滚。闭环成立（#4 的例外窗口已单列）。
- **降级路径**：persistence-degraded → E2 拒（`RUNTIME_WRITE_DISABLED` 码族，域区分靠 message——
  ADR 0008 修订 #2 纪律）；I/O 恢复 → 持久层 retry 覆盖 → 写复通。与红灯 AC-6 链条逐位对位。
- **虚假降级识别**：设计在三处主动立法拒绝伪降级（D-3 损坏 loud、E2 notifier 未绑定 loud gate、
  META 载体缺席结果面拒绝而非凭空造载体）——方向正确；**残留一处伪降级即 #1**（双键 undefined →
  判 disabled 而非 loud）：按「该条件在功能完备系统里应恒真吗」判据，保留键存在而值 undefined
  在唯一合法写入面下恒假，属 bug 面被降级掩盖，必须改 loud。这也是本报告唯一的 HIGH。

## 五、红线测试思路（每漏洞对应的测试编写方向）

1. **#1 undefined 保留键**（红灯 IT 思路）：`seedForTest` 构造 META
   `meta.set('replicationId', undefined); meta.set('replicationEpoch', undefined)`（保留 docId/createdAt）
   → 经 registry.open：断言 **open 响亮失败**（`NamespaceRegistryFatalError('open','runtime-construction')`
   rejection 或修订后规定的通道），**而非** `getStatus().runtime.replication === {state:'disabled'}`；
   反向用例：两键真缺席的种子文档 open 成功且 status=disabled（防过纠）。再加一条「单键 undefined +
   另一键合法 → 同样 loud」保持性用例（现设计已 loud，防修订时丢失）。若 SA3 亦修 getMetadata/status
   分歧，补断言「损坏文档上两读面同为 loud 或同为保守值」。
2. **#2 敌意输入**（单测，runtime 包内经 seam/直构）：(a) Proxy `get` trap 首读返回
   `'a'.repeat(32)`、次读返回 `'ZZZ'` → `enableReplication` 结算后断言 META 中 replicationId ≠ `'ZZZ'`
   （期望 `REPLICATION_INPUT_INVALID` 或按修订后语义）；(b) `ownKeys` trap throw 的 Proxy → 断言结算为
   `ok:false` issue（JSON 含 `REPLICATION_INPUT_INVALID`），**绝不** raw rejection（`.then(null, …)`
   捕获断言 rejection 通道为空或仅 RuntimeWriteFatalError）。
3. **#3 常量落位**（静态守卫）：既有 `runtime-acceptance-exports-audit.test.ts` 恰一键断言与
   `registry-surface.test.ts` 九值断言保持绿即是守卫——SA3 若走「跨包导出值」分支立即红；可另加
   一条 registry 侧单测：`drawReplicationId` 对 `randomBytes` 返回非 16 字节 / throw / 非法 hex 产物
   → `{ok:false}` issue 且 message 含 `REPLICATION_RANDOM_SOURCE_INVALID`。
4. **#4 INV-R5 例外**：契约文档性修订即可；若实现选 best-effort 重读，则补「transaction-throw 注入
   （doctored env/monkey seam）后 status.replication 与 getMetadata 一致」的单元断言。
5. **#5 新通道覆盖清单**（SA3 补红灯的场景表）：
   - `REPLICATION_NOT_ENABLED`：未 enable 直接 bump → `ok:false`、META 两键仍缺席、saveDoc 0 次；
   - `REPLICATION_META_ABSENT`：无 META 载体种子 + enable → `ok:false`、doc 无新建 META 载体
     （`doc.share.has('META')` 仍 false）；
   - `REPLICATION_RANDOM_SOURCE_INVALID`：见 #3；
   - `REPLICATION_INPUT_INVALID`：见 #2（公共面不可达，`/internal` 级单测）；
   - 损坏 META 构造 throw：`'f'.repeat(32)` + epoch `'999'`（string）/ `0` / `1.5` / 32hex 大写 /
     仅 id 无 epoch → open rejection + observer `open-runtime-construction-failed`；
   - 槽内 E4 corrupt fatal：构造后破坏（仅 seam 级可达）→ `RuntimeWriteFatalError`（phase
     `write-slot-internal`、committed:false）+ status.fatal 置位 + 后续写 `RUNTIME_WRITE_DISABLED`。

---

## 六、给 SA1 的修订指令汇总（reject 的精确边界）

1. **必修**（#1）：`readReplicationFacts` 区分「键存在且值 undefined」与「键缺席」——前者 loud
   （ReplicationMetaCorruptError 同族），`disabled` 仅限两键真缺席；删除 projection.ts:32 类推。
2. **必修**（#2）：E3 单读捕获 + 全探测 try/catch 收编为 `REPLICATION_INPUT_INVALID`；E5 消费捕获值。
3. **必修**（#3）：registry 本地 `REPLICATION_ID_PATTERN` 常量（沿 NAMESPACE_ID_PATTERN 先例），
   §4.6 同步澄清不跨包导出。
4. **建议**（#4）：INV-R5 登记例外窗口（或实现 best-effort 重读）。
5. **建议**（#5）：§4.10 增补新通道测试要求（场景清单见上 #5）。
6. **可选**（#6/#7）：ReplicationIdDraw 落位、E4 载体在场信号明示、损坏通道不对称的对照说明。

以上修订全部为设计文档级，不要求改动分层结构、槽序、通道归属、D-1..D-12 的任何架构决策、
ALLOW/DENY LIST 结构。修订后提交 R2 复审，SA2 将只针对上述六点做差异复核。

---

## 附：本次评审的验证证据（命令 + 结果摘要）

- 逐行核对 `wiki/raw/task_phase5-replication-identity-epoch.md`（简报）、`…_relevant_decisions.md`
  （ADR 基准）、`…_design.md`（701 行全文）、`…_design_conflict_report.md`（SA8）、`…_sa6_red.md`（SA6）。
- 源码锚点复核（read 工具）：`runtime.ts`（十键/V1-V3/D5.1 接纳门/close barrier）、`write.ts`
  （S1-S7/disabled/markWriteFatal/rejectWithWriteFatal/writeFatalMessage/WriteSlot:71/copyFrozen）、
  `schema-write.ts`（S5.5 installActive:177-180）、`sequencer.ts:38`、`status.ts`（七键/buildStatus）、
  `p0.ts`（RuntimeState）、`internal.ts`（2 参工厂）、`projection.ts`（share.has 守卫:141/META-E1
  undefined 值 loud:182-183）、`lease.ts`（3 参/released 通道/Equal 断言）、`registry.ts`
  （randomBytes 门禁:479/generateNamespaceId:539/issueLease:658/open 构造 fatal:856-870）、
  registry `types.ts`（MutateRootResult 类型导入先例:35-41/九值导出面对应 index.ts）、
  runtime `index.ts`（值导出恰一键）、`mutation.ts`（ROOT 钉死）、`replace.ts`（META 零接触）、
  persistence `lifecycle.ts:238/492/554`（全量 snapshot 编解码）。
- 测试锚点复核：`registry-phase5-replication-red.test.ts` 全文（14 用例逐条对位 §4.7 矩阵；确认
  fatal 用例 red.test.ts:483-489 经 Lease + 2 参 runtimeFactory 驱动）、`…surface.test-d.ts` 全文
  （四红锚协变性核验）、`runtime-close-lifecycle.test.ts:160/:495`、`runtime-registry-internal-seam.test.ts:270`、
  `registry-open.test.ts:907/:162-191`、`runtime-acceptance-exports-audit.test.ts:29`；全仓 grep
  穷举 typed fake（恰 §4.10 所列 7 文件）与 loose fake 逃逸路径（`any`/`as never`/`=> any` 门）。
- 实证实验（node + yjs 13.6.32，于 packages/namespace-runtime 下）：`meta.set(k, undefined)` →
  `has()===true && get()===undefined`；该状态经 `Y.encodeStateAsUpdate`→`applyUpdate` round-trip 后
  键与 undefined 值完整存活（keys 含两键）；`Doc.d.ts:44` 确认 `share: Map<string, AbstractType>`。
  —— #1 的全部事实前提来自本实验，可由 SA1/SA4 原样重跑。

---

# R2 差异复审（2026-08-27，run_id: issue-132-1787809226-3529662，round 1 续）

**被审对象**：SA1 设计 R2 `wiki/raw/task_phase5-replication-identity-epoch_design.md`（701→808 行）。
**复审方法**：不重放 R1 全量审查——按 R1 七项发现逐条差异复核（回查修订正文伪代码与全部
声称落点），并对 R2 改动区域做新增漏洞扫描（fresh-eyes on the diff）。

## R2 Verdict: **pass**

## 逐条落实复核

| R1 # | 声称落点 | 复核结果 | 证据（修订正文实测） |
|---|---|---|---|
| **#1（HIGH）** has() 判别收编 corrupt | §4.3 伪代码 + §4.3 判据论证 + §2 D-3 + §3-9 + §4.2 E4 + §4.8 + INV-R9 + §6 | ✅ **真实落实，判据完备** | §4.3 读取器改为 `hasId/hasEpoch = meta.has(k)`：`!hasId && !hasEpoch → disabled`（两键真缺席）；`!hasId \|\| !hasEpoch → corrupt`（恰一键）；随后**双键各自** `get()===undefined → corrupt`（「键存在而值为显式 undefined」），再格式门——四个损坏分支与 R1 实证形态（has=true/get=undefined、round-trip 存活）逐一闭合，注释如实引用实证前提。§3-9 已删除 projection.ts:32 类推并给出正确理由（SCHEMA 面宽容有 ENV-2 兜底且无状态变迁后果）；§4.3 新增三重论证段（静默换谱系/自相矛盾/双读者分歧）；E4 throw 清单、§4.8 稳定文案类别、INV-R9、§6 末行纵深防御承诺同步改写（「对含 undefined 值的绕道同样成立——纵深防御闭合」）。**红灯零回流核验**：SA6 14 例无任何部分存在/undefined 键种子（create 路径两键真缺席 → disabled ✓；overflow 种子两键合法 → enabled ✓）——修订与 SA6 锚零冲突。 |
| **#2（MEDIUM）** E3 单读捕获 + 探测收编 | §4.2 E3/E5 + INV-R9 + §6 + §4.10.1 | ✅ **真实落实，双读分叉结构性不可达** | E3 重写为 try 块首句 `const replicationId = input.replicationId`（恰一次属性读=捕获），形状门全部作用于捕获值与元数据探测；整段 try/catch → `REPLICATION_INPUT_INVALID` 类 B issue，注释明文「绝不裸 reject（击穿 INV-R7）/ 绝不升格 fatal（防敌意 value → 永久禁写 DoS，write.ts:248 立法同源）」；E5 改为消费捕获常量 `meta.set('replicationId', replicationId)`。快照器两职责（深结构复制 vs 敌意陷阱中和+单读捕获）的辨析段如实记录 R1 混淆指正。捕获先于 input-is-object 检查——对 null/primitive 的属性读 throw 落入同 try/catch 收编，行为正确。 |
| **#3（MEDIUM）** registry 本地常量 | §4.1.2 + §4.6 | ✅ **真实落实，错误分支已被设计文本封死** | §4.1.2 新增 registry.ts 本地 `const REPLICATION_ID_PATTERN = /^[0-9a-f]{32}$/`，注释四要点齐备（沿 NAMESPACE_ID_PATTERN registry.ts:142 先例 / 跨包模块级值不可达 / 从 index 导出值会击穿 runtime-acceptance-exports-audit 恰一键冻结 / 两副本互为结构守卫并注释互引）；§4.6 表行同步澄清「RegExp 常量不进 index」。 |
| **#4（LOW）** INV-R5 例外窗口 | §5 INV-R5 + §4.2 E5 尾注 | ✅ 落实（取建议 (a)，零代码） | INV-R5 内联登记唯一例外窗口：E5 unknown-pipeline-throw 保守 committed:true 时 E5.5 跳过 → status.replication 陈旧于 live META，与 SCHEMA 槽 S5.5 先例同构；附生产不可达论证 + fatal 后无放大面；E5 尾注互引。 |
| **#5（LOW）** 新通道测试锚 | §4.10.1（新增）+ §7 ALLOW | ✅ 落实且超出要求 | §4.10.1 六通道场景表（NOT_ENABLED / META_ABSENT / RANDOM_SOURCE_INVALID / INPUT_INVALID 两型（Proxy 双读分叉 + trap throw）/ 损坏构造 throw 种子族（含双键 undefined、单键 undefined、格式违约五型 + **两键真缺席反向守卫**防过纠 + 双读者一致性）/ 槽内 E4 corrupt fatal），每行含具体断言要求与落位；ALLOW LIST 追加 2 个 SA3-owned 新测试文件（runtime-replication-write.test.ts / registry-phase5-replication-channels.test.ts）——显式列入消 SA4 scope-creep 误判。 |
| **#6（INFO）** 类型落位 + 载体在场信号 | §4.1.2 注释 + §4.5 lease.ts + §4.2 E4 | ✅ 落实 | (a) `ReplicationIdDraw` 移至 lease.ts 定义并包内导出，registry 经既有 './lease.js' 单向 import（registry.ts:64 已核）——零循环、不进主入口声明图；(b) E4 明示「同步段内二次 `doc.share.has('META')` 判别载体在场」+ 零 await/run-to-completion 无 TOCTOU 论证；bump 分支明确「两键真缺席与载体缺席同拒」（REPLICATION_NOT_ENABLED，零写入）。 |
| **#7（INFO）** 通道不对称对照 | §4.3 消费方表后 | ✅ 落实 | 运维诊断对照段：docId 损坏 → loadDoc 层 NAMESPACE_LOAD_FAILED 结果 issue（可重试）vs 复制字段损坏 → 构造门 runtime-construction fatal rejection（internal 面）；差异归因检测层，均 loud，诊断应两通道都查。记录性说明不改判，符合 R1 定调。 |

## R2 改动区新增漏洞扫描（负结果）

- **has() 判别与 E4/E5 交互**：undefined 检查位于「恰一键」之后、格式门之前，四分支
  （双缺席/恰一键/双在但 undefined/格式违约）互斥完备；`get` 在 `has` 之后调用，无重复读语义问题。
- **E3 捕获位置**：捕获先于 typeof/keys 检查——敌意 trap 的任何 throw（含对 null 取属性）统一
  落入收编通道，无裸逃逸面；E1/E2 仍零输入访问（E3 在 E2 后，未回退）。
- **`ReplicationIdDraw` 移位**：lease.ts 依赖面（types.ts/errors.ts/observer.js/type-only runtime）
  不含 registry.ts——单向性成立，无新循环。
- **§4.10.1 新增场景与 SA6 套件关系**：全部落位为新增 SA3-owned 文件/用例，未触碰 SA6 两文件
  （§4.10 表仍标「零改动」）；场景均为设计文档化行为的行为锚，不预设实现细节。
- **INV-R9/§6 改写后的自洽性**：「含 undefined 值/部分存在的绕道写入在下次 open 即响亮失败」
  现与读取器判据真实一致（R1 指出的承诺-实现落差已消除）。
- **类型锚兼容性**：R2 修订零触碰 Lease/Runtime 方法签名、status 域形状、导出面——R1 已核的
  四红锚可转绿结论不受影响。

## 遗留化妆品级注记（不阻断 pass，供 SA3/SA4 参考）

1. §7 测试文件小节标题「测试文件（8 文件…）」与实际列举 12 条目不符（R1 即存在的计数笔误，
   R2 未改；无语义影响，建议 SA3/SA4 按条目而非计数核对）。
2. §4.10.1「双读者一致性」锚的措辞略松（损坏文档 open 即 rejection，两读者经 Lease 均不可达；
   合理解读为「不存在两读者可同时被观测且互不一致的状态」，SA3 落地时按此意图实现即可）。

## R2 结论

R1 全部 3 必修 + 2 建议 + 2 INFO **逐条真实落实**（非表面应答——每项均回查到修订正文伪代码与
全部声称的连锁落点）；R2 改动区未引入新漏洞；架构内核（D-1 分层、E1-E7 槽序、通道归属、
文件清单结构）零回退。红灯契约（SA6 14+6）零回流。

**R2 Verdict: pass** —— 同意放行进入 SA3 实现。本 pass 仅覆盖设计层；实现与活链路验证仍由
SA4（静态复核 + §4.10.1 场景核销）与 SA7（全链验收）承担。
