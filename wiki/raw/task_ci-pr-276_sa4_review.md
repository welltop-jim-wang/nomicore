# SA4 Red-Team Implementation Review — CI repair：`apps/yjs-server` 根锁 stale 回收双活竞态（PR #276 `test (24, 4)`）

> Phase：implementation-review（iteration 1）。Dispatch：`sa-9b770844-d56b-49b8-aa77-fc742b240cad`（mabf-sa4）。
> 评审对象：SA3 实现（`apps/yjs-server/src/lifecycle.ts` 重构 + 新测试
> `apps/yjs-server/test/root-lock-atomic-publication.test.ts` + 两文档行），对照
> `wiki/raw/task_ci-pr-276_design.md`（SA1 iteration 5）、`wiki/raw/task_ci-pr-276_sa6_contract.md`
> （SA6 验收契约）与 `wiki/raw/task_ci-pr-276_sa2_review.md`（SA2 iteration 4 **pass** 放行）。
> Issue/PR comments REST 读取为 `[]`——无 Owner 追加要求。
> **结论：clear（无阻断 finding；实现保真、并发安全、liveness、兼容性、范围、文档、可执行证据全部
> 独立复核通过；4 条非阻断观察 OBS-1–OBS-4 如实登记）。**
> 环境说明：本 agent 目录下 `skills/exploit-vulnerability/SKILL.md` **不存在**（本 worktree
> `.agents/skills/` 无该技能，主仓与 /home/wangjian 亦无）——按角色指令的红队方法论
> （攻击实现、证据否定、可复现证据）执行；全部变异实验在 `/tmp/sa4-mut/` **副本**上进行，
> 生产代码零触碰（`git status` 复核：本轮结束后 worktree 与 SA3 交付态完全一致 + 本报告）。

## 1. 评审方法与证据总表（全部本轮亲跑，node v24.13.0 / vitest 3.2.7 / `NODE_OPTIONS=--conditions=nomicore-source`）

| # | 验证 | 命令/位置 | 结果 |
|---|---|---|---|
| V1 | typecheck | `tsc -p apps/yjs-server/tsconfig.json` | 干净 |
| V2 | CI canary（DENY，零改动） | `vitest run …root-lock-atomic-reclaim-red.test.ts` | **7/7 绿**（CI 红用例 514ms） |
| V3 | SA6 压力契约（DENY） | 同上 stress 文件 | **3/3 绿** |
| V4 | E1 ≥3 次全文件复跑 | stress 连跑 ×3（1+2） | **3 连绿** |
| V5 | 新契约 publication | `vitest run …root-lock-atomic-publication.test.ts` | **9/9 绿**（T7a 抛于 5002ms；T7c 5622ms 成功；T6 1.2s） |
| V6 | E4 全 app 套件 | `vitest run apps/yjs-server/test` | **30 文件 / 162 测试全绿**（416s） |
| V7 | E2 CI 同形（失败分片） | `node scripts/ci-test-shard.mjs 4 6` → `vitest run <48 files>` | **48 文件 / 453 测试全绿，exit 0**（96s） |
| V8 | P1-P9 协议探针对拍 | 自写 `/tmp/sa4-probe/p.mjs` + 重跑 SA1 `/tmp/sa1-ci-pr-276-rename-probe.mjs` | **逐条一致**（P1 OK/P2 OK+读回完整/P3 ENOTEMPTY/P4 ENOTDIR×2/P5 OK×2/P6 link EEXIST/P7 rmdir 语义） |
| V9 | 变异红灯性（副本） | `/tmp/sa4-mut/driver.mts`（T7a/T7b/T7c 同形场景） | 见 §4 矩阵：base 全绿；M1/M1b/M0 红（S1②′+S3）；M3 红（60s 超时 kill，exit 124）；**M2-real 红（S3）** |
| V10 | SA3 变异自检证据复核 | `/tmp/ci-pr-276-mutation/m1-{publication,stress,canary}.log` | 与 SA3 报告一致（T7a②′ `0.40 ≥ 5000` 红、stress L168 败者 regex 红、canary 绿如预期） |
| V11 | E7 独立竞态 burn | SA6 driver：`sa4burn 60 12 5000 burn` + 并行 `sa4amb1/2 40 12 5000 burn` | **140 轮 × 12 真竞争者，DOUBLE-rounds=0**（独立于 SA3 的 200 轮） |
| V12 | 对抗残留场景 | `/tmp/sa4-probe/adversarial.mts` | 全绿（见 §5 A-F） |
| V13 | 冻结持有者 + 接管风暴 | `/tmp/sa4-probe/frozen-storm.mts` | 全绿（见 §5 G-H） |
| V14 | SA3 偏差 EISDIR 主张复验 | 探针：`rmSync(symlink-to-dir,{force})` → **ERR_FS_EISDIR**；`unlinkSync` → OK 且目标目录存活 | 偏差成立且正确（见 §6.1） |

