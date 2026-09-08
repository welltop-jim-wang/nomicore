# SA9 标准审查 — issue #242：UPDATE_CHUNK codec 与 CAP_CHUNKED_UPDATE 协商（切片 1）

> 评审人：SA9（独立 Standards 审查），standards-review，**iteration 1（recovery-required fresh final review**，dispatch：sa-8b22312b-7c61-4ba0-b630-c9376e76bf81）。
> 审查对象：**已提交候选 HEAD `edb2107`**（branch `mabf/issue-242`，基线 `cde0d49`；`git status` 干净，工作树零未提交改动）。本评审是恢复性重审：不修改实现，原位重写本 artifact；结论基于对**已提交 diff**（`git diff cde0d49..HEAD`）的独立静态核验 + 手工算术复算，而非转述任何前序 SA 结论。
> **Issue-comment REST 输入于本 dispatch 前刷新为 `[]`——无 Owner 评论要求适用（已记录）**；与任务简报 §Comments 补记、设计 §4、SA2 §7、SA3/SA4/SA10 头部、SA7 §7 的历次 `[]` 一致。
> 纪律声明：SA9 未修改任何代码/设计/测试、未运行测试、未启动服务、未调度其他 SA。本文件是唯一写产物。

## 1. Verdict

**approve**（无 BLOCKER / 无 MAJOR；4 条 MINOR 均不阻断，见 §8，其中 M1 为本次新发现）。

已提交 HEAD `edb2107` 适合交付：冻结 wire 值与 ADR 0013 逐字一致；包边界/append-only/fail-closed/单一事实源纪律全部满足；文件面零超 ALLOW、零触 DENY；红灯契约真实转绿；交付证据链（命令/输出/退出码三件齐）完整且数字链自洽；SA7 在最终树上独立重跑 P1–P4 全绿（exit 0）。

`requiresConflictRecheck` 不重复提交：设计 §15 已将 ADR 0013/0010 一致性复查列为必要并由 Controller 路由；本次审查未发现其之外的新 ADR 冲突维度。

## 2. Reviewed inputs（本次独立核验）

| 输入 | 核验方式 |
|---|---|
| `wiki/raw/task_issue-242.md`（Issue 正文 + 5 AC + §Comments 补记）/ `_dispatch.md` | 已读；评论空与 SA7 补记一致 |
| `wiki/raw/task_issue-242_design.md`（364 行，SA2 iteration-2 approve 版） | §7 D-1~D-9、§11 ALLOW/DENY、§12、§16/§17 逐项对照已提交实现 |
| `_sa2_review.md` / `_sa3_impl.md` / `_sa4_review.md` / `_sa7_report.md` / `_sa10_spec.md` | 已全文读取；关键论断全部独立复核而非采信 |
| **已提交 diff `git diff cde0d49..HEAD`**（19 个已跟踪文件 + 14 个 wiki/raw 产物） | 逐 hunk 读取 src 6 文件、ws-replication 2 文件、test 8 文件、docs 2 文件 |
| 红灯契约 `test/codec-issue242-ac-red.test.ts`（已提交版，516 行） | 结构清点（4 describe / 28 it = AC1×6+AC2×8+AC3×7+AC4×7）；D1 修复行与注释实读（:391-395） |
| ADR 0013 / ADR 0010 / `docs/protocols/instance-replication-v1.md` / `CONTEXT.md` | 冻结值逐项比对；文档 diff 逐 hunk |
| root `AGENTS.md` + `packages/replication-protocol/AGENTS.md` + `packages/ws-replication/AGENTS.md` + `docs/AGENTS.md` | 边界与验证门逐条对照 |
| 五份证据日志（`_ac_red.log` 432 行 / `_ac_red_typecheck.log` 33 行 / `_regression.log` 681 行 / `_sa3_green.log` 35 行 / `_sa7_final_runs.log` 533 行） | 命令/输出/退出码三件齐核验 + 数字链复算（§6） |
| root `package.json` | typecheck 逐包链含 `tsc -p packages/replication-protocol/tsconfig.json` 与 `tsc -p packages/ws-replication/tsconfig.json`（实测） |
| `git status` / `git diff --check cde0d49..HEAD` | 工作树干净；whitespace 检查 exit 0（SA7 修复已在提交内） |

