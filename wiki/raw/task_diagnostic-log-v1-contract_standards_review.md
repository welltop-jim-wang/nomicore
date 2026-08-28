# Standards 轴审查报告 — task_diagnostic-log-v1-contract（commit ae3aeec）

审查范围：`git diff 6de2f1d..HEAD`（47 文件 +6514 行），仅工程标准轴——代码质量 /
类型安全 / 错误处理 / 测试质量 / 仓库一致性 / 资源与安全。规格符合性归另一轴，本报告不裁决。

## 复验记录（只读命令实测）

- `tsc -p packages/namespace-diagnostic-log/tsconfig.json` → exit 0（strict +
  exactOptionalPropertyTypes + noUncheckedIndexedAccess + verbatimModuleSyntax 全过）。
- `vitest run --typecheck packages/namespace-diagnostic-log` → 12 文件 152 测试全绿、
  类型测试零错误（与 commit message「12 files / 152 tests」一致）。
- 运行期探针（tsx eval，未落盘任何文件）：
  - `input: 42 / null / 'x'`（primitive）→ 整条 emission 被丢，事件为
    `pipeline-crashed/stage:emitter`；而 `input: []`（对象形违规）→ record 保留 +
    `input-projection-failed` + `capture:unavailable`（见 concern-2）。
  - 环形 snapshot → `capture:unavailable` + `input-projection-failed`，record 保留（正确收编）。
  - `jcs(new Date(0))` → `"{}"`；`jcs(new Map(...))` → `"{}"`；
    `jcs(new Uint8Array([1,2,3]))` → `'{"0":1,"1":2,"2":3}'`（见 concern-3）。
  - full 捕获 snapshot 内嵌 Uint8Array：emit 后 `bytes[0]=99` **不抛错且已接纳 record
    内嵌值随之变为 99**（见 concern-3）。
  - `RE_BASE64` 对 100k 字符敌意输入 ×100 次 ≈ 111ms（线性，无 ReDoS）；
    `RE_BOUNDED_STR` 对 `\r`/`\n`/`\u2028` 均正确拒绝；`RE_BASE64` 拒空串、收
    `AA==`/`AAA=`/`AAAA`（与 schema-patterns.ts:41-43 注释一致）。

## Blocker（必须修）

无。

## Concern（应修）

### C-1 健康事件构造点绕过冻结联合的编译期检查
- 证据：`src/health.ts:103-109`（`makeEventNotifier` 返回 `(event: Record<string, unknown>) => void`）、
  `src/health.ts:60-67`（`freezeEvent` 把 `Object.fromEntries` 结果 `as DiagnosticLogHealthEvent`）。
- 问题：`DiagnosticLogHealthEvent` 是 §8.1 冻结的 8 成员判别联合，但全部 ~15 个构造点
  （pipeline.ts:202/211/218/233/235/243/281/291，memory.ts:173/271/298/328/346 等）以
  `Record<string, unknown>` 上送——`type` 字符串 typo、字段名拼错、缺必需键均不被 tsc 拦截，
  `freezeEvent` 的 cast 也不做运行期校验，畸形事件会**静默送达 observer**。
  注释（health.ts:100-102）称「判别联合的窄化由构造点自证」，但 TS 本就支持对对象字面量
  做判别联合 + excess property 检查（含条件展开 `...(cond ? {operation} : {})`），
  该放宽没有必要性。
- 建议：notifier 参数改回 `(event: DiagnosticLogHealthEvent) => void`，构造点接受编译期检查；
  memory.ts:265 的「词表外 operation 原值携带」一处保留显式 cast 即可（已有注释论证）。

### C-2 primitive `input` 走顶层崩溃通道，与对象形违规的降级语义不一致
- 证据：`src/projection/input.ts:56-57`（`input as Record<string, unknown>` 后直接
  `'status' in record`——`in` 作用于 number/string/null 抛 TypeError）；探针实测（上文）。
- 问题：同为 producer 的 input 形状 bug，对象形违规（`[]`/`{}`/未知 status）被收编为
  `capture:unavailable` + `input-projection-failed`、**record 保留**；primitive（`42`/`null`/`'x'`）
  却冒泡到 emit 顶层 catch，按 `pipeline-crashed` **丢弃整条 record**。同类缺陷两档处理，
  且把形状违规误标为「崩溃」（污染 pipeline-crashed 桶的可诊断性）。emit 不抛错契约本身
  未被违反（故非 blocker）。
- 建议：`projectInput` 入口先 `typeof input !== 'object' || input === null` → `onFailure()` +
  `{capture:'unavailable'}`，与对象形违规同桶。

