# SA9 标准审查报告 — issue #237 最终 rebase diff（标准合规性）

- **阶段**：standards-review（SA9，iteration 0）| **日期**：2026-09-08 | **Dispatch**：sa-99ec1051-0e59-46fd-8b3f-430ea84dcad1
- **Verdict**：**approve**（无 BLOCKER/MAJOR；1 项 MINOR 非阻断）
- **审查对象**：rebase 后最终提交 `236ef0c`（`perf(doc-runtime): localize mutation validation boundaries`），父提交 = main `6a005a4`（含 #238 修复 #253 与 #252）；工作树干净（`git status` 零输出），diff = `git diff 6a005a4 236ef0c`（26 files，+3581/−33）
- **输入（全部读过）**：SA1 `task_237_design.md`、SA2 `task_237_sa2_review.md`（裁决一/二 + C2/C3/C4 约束）、SA3 `task_237_sa3_report.md`（含 §7/§8 附记）、SA4 `task_237_sa4_review.md`（iteration 1 approve）、SA6/SA8 产物清单、实现 diff 全量逐文件、三包 AGENTS.md、docs/AGENTS.md、根 AGENTS.md
- **独立核验（本评审执行，非转抄）**：gh API 核对 Owner 评论 ID/时间戳；`git diff 6a005a4 236ef0c` 逐文件；`git show 6a005a4` 对照 main 侧 #238 改动面；grep 冲突标记/公共面泄漏/baseline 状态机/#238 归因；`git diff --check`；EOF 字节核验

---

## 1. Dispatch 交办清单逐项裁决

### 1.1 Owner 三评论身份核验 ✅

`gh api repos/welltop-jim-wang/nomicore/issues/237/comments` 实测：

| Comment ID | updated_at（实测） | 交办值 | 一致 |
|---|---|---|---|
| 5553024739 | 2026-09-05T16:01:43Z | 2026-09-05T16:01:43Z | ✅ 逐字 |
| 5553067202 | 2026-09-05T16:08:47Z | 2026-09-05T16:08:47Z | ✅ 逐字 |
| 5556480468 | 2026-09-06T02:55:36Z | 2026-09-06T02:55:36Z | ✅ 逐字 |

各产物（ADR-0010 修订节授权链、registry AC-4 注释、SA4 §1 表）引用与实测一致。

### 1.2 局部化校验与 carrier 检查；无无关 ROOT 遍历/复制/校验 ✅

- **局部化管线实存**：`mutation.ts:97-102`——非空路径在 `extractYjsSnapshot` 调用点**之前**早委托 `prepareLocalMutation`；`extractYjsSnapshot`/`validateLogicalSnapshot`/`cloneJson` 仅存在于 legacy `set([])` 分支（`mutation.ts:103-113`），`verifySnapshotIntact` 仅 legacy 分支调用（`mutation.ts:77-79`）。
- **`mutation-local.ts` 零完整 ROOT 入口**：grep 证实该文件无 `extractYjsSnapshot`/`validateLogicalSnapshot`/`verifySnapshotIntact`/`cloneJson` 任何引用；S5 边界提取用 `walk`（局部投影，`extract.ts:91` @internal 接缝，issue #75 先例），S4 导航 `navigateHops` 只做逐 hop `get(seg)` 读取。
- **carrier 检查三层保持**：①导航逐 hop（map→Y.Map+string 段 / array→Y.Array+整数界内 / 中间在场 / 「不实例化不匹配载体」，`mutation-local.ts:117-180`）；②边界提取内 `walk` 逐节点 carrier 严格判定（`extract.ts:101/128/139/144` mismatch 即拒）；③提交后 `verifyBoundaryIntact` 边界重投影核同款 `walk` 复读。载体违规归**领域 ok:false**（设计 §7.3 表逐行对位；E204 保留给手造派生物）——Owner 5553067202 §3/§4 落实。
- **入仓机械锚**：A-1 计数锚（`issue-237-path-localized-validation-red.test.ts:149-206`）以 `vi.mock` 仅包装三 seam（`...mod` 透传其余导出），契约 = 计数恒 0、规模无关、零墙钟——符合 SA6 红灯纪律。

### 1.3 单 guarded transaction + 校验失败零副作用 ✅

- `applyValidatedMutation` 中 `transactGuarded` **唯一调用点**（`mutation.ts:74`），物理位于一切失败返回之后；`commitPrepared` 最小 edit（set/delete 目标键、insert/delete 数组段）逐行未动。
- 一切拒绝（S3 结构守卫 / S4 导航载体 / S5 边界提取 / S6 域规则与边界校验 / S7 detached 构造）在触碰 live Y.Doc 前决定；无 write-then-undo 路径（代码结构逐分支核实）。
- 测试锚在位：B-2（状态字节不变 + notify=0 + update=0 + 槽不中毒）、A-3×3（零写入）、A-7 对称面（边界内损坏整批 ok:false 零写入）。

