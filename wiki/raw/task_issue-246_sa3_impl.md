# SA3 Implementation Report — issue #246：分块传输 wire 契约收口与新旧互通矩阵（切片 5）

- dispatch：`sa-95fd7a4f-5c9b-4e04-83ce-08a61a117b5e`（mabf-sa3 / implementation / **iteration 3**；iteration 2 因执行观察者失败无可采信完成，本轮独立复核并固化 F1 修复）
- 前轮：iteration 2 `sa-7d98ee27-d60c-4125-b40c-903028ad0cfd`（观察者失败，工作树改动保留）；iteration 1 `sa-0b1405d2-4f74-4447-8e8d-cb0dfba8a7f6`（verified-lost 重派）；iteration 0 `sa-3f3e2b71-b543-453b-8417-404c1bd984e7`（framework-verified lost）
- 基线：`mabf/issue-246` @ `d1888cc`（`git log --oneline -1` 实测）
- 实现范围：docs-only 生产面（协议文档、ADR 0013、CONTEXT.md）+ 两个 SA6 契约路径的测试文件（设计 §11 ALLOW LIST 第 4/5 行）
- 结果（iteration 3 独立实测）：File B **4/4 绿**（M2 含对称 hubToPeer 回落腿）；File B 重复 **×20 → 20/20 exit=0**；File A 绿面 22/22 + **红面独立复现 12 failed | 10 passed**（与设计 §12.1 枚举逐条一致，事后逐字节还原）；#233 v1 基线 3/3 绿；两包 typecheck + 根 `pnpm typecheck` 绿；根 `pnpm test` **304 files / 3261 tests 全绿，exit=0**；AC5 文档验证六条全零命中 / `git diff --check` 干净
- 零生产代码改动：`packages/*/src/**` 零改动，`vitest.config.ts` / `tsconfig*` / `package.json` / `pnpm-lock.yaml` / `apps/**` / `domains/**` 零改动（`git status --porcelain=v1` 实测）

