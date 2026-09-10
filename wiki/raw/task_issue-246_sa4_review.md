# SA4 实现红队审查 — issue #246（分块传输 wire 契约收口与新旧互通矩阵，切片 5）

- dispatch：`sa-11ba8d20-87be-4da3-a026-376b0467ff47`（mabf-sa4 / implementation-review / **iteration 1（复审）**）
- 审查对象：SA3 iteration 3 交付（`wiki/raw/task_issue-246_sa3_impl.md`）——iteration 1 的 3 文档修订 + 2 测试文件 + iteration 2 落地、iteration 3 独立复核固化的 issue246-SA4-F1 修复
- 基线：`mabf/issue-246` @ `d1888cc`（`git log --oneline -1` 实测）；`git status --porcelain=v1` = 3 M（CONTEXT.md、ADR 0013、协议文档）+ 2 未跟踪测试 + `artifacts/` 证据日志（iter0–iter3）+ wiki/raw 任务产物
- 审查方法：纯静态（只读 git/grep/源码/测试/日志复核）；未运行测试、未启动服务、未改任何实现/设计/测试。本复审聚焦前轮 reject 的唯一阻断项 **issue246-SA4-F1** 的独立确认，并对其余维度做漂移复核（iteration 1 已全量审查的文档面/File A 面以 md5 + diff 复核代替重读）。

