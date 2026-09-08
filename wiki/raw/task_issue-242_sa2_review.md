# SA2 设计攻击评审 — issue #242：UPDATE_CHUNK codec 与 CAP_CHUNKED_UPDATE 协商（切片 1）

> 评审人：SA2（独立攻击评审）。本文件为 **iteration 2 复审**：原位更新 iteration 1 评审（reject：F1 BLOCKER + F2 MAJOR + F3/F4 MINOR + O2），核对 SA1 修订版设计（`wiki/raw/task_issue-242_design.md`，iteration 1 改写、364 行）与刷新后的四份证据 run。
> 复审焦点（dispatch 指定）：(a) F1「ws-replication 穷尽 switch 类型兼容」与 F2「可复现测试证据」是否真正解决；(b) 冻结 wire 值与 test-first 约束是否保持完好；(c) 对修订引入的新面做回归攻击。
> 评审日期：2026-09-08（dispatch iteration 2）。Issue 评论 REST 输入于 dispatch 前刷新为 `[]` —— **无 Owner 评论要求适用**（与任务简报 §Comments 为空、设计 §4 声明一致）。

## 1. Reviewed inputs

| 输入 | 状态 | 核验方式 |
|---|---|---|
| `wiki/raw/task_issue-242.md`（任务简报，Issue 正文 + 5 条 AC） | 已读 | 评论区为空，与 dispatch 刷新一致 |
| `wiki/raw/task_issue-242_design.md`（SA1 修订版，364 行，iteration 1 整体改写） | 已逐节读取 | §14 修订映射逐条对照 iteration-1 finding |
| `packages/replication-protocol/test/codec-issue242-ac-red.test.ts`（513 行，28 用例 + 3 向量） | 已全文逐行读取 | 用例计数（6+8+7+7=28）、golden 十六进制算术独立复算、F3 新用例定位（:402-411） |
| `wiki/raw/task_issue-242_ac_red.log`（432 行，R1+R1b） | 已全文读取 | 命令/原始输出/退出码三件齐；20F\|8P 逐名核对 |
| `wiki/raw/task_issue-242_ac_red_typecheck.log`（33 行，R2） | 已全文读取 | 21 错误逐条清点（:6-27，含 1 处折行），全部缺失 API |
| `wiki/raw/task_issue-242_regression.log`（681 行，R3+R4+隔离复跑） | 已读取摘要/头部/尾部与 Unhandled Errors 区 | 数字链复算（见 §4） |
| `docs/adr/0013-chunked-live-update-transfer.md` | 已读关键节 | 字段序/0x42/bit 0x1/错误码/reason/ACK 复用逐项比对 |
| `docs/protocols/instance-replication-v1.md` §9.4（:243-248） | 已读 | F4 修订的事实基础核验：现状确无闭集合词表 |
| 源码锚点（本次复审新核验）：`packages/ws-replication/src/{hub-connection,peer-connection,frame-io,hub-namespace,peer-namespace,error-mapping}.ts`、`packages/replication-protocol/src/{messages,errors,payloads,limits,constants}.ts`、root `package.json`、`vitest.config.ts`、`pnpm-lock.yaml:793` | 已读关键区段 | F1 影响面独立重推导（见 §3）；注册表 20 条/先例元数据/急切校验先例逐项验证 |
| 既有测试：8 个 `.test.ts` + `codec-api.test-d.ts` + `fixtures.ts` + `codec-fuzz-property.test.ts` randomMessage | 已读关键断言 | 139=132+7 复算；fuzz 17 分支枚举核验（ALLOW 必要性）；interop/malformed 无 0x42 锚点（不在 ALLOW 正确） |
| `git status --short` | 已执行（只读） | 恰 8 个未跟踪新增（红灯文件 + 7 个 wiki/raw），**零已跟踪文件修改** —— 与 §16「未实施树」声明一致 |
| `task_issue-242_sa6_contract.md` / `_relevant_decisions.md` / `_conflict_report.md` | 不存在 | 首次派发即如此；设计 §头已声明并给出替代证据链（§5/§6）——Feature 切片可接受 |
| Issue 评论（REST 刷新） | **空（`[]`）** | 无 Owner 要求适用 |

