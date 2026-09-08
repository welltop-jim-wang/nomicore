# SA4 静态验尸报告 — issue #237（SA3 实现后红队审查）

**Date**: 2026-09-08（iteration 1 复审）| **Dispatch**: sa-9de2202a-5c5f-4e5d-a78e-b95376808a1e
**Verdict**: **approve**（iteration 0 唯一阻断项——根级 `pnpm test` 红——已修复且修复方式稳妥；本轮全量复审未发现新的 BLOCKER/MAJOR）
**Worktree**: `/home/wangjian/nomicore-fix-issue-237`（HEAD `9e3f0bf` + 工作区未提交实现，恢复态与 SA3 报告 §2/§5/§8 逐文件一致）

- 输入（全部读过）：SA6 契约 `20260906-ac-issue-237.md` + `task_237_sa6.md`；SA1 `task_237_design.md`；SA2 `task_237_sa2_review.md`（裁决一/二）；SA8 `task_237_conflict_report.md`（E1–E4）+ `task_237_design_conflict_report.md`（C1–C5）；SA5 `20260906-bug-237.md`；SA3 `task_237_sa3_report.md`（含 §7 复跑附记 + §8 reject 修复附记）；issue #237 正文 + Owner 三评论（本轮 gh API 重读，Comment ID 与 updated_at 逐字核对：**5553024739 / 2026-09-05T16:01:43Z、5553067202 / 2026-09-05T16:08:47Z、5556480468 / 2026-09-06T02:55:36Z**——与各 SA 产物引用一致）；实现 diff 全量逐文件（12 modified + 4 untracked 生产/测试 + wiki）。
- 独立运行（本评审自跑，非转抄 SA3 证据）：**根级 `pnpm test`（`vitest run --typecheck`）= 227 files passed (227)；Tests 2407 passed (2407)；Type Errors no errors；exit 0**（日志 `.mabf-bg/sa4-237-r2/root-pnpm-test.log`，Duration 115.62s）。对照 iteration 0 红态（同命令 1 failed / 2406 passed，失败即 registry AC-4 用例）与 SA5/SA3 证据链闭合。
- 本轮新增静态核验：`mutation-local.ts` 全文（423 行）、`validate-patch.ts` 新增 339 行、`mutation.ts`/`install-verify.ts` diff、三测试文件全文、ADR/CONTEXT diff、`drillStep.crossedUnion/viaRecord` 语义（union 目标位 vs union 穿越位定夺正确性）、vi.mock 三 seam 包装面、`normalizePath` 空路径拒绝、`navigateLive` 空 relPath 换根行为。

---

## 0. iteration 0 REJECT 项修复确认（本轮 dispatch 交办重点）

**原阻断点**：`packages/namespace-registry/test/registry-phase5-replication-session-red.test.ts` AC-4 用例后半段锚定旧语义（面外损坏阻断普通写 → `w?.ok === false`），被 #237 授权反转击穿，根级 `pnpm test` 1/2407 红。

**修复稳妥性逐项确认**：

