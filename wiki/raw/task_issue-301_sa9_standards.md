# SA9 标准符合性审查 — issue #301（#295 切片 3）：分块 snapshot/sync 的 observer 8 型接线

- **dispatch**: sa-60ddc5f9-10f6-4aef-a50e-53394418bc10（mabf-sa9 / standards-review / iteration 0）
- **被审对象**: **已提交最终交付**——commit `799a6182b818ee0ba6372423c63ea59715a7435d`（`feat(ws-replication): complete chunked observer events`，单提交）vs 基线 `0f3eca53315574d1ceab823f1e98a648d3bb157a`（Parent PR #298 稳定 head）的全量 diff（21 文件，+4031/−86）
- **Owner-feedback 记录**: REST comments endpoint 返回空（无适用 owner 要求）——与任务简报 §Comments / SA6 §2 / SA2 §4 / SA3 头部 / SA4 头部一致
- **裁决**: **approve**（无 BLOCKER / 无 MAJOR；3 条 MINOR 观察不阻断）
- **SA9 纪律声明**: 本审查为纯静态独立复核（交付全量 diff 逐 hunk 实读 + 规范文本逐字比对 + 模块契约/导出面/DENY 面 git 取证）；未修改代码、设计或测试，未运行测试，未启动服务，未调度其他 SA，未 commit/push/PR/finalize。SA3/SA6/SA7 报告中的运行结果（契约 17/17、全包 516、根 3503、typecheck 全绿）作为引用证据对待；本审查结论独立建立在静态可核验事实上。

---

## 1. Reviewed inputs

| 输入 | 状态 | 用途 |
|---|---|---|
| commit `799a618` 全量 diff（21 文件）+ `git show --check` / `git diff --check` / name-status / pathspec 取证 | 逐 hunk 实读 | 被审实体 |
| `wiki/raw/task_issue-301.md` / `_design.md` / `_sa2_review.md` / `_sa3_impl.md` / `_sa4_review.md` / `_sa6_contract.md` / `_sa7_report.md` / `_design_conflict_report.md` / `_implementation_conflict_report.md` | 实读 | 上游产物链（设计 OD1–OD9、ALLOW/DENY、各 SA 裁决与登记） |
| 根 `AGENTS.md`、`packages/ws-replication/AGENTS.md`、`docs/AGENTS.md` | 实读 | 仓库与模块标准（边界、observer 隔离、导出面、验证门、文档权威分层） |
| `docs/adr/0019-chunked-sync-transfer.md`（L60–110 observer seam/错误码/非目标）、ADR 0013/0010 沿用面 | 实读 | 冻结字段集与纪律依据 |
| `docs/protocols/instance-replication-v1.md` §22/§23.1（L749–754/L783–785）/§23.3/§23.4 | 实读 | wire 唯一权威与事件词汇冻结行 |
| `CONTEXT.md`「分块复制传输」「同版本部署假设」词条 | 实读 | 领域词汇边界 |
| `packages/ws-replication/src/{types,bulk-transfer,hub-namespace,peer-namespace,round-engine,observer,index}.ts`（HEAD） | 实读 | 发射点/结算结构/导出面现状核验 |
| `packages/ws-replication/test/ws-replication-issue301-chunked-completeness-ac-red.test.ts`（1392 行）/ `ws-replication-api.test-d.ts` / `vitest.config.ts` / 包 `tsconfig.json` / 根 `package.json` | 实读 | 测试质量与 runner/typecheck 门核验 |

## 2. Verdict

**approve。** 已提交最终交付在全部九个标准维度上符合仓库与工程标准，无 BLOCKER / 无 MAJOR：

