# SA2 攻击评审报告 — `@nomicore/replication-protocol` v1 codec 设计

**Date**: 2026-08-27（R0 评审 + R1 重审，同 session 续传）
**Verdict**: R0 → **reject**；R1 重审 → **pass**（5 项攻击点全部落实并经独立复核，1 条 INFO 级观察不阻塞。当前生效裁决见文末「R1 重审节」）

- 被审对象：`wiki/raw/task_replication-protocol-v1-codec_design.md`（R0，687 行，全量读取）
- 攻击基准：任务简报 AC1–AC6 + `docs/protocols/instance-replication-v1.md`（587 行全量读取，唯一 wire 权威）+ `wiki/raw/task_replication-protocol-v1-codec_relevant_decisions.md`（ADR 约束基准）+ SA6 红灯测试 9 文件 + fixtures.ts（全量逐行读取）
- SA8 前置裁决沿用：D-1（自研读路径）no-conflict 解释、manifest 组合锁属 SA2 领地等专项裁决不重复争点（`task_replication-protocol-v1-codec_design_conflict_report.md` verdict=clear）
- 简报声明「§15 test-d 问题已由 SA6 修订完毕」已现场复核：`codec-api.test-d.ts:87` 现为 `expectTypeOf<ProtocolError>()` 类型实参形式，不再列为攻击项

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议修订 |
|---|--------|--------|---------|---------|
| 1 | **CRITICAL** | 红灯测试基线可实现性（design §12/§14.4/§18） | **`codec-fuzz-property.test.ts` 的 property roundtrip 块与 `codec-malformed.test.ts` 的 nonce 规则互斥，红灯套件按当前状态不可全绿**。`randomMessage()`（test:95-138）case 0/case 1 用 `randomBytes()`（长度 ∈ [0,63] 随机）生成 HELLO/HELLO_ACK 的 `connectionNonce`，而 §7.1/malformed 测试（`codec-malformed.test.ts:388-427` encode 侧 15/17 必拒、`:214-225` decode 侧 15/17 必拒）+ 规范 §6.1「固定 16 bytes」要求恰 16。确定性模拟（mulberry32 seed 0x99aa，完整复刻 rand 消耗序：pick + randomBytes 的 1+len 次 + case 2/4/9/18 各 1 次）：**300 轮中共 32 次 nonce 抽取，全部 ≠16 字节**（i=4 即首爆：36 字节；i=11 恰为 15、i=142 恰为 17——正是 malformed 测试锚定必拒的长度）。任何实现二选一必挂另一侧：接受非 16 nonce → malformed 测试红 + 违反规范；拒绝 → property 测试第 4 轮即抛 `MALFORMED_FRAME` 未捕获而红。SA1 在 §15 抓到了 test-d:85 的同类问题（无法由任何实现满足的断言），但漏掉了这一处；设计 §12 将该测试映射为「§5.2（D-1）/§7.2 已满足」、§14.4 断言「9 文件应全绿」均为**错误声明**。 | 设计 R1 必须追加 §15 同类的阻塞报告：(a) 明确登记该矛盾及确定性复现（模拟命令+32 次抽取清单）；(b) 给出 SA6 侧修正建议——`randomMessage` 的 HELLO/HELLO_ACK 改用固定 16 字节 nonce（如 `Uint8Array.from({length:16})`），`randomBytes()` 保留给 snapshot/stateVector/update（无长度规则字段）；(c) §12 fuzz 行与 §14.4 的「全绿」声明改为「除该已登记阻塞点外」；(d) 走与 test-d:85 相同的总控授权流程（SA6 owned 文件，SA3 不得代改）。 |
| 2 | **MEDIUM** | §10 limits 启动校验的算术正确性（规范 §17 公式保真） | `PROTOCOL_OVERHEAD_BYTES = 64`（§3/§10，注释「20 头 + ns varString 36 + 长度前缀余量」）**低估了带 rid/多 varUint 字段消息的真实协议开销**：BOOTSTRAP_SNAPSHOT 最小开销 = 20 头 + ns varString(1+35) + rid varString(1+32) + epoch varUint(1) + snapshot 长度前缀(1) = **91 字节**（epoch/长度前缀最大 7/5 字节时达 101）；SYNC_STEP2 = 20+36+5+5+5 = **71**。后果：配置 `{maxFrameBytes:1000, maxBootstrapBytes:936}` 通过 `validateCodecLimits`（936 ≤ 1000−64）绿灯放行，但运行时 encode 936 字节 snapshot 的帧 = 1028 字节 > 1000 → `FRAME_TOO_LARGE`。「启动响亮验证」没有兑现它声称保证的不变式（字段级限额与帧级限额一致性），规范 §17 的公式是 `maxBootstrapBytes <= maxFrameBytes - protocol overhead`，设计代入的 overhead 常量与自身 wire 格式不符。失败仍是 loud（非静默降级），故定 MEDIUM 非 CRITICAL。实测确认 `PROTOCOL_OVERHEAD_BYTES` 未被任何红灯测试钉死（grep 零命中），修正自由。 | `PROTOCOL_OVERHEAD_BYTES` 提为 ≥ 96（覆盖 BOOTSTRAP 最坏 101 取整至安全值，或直接 128 保守），并在 §10 注明逐消息最坏开销的推导（BOOTSTRAP_SNAPSHOT 为最贵消息）。同步修正 §3 常量注释的算术（20+36+33+1+5+…，不是 20+36+8）。 |
| 3 | LOW | §4.2/§11.2 Buffer-free 边界的输入侧 | `decodeFrame` 返回 `bytes.subarray(20)`：若调用方传入 Node `Buffer`（Buffer 是 Uint8Array 子类，§4.3.c 的 `instanceof` 检查放行），`payload` 视图原型为 `Buffer.prototype`——与 §11.2「输出原型恒 `Uint8Array.prototype`」的字面承诺冲突（自产输出无此问题，红灯不受影响；但 ws-replication 在 Node 侧极可能喂 Buffer 进来，契约措辞会误导调用方依赖原型判断）。 | 二选一并写入设计：(a) JSDoc 明示「payload 视图的原型跟随输入 buffer，调用方不得以原型做 Buffer 嗅探」；或 (b) 规定 decode 路径对输入做 `new Uint8Array(bytes)` 规范化（放弃零拷贝，不推荐）。推荐 (a)，保持零拷贝。 |
| 4 | LOW | §9 ProtocolError 兜底语义未闭合 | 构造器「两表皆无 → connection/INTERNAL_ERROR 兜底」未指明 `this.code` 保留原字符串还是替换为 `'INTERNAL_ERROR'`。若替换，fuzz 的 `ALL_ERROR_CODES.has(err.code)` 仍绿但原始 typo 只活在 message 里，弱化了「错误码 ∈ 注册表」不变式的可测试性；若保留，`err.code` 将是未注册字符串。 | 明确写死：兜底路径 `this.code` 保留调用方原字符串（message 已含原码），并在 §9 注明该分支只应被编程错误触达、出现即为 SA3 缺陷信号（保持 loud，不构成降级）。 |
| 5 | INFO | §15 行号漂移（非阻塞） | 设计 §15 引用 `codec-api.test-d.ts:85`，SA6 修订后实际为 :87（类型实参形式已落地，现场复核通过）。R1 修订时顺手更正行号引用即可，避免 Phase 4 复核困惑。 | 行号更正 + 标注「已由 SA6 2026-08-27 修订轮解决」。 |

