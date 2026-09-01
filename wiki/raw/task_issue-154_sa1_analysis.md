# SA1 分析报告 — issue #154：Retain, lease, and delete namespace diagnostic logs

- Worktree：`/home/wangjian/nomicore-fix-issue-154`（branch `fix/issue-154-on-docs-namespace-diagnostic-change-log`，HEAD `722bddf`）
- 父设计：PR #142（ADR-0011/0012，commit `6de2f1d`）
- 依赖：#153（reopen/roll/repair，PR #166，commit `eaf0484`）
- 本报告为分析产物，不含实现；核心规范原文 = `docs/adr/0012-vfsl-validated-jsonl-and-framed-sidecar-change-log.md` §「Retention 与删除」（L280–299）+ §「验收门槛」9/15 两条。

---

## 1. 依赖结论：#153 已满足，#154 无阻塞

- **#153 = PR #166（`eaf0484`）已合入 HEAD**（`git merge-base --is-ancestor eaf0484 HEAD` 通过）。其交付物正是 #154 的前置件：
  - segment group 滚动状态机（JSONL/BIN 成对滚动、`beforeCommit()` 三 target 判定、`nextSegmentName`、99999999 溢出 = exhausted）——「closed segment group」概念的物理基础已就位；
  - 构造期 reopen 编排（`resolveResumeCandidate` 三分支 + `analyzeStreamForResume` 健康证明 + `applyRepairs`）——retention「启动时继续完成遗留 `.deleting`」的挂点已在构造路径存在；
  - `paths.segmentFilePaths` 纯增量导出（成对路径派生）。
- 父 PR #142 的 ADR-0012 已把 retention/lease/删除协议**完整成文**（含默认值 30 days / 1 GiB、`null` 关闭、`0` 非无限、五步删除协议、`openReadSession()` 短期 segment lease、按 namespace 彻底删除清单、仅逻辑删除承诺）。#154 是该节的**首次实现**，不需要也不应该改 ADR。
- 全仓 `grep -rn "retention\|lease\|openReadSession\|maxAge\|maxBytes"`（本包内）：**零命中**——纯绿地，无半成品冲突面。

## 2. 现状盘点（代码事实）

包：`packages/namespace-diagnostic-log@0.1.4`。与 #154 直接相关的现状：

| 现状 | 事实 | 位置 |
|---|---|---|
| 配置面 | `FileDiagnosticLogConfig` 无任何 retention/lease 字段 | `src/adapters/file.ts:67-104` |
| 适配器对象面 | `FileDiagnosticLog` 仅 `emitter/streamId/rootDir/namespaceId`，无 retention/lease/delete 方法 | `file.ts:107-113` |
| 滚动 | 三 target（64 MiB JSONL / 256 MiB BIN / 100k records）达标即滚入下一段；**无关闭标记文件**——「group 已关闭」只能由「存在更大编号 segment」推断（reader §9.3 即此判定） | `file.ts:604-622`；`reader.ts:623-641,1023-1034` |
| 删除协议 | `.deleting` rename / bin unlink / orphan 清理：**全部未实现**（ADR-0012 L291-295 是待建规格） | — |
| 读面 | `readStreamStrict` 纯同步函数、绝不抛；连续性状态机**锚定 `expectedSequence = 1n`** | `reader.ts:339,461` |
| reopen 健康证明 | `analyzeStreamForResume` 与 reader 共享同一状态机；`actual > expected` → `corrupt` → **rotate `stream-corrupt`** | `reader.ts:1012-1013,1037` |
| 健康事件 | 词表冻结、只增不改；低基数白名单纪律明确（**streamId/segment/offset 刻意不进事件**） | `src/health.ts:23-95`；`AGENTS.md` §Verification |
| 消费方 | File adapter **尚未接线到任何 Host/Registry 生命周期**（仅本包测试使用；namespace-runtime 只依赖 emitter seam） | 全仓 grep |
| 环境绑定 | `node:fs` 仅限 `adapters/file.ts` + `reader.ts`；`node:path` 限三文件；其余纯 TS | `AGENTS.md` §Boundaries |
| schema | `schema.ts` 指纹被 `schema-freeze.test.ts` 钉死；retention 属物理层，**不需要动 schema** | `AGENTS.md` §Contract |
| 测试基建 | `test/helpers/file.ts` 已有 mkdtemp 根目录、fake stream 写入、事件收集器、`eventsOfTypeRaw`（类型面未加成员时按 type 窄化）——SA6 红灯可直接复用 | `test/helpers/file.ts` |

