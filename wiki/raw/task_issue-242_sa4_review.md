# SA4 实现后红队审查 — issue #242：UPDATE_CHUNK codec 与 CAP_CHUNKED_UPDATE 协商（切片 1）

> 评审人：SA4（实现静态红队审查），implementation-review，iteration 0（dispatch：sa-7f81568e-c1cc-45cd-9e5f-ecd777d4f243）。
> 审查对象：SA3 实现报告 `wiki/raw/task_issue-242_sa3_impl.md` + worktree 实际 diff（`git status`：18 个已跟踪修改 + 10 个未跟踪新增）。
> 治理输入：批准设计 `wiki/raw/task_issue-242_design.md`（SA2 iteration-2 approve）、SA2 评审 `wiki/raw/task_issue-242_sa2_review.md`、ADR 0013、`docs/protocols/instance-replication-v1.md`、两包 AGENTS。
> **Owner 评论输入：本 dispatch 前 REST 刷新 = `[]` —— 无 Owner 评论要求适用**（与任务简报 §Comments 空、设计 §4、SA2 §7、SA3 报告头一致；无遗漏映射风险）。
> 纪律声明：SA4 未运行任何测试/服务/临时进程、未修改实现/设计/测试；全部结论基于源码、diff、日志与文档的静态核验 + 手工算术复算。本文件是唯一写产物。

## 1. Reviewed inputs

| 输入 | 状态 | 核验方式 |
|---|---|---|
| `wiki/raw/task_issue-242.md`（Issue 正文 + 5 AC） | 已读 | 评论区空，与 dispatch REST `[]` 一致 |
| `wiki/raw/task_issue-242_design.md`（364 行，SA2 approve 版） | 逐节读取 | §7 D-1~D-8、§11 ALLOW/DENY、§12、§17 逐项对照实现 |
| `wiki/raw/task_issue-242_sa2_review.md`（iteration 2 approve） | 已全文读取 | §17 有界实施方向 6 条逐条核对 |
| `wiki/raw/task_issue-242_sa3_impl.md` | 已全文读取 | §2 D1 披露、§3 转绿表、§5 文件清单逐项复核（发现 1 处计数笔误，见 §12-O2） |
| 实际 diff：`git diff`（18 已跟踪）+ `git status`（10 未跟踪） | 逐 hunk 读取 | 见 §6 文件范围审查 |
| `packages/replication-protocol/src/{messages,constants,errors,limits,payloads,index}.ts` 现文 | 逐行读取（新增区段） | 冻结值/门控/字段规则/导出面 |
| `packages/ws-replication/src/{hub-connection,peer-connection,frame-io}.ts` | diff + 现文关键区段 | D-8 边界、decodeInbound 零改动、HELLO 发送端零改动 |
| `packages/replication-protocol/test/*`（8 改 + 1 新） | 逐 diff 读取 + 新文件全文 | append-only 翻转、28 用例、红灯锚 |
| `docs/adr/0013-chunked-live-update-transfer.md` | 关键节读取 | 字段序/码值/bit/错误码/reason/ACK 复用逐项比对 |
| `docs/protocols/instance-replication-v1.md` diff、`CONTEXT.md` diff | 逐 hunk 读取 | §5/§6.1/§9.4/§10.3/§13.2/§22 + 词汇 |
| 四份证据日志（`_ac_red.log` 432 行 / `_ac_red_typecheck.log` / `_regression.log` 681 行 / `_sa3_green.log`） | 关键区段 + 失败名集合逐名核对 | 数字链复算（见 §9/§12） |
| `wiki/raw/task_ws-replication-bound-early-frame-admission-in-accepttrusted_sa7_report.md` | 定点读取 | stdin-error-chain F1 先在 flake 史（root test 归因关键证据，见 §8-R） |
| root `package.json`、`vitest.config.ts`、`.github/workflows/ci.yml` | 已读 | typecheck 链含 ws-replication；test/typecheck CI 入口；测试发现 include |
| 无 `task_issue-242_sa6_contract.md` / `_relevant_decisions.md` / `_conflict_report.md` | 不存在 | 首次派发即如此（设计头部声明 + SA2 §1 确认）；替代证据链成立，不构成阻断 |