**未成立的攻击（已验证排除，供 SA3/SA4 免重复排查）**：

- 「canonical 判据不完整」不成立：无符号 LEB128 中间补零必改变位权（唯一保值的加长形式是末尾补 0x00），故「多字节且末字节为 0 ⇔ 非最短」是完备判据；8 字节上限 + `> MAX_SAFE_INTEGER` 拒绝的边界舍入分析（2^53 邻域 ulp=2，舍入不会跨越 MAX_SAFE_INTEGER 向下漏放行）均通过推导复核。
- 「fatal TextDecoder + ignoreBOM 破坏 roundtrip」不成立：overlong/surrogate/截断/超范围 UTF-8 均 fatal 拒绝 ⇒ 接受集 ⊆ canonical；BOM 按 U+FEFF 内容保留并逐字节还原。R6（lone surrogate encode 侧拒绝）正确封死了 TextEncoder U+FFFD 替换的静默路径。
- 「fixtures 9 步与设计第 9 步冲突」不成立：fixtures.ts:17-31 的第 9 步是 payload 级违规；设计把 expectedSequence 插在长度校验后、payload 解析前，红灯唯一锚点（`codec-envelope.test.ts:155-161`）只用合法帧，无优先级冲突；规范 §3 line 58 只要求「复制/分配 payload 前」完成检查集合，不约束枚举次序。
- 「golden/注册表与规范有出入」不成立：17 消息表、17+20 错误表、wsCloseCode、ACK_TIMEOUT 唯一非 fatal、INTERNAL_ERROR 双表元数据，均与规范 §5/§13.1/§13.2 及 fixtures 逐格一致；18 个 golden 的 hex 已抽样手工反解（HELLO/GOAWAY/ERROR×2/OPEN×2/UPDATE 等）与 lib0 canonical + §3 头逐字节吻合。
- 「F4–F7 lib0 实证不实」不成立：已现场核对 `lib0@0.2.117` 源码（string.js:98 fatal TextDecoder + Safari polyfill 回退；decoding.js:105/122 越界 `new Uint8Array` RangeError、:188-197 NaN→0 静默、:245-265 无最短形检查；encoding.js writeVarUint 最短 LEB128/writeUint32BigEndian/writeVarString 走 TextEncoder.encodeInto，无 Buffer 触点）。
- 「工程接线声明有假」不成立：root typecheck 链 9 包逐包列举（F11）、vitest include/typecheck include 自动覆盖、`tsconfig.typecheck.json` include 覆盖 `.test-d.ts`、`@types/node@20.19.43` 经 pnpm store 解析（`tsc -p packages/clock` 实跑通过，同形态 include src+test + node:fs 测试导入无碍）、lockfile yjs@13.6.32/lib0@0.2.117（F8）均核实。
- 「API 导出面缺口」不成立：9 个测试文件 import 的全部名字与设计 §3 导出清单一一对照无缺漏。
- 并发/状态攻击面：模块级仅冻结常量 + 无状态纯函数 + 共享 TextDecoder（无 `stream:true` 时 decode 无状态），无可利用竞态。

