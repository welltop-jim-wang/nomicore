# SA10 Spec Review — issue #246：分块传输 wire 契约修订与新旧互通矩阵（issue #233 切片 5）

- dispatch：sa-84b26409-1f53-46d8-9e92-dbb8f5f2aedb（mabf-sa10 / spec-review / iteration 0）
- 审查对象：rebase 后已提交交付 `fffbc940a5a5e50a0ab1a9f112be8086a5e36257`（`docs(replication): finalize chunked transfer protocol contract`），分支 `mabf/issue-246`
- 父基线：PR #241 head `2c95ddc017024d25febb1a5685d151944a50d0c1`（freshly resolved；`git log` 实测 HEAD 父 = 该 commit）
- Issue comments：REST 快照 `[]`（dispatch 声明）——零 owner 评论，issue 正文 5 条 AC 为唯一任务要求来源
- 方法：纯静态只读（git/grep/文档与源码逐节对照/证据日志复核）。未运行测试、未启动服务、未改任何文件（本报告除外）

## 裁决：approve（0 BLOCKER / 0 MAJOR / 0 MINOR 阻断项；2 条已登记非阻断披露项）

5 条 AC 全部满足；rebase 忠实（交付五文件与 SA4/SA7 批准态逐字节一致）；零生产代码改动；无遗漏、无错误实现、无 scope creep。

