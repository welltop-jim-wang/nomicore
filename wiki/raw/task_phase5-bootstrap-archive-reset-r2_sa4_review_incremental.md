# SA4 增量静态复审报告 — issue #133 round=2 R-FIX-1

**Date**: 2026-08-28
**Review target**: commit `8b1398f` only (baseline: prior full SA4 report `task_phase5-bootstrap-archive-reset-r2_sa4_review.md`)
**Verdict**: pass

## 范围与方法

本轮仅复审 `8b1398f` 对前轮必须修复项 R-FIX-1 的增量；前轮对 R2-AC-1..6、fence/close 协议、probe 分类及 import 路径的全量结论继续有效。审阅了提交 diff、`registry.ts` 入口/槽/归档调用路径、`types.ts` 结果联合与全仓 `field` 消费点、增量测试以及 CI runner 配置。

增量生产文件均在 SA1 §8 ALLOW LIST：

- `packages/namespace-registry/src/registry.ts`
- `packages/namespace-registry/src/types.ts`
- `packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-internal.test.ts`

另有 SA3 实施档案更新；无黑名单文件。`git diff --check 4fe3a02..8b1398f` 无输出。

## 1. R-FIX-1 实质消解：通过

### 入口顺序与敌意对象收编

`registry.ts:1907-1916` 的顺序为：

1. acceptance；
2. `validateOpenIdentity(owner, namespaceId)`；
3. `snapshotReplicationIdentityRef(expectedLocalIdentity)`；
4. 仅成功后才 `admitResetSlot(...)`。

这镜像 import 入口 `registry.ts:1883-1892` 的纪律。快照发生在 carrier 创建/入队、entry 查询、Runtime fence 与 Persistence probe 前。失败返回固定的 `RESET_EXPECTED_IDENTITY_INVALID_ISSUE`（`registry.ts:473-478`），不会误落入本地 `NAMESPACE_RESET_IDENTITY_MISMATCH`。

`snapshotReplicationIdentityRef`（`registry.ts:252-280`）使用普通对象原型门、own data descriptor、禁止 accessor、ID 正则和 epoch safe-integer/下界判定；其 `try/catch` 覆盖 `getPrototypeOf` / `getOwnPropertyDescriptor` 的 Proxy trap throw。因此 getter/Proxy throw 规范地变为输入拒绝而非进入槽内触发 fatal。

### 冻结快照与双读分叉

成功快照返回 `Object.freeze({ replicationId, replicationEpoch })`。该捕获值作为 `expected` 传给 `admitResetSlot`（1916），再从 Runtime fence 调用（1649-1652）一路传至 `archiveDocFn.call(..., expected)`（1701）。因此 fence 核验和 archive guard 消费的是同一个冻结对象，而不是调用方可变对象的两次读取；前轮 TOCTOU 分叉已经消除。

## 2. 结果通道与类型面：通过

SA3 采用前轮列出的 A' 变体：保持既有 code `NAMESPACE_INVALID_IDENTITY`，将 `InvalidIdentityIssue.field` 从 `owner.userId | namespaceId` additive 扩为 `owner.userId | namespaceId | expectedLocalIdentity`（`types.ts:117-122`）。本裁决认为该变体成立：

- `ResetReplicaIssue` 已包含 `InvalidIdentityIssue`（`types.ts:351-353`），故返回值在公开联合中有诚实落位；不需裸 cast 或新未审 code。
- 扩张是 append-only；open/create 仍产生原有两个 field 值，既有 code/message 及其类型未变。
- 全仓检索 `field` 消费点仅命中 namespace-registry 的测试断言（`registry-create.test.ts:961`、`registry-open.test.ts:304`、`registry-phase5-identity-red.test.ts:270,520`），不存在生产代码的 exhaustive `switch`、反向 deny-list 或以二元 field 联合进行不安全穷尽判断。因此没有 caller ripple 证据。
- message 继续使用 `NAMESPACE_INVALID_IDENTITY_MESSAGE`，没有宣称本地 identity mismatch，且不回显 expected 内容；`field: 'expectedLocalIdentity'` 精确标识实际坏参数。
- `'expectedLocalIdentity'` 是 task/design §3.2 使用的既有参数词汇；无未经 SA2 评审的协议/错误码新词。

