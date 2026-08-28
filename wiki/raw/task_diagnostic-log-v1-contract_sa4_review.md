# SA4 静态验尸报告 — issue #148 `@nomicore/namespace-diagnostic-log`

- **Date**: 2026-08-28（R4 轮）
- **Reviewer**: SA4（实现后红队审查）
- **对象**: 未提交工作树改动（`git diff origin/main...HEAD` 之外）：`packages/namespace-diagnostic-log/**`（17 src + 12 test + 2 helper + 骨架）、根 `package.json` 一行、`CONTEXT.md` 3 词条、`pnpm-lock.yaml` 新 importer、`wiki/raw/` 工件
- **权威基线**: 设计 R2+R3（`task_diagnostic-log-v1-contract_design.md`）、SA2 评审+R2 复审、SA6 红灯报告（含 R3 修订节）、SA3 实现报告、ADR 0011/0012
- **总 Verdict**: **pass（放行进入 SA5/SA7 验收）**——5 项 concern（均已在 SA3 报告 §3 披露或实证可复核），无 blocker；concern 全部属「类型面/记账口径偏离冻结文本，需 R4 设计追认或微修」，不动摇运行时行为与测试锚

---

## 0. verdict 汇总表（7 项）

| # | 审查项 | verdict | 一句话理由 |
|---|---|---|---|
| 1 | 设计符合性（§4.2/§5/§6/§7/§8/R3） | **concern** | 运行时语义逐节对齐成立；5 处偏离全部是类型面/记账口径（详 §1），均需 R4 追认 |
| 2 | schema 冻结纪律（§3.3 逐字符/单源/指纹） | **pass** | 独立脚本实证：`RECORD_SCHEMA_TEXT` 与设计 §3.3 围栏文本 **7040 字符逐字符相等（含尾随 \n）**，指纹复现 `sha256:v1:dedad2ab…`；Pattern 单源插值成立 |
| 3 | ADR 符合性抽查（不 throw/零敏感字段/VFSL 只走健康面/drop newest） | **pass** | 全 throw 站点审计：生产入口无逃逸；事件键集 ⊆ §8.2 白名单且丢弃 `ValidateIssue.message`（含 40 字符值预览，`packages/vfsl/src/validate.ts:27`）；drop newest 保序有测试锚 |
| 4 | 测试逃逸（基础设施改动/断言弱化/硬编码） | **pass** | SA3 §3.3 四处改动逐一复核：均为类型机制/路径修正，断言语义未弱化（2 处同义反复 expectTypeOf 记 nano）；src 无 hard-code 测试输入 |
| 5 | 切片纪律（ALLOW LIST/lockfile/根 package.json/CONTEXT.md） | **pass** | diff 精确匹配 ALLOW LIST；lockfile 仅 +16 行新 importer；根 package.json 仅 typecheck 一行；CONTEXT.md 仅新增 3 词条 |
| 6 | 工程质量（strict TS/绑定面/风格/文档一致性） | **pass** | strict（`exactOptionalPropertyTypes`+`noUncheckedIndexedAccess`）下包级与根级 tsc 双 0；`node:crypto` 仅 digest.ts、`Buffer` 仅 carrier.ts（grep 实证）；AGENTS 一处措辞 nano |
| 7 | 死代码/不可测分支（§9.6/§9.10/§9.11） | **pass** | failed 模式（vfsl-gate:165-204）、exhausted 模式（identity:98-132）、fallbackLog 最后防线（observer-isolation:67-87）三锚齐备且断言抑制语义 |

**验证证据（本机复跑）**：

```text
git status --short           → M CONTEXT.md / M package.json / M pnpm-lock.yaml + ?? packages/namespace-diagnostic-log/ + ?? wiki/raw/task_diagnostic-log-v1-contract*（无其他）
npx tsc -p packages/namespace-diagnostic-log/tsconfig.json → exit 0
pnpm typecheck（根，11 包链含新包）                          → exit 0
npx vitest run --typecheck packages/namespace-diagnostic-log → 12 files / 152 tests / Type Errors 0 / exit 0
npx vitest run --typecheck（全仓）                           → 130 files / 1557 tests / Type Errors 0 / exit 0
指纹脚本（/tmp/sa4-fp-check.mjs）→ design-block 7040B == impl 7040B，char-for-char equal；envelopeFingerprint 复现
```

