# AC 逐条确认门禁 — Phase 5: bootstrap import, archive, and guarded replica reset（round=2 修订轮）

- **Issue**: #133；**round**: 2；**基线**: 6784645（round-1 close-out）→ HEAD
- **门禁时间**: 2026-08-28 07:42+（注册总控逐条核对）

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| R2-AC-1 | resetReplica 在任何破坏性动作前完成 live+persisted 双源身份核对；不匹配零破坏（generation/lease/runtime 保持可用） | ✅ | 设计 §3.4/§3.5（reset-fence 二段协议）；实现 registry.ts fence 编排 + runtime.ts beginResetFence；测试 `registry-phase5-bootstrap-reset-r2-red.test.ts` describe@L356（3 用例：lineage 不符/epoch 不符/disabled——拒绝 + lease active + lifecycle ready + 零 archive）；SA4 验尸 §一关注项与红线表；SA7 动态 53 用例全绿 | SA3 实现 + SA4/SA7 双清 |
| R2-AC-2 | dirty identity/epoch 未 flush 竞态测试：不得关闭/归档错误 generation | ✅ | `registry-phase5-bootstrap-reset-r2-red.test.ts` describe@L451：竞态 A（expected=persisted 旧/live 已 bump，L504）与竞态 B（expected=live 新/persisted 旧，L534）——真实 MemoryPersistence + hook store 字节级 decode 断言 persisted 仍旧值、无强制 flush、零破坏；SA4 红线 5 采信为「真实字节级」；口径裁决（严格双源直读）冻结于设计 §2 R2-D2 与 ADR 0010 修订 §4 | SA6 锚定 + SA3 实现 |
| R2-AC-3 | importReplica 绑定 Hub 广告 expected {replicationId, replicationEpoch}，ownership 转移前完全一致核对 | ✅ | registry.ts:1875-1878 入口零副作用快照 + runImportSlot ②c（格式核对之后、importDoc resolve 之前 exact equality）；新码 NAMESPACE_IMPORT_EXPECTED_IDENTITY_MISMATCH / _INVALID（append-only）；ADR 0010 修订 §3；SA8 双轮 clear；SA4 关注项核实 | SA1 设计冻结 + SA3 实现 |
| R2-AC-4 | 「格式正确但 lineage 或 epoch 错误」拒绝测试：零持久化写入、零 entry 登记 | ✅ | r2-red describe@L566（L567 lineage 不符 / L589 epoch 不符 / L610 真实 Memory store 零残留 + 正确重试成功）；internal 测试 @L462 敌意 expected 16 形态（零 doc 访问/零 importDoc/零 entry）；R-FIX-1 修复后 reset 侧同矩阵（NAMESPACE_INVALID_IDENTITY + probeCalls 空分界锚） | SA6 锚定 + SA3 实现 + SA4 增量复审 pass |
| R2-AC-5 | 修订 ADR 0006/0010 正式记录新生命周期契约 | ✅ | `git diff 6784645..HEAD docs/adr/`：0006 +12 行（importDoc 排他创建/archiveDoc 守卫与 committed 三分类/归档布局与原子语义 tmp→rename latest-wins/只读 committed-identity probe 契约）；0010 +14 行（reset 严格前置双源核对次序取代旧描述/fence 无自等待协议/import 绑定 Hub 广告身份/dirty 诚实表达/归档 committed 诚实与 armed 后矩阵）；append-only 修订段体例经 SA8 前置+R2/R3-delta 三轮复审 clear | SA3 按设计 §5 文案落地 |
| R2-AC-6 | 既有 1711 基线零回归 + 新增全绿 + typecheck 零错 + diff --check 干净 | ✅ | 注册总控亲跑（后台独立进程）：`pnpm typecheck` exit 0；`pnpm test` 全量 147 文件/1757 用例全绿 exit 0（.mabf-bg/r2-fix-verify.log；1757 = 1711 基线 + 46 净增，零回归）；`git diff --check 6784645..HEAD` exit 0；SA7 复跑同结论 + 核心集 3 连跑零 flake | 总控亲验 + SA7 复证 |

**门禁结论**：R2-AC-1..6 全部 ✅，无 ❌ 条目，无需追加 SA 派发。进入第四阶段收尾（双轴终审 → 封口终验 → REPORT.md）。

**更正记录（双轴终审规格轴 B-1 处置）**：本表 R2-AC-6 的 `git diff --check` 证据测量于 commit 009c697（当时 exit 0）；随后 SA7 报告提交（24db0fa）重新引入 4 行行尾空白，HEAD 处实测 exit 2——规格轴终审发现属实。处置：清理 `task_phase5-bootstrap-archive-reset-r2_sa7_report.md` 行尾空白（本轮第三次同类清理，前两次 de446f9/009c697），封口终验重跑确认 exit 0（见 dispatch log 与 REPORT.md 验证节）。本更正由注册总控执行（wiki 档案域），不改变任何 AC 的实质结论。
