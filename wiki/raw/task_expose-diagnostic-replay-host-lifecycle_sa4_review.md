# SA4 静态验尸报告 — issue #155（expose diagnostic replay & Host lifecycle）

**Date**: 2026-09-02（R1 全量审核）／ 2026-09-03（R2 限定复核，见「F1 复核」节）／ 2026-09-03（R3 恢复轮独立复核，见「R3 恢复轮」节）／ 2026-09-03 23:0x–23:11（**R4 恢复轮独立复审**，见「R4 恢复轮」节——最终 Verdict 以本轮为准）
**Verdict**: **pass**（R4 恢复轮最终维持——生产 diff 自 R2 起字节冻结（本轮独立复核）；R1/R2/R3 全部结论在新证据面上复认成立；本轮独立串行复跑：红灯契约 22/22（默认超时面，F1 持续有效）+ SA7 补充套件 6/6（`[SA7-DV]` 打点活链路复现）+ 全仓 `pnpm test` 259 files/2854 tests 全绿 + `pnpm typecheck` 0 errors，四项 exit 0；新增登记 1 项 Controller 工件 note（REPORT.md，见 R4.1）——不阻塞）

- **审核对象**：worktree 未提交 diff（16 文件修改 + 4 新文件（2 src + 2 test）；HEAD=b11eb9c；R3 时点）
- **约束基准**：`task_expose-diagnostic-replay-host-lifecycle_design.md`（SA1 R1，SA2 R1 pass）+ `…_sa2_review.md` + `…_sa6_red.md`
- **方法**：全量 diff 逐文件审读 + 关键锚点源码复核（P3/P8/P9、reader 连续性状态机、#150 冻结测试）+ 独立进程测试复跑（红灯契约 22 例 / 三包回归 1090 例 / yjs-server 存量套件 / 4 包 typecheck）

---

## 一、Scope Creep Guard（§1.1）

**ALLOW LIST 比对**（design §10）：14 个 ALLOW 文件全部命中、零缺漏。

| 实际改动 | 判定 |
|---|---|
| ALLOW 内 14 文件（config/diagnostics/diagnostic-replay/index/app/yjs-server pkg + registry 4 文件 + runtime 2 文件 + diagnostic-log reader/index + SA6 红灯测试） | ✅ |
| `packages/{namespace-diagnostic-log,namespace-registry,namespace-runtime}/package.json` | ⚠️ 仅版本号机械 bump（0.1.5→0.1.6 等，零依赖/导出面变化）；仓库惯例（commit 7626125 同款），**note 级**，建议 SA1 在 design §10 补记「随动版本 bump」豁免行 |
| `pnpm-lock.yaml` | ✅ 白名单（+`@nomicore/namespace-diagnostic-log` importer，对应 §5.8） |
| `wiki/raw/task_*` 8 文件 | ✅ 白名单 |
| DENY LIST（ws-replication/persistence/doc-runtime/vfsl/file.ts/schema/record/emission/…/main.ts 等） | ✅ **零触碰**（git status 逐一核对） |
| BLACKLIST（package-lock.json / yarn.lock / .DS_Store / TASK.md / *.bak） | ✅ 零命中 |

**E2E spec 触发性（§1.3）**：无 `*.spec.ts`，N/A。
**vitest 触发性（§1.4）**：新测试文件位于 `apps/yjs-server/test/` → root `pnpm test`（`vitest run --typecheck`，include `apps/*/test/**/*.test.ts`）覆盖，CI `ci.yml` L39 直接跑 `pnpm test`。✅ 接通。

---

## 二、设计一致性（§1.2）

逐条款对照 SA1 R1：

1. **§5.1 配置面** ✅：`validateDiagnostics` violation path 粒度逐行对齐设计表（`diagnostics.wat`/`diagnostics.retention.maxAgeMs`/`rootDir` 在 `enabled:false` 下仍必填…）；缺省策略不在 config 层展开 ✅；`deepFreeze` 沿用 ✅。
2. **§5.2 管理器** ✅：`createHostDiagnosticsManager` 与伪代码逐字段一致（无归属通道 / ensureAdapter 唯一构造点 / disabled 模式缓存（E4 路径）/ dropStub 三值词表 / O(1) 幂等 close 零 fs）。
3. **§5.3 组合根** ✅：boot 构造点（persistence fiber 后、registry fiber 前）、`requireClock` 注入、performStop 正序位置 + `finally` 幂等双保险（i2）逐字落实。
4. **§5.4/§5.5 Registry/Runtime 接线** ✅：`emitStreamOutcome` 接口 + `NOOP_DIAG` 增量、`createRuntimeDiagResolver` 非抛解析器、三处 factory 第三参、恰两处 emit 改 `emitStreamOutcome`（实测 `grep "diag\."` = 12 emit + 1 initStream，与 §12 审计一致）、internal.ts overload 保 type guard 两参形（typecheck + seam 测试绿）。
5. **§5.6 replay 工具** ✅：前置门（isSafeNamespaceId 单源 re-export）/ fs errno 收敛（ENOENT vs 其余）/ locator 三态 / attemptSeen-M2 / break-m2 / 五条件三态 / owned snapshot / 顶层 catch-all——算法 ①–⑧ 逐步对齐；N1（catch-all 不承诺快照）按 SA2 建议保守实现。
6. **§4-D10 物化原语** ✅：`materializeStrictRecordUpdate` 纯包内原语（decodeBase64Strict/validateInlineCarrier/validateSidecarFrame/decodeFrame），inline/sidecar 双侧复验，`frame.payload.slice()` owned 副本，绝不抛。

