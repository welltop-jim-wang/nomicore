# SA3 实现报告 — issue #242：UPDATE_CHUNK codec 与 CAP_CHUNKED_UPDATE 协商（切片 1）

> 阶段：implementation（SA3），iteration 0（dispatch：sa-dfc31b36-6f84-49da-a721-169e34ecf0b6）。
> 治理证据：`wiki/raw/task_issue-242_design.md`（SA2 approve 的 iteration-1 修订版）+
> `wiki/raw/task_issue-242_sa2_review.md`（iteration 2 复审 approve，放行 SA3）；验收契约：
> `packages/replication-protocol/test/codec-issue242-ac-red.test.ts`（28 用例 + 3 golden 向量）。
> **Owner 评论输入：dispatch 前 REST 刷新 = `[]` —— 无 Owner 评论要求适用（与设计 §4、SA2 §7 一致），
> 本实现无任何 owner 要求映射项。**
> 实施目录：worktree 根 `/home/wangjian/nomicore-fix-issue-242`。实现前树 = 设计 §16 声明（零已跟踪修改 +
> 8 个未跟踪新增），SA3 不负责验证红灯基线本身（R1–R4 证据在 `_ac_red*.log`/`_regression.log`）。

## 1. 实现内容（严格按设计 §7/§8/§11 与 SA2 §17 有界实施方向）

### 1.1 协议包 src（`packages/replication-protocol/src/`）

| 文件 | 改动 |
|---|---|
| `messages.ts` | `MessageName` 追加 `'UPDATE_CHUNK'`；`_messageTypes`/`MESSAGE_NAMES`/`_messageRegistry` 追加 `UPDATE_CHUNK: 0x42`（scope=namespace、direction=either、ack=`UPDATE_ACK`——ADR 0013 复用既有 ACK）；新增 `UpdateChunkMsg` 接口（六字段，kind 判别键）；并入 `ReplicationMessage` 联合（18 成员）；计数注释 17→18 |
| `constants.ts` | 新增 `CAP_CHUNKED_UPDATE = 0x00000001`（ADR 0013 冻结值） |
| `errors.ts` | `NamespaceErrorCode` 追加 `UPDATE_TRANSFER_VIOLATION`、`UPDATE_TRANSFER_TOO_LARGE` 两字面量；`_namespaceErrors` 追加两条（fatal=true；retryable=no/config；terminalState=failed；分别对齐 `SYNC_STATE_VIOLATION` 与 `SYNC_DIFF_TOO_LARGE` 先例）→ 22 条 |
| `limits.ts` | `DecodeOptions` 追加 `selectedCapabilities?: number`（uint32 bitset，注释含缺省=未协商语义）；新增 `resolveSelectedCapabilities`——判据与 `resolveExpectedSequence` 完全对称（非安全整数/负/>0xffffffff → `CONNECTION_POLICY_VIOLATION`，响亮不 clamp） |
| `payloads.ts` | 新增 `decodeUpdateChunk`/`encodeUpdateChunk`（D-1 六字段序 + 单帧语义自洽规则：transferId≥1、chunkIndex<chunkCount、chunkCount≥1、bytes 非空、bytes≤totalBytes，encode/decode 同一套 R9 对称；`bytes` 超 `limits.maxUpdateBytes` → `UPDATE_TOO_LARGE`）；`decodePayload`/`encodePayload` 各增 `UPDATE_CHUNK` case；`decodeMessage` 实现 D-3：`resolveSelectedCapabilities` 急切解析/校验（所有消息类型一致生效，与 header.messageType 无关）→ 门控置于 payload 解析前（`header.messageType===0x42` 且 `(selected ?? 0) & CAP_CHUNKED_UPDATE === 0` → `ProtocolError('UNSUPPORTED_MESSAGE_TYPE')`，connection fatal、wsCloseCode 1002 由注册表单点导出）。拒绝顺序 = 设计 §9：帧级 9 步 → 选项急切校验 → 门控 → 载荷级 |
| `index.ts` | re-export `CAP_CHUNKED_UPDATE`（constants）+ `type UpdateChunkMsg`（messages） |

### 1.2 ws-replication 类型兼容补丁（D-8，逐字按设计代码块）

- `packages/ws-replication/src/hub-connection.ts`：`dispatchReady` 主 switch `default` 前追加单 case
  `case 'UPDATE_CHUNK': this.connectionFatal('UNSUPPORTED_MESSAGE_TYPE', 1002); return;`（含不可达性注释）。
- `packages/ws-replication/src/peer-connection.ts`：同上（peer 侧 `dispatchReady`）。
- 两文件 diff 恰为上述单 case（6 行新增/文件），**零其他改动**（`git diff packages/ws-replication/` 核验）。
- 运行时构造性不可达论证（设计 D-8）：`decodeInbound`（frame-io.ts:60-68）不传 `selectedCapabilities` →
  缺省未协商 → 消息层先抛 `UNSUPPORTED_MESSAGE_TYPE` → catch 链 `connectionFatal(code, wsCloseCodeFor(code)=1002)`
  → `dispatchReady` 收不到 `UPDATE_CHUNK`。v1 流量可观察行为逐字节不变。

