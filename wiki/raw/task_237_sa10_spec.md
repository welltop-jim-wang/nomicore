# SA10 独立 Spec 审查报告 — issue #237：ordinary mutation 路径级/边界级校验（最终 rebase 态）

- **阶段**：spec-review（SA10，iteration 0）| **日期**：2026-09-08
- **Dispatch**：sa-b680ed2b-7d2e-4f7c-bb99-d0236f636d8f
- **审查对象**：最终 rebase 后提交 `236ef0c`（`perf(doc-runtime): localize mutation validation boundaries`），parent = `6a005a4`（origin/main HEAD，含 #238/#253 与 #239/#252）；工作树干净，分支 `mabf/issue-237` 领先 origin/main 恰 1 个提交。
- **Verdict**：**approve**
- **输入（全部读过）**：issue #237 正文（gh 全文）；Owner 三评论经 gh API 按 Comment ID 逐字重读核对（**5553024739 / 2026-09-05T16:01:43Z**；**5553067202 / 2026-09-05T16:08:47Z**；**5556480468 / 2026-09-06T02:55:36Z**——ID 与时间戳与 SA4 登记一致）；SA5 `20260906-bug-237.md`；SA6 `20260906-ac-issue-237.md` + `task_237_sa6.md`；SA1 `task_237_design.md`；SA2 `task_237_sa2_review.md`（裁决一/二）；SA8 `task_237_conflict_report.md`（clear，E1–E4）+ `task_237_design_conflict_report.md`（clear，C1–C5）；SA3 `task_237_sa3_report.md`（含 §7/§8 附记）；SA4 `task_237_sa4_review.md`（iteration 1 approve）；最终 diff 全量逐文件（生产 5 文件 + 测试 5 文件 + 文档 4 文件 + wiki）。
- **独立性声明**：未采信任一上游 SA 断言为前提。全部 AC 逐条回源（issue 正文 gh 原文 + Owner 评论原文 + 最终 diff 源码/测试全文）；rebase 正确性经 `9e3f0bf..6a005a4` 与 `6a005a4..236ef0c` 双侧 diff 交集独立核验；本角色不运行测试（动态证据引用既有留盘日志并标注其基准态）。

---

## 1. 验收标准逐条判定（issue 正文 13 项 + Owner 5553024739 修订项）