## 2. Verdict

**approve**（无 BLOCKER / 无 MAJOR / 无新增阻断 MINOR）。

- 冻结 wire 值逐项与 ADR 0013 + 设计 §7 一致（0x42 / bit 0x1 / 六字段序 / 两错误码元数据 / `UPDATE_TRANSFER_EXPIRED` / ACK 复用 / `maxUpdateBytes` 复用 / envelope 与 `PROTOCOL_OVERHEAD_BYTES` 不动）；
- capability fail-closed 行为按 D-3 落地：缺省=未协商、门控先于 payload 解析、选项急切校验与 `resolveExpectedSequence` 判据逐字对称；
- D-8 ws-replication 补丁严格最小（两文件各恰一个 case，逐字含注释与设计代码块一致，diff 零其他改动）；
- 文件面完全落在 §11 ALLOW，DENY 面零触碰；
- 转绿证据 P1/P2/P3 exit 0、P4 唯一失败经四条独立静态证据链归因为先在环境性 flake（非本任务回归，见 §8-R）；
- SA3 唯一偏离（红灯契约 :394 单行操作数修复）经复核算**接受**：修复的是测试作者的 JS 位运算笔误，契约语义不变且与设计 D-3 自洽（见 §3-D1）。

`requiresConflictRecheck` 不提交：设计 §15 已将 ADR 0013/0010 一致性复查列为必要并由 Controller 路由；本次审查未发现其之外的新 ADR 冲突维度。

## 3. 上游要求落实

| Requirement or finding | Implementation evidence | Assessment |
|---|---|---|
| Issue：UPDATE_CHUNK 自描述消息编解码 + golden（字段序以 ADR 0013 为准） | `messages.ts`（0x42 注册、`UpdateChunkMsg` 六字段、联合 18 成员）；`payloads.ts` `encodeUpdateChunk`/`decodeUpdateChunk`；`fixtures.ts` 3 条 golden（seq 19/20/21）；红灯契约 AC1 6 用例 | ✅ 字段序 `namespaceId→transferId→chunkIndex→chunkCount→totalBytes→bytes` 与 ADR 0013 逐字一致；三条向量 payload hex 独立复算全对（`d804`=600、`ac02`=300、`80808002`=2^22、`ffffffff0f`×4、payloadLength 45/50/58=0x2d/0x32/0x3a） |
| Issue：HELLO `CAP_CHUNKED_UPDATE` 交集协商；envelope version/flags 不变 | `constants.ts` `CAP_CHUNKED_UPDATE=0x00000001`；HELLO/HELLO_ACK codec 零改动（`negotiation.ts`/`payloads.ts` HELLO 区段不在 diff）；AC3 断言 golden HELLO 的 optionalCapabilities 字节位 [42,50) | ✅ bit 经既有 uint32 BE 字段承载；`selectCapabilities` 复用；golden header 断言 version=1/flags=0/reserved=0 |
| Issue：两 namespace 错误码 + 一 RESYNC reason（append-only） | `errors.ts` +2 条（`namespaceError('UPDATE_TRANSFER_VIOLATION',true,'no','failed')` / `('UPDATE_TRANSFER_TOO_LARGE',true,'config','failed')`，签名 `(code,fatal,retryable,terminalState)` 实测核对）；文档 §9.4 首次定义 reason 词表并登记 `UPDATE_TRANSFER_EXPIRED` | ✅ 元数据与 ADR 0013/设计 D-4 一致；22 条；§9.4 既有码 `send-queue-overflow` 以源码实据登记（peer-namespace:923/944、hub-namespace:792 为 RESYNC_REQUIRED 全部发射点，`REAUTH_REQUIRED` 属 GOAWAY 词表不混入）——**未虚构** |
| Issue：未协商端收 UPDATE_CHUNK 按未知消息码规则响亮关闭 | `payloads.ts` `decodeMessage`：`header.messageType===0x42 && ((selected ?? 0) & CAP_CHUNKED_UPDATE)===0 → UNSUPPORTED_MESSAGE_TYPE`（registry 导出 scope=connection/fatal/retryable=no/wsCloseCode=1002） | ✅ 分类/close code 与帧层未知码规则单点同源；AC3「未协商 fatal」「v1 回落」两用例钉死 |
| Issue：本票只交付协议包能力，不改发送/接收行为 | `frame-io.ts` 零改动（不在 diff）；HELLO 发送端 `optionalCapabilities:0`/`selectedCapabilities:0` 零改动；D-8 两 case 运行时构造性不可达 | ✅ 见 §8 不可达性复核 |
| SA2 §17 有界实施方向 1–6 | 逐条对照 §4 设计落实表 | ✅ 全部按边界执行，无越界 |
| **D1（SA3 披露的唯一偏离）**：红灯契约 `codec-issue242-ac-red.test.ts` 单行操作数修复 | 现文件 :391-394：`(CAP_BIT | 0x80000000) >>> 0` + 两行说明注释 | ✅ **接受**（详证见下） |

