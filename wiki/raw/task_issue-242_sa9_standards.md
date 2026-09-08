# SA9 标准审查 — issue #242：UPDATE_CHUNK codec 与 CAP_CHUNKED_UPDATE 协商（切片 1）

> 评审人：SA9（独立 Standards 审查），final review group issue-242-final-review-0，iteration 0。
> 审查对象：worktree HEAD/diff（18 已跟踪修改 + 10 未跟踪新增）+ SA1/SA2/SA3/SA4 产物。
> **Issue-comment REST 输入于本 dispatch 前刷新为 `[]`——无 Owner 评论要求适用（已记录）**；
> 与任务简报 §Comments 空、设计 §4、SA2 §7、SA3 报告头、SA4 头部一致。
> 纪律声明：SA9 未修改任何代码/设计/测试、未运行测试、未启动服务；全部结论基于源码、diff、
> 文档与日志的静态核验 + 手工算术复算。本文件是唯一写产物。

## 1. Verdict

**approve**（无 BLOCKER / 无 MAJOR；3 条 MINOR 均不阻断，见 §8）。

## 2. Reviewed inputs

| 输入 | 核验方式 |
|---|---|
| `wiki/raw/task_issue-242.md`（Issue 正文 + 5 AC）/ `_dispatch.md` | 已读；评论空与 dispatch 记录一致 |
| `wiki/raw/task_issue-242_design.md`（364 行，SA2 iteration-2 approve 版） | §7 D-1~D-9、§11 ALLOW/DENY、§12、§16/§17 逐项对照实现 |
| `wiki/raw/task_issue-242_sa2_review.md`（iteration 2 approve） | F1/F2/F3/F4 复核结论与影响面重推导表已读 |
| `wiki/raw/task_issue-242_sa3_impl.md` + `_sa3_green.log` | §2 D1 披露、§3 P1–P4 转绿表逐项复核 |
| `wiki/raw/task_issue-242_sa4_review.md`（approve） | 已全文读取；本次独立复核其关键论断而非采信结论 |
| 实际 diff（`git diff` 18 文件逐 hunk）+ 未跟踪红灯契约文件全文（516 行） | 逐 hunk/逐行读取 |
| `docs/adr/0013-chunked-live-update-transfer.md` | 冻结 wire 值逐项比对（见 §3） |
| `docs/protocols/instance-replication-v1.md` diff、`CONTEXT.md` diff | 逐 hunk 读取；§9.4「唯一既有 reason」主张已对源码实证（见 §5） |
| 根/包 AGENTS（root、replication-protocol、ws-replication、docs） | 边界与验证门逐条对照（见 §4） |
| 四份证据日志（`_ac_red.log` 432 行 / `_ac_red_typecheck.log` 33 行 / `_regression.log` 681 行 / `_sa3_green.log` 35 行） | 命令/输出/退出码三件齐核验 + 数字链复算（见 §6） |

## 3. ADR / 治理一致性

| 治理锚点 | 实现证据 | 结论 |
|---|---|---|
| ADR 0013：0x42 UPDATE_CHUNK，字段序 namespaceId→transferId→chunkIndex→chunkCount→totalBytes→bytes | `messages.ts`（0x42、scope=namespace、direction=either、ack=UPDATE_ACK）；`payloads.ts:651-726` 解码/编码字段序逐字一致；红灯契约三条 golden 的字节序由 AC1 字段序切片断言锁定 | ✅ |
| ADR 0013：`CAP_CHUNKED_UPDATE = 0x00000001`，交集经既有 `selectedCapabilities` 机制；envelope version 恒 1 / flags 恒 0 | `constants.ts:40-45`；HELLO/HELLO_ACK codec 零改动（不在 diff）；golden header 断言 version=1/flags=0/reserved=0 | ✅ |
| ADR 0013：`UPDATE_TRANSFER_VIOLATION`（fatal/no/failed）对齐 SYNC_STATE_VIOLATION；`UPDATE_TRANSFER_TOO_LARGE`（fatal/config/failed）对齐 SYNC_DIFF_TOO_LARGE 语义族；连接级 registry 零新增 | `errors.ts:136-140` 逐字一致；`NAMESPACE_ERRORS` 20→22 append-only；CONNECTION_ERRORS 不动 | ✅ |
| ADR 0013：`RESYNC_REQUIRED.reasonCode` 词表追加 `UPDATE_TRANSFER_EXPIRED`（非终态） | 文档 §9.4 首次定义词表并登记；codec 仅非空校验 + roundtrip golden（D-5：无发射点不预造枚举） | ✅ |
| ADR 0013：chunk 大小复用 `maxUpdateBytes`（零新 frame 级上限）；ACK 复用 UPDATE_ACK | `payloads.ts:685-690,713-718` 复用 `resolveFieldLimit(limits?.maxUpdateBytes)`，超限 → 既有 `UPDATE_TOO_LARGE`；registry ack 列 = UPDATE_ACK | ✅ |
| ADR 0013「本票只交付协议包能力」+ ADR 0010 §5「未来扩展只能在 HELLO 明确协商后使用」 | 发送端 HELLO 仍 `optionalCapabilities:0`/`selectedCapabilities:0`（peer:333/hub:707 不在 diff）；`decodeInbound` 调用形不变；未协商 0x42 → 消息层 `UNSUPPORTED_MESSAGE_TYPE`（registry 导出 connection fatal / 1002），与 v1 帧层「未注册」拒绝同码同 close code | ✅ |
| 包 AGENTS（replication-protocol）：append-only 兼容注册表、fail-closed、零重编号、公共 API 只经 index.ts、codec 保持 transport/Registry 无关 | 全部满足；index.ts 仅 +2 行导出；canonical.ts/envelope.ts 零改动（DENY 遵守） | ✅ |
| 包 AGENTS Verification：wire 变更须 root `pnpm typecheck` + `pnpm test` + 新旧互通证据 | P3 root typecheck exit 0；P4 root test 归因（§6）；互通证据 = AC3 v1 回落用例（v1 支持集 → selected=0 → 1002 fatal）+ 既有 ws-replication 用例零变化 | ✅ |

