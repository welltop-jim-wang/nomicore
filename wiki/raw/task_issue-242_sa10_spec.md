# SA10 规范符合性审查 — issue #242：UPDATE_CHUNK codec 与 CAP_CHUNKED_UPDATE 协商（issue #233 切片 1）

> 评审人：SA10（独立 Spec 审查），final-review 组 issue-242-final-review-0，iteration 0
> （dispatch：sa-bd8111ae-1965-4ed3-b370-21c059e17eb1）。
> 审查对象：当前 worktree HEAD/diff（`git status`：18 个已跟踪修改 + 10 个未跟踪新增，与 SA4 记录一致）。
> 治理输入：Issue 正文 `wiki/raw/task_issue-242.md`、批准设计 `wiki/raw/task_issue-242_design.md`（SA2 iteration-2 approve）、
> SA2 复审 `task_issue-242_sa2_review.md`、SA3 实现报告 `task_issue-242_sa3_impl.md`、SA4 审查 `task_issue-242_sa4_review.md`、
> ADR 0013、`docs/protocols/instance-replication-v1.md`、验收契约 `packages/replication-protocol/test/codec-issue242-ac-red.test.ts`。
> **Owner 评论输入：dispatch 前 REST 刷新 = `[]` —— 无 Owner 评论要求适用（与任务简报 §Comments 空、设计 §4、SA3/SA4 头部一致）。
> 已如实记录；无 Owner 要求映射遗漏风险。**
> 上游产物缺口：`task_issue-242_sa6_contract.md` / `_relevant_decisions.md` / `_conflict_report.md` 不存在（首次派发即如此，
> 设计头部与 SA2 §1 均已声明；设计 §5/§6 的替代证据链成立）。本审查以 Issue 正文 + 批准设计 + ADR 0013 为规范基线。
> 纪律声明：SA10 未修改任何代码/设计/测试，未运行测试/服务，未调度其他 SA；结论基于源码、diff、ADR 与日志的
> 静态核验 + 手工算术复算。本文件是唯一写产物。

## 1. Verdict

**approve**（无 BLOCKER / 无 MAJOR；MINOR 见 §7，均不阻断）。

五条 Issue AC 全部有可执行验收契约锚点且与实现逐项吻合；冻结 wire 值与 ADR 0013 逐字一致；
codec 校验与拒绝顺序与设计 §9 一致；capability 门控 fail-closed 且兼容面（v1 行为逐字节不变）由构造成立；
文件面零超 ALLOW、零触 DENY；文档义务（ADR 0013「落地时修订」）已兑现；转绿证据链（P1/P2/P3 exit 0）完整，
root test 唯一失败按设计 §17-5 归因为先在环境性 flake（见 §6-P4）。

`requiresConflictRecheck` 不重复提交：设计 §15 已将 ADR 0013/0010 一致性复查列为必要并由 Controller 路由，
SA4 复审未发现新维度；本审查同样未发现其之外的新 ADR 冲突维度（该设计级义务仍然存在，不因本结论消失）。

## 2. Issue AC 逐条核验

### AC1：UPDATE_CHUNK 全字段 golden vectors 提交并锁定（字段序以 ADR 0013 为准）；canonical roundtrip 通过 ✅

- **字段序权威比对**：ADR 0013 §消息形态（docs/adr/0013-chunked-live-update-transfer.md:30-36）=
  `namespaceId(varString) → transferId(varUint) → chunkIndex(varUint) → chunkCount(varUint) → totalBytes(varUint) → bytes(varUint8Array)`。
  实现 `payloads.ts` `decodeUpdateChunk`/`encodeUpdateChunk`（新增区段）逐字段同序；契约 AC1「字段顺序锁定」用例
  （codec-issue242-ac-red.test.ts:225-232）以切片字面量钉死。
- **golden 向量独立复算**（SA10 手工重算，非转述）：
  - 向量 A：transferId=1→`01`、index=0→`00`、count=3→`03`、totalBytes=600→`d804`（600=0x58+cont / 0x04）、
    bytes len 3→`03`+`0a0b0c`；payload 长 36+1+1+1+2+1+3=45=0x2d ✅。
  - 向量 B：300→`ac02`、63→`3f`、64→`40`、2^22→`80808002`、len 5→`05`+`deadbeef01`；payload 长 50=0x32 ✅。
  - 向量 C：0xffffffff→`ffffffff0f`、0xfffffffe→`feffffff0f`、len 1→`01`+`ff`；payload 长 58=0x3a ✅。
  - 帧头与 envelope 实装布局（envelope.ts：magic4+version1+type1+flags2+sequence4+payloadLength4+reserved4=20B）逐字节一致：
    `4e4d4352 01 42 0000 00000013 0000002d 00000000`（seq=19）；契约 `PINNED_FRAME_HEX` 字面量与 `buildFrameHex`
    算术构造互证（AC1 用例 2），双重锁定。
