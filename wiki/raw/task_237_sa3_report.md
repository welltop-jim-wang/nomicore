# SA3 实现交付报告 — issue #237：ordinary mutation 路径级/边界级校验取代完整 ROOT 复制与全量校验

- **阶段**：implementation（SA3，round 1, iteration 0）| **日期**：2026-09-06
- **Worktree**：`/home/wangjian/nomicore-fix-issue-237`（pre-commit HEAD `9e3f0bfe9e66ca71aecb33657f93907a4eafcf38`，branch `mabf/issue-237`）
- **输入**：SA1 设计 `wiki/raw/task_237_design.md`；SA2 评审 `wiki/raw/task_237_sa2_review.md`（verdict approve，裁决一/二 + C2/C3 约束性交付条件）；SA8 `wiki/raw/task_237_conflict_report.md` + `task_237_design_conflict_report.md`（E1–E4/C1–C5）；SA6 红灯契约（两文件 + `20260906-ac-issue-237.md`/`task_237_sa6.md`）；SA5 `20260906-bug-237.md`；Issue #237 正文 + Owner 3 条评论（gh 全文重读）。

## 1. 实现摘要（SA2 约束性交付逐条落实）

| 交付条件 | 落实 |
|---|---|
| 裁决一/C2：A-1 delete 腿最小修订 | `issue-237-path-localized-validation-red.test.ts` fixture `TEXT_LIB_ITEM` 的 `target` 增 optional `note?: string`；A-1 第二用例 delete 腿改 `delete ['target','note']`（seed note 在场、断言 note 删除且必填 value=1 不受影响）。未放宽 delete 词表；A-6 oracle 决策零扰动（optional 缺席/在场不改变任何 oracle 判定——SA2 已核）。 |
| 裁决二：(b) set 修复语义 + E1/E3 定稿措辞 | R6 set 目标位旧值（载体与内容）不读取、不诊断，合法 payload 写入即修复（`mutation-local.ts` kind target 分支）；ADR-0007/0010 修订节逐字采用 SA2 §3.2 定稿措辞（取代设计 §14 草稿）。 |
| 裁决二：A-7 两锚（doc-runtime 41→43 tests） | 新增 describe `A-7【SA2 裁决二锚】`：① set 替换损坏载体目标位（`target.value` 置 `new Y.Map()`）→ ok:true、恰 1 update、三计数锚=0、无关 carrier 零触碰（该锚在 HEAD `9e3f0bf` 为红——现行 extract 拒绝载体损坏；修复后转绿）；② 对称面绿锁定：array-insert 目标数组内既存损坏元素 → 整批 ok:false 零写入。 |
| C3：fatal-contract W5 用例修订 | 原形态（路径外 `count` 损坏 + 写 `title`）在 E1/E3 收窄下合法转 ok:true——用例改为**边界内**损坏形态（`items[0].qty` 损坏 + 对 `items` array-insert → R4 整批响亮拒绝 ok:false + 零写入），保持 W5「领域失败不入 fatal 通道」意图；注释引用 Owner 2026-09-05T16:01Z + ADR-0007 修订节。fatal 契约面其余用例（E203 双用例）零改动。 |
| C4：E201 码字 | `verifyBoundaryIntact` 复用既有 `DOCRT-E201` 字面量（变体 C/D 措辞族），无新增稳定码注册需求。 |
| E1–E4 文档 + follow-up 登记 | 见 §4。 |
| C5/§15 证据（不入仓） | `.mabf-bg/` 记录目标套件运行日志；A-1 计数锚（规模无关）+ B-4（8k×5 笔）即入仓 instrumentation 证据；完整 ROOT 投影次数 = 0 由 A-1 三 seam 计数断言直接证明；sequencer 占用定性：槽内领域校验从 O(ROOT)（SA5 R1b：单笔 64k 条目 ~3.5s，五段全量遍历/物化/scratch doc）收窄为 O(path + boundary)，B-4 尾断言 notify=5/事件=5/<256B/identity 保持。 |

## 2. 代码改动

### `packages/vfsl`（additive；四既有公共导出逐字节不变——validate-patch.test.ts/validate-patch-sa7.test.ts 全绿为硬前置）

- `src/validate-patch.ts`：新增公共接缝 `planMutationBoundary(derived, path, op)`（结构侧边界规划：节点集游走 + union 穿越冻结 + array 目标结构前置 + 终段段型规则 + R1–R6 边界定夺 + `descendValues` 取归一化节点；零 base 读、纯函数、E100 崩溃边界）与 `applyMutationAtBoundary(derived, plan, boundaryBase, payload)`（relPath 域规则 + 拷贝式重建（批量 insert/delete-count/remove-key 一次整体）+ `validateSubtree` 边界整体判定 + 按 prefix rebase 绝对路径 + 返回 `proposedBoundary`）；类型 `MutationBoundaryOp` / `MutationBoundaryPlan` / `BoundaryMutationPayload`。
- `src/index.ts`：增补上述导出（additive；doc-runtime 经公共包入口消费）。
- `test/validate-patch-mutation-boundary.test.ts`（新）：18 用例锚定边界定夺（target/record/parent/union/array × 词表）、域规则、批量整体判定、rebase 与 E100 面。