## 协议假设依据审查

- **章节存在性**：§16 存在，覆盖 lib0 四项行为、版本组合兼容、自引用解析、test-d 复现、工程接线，并明示「本设计无 HTTP/WS 端点、端口、进程时序类假设」（对纯 codec 成立）。
- **依据可验证性**：全部依据带源码引用（精确到 `node_modules/.pnpm/lib0@0.2.117/...` 行号，SA4 可直接重跑 grep/read）、registry 实测（`npm view y-protocols@1.0.7` 输出deps/peer）、设计期实测（vitest run 20 passed、TS1361 最小复现输出）。SA2 已抽样重放 lib0 三处源码引用，全部命中。
- **「应该/通常/预计」类无据推断**：grep 零命中。
- **结论**：§16 本身合格。但注意——§16/§12 的「红灯可满足性」论证存在 #1 号漏洞（property 测试未纳入可实现性核验），这正是本次 reject 的核心：依据审查合格 ≠ 红灯基线可实现性审查合格，后者是 SA1 本次遗漏的维度。

## 错误处理链路审查

本票为纯 codec 库（无 UI/无异步任务），「调用方」= ws-replication 与测试；按 codec 语义映射四项检查：

- **静默失败**：无。全部失败路径（帧级 9 步、payload 级 R1–R10、encode 输入校验、limits 校验）收敛到唯一异常类型 `ProtocolError`（code ∈ 注册表）；lib0 只出现在写路径且输入预验证；TextDecoder throw 被捕获映射 `MALFORMED_FRAME`。lib0 解码侧三处静默/未分类行为（非最短 LEB128 接受、RangeError、NaN→0）已被 D-1 完全绕开（源码复核确认其真实性）。
- **状态闭环**：N/A（无持久状态；注册表深冻结，`Object.isFrozen` 断言表+条目、写入 throw 均有红灯锚定）。
- **降级路径**：无运行时 clamp（§10 与规范 §17「不得运行时 clamp」一致）；`resolveMaxFrameBytes` 非法值 → `CONNECTION_POLICY_VIOLATION`（响亮）。#2 指出该响亮验证的算术基线错误（放行了会运行时 FRAME_TOO_LARGE 的配置）——失败仍 loud，故非静默降级而是「验证不等式失真」。
- **虚假降级识别**：未发现伪降级。ProtocolError 构造器 INTERNAL_ERROR 兜底是防御性 loud 路径（#4 要求补语义闭合）；R6 lone-surrogate encode 拒绝是正确方向的硬断言；OPEN identity 成对律、ERROR 注册表 bits 一致性均为硬断言无吞没。正常路径前提缺失未被当作降级处理。