## 4. 架构、模块责任与单一事实源

- **责任归属**：wire codec/门控/敌意拒绝全部在 replication-protocol（byte codec Owner）；发送切片/assembly/配置链正确缺席（后续切片）；两处穷尽 switch 的类型兼容 case 位于拥有该 switch 的连接类内。✅
- **单一事实源**：消息/错误元数据仍由冻结注册表单点导出；fixtures 镜像表由 registries 测试逐键断言锁同步；库层不持有第二协商状态（`selectedCapabilities` 由调用方传入，缺省 = 未协商）。无旁路、无第二缓存、无 marker 反推。✅
- **惯例对称**：`resolveSelectedCapabilities`（limits.ts:69-77）与 `resolveExpectedSequence`（:61-67）判据逐字对称（非安全整数/负/>0xffffffff → CONNECTION_POLICY_VIOLATION，响亮不 clamp）；uint32 字段族全复用 `readVarUint32`/`writeVarUint32`，零新编码原语；限额复用与 `decodeUpdate`/`encodeUpdate` 同款调用形。✅
- **生命周期对称性**：纯函数 codec 无资源面；D-8 case 走既有 `connectionFatal` 收口链，无新生命周期。✅
- **穷尽性完备性独立复核**：全仓 grep `never: never = message` 在源码中恰 3 处——`payloads.ts:813`（encodePayload，本包内已随实现扩容）+ `hub-connection.ts:797` + `peer-connection.ts:528`（即 D-8 两处，已补 case）；`apps/**` 无 `Record<MessageName,…>`/穷尽 switch 面。SA2 的影响面重推导结论成立。✅

## 5. 范围控制与文档一致性