---

## 1. Concern 详述（5 项 · 文件:行证据 + 影响 + 修复建议）

### C-1 健康**事件类型面**从冻结判别联合放宽为全字段可选单接口（需 R4 追认）

- **证据**: `src/health.ts:22-53`——`DiagnosticLogHealthEvent` 为单接口（`type` 必填、`reason/stage/field/fromPolicy/recordKind/operation/schemaId/schemaFingerprint/issueCount` 可选、`issuePaths/projectedRecordBytes/queueDepth` 必填）；设计 §8.1 冻结为 8 成员判别联合。头注（health.ts:17-21）自认偏离及动因（SA6 测试 filter 后无窄化 → TS2339）。运行期事件键集仍守纪律：构造点逐成员字面量（pipeline.ts:202/211/218/233/235/243、memory.ts:174-178/193-195/269-270/284-297），且 `vfsl-gate.test.ts:104-108` 白名单键集断言锚定。
- **影响**: 公共消费者失去编译期判别窄化；类型上可构造「无意义字段组合」的伪事件对象。属**类型面放宽**而非运行时行为改变——对 ADR 0012「observer 只包含稳定 code…」的运行时合规无影响。
- **回流目标**: SA1/总控（R4 一句话追认），或 #149 接线前恢复判别联合 + 测试侧 type guard。**不阻塞本票**。

### C-2 `records()` 返回类型收窄为 `readonly AttemptRecord[]`（v1 公共面类型谎言，#152 必须回收）

- **证据**: `src/adapters/memory.ts:90-101`（接口声明）+ `355-359`（`as readonly AttemptRecord[]` cast）——设计 §1.3 为 `readonly DiagnosticChangeRecord[]`。运行时队列可含 genesis-baseline（仅 `testing.injectFinalRecord` 直通可注入，memory.ts:332-347；`vfsl-gate.test.ts:148-162` 正例）。SA3 §3-2 披露，动因是 SA6 对元素做 `.result/.operation` 访问。
- **影响**: 若数组含 genesis，消费者 `records()[0].result` 运行时 undefined（类型说存在）。v1 生产不可达（公共面无 genesis 构造路径，§10-J1 备案），但 #152 adapter 落地 genesis 后该缝隙立即变现。
- **回流目标**: SA1（设计 R4 注记 v1 类型面口径）+ #152（重新审视签名，SA3 §6 已自认）。

### C-3 `originalCount` presence 语义宽于设计 §6.2 伪代码（丢弃条目也触发 presence）

- **证据**: `src/projection/issues.ts:175-180`——`droppedAny` 时返回 `{...base, originalCount}`（无 `truncated`）；设计 §6.2 `...(truncated ? { truncated: true, originalCount } : {})` 与 §3.3 schema JSDoc「truncated/originalCount 仅在实际发生预算截断时出现」均为**截断触发**。SA6 测试锚定实现侧行为（`issues-projection.test.ts:149-159` 畸形丢弃 → `originalCount===1` 且无截断）。
- **影响**: presence 从「截断⇔出现」宽化为「截断或丢弃⇔出现」。信息量增加、schema 合法（VFSL 不机器约束 presence）、round-trip 不变；但与冻结文本不一致，消费者按 §6.2 推断会误读。
- **回流目标**: SA1（R4 补一句：`originalCount` presence ⇔ 截断或条目丢弃）。SA3/SA6 无需改码。

### C-4 U+2026（`…`）记账特例：预算基准对单一代码点失真，4 KiB message 子预算可被穿透最多 50%