Registry 的 caller lease（`namespace-registry/src/lease.ts`，ADR-0009）是**另一概念**（Runtime 生命周期租约），与 #154 的 reader segment lease 同名不同物——设计文档必须显式消歧，避免 SA2/SA6 混用。

## 3. 受影响文件与接口

| 文件 | 改动性质 | 内容 |
|---|---|---|
| `src/adapters/file.ts` | 修改（主要落点） | `FileDiagnosticLogConfig` 增 retention/lease 配置（`number \| null \| undefined` 三态）；构造期「先完成遗留 `.deleting` → 再健康证明」的次序插入；retention 执行点（构造期/滚段后/显式调用）；可能增 `FileDiagnosticLog` 方法或保持 standalone 函数 |
| `src/reader.ts` | 修改（P0 风险落点） | `readStreamStrict` 与 `analyzeStreamForResume` 的 trim 感知（首存活 record sequence > 1 ⟹ 报告裁剪而非 gap/corrupt）与 `.deleting` 标记感知（bin-only 段不触发 roll-target-violation） |
| `src/health.ts` | 修改（只增） | retention/删除/租约过期类新事件成员；字段守低基数白名单（计数/封闭枚举，禁 segment/streamId） |
| `src/paths.ts` | 修改（纯增量） | `.deleting` 标记路径派生（建议 `<segment>.deleting` 同目录，ADR「将 `.jsonl` 原子 rename 为 `.deleting`」的自然读法——SA2 需钉死命名） |
| 新模块（建议） | 新建 | `retention` 纯规划层（frontier/eligibility 计算，零 IO）与/或 `lease` 纯租约注册表（零 IO）——若含 IO 则违反 AGENTS 绑定面，须落在 file.ts 内或同步扩 AGENTS 声明 |
| `src/index.ts` | 修改（只增） | 新公共导出（retention 执行、lease/read-session、namespace 删除）；既有导出一字不动（#152 先例） |
| `README.md` / `AGENTS.md` | 修改 | `0`/`null` 语义文档化、「不承诺 secure erase」声明、绑定面若扩展须三行声明 |
| `package.json` | 修改 | `0.1.4 → 0.1.5`（仓库逐变更 patch bump 惯例，#149 REPORT 先例） |
| 测试（SA6 owned） | 新建 | retention age/bytes、lease、中断矩阵、orphan、trim 报告、namespace 删除（建议 3-4 个新测试文件） |

**明确不动**：`src/schema.ts`（指纹冻结）、`docs/adr/**`（ADR 冻结源）、`src/adapters/memory.ts`（ADR-0012 的 retention 是 File adapter 契约；内存 adapter 已有 capacity 上界）、namespace-runtime/registry 接线（归 #149–#151/#155 及后续 Host 票——ADR-0012「Host 执行数据删除请求时必须同时调用日志删除能力」是 Host 侧义务，本票只交付被调能力）。

## 4. 关键设计决策点（SA2 必须裁决）