| # | 验收标准（issue 正文） | 判定 | 证据（最终 diff 锚点） |
|---|---|---|---|
| 1 | `mutateData()` 公共 interface 与结果联合不变 | ✅ | `packages/namespace-runtime/src` 零 diff；`packages/doc-runtime/src/index.ts` 零 diff；`applyValidatedMutation` 签名/结果联合逐字节保持（mutation.ts L66-85）；B-1 逐笔 `toEqual({ok:true})`；public-surface 守卫两测试在全量运行绿 |
| 2 | 唯一严格 FIFO write sequencer | ✅ | `write.ts`/`sequencer.ts` 零 diff（本票）；B-1/B-2 经真实 Runtime seam 透传；既有 `runtime-mutate-root-sequencer.test.ts` 在全量运行绿 |
| 3 | 校验失败零 Y.Doc 写入、零 dirty notification | ✅ | S3–S7 全部先于 `transactGuarded`（mutation.ts L72-74 结构核实：prepare 失败直接 return，无任何 live 写路径）；A-3×3（stateBytes 不变 + 0 update）+ B-2（+notify=0 + 槽不中毒） |
| 4 | 成功写保持最小 edit、单 guarded transaction、同槽 dirty notification | ✅ | `commitPrepared`/`transactGuarded` 零改动；唯一事务调用点不变；A-1/B-1/B-4（ev.count=写数、29–33B 量级上限 <128/256B、notify=写数） |
| 5 | set / delete / 批量 array-insert / 批量 array-delete 均走局部校验路径 | ✅ | `planMutationBoundary` 四操作全覆盖（validate-patch.ts 新增段）；mutation-local.ts 五 kind 分支；A-1 两用例对四操作断言三全量 seam 计数=0 |
| 6 | 判别联合、Record、optional、数组边界、嵌套引用与完整快照校验一致 | ✅ | A-6 28 场景 oracle 等价（决策 + 结果 doc 全等 + 失败零写三面）；等价性由 L1–L3 引理支撑（SA2 逐 kind 源码复核，本评审抽查 `validate.ts` 解释器无跨子树约束成立） |
| 7 | schema 语义要求更大上下文时安全退化到更高边界直至 ROOT | ✅ | R5 顶层 delete/顶层 Record 键 → 边界=ROOT map；`set([])` 保留 legacy 全量管线（mutation.ts L97-102 路由 + L103-116 原样）；A-6 空路径等价用例 |
| 8 | 不可信旧文档状态不能经增量路径静默变成"已验证" | ✅（按 Owner 5553024739 修订后口径） | Owner 明文修订该 AC：「不再要求本 Issue 建立……全局基线机制；应增加测试证明 mutation 不会访问、复制或校验无关 ROOT 分支」。修订后义务全落：A-1 计数锚（三全量 seam=0）+ A-2/B-3（反转=声明语义，注释授权链在案）+ B-4（identity/规模/内容零触碰）+ phase-1 前置假设写入 mutation-local.ts 头注与 `expectValidBaseline` 测试前置 + ADR-0010 follow-up (a) 合法性重建另票显式登记——无静默留白 |
| 9 | 提交后 internal invariant 检查不无条件重提重验完整 ROOT | ✅ | `verifyBoundaryIntact`（install-verify.ts 新增：O(1) 安装事实核 + O(boundary) 重投影核，不重过 schema）；A-1 断言 `verifySnapshotIntact`=0；E201 变体 C/D（committed:true、不回滚、不假成功）复用既有码字，fatal 分类不削弱 |
| 10 | 等价性测试 | ✅ | A-6（oracle = extract 产物镜像 + `validateLogicalSnapshot` 全量；28 场景含 union 交叉/判别非法/成员切换/Record 动态键/optional/数组边界/两级 ref/空路径） |
| 11 | 零写入/fatal/nested path/批量数组/carrier identity 回归测试 | ✅ | A-3/A-4/A-5 新增锚 + 既有族（fatal-contract、operations、nested-path-repro）在全量运行绿；W5 用例按 C3/设计 §13 授权修订为边界内损坏形态（授权链注释在案，fatal 契约面 E203 双用例零改动） |
| 12 | 大 ROOT benchmark/instrumentation 证明叶子写不复制/遍历无关分支 | ✅ | 入仓锚：B-4（8k 无关条目 × 5 笔：ok×5、notify=5、事件=5、<256B/笔、Y.Array identity+规模+首尾内容零触碰、尾部全局合法）+ A-1 规模无关计数锚；不入仓旁证：SA3 §7 post-fix harness（64k 五笔 0.29ms vs 基线 18.5s；`.mabf-bg/` gitignore 留盘）；零墙钟断言进仓 |
| 13 | 聚焦测试 + 根级 `pnpm typecheck` + `pnpm test` | ✅（附披露 D1） | SA3-r3 与 SA4-r2 两轮独立根级运行：227 files / 2407 tests / 0 type errors / exit 0（`.mabf-bg/sa3-237-r3/full-pnpm-test.log`、`.mabf-bg/sa4-237-r2/root-pnpm-test.log`）——**均在 rebase 前基准（9e3f0bf+工作区）运行**；rebase 态（236ef0c）无动态运行证据，静态核验见 §3，披露为 D1 |

## 2. Owner 三评论落实（dispatch 交办面逐条）

### 5553024739（2026-09-05T16:01:43Z，范围收敛）
- 删热路径旧完整 ROOT `validateLogicalSnapshot`：✅ 非空路径管线零调用（A-1 计数锚机械证明）。
- 不建 committed-generation/document-baseline 状态机：✅ grep 无 generation/validity 缓存（仅头注否定声明）；SA8 对照 9 授权边界内。
- 只提取/重建/校验路径 + 最近必要语义边界：✅ R1–R6 边界定夺（union 穿越位/Record 位/数组位/delete 父位/set 目标位）。
- 允许退化 ROOT：✅（AC#7）。
- replication/损坏存量/不可信恢复合法性重建另票：✅ ADR-0010 修订节 follow-up (a) 显式登记。
- 前置假设写入内部契约 + 测试前置：✅ mutation-local.ts L4-10 头注（双半边逐字）+ 两测试文件 `expectValidBaseline`。
- 测试证明不访问/复制/校验无关分支：✅ A-2/B-3/B-4 + A-1。

### 5553067202（2026-09-05T16:08:47Z，carrier 正确性与校验架构）
- §1 潜在正确性问题（logical 合法 ≠ document 合法）：✅ 按 §6 拆分登记为独立正确性 follow-up——ADR-0010 (b) 载明六项核实方向（extract/verify 各路径 carrier 职责、P0/load/replace/raw apply/恢复建立点、载体合法矩阵）；本票不夹带。
- §2 分层（vfsl 纯 JSON 无 Yjs；doc-runtime 拥有 carrier 校验）：✅ `validate-patch.ts` 无 yjs import、`packages/vfsl/package.json` 无 yjs 依赖（grep 零命中）；carrier 检查全部在 doc-runtime（navigateHops/walk/verifyBoundaryIntact）。
- §3 前置假设双半边 + 导航局部 carrier 检查：✅ 头注双半边；`navigateHops` 逐 hop `carrierOf` 判定（map→Y.Map / array→Y.Array + 界内 + 中间在场；违规 = 领域 ok:false 零写入，不实例化不匹配载体、不升格 E204）；A-4×2 锚定。
- §4 校验失败先于 live Y.Doc 写、禁 write-then-undo：✅ 代码结构核实（一切拒绝在 `transactGuarded` 前 return）；A-3/B-2。
- §5 实现方向（导航→边界投影→detached 模拟→子树校验→detached 构造→单事务→边界验证）：✅ 与落地管线 S3–S9 逐步对应。
- §6 后续拆分：✅ follow-up 登记如上；lazy cursor 未夹带（非目标遵守）。