## 2. 范围与兼容性（ALLOW/DENY 逐条核证）

- `git status`：改动 = `lifecycle.ts` + `AGENTS.md` + `hub-peer-deployment.md`（ALLOW 第 1/3/4 行）+ 新测试文件（ALLOW 第 2 行）+ wiki 证据。**与设计 §11 ALLOW 四行一一对应，零扩界。**
- DENY 零触碰（`git diff HEAD` 对下列路径为空）：canary、`main.ts`、`src/index.ts`、`packages/**`、
  `.github/workflows/ci.yml`、`scripts/ci-test-shard.mjs`、`vitest.config.ts`。fixture 无 diff。
- 压力契约（未跟踪文件）字节保真：L166 `toHaveLength(1)` / L127、L168 败者 regex `/held|unsupported/`
  与 SA6 `task_ci-pr-276_sa6_stress-red.log` 引用的行号逐行对应；文件头注/结构/轮数（6×12+2 burner）与
  SA6 §12 契约一致。
- 导出面零变化：`src/index.ts` L70（`acquireRootLock, createStdoutEventSink, ROOT_LOCK_FILE_NAME,
  STABLE_OP_ERROR_CODES` + 两类型）原样；`STABLE_OP_ERROR_CODES` 十五项原样（claimStuck 未混入）；
  新常量/构造器/perf import 全部模块私有。
- 冻结文案三族逐字保留（`held by the same instance…` / `shared file persistence root is
  unsupported…` / `cannot write .nomicore-lock.json in rootDir (…)`——`git diff` 未触及这些构造器；
  对抗场景 F 实测逐字命中）。
- claimStuck 定稿文案与设计 §8.1 **逐字符一致**（`occupied` 措辞、`{instanceId: <JSON>, pid: <JSON>}`
  与 `heldError` owner 串同款、`5000ms` 由常量内插、`(pid reuse caveat` 无空格锚）；对
  `/held|unsupported/` 不相交（测试⑥ + V9 S1 双重程序化验证）。
- CI 触发性：新测试文件被 shard 磁盘枚举自动收录（实测落 shard 3；stress 落 shard 5；canary 仍在
  shard 4），各分片 48-49 文件与 CI 形状一致。
- 测试质量：新契约无 skip/only/todo/env 开关（canary 的 `it.skipIf(isRoot)` 为**先在**逻辑，零 diff）；
  断言行为级且多锚（恰 1 acquired + 败者 regex + owner/镜像=winner + 无残留）；T7a/T7b/T7c 超时 30s
  兜底；T7a→T7b 共享 root 的 park/re-register 失败路径安全（T7a 早红时 root 仍被 afterEach 清理）。

## 3. 并发安全独立重放（代码级攻击，结论=无协议内反例）

对实现逐路径攻击（`lifecycle.ts` L253-485 全文亲读 + 场景重放）：

1. **成功出口唯一性（I2）**：`published=true` 仅在 `renameSync(staging, canonical)` 成功后置位；
   `break` 仅在 `if (published)` 内；镜像失败 ⇒ rm 自有 canonical + rethrow（#10 唯一 recursive 例外）。
   无第二条成功路径。
2. **发布者/回收者互斥（I0）**：CAS rename 与证据阶梯全部位于 `takeReapClaim===true` 的 try 块内，
   finally 内容校验释放——SA2 #1 的 (c)/(d) 窗口（发布落在复读与摘除之间）结构不可达；每轮迭代
   释放-重取门后的竞速由「CAS 单胜者 + 败者读活 owner ⇒ loud」收口。