| # | 核验项 | 结论 | 证据 |
|---|---|---|---|
| 1 | 修订面最小性 | ✅ | git diff 单 hunk：仅该用例标题 + 授权注释块 + 后半段 4 行断言；该文件其余 21 tests 与文件头契约注零改动（基线 HEAD `9e3f0bf` 同文件 22/22 绿——iteration 0 throwaway worktree 证据 `.mabf-bg/sa4-237/baseline-9e3f0bf-registry-green.log`） |
| 2 | 新断言 = 声明语义精确形 | ✅ | `set ['n']=9` → `ok:true`、`n===9`（写入生效）、`ext==='zzz'` 原样保留（不发现/不修复/不扫描破坏）、`saveEvents === saveBaseline+2`（普通写相对 raw-accept 基准恰 +1 dirty，B-3 锚形）——与 iteration 0 修复指令逐条一致，与 A-2/B-3/A-7 例外注释先例同构 |
| 3 | 授权链注释完整性 | ✅ | 注释引用 Owner 评论 **5553024739（updated 2026-09-05T16:01:43Z）**（本轮 gh API 核对 ID/时间戳无误）+ ADR-0010「issue #237 修订：Trusted raw update 后备句收窄 + follow-up 显式登记」（2026-09-06）+ SA4 复审 §1 回流记录——授权面（E1/E3 语义让渡）真实在档 |
| 4 | 测试未被弱化 | ✅ | 用例前半段（raw update 无预校验接受 + `replication-unvalidated` 标记 + 接受路径恰 +1 dirty）与尾段（第二次 raw apply 同样标记 + 恰 +1 dirty）原样保留——该用例锚定的 raw 通道语义零削弱；仅「后备句」半段按 Owner 授权反转。无 skip/only/todo |
| 5 | 全量绿证据独立复现 | ✅ | 本评审自跑根级 `pnpm test`：**227 files / 2407 tests 全绿 + 0 类型错误 + exit 0**（与 SA3 §8 `full-pnpm-test.log` 一致）；目标文件在本次全量运行中 ✓（22 tests / 2112ms） |
| 6 | 生产行为零改动 | ✅ | iteration 2 修订仅测试面；本轮全 diff 复读确认生产改动面 = SA3 §2 枚举（mutation.ts/mutation-local.ts/install-verify.ts/validate-patch.ts/index.ts），与 iteration 0 已通过静态复审的状态一致 |

**结论：修复稳妥（sound），阻断项解除。** Controller 侧 dispatch log 登记该测试面变更（SA2 裁决一/二同款流程）为收尾义务，非 SA4 阻断项。

---

## 1. 上游要求落实（Owner 三评论 × Comment ID/updated_at 核对）

| Requirement or finding | Implementation evidence | Assessment |
|---|---|---|
| 5553024739（16:01:43Z）：删热路径旧完整 ROOT `validateLogicalSnapshot`；无 baseline 状态机；只提取/重建/校验路径 + 最近必要语义边界；前置假设写入内部契约与测试前置 | `mutation-local.ts` 头注（phase-1 前置假设双半边 + 无状态机声明）；`prepareMutation` 非空路径委托 `prepareLocalMutation`；grep 无 generation/validity 缓存；测试 `expectValidBaseline` 前置在案 | ✅ |
| 5553024739：replication/损坏存量/不可信恢复合法性重建不在第一阶段 | ADR-0010 修订节 follow-up (a) 显式另票登记；registry AC-4 用例按此授权修订（§0） | ✅ |
| 5553024739：测试证明 mutation 不访问/复制/校验无关 ROOT 分支 | A-2/B-3 反转锚 + B-4 identity/规模/内容零触碰 + A-1 三 seam 计数锚（本轮全量运行全绿） | ✅ |
| 5553067202（16:08:47Z）：document valid = carrier topology ∧ logical value 双半边前置 | `mutation-local.ts` 头注逐字双半边；`expectValidBaseline`（extract + validate 双断言） | ✅ |
| 5553067202 §3：沿路径导航仍检查所经过的局部 carrier；不实例化不匹配 carrier | `navigateHops` 逐 hop 载体检查（map→Y.Map / array→Y.Array，违规 = 领域 ok:false 零写入）；S5 `walk` 边界内载体校验；A-4×2 绿 | ✅ |
| 5553067202 §2：分层——vfsl 保持纯 JSON 值语义、无 Yjs；doc-runtime 拥有 carrier 校验 | vfsl 新增两接缝零 Yjs 依赖（纯 derived/boundaryBase 值域）；carrier 检查全部在 doc-runtime（navigateHops/walk/verifyBoundaryIntact） | ✅ |
| 5553067202 §4：校验失败在触碰 live Y.Doc 前决定；禁 write-then-undo | S3–S7 全部先于 `transactGuarded`（代码结构逐分支核实）；A-3×3/B-2 零写入零事件零 dirty 绿 | ✅ |
| 5553067202 §6：carrier 覆盖面审计 = 独立正确性 follow-up | ADR-0010 修订节 follow-up (b) 显式登记（六项核实方向）；本票不夹带 | ✅ |
| 5556480468（02:55:36Z）：大 ROOT + 连续五笔叶子 mutation（30s 周期 fake clock 压缩）、对比优化前后、完整 ROOT 投影次数=0、保持 dirty 与 wire update count | B-4（8k×5：ok×5、notify=5、事件=5、<256B/笔、零触碰、尾部全局合法；紧邻调用压缩理由=写路径零墙钟依赖，注释在案）；A-1 计数锚 =「完整 ROOT 投影次数=0」的入仓证明；SA3 §7 post-fix harness（64k 五笔 0.29ms vs 基线 18.5s，不入仓旁证） | ✅ |
| 5556480468：不把 #238 replication latency 归因本 issue | 全部改动文件 grep：#238 仅以「不归因」纪律声明出现（2 处测试头注）；报告/ADR/CONTEXT 无归因表述 | ✅ |

