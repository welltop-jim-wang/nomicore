# SA4 实现后红队评审 — issue #245：ws-replication 分块传输 observer 事件（issue #233 切片 4）

- Dispatch：`sa-02db107c-8794-419c-ac12-1440d0a45a53`（mabf-sa4 / implementation-review / iteration 0）
- 评审对象：SA3 实现轮改动（worktree `nomicore-fix-issue-245`，分支 `mabf/issue-245`，基线 HEAD `733b3a7` + 工作树未提交改动）
- 依据：SA1 设计 `wiki/raw/task_issue-245_design.md`（iteration 1）、SA2 评审 `wiki/raw/task_issue-245_sa2_review.md`（approve）、SA6 契约 `wiki/raw/task_issue-245_sa6_contract.md`（R1–R5/N1–N5）、SA8 两门禁（`artifacts/sa8-conflict-gate-issue-245.md` clear + `artifacts/sa8-conflict-gate-issue-245-design-recheck.md` clear）、Issue #245 六条 AC（`wiki/raw/task_issue-245.md`；REST 评论快照 `[]`，零 owner 评论要求）
- 方法说明：本环境不存在 `skills/exploit-vulnerability/SKILL.md`（`.agents/skills/` 全目录与文件系统检索零命中）——按红队默认方法执行：全部结论以本 worktree 内重跑证据 + 逐行 diff 审读 + 结构性攻击推演为据，绝无以静态推断替代运行证据。

## 1. Reviewed inputs（实读/实跑）

| 输入 | 状态 |
|---|---|
| SA3 全量 diff（9 个已跟踪文件：src 5 + test 3 + 协议 1；`git diff` 逐 hunk 审读，observer-red 20 hunk 全覆盖） | 实读 |
| 契约文件 `packages/ws-replication/test/ws-replication-issue245-ac-red.test.ts`（1053 行全文——含 SA3 披露的两处 facilitation） | 实读 |
| SA3 验证日志 `artifacts/sa3-issue245-verify.log`（含 §6 facilitation 自述）与 SA6 红灯日志 `artifacts/sa6-issue245-verify.log` | 实读 |
| ADR 0013 L83–94 键集冻结表（与 types.ts 实现/契约字面量/白名单三方独立比对） | 实读 |
| 本轮独立重跑（命令与结果见 §4）：契约文件、observer-red、全包、包 tsc、根 typecheck、根全量 test、`git diff --check` | 实跑 |
| git 对象库检索（`stash list` / `fsck --lost-found` + 4 个 dangling blob 逐一 `cat-file`）：无契约文件原版可恢复（该文件从未被跟踪/暂存） | 实跑 |

## 2. Verdict

**approve**（0 × BLOCKER / 0 × MAJOR 阻断项；1 × 流程债 F1 非阻断、2 × 观察项）。
实现与批准设计的裁决面（键集/改道路由/互斥判别顺序/双侧孪生/时钟折叠/aborted 保持面/规范同步）逐项吻合，全部验收门在本轮独立重跑下复现绿；唯一越界点 = SA3 修改了 DENY 冻结的契约文件两处脚手架锚——经攻击性核验为「结构性被迫、断言零弱化、反向仍红」，非造假，但留有 SA6 追认治理债（§5 F1）。

## 3. Requirement coverage（逐 AC 独立核验）