**D1 裁决依据**（SA4 独立复算）：

1. JS 中 `0x00000001 | 0x80000000` 经 int32 位运算 = **-2147483647**（负数），不是作者意图的 0x80000001；
2. 同契约 AC3 另一用例（:400）与设计 D-3 判据（负 → `CONNECTION_POLICY_VIOLATION`）要求 -1 被拒——任何按类型域单调判定 uint32 的实现无法同时接受 -2147483647 而拒绝 -1，原行与契约自身语义互斥；
3. 红灯期该用例在 :389 即因 `decodeFrame` 对 0x42 的帧级拒绝而失败（`_ac_red.log`:267-277 栈帧 `codec-issue242-ac-red.test.ts:389:16` 实证），修复行从未被执行——SA3「红期未暴露」的陈述与日志吻合；
4. 修复后值为 0x80000001（位 0 + 多余高位），断言语义仍是「本位置位含多余位 → 解码成功」，**未弱化任何断言**，反而使「急切校验拒绝负值」的判别锚保持有效；等价于 SA3 给出的备选字面量 `0x80000001`；
5. 28 个用例名集合与红期日志 20F+8P 逐名一致（SA4 逐名比对），无删除/改名/跳过——「契约其余零改动」成立。

处置：非 fallback、非 skip、非语义篡改；记录为已裁决的测试作者笔误修复，路由 `acceptance-contract`（SA7/总控如需可按字面量等价改写，实现零变化）。

## 4. 设计落实审查