- **证据**: `src/projection/issues.ts:47` `if (cp === 0x2026) return 2`——为调和设计 §6.1 内部矛盾（钉死「marker JSON 字面量字节 = 13B」vs 其自身公式给出的 14B：`…`=3B + `[truncated]`=11B；SA2 R2.3-n1 仅标 cosmetic）。**本机实测**：`jsonLiteralBytes('…[truncated]')=13` 而精确值 14；`'…'.repeat(2048)` 测得 4096B（≤ 预算，**不截断**）而精确 JSON 字面量 6144B——超 4 KiB 子预算 2048B。
- **影响**: message/path 段/code 三个字段级预算（4096/1024/256）对 U+2026 密集内容最多超出 50%。缓解：整行 `measure()`（memory.ts:53-59，`JSON.stringify`+`TextEncoder`，精确字节）仍把整条 record 兜在 `lineBudgetBytes` 内；round-trip / VFSL / 孪生不变量均不受影响；确定性保持（测量与截断同标尺）。SA3 §3-6 披露。
- **回流目标**: SA1/总控 R4 勘误二选一： **补正 13B→14B**（同步 `issues-projection.test.ts:213-214` KAT、`issues.ts:15` 注释），删除该特例——恢复「预算 = JSON 字面量字节」严格语义（推荐）； 正式把「U+2026 记 2B」写成 §6.1 记账规则并接受字段级上浮。

### C-5 `vfsl-validation-failed` / `record-dropped` 事件的 `operation` 位对 genesis / 词表外值缺省（设计 §8.1 成员中为必填）

- **证据**: `src/adapters/memory.ts:63-70`（`operationOf` 词表外/无 operation → undefined）+ `193-195`（notifyRecordDropped 省略键）+ `297`（vfsl-validation-failed 同）；genesis record 形状本身无 operation（record.ts:121-129）。SA3 §3-7 披露，SA6 §3.6 明确不断言该值。`identity.test-d.ts` 侧事件类型面 `operation?:` 可选（C-1 的连带）。
- **影响**: v1 仅 fault-injection / testing 直通可达；**#152 生产 genesis 后该事件将常态缺省 operation**——设计 §8.1 的成员形状是 attempt 中心的盲点。
- **回流目标**: SA1（R4 把两成员的 `operation` 标注 `operation?: Operation` 并注明 genesis 无 operation 属形状事实）。

### Nano（记录在案，不构成 concern）

1. `identity.test-d.ts:36,44`——两处 `expectTypeOf<T>().toEqualTypeOf<T>()` 同义反复（SA3 §3-3-b 改写自值形式）；契约力实际由相邻 `@ts-expect-error`（38/46/65/98 行）与 `const ok: EmissionResult = {...}` 赋值锚承担，净覆盖未丢。
2. `AGENTS.md:16-18` Contract 段「snapshot 与 updateBytes 所有权移交……loud TypeError」——updateBytes 实为 R3 **复制隔离**（变异不抛），`emission.ts:6-9`/`pipeline.ts:115-119` 表述正确，AGENTS 措辞待同步。
3. `pipeline.ts:155-158` 非对象 `context` 整体静默丢弃（无事件）——设计未定义该形状，SA3 §3-5 披露。
4. `memory.ts:332-347` `injectFinalRecord` 不更新 `lastSequence`——直通接缝 sequence 记账未定义：注入 sequence '1' 后首条 emit 也得 '1'（队列可出现重复 sequence 字符串）。仅 testing 可达；建议 testing.ts 文档注明。
5. `memory.ts:289-292` issuePaths「先滤根级空路径再取前 10」——若前 10 个 issue 均无路径段则事件 `issuePaths: []`；schema 合法、白名单合规，极角。

---

## 2. 各审查项核验记录（防复审重复劳动）

### 2.1 设计符合性（item 1）

逐文件对照结论（运行时语义，类型面偏离见 C-1/C-2）：

