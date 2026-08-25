# AC 逐条核对表 — issue #109（namespace-runtime Registry 专用受限生产构造 seam）

核对时间：2026-08-25 20:1x（总控亲核；基线 3451eca → HEAD b233ea4 + SA7 补充暂存）

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC1 | `@nomicore/namespace-runtime/internal` 仅导出一个 Registry 专用生产 factory | ✅ | package.json exports 恰 `['.', './internal']`；seam.test.ts L117-122 运行时模块探测断言 `Object.keys(entry) === ['createNamespaceRuntimeForRegistry']` 且 typeof function；SA4 §2 零偏离 | SA6 锚定 / SA3 实现 |
| AC2 | factory 只接收 handle 与 dirty notifier，不暴露 compile/fault/testing seam | ✅ | internal.ts 签名恰 `(handle: DocHandle, notifyDirty: () => Promise<void>)`；type-guard.test-d.ts 3 it（@ts-expect-error 拒绝 p0Gate/compile 注入字段）；seam.test.ts 注入哨兵（compile spy 零调用、永不 resolve 的 p0Gate 不挂起 P0）；SA7 探针③notifyDirty 缺席写 loud 拒绝 | SA6 锚定 / SA3 实现 |
| AC3 | 主 entry 继续不导出 production constructor、DocHandle、Y.Doc、内部 state/sequencer | ✅ | exports-audit.test.ts 4/4 绿（值导出恰 RuntimeWriteFatalError、禁导清单缺席逐名断言）；git diff 证实 index.ts 零改动 | SA3 仅演进 T1.4，留守断言逐字未动 |
| AC4 | factory 产出 Runtime 保持 P0 队首、读取、写序列器、fatal/status/close 全部现有语义 | ✅ | 纯委托同一份构造序代码（internal.ts → runtime.ts）；seam.test.ts 8 行为 it（构造即读/P0 真实编译/FIFO notifySeq/status 七键/十键面/close 幂等）；sa7-dynamic.test.ts 4 探针（形状守卫零副作用/released 租约 HANDLE_NOT_USABLE/深导入阻断）；全量 96 文件 1150 用例绿 | SA6/SA7 双层动态证据 |
| AC5 | 模块边界测试证明仅 NamespaceRegistry 生产代码可消费 internal subpath | ✅ | seam.test.ts §AC5 import 图审计（REGISTRY_SRC_PREFIX 白名单 + 谓词自检 + 防空扫；当前消费方空集，前瞻放行切片 5/6）；SA7 探针④深导入 `…/src/internal.js` 被 exports map 阻断 | SA6 锚定 |
| AC6 | testing seam 继续位于受控测试入口，不进入主 entry | ✅ | 无 `./testing` 子路径（T1.4 演进后键集仍恰 2）；internal entry 零 seam/别名/运行态泄漏（seam.test.ts 零泄漏断言）；测试继续经 `../src/runtime.js` 包内模块通道消费 seam | 存量纪律保持 |
| AC7 | 通过全量 typecheck/test 与 Node 20/24 CI | ✅（本地）/⏳（CI） | 总控亲验：`pnpm test` 96 文件 1150 用例全绿 Type Errors no errors（exit 0）；`pnpm typecheck` 7 包 + 聚合 `tsc -p tsconfig.typecheck.json --noEmit` exit 0；`pnpm install --frozen-lockfile`、四附加门禁（persistence-contract 7/7、domains-scaffold 2/2、materialize-root 59/59、generate --check 零漂移）全 exit 0。Node 24 腿本地闭环；Node 20/24 CI matrix 由 Host 发布后执行（发布与 CI 裁决属 Host 边界，非本地完成门槛） | 本地验证闭环，CI 移交 Host |

结论：7 条 AC 全部 ✅（AC7 的 CI 腿按职责边界移交 Host）；无 ❌ 条目，无需补派 SA。