- **注册表三元组**：`messages.ts` `UPDATE_CHUNK: 0x42` + `messageInfo(0x42, 'namespace', 'either', 'UPDATE_ACK')`
  （签名实测 `(code, scope, direction, ack)`）——与 ADR 0013「0x42 (namespace)」「ACK 复用 UPDATE_ACK」逐字一致；
  `MESSAGE_NAMES` 逆映射由同一 `_messageTypes` 派生。
- **roundtrip**：契约 AC1「encode(decode(frame)) === frame」+ `codec-roundtrip-truncation.test.ts` 18 种全量循环；
  P1 日志 exit 0（169/169）。
- **envelope 不变**：契约断言 header version=1/flags=0/reserved=0；`envelope.ts` 不在 diff（零改动）。

### AC2：敌意输入全部响亮拒绝，无越界分配 ✅

契约 AC2 8 用例（:237-319）逐类覆盖 Issue 明列清单，SA10 对照实现确认每条分类链：

| Issue 要求 | 契约锚点 | 实现路径 | 分类 |
|---|---|---|---|
| 逐 byte offset 截断 | :238-245（全 offset 循环） | `decodeFrame` 步骤 1/2/8（envelope.ts 零改动） | BAD_MAGIC / FRAME_LENGTH_MISMATCH |
| 非 canonical 数值 | :247-260（`8100`/`8300`/9 字节续位/2^32 超域 ×2/bytes 长度前缀非最短） | CanonicalReader 最短 LEB128 + `readVarUint32` uint32 域（既有原语复用） | MALFORMED_FRAME |
| 非法 UTF-8 | :262-267（35×0xff） | `readVarString` 严格 UTF-8（canonical.ts 零改动） | MALFORMED_FRAME |
| 非法 namespaceId | :268-277（大写/短） | `checkNamespaceId` 复用 `^ns-[0-9a-f]{32}$` | MALFORMED_FRAME |
| 尾随字节 | :280-282 | `reader.expectEnd()` 完全消费 | MALFORMED_FRAME |
| 超声明 bytes | :284-289（200>3 余量；2^32 巨额声明） | `readVarUint8ArrayCopy` 分配前 `pos+len ≤ end` 检查（未动） | MALFORMED_FRAME，分配前拒绝 |
| 单帧语义自洽 | :291-297（count=0/index≥count/transferId=0/空 bytes/bytes>totalBytes） | `decodeUpdateChunk` 逐条 `throwMalformed` | MALFORMED_FRAME |
| 字段限额 | :299-306 | `resolveFieldLimit(limits?.maxUpdateBytes)` 复用（与 decodeUpdate 同形） | UPDATE_TOO_LARGE |
| encode R9 对称 | :308-318 | `encodeUpdateChunk` 先全量校验后写，同判据 | MALFORMED_FRAME |

- **无越界分配**：`canonical.ts`/`envelope.ts` 零改动（DENY 遵守）；契约可观察判据 = 任何路径只抛 `ProtocolError`；
  2^32 巨额声明在分配前分类拒绝（栈不经分配点）。
- 「超声明 count」面由 varString/varUint8Array 长度前缀超余量用例覆盖（单帧无状态 codec 不校验跨帧 chunkCount 上界——
  属后续切片接收端首 chunk 校验，设计 §7 D-1/D-6 明示，与 Issue「codec 层」范围一致）。

### AC3：HELLO optionalCapabilities/selectedCapabilities 交集协商；未协商端 UNSUPPORTED_MESSAGE_TYPE connection fatal ✅

- **常量冻结**：`constants.ts` `CAP_CHUNKED_UPDATE = 0x00000001`（ADR 0013:22 冻结值），经 `index.ts` 导出。
- **HELLO/HELLO_ACK codec 零改动**（payloads.ts HELLO 区段、negotiation.ts 不在 diff）：bit 经既有 uint32 BE 字段承载；
  字节级 roundtrip 用例（:332-370）以既有 HELLO golden 的 [42,50) 字符位锁定字段位置；`selectCapabilities`
  交集/拒绝矩阵 5 断言（:324-330）。