**⚠️ 有据偏离（2 处，均不阻塞、建议 SA1 备案）**：

- **D1（合理偏离，必要的契约保全）**：`emitStreamOutcome` 在 seam **无** `runtimeEmitterFor`（#150 时代 Host 形状）时**回退共享 emitter**（create-diagnostic.ts `emitStreamOutcome` 分支 3），设计 §5.4(c) 字面为「resolver 缺席 → 静默丢弃」。SA4 实证该字面规则会打破 #150 冻结契约测试：`registry-create-diagnostic-red.test.ts:436` 的 binding 恰为 `{emitter, initStream}`（无 runtimeEmitterFor），且 :370/:404 断言 #17 committed 记录**到达**该共享 emitter——按设计字面实现则该测试红。实现选择的 fallback 是 seam 的**静态属性**（构造期一次判定），不含跨续段可变路由状态，C1 数据键控论证不受影响（生产管理器恒提供 resolver → 生产恒走数据通道）。**回流目标：SA1 在 design §5.4/§12 补一行「resolver 缺席 → #150 legacy fallback」修订记录**（纯文档动作）。
- **D2（微小增量）**：日志包 index 额外 re-export `isSafeStreamId`（设计 D10/m3 只点名 `isSafeNamespaceId`）——§5.6 ① 的 locator `streamId` 文法校验必需，单源转发零新实现。零风险。

---

## 三、读写路径一致性（§2）

✅ 无分叉。写侧 = File adapter（#152–#154 冻结，零改动）；读侧 = `readStreamStrict`（冻结）+ 新物化原语（包内单源）；replay 工具 locator 布局与 `file.ts resolveResumeCandidate` 同一物理契约（`{rootDir}/namespaces/{ns}/current.json`）。配置面 `diagnostics` 为纯本地旁路：E1 断言 snapshot bytes 无策略标记 + peer 数据面无策略，结构性隔离（§6.2）由 22/22 绿灯实证。

## 四、静默失败扫描（§3）

✅ 无新增静默失败路径。逐通道核对：`binding.emitter` 丢弃 → NDJSON 计数事件；`runtimeEmitterFor` miss → dropStub（携 namespaceId，与 `unattributed` 可区分，C1 附加要求满足）；ensureAdapter 防御 catch → `diagnostic-log-manager-failed`；E4 disabled 模式 → 构造期 observer 健康事件；replay 全错误类收敛进 issues（M1 映射表 8 行逐一落地）。唯一无通道路径 = seam 违约静默（D11/i1，设计备案维持，#150 no-op 先例同款）。

## 五、降级方案审查（§4）

✅ 安全。D1 偏离（legacy fallback）经论证为契约保全而非缺陷掩盖（见 §二）；replay 顶层 catch-all 为防御深度（结构性不可达），不冒充可解释状态（`replay-internal-error`）。

## 六、极端条件攻击（§5）

静态攻击 replay 工具边界，全部收敛不抛：

- `request` null / `namespaceId` 非法文法 → 前置门 `failed{locator-missing}`（零 fs）；
- `current.json` 为目录（EISDIR）/EACCES → `locator-unreadable`；JSON/形状/文法坏 → `locator-invalid`；
- 伪造 `[genesis(seq5)]` 首记录流：reader 连续性锚（historyTrimmed=false 恒 1n，reader.ts:528/680）必产 `sequence-gap` → ③ 透传 → 不可能伪 complete；`[attempt…, genesis]` 篡改流 → `attemptSeen`（M2）→ `genesis-misplaced` + `genesis-missing` → failed ✅；
- 双 genesis / genesis 后 update-omitted / 中段 gap / applyUpdate throw → 对应码 + break；
- BigInt 比对仅作用于 reader 已校验 canonical 十进制 sequence；逃逸 throw 落顶层 catch-all。
- ⚠️ 两点 note（不阻塞，交 SA7）：(a) record 级 issues 会经 `read.issues` 镜像（③ 全量）与 ④ 停止点**双份**进入报告（保守方向，只多不少，不影响三态判定，m2「截断」语义在镜像面上未完全闭合）；(b) `fatal-committed effect:'unknown'` 记录按「其他」分支推进 lastSeq（record.ts:98 形状），设计 §5.6 未显式归类——按 best-effort disclaimer 语义可接受，建议动态验证覆盖。

## 七、错误处理链路（§6）