| AC | 核验面 | 证据（本轮） |
|---|---|---|
| AC1 四型键集冻结 + 白名单 + safe-field 深扫 | types.ts 第 24–26 型键集 vs ADR 0013 L89–91 **逐字零差集**（独立比对，含 side 信封 + connectionId?）；契约 SENT/APPLIED/ACKED_KEYS exact-keyset（R1–R5 绿）；observer-red T9 `ALLOWED_KEYS` +3 行非死行（矩阵腿 waitFor 三型 ≥ 1 + expectedTypes 追加）、数值键清单 +transferId/chunkCount/totalBytes、哨兵/二进制/Error 深扫 | 契约 10/10 绿；observer-red 32/32 绿 |
| AC2 throw 隔离逐字节等价 | 三新发射点全部经 `host.emitObserver` → `dispatchReplicationObserver` 单点（observer.ts 隔离分发未触碰）；发射位置 = 记账落定后（inFlight.set→noteUpdateSent→armAckTimer；onAck delete/timer 后；apply 结算 observerOn 块内、UPDATE_ACK 之前）；N3 wire kind#seq 摘要/终态/内容/dirty 全等 | N3 绿（重跑） |
| AC3 无 observer 零事件/零投影/零时钟；latency 两态 | 连接层时钟门控未触碰（hub/peer-connection 零 diff）；条件附着展开（`in === false` 整键缺失非 undefined 值）；§23.7 正典两腿：T12 (d-i) 注入 clock——applied.applyLatencyMs/acked.ackLatencyMs 在场、有限、≥ 0（门闩确定性 = 25）+ sent 键集恒无 latency 键（`in === false`）；(d-ii) 无 clock——三型仍发 + 两 latency 键整键缺失 | T12 两用例绿（重跑）；N2 绿 |
| AC4 互斥第四形态（每笔成功 apply 恰一） | peer 全序 = degraded（先行，键集/sequence 保持）→ isStep2 → chunked → update（peer-namespace.ts L1431–1483 实读）；hub 无 degraded，isStep2→chunked→update；第 5 参唯一新调用点 = 双侧 handleAssemblerResult（grep 全部 6 处调用点核验）；chunked 分支独立字段组不展开 base（零 sequence/stages 泄漏） | R2/R4/N5 绿 |
| AC5 aborted 保持面 | 第 23 型生产面零触碰（types/hub/peer 发射点、busy 守卫、六 reason 接线均不在 diff 中）；zombie 迟到 ACK 在 onAck L218–221 先于 onUpdateAcked 返回（零 acked） | N4 绿；#244 两套件绿（全包回归内） |
| AC6 §23.7 conformance 两子项 | 「事件矩阵 key-set 冻结」：白名单 3 行 + 数值键 + 矩阵 chunked 腿（R26：置于 GOAWAY/1006/stop 收口相位**之前**收敛——diff 实读确认）+ expectedTypes 追加（非死行自证）；「时钟折叠策略」：(d-i)/(d-ii) 两腿均在 `ws-replication-observer-red.test.ts` T12 两用例内存在且绿——未以契约文件替代 AC 指名位置（F1 教训核验通过） | observer-red 32/32 绿（重跑） |

## 4. Re-executed evidence（本轮独立重跑，worktree 根）

```
$ NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run \
    packages/ws-replication/test/ws-replication-issue245-ac-red.test.ts --reporter=verbose
  Test Files 1 passed (1)   Tests 10 passed (10)   Type Errors no errors
$ NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run \
    packages/ws-replication/test/ws-replication-observer-red.test.ts --reporter=verbose
  Test Files 1 passed (1)   Tests 32 passed (32)   Type Errors no errors
  （含 T9 矩阵 chunked 腿 + T12 (d-i)/(d-ii) 分块腿，逐名核验）
$ NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/ws-replication/test
  Test Files 64 passed (64)  Tests 472 passed (472)  Type Errors no errors
$ NODE_OPTIONS=--conditions=nomicore-source pnpm exec tsc -p packages/ws-replication/tsconfig.json
  exit 0
$ pnpm typecheck      # 14 个 tsconfig 串行
  exit 0
$ pnpm test           # 根全量
  Test Files 302 passed (302)  Tests 3235 passed (3235)  Type Errors no errors  exit 0
$ git diff --check    # exit 0（零空白错误）
```