SA2 未运行任何测试/服务/临时进程（skill 纪律）；全部核验基于读取源码、日志与文档，以及手工算术复算。

## 2. Verdict

**approve**（无 BLOCKER / 无 MAJOR / 无新增 MINOR 阻断项）。

- **F1（原 BLOCKER）已解决**：DENY LIST 收窄为「两文件仅限 D-8 单 case 类型兼容分支」、§10 调用方矩阵改写、补丁语义定型（fail-loud 分类自镜像，拒绝 no-op 的理由成文）、root `pnpm typecheck` exit 0 列为 §12 AC5 与 §17-5 的独立证据项——iteration-1 开出的 4 项接受条件**逐条满足**；且 SA2 本次**独立重推导的影响面证实设计声称完备**：全仓对 `ReplicationMessage` 做穷尽 never 检查的调用点**恰好且仅有** `hub-connection.ts:791` 与 `peer-connection.ts:522` 两处（详见 §6）。
- **F2（原 MAJOR）已解决**：四份证据 run（R1/R1b、R2、R3、R4）全部内嵌精确命令 + 原始输出 + 退出码；R3 命令**无任何排除**且日志如实呈现红灯文件的 20 个失败与 21 个类型错误；iteration-0 的「未披露排除」缺陷已在 §16 如实披露；数字链内部自洽（147=139+8、139=132+7、Errors 21 ≡ R2 的 21、R4 22=20+2，详见 §4）。
- **F3/F4/O2（原 MINOR/非阻断）全部落实**：急切校验作用域定型并有可执行红灯用例钉死（本 iteration 实测红）；锚点笔误修正；「§9.4 首次定义词表」措辞与文档现状相符；O2 不可达性论证入 §13 残余表。
- **冻结 wire 值与 test-first 约束完好**（详见 §7/§11）：0x42 / bit 0x1 / 字段序 / 两错误码元数据 / `UPDATE_TRANSFER_EXPIRED` / envelope 恒定 / `UPDATE_ACK` 复用 / `maxUpdateBytes` 复用 / `PROTOCOL_OVERHEAD_BYTES=128` 不动，逐项与 ADR 0013 对齐；golden 算术独立复算全对；红灯契约在盘且真实为红（20F\|8P 双跑稳定 + 21 类型错误），零既有文件改动，§17 要求「契约不改即绿」。

`approve` 仅覆盖设计审查：实现正确性与活链路验证仍归 SA4/SA7；ADR 冲突复查按设计 §15 维持必要（本评审未发现其之外的新冲突维度，故不追加 `requiresConflictRecheck`）。

## 3. F1 复核（BLOCKER → 已解决）

iteration-1 接受条件逐条核验：

| # | 接受条件 | 修订证据（设计） | SA2 独立核验 |
|---|---|---|---|
| 1 | DENY LIST 为两文件增设窄例外 | §11 DENY：`packages/ws-replication/**` 收窄例外 = `src/hub-connection.ts` 与 `src/peer-connection.ts`「允许且仅允许 D-8 指定的 dispatchReady 单 case 类型兼容分支（含注释）」，其余全禁；§11 ALLOW 同步增两文件（预期改动列明 case 标签 + `connectionFatal` 调用 + `return` + 注释，其余零改动） | ✅ 表述闭环，无「零改动」残留矛盾（§1 非目标、§7 头部注记均改为「唯一例外是 D-8」） |
| 2 | §10 调用方矩阵两行改写 | §10 hub/peer `dispatchReady` 两行改为「类型兼容补丁（运行时不可达）」 | ✅ |
| 3 | 补丁语义二选一并写入设计 | D-8：采纳推荐项 a（`case 'UPDATE_CHUNK': this.connectionFatal('UNSUPPORTED_MESSAGE_TYPE', 1002); return;` + 不可达性注释）；D-9 #5 记录拒绝 no-op 的理由（静默丢数据违反 fail-loud 纪律） | ✅ 可编译性核验：两处 `connectionFatal` 均为 `private (code: string, wsCloseCode: number)`（hub:872 / peer:828），字面量实参可赋值；`'UPDATE_CHUNK'` 在联合扩容后为合法 case 标签；`1002 === wsCloseCodeFor('UNSUPPORTED_MESSAGE_TYPE')`（hub:1017-1023 默认分支，实测源码） |
| 4 | §17 转绿条件追加 root `pnpm typecheck` exit 0 独立证据项 | §12 AC5 (3) + §17-5 | ✅ root `package.json:13` 逐包 tsc 链含 `tsc -p packages/ws-replication/tsconfig.json`（实测）；包 AGENTS Verification 明示 wire 变更须 root typecheck + root test |