3. **claim 原子性（B6 修复）**：挂名 = `linkSync`（探针 P6 复证 EEXIST/内容完整）；死接管 =
   rename-detach 单胜者 + 墓碑内容复核 + ENOENT 复检；无误删活 claim 的协议内路径（接管误触发的
   回复位分支在位，L188-197）。
4. **`''` 证据分派**：目录摘除仅凭非空死 payload 双读；`''` → absent-continue / L1 rmdir /
   stray-nondir rename 摘除 / L2·杂散门内清障——与设计 NEW④ 逐分支对应。
5. **对抗实measured**：V12/V13 场景 A-H（空 claim 旧版遗留自愈、claim 被篡改为目录仍前进、L2+杂散
   子目录+符号链接混合清障、垃圾 owner.json、全名族预置不干扰、真实外部冻结 pid ⇒ claimStuck ≥5s
   不夺门 ⇒ kill 后自动接管、12 路死 claim 接管风暴恰 1 acquired/11 loud/零 claim 族残留）全部通过。
6. **竞态 burn**：V11 140 轮零双活（含并行双流交叉负载形态——SA6 复现率最高的 `amb` 形态）。

残余风险面与设计登记一致（协议外）：EIO 读坍缩为 `''`（与旧代码 parity，B5 设计承押）、混版本 R7、
篡改、Windows R1——均无新增暴露。

## 4. liveness（D6）与变异红灯性矩阵（副本实验，V9）

| 实现（副本） | S1=T7a 同形 | S3=T7c 同形 | 判定 |
|---|---|---|---|
| **base（生产副本）** | 8/8 全过（throw@5000ms+，claim 字节不变、无 canonical、无 staging 残留、文案不相交；S2=T7b 恢复过） | 成功（更替重置） | 合规实现不被排斥 ✓ |
| M1（第二次拒绝即抛） | ②′ 红（0.6ms） | 红（claimStuck 误抛） | 变异被捕获 ✓ |
| M1b（首拒即抛） | ②′ 红（0.5ms） | 红 | ✓ |
| M0（LIMIT=0） | ②′ 红（0.5ms） | 红 | ✓ |
| M3（永不抛） | 60s 超时 kill（exit 124） | 绿（如 SA2 §7 模拟预期，由 S1 超时覆盖） | ✓ |
| **M2-real（更替不重置基线）** | 过 | **红（claimStuck 误抛）** | ✓ |
| m2-naive（仅禁 `claimWaitReset`） | 过 | **绿** | 见 OBS-2（协议内惰性，非守卫缺口） |

SA2 iteration-4 §7 模拟表的五类变异在**真实实现副本**上全部复现为「各有至少一处确定性红灯」；
SA3 的 M1 自检日志（V10）与之一致。**设计 §12 变异自检义务的净级敏感性主张成立。**

## 5. D6 行为实测（真实进程）

- T7a（生产）：throw 于 **5002ms**（②′ ≥5000 ✓ / ② <20000 ✓）；claim 字节不变（不夺门）✓；
  canonical 未建 ✓；无 staging 残留 ✓（外层 finally 生效）。
- G 场景（V13）：外部**真实**活 pid 冻结持有者 ⇒ claimStuck（≥5s、门不动）；kill 后下一次获取
  **自动接管**成功——D6 恢复语义（自动+人工 T7b）双向实测。
- T7c（生产）：5622ms 成功（两次更替、单段 <5000、合计 >5000）。
- 停止条件审计：阶梯每个 `continue` 均为复检回环或条件原语进展；活 owner ⇒ held loud；活 claim ⇒
  有界预算 loud；EACCES/EPERM ⇒ loudUnwritable（#11 契约在全部 catch 中逐条核对）；
  「无出口空转」路径未发现（与设计 §9 终止性论证一致）。

## 6. 实现偏差裁决（SA3 自报 2 项）