### `packages/doc-runtime`（公共面零变化——`src/index.ts` 未动）

- `src/mutation-local.ts`（新，@internal）：S3 plan → S4 live 导航（逐 hop 载体/在场/越界域规则；union 位置经边界提取消歧）→ S5 边界局部提取（`walk`，R6 target 跳过）→ S6 vfsl 边界重建校验 → S7 detached 构造 → 产出 commit + 边界验证输入。phase-1 前置假设写入模块头注；全部拒绝先于 live 写（禁 undo）。
- `src/mutation.ts`：`applyValidatedMutation` 路由——`set([])` 走 legacy 全量管线原样（extract→双全量校验→clone→单事务→verifyInstall+verifySnapshotIntact）；非空路径委托 `prepareLocalMutation`，提交后走 `verifyBoundaryIntact`。`navigateLive` 以 @internal 导出供换根导航复用。
- `src/install-verify.ts`：新增 `verifyBoundaryIntact`（@internal；O(1) 安装事实核（identity/长度）+ O(boundary) 边界重投影核（walk + productEqual——XML canonical/union any-of 与 ⑥ 同语义）；偏离 → E201 变体 C（committed:true 不回滚不补偿）；无法运行 → 变体 D；不重新过 schema）。
- 测试面（授权变更，C2/C3/裁决二）：见 §1。

### 附带改动：两包 package.json 版本号（incidental，补登记声明——SA4 附加门禁 §1.1 P3）

- `packages/doc-runtime/package.json` 0.1.11 → **0.1.12**：本包新增 @internal 模块与内部接缝导出（mutation-local/verifyBoundaryIntact/navigateLive，均未进 `src/index.ts` 公共面）——package-local patch 版本演进。
- `packages/vfsl/package.json` 0.2.2 → **0.2.3**：新增公共导出（SA8 D3 裁决授权）——minor 语义演进符合仓内先例（#83 0.2.1→0.2.2）。
- 影响面（SA4 实测确认）：`workspace:*` 解析与 CI frozen-lockfile 均不受版本字段影响（lockfile 不记录自身版本）；非行为改动。**声明保留**（不回滚）；若总控裁定回滚，仅需还原上述两行版本号，无其他联动。

### `packages/namespace-runtime`：零源码改动（B-1/B-2/B-3/B-4 透传验证唯一公共入口）。

## 3. 验证证据（后台进程实跑；命令与结果）

```text
# vfsl 接缝单测 + 四旧导出回归
NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run \
  packages/vfsl/test/validate-patch-mutation-boundary.test.ts \
  packages/vfsl/test/validate-patch.test.ts packages/vfsl/test/validate-patch-sa7.test.ts --typecheck=false
→ Test Files 3 passed (3)；Tests 76 passed (76)（validate-patch-sa7 含既有 ~78s 预算用例）

# doc-runtime 目标套件（SA6 红灯契约 + fatal 契约 + operations + nested-path repro）
NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run \
  packages/doc-runtime/test/issue-237-path-localized-validation-red.test.ts \
  packages/doc-runtime/test/apply-validated-mutation-fatal-contract.test.ts \
  packages/doc-runtime/test/apply-validated-mutation-operations.test.ts \
  packages/doc-runtime/test/apply-validated-mutation-nested-path-repro.test.ts --typecheck=false
→ Test Files 4 passed (4)；Tests 70 passed (70)
→ issue-237 文件：43 tests 全绿（原 4 必红转绿：A-1×2 计数锚 extract/validate/verify=0、
  A-2/B-3 无关分支语义反转；41 绿锁定保持 + A-7×2）
→ namespace-runtime issue-237 文件：4 tests（B-3 必红转绿 + B-1/B-2/B-4 绿锁定保持）

# 类型检查（改动包）
pnpm exec tsc -p packages/vfsl/tsconfig.json --noEmit      → exit 0
pnpm exec tsc -p packages/doc-runtime/tsconfig.json --noEmit → exit 0
```

## 4. 文档交付（E1–E4 + follow-up 显式登记）

