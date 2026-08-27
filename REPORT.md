---
status: complete
run_id: issue-131-1787792522-3529662
branch: fix/issue-131-on-docs-phase-5-websocket-replication
round: 1
---

# Phase 5: generate namespaceId and migrate Registry identity（issue #131）

## 概要（需求理解）

将 namespaceId 变为进程内 Registry entry 的唯一身份（entry key 由 `(owner.userId, namespaceId)` 复合键迁移为仅 namespaceId），owner 保留为 create/open 的必需本地属性与 Persistence 分区键；普通 create 不再接受调用方 namespaceId，改由注入的受控 128-bit CSPRNG 生成 `ns-`+32 位小写 hex 的概率全局唯一 ID；碰撞（active/idle/closing entry 或 target-owner Persistence duplicate）重生成重试至多 8 次，耗尽以 `committed:false` Registry fatal（新 phase `namespace-id-generation`）失败。该实现票直接落在 ADR 0010「Namespace identity、owner 与复制范围」对 ADR 0009 的显式修订内（SA8 前置门禁 verdict: clear）。

## 流水线与门禁记录

- 任务类型：功能开发；流程 SA8→SA6→SA1→SA8(设计复审)→SA2→SA3→SA4→SA7→AC 门禁→双轴终审→收尾。
- SA8 前置门禁：clear；SA8 设计复审：clear。
- SA6 红灯锚定：20 运行时 + 5 类型锚全部基线红（真实可复现），四轮回流修正 fixture（registryB 缺随机源、as never cast、锚 A/B/C 回补、consumed getter 解构缺陷）。
- SA1 设计 R2 经 SA2 攻击评审（R1 reject 四点 → R2 pass）定稿（D-1..D-13）。
- SA3 实现 commit b21de27；SA4 静态验尸 pass；SA7 动态验证 pass（dispatch log verdict 与 review 文件一致，硬门禁 #12 自检通过）。
- AC 门禁：7/7 ✅（wiki/raw/task_phase5-namespaceid-registry-identity_ac_checklist.md）。
- 双轴终审（diff 980b16a..HEAD）：首轮 Standards/Spec 均 blocking（AC-7 消费者文档三处旧契约残留）→ SA3 修复轮 67da92d → R2 双轴均 Conclusion: clear。

## 变更（文件级，基线 980b16a → HEAD b4ad317，共 8 commits；REPORT.md 为后续 housekeeping 入库）

**packages/namespace-registry（0.1.3 → 0.1.4）**
- `src/types.ts`：`RegistryRandomBytes` 必需注入键（双选项类型）、CreateNamespaceInput 三键化、新 phase/message 常量、接口级 JSDoc 更新
- `src/identity.ts`：entry key = namespaceId 本体（复合键退役）、validateOwnerIdentity 抽出、acceptCreateIdentity owner-only（namespaceId 键出现即拒）
- `src/registry.ts`：随机源构造门禁、ns-+32hex 生成编排（≤8 重试 / 耗尽 fatal）、attempt slot 经 carrier FIFO、open owner 核对 mismatch→NOT_FOUND、admittedCreates shutdown 屏障、ALREADY_EXISTS 产出点删除
- `src/create-document.ts`：prepare/build 拆分；`src/observer.ts`：`create-id-generation-failed` 事件；`src/plugin.ts`：node:crypto 生产桥接；`src/testing.ts`/`src/index.ts`：注入面与类型导出
- 测试：新增 `registry-phase5-identity-red.test.ts`（20 例）、`registry-phase5-identity-surface.test-d.ts`（5 类型锚）、`registry-sa7-phase5-dynamic.test.ts`（D1-D4）；迁移既有 11 个测试文件至三键契约（registry-create/idle/open/shutdown/node-dispose/persistence-contract/plugin/sa7-{concurrency,hostile,rev1,cordis}）
- `README.md`：per-namespaceId 保证句与错误列举对齐

**文档**：`docs/adr/0009` 追加 issue #131 修订节；`docs/adr/0006` 追加对齐说明；`docs/integration/cordis-plugin-hosting.md` 示例三键化与重开/错误叙述更新；CONTEXT.md 已对齐（零改动）。

**Persistence/namespace-runtime/doc-runtime/vfsl 等其余包：零改动**（AC-5）。

**wiki/raw/**：任务简报、relevant_decisions、conflict_report、design(R2)、design_conflict_report、sa2_review、sa6_red、sa4_review、sa7_report、ac_checklist、standards_review、spec_review、dispatch log 全部入库。

## 验证（总控亲跑，后台独立进程，日志于 .mabf-bg/）

- 终验 @ HEAD b4ad317：`pnpm test` → **Test Files 121 passed (121)，Tests 1431 passed (1431)，Type Errors: no errors，exit 0**；`npx tsc -p tsconfig.typecheck.json --noEmit` → **exit 0**
- 红灯套件 20/20 转绿；类型锚 3 红转绿 + 2 绿守卫保持；registry-surface 9/2 export 冻结面保持
- SA7 动态实测：真实 node:crypto 链路 `^ns-[0-9a-f]{32}$`、真实 File Persistence round-trip、CSPRNG 60k 抽样 0 重复、锚 A 真实调度 12 迭代屏障零违例；全仓 1431/1431 两次连跑
- 首次终验日志曾被并发双跑污染（两个 vitest 进程写同一 log），已清理后单跑重验，上文数据为干净单次结果

## 遗留风险（非阻断）

1. `NAMESPACE_ALREADY_EXISTS` 保留在公共 issue 联合中（普通 create 不可达），留给切片 2 受信任导入使用；README 已注明定位。
2. SA7 D3 为统计性 CSPRNG 抽样测试（60k），理论 flake ~5e-7，注释已披露（Standards J-4，双轴认可非阻断）。
3. phase-5 切片 1 的 replicationId/replicationEpoch 与 Hub 管理操作（enableReplication/bumpReplicationEpoch）不在本任务 AC 内，属后续切片（SA8 留档观察）。
4. ADR 0009 状态行未标注「Registry identity 条款由 ADR 0010 修订」——文档卫生项，属 owner 文档决策（SA8 留档）。
5. SA2 R2 留档 LOW：设计 §7 普查计数标注 33 处实枚举 16 处（枚举逐行完整，以清单为准，不影响正确性）。