注释与现状一致：入口注释明确快照先于 carrier/entry/Persistence，`types.ts` 注释明确 additive 判别字和既有错误码语义；旧的“expected 纯传递”注释已删除。

## 3. 测试锚质量：通过

增量测试是运行时 Registry/Runtime/Memory seam 测试，而非源码字符串 grep（文件没有 `readFileSync`；三处 `toContain` 仅用于 observer payload 的运行时 JSON）。

1. **16 形态敌意矩阵**：`registry-phase5-bootstrap-reset-r2-internal.test.ts:648-676` 在已打开、可用 lease 的真实 reset 场景逐个提交 null、getter throw、Proxy throw、继承属性、非法 ID/epoch 等 16 形态，逐项断言 `NAMESPACE_INVALID_IDENTITY`。关键分界锚 `stub.probeCalls === []`（663）证明没有触达 persistence probe；同时断言 archive 空、lease active、Runtime lifecycle ready，并以正确 expected 重试成功且 probe 首次只在重试时出现（668-675）。这真实覆盖了「零 Persistence 触达」而不只是零写入。
2. **可变 expected TOCTOU**：679-699 行在 public call 返回 Promise 后改写原对象 epoch；成功后断言 archive seam 获得 `{replicationId: ID_A, replicationEpoch: 1}`，即入口时冻结值。它直接锚定 fence/归档共用捕获样本的效果。
3. **F-1 observer**：704-738 行以 armed 后 `DOC_ARCHIVE_OPERATIONAL` 触发 `NAMESPACE_RESET_FAILED`，过滤 observer event 并断言 `reset-archive-after-arm-failed` 恰一次（728-729），再序列化 cause 断言 replication ID、namespace 与 owner 均未回显（734-737）。这是实际派发行为与零身份回显，而非标题/静态存在性断言。

CI 可触发性成立：根 `package.json:11` 的 `pnpm test` 执行 `vitest run --typecheck`；`vitest.config.ts:5,8-10` 覆盖 `packages/*/test/**/*.test.ts` 及 type test；`.github/workflows/ci.yml:39` 运行 `pnpm test`。该新增/修改测试处于已覆盖的 namespace-registry package 路径。

## 4. 回归与前轮登记项

- 本提交没有新增 throw/return 契约，不触发 caller throw-ripple 门禁。
- 共享 `InvalidIdentityIssue.field` 的 additive 类型变更如上已完成消费者检索；本次受影响测试运行时与 typecheck 均通过。
- 前轮 F-2（旧 observer union dead declaration）、F-3（fence probe × idle-close 动态窗口）、F-4（未构造的 `decode` phase 词表）、F-5（报告计数误差）、F-6（既有 version bump scope 登记）均未被 `8b1398f` 改动，前轮“登记而非阻断”的结论仍成立。
- F-1 已由本提交新增可观测断言消解。

## 5. 验证证据

后台独立进程执行：

```bash
setsid nohup bash -c 'cd /home/wangjian/nomicore-fix-issue-133 && pnpm vitest run packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-internal.test.ts; rc=$?; echo $rc > /tmp/sa4-issue133-rfix1-exit' > /tmp/sa4-issue133-rfix1.log 2>&1 < /dev/null &
```

结果（`/tmp/sa4-issue133-rfix1.log`）：

```text
✓ packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-internal.test.ts (15 tests)
Test Files  1 passed (1)
Tests  15 passed (15)
Type Errors  no errors
exit code: 0
```

另执行：

```bash
git diff --check 4fe3a02 8b1398f
```

结果：exit 0、无输出。

## 动态审核重点（交 SA7）

1. 沿用前轮 F-3：fence probe 挂起窗口与 idle-close 的并发组合，验证 mismatch 返回与 generation 生命周期的调用者可观察一致性。
2. 沿用前轮窗口 mutation 端到端链：fence 后、arm 前已接纳 bump 排空后，真实 archive guard 的 armed-failure 分类。
3. 可补充黑盒 API 调用：JS 调用者传 Proxy/getter-throw expected 时确认仅返回稳定 `NAMESPACE_INVALID_IDENTITY`，不产生未处理 rejection；静态与本次运行时 internal 回归已覆盖核心路径。