**影响面独立重推导（本次复审新增攻击）**：穷尽检查断裂面的完备性不能只信设计列举，SA2 对全仓重做了推导——

| 候选断裂点 | 类型 | 核验结论 |
|---|---|---|
| `hub-connection.ts:791` / `peer-connection.ts:522` `dispatchReady` 主 switch 的 `const never: never = message` | `ReplicationMessage` 穷尽 | **断裂**（联合 +1 后 default 窄化为 `UpdateChunkMsg` → TS2322）——即 D-8 两处，覆盖完备 ✅ |
| `hub-connection.ts:719` drain 过滤 switch | `default: break`（无 never） | 不断裂；UPDATE_CHUNK 落 default→break→主 switch 新 case ✅ |
| `peer-connection.ts:385-394` draining 过滤 | kind 不等式列表（无 switch 穷尽） | 不断裂 ✅ |
| `frame-io.ts:73` `namespaceFieldViolation` | `default: return undefined` | 不断裂；本切片 UPDATE_CHUNK 经 `decodeInbound` 缺省门控结构性不可达（见 O-C） ✅ |
| `hub-namespace.ts:988` / `peer-namespace.ts:1207` `applyOutcome(mapped: MappingOutcome)`、`error-mapping.ts:100`（refusalCode）、`hub-namespace.ts:255`/`peer-namespace.ts:715`（this.state） | **非** `ReplicationMessage` 联合 | 不受影响 ✅ |
| `packages/replication-protocol/src/payloads.ts:722`（encodePayload never）与 :644 decode switch、`messages.ts` `Record<MessageName,…>` 三表 | 实现目标本身 | 属 §11 ALLOW（messages/payloads），由实现自然扩容 ✅ |
| `apps/yjs-server/test/harness.ts:588` `send(message: ReplicationMessage)` | 参数类型消费（内部只调 `encodeMessage`） | 联合扩宽不破坏参数消费 ✅；`apps/yjs-server/src` 无 switch over message.kind（实测 grep） |

**运行时不可达性论证复核**：`decodeInbound`（frame-io.ts:58-67）只传 `expectedSequence/maxFrameBytes` → D-3 缺省 = 未协商 → `decodeMessage` 消息层对 0x42 先抛 `UNSUPPORTED_MESSAGE_TYPE` → hub `onMessage` catch（:605-617）/ peer catch（:360-372）`connectionFatal(code, wsCloseCodeFor(code))` → 1002 —— 与今天帧层「未注册」拒绝**同错误码、同 close code、同收口拓扑**。论证链每一环均实测源码成立 ✅。F1 **关闭**。

## 4. F2 复核（MAJOR → 已解决）

| iteration-1 接受条件 | 修订证据 | SA2 核验 |
|---|---|---|
| 如实披露精确可复现命令（含红灯文件的处理方式） | §16 重写：R1（`vitest run <红灯文件> --reporter=verbose`）、R2（`tsc -p packages/replication-protocol/tsconfig.json`）、R3（`vitest run --typecheck packages/replication-protocol`，**无任何排除**）、R4（`vitest run --typecheck` 全仓） | ✅ 四份日志各自内嵌命令 + 逐字输出 + 退出码（R1 exit 1 / R1b exit 1 / R2 exit 2 / R3 exit 1 / R4 exit 1 / 隔离复跑 exit 0） |
| 为三份（实为四份）证据 run 记录实际 exit code | 见上 | ✅ |
| 命令 ↔ 日志一致、无隐藏排除 | R3 日志头部即列出红灯文件 `28 tests \| 20 failed`（:11-59），既有 9 文件全绿（:60-68）；`Errors 21` 区（:416-653）为红灯文件 unhandled TypeCheckError，与 R2 的 21 错误同源同名 | ✅ 「红灯文件在盘且被执行，失败如实可见」成立；iteration-0 缺陷已披露（§16 第二段） |

