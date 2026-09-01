# SA4 静态验尸报告 R2（固定范围复验）— Issue #154：Retain, lease, and delete namespace diagnostic logs

**Date**: 2026-08-31
**Reviewer**: SA4（红队 R2；只读审查，零代码/测试改动——结束时 `git status` 与开始时逐字一致）
**Review 对象**: `722bddf..385a376`（实现 `c0f6cbc` 已于 R1 全量审毕；本轮修复提交 `385a376` = `src/adapters/file.ts` + `README.md`，2 文件 +10/−3，零新增文件进 diff 面）
**复验范围**: 严格限定 R1 §2.4 —— (a) P2 字节遍历块（`file.ts:1235-1293`）及两处注释；(b) SA6 新增 T-A9（worktree 未提交增量，`test/file-adapter-retention.test.ts` +33 行）；(c) 包套件 427 测试 + tsc 验证可信度。范围外模块（reader/read-session/health/index/删除协议）不再复验。

---

## Verdict: **PASS** — R1 §2 唯一 P1 阻断项（P2 字节遍历年龄门）已修复并被真实钉死，**R1 关闭**

无新增可见或未解决的范围内阻断项。两条非阻断备注见 §4（出版前置条件 + SA6 报告时序勘误），均不影响本 verdict。

---

## 0. 独立复核证据（本轮实际执行的命令与结果）

| # | 命令 | 结果 |
|---|---|---|
| E1 | `npx vitest run packages/namespace-diagnostic-log/`（HEAD=385a376 + T-A9 工作区增量） | **27 files / 427 tests 全绿，Type Errors no errors**（427 = 426 + T-A9，与 SA6 R2 §3.2 声明一致；typecheck 1.99s 实跑） |
| E2 | `npx tsc -p packages/namespace-diagnostic-log/tsconfig.json` | **exit 0**（与 SA6 R2 §3.3 一致） |
| E3 | **反事实红灯验证**：`git worktree add --detach /tmp/sa4-r2-c0f6 c0f6cbc` + 拷入 T-A9 + 复用主仓依赖 → `npx vitest run …file-adapter-retention.test.ts -t "T-A9"` | **T-A9 红**：`AssertionError: expected +0 to be 1` 于 `deletedGroups` 断言（测试文件 :315）——精确复现 R1 §2 缺陷形态（年龄门使字节驱动删除数为 0）。临时 worktree 已删除，项目 worktree 零触碰 |
| E4 | `grep -n groupAgeExpired src/adapters/file.ts` | 仅剩 :1038（定义）与 :1221（**P1** 年龄遍历内）——P2 块内零残留年龄门 |
| E5 | `git show 385a376 --name-only` | 仅 `src/adapters/file.ts` + `README.md`——无 scope creep、无 BLACKLIST 命中；范围 722bddf..385a376 仍为 15 文件（修复未新增文件） |
| E6 | T-A9 diff 逐行审 | 纯增量（1 个 `it` 块，+33 行），既有 426 测试与 helpers 零改动（`git status` 仅该测试文件 ` M`） |

E3 是本轮关键证据：**T-A9 在含缺陷的 `c0f6cbc` 上真实红灯、在修复后的 `385a376` 上真实绿灯**——它是真回归钉，不是恒绿陪跑。

---

## 1. 范围 (a)：P2 字节遍历修复 —— ✅ PASS

### 1.1 修复正确性（逐点对照 R1 §2.3 修正令）