1. **stray-nondir 墓碑删除 `unlinkSync` 替代 `rmSync(tomb,{force})`**：探针 V14 证实 Node 24
   `rmSync(force)` 对 symlink-to-dir 抛 `ERR_FS_EISDIR`（SA3 主张属实）；`unlinkSync` 删链接本体、
   目标目录存活——语义即设计「摘除非目录名后删除链接/文件本体」，errno 契约（ENOENT/ENOTEMPTY→continue、
   EACCES/EPERM→loud、其余 rethrow）由共享 catch 覆盖。**裁决：正确偏差，采纳。**
2. **T7c 分段 ≈2800ms×2**：SA2 O-13(b) 建议的加宽（δ 预算 ≈600ms）；helper nonce 经 argv、字节级轮询
   确认（O-13(a) 25ms 间隔）、同步 acquire 前确认 nonce A 在场（防退化）——O-10 原子换名（写 staging +
   renameSync）无空窗。**裁决：合规。** O-13(c)（δ>150ms 显式 fail）为可选项，未实施不构成缺口。

## 7. 非阻断观察（OBS，无需回流即可合入；登记供后续裁量）

- **OBS-1（文档措辞，MINOR）**：`docs/integration/hub-peer-deployment.md` 的名族清理口径括号清单
  （「其余 transient 名族（…五项…）确认无进程使用该 rootDir 后可手工删除」）**未显式包含
  `.nomicore-lock.acquire-<uuid>`**——设计 §11 ALLOW 第 3 行的名族清单含 `.nomicore-lock.acquire-*`。
  该名称已在前句机制描述中出现，「其余」在上下文中可读为涵盖，但运维口径的显式性弱于设计要求。
  建议后续文档顺手项补一词；不影响行为与验收。
- **OBS-2（健壮性注记）**：禁用 `claimWaitReset`（m2-naive）后 T7c 仍绿——因更替重置的主机制在
  `claimDenied` 的内容比对分支内（nonce=占用身份），`claimWaitReset` 对协议内形态是冗余的纵深防御。
  非缺陷（纵深防御本就允许冗余），但评审记录：净级红灯性由内容键控计账承载。
- **OBS-3（签名形态）**：`claimStuckError(claimRaw)` 省略设计伪代码的 `waitedMs` 形参（常量内插）——
  纯形态差异，文案逐字一致，无行为影响。
- **OBS-4（环境注记）**：首轮 shard-4 本地仿真在我并行 burn+storm 时出现一次瞬态 `MODULE_NOT_FOUND`
  （spawn 失败，与本仓 cgroup `pids.max=256` 的 SA6 §15 限制一致）；单独复跑 48 文件/453 测试全绿
  exit 0。CI 分片作业独占运行，不受影响。

## 8. 结论

- **并发安全**：结构性双活消除（I0/I1/I2 落地且经 140 轮 burn + 12 路风暴 + 对抗场景独立复核）；
  SA2 #1/#8 全部解在位。**通过。**
- **liveness**：I3 有界（5002ms 实测）、恢复语义双向（自动接管/人工清除）实测；无静默无界路径。**通过。**
- **兼容性**：签名/导出/磁盘契约/三族冻结文案零变化；唯一新输出 claimStuck 与冻结败者 regex 不相交。**通过。**
- **范围**：ALLOW 四行一一对应、DENY 零触碰、CI 装置零改动、新测试自动入片。**通过。**
- **文档**：两文档行与实现同步（AGENTS.md 边界句、deployment 机制/能力/症状→处置句在位）；
  OBS-1 措辞弱化登记。**通过（含 1 条 MINOR 观察）。**
- **可执行证据**：E1-E5b/E6/E8/E9a-E9d 全绿（本轮独立复跑）；E7 独立 140 轮；变异自检净级成立。**通过。**

**Verdict: clear。`requiresConflictRecheck: false`**（无设计修订、无机制面变更、无 ALLOW/DENY 位移）。
真实 PR #276 CI 重跑（E2 远端）属总控/CI 裁决；本地同形证据（V7）已满足设计 §12 的实现侧要求。

> 证据产物索引：探针/驱动脚本与变异副本均在 `/tmp`（沙箱外一次性评审产物，不入库）；
> 本报告为唯一 worktree 产物 `wiki/raw/task_ci-pr-276_sa4_review.md`。