**数字链独立复算**（日志间互证）：

- R3 `Tests 147 passed = 139（既有）+ 8（红灯文件通过锚）` ✅；`139 = 132 运行时用例（8+5+37+26+13+5+25+13，与 R3 逐文件计数一致）+ 7（codec-api.test-d.ts 类型工程）` ✅。
- R3 `Errors 21` ≡ R2 `tsc 21 errors`（同一文件同一符号集） ✅。
- R4 `Tests 22 failed = 20（红灯，预期）+ 2（stdin-error-chain-red 与 generate-cli-check 各 1）`；`Errors 23 = 21 + 2` ✅；两失败文件均为已跟踪文件（`git ls-files` 实测在册）、git status 零已跟踪修改、**隔离复跑 12/12 exit 0**（日志 :678-681）→ 「先在环境性抖动、非本任务回归」的归因有据，且 §13/§17-5 给出 SA3/SA4 判读规则并 DENY 顺手修改 ✅。
- R1 双跑稳定：20 失败用例名集合逐名一致（AC1×4/AC2×8/AC3×3/AC4×5 = 20） ✅；8 个通过用例均为跨翻转合法锚（iteration-1 §12 已逐个核验，本次抽验一致）。

F2 **关闭**。可复现性判据（「未实施树上按命令重跑应逐项复现日志」）在结构上满足：命令含环境变量、工作目录、无隐藏过滤器；SA2 依纪律不重跑，留 SA4 作实现后复核锚点。

## 5. F3 / F4 / O2 复核（MINOR 与非阻断 → 全部落实）

| Finding | 修订声称 | SA2 核验 |
|---|---|---|
| F3（校验作用域） | D-3 定型「急切」：对称 `resolveExpectedSequence` 先例（limits.ts:53-60 实测存在且确为 decodeFrame 全消息急切校验），拒绝惰性的理由成文（D-3 备选 (c)）；D-7 红灯契约 27→28 用例；§12 AC3 行更新 | ✅ 红灯文件 :402-411 新用例实测存在且本 iteration 真红（R1 日志 :44-46：`expected undefined to be an instance of ProtocolError`——选项不存在故被忽略，失败原因唯一指向缺失实现）；合法值 0 同帧正常解码的反向断言防假拒绝 ✅ |
| F4（锚点笔误 + D-5 措辞） | §2 左列改 `test/codec-envelope.test.ts:88-89`、ERROR 位推导锚点拆 `errors.ts:112-139` + `payloads.ts:257-339`；D-5 改「§9.4 **首次定义** reason 词表枚举」 | ✅ 实测：`codec-envelope.test.ts:88-89` 确以 0x42 为未注册样本；`payloads.ts:257-339` 确为 decodeError/encodeError 区段；协议文档 §9.4（:243-248）现状确为「稳定安全原因 varString」无闭集合——措辞与事实相符，SA3 不会被误导去找不存在的清单 |
| O2（旧实现收新错误码不可达性） | §13 残余表新增一行 | ✅ 论证与 iteration-1 SA2 推导一致 |

## 6. 需求覆盖（回归核验：修订未动摇任何 Issue 落点）