- **门控**（payloads.ts `decodeMessage`）：`decodeFrame` → `resolveSelectedCapabilities`（急切）→
  `header.messageType===0x42 && ((selected ?? 0) & CAP_CHUNKED_UPDATE)===0` → `UNSUPPORTED_MESSAGE_TYPE`，
  **先于 payload 解析**。分类由连接注册表单点导出：契约断言 scope=connection / fatal=true / retryable=no /
  wsCloseCode=1002（:372-385）——与「既有未知消息码规则」同码同 close code（envelope.ts 步骤 6 同码）。
- **急切校验作用域（SA2 F3 钉死）**：`limits.ts` `resolveSelectedCapabilities` 与 `resolveExpectedSequence`
  判据逐字对称（非安全整数/负/>0xffffffff → CPV，响亮不 clamp）；契约 :405-414 双向锚（非 0x42 帧+非法值 → CPV；
  同帧+合法值 → 正常解码，无假拒绝）。实现把该校验置于 `decodeMessage` 入口、与消息类型无关 ✅。
- **缺省 fail-closed / v1 回落**：不传选项 = 未协商 = 拒绝（:374 `undefined` 分支 + :416-423 v1 支持集 selected=0 → fatal）；
  `ws-replication/src/frame-io.ts` 零改动（不在 git status）→ `decodeInbound` 调用形不变 → v1 行为逐字节不变，
  「新旧实现互不破译」由构造成立并在协议包内可执行验证。
- **encode 不门控**（设计 D-3）：`encodePayload` UPDATE_CHUNK case 无条件编码——golden/fuzz 需要，发送端 gating
  属后续切片。

### AC4：两错误码注册表单点导出（VIOLATION fatal/no/failed；TOO_LARGE fatal/config/failed）；RESYNC reason append-only ✅

- **注册表**：`errors.ts` +2 条（`namespaceError` 签名实测 `(code, fatal, retryable, terminalState)`）：
  `UPDATE_TRANSFER_VIOLATION`(true,'no','failed') / `UPDATE_TRANSFER_TOO_LARGE`(true,'config','failed')——
  与 Issue AC 及 ADR 0013:80 逐字一致；恰 22 条、深冻结、既有 20 条 diff 纯追加（append-only 核验通过）。
- **单点导出**：ERROR wire 位推导、`lookupError` 双表、`ProtocolError` 元数据全部走既有机制（errors.ts 推导区段不在 diff，
  自动覆盖新码）；契约 AC4 7 用例：元数据全等、22 条+抽样锚+冻结、lookupError 双向 scope 隔离、
  ERROR roundtrip + 推导位前缀（`'19'`=25=两码名长 ✅）+ badBits 不一致 → MALFORMED_FRAME、ProtocolError 显式 scope 消解。
- **RESYNC reason**：codec 层维持「非空 varString」校验（设计 D-5：无发射点不预造代码枚举）；
  `UPDATE_TRANSFER_EXPIRED` 以 roundtrip golden 锁定可上 wire（:507-515，空理由仍拒 ✅）；
  词表由文档 §9.4 **首次定义**并登记（含既有唯一发射码 `send-queue-overflow` 以源码实据成文，未虚构——SA4 已核发射点，本审查抽查一致）。

### AC5：协议包全量测试与 typecheck 绿 ✅（按 §17 证据链；SA10 未重跑，静态核验日志）

| 证据 | 命令 | 结果 | 核验 |
|---|---|---|---|
| P1 | `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run --typecheck packages/replication-protocol` | exit 0，10 文件 169/169，Type Errors none | 含契约 28/28 与既有 9 文件全量；`_sa3_green.log`:1-6 |
| P2 | `pnpm exec tsc -p packages/replication-protocol/tsconfig.json` | exit 0 | `_sa3_green.log`:8-10 |
| P3 | root `pnpm typecheck`（逐包链含 ws-replication） | exit 0 | 编译器自证 D-8 两处穷尽 switch 恢复；`_sa3_green.log`:12-14 |
| P4 | root `pnpm test` | exit 1，唯一失败 = `apps/yjs-server/test/stdin-error-chain-red.test.ts` F1 race；replication-protocol 与 ws-replication 测试文件零失败 | 归因见 §6-P4；`_sa3_green.log`:17-35 |

