# Spec 终审报告 — issue #131（Phase 5: generate namespaceId and migrate Registry identity）

- **审查者**: 独立 Spec 终审 reviewer（engineering/code-review 门禁，终审轴二）
- **审查日期**: 2026-08-27
- **Worktree**: /home/wangjian/nomicore-fix-issue-131（分支 fix/issue-131-on-docs-phase-5-websocket-replication）
- **审查 diff 范围**: `980b16a..HEAD`（基线 980b16a = origin/docs/phase-5-websocket-replication 顶端）
  - 提交序列：`b21de27`（feat: 生成 namespaceId + Registry identity 迁移）→ `b0962e9`（SA6 红灯锚定 fixture 修正）→ `7296c1e`（dispatch log 记录 SA4 pass）→ `9ec3eef`（SA7 phase-5 动态回归 + AC checklist）
  - 变更面：36 文件，+4560/−731。生产代码仅 `packages/namespace-registry/src`（identity/registry/types/create-document/observer/plugin/testing/index 共 8 模块）+ `docs/adr/0006|0009` 各一节 + wiki 产物；`packages/persistence` 零改动（已核实 `git diff 980b16a..HEAD -- packages/persistence/` 为空）。
- **规格依据**: 任务简报 `wiki/raw/task_phase5-namespaceid-registry-identity.md`（What to build + AC-1..AC-7）；接受的设计 R2 `..._design.md`；ADR 0010 词汇基准。

## 独立验证动作（不照抄总控 AC 核对表）

1. 逐行读全部 src diff（identity.ts / registry.ts / types.ts / create-document.ts / observer.ts / plugin.ts / testing.ts / index.ts）与 ADR 0006/0009 新增节；
2. 抽读验收测试断言强度：red.test.ts 全 20 用例（AC-1..AC-6 + 锚 A/B/C）、surface.test-d.ts 5 类型锚、sa7-phase5-dynamic D1–D4；既有套件迁移 diff 普查（create/idle/open/shutdown/plugin/hostile/rev1/cordis/concurrency/node-dispose/persistence-contract）；
3. 只读验证命令：
   - `pnpm test`（vitest run --typecheck）独立复跑：**121 文件 1431/1431 通过、Type Errors: no errors**（Duration 111.65s）；
   - `git diff 980b16a..HEAD -- packages/persistence/` = 空（AC-5 零改动实证）；
   - grep 残留扫描：src 内无 `Math.random`/`crypto.getRandomValues` 调用（仅注释禁令文本）、无长度前缀复合键残留（`\u0000`/`userId.length` 拼接零命中）；
   - 旧格式 namespaceId（`'k'`/`'k-ns'`）open 兼容锚在 open/idle 套件中原样保留且全绿（D-10 成立）；
   - registry-surface.test.ts 本 diff 零改动且通过（9/2 运行时 export 冻结保持；`RegistryRandomBytes` 为纯类型导出，不触冻结面）。

## 逐条 AC 对照结论