## 2. 设计落实审查

| Design decision | Implementation location | Assessment | Finding |
|---|---|---|---|
| S3 `planMutationBoundary`（结构侧规划，零 base 读，E100 收编） | `validate-patch.ts` 新增段：normalizePath（非空）→ drillStep 节点集游走 → union 穿越首次冻结（`boundaryAt`）→ array 目标结构前置 → 终段段型规则 → R1–R6 定夺 → `descendValues` | ✅ 纯函数核实；**union 目标位 vs 穿越位定夺经 drillStep 源码核实正确**：`crossedUnion` 仅在「经 union 展开匹配段」时置位——`set ['u']`（u 为 union 字段）= kind target（R6 整值替换），`set ['u','x']` = kind union（R1）——无误升级 ROOT 边界 | — |
| S4 live 导航（逐 hop 载体/在场/越界；载体违规 = 领域 issue 不升格 E204） | `mutation-local.ts navigateHops`：probeRoot Y.Map 前置 + 每 hop carrierOf 判定 + `get(seg)===undefined` 中间在场拒 + 数组界内检查 | ✅ 与设计 §7.3 错误分类表逐行一致；E204 保留给手造派生物（descendStructureNode/navigateLive 两树分歧抛点） | — |
| S5 边界提取（R6 跳过；`walk` 局部投影） | kind target 分支不调用 walk（旧值零读取——SA2 裁决二 (b)）；parent/record/array/union 分支 `walk(boundaryNode, boundaryLive)` | ✅ | — |
| S6 `applyMutationAtBoundary`（域规则 + 批量整体重建 + validateSubtree + prefix rebase） | `validate-patch.ts`：relNavigate/rebuildAlong（拷贝式、计算键展开防 `__proto__` 落原型）+ insert-batch/delete-count/remove-key 一次整体 + `validateBoundary` rebase | ✅ 域规则文案与 `placeSet/placeDelete/placeArrayInsert/placeArrayDelete` 现行拒绝域逐条对齐（本轮对照核实）；A-5 批量整体判定绿 | — |
| S7 detached 构造（换根 navigateLive；union 以边界提取值下钻消歧） | `mutation-local.ts` union/array 分支 `navigateLive(boundaryLive, boundaryNode, boundaryLogical, relPath)`——算法零改动换根（空 relPath 时仅返回 resolveNode 后根步，`as Y.Map` 为类型层转换、无运行时 map 操作，核实无隐患） | ✅ | — |
| S8 单 guarded transaction 最小 edit | `mutation.ts applyValidatedMutation`：唯一 `transactGuarded` 调用点不变；commitPrepared 原样（set/delete/insert/delete-range 最小 edit） | ✅ B-1/B-4 锚定 | — |
| S9 `verifyBoundaryIntact`（O(1) 事实核 + O(boundary) 重投影核；E201-C/D；不重过 schema） | `install-verify.ts` 新增段：identity/长度事实核 + `walk` 重投影 + `productEqual`（XML canonical/union any-of 同 ⑥ 语义）；复用 DOCRT-E201 码字（C4）；kind target 时边界 live 由 `parent.get(key)` 提交后重读 | ✅ | — |
| `set([])` legacy 全量形态原样 | `prepareMutation` isRootReplace 分支：extract→双 validate→clone→applyToJson→prepareCommit→verifyInstall+verifySnapshotIntact 逐行保持 | ✅ A-6 空路径用例绿 | — |
| vfsl 四旧导出逐字节不变 | diff 纯追加（+339 行全在文件尾部 + 头注改写）；四导出函数体零触碰 | ✅ 优于设计「机械抽取」方案（零重构风险）；validate-patch.test/sa7 回归在本轮全量运行绿 | — |
| 错误分类表（§7.3） | 结构守卫/导航载体/边界提取/域规则/值校验/构造失败 → ok:false；手造派生物 → E204（committed:false）；信封意外 → E205；事务内 observer → E203；S9 偏离 → E201-C、无法运行 → E201-D | ✅ 逐行对位；fatal-contract 契约面（E203 双用例）零改动绿 | — |