## 3. ADR / 治理一致性（对已提交源码逐项独立比对）

| 治理锚点 | 已提交实现证据 | 结论 |
|---|---|---|
| ADR 0013：`0x42 UPDATE_CHUNK (namespace)`，字段序 namespaceId→transferId→chunkIndex→chunkCount→totalBytes→bytes | `messages.ts`：`UPDATE_CHUNK: 0x42` + `messageInfo(0x42,'namespace','either','UPDATE_ACK')`；`payloads.ts` `decodeUpdateChunk`/`encodeUpdateChunk` 字段序与 ADR 表逐字一致；fixtures 三向量 hex 独立复算全对（600→`d804`、300→`ac02`、63→`3f`、64→`40`、2^22→`80808002`、0xffffffff→`ffffffff0f`、0xfffffffe→`feffffff0f`；payload 长 45/50/58=0x2d/0x32/0x3a） | ✅ |
| ADR 0013：`CAP_CHUNKED_UPDATE = 0x00000001`，交集经既有 `selectCapabilities`；envelope version 恒 1 / flags 恒 0 | `constants.ts:45` 逐字一致并经 `index.ts` 导出；HELLO/HELLO_ACK codec 零改动（不在 diff）；契约 golden header 断言 version=1/flags=0/reserved=0 | ✅ |
| ADR 0013：`UPDATE_TRANSFER_VIOLATION`（fatal/no/failed）对齐 SYNC_STATE_VIOLATION；`UPDATE_TRANSFER_TOO_LARGE`（fatal/config/failed）对齐 SYNC_DIFF_TOO_LARGE 语义族；连接级 registry 零新增 | `errors.ts` 两条 `namespaceError(...)` 逐字一致；`NamespaceErrorCode` 联合 +2 字面量；注册表 20→22 append-only（既有条目行零改动）；CONNECTION_ERRORS 不动 | ✅ |
| ADR 0013：`RESYNC_REQUIRED.reasonCode` 词表追加 `UPDATE_TRANSFER_EXPIRED`（非终态） | 文档 §9.4 **首次定义**词表并登记（既有 `send-queue-overflow` 以源码实据成文，未虚构）；codec 仅非空校验 + 契约 roundtrip 锁定（D-5：无发射点不预造代码枚举） | ✅ |
| ADR 0013：chunk 大小复用 `maxUpdateBytes`（零新 frame 级上限）；ACK 复用 UPDATE_ACK；`PROTOCOL_OVERHEAD_BYTES` 不动 | `payloads.ts` 复用 `resolveFieldLimit(limits?.maxUpdateBytes)` → `UPDATE_TOO_LARGE`（与 `decodeUpdate` 同调用形）；registry ack 列 = `UPDATE_ACK`；constants.ts 除新增 CAP 外零改动；最坏开销 36+5×5=61 ≤ 128 复算成立 | ✅ |
| ADR 0013「本票只交付协议包能力」+ ADR 0010/规范 §5「扩展只能在 HELLO 明确协商后使用」 | `frame-io.ts` 不在 diff（decodeInbound 调用形不变 → 缺省=未协商 → 0x42 消息层 `UNSUPPORTED_MESSAGE_TYPE`/1002，与 v1 帧层「未注册」拒绝同码同 close code 同收口拓扑）；HELLO 发送端 `optionalCapabilities:0`/`selectedCapabilities:0`（peer:333/hub:707）不在 diff | ✅ |
| 包 AGENTS（replication-protocol）：append-only、零重编号/零重解释、fail-closed、公共 API 只经 index.ts、codec transport/Registry 无关 | 全部满足：码空间 0x42 尾部追加；`index.ts` 仅 +2 行（`CAP_CHUNKED_UPDATE` + `type UpdateChunkMsg`）；`canonical.ts`/`envelope.ts` 零改动（DENY 遵守）；零新依赖（package.json 不在 diff） | ✅ |
| 包 AGENTS Verification：wire 变更须 root `pnpm typecheck` + `pnpm test` + 新旧互通证据 | SA7 在最终树上 P3 root typecheck exit 0、P4 root test exit 0（231 文件 2396 用例全绿）；互通证据 = 契约 AC3 v1 回落用例（v1 支持集 → selected=0 → 1002 fatal）+ ws-replication 既有用例零改动零失败 | ✅ |
| docs/AGENTS：新术语入 CONTEXT.md；代码行为变化同批修订规范文档；文档不虚构实现行为；`git diff --check` | CONTEXT.md 增补 UPDATE_CHUNK/CAP_CHUNKED_UPDATE 两词条（含 Avoid 引导）；规范 §5/§6.1/§9.4/§10.3/§13.2/§22 六处同批修订；§9.4 既有 reason 登记有源码发射点实据（SA4 已核，本审抽查一致）；diff --check exit 0 | ✅ |

