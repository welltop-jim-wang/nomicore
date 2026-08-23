# AC 逐条确认门禁 — doc-runtime：committed-aware transaction fatal 契约（issue #87）

- 核对时间：2026-08-23 17:56（SA4 R2 pass + SA7 pass 双清后）
- 核对依据：TASK.md Acceptance criteria（与 issue #87 body 逐字一致）
- 本地验证基线：总控亲跑 `pnpm typecheck` exit 0（六包）；`pnpm test` 69 文件 / 957 用例全绿（含 doc-runtime 18 文件 / 245 用例）

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC-1 | 提供稳定 branded fatal error，至少包含 committed 与稳定 phase | ✅ | `packages/doc-runtime/src/fatal.ts` `DocRuntimeFatalError`（committed + phase 字段，经 index.ts 公共导出）；phase 取值集 v1 冻结三相（设计 §3.2）；红灯锚 `transaction-fatal-materialize-contract.test.ts` describe AC-1（导出面 + 构造器存在 + 不导出 RuntimeWriteFatalError）；SA2 R3 / SA4 R2 复核通过 | 已交付 |
| AC-2 | observer cleanup throw、post-transaction verification 与明确 pre-commit internal failure 可被准确区分 | ✅ | 三相 phase：`'observer-cleanup-throw'`（E203，committed:true）/ `'post-commit-verification'`（E201，committed:true）/ `'pre-commit-internal'`（E204，committed:false）；红灯锚「三相 phase 两两互异」「同场景两次触发 phase 相同（稳定）」用例全绿 | 已交付 |
| AC-3 | 普通 logical/path/materialization/mutation 失败继续使用领域结果联合，不进入 fatal 通道 | ✅ | AC-3 护栏 3 用例（logical 失败 ok:false+issues 未 throw / materialization ROOT 非空单 issue / path 领域失败联合）+ apply 文件「ROOT 已损坏 → ok:false 领域联合非 fatal」用例全绿；E100/E200（类 B/C）/E202/E205 留守领域面（设计 §4 拆分裁决）；SA4 伪造 branded 重放确认敌意数据落 E205/E100 域联合不升格 fatal | 已交付 |
| AC-4 | committed fatal 不执行补偿写、不 fallback、不声称 rollback | ✅ | 红灯锚：observer delete/insert/覆写/嵌套偏离四变体均断言「Y.Doc 保持 observer 留下状态（无补偿写、不恢复安装值）」；observer 抛错用例断言「update 已发出、值已落盘（不虚假回滚）」；message 负面锚（无 rollback 声称措辞）；SA7 动态复核一致 | 已交付 |
| AC-5 | 未识别 transaction 异常采用保守语义并有回归测试 | ✅ | AC-5 用例：observer 抛非 Error 值（string）→ committed 保守 true 不降格；回归锚「同一未识别场景重复触发 committed 恒 true」；transactGuarded 无条件包装（全库零 instanceof 透传，SA4 grep 实证） | 已交付 |
| AC-6 | materializeRoot 与 applyValidatedMutation 的相关测试覆盖 exact error identity、commit 状态和 Y.Doc 最终状态 | ✅ | materialize 侧：16 用例覆盖 exact identity（constructor.name/instances 同一）、committed 状态、Y.Doc 最终状态（state 字节不变/值保留）；apply 侧：`apply-validated-mutation-fatal-contract.test.ts` 4 用例（同一构造器 exact identity / committed:true / Y.Doc 保持提交后状态）；SA4 复现锚 nested-path-repro 2 用例 + SA7 动态锚 8 用例补强 | 已交付 |
| AC-7 | 全量 typecheck/test 和 Node 20/24 CI 通过 | ✅（本地全绿；CI 矩阵腿 = 发布后 runner 面） | 总控亲跑：`pnpm typecheck` exit 0（六包 tsc）；`pnpm test` 69 文件 / 957 用例全绿、Type Errors no errors（.mabf-bg/final-verify 日志）；本机 Node v24.13.0 覆盖 24 腿 | Node 20/24 CI 矩阵不属于本地 MABF 完成门槛（SKILL §第四阶段边界）：分支 push/PR/CI 轮询由 issue-runner check.sh + ci-watch 接管；SA7 报告已如实登记补录命令（未伪造 CI 证据） |

**结论**：7/7 条目本地完成面全部 ✅（AC-7 的 CI 矩阵腿按职责边界移交 runner，非缺陷、不阻塞本地完成事务）。无 ❌ 条目，无需派修订轮。进入 Phase 4 收尾。