## Inputs consumed

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-246.md`（issue 正文快照） | 已读；5 条 AC + What to build + Blocked-by #245（已闭合） |
| Issue comments | REST 快照 `[]`（dispatch 声明派发前即时读取）——零 owner 评论、零 comment ID/updated_at 需落实 |
| `wiki/raw/task_issue-246_design.md`（SA1 iteration 1，409 行） | 已读全文；本轮复核对照 §7.4.2（M2 行 + 三层确定性形态表）、§12.1（红面 12 条枚举）、§12.3（File B 5 条）、§12.4（命令表）、§11（ALLOW/DENY） |
| `wiki/raw/task_issue-246_sa2_review.md`（approve；F1–F4 + N1–N9） | 已读全文；落实状态见 §SA2 Finding 落实 |
| **`wiki/raw/task_issue-246_sa4_review.md`（reject；0 BLOCKER / 1 MAJOR / N-OBS1–5）** | 已读全文；**issue246-SA4-F1 为本轮唯一必修项**；N-OBS2 已顺带落实 |
| `artifacts/sa8-conflict-gate-issue-246.md`（clear；R26–R31） | 已读；R26–R31 全部承接（本轮零文档/语义改动） |
| `wiki/raw/task_issue-246_dispatch.md` | iteration 0/1 dispatch 标记；本轮 dispatch 见本报告头注 |
| SA6 契约 `task_issue-246_sa6_contract.md` | **不存在**（设计 §0 已如实登记）；两 ALLOW 测试路径由 SA3 落地（Deviation 1） |
| 嵌套 `AGENTS.md` | 已读并遵守：根、`docs/`、`packages/replication-protocol/`、`packages/ws-replication/`（wire/生命周期改动须跑包 typecheck + 根 `pnpm typecheck`/`pnpm test`） |

## Existing worktree reconciliation

- 起始状态（本轮）：3 个文档 M（协议/ADR/CONTEXT）、2 个未跟踪测试文件、iter0/1/2 证据日志、`wiki/raw/task_issue-246_*` 任务产物。
- **独立复核结论：iteration 2 声称的 issue246-SA4-F1 修复确实存在于工作树**，且与设计 §7.4.2 M2 行 / §12.3-2 第 3 条逐条吻合——不依赖前轮日志采信，本轮以源码读取 + 行为断言实测确认：
  - `packages/ws-replication/test/ws-replication-issue246-interop-matrix.test.ts` L564-567 为 4 条对称调用：`baseline/peerToHub`、`stripped/peerToHub`、`baseline/hubToPeer`、`stripped/hubToPeer`（M1 参照 L513-514 同为双方向）；
  - L569 `expect(stripped.connectionState()).toBe('ready')`（SA4 N-OBS2 顺带项）在位；
  - L561-563 段注释与头注 L8-9 显式登记「双方向腿 / 超限 hub→peer 载荷腿」；
  - 文件 687 行，md5 `4e7716518ce5297c7629369a5281e8fb`；`console.log` 计数 0（iteration 2 探针零残留）。
- 逐条复核 iter1 的文档修订（§7.1/§7.2/§7.3/§7.5/§7.6）与 File A（22 条）：**保留不动，本轮零改动**；`git diff --stat` 仍为 `3 files changed, 36 insertions(+), 8 deletions(-)`，与 SA4 审查基线逐字一致。
- 本轮**无需新增实现改动**：F1 要求的对称腿已在位且实测生效；未删除或改写任何既有断言，File A 红面 12 条与 File B 断言集未弱化。本轮产出 = 独立验证证据（`artifacts/sa3-issue246-*-iter3.log`）+ 本报告原位更新。

## Changed paths

| Path | Design section | Change |
|---|---|---|
| `docs/protocols/instance-replication-v1.md` | §7.1 / §7.3 / §7.5、§8.1（ALLOW 第 1 行） | **iteration 1 落地，iter2/iter3 零改动**：§1 +「实现代际」词条（三层消歧）；§5 gating 注记改挂「v1 代际」；§10.3 占位句替换为完整跨帧契约（含错误码三分类 `UPDATE_TRANSFER_TOO_LARGE`）；L301 切片注记中性化；§22 分块条目加挂 `0x42`/`0x00000001` 与 golden 资产全路径 + 新增实现代际互通矩阵条目 |
| `docs/adr/0013-chunked-live-update-transfer.md` | §7.2（ALLOW 第 2 行） | **iteration 1 落地，iter2/iter3 零改动**：状态「提议」→「已接受」+ 两层权威让渡 + observer 事件词表单列 local seam（F4） |
| `CONTEXT.md` | §7.6（ALLOW 第 3 行） | **iteration 1 落地，iter2/iter3 零改动**：L142 状态标注、UPDATE_CHUNK 词条改挂 §10.3、新增「实现代际」词条（含 _Avoid_） |
| `packages/replication-protocol/test/codec-issue246-doc-contract.test.ts` | §11 ALLOW 第 4 行 / §12.2 File A | **iteration 1 新建，iter2/iter3 零改动**（357 行，md5 `f5fc29e684acd0d111704a0946f4fb79`）：D1–D6 文档契约 22 条 |
| `packages/ws-replication/test/ws-replication-issue246-interop-matrix.test.ts` | §11 ALLOW 第 5 行 / §12.3 File B / §7.4.2 M2 行 / §12.3-2 | **iteration 2 修复在位，iteration 3 独立复核确认（本轮零编辑）**：M2 对称 hubToPeer 腿（L566-567）+ `connectionState()==='ready'`（L569）；687 行，md5 `4e7716518ce5297c7629369a5281e8fb` |
| `wiki/raw/task_issue-246_sa3_impl.md` | 流程产物（skill 固定输出） | 本报告（原位更新为 iteration 3 的独立验证结果） |
| `artifacts/sa3-issue246-{fileA-red,fileA-green,fileB-green,fileB-20x,typecheck,pnpm-test,doc-checks,f1-fix}-iter3.log`（untracked，非源码） | 非 ALLOW/DENY（流程证据） | 本轮验证留档；iter0/1/2 既有日志逐字节保留未动 |

## SA4 Finding 落实

| Finding ID | Severity | Requirement | Independent verification（iteration 3 实测） | Result |
|---|---|---|---|---|
| **issue246-SA4-F1** | MAJOR | M2 内在两条 peerToHub 腿之后、三层比对之前对称补 `assertV1Fallback(baseline,'hubToPeer')` + `assertV1Fallback(stripped,'hubToPeer')`；两会话操作序列逐一对齐；建议顺带 `connectionState()==='ready'` | grep + 读取确认 L564-567 四条对称调用、L569 ready 断言；File B `M2` 实测通过——该断言组在 `hubToPeer` 腿内要求 **hub 侧**发送方 observer `resync-required{cause:'send-failed', reason:'update-too-large', channelState:'needs-resync'}` 恰一（`hubCollector`）、接收侧 peer `remote-declared` 恰一、hubToPeer wire `RESYNC_REQUIRED` 恰一、该写零 `UPDATE`/零 `UPDATE_CHUNK`、≥1 条 >8KiB `SYNC_STEP2`、peer 副本收敛为 20KB；三层确定性等同比对在含超限 hub→peer 载荷腿的完整时间线上全等 | **已落实并经独立实测确认**：File B 4/4 绿；×20 → 20/20 exit=0 |
| N-OBS2（MINOR） | 观察 | 顺带对齐 M1 的 `connectionState()==='ready'` | L569 在位 | 已落实 |
| N-OBS1（File A D2-3 同句耦合正则） | MINOR | SA4 明示非阻断 | 不处理：属 File A 断言增强、超 F1 修复范围；登记于 §Deferred verification（后续票） | 登记不处理 |
| N-OBS3/4/5 | 观察 | 与实现无冲突（接受日期=工作树日志日、`[SA6 owned]` 路径由 SA3 落地已登记、会话未显式 teardown 同 #233 惯例） | 无动作 |

## SA2 Finding 落实

| Finding ID | Implementation | Result |
|---|---|---|
| F1（MAJOR：M2≡M1 跨会话字节/长度全等闪断） | 三层确定性形态（iter1 落地）：(a) `kind#sequence` 序列全等；(b) 确定性字段帧逐字段投影相等；(c) Yjs 承载帧仅比 `kind@namespaceId` 计数；字节级断言唯一挂靠 interposer 同会话 HELLO 字节对 | 已落实；本轮 ×20 全绿（`-fileB-20x-iter3.log`），跨会话零字节/长度相等项（grep 复核） |
| F2（MAJOR：D6-1 红灯归类与来源歧义） | 红面精确 12 条 + D6-1 移出红面、断言源仅 `docs/` + `CONTEXT.md` | 已落实；本轮**独立复现红面 12 failed | 10 passed**，与 §12.1 枚举逐条一致 |
| F3（MAJOR：§10.3 缺 `UPDATE_TRANSFER_TOO_LARGE` 锚） | §10.3 三分类显式分列 + File A D2-3 断言 | 已落实（D2-3 红→绿，D5-1 恒绿） |
| F4（MAJOR：ADR 状态行事件词表并入 wire 冻结值） | 枚举拆分 + File A D1-2 负向 / D1-5 正向双向锁定 | 已落实（D1-2/D1-5 红→绿，本轮红面复现含二者） |
| N1–N9 | 逐条承接（iter1/iter2） | 已落实；本轮修订遵守 N9（两会话调用序列逐一对齐，无共享随机源）；N4 按观测侧断言已在 M2 双方向腿生效 |
| N4（「恰一 resync」按观测侧） | `assertV1Fallback` 按观测侧断言；M2 对两方向腿全部生效 | 已落实（设计措辞偏差见 §Deviations-2） |