- `docs/adr/0007-logical-validation-and-yjs-runtime-bridge.md`：`### issue #237 修订`（2026-09-06）——管线句改写（路径级/边界级五段式）；phase-1 前置假设条款（双半边 + 无 baseline 状态机）；`set([])` 全量形态保持；**SA2 裁决二定稿损坏条款逐字**；(i) 导航载体违规仍拒 (ii) 提取型边界内损坏仍拒 (iii) set 目标位旧值不读=修复 (iv) 触达面外让渡；失败边界/提交后验证范围声明；等价测试硬前置保持；成本模型后果句。
- `docs/adr/0008-…`：`### issue #237 修订：ROOT write 镜像句同步`——仅镜像句（校验最近必要语义边界 + 边界级提交后验证）同步；其余条款零变化。
- `docs/adr/0010-…`：`### issue #237 修订：Trusted raw update 后备句收窄 + follow-up 显式登记`——**SA2 裁决二定稿后备句逐字** + follow-up (a) 合法性重建另票 (b) carrier validation 覆盖面审计（Owner 2026-09-05T16:08Z 六项核实方向）显式登记。
- `CONTEXT.md`：「逻辑快照校验」用法清单（ordinary 写不再列写入前完整校验）；「载体投影读取」不变量维持注明 phase-1 前置假设条件；「复制未校验」后果句按 E3 收窄；「重建校验」补边界五规则 × mutation 词表交叉引用。
- 上层同值重复写/五笔合并（MABF 集成方 origin/path instrumentation）与 #238 独立调查：登记于本报告与 AC 文档，不归因本 issue（Issue 正文/AC 不新增归因表述）。

## 5. 授权测试面变更清单（SA4 复核单列）

1. `issue-237-path-localized-validation-red.test.ts`：A-1 delete 腿 fixture/断言修订（C2/裁决一）；新增 A-7 两锚（裁决二；41→43 tests）。
2. `apply-validated-mutation-fatal-contract.test.ts`：W5 用例改边界内损坏形态（C3/§13）。
3. 新增 `packages/vfsl/test/validate-patch-mutation-boundary.test.ts`（接缝单测）。
4. `issue-237…`/namespace-runtime issue-237 文件之外的既有测试文件零改动。
5. `packages/namespace-registry/test/registry-phase5-replication-session-red.test.ts`（iteration 2 补登记，SA4 §1 阻断项修复）：AC-4「raw ROOT update 不预校验」用例后半段（原锚「面外 ext 损坏 → 普通写被拒零写入」）修订为 issue #237 已授权反转的声明语义——普通 `set ['n']` ok:true、`n===9`、`ext==='zzz'` 原样保留（replication-unvalidated 存量不发现/不修复/不扫描）、dirty 恰 +1（B-3 锚形）；用例注释引用 Owner 评论 5553024739（updated 2026-09-05T16:01:43Z）+ ADR-0010 issue #237 修订节（2026-09-06）+ 本报告 §8。修订面仅该用例断言；其余 21 tests 与文件头契约注零改动。

## 6. 边界遵守

- 未扩 doc-runtime/namespace-runtime 公共面（index.ts 零改动；mutation-local/verifyBoundaryIntact/navigateLive 均为包内 @internal 接缝，未经 index.ts 导出）；vfsl 增补属 issue 正文明文「复用或扩展」落点（SA8 D3 裁决）。
- 未建 committed-generation/baseline 状态机；未引入 #238 归因；未屏蔽/跳过任何测试；未执行 commit/push（本工作树零 tracked 提交，全部改动留工作区待 Host 固化）。

## 7. 复跑验证附记（resumed dispatch，2026-09-07，iteration 1）

本报告所属实现会话中断后由 resumed dispatch 恢复；工作区实现与本节报告一致、无缺损。
2026-09-07 对全部交付证据**重新运行**并落盘 `.mabf-bg/sa3-237-r2/`（gitignore 排除，
仅留盘证据），结果与 §3 完全一致：

| 命令 | 结果 | 日志 |
|---|---|---|
| doc-runtime 目标套件（issue-237 43 + fatal-contract + operations + nested-path-repro） | Test Files 4 passed；**Tests 70 passed**（issue-237 文件 43 tests 全绿：A-1×2/A-2 必红转绿 + 41 绿锁定 + A-7×2） | `doc-runtime-target.log` |
| namespace-runtime issue-237 套件（B-1…B-4） | 1 file / **4 tests passed**（B-3 必红转绿；B-4 8k×5 笔保持） | `ns-runtime-237.log` |
| vfsl 接缝 + 四旧导出回归（mutation-boundary 18 + validate-patch 36 + validate-patch-sa7 22） | 3 files / **76 tests passed** | `vfsl-boundary.log` |
| `tsc -p` vfsl / doc-runtime / namespace-runtime（--noEmit） | 三包 exit 0 | `tsc-three-packages.log` |
| 全包回归：doc-runtime 全部测试文件（21 files / 360 tests passed） | 见 `doc-runtime-full.log` | `doc-runtime-full.log` |
| 全包回归：namespace-runtime 全部测试文件（29 files / 240 tests passed） | 见 `ns-runtime-full.log` | `ns-runtime-full.log` |
| §15 throwaway 证据运行（post-fix harness，`bench-after-r2.ts` 于 `.mabf-bg/sa5-237/` 同款 node_modules 上下文） | 见 `bench-after.log` | `bench-after.log` |