数字链自洽：设计 R3 基线 167 → P1 169 = +2（golden 新 it + test-d 新 it）；R4 2394 → P4 2396 同 +2；无隐藏排除。

## 3. 冻结 wire 值总表（SA10 独立比对 ADR 0013 ↔ 实现 ↔ 契约）

| 冻结面 | ADR 0013 | 实现 | 契约锚点 | 结论 |
|---|---|---|---|---|
| 消息码 | 0x42 | `MESSAGE_TYPES.UPDATE_CHUNK = 0x42` | AC1:175 | ✅ |
| scope/direction/ack | namespace / — / UPDATE_ACK 复用 | `'namespace','either','UPDATE_ACK'` | AC1:177-182 | ✅（direction='either' 与 §5 表登记一致） |
| 字段序 | ns→transferId→index→count→totalBytes→bytes | decode/encode 同序 | AC1:225-232 + 三向量 hex | ✅ |
| transferId 域 | uint32，从 1 递增，0 非法 | decode `transferId<1` 拒；encode 同 | AC2:294、:312-313 | ✅ |
| chunkIndex/chunkCount | 0-based / ≥1 | `count<1` 拒、`index>=count` 拒 | AC2:292-293 | ✅ |
| totalBytes | 完整字节数 | `bytes>totalBytes` 拒 | AC2:296 | ✅ |
| bytes | 非空（实现面）、≤ maxUpdateBytes | 空拒 + `UPDATE_TOO_LARGE` | AC2:295、:299-306 | ✅ |
| CAP bit | 0x00000001 | `CAP_CHUNKED_UPDATE = 0x00000001` | AC1:183 | ✅ |
| 错误码元数据 | VIOLATION fatal/no/failed；TOO_LARGE fatal/config/failed | errors.ts 两条 | AC4:429-447 | ✅ |
| RESYNC reason | UPDATE_TRANSFER_EXPIRED（非终态） | 文档登记 + codec roundtrip | AC4:507-515 | ✅ |
| envelope | version 恒 1、flags 恒 0 | envelope.ts 零改动 | AC1:204-215 header 断言 | ✅ |

## 4. 兼容性与 scope 核验

- **append-only**：消息码 0x42 / bit 0x1 / 错误码 ×2 / reason ×1 全部新增于既有注册表尾部；零重编号、零重解释
  （diff 逐 hunk 核验：既有条目行零改动，仅计数注释 17→18 / 20→22 同步）。
- **运行时行为零变化**：`frame-io.ts` 不在 diff（decodeInbound 不传选项 → 缺省未协商 → 0x42 消息层先拒）；
  HELLO 发送端 `optionalCapabilities:0`/`selectedCapabilities:0` 两处（peer-connection:333 / hub-connection:707）不在 diff；
  R1/R2/R3 基线刻画测试未触碰。
- **D-8 补丁边界**：`git diff packages/ws-replication/` 恰两个 hunk（hub-connection.ts:790-795 / peer-connection.ts:521-526），
  各一个 `case 'UPDATE_CHUNK'` + 3 行不可达性注释 + `this.connectionFatal('UNSUPPORTED_MESSAGE_TYPE', 1002); return;`——
  与设计 §7 D-8 代码块逐字一致；运行时构造性不可达论证链（缺省门控先拒 → catch 链同码同 1002 收口）复核成立；
  分类与 decode 层自镜像，fail-loud 非 no-op。
- **DENY 面零触碰**：`canonical.ts` / `envelope.ts` / `package.json` / `docs/adr/*` / `apps/**` / `packages/vfsl-codegen` /
  ws-replication 其余文件均不在 git status。无 scope creep。
- **公共 API 面**：仅经 `index.ts` 追加 `CAP_CHUNKED_UPDATE` + `type UpdateChunkMsg`（包 AGENTS 约束遵守）；
  `codec-api.test-d.ts` 追加类型断言（联合 extract 全等、常量数字型、DecodeOptions 新字段）。

## 5. 文档义务核验（ADR 0013「落地时须修订」）

- `docs/protocols/instance-replication-v1.md`：§5 增 0x42 行 + 未协商拒绝说明；§6.1 首次成文 capability bitset 词表
  （bit 0x00000001 登记）；§9.4 首次定义 reasonCode 词表并登记 `UPDATE_TRANSFER_EXPIRED`（含既有 `send-queue-overflow`
  实据登记）；新增 §10.3 字段表 + codec 级规则（与 ADR/实现逐条一致，含门控先于 payload 解析、close 1002）；
  §13.2 增两码行 + 语义注；§22 conformance 增分块验收面。✅