| R1 §2.3 要求 | 实况（HEAD 385a376） | 判定 |
|---|---|---|
| 删除 `file.ts:1274` 年龄门整行 | 已删；原位替换为裁决注释（:1276-1277「SA4 R1：无年龄新鲜度门（P1 专属）…」） | ✅ |
| P2 止步原因收敛为 {开组、租约、失败} | 代码三处 `break` 分支逐一核对：开组 :1268-1271、租约 :1272-1275、IO 失败 :1285-1288；`!progressed` 全局停 :1291 | ✅ |
| 修正 :1235-1236 头注释（移除「未过期」） | :1235-1238 现为「无可删候选（全被**开组/租约/失败**止步）→ 停」+ 两限制独立生效的裁决陈述 | ✅ |
| 修正 :1288 尾注释 | :1291 现为「开组/租约/失败全部止步」——「未过期」已除 | ✅ |
| README 无需改动 | SA3 追加 4 行「年龄与字节是两个独立限制（SA4 R1 裁决）」条目——纯增量文档化，消除 R1 指出的实现-文档自相矛盾隐患 | ✅（超出但不越界） |

### 1.2 「字节上限独立于非空非零年龄」验证（推理 + E3 双证）

P2 内层组循环现为四门序列：预算满足（:1267）→ 开组（:1268）→ 租约（:1272）→ 删除。**无任何以 `maxAgeMs` 为输入的判定**（E4）。故 `maxAgeMs ≠ null`（含 30d 缺省）时字节预算独立可执行——这正是 R1 §2.2-3 指出的「默认配置下字节上限失效」缺陷的反面。E3 反事实运行证明：同一测试数据 + 同一 `maxAgeMs=30d`，`c0f6cbc`（有门）删除数 0、`385a376`（无门）删除数 1。

### 1.3 前缀/开组/租约安全残留检查（R1 复验令）

- **开组保护（INV-1）**：`openSegmentOf` 判定（:1195-1196）与开组 `break`（:1268-1271）先于一切删除逻辑，未被修复触碰；T-A9 磁盘断言（段 3 开组原样）+ 既有 T-B4/T-B5/T-E7 三锚全部仍绿（E1）。✅
- **租约保护**：`segmentLeased`（:1272-1275）原样；read-session 租约套件全绿（E1）。✅
- **前缀纪律（INV-2）**：每流首个不可删组即 `break`（开组/租约/失败三 break 原样）；`before === 0 → continue`（:1279）为 P1 同款既有行为（无文件枚举残留跳过，不制造洞），R1 已接受且未变。✅
- **终止性**：`while (total > maxBytes)` 每轮要么删 ≥1 组（`progressed`）要么 `!progressed` 退出；`total` 于 P2 入口对 P1 后状态全新重算（:1240-1253 重枚举），无陈旧账本。✅
- **INV-5（绝不 throw）**：P2 全体在 `sweepNow` try/catch 内，IO 失败走 `failedSteps++` + break——未变。✅

---

## 2. 范围 (b)：T-A9 测试行为覆盖面 —— ✅ PASS（真红真绿钉）

### 2.1 对照 R1 §2.3-2 的验收要件

| R1 要求的测试形态 | T-A9 实况 | 判定 |
|---|---|---|
| `maxAgeMs` 非空非零 | `2_592_000_000`（30d 名义缺省值） | ✅ |
| 数据龄 0（新鲜） | 全部 record `observedAt = T0`，sweep 于 `T0 + 1000`（龄 1000ms ≪ 30d）；新鲜度经**记录时间戳**判定（`groupAgeExpired` 解析 jsonl `observedAt`，:1038-1063）——确定性、不依赖墙钟/mtime | ✅ |
| `maxBytesPerNamespace < total` | `total − 1`（超额 ≥1 字节，`g1 ≥ 1` 恒成立） | ✅ |
| 最旧闭组删至 ≤ 预算 | `deletedGroups === 1`、`reclaimedBytes === g1`（恰段 1；`total − g1 ≤ total − 1` ⇒ 不多删）+ `retainedBytes === g2 + g3 ≤ total − 1` | ✅ |
| 开组原样 | 磁盘断言恰为 `[00000002.bin/jsonl, 00000003.bin/jsonl]` | ✅ |
| 下限/保留历史语义 | `earliestRetained === [{streamId, sequence: '2'}]`（扫描重建）、`historyTrimmedStreams` 含该流（反向锚） | ✅ |
| **新鲜度自证**（超出要求的加强） | 先以缺省 1GiB 扫同一批数据：`deletedGroups === 0` + 6 文件原样——证明「非空非零年龄本身对新数据零删除」（P1 解除武装），随后同数据仅收紧字节预算即触发删除——两扫描对照把「字节独立于年龄」钉成行为不变式 | ✅ |