| Design decision | Implementation location | Assessment | Finding |
|---|---|---|---|
| D-1 字段规则（六字段 + 单帧自洽：transferId≥1、index<count、count≥1、bytes 非空、bytes≤totalBytes；违规 MALFORMED_FRAME；R9 对称） | `payloads.ts:659-726`（decode/encode 成对） | ✅ decode 走 `readVarUint32`（uint32 域 + canonical 由 Reader 保证）后逐条判定；encode 先全量校验后写；两侧同规则 | 无 |
| D-2 `CAP_CHUNKED_UPDATE=0x1` 经 index.ts 导出 | `constants.ts:40-45`、`index.ts:9` | ✅ 冻结值逐字一致 | 无 |
| D-3 门控：缺省=未协商；非法选项 → CPV；**急切**作用域；门控先于 payload 解析；encode 不门控；decodeFrame 不改 | `limits.ts:69-77`（`resolveSelectedCapabilities` 与 `resolveExpectedSequence` :61-67 判据逐字对称）；`payloads.ts:822-840`（`decodeMessage`：decodeFrame → 急切解析 → 门控 → Reader/decodePayload → expectEnd）；`envelope.ts` 零改动 | ✅ 拒绝顺序 = 设计 §9；F3 用例（非 0x42 帧 + 非法值 → CPV / 合法值 → 正常解码）双向下锚 | 无 |
| D-4 两错误码（22 条、单点导出） | `errors.ts:52-54,136-140` | ✅ ERROR wire 位推导/`lookupError`/`ProtocolError` 元数据经既有机制自动覆盖（AC4 用例验证位前缀与 badBits 拒绝） | 无 |
| D-5 reason 词表：不为 reason 新建代码枚举；文档首次定义 | 文档 §9.4 新表；codec 对 reasonCode 仍仅非空校验（AC4 roundtrip 用例） | ✅ 与「无发射点不预造状态机面」一致 | 无 |
| D-6 零新 FieldLimits；bytes 复用 `maxUpdateBytes` → UPDATE_TOO_LARGE；`PROTOCOL_OVERHEAD_BYTES` 不动 | `payloads.ts:685-690,713-718`（复用 `resolveFieldLimit`，与 decodeUpdate :621-624 同款）；constants.ts 除新增 CAP 外零改动 | ✅ 最坏开销 36+5×5=61 ≤ 128 复算成立 | 无 |
| D-7 红灯契约 28 用例 + 3 向量 | `codec-issue242-ac-red.test.ts`（28 `it(` 实数清点） | ✅ 仅 D1 单行修复（见 §3） | 无 |
| D-8 两处单 case 类型兼容补丁（逐字含注释） | `hub-connection.ts:790-795`、`peer-connection.ts:521-526` | ✅ 与设计 §7 D-8 代码块逐字一致（case 标签 + 3 行注释 + `this.connectionFatal('UNSUPPORTED_MESSAGE_TYPE', 1002); return;`）；`git diff packages/ws-replication/` 仅此两个 hunk | 无 |
| §8 API 面（index.ts 导出新符号） | `index.ts:9,49`（`CAP_CHUNKED_UPDATE`、`type UpdateChunkMsg`） | ✅ 公共 API 只经 index.ts（包 AGENTS） | 无 |
| §11 既有测试 append-only 翻转 | 见 §9 测试质量审查 | ✅ 逐文件与 ALLOW 预期一致 | 无 |
| §11 文档面 | `instance-replication-v1.md` 六处 + `CONTEXT.md` 两词条 | ✅ 见 §5 | 无 |
| §17 转绿条件 1–5 | P1 exit 0（169/169 含契约 28/28）、P2 exit 0、P3 root typecheck exit 0、P4 按 §17-5 归因（唯一失败 = 先在环境性文件，隔离复跑 4/4 exit 0；replication-protocol 与 ws-replication 测试文件零失败） | ✅ 数字链自洽：R3 167 → P1 169 = +2（golden 新 it + test-d 新 it）；R4 2394 → P4 2396 同 +2；无隐藏排除（P4 CMD 记录为裸 `pnpm test`） | 无 |

## 5. 架构一致性与惯例

### 责任归属

| Behavior | Expected owner | Actual location | Assessment |
|---|---|---|---|
| wire 值/编解码/门控/敌意拒绝 | replication-protocol（byte codec Owner） | src 六文件 | ✅ |
| 发送切片/assembly/配置链/HELLO 置位 | ws-replication 后续切片 | 未实现（正确缺席）；发送端仍 `optionalCapabilities:0`/`selectedCapabilities:0` | ✅ |
| 穷尽 switch 类型兼容 | 拥有该 switch 的连接类 | hub/peer `dispatchReady` 各一 case | ✅ |

### 相似能力对照

| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
|---|---|---|---|---|
| uint32 语义字段族 | `readVarUint32`/`writeVarUint32` + `assertU32`（canonical.ts） | 全复用 | 一致 | 零新编码原语 |
| 字段限额复用 | `decodeUpdate`/`encodeUpdate` 的 `resolveFieldLimit(maxUpdateBytes)` | 同款调用形 | 一致 | ADR 0013「复用 maxUpdateBytes」 |
| append-only 注册表演进 + 红灯契约 | #135/#238/#239 先例 | 同构（契约文件独立、既有面零改保持绿） | 一致 | 仓库纪律 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| 消息码/元数据 | `MESSAGE_TYPES/NAMES/REGISTRY`（冻结） | fixtures `MESSAGE_TABLE` 等镜像由 registries 测试逐键断言同步 | 低（表驱动测试锁定） |
| 错误码元数据 | `NAMESPACE_ERRORS`（冻结 22 条） | ERROR wire 位、`ProtocolError` 元数据、fixtures 表 | 低（AC4 锁定 + 测试逐键对比） |
| 协商结果 | `selectCapabilities` 纯函数 | `DecodeOptions.selectedCapabilities`（调用方传入，缺省=未协商） | 低——库层不持有第二协商状态 |

无第二缓存/旁路 RPC/marker 反推。

### 生命周期对称性

不适用（纯函数 codec，无资源获取/释放；D-8 case 走既有 `connectionFatal` 收口链，无新生命周期）。

### 平行机制检查

| Candidate duplicate | Existing path | Actual path | Disposition |
|---|---|---|---|
| capability 常量族 | constants.ts 首个 CAP_*（无既有族） | 单常量追加 | 非重复 |
| 门控选项通道 | `DecodeOptions`（expectedSequence/maxFrameBytes/limits 同通道） | `selectedCapabilities` 追加 | 非平行机制 |
| reason 代码枚举 | 无（词表仅在文档） | 未预造 | 正确缺席 |

## 6. 文件范围审查

实际变更（只读 git 命令核验）：**18 个已跟踪修改 + 10 个未跟踪新增**。