| Requirement（Issue 正文/AC） | Design section | Assessment |
|---|---|---|
| UPDATE_CHUNK 自描述消息（6 字段）编解码 + golden，字段序以 ADR 0013 为准 | §7 D-1、§8、§12 AC1 | ✅ 字段序与 ADR 0013 §消息形态逐字一致（namespaceId varString → transferId → chunkIndex → chunkCount → totalBytes → bytes varUint8Array）；3 向量 golden 算术独立复算全对：NS_HEX=0x23+35B；600→`d804`；2^22→`80808002`；0xffffffff→`ffffffff0f`（0xfffffffe→`feffffff0f`）；payloadLength 45/50/58=0x2d/0x32/0x3a（36+9 / 36+14 / 36+22） |
| HELLO 协商 CAP_CHUNKED_UPDATE bit（交集生效；envelope version/flags 不变） | §7 D-2/D-3、§12 AC3 | ✅ bit 0x1=ADR 冻结值；HELLO/HELLO_ACK codec 零改动（bit 经既有 uint32 BE 字段承载）；`selectCapabilities` 复用；AC3 对 GOLDEN[0] 的字段位置断言 [42,50) 经独立重算正确（14+12+8+8=42 字符处恰为 optionalCapabilities，golden 值 `00000000`） |
| 两个 namespace 错误码 + 一个 RESYNC reason（append-only） | §7 D-4/D-5、§12 AC4 | ✅ VIOLATION（fatal/no/failed）对齐 SYNC_STATE_VIOLATION、TOO_LARGE（fatal/config/failed）对齐 SYNC_DIFF_TOO_LARGE（errors.ts:121/124 实测先例元数据一致）；AC4 的 ERROR 位前缀断言与 payloads.ts encodeError 推导（`retryable !== 'no'` → bool）逐位相符；badBits 帧构造经布局核对确能到达 fatal 位不一致检查（scope+code+fatal+retryable+relatedMarker+nsMarker+NS_HEX+safeMessage） |
| 未协商端收 UPDATE_CHUNK 按未知消息码规则响亮关闭；只交付协议包能力 | §7 D-3/D-8、§9、§12 AC3 | ✅（类型层 + 运行时层双侧成立——F1 修订后不再有「零改动」矛盾） |
| AC1–AC5 | §12/§17 | AC1–AC4 有可执行红灯锚点且旧实现真实为红；AC5 验证命令清单明确（包级 ×2 + root typecheck + root test + 互通证据）且不再被阻断 |
| 目标/非目标无静默扩大 | §1 | ✅ 非目标唯一修订 = D-8 例外显式化（SA2 要求的），无扩大 |

## 7. Owner评论覆盖

| Comment ID | Updated at | Design section | Assessment |
|---|---|---|---|
| —（无评论） | — | 设计 §4：「无评论（REST 返回 `[]`）……无额外 Owner 要求」 | ✅ 本次 dispatch 前刷新结果同为 `[]`——**无 owner 要求适用**；无遗漏映射风险 |

## 8. 上游事实与SA8约束

| Fact or constraint | Design response | Assessment |
|---|---|---|
| 无 SA6/SA8 产物（首次派发） | §5 替代证据链 + §6 直读治理 ADR/包 AGENTS | ✅ Feature 切片无根因链可承接；缺口由红灯契约可执行证明 |
| ADR 0013 wire 冻结值（0x42/bit 0x1/两码/reason/ACK 复用/`maxUpdateBytes` 复用/envelope 不变） | §6/§7 逐字落实 | ✅ 本次逐项与 ADR 原文比对一致（含「chunk 大小复用 maxUpdateBytes，零新 frame 级上限」原文） |
| ADR 0010/规范 §5「扩展必须 HELLO 显式协商」 | D-3 门控 fail-closed + §15 冲突复查 | ✅ |
| 包 AGENTS Verification（wire 变更 → root typecheck + root test + 新旧互通证据） | §12 AC5、§16、§17 | ✅（本次系统提醒注入的同文 AGENTS 再确认） |
| `PROTOCOL_OVERHEAD_BYTES=128` 链式不变量 | D-6 不动 | ✅ 独立复算 UPDATE_CHUNK 最坏开销 36+5×5=61 ≤ 128（constants.ts:26 实测） |
| lib0@0.2.117 | §2 锚点 | ✅ pnpm-lock.yaml:793 实测相符 |

## 9. 设计内部一致性