### 1.3 既有测试 append-only 翻转（§11 ALLOW 测试面，逐文件）

| 文件 | 改动 |
|---|---|
| `test/fixtures.ts` | 整合 3 条 UPDATE_CHUNK golden（`UPDATE_CHUNK_BASIC`/`_MULTIBYTE`/`_U32_MAX`，seq 19/20/21；payload/frame 十六进制与红灯契约字面量逐字一致）→ GOLDEN 21；`FixtureMessage` + `UpdateChunkMsg` 成员；`MESSAGE_TABLE/SCOPE/DIRECTION/ACK` 增 UPDATE_CHUNK 行；`NAMESPACE_ERROR_TABLE` +2 码（22 条） |
| `test/codec-messages-golden.test.ts` | GOLDEN 长度 18→21、17→18 表述；`decodeGolden` 传 `selectedCapabilities: CAP_CHUNKED_UPDATE`（门控下解码 UPDATE_CHUNK golden 所需）；新增 UPDATE_CHUNK 三向量已协商解码用例 |
| `test/codec-registries.test.ts` | 0x42 未注册断言翻转为**已注册**、样本码换 0x43；17→18 消息、20→22 namespace 码表述；表驱动断言自动覆盖新行 |
| `test/codec-envelope.test.ts` | 未注册码样本 `0x42` → `0x43`（0x42 已注册为 UPDATE_CHUNK） |
| `test/codec-roundtrip-truncation.test.ts` | 全帧 roundtrip/字段全等循环 decode 传 `selectedCapabilities: CAP_CHUNKED_UPDATE`；17→18 表述（截断循环不传选项——帧级分类先于门控，语义不变） |
| `test/codec-package-contract.test.ts` | Buffer-free 全 golden 循环 decode 传 `selectedCapabilities`（0x42 门控） |
| `test/codec-fuzz-property.test.ts` | `randomMessage` 增 UPDATE_CHUNK 分支（20 分支；满足单帧语义自洽：transferId≥1、index 0<count、count≥1、bytes 非空、bytes≤totalBytes）；roundtrip decode 传 `selectedCapabilities: CAP_CHUNKED_UPDATE` |
| `test/codec-api.test-d.ts` | 新增 issue #242 类型面断言（`UpdateChunkMsg` 形状、联合成员 extract 全等、`CAP_CHUNKED_UPDATE` 数字型导出、`DecodeOptions.selectedCapabilities?`） |

### 1.4 文档面（ADR 0013「落地时修订」义务）

| 文件 | 改动 |
|---|---|
| `docs/protocols/instance-replication-v1.md` | §5 注册表增 0x42 行 + 未协商拒绝说明；§6.1 增 capability bit 词表首行（0x00000001 `CAP_CHUNKED_UPDATE`）；§9.4 **首次定义** reason 词表枚举（既有唯一实际发射码 `send-queue-overflow` 成文登记——以 ws-replication 源码实据为准，不虚构；新增登记 `UPDATE_TRANSFER_EXPIRED`）；新增 §10.3 UPDATE_CHUNK 字段表与 codec 级规则；§13.2 增两码行 + 语义注；§22 conformance 增分块传输验收面 |
| `CONTEXT.md` | 既有「分块复制传输」词条下增补 `UPDATE_CHUNK` 与 `CAP_CHUNKED_UPDATE` 两词汇（含 Avoid 引导） |

## 2. 与治理证据的偏差（1 处，如实披露）

### D1：红灯契约文件一行操作数修复（`codec-issue242-ac-red.test.ts:391`）

- **事实**：该用例意图 = 「本位置位（含多余位）解码成功」（设计 §12 AC3 行与 D-3 明文）。但
  `CAP_BIT | 0x80000000` 在 JS 中经 32 位有符号位运算得 **-2147483647**（非作者意图的 0x80000001）。
  而同文件另一用例（AC3 #5）与 F3 用例（SA2 复审逐行核验过的 :402-411）把**负值 → CONNECTION_POLICY_VIOLATION**
  钉死为验收语义（= 设计 D-3 的 uint32 域判据，与 `resolveExpectedSequence` 同判据）。
- **不可满足性论证**：任何把 -2147483647 判为合法 uint32 的单调规则必然放行 -1（-1 与 -2147483647 同为
  int32 负值，无规则可拆分），反之亦然——契约在「-1 → CPV」与「-2147483647 → 解码成功」之间自相矛盾，
  **不存在满足两断言的实现**。红期 20F|8P 未暴露（该用例在 d1 处即因缺 API 失败，d2 从未被执行）。