✅ 完整。config → violations 管线；plugin → lenient 非抛边界；resolver → try+形状门+吞没；manager → 构造 catch；replay → 全收敛。**§1.6 契约连锁审计**：全部为加法契约（可选参/可选成员/新增导出/白名单加键），无 return→throw、无同步→异步改动；caller 枚举实测与 §12 一致（`createNamespaceRuntimeForRegistry` 生产 caller 恰 1 + 测试 7；`createNamespaceRegistryPlugin` 生产 caller 恰 app.ts:198；`diag.` 12+1 点全分类）。既有 `app-config-red` 无 `diagnostics` 键断言冲突（实测 grep 零命中）。

## 八、架构评估（§7）

✅ 可行。无退回信号：零 `FIXME`、无绕过架构约束的硬编码、降级非唯一路径、触碰模块均在设计裁定面内。

## 九、过度设计审查（§8）

✅ 精简。~490 行增量承载 6 条 AC（含完整三态重放工具 + 5 例真实进程 E2E）；overload 技法为冻结 type-guard 测试的最小保全手段；无投机抽象。

---

## 十、测试与验证证据（独立进程复跑）

| # | 命令 | 结果 |
|---|---|---|
| V1 | `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts`（= root `pnpm test` 对该文件的精确语义） | **18/22 pass，E1–E4 fail**（`Test timed out in 5000ms`） |
| V2 | 同上 + `--testTimeout=300000` | **22/22 pass**（E1≈6s/E2≈6.1s/E3≈6s/E4≈6s/E5≈12.6s） |
| V3 | `vitest run packages/namespace-registry/test packages/namespace-runtime/test packages/namespace-diagnostic-log/test` | **97 files / 1090 tests 全绿**（含 #150 冻结契约、internal seam 恰两键、type-guard、schema-freeze） |
| V4 | `tsc --noEmit` × 4（yjs-server / registry / runtime / diagnostic-log） | **0 errors** |
| V5 | yjs-server 存量套件（除红灯文件）——**隔离串行复跑** | **17 files / 86 tests 全绿** |

**V5 归因注记**：首轮 V5 曾与 V3（三包 1090 例）并发执行，出现 3 文件/6 用例超时失败；**隔离复跑后 17/17 全绿** → 判定为并发负载下 spawn 型 E2E 的环境抖动，**非本任务回归**（存量套件零失败）。该现象同时反证 F1 的边界敏感性：E1–E4 实测单例 ≈6s（无并发负载时），5s 默认超时下无余量。

**注**：首次裸跑（无 `--conditions=nomicore-source`）出现 5 例 `ERR_MODULE_NOT_FOUND: @nomicore/ws-replication/dist`——为运行方式错误（spawn 子进程依赖该 export condition 解析 workspace 源码），非实现缺陷；V1 已用规范 env 排除该干扰。

---

## 阻塞项 F1（reject 依据）— E2E 夹具缺 vitest timeout 参数，标准 runner 下结构性红

**现象**：`apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts` 的 E1(:840)/E2(:895)/E3(:938)/E4(:962) 使用两参 `it(name, fn)`，未传 vitest timeout；仓内 root `vitest.config.ts` 无 `testTimeout` 覆盖（默认 5000ms）。四例为真实进程 E2E（spawn tsx + boot + provision + SIGTERM），实测每例 ≈6s > 5s → **在 CI 的 `pnpm test`（ci.yml L39，与 V1 同语义）下必红**。E5(:991–1074) 已传 `300_000` 故通过；仓内先例 `hub-restart-static-target-red.test.ts:179`（T6）同样以 `240_000` 三参形态承载——E1–E4 漏传属夹具笔误（红灯期 E2E 在 config parse 门快速失败，5s 超时不可见；绿灯期暴露）。

**影响**：AC6 的 E2E 组合面无法在标准 runner/CI 下呈现绿灯——「测试全绿」的交付声明不成立。

**修复（回流目标：SA3，夹具行级修订，断言零改动）**：E1–E4 改三参 `it(name, fn, 120_000)`（或对齐 E5 用 `300_000`），与 T6/E5 先例同款。设计 §10 `[SA6 owned]` 注记与本票简报注 3（「fixture 步骤…由 SA3 修复」）均为此预留了通道。

**修复后验收**：`pnpm test`（或 V1 命令）下 22/22 绿即可转 SA7。

### F1 复核（R2，2026-09-03 — 限定范围：E1–E4 timeout-only 修改 + 标准 acceptance 命令绿灯证据）

**结论：F1 已按处方修复，验收通过。**