### C-3 canonical-json「防御性校验」不校验 plainness，类实例静默失真 + full 捕获的 typed array 冻结漏洞
- 证据：`src/canonical-json.ts:77-82`（object 分支只看 `typeof === 'object'`，不查原型）；
  头注 canonical-json.ts:50-51 自称「快照契约由本函数防御性校验」；
  `src/pipeline.ts:35-45`（deepFreeze 对 `ArrayBuffer.isView` 跳过，仅 top-level updateBytes
  有 intake 复制隔离——R3 注记 emission.ts:6-9）；探针实测（上文）。
- 问题两层：
  1. `Date`/`Map` → `"{}"`、`Uint8Array` → 索引对象——digest 对**有损视图**计算且无任何信号，
     与「防御性校验」的头注承诺不符（producer 违约输入应 loud 失败，而非静默接受）。
  2. full/redacted 捕获的 snapshot 内嵌 typed array 不可冻结 → producer 事后变异**静默改写
     已接纳 record**（实测值从 1 变 99），所有权契约（emission.ts:4-9「敌意后变异 loud
     TypeError」）对该路径落空；redacted 路径因重建 plain 副本反而免疫。
- 建议：jcs/redactValue 的 object 分支增加 plainness 检查
  （`Object.getPrototypeOf(v)` 仅接受 `null`/`Object.prototype`，违规抛 SnapshotContractViolation）；
  或至少在头注诚实声明「plainness 属 producer 契约、不做机器防御」。两案都应补一条
  「内嵌 typed array 拒绝」的契约测试。

### C-4 `truncated`/`originalCount` 的 presence 语义注释三处不一致
- 证据：`src/record.ts:55-58`（「presence ⇔ 发生过预算截断（§6.2）」）与
  `src/schema.ts:149-150`（schema 文本注释「仅在实际发生预算截断时出现」）均不含
  「条目丢弃」；而实现 `src/projection/issues.ts:178`（`if (truncated || droppedAny)`）
  与其处注释（issues.ts:174-176，R4/C-3「truncated ⇔ 预算截断**或条目丢弃**发生过」）
  一致——R4 勘误更新了实现侧注释，漏了 record.ts JSDoc 与冻结 schema 文本注释。
- 影响：读 record.ts/schema 文本者会误判畸形条目丢弃不产生 presence 键；测试
  （issues-projection.test.ts:159-161）已按新语义断言（丢 2 条 → truncated=true/
  originalCount=1）。
- 建议：record.ts JSDoc 直接修（廉价）；schema.ts 文本注释属指纹面——按 §3.4 纪律
  改动即新版本，建议入 #152+ 演进备案而非本票硬改。

## Nano（记录）

1. `src/record.ts:135` `UPDATE_OMITTED_REASONS` 为死导出——全仓无任何 import（index.ts 未
   re-export，intake 按设计 §2.1「开放 StableCode 形状」也不消费它）；要么接入 either 校验
   要么删除，留着是诚实性负债。
2. `src/schema-patterns.ts:44-52` 9 个 `RE_*` 中 6 个（RE_STREAM_ID/RE_DECIMAL/RE_CRC32C_HEX/
   RE_SHA256_HEX/RE_SEGMENT/RE_BASE64）当前零消费方（intake 仅用 3 个）；头注称「intake
   副本」，与实际不符——删或标注「预留」。
3. 死注释 `// eslint-disable-next-line no-console`（`src/health.ts:74`、`test/helpers/twin.ts:21`）
   ——本仓无 eslint 配置（仅 .editorconfig），注释指向不存在的 linter。
4. `test/identity.test-d.ts:36,44` `expectTypeOf<EmissionResult>().toEqualTypeOf<EmissionResult>()`
   ——同义反复断言，恒真、无锚定价值（同文件其余 expectTypeOf 均为有效锚）。
5. `test/line-budget.test.ts:69` `projectedRecordBytes ≥ queueDepth`——字节数与条数的
   跨量纲比较，恒真且无语义。
6. `test/emitter-isolation.test.ts:90` 标题承诺「数字/字符串根值」，实际只测了 `42`。
7. `src/pipeline.ts:284` `safeOperationOf(emission)` 调两次且 `as Operation` 冗余
   （返回值已是 `Operation | undefined` 并被 `!== undefined` 窄化）。
8. `src/adapters/memory.ts:260` `effective.input as InputCapture` 冗余——`recordKind === 'attempt'`
   三元分支已窄化；memory.ts:20-21 与 26-27 同模块 split import 可合并。
9. 多余连续空行：`src/pipeline.ts:60-61`、`src/adapters/memory.ts:61-62`（仓内先例无此形态）。
10. 错字：`AGENTS.md:8`「契约契约测试」；`test/line-budget.test.ts:39` 注释「红action 收缩」。
11. `src/adapters/memory.ts:265/381` 两处 deliberate type lie（词表外 operation 原值携带 /
    注入 envelope 的 id cast）——均有注释论证且仅 fault-injection 可达，记录为「可接受但
    需保持注释同步」。