## 红灯测试思路

1. **（对应 #1，CRITICAL）** SA6 修正后防回归：property 生成器元测试——对 mulberry32(0x99aa) 全 300 轮断言每次 HELLO/HELLO_ACK 的 `connectionNonce.byteLength === 16`（或在生成器内联 `assert(length===16)`）；同时保留「malformed：encode/decode nonce 15/17/36 → MALFORMED_FRAME」两侧对照，锁死「恰 16」契约不再被任一侧软化。修真完成前，SA3 验收命令预期结果应改写为「8 文件绿 + fuzz-property 1 文件红于已登记阻塞点」。
2. **（对应 #2，MEDIUM）** 配置假绿灯 IT：`validateCodecLimits({maxFrameBytes:1000, maxBootstrapBytes:936, …})` 当前设计下应抛 `CONNECTION_POLICY_VIOLATION` 却不抛；随后 `encodeMessage(BOOTSTRAP_SNAPSHOT{snapshot:936B}, {maxFrameBytes:1000})` 抛 `FRAME_TOO_LARGE`——两步组合即证明「启动绿灯 + 运行时红灯」失真。修正 OVERHEAD 后第一步必须变红（loud 拒绝该配置）。
3. **（对应 #3，LOW）** `decodeFrame(Buffer.from(frameHex,'hex'))` → 断言 `decoded.payload` 的处置与设计承诺一致（文档化原型跟随，或规范化为 Uint8Array.prototype——取决于 SA1 选型）。
4. **（对应 #4，LOW）** 单测：`new ProtocolError('TYPO_CODE' as never)` 的 `err.code` 行为与设计写死条款一致（保留原串），且 `.toThrow` loud。

## 结论

设计主体（envelope 9 步、D-1/D-2/D-3/D-4、注册表移植、协商纯函数、limits 机制、纯包边界、§16 依据）在破壁审查下**全部站得住**，SA8 的 ADR 一致性裁决未见被推翻。但 #1（红灯套件存在任何实现都无法满足的互斥断言，且设计的「9 文件应全绿」核心声明为假）达到 reject 门槛：SA1 必须出 R1——登记 fuzz-property nonce 阻塞点（§15 同类流程）并修正 §12/§14.4 声明，同时落实 #2 的 `PROTOCOL_OVERHEAD_BYTES` 修正。R1 只需覆盖上述窄面，无需重构。#3/#4/#5 随 R1 一并落实。

