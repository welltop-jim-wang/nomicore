# 任务简报 — namespace-runtime：Registry 专用受限生产构造 seam（issue #109）

- **Issue**: #109（welltop-jim-wang/nomicore），label: feature + in-progress
- **任务类型**: 功能开发（Feature Development）
- **Parent**: PR #105（docs/namespace-registry，Phase 4 集成分支）
- **前置**: PR #85（Phase 3 NamespaceRuntime）已合入 main（merge-base 5db6f83）
- **Branch**: fix/issue-109-on-docs-namespace-registry
- **Worktree**: /home/wangjian/nomicore-fix-issue-109
- **Phase 4 实施切片**: 第 4 片「NamespaceRuntime 的受限 Registry factory」（docs/phases/phase-4-namespace-registry.md）

## What to build（issue 原文）

为 NamespaceRegistry 提供唯一、受限的生产 Runtime 构造 seam，使 Registry 可以合法取得独占 DocHandle 并绑定 dirty notifier，同时普通业务调用方仍无法绕过 Registry 建立第二个 Runtime/sequencer。

## Acceptance Criteria（issue 原文，逐条验收基准）

- [ ] AC1 `@nomicore/namespace-runtime/internal` 仅导出一个 Registry 专用生产 factory
- [ ] AC2 factory 只接收构造真实 Runtime 所需的 handle 与 dirty notifier，不暴露 compile/fault/testing seam
- [ ] AC3 namespace-runtime 主 entry 继续不导出 production constructor、DocHandle、Y.Doc 或内部 state/sequencer
- [ ] AC4 factory 产出的 Runtime 保持 P0 队首、读取、写序列器、fatal/status/close 全部现有语义
- [ ] AC5 模块边界测试证明仅 NamespaceRegistry 生产代码可消费 internal subpath
- [ ] AC6 testing seam 继续位于受控测试入口，不进入主 entry
- [ ] AC7 通过全量 typecheck/test 与 Node 20/24 CI

## 设计基准（必读）

- **ADR 0009**（docs/adr/0009-namespace-registry-leases-and-host-lifecycle.md）§模块与 Cordis service：
  「Registry 通过 `@nomicore/namespace-runtime/internal` 唯一导出的 `createNamespaceRuntimeForRegistry` 构造生产 Runtime；主 entry 不公开生产 Runtime 构造器。模块边界测试限制该 internal subpath 只能由 Registry 生产代码消费。」
- **ADR 0008**（docs/adr/0008-*.md）：单 NamespaceRuntime、P0、单 sequencer、fatal/status/close 语义不变量。
- **CONTEXT.md**：namespace、写序列器、P0、active schema 等术语。
- **docs/phases/phase-4-namespace-registry.md**：实施切片与阶段门禁。

## 现状事实（总控核实，2026-08-25）

- `packages/namespace-runtime/package.json` 当前仅 `exports: { ".": "./src/index.ts" }`，version 0.1.5。
- 主 entry `src/index.ts` 现纪律：值导出恰一键 `RuntimeWriteFatalError`；其余全部为 type export；**不 re-export** `createNamespaceRuntime`（生产工厂）与 `createNamespaceRuntimeWithSeam` + `NamespaceRuntimeSeamInput`（测试 seam），两者保留包内（`src/runtime.ts` 模块级导出）。
- 测试经包内相对模块通道消费 seam：`import { createNamespaceRuntime, createNamespaceRuntimeWithSeam } from '../src/runtime.js'`（不经任何 package entry）。
- `NamespaceRuntimeSeamInput` 含 `handle`（DocHandle）、`p0Gate?`、`compile?`、`notifyDirty?` —— 其中 p0Gate/compile 是测试注入面，绝不允许进入生产 internal subpath。
- Registry 包（@nomicore/namespace-registry）**尚未存在**（Phase 4 后续切片 5/6 才落地）；本 ticket 只交付 namespace-runtime 侧的 internal seam 与边界测试。
- 根测试命令：`pnpm test`（`vitest run --typecheck`，覆盖 `packages/*/test/**` 与 `domains/*/test/**`，含 `*.test-d.ts` 类型测试）；`pnpm typecheck` 逐包 tsc；聚合 `pnpm exec tsc -p tsconfig.typecheck.json --noEmit`。