| Changed path | ALLOW entry | Purpose | Assessment |
|---|---|---|---|
| `packages/replication-protocol/src/messages.ts` | §11 D-1 | 0x42 注册 + `UpdateChunkMsg` + 联合 | ✅ 恰 ALLOW 预期 |
| `…/src/constants.ts` | §11 D-2 | CAP 常量 | ✅ 仅追加 |
| `…/src/errors.ts` | §11 D-4 | +2 码（22 条） | ✅ 仅追加 |
| `…/src/limits.ts` | §11 D-3 | 选项 + 急切解析 | ✅ 对称先例 |
| `…/src/payloads.ts` | §11 D-1/D-3 | codec + 门控 | ✅ |
| `…/src/index.ts` | §11 | 导出 | ✅ |
| `packages/ws-replication/src/hub-connection.ts` | §11 D-8 窄例外 | 单 case | ✅ diff 恰 6 行（case+注释+2 语句），零其他改动 |
| `packages/ws-replication/src/peer-connection.ts` | §11 D-8 窄例外 | 单 case | ✅ 同上 |
| `…/test/fixtures.ts` + 7 个既有测试文件 | §11 逐文件列明 | append-only 翻转 | ✅ 逐文件与 ALLOW 预期改动一致（见 §9） |
| `docs/protocols/instance-replication-v1.md`、`CONTEXT.md` | §11 文档面 | ADR 0013 修订义务 | ✅ |
| 未跟踪：`codec-issue242-ac-red.test.ts` + 8 wiki 产物 + 2 新证据（`_sa3_impl.md`/`_sa3_green.log`） | §11 ● + SA3 报告义务 | 契约与证据 | ✅ |
| DENY 面（canonical.ts / envelope.ts / package.json / ADR / apps/** / vfsl-codegen / ws-replication 其余文件） | — | — | ✅ 零触碰（不在 git status） |

**结论：无超 ALLOW、无触 DENY。** 注：SA3 报告 §5 写「21 已跟踪修改」，实测 18——文件清单本身准确，仅总数算术笔误（见 §12-O2）。

## 7. 契约连锁审查

| Contract | Caller | Actual handling | Risk | Finding |
|---|---|---|---|---|
| `ReplicationMessage` +1 成员 | 全仓穷尽 switch | SA4 独立重 grep：`switch (message.kind)` 恰 4 处——hub:733（主 dispatch，已补 case）、peer:470（主 dispatch，已补 case）、hub:719 与 frame-io:75（default 收尾，非穷尽，不断裂）；`Record<MessageName,…>` 仅在协议包内；apps/yjs-server/src 无 kind switch | 低 | 无 |
| `decodeInbound`（frame-io.ts:59-68） | hub/peer onMessage | 调用形不变（不传 selectedCapabilities）→ 缺省=未协商 → 0x42 消息层 UNSUPPORTED_MESSAGE_TYPE → catch 链 `connectionFatal(code, wsCloseCodeFor(code)=1002)`——与改前帧层拒绝**同码、同 close code、同收口拓扑**（拒绝点移动分类不变，SA2 §3 已逐环实测，SA4 复核 catch 链位置无误） | 低 | 无 |
| `decodeFrame` 公共 API | ws-replication + 测试 | 0x42 注册后帧层放行、门控在消息层（设计 D-3 明示）；envelope 测试未注册样本已换 0x43 | 低 | 无 |
| HELLO/HELLO_ACK 发送端（peer:333 / hub:707） | 连接状态机 | 零改动（不在 diff） | 无 | 无 |
| `apps/yjs-server` | harness `send(message)` 参数消费 | 联合扩宽不破坏参数消费（encodeMessage 内部 switch 已扩） | 无 | 无 |
| 未来切片（发送/assembly） | — | 依赖本切片冻结值；届时**替换** D-8 两处镜像 case（设计 §10 明示） | 记录 | 无 |

## 8. 错误、恢复与并发

- **错误分类**：帧级 9 步（BAD_MAGIC/FRAME_LENGTH_MISMATCH 等）→ 选项急切 CPV → 门控 UNSUPPORTED_MESSAGE_TYPE(1002) → 载荷 MALFORMED_FRAME / UPDATE_TOO_LARGE → expectEnd；实现顺序与设计 §9 逐字一致；任何路径只抛 `ProtocolError`（AC2 以此为可观察判据，含 2^32 巨额声明在分配前分类拒绝——`readVarUint8ArrayCopy` 的 `pos+len ≤ end` 前置检查未动）。
- **无越界分配**：`canonical.ts`/`envelope.ts` 零改动（DENY 遵守）；新增字段全部经既有有界 Reader。
- **并发/幂等**：纯函数、无共享状态；canonical 编码确定性（golden roundtrip 锁定）。
- **D-8 运行时不可达性复核**：`decodeInbound` 不传选项 → 缺省未协商 → 消息层先拒 → dispatch 收不到 UPDATE_CHUNK；且该 case 与 decode 层分类自镜像（1002），若后续切片误放行亦 fail-loud 而非静默丢数据。✅
- **旧实现收新 ERROR 码（SA2 O2）**：`lookupError` 未命中 → MALFORMED_FRAME fatal（响亮拒绝）；结构性不可达由互通矩阵保证。残余维持设计 §13 记录。✅

### §8-R root test 单例失败的深度归因（dispatch 指定重点）

**结论：`apps/yjs-server/test/stdin-error-chain-red.test.ts` F1 race 失败是先在环境性 flake，不是本任务回归。** SA4 以四条独立静态证据链交叉验证，未采信任何单一陈述：

1. **时间线证据（先在于实现）**：设计阶段 R4 全仓探测（`_regression.log`:667-681，13:30:31 起跑，**未实施树**——git 零已跟踪修改）中该文件已失败（"process exited 134 / EAGAIN spawn CPU burner"），且设计 §13/§16-R4 当时已记录 + 隔离复跑 12/12 通过。同一文件在**没有任何本任务代码**的树上于同一命令形态下失败，排除「实现引入」的因果可能。
2. **历史 flake 史（先在于本任务族）**：`wiki/raw/task_ws-replication-bound-early-frame-admission-in-accepttrusted_sa7_report.md`:42/126/132 记载该文件（含 F1 race 用例）在更早 commit `6fde7ea` 上同机出现 `Cannot fork` 超时 / exit 134 / "timeout 60000ms waiting for peer ready (round 1)"，且**同码同机仅负载不同即 4/4 vs 3/4、失败在同族测试间漂移**——flaky 的定义性证据，与本任务无关。
3. **因果通路排除（本任务改动无法触及该测试行为）**：该测试经真实 tsx 进程跑 hub/peer 全链路；其入站解码 `decodeInbound` 调用形不变，`decodeMessage` 新增路径对 v1 流量逐字节无操作（`resolveSelectedCapabilities(undefined)` 即返回；门控条件 `messageType===0x42` 在 v1 流量恒假——本切片不存在任何 UPDATE_CHUNK 发送端）；出站编码对既有 kind 不变；ws-replication 仅两处不可达 case（switch 语义对其余 kind 无影响）；`apps/**` 零改动。测试失败模式（5s 量级墙钟/进程异常）所需的机制（收敛超时、spawn 失败）与上述零行为变化的 diff 之间不存在静态可构的因果链。
4. **隔离复现反向证据**：SA3 P4 后隔离复跑该文件 exit 0（4/4，`_sa3_green.log`:31-35）；同跑中另一先在 flake（generate-cli-check）反而通过——运行间方差形态与环境抖动一致、与确定性回归相反。

按设计 §17-5 判读规则：所有 replication-protocol 与 ws-replication 测试文件在 P4 零失败；唯一失败不可归因于本任务 ALLOW LIST 任何文件；未对本任务实现做任何为迁就该测试的调整（零 `--exclude`、零测试改动）。**接受归因，不作为回归放过，也不作为阻断。** 残余证据缺口与建议见 §11/§12-O3。

## 9. 测试质量审查

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
|---|---|---|---|---|
| `codec-issue242-ac-red.test.ts`（28 用例） | AC1 golden 逐字节 + 字段序；AC2 敌意 8 类（截断/非 canonical/超域/非法 UTF-8/非法 ns/尾随/超声明/自洽违反 + 限额 + encode 对称）；AC3 交集矩阵/字节级 bit roundtrip/未协商 fatal/急切作用域双向/v1 回落；AC4 注册表/位推导/badBits/元数据/reason | vitest include `packages/*/test/**/*.test.ts`（vitest.config.ts:15）+ CI `pnpm test` | 无 skip/only/todo（grep 实测）；28 用例名与红期日志逐名一致；D1 修复不弱化断言（§3） | 无 |
| `codec-messages-golden.test.ts` | GOLDEN 21 长度 + UPDATE_CHUNK 三向量已协商解码 + 消息码 0x42 | 同上 + P1（10 文件 169 passed） | `decodeGolden` 统一传 `selectedCapabilities`（合法帧+合法选项，无假拒绝面） | 无 |
| `codec-registries.test.ts` | 0x42 翻转为已注册、0x43 仍空闲、18/22 计数、表驱动逐键 | 同上 | 表驱动自动覆盖新增行 | 无 |
| `codec-envelope.test.ts` | 未注册样本 0x42→0x43 | 同上 | 无（保持对帧层注册检查的敏感性） | 无 |
| `codec-roundtrip-truncation.test.ts` | 18 种 roundtrip/字段全等（传门控选项）；截断循环不传选项（帧级分类先于门控，语义不变，SA2 O-A 已收窄记录） | 同上 | 无 | 无 |
| `codec-package-contract.test.ts` | Buffer-free 全 golden 循环（传门控选项） | 同上 | 无 | 无 |
| `codec-fuzz-property.test.ts` | randomMessage 20 分支（UPDATE_CHUNK 自洽生成：非空 bytes、totalBytes≥len）；300 次 seeded roundtrip（已协商解码）逐字段全等 | 同上 | 变异面沿用 decodeFrame（设计 §11 明示） | 无 |
| `codec-api.test-d.ts` | 联合成员 extract、`UpdateChunkMsg` 形状、常量数字型、`DecodeOptions.selectedCapabilities?` | vitest typecheck include `packages/*/test/**/*.test-d.ts` + P1 `--typecheck`（Type Errors no errors） | 常量字面量值由运行时契约 AC1 锁定（类型测试注释说明） | 无 |
| ws-replication 既有全部测试 | v1 行为不变 | root `pnpm test`（P4 零失败） | 零改动（正确——DENY） | 无 |

SA6 红灯断言保持性：R1 20F|8P 双跑逐名一致（日志实证）；转绿后 28/28 通过（P1）。测试均观察公共行为（encode/decode/registry），无源码字符串断言。

## 10. Required revisions

**无**（无 BLOCKER/MAJOR；D1 已裁决接受，见 §3）。

## 11. 后续动态验证项

| Risk | Driver | Expected observation | Failure condition |
|---|---|---|---|
| stdin-error-chain-red F1 在全仓并行负载下的稳定性（先在 flake，本任务未触碰） | CI 或静默机器上的 root `pnpm test`（多次） | 该文件 4/4 通过；若偶发失败，失败签名与既有 flake 史一致（fork/EAGAIN/exit 134/peer-ready 超时）且与本任务文件无关、隔离复跑通过 | 隔离复跑仍失败，或失败可稳定归因到 replication-protocol/ws-replication ALLOW 文件 |
| 真实跨版本互通（当前证据为包内 v1 支持集模拟：selected=0 → 1002 fatal） | 后续切片的真实旧/新二进制互跑（ADR 0013 互通矩阵） | v1 端对 0x42 帧以 UNSUPPORTED_MESSAGE_TYPE(1002) 关闭；v2 未协商端不发送分块 | 任何未协商端静默解码或发送 0x42 |
| §8-R 证据完整性：P4 绿日志未含失败断言明细（仅用例名 + 时长） | SA7/总控如需复核该归因 | 复跑时保留 FAIL 详情块 | 详情显示 `write-failed` 类语义断言失败且隔离复现（那才是真回归信号） |

## 12. Non-blocking observations

1. **O1（D1 记录）**：红灯契约 :394 操作数修复属测试作者笔误修正，语义与设计 D-3 对齐（§3 详证）；如上游欲消除歧义可改写字面量 `0x80000001`，实现零变化。路由建议：`acceptance-contract`。
2. **O2（报告笔误）**：SA3 报告 §5 称「21 已跟踪修改」，git 实测 18（6 src + 2 ws + 8 test + 2 docs）；清单逐项准确，仅总数算术错误，不影响任何结论。
3. **O3（证据质量）**：`_sa3_green.log` 的 P4 段只记录失败文件名 + 时长，未含 vitest FAIL 断言详情块（设计阶段 R4 同样仅摘要）；§8-R 归因依赖四链交叉而非单一日志。建议后续转绿日志保留失败详情（尤其环境性归因场景）。
4. **O4（继承 SA2 O-C）**：`frame-io.ts:75` `namespaceFieldViolation` 对 UPDATE_CHUNK 走 default → undefined；本切片不可达（decodeInbound 缺省门控先拒），后续「已协商接收」切片实装分发时须同步评估该判别与 drain/draining 过滤器策略。
5. **O5**：`CAP_BIT` 在红灯契约中是本地字面量（0x1）而非导入常量——有意设计（红灯期常量不存在），转绿后与 `CAP_CHUNKED_UPDATE` 恒等由 AC1 用例锁定，无漂移。
6. **O6**：SA3 报告 §1.3 称 fuzz「20 分支」，实测 `pick = rand()*20` + UPDATE_ACK default——分支计数口径（17 v1 + UPDATE + UPDATE_CHUNK + default）与代码一致，无实际问题。

— SA4，issue #242 实现审查完毕。Verdict：**approve**。
