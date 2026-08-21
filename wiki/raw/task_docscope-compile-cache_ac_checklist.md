# AC 逐条确认 — DocScope 作用域绑定与编译缓存（issue #54 / H3）

- 日期：2026-08-21 · 总控（Phase 3.5 门禁）
- 验收基准：TASK.md Acceptance criteria（6 条）
- 验证面：SA6 验收测试 `packages/vfsl/test/docscope-getcompiled.test.ts`（13 用例，全绿）；设计强制守卫 `docscope-sha256.test.ts`（13/13）、`docscope-guards.test.ts`（6/6）；SA7 动态探针（`.mabf-bg/sa7/probe.ts`，7/7 交错稳定性）；总控亲跑全量 `pnpm test` 555/555 exit 0（`.mabf-bg/ctrl-verify3.log`，SA7 独立复跑同结论 `.mabf-bg/sa7/sa7-full.log`）；三包 `pnpm typecheck` 零错（`.mabf-bg/sa7/sa7-tc.log`）。

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC1 | 同文本两次调用返回同一对象引用（缓存命中可证） | ✅ | docscope-getcompiled.test.ts「AC1」3 用例：容器/module/derived 三重引用同一 + 信封/文本/不同 id 同条目 + evaluate spy 计数不增（命中不重算）；SA7 探针 500 文本两轮引用稳定 500/500 | 无需处理 |
| AC2 | 仅空白差异的文本 = 不同键（正确重算，不去重） | ✅ | 「AC2」2 用例：空白变体/前缀共享变体引用互异、语义深相等、各自重算；sha256 守卫 KAT 三变体摘要互异（设计 §7 锚定） | 无需处理 |
| AC3 | 多文本并存互不影响（隔离性） | ✅ | 「AC3」交错调用用例（A/B/A/B 引用稳定、跨文本互异、派生物各自对应）；SA7 探针 500 条目两两互异（Set=500） | 无需处理 |
| AC4 | 未知方言经 H1 通道拒绝，不产生缓存项 | ✅ | 「AC4」2 用例：issues 与 parseSchemaEnvelope 同输入全等（ENV-4 零损透传）、拒绝路径 evaluate 零调用、拒绝后同文本正常编译可命中、重复拒绝幂等 | 无需处理 |
| AC5 | evaluate 失败不污染缓存（可重试语义） | ✅ | 「AC5」用例：注入一次性求值失败经返回值通道（不抛错、ok:false、注入标记透传），同文本重试重算成功，第三次命中同引用；缓存只存 ok 分支 | 无需处理 |
| AC6 | 纯引擎、零新运行时依赖、同步/async 由 SA1 定 | ✅ | 「AC6」2 用例：package.json dependencies 恒 {}（清单契约）、getCompiled 公共导出可调；SA1 裁定同步接缝（设计 D1：组合链全同步纯函数），SA2 R2/SA4 均复核；版本 0.1.9→0.1.10 | 无需处理 |

结论：6/6 ✅，无 ❌ 条目，无需追加 SA 修订轮。进入第四阶段收尾。