## 已知契约演进点（总控预研，SA6/SA1 必须正面处理）

- `test/runtime-acceptance-exports-audit.test.ts`（issue #93 AC6 存量验收）T1.4 断言
  `package.json` exports 键集**恰为 `['.']`**。新增 `./internal` 子路径后该断言必然变红。
  其底层不变量是「testing seam 绝不进 package entry」（ADR-0008 + #93 rev2 立法），
  该不变量**保持**；但精确键集断言须演进为 `['.', './internal']` 并改注引用
  ADR-0009 / issue #109。SA6 红灯应先固化新契约（含 internal 导出表精确性：
  值导出恰一键 `createNamespaceRuntimeForRegistry`，其输入类型仅 `handle` +
  `notifyDirty`，不含 `p0Gate`/`compile`/fault 注入），SA3 实现时同步修订 T1.4。
- 现有 exports-audit 的其余断言（主 entry 值导出恰一键、禁导清单缺席）**不得被破坏**（AC3）。

## 边界与纪律

- internal subpath 是**生产** seam：只允许构造真实 Runtime 所需的最小输入（独占 DocHandle 租约 + dirty notifier 绑定），形状守卫/状态门/所有权转移/P0 入队等构造序（ADR 0008 D1）逐字节保持。
- 不新建 Registry 包、不实现 Registry 核心（属后续 ticket）；AC5 的边界测试以「仓库内谁 import 了 internal subpath」的静态审计实现，白名单 = 未来的 `@nomicore/namespace-registry` 生产代码（当前应为空集，测试需前瞻性允许该包路径）。
- 版本纪律：修改 `packages/namespace-runtime` 必须 bump patch 版本（硬门禁 #9）。
- `wiki/raw/` 全部产出随代码 commit；`.mabf-bg/**` 不入仓。

## SA6 验收锚定记录（Phase 1 — 红灯固化，2026-08-25）

### 产出测试文件

- `packages/namespace-runtime/test/runtime-registry-internal-seam.test.ts`（行为面，8 it）
- `packages/namespace-runtime/test/runtime-registry-internal-type-guard.test-d.ts`（类型面，3 it）

### AC → 测试锚点映射

| AC | 锚点 | 文件/测试 |
|---|---|---|
| AC1 | package.json exports 键集恰 `['.', './internal']`（配置审计）；specifier 动态导入可解析且值导出键集恰一键 `createNamespaceRuntimeForRegistry`（运行时模块探测）；无 `./testing`/`./test`/`./seam` 子路径 | seam.test.ts「AC1/AC6」三 it |
| AC2 | 类型面：输入必须为两参形 `(handle, notifyDirty)` 或恰 `{handle, notifyDirty}` 单对象形；参数对象类型面不存在 `p0Gate`/`compile`；行为面：附着 compile spy（调用即抛）+ 永不 resolve 的 p0Gate + fault 哨兵 → P0 仍以真实 vfsl compile 结算、spy 零调用、Runtime 全功能 | type-guard.test-d.ts 三 it；seam.test.ts「AC2」it |
| AC3 | 不破坏既有 exports-audit（主 entry 值导出恰一键、禁导清单缺席）；类型面副锚：主 entry 不导出 `createNamespaceRuntime`（@ts-expect-error 守卫） | 既有存量文件（留守）；type-guard.test-d.ts |
| AC4 | 经 internal factory 构造：构造即读（不等待 P0）→ P0 队首真实编译（写排在 P0 后）→ FIFO 写序列器（首笔 notify 40ms 延迟窗内发次笔，notifySeq 严格按序、每成功写恰一次、P0 零 notify）→ status 七键面 + 十键公共面 → close 同步 closing/同一 Promise 实例/幂等/release 恰一次/closed 后 read-write 停接纳（RUNTIME_READ_DISABLED / RUNTIME_WRITE_DISABLED）→ 跨实例持久化落盘 | seam.test.ts「AC4」it |
| AC5 | 生产源码树 import 图审计：`@nomicore/namespace-runtime/internal` 消费方 ⊆ 白名单（前瞻允许 `packages/namespace-registry/src/**`，当前仓库无消费方）；白名单谓词自检（allow/deny 各例）+ 防空扫覆盖断言 | seam.test.ts「AC5」三 it |
| AC6 | exports 键集恰 `['.', './internal']`（任何 testing/seam 子路径即红）；internal entry 零 seam 泄漏（`createNamespaceRuntimeWithSeam`/`NamespaceRuntimeSeamInput`/生产工厂别名/运行态全体缺席，模块级探测） | seam.test.ts「AC1/AC6」；type-guard.test-d.ts 副锚 |
| AC7 | 属全量门禁（SA3 交卷时 `pnpm test`/`pnpm typecheck` 全绿 + Node 20/24 CI）；当前红灯为预期中间态 | — |