- §14 修订映射表逐条与正文对照：F1→D-8/D-1 非目标/§8/§10/§11/§12/§17、F2→§16/四日志、F3→D-3/D-7/§12/红灯用例、F4→§2/D-5/§11、O2→§13——**全部真实落地，无「只在附录承认、正文未改」的伪修订** ✅。
- 计数一致：28 用例 = 6+8+7+7（文件实测 28 个 `it(`、4 个 describe）✅；§16 声称的 8 个未跟踪文件与 git status 逐项一致 ✅。
- §2 新增行（穷尽 switch 断裂事实、`connectionFatal` 签名、急切校验先例、§9.4 现状）全部实测为真 ✅。
- 未发现死引用、旧 API 或前后相反表述；iteration-0 的「ws-replication 零改动」表述已在全文清除并以 D-8 例外统一口径 ✅。

## 10. 状态机与并发攻击（iteration-1 S1–S6 复跑）

| ID | 场景 | 结论（修订后） |
|---|---|---|
| S1 | v1 端收 0x42（注册后） | 消息层门控 → UNSUPPORTED_MESSAGE_TYPE（1002）→ catch 收口链（hub:605-617/peer:360-372 实测完好）→ 与帧层拒绝同分类。**闭合** |
| S2 | 重复/并发 decode | 纯函数逐字节一致。**闭合** |
| S3 | 截断/损坏 + 已协商 | 帧级分类先于门控（§9 顺序 + AC2 截断用例）。**闭合** |
| S4 | 门控选项非法（-1/1.5/2^32） | **F3 修订闭合**：作用域=急切（全消息类型），红灯用例 :402-411 双向钉死（非法值→CPV；合法值→正常解码）。仅余 O-A（帧级检查与选项校验的**相对**顺序未由红灯用例区分——设计 §9 已规范指定「帧级→选项→门控→载荷」，见 §15） |
| S5 | 旧实现收新 ERROR 码 | 结构性不可达（ADR 0013 互通矩阵）；真收到 → lookupError 未命中 → MALFORMED_FRAME fatal（响亮）。已记 §13。**闭合** |
| S6 | 重启/迟到回调/资源释放 | 不适用（无状态纯函数 + 无回调面）。**闭合** |

## 11. 错误与恢复攻击

| ID | 结论 |
|---|---|
| E1 敌意载荷（截断/非 canonical/非法 UTF-8/非法 ns/尾随/超声明/巨额声明） | 全部 MALFORMED_FRAME，仅经 CanonicalReader 有界读 + 分配前 `pos+len ≤ end` 检查；AC2 以「只抛 ProtocolError」为可观察判据。**闭合** |
| E2 `bytes > maxUpdateBytes` | UPDATE_TOO_LARGE（encode/decode 同判据，复用 UPDATE 先例 payloads.ts:607-626）。**闭合** |
| E3 未协商 0x42 | UNSUPPORTED_MESSAGE_TYPE（1002 fatal，注册表单点导出）。**闭合** |
| E4 选项非法 | CONNECTION_POLICY_VIOLATION，急切作用域（F3）。**闭合** |
| E5 伪成功/静默降级 | encode 不门控是有意的（向量构造需要；发送端 gating 归后续切片，D-3 备选 (a) 拒绝理由成立）；D-8 选 fail-loud 拒绝 no-op 同向。**闭合** |
| E6 回滚 | 纯 append-only + 回退两处 case 即回 v1（§13）。**闭合** |

## 12. 契约影响审查

| API or contract | 调用方处理 | SA2 核验 |
|---|---|---|
| `ReplicationMessage` +`UpdateChunkMsg` | D-8 两处单 case 补丁 + root typecheck 独立证据 | ✅ 影响面完备性经独立重推导（§3 表：恰好两处穷尽断裂，其余消费面均不断裂） |
| `decodeInbound`（frame-io.ts:58-67） | 零改动，缺省 = 未协商 | ✅ 实测调用形不变 |
| HELLO/HELLO_ACK 发送端（peer:333 `optionalCapabilities: 0` / hub:707 `selectedCapabilities: 0`） | 零改动 | ✅ 实测源码 |
| `decodeFrame` 公共 API | 不改（门控在消息层，DENY envelope.ts 一致） | ✅ envelope.ts:108-112 只认注册与否 |
| 协议包既有测试 | §11 ALLOW 逐文件列明 append-only 翻转；codec-fuzz-property 的 randomMessage 实测枚举 17 kind（须增分支，ALLOW 必要性成立）；codec-version-interop / codec-malformed 实测无 0x42 锚点（正确地不在 ALLOW） | ✅ |
| `apps/yjs-server` | harness.ts:588 参数类型消费，无断裂 | ✅ |