12. `src/adapters/memory.ts:53-55` `utf8Length` 每次 new TextEncoder——模块级单例即可
    （热路径 per-record 调用）。
13. `src/testing.ts:33` `bytes[cursor % bytes.length]!`——空 bytes 时 `cursor % 0 = NaN`、
    `!` 掩盖 undefined、静默产全零序列；测试接缝，建议空数组 loud 抛错。
14. `test/memory-adapter.test.ts:51` `r as DiagnosticChangeRecord` 冗余 cast（元素已是该类型）。

## 分维度小结

- **代码质量**：模块划分干净（projection/adapter/pipeline 分层清晰、无模块环），头注质量
  高且与代码高度一致（除 C-4 与 nano-2）；命名与 CONTEXT.md 受控词汇对齐。pipeline.ts 的
  intake → 投影 → 清洗 → 组装 → sink 五步直线化，单一职责达标。
- **类型安全**：strict 全家桶零错误；无 `any` 泄漏；cast 几乎全是 `unknown → Record` 的
  防御性窄化惯例，三处 deliberate lie 有注释（nano-11）。主要缺口是 C-1（事件构造点绕过
  冻结联合）与 C-3（plainness 无机器防线）。
- **错误处理**：全部 throw 站点（SnapshotContractViolation/TruncationBudgetBelowMarker/
  RangeError/敌意 getter/observer/fallbackLog/sink）都有收编路径与文档；唯一空 catch
  （health.ts:94）有「最后防线」注释，符合仓内纪律。emit 不抛错契约经多路敌意探针实测成立。
- **测试质量**：行为化断言为主、KAT 扎实（CRC-32C/SHA-256/RFC 8785 向量）、负锚
  （@ts-expect-error）设计精良、helpers（eventsOfType/assertAttempt/expectTwin）有效防
  假阳性；无脆弱快照。瑕疵仅 nano-4/5/6 三处弱断言/标题不符。
- **仓库一致性**：package.json exports 形状（`.` + `./testing`）、AGENTS.md
  Contract/Boundaries/Verification 三段式、README 结构均对齐 clock/vfsl 先例；根
  package.json 仅追加一条 typecheck、lockfile 仅新增 importer、CONTEXT.md 仅新增 3 词条——
  最小性达标。环境绑定面声明（node:crypto/Buffer 仅在 digest.ts/carrier.ts）经 grep 核实属实。
- **资源与安全**：无无界面——队列 capacity、line/payload/issues/节点护栏齐备且经测试钉死；
  stats 计数键集有界（operation×reason 封闭叉积）；failed/exhausted 模式抑制逐条事件防洪泛；
  `Object.keys` 遍历只产出不写入（无原型污染面）；手写 RegExp 全部锚定 + 量词有界，实测无
  ReDoS。full 捕获大快照的 measure 双序列化（降级前后各一次）为 CPU/内存尖峰面，有界于
  producer 自带快照尺寸，记录为已知形态。

## Verdict：**pass-with-issues**

无 blocker；4 个 concern（C-1 事件类型检查绕过、C-2 primitive input 收编不一致、
C-3 plainness 防御与 typed-array 冻结漏洞、C-4 presence 语义注释漂移）均应在合入后
尽快跟进（C-1/C-2/C-4(TS 侧) 廉价，C-3 需设计裁决一句）；14 个 nano 入台账即可。

---

# R5 复审（687aa94「R5 errata batch from dual-axis final review」）

范围：`git diff ae3aeec..HEAD -- packages/namespace-diagnostic-log`（16 文件 +241/−115）；
只核对本报告 4 concern + nano 台账的修复实效与回归面。复验：`tsc` 全绿；
`vitest run --typecheck` 12 文件 **164** 测试全绿（152→164，净增 12 个 R5 契约测试）；
运行期探针复跑（tsx eval，零落盘）。

## Concern 修复核对

### C-1 事件构造点判别联合编译期检查 —— 已修复 ✅
`makeEventNotifier` 参数与返回类型收紧为 `DiagnosticLogHealthEvent`（health.ts:100-108），
`freezeEvent` 入参同步收紧（health.ts:60），`cleanContext`/`buildSemanticRecord` 的 notify
形参跟随（pipeline.ts:166/210）。全部 ~15 个构造点现受判别联合 + excess property 编译期
检查；tsc 全绿即机器证据。memory.ts:265 的词表外 operation 显式 cast 按约定保留（注释在）。