## 1. Reviewed inputs

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-246.md`（issue 正文快照，5 AC） | 已读 |
| Issue comments | REST 快照 `[]`（本 dispatch 声明即时读取）——零 owner 评论、零 comment ID/updated_at 需映射，无遗漏面 |
| `wiki/raw/task_issue-246_design.md`（SA1 iteration 1，409 行） | 已读关键节：§7.4.2 M1/M2 行（L206-207）、三层确定性形态表（L194-202）、§12.3（L343-350）、§11/§12.5 |
| `wiki/raw/task_issue-246_sa2_review.md`（approve；F1–F4 + N1–N9） | iteration 1 已全读；本轮 N4/N9 措辞复核 |
| `wiki/raw/task_issue-246_sa3_impl.md`（iteration 3，128 行） | 已读全文；其 Deviations 1-8 与「Existing worktree reconciliation」逐条核对 |
| 前轮 SA4 审查（本文件 iteration 0：reject / 1 MAJOR issue246-SA4-F1 / N-OBS1-5） | 已读；F1 验收标准与 N-OBS 处置逐条回查 |
| `artifacts/sa8-conflict-gate-issue-246.md`（clear；R26–R31） | iteration 1 已全读；本轮零文档改动（diff 复核），无新冲突面 |
| 实际 diff 与测试文件全文 | `git diff`（3 文档，36 insertions/8 deletions，与 iteration 1 审查基线逐字一致）；File B 全文 687 行逐行读（L1-687）；File A md5 复核（`f5fc29e684acd0d111704a0946f4fb79`，与 iteration 1 记录一致 ⇒ 未改动） |
| SA3 iteration 3 证据日志 | `fileB-green-iter3`（4/4 绿）、`fileB-20x-iter3`（20×exit=0、20×`Tests 4 passed (4)`、零 failed，本审查逐行计数复核）、`fileA-red-iter3`（12 failed \| 10 passed）+ `f1-fix-iter3`（五文件 md5 还原全 OK）、`fileA-green-iter3`（22/22）、`pnpm-test-iter3`（304 files / 3261 tests 全绿；File A L10、File B L280、#233 L446 实测行）、`typecheck-iter3`（两包 + 根 14 工程 exit=0）、`doc-checks-iter3`（六查全零命中 + `git diff --check` 干净）——关键行逐条核对 |
| 实现锚点 | iteration 1 已读（`update-transfer.ts` / `hub-namespace.ts` / `peer-namespace.ts` / `update-channel.ts`）；本轮 `git status` 复核 src 零改动 |
| 运行基建 | iteration 1 已读（`vitest.config.ts` include、根 `package.json`、`ci.yml` 分片枚举、两包 tsconfig）；本轮未变 |

## 2. Verdict

**approve（0 BLOCKER / 0 MAJOR / 0 当前阻断 finding）**。

- **issue246-SA4-F1（前轮 MAJOR）已完全解决**，由本复审以源码逐行读取独立确认，不采信前轮日志：`ws-replication-issue246-interop-matrix.test.ts` L564-567 为四条对称回落腿（`baseline/peerToHub` → `stripped/peerToHub` → `baseline/hubToPeer` → `stripped/hubToPeer`），M2 的「v2 peer ↔ v1 hub」格现在逐条行使 M1 全部行为断言（含 N4 按侧 resync 断言，hub 写镜像腿 = 发射侧 hub `send-failed/update-too-large/needs-resync` 恰一 + 接收侧 peer `remote-declared` 恰一 + hubToPeer wire `RESYNC_REQUIRED` 恰一 + 该写零 UPDATE/零 UPDATE_CHUNK + ≥1 条 >8KiB SYNC_STEP2 + peer 副本收敛 20KB）；
- **已批准的等价性覆盖完整保持且严格增强**：三层确定性等同比对（(a) `kind#sequence` 序列、(b) 确定性字段逐字段、(c) Yjs 承载帧 kind+计数；逐方向 post-HELLO）位于全部四条腿之后（L571-581），比对时间线现包含超限 hub→peer 载荷腿而非仅握手/reconciliation 回声；全文件复核确认零新增跨会话字节/长度相等项（唯一字节级断言仍限 interposer 同会话 HELLO 字节对 L533-558），N9 双会话操作序列逐一对齐（每会话均为 peer 写 → hub 写，`makeNode` 独立计数随机源）；
- 验收标准全数满足：File B 4/4 绿（M2 含 hub 写腿）；×20 重复 20/20 exit=0 零假红；根 `pnpm test` 304 files / 3261 tests 全绿；SA3 报告 Deviations-6 显式登记 iteration 1 缩减并由 iteration 2 修复、iteration 3 独立确认——缩减已消除且已披露；
- N-OBS2（M2 `connectionState()==='ready'` 对齐）已顺带落实（L569）；N-OBS1 维持非阻断登记（SA3 已列入 Deferred verification 后续票）；N-OBS3/4/5 无冲突。
- 其余维度零漂移：文档 diff 与 iteration 1 审查基线逐字一致（36 insertions/8 deletions；§10.3/ADR/CONTEXT 锚点复核）；File A md5 未变（红面 12 条由 SA3 以 stash 独立复现并 md5 还原全 OK）；ALLOW/DENY 零越界（src/vitest.config/tsconfig/package.json/pnpm-lock 零改动）；#233 基线 3/3 绿。

## 3. 上游要求落实

| Requirement or finding | Implementation evidence | Assessment |
|---|---|---|
| AC1 协议文档修订 + 三方逐字一致 | iteration 1 已全量核可；本轮 diff 复核逐字未变（§1 词条、§5 L114 改挂、§10.3 四段收口、§22 两条目） | 落实（维持 iteration 1 结论） |
| AC2 ADR 0013 已接受 + wire 权威让渡 | ADR L4 状态行 + L122 两层权威；diff 未变 | 落实（维持） |
| AC3 互通矩阵提交并绿 | **M1（双方向 ✓）/ M2（四条对称腿 ✓，F1 已解决）/ M3（双方向 ✓）**；#233 基线 3/3 绿（全量 L446）；File B ×20 零假红 | **落实（前轮部分落实项闭合）** |
| AC4 golden vectors + §22 锁定值 | §22 两条目 + 5 资产全路径（iteration 1 已核；diff 未变） | 落实（维持） |
| AC5 文档验证 | `doc-checks-iter3.log` 六查全零命中 + `git diff --check` 干净（本审查逐条 exit 码复核） | 落实（维持） |
| Owner 评论 | REST `[]`，无 comment ID/updated_at 需落实 | 无遗漏面 |
| SA4 iteration 0 F1 + N-OBS1-5 | 见 §SA4 前轮 Finding 复核（下表） | F1 闭合；N-OBS2 闭合；N-OBS1 登记延后；N-OBS3/4/5 无冲突 |
| SA2 F1–F4 / N1–N9 | iteration 1 已逐条核可；本轮 N4（按侧断言对 M2 双方向腿生效）、N9（双会话调用序列对齐）、F1 三层形态（比对位于全四腿之后）重点复核 | 落实且因 F1 修复覆盖面增强 |

