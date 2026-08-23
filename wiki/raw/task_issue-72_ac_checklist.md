# AC 逐条确认清单 — issue #72 严格编译 SchemaEnvelope（compileSchemaEnvelope）

- run_id: issue-72-1787369238-3088589
- 核对时间: 2026-08-22 13:2x（Phase 3.5 门禁，SA4/SA7 双清后）
- 测试锚文件: `packages/vfsl/test/compile-schema-envelope.test.ts`（28 用例，SA6 owned）、`packages/vfsl/test/compile-schema-envelope-sentinel.test.ts`（7 用例哨兵）
- 验证基线: 总控亲跑 `pnpm test` 697/697 绿（SA3 commit 7033490）+ 哨兵并入后 704/704 绿（SA6/SA7 两轮独立复跑一致）；`pnpm typecheck` 0 错

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC1 | 信封必须恰含 `lang/version/id/text`，缺失、多余或类型错误在 envelope stage fail-fast | ✅ | 测试组「AC1 信封严格封闭（恰四键）envelope 阶段 fail-fast」（test:208）：ENV-1 非对象 / ENV-2 缺键 / ENV-3 类型错 / ENV-5 多余键 / fail-fast 顺序锚 / 缺键+类型错并存仍单 issue；哨兵 RT-3 伪造向 + RT-4 不可枚举键补锚 | SA3 实现 envelopeStrictGate（envelope.ts +53 行），SA4 §一/§四复核逐字一致 |
| AC2 | dialect/envelope/internal 返回单 issue，parse/evaluate 保留原生 issues 数组 | ✅ | 测试组「AC2 分阶段结果联合」（test:288）：ENV-4 readOnly 单条 / parse 原生 VfslIssue 数组与 parseVfsl 深相等 / evaluate 经 vi.mock 注入失败原生数组保留 / internal 对抗 Proxy 单条 ENV-100 不外抛；SA7 报告五阶段可观测性逐条摘录 | SA3 五阶段编排（index.ts +84 行），D4 判别式（kind+code+readOnly） |
| AC3 | 两种指纹均使用 SHA-256、UTF-8、canonical JSON 与 `sha256:v1:<hex>` 格式 | ✅ | 测试组「AC3 指纹算法与格式」（test:364）：双指纹格式 + envelope 精确摘要公式（v1-spec §7 表序）+ FIPS KAT 防循环 + 确定性/键序归一化 + 域分离互异；设计 §6.2 三层域分离构造（SA8 N2 专项达标） | SA3 fingerprint.ts 新建（前缀常量+域标签同址）；SA4 §三 M1(b) grep 门禁 PASS |
| AC4 | envelope fingerprint 覆盖四键；semantic fingerprint 忽略空白和普通注释、保留 JSDoc/声明顺序并排除 id | ✅ | 测试组「AC4 指纹敏感性」（test:410）：id 仅变→envelope 变 semantic 不变 / 空白、`//`、`/* */` 仅变→semantic 不变 / JSDoc、声明顺序仅变→semantic 变；SA7 跨进程两次独立 node 进程指纹逐字节一致 + 敏感性矩阵复核 | SA1 设计 §6.3-6.4（单一生产者不变式 + 敏感性由 IR 纪律承担）；哨兵 RT-1b/1c 钉死 |
| AC5 | envelope/module/derived 递归深冻结且共享引用关系不被复制破坏 | ✅ | 测试组「AC5 递归深冻结与共享引用」（test:451）：全嵌套 isFrozen 遍历 + 共享引用同一性（index['ROOT'].node===structure 等）+ ref 按名不内联 + 严格模式赋值抛 TypeError；SA7 冻结 loud 探针（顶层/envelope/module/嵌套四处 TypeError） | SA3 一趟 deepFreeze(result, WeakSet) 原地冻结（D5，禁复制式）；SA4 §四复核 |
| AC6 | 无模块级 cache 或 Host 生命周期状态；全量 test/typecheck/CI 通过 | ✅ | 测试组「AC6 无缓存、纯函数、零新依赖」（test:531）：同文本两编引用互异值确定 / 无顺序依赖 / 零运行时依赖清单 / 公共导出可直调；总控亲跑全量 697/697 绿 + typecheck 0 错（.mabf-bg/phase3-verify.log），SA6/SA7 复跑 704/704 | SA3 编排体零 compiledCache 引用（SA4 §四实证）；CI 触发由 issue-runner 发布后经 ci.yml `pnpm test`+`pnpm typecheck` 覆盖（SA4 §五 + SA7 Hard Gate #14 段） |

## 结论

6/6 全部 ✅，无 ❌ 条目，无需补派 SA。进入 Phase 4 收尾固化。

## 备注

- SA7 DA-2（node 20 矩阵）因本地环境仅有 node 24.13.0 / 18.19.1 未实测，已如实登记：新增代码零 node API、零外部 import、sha256 纯 ES2022 + KAT 锚，静态风险面低；node 24 全绿。CI 矩阵（若配置 node 20）由 issue-runner 发布后经 CI 验证。
- SA7 DA-1 CI 触发证据：本分支尚未 push 无 CI run，以本地同命令 `pnpm test` 输出替代并注明；push 后 CI 侧证据归 issue-runner/ci-watch 管辖（移交备注）。
