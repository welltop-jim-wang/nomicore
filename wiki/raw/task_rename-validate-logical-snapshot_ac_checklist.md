# AC 逐条核对表 — issue #71（validateSnapshot → validateLogicalSnapshot）

门禁时间：2026-08-22 11:02 · 核对基准：TASK.md 验收标准（= issue body AC） · 被验 commit：`06d6796`

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC1 | 公共导出只存在 `validateLogicalSnapshot`，旧名在模块导出与调用方中均不存在 | ✅ | 探针 AC1/AC2 模块级锚：`validateLogicalSnapshot` 为 function、`validateSnapshot` toBeUndefined（G3a `Tests 29 passed (29)`，host + node20 容器双 leg）；G1 白名单全仓 `git grep` 零输出（总控/SA4/SA7 三方独立重跑）；SA4 对抗攻击：动态字符串/大小写变体/alias 形态/跨包重导出链全部零命中；生产 caller=0（设计 §12 审计 + SA4 复核一致） | SA6 锚定 + SA3 实现 + SA4/SA7 验证闭环 |
| AC2 | 全仓调用方、测试和文档完成迁移，行为测试证明既有校验契约零回归 | ✅ | 15 个 ALLOW 文件迁移（src 4 + tests 7 共 127 处 + 活文档 3 文件 7 处 + version bump）；行为零回归的行为证明：SA6 共享断言集 27 条以旧名跑 27/27 绿（更名前）→ 以新名跑 29/29 绿（更名后，同一解释器）；SA4 机械等价金标准：9 文件反向更名后与基线 `cmp` 逐字节相等，validate.ts/index.ts 残余差异恰为设计内两处文档块；全量 669/669 绿 | SA6 双跑锚定 + SA4 机械证明 |
| AC3 | JSDoc 明确 logical JSON 与 live Yjs 载体的边界 | ✅ | `packages/vfsl/src/validate.ts` L633-648 JSDoc 块（9→16 行逐字设计 §4.1(b)）：「输入是普通 JSON **logical ROOT snapshot**……**不接受** Y.Doc / Y.Map / Y.Array 等 live Yjs 载体，也**不验证** Yjs 载体形态——载体结构校验属 ADR-0007 的 Yjs Runtime 层」；SA4 验证与设计 §4.1(b) byte-identical | SA3 按设计逐字落地 |
| AC4 | 全量 test、typecheck 与 Node 20/24 CI 通过 | ✅（本地全绿；真实 CI run 属 runner 权责） | `pnpm test`：Test Files 47 passed / Tests 669 passed（总控独立复跑）；`pnpm typecheck` exit 0（五包，总控独立复跑）；Node 版本双 leg：host node v24.13.0 全 CI 步骤序列 exit 0 + docker node:20-slim（CI=true）忠实复刻 ci.yml 全步骤 exit 0（SA7 报告）；真实 CI run 待 push 后由 issue-runner/ci-watch 验证（总控权责止于本地完成事务，不裁决 CI） | 本地门禁全绿；CI 跟踪移交 runner |

## 结论

4/4 AC 满足（AC4 的真实 CI 证据按权责边界由 issue-runner 在 push 后收口，非本地完成门槛——SA7 已附补证命令清单）。无 ❌ 条目，无需回流任何 SA。进入 Phase 4 收尾。