## File scope check

| Changed path（本轮） | ALLOW entry | Purpose |
|---|---|---|
| `wiki/raw/task_issue-246_sa3_impl.md` | 流程产物（skill 固定输出） | 本实现报告（iteration 3 独立验证结果） |
| `artifacts/sa3-issue246-*-iter3.log`（8 个，untracked） | 流程证据产物（`artifacts/` 下 tracked/既有先例） | 验证留档，非源码/非规范契约 |

本轮**零实现文件改动**：三个文档、File A、File B 均保持前轮逐字节状态（md5 前后一致：协议 `a3c8ade9…`、ADR `922307e7…`、CONTEXT `2c5c9a73…`、File A `f5fc29e6…`、File B `4e771651…`）。DENY LIST 零越界（`git status --porcelain=v1` 实测）：

- `packages/*/src/**`、`apps/**`、`domains/**`、`vitest.config.ts`、`package.json`、`tsconfig*`、`pnpm-lock.yaml`：零改动；
- `ws-replication-issue233-repro.test.ts`（3/3 绿，全量运行 L446 实测）、`harness.ts`/`issue137-driver.ts`/`driver.ts`、既有 codec 测试五件、`docs/adr/0010-*.md`：零改动；
- File A/B 断言源零 `wiki/raw` 读取、零源码字符串/grep 断言、`skip`/`only`/`todo` 零命中、`console.log` 零命中（grep exit=1 / 计数 0 实测）。

