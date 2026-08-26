# SA4 静态验尸报告：Issue #110 namespace-registry open

**Date**: 2026-08-26
**审查对象**: worktree 未提交改动（`packages/namespace-registry/**`、根 `package.json`、`packages/namespace-runtime/test/runtime-registry-internal-seam-rev1.test.ts`、锁文件及任务档案）
**基准**: `TASK.md` 12 条 AC、冻结设计、SA2 Round 2 conflict report、ADR-0009、Runtime/Persistence 实际接口
**Verdict**: **APPROVED-WITH-CHANGES**

## 执行证据

- `git diff --check`：通过，无 whitespace error。
- `pnpm exec vitest run packages/namespace-registry/test/registry-open.test.ts packages/namespace-registry/test/registry-surface.test.ts packages/namespace-registry/test/registry-node-dispose.test.ts --typecheck --passWithNoTests=false`：**3 files / 40 tests passed；Type Errors: no errors**。
- `pnpm typecheck`：**exit 0**，根链已含 `tsc -p packages/namespace-registry/tsconfig.json`。
- CI 触发性静态复核：`.github/workflows/ci.yml:39` 执行 `pnpm test`；`vitest.config.ts` 的 include 为 `packages/*/test/**/*.test.ts`，覆盖三个新增 Registry 测试文件。
- Scope Guard：设计 §13 有 ALLOW/DENY list。生产源码、测试、根 `package.json` 与 runtime seam test 均在 ALLOW；`pnpm-lock.yaml` 属技能豁免锁文件；任务 wiki 档案豁免。未见 DENY 路径变更，也未见 blacklist 文件。

## 阻断问题清单

**无阻断问题（0）。**

## 设计符合性与并发攻击结论

### 已确认符合

1. **双 map carrier / FIFO /绿尾**：`registry.ts:143-146` 独立维护 `entries` 和 `carriers`；`admitOpenSlot()`（`197-206`）在 `open()` 返回 Promise 前同步捕获现有 carrier、基于旧 tail 建 slot，并立即将 `carrier.tail` 置为 catch 化 green tail。因此同调用栈 reentrancy（包括 observer callback 内再次 `open`）也只能排在已接纳 slot 后，不能插队。
2. **carrier 清理与 ABA**：`registry.ts:174-194` 在该 operation green tail settle 后，仅同时满足无 entry、carrier identity 相同、tail 仍相同才删除。后续 slot 更新 tail 会使旧 cleanup 失效；成功 entry 使第一条件失败。entry 预留的 `removeOnlySelf()`（`123-129`）有 identity + generation 双守卫。
3. **失败隔离**：`operation.then(...).then(() => undefined, () => undefined)`（`199-204`）确保 unknown fatal rejection 不污染下一个同 key slot；测试 `registry-open.test.ts:366-377` 真正以 unknown load rejection 后 retry 验证。
4. **await 后重校验**：closing 预留分支在 `await current.closePromise` 后于 `registry.ts:254-258` 重读 entry；当前 #110 没有 reachable close path，逻辑仍满足冻结设计的 future seam。
5. **错误分流**：typed `DocLoadOperationalError` 在 `263-267` 映射窄 issue，unknown load 在 `268-275` 映射 branded fatal；factory throw 在 `281-292` 先恰一次 best-effort release，再保持 factory cause 的 runtime-construction fatal。
6. **lease 通道**：`lease.ts:66-79` 首次 release 同步置 released、删除 lease、缓存 `Promise.resolve()`；后续及 asyncDispose 同一 promise。`84-115` 对 read/getter/status/两写分别实施设计 §7 的指定通道。对象与 owner 投影均 freeze。
7. **observer 隔离和零回显**：`observer.ts:25-35` 与 diagnostics `registry.ts:149-160` 都吞 observer/sink throw；公开 issue/error 文本均常量或仅含固定 operation/phase/committed 枚举，不插 identity 或 cause。测试 `registry-open.test.ts:967-1042` 使用 identity/cause/schema/root sentinel 验证 JSON/message 不回显，同时 observer 得到 exact cause。
8. **开放时机与能力保真**：entry 于 runtime factory 返回后立即登记（`294-296`），没有 P0/schema/ROOT wait；runtime fatal/degraded/unavailable 未被 Registry 二次否定。
9. **public/testing 边界**：主入口 `index.ts:9-22` 仅导出冻结白名单；surface test 用实际 declaration emit BFS 检查主入口可达声明图，且运行时 export-key 为三项。testing subpath 虽保留精确 Runtime/DocHandle 作为类型注入，却不公开 entry/map/runtime instance。
10. **B3 活链路**：新增 Registry production import 位于 `registry.ts:28`；runtime audit helper 的默认 REPO_ROOT scan 和 `runtime-registry-internal-seam-rev1.test.ts:234-243` 均断言真实 `packages/namespace-registry/src/registry.ts` 被收集，并要求 `violators=[]`。