## 4. 架构、模块责任与单一事实源

- **责任归属**：wire codec/门控/敌意拒绝全部在 replication-protocol（byte codec Owner）；发送切片/assembly/配置链/observer 事件正确缺席（ADR 0013 后续切片）；两处穷尽 switch 的类型兼容 case 位于拥有该 switch 的连接类内（hub-connection.ts:790-795 / peer-connection.ts:521-526）。✅
- **D-8 补丁边界**（本次对已提交 diff 实测）：`git diff cde0d49..HEAD -- packages/ws-replication/` **恰两个 hunk、各 6 行**（case 标签 + 3 行不可达性注释 + `this.connectionFatal('UNSUPPORTED_MESSAGE_TYPE', 1002); return;`），与设计 §7 D-8 代码块逐字一致，两文件零其他改动。运行时构造性不可达论证链逐环实测成立（decodeInbound 不传选项 → 缺省未协商 → 消息层先拒 → catch 链同码同 1002 收口 → dispatch 收不到 0x42）；fail-loud 自镜像而非静默丢弃。✅
- **单一事实源**：消息/错误元数据仍由冻结注册表单点导出；fixtures 镜像表（MESSAGE_TABLE/SCOPE/DIRECTION/ACK/NAMESPACE_ERROR_TABLE）由 registries 表驱动测试逐键断言锁同步；库层不持有第二协商状态（`selectedCapabilities` 由调用方传入，缺省=未协商）。无旁路、无第二缓存、无 marker 反推。✅
- **惯例对称**：`resolveSelectedCapabilities`（limits.ts:69-77）与 `resolveExpectedSequence`（:53-60）判据逐字对称（非安全整数/负/>0xffffffff → CONNECTION_POLICY_VIOLATION，响亮不 clamp）；uint32 字段族全复用 `readVarUint32`/`writeVarUint32`，零新编码原语。✅
- **生命周期对称性**：纯函数 codec，无资源获取/释放面；D-8 case 走既有 `connectionFatal` 收口链，无新生命周期。✅
- **穷尽性完备性独立复核**：全仓穷尽 never 检查点 = `payloads.ts` encodePayload（本包内已随实现扩容）+ hub/peer `dispatchReady` 两处（已补 D-8 case）；root `pnpm typecheck` exit 0（SA7 P3）由编译器自证穷尽性恢复。SA2 的影响面重推导结论在已提交树上成立。✅
- **平行机制检查**：`CAP_CHUNKED_UPDATE` 为 constants.ts 首个 CAP_*（无既有族可复制）；门控复用 `DecodeOptions` 既有通道；reason 不预造代码枚举——零平行机制。✅