### 1.4 文档化 follow-up ✅（无静默留白）

ADR-0010「issue #237 修订」节显式登记（diff 语境行核实逐字在场）：(a) 合法性重建机制另票（replication/损坏存量/不可信恢复）；(b) carrier validation 覆盖面审计（Owner 2026-09-05T16:08Z §1/§6 六项核实方向）。报告层另登记：上层同值重复写/五笔合并（MABF 集成方 origin/path instrumentation）与 #238 独立调查不归因本票（SA3 §4、AC 文档）。CONTEXT.md 四词条（逻辑快照校验/载体投影读取/重建校验/复制未校验）同步修订，符合 docs/AGENTS.md「改领域术语必更新 CONTEXT.md」「显式修订而非静默矛盾」。

### 1.5 五写 instrumentation 保留 dirty/wire 行为 ✅

B-4（`runtime-mutate-issue-237-hot-path-red.test.ts` 末 describe）：8k 无关条目 × 紧邻五笔叶子 set → ok×5、`notifyCount=5`（dirty 保持）、doc update 事件=5（wire count 事务层口径）、每笔 <256B（29–33B 量级锚）、library identity/规模/首末内容零触碰、尾部全局合法。30s 周期压缩理由（写路径零墙钟依赖）注释在案；wire 级冻结显式委托 `ws-replication-issue230-incremental-mutation.test.ts`（不重复搭复制链路）；零墙钟断言、零公共 API/事件面扩张（instrumentation 仅测试内 seam + gitignore throwaway harness）。

### 1.6 无 #238 归因 ✅

全 diff grep `#238`：出现面仅两类——(i) main 带来的 #238 ADR 修订节（diff 语境行，非本提交新增）；(ii) 「不归因」纪律声明（两测试头注 + wiki 报告层）。生产码/ADR/CONTEXT 无任何把 #238 阶梯延迟归因本 issue 的表述。

### 1.7 Rebase  resolution 同时保留 main 的 #238 文档与本 issue 的 #237 文档 ✅

- **唯一文本交叠文件 = ADR-0010**：`git diff 6a005a4 236ef0c` 显示 #238 修订节（标题 + 4 条登记）全部以**未改动语境行**保留（逐字节）；#237 修订节追加其后。两侧文档双保留成立。
- **无其他交叠**：CONTEXT.md / ADR-0007 / ADR-0008 未被 main 侧 #238（`6a005a4`）或 #252（`ca7a676`）触碰（两提交 stat 核实）；`docs/protocols/instance-replication-v1.md`（wire 唯一权威，#238/#252 均改过）被 #237 提交**零触碰**（diff 行数 0）。
- **main 侧资产在位**：10 个 `wiki/raw/task_238_*` 产物全数存在于 rebase 后树；#238/#252 源码与测试文件（namespace-runtime/namespace-registry/persistence/ws-replication）零改动（diff stat 证实 #237 只触及 doc-runtime src、vfsl src、namespace-registry 一个测试文件——该文件未被 main 触碰）。
- **语义交叠面静态清零**：#238 对 `createNamespaceRuntimeWithSeam` 的改动为可选参数加性（`replicationObservability?`/`WriteSequencer(metrics?)`/`enqueue` 可选 slotKind），#237 热路径测试的 seam 消费形态（`{handle, notifyDirty}`）保持合法；registry AC-4 测试的 `saveEvents` 为测试文件自带 stub（`registry-phase5…:214`），不依赖 #238 改动的 `testing.ts`。
- 无遗留冲突标记（全仓 grep `<<<<<<<`/`>>>>>>>` 零命中；`=======` 命中均为既有注释装饰线）。

---

## 2. 仓库标准合规（AGENTS/ADR/模块责任/惯例）

