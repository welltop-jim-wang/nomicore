---
status: complete
run_id: issue-175-1788032871-4073122
branch: fix/issue-175-on-fix-issue-138-on-docs-phase-5-websocket-
round: 1
---

# Issue #175 — 主动 reauthentication 生命周期

## 概要

完成 Hub 主动 reauthentication 生命周期：认证 Adapter 可通过窄公共入口按认证实例触发 `GOAWAY(REAUTH_REQUIRED)`；旧 transport 在 drain deadline 后以 WS 1001 收口；Peer 进入 blocked，且仅在显式 token/config 变化通知后重拨恢复。

## 变更

- 新增 `HubReplication.requestReauth(instanceIdentity)` 与 `PeerReplication.notifyAuthChanged()` 公共 API。
- Hub 按 `authenticatedInstanceId` 定向 reauth，使用 `closeTimeoutMs` 作为正值 drain 预算，并在 deadline 后关闭；重复、迟到、Hub close 与 transport close 竞态均幂等收敛。
- Peer 对 blocked 类 GOAWAY 的正 drain 启用 receiver-side deadline；`notifyAuthChanged()` 仅在 blocked 状态复用既有 rebuild/dial 编排。
- `@nomicore/ws-replication` 版本从 `0.1.2` 升至 `0.1.3`。
- 新增/归档 SA6 验收契约、SA7 六项动态验证、完整 MABF 设计/审查/AC 档案。

## 验证

已由独立阶段完成并记录：

- SA6 红灯基线：6 failed / 0 passed（修复前）；实现后 6/6 通过。
- SA4 独立静态审查：R2 `Verdict: pass`。
- SA7 动态验证：`Verdict: pass`；六项重点通过；包全量 `26 files / 187 tests passed`，typecheck 无错误。
- 双轴终审：规范轴与 Issue/AC 轴均 `Verdict: pass`；各自独立聚焦验证 12/12 通过。
- 最终后台本地验证：`npx vitest run packages/ws-replication/test/ --typecheck`（完整日志：`.mabf-bg/issue-175-final.log`；退出码：`.mabf-bg/issue-175-final.exit`）。

## 最终验证 HEAD

最终业务 HEAD 应包含：

- `0d80a36 fix(ws-replication): Hub 主动 reauth 生命周期实现（issue #175）`
- `6c7d9cf chore(ws-replication): version bump 0.1.2 → 0.1.3（issue #175 治理修复，SA4 HG9）`
- 本次归档提交（SA7 动态测试与全部 `wiki/raw` 任务档案）。

## 遗留风险

- 本地验证、静态审查、动态验证和双轴终审均通过。
- 尚无远程 CI 运行证据，因为本地完成事务之前禁止 push/创建 PR；发布后由 Host 负责推送、PR 创建与 CI 观察。