1. **交付身份正确**：HEAD = 点名交付 commit，parent = 点名的稳定 Parent PR head（`git log --format='%H %P'` 实测逐字一致）；单提交、空白检查双绿（`git show --check HEAD` 与 `git diff --check 0f3eca5..HEAD` 均 exit 0 零输出）。
2. **文件范围**：21 文件 = 设计 ALLOW 七文件（M）+ SA6 契约（A，SA6 固定验收输入）+ 4 个 SA7 证据日志（A，`artifacts/` 既定命名惯例）+ 9 个 wiki/raw 过程产物（A，tracked-wiki 惯例——全仓 1182 个 wiki/raw 跟踪文件）；DENY 面经 pathspec 全集 diff **零命中**（§6 实测）。
3. **规范一致性**：8 型事件字段集/side 信封/键集排除与 ADR 0019 L78–81 + 协议 §23.1 第 29–36 型行**逐字一致**（本审查在 HEAD 独立三源比对 types.ts ↔ 协议表行 ↔ api.test-d 镜像）；冻结文本在基线已存在（§23.1 行 12 处、ADR 0019 4 处实测）——交付是接线不是决策修订。
4. **模块责任**：发射点全部位于控制器层（hub/peer namespace），机制模块 `BulkTransferSender` 保持零观测面（仅经 `settlementOf` 单点供给结算记录）——对齐 `onUpdateSent`/`onUpdateAcked` 先例；公共导出面零变化（index.ts 零 diff、零 bulk-transfer 导出实测）。
5. **架构惯例**：11 处物理发射点（sent 3 / acked 3 / applied 3 / aborted 2）与设计 §10 调用方矩阵逐点对应；「决策落定后发射」次序逐站实测成立；单帧路径与 kind=0 面逐字节不变。
6. **单一事实源**：结算记录 `settlementOf` 单点构造（pullOne/settle 同源）；事件字段 = wire 申报/assembler snapshot/round 绑定的同源投影；控制器无平行记账。
7. **生命周期对称性**：零新增 acquire；`chunkedAckT0` 纯覆写单槽（单载体仲裁下恒属被结算载体）；事件/settlement 进程内小对象零持久化零 wire；assembly 易失性不变。
8. **测试质量**：契约 17 用例零 skip/only/todo/env、零源码字符串/快照断言、`ctx.stop()` ×17 清理、EVENT_KEYS 白名单与冻结键集逐键一致、Revision R1 判别式（`ackedSequence` 精确锚定）在位于 L714；api 型镜像 36 型全联合精确断言 + 8 型逐字段 + 3 处负向 keyof 锚，双门防漂移（包 tsc include `test/**` + 根 vitest `typecheck.include`）。
9. **文档标准**：协议 §22 仅加一行资产锚（numstat 1/0），沿用 #242/#246/#295/#300 登记惯例，引用权威源而非复制规则；§23.x 冻结文本、ADR、CONTEXT.md 全部零 diff（无新领域词——事件名 = 协议 §23.1 已登记词汇）。

3 条 MINOR 见 §8（均不阻断）。

## 3. 仓库 AGENTS / ADR / 文档权威分层符合性