| 标准 | 证据 | 裁决 |
|---|---|---|
| 根 AGENTS「改 packages/* 前读就近 AGENTS.md」 | doc-runtime/vfsl/namespace-runtime AGENTS 均已读并对照 | ✅ |
| vfsl AGENTS：同步、确定性、判别联合返回不抛错；无 Yjs；公共 API 仅经 index.ts | `planMutationBoundary`/`applyMutationAtBoundary` 纯函数 + `wrapPlan`/`wrapApply` E100 崩溃边界收编；零 Yjs import；`index.ts` 纯 additive（+2 函数 +3 类型，头注标 issue #237） | ✅ |
| doc-runtime AGENTS：校验失败零写入；detached 构造 + 单 guarded transaction；公共面仅 index.ts；carrier 机制留本包 | §1.2/§1.3；`src/index.ts` 零改动（diff 0 行）；`mutation-local`/`verifyBoundaryIntact`/`navigateLive`/`PreparedCommit`/`LiveStep` 均为包内 @internal 接缝且未入 index.ts（grep 零命中）；public-surface-guard 三测试在位 | ✅ |
| ADR 修订纪律（docs/AGENTS.md：显式修订节 + 授权链先例 ADR-0006 #64/#79、ADR-0008 #93/#132） | ADR-0007「issue #237 修订」7 条（管线句/前置假设/set([]) 保持/SA2 裁决二损坏条款逐字 (i)–(iv)/失败边界与范围声明/等价硬前置/成本模型）；ADR-0008 仅镜像句 + 显式「其余零变化」枚举；ADR-0010 后备句逐字 + follow-up | ✅ |
| 单一事实源 | schema 解释单源 vfsl（新接缝复用 drillStep/structureLens/descendValues/validateSubtree，无第二解释器）；carrier 校验单源 doc-runtime；四既有 vfsl 公共导出函数体零触碰（diff 纯尾部追加 +339 行 + 头注）；无 generation/validity 缓存/baseline 状态机（grep 证实唯一提及为头注的否定声明） | ✅ |
| 生命周期对称 | 无新 lifecycle 面；`navigateLive` 导出沿用 `walk`（issue #75）@internal 包内接缝先例；`verifyBoundaryIntact` 落 install-verify.ts 同文件同 E201 码字族（C4 满足：复用 DOCRT-E201 字面量，append-only 纪律无需新注册） | ✅ |
| 文件范围 | 全部改动文件均在设计 §6/§7、SA8 D3/E1–E4、SA2 裁决与 SA4 回流指令授权包络内；namespace-runtime/ws-replication/persistence 源码零改动；版本号 bump（doc-runtime 0.1.12 / vfsl 0.2.3）经 SA3 §2 补登记、SA4 §4 裁决保留（workspace:\* 与 frozen-lockfile 不受影响） | ✅ |
| SA2 约束性交付（裁决一/C2、裁决二全套、C3、C4） | A-1 delete 腿改 optional `note`（严禁放宽 delete 词表注释在案，`…red.test.ts:193-197`）；A-7 两锚实存（修复语义 + 对称面，41→43 tests）；ADR-0007/0010 逐字采用 SA2 §3.2 定稿；fatal-contract W5 改边界内损坏形态且 fatal 契约面（E203）零改动 | ✅ |

## 3. 测试质量标准

- 三新测试文件均落根级 vitest include glob（`packages/*/test/**/*.test.ts`）；无 skip/only/todo、无源码 grep/readFileSync 断言、无墙钟断言、无真实 sleep（头注纪律声明在案）。
- 授权测试面变更四处（A-1 delete 腿、A-7 新增、W5 修订、registry AC-4 修订）全部带授权链注释（Owner 评论 ID+时间戳 / SA2 裁决 / ADR 修订节 / SA4 回流），断言为声明语义精确形，无弱化（raw 通道锚定面、E203 面、delete 词表均原样保留）。
- SA4（iteration 1）独立复跑根级 `pnpm test`：227 files / 2407 tests / 0 type errors / exit 0（`.mabf-bg/sa4-237-r2/root-pnpm-test.log`）。

## 4. 发现

- **MINOR（非阻断）**：ADR-0010 rebase resolution 留白瑕疵——`### issue #238 修订` 标题前双空行、文件末尾新增空行（`git diff --check` 报 `new blank line at EOF`；两祖先版本均以单 `\n` 结尾，确认为本次 rebase 引入）。纯装饰、零语义影响；docs/AGENTS.md 将 `git diff --check` 列为验证步骤，顺手清理即可，不阻断 approve。
- **非发现登记（残余验证说明）**：SA4 的全量绿证据采集于 rebase 前工作树（HEAD `9e3f0bf` + 未提交实现）；rebase 后状态（`236ef0c` on `6a005a4`）未经全量测试重跑（本角色不运行测试）。残余风险经 §1.7 静态交叠分析压缩至近零（src 零文件交叠、签名改动全部可选加性、测试 stub 文件自带）；全量重跑属后续动态验证/CI 面。

## 5. 结论

**approve**。最终 rebase diff 满足 dispatch 全部交办项：局部化校验与三层 carrier 检查实存且无无关 ROOT 遍历/复制/校验（A-1 机械锚在位）；单 guarded transaction + 校验失败零副作用结构性成立；follow-up 双项显式登记；五写 instrumentation 保留 dirty/wire 行为且无公共面扩张；无 #238 归因；rebase resolution 经逐字节对照同时保留 main 的 #238 文档（ADR-0010 #238 节 + 10 个 task_238 wiki 产物 + protocols 文档零触碰）与本 issue 的 #237 文档（E1–E4 + CONTEXT 四词条）。SA2 约束条件、SA8 文档义务、三包 AGENTS 边界、单一事实源与生命周期对称全部合规。1 项 MINOR（ADR-0010 留白）不阻断。