### C-2 primitive input 收编层级 —— 已修复 ✅（双层防御）
intake 前置拒绝（pipeline.ts:93-97）：primitive/null/数组 input → `emission-dropped`
（结构违规桶），不进 `in` 运算、不消耗 sequence；`projectInput` 内层守卫
（projection/input.ts:59-63）兜底 `unavailable`。实测 `42`/`null`/`'x'`/`[]` 全部
emission-dropped、零 pipeline-crashed、sequence 不消耗；新增 it.each 契约测试
（input-capture.test.ts:232-241）。记录：数组 input 的归类由「降级 unavailable +
record 保留」改为「整条 emission-dropped」——R5 明裁为结构违规，内部一致且有注释；
`null`/`[]` 两形状未入 it.each（仅 42/'x'/true），nano 级覆盖缺口，不阻塞。

### C-3 plainness 守卫与 typed-array 冻结漏洞 —— 已修复 ✅
`assertPlainObject`（canonical-json.ts:93-99，原型仅接受 `Object.prototype`/`null`）挂入
jcs 对象分支（:78-82）与 `redactValue`（projection/input.ts:38-40）。实测：嵌套/根级
Date/Map/Uint8Array → `capture:unavailable` + `input-projection-failed`；null 原型 plain
对象仍正常 digest（守卫不过杀）；**full 捕获内嵌 Uint8Array 现在整链转 unavailable，
post-emit 变异不再可达已接纳 record**（冻结漏洞封死）；`jcs(new Map())` 抛
SnapshotContractViolation。契约测试 3 件（input-capture.test.ts:243-283，含 plainness 判定
后零重读探针）。设计 §5.4 清单已在 R5 状态行备案。

### C-4 presence 注释漂移 —— 已按 R5 再裁决收敛 ✅
再裁决口径：presence **严格 ⇔ 预算截断**（冻结 schema JSDoc「仅在实际发生预算截断时出现」
为准，R4「丢弃也置位」撤销；畸形丢弃只走健康事件）。实现（issues.ts:177-179
`if (truncated)`）、record.ts:51-58 JSDoc、issues.ts:97-104 头注/JSDoc、design §6.2 伪码
四方现已逐字一致；**schema.ts 文本零改动、指纹未变**（schema-freeze 钉死测试仍绿——
裁决选择了不动冻结面的方向，正确）。测试三连断言两键缺席（issues-projection.test.ts
:161-197）。

## Nano 台账核对

- 已修（7 项）：1 UPDATE_OMITTED_REASONS 死导出删除；2 六枚死 RE_* 删除且头注改实述；
  9-pipeline 多余空行；10 两处错字（AGENTS.md「契约契约」/line-budget「红action」）；
  12 TEXT_ENCODER 模块级单例（memory.ts:52-56）；13 空字节序列 loud 抛错
  （testing.ts:28-32）；14 memory-adapter.test.ts 冗余 cast。
- 未修（维持台账，均「记录即可」级、不阻塞）：3 两枚死 eslint-disable（health.ts:74 /
  test/helpers/twin.ts:21）；4 identity.test-d.ts:36,44 同义反复 expectTypeOf；
  5 line-budget.test.ts:69 跨量纲断言；6 emitter-isolation.test.ts:90 标题与覆盖不符；
  7 pipeline.ts:299 safeOperationOf 双调用 + 冗余 cast；8 memory.ts:20-21 split import /
  :265 冗余 cast；9-memory 多余空行（memory.ts:62-63）；11 两处 deliberate lie 保留
  （约定如此，注释需随代码同步）。

## 回归与新问题检查

- 规格轴附带改动（C-S1 redacted 下 path 预算一致化 / C-S2 emission.issues 裸数组形状 /
  C-S3 source 封闭键校验）在 standards 面无新问题：无新增 any/不安全 cast；
  `IssuesInput` 接口删除后全仓零残留引用（grep 核实）；source 封闭键校验只读
  `Object.keys` 不写回；design §6.2 成文「redacted 下 code 保留不截断（稳定码低敏）」
  为明示决策，非缺陷。
- 敌意 Proxy 与 assertPlainObject 的交互（getPrototypeOf trap 抛出）仍落入既有
  try/catch 收编链，不产生新外抛面。
- `projectInput` 内层守卫自 emit 路径不可达（intake 已前置），属文档化纵深防御，
  内部函数未导出——非死代码负债。
- README/AGENTS/CONTEXT.md 与公共面无新增漂移；根配置零改动。

## R5 最终 verdict：**pass**

4 个 concern 全部真正修复并经测试 + 探针双重钉死；nano 台账清理 7/14，余项均为
「记录即可」级不阻塞；修复未引入新问题。本轴对 687aa94 无保留通过。