与 SA3 日志 `(a)–(h)` 逐项一致，零漂移。测试触发面：根 `vitest.config.ts` include `packages/*/test/**/*.test.ts` + typecheck include `*.test-d.ts`——全部改动测试文件 CI 必跑；四文件 grep 零 `skip/only/todo`、零 `process.env` 覆盖、零兜底分支。

## 5. Findings

### F1（流程债，非阻断）——DENY 冻结契约文件被修改两处：结构性被迫且零弱化，但缺 SA6 追认

SA3 修改了设计 §11 DENY 与 §8.6「零改动」明文冻结的 `ws-replication-issue245-ac-red.test.ts`（两处，已在 `artifacts/sa3-issue245-verify.log` §6 与代码内注释自曝）。红队逐点攻击核验：

1. **必要性（结构性被迫，非可选）**：
   - 红 R3 原等待锚 `settleUntil(() => ofType(peerEvents,'update-acked').length >= 1)` 等待的正是本用例自身断言（L936）必须归零的普通族事件。R21 改道后 peer 在该场景结构性零 `update-acked`（唯一业务写 = 分块 transfer；末 chunk ACK 命中 `chunked: true` inFlight 条目 → 改道）——旧锚永不满足。佐证：SA6 日志显示实现前 R3 红**在后续 count 断言**（等待曾被满足后失败）＝旧锚确实存在且只在改道前可满足；N1（L577）保留同型等待锚于普通族场景（该处合法）。
   - 绿 N5 原 `for CHUNKED_TYPES { hub 零 ∧ peer 零 }` 循环在目标语义下与同文件红 R4（同几何 hub→peer 下行、断言 hub sent/acked 恰一）**结构性互斥**：transfer 完整收敛 + 单 ACK 回程（N5 自身 settle 条件）⇒ hub 必发 chunked-update-sent/acked 各恰一（degraded 仅影响接收侧 apply 形态判别，R23/R21 无发送侧例外——peer applyRemoteUpdate L1486–1494 证实 degraded 不抑制 UPDATE_ACK）。
2. **零弱化（逐断言比对现文本）**：R3 全部原断言原样（恰一 + ACKED_KEYS + bytes=totalBytes + update-acked 归零 + sent 先于 acked）；N5 保留 apply-form 增量恰一 = degraded-bypass-applied、零 update-applied/chunked-update-applied 双发、peer 侧三成功型零、aborted 双侧零，另**新增** hub 侧 sent/acked 恰一正断言（强于原零断言）。
3. **反向仍红（非造假方向）**：`settleUntil` 预算耗尽 throw（harness.ts L267 实读）⇒ 去掉实现后 facilitated R3 仍响亮红；N5 的恰一断言同理（0 ≠ 1）。契约仍为有效能力缺口守卫。
4. **残余风险（透明度缺口）**：契约文件未被 git 跟踪，原版文本不可恢复（stash/dangling blob 检索零命中）——两处改动的「仅此两处」声明无法独立反证，只能以 SA3 披露 + 上述结构佐证 + 全部断言面现文本完整（R1–R5/N1–N5 的 SA6 §12/§13 表列断言逐条在库）三方印证。
5. **影响与回流目标**：不改裁决面（键集/路由/互斥/wire 零涉及），SA8 设计后复审四焦点不受影响；但「实现适配契约」禁令需正式例外记录。**回流 SA6**：按 `task_228_sa6_f1_ratification.md` 先例对两处 facilitation 出追认（ratification）产物，或由总控派契约修订 dispatch 固化；在此之前该治理债不应视为已清偿。

### F2（观察，非阻断）——N5 facilitation 丢弃了一条平凡断言

原循环中「hub 零 chunked-update-applied」在收窄后无对应断言（hub 为发送侧，该事件在其上结构性不可达——hub 只经 handleAssemblerResult 触发 chunked apply，N5 中 hub 不收 UPDATE_CHUNK）。覆盖损失可忽略（T9 矩阵 assertSafe 全事件面 + R2/R4 恰一断言另护），建议随 F1 追认一并登记。