- `CONTEXT.md`：既有「分块复制传输」词条下增补 UPDATE_CHUNK 与 CAP_CHUNKED_UPDATE 两词汇（含 Avoid 引导）。✅

## 6. 偏差与披露项（PR 必须披露）

1. **D1 红灯契约单行操作数修复**（SA3 §2 披露，SA4 §3-D1 裁决接受，SA10 复核同意）：
   `codec-issue242-ac-red.test.ts:394` `(CAP_BIT | 0x80000000) >>> 0`。
   原式经 JS int32 位运算得 -2147483647，与同契约「负值 → CPV」用例及设计 D-3 uint32 判据互斥（不可同时满足）；
   修复还原作者意图值 0x80000001（位 0 + 多余高位），断言语义不变、未弱化任何断言；红期该行从未被执行
   （用例在 :389 帧级拒绝处即失败，`_ac_red.log` 栈帧实证）；28 用例名集合与红期日志逐名一致。**非阻断。**
2. **P4 root `pnpm test` 单例失败归因**（设计 §17-5 规则内）：唯一失败 `stdin-error-chain-red.test.ts` F1 race 为
   **先在环境性 flake**——设计阶段 R4 在未实施树上同一文件已失败（`_regression.log` 尾部），历史 flake 史见
   issue #138 SA7 报告；本任务因果通路静态排除（decodeInbound 调用形不变、v1 流量对新增路径恒不触发、apps 零改动）；
   SA3 隔离复跑 exit 0（4/4）。replication-protocol 与 ws-replication 测试文件零失败。未对该文件做任何修改（DENY 遵守）。
   **AC5 的协议包面（P1/P2/P3）全绿；该失败不属本任务回归，但必须在 PR 中如实披露。**
3. **未达成项（设计 §13 残余，属后续切片，PR 应列为 not-yet-achieved）**：发送端切片、接收端 assembly 状态机、
   `maxChunkedUpdateBytes`/`maxChunksPerUpdate`/`assemblyTimeoutMs` 等配置链、observer 四事件、
   跨帧一致性/顺序校验（transferId 单调、`chunkIndex===已收数量`、实收==totalBytes）、两错误码与 reason 的真实发射点、
   D-8 两处镜像 case 待真实分发逻辑替换、真实跨版本二进制互跑（当前为包内 v1 支持集模拟：selected=0 → 1002 fatal）。
   这些均为 Issue 明示非目标（「本票只交付协议包能力」），**不构成 partial/unmet**。
4. **ADR 冲突复查**：设计 §15 标记必要（ADR 0013 提议态 + wire 冻结面 + D-3/D-8 表述），由 Controller 路由；
   本审查未发现新维度，不重复提交 `requiresConflictRecheck`。

## 7. Non-blocking observations（MINOR，不阻断 approve）

1. SA3 报告 §5「21 已跟踪修改」与 git 实测 18 不符（清单逐项准确，仅总数笔误；SA4 §12-O2 已记录）。
2. `_sa3_green.log` P4 段仅记录失败文件名+时长，未含 FAIL 断言详情块；归因靠多链交叉（SA4 §12-O3 已记录）。
   建议后续转绿日志保留失败详情。
3. `frame-io.ts:75` `namespaceFieldViolation` 对 UPDATE_CHUNK 走 default → undefined：本切片构造性不可达
   （缺省门控先拒），后续「已协商接收」切片实装分发时须同步评估（SA4 §12-O4 / SA2 O-C 已记录备查）。
4. 真实旧二进制互跑证据为包内模拟（设计 §13 已记录为残余）——协议包层可达成最强证据，不阻断本切片。

## 8. 结论

当前实现忠实满足 Issue #242 正文（What to build 四项 + 「只交付协议包能力」约束）与全部五条验收标准，
冻结 wire 值与 ADR 0013 逐字一致，codec 校验/拒绝顺序、capability fail-closed 门控、append-only 兼容面、
错误注册表单点导出、文档义务与测试覆盖（28 用例契约 + 既有面 append-only 翻转）全部落实到位；
唯一实现偏差（D1）经两级独立复算裁决为测试作者笔误修复，语义不变。无遗漏、无部分实现、无错误实现、无 scope creep。

— SA10，issue #242 规范符合性审查完毕。Verdict：**approve**。