## 3. 架构一致性与惯例

### 责任归属
| Behavior | Expected owner | Actual location | Assessment |
|---|---|---|---|
| schema 解释（结构守卫/边界规则/值校验） | vfsl 单源 | validate-patch.ts 两新接缝 + validateSubtree 共享解释器 | ✅ 无第二解释器 |
| carrier 校验 | doc-runtime | navigateHops/walk/verifyBoundaryIntact | ✅ Owner 5553067202 §2 分层保持 |
| 槽序/FIFO/dirty | namespace-runtime | write.ts 零改动 | ✅ B-1/B-2/B-4 透传 |

### 相似能力对照
| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
|---|---|---|---|---|
| 路径级校验 | validate-patch.ts 四导出（guardWalk/rebuildOp/finish） | 新接缝复用 drillStep/structureLens/descendValues/validateSubtree 同族内部件 | 一致 | 同一 §3.3 五规则族 + 同一解释器 |
| 路径局部投影 | extract.ts `walk`（@internal 先例） | mutation-local/install-verify 直接消费 | 一致 | 无重造投影器 |
| 提交后验证 | install-verify.ts verifyInstall/verifySnapshotIntact | verifyBoundaryIntact 同文件同码字族 | 一致 | E201 语义族延续 |

### 单一事实源 / 生命周期对称 / 平行机制
- 无第二缓存/marker/generation（grep 证实）；无旁路 RPC；无第二事务入口。
- 无平行 cleanup worker/retry loop/日志格式；新模块即设计指定的 mutation-local.ts，无投机抽象。
- 换根导航复用 navigateLive（导出 @internal，先例 = extract.ts walk 接缝）；无生命周期新增面。

## 4. 文件范围审查

| Changed path | ALLOW entry | Purpose | Assessment |
|---|---|---|---|
| `packages/vfsl/src/validate-patch.ts` / `src/index.ts` | 设计 §6 + SA8 D3 | 两新公共接缝 additive | ✅ |
| `packages/doc-runtime/src/mutation-local.ts`（新） | 设计 §7.2 | 局部管线 @internal | ✅ 未进 index.ts（public-surface-guard 绿） |
| `packages/doc-runtime/src/mutation.ts` / `install-verify.ts` | 设计 §7.1/§7.4 | 路由 + verifyBoundaryIntact @internal | ✅ |
| `packages/doc-runtime/package.json`（0.1.12）/ `packages/vfsl/package.json`（0.2.3） | iteration 0 P3 未申报 → **SA3 §2 已补登记** | 版本演进声明 | ✅ 已申报（保留声明，不回滚；workspace:* 与 frozen-lockfile 不受影响） |
| 3 个新测试文件 | SA6 契约 + SA2 裁决二 A-7 | 红灯契约/A-7/vfsl 接缝单测 | ✅ 均在根级 vitest include glob 内（本轮全量运行 ✓） |
| `apply-validated-mutation-fatal-contract.test.ts` | C3/设计 §13 | W5 用例改边界内损坏形态 | ✅ 注释引用 Owner 16:01Z + ADR-0007 修订节；E203 契约面零改动 |
| `registry-phase5-replication-session-red.test.ts` | iteration 0 REJECT 修复指令 + Owner 5553024739 + E3 | AC-4 后备句语义反转 | ✅ 见 §0 |
| ADR-0007/0008/0010、CONTEXT.md | SA8 E1–E4 强制义务 | 修订节 + follow-up 登记 | ✅ 见 §6 |
| `wiki/raw/*` | SA 产物面 | 各角色报告 | ✅ |

- namespace-runtime / ws-replication 源码零改动（git status 证实）。
- 工作树无 `/tmp` marker、无遗留 throwaway worktree（`.worktrees/` 空；`.mabf-bg/` gitignore）。

