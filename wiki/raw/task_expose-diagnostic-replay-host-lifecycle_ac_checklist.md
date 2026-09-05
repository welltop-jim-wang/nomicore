# Acceptance Criteria Checklist — Issue #155

| AC# | 描述 | 状态(✅/❌) | 证据 | 处理 |
|---|---|---|---|---|
| AC1 | Host/Registry 本地启用日志且不写入业务数据面、持久化或复制 wire state | ✅ | SA6 acceptance E1/E4/E5；SA7 Step 1 22/22 green、Step 2 focus 4/5；SA7 report lines 23–25, 74–78 | 已验证 |
| AC2 | 格式策略切代，非格式策略不改变记录解释 | ✅ | SA6 contract R10；SA4 design-consistency review §5.2/§5.6；SA7 root suite 259 files/2854 tests green | 已验证 |
| AC3 | 多 Runtime generation 单 writer，shutdown 有界 best-effort drain | ✅ | SA6 E3/E5；SA7 process lifecycle evidence including SIGTERM exit 0 and diagnostics-closed event | 已验证 |
| AC4 | 严格 replay、有效 genesis/连续 committed updates、owned bytes、无 live Y.Doc 或自动跨 generation 拼接 | ✅ | SA6 R1/R2/R10; SA4 §5.6; SA7 C1 replay complete and detached snapshot evidence | 已验证 |
| AC5 | complete/partial/failed 三态对缺 genesis、omitted、retention、gap、corruption、identity、format 等诚实报告 | ✅ | SA6 R3–R11; SA7 M2 adversarial check (failed + genesis-misplaced/genesis-missing); full root suite green | 已验证 |
| AC6 | E2E 覆盖 create、ROOT/SCHEMA、replication、restart、retention、logging failure、Host shutdown 与 replay 三态 | ✅ | SA6 E1–E5 + R suite 22/22 green; SA7 six dynamic checks and added 6/6 adversarial tests; `pnpm test` 259 files/2854 tests green | 已验证 |

## Gate conclusion

All six acceptance criteria are satisfied by executable tests and independent SA4/SA7 evidence. CI run-log extraction is unavailable before publication because no branch has been pushed and no PR/CI run exists; this does not alter local acceptance status and is explicitly delegated to issue-runner publication/CI handling.