1. **timeout-only 证明（三层证据）**：
   - **mtime 隔离**：自 R1（09-02 22:2x–22:3x）以来全仓 diff 面仅 `apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts` 被改动（09-03 12:04）；16 个生产代码文件 + root `vitest.config.ts`/`package.json` mtime 均保持 R1 时点（vitest 配置零改动 → 默认 testTimeout=5000ms 仍适用，恰好证明夹具级参数是对症修复而非绕过）。
   - **行锚稳定**：E1:840 / E2:895 / E3:938 / E4:962 / E5:991–1074 与 R1 记录逐点一致，总行数 1075 未变 → 零行插删，只存在行内修改。
   - **改动内容**：恰 4 处收尾行 `});` → `}, 300_000);`（:893/:936/:960/:989），对齐 E5 先例（处方允许 120_000 或 300_000）；E5 原三参形态未动；`300_000` 全文恰出现 5 次（E1–E5）。
   - **断言零弱化**：E1–E4 函数体逐行读毕，与 SA6 冻结契约矩阵（简报覆盖表）逐锚一致——E1 genesis-baseline 首位 + namespace-create/replication-enable + snapshot bytes 策略标记扫描；E2 root-mutation + schema-replacement + sequence 连续；E3 SIGTERM exit 0（30s 界）+ 停机后 strict ok；E4 blocker 文件隔离 + provision/read 照常。文件内无 `.skip`/`.only`/`setConfig`/文件级 timeout 覆盖等伪造绿灯手段；用例总数恰 22（6 config + 11 R + 5 E）。
2. **标准 acceptance 命令绿灯**：V1 = `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts`（root `pnpm test` 对该文件的精确语义；**未加任何 `--testTimeout` 覆盖**，即 F1 原结构性红暴露面）→ **22/22 pass，exit 0**；E1 6332ms / E2 6077ms / E3 5924ms / E4 5964ms / E5 12561ms（E1–E4 均 >5s，复证 R1 诊断成立），`Type Errors no errors`，Duration 38.07s。独立进程执行（harness 后台作业，本沙箱 /tmp 不跨调用持久，skill 模板已按环境等价移植）。

---

## R3 恢复轮独立复核（2026-09-03 20:45–20:55 — 范围：当前未提交 diff 重核 + SA7 新增套件首审 + SA3 终局回归报告独立攻击）

**结论：pass 维持。SA3「零代码改动」的 flake 归因经 SA4 独立攻击未被推翻，新增证据持续加固。**

### R3.1 diff 冻结证明（R2 → R3 增量面）

- `git status` 全集 = R1 记录的 16 修改 + 3 新增，**加** 3 个增量：`apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts`（mtime 09-03 12:35:23）、`wiki/raw/…_sa7_report.md`、`wiki/raw/…_sa3_final_regression.md`（两 wiki 文件属白名单）。生产代码 mtime 逐文件 stat 复核全部冻结于 **09-02 22:22–22:35**；red test 冻结于 **09-03 12:04:48**（R2 修订时点）→ **生产 diff 与 R2 审核对象逐字节一致，R1/R2 八维结论无需重审**。
- `find apps packages domains -name '*.ts' -newermt '2026-09-03 13:46'` → 空（独立复跑 SA3 报告同款命令，结果一致）→ 13:45 总控红跑与其后所有绿跑执行同码。
- 机械 Scope/Blacklist/DENY 复检：BLACKLIST 零命中；DENY 面零触碰；comm 比对净增越界项恰 1 个（SA7 测试文件，R3.2 定性），3 个 `package.json` 为 R1 已处分的版本随动 note。

### R3.2 新增面 1：SA7 补充测试套件首审（自 R2 后新出现）