## Verification

| Command | Result | Evidence |
|---|---|---|
| `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/ws-replication/test/ws-replication-issue246-interop-matrix.test.ts` | **绿 4/4**（M1 / **M2 含对称 hubToPeer 腿** / M3 / 协商数学与分类锚），`Type Errors no errors`，exit=0 | `artifacts/sa3-issue246-fileB-green-iter3.log` |
| File B 重复运行 ×20（F1 修复后稳定性；正式 ≥20 次验收归 SA7） | **20/20 exit=0**，20 次均 `Tests 4 passed (4)`，零 failed | `artifacts/sa3-issue246-fileB-20x-iter3.log` |
| File A 绿面：`vitest run packages/replication-protocol/test/codec-issue246-doc-contract.test.ts` | **绿 22/22**，exit=0 | `artifacts/sa3-issue246-fileA-green-iter3.log` |
| File A 红面独立复现：`git stash push` 三文档 → 运行 File A → `git stash pop` | **`Test Files 1 failed` / `Tests 12 failed | 10 passed (22)`**，exit=1；失败清单 = D1-1..5、D2-1..3、D3-1、D3-3、D4-1、D4-2，与设计 §12.1 红面枚举**逐条一一对应**；绿面 D2-4/D3-2/D5-1..5/D6-1..3 恰 10 条通过。还原后 `md5sum -c` 五文件全部 `OK` | `artifacts/sa3-issue246-fileA-red-iter3.log`；还原校验见 `-f1-fix-iter3.log` |
| `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/ws-replication/test/ws-replication-issue233-repro.test.ts` | **绿 3/3**（v1 基线，AC3 末句），exit=0 | 独立运行输出；全量运行 L446 复验 |
| `pnpm exec tsc -p packages/replication-protocol/tsconfig.json`；`… packages/ws-replication/tsconfig.json` | 二者绿（exit=0） | `artifacts/sa3-issue246-typecheck-iter3.log` |
| `pnpm typecheck`（根 14 工程链） | 绿（exit=0） | 同上 |
| `pnpm test`（根全量） | **绿：`Test Files 304 passed (304)` / `Tests 3261 passed (3261)` / `Type Errors no errors` / exit=0**；含 `codec-issue246-doc-contract.test.ts`（22 tests，L10）与 `ws-replication-issue246-interop-matrix.test.ts`（4 tests，L280）；#233 3/3 绿（L446） | `artifacts/sa3-issue246-pnpm-test-iter3.log` |
| AC5：`grep -rn "提议" docs/ CONTEXT.md`；`grep -n "状态：提议" docs/adr/0013-*.md`；`grep -n "ADR 0013 提议" CONTEXT.md`；`grep -n "属后续切片" docs/protocols/instance-replication-v1.md`；`grep -n "后续切片承接" CONTEXT.md`；`grep -nE "UPDATE_CHUNK\|CAP_CHUNKED\|分块" docs/adr/0010-*.md` | 六者**全部零命中**（各 exit=1） | `artifacts/sa3-issue246-doc-checks-iter3.log` |
| `git diff --check` | 干净（exit=0） | 同上 |

补充纪律核对：本轮未新增 `skip`/`only`/`todo`；File B 断言源零源码字符串/grep 断言；字节级断言仍仅限 interposer 同会话 HELLO 字节对；File A 二十二条（含红面 12 条）未动，且本轮以 stash 方式独立复现红面后逐字节还原（md5 全 OK）。

## Deferred verification

- **SA4 复审**：issue246-SA4-F1 修复复核（M2 双向腿 + 三层等同 + `connectionState` 对齐）——本轮已提供独立证据，判定权归 SA4。
- **SA7 动态轮（正式验收方）**：M2（及整个矩阵）≥20 次重复运行零假红的**正式验收**；真实 WebSocket transport 面互通构型复核（本票矩阵为 fake-duplex 构型；真实 transport 协商分块主链路由 #243 `ws-replication-issue243-real-transport.test.ts` 覆盖）。本轮 ×20 为佐证，不替代 SA7。
- **N-OBS1 后续**：File A D2-3 错误码「同句耦合正则」增强（SA4 明示非阻断、当前文本已三方对照正确）——属后续测试强化票。
- **iter0 不可复现失败留档**：`artifacts/sa3-issue246-pnpm-test-iter0-lost.log`（前轮捕获片段，末行 `ELIFECYCLE Test failed.`，无失败明细）。iteration 1/2/3 三轮串行 `pnpm test` 均全绿，该片段不参与当前结论，保留供追溯。
- 本票不新增/不扩展 `CAP_CHUNKED_SYNC` 等 ADR 0013 非目标面。