## 5. 范围控制（ALLOW/DENY 对已提交 diff 实证）

- 19 个已跟踪修改全部落在设计 §11 ALLOW LIST：src 6（messages/constants/errors/limits/payloads/index）+ ws-replication 2（仅 D-8 窄例外）+ test 8（fixtures + 7 个既有文件 append-only 翻转）+ docs 2（协议规范 + CONTEXT.md）+ 红灯契约 1（新增）。
- **DENY 面零触碰**（`git diff --stat` 实证）：`canonical.ts`、`envelope.ts`、`packages/replication-protocol/package.json`、`docs/adr/*`、`apps/**`、`packages/vfsl-codegen/**`、ws-replication 其余文件、`pnpm-lock.yaml`、`.github/**` 均不在 diff。
- 既有测试翻转逐文件与 ALLOW 预期一致：GOLDEN 18→21（3 向量与契约字面量逐字一致）、17→18/20→22 计数、0x42 未注册样本换 0x43、GOLDEN 全量 decode 循环传 `selectedCapabilities: CAP_CHUNKED_UPDATE`、fuzz `randomMessage` 增 UPDATE_CHUNK 自洽分支、test-d 增类型断言。截断循环不传选项（帧级分类先于门控，语义不变）。✅
- wiki/raw 产物随提交入账属仓库既定先例（#238/#239 等提交同构）。✅
- **回滚面**：纯 append-only，删新注册项/常量/选项 + 回退两处 case 即回 v1；无数据迁移、无持久化面。✅

## 6. 测试质量与交付证据完整性

- **红灯契约**（已提交版 516 行，28 用例实数清点 = AC1×6+AC2×8+AC3×7+AC4×7）：全字段 golden 逐字节锁定（独立 `PINNED_FRAME_HEX` 字面量锚 + buildFrameHex 派生路径互证，无自指空洞）、逐 byte offset 截断、非 canonical LEB128、超 uint32 域、非法 UTF-8/namespaceId、尾随字节、超声明 bytes（含 2^32 巨额声明的分配前拒绝）、单帧语义自洽、限额复用、encode R9 对称、交集矩阵、字节级 bit roundtrip、未协商 fatal（scope/fatal/retryable/1002 全等）、急切校验作用域双向钉死、v1 互通回落、注册表 22 条+冻结+位推导+badBits 拒绝+lookupError 双向+RESYNC reason roundtrip。**无 skip/only/todo**（grep 实证）；断言全部针对公共行为。✅
- **红 → 绿链自洽**（日志逐环复算）：R1 exit 1（20F|8P，失败全部且仅为缺失实现）→ R2 exit 2（21 个类型错误全部在契约文件、全部缺失 API）→ R3 exit 1（既有 9 文件 139 用例零失败，红灯失败如实可见，Errors 21≡R2）→ SA3 P1/P2/P3 exit 0（169=167+2）→ **SA7 在最终提交树上独立重跑：P1 10 文件 169/169 exit 0（契约 28/28）、P2 exit 0、P3 root typecheck exit 0、P4 root 全量 231 文件 2396 用例 exit 0**（2396=2394+2）。数字链 147=139+8、169=167+2、2396=2394+2 逐环一致；无隐藏排除。✅
- **SA3 P4 单例失败归因的终态**：SA3 run 中 `apps/yjs-server/test/stdin-error-chain-red.test.ts` F1 race 失败经 SA4 四链归因为先在环境性 flake（未实施树 R4 同形态失败史、更早 commit flake 史、因果通路排除、隔离复跑 4/4 exit 0）；**SA7 最终 run 中该文件与其余 230 文件全部通过（exit 0）**——归因链已被更强的全绿证据取代，且 SA4 §11 失败条件（隔离复跑仍失败/可稳定归因本任务文件）未触发。该文件为已跟踪文件、不在本任务 ALLOW、本任务零改动（DENY 遵守）。✅
- **D1 披露复核**（契约 :394 `(CAP_BIT | 0x80000000) >>> 0`）：JS 中 `1 | 0x80000000` 经 int32 位运算 = -2147483647（负值），与同文件「负 → CPV」用例及设计 D-3 uint32 判据互斥——契约原式不可满足；`>>> 0` 还原 0x80000001（位 0 + 多余高位），断言语义（已协商含多余位 → 解码成功）不变、未弱化任何断言；红期该行从未被执行（用例在帧级拒绝处即失败，`_ac_red.log` 栈帧实证）；28 用例名集合与红期日志逐名一致（SA4 已逐名比对）。属测试作者笔误的单行操作数修复，SA3 披露、SA4 裁决接受，本审独立复算同意。**非弱化、非 skip、非语义篡改。** ✅
- **SA7 活链路探针 9/9**（encode 66B canonical frame / registry 三元组 / 已协商 decode 六字段全等 / fail-closed 门控 1002 / 66 偏移截断全部分类拒绝零未分类异常 / 急切校验 -1 → CPV / 两错误码冻结元数据 / ERROR 与 RESYNC wire roundtrip）——动态面与静态核验互证。✅