1. **Trim 判定法**（无 trim 标记文件可写——ADR 明言「manifest 不承担 retention 状态；earliest retained sequence 通过扫描重建」）：推荐「首存活 segment 的首条完整 record sequence > 1 ⟺ 前缀被 retention 裁剪」。依据：writer 协议**从不跳段**（段按序创建、成对滚动），前缀缺失不可能由 writer 产生；中间真缺口仍按 `sequence-gap` 判 corrupt——trim 感知不得弱化既有 gap 检测。
2. **closed 判定**：active stream（locator 指向）内的非最大段 = closed；**非 active 的旧 generation 全部 group 均 closed**（含其最大段——writer 永不回写）。standalone 执行（无 writer 实例）时 active stream 由 #153 三分支 locator 解析确定；locator-ambiguous 时保守策略需钉死（建议：跳过所有候选的最大段或中止该 namespace 的本趟 pass + 事件）。
3. **age 数据源**：推荐 group 内**最后一条完整 JSONL 行的 `observedAt`**（producer 注入钟、拷贝安全）；拒绝 fs mtime（复制/恢复即漂移）。无法定龄（空 JSONL/末行不可解析）→ 保守不删 + 事件。边界建议 `groupNewest ≤ now − maxAge` 即删（含等号，测试钉死）。
4. **bytes 口径**：namespace 内全部 stream 的 JSONL+BIN 实际字节（含 `.deleting` 未完成物——建议计入直到删除完成）；删除序 = 最旧 generation 优先、段号升序；仅剩 open/leased group 而仍超预算 → **停 + 事件**（绝不动 open group，非强制达标需文档化）。
5. **`0`/`null` 语义**：`0` = 每趟把**全部** closed unleased group 判为 eligible（`maxAge=0`：任何龄 ≥0 恒真；`maxBytes=0`：预算恒亏）——绝不解读为无限；`null` = 该限制关闭；两者皆 null = retention 整体关闭。非法值（负/NaN/∞/非整数）→ loud 配置门（#153 `isRollTargetValue` + `invalid-roll-targets` 同款先例），禁止静默钳制。
6. **lease 形状**：单进程独占根目录（ADR-0012 §Writer）⇒ 租约可为进程内注册表；`openReadSession()` 覆盖 open 时枚举的 segment 集合；TTL 用注入 clock；`renew()` 显式续租（ADR「长期 reader 必须有最大 lease 时长或显式续租」）；过期 = 视同无租约（eligibility 即时恢复）+ 惰性 GC。**一旦某 group 已 rename 为 `.deleting`，续租不能中止删除**（marker 即提交点）。
7. **删除 API 形状**：standalone 函数（离线可用）+ 可选实例方法；**绝不抛**（结构化 result，`readStreamStrict` 先例）；`isSafeNamespaceId` 不过 → 零 fs 触达；删除 `current.json` + `current.json.tmp` 残留 + `streams/**`（manifest/JSONL/BIN/`.deleting`）+ 空目录；前置条件「该 namespace 无存活 writer 实例」须文档化（否则 writer 会重建文件）。
8. **执行点与 write-slot 纪律**：构造期（resume 编排**之前**完成 `.deleting` 收尾——否则 mid-deletion 态会污染健康证明）+ 滚段后（group 刚关闭，随 emit 路径，#149 接线下在 slot 外，但会加长 post-slot 同步 IO——需在设计中显式评估）+ 显式 Host 调用。ADR-0012 amendment 的 slot 纪律对本票同样强制。
9. **空 generation 清理**：旧 generation 全部 group 删除后是否移除 manifest.json + stream 目录（建议：是——无数据的 manifest 无解释价值；但需与「工具可展示历史 generation 元数据」权衡后钉死）。