## 13. 架构一致性与惯例审查

- **责任归属**：wire 值/协商数学/敌意拒绝归 replication-protocol（byte codec Owner）；发送 gating/assembly/配置链归 ws-replication 后续切片；D-8 类型补丁落在拥有该 switch 的 ws-replication 两文件——归属正确 ✅。
- **相似能力对照**：append-only 注册表演进 + 红灯契约（#135/#238/#239 先例）、uint32 语义字段族（readVarUint32/writeVarUint32）、字段限额复用（UPDATE→maxUpdateBytes）——同构复用，零新平行机制 ✅。
- **单一事实源**：错误码元数据/消息码/golden/协商结果均单点导出（iteration-1 §10 结论在修订下不变；D-9 #4 显式拒绝「另立联合」以保「解码返回类型 = wire 消息全集」——正确的单源论证） ✅。
- **生命周期对称性**：不适用（纯函数 codec） ✅。
- **平行机制检查**：`CAP_CHUNKED_UPDATE` 是 constants.ts 首个 CAP_*（无既有族）；`selectedCapabilities` 复用 `DecodeOptions` 既有通道；reason 不预造代码枚举——无平行通道 ✅。
- **文件范围**：ALLOW 17 条逐条与正文引用对上（含文档面 2 处 = ADR 0013 明示义务）；DENY 收窄例外表述与 D-8 边界一致；follow-up（发送切片/assembly/配置链/observer/D-8 case 被真实分发替换）均为真后续，无伪装 ✅。

## 14. 验收设计审查

| 项 | 结论 |
|---|---|
| AC1–AC4 红灯锚点 | 28 用例分层清晰；失败原因唯一指向缺失 API（R1 逐条核对：undefined 符号 / unknown kind / unknown type 0x42 / 20≠22 / unknown error code / scope 兜底 connection / F3 用例选项被忽略）；类型层红灯 21 错误全部缺失 API（TS2305/TS2724/TS2353/TS2345/TS2339/TS2551），无测试自身逻辑错误 ✅ |
| 旧实现真实为红 | 20F\|8P 双跑逐名一致 ✅ |
| 伪绿风险 | 8 个红灯期通过用例均为跨翻转合法锚（iteration-1 已逐个核验；lookupError 红灯期为恒真弱锚——转绿后自然变实锚，已记录防误读） ✅ |
| 测试入口真实性 | 红灯文件命中 `packages/*/test/**/*.test.ts` include（vitest.config.ts:15 实测） ✅ |
| AC5 验证设计 | 五项命令明确（包级 vitest --typecheck / 包级 tsc / **root typecheck（独立证据）** / root test（附 §17-5 归因规则）/ 互通证据 = AC3 v1 回落 + 既有用例零变化） ✅ |
| 观察行为而非源码文本 | 全部断言针对 encode/decode/registry 公共行为 ✅ |

## 15. Required revisions

**无**（F1/F2/F3/F4/O2 全部关闭；未发现新的 BLOCKER/MAJOR）。

## 16. Non-blocking observations（不阻断 approve）

1. **O-A（继承 iteration-1 S4 残余，已收窄）**：红灯契约未区分「帧级 9 步」与「急切选项校验」的**相对**顺序（两种顺序均可转绿：截断用例全用合法选项、急切用例全用合法帧）。设计 §9 已规范指定「帧级 → 选项急切校验 → 门控 → 载荷级」，SA3 照文实现即可；两种顺序下分类均稳定且只抛 ProtocolError，无安全差。无需修订。
2. **O-B**：hub `dispatchReady` 的 GOAWAY drain 过滤 switch（:719，`default: break`）使 D-8 fatal case 在 drain 期同样生效——本切片构造性不可达，且 §10 已声明该 case 将被后续切片真实分发逻辑**替换**；记录备查，无需动作。
3. **O-C**：`frame-io.ts:73` `namespaceFieldViolation` 对 UPDATE_CHUNK 走 default 返回 undefined——本切片不可达（decodeInbound 缺省门控先拒）；后续「已协商接收」切片实装分发时须同步评估该判别函数与 drain/draining 过滤器对 UPDATE_CHUNK 的策略（属该切片 ALLOW 面）。提前记录以防遗漏。
4. lookupError 用例红灯期恒真（弱锚）、互通证据为包内模拟（v1 支持集 → selected=0 → fatal）——两项均为设计 §13 已记录残余，结论不变。
5. `PROTOCOL_OVERHEAD_BYTES=128` 覆盖推导（36+25=61 ≤ 128）经独立复算成立。