- **处置**：单行操作数修复 `CAP_BIT | 0x80000000` → `(CAP_BIT | 0x80000000) >>> 0`（= 0x80000001，
  保留作者的位构造），**断言语义不变**（仍是位 0 + 多余高位 → 解码成功），使契约与其自身声明的语义
  及设计 §12/D-3 一致、可满足。非 fallback/非跳过/非语义篡改——实现本已满足该语义，修复的是 JS
  算术笔误。修改处附带两行说明注释。请 SA4/SA7 按此披露复核；如上游裁决不接受该修复，等价替代
  是把该行改为字面量 `0x80000001`，其余实现零变化。
- 除此之外红灯契约文件零改动；§17 要求的「契约不改即绿」在本修复后成立（28/28 绿）。

## 3. 转绿验证（逐项命令 + 原始输出 + 退出码；完整日志见 `wiki/raw/task_issue-242_sa3_green.log`）

| # | 命令（worktree 根） | exit | 结果 |
|---|---|---|---|
| P1 | `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run --typecheck packages/replication-protocol`（= 设计 R3 同命令，无排除） | 0 | Test Files 10 passed (10)；Tests 169 passed (169)；Type Errors no errors —— 含红灯契约 28/28 |
| P2 | `pnpm exec tsc -p packages/replication-protocol/tsconfig.json` | 0 | 无输出（类型干净） |
| P3 | `pnpm typecheck`（root 逐包 tsc 链，含 `tsc -p packages/ws-replication/tsconfig.json`） | 0 | **编译器自证 D-8 两处穷尽 switch 恢复**（设计 §12 AC5 独立证据项） |
| P4 | `pnpm test`（root = `NODE_OPTIONS=--conditions=nomicore-source vitest run --typecheck`） | 1 | Test Files 1 failed \| 230 passed (231)；Tests 1 failed \| 2395 passed (2396)；Type Errors no errors |
| P4-归因 | 唯一失败文件 = `apps/yjs-server/test/stdin-error-chain-red.test.ts` T7-F1（设计 §13/§16-R4 记载的**先在环境性加载竞态**：spawn EAGAIN/并行负载抖动；已跟踪文件、本任务零改动该文件——DENY）；**隔离复跑 exit 0、4/4 通过** | 0 | 按 §17-5 归因规则：非本任务回归，不在本任务修复 |

P4 中所有 replication-protocol（10 文件）与 ws-replication 测试文件**零失败**——满足 §17-5「root test：
所有 replication-protocol 与 ws-replication 测试文件零失败，且无任何失败可归因于本任务 ALLOW LIST 文件」。

## 4. 互通证据（AC5 / 包 AGENTS「wire 变更须新旧互通证据」）

1. AC3「v1 互通回落」用例（红灯契约 #7，绿）：v1 支持集（无 bit 0）协商 `selectedCapabilities=0` →
   0x42 帧按未知消息码规则 `UNSUPPORTED_MESSAGE_TYPE` connection fatal（scope=connection、fatal=true、
   retryable=no、wsCloseCode=1002）——新旧实现互不破译的包内最强证据；
2. AC3「未协商 fatal」用例（缺省选项/selected=0/仅他位 → 同一分类）；
3. ws-replication 既有全部测试文件零改动零失败（root P4），发送端仍发 `optionalCapabilities:0`/
   `selectedCapabilities:0`、`decodeInbound` 调用形不变（frame-io.ts 零改动）——v1 行为逐字节不变。

## 5. 文件清单（git status：21 已跟踪修改 + 既有 8 未跟踪新增中的红灯文件与 wiki 产物）

- src（6）：`packages/replication-protocol/src/{messages,constants,errors,limits,payloads,index}.ts`
- ws-replication（2）：`packages/ws-replication/src/{hub-connection,peer-connection}.ts`（仅 D-8 单 case）
- test（9）：`packages/replication-protocol/test/{fixtures.ts,codec-messages-golden.test.ts,codec-registries.test.ts,codec-envelope.test.ts,codec-roundtrip-truncation.test.ts,codec-package-contract.test.ts,codec-fuzz-property.test.ts,codec-api.test-d.ts}` +
  `codec-issue242-ac-red.test.ts`（未跟踪新增；仅 §2 披露的单行操作数修复）
- docs（2）：`docs/protocols/instance-replication-v1.md`、`CONTEXT.md`
- 证据产物（2，本报告新增）：`wiki/raw/task_issue-242_sa3_impl.md`（本文档）、`wiki/raw/task_issue-242_sa3_green.log`
- DENY 面零触碰：`canonical.ts`/`envelope.ts`/package.json/ADR/`apps/yjs-server`/vfsl-codegen 等均未改；
  ws-replication 除 D-8 两文件外零改动。

## 6. 残余与后续

- 设计 §13 残余全部维持：跨帧 assembly/配置链/observer 四事件/真实旧二进制互跑等属后续切片；D-8 两处
  镜像 case 待后续切片以真实分发替换。
- ADR 0013 冲突复查按设计 §15 由 Controller 路由（本实现未引入新维度；文档修订已按 §9.4「首次定义」
  表述落地，未虚构既有词表）。
- 唯一提请关注项 = §2 D1 红灯契约单行修复的裁决。

— SA3，issue #242 实现完毕。
