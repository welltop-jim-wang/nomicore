# AC 逐条确认门禁 — namespace-runtime：Runtime 骨架、同步读取与队首 P0 (issue #89)

- run_id: issue-89-1787497173-442625
- 核对时间: 2026-08-24 02:0x（Phase 3.5，SA4 R2 终审 pass + SA7 pass 之后）
- AC 来源: issue #89 body / TASK.md（9 条）

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC1 | Runtime 成功构造后独占一个 DocHandle，生产构造器不从公共 package entry 导出，失败时所有权不转移 | ✅ | `runtime-public-surface-ownership.test.ts`：`entry.createNamespaceRuntime === undefined`（生产构造器缺席锁定）；seam 同步构造；released handle 构造 throw 且 handle 状态原样、可重新 load 构造成功（所有权不转移）。SA4 R1 设计一致性 14/15→R2 全项（D1/V1-V3 校验前置、throw 路径零副作用）；SA7 Step 1 全绿 | 无需处理 |
| AC2 | 公开冻结的 owner.userId/namespaceId，不公开 DocHandle、Y.Doc 或 writable Yjs reference | ✅ | 同文件：`Object.isFrozen(owner)`、`namespaceId === handle.docId`；`doc/handle/docHandle/yDoc/sequencer/persistence` 五键 own+原型链 `in` 全 false。SA4 七键闭包核对通过；SA2 R1 CRITICAL#1（getSchemaEnvelope live 引用泄漏）经 R2 值域守卫修复后 SA4 R2 实证非 primitive 值公共面 loud throw | 无需处理 |
| AC3 | read/getSchemaEnvelope/getMetadata/getActiveSchema/getStatus 均为同步只读能力，读取不等待 P0 | ✅ | public-surface：五方法返回值均非 Promise；sync-read-face：p0Gate 未 resolve 时五个读取面立即可用且值正确、25ms 后仍 preparing、resolve 后 ready。SA7 Step 1 + 清单 #5（release 后读取照常）复核 | 无需处理 |
| AC4 | getSchemaEnvelope 只投影四个 primitive string 标准键并忽略额外键；META 返回全部 plain JSON 字段 | ✅ | sync-read-face：toEqual 四键、额外键（含 null 值键）不出现、不 coercion 不补默认值；getMetadata 全键深拷贝、突变/删除副本不影响重读；`metadata-proto-key.test.ts`（SA4 F-1 回归锚 4 用例）：`'__proto__'` 键顶层标量/对象/嵌套/round-trip 全保真——「全部键」含危险键。SA4 R2 探针 P5/P6/B1/B2/C1 + SA7 F-1 复核一致 | 无需处理 |
| AC5 | P0 是 write sequencer 的真实队首节点，只读取/编译 SCHEMA 并构造 active schema tools，不读取或验证 ROOT | ✅ | `runtime-p0-sequencer.test.ts`：构造同步返回、绝不在构造栈结算（preparing→ready 异步）；注入 compile 收到的信封恰为四键投影；ROOT 为 Y.Text 或内容违反 schema 均照常 ready、违规值原样读出（不读/不验 ROOT）；active 五字段与 vfsl compileSchemaEnvelope 产物逐字节一致、不暴露 module/derived/validator | 无需处理 |
| AC6 | P0 正常 compile failure 形成 schema-unavailable；internal throw 永久关闭全部写但保留读取 | ✅ | 同文件：TEXT_BAD 真实编译失败 → unavailable + 稳定 issue 摘要（code/message、无 stack/cause）+ rootWrite false / schemaWrite true（可修复）/ 读取保留 / getActiveSchema null；注入 compile throw → 构造不抛、fatal 稳定摘要（不含原始错误文本）+ rootWrite/schemaWrite 永久 false + 读取保留。SA4 附录 A 探针 E/F/G（gate-reject→fatal）独立证实 | 无需处理 |
| AC7 | P0 结算后出队，只保留 preparing/ready/unavailable active schema state | ✅ | 同文件：结算后 5 次采样恒 ready、state 收敛稳定；status 形状锁定 schema.state ∈ {preparing, ready, unavailable} 三态集合（fatal 独立槽）。SA4 R1 状态机核对 + R2 终审 | 无需处理 |
| AC8 | 包内确定性 testing seam 能控制 P0 resolve/reject，并证明读取在 P0 pending 时立即工作 | ✅ | seam `createNamespaceRuntimeWithSeam({ handle, p0Gate?, compile? })`：p0Gate 控制 resolve 时点（pending 期间读取立即工作——sync-read-face 主锚）；compile 注入控制 reject（ok:false）与 throw（internal fault）。三文件全部经 seam 驱动，无生产构造器依赖 | 无需处理 |
| AC9 | 全量 typecheck/test 和 Node 20/24 CI 通过 | ✅（本地双档等价证据；远程 CI 属 runner 阶段） | 总控亲跑（.mabf-bg/verify-f1.log）：`pnpm typecheck` 七包 exit 0；`pnpm test` 74 文件 1023/1023、Type Errors 0、exit 0（Node 24）。SA7 清单 #3：Node 20.20.2 + corepack pnpm@10.28.2（CI 精确等价组合）typecheck + 全量双绿；补锚入列后双档 75 文件/1026 用例 exit 0；Hard Gate #14 触发证据 all-vitest-packages-triggered | 远程 CI run 由 issue-runner push 后跟踪核对（总控不裁决 CI） |

## 结论

9/9 全部 ✅，无 ❌ 条目，无需追加 SA 修订轮。进入 Phase 4 收尾固化。
