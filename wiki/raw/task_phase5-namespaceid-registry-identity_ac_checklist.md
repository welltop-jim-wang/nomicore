# AC 逐条核对表 — issue #131（Phase 5: generate namespaceId and migrate Registry identity）

核对时间：2026-08-27 12:10；核对基线：980b16a..HEAD（b21de27 + b0962e9 + wiki commits）。

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC-1 | Ordinary create 由注入 128-bit CSPRNG 生成 `ns-`+32 小写 hex，不接受调用方 namespaceId | ✅ | red.test.ts AC-1 用例（三键成功生成、`^ns-[0-9a-f]{32}$` 实锚、四键→NAMESPACE_CREATE_INVALID_INPUT 零随机消耗、缺 randomBytes→构造期 TypeError）；surface.test-d.ts 类型锚（CreateNamespaceInput 无 namespaceId、双选项类型含 randomBytes）；SA7 D1/D3 真实 node:crypto 链路格式 + 100 create 全唯一 + 60k 抽样 0 重复 | 无需处理 |
| AC-2 | 碰撞（active/idle/closing entry 或 target-owner Persistence duplicate）重生成重试至多 8 次；耗尽 committed:false Registry fatal | ✅ | red.test.ts AC-2 用例（active 碰撞恰 3 次生成、entry 耗尽恰 9 次生成后 reject NamespaceRegistryFatalError phase=namespace-id-generation committed:false、Persistence duplicate 耗尽 dupAttempts∈[9,10]）；SA4 核实 MAX_NAMESPACE_ID_RETRIES=8、closing 死路径删除 | 无需处理 |
| AC-3 | Registry lifecycle 序列化与 Runtime 复用仅按 namespaceId 键控 | ✅ | identity.ts key=namespaceId（commit b21de27）；red.test.ts entry-key 用例（同 nsId 第二 owner→NOT_FOUND、零 loadDoc、零新 Runtime）；锚 C 同候选并发 per-ID 恰 1 Runtime、createDoc [X,Y] FIFO；registry-idle/open 迁移后全绿 | 无需处理 |
| AC-4 | Open/create 仍校验并投影 owner；owner mismatch 返回既有 not-found 不暴露他人 namespace | ✅ | red.test.ts owner-mismatch 用例（mismatch→NAMESPACE_NOT_FOUND 常量、零 loadDoc、零新 Runtime、跨分区零暴露；非法 owner→NAMESPACE_INVALID_IDENTITY field=owner.userId）；SA7 D2 跨 owner NOT_FOUND 实测 | 无需处理 |
| AC-5 | Persistence 继续按 owner 分区，不增加跨 owner catalog | ✅ | `git diff 980b16a..HEAD -- packages/persistence` 为空（零改动）；surface.test-d.ts 守卫（DocPersistence 无 catalog API）保持绿；SA7 D2 真实 File Persistence round-trip 按 `users/<owner>/<nsId>.snapshot` 落盘恢复 | 无需处理 |
| AC-6 | Memory/File/Registry contract 测试覆盖 generation、retry exhaustion、owner mismatch、concurrency、shutdown、public-surface 兼容 | ✅ | red.test.ts 20 用例（含锚 A shutdown×重试、锚 B1-B3 违约 fatal、锚 C 并发）；registry-sa7-phase5-dynamic.test.ts 4 用例（D1-D4）；registry-persistence-contract / registry-surface（9/2 export 冻结）等既有套件迁移后全绿；总控亲验 pnpm test 1427/1427 + SA7 复跑 1431/1431 | 无需处理 |
| AC-7 | ADR 0006/0009 implementation-facing docs 与 package contracts 对齐 ADR 0010 词汇 | ⚠️→修复中 | ADR 0009 §132 修订节（issue #131）；ADR 0006 §201 对齐说明；CONTEXT.md 113-115 行 namespaceId 词条已对齐。**终审发现 README:3/:33 与 cordis-plugin-hosting.md 示例三处旧契约残留（首轮核对声称「README 已对齐」不实，特记），已回流 SA3 修复，修复后复核** | SA3 终审修复轮 R1 |

**结论：AC-1..AC-6 ✅；AC-7 首轮 ⚠️（README/hosting guide 三处残留，终审 blocking），SA3 修复 + 双轴复审转 clear 后方可封口。**