## 1. 输入与基线核验

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-246.md`（issue 正文快照，5 AC + What to build + Blocked-by #245） | 已读 |
| `wiki/raw/task_issue-246_design.md`（SA1 iteration 1，批准契约） | 已读全文 |
| `wiki/raw/task_issue-246_sa2_review.md`（approve；F1–F4 已解决 + N1–N9） | 已读 |
| `wiki/raw/task_issue-246_sa3_impl.md`（iteration 3） | 已读 |
| `wiki/raw/task_issue-246_sa4_review.md`（iteration 1 approve；F1 闭合） | 已读 |
| `wiki/raw/task_issue-246_sa7_report.md`（approve；M2 ×20 正式验收） | 已读 |
| `artifacts/sa8-conflict-gate-issue-246.md` + `-recheck.md`（均 clear） | 已读 |
| 交付 diff 全文（3 文档 + 2 新测试） | 已逐节读并对照实现 |
| SA6 契约 | 不存在（设计 §0 如实登记；本票无生产缺陷，以设计 §12 为验收契约）——成立 |

**Rebase 忠实性（本审查独立实测）**：
- `git merge-base --is-ancestor d1888cc 2c95ddc` 成立——切片 1–4 交付链（#242/#243/#244/#245）完整保留于新基线，Blocked-by #245 满足；
- rebase 增量（`d1888cc..2c95ddc`）仅 `.github/ci/test-durations.json` + `apps/yjs-server/test/hub-restart-static-target-red.test.ts`，与交付文件集**零重叠**（comm 实测）；
- 交付五文件 committed blob md5 = 工作树 md5 = SA4 approve / SA7 验证记录值，全部逐字节一致：File A `f5fc29e684acd0d111704a0946f4fb79`、File B `4e7716518ce5297c7629369a5281e8fb`、CONTEXT `2c5c9a73…`、ADR 0013 `922307e7…`、协议 `a3c8ade9…`——**SA4/SA7 批准对象即被审 commit 内容，零漂移**。

## 2. AC 逐条核验

### AC1 协议文档全部相关节修订完成，字段顺序/消息语义与 ADR 0013 及实现逐字一致；文档间零矛盾 —— **满足**

- **§10.3 收口**（本票唯一实质新增）：占位句「属后续切片」已消失（grep 零命中），替换为 transfer 身份（uint32、(连接,方向,namespaceId) 域、自 1 严格递增不回绕、0 非法、transfer 内三声明逐字节一致）+ 发送端规则四条 + 接收端规则五条（含错误码三分类显式分列）+ 未协商门控保留句。三方对照本审查逐项独立实测：
  - 字段序：§10.3 表 namespaceId→transferId→chunkIndex→chunkCount→totalBytes→bytes = ADR 0013 消息形态表 = `payloads.ts` decodeUpdateChunk/encodeUpdateChunk 读写序 ✓；
  - 单帧规则（transferId ≥ 1、chunkIndex < chunkCount、chunkCount ≥ 1、bytes 非空 ≤ totalBytes、≤ maxUpdateBytes 超限 UPDATE_TOO_LARGE）= codec 实现逐字同向 ✓；
  - 发送端（chunkable 条件/出队惰性切片/独立 sequence + dataGateOpen + RR/transfer 占 1 窗口槽/ACK 计时锚 = 末 chunk 出站/中止复用）= ADR 0013 发送端规则节 + `update-channel.ts`（isChunkable 门控、activeTransfer 载体、effectiveInFlightCount、末 chunk inFlight.set → armAckTimer）✓；
  - 接收端（纯易失四元组作用域与全丢弃路径/首 chunk 分配前二维上界 + 几何一致/后续 chunk 逐字节一致 + chunkIndex === 已收数量 + Σ ≤ totalBytes/收齐 Σ===totalBytes 精确核对 → 一次 apply + UPDATE_ACK(末 chunk 帧序)/apply 前零 live 写入）= ADR 0013 接收端规则节 + `update-transfer.ts` accept/validateFirst/completeIfExact ✓；
  - 错误码三分类：首 chunk 声明超限 ⇒ `UPDATE_TRANSFER_TOO_LARGE`（fatal/config/failed）；几何/跨帧违例/连接级并发超额 ⇒ `UPDATE_TRANSFER_VIOLATION`（fatal/no/failed，ns 级连接保持 ready）；停滞超 `assemblyTimeoutMs` ⇒ 弃 partial + `RESYNC_REQUIRED{UPDATE_TRANSFER_EXPIRED}`（非终态）= §13.2 注册表（VIOLATION yes/no/failed、TOO_LARGE yes/config/failed）+ §9.4 词表 + 实现（`update-transfer.ts:184-193`、`hub-namespace.ts:707-715`/`peer-namespace.ts:690-699` chunkCount>上限→TOO_LARGE、`tryBeginInboundAssembly` 超额→VIOLATION、`armTimer('assembly')` 滑动 deadline → RESYNC_REQUIRED{UPDATE_TRANSFER_EXPIRED}；`transferViolation` = sendNsError + finalize('failed')）✓。
- **其余相关节**（切片 1–4 已登记，本票只校验不重登记，diff hunk 实测零触碰）：§5 注册表 `0x42 UPDATE_CHUNK` 行、§6.1 `0x00000001 CAP_CHUNKED_UPDATE` 行、§9.4 `UPDATE_TRANSFER_EXPIRED`、§13.2 两新码、§17 四配置 + 跨字段链①② + 「不得运行时 clamp」、§23.1 四事件型——全部在库且与新 §10.3 同向（File A D5 组绿锚锁定）。
- **文档间零矛盾**：ADR 0010 分块引用 grep 零命中（本审查重跑）；ADR 0013 正文为历史记录，其状态行与「取代与关联」节显式登记两层权威让渡（wire 冻结值 → 协议文档唯一权威；配置/理据 → ADR 保留；observer 事件词表单列 local seam 非 wire 契约），与协议 §23 头注「不改变任何 wire 字节」零冲突；CONTEXT.md 三分块词条 + 新增「实现代际」词条与协议 §1/§5/§22 用法一致（「ADR 0013 提议」「后续切片承接」残留均零命中）。

### AC2 ADR 0013 状态转「已接受」，修订节注明 wire 权威归属 —— **满足**

- L4 状态行 =「已接受（issue #233 切片 1–5 落地…接受日期 2026-09-10；wire 冻结值——消息码 `0x42`、字段序、capability/错误码/reason 词表锁定值——以 `docs/protocols/instance-replication-v1.md` 为唯一权威；配置表与设计理据权威保留于本文；observer 事件词表为 local seam 词表（协议 §23，非 wire 契约））」；
- 「取代与关联」节未来时子句「接受后以该文档修订」已改为已生效两层边界表述（grep 旧子句零命中）；§17 L535「ADR 0013 配置表为权威」原样保留——「唯一权威」未误伤配置表归属（R31 要求）。

### AC3 互通矩阵测试提交并绿 + #233 基线继续全绿 —— **满足**

- 已提交：`packages/ws-replication/test/ws-replication-issue246-interop-matrix.test.ts`（687 行，4 测）：
  - **M1 v1 peer ↔ v2 hub**（`chunkedUpdate` 缺省）：协商位恒 0 + 双方向 v1 回落全断言组（发射侧 `resync-required{send-failed/update-too-large/needs-resync}` 恰一、接收侧 remote-declared 恰一、wire RESYNC_REQUIRED 恰一、该写零 UPDATE/零 UPDATE_CHUNK、≥1 条 >8KiB SYNC_STEP2 收敛、回 live、连接 ready）；
  - **M2 v2 peer ↔ v1 hub**（旋钮 true + HELLO capability 剥除 interposer）：interposer 字节对证据（等长/同 sequence/差异全落 optionalCapabilities 4 字节窗口 [0,0,0,1]→[0,0,0,0]）+ **M1 全部行为断言于双方向腿逐条复现**（SA4-F1 修复在位，L564-567 四对称调用）+ M2≡M1 三层确定性等同（(a) kind#sequence 序列全等、(b) 确定性字段逐字段相等、(c) Yjs 承载帧 kind+计数；零跨会话字节/长度相等项，本审查全文件 grep 复核）；
  - **M3 v2 ↔ v2 协商分块**：双方向 UPDATE_CHUNK ≥2 帧（transferId=1、chunkIndex 连续、Σbytes=totalBytes、每帧 ≤maxUpdateBytes）+ 恰一 UPDATE_ACK 且 ackedSequence===末 chunk 帧序 + 零 resync + #233 R1 反向断言；
  - 协商数学与分类锚：selectCapabilities 两行 + 未协商 0x42 解码 `UNSUPPORTED_MESSAGE_TYPE`/connection/fatal/1002。
- 「逐字节保持」的可执行形态（三层确定性等同 + interposer 同会话字节对）系 SA2 裁决 F1 后批准的设计形态——跨会话 Yjs 载荷字节受 yjs 随机 clientID 影响本不可全等，该等价性论证与诚实边界在测试头注显式登记（见 §4 披露项 1）。
- 绿证据链（本审查不运行测试，采信经 md5 锚定零漂移的留档证据）：SA3 iter3 File B 4/4 绿 + ×20 全 exit=0；**SA7 正式验收 20 次全新进程 20/20 零假红**（`artifacts/sa7-issue246-fileB-20x.log` 已随 commit 提交，逐行 run=1..20 exit=0 复核）；SA4 逐行源码审查 approve；根 `pnpm test` 304 files / 3261 tests 全绿（`artifacts/sa3-issue246-pnpm-test-iter1.log` L579-580）；File A 红面 12 failed | 10 passed 经 stash 独立复现且 md5 还原全 OK。
- **#233 v1 基线**：`ws-replication-issue233-repro.test.ts` 不在交付 diff 内（零改动），3/3 绿（SA7 §5 + 全量运行 L446 留档）✓。
- 「锁定依赖组合的旧/新互通」由既有 `codec-version-interop.test.ts` 承载（在库绿，SA7 三锚 80/80 复绿），§22 条目已指向——R29 禁止发明旧版包 harness，符合批准契约。

### AC4 golden vectors 与新消息码锁定值纳入 §22 conformance 清单 —— **满足**

- §22 分块条目已挂资产锚：`0x42` 锁定值与 UPDATE_CHUNK 全字段 golden vectors → `packages/replication-protocol/test/codec-messages-golden.test.ts`；未协商拒绝与 `CAP_CHUNKED_UPDATE=0x00000001` 锁定值 → `codec-issue242-ac-red.test.ts`；新增「实现代际互通矩阵」条目含三代际格 + 三层等同表述 + 五个资产**仓库根全路径**指向（SA2 N7 采纳形态）。
- 五个引用文件本审查逐一实测在库存在。

### AC5 文档验证：链接与引用文件名检查、过期术语搜索、git diff --check 干净 —— **满足**

- 链接/引用文件名检查已可执行化（File A D6-1/D6-2，断言源仅 `docs/` + `CONTEXT.md`、禁读 `wiki/raw`——头注登记，grep 实测唯一 `wiki/raw` 命中即该纪律声明自身）；本审查独立重跑：§22/ADR 0013/CONTEXT 分块词条引用的全部 `*.test.ts` 与 `docs/….md`（唯一 = `docs/protocols/instance-replication-v1.md`）均存在；
- 过期术语六查本审查全部独立重跑，**全零命中**：`提议`（docs/ + CONTEXT.md）、`状态：提议`（ADR 0013）、`ADR 0013 提议`（CONTEXT）、`属后续切片`（协议）、`后续切片承接`（CONTEXT）、`UPDATE_CHUNK|CAP_CHUNKED|分块`（ADR 0010）；
- `git diff --check 2c95ddc..fffbc94` 干净（exit=0，本审查重跑）。

## 3. 范围与纪律核验（scope creep / 边界）

- **零生产改动**：`git diff --name-only` 交集实测——`packages/*/src/**`、`apps/**`、`domains/**`、`vitest.config.ts`、`tsconfig*`、`package.json`、`pnpm-lock.yaml` 零命中；交付 = 3 文档 + 2 新测试 + artifacts/wiki 流程产物（#245 交付 commit `d1888cc` 同形态先例，非新越界）。
- DENY LIST 零越界：#233 刻画文件、harness/driver 共享构件、既有 codec 测试五件、ADR 0010 均未触碰。
- 冻结面保护：§5/§6.1/§13.2/§17/§23.1/六字段序表 diff 零触碰（hunk 落点实测），与设计 R26 收口定界一致。
- 测试纪律：两新文件零 `skip/only/todo`、零 `console.log`、零源码字符串断言（SA4 grep + 本审查复核）；vitest include `packages/*/test/**/*.test.ts` 覆盖两文件，零配置改动。
- SA8 前置门禁与实现后 recheck 均 clear（R26–R31 逐条成立；父 PR 前进 commit 零重叠、非方向性返工）。

## 4. PR 必须披露的未达成/边界项（均已登记，非阻断）

1. **M2 等价性诚实边界（设计 §7.4.3 + 测试头注）**：interposer 建模的是 v1 hub 的 **wire 可见行为**（HELLO 交集单点），不运行 pre-#242 hub 代码；「v1 行为逐字节保持」的可执行形态 = 三层确定性等同断言 + interposer 同会话 HELLO 字节对，**不含跨会话字节/长度全等**（yjs 随机 clientID 使其结构性不可行）。残余风险由三层既有证据封堵（协商位单点门控 + #233 刻画基线 + codec golden 旧字节互通）。AC3 原文「逐字节保持」以此批准形态兑现——SA2 F1 / SA4 / SA7 均裁决该形态满足 AC3 意图。
2. **N-OBS1 延后（后续测试强化票）**：File A D2-3 错误码锚为「同节存在性」粒度——两码**对调**不红（并类/删除会红）。当前文本三方对照正确性由 SA4 iteration 1 确认；SA3/SA4/SA7 均已登记为后续票，非 material defect。
3. **流程偏差登记（无验收语义变化）**：设计 §11 标注 `[SA6 owned]` 的两测试路径由 SA3 落地（无 SA6 契约文件存在，SA4 N-OBS4 核可）；ADR 接受日期登记为工作树落地日 2026-09-10（SA4 N-OBS3 接受）；N4 按侧断言以 wire 发射侧为准（强于设计措辞单侧读法，SA3 Deviation 2 登记）。

## 5. 结论

**approve**。rebase 后交付 `fffbc94` 忠实满足 issue #246 全部 5 条 AC 与批准设计契约：协议文档相关节修订完整且与 ADR 0013/实现三方同向、文档间零矛盾；ADR 0013 已接受且权威归属显式；互通矩阵三格 + 数学锚提交并绿（SA7 ×20 正式验收零假红）、#233 基线零改动继续全绿；§22 收口含 golden/锁定值与全路径资产锚；文档验证六查零命中、`git diff --check` 干净。无遗漏、无部分实现、无错误实现、无 scope creep；两项披露义务（M2 等价性边界、N-OBS1 延后票）均已在上游产物登记，PR 描述应原样转述。