## 17. 评审结论与 SA3 实施路由（bounded direction）

**结论**：修订版设计在与 iteration-1 相同的攻击面（状态机/错误恢复/契约/架构/文件范围/验收）+ 本次新增的「影响面完备性重推导」「日志数字链互证」「ADR 逐项重比对」下成立；两处原阻断的解决是实质性的（范围契约自洽 + 证据可复现），非措辞性修饰。**放行 SA3。**

**SA3 有界实施方向**（严格按 §11 ALLOW / DENY 边界；顺序建议）：

1. **协议包实现**（`packages/replication-protocol/src/`）：`messages.ts`（0x42 注册 + `UpdateChunkMsg` + 联合）→ `constants.ts`（`CAP_CHUNKED_UPDATE = 0x00000001`）→ `errors.ts`（+2 码，22 条）→ `limits.ts`（`DecodeOptions.selectedCapabilities?: number` + 急切解析校验，判据对称 `resolveExpectedSequence`：非安全整数/负/>0xffffffff → CPV）→ `payloads.ts`（`encodeUpdateChunk`/`decodeUpdateChunk` 按 D-1 六字段规则 + `decodeMessage` 入口急切校验与门控，门控先于 payload 解析）→ `index.ts` 导出。字段规则以红灯契约为逐条规格（transferId≥1、index<count、count≥1、totalBytes≥bytes.byteLength、bytes 非空、≤maxUpdateBytes→UPDATE_TOO_LARGE）。
2. **ws-replication 两处类型兼容补丁**（仅此）：`hub-connection.ts`/`peer-connection.ts` 的 `dispatchReady` 主 switch `default` 前各加 D-8 单 case（`this.connectionFatal('UNSUPPORTED_MESSAGE_TYPE', 1002); return;` + 不可达性注释，逐字按设计 §7 D-8 代码块）。**禁止**动 HELLO 置位、`decodeInbound` 传参、drain 过滤、发送/接收行为。
3. **既有测试 append-only 翻转**（§11 列明的 7 个测试文件 + fixtures.ts）：GOLDEN 18→21（3 向量从红灯文件字面量整合）、MESSAGE_TABLE/SCOPE/DIRECTION/ACK 增行、NAMESPACE_ERROR_TABLE 20→22、计数断言（17→18 消息、20→22 码）、0x42 未注册样本换 0x43+、GOLDEN 全量 decode 循环传 `selectedCapabilities`、fuzz randomMessage 增 UPDATE_CHUNK 分支、test-d 增类型断言。**红灯契约文件不改**。
4. **文档**：协议文档 §5/§10.3/§6.1/§13.2/§9.4（首次定义 reason 词表并登记 `UPDATE_TRANSFER_EXPIRED`——不要去找不存在的既有清单）/§22 + CONTEXT.md 词汇。
5. **转绿验证**（逐项独立记录退出码，§17-5）：包级 `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run --typecheck packages/replication-protocol`（= R3 同命令）exit 0；包级 `tsc -p` exit 0；**root `pnpm typecheck` exit 0**（编译器自证两处穷尽 switch 恢复）；root `pnpm test` 按 §17-5 归因（R4 两先在环境性失败如复现须隔离复跑佐证，**不得修改**）。
6. **实现后免重跑全量设计评审**：SA4 按 §10 矩阵与 §17 验证；ADR 冲突复查按设计 §15 由 Controller 路由（本评审未追加新维度）。

— SA2，iteration 2 复审完毕。
