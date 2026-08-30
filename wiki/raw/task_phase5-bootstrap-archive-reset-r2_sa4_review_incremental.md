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

---

# R4 增量静态复审 — 方案 B 分类学返工

**Date**: 2026-08-28
**Review target**: `git diff 8b1398f..HEAD -- packages/`（实施 commits `1aa1994`、`d52130b`）；设计 §3.6 与 SA2 R4 delta 复审段。

## 审核结论

### 1. §3.6 逐项落地：通过

- **专属 code/message 精确一致**：`types.ts:105-106` 为
  `NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID: 期望本地复制身份（reset expectedLocalIdentity）不符合安全文法`，与设计 §3.6.1:309-310 逐字相同。常量单一来源、无插值或身份值回显，且没有新增 barrel value export。
- **共享形状回退、专属成员追加**：`InvalidIdentityIssue.field` 已恢复为仅 `'owner.userId' | 'namespaceId'`（types.ts:117-122）；`ResetReplicaIssue` 在 378-382 处 append-only 新增 reset 专属成员，形状只有 `ok/code/message`，没有 `field`。这消解 SA2 D-1/D-2 的公共联合扩张及诊断自相矛盾风险。
- **入口顺序和零副作用保持**：`registry.ts:1910-1919` 仍严格执行 acceptance → `validateOpenIdentity` → `snapshotReplicationIdentityRef` → 专属 issue/`admitResetSlot`。因此 owner/namespace 失败不会读取 expected；expected 快照失败发生在 carrier、entry、Runtime fence/probe、Persistence/archive 之前。快照 helper 的 own-data-descriptor/proto 门和 catch 已沿用，getter/Proxy trap 仍收编。后续只传递冻结 `snapshot.value`，前轮 fence/archive 双读分叉修复未回退。
- **import 对称性**：import 仍于同一 helper 后返回其既有无-field专属 `NAMESPACE_IMPORT_EXPECTED_IDENTITY_INVALID`（registry.ts:1888-1895）；reset 改为同类无-field专属 code（474-478），两入口在输入验证纪律上对称但不混用语义 code。
- **严格双源语义未回归**：R4 没有改 `runResetSlot`/fence；SA2 R4 所要求的「live 或 persisted 任一 `identityEquals` false 即 mismatch」仍由先前严格 AND 通过条件实现。SA6 race A/B 的测试与行为没有被 R4 文案变更影响。

### 2. 测试锚强度：通过

- 16 形态矩阵逐项作完整 `toEqual({ok:false, code, message})`（internal test:663-680），因此任何残留/新增 `field` 都会失败；每一个形态在循环内分别断言 `probeCalls=[]`、`archiveCalls=[]`、lease active、Runtime ready，而非循环后仅一次汇总。常量还被文本字面量锁定（682-685），有效阻止 source 与测试共同漂移。
- 同一用例保留正确 expected 重试成功和首次 probe 计数为 1（692-700）；TOCTOU 测试在调用后改写原对象，断言 archive 收到调用时 `{ID_A,1}` 冻结样本（704-723）。
- 新 owner/namespace 边界用例（726-757）分别 exact-equal 断言上游 `NAMESPACE_INVALID_IDENTITY`、原 message 和二元 field，并确认零 probe/archive 与 active lease，证明 reset 专属码不劫持上游身份分类。
- 公开 `*.test-d.ts` 锚以四个 public aliases（Open/Create/Import/Reset）锁 field 精确二元，并证实 reset 新成员非 `never` 且 keys 中无 `field`（surface test:84-120）。这是公开声明图锚而非内部接口假设。
- 相关测试不含 `readFileSync` 源码 grep 断言；F-1 仍为实际 observer event 的恰一次派发及 cause JSON 无值回显断言。

### 3. SA3 追加项与 F-2/F-4：通过

SA3 对外部候选的逐 hunk 审计在 `sa3_impl.md:69-81` 留有可复核表：候选 `1aa1994` 的四个 packages 文件与记录文件逐项映射到 §3.6；`git show --name-only 1aa1994` 的文件清单与审计表一致。后续 `d52130b` 的 packages 增量正是表中明示的逐形态锚加强、owner/namespace 边界锚、F-2 注释和 F-4 文案，不存在未列入审计/追加说明的 packages hunk。

- F-2 仅更新 `registry.ts` 中过时 `beginCloseCurrent` 注释为现行 `beginIdleClose` / `fence.startCloseAfterFence` / 共享 close promise 描述，未触及执行语句。
- F-4 仅把 R2 red test 的“临时、待冻结”头注/标题改为已经冻结的准确描述；diff 不改行为断言。

### 4. SA2 R4 五条红线实现级核查：通过

1. 16 hostile input 的 reset 专属完整 issue 且无 field：internal 663-680；每形态零 probe/archive 和 active/ready 断言成立。
2. owner/namespace 非法保持旧 code/message/二元 field：internal 726-757 直接覆盖两类边界。
3. 四个公开 alias 的 field 二元与新成员可达/无 field：surface type anchors 101-120，且本轮 typecheck 测试已运行。
4. 可变 expected 冻结样本：internal 704-723；race A/B 则在 r2-red 已保留，对应 live/persisted 各一侧不等都返回 mismatch 的零破坏语义未被 R4 改动。
5. F-2/F-4 为零行为性文案清理：R4 diff 可见 registry 处仅注释变化、red test 处仅 comments/describe/it strings 变化；`git diff --check 8b1398f..HEAD` 无输出。

### 5. 验证证据

后台独立进程执行：

```bash
setsid nohup bash -c 'cd /home/wangjian/nomicore-fix-issue-133 && pnpm vitest run packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-internal.test.ts packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-red.test.ts packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-surface.test-d.ts; rc=$?; echo $rc > /tmp/sa4-issue133-r4-exit' > /tmp/sa4-issue133-r4.log 2>&1 < /dev/null &
```

结果：exit 0；3 test files / 30 tests passed（internal 16、red 10、surface type 4），`Type Errors: no errors`。

## 动态审核重点（交 SA7）

沿用前轮动态重点：fence probe 挂起 × idle-close、fence 后 arm 前 mutation 到真实 archive guard 的端到端分类；R4 分类学本身未引入新的运行时协议风险。

## 1.5 协议假设审查

已核实设计 §9 的声明属实：R4 增量 diff 不含 HTTP/WS 端点、status 约定、端口、进程时序或第三方库行为等协议级假设。fence/FIFO 次序仅为进程内并发伪码，已由设计 §3.4/§3.5 的无环顺序证明覆盖。`protocol-assumption: none-found`。

**Verdict**: pass