| AC | 结论 | 独立核实证据 |
|---|---|---|
| AC-1 注入 128-bit CSPRNG 生成 `ns-`+32hex、拒收调用方 namespaceId | ✅ 满足 | registry.ts `generateNamespaceId`：`randomBytes(16)`→`ns-`+32 小写 hex，产物结构守卫 `^ns-[0-9a-f]{32}$`；identity.ts `acceptCreateIdentity` ① namespaceId 键出现即拒（CREATE_INVALID_INPUT，零随机消耗，red.test.ts:317-331 锚 consumed=0/零 Persistence）；types.ts `CreateNamespaceInput` 三键化 + `RegistryRandomBytes` 必需注入两选项类型，缺失→构造期同步 TypeError（red.test.ts:333-343 双工厂断言）；plugin.ts 桥接 node:crypto（Buffer→独立 Uint8Array 拷贝），核心零全局 crypto。SA7 D1/D3 真实链路 + 60k 抽样零重复（1431 绿含此）。 |
| AC-2 碰撞重试至多 8 次、耗尽 committed:false Registry fatal | ✅ 满足 | `MAX_NAMESPACE_ID_RETRIES = 8`，编排循环首生成+≤8 重试=总生成 ≤9；active/idle/closing entry 一律碰撞（`entries.has` 即 retry，绝不等 closePromise）、`DocDuplicateError`→retry；耗尽 reject `NamespaceRegistryFatalError('create','namespace-id-generation',false)`（新 phase 注册于 types.ts 词表）。red.test.ts:423-452 锚 consumed 恰 9 + committed:false + 零重复落盘；:454-474 duplicate 耗尽 dupAttempts∈[9,10]。随机源 throw/形状违约立即 fatal 不耗预算（锚 B1-B3 验证）。 |
| AC-3 lifecycle 序列化与 Runtime 复用仅按 namespaceId | ✅ 满足 | identity.ts `validateOpenIdentity` 返回 `key: namespaceId`（复合键退役，grep 零残留）；entries/carriers 均按该 key 索引；锚 C（red.test.ts:709-728）同候选并发 [X,X,Y] 恰 {X,Y} 各 1 Runtime、createDoc FIFO [X,Y]——「同 namespaceId 每进程至多一个 Runtime」由 carrier FIFO 结构性保证。idle/open/shutdown 迁移套件全绿。 |
| AC-4 owner 校验投影、mismatch→既有 not-found 不泄露 | ✅ 满足 | create 接纳段 `validateOwnerIdentity`（非法 owner→NAMESPACE_INVALID_IDENTITY field=owner.userId，零生成零 Persistence，red.test.ts:511-523）；lease.owner 冻结投影（:310）；runOpenSlot 新增第一谓词 + closing recheck 同谓词：mismatch→既有 NOT_FOUND 常量，零 loadDoc、零新 Runtime（red.test.ts:480-509 双用例含「B 分区有文档也零暴露」）。open 身份文法零改动（旧格式 ID 可 open）。 |
| AC-5 Persistence owner 分区零改动、无跨 owner catalog | ✅ 满足 | `packages/persistence` diff 为空（实证）；`createDoc(owner, 生成ID, doc)` 继续按 owner 分区排他创建；surface.test-d.ts 保持性守卫（DocPersistence 无 listNamespaces/listDocs/catalog）绿；red.test.ts:528-553 分区全链（同分区恢复/跨 owner NOT_FOUND/createDoc 全落 A 分区）；SA7 D2 真实 File round-trip 按 `users/<owner>/<nsId>.snapshot` 落盘。 |
| AC-6 Memory/File/Registry contract 测试覆盖 generation/retry exhaustion/owner mismatch/concurrency/shutdown/公开面兼容 | ✅ 满足 | red.test.ts 20 用例覆盖 generation/active+idle+closing 碰撞/双耗尽/owner mismatch×2/并发双 create/shutdown 恰一次 + 锚 A（shutdown×在途重试屏障）/锚 B1-B3/锚 C；registry-persistence-contract 同时跑 Memory+File 双 adapter 且迁移为 lease.namespaceId 回读传递（更诚实）；registry-surface 9/2 冻结零改动保持绿；SA7 D1-D4 动态补刀（真实 cordis host/File/真实调度）。独立复跑 1431/1431。 |
| AC-7 ADR 0006/0009 implementation-facing docs 与 package contracts 对齐 ADR 0010 词汇 | ⚠️ **部分满足** | 规范面已对齐：ADR 0009 追加 #131 修订节（6 条逐字映射新语义）、ADR 0006 追加对齐说明（不改 Persistence 契约条款）、CONTEXT.md:113-115 namespaceId 词条本已对齐（零改动，符合设计 D-11）、types.ts 契约注释/ADR 0010 词汇一致、ADR 0010 与 phase 文档未动（正确）。**但三处面向消费者的文档残留旧契约文案（详见下节清单）**；且总控 AC 核对表第 13 行声称「registry README/package contracts 随 b21de27 对齐（SA4 V 项核实）」不实——README.md 在本 diff 范围零改动（最近一次变更为 #105/#128）。 |

## 缺失 / 部分满足 / scope-creep / 疑似错误行为清单

### P-1（部分满足，AC-7 残留；本报告唯一阻断项）：三处面向消费者文档残留旧契约文案

