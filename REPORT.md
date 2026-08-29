---
status: complete
run_id: issue-149-1787977374-4073122
branch: fix/issue-149-on-docs-namespace-diagnostic-change-log
round: 1
---

# Issue #149 — Record ROOT mutations and SCHEMA replacements

## 变更摘要

本轮将 `NamespaceRuntime` 的 ROOT mutation 与 SCHEMA replacement 接入 namespace diagnostic change log，同时保持原有业务返回、写入 sequencer、dirty notification、capability 状态和 hostile-input 访问纪律不变。

- `96cd085` — 接入 runtime seam（可选 diagnostic emitter/clock）、ROOT/SCHEMA 各结局路径的稳定诊断记录、事务级 owned Yjs update bytes 捕获，以及 14 项红灯契约。
- `874cc10` — 增加 16 项 SA7 动态验证，并修复测试文件的 TypeScript 收窄问题，确保 CI 的测试文件类型检查可通过。
- `942ac31` — 收尾修复：将 DV-2 的贴界时间断言改为稳定的无自旋量级断言，并将 `@nomicore/namespace-runtime` 从 `0.1.7` 提升至 `0.1.8`。
- 本收尾档案 commit — AC 核对表、standards/spec 双轴终审档案、dispatch 终态和本 REPORT.md。

实现记录覆盖 committed、no-op/rejected、fatal-before-commit、fatal-after-commit、queue-full、logger/sink failure，以及 Proxy/accessor 输入；事务 effect 使用同源基态加连续增量链进行诊断性重放，且测试保留“空文档不得物化真实增量”的反向鉴别，避免整文档编码冒充事务更新。

## 验证证据

- SA6 红灯契约：14/14 通过；覆盖 ROOT/SCHEMA 诊断路径、owned bytes、fault isolation 和 hostile-input 访问纪律。
- SA7 动态补充：16/16 通过；覆盖慢 emitter 的槽间时序、acceptance 同步发射、unhandled rejection 抑制、未钉死路径、queue-full/full input policy 等。
- 双轴终审：standards **pass**（R2 闭合 DV-2 不稳定断言及 patch version blocker）；spec **pass**（AC1–AC5 独立核验通过）。
- 测试文件类型检查：`npx tsc -p tsconfig.typecheck.json`，0 errors。
- `pnpm typecheck`：exit 0。
- 修复后独立 spec 审查的全仓 `vitest run --typecheck`：142 files / **1816 tests 全部通过**，Type Errors no errors。
- standards R2 复验：DV-2 隔离 3/3 通过，之后两次全量复验中 #149 的 red 14/14、SA7 16/16 均通过，Type Errors no errors；`pnpm install --frozen-lockfile` exit 0。

历史上 `pnpm test` 曾在满载环境以非零退出：早期包含 DV-2 的 20ms 贴界断言（现已修复），其余为未触及包的 `generate-cli-check` / `dsh-probe-cli` spawn 超时以及 vitest-worker RPC timeout 环境伪影。最终双轴复验将这些与 #149 分离：#149 测试、类型检查和全仓成功复验均已通过；残余负载工件不属于本次 diff。DV-2 的对照断言已由 `<20ms` 改为 `<100ms`，同时保留慢 emitter 的 `>=25ms` 同步发射下界，因此避免宿主机调度抖动而不删除行为验证。

## 遗留风险

1. 发布后 CI run 级的触发日志（SA7 DV-5）只能在 Host push/PR 后取得；本地完成事务不宣称 CI 已绿。
2. 本地全仓并发运行仍可能出现未触及 #149 包的 spawn/RPC 负载超时；其隔离复跑可通过，且双轴审查将其登记为环境问题而非本任务回归。
3. `engineering/code-review` skill 加载被运行时拒绝（`invalid skill name`），无法在本控制器权限内修复 catalog/目录映射。替代措施是并行独立 standards 终审（SA4）与 issue/AC spec 终审（SA2），两轴均基于 `eaf0484..942ac31` 和可复核运行证据给出 pass。
4. 未覆盖的扩展行为（个别 no-op 和边缘 fatal 枚举点）已被 SA4/SA2 标为后续增强测试项；25 个生产结局点已静态逐项核对，当前 AC 门槛已满足。

本 REPORT.md 仅表示本地 MABF 验收已完成；未执行 push、PR、标签、`.mabf-done` 或其他 Host 生命周期操作。