## 5. 风险清单（按严重度）

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R1 | **reopen rotate 风暴**：`analyzeStreamForResume` 对 `actual > expected` 一律 corrupt→rotate（`reader.ts:1012-1013`）。retention 裁前缀后，**每次重启都会 rotate 建 new generation**（genesis 重写、历史碎片化）——直接违背 #153 目的 | **P0** | resume 状态机 trim 感知：首存活 record 为锚点续写；测试钉死「裁剪后 reopen 不 rotate」 |
| R2 | **strict reader 误报 corrupt**：同款状态机（`reader.ts:461` 锚 1n）+ §9.3 roll-target 检查会把 bin-only 中间段判 `manifest-roll-target-violation`——裁剪后的流**不可读** | **P0** | `readStreamStrict` 增 trim 报告（建议独立字段 + `earliestRetainedSequence`，**不进 issue 词表**以免污染 status 聚合）+ `.deleting` 段豁免 |
| R3 | **mid-deletion 可见窗口**：jsonl 已 rename、bin 未删期间，任何 reader 都见到 bin-only 段（现按「BIN-first 崩溃窗口」零 issue 处理但过不了 roll-target 检查） | P1 | `.deleting` 标记感知：该段从 roll-target/连续性检查剔除；构造期先收尾删除再健康证明（次序即防线） |
| R4 | **lease 与单进程约束**：`readStreamStrict` 是无实例纯函数，离线副本读无法被租约保护；租约注册表只在进程内有效 | P1 | lease API 挂 adapter 实例/进程级注册表；文档明示离线静态副本无保护（§4.3 既有契约本就「面向静态 stream」） |
| R5 | **post-roll retention 加长 emit 路径同步 IO**：虽在 slot 外（合规），但拖慢业务请求尾延迟 | P2 | 仅滚段时做廉价的 frontier 检查（新关 group 的 age/bytes），全量 pass 留给构造期/显式调用；设计需量化 |
| R6 | **事件白名单违例**：retention 事件想带 segment 名（调试方便）——违反 §8.2 低基数纪律（#153 明文「streamId/segment/offset 刻意不进事件」） | P2 | 事件只带计数/封闭枚举 reason；身份经实例上下文可得 |
| R7 | **环境绑定面违规**：新 retention/lease 模块若碰 `node:fs` 即违反 AGENTS 三处声明 | P2 | IO 收口 file.ts/reader.ts；纯逻辑独立模块；或同步扩 AGENTS 声明 |
| R8 | **orphan BIN 误删**：BIN-first 崩溃窗口的 open group bin（零 jsonl）是合法活态；闭段 bin-only 无标记才可清 | P2 | orphan 清理限定 closed group；open group 永不触碰（与 retention 同一保护面） |
| R9 | **namespace 删除 vs 活 writer**：删除后 writer 实例继续 append 会重建文件树，删除承诺失效 | P1 | API 契约写明前置条件（单进程所有权模型内由 Host 保证）；README 显式声明 |
| R10 | **secure erase 过度承诺**：AC 明确「不暗示 SSD/备份物理抹除」——API 命名/文档不得用 purge/erase 语义 | P2 | 命名用 `deleteNamespaceLog`（logical deletion）；README 承诺边界段落 |

## 6. 可测试需求（映射 AC，SA6 红灯锚点建议）

**AC1 — age/bytes 配置**
- T1 age frontier：仅 `groupNewest ≤ now−maxAge` 的 closed group 被删（含等号边界钉死）；新于 frontier 的不动。
- T2 bytes frontier：最旧优先删至 ≤ 预算；仅剩 open/leased group 而仍超 → 停 + 事件 + open group 字节不变。
- T3 `null`：各自独立关闭；双 null = 整体 no-op（磁盘字节零变化）。
- T4 `0`：全部 closed unleased group 立即 eligible（新鲜数据也删）——**非无限**反向钉死；`0` 绝不触 open group。
- T5 非法值（负/NaN/∞/非整数）：loud 门（disabled/忽略 + 事件），无静默钳制。

**AC2 — closed/unleased + 可续传协议**
- T6 open group（active stream 最大段）在任何压力下（maxBytes=0、maxAge=0）不被删。
- T7 协议次序：`.jsonl` → rename `.deleting`（提交标记）→ unlink `.bin` → unlink `.deleting`；bin 缺失段跳步 2 照常完成。
- T8 中断矩阵（AC「every interrupted deletion step」）：步 1 后 / 步 2 后 / 步 3 前崩溃 × {bin 存在, bin 缺失}——重启构造期收尾，终态 = 该组两文件皆无。
- T9 orphan：closed group 的无标记 bin-only 段被清；open group 的 bin-only（BIN-first 窗口）不动。