## 5. 契约连锁审查

| Contract | Caller | Actual handling | Risk | Finding |
|---|---|---|---|---|
| `applyValidatedMutation` 结果联合/签名 | namespace-runtime write.ts S5 | 零变化（`{ok:false,issues}` / `{ok:true}` / fatal throw 三面保持） | 无 | — |
| fatal 透传链（E201/E203/E204/E205） | write.ts 槽 + sequencer | 分类表逐行保持；committed:true 面（E201-C/D、E203）不假成功 | 无 | — |
| `mutateData` 公共 interface | registry/lease 消费者 | 零源码改动；registry AC-4 用例按声明语义修订（授权变更） | 无 | — |
| vfsl 公共面 | doc-runtime（经 `@nomicore/vfsl` 正道）+ 外部消费者 | additive 2 函数 + 3 类型；四旧导出逐字节不变 | 无 | — |
| wire 层 | ws-replication（冻结测试 issue230） | 本轮全量运行 ✓（5 小写 = 5 update/零 resync 契约不回归） | 无 | — |
| 语义反转涟漪（面外损坏不再阻断写） | 全部锚定旧语义的既有测试 | iteration 0 全量运行抓出 registry AC-4 唯一漏网点并已修复；本轮 2407 全绿证明无剩余漏网 | 无 | — |

## 6. 错误、恢复与并发（含 E1–E4 文档义务复核）