### 红灯验证（真实运行，功能尚不存在）

命令：

```bash
cd <worktree> && npx vitest run packages/namespace-runtime/test/runtime-registry-internal-seam.test.ts \
  packages/namespace-runtime/test/runtime-registry-internal-type-guard.test-d.ts
```

结果（exit code 1）：

```
Test Files  2 failed (2)
  FAIL runtime-registry-internal-seam.test.ts
  FAIL runtime-registry-internal-type-guard.test-d.ts
TypeCheckError: Cannot find module '@nomicore/namespace-runtime/internal' or its
  corresponding type declarations. (两文件各自命中——入口不存在，契约缺口如实呈现)
```

- 红根因：`packages/namespace-runtime/package.json` exports 仅 `{ ".": "./src/index.ts" }`，`@nomicore/namespace-runtime/internal` 经 package 自引用解析失败（vite：`Missing "./internal" specifier`；tsc：TS2307）。
- 存量 `runtime-acceptance-exports-audit.test.ts`（4 it）单独复核仍全绿——本次未触碰该文件，其余断言（AC3）零破坏。

### 修绿可行性验证（模拟实现 → 11/11 绿 → 已回滚）

为证明红灯可达成且不给 SA3 留假红/过锁，临时按 ADR-0009 最小形态模拟实现后全量执行新测试（`Test Files 2 passed (2); Tests 11 passed (11); Type Errors no errors`），随即回滚（`git checkout -- package.json` + 删除临时 `src/internal.ts`，工作树已复原）。模拟实现形态（两种工厂签名均被类型测试接受，二参形为推荐）：

```ts
// packages/namespace-runtime/src/internal.ts
import type { DocHandle } from '@nomicore/persistence';
import { createNamespaceRuntime } from './runtime.js';
import type { NamespaceRuntime } from './runtime.js';
export function createNamespaceRuntimeForRegistry(handle: DocHandle, notifyDirty: () => Promise<void>): NamespaceRuntime {
  return createNamespaceRuntime(handle, notifyDirty); // D6.3 绑定义务显式化
}
// package.json exports: { ".": "./src/index.ts", "./internal": "./src/internal.ts" }
```

### SA3 实现提示（含已知契约演进点落实）

1. **入口**：新增 `src/internal.ts`（或等价文件）并经 `package.json` exports 挂 `"./internal"`——值导出**恰一键** `createNamespaceRuntimeForRegistry`，不 re-export seam/`createNamespaceRuntime`/运行态。
2. **工厂签名**：只接收构造真实 Runtime 所需输入（`handle` + `notifyDirty`），绝不接受 `p0Gate`/`compile`/fault 注入（类型测试 @ts-expect-error/条件类型判别 + 行为测试注入面哨兵双锚）。
3. **T1.4 演进（必做）**：修改存量 `runtime-acceptance-exports-audit.test.ts` 第 56-66 行——键集断言 `['.']` → `['.', './internal']`，头注改引 ADR-0009 / issue #109；**其余断言不得改动**（AC3「主 entry 值导出恰一键、禁导清单缺席」维持）。
4. **版本纪律**：`packages/namespace-runtime` patch bump（0.1.5 → 0.1.6，硬门禁 #9）。
5. **AC4 保持面**：factory 内部委托既有 `createNamespaceRuntime`（或其等价构造序）即可——形状守卫/状态门/所有权转移/P0 入队/notifyDirty 逐字节复用现有实现，测试不预锁委托形态。
6. 不新建 Registry 包、不实现 Registry 核心（AC5 白名单前瞻性允许 `packages/namespace-registry/src/**`，切片 5/6 落地即放行，本测试不因未来消费方出现而红）。
7. 无需维护 `scripts/test-lock.sh`（本任务不新增端口/测试包；worktree 内亦不存在该脚本）。