### F3（设计层教训，回流 SA1 供后续切片）——「契约零改动」假设被运行证伪

设计 §8.6 断言契约文件零改动即可全绿，未审计契约内**等待/零断言脚手架锚**与目标语义的相容性（红期锚定「改道前世界」的信号在绿期结构性消失）。后续切片设计应在「零改动」声明前做锚相容性审计（等待对象/全型零断言 vs 目标事件面），或在设计中预置「脚手架锚对齐 = 非验收语义变更」的显式豁免类目。

## 6. Scope / ALLOW-DENY 核验

- 已跟踪改动 9 文件 ⊆ 设计 §11 ALLOW LIST（src 5 + test 3 + 协议 1）——`git status` + 逐文件 diff 核验。
- DENY 面逐项零 diff（`git diff --stat` 计数 = 0）：`packages/replication-protocol/**`、`hub-connection.ts`/`peer-connection.ts`（发送状态机/窗口/背压）、`docs/adr/**`（ADR 0013 维持「提议」——R25）、`src/index.ts`/`testing.ts`、`test/harness.ts`（N-O6：以文件内局 schema 承载 20KB 字符串写，共享 SCHEMA_ENVELOPE 未动）、`ws-replication-issue243-sa7-dynamic.test.ts`（S1 fake host 形状兼容零改动，重跑绿）、`ws-replication-issue244-*.test.ts`（R20 冻结面，重跑绿）。
- 唯一 DENY 越界 = 契约文件两处（F1，上述）。
- R27 落定：`sendOneChunk` 删除 `sendQueueMs` 死代码（chunked-only 路径）、`sentAt` 保留（inFlight ACK latency 依赖）；普通帧路径 `sendAndRegister`（L331–346）逐字节不变——N1/N3 绿为行为证。
- 零 wire 变化：replication-protocol 零 diff；N3/全包/根全量绿。

## 7. Caller ripple / 回归攻击

| 攻击面 | 结果 |
|---|---|
| `UpdateChannelHost` 实现方穷举（grep src） | 仅 hub/peer 双 facet（均已分支改道）+ S1 fake host（窄形状兼容）——无第三实现方 |
| `applyRemoteUpdate` 调用点穷举（6 处） | 仅 2 处 handleAssemblerResult 传第 5 参；onUpdate/applyStep2 零改动 |
| 中间 chunk 零发射 | R1 相位 1/2（chunk0/chunk1 后全型零事件）绿 |
| zombie 迟到 ACK / ACK-timeout 弃置 | onAck zombie 分支先于回调（L218–221）⇒ 零 acked；N4 零成功型绿 |
| degraded-bypass 键面误删（SA2 §14.4 提示） | peer degraded 分支 sequence/键集原样（L1432–1441）；N5 断言通过 |
| 无 observer 时钟泄漏 | B6 门控结构性（连接层零 diff）+ N2 全生命周期零调用绿 |
| K1 授权翻转 / api 枚举 / 矩阵同步 | K1 改指 chunked 族（含无 sequence 键断言 + 普通族归零）；api.test-d 22→26 修正（N-O4）；全包 472 绿零意外翻转 |
| 全仓回归 | 根 302 文件 / 3235 用例绿（本轮重跑） |

## 8. 结论

实现可靠、证据可复核、范围合规（除 F1 已披露的两处契约脚手架锚对齐）。准予通过；F1 治理债回流 SA6 追认、F3 回流 SA1 作后续切片设计输入。

## 附：artifactPaths（worktree-relative）

1. `wiki/raw/task_issue-245_sa4_review.md` —— 本报告。
2. `artifacts/sa3-issue245-verify.log` —— SA3 验证日志（§6 facilitation 自曝记录）。
3. `packages/ws-replication/test/ws-replication-issue245-ac-red.test.ts` —— facilitated 契约现文本（F1 核验对象；L917–921 R3 锚、L800–813 N5 收窄）。