**AC3 — 租约**
- T10 active lease 的 group 被跳过；release 后下一趟可删。
- T11 过期租约（注入 clock 推过 TTL）不阻止删除（「expired leases cannot block retention forever」锚点）。
- T12 `renew()` 续期后继续受保护（可多次续）。
- T13 已 rename `.deleting` 后的续租不中止本组删除（marker 即提交点）。

**AC4 — namespace 逻辑删除**
- T14 删除覆盖 current.json、`current.json.tmp` 残留、全部 streams（manifest/JSONL/BIN/`.deleting`）、空目录；返回真实结构化报告；绝不抛。
- T15 非法 namespaceId（含 `..`/控制符/路径分隔）→ 零 fs 触达。
- T16 删除后磁盘上该 namespace 路径树不存在；其他 namespace 不受连带。

**AC5 — 裁剪历史报告与 reader/reopen 兼容（R1/R2 的验收化）**
- T17 裁剪后 `readStreamStrict`：status `ok` + `historyTrimmed` 报告 + `earliestRetainedSequence`；**非 corrupt**；中段真缺口仍 `corrupt`（反向锚点）。
- T18 裁剪后 reopen：resume 不 rotate（无 `stream-generation-rotated`），续写 sequence 接 last retained。
- T19 retention 结果报告 earliest retained sequence / 删除组数 / 回收字节（「retained-history reporting」）。
- T20 mid-deletion 态下 reader 对 `.deleting` 段不报 roll-target-violation（R3 锚点）。

**工程锚**：`package.json` 0.1.4→0.1.5；README/AGENTS 同步（`0`/`null` 语义 + 逻辑删除边界）；`schema-freeze` 指纹不变（本票零 schema 改动）；全仓 `vitest run --typecheck` 绿。

## 7. 验证证据（本报告依据的命令与结果）

- 依赖在位：`git merge-base --is-ancestor eaf0484 HEAD` → exit 0（PR #166/#153 为 HEAD 祖先）。
- 绿地确认：`grep -n "retention\|lease\|delete\|openReadSession\|maxAge\|maxBytes" README.md AGENTS.md src/*.ts src/adapters/*.ts` → 仅 1 命中（schema.ts 注释「retention 不在本 schema」）。
- 状态机锚点：`reader.ts:461`（`expectedSequence = 1n`）、`reader.ts:1012-1013`（gap→corrupt）、`reader.ts:623-641`（非最大段 roll-target 核查）。
- 滚动/关闭语义：`file.ts:604-622`（beforeCommit 三 target；无关闭标记文件）。
- 构造 reopen 编排点：`file.ts:937-1018`（locator 三分支 → 健康证明 → 修复 → resume）。
- 规格原文：`docs/adr/0012-...md:280-299`（Retention 与删除五步协议 + 删除清单 + 逻辑删除边界）。
- 消费面：全仓 grep `createFileDiagnosticLog` → 仅本包测试；runtime 只 import emitter/类型。

## 8. 给 SA2 的文件范围建议（advisory，最终以 SA2 design 的 ALLOW/DENY LIST 为准）

**建议 ALLOW**：`packages/namespace-diagnostic-log/src/adapters/file.ts`、`src/reader.ts`、`src/health.ts`、`src/paths.ts`、`src/index.ts`、（如裁决独立模块）新 `src/retention.ts`/`src/lease.ts`、`README.md`、`AGENTS.md`、`package.json`（+pnpm-lock 如有连锁）、SA6 owned 新测试文件（如 `test/file-adapter-retention.test.ts`、`test/read-session-lease.test.ts`、`test/namespace-log-delete.test.ts`、`test/strict-reader-retention-trim.test.ts`）与 `test/helpers/file.ts`（仅 fixture 扩展）。

**建议 DENY**：`src/schema.ts`（指纹冻结）、`src/adapters/memory.ts`（retention 非 memory 契约）、`packages/namespace-runtime/**`、`packages/namespace-registry/**`（接线归后续票）、`docs/adr/**`（冻结源）、`wiki/raw/**`（除本分析已存在文件）。