### SA4 前轮 Finding 复核（iteration 1 独立验证）

| Finding ID | 前轮要求 | 本轮独立验证 | Result |
|---|---|---|---|
| issue246-SA4-F1（MAJOR） | M2 在两条 peerToHub 腿之后、三层比对之前对称补 `assertV1Fallback(baseline,'hubToPeer')` + `assertV1Fallback(stripped,'hubToPeer')`；两会话操作序列逐一对齐（N9）；建议顺带 `connectionState()==='ready'`；验收 = File B 4/4 绿（M2 含 hub 写腿全断言组）+ 三层等同仍绿 + ×20 零假红 + 根 `pnpm test` 全绿 + SA3 报告补登 Deviation | 源码 L564-567 四条对称调用（本审查 grep + 逐行读取确认）；L569 ready 断言在位；`assertV1Fallback`（L451-506）对 hubToPeer 腿按发送方=hub/接收方=peer 断言设计 §7.4.2 M1 行镜像腿全部断言（send-failed 恰一含 reason/channelState、remote-declared 恰一、wire RESYNC_REQUIRED 恰一、零 UPDATE/UPDATE_CHUNK、≥1 >8KiB SYNC_STEP2、收敛）；三层比对 L571-581 位于全四腿后且逐方向覆盖完整时间线；证据：File B 4/4 绿、×20 20/20 exit=0、根 304/3261 全绿、Deviations-6 登记 | **已解决（本审查独立确认）** |
| N-OBS2 | M2 对齐 M1 的 `connectionState()==='ready'` | L569 在位 | 已解决 |
| N-OBS1 | File A D2-3 错误码同句耦合正则（非阻断） | SA3 §Deferred verification 登记后续票；File A 未动（md5 一致），当前文本正确性 iteration 1 已三方对照确认 | 登记（非阻断，可延后） |
| N-OBS3/4/5 | 接受日期 / SA6 owned 路径 / teardown 惯例 | 无实现冲突；iteration 1 已核可，本轮零相关改动 | 无动作 |

## 4. 设计落实审查

| Design decision | Implementation location | Assessment | Finding |
|---|---|---|---|
| D1–D6（文档五面） | iteration 1 已逐项核可；本轮 md5/diff 复核零漂移（CONTEXT `2c5c9a73…`、ADR `922307e7…`、协议 `a3c8ade9…` 由 SA3 报告登记且 diff 与 iteration 1 基线逐字一致） | 落实 | — |
| D4 互通矩阵（R28 等价性 + interposer + F1 三层断言）——**M2 行** | File B M2（L518-582）：interposer 证据（L524-559，唯一字节级断言对象）+ 四条对称回落腿（L564-567）+ 三层逐方向比对（L571-581，位于全腿后）+ ready/helloAck 断言（L568-569） | **完全落实（前轮 F1 缺口闭合）**：M1 全部行为断言逐条成立（§7.4.2 M2 行明文），比对对象含超限 hub→peer 载荷腿 | — |
| §12.3-2 File B M2 契约 | 头注 L8-9 显式登记「双方向腿 / 超限 hub→peer 载荷腿 / 三层比对覆盖两方向完整时间线」；L561-563 段注释同义 | 落实；N6（decodeWire 协商上下文）、N9 前提、诚实边界头注均在位 | — |
| §12.3-1/-3/-4（M1/M3/数学锚） | M1 L511-516（双方向 + ready）、M3 L584-649（双方向分块 + 单 ACK + 零 resync + #233 R1 反向）、数学/分类锚 L651-686 | 落实；与 iteration 1 审查结论一致，未弱化 | — |
| §12.2 File A 22 条 | md5 `f5fc29e684acd0d111704a0946f4fb79` 与 iteration 1 记录一致 ⇒ 未改动；红面 12 条由 SA3 stash 独立复现（12 failed \| 10 passed）并 md5 还原全 OK（`f1-fix-iter3.log` L69-73） | 落实（红灯先行证据独立复现属实） | — |