- **零写入面**：一切拒绝（S3–S7）先于 `transactGuarded` 返回；失败无任何 live Y.Doc 副作用（A-3×3/B-2：状态字节不变 + 0 update + 0 dirty + 槽不中毒）。
- **TOCTOU**：S4–S7 与 S8 同槽同步无 await 间隙；S9 重读边界。`planMutationBoundary` 纯函数零 doc 状态（SA8 D3 TOCTOU 裁决保持）。
- **E1（ADR-0007 修订节 7 条）**：管线句/前置假设/set([]) 保持/**SA2 裁决二损坏条款逐字 (i)–(iv)**（本轮与 SA2 §3.2-2 定稿逐字比对一致）/失败边界与提交后范围声明/等价硬前置保持/成本模型——全交付。
- **E2（ADR-0008）**：仅镜像句 + 显式「其余零变化」枚举。✅
- **E3（ADR-0010）**：后备句**逐字采用 SA2 §3.2-3 定稿** + follow-up (a) 合法性重建另票 (b) carrier 覆盖面审计（Owner 16:08Z §1/§6 方向）显式登记，无静默留白。✅
- **E4（CONTEXT.md）**：四词条（逻辑快照校验/载体投影读取/复制未校验/重建校验交叉引用）修订到位，与 E1/E3 措辞同源。✅

## 7. 测试质量审查

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
|---|---|---|---|---|
| doc-runtime `issue-237-…red.test.ts`（43） | A-1×2 三 seam 计数=0（vi.mock 仅包 extractYjsSnapshot/validateLogicalSnapshot/verifySnapshotIntact，`...mod` 透传其余——本轮核实包装面精确）；A-2 反转；A-3×3 零写入；A-4×2 载体拒；A-5×5 批量整体；A-6×28 oracle 等价；**A-7×2 裁决二锚**（set 修复损坏载体位 + 边界内损坏仍拒） | 根级 vitest（✓ 43 tests） | 无 skip/only；无 readFileSync 源码断言；A-1 delete 腿修订（C2/裁决一：optional `note` 字段，严禁放宽 delete 词表的注释在案） | — |
| ns-runtime `runtime-mutate-…red.test.ts`（4） | B-1 五笔精确联合/notify=5/事件=5/<128B/identity；B-2 失败零副作用；B-3 反转；B-4 8k×5 instrumentation | 根级 vitest（✓ 4 tests） | 无 | — |
| vfsl `validate-patch-mutation-boundary.test.ts`（18） | 边界定夺 R1–R6×词表、域规则、批量整体、rebase、E100 | 根级 vitest（✓ 18 tests） | 无 | — |
| `fatal-contract`（4） | W5 修订后仍锚「领域失败不入 fatal 通道」（边界内损坏 + array-insert → ok:false） | 根级 vitest（✓） | 无弱化：fatal 面（E203）零改动 | — |
| `registry-phase5-…red.test.ts`（22） | AC-4 修订用例 = 声明语义精确形（§0） | 根级 vitest（✓ 22 tests） | 无 | — |
| 既有全族（operations/nested-path/sequencer/public-surface/wire 冻结等） | — | 根级 vitest 2407 全绿 | — | — |

- 触发性：三个新测试文件均被根级 `pnpm test`（CI 每 PR 必跑）发现并执行；typecheck 覆盖（Type Errors no errors）。
- 五写 instrumentation（Owner 5556480468）：B-4 为入仓锚（计数断言、零墙钟、确定性）；dirty=5/事件=5/字节上限全部保留；30s 压缩理由注释在案。

## 8. Required revisions

无（无 BLOCKER/MAJOR）。

## 9. 后续动态验证项（交 Controller 路由，SA7 候选）

| Risk | Driver | Expected observation | Failure condition |
|---|---|---|---|
| E201 变体 C 实驱（无测试直接驱动） | 普通 non-empty 写事务后 observer 改写已安装边界 | DOCRT-E201 committed:true、措辞含边界 path、doc 保持 observer 留下状态 | 假成功 / 降格 ok:false（新旧验证器同缺口，非本票回归） |
| NaN/Infinity/-0 oracle 怪稽 | `validateLogicalSnapshot` 接受顶层 plain 位 non-finite vs 写路径 buildDetachedValue 拒 | 新旧管线逐位一致（iteration 0 探针已证） | 收敛词表需求浮出（随 carrier 覆盖面审计 follow-up 一并核实） |
| registry AC-4 可选补强 | 同用例或邻用例补边界内损坏仍拒对照（镜像 A-7 第二锚三分面） | ok:false 零写入 | —（iteration 0 可选项，非阻断） |
| 大 ROOT 端到端墙钟旁证 | SA7 可选重跑 throwaway harness | 64k 五笔 <1ms、计数锚不变 | —（不入仓、不设 CI 阈值） |
| Controller 收尾义务 | dispatch log 登记 registry 测试面变更（SA2 裁决一/二同款流程） | 登记在案 | —（流程项，非代码缺陷） |

## 10. Non-blocking observations

1. **E201-C 无直接测试驱动**：与旧 verifySnapshotIntact 同缺口（仅变体 D 有 sa7 spoof 用例），非本票回归；登记 §9。
2. **NaN/Infinity oracle 差异面**：pre-existing、新旧管线一致；登记 §9 随 carrier 审计 follow-up。
3. **版本号 bump 保留**：SA3 §2 已申报（iteration 0 P3 解除）；如总控另裁回滚仅需还原两行。
4. **A-6 oracle 依赖 extract 产物作基线**：重叠成员 union 投影推论（设计 §3.4）两侧一致故等价不破——结构性前提已在 SA2 §4-4 复核，无需动作。

## 11. 结论

**Verdict: approve。** iteration 0 的唯一阻断项（根级 `pnpm test` 1/2407 红——namespace-registry AC-4 既有用例锚定旧语义且未登记）已按回流指令修复：修订面最小（单用例后半段）、断言为声明语义精确形（ok:true + n=9 + ext 原样 + 恰 +1 dirty）、授权链注释完整（Owner 5553024739 + ADR-0010 修订节 + SA4 回流记录）、raw 通道锚定面零削弱、生产行为零改动；本评审独立复跑根级 `pnpm test` 确认 **227 files / 2407 tests / 0 type errors / exit 0**。本轮对恢复态实现的全量静态复审（局部管线五段、边界定夺、错误分类、契约连锁、E1–E4、#238 纪律、测试质量）未发现新的 BLOCKER/MAJOR；Owner 三评论（按 Comment ID 与 updated_at 核对）全部落实。遗留项均为 pre-existing 或流程收尾性质，登记于 §9/§10。

- 回流目标：无（approve）；§9 动态验证项与 Controller 收尾义务供后续路由。
- 产物：本报告 + 独立运行日志（`.mabf-bg/sa4-237-r2/root-pnpm-test.log`，gitignore 仅留盘）。