### 5556480468（2026-09-06T02:55:36Z，生产证据与 benchmark）
- 大 ROOT + 连续五笔叶子 mutation（30s 周期压缩）：✅ B-4 紧邻顺序调用压缩，理由注释在案（写路径零墙钟依赖）；断言确定性计数，零 flake。
- 优化前后对比 + 完整 ROOT 投影次数=0 + sequencer 占用：✅ 入仓=A-1 计数锚（三全量 seam=0 即「完整 ROOT 投影次数=0」的机械证明）；前后墙钟对比与槽内占用定性=SA3 §7 不入仓 harness 证据（64k 五笔 18.5s→0.29ms）。
- 保持 dirty notification 与 wire update count：✅ B-4 notify=5/事件=5/字节上限；wire 层冻结引用 `ws-replication-issue230-incremental-mutation.test.ts`（全量运行绿）。
- **不把 #238 归因本 issue**：✅ 最终 diff 全量 grep——`#238` 仅以「不归因」纪律声明出现（两处测试头注 + wiki 产物登记）；生产码/ADR/CONTEXT 无任何归因表述。
- 不扩公共 API/事件面：✅ doc-runtime/namespace-runtime 公共面零改动；vfsl 两函数+三类型 additive（issue 正文「应优先复用或扩展」明文落点 + SA8 D3 裁决）；instrumentation 仅用测试内 seam 与 gitignore harness。

## 3. Rebase 正确性（9e3f0bf → 6a005a4 基底迁移）

- **提交图**：`236ef0c` parent = `6a005a4` = origin/main HEAD；分支领先恰 1 提交；工作树干净。单提交 squash 形态与 MABF 交付惯例一致。
- **双侧改动交集**（`9e3f0bf..6a005a4` ∩ `6a005a4..236ef0c`）：**仅 `docs/adr/0010-…md` 一个文件**。核验最终 diff：#238 修订节（基底侧追加）完整保留，#237 修订节（本票追加）紧随其后——相邻纯追加合入，无内容丢失、无误改对方条款（仅一处装饰性多余空行，见 O2）。
- **行为面交叠静态核验**（基底 #238/#252 改动 × 本票消费面）：
  - `sequencer.ts` 槽级记账：`metrics === undefined` 分支与既有 FIFO 实现逐字节同形（diff 内注释 + 代码双侧核实）；本票不注入 observability → 零行为差。
  - `runtime.ts`/`internal.ts`：第三可选参 `replicationObservability`，缺省 dormant（零时钟读/零样本）；`mutateData` 槽仅加 `'S'` 标签，链形不变。
  - `registry.ts`：observability 选项缺省 → seam 输入 `undefined`；`registry-phase5-replication-session-red.test.ts` 不引用 stages/stageClock/slotMetrics（grep 零命中），AC-4 断言的 dirty 计数路径（raw apply +1 / 普通写 +1）不受 dormant 记账影响。
  - `doc-runtime`/`vfsl`/`write.ts`/`ws-replication` 源码基底侧零改动。
- **本票交付文件内容独立于基底**：除 ADR-0010 外全部文件不在基底改动集内，rebase 后内容与 SA4 复审态逐字节一致。
- **结论**：rebase 机械正确（无丢改、无误并）；语义交叠全部为「缺省休眠」加性面。**披露 D1**：无 rebase 后动态测试运行（SA10 角色不运行测试）；上述静态核验 + CI/PR 全量运行为兜底。

## 4. 授权测试面变更核对（非 scope creep 判定）

| 变更 | 授权链 | 核对结论 |
|---|---|---|
| A-1 delete 腿 fixture 修订（optional `note?`；删 note 替代删必填 value） | SA2 裁决一 / SA8 C2；严禁放宽 delete 词表的注释在案 | ✅ 最小修订；oracle 决策零扰动；用例数/必红结构保持 |
| 新增 A-7×2（set 修复损坏载体目标位 + 对称面边界内损坏仍拒） | SA2 裁决二（约束性交付） | ✅ 与 A-2/B-3/A-4 互补成三分面（无关=不管/边界内=拒/set 目标位=修复）；例外注释在案 |
| fatal-contract W5 用例改边界内损坏形态 | SA8 C3 / 设计 §13 / Owner 16:01Z | ✅ 「领域失败不入 fatal 通道」意图保持；E203 契约面零改动 |
| registry AC-4 用例后半段反转为声明语义 | Owner 5553024739 + ADR-0010 修订节 + SA4 回流 | ✅ 断言为声明语义精确形（ok:true + n=9 + ext 原样 + 恰 +1 dirty）；raw 通道锚定面零削弱；文件其余 21 tests 零改动 |
| vfsl 四旧导出 | 设计 §6.1 硬前置 | ✅ diff 纯尾部追加 +339 行，四导出函数体零触碰（本评审 diff 核实）；既有 validate-patch/sa7 测试全量运行绿 |