## 5. 架构一致性与惯例

### 责任归属

| Behavior | Expected owner | Actual location | Assessment |
|---|---|---|---|
| wire 契约权威 / 配置语义权威 / v1 行为基线 / 文档契约可执行化 | 协议文档 / ADR 0013 / #233 刻画测试 / 包内 vitest include 域 | 与 iteration 1 相同（零漂移） | 正确 |

### 相似能力对照

| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
|---|---|---|---|---|
| F1 修复方式 | 设计 §7.4.2 M1 行镜像腿 = `assertV1Fallback` 既有参数化函数 | 复用同一 helper 仅补两条调用；未引入第二断言路径 | 一致 | 单一事实源；M1/M2 断言组不可漂移 |
| 传输层构型 / 随机源受控 | #243 live 构型 / `makeCounterRandomBytes` | 与 iteration 1 相同；M2 双会话均为 makeNode 原样组装 | 一致 | N9 前提在位 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| M2 等价性证据形态 | 设计 §7.4.2 F1 三层形态表 | File B (a)/(b)/(c) 投影函数 + interposer 字节对 | 低；零跨会话字节/长度相等项（本轮全文件 grep 复核） |

### 生命周期对称性

零生产生命周期变化（`packages/*/src/**` 零改动实测）。测试域与 iteration 1 相同：fake scheduler、每 `it` 独立实例、interposer 退订句柄透传；M2 会话未显式 teardown 同 #233 惯例（N-OBS5 维持）。

### 平行机制检查

| Candidate duplicate | Existing path | Actual path | Disposition |
|---|---|---|---|
| 无新增候选 | — | F1 修复零新增抽象/包装/配置面（仅两条既有 helper 调用 + 1 断言行 + 注释/头注措辞） | 正确 |

## 6. 文件范围审查

| Changed path | ALLOW entry | Purpose | Assessment |
|---|---|---|---|
| `docs/protocols/instance-replication-v1.md`（M） | ALLOW 第 1 行 | §1/§5/§10.3/§22 | 合规；diff 与 iteration 1 审查基线逐字一致 |
| `docs/adr/0013-chunked-live-update-transfer.md`（M） | ALLOW 第 2 行 | 状态翻转 + 两层权威 | 合规；仅 L4/L122 |
| `CONTEXT.md`（M） | ALLOW 第 3 行 | 注记清理 + 代际词条 | 合规 |
| `packages/replication-protocol/test/codec-issue246-doc-contract.test.ts`（新） | ALLOW 第 4 行 | File A 文档契约 | 合规；md5 与 iteration 1 一致 |
| `packages/ws-replication/test/ws-replication-issue246-interop-matrix.test.ts`（新） | ALLOW 第 5 行 | File B 互通矩阵 + F1 修复 | 合规；680→687 行，增量 = 两条对称腿 + ready 断言 + 注释（见 §9 弱化复核） |
| `artifacts/sa3-issue246-*.log`、`artifacts/sa8-conflict-gate-issue-246.md`（未跟踪） | 流程证据 | iter0-3 验证留档 | 可接受（既有先例；非源码/非规范契约） |
| `wiki/raw/task_issue-246_*.md`（未跟踪） | 流程产物 | 任务链产物 | 合规；断言源零 `wiki/raw` 读取（iteration 1 已核，本轮文件未引入新读取面——全文读确认） |