- **Scope 定性：note 级，不构成 creep reject**。该文件不在 design §10 ALLOW LIST 字面，但 §10 对 SA 管线自有测试明确预留「ALLOW 随交付记录追加，不由本设计预制」机制（原注记对象为 `[SA6 owned]`，机制同理适用于 SA7——SA7 报告「产出产物」表即交付记录）。测试 only、零生产触碰、不落 DENY 面（DENY「apps/yjs-server/test/** 其余文件」语义为**既有契约测试零改动**——新文件非改动；red test 同目录同款先例已获设计采纳）。
- **质量门禁全过**：✅ 无 `.skip/.only/setConfig`（grep 零命中）；✅ **§1.7 源码 grep 断言禁令**——5 处 `readFileSync` 全部读运行时产物（current.json 定位器 / 测试自产 segment 数据），无一处读 `.ts` 源码做字符串断言；泄漏探针（`ns-b-schema-leak-marker`）与 `att-` 探针断言的是**日志数据内容**而非源码文本；✅ 超时参数（30s/300s）逐用例传递、与 T6/E5 先例同款，非全局放宽；✅ 断言强度高：`PlannedPersistence` 按 docId 键控确定性注入（与调用次序解耦）、replay 三态/lastAppliedSequence/快照复现直断言、跨 namespace 污染双向探针（A 流无 B 痕迹 + B 无日志目录 + A 打开流零污染）、真实进程 enabled 态全生命周期 NDJSON 断言。
- **导入面**：`@nomicore/namespace-registry/testing`（包 exports 公开 subpath）+ `../../../packages/namespace-diagnostic-log/src/index.js` 相对导入——与本目录既有测试（`harness.ts`、`node-hub-peer-live.test.ts`、red test）同款模式；apps AGENTS.md「只用包公共导出」约束组合根 src，测试目录既有惯例一致。
- **vitest 触发性（§1.4）**：位于 `apps/*/test/**/*.test.ts` glob 内，root `pnpm test`（ci.yml L38-39）实测收集——本轮 SA4 全量 `✓ …sa7.test.ts (6 tests) 6809ms`。✅

### R3.3 新增面 2：SA3 终局回归报告独立攻击（`…_sa3_final_regression.md`）

对报告五个支柱逐一独立验证：

| 支柱 | SA3 主张 | SA4 独立验证 | 判定 |
|---|---|---|---|
| 代码一致性 | 13:45 红 → 19:09 绿之间零源码变更 | mtime/find 独立复跑（R3.1）+ 两失败文件、`packages/ws-replication/**`、`registry/src/testing.ts` 对 HEAD `git diff --stat` 为空（独立复跑） | ✅ |
| 结构性隔离 | 两失败用例未启用 diagnostics，#155 路径不可达 | grep 两失败文件 `diagnostic` **零命中**；源码逐点复核：resolver `diagnosticLog==null → ()=>undefined` 恒定（create-diagnostic.ts:290-291）、runtime 条件展开（runtime.ts:598-600）、plugin lenient 门（plugin.ts:184-192）、app 侧唯一无条件增量 = 停机 NDJSON 一行（app.ts:427-428）且两失败测试收口走 SIGKILL、不经优雅停机事件流 | ✅ |
| 既有断言面不受增量破坏 | ordered-shutdown 只断言 4 事件严格递增 | 该测试 `findIndex` 序断言复核（:77-86）——中间插入 `diagnostics-closed` 不破坏；且该文件在本轮全量绿 | ✅ |
| 同码异果（flake 定义性证据） | 12:35 绿 / 13:45 红 / 19:09 绿 / 19:14 绿 | 磁盘日志核验（`.pnpm-store/.sa3-logs/` 11 份 + `.sa7-logs/`：full ×3 均 259/2854 exit 0 且 .exit 文件在、isolated 4/4 与 5/5、满载 contend 6×+1 全绿，mtime 与报告时间线一致）；**SA4 自行第 4 次全量**：`NODE_OPTIONS=--conditions=nomicore-source pnpm test`（独立后台进程，`.pnpm-store/.sa4-logs/full-test-r3.log`）→ **259 files / 2854 tests / Type Errors no errors / FULL_EXIT=0**（192.54s，主机 load **6.10**——高于 SA3 满载窗 5.4–5.9），两「失败」文件本轮亦绿（phase5 5/5、issue171 4/4），#155 两文件 22/22 + 6/6 | ✅（同码 4 绿 vs 1 红） |
| CI 佐证 | main 10:23/10:30Z 两连绿 | `gh run list --branch main` 独立复跑：run 33744048759（10:23:40Z）与 33744667749（10:30:30Z）均 success，时间戳逐字吻合。注意：main CI 证明两失败文件在 HEAD 基线稳定，不证明 #155 diff 的 CI 面（后者待 PR） | ✅ |

**对「零代码改动」处置的攻击结论：正确，不打回。** 反事实检验——(i) 无确定性复现（SA3 满载定向连跑 8 轮 + SA4 本轮全量均绿）；(ii) 唯一可用「修复」= 改 ws-replication 测试注入时序或 phase5 超时（为未复现 flake 弱化/掩盖测试，SA4 §约束明禁）或改生产状态机（无缺陷证据 + 越 DENY 边界）；(iii) 观察项移交 PR CI（ubuntu 独占 runner）为正确裁决面。

### R3.4 残留风险登记（不阻塞，交总控/PR CI）

1. flake 归因为强旁证链（同码 4 绿 1 红 + 结构隔离 + main CI 佐证）而非根因证明；SA3 §3 两个机理假设（(a) 调度饥饿、(b) `RealWireTransport.inject` 双序号源竞态）均未复现。若 PR CI 复现 (b)，按报告建议另开票修测试注入基建（不在本票 ALLOW）。
2. PR 发布后须按 SA7 报告重点 1 命令补 CI run-log 摘录（本票唯一未闭合证据面——分支未推送所致，非测试未触发）。
3. design §10 ALLOW 追加备案（SA7 测试文件 + 3 个版本 bump 行）建议随 PR 描述一并引用，供总控归档。

---

## R4 恢复轮独立复审（2026-09-03 23:01–23:11 — 总控恢复轮指派：独立审查现有实现与测试，明确最终 Verdict）

> 本轮**不从 R1–R3 结论接力**：生产 diff 逐文件重读（16 修改 + 2 新 src 全量）、设计锚点独立复核（#150 冻结测试绑定形状 / reader 连续性状态机 / emit 调用点全枚举）、机械门禁（Scope/BLACKLIST/DENY/§1.7）独立重跑、四项测试独立串行复跑（harness 后台作业，规避 spawn 型 E2E 并发抖动）。R1–R3 文字结论仅作对照，不作依据。

### R4.1 基准冻结与增量面（R3 → R4）

- **生产代码零变更**：`find apps packages domains -name '*.ts' -newermt '2026-09-03 13:46'` → 空（独立复跑，与 R3.1/SA3 终局回归一致）；全部生产/测试 `.ts` mtime 冻结于 09-02 22:22–22:35（生产）/ 09-03 12:04（red）/ 12:35（sa7）→ **R4 审核对象与 R1/R2/R3 逐字节一致**。
- **R3 后新增触碰面（仅非代码）**：`wiki/raw/…_sa7_report.md`（21:00，R4 轮动态验证更新）、`…_dispatch.md`（21:01）、`REPORT.md`（21:14）、`…_conflict_report.md`/`…_relevant_decisions.md`（22:58/22:59，SA8 恢复复核）。其中 **REPORT.md 为 R4 新登记项**：tracked 文件、非 ALLOW/白名单字面，但 (a) mtime 21:14 = Controller 写入（SA4 R3 复核窗 20:45–20:55 之后、非 SA3 改动）；(b) 仓库既有惯例——`git log -- REPORT.md` 显示 b11eb9c（#151）、4755e1c、b66615c、6472485、5db6f83 五次任务收口 commit 均携带其前序任务报告更新；(c) 内容逐项核对诚实（259/2854、typecheck 0、SA4 R3 pass、SA7 R4 pass——与本轮 V3/V4 独立结果一致；`git diff --check` clean 亦独立复证）。**定性：Controller 工件 note，非 SA3 scope creep，不阻塞**；提示总控：`git commit -a` 会携带该文件，属既有惯例。
- `.mabf-bg/`（Controller 收尾脚本暂存）经 `git check-ignore` 确认被 `.gitignore:8` 覆盖，不入库。

### R4.2 机械门禁独立重跑（全部通过）

| 门禁 | 独立命令/证据 | 结果 |
|---|---|---|
| BLACKLIST | `grep -E "package-lock\.json$\|yarn\.lock$\|\.DS_Store$\|^TASK\.md$\|\.bak$"` | 零命中 ✅ |
| DENY LIST | `git diff --name-only HEAD` 对照 ws-replication/persistence/doc-runtime/vfsl/file.ts/冻结契约面/main/lifecycle/transport/adr/CONTEXT | **零触碰** ✅ |
| ALLOW LIST（§10） | 14 文件逐一比对（config/diagnostics/diagnostic-replay/index/app/pkg + registry 4 + runtime 2 + diag-log 2） | 14/14 命中、零缺漏 ✅ |
| 超界项 | 3×package.json 版本 bump（惯例 note）+ pnpm-lock（白名单）+ SA7 测试（R3.2 机制豁免）+ REPORT.md（R4.1 note）+ wiki（白名单） | 无 reject 级 creep ✅ |
| §1.3 E2E spec | 无 `*.spec.ts` | N/A ✅ |
| §1.4 vitest 触发 | 两测试文件均落 root `vitest.config.ts` include `apps/*/test/**/*.test.ts`；ci.yml L39 `pnpm test` 同命令；本轮 V3 实测收集（22 tests 40931ms / 6 tests 6933ms 摘录行在录） | 接通 ✅ |
| §1.7 源码 grep 禁令 | 两测试文件 9 处 `readFileSync` 逐一核对——全部读运行时产物（current.json/segment JSONL/manifest/snapshot bytes），零 `.ts` 源码字符串断言；red test 头部明示「零源码 grep」纪律 | 无伪测试 ✅ |
| 伪造绿灯手段 | `.skip/.only/setConfig`/文件级 timeout：两文件 grep 零命中；red test 22 例恰数、`300_000` 恰 5 次（E1–E5） | 无 ✅ |

### R4.3 设计一致性独立重读（不接力 R1–R3 文字）

生产 diff 逐文件重读，与 SA1 R1 §5.1–§5.8 逐条对照——**全部一致，两处有据偏离（D1/D2）独立复核成立**：

1. **§5.1 config**：`validateDiagnostics` violation path 粒度逐行对齐设计表（`diagnostics.wat`/`retention.maxAgeMs` 字段级、`rootDir` 在 `enabled:false` 下必填、retention `0` 合法/`null` 显式关闭/safe-integer 门）；缺省不展开、`deepFreeze`、白名单加键非放宽。✅
2. **§5.2 manager**：无归属通道（`unattributed`/`manager-closed`）、ensureAdapter 唯一构造点 + 防御 catch → `diagnostic-log-manager-failed`、E4 disabled-adapter 缓存、dropStub 三值词表各附产生方、close() O(1) 幂等零 fs。✅
3. **§5.3 app**：构造点（persistence fiber 后、registry fiber 前）、`requireClock` 注入、performStop 正序 `diagnostics-closed` + `finally` 幂等兜底（i2）。✅
4. **§5.4 registry**：本轮独立 grep `diag.` 调用点 = **13 处**（emitEarlyOutcome×3 + emitOutcome×7 = 10 个 pre-initStream 点零改动 + `emitStreamOutcome`×2（:1450/:1463）+ `initStream`×1）——与设计 §12「emit 12 + initStream 1」清单逐一吻合；三处 factory 第三参 = `resolveRuntimeDiag(ns)` 数据键控；resolver 非抛边界（getter try/形状门/吞没）。✅
5. **§5.5 runtime**：internal.ts 两参居末重载（type-guard 锁保全）+ runtime.ts 条件展开（`diagnostic !== undefined` 才注入 seam 字段——未启用路径逐字节不变）。✅
6. **§5.6 replay**：前置门（`isSafeNamespaceId`）→ locator errno 收敛（ENOENT vs 其余）→ 三态形状门（`isSafeStreamId`）→ strict 读取 → ③ stream 级全量镜像 → ④ attemptSeen-M2/break-m2/连续性 BigInt 复核/无基跳过不虚构 → ⑤⑥⑦⑧——算法逐步对齐；顶层 catch-all + N1 不承诺快照。✅
7. **§4-D10 物化原语**：纯包内原语、inline/sidecar 双侧复验、`frame.payload.slice()` owned 副本、绝不抛（顶层 catch 收敛 invalid）。✅
8. **D1 偏离独立复核**（本轮亲自读冻结测试）：`registry-create-diagnostic-red.test.ts:436` 起的 Host binding 恰为 `{emitter, initStream}`（**无** `runtimeEmitterFor`），且断言 #17 committed 记录**到达**共享 emitter——设计 §5.4(c) 字面「resolver 缺席 → 静默丢弃」会使该 #150 冻结契约红；实现的 legacy fallback 分支（`streamResolver === undefined` 时回退共享 emitter）是 seam 的**静态属性**（构造期一次判定，零跨续段可变路由状态），C1 数据键控论证不受影响（生产管理器恒提供 resolver）。**维持 R1 裁决：合理偏离，回流 SA1 备案（纯文档动作）。**
9. **D2 偏离独立复核**：`isSafeStreamId` re-export 为 §5.6 ① locator `streamId` 文法门（`locator-invalid` 判定）所必需，`paths.ts` 既有导出原样转发，零新实现。维持 note 级。

### R4.4 八维结论独立复认

读写路径（写侧 #152–#154 冻结 adapter / 读侧冻结 strict reader + 单源物化原语 / locator 与 `file.ts` 同一物理布局——无分叉）；静默失败（全部通道有 NDJSON 可观测，seam 违约静默为 D11/i1 备案维持）；降级（D1 = 契约保全、catch-all = 防御深度，均不掩盖缺陷）；极端条件（replay 全错误类收敛——预置门/errno/形状门/BigInt 仅作用于 reader 已校验 sequence/顶层 catch-all；§六 (a)(b) 两 note 经本轮 V2/V3 的 `[SA7-DV]` 打点**活链路复现**：镜像 3 份 invalid-json → partial 三态不受影响、fatal-unknown 推进 → complete）；错误处理（加法契约、无 return→throw、caller 枚举与 §12 一致）；架构（无退回信号）；过度设计（无——~490 行承载 6 AC）。

### R4.5 独立测试复跑（串行、独立进程、全部 exit 0；日志 `.pnpm-store/.sa4-r4-logs/`）

| # | 命令 | 结果 |
|---|---|---|
| R4-V1 | `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts`（标准 acceptance 命令，**无任何 `--testTimeout` 覆盖** = F1 原暴露面） | **22/22 pass**，Type Errors no errors，39.28s；E1 6499/E2 6195/E3 6082/E4 6071/E5 12891 ms（E1–E4 均 >5s 默认超时——F1 修复持续有效） |
| R4-V2 | 同 env `vitest run apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts` | **6/6 pass**（C1×2、M2、§六(a)、§六(b)、D8/D1 E2E），7.67s；`[SA7-DV]` D8 NDJSON 流活链路复现（`retention-swept` + 恰一次 `diagnostics-closed`） |
| R4-V3 | `pnpm test`（= ci.yml L39 Test 步骤同一命令/同一 include 面） | **259 files / 2854 tests 全绿**，Type Errors no errors，exit 0（186.06s，执行窗 load 4.26/4 核）；两 #155 文件均被收集且绿（22 tests 40931ms / 6 tests 6933ms 摘录在录） |
| R4-V4 | `pnpm typecheck`（= ci.yml L36，14 tsconfig 全链） | **exit 0** |

- 附：`git diff --check` clean（独立复证 REPORT.md 同项声明）；测试后 `ps` 扫描零遗留进程。
- **同码全量绿计数 +1**：12:35（SA7）/ 19:09、19:14（SA3）/ R3（SA4）/ SA7 R4 / **本轮 R4** = 6 绿 vs 13:45 一次红（两失败文件与本票 diff 结构隔离，SA3 终局回归 + R3.3 独立攻击已闭合）——flake 归因链持续加固。

### R4.6 残留项（不阻塞，交总控）

1. **CI run-log 摘录**（唯一未闭合证据面）：分支 `mabf/issue-155` 未推送、无 PR、无 run——push/PR 归总控；发布后按 SA7 报告「重点 1」命令摘录即可闭合。
2. **REPORT.md 随 commit 携带**（R4.1 note）：既有惯例，内容已独立核对诚实——总控 commit 时知悉即可。
3. **design §10 ALLOW 追加备案建议**（SA7 测试文件 + 3 版本 bump 行 + REPORT.md 惯例行）随 PR 描述引用，供归档。

---

## 动态审核重点（交 SA7）

> **R3 注**：以下 6 条已由 SA7 报告逐条闭合（5 条以新增破坏性/补充性测试实测、1 条环境阻塞以本地 CI 等价命令补齐）；SA4 R3.2 已复审其新增测试质量。**R4 注**：本轮 V2/V3 复跑中 6 条的 `[SA7-DV]` 打点活链路再次复现。保留原文供溯源。

1. **CI 全量 `pnpm test` 绿灯证据**（F1 修复后）：从 `gh run view --log` 摘录本 spec 文件被收集 + 22 用例通过的行（§1.4 联动要求）。
2. **C1 并发 create 交错**（SA2 R1 登记的绿灯期增补建议）：`Promise.all([create A, create B])` + B 的 createDoc 注入失败 → A 流无 B 记录、A replay complete/issues=[]、`unattributed` 计数事件出现。
3. **M2 篡改流形直探**：手工构造 `[attempt(seq1), genesis(seq2), …]` 日志文件 → `replayNamespaceDiagnosticLog` 报 `genesis-misplaced`+`genesis-missing`、failed、无 snapshot。
4. **§二-D1 legacy fallback 动线**：emitter-only `diagnosticLog`（无 runtimeEmitterFor）经 #150 测试已覆盖静态面；如 SA7 做进程级验证，确认生产 NDJSON 无异常 `diagnostic-log-emission-dropped` 泛滥。
5. **D8 健康事件面**：现有测试未断言 stdout 出现 `diagnostic-log`/`diagnostic-log-emission-dropped`/`diagnostics-closed` 事件（E4 只断言业务连续性）——建议动态摘录一次启用态停机的 NDJSON 事件流佐证健康面上线。
6. **§六 (a)/(b) 两 note 的运行时复核**（issues 镜像双份、fatal-committed-unknown 推进语义）。

---

## 结论

| 维度 | 判定 |
|---|---|
| 1. 设计一致性 | ✅（2 处有据偏离已记录，建议 SA1 备案 D1） |
| 2. 读写路径一致性 | ✅ |
| 3. 静默失败 | ✅ |
| 4. 降级方案 | ✅ |
| 5. 极端攻击 | ✅（2 note 已由 SA7 实测闭合，R4 复现） |
| 6. 错误处理 | ✅ |
| 7. 架构评估 | ✅ |
| 8. 过度设计 | ✅ |
| **绿灯真实性** | ✅（R2：E1–E4 timeout-only 修复 + 默认超时面 22/22 绿；R3：独立全量 259/2854 exit 0；**R4：22/22 + 6/6 + 259/2854 + typecheck 四项独立复现全绿**） |
| **终局回归归因**（R3 维度） | ✅ SA3 flake 归因独立攻击未被推翻（R3.3 五支柱全过；R4 同码全量绿计数增至 6 次） |
| **Scope/门禁机械复检**（R4 维度） | ✅ ALLOW 14/14、BLACKLIST/DENY 零命中、§1.7 零伪测试、零伪造绿灯手段 |

**Verdict: pass（R4 恢复轮最终，2026-09-03 23:11）**——本轮为恢复轮独立复审，不接力 R1–R3 文字结论：(1) 生产 diff 自 R2 起字节冻结（find/mtime 独立复核），16 修改 + 2 新 src 逐文件重读与 SA1 R1 §5.1–§5.8 逐条一致，D1/D2 两处有据偏离经独立复核成立（本轮亲自验证 #150 冻结测试绑定形状与 emit 13 调用点枚举）；(2) 全部机械门禁独立重跑通过（Scope/BLACKLIST/DENY/§1.3/§1.4/§1.7）；(3) 四项测试独立串行复跑全绿（红灯契约 22/22 默认超时面——F1 持续有效；SA7 补充 6/6 含 `[SA7-DV]` 活链路；全仓 259 files/2854 tests；typecheck 0 errors，全部 exit 0）；(4) 新登记 1 项 Controller 工件 note（REPORT.md，惯例承载、内容核对诚实，不阻塞）。残留项 3 条（R4.6）移交总控，其中 CI run-log 摘录为发布后闭合项。**建议总控进入发布（push/PR）阶段。**

*R1（2026-09-02 全量，F1 reject）→ R2（2026-09-03，F1 修复复验 pass）→ R3（2026-09-03 恢复轮，pass 维持）→ R4（2026-09-03 恢复轮独立复审，**pass 最终**）。SA4 完——控制权交回总控。*