## Deviations or blockers

1. **测试文件所有权（`[SA6 owned]` → SA3 落地）**：设计 §11 把两个测试路径标为 `[SA6 owned]`，但无 `task_issue-246_sa6_contract.md`（设计 §0 已登记），dispatch 明确 docs-and-tests scope。SA3 在 ALLOW 路径内落地两契约文件，断言集逐条对应 §12.2/§12.3，未弱化、未改验收语义（SA4 N-OBS4 已核可）。
2. **N4 措辞偏差（按侧归属）**：设计 §7.4.2 M1 行中「peer 写腿 = 发射侧 hub observer」与其镜像句及实现事实不一致——发送方通道超限时丢弃并声明 `send-failed`，接收方收 `RESYNC_REQUIRED` 后 `remote-declared`。实现按 **wire 发射侧（= 写方）** 断言，且对两方向腿都断言「发射侧 send-failed 恰一 + 接收侧 remote-declared 恰一 + wire RESYNC_REQUIRED 恰一」，严格强于单侧断言且满足 N4「按观测侧分别断言、禁止双 observer 汇总」。无验收语义变化。
3. **§10.3 措辞微调**：设计锚点「每帧独立 sequence」落地为「每帧独立消费本发送方向 sequence」（同义、更贴合 §1 词条与协议不变量 2）；File A D2-2 与落地文本同源。
4. **ADR 接受日期**：设计 §7.2-1 要求「日期按落地 commit 填写」；落地登记「接受日期 2026-09-10」（原提议日期保留历史）。SA4 N-OBS3 已接受。
5. **iter0 失败日志处置**：以 provenance 头注留档、规范名刷新为最新全绿日志；属证据整理，不改任何源码/文档/断言。
6. **iteration 1 的 F1 缩减（已由 iteration 2 修复，iteration 3 独立确认）**：iteration 1 的 M2 只跑 peerToHub 腿且未登记——SA4 F1 判定成立；iteration 2 对称补齐 hub 写镜像腿；**iteration 3 不采信前轮日志，以源码读取 + 行为断言 + 红面复现独立确认该修复真实且生效**，缩减消除。
7. **本轮零实现编辑是复核结论而非遗漏**：iteration 3 起始工作树已含满足 SA4 Required change 的修复（L564-567/L569），本轮职责为独立复核与固化；未做无谓改动，未触碰 DENY LIST。
8. **无阻塞**：零 BLOCKER；设计可实施、ALLOW/DENY 边界清晰、SA4 F1 修复在设计范围内（不改验收语义、不弱化断言）。

## Suggested commit message

```
docs(replication): finalize chunked live update wire contract + v1/v2 interop matrix (#246)

- 协议 §10.3：跨帧规则/发送端/接收端/transfer 身份/ACK 锚/错误码三分类收口（ADR 0013 逐字同向）
- ADR 0013：提议 → 已接受；wire 冻结值权威让渡协议文档，配置/理据保留本文；observer 事件词表单列 local seam
- 协议 §1 + CONTEXT.md：新增「实现代际」词条（v1/v2 三层消歧）；§5/§22 改挂；过期切片注记清理
- §22：互通矩阵 + 0x42 / CAP_CHUNKED_UPDATE=0x00000001 锁定值与 golden/矩阵资产指向（全路径）
- 新增 codec-issue246-doc-contract.test.ts（D1–D6）与 ws-replication-issue246-interop-matrix.test.ts（M1–M3 + HELLO capability 剥除 interposer）
- M2 对称 hubToPeer 回落腿（issue246-SA4-F1）：M1 全部行为断言在 v2 peer ↔ v1 hub 格逐条成立，三层确定性等同覆盖两方向完整时间线
- 零生产代码改动；File A 红面 12 条独立复现/绿面 22 条全绿；File B ×20 零假红；根 pnpm test 304 files / 3261 tests 全绿
```