DENY 核对：`packages/*/src/**`、`apps/**`、`domains/**`、`vitest.config.ts`、`package.json`、`tsconfig*`、`pnpm-lock.yaml`、`ws-replication-issue233-repro.test.ts`、harness/driver 三件、既有 codec 测试五件、ADR 0010：零改动（`git status --porcelain=v1` 实测仅上表条目）。**零越界**。

## 7. 契约连锁审查

| Contract | Caller | Actual handling | Risk | Finding |
|---|---|---|---|---|
| M2 新增 hubToPeer 腿的 observer/时序耦合 | `assertV1Fallback` 内恰一性断言（hub collector send-failed 计数跨腿累计） | 腿序 = peer 写腿先行（该腿 hub 侧仅 remote-declared，无 send-failed），hub 写腿的恰一性不受前腿污染；且 M1 自 iteration 1 起同序双腿绿，形态已证 | 低 | — |
| 其余连锁面（File A 读根 docs / ADR 状态涟漪 / §10.3 normative 文本 / interposer 委托面 / HELLO_ACK 消费） | CI 分片、`pnpm test`、实现维护者、SA6/SA7 | 与 iteration 1 审查结论相同（零漂移）；本轮 File B 4/4、全量 304/3261 绿佐证 | 低 | — |

## 8. 错误、恢复与并发

- 零生产错误语义变化（docs + tests only；src 零改动实测）。
- 测试域：`settleUntil` 有界 microtask 泵不变；M2 双会话独立组装、无共享状态；×20 重复零假红（20×exit=0、20×`Tests 4 passed (4)`、零 failed——本审查对日志逐行计数复核）；M2 超时预算 60s（覆盖四腿 + 比对）。
- `assertV1Fallback` 恢复断言诚实：收敛谓词要求副本值一致且 namespace 离开 needs-resync/reconciling，无静默通过面；`before/after` 切片隔离该写新增帧，跨腿计数不混入 wire 断言。
- 无新增吞错面（interposer catch → passthrough 仅判型，iteration 1 已核可且未变）。

## 9. 测试质量审查

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
|---|---|---|---|---|
| File B M1（L511-516） | 双方向 v1 回落全断言组 + ready | vitest run；4/4 绿（iter3 日志 + 全量 L280） | 无；与 iteration 1 相同 | — |
| **File B M2（L518-582，F1 修复后）** | interposer 字节对证据（等长/同 sequence/除 optionalCapabilities 逐字段相等/差异全落 4 字节窗口/窗口值 [0,0,0,1]→[0,0,0,0]/重编码等价）+ **四条对称回落腿（peer 写腿 + hub 写镜像腿 × 两会话）** + helloAck/ready + 三层逐方向比对（位于全四腿后，比对对象含超限 hub→peer 载荷腿） | 同上；×20 20/20 exit=0 | **无缺口**：断言集相对 iteration 1 严格增强（+2 腿 +1 断言 + 注释），其余断言逐条未动（本审查对照 iteration 1 审查记录逐项回查）；无 skip/only/todo、无 console.log、无源码字符串断言、零跨会话字节/长度相等项（grep 实测） | — |
| File B M3 / 数学分类锚（L584-686） | 双方向分块全断言组；`selectCapabilities` 两行 + 0x42 拒绝分类 + 已协商可解码 | 同上 | 无；未动 | — |
| File A（22 条） | D1–D6 文档契约 | 绿 22/22；红面 12 failed \| 10 passed 独立复现 + md5 还原全 OK | 无；md5 未变 ⇒ 断言零弱化 | — |
| 触发面 | 根 `pnpm test` include / CI 分片磁盘枚举 / 两包 tsconfig | 全量 304 files / 3261 tests 含 File A（L10）/File B（L280）/#233（L446） | 无（iteration 1 已核；配置零改动） | — |