**post-fix harness 结果 vs SA5 基线**（同 fixture、同五笔叶子 set 形态；SA5 基线见
`.mabf-bg/sa5-237/repro-output.log`，均为不入仓墙钟诊断——CI 内只认 A-1 计数锚与
B-4 确定性计数）：

| 无关条目 n | SA5 基线 5 笔总耗时 | post-fix 5 笔总耗时 | update 事件/字节 |
|---|---|---|---|
| 1k | 456 ms | 1.63 ms | 5 × 30B（两侧一致） |
| 8k（mutateData 级） | 4 721.9 ms | 0.86 ms | 5 × 29–33B；dirty=5 |
| 64k | 18 480.6 ms | 0.29 ms | 5 × 33B |

- 每笔成本随无关分支规模**持平不放大**（64k 单笔 ~0.03–0.12 ms vs 基线 ~3.5 s/笔，
  ~10⁴–10⁵ 倍差）；owned update 字节（29–33B）与 dirty=5/事件=5 与基线逐字节一致——
  事务语义零变化旁证。
- 「完整 ROOT 投影次数 = 0」由 A-1 三 seam 计数断言直接证明（本次复跑 43 tests 全绿
  再次确认 extractYjsSnapshot / validateLogicalSnapshot / verifySnapshotIntact 在非空
  路径写中调用数为 0）；sequencer 占用定性：槽内领域校验从 O(ROOT)（SA5 R1b：64k 单
  笔 ~3.5 s、每笔 ~3.3 GB 级快照物化面）收窄为 O(path + boundary)（64k 单笔 <1 ms），
  B-1/B-4 的 FIFO/notify/事件计数锚全部保持，槽内占用收缩不改变槽序语义。
- 无公共 API 面变化、无 #238 归因（harness/报告均未引用 replication apply 延迟调查）。

## 8. SA4 reject 修复附记（2026-09-07，iteration 2）

SA4 `wiki/raw/task_237_sa4_review.md`（verdict **reject**，单点阻断：根级 `pnpm test` 红——
1 个未登记既有测试面被授权语义反转击穿，L964 旧断言 `w?.ok === false`）修复交付：

- **改动（仅测试面；生产码零改动）**：`packages/namespace-registry/test/registry-phase5-replication-session-red.test.ts`
  AC-4「raw ROOT update 不做 VFSL 预校验」用例后半段修订为 issue #237 已授权反转的声明
  语义——replication-unvalidated 形态下面外损坏（`ext='zzz'`）不阻断普通 `set ['n']`：
  `ok:true`、`n===9`、`ext` 原样保留（不发现/不修复/不扫描破坏）、dirty 恰 +1（B-3 锚形）；
  用例注释引用 Owner 评论 5553024739（updated 2026-09-05T16:01:43Z）+ ADR-0010 issue #237
  修订节（2026-09-06）+ 本报告 §5 第 5 项。修订面仅该用例断言；该文件其余 21 tests 与
  文件头契约注零改动（SA4 基线对照：HEAD `9e3f0bf` 同文件 22/22 绿）。
- **附带登记**：§2 补登记两包 package.json 版本号（SA4 附加门禁 P3；声明保留，回滚仅需
  还原两行）。
- **复跑证据**（`.mabf-bg/sa3-237-r3/`，gitignore 仅留盘）：

| 命令 | 结果 | 日志 |
|---|---|---|
| 根级 `pnpm test`（`vitest run --typecheck`，全仓 227 files） | **227 files passed (227)；Tests 2407 passed (2407)；Type Errors no errors；exit 0**（SA4 红态对照：1 failed / 2406 passed） | `full-pnpm-test.log` |
| namespace-registry 目标文件（registry-phase5-replication-session-red.test.ts，含修订用例） | 1 file / **22 tests passed** | `registry-phase5-file.log` |
| `pnpm exec tsc -p packages/namespace-registry/tsconfig.json --noEmit` | exit 0 | `tsc-registry.log` |

- **一致性核项**：doc-runtime/namespace-runtime issue-237 契约套件（A-1 计数锚、A-2/B-3
  反转、A-4 路径 carrier、A-7 边界内损坏仍拒、B-2 失败零副作用、B-4 dirty/事件计数、wire
  冻结 `ws-replication-issue230-incremental-mutation.test.ts`）均在根级全量运行中全绿——
  Owner 5553067202（carrier/边界本地安全）与 5556480468（失败零副作用、事务/dirty/wire
  语义保持、follow-up 显式登记）要求原样保持，本附记零生产行为改动；无 #238 归因。