| 标准 | 要求 | 交付实况 | 裁决 |
|---|---|---|---|
| 根 AGENTS「Domain docs」 | 单上下文布局：CONTEXT.md + docs/adr/ | 两者零 diff；8 型事件名 = 协议 §23.1 已冻结词汇（基线实测 12 处命中），非新领域词 ⇒ CONTEXT 无更新义务 | **符合** |
| 根 AGENTS「Module guidance」 | 改 packages/ 前遵守最近嵌套 AGENTS.md | `packages/ws-replication/AGENTS.md` 边界逐条核验（见 §4） | **符合** |
| 根 AGENTS「Instance replication」 | 触碰 observer/namespace 面时以 ADR 0010 + 协议为权威 | 交付以 ADR 0019/§23.1 已登记冻结值为唯一字段来源，零发明（SA8 两轮 clear 互证） | **符合** |
| 根 AGENTS「Typed Namespace writes」 | 新 mutation 路径须 typed 适配 | **不适用**——零新 Namespace 写入路径（peer 导入复用既有 `registry.importReplica`，该行零 diff） | N/A |
| 根 AGENTS「diagnostic change log」 | ADR 0011/0014 面 | **不适用**——诊断日志面零触碰 | N/A |
| 根 AGENTS「Git worktrees」 | worktree 须建于仓内 `.worktrees/` | 本 worktree 位于仓旁（`/home/wangjian/nomicore-fix-issue-301`）——Host 环境布置，**非交付内容**，见 §8 O-3 | 过程观察 |
| ADR 0019 L72–83 | observer 8 型 append-only、字段集对齐 chunked-update-* 四型、§23.4 纪律沿用 | types.ts 第 29–36 型逐字落地；`reason` 复用 `ChunkedUpdateAbortReason` 六值闭集零新词 | **符合** |
| ADR 0019 非目标 | 同版本部署假设、无互通矩阵 | 交付零 capability/协商/互通面（replication-protocol/** 零 diff） | **符合** |
| 协议 §23 头 L714–715 | 事件词汇 append-only、GA 后字段语义冻结 | 纯加性联合成员；联合头注释 28→36 型 + 出处登记 | **符合** |
| 协议 §23.1 L749–754/L783–785 | 第 29–36 型字段集/side/键集排除/语义逐字冻结 | 逐行比对一致：sent 恒无 latency；applied 无 transferId/sequence/效果组；sync-acked 无 sequence/syncRoundId；aborted 无 connectionId；snapshot 成功三型 side 字面量 hub/peer/hub，sync 四型与两 aborted 型 `ReplicationObserverSide` | **符合** |
| 协议 §23.3/§23.4 | safe-field、throw 隔离、决策落定后发射、无 observer 逐字节等价、clock 缺省整键缺失 | 全部发射经 `host.emitObserver` → `dispatchReplicationObserver` 单点（observer.ts 零 diff）；latency 全部条件展开；`sampleAckT0()` observer 门控（无 observer 零时钟调用） | **符合** |
| docs/AGENTS.md「Editing」 | 用仓库词汇；链接权威源而非复制；行为变化时更新受影响的规范文档 | §22 新行引用 ADR 0019/§23.1 而非重述字段集；唯一受影响规范面（§22 资产登记）已更新，其余规范面（§23.x/wire/FSM）无契约变化故零改动 | **符合** |

## 4. 模块责任（packages/ws-replication/AGENTS.md 逐条）

| 边界条款 | 交付实况 | 裁决 |
|---|---|---|
| 拓扑/认证/HELLO 门/FSM 不变量 | 零 wire/认证/握手改动；`BulkTransferSender` 相位机、namespace FSM、round 引擎、assembly 状态机零新转移（diff 仅含结算点观测追加与返回值） | **符合** |
| Registry lease/session 路由、transport 不触 Runtime 内部 | 零改动面（新代码只读内存结算字段与 `host.now`；peer 导入仍经 `registry.importReplica` 既有调用） | **符合** |
| ACK = sequenced live apply + dirty 语义 | 零语义改动（acked 事件在既有 ACK 结算之后发射，不改变结算行为；被拒 ACK 载体释放行为逐字不变） | **符合** |
| 注入 transport/scheduler/observer/clock seam；observer/adapter 失败按文档化隔离与关闭分类 | 全部新发射经既有 `emitObserver` 单点（try/catch 静默）；clock 经连接层 safeNow 折叠 + observer 门控；零新 seam | **符合** |
| 公共 API 经 `src/index.ts` 导出 | index.ts **零 diff**；`BulkTransferOutboundSettlement` 定义于 bulk-transfer.ts 且 grep 证实零 index 导出 = 包内私有；联合扩展经既有 `ReplicationObserverEvent` 导出加性可见 | **符合** |
| 验证门 | SA3 V1–V18（契约 17/17、包 516、根 3503、包/根 typecheck、api 型测）与 SA7 C1–C6 复跑记录在案（引用证据；本审查不重复运行） | **符合** |

## 5. 架构惯例、单一事实源与生命周期对称性

### 5.1 发射点结构与计数（HEAD 实测）

| 族 | 物理发射点 | 位置 | 恰一性结构保证 |
|---|---|---|---|
| sent ×3 | hub L604（snapshot）/ hub L776（sync）/ peer L1620（sync） | `pullOne` 末 chunk 分支同一同步栈 `onLastChunkSent(seq, settlementOf(state))`；awaiting-ack 后 pullOne 早退 | 中止载体到不了该点 ⇒ 与 aborted 互斥 |
| acked ×3 | hub L674（snapshot）/ hub L722（sync）/ peer L702（sync） | `settle(kind)` 三条件门（载体/kind/awaiting-ack）→ 返回记录，否则 undefined ⇒ 单帧/zombie/不匹配零事件 | hub `ACK_STATE_VIOLATION` connectionFatal 在 settle **之前** return（L660–664 实测）；被拒 ACK quiet 复核在 `round.onApplied` 之后（hub `isQuietState()` / peer `isInboundQuiet()` 按侧取真实方法名） |
| applied ×3 | hub L1528（sync）/ peer L636（snapshot 导入）/ peer L1808（sync） | isStep2 分支 syncChunked 改道（独立字段组不展开 base）；else 腿 `sync-diff-applied ...base` 逐字节不变；peer degraded 判别外层先行（R23 不变）；导入路径发射在 `importResult.ok` 判定与 `this.lease` 赋值之后、`tryOpenReplicationSession` 之前 | 迟到/失败/代际不符路径先于发射 return ⇒ 零伪成功 |
| aborted ×2 | hub L1071–1073 / peer L1016–1018（kind 三选路） | `busyKind ?? 0` reset 前捕获 → busy 守卫快照 → reset → 选路；六类 reason 置位点 diff 不可见（零改动自动接线）；终局失败族（无 reason）零事件保持 | busy 守卫 + 快照先于 reset 原样继承恰一不变量 |

合计 11 处，与设计 §10 调用方矩阵、SA2 O-3、SA4 §3 逐点互证。

### 5.2 单一事实源

| 事实 | 权威源 | 派生 | 漂移风险 |
|---|---|---|---|
| transferId/chunkCount/totalBytes（sent/acked） | 发送器载体状态（`settlementOf` L281–287 单点） | 事件字段同源投影 | 无——控制器不自记第二份（设计备选④拒绝并落实） |
| bytes（applied/acked） | wire 声明 totalBytes（assembler Σbytes 精确核对不变量 / 结算记录） | 事件字段 | 无 |
| syncRoundId（sync sent/applied） | round 引擎绑定块（`sendStep2` 闭包实参同源；`syncRoundId!` 沿用基线先例——0f3eca5 hub L1454 同写法实测） | 事件字段 | 无 |
| receivedChunks/receivedBytes（aborted） | assembler `snapshot()`（kind 无关；`update-transfer.ts` 零 diff） | 事件字段 | 无（快照先于 reset） |
| ack t0 | `chunkedAckT0` 覆写单槽（末 chunk 出站赋值） | ackLatencyMs 差值 | 低——单载体仲裁（enqueue 非 idle 防御重置）+ awaiting-ack ⟹ 本载体 onLastChunkSent 已触发 ⇒ 槽值恒属被结算载体 |
| 事件键集 | 协议 §23.1 冻结行 | types.ts 实现 / 契约 EVENT_KEYS 白名单 / api.test-d 型镜像 | 无——`toEqualTypeOf` 全联合精确断言 + 双 typecheck 门，加型不同步即红（自带防漂移） |

### 5.3 生命周期对称性

| Start/acquire | Stop/release | 裁决 |
|---|---|---|
| `chunkedAckT0` 写入（末 chunk 出站） | 覆写式（新载体）/ 弃置不消费（settle undefined ⇒ 槽不被读） | **对称充分**——纯覆写单槽，无 acquire/release 语义，无泄漏路径 |
| 观测发射（同步回调）/ settlement 对象 | 无异步资源、零持久化、零 wire 投影；dispatch 隔离吞 throw | **对称**——零新增 acquire；无 observer 零构造零时钟调用（N7 锚静态面成立） |
| assembly（既有） | 六类收口挂点零改动；kind=1 超时仅改 reason 实参（`kind === 1 ? undefined : 'timeout'`），终局收口行为逐字不变 | **对称保持**——易失性与丢弃语义未触碰 |

### 5.4 平行机制检查

第二 observer 分发/白名单（无——observer.ts 零 diff）、第二时钟通道（无——复用 `host.now` 连接层 seam）、第二结算账本（无——`settlementOf` 单点）、第二清理函数（无——`clearInboundAssembly` kind 选路泛化，置位点零复制）、仅服务单 Issue 的过度抽象（无——`BulkTransferOutboundSettlement` 四字段 kind 无关最小记录，供给 sent/acked 两类事件与 ACK 锚）。**全部无平行。**

## 6. 文件范围审查（交付 21 文件全量对账）

| 路径 | 状态 | 对账 |
|---|---|---|
| `packages/ws-replication/src/types.ts`（M +131/−3） | ALLOW 1 | 范围内——OD1 类型面；联合头注释与出处登记同步 |
| `packages/ws-replication/src/bulk-transfer.ts`（M +53/−3） | ALLOW 2 | 范围内——OD2/OD3；偏差（追加尾参）经源内注释 L60–70 登记 |
| `packages/ws-replication/src/hub-namespace.ts`（M +155/−28） | ALLOW 3 | 范围内——hub 侧九处接线 |
| `packages/ws-replication/src/peer-namespace.ts`（M +174/−32） | ALLOW 4 | 范围内——镜像 + OD5 form 参数化 |
| `packages/ws-replication/src/round-engine.ts`（M +26/−4） | ALLOW 5 | 范围内——OD4-3 结构化 form 穿线 |
| `packages/ws-replication/test/ws-replication-api.test-d.ts`（M +66/−1） | ALLOW 6 | 范围内——OD9-1 镜像同步（标题 26→36 型修正） |
| `docs/protocols/instance-replication-v1.md`（M +1/−0） | ALLOW 7 | 范围内——仅 §22 一行资产锚（hunk 头 `@@ -699,6 +699,7 @@`，§23 = L710 起零触碰） |
| `packages/ws-replication/test/ws-replication-issue301-chunked-completeness-ac-red.test.ts`（A 1392 行） | SA6 契约（SA3 侧 DENY，SA6 所有） | 预期存在——验收契约随交付入库 |
| `artifacts/sa7-issue301-*.log`（A ×4） | SA7 证据产物 | 预期存在——`artifacts/sa*-*` 命名与 issue 244/245/246/299/300 既定惯例一致；内容为测试运行输出（计数/时长），无敏感数据 |
| `wiki/raw/task_issue-301*.md`（A ×9） | 各 SA skill 固定产物 | 预期存在——wiki/raw 为全仓跟踪惯例（1182 个跟踪文件）；含任务简报（DENY「只读上游产物」但经 iteration 2 dispatch 点名授权做 EOF 空白修正，SA3 §8-4/SA4 §12 O-6 双登记，内容中性经 blob 取证） |

**DENY 面零命中**（pathspec 全集 diff 实测 0 行）：`docs/adr/**`、`CONTEXT.md`、`packages/replication-protocol/**`、`src/{observer,index,update-channel,update-transfer}.ts`、`test/ws-replication-observer-red.test.ts`、`test/ws-replication-issue300-*`、`defaults/validate/backpressure/frame-io/lifecycle-queue`；无 tmp/探针/bisect 残留；零 debug 残留（`console.*`/`debugger`/`FIXME`/`XXX` 新增行 grep 零命中）。

## 7. 测试质量标准

| 维度 | 实测 | 裁决 |
|---|---|---|
| 契约纪律 | 17 `it(`；零 `.(only|skip|todo)(`、零 `process.env`（grep 实测）；无源码字符串/正则断言、无快照、无 `readFileSync(src)` | **符合** |
| 红灯真实性 | 断言落在运行时行为（observer 载荷/wire 帧/状态/值/dirty 计数）；SA6 §13.1 实测 8 红均在对应前置断言之后失败（非 fixture 空转）——引用证据 | **符合** |
| 键集白名单 | `EVENT_KEYS`（L143–152）与 types.ts/§23.1 逐键一致（本审查逐型比对）；`expectChunkedEventShape` 白名单外键响亮红 | **符合** |
| Revision R1 判别式 | L714 `syncApplied.filter(m => m.ackedSequence === kind2 末帧序)` 恰一；对齐协议 §9.2 L246 语义；mutation 敏感度（SA6 §17.6 + SA3 V10 双向实证，引用） | **符合** |
| 清理与隔离 | `ctx.stop()` ×17（与用例数一致）；fake duplex + fake scheduler 虚拟时间仅超时用例受控推进；零 real sleep | **符合** |
| 型测镜像 | 36 型全联合 `toEqualTypeOf` + 8 型逐字段 `Extract` + 3 处负向 keyof 锚（sync-acked 无 syncRoundId、applied 无 transferId/sequence、aborted 无 connectionId）；包 tsconfig include `test/**/*.ts` + 根 vitest `typecheck.include *.test-d.ts` 双门（配置实测） | **符合** |
| Runner 覆盖 | 新契约命中根 `vitest.config.ts` include `packages/*/test/**/*.test.ts`（实测） | **符合** |
| 回归面 | DENY 锚（observer-red/issue300 双文件）零 diff；其场景不进入 chunked snapshot/sync 窗口（SA2 §11/SA8 D14 独立核验互证，本审查复核锚文件绑定形态 L194/L228 在 TS 参数省略规则下对加宽签名成立） | **符合** |

## 8. Non-blocking observations

| ID | Severity | Observation | 建议处理 |
|---|---|---|---|
| N-1 | MINOR | 交付 commit message「`feat(ws-replication): complete chunked observer events`」未携 issue 引用；近期 MABF 交付惯用 `fix(#300): feat(#295 切片 2)…` 格式（早期 observer-seam 交付 `feat(ws-replication): observe chunked update lifecycle (#281)` 亦携 PR 引用）。类型/范围前缀符合仓库 conventional-commit 惯例，仅缺追踪引用 | 无需改动；后续交付建议携 `#NNN` 引用保持可追溯性 |
| N-2 | MINOR | 设计 §8.1 接口表将 `onLastChunkSent` 写作「参数替换」，实现为「追加第 2 参」（保全 DENY 冻结锚 issue300-bulk-edge L194/L228 的类型绑定）。偏差已三重登记（SA3 §8-1、`bulk-transfer.ts` L60–70 源内注释、SA8 实现后报告 D4/§7-3），实体义务逐项保留，SA8 裁定 no-conflict；仅设计文档接口表措辞滞后 | 已充分登记，无需改动；后续设计文档维护时以两处登记为准（SA4 O-4 同判） |
| N-3 | MINOR | 根 AGENTS 要求 worktree 建于仓内 `.worktrees/`，本 worktree 位于仓旁（`nomicore/.git/worktrees/nomicore-fix-issue-301`）——Host 侧环境布置，**非交付 commit 内容**；api.test-d.ts 联合 it 块末尾新增一个空行（仓库无 lint/format 门，`git diff --check` 绿） | 过程性观察，不阻断；worktree 布置归 Host 流程 |

## 9. 结论

已提交最终交付（commit `799a618`，单提交、parent = 稳定 Parent PR head、空白检查双绿）在全部标准维度符合仓库与工程标准：

- **规范逐字一致**：8 型事件字段集/side 信封/键集排除与 ADR 0019 L78–81 + 协议 §23.1 第 29–36 型冻结行逐字一致（HEAD 三源独立比对）；冻结文本、ADR、CONTEXT、wire/配置/错误码面全部零 diff——本交付是已登记冻结值的接线，零决策演进；
- **模块责任正确**：发射点全部在控制器层既有结算结构上（11 处实测），机制模块零观测面、公共导出面零变化、observer 隔离单点零触碰、FSM 零新转移；
- **单一事实源与生命周期对称**：`settlementOf` 单点构造、事件字段全部同源投影、控制器无平行记账；零新增 acquire、覆写单槽无泄漏路径、assembly 易失性与六类收口挂点逐字不变；
- **文件范围自洽**：21 文件全部属本票交付集，DENY 面 pathspec 全集零命中，无临时文件/debug 残留；
- **测试质量达标**：契约纪律（17 用例/零 skip/真实 harness/清理齐全）、键集白名单与冻结行逐键一致、Revision R1 判别式在位、型测镜像双门防漂移、DENY 回归锚零触碰。

SA6（approve）/ SA2（approve）/ SA8（双 clear）/ SA4（approve）/ SA7（approve）的上游裁决链与本审查的独立静态复核结论一致。**approve。**

*SA9 只读审查：未修改代码、设计或测试；未运行测试；未启动服务；未调度其他 SA；未 commit/push/PR/finalize；唯一产出为本文件。*
