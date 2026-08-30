# SA3 边界修复说明 — issue #168（终审 Standards 轴 S1：apps/yjs-server 测试模块违规）

**Date**: 2026-08-30（终审 Standards 轴 S1 修复轮）
**Agent**: SA3（TDD Executor — 边界修复仅限）
**Worktree**: `/home/wangjian/nomicore-fix-issue-168`
**Commit**: `5591c2f` — `test(yjs-server): replace package-internal test seam imports with in-test public-API fixture (#168)`（父提交 `1092d34`，分支 `refactor/ws-replication-close-peer-transport-synchronously-`）
**Scope 指令**: 仅修复此应用测试的模块边界问题；不改生产代码；不弱化/跳过断言；保持该真实 WS 动态验证的语义与覆盖。

---

## 1. 阻断问题（S1）

`apps/yjs-server/test/ws-hello-timeout-close-issue168.test.ts` 第 49–50 行（修复前）以相对路径导入 ws-replication 包内测试基建：

```ts
import { HUB_INSTANCE, HUB_OWNER, PEER_INSTANCE, PEER_OWNER, makeHubNamespace, makeNode } from '../../../packages/ws-replication/test/harness.js';
import { DEFAULT_PEER_VERIFIER, TEST_TOKEN, makeAuthorizer } from '../../../packages/ws-replication/test/driver.js';
```

违反 `apps/yjs-server/AGENTS.md` Boundaries：

> Consume only package public exports (`@nomicore/{clock,persistence,namespace-registry,ws-replication}`); no package-internal subpaths, no testing seams, no DSH profiles.

`packages/*/test/**` 是包内测试文件（package-internal subpath + testing seam），对 `apps/yjs-server` 不可触达。

## 2. 修复方案（在测试自身建立最小必要 fixture，全部走包公共导出）

- **删除** 两个包内 subpath import（harness.js / driver.js）。
- **新增** 应用测试自身的最小 fixture（约 80 行，纯本地声明 + 生产公共工厂），零包内 subpath：
  - 常量 `HUB_INSTANCE/PEER_INSTANCE/HUB_OWNER/PEER_OWNER/TEST_TOKEN`、`SCHEMA_ENVELOPE` —— 本地 const（与归属包测试基建同构的纯值）。
  - 调度器 `realScheduler`：`RegistryTimeoutScheduler & PersistenceScheduler`（`@nomicore/namespace-registry` / `@nomicore/persistence` 公共类型）——真实 timer（本文件为真实链路抽样，与既有 `realTimer` 同构）。
  - 随机源 `cryptoRandomBytes`：`RegistryRandomBytes`（`node:crypto` 真随机；随机性只影响不可观测的 namespaceId/复制身份，测试断言零依赖其取值）。
  - 授权器 `authorize`：`NamespaceAuthorizer`（`@nomicore/ws-replication` 公共类型）——全授予、localOwner = HUB_OWNER（与原 `makeAuthorizer({})` 行为逐值一致）。
  - 认证器 `verifyToken`：`PeerTokenVerifier`（公共类型）——TEST_TOKEN → PEER_INSTANCE，其余拒绝（与原 `DEFAULT_PEER_VERIFIER` 行为逐值一致）。
  - `makeFixtureNode(role)`：生产 `createNamespaceRegistry(new MemoryPersistence({ scheduler }), { clock: systemClock, scheduler, randomBytes, idleTimeoutMs: 1_000_000, role })`（`@nomicore/namespace-registry` / `@nomicore/persistence` / `@nomicore/clock` 公共入口）。
  - `makeHubNamespaceFixture(node, owner)`：生产 `registry.create({ owner, schema, root })` → 轮询 `lease.getStatus().runtime.schema.state === 'ready'` → `lease.enableReplication()`（原 `makeHubNamespace` 的公共 API 等价最小实现）。
- `bootRealWs` 改用 `makeFixtureNode('hub'/'peer')` + `makeHubNamespaceFixture` + 本地 `authorize`/`verifyToken`。
- 头注释「fixture 复用 ws-replication 包共享测试基建」更新为「fixture 在测试自身以包公共导出就地搭建最小真实基建——零包内 subpath、零测试 seam」。

**语义与覆盖保持**（与修复前逐项一致）：
- RT-1：peer 经生产 `wrapWs` 执行 `close(1001,'hello-timeout')`，close code/reason 经真实 WS close 握手帧穿越内核 TCP，hub 侧 'close' 事件观测 `{code:1001, reason:'hello-timeout'}`——断言原样。
- RT-2：`close()` 入口时刻活跃 onClose/onMessage 监听数 = 0（退订先行）——断言原样。
- RT-3：真实异步 close 重入零副作用（listenersAtInnerCloseDelivery[0] === 0；恰一次 backoff `{hello-timeout, attempt:1}`；零 connection-failed）——断言原样。
- RT-4：backoff(40ms) → 重拨（gate 放行）→ ready → live；hub 收口至 1；400ms 稳定窗零复发——断言原样。
- 注入机制不变：`HubGate` 首代扣 hub→peer 出站帧（含 HELLO_ACK——「hub 无响应」注入）+ 非空转锚（swallowedFrameCount ≥ 1）、`PeerGate` 观测管道全保留。
- 真实 Registry/Runtime/yjs + 真实 timer 未变；唯一不同：Registry/Persistence 由生产工厂（`createNamespaceRegistry` + `MemoryPersistence` + `systemClock`）替换测试 seam 工厂——被测行为面（ws-replication 生产 adapter 链路）零变化。

## 3. 命令与结果

| 命令 | 结果 |
|---|---|
| `npx tsc -p apps/yjs-server/tsconfig.json --noEmit` | exit 0（零类型错误） |
| `npx vitest run apps/yjs-server/test/ws-hello-timeout-close-issue168.test.ts` | ✓ 1 passed（985ms 量级；Type Errors: no errors） |
| 同命令 ×4 次重复（真实 timer 稳定性） | 4/4 通过（985–986ms） |
| `npx vitest run apps/yjs-server`（全应用套件） | Test Files 9 passed (9) / Tests 38 passed (38) / Type Errors no errors |

## 4. 改动文件清单

- `apps/yjs-server/test/ws-hello-timeout-close-issue168.test.ts` — 修改（唯一改动文件；净 515 行 = 原文件 + 本地 fixture，断言区零改动）。
- 生产代码（`packages/ws-replication/**`、`apps/yjs-server/src/**`）**零改动**。
- 其余 SA7 产物（`packages/ws-replication/test/ws-replication-sa7-issue168-dynamic.test.ts`、wiki 报告）不在本修复范围，未触碰。

## 5. 备注

- 修复后文件对 `packages/**` 的相对导入为零；新导入全部为包公共导出（`@nomicore/clock`、`@nomicore/persistence`、`@nomicore/namespace-registry`、`@nomicore/ws-replication`），且均在 `apps/yjs-server/package.json` dependencies 中已声明。
- 未触碰 DENY LIST；未使用 env-override/fallback；断言无弱化、无跳过。
