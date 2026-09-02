# Issue #170 Acceptance Criteria Checklist

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC1 | Replacement ready 后，旧连接 pong timeout 不影响新 state/sequence/backoff/namespaces | ✅ | SA7 §一 P4：旧代 pong 注入后新连接状态/namespace 零扰动、`dialCount===2`、收敛 n=77；`task_issue-170-ping-pong-epoch-safety_sa7_report.md` L39 | 已验证 |
| AC2 | timeout-to-backoff 同步栈内关闭旧 transport 并解绑 listener/liveness | ✅ | SA7 §一 P4：三监听为 0、closed transport 零 ping/错误；SA4 §二 teardown 静态复核 | 已验证 |
| AC3 | Hub timeout close/error 符合协议 | ✅ | SA7 §一 H1：close 1001、零 `PONG_TIMEOUT` ERROR、peer backoff；SA4 协议四锚点复核 | 已验证 |
| AC4 | delayed/duplicate/unsolicited/old-epoch pong 的确定性测试 | ✅ | SA6 红灯契约 P1–P4，SA7 复跑 6/6 pass；报告 L35-L40 | 已验证 |
| AC5 | real/fake transport reconnect 后 hub 仅保留新连接、数据收敛 | ✅ | SA7 §三：fake H1/P4 及真实 TCP 适配器两测试均确认 `hub.connections===1` 与 n=99/n=77 收敛 | 已验证 |
| AC6 | `pnpm run typecheck`、`pnpm exec vitest run packages/ws-replication --typecheck`、`git diff --check` 通过 | ✅ | SA7 §二：typecheck exit 0；25 files/164 tests/type errors none；diff check exit 0 | 已验证 |