## 7. 回归面

v1 流量可观察行为逐字节不变：`decodeInbound` 调用形不变 → 缺省未协商 → 0x42 在消息层以与 v1 帧层「未注册」完全相同的分类（UNSUPPORTED_MESSAGE_TYPE / connection fatal / 1002）拒绝，仅拒绝点位置移动；`resolveSelectedCapabilities(undefined)` 对全部既有消息零操作；encode 对既有 kind 零变化；D-8 两 case 运行时构造性不可达且 fail-loud；R1/R2/R3 基线刻画测试未触碰。ws-replication 既有全部测试文件零改动且在 SA7 P4 全绿。✅

## 8. Non-blocking observations（MINOR，均不阻断 approve）

1. **M1（本次新发现，注释陈旧）**：`packages/replication-protocol/src/messages.ts:104` 节注释仍写「消息类型（= fixtures **17** 个 interface 形状）」——fixtures 现为 18 个消息 interface；同一文件 :226 联合注释已正确更新为 18，唯漏该处。注释级笔误，零行为影响，可由后续切片顺手修订。
2. **M2（继承 SA4 O2）**：SA3 报告 §5 称「21 已跟踪修改」，实测 18（6 src + 2 ws + 8 test + 2 docs + 1 契约新增口径差异）；清单逐项准确，仅总数算术错误，不影响任何结论。
3. **M3（继承 SA4 O3，已被 SA7 取代）**：`_sa3_green.log` P4 段仅记录失败用例名+时长、未含 FAIL 断言详情块；SA7 `_sa7_final_runs.log` 已以全绿 exit 0 取代该归因场景。建议后续转绿日志保留失败详情块。
4. **M4（继承前次 SA9）**：如上游欲消除「契约文件在转绿期被改动过」的历史歧义，可将契约 :394 改写为字面量 `0x80000001`（实现零变化）；非必要。

## 9. 结论

对已提交 HEAD `edb2107` 的独立复核确认：仓库标准（root/包/docs AGENTS、ADR 0010/0013、append-only、fail-closed、单一事实源、生命周期对称）、范围控制（ALLOW 内、DENY 零触碰、D-8 逐字最小）、测试质量（红灯真实且双跑稳定、28 用例覆盖全 AC、无弱化、D1 披露充分并经两级裁决）、交付证据（命令/输出/退出码三件齐、数字链自洽、SA7 最终树全绿 + 9/9 探针）、文档一致性（规范六处 + CONTEXT.md 词汇，事实有源码实据）、回归面（v1 行为逐字节不变）全部通过。SA2/SA4/SA10 的 approve 与 SA7 的 pass 经 SA9 独立验证维持。

**已提交 HEAD 适合交付。Verdict: approve。**

— SA9，issue #242 standards review（recovery iteration 1）完毕。