- **ALLOW/DENY**：18 个已跟踪修改全部落在设计 §11 ALLOW LIST（6 src + 2 ws-replication 窄例外 + 8 test + 2 docs）；DENY 面（canonical.ts / envelope.ts / package.json / ADR / apps/** / vfsl-codegen / ws-replication 其余文件）零触碰——`git status`/`git diff` 实证。ws-replication 两文件 diff 恰为各 6 行单 case（含注释），与设计 D-8 代码块逐字一致。✅
- **docs/AGENTS**：CONTEXT.md 在既有「分块复制传输」词条下增补 UPDATE_CHUNK / CAP_CHUNKED_UPDATE 两词汇（含 Avoid 引导）✅；协议文档修订与代码行为同批 ✅；文档只登记有源码实据的事实——§9.4「`send-queue-overflow` 为既有唯一实际发射码」经源码实证（RESYNC_REQUIRED 发射点恰为 hub-namespace:792 / peer-namespace:923,944；`target-removed` 属 CLOSE_NAMESPACE 字段、`REAUTH_REQUIRED` 属 GOAWAY 词表，未混入）✅；`git diff --check` 干净 ✅；无陈旧「17 条」计数残留（grep 实证）✅。
- **回滚面**：纯 append-only，删新注册项/常量/选项 + 回退两处 case 即回 v1；无数据迁移。✅

## 6. 测试质量与证据完整性

- **红灯契约**（516 行，28 用例 = AC1×6 + AC2×8 + AC3×7 + AC4×7，实数清点一致）：覆盖全字段 golden 逐字节锁定（含独立 `PINNED_FRAME_HEX` 字面量锚，fixtures 的 buildFrameHex 派生路径被 AC1 用例钉到字面量，无自指空洞）、逐 byte offset 截断、非 canonical LEB128、超 uint32 域、非法 UTF-8/namespaceId、尾随字节、超声明 bytes（含 2^32 巨额声明的分配前拒绝）、单帧语义自洽、限额复用、encode 侧 R9 对称、交集矩阵、字节级 bit roundtrip、未协商 fatal（scope/fatal/retryable/1002 全等）、急切校验作用域双向钉死（非法值 → CPV 且与消息类型无关；合法值无假拒绝）、v1 互通回落、注册表 22 条 + 冻结 + 位推导 + badBits 拒绝 + `lookupError` 双向 + RESYNC reason roundtrip。**无 skip/only/todo**（全仓 grep 实证）。✅
- **golden 算术独立复算**：600→`d804`、300→`ac02`、63→`3f`、64→`40`、2^22→`80808002`、0xffffffff→`ffffffff0f`、0xfffffffe→`feffffff0f`；payloadLength 45/50/58 = 0x2d/0x32/0x3a；20-byte 头（NMCR/01/42/00/00/seq BE8/len BE4）逐字节相符。✅
- **红 → 绿链自洽**：R1 exit 1（20F|8P，失败全部且仅为缺失实现）→ R2 exit 2（21 个类型错误全部在红灯文件、全部缺失 API；其行号与 D1 修复前的文件版本一致，与披露相符）→ R3 exit 1（既有 9 文件 139 用例零失败，红灯文件失败如实可见、无隐藏排除）→ P1 exit 0（10 文件 169 = 167+2）/ P2 exit 0 / P3 root typecheck exit 0（编译器自证穷尽性恢复）。数字链 147=139+8、169=167+2、2396=2394+2、Errors 21≡R2，逐环复算一致。✅
- **P4 唯一失败归因**（`apps/yjs-server/test/stdin-error-chain-red.test.ts` F1 race）：SA4 的四链归因（未实施树 R4 中同文件同形态失败、更早 commit 的 flake 史、因果通路排除、隔离复跑 exit 0 4/4）我逐项复核成立；该文件为已跟踪文件且不在本任务 ALLOW LIST，本任务对其零改动，设计 §13/§17-5 已预置归因规则与 DENY。**非本任务回归，不阻断。** ✅
- **D1 披露复核**：红灯契约 :394 `(CAP_BIT | 0x80000000) >>> 0`——JS 中 `1 | 0x80000000` 经 int32 位运算 = -2147483647（负值，与同文件「负 → CPV」用例互斥），`>>> 0` 还原 0x80000001（位 0 + 多余高位）；断言语义（已协商含多余位 → 解码成功）不变，与设计 D-3 uint32 域判据自洽。属测试作者笔误的单行操作数修复，披露充分、SA4 已裁决接受，SA9 独立复算同意。**非弱化、非 skip、非语义篡改。** ✅

## 7. 回归面

v1 流量可观察行为逐字节不变：`decodeInbound`（frame-io.ts:58-67）不传选项 → 缺省未协商 → 0x42 在消息层以与 v1 帧层「未注册」完全相同的分类（UNSUPPORTED_MESSAGE_TYPE / connection fatal / 1002）拒绝，仅拒绝点位置移动；`resolveSelectedCapabilities(undefined)` 对全部既有消息零操作；encode 对既有 kind 零变化；D-8 两 case 运行时构造性不可达且 fail-loud 自镜像（非静默丢弃）。ws-replication 既有全部测试文件零改动零失败（P4）。✅

## 8. Non-blocking observations（MINOR，不阻断 approve）

1. **SA3 报告计数笔误**（继承 SA4 O2）：`task_issue-242_sa3_impl.md` §5 称「21 已跟踪修改」，git 实测 18（6 src + 2 ws + 8 test + 2 docs）；清单逐项准确，仅总数算术错误，不影响任何结论。
2. **P4 绿日志证据质量**（继承 SA4 O3）：`_sa3_green.log` P4 段仅记录失败用例名 + 时长，未含 vitest FAIL 断言详情块；归因依赖多链交叉而非单一日志。建议后续转绿日志保留失败详情块。
3. **D1 契约修复的等价改写空间**：如上游欲消除「契约文件在转绿期被改动过」的历史歧义，可将 :394 改写为字面量 `0x80000001`（实现零变化）；非必要。

## 9. 结论

仓库标准（AGENTS/ADR 0010/0013/包边界/append-only 纪律/fail-closed/单一事实源）、范围控制（ALLOW 内、DENY 零触碰）、测试质量（红灯真实、覆盖全 AC、无弱化）、证据完整性（命令/输出/退出码三件齐、数字链自洽、披露充分）、文档一致性（规范六处 + CONTEXT.md 词汇，事实有源码实据）、回归面（v1 行为逐字节不变）全部通过独立复核。SA4 的 approve 结论经 SA9 独立验证维持。

**Verdict: approve。**

— SA9，issue #242 标准审查完毕。
