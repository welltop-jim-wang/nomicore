# Acceptance Criteria Checklist — Issue #140

| AC# | 描述 | 状态(✅/❌) | 证据 | 处理 |
|---|---|---|---|---|
| AC1 | Hub 与两个 Peer 的并发 ROOT 写入在两种 persistence adapter 上收敛 | ✅ | SA6 `phase5-three-instance-acceptance-red.test.ts` 的 Memory/File 三实例收敛绿锁；SA7 R2 app suite 47/47 | 已由 SA6/SA7 动态验证 |
| AC2 | 断连写入、缺席 Peer bootstrap 与 bootstrap-race repair 成功 | ✅ | SA6 锚定报告及 SA7 R2 动态回归：重引导与 bootstrap-imported 收敛证据 | 已由 SA6/SA7 验证 |
| AC3 | lineage/epoch、保护字段、schema 传播、epoch fence、guarded reset/archive 符合契约 | ✅ | SA6 6/6；SA7 R2 验证 replace-schema、bump-epoch、reset-replica、两轮 fence/reset 及终态 add-target 重建 | app 控制面与回归锚已落实 |
| AC4 | degraded/retry/stale snapshot/diff recovery 在两种 adapter 上通过 | ✅ | SA6 绿锁和 SA7 R1 File adapter reset/restart 全周期实证；既有 app suite 47/47 | SA7 报告记录 |
| AC5 | 限流、异常帧、auth/authz/revocation、日志、drain 保持隔离确定 | ✅ | 既有 Phase 5 app suite 与 SA7 动态回归均绿；本次改动不改变该类协议路径，SA4 scope/regr. review pass | SA4 R4 + SA7 R2 |
| AC6 | FilePersistence 独立 roots、进程重启、archive/reset/crash recovery | ✅ | SA6 File convergence 与 crash/restart 绿锁；SA7 File reset/archive/restart 实证 | SA6/SA7 报告 |
| AC7 | 公共导出、稳定错误、文档、ADR/protocol/context/config/hosting guidance 一致 | ✅ | SA4 R2/R3 设计与部署文档一致性审查；本次稳定错误与 `hub-peer-deployment.md` 已同步，ADR/protocol/CONTEXT 不需改动 | SA4 pass |
| AC8 | typecheck、完整测试、aggregate no-emit、diff checks、Node matrix、Standards/Spec final review | ✅（本地范围） | `pnpm typecheck` exit 0；SA7 R2 app suite 47/47；SA4 R4 Standards 静态审查 pass；CI/Node matrix 运行证据待 Host 发布后取得 | 本地门禁通过；CI 证据作为遗留风险 |

## 结论

所有可在本地验证的 AC 均有 SA6/SA7 动态证据与 SA4 静态审查证据。CI/支持 Node 矩阵的运行日志须在 Host 推送并创建 PR 后补充，不阻塞本地 MABF 完成事务。