1. **`packages/namespace-registry/README.md:3`** —「It guarantees one active runtime and one write sequencer per `(owner.userId, namespaceId)`」。
   **失效原因**：本 PR 的核心语义变更后，entry 仅按 namespaceId 索引——同一 namespaceId 的第二 owner open 在 entry 命中时得 NOT_FOUND（零新 Runtime）。唯一性保证维度已从复合键变为 namespaceId 本体，该行仍陈述已退役的复合键保证，对本 PR 改动的主体构成**事实性错误陈述**（读者可合理预期 `(ownerB, sameNsId)` 获得独立 Runtime——实际不再成立）。
2. **`packages/namespace-registry/README.md:33`** —「Expected open/create failures use narrow result issues such as … `NAMESPACE_ALREADY_EXISTS` …」。
   **失效原因**：普通 create 的 ALREADY_EXISTS 运行时产出点已全部删除（registry.ts grep 实证仅剩注释；open 从不产出该码）；code/message 仅按设计 D-7 保留于 types.ts 公共联合供切片 2 受信任导入路径复用。当前包内**无任何运行时路径产出该 issue**，README 仍将其列为 open/create 的预期失败面。
3. **`docs/integration/cordis-plugin-hosting.md:117-126`**（create 示例，:120 `namespaceId: 'notes'`）——第三方宿主集成指南的「创建、读取、修改和重新打开」示例以四键 `{owner, namespaceId, schema, root}` 调用 `registry.create`。
   **失效原因**：新契约下携带 namespaceId 键 → 接纳段同步 `NAMESPACE_CREATE_INVALID_INPUT`。用户照抄该示例**必然在运行时被拒**；README.md:5 明确将本指南指为第三方宿主装配的权威文档。

> 影响面评估：纯文档债，修复为三处小编辑（README 两行文案 + 指南示例去 namespaceId 键）；不改变已验证的运行时正确性。但 AC-7 是文档对齐条款，而这三处恰是该条款面向消费者的落点，且总控核对表对此作了不实的「已对齐」记录——独立终审不予放行。

### S-1（scope 观察，非阻断）：package.json version 0.1.3→0.1.4

- `packages/namespace-registry/package.json` patch 版本 bump 不在设计决策总表（D-1..D-13）与任何 AC 内。考虑到本切片含契约变更（create 输入四键→三键、新增必需注入键），对 private 包做版本 bump 属惯例、无副作用，登记为轻微 scope 观察，不要求回流。

### B-0（疑似错误行为）：无

- 运行时代码未发现疑似错误行为。重点复核面：重试预算边界（retry∈[0,8]→恰 9 次生成）、耗尽分支 committed:false 结构必然性（任何 createDoc 成功即登记返回，结构性不带 committed 事实进耗尽分支）、shutdown 屏障（admittedCreates 同步注册/恒绿 tracked 尾/关门后只减不增）、每候选 carrier FIFO 的 check-then-register 原子性、observer `create-id-generation-failed` 恰一次三发射点、open closing recheck 同谓词零泄露——均与设计 R2 §4 逐字一致并被测试锚定。

### 范围 contained 确认

- 变更未溢出声明半径：无其他包、无 CI/根配置、无 apps/domains 改动；observer 事件新增（D-12）、`RegistryRandomBytes` 类型导出、create-document prepare/build 拆分（D-8）、shutdown 编排等待（D-9）均为接受设计的在册决策。

## Conclusion: blocking

**阻断项（唯一，属 AC-7 部分满足）**：

1. 面向消费者文档三处旧契约文案需对齐 ADR 0010 词汇后方可判 AC-7 满足：
   - `packages/namespace-registry/README.md:3`（唯一性保证维度改为 per namespaceId）；
   - `packages/namespace-registry/README.md:33`（移除/限定 `NAMESPACE_ALREADY_EXISTS` 为普通 open/create 预期失败的表述）；
   - `docs/integration/cordis-plugin-hosting.md:117-126`（create 示例三键化，删除 `namespaceId: 'notes'`）。

AC-1..AC-6 全部满足且证据充分（含独立复跑 1431/1431 全绿、零类型错误、Persistence 零改动实证）；S-1 版本 bump 为非阻断观察。文档三处修正落地后，本轴可直接转 clear，无需重跑行为面验证。
