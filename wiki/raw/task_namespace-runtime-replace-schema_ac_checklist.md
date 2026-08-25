# AC 验收清单 — namespace-runtime：原子 SCHEMA replacement 与 ROOT generation（issue #91）

> **SUPERSEDED（已取代）**：这是 round 1 验收记录；AC3 所述静默顶层投影已废止。当前验收结论见 `task_namespace-runtime-replace-schema-rev1_ac_checklist.md`，provided root 未声明键必须响亮失败且零写入。

总控逐条核对（2026-08-24，Phase 4 收尾门禁）。证据锚：SA6 冻结测试（15+1 红灯 → 全绿）、SA7 补锚（9 用例）、总控亲跑四闸口、SA4/SA7 verdict 双 pass。

| AC | 要求 | 判定 | 证据 |
|---|---|---|---|
| AC1 | replaceSchema 与 mutateRoot 共享唯一 write sequencer，但不依赖当前 schema 编译成功 | ✅ | 冻结用例「共享 sequencer 严格 FIFO 双向」（sequencer.test.ts：mutateRoot 占槽 notifier 挂住 → replaceSchema 排队；反向互证）；schema-write.ts 零 schemaState 门（SA4 grep 红线零命中）；S4' 编译不读 activeTools |
| AC2 | 未提供 root 时按 proposed derived 严格提取并验证当前 ROOT，载体或逻辑不兼容则零写入失败 | ✅ | 冻结用例「载体不兼容（string[] vs plain string）/逻辑不兼容（缺必填 b）→ ok:false 零写入、active tools 不变」；实现 = extractYjsSnapshot + validateLogicalSnapshot（schema-replace.ts ①d keep-root 分支） |
| AC3 | 提供 root 时视为完整最终 logical ROOT，验证与 detached 构造后整体替换 | ✅ | 冻结用例「提供 root 幸福路径」+ projectDeclaredRootKeys→validate→buildTopEntries 管线；锚 15（含未声明顶层键 b → 顶层投影后 ok:true）经 SA2/SA4/SA7 三方实证 |
| AC4 | SCHEMA 顶层 Y.Map，transaction 内 clear 后恰写 lang/version/id/text 四键 | ✅ | 冻结断言「恰四键」+ schema-replace.ts ② 单事务 clear+恰四次 set + ③ verifySchemaFourKeys（size+逐键同一性双断言）写后校验 |
| AC5 | SCHEMA 与必要 ROOT 变化一次 transaction 原子提交，顶层 ROOT Y.Map identity 保持 | ✅ | SA2/SA4 实测：单事务 → 恰 1 次 Y.Doc update、双顶层 Y.Map identity toBe 同一实例；冻结用例「顶层 ROOT identity 保持」 |
| AC6 | transaction 成功后立即安装新 active schema tools，再 await dirty notifier | ✅ | 冻结用例「notifier 挂住窗口内 getActiveSchema 已切换新 id」；schema-write.ts installActive(:179) 先于 await notify(:182)（SA4 行号核验） |
| AC7 | 编译、验证或构造失败时 SCHEMA/ROOT/active tools 均不变 | ✅ | 冻结用例「proposed 编译失败 / 逻辑校验失败零写入」（0 更新事件、0 notifier、state 字节不变、getActiveSchema 不变）；失败全部发生于 transaction 前 |
| AC8 | P0 schema-unavailable 后可由合法 replaceSchema 恢复 ROOT write；persistence-degraded 或 prior fatal 仍拒绝 | ✅ | 冻结用例「P0 unavailable → replaceSchema 合法恢复 → mutateRoot 恢复」+ Persistence 集成用例 2（真实非法 SCHEMA 文本 → unavailable → 恢复全链）；「degraded/prior fatal → RUNTIME_WRITE_DISABLED、输入零访问（Proxy）、零写入」 |
| AC9 | 准备期间 read/getSchemaEnvelope/getActiveSchema 继续观察旧 committed generation | ✅ | 冻结用例排队窗口三读面旧 generation 断言 + SA7 AC9 时序实证（挂住窗口旧 generation、放行后同步切换） |
| AC10 | 独立窄结果联合 + 确定性/集成测试 + 全量 typecheck/test + Node 20/24 CI | ✅ | ReplaceSchemaResult/SchemaReplacementIssue 独立窄联合（不复用 RootMutationIssue）；确定性 seam 13 用例 + SA7 补锚 9 用例 + 真实 Persistence 集成 2 用例；总控亲跑全量 84 文件 1078 用例全绿 + typecheck 七包 + 聚合 tsc exit 全 0（.mabf-bg/verify-final.log）；CI yml Test=pnpm test Node 20/24 矩阵（SA4 §5 核验，CI 运行属 publish 阶段） |

**结论：AC 10/10 全过。SA4 verdict: pass + SA7 verdict: pass 双清。**