### 对抗性推演结论

- **同步接纳排序**：`open()` 先做同步 identity validate，再于任何 await 前执行 `admitOpenSlot`。即使 persistence resolve、observer 触发或 caller microtask 交错，第二个 valid same-key open 必须看到更新后的 carrier.tail。
- **observer reentrancy**：现有 observer 只在 slot 内 typed/unknown/factory/release 事件调用；同步 callback 再 `open` 会在同一 carrier 的 current green tail 后排队，且 observer throw 被隔离。未发现 queue poisoning 或跨 key blocking 反例。
- **factory sync-throw**：factory throw 会被 try/catch 捕获，await handle release 后才 branded reject；release rejection 和 observer throw 都仅作为诊断，无法替换 factory cause。没有双 release 调用路径。
- **carrier cleanup race**：slot 1 cleanup 的 tail equality guard 不能删除 slot 2 所更新的 tail；若 slot 2 已成功 entry，`entries.has(key)` 也阻止删除。测试覆盖 cleanup 前二次接纳及新 carrier generation。
- **已接纳写与 release**：lease 的同步 active check 和 release 的同步标志同属 JS run-to-completion；release 不取消已进入 runtime 的 Promise，符合 ADR-0009:42。

## SA3 自报/设计跟踪偏离点逐项裁决

> 实现中没有单独的“SA3 偏离点”清单；以下按冻结设计 §11/SA2 conflict report 的 8 项实施裁决逐项判定。

| 项目 | 裁决 | 证据 / 处理 |
|---|---|---|
| 1. `create` / `shutdown` 占位语义 | **可接受** | `registry.ts:309-319` resolve 固定 `NAMESPACE_OPERATION_UNAVAILABLE`，不读 input/Persistence、不改 running；对应测试 `645-677`。保留 SA2 N1：#111/#112 必须复审公开返回类型替换的兼容性。|
| 2. released getter coded throw | **可接受** | `errors.ts:44-50` 导出 branded `NamespaceLeaseReleasedError`；`lease.ts:88-99` 同步 throw；逐通道测试 `876-912`。|
| 3. 最小 identity grammar（非 ASCII/长度白名单） | **可接受** | `identity.ts:46-56` 仅拒绝空、`.`/`..`、C0/C1、slash/backslash；真实 Memory Persistence Unicode/长/空格 round-trip 覆盖 `266-300`。SA2 N2 已满足当前 Memory 证据；File adapter 共用 contract 留 #113。|
| 4. factory failure handle release | **可接受** | `registry.ts:215-225,281-292` 恰一次 release、reject 不替换 fatal；测试 `567-643` 覆盖 release resolve/reject + observer throw。|
| 5. `create(input: unknown)` | **可接受** | public interface `types.ts:171-176` 维持 unknown，未偷渡 #111 input model。|
| 6. carrier storage/cleanup/ABA | **可接受** | 双 map、三条件 cleanup、代际 token 与 deterministic diagnostics 位于 `registry.ts:143-205`；测试 `380-471`。|
| 7. hostile identity 算法 | **可接受** | namespaceId primitive 短路、owner prototype/descriptor try-catch、accessor 拒绝位于 `identity.ts:67-98`；测试 `147-264`。|
| 8. B3 REPO_ROOT module-boundary 活链路 | **可接受** | `registry.ts:28` 是唯一真实生产 import；runtime seam gate 与 surface 测试均检验真实路径收集、无 violator。|