## 5. 必须披露的未达成/残留项（PR 披露义务）

- **D1（MINOR，流程残留）**：根级全量测试绿证据（2407 tests exit 0 ×2 轮）产生于 rebase 前基准（9e3f0bf+工作区）；rebase 态（236ef0c）无动态运行记录。静态核验（§3）判定基底交叠全部为缺省休眠加性面、唯一内容交集 ADR-0010 为相邻纯追加，风险极低；PR/CI 必须重跑根级 `pnpm test` 收口。
- **D2（声明语义变更，非缺陷）**：「无关分支/触达面外既存非法数据不再被普通写发现」+「set 目标位旧值不读、合法写入即修复」属 Owner 授权的语义反转/让渡——已写入 ADR-0007 修订节损坏条款 (i)–(iv)、ADR-0010 后备句、CONTEXT「复制未校验」词条与四处测试注释。PR 说明必须显式引用该授权链，不得呈现为疏漏。
- **D3（已申报附带项）**：两包 package.json 版本 bump（doc-runtime 0.1.11→0.1.12 / vfsl 0.2.2→0.2.3）——SA3 §2 已申报、SA4 已核（workspace:\* 与 frozen-lockfile 不受影响）；保留声明，如总控另裁回滚仅需还原两行。
- **D4（pre-existing，非本票回归）**：E201 变体 C 无直接测试驱动（与旧 verifySnapshotIntact 同缺口）；NaN/Infinity/-0 oracle 怪稽面新旧管线一致——均登记 SA4 §9/§10，随 carrier 覆盖面审计 follow-up 处理。
- **D5（follow-up 显式登记在案，本票不承担）**：ADR-0010 (a) replication/损坏存量/不可信恢复的合法性重建另票；(b) carrier validation 覆盖面审计（Owner 16:08Z §1/§6 方向）；上层同值重复写/五笔合并需 MABF 集成方 origin/path instrumentation；#238 独立调查。

## 6. 非阻断观察（MINOR，不阻断 approve）

- **O1**：`set([])` legacy 分支保留 `extractYjsSnapshot`×1 + `validateLogicalSnapshot`×2 + `verifySnapshotIntact`——符合「唯一合法全量形态」契约，A-6 空路径用例锁定行为等价。
- **O2**：ADR-0010 rebase 合入处在 #238 修订节前多出一个空行（装饰性，文档无行为面）。
- **O3**：A-1 计数锚的 seam 包装面精确性已核（`vi.mock` 仅包 `extractYjsSnapshot`/`validateLogicalSnapshot`/`verifySnapshotIntact`，`...mod` 透传 `walk`/`validateSubtree` 链路不计数）——计数恒 0 的机械论证成立。
- **O4**：`delete []` 拒绝路径由旧管线 `placeDelete`（'delete 禁止删除 ROOT'）前移到 `planMutationBoundary` normalizePath（'patch 路径无效'）——决策等价（ok:false 零写入），message 文案漂移；唯一锁定测试（operations `expectZeroWrite` delete []）只断言零写入面，不受文案影响（SA2 非阻断建议 1 的已知自由度）。

## 7. 结论

**Verdict：approve。** issue #237 全部 13 项验收标准（含 Owner 5553024739 对第 8 项的明文修订口径）在最终 rebase 态 diff 中忠实达成；Owner 三评论（5553024739 范围收敛 / 5553067202 carrier 正确性分层与局部导航校验 / 5556480468 压缩五写 instrumentation 与不归因纪律）逐条落实；公共 interface/严格 FIFO/结果联合/单 guarded transaction/失败零副作用/dirty 与 wire 计数语义全部保持；follow-up 显式登记无静默留白；无 #238 归因；无 scope creep（四处测试面变更均具授权链且最小化）；rebase 机械正确、语义交叠全部缺省休眠。残留项均为 MINOR/披露性质（§5/§6），其中 D1（rebase 后全量测试运行）由 PR/CI 收口。

- 产物：本报告；证据引用——`.mabf-bg/sa3-237-r3/full-pnpm-test.log`、`.mabf-bg/sa4-237-r2/root-pnpm-test.log`（gitignore 留盘，rebase 前基准态）。