**Verdict: reject（待 R1 修订后重审；重审范围限定 #1/#2/#3/#4/#5 的落实情况）**

---

# R1 重审节（2026-08-27，SA2 同 session 续传）

**重审范围**：R0 声明的窄面——#1–#5 在设计 R1（733 行）与 SA6 测试侧 R2 的落实情况。R0 已验证排除的攻击面（canonical 判据、UTF-8 roundtrip、9 步顺序、注册表、工程接线、API 导出面、lib0 实证）不重复展开，仅对新引入文本做风险扫描。

**被审对象**：`wiki/raw/task_replication-protocol-v1-codec_design.md`（R1，733 行，重点章节全量重读：§0 F10/F12、§3、§4.2 D-5、§9、§10、§11.2、§12、§14.4、§15.1/§15.2、§16、§18、SA2 回应表）+ `packages/replication-protocol/test/codec-fuzz-property.test.ts`（SA6 R2 修正后 203 行全量重读）。

## 逐项复核结论

| # | R0 要求 | 落实 | 独立复核证据 |
|---|---------|:---:|-------------|
| 1 | CRITICAL：登记 fuzz-property nonce 互斥阻塞（含确定性复现）+ SA6 修正建议 + §12/§14.4 改写「全绿」错误声明 | ✅ | **设计侧**：§15.2 新增完整阻塞登记——矛盾双分支论证、SA1 独立复现（与 SA2 模拟逐数字吻合：32/32 nonce ≠16、首爆 i=4/36B、i=11/15B、i=142/17B）、SA6 修正建议三条（固定 16 字节 nonce / randomBytes 留给无长度规则字段 / 元断言防回归）、处置流程与「SA3 不得代改、不得放宽」明令；§0 F12、§12 fuzz 行警示、§14.4 两阶段预期改写、§18 ALLOW LIST 登记，全部到位。**测试侧（SA6 R2，SA2 现场核实）**：`fixedNonce()`（:99）固定 16 字节且不消耗 rand，case 0/1 改用之（:102/:104）；`randomBytes()` 仅留 case 10/13/14/17；防回归元测试（:161-175）用独立 seed 实例断言全部 HELLO/HELLO_ACK nonce 恰 16 且 `helloDrawn > 0` 防空真。其余断言块（800×2 fuzz、golden 变异、property 主测试逻辑）逐行比对**未弱化**。**SA2 重新模拟修正后生成器**（`node /tmp/sim_r2.mjs`，完整复刻新 rand 消耗序）：300 轮 HELLO×13 + HELLO_ACK×16 共 29 次 nonce 抽取全部恰 16 字节，其余随机字段（drainTimeoutMs ∈ [0,99999]、ERROR code 索引、ackedSequence ∈ [0,999]、随机字节载荷）零非法抽取——**互斥消除，修正后 property 测试在合法实现下可绿，无新引入矛盾**。 |
| 2 | MEDIUM：`PROTOCOL_OVERHEAD_BYTES` 64→≥96/128 + 逐消息最坏开销推导 + 修正 §3 注释 | ✅ | 常量 64→**128**（§3:96、§2:68、§10:509 三处一致）；§10 新增推导表逐格算术复核无误：BOOTSTRAP_SNAPSHOT 最坏 20+36+(1+32)+8+5=**102**、SYNC_STEP2 71、UPDATE 61、最小 91。**SA1 对 SA2 R0 推导的修正成立并采纳**：epoch varUint 最坏应取 8 字节（MAX_SAFE_INTEGER=2^53-1 需 ceil(53/7)=8 字节，7 字节仅到 2^49-1），SA2 R0 的 101 少算 1 字节，SA1 重算 102 正确。128 ≥ 102 余量充足；假绿灯反例 `{1000,936}` 修正后 936 > 1000−128=872 被 `validateCodecLimits` 响亮拒绝；常量未被任何红灯钉死（SA2 R0 grep + SA1 复核双重确认），修正零测试影响。 |
| 3 | LOW：Buffer 输入原型泄漏——文档化或规范化 | ✅ | §4.2 新增决策 D-5：选文档化（保零拷贝，SA2 推荐项 a），明示 payload 视图原型跟随输入、调用方不得以原型嗅探；§11.2「输出原型承诺的准确边界」同步改写——自产输出（encodeFrame/encodeMessage 结果 + decodeMessage 字段 bytes，`readVarUint8ArrayCopy` 精确拷贝）恒 `Uint8Array.prototype`，唯一例外即 decodeFrame 视图。措辞与红灯断言实际覆盖集合（fuzz/package-contract 的原型断言输入均为自产或 plain Uint8Array）精确一致，无过度承诺。 |
| 4 | LOW：ProtocolError 兜底 `this.code` 语义写死 | ✅ | §9 构造器注释：兜底路径 `this.code` 保留调用方原字符串 + 理由（保住「错误码 ∈ 注册表」不变式的可测试性）+「运行期触达兜底即为 SA3 缺陷信号（loud，非降级）」。闭环。 |
| 5 | INFO：§15 行号漂移更正 | ✅ | §15.1 更正为 :87 并标注闭案；§0 F10、§16、§12 同步。SA2 R0 已现场复核该修正（`codec-api.test-d.ts:87` 类型实参形式）。 |