- **§4.2 失败隔离表逐行**: 顶层 catch（pipeline.ts:275-292 emitter / memory.ts:314-329, 333-347 adapter）、intake 违规→emission-dropped（pipeline.ts:200-204，10 类违规矩阵在 record-vocabulary.test.ts:229-259）、输入投影失败→unavailable+事件（input.ts:76-87，不重读：单触达探针 input-capture.test.ts:212-227）、issues 段级 JSON-safe（issues.ts:78-93 + -0 归一 129-131）、enrichment 丢字段不丢 record（pipeline.ts:149-245）、sink 防 throw（pipeline.ts:288-292 + record-vocabulary.test.ts:58-68）、schema 编译失败 failed 模式（memory.ts:168-179 + 315-318，恰一次事件+计数抑制）、update 物理化三守卫顺序 empty→disabled→too-large（memory.ts:209-228，测试 update-carrier.test.ts:93-114 锚优先级）、line 预算先降级后丢弃（memory.ts:256-278，与 §5.5 伪码逐步同构）、VFSL 失败丢弃+issuePaths（memory.ts:280-300）、队列满 drop newest 不入队（memory.ts:302-309）、observer 隔离（health.ts:79-94）。**无漏行**。
- **§5 输入捕获**: 决策表 5×4 全格（input.ts:50-87 + input-capture.test.ts:22-90）；「事实优先于策略」四列皆同 ✓；digest 恒对全量快照计算（input.ts:78，redacted/full 也携带 ✓ §10-J7）；none 不触碰快照（input.ts:72-75 ✓）；jcs 逐槽 hole 检查（canonical-json.ts:66-75 ✓ R2/C-b1）；1M 节点护栏（canonical-json.ts:41-47 + input.ts:20-22 ✓）；快照契约违反→unavailable 不重读（input.ts:84-87 ✓）。
- **§6 投影**: 预算常量 4096/1024/256/1000 条/256 段逐字（issues.ts:142-173）；code-point 对齐截断（issues.ts:58-73）；redacted message→`«redacted»`、code/path 保留（issues.ts:143-151 ✓ §6.2）；`TruncationBudgetBelowMarker` loud 断言经顶层 catch 收编（issues.ts:59 + pipeline.ts:280-287 ✓ R2/E-c1）；预算基准 = JSON 字面量字节（唯 U+2026 特例，见 C-4）。
- **§7 adapter**: 容量默认 1024、line 1 MiB、payload 64 MiB（memory.ts:161-166）；sequence 十进制字符串进位无 number 算术（memory.ts:36-50，直测 identity.test.ts:79-96 含 2^53 邻域）；丢弃消耗 sequence 诚实 gap（assemble 先分配，line-budget.test.ts:72-81 锚）；exhausted 边界语义（分配到 max 的仍接纳、后续丢弃+计数+事件抑制，identity.test.ts:98-122 ✓ 与 SA2 R2.2 裁决一致）；CRC32C 参数与 KAT（crc32c.ts:12-29，`"123456789"→e3069283` + 增量向量测试绿）。
- **§8 健康面**: 词表 8 type + reason 两值（health.ts:22-53）；issuePaths 首 10、`$.a.b[0]` 形式、跳根级空路径（memory.ts:287-296 + formatIssuePath:388-396）；`ValidateIssue.message` 整体丢弃（对比 `packages/vfsl/src/validate.ts:27` 的 40 字符值预览——禁入面已封）。
- **R3 复制隔离**: `canonicalResult` 对 updateBytes `slice()`（pipeline.ts:120-136），emit 后变异原数组不影响已接纳 record（emitter-isolation.test.ts:111-120：变异后 base64 解码仍 '123456789'）✓；plain-data snapshot 维持深冻结（deepFreeze pipeline.ts:35-45，typed array 跳过的理由注释准确）✓。

### 2.2 schema 冻结纪律（item 2）