## 测试质量审查

- 新增并发测试使用 deferred gate 与显式 microtask flush（`registry-open.test.ts:31-44`），未发现 real sleep / timer-race 侥幸。
- 抽查红灯有效性：
  1. 若删去 `admitOpenSlot()` 中 `carrier.tail = operationGreenTail`（`204`），same-key FIFO / singleton `304-345` 将变红；该断言同时检查 load/factory 次数和 first gate 期间 second slot 未进 load。
  2. 若把 released `read` 改为继续 delegate，`876-912` 会在 released exact issue 处变红；若删 synchronous `released=true`，`849-866` 在未 await release promise 时的 status 断言变红。
  3. 若删 cleanup 的 tail identity guard，`420-445` 的 second admission/race 行为或 diagnostics expectation 将暴露错误；该测试不依赖 sleep。
- 未命中“read source file + text regex 断言”伪测试反模式；surface declaration audit 是实际 `typescript` emit + declaration graph 的行为验证，不是源码形状 grep。
- 覆盖缺口（非阻断）：没有单独的**observer callback 内同步再次 `open` 同 key**测试；实现队列结构经静态推演安全，但建议补一个 deterministic regression 来直接固定该 reentrancy 约束。

## 非阻断建议

1. **SA6**：在 `packages/namespace-registry/test/registry-open.test.ts` 新增 observer reentrancy regression：typed load observer 中同步 `registry.open(sameOwner, sameNamespace)`，以 deferred second load / counters 断言第二次 strictly FIFO、tail 不毒化。该风险目前代码正确但仅间接覆盖。
2. **SA3**：`registry.ts:123-129` 的 `removeOnlySelf()` 在 #110 未被调用，属于 #111/#112 预留代码。后续首次引入 entry removal 时必须让实际 close completion 唯一走此 helper，并新增 old-entry/new-generation ABA 动态用例；不可直接 `entries.delete(key)`。
3. **SA1/SA3（后续 issue）**：保留 SA2 N1。#111/#112 将 `create/shutdown` 从固定 unavailable result 替换为实现结果时，需明确 semver/source-compat strategy 并以 TS consumer fixture 验证。
4. **SA6 / #113**：将当前 N2 的 Memory adapter Unicode/long/space round-trip 扩展为 Memory/File shared contract suite；#110 当前范围不应为此修改 persistence。

## 仓库惯例与范围

- package metadata 使用 workspace dependency、`type: module`、`exports` 为 `.`/`./testing`，与设计一致。新包通过根 typecheck 链和现有 vitest glob 接入。
- 新增 `@nomicore/doc-runtime`、`@nomicore/vfsl` 与 `yjs` 依赖是 public structural aliases/测试真实 persistence 所需的直接依赖；锁文件随 package metadata 更新，未观察到 npm/yarn lockfile。
- 生产实现只从 `registry.ts:28` 消费 runtime internal factory，符合 ADR-0009 的唯一允许方向。`testing.ts` 不消费 internal subpath。

## 动态审核重点（交 SA7）

1. 在 Node 20 与 Node 24 CI 日志确认三个 Registry Vitest files 被 `pnpm test` 实际收集，尤其 `await using` 两个用例未因 runtime capability 跳过。
2. 用真实 File persistence adapter（归 #113 全合同）验证 Unicode、超长、含空格 identity 的 create/load/open round-trip；当前 #110 已有 Memory adapter 证据。
3. 对 observer callback 同步 reentrant same-key `open` 运行新增回归（若采纳建议），确认没有 starvation、双 factory 或 carrier orphan。
4. 在真实 declaration emit / package resolution 环境确认主 entry 和 testing subpath export maps 与 CI bundling/Node ESM resolution 一致。

## 总结

实现遵循冻结设计的核心不变量：同 key 同步 FIFO、双 map carrier cleanup、failure-green-tail、lease 同步失效及精确 Promise identity、窄 issue/fatal 分流、observer 隔离与公开零回显；范围和 CI 接入均已核验。**结论：APPROVED-WITH-CHANGES，阻断数 0。**