## 独立验证记录（本次重审执行）

1. **红灯基线实跑**：`pnpm exec vitest run packages/replication-protocol`（worktree 根）→ `Test Files 9 failed (9) / Tests 7 passed (7) / Type Errors no errors / Errors 14 errors`——全部为 `@nomicore/replication-protocol`（8 处）与 `yjs`（1 处，version-interop）的 module-not-found 级联，无任何断言级失败，与 SA6 R2 声明及任务简报红灯基线一致（EXIT 码显示 0 系管道 tail 吞掉，状态行 9 failed 为准）。
2. **SA6 R2 修正后生成器全量合法性模拟**：`node /tmp/sim_r2.mjs` → 29 次 nonce 全 16 字节、0 非法抽取（输出内嵌上文 #1 行）。
3. **R1 新文本风险扫描**：§15.2 复现数字与 SA2 独立模拟一致；§10 推导表算术复核通过；D-5/§11.2 措辞与红灯断言覆盖面精确对齐；SA2 回应表 5 行的修订位置逐一现场核对存在且内容相符。未发现新引入缺陷。

## 遗留观察（不阻塞）

- **INFO-1**：§15.2 标题仍标【OPEN，待总控授权 SA6 修正】，而 SA6 R2 修正实际已落地并经本次重审复核——登记时刻状态与当前状态滞后。§14.4 的两阶段措辞已涵盖两种状态（「修正落地之前 8 绿+1 红于登记点 / 落地后 9 文件全绿」），不构成错误声明；建议 SA1 随 SA3 交付说明或下一版设计把 §15.2 状态标签更新为「已解决（SA6 R2 2026-08-27，SA2 R1 重审复核通过）」，与 §15.1 同款闭案格式。

## R1 重审结论

R0 的 5 项攻击点（1 CRITICAL + 1 MEDIUM + 2 LOW + 1 INFO）在设计 R1 中全部落实，落实质量经 SA2 独立复核（含确定性模拟与红灯实跑）确认；SA6 R2 测试修正消除互斥且无断言弱化；R1 新增文本未引入新缺陷。遗留 1 条 INFO 级状态标签滞后观察，不影响正确性与可实现性。

**Verdict: pass —— 同意放行（SA3 可按设计 R1 实现；pass 仅表示设计通过审查，不替代 SA4/SA7 对实现与活链路的后续验证）**