- 逐字符：独立脚本提取设计 §3.3 ```` ```vfsl ```` 围栏内容 + 尾随 `\n`，与 `RECORD_SCHEMA_TEXT`（经 tsx 求值模板插值后）比对——**7040 字符 equal, firstDiff=-1**（含模板内 `` \`.\` `` 转义求值后与设计 `` `.` `` 一致）。
- 单源插值：schema.ts:30-222 全部 Pattern 经 `schema-patterns.ts` 常量插值（P_* 十常量零反斜杠，grep 无字面量重复）；TS 侧 intake 用 `RE_*` 同源 RegExp 副本（schema-patterns.ts:44-52）。
- 指纹钉死：`compileSchemaEnvelope(RECORD_SCHEMA_ENVELOPE)` 本机复现 `sha256:v1:dedad2ab93d9df9224960ca094924168f8bcc1c0512dfdd0a03dc6e66613e070` === `FROZEN_ENVELOPE_FINGERPRINT`（helpers/base.ts:29-30）且 schema-freeze.test.ts:26-29 钉死。`getRecordSchemaCompilation` 模块级单次缓存（schema.ts:237-249，同引用断言 vfsl-gate.test.ts:42-43 ✓）。
- SA6 §3.2 实测发现的 P_BASE64 空串引擎行为差异（vfsl 引擎接受 `''`）已被 empty-update 前置守卫结构性规避（memory.ts:210-214；坏 Base64 测试用例改 5 字符无 padding）——不构成本包缺陷，属 vfsl 引擎语义备案。

### 2.3 ADR 符合性抽查（item 3）

- **emit 任何路径不 throw**：全 throw 站点审计——canonical-json/input/issues 的 throw 全部位于 projectInput/projectIssues 内，被 pipeline emit 顶层 try 收编（pipeline.ts:275-287）；`TruncationBudgetBelowMarker` 同；memory append/appendFinal 各有 catch-all（memory.ts:314-329/333-347）；safeNotify 双层 catch（health.ts:79-94）；`observedAtFrom` 的 throw 在 producer 侧、emit 之前（设计 §4.4 明文豁免）；`testing.injectFinalRecord` 的 throw 仅测试子路径（testing.ts:56-60）。`records()`/`stats()` 无 getter 面可抛（队列元素为冻结普通对象；injectFinalRecord 的敌意 proxy 在 measure/VFSL 阶段已被 catch）。✓
- **健康事件零敏感字段**：事件构造点全集（pipeline.ts 5 处、memory.ts 4 处）逐字段比对 §8.2 白名单——无 record/input/Base64/update bytes/message/stack/streamId/namespaceId；vfsl-gate.test.ts:104-108 白名单键集断言 + 只带 issuePaths（无 message）断言（82-101）双锚。✓
- **VFSL 校验失败只走健康面**：memory.ts:280-300 丢弃 + 事件 + `countDrop('vfsl-validation-failed')`，无 throw、无队列写入。✓
- **drop newest 保序不挤占**：memory.ts:302-309 满员丢弃新到者，已接纳不动；drop 绝不入队（memory-adapter.test.ts:42-53 显式断言）。✓
- **业务零耦合**：新包无任何 caller（设计 §14 grep 为空复核成立）；root package.json 仅 typecheck 追加。

### 2.4 测试逃逸（item 4）

SA3 §3.3 四处基础设施改动逐一复核：

| 改动 | 复核结论 |
|---|---|
| base.ts 3 处 `'../src/'`→`'../../src/'` | 真路径错误修复（helpers/ 在 test/ 下一层）；无断言影响 |
| identity.test-d.ts 补 `AttemptResult` import | 必要（原文件用了未导入类型）；无断言影响 |
| test-d 两处值形式→纯类型形式 expectTypeOf | 类型机制修正（值形式对异形成员联合必失败，仓内 vfsl-protocol 先例同款）；产生 2 处同义反复（nano-1），契约力由相邻 @ts-expect-error 承担，净覆盖未丢 |
| `base.result` 断言改 `Extract<AttemptResult,…>` 形式 | 等价锚（该成员恰为单键形状，identity.test-d.ts:63 语义保留） |
| `@ts-expect-error` 移至 base64 属性行 | TS2353 报错位置修正（独立复现成立） |
| vfsl-gate badRecords `DiagnosticChangeRecord[]`→`unknown[]`+cast | 必然类型错误（词表外字面量不可赋值封闭类型）；运行时注入语义不变 |

- **断言弱化扫描**：无 `readFileSync`+源码字符串断言（§1.7 禁令零命中——全部 toMatch/toContain 均为运行时值断言）；红灯→绿灯翻转路径全部经由 src 实现（SA6 红灯报告 exit 1 → 本轮 exit 0）。
- **实现特判测试输入**：未发现（U+2026 特判针对设计钉死常量而非测试专属输入，见 C-4）。

### 2.5 切片纪律（item 5）

- 实际 diff 文件集 = ALLOW LIST 精确匹配：包内 17 src + 12 test + 2 helper + package.json + tsconfig.json + README + AGENTS（文件名/职责与 §12 清单一一对应）；`node_modules/` 已被 gitignore（`git check-ignore` 实证）。
- `pnpm-lock.yaml`：+16 行且**仅** `packages/namespace-diagnostic-log` importer 段（vfsl link + @types/node/typescript/vitest 解析复用既有版本，无版本漂移）——R2/G-b1 口径满足，`--frozen-lockfile` 可过。
- 根 `package.json`：仅 typecheck 一行追加（diff 1 行）。
- `CONTEXT.md`：+12 行 = 恰 3 新词条（语义 emission/storage projection/genesis baseline record），update-omitted 三 reason 词表收录在 emission 词条说明行（R2/A-c2 ✓）；无既有词条改动。
- BLACKLIST（package-lock.json/yarn.lock/.DS_Store/TASK.md/.bak）：零命中。wiki/raw/ 工件属白名单豁免。

### 2.6 工程质量（item 6）

- strict TS：包 tsconfig extends base（`strict`+`exactOptionalPropertyTypes`+`noUncheckedIndexedAccess`）→ 包级 tsc exit 0；根 `pnpm typecheck`（11 包链含新包）exit 0。
- 绑定面收口：grep 实证 `node:crypto` 仅 `digest.ts:10`、`Buffer` 仅 `carrier.ts:22`（其余命中均为注释）；memory.ts 字节计量用 `TextEncoder`（utf8Length，memory.ts:52-55）与 §5.5 Buffer.byteLength 对合法字符串字节等价。
- 模块头注风格：与仓内先例一致（clock/index.ts、vfsl/sha256.ts 同款「定位+依据+issue/ADR 引用」头注）。
- README/AGENTS 三段式与实际行为一致（容量公式 `capacity × lineBudgetBytes`、配置默认值逐项与 memory.ts:161-166 相符）；唯一措辞 nano 见 nano-2。

### 2.7 死代码/不可测分支（item 7）

| 分支 | 测试锚 | 判定 |
|---|---|---|
| schema-compile-failed failed 模式（§9.6/R2-F-c1） | vfsl-gate.test.ts:165-204：坏 envelope → 构造期恰一次事件（issueCount>0）+ 2 次 emit 全丢弃（droppedTotal=2）+ 无逐条 record-dropped + 内建缓存无串扰；196-204 独立实例互不影响 | 锚定 ✓ |
| sequence exhausted 模式（§9.10/R2-A-c1） | identity.test.ts:98-132：预置 …51614 → 一次 append 得 max（接纳）→ 再 append 丢弃 + `droppedByReason['sequence-exhausted']`=1 + 无事件 + 不 throw | 锚定 ✓ |
| fallbackLog 最后防线（§9.11/§8.3） | observer-isolation.test.ts:67-87：observer 与 fallbackLog 都 throw → emit 仍不 throw（fallbackCalls=1）+ 后续合法 emission 照常接纳 | 锚定 ✓ |

---

## 3. skill 立法项核对

- **§1.1 Scope Creep Guard**: 设计 §12 ALLOW/DENY LIST 存在；actual − allow 经白名单豁免后为空；BLACKLIST 零命中 → pass。
- **§1.3/1.4 spec/vitest 触发性**: 12 个 `*.test.ts` 落在根 `vitest.config.ts` include `packages/*/test/**/*.test.ts`；`*.test-d.ts` 落在 typecheck include；CI `pnpm test`（ci.yml Test 步）+ `pnpm typecheck`（Typecheck 步，根 package.json 已追加新包）双接通 → pass。
- **§1.5 协议假设**: 设计 §13 章节在、6 条假设均有源码/文档依据；本轮独立重验最承重一条（compileSchemaEnvelope 对冻结文本可编译且指纹确定）→ pass。
- **§1.6 契约改动连锁**: 无既有函数签名/throw 契约改动（纯新增包 + typecheck 追加），零 caller → N/A。
- **§1.7 源码 GREP 断言禁令**: 测试零命中反模式 → pass。

---

## 4. 审核结论（skill 模板八项）

1. **设计一致性**: ⚠️ 偏离（C-1/C-2/C-3/C-4/C-5 五项类型面/记账口径偏离，全部已披露、均需 R4 追认；运行时数据流/失败隔离/投影算法逐节对齐成立）
2. **读写路径一致性**: ✅ 一致（单写者内存队列；records()/stats() 读即写侧同一冻结对象；无第二数据源）
3. **静默失败**: ✅ 无（唯二静默点均为设计明文：fallbackLog 最后防线空 catch、非对象 context 丢弃 [nano-3，设计未定义形状]；其余全部失败路径有事件+stats）
4. **降级方案**: ✅ 安全（input→digest 降级、unavailable 降级、update-omitted 三 reason 均为 ADR/design 明文路径且测试锚定；无虚假降级——快照契约违反配事件与单触达探针）
5. **极端攻击**: ✅ 安全（敌意 getter/Proxy/非 JSON 值/稀疏 hole/超深嵌套/循环引用[节点护栏+RangeError 收编]/0 字节 update/超限 update/uint64 邻域 全部有确定性去路且被测试驱动；未发现新漏洞）
6. **错误处理**: ✅ 完整（§4.2 表逐行有实现+事件+测试；emit/append/records/stats 无 throw 逃逸）
7. **架构评估**: ✅ 可行（无绕行架构约束的硬编码/FIXME；语义/物理投影切分干净，#152 复用面清晰）
8. **过度设计**: ✅ 精简（17 文件各有单一职责，无投机抽象；体量与冻结契约+adapter 的规格复杂度相称）

## 5. 动态审核重点（交 SA7）

1. **CI 全链路动态证据**：`pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm test` 在 PR CI（node 20/24 矩阵）的真实通过日志（`gh run view`）；本机已复现全仓 1557 测试绿 + 双 tsc 0，CI 侧需留痕。
2. **指纹可复现性**：干净 checkout 上 `getRecordSchemaCompilation().envelopeFingerprint === 'sha256:v1:dedad2ab…'`（SA7 环境独立复算一次，防 worktree 本地状态干扰）。
3. **性能量级**（静态不可证）：默认 digest 策略下大快照（数百 KiB）emit 的同步 CPU 延迟；1M 节点护栏边界的栈深度行为（RangeError 收编路径）。设计承诺「emit 不阻塞」指无 IO/await——CPU 量级建议 SA7 抽测留档。
4. **C-4 触发演示**（可选）：`'…'.repeat(2048)` message 经 emit 后 record 的实际 JSONL 字节 > 4096（本报告已静态实测 6144B），供 R4 勘误决策参考。

## 6. 总体结论

**放行（pass）——进入 SA5 验收与 SA7 动态验证。**

- 7 项审查 5 pass / 2 concern 落点（item 1 的 concern 由 C-1…C-5 构成；item 6 仅 nano）。无 blocker：未发现测试逃逸、切片越界、静默失败、throw 逃逸、规格违背类问题；152/152 契约测试 + 全仓 1557/1557 + 双 tsc 0 在本机独立复现。
- 5 项 concern 全部属「实现/测试联营后偏离冻结文本，需设计追认」：**建议总控开 R4 轻量勘误批**（C-1 事件类型面追认、C-2 records() 口径注记、C-3 originalCount presence 补文、C-4 U+2026 记账二选一 [推荐 14B 精确基准]、C-5 operation 可选化）——均为文档/常量级改动，不动摇已冻结 schema 指纹与任何运行时行为，可并入 #149/#152 接线前的设计维护轮。
- 回流目标汇总：C-1/C-2/C-3/C-5 → SA1（R4 追认）；C-4 → SA1+总控（勘误决策）+ SA3（若选 14B 方案则改 `issues.ts:47`+两处测试常量）；nano-2 → SA3（AGENTS.md 措辞）；nano-4 → SA3（testing.ts 文档）。