**F1 修复敏感性说明**：新增腿为内联 `await assertV1Fallback(stripped, 'hubToPeer')` 真调用——该腿任何行为回归（hub 侧回落缺失、wire 多/少 RESYNC_REQUIRED、UPDATE_CHUNK 泄漏到未协商方向、reconciliation 不收敛）都会直接红；修复无法被「删除断言式」绕过（删除即回到前轮 F1 形态，属再犯而非弱化通过）。

**红灯先行复核**：File A 红面 12 条（D1-1..5、D2-1..3、D3-1、D3-3、D4-1/2）与设计 §12.1 枚举一一对应（iteration 1 核可；iter3 独立复现 + md5 还原佐证未漂移）。SA6 红灯断言保持。

## 10. Required revisions

无（0 BLOCKER / 0 MAJOR / 0 MINOR 当前阻断项）。

前轮 issue246-SA4-F1（MAJOR）已解决并经本审查独立确认（§3 复核表；保留 Finding ID 供返工映射，不再是当前阻断项）。

## 11. 后续动态验证项

| Risk | Driver | Expected observation | Failure condition |
|---|---|---|---|
| M2（含 hub 写腿）≥20 次重复零假红的**正式验收** | SA7 动态轮（设计 §12.5 指定正式验收方；SA3 ×20 为佐证不替代） | ≥20 次重复全绿 | 任一次 failed |
| 真实 WebSocket transport 语境代际互通 | SA7（#243 real-transport 套件主链路） | 真实 transport 协商分块主链路保持绿（本票矩阵为 fake-duplex 构型，头注诚实边界已登记） | 回归 |
| N-OBS1（File A D2-3 同句耦合正则 + §13.2 叙述句同法锁定） | 后续测试强化票（SA3 §Deferred verification 已登记） | 错误码「对调」时 File A 红 | 两码对调仍绿 |

## 12. Non-blocking observations

| ID | Observation |
|---|---|
| N-OBS1（延续） | File A D2-3 错误码为「同节存在性」锚：并类/删除即红，但两码**对调**不红。当前文本正确性已由 iteration 1 三方对照确认；SA3 已登记后续票，非阻断。 |
| N-OBS6（新，登记性） | M2 的 ×20 稳定性日志为逐行 `run=N exit=0` 摘要形态（无逐次完整 vitest 输出）；正式 ≥20 次验收归 SA7，本轮作为 SA3 自证证据充分。 |

## 13. 复核命令（SA4 只读）

- 范围与漂移：`git log --oneline -1`（d1888cc）、`git status --porcelain=v1`、`git diff --stat`（36+/8-，与 iteration 1 基线一致）、`md5sum` 两测试文件（File B `4e7716518ce5297c7629369a5281e8fb` 687 行 / File A `f5fc29e684acd0d111704a0946f4fb79`）
- F1 核心：File B 全文逐行读（L1-687）；`grep -n "assertV1Fallback("` → L451/513/514/564/565/566/567；`grep -n "hubToPeer"` → L110/407/412/514/566/567/572/618/648；`grep -nE '\.(skip|only|todo)\(|console\.log'` 两文件均 exit=1
- 等价性形态：三层比对调用面 grep（仅 L576/578/580，逐方向）；跨会话字节/长度相等项 grep（零命中，唯一字节级断言限 interposer 同会话对）
- 证据核对：`artifacts/sa3-issue246-{fileB-green,fileB-20x,fileA-red,fileA-green,pnpm-test,typecheck,doc-checks,f1-fix}-iter3.log` 关键行（20×exit=0 计数、304/3261、12 failed \| 10 passed、五文件 md5 OK、六查 exit=1、typecheck exit=0）
- 文档面：`git diff` 全量对照 iteration 1 审查记录（逐字一致）