### 2.2 红灯真实性（E3，非静态推断）

- **c0f6cbc（缺陷在）**：`deletedGroups` 期望 1 实收 0 → 断言红（第一断言即失败）。若有人恢复 P2 年龄门（双重执法），T-A9 立即红——守护值成立。
- **385a376（修复后）**：全套件 427 绿中通过（retention 文件 16/16）。
- 测试方法学合规（skill §1.7）：全部断言面向运行时产物（磁盘文件名、sweep 报告字段、字节计数）——零源码文本断言。

### 2.3 无削弱确认

E6：diff 纯增量；helpers 与既有 45+381 测试逐字未动；426 → 427 单调增。

---

## 3. 范围 (c)：验证可信度 —— ✅ PASS（声明全部复现属实）

| 声明（SA6 R2 / SA3 impl_r2） | 独立复现 | 判定 |
|---|---|---|
| 全包 27 files / 427 tests 绿 + 0 type errors | E1 逐字复现 | ✅ 属实 |
| `tsc -p packages/namespace-diagnostic-log/tsconfig.json` exit 0 | E2 复现 | ✅ 属实 |
| T-A9 聚焦运行 1 passed | E1（文件 16/16）+ E3（`-t "T-A9"` 恰选 1 条） | ✅ 属实 |
| 既有 426 零削弱 | E6 | ✅ 属实 |

---

## 4. 非阻断备注（不构成 REJECT；交总控/相应 SA 处置）

1. **【出版前置条件】T-A9 当前是 worktree 未提交增量**（` M packages/.../test/file-adapter-retention.test.ts`），仅 `385a376`（src+README）已提交。出版阶段（push/PR）**必须把该测试文件一并纳入提交集**，否则分支上将只有 426 测试、R1 盲点钉丢失、CI 声明（427）与 PR 内容不符。非代码缺陷，不在本 verdict 权限内（SA4 不负责 PR/push），但属硬前置。
2. **【SA6 报告勘误】`task_issue-154_sa6_red_r2.md` §2/§3.4 时序陈述有事实错误**：称「T-A9 在 c0f6cbc 上为绿」「修复先于测试落笔（首跑即绿）」。事实：`c0f6cbc` 的 `file.ts:1274` 正是年龄门所在（R1 §2.1 引证行），E3 证明 T-A9 在 c0f6cbc 上**红**；无年龄门的行为随 `385a376` 才落地，SA6 引用的注释（:1235-1238/:1276-1277）属 385a376 而非 c0f6cbc。该错误**反而低估了 T-A9 的守护价值**（它是真红转绿钉，而非 SA6 所称的无红窗口）；其可复核的验证声明（427 绿、tsc 0、聚焦绿）经本轮全部复现属实，故不影响 verdict——建议 SA6 勘误 §2 表末行与 §3.4 措辞，避免误导后继审计。

---

## 5. 动态审核重点（交 SA7；沿用 R1 §8，本范围无新增）

R1 §8-1（默认 30d/1GiB 真机字节边界——T-A9 的真机版）、§8-2~§8-5 不变。本修复未引入新的运行时风险面。

---

## 6. 结论

R1 §2 唯一 P1（P2 字节遍历年龄门致字节上限在默认配置下不可执行）已按 R1 §2.3 逐字修复：年龄门删除、两处注释同步、README 双限制独立语义文档化；开组/租约/前缀/INV-5 安全面原样保留；SA6 T-A9 以「新鲜度自证 + 字节超额」双扫描形态真实钉死该契约，并在缺陷提交上实证红灯。427 测试 + tsc 零错误的验证声明全部独立复现。**Verdict: PASS，R1 关闭**；两条非阻断备注（T-A9 出版前置、SA6 时序勘误）交总控流转。
